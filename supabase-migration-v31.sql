-- ============================================================================
-- ETAAX — Migración v31: PAPELERA de reciclaje (respaldo de registros borrados)
-- ----------------------------------------------------------------------------
-- Todo registro ELIMINADO de las tablas cubiertas se copia automáticamente a la
-- tabla `papelera` (trigger en el servidor: captura cualquier borrado, venga del
-- módulo que venga, incluso masivo). Retención: 60 días (mínimo pedido: 30).
--
-- Tablas cubiertas en esta fase: cortes, gastos, depositos, staff, clientes,
-- proveedores, recetas (incluye sub-recetas: viven en la misma tabla).
-- (Inventarios e insumos se suman en una fase posterior.)
--
-- Si un registro con el MISMO id vuelve a insertarse (restaurado, o el guardado
-- de staff que reescribe la lista completa borrando+insertando), su entrada en
-- la papelera se limpia sola → la papelera solo muestra borrados REALES.
--
-- La página /admin-papelera.html (SOLO admin maestro) lista y restaura por negocio.
--
-- Idempotente: re-ejecutable sin error. Correr en: Supabase → SQL Editor.
-- ============================================================================

-- ── 1) Tabla papelera ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS papelera (
    id           BIGSERIAL PRIMARY KEY,
    negocio_id   TEXT NOT NULL,
    tabla        TEXT NOT NULL,          -- de qué tabla se borró
    registro_id  TEXT NOT NULL,          -- id original (el "folio" rastreable)
    datos        JSONB,                  -- el registro completo, tal cual estaba
    eliminado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS papelera_neg_idx ON papelera (negocio_id, eliminado_en DESC);
CREATE INDEX IF NOT EXISTS papelera_reg_idx ON papelera (tabla, registro_id);

ALTER TABLE papelera ENABLE ROW LEVEL SECURITY;
-- SOLO el admin maestro puede ver/restaurar la papelera: el dueño del negocio
-- y su staff NO tienen acceso (ni siquiera por consola) — la recuperación de
-- datos pasa por EGMx. Los triggers escriben con SECURITY DEFINER (no les
-- afecta el RLS).
DROP POLICY IF EXISTS "own" ON papelera;
DROP POLICY IF EXISTS "staff_acceso" ON papelera;
DROP POLICY IF EXISTS "admin_all" ON papelera;
CREATE POLICY "admin_all" ON papelera
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- ── 2) Trigger de CAPTURA: al borrar, copiar a la papelera ───────────────────
CREATE OR REPLACE FUNCTION _papelera_capturar()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF OLD.negocio_id IS NOT NULL AND OLD.id IS NOT NULL THEN
        INSERT INTO papelera (negocio_id, tabla, registro_id, datos)
        VALUES (OLD.negocio_id, TG_TABLE_NAME, OLD.id, OLD.datos);
    END IF;
    -- Poda de retención: fuera lo de más de 60 días (barato: la papelera es chica).
    DELETE FROM papelera WHERE eliminado_en < now() - interval '60 days';
    RETURN OLD;
END;
$$;

-- ── 3) Trigger de REVIVIDO: si el mismo id vuelve a existir, limpiar papelera ─
-- Clave para el guardado de staff (borra + reinserta toda la lista) y para las
-- restauraciones: solo los borrados REALES permanecen en la papelera.
CREATE OR REPLACE FUNCTION _papelera_revivido()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM papelera WHERE tabla = TG_TABLE_NAME AND registro_id = NEW.id;
    RETURN NEW;
END;
$$;

-- ── 4) Instalar triggers en las tablas cubiertas ─────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['cortes','gastos','depositos','staff','clientes','proveedores','recetas'] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS papelera_captura ON public.%I', t);
            EXECUTE format('CREATE TRIGGER papelera_captura AFTER DELETE ON public.%I ' ||
                           'FOR EACH ROW EXECUTE FUNCTION _papelera_capturar()', t);
            EXECUTE format('DROP TRIGGER IF EXISTS papelera_revive ON public.%I', t);
            EXECUTE format('CREATE TRIGGER papelera_revive AFTER INSERT ON public.%I ' ||
                           'FOR EACH ROW EXECUTE FUNCTION _papelera_revivido()', t);
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- Fin v31. Después de correrla:
--   · Todo borrado en cortes/gastos/depositos/staff/clientes/proveedores/recetas
--     queda respaldado 60 días en `papelera` con su id original como folio.
--   · Restaurar = volver a insertar el registro (la papelera se limpia sola).
-- ============================================================================
