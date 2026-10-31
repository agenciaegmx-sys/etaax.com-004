-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · v82 — CORREGIR UN CONTEO O UNA ENTRADA YA ENVIADOS DESDE EL QR
--
-- Lo pidió Edwin: quien captura desde el celular se equivoca —teclea 10 donde
-- eran 8— y hoy no hay manera de corregirlo. Lo único que puede hacer es
-- mandar otro registro, y entonces el inventario cuenta los dos.
--
-- ESTO NO ES «AGREGAR UN BOTÓN». Un editor necesita cinco cosas que hoy no
-- existen, y por eso la migración va ANTES que la pantalla:
--
--   1. SABER CUÁL REGISTRO ES. `entrada_historial` no devuelve el `id`: la
--      pantalla enseña qué, cuánto y a qué hora, pero no tiene con qué
--      referirse al renglón. Sin id no hay edición posible.
--
--   2. UNA VERSIÓN. Dos celulares pueden tener abierta la misma captura. Sin
--      versión, el segundo que guarda pisa al primero y nadie se entera. Con
--      versión, el segundo recibe «esto cambió, vuelve a cargar» y decide.
--
--   3. UNA IDENTIDAD ESTABLE. El historial dice quién capturó por su NOMBRE.
--      Un nombre no autoriza nada: en un negocio hay tres Diegos. La
--      autorización se resuelve contra el `staffId` que el NIP identifica.
--
--   4. UN ESTADO. Un conteo YA APLICADO al inventario no se puede corregir por
--      detrás: el inventario ya se movió. Eso se rechaza con su motivo, y la
--      rectificación es otro trámite —un ajuste autorizado— que no es esto.
--
--   5. QUE LA PUERTA VIEJA NO SE SALTE LO ANTERIOR. `inventario_conteo_registrar`
--      trae un `ON CONFLICT (id) DO UPDATE` que reemplaza `datos` entero
--      cotejando solo el negocio. Tal cual, cualquiera con el token y un NIP
--      válido podía reenviar el mismo id y REINICIAR un conteo ya aplicado,
--      sin permiso, sin versión y sin dejar rastro. Se le ponen los mismos
--      candados que al editor.
--
--
-- UN BUG QUE SALIÓ EN EL CAMINO (y que no tiene que ver con editar):
-- `inventario_conteo_registrar` guarda el autor en `contadoPor`, pero
-- `entrada_historial` lo lee de `registradoPor`. O sea que la columna «quién»
-- de los conteos venía VACÍA desde la v76. Se corrige leyendo los dos.
--
--
-- QUÉ NO HACE ESTA MIGRACIÓN, A PROPÓSITO
--   · No cambia de producto, de sucursal ni de fecha operativa. Corregir una
--     cantidad es una cosa; mover un movimiento de un producto a otro o de un
--     periodo a otro es una transferencia de inventario, y esa necesita el
--     flujo autorizado del ERP.
--   · No borra. Una captura equivocada se corrige o se cancela desde el ERP.
--   · No toca `datos` de ninguna fila existente: `ver` ausente se lee como 1.
--
-- Idempotente: CREATE OR REPLACE. Se corre a mano en Supabase → SQL Editor.
-- La comprobación va al final, en una sola instrucción.
--
-- YA SE CORRIÓ ANTES DE MANDARLA, contra un Postgres de verdad:
--     PGLITE_DIR=/tmp/etaax-billing-sql node tests/probar-sql-v82.mjs
-- Esa prueba PROVOCA primero los agujeros con las definiciones que hay hoy
-- —extraídas de las v78/v79, no reescritas— y después corre este archivo:
--   · el historial no trae el id del registro (no hay con qué editar),
--   · la columna «quién» de los conteos viene vacía,
--   · y cualquiera con el token y un NIP válido REINICIA un conteo ya aplicado
--     reenviando su id, perdiendo el sello de aplicado y firmándolo con otro
--     nombre.
-- Después verifica 30 casos: corregir lo propio, el conflicto de versiones, el
-- reintento idempotente, el cero permitido en conteos y prohibido en entradas,
-- borrar un comentario de verdad, que no se pueda cambiar producto/sucursal/
-- periodo, quién puede y quién no, lo aplicado y lo cerrado, los permisos de
-- `anon` y que correrla dos veces no cambie nada.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) ¿Quién es quien trae este NIP? ───────────────────────────────────────
-- Identidad ESTABLE (el id del colaborador), no su nombre. Devuelve NULL si el
-- NIP no corresponde a nadie activo de ese negocio. No llama al guardia: lo
-- llaman las funciones de abajo, que ya lo invocaron una vez.
CREATE OR REPLACE FUNCTION _entrada_quien(p_neg TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
               'staffId',  s.id,
               'nombre',   COALESCE(NULLIF(s.datos->>'nombre',''), 'Sin nombre'),
               'rol',      COALESCE(NULLIF(s.datos->>'rol',''), 'otro'),
               'sucursal', COALESCE(NULLIF(s.datos->>'sucursalId',''), 'suc_principal'),
               'area',     COALESCE(NULLIF(s.datos->>'area',''), ''))
      FROM staff s
     WHERE s.negocio_id = p_neg
       AND s.datos->>'nipHash' = p_niphash
       AND COALESCE(NULLIF(s.datos->>'estado',''), 'Activo') = 'Activo'
       AND p_niphash IS NOT NULL AND p_niphash <> ''
     LIMIT 1;
