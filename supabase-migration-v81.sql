-- ETAAX · v81 · Archivo privado de recibos y presupuestos del admin maestro.
-- No modifica suscripciones ni registra cargos. Una reimpresión no crea otro cobro.
-- cliente_negocio_id evita las políticas genéricas para tablas operativas de negocio.
BEGIN;
CREATE TABLE IF NOT EXISTS public.admin_documentos (
 id text PRIMARY KEY,
 folio text NOT NULL UNIQUE CHECK (folio = upper(btrim(folio)) AND length(folio) BETWEEN 1 AND 100),
 tipo text NOT NULL CHECK (tipo IN ('recibo','presupuesto')),
 estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','pagado','anulado')),
 cliente_negocio_id text REFERENCES public.negocios(id) ON DELETE SET NULL,
 cliente text NOT NULL CHECK (length(btrim(cliente)) > 0),
 fecha date NOT NULL,
 total numeric(14,2) NOT NULL CHECK (total > 0),
 moneda text NOT NULL DEFAULT 'MXN' CHECK (moneda = 'MXN'),
 suscripcion_monto numeric(14,2) CHECK (suscripcion_monto >= 0 AND suscripcion_monto <= total),
 meses integer NOT NULL DEFAULT 1 CHECK (meses BETWEEN 1 AND 120),
 periodo_desde date,
 fecha_pago date,
 metodo text NOT NULL DEFAULT '',
 referencia text NOT NULL DEFAULT '',
 datos jsonb NOT NULL DEFAULT '{}'::jsonb,
 html text NOT NULL DEFAULT '',
 pdf_base64 text NOT NULL DEFAULT '',
 origen text NOT NULL DEFAULT 'generado' CHECK (origen IN ('generado','pdf_recuperado','stripe_recuperado')),
 origen_clave text UNIQUE,
 presupuesto_id text UNIQUE REFERENCES public.admin_documentos(id),
 version integer NOT NULL DEFAULT 1,
 creado_por uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 cambios jsonb NOT NULL DEFAULT '[]'::jsonb,
 CHECK (tipo <> 'presupuesto' OR estado <> 'pagado'),
 CHECK (estado <> 'pagado' OR fecha_pago IS NOT NULL),
 CHECK (coalesce(suscripcion_monto,0) = 0 OR periodo_desde IS NOT NULL),
 CHECK (length(html) + length(pdf_base64) BETWEEN 1 AND 14000000)
);
CREATE INDEX IF NOT EXISTS admin_documentos_fecha_idx ON public.admin_documentos(fecha DESC, id);
ALTER TABLE public.admin_documentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_documentos_lectura ON public.admin_documentos;
CREATE POLICY admin_documentos_lectura ON public.admin_documentos FOR SELECT TO authenticated USING (public.is_platform_admin());
REVOKE ALL ON public.admin_documentos FROM anon, authenticated;
GRANT SELECT ON public.admin_documentos TO authenticated;

-- Insertar es idempotente por id y por folio. No se sobreescribe el original.
CREATE OR REPLACE FUNCTION public.admin_documento_crear(p_documento jsonb)
RETURNS public.admin_documentos LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.admin_documentos; p public.admin_documentos;
BEGIN
 IF NOT coalesce(public.is_platform_admin(),false) THEN RAISE EXCEPTION 'Acceso exclusivo del admin maestro' USING ERRCODE='42501'; END IF;
 IF nullif(p_documento->>'id','') IS NULL THEN RAISE EXCEPTION 'Falta identificador del documento'; END IF;
 SELECT * INTO d FROM public.admin_documentos WHERE id=p_documento->>'id';
 IF FOUND THEN
   IF d.folio <> upper(btrim(p_documento->>'folio')) OR d.total <> (p_documento->>'total')::numeric OR d.datos <> coalesce(p_documento->'datos','{}'::jsonb) THEN
     RAISE EXCEPTION 'Este documento ya se guardó. Ábrelo desde el historial';
   END IF;
   RETURN d;
 END IF;
 IF nullif(p_documento->>'presupuesto_id','') IS NOT NULL THEN
   SELECT * INTO p FROM public.admin_documentos WHERE id=p_documento->>'presupuesto_id' FOR UPDATE;
   IF NOT FOUND OR p.tipo <> 'presupuesto' OR p.estado='anulado' OR p_documento->>'tipo'<>'recibo' THEN RAISE EXCEPTION 'Presupuesto de origen inválido'; END IF;
 END IF;
 INSERT INTO public.admin_documentos(id,folio,tipo,estado,cliente_negocio_id,cliente,fecha,total,suscripcion_monto,meses,periodo_desde,fecha_pago,metodo,referencia,datos,html,pdf_base64,origen,origen_clave,presupuesto_id,cambios)
 VALUES (p_documento->>'id',upper(btrim(p_documento->>'folio')),p_documento->>'tipo',coalesce(p_documento->>'estado','pendiente'),
 nullif(p_documento->>'cliente_negocio_id',''),btrim(p_documento->>'cliente'),(p_documento->>'fecha')::date,(p_documento->>'total')::numeric,
 nullif(p_documento->>'suscripcion_monto','')::numeric,coalesce((p_documento->>'meses')::integer,1),nullif(p_documento->>'periodo_desde','')::date,
 nullif(p_documento->>'fecha_pago','')::date,coalesce(p_documento->>'metodo',''),coalesce(p_documento->>'referencia',''),coalesce(p_documento->'datos','{}'::jsonb),
 coalesce(p_documento->>'html',''),coalesce(p_documento->>'pdf_base64',''),coalesce(p_documento->>'origen','generado'),nullif(p_documento->>'origen_clave',''),nullif(p_documento->>'presupuesto_id',''),
 jsonb_build_array(jsonb_build_object('fecha',now(),'usuario',auth.uid(),'accion','creado','estado',coalesce(p_documento->>'estado','pendiente')))) RETURNING * INTO d;
 RETURN d;
