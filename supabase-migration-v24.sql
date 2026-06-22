-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v24 — Suscripciones (activación manual por negocio)
--
-- Objetivo: bloquear el uso gratis. Cada negocio tiene un estado de
-- suscripción que SOLO el admin maestro puede cambiar desde admin.html.
-- El dueño (y sus colaboradores) pueden LEER su estado para saber si
-- están activos, pero NO pueden modificarlo (no auto-activarse).
--
-- Flujo V1 (pago manual a Edwin): el usuario se registra → queda
-- 'pendiente' → contacta a Edwin → Edwin activa 1 mes desde el panel.
-- Cuando luego se conecten pagos con tarjeta, solo se automatiza el
-- "Activar 1 mes"; esta estructura no cambia.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS suscripciones (
    negocio_id   TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    estado       TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | activa | vencida | cancelada
    activa_hasta TIMESTAMPTZ,                          -- fecha de corte (NULL si nunca se ha activado)
    activada_at  TIMESTAMPTZ,                          -- última vez que se activó/extendió
    notas        TEXT,                                 -- notas internas del admin (opcional)
    updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE suscripciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all"   ON suscripciones;
DROP POLICY IF EXISTS "own_read"    ON suscripciones;
DROP POLICY IF EXISTS "staff_read"  ON suscripciones;

-- Admin maestro: control total (activar, extender, cancelar).
CREATE POLICY "admin_all" ON suscripciones
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Dueño del negocio: SOLO lectura (para que la app sepa si está activo).
CREATE POLICY "own_read" ON suscripciones
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid())
    );

-- Colaboradores (cuenta de staff del negocio, v19): SOLO lectura, para que
-- también se les bloquee el acceso si el negocio no está al corriente.
CREATE POLICY "staff_read" ON suscripciones
    FOR SELECT USING ( es_staff_de(negocio_id) );

-- ── Grandfather: los negocios que YA existen no deben bloquearse al desplegar ──
-- Se les da 1 mes activo desde ahora (ajusta cada uno desde el panel admin).
-- Idempotente: ON CONFLICT DO NOTHING → no pisa suscripciones ya creadas, y los
-- negocios NUEVOS (creados después de esta migración) nacen SIN fila = 'pendiente'.
INSERT INTO suscripciones (negocio_id, estado, activa_hasta, activada_at)
SELECT id, 'activa', now() + interval '1 month', now()
FROM negocios
ON CONFLICT (negocio_id) DO NOTHING;

-- Helper para endurecer la RLS de las tablas de datos en el futuro
-- (todavía NO se usa en ninguna política: el bloqueo V1 es del lado app).
CREATE OR REPLACE FUNCTION negocio_esta_activo(p_neg TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        (SELECT estado = 'activa' AND activa_hasta IS NOT NULL AND activa_hasta > now()
           FROM suscripciones WHERE negocio_id = p_neg),
        false
    );
$$;
