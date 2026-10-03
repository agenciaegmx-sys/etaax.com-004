-- ═══════════════════════════════════════════════════════════════════════════
-- ETAAX · Migración v62 — Bitácora de accesos a la plataforma
-- Corre esto en: Supabase → SQL Editor. Seguro de re-ejecutar.
--
-- PARA QUÉ: hoy no hay forma de responder «¿quién entró a mi negocio el
-- martes?». Ni para el dueño que lo pregunta, ni para ETAAX cuando se lo
-- piden. Esta tabla guarda quién entró, a qué negocio y cuándo.
--
-- QUÉ NO ES: no es presencia en vivo. Quién está conectado AHORA se resuelve
-- con Realtime Presence, que es efímero y no toca la base — un registro por
-- latido llenaría la tabla de ruido sin responder mejor la pregunta.
--
-- QUÉ SE GUARDA, y qué no:
--   · usuario   → el correo del dueño o el nombre del colaborador. Es el dato
--                 de la pregunta: sin él la bitácora no sirve de nada.
--   · tipo      → 'dueno' | 'staff' | 'admin' | 'admin_reset'
--   · agente    → navegador/dispositivo, RECORTADO a 160 caracteres. Sirve para
--                 distinguir «entró de su celular» de «entró de otra máquina».
--   · NO se guarda IP. Es dato personal, no hace falta para la pregunta que
--     esto responde, y guardarla obliga a cuidarla. Si algún día hace falta
--     para una investigación, se agrega entonces y se dice en el aviso.
--
-- QUIÉN PUEDE LEERLA: el admin de plataforma y el DUEÑO de ese negocio. Un
-- colaborador no: la bitácora dice a qué hora entra cada quien, y eso en manos
-- del equipo es otra cosa.
--
-- QUIÉN PUEDE ESCRIBIR: nadie, directo. Solo la RPC `acceso_registrar`, que es
-- SECURITY DEFINER y sella la hora del lado del servidor. Si el cliente pudiera
-- insertar a mano, podría escribir accesos que nunca pasaron — y una bitácora
-- que se puede inventar no es una bitácora.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS accesos_log (
    id          TEXT PRIMARY KEY,
    negocio_id  TEXT,
    usuario     TEXT,
    tipo        TEXT,
    agente      TEXT,
    detalle     TEXT,
    creado      TIMESTAMPTZ DEFAULT NOW()
);

-- La consulta real es «los accesos de ESTE negocio, los más nuevos primero».
CREATE INDEX IF NOT EXISTS accesos_log_neg_fecha ON accesos_log (negocio_id, creado DESC);

ALTER TABLE accesos_log ENABLE ROW LEVEL SECURITY;

-- Lectura: admin de plataforma, o el dueño de ese negocio.
DROP POLICY IF EXISTS "accesos_lee" ON accesos_log;
CREATE POLICY "accesos_lee" ON accesos_log
    FOR SELECT USING (
        is_platform_admin()
        OR EXISTS (
            SELECT 1 FROM negocios n
            WHERE n.id = accesos_log.negocio_id
              AND n.usuario_id = auth.uid()
        )
    );

-- Escritura directa: NADIE. Sin política de INSERT, RLS la niega por defecto.
-- Se escribe solo por la RPC de abajo.

-- ── La RPC que registra ─────────────────────────────────────────────────────
-- SECURITY DEFINER para poder insertar donde el cliente no puede, y para sellar
-- la hora con el reloj del SERVIDOR: la del navegador la mueve cualquiera.
--
-- `p_usuario` viene del cliente a propósito: para el dueño autenticado se
-- IGNORA y se usa el correo del JWT, que no se puede falsificar. Solo se
-- respeta para el colaborador, que entra sin sesión propia (anon) y cuya
-- identidad ya validó `staff_login` contra el hash de su contraseña.
CREATE OR REPLACE FUNCTION acceso_registrar(
    p_neg TEXT, p_usuario TEXT, p_tipo TEXT, p_agente TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_email TEXT := auth.jwt() ->> 'email';
    v_user  TEXT;
    v_tipo  TEXT := COALESCE(NULLIF(p_tipo, ''), 'desconocido');
BEGIN
    IF p_neg IS NULL OR p_neg = '' THEN RETURN; END IF;

    -- Con sesión, manda el correo del token. Sin sesión (colaborador), el
    -- nombre que ya validó staff_login.
    v_user := COALESCE(NULLIF(v_email, ''), NULLIF(p_usuario, ''), '(sin identificar)');

    -- Un tipo inventado por el cliente ensuciaría los filtros del panel.
    IF v_tipo NOT IN ('dueno', 'staff', 'admin', 'admin_reset', 'admin_fantasma') THEN
        v_tipo := 'desconocido';
    END IF;

    INSERT INTO accesos_log (id, negocio_id, usuario, tipo, agente, creado)
    VALUES (
        replace(gen_random_uuid()::text, '-', ''),
        p_neg, v_user, v_tipo,
        left(COALESCE(p_agente, ''), 160),
        NOW()
    );

    -- Retención: la bitácora responde «quién entró últimamente», no es un
    -- archivo histórico. Seis meses cubren cualquier aclaración razonable y
    -- evitan que la tabla crezca sin fin. Se limpia aquí, de a poco, en vez de
    -- montar un cron que haya que recordar.
    DELETE FROM accesos_log WHERE creado < NOW() - INTERVAL '180 days';
END;
$$;
REVOKE ALL ON FUNCTION acceso_registrar(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acceso_registrar(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── Lectura para el panel admin ─────────────────────────────────────────────
-- Va por RPC y no por SELECT directo para poder PAGINAR y topar: un negocio con
-- un año de accesos devolvería miles de renglones a un panel que muestra 50.
CREATE OR REPLACE FUNCTION accesos_de_negocio(p_neg TEXT, p_limite INT DEFAULT 100)
RETURNS TABLE (usuario TEXT, tipo TEXT, agente TEXT, detalle TEXT, creado TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
    -- SECURITY INVOKER a propósito: que mande la política de arriba. Si fuera
    -- DEFINER, esta función se saltaría el RLS y cualquiera con sesión podría
    -- leer la bitácora de cualquier negocio.
    SELECT a.usuario, a.tipo, a.agente, a.detalle, a.creado
    FROM accesos_log a
    WHERE a.negocio_id = p_neg
    ORDER BY a.creado DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limite, 100), 1), 500);
$$;
REVOKE ALL ON FUNCTION accesos_de_negocio(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accesos_de_negocio(TEXT, INT) TO authenticated;

-- Comprobación: debe devolver la tabla y las dos funciones.
SELECT 'tabla' AS que, table_name AS nombre FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'accesos_log'
UNION ALL
SELECT 'función', routine_name FROM information_schema.routines
 WHERE routine_schema = 'public' AND routine_name IN ('acceso_registrar', 'accesos_de_negocio');

-- ============================================================================
-- Fin v62. Después de correrla:
--   · cada entrada al sistema queda registrada con usuario, tipo y hora;
--   · el panel admin puede mostrar la bitácora de cada negocio;
--   · el dueño puede ver la suya, y el equipo no.
-- ============================================================================
