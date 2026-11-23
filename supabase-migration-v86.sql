-- ═══════════════════════════════════════════════════════════════════════════
-- ETAAX · v86 · MIGRAR UNA SUCURSAL A OTRO NEGOCIO (solo admin de plataforma)
--
-- Una sucursal que se va con otro dueño (o a otro negocio de la misma cuenta)
-- se lleva TODO lo suyo: cortes, gastos, inventarios, entradas, horarios,
-- checklists, evaluaciones, clientes, proveedores y, si se pide, su staff.
--
-- POR QUÉ ES UNA FUNCIÓN Y NO VARIOS GUARDADOS DESDE EL NAVEGADOR
--   Son veinte tablas. Si el navegador las escribiera una por una y se cortara
--   el internet a la mitad, la sucursal quedaría partida entre dos negocios:
--   los cortes en uno, los inventarios en el otro. Aquí corre en UNA
--   transacción: o se muda completa, o no se mueve nada.
--
-- QUIÉN DECIDE QUÉ
--   El panel admin (admin-migrar-sucursal.js) arma el PLAN y lo enseña antes
--   de aplicarlo: qué se muda, qué se copia, qué se queda. Esta función lo
--   aplica con reglas simples y fijas:
--     · docs      → documentos de un renglón por negocio (sucursales, ajustes
--                   de inventario, parámetros de nómina), ya calculados, con
--                   candado de versión: si cambiaron mientras se revisaba, aborta.
--     · insumos / recetas → se COPIAN al destino (el catálogo puede ser
--                   compartido con otras sucursales del origen). Las recetas
--                   llevan id nuevo (su llave es global); los insumos, el mismo
--                   (su llave es negocio + insumo).
--     · quitar    → en el origen, a esos insumos y recetas solo se les quita
--                   la sucursal. Nada del catálogo se borra.
--     · tablas    → se MUDAN por regla: los registros con sucursalId = la
--                   sucursal. Los horarios cambian de id (lo llevan adentro).
--     · hijos     → siguen a su padre (respuestas de evaluación, recibos de
--                   nómina del staff que se fue).
--     · filas     → el menú público (su id es negocio|sucursal).
--     · remap     → ids que cambian (recetas, sucursal, rutas de fotos): se
--                   reemplazan como CADENA EXACTA dentro de lo que se muda.
--
-- La Matriz no se migra con esto: sus registros viejos no traen sello de
-- sucursal y no hay forma segura de separarlos del resto del negocio.
--
-- Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════════════════

