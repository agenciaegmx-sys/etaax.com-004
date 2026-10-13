-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · v79 — DOS AGUJEROS DEL FRENO DE NIP (los encontró Codex supervisando)
--
-- La v78 puso el freno y la comprobación salió 8 PASA. Las dos cosas de abajo
-- se le escaparon a esa comprobación, y las dos dejaban seguir adivinando.
--
--
-- 1) UNA EXCEPCIÓN SE LLEVA POR DELANTE EL FALLO QUE ACABAS DE ANOTAR
--
--    Las tres puertas que ESCRIBEN —entradas, check lists y conteos— delegan en
--    `entrada_validar_nip`, que llama al guardia. Con un NIP malo el guardia
--    anotaba el fallo y devolvía NULL… y entonces la función de escritura hacía
--    `RAISE EXCEPTION 'no autorizado'`.
--
--    Y ahí se perdía todo: en PostgreSQL una excepción revierte la transacción
--    ENTERA, y el apunte del contador iba dentro. El rechazo funcionaba —no se
--    guardaba nada— pero el intento desaparecía. Codex probó 30 NIP distintos
--    por cada una de las tres: 30 rechazos, 0 bloqueos, contador vacío.
--
--    El arreglo son tres líneas: donde decía `RAISE EXCEPTION 'no autorizado'`
--    ahora dice `RETURN NULL`. Rechaza igual y el fallo queda anotado.
--
--    POR QUÉ LA PRUEBA DE LA v78 NO LO VIO, que es lo que más vale de este
--    hallazgo: probaba esas tres puertas cuando el contador YA estaba bloqueado
--    desde otra función. Eso demuestra que OBEDECEN un bloqueo, no que lo
--    PROVOQUEN. Toda puerta se prueba desde el contador en cero, siempre.
--
--    OJO, y por eso va junto: el cliente leía solo `r.error`. Devolver NULL sin
--    tocar las pantallas habría hecho que un rechazo se viera como «guardado»
--    y la captura se borrara de la lista. Va arreglado en el mismo lote.
--
--
-- 2) LA ESPERA DE UNA HORA SE EVAPORABA A LOS QUINCE MINUTOS
--
--    El guardia usaba un solo plazo para dos cosas distintas: «cuánto hay que
--    esperar» y «cuándo se olvidan los fallos». Como los fallos se olvidaban a
--    los 15 minutos, una espera de 60 minutos no llegaba viva al minuto 16: el
--    contador se reiniciaba y volvía a dejar probar.
--
--    Ahora son dos plazos separados:
--      · BLOQUEO: lo que dice la escalera (1, 5, 15 o 60 minutos), y dura eso.
--      · OLVIDO: el mayor entre 15 minutos y el bloqueo vigente. Así nunca se
--        olvida un castigo antes de cumplirse, y quien se equivocó un par de
--        veces sigue limpiando a los 15 minutos, como siempre.
--
-- Idempotente. No toca datos.
-- ════════════════════════════════════════════════════════════════════════════

