-- ============================================================================
-- ETAAX — Migración v74: el cobro y los archivos, cada quien con lo suyo
--                        (R02 y R06, confirmados en producción)
-- ----------------------------------------------------------------------------
-- El inventario del 9-oct lo sacó de la teoría. Esto es lo que hay PUESTO:
--
--   suscripciones     · política "staff_acceso"  →  ALL · roles: TODOS
--   pagos_suscripcion · política "staff_acceso"  →  ALL · roles: TODOS
--   bucket evidencias · evidencias_insert/update/delete → (bucket_id = 'evidencias')
--
-- R02 · EL CLIENTE PUEDE ACTIVARSE SU PROPIA SUSCRIPCIÓN
-- La v54 barrió `public` y le puso `staff_acceso FOR ALL` a toda tabla con
-- `negocio_id`. Eso incluyó las dos de cobro, que la v24 y la v44 habían
-- reservado al admin. Las políticas permisivas se combinan con OR: tener
-- `own_read` (SELECT) al lado no limita en nada a una de escritura.
-- Resultado: la cuenta compartida del negocio puede hacer UPDATE sobre su
-- propia fila de `suscripciones` y ponerse `estado='activa'` con la fecha que
-- quiera. El paywall se salta desde la consola del navegador.
--
-- LO QUE SE QUITA ES LA POLÍTICA, NO EL PERMISO DE TABLA. El panel de admin
-- escribe `suscripciones` como un usuario `authenticated` cualquiera —el
-- admin entra con su cuenta— y los GRANT son por ROL, no por persona. Quitarle
-- INSERT/UPDATE a `authenticated` dejaría al admin sin poder activar a nadie.
-- Lo que de verdad separa al admin del cliente es la política `admin_all`, y
-- esa se queda. A `anon` sí se le quita todo: nunca escribió ahí.
--
-- `pagos_suscripcion` es distinta: la escribe SOLO el webhook de Stripe, por
-- `registrar_pago_suscripcion`, que corre con `service_role`. Ahí ni el admin
-- necesita escribir desde el navegador, así que se cierra a los dos roles.
--
-- R06 · UN CLIENTE PUEDE BORRAR LAS EVIDENCIAS DE OTRO
-- La v48 encontró y cerró el agujero de LECTURA del bucket público. La v52,
-- cuatro migraciones después, volvió a abrir la escritura: sus políticas
-- comprueban `bucket_id = 'evidencias'` y nada más. Su comentario decía «la
-- lectura no se toca, ahí estaba el hoyo grave y ahí sigue cerrado» — miró la
-- lectura y no vio que estaba reabriendo la escritura.
--
-- Hoy cualquier cuenta con sesión puede subir, sobrescribir o BORRAR cualquier
-- archivo del bucket público: los tickets de gastos de otro negocio, sus
-- fotos de corte, las guías globales. Borrar no pide leer.
--
-- Se arregla con la misma condición que ya usa el bucket privado desde la v55
-- —`etaax_puede_neg(carpeta_raíz)`—, que además cubre al admin para las
-- carpetas globales. Las dos políticas anónimas del QR NO se tocan: la barra
-- tiene que poder subir su foto.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

-- ── R02 · Cobro ─────────────────────────────────────────────────────────────
-- Fuera el barrido de la v54 en las dos tablas de plataforma. El staff sigue
-- LEYENDO su estado por `staff_read`; lo que pierde es poder escribirlo.
DROP POLICY IF EXISTS "staff_acceso" ON suscripciones;
DROP POLICY IF EXISTS "staff_acceso" ON pagos_suscripcion;

-- `anon` no tiene nada que hacer en ninguna de las dos.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON suscripciones      FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pagos_suscripcion  FROM anon;

-- Y el registro de pagos lo escribe SOLO el webhook (service_role). Ni el
-- panel de admin lo toca desde el navegador: se comprobó, nadie lo consulta
-- ni lo escribe desde el cliente.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pagos_suscripcion  FROM authenticated;

-- En `suscripciones` se conservan INSERT y UPDATE para `authenticated` porque
-- el panel de admin los necesita, y es `admin_all` quien decide quién pasa.
-- DELETE no lo usa nadie: las filas se van en cascada al borrar el negocio,
-- y eso ocurre por la llave foránea, sin pedir este permiso.
REVOKE DELETE, TRUNCATE ON suscripciones FROM authenticated;