-- Bitácora: cada migración queda escrita, con su plan y lo que movió.
CREATE TABLE IF NOT EXISTS admin_migraciones (
    id         TEXT PRIMARY KEY,
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE admin_migraciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all" ON admin_migraciones;
CREATE POLICY "admin_all" ON admin_migraciones FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Reemplaza ids como CADENA EXACTA (con sus comillas): en llaves y en valores.
-- "M" no toca "xMy" ni un texto que mencione M entre otras palabras.
CREATE OR REPLACE FUNCTION _mig_remap(p_d JSONB, p_remap JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_t TEXT; v_k TEXT; v_v TEXT;
BEGIN
    IF p_d IS NULL OR p_remap IS NULL OR p_remap = '{}'::jsonb THEN RETURN p_d; END IF;
    v_t := p_d::text;
    FOR v_k, v_v IN SELECT key, value FROM jsonb_each_text(p_remap) LOOP
        v_t := replace(v_t, to_jsonb(v_k)::text, to_jsonb(v_v)::text);
    END LOOP;
    RETURN v_t::jsonb;
END $$;

-- Un registro que se muda: ids nuevos, su sucursal y su negocio.
CREATE OR REPLACE FUNCTION _mig_xform(p_d JSONB, p_suc TEXT, p_neg TEXT, p_remap JSONB, p_id TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    p_d := _mig_remap(p_d, p_remap) || jsonb_build_object('sucursalId', p_suc);
    IF p_d ? 'negocioId' THEN p_d := p_d || jsonb_build_object('negocioId', p_neg); END IF;
    IF p_id IS NOT NULL AND p_d ? 'id' THEN p_d := p_d || jsonb_build_object('id', p_id); END IF;
    RETURN p_d;
END $$;

-- En qué sucursales vive un insumo o receta (la misma regla de insumo-label.js).
CREATE OR REPLACE FUNCTION _mig_memb(p_d JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN jsonb_typeof(p_d->'sucursales') = 'array' AND jsonb_array_length(p_d->'sucursales') > 0 THEN p_d->'sucursales'
        WHEN coalesce(p_d->>'sucursalId', '') <> '' THEN jsonb_build_array(p_d->>'sucursalId')
        ELSE '[]'::jsonb END
$$;

-- Quitarle una sucursal. Una receta que se queda sin ninguna pasa al catálogo
-- (_global): sin ese sello, la regla vieja la pondría en la Matriz.
CREATE OR REPLACE FUNCTION _mig_quitar_suc(p_d JSONB, p_suc TEXT, p_receta BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_m JSONB;
BEGIN
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_m
      FROM jsonb_array_elements_text(_mig_memb(p_d)) AS x WHERE x <> p_suc;
    p_d := p_d || jsonb_build_object('sucursales', v_m);
    IF p_d->>'sucursalId' = p_suc THEN
        IF jsonb_array_length(v_m) > 0 THEN p_d := p_d || jsonb_build_object('sucursalId', v_m->>0);
        ELSE p_d := p_d - 'sucursalId'; END IF;
    END IF;
    IF p_receta AND jsonb_array_length(v_m) = 0 THEN p_d := p_d || '{"_global": true}'::jsonb; END IF;
    RETURN p_d;
END $$;

-- Sumarle sucursales a un insumo que el destino ya tenía (su ficha se queda).
CREATE OR REPLACE FUNCTION _mig_sumar_suc(p_d JSONB, p_sucs JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_m JSONB;
BEGIN
    IF p_sucs IS NULL OR jsonb_array_length(p_sucs) = 0 THEN RETURN p_d; END IF;
    SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) INTO v_m FROM (
        SELECT jsonb_array_elements_text(_mig_memb(p_d)) AS x
        UNION SELECT jsonb_array_elements_text(p_sucs)) s;
    RETURN p_d || jsonb_build_object('sucursales', v_m);
END $$;

-- La copia de un insumo o receta para el destino: sin lazos con el origen.
CREATE OR REPLACE FUNCTION _mig_catalogo(p_d JSONB, p_id TEXT, p_sucs JSONB, p_remap JSONB, p_global BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    p_d := (_mig_remap(p_d, p_remap) - 'origenId' - '_global' - 'inactivoEn' - 'inactivaEn')
           || jsonb_build_object('id', p_id, 'sucursales', coalesce(p_sucs, '[]'::jsonb));
    IF jsonb_array_length(coalesce(p_sucs, '[]'::jsonb)) > 0 THEN p_d := p_d || jsonb_build_object('sucursalId', p_sucs->>0);
    ELSE p_d := p_d - 'sucursalId'; END IF;
    IF p_global THEN p_d := p_d || '{"_global": true}'::jsonb; END IF;
    RETURN p_d;
END $$;

CREATE OR REPLACE FUNCTION admin_migrar_sucursal(p_plan JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_orig  TEXT  := p_plan->>'origen';
    v_dest  TEXT  := p_plan->>'destino';
    v_suc   TEXT  := p_plan->>'sucursal';
    v_sucn  TEXT  := coalesce(nullif(p_plan->>'sucursalNueva', ''), p_plan->>'sucursal');
    v_remap JSONB := coalesce(p_plan->'remap', '{}'::jsonb);
    v_op JSONB; v_t TEXT; v_d JSONB; v_ts TIMESTAMPTZ; v_n INT; v_k INT; v_id TEXT;
    v_cuenta JSONB := '{}'::jsonb;
    v_tablas TEXT[] := ARRAY['cortes','depositos','ventas_extra','gastos','gf_fijos','sf_otros','previsiones',
        'clientes','proveedores','inventarios','entradas_log','inventario_conteos','checklists',
        'checklist_runs','checklist_ejecuciones','evaluaciones','horarios','staff'];
    v_hijos TEXT[] := ARRAY['evaluacion_respuestas','nomina_recibos'];
    v_docs  TEXT[] := ARRAY['negocio_sucursales','inv_ajustes','gf_nomina_params'];
BEGIN
    IF NOT is_platform_admin() THEN
        RAISE EXCEPTION 'Solo el admin de la plataforma puede migrar sucursales.';
    END IF;
    IF v_orig IS NULL OR v_dest IS NULL OR v_suc IS NULL OR v_orig = v_dest THEN
        RAISE EXCEPTION 'Plan incompleto: hacen falta origen, destino (distinto) y sucursal.';
    END IF;
    IF v_suc = 'suc_principal' THEN
        RAISE EXCEPTION 'La Matriz no se migra como sucursal.';
    END IF;
    -- Nadie más escribe en estos dos negocios mientras tanto.
    PERFORM 1 FROM negocios WHERE id = v_orig FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe el negocio de origen %', v_orig; END IF;
    PERFORM 1 FROM negocios WHERE id = v_dest FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe el negocio de destino %', v_dest; END IF;

    -- 1) Documentos de un renglón, con candado de versión.
    FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'docs', '[]'::jsonb)) LOOP
        v_t := v_op->>'tabla';
        IF NOT (v_t = ANY(v_docs)) THEN RAISE EXCEPTION 'Documento no permitido: %', v_t; END IF;
        IF (v_op->>'negocio_id') IS DISTINCT FROM v_orig AND (v_op->>'negocio_id') IS DISTINCT FROM v_dest THEN
            RAISE EXCEPTION 'El documento % no es de ninguno de los dos negocios', v_t;
        END IF;
        EXECUTE format('SELECT updated_at FROM %I WHERE negocio_id = $1', v_t) INTO v_ts USING v_op->>'negocio_id';
        IF v_op ? 'si_updated_at' AND v_ts IS DISTINCT FROM (v_op->>'si_updated_at')::timestamptz THEN
            RAISE EXCEPTION 'El documento % cambió mientras revisabas la migración. Vuelve a revisarla.', v_t;
        END IF;
        EXECUTE format('INSERT INTO %I (negocio_id, datos, updated_at) VALUES ($1, $2, now())
                        ON CONFLICT (negocio_id) DO UPDATE SET datos = EXCLUDED.datos, updated_at = now()', v_t)
            USING v_op->>'negocio_id', v_op->'datos';
    END LOOP;

    -- 2) El catálogo se COPIA al destino.
    v_n := 0;
    FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'insumos', '[]'::jsonb)) LOOP
        SELECT datos INTO v_d FROM negocio_insumos WHERE negocio_id = v_orig AND insumo_id = v_op->>'desde';
        IF v_d IS NULL THEN RAISE EXCEPTION 'No se encontró el insumo % en el negocio de origen', v_op->>'desde'; END IF;
        INSERT INTO negocio_insumos (negocio_id, insumo_id, datos)
        VALUES (v_dest, v_op->>'id', _mig_catalogo(v_d, v_op->>'id', v_op->'sucursales', v_remap, false))
        ON CONFLICT (negocio_id, insumo_id) DO UPDATE
            SET datos = _mig_sumar_suc(negocio_insumos.datos, EXCLUDED.datos->'sucursales');
        v_n := v_n + 1;
    END LOOP;
    v_cuenta := v_cuenta || jsonb_build_object('insumos_copiados', v_n);

    v_n := 0;
    FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'recetas', '[]'::jsonb)) LOOP
        SELECT datos INTO v_d FROM recetas WHERE negocio_id = v_orig AND id = v_op->>'desde';
        IF v_d IS NULL THEN RAISE EXCEPTION 'No se encontró la receta % en el negocio de origen', v_op->>'desde'; END IF;
        INSERT INTO recetas (id, negocio_id, datos)
        VALUES (v_op->>'id', v_dest, _mig_catalogo(v_d, v_op->>'id', v_op->'sucursales', v_remap, coalesce((v_op->>'global')::boolean, false)))
        ON CONFLICT (id) DO UPDATE SET datos = EXCLUDED.datos WHERE recetas.negocio_id = EXCLUDED.negocio_id;
        GET DIAGNOSTICS v_k = ROW_COUNT;
        IF v_k <> 1 THEN RAISE EXCEPTION 'La receta % ya existe en otro negocio', v_op->>'id'; END IF;
        v_n := v_n + 1;
    END LOOP;
    v_cuenta := v_cuenta || jsonb_build_object('recetas_copiadas', v_n);

    -- 3) En el origen, al catálogo solo se le quita la sucursal (nada se borra).
    UPDATE negocio_insumos SET datos = _mig_quitar_suc(datos, v_suc, false)
     WHERE negocio_id = v_orig AND insumo_id IN (SELECT jsonb_array_elements_text(coalesce(p_plan->'quitarInsumos', '[]'::jsonb)));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cuenta := v_cuenta || jsonb_build_object('insumos_desvinculados', v_n);
    UPDATE recetas SET datos = _mig_quitar_suc(datos, v_suc, true)
     WHERE negocio_id = v_orig AND id IN (SELECT jsonb_array_elements_text(coalesce(p_plan->'quitarRecetas', '[]'::jsonb)));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_cuenta := v_cuenta || jsonb_build_object('recetas_desvinculadas', v_n);

    -- 4) Los registros de la sucursal se MUDAN, tabla por tabla.
    FOR v_t IN SELECT jsonb_array_elements_text(coalesce(p_plan->'tablas', '[]'::jsonb)) LOOP
        IF NOT (v_t = ANY(v_tablas)) THEN RAISE EXCEPTION 'Tabla no permitida: %', v_t; END IF;
        IF v_t = 'horarios' THEN
            -- El id del horario lleva el negocio y la sucursal (EtaaxCore.horarioId).
            UPDATE horarios SET negocio_id = v_dest,
                   id    = 'hor_' || length(v_dest) || '_' || v_dest || '_' || v_sucn || '_' || coalesce(datos->>'semana', id),
                   datos = _mig_xform(datos, v_sucn, v_dest, v_remap,
                           'hor_' || length(v_dest) || '_' || v_dest || '_' || v_sucn || '_' || coalesce(datos->>'semana', id))
             WHERE negocio_id = v_orig AND datos->>'sucursalId' = v_suc;
        ELSE
            EXECUTE format('UPDATE %I SET negocio_id = $1, datos = _mig_xform(datos, $2, $1, $3, NULL)
                             WHERE negocio_id = $4 AND datos->>''sucursalId'' = $5', v_t)
                USING v_dest, v_sucn, v_remap, v_orig, v_suc;
        END IF;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_cuenta := v_cuenta || jsonb_build_object(v_t, v_n);
    END LOOP;

    -- 5) Los hijos siguen a su padre (que ya está en el destino).
    FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'hijos', '[]'::jsonb)) LOOP
        v_t := v_op->>'tabla';
        IF NOT (v_t = ANY(v_hijos)) OR NOT ((v_op->>'padre') = ANY(v_tablas)) THEN
            RAISE EXCEPTION 'Relación no permitida: %', v_t;
        END IF;
        EXECUTE format('UPDATE %I h SET negocio_id = $1, datos = _mig_xform(h.datos, $2, $1, $3, NULL)
                         WHERE h.negocio_id = $4 AND h.datos->>%L IN
                               (SELECT p.id FROM %I p WHERE p.negocio_id = $1 AND p.datos->>''sucursalId'' = $2)',
                       v_t, v_op->>'campo', v_op->>'padre')
            USING v_dest, v_sucn, v_remap, v_orig;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_cuenta := v_cuenta || jsonb_build_object(v_t, v_n);
    END LOOP;

    -- 6) Filas con el negocio en el id (el menú público).
    FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(p_plan->'filas', '[]'::jsonb)) LOOP
        IF (v_op->>'tabla') IS DISTINCT FROM 'menu_publico' THEN RAISE EXCEPTION 'Fila no permitida: %', v_op->>'tabla'; END IF;
        DELETE FROM menu_publico WHERE id = v_op->>'nuevo_id' AND negocio_id = v_dest;
        UPDATE menu_publico SET id = v_op->>'nuevo_id', negocio_id = v_dest,
               datos = _mig_xform(datos, v_sucn, v_dest, v_remap, v_op->>'nuevo_id')
         WHERE id = v_op->>'id' AND negocio_id = v_orig;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_cuenta := v_cuenta || jsonb_build_object('menu_publico', v_n);
    END LOOP;

    -- 7) Bitácora.
    v_id := 'mig_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 6);
    INSERT INTO admin_migraciones (id, datos) VALUES (v_id, jsonb_build_object(
        'origen', v_orig, 'destino', v_dest, 'sucursal', v_suc, 'sucursalNueva', v_sucn,
        'nombre', p_plan->>'sucursalNombre', 'cuenta', v_cuenta, 'resumen', p_plan->'resumen',
        'por', auth.uid(), 'en', now()));
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'cuenta', v_cuenta);
END $$;

-- Sin sesión, nadie (anon se nombra a propósito: si no, los privilegios por defecto la dejarían abierta).
REVOKE ALL ON FUNCTION admin_migrar_sucursal(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_migrar_sucursal(JSONB) TO authenticated;
