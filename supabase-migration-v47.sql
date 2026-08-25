-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v47 — El área del colaborador se DERIVA de su rol
--
-- v46 leía un campo `area` que había que llenar a mano por cada
-- colaborador. Sobra: el "Rol del sistema" ya es una lista fija que
-- casi siempre dice el área — Chef y Cocinero son cocina, Barman y
-- Barista son barra, Mesero es piso.
--
-- Pedir un campo aparte era trabajo de a gratis y, peor, se podían
-- contradecir: "Rol: Barman · Área: Cocina". ¿Cuál manda?
--
-- Ahora: se DERIVA del rol, y `area` queda solo como CORRECCIÓN para
-- los casos que no encajan (un gerente que en realidad lleva la
-- barra, un "Otro" que lava loza en la cocina).
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION etaax_area_de_rol(p_rol TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE lower(COALESCE(p_rol,''))
        WHEN 'chef'           THEN 'cocina'
        WHEN 'jefe_cocina'    THEN 'cocina'
        WHEN 'cocinero'       THEN 'cocina'
        WHEN 'jefe_barra'     THEN 'barra'
        WHEN 'barman'         THEN 'barra'
        WHEN 'barista'        THEN 'barra'
        WHEN 'mesero'         THEN 'piso'
        WHEN 'admin'          THEN 'administracion'
        WHEN 'gerente'        THEN 'administracion'
        WHEN 'administrativo' THEN 'administracion'
        ELSE ''   -- 'otro' o sin rol: no se adivina, se corrige a mano
    END;
$$;

-- El perfil que lee el portal. Prioridad: la corrección manual (`area`) manda
-- sobre lo derivado del rol. Si no hay ninguna de las dos, cae en
-- 'administracion', que es lo más restrictivo en lo operativo: a quien no se
-- configuró no se le abre de más por descuido.
CREATE OR REPLACE FUNCTION portal_perfil(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'nombre', s.datos->>'nombre',
        'puesto', s.datos->>'puesto',
        'rol',    s.datos->>'rol',
        'area',   COALESCE(
                    NULLIF(s.datos->>'area', ''),                        -- corrección manual
                    NULLIF(etaax_area_de_rol(s.datos->>'rol'), ''),      -- derivada del rol
                    'administracion'                                     -- último recurso
                  )
    )
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
      AND p_niphash IS NOT NULL AND p_niphash <> ''
      AND _entrada_token_ok(p_neg, p_token)
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION portal_perfil(TEXT,TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION etaax_area_de_rol(TEXT)       TO anon, authenticated;

-- ── Comprobación ─────────────────────────────────────────────────
-- Quién queda en qué área, sin tocar nada:
--   SELECT s.datos->>'nombre' AS quien, s.datos->>'rol' AS rol,
--          COALESCE(NULLIF(s.datos->>'area',''),
--                   NULLIF(etaax_area_de_rol(s.datos->>'rol'),''),
--                   'administracion') AS area
--     FROM staff s ORDER BY area, quien;
