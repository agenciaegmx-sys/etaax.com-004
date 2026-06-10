-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v6 — Módulos financieros en Supabase
-- Corre esto en: Supabase → SQL Editor
-- Seguro de re-ejecutar (IF NOT EXISTS en todo)
-- ═══════════════════════════════════════════════════════════════

/* ──────────────────────────────────────────────────────────
   1. OTROS INGRESOS (sf_otros) — per record
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS sf_otros (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sf_otros_neg ON sf_otros(negocio_id);
ALTER TABLE sf_otros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON sf_otros;
CREATE POLICY "own" ON sf_otros
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON sf_otros;
CREATE POLICY "admin_all" ON sf_otros
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   2. METAS DE VENTAS (sf_metas) — per negocio JSONB dict
      datos = {[mes]: {meta, dist, fechaSet, manualDays}}
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS sf_metas (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sf_metas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON sf_metas;
CREATE POLICY "own" ON sf_metas
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON sf_metas;
CREATE POLICY "admin_all" ON sf_metas
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   3. GASTOS FIJOS (gf_fijos) — per record
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS gf_fijos (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_fijos_neg ON gf_fijos(negocio_id);
ALTER TABLE gf_fijos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON gf_fijos;
CREATE POLICY "own" ON gf_fijos
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON gf_fijos;
CREATE POLICY "admin_all" ON gf_fijos
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   4. NÓMINAS (gf_nominas) — per negocio JSONB dict
      datos = {[mes]: {operativa:[], administrativa:[], socios:[]}}
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS gf_nominas (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE gf_nominas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON gf_nominas;
CREATE POLICY "own" ON gf_nominas
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON gf_nominas;
CREATE POLICY "admin_all" ON gf_nominas
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   5. PREVISIONES (previsiones) — per record
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS previsiones (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_previsiones_neg ON previsiones(negocio_id);
ALTER TABLE previsiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON previsiones;
CREATE POLICY "own" ON previsiones
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON previsiones;
CREATE POLICY "admin_all" ON previsiones
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   6. KPI TARGETS (kpi_targets) — per negocio JSONB
      datos = {fijos:15, variables:30, nomOp:22, ...}
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS kpi_targets (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE kpi_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON kpi_targets;
CREATE POLICY "own" ON kpi_targets
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON kpi_targets;
CREATE POLICY "admin_all" ON kpi_targets
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
