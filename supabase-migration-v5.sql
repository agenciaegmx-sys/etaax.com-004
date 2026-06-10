-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v5 — Módulos administrativos en Supabase
-- Corre esto en: Supabase → SQL Editor
-- Seguro de re-ejecutar (IF NOT EXISTS en todo)
-- ═══════════════════════════════════════════════════════════════

-- Función reutilizable: verifica que el usuario auth sea dueño del negocio
-- (ya existe de v2/v3, pero se incluye aquí por claridad)

/* ──────────────────────────────────────────────────────────
   1. CORTES DE CAJA / VENTAS DIARIAS
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS cortes (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cortes_neg ON cortes(negocio_id);
ALTER TABLE cortes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON cortes;
CREATE POLICY "own" ON cortes
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON cortes;
CREATE POLICY "admin_all" ON cortes
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   2. DEPÓSITOS
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS depositos (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_depositos_neg ON depositos(negocio_id);
ALTER TABLE depositos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON depositos;
CREATE POLICY "own" ON depositos
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON depositos;
CREATE POLICY "admin_all" ON depositos
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   3. VENTAS EXTRA (eventos, festivales, etc.)
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS ventas_extra (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ventas_extra_neg ON ventas_extra(negocio_id);
ALTER TABLE ventas_extra ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON ventas_extra;
CREATE POLICY "own" ON ventas_extra
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON ventas_extra;
CREATE POLICY "admin_all" ON ventas_extra
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   4. GASTOS
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS gastos (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gastos_neg ON gastos(negocio_id);
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON gastos;
CREATE POLICY "own" ON gastos
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON gastos;
CREATE POLICY "admin_all" ON gastos
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   5. PROVEEDORES  (compartida por gastos.html y proveedores.html)
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS proveedores (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proveedores_neg ON proveedores(negocio_id);
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON proveedores;
CREATE POLICY "own" ON proveedores
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON proveedores;
CREATE POLICY "admin_all" ON proveedores
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   6. CATEGORÍAS PERSONALIZADAS DE GASTOS
      Una fila por negocio (upsert por negocio_id como PK)
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS gastos_cats_custom (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE gastos_cats_custom ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON gastos_cats_custom;
CREATE POLICY "own" ON gastos_cats_custom
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON gastos_cats_custom;
CREATE POLICY "admin_all" ON gastos_cats_custom
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   7. CLIENTES
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS clientes (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientes_neg ON clientes(negocio_id);
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON clientes;
CREATE POLICY "own" ON clientes
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON clientes;
CREATE POLICY "admin_all" ON clientes
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ──────────────────────────────────────────────────────────
   8. VENTAS POR PRODUCTO (periodos de análisis)
   ────────────────────────────────────────────────────────── */
CREATE TABLE IF NOT EXISTS ventas_productos (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ventas_productos_neg ON ventas_productos(negocio_id);
ALTER TABLE ventas_productos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON ventas_productos;
CREATE POLICY "own" ON ventas_productos
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON ventas_productos;
CREATE POLICY "admin_all" ON ventas_productos
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
