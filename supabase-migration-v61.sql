-- ═══════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v61 — El QR de inventarios veía TODAS las recetas
-- Corre esto en: Supabase → SQL Editor. Seguro de re-ejecutar.
--
-- QUÉ PASABA, y por qué la pantalla no lo podía arreglar sola:
--
-- La RPC `entrada_recetas` (v32) devolvía una lista LIGERA, hecha a mano con
-- cuatro campos:  id · nombre · tipo · grupo.
--
-- El QR sí tiene la lógica para filtrar —`_enSucQR` para la sucursal y
-- `_unoPorProductoQR` para quitar duplicados maestro/copia—, pero esa lógica
-- necesita campos que la RPC NUNCA mandó:
--
--   · sucursales / sucursalId → sin esto `_enSucQR` no puede decidir, y cae a
--     "sí, muéstrala": TODA receta de TODA sucursal pasaba el filtro.
--   · origenId               → sin esto no hay forma de saber que la copia de
--     la sucursal 2 y la maestra son el MISMO producto, así que un coctel
--     salía cuatro veces (la maestra + una copia por sucursal).
--   · inactivaEn             → una receta pausada en esa sucursal seguía
--     apareciendo.
--
-- Es el mismo hueco que ya tenía el portal QR de staff y que se cerró con la
-- v57. `entrada_insumos` (v27) nunca lo tuvo porque devuelve `i.datos` entero.
--
-- SE SIGUE MANDANDO UNA LISTA ACOTADA, no la receta completa: esta RPC la
-- ejecuta `anon` (un celular sin sesión, autorizado solo por el token del QR).
-- Mandar `r.datos` entero le entregaría a cualquiera con el link los insumos,
-- las cantidades y los COSTOS de cada receta. Se agregan solo los campos que
-- hacen falta para filtrar, y ninguno es sensible.
--
-- `area` se agrega para que el QR pueda separar barra de cocina sin adivinar.
-- Hoy se deduce de `tipo` (bebidas/alimentos), que es lo que ya viaja; si algún
-- día una receta declara su área a mano, esto ya la respeta.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION entrada_recetas(p_neg TEXT, p_token TEXT)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id',          r.id,
        'nombre',      r.datos->>'nombre',
        'tipo',        r.datos->>'tipo',
        'grupo',       r.datos->>'grupo',
        'area',        r.datos->>'area',
        -- Identidad canónica: la copia de una sucursal apunta a su maestra.
        'origenId',    r.datos->>'origenId',
        -- Pertenencia: una u otra según cómo se haya guardado la receta.
        'sucursalId',  r.datos->>'sucursalId',
        'sucursales',  COALESCE(r.datos->'sucursales', '[]'::jsonb),
        -- Pausada en esta sucursal (activo/inactivo global ya lo filtra el WHERE).
        'inactivaEn',  COALESCE(r.datos->'inactivaEn', '[]'::jsonb)
    )
    FROM recetas r
    WHERE r.negocio_id = p_neg
      AND COALESCE(r.datos->>'status', 'activa') <> 'inactiva'
      AND _entrada_token_ok(p_neg, p_token);
$$;
REVOKE ALL ON FUNCTION entrada_recetas(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_recetas(TEXT, TEXT) TO anon, authenticated;

-- Comprobación: debe devolver las 9 llaves de arriba.
-- Cambia 'TU_NEGOCIO' y 'TU_TOKEN' por unos reales para probarla de verdad.
SELECT jsonb_object_keys(entrada_recetas('TU_NEGOCIO', 'TU_TOKEN')) LIMIT 9;

-- ============================================================================
-- Fin v61. Después de correrla, el QR de inventarios:
--   · muestra UNA sola vez cada producto (no la maestra + una copia por sucursal),
--   · solo los de la sucursal del QR por el que se entró,
--   · y respeta lo que esté pausado en esa sucursal.
-- ============================================================================
