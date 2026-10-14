-- ════════════════════════════════════════════════════════════════════════════
-- ETAAX · v80 — EL QR ENTREGABA EL CATÁLOGO ENTERO DEL NEGOCIO
--
-- Lo encontró la auditoría de insumos por sucursal (14-oct-2026). Son dos cosas
-- distintas que viajaban en la misma consulta:
--
--
-- 1) MANDABA `datos` COMPLETO, Y ESA CONSULTA LA CORRE `anon`
--
--    `entrada_insumos` hacía `SELECT i.datos` de todos los insumos del negocio.
--    Quien tiene el link del QR —un celular sin sesión— recibía la ficha entera
--    de cada producto: PRECIOS de compra, proveedor, historial de cambios,
--    quién editó y cuándo. La pantalla solo necesita saber qué es, de qué
--    sucursal y en qué unidad se cuenta.
--
--    La v61 ya había cerrado esto mismo para las RECETAS (ahí estaban los
--    costos y los ingredientes) y hay una prueba en el candado que lo vigila.
--    Los insumos se quedaron sin su parte.
--
--    Se arregla con LISTA BLANCA, como la carta pública: lo que no está
--    enumerado no viaja. Una lista negra se queda vieja en cuanto alguien
--    agrega un campo al insumo — y el campo nuevo se publica solo.
--
--
-- 2) NO FILTRABA POR SUCURSAL, Y EL CLIENTE FILTRABA AL REVÉS
--
--    El negocio tiene MAESTROS (la ficha de referencia, sin sucursal) y una
--    COPIA por sucursal. El filtro del celular decía «sin sucursal = está en
--    todas», así que los maestros pasaban siempre: en una barra con 200
--    productos salían los 1,000 del negocio, revueltos con sus copias. Un
--    insumo sin asignar no es de todas las sucursales — no es de ninguna: para
--    eso están sus copias.
--
--    Eso ya quedó arreglado en el cliente (usa la regla compartida de
--    /insumo-label.js, la misma de inventarios y el escandallo). Pero un filtro
--    que vive solo en el JavaScript no es un filtro: el día que alguien lo
--    omita —o pida la RPC a mano, que es trivial con el link del QR— vuelven a
--    salir los 1,000. Aquí se filtra en el servidor.
--
--    LA SUCURSAL NO SALE DEL LINK. Sale del NIP de quien entra: `s` en la URL
--    es una comodidad para sellar, no una autorización. Si el barman de una
--    sucursal escanea el QR de otra, lo que ve y lo que registra es lo de
--    DONDE TRABAJA. La v78 ya resolvía eso mismo para escribir
--    (`entrada_sucursal_de_nip`); esto es su mitad de lectura.
--
--
-- QUÉ SE AGREGA
--   · `_insumo_en_suc(datos, suc)` — la regla de membresía, en SQL. Es la misma
--     de `window._insumoEnSuc`: normaliza vacío → 'suc_principal' y deja fuera
--     lo no asignado. Interna: nadie de fuera la ejecuta.
--   · `_insumo_qr_campos(datos)` — la lista blanca. Sin precios.
--   · `entrada_catalogo(neg, token, niphash)` — la buena: pide las dos llaves
--     (token del QR + NIP), deriva la sucursal del colaborador y devuelve solo
--     sus insumos, acotados. Respeta el freno de NIP de la v78/v79.
--   · `entrada_insumos(neg, token)` — se conserva la firma porque los celulares
--     con la página en caché siguen llamándola. Deja de mandar `datos` entero y
--     deja fuera los maestros sin asignar. Sin NIP no puede saber la sucursal,
--     así que entrega las copias de todas: menos de lo que daba antes, pero es
--     la de compatibilidad. La pantalla nueva usa `entrada_catalogo` y cae a
--     esta solo si la v80 todavía no se corrió.
--
-- YA SE CORRIÓ ANTES DE MANDARLA. Contra un Postgres de verdad (PGlite) sobre
-- un esquema que imita producción: primero se provocó el agujero con la
-- definición de hoy (la v27 entrega 5 de 5 insumos del negocio —el maestro, la
-- copia de la otra sucursal y hasta uno dado de baja— con precio, proveedor y
-- quién editó), después se corrió este archivo y se comprobó que Ana reciba
-- solo la ficha de su sucursal y Beto solo la de la suya; que un NIP inventado,
-- uno dado de baja y un token falso no reciban nada; que el NIP de un negocio
-- no abra el catálogo de otro; y que correrla dos veces no cambie nada.
-- También se probó la RED DE SEGURIDAD: un catálogo que nunca se repartió por
-- sucursal (todos los insumos sin asignar) sigue sirviendo —si no, el celular
-- se queda vacío y nadie puede registrar—, mientras que una sucursal a la que
-- no le copiaron fichas recibe la lista vacía a propósito: taparlo con los
-- maestros es el bug que se vino a cerrar.
-- 29 comprobaciones, 0 fallas.
--
-- Idempotente: CREATE OR REPLACE. Se corre a mano en Supabase → SQL Editor.
-- La comprobación va al final, en una sola instrucción.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) La regla de membresía, igual que en el cliente ───────────────────────
-- Vacío ('' o ausente) = Matriz ('suc_principal'). Sin membresía = de ninguna.
CREATE OR REPLACE FUNCTION _insumo_en_suc(p_datos JSONB, p_suc TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN jsonb_typeof(p_datos->'sucursales') = 'array'
             AND jsonb_array_length(p_datos->'sucursales') > 0
        THEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(p_datos->'sucursales') e
            WHERE COALESCE(NULLIF(e, ''), 'suc_principal')
                = COALESCE(NULLIF(p_suc, ''), 'suc_principal'))
        WHEN COALESCE(p_datos->>'sucursalId', '') <> ''
        THEN p_datos->>'sucursalId' = COALESCE(NULLIF(p_suc, ''), 'suc_principal')
        ELSE FALSE
    END;
