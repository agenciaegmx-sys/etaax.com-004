/* LA APP MÓVIL POR MÓDULO (v91) — contra un Postgres DE VERDAD (PGlite), con
   los roles de Supabase: lo que el equipo ve con su NIP.
     · portal_apps: las apps de SU sucursal (o la base del negocio; sin plan =
       paquete completo).
     · portal_horarios: SUS turnos de esta semana y la que sigue, con el mismo
       nombre de semana que Horarios (semana ISO) y nunca el rol de los demás.
     · portal_evaluaciones: las abiertas, sin reclutamiento.
     · Las tres piden token del negocio + NIP de alguien ACTIVO; la app (anon)
       las puede llamar y nada más.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {PGlite} = createRequire((process.env.PGLITE_DIR || '/tmp/etaax-billing-sql') + '/test.cjs')('@electric-sql/pglite');

let cuenta = 0;
const ok = async (nombre, fn) => { await fn(); cuenta++; console.log('PASA ' + nombre); };

const db = new PGlite();
const q = async (sql, args) => (await db.query(sql, args)).rows;
await db.exec(`
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE negocios (id TEXT PRIMARY KEY, usuario_id UUID, entrada_token TEXT, datos JSONB DEFAULT '{}');
  CREATE TABLE staff (id TEXT PRIMARY KEY, negocio_id TEXT REFERENCES negocios(id), datos JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE suscripciones (negocio_id TEXT PRIMARY KEY, estado TEXT, plan JSONB);
  CREATE TABLE horarios (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
  CREATE TABLE evaluaciones (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
  CREATE TABLE negocio_sucursales (negocio_id TEXT PRIMARY KEY, datos JSONB);
  -- Lo que la v91 usa de antes, como está en producción (v27) …
  CREATE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM negocios WHERE id = p_neg AND entrada_token IS NOT NULL AND entrada_token <> '' AND entrada_token = p_token) $$;
  GRANT EXECUTE ON FUNCTION _entrada_token_ok(TEXT, TEXT) TO anon, authenticated;
  -- … y el guardia de intentos (v79) reducido a su veredicto: ¿hay alguien ACTIVO con ese NIP?
  -- El freno de intentos tiene su propia prueba (probar-sql-v78-v79).
  CREATE FUNCTION _nip_guardia(p_neg TEXT, p_niphash TEXT) RETURNS BOOLEAN
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM staff s WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash
                       AND COALESCE(NULLIF(s.datos->>'estado',''),'Activo') = 'Activo') $$;
  REVOKE ALL ON FUNCTION _nip_guardia(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
`);
await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v91.sql'), 'utf8'));

/* Semana ISO como la nombra Horarios (EtaaxCore.getWeekStr), con la fecha de México. */
const core = {}; (new Function('window', fs.readFileSync(path.join(RAIZ, 'etaax-core.js'), 'utf8')))(core);
const hoyMx = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
const semana = (d) => core.EtaaxCore.getWeekStr(d);
const enDias = (n) => { const d = new Date(hoyMx); d.setDate(d.getDate() + n); return d; };
const SEM0 = semana(hoyMx), SEM1 = semana(enDias(7));

await q(`INSERT INTO negocios (id, entrada_token) VALUES ('A', 'tokA'), ('B', 'tokB')`);
await q(`INSERT INTO staff (id, negocio_id, datos) VALUES
  ('s1', 'A', '{"id":"s1","nombre":"Ana","nipHash":"h1","sucursalId":"suc_dos"}'),
  ('s2', 'A', '{"id":"s2","nombre":"Beto","nipHash":"h2"}'),
  ('s3', 'A', '{"id":"s3","nombre":"Caro","nipHash":"h3","estado":"Baja"}'),
  ('s9', 'B', '{"id":"s9","nombre":"Otro","nipHash":"h9"}')`);
await q(`INSERT INTO negocio_sucursales VALUES ('A', '{"sucursales":[{"id":"suc_principal","nombre":"Matriz"},{"id":"suc_dos","nombre":"Polanco"}]}')`);
await q(`INSERT INTO horarios VALUES
  ('h_a', 'A', $1), ('h_b', 'A', $2), ('h_c', 'A', $3), ('h_viejo', 'A', $4)`, [
  JSON.stringify({ sucursalId: 'suc_dos', semana: SEM0, turnos: { s1: { d0: { in: '09:00', out: '17:00' }, d1: { desc: 1 } }, s2: { d0: { in: '12:00', out: '20:00' } } } }),
  JSON.stringify({ sucursalId: 'suc_principal', semana: SEM0, turnos: { s1: { d5: { in: '18:00', out: '23:00' } } } }),   // prestada a Matriz el sábado
  JSON.stringify({ sucursalId: 'suc_dos', semana: SEM1, turnos: { s1: { d2: { in: '10:00', out: '18:00' } } } }),
  JSON.stringify({ sucursalId: 'suc_dos', semana: '2020-W01', turnos: { s1: { d0: { in: '07:00', out: '15:00' } } } })]);
