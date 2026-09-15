-- ============================================================================
-- ETAAX — Migración v55: almacén PRIVADO para lo sensible (bucket nuevo)
-- ----------------------------------------------------------------------------
-- QUÉ PROBLEMA CIERRA
-- El bucket `evidencias` es `public: true`. La v48 cerró el INVENTARIO (ya no se
-- puede listar qué archivos existen sin sesión), pero quedó lo de fondo: una URL
-- pública es una LLAVE PERMANENTE. No caduca, no se revoca, y va escrita dentro
-- del registro, dentro de los PDF que se imprimen y dentro de cualquier reporte
-- que se comparta. Quien la tenga, entra — para siempre, sin sesión.
--
-- POR QUÉ UN BUCKET NUEVO Y NO VOLVER PRIVADO EL DE HOY
-- Porque `public` es del bucket entero, no del archivo. Apagarlo rompería DE
-- GOLPE todas las URLs ya guardadas en miles de registros (fotos de insumos,
-- logos, guías). Eso ya se intentó y se vivió: v48 → v51 → v52 fueron tres
-- migraciones en cadena para volver a poder trabajar.
-- Aquí no se toca NADA de lo que existe. Se agrega un segundo almacén, privado,
-- y el código manda ahí SOLO lo sensible de aquí en adelante. Lo viejo sigue
-- funcionando igual porque su bucket sigue igual.
--
-- CÓMO SE REPARTE (por riesgo, no por fecha)
--   PRIVADO (evidencias-priv):  staff/ (INE, contratos) · gastos/ (facturas)
--                               cortes/ · inbox/ · entradas/
--   PÚBLICO (evidencias, igual): insumos/ · recetas/ · miniaturas/ · logos/
--                               _guias/ · catalogo/
-- Que se filtre la foto de una botella no es un incidente; que se filtre un INE,
-- sí. Y las fotos de producto y los logos se ven desde páginas sin sesión (el
-- portal del QR), así que privarlas rompería el QR sin ganar nada.
--
-- LO QUE APRENDIMOS DE LA v48 (y por eso aquí se escribe distinto)
-- La v51 agregó `OR is_platform_admin()` y "no bastó". La razón está en la v3:
--     is_platform_admin() := (jwt.email = 'admin@etaax.com')
-- Es FALSO para cualquier otra cuenta. Operando un negocio ajeno desde una
-- cuenta que no es esa, `etaax_negocio_alcanzable` también da falso → subida
-- bloqueada. De ahí los "no se pudo subir" que parecían de red.
-- Por eso la condición de aquí suma las TRES identidades reales del sistema:
-- dueño (negocios.usuario_id), cuenta compartida de staff (negocios.staff_uid,
-- vía es_staff_de — la que la v54 acabó de dejar sana) y admin de plataforma.
--
-- Y por eso al final va una COMPROBACIÓN que se corre con la sesión real, no
-- una suposición: dice negocio por negocio si esta cuenta puede leer y escribir.
--
-- Idempotente: se puede correr varias veces.
-- Requiere: v19 (es_staff_de), v27 (_entrada_token_ok), v14 (token_pairing_valido).
-- ============================================================================

-- ── 1. El bucket privado ────────────────────────────────────────────────────
-- `public = false` ⇒ no existe el endpoint /object/public/. La única forma de
-- leer un archivo es una URL FIRMADA, que caduca. Eso es todo el punto.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('evidencias-priv', 'evidencias-priv', false, 52428800)
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = COALESCE(storage.buckets.file_size_limit, 52428800);

-- ── 2. ¿Quién alcanza este negocio? Las TRES identidades ────────────────────
-- Una sola función para no volver a escribir la condición a mano en cada
-- política y que se desincronicen (fue justo lo que pasó entre la v48 y la v51:
-- leer tenía tres ORs y escribir dos).
CREATE OR REPLACE FUNCTION etaax_puede_neg(p_raiz TEXT)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM negocios n
        WHERE n.id = p_raiz
          AND (n.usuario_id = auth.uid()
               OR (n.staff_uid IS NOT NULL AND n.staff_uid = auth.uid()))
    )
    OR is_platform_admin();
$$;
GRANT EXECUTE ON FUNCTION etaax_puede_neg(TEXT) TO authenticated;

-- ── 3. LEER: solo con sesión y solo lo propio ───────────────────────────────
-- Sin `anon` a propósito: nadie sin sesión lee este bucket, ni con la URL en la
-- mano. Y aunque tuviera sesión, la URL firmada la emite el servidor solo si
-- esta política lo deja pasar.
DROP POLICY IF EXISTS "evpriv_read" ON storage.objects;
CREATE POLICY "evpriv_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'evidencias-priv'
           AND etaax_puede_neg((storage.foldername(name))[1]));