$$;

-- ¿Puede corregir capturas AJENAS? Solo quien encabeza la operación. La lista
-- es corta y explícita a propósito: un permiso que se hereda por descuido es
-- el que nadie revisa. Lo propio siempre se puede corregir (ver abajo).
CREATE OR REPLACE FUNCTION _entrada_edita_ajeno(p_rol TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(p_rol,'') IN ('admin','gerente','administrativo');
$$;

-- ── 2) El periodo: ¿este movimiento ya quedó dentro de un cierre? ───────────
-- Si hay un inventario CERRADO de esa sucursal cuyo corte es posterior al
-- momento del registro, el movimiento ya entró en un resultado firmado.
CREATE OR REPLACE FUNCTION _entrada_periodo_cerrado(p_neg TEXT, p_suc TEXT, p_registrado TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM inventarios i
         WHERE i.negocio_id = p_neg
           AND (i.datos->>'cerrado')::boolean IS TRUE
           AND COALESCE(NULLIF(i.datos->>'sucursalId',''), 'suc_principal')
               = COALESCE(NULLIF(p_suc,''), 'suc_principal')
           AND p_registrado IS NOT NULL AND p_registrado <> ''
           AND COALESCE(i.datos->>'cierreOperativo', (i.datos->>'fecha') || 'T23:59:59')
               >= p_registrado);
$$;

