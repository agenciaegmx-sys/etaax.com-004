-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v95 — Recibos y presupuestos: editar con el generador y
--                         eliminar (con motivo, y se puede restaurar)
--
-- (Edwin, 26-nov) En el panel admin, «Editar» un recibo abre el MISMO
-- generador con el que se hizo (negocio, sucursales, suscripción, servicios,
-- total, cobro…) y «Eliminar» lo quita del historial.
--
-- La v81 dejó los importes fijos a propósito («una reimpresión no crea otro
-- cobro»). Eso se conserva así:
--   · REEMITIR no crea otro documento: mismo id, MISMO FOLIO, la versión sube y
--     la bitácora guarda cómo estaba antes (cliente, fecha, total, estado…). El
--     HTML archivado se reemplaza por el nuevo: la reimpresión sale como quedó.
--     Solo los documentos GENERADOS (los PDF recuperados no tienen con qué
--     rearmarse) y sin cambiar de tipo.
--   · ELIMINAR no borra la fila: la marca (eliminado_at + motivo), sale de la
--     lista y de los totales, y queda en la bitácora. RESTAURAR la regresa
--     igual. El vínculo presupuesto → recibo se suelta al eliminar (para poder
--     volver a generar el recibo de ese presupuesto) y se recupera al
--     restaurar si nadie lo ocupó.
--
-- Mismo candado de siempre: solo el admin maestro, por RPC, con la versión
-- (dos pestañas no se pisan). Requiere la v81. Correr a mano en Supabase →
-- SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.admin_documentos ADD COLUMN IF NOT EXISTS eliminado_at timestamptz;
ALTER TABLE public.admin_documentos ADD COLUMN IF NOT EXISTS eliminado_motivo text NOT NULL DEFAULT '';
ALTER TABLE public.admin_documentos ADD COLUMN IF NOT EXISTS presupuesto_id_previo text;

-- ── Reemitir: el mismo documento, rearmado con el generador ────────────────
CREATE OR REPLACE FUNCTION public.admin_documento_reemitir(p_id text, p_version integer, p_documento jsonb)
RETURNS public.admin_documentos LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.admin_documentos; anterior jsonb; v_estado text;
BEGIN
 IF NOT coalesce(public.is_platform_admin(),false) THEN RAISE EXCEPTION 'Acceso exclusivo del admin maestro' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.admin_documentos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Documento no encontrado'; END IF;
 IF d.version <> p_version OR p_version IS NULL THEN RAISE EXCEPTION 'El documento cambió en otra ventana. Recarga el historial'; END IF;
 IF d.eliminado_at IS NOT NULL THEN RAISE EXCEPTION 'El documento está eliminado. Restáuralo para editarlo'; END IF;
 IF d.origen <> 'generado' THEN RAISE EXCEPTION 'Un PDF recuperado no se puede rearmar: solo se corrige su estado'; END IF;
 IF coalesce(p_documento->>'tipo', d.tipo) <> d.tipo THEN RAISE EXCEPTION 'Un documento no cambia de tipo: genera uno nuevo'; END IF;
 IF length(coalesce(p_documento->>'html','')) = 0 THEN RAISE EXCEPTION 'Falta el documento rearmado'; END IF;
 v_estado := coalesce(nullif(p_documento->>'estado',''), d.estado);
 IF d.tipo = 'presupuesto' AND v_estado = 'pagado' THEN v_estado := 'pendiente'; END IF;
 IF v_estado = 'anulado' AND d.estado <> 'anulado' AND length(btrim(coalesce(p_documento->>'nota',''))) = 0 THEN
   RAISE EXCEPTION 'Indica el motivo de anulación';
 END IF;
 anterior := jsonb_build_object('cliente',d.cliente,'cliente_negocio_id',d.cliente_negocio_id,'fecha',d.fecha,'total',d.total,
   'estado',d.estado,'fecha_pago',d.fecha_pago,'metodo',d.metodo,'referencia',d.referencia,
   'suscripcion_monto',d.suscripcion_monto,'meses',d.meses,'periodo_desde',d.periodo_desde);
 UPDATE public.admin_documentos SET
   cliente_negocio_id = nullif(p_documento->>'cliente_negocio_id',''),
   cliente   = btrim(coalesce(p_documento->>'cliente', d.cliente)),
   fecha     = coalesce(nullif(p_documento->>'fecha','')::date, d.fecha),
   total     = (p_documento->>'total')::numeric,
   suscripcion_monto = nullif(p_documento->>'suscripcion_monto','')::numeric,
   meses     = coalesce((p_documento->>'meses')::integer, d.meses),
   periodo_desde = nullif(p_documento->>'periodo_desde','')::date,
   estado    = v_estado,
   fecha_pago = CASE WHEN v_estado = 'pagado' THEN nullif(p_documento->>'fecha_pago','')::date ELSE NULL END,
   metodo    = coalesce(p_documento->>'metodo',''),
   referencia = coalesce(p_documento->>'referencia',''),
   datos     = coalesce(p_documento->'datos', d.datos),
   html      = p_documento->>'html',
   updated_at = now(), version = version + 1,
   cambios = cambios || jsonb_build_array(jsonb_build_object('fecha',now(),'usuario',auth.uid(),'accion','reemitido',
     'antes',anterior,'cambios',jsonb_strip_nulls(jsonb_build_object('total',p_documento->>'total','cliente',p_documento->>'cliente',
       'estado',v_estado,'fecha',p_documento->>'fecha','nota',nullif(btrim(coalesce(p_documento->>'nota','')),'')))))
 WHERE id = p_id RETURNING * INTO d;
 RETURN d;
