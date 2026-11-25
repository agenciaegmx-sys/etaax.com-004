/* LA CLAVE ENTRA SOLO SI SU SUCURSAL TIENE LA APP (v93) — contra un Postgres
   DE VERDAD (PGlite), con el guardia REAL de la v79 (copiado de su archivo),
   la v91 y la v92 corridas antes, como en producción.
     · Con el QR de cualquier sucursal activa entra el staff del negocio
       completo… pero solo el de sucursales con la app.
     · Sin sucursal asignada = del negocio entero.
     · Una clave buena sin app NO cuenta como intento fallido.
     · movil_estado trae el nombre y el logo de la sucursal del QR.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {PGlite} = createRequire((process.env.PGLITE_DIR || '/tmp/etaax-billing-sql') + '/test.cjs')('@electric-sql/pglite');

let cuenta = 0;
const ok = async (nombre, fn) => { await fn(); cuenta++; console.log('PASA ' + nombre); };
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
/* Una función tal como la dejó una migración (de su CREATE hasta su $$;). */
const fn = (archivo, nombre) => {
    const s = leer(archivo), i = s.indexOf('CREATE OR REPLACE FUNCTION ' + nombre + '(');
    assert.ok(i > -1, nombre + ' no está en ' + archivo);
    return s.slice(i, s.indexOf('\n$$;', i) + 4);
};
const tokSuc = (tok, suc) => crypto.createHash('sha256').update(tok + '|' + suc, 'utf8').digest('hex').slice(0, 48);

const db = new PGlite();
const q = async (sql, args) => (await db.query(sql, args)).rows;
await db.exec(`
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('req.uid', true), '')::uuid $$;
  CREATE FUNCTION is_platform_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
  CREATE TABLE negocios (id TEXT PRIMARY KEY, usuario_id UUID, staff_uid UUID, entrada_token TEXT, datos JSONB DEFAULT '{}');
  CREATE TABLE staff (id TEXT PRIMARY KEY, negocio_id TEXT REFERENCES negocios(id), datos JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE suscripciones (negocio_id TEXT PRIMARY KEY, estado TEXT, plan JSONB);
  CREATE TABLE horarios (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
  CREATE TABLE evaluaciones (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
  CREATE TABLE negocio_sucursales (negocio_id TEXT PRIMARY KEY, datos JSONB);
  CREATE TABLE login_intentos (clave TEXT PRIMARY KEY, intentos INT NOT NULL DEFAULT 0,
                               ventana_inicio TIMESTAMPTZ NOT NULL DEFAULT now(), ultimo TIMESTAMPTZ);
  CREATE FUNCTION _login_ip() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT '10.0.0.1' $$;
  CREATE FUNCTION es_staff_de(neg_id TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM negocios WHERE id = neg_id AND staff_uid = auth.uid()) $$;
  CREATE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM negocios WHERE id = p_neg AND entrada_token IS NOT NULL AND entrada_token <> '' AND entrada_token = p_token) $$;
  GRANT EXECUTE ON FUNCTION _entrada_token_ok(TEXT, TEXT) TO anon, authenticated;
`);
/* El freno de la clave, como está en producción (v78 + v79). */
await db.exec([fn('supabase-migration-v78.sql', '_nip_espera'), fn('supabase-migration-v78.sql', '_nip_clave'),
               fn('supabase-migration-v79.sql', '_nip_olvidado'), fn('supabase-migration-v79.sql', '_nip_guardia'),
               fn('supabase-migration-v78.sql', 'entrada_validar_nip')].join('\n'));
await db.exec(`GRANT EXECUTE ON FUNCTION entrada_validar_nip(TEXT, TEXT, TEXT) TO anon;`);

await q(`INSERT INTO negocios (id, usuario_id, entrada_token, datos) VALUES
  ('A', '00000000-0000-0000-0000-00000000000a', 'tokA', '{"nombre":"Mammut Pizza","logo":"https://x.supabase.co/neg.png","tipo":"Pizzería"}')`);
await q(`INSERT INTO negocio_sucursales VALUES ('A', $1)`, [JSON.stringify({
    sucursales: [{ id: 'suc_principal', nombre: 'Mammut Pizza Madero' }, { id: 'suc_dos', nombre: 'Mammut Polanco' }],
    cfg: { suc_principal: { giro: 'Pizzería', _logo: 'https://x.supabase.co/madero.png' }, suc_dos: { _logo: 'data:image/png;base64,' + 'A'.repeat(400000) } } })]);
await q(`INSERT INTO staff (id, negocio_id, datos) VALUES
  ('s1', 'A', '{"id":"s1","nombre":"Ana","nipHash":"h1","sucursalId":"suc_dos"}'),
  ('s2', 'A', '{"id":"s2","nombre":"Beto","nipHash":"h2"}'),
  ('s3', 'A', '{"id":"s3","nombre":"Caro","nipHash":"h3","sucursalId":"suc_principal"}'),
  ('s4', 'A', '{"id":"s4","nombre":"Dani","nipHash":"h4","sucursalId":"suc_dos","estado":"Baja"}')`);
for (const v of ['v91', 'v92', 'v93']) await db.exec(leer('supabase-migration-' + v + '.sql'));