-- ── 3) El historial, ahora con lo que hace falta para corregir ──────────────
-- Agrega `id`, `tipo`, `ver` y por qué SÍ o NO se puede editar, resuelto en el
-- servidor. Sigue siendo una lista acotada campo por campo: ni el JSON
-- completo, ni costos, ni hashes.
CREATE OR REPLACE FUNCTION entrada_historial(
    p_neg     TEXT,
    p_token   TEXT,
    p_niphash TEXT,
    p_suc     TEXT,
    p_area    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_desde TEXT;
    v_inv   TEXT;
    v_movs  JSONB;
    v_cnts  JSONB;
    v_yo    JSONB;
    v_ajeno BOOLEAN;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN jsonb_build_object('ok', false, 'motivo', 'nip'); END IF;
    IF NOT _entrada_token_ok(p_neg, p_token) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'token');
    END IF;
    v_yo := _entrada_quien(p_neg, p_niphash);
    IF v_yo IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nip');
    END IF;
    v_ajeno := _entrada_edita_ajeno(v_yo->>'rol');

    /* El corte del periodo: el último inventario CERRADO de esta sucursal y
       área. `cierreOperativo` es el momento real en que terminó el conteo;
       los inventarios viejos no lo traen, así que se usa el final de su día. */
    SELECT COALESCE(i.datos->>'cierreOperativo', (i.datos->>'fecha') || 'T23:59:59'),
           i.datos->>'nombre'
      INTO v_desde, v_inv
      FROM inventarios i
     WHERE i.negocio_id = p_neg
       AND (i.datos->>'cerrado')::boolean IS TRUE
       AND COALESCE(NULLIF(i.datos->>'sucursalId', ''), 'suc_principal')
           = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
       AND (p_area IS NULL OR p_area = '' OR i.datos->>'area' = p_area)
     ORDER BY COALESCE(i.datos->>'cierreOperativo', i.datos->>'fecha') DESC
     LIMIT 1;

    /* Movimientos del periodo, del más nuevo al más viejo: lo que acaba de
       capturar el compañero es lo que hay que ver primero. */
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'registrado' DESC), '[]'::jsonb)
      INTO v_movs
      FROM (
        SELECT jsonb_build_object(
                 'id',        e.id,
                 'tipo',      'entrada',
                 'ver',       COALESCE((e.datos->>'ver')::int, 1),
                 'concepto',  e.datos->>'concepto',
                 'nombre',    e.datos->>'nombre',
                 'cantidad',  e.datos->>'cantidad',
                 'unidad',    e.datos->>'unidad',
                 'nota',      NULLIF(e.datos->>'nota',''),
                 'fecha',     e.datos->>'fecha',
                 'hora',      e.datos->>'hora',
                 'quien',     e.datos->>'registradoPor',
                 'editadoPor', NULLIF(e.datos->>'editadoPor',''),
                 'registrado', COALESCE(e.datos->>'registrado', e.created_at::text),
                 /* Editable lo resuelve el SERVIDOR, no la pantalla: apagar un
                    botón no es un control, y la RPC vuelve a comprobarlo. Esto
                    es para poder DECIR por qué, que es lo que falta cuando un
                    botón aparece deshabilitado sin explicación. */
                 'puedeEditar',
                     (COALESCE(e.datos->>'staffId','') = (v_yo->>'staffId') OR v_ajeno)
                     AND NOT _entrada_periodo_cerrado(p_neg, p_suc,
                             COALESCE(e.datos->>'registrado', e.created_at::text)),
                 'motivoBloqueo', CASE
                     WHEN _entrada_periodo_cerrado(p_neg, p_suc,
                              COALESCE(e.datos->>'registrado', e.created_at::text))
                         THEN 'Ya entró en un inventario cerrado'
                     WHEN COALESCE(e.datos->>'staffId','') <> (v_yo->>'staffId') AND NOT v_ajeno
                         THEN 'La capturó alguien más'
                     ELSE NULL END
               ) AS x
          FROM entradas_log e
         WHERE e.negocio_id = p_neg
           AND COALESCE(e.datos->>'borrada', 'false') <> 'true'
           AND COALESCE(NULLIF(e.datos->>'sucursalId', ''), 'suc_principal')
               = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
           AND (v_desde IS NULL
                OR COALESCE(e.datos->>'registrado', e.created_at::text) > v_desde)
      ) t;

    /* Conteos: lo que ya se contó en este periodo. Es el dato que evita el
       trabajo repetido — el más caro de todos en un inventario. */
    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'creado' DESC), '[]'::jsonb)
      INTO v_cnts
      FROM (
        SELECT jsonb_build_object(
                 'id',     c.id,
                 'tipo',   'conteo',
                 'ver',    COALESCE((c.datos->>'ver')::int, 1),
                 'nombre', c.datos->>'nombre',
                 'cerradasBodega', c.datos->>'cerradasBodega',
                 'cerradasBarra',  c.datos->>'cerradasBarra',
                 'meta',     c.datos->>'meta',
                 'insumoId', c.datos->>'insumoId',
                 'nota',   NULLIF(c.datos->>'nota', ''),
                 'fecha',  c.datos->>'fecha',
                 'hora',   c.datos->>'hora',
                 -- EL AUTOR DE UN CONTEO SE GUARDA EN `contadoPor`, no en
                 -- `registradoPor`: la columna «quién» venía vacía desde la
                 -- v76 porque se leía la llave equivocada. Se leen las dos,
                 -- que es lo que hace servir también a los datos viejos.
                 'quien',  COALESCE(NULLIF(c.datos->>'contadoPor',''), c.datos->>'registradoPor'),
                 'editadoPor', NULLIF(c.datos->>'editadoPor',''),
                 'aplicado',   COALESCE((c.datos->>'aplicado')::boolean, false),
                 'descartado', COALESCE((c.datos->>'descartado')::boolean, false),
                 'creado', c.created_at::text,
                 'puedeEditar',
                     (COALESCE(c.datos->>'staffId','') = (v_yo->>'staffId') OR v_ajeno)
                     AND COALESCE((c.datos->>'aplicado')::boolean, false) IS NOT TRUE
                     AND COALESCE((c.datos->>'descartado')::boolean, false) IS NOT TRUE,
                 'motivoBloqueo', CASE
                     WHEN COALESCE((c.datos->>'aplicado')::boolean, false)
                         THEN 'Ya se aplicó al inventario'
                     WHEN COALESCE((c.datos->>'descartado')::boolean, false)
                         THEN 'Se descartó en el inventario'
                     WHEN COALESCE(c.datos->>'staffId','') <> (v_yo->>'staffId') AND NOT v_ajeno
                         THEN 'Lo contó alguien más'
                     ELSE NULL END
               ) AS x
          FROM inventario_conteos c
         WHERE c.negocio_id = p_neg
           AND COALESCE(NULLIF(c.datos->>'sucursalId', ''), 'suc_principal')
               = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
           AND (p_area IS NULL OR p_area = '' OR c.datos->>'area' = p_area)
           AND (v_desde IS NULL OR c.created_at::text > v_desde)
      ) t;

    RETURN jsonb_build_object(
        'ok',          true,
        'desde',       v_desde,
        'inventario',  v_inv,
        'yo',          jsonb_build_object('staffId', v_yo->>'staffId',
                                          'nombre',  v_yo->>'nombre',
                                          'editaAjeno', v_ajeno),
        'movimientos', v_movs,
        'conteos',     v_cnts);
