-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v97 — El historial de la app manda la cantidad de los conteos
--
-- (Edwin, 27-nov) «Los conteos del QR en el inventario me salen en ceros y en
-- la versión móvil el modal de corregir se queda congelado; creo que no se
-- cargaron las cantidades».
--
-- Las cantidades SÍ están guardadas: la app móvil mandaba cada conteo como
-- `cantidad` + `unidad`, y el inventario y el editor solo leían las piezas en
-- bodega / barra (`cerradasBodega`, `cerradasBarra`), que es como los manda
-- el QR del navegador. La app ya manda los dos (27-nov) y el inventario lee
-- los conteos viejos por su `cantidad`; esto es lo único que pide servidor:
--
--   entrada_historial   (base: v94, idéntica) además manda la `cantidad`, la
--                       `unidad` y el `area` de cada conteo, para que la app
--                       enseñe el número de los conteos ya mandados y
--                       «Corregir» abra con él puesto.
--
-- No cambia ningún candado ni la firma. Correr a mano en Supabase → SQL
-- Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION entrada_historial(
    p_neg     TEXT,
    p_token   TEXT,
    p_niphash TEXT,
    p_suc     TEXT,
    p_area    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_desde TEXT;
    v_inv   TEXT;
    v_movs  JSONB;
    v_cnts  JSONB;
    v_yo    JSONB;
    v_ajeno BOOLEAN;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN jsonb_build_object('ok', false, 'motivo', 'nip'); END IF;
    IF NOT _entrada_token_ok(p_neg, p_token) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'token');
    END IF;
    v_yo := _entrada_quien(p_neg, p_niphash);
    IF v_yo IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nip');
    END IF;
    v_ajeno := _entrada_edita_ajeno(v_yo->>'rol');

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
     ORDER BY _entrada_instante(COALESCE(NULLIF(i.datos->>'cierreOperativo',''), i.datos->>'fecha' || 'T23:59:59')) DESC
     LIMIT 1;

    /* Movimientos del periodo, del más nuevo al más viejo: lo que acaba de
       capturar el compañero es lo que hay que ver primero. */
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'registrado' DESC), '[]'::jsonb)
      INTO v_movs
      FROM (
        SELECT jsonb_build_object(
                 'id',        e.id,
                 'tipo',      'entrada',
                 'ver',       COALESCE((e.datos->>'ver')::int, 1),
                 'concepto',  e.datos->>'concepto',
                 'nombre',    e.datos->>'nombre',
                 'cantidad',  e.datos->>'cantidad',
                 'unidad',    e.datos->>'unidad',
                 -- (v94) Para la vista «Entradas registradas» de la app: de qué
                 -- producto es, qué tipo de entrada, su nota / factura y cuántas
                 -- fotos trae (las fotos no viajan: son privadas).
                 'insumoId',      NULLIF(e.datos->>'insumoId',''),
                 'tipoEntrada',   NULLIF(e.datos->>'tipo',''),
                 'area',          NULLIF(e.datos->>'area',''),
                 'notaId',        NULLIF(e.datos->>'notaId',''),
                 'notaFolio',     NULLIF(e.datos->>'notaFolio',''),
                 'notaProveedor', NULLIF(e.datos->>'notaProveedor',''),
                 'fotos',         CASE WHEN jsonb_typeof(e.datos->'foto_urls') = 'array'
                                       THEN jsonb_array_length(e.datos->'foto_urls')
                                       WHEN COALESCE(e.datos->>'foto_url','') <> '' THEN 1 ELSE 0 END,
                 -- EL COMENTARIO DE UNA ENTRADA VIVE EN `notas`: es donde lo
                 -- escribe la captura y donde lo lee el ERP. `nota` solo lo
                 -- escribió el editor de la v82 estos días; se sigue leyendo
                 -- para no esconder esos comentarios, pero ya no se guarda ahí.
                 'nota',      COALESCE(NULLIF(e.datos->>'notas',''), NULLIF(e.datos->>'nota','')),
                 'fecha',     e.datos->>'fecha',
                 'hora',      e.datos->>'hora',
                 'quien',     e.datos->>'registradoPor',
                 'editadoPor', NULLIF(e.datos->>'editadoPor',''),
                 'registrado', COALESCE(NULLIF(e.datos->>'registrado',''), e.created_at::text),
                 /* Editable lo resuelve el SERVIDOR, no la pantalla: apagar un
                    botón no es un control, y la RPC vuelve a comprobarlo. Esto
                    es para poder DECIR por qué, que es lo que falta cuando un
                    botón aparece deshabilitado sin explicación. */
                 'puedeEditar',
                     (COALESCE(e.datos->>'staffId','') = (v_yo->>'staffId') OR v_ajeno)
                     AND COALESCE(e.datos->>'concepto','') = 'entrada'
                     AND NOT _entrada_periodo_cerrado(p_neg, p_suc, COALESCE(NULLIF(e.datos->>'area',''), p_area),
                             COALESCE(NULLIF(e.datos->>'registrado',''), e.created_at::text)),
                 'motivoBloqueo', CASE
                     WHEN _entrada_periodo_cerrado(p_neg, p_suc, COALESCE(NULLIF(e.datos->>'area',''), p_area),
                              COALESCE(NULLIF(e.datos->>'registrado',''), e.created_at::text))
                         THEN 'Ya entró en un inventario cerrado'
                     WHEN COALESCE(e.datos->>'staffId','') <> (v_yo->>'staffId') AND NOT v_ajeno
                         THEN 'La capturó alguien más'
                     WHEN COALESCE(e.datos->>'concepto','') <> 'entrada'
                         THEN 'Aquí solo se corrigen entradas'
                     ELSE NULL END
               ) AS x
          FROM entradas_log e
         WHERE e.negocio_id = p_neg
           AND COALESCE(e.datos->>'borrada', 'false') <> 'true'
           AND COALESCE(NULLIF(e.datos->>'sucursalId', ''), 'suc_principal')
               = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
           AND (v_desde IS NULL
                OR COALESCE(_entrada_instante(e.datos->>'registrado'), e.created_at) > _entrada_instante(v_desde))
      ) t;

    /* Conteos: lo que ya se contó en este periodo. Es el dato que evita el
       trabajo repetido — el más caro de todos en un inventario. */
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'creado' DESC), '[]'::jsonb)
      INTO v_cnts
      FROM (
        SELECT jsonb_build_object(
                 'id',     c.id,
                 'tipo',   'conteo',
                 'ver',    COALESCE((c.datos->>'ver')::int, 1),
                 'nombre', c.datos->>'nombre',
                 'cerradasBodega', c.datos->>'cerradasBodega',
                 'cerradasBarra',  c.datos->>'cerradasBarra',
                 -- v97: la app móvil mandaba sus conteos como cantidad +
                 -- unidad (hasta el 27-nov). Sin esto el historial los
                 -- enseñaba sin número y «Corregir» abría vacío.
                 'cantidad', c.datos->>'cantidad',
                 'unidad',   c.datos->>'unidad',
                 'area',     c.datos->>'area',
                 'meta',     c.datos->>'meta',
                 'insumoId', c.datos->>'insumoId',
                 'nota',   NULLIF(c.datos->>'nota', ''),
                 'fecha',  c.datos->>'fecha',
                 'hora',   c.datos->>'hora',
                 -- EL AUTOR DE UN CONTEO SE GUARDA EN `contadoPor`, no en
                 -- `registradoPor`: la columna «quién» venía vacía desde la
                 -- v76 porque se leía la llave equivocada. Se leen las dos,
                 -- que es lo que hace servir también a los datos viejos.
                 'quien',  COALESCE(NULLIF(c.datos->>'contadoPor',''), c.datos->>'registradoPor'),
                 'editadoPor', NULLIF(c.datos->>'editadoPor',''),
                 'aplicado',   COALESCE((c.datos->>'aplicado')::boolean, false),
                 'descartado', COALESCE((c.datos->>'descartado')::boolean, false),
                 'creado', c.created_at::text,
                 'puedeEditar',
                     (COALESCE(c.datos->>'staffId','') = (v_yo->>'staffId') OR v_ajeno)
                     AND COALESCE((c.datos->>'aplicado')::boolean, false) IS NOT TRUE
                     AND COALESCE((c.datos->>'descartado')::boolean, false) IS NOT TRUE,
                 'motivoBloqueo', CASE
                     WHEN COALESCE((c.datos->>'aplicado')::boolean, false)
                         THEN 'Ya se aplicó al inventario'
                     WHEN COALESCE((c.datos->>'descartado')::boolean, false)
                         THEN 'Se descartó en el inventario'
                     WHEN COALESCE(c.datos->>'staffId','') <> (v_yo->>'staffId') AND NOT v_ajeno
                         THEN 'Lo contó alguien más'
                     ELSE NULL END
               ) AS x
          FROM inventario_conteos c
         WHERE c.negocio_id = p_neg
           AND COALESCE(NULLIF(c.datos->>'sucursalId', ''), 'suc_principal')
               = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
           AND (p_area IS NULL OR p_area = '' OR c.datos->>'area' = p_area)
           AND (v_desde IS NULL OR c.created_at > _entrada_instante(v_desde))
      ) t;

    RETURN jsonb_build_object(
        'ok',          true,
        'desde',       v_desde,
        'inventario',  v_inv,
        'yo',          jsonb_build_object('staffId', v_yo->>'staffId',
                                          'nombre',  v_yo->>'nombre',
                                          'editaAjeno', v_ajeno),
        'movimientos', v_movs,
        'conteos',     v_cnts);
END;
$$;

REVOKE ALL ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT)                  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT)               TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ── Comprobación tras correrla ───────────────────────────────────────────────
-- SELECT pg_get_functiondef('entrada_historial(text,text,text,text,text)'::regprocedure) LIKE '%''cantidad'', c.datos%';
