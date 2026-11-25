/* LA APP MÓVIL SE ACTIVA POR SUCURSAL (v92) — contra un Postgres DE VERDAD
   (PGlite), con los roles de Supabase.
     · Cada sucursal tiene su token (derivado del secreto del negocio).
     · _entrada_token_ok —la puerta de TODAS las consultas de la clave— acepta
       el de una sucursal ACTIVA, o el viejo del negocio si aún se aceptan los QR
       anteriores. Apagar una sucursal apaga su QR en el servidor.
     · Los negocios que ya usaban el QR quedan como estaban; los nuevos, sin app.
     · movil_acceso: el negocio la lee, solo el admin la escribe.

   Corre la v91 ANTES (como en producción) para comprobar que sus consultas
   quedan detrás de la puerta nueva sin tocarlas.

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
const falla = async (fn, patron) => {
    let e = null;
    try { await fn(); } catch (x) { e = x; }
    assert.ok(e, 'no falló y debía fallar');
    if (patron) assert.match(String(e.message), patron);
};
const U = { dueno: '00000000-0000-0000-0000-00000000000a', colab: '00000000-0000-0000-0000-0000000000ca',
            otro: '00000000-0000-0000-0000-00000000000b', admin: '00000000-0000-0000-0000-0000000000ad' };
/* El token de una sucursal, calculado aparte (la app nunca lo calcula: lo pide). */
const tokSuc = (tok, suc) => crypto.createHash('sha256').update(tok + '|' + suc, 'utf8').digest('hex').slice(0, 48);

const db = new PGlite();
const q = async (sql, args) => (await db.query(sql, args)).rows;
await db.exec(`
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('req.uid', true), '')::uuid $$;
  CREATE FUNCTION is_platform_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(current_setting('req.admin', true), '') = '1' $$;
  CREATE TABLE negocios (id TEXT PRIMARY KEY, usuario_id UUID, staff_uid UUID, entrada_token TEXT, datos JSONB DEFAULT '{}');
  GRANT SELECT ON negocios TO authenticated;
  CREATE TABLE staff (id TEXT PRIMARY KEY, negocio_id TEXT REFERENCES negocios(id), datos JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE suscripciones (negocio_id TEXT PRIMARY KEY, estado TEXT, plan JSONB);
  CREATE TABLE horarios (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
  CREATE TABLE evaluaciones (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
  CREATE TABLE negocio_sucursales (negocio_id TEXT PRIMARY KEY, datos JSONB);
  CREATE FUNCTION es_staff_de(neg_id TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM negocios WHERE id = neg_id AND staff_uid = auth.uid()) $$;
  -- _entrada_token_ok como está en producción (v27) …
  CREATE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM negocios WHERE id = p_neg AND entrada_token IS NOT NULL AND entrada_token <> '' AND entrada_token = p_token) $$;
  GRANT EXECUTE ON FUNCTION _entrada_token_ok(TEXT, TEXT) TO anon, authenticated;
  -- … y el guardia de intentos (v79) reducido a su veredicto.
  CREATE FUNCTION _nip_guardia(p_neg TEXT, p_niphash TEXT) RETURNS BOOLEAN
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM staff s WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash
                       AND COALESCE(NULLIF(s.datos->>'estado',''),'Activo') = 'Activo') $$;
  REVOKE ALL ON FUNCTION _nip_guardia(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
`);

/* Antes de la v92: A usa el QR (token, dos sucursales activas y una dada de
   baja), D también pero sin lista de sucursales, C nunca generó el QR. */
await q(`INSERT INTO negocios (id, usuario_id, staff_uid, entrada_token) VALUES
  ('A', $1, $2, 'tokA'), ('B', $3, NULL, 'tokB'), ('C', $3, NULL, NULL), ('D', $3, NULL, 'tokD')`, [U.dueno, U.colab, U.otro]);
