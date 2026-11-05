-- ETAAX v84 · Reauditoría 4-nov-2026: identidad, QR atómico y fechas.
-- Requiere v80/v82/v83. Transaccional e idempotente. No elimina registros.
BEGIN;

-- Las fechas sin offset son horas operativas de México; los ISO con Z/offset
-- conservan el instante que declararon. Nunca comparar timestamps como texto.
CREATE OR REPLACE FUNCTION _entrada_instante(p_text TEXT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SET search_path=public AS $$
BEGIN
 IF NULLIF(btrim(p_text),'') IS NULL THEN RETURN NULL; END IF;
 IF p_text ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' AND p_text ~ '[T ]' THEN
   RETURN p_text::timestamptz;
 END IF;
 RETURN p_text::timestamp AT TIME ZONE 'America/Mexico_City';
END;
$$;
REVOKE ALL ON FUNCTION _entrada_instante(TEXT) FROM PUBLIC, anon, authenticated;

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
           AND _entrada_instante(COALESCE(NULLIF(i.datos->>'cierreOperativo',''), (i.datos->>'fecha') || 'T23:59:59'))
               >= _entrada_instante(p_registrado));
$$;

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
     ORDER BY _entrada_instante(COALESCE(NULLIF(i.datos->>'cierreOperativo',''), i.datos->>'fecha' || 'T23:59:59')) DESC
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
                 'registrado', COALESCE(NULLIF(e.datos->>'registrado',''), e.created_at::text),
                 /* Editable lo resuelve el SERVIDOR, no la pantalla: apagar un
                    botón no es un control, y la RPC vuelve a comprobarlo. Esto
                    es para poder DECIR por qué, que es lo que falta cuando un
                    botón aparece deshabilitado sin explicación. */
                 'puedeEditar',
                     (COALESCE(e.datos->>'staffId','') = (v_yo->>'staffId') OR v_ajeno)
                     AND COALESCE(e.datos->>'concepto','') = 'entrada'
                     AND NOT _entrada_periodo_cerrado(p_neg, p_suc, COALESCE(NULLIF(e.datos->>'area',''), p_area),
                             COALESCE(NULLIF(e.datos->>'registrado',''), e.created_at::text)),
                 'motivoBloqueo', CASE
                     WHEN _entrada_periodo_cerrado(p_neg, p_suc, COALESCE(NULLIF(e.datos->>'area',''), p_area),
                              COALESCE(NULLIF(e.datos->>'registrado',''), e.created_at::text))
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
                OR COALESCE(_entrada_instante(e.datos->>'registrado'), e.created_at) > _entrada_instante(v_desde))
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
           AND (v_desde IS NULL OR c.created_at > _entrada_instante(v_desde))
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
    IF p_ver IS NULL OR p_ver <> v_ver THEN
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

