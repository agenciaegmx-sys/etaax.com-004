-- ============================================================================
-- ETAAX — Migración v68: la carta se ve del negocio, no de ETAAX
-- ----------------------------------------------------------------------------
-- POR QUÉ
-- El QR de la mesa lo escanea un cliente del restaurante, y lo que abre tiene
-- que parecer del restaurante: su logo, el nombre de SU sucursal y sus
-- colores. Tal como estaba, abría una página oscura genérica con el nombre
-- del negocio en texto plano — la carta de ETAAX, no la suya.
--
-- Se guardan tres cosas nuevas en la fila de la carta:
--   · `tema`   — colores, tipografía y estilos de cada campo. Va como BLOQUE
--                y no campo por campo porque crece con el diseño, no con el
--                modelo: añadir «interlineado» mañana no debería pedir otra
--                migración;
--   · `logo`   — el de la sucursal, o el del negocio si la sucursal no tiene
--                (misma jerarquía que los reportes impresos);
--   · `sucNom` — el nombre de la sucursal.
--
-- El logo y el nombre viajan EN LA FILA a propósito: la carta es una página
-- pública, sin sesión, y no puede leer el catálogo del negocio. Guardarlos
-- aquí es lo que le permite enseñarlos sin abrirle ninguna otra puerta.
--
-- LO QUE NO CAMBIA: la lista blanca de los platillos. Siguen saliendo nombre,
-- grupo, foto y —solo si se pidieron— descripción y precio. Ni un campo más.
--
-- OJO (BH21): esto REESCRIBE las dos funciones completas. Los tres candados
-- de la v66 van IGUAL: nada visible hasta prenderlo, sub-recetas fuera, solo
-- esta sucursal. Un CREATE OR REPLACE no avisa de lo que se lleva por delante.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

CREATE OR REPLACE FUNCTION menu_cfg_guardar(p_neg TEXT, p_suc TEXT, p_cfg JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id TEXT; v_owner UUID; v_limpio JSONB;
BEGIN
    SELECT usuario_id INTO v_owner FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'negocio no encontrado'; END IF;
    IF NOT (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;

    -- Solo estas llaves. Una lista blanca y no un `- 'token'`: mañana habrá
    -- otro secreto en esta fila y quitarlo a mano se olvida.
    v_limpio := jsonb_strip_nulls(jsonb_build_object(
        'titulo', NULLIF(p_cfg->>'titulo',''),
        'nota',   NULLIF(p_cfg->>'nota',''),
        'grupos', p_cfg->'grupos',
        -- La apariencia de la carta: colores, tipografía y los estilos de
        -- cada campo. Va como un bloque y no campo por campo porque crece
        -- con el diseño, no con el modelo: añadir «interlineado» mañana no
        -- debería pedir otra migración.
        'tema',   p_cfg->'tema',
        -- El logo y el nombre de la sucursal, para que la carta los enseñe
        -- sin tener que consultar el catálogo del negocio: es una página
        -- pública y no puede leer nada más que su propia fila.
        'logo',   NULLIF(p_cfg->>'logo',''),
        'sucNom', NULLIF(p_cfg->>'sucNom','')
    ));

    v_id := p_neg || '|' || COALESCE(NULLIF(p_suc,''), 'suc_principal');
    INSERT INTO menu_publico (id, negocio_id, datos)
    VALUES (v_id, p_neg, v_limpio || jsonb_build_object('sucursalId',
                                     COALESCE(NULLIF(p_suc,''), 'suc_principal')))
    ON CONFLICT (id) DO UPDATE
        SET datos = menu_publico.datos || v_limpio,
            updated_at = now();
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION menu_publico_ver(p_neg TEXT, p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cfg JSONB; v_suc TEXT; v_neg TEXT; v_items JSONB;
BEGIN
    SELECT datos INTO v_cfg
      FROM menu_publico
     WHERE negocio_id = p_neg
       AND datos->>'token' = p_token
       AND p_token IS NOT NULL AND p_token <> ''
     LIMIT 1;
    IF v_cfg IS NULL THEN RETURN NULL; END IF;

    -- Una carta apagada no se enseña a medias: se dice que está cerrada. Así el
    -- negocio puede bajarla sin despegar los QR de las mesas.
    IF COALESCE((v_cfg->>'activa')::boolean, true) = false THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'cerrada');
    END IF;

    v_suc := COALESCE(NULLIF(v_cfg->>'sucursalId',''), 'suc_principal');
    SELECT datos->>'nombre' INTO v_neg FROM negocios WHERE id = p_neg;

    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'grupo', (x->>'orden')::numeric, x->>'nombre'), '[]'::jsonb)
      INTO v_items
      FROM (
        SELECT jsonb_build_object(
            'id',     r.datos->>'id',
            -- El nombre del menú puede diferir del interno: «Old Fashioned Tata»
            -- en la carta, «OF Tata» en la cocina.
            'nombre', COALESCE(NULLIF(r.datos->'menu'->>'nombreEs',''), r.datos->>'nombre'),
            'nombreEn', NULLIF(r.datos->'menu'->>'nombreEn',''),
            -- El grupo del menú manda sobre el del escandallo: la carta se
            -- acomoda a gusto del negocio, no al de la cocina. Si no se ajustó,
            -- se cae al grupo del escandallo y luego a la categoría — los dos
            -- son texto libre y hay negocios que llenaron uno y no el otro.
            -- MISMA CADENA que _goGrupoDe() en administrativo/menu.html: si una
            -- se desvía, la maqueta del teléfono enseña un orden y la carta
            -- real otro, y nadie entiende por qué no se acomoda.
            'grupo',  COALESCE(NULLIF(r.datos->'menu'->>'grupo',''),
                               NULLIF(r.datos->>'grupo',''),
                               NULLIF(r.datos->>'categoria',''), 'Otros'),
            'orden',  COALESCE(NULLIF(r.datos->'menu'->>'orden','')::numeric, 999),
            -- La foto del menú primero; si no se eligió una, la del escandallo.
            'foto',   COALESCE(NULLIF(r.datos->'menu'->>'foto',''), NULLIF(r.datos->>'foto','')),
            -- Descripción y precio SOLO si se pidieron, uno por uno.
            'desc',   CASE WHEN COALESCE((r.datos->'menu'->>'verDesc')::boolean, false)
                           THEN NULLIF(r.datos->'menu'->>'desc','') END,
            'precio', CASE WHEN COALESCE((r.datos->'menu'->>'verPrecio')::boolean, false)
                           THEN NULLIF(r.datos->>'precioEnCarta','')::numeric END
        ) AS x
        FROM recetas r
       WHERE r.negocio_id = p_neg
         -- CANDADO 1: nada sale hasta que se prenda a mano.
         AND COALESCE((r.datos->'menu'->>'visible')::boolean, false) = true
         -- CANDADO 2: solo platillos y bebidas de carta. Las sub-recetas
         -- (jarabes, salsas, bases) quedan fuera ANTES de mirar nada más.
         AND r.datos->>'tipo' IN ('alimentos', 'bebidas')
         AND COALESCE(r.datos->>'status','activa') <> 'inactiva'
         -- CANDADO 3: solo lo de ESTA sucursal.
         AND _receta_en_suc(r.datos, v_suc)
      ) t;

    RETURN jsonb_build_object(
        'ok',       true,
        'negocio',  v_neg,
        'titulo',   NULLIF(v_cfg->>'titulo',''),
        'nota',     NULLIF(v_cfg->>'nota',''),
        -- El orden de los grupos lo pone el negocio. Lo que no esté en la lista
        -- se acomoda al final, alfabético: un grupo nuevo no debe desaparecer
        -- de la carta por no haberse acomodado todavía.
        'grupos',   COALESCE(v_cfg->'grupos', '[]'::jsonb),
        -- Apariencia y marca de la sucursal. Siguen siendo datos de carta;
        -- la lista blanca de los platillos, intacta.
        --
        -- OJO: aquí NO se nombran los campos del escandallo que no deben
        -- salir, ni para decir que no salen. El candado busca esas palabras
        -- en el texto de la función —es su forma de vigilar la lista blanca—
        -- y un comentario que las menciona lo hace fallar sin que nada esté
        -- mal. La lista blanca se lee arriba: es la que está.
        'tema',     COALESCE(v_cfg->'tema', '{}'::jsonb),
        'logo',     NULLIF(v_cfg->>'logo',''),
        'sucNom',   NULLIF(v_cfg->>'sucNom',''),
        'items',    v_items
    );
