-- ============================================================================
-- ETAAX — Migración v75: que el nombre de una carpeta no sea una llave
--                        (remate de R06 + R05)
-- ----------------------------------------------------------------------------
-- DOS AGUJEROS CON LA MISMA FORMA: un identificador que elige el cliente
-- decide, él solo, a qué puede llegar.
--
-- ══ 1 · LAS CARPETAS GLOBALES (remate de R06) ══════════════════════════════
--
-- El bucket público guarda, además de la carpeta de cada negocio, tres
-- carpetas de PLATAFORMA: `catalogo`, `__catalogo__` y `_guias`. El catálogo
-- maestro de insumos y los manuales que ven todos los clientes.
--
-- La autorización mira la PRIMERA CARPETA de la ruta y pregunta si quien
-- escribe alcanza ese negocio. Pero el id de un negocio es `text` sin formato
-- y **lo escribe el cliente** (es la misma raíz de R01). O sea que alguien
-- puede registrar un negocio llamado `_guias`, y a partir de ahí
-- `etaax_puede_neg('_guias')` le devuelve `true`: queda dueño de la carpeta de
-- los manuales de todos los clientes.
--
-- LA v48 YA LO HABÍA VISTO, Y MI v74 SE LO LLEVÓ. La v48 escribía
--     alcanzable(raíz) OR (carpeta_global(raíz) AND is_platform_admin())
-- y la v74 lo simplificó a `etaax_puede_neg(raíz)` al restaurar la
-- comprobación de dueño que había tirado la v52. Es el mismo patrón que vengo
-- señalando desde la v70 —una migración posterior se lleva en silencio una
-- protección anterior— cometido por mí, y lo encontró la revisión.
--
-- Y la forma de la v48 TAMPOCO alcanzaba: con un `OR`, el dueño del negocio
-- `_guias` pasaba por la primera rama sin necesitar la segunda. Se arregla con
-- un `CASE`, que es excluyente: si la raíz es una carpeta de plataforma, la
-- ÚNICA llave es ser administrador. Da igual a quién le pertenezca un negocio
-- con ese nombre.
--
-- ══ 2 · EL ID DEL CONTEO (R05) ═════════════════════════════════════════════
--
-- `inventario_conteo_registrar` valida el token y el NIP del negocio A, acepta
-- el `id` que mande el cliente y hace `ON CONFLICT (id) DO UPDATE`. La
-- actualización no comprueba que la fila en conflicto sea de A, y como la
-- función es `SECURITY DEFINER` la RLS no la frena. Con el id de un conteo del
-- negocio B se le reemplazan los datos, dejándole su `negocio_id` intacto para
-- que ni se note.
--
-- Hoy el id se genera al azar en cada envío, así que no es enumerable — pero
-- eso es una suerte del cliente, no una defensa del servidor. Se acota el
-- conflicto, y si no actualizó nada se RECHAZA en vez de contestar que todo
-- salió bien.
--
-- ══ 3 · Y EL FORMATO DEL ID, DE UNA VEZ ════════════════════════════════════
--
-- Los dos agujeros salen de lo mismo: `negocios.id` es texto libre escrito por
-- el cliente. Se le pone forma. Va como `NOT VALID` a propósito: así aplica a
-- lo que se registre de hoy en adelante sin tumbar la migración si alguna fila
-- vieja no encaja. Al final hay una consulta que lista las que no encajarían.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

-- ── 1 · Las tres políticas de escritura del bucket público ──────────────────
-- `CASE`, no `OR`: si la raíz es carpeta de plataforma, la única llave es ser
-- administrador. Un negocio que se llame `_guias` no abre nada.
DROP POLICY IF EXISTS "evidencias_insert" ON storage.objects;
CREATE POLICY "evidencias_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'evidencias' AND
        CASE WHEN etaax_carpeta_global((storage.foldername(name))[1])
             THEN is_platform_admin()
             ELSE etaax_puede_neg((storage.foldername(name))[1])
        END);

DROP POLICY IF EXISTS "evidencias_update" ON storage.objects;
CREATE POLICY "evidencias_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'evidencias' AND
        CASE WHEN etaax_carpeta_global((storage.foldername(name))[1])
             THEN is_platform_admin()
             ELSE etaax_puede_neg((storage.foldername(name))[1])
        END);

