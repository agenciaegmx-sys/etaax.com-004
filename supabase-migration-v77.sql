-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · v77 — LA PUERTA DE LOS COLABORADORES: FRENO, BAJAS Y CONTADOR
--
-- Tres puertas que el inventario de producción (docs/inventario-produccion.sql)
-- encontró abiertas. Las tres son de la misma familia —la entrada de
-- colaboradores— y por eso se cierran juntas.
--
--
-- 1) EL FRENO DE INTENTOS DE `staff_login` SE PERDIÓ EN EL CAMINO  [R04]
--
--    La v30 le puso un límite: 10 intentos por 15 minutos contra la misma
--    cuenta, y al entrar bien se borra el contador. Estaba escrita en plpgsql
--    justamente para poder llamar `_login_golpe` antes de mirar la contraseña.
--
--    La v63 vino a arreglar OTRA cosa —que un colaborador dado de baja seguía
--    entrando— y la reescribió en `LANGUAGE sql`, una sola consulta. Al hacerlo
--    se llevó el freno. Nadie se dio cuenta porque la función sigue haciendo
--    perfectamente lo suyo: dice sí cuando la contraseña es buena y no cuando
--    no. Simplemente dejó de contar, y sin contador se le pueden tirar
--    contraseñas a una cuenta de colaborador toda la noche.
--
--    Lección que vale más que el parche: UNA FUNCIÓN QUE AUTENTICA NO SE
--    REESCRIBE DESDE CERO. Se parte de su última definición y se cambia solo lo
--    que se vino a cambiar. Lo que se pierde al reescribir no da error, no
--    cambia la respuesta y no se nota: solo deja de proteger.
--
--
-- 2) `obtener_staff_cred` NUNCA MIRÓ SI LA PERSONA SIGUE EN LA NÓMINA  [R03]
--
--    Es la función que entrega la credencial de la cuenta compartida del
--    negocio —la que le da sesión en la nube a los colaboradores— y la entrega
--    a cambio del hash de la contraseña de CUALQUIER colaborador de ese
--    negocio. La v63 le puso el candado de estado a las tres funciones que
--    autentican… y a esta no, porque no parecía una de ellas. Lo es: la llave
--    que da es la de todos.
--
--    Efecto de la v63 sin esta: al dado de baja se le cerraba la puerta de
--    enfrente (`staff_login` ya no lo deja entrar) y se le dejaba la de atrás
--    (pide la credencial compartida y entra a la nube con ella).
--
--
-- 3) `login_exito` LA PUEDE LLAMAR CUALQUIERA, PARA CUALQUIER CUENTA  [R04]
--
--    El freno de la pantalla de entrada (v56) escala la espera: 5 fallos → 1
--    min, 6 → 5 min, 7 → 15 min, 8 → 1 hora. Y `login_exito(ident)` borra el
--    contador de ese identificador. Está concedida a `anon` porque el navegador
--    la llama al entrar bien… pero no pide ninguna prueba de haber entrado.
--
--    Así que la escalera era decorativa: fallo, `login_exito('victima@x.com')`,
--    fallo, `login_exito(...)`. El contador nunca pasa de 1 y la espera nunca
--    llega. Y de paso sirve para desbloquear a quien sí está frenado.
--
--    Aquí se le pide la prueba que faltaba: solo borra el contador de la cuenta
--    con cuya sesión se está llamando. Sin sesión no borra nada —y ya no se le
--    concede a `anon`—. Los colaboradores no quedan sin reinicio: ahora lo hace
--    el servidor DENTRO de `staff_login`, donde la contraseña ya se comprobó.
--
--
-- LO QUE ESTA MIGRACIÓN **NO** CIERRA, dicho antes de correrla:
--
--   · Mientras los colaboradores compartan una sola identidad en la nube (la
--     cuenta `staff.<negocio>@etaax.app` de la v19), dar de baja a UNA persona
--     no puede demostrarse del lado del servidor: la sesión que ya tiene en la
--     mano es indistinguible de la de sus compañeros. Lo que esta migración
--     logra es que NO PUEDA CONSEGUIR UNA NUEVA. La que ya tenga abierta vive
--     hasta que cierre el navegador (las sesiones viven en sessionStorage) y la
--     credencial cacheada en su equipo se borra al salir (cambio del cliente,
--     en este mismo lote). Cerrar el caso de verdad es rotar la contraseña de
--     la cuenta compartida en cada baja, y eso necesita la Edge Function de
--     credenciales, que todavía no está desplegada. R03 SIGUE ABIERTO.
--
--   · `portal_perfil` y `entrada_sucursal_de_nip` (v65) autentican por NIP y
--     NUNCA tuvieron freno de intentos —ni se les quitó: no lo tenían—. Un NIP
--     son cuatro dígitos. No se tocan aquí a propósito: son la superficie
--     pública del QR, las llaman media docena de pantallas y el freno les
--     cambia la forma de contestar. Van en su propio lote, con su prueba.
--
-- Idempotente: CREATE OR REPLACE y GRANT/REVOKE. No toca datos.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1) staff_login: el freno de la v30 + el candado de estado de la v63 ─────
-- Base: la definición de la v63, tal cual, metida en plpgsql para poder llamar
-- al freno antes de la consulta. Lo único que cambia del WHERE es que sale la
-- comprobación de `p_hash` (ahora se hace arriba, antes de gastar un intento).
--
-- EL RESET DEL CONTADOR DE LA PUERTA (v56) AHORA LO HACE EL SERVIDOR, aquí
-- dentro: es el único lugar donde consta que la contraseña era buena. El
-- cliente ya no puede borrarlo —punto 3— y si no se hiciera aquí, quien
-- tecleara mal cinco veces y luego bien se quedaría esperando una hora.
CREATE OR REPLACE FUNCTION staff_login(p_usuario TEXT, p_hash TEXT)
RETURNS TABLE (negocio_id TEXT, negocio_datos JSONB, staff_id TEXT, nombre TEXT, rol TEXT, sucursal_id TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave TEXT := 'staff|' || lower(coalesce(p_usuario, ''));
BEGIN
    IF p_usuario IS NULL OR p_hash IS NULL OR length(p_hash) = 0 THEN RETURN; END IF;

    -- `IS NOT TRUE` y no `NOT (...)`: en SQL, NOT(NULL) es NULL, el IF no se
    -- cumple y el bloqueo se SALTA. Así nació el agujero que arregló la v70.
    IF (_login_golpe(v_clave)) IS NOT TRUE THEN
        RAISE EXCEPTION 'rate_limited';
    END IF;

    RETURN QUERY
        SELECT s.negocio_id,
               n.datos,
               s.id,
               s.datos->>'nombre',
               COALESCE(NULLIF(s.datos->>'rol',''), 'otro'),
               NULLIF(s.datos->>'sucursalId','')
        FROM staff s
        JOIN negocios n ON n.id = s.negocio_id
        WHERE s.datos->>'usuario' = p_usuario
          AND s.datos->>'passwordHash' = p_hash
          -- EL CANDADO DE LA V63. El COALESCE importa: los colaboradores viejos
          -- no traen el campo `estado` y sin él quedarían TODOS fuera de golpe.
          -- Sin estado capturado = activo, como siempre se comportó.
          AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
        LIMIT 1;

    IF FOUND THEN
        PERFORM _login_exito(v_clave);                  -- freno de la v30
        DELETE FROM login_puerta                        -- escalera de la v56
         WHERE ident = md5(lower(trim(p_usuario)));
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION staff_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_login(TEXT, TEXT) TO anon, authenticated;


-- ── 2) obtener_staff_cred: la llave compartida no se le da a quien ya no está ──
-- Base: la definición de la v30, con una línea más en el EXISTS — el mismo
-- candado de estado, con el mismo COALESCE, que la v63 puso en las otras tres.
CREATE OR REPLACE FUNCTION obtener_staff_cred(p_neg TEXT, p_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave TEXT := 'cred|' || coalesce(p_neg, '');
        v_cred JSONB;
BEGIN
    IF p_neg IS NULL OR p_hash IS NULL OR length(p_hash) = 0 THEN RETURN NULL; END IF;
    IF (_login_golpe(v_clave)) IS NOT TRUE THEN
        RAISE EXCEPTION 'rate_limited';
    END IF;
    SELECT n.staff_cred INTO v_cred
    FROM negocios n
    WHERE n.id = p_neg
      AND n.staff_cred IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM staff s
          WHERE s.negocio_id = p_neg
            AND s.datos->>'passwordHash' = p_hash
            AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
      );
    IF v_cred IS NOT NULL THEN PERFORM _login_exito(v_clave); END IF;
    RETURN v_cred;
