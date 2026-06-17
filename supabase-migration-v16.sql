-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v16 — Realtime (sync en vivo entre dispositivos)
-- Habilita la publicación supabase_realtime en las tablas clave para que
-- el servidor empuje los cambios y el otro dispositivo se actualice solo,
-- sin recargar. Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY['recetas', 'negocio_sucursales', 'negocio_insumos', 'cortes', 'gastos', 'inventarios'];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        -- Solo agrega si la tabla existe y aún no está en la publicación
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t)
           AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t)
        THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
