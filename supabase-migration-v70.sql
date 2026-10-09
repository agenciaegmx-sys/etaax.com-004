-- ============================================================================
-- ETAAX — Migración v70: una autorización que no decide, deja pasar
-- ----------------------------------------------------------------------------
-- EL BUG, EN UNA LÍNEA DE SQL
--
--     IF NOT (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin())
--     THEN RAISE EXCEPTION 'no autorizado'; END IF;
--
-- Se lee como «si no está autorizado, niégalo». Y lo hace… mientras haya
-- sesión. SIN sesión, `auth.uid()` es NULL, la comparación con NULL da NULL,
-- `NULL OR false OR false` sigue siendo NULL, `NOT NULL` es NULL — y un `IF`
-- con NULL **no entra**. El `RAISE` nunca se ejecuta y la función continúa
-- como si el permiso estuviera concedido.
--
-- La lógica de tres valores de SQL es así: NULL no es «falso», es «no sé». Un
-- candado que se abre cuando no sabe no es un candado.
--
-- LA CADENA COMPLETA (comprobada en el código, no en producción)
--   1. el id del negocio es PÚBLICO: va en la dirección de la carta del QR de
--      la mesa (`carta.html?n=<id>`), así que lo tiene cualquiera que escanee;
--   2. `entrada_token_asegurar` se quedó sin `REVOKE ... FROM PUBLIC`, y en
--      PostgreSQL una función nace con EXECUTE para PUBLIC — `anon` está
--      dentro de PUBLIC;
--   3. sin sesión, el NULL de arriba se salta la negación → devuelve el token
--      del QR de entradas;
--   4. con ese token, `entrada_insumos` devuelve `i.datos` COMPLETO: costos,
--      proveedores, todo. No es una lista blanca como la carta.
--
-- O sea: la puerta lateral que daba justo lo que la lista blanca de la carta
-- existe para no dar.
--
-- QUÉ CAMBIA AQUÍ, Y QUÉ NO
--   · Las cuatro funciones que tenían el patrón pasan a `(...) IS NOT TRUE`,
--     que SÍ niega cuando el resultado es NULL. Tres de ellas (las del menú)
--     hoy no son alcanzables por `anon` porque sí llevan su REVOKE; se
--     corrigen igual, porque la protección no puede depender de que nadie
--     conceda un permiso de más algún día.
--   · `entrada_token_asegurar` recibe además el `REVOKE ALL ... FROM PUBLIC`
--     que le faltaba.
--   · NO se revoca nada más. Hay funciones que `anon` SÍ debe poder llamar
--     —el QR de entradas, el NIP, la carta— y un barrido a ciegas apaga el
--     QR de la barra. Al final va una consulta que LISTA la superficie real
--     para decidirla con datos, no de memoria.
--
-- POR QUÉ ES SEGURO REVOCAR `entrada_token_asegurar`
-- Se verificaron sus tres llamadores, y los tres tienen sesión:
--   · administrativo/checklists.html  (lleva page-guard)
--   · recetas/inventarios.js          (su página lleva page-guard)
--   · app-movil/cuenta.js             (corre DESPUÉS del login con cuenta;
--                                      justo antes hace un select a `negocios`,
--                                      que ya exige sesión)
-- El QR de la barra NO llama a esta función: recibe el token en el enlace.
--
-- OJO (BH21): esto REESCRIBE cuatro funciones completas. Los cuerpos se
-- COPIARON de su última definición y lo único que cambia es esa línea. Los
-- candados de la carta (lista blanca, nada visible hasta prenderlo,
-- sub-recetas fuera, solo esa sucursal) y el borrado de la v69 van iguales.
--
-- `menu_publico_ver` NO SE TOCA, a propósito: valida por token y no mira
-- `auth.uid()`, porque la carta la abre un cliente sin sesión. No tiene el
-- patrón y endurecerla ahí apagaría la carta de todas las mesas.
--
-- Idempotente: se puede correr varias veces.
-- ============================================================================


