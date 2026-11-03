-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · v83 — Cierra el contrato de corrección del QR
--
-- Sale de la auditoría independiente de Codex (docs/auditoria-codex-claude-
-- 2026-11-03.md). Cinco agujeros del MISMO recorrido: por separado cada uno
-- parece chico; juntos dejan que una cantidad cambie sin que nadie lo note.
--
--   H03  Reenviar la captura original por la puerta vieja pisaba una
--        corrección ya confirmada y se llevaba su auditoría.
--   H06  La captura de una entrada guarda su comentario en `notas`; el editor
--        y el historial de la v82 usaban `nota`. El editor abría sin el
--        comentario, y al guardar quedaban DOS campos: el QR leía uno y el
--        ERP seguía leyendo el otro.
--   H07  Si se perdía la respuesta y la persona corregía el número antes de
--        reintentar, el servidor contestaba «ya estaba» a un contenido que
--        nunca guardó.
--   H08  La lista de campos editables de una entrada incluía `concepto`, que
--        no es un comentario: decide si el movimiento es entrada, merma o
--        salida. Un colaborador podía convertir su entrada en merma.
--   H09  El cierre de un inventario de BARRA bloqueaba correcciones de
--        COCINA: el guardia del periodo no miraba el área, aunque el historial
--        sí calcula su corte por área.
--
-- Las tres funciones de abajo son las de la v82 con esos cambios y nada más:
-- se copiaron enteras a propósito. Reescribirlas de memoria fue lo primero que
-- intenté y perdí seis campos que el cliente lee (`meta`, `insumoId`, `hora`,
-- `aplicado`, `descartado`, `creado`) sin que nada se quejara.
--
-- Idempotente. Se corre a mano en Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) EL PERIODO, POR ÁREA ─────────────────────────────────────────────────
-- Un inventario cierra un área de una sucursal, no la sucursal entera: cerrar
-- barra no puede congelar lo que la cocina todavía está capturando.
--
-- Firma NUEVA (4 argumentos). La de 3 se retira al final, cuando ya nadie la
-- llama: dejarla viva es dejar la puerta por la que se entraba sin área.
--
-- Sin área —ni en el movimiento ni en el inventario— se compara contra
-- cualquier cierre de la sucursal, que es el comportamiento anterior y el
-- prudente: ante la duda, el movimiento está dentro.
CREATE OR REPLACE FUNCTION _entrada_periodo_cerrado(
    p_neg TEXT, p_suc TEXT, p_area TEXT, p_registrado TEXT
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM inventarios i
         WHERE i.negocio_id = p_neg
           AND (i.datos->>'cerrado')::boolean IS TRUE
           AND COALESCE(NULLIF(i.datos->>'sucursalId',''), 'suc_principal')
               = COALESCE(NULLIF(p_suc,''), 'suc_principal')
           AND (COALESCE(p_area,'') = ''
                OR COALESCE(i.datos->>'area','') = ''
                OR i.datos->>'area' = p_area)
           AND p_registrado IS NOT NULL AND p_registrado <> ''
           AND COALESCE(i.datos->>'cierreOperativo', (i.datos->>'fecha') || 'T23:59:59')
               >= p_registrado);
$$;

-- ── 2) EL HISTORIAL ─────────────────────────────────────────────────────────
-- Igual que la v82, con tres cambios: lee el comentario donde de verdad vive,
-- pregunta por el periodo de SU área, y dice que una merma no se corrige aquí.
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
                 -- EL COMENTARIO DE UNA ENTRADA VIVE EN `notas`: es donde lo
                 -- escribe la captura y donde lo lee el ERP. `nota` solo lo
                 -- escribió el editor de la v82 estos días; se sigue leyendo
                 -- para no esconder esos comentarios, pero ya no se guarda ahí.
                 'nota',      COALESCE(NULLIF(e.datos->>'notas',''), NULLIF(e.datos->>'nota','')),
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
                     AND COALESCE(e.datos->>'concepto','') = 'entrada'
                     AND NOT _entrada_periodo_cerrado(p_neg, p_suc, COALESCE(NULLIF(e.datos->>'area',''), p_area),
                             COALESCE(e.datos->>'registrado', e.created_at::text)),
                 'motivoBloqueo', CASE
                     WHEN _entrada_periodo_cerrado(p_neg, p_suc, COALESCE(NULLIF(e.datos->>'area',''), p_area),
                              COALESCE(e.datos->>'registrado', e.created_at::text))
                         THEN 'Ya entró en un inventario cerrado'
                     WHEN COALESCE(e.datos->>'staffId','') <> (v_yo->>'staffId') AND NOT v_ajeno
                         THEN 'La capturó alguien más'
                     WHEN COALESCE(e.datos->>'concepto','') <> 'entrada'
                         THEN 'Aquí solo se corrigen entradas'
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

