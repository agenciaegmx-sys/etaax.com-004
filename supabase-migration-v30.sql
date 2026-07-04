-- ============================================================================
-- ETAAX — Migración v30: Endurecimiento del login de colaboradores
-- ----------------------------------------------------------------------------
-- 1) SANEA los hashes de contraseña "legacy" (reversibles: contenían base64 de
--    la contraseña) envolviéndolos en SHA-256 → formato 'v2L$<hex>'. Se calcula
--    desde el hash almacenado, SIN conocer la contraseña, así que no rompe el
--    login: el cliente (hub) calcula la misma envoltura al validar y migra a
--    'v2$' definitivo en el siguiente login exitoso.
--    ⚠️ SOLO toca el campo passwordHash de la tabla staff. NO borra registros
--    ni modifica ningún otro dato de los negocios.
-- 2) LÍMITE DE INTENTOS (anti fuerza bruta) en las funciones públicas de login:
--    staff_login, obtener_staff_cred, entrada_validar_nip. 10 intentos fallidos
--    por ventana de 15 minutos → bloqueo hasta que expire la ventana.
-- 3) staff_actualizar_hash: permite al hub migrar el hash de la nube a 'v2$'
--    demostrando conocimiento del hash anterior (mismo modelo de credencial).
--
-- Idempotente: re-ejecutable sin error. Correr en: Supabase → SQL Editor.
-- ============================================================================

-- ── 1) Saneo de hashes legacy (solo passwordHash con formato viejo) ─────────
-- sha256() es nativa de Postgres (no requiere pgcrypto).
UPDATE staff
SET datos = jsonb_set(
        datos, '{passwordHash}',
        to_jsonb('v2L$' || encode(sha256(convert_to('etaax-staff|' || (datos->>'passwordHash'), 'UTF8')), 'hex'))
    )
WHERE coalesce(datos->>'passwordHash', '') <> ''
  AND datos->>'passwordHash' NOT LIKE 'v2$%'
  AND datos->>'passwordHash' NOT LIKE 'v2L$%';

