-- ═══════════════════════════════════════════════════════════════════
-- ETAAX — Migración v37: ajustes de inventario en la nube
--
-- Los PRODUCTOS COMPUESTOS y las marcas "DE BATEO" vivían solo en
-- localStorage del navegador (se perdían al cambiar de dispositivo, limpiar
-- caché o llenar la cuota). Ahora se respaldan en Supabase como un doc por
-- negocio: { compuestos: {[sucursalId]: [...]}, bateo: {[sucursalId]: [...]} }.
--
-- Correr a mano en Supabase → SQL Editor. Idempotente.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inv_ajustes (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inv_ajustes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON inv_ajustes;
CREATE POLICY "own" ON inv_ajustes
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON inv_ajustes;
CREATE POLICY "admin_all" ON inv_ajustes
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
