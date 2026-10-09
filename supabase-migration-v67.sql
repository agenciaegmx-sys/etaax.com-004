-- ============================================================================
-- ETAAX — Migración v67: el conteo del QR dice CUÁNTO, y de cuál
-- ----------------------------------------------------------------------------
-- POR QUÉ
-- En el QR, «Ver lo registrado» enseña los conteos del periodo con el nombre
-- del producto y la hora. Falta lo único por lo que se entra a esa pantalla:
-- la CANTIDAD. «¿Ya conté la cava?» se responde con el número, no con la hora.
--
-- Y falta la identidad del producto. El catálogo distingue «Bohemia 355 ml ·
-- Viena Obscura» de sus otros dos estilos, pero el historial solo devolvía
-- «Bohemia»: tres renglones idénticos para tres cervezas distintas.
--
-- Esto NO era un problema de pantalla. La función que sirve el historial
-- (entrada_historial, v53) armaba el conteo campo por campo y esos tres no
-- estaban en la lista. Aquí se agregan.
--
-- `insumoId` va además de `meta` a propósito: los conteos que ya están
-- guardados no traen `meta` —se empezó a guardar con esta misma entrega— y
-- con el id la pantalla los resuelve contra el catálogo que ya tiene cargado.
-- Así la lista no queda a medias mientras conviven los de antes y los de ahora.
--
-- OJO (BH21): esto REESCRIBE entrada_historial completa. Lo demás que hace
-- —las dos llaves de acceso, el periodo calculado en el servidor, los
-- movimientos, el filtro por sucursal y área— va IGUAL que en la v53. Un
-- CREATE OR REPLACE no avisa de lo que se lleva por delante.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

CREATE OR REPLACE FUNCTION entrada_historial(
    p_neg     TEXT,
    p_token   TEXT,
    p_niphash TEXT,
    p_suc     TEXT,
    p_area    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_desde TEXT;
    v_inv   TEXT;
    v_movs  JSONB;
    v_cnts  JSONB;
BEGIN
    -- Mismas dos llaves que para escribir: el token del QR y el NIP de la
    -- persona. Sin las dos, no se devuelve nada.
    IF NOT _entrada_token_ok(p_neg, p_token) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'token');
    END IF;
    IF p_niphash IS NULL OR p_niphash = ''
       OR NOT EXISTS (SELECT 1 FROM staff s
                       WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nip');
    END IF;

    /* El corte del periodo: el último inventario CERRADO de esta sucursal y
       área. `cierreOperativo` es el momento real en que terminó el conteo;
       los inventarios viejos no lo traen, así que se usa el final de su día. */
    SELECT COALESCE(i.datos->>'cierreOperativo', (i.datos->>'fecha') || 'T23:59:59'),
           i.datos->>'nombre'
      INTO v_desde, v_inv
      FROM inventarios i
     WHERE i.negocio_id = p_neg
       AND (i.datos->>'cerrado')::boolean IS TRUE
       AND COALESCE(NULLIF(i.datos->>'sucursalId', ''), 'suc_principal')
           = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
       AND (p_area IS NULL OR p_area = '' OR i.datos->>'area' = p_area)
     ORDER BY COALESCE(i.datos->>'cierreOperativo', i.datos->>'fecha') DESC
     LIMIT 1;

    /* Movimientos del periodo. Se ordenan del más nuevo al más viejo: lo que
       acaba de capturar el compañero es lo que hay que ver primero. */
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'registrado' DESC), '[]'::jsonb)
      INTO v_movs
      FROM (
        SELECT jsonb_build_object(
                 'concepto',  e.datos->>'concepto',
                 'nombre',    e.datos->>'nombre',
                 'cantidad',  e.datos->>'cantidad',
                 'unidad',    e.datos->>'unidad',
                 'fecha',     e.datos->>'fecha',
                 'hora',      e.datos->>'hora',
                 'quien',     e.datos->>'registradoPor',
                 'registrado', COALESCE(e.datos->>'registrado', e.created_at::text)
               ) AS x
          FROM entradas_log e
         WHERE e.negocio_id = p_neg
           AND COALESCE(e.datos->>'borrada', 'false') <> 'true'
           AND COALESCE(NULLIF(e.datos->>'sucursalId', ''), 'suc_principal')
               = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
           AND (v_desde IS NULL
                OR COALESCE(e.datos->>'registrado', e.created_at::text) > v_desde)
      ) t;

    /* Conteos: lo que ya se contó en este periodo. Es el dato que evita el
       trabajo repetido — el más caro de todos en un inventario. */
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'creado' DESC), '[]'::jsonb)
      INTO v_cnts
      FROM (
        SELECT jsonb_build_object(
                 'nombre', c.datos->>'nombre',
                 -- LA CANTIDAD ERA LO ÚNICO QUE NO VIAJABA. La pantalla decía
                 -- qué producto y a qué hora, pero no CUÁNTO — que es el dato
                 -- por el que se entra a mirar: «¿ya conté la cava?» se
                 -- responde con el número, no con la hora.
                 'cerradasBodega', c.datos->>'cerradasBodega',
                 'cerradasBarra',  c.datos->>'cerradasBarra',
                 -- Identidad del producto: con tres estilos de Bohemia, tres
                 -- renglones que dicen «Bohemia» no se distinguen. `meta` la
                 -- guarda el celular al contar; `insumoId` deja que los
                 -- conteos VIEJOS —que no la traen— se resuelvan contra el
                 -- catálogo que ya tiene cargado la pantalla.
                 'meta',     c.datos->>'meta',
                 'insumoId', c.datos->>'insumoId',
                 'nota',   NULLIF(c.datos->>'nota', ''),
                 'fecha',  c.datos->>'fecha',
                 'hora',   c.datos->>'hora',
                 'quien',  c.datos->>'registradoPor',
                 'creado', c.created_at::text
               ) AS x
          FROM inventario_conteos c
         WHERE c.negocio_id = p_neg
           AND COALESCE(NULLIF(c.datos->>'sucursalId', ''), 'suc_principal')
               = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
           AND (p_area IS NULL OR p_area = '' OR c.datos->>'area' = p_area)
           AND (v_desde IS NULL OR c.created_at::text > v_desde)
      ) t;

    RETURN jsonb_build_object(
        'ok',          true,
        'desde',       v_desde,
        'inventario',  v_inv,
        'movimientos', v_movs,
        'conteos',     v_cnts
    );