-- ── 1. El token del QR de entradas (origen: v27) ────────────────────────────
-- Esta es la que estaba alcanzable sin sesión. Aquí viven las dos mitades
-- del arreglo: la negación que sí niega, y el permiso que faltaba quitar.
CREATE OR REPLACE FUNCTION entrada_token_asegurar(p_neg TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner UUID; v_tok TEXT;
BEGIN
    SELECT usuario_id, entrada_token INTO v_owner, v_tok FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'negocio no encontrado';
    END IF;
    -- `IS NOT TRUE` y no `NOT (...)`: ver la cabecera. Sin sesión, `auth.uid()`
    -- es NULL, la comparación da NULL, y un IF con NULL NO ENTRA — el
    -- `RAISE` se saltaba y la llamada seguía de largo.
    IF (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;
    IF v_tok IS NULL OR v_tok = '' THEN
        v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
        UPDATE negocios SET entrada_token = v_tok WHERE id = p_neg;
    END IF;
    RETURN v_tok;
END;
$$;

-- ── 2. El token de la carta (origen: v66) ───────────────────────────────────
-- Hoy `anon` no la alcanza (su REVOKE está puesto desde la v66). Se corrige
-- igual: que esté a salvo por el permiso Y por la lógica, no por una sola.
CREATE OR REPLACE FUNCTION menu_token_asegurar(p_neg TEXT, p_suc TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id TEXT; v_tok TEXT; v_owner UUID;
BEGIN
    SELECT usuario_id INTO v_owner FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'negocio no encontrado'; END IF;
    -- `IS NOT TRUE` y no `NOT (...)`: ver la cabecera. Sin sesión, `auth.uid()`
    -- es NULL, la comparación da NULL, y un IF con NULL NO ENTRA — el
    -- `RAISE` se saltaba y la llamada seguía de largo.
    IF (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;

    v_id := p_neg || '|' || COALESCE(NULLIF(p_suc,''), 'suc_principal');
    SELECT datos->>'token' INTO v_tok FROM menu_publico WHERE id = v_id;
    IF v_tok IS NOT NULL AND v_tok <> '' THEN RETURN v_tok; END IF;

    v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO menu_publico (id, negocio_id, datos)
    VALUES (v_id, p_neg, jsonb_build_object('token', v_tok,
                                            'sucursalId', COALESCE(NULLIF(p_suc,''), 'suc_principal')))
    ON CONFLICT (id) DO UPDATE
        SET datos = menu_publico.datos || jsonb_build_object('token', v_tok),
            updated_at = now();
    RETURN v_tok;
END;
$$;

-- ── 3. Rotar el token de la carta (origen: v66) ─────────────────────────────
CREATE OR REPLACE FUNCTION menu_token_rotar(p_neg TEXT, p_suc TEXT)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id TEXT; v_tok TEXT; v_owner UUID;
BEGIN
    SELECT usuario_id INTO v_owner FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'negocio no encontrado'; END IF;
    -- `IS NOT TRUE` y no `NOT (...)`: ver la cabecera. Sin sesión, `auth.uid()`
    -- es NULL, la comparación da NULL, y un IF con NULL NO ENTRA — el
    -- `RAISE` se saltaba y la llamada seguía de largo.
    IF (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;
    v_id  := p_neg || '|' || COALESCE(NULLIF(p_suc,''), 'suc_principal');
    v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO menu_publico (id, negocio_id, datos)
    VALUES (v_id, p_neg, jsonb_build_object('token', v_tok,
                                            'sucursalId', COALESCE(NULLIF(p_suc,''), 'suc_principal')))
    ON CONFLICT (id) DO UPDATE
        SET datos = menu_publico.datos || jsonb_build_object('token', v_tok),
            updated_at = now();
    RETURN v_tok;
END;
$$;

-- ── 4. Guardar los ajustes de la carta (origen: v69) ────────────────────────
-- Conserva TAL CUAL el arreglo de la v69: una llave ausente no se toca, una
-- llave vacía se quita (`v_vacias`, restadas DESPUÉS del merge).
CREATE OR REPLACE FUNCTION menu_cfg_guardar(p_neg TEXT, p_suc TEXT, p_cfg JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id TEXT; v_owner UUID; v_limpio JSONB; v_vacias TEXT[];
BEGIN
    SELECT usuario_id INTO v_owner FROM negocios WHERE id = p_neg;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'negocio no encontrado'; END IF;
    -- `IS NOT TRUE` y no `NOT (...)`: ver la cabecera. Sin sesión, `auth.uid()`
    -- es NULL, la comparación da NULL, y un IF con NULL NO ENTRA — el
    -- `RAISE` se saltaba y la llamada seguía de largo.
    IF (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) IS NOT TRUE THEN
        RAISE EXCEPTION 'no autorizado';
    END IF;

    -- Solo estas llaves. Una lista blanca y no un `- 'token'`: mañana habrá
    -- otro secreto en esta fila y quitarlo a mano se olvida.
    --
    -- `p_cfg ? 'x'` pregunta si la llave VIENE, sin mirar su valor. Es lo que
    -- separa «bórralo» de «no lo toqué», que antes eran lo mismo y por eso no
    -- había forma de borrar nada.
    v_limpio := jsonb_strip_nulls(jsonb_build_object(
        'nota',       CASE WHEN p_cfg ? 'nota'   THEN COALESCE(p_cfg->>'nota','')   END,
        'grupos',     p_cfg->'grupos',
        -- El texto opcional bajo el título de cada grupo: {grupo: texto}.
        'grupoNotas', p_cfg->'grupoNotas',
        -- La apariencia de la carta: colores, tipografía y los estilos de
        -- cada campo. Va como un bloque y no campo por campo porque crece
        -- con el diseño, no con el modelo.
        'tema',       p_cfg->'tema',
        -- El logo y el nombre de la sucursal, para que la carta los enseñe
        -- sin tener que consultar el catálogo del negocio: es una página
        -- pública y no puede leer nada más que su propia fila.
        'logo',       CASE WHEN p_cfg ? 'logo'   THEN COALESCE(p_cfg->>'logo','')   END,
        'sucNom',     CASE WHEN p_cfg ? 'sucNom' THEN COALESCE(p_cfg->>'sucNom','') END
    ));

    -- Las que llegaron vacías: esas se QUITAN de la fila en vez de escribirse.
    -- Guardar un '' también funcionaría para leer, pero deja basura que luego
    -- hay que recordar ignorar en cada consulta.
    SELECT COALESCE(array_agg(e.k), '{}'::TEXT[]) INTO v_vacias
      FROM jsonb_each_text(v_limpio) AS e(k, val)
     WHERE e.val = '';

    v_id := p_neg || '|' || COALESCE(NULLIF(p_suc,''), 'suc_principal');
    INSERT INTO menu_publico (id, negocio_id, datos)
    VALUES (v_id, p_neg, (v_limpio - v_vacias) || jsonb_build_object('sucursalId',
                                     COALESCE(NULLIF(p_suc,''), 'suc_principal')))
    ON CONFLICT (id) DO UPDATE
        -- Primero el merge (lo que no se mandó se queda) y DESPUÉS la resta
        -- (lo que se mandó vacío se va). En ese orden: al revés, el merge
        -- volvería a meter lo que la resta acaba de quitar.
        SET datos = (menu_publico.datos || v_limpio) - v_vacias,
            updated_at = now();
    RETURN true;
END;
$$;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- El que faltaba. Sin este REVOKE, PUBLIC conserva el EXECUTE que PostgreSQL
-- concede al crear cualquier función, y `anon` es miembro de PUBLIC.
REVOKE ALL ON FUNCTION entrada_token_asegurar(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_token_asegurar(TEXT) TO authenticated;

-- Los de las tres del menú ya estaban; se repiten porque un CREATE OR REPLACE
-- no cambia los permisos pero esta migración debe poder correrse sola.
REVOKE ALL ON FUNCTION menu_token_asegurar(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_token_asegurar(TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION menu_token_rotar(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_token_rotar(TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION menu_cfg_guardar(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION menu_cfg_guardar(TEXT, TEXT, JSONB) TO authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Los seis renglones deben decir PASA.
WITH d AS (
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
)
SELECT * FROM (
    SELECT 1 AS n, 'Ninguna autorización se salta por NULL' AS prueba,
           CASE WHEN (SELECT count(*) FROM d
                       WHERE def LIKE '%IF NOT (%auth.uid()%') = 0
                THEN 'PASA' ELSE 'FALLA' END AS resultado
    UNION ALL
    SELECT 2, 'Las cuatro niegan cuando no saben',
           CASE WHEN (SELECT count(*) FROM d
                       WHERE proname IN ('entrada_token_asegurar','menu_token_asegurar',
                                         'menu_token_rotar','menu_cfg_guardar')
                         AND def LIKE '%IS NOT TRUE%') = 4
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL
    -- Lo que de verdad cierra la puerta: que PUBLIC ya no pueda ejecutarla.
    SELECT 3, 'PUBLIC ya no puede pedir el token de entradas',
           CASE WHEN has_function_privilege('public', 'entrada_token_asegurar(text)', 'EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END
    UNION ALL
    SELECT 4, 'anon tampoco',
           CASE WHEN has_function_privilege('anon', 'entrada_token_asegurar(text)', 'EXECUTE')
                THEN 'FALLA' ELSE 'PASA' END
    UNION ALL
    -- Y que el encargado SÍ pueda: si esto falla, el QR de entradas no se
    -- puede generar desde Inventarios ni desde la app.
    SELECT 5, 'El encargado con sesión sí puede (QR de entradas vivo)',
           CASE WHEN has_function_privilege('authenticated', 'entrada_token_asegurar(text)', 'EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL
    -- La carta de las mesas no se tocó y tiene que seguir abierta a cualquiera.
    SELECT 6, 'La carta pública sigue abierta sin sesión',
           CASE WHEN has_function_privilege('anon', 'menu_publico_ver(text,text)', 'EXECUTE')
                THEN 'PASA' ELSE 'FALLA' END
) t ORDER BY n;

-- ── Para decidir el siguiente paso CON DATOS ─────────────────────────────────
-- No hace nada: solo lista qué funciones de la casa puede ejecutar todavía
-- quien llega sin sesión. Algunas DEBEN estar ahí (la carta, el NIP, el QR de
-- entradas); lo que haya de más se decide una por una, no de un barrido.
--   SELECT p.proname,
--          p.prosecdef                                       AS security_definer,
--          has_function_privilege('anon',  p.oid, 'EXECUTE') AS la_puede_anon,
--          pg_get_function_identity_arguments(p.oid)         AS argumentos
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosecdef
--      AND has_function_privilege('anon', p.oid, 'EXECUTE')
--    ORDER BY 1;

-- ============================================================================
-- Fin v70. Después de correrla, pedir el token del QR de entradas exige sesión
-- y ninguna de las cuatro autorizaciones se salta cuando no hay quién pregunte.
-- ============================================================================
