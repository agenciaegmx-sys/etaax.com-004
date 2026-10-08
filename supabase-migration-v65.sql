-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · v65 — URGENTE: devolverle a portal_perfil lo que la v64 le quitó
--               + la sucursal sale del NIP, no del enlace
--
-- ── LO PRIMERO, Y HAY QUE CORRERLO YA ──────────────────────────────────────
--
-- La v64 reemplazó portal_perfil con CREATE OR REPLACE para agregarle `rol` y
-- `areaReal`, y al reescribirla completa se llevó por delante DOS cosas de la
-- v63 que no debió tocar:
--
--   1. El filtro `estado = 'Activo'`. Ese es el candado de la v63 —el del caso
--      de la gerente dada de baja que seguía entrando por el QR—. Sin él, un
--      colaborador dado de baja vuelve a obtener su perfil y con eso alcanza el
--      recetario y las guías. NO puede registrar nada (entrada_validar_nip
--      conserva su candado y es la que autoriza las escrituras), pero LEE lo
--      que ya no le toca.
--
--   2. El campo `sucursalId`. Lo leen portal_recetas (v57), checklist_plantillas
--      (v59) y el recetario del portal (v58). Sin él, todos caen a
--      'suc_principal': a cualquier colaborador se le enseñan las recetas de
--      Matriz y los checklists de todas las sucursales.
--
-- Esta migración devuelve las dos y conserva lo que la v64 sí agregó bien.
--
-- ── LO SEGUNDO: LA SUCURSAL SALE DEL NIP ───────────────────────────────────
--
-- El QR lleva la sucursal en el enlace (&s=…) porque cada sucursal imprime el
-- suyo. La app instalada no puede: se instala UNA vez y la usa quien sea del
-- negocio. Pedirle al admin que elija la sucursal al generar el enlace deja la
-- puerta abierta a que alguien registre en la sucursal equivocada.
--
-- Y no hace falta. El token dice de qué NEGOCIO es, y el NIP dice QUIÉN ES —
-- y la ficha de esa persona ya trae su sucursal. O sea que la cadena completa
-- ya existía; solo había que devolver el campo y que el cliente lo use.
--
--   token  →  qué negocio
--   NIP    →  qué persona   →  qué sucursal
--
-- `entrada_sucursal_de_nip` lo deja explícito para que el cliente no tenga que
-- adivinar de qué campo sacarlo, y de paso lleva el mismo candado de estado.
--
-- Idempotente: CREATE OR REPLACE. No toca datos.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. portal_perfil: todo lo de la v63 + lo que la v64 agregó bien ─────────
CREATE OR REPLACE FUNCTION portal_perfil(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'nombre', s.datos->>'nombre',
        'puesto', s.datos->>'puesto',
        -- El ROL del sistema: lista cerrada, no se presta a interpretación. Es
        -- el segundo escalón de la jerarquía con la que el cliente resuelve el
        -- área (campo a mano → rol → puesto).            [lo agregó la v64]
        'rol',      s.datos->>'rol',
        -- El campo TAL CUAL, sin rellenar: '' significa «no capturado», que es
        -- un hecho distinto de «administración».          [lo agregó la v64]
        'areaReal', COALESCE(s.datos->>'area', ''),
        -- Sin área asignada se asume ADMINISTRACIÓN, la más restrictiva en lo
        -- operativo. Lo leen portal_recetas y portal_guias: bajarle el default
        -- les abriría contenido a quien hoy no lo ve.
        'area',   COALESCE(NULLIF(s.datos->>'area',''), 'administracion'),
        -- LA SUCURSAL DE LA PERSONA. Lo leen portal_recetas (v57), el recetario
        -- (v58) y checklist_plantillas (v59) para enseñar la copia que le toca.
        -- La v64 lo perdió y todos cayeron a Matriz.      [vuelve de la v63]
        'sucursalId', COALESCE(NULLIF(s.datos->>'sucursalId',''), 'suc_principal'),
        -- Se devuelve el estado para que el cliente pueda DECIRLO. El candado
        -- real es el WHERE de abajo; esto es solo para explicar.
        'estado', COALESCE(NULLIF(s.datos->>'estado',''), 'Activo')
    )
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
      -- EL CANDADO DE LA V63. Solo pasa quien está ACTIVO. El COALESCE importa:
      -- los colaboradores viejos no traen el campo y sin él quedarían TODOS
      -- fuera de golpe. Sin estado capturado = activo, como siempre se comportó.
      AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
      AND p_niphash IS NOT NULL AND p_niphash <> ''
      AND _entrada_token_ok(p_neg, p_token)
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION portal_perfil(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_perfil(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 2. La sucursal de un NIP, dicha sin rodeos ──────────────────────────────
-- Devuelve el id de la sucursal a la que pertenece quien tecleó ese NIP, o NULL
-- si el NIP no vale, el token no vale o la persona está dada de baja.
--
-- Existe para que el cliente no tenga que saber de qué campo del perfil sale ni
-- qué hacer cuando viene vacío: una sola respuesta, o nada.
CREATE OR REPLACE FUNCTION entrada_sucursal_de_nip(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(NULLIF(s.datos->>'sucursalId',''), 'suc_principal')
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
      AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
      AND p_niphash IS NOT NULL AND p_niphash <> ''
      AND _entrada_token_ok(p_neg, p_token)
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION entrada_sucursal_de_nip(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_sucursal_de_nip(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Las tres funciones que autentican deben traer el candado de estado. Tres
-- renglones, los tres en true.
SELECT p.proname AS funcion,
       pg_get_functiondef(p.oid) LIKE '%estado%Activo%' AS candado_de_baja
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('staff_login', 'entrada_validar_nip', 'portal_perfil')
 ORDER BY p.proname;

-- Y que portal_perfil traiga los cinco campos que sus llamadores esperan.
-- Debe decir true en las cuatro columnas.
SELECT pg_get_functiondef(p.oid) LIKE '%sucursalId%' AS trae_sucursal,
       pg_get_functiondef(p.oid) LIKE '%''rol''%'     AS trae_rol,
       pg_get_functiondef(p.oid) LIKE '%areaReal%'    AS trae_area_real,
       pg_get_functiondef(p.oid) LIKE '%''estado''%'  AS trae_estado
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'portal_perfil';

-- ============================================================================
-- Fin v65. Después de correrla:
--   · Un colaborador dado de baja vuelve a quedar fuera del portal (v63).
--   · Cada quien vuelve a ver las recetas y los checklists de SU sucursal.
--   · El cliente puede preguntar a qué sucursal pertenece un NIP, así que la
--     app instalada ya no necesita que la sucursal venga en el enlace.
-- ============================================================================