await q(`INSERT INTO evaluaciones VALUES
  ('e1', 'A', '{"titulo":"Barra nivel 1","categoria":"operativas","token":"t-e1","activa":true,"preguntas":[{},{},{}]}'),
  ('e2', 'A', '{"titulo":"Vacante mesero","categoria":"reclutamiento","token":"t-e2","activa":true}'),
  ('e3', 'A', '{"titulo":"Borrador","categoria":"operativas","token":"t-e3","activa":false}'),
  ('e9', 'B', '{"titulo":"De otro negocio","categoria":"operativas","token":"t-e9","activa":true}')`);

/* Como la app: sin sesión (anon). */
async function app(fn, neg, tok, nip) {
    await db.exec('SET ROLE anon');
    try { return (await q(`SELECT ${fn}($1, $2, $3) AS r`, [neg, tok, nip]))[0].r; } finally { await db.exec('RESET ROLE'); }
}

/* ── portal_apps ── */
await ok('sin plan: apps NULL (= paquete completo, como los negocios de antes)', async () => {
    const r = await app('portal_apps', 'A', 'tokA', 'h1');
    assert.deepEqual(r, { sucursalId: 'suc_dos', apps: null });
});
await q(`INSERT INTO suscripciones VALUES ('A', 'activa', '{"base":["costax"],"sucursales":{"suc_dos":["costax","equipax"]}}')`);
await ok('con plan: las apps de SU sucursal (Polanco tiene Cost·ax y Equip·ax)', async () =>
    assert.deepEqual((await app('portal_apps', 'A', 'tokA', 'h1')).apps, ['costax', 'equipax']));
await ok('…y quien no tiene sucursal asignada cae a Matriz y a la base del negocio', async () =>
    assert.deepEqual(await app('portal_apps', 'A', 'tokA', 'h2'), { sucursalId: 'suc_principal', apps: ['costax'] }));

/* ── Los candados, en las tres ── */
for (const fn of ['portal_apps', 'portal_horarios', 'portal_evaluaciones']) {
    await ok(fn + ': NIP equivocado → nada', async () => assert.equal(await app(fn, 'A', 'tokA', 'zzz'), null));
    await ok(fn + ': token de otro negocio → nada', async () => assert.equal(await app(fn, 'A', 'tokB', 'h1'), null));
    await ok(fn + ': colaborador dado de baja → nada', async () => assert.equal(await app(fn, 'A', 'tokA', 'h3'), null));
    await ok(fn + ': el NIP de otro negocio no entra aquí', async () => assert.equal(await app(fn, 'A', 'tokA', 'h9'), null));
}

/* ── portal_horarios ── */
const H = await app('portal_horarios', 'A', 'tokA', 'h1');
await ok('trae esta semana y la que sigue, nombradas como en Horarios', async () =>
    assert.deepEqual(H.semanas.map(s => s.semana), [SEM0, SEM1]));
await ok('cada semana con su lunes (d0 = lunes)', async () => {
    const l = new Date(H.semanas[0].lunes + 'T12:00:00');
    assert.equal(l.getDay(), 1); assert.equal(semana(l), SEM0);
});
await ok('SUS turnos: el de su sucursal y el sábado que la prestaron a Matriz, con nombre', async () => {
    const t = H.semanas[0].turnos.sort((a, b) => a.sucursalId.localeCompare(b.sucursalId));
    assert.deepEqual(t.map(x => [x.sucursal, x.dias]), [
        ['Polanco', { d0: { in: '09:00', out: '17:00' }, d1: { desc: 1 } }],
        ['Matriz', { d5: { in: '18:00', out: '23:00' } }]]);
});
await ok('nunca el rol de los demás: el turno de Beto no viaja con el de Ana', async () =>
    assert.equal(JSON.stringify(H).indexOf('12:00'), -1));
await ok('la semana que sigue también; las viejas no', async () => {
    assert.deepEqual(H.semanas[1].turnos.map(x => x.dias), [{ d2: { in: '10:00', out: '18:00' } }]);
    assert.equal(JSON.stringify(H).indexOf('07:00'), -1);
});
await ok('sin turnos esa semana: la semana viene, vacía (no se inventa nada)', async () =>
    assert.deepEqual((await app('portal_horarios', 'A', 'tokA', 'h2')).semanas[1].turnos, []));

/* ── portal_evaluaciones ── */
await ok('las abiertas del negocio, sin reclutamiento ni borradores ni las de otro negocio', async () => {
    const r = await app('portal_evaluaciones', 'A', 'tokA', 'h2');
    assert.deepEqual(r, [{ titulo: 'Barra nivel 1', categoria: 'operativas', descripcion: '', token: 't-e1', preguntas: 3 }]);
});

/* ── Permisos ── */
await ok('la app puede llamar las tres; la pieza interna (_portal_quien) no', async () => {
    const r = await q(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS puede FROM pg_proc p
                        WHERE p.proname IN ('portal_apps','portal_horarios','portal_evaluaciones','_portal_quien') ORDER BY 1`);
    assert.deepEqual(r.map(x => x.proname + ':' + x.puede), ['_portal_quien:false', 'portal_apps:true', 'portal_evaluaciones:true', 'portal_horarios:true']);
});
await ok('la migración se puede correr dos veces', async () => {
    await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v91.sql'), 'utf8'));
    assert.equal((await app('portal_evaluaciones', 'A', 'tokA', 'h2')).length, 1);
});

console.log('\n🔒 v91 OK — ' + cuenta + ' comprobaciones contra Postgres');
