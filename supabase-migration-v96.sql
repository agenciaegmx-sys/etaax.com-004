-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v96 — Guías de uso en la app móvil (26-nov)
--
-- Edwin: «quiero poner un tutorial en video y en PDF abajo de los dos
-- módulos de Cost·ax y Equip·ax en el acceso de clave; el botón de subir
-- tutoriales a la app móvil debe estar en el panel admin».
--
-- No hace falta tabla nueva: las guías ya son de la PLATAFORMA (v45, tabla
-- `guias`, sin negocio). Las de la app se distinguen por su `modulo`:
--     'movil_costax'  → debajo de Cost·ax
--     'movil_equipax' → debajo de Equip·ax
-- El admin las sube desde el panel (admin-guias-movil.js) a `evidencias/_guias/`
-- —la ruta que la v45 ya abre a escritura solo para el admin de plataforma— o
-- pega un enlace de YouTube.
--
-- La app entra con la CLAVE (anon, sin sesión), así que no puede leer `guias`
-- (solo `authenticated`). Esta función se las da, con el mismo candado de
-- siempre: token de la sucursal + NIP de alguien activo (_nip_guardia y
-- _portal_quien, v91). Solo devuelve las de la app y solo las activas.
--
-- Idempotente: se puede correr varias veces.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION portal_guias_movil(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s staff;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN NULL; END IF;
    v_s := _portal_quien(p_neg, p_token, p_niphash);
    IF v_s.id IS NULL THEN RETURN NULL; END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', g.id, 'titulo', g.titulo, 'descripcion', g.descripcion,
                   'tipo', g.tipo, 'url', g.url, 'modulo', g.modulo, 'orden', g.orden)
               ORDER BY g.modulo, g.orden, g.created_at)
        FROM guias g
        WHERE g.activa AND g.modulo IN ('movil_costax', 'movil_equipax')
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION portal_guias_movil(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_guias_movil(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── Comprobación tras correrla ───────────────────────────────────
-- SELECT id, titulo, tipo, modulo, activa FROM guias WHERE modulo LIKE 'movil\_%' ORDER BY modulo, orden;
