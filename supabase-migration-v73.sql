-- ============================================================================
-- ETAAX — Migración v73: el cobro de un negocio solo lo ve ese negocio
-- ----------------------------------------------------------------------------
-- La v72 le cerró a `anon` las dos funciones de cobro. Faltaba la mitad que
-- importa más: **entre cuentas autenticadas seguían abiertas**.
--
-- `negocio_esta_activo` y `negocio_cobro_estado` (v43) corren como dueño y
-- consultan el `p_neg` que se les nombre, sin comprobar pertenencia. Con una
-- sesión cualquiera —la de otro cliente— y el id de un negocio ajeno (que es
-- público: viaja en la dirección de la carta del QR de la mesa) se podía leer
-- su estado de pago, su fecha de corte y sus días de tolerancia.
--
-- SE COMPRUEBA ANTES DE LEER: dueño, staff del negocio, o admin de plataforma.
-- Lo demás levanta excepción, no devuelve «inactivo»: un «false» se
-- confundiría con «este negocio no ha pagado», que es una respuesta distinta
-- y una fuga en sí misma.
--
-- POR QUÉ LANZAR NO ROMPE NADA. El único llamador es `_leerSuscripcion`
-- (hub.html:1154) y ya es tolerante a fallos: si la RPC devuelve error, cae a
-- `negocio_esta_activo`, y de ahí a un `select` directo sobre `suscripciones`
-- que la RLS resuelve bien para el dueño. Un legítimo nunca llega a la
-- excepción —`etaax_negocio_alcanzable` cubre dueño Y staff—, y si llegara,
-- el camino de abajo le da la respuesta correcta igual.
--
-- `IS NOT TRUE` y no `NOT (...)`: la lección de la v70. Sin sesión la
-- expresión da NULL y un `NOT NULL` dejaría pasar.
--
-- ── Y DOS PERMISOS MÁS ──
-- `etaax_puede_neg` y `etaax_negocio_alcanzable` seguían abiertas a `anon`.
-- Se revisó política por política: las dos SOLO aparecen en políticas
-- `TO authenticated`, así que revocarlas no rompe ninguna evaluación de RLS.
-- (`es_staff_de` e `is_platform_admin` NO se tocan: esas sí viven en
-- políticas creadas sin cláusula `TO`, que aplican a todos los roles, y sin
-- EXECUTE la consulta pasaría de «cero filas» a `permission denied`.)
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