DROP POLICY IF EXISTS "evidencias_delete" ON storage.objects;
CREATE POLICY "evidencias_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'evidencias' AND
        CASE WHEN etaax_carpeta_global((storage.foldername(name))[1])
             THEN is_platform_admin()
             ELSE etaax_puede_neg((storage.foldername(name))[1])
        END);

-- El bucket PRIVADO tiene el mismo patrón desde la v55. Ahí no hay carpetas de
-- plataforma, pero se le pone la misma forma para que la regla sea una sola y
-- no haya que acordarse de cuál bucket lleva cuál.
DROP POLICY IF EXISTS "evpriv_insert" ON storage.objects;
CREATE POLICY "evpriv_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'evidencias-priv' AND
        CASE WHEN etaax_carpeta_global((storage.foldername(name))[1])
             THEN is_platform_admin()
             ELSE etaax_puede_neg((storage.foldername(name))[1])
        END);

DROP POLICY IF EXISTS "evpriv_update" ON storage.objects;
CREATE POLICY "evpriv_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'evidencias-priv' AND
        CASE WHEN etaax_carpeta_global((storage.foldername(name))[1])
             THEN is_platform_admin()
             ELSE etaax_puede_neg((storage.foldername(name))[1])
        END);

DROP POLICY IF EXISTS "evpriv_delete" ON storage.objects;
CREATE POLICY "evpriv_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'evidencias-priv' AND
        CASE WHEN etaax_carpeta_global((storage.foldername(name))[1])
             THEN is_platform_admin()
             ELSE etaax_puede_neg((storage.foldername(name))[1])
        END);

-- La LECTURA no se toca: las carpetas globales se leen a propósito —los
-- manuales y el catálogo son para todos los clientes—. Lo que no puede ser es
-- que cualquiera las ESCRIBA.

