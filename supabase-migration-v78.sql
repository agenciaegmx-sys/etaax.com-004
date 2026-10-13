-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · v78 — EL FRENO DE LOS NIP
--
-- Un NIP son CINCO dígitos: cien mil combinaciones. Sin freno, un programa las
-- prueba todas en un par de horas, de noche y sin que nadie se entere. El token
-- del QR no protege de esto —lo tiene
-- cualquiera que haya visto el código pegado en la pared— y el inventario
-- encontró DIEZ funciones públicas que aceptan un NIP, de las cuales solo una
-- tenía freno… y era el equivocado (ver abajo).
--
--
-- LAS DIEZ PUERTAS, Y POR QUÉ SE TOCAN CUATRO
--
--   Hacen su propia comprobación de NIP (se les pone el guardia):
--     · entrada_validar_nip       · portal_perfil
--     · entrada_sucursal_de_nip   · entrada_historial
--
--   Delegan en alguna de esas cuatro (quedan cubiertas, y ponerles su propio
--   guardia contaría DOS fallos por un solo intento):
--     · entrada_registrar          → entrada_validar_nip
--     · checklist_registrar        → entrada_validar_nip
--     · inventario_conteo_registrar→ entrada_validar_nip
--     · portal_recetas             → portal_perfil
--     · portal_guias               → portal_perfil
--     · checklist_plantillas       → portal_perfil
--
--   El candado del repo vigila que esto siga siendo cierto: toda función
--   pública que reciba un NIP tiene que llamar al guardia o delegar en una que
--   lo haga. Si mañana alguien agrega la número once, se entera.
--
--
-- EL LÍMITE Y LA ESPERA, dichos de una vez
--
--   Ventana: 15 minutos sin fallar y se olvida todo.
--   A partir del fallo 12, hay que esperar; y la espera CRECE si se insiste:
--       12 fallos →  1 minuto      18 fallos → 15 minutos
--       15 fallos →  5 minutos     24 fallos →  1 hora
--   Un NIP correcto BORRA el contador. Doce dedazos seguidos, sin un solo
--   acierto en medio, en menos de quince minutos: eso ya no es teclear mal.
--
--
-- SOLO SE CUENTAN LOS FALLOS — y esto es lo que hace que el QR siga sirviendo
--
--   Entrar por el QR no es una llamada: son varias seguidas con el MISMO NIP
--   (validar, perfil, recetas, guías, checklists…). Si cada una gastara un
--   intento, una persona legítima se quedaría fuera a la tercera entrada del
--   día. Por eso el guardia comprueba el NIP ÉL MISMO: si es bueno, no anota
--   nada y además limpia lo anterior; si es malo, anota uno.
--
--
-- LA LLAVE DEL CONTADOR: negocio + IP
--
--   Ni el NIP probado ni la función llamada entran en la llave, a propósito:
--   si entraran, bastaría cambiar de NIP —que es justo lo que hace quien
--   adivina— o llamar a otra de las diez para empezar de cero.
--
--   ¿Y por qué la IP, si no es perfecta? Porque sin ella el contador sería por
--   negocio a secas, y entonces UN teléfono desde la calle dejaría al
--   restaurante entero sin poder usar el QR. Con la IP, quien se equivoca se
--   frena a sí mismo. Lo que esto NO resuelve, dicho claro: las tablets de un
--   mismo local salen por la misma IP, así que alguien adentro puede frenar a
--   los de adentro — necesita doce fallos seguidos SIN que nadie acierte en
--   medio, porque cualquier acierto limpia el contador. Ese es el precio
--   elegido, y es el barato de los dos.
--
--
-- LO QUE NO CAMBIA (y hay que comprobar que no cambió)
--   · Los NIP de siempre siguen sirviendo: no se toca ni un dato.
--   · El dado de baja sigue sin pasar — el guardia aplica el mismo candado de
--     estado de la v63, con el mismo COALESCE (sin estado capturado = activo).
--   · La sucursal, el área y el nombre de quien captura salen igual que antes:
--     los cuerpos de las cuatro funciones NO se reescribieron, se les antepuso
--     una línea. Así se perdió el freno en la v63, reescribiendo.
--   · `anon` sigue pudiendo llamarlas: el QR no tiene sesión.
--
-- Idempotente. No toca datos.
-- ════════════════════════════════════════════════════════════════════════════