CREATE OR REPLACE FUNCTION negocio_esta_activo(p_neg TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF (etaax_negocio_alcanzable(p_neg) OR is_platform_admin()) IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;
    -- Misma cuenta que la v43, intacta.
    RETURN COALESCE((
        SELECT estado = 'activa'
           AND COALESCE(proximo_cobro, activa_hasta::date) IS NOT NULL
           AND (COALESCE(proximo_cobro, activa_hasta::date)
                + COALESCE(dias_tolerancia, 0)) >= CURRENT_DATE
          FROM suscripciones WHERE negocio_id = p_neg
    ), false);
END;
$$;

CREATE OR REPLACE FUNCTION negocio_cobro_estado(p_neg TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF (etaax_negocio_alcanzable(p_neg) OR is_platform_admin()) IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;
    -- Mismo objeto que la v43, campo por campo.
    RETURN COALESCE((
        SELECT jsonb_build_object(
            'estado',         s.estado,
            'proximoCobro',   COALESCE(s.proximo_cobro, s.activa_hasta::date),
            'diaCobro',       s.dia_cobro,
            'diasTolerancia', COALESCE(s.dias_tolerancia, 0),
            'activo',         negocio_esta_activo(p_neg),
            'diasRestantes',  (COALESCE(s.proximo_cobro, s.activa_hasta::date)
                               + COALESCE(s.dias_tolerancia, 0)) - CURRENT_DATE
        )
        FROM suscripciones s WHERE s.negocio_id = p_neg
    ), jsonb_build_object('estado', 'pendiente', 'activo', false));
END;
$$;

REVOKE ALL ON FUNCTION negocio_esta_activo(TEXT)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION negocio_esta_activo(TEXT)  TO authenticated;
REVOKE ALL ON FUNCTION negocio_cobro_estado(TEXT)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION negocio_cobro_estado(TEXT) TO authenticated;

-- Las dos que solo viven en políticas TO authenticated.
REVOKE ALL ON FUNCTION etaax_puede_neg(TEXT)              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION etaax_puede_neg(TEXT)           TO authenticated;
REVOKE ALL ON FUNCTION etaax_negocio_alcanzable(TEXT)     FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION etaax_negocio_alcanzable(TEXT)  TO authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Todo sale en la pestaña Results, en una sola tabla. El resultado se guarda
-- en una temporal y se SELECCIONA antes del ROLLBACK — los RAISE NOTICE de la
-- v70 quedaban escondidos en Messages.
--
-- Y CADA RECHAZO COMPRUEBA SU ERROR. Un `WHEN OTHERS` da por buena cualquier
-- excepción: con una función mal escrita, «no existe» se leía como «denegado
-- correctamente» y el renglón decía PASA. Aquí solo valen `no autorizado`
-- (P0001) e `insufficient_privilege` (42501); cualquier otra cosa es FALLA y
-- se imprime el error para poder verlo.
-- SIN `BEGIN; … ROLLBACK;`, a propósito, y esto importa: el editor de Supabase
-- puede estar ejecutando el script dentro de UNA transacción. Un ROLLBACK ahí
-- no deshace solo las pruebas — deshace también los `CREATE OR REPLACE
-- FUNCTION` de arriba, y la migración se vería correr sin haber cambiado nada.
-- No hace falta: las pruebas solo LEEN (las dos funciones son STABLE y cada
-- rechazo levanta excepción antes de tocar una fila).
-- Y SIN TABLA TEMPORAL. La primera versión juntaba los resultados en una
-- `CREATE TEMP TABLE`, y el editor de Supabase avisaba de dos cosas: que el
-- script hace «operaciones destructivas» (el TRUNCATE y el DROP de esa tabla)
-- y que «crea una tabla sin RLS». Lo segundo es ruido —una tabla temporal vive
-- solo en esta sesión y PostgREST no la ve nunca—, pero acostumbrarse a pasar
-- por encima de un aviso es justo como se cuela el que sí importaba.
--
-- Así que los renglones viajan en una variable de sesión y se despliegan al
-- final: misma tabla en Results, sin crear ni borrar nada.
DO $p$
DECLARE
    v_neg TEXT; v_dueno UUID; v_staff UUID; v_otro UUID; v_r JSONB;
    v_out JSONB := '[]'::jsonb;        -- los renglones del informe
    OK_RECHAZO CONSTANT TEXT[] := ARRAY['P0001','42501'];
BEGIN
    SELECT n.id, n.usuario_id, n.staff_uid INTO v_neg, v_dueno, v_staff
      FROM negocios n ORDER BY n.created_at LIMIT 1;
    IF v_neg IS NULL THEN
        v_out := v_out || jsonb_build_array(jsonb_build_array(0,'SIN DATOS: no hay negocios','—',''));
        PERFORM set_config('etaax.v73', v_out::text, false);
        RETURN;   -- sin guardar aquí, el SELECT de abajo no encontraría nada
    END IF;

    -- 1 · sin sesión
    BEGIN
        SET LOCAL ROLE anon;
        v_r := negocio_cobro_estado(v_neg);
        RESET ROLE;
        v_out := v_out || jsonb_build_array(jsonb_build_array(1,'Un anónimo NO ve el cobro','FALLA','lo obtuvo'));
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        v_out := v_out || jsonb_build_array(jsonb_build_array(1,'Un anónimo NO ve el cobro',
            CASE WHEN SQLSTATE = ANY(OK_RECHAZO) THEN 'PASA' ELSE 'FALLA' END,
            SQLSTATE || ' · ' || SQLERRM));
    END;

    -- 2 · el dueño SÍ
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claims',
                 json_build_object('sub', v_dueno::text, 'role','authenticated')::text, true);
        v_r := negocio_cobro_estado(v_neg);
        RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
        v_out := v_out || jsonb_build_array(jsonb_build_array(2,'El dueño SÍ ve su cobro',
            CASE WHEN v_r ? 'estado' THEN 'PASA' ELSE 'FALLA' END, v_r::text));
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
        v_out := v_out || jsonb_build_array(jsonb_build_array(2,'El dueño SÍ ve su cobro','FALLA', SQLSTATE||' · '||SQLERRM));
    END;

    -- 3 · el STAFF de ese negocio también (lo pide el gate del colaborador)
    IF v_staff IS NULL THEN
        v_out := v_out || jsonb_build_array(jsonb_build_array(3,'El staff SÍ ve el cobro de SU negocio','SIN DATOS',
                                 'ese negocio no tiene cuenta de staff'));
    ELSE
        BEGIN
            SET LOCAL ROLE authenticated;
            PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_staff::text, 'role','authenticated')::text, true);
            v_r := negocio_cobro_estado(v_neg);
            RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
            v_out := v_out || jsonb_build_array(jsonb_build_array(3,'El staff SÍ ve el cobro de SU negocio',
                CASE WHEN v_r ? 'estado' THEN 'PASA' ELSE 'FALLA' END, v_r::text));
        EXCEPTION WHEN OTHERS THEN
            RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
            v_out := v_out || jsonb_build_array(jsonb_build_array(3,'El staff SÍ ve el cobro de SU negocio','FALLA',
                                     SQLSTATE||' · '||SQLERRM));
        END;
    END IF;

    -- 4 · una cuenta AJENA de verdad: ni dueña, ni staff, ni admin.
    SELECT u.id INTO v_otro
      FROM auth.users u
     WHERE u.id <> COALESCE(v_dueno,'00000000-0000-0000-0000-000000000000'::uuid)
       AND u.id IS DISTINCT FROM v_staff
       AND COALESCE(u.email,'') <> 'admin@etaax.com'
       AND NOT EXISTS (SELECT 1 FROM negocios n2
                        WHERE n2.id = v_neg
                          AND (n2.usuario_id = u.id OR n2.staff_uid = u.id))
     LIMIT 1;
    IF v_otro IS NULL THEN
        v_out := v_out || jsonb_build_array(jsonb_build_array(4,'Una cuenta ajena NO ve ese cobro','SIN DATOS',
                                 'no hay otra cuenta que no tenga acceso'));
    ELSE
        BEGIN
            SET LOCAL ROLE authenticated;
            PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_otro::text, 'role','authenticated')::text, true);
            v_r := negocio_cobro_estado(v_neg);
            RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
            v_out := v_out || jsonb_build_array(jsonb_build_array(4,'Una cuenta ajena NO ve ese cobro','FALLA',
                                     'lo obtuvo: '||v_r::text));
        EXCEPTION WHEN OTHERS THEN
            RESET ROLE; PERFORM set_config('request.jwt.claims', NULL, true);
            v_out := v_out || jsonb_build_array(jsonb_build_array(4,'Una cuenta ajena NO ve ese cobro',
                CASE WHEN SQLSTATE = ANY(OK_RECHAZO) THEN 'PASA' ELSE 'FALLA' END,
                SQLSTATE || ' · ' || SQLERRM));
        END;
    END IF;

    -- 5 · los permisos de las dos que solo usan políticas TO authenticated
    v_out := v_out || jsonb_build_array(jsonb_build_array(5,'anon ya no puede llamar etaax_puede_neg',
        CASE WHEN has_function_privilege('anon','etaax_puede_neg(text)','EXECUTE')
             THEN 'FALLA' ELSE 'PASA' END, ''));
    -- 6 · y las dos que NO se tocan, porque sus políticas no llevan TO
    v_out := v_out || jsonb_build_array(jsonb_build_array(6,'es_staff_de SIGUE abierta (sus políticas la necesitan)',
        CASE WHEN has_function_privilege('anon','es_staff_de(text)','EXECUTE')
             THEN 'PASA' ELSE 'FALLA' END, ''));

    -- 7 · DE PASO: ¿la v70 quedó de verdad aplicada? Llevaba un
    -- `BEGIN; … ROLLBACK;` al final, y si el editor ya tenía una transacción
    -- abierta, ese ROLLBACK pudo deshacer sus CREATE OR REPLACE. Esto lo
    -- resuelve mirando la definición VIVA, no el archivo.
    v_out := v_out || jsonb_build_array(jsonb_build_array(7,'La v70 quedó aplicada (nada autoriza con NULL)',
        CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                    WHERE ns.nspname='public'
                      AND p.proname IN ('entrada_token_asegurar','menu_token_asegurar',
                                        'menu_token_rotar','menu_cfg_guardar')
                      AND pg_get_functiondef(p.oid) LIKE '%IS NOT TRUE%') = 4
             THEN 'PASA' ELSE 'FALLA' END,
        CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
                    WHERE ns.nspname='public'
                      AND p.proname IN ('entrada_token_asegurar','menu_token_asegurar',
                                        'menu_token_rotar','menu_cfg_guardar')
                      AND pg_get_functiondef(p.oid) LIKE '%IS NOT TRUE%') = 4
             THEN 'las 4 definiciones vivas la llevan'
             ELSE 'VOLVER A CORRER LA v70 SIN su bloque BEGIN/ROLLBACK' END));

    PERFORM set_config('etaax.v73', v_out::text, false);
END
$p$;
SELECT (e->>0)::INT AS n,
       e->>1            AS prueba,
       e->>2            AS resultado,
       e->>3            AS detalle
  /* `true` = si la variable no existe, devuelve NULL en vez de reventar. Pasa
     si el bloque de arriba murió por algo no previsto: así se ve «sin
     resultados» en vez de un error que tapa el de verdad. */
  FROM jsonb_array_elements(COALESCE(current_setting('etaax.v73', true), '[]')::jsonb) AS e
 ORDER BY 1;

-- ============================================================================
-- Fin v73. Los siete renglones deben decir PASA (o SIN DATOS donde el negocio
-- de prueba no tenga staff / no haya otra cuenta).
-- ============================================================================