END;
$$;

-- ── 4) El editor ────────────────────────────────────────────────────────────
-- Corrige CANTIDADES y texto de captura. Conserva id, autor, fecha de alta,
-- fecha operativa, producto, sucursal y área. Sube la versión y deja rastro.
--
-- `p_op` es el identificador de la operación: con mala conexión el celular
-- reintenta, y sin esto el segundo intento contaría como otra edición (otra
-- versión, otro renglón de auditoría) por un cambio que ya estaba hecho.
CREATE OR REPLACE FUNCTION entrada_editar(
    p_neg     TEXT,
    p_token   TEXT,
    p_niphash TEXT,
    p_tipo    TEXT,          -- 'conteo' | 'entrada'
    p_id      TEXT,
    p_ver     INT,
    p_cambios JSONB,
    p_op      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_yo     JSONB;
    v_d      JSONB;
    v_ver    INT;
    v_suc    TEXT;
    v_reg    TEXT;
    v_limpio JSONB := '{}'::jsonb;
    v_antes  JSONB := '{}'::jsonb;
    v_k      TEXT;
    v_num    NUMERIC;
    v_perm   TEXT[];
BEGIN
    -- El freno de la v78 va PRIMERO y su rechazo no lanza excepción: una
    -- excepción revierte la transacción y se lleva el apunte del intento
    -- fallido, que fue el agujero que arregló la v79.
    IF NOT _nip_guardia(p_neg, p_niphash) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'espera');
    END IF;
    IF NOT _entrada_token_ok(p_neg, p_token) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'token');
    END IF;
    v_yo := _entrada_quien(p_neg, p_niphash);
    IF v_yo IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nip');
    END IF;
    IF p_tipo NOT IN ('conteo','entrada') OR COALESCE(p_id,'') = '' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'datos');
    END IF;

    -- La fila se toma BLOQUEADA: editar y aplicar tienen que pelearse por la
    -- misma fila, no cada uno por su copia.
    IF p_tipo = 'conteo' THEN
        SELECT datos INTO v_d FROM inventario_conteos
         WHERE id = p_id AND negocio_id = p_neg FOR UPDATE;
    ELSE
        SELECT datos INTO v_d FROM entradas_log
         WHERE id = p_id AND negocio_id = p_neg FOR UPDATE;
    END IF;
    -- NEUTRO: no se dice «es de otro negocio», que confirmaría que ese id
    -- existe en algún lado.
    IF v_d IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'no-existe');
    END IF;

    v_ver := COALESCE((v_d->>'ver')::int, 1);
    v_suc := COALESCE(NULLIF(v_d->>'sucursalId',''), 'suc_principal');

    -- REINTENTO DEL MISMO CAMBIO: ya está hecho, se contesta que sí sin
    -- escribir otra vez ni apuntar otra edición.
    IF p_op IS NOT NULL AND p_op <> '' AND v_d->>'ultimaOp' = p_op THEN
        RETURN jsonb_build_object('ok', true, 'ver', v_ver, 'repetida', true);
    END IF;

    -- PERTENENCIA: la sucursal sale del NIP, nunca del enlace (igual que en la
    -- v80). Elegir una sucursal en el cliente no da acceso a ella.
    IF v_suc <> (v_yo->>'sucursal') AND NOT _entrada_edita_ajeno(v_yo->>'rol') THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'ajeno');
    END IF;

    -- AUTORÍA: lo propio se corrige; lo de otro, solo con permiso. Y nunca por
    -- coincidencia de NOMBRE: un registro viejo sin `staffId` no tiene autoría
    -- demostrable, así que solo lo toca un encargado.
    IF COALESCE(v_d->>'staffId','') <> (v_yo->>'staffId')
       AND NOT _entrada_edita_ajeno(v_yo->>'rol') THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'autor');
    END IF;

    -- ESTADO. Un conteo ya aplicado movió el inventario; corregirlo por detrás
    -- dejaría el inventario diciendo una cosa y el conteo otra.
    IF p_tipo = 'conteo' THEN
        IF COALESCE((v_d->>'aplicado')::boolean, false) THEN
            RETURN jsonb_build_object('ok', false, 'motivo', 'aplicado');
        END IF;
        IF COALESCE((v_d->>'descartado')::boolean, false) THEN
            RETURN jsonb_build_object('ok', false, 'motivo', 'descartado');
        END IF;
    ELSE
        IF COALESCE(v_d->>'borrada','false') = 'true' THEN
            RETURN jsonb_build_object('ok', false, 'motivo', 'borrada');
        END IF;
        v_reg := COALESCE(v_d->>'registrado', '');
        IF _entrada_periodo_cerrado(p_neg, v_suc, v_reg) THEN
            RETURN jsonb_build_object('ok', false, 'motivo', 'cerrado');
        END IF;
    END IF;

    -- VERSIÓN. Dos celulares con la misma captura abierta: el segundo se
    -- entera en vez de pisar al primero.
    IF p_ver IS NOT NULL AND p_ver <> v_ver THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'conflicto', 'ver', v_ver);
    END IF;

    -- LISTA BLANCA DE LO EDITABLE. Lo que no está enumerado no se toca: ni
    -- producto, ni sucursal, ni fecha operativa, ni el autor, ni `registrado`
    -- —que es con lo que se decide a qué periodo pertenece la captura: ponerlo
    -- «ahora» movería el movimiento de inventario—.
    v_perm := CASE WHEN p_tipo = 'conteo'
                   THEN ARRAY['cerradasBodega','cerradasBarra','nota']
                   ELSE ARRAY['cantidad','nota','concepto','evidencia'] END;
    FOREACH v_k IN ARRAY v_perm LOOP
        IF p_cambios ? v_k THEN
            IF v_k IN ('cerradasBodega','cerradasBarra','cantidad') THEN
                BEGIN
                    v_num := (p_cambios->>v_k)::numeric;
                EXCEPTION WHEN OTHERS THEN
                    RETURN jsonb_build_object('ok', false, 'motivo', 'cantidad');
                END;
                -- Un conteo se puede corregir a CERO (se contó y no había
                -- nada). Una entrada de cero no es una entrada.
                IF v_num IS NULL OR v_num < 0 OR v_num > 1e9
                   OR (v_k = 'cantidad' AND v_num <= 0) THEN
                    RETURN jsonb_build_object('ok', false, 'motivo', 'cantidad');
                END IF;
                v_limpio := v_limpio || jsonb_build_object(v_k, v_num);
            ELSE
                -- Texto: se recorta y, vacío, se QUITA la llave (borrar un
                -- comentario tiene que poder borrarlo de verdad — la trampa de
                -- los guardados parciales que documenta CLAUDE.md).
                v_limpio := v_limpio || jsonb_build_object(v_k,
                    NULLIF(btrim(COALESCE(p_cambios->>v_k,'')), ''));
            END IF;
            v_antes := v_antes || jsonb_build_object(v_k, v_d->v_k);
        END IF;
    END LOOP;
    IF v_limpio = '{}'::jsonb THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'sin-cambios');
    END IF;

    /* El merge: primero lo nuevo, y DESPUÉS se restan las llaves vacías. Al
       revés —limpiando antes— un texto vaciado se vuelve «no mandé esa llave»
       y el valor viejo se queda en su sitio: borrar sería imposible. */
    v_d := v_d || v_limpio;
    FOREACH v_k IN ARRAY v_perm LOOP
        IF (v_limpio ? v_k) AND v_limpio->v_k = 'null'::jsonb THEN
            v_d := v_d - v_k;
        END IF;
    END LOOP;

    v_d := v_d || jsonb_build_object(
        'ver',        v_ver + 1,
        'editadoPor', v_yo->>'nombre',
        'editadoEn',  to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'ultimaOp',   COALESCE(NULLIF(p_op,''), NULL),
        -- Rastro antes/después, podado: es una bitácora de correcciones, no un
        -- archivo histórico, y cada renglón engorda el JSON de la captura.
        'auditoria',  (
            SELECT jsonb_agg(x) FROM (
                SELECT x FROM jsonb_array_elements(
                    COALESCE(v_d->'auditoria','[]'::jsonb) ||
                    jsonb_build_array(jsonb_build_object(
                        'ts',     to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                        'quien',  v_yo->>'nombre',
                        'staffId',v_yo->>'staffId',
                        'antes',  v_antes,
                        'despues',v_limpio))) AS x
                 OFFSET GREATEST(0, jsonb_array_length(COALESCE(v_d->'auditoria','[]'::jsonb)) + 1 - 20)
            ) q));

    IF p_tipo = 'conteo' THEN
        UPDATE inventario_conteos SET datos = v_d WHERE id = p_id AND negocio_id = p_neg;
    ELSE
        UPDATE entradas_log       SET datos = v_d WHERE id = p_id AND negocio_id = p_neg;
    END IF;

    RETURN jsonb_build_object('ok', true, 'ver', v_ver + 1, 'registro', v_d - 'auditoria');
