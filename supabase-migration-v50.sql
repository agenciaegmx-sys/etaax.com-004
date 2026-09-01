-- ============================================================================
-- ETAAX — Migración v50: miniatura de las guías de uso
-- ----------------------------------------------------------------------------
-- Las tarjetas de las guías se ven todas iguales: un icono de PDF y un título.
-- Con cuatro guías se distinguen; con treinta, no. Una miniatura hace que se
-- reconozcan de un vistazo, como las de YouTube.
--
-- `miniatura` guarda la URL de una imagen en Storage (o la de YouTube, que se
-- deduce sola del id del video). Vacío = se sigue mostrando el icono, así que
-- ninguna guía existente cambia de aspecto hasta que se le ponga una.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

ALTER TABLE guias ADD COLUMN IF NOT EXISTS miniatura TEXT;

-- ── Comprobación ────────────────────────────────────────────────────────────
--   SELECT titulo, tipo,
--          CASE WHEN miniatura IS NULL OR miniatura = '' THEN 'sin miniatura'
--               ELSE 'con miniatura' END AS portada
--     FROM guias ORDER BY categoria, orden, titulo;
-- ============================================================================
-- Fin v50.
-- ============================================================================
