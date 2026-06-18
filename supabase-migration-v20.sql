-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v20 — El staff obtiene las credenciales de su cuenta
-- compartida desde la NUBE usando el hash de su propia contraseña.
--
-- Antes, el colaborador dependía de que las credenciales (staff_cred) estuvieran
-- cacheadas en localStorage de ese equipo (frágil: se perdían al limpiar caché).
-- Ahora, al iniciar sesión, la app pide la credencial al servidor presentando el
-- hash de la contraseña del colaborador; el servidor la devuelve solo si ese hash
-- coincide con un colaborador real de ese negocio. Funciona en cualquier equipo.
--
-- Requiere v19 (negocios.staff_cred). Correr en: Supabase → SQL Editor.
-- Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION obtener_staff_cred(p_neg TEXT, p_hash TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT n.staff_cred
    FROM negocios n
    WHERE n.id = p_neg
      AND n.staff_cred IS NOT NULL
      AND p_hash IS NOT NULL AND length(p_hash) > 0
      AND EXISTS (
          SELECT 1 FROM staff s
          WHERE s.negocio_id = p_neg
            AND s.datos->>'passwordHash' = p_hash
      );
$$;

REVOKE ALL ON FUNCTION obtener_staff_cred(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION obtener_staff_cred(TEXT, TEXT) TO anon, authenticated;
