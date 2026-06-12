-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v11 — Tabla permisos (por negocio y rol)
-- Corre esto en: Supabase → SQL Editor
-- Seguro de re-ejecutar (IF NOT EXISTS / DROP POLICY IF EXISTS)
--
-- El submódulo Permisos y Roles guardaba en una tabla que no
-- existía (v2 la borró y nadie la recreó): el botón "Guardar"
-- fallaba en silencio y los permisos vivían solo en localStorage.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS permisos (
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    rol        TEXT NOT NULL,
    datos      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (negocio_id, rol)
);
ALTER TABLE permisos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON permisos;
CREATE POLICY "own" ON permisos
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON permisos;
CREATE POLICY "admin_all" ON permisos
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
