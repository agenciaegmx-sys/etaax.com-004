-- ============================================================================
-- ETAAX · Migración v35 — Fix del FALSO BLOQUEO del paywall de suscripción
-- ----------------------------------------------------------------------------
-- Síntoma: "Ir a Módulos" desde un módulo manda al hub y muestra "TU CUENTA
-- ESTÁ EN REVISIÓN" AUNQUE el negocio esté ACTIVA en el panel de admin.
--
-- Causa: el gate del hub (_leerSuscripcion) decide con un SELECT directo a
-- `suscripciones`. Cuando la RLS OCULTA la fila al que consulta —dueño cuyo
-- usuario_id no coincide con auth.uid(), cuenta de staff compartida cuyo
-- es_staff_de() no resuelve, o un admin de plataforma cuyo email no es el
-- ADMIN_EMAIL hardcodeado del front— el SELECT regresa 0 filas y el gate lo
-- interpreta como "pendiente" y bloquea un negocio que SÍ está al corriente.
--
-- Solución: exponer el estado ACTIVO real vía una función SECURITY DEFINER que
-- se salta la RLS de `suscripciones` y sólo devuelve un BOOLEANO (no filtra
-- ningún dato: recibe el negocio que ya operas y responde activo/no-activo). El
-- hub la usa como fuente autoritativa para decidir pasar/bloquear. El paywall
-- sigue en pie para negocios genuinamente pendientes (la función devuelve false).
--
-- Correr a mano en Supabase → SQL Editor. Idempotente (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION negocio_esta_activo(p_neg TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT estado = 'activa' AND activa_hasta IS NOT NULL AND activa_hasta > now()
           FROM suscripciones WHERE negocio_id = p_neg),
        false
    );
$$;

-- Cualquier usuario autenticado (dueño, staff o admin) puede consultar el estado
-- de un negocio que ya está operando. No expone datos: solo un booleano.
GRANT EXECUTE ON FUNCTION negocio_esta_activo(TEXT) TO authenticated;
