-- ============================================================================
-- ETAAX — Migración v28: foto del ticket en el QR de entradas (subida anónima)
-- ----------------------------------------------------------------------------
-- La v14 solo deja subir anónimo a <neg>/inbox/<token-de-pareo>/… (captura.html).
-- El QR de entradas (v27) sube a <neg>/entradas/<entrada_token>/<archivo>, que esa
-- política NO cubre → por eso no dejaba subir la foto desde el cel.
--
-- Aquí: política de Storage para ese path, validada con el token de entradas.
-- Idempotente: re-ejecutable sin error. Requiere v27 (función _entrada_token_ok).
-- ============================================================================

-- El storage policy (evaluado como anon) necesita poder llamar al validador.
GRANT EXECUTE ON FUNCTION _entrada_token_ok(TEXT, TEXT) TO anon, authenticated;

-- Subida ANÓNIMA de la foto del ticket de entradas.
--   ruta = <negId>/entradas/<entrada_token>/<archivo>
DROP POLICY IF EXISTS "evidencias_entrada_anon_insert" ON storage.objects;
CREATE POLICY "evidencias_entrada_anon_insert" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (
        bucket_id = 'evidencias'
        AND (storage.foldername(name))[2] = 'entradas'
        AND _entrada_token_ok((storage.foldername(name))[1], (storage.foldername(name))[3])
    );

-- (La lectura ya es pública: política "evidencias_read" de v13. getPublicUrl funciona.)
-- ============================================================================
-- Fin v28.
-- ============================================================================
