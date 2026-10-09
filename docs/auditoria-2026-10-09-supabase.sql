-- ETAAX: comprobación de configuración real para la auditoría del 9-oct-2026.
-- Solo lectura. Ejecutar en SQL Editor con una cuenta autorizada.
-- Inspecciona esquema/permisos; no consulta registros de clientes o empleados.
BEGIN TRANSACTION READ ONLY;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE (schemaname = 'public' AND tablename IN
       ('negocios', 'staff', 'permisos', 'suscripciones', 'pagos_suscripcion',
        'inventario_conteos', 'invitaciones', 'accesos_log'))
   OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS argumentos,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS ejecutable_anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS ejecutable_authenticated,
       pg_get_functiondef(p.oid) AS definicion_actual
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN
      ('entrada_token_asegurar', 'menu_token_asegurar', 'menu_token_rotar',
       'menu_cfg_guardar', 'staff_login', 'obtener_staff_cred', 'entrada_validar_nip', 'portal_perfil',
       'entrada_historial', 'inventario_conteo_registrar', 'login_exito',
       'registrar_pago_suscripcion', 'negocio_esta_activo', 'es_staff_de')
ORDER BY p.proname, argumentos;

SELECT c.relname AS tabla,
       c.relrowsecurity AS rls_activo,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN ('suscripciones', 'pagos_suscripcion', 'negocios', 'staff', 'permisos')
ORDER BY c.relname;

SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('evidencias', 'evidencias-priv');

-- Adición para el plan: muestra la diferencia entre IF NOT(condición) e IS NOT TRUE.
-- No ejecuta RPC ni lee datos de negocio.
SELECT NOT (NULL::boolean OR FALSE OR FALSE) AS denegacion_actual_null,
       (NULL::boolean OR FALSE OR FALSE) IS NOT TRUE AS denegacion_segura;

COMMIT;

-- Revisar por separado en la consola:
-- 1. Data API: Max Rows. El repo no permite conocer el valor desplegado.
-- 2. Auth: registros públicos desactivados, MFA del admin y límites de peticiones.
-- 3. Edge Functions: versiones desplegadas y eventos habilitados en Stripe.
-- 4. Historial de migraciones manuales, respaldos y una restauración en staging.
