-- ============================================================================
-- ETAAX — Migración v56: freno a los intentos de adivinar la contraseña
-- ----------------------------------------------------------------------------
-- QUÉ FALTA HOY
-- La pantalla de entrada acepta intentos ilimitados. Lo único que hay enfrente
-- es el límite de peticiones de Supabase, que es genérico y no sabe nada de
-- ETAAX: quien tenga un correo de cliente puede probar contraseñas toda la
-- noche desde el propio formulario, sin que quede rastro ni se note.
--
-- QUÉ HACE ESTA
-- Un contador de fallos en el servidor, con castigo que crece. No vive en el
-- navegador a propósito: un bloqueo guardado en el navegador se quita borrando
-- los datos del sitio o abriendo una ventana privada — sería un letrero, no una
-- puerta. Aquí el bloqueo viaja con la cuenta y con la IP, en cualquier equipo.
--
--   fallos seguidos (en la última hora)    espera
--        1 – 4                             ninguna
--          5                               1 minuto
--          6                               5 minutos
--          7                               15 minutos
--        8 o más                           1 hora
--
-- Y aparte, por IP: 20 fallos en una hora ⇒ 15 minutos de espera. Sin eso basta
-- con ir cambiando de correo para no toparse nunca con el freno de la cuenta.
--
-- Un login bueno borra el contador. Los registros se limpian solos a las 24 h.
--
-- LO QUE ESTO NO ES
-- No es protección contra quien llame a la API de autenticación por fuera del
-- formulario; de eso sigue encargándose el límite de Supabase. Es el freno de
-- la puerta de entrada, que hoy no existe, y el registro de que alguien la
-- estuvo tocando.
--
-- NO SE GUARDA EL CORREO. Se guarda su md5, que alcanza para contar intentos
-- del mismo destino sin acumular una lista de correos de clientes en una tabla.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

-- OJO CON EL NOMBRE. La v30 ya tiene una tabla `login_intentos`, con otro
-- esquema (clave/intentos/ventana_inicio) y otro trabajo: limita las RPC de
-- colaborador (staff_login, obtener_staff_cred, entrada_validar_nip) a 10
-- intentos por 15 minutos. Reusar ese nombre aquí habría sido el peor caso:
-- `IF NOT EXISTS` no crea nada, el INSERT falla por columna inexistente, y como
-- este freno falla abierto a propósito, NUNCA habría contado un intento y nadie
-- se habría enterado. Son dos frenos distintos y viven en tablas distintas:
--   login_intentos (v30) → las RPC del colaborador
--   login_puerta   (v56) → la pantalla de entrada
CREATE TABLE IF NOT EXISTS login_puerta (
    id          BIGSERIAL PRIMARY KEY,
    ident       TEXT NOT NULL,             -- md5 del correo/usuario, NUNCA el correo
    ip          TEXT,
    creado      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_puerta_ident_idx ON login_puerta (ident, creado DESC);
CREATE INDEX IF NOT EXISTS login_puerta_ip_idx    ON login_puerta (ip, creado DESC);

-- Nadie la lee desde el cliente: se entra solo por las funciones de abajo, que
-- corren como dueñas. Con RLS activo y sin políticas, queda cerrada por defecto.
ALTER TABLE login_puerta ENABLE ROW LEVEL SECURITY;

-- ── La IP de quien pide, tal como la pasa PostgREST ──────────────────────────
CREATE OR REPLACE FUNCTION _login_ip()
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE h TEXT;
BEGIN
    -- Detrás de un proxy la real es la primera de x-forwarded-for.
    h := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
    IF h IS NULL OR h = '' THEN RETURN NULL; END IF;
    RETURN split_part(h, ',', 1);
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;   -- sin cabeceras (SQL Editor, pruebas): el freno por cuenta basta
END;
$$;

-- ── Cuántos segundos de espera tocan por N fallos ────────────────────────────
-- En una función aparte para que la escalera se lea de un golpe y se pueda
-- cambiar en un solo lugar.
CREATE OR REPLACE FUNCTION _login_espera(p_fallos INT)
RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_fallos >= 8 THEN 3600
        WHEN p_fallos  = 7 THEN 900
        WHEN p_fallos  = 6 THEN 300
        WHEN p_fallos  = 5 THEN 60
        ELSE 0
    END;
$$;

-- ── ¿Está bloqueado? Devuelve los SEGUNDOS que faltan (0 = puede pasar) ──────
CREATE OR REPLACE FUNCTION login_estado(p_ident TEXT)
RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id     TEXT := md5(lower(trim(coalesce(p_ident, ''))));
    v_ip     TEXT := _login_ip();
    v_n      INT;
    v_ultimo TIMESTAMPTZ;
    v_espera INT;
    v_falta  INT := 0;
    v_max    INT := 0;
BEGIN
    -- Por cuenta
    SELECT count(*), max(creado) INTO v_n, v_ultimo
      FROM login_puerta
     WHERE ident = v_id AND creado > now() - interval '1 hour';
    v_espera := _login_espera(v_n);
    IF v_espera > 0 THEN
        v_falta := v_espera - EXTRACT(EPOCH FROM (now() - v_ultimo))::INT;
        IF v_falta > v_max THEN v_max := v_falta; END IF;
    END IF;

    -- Por IP: si no, basta con ir cambiando de correo para no toparse el freno.
    IF v_ip IS NOT NULL THEN
        SELECT count(*), max(creado) INTO v_n, v_ultimo
          FROM login_puerta
         WHERE ip = v_ip AND creado > now() - interval '1 hour';
        IF v_n >= 20 THEN
            v_falta := 900 - EXTRACT(EPOCH FROM (now() - v_ultimo))::INT;
            IF v_falta > v_max THEN v_max := v_falta; END IF;
        END IF;
    END IF;

    RETURN GREATEST(v_max, 0);
END;
$$;

-- ── Se falló un intento. Devuelve los segundos de espera que quedan ──────────
CREATE OR REPLACE FUNCTION login_fallo(p_ident TEXT)
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id TEXT := md5(lower(trim(coalesce(p_ident, ''))));
BEGIN
    INSERT INTO login_puerta (ident, ip) VALUES (v_id, _login_ip());
    -- Limpieza oportunista: esta tabla no necesita crecer más de un día.
    DELETE FROM login_puerta WHERE creado < now() - interval '24 hours';
    RETURN login_estado(p_ident);
END;
$$;

-- ── Entró bien: se borra su contador ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION login_exito(p_ident TEXT)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM login_puerta WHERE ident = md5(lower(trim(coalesce(p_ident, ''))));
END;
$$;

-- La pantalla de entrada se usa SIN sesión, así que estas tres las llama `anon`.
-- No devuelven nada de la cuenta: solo un número de segundos. En particular no
-- dicen si el correo existe — eso sería un buscador de clientes gratis.
GRANT EXECUTE ON FUNCTION login_estado(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION login_fallo(TEXT)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION login_exito(TEXT)  TO anon, authenticated;
REVOKE ALL ON TABLE login_puerta FROM anon, authenticated;

-- ============================================================================
-- COMPROBACIÓN
--   SELECT login_estado('prueba@ejemplo.com');          -- 0
--   SELECT login_fallo('prueba@ejemplo.com');           -- 0 … repetir
--   -- al quinto ⇒ 60
--   SELECT login_exito('prueba@ejemplo.com');
--   SELECT login_estado('prueba@ejemplo.com');          -- 0 otra vez
--
--   -- Y que la tabla NO se pueda leer desde el cliente (debe dar error):
--   --   supabase.from('login_puerta').select('*')
-- ============================================================================
-- Fin v56.
-- ============================================================================
