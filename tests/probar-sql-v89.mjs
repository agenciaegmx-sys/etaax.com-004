/* VENTA POR APPS (v89) — contra un Postgres DE VERDAD (PGlite), con los roles
   de Supabase: quién puede leer el plan de un negocio, y que la invitación le
   pase su plan al negocio que nace (sin tocar la Edge Function).

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado. */
import fs from 'node:fs';
import path from 'node:path';
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
            otro: '00000000-0000-0000-0000-00000000000b', etx: '00000000-0000-0000-0000-0000000000e1' };

const db = new PGlite();
const q = async (sql, args) => (await db.query(sql, args)).rows;
await db.exec(`
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon;
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('req.uid', true), '')::uuid $$;
  CREATE FUNCTION is_platform_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(current_setting('req.admin', true), '') = '1' $$;
  CREATE TABLE negocios (id TEXT PRIMARY KEY, usuario_id UUID, staff_uid UUID, datos JSONB DEFAULT '{}');
  CREATE TABLE suscripciones (negocio_id TEXT PRIMARY KEY REFERENCES negocios(id), estado TEXT NOT NULL DEFAULT 'pendiente', notas TEXT, updated_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE invitaciones (token TEXT PRIMARY KEY, email TEXT NOT NULL, nombre_negocio TEXT NOT NULL, forma_pago TEXT NOT NULL DEFAULT 'stripe',
      notas TEXT, creada_at TIMESTAMPTZ NOT NULL DEFAULT now(), expira_at TIMESTAMPTZ NOT NULL, usada_at TIMESTAMPTZ, negocio_id TEXT, creada_por UUID);
  -- es_staff_de como la deja la v88 (aquí, de mentira: la cuenta de colaboradores o el Staff ETAAX de prueba).
  CREATE FUNCTION es_staff_de(neg_id TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM negocios WHERE id = neg_id AND staff_uid = auth.uid())
          OR (auth.uid() = '00000000-0000-0000-0000-0000000000e1'::uuid AND neg_id = 'A') $$;
`);
await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v89.sql'), 'utf8'));
await q(`INSERT INTO negocios (id, usuario_id, staff_uid) VALUES ('A', $1, $2), ('B', $3, NULL)`, [U.dueno, U.colab, U.otro]);
await q(`INSERT INTO suscripciones (negocio_id, estado, plan) VALUES ('A', 'activa', '{"ciclo":"anual","base":["costax"]}')`);

async function como(quien, sql, args, { admin = false, rol = 'authenticated' } = {}) {
    await db.exec('RESET ROLE');
    await q(`SELECT set_config('req.uid', $1, false), set_config('req.admin', $2, false)`, [quien || '', admin ? '1' : '0']);
    await db.exec('SET ROLE ' + rol);
    try { return await q(sql, args); } finally { await db.exec('RESET ROLE'); }
}
const plan = async (quien, neg, o) => (await como(quien, `SELECT negocio_plan($1) AS p`, [neg], o))[0].p;

await ok('el dueño lee el plan de su negocio', async () => assert.deepEqual(await plan(U.dueno, 'A'), { ciclo: 'anual', base: ['costax'] }));
await ok('…sus colaboradores y el Staff ETAAX con acceso también (la app sabe qué enseñar)', async () => {
    assert.deepEqual((await plan(U.colab, 'A')).base, ['costax']);
    assert.deepEqual((await plan(U.etx, 'A')).base, ['costax']);
});
await ok('…el admin, de cualquiera', async () => assert.equal((await plan('00000000-0000-0000-0000-0000000000ad', 'A', { admin: true })).ciclo, 'anual'));
await ok('otro dueño NO lee el plan ajeno', () => falla(() => plan(U.otro, 'A'), /no autorizado/));
await ok('sin sesión, nada (anon ni siquiera puede llamarla)', () => falla(() => plan('', 'A', { rol: 'anon' }), /permission denied/));
await ok('un negocio sin plan guardado devuelve NULL (= paquete completo)', async () => assert.equal(await plan(U.otro, 'B'), null));

// La invitación: así la usa activar-invitacion (suscripción primero, luego quema la invitación con su negocio).
await q(`INSERT INTO invitaciones (token, email, nombre_negocio, expira_at, plan) VALUES ('tok_aaaaaaaaaaaaaaaaaaaaaaaa', 'x@y.mx', 'Nuevo', now() + interval '3 days', '{"ciclo":"mensual","base":["costax","equipax"]}')`);
await ok('invitacion_ver enseña el plan (para la página de alta)', async () =>
    assert.deepEqual((await como('', `SELECT invitacion_ver('tok_aaaaaaaaaaaaaaaaaaaaaaaa') AS r`, [], {}))[0].r.plan.base, ['costax', 'equipax']));
await q(`INSERT INTO negocios (id, usuario_id) VALUES ('N1', $1)`, [U.otro]);
await q(`INSERT INTO suscripciones (negocio_id, estado, notas) VALUES ('N1', 'pendiente', 'Alta por invitación')`);
await q(`UPDATE invitaciones SET usada_at = now(), negocio_id = 'N1' WHERE token = 'tok_aaaaaaaaaaaaaaaaaaaaaaaa'`);
await ok('al usarse la invitación, el negocio nuevo nace con su plan (y sigue pendiente de pago)', async () => {
    const s = (await q(`SELECT estado, plan, notas FROM suscripciones WHERE negocio_id = 'N1'`))[0];
    assert.deepEqual([s.estado, s.plan.base, s.notas], ['pendiente', ['costax', 'equipax'], 'Alta por invitación']);
});
await ok('…y si la suscripción todavía no existía, la crea', async () => {
    await q(`INSERT INTO negocios (id) VALUES ('N2')`);
    await q(`INSERT INTO invitaciones (token, email, nombre_negocio, expira_at, plan) VALUES ('tok_bbbbbbbbbbbbbbbbbbbbbbbb', 'z@y.mx', 'Otro', now() + interval '3 days', '{"base":"suite"}')`);
    await q(`UPDATE invitaciones SET negocio_id = 'N2' WHERE token = 'tok_bbbbbbbbbbbbbbbbbbbbbbbb'`);
    assert.deepEqual((await q(`SELECT estado, plan FROM suscripciones WHERE negocio_id = 'N2'`))[0], { estado: 'pendiente', plan: { base: 'suite' } });
});
await ok('una invitación SIN plan no le pone nada (queda el paquete completo)', async () => {
    await q(`INSERT INTO negocios (id) VALUES ('N3')`);
    await q(`INSERT INTO invitaciones (token, email, nombre_negocio, expira_at) VALUES ('tok_cccccccccccccccccccccccc', 'w@y.mx', 'Sin', now() + interval '3 days')`);
    await q(`UPDATE invitaciones SET negocio_id = 'N3' WHERE token = 'tok_cccccccccccccccccccccccc'`);
    assert.equal((await q(`SELECT count(*)::int AS n FROM suscripciones WHERE negocio_id = 'N3'`))[0].n, 0);
});
await ok('la migración se puede volver a correr', async () => {
    await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v89.sql'), 'utf8'));
    assert.equal((await plan(U.dueno, 'A')).ciclo, 'anual');
});
console.log('\nSQL v89: ' + cuenta + ' casos, 0 fallas');
