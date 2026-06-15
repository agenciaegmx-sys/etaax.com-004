/* ============================================================
   ETAAX — Migración v14
   Puente QR de captura (tipo "Bluetooth"): el celular sube una
   foto SIN iniciar sesión, validado por un token temporal que
   genera la sesión de la compu. No expone datos del negocio.
   Idempotente: correr a mano en Supabase → SQL Editor.
   Requiere v13 (bucket evidencias + capturas_pendientes).
   ============================================================ */

/* ── 1. Tokens de emparejamiento (los crea la compu autenticada) ── */
CREATE TABLE IF NOT EXISTS pairing_sesiones (
    token       TEXT PRIMARY KEY,
    negocio_id  TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL,          -- 'corte' | 'gasto'
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pairing_neg ON pairing_sesiones(negocio_id);
ALTER TABLE pairing_sesiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own" ON pairing_sesiones;
CREATE POLICY "own" ON pairing_sesiones
    FOR ALL
    USING  (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM negocios WHERE id = negocio_id AND usuario_id = auth.uid()));

DROP POLICY IF EXISTS "admin_all" ON pairing_sesiones;
CREATE POLICY "admin_all" ON pairing_sesiones
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

/* ── 2. Validador de token (SECURITY DEFINER para que la política
        anónima pueda comprobarlo sin leer la tabla directamente) ── */
CREATE OR REPLACE FUNCTION token_pairing_valido(t TEXT, negid TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM pairing_sesiones
        WHERE token = t AND negocio_id = negid
          AND created_at > NOW() - INTERVAL '1 minute'
    );
$$;

/* ── 3. La columna token en la bandeja (v13 la creó sin token) ── */
ALTER TABLE capturas_pendientes ADD COLUMN IF NOT EXISTS token TEXT;

/* El celular (anon) solo puede insertar en la bandeja si trae un
   token de emparejamiento válido para ese negocio. */
DROP POLICY IF EXISTS "anon_insert" ON capturas_pendientes;
CREATE POLICY "anon_insert" ON capturas_pendientes
    FOR INSERT TO anon
    WITH CHECK (token IS NOT NULL AND token_pairing_valido(token, negocio_id));

/* ── 4. Subida anónima a Storage SOLO en rutas con token válido:
        ruta = <negId>/inbox/<token>/<archivo> ── */
DROP POLICY IF EXISTS "evidencias_anon_insert" ON storage.objects;
CREATE POLICY "evidencias_anon_insert" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (
        bucket_id = 'evidencias'
        AND (storage.foldername(name))[2] = 'inbox'
        AND token_pairing_valido((storage.foldername(name))[3], (storage.foldername(name))[1])
    );
