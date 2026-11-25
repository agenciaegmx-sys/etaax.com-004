-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v94 — Notas / facturas de entradas desde la app móvil
--
-- (Edwin, 25-nov) Las entradas de la app se igualan a las del sistema: una
-- vista de catálogo y otra de «Entradas registradas», la NOTA / FACTURA (varios
-- productos de la misma compra con un proveedor, un folio y las mismas fotos)
-- y «Agrupar en nota» lo que ya se registró suelto.
--
-- Una nota NUEVA no necesita servidor: entrada_registrar (v82) guarda los datos
-- tal cual, y cada entrada viaja con su notaId / notaFolio / notaProveedor —
-- los mismos campos que escribe el sistema, en la misma tabla (entradas_log).
-- Lo que sí necesita servidor es tocar lo YA registrado:
--
--   entrada_historial          (origen: v84) además manda producto, tipo de
--                              entrada, área, la nota y cuántas fotos trae.
--   entrada_nota_agrupar       junta entradas ya registradas en una nota. Si
--                              alguna ya era de una nota, las demás se suman a
--                              ESA (y la nota toma el proveedor y folio nuevos),
--                              como en el sistema.
--   entrada_nota_desagrupar    deshace una nota: sus entradas se quedan, sin
--                              nota (notaId '' a propósito, como el sistema,
--                              para que las copias del inventario la suelten).
--
-- Los MISMOS candados que entrada_editar (v84), renglón por renglón: el guardia
-- de la clave, el token del QR, la persona; solo entradas (no mermas ni
-- cortesías), no borradas, de SU sucursal y SUYAS —o de cualquiera si es
-- encargado (_entrada_edita_ajeno)— y de un periodo que no se ha cerrado. Si
-- un solo renglón no pasa, no se toca ninguno.
--
-- Correr a mano en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. El historial, con la nota de cada entrada (base: v84) ────────────────
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

