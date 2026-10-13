/* ============================================================================
   ETAAX — la migración v77, corrida contra un Postgres DE VERDAD

   Por qué existe: las migraciones se corren a mano en Supabase, y cuando una
   trae un error de sintaxis o una cuenta mal, el que lo descubre es Edwin
   pegándola en producción. Dos veces ya. Esto la corre antes, completa, contra
   PGlite —Postgres compilado a WASM— sobre un esquema mínimo que imita
   producción: las tablas que la v77 da por hechas, el freno de la v30, los
   roles `anon` y `authenticated`, y `auth.uid()`/`auth.jwt()` de mentira para
   poder "entrar" como quien se quiera.

   Lo que prueba, en este orden:
     1. LOS TRES AGUJEROS, PROVOCADOS, con las definiciones que hay hoy en
        producción. Si alguno no se puede provocar, el agujero no era ese y la
        migración sobra.
     2. La migración, TAL CUAL el archivo, de principio a fin.
     3. Los mismos tres ataques, ahora rebotando — y, lo que más importa, que la
        colaboradora activa siga entrando y recibiendo su llave.

   NO está en el hook de pre-push: necesita una dependencia de npm y este
   proyecto no tiene package.json a propósito. Se corre a mano:

       mkdir -p /tmp/pglite && cd /tmp/pglite && npm init -y
       npm install @electric-sql/pglite
       NODE_PATH=/tmp/pglite/node_modules node <ruta>/tests/probar-sql-v77.mjs

   La RAIZ está fija abajo: cámbiela si el repo vive en otro lugar.
   ============================================================================ */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const RAIZ = '/Users/macbookpro/Proyectos/etaax.com-004-2/';
const db = new PGlite();
let fallas = 0;
const ok = (c, q) => { console.log((c ? '  ✅ ' : '  ❌ ') + q); if (!c) fallas++; };

/* ── El mundo mínimo: lo que v77 da por existente ─────────────────────────── */
await db.exec(`
CREATE SCHEMA IF NOT EXISTS auth;
-- auth.uid()/auth.jwt() de mentira, manejadas con un ajuste de sesión para
-- poder "entrar" como quien se quiera.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('prueba.uid', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('email', coalesce(current_setting('prueba.email', true), '')) $$;

CREATE TABLE negocios (id TEXT PRIMARY KEY, datos JSONB, staff_cred JSONB);
CREATE TABLE staff (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
CREATE TABLE login_intentos (clave TEXT PRIMARY KEY, intentos INT NOT NULL DEFAULT 0,
                             ventana_inicio TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE login_puerta (id BIGSERIAL PRIMARY KEY, ident TEXT NOT NULL, ip TEXT,
                           creado TIMESTAMPTZ NOT NULL DEFAULT now());

-- El freno de la v30, tal cual
CREATE FUNCTION _login_golpe(p_clave TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE r login_intentos;
BEGIN
    SELECT * INTO r FROM login_intentos WHERE clave = p_clave FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO login_intentos (clave, intentos, ventana_inicio) VALUES (p_clave, 1, now())
        ON CONFLICT (clave) DO UPDATE SET intentos = login_intentos.intentos + 1;
        RETURN TRUE;
    END IF;
    IF r.ventana_inicio < now() - interval '15 minutes' THEN
        UPDATE login_intentos SET intentos = 1, ventana_inicio = now() WHERE clave = p_clave;
        RETURN TRUE;
    END IF;
    UPDATE login_intentos SET intentos = r.intentos + 1 WHERE clave = p_clave;
    RETURN r.intentos < 10;
END; $$;
CREATE FUNCTION _login_exito(p_clave TEXT) RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM login_intentos WHERE clave = p_clave $$;

-- Los roles que Supabase trae de fábrica
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;

-- Las definiciones ANTERIORES (v63/v30/v56), para poder ver el agujero y luego
-- verlo cerrado. Son las que están hoy en producción.
CREATE FUNCTION staff_login(p_usuario TEXT, p_hash TEXT)
RETURNS TABLE (negocio_id TEXT, negocio_datos JSONB, staff_id TEXT, nombre TEXT, rol TEXT, sucursal_id TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT s.negocio_id, n.datos, s.id, s.datos->>'nombre',
           COALESCE(NULLIF(s.datos->>'rol',''), 'otro'), NULLIF(s.datos->>'sucursalId','')
    FROM staff s JOIN negocios n ON n.id = s.negocio_id
    WHERE s.datos->>'usuario' = p_usuario AND s.datos->>'passwordHash' = p_hash
      AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
      AND p_hash IS NOT NULL AND length(p_hash) > 0 LIMIT 1; $$;

CREATE FUNCTION obtener_staff_cred(p_neg TEXT, p_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave TEXT := 'cred|' || coalesce(p_neg, ''); v_cred JSONB;
BEGIN
    IF p_neg IS NULL OR p_hash IS NULL OR length(p_hash) = 0 THEN RETURN NULL; END IF;
    IF NOT _login_golpe(v_clave) THEN RAISE EXCEPTION 'rate_limited'; END IF;
    SELECT n.staff_cred INTO v_cred FROM negocios n
    WHERE n.id = p_neg AND n.staff_cred IS NOT NULL
      AND EXISTS (SELECT 1 FROM staff s WHERE s.negocio_id = p_neg AND s.datos->>'passwordHash' = p_hash);
    IF v_cred IS NOT NULL THEN PERFORM _login_exito(v_clave); END IF;
    RETURN v_cred;
END; $$;

CREATE FUNCTION login_exito(p_ident TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM login_puerta WHERE ident = md5(lower(trim(coalesce(p_ident, ''))));
END; $$;
GRANT EXECUTE ON FUNCTION login_exito(TEXT) TO anon, authenticated;

-- Datos: un negocio, una activa, uno dado de baja (con el MISMO negocio).
INSERT INTO negocios (id, datos, staff_cred) VALUES
    ('neg1', '{"nombre":"Rincón"}', '{"email":"staff.neg1@etaax.app","password":"secreto"}');
INSERT INTO staff (id, negocio_id, datos) VALUES
    ('s1','neg1','{"usuario":"ana","passwordHash":"v2$ana","nombre":"Ana","rol":"gerente","estado":"Activo"}'),
    ('s2','neg1','{"usuario":"beto","passwordHash":"v2$beto","nombre":"Beto","rol":"chef","estado":"Baja"}'),
    ('s3','neg1','{"usuario":"caro","passwordHash":"v2$caro","nombre":"Caro","rol":"otro"}');
`);

