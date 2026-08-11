-- ═══════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v41 — CATÁLOGOS GLOBALES DE RRHH
--
-- Perfiles de puesto y plantillas de evaluación que ETAAX ofrece a TODOS los
-- negocios: el negocio los "jala" a su catálogo con un botón, igual que hoy
-- jala insumos del catálogo maestro (catalogo_insumos, v4).
--
-- Solo PLANTILLAS: aquí nunca entran respuestas de evaluaciones ni datos de
-- personas. Las respuestas viven en su negocio y ahí se quedan.
--
-- Mismo patrón de permisos que catalogo_insumos:
--   · escribe: solo el admin de plataforma (is_platform_admin)
--   · lee: cualquier usuario autenticado (para poder importar a su negocio)
--
-- Correr a mano en Supabase → SQL Editor. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════

-- ── PERFILES DE PUESTO SUGERIDOS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogo_perfiles (
    id         TEXT        PRIMARY KEY,
    datos      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE catalogo_perfiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all"          ON catalogo_perfiles;
DROP POLICY IF EXISTS "read_authenticated" ON catalogo_perfiles;

CREATE POLICY "admin_all" ON catalogo_perfiles
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE POLICY "read_authenticated" ON catalogo_perfiles
    FOR SELECT USING (auth.role() = 'authenticated');

-- ── PLANTILLAS DE EVALUACIÓN SUGERIDAS ───────────────────────────
CREATE TABLE IF NOT EXISTS catalogo_evaluaciones (
    id         TEXT        PRIMARY KEY,
    datos      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE catalogo_evaluaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all"          ON catalogo_evaluaciones;
DROP POLICY IF EXISTS "read_authenticated" ON catalogo_evaluaciones;

CREATE POLICY "admin_all" ON catalogo_evaluaciones
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE POLICY "read_authenticated" ON catalogo_evaluaciones
    FOR SELECT USING (auth.role() = 'authenticated');
