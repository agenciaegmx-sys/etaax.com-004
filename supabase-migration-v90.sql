-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v90 — Los porcentajes del costeo, por tipo de platillo
--
-- Hasta hoy el gasto operativo era un 40% fijo para TODA la carta. Pero un
-- plato fuerte ocupa cocina, equipo y salón mucho más que una bebida que se
-- arma al instante en la barra: el mismo 40% escondía pérdidas en los fuertes
-- y castigaba a las bebidas.
--
-- Ahora cada tipo (Entradas, Platos fuertes, Postres, Bebidas y coctelería,
-- General) trae su food cost meta y su gasto operativo. Los valores de
-- referencia viven en etaax-core.js (COSTEO_PERFILES); este documento guarda
-- lo que el negocio AJUSTÓ desde la carátula de costos:
--
--   datos = { perfiles: { entrada:{food:30, op:33}, fuerte:{…}, … },
--             actualizado: '2026-11-25T…', por: 'Nombre' }
--
-- Un documento por negocio (como inv_ajustes): negocio_id es la llave.
-- Va en su propia tabla y no dentro de inv_ajustes porque ese documento lo
-- reescriben entero otras pantallas (inventarios) y se pisarían.
--
-- Correr a mano en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS costeo_config (
    negocio_id TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE costeo_config ENABLE ROW LEVEL SECURITY;

-- Las tres puertas de siempre. `es_staff_de` hace falta: el gerente que
-- revisa la carátula suele entrar con cuenta de colaborador.
DROP POLICY IF EXISTS "own"          ON costeo_config;
DROP POLICY IF EXISTS "staff_acceso" ON costeo_config;
DROP POLICY IF EXISTS "admin_all"    ON costeo_config;

CREATE POLICY "own" ON costeo_config FOR ALL
    USING      (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

CREATE POLICY "staff_acceso" ON costeo_config FOR ALL
    USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id));

CREATE POLICY "admin_all" ON costeo_config FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());

COMMIT;
