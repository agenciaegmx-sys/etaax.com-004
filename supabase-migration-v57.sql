-- ============================================================================
-- ETAAX — Migración v57: el portal del colaborador deja de ver doble
-- ----------------------------------------------------------------------------
-- QUÉ SE VE MAL
-- En el portal del QR, una misma receta aparece DOS veces: una con su foto,
-- grupo y tiempo, y otra pelona. En el ERP aparece una sola.
--
-- POR QUÉ
-- Desde que las recetas se independizaron por sucursal, cada producto vive como
-- un MAESTRO más una COPIA por sucursal, unidas por `origenId`. El ERP colapsa
-- ese par y enseña el que aplica al contexto. `portal_recetas` (v46) no: nació
-- antes de ese modelo y devuelve TODAS las filas del negocio, así que el
-- colaborador ve el maestro y la copia como si fueran dos platillos distintos.
--
-- CÓMO SE ARREGLA
-- Con la MISMA regla que usa el ERP (_makeRecetaResolver en insumo-label.js):
-- se agrupa por id canónico (`origenId` si es copia, `id` si es maestro) y se
-- elige uno solo, en este orden:
--    1º la copia que vive en la sucursal del colaborador,
--    2º el maestro,
--    3º cualquiera, antes que no enseñar nada.
-- Para eso el portal necesita saber en qué sucursal está el colaborador, dato
-- que `portal_perfil` tenía a la mano y no devolvía. Ahora sí.
--
-- LO QUE ESTO NO ARREGLA, dicho claro: dos recetas capturadas por separado con
-- el mismo nombre (dos maestros, sin `origenId` que las una) SIGUEN saliendo
-- dos veces, aquí y en el ERP. Eso no es un problema de vista sino de datos, y
-- juntarlas por nombre sería peor: dos platillos pueden llamarse igual.
--
-- Idempotente: se puede correr varias veces. Requiere v46.
-- ============================================================================

-- ── 1. ¿Esta receta vive en esta sucursal? ──────────────────────────────────
-- Copia literal de la regla del cliente (_recetaEnSuc, insumo-label.js):
--   · con `sucursales`, manda esa lista;
--   · sin ella, vale `sucursalId`;
--   · sin ninguna de las dos, es una receta vieja y se da por de Matriz
--     ('suc_principal') — salvo que esté marcada `_global`, que es el maestro
--     del catálogo y no vive en ninguna sucursal.
-- Si esta regla y la del cliente se separan, el portal y el ERP enseñarán
-- recetarios distintos y nadie sabrá cuál creer.
CREATE OR REPLACE FUNCTION _receta_en_suc(p_datos JSONB, p_suc TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN jsonb_typeof(p_datos->'sucursales') = 'array'
             AND jsonb_array_length(p_datos->'sucursales') > 0
        THEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(p_datos->'sucursales') AS s(v)
             WHERE COALESCE(NULLIF(s.v,''),'suc_principal') = COALESCE(NULLIF(p_suc,''),'suc_principal')
        )
        WHEN COALESCE(p_datos->>'sucursalId','') <> ''
        THEN (p_datos->>'sucursalId') = COALESCE(NULLIF(p_suc,''),'suc_principal')
        ELSE COALESCE((p_datos->>'_global')::boolean, false) = false
             AND COALESCE(NULLIF(p_suc,''),'suc_principal') = 'suc_principal'
    END;
$$;

-- ── 2. El perfil ahora dice en qué sucursal está el colaborador ─────────────
CREATE OR REPLACE FUNCTION portal_perfil(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'nombre', s.datos->>'nombre',
        'puesto', s.datos->>'puesto',
        -- Sin área asignada se asume ADMINISTRACIÓN, que es la más restrictiva en
        -- lo operativo: ve guías administrativas y ningún recetario de área. Así,
        -- a un colaborador sin configurar no se le abre de más por descuido.
        'area',   COALESCE(NULLIF(s.datos->>'area',''), 'administracion'),
        -- Sucursal del colaborador: sirve para elegir CUÁL copia de cada receta
        -- enseñarle. Sin asignar, Matriz — que es donde viven las recetas viejas.
        'sucursalId', COALESCE(NULLIF(s.datos->>'sucursalId',''), 'suc_principal')
    )
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
      AND p_niphash IS NOT NULL AND p_niphash <> ''
      AND _entrada_token_ok(p_neg, p_token)
    LIMIT 1;
