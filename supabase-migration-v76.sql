-- ============================================================================
-- ETAAX — Migración v76: dos remates de la revisión
-- ----------------------------------------------------------------------------
-- 1 · EL MENSAJE DE R05 NO TIENE QUE DELATAR NADA
--    La v75 rechaza con «ese conteo es de otro negocio». Es la verdad, pero le
--    dice a quien prueba que ESE id existe en otro negocio: un oráculo chico
--    pero gratis. Un mensaje neutro rechaza igual y no confirma nada.
--    Para quien cuenta de verdad no cambia: su conteo nunca llega aquí.
--
-- 2 · LA RESTRICCIÓN DEL ID, VALIDADA
--    La v75 la dejó `NOT VALID`: controla lo que entra, pero no certifica las
--    filas anteriores. Su renglón 7 salió PASA —ningún negocio existente la
--    rompe—, así que se puede validar. Si por lo que sea hubiera alguna fila
--    mala, este ALTER falla con el nombre de la constraint y no se aplica
--    nada más: no rompe nada, solo no valida.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================

CREATE OR REPLACE FUNCTION inventario_conteo_registrar(
    p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT; v_filas INT;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;

    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));

    INSERT INTO inventario_conteos (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object(
                'contadoPor', v_nombre,
                'origen',     'qr',
                'registrado', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    ON CONFLICT (id) DO UPDATE
        SET datos = EXCLUDED.datos
        WHERE inventario_conteos.negocio_id = p_neg;

    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas = 0 THEN
        -- NEUTRO a propósito. «es de otro negocio» confirmaba que ese id
        -- existe en otro lado; esto rechaza igual sin decir por qué.
        RAISE EXCEPTION 'No se pudo registrar el conteo';
    END IF;

    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION inventario_conteo_registrar(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventario_conteo_registrar(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

ALTER TABLE negocios VALIDATE CONSTRAINT negocios_id_formato;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Los cuatro renglones deben decir PASA.
SELECT * FROM (
    SELECT 1 AS n, 'El rechazo del conteo no delata de quién es la fila' AS prueba,
           CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
                       WHERE p.proname='inventario_conteo_registrar'
                         AND p.pronamespace='public'::regnamespace)
                     LIKE '%No se pudo registrar el conteo%'
                THEN 'PASA' ELSE 'FALLA' END AS resultado
    UNION ALL SELECT 2, '…y sigue rechazando (no solo cambió el texto)',
           CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
                       WHERE p.proname='inventario_conteo_registrar'
                         AND p.pronamespace='public'::regnamespace)
                     LIKE '%WHERE inventario_conteos.negocio_id = p_neg%'
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 3, 'La restricción del id ya está VALIDADA',
           CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                              WHERE conname='negocios_id_formato'
                                AND conrelid='negocios'::regclass
                                AND convalidated)
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL SELECT 4, 'Y el conteo legítimo sigue sellando quién contó',
           CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
                       WHERE p.proname='inventario_conteo_registrar'
                         AND p.pronamespace='public'::regnamespace)
                     LIKE '%contadoPor%'
                THEN 'PASA' ELSE 'FALLA' END
) t ORDER BY n;

-- ============================================================================
-- Fin v76.
-- ============================================================================
