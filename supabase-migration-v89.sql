-- ═══════════════════════════════════════════════════════════════════════════
-- ETAAX · v89 · VENTA POR APPS: el plan de cada negocio (y de cada sucursal)
--
-- ETAAX se vende como Adobe: Cost·ax, Fin·ax, Equip·ax… por separado o el
-- paquete completo, y CADA SUCURSAL contrata las suyas (precios.js). El plan
-- vive aquí:
--
--   suscripciones.plan  (NULL = paquete completo, mensual, cobro junto: así
--                        quedan TODOS los negocios de antes, sin tocarlos)
--     { ciclo: 'mensual'|'anual', cobro: 'negocio'|'sucursal',
--       base: 'suite'|['costax',…],          ← sucursales sin plan propio
--       sucursales: { <sucId>: 'suite'|[…] } }
--
--   invitaciones.plan   el plan con el que nace un negocio nuevo. Al usarse la
--                       invitación (activar-invitacion le pone negocio_id), un
--                       trigger lo copia a su suscripción: no hay que tocar ni
--                       volver a desplegar la Edge Function.
--
-- El plan lo escribe el admin (RLS admin_all de suscripciones, sin cambios).
-- El dueño pide cambios con una solicitud (solicitudes_plan, tipo 'apps').
-- Lo LEEN el dueño, sus colaboradores, el Staff ETAAX con acceso y el admin, por
-- negocio_plan(): así la app sabe qué enseñar en cada sucursal.
--
-- Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS plan JSONB;
ALTER TABLE invitaciones  ADD COLUMN IF NOT EXISTS plan JSONB;

-- ── Leer el plan de un negocio ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION negocio_plan(p_neg TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner UUID; v_plan JSONB;
BEGIN
    SELECT usuario_id INTO v_owner FROM negocios WHERE id = p_neg;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF (auth.uid() IS NOT NULL AND (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin())) IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
    END IF;
    SELECT plan INTO v_plan FROM suscripciones WHERE negocio_id = p_neg;
    RETURN v_plan;
END;
$$;

-- ── La invitación lleva su plan al negocio que nace ──────────────────────────
CREATE OR REPLACE FUNCTION _inv_plan_al_negocio()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.negocio_id IS NOT NULL AND NEW.plan IS NOT NULL
       AND OLD.negocio_id IS DISTINCT FROM NEW.negocio_id THEN
        INSERT INTO suscripciones (negocio_id, estado, plan)
        VALUES (NEW.negocio_id, 'pendiente', NEW.plan)
        ON CONFLICT (negocio_id) DO UPDATE SET plan = EXCLUDED.plan, updated_at = now();
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS inv_plan_al_negocio ON invitaciones;
CREATE TRIGGER inv_plan_al_negocio
    AFTER UPDATE OF negocio_id ON invitaciones
    FOR EACH ROW EXECUTE FUNCTION _inv_plan_al_negocio();

-- ── La página de alta enseña el plan con el que se invitó ────────────────────
-- Mismo cuerpo de la v49; solo se suma `plan` a lo que se devuelve (apps y
-- ciclo: nada sensible).
CREATE OR REPLACE FUNCTION invitacion_ver(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE i invitaciones;
BEGIN
    IF p_token IS NULL OR length(p_token) < 20 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'invalida');
    END IF;
    SELECT * INTO i FROM invitaciones WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'invalida');
    END IF;
    IF i.usada_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'usada');
    END IF;
    IF i.expira_at < now() THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'expirada');
    END IF;
    RETURN jsonb_build_object(
        'ok',             true,
        'email',          i.email,
        'nombre_negocio', i.nombre_negocio,
        'forma_pago',     i.forma_pago,
        'plan',           i.plan
    );
END;
$$;

REVOKE ALL ON FUNCTION negocio_plan(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION negocio_plan(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION _inv_plan_al_negocio() FROM PUBLIC, anon, authenticated;

-- ── Comprobación (sale en Results) ───────────────────────────────────────────
SELECT 'columna' AS que, table_name || '.' || column_name AS nombre
  FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'plan' AND table_name IN ('suscripciones', 'invitaciones')
UNION ALL
SELECT 'función', p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public' AND p.proname IN ('negocio_plan', '_inv_plan_al_negocio', 'invitacion_ver')
UNION ALL
SELECT 'trigger', tgname FROM pg_trigger WHERE tgname = 'inv_plan_al_negocio'
ORDER BY 1, 2;