END;
$$;

REVOKE ALL ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Los tres campos nuevos tienen que estar, y lo de la v53 seguir ahí.
WITH d AS (
    SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'entrada_historial'
)
SELECT * FROM (
    SELECT 1 AS n, 'El conteo devuelve la cantidad' AS prueba,
           CASE WHEN def LIKE '%cerradasBodega%' AND def LIKE '%cerradasBarra%'
                THEN 'PASA' ELSE 'FALLA' END AS resultado FROM d
    UNION ALL
    SELECT 2, 'El conteo devuelve de cuál producto',
           CASE WHEN def LIKE '%''meta''%' AND def LIKE '%''insumoId''%' THEN 'PASA' ELSE 'FALLA' END FROM d
    UNION ALL
    SELECT 3, 'Sigue pidiendo el token del QR',
           CASE WHEN def LIKE '%_entrada_token_ok%' THEN 'PASA' ELSE 'FALLA' END FROM d
    UNION ALL
    SELECT 4, 'Sigue pidiendo el NIP',
           CASE WHEN def LIKE '%p_niphash%' THEN 'PASA' ELSE 'FALLA' END FROM d
    UNION ALL
    SELECT 5, 'Sigue devolviendo los movimientos',
           CASE WHEN def LIKE '%movimientos%' THEN 'PASA' ELSE 'FALLA' END FROM d
    UNION ALL
    SELECT 6, 'Sigue calculando el periodo en el servidor',
           CASE WHEN def LIKE '%v_desde%' THEN 'PASA' ELSE 'FALLA' END FROM d
) t ORDER BY n;

-- ============================================================================
-- Fin v67. Después de correrla, en el QR → «Ver lo registrado»:
--   · cada conteo dice cuántas piezas y de dónde (bodega / barra);
--   · y de cuál producto exactamente, con su contenido y su variedad.
-- ============================================================================
