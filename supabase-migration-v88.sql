-- ═══════════════════════════════════════════════════════════════════════════
-- ETAAX · v88 · STAFF ETAAX: el equipo de ETAAX entra a varios negocios
--
-- QUÉ ES
--   Personas del equipo de ETAAX (auditores, consultores) que entran con su
--   propio usuario y contraseña, ven una portada con los negocios a los que se
--   les dio acceso, y al entrar a uno lo ven como cualquier negocio: con sus
--   sucursales (solo las permitidas) y sus módulos (solo los permitidos).
--
-- CÓMO
--   · Cada persona tiene SU cuenta de Supabase Auth, con un correo interno
--     `<usuario>@staff.etaax.app` (nadie lo teclea: en el login se escribe solo
--     el usuario). La crea el panel admin con un cliente efímero, como las
--     cuentas de colaboradores (staff-auth.js).
--   · `etaax_staff`          → quién es (uid, usuario, nombre, activo).
--   · `etaax_staff_accesos`  → a qué negocio entra, con qué sucursales
--     (`datos.sucursales`, vacío = todas) y qué módulos y sub-permisos
--     (`datos.permisos`, la misma forma que la tabla `permisos` de un rol).
--
-- LA PUERTA EN LA BASE
--   `es_staff_de(neg)` ya es la llave de TODAS las políticas «staff_acceso»
--   (las tablas del negocio) y de las RPC que aceptan al colaborador. Se le
--   suma el Staff ETAAX con acceso ACTIVO a ese negocio: así entra exactamente
--   a lo mismo que la cuenta de colaboradores del negocio, sin tocar ninguna
--   de esas políticas. Igual las fotos privadas (etaax_puede_neg) y las
--   evidencias (etaax_negocio_alcanzable).
--   Los módulos y las sucursales los decide la interfaz (page-guard), como con
--   cualquier colaborador: es control de operación. La frontera de seguridad
--   es el NEGOCIO: sin acceso a un negocio, la base no le da ni un renglón.
--   Al desactivarlo o quitarle un negocio, el corte es inmediato: la regla se
--   evalúa en cada consulta.
--
--   La tabla `negocios` NO se le abre: trae las credenciales de la cuenta de
--   colaboradores (`staff_cred`). Lo que la portada necesita del negocio
--   (nombre, emoji, logo…) viaja por `etx_mis_negocios()`.
--
-- Correr en: Supabase → SQL Editor. Seguro de re-ejecutar.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS etaax_staff (
    uid        UUID PRIMARY KEY,                  -- auth.users.id
    usuario    TEXT NOT NULL UNIQUE,              -- lo que se teclea en el login
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb, -- nombre, activo, nota
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS etaax_staff_accesos (
    uid        UUID NOT NULL REFERENCES etaax_staff(uid) ON DELETE CASCADE,
    negocio_id TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    datos      JSONB NOT NULL DEFAULT '{}'::jsonb, -- sucursales[], permisos{}, activo
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (uid, negocio_id)
);
CREATE INDEX IF NOT EXISTS etaax_staff_accesos_neg ON etaax_staff_accesos (negocio_id);

ALTER TABLE etaax_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE etaax_staff_accesos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_all" ON etaax_staff;
CREATE POLICY "admin_all" ON etaax_staff FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
DROP POLICY IF EXISTS "admin_all" ON etaax_staff_accesos;
CREATE POLICY "admin_all" ON etaax_staff_accesos FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());
-- La persona lee lo suyo (su ficha y sus accesos). Escribir, solo el admin.
DROP POLICY IF EXISTS "propio_lee" ON etaax_staff;
CREATE POLICY "propio_lee" ON etaax_staff FOR SELECT TO authenticated USING (uid = auth.uid());
DROP POLICY IF EXISTS "propio_lee" ON etaax_staff_accesos;
CREATE POLICY "propio_lee" ON etaax_staff_accesos FOR SELECT TO authenticated USING (uid = auth.uid());

