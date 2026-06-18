-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v18 — Escaneo por QR para sesiones de colaborador
--
-- Problema: las sesiones de colaborador (gerente, etc.) son LOCALES y no
-- tienen sesión de Supabase (auth.uid() = null). El puente QR exige crear un
-- token en pairing_sesiones y leer las fotos de capturas_pendientes, pero ambas
-- tablas tenían solo la política "own" (auth.uid() = dueño del negocio). Por eso
-- el gerente no podía escanear un gasto/corte.
--
-- Esta migración habilita el puente para sesiones anónimas de forma ACOTADA:
--   1) anon puede CREAR un token de emparejamiento. El token solo se ve en la
--      pantalla del equipo; el FK garantiza que el negocio exista. La subida del
--      celular sigue protegida por token_pairing_valido (sin cambios).
--   2) Para LEER las fotos subidas se usa una función SECURITY DEFINER acotada
--      por token (claim_capturas) en vez de exponer toda la tabla por SELECT.
--      Devuelve solo las filas de los tokens provistos y las marca asociadas.
--
-- Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

-- 1) anon puede crear el token de emparejamiento (el equipo, con o sin dueño).
DROP POLICY IF EXISTS "anon_insert" ON pairing_sesiones;
CREATE POLICY "anon_insert" ON pairing_sesiones
    FOR INSERT TO anon
    WITH CHECK (token IS NOT NULL AND negocio_id IS NOT NULL);

-- 2) Reclamar las fotos subidas para un conjunto de tokens, sin exponer la
--    tabla completa. SECURITY DEFINER: corre con permisos del dueño de la
--    función (ignora RLS), pero solo toca las filas de los tokens dados.
CREATE OR REPLACE FUNCTION claim_capturas(p_tokens TEXT[])
RETURNS TABLE (id TEXT, foto_url TEXT, foto_path TEXT, token TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE capturas_pendientes c
       SET asociado = TRUE
     WHERE c.token = ANY(p_tokens)
       AND c.asociado = FALSE
    RETURNING c.id, c.foto_url, c.foto_path, c.token;
$$;

REVOKE ALL ON FUNCTION claim_capturas(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_capturas(TEXT[]) TO anon, authenticated;
