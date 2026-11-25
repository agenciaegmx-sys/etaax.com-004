-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v93 — La clave entra solo si SU sucursal tiene la app, y la
--                         app sabe de qué sucursal es su QR (nombre y logo)
--
-- (Edwin, 25-nov) Con el QR de CUALQUIER sucursal activa entra el staff del
-- negocio COMPLETO —las 20 sucursales—, pero solo el de las sucursales que
-- tienen la app móvil activa. Lo mismo con usuario y contraseña (eso ya lo hace
-- movil_token desde la v92).
--
-- 1. _nip_guardia (origen: v79) es la primera puerta de TODAS las consultas de
--    la clave (entrada_validar_nip, entrada_registrar, portal_*, checklist_*…)
--    y solo la usan ellas. Ahora además pide que la sucursal de la persona
--    tenga la app (_movil_staff_ok). Sin sucursal asignada = del negocio
--    entero: entra si alguna sucursal la tiene (como en portal_recetas, donde
--    «sin asignar» ve todo). Una clave buena de una sucursal sin app NO se
--    anota como intento fallido.
--
-- 2. movil_estado (origen: v92) devuelve además el nombre, el giro y el logo de
--    la sucursal del QR, y el nombre y logo del negocio: la portada de la app
--    los pone arriba del teclado. Es lo que ya está impreso junto al QR pegado
--    en la barra; no sale nada que el QR no diga.
--
-- Requiere la v92. Correr a mano en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. ¿Su sucursal tiene la app? ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION _movil_staff_ok(p_neg TEXT, p_datos JSONB)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE
        WHEN NULLIF(p_datos->>'sucursalId', '') IS NULL
            THEN EXISTS (SELECT 1 FROM _movil_activas(p_neg))
        ELSE EXISTS (SELECT 1 FROM _movil_activas(p_neg) a WHERE a = p_datos->>'sucursalId')
    END;
$$;

-- ── 2. El guardia de la clave (base: v79, intacto salvo la sucursal) ───────
CREATE OR REPLACE FUNCTION _nip_guardia(p_neg TEXT, p_niphash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave  TEXT := _nip_clave(p_neg);
        r        login_intentos;
        v_ultimo TIMESTAMPTZ;
        v_pasado INT;
        v_espera INT;
        v_ok     BOOLEAN := FALSE;
        v_app    BOOLEAN := FALSE;
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

    SELECT TRUE, _movil_staff_ok(p_neg, s.datos) INTO v_ok, v_app
      FROM staff s
     WHERE s.negocio_id = p_neg
       AND s.datos->>'nipHash' = p_niphash
       -- EL CANDADO DE LA V63, el mismo COALESCE: los colaboradores viejos no
       -- traen `estado` y sin esto quedarían TODOS fuera de golpe.
       AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
     ORDER BY _movil_staff_ok(p_neg, s.datos) DESC
     LIMIT 1;

    IF (v_ok) IS TRUE AND (v_app) IS TRUE THEN
        IF v_habia THEN DELETE FROM login_intentos WHERE clave = v_clave; END IF;
        RETURN TRUE;   -- acertar limpia: el uso legítimo no gasta intentos
    END IF;

    -- (v93) LA CLAVE ES BUENA, PERO SU SUCURSAL NO TIENE LA APP MÓVIL. No entra,
    -- y NO se anota como fallo: no es alguien adivinando. El freno cuenta por
    -- negocio + IP —el wifi de la barra es uno solo—, así que anotarlo dejaría
    -- que una persona sin app, reintentando, bloqueara a todo el local.
    IF (v_ok) IS TRUE THEN
        RETURN FALSE;
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

-- ── 3. movil_estado: además, la sucursal del QR (para la portada) ──────────
-- Solo con un token que abre. El logo: el de la sucursal y, si no tiene, el del
-- negocio; solo una dirección (http) o una imagen chica (data:image, < 300 KB).
CREATE OR REPLACE FUNCTION _movil_logo(p TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p ~ '^https?://' OR (p ~ '^data:image/' AND length(p) < 300000) THEN p ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION movil_estado(p_neg TEXT, p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok BOOLEAN; v_suc TEXT; v_n JSONB; v_ns JSONB; v_s JSONB;
BEGIN
    v_ok  := _entrada_token_ok(p_neg, p_token);
    v_suc := _movil_sucursal_de(p_neg, p_token);
    IF v_ok IS NOT TRUE THEN
        RETURN jsonb_build_object('activo', false, 'sucursalId', NULL);
    END IF;
    SELECT datos INTO v_n FROM negocios WHERE id = p_neg;
    SELECT datos INTO v_ns FROM negocio_sucursales WHERE negocio_id = p_neg;
    IF v_suc IS NOT NULL THEN
        SELECT x INTO v_s
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_ns->'sucursales') = 'array'
                                         THEN v_ns->'sucursales' ELSE '[]'::jsonb END) x
         WHERE x->>'id' = v_suc LIMIT 1;
    END IF;
    RETURN jsonb_build_object(
        'activo', true,
        'sucursalId', v_suc,
        'negocio', COALESCE(v_n->>'nombre', ''),
        'sucursal', CASE WHEN v_suc IS NULL THEN NULL ELSE COALESCE(v_s->>'nombre', CASE WHEN v_suc = 'suc_principal' THEN 'Matriz' ELSE '' END) END,
        'giro', COALESCE(v_ns->'cfg'->v_suc->>'giro', v_n->>'tipo', ''),
        'logo', COALESCE(_movil_logo(v_ns->'cfg'->v_suc->>'_logo'), _movil_logo(v_n->>'logo')));
END;
$$;

REVOKE ALL ON FUNCTION _movil_staff_ok(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _movil_logo(TEXT)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION movil_estado(TEXT, TEXT)     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION movil_estado(TEXT, TEXT)  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Comprobación (sale en Results): colaboradores ACTIVOS por negocio, cuántos
-- entran a la app (su sucursal la tiene) y cuántos no.
SELECT s.negocio_id,
       count(*) FILTER (WHERE _movil_staff_ok(s.negocio_id, s.datos))     AS entran_a_la_app,
       count(*) FILTER (WHERE NOT _movil_staff_ok(s.negocio_id, s.datos)) AS su_sucursal_no_la_tiene
  FROM staff s
 WHERE COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
 GROUP BY s.negocio_id
 ORDER BY 1;