-- Alta idempotente. Ni una versión futura abre una puerta de edición.
CREATE OR REPLACE FUNCTION inventario_conteo_registrar(
 p_neg TEXT, p_token TEXT, p_niphash TEXT, p_datos JSONB
) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_nombre TEXT; v_id TEXT; v_yo JSONB; v_prev JSONB;
BEGIN
 v_nombre := entrada_validar_nip(p_neg,p_token,p_niphash);
 IF v_nombre IS NULL THEN RETURN NULL; END IF;
 v_yo := _entrada_quien(p_neg,p_niphash);
 IF v_yo IS NULL THEN RETURN NULL; END IF;
 v_id := COALESCE(NULLIF(p_datos->>'id',''),replace(gen_random_uuid()::text,'-',''));
 INSERT INTO inventario_conteos(id,negocio_id,datos)
 VALUES(v_id,p_neg,(p_datos - ARRAY['auditoria','ultimaOp','ultimaOpCambios','editadoPor','editadoEn','aplicadoPor','aplicadoTs']) ||
   jsonb_build_object('id',v_id,'contadoPor',v_nombre,'staffId',v_yo->>'staffId','origen','qr',
     'ver',1,'aplicado',false,'descartado',false,'registrado',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')))
 ON CONFLICT(id) DO NOTHING;
 -- La comprobación ocurre DESPUÉS del INSERT: dos altas simultáneas también
 -- resuelven al registro que ganó, sin reemplazar sus datos.
 SELECT datos INTO v_prev FROM inventario_conteos WHERE id=v_id AND negocio_id=p_neg FOR UPDATE;
 IF v_prev IS NULL OR (COALESCE(v_prev->>'staffId','')<>v_yo->>'staffId'
     AND NOT _entrada_edita_ajeno(v_yo->>'rol')) THEN RETURN NULL; END IF;
 RETURN v_id;
END;
$$;

-- Horarios: longitud del negocio + negocio + sucursal + semana. No depende de
-- que suc_principal sea único. El trigger normaliza también colas antiguas.
CREATE OR REPLACE FUNCTION _horario_id(p_neg TEXT,p_suc TEXT,p_semana TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT 'hor_' || length(p_neg) || '_' || p_neg || '_' ||
        COALESCE(NULLIF(p_suc,''),'suc_principal') || '_' || p_semana;
$$;
CREATE OR REPLACE FUNCTION _horario_identidad()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.negocio_id IS DISTINCT FROM OLD.negocio_id THEN
   RAISE EXCEPTION 'El horario no puede cambiar de negocio' USING ERRCODE='23514';
 END IF;
 IF NULLIF(NEW.datos->>'semana','') IS NOT NULL THEN
   NEW.id := _horario_id(NEW.negocio_id,NEW.datos->>'sucursalId',NEW.datos->>'semana');
 ELSIF NEW.id LIKE 'horcfg_%' THEN
   NEW.id := 'horcfg_' || NEW.negocio_id;
 ELSE
   RAISE EXCEPTION 'Horario sin semana' USING ERRCODE='23514';
 END IF;
 NEW.datos := jsonb_set(NEW.datos,'{id}',to_jsonb(NEW.id));
 IF TG_OP='UPDATE' AND COALESCE((OLD.datos->>'updated')::numeric,0)>COALESCE((NEW.datos->>'updated')::numeric,0) THEN
   RETURN OLD; -- una cola anterior no revierte una semana más reciente
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS horarios_identidad ON horarios;
CREATE TRIGGER horarios_identidad BEFORE INSERT OR UPDATE ON horarios
 FOR EACH ROW EXECUTE FUNCTION _horario_identidad();
-- Un conflicto de identidad aborta TODA la migración para revisarlo, en lugar
-- de decidir a ciegas cuál horario se borra. Segunda ejecución no cambia IDs.
UPDATE horarios SET id=_horario_id(negocio_id,datos->>'sucursalId',datos->>'semana')
 WHERE NULLIF(datos->>'semana','') IS NOT NULL
   AND (id IS DISTINCT FROM _horario_id(negocio_id,datos->>'sucursalId',datos->>'semana')
        OR datos->>'id' IS DISTINCT FROM id);

-- Una pestaña antigua no puede quitar la revisión/bitácora de una aplicación QR.
CREATE OR REPLACE FUNCTION _inventario_guardia_qr()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.negocio_id IS DISTINCT FROM OLD.negocio_id THEN
   RAISE EXCEPTION 'El inventario no puede cambiar de negocio' USING ERRCODE='23514';
 END IF;
 IF current_user IN ('anon','authenticated') THEN
   -- Un cliente anterior podía guardar primero las cifras del QR y fallar
   -- después al sellar el conteo. Esa primera escritura tampoco se acepta.
   IF EXISTS (
     SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.datos->'filas','[]')) f
     WHERE f->'conteoQR' IS NOT NULL AND f->'conteoQR'<>'null'::jsonb
       AND NOT EXISTS (
         SELECT 1 FROM inventarios i,
           LATERAL jsonb_array_elements(COALESCE(i.datos->'filas','[]')) anterior
         WHERE i.id=NEW.id AND i.negocio_id=NEW.negocio_id
           AND anterior->>'insumoId'=f->>'insumoId' AND anterior->'conteoQR'=f->'conteoQR')) THEN
     RAISE EXCEPTION 'Actualiza la página para aplicar conteos QR con confirmación' USING ERRCODE='40001';
   END IF;
   IF TG_OP='INSERT' THEN
     IF (COALESCE((NEW.datos->>'qrRevision')::int,0)<>0 OR COALESCE(NEW.datos->'qrOperaciones','{}')<>'{}'::jsonb)
        AND NOT EXISTS (SELECT 1 FROM inventarios i WHERE i.id=NEW.id AND i.negocio_id=NEW.negocio_id
          AND i.datos->'qrRevision'=NEW.datos->'qrRevision' AND i.datos->'qrOperaciones'=NEW.datos->'qrOperaciones') THEN
       RAISE EXCEPTION 'Actualiza el inventario antes de guardar el conteo QR' USING ERRCODE='40001';
     END IF;
   ELSIF COALESCE((NEW.datos->>'qrRevision')::int,0)<>COALESCE((OLD.datos->>'qrRevision')::int,0)
       OR COALESCE(NEW.datos->'qrOperaciones','{}')<>COALESCE(OLD.datos->'qrOperaciones','{}') THEN
     RAISE EXCEPTION 'Actualiza el inventario: hay conteos QR aplicados en otra versión' USING ERRCODE='40001';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS inventario_guardia_qr ON inventarios;
CREATE TRIGGER inventario_guardia_qr BEFORE INSERT OR UPDATE ON inventarios
 FOR EACH ROW EXECUTE FUNCTION _inventario_guardia_qr();
-- Editar y resolver conteos solo a través de las RPC. El UPDATE completo de
-- clientes viejos deja de ser una forma de deshacer auditorías y versiones.
REVOKE UPDATE ON inventario_conteos FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION inventario_conteos_aplicar(
 p_neg TEXT, p_inventario JSONB, p_conteos JSONB, p_op TEXT, p_descartar BOOLEAN DEFAULT false
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_inv JSONB; v_id TEXT:=p_inventario->>'id'; v_c JSONB; v_item JSONB;
 v_revision INT; v_hash TEXT; v_suc TEXT; v_area TEXT; v_owner UUID;
BEGIN
 SELECT usuario_id INTO v_owner FROM negocios WHERE id=p_neg;
 IF (auth.uid() IS NOT NULL AND (v_owner=auth.uid() OR es_staff_de(p_neg) OR is_platform_admin())) IS NOT TRUE THEN
   RETURN jsonb_build_object('ok',false,'motivo','permiso');
 END IF;
 IF COALESCE(v_id,'')='' OR COALESCE(p_op,'')='' OR jsonb_typeof(p_conteos) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_conteos)=0 OR jsonb_typeof(p_inventario->'filas') IS DISTINCT FROM 'array' THEN
   RETURN jsonb_build_object('ok',false,'motivo','datos');
 END IF;
 -- Bloqueo incluso cuando el inventario es un borrador aún no subido.
 PERFORM pg_advisory_xact_lock(hashtextextended('invqr:'||p_neg||':'||v_id,0));
 SELECT datos INTO v_inv FROM inventarios WHERE id=v_id AND negocio_id=p_neg FOR UPDATE;
 IF v_inv IS NULL AND EXISTS(SELECT 1 FROM inventarios WHERE id=v_id) THEN
   RETURN jsonb_build_object('ok',false,'motivo','permiso');
 END IF;
 v_hash:=md5(jsonb_build_array(p_inventario,p_conteos,p_descartar)::text);
 IF v_inv->'qrOperaciones' ? p_op THEN
   IF v_inv->'qrOperaciones'->>p_op<>v_hash THEN RETURN jsonb_build_object('ok',false,'motivo','operacion'); END IF;
   RETURN jsonb_build_object('ok',true,'repetida',true,'inventario',v_inv);
 END IF;
 v_revision:=COALESCE((v_inv->>'qrRevision')::int,0);
 IF v_revision<>COALESCE((p_inventario->>'qrRevision')::int,0) THEN
   RETURN jsonb_build_object('ok',false,'motivo','conflicto-inventario');
 END IF;
 IF COALESCE((v_inv->>'cerrado')::boolean,false) OR COALESCE((p_inventario->>'cerrado')::boolean,false) THEN
   RETURN jsonb_build_object('ok',false,'motivo','cerrado');
 END IF;
 v_suc:=COALESCE(NULLIF(p_inventario->>'sucursalId',''),'suc_principal');
 v_area:=lower(COALESCE(p_inventario->>'area',''));
 IF v_inv IS NOT NULL AND (COALESCE(NULLIF(v_inv->>'sucursalId',''),'suc_principal')<>v_suc
    OR lower(COALESCE(v_inv->>'area',''))<>v_area) THEN
   RETURN jsonb_build_object('ok',false,'motivo','ambito');
 END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'id') FROM jsonb_array_elements(p_conteos) x) THEN
   RETURN jsonb_build_object('ok',false,'motivo','datos');
 END IF;
 -- Primero validar TODOS. Orden estable para evitar bloqueos cruzados.
 FOR v_item IN SELECT x FROM jsonb_array_elements(p_conteos) x ORDER BY x->>'id' LOOP
   SELECT datos INTO v_c FROM inventario_conteos WHERE id=v_item->>'id' AND negocio_id=p_neg FOR UPDATE;
   IF v_c IS NULL OR COALESCE(NULLIF(v_c->>'sucursalId',''),'suc_principal')<>v_suc
      OR (v_area NOT IN ('','general') AND lower(COALESCE(v_c->>'area',''))<>v_area) THEN
     RETURN jsonb_build_object('ok',false,'motivo','ambito');
   END IF;
   IF v_item->>'ver' IS NULL OR (v_item->>'ver')::int<>COALESCE((v_c->>'ver')::int,1) THEN
     RETURN jsonb_build_object('ok',false,'motivo','conflicto-conteo','id',v_item->>'id');
   END IF;
   IF COALESCE((v_c->>'aplicado')::boolean,false) OR COALESCE((v_c->>'descartado')::boolean,false) THEN
     RETURN jsonb_build_object('ok',false,'motivo','resuelto');
   END IF;
 END LOOP;
 v_inv:=p_inventario || jsonb_build_object('qrRevision',v_revision+1,
    'qrOperaciones',COALESCE(v_inv->'qrOperaciones','{}'::jsonb)||jsonb_build_object(p_op,v_hash),
    'guardadoTs',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 INSERT INTO inventarios(id,negocio_id,datos) VALUES(v_id,p_neg,v_inv)
 ON CONFLICT(id) DO UPDATE SET datos=EXCLUDED.datos WHERE inventarios.negocio_id=p_neg;
 FOR v_item IN SELECT x FROM jsonb_array_elements(p_conteos) x LOOP
   UPDATE inventario_conteos SET datos=datos||jsonb_build_object(
     'aplicado',true,'descartado',p_descartar,'aplicadoInventario',v_id,'aplicadoOp',p_op,
     'aplicadoPor',auth.uid()::text,'aplicadoTs',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    WHERE id=v_item->>'id' AND negocio_id=p_neg;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'inventario',v_inv);
END;
$$;
REVOKE ALL ON FUNCTION inventario_conteos_aplicar(TEXT,JSONB,JSONB,TEXT,BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION inventario_conteos_aplicar(TEXT,JSONB,JSONB,TEXT,BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION _horario_id(TEXT,TEXT,TEXT),_horario_identidad(),_inventario_guardia_qr() FROM PUBLIC,anon,authenticated;
-- El trigger de horarios invoca el calculador con el rol que escribe.
GRANT EXECUTE ON FUNCTION _horario_id(TEXT,TEXT,TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
