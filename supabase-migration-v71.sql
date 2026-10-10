-- ============================================================================
-- ETAAX — Migración v71: en Supabase, revocarle a PUBLIC no es revocarle a anon
-- ----------------------------------------------------------------------------
-- LO QUE ENSEÑÓ CORRER LA v70
-- Su comprobación 3 dijo PASA («PUBLIC ya no puede») y la 4 dijo FALLA («anon
-- tampoco»). Las dos tenían razón, y juntas destapan algo que afecta a TODAS
-- las migraciones de este proyecto, no solo a esa función:
--
--   un proyecto de Supabase trae privilegios por DEFECTO en el esquema
--   `public` que conceden EXECUTE a `anon`, `authenticated` y `service_role`
--   sobre CADA función nueva. Ese permiso es PROPIO de `anon` — no lo hereda
--   de PUBLIC— así que `REVOKE ALL ... FROM PUBLIC` no se lo quita.
--
-- Nuestro patrón de siempre —`REVOKE ALL FROM PUBLIC` + `GRANT TO
-- authenticated`— parecía cerrar la puerta y dejaba la de al lado abierta.
--
-- QUÉ SIGNIFICABA DE VERDAD
-- Las tres funciones del menú se daban por seguras «porque sí llevan su
-- REVOKE». No lo estaban. Con el bug del NULL que arregló la v70, un anónimo
-- podía:
--   · `menu_token_rotar`  → rotar el token de la carta y DEJAR MUERTOS todos
--     los QR pegados en las mesas de cualquier negocio;
--   · `menu_cfg_guardar`  → reescribir los ajustes de la carta ajena;
--   · `menu_token_asegurar` / `entrada_token_asegurar` → quedarse con los
--     tokens.
-- La v70 ya cerró el agujero por la LÓGICA (ninguna autoriza con NULL), y eso
-- basta para que no se pueda explotar. Esto cierra la otra mitad: que ni
-- siquiera puedan llamarse.
--
-- QUÉ SE TOCA
-- Las CUATRO funciones que exigen sesión por diseño, nombradas una por una.
-- Nada de barridos: hay funciones que `anon` SÍ debe poder llamar —el QR de
-- la barra, el NIP, la carta de las mesas, las evaluaciones públicas— y
-- revocar en bloque apaga la operación. Al final va una consulta que LISTA la
-- superficie real para decidir el resto con datos.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

-- ── El permiso que de verdad faltaba quitar ─────────────────────────────────
REVOKE ALL ON FUNCTION entrada_token_asegurar(TEXT)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION entrada_token_asegurar(TEXT)          TO authenticated;

REVOKE ALL ON FUNCTION menu_token_asegurar(TEXT, TEXT)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION menu_token_asegurar(TEXT, TEXT)       TO authenticated;

REVOKE ALL ON FUNCTION menu_token_rotar(TEXT, TEXT)             FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION menu_token_rotar(TEXT, TEXT)          TO authenticated;

REVOKE ALL ON FUNCTION menu_cfg_guardar(TEXT, TEXT, JSONB)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION menu_cfg_guardar(TEXT, TEXT, JSONB)   TO authenticated;

-- La bitácora de accesos, por el mismo descuido. Aquí NO había exposición
-- real: es `SECURITY INVOKER`, así que manda la RLS de `accesos_log` y un
-- anónimo no ve ninguna fila. Pero el permiso sobraba, cerrarlo no cuesta
-- nada y deja de ser una excepción que explicar.
REVOKE ALL ON FUNCTION accesos_de_negocio(TEXT, INT)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION accesos_de_negocio(TEXT, INT)         TO authenticated;

