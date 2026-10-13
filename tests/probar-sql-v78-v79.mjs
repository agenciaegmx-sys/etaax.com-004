/* ============================================================================
   ETAAX — el freno de los NIP (v78), corrido contra un Postgres DE VERDAD

   Mismo patrón que probar-sql-v77.mjs: PGlite (Postgres compilado a WASM) con
   un esquema mínimo que imita producción. Primero se PROVOCA el agujero con
   las definiciones que hay hoy, luego se corre la migración tal cual, y luego
   se repite el ataque — comprobando que el uso legítimo del QR sigue vivo.

       mkdir -p /tmp/pglite && cd /tmp/pglite && npm init -y && npm install @electric-sql/pglite
       PGLITE_DIR=/tmp/pglite node tests/probar-sql-v78.mjs

   (NODE_PATH no sirve: los import de ESM lo ignoran.)
   ============================================================================ */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const DIR = process.env.PGLITE_DIR || '/tmp/pglite';
let PGlite;
try {
    PGlite = createRequire(DIR + '/nada.js')('@electric-sql/pglite').PGlite;
} catch (e) {
    console.log('Falta @electric-sql/pglite en ' + DIR + '. Instálalo y vuelve a correr.');
    process.exit(2);
}

const RAIZ = '/Users/macbookpro/Proyectos/etaax.com-004-2/';
const db = new PGlite();
let fallas = 0;
const ok = (c, q) => { console.log((c ? '  ✅ ' : '  ❌ ') + q); if (!c) fallas++; };
const filas = async (sql, p) => (await db.query(sql, p)).rows;
const intentar = async (sql, p) => { try { return { rows: await filas(sql, p) }; }
                                     catch (e) { return { error: e.message }; } };