await q(`INSERT INTO negocio_sucursales VALUES
  ('A', '{"sucursales":[{"id":"suc_principal","nombre":"Matriz"},{"id":"suc_dos","nombre":"Polanco"},{"id":"suc_tres","nombre":"Cerrada","activa":false}]}'),
  ('B', '{"sucursales":[{"id":"suc_principal","nombre":"Matriz B"}]}')`);
await q(`INSERT INTO staff (id, negocio_id, datos) VALUES
  ('s1', 'A', '{"id":"s1","nombre":"Ana","nipHash":"h1","sucursalId":"suc_dos"}'),
  ('s9', 'B', '{"id":"s9","nombre":"Otro","nipHash":"h9"}')`);
await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v91.sql'), 'utf8'));

/* La app, sin sesión. */
async function anon(sql, args) {
    await db.exec('SET ROLE anon');
    try { return await q(sql, args); } finally { await db.exec('RESET ROLE'); }
}
const tokOk = async (neg, tok) => (await anon(`SELECT _entrada_token_ok($1, $2) AS r`, [neg, tok]))[0].r;
async function como(quien, sql, args, { admin = false, rol = 'authenticated' } = {}) {
    await db.exec('RESET ROLE');
    await q(`SELECT set_config('req.uid', $1, false), set_config('req.admin', $2, false)`, [quien || '', admin ? '1' : '0']);
    await db.exec('SET ROLE ' + rol);
    try { return await q(sql, args); } finally { await db.exec('RESET ROLE'); }
}
const movilToken = async (quien, neg, suc, o) => (await como(quien, `SELECT movil_token($1, $2) AS r`, [neg, suc], o))[0].r;
const fijar = (neg, datos) => q(`UPDATE movil_acceso SET datos = $2 WHERE negocio_id = $1`, [neg, JSON.stringify(datos)]);

await ok('antes de la v92 el token del negocio abre (punto de partida)', async () => assert.equal(await tokOk('A', 'tokA'), true));

await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v92.sql'), 'utf8'));

/* ── Lo que deja la migración ── */
const fila = async (neg) => ((await q(`SELECT datos FROM movil_acceso WHERE negocio_id = $1`, [neg]))[0] || {}).datos || null;
await ok('quien ya usaba el QR queda con sus sucursales activas (sin la dada de baja) y aceptando los QR viejos', async () =>
    assert.deepEqual(await fila('A'), { sucursales: { suc_principal: true, suc_dos: true }, qrAnterior: true, desde: 'v92' }));
await ok('…sin lista de sucursales, Matriz', async () =>
    assert.deepEqual((await fila('D')).sucursales, { suc_principal: true }));
await ok('el negocio que nunca generó el QR nace SIN app móvil', async () => assert.equal(await fila('C'), null));
await ok('los QR impresos siguen abriendo (no se rompe nada en producción)', async () => assert.equal(await tokOk('A', 'tokA'), true));

/* ── El token de cada sucursal ── */
const TA1 = tokSuc('tokA', 'suc_principal'), TA2 = tokSuc('tokA', 'suc_dos');
await ok('cada sucursal abre con SU token', async () => {
    assert.equal(await tokOk('A', TA1), true);
    assert.equal(await tokOk('A', TA2), true);
});
await ok('el de una sucursal no es el de otra ni el del negocio', async () => {
    assert.notEqual(TA1, TA2); assert.notEqual(TA1, 'tokA'); assert.equal(TA1.length, 48);
});
await ok('el token de una sucursal dada de baja no abre', async () => assert.equal(await tokOk('A', tokSuc('tokA', 'suc_tres')), false));
await ok('el token de una sucursal de OTRO negocio no abre aquí', async () => assert.equal(await tokOk('A', tokSuc('tokB', 'suc_principal')), false));
await ok('nada inventado abre: vacío, nulo, al azar, negocio que no existe', async () => {
    assert.equal(await tokOk('A', ''), false);
    assert.equal(await tokOk('A', null), false);
    assert.equal(await tokOk('A', 'x'.repeat(48)), false);
    assert.equal(await tokOk('ZZ', TA1), false);
});

