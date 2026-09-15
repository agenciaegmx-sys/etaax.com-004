-- ============================================================================
-- ETAAX — Migración v59: el colaborador ve SOLO lo de su sucursal
-- ----------------------------------------------------------------------------
-- QUÉ CAMBIA
-- Si un colaborador está asignado a una sucursal, el portal del QR le muestra
-- únicamente los datos de ESA sucursal. Si no tiene sucursal asignada, ve todo
-- lo del negocio — como hasta ahora.
--
-- Esa condición no es un detalle: hoy hay colaboradores sin sucursal, y filtrar
-- a ciegas los dejaría sin nada que consultar. Así el cambio se activa solo
-- donde hay con qué decidir.
--
-- DOS COSAS SE CIERRAN
--
-- 1. RECETAS. `portal_recetas` traía todo el recetario del negocio y la sucursal
--    solo elegía QUÉ VERSIÓN de cada receta enseñar (v57/v58). Ahora también
--    decide CUÁLES entran.
--
-- 2. CHECK LISTS — y este era un hoyo de verdad. `checklist_plantillas` devolvía
--    los checklists de TODAS las sucursales y el filtro se hacía en el navegador
--    (checklist.html). O sea que los datos de las otras sucursales SÍ viajaban al
--    teléfono: bastaba abrir las herramientas del navegador para leerlos. Un
--    filtro en el cliente es una cortina, no una puerta. Ahora filtra el
--    servidor, que es quien sabe quién eres — por eso la función pide el NIP.
--
-- LA REGLA, dicha con cuidado
--   · Lo que DECLARA sucursal se acota: si no es la tuya, no lo ves.
--   · Lo que NO declara ninguna sucursal se considera del NEGOCIO y lo ve todo
--     el mundo. Es el caso de las recetas y checklists viejos, de antes de que
--     existieran las sucursales: esconderlos no protegería nada —no son de nadie
--     más— y dejaría el recetario medio vacío de un día para otro.
--     (Es la misma regla que ya usaba el área en los checklists: una plantilla
--     sin área se le muestra a todos.)
--
-- ANTES DE CORRERLA, mide cuánto cambia para cada sucursal — al final hay una
-- consulta para eso. Si a una sucursal le quedan 12 recetas de 145, lo que falta
-- no es esta migración sino asignar esas recetas en el catálogo.
--
-- Idempotente: se puede correr varias veces. Requiere v57 y v58.
-- ============================================================================

-- ── 1. ¿Este registro DECLARA sucursal? ─────────────────────────────────────
-- Distinto de "¿vive en tal sucursal?": aquí solo se pregunta si alguien se
-- tomó la molestia de decirlo. Sin esta distinción, una receta vieja (que no
-- declara nada) se leería como "de Matriz" y desaparecería para las demás
-- sucursales — que es justo lo que no se quiere.
CREATE OR REPLACE FUNCTION _declara_suc(p_datos JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT (jsonb_typeof(p_datos->'sucursales') = 'array'
            AND jsonb_array_length(p_datos->'sucursales') > 0)
        OR COALESCE(p_datos->>'sucursalId','') <> '';
$$;

-- ── 2. Recetas: solo las de su sucursal ─────────────────────────────────────
CREATE OR REPLACE FUNCTION portal_recetas(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_perfil JSONB;
    v_area   TEXT;
    v_asign  TEXT;   -- la sucursal ASIGNADA, o NULL si no tiene
    v_suc    TEXT;   -- la que se usa para ordenar (con Matriz de respaldo)
BEGIN
    v_perfil := portal_perfil(p_neg, p_token, p_niphash);
    v_area   := v_perfil->>'area';
    IF v_area IS NULL THEN RETURN; END IF;   -- NIP o token inválido: nada

    -- Se guardan por separado a propósito: "sin asignar" y "asignado a Matriz"
    -- son cosas distintas. El primero ve todo; el segundo solo Matriz.
    v_asign  := NULLIF(v_perfil->>'sucursalId','');
    v_suc    := COALESCE(v_asign, 'suc_principal');

    RETURN QUERY
    WITH candidatas AS (
        SELECT
            r.datos,
            COALESCE(NULLIF(r.datos->>'origenId',''), r.datos->>'id') AS canon,
            CASE
                WHEN _receta_en_suc(r.datos, v_suc)              THEN 0   -- la de su sucursal
                WHEN COALESCE(r.datos->>'origenId','') = ''      THEN 1   -- el maestro
                ELSE 2                                                    -- las demás
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
    grupos AS (
        SELECT canon,
               jsonb_agg(datos ORDER BY prioridad, rid) AS filas,
               -- ¿Alguna de sus filas vive en la sucursal del colaborador?
               bool_or(_receta_en_suc(datos, v_suc)) AS es_de_su_suc,
               -- ¿Alguna declara sucursal? Si ninguna, es del negocio entero.
               bool_or(_declara_suc(datos))          AS alguien_declara
        FROM candidatas
        GROUP BY canon
    ),
    visibles AS (
        SELECT * FROM grupos g
        -- Sin sucursal asignada: ve todo, como antes.
        WHERE v_asign IS NULL
           -- Con sucursal: la suya, más lo que no es de nadie en particular.
           OR g.es_de_su_suc
           OR NOT g.alguien_declara
    )
    SELECT jsonb_build_object(
        -- La identidad viene de la fila PREFERIDA, no del primero que tenga algo:
        -- mezclar ids haría que abrir la receta llevara a otra.
        'id',            (g.filas->0)->>'id',
        'nombre',        COALESCE(_primer_texto(g.filas, 'nombre'), ''),
        'tipo',          COALESCE(_primer_texto(g.filas, 'tipo'), ''),
        'grupo',         _primer_texto(g.filas, 'grupo'),
        'categoria',     _primer_texto(g.filas, 'categoria'),
        'cristaleria',   _primer_texto(g.filas, 'cristaleria'),
        'tiempo',        _primer_texto(g.filas, 'tiempo'),
        'procedimiento', _primer_texto(g.filas, 'procedimiento'),
        'foto',          _primer_texto(g.filas, 'foto'),
        'camposExtra',   COALESCE(_primer_json(g.filas, 'camposExtra'), '{}'::jsonb),
        /* Los ingredientes se re-arman campo por campo A PROPÓSITO, en vez de
           mandar el objeto y quitarle el precio: si mañana alguien agrega un campo
           nuevo con dinero adentro, con una lista blanca NO se filtra solo. Con
           una lista negra sí, y nadie se entera. */
        'ingredientes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'nombre',   i->>'nombre',
                'desc',     i->>'desc',
                'cantidad', i->>'cantidad',
                'unidad',   i->>'unidad'
            ) ORDER BY idx)
            FROM jsonb_array_elements(COALESCE(_primer_json(g.filas, 'ingredientes'), '[]'::jsonb))
                 WITH ORDINALITY AS t(i, idx)
        ), '[]'::jsonb)
    )
    FROM visibles g;