-- ── 2) Infraestructura de límite de intentos ────────────────────────────────
CREATE TABLE IF NOT EXISTS login_intentos (
    clave          TEXT PRIMARY KEY,          -- p.ej. 'staff|<usuario>'
    intentos       INT NOT NULL DEFAULT 0,
    ventana_inicio TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE login_intentos ENABLE ROW LEVEL SECURITY;
-- Sin políticas: nadie la toca directo; solo las funciones SECURITY DEFINER.

-- Registra un intento y dice si está permitido (false = bloqueado).
-- Ventana deslizante: 10 intentos / 15 min por clave.
CREATE OR REPLACE FUNCTION _login_golpe(p_clave TEXT)
RETURNS BOOLEAN
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
END;
$$;

-- Login exitoso → resetea el contador de esa clave.
CREATE OR REPLACE FUNCTION _login_exito(p_clave TEXT)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM login_intentos WHERE clave = p_clave;
$$;

-- Internas: no se exponen al anon.
REVOKE ALL ON FUNCTION _login_golpe(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _login_exito(TEXT) FROM PUBLIC, anon, authenticated;

-- ── 3) staff_login con límite de intentos (misma firma que v22) ─────────────
CREATE OR REPLACE FUNCTION staff_login(p_usuario TEXT, p_hash TEXT)
RETURNS TABLE (negocio_id TEXT, negocio_datos JSONB, staff_id TEXT, nombre TEXT, rol TEXT, sucursal_id TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave TEXT := 'staff|' || lower(coalesce(p_usuario, ''));
BEGIN
    IF p_usuario IS NULL OR p_hash IS NULL OR length(p_hash) = 0 THEN RETURN; END IF;
    IF NOT _login_golpe(v_clave) THEN
        RAISE EXCEPTION 'rate_limited';
    END IF;
    RETURN QUERY
    SELECT s.negocio_id,
           n.datos,
           s.id,
           s.datos->>'nombre',
           COALESCE(NULLIF(s.datos->>'rol', ''), 'otro'),
           NULLIF(s.datos->>'sucursalId', '')
    FROM staff s
    JOIN negocios n ON n.id = s.negocio_id
    WHERE s.datos->>'usuario' = p_usuario
      AND s.datos->>'passwordHash' = p_hash
    LIMIT 1;
    IF FOUND THEN PERFORM _login_exito(v_clave); END IF;
END;
$$;
REVOKE ALL ON FUNCTION staff_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_login(TEXT, TEXT) TO anon, authenticated;

-- ── 4) obtener_staff_cred con límite de intentos (misma firma que v20) ──────
CREATE OR REPLACE FUNCTION obtener_staff_cred(p_neg TEXT, p_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave TEXT := 'cred|' || coalesce(p_neg, '');
        v_cred JSONB;
BEGIN
    IF p_neg IS NULL OR p_hash IS NULL OR length(p_hash) = 0 THEN RETURN NULL; END IF;
    IF NOT _login_golpe(v_clave) THEN
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
      );
    IF v_cred IS NOT NULL THEN PERFORM _login_exito(v_clave); END IF;
    RETURN v_cred;
END;
$$;
REVOKE ALL ON FUNCTION obtener_staff_cred(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION obtener_staff_cred(TEXT, TEXT) TO anon, authenticated;

-- ── 5) entrada_validar_nip con límite de intentos (misma firma que v27) ─────
-- El token del QR ya es requisito (inadivinable), pero esto frena a quien
-- fotografíe el QR e intente adivinar NIPs de 5 dígitos.
CREATE OR REPLACE FUNCTION entrada_validar_nip(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave TEXT := 'nip|' || coalesce(p_neg, '');
        v_nombre TEXT;
BEGIN
    IF p_niphash IS NULL OR p_niphash = '' OR NOT _entrada_token_ok(p_neg, p_token) THEN
        RETURN NULL;
    END IF;
    IF NOT _login_golpe(v_clave) THEN
        RAISE EXCEPTION 'rate_limited';
    END IF;
    SELECT s.datos->>'nombre' INTO v_nombre
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
    LIMIT 1;
    IF v_nombre IS NOT NULL THEN PERFORM _login_exito(v_clave); END IF;
    RETURN v_nombre;
END;
$$;
REVOKE ALL ON FUNCTION entrada_validar_nip(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_validar_nip(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 6) staff_actualizar_hash: migrar el hash de la nube a v2 desde el login ──
-- El hub, tras validar la contraseña localmente contra un hash envuelto (v2L$),
-- sube el hash definitivo 'v2$'. Exige demostrar el hash anterior (misma prueba
-- de posesión que el propio login) y solo acepta formato v2 como nuevo.
CREATE OR REPLACE FUNCTION staff_actualizar_hash(p_usuario TEXT, p_hash_viejo TEXT, p_hash_nuevo TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clave TEXT := 'rehash|' || lower(coalesce(p_usuario, ''));
        v_n INT;
BEGIN
    IF p_hash_nuevo IS NULL OR p_hash_nuevo NOT LIKE 'v2$%' THEN RETURN FALSE; END IF;
    IF p_hash_viejo IS NULL OR length(p_hash_viejo) = 0 THEN RETURN FALSE; END IF;
    IF NOT _login_golpe(v_clave) THEN
        RAISE EXCEPTION 'rate_limited';
    END IF;
    UPDATE staff s
    SET datos = jsonb_set(s.datos, '{passwordHash}', to_jsonb(p_hash_nuevo))
    WHERE s.datos->>'usuario' = p_usuario
      AND s.datos->>'passwordHash' = p_hash_viejo;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN PERFORM _login_exito(v_clave); RETURN TRUE; END IF;
    RETURN FALSE;
END;
$$;
REVOKE ALL ON FUNCTION staff_actualizar_hash(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_actualizar_hash(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- Fin v30. Después de correrla:
--   · Ningún hash reversible queda almacenado (todos v2$ o v2L$).
--   · Los logins públicos quedan limitados a 10 intentos / 15 min por clave.
--   · El hub migra los v2L$ a v2$ definitivo en cada login exitoso.
-- ============================================================================
