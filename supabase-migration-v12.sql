/* ============================================================
   ETAAX — Migración v12
   Parámetros globales de nómina por negocio (gf_nomina_params)
   Doc único por negocio: { primaVacacionalPct, jornadaHoras,
   salarioDiarioDefault }.
   Idempotente: correr a mano en Supabase → SQL Editor.
   ============================================================ */

CREATE TABLE IF NOT EXISTS gf_nomina_params (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE gf_nomina_params ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON gf_nomina_params;
CREATE POLICY "own" ON gf_nomina_params
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON gf_nomina_params;
CREATE POLICY "admin_all" ON gf_nomina_params
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
