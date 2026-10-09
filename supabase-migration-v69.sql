-- ============================================================================
-- ETAAX — Migración v69: borrar un texto de la carta tenía que borrarlo
-- ----------------------------------------------------------------------------
-- EL BUG
-- Se borraba la línea del encabezado, se guardaba… y seguía ahí. Recargabas y
-- volvía. No había manera de quitar un texto una vez escrito.
--
-- La causa estaba aquí, en dos piezas que juntas se comen los borrados:
--
--   1. `jsonb_strip_nulls` tira las llaves nulas, y un texto vacío llegaba
--      como NULL por el `NULLIF(…,'')`. Resultado: «borrado» y «no lo mandé»
--      eran EXACTAMENTE lo mismo para esta función;
--   2. el guardado es un MERGE (`datos || v_limpio`), que es lo correcto —así
--      el editor del menú no pisa lo que escribió el de la apariencia—. Pero
--      un merge con una llave ausente deja la vieja en su sitio.
--
-- Las dos por separado están bien. Juntas hacen que borrar sea imposible.
--
-- LA REGLA NUEVA: «no mandé esa llave» y «la mandé vacía» son cosas distintas.
--   · ausente  → no se toca lo que haya;
--   · vacía    → se QUITA de la fila.
-- Se distingue con `p_cfg ? 'llave'`, que pregunta si la llave viene, sin
-- mirar su valor.
--
-- ----------------------------------------------------------------------------
-- Y DOS CAMBIOS DE DÓNDE VA CADA TEXTO
--
-- `titulo` SE VA. El renglón grande del encabezado es el nombre de la
-- sucursal y nada más: es lo que le dice a quien está en la mesa dónde está
-- sentado. El campo libre invitaba a escribir ahí el nombre de un grupo
-- —«Entradas»— y entonces la carta entera se anunciaba como si fuera de una
-- sola sección. Se quita del editor, se deja de devolver, y el UPDATE de
-- abajo lo saca de las filas que ya lo tenían.
--
-- `grupoNotas` ENTRA. Un texto opcional bajo el título de CADA grupo, que es
-- donde de verdad hace falta: «Menu Alimentos · servido de 1 a 6 pm». Va como
-- un objeto {grupo: texto} y no como una columna porque los grupos nacen y
-- mueren con el escandallo.
--
-- OJO (BH21): esto REESCRIBE las dos funciones completas. Los tres candados
-- de la v66 van IGUAL: nada visible hasta prenderlo, sub-recetas fuera, solo
-- esta sucursal.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