/* ── El mundo mínimo ──────────────────────────────────────────────────────── */
await db.exec(`
CREATE TABLE negocios (id TEXT PRIMARY KEY, datos JSONB);
CREATE TABLE staff (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
CREATE TABLE entradas_log (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB,
                           created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE login_intentos (clave TEXT PRIMARY KEY, intentos INT NOT NULL DEFAULT 0,
                             ventana_inicio TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE insumos (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
-- Las que toca el cuerpo REAL de entrada_historial (v67): se instala tal cual,
-- así que necesita su mundo completo.
CREATE TABLE inventarios (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
CREATE TABLE inventario_conteos (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB,
                                 created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE checklist_ejecuciones (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);

-- La IP, como la ve PostgREST. Aquí se maneja con un ajuste de sesión para
-- poder simular DOS dispositivos distintos.
CREATE FUNCTION _login_ip() RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('prueba.ip', true), '') $$;

-- El token del QR: válido si coincide con el guardado en el negocio.
CREATE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM negocios n WHERE n.id = p_neg
                     AND n.datos->>'entradaToken' = p_token AND coalesce(p_token,'') <> '') $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;

-- Las definiciones de HOY (v63/v65/v67), las que están en producción.
CREATE FUNCTION entrada_validar_nip(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT;
BEGIN
    IF p_niphash IS NULL OR p_niphash = '' OR NOT _entrada_token_ok(p_neg, p_token) THEN RETURN NULL; END IF;
    SELECT s.datos->>'nombre' INTO v_nombre FROM staff s
     WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash
       AND COALESCE(NULLIF(s.datos->>'estado',''),'Activo') = 'Activo' LIMIT 1;
    RETURN v_nombre;
END; $$;

CREATE FUNCTION portal_perfil(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object('nombre', s.datos->>'nombre',
                              'area', COALESCE(NULLIF(s.datos->>'area',''),'administracion'),
                              'sucursalId', COALESCE(NULLIF(s.datos->>'sucursalId',''),'suc_principal'))
    FROM staff s WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash
      AND COALESCE(NULLIF(s.datos->>'estado',''),'Activo') = 'Activo'
      AND p_niphash IS NOT NULL AND p_niphash <> '' AND _entrada_token_ok(p_neg, p_token) LIMIT 1; $$;

CREATE FUNCTION entrada_sucursal_de_nip(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(NULLIF(s.datos->>'sucursalId',''),'suc_principal') FROM staff s
     WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash
       AND COALESCE(NULLIF(s.datos->>'estado',''),'Activo') = 'Activo'
       AND p_niphash IS NOT NULL AND p_niphash <> '' AND _entrada_token_ok(p_neg, p_token) LIMIT 1; $$;

CREATE FUNCTION entrada_historial(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_suc TEXT, p_area TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v JSONB;
BEGIN
    IF NOT _entrada_token_ok(p_neg, p_token) THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM staff s WHERE s.negocio_id = p_neg
                     AND s.datos->>'nipHash' = p_niphash) THEN RETURN NULL; END IF;
    SELECT jsonb_agg(e.datos) INTO v FROM entradas_log e WHERE e.negocio_id = p_neg;
    RETURN COALESCE(v, '[]'::jsonb);
END; $$;

-- Las que DELEGAN (igual que en producción): así se prueba que el freno llega
-- también por ellas, sin contarle dos fallos a un solo intento.
CREATE FUNCTION entrada_registrar(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB)
RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN RAISE EXCEPTION 'no autorizado'; END IF;
    v_id := 'e' || floor(random()*1e9)::text;
    INSERT INTO entradas_log (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object('registradoPor', v_nombre));
    RETURN v_id;
END; $$;

CREATE FUNCTION checklist_registrar(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB)
RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN RAISE EXCEPTION 'no autorizado'; END IF;
    v_id := 'c' || floor(random()*1e9)::text;
    INSERT INTO checklist_ejecuciones (id, negocio_id, datos) VALUES (v_id, p_neg, p_datos);
    RETURN v_id;
END; $$;

CREATE FUNCTION inventario_conteo_registrar(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB)
RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT; v_filas INT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN RAISE EXCEPTION 'no autorizado'; END IF;
    v_id := COALESCE(NULLIF(p_datos->>'id',''), 'k' || floor(random()*1e9)::text);
    INSERT INTO inventario_conteos (id, negocio_id, datos) VALUES (v_id, p_neg, p_datos)
    ON CONFLICT (id) DO UPDATE SET datos = EXCLUDED.datos
      WHERE inventario_conteos.negocio_id = p_neg;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas = 0 THEN RAISE EXCEPTION 'No se pudo registrar el conteo'; END IF;
    RETURN v_id;
END; $$;

CREATE FUNCTION portal_recetas(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS SETOF JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_perfil JSONB;
BEGIN
    v_perfil := portal_perfil(p_neg, p_token, p_niphash);
    IF v_perfil IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT i.datos FROM insumos i WHERE i.negocio_id = p_neg;
END; $$;

INSERT INTO negocios (id, datos) VALUES ('neg1', '{"entradaToken":"tok-bueno"}');
INSERT INTO staff (id, negocio_id, datos) VALUES
  ('s1','neg1','{"nombre":"Ana","nipHash":"nip$ana","estado":"Activo","sucursalId":"suc_norte","area":"cocina"}'),
  ('s2','neg1','{"nombre":"Beto","nipHash":"nip$beto","estado":"Baja definitiva"}');
INSERT INTO insumos (id, negocio_id, datos) VALUES ('i1','neg1','{"nombre":"Tomate"}');
INSERT INTO inventarios (id, negocio_id, datos) VALUES
  ('inv1','neg1','{"fecha":"2026-10-01","cerrado":true,"sucursalId":"suc_norte","area":"cocina","nombre":"Corte de octubre"}');
SELECT set_config('prueba.ip', '200.1.1.1', false);
`);

/* ── ANTES: adivinar sale gratis ──────────────────────────────────────────── */
console.log('\n══ ANTES de la v78 — se prueban NIP hasta dar ══');
{
    let topes = 0;
    for (let i = 0; i < 500; i++) {
        const r = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno', $1)`, ['nip$' + i]);
        if (r.error) { topes++; break; }
    }
    ok(topes === 0, '500 NIP distintos, uno tras otro, sin una sola queja');
    const h = await intentar(`SELECT portal_perfil('neg1','tok-bueno','nip$x') AS p`);
    ok(!h.error, '…y por portal_perfil igual (ni esa tenía freno)');
}

