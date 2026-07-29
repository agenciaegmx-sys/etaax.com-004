-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v39 — Realtime para inv_ajustes (compuestos + bateo)
-- Idempotente. Correr a mano en Supabase → SQL Editor.
--
-- La tabla inv_ajustes (v37) guarda los productos COMPUESTOS y los insumos de
-- BATEO por negocio. v37 creó la tabla pero NO la agregó a la publicación de
-- realtime, así que al crear un compuesto en un dispositivo NO aparecía en vivo
-- en los demás (solo al recargar). Esto lo habilita.
--
-- Requiere que v37 ya se haya corrido (tabla inv_ajustes existente).
-- ════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname='supabase_realtime' AND tablename='inv_ajustes'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE inv_ajustes;
    END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- Fin v39. Con esto, crear/editar compuestos o marcar bateo se sincroniza en
-- vivo entre dispositivos (inventarios.js: _subAjustesRealtime).
-- ════════════════════════════════════════════════════════════════
