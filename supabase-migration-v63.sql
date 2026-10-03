-- ═══════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v63 — Dar de baja a alguien le quita el acceso
-- Corre esto en: Supabase → SQL Editor. Seguro de re-ejecutar.
--
-- EL HUECO, y es de los serios:
--
-- Dar de baja a un colaborador lo sacaba del catálogo… y nada más. Sus
-- credenciales seguían vivas. Edwin lo encontró en producción: una gerente dada
-- de baja el 15 de septiembre seguía subiendo entradas por el QR en octubre.
--
-- Ninguna de las funciones que autentican miraba el estado:
--   · staff_login          → entraba al sistema con su usuario y contraseña
--   · entrada_validar_nip  → entraba al QR de inventarios con su NIP
--   · portal_perfil        → entraba al portal de staff con su NIP
--
-- POR QUÉ SOLO TRES FUNCIONES: las demás (portal_recetas, portal_guias,
-- checklist_plantillas, checklist_registrar) no validan por su cuenta —llaman a
-- portal_perfil o a entrada_validar_nip y si devuelven NULL se salen—. Cerrando
-- estas tres puertas, las otras cuatro se cierran solas. Esa arquitectura de
-- embudo ya estaba bien hecha; lo que faltaba era el candado en la puerta.
--
-- EL CANDADO:
--     COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
--
-- Se lee así: solo pasa quien está ACTIVO. El COALESCE es importante — los
-- colaboradores viejos no traen el campo `estado`, y sin él se quedarían TODOS
-- fuera de golpe. Sin estado capturado = activo, que es como se comportaban
-- hasta hoy.
--
-- BLOQUEA LAS DOS BAJAS, temporal y definitiva. Una baja temporal es una
-- incapacidad o un permiso: mientras dura, no hay por qué poder entrar. Si
-- regresa, se reactiva y su acceso vuelve — las credenciales NO se borran,
-- solo dejan de abrir. Eso es a propósito: borrarlas obligaría a volver a
-- configurar a todo el que regresa de una incapacidad.
--
-- EFECTO INMEDIATO: cada acción del QR revalida el NIP contra el servidor, así
-- que una sesión ya abierta deja de funcionar en el siguiente registro. No hay
-- que esperar a que cierre la pestaña.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── staff_login  (base: supabase-migration-v22.sql) ───────────
CREATE OR REPLACE FUNCTION staff_login(p_usuario TEXT, p_hash TEXT)
RETURNS TABLE (negocio_id TEXT, negocio_datos JSONB, staff_id TEXT, nombre TEXT, rol TEXT, sucursal_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT s.negocio_id,
           n.datos,
           s.id,
           s.datos->>'nombre' AS nombre,
           COALESCE(NULLIF(s.datos->>'rol',''), 'otro') AS rol,
           NULLIF(s.datos->>'sucursalId','') AS sucursal_id
    FROM staff s
    JOIN negocios n ON n.id = s.negocio_id
    WHERE s.datos->>'usuario' = p_usuario
      AND s.datos->>'passwordHash' = p_hash
      AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
      AND p_hash IS NOT NULL AND length(p_hash) > 0
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION staff_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_login(TEXT, TEXT) TO anon, authenticated;

-- ── entrada_validar_nip  (base: supabase-migration-v30.sql) ───
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
      AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
    LIMIT 1;
    IF v_nombre IS NOT NULL THEN PERFORM _login_exito(v_clave); END IF;
    RETURN v_nombre;
END;
$$;
REVOKE ALL ON FUNCTION entrada_validar_nip(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_validar_nip(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── portal_perfil  (base: supabase-migration-v57.sql) ─────────
CREATE OR REPLACE FUNCTION portal_perfil(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'nombre', s.datos->>'nombre',
        'puesto', s.datos->>'puesto',
        -- Sin área asignada se asume ADMINISTRACIÓN, que es la más restrictiva en
        -- lo operativo: ve guías administrativas y ningún recetario de área. Así,
        -- a un colaborador sin configurar no se le abre de más por descuido.
        'area',   COALESCE(NULLIF(s.datos->>'area',''), 'administracion'),
        -- Sucursal del colaborador: sirve para elegir CUÁL copia de cada receta
        -- enseñarle. Sin asignar, Matriz — que es donde viven las recetas viejas.
        'sucursalId', COALESCE(NULLIF(s.datos->>'sucursalId',''), 'suc_principal')
    )
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
      AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
      AND p_niphash IS NOT NULL AND p_niphash <> ''
      AND _entrada_token_ok(p_neg, p_token)
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION portal_perfil(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_perfil(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Debe devolver 3 renglones, uno por función, todos con candado = true.
SELECT p.proname AS funcion,
       pg_get_functiondef(p.oid) LIKE '%estado%Activo%' AS candado
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('staff_login', 'entrada_validar_nip', 'portal_perfil')
 ORDER BY p.proname;

-- Y esta dice quién está dado de baja HOY y, por lo tanto, ya no entra.
-- Si sale alguien que no debería, reactívalo desde Catálogo de Staff → Bajas.
SELECT s.negocio_id,
       s.datos->>'nombre' AS colaborador,
       s.datos->>'estado' AS estado,
       (s.datos->>'passwordHash' <> '') AS tenia_usuario,
       (s.datos->>'nipHash'      <> '') AS tenia_nip
  FROM staff s
 WHERE COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') <> 'Activo'
 ORDER BY s.negocio_id, colaborador;

-- ============================================================================
-- Fin v63. Después de correrla, un colaborador dado de baja:
--   · no entra al sistema con su usuario y contraseña,
--   · no entra al QR de inventarios ni al portal de staff con su NIP,
--   · y si lo reactivas, su acceso vuelve tal como estaba.
-- ============================================================================
