-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v43 — Fecha de cobro y días de tolerancia
--
-- Hasta ahora una suscripción solo sabía HASTA CUÁNDO estaba pagada
-- (activa_hasta) y se cortaba en seco al vencer. Falta lo que pide
-- cualquier cobro recurrente:
--
--   · DÍA DE COBRO: el ancla del mes (el 15, el último día, etc.).
--     Se conserva aunque un mes sea corto — un negocio anclado al 31
--     cobra el 28 en febrero y VUELVE al 31 en marzo. Ir sumando
--     "un mes" sobre la última fecha cobrada pierde el ancla y en
--     medio año el cobro se recorre solo.
--   · DÍAS DE TOLERANCIA: la ventana entre "venció" y "se corta".
--     Sin ella, un pago que entra un día tarde deja al restaurante
--     sin sistema en plena operación.
--
-- La REGLA vive aquí (negocio_esta_activo es SECURITY DEFINER y es lo
-- que el gate consulta de verdad). El navegador tiene la misma fórmula
-- en /etaax-core.js (EtaaxCore.estadoCobro) SOLO para lo que la
-- pantalla necesita decir: cuántos días quedan, si ya está en gracia.
-- Si un día cambia la regla, se cambia en los DOS lados; su test en
-- tests/money-tests.js (SUITE G) cacha el desajuste.
--
-- Preparada para Stripe: cuando el webhook confirme un pago, solo
-- empuja `proximo_cobro` un mes. Nada más cambia.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Columnas nuevas ───────────────────────────────────────────
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS dia_cobro       SMALLINT;
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS proximo_cobro   DATE;
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS dias_tolerancia SMALLINT NOT NULL DEFAULT 3;

-- El ancla es un día del mes; el recorte a meses cortos lo hace la función.
ALTER TABLE suscripciones DROP CONSTRAINT IF EXISTS suscripciones_dia_cobro_chk;
ALTER TABLE suscripciones ADD  CONSTRAINT suscripciones_dia_cobro_chk
    CHECK (dia_cobro IS NULL OR (dia_cobro BETWEEN 1 AND 31));

ALTER TABLE suscripciones DROP CONSTRAINT IF EXISTS suscripciones_tolerancia_chk;
ALTER TABLE suscripciones ADD  CONSTRAINT suscripciones_tolerancia_chk
    CHECK (dias_tolerancia BETWEEN 0 AND 60);

-- Columnas de Stripe, ya listas para la fase 2 (vacías por ahora). Se agregan
-- desde ya para que conectar el cobro NO obligue a otra migración con datos
-- reales encima.
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS ultimo_pago_at         TIMESTAMPTZ;

-- ── 2. Backfill de lo que ya existe ──────────────────────────────
-- Los negocios activos hoy conservan su fecha: proximo_cobro = activa_hasta,
-- y el ancla se toma de ese mismo día. Nadie se bloquea por la migración.
UPDATE suscripciones
   SET proximo_cobro = activa_hasta::date
 WHERE proximo_cobro IS NULL AND activa_hasta IS NOT NULL;

UPDATE suscripciones
   SET dia_cobro = EXTRACT(DAY FROM proximo_cobro)::smallint
 WHERE dia_cobro IS NULL AND proximo_cobro IS NOT NULL;

-- ── 3. Siguiente fecha de cobro respetando el ancla ──────────────
-- Espejo de EtaaxCore.proximoCobro. `make_date` reventaría con el 31 de
-- febrero, así que el día se recorta al último del mes destino.
CREATE OR REPLACE FUNCTION etaax_proximo_cobro(p_dia SMALLINT, p_desde DATE)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_dia   SMALLINT := LEAST(31, GREATEST(1, COALESCE(p_dia, 1)));
    v_base  DATE     := COALESCE(p_desde, CURRENT_DATE);
    v_cand  DATE;
    v_ultimo SMALLINT;
BEGIN
    -- Candidato en el mes de la fecha base
    v_ultimo := EXTRACT(DAY FROM (date_trunc('month', v_base) + interval '1 month - 1 day'))::smallint;
    v_cand   := date_trunc('month', v_base)::date + (LEAST(v_dia, v_ultimo) - 1);
    IF v_cand > v_base THEN
        RETURN v_cand;
    END IF;
    -- Ya pasó (o es hoy) → mes siguiente, recortando otra vez
    v_base   := (date_trunc('month', v_base) + interval '1 month')::date;
    v_ultimo := EXTRACT(DAY FROM (date_trunc('month', v_base) + interval '1 month - 1 day'))::smallint;
    RETURN date_trunc('month', v_base)::date + (LEAST(v_dia, v_ultimo) - 1);
END;
$$;

-- ── 4. LA REGLA: ¿este negocio puede operar? ─────────────────────
-- activo = no cancelada, con fecha de corte, y hoy <= corte + tolerancia.
-- Se conserva el camino viejo (activa_hasta) para las filas que aún no tengan
-- proximo_cobro: correr esta migración no puede apagar a nadie.
CREATE OR REPLACE FUNCTION negocio_esta_activo(p_neg TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((
        SELECT estado = 'activa'
           AND COALESCE(proximo_cobro, activa_hasta::date) IS NOT NULL
           AND (COALESCE(proximo_cobro, activa_hasta::date)
                + COALESCE(dias_tolerancia, 0)) >= CURRENT_DATE
          FROM suscripciones WHERE negocio_id = p_neg
    ), false);
$$;

GRANT EXECUTE ON FUNCTION negocio_esta_activo(TEXT) TO authenticated;

-- ── 5. Detalle para la pantalla ──────────────────────────────────
-- El gate solo necesita un booleano, pero la pantalla de bloqueo tiene que
-- poder decir "te quedan 2 días" sin depender de que la cuenta alcance a leer
-- su propia fila por RLS (el mismo motivo por el que existe la RPC del gate).
-- Devuelve SOLO lo del negocio que se pregunta y nada sensible.
CREATE OR REPLACE FUNCTION negocio_cobro_estado(p_neg TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE((
        SELECT jsonb_build_object(
            'estado',         s.estado,
            'proximoCobro',   COALESCE(s.proximo_cobro, s.activa_hasta::date),
            'diaCobro',       s.dia_cobro,
            'diasTolerancia', COALESCE(s.dias_tolerancia, 0),
            'activo',         negocio_esta_activo(p_neg),
            'diasRestantes',  (COALESCE(s.proximo_cobro, s.activa_hasta::date)
                               + COALESCE(s.dias_tolerancia, 0)) - CURRENT_DATE
        )
        FROM suscripciones s WHERE s.negocio_id = p_neg
    ), jsonb_build_object('estado', 'pendiente', 'activo', false));
$$;

GRANT EXECUTE ON FUNCTION negocio_cobro_estado(TEXT) TO authenticated;

-- ── 6. Comprobación rápida tras correrla ─────────────────────────
-- SELECT negocio_id, estado, proximo_cobro, dia_cobro, dias_tolerancia,
--        negocio_esta_activo(negocio_id) AS activo
--   FROM suscripciones ORDER BY proximo_cobro;
--
-- Y el recorte de meses cortos:
-- SELECT etaax_proximo_cobro(31, DATE '2026-02-05');  -- 2026-02-28
-- SELECT etaax_proximo_cobro(31, DATE '2028-02-05');  -- 2028-02-29 (bisiesto)
-- SELECT etaax_proximo_cobro(31, DATE '2026-02-28');  -- 2026-03-31 (vuelve al ancla)