/* ── Apagar desde el panel ── */
await fijar('A', { sucursales: { suc_principal: true, suc_dos: false }, qrAnterior: true });
await ok('apagar Polanco apaga SU QR; el de Matriz sigue', async () => {
    assert.equal(await tokOk('A', TA2), false);
    assert.equal(await tokOk('A', TA1), true);
});
await fijar('A', { sucursales: { suc_principal: true, suc_dos: true }, qrAnterior: false });
await ok('dejar de aceptar los QR viejos los cierra; los de cada sucursal siguen', async () => {
    assert.equal(await tokOk('A', 'tokA'), false);
    assert.equal(await tokOk('A', TA2), true);
});
await fijar('A', { sucursales: { suc_principal: false, suc_dos: false }, qrAnterior: true });
await ok('sin ninguna sucursal activa no hay app: ni el QR viejo abre', async () => {
    assert.equal(await tokOk('A', 'tokA'), false);
    assert.equal(await tokOk('A', TA1), false);
});
await ok('…y las consultas de la clave (v91) se cierran con ella, sin tocarlas', async () =>
    assert.equal((await anon(`SELECT portal_apps('A', $1, 'h1') AS r`, [TA2]))[0].r, null));
await fijar('A', { sucursales: { suc_principal: true, suc_dos: true }, qrAnterior: true });
await ok('con la sucursal activa, la clave entra con el token de su sucursal', async () =>
    assert.deepEqual((await anon(`SELECT portal_apps('A', $1, 'h1') AS r`, [TA2]))[0].r, { sucursalId: 'suc_dos', apps: null }));

/* ── movil_estado (la app, sin sesión) ── */
const estado = async (neg, tok) => (await anon(`SELECT movil_estado($1, $2) AS r`, [neg, tok]))[0].r;
await ok('movil_estado dice si el enlace abre y de qué sucursal es', async () => {
    assert.deepEqual(await estado('A', TA2), { activo: true, sucursalId: 'suc_dos' });
    assert.deepEqual(await estado('A', 'tokA'), { activo: true, sucursalId: null });
    assert.deepEqual(await estado('A', 'nada'), { activo: false, sucursalId: null });
});

/* ── movil_token (la sesión: hub y app con usuario y contraseña) ── */
await ok('el dueño pide el token de una sucursal activa', async () =>
    assert.deepEqual(await movilToken(U.dueno, 'A', 'suc_dos'), { token: TA2, sucursalId: 'suc_dos' }));
await ok('…sus colaboradores también (la cuenta de colaboradores)', async () =>
    assert.equal((await movilToken(U.colab, 'A', 'suc_principal')).token, TA1));
await ok('…el admin, de cualquiera', async () =>
    assert.equal((await movilToken(U.admin, 'A', 'suc_dos', { admin: true })).token, TA2));
await ok('sin sucursal: Matriz si está activa', async () =>
    assert.equal((await movilToken(U.dueno, 'A', '')).sucursalId, 'suc_principal'));
await fijar('A', { sucursales: { suc_principal: false, suc_dos: true }, qrAnterior: true });
await ok('…si Matriz no la tiene, la primera activa', async () =>
    assert.equal((await movilToken(U.dueno, 'A', null)).sucursalId, 'suc_dos'));
await ok('una sucursal sin app: NULL (el hub no ofrece el QR, la app no abre)', async () =>
    assert.equal(await movilToken(U.dueno, 'A', 'suc_principal'), null));
