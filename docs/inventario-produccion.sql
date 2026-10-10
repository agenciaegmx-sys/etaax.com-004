-- ============================================================================
-- ETAAX — Inventario del estado EFECTIVO de producción
-- ----------------------------------------------------------------------------
-- NO CAMBIA NADA. Solo lee catálogos del sistema y cuenta filas. Se pega
-- entero en Supabase → SQL Editor.
--
-- POR QUÉ NO PREGUNTA «¿QUÉ MIGRACIONES CORRIERON?»
-- Porque no se puede contestar. Una migración posterior REEMPLAZA la
-- definición de la anterior: si la v63 reescribió `staff_login`, el servidor
-- ya no guarda rastro de la v30. Lo que sí se puede saber —y es lo que de
-- verdad importa— es **qué hay puesto ahora**.
--
-- Por eso cada renglón dice una de cuatro cosas:
--   PRESENTE       lo que esperábamos está ahí;
--   AUSENTE        el objeto no existe → esa migración no corrió;
--   FALTA          el objeto está y nunca tuvo esa protección (no se la
--                  llevó nadie: está por escribir);
--   SUSTITUIDA     el objeto existe pero le falta la protección que debería
--                  llevar → algo posterior se la llevó por delante. Este es
--                  el veredicto que más duele y el que nadie mira;
--   NO COMPROBABLE no se puede decidir desde SQL (va dicho, no adivinado).
--
-- Son SEIS bloques y salen en UNA sola tabla, con lo que pide atención
-- arriba. El 6 (volumen) puede tardar: cuenta filas de verdad.
-- ============================================================================