/* ── La migración, tal cual ───────────────────────────────────────────────── */
console.log('\n══ Corriendo supabase-migration-v78.sql ══');
const sql = fs.readFileSync(RAIZ + 'supabase-migration-v78.sql', 'utf8');
let tabla = null;
try {
    const res = await db.exec(sql);
    tabla = res[res.length - 1];
    ok(true, 'la migración corre sin errores de sintaxis');
} catch (e) {
    ok(false, 'la migración FALLÓ: ' + e.message);
    console.log('\n🚨 ' + fallas + ' falla(s)'); process.exit(1);
}
console.log('\n  Tabla de comprobación que verá Edwin:');
for (const r of (tabla.rows || [])) console.log('   ', JSON.stringify(r));
ok((tabla.rows || []).every(r => r.resultado !== 'FALLA'), 'ningún renglón dice FALLA');

/* ── DESPUÉS ──────────────────────────────────────────────────────────────── */
console.log('\n══ DESPUÉS de la v78 ══');
const limpiar = () => db.exec(`DELETE FROM login_intentos`);

{   /* 1 · el que adivina se topa */
    await limpiar();
    let frenó = 0, espera = null;
    for (let i = 1; i <= 30; i++) {
        const r = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno', $1)`, ['nip$malo' + i]);
        if (r.error && /nip_espera/.test(r.error)) { frenó = i; espera = r.error.match(/nip_espera:(\d+)/)[1]; break; }
    }
    ok(frenó === 13, 'se topa en el intento 13 (doce fallos y la espera empieza) — fue el ' + frenó);
    ok(Number(espera) > 0 && Number(espera) <= 60, '…y dice cuántos segundos faltan: ' + espera);
}

{   /* 2 · cambiar de función NO reinicia el contador */
    const r1 = await intentar(`SELECT portal_perfil('neg1','tok-bueno','nip$otro') AS p`);
    ok(/nip_espera/.test(r1.error || ''), 'cambiar a portal_perfil no lo reinicia: sigue frenado');
    const r2 = await intentar(`SELECT entrada_sucursal_de_nip('neg1','tok-bueno','nip$otro')`);
    ok(/nip_espera/.test(r2.error || ''), '…ni entrada_sucursal_de_nip');
    const r3 = await intentar(`SELECT entrada_historial('neg1','tok-bueno','nip$otro','suc_norte','cocina') AS h`);
    ok(/nip_espera/.test(r3.error || ''), '…ni entrada_historial');
    const r4 = await intentar(`SELECT * FROM portal_recetas('neg1','tok-bueno','nip$otro')`);
    ok(/nip_espera/.test(r4.error || ''), '…ni las que delegan, como portal_recetas');
    const r5 = await intentar(`SELECT entrada_registrar('neg1','tok-bueno','nip$otro','{}'::jsonb)`);
    ok(/nip_espera/.test(r5.error || ''), '…ni entrada_registrar (el freno llega por delegación)');
}

{   /* 3 · cambiar de NIP tampoco */
    const r = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$completamente-otro')`);
    ok(/nip_espera/.test(r.error || ''), 'probar otro NIP tampoco reinicia el contador');
}

{   /* 4 · OTRA IP no queda frenada: un teléfono no tumba al local */
    await db.exec(`SELECT set_config('prueba.ip', '10.9.9.9', false)`);
    const r = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$ana')`);
    ok(!r.error && r.rows[0].entrada_validar_nip === 'Ana',
       'desde otro dispositivo se entra normal (el freno es por negocio+IP)');
    await db.exec(`SELECT set_config('prueba.ip', '200.1.1.1', false)`);
}

{   /* 5 · cumplida la espera, se puede otra vez */
    await db.exec(`UPDATE login_intentos SET ultimo = now() - interval '5 minutes',
                                             ventana_inicio = now() - interval '6 minutes'
                    WHERE clave LIKE 'nip|neg1|%'`);
    const r = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$ana')`);
    ok(!r.error && r.rows[0].entrada_validar_nip === 'Ana', 'cumplida la espera, el NIP bueno entra');
    const q = await filas(`SELECT count(*)::int AS n FROM login_intentos WHERE clave LIKE 'nip|neg1|%'`);
    ok(q[0].n === 0, '…y acertar deja el contador en cero');
}

