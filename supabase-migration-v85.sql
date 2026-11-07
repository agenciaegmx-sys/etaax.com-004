-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v85 — El recibo de nómina deja de depender del gasto
--
-- Hasta hoy, para que existiera un recibo tenía que existir primero el gasto:
-- el modal de nómina terminaba empujándote al modal de pago y, si no lo
-- concluías, lo capturado se perdía. No se podían preparar las dieciséis
-- nóminas de la semana, revisarlas y pagarlas después.
--
-- Esta tabla le da casa propia al recibo. Nace al GENERARLO (sin gasto, sin
-- dinero, sin tocar caja ni reportes) y cuando se paga se le pega su gasto
-- (`gastoId` + `pagadoEn`). Mientras no tenga gasto, para el resto del sistema
-- no existe: ni suma en el panel, ni aparece en la lista de gastos, ni entra
-- en KPIs. Eso es justo lo que se gana con una tabla aparte en vez de un
-- "gasto pendiente".
--
-- Patrón de siempre: id / negocio_id / datos JSONB. Lo que vive en `datos`:
--   { staffId, sucursalId, desde, hasta, recibo:{…}, gastoId, pagadoEn, updated }
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS nomina_recibos (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Las dos preguntas que hace la pantalla: "los recibos de esta persona" y
-- "los de este periodo". Sin índice, cada apertura del selector recorre la
-- tabla entera por cada colaborador de la lista.
CREATE INDEX IF NOT EXISTS nomina_recibos_neg_staff_idx
    ON nomina_recibos (negocio_id, (datos->>'staffId'));
CREATE INDEX IF NOT EXISTS nomina_recibos_neg_desde_idx
    ON nomina_recibos (negocio_id, (datos->>'desde'));

ALTER TABLE nomina_recibos ENABLE ROW LEVEL SECURITY;

-- Mismas tres puertas que el resto de las tablas del negocio. `es_staff_de`
-- hace falta: quien paga nóminas suele entrar con cuenta de colaborador, y sin
-- esta política el selector le saldría vacío —que es como se perdieron los
-- horarios en la v19 (ver v54).
DROP POLICY IF EXISTS "own"          ON nomina_recibos;
DROP POLICY IF EXISTS "staff_acceso" ON nomina_recibos;
DROP POLICY IF EXISTS "admin_all"    ON nomina_recibos;

CREATE POLICY "own" ON nomina_recibos FOR ALL
    USING      (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

CREATE POLICY "staff_acceso" ON nomina_recibos FOR ALL
    USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id));

CREATE POLICY "admin_all" ON nomina_recibos FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Un recibo no puede cambiar de negocio: sería mudarle el sueldo de una
-- persona a otra empresa. Mismo candado que la v84 le puso a horarios.
CREATE OR REPLACE FUNCTION _nomina_recibo_guardia()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.negocio_id IS DISTINCT FROM OLD.negocio_id THEN
        RAISE EXCEPTION 'El recibo no puede cambiar de negocio' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS nomina_recibos_guardia ON nomina_recibos;
CREATE TRIGGER nomina_recibos_guardia BEFORE INSERT OR UPDATE ON nomina_recibos
    FOR EACH ROW EXECUTE FUNCTION _nomina_recibo_guardia();

COMMIT;
