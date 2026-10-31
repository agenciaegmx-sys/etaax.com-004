/* Corre supabase-migration-v82.sql contra un Postgres DE VERDAD (PGlite) sobre
   un esquema mínimo que imita producción. Primero se PROVOCAN los agujeros con
   las definiciones que hay hoy —extraídas de las migraciones v78/v79, no
   reescritas— y después se corre el archivo y se verifica que lo legítimo siga
   vivo. Ninguna escritura toca datos reales.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado fuera
   del proyecto (por defecto /tmp/etaax-billing-sql). */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {PGlite} = createRequire((process.env.PGLITE_DIR || '/tmp/etaax-billing-sql') + '/test.cjs')('@electric-sql/pglite');
const db = new PGlite();
let cuenta = 0;
const ok = async (nombre, fn) => { await fn(); cuenta++; console.log('PASA ' + nombre); };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const uno = async (sql, args) => (await q(sql, args))[0];

/* La definición ANTERIOR sale del archivo que la creó, no de una copia a mano:
   reescribirla es como la v63 perdió el freno del NIP. */
function definicion(archivo, nombre) {
    const s = fs.readFileSync(new URL('../' + archivo, import.meta.url), 'utf8');
    const i = s.indexOf('CREATE OR REPLACE FUNCTION ' + nombre + '(');
    assert.ok(i >= 0, 'no se encontró ' + nombre + ' en ' + archivo);
    const fin = s.indexOf('\n$$;', i);
    assert.ok(fin > i, 'sin cierre: ' + nombre);
    return s.slice(i, fin + 4);
}