-- ── La columna que faltaba para saber CUÁNDO fue el último fallo ───────────
-- `login_intentos` (v30) solo guarda el inicio de la ventana. La espera se
-- cuenta desde el último intento, no desde el primero.
ALTER TABLE login_intentos ADD COLUMN IF NOT EXISTS ultimo TIMESTAMPTZ;

-- ── La escalera, en un solo lugar y legible de un golpe ────────────────────
CREATE OR REPLACE FUNCTION _nip_espera(p_fallos INT)
RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_fallos >= 24 THEN 3600
        WHEN p_fallos >= 18 THEN 900
        WHEN p_fallos >= 15 THEN 300
        WHEN p_fallos >= 12 THEN 60
        ELSE 0
    END;
$$;

-- ── La llave del contador: negocio + IP ────────────────────────────────────
-- `_login_ip()` (v56) saca la IP real de la cabecera que pone PostgREST. En el
-- editor de SQL no hay cabeceras y devuelve NULL: por eso el 'sin-ip', que
-- mantiene la llave válida para probar desde aquí.
CREATE OR REPLACE FUNCTION _nip_clave(p_neg TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT 'nip|' || coalesce(p_neg, '') || '|' || coalesce(_login_ip(), 'sin-ip');
$$;

-- ── EL GUARDIA ─────────────────────────────────────────────────────────────
-- Hace las tres cosas en el orden que importa:
--   1. ¿Está frenado? → se queja diciendo CUÁNTOS SEGUNDOS faltan.
--   2. ¿El NIP es de alguien activo de ese negocio? → limpia y deja pasar.
--   3. Si no → anota el fallo y dice que no.
--
-- Comprueba el NIP él mismo a propósito: es lo que permite no cobrarle un
-- intento al uso legítimo, que hace varias llamadas seguidas con el mismo NIP.
CREATE OR REPLACE FUNCTION _nip_guardia(p_neg TEXT, p_niphash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave  TEXT := _nip_clave(p_neg);
        r        login_intentos;
        v_ultimo TIMESTAMPTZ;
        v_espera INT;
        v_falta  INT;
        v_ok     BOOLEAN := FALSE;
BEGIN
    IF p_neg IS NULL OR p_niphash IS NULL OR p_niphash = '' THEN RETURN FALSE; END IF;

    SELECT * INTO r FROM login_intentos WHERE clave = v_clave;
    IF FOUND THEN
        -- Las filas que escribe `_login_golpe` (v30) no traen `ultimo`. Esas
        -- llaves son otras ('staff|…', 'cred|…'), pero el COALESCE evita que un
        -- NULL se lleve la comparación por delante.
        v_ultimo := COALESCE(r.ultimo, r.ventana_inicio);
        IF v_ultimo > now() - interval '15 minutes' THEN
            v_espera := _nip_espera(r.intentos);
            IF v_espera > 0 THEN
                v_falta := v_espera - EXTRACT(EPOCH FROM (now() - v_ultimo))::INT;
                IF v_falta > 0 THEN
                    -- El mensaje lleva los segundos para que la pantalla pueda
                    -- decir cuánto falta en vez de un "no se pudo".
                    RAISE EXCEPTION 'nip_espera:%', v_falta;
                END IF;
            END IF;
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
        IF FOUND OR r.clave IS NOT NULL THEN
            DELETE FROM login_intentos WHERE clave = v_clave;   -- acertar limpia
        END IF;
        RETURN TRUE;
    END IF;

    INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
    VALUES (v_clave, 1, now(), now())
    ON CONFLICT (clave) DO UPDATE
       SET intentos = CASE WHEN COALESCE(login_intentos.ultimo, login_intentos.ventana_inicio)
                                < now() - interval '15 minutes'
                           THEN 1 ELSE login_intentos.intentos + 1 END,
           ventana_inicio = CASE WHEN COALESCE(login_intentos.ultimo, login_intentos.ventana_inicio)
                                < now() - interval '15 minutes'
                           THEN now() ELSE login_intentos.ventana_inicio END,
           ultimo = now();
    RETURN FALSE;
END;
$$;

-- Internas: nadie las llama de fuera. En Supabase toda función nueva de
-- `public` nace con EXECUTE concedido a `anon` POR GRANT DIRECTO, así que
-- quitarlo de PUBLIC no alcanza — hay que nombrarlos (hallazgo de la v71).
REVOKE ALL ON FUNCTION _nip_espera(INT)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _nip_clave(TEXT)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _nip_guardia(TEXT, TEXT)  FROM PUBLIC, anon, authenticated;


-- ── entrada_validar_nip  (base: la definición de la v63) ──
-- Y SALE su freno viejo: contaba por negocio y SIN IP, así que un solo
-- teléfono equivocándose bloqueaba a todo el local. Lo reemplaza el guardia.
CREATE OR REPLACE FUNCTION entrada_validar_nip(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN NULL; END IF;
    IF p_niphash IS NULL OR p_niphash = '' OR NOT _entrada_token_ok(p_neg, p_token) THEN
        RETURN NULL;
    END IF;
    SELECT s.datos->>'nombre' INTO v_nombre
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
      AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
    LIMIT 1;
    RETURN v_nombre;
END;
$$;
-- ── portal_perfil  (base: la definición de la v65) ──
-- Era LANGUAGE sql (una sola consulta). Se envuelve en plpgsql SIN tocar la
-- consulta —va entera entre paréntesis— porque el guardia tiene que correr
-- ANTES, y una condición más en el WHERE ni siquiera garantiza que se evalúe.
CREATE OR REPLACE FUNCTION portal_perfil(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r JSONB;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN NULL; END IF;
    v_r := (SELECT jsonb_build_object(
            'nombre', s.datos->>'nombre',
            'puesto', s.datos->>'puesto',
            -- El ROL del sistema: lista cerrada, no se presta a interpretación. Es
            -- el segundo escalón de la jerarquía con la que el cliente resuelve el
            -- área (campo a mano → rol → puesto).            [lo agregó la v64]
            'rol',      s.datos->>'rol',
            -- El campo TAL CUAL, sin rellenar: '' significa «no capturado», que es
            -- un hecho distinto de «administración».          [lo agregó la v64]
            'areaReal', COALESCE(s.datos->>'area', ''),
            -- Sin área asignada se asume ADMINISTRACIÓN, la más restrictiva en lo
            -- operativo. Lo leen portal_recetas y portal_guias: bajarle el default
            -- les abriría contenido a quien hoy no lo ve.
            'area',   COALESCE(NULLIF(s.datos->>'area',''), 'administracion'),
            -- LA SUCURSAL DE LA PERSONA. Lo leen portal_recetas (v57), el recetario
            -- (v58) y checklist_plantillas (v59) para enseñar la copia que le toca.
            -- La v64 lo perdió y todos cayeron a Matriz.      [vuelve de la v63]
            'sucursalId', COALESCE(NULLIF(s.datos->>'sucursalId',''), 'suc_principal'),
            -- Se devuelve el estado para que el cliente pueda DECIRLO. El candado
            -- real es el WHERE de abajo; esto es solo para explicar.
            'estado', COALESCE(NULLIF(s.datos->>'estado',''), 'Activo')
        )
        FROM staff s
        WHERE s.negocio_id = p_neg
          AND s.datos->>'nipHash' = p_niphash
          -- EL CANDADO DE LA V63. Solo pasa quien está ACTIVO. El COALESCE importa:
          -- los colaboradores viejos no traen el campo y sin él quedarían TODOS
          -- fuera de golpe. Sin estado capturado = activo, como siempre se comportó.
          AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
          AND p_niphash IS NOT NULL AND p_niphash <> ''
          AND _entrada_token_ok(p_neg, p_token)
        LIMIT 1);
    RETURN v_r;
END;
$$;

-- ── entrada_sucursal_de_nip  (base: la definición de la v65) ──
-- Misma envoltura que portal_perfil, y por lo mismo.
CREATE OR REPLACE FUNCTION entrada_sucursal_de_nip(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r TEXT;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN NULL; END IF;
    v_r := (SELECT COALESCE(NULLIF(s.datos->>'sucursalId',''), 'suc_principal')
        FROM staff s
        WHERE s.negocio_id = p_neg
          AND s.datos->>'nipHash' = p_niphash
          AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
          AND p_niphash IS NOT NULL AND p_niphash <> ''
          AND _entrada_token_ok(p_neg, p_token)
        LIMIT 1);
    RETURN v_r;
END;
$$;

-- ── entrada_historial  (base: la definición de la v67) ──
-- 108 líneas que NO se retranscriben: el cuerpo sale tal cual del repo y solo
-- se le antepone el guardia. Reescribir es como la v63 perdió el freno.
-- Su "no" NO es NULL: devuelve {ok:false, motivo:'nip'}, que es lo que lee
-- entrada.html para decir «Tu NIP ya no es válido». El guardia lo respeta.
CREATE OR REPLACE FUNCTION entrada_historial(
    p_neg     TEXT,
    p_token   TEXT,
    p_niphash TEXT,
    p_suc     TEXT,
    p_area    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_desde TEXT;
    v_inv   TEXT;
    v_movs  JSONB;
    v_cnts  JSONB;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN jsonb_build_object('ok', false, 'motivo', 'nip'); END IF;
    -- Mismas dos llaves que para escribir: el token del QR y el NIP de la
    -- persona. Sin las dos, no se devuelve nada.
    IF NOT _entrada_token_ok(p_neg, p_token) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'token');
    END IF;
    IF p_niphash IS NULL OR p_niphash = ''
       OR NOT EXISTS (SELECT 1 FROM staff s
                       WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nip');
    END IF;

    /* El corte del periodo: el último inventario CERRADO de esta sucursal y
       área. `cierreOperativo` es el momento real en que terminó el conteo;
       los inventarios viejos no lo traen, así que se usa el final de su día. */
    SELECT COALESCE(i.datos->>'cierreOperativo', (i.datos->>'fecha') || 'T23:59:59'),
           i.datos->>'nombre'
      INTO v_desde, v_inv
      FROM inventarios i
     WHERE i.negocio_id = p_neg
       AND (i.datos->>'cerrado')::boolean IS TRUE
       AND COALESCE(NULLIF(i.datos->>'sucursalId', ''), 'suc_principal')
           = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
       AND (p_area IS NULL OR p_area = '' OR i.datos->>'area' = p_area)
     ORDER BY COALESCE(i.datos->>'cierreOperativo', i.datos->>'fecha') DESC
     LIMIT 1;

    /* Movimientos del periodo. Se ordenan del más nuevo al más viejo: lo que
       acaba de capturar el compañero es lo que hay que ver primero. */
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'registrado' DESC), '[]'::jsonb)
      INTO v_movs
      FROM (
        SELECT jsonb_build_object(
                 'concepto',  e.datos->>'concepto',
                 'nombre',    e.datos->>'nombre',
                 'cantidad',  e.datos->>'cantidad',
                 'unidad',    e.datos->>'unidad',
                 'fecha',     e.datos->>'fecha',
                 'hora',      e.datos->>'hora',
                 'quien',     e.datos->>'registradoPor',
                 'registrado', COALESCE(e.datos->>'registrado', e.created_at::text)
               ) AS x
          FROM entradas_log e
         WHERE e.negocio_id = p_neg
           AND COALESCE(e.datos->>'borrada', 'false') <> 'true'
           AND COALESCE(NULLIF(e.datos->>'sucursalId', ''), 'suc_principal')
               = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
           AND (v_desde IS NULL
                OR COALESCE(e.datos->>'registrado', e.created_at::text) > v_desde)
      ) t;

    /* Conteos: lo que ya se contó en este periodo. Es el dato que evita el
       trabajo repetido — el más caro de todos en un inventario. */
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'creado' DESC), '[]'::jsonb)
      INTO v_cnts
      FROM (
        SELECT jsonb_build_object(
                 'nombre', c.datos->>'nombre',
                 -- LA CANTIDAD ERA LO ÚNICO QUE NO VIAJABA. La pantalla decía
                 -- qué producto y a qué hora, pero no CUÁNTO — que es el dato
                 -- por el que se entra a mirar: «¿ya conté la cava?» se
                 -- responde con el número, no con la hora.
                 'cerradasBodega', c.datos->>'cerradasBodega',
                 'cerradasBarra',  c.datos->>'cerradasBarra',
                 -- Identidad del producto: con tres estilos de Bohemia, tres
                 -- renglones que dicen «Bohemia» no se distinguen. `meta` la
                 -- guarda el celular al contar; `insumoId` deja que los
                 -- conteos VIEJOS —que no la traen— se resuelvan contra el
                 -- catálogo que ya tiene cargado la pantalla.
                 'meta',     c.datos->>'meta',
                 'insumoId', c.datos->>'insumoId',
                 'nota',   NULLIF(c.datos->>'nota', ''),
                 'fecha',  c.datos->>'fecha',
                 'hora',   c.datos->>'hora',
                 'quien',  c.datos->>'registradoPor',
                 'creado', c.created_at::text
               ) AS x
          FROM inventario_conteos c
         WHERE c.negocio_id = p_neg
           AND COALESCE(NULLIF(c.datos->>'sucursalId', ''), 'suc_principal')
               = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
           AND (p_area IS NULL OR p_area = '' OR c.datos->>'area' = p_area)
           AND (v_desde IS NULL OR c.created_at::text > v_desde)
      ) t;

    RETURN jsonb_build_object(
        'ok',          true,
        'desde',       v_desde,
        'inventario',  v_inv,
        'movimientos', v_movs,
        'conteos',     v_cnts
    );
END;
$$;

-- ── Los permisos que el QR necesita, intactos ──────────────────────────────
-- `CREATE OR REPLACE` conserva los permisos, pero se repiten aquí para que
-- queden a la vista: estas cuatro las llama un celular SIN sesión.
REVOKE ALL ON FUNCTION entrada_validar_nip(TEXT, TEXT, TEXT)            FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_validar_nip(TEXT, TEXT, TEXT)         TO anon, authenticated;
REVOKE ALL ON FUNCTION portal_perfil(TEXT, TEXT, TEXT)                  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_perfil(TEXT, TEXT, TEXT)               TO anon, authenticated;
REVOKE ALL ON FUNCTION entrada_sucursal_de_nip(TEXT, TEXT, TEXT)        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_sucursal_de_nip(TEXT, TEXT, TEXT)     TO anon, authenticated;
REVOKE ALL ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT)      FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT)   TO anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — una sola instrucción (el editor solo enseña la última).
--
-- Los renglones 1, 2 y 3 no leen definiciones: CORREN el guardia. Una prueba
-- que busca un texto en el código sobrevive a que el código deje de funcionar.
--
-- Las tres sondas se quedan puestas y sin permisos para nadie: si el DROP fuera
-- la última instrucción, el editor enseñaría el resultado del DROP —nada— y
-- esta tabla no se vería. Para borrarlas a mano:
--     DROP FUNCTION IF EXISTS _v78_probar_freno();
--     DROP FUNCTION IF EXISTS _v78_probar_recuperacion();
--     DROP FUNCTION IF EXISTS _v78_probar_acierto();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _v78_probar_freno()
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE i INT; v_neg TEXT := '__prueba_v78__'; v_res TEXT := 'NO FRENÓ en 20 intentos';
BEGIN
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
    FOR i IN 1..20 LOOP
        BEGIN
            PERFORM _nip_guardia(v_neg, 'nip-inexistente-v78');
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE 'nip_espera:%' THEN
                v_res := 'frenó en el intento ' || i || ', pide esperar ' ||
                         split_part(SQLERRM, ':', 2) || ' s';
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

