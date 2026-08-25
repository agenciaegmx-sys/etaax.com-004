-- ════════════════════════════════════════════════════════════════
-- ETAAX · Migración v46 — Portal del colaborador (QR + NIP)
--
-- El QR deja de ser "una lista de tareas" y pasa a ser la puerta del
-- colaborador: sus checklists, el recetario operativo y las guías de
-- uso. Todo filtrado por SU ÁREA.
--
-- POR QUÉ ESTO VA POR RPC Y NO POR RLS: el QR se abre SIN SESIÓN de
-- Supabase. El dispositivo es `anon`. Abrirle `recetas` o `guias` a
-- anon sería regalar el catálogo entero a cualquiera que escanee.
-- Cada cosa que el portal enseña sale por su propia función
-- SECURITY DEFINER que valida token + NIP y devuelve SOLO lo suyo.
--
-- Y LOS COSTOS NO SALEN. El recetario del portal va en vista
-- OPERATIVA: procedimiento y cantidades. Un QR pegado en la pared de
-- una cocina es un canal de baja seguridad — enseñar ahí los costos y
-- los proveedores sería regalar lo más sensible del negocio.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ════════════════════════════════════════════════════════════════

-- ── 1. Las guías se dividen por audiencia ────────────────────────
-- Un cocinero no necesita el manual de conciliación bancaria, y al dueño no le
-- sirve que su índice esté lleno de guías de barra. 'ambas' es el default para
-- que las que ya existen no desaparezcan de ningún lado al correr esto.
ALTER TABLE guias ADD COLUMN IF NOT EXISTS audiencia TEXT NOT NULL DEFAULT 'ambas';

ALTER TABLE guias DROP CONSTRAINT IF EXISTS guias_audiencia_chk;
ALTER TABLE guias ADD  CONSTRAINT guias_audiencia_chk
    CHECK (audiencia IN ('operativa','administrativa','ambas'));

-- ── 2. Quién es el del NIP (nombre + ÁREA) ───────────────────────
-- La función vieja `entrada_validar_nip` devuelve solo el nombre y la sigue
-- usando el QR de entradas. Esta devuelve el perfil completo que el portal
-- necesita para filtrar. Se deja la vieja intacta: cambiarle el tipo de retorno
-- rompería la captura de entradas, que ya está en producción.
CREATE OR REPLACE FUNCTION portal_perfil(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'nombre', s.datos->>'nombre',
        'puesto', s.datos->>'puesto',
        -- Sin área asignada se asume ADMINISTRACIÓN, que es la más restrictiva en
        -- lo operativo: ve guías administrativas y ningún recetario de área. Así,
        -- a un colaborador sin configurar no se le abre de más por descuido.
        'area',   COALESCE(NULLIF(s.datos->>'area',''), 'administracion')
    )
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
      AND p_niphash IS NOT NULL AND p_niphash <> ''
      AND _entrada_token_ok(p_neg, p_token)
    LIMIT 1;
$$;

-- ── 3. Recetario OPERATIVO del área ──────────────────────────────
-- Devuelve las recetas sin nada de dinero. El filtro por área usa el tipo de la
-- receta, que es la misma regla del inventario: bebidas → barra, alimentos →
-- cocina. Administración y piso no reciben recetario (no cocinan).
CREATE OR REPLACE FUNCTION portal_recetas(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_area TEXT;
BEGIN
    v_area := (portal_perfil(p_neg, p_token, p_niphash))->>'area';
    IF v_area IS NULL THEN RETURN; END IF;   -- NIP o token inválido: nada

    RETURN QUERY
    SELECT jsonb_build_object(
        'id',            r.datos->>'id',
        'nombre',        r.datos->>'nombre',
        'tipo',          r.datos->>'tipo',
        'grupo',         r.datos->>'grupo',
        'categoria',     r.datos->>'categoria',
        'cristaleria',   r.datos->>'cristaleria',
        'tiempo',        r.datos->>'tiempo',
        'procedimiento', r.datos->>'procedimiento',
        'foto',          r.datos->>'foto',
        'camposExtra',   r.datos->'camposExtra',
        /* Los ingredientes se re-arman campo por campo A PROPÓSITO, en vez de
           mandar el objeto y quitarle el costo: si mañana alguien agrega un campo
           nuevo con dinero adentro, con una lista blanca NO se filtra solo. Con
           una lista negra sí, y nadie se entera. */
        'ingredientes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'nombre',   i->>'nombre',
                'desc',     i->>'desc',
                'cantidad', i->>'cantidad',
                'unidad',   i->>'unidad'
            ) ORDER BY idx)
            FROM jsonb_array_elements(COALESCE(r.datos->'ingredientes','[]'::jsonb))
                 WITH ORDINALITY AS t(i, idx)
        ), '[]'::jsonb)
    )
    FROM recetas r
    WHERE r.negocio_id = p_neg
      AND COALESCE(r.datos->>'status','activa') <> 'inactiva'
      AND (
            (v_area = 'barra'  AND r.datos->>'tipo' IN ('bebidas','sub-bebidas'))
         OR (v_area = 'cocina' AND r.datos->>'tipo' IN ('alimentos','sub-alimentos'))
      );
END;
$$;

-- ── 4. Guías que le tocan a este colaborador ─────────────────────
-- Las guías son de plataforma (v45), sin negocio. Aquí el negocio y el NIP solo
-- sirven para comprobar que quien pregunta es un colaborador de verdad.
CREATE OR REPLACE FUNCTION portal_guias(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_area TEXT;
BEGIN
    v_area := (portal_perfil(p_neg, p_token, p_niphash))->>'area';
    IF v_area IS NULL THEN RETURN; END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'id', g.id, 'titulo', g.titulo, 'descripcion', g.descripcion,
        'categoria', g.categoria, 'tipo', g.tipo, 'url', g.url,
        'audiencia', g.audiencia, 'orden', g.orden
    )
    FROM guias g
    WHERE g.activa
      AND (g.audiencia = 'ambas'
           OR g.audiencia = CASE WHEN v_area IN ('barra','cocina','piso')
                                 THEN 'operativa' ELSE 'administrativa' END)
    ORDER BY g.categoria, g.orden, g.created_at;
END;
$$;

-- ── 5. Permisos: SOLO estas tres, y solo lectura ─────────────────
-- `anon` puede EJECUTARLAS, pero no tiene acceso a las tablas de abajo. Todo lo
-- que ve pasa por el filtro de token + NIP que hay adentro.
GRANT EXECUTE ON FUNCTION portal_perfil(TEXT,TEXT,TEXT)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_recetas(TEXT,TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_guias(TEXT,TEXT,TEXT)   TO anon, authenticated;

-- ── 6. Comprobación tras correrla ────────────────────────────────
-- Con un token y un nipHash reales:
--   SELECT portal_perfil('NEG','TOKEN','NIPHASH');
--   SELECT count(*) FROM portal_recetas('NEG','TOKEN','NIPHASH');
-- Con basura debe devolver NULL / 0 filas:
--   SELECT portal_perfil('NEG','malo','malo');