-- ── 4. ESCRIBIR / ACTUALIZAR / BORRAR: lo propio ────────────────────────────
DROP POLICY IF EXISTS "evpriv_insert" ON storage.objects;
CREATE POLICY "evpriv_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'evidencias-priv'
                AND etaax_puede_neg((storage.foldername(name))[1]));

DROP POLICY IF EXISTS "evpriv_update" ON storage.objects;
CREATE POLICY "evpriv_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'evidencias-priv'
           AND etaax_puede_neg((storage.foldername(name))[1]))
    WITH CHECK (bucket_id = 'evidencias-priv'
                AND etaax_puede_neg((storage.foldername(name))[1]));

DROP POLICY IF EXISTS "evpriv_delete" ON storage.objects;
CREATE POLICY "evpriv_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'evidencias-priv'
           AND etaax_puede_neg((storage.foldername(name))[1]));

-- ── 5. El QR sigue subiendo sin sesión ──────────────────────────────────────
-- Esto es lo que hace que el QR no cambie: "privado" bloquea LEER, no escribir.
-- Las políticas por token de la v14 y la v28 se copian tal cual al bucket nuevo,
-- con el mismo validador. El celular sube igual que hoy, sin sesión.
-- Los validadores tienen que ser llamables por `anon` (ya lo eran desde la v14 y
-- la v28; se repiten para que esta migración se sostenga sola).
GRANT EXECUTE ON FUNCTION token_pairing_valido(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION _entrada_token_ok(TEXT, TEXT)    TO anon, authenticated;

--   captura.html  →  <neg>/inbox/<token-de-pareo>/<archivo>
DROP POLICY IF EXISTS "evpriv_anon_inbox" ON storage.objects;
CREATE POLICY "evpriv_anon_inbox" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (
        bucket_id = 'evidencias-priv'
        AND (storage.foldername(name))[2] = 'inbox'
        AND token_pairing_valido((storage.foldername(name))[3], (storage.foldername(name))[1])
    );

--   entrada.html / checklist.html  →  <neg>/entradas/<entrada_token>/<archivo>
DROP POLICY IF EXISTS "evpriv_anon_entradas" ON storage.objects;
CREATE POLICY "evpriv_anon_entradas" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (
        bucket_id = 'evidencias-priv'
        AND (storage.foldername(name))[2] = 'entradas'
        AND _entrada_token_ok((storage.foldername(name))[1], (storage.foldername(name))[3])
    );

-- NO hay política de SELECT para `anon`. El QR sube y no lee: la miniatura que
-- muestra tras tomar la foto sale del archivo del propio celular, no del
-- servidor. Quien lee esas fotos es el ERP, con sesión y con URL firmada.

-- ── 6. Lo que esta migración NO toca, a propósito ───────────────────────────
-- El bucket `evidencias` y sus políticas se quedan EXACTAMENTE como están
-- (v48 + v52). Nada de lo ya cargado se mueve ni se rompe.
-- Queda pendiente aparte: la v52 dejó la escritura de `evidencias` abierta entre
-- negocios ("es TEMPORAL" dice su encabezado) y sigue así. Se cierra en su
-- propia migración, después de comprobar con la sesión real cuál de las tres
-- identidades fallaba — que es justo lo que imprime el bloque de abajo.

-- ============================================================================
-- COMPROBACIÓN — correr LOGUEADO con la cuenta que se quiere probar.
-- No adivina: evalúa la condición real, negocio por negocio.
--
--   SELECT n.id,
--          n.datos->>'nombre'                AS negocio,
--          n.usuario_id = auth.uid()         AS soy_dueno,
--          n.staff_uid  = auth.uid()         AS soy_staff,
--          is_platform_admin()               AS soy_admin,
--          etaax_puede_neg(n.id)             AS puedo_usar_almacen_privado
--     FROM negocios n
--    ORDER BY 2;
--
-- Si `puedo_usar_almacen_privado` sale false en un negocio que sí operas, ahí
-- está la causa del viejo "no se pudo subir": mira cuál de las tres columnas
-- falló. staff_uid en NULL ⇒ falta correr la v19 para ese negocio.
--
-- Y que el bucket quedó privado:
--   SELECT id, public FROM storage.buckets WHERE id LIKE 'evidencias%';
--   -- evidencias → true (a propósito) · evidencias-priv → false
-- ============================================================================
-- Fin v55.
-- ============================================================================
