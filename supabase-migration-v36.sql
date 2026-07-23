-- ═══════════════════════════════════════════════════════════════════
-- ETAAX — Migración v36: solicitudes de plan (nueva sucursal vía asesor)
--
-- El dueño pide "agregar sucursal" desde el hub → se crea una SOLICITUD.
-- El admin maestro la ve en su bandeja (📨 Solicitudes) y activa la
-- sucursal manualmente. Cuando haya Stripe/cobro con tarjeta, este flujo
-- se sustituye por el cobro automático.
--
-- Correr a mano en Supabase → SQL Editor. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS solicitudes_plan (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS solicitudes_plan_negocio_idx ON solicitudes_plan (negocio_id);

ALTER TABLE solicitudes_plan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON solicitudes_plan;
CREATE POLICY "own" ON solicitudes_plan
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON solicitudes_plan;
CREATE POLICY "admin_all" ON solicitudes_plan
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