END $$;

-- Cambio con control de versión: dos pestañas no se pisan. Importes, folio y
-- archivo quedan intactos; la clasificación recurrente se puede corregir.
CREATE OR REPLACE FUNCTION public.admin_documento_actualizar(p_id text,p_version integer,p_cambios jsonb)
RETURNS public.admin_documentos LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.admin_documentos; anterior jsonb;
BEGIN
 IF NOT coalesce(public.is_platform_admin(),false) THEN RAISE EXCEPTION 'Acceso exclusivo del admin maestro' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.admin_documentos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Documento no encontrado'; END IF;
 IF d.version <> p_version OR p_version IS NULL THEN RAISE EXCEPTION 'El documento cambió en otra ventana. Recarga el historial'; END IF;
 IF coalesce(p_cambios->>'estado',d.estado)='anulado' AND d.estado<>'anulado' AND length(btrim(coalesce(p_cambios->>'nota','')))=0 THEN RAISE EXCEPTION 'Indica el motivo de anulación'; END IF;
 anterior=jsonb_build_object('estado',d.estado,'fecha_pago',d.fecha_pago,'metodo',d.metodo,'referencia',d.referencia,'suscripcion_monto',d.suscripcion_monto,'meses',d.meses,'periodo_desde',d.periodo_desde);
 UPDATE public.admin_documentos SET
 estado=coalesce(p_cambios->>'estado',estado),
 fecha_pago=CASE WHEN coalesce(p_cambios->>'estado',estado)<>'pagado' THEN NULL WHEN p_cambios ? 'fecha_pago' THEN nullif(p_cambios->>'fecha_pago','')::date ELSE fecha_pago END,
 metodo=CASE WHEN p_cambios ? 'metodo' THEN coalesce(p_cambios->>'metodo','') ELSE metodo END,
 referencia=CASE WHEN p_cambios ? 'referencia' THEN coalesce(p_cambios->>'referencia','') ELSE referencia END,
 suscripcion_monto=CASE WHEN p_cambios ? 'suscripcion_monto' THEN nullif(p_cambios->>'suscripcion_monto','')::numeric ELSE suscripcion_monto END,
 meses=CASE WHEN p_cambios ? 'meses' THEN (p_cambios->>'meses')::integer ELSE meses END,
 periodo_desde=CASE WHEN p_cambios ? 'periodo_desde' THEN nullif(p_cambios->>'periodo_desde','')::date ELSE periodo_desde END,
 updated_at=now(),version=version+1,
 cambios=cambios||jsonb_build_array(jsonb_build_object('fecha',now(),'usuario',auth.uid(),'accion','actualizado','antes',anterior,'cambios',p_cambios - 'html' - 'pdf_base64'))
 WHERE id=p_id RETURNING * INTO d;
 RETURN d;
END $$;
REVOKE ALL ON FUNCTION public.admin_documento_crear(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_documento_actualizar(text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_documento_crear(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_documento_actualizar(text,integer,jsonb) TO authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