{   /* 6 · EL USO LEGÍTIMO: una entrada normal son varias llamadas seguidas */
    await limpiar();
    for (let i = 0; i < 40; i++) {
        await filas(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$ana')`);
        await filas(`SELECT portal_perfil('neg1','tok-bueno','nip$ana') AS p`);
        await filas(`SELECT entrada_sucursal_de_nip('neg1','tok-bueno','nip$ana')`);
        await filas(`SELECT * FROM portal_recetas('neg1','tok-bueno','nip$ana')`);
    }
    const r = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$ana')`);
    ok(!r.error && r.rows[0].entrada_validar_nip === 'Ana',
       '160 llamadas legítimas seguidas y sigue entrando (no gastan intentos)');
    const q = await filas(`SELECT count(*)::int AS n FROM login_intentos`);
    ok(q[0].n === 0, '…y no dejan ni un renglón en el contador');
}

{   /* 7 · lo que NO puede cambiar */
    await limpiar();
    const p = await filas(`SELECT portal_perfil('neg1','tok-bueno','nip$ana') AS p`);
    ok(p[0].p && p[0].p.sucursalId === 'suc_norte', 'el perfil sigue trayendo su SUCURSAL');
    ok(p[0].p && p[0].p.area === 'cocina', '…y su ÁREA');
    const s = await filas(`SELECT entrada_sucursal_de_nip('neg1','tok-bueno','nip$ana') AS s`);
    ok(s[0].s === 'suc_norte', 'la sucursal del NIP se sigue resolviendo igual');
    const e = await filas(`SELECT entrada_registrar('neg1','tok-bueno','nip$ana','{"insumo":"Tomate"}'::jsonb) AS id`);
    ok(!!e[0].id, 'se sigue pudiendo registrar una entrada por el QR');
    const quien = await filas(`SELECT datos->>'registradoPor' AS q FROM entradas_log WHERE id = $1`, [e[0].id]);
    ok(quien[0].q === 'Ana', '…y queda registrado QUIÉN la capturó');
    const h = await filas(`SELECT entrada_historial('neg1','tok-bueno','nip$ana','suc_norte','cocina') AS h`);
    ok(h[0].h && h[0].h.ok === true, 'el historial sigue respondiendo: ' + JSON.stringify(h[0].h));
    /* Y cuando el NIP no vale, sigue diciendo POR QUÉ: entrada.html lee ese
       `motivo` para decir «Tu NIP ya no es válido», no un «no se pudo». */
    const hMal = await filas(`SELECT entrada_historial('neg1','tok-bueno','nip$nadie','suc_norte','cocina') AS h`);
    ok(hMal[0].h && hMal[0].h.ok === false && hMal[0].h.motivo === 'nip',
       '…y el NIP inválido sigue devolviendo {ok:false, motivo:"nip"}: ' + JSON.stringify(hMal[0].h));
    const rec = await filas(`SELECT * FROM portal_recetas('neg1','tok-bueno','nip$ana')`);
    ok(rec.length === 1, 'el recetario del portal sigue respondiendo');

    const baja = await filas(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$beto') AS n`);
    ok(baja[0].n === null, 'el dado de baja sigue sin pasar');
    const tokMalo = await filas(`SELECT entrada_validar_nip('neg1','tok-INVENTADO','nip$ana') AS n`);
    ok(tokMalo[0].n === null, 'y sin el token del QR tampoco se pasa');
}

{   /* 8 · el guardia no se puede llamar a mano desde fuera */
    const g = await filas(`SELECT has_function_privilege('anon','_nip_guardia(text,text)','EXECUTE') AS a,
                                  has_function_privilege('anon','entrada_validar_nip(text,text,text)','EXECUTE') AS v,
                                  has_function_privilege('anon','portal_perfil(text,text,text)','EXECUTE') AS p`);
    ok(g[0].a === false, 'anon no puede llamar al guardia directo');
    ok(g[0].v === true && g[0].p === true, '…pero sí las puertas del QR (si no, se cae el QR)');
}

/* ══ LO QUE ENCONTRÓ CODEX SUPERVISANDO, Y QUE LA v79 ARREGLA ══════════════
   Dos agujeros que la comprobación de la v78 no vio. El segundo bloque de
   abajo prueba cada puerta DESDE EL CONTADOR EN CERO, que es exactamente lo
   que faltaba: probarlas cuando ya estaban bloqueadas desde otra función
   demuestra que OBEDECEN un bloqueo, no que lo PROVOQUEN.                    */
console.log('\n══ ANTES de la v79 — los dos agujeros, provocados ══');
{
    for (const fn of ['entrada_registrar', 'checklist_registrar', 'inventario_conteo_registrar']) {
        await limpiar();
        let bloqueos = 0;
        for (let i = 1; i <= 30; i++) {
            const r = await intentar(`SELECT ${fn}('neg1','tok-bueno', $1, '{}'::jsonb)`, ['nip$x' + i]);
            if (r.error && /nip_espera/.test(r.error)) { bloqueos++; break; }
        }
        const q = await filas(`SELECT count(*)::int AS n FROM login_intentos`);
        ok(bloqueos === 0 && q[0].n === 0,
           fn + ': 30 NIP malos, 0 bloqueos y el contador VACÍO (la excepción se lo llevaba)');
    }
    await limpiar();
    await db.exec(`INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
                   VALUES (_nip_clave('neg1'), 24, now() - interval '40 minutes', now() - interval '16 minutes')`);
    const r = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$malo')`);
    ok(!r.error, 'la espera de UNA HORA se evaporó a los 16 minutos (dejó intentar otra vez)');
}

/* ══ La v79 ═══════════════════════════════════════════════════════════════ */
console.log('\n══ Corriendo supabase-migration-v79.sql ══');
{
    const sql79 = fs.readFileSync(RAIZ + 'supabase-migration-v79.sql', 'utf8');
    let t79 = null;
    try {
        const res = await db.exec(sql79);
        t79 = res[res.length - 1];
        ok(true, 'la v79 corre sin errores de sintaxis');
    } catch (e) {
        ok(false, 'la v79 FALLÓ: ' + e.message);
    }
    if (t79) {
        console.log('\n  Tabla de comprobación de la v79:');
        for (const r of (t79.rows || [])) console.log('   ', JSON.stringify(r));
        ok((t79.rows || []).every(r => r.resultado !== 'FALLA'), 'ningún renglón de la v79 dice FALLA');
    }
}

console.log('\n══ DESPUÉS de la v79 ══');
{
    /* 1 · cada puerta que escribe acumula sus PROPIOS fallos, desde cero */
    for (const fn of ['entrada_registrar', 'checklist_registrar', 'inventario_conteo_registrar']) {
        await limpiar();
        let frenó = 0;
        for (let i = 1; i <= 30; i++) {
            const r = await intentar(`SELECT ${fn}('neg1','tok-bueno', $1, '{}'::jsonb)`, ['nip$y' + i]);
            if (r.error && /nip_espera/.test(r.error)) { frenó = i; break; }
        }
        ok(frenó === 13, fn + ': frena en el intento 13 por sí sola — fue el ' + frenó);
    }

    /* 2 · y rechazan SIN excepción, para no llevarse el apunte */
    await limpiar();
    const rr = await filas(`SELECT entrada_registrar('neg1','tok-bueno','nip$nadie','{}'::jsonb) AS id`);
    ok(rr[0].id === null, 'el rechazo por NIP ya no es excepción: devuelve NULL');
    const q1 = await filas(`SELECT intentos FROM login_intentos`);
    ok(q1.length === 1 && q1[0].intentos === 1, '…y el fallo SÍ queda anotado (1 intento)');
    const e1 = await filas(`SELECT count(*)::int AS n FROM entradas_log WHERE datos->>'x' IS NOT NULL`);
    ok(e1[0].n === 0, '…sin guardar nada, que es lo que importa');

    /* 3 · el castigo de una hora dura una hora */
    await limpiar();
    await db.exec(`INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
                   VALUES (_nip_clave('neg1'), 24, now() - interval '40 minutes', now() - interval '16 minutes')`);
    const r16 = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$malo')`);
    ok(/nip_espera/.test(r16.error || ''), 'a los 16 minutos de 24 fallos, SIGUE frenado');
    const faltan = Number((r16.error || '').match(/nip_espera:(\d+)/)[1]);
    ok(faltan > 2400 && faltan < 2700, '…y faltan unos 44 minutos: ' + Math.round(faltan / 60) + ' min');

    /* …y los cuatro escalones, en su límite */
    for (const [fallos, esperaMin] of [[12, 1], [15, 5], [18, 15], [24, 60]]) {
        await limpiar();
        await db.exec(`INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
                       VALUES (_nip_clave('neg1'), ${fallos}, now(), now() - interval '${esperaMin} minutes' + interval '10 seconds')`);
        const a = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$malo')`);
        ok(/nip_espera/.test(a.error || ''), `con ${fallos} fallos sigue frenado a falta de 10 s`);
        await db.exec(`UPDATE login_intentos SET ultimo = now() - interval '${esperaMin} minutes' - interval '10 seconds'`);
        const b = await intentar(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$ana')`);
        ok(!b.error && b.rows[0].entrada_validar_nip === 'Ana',
           `…y cumplidos los ${esperaMin} min, el NIP bueno entra`);
    }

    /* 4 · cumplido el castigo se olvida: nadie queda marcado de por vida */
    await limpiar();
    await db.exec(`INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
                   VALUES (_nip_clave('neg1'), 24, now() - interval '3 hours', now() - interval '2 hours')`);
    await filas(`SELECT entrada_validar_nip('neg1','tok-bueno','nip$malo')`);
    const q2 = await filas(`SELECT intentos FROM login_intentos`);
    ok(q2.length === 1 && q2[0].intentos === 1, 'cumplido el castigo, el contador empieza de nuevo');

    /* 5 · y lo legítimo, otra vez: las tres siguen guardando */
    await limpiar();
    const g1 = await filas(`SELECT entrada_registrar('neg1','tok-bueno','nip$ana','{"insumo":"Tomate"}'::jsonb) AS id`);
    ok(!!g1[0].id, 'con el NIP bueno se sigue registrando una entrada');
    const g2 = await filas(`SELECT checklist_registrar('neg1','tok-bueno','nip$ana','{"a":1}'::jsonb) AS id`);
    ok(!!g2[0].id, '…y un check list');
    const g3 = await filas(`SELECT inventario_conteo_registrar('neg1','tok-bueno','nip$ana','{"a":1}'::jsonb) AS id`);
    ok(!!g3[0].id, '…y un conteo');
    const q3 = await filas(`SELECT count(*)::int AS n FROM login_intentos`);
    ok(q3[0].n === 0, '…sin dejar un solo intento anotado');

    /* 6 · el rechazo de R05 (conteo de otro negocio) SÍ sigue siendo excepción */
    await db.exec(`INSERT INTO negocios (id, datos) VALUES ('neg2','{"entradaToken":"tok2"}') ON CONFLICT DO NOTHING;
                   INSERT INTO inventario_conteos (id, negocio_id, datos) VALUES ('ajeno','neg2','{}') ON CONFLICT DO NOTHING;`);
    const aj = await intentar(`SELECT inventario_conteo_registrar('neg1','tok-bueno','nip$ana','{"id":"ajeno"}'::jsonb)`);
    ok(/No se pudo registrar el conteo/.test(aj.error || ''),
       'pisar el conteo de otro negocio sigue rechazándose (R05): ' + (aj.error || 'NO RECHAZÓ'));
}

console.log(fallas ? '\n🚨 ' + fallas + ' falla(s)' : '\n🔒 v78 + v79 OK — el freno de los NIP, verificado contra Postgres de verdad');
process.exit(fallas ? 1 : 0);
