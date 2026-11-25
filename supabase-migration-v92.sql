-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v92 — La app móvil se ACTIVA por sucursal, desde el panel
--
-- (Edwin, 25-nov) La app móvil no es una puerta abierta: no está en la landing
-- y solo existe para una sucursal que ETAAX activó desde el panel admin, igual
-- que se activan las apps de cada sucursal.
--
-- EL QR DE CADA SUCURSAL ES SU LLAVE. Hasta hoy el QR llevaba el token del
-- NEGOCIO (negocios.entrada_token) y la sucursal viajaba aparte (&s=…), así que
-- el QR de Polanco y el de Matriz abrían lo mismo. Ahora cada sucursal tiene su
-- propio token, DERIVADO del secreto del negocio:
--
--     token de la sucursal = sha256(entrada_token || '|' || sucursal)  (48 hex)
--
-- No se guarda en ninguna tabla: sale del secreto, que ya existe. Conocer el
-- token de una sucursal no da el de otra ni el del negocio.
--
-- LA PUERTA DE VERDAD ES _entrada_token_ok (v27): TODAS las consultas de la
-- clave de 5 dígitos (entradas, recetario, check lists, horarios, perfil…) y la
-- política que sube la foto del ticket pasan por ella. Se redefine para que
-- acepte:
--   · el token de una sucursal que tiene la app ACTIVA, o
--   · el token viejo del negocio (los QR impresos antes de hoy) solo si el
--     negocio los sigue aceptando (`qrAnterior`) y tiene alguna sucursal activa.
-- Apagar una sucursal en el panel apaga su QR en el servidor, en todas esas
-- consultas a la vez. Ninguna firma cambia.
--
-- LOS NEGOCIOS QUE YA USAN EL QR NO SE ROMPEN: los que ya tienen token quedan
-- con todas sus sucursales activas y aceptando los QR viejos. Desde el panel se
-- apaga lo que no deba seguir. Los negocios nuevos nacen SIN app móvil.
--
--   movil_acceso   (negocio_id, datos {sucursales:{suc:true}, qrAnterior})
--                  la lee el negocio (dueño y staff); la escribe solo el admin.
--   movil_token    para la sesión (hub y la app con usuario y contraseña): el
--                  token de UNA sucursal si la tiene activa; si no, NULL.
--   movil_estado   para la app sin sesión: ¿este enlace sigue abierto? y de
--                  qué sucursal es. No dice nada que _entrada_token_ok no diga.
--
-- Correr a mano en Supabase → SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. La tabla: qué sucursales tienen la app ──────────────────────────────
CREATE TABLE IF NOT EXISTS movil_acceso (
    negocio_id  TEXT PRIMARY KEY REFERENCES negocios(id) ON DELETE CASCADE,
    datos       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE movil_acceso ENABLE ROW LEVEL SECURITY;

-- El negocio la LEE (el hub decide si ofrece el QR); solo el admin la escribe:
-- si el dueño pudiera escribirla, se activaría la app él solo.
DROP POLICY IF EXISTS "own_lee"   ON movil_acceso;
DROP POLICY IF EXISTS "staff_lee" ON movil_acceso;
DROP POLICY IF EXISTS "admin_all" ON movil_acceso;
CREATE POLICY "own_lee" ON movil_acceso FOR SELECT
    USING (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));
CREATE POLICY "staff_lee" ON movil_acceso FOR SELECT
    USING (es_staff_de(negocio_id));
CREATE POLICY "admin_all" ON movil_acceso FOR ALL
    USING (is_platform_admin()) WITH CHECK (is_platform_admin());
REVOKE ALL ON movil_acceso FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON movil_acceso TO authenticated;

-- ── 2. Los negocios que ya usan el QR: todo activo, como hoy ───────────────
-- Las sucursales salen de negocio_sucursales (las activas); sin lista, Matriz.
-- ON CONFLICT DO NOTHING: volver a correr la migración no pisa lo que el admin
-- ya apagó.
INSERT INTO movil_acceso (negocio_id, datos)
SELECT n.id,
       jsonb_build_object(
           'sucursales', COALESCE(
               (SELECT jsonb_object_agg(x->>'id', true)
                  FROM negocio_sucursales ns,
                       jsonb_array_elements(CASE WHEN jsonb_typeof(ns.datos->'sucursales') = 'array'
                                                 THEN ns.datos->'sucursales' ELSE '[]'::jsonb END) x
                 WHERE ns.negocio_id = n.id
                   AND COALESCE(x->>'id', '') <> ''
                   AND COALESCE(x->>'activa', 'true') <> 'false'),
               '{"suc_principal": true}'::jsonb),
           'qrAnterior', true,
           'desde', 'v92')
  FROM negocios n
 WHERE COALESCE(n.entrada_token, '') <> ''
