-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v3 — Super-admin (Edwin)
-- Corre esto en: Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Función que identifica al admin de la plataforma por email
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
    SELECT coalesce(auth.jwt() ->> 'email', '') = 'admin@etaax.com'
$$;

-- Políticas admin para cada tabla (se suman a las "own" existentes)
-- Supabase evalúa con OR: si cualquier política pasa, el acceso se concede

DROP POLICY IF EXISTS "admin_all" ON negocios;
CREATE POLICY "admin_all" ON negocios
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "admin_all" ON usuarios;
CREATE POLICY "admin_all" ON usuarios
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "admin_all" ON staff;
CREATE POLICY "admin_all" ON staff
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "admin_all" ON config_negocio;
CREATE POLICY "admin_all" ON config_negocio
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "admin_all" ON permisos;
CREATE POLICY "admin_all" ON permisos
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "admin_all" ON insumos;
CREATE POLICY "admin_all" ON insumos
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "admin_all" ON recetas;
CREATE POLICY "admin_all" ON recetas
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "admin_all" ON inventarios;
CREATE POLICY "admin_all" ON inventarios
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
