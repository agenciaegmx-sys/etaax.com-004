-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v91 — La app móvil, por módulo: lo que el equipo ve con su NIP
--
-- La app móvil se ordena como el resto de ETAAX: con la CLAVE (el NIP de 5
-- dígitos) se entra a VISTAS de cada módulo —Cost·ax: entradas y recetario;
-- Equip·ax: horarios, check lists y evaluaciones; Learn·ax: guías—; con usuario
-- y contraseña, a usar los módulos.
--
-- Tres consultas nuevas para la puerta del NIP, con el MISMO candado que
-- portal_perfil (v78): el guardia de intentos (_nip_guardia), el token del QR
-- del negocio (_entrada_token_ok) y solo colaboradores ACTIVOS.
--
--   portal_apps          qué apps tiene contratadas la sucursal de quien entra
--                        (lo no contratado no se ve, la regla de la v89). Sin
--                        plan = paquete completo, como los negocios de antes.
--   portal_horarios      SUS turnos de esta semana y la que sigue (y los de
--                        otra sucursal si lo prestaron). Solo los suyos: nunca
--                        el rol de los demás.
--   portal_evaluaciones  las evaluaciones ABIERTAS del negocio, sin las de
--                        reclutamiento (esas son para candidatos). El enlace de
--                        cada una ya es público: es el mismo que se manda por
--                        WhatsApp, así que entregarlo con NIP no abre nada nuevo.
--
-- Correr a mano en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── La persona que entra: token del negocio + NIP + activa ─────────────────
-- Una sola definición para las tres consultas. Devuelve el renglón de staff o
-- nada. NO corre el guardia de intentos: eso lo hace cada consulta primero.
CREATE OR REPLACE FUNCTION _portal_quien(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS staff
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT s.*
      FROM staff s
     WHERE s.negocio_id = p_neg
       AND s.datos->>'nipHash' = p_niphash
       AND p_niphash IS NOT NULL AND p_niphash <> ''
       AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
       AND _entrada_token_ok(p_neg, p_token)
     LIMIT 1;
$$;

-- ── portal_apps ─────────────────────────────────────────────────────────────
-- `apps` es lo que la v89 guarda para ESA sucursal (o la base del negocio):
-- una lista ['costax','equipax',…], 'suite', o NULL si el negocio no tiene plan
-- (= paquete completo). La app solo esconde; la regla vive en la v89.
CREATE OR REPLACE FUNCTION portal_apps(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s staff; v_suc TEXT; v_plan JSONB;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN NULL; END IF;
    v_s := _portal_quien(p_neg, p_token, p_niphash);
    IF v_s.id IS NULL THEN RETURN NULL; END IF;
    v_suc := COALESCE(NULLIF(v_s.datos->>'sucursalId', ''), 'suc_principal');
    SELECT plan INTO v_plan FROM suscripciones WHERE negocio_id = p_neg;
    RETURN jsonb_build_object(
        'sucursalId', v_suc,
        'apps', CASE WHEN v_plan IS NULL THEN NULL
                     WHEN jsonb_typeof(v_plan->'sucursales') = 'object' AND (v_plan->'sucursales') ? v_suc
                          THEN v_plan->'sucursales'->v_suc
                     ELSE v_plan->'base' END);
END;
$$;

-- ── portal_horarios ─────────────────────────────────────────────────────────
-- Las semanas se nombran igual que en Horarios (EtaaxCore.getWeekStr: semana
-- ISO, '2026-W48'), con la fecha de México. Cada semana trae el lunes, para
-- que la app ponga la fecha junto a cada día (d0 = lunes … d6 = domingo).
CREATE OR REPLACE FUNCTION portal_horarios(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s staff; v_id TEXT; v_hoy DATE; v_lunes DATE; v_sem TEXT; v_out JSONB := '[]'::jsonb; i INT;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN NULL; END IF;
    v_s := _portal_quien(p_neg, p_token, p_niphash);
    IF v_s.id IS NULL THEN RETURN NULL; END IF;
    v_id  := COALESCE(NULLIF(v_s.datos->>'id', ''), v_s.id);
    v_hoy := (now() AT TIME ZONE 'America/Mexico_City')::date;
    FOR i IN 0..1 LOOP
        v_lunes := date_trunc('week', v_hoy + i * 7)::date;
        v_sem   := to_char(v_lunes, 'IYYY-"W"IW');
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'semana', v_sem,
            'lunes',  to_char(v_lunes, 'YYYY-MM-DD'),
            'turnos', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                           'sucursalId', COALESCE(NULLIF(h.datos->>'sucursalId', ''), 'suc_principal'),
                           'sucursal', (SELECT x->>'nombre'
                                          FROM negocio_sucursales ns,
                                               jsonb_array_elements(CASE WHEN jsonb_typeof(ns.datos->'sucursales') = 'array'
                                                                         THEN ns.datos->'sucursales' ELSE '[]'::jsonb END) x
                                         WHERE ns.negocio_id = p_neg
                                           AND x->>'id' = COALESCE(NULLIF(h.datos->>'sucursalId', ''), 'suc_principal')
                                         LIMIT 1),
                           'dias', h.datos->'turnos'->v_id))
                  FROM horarios h
                 WHERE h.negocio_id = p_neg
                   AND h.datos->>'semana' = v_sem
                   AND jsonb_typeof(h.datos->'turnos') = 'object'
                   AND (h.datos->'turnos') ? v_id), '[]'::jsonb)));
    END LOOP;
    RETURN jsonb_build_object('hoy', to_char(v_hoy, 'YYYY-MM-DD'), 'semanas', v_out);
END;
$$;

-- ── portal_evaluaciones ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal_evaluaciones(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s staff;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN NULL; END IF;
    v_s := _portal_quien(p_neg, p_token, p_niphash);
    IF v_s.id IS NULL THEN RETURN NULL; END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                   'titulo',      e.datos->>'titulo',
                   'categoria',   COALESCE(e.datos->>'categoria', ''),
                   'descripcion', COALESCE(e.datos->>'descripcion', ''),
                   'token',       e.datos->>'token',
                   'preguntas',   CASE WHEN jsonb_typeof(e.datos->'preguntas') = 'array'
                                       THEN jsonb_array_length(e.datos->'preguntas') ELSE 0 END)
                 ORDER BY e.datos->>'titulo')
          FROM evaluaciones e
         WHERE e.negocio_id = p_neg
           AND COALESCE((e.datos->>'activa')::boolean, false) = true
           AND COALESCE(e.datos->>'categoria', '') <> 'reclutamiento'
           AND NULLIF(e.datos->>'token', '') IS NOT NULL), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION _portal_quien(TEXT, TEXT, TEXT)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION portal_apps(TEXT, TEXT, TEXT)         FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_horarios(TEXT, TEXT, TEXT)     FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_evaluaciones(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_apps(TEXT, TEXT, TEXT)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_horarios(TEXT, TEXT, TEXT)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_evaluaciones(TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Comprobación (sale en Results): las tres consultas, abiertas a la app.
SELECT p.proname AS funcion, has_function_privilege('anon', p.oid, 'EXECUTE') AS la_app_puede
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public' AND p.proname IN ('portal_apps', 'portal_horarios', 'portal_evaluaciones', '_portal_quien')
 ORDER BY 1;
