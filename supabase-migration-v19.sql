-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v19 — Acceso a la nube para colaboradores (staff)
--
-- Problema: las sesiones de colaborador (gerente, administración, chef, jefe de
-- barra) eran LOCALES, sin sesión de Supabase, así que la RLS "own" (auth.uid()
-- = dueño) les devolvía 0 filas → no veían el histórico de gastos/cortes/etc.
--
-- Solución: cada negocio tiene una CUENTA de Supabase "de colaboradores"
-- (staff_uid). Cuando un colaborador inicia sesión (tras validar su contraseña
-- local), la app inicia esa cuenta compartida → sesión real → la RLS lo deja
-- leer/escribir los datos de SU negocio. Los permisos por rol (page-guard) siguen
-- controlando qué ve cada perfil en la interfaz.
--
-- Esta migración:
--   1) Agrega negocios.staff_uid (uid de la cuenta) y negocios.staff_cred (las
--      credenciales, para que cualquier dispositivo del dueño las cachee y el
--      colaborador pueda entrar en ese equipo).
--   2) Función es_staff_de(neg) → ¿el usuario actual es la cuenta de staff de ese
--      negocio? (SECURITY DEFINER, no expone nada).
--   3) Política ADICIONAL "staff_acceso" en cada tabla del negocio (se SUMA a la
--      "own", no la reemplaza) que da acceso a la cuenta de staff.
--
-- ⚠️ Requisito en Supabase → Authentication → Providers → Email:
--    DESACTIVAR "Confirm email" (las cuentas de staff se crean sin correo real).
--
-- Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

-- 1) Columnas en negocios
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS staff_uid  UUID;
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS staff_cred JSONB;

-- 2) ¿auth.uid() es la cuenta de staff de este negocio?
CREATE OR REPLACE FUNCTION es_staff_de(neg_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM negocios
        WHERE id = neg_id AND staff_uid IS NOT NULL AND staff_uid = auth.uid()
    );
$$;

-- 3) El colaborador puede LEER su propio negocio (nombre, config, etc.)
DROP POLICY IF EXISTS "staff_lee" ON negocios;
CREATE POLICY "staff_lee" ON negocios
    FOR SELECT
    USING (staff_uid IS NOT NULL AND staff_uid = auth.uid());

-- 4) Política "staff_acceso" en cada tabla del negocio (se suma a "own").
DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY[
        'capturas_pendientes','clientes','cortes','depositos','entradas_log',
        'gastos','gastos_cats_custom','gf_fijos','gf_nomina_params','gf_nominas',
        'inventarios','kpi_targets','negocio_insumos','negocio_sucursales',
        'pairing_sesiones','permisos','previsiones','proveedores','recetas',
        'req_historial','req_pedido','sf_metas','sf_otros','staff',
        'tarjetas_credito','ventas_extra','ventas_productos'
    ];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = t)
        THEN
            EXECUTE format('DROP POLICY IF EXISTS "staff_acceso" ON public.%I', t);
            EXECUTE format(
                'CREATE POLICY "staff_acceso" ON public.%I FOR ALL ' ||
                'USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id))', t);
        END IF;
    END LOOP;
END $$;