CREATE OR REPLACE FUNCTION _v78_probar_recuperacion()
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE v_neg TEXT := '__prueba_v78__'; v_res TEXT;
BEGIN
    -- Doce fallos, pero el último hace dos minutos: la espera era de uno.
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
    INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
    VALUES (_nip_clave(v_neg), 12, now() - interval '3 minutes', now() - interval '2 minutes');
    BEGIN
        PERFORM _nip_guardia(v_neg, 'nip-inexistente-v78');
        v_res := 'cumplida la espera, vuelve a dejar intentar';
    EXCEPTION WHEN OTHERS THEN
        v_res := 'SIGUE FRENADO de más: ' || SQLERRM;
    END;
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
    RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION _v78_probar_acierto()
RETURNS TEXT LANGUAGE plpgsql VOLATILE AS $$
DECLARE v_neg TEXT; v_hash TEXT; v_quedan INT;
BEGIN
    SELECT s.negocio_id, s.datos->>'nipHash' INTO v_neg, v_hash
      FROM staff s
     WHERE COALESCE(s.datos->>'nipHash', '') <> ''
       AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
     LIMIT 1;
    IF v_neg IS NULL THEN RETURN 'ningún colaborador tiene NIP capturado: no se pudo probar'; END IF;
    -- Se ensucia el contador a propósito y se entra bien.
    INSERT INTO login_intentos (clave, intentos, ventana_inicio, ultimo)
    VALUES (_nip_clave(v_neg), 5, now(), now())
    ON CONFLICT (clave) DO UPDATE SET intentos = 5, ultimo = now();
    IF NOT _nip_guardia(v_neg, v_hash) THEN
        DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
        RETURN 'EL NIP BUENO NO PASÓ';
    END IF;
    SELECT count(*) INTO v_quedan FROM login_intentos WHERE clave = _nip_clave(v_neg);
    DELETE FROM login_intentos WHERE clave = _nip_clave(v_neg);
    RETURN CASE WHEN v_quedan = 0
                THEN 'el NIP bueno pasa, no gasta intentos y limpia el contador'
                ELSE 'pasó pero NO limpió el contador' END;
