-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · v66 — La carta pública por QR
--
-- QUÉ ES. Un QR que el cliente del restaurante escanea en la mesa y ve la carta
-- con fotos: nombre, grupo y foto del platillo. Nada más. Reutiliza las fotos
-- que ya se subieron para costear.
--
-- ── EL TOKEN ES NUEVO, Y NO ES NEGOCIABLE ──────────────────────────────────
--
-- Hay tentación de reutilizar `entrada_token`, el del QR de la barra. NO.
--
-- Ese token abre `entrada_insumos`, que devuelve el catálogo COMPLETO del
-- negocio con costos de compra y proveedores. Y esta carta se va a pegar en las
-- mesas, a subir a un Linktree y a mandar por WhatsApp — justamente lo que se
-- quiere que pase. Con el token compartido, cualquier cliente con curiosidad
-- podría jalar la lista de costos desde su casa.
--
-- Token propio, por SUCURSAL, que solo abre la carta de esa sucursal. Si se
-- filtra, lo que se filtra es la carta — que ya es pública por definición.
--
-- ── LO QUE SALE, Y LO QUE NO ───────────────────────────────────────────────
--
-- La consulta arma cada platillo CAMPO POR CAMPO con lista blanca. No se manda
-- la receta y se le quitan cosas: con lista negra, el día que alguien agregue
-- un campo con un costo adentro, se publica solo y nadie se entera.
--
--   SALE:     nombre (es / en), grupo, foto, y —solo si se pidió— descripción
--             y precio.
--   NO SALE:  ingredientes, procedimiento, costo, food cost, utilidad,
--             proveedor, rendimiento, mermas. Nada de eso se consulta siquiera.
--
-- ── TRES CANDADOS, Y LOS TRES IMPORTAN ─────────────────────────────────────
--
--   1. NADA es visible hasta que se prenda a mano, platillo por platillo. Un
--      menú que se publica solo es un menú con la salsa madre adentro.
--   2. Las SUB-RECETAS no salen nunca: jarabes, salsas y bases son cocina
--      interna. Ni siquiera se consultan — el filtro de tipo las deja fuera
--      antes del de visibilidad.
--   3. Solo lo de ESA sucursal, con la misma regla de membresía que el resto
--      del sistema (_receta_en_suc, v57).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE. No toca datos.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La configuración de la carta, una fila por sucursal ──────────────────
-- id = <negocio>|<sucursal>. Guarda el token, los grupos con su orden y los
-- ajustes generales (título, si se enseñan precios, etc.).
CREATE TABLE IF NOT EXISTS menu_publico (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE menu_publico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own"          ON menu_publico;
DROP POLICY IF EXISTS "staff_acceso" ON menu_publico;
DROP POLICY IF EXISTS "admin_all"    ON menu_publico;
CREATE POLICY "own" ON menu_publico FOR ALL
    USING      (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));
CREATE POLICY "staff_acceso" ON menu_publico FOR ALL
    USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id));
CREATE POLICY "admin_all" ON menu_publico FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- El token se busca por sí solo al abrir la carta: sin índice, cada escaneo
-- recorrería la tabla entera.
CREATE INDEX IF NOT EXISTS menu_publico_token_idx
    ON menu_publico ((datos->>'token'));

