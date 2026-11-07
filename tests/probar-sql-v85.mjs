/* Corre supabase-migration-v85.sql contra un Postgres DE VERDAD (PGlite).
   La tabla es nueva, así que no hay agujero que provocar: lo que se comprueba
   es que las puertas queden puestas —dueño sí, colaborador sí, ajeno NO,
   anon NO— y que el candado de negocio muerda. Ninguna escritura toca datos
   reales.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado fuera
   del proyecto. */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {PGlite} = createRequire((process.env.PGLITE_DIR || '/tmp/etaax-billing-sql') + '/test.cjs')('@electric-sql/pglite');
const db = new PGlite();
let cuenta = 0;
const ok = async (nombre, fn) => { await fn(); cuenta++; console.log('PASA ' + nombre); };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const falla = async (fn, patron) => {
    let e = null;
    try { await fn(); } catch (x) { e = x; }
    assert.ok(e, 'no falló y debía fallar');
    if (patron) assert.match(String(e.message), patron);
};

/* ── El mundo mínimo que la v85 da por existente ───────────────────────── */
await db.exec(`
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE negocios (id TEXT PRIMARY KEY, usuario_id UUID);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('req.uid', true), '')::uuid $$;
  CREATE FUNCTION es_staff_de(p TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS
    $$ SELECT current_setting('req.staff_de', true) = p $$;
  CREATE FUNCTION is_platform_admin() RETURNS BOOLEAN LANGUAGE sql STABLE AS
    $$ SELECT current_setting('req.admin', true) = '1' $$;
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  INSERT INTO negocios VALUES ('n1','11111111-1111-1111-1111-111111111111'),
                              ('n2','22222222-2222-2222-2222-222222222222');
`);

/* ── Se corre el archivo TAL CUAL ──────────────────────────────────────── */
await db.exec(fs.readFileSync('supabase-migration-v85.sql', 'utf8'));
await db.exec(`GRANT ALL ON nomina_recibos TO anon, authenticated;
                GRANT SELECT ON negocios TO anon, authenticated;`);

const comoDueno = (n) => db.exec(
    `SET ROLE authenticated; SELECT set_config('req.uid','` +
    (n === 'n1' ? '11111111-1111-1111-1111-111111111111' : '22222222-2222-2222-2222-222222222222') +
    `',false); SELECT set_config('req.staff_de','',false); SELECT set_config('req.admin','0',false);`);
const comoStaff = (n) => db.exec(
    `SET ROLE authenticated; SELECT set_config('req.uid','',false);` +
    `SELECT set_config('req.staff_de','${n}',false); SELECT set_config('req.admin','0',false);`);
const comoAnon = () => db.exec(
    `SET ROLE anon; SELECT set_config('req.uid','',false);` +
    `SELECT set_config('req.staff_de','',false); SELECT set_config('req.admin','0',false);`);
const comoDios = () => db.exec(`RESET ROLE;`);

const RECIBO = JSON.stringify({ staffId:'s1', sucursalId:'suc_principal', desde:'2026-11-01',
    hasta:'2026-11-07', recibo:{ folio:'N-1', total:2100 }, gastoId:'', pagadoEn:'' });

await ok('la tabla existe con el patrón de siempre', async () => {
    const cols = (await q(`SELECT column_name FROM information_schema.columns
                            WHERE table_name='nomina_recibos' ORDER BY 1`)).map(r => r.column_name);
    assert.deepEqual(cols, ['created_at','datos','id','negocio_id','updated_at']);
});

await ok('el dueño guarda y lee los suyos', async () => {
    await comoDueno('n1');
    await q(`INSERT INTO nomina_recibos (id,negocio_id,datos) VALUES ('r1','n1',$1::jsonb)`, [RECIBO]);
    const r = await q(`SELECT datos->>'staffId' AS s FROM nomina_recibos WHERE id='r1'`);
    assert.equal(r.length, 1); assert.equal(r[0].s, 's1');
});