ON CONFLICT (negocio_id) DO NOTHING;

-- ── 3. El token de una sucursal ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _movil_token_suc(p_tok TEXT, p_suc TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT CASE WHEN COALESCE(p_tok, '') = '' OR COALESCE(p_suc, '') = '' THEN NULL
                ELSE left(encode(sha256(convert_to(p_tok || '|' || p_suc, 'UTF8')), 'hex'), 48) END;
$$;

-- Las sucursales con la app activa, de un negocio.
CREATE OR REPLACE FUNCTION _movil_activas(p_neg TEXT)
RETURNS SETOF TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT s.key
      FROM movil_acceso m,
           jsonb_each(CASE WHEN jsonb_typeof(m.datos->'sucursales') = 'object'
                           THEN m.datos->'sucursales' ELSE '{}'::jsonb END) s
     WHERE m.negocio_id = p_neg
       AND s.value = 'true'::jsonb;
$$;

-- ¿De qué sucursal ACTIVA es este token? (NULL: de ninguna)
CREATE OR REPLACE FUNCTION _movil_sucursal_de(p_neg TEXT, p_token TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.suc
      FROM negocios n, _movil_activas(n.id) AS a(suc)
     WHERE n.id = p_neg
       AND COALESCE(p_token, '') <> ''
       AND _movil_token_suc(n.entrada_token, a.suc) = p_token
     LIMIT 1;
$$;

-- ── 4. LA PUERTA: _entrada_token_ok (origen: v27) ──────────────────────────
-- Misma firma, mismo veredicto (sí/no). La llaman las consultas de la clave y
-- la política de la foto del ticket (TO anon): por eso sigue abierta a anon.
CREATE OR REPLACE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT _movil_sucursal_de(p_neg, p_token) IS NOT NULL
        OR EXISTS (
            SELECT 1
              FROM negocios n
              JOIN movil_acceso m ON m.negocio_id = n.id
             WHERE n.id = p_neg
               AND COALESCE(n.entrada_token, '') <> ''
               AND n.entrada_token = p_token
               AND COALESCE(m.datos->>'qrAnterior', 'false') = 'true'
               AND EXISTS (SELECT 1 FROM _movil_activas(p_neg)));
$$;

-- ── 5. movil_token: el token de una sucursal, para la sesión ───────────────
-- p_suc vacío = la que toque: Matriz si está activa, si no la primera activa
-- (el dueño que configura un teléfono). Con sucursal (el colaborador): esa, o
-- NULL si no tiene la app. Mismo candado que entrada_token_asegurar (v70):
-- dueño, staff del negocio o admin; `IS NOT TRUE` para que sin sesión NIEGUE.
CREATE OR REPLACE FUNCTION movil_token(p_neg TEXT, p_suc TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner UUID; v_tok TEXT; v_suc TEXT;
BEGIN
    SELECT usuario_id, entrada_token INTO v_owner, v_tok FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'negocio no encontrado';
    END IF;
    IF (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;
    IF COALESCE(p_suc, '') <> '' THEN
        SELECT a INTO v_suc FROM _movil_activas(p_neg) a WHERE a = p_suc;
    ELSE
        SELECT a INTO v_suc FROM _movil_activas(p_neg) a ORDER BY (a <> 'suc_principal'), a LIMIT 1;
    END IF;
    IF v_suc IS NULL THEN
        RETURN NULL;
    END IF;
    IF COALESCE(v_tok, '') = '' THEN
        v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
        UPDATE negocios SET entrada_token = v_tok WHERE id = p_neg;
    END IF;
    RETURN jsonb_build_object('token', _movil_token_suc(v_tok, v_suc), 'sucursalId', v_suc);
END;
$$;

-- ── 6. movil_estado: ¿este enlace sigue abierto? (la app, sin sesión) ──────
CREATE OR REPLACE FUNCTION movil_estado(p_neg TEXT, p_token TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object('activo', _entrada_token_ok(p_neg, p_token),
                              'sucursalId', _movil_sucursal_de(p_neg, p_token));
$$;

-- ── Permisos ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION _movil_token_suc(TEXT, TEXT)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _movil_activas(TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _movil_sucursal_de(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION movil_token(TEXT, TEXT)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION movil_estado(TEXT, TEXT)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION movil_token(TEXT, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION movil_estado(TEXT, TEXT)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION _entrada_token_ok(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Comprobación (sale en Results): cuántos negocios quedaron con la app y cuántas sucursales.
SELECT count(*) AS negocios_con_app,
       COALESCE(sum((SELECT count(*) FROM jsonb_each(datos->'sucursales') s WHERE s.value = 'true'::jsonb)), 0) AS sucursales_activas
  FROM movil_acceso;
