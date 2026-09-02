-- ============================================================================
-- ETAAX — Migración v52: devolver la ESCRITURA mientras se diagnostica
-- ----------------------------------------------------------------------------
-- QUÉ PASÓ
-- La v48 (1-sep) cerró el bucket de evidencias, que estaba abierto a cualquiera.
-- Eso arregló un hoyo real —se podía inventariar y bajar los archivos de todos
-- los negocios sin ninguna sesión— pero al reescribir las políticas de ESCRITURA
-- algo quedó mal: dejaron de funcionar las subidas de logos, fotos de cortes,
-- comprobantes de gastos y fotos de insumos. La v51 intentó arreglarlo y no
-- bastó.
--
-- QUÉ HACE ESTA
-- Devuelve las políticas de escritura a como estaban ANTES de la v48, para que
-- el negocio pueda volver a trabajar hoy. NO reabre lo grave: la LECTURA sigue
-- cerrada (v48), así que un desconocido sigue sin poder inventariar el bucket ni
-- descubrir qué archivos existen. Y el registro público sigue apagado, así que
-- nadie de fuera puede hacerse una cuenta para escribir.
--
-- LO QUE SÍ SE REABRE, a conciencia: un colaborador de un negocio vuelve a poder
-- sobrescribir o borrar archivos de OTRO negocio. Con 7 clientes conocidos y el
-- registro cerrado, ese riesgo es aceptable por unos días; quedarse sin poder
-- subir un comprobante no lo es.
--
-- Esto es TEMPORAL. Al encontrar la causa se vuelve a cerrar con la condición
-- de dueño, ya comprobada contra una sesión real y no contra una suposición.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

DROP POLICY IF EXISTS "evidencias_insert" ON storage.objects;
CREATE POLICY "evidencias_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'evidencias');

DROP POLICY IF EXISTS "evidencias_update" ON storage.objects;
CREATE POLICY "evidencias_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'evidencias');

DROP POLICY IF EXISTS "evidencias_delete" ON storage.objects;
CREATE POLICY "evidencias_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'evidencias');

-- La LECTURA no se toca: sigue como la dejó la v48 (solo con sesión y solo lo
-- propio o lo global). Ahí estaba el hoyo grave y ahí sigue cerrado.

-- ── Comprobación ────────────────────────────────────────────────────────────
--   SELECT polname, cmd, qual, with_check
--     FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'evidencias%';
-- ============================================================================
-- Fin v52.
-- ============================================================================