-- ── 2 · R05 · el conteo del QR solo pisa lo suyo ────────────────────────────
CREATE OR REPLACE FUNCTION inventario_conteo_registrar(
    p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT; v_filas INT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;

    -- Un id por ENVÍO. El cliente lo propone; si no manda ninguno, se genera.
    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));

    INSERT INTO inventario_conteos (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object(
                'contadoPor', v_nombre,
                'origen',     'qr',
                'registrado', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    ON CONFLICT (id) DO UPDATE
        SET datos = EXCLUDED.datos
        -- EL CANDADO: solo se pisa una fila que YA sea de este negocio. Con un
        -- id de otro negocio, el UPDATE no toca nada.
        WHERE inventario_conteos.negocio_id = p_neg;

    -- Y entonces hay que DARSE CUENTA. Sin esto la función devolvía el id tan
    -- campante: el celular decía «guardado» y no se había guardado nada.
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas = 0 THEN
        RAISE EXCEPTION 'ese conteo es de otro negocio';
    END IF;

    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION inventario_conteo_registrar(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventario_conteo_registrar(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- ── 3 · El formato del id de negocio ────────────────────────────────────────
-- `NOT VALID`: aplica a lo que se registre de hoy en adelante y no revisa lo
-- que ya está, para que la migración no se caiga por una fila vieja. La
-- consulta del final dice si hay alguna que no encajaría.
ALTER TABLE negocios DROP CONSTRAINT IF EXISTS negocios_id_formato;
ALTER TABLE negocios ADD CONSTRAINT negocios_id_formato
    CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'
           AND id NOT IN ('catalogo', '__catalogo__', '_guias'))
    NOT VALID;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Los siete renglones deben decir PASA.
SELECT * FROM (
    -- OJO CON CÓMO SE COMPRUEBA ESTO. PostgreSQL no guarda el texto que uno
    -- escribe: reescribe la expresión a su forma interna, y el `CASE` vuelve
    -- partido en varias líneas. Buscar la frase literal «CASE WHEN
    -- etaax_carpeta_global» daba FALLA con las políticas bien puestas — era la
    -- comprobación la que estaba mal, no el servidor.
    -- Se miran las TRES piezas por separado: que decida con un CASE (y no con
    -- un OR, que es lo que dejaba pasar al dueño del negocio «_guias»), que
    -- pregunte por la carpeta global, y que exija administrador.
    SELECT 1 AS n, 'Las carpetas de plataforma solo las escribe el admin' AS prueba,
           CASE WHEN (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                       WHERE c.relname='objects' AND c.relnamespace='storage'::regnamespace
                         AND p.polname IN ('evidencias_insert','evidencias_update','evidencias_delete',
                                           'evpriv_insert','evpriv_update','evpriv_delete')
                         AND pg_get_expr(COALESCE(p.polwithcheck,p.polqual), p.polrelid) LIKE '%CASE%'
                         AND pg_get_expr(COALESCE(p.polwithcheck,p.polqual), p.polrelid) LIKE '%etaax_carpeta_global%'
                         AND pg_get_expr(COALESCE(p.polwithcheck,p.polqual), p.polrelid) LIKE '%is_platform_admin%') = 6
                THEN 'PASA' ELSE 'FALLA' END AS resultado
    UNION ALL SELECT 2, 'Y se siguen pudiendo LEER (los manuales son de todos)',
           CASE WHEN EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                              WHERE c.relname='objects' AND c.relnamespace='storage'::regnamespace
                                AND p.polname='evidencias_read'
                                AND pg_get_expr(p.polqual,p.polrelid) LIKE '%etaax_carpeta_global%')
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 3, 'El QR de la barra sigue subiendo su foto',
           CASE WHEN (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                       WHERE c.relname='objects' AND c.relnamespace='storage'::regnamespace
                         AND p.polname IN ('evidencias_entrada_anon_insert','evpriv_anon_entradas')) = 2
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 4, 'Un conteo no puede pisar el de otro negocio (R05)',
           CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
                       WHERE p.proname='inventario_conteo_registrar'
                         AND p.pronamespace='public'::regnamespace)
                     LIKE '%WHERE inventario_conteos.negocio_id = p_neg%'
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 5, 'Y si no se pisó nada, se dice en vez de fingir',
           CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
                       WHERE p.proname='inventario_conteo_registrar'
                         AND p.pronamespace='public'::regnamespace)
                     LIKE '%ROW_COUNT%'
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 6, 'Un negocio ya no puede llamarse como una carpeta global',
           CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                              WHERE conname='negocios_id_formato'
                                AND conrelid='negocios'::regclass)
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 7, 'Ningún negocio EXISTENTE rompe esa regla',
           CASE WHEN EXISTS (SELECT 1 FROM negocios
                              WHERE id !~ '^[A-Za-z0-9_-]{1,64}$'
                                 OR id IN ('catalogo','__catalogo__','_guias'))
                THEN 'FALLA · míralos abajo' ELSE 'PASA' END
) t ORDER BY n;

-- Si el renglón 7 dice FALLA, esta consulta dice cuáles son. NO se corrigen
-- solos: cambiar el id de un negocio arrastra sus archivos de Storage y sus
-- claves de localStorage, así que se decide uno por uno.
SELECT id AS negocio_con_id_raro, datos->>'nombre' AS nombre
  FROM negocios
 WHERE id !~ '^[A-Za-z0-9_-]{1,64}$'
    OR id IN ('catalogo','__catalogo__','_guias');

-- Y para VERLO con los propios ojos: así quedó guardada cada política. Si el
-- renglón 1 vuelve a decir FALLA, aquí se ve cuál de las seis no tiene el
-- CASE, en vez de adivinar.
SELECT p.polname AS politica,
       CASE p.polcmd WHEN '*' THEN 'ALL' WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                     WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END AS operacion,
       pg_get_expr(COALESCE(p.polwithcheck, p.polqual), p.polrelid) AS como_quedo_guardada
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
 WHERE c.relname = 'objects' AND c.relnamespace = 'storage'::regnamespace
   AND p.polname IN ('evidencias_insert','evidencias_update','evidencias_delete',
                     'evpriv_insert','evpriv_update','evpriv_delete')
 ORDER BY p.polname;

-- ============================================================================
-- Fin v75. Después, pasar otra vez `docs/inventario-produccion.sql`.
-- ============================================================================