const uno = async (sql, params) => (await db.query(sql, params)).rows;
const intentar = async (sql, params) => { try { return { rows: await uno(sql, params) }; }
                                          catch (e) { return { error: e.message }; } };

/* ── CÓMO ESTÁ HOY (antes de v77): los tres agujeros, demostrados ─────────── */
console.log('\n══ ANTES de la v77 — los agujeros, provocados ══');
{
    let frenó = 0;
    for (let i = 1; i <= 15; i++) {
        const r = await intentar(`SELECT * FROM staff_login('ana', 'contraseña-mala-${i}')`);
        if (r.error && /rate_limited/.test(r.error)) { frenó = i; break; }
    }
    ok(frenó === 0, 'staff_login NO frena: 15 contraseñas seguidas y ninguna queja');

    const cred = await uno(`SELECT obtener_staff_cred('neg1', 'v2$beto') AS c`);
    ok(cred[0].c !== null, 'el dado de baja SÍ consigue la llave compartida');

    await db.exec(`INSERT INTO login_puerta (ident) SELECT md5('victima@x.com') FROM generate_series(1,8)`);
    await uno(`SELECT login_exito('victima@x.com')`);
    const q = await uno(`SELECT count(*)::int AS n FROM login_puerta WHERE ident = md5('victima@x.com')`);
    ok(q[0].n === 0, 'cualquiera borra el contador de otro (sin sesión siquiera)');
}

/* ── Se corre la migración TAL CUAL, archivo incluido ─────────────────────── */
console.log('\n══ Corriendo supabase-migration-v77.sql ══');
const sql = fs.readFileSync(RAIZ + 'supabase-migration-v77.sql', 'utf8');
let tabla = null;
try {
    const res = await db.exec(sql);
    tabla = res[res.length - 1];
    ok(true, 'la migración corre sin errores de sintaxis');
} catch (e) {
    ok(false, 'la migración FALLÓ: ' + e.message);
    console.log('\n🚨 ' + fallas + ' falla(s)');
    process.exit(1);
}
console.log('\n  Tabla de comprobación que verá Edwin:');
for (const r of (tabla.rows || [])) console.log('   ', JSON.stringify(r));
ok((tabla.rows || []).length === 6, 'la última instrucción devuelve los 6 renglones');
ok((tabla.rows || []).every(r => r.resultado !== 'FALLA'), '…y ninguno dice FALLA');

