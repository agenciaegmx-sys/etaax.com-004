-- ============================================================================
-- ETAAX — Migración v27: QR de entradas SIN login (token por negocio + RPC)
-- ----------------------------------------------------------------------------
-- Permite que un celular FRESCO (cocina/barra), sin iniciar sesión, registre
-- entradas escaneando el QR del negocio y poniendo su NIP de 5 dígitos.
--
-- Modelo de seguridad:
--   - El QR lleva un TOKEN secreto por negocio (negocios.entrada_token).
--   - Toda la lógica pasa por funciones SECURITY DEFINER que validan el token
--     del lado del servidor (el anon NUNCA toca las tablas directo).
--   - El NIP (nipHash, mismo de Gestión de Staff) identifica al colaborador.
--   - Acción de bajo riesgo y revisable: solo AGREGA entradas que el admin
--     revisa antes de importar al inventario.
--
-- Idempotente: re-ejecutable sin error.
-- ============================================================================

-- 1) Token secreto por negocio (lo lleva el QR).
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS entrada_token TEXT;

-- 2) DUEÑO/STAFF: genera (o devuelve) el token del negocio. Restringido al dueño,
--    a la cuenta de colaboradores del negocio o a un platform admin.
CREATE OR REPLACE FUNCTION entrada_token_asegurar(p_neg TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner UUID; v_tok TEXT;
BEGIN
    SELECT usuario_id, entrada_token INTO v_owner, v_tok FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'negocio no encontrado';
    END IF;
    IF NOT (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;
    IF v_tok IS NULL OR v_tok = '' THEN
        v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
        UPDATE negocios SET entrada_token = v_tok WHERE id = p_neg;
    END IF;
    RETURN v_tok;
END;
$$;

-- Helper interno: ¿el token es el del negocio? (no expone nada)
CREATE OR REPLACE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM negocios
        WHERE id = p_neg AND entrada_token IS NOT NULL AND entrada_token <> '' AND entrada_token = p_token
    );
$$;

-- 3) ANON: valida token + NIP → devuelve el nombre del colaborador (o vacío).
CREATE OR REPLACE FUNCTION entrada_validar_nip(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT (s.datos->>'nombre')
    FROM staff s
    WHERE s.negocio_id = p_neg
      AND s.datos->>'nipHash' = p_niphash
      AND p_niphash IS NOT NULL AND p_niphash <> ''
      AND _entrada_token_ok(p_neg, p_token)
    LIMIT 1;
$$;

-- 4) ANON: lista de insumos del negocio (solo con token válido) para el buscador.
CREATE OR REPLACE FUNCTION entrada_insumos(p_neg TEXT, p_token TEXT)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT i.datos
    FROM negocio_insumos i
    WHERE i.negocio_id = p_neg AND _entrada_token_ok(p_neg, p_token);
$$;

-- 5) ANON: registra la entrada (valida token + NIP; sella registradoPor del lado servidor).
CREATE OR REPLACE FUNCTION entrada_registrar(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;
    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));
    INSERT INTO entradas_log (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object('registradoPor', v_nombre, 'origen', 'qr'));
    RETURN v_id;
END;
$$;

-- 6) Permisos: el anon (cel sin sesión) puede ejecutar las RPC de entradas.
GRANT EXECUTE ON FUNCTION entrada_token_asegurar(TEXT)               TO authenticated;
GRANT EXECUTE ON FUNCTION entrada_validar_nip(TEXT, TEXT, TEXT)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION entrada_insumos(TEXT, TEXT)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION entrada_registrar(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
-- _entrada_token_ok es interno (lo llaman las otras DEFINER); no se expone a anon.
REVOKE EXECUTE ON FUNCTION _entrada_token_ok(TEXT, TEXT) FROM anon;

-- ============================================================================
-- Fin v27. El QR ahora apunta a /entrada.html?n=<negocio>&t=<entrada_token>.
-- entrada.html usa SOLO estas RPC (no inicia sesión). La foto del ticket se sube
-- al bucket 'evidencias' (que ya permite subida anónima, igual que captura.html).
-- ============================================================================