CREATE OR REPLACE FUNCTION menu_cfg_guardar(p_neg TEXT, p_suc TEXT, p_cfg JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id TEXT; v_owner UUID; v_limpio JSONB; v_vacias TEXT[];
BEGIN
    SELECT usuario_id INTO v_owner FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'negocio no encontrado'; END IF;
    IF NOT (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;

    -- Solo estas llaves. Una lista blanca y no un `- 'token'`: mañana habrá
    -- otro secreto en esta fila y quitarlo a mano se olvida.
    --
    -- `p_cfg ? 'x'` pregunta si la llave VIENE, sin mirar su valor. Es lo que
    -- separa «bórralo» de «no lo toqué», que antes eran lo mismo y por eso no
    -- había forma de borrar nada.
    v_limpio := jsonb_strip_nulls(jsonb_build_object(
        'nota',       CASE WHEN p_cfg ? 'nota'   THEN COALESCE(p_cfg->>'nota','')   END,
        'grupos',     p_cfg->'grupos',
        -- El texto opcional bajo el título de cada grupo: {grupo: texto}.
        'grupoNotas', p_cfg->'grupoNotas',
        -- La apariencia de la carta: colores, tipografía y los estilos de
        -- cada campo. Va como un bloque y no campo por campo porque crece
        -- con el diseño, no con el modelo.
        'tema',       p_cfg->'tema',
        -- El logo y el nombre de la sucursal, para que la carta los enseñe
        -- sin tener que consultar el catálogo del negocio: es una página
        -- pública y no puede leer nada más que su propia fila.
        'logo',       CASE WHEN p_cfg ? 'logo'   THEN COALESCE(p_cfg->>'logo','')   END,
        'sucNom',     CASE WHEN p_cfg ? 'sucNom' THEN COALESCE(p_cfg->>'sucNom','') END
    ));

    -- Las que llegaron vacías: esas se QUITAN de la fila en vez de escribirse.
    -- Guardar un '' también funcionaría para leer, pero deja basura que luego
    -- hay que recordar ignorar en cada consulta.
    SELECT COALESCE(array_agg(e.k), '{}'::TEXT[]) INTO v_vacias
      FROM jsonb_each_text(v_limpio) AS e(k, val)
     WHERE e.val = '';

    v_id := p_neg || '|' || COALESCE(NULLIF(p_suc,''), 'suc_principal');
    INSERT INTO menu_publico (id, negocio_id, datos)
    VALUES (v_id, p_neg, (v_limpio - v_vacias) || jsonb_build_object('sucursalId',
                                     COALESCE(NULLIF(p_suc,''), 'suc_principal')))
    ON CONFLICT (id) DO UPDATE
        -- Primero el merge (lo que no se mandó se queda) y DESPUÉS la resta
        -- (lo que se mandó vacío se va). En ese orden: al revés, el merge
        -- volvería a meter lo que la resta acaba de quitar.
        SET datos = (menu_publico.datos || v_limpio) - v_vacias,
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
        -- Ya no viaja `titulo`: el encabezado es el nombre de la sucursal.
        'nota',     NULLIF(v_cfg->>'nota',''),
        -- El orden de los grupos lo pone el negocio. Lo que no esté en la lista
        -- se acomoda al final, alfabético: un grupo nuevo no debe desaparecer
        -- de la carta por no haberse acomodado todavía.
        'grupos',   COALESCE(v_cfg->'grupos', '[]'::jsonb),
        -- El texto opcional de cada grupo, bajo su título.
        'grupoNotas', COALESCE(v_cfg->'grupoNotas', '{}'::jsonb),
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

-- Los títulos que ya se escribieron en el encabezado se van con el campo. Sin
-- esto quedarían guardados para siempre, invisibles y sin forma de borrarlos.
UPDATE menu_publico SET datos = datos - 'titulo' WHERE datos ? 'titulo';

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Los ocho renglones deben decir PASA.
WITH v AS (SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public' AND p.proname='menu_publico_ver'),
     g AS (SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public' AND p.proname='menu_cfg_guardar')
SELECT * FROM (
    SELECT 1 AS n, 'Borrar un texto ahora lo borra' AS prueba,
           CASE WHEN def LIKE '%v_vacias%' AND def LIKE '%p_cfg ? %'
                THEN 'PASA' ELSE 'FALLA' END AS resultado FROM g
    UNION ALL
    SELECT 2, 'El texto por grupo se puede guardar',
           CASE WHEN def LIKE '%grupoNotas%' THEN 'PASA' ELSE 'FALLA' END FROM g
    UNION ALL
    SELECT 3, 'La carta devuelve el texto de cada grupo',
           CASE WHEN def LIKE '%grupoNotas%' THEN 'PASA' ELSE 'FALLA' END FROM v
    UNION ALL
    SELECT 4, 'El encabezado ya no lleva título libre',
           CASE WHEN def LIKE '%''titulo''%' THEN 'FALLA' ELSE 'PASA' END FROM v
    UNION ALL
    SELECT 5, 'Nada visible hasta prenderlo (candado 1)',
           CASE WHEN def LIKE '%visible%false) = true%' THEN 'PASA' ELSE 'FALLA' END FROM v
    UNION ALL
    SELECT 6, 'Las sub-recetas siguen fuera (candado 2)',
           CASE WHEN def LIKE '%alimentos%bebidas%' THEN 'PASA' ELSE 'FALLA' END FROM v
    UNION ALL
    SELECT 7, 'Solo esta sucursal (candado 3)',
           CASE WHEN def LIKE '%_receta_en_suc%' THEN 'PASA' ELSE 'FALLA' END FROM v
    UNION ALL
    SELECT 8, 'Y sigue sin poder devolver costos',
           CASE WHEN def LIKE '%costo%' OR def LIKE '%proveedor%' THEN 'FALLA' ELSE 'PASA' END FROM v
) t ORDER BY n;

-- ============================================================================
-- Fin v69. Después de correrla: borrar la línea del encabezado la borra de
-- verdad, el renglón grande es siempre el nombre de la sucursal, y cada grupo
-- puede llevar su propio texto debajo del título.
-- ============================================================================
