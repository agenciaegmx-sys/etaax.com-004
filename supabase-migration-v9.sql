-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v9 — Fix seguridad: RLS de negocio_insumos
-- Corre esto en: Supabase → SQL Editor
-- Seguro de re-ejecutar (DROP POLICY IF EXISTS en todo)
--
-- Problema: las políticas anteriores ("authenticated select" /
-- "authenticated all") permitían a CUALQUIER usuario autenticado
-- leer y modificar los insumos de TODOS los negocios.
-- Fix: aplicar el mismo patrón "own" + "admin_all" del resto
-- de las tablas (v5/v6/v8).
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated select" ON negocio_insumos;
DROP POLICY IF EXISTS "authenticated all"    ON negocio_insumos;

DROP POLICY IF EXISTS "own" ON negocio_insumos;
CREATE POLICY "own" ON negocio_insumos
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON negocio_insumos;
CREATE POLICY "admin_all" ON negocio_insumos
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
