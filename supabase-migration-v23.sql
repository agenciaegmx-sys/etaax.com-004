-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v23 — Acceso de staff a tablas faltantes (insumos, evidencias)
--
-- Problema: v19 creó la política "staff_acceso" (que deja a la cuenta compartida
-- del colaborador leer/escribir los datos de SU negocio) en una lista de tablas,
-- pero olvidó incluir la tabla `insumos`. Consecuencia: un colaborador (gerente)
-- ve las recetas pero NO el catálogo de insumos → al crear una receta, el
-- autocompletado de ingredientes sale vacío.
--
-- Solución: agregar la política "staff_acceso" a `insumos` y `evidencias`
-- (mismas reglas que v19, vía la función es_staff_de(negocio_id) ya existente).
--
-- Requiere v19 (define es_staff_de). Correr en: Supabase → SQL Editor.
-- Idempotente y seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY['insumos','evidencias'];
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