-- ── 2. ¿Se puede tocar la nota de esta entrada? (NULL = sí; si no, el motivo)
CREATE OR REPLACE FUNCTION _entrada_nota_motivo(p_neg TEXT, p_yo JSONB, p_d JSONB, p_creado TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE
        WHEN p_d IS NULL THEN 'no-existe'
        WHEN COALESCE(p_d->>'borrada','false') = 'true' THEN 'borrada'
        WHEN COALESCE(p_d->>'concepto','') <> 'entrada' THEN 'tipo'
        WHEN COALESCE(NULLIF(p_d->>'sucursalId',''), 'suc_principal') <> (p_yo->>'sucursal')
             AND NOT _entrada_edita_ajeno(p_yo->>'rol') THEN 'ajeno'
        WHEN COALESCE(p_d->>'staffId','') <> (p_yo->>'staffId')
             AND NOT _entrada_edita_ajeno(p_yo->>'rol') THEN 'autor'
        WHEN _entrada_periodo_cerrado(p_neg, COALESCE(NULLIF(p_d->>'sucursalId',''), 'suc_principal'),
                 COALESCE(p_d->>'area',''), COALESCE(NULLIF(p_d->>'registrado',''), p_creado, '')) THEN 'cerrado'
        ELSE NULL END;
$$;

-- ── 3. Agrupar en nota ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION entrada_nota_agrupar(
    p_neg TEXT, p_token TEXT, p_niphash TEXT, p_ids TEXT[], p_proveedor TEXT, p_folio TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_yo JSONB; v_id TEXT; v_d JSONB; v_creado TEXT; v_mot TEXT; v_nota TEXT;
        v_prov TEXT; v_folio TEXT; v_ids TEXT[] := '{}'; v_n INT := 0;
BEGIN
    -- El guardia primero y sin excepción (v79): su apunte tiene que quedarse.
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN jsonb_build_object('ok', false, 'motivo', 'nip'); END IF;
    IF NOT _entrada_token_ok(p_neg, p_token) THEN RETURN jsonb_build_object('ok', false, 'motivo', 'token'); END IF;
    v_yo := _entrada_quien(p_neg, p_niphash);
    IF v_yo IS NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'nip'); END IF;
    IF p_ids IS NULL OR cardinality(p_ids) < 1 OR cardinality(p_ids) > 60 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'datos');
    END IF;
    v_prov  := left(btrim(COALESCE(p_proveedor, '')), 120);
    v_folio := left(btrim(COALESCE(p_folio, '')), 60);

    -- Cada renglón, BLOQUEADO y revisado; uno que no pase detiene todo.
    FOREACH v_id IN ARRAY p_ids LOOP
        v_d := NULL; v_creado := NULL;
        SELECT datos, created_at::text INTO v_d, v_creado FROM entradas_log
         WHERE id = v_id AND negocio_id = p_neg FOR UPDATE;
        v_mot := _entrada_nota_motivo(p_neg, v_yo, v_d, v_creado);
        IF v_mot IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', v_mot, 'id', v_id); END IF;
        IF v_nota IS NULL AND COALESCE(v_d->>'notaId','') <> '' THEN v_nota := v_d->>'notaId'; END IF;
        v_ids := array_append(v_ids, v_id);
    END LOOP;
    v_nota := COALESCE(v_nota, replace(gen_random_uuid()::text, '-', ''));

    -- La nota entera toma los datos nuevos: también las suyas que no se
    -- marcaron, si quien agrupa las puede tocar.
    FOR v_id, v_d, v_creado IN
        SELECT id, datos, created_at::text FROM entradas_log
         WHERE negocio_id = p_neg AND datos->>'notaId' = v_nota AND NOT (id = ANY (v_ids))
         FOR UPDATE
    LOOP
        IF _entrada_nota_motivo(p_neg, v_yo, v_d, v_creado) IS NULL THEN v_ids := array_append(v_ids, v_id); END IF;
    END LOOP;

    UPDATE entradas_log
       SET datos = datos || jsonb_build_object(
               'notaId', v_nota, 'notaFolio', v_folio, 'notaProveedor', v_prov,
               'ver', COALESCE((datos->>'ver')::int, 1) + 1,
               'editadoPor', v_yo->>'nombre',
               'editadoEn', to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
     WHERE negocio_id = p_neg AND id = ANY (v_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'notaId', v_nota, 'n', v_n);
END;
$$;

-- ── 4. Desagrupar ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION entrada_nota_desagrupar(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_nota TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_yo JSONB; v_id TEXT; v_d JSONB; v_creado TEXT; v_mot TEXT; v_n INT := 0;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN jsonb_build_object('ok', false, 'motivo', 'nip'); END IF;
    IF NOT _entrada_token_ok(p_neg, p_token) THEN RETURN jsonb_build_object('ok', false, 'motivo', 'token'); END IF;
    v_yo := _entrada_quien(p_neg, p_niphash);
    IF v_yo IS NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', 'nip'); END IF;
    IF COALESCE(p_nota, '') = '' THEN RETURN jsonb_build_object('ok', false, 'motivo', 'datos'); END IF;
    FOR v_id, v_d, v_creado IN
        SELECT id, datos, created_at::text FROM entradas_log
         WHERE negocio_id = p_neg AND datos->>'notaId' = p_nota FOR UPDATE
    LOOP
        v_mot := _entrada_nota_motivo(p_neg, v_yo, v_d, v_creado);
        IF v_mot IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'motivo', v_mot, 'id', v_id); END IF;
        v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'no-existe'); END IF;
    UPDATE entradas_log
       SET datos = (datos - 'notaFolio' - 'notaProveedor') || jsonb_build_object(
               'notaId', '',
               'ver', COALESCE((datos->>'ver')::int, 1) + 1,
               'editadoPor', v_yo->>'nombre',
               'editadoEn', to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
     WHERE negocio_id = p_neg AND datos->>'notaId' = p_nota;
    RETURN jsonb_build_object('ok', true, 'n', v_n);
END;
$$;

REVOKE ALL ON FUNCTION _entrada_nota_motivo(TEXT, JSONB, JSONB, TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT)                  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT)               TO anon, authenticated;
REVOKE ALL ON FUNCTION entrada_nota_agrupar(TEXT,TEXT,TEXT,TEXT[],TEXT,TEXT)        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_nota_agrupar(TEXT,TEXT,TEXT,TEXT[],TEXT,TEXT)     TO anon, authenticated;
REVOKE ALL ON FUNCTION entrada_nota_desagrupar(TEXT,TEXT,TEXT,TEXT)                 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_nota_desagrupar(TEXT,TEXT,TEXT,TEXT)              TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Comprobación (sale en Results): las consultas nuevas, abiertas a la app, y
-- sin token ni clave no hacen nada.
SELECT 'entrada_nota_agrupar sin llaves' AS prueba,
       CASE WHEN (entrada_nota_agrupar('__neg_v94__','t','h',ARRAY['x'],'p','f')->>'ok') = 'false' THEN 'PASA' ELSE 'FALLA' END AS r
UNION ALL
SELECT 'entrada_nota_desagrupar sin llaves',
       CASE WHEN (entrada_nota_desagrupar('__neg_v94__','t','h','x')->>'ok') = 'false' THEN 'PASA' ELSE 'FALLA' END;