-- ── R06 · El bucket público ─────────────────────────────────────────────────
-- Misma condición que el bucket privado desde la v55. `etaax_puede_neg` ya
-- incluye al admin de plataforma, así que las carpetas globales (`_guias`,
-- `catalogo`, `__catalogo__`) le siguen quedando solo a él.
DROP POLICY IF EXISTS "evidencias_insert" ON storage.objects;
CREATE POLICY "evidencias_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'evidencias'
                AND etaax_puede_neg((storage.foldername(name))[1]));

DROP POLICY IF EXISTS "evidencias_update" ON storage.objects;
CREATE POLICY "evidencias_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'evidencias'
           AND etaax_puede_neg((storage.foldername(name))[1]));

-- BORRAR NO PIDE LEER. Esta era la peor de las tres: con la política vieja,
-- una cuenta cualquiera podía vaciarle las evidencias a otro negocio sin
-- haber podido verlas nunca.
DROP POLICY IF EXISTS "evidencias_delete" ON storage.objects;
CREATE POLICY "evidencias_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'evidencias'
           AND etaax_puede_neg((storage.foldername(name))[1]));

-- NO SE TOCAN, y conviene decir por qué:
--   · evidencias_anon_insert / evidencias_entrada_anon_insert → el QR de la
--     barra sube sus fotos sin sesión, validando token. Quitarlas apaga las
--     evidencias de la operación.
--   · evidencias_read (v48) → ya comprueba pertenencia o carpeta global.
--   · guias_escritura → ya exige is_platform_admin().
--   · el bucket sigue siendo `public: true`, también a propósito: las URLs
--     guardadas en miles de registros dejarían de servir. Eso se resuelve
--     migrando los archivos sensibles al bucket privado, que es otro bloque.

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Los ocho renglones deben decir PASA.
SELECT * FROM (
    -- R02 · lo que se cerró
    SELECT 1 AS n, 'El staff ya NO puede escribir su suscripción' AS prueba,
           CASE WHEN EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                              WHERE c.relname='suscripciones' AND p.polname='staff_acceso')
                THEN 'FALLA' ELSE 'PASA' END AS resultado
    UNION ALL SELECT 2, 'Ni su registro de pagos',
           CASE WHEN EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                              WHERE c.relname='pagos_suscripcion' AND p.polname='staff_acceso')
                THEN 'FALLA' ELSE 'PASA' END
    UNION ALL SELECT 3, 'anon no puede modificar el cobro',
           CASE WHEN has_table_privilege('anon','suscripciones','UPDATE')
                  OR has_table_privilege('anon','pagos_suscripcion','INSERT')
                THEN 'FALLA' ELSE 'PASA' END
    UNION ALL SELECT 4, 'Los pagos los escribe SOLO el webhook',
           CASE WHEN has_table_privilege('authenticated','pagos_suscripcion','INSERT')
                THEN 'FALLA' ELSE 'PASA' END
    -- R02 · lo que NO se puede haber roto
    UNION ALL SELECT 5, 'El panel de admin SIGUE pudiendo activar una suscripción',
           CASE WHEN has_table_privilege('authenticated','suscripciones','UPDATE')
                 AND EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                              WHERE c.relname='suscripciones' AND p.polname='admin_all')
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 6, 'Y el negocio SIGUE viendo su propio estado',
           CASE WHEN EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                              WHERE c.relname='suscripciones' AND p.polname IN ('own_read','staff_read'))
                THEN 'PASA' ELSE 'FALLA' END
    -- R06
    UNION ALL SELECT 7, 'Ya no se puede borrar la evidencia de otro negocio',
           CASE WHEN (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                       WHERE c.relname='objects' AND c.relnamespace='storage'::regnamespace
                         AND p.polname IN ('evidencias_insert','evidencias_update','evidencias_delete')
                         AND pg_get_expr(COALESCE(p.polwithcheck,p.polqual), p.polrelid)
                             LIKE '%etaax_puede_neg%') = 3
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 8, 'Y el QR de la barra SIGUE pudiendo subir su foto',
           CASE WHEN EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                              WHERE c.relname='objects' AND c.relnamespace='storage'::regnamespace
                                AND p.polname = 'evidencias_entrada_anon_insert')
                THEN 'PASA' ELSE 'FALLA' END
) t ORDER BY n;

-- ============================================================================
-- Fin v74. Después de correrla, vuelve a pasar `docs/inventario-produccion.sql`:
-- los renglones de «3 · cobro» y «4 · storage» que decían REVISAR tienen que
-- haber desaparecido, salvo el del bucket público, que sigue siéndolo a
-- propósito.
-- ============================================================================
