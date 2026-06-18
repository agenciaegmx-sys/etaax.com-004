-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v21 — Login de colaborador validado contra la NUBE
--
-- Problema: el login de colaborador (gerente, etc.) validaba la contraseña SOLO
-- contra el caché local de la lista de staff (localStorage). En otro origen/equipo
-- (p.ej. el dominio etaax.com vs Live Server) ese caché no existe o está viejo, así
-- que no dejaba iniciar sesión aunque la contraseña fuera correcta en la nube.
--
-- Solución: función staff_login(usuario, hash) que busca al colaborador en la nube
-- por su usuario + hash de contraseña y devuelve sus datos + los del negocio.
-- SECURITY DEFINER: solo devuelve algo si el hash coincide con un colaborador real.
--
-- Requiere v19. Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION staff_login(p_usuario TEXT, p_hash TEXT)
RETURNS TABLE (negocio_id TEXT, negocio_datos JSONB, staff_id TEXT, nombre TEXT, rol TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT s.negocio_id,
           n.datos,
           s.id,
           s.datos->>'nombre' AS nombre,
           COALESCE(NULLIF(s.datos->>'rol',''), 'otro') AS rol
    FROM staff s
    JOIN negocios n ON n.id = s.negocio_id
    WHERE s.datos->>'usuario' = p_usuario
      AND s.datos->>'passwordHash' = p_hash
      AND p_hash IS NOT NULL AND length(p_hash) > 0
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION staff_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_login(TEXT, TEXT) TO anon, authenticated;
