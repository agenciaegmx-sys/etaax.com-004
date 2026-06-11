-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v8 — Recetas, Inventarios, Requisiciones
-- Corre esto en: Supabase → SQL Editor
-- Seguro de re-ejecutar (IF NOT EXISTS en todo)
-- ═══════════════════════════════════════════════════════════════

/* ──────────────────────────────────────────────────────────
   1. RECETAS — per record (cada receta es una fila)
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS recetas (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recetas_neg ON recetas(negocio_id);
ALTER TABLE recetas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON recetas;
CREATE POLICY "own" ON recetas
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON recetas;
CREATE POLICY "admin_all" ON recetas
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   2. INVENTARIOS — per record (cada snapshot es una fila)
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS inventarios (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventarios_neg ON inventarios(negocio_id);
ALTER TABLE inventarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON inventarios;
CREATE POLICY "own" ON inventarios
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON inventarios;
CREATE POLICY "admin_all" ON inventarios
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   3. ENTRADAS LOG — per record
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS entradas_log (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entradas_log_neg ON entradas_log(negocio_id);
ALTER TABLE entradas_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON entradas_log;
CREATE POLICY "own" ON entradas_log
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON entradas_log;
CREATE POLICY "admin_all" ON entradas_log
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   4. REQ PEDIDO — per negocio (estado activo de la requisición)
      datos = {[insumoId]: {existencia, pedidoManual, presIdx, noPedir}}
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS req_pedido (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE req_pedido ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON req_pedido;
CREATE POLICY "own" ON req_pedido
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON req_pedido;
CREATE POLICY "admin_all" ON req_pedido
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   5. REQ HISTORIAL — per record (cada requisición archivada)
      datos = {id, fecha, items, resumen}
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS req_historial (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_req_hist_neg ON req_historial(negocio_id);
ALTER TABLE req_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON req_historial;
CREATE POLICY "own" ON req_historial
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON req_historial;
CREATE POLICY "admin_all" ON req_historial
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
