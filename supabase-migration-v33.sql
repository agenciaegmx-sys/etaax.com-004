-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v33 — Horarios operativos (rol semana a semana)
-- Idempotente. Correr a mano en Supabase → SQL Editor.
--
-- Un registro = el rol de UNA sucursal en UNA semana ISO.
-- id estable: 'hor_<sucursalId|suc_principal>_<YYYY-Www>'
-- datos = { sucursalId, semana, turnos:{ staffId:{ lun:{in,out}|{desc:true}, ... } }, updated }
-- Patrón per-record idéntico a inventarios/cortes (id/negocio_id/datos JSONB).
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS horarios (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_horarios_neg ON horarios(negocio_id);
ALTER TABLE horarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON horarios;
CREATE POLICY "own" ON horarios
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON horarios;
CREATE POLICY "admin_all" ON horarios
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Realtime (efecto Google Drive entre dispositivos). Las tablas nuevas no
-- nacen publicadas; añadirla si no está.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'horarios'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE horarios;
    END IF;
END $$;
