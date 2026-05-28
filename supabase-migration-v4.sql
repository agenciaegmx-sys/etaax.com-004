-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v4 — Catálogos maestros globales
-- Corre esto en: Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── CATÁLOGO GLOBAL DE PROVEEDORES ──────────────────────────────
CREATE TABLE IF NOT EXISTS catalogo_proveedores (
    id         TEXT        PRIMARY KEY,
    datos      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE catalogo_proveedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all"          ON catalogo_proveedores;
DROP POLICY IF EXISTS "read_authenticated" ON catalogo_proveedores;

-- Solo admin puede escribir
CREATE POLICY "admin_all" ON catalogo_proveedores
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Cualquier usuario autenticado puede leer (para usar el catálogo en su negocio)
CREATE POLICY "read_authenticated" ON catalogo_proveedores
    FOR SELECT USING (auth.role() = 'authenticated');

-- ── CATÁLOGO GLOBAL DE INSUMOS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogo_insumos (
    id         TEXT        PRIMARY KEY,
    datos      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE catalogo_insumos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all"          ON catalogo_insumos;
DROP POLICY IF EXISTS "read_authenticated" ON catalogo_insumos;

-- Solo admin puede escribir
CREATE POLICY "admin_all" ON catalogo_insumos
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Cualquier usuario autenticado puede leer
CREATE POLICY "read_authenticated" ON catalogo_insumos
    FOR SELECT USING (auth.role() = 'authenticated');
