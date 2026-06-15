/* ============================================================
   ETAAX — Migración v13
   Evidencias visuales (Supabase Storage) + bandeja de capturas
   pendientes para la captura móvil por QR.
   Idempotente: correr a mano en Supabase → SQL Editor.
   ============================================================ */

/* ── 1. Bucket de Storage para evidencias (fotos de cortes/gastos) ──
   Público en lectura; las rutas usan nombres aleatorios por negocio. */
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidencias', 'evidencias', true)
ON CONFLICT (id) DO NOTHING;

/* Lectura pública del bucket */
DROP POLICY IF EXISTS "evidencias_read" ON storage.objects;
CREATE POLICY "evidencias_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'evidencias');

/* Escritura / borrado: cualquier usuario autenticado (dueño o staff
   con sesión, o la sesión móvil que inicia con la cuenta del negocio) */
DROP POLICY IF EXISTS "evidencias_insert" ON storage.objects;
CREATE POLICY "evidencias_insert" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'evidencias');

DROP POLICY IF EXISTS "evidencias_update" ON storage.objects;
CREATE POLICY "evidencias_update" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'evidencias');

DROP POLICY IF EXISTS "evidencias_delete" ON storage.objects;
CREATE POLICY "evidencias_delete" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'evidencias');

/* ── 2. Bandeja de capturas pendientes (captura móvil por QR) ──
   El celular sube foto + fecha aquí; el desktop las asocia al corte/gasto. */
CREATE TABLE IF NOT EXISTS capturas_pendientes (
    id          TEXT PRIMARY KEY,
    negocio_id  TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL,          -- 'corte' | 'gasto' | 'entrada' | 'merma'
    fecha       TEXT,                   -- YYYY-MM-DD
    foto_url    TEXT,
    foto_path   TEXT,
    nota        TEXT,
    asociado    BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_capturas_neg ON capturas_pendientes(negocio_id);
ALTER TABLE capturas_pendientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON capturas_pendientes;
CREATE POLICY "own" ON capturas_pendientes
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON capturas_pendientes;
CREATE POLICY "admin_all" ON capturas_pendientes
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