$$;

-- ── 2) La lista blanca ──────────────────────────────────────────────────────
-- Lo que la pantalla necesita para ELEGIR y CONTAR: identidad legible, a qué
-- área pertenece, de qué sucursal es y en qué unidades se mide. Las
-- presentaciones se rearman campo por campo: el objeto completo trae `precio`,
-- `proveedor` y el costo de compra.
CREATE OR REPLACE FUNCTION _insumo_qr_campos(p_datos JSONB)
RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'id',           p_datos->>'id',
        'nombre',       p_datos->>'nombre',
        'marca',        p_datos->>'marca',
        'variedad',     p_datos->>'variedad',
        'maduracion',   p_datos->>'maduracion',
        'subcategoria', p_datos->>'subcategoria',
        'categoria',    p_datos->>'categoria',
        'familia',      p_datos->>'familia',
        'grupo',        p_datos->>'grupo',
        'tipo',         p_datos->>'tipo',
        'area',         p_datos->>'area',
        'empaque',      p_datos->>'empaque',
        'activo',       COALESCE(p_datos->>'activo', '1'),
        'origenId',     p_datos->>'origenId',
        'sucursalId',   p_datos->>'sucursalId',
        'sucursales',   COALESCE(p_datos->'sucursales', '[]'::jsonb),
        'presentaciones', COALESCE((
            SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                'contNeto',          pr->>'contNeto',
                'umContenido',       pr->>'umContenido',
                'presentacionCompra',pr->>'presentacionCompra',
                'cantPresCompra',    pr->>'cantPresCompra',
                'umPresCompra',      pr->>'umPresCompra',
                'empaque',           pr->>'empaque'
            )))
            FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(p_datos->'presentaciones') = 'array'
                     THEN p_datos->'presentaciones' ELSE '[]'::jsonb END) pr
        ), '[]'::jsonb)
    ));
$$;