-- ── Comprobación, en dos partes ─────────────────────────────────────────────
-- PRIMERO: que las cuatro quedaron cerradas a anon y abiertas a quien trabaja.
-- Los nueve renglones deben decir PASA.
SELECT * FROM (
    SELECT 1 AS n, 'anon NO puede pedir el token de entradas' AS prueba,
           CASE WHEN has_function_privilege('anon','entrada_token_asegurar(text)','EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END AS resultado
    UNION ALL SELECT 2, 'anon NO puede pedir el token de la carta',
           CASE WHEN has_function_privilege('anon','menu_token_asegurar(text,text)','EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END
    UNION ALL SELECT 3, 'anon NO puede ROTAR el token de la carta',
           CASE WHEN has_function_privilege('anon','menu_token_rotar(text,text)','EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END
    UNION ALL SELECT 4, 'anon NO puede reescribir los ajustes de la carta',
           CASE WHEN has_function_privilege('anon','menu_cfg_guardar(text,text,jsonb)','EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END
    -- Y LO QUE NO SE PUEDE HABER ROTO. Revocar de más deja a la barra sin
    -- registrar y al comensal sin carta, que es peor que el agujero.
    UNION ALL SELECT 5, 'El encargado con sesión SÍ genera el QR de entradas',
           CASE WHEN has_function_privilege('authenticated','entrada_token_asegurar(text)','EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 6, 'El encargado SÍ guarda los ajustes de la carta',
           CASE WHEN has_function_privilege('authenticated','menu_cfg_guardar(text,text,jsonb)','EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 7, 'La carta de las mesas sigue abierta sin sesión',
           CASE WHEN has_function_privilege('anon','menu_publico_ver(text,text)','EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 8, 'anon NO lee la bitácora de accesos',
           CASE WHEN has_function_privilege('anon','accesos_de_negocio(text,int)','EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END
    UNION ALL SELECT 9, 'El QR de la barra sigue pudiendo validar su NIP',
           CASE WHEN has_function_privilege('anon','entrada_validar_nip(text,text,text)','EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END
) t ORDER BY n;

-- ── SEGUNDO: la superficie real, para decidir el resto CON DATOS ────────────
-- Esto no cambia nada: lista cada función de la casa que puede ejecutar quien
-- llega SIN SESIÓN, y dice si está en la lista de las que deben estarlo.
-- Las marcadas «¿a propósito?» son las que hay que mirar una por una — NO se
-- revocan en bloque, porque ahí es donde se apaga el QR de la barra un viernes.
WITH esperadas(fn) AS (VALUES
    ('menu_publico_ver'),('entrada_validar_nip'),('entrada_insumos'),
    ('entrada_registrar'),('entrada_historial'),('entrada_recetas'),
    ('entrada_sucursal_de_nip'),('inventario_conteo_registrar'),
    ('checklist_plantillas'),('checklist_registrar'),
    ('portal_perfil'),('portal_recetas'),('portal_guias'),
    ('evaluacion_publica'),('evaluacion_responder'),('invitacion_ver'),
    ('staff_login'),('obtener_staff_cred'),('staff_actualizar_hash'),
    ('login_estado'),('login_fallo'),('login_exito'),
    ('acceso_registrar'),('claim_capturas'),('token_pairing_valido'),
    ('etaax_area_de_rol'),('etaax_carpeta_global')
)
SELECT p.proname                                   AS funcion,
       pg_get_function_identity_arguments(p.oid)   AS argumentos,
       p.prosecdef                                 AS corre_como_dueno,
       CASE WHEN e.fn IS NULL THEN '⚠ ¿a propósito?' ELSE 'esperada' END AS veredicto
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN esperadas e ON e.fn = p.proname
 WHERE n.nspname = 'public'
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
 ORDER BY veredicto DESC, p.proname;

-- ============================================================================
-- Fin v71.
-- LA REGLA QUE QUEDA, para toda migración futura de este proyecto:
--   REVOKE ALL ON FUNCTION … FROM PUBLIC, anon;   ← las dos, siempre
--   GRANT EXECUTE ON FUNCTION … TO authenticated; ← y solo a quien la usa
-- Revocarle a PUBLIC y creer que se cerró es el error que esta migración
-- corrige, y estaba repetido en v66, v68 y v69.
-- ============================================================================