-- ── El plazo de OLVIDO, aparte del de bloqueo ──────────────────────────────
-- Quince minutos para quien se equivocó un par de veces; y nunca menos que el
-- castigo vigente, para que una espera de una hora no se borre a los quince
-- minutos — que es justo lo que pasaba.
CREATE OR REPLACE FUNCTION _nip_olvidado(p_fallos INT, p_ultimo TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXTRACT(EPOCH FROM (now() - p_ultimo))::INT
           > GREATEST(900, _nip_espera(p_fallos));
$$;
REVOKE ALL ON FUNCTION _nip_olvidado(INT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ── 2) El guardia, con los dos plazos separados ────────────────────────────
CREATE OR REPLACE FUNCTION _nip_guardia(p_neg TEXT, p_niphash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave  TEXT := _nip_clave(p_neg);
        r        login_intentos;
        v_ultimo TIMESTAMPTZ;
        v_pasado INT;
        v_espera INT;
        v_ok     BOOLEAN := FALSE;
        v_habia  BOOLEAN := FALSE;
BEGIN
    IF p_neg IS NULL OR p_niphash IS NULL OR p_niphash = '' THEN RETURN FALSE; END IF;

    SELECT * INTO r FROM login_intentos WHERE clave = v_clave;
    IF FOUND THEN
        v_habia  := TRUE;
        -- Las filas de `_login_golpe` (v30) no traen `ultimo`. Son otras llaves,
        -- pero el COALESCE evita que un NULL se lleve la comparación por delante.
        v_ultimo := COALESCE(r.ultimo, r.ventana_inicio);
        v_pasado := EXTRACT(EPOCH FROM (now() - v_ultimo))::INT;
        v_espera := _nip_espera(r.intentos);
        -- EL BLOQUEO NO DEPENDE DE LA VENTANA DE OLVIDO. Antes sí, y por eso una
        -- espera de una hora se evaporaba a los quince minutos.
        IF v_espera > v_pasado THEN
            RAISE EXCEPTION 'nip_espera:%', (v_espera - v_pasado);
        END IF;
    END IF;

    SELECT TRUE INTO v_ok
      FROM staff s
     WHERE s.negocio_id = p_neg
       AND s.datos->>'nipHash' = p_niphash
       -- EL CANDADO DE LA V63, el mismo COALESCE: los colaboradores viejos no
       -- traen `estado` y sin esto quedarían TODOS fuera de golpe.
       AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
     LIMIT 1;

    IF (v_ok) IS TRUE THEN
        IF v_habia THEN DELETE FROM login_intentos WHERE clave = v_clave; END IF;
        RETURN TRUE;   -- acertar limpia: el uso legítimo no gasta intentos
    END IF;

    -- Se anota el fallo. Se reinicia desde 1 solo si ya se OLVIDÓ: quince
    -- minutos sin fallar Y la espera que tocaba, ya cumplida.
    INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
    VALUES (v_clave, 1, now(), now())
    ON CONFLICT (clave) DO UPDATE
       SET intentos = CASE WHEN _nip_olvidado(login_intentos.intentos,
                                COALESCE(login_intentos.ultimo, login_intentos.ventana_inicio))
                           THEN 1 ELSE login_intentos.intentos + 1 END,
           ventana_inicio = CASE WHEN _nip_olvidado(login_intentos.intentos,
                                COALESCE(login_intentos.ultimo, login_intentos.ventana_inicio))
                           THEN now() ELSE login_intentos.ventana_inicio END,
           ultimo = now();
    RETURN FALSE;
END;
$$;
REVOKE ALL ON FUNCTION _nip_guardia(TEXT, TEXT) FROM PUBLIC, anon, authenticated;


-- ── 3) Las tres puertas que ESCRIBEN: rechazar sin perder el apunte ───────
-- ── entrada_registrar  (base: la definición de la v27, intacta salvo el rechazo) ──
CREATE OR REPLACE FUNCTION entrada_registrar(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        -- AQUÍ NO SE LANZA EXCEPCIÓN, Y ES TODO EL ARREGLO DE LA v79.
        -- El guardia ya anotó el fallo un instante antes. Una excepción revierte
        -- la transacción entera —incluido ese apunte—, así que por esta puerta
        -- se podían probar NIP toda la noche sin que el contador subiera jamás.
        -- Devolver NULL rechaza igual y deja el fallo anotado.
        RETURN NULL;
    END IF;
    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));
    INSERT INTO entradas_log (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object('registradoPor', v_nombre, 'origen', 'qr'));
    RETURN v_id;
END;
$$;
-- ── checklist_registrar  (base: la definición de la v38, intacta salvo el rechazo) ──
CREATE OR REPLACE FUNCTION checklist_registrar(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        -- AQUÍ NO SE LANZA EXCEPCIÓN, Y ES TODO EL ARREGLO DE LA v79.
        -- El guardia ya anotó el fallo un instante antes. Una excepción revierte
        -- la transacción entera —incluido ese apunte—, así que por esta puerta
        -- se podían probar NIP toda la noche sin que el contador subiera jamás.
        -- Devolver NULL rechaza igual y deja el fallo anotado.
        RETURN NULL;
    END IF;
    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));
    INSERT INTO checklist_ejecuciones (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object('colaborador', v_nombre, 'origen', 'qr'));
    RETURN v_id;