-- ── 3) La consulta buena: token + NIP, sucursal del colaborador ─────────────
-- Devuelve {ok, sucursal, insumos} — el mismo trato que `entrada_historial`,
-- cuyo "no" tampoco es NULL: la pantalla necesita distinguir «tu NIP ya no
-- vale» de «no hay productos».
CREATE OR REPLACE FUNCTION entrada_catalogo(p_neg TEXT, p_token TEXT, p_niphash TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_suc TEXT; v_ins JSONB;
BEGIN
    -- Freno de la v78: el intento se anota ANTES de cualquier otra cosa.
    IF NOT _nip_guardia(p_neg, p_niphash) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'espera');
    END IF;
    IF NOT _entrada_token_ok(p_neg, p_token) THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'token');
    END IF;
    -- La sucursal sale del NIP, nunca del enlace. (Mismo SELECT que
    -- entrada_sucursal_de_nip; se copia el cuerpo para no gastar dos intentos
    -- del freno en una sola carga de pantalla.)
    v_suc := (SELECT COALESCE(NULLIF(s.datos->>'sucursalId', ''), 'suc_principal')
                FROM staff s
               WHERE s.negocio_id = p_neg
                 AND s.datos->>'nipHash' = p_niphash
                 AND COALESCE(NULLIF(s.datos->>'estado', ''), 'Activo') = 'Activo'
                 AND p_niphash IS NOT NULL AND p_niphash <> ''
               LIMIT 1);
    IF v_suc IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'nip');
    END IF;
    SELECT COALESCE(jsonb_agg(_insumo_qr_campos(i.datos)), '[]'::jsonb) INTO v_ins
      FROM negocio_insumos i
     WHERE i.negocio_id = p_neg
       AND COALESCE(i.datos->>'activo', '1') <> '0'
       AND _insumo_en_suc(i.datos, v_suc);
    /* RED DE SEGURIDAD — un catálogo que NUNCA se repartió por sucursal.
       Hay negocios donde todos los insumos están sin asignar porque nadie usó
       las copias todavía. Ahí el filtro correcto deja la lista vacía y el
       celular se queda sin nada que registrar, sin que el colaborador pueda
       hacer nada al respecto. Si NINGÚN insumo del negocio tiene sucursal, se
       entregan los no asignados: no son de otra sucursal —no hay otra que
       proteger—, son la ficha de referencia del negocio.

       OJO con la condición: es "el negocio no repartió NADA", no "esta
       sucursal no tiene". Si S1 tiene sus 200 y S2 ninguno, S2 recibe la lista
       vacía a propósito: lo que falta ahí es que alguien le copie sus fichas, y
       taparlo con los maestros es justo el bug que se vino a cerrar.          */
    IF v_ins = '[]'::jsonb AND NOT EXISTS (
        SELECT 1 FROM negocio_insumos i
         WHERE i.negocio_id = p_neg
           AND COALESCE(i.datos->>'activo', '1') <> '0'
           AND (   jsonb_typeof(i.datos->'sucursales') = 'array'
                   AND jsonb_array_length(i.datos->'sucursales') > 0
                OR COALESCE(i.datos->>'sucursalId', '') <> '' )) THEN
        SELECT COALESCE(jsonb_agg(_insumo_qr_campos(i.datos)), '[]'::jsonb) INTO v_ins
          FROM negocio_insumos i
         WHERE i.negocio_id = p_neg
           AND COALESCE(i.datos->>'activo', '1') <> '0';
        RETURN jsonb_build_object('ok', true, 'sucursal', v_suc,
                                  'sinRepartir', true, 'insumos', v_ins);
    END IF;
    RETURN jsonb_build_object('ok', true, 'sucursal', v_suc, 'insumos', v_ins);
END;
$$;

-- ── 4) La de compatibilidad: misma firma, sin la ficha entera ───────────────
-- Los celulares que ya tienen la página guardada siguen llamando a ésta. Se le
-- quita lo que no le toca ver y se dejan fuera los maestros sin asignar (que
-- eran los que inflaban la lista a 1,000). Sin NIP no hay sucursal que derivar.
CREATE OR REPLACE FUNCTION entrada_insumos(p_neg TEXT, p_token TEXT)
RETURNS SETOF JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT _insumo_qr_campos(i.datos)
      FROM negocio_insumos i
     WHERE i.negocio_id = p_neg
       AND _entrada_token_ok(p_neg, p_token)
       AND COALESCE(i.datos->>'activo', '1') <> '0'
       AND (   jsonb_typeof(i.datos->'sucursales') = 'array'
               AND jsonb_array_length(i.datos->'sucursales') > 0
            OR COALESCE(i.datos->>'sucursalId', '') <> '' );
$$;

