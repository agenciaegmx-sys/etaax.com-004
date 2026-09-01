-- ============================================================================
-- ETAAX — Migración v48: cerrar el INVENTARIO del bucket de evidencias
-- ----------------------------------------------------------------------------
-- QUÉ ARREGLA
-- La v13 creó el bucket con esta política:
--     CREATE POLICY "evidencias_read" ON storage.objects
--         FOR SELECT USING (bucket_id = 'evidencias');
-- Sin rol y sin dueño: la lee CUALQUIERA, incluido `anon`. Y como la llave
-- anónima va en el código de la página (es pública por diseño), cualquier
-- persona en internet podía LISTAR el bucket completo —todas las carpetas de
-- todos los negocios— y de ahí bajar cada archivo. Comprobado el 29-ago-2026:
-- se listaron los 7 negocios y se descargó un PDF de gastos sin ninguna sesión.
--
-- Lo mismo con escribir y borrar: `TO authenticated` sin condición de dueño,
-- así que un colaborador de un negocio podía borrar los archivos de OTRO.
--
-- QUÉ NO CAMBIA, A PROPÓSITO
-- El bucket SIGUE siendo `public: true`. Eso hace que las URLs ya guardadas en
-- miles de registros (fotos de cortes, comprobantes de gastos, fotos de
-- insumos, logos, guías en PDF) SIGAN FUNCIONANDO tal cual: el endpoint
-- /object/public/ no pasa por estas políticas. Cero cambios de código, cero
-- imágenes rotas.
-- Lo que se cierra aquí es el INVENTARIO: sin poder listar, ya no hay forma de
-- descubrir qué archivos existen. Quien tenga una URL concreta todavía la
-- puede abrir — eso se cierra en la v49, que sí vuelve el bucket privado y
-- cambia el código a URLs firmadas.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

-- ── 1. ¿Este negocio es alcanzable por quien está pidiendo? ──────────────────
-- OJO, esto es lo que casi rompe la migración: los colaboradores NO entran con
-- la cuenta del dueño, sino con la cuenta compartida del negocio
-- (negocios.staff_uid). Una política escrita solo con `usuario_id = auth.uid()`
-- dejaría a todo el personal sin poder subir la foto de un corte o un gasto.
CREATE OR REPLACE FUNCTION etaax_negocio_alcanzable(p_neg TEXT)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM negocios n
        WHERE n.id = p_neg
          AND (n.usuario_id = auth.uid() OR n.staff_uid = auth.uid())
    );
$$;
GRANT EXECUTE ON FUNCTION etaax_negocio_alcanzable(TEXT) TO authenticated;

-- Carpetas de plataforma, no de un negocio: el catálogo global de insumos y las
-- guías de uso. Se comparten con todos los clientes a propósito.
CREATE OR REPLACE FUNCTION etaax_carpeta_global(p_raiz TEXT)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(p_raiz,'') IN ('catalogo', '__catalogo__', '_guias');
$$;
GRANT EXECUTE ON FUNCTION etaax_carpeta_global(TEXT) TO anon, authenticated;

-- ── 2. LEER: se acabó el listado abierto ────────────────────────────────────
DROP POLICY IF EXISTS "evidencias_read" ON storage.objects;
CREATE POLICY "evidencias_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'evidencias'
        AND (
            etaax_negocio_alcanzable((storage.foldername(name))[1])
            OR etaax_carpeta_global((storage.foldername(name))[1])
            OR is_platform_admin()
        )
    );

-- ── 3. ESCRIBIR / BORRAR: solo en lo propio ─────────────────────────────────
-- Antes bastaba con estar autenticado. Ahora hay que ser dueño (o la cuenta de
-- staff) del negocio de esa carpeta.
DROP POLICY IF EXISTS "evidencias_insert" ON storage.objects;
CREATE POLICY "evidencias_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'evidencias'
        AND (
            etaax_negocio_alcanzable((storage.foldername(name))[1])
            OR (etaax_carpeta_global((storage.foldername(name))[1]) AND is_platform_admin())
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
        )
    );

-- ── 4. Las subidas ANÓNIMAS del QR NO se tocan ──────────────────────────────
-- "evidencias_anon_insert" (v14, <neg>/inbox/<token>/…) y
-- "evidencias_entrada_anon_insert" (v28, <neg>/entradas/<token>/…) siguen
-- vivas: validan por token y son las que permiten subir la foto desde el
-- celular sin sesión. Se listan aquí solo para dejar constancia de que se
-- revisaron y se conservan a propósito.

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Qué políticas quedaron sobre el bucket:
--   SELECT polname, cmd, roles::regrole[]
--     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--    WHERE c.relname = 'objects' AND polname LIKE 'evidencias%'
--    ORDER BY polname;

-- ── Marcha atrás (si algo se rompiera) ──────────────────────────────────────
-- Devuelve el bucket a como estaba antes de esta migración:
--   DROP POLICY IF EXISTS "evidencias_read" ON storage.objects;
--   CREATE POLICY "evidencias_read" ON storage.objects
--       FOR SELECT USING (bucket_id = 'evidencias');
--   DROP POLICY IF EXISTS "evidencias_insert" ON storage.objects;
--   CREATE POLICY "evidencias_insert" ON storage.objects
--       FOR INSERT TO authenticated WITH CHECK (bucket_id = 'evidencias');
--   DROP POLICY IF EXISTS "evidencias_update" ON storage.objects;
--   CREATE POLICY "evidencias_update" ON storage.objects
--       FOR UPDATE TO authenticated USING (bucket_id = 'evidencias');
--   DROP POLICY IF EXISTS "evidencias_delete" ON storage.objects;
--   CREATE POLICY "evidencias_delete" ON storage.objects
--       FOR DELETE TO authenticated USING (bucket_id = 'evidencias');
-- ============================================================================
-- Fin v48.
-- ============================================================================
