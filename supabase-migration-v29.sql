-- ============================================================================
-- ETAAX — Migración v29: Módulo Evaluaciones (Consultoría) — tipo Google Forms
-- ----------------------------------------------------------------------------
-- Editor de evaluaciones (operativas, administrativas, mensuales, reclutamiento,
-- psicométrico, liderazgo). Se genera un LINK PÚBLICO por token y el staff o un
-- candidato lo contesta SIN iniciar sesión. Puntuación automática por respuesta.
--
-- Modelo de seguridad (igual que el QR de entradas v27):
--   - Cada evaluación tiene un TOKEN secreto (datos->>'token') que va en el link.
--   - El anónimo NUNCA toca las tablas: solo llama funciones SECURITY DEFINER que
--     validan el token del lado del servidor.
--   - El dueño/staff/admin ven y editan vía RLS estándar (own + staff + admin_all).
--
-- Idempotente: re-ejecutable sin error.
-- ============================================================================

-- ── Definiciones de evaluaciones (una por evaluación) ────────────────────────
CREATE TABLE IF NOT EXISTS evaluaciones (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE evaluaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own"          ON evaluaciones;
DROP POLICY IF EXISTS "staff_acceso" ON evaluaciones;
DROP POLICY IF EXISTS "admin_all"    ON evaluaciones;
CREATE POLICY "own" ON evaluaciones FOR ALL
    USING      (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));
CREATE POLICY "staff_acceso" ON evaluaciones FOR ALL
    USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id));
CREATE POLICY "admin_all" ON evaluaciones FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- ── Respuestas a las evaluaciones (una por persona que contesta) ─────────────
CREATE TABLE IF NOT EXISTS evaluacion_respuestas (
    id         TEXT PRIMARY KEY,
    negocio_id TEXT REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE evaluacion_respuestas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own"          ON evaluacion_respuestas;
DROP POLICY IF EXISTS "staff_acceso" ON evaluacion_respuestas;
DROP POLICY IF EXISTS "admin_all"    ON evaluacion_respuestas;
CREATE POLICY "own" ON evaluacion_respuestas FOR ALL
    USING      (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));
CREATE POLICY "staff_acceso" ON evaluacion_respuestas FOR ALL
    USING (es_staff_de(negocio_id)) WITH CHECK (es_staff_de(negocio_id));
CREATE POLICY "admin_all" ON evaluacion_respuestas FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Índice para resolver el token rápido (el link público busca por token).
CREATE INDEX IF NOT EXISTS evaluaciones_token_idx ON evaluaciones ((datos->>'token'));

-- ── ANON: cargar la evaluación pública por su token (solo si está activa) ─────
-- Devuelve el formulario para contestar. No expone otras evaluaciones.
CREATE OR REPLACE FUNCTION evaluacion_publica(p_token TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT e.datos
    FROM evaluaciones e
    WHERE e.datos->>'token' = p_token
      AND p_token IS NOT NULL AND p_token <> ''
      AND COALESCE((e.datos->>'activa')::boolean, false) = true
    LIMIT 1;
$$;

-- ── ANON: registrar una respuesta (valida el token; sella negocio_id del lado servidor) ─
CREATE OR REPLACE FUNCTION evaluacion_responder(p_token TEXT, p_datos JSONB)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_neg TEXT; v_evid TEXT; v_id TEXT;
BEGIN
    SELECT e.negocio_id, e.id INTO v_neg, v_evid
    FROM evaluaciones e
    WHERE e.datos->>'token' = p_token
      AND p_token IS NOT NULL AND p_token <> ''
      AND COALESCE((e.datos->>'activa')::boolean, false) = true
    LIMIT 1;
    IF v_neg IS NULL THEN
        RAISE EXCEPTION 'evaluación no disponible';
    END IF;
    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));
    INSERT INTO evaluacion_respuestas (id, negocio_id, datos)
    VALUES (v_id, v_neg, p_datos || jsonb_build_object('id', v_id, 'evaluacionId', v_evid, 'recibidoEn', now()));
    RETURN v_id;
END;
$$;

-- ── Permisos: el anónimo (sin sesión) puede llamar SOLO estas dos RPC ────────
GRANT EXECUTE ON FUNCTION evaluacion_publica(TEXT)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION evaluacion_responder(TEXT, JSONB) TO anon, authenticated;

-- ── Realtime: publicar ambas tablas para sincronización en vivo (estilo Drive)
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['evaluaciones','evaluacion_respuestas'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- Fin v29. El editor vive en consultoria/evaluaciones.html (dueño/staff).
-- El link público será /evaluacion.html?t=<token> (Fase 2) y usará SOLO las RPC
-- evaluacion_publica / evaluacion_responder (sin login).
-- ============================================================================