/* El colaborador TIENE que poder: quien paga nóminas suele entrar con cuenta
   de staff, y sin esta puerta el selector le saldría vacío. Así se perdieron
   los horarios en la v19. */
await ok('el colaborador del negocio también lee y escribe', async () => {
    await comoStaff('n1');
    assert.equal((await q(`SELECT 1 FROM nomina_recibos WHERE id='r1'`)).length, 1);
    await q(`INSERT INTO nomina_recibos (id,negocio_id,datos) VALUES ('r2','n1',$1::jsonb)`, [RECIBO]);
});

await ok('otro negocio NO ve los recibos ajenos', async () => {
    await comoDueno('n2');
    assert.equal((await q(`SELECT 1 FROM nomina_recibos WHERE id='r1'`)).length, 0);
});
await ok('…ni puede escribir en el negocio ajeno', async () => {
    await comoDueno('n2');
    await falla(() => q(`INSERT INTO nomina_recibos (id,negocio_id,datos) VALUES ('rx','n1',$1::jsonb)`, [RECIBO]),
                /row-level security/i);
});
/* El colaborador de OTRO negocio tampoco: `es_staff_de` es por negocio. */
await ok('el colaborador de otro negocio tampoco entra', async () => {
    await comoStaff('n2');
    assert.equal((await q(`SELECT 1 FROM nomina_recibos WHERE id='r1'`)).length, 0);
});

/* anon es la puerta de la calle: el QR y la carta pública usan ese rol. Los
   sueldos no se asoman ahí ni por error. */
await ok('anon no ve ni un recibo', async () => {
    await comoAnon();
    assert.equal((await q(`SELECT 1 FROM nomina_recibos`)).length, 0);
});
await ok('…ni puede meter uno', async () => {
    await comoAnon();
    await falla(() => q(`INSERT INTO nomina_recibos (id,negocio_id,datos) VALUES ('ra','n1',$1::jsonb)`, [RECIBO]),
                /row-level security/i);
});

await ok('el admin de plataforma pasa por encima', async () => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('req.uid','',false);
                   SELECT set_config('req.staff_de','',false); SELECT set_config('req.admin','1',false);`);
    assert.ok((await q(`SELECT 1 FROM nomina_recibos WHERE id='r1'`)).length === 1);
});

/* Mudar un recibo de negocio sería mudarle el sueldo de una persona a otra
   empresa. El trigger lo impide aunque la fila sea propia. */
await ok('un recibo no puede cambiar de negocio', async () => {
    await comoDios();
    await falla(() => q(`UPDATE nomina_recibos SET negocio_id='n2' WHERE id='r1'`),
                /no puede cambiar de negocio/);
});

await ok('updated_at se sella solo al editar', async () => {
    await comoDios();
    const antes = (await q(`SELECT updated_at FROM nomina_recibos WHERE id='r1'`))[0].updated_at;
    await new Promise(r => setTimeout(r, 15));
    await q(`UPDATE nomina_recibos SET datos = datos || '{"gastoId":"g1"}'::jsonb WHERE id='r1'`);
    const dsp = (await q(`SELECT updated_at FROM nomina_recibos WHERE id='r1'`))[0].updated_at;
    assert.ok(new Date(dsp) > new Date(antes), 'no se selló');
});

await ok('borrar el negocio se lleva sus recibos', async () => {
    await comoDios();
    await q(`DELETE FROM negocios WHERE id='n1'`);
    assert.equal((await q(`SELECT 1 FROM nomina_recibos WHERE negocio_id='n1'`)).length, 0);
});

/* Correrla dos veces no puede tronar ni duplicar nada: Edwin la pega en el
   SQL Editor y a veces la pega otra vez. */
await ok('la migración es idempotente', async () => {
    await comoDios();
    await db.exec(fs.readFileSync('supabase-migration-v85.sql', 'utf8'));
    const t = await q(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='nomina_recibos_guardia'`);
    assert.equal(t[0].n, 1);
    const p = await q(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename='nomina_recibos'`);
    assert.equal(p[0].n, 3);
});

console.log('SQL v85: ' + cuenta + ' casos, 0 fallas');
