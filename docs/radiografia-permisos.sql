-- ============================================================================
-- ETAAX — Radiografía de permisos: ¿qué puede ejecutar quien llega sin sesión?
-- ----------------------------------------------------------------------------
-- NO CAMBIA NADA. Se pega en Supabase → SQL Editor cuando se quiera revisar, y
-- sobre todo DESPUÉS DE CADA MIGRACIÓN QUE CREE FUNCIONES.
--
-- POR QUÉ HACE FALTA
-- Un proyecto de Supabase trae privilegios por defecto que conceden EXECUTE a
-- `anon` sobre CADA función nueva del esquema `public`. Ese permiso es propio
-- de `anon`, no heredado de PUBLIC, así que `REVOKE ... FROM PUBLIC` no se lo
-- quita — fue lo que destapó la v71. Cada función que se cree nace abierta al
-- mundo mientras no se le diga lo contrario.
--
-- CÓMO SE LEE
-- Lo único que pide decisión es «⚠ REVISAR». Lo demás ya está explicado:
--   · disparador            → PostgreSQL no deja llamarlo a mano;
--   · corre como quien llama → manda la RLS, no puede saltársela;
--   · ayudante puro          → solo mira sus argumentos, no toca una fila;
--   · abierta a propósito    → alguien decidió que sí, y dice por qué.
--
-- Al 9-oct-2026 esta consulta debe salir SIN NINGÚN «⚠ REVISAR». Si aparece
-- uno, es nuevo: lo trajo la última migración y hay que mirarlo.
-- ============================================================================
WITH esperadas(fn, porque) AS (VALUES
    -- ── Lo que abre el QR de la barra y la cocina, sin sesión ───────────────
    ('entrada_validar_nip','el NIP del QR'),
    ('entrada_insumos','el catálogo del QR'),
    ('entrada_recetas','el recetario del QR'),
    ('entrada_registrar','registrar desde el QR'),
    ('entrada_historial','lo registrado en el QR'),
    ('entrada_sucursal_de_nip','a qué sucursal pertenece el NIP'),
    ('inventario_conteo_registrar','el conteo del QR'),
    ('checklist_plantillas','los checklists del QR'),
    ('checklist_registrar','cumplir un checklist desde el QR'),
    ('portal_perfil','el portal del colaborador'),
    ('portal_recetas','el recetario del colaborador'),
    ('portal_guias','las guías del colaborador'),
    ('_entrada_token_ok','la política de Storage que sube la foto del QR es TO anon y la llama'),
    ('claim_capturas','las fotos del puente QR'),
    ('token_pairing_valido','valida el token del puente QR'),
    -- ── Lo público de verdad ────────────────────────────────────────────────
    ('menu_publico_ver','la carta de las mesas'),
    ('evaluacion_publica','la evaluación por enlace'),
    ('evaluacion_responder','contestar esa evaluación'),
    ('invitacion_ver','el alta por invitación'),
    -- ── La puerta de entrada: se llama ANTES de tener sesión ────────────────
    ('staff_login','entrar con usuario y contraseña'),
    ('obtener_staff_cred','la credencial compartida'),
    ('staff_actualizar_hash','cambiar la propia contraseña'),
    ('login_estado','el freno de intentos'),
    ('login_fallo','el freno de intentos'),
    ('login_exito','el freno de intentos'),
    ('acceso_registrar','la bitácora de entradas'),
    ('etaax_area_de_rol','ayudante de áreas'),
    ('etaax_carpeta_global','ayudante de carpetas'),
    -- ── LAS CUATRO QUE PARECEN SOSPECHOSAS Y NO LO SON ──────────────────────
    -- Corren como dueño, sí, pero solo contestan SOBRE QUIEN PREGUNTA: sin
    -- sesión `auth.uid()` es NULL y las cuatro devuelven `false`. No hay nada
    -- que sacarles.
    --
    -- Y REVOCARLAS SERÍA PEOR QUE DEJARLAS. `is_platform_admin` aparece en 62
    -- políticas y `es_staff_de` en 9, y el barrido de la v54 las crea `FOR
    -- ALL` SIN cláusula `TO`, o sea que aplican a todos los roles —anon
    -- incluido—. Una política se evalúa con el rol de quien consulta: si anon
    -- no puede ejecutar la función, la consulta deja de devolver «cero filas»
    -- y pasa a tronar con `permission denied for function`.
    ('es_staff_de','solo dice si TÚ eres staff; además la usan 9 políticas'),
    ('is_platform_admin','solo dice si TÚ eres admin; además la usan 62 políticas'),
    ('etaax_negocio_alcanzable','solo dice si TÚ alcanzas ese negocio'),
    ('etaax_puede_neg','solo dice si TÚ alcanzas esa carpeta')
)
SELECT p.proname AS funcion,
       CASE
         WHEN p.prorettype = 'trigger'::regtype
              THEN 'disparador · PostgreSQL no deja llamarla a mano'
         WHEN e.fn IS NOT NULL
              THEN 'abierta a propósito · ' || e.porque
         WHEN NOT p.prosecdef
              THEN 'corre como quien llama · manda la RLS'
         WHEN p.provolatile = 'i'
              THEN 'ayudante puro · solo mira sus argumentos'
         ELSE '⚠ REVISAR · corre como dueño y la puede llamar un anónimo'
       END AS veredicto
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN esperadas e ON e.fn = p.proname
 WHERE n.nspname = 'public'
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
 ORDER BY (CASE WHEN p.prorettype <> 'trigger'::regtype AND e.fn IS NULL
                     AND p.prosecdef AND p.provolatile <> 'i' THEN 0 ELSE 1 END),
          p.proname;

-- ============================================================================
-- LA REGLA, para toda migración futura de este proyecto:
--   REVOKE ALL ON FUNCTION … FROM PUBLIC, anon;   ← las dos, siempre
--   GRANT EXECUTE ON FUNCTION … TO authenticated; ← y solo a quien la usa
-- Y antes de revocarle algo a `anon`, mirar si alguna POLÍTICA la llama: ahí
-- quitar el permiso no cierra una puerta, rompe la consulta.
-- ============================================================================