$$;

-- ── 3. El recetario, sin ver doble ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal_recetas(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_perfil JSONB;
    v_area   TEXT;
    v_suc    TEXT;
BEGIN
    v_perfil := portal_perfil(p_neg, p_token, p_niphash);
    v_area   := v_perfil->>'area';
    IF v_area IS NULL THEN RETURN; END IF;   -- NIP o token inválido: nada
    v_suc    := COALESCE(NULLIF(v_perfil->>'sucursalId',''), 'suc_principal');

    RETURN QUERY
    WITH candidatas AS (
        SELECT
            r.datos,
            -- Id canónico: la copia apunta a su maestro con `origenId`.
            COALESCE(NULLIF(r.datos->>'origenId',''), r.datos->>'id') AS canon,
            CASE
                WHEN _receta_en_suc(r.datos, v_suc)              THEN 0   -- la de su sucursal
                WHEN COALESCE(r.datos->>'origenId','') = ''      THEN 1   -- el maestro
                ELSE 2                                                    -- cualquiera, antes que nada
            END AS prioridad,
            r.datos->>'id' AS rid
        FROM recetas r
        WHERE r.negocio_id = p_neg
          AND COALESCE(r.datos->>'status','activa') <> 'inactiva'
          AND (
                (v_area = 'barra'  AND r.datos->>'tipo' IN ('bebidas','sub-bebidas'))
             OR (v_area = 'cocina' AND r.datos->>'tipo' IN ('alimentos','sub-alimentos'))
          )
    ),
    -- Una por producto. El desempate por `rid` hace el resultado ESTABLE: sin
    -- él, dos filas con la misma prioridad podrían alternarse entre llamadas y
    -- la receta cambiaría de ficha sola, que es peor que verla doble.
    unica AS (
        SELECT DISTINCT ON (canon) datos
        FROM candidatas
        ORDER BY canon, prioridad, rid
    )
    SELECT jsonb_build_object(
        'id',            u.datos->>'id',
        'nombre',        u.datos->>'nombre',
        'tipo',          u.datos->>'tipo',
        'grupo',         u.datos->>'grupo',
        'categoria',     u.datos->>'categoria',
        'cristaleria',   u.datos->>'cristaleria',
        'tiempo',        u.datos->>'tiempo',
        'procedimiento', u.datos->>'procedimiento',
        'foto',          u.datos->>'foto',
        'camposExtra',   u.datos->'camposExtra',
        /* Los ingredientes se re-arman campo por campo A PROPÓSITO, en vez de
           mandar el objeto y quitarle el costo: si mañana alguien agrega un campo
           nuevo con dinero adentro, con una lista blanca NO se filtra solo. Con
           una lista negra sí, y nadie se entera. */
        'ingredientes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'nombre',   i->>'nombre',
                'desc',     i->>'desc',
                'cantidad', i->>'cantidad',
                'unidad',   i->>'unidad'
            ) ORDER BY idx)
            FROM jsonb_array_elements(COALESCE(u.datos->'ingredientes','[]'::jsonb))
                 WITH ORDINALITY AS t(i, idx)
        ), '[]'::jsonb)
    )
    FROM unica u;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_perfil(TEXT,TEXT,TEXT)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_recetas(TEXT,TEXT,TEXT) TO anon, authenticated;

-- ============================================================================
-- COMPROBACIÓN — con un token y un nipHash reales:
--   SELECT count(*) FROM portal_recetas('NEG','TOKEN','NIPHASH');
--   -- debe bajar respecto a antes, y coincidir con lo que enseña el ERP.
--
--   -- ¿Queda algún nombre repetido? (debe salir vacío)
--   SELECT x->>'nombre', count(*)
--     FROM portal_recetas('NEG','TOKEN','NIPHASH') x
--    GROUP BY 1 HAVING count(*) > 1;
--
--   -- Si alguno sale, son DOS recetas capturadas por separado con el mismo
--   -- nombre (dos maestros sin `origenId`): eso se arregla en el catálogo,
--   -- borrando la que sobra, no aquí.
-- ============================================================================
-- Fin v57.
-- ============================================================================
