-- ============================================================================
-- ETAAX — Migración v58: la ficha del portal se arma con lo que SÍ tiene datos
-- ----------------------------------------------------------------------------
-- QUÉ PASÓ
-- La v57 quitó el duplicado del portal, pero dejó ver el registro EQUIVOCADO:
-- la receta aparece sin foto, sin grupo, sin tiempo y sin procedimiento, aunque
-- en el ERP todo eso está capturado.
--
-- POR QUÉ
-- El par maestro + copia no siempre trae lo mismo en los dos lados. En los datos
-- reales hay pares donde uno tiene la ficha completa y el otro es un CASCARÓN:
-- mismo nombre y mismos ingredientes, pero sin foto, sin grupo, sin tiempo ni
-- procedimiento. La v57 elegía por PERTENENCIA (la copia de tu sucursal, si no
-- el maestro) y eso, cuando el elegido resulta ser el cascarón, deja al
-- colaborador sin la mitad de la receta — que es justo lo que va a leer para
-- prepararla.
--
-- CÓMO SE ARREGLA
-- Se deja de elegir UNA fila y se arma la ficha campo por campo: para cada dato
-- se toma el PRIMERO QUE NO ESTÉ VACÍO, recorriendo las filas del producto en el
-- mismo orden de preferencia de la v57 (primero la de tu sucursal, luego el
-- maestro, luego las demás).
--
-- Eso es lo que significa una copia por sucursal: lo que la copia define, manda;
-- lo que no define, se hereda. Antes se heredaba todo o nada.
--
-- EFECTO SECUNDARIO BUENO: ya no importa cuál de los dos registros tenga la
-- foto. Mientras alguno la tenga, el colaborador la ve.
--
-- DE DÓNDE SALE LA SUCURSAL: del COLABORADOR que entra, que es quien sabe dónde
-- trabaja. Eso ya lo hacía la v57 leyendo `staff.datos->>'sucursalId'`.
--
-- Entonces, ¿por qué se veía el maestro? Porque ese campo puede venir VACÍO: el
-- modal de staff trae "— Sin sucursal —" como opción, y sin sucursal el portal
-- cae en Matriz y la copia de la otra sucursal nunca gana.
--
-- Armar la ficha por campos lo resuelve por los dos lados: con sucursal asignada
-- manda lo que su copia define, y sin ella igual se ve la receta completa en vez
-- de un cascarón. Aun así conviene ASIGNARLE SUCURSAL a cada colaborador — es lo
-- que hace que vea SU versión y no una cualquiera.
--
-- Idempotente: se puede correr varias veces. Requiere v57.
-- ============================================================================

-- ── 1. El primer valor que no esté vacío, en orden ──────────────────────────
-- `p_filas` llega ORDENADA por preferencia. jsonb_array_elements conserva ese
-- orden, así que el primero que pase el filtro es el que manda.
CREATE OR REPLACE FUNCTION _primer_texto(p_filas JSONB, p_key TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT f->>p_key
      FROM jsonb_array_elements(p_filas) AS f
     WHERE COALESCE(f->>p_key, '') <> ''
     LIMIT 1;
$$;

-- Igual, pero para valores que son objetos o listas (ingredientes, camposExtra).
-- Una lista vacía o un objeto vacío cuentan como "no hay dato": si no, un
-- cascarón con `ingredientes: []` ganaría y taparía la receta de verdad.
CREATE OR REPLACE FUNCTION _primer_json(p_filas JSONB, p_key TEXT)
RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
    SELECT f->p_key
      FROM jsonb_array_elements(p_filas) AS f
     WHERE f->p_key IS NOT NULL
       AND jsonb_typeof(f->p_key) <> 'null'
       AND (jsonb_typeof(f->p_key) <> 'array'  OR jsonb_array_length(f->p_key) > 0)
       AND (jsonb_typeof(f->p_key) <> 'object' OR f->p_key <> '{}'::jsonb)
     LIMIT 1;
$$;

-- ── 2. El recetario ─────────────────────────────────────────────────────────
-- La firma NO cambia: la sucursal sigue saliendo del colaborador, así que el
-- portal no necesita mandar nada nuevo y la función se reemplaza en su sitio.
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
    /* La sucursal del COLABORADOR que entró: él sabe dónde trabaja. Si no la
       tiene asignada, Matriz — y entonces el orden de preferencia deja de
       significar mucho, pero la ficha se arma igual con lo que haya (abajo). */
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
    -- UNA entrada por producto, con TODAS sus filas ordenadas por preferencia.
    -- El desempate por `rid` la hace estable: sin él, dos filas con la misma
    -- prioridad podrían alternarse entre llamadas y la ficha cambiaría sola.
    grupos AS (
        SELECT canon,
               jsonb_agg(datos ORDER BY prioridad, rid) AS filas
        FROM candidatas
        GROUP BY canon
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
    FROM grupos g;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_recetas(TEXT,TEXT,TEXT) TO anon, authenticated;

-- ============================================================================
-- ANTES QUE NADA: ¿qué colaboradores NO tienen sucursal asignada? Son los que
-- verán "la receta de Matriz" en vez de la suya. Se arregla en el catálogo de
-- colaboradores, no aquí.
--   SELECT s.datos->>'nombre', s.datos->>'puesto'
--     FROM staff s
--    WHERE s.negocio_id = 'NEG'
--      AND COALESCE(s.datos->>'sucursalId','') = ''
--    ORDER BY 1;
--
-- COMPROBACIÓN — con un token y un nipHash reales:
--   -- Ya no debe haber fichas a medias: esto lista las que se ven sin
--   -- procedimiento NI foto (algunas recetas legítimamente no tienen ninguno,
--   -- pero las que sí tenían capturado ya no deben salir aquí).
--   SELECT x->>'nombre'
--     FROM portal_recetas('NEG','TOKEN','NIPHASH') x
--    WHERE COALESCE(x->>'procedimiento','') = '' AND COALESCE(x->>'foto','') = ''
--    ORDER BY 1;
--
--   -- Y sigue sin haber duplicados (debe salir vacío):
--   SELECT x->>'nombre', count(*)
--     FROM portal_recetas('NEG','TOKEN','NIPHASH') x
--    GROUP BY 1 HAVING count(*) > 1;
--
-- APARTE, PARA REVISAR EN EL CATÁLOGO: estos pares tienen un registro con ficha
-- y otro cascarón. El portal ya los lee bien, pero conviene saber que están:
--   SELECT COALESCE(NULLIF(r.datos->>'origenId',''), r.datos->>'id') AS canon,
--          count(*) AS filas,
--          count(*) FILTER (WHERE COALESCE(r.datos->>'procedimiento','') <> '') AS con_proc
--     FROM recetas r
--    WHERE r.negocio_id = 'NEG'
--    GROUP BY 1
--   HAVING count(*) > 1
--      AND count(*) FILTER (WHERE COALESCE(r.datos->>'procedimiento','') <> '') < count(*);
-- ============================================================================
-- Fin v58.
-- ============================================================================