-- ── 3) EL EDITOR ────────────────────────────────────────────────────────────
-- Igual que la v82, con cuatro cambios: `concepto` sale de la lista blanca,
-- el registro tiene que SER una entrada, el periodo se pregunta por área, y
-- una operación repetida solo vale si trae el mismo contenido.
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
    v_creado TEXT;
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
        SELECT datos, created_at::text INTO v_d, v_creado FROM entradas_log
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
    /* …pero solo si trae el MISMO contenido. Si se perdió la respuesta y la
       persona corrigió el número antes de reintentar, el celular manda la
       operación vieja con datos nuevos: contestarle «ya estaba» deja guardado
       el valor anterior mientras la pantalla enseña el otro. Con contenido
       distinto se sigue adelante y la VERSIÓN decide — que es como se entera
       de que su primer intento sí había entrado. */
    IF p_op IS NOT NULL AND p_op <> '' AND v_d->>'ultimaOp' = p_op THEN
        IF COALESCE(v_d->'ultimaOpCambios', 'null'::jsonb) = COALESCE(p_cambios, 'null'::jsonb) THEN
            RETURN jsonb_build_object('ok', true, 'ver', v_ver, 'repetida', true);
        END IF;
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
        IF COALESCE(v_d->>'concepto','') <> 'entrada' THEN
            RETURN jsonb_build_object('ok', false, 'motivo', 'tipo');
        END IF;
        /* Sin `registrado` el guardia del periodo dejaba pasar: `''` le hace
           contestar que no hay cierre. El historial ya usaba `created_at` de
           respaldo; el editor miraba otra cosa, y lector y escritor no pueden
           estar en desacuerdo sobre a qué periodo pertenece una captura. */
        v_reg := COALESCE(NULLIF(v_d->>'registrado',''), v_creado, '');
        IF _entrada_periodo_cerrado(p_neg, v_suc, COALESCE(v_d->>'area',''), v_reg) THEN
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
                   ELSE ARRAY['cantidad','notas','evidencia'] END;
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

    IF p_tipo = 'entrada' AND (v_limpio ? 'notas') THEN
        v_d := v_d - 'nota';
    END IF;

    v_d := v_d || jsonb_build_object(
        'ver',        v_ver + 1,
        'editadoPor', v_yo->>'nombre',
        'editadoEn',  to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'ultimaOp',       COALESCE(NULLIF(p_op,''), NULL),
        'ultimaOpCambios', p_cambios,
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

-- ── 4) LA PUERTA VIEJA DEL CONTEO ───────────────────────────────────────────
-- Igual que la v82, con un cambio: un reenvío no es una edición.
CREATE OR REPLACE FUNCTION inventario_conteo_registrar(
    p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_nombre TEXT; v_id TEXT; v_filas INT; v_yo JSONB; v_prev JSONB; v_verCli INT; v_extra JSONB;
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
        /* UN REENVÍO NO ES UNA EDICIÓN. El cliente manda la versión que cree
           estar actualizando. Si no la trae, o si trae una vieja, lo que llegó
           es una copia de antes —la cola de salida reintentando, o el mismo
           celular que no se enteró de la corrección—: se devuelve el id y no
           se toca nada. Antes esto reemplazaba `datos` entero y se llevaba por
           delante la corrección Y su auditoría, sin dejar rastro de que hubo
           dos valores. Para corregir está `entrada_editar`, que pide versión,
           comprueba permisos y deja bitácora. */
        v_verCli := NULLIF(p_datos->>'ver','')::int;
        IF v_verCli IS NULL OR v_verCli < COALESCE((v_prev->>'ver')::int, 1) THEN
            RETURN v_id;
        END IF;
    END IF;

    /* La bitadera de correcciones NO se pierde al reescribir: es el rastro de
       que una cantidad cambió, y es justo lo que alguien querría borrar. */
    v_extra := jsonb_build_object(
                'contadoPor', v_nombre,
                'staffId',    v_yo->>'staffId',
                'origen',     'qr',
                'ver',        COALESCE((v_prev->>'ver')::int, 0) + 1,
                'registrado', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    IF v_prev ? 'auditoria'  THEN v_extra := v_extra || jsonb_build_object('auditoria',  v_prev->'auditoria');  END IF;
    IF v_prev ? 'editadoPor' THEN v_extra := v_extra || jsonb_build_object('editadoPor', v_prev->>'editadoPor'); END IF;
    IF v_prev ? 'editadoEn'  THEN v_extra := v_extra || jsonb_build_object('editadoEn',  v_prev->>'editadoEn');  END IF;

    INSERT INTO inventario_conteos (id, negocio_id, datos)
    VALUES (v_id, p_neg, p_datos || v_extra)
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

-- ── 5) PERMISOS ─────────────────────────────────────────────────────────────
-- OJO (v72): en Supabase `REVOKE … FROM PUBLIC` NO le quita el permiso a
-- `anon`. Hay que nombrarlo.
REVOKE ALL ON FUNCTION _entrada_periodo_cerrado(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION entrada_editar(TEXT,TEXT,TEXT,TEXT,TEXT,INT,JSONB,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_editar(TEXT,TEXT,TEXT,TEXT,TEXT,INT,JSONB,TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_historial(TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION inventario_conteo_registrar(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventario_conteo_registrar(TEXT,TEXT,TEXT,JSONB) TO anon, authenticated;

-- ── 6) LA PUERTA VIEJA SE CIERRA ────────────────────────────────────────────
-- La versión de 3 argumentos ya no la llama nadie. Dejarla viva es dejar
-- abierta la ruta que no mira el área — y la siguiente función que se escriba
-- la encontraría primero por ser la más corta.
DROP FUNCTION IF EXISTS _entrada_periodo_cerrado(TEXT, TEXT, TEXT);