-- ── 2. Conseguir (o crear) el token de una sucursal ─────────────────────────
-- Solo con sesión y solo del propio negocio. Devuelve el mismo token si ya
-- existe: regenerarlo en cada llamada invalidaría los QR ya impresos.
CREATE OR REPLACE FUNCTION menu_token_asegurar(p_neg TEXT, p_suc TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id TEXT; v_tok TEXT; v_owner UUID;
BEGIN
    SELECT usuario_id INTO v_owner FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'negocio no encontrado'; END IF;
    IF NOT (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;

    v_id := p_neg || '|' || COALESCE(NULLIF(p_suc,''), 'suc_principal');
    SELECT datos->>'token' INTO v_tok FROM menu_publico WHERE id = v_id;
    IF v_tok IS NOT NULL AND v_tok <> '' THEN RETURN v_tok; END IF;

    v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO menu_publico (id, negocio_id, datos)
    VALUES (v_id, p_neg, jsonb_build_object('token', v_tok,
                                            'sucursalId', COALESCE(NULLIF(p_suc,''), 'suc_principal')))
    ON CONFLICT (id) DO UPDATE
        SET datos = menu_publico.datos || jsonb_build_object('token', v_tok),
            updated_at = now();
    RETURN v_tok;
END;
$$;
REVOKE ALL ON FUNCTION menu_token_asegurar(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_token_asegurar(TEXT, TEXT) TO authenticated;

-- ── 3. Rotar el token ───────────────────────────────────────────────────────
-- Si la carta se filtra donde no se quería, o se rehace el diseño de las mesas.
-- INVALIDA los QR impresos: por eso es su propia función y no un efecto de otra.
CREATE OR REPLACE FUNCTION menu_token_rotar(p_neg TEXT, p_suc TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id TEXT; v_tok TEXT; v_owner UUID;
BEGIN
    SELECT usuario_id INTO v_owner FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'negocio no encontrado'; END IF;
    IF NOT (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;
    v_id  := p_neg || '|' || COALESCE(NULLIF(p_suc,''), 'suc_principal');
    v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO menu_publico (id, negocio_id, datos)
    VALUES (v_id, p_neg, jsonb_build_object('token', v_tok,
                                            'sucursalId', COALESCE(NULLIF(p_suc,''), 'suc_principal')))
    ON CONFLICT (id) DO UPDATE
        SET datos = menu_publico.datos || jsonb_build_object('token', v_tok),
            updated_at = now();
    RETURN v_tok;
END;
$$;
REVOKE ALL ON FUNCTION menu_token_rotar(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_token_rotar(TEXT, TEXT) TO authenticated;

-- ── 4. LA CARTA, para cualquiera con el enlace ──────────────────────────────
-- Sin sesión y sin NIP: esto lo abre el cliente del restaurante desde su mesa.
-- Por eso cada campo va enumerado a mano.
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
        'items',    v_items
    );
END;
$$;
REVOKE ALL ON FUNCTION menu_publico_ver(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_publico_ver(TEXT, TEXT) TO anon, authenticated;

-- ── 5. Guardar los ajustes de la carta (título, nota, orden de grupos) ──────
-- MEZCLA sobre lo que ya hay y NUNCA toca el token. El cliente podría mandar
-- un `datos` completo con un upsert normal, y un objeto sin la llave `token`
-- dejaría los QR de las mesas muertos sin que nadie se enterara hasta que un
-- comensal escanea. Por eso el token no se escribe desde aquí: se borra de lo
-- que llegue antes de mezclar.
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
        'grupos', p_cfg->'grupos'
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
REVOKE ALL ON FUNCTION menu_cfg_guardar(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_cfg_guardar(TEXT, TEXT, JSONB) TO authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Que la carta NO pueda devolver nada de dinero interno. Las cuatro columnas
-- deben decir FALSE.
SELECT pg_get_functiondef(p.oid) LIKE '%ingredientes%' AS filtra_ingredientes,
       pg_get_functiondef(p.oid) LIKE '%costo%'        AS filtra_costo,
       pg_get_functiondef(p.oid) LIKE '%proveedor%'    AS filtra_proveedor,
       pg_get_functiondef(p.oid) LIKE '%procedimiento%' AS filtra_procedimiento
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'menu_publico_ver';

-- Que guardar los ajustes NO pueda escribir el token. Debe decir FALSE.
SELECT pg_get_functiondef(p.oid) LIKE '%jsonb_build_object%token%' AS escribe_token
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'menu_cfg_guardar';

-- Y que el token de la carta NO sea el del QR de la barra. Debe salir vacío.
SELECT m.negocio_id
  FROM menu_publico m JOIN negocios g ON g.id = m.negocio_id
 WHERE m.datos->>'token' = g.entrada_token;

-- ============================================================================
-- Fin v66. Después de correrla:
--   · Gestión de Menú puede generar el QR de la carta de cada sucursal.
--   · Nada aparece en esa carta hasta prenderlo platillo por platillo.
--   · Las sub-recetas no salen nunca, ni aunque alguien las prenda.
--   · Los grupos se acomodan a mano y guardar el orden no puede matar el QR.
-- ============================================================================
