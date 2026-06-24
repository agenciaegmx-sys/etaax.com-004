-- ═══════════════════════════════════════════════════════════════
-- ETAAX · Migración v26 — Ventana del QR de captura a 5 minutos
--
-- Problema: el QR para subir foto desde el celular caducaba muy rápido.
-- La función token_pairing_valido (v14) exigía created_at > NOW() - 1 minuto,
-- así que aunque el cliente mostrara más tiempo, el servidor RECHAZABA la
-- subida pasado 1 minuto. Combinado con que el código se regeneraba cada 55s,
-- a veces solo quedaban segundos al escanear.
--
-- Esta migración sube la ventana del servidor a 5 minutos. El cliente
-- (qr-pairing.js y captura.html) se ajusta al mismo valor (VIDA_MS=300000).
--
-- Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION token_pairing_valido(t TEXT, negid TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM pairing_sesiones
        WHERE token = t AND negocio_id = negid
          AND created_at > NOW() - INTERVAL '5 minutes'
    );
$$;