END;
$$;
-- `anon` SÍ la necesita, y no es un descuido: cuando el colaborador pide la
-- credencial todavía no tiene sesión —es justo lo que viene a conseguir—. Lo
-- que la protege es el hash de su contraseña, el freno de intentos y, desde
-- ahora, estar activo.
REVOKE ALL ON FUNCTION obtener_staff_cred(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION obtener_staff_cred(TEXT, TEXT) TO anon, authenticated;


-- ── 3) login_exito: borra TU contador, no el de quien quieras ───────────────
-- Base: la definición de la v56. Misma firma —el cliente la sigue llamando
-- igual— y sigue sin devolver nada: quien la llame no se enterará de si borró
-- algo. Lo que cambia es que ahora exige sesión y que el identificador sea el
-- de esa misma sesión.
--
-- Por qué no basta con exigir sesión: cualquiera se registra, obtiene sesión y
-- vuelve a desbloquear al vecino. La prueba tiene que ser de IDENTIDAD.
CREATE OR REPLACE FUNCTION login_exito(p_ident TEXT)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mio  TEXT;
        v_pide TEXT := lower(trim(coalesce(p_ident, '')));
BEGIN
    IF auth.uid() IS NULL THEN RETURN; END IF;     -- sin sesión no se prueba nada
    v_mio := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
    IF v_mio = '' OR v_pide = '' OR v_mio <> v_pide THEN RETURN; END IF;
    DELETE FROM login_puerta WHERE ident = md5(v_mio);
