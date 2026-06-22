-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v25 — Módulo de Consultoría: Perfiles de Puesto
-- y Organigrama (ambos por negocio).
--
-- Patrón "per record" estándar: id / negocio_id / datos JSONB.
-- RLS: dueño del negocio (own) + colaboradores (es_staff_de, v19) +
-- admin maestro (is_platform_admin). Idempotente.
-- ════════════════════════════════════════════════════════════════

-- ── Perfiles de puesto (uno por puesto) ──────────────────────────
CREATE TABLE IF NOT EXISTS perfiles_puesto (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE perfiles_puesto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own"          ON perfiles_puesto;
DROP POLICY IF EXISTS "staff_acceso" ON perfiles_puesto;
DROP POLICY IF EXISTS "admin_all"    ON perfiles_puesto;
CREATE POLICY "own" ON perfiles_puesto FOR ALL
    USING      (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));
CREATE POLICY "staff_acceso" ON perfiles_puesto FOR ALL
    USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id));
CREATE POLICY "admin_all" ON perfiles_puesto FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- ── Organigrama (un documento por negocio: nodos + conexiones) ───
-- PK = negocio_id (patrón "documento único", igual que sf_metas/gf_nominas)
-- porque se guarda con sbUpsertDoc (onConflict negocio_id, sin columna id).
CREATE TABLE IF NOT EXISTS organigrama (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE organigrama ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own"          ON organigrama;
DROP POLICY IF EXISTS "staff_acceso" ON organigrama;
DROP POLICY IF EXISTS "admin_all"    ON organigrama;
CREATE POLICY "own" ON organigrama FOR ALL
    USING      (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));
CREATE POLICY "staff_acceso" ON organigrama FOR ALL
    USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id));
CREATE POLICY "admin_all" ON organigrama FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- ── Realtime: publicar ambas tablas para sincronización en vivo multi-dispositivo
-- (igual que recetas/insumos/cortes en v16). Idempotente.
DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY['perfiles_puesto', 'organigrama'];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t)
        THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
