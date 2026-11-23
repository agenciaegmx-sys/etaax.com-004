/* STAFF ETAAX (v88) — contra un Postgres DE VERDAD (PGlite) y con RLS de
   verdad: las consultas corren con el rol `authenticated` (o `anon`), no como
   superusuario, así que las políticas mandan igual que en Supabase.

   Lo que se vigila:
     · con acceso a un negocio entra a sus tablas (las políticas «staff_acceso»
       de siempre, sin tocarlas) y a NINGUNA otra;
     · desactivar a la persona o el acceso lo corta en la siguiente consulta;
     · la tabla `negocios` no se le abre (trae staff_cred): la portada va por
       etx_mis_negocios(), que no la incluye;
     · no puede darse accesos a sí mismo;
     · el dueño y la cuenta de colaboradores siguen igual;
     · contraseñas y bajas: solo el admin y solo cuentas @staff.etaax.app.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado fuera
   del proyecto. */
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

const U = {
    duenoA: '00000000-0000-0000-0000-00000000000a',
    duenoB: '00000000-0000-0000-0000-00000000000b',
    colabA: '00000000-0000-0000-0000-0000000000ca',   // la cuenta de colaboradores de A
    ana:    '00000000-0000-0000-0000-0000000000e1',   // Staff ETAAX con acceso a A
    beto:   '00000000-0000-0000-0000-0000000000e2',   // Staff ETAAX sin accesos
};