END;
$$;

-- ── 5) La puerta vieja, con los mismos candados ─────────────────────────────
-- `inventario_conteo_registrar` conserva su firma y su comportamiento para un
-- conteo NUEVO. Lo que cambia es el reenvío del mismo id: ya no reemplaza
-- `datos` a ciegas. Un conteo aplicado o descartado no se puede reiniciar por
-- esta vía, y el reenvío solo lo acepta quien lo capturó (o un encargado).
-- Además sella `staffId`, que es lo que hace posible autorizar una edición.
CREATE OR REPLACE FUNCTION inventario_conteo_registrar(
    p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT; v_filas INT; v_yo JSONB; v_prev JSONB;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        -- Sin excepción: el guardia ya anotó el fallo y una excepción se lo
        -- llevaría (v79).
        RETURN NULL;
    END IF;
    v_yo := _entrada_quien(p_neg, p_niphash);
    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));

    SELECT datos INTO v_prev FROM inventario_conteos
     WHERE id = v_id AND negocio_id = p_neg FOR UPDATE;

    IF v_prev IS NOT NULL THEN
        -- REENVÍO DEL MISMO ID. Antes esto reemplazaba `datos` entero cotejando
        -- solo el negocio: se podía reiniciar un conteo ya aplicado, sin
        -- permiso y sin rastro.
        IF COALESCE((v_prev->>'aplicado')::boolean, false)
           OR COALESCE((v_prev->>'descartado')::boolean, false) THEN
            RETURN NULL;
        END IF;
        IF COALESCE(v_prev->>'staffId','') <> COALESCE(v_yo->>'staffId','')
           AND NOT _entrada_edita_ajeno(v_yo->>'rol') THEN
            RETURN NULL;
        END IF;
    END IF;

    INSERT INTO inventario_conteos (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object(
                'contadoPor', v_nombre,
                'staffId',    v_yo->>'staffId',
                'origen',     'qr',
                'ver',        COALESCE((v_prev->>'ver')::int, 0) + 1,
                'registrado', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
    ON CONFLICT (id) DO UPDATE
        SET datos = EXCLUDED.datos
        WHERE inventario_conteos.negocio_id = p_neg;

    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas = 0 THEN
        RAISE EXCEPTION 'No se pudo registrar el conteo';
    END IF;
    RETURN v_id;
END;
$$;

-- ── 6) La entrada nueva también sella su autor ──────────────────────────────
-- Sin `staffId` en el registro no hay a quién autorizar después, y «se llama
-- igual» no es una identidad.
CREATE OR REPLACE FUNCTION entrada_registrar(p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT; v_yo JSONB;
BEGIN
    v_nombre := entrada_validar_nip(p_neg, p_token, p_niphash);
    IF v_nombre IS NULL THEN
        RETURN NULL;              -- sin excepción: el apunte del intento vive (v79)
    END IF;
    v_yo := _entrada_quien(p_neg, p_niphash);
    v_id := COALESCE(NULLIF(p_datos->>'id', ''), replace(gen_random_uuid()::text, '-', ''));
    INSERT INTO entradas_log (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || jsonb_build_object(
                'registradoPor', v_nombre,
                'staffId',       v_yo->>'staffId',
                'origen',        'qr',
                'ver',           1,
                'registrado',    COALESCE(NULLIF(p_datos->>'registrado',''),
                                          to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
    RETURN v_id;
END;
$$;

-- ── 7) Permisos ─────────────────────────────────────────────────────────────
-- OJO (v72): en Supabase `REVOKE … FROM PUBLIC` NO le quita el permiso a
-- `anon`. Hay que nombrarlo.
REVOKE ALL ON FUNCTION _entrada_quien(TEXT, TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _entrada_edita_ajeno(TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _entrada_periodo_cerrado(TEXT, TEXT, TEXT)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION entrada_editar(TEXT,TEXT,TEXT,TEXT,TEXT,INT,JSONB,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_editar(TEXT,TEXT,TEXT,TEXT,TEXT,INT,JSONB,TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION inventario_conteo_registrar(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventario_conteo_registrar(TEXT,TEXT,TEXT,JSONB) TO anon, authenticated;
REVOKE ALL ON FUNCTION entrada_registrar(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_registrar(TEXT,TEXT,TEXT,JSONB) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — una sola instrucción (el editor solo enseña la última).
-- No lee definiciones: CORRE las funciones. Una prueba que busca un texto
-- sobrevive a que el código deje de funcionar.
-- ════════════════════════════════════════════════════════════════════════════
SELECT * FROM (
    SELECT 1 AS n, 'la lista de quién corrige lo ajeno es corta y explícita' AS prueba,
           CASE WHEN _entrada_edita_ajeno('gerente') AND NOT _entrada_edita_ajeno('barman')
                 AND NOT _entrada_edita_ajeno(NULL)
                THEN 'PASA' ELSE 'FALLA' END AS r
    UNION ALL
    SELECT 2, 'un tipo que no existe se rechaza sin tocar nada',
           CASE WHEN (entrada_editar('__neg_v82__','t','h','otra-cosa','x',1,'{}'::jsonb)->>'ok') = 'false'
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL
    SELECT 3, 'sin token ni NIP válidos no se edita',
           CASE WHEN (entrada_editar('__neg_v82__','token-falso','nip-falso','conteo','x',1,
                        '{"cerradasBarra":3}'::jsonb)->>'ok') = 'false'
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL
    SELECT 4, 'el historial sigue pidiendo las dos llaves',
           CASE WHEN (entrada_historial('__neg_v82__','token-falso','nip-falso','suc_principal','barra')->>'ok') = 'false'
                THEN 'PASA' ELSE 'FALLA' END
) t ORDER BY n;
