-- ============================================================
-- ETAAX — tabla negocio_insumos
-- Ejecutar en Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS negocio_insumos (
    negocio_id  TEXT NOT NULL,
    insumo_id   TEXT NOT NULL,
    datos       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (negocio_id, insumo_id)
);

-- Índice para consultas por negocio
CREATE INDEX IF NOT EXISTS idx_negocio_insumos_negocio
    ON negocio_insumos (negocio_id);

-- RLS
ALTER TABLE negocio_insumos ENABLE ROW LEVEL SECURITY;

-- Usuarios autenticados pueden leer y escribir sus propios insumos
CREATE POLICY "authenticated select" ON negocio_insumos
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated all" ON negocio_insumos
    FOR ALL USING (auth.role() = 'authenticated');