END;
$$;
-- `anon` lo tenía por GRANT DIRECTO, no por PUBLIC: hay que nombrarlo. Es el
-- hallazgo de la v71 y se repite aquí porque es el error que más cuesta ver.
REVOKE ALL ON FUNCTION login_exito(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION login_exito(TEXT) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — todo en UNA sola instrucción.
--
-- El SQL Editor de Supabase enseña el resultado de la ÚLTIMA instrucción: si
-- esto fueran seis SELECT, se verían los últimos renglones y los de arriba se
-- perderían sin que nadie lo note. Van en un solo SELECT, lo peor primero.
--
-- Lo importante: los renglones 1 y 2 no LEEN la definición, la CORREN. Una
-- prueba que busca un texto en el código sobrevive a que el código deje de
-- funcionar — es el error que más se repite en este proyecto.
-- ════════════════════════════════════════════════════════════════════════════

-- Sonda: le tira 12 intentos fallidos a staff_login con un usuario que no
-- existe y dice en cuál frenó.
--
-- SE QUEDA PUESTA, y a propósito: si el DROP fuera la última instrucción del
-- archivo, el editor de Supabase enseñaría el resultado del DROP —nada— y la
-- tabla de comprobación no se vería. Ya pasó con el inventario. Queda sin
-- permisos para nadie (abajo), así que no es superficie: solo la puede llamar
-- el dueño de la base desde el editor. Para borrarla a mano:
--     DROP FUNCTION IF EXISTS _v77_probar_freno();
CREATE OR REPLACE FUNCTION _v77_probar_freno()
RETURNS TEXT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE i INT;
        v_res TEXT := 'NO FRENÓ en 12 intentos';
BEGIN
    DELETE FROM login_intentos WHERE clave = 'staff|__prueba_v77__';
    FOR i IN 1..12 LOOP
        BEGIN
            PERFORM * FROM staff_login('__prueba_v77__', 'hash-inexistente-v77');
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE '%rate_limited%' THEN
                v_res := 'frenó en el intento ' || i;
                EXIT;
            END IF;
            v_res := 'ERROR inesperado: ' || SQLERRM;
            EXIT;
        END;
    END LOOP;
    DELETE FROM login_intentos WHERE clave = 'staff|__prueba_v77__';
    RETURN v_res;
END;
$$;
-- Ni anon ni las sesiones la pueden llamar. En Supabase, toda función nueva de
-- `public` nace con EXECUTE concedido a `anon` POR GRANT DIRECTO, así que
-- quitarlo de PUBLIC no alcanza — hay que nombrarlos (hallazgo de la v71).
REVOKE ALL ON FUNCTION _v77_probar_freno() FROM PUBLIC, anon, authenticated;

WITH r AS (
    -- La sonda se corre UNA vez: en el FROM. Llamarla en el CASE y otra vez en
    -- el detalle serían dos tandas de 12 intentos y dos respuestas distintas.
    SELECT 1 AS n,
           'staff_login FRENA de verdad los intentos (no solo lo dice)' AS prueba,
           CASE WHEN f.res = 'frenó en el intento 11' THEN 'PASA' ELSE 'FALLA' END AS resultado,
           f.res AS detalle
      FROM _v77_probar_freno() AS f(res)

    UNION ALL
    SELECT 2, 'anon NO puede borrar el contador de nadie (login_exito)',
           CASE WHEN has_function_privilege('anon', 'login_exito(text)', 'EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END,
           'anon=' || has_function_privilege('anon', 'login_exito(text)', 'EXECUTE')::text ||
           ' · con sesión=' || has_function_privilege('authenticated', 'login_exito(text)', 'EXECUTE')::text

    UNION ALL
    SELECT 3, 'login_exito exige que el identificador sea el de TU sesión',
           CASE WHEN pg_get_functiondef(p.oid) LIKE '%auth.uid() IS NULL%'
                 AND pg_get_functiondef(p.oid) LIKE '%auth.jwt()%'
                 AND pg_get_functiondef(p.oid) LIKE '%v_mio <> v_pide%'
                THEN 'PASA' ELSE 'FALLA' END,
           'sesión=' || (pg_get_functiondef(p.oid) LIKE '%auth.uid() IS NULL%')::text ||
           ' correo=' || (pg_get_functiondef(p.oid) LIKE '%auth.jwt()%')::text ||
           ' coincide=' || (pg_get_functiondef(p.oid) LIKE '%v_mio <> v_pide%')::text
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'login_exito'

    UNION ALL
    SELECT 4, 'la credencial compartida pide estar ACTIVO (obtener_staff_cred)',
           CASE WHEN pg_get_functiondef(p.oid) LIKE '%estado%Activo%'
                THEN 'PASA' ELSE 'FALLA' END,
           'y sigue con freno de intentos=' ||
           (pg_get_functiondef(p.oid) LIKE '%_login_golpe%')::text
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'obtener_staff_cred'

    UNION ALL
    SELECT 5, 'staff_login sigue bloqueando al dado de baja (candado v63)',
           CASE WHEN pg_get_functiondef(p.oid) LIKE '%estado%Activo%'
                THEN 'PASA' ELSE 'FALLA' END,
           'y reinicia los DOS contadores al entrar bien=' ||
           (pg_get_functiondef(p.oid) LIKE '%_login_exito%'
            AND pg_get_functiondef(p.oid) LIKE '%login_puerta%')::text
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'staff_login'

    UNION ALL
    -- Cuánto cambia esto en SU negocio, hoy: a cuánta gente dada de baja se le
    -- cierra la puerta de atrás. Si sale 0, nadie está dado de baja todavía —
    -- no significa que el candado no sirva.
    SELECT 6, 'personas dadas de baja que YA NO consiguen la llave compartida',
           'DATO',
           count(*)::text || ' de ' || (SELECT count(*) FROM staff)::text || ' colaboradores'
      FROM staff s
     WHERE COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') <> 'Activo'
)
SELECT n AS "#", prueba, resultado, detalle
  FROM r
 ORDER BY CASE resultado WHEN 'FALLA' THEN 0 WHEN 'DATO' THEN 2 ELSE 1 END, n;