END;
$$;

REVOKE ALL ON FUNCTION menu_cfg_guardar(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_cfg_guardar(TEXT, TEXT, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION menu_publico_ver(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_publico_ver(TEXT, TEXT) TO anon, authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Los seis renglones deben decir PASA.
WITH v AS (SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public' AND p.proname='menu_publico_ver'),
     g AS (SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public' AND p.proname='menu_cfg_guardar')
SELECT * FROM (
    SELECT 1 AS n, 'La carta devuelve su apariencia y su marca' AS prueba,
           CASE WHEN def LIKE '%''tema''%' AND def LIKE '%''logo''%' AND def LIKE '%''sucNom''%'
                THEN 'PASA' ELSE 'FALLA' END AS resultado FROM v
    UNION ALL
    SELECT 2, 'Los ajustes se pueden guardar',
           CASE WHEN def LIKE '%''tema''%' AND def LIKE '%''logo''%' THEN 'PASA' ELSE 'FALLA' END FROM g
    UNION ALL
    SELECT 3, 'Nada visible hasta prenderlo (candado 1)',
           CASE WHEN def LIKE '%visible%false) = true%' THEN 'PASA' ELSE 'FALLA' END FROM v
    UNION ALL
    SELECT 4, 'Las sub-recetas siguen fuera (candado 2)',
           CASE WHEN def LIKE '%alimentos%bebidas%' THEN 'PASA' ELSE 'FALLA' END FROM v
    UNION ALL
    SELECT 5, 'Solo esta sucursal (candado 3)',
           CASE WHEN def LIKE '%_receta_en_suc%' THEN 'PASA' ELSE 'FALLA' END FROM v
    UNION ALL
    SELECT 6, 'Y sigue sin poder devolver costos',
           CASE WHEN def LIKE '%costo%' OR def LIKE '%proveedor%' THEN 'FALLA' ELSE 'PASA' END FROM v
) t ORDER BY n;

-- ============================================================================
-- Fin v68. Después de correrla, en Gestión de Menú → QR de la carta →
-- «Ajustes y orden de los grupos» se puede elegir cómo se ve la carta, y el
-- QR y la página salen con el logo y el nombre de la sucursal.
-- ============================================================================