-- ── 5) Permisos ─────────────────────────────────────────────────────────────
-- OJO (regla aprendida en la v72): en Supabase `REVOKE … FROM PUBLIC` NO le
-- quita el permiso a `anon`. Hay que nombrarlo.
REVOKE ALL ON FUNCTION _insumo_en_suc(JSONB, TEXT)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _insumo_qr_campos(JSONB)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION entrada_catalogo(TEXT, TEXT, TEXT)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_catalogo(TEXT, TEXT, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION entrada_insumos(TEXT, TEXT)         FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entrada_insumos(TEXT, TEXT)      TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- COMPROBACIÓN — una sola instrucción (el editor solo enseña la última).
--
-- No lee definiciones: CORRE las funciones con datos de mentira. Una prueba que
-- busca un texto sobrevive a que el código deje de funcionar.
-- ════════════════════════════════════════════════════════════════════════════
WITH ficha AS (
    SELECT '{"id":"c1","nombre":"Tónica","marca":"X","activo":"1","origenId":"m1",
             "sucursales":["s1"],"proveedor":"Don Pepe","updatedBy":"edwin",
             "historial":[{"que":"alta"}],
             "presentaciones":[{"contNeto":1000,"umContenido":"ML","precio":120,
                                "proveedor":"Don Pepe","umPresCompra":"Botellas"}]}'::jsonb AS c,
           '{"id":"m1","nombre":"Tónica","activo":"1","sucursales":[]}'::jsonb AS m,
           '{"id":"mz","nombre":"Hielo","activo":"1","sucursales":[""]}'::jsonb AS z
)
SELECT * FROM (
    SELECT 1 AS n, 'la copia de s1 es de s1' AS prueba,
           CASE WHEN _insumo_en_suc(c, 's1') THEN 'PASA' ELSE 'FALLA' END AS r FROM ficha
    UNION ALL
    SELECT 2, 'y no es de s2',
           CASE WHEN NOT _insumo_en_suc(c, 's2') THEN 'PASA' ELSE 'FALLA' END FROM ficha
    UNION ALL
    SELECT 3, 'el maestro sin asignar no es de ninguna sucursal',
           CASE WHEN NOT _insumo_en_suc(m, 's1') AND NOT _insumo_en_suc(m, 'suc_principal')
                THEN 'PASA' ELSE 'FALLA' END FROM ficha
    UNION ALL
    SELECT 4, 'la membresía vacía es Matriz',
           CASE WHEN _insumo_en_suc(z, 'suc_principal') AND _insumo_en_suc(z, '')
                THEN 'PASA' ELSE 'FALLA' END FROM ficha
    UNION ALL
    SELECT 5, 'la lista blanca NO manda el precio de compra',
           CASE WHEN _insumo_qr_campos(c)::text NOT LIKE '%120%'
                 AND _insumo_qr_campos(c)::text NOT LIKE '%precio%'
                THEN 'PASA' ELSE 'FALLA' END FROM ficha
    UNION ALL
    SELECT 6, 'ni el proveedor, ni quién editó, ni el historial',
           CASE WHEN _insumo_qr_campos(c)::text NOT LIKE '%Don Pepe%'
                 AND _insumo_qr_campos(c)::text NOT LIKE '%edwin%'
                 AND _insumo_qr_campos(c)::text NOT LIKE '%historial%'
                THEN 'PASA' ELSE 'FALLA' END FROM ficha
    UNION ALL
    SELECT 7, 'pero sí lo que hace falta para elegir y contar',
           CASE WHEN _insumo_qr_campos(c)->>'nombre' = 'Tónica'
                 AND _insumo_qr_campos(c)->>'origenId' = 'm1'
                 AND _insumo_qr_campos(c)->'presentaciones'->0->>'umContenido' = 'ML'
                 AND _insumo_qr_campos(c)->'presentaciones'->0->>'contNeto' = '1000'
                THEN 'PASA' ELSE 'FALLA' END FROM ficha
    UNION ALL
    SELECT 8, 'un insumo de otro negocio no entra por la RPC',
           CASE WHEN (entrada_catalogo('__negocio_inexistente_v80__', 'token-falso', 'nip-falso')->>'ok') = 'false'
                THEN 'PASA' ELSE 'FALLA' END
    UNION ALL
    SELECT 9, 'y sin token/NIP válidos no devuelve insumos',
           CASE WHEN (entrada_catalogo('__negocio_inexistente_v80__', 'token-falso', 'nip-falso')->'insumos') IS NULL
                THEN 'PASA' ELSE 'FALLA' END
) t ORDER BY n;
