-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v22 — staff_login devuelve la sucursal asignada
--
-- Problema: al iniciar sesión un colaborador (gerente, etc.) desde otro
-- equipo/origen, el header no mostraba la sucursal a la que está asignado
-- porque staff_login() no devolvía el sucursalId del colaborador.
--
-- Solución: agregar la columna sucursal_id al resultado de staff_login,
-- leída de s.datos->>'sucursalId'. El cliente la usa para fijar
-- etaax_sucursal_activa y mostrar la sucursal en el header.
--
-- Requiere v21. Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

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
      AND p_hash IS NOT NULL AND length(p_hash) > 0
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION staff_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_login(TEXT, TEXT) TO anon, authenticated;
