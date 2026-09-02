-- ============================================================================
-- ETAAX — Migración v53: historial del periodo en el QR
-- ----------------------------------------------------------------------------
-- POR QUÉ
-- El colaborador registra entradas, mermas, salidas y conteos desde el celular
-- y no tiene forma de ver qué lleva registrado. Sin eso, cuando dos personas
-- cuentan la misma barra, la segunda no sabe qué ya se hizo y lo vuelve a
-- capturar: conteos duplicados, mermas dobles.
--
-- El QR escribe con cinco funciones (entrada_registrar, inventario_conteo_
-- registrar…) y no tiene NINGUNA para leer. Ésta es esa función.
--
-- SE VE TODO EL PERIODO, DE TODOS. Decisión tomada a propósito: el punto es
-- justamente que no se dupliquen, y para eso hay que ver lo que capturó el
-- compañero. Cada movimiento viene con el nombre de quién lo registró, que es
-- lo que hace útil la transparencia en lugar de incómoda.
--
-- EL PERIODO SE CALCULA AQUÍ, no lo manda el celular: el corte lo marca el
-- último inventario CERRADO de esa sucursal y área, en su `cierreOperativo`
-- (v52 y anteriores no lo tienen → se cae a su `fecha`). Dejar que el cliente
-- proponga el rango sería dejarle elegir qué ve.
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
--   SELECT entrada_historial('<neg>', '<token>', '<niphash>', '', 'barra');
-- ============================================================================
-- Fin v53.
-- ============================================================================