-- ── ¿Quien pregunta es Staff ETAAX con acceso ACTIVO a este negocio? ─────────
-- Activo = la persona y el acceso. Sin el campo = activo (nace activo).
CREATE OR REPLACE FUNCTION es_staff_etaax_de(neg_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
          FROM etaax_staff s
          JOIN etaax_staff_accesos a ON a.uid = s.uid
         WHERE s.uid = auth.uid()
           AND a.negocio_id = neg_id
           AND COALESCE(s.datos->>'activo', 'true') <> 'false'
           AND COALESCE(a.datos->>'activo', 'true') <> 'false'
    );
$$;

-- ── La llave de las políticas «staff_acceso», ahora con el Staff ETAAX ──────
-- Misma firma y mismo cuerpo de la v19, más la segunda condición. CREATE OR
-- REPLACE conserva sus permisos: anon la SIGUE pudiendo ejecutar, que es lo
-- que necesitan las políticas creadas sin cláusula TO (ver money-tests).
CREATE OR REPLACE FUNCTION es_staff_de(neg_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM negocios
        WHERE id = neg_id AND staff_uid IS NOT NULL AND staff_uid = auth.uid()
    )
    OR es_staff_etaax_de(neg_id);
$$;

-- Fotos privadas (bucket evidencias-priv, v55): la misma suma.
CREATE OR REPLACE FUNCTION etaax_puede_neg(p_raiz TEXT)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM negocios n
        WHERE n.id = p_raiz
          AND (n.usuario_id = auth.uid()
               OR (n.staff_uid IS NOT NULL AND n.staff_uid = auth.uid()))
    )
    OR is_platform_admin()
    OR es_staff_etaax_de(p_raiz);
$$;

-- Evidencias (bucket evidencias, v48): la misma suma.
CREATE OR REPLACE FUNCTION etaax_negocio_alcanzable(p_neg TEXT)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM negocios n
        WHERE n.id = p_neg
          AND (n.usuario_id = auth.uid() OR n.staff_uid = auth.uid())
    )
    OR es_staff_etaax_de(p_neg);
$$;