/* ── DESPUÉS: los mismos tres ataques, ahora cerrados ─────────────────────── */
console.log('\n══ DESPUÉS de la v77 — los mismos ataques ══');
{
    await db.exec(`DELETE FROM login_intentos; DELETE FROM login_puerta;`);
    let frenó = 0;
    for (let i = 1; i <= 15; i++) {
        const r = await intentar(`SELECT * FROM staff_login('ana', 'contraseña-mala-${i}')`);
        if (r.error && /rate_limited/.test(r.error)) { frenó = i; break; }
    }
    ok(frenó === 11, 'staff_login frena en el intento 11 (diez por ventana) — frenó en ' + frenó);

    // Y la persona legítima sigue entrando, que es lo que no se puede romper.
    await db.exec(`DELETE FROM login_intentos;`);
    const ana = await uno(`SELECT * FROM staff_login('ana', 'v2$ana')`);
    ok(ana.length === 1 && ana[0].nombre === 'Ana', 'la colaboradora activa entra igual que siempre');
    ok(ana.length === 1 && ana[0].negocio_datos.nombre === 'Rincón', '…y recibe los datos de su negocio');

    const caro = await uno(`SELECT * FROM staff_login('caro', 'v2$caro')`);
    ok(caro.length === 1, 'quien no tiene el campo `estado` entra (viejos = activos)');

    const beto = await uno(`SELECT * FROM staff_login('beto', 'v2$beto')`);
    ok(beto.length === 0, 'el dado de baja no entra por la puerta de enfrente');

    const credB = await uno(`SELECT obtener_staff_cred('neg1', 'v2$beto') AS c`);
    ok(credB[0].c === null, 'el dado de baja YA NO consigue la llave compartida');

    const credA = await uno(`SELECT obtener_staff_cred('neg1', 'v2$ana') AS c`);
    ok(credA[0].c && credA[0].c.email === 'staff.neg1@etaax.app', 'la activa sí la consigue (no se rompió el acceso)');

    // El contador de la puerta: entrar bien lo borra, desde el servidor.
    await db.exec(`DELETE FROM login_intentos;
                   INSERT INTO login_puerta (ident) SELECT md5('ana') FROM generate_series(1,6)`);
    await uno(`SELECT * FROM staff_login('ana', 'v2$ana')`);
    const pa = await uno(`SELECT count(*)::int AS n FROM login_puerta WHERE ident = md5('ana')`);
    ok(pa[0].n === 0, 'entrar bien borra el contador de la puerta (lo hace el servidor)');

    // login_exito sin sesión: no borra nada.
    await db.exec(`INSERT INTO login_puerta (ident) SELECT md5('victima@x.com') FROM generate_series(1,8)`);
    await db.exec(`SELECT set_config('prueba.uid', '', false); SELECT set_config('prueba.email', '', false);`);
    await uno(`SELECT login_exito('victima@x.com')`);
    let v = await uno(`SELECT count(*)::int AS n FROM login_puerta WHERE ident = md5('victima@x.com')`);
    ok(v[0].n === 8, 'sin sesión, login_exito no borra nada');

    // Con sesión, pero de OTRO: tampoco.
    await db.exec(`SELECT set_config('prueba.uid', '11111111-1111-1111-1111-111111111111', false);
                   SELECT set_config('prueba.email', 'atacante@x.com', false);`);
    await uno(`SELECT login_exito('victima@x.com')`);
    v = await uno(`SELECT count(*)::int AS n FROM login_puerta WHERE ident = md5('victima@x.com')`);
    ok(v[0].n === 8, 'con sesión ajena, login_exito tampoco borra el contador de la víctima');

    // Y el dueño sí borra el suyo, que es para lo que existe.
    await db.exec(`SELECT set_config('prueba.email', 'victima@x.com', false);`);
    await uno(`SELECT login_exito('victima@x.com')`);
    v = await uno(`SELECT count(*)::int AS n FROM login_puerta WHERE ident = md5('victima@x.com')`);
    ok(v[0].n === 0, 'el dueño de la cuenta sí borra el suyo (el login no se rompió)');

    // Mayúsculas y espacios: el cliente manda el correo tal cual lo teclean.
    await db.exec(`INSERT INTO login_puerta (ident) SELECT md5('victima@x.com') FROM generate_series(1,3)`);
    await uno(`SELECT login_exito('  VICTIMA@X.com ')`);
    v = await uno(`SELECT count(*)::int AS n FROM login_puerta WHERE ident = md5('victima@x.com')`);
    ok(v[0].n === 0, '…aunque lo teclee con mayúsculas y espacios');

    const priv = await uno(`SELECT has_function_privilege('anon','login_exito(text)','EXECUTE') AS a,
                                   has_function_privilege('authenticated','login_exito(text)','EXECUTE') AS s,
                                   has_function_privilege('anon','obtener_staff_cred(text,text)','EXECUTE') AS c,
                                   has_function_privilege('anon','_v77_probar_freno()','EXECUTE') AS p`);
    ok(priv[0].a === false, 'anon ya no puede llamar login_exito');
    ok(priv[0].s === true,  '…y quien tiene sesión sí (el dueño al entrar)');
    ok(priv[0].c === true,  'obtener_staff_cred sigue abierta a anon (la pide sin sesión, a propósito)');
    ok(priv[0].p === false, 'la sonda de la comprobación no la puede llamar nadie');
}

console.log(fallas ? '\n🚨 ' + fallas + ' falla(s)' : '\n🔒 v77 OK — todo verificado contra Postgres de verdad');
process.exit(fallas ? 1 : 0);
