-- ============================================================================
-- ETAAX — Migración v49: invitaciones para dar de alta clientes
-- ----------------------------------------------------------------------------
-- POR QUÉ
-- El registro público quedó cerrado (fase 0 de seguridad), y con razón: una
-- cuenta creada sola alcanzaba el almacén de archivos. Pero eso dejó a ETAAX
-- sin manera de dar de alta un cliente sin ir a prender y apagar el switch de
-- Supabase a mano cada vez — y el día que se olvide apagado, el hoyo vuelve.
--
-- Aquí vive el camino bueno: ETAAX genera una invitación desde el panel, el
-- cliente abre su link, pone nombre y contraseña, y una Edge Function con la
-- llave de servicio crea de un golpe la cuenta del dueño, el negocio y la
-- cuenta compartida de colaboradores. Los signups se quedan cerrados PARA
-- SIEMPRE, porque nada de esto pasa por ahí.
--
-- EL LINK ES UN PORTADOR: quien lo tenga puede usarlo. Por eso caduca, se usa
-- UNA sola vez, y el correo queda FIJO en la invitación — quien abra el link no
-- puede cambiar a nombre de quién queda la cuenta. Se manda por correo (el clic
-- prueba que el buzón es suyo) y por WhatsApp solo el aviso de que llegó.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

CREATE TABLE IF NOT EXISTS invitaciones (
    token          TEXT PRIMARY KEY,          -- va en la URL; largo y aleatorio
    email          TEXT NOT NULL,             -- a nombre de quién queda la cuenta
    nombre_negocio TEXT NOT NULL,
    forma_pago     TEXT NOT NULL DEFAULT 'stripe',   -- 'stripe' | 'offline'
    notas          TEXT,                      -- internas: quién lo atendió, qué se acordó
    creada_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_at      TIMESTAMPTZ NOT NULL,
    usada_at       TIMESTAMPTZ,               -- NULL = todavía sirve
    negocio_id     TEXT,                      -- el negocio que se creó al usarla
    creada_por     UUID                       -- admin que la generó
);

CREATE INDEX IF NOT EXISTS invitaciones_email_idx ON invitaciones (lower(email));

ALTER TABLE invitaciones ENABLE ROW LEVEL SECURITY;

-- Solo el admin de plataforma ve y crea invitaciones. El cliente NUNCA lee esta
-- tabla directo: para eso está la RPC de abajo, que devuelve lo mínimo.
DROP POLICY IF EXISTS "admin_all" ON invitaciones;
CREATE POLICY "admin_all" ON invitaciones
    FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- ── Lo que el cliente puede ver de su invitación ─────────────────────────────
-- Devuelve SOLO lo necesario para pintar la pantalla de alta. Nada de notas
-- internas ni de quién más fue invitado. Si el token no existe, ya se usó o
-- caducó, devuelve el motivo — no un error genérico, para poder decirle al
-- cliente qué pasó en vez de dejarlo mirando una pantalla rota.
CREATE OR REPLACE FUNCTION invitacion_ver(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE i invitaciones;
BEGIN
    IF p_token IS NULL OR length(p_token) < 20 THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'invalida');
    END IF;
    SELECT * INTO i FROM invitaciones WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'invalida');
    END IF;
    IF i.usada_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'usada');
    END IF;
    IF i.expira_at < now() THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'expirada');
    END IF;
    RETURN jsonb_build_object(
        'ok',             true,
        'email',          i.email,
        'nombre_negocio', i.nombre_negocio,
        'forma_pago',     i.forma_pago
    );
END;
$$;

GRANT EXECUTE ON FUNCTION invitacion_ver(TEXT) TO anon, authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
--   SELECT token, email, nombre_negocio, forma_pago,
--          CASE WHEN usada_at IS NOT NULL THEN 'usada'
--               WHEN expira_at < now()    THEN 'expirada'
--               ELSE 'vigente' END AS estado,
--          expira_at
--     FROM invitaciones ORDER BY creada_at DESC;
-- ============================================================================
-- Fin v49.
-- ============================================================================
