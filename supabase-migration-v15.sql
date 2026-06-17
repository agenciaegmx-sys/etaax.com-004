-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v15 — Sucursales en Supabase (sync entre dispositivos)
-- Antes vivían solo en localStorage → no sincronizaban. Doc por negocio:
--   datos = { sucursales: [...], cfg: { [sucId]: {...config..., _logo} } }
-- Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS negocio_sucursales (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE negocio_sucursales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON negocio_sucursales;
CREATE POLICY "own" ON negocio_sucursales
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON negocio_sucursales;
CREATE POLICY "admin_all" ON negocio_sucursales
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