/* ── El mundo mínimo que la v82 da por existente ────────────────────────── */
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE negocios (id TEXT PRIMARY KEY, datos JSONB);
CREATE TABLE staff (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
CREATE TABLE inventarios (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
CREATE TABLE inventario_conteos (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB,
                                 created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE entradas_log (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB,
                           created_at TIMESTAMPTZ DEFAULT now());

-- El token del QR (v27) y el freno del NIP (v78), en su forma mínima.
CREATE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM negocios n WHERE n.id = p_neg
                    AND n.datos->>'entradaToken' = p_token
                    AND p_token IS NOT NULL AND p_token <> '');
$$;
CREATE TABLE _intentos (clave TEXT PRIMARY KEY, n INT);
CREATE FUNCTION _nip_guardia(p_neg TEXT, p_niphash TEXT) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$ SELECT TRUE $$;
CREATE FUNCTION entrada_validar_nip(p_neg TEXT, p_token TEXT, p_niphash TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v TEXT;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN NULL; END IF;
    IF NOT _entrada_token_ok(p_neg, p_token) THEN RETURN NULL; END IF;
    SELECT s.datos->>'nombre' INTO v FROM staff s
     WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash
       AND COALESCE(NULLIF(s.datos->>'estado',''),'Activo') = 'Activo' LIMIT 1;
    RETURN v;
END; $$;

INSERT INTO negocios (id, datos) VALUES
    ('neg1','{"entradaToken":"tok1"}'), ('neg2','{"entradaToken":"tok2"}');
INSERT INTO staff (id, negocio_id, datos) VALUES
    ('st_ana', 'neg1','{"nombre":"Ana","nipHash":"hA","sucursalId":"s1","rol":"barman","estado":"Activo"}'),
    ('st_beto','neg1','{"nombre":"Beto","nipHash":"hB","sucursalId":"s1","rol":"barman","estado":"Activo"}'),
    ('st_gere','neg1','{"nombre":"Gere","nipHash":"hG","sucursalId":"s1","rol":"gerente","estado":"Activo"}'),
    ('st_otra','neg1','{"nombre":"Otra sucursal","nipHash":"hO","sucursalId":"s9","rol":"barman","estado":"Activo"}'),
    ('st_baja','neg1','{"nombre":"Dado de baja","nipHash":"hZ","sucursalId":"s1","rol":"barman","estado":"Baja"}');
-- Un inventario CERRADO viejo, para el corte del periodo.
INSERT INTO inventarios (id, negocio_id, datos) VALUES
    ('inv_viejo','neg1','{"cerrado":true,"fecha":"2026-10-01","cierreOperativo":"2026-10-01T23:00:00Z","sucursalId":"s1","area":"barra","nombre":"Octubre 1"}');
`);

/* ── CÓMO ESTÁ HOY: las definiciones vivas, tal cual salen del repo ─────── */
await db.exec(definicion('supabase-migration-v78.sql', 'entrada_historial'));
await db.exec(definicion('supabase-migration-v79.sql', 'inventario_conteo_registrar'));

const CONTEO = (id, extra = {}) => JSON.stringify(Object.assign({
    id, nombre: 'Ron Añejo', insumoId: 'ron1', sucursalId: 's1', area: 'barra',
    cerradasBodega: 10, cerradasBarra: 0, fecha: '2026-10-20', hora: '19:00'
}, extra));
const registrar = async (nip, datos) => (await uno(
    'SELECT inventario_conteo_registrar($1,$2,$3,$4::jsonb) AS id', ['neg1', 'tok1', nip, datos])).id;
const historial = (nip) => uno(
    'SELECT entrada_historial($1,$2,$3,$4,$5) AS r', ['neg1', 'tok1', nip, 's1', 'barra']);

console.log('\n══ ANTES de la v82 — los agujeros, provocados ══');
await registrar('hA', CONTEO('c1'));
{
    const h = (await historial('hA')).r;
    await ok('el historial NO trae el id del registro: no hay con qué editarlo', async () => {
        assert.equal(h.conteos.length, 1);
        assert.equal(h.conteos[0].id, undefined);
        assert.equal(h.conteos[0].ver, undefined);
    });
    await ok('…y la columna «quién» de los conteos viene VACÍA (lee la llave equivocada)', async () => {
        assert.equal(h.conteos[0].quien, null);
        const d = (await uno("SELECT datos FROM inventario_conteos WHERE id='c1'")).datos;
        assert.equal(d.contadoPor, 'Ana');      // el escritor sí lo guarda, en otra llave
    });
    /* Y el agujero gordo: reenviar el mismo id reemplaza `datos` a ciegas. */
    await db.exec("UPDATE inventario_conteos SET datos = datos || '{\"aplicado\":true}'::jsonb WHERE id='c1'");
    await registrar('hB', CONTEO('c1', { cerradasBodega: 999 }));
    await ok('cualquiera reinicia un conteo YA APLICADO reenviando su id', async () => {
        const d = (await uno("SELECT datos FROM inventario_conteos WHERE id='c1'")).datos;
        assert.equal(Number(d.cerradasBodega), 999);
        assert.equal(d.aplicado, undefined);     // el sello de aplicado se perdió
        assert.equal(d.contadoPor, 'Beto');      // y lo firmó quien no lo contó
    });
}

console.log('\n══ Corriendo supabase-migration-v82.sql ══');
const sql = fs.readFileSync(new URL('../supabase-migration-v82.sql', import.meta.url), 'utf8');
await db.exec(sql);
console.log('  (corrió sin error de sintaxis)');

/* ── DESPUÉS ─────────────────────────────────────────────────────────────── */
const editar = (nip, tipo, id, ver, cambios, op) => uno(
    'SELECT entrada_editar($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS r',
    ['neg1', 'tok1', nip, tipo, id, ver, JSON.stringify(cambios), op || null]);
const datosDe = async (tabla, id) => (await uno('SELECT datos FROM ' + tabla + " WHERE id=$1", [id])).datos;

console.log('\n══ DESPUÉS — se puede corregir, y solo quien debe ══');
await db.exec("DELETE FROM inventario_conteos");
await registrar('hA', CONTEO('c2'));
await ok('el conteo nuevo nace con autor estable y versión 1', async () => {
    const d = await datosDe('inventario_conteos', 'c2');
    assert.equal(d.staffId, 'st_ana');
    assert.equal(Number(d.ver), 1);
});
await ok('el historial ya trae id, versión, autor y si se puede editar', async () => {
    const c = (await historial('hA')).r.conteos[0];
    assert.equal(c.id, 'c2');
    assert.equal(c.ver, 1);
    assert.equal(c.quien, 'Ana');            // la llave correcta, por fin
    assert.equal(c.puedeEditar, true);
    assert.equal(c.motivoBloqueo, null);
});
await ok('Ana corrige su propio conteo: 10 → 8, y sube de versión', async () => {
    const r = (await editar('hA', 'conteo', 'c2', 1, { cerradasBodega: 8 })).r;
    assert.equal(r.ok, true);
    assert.equal(r.ver, 2);
    const d = await datosDe('inventario_conteos', 'c2');
    assert.equal(Number(d.cerradasBodega), 8);
});
await ok('…y conserva id, autor, producto, sucursal y fecha operativa', async () => {
    const d = await datosDe('inventario_conteos', 'c2');
    ['id:c2', 'staffId:st_ana', 'contadoPor:Ana', 'insumoId:ron1', 'sucursalId:s1', 'fecha:2026-10-20']
        .forEach(par => { const [k, v] = par.split(':'); assert.equal(String(d[k]), v, k); });
    assert.ok(d.registrado, 'se perdió el sello del momento del registro');
});
await ok('…y deja rastro de antes y después', async () => {
    const d = await datosDe('inventario_conteos', 'c2');
    assert.equal(d.auditoria.length, 1);
    assert.equal(Number(d.auditoria[0].antes.cerradasBodega), 10);
    assert.equal(Number(d.auditoria[0].despues.cerradasBodega), 8);
    assert.equal(d.auditoria[0].quien, 'Ana');
});
await ok('una versión vieja NO pisa: avisa del conflicto y dice la buena', async () => {
    const r = (await editar('hA', 'conteo', 'c2', 1, { cerradasBodega: 3 })).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'conflicto');
    assert.equal(r.ver, 2);
    assert.equal(Number((await datosDe('inventario_conteos', 'c2')).cerradasBodega), 8);
});
await ok('reintentar la MISMA operación no cuenta como otra edición', async () => {
    const a = (await editar('hA', 'conteo', 'c2', 2, { cerradasBodega: 6 }, 'op-123')).r;
    const b = (await editar('hA', 'conteo', 'c2', 3, { cerradasBodega: 6 }, 'op-123')).r;
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.equal(b.repetida, true);
    const d = await datosDe('inventario_conteos', 'c2');
    assert.equal(Number(d.ver), 3, 'subió dos veces por un solo cambio');
    assert.equal(d.auditoria.length, 2, 'apuntó la misma corrección dos veces');
});
await ok('el conteo SÍ se puede corregir a cero: se contó y no había nada', async () => {
    const r = (await editar('hA', 'conteo', 'c2', 3, { cerradasBarra: 0, cerradasBodega: 0 })).r;
    assert.equal(r.ok, true);
    assert.equal(Number((await datosDe('inventario_conteos', 'c2')).cerradasBodega), 0);
});
await ok('borrar el comentario lo borra DE VERDAD', async () => {
    await editar('hA', 'conteo', 'c2', 4, { nota: 'me equivoqué' });
    assert.equal((await datosDe('inventario_conteos', 'c2')).nota, 'me equivoqué');
    await editar('hA', 'conteo', 'c2', 5, { nota: '   ' });
    assert.equal('nota' in (await datosDe('inventario_conteos', 'c2')), false, 'la nota vieja se quedó');
});
await ok('un cambio que no trae nada editable se rechaza sin tocar la versión', async () => {
    const antes = Number((await datosDe('inventario_conteos', 'c2')).ver);
    const r = (await editar('hA', 'conteo', 'c2', antes, { insumoId: 'otro', sucursalId: 's9' })).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'sin-cambios');
    const d = await datosDe('inventario_conteos', 'c2');
    assert.equal(Number(d.ver), antes);
    assert.equal(d.insumoId, 'ron1', 'le cambiaron el producto');
    assert.equal(d.sucursalId, 's1', 'le cambiaron la sucursal');
});

console.log('\n══ Quién puede y quién no ══');
await registrar('hB', CONTEO('c3'));
await ok('un compañero no corrige lo que contó otro', async () => {
    const r = (await editar('hA', 'conteo', 'c3', 1, { cerradasBodega: 1 })).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'autor');
});
await ok('…pero el encargado sí, y queda firmado por él', async () => {
    const r = (await editar('hG', 'conteo', 'c3', 1, { cerradasBodega: 4 })).r;
    assert.equal(r.ok, true);
    const d = await datosDe('inventario_conteos', 'c3');
    assert.equal(d.editadoPor, 'Gere');
    assert.equal(d.contadoPor, 'Beto', 'le cambió el autor original');
});
await ok('el de otra sucursal no entra, aunque traiga un NIP bueno', async () => {
    const r = (await editar('hO', 'conteo', 'c3', 2, { cerradasBodega: 7 })).r;
    assert.equal(r.ok, false);
    assert.ok(['ajeno', 'autor'].includes(r.motivo), r.motivo);
});
await ok('un NIP inventado o dado de baja no edita nada', async () => {
    assert.equal((await editar('hX', 'conteo', 'c3', 2, { cerradasBodega: 7 })).r.motivo, 'nip');
    assert.equal((await editar('hZ', 'conteo', 'c3', 2, { cerradasBodega: 7 })).r.motivo, 'nip');
});
await ok('sin el token del QR tampoco', async () => {
    const r = (await uno('SELECT entrada_editar($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS r',
        ['neg1', 'token-falso', 'hA', 'conteo', 'c2', null, '{"cerradasBarra":1}', null])).r;
    assert.equal(r.motivo, 'token');
});
await ok('un id de otro negocio no se alcanza', async () => {
    await db.exec("INSERT INTO inventario_conteos (id,negocio_id,datos) VALUES ('ajeno','neg2','{\"sucursalId\":\"s1\"}')");
    const r = (await editar('hA', 'conteo', 'ajeno', 1, { cerradasBodega: 1 })).r;
    assert.equal(r.motivo, 'no-existe');
});

console.log('\n══ Estado: lo aplicado y lo cerrado no se corrigen por detrás ══');
await ok('un conteo YA APLICADO se rechaza con su motivo', async () => {
    await db.exec("UPDATE inventario_conteos SET datos = datos || '{\"aplicado\":true}'::jsonb WHERE id='c3'");
    const r = (await editar('hG', 'conteo', 'c3', null, { cerradasBodega: 1 })).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'aplicado');
});
await ok('…y el historial lo dice en vez de solo apagar el botón', async () => {
    const c = (await historial('hG')).r.conteos.find(x => x.id === 'c3');
    assert.equal(c.puedeEditar, false);
    assert.equal(c.motivoBloqueo, 'Ya se aplicó al inventario');
});
await ok('reenviar el id de un conteo aplicado ya NO lo reinicia', async () => {
    const antes = await datosDe('inventario_conteos', 'c3');
    assert.equal(await registrar('hB', CONTEO('c3', { cerradasBodega: 999 })), null);
    const d = await datosDe('inventario_conteos', 'c3');
    assert.equal(Number(d.cerradasBodega), Number(antes.cerradasBodega));
    assert.equal(d.aplicado, true, 'se perdió el sello de aplicado');
});
await ok('…ni el de un conteo ajeno que no se ha aplicado', async () => {
    await registrar('hA', CONTEO('c4'));
    assert.equal(await registrar('hB', CONTEO('c4', { cerradasBodega: 500 })), null);
    assert.equal(Number((await datosDe('inventario_conteos', 'c4')).cerradasBodega), 10);
});
await ok('pero reenviar el propio sigue funcionando (es la cola sin internet)', async () => {
    assert.ok(await registrar('hA', CONTEO('c4', { cerradasBodega: 11 })));
    assert.equal(Number((await datosDe('inventario_conteos', 'c4')).cerradasBodega), 11);
});

console.log('\n══ Entradas: cantidad positiva y periodo abierto ══');
const ENTRADA = (id, extra = {}) => JSON.stringify(Object.assign({
    id, nombre: 'Ron Añejo', insumoId: 'ron1', sucursalId: 's1', concepto: 'compra',
    cantidad: 10, unidad: 'pza', fecha: '2026-10-20',
    registrado: '2026-10-20T19:00:00Z'
}, extra));
await uno('SELECT entrada_registrar($1,$2,$3,$4::jsonb) AS id', ['neg1', 'tok1', 'hA', ENTRADA('e1')]);
await ok('corregir 10 → 8 botellas deja 8, no 18', async () => {
    const r = (await editar('hA', 'entrada', 'e1', 1, { cantidad: 8 })).r;
    assert.equal(r.ok, true);
    assert.equal(Number((await datosDe('entradas_log', 'e1')).cantidad), 8);
    assert.equal((await q("SELECT 1 FROM entradas_log WHERE negocio_id='neg1'")).length, 1, 'se creó otro registro');
});
await ok('una entrada de cero o negativa no es una entrada', async () => {
    assert.equal((await editar('hA', 'entrada', 'e1', 2, { cantidad: 0 })).r.motivo, 'cantidad');
    assert.equal((await editar('hA', 'entrada', 'e1', 2, { cantidad: -5 })).r.motivo, 'cantidad');
    assert.equal((await editar('hA', 'entrada', 'e1', 2, { cantidad: 'ocho' })).r.motivo, 'cantidad');
    assert.equal(Number((await datosDe('entradas_log', 'e1')).cantidad), 8);
});
await ok('una entrada dentro de un inventario YA CERRADO no se corrige aquí', async () => {
    await uno('SELECT entrada_registrar($1,$2,$3,$4::jsonb) AS id',
        ['neg1', 'tok1', 'hA', ENTRADA('e_viejo', { registrado: '2026-09-30T10:00:00Z' })]);
    const r = (await editar('hA', 'entrada', 'e_viejo', 1, { cantidad: 3 })).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'cerrado');
});
await ok('…y no se le puede mover el periodo para colarlo', async () => {
    const r = (await editar('hA', 'entrada', 'e1', 2, { cantidad: 7, registrado: '2026-01-01T00:00:00Z' })).r;
    assert.equal(r.ok, true);
    assert.equal((await datosDe('entradas_log', 'e1')).registrado, '2026-10-20T19:00:00Z');
});

console.log('\n══ Permisos y idempotencia ══');
await ok('anon ejecuta las RPC del QR, no los ayudantes internos', async () => {
    const p = await uno(`SELECT
        has_function_privilege('anon','entrada_editar(text,text,text,text,text,integer,jsonb,text)','EXECUTE') AS editar,
        has_function_privilege('anon','entrada_historial(text,text,text,text,text)','EXECUTE')                 AS hist,
        has_function_privilege('anon','_entrada_quien(text,text)','EXECUTE')                                   AS quien,
        has_function_privilege('anon','_entrada_edita_ajeno(text)','EXECUTE')                                  AS ajeno,
        has_function_privilege('anon','_entrada_periodo_cerrado(text,text,text)','EXECUTE')                    AS periodo`);
    assert.ok(p.editar && p.hist, 'anon no puede usar el editor');
    assert.ok(!p.quien && !p.ajeno && !p.periodo, 'los ayudantes internos quedaron expuestos');
});
await ok('correrla dos veces no cambia nada', async () => {
    await db.exec(sql);
    const d = await datosDe('inventario_conteos', 'c2');
    assert.equal(Number(d.cerradasBodega), 0);
    const r = (await editar('hA', 'conteo', 'c2', null, { cerradasBarra: 2 })).r;
    assert.equal(r.ok, true);
});

await db.close();
console.log('\nSQL v82: ' + cuenta + ' casos, 0 fallas');
