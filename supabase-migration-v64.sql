-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · v64 — El perfil del QR devuelve el ROL y el área SIN rellenar
--
-- EL PROBLEMA. portal_perfil devolvía el área así:
--
--     'area', COALESCE(NULLIF(s.datos->>'area',''), 'administracion')
--
-- Ese relleno tenía sentido para el recetario (sin área capturada, mejor no
-- abrir de más), pero el QR de entradas lo leía como si fuera un dato: un
-- barman con rol «barman» y puesto «Barman» salía como ADMINISTRACIÓN —porque
-- el campo `area` casi nunca se llena a mano— y entonces veía las tres áreas y
-- el inventario entero del negocio.
--
-- El área de un colaborador ya se resuelve en un solo lugar del cliente
-- (staff-area.js): campo `area` a mano → ROL del sistema → PUESTO escrito. Lo
-- único que faltaba era que la consulta entregara las tres piezas en vez de una
-- sola ya masticada.
--
-- QUÉ CAMBIA: se agregan `areaReal` (el campo tal cual, puede venir vacío) y
-- `rol`. `area` se queda IGUAL, con su relleno, porque portal_recetas y
-- portal_guias lo leen y cambiarles el default les abriría contenido a quien
-- hoy no lo ve.
--
-- Idempotente: CREATE OR REPLACE. No toca datos.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION portal_perfil(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'nombre',   s.datos->>'nombre',
        'puesto',   s.datos->>'puesto',
        -- El ROL del sistema: lista cerrada, no se presta a interpretación.
        -- Es el segundo escalón de la jerarquía del cliente.
        'rol',      s.datos->>'rol',
        -- El campo TAL CUAL, sin rellenar: '' significa «no capturado», que es
        -- un hecho distinto de «administración» y el cliente necesita
        -- distinguirlos para poder caer al rol y al puesto.
        'areaReal', COALESCE(s.datos->>'area', ''),
        -- Se conserva con su relleno: portal_recetas y portal_guias deciden con
        -- este campo y bajarle el default les abriría contenido.
        'area',     COALESCE(NULLIF(s.datos->>'area',''), 'administracion')
    )
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
      AND p_niphash IS NOT NULL AND p_niphash <> ''
      AND _entrada_token_ok(p_neg, p_token)
    LIMIT 1;
$$;
