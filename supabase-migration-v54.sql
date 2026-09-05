-- ============================================================================
-- ETAAX — Migración v54: el colaborador también puede guardar en las tablas
--                        nacidas después de la v19
-- ----------------------------------------------------------------------------
-- QUÉ PASÓ
-- La v19 le dio acceso a la cuenta compartida del negocio (staff_acceso) a 27
-- tablas, con un bucle sobre una lista fija. Toda tabla creada DESPUÉS quedó
-- fuera, y nadie volvió a mirar esa lista: horarios (v33), checklists (v34),
-- inv_ajustes (v37), conteos por QR (v42)…
--
-- Consecuencia: un gerente o un colaborador que entra con SU usuario captura los
-- horarios de la semana, los ve en pantalla, los exporta… y no se guardan en la
-- nube, porque la política los rechaza. Viven en ese navegador hasta que algo
-- los pisa, y entonces "se borraron".
--
-- LA LISTA YA NO SE ESCRIBE A MANO. Se recorren TODAS las tablas de `public`
-- que tengan una columna `negocio_id` y les falte la política. Así, la próxima
-- tabla que se cree no vuelve a quedarse fuera por olvido — que fue exactamente
-- lo que pasó cinco veces seguidas.
--
-- No toca las que ya la tienen ni cambia ninguna otra política: `own` y
-- `admin_all` siguen igual. Solo AGREGA el acceso del staff.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

DO $$
DECLARE
    t TEXT;
    n INT := 0;
BEGIN
    FOR t IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = 'public'
           AND c.relkind = 'r'
           -- Tiene negocio_id: es de un negocio, luego su staff debe poder usarla.
           AND EXISTS (SELECT 1 FROM information_schema.columns col
                        WHERE col.table_schema = 'public'
                          AND col.table_name = c.relname
                          AND col.column_name = 'negocio_id')
           -- Y todavía no tiene la política.
           AND NOT EXISTS (SELECT 1 FROM pg_policy p
                            WHERE p.polrelid = c.oid AND p.polname = 'staff_acceso')
    LOOP
        EXECUTE format(
            'CREATE POLICY "staff_acceso" ON public.%I FOR ALL ' ||
            'USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id))', t);
        n := n + 1;
        RAISE NOTICE 'staff_acceso agregada a %', t;
    END LOOP;
    RAISE NOTICE 'v54: % tabla(s) actualizadas', n;
END $$;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Qué tablas de negocio siguen SIN acceso de colaborador (debe salir vacío):
--   SELECT c.relname
--     FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
--    WHERE ns.nspname='public' AND c.relkind='r'
--      AND EXISTS (SELECT 1 FROM information_schema.columns col
--                   WHERE col.table_schema='public' AND col.table_name=c.relname
--                     AND col.column_name='negocio_id')
--      AND NOT EXISTS (SELECT 1 FROM pg_policy p
--                       WHERE p.polrelid=c.oid AND p.polname='staff_acceso')
--    ORDER BY 1;
-- ============================================================================
-- Fin v54.
-- ============================================================================