async function anon(sql, args) {
    await db.exec('SET ROLE anon');
    try { return await q(sql, args); } finally { await db.exec('RESET ROLE'); }
}
const fijar = (datos) => q(`UPDATE movil_acceso SET datos = $1 WHERE negocio_id = 'A'`, [JSON.stringify(datos)]);
const entra = async (tok, nip) => (await anon(`SELECT entrada_validar_nip('A', $1, $2) AS r`, [tok, nip]))[0].r;
const fallos = async () => ((await q(`SELECT intentos FROM login_intentos`))[0] || { intentos: 0 }).intentos;
const T1 = tokSuc('tokA', 'suc_principal'), T2 = tokSuc('tokA', 'suc_dos');

/* Matriz con app; Polanco sin app. */
await fijar({ sucursales: { suc_principal: true, suc_dos: false } });
await ok('con el QR de Matriz entra el staff de Matriz', async () => assert.equal(await entra(T1, 'h3'), 'Caro'));
await ok('…y el que no tiene sucursal asignada (es del negocio entero)', async () => assert.equal(await entra(T1, 'h2'), 'Beto'));
await ok('…pero NO quien es de una sucursal sin la app (Polanco)', async () => assert.equal(await entra(T1, 'h1'), null));
await ok('…y eso NO cuenta como intento fallido (no es alguien adivinando)', async () => assert.equal(await fallos(), 0));
await ok('una clave equivocada sí se anota, como siempre', async () => {
    assert.equal(await entra(T1, 'zzz'), null);
    assert.equal(await fallos(), 1);
});
await ok('…y acertar después limpia el contador, como siempre', async () => {
    assert.equal(await entra(T1, 'h3'), 'Caro');
    assert.equal(await fallos(), 0);
});
await ok('las consultas de la v91 respetan la misma regla (portal_apps)', async () => {
    assert.equal((await anon(`SELECT portal_apps('A', $1, 'h1') AS r`, [T1]))[0].r, null);
    assert.equal((await anon(`SELECT portal_apps('A', $1, 'h3') AS r`, [T1]))[0].r.sucursalId, 'suc_principal');
});

/* Se activa Polanco: con el QR de CUALQUIER sucursal activa entra el negocio completo. */
await fijar({ sucursales: { suc_principal: true, suc_dos: true } });
await ok('activada Polanco, su gente entra también con el QR de Matriz (el negocio completo)', async () =>
    assert.equal(await entra(T1, 'h1'), 'Ana'));
await ok('…y con el de Polanco entra la de Matriz', async () => assert.equal(await entra(T2, 'h3'), 'Caro'));
await ok('quien está dado de baja sigue sin entrar', async () => assert.equal(await entra(T2, 'h4'), null));

/* Sin ninguna sucursal: nadie, ni el del negocio entero. */
await fijar({ sucursales: { suc_principal: false, suc_dos: false } });
await ok('sin ninguna sucursal con app, nadie entra (tampoco el del negocio entero)', async () => {
    assert.equal(await entra(T1, 'h2'), null);
    assert.equal(await entra('tokA', 'h2'), null);
});

/* movil_estado: la portada pone la sucursal del QR arriba del teclado. */
await fijar({ sucursales: { suc_principal: true, suc_dos: true }, qrAnterior: true });
const estado = async (tok) => (await anon(`SELECT movil_estado('A', $1) AS r`, [tok]))[0].r;
await ok('movil_estado: nombre, giro y logo de la sucursal del QR, y el nombre del negocio', async () =>
    assert.deepEqual(await estado(T1), { activo: true, sucursalId: 'suc_principal', negocio: 'Mammut Pizza', sucursal: 'Mammut Pizza Madero',
                                         giro: 'Pizzería', logo: 'https://x.supabase.co/madero.png' }));
await ok('…un logo demasiado pesado no viaja: cae al del negocio', async () => {
    const r = await estado(T2);
    assert.deepEqual([r.sucursal, r.giro, r.logo], ['Mammut Polanco', 'Pizzería', 'https://x.supabase.co/neg.png']);
});
await ok('…el QR viejo del negocio: sin sucursal, con lo del negocio', async () => {
    const r = await estado('tokA');
    assert.deepEqual([r.activo, r.sucursal, r.negocio, r.logo], [true, null, 'Mammut Pizza', 'https://x.supabase.co/neg.png']);
});
await ok('…y con un token que no abre, nada más que «no»', async () =>
    assert.deepEqual(await estado('x'), { activo: false, sucursalId: null }));

await ok('las piezas internas no se pueden llamar desde la app', async () => {
    const r = await q(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS a FROM pg_proc p
                        WHERE p.proname IN ('_movil_staff_ok','_movil_logo','_nip_guardia','movil_estado') ORDER BY 1`);
    assert.deepEqual(r.map(x => x.proname + ':' + x.a), ['_movil_logo:false', '_movil_staff_ok:false', '_nip_guardia:false', 'movil_estado:true']);
});
await ok('la migración se puede correr dos veces', async () => {
    await db.exec(leer('supabase-migration-v93.sql'));
    assert.equal(await entra(T2, 'h1'), 'Ana');
});

console.log('\n🔒 v93 OK — ' + cuenta + ' comprobaciones contra Postgres');
