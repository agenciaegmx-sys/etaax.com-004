-- ============================================================================
-- ETAAX — Migración v51: el admin de plataforma también puede ESCRIBIR
-- ----------------------------------------------------------------------------
-- ARREGLA UN DESCUIDO DE LA v48.
-- Ahí la política de LECTURA quedó así:
--     etaax_negocio_alcanzable(...) OR etaax_carpeta_global(...) OR is_platform_admin()
-- pero las de ESCRIBIR / ACTUALIZAR / BORRAR se quedaron sin el último OR:
--     etaax_negocio_alcanzable(...) OR (etaax_carpeta_global(...) AND is_platform_admin())
--
-- Consecuencia: el admin de plataforma podía VER los archivos de cualquier
-- negocio pero no SUBIR ninguno a la carpeta de un negocio, porque el negocio
-- pertenece a su propio usuario y esa carpeta no es "global". Se descubrió al
-- intentar cambiar el logo de un negocio desde la cuenta admin: fallaba con un
-- "no se pudo subir" que parecía problema de red.
--
-- OJO, esto afectaba a MÁS que los logos: cualquier subida hecha mientras se
-- opera como admin —foto de un corte, comprobante de un gasto, foto de un
-- colaborador— venía fallando desde que se corrió la v48.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

DROP POLICY IF EXISTS "evidencias_insert" ON storage.objects;
CREATE POLICY "evidencias_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'evidencias'
        AND (
            etaax_negocio_alcanzable((storage.foldername(name))[1])
            OR (etaax_carpeta_global((storage.foldername(name))[1]) AND is_platform_admin())
            OR is_platform_admin()
        )
    );

DROP POLICY IF EXISTS "evidencias_update" ON storage.objects;
CREATE POLICY "evidencias_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'evidencias'
        AND (
            etaax_negocio_alcanzable((storage.foldername(name))[1])
            OR (etaax_carpeta_global((storage.foldername(name))[1]) AND is_platform_admin())
            OR is_platform_admin()
        )
    );

DROP POLICY IF EXISTS "evidencias_delete" ON storage.objects;
CREATE POLICY "evidencias_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'evidencias'
        AND (
            etaax_negocio_alcanzable((storage.foldername(name))[1])
            OR (etaax_carpeta_global((storage.foldername(name))[1]) AND is_platform_admin())
            OR is_platform_admin()
        )
    );

-- Lo que la v48 cerró SIGUE cerrado: un colaborador de un negocio no puede
-- tocar los archivos de otro, y sin sesión no se lista ni se escribe nada.
-- Lo único que cambia es que el admin de plataforma recupera la escritura que
-- ya tenía antes de la v48 y que la lectura nunca le quitó.

-- ── Comprobación ────────────────────────────────────────────────────────────
--   SELECT polname, cmd FROM pg_policy p
--     JOIN pg_class c ON c.oid = p.polrelid
--    WHERE c.relname = 'objects' AND polname LIKE 'evidencias%' ORDER BY polname;
-- ============================================================================
-- Fin v51.
-- ============================================================================