await ok('otro dueño NO saca el token ajeno', () => falla(() => movilToken(U.otro, 'A', 'suc_dos'), /no autorizado/));
await ok('sin sesión ni siquiera se puede llamar', () => falla(() => movilToken('', 'A', 'suc_dos', { rol: 'anon' }), /permission denied/));
await ok('negocio nuevo que el admin activa: el token se crea al pedirlo', async () => {
    await q(`INSERT INTO movil_acceso (negocio_id, datos) VALUES ('C', '{"sucursales":{"suc_principal":true}}')`);
    const r = await movilToken(U.otro, 'C', '');
    const tokC = (await q(`SELECT entrada_token FROM negocios WHERE id = 'C'`))[0].entrada_token;
    assert.ok(tokC && tokC.length === 64);
    assert.equal(r.token, tokSuc(tokC, 'suc_principal'));
    assert.equal(await tokOk('C', r.token), true);
});
await ok('…y su token del negocio NO abre: nació sin QR viejos que respetar', async () => {
    const tokC = (await q(`SELECT entrada_token FROM negocios WHERE id = 'C'`))[0].entrada_token;
    assert.equal(await tokOk('C', tokC), false);
});

/* ── Quién lee y quién escribe movil_acceso ── */
await ok('el dueño y sus colaboradores la leen; otro dueño no', async () => {
    assert.equal((await como(U.dueno, `SELECT negocio_id FROM movil_acceso WHERE negocio_id = 'A'`)).length, 1);
    assert.equal((await como(U.colab, `SELECT negocio_id FROM movil_acceso WHERE negocio_id = 'A'`)).length, 1);
    assert.equal((await como(U.otro, `SELECT negocio_id FROM movil_acceso WHERE negocio_id = 'A'`)).length, 0);
});
await ok('el dueño NO se la activa solo (solo el admin escribe)', async () => {
    await falla(() => como(U.otro, `INSERT INTO movil_acceso (negocio_id, datos) VALUES ('B', '{"sucursales":{"suc_principal":true}}')`), /row-level security/);
    await como(U.dueno, `UPDATE movil_acceso SET datos = '{"sucursales":{"suc_principal":true,"suc_dos":true}}' WHERE negocio_id = 'A'`);
    assert.deepEqual((await fila('A')).sucursales, { suc_principal: false, suc_dos: true }, 'el UPDATE del dueño no tocó nada');
});
await ok('el admin sí, con el upsert del panel', async () => {
    await como(U.admin, `INSERT INTO movil_acceso (negocio_id, datos) VALUES ('B', '{"sucursales":{"suc_principal":true}}')
                         ON CONFLICT (negocio_id) DO UPDATE SET datos = EXCLUDED.datos`, [], { admin: true });
    assert.equal(await tokOk('B', tokSuc('tokB', 'suc_principal')), true);
});
await ok('sin sesión no se lee', () => falla(() => anon(`SELECT * FROM movil_acceso`), /permission denied/));

/* ── Permisos de las funciones ── */
await ok('la app puede: _entrada_token_ok (la foto del ticket) y movil_estado; las piezas internas no', async () => {
    const r = await q(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
                         FROM pg_proc p WHERE p.proname IN ('_entrada_token_ok','movil_estado','movil_token','_movil_token_suc','_movil_activas','_movil_sucursal_de') ORDER BY 1`);
    assert.deepEqual(r.map(x => x.proname + ':' + x.a + ':' + x.u), [
        '_entrada_token_ok:true:true', '_movil_activas:false:false', '_movil_sucursal_de:false:false',
        '_movil_token_suc:false:false', 'movil_estado:true:true', 'movil_token:false:true']);
});

/* ── Idempotente ── */
await ok('la migración se puede correr dos veces y NO pisa lo que el admin apagó', async () => {
    await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v92.sql'), 'utf8'));
    assert.deepEqual((await fila('A')).sucursales, { suc_principal: false, suc_dos: true });
    assert.equal(await tokOk('A', TA1), false);
});

console.log('\n🔒 v92 OK — ' + cuenta + ' comprobaciones contra Postgres');
