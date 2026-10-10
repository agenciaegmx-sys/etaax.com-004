-- ============================================================================
-- ETAAX — Migración v72: cerrar las dos que sí filtraban, y aprender a leer
--                        la lista de las otras
-- ----------------------------------------------------------------------------
-- La v71 dejó una lista de 20 funciones marcadas «⚠ ¿a propósito?». Se
-- revisaron UNA POR UNA. El resultado es la mejor noticia posible y una
-- lección sobre por qué no se barre en bloque:
--
--   · 6 son DISPARADORES (`_papelera_capturar`, `_papelera_revivido`,
--     `autoconfirmar_cuenta_staff`, `handle_new_user`, `proteger_plan`,
--     `validar_limite_negocios`). PostgreSQL rechaza llamarlas a mano, así
--     que el permiso no sirve de nada.
--   · 8 son AYUDANTES PUROS que solo miran sus argumentos (`_declara_suc`,
--     `_login_espera`, `_login_ip`, `_primer_json`, `_primer_texto`,
--     `_receta_en_suc`, `etaax_proximo_cobro`, `etaax_carpeta_global`).
--     No tocan una sola fila.
--   · 4 solo contestan SOBRE QUIEN PREGUNTA (`es_staff_de`,
--     `is_platform_admin`, `etaax_negocio_alcanzable`, `etaax_puede_neg`).
--     Sin sesión devuelven `false`. No hay nada que sacarles.
--   · 1 TIENE que estar abierta: `_entrada_token_ok`. La v27 se la revocó a
--     `anon` y la v32 y la v55 se la devolvieron A PROPÓSITO — la política de
--     Storage que deja al QR subir su foto es `TO anon` y la llama. Si se
--     revocara, la barra dejaría de poder subir evidencias. Es el ejemplo
--     exacto de por qué este trabajo se hace leyendo, no barriendo.
--   · y 2 SÍ filtraban. Esas son las que cierra esta migración.
--
-- LO QUE SE CIERRA
-- `negocio_esta_activo` y `negocio_cobro_estado` corren como dueño y leen
-- `suscripciones` de CUALQUIER negocio que se les nombre. Nuestras migraciones
-- solo se las concedieron a `authenticated`; `anon` las tenía por los
-- privilegios por defecto del proyecto (lo que destapó la v71).
--
-- Y el id del negocio no es secreto: viaja en la dirección de la carta del QR
-- de la mesa. O sea que cualquiera que escaneara una mesa podía preguntar en
-- qué estado de pago está ese negocio, cuándo le toca cobro y cuántos días le
-- quedan. No es catastrófico —no hay dinero ni datos de nadie ahí— pero es
-- información comercial de un cliente que no tiene por qué salir.
--
-- Es seguro: sus dos únicos llamadores son `_gateSuscripcion` y
-- `_esperarPago` en hub.html, que corren DESPUÉS de elegir negocio, o sea con
-- sesión. Ninguna política de RLS las usa, así que revocarlas no puede
-- apagar un permiso de tabla por efecto rebote.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

REVOKE ALL ON FUNCTION negocio_esta_activo(TEXT)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION negocio_esta_activo(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION negocio_cobro_estado(TEXT)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION negocio_cobro_estado(TEXT) TO authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Los cuatro renglones deben decir PASA.
SELECT * FROM (
    SELECT 1 AS n, 'anon NO consulta el estado de pago de un negocio' AS prueba,
           CASE WHEN has_function_privilege('anon','negocio_esta_activo(text)','EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END AS resultado
    UNION ALL SELECT 2, 'anon NO consulta su fecha de cobro ni su tolerancia',
           CASE WHEN has_function_privilege('anon','negocio_cobro_estado(text)','EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END
    -- Y el candado del paywall tiene que seguir funcionando para quien entra.
    UNION ALL SELECT 3, 'El cliente con sesión SÍ ve su propio estado de pago',
           CASE WHEN has_function_privilege('authenticated','negocio_cobro_estado(text)','EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END
    -- Y la foto del QR de la barra, que depende de una función que SÍ debe
    -- seguir abierta: si esto falla, la barra no puede subir evidencias.
    UNION ALL SELECT 4, 'El QR de la barra sigue pudiendo subir su foto',
           CASE WHEN has_function_privilege('anon','_entrada_token_ok(text,text)','EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END
) t ORDER BY n;

-- ── La radiografía, ahora clasificada ───────────────────────────────────────
-- La de la v71 dejaba 20 renglones en «⚠» sin decir cuáles importaban. Esta
-- separa sola lo que no puede hacer daño de lo que hay que mirar, para que la
-- próxima vez la lista se lea en un minuto y no en una tarde.
WITH esperadas(fn, porque) AS (VALUES
    ('menu_publico_ver','la carta de las mesas'),
    ('entrada_validar_nip','el NIP del QR'),
    ('entrada_insumos','el catálogo del QR'),
    ('entrada_registrar','registrar desde el QR'),
    ('entrada_historial','lo registrado en el QR'),
    ('entrada_recetas','el recetario del QR'),
    ('entrada_sucursal_de_nip','a qué sucursal pertenece el NIP'),
    ('inventario_conteo_registrar','el conteo del QR'),
    ('checklist_plantillas','los checklists del QR'),
    ('checklist_registrar','cumplir un checklist desde el QR'),
    ('portal_perfil','el portal del colaborador'),
    ('portal_recetas','el recetario del colaborador'),
    ('portal_guias','las guías del colaborador'),
    ('evaluacion_publica','la evaluación por enlace'),
    ('evaluacion_responder','contestar esa evaluación'),
    ('invitacion_ver','el alta por invitación'),
    ('staff_login','entrar con usuario y contraseña'),
    ('obtener_staff_cred','la credencial compartida'),
    ('staff_actualizar_hash','cambiar la propia contraseña'),
    ('login_estado','el freno de intentos'),
    ('login_fallo','el freno de intentos'),
    ('login_exito','el freno de intentos'),
    ('acceso_registrar','la bitácora de entradas'),
    ('claim_capturas','las fotos del puente QR'),
    ('token_pairing_valido','valida el token del puente QR'),
    ('etaax_area_de_rol','ayudante de áreas'),
    ('etaax_carpeta_global','ayudante de carpetas'),
    -- La que la v71 marcó por error y la revisión salvó: la política de
    -- Storage que deja al QR subir su foto es TO anon y la llama.
    ('_entrada_token_ok','la política de subida del QR la necesita')
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
-- Fin v72. Lo que salga con «⚠ REVISAR» es lo único que pide decisión; en esta
-- corrida deberían ser las que solo contestan sobre quien pregunta
-- (es_staff_de, is_platform_admin, etaax_negocio_alcanzable, etaax_puede_neg),
-- que se revisaron y no filtran nada: sin sesión devuelven `false`.
-- ============================================================================
