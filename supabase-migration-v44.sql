-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v44 — Registro de pagos (Stripe)
--
-- La Edge Function que escucha a Stripe NO decide nada: verifica la
-- firma del webhook y llama a `registrar_pago_suscripcion`. Toda la
-- regla de negocio —cuánto se extiende, desde qué fecha, qué pasa si
-- el pago llega dos veces— vive AQUÍ, junto a `negocio_esta_activo` y
-- `etaax_proximo_cobro` (v43). Una sola verdad, y del lado que no se
-- puede saltar desde el navegador.
--
-- IDEMPOTENCIA: Stripe reintenta los webhooks. El mismo pago puede
-- llegar dos, tres veces — y también llega duplicado si la función
-- tarda en responder. Sin protección, cada reintento regalaría otro
-- mes. Por eso el id del evento de Stripe es LLAVE PRIMARIA: el
-- segundo intento no hace nada y responde "ya estaba".
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Bitácora de eventos de cobro ──────────────────────────────
-- Es el respaldo de por qué una suscripción tiene la fecha que tiene.
-- Sin esto, un "¿por qué se le extendió a este negocio?" no se puede
-- contestar: en Stripe está el cargo, pero no qué hizo ETAAX con él.
CREATE TABLE IF NOT EXISTS pagos_suscripcion (
    evento_id   TEXT PRIMARY KEY,          -- id del evento de Stripe (evt_...) → idempotencia
    negocio_id  TEXT REFERENCES negocios(id) ON DELETE SET NULL,
    tipo        TEXT NOT NULL,             -- checkout.session.completed | invoice.paid | ...
    monto       NUMERIC,                   -- en la moneda de abajo (ya en pesos, no en centavos)
    moneda      TEXT DEFAULT 'mxn',
    customer    TEXT,                      -- cus_...
    suscripcion TEXT,                      -- sub_... (vacío mientras se cobre por link)
    corte_antes DATE,                       -- fecha de corte ANTES de aplicar el pago
    corte_despues DATE,                     -- y después: la extensión queda a la vista
    resultado   TEXT,                      -- aplicado | duplicado | sin_negocio | ignorado
    payload     JSONB,                     -- lo crudo, por si hay que auditar
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pagos_suscripcion_neg_idx
    ON pagos_suscripcion (negocio_id, created_at DESC);

ALTER TABLE pagos_suscripcion ENABLE ROW LEVEL SECURITY;

-- Solo el admin de plataforma lee esto desde el cliente. La función de abajo es
-- SECURITY DEFINER, así que escribe sin depender de estas políticas.
DROP POLICY IF EXISTS "admin_all" ON pagos_suscripcion;
CREATE POLICY "admin_all" ON pagos_suscripcion
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- ── 2. Aplicar un pago ───────────────────────────────────────────
-- Devuelve JSONB con lo que hizo, para que la Edge Function lo registre en su log
-- y Stripe reciba un 200 con sentido.
--
-- DESDE QUÉ FECHA SE EXTIENDE. Si el negocio todavía está al corriente, desde su
-- fecha de corte (no se le regala ni se le quita tiempo por pagar antes). Si ya
-- venció, desde HOY — extender desde una fecha vieja le cobraría un mes que se
-- consumiría en días, que es el error clásico de las prórrogas.
CREATE OR REPLACE FUNCTION registrar_pago_suscripcion(
    p_evento       TEXT,
    p_neg          TEXT,
    p_tipo         TEXT,
    p_monto        NUMERIC DEFAULT NULL,
    p_moneda       TEXT    DEFAULT 'mxn',
    p_customer     TEXT    DEFAULT NULL,
    p_suscripcion  TEXT    DEFAULT NULL,
    p_meses        INT     DEFAULT 1,
    p_payload      JSONB   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sub        suscripciones%ROWTYPE;
    v_ancla      SMALLINT;
    v_desde      DATE;
    v_nuevo      DATE;
    v_antes      DATE;
    v_i          INT;
    v_existe     BOOLEAN;
BEGIN
    IF p_evento IS NULL OR p_evento = '' THEN
        RETURN jsonb_build_object('resultado', 'ignorado', 'motivo', 'sin id de evento');
    END IF;

    -- Idempotencia: si ya se procesó, no se toca nada.
    SELECT EXISTS(SELECT 1 FROM pagos_suscripcion WHERE evento_id = p_evento) INTO v_existe;
    IF v_existe THEN
        RETURN jsonb_build_object('resultado', 'duplicado', 'evento', p_evento);
    END IF;

    -- ¿Sabemos de qué negocio es? El link de pago lo manda en client_reference_id.
    -- Sin él no hay a quién aplicarle el mes: se registra igual para no perder el
    -- rastro del cobro, y se resuelve a mano desde el panel.
    IF p_neg IS NULL OR p_neg = '' OR NOT EXISTS(SELECT 1 FROM negocios WHERE id = p_neg) THEN
        INSERT INTO pagos_suscripcion (evento_id, negocio_id, tipo, monto, moneda, customer,
                                       suscripcion, resultado, payload)
        VALUES (p_evento, NULL, p_tipo, p_monto, p_moneda, p_customer,
                p_suscripcion, 'sin_negocio', p_payload);
        RETURN jsonb_build_object('resultado', 'sin_negocio', 'negocio', p_neg);
    END IF;

    SELECT * INTO v_sub FROM suscripciones WHERE negocio_id = p_neg;
    v_antes := COALESCE(v_sub.proximo_cobro, v_sub.activa_hasta::date);

    -- Eventos que NO extienden: se dejan asentados y ya. El pago fallido no corta
    -- nada por sí solo — de eso se encargan los días de tolerancia de v43.
    IF p_tipo IN ('invoice.payment_failed', 'customer.subscription.deleted') THEN
        IF p_tipo = 'customer.subscription.deleted' THEN
            UPDATE suscripciones SET estado = 'cancelada', updated_at = now()
             WHERE negocio_id = p_neg;
        END IF;
        INSERT INTO pagos_suscripcion (evento_id, negocio_id, tipo, monto, moneda, customer,
                                       suscripcion, corte_antes, corte_despues, resultado, payload)
        VALUES (p_evento, p_neg, p_tipo, p_monto, p_moneda, p_customer, p_suscripcion,
                v_antes, v_antes, 'ignorado', p_payload);
        RETURN jsonb_build_object('resultado', 'ignorado', 'tipo', p_tipo);
    END IF;

    -- Ancla: la que ya tenía; si es su primer pago, el día de hoy.
    v_ancla := COALESCE(v_sub.dia_cobro, EXTRACT(DAY FROM CURRENT_DATE)::smallint);

    -- Al corriente (contando tolerancia) → desde su corte. Vencido → desde hoy.
    IF v_antes IS NOT NULL
       AND (v_antes + COALESCE(v_sub.dias_tolerancia, 0)) >= CURRENT_DATE THEN
        v_desde := v_antes;
    ELSE
        v_desde := CURRENT_DATE;
    END IF;

    -- Un salto por mes pagado, siempre respetando el ancla (v43).
    v_nuevo := v_desde;
    FOR v_i IN 1..GREATEST(1, COALESCE(p_meses, 1)) LOOP
        v_nuevo := etaax_proximo_cobro(v_ancla, v_nuevo);
    END LOOP;

    INSERT INTO suscripciones (negocio_id, estado, proximo_cobro, dia_cobro, dias_tolerancia,
                               activa_hasta, activada_at, ultimo_pago_at,
                               stripe_customer_id, stripe_subscription_id, updated_at)
    VALUES (p_neg, 'activa', v_nuevo, v_ancla, 3,
            v_nuevo::timestamptz, now(), now(),
            p_customer, p_suscripcion, now())
    ON CONFLICT (negocio_id) DO UPDATE SET
        estado                 = 'activa',
        proximo_cobro          = EXCLUDED.proximo_cobro,
        dia_cobro              = COALESCE(suscripciones.dia_cobro, EXCLUDED.dia_cobro),
        activa_hasta           = EXCLUDED.activa_hasta,
        activada_at            = now(),
        ultimo_pago_at         = now(),
        -- No se pisan con NULL: un invoice.paid puede no traer customer.
        stripe_customer_id     = COALESCE(EXCLUDED.stripe_customer_id, suscripciones.stripe_customer_id),
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, suscripciones.stripe_subscription_id),
        updated_at             = now();

    INSERT INTO pagos_suscripcion (evento_id, negocio_id, tipo, monto, moneda, customer,
                                   suscripcion, corte_antes, corte_despues, resultado, payload)
    VALUES (p_evento, p_neg, p_tipo, p_monto, p_moneda, p_customer, p_suscripcion,
            v_antes, v_nuevo, 'aplicado', p_payload);

    RETURN jsonb_build_object('resultado', 'aplicado', 'negocio', p_neg,
                              'corteAntes', v_antes, 'corteDespues', v_nuevo);
END;
$$;

-- Solo el rol de servicio (la Edge Function) la ejecuta. NADIE desde el navegador:
-- sería auto-activarse la suscripción sin pagar.
REVOKE ALL ON FUNCTION registrar_pago_suscripcion(TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,INT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION registrar_pago_suscripcion(TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,INT,JSONB) FROM anon;
REVOKE ALL ON FUNCTION registrar_pago_suscripcion(TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,INT,JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION registrar_pago_suscripcion(TEXT,TEXT,TEXT,NUMERIC,TEXT,TEXT,TEXT,INT,JSONB) TO service_role;

-- ── 3. Comprobación tras correrla ────────────────────────────────
-- Simular un pago (cambia el id del negocio por uno real):
--   SELECT registrar_pago_suscripcion('evt_prueba_1', 'NEG_ID', 'checkout.session.completed',
--                                     1799, 'mxn', 'cus_x', NULL, 1, NULL);
-- Correrlo DOS veces: la segunda debe responder "duplicado" y NO mover la fecha.
--   SELECT evento_id, resultado, corte_antes, corte_despues FROM pagos_suscripcion
--    ORDER BY created_at DESC LIMIT 5;
-- Limpiar la prueba:
--   DELETE FROM pagos_suscripcion WHERE evento_id LIKE 'evt_prueba_%';
