-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v34 — Checklists operativos (apertura/cierre/limpieza…)
-- Idempotente. Correr a mano en Supabase → SQL Editor.
--
-- Dos tablas per-record (id/negocio_id/datos JSONB), patrón estándar:
--  · checklists      = PLANTILLAS. datos = { id, nombre, tipo, area,
--                       sucursalId, tareas:[{id,texto,freq}], activo, updated }
--  · checklist_runs  = EJECUCIONES por semana. id estable
--                       'clr_<plantillaId>_<YYYY-Www>'. datos = { id,
--                       plantillaId, sucursalId, semana, marcas:{tareaId:{d0..d6}},
--                       firmas:{d0..d6}, foto_url, updated }
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklists (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklists_neg ON checklists(negocio_id);
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own" ON checklists;
CREATE POLICY "own" ON checklists FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));
DROP POLICY IF EXISTS "admin_all" ON checklists;
CREATE POLICY "admin_all" ON checklists FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE TABLE IF NOT EXISTS checklist_runs (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_neg ON checklist_runs(negocio_id);
ALTER TABLE checklist_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own" ON checklist_runs;
CREATE POLICY "own" ON checklist_runs FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));
DROP POLICY IF EXISTS "admin_all" ON checklist_runs;
CREATE POLICY "admin_all" ON checklist_runs FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Realtime (sync en vivo entre dispositivos)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='checklists')
        THEN ALTER PUBLICATION supabase_realtime ADD TABLE checklists; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='checklist_runs')
        THEN ALTER PUBLICATION supabase_realtime ADD TABLE checklist_runs; END IF;
END $$;