-- ══ UNA SOLA CONSULTA, SEIS BLOQUES ══════════════════════════════════════
-- Van unidos con UNION ALL a propósito: el editor de Supabase enseña SOLO el
-- resultado de la última sentencia, así que con seis consultas sueltas se veía
-- un bloque y los otros cinco se perdían sin que nada avisara. Una herramienta
-- que hay que correr seis veces se corre una.
--
-- Todo ordenado con lo que pide atención ARRIBA.
-- El catálogo de protecciones que el bloque 2 compara. Va ARRIBA y no
-- dentro de su rama: un `WITH` no puede vivir dentro de una rama de
-- UNION ALL, y ahí el script no habría corrido.
WITH esperado(fn, marca, que, ref) AS (VALUES
    ('staff_login','_login_golpe','freno de intentos de login','v30 → ¿la v63 se lo llevó? (R04)'),
    ('staff_login','estado','filtro de colaborador dado de baja','v63'),
    ('obtener_staff_cred','_login_golpe','freno de intentos','v30'),
    ('obtener_staff_cred','estado','filtro de baja — NO lo tenía (R03)','pendiente'),
    ('entrada_validar_nip','_login_golpe','freno del NIP','v30/v63'),
    ('inventario_conteo_registrar','negocio_id = p_neg','conflicto acotado al negocio (R05)','pendiente'),
    ('entrada_token_asegurar','IS NOT TRUE','autorización que niega con NULL','v70'),
    ('menu_cfg_guardar','IS NOT TRUE','autorización que niega con NULL','v70'),
    ('menu_cfg_guardar','v_vacias','borrar un texto lo borra','v69'),
    ('menu_publico_ver','_receta_en_suc','candado de sucursal en la carta','v66'),
    ('menu_publico_ver','grupoNotas','texto por grupo en la carta','v69'),
    ('negocio_cobro_estado','etaax_negocio_alcanzable','pertenencia antes de leer el cobro','v73'),
    ('negocio_esta_activo','etaax_negocio_alcanzable','pertenencia antes de leer el cobro','v73'),
    ('entrada_historial','cerradasBodega','cantidades en el historial del QR','v67'),
    ('portal_perfil','sucursalId','sucursal en el portal del colaborador','v65')
),
todo AS (
-- ════ BLOQUE 1 · ¿EXISTEN LOS OBJETOS QUE CADA MIGRACIÓN DEJÓ? ════════════
-- Contesta las notas viejas de «pendiente de correr». Si una tabla no está,
-- esa migración no corrió y hay funcionalidad apagada que nadie ha notado.
SELECT '1 · objetos' AS bloque, nombre AS comprobacion,
       CASE WHEN existe THEN 'PRESENTE' ELSE 'AUSENTE' END AS veredicto,
       quien AS evidencia
  FROM (
    SELECT 'tabla gf_nomina_params (v12 · parámetros de nómina)' AS nombre,
           to_regclass('public.gf_nomina_params') IS NOT NULL AS existe, 'v12' AS quien
    UNION ALL SELECT 'tabla capturas_pendientes (v13 · fotos por QR)',
           to_regclass('public.capturas_pendientes') IS NOT NULL, 'v13'
    UNION ALL SELECT 'columna negocios.staff_uid (v19 · cuenta de colaboradores)',
           EXISTS(SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='negocios' AND column_name='staff_uid'), 'v19'
    UNION ALL SELECT 'columna negocios.staff_cred (v19)',
           EXISTS(SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='negocios' AND column_name='staff_cred'), 'v19'
    UNION ALL SELECT 'tabla perfiles_puesto (v25 · perfiles de puesto)',
           to_regclass('public.perfiles_puesto') IS NOT NULL, 'v25'
    UNION ALL SELECT 'tabla organigrama (v25)',
           to_regclass('public.organigrama') IS NOT NULL, 'v25'
    UNION ALL SELECT 'tabla checklists (v34)',
           to_regclass('public.checklists') IS NOT NULL, 'v34'
    UNION ALL SELECT 'tabla checklist_ejecuciones (v38 · cumplimiento por QR)',
           to_regclass('public.checklist_ejecuciones') IS NOT NULL, 'v38'
    UNION ALL SELECT 'tabla accesos_log (v62 · bitácora de accesos)',
           to_regclass('public.accesos_log') IS NOT NULL, 'v62'
    UNION ALL SELECT 'tabla inventario_conteos (v42 · conteo por QR)',
           to_regclass('public.inventario_conteos') IS NOT NULL, 'v42'
    UNION ALL SELECT 'tabla menu_publico (v66 · carta del QR de mesa)',
           to_regclass('public.menu_publico') IS NOT NULL, 'v66'
    UNION ALL SELECT 'tabla suscripciones (v24 · paywall)',
           to_regclass('public.suscripciones') IS NOT NULL, 'v24'
    UNION ALL SELECT 'tabla pagos_suscripcion (v44 · pagos de Stripe)',
           to_regclass('public.pagos_suscripcion') IS NOT NULL, 'v44'
    UNION ALL SELECT 'columna negocios.entrada_token (v27 · QR de entradas)',
           EXISTS(SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='negocios' AND column_name='entrada_token'), 'v27'
    UNION ALL SELECT 'columna suscripciones.proximo_cobro (v43 · tolerancia)',
           EXISTS(SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='suscripciones' AND column_name='proximo_cobro'), 'v43'
    UNION ALL SELECT 'tabla negocio_sucursales (v15 · sucursales sincronizadas)',
           to_regclass('public.negocio_sucursales') IS NOT NULL, 'v15'
  ) t
UNION ALL
-- ════ BLOQUE 2 · LAS PROTECCIONES QUE DEBERÍAN SEGUIR PUESTAS ══════════════
-- Aquí sale «SUSTITUIDA»: la función está, pero le falta lo que la protegía.
-- Es el patrón que ya nos mordió tres veces (v63 se llevó el freno de
-- intentos, v52 reabrió la escritura del bucket, v54 amplió el alcance).
SELECT '2 · protecciones' AS bloque,
       e.fn || ' · ' || e.que AS comprobacion,
       CASE WHEN p.oid IS NULL THEN 'AUSENTE'
            WHEN position(e.marca in pg_get_functiondef(p.oid)) > 0 THEN 'PRESENTE'
            -- SUSTITUIDA solo si ALGUNA VEZ lo tuvo. La primera corrida marcó
            -- así a `obtener_staff_cred` y a `inventario_conteo_registrar`, y
            -- no es cierto: esas protecciones nunca se escribieron. Llamarle
            -- «sustituida» manda a buscar qué migración se la llevó, y no hay
            -- ninguna. Lo distingue la referencia: 'pendiente' = nunca existió.
            WHEN e.ref = 'pendiente' THEN 'FALTA · nunca la tuvo'
            ELSE 'SUSTITUIDA' END AS veredicto,
       e.ref AS evidencia
  FROM esperado e
  LEFT JOIN pg_proc p ON p.proname = e.fn
       AND p.pronamespace = 'public'::regnamespace
UNION ALL
-- ════ BLOQUE 3 · QUIÉN PUEDE ESCRIBIR EN LAS TABLAS DE COBRO (R02) ═════════
-- La v54 barrió `public` y le puso `staff_acceso FOR ALL` a toda tabla con
-- `negocio_id`. Eso incluye las de cobro, que estaban reservadas al admin.
-- Las políticas permisivas se combinan con OR: una de lectura no limita a una
-- de escritura.
SELECT '3 · cobro' AS bloque,
       c.relname || ' · política "' || p.polname || '"' AS comprobacion,
       CASE WHEN p.polname = 'staff_acceso' AND p.polcmd = '*'
            THEN 'REVISAR · el staff puede ESCRIBIR aquí'
            ELSE 'ok' END AS veredicto,
       CASE p.polcmd WHEN '*' THEN 'ALL' WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                     WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END ||
       ' · roles: ' || COALESCE((SELECT string_agg(rolname, ', ')
                                   FROM pg_roles WHERE oid = ANY(p.polroles)), 'TODOS') AS evidencia
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
 WHERE c.relname IN ('suscripciones','pagos_suscripcion')
UNION ALL
-- Y los permisos de tabla: sin ellos, la política no alcanza para escribir.
SELECT '3 · cobro' AS bloque,
       'GRANT de ' || table_name || ' a ' || grantee AS comprobacion,
       CASE WHEN privilege_type IN ('INSERT','UPDATE','DELETE')
            THEN 'REVISAR · puede modificar' ELSE 'ok' END AS veredicto,
       privilege_type AS evidencia
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('suscripciones','pagos_suscripcion')
   AND grantee IN ('anon','authenticated')
UNION ALL
-- ════ BLOQUE 4 · STORAGE (R06) ═════════════════════════════════════════════
SELECT '4 · storage' AS bloque,
       'bucket ' || id || (CASE WHEN public THEN ' es PÚBLICO' ELSE ' es privado' END) AS comprobacion,
       CASE WHEN public THEN 'REVISAR · sus URLs sirven sin sesión' ELSE 'ok' END AS veredicto,
       'creado ' || to_char(created_at,'YYYY-MM-DD') AS evidencia
  FROM storage.buckets
UNION ALL
-- La política de ESCRITURA del bucket público: la v48 la acotó y la v52 la
-- volvió a abrir a cualquier autenticado. Si en `evidencia` solo aparece el
-- bucket y ninguna condición de dueño, el agujero sigue.
SELECT '4 · storage' AS bloque,
       'política "' || p.polname || '" sobre storage.objects' AS comprobacion,
       CASE WHEN p.polcmd <> 'r'
             -- `is_platform_admin` cuenta como comprobación: la política
            -- `guias_escritura` salió marcada en la primera corrida y sí la
            -- lleva. Un falso positivo en una herramienta de revisión es peor
            -- que un renglón de menos: enseña a ignorarla.
            AND pg_get_expr(COALESCE(p.polwithcheck, p.polqual), p.polrelid) !~ 'etaax_puede_neg|foldername|_entrada_token_ok|token_pairing_valido|is_platform_admin'
            THEN 'REVISAR · escribe sin comprobar de quién es la carpeta'
            ELSE 'ok' END AS veredicto,
       CASE p.polcmd WHEN '*' THEN 'ALL' WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                     WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END || ' · ' ||
       left(COALESCE(pg_get_expr(COALESCE(p.polwithcheck, p.polqual), p.polrelid), '—'), 110) AS evidencia
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
 WHERE c.relname = 'objects' AND c.relnamespace = 'storage'::regnamespace
UNION ALL
-- ════ BLOQUE 5 · TABLAS SIN RLS ════════════════════════════════════════════
-- Una tabla de `public` sin RLS la lee cualquiera con la llave anónima, que va
-- en el código de la página.
SELECT '5 · RLS' AS bloque,
       'tabla ' || c.relname AS comprobacion,
       CASE WHEN c.relrowsecurity THEN 'ok' ELSE 'REVISAR · SIN RLS' END AS veredicto,
       COALESCE((SELECT count(*)::text FROM pg_policy p WHERE p.polrelid = c.oid), '0')
         || ' política(s)' AS evidencia
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
UNION ALL
-- ════ BLOQUE 6 · VOLUMEN (R10) ═════════════════════════════════════════════
-- Las pantallas cargan tablas enteras con un `select` y tratan la respuesta
-- como completa. La Data API corta en un máximo (1.000 por defecto) SIN
-- avisar: pasado ese número, los totales se calculan sobre un pedazo.
--
-- Esto cuenta filas DE VERDAD, por tabla y por el negocio que más tiene. El
-- límite configurado NO se puede leer desde SQL con seguridad: va como NO
-- COMPROBABLE y se mira en el panel (Settings → API → Max rows).
SELECT '6 · volumen' AS bloque,
       'límite de filas de la Data API' AS comprobacion,
       'NO COMPROBABLE' AS veredicto,
       COALESCE(current_setting('pgrst.db_max_rows', true),
                'míralo en Settings → API → Max rows (por defecto 1000)') AS evidencia
UNION ALL
SELECT '6 · volumen' AS bloque,
       'tabla ' || tabla AS comprobacion,
       CASE WHEN peor >= 1000 THEN 'REVISAR · YA pasa el límite por defecto'
            WHEN peor >=  700 THEN 'VIGILAR · se acerca'
            ELSE 'ok' END AS veredicto,
       'total ' || total || ' · el negocio con más tiene ' || peor AS evidencia
  FROM (
    SELECT 'cortes' AS tabla, (SELECT count(*) FROM cortes) AS total,
           COALESCE((SELECT max(c) FROM (SELECT count(*) c FROM cortes GROUP BY negocio_id) x),0) AS peor
    UNION ALL SELECT 'gastos', (SELECT count(*) FROM gastos),
           COALESCE((SELECT max(c) FROM (SELECT count(*) c FROM gastos GROUP BY negocio_id) x),0)
    UNION ALL SELECT 'recetas', (SELECT count(*) FROM recetas),
           COALESCE((SELECT max(c) FROM (SELECT count(*) c FROM recetas GROUP BY negocio_id) x),0)
    UNION ALL SELECT 'negocio_insumos', (SELECT count(*) FROM negocio_insumos),
           COALESCE((SELECT max(c) FROM (SELECT count(*) c FROM negocio_insumos GROUP BY negocio_id) x),0)
    UNION ALL SELECT 'sf_otros', (SELECT count(*) FROM sf_otros),
           COALESCE((SELECT max(c) FROM (SELECT count(*) c FROM sf_otros GROUP BY negocio_id) x),0)
    UNION ALL SELECT 'depositos', (SELECT count(*) FROM depositos),
           COALESCE((SELECT max(c) FROM (SELECT count(*) c FROM depositos GROUP BY negocio_id) x),0)
    UNION ALL SELECT 'staff', (SELECT count(*) FROM staff),
           COALESCE((SELECT max(c) FROM (SELECT count(*) c FROM staff GROUP BY negocio_id) x),0)
  ) v
)
SELECT bloque, comprobacion, veredicto, evidencia
  FROM todo
 ORDER BY CASE WHEN veredicto LIKE 'SUSTITUIDA%' THEN 0      -- lo más grave
               WHEN veredicto LIKE 'FALTA%'      THEN 1
               WHEN veredicto LIKE 'AUSENTE%'    THEN 2
               WHEN veredicto LIKE 'REVISAR%'    THEN 3
               WHEN veredicto LIKE 'VIGILAR%'    THEN 4
               WHEN veredicto LIKE 'NO COMPROBABLE%' THEN 5
               ELSE 6 END,
          bloque, comprobacion;

-- ============================================================================
-- CÓMO SE LEE EL RESULTADO
--   · AUSENTE en el bloque 1  → esa migración no corrió. Decidir si hace falta.
--   · SUSTITUIDA en el bloque 2 → la función existe pero perdió su protección.
--     Es lo más grave que puede salir aquí, y no se arregla volviendo a correr
--     la migración vieja: se corrige con una NUEVA, revisada.
--   · REVISAR en los bloques 3-6 → hallazgo abierto de la auditoría, con la
--     evidencia al lado para dimensionarlo.
--
-- Lo que NO contesta: si una migración corrió y otra posterior la reemplazó
-- dejando todo correcto, aquí se ve igual que si hubieran corrido las dos. Da
-- lo mismo: lo que importa es lo que hay puesto.
-- ============================================================================