-- ── La portada: mis negocios, con lo que necesito de cada uno ────────────────
-- Solo los accesos activos de una persona activa. Del negocio va `datos`
-- (nombre, tipo, emoji, color, logo): NUNCA staff_cred.
CREATE OR REPLACE FUNCTION etx_mis_negocios()
RETURNS TABLE (negocio_id TEXT, negocio JSONB, acceso JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT n.id, COALESCE(n.datos, '{}'::jsonb), a.datos
      FROM etaax_staff s
      JOIN etaax_staff_accesos a ON a.uid = s.uid
      JOIN negocios n ON n.id = a.negocio_id
     WHERE s.uid = auth.uid()
       AND COALESCE(s.datos->>'activo', 'true') <> 'false'
       AND COALESCE(a.datos->>'activo', 'true') <> 'false'
     ORDER BY lower(COALESCE(n.datos->>'nombre', n.id));
$$;

-- ── Contraseñas: solo el admin y solo cuentas del Staff ETAAX ────────────────
-- El cliente no puede cambiarle la contraseña a otra cuenta de Auth; esto sí,
-- y únicamente a correos @staff.etaax.app (nunca a un dueño ni al admin).
-- También confirma el correo: si «Confirm email» estuviera prendido, la cuenta
-- recién creada no podría entrar.
CREATE OR REPLACE FUNCTION admin_etx_clave(p_uid UUID, p_clave TEXT)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions, auth AS $$
BEGIN
    IF NOT is_platform_admin() THEN
        RAISE EXCEPTION 'Solo el admin de la plataforma puede cambiar contraseñas del Staff ETAAX.' USING ERRCODE = '42501';
    END IF;
    IF length(COALESCE(p_clave, '')) < 8 THEN
        RAISE EXCEPTION 'La contraseña debe tener al menos 8 caracteres.';
    END IF;
    UPDATE auth.users
       SET encrypted_password = crypt(p_clave, gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = p_uid AND email LIKE '%@staff.etaax.app';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa cuenta no es del Staff ETAAX.';
    END IF;
END;
$$;

-- Si la cuenta de Auth ya existía (se dio de baja y se vuelve a dar de alta con
-- el mismo usuario), el alta la recupera en vez de fallar.
CREATE OR REPLACE FUNCTION admin_etx_uid(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_uid UUID;
BEGIN
    IF NOT is_platform_admin() THEN
        RAISE EXCEPTION 'Solo el admin de la plataforma.' USING ERRCODE = '42501';
    END IF;
    IF lower(COALESCE(p_email, '')) NOT LIKE '%@staff.etaax.app' THEN
        RAISE EXCEPTION 'Esa cuenta no es del Staff ETAAX.';
    END IF;
    SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
    RETURN v_uid;
END;
$$;

-- Baja: se borra su ficha (y con ella todos sus accesos) y su contraseña se
-- cambia por una que nadie conoce. La regla de arriba ya le cerró los datos en
-- el momento en que la ficha desaparece.
CREATE OR REPLACE FUNCTION admin_etx_baja(p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions, auth AS $$
BEGIN
    IF NOT is_platform_admin() THEN
        RAISE EXCEPTION 'Solo el admin de la plataforma.' USING ERRCODE = '42501';
    END IF;
    DELETE FROM etaax_staff WHERE uid = p_uid;
    UPDATE auth.users
       SET encrypted_password = crypt(gen_random_uuid()::text || clock_timestamp()::text, gen_salt('bf')),
           updated_at = now()
     WHERE id = p_uid AND email LIKE '%@staff.etaax.app';
END;
$$;

-- ── La bitácora de accesos distingue al Staff ETAAX ──────────────────────────
-- Mismo cuerpo de la v62; solo se suma 'staff_etaax' a los tipos válidos.
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
    v_user := COALESCE(NULLIF(v_email, ''), NULLIF(p_usuario, ''), '(sin identificar)');
    IF v_tipo NOT IN ('dueno', 'staff', 'staff_etaax', 'admin', 'admin_reset', 'admin_fantasma') THEN
        v_tipo := 'desconocido';
    END IF;
    INSERT INTO accesos_log (id, negocio_id, usuario, tipo, agente, creado)
    VALUES (
        replace(gen_random_uuid()::text, '-', ''),
        p_neg, v_user, v_tipo,
        left(COALESCE(p_agente, ''), 160),
        NOW()
    );
    DELETE FROM accesos_log WHERE creado < NOW() - INTERVAL '180 days';
END;
$$;

-- ── Permisos de ejecución ────────────────────────────────────────────────────
-- es_staff_etaax_de la llama es_staff_de, que es SECURITY DEFINER: corre como
-- su dueño, así que anon no necesita poder ejecutarla.
REVOKE ALL ON FUNCTION es_staff_etaax_de(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION es_staff_etaax_de(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION etx_mis_negocios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION etx_mis_negocios() TO authenticated;
REVOKE ALL ON FUNCTION admin_etx_clave(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_etx_clave(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION admin_etx_uid(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_etx_uid(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION admin_etx_baja(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_etx_baja(UUID) TO authenticated;

-- ── Comprobación (sale en Results) ───────────────────────────────────────────
SELECT 'tabla' AS que, table_name AS nombre FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('etaax_staff', 'etaax_staff_accesos')
UNION ALL
SELECT 'función', p.proname FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public'
   AND p.proname IN ('es_staff_etaax_de', 'es_staff_de', 'etx_mis_negocios', 'admin_etx_clave', 'admin_etx_uid', 'admin_etx_baja')
ORDER BY 1, 2;