const db = new PGlite();
const q = async (sql, args) => (await db.query(sql, args)).rows;
await db.exec(`
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE SCHEMA IF NOT EXISTS extensions;
  GRANT USAGE ON SCHEMA auth, extensions TO authenticated, anon;
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('req.uid', true), '')::uuid $$;
  CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('email', NULLIF(current_setting('req.email', true), '')) $$;
  CREATE FUNCTION is_platform_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT coalesce(current_setting('req.admin', true), '') = '1' $$;
  -- pgcrypto de mentira: basta con ver que la contraseña cambió y por cuál.
  CREATE FUNCTION extensions.gen_salt(TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT 'sal' $$;
  CREATE FUNCTION extensions.crypt(TEXT, TEXT) RETURNS TEXT LANGUAGE sql AS $$ SELECT 'h(' || $1 || ')' $$;
  CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, encrypted_password TEXT, email_confirmed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);

  CREATE TABLE negocios (id TEXT PRIMARY KEY, usuario_id UUID, staff_uid UUID, staff_cred JSONB, datos JSONB DEFAULT '{}');
  CREATE TABLE cortes (id TEXT PRIMARY KEY, negocio_id TEXT REFERENCES negocios(id), datos JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE accesos_log (id TEXT PRIMARY KEY, negocio_id TEXT, usuario TEXT, tipo TEXT, agente TEXT, detalle TEXT, creado TIMESTAMPTZ);

  -- Lo que ya hay en producción (v3/v19): dueño, admin y la cuenta de colaboradores.
  CREATE FUNCTION es_staff_de(neg_id TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM negocios WHERE id = neg_id AND staff_uid IS NOT NULL AND staff_uid = auth.uid()) $$;
  ALTER TABLE negocios ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "own" ON negocios FOR ALL USING (usuario_id = auth.uid());
  CREATE POLICY "admin_all" ON negocios FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
  CREATE POLICY "staff_lee" ON negocios FOR SELECT USING (staff_uid IS NOT NULL AND staff_uid = auth.uid());
  ALTER TABLE cortes ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "own" ON cortes FOR ALL USING (EXISTS (SELECT 1 FROM negocios n WHERE n.id = negocio_id AND n.usuario_id = auth.uid()));
  CREATE POLICY "admin_all" ON cortes FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
  CREATE POLICY "staff_acceso" ON cortes FOR ALL USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id));
  GRANT SELECT, INSERT, UPDATE, DELETE ON negocios, cortes TO authenticated, anon;
`);
await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v88.sql'), 'utf8'));
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON etaax_staff, etaax_staff_accesos TO authenticated, anon;`);

// Siembra (como superusuario).
await q(`INSERT INTO negocios (id, usuario_id, staff_uid, staff_cred, datos) VALUES
    ('A', $1, $3, '{"email":"staff.a@etaax.app","password":"SECRETA"}', '{"nombre":"EGMx","emoji":"🍸"}'),
    ('B', $2, NULL, NULL, '{"nombre":"Miami SA"}')`, [U.duenoA, U.duenoB, U.colabA]);
await q(`INSERT INTO cortes (id, negocio_id, datos) VALUES ('a1','A','{}'), ('a2','A','{"sucursalId":"suc_mia"}'), ('b1','B','{}')`);
await q(`INSERT INTO auth.users (id, email, encrypted_password) VALUES
    ($1, 'ana@staff.etaax.app', 'vieja'), ($2, 'beto@staff.etaax.app', 'vieja'), ($3, 'dueno.a@correo.mx', 'del-dueno')`,
    [U.ana, U.beto, U.duenoA]);
await q(`INSERT INTO etaax_staff (uid, usuario, datos) VALUES ($1, 'ana', '{"nombre":"Ana Auditora"}'), ($2, 'beto', '{"nombre":"Beto"}')`, [U.ana, U.beto]);
await q(`INSERT INTO etaax_staff_accesos (uid, negocio_id, datos) VALUES ($1, 'A', '{"sucursales":["suc_mia"],"permisos":{"inventarios":true}}')`, [U.ana]);

// Corre una consulta COMO alguien: rol de Supabase + su uid (+ admin).
async function como(quien, sql, args, { rol = 'authenticated', admin = false, email = '' } = {}) {
    await db.exec('RESET ROLE');
    await q(`SELECT set_config('req.uid', $1, false), set_config('req.admin', $2, false), set_config('req.email', $3, false)`,
        [quien || '', admin ? '1' : '0', email]);
    await db.exec('SET ROLE ' + rol);
    try { return await q(sql, args); } finally { await db.exec('RESET ROLE'); }
}
const ids = (rows) => rows.map(r => r.id).sort().join(',');

/* ══ 1) La puerta: el negocio con acceso, y ningún otro ══ */
await ok('con acceso a A ve los cortes de A (todas sus sucursales: la frontera es el negocio) y ninguno de B', async () =>
    assert.equal(ids(await como(U.ana, 'SELECT id FROM cortes')), 'a1,a2'));
await ok('…puede escribir en A', async () => {
    await como(U.ana, `INSERT INTO cortes (id, negocio_id, datos) VALUES ('a3', 'A', '{}')`);
    assert.equal((await q(`SELECT count(*)::int AS n FROM cortes WHERE id = 'a3'`))[0].n, 1);
});
await ok('…y NO en B (la política lo rechaza)', () =>
    falla(() => como(U.ana, `INSERT INTO cortes (id, negocio_id, datos) VALUES ('b9', 'B', '{}')`), /row-level security/));
await ok('…ni puede mover un corte de A a B', async () => {
    await falla(() => como(U.ana, `UPDATE cortes SET negocio_id = 'B' WHERE id = 'a1'`), /row-level security/);
});
await ok('sin accesos no ve nada', async () =>
    assert.equal(ids(await como(U.beto, 'SELECT id FROM cortes')), ''));

/* ══ 2) Desactivar corta en la siguiente consulta ══ */
await ok('persona desactivada → nada', async () => {
    await q(`UPDATE etaax_staff SET datos = datos || '{"activo":false}' WHERE uid = $1`, [U.ana]);
    assert.equal(ids(await como(U.ana, 'SELECT id FROM cortes')), '');
    await q(`UPDATE etaax_staff SET datos = datos - 'activo' WHERE uid = $1`, [U.ana]);
    assert.equal(ids(await como(U.ana, 'SELECT id FROM cortes')), 'a1,a2,a3');
});
await ok('acceso desactivado → nada (la persona sigue activa)', async () => {
    await q(`UPDATE etaax_staff_accesos SET datos = datos || '{"activo":false}' WHERE uid = $1`, [U.ana]);
    assert.equal(ids(await como(U.ana, 'SELECT id FROM cortes')), '');
    assert.equal((await como(U.ana, 'SELECT * FROM etx_mis_negocios()')).length, 0);
    await q(`UPDATE etaax_staff_accesos SET datos = datos - 'activo' WHERE uid = $1`, [U.ana]);
});

/* ══ 3) La portada y lo que NO se le abre ══ */
await ok('etx_mis_negocios() trae A con su ficha y su acceso; B no', async () => {
    const r = await como(U.ana, 'SELECT * FROM etx_mis_negocios()');
    assert.deepEqual(r.map(x => x.negocio_id), ['A']);
    assert.equal(r[0].negocio.nombre, 'EGMx');
    assert.deepEqual(r[0].acceso.sucursales, ['suc_mia']);
});
await ok('…sin las credenciales de la cuenta de colaboradores', async () => {
    const r = await como(U.ana, 'SELECT * FROM etx_mis_negocios()');
    assert.equal(JSON.stringify(r).indexOf('SECRETA'), -1);
});
await ok('la tabla negocios no se le abre (staff_cred vive ahí)', async () =>
    assert.equal((await como(U.ana, 'SELECT id FROM negocios')).length, 0));
await ok('lee SU ficha y SUS accesos, no los de otros', async () => {
    assert.deepEqual((await como(U.ana, 'SELECT usuario FROM etaax_staff')).map(r => r.usuario), ['ana']);
    assert.equal((await como(U.beto, 'SELECT * FROM etaax_staff_accesos')).length, 0);
});
await ok('no puede darse un acceso a sí mismo', () =>
    falla(() => como(U.beto, `INSERT INTO etaax_staff_accesos (uid, negocio_id) VALUES ($1, 'B')`, [U.beto]), /row-level security/));
await ok('…ni activarse si lo desactivaron', async () => {
    await q(`UPDATE etaax_staff SET datos = datos || '{"activo":false}' WHERE uid = $1`, [U.beto]);
    await como(U.beto, `UPDATE etaax_staff SET datos = datos - 'activo' WHERE uid = $1`, [U.beto]);   // RLS: 0 filas
    assert.equal((await q(`SELECT datos->>'activo' AS a FROM etaax_staff WHERE uid = $1`, [U.beto]))[0].a, 'false');
    await q(`UPDATE etaax_staff SET datos = datos - 'activo' WHERE uid = $1`, [U.beto]);
});

/* ══ 4) Los de siempre, igual ══ */
await ok('el dueño de A ve lo suyo y nada de B', async () =>
    assert.equal(ids(await como(U.duenoA, 'SELECT id FROM cortes')), 'a1,a2,a3'));
await ok('la cuenta de colaboradores de A sigue entrando a A', async () =>
    assert.equal(ids(await como(U.colabA, 'SELECT id FROM cortes')), 'a1,a2,a3'));
await ok('sin sesión (anon): cero filas y SIN error (es_staff_de sigue llamable por anon)', async () =>
    assert.equal((await como('', 'SELECT id FROM cortes', [], { rol: 'anon' })).length, 0));
await ok('es_staff_de sigue abierta a anon; las nuevas, no', async () => {
    const r = (await q(`SELECT has_function_privilege('anon', 'es_staff_de(text)', 'EXECUTE') AS a,
                               has_function_privilege('anon', 'es_staff_etaax_de(text)', 'EXECUTE') AS b,
                               has_function_privilege('anon', 'etx_mis_negocios()', 'EXECUTE') AS c,
                               has_function_privilege('anon', 'admin_etx_clave(uuid, text)', 'EXECUTE') AS d`))[0];
    assert.deepEqual([r.a, r.b, r.c, r.d], [true, false, false, false]);
});

/* ══ 5) Fotos y evidencias ══ */
await ok('fotos privadas y evidencias: A sí, B no', async () => {
    const r = (await como(U.ana, `SELECT etaax_puede_neg('A') a, etaax_puede_neg('B') b, etaax_negocio_alcanzable('A') c, etaax_negocio_alcanzable('B') d`))[0];
    assert.deepEqual([r.a, r.b, r.c, r.d], [true, false, true, false]);
});
await ok('…y el dueño y el admin, como antes', async () => {
    assert.equal((await como(U.duenoA, `SELECT etaax_puede_neg('A') a`))[0].a, true);
    assert.equal((await como(U.duenoB, `SELECT etaax_puede_neg('A') a`))[0].a, false);
    assert.equal((await como('', `SELECT etaax_puede_neg('B') a`, [], { admin: true }))[0].a, true);
});

/* ══ 6) Contraseñas y bajas ══ */
await ok('cambiar contraseña: solo el admin', () =>
    falla(() => como(U.ana, `SELECT admin_etx_clave($1, 'otraClave123')`, [U.beto]), /Solo el admin/));
await ok('…el admin sí, y confirma el correo', async () => {
    await como('', `SELECT admin_etx_clave($1, 'nuevaClave1')`, [U.beto], { admin: true });
    const r = (await q(`SELECT encrypted_password, email_confirmed_at FROM auth.users WHERE id = $1`, [U.beto]))[0];
    assert.equal(r.encrypted_password, 'h(nuevaClave1)');
    assert.ok(r.email_confirmed_at);
});
await ok('…nunca a una cuenta que no es del Staff ETAAX (un dueño)', async () => {
    await falla(() => como('', `SELECT admin_etx_clave($1, 'robada1234')`, [U.duenoA], { admin: true }), /no es del Staff ETAAX/);
    assert.equal((await q(`SELECT encrypted_password FROM auth.users WHERE id = $1`, [U.duenoA]))[0].encrypted_password, 'del-dueno');
});
await ok('…ni una contraseña corta', () =>
    falla(() => como('', `SELECT admin_etx_clave($1, 'corta')`, [U.beto], { admin: true }), /al menos 8/));
await ok('recuperar la cuenta de Auth por su correo (alta repetida): solo correos del staff', async () => {
    assert.equal((await como('', `SELECT admin_etx_uid('ANA@staff.etaax.app') AS u`, [], { admin: true }))[0].u, U.ana);
    await falla(() => como('', `SELECT admin_etx_uid('dueno.a@correo.mx')`, [], { admin: true }), /no es del Staff ETAAX/);
    await falla(() => como(U.ana, `SELECT admin_etx_uid('ana@staff.etaax.app')`), /Solo el admin/);
});
await ok('la bitácora acepta el tipo staff_etaax y usa el correo del token', async () => {
    await como(U.ana, `SELECT acceso_registrar('A', 'lo-que-sea', 'staff_etaax', 'test')`, [], { email: 'ana@staff.etaax.app' });
    const r = (await q(`SELECT usuario, tipo FROM accesos_log`))[0];
    assert.deepEqual([r.usuario, r.tipo], ['ana@staff.etaax.app', 'staff_etaax']);
});
await ok('baja: solo el admin', () => falla(() => como(U.beto, `SELECT admin_etx_baja($1)`, [U.ana]), /Solo el admin/));
await ok('baja: se va su ficha con sus accesos, su contraseña ya no sirve y no ve nada', async () => {
    await como('', `SELECT admin_etx_baja($1)`, [U.ana], { admin: true });
    assert.equal((await q(`SELECT count(*)::int AS n FROM etaax_staff_accesos WHERE uid = $1`, [U.ana]))[0].n, 0);
    assert.notEqual((await q(`SELECT encrypted_password FROM auth.users WHERE id = $1`, [U.ana]))[0].encrypted_password, 'vieja');
    assert.equal(ids(await como(U.ana, 'SELECT id FROM cortes')), '');
});
await ok('la migración se puede volver a correr', async () => {
    await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v88.sql'), 'utf8'));
    assert.equal((await q(`SELECT count(*)::int AS n FROM etaax_staff`))[0].n, 1);
});

console.log('\nSQL v88: ' + cuenta + ' casos, 0 fallas');