END;
$$;

REVOKE ALL ON FUNCTION _v78_probar_freno()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _v78_probar_recuperacion()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _v78_probar_acierto()       FROM PUBLIC, anon, authenticated;

WITH r AS (
    SELECT 1 AS n, 'el freno PARA de verdad al que adivina' AS prueba,
           CASE WHEN f.res LIKE 'frenó en el intento 13%' THEN 'PASA' ELSE 'FALLA' END AS resultado,
           f.res AS detalle
      FROM _v78_probar_freno() AS f(res)

    UNION ALL
    SELECT 2, 'cumplida la espera, se puede volver a intentar',
           CASE WHEN g.res LIKE 'cumplida%' THEN 'PASA' ELSE 'FALLA' END, g.res
      FROM _v78_probar_recuperacion() AS g(res)

    UNION ALL
    SELECT 3, 'el uso legítimo NO gasta intentos (varias llamadas con el mismo NIP)',
           CASE WHEN a.res LIKE 'el NIP bueno pasa%' THEN 'PASA'
                WHEN a.res LIKE 'ningún colaborador%' THEN 'DATO' ELSE 'FALLA' END, a.res
      FROM _v78_probar_acierto() AS a(res)

    UNION ALL
    -- Las cuatro que comprueban el NIP tienen que llamar al guardia…
    SELECT 4, 'las 4 puertas que comprueban el NIP llaman al guardia',
           CASE WHEN count(*) = 4 THEN 'PASA' ELSE 'FALLA' END,
           count(*)::text || ' de 4: ' || COALESCE(string_agg(p.proname, ', ' ORDER BY p.proname), '—')
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('entrada_validar_nip','portal_perfil','entrada_sucursal_de_nip','entrada_historial')
       AND pg_get_functiondef(p.oid) LIKE '%_nip_guardia%'

    UNION ALL
    -- …y las otras seis tienen que seguir delegando en ellas.
    -- Se les exige solo a las que EXISTEN: contra 6 a secas, una base donde
    -- alguna no esté instalada daría FALLA sin que nada esté mal.
    SELECT 5, 'las otras puertas siguen delegando (no se les cuenta dos veces)',
           CASE WHEN count(*) = count(*) FILTER (WHERE delega) THEN 'PASA' ELSE 'FALLA' END,
           count(*) FILTER (WHERE delega)::text || ' de ' || count(*)::text || ' instaladas' ||
           COALESCE(', sin delegar: ' || NULLIF(string_agg(proname, ', ') FILTER (WHERE NOT delega), ''), '')
      FROM (
        SELECT p.proname,
               (pg_get_functiondef(p.oid) LIKE '%entrada_validar_nip%'
             OR pg_get_functiondef(p.oid) LIKE '%portal_perfil%') AS delega
          FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public'
           AND p.proname IN ('entrada_registrar','checklist_registrar','inventario_conteo_registrar',
                             'portal_recetas','portal_guias','checklist_plantillas')
      ) d

    UNION ALL
    -- El QR no tiene sesión: si esto falla, se cae el QR entero.
    SELECT 6, 'el QR sigue pudiendo llamarlas sin sesión (anon)',
           CASE WHEN has_function_privilege('anon','entrada_validar_nip(text,text,text)','EXECUTE')
                 AND has_function_privilege('anon','portal_perfil(text,text,text)','EXECUTE')
                 AND has_function_privilege('anon','entrada_historial(text,text,text,text,text)','EXECUTE')
                 AND has_function_privilege('anon','portal_recetas(text,text,text)','EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END,
           'validar=' || has_function_privilege('anon','entrada_validar_nip(text,text,text)','EXECUTE')::text ||
           ' perfil=' || has_function_privilege('anon','portal_perfil(text,text,text)','EXECUTE')::text ||
           ' historial=' || has_function_privilege('anon','entrada_historial(text,text,text,text,text)','EXECUTE')::text ||
           ' recetas=' || has_function_privilege('anon','portal_recetas(text,text,text)','EXECUTE')::text

    UNION ALL
    SELECT 7, 'el guardia NO se puede llamar directo desde fuera',
           CASE WHEN has_function_privilege('anon','_nip_guardia(text,text)','EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END,
           'anon=' || has_function_privilege('anon','_nip_guardia(text,text)','EXECUTE')::text ||
           ' · con sesión=' || has_function_privilege('authenticated','_nip_guardia(text,text)','EXECUTE')::text

    UNION ALL
    SELECT 8, 'el dado de baja sigue sin pasar (candado de la v63 dentro del guardia)',
           CASE WHEN pg_get_functiondef(p.oid) LIKE '%estado%Activo%' THEN 'PASA' ELSE 'FALLA' END,
           'y la ventana es de 15 minutos=' ||
           (pg_get_functiondef(p.oid) LIKE '%15 minutes%')::text
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = '_nip_guardia'

    UNION ALL
    SELECT 9, 'cuántos negocios están frenados AHORA MISMO', 'DATO',
           (SELECT count(*)::text FROM login_intentos WHERE clave LIKE 'nip|%'
             AND COALESCE(ultimo, ventana_inicio) > now() - interval '15 minutes'
             AND _nip_espera(intentos) > 0) || ' llaves con espera activa'
)
SELECT n AS "#", prueba, resultado, detalle
  FROM r
 ORDER BY CASE resultado WHEN 'FALLA' THEN 0 WHEN 'DATO' THEN 2 ELSE 1 END, n;