END;
$$;
-- ── inventario_conteo_registrar  (base: la definición de la v76, intacta salvo el rechazo) ──
CREATE OR REPLACE FUNCTION inventario_conteo_registrar(
    p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT; v_filas INT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        -- AQUÍ NO SE LANZA EXCEPCIÓN, Y ES TODO EL ARREGLO DE LA v79.
        -- El guardia ya anotó el fallo un instante antes. Una excepción revierte
        -- la transacción entera —incluido ese apunte—, así que por esta puerta
        -- se podían probar NIP toda la noche sin que el contador subiera jamás.
        -- Devolver NULL rechaza igual y deja el fallo anotado.
        RETURN NULL;
    END IF;

    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));

    INSERT INTO inventario_conteos (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object(
                'contadoPor', v_nombre,
                'origen',     'qr',
                'registrado', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    ON CONFLICT (id) DO UPDATE
        SET datos = EXCLUDED.datos
        WHERE inventario_conteos.negocio_id = p_neg;

    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas = 0 THEN
        -- NEUTRO a propósito. «es de otro negocio» confirmaba que ese id
        -- existe en otro lado; esto rechaza igual sin decir por qué.
        RAISE EXCEPTION 'No se pudo registrar el conteo';
    END IF;

    RETURN v_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — una sola instrucción (el editor solo enseña la última).
--
-- Los renglones 1 a 5 CORREN las funciones; no leen definiciones. Y los tres
-- primeros empiezan con el contador EN CERO por cada puerta, que es justo lo
-- que no hacía la comprobación de la v78: probaba las puertas cuando ya estaban
-- bloqueadas desde otra, y eso solo demuestra que obedecen, no que cuenten.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _v79_probar_puerta(p_fn TEXT)
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE i INT; v_neg TEXT := '__prueba_v79__'; v_res TEXT := 'NO FRENÓ en 20 intentos';
BEGIN
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);   -- desde CERO
    FOR i IN 1..20 LOOP
        BEGIN
            EXECUTE format('SELECT %I($1, $2, $3, $4)', p_fn)
               USING v_neg, 'token-inexistente-v79', 'nip-inexistente-v79-' || i, '{}'::jsonb;
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE 'nip_espera:%' THEN
                v_res := 'frenó en el intento ' || i;
            ELSE
                v_res := 'ERROR inesperado: ' || SQLERRM;
            END IF;
            EXIT;
        END;
    END LOOP;
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
    RETURN v_res;
END;
$$;

-- El caso exacto de Codex: 24 fallos y el último hace 16 minutos. La escalera
-- promete una hora, así que debe seguir frenado unos 44 minutos más.
CREATE OR REPLACE FUNCTION _v79_probar_hora()
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE v_neg TEXT := '__prueba_v79__'; v_res TEXT; v_quedan INT;
BEGIN
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
    INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
    VALUES (_nip_clave(v_neg), 24, now() - interval '40 minutes', now() - interval '16 minutes');
    BEGIN
        PERFORM _nip_guardia(v_neg, 'nip-inexistente-v79');
        SELECT intentos INTO v_quedan FROM login_intentos WHERE clave = _nip_clave(v_neg);
        v_res := 'SE OLVIDÓ EL CASTIGO: dejó intentar y el contador quedó en ' || COALESCE(v_quedan, 0);
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'nip_espera:%' THEN
            v_res := 'sigue frenado, faltan ' ||
                     (split_part(SQLERRM, ':', 2)::INT / 60) || ' minutos';
        ELSE
            v_res := 'ERROR inesperado: ' || SQLERRM;
        END IF;
    END;
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
    RETURN v_res;
END;
$$;

-- …y cumplida la hora, sí se olvida: quien sirvió el castigo empieza de nuevo.
CREATE OR REPLACE FUNCTION _v79_probar_olvido()
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE v_neg TEXT := '__prueba_v79__'; v_res TEXT; v_n INT;
BEGIN
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
    INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
    VALUES (_nip_clave(v_neg), 24, now() - interval '3 hours', now() - interval '2 hours');
    BEGIN
        PERFORM _nip_guardia(v_neg, 'nip-inexistente-v79');
        SELECT intentos INTO v_n FROM login_intentos WHERE clave = _nip_clave(v_neg);
        v_res := CASE WHEN v_n = 1 THEN 'cumplido el castigo, el contador empieza de nuevo'
                      ELSE 'dejó intentar pero el contador quedó en ' || v_n END;
    EXCEPTION WHEN OTHERS THEN
        v_res := 'SIGUE FRENADO de más: ' || SQLERRM;
    END;
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
    RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION _v79_probar_puerta(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _v79_probar_hora()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _v79_probar_olvido()     FROM PUBLIC, anon, authenticated;

WITH r AS (
    SELECT 1 AS n, 'registrar una ENTRADA con NIP malo sí acumula fallos' AS prueba,
           CASE WHEN a.res = 'frenó en el intento 13' THEN 'PASA' ELSE 'FALLA' END AS resultado,
           a.res AS detalle
      FROM _v79_probar_puerta('entrada_registrar') AS a(res)

    UNION ALL
    SELECT 2, 'registrar un CHECK LIST con NIP malo sí acumula fallos',
           CASE WHEN b.res = 'frenó en el intento 13' THEN 'PASA' ELSE 'FALLA' END, b.res
      FROM _v79_probar_puerta('checklist_registrar') AS b(res)

    UNION ALL
    SELECT 3, 'registrar un CONTEO con NIP malo sí acumula fallos',
           CASE WHEN c.res = 'frenó en el intento 13' THEN 'PASA' ELSE 'FALLA' END, c.res
      FROM _v79_probar_puerta('inventario_conteo_registrar') AS c(res)

    UNION ALL
    SELECT 4, 'la espera de una hora NO se evapora a los 15 minutos',
           CASE WHEN d.res LIKE 'sigue frenado%' THEN 'PASA' ELSE 'FALLA' END, d.res
      FROM _v79_probar_hora() AS d(res)

    UNION ALL
    SELECT 5, '…y cumplido el castigo, sí se olvida (no queda marcado de por vida)',
           CASE WHEN e.res LIKE 'cumplido%' THEN 'PASA' ELSE 'FALLA' END, e.res
      FROM _v79_probar_olvido() AS e(res)

    UNION ALL
    SELECT 6, 'ninguna de las tres rechaza ya con una excepción (se llevaba el contador)',
           CASE WHEN count(*) = 0 THEN 'PASA' ELSE 'FALLA' END,
           CASE WHEN count(*) = 0 THEN 'las tres devuelven NULL'
                ELSE 'siguen lanzando: ' || string_agg(proname, ', ') END
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('entrada_registrar','checklist_registrar','inventario_conteo_registrar')
       AND pg_get_functiondef(p.oid) LIKE '%no autorizado%'

    UNION ALL
    SELECT 7, 'el conteo de OTRO negocio se sigue rechazando (R05, v76)',
           CASE WHEN pg_get_functiondef(p.oid) LIKE '%No se pudo registrar el conteo%'
                THEN 'PASA' ELSE 'FALLA' END,
           'esa excepción SÍ se queda: ahí no hay nada escrito que perder'
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'inventario_conteo_registrar'

    UNION ALL
    SELECT 8, 'el QR sigue pudiendo llamar las tres sin sesión (anon)',
           CASE WHEN has_function_privilege('anon','entrada_registrar(text,text,text,jsonb)','EXECUTE')
                 AND has_function_privilege('anon','checklist_registrar(text,text,text,jsonb)','EXECUTE')
                 AND has_function_privilege('anon','inventario_conteo_registrar(text,text,text,jsonb)','EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END,
           'entradas=' || has_function_privilege('anon','entrada_registrar(text,text,text,jsonb)','EXECUTE')::text ||
           ' checklists=' || has_function_privilege('anon','checklist_registrar(text,text,text,jsonb)','EXECUTE')::text ||
           ' conteos=' || has_function_privilege('anon','inventario_conteo_registrar(text,text,text,jsonb)','EXECUTE')::text
)
SELECT n AS "#", prueba, resultado, detalle
  FROM r
 ORDER BY CASE resultado WHEN 'FALLA' THEN 0 WHEN 'DATO' THEN 2 ELSE 1 END, n;