END $$;

-- ── Eliminar (marca, no borra) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_documento_eliminar(p_id text, p_version integer, p_motivo text)
RETURNS public.admin_documentos LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.admin_documentos;
BEGIN
 IF NOT coalesce(public.is_platform_admin(),false) THEN RAISE EXCEPTION 'Acceso exclusivo del admin maestro' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.admin_documentos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Documento no encontrado'; END IF;
 IF d.version <> p_version OR p_version IS NULL THEN RAISE EXCEPTION 'El documento cambió en otra ventana. Recarga el historial'; END IF;
 IF d.eliminado_at IS NOT NULL THEN RETURN d; END IF;
 IF length(btrim(coalesce(p_motivo,''))) = 0 THEN RAISE EXCEPTION 'Indica por qué se elimina'; END IF;
 UPDATE public.admin_documentos SET
   eliminado_at = now(), eliminado_motivo = btrim(p_motivo),
   presupuesto_id_previo = presupuesto_id, presupuesto_id = NULL,
   updated_at = now(), version = version + 1,
   cambios = cambios || jsonb_build_array(jsonb_build_object('fecha',now(),'usuario',auth.uid(),'accion','eliminado','nota',btrim(p_motivo)))
 WHERE id = p_id RETURNING * INTO d;
 RETURN d;
END $$;

-- ── Restaurar ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_documento_restaurar(p_id text, p_version integer)
RETURNS public.admin_documentos LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.admin_documentos;
BEGIN
 IF NOT coalesce(public.is_platform_admin(),false) THEN RAISE EXCEPTION 'Acceso exclusivo del admin maestro' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.admin_documentos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Documento no encontrado'; END IF;
 IF d.version <> p_version OR p_version IS NULL THEN RAISE EXCEPTION 'El documento cambió en otra ventana. Recarga el historial'; END IF;
 IF d.eliminado_at IS NULL THEN RETURN d; END IF;
 UPDATE public.admin_documentos SET
   eliminado_at = NULL, eliminado_motivo = '',
   presupuesto_id = CASE WHEN presupuesto_id_previo IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM public.admin_documentos x WHERE x.presupuesto_id = d.presupuesto_id_previo)
                         THEN presupuesto_id_previo ELSE NULL END,
   presupuesto_id_previo = NULL,
   updated_at = now(), version = version + 1,
   cambios = cambios || jsonb_build_array(jsonb_build_object('fecha',now(),'usuario',auth.uid(),'accion','restaurado'))
 WHERE id = p_id RETURNING * INTO d;
 RETURN d;
END $$;

REVOKE ALL ON FUNCTION public.admin_documento_reemitir(text,integer,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_documento_eliminar(text,integer,text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_documento_restaurar(text,integer)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_documento_reemitir(text,integer,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_documento_eliminar(text,integer,text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_documento_restaurar(text,integer)      TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

-- Comprobación (sale en Results): las tres funciones, solo para sesiones.
SELECT p.proname AS funcion, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_puede,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS sesion_puede
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public' AND p.proname IN ('admin_documento_reemitir','admin_documento_eliminar','admin_documento_restaurar')
 ORDER BY 1;
