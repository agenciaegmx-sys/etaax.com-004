-- ═══════════════════════════════════════════════════════════════════════════
-- ETAAX · v87 · ELIMINAR UNA SUCURSAL (SE ARCHIVA) Y RESTAURARLA
--               (solo admin de plataforma)
--
-- El flujo para pasar una sucursal a otro negocio es: COPIARLA (el panel admin
-- la copia y el original no se toca), REVISAR que todo llegó, y ELIMINARLA del
-- original. Eliminar aquí NO borra: guarda en un archivo cada registro tal
-- cual estaba (el renglón completo, con su id y sus fechas) y lo saca de las
-- tablas vivas. RESTAURAR lo regresa idéntico.
--
-- Sirve para cualquier negocio: el original después de revisar la copia, o el
-- destino si la copia salió mal.
--
-- QUÉ SE ARCHIVA DE LA SUCURSAL
--   · Los registros con datos.sucursalId = la sucursal (cortes, gastos,
--     inventarios, entradas, horarios, checklists, evaluaciones…) y sus hijos
--     (respuestas de evaluación).
--   · Su carta pública (menu_publico, id negocio|sucursal).
--   · Su staff y sus recibos de nómina, salvo que se pida pasarlo a otro
--     negocio (el destino de la copia): el usuario de un colaborador es único
--     en ETAAX, así que no puede vivir en los dos.
--   · Su ficha y configuración, sus compuestos/bateo de inventario y sus
--     parámetros de nómina: salen de los documentos y se guardan.
--   · El catálogo NO se archiva (puede ser compartido): a sus insumos y recetas
--     solo se les quita la sucursal, y se anota cuáles para devolvérsela.
--
-- La Matriz no se elimina con esto.
--
-- Usa los ayudantes de la v86 (_mig_memb, _mig_quitar_suc, _mig_sumar_suc):
-- correr la v86 antes. Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_sucursales_archivo (
    id            TEXT PRIMARY KEY,
    negocio_id    TEXT NOT NULL,
    sucursal_id   TEXT NOT NULL,
    datos         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ DEFAULT now(),
    restaurada_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS admin_archivo_filas (
    archivo_id TEXT NOT NULL REFERENCES admin_sucursales_archivo(id) ON DELETE CASCADE,
    tabla      TEXT NOT NULL,
    fila_id    TEXT NOT NULL,
    fila       JSONB NOT NULL,          -- el renglón completo (to_jsonb), para regresarlo idéntico
    PRIMARY KEY (archivo_id, tabla, fila_id)
);
ALTER TABLE admin_sucursales_archivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_archivo_filas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all" ON admin_sucursales_archivo;
CREATE POLICY "admin_all" ON admin_sucursales_archivo FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
DROP POLICY IF EXISTS "admin_all" ON admin_archivo_filas;
CREATE POLICY "admin_all" ON admin_archivo_filas FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Sumar sucursales SIN reordenar las que ya tenía (redefine el de la v86): al
-- restaurar, el insumo tiene que quedar idéntico, no solo «equivalente».
CREATE OR REPLACE FUNCTION _mig_sumar_suc(p_d JSONB, p_sucs JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_m JSONB;
BEGIN
    IF p_sucs IS NULL OR jsonb_array_length(p_sucs) = 0 THEN RETURN p_d; END IF;
    SELECT coalesce(jsonb_agg(x ORDER BY o), '[]'::jsonb) INTO v_m FROM (
        SELECT x, min(o) AS o FROM (
            SELECT x, o FROM jsonb_array_elements_text(_mig_memb(p_d)) WITH ORDINALITY AS a(x, o)
            UNION ALL
            SELECT x, 1000000 + o FROM jsonb_array_elements_text(p_sucs) WITH ORDINALITY AS b(x, o)) u
        GROUP BY x) s;
    RETURN p_d || jsonb_build_object('sucursales', v_m);
END $$;

-- Las tablas de registros por sucursal (la misma lista que la v86, sin staff).
CREATE OR REPLACE FUNCTION _arc_tablas() RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
    SELECT ARRAY['cortes','depositos','ventas_extra','gastos','gf_fijos','sf_otros','previsiones',
        'clientes','proveedores','inventarios','entradas_log','inventario_conteos','checklists',
        'checklist_runs','checklist_ejecuciones','evaluaciones','horarios']
$$;

-- Mueve al archivo los renglones de una tabla que cumplan un filtro.
CREATE OR REPLACE FUNCTION _arc_guardar(p_arc TEXT, p_tabla TEXT, p_filtro TEXT, p_a TEXT, p_b TEXT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_n INT;
BEGIN
    EXECUTE format('INSERT INTO admin_archivo_filas (archivo_id, tabla, fila_id, fila)
                    SELECT $1, %L, t.id, to_jsonb(t) FROM %I t WHERE %s', p_tabla, p_tabla, p_filtro)
        USING p_arc, p_a, p_b;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXECUTE format('DELETE FROM %I t WHERE %s', p_tabla, p_filtro) USING p_arc, p_a, p_b;
    RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION admin_archivar_sucursal(p_neg TEXT, p_suc TEXT, p_staff_a TEXT DEFAULT NULL, p_staff_suc TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id TEXT; v_doc JSONB; v_ficha JSONB; v_t TEXT; v_n INT; v_cuenta JSONB := '{}'::jsonb;
    v_ins JSONB; v_rec JSONB; v_glob JSONB; v_staff JSONB := '[]'::jsonb; v_aj JSONB; v_np JSONB;
    v_ajp JSONB; v_npp JSONB;
BEGIN
    IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Solo el admin de la plataforma puede eliminar sucursales.'; END IF;
    IF p_neg IS NULL OR p_suc IS NULL THEN RAISE EXCEPTION 'Faltan el negocio y la sucursal.'; END IF;
    IF p_suc = 'suc_principal' THEN RAISE EXCEPTION 'La Matriz no se elimina.'; END IF;
    PERFORM 1 FROM negocios WHERE id = p_neg FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe el negocio %', p_neg; END IF;
    SELECT datos INTO v_doc FROM negocio_sucursales WHERE negocio_id = p_neg FOR UPDATE;
    SELECT s INTO v_ficha FROM jsonb_array_elements(coalesce(v_doc->'sucursales', '[]'::jsonb)) s WHERE s->>'id' = p_suc;
    IF v_ficha IS NULL THEN RAISE EXCEPTION 'Esa sucursal no está en el negocio.'; END IF;
    IF p_staff_a IS NOT NULL THEN
        IF p_staff_a = p_neg THEN RAISE EXCEPTION 'El staff tiene que pasar a OTRO negocio.'; END IF;
        PERFORM 1 FROM negocios WHERE id = p_staff_a FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'No existe el negocio % para el staff', p_staff_a; END IF;
        IF p_staff_suc IS NULL OR NOT EXISTS (SELECT 1 FROM negocio_sucursales ns, jsonb_array_elements(coalesce(ns.datos->'sucursales', '[]'::jsonb)) s
                                              WHERE ns.negocio_id = p_staff_a AND s->>'id' = p_staff_suc) THEN
            RAISE EXCEPTION 'La sucursal % no existe en el negocio al que pasaría el staff.', coalesce(p_staff_suc, '—');
        END IF;
    END IF;

    v_id := 'arc_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '_' || substr(md5(random()::text), 1, 6);
    INSERT INTO admin_sucursales_archivo (id, negocio_id, sucursal_id, datos) VALUES (v_id, p_neg, p_suc, '{}'::jsonb);

    -- 1) Los registros de la sucursal, al archivo.
    FOREACH v_t IN ARRAY _arc_tablas() LOOP
        v_n := _arc_guardar(v_id, v_t, 't.negocio_id = $2 AND t.datos->>''sucursalId'' = $3', p_neg, p_suc);
        IF v_n > 0 THEN v_cuenta := v_cuenta || jsonb_build_object(v_t, v_n); END IF;
    END LOOP;
    v_n := _arc_guardar(v_id, 'evaluacion_respuestas', 't.negocio_id = $2 AND t.datos->>''evaluacionId'' IN
            (SELECT fila_id FROM admin_archivo_filas WHERE archivo_id = $1 AND tabla = ''evaluaciones'')', p_neg, NULL);
    IF v_n > 0 THEN v_cuenta := v_cuenta || jsonb_build_object('evaluacion_respuestas', v_n); END IF;
    v_n := _arc_guardar(v_id, 'menu_publico', 't.negocio_id = $2 AND t.id = $3', p_neg, p_neg || '|' || p_suc);
    IF v_n > 0 THEN v_cuenta := v_cuenta || jsonb_build_object('menu_publico', v_n); END IF;

    -- 2) El staff: al archivo con la sucursal, o al otro negocio (con sus recibos).
    IF p_staff_a IS NULL THEN
        v_n := _arc_guardar(v_id, 'staff', 't.negocio_id = $2 AND t.datos->>''sucursalId'' = $3', p_neg, p_suc);
        IF v_n > 0 THEN v_cuenta := v_cuenta || jsonb_build_object('staff', v_n); END IF;
        v_n := _arc_guardar(v_id, 'nomina_recibos', 't.negocio_id = $2 AND t.datos->>''staffId'' IN
                (SELECT fila_id FROM admin_archivo_filas WHERE archivo_id = $1 AND tabla = ''staff'')', p_neg, NULL);
        IF v_n > 0 THEN v_cuenta := v_cuenta || jsonb_build_object('nomina_recibos', v_n); END IF;
    ELSE
        SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO v_staff FROM staff WHERE negocio_id = p_neg AND datos->>'sucursalId' = p_suc;
        UPDATE nomina_recibos SET negocio_id = p_staff_a
         WHERE negocio_id = p_neg AND datos->>'staffId' IN (SELECT jsonb_array_elements_text(v_staff));
        UPDATE staff SET negocio_id = p_staff_a, datos = datos || jsonb_build_object('sucursalId', p_staff_suc)
         WHERE negocio_id = p_neg AND datos->>'sucursalId' = p_suc;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN v_cuenta := v_cuenta || jsonb_build_object('staff_pasado', v_n); END IF;
    END IF;

    -- 3) El catálogo: solo pierde la sucursal (se anota cuáles, para devolvérsela).
    SELECT coalesce(jsonb_agg(insumo_id), '[]'::jsonb) INTO v_ins FROM negocio_insumos
     WHERE negocio_id = p_neg AND _mig_memb(datos) ? p_suc;
    UPDATE negocio_insumos SET datos = _mig_quitar_suc(datos, p_suc, false) WHERE negocio_id = p_neg AND _mig_memb(datos) ? p_suc;
    SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO v_rec FROM recetas WHERE negocio_id = p_neg AND _mig_memb(datos) ? p_suc;
    SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO v_glob FROM recetas
     WHERE negocio_id = p_neg AND _mig_memb(datos) ? p_suc AND jsonb_array_length(_mig_memb(datos)) = 1
       AND NOT coalesce((datos->>'_global')::boolean, false);
    UPDATE recetas SET datos = _mig_quitar_suc(datos, p_suc, true) WHERE negocio_id = p_neg AND _mig_memb(datos) ? p_suc;

    -- 4) Los documentos: la sucursal sale (y se guarda lo suyo).
    UPDATE negocio_sucursales
       SET datos = jsonb_set(datos, '{sucursales}', (SELECT coalesce(jsonb_agg(s), '[]'::jsonb)
                       FROM jsonb_array_elements(datos->'sucursales') s WHERE s->>'id' <> p_suc)) #- ARRAY['cfg', p_suc],
           updated_at = now()
     WHERE negocio_id = p_neg;
    SELECT datos INTO v_aj FROM inv_ajustes WHERE negocio_id = p_neg FOR UPDATE;
    v_ajp := jsonb_build_object('compuestos', v_aj->'compuestos'->p_suc, 'bateo', v_aj->'bateo'->p_suc);
    IF v_aj IS NOT NULL THEN
        UPDATE inv_ajustes SET datos = datos #- ARRAY['compuestos', p_suc] #- ARRAY['bateo', p_suc], updated_at = now() WHERE negocio_id = p_neg;
    END IF;
    SELECT datos INTO v_np FROM gf_nomina_params WHERE negocio_id = p_neg FOR UPDATE;
    v_npp := v_np->'porSucursal'->p_suc;
    IF v_np IS NOT NULL AND v_npp IS NOT NULL THEN
        UPDATE gf_nomina_params SET datos = datos #- ARRAY['porSucursal', p_suc], updated_at = now() WHERE negocio_id = p_neg;
    END IF;

    UPDATE admin_sucursales_archivo SET datos = jsonb_build_object(
        'nombre', v_ficha->>'nombre', 'ficha', v_ficha, 'cfg', v_doc->'cfg'->p_suc,
        'invAjustes', v_ajp, 'nominaParams', v_npp,
        'insumos', v_ins, 'recetas', v_rec, 'recetasGlobal', v_glob,
        'staffA', p_staff_a, 'staffSuc', p_staff_suc, 'staff', v_staff,
        'cuenta', v_cuenta, 'por', auth.uid(), 'en', now())
     WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'cuenta', v_cuenta);
END $$;

CREATE OR REPLACE FUNCTION admin_restaurar_sucursal(p_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_a admin_sucursales_archivo%ROWTYPE; v_neg TEXT; v_suc TEXT; v_doc JSONB; v_t TEXT; v_n INT;
    v_cuenta JSONB := '{}'::jsonb; v_staffA TEXT; v_permitidas TEXT[];
BEGIN
    IF NOT is_platform_admin() THEN RAISE EXCEPTION 'Solo el admin de la plataforma puede restaurar sucursales.'; END IF;
    SELECT * INTO v_a FROM admin_sucursales_archivo WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe el archivo %', p_id; END IF;
    IF v_a.restaurada_at IS NOT NULL THEN RAISE EXCEPTION 'Esta sucursal ya se restauró.'; END IF;
    v_neg := v_a.negocio_id; v_suc := v_a.sucursal_id; v_staffA := v_a.datos->>'staffA';
    PERFORM 1 FROM negocios WHERE id = v_neg FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El negocio % ya no existe.', v_neg; END IF;
    SELECT datos INTO v_doc FROM negocio_sucursales WHERE negocio_id = v_neg FOR UPDATE;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_doc->'sucursales', '[]'::jsonb)) s WHERE s->>'id' = v_suc) THEN
        RAISE EXCEPTION 'El negocio ya tiene una sucursal con ese id (%). No se restaura encima.', v_suc;
    END IF;

    -- 1) Los registros regresan idénticos (mismo id, mismas fechas).
    v_permitidas := _arc_tablas() || ARRAY['evaluacion_respuestas', 'menu_publico', 'staff', 'nomina_recibos'];
    FOR v_t IN SELECT DISTINCT tabla FROM admin_archivo_filas WHERE archivo_id = p_id LOOP
        IF NOT (v_t = ANY(v_permitidas)) THEN RAISE EXCEPTION 'Tabla no permitida en el archivo: %', v_t; END IF;
        EXECUTE format('INSERT INTO %I SELECT (jsonb_populate_record(NULL::%I, f.fila)).*
                          FROM admin_archivo_filas f WHERE f.archivo_id = $1 AND f.tabla = %L', v_t, v_t, v_t) USING p_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_cuenta := v_cuenta || jsonb_build_object(v_t, v_n);
    END LOOP;
    DELETE FROM admin_archivo_filas WHERE archivo_id = p_id;

    -- 2) El staff que pasó a otro negocio regresa (el que siga allá).
    IF v_staffA IS NOT NULL THEN
        UPDATE nomina_recibos SET negocio_id = v_neg
         WHERE negocio_id = v_staffA AND datos->>'staffId' IN (SELECT jsonb_array_elements_text(coalesce(v_a.datos->'staff', '[]'::jsonb)));
        UPDATE staff SET negocio_id = v_neg, datos = datos || jsonb_build_object('sucursalId', v_suc)
         WHERE negocio_id = v_staffA AND id IN (SELECT jsonb_array_elements_text(coalesce(v_a.datos->'staff', '[]'::jsonb)));
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_cuenta := v_cuenta || jsonb_build_object('staff_regresado', v_n);
    END IF;

    -- 3) El catálogo recupera la sucursal (y deja de ser «solo catálogo» lo que se volvió por esto).
    UPDATE negocio_insumos SET datos = _mig_sumar_suc(datos, jsonb_build_array(v_suc))
     WHERE negocio_id = v_neg AND insumo_id IN (SELECT jsonb_array_elements_text(coalesce(v_a.datos->'insumos', '[]'::jsonb)));
    UPDATE recetas SET datos = _mig_sumar_suc(datos, jsonb_build_array(v_suc))
           - (CASE WHEN id IN (SELECT jsonb_array_elements_text(coalesce(v_a.datos->'recetasGlobal', '[]'::jsonb))) THEN '_global' ELSE '' END)
     WHERE negocio_id = v_neg AND id IN (SELECT jsonb_array_elements_text(coalesce(v_a.datos->'recetas', '[]'::jsonb)));

    -- 4) Los documentos: la ficha y lo suyo de vuelta.
    INSERT INTO negocio_sucursales (negocio_id, datos, updated_at)
    VALUES (v_neg, jsonb_build_object('sucursales', jsonb_build_array(v_a.datos->'ficha')), now())
    ON CONFLICT (negocio_id) DO UPDATE SET
        datos = negocio_sucursales.datos || jsonb_build_object('sucursales',
                    coalesce(negocio_sucursales.datos->'sucursales', '[]'::jsonb) || jsonb_build_array(v_a.datos->'ficha')),
        updated_at = now();
    IF jsonb_typeof(v_a.datos->'cfg') = 'object' THEN
        UPDATE negocio_sucursales SET datos = datos || jsonb_build_object('cfg', coalesce(datos->'cfg', '{}'::jsonb) || jsonb_build_object(v_suc, v_a.datos->'cfg'))
         WHERE negocio_id = v_neg;
    END IF;
    IF jsonb_typeof(v_a.datos->'invAjustes'->'compuestos') IS NOT NULL AND jsonb_typeof(v_a.datos->'invAjustes'->'compuestos') <> 'null'
       OR jsonb_typeof(v_a.datos->'invAjustes'->'bateo') IS NOT NULL AND jsonb_typeof(v_a.datos->'invAjustes'->'bateo') <> 'null' THEN
        INSERT INTO inv_ajustes (negocio_id, datos, updated_at) VALUES (v_neg, '{}'::jsonb, now()) ON CONFLICT (negocio_id) DO NOTHING;
        IF coalesce(jsonb_typeof(v_a.datos->'invAjustes'->'compuestos'), 'null') <> 'null' THEN
            UPDATE inv_ajustes SET datos = datos || jsonb_build_object('compuestos', coalesce(datos->'compuestos', '{}'::jsonb) || jsonb_build_object(v_suc, v_a.datos->'invAjustes'->'compuestos')), updated_at = now()
             WHERE negocio_id = v_neg;
        END IF;
        IF coalesce(jsonb_typeof(v_a.datos->'invAjustes'->'bateo'), 'null') <> 'null' THEN
            UPDATE inv_ajustes SET datos = datos || jsonb_build_object('bateo', coalesce(datos->'bateo', '{}'::jsonb) || jsonb_build_object(v_suc, v_a.datos->'invAjustes'->'bateo')), updated_at = now()
             WHERE negocio_id = v_neg;
        END IF;
    END IF;
    IF coalesce(jsonb_typeof(v_a.datos->'nominaParams'), 'null') <> 'null' THEN
        INSERT INTO gf_nomina_params (negocio_id, datos, updated_at) VALUES (v_neg, '{}'::jsonb, now()) ON CONFLICT (negocio_id) DO NOTHING;
        UPDATE gf_nomina_params SET datos = datos || jsonb_build_object('porSucursal', coalesce(datos->'porSucursal', '{}'::jsonb) || jsonb_build_object(v_suc, v_a.datos->'nominaParams')), updated_at = now()
         WHERE negocio_id = v_neg;
    END IF;

    UPDATE admin_sucursales_archivo SET restaurada_at = now(),
           datos = datos || jsonb_build_object('restauradaPor', auth.uid(), 'cuentaRestaurada', v_cuenta)
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'id', p_id, 'cuenta', v_cuenta);
END $$;

-- Sin sesión, nadie (anon se nombra a propósito: si no, los privilegios por defecto las dejarían abiertas).
REVOKE ALL ON FUNCTION admin_archivar_sucursal(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_archivar_sucursal(TEXT, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION admin_restaurar_sucursal(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_restaurar_sucursal(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION _arc_guardar(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
