-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v7 — Tarjetas de crédito del negocio
-- Corre esto en: Supabase → SQL Editor
-- Seguro de re-ejecutar (IF NOT EXISTS en todo)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tarjetas_credito (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tarjetas_neg ON tarjetas_credito(negocio_id);
ALTER TABLE tarjetas_credito ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON tarjetas_credito;
CREATE POLICY "own" ON tarjetas_credito
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON tarjetas_credito;
CREATE POLICY "admin_all" ON tarjetas_credito
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