END;
$$;

-- ── 3. Check lists: que el filtro lo haga el servidor ───────────────────────
-- La firma gana `p_niphash` — sin saber QUIÉN pregunta no se puede acotar. Va
-- con DEFAULT para que un portal todavía sin actualizar siga funcionando
-- durante el rato entre correr esto y publicar: en ese caso se comporta como
-- antes (devuelve todo y filtra el navegador), que es lo que ya hacía.
-- Hay que TIRAR la vieja antes: con dos firmas quedarían las dos vivas y la
-- llamada de dos argumentos seguiría cayendo en la de la v38.
DROP FUNCTION IF EXISTS checklist_plantillas(TEXT, TEXT);

CREATE OR REPLACE FUNCTION checklist_plantillas(p_neg TEXT, p_token TEXT,
                                                p_niphash TEXT DEFAULT NULL)
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_asign TEXT;
BEGIN
    IF NOT _entrada_token_ok(p_neg, p_token) THEN RETURN; END IF;

    IF p_niphash IS NOT NULL AND p_niphash <> '' THEN
        v_asign := NULLIF((portal_perfil(p_neg, p_token, p_niphash))->>'sucursalId','');
    END IF;

    RETURN QUERY
    SELECT c.datos
    FROM checklists c
    WHERE c.negocio_id = p_neg
      AND (
            v_asign IS NULL                                     -- sin asignar: todo
         OR COALESCE(c.datos->>'sucursalId','') = v_asign       -- la suya
         OR COALESCE(c.datos->>'sucursalId','') = ''            -- la general del negocio
      );
END;
$$;

GRANT EXECUTE ON FUNCTION portal_recetas(TEXT,TEXT,TEXT)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION checklist_plantillas(TEXT,TEXT,TEXT)        TO anon, authenticated;

-- ============================================================================
-- ANTES DE CORRERLA — cuánto va a ver cada sucursal. Cambia 'NEG' y 'SUC_ID':
--
--   SELECT count(*) FILTER (WHERE es_de_su_suc OR NOT alguien_declara) AS vera,
--          count(*)                                                    AS hay_en_el_negocio
--     FROM (
--       SELECT COALESCE(NULLIF(datos->>'origenId',''), datos->>'id') AS canon,
--              bool_or(_receta_en_suc(datos, 'SUC_ID')) AS es_de_su_suc,
--              bool_or(_declara_suc(datos))             AS alguien_declara
--         FROM recetas
--        WHERE negocio_id = 'NEG'
--          AND COALESCE(datos->>'status','activa') <> 'inactiva'
--          AND datos->>'tipo' IN ('alimentos','sub-alimentos')
--        GROUP BY 1
--     ) t;
--
-- Si el número de la izquierda te parece corto, lo que falta es asignar esas
-- recetas a sus sucursales en el catálogo — no dejar de filtrar.
--
-- DESPUÉS DE CORRERLA — con un token y un nipHash reales:
--   SELECT count(*) FROM portal_recetas('NEG','TOKEN','NIPHASH');
--   SELECT count(*) FROM checklist_plantillas('NEG','TOKEN','NIPHASH');
--
-- Y quién sigue sin sucursal asignada (esos ven todo, a propósito):
--   SELECT s.datos->>'nombre', s.datos->>'puesto'
--     FROM staff s
--    WHERE s.negocio_id = 'NEG' AND COALESCE(s.datos->>'sucursalId','') = ''
--    ORDER BY 1;
-- ============================================================================
-- Fin v59.
-- ============================================================================
