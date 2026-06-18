-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v17 — Arreglar esquema de recetas e inventarios
--
-- CAUSA RAÍZ del bug "las recetas no sincronizan entre dispositivos":
-- La migración v2 creó `recetas` e `inventarios` como DOC-POR-NEGOCIO
-- (negocio_id como PRIMARY KEY, sin columna `id` ni `created_at`).
-- A partir de v8 el código las trata como PER-RECORD (una fila por receta
-- con `id` PK y `created_at`), pero v8 usa CREATE TABLE IF NOT EXISTS, que
-- NO corrige una tabla que ya existía. Resultado en una base que corrió v2:
--   • upsert({id,...}, onConflict:'id')  → falla (no hay columna `id`)
--   • select(...).order('created_at')    → falla (no hay `created_at`)
-- → las recetas nunca suben ni se leen de Supabase (solo localStorage).
-- Los insumos NO sufren esto porque el código usa la tabla nueva
-- `negocio_insumos`, no la `insumos` vieja de v2.
--
-- Esta migración NO BORRA datos: si encuentra el esquema viejo, RENOMBRA la
-- tabla a `<tabla>_legacy_v2` (queda intacta como respaldo) y crea la tabla
-- per-record correcta. Las recetas reales viven en el localStorage de cada
-- dispositivo y el propio código las re-sube (merge) en la siguiente carga.
--
-- Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

-- 1) Si recetas/inventarios tienen el esquema viejo (sin columna `id`),
--    renombrarlas para preservarlas y dejar libre el nombre.
DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY['recetas', 'inventarios'];
    existe   BOOLEAN;
    tiene_id BOOLEAN;
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        SELECT EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_schema = 'public' AND table_name = t) INTO existe;
        IF existe THEN
            SELECT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = t
                             AND column_name = 'id') INTO tiene_id;
            IF NOT tiene_id THEN
                -- Esquema viejo (doc-por-negocio). Preservar como respaldo.
                EXECUTE format('ALTER TABLE public.%I RENAME TO %I', t, t || '_legacy_v2');
                RAISE NOTICE 'v17: % tenía esquema viejo → renombrada a %_legacy_v2', t, t;
            END IF;
        END IF;
    END LOOP;
END $$;

-- 2) Crear (si falta) la tabla RECETAS per-record correcta.
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

-- 3) Crear (si falta) la tabla INVENTARIOS per-record correcta.
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

-- 4) Re-asegurar Realtime en las tablas recreadas (el rename pudo sacarlas
--    de la publicación; las tablas nuevas no nacen publicadas).
DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY['recetas', 'inventarios'];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t)
        THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
