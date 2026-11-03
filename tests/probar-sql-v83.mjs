/* Corre supabase-migration-v83.sql contra un Postgres DE VERDAD (PGlite).
   Primero se PROVOCAN los cinco agujeros que encontró Codex con lo que hay
   HOY en producción —la v82, corrida tal cual del repo, no reescrita— y
   después se corre la v83 y se comprueba que cada uno quedó cerrado y que lo
   legítimo sigue vivo. Ninguna escritura toca datos reales.

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
const datosDe = async (tabla, id) => (await uno('SELECT datos FROM ' + tabla + ' WHERE id=$1', [id])).datos;

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

CREATE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM negocios n WHERE n.id = p_neg
                    AND n.datos->>'entradaToken' = p_token
                    AND p_token IS NOT NULL AND p_token <> '');
$$;
/* El freno del NIP va en su forma mínima: aquí se prueba el CONTRATO de
   corrección, no el freno. Decirlo evita que los verdes de este archivo se
   lean como «el freno quedó probado» (lo apuntó Codex de la suite de la v82). */
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

INSERT INTO negocios (id, datos) VALUES ('neg1','{"entradaToken":"tok1"}');
INSERT INTO staff (id, negocio_id, datos) VALUES
    ('st_ana', 'neg1','{"nombre":"Ana","nipHash":"hA","sucursalId":"s1","rol":"barman","estado":"Activo"}'),
    ('st_beto','neg1','{"nombre":"Beto","nipHash":"hB","sucursalId":"s1","rol":"cocinero","estado":"Activo"}'),
    ('st_gere','neg1','{"nombre":"Gere","nipHash":"hG","sucursalId":"s1","rol":"gerente","estado":"Activo"}');
`);

/* ── CÓMO ESTÁ HOY: la v82, corrida tal cual del repo ───────────────────── */
const V82 = fs.readFileSync(new URL('../supabase-migration-v82.sql', import.meta.url), 'utf8');
await db.exec(V82);

const CONTEO = (id, extra = {}) => JSON.stringify(Object.assign({
    id, nombre: 'Ron Añejo', insumoId: 'ron1', sucursalId: 's1', area: 'barra',
    cerradasBodega: 10, cerradasBarra: 0, fecha: '2026-10-20', hora: '19:00'
}, extra));
const ENTRADA = (id, extra = {}) => JSON.stringify(Object.assign({
    id, concepto: 'entrada', nombre: 'Ron Añejo', insumoId: 'ron1',
    sucursalId: 's1', area: 'barra', cantidad: 6, unidad: 'PZA',
    /* DESPUÉS del último cierre del fixture: el historial solo trae el periodo
       abierto, así que una entrada con fecha anterior no saldría y la prueba
       mediría el filtro del periodo en vez de lo que viene a comprobar. */
    fecha: '2026-10-22', hora: '10:00', registrado: '2026-10-22T10:00:00Z'
}, extra));
const registrar  = (nip, datos) => uno('SELECT inventario_conteo_registrar($1,$2,$3,$4::jsonb) AS id', ['neg1','tok1',nip,datos]);
const registrarE = (nip, datos) => uno('SELECT entrada_registrar($1,$2,$3,$4::jsonb) AS id', ['neg1','tok1',nip,datos]);
const editar = (nip, tipo, id, ver, cambios, op) => uno(
    'SELECT entrada_editar($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS r',
    ['neg1','tok1',nip,tipo,id,ver,JSON.stringify(cambios),op || null]);
const historial = (nip, area) => uno('SELECT entrada_historial($1,$2,$3,$4,$5) AS r', ['neg1','tok1',nip,'s1',area||'barra']);

console.log('\n══ ANTES de la v83 — los cinco agujeros, provocados ══');

/* H03 · El reenvío pisa una corrección y se lleva su auditoría. */
await registrar('hA', CONTEO('c1'));
await editar('hA', 'conteo', 'c1', 1, { cerradasBodega: 8 }, 'op1');
await ok('H03 · reenviar la captura ORIGINAL pisa la corrección y borra su rastro', async () => {
    const antes = await datosDe('inventario_conteos', 'c1');
    assert.equal(Number(antes.cerradasBodega), 8);
    assert.ok(Array.isArray(antes.auditoria) && antes.auditoria.length === 1);
    await registrar('hA', CONTEO('c1'));                 // la copia vieja, con 10
    const d = await datosDe('inventario_conteos', 'c1');
    assert.equal(Number(d.cerradasBodega), 10, 'volvió al valor de antes');
    assert.equal(d.auditoria, undefined, 'y la auditoría desapareció');
});

/* H06 · La entrada guarda su comentario en `notas`; el editor usa `nota`. */
await registrarE('hA', ENTRADA('e1', { notas: 'Factura original' }));
await ok('H06 · el editor abre SIN el comentario que trae la entrada', async () => {
    const h = (await historial('hA')).r;
    const m = h.movimientos.find(x => x.id === 'e1');
    assert.ok(m, 'la entrada está en el historial');
    assert.equal(m.nota, null, 'el historial no lo encuentra');
});
await ok('…y al corregirlo quedan DOS comentarios, uno por cada lector', async () => {
    await editar('hA', 'entrada', 'e1', 1, { nota: 'Factura corregida' }, 'op2');
    const d = await datosDe('entradas_log', 'e1');
    assert.equal(d.nota,  'Factura corregida');   // lo que leería el QR
    assert.equal(d.notas, 'Factura original');    // lo que sigue leyendo el ERP
});

/* H07 · Reintentar con OTRO contenido recibe un «ya estaba» falso. */
await registrar('hA', CONTEO('c7'));
await ok('H07 · cambiar el número y reintentar da un éxito falso', async () => {
    const a = (await editar('hA', 'conteo', 'c7', 1, { cerradasBodega: 8 }, 'opX')).r;
    assert.equal(a.ok, true);
    const b = (await editar('hA', 'conteo', 'c7', 2, { cerradasBodega: 6 }, 'opX')).r;
    assert.equal(b.ok, true);
    assert.equal(b.repetida, true, 'contesta que ya estaba');
    assert.equal(Number((await datosDe('inventario_conteos', 'c7')).cerradasBodega), 8,
                 'pero guardado quedó el valor anterior');
});

/* H08 · `concepto` es editable: una entrada se vuelve merma. */
await registrarE('hA', ENTRADA('e8'));
await ok('H08 · un colaborador convierte su entrada en merma', async () => {
    const r = (await editar('hA', 'entrada', 'e8', 1, { concepto: 'merma' }, 'op8')).r;
    assert.equal(r.ok, true);
    assert.equal((await datosDe('entradas_log', 'e8')).concepto, 'merma');
});

/* H09 · El cierre de BARRA bloquea correcciones de COCINA. */
await registrarE('hB', ENTRADA('e9', { area: 'cocina', registrado: '2026-10-21T12:00:00Z' }));
await db.exec(`INSERT INTO inventarios (id, negocio_id, datos) VALUES
    ('inv_barra','neg1','{"cerrado":true,"fecha":"2026-10-21","cierreOperativo":"2026-10-21T13:00:00Z","sucursalId":"s1","area":"barra","nombre":"Barra 21"}')`);
await ok('H09 · cerrar BARRA congela una entrada de COCINA', async () => {
    const r = (await editar('hB', 'entrada', 'e9', 1, { cantidad: 4 }, 'op9')).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'cerrado');
});

console.log('\n══ Corriendo supabase-migration-v83.sql ══');
const V83 = fs.readFileSync(new URL('../supabase-migration-v83.sql', import.meta.url), 'utf8');
await db.exec(V83);
console.log('  (corrió sin error de sintaxis)');

console.log('\n══ DESPUÉS — cada agujero, cerrado ══');

/* H03 */
await registrar('hA', CONTEO('c3'));
await editar('hA', 'conteo', 'c3', 1, { cerradasBodega: 8 }, 'op31');
await ok('H03 · el reenvío de una copia vieja ya NO pisa la corrección', async () => {
    const id = (await registrar('hA', CONTEO('c3'))).id;
    assert.equal(id, 'c3', 'contesta con el id, como una repetición');
    const d = await datosDe('inventario_conteos', 'c3');
    assert.equal(Number(d.cerradasBodega), 8, 'la corrección sigue en pie');
    assert.equal(d.auditoria.length, 1, 'y su rastro también');
});
await ok('…y un alta NUEVA por la misma puerta sigue funcionando', async () => {
    const id = (await registrar('hA', CONTEO('c4'))).id;
    assert.equal(id, 'c4');
    assert.equal(Number((await datosDe('inventario_conteos', 'c4')).cerradasBodega), 10);
});
await ok('…y un reenvío CON la versión al día sí actualiza, conservando el rastro', async () => {
    await editar('hA', 'conteo', 'c4', 1, { cerradasBodega: 7 }, 'op32');
    const d0 = await datosDe('inventario_conteos', 'c4');
    await registrar('hA', CONTEO('c4', { cerradasBodega: 5, ver: d0.ver }));
    const d = await datosDe('inventario_conteos', 'c4');
    assert.equal(Number(d.cerradasBodega), 5, 'el reenvío al día sí entra');
    assert.equal(d.auditoria.length, 1, 'y la auditoría no se perdió');
});

/* H06 */
await registrarE('hA', ENTRADA('e6', { notas: 'Factura original' }));
await ok('H06 · el historial trae el comentario donde de verdad vive', async () => {
    const m = (await historial('hA')).r.movimientos.find(x => x.id === 'e6');
    assert.equal(m.nota, 'Factura original');
});
await ok('…y corregirlo deja UN solo comentario, el que lee el ERP', async () => {
    const r = (await editar('hA', 'entrada', 'e6', 1, { notas: 'Factura corregida' }, 'op61')).r;
    assert.equal(r.ok, true);
    const d = await datosDe('entradas_log', 'e6');
    assert.equal(d.notas, 'Factura corregida');
    assert.equal(d.nota, undefined, 'no queda un segundo campo');
});
await ok('…y borrarlo lo borra de verdad', async () => {
    const r = (await editar('hA', 'entrada', 'e6', 2, { notas: '' }, 'op62')).r;
    assert.equal(r.ok, true);
    const d = await datosDe('entradas_log', 'e6');
    assert.equal(d.notas, undefined, 'la llave se fue');
});
/* Y el rezago: un registro que ya trae los DOS campos —`notas` de la captura
   y `nota` del editor de la v82— queda con uno solo al corregirlo. Dos
   comentarios para lo mismo es como el QR y el ERP acaban enseñando cosas
   distintas, que es justo lo que H06 vino a cerrar. */
await ok('…y corregir uno que trae los dos campos deja uno solo', async () => {
    await registrarE('hA', ENTRADA('e6c', { notas: 'de la captura' }));
    await db.exec(`UPDATE entradas_log SET datos = datos || '{"nota":"de la v82"}'::jsonb WHERE id='e6c'`);
    const r = (await editar('hA', 'entrada', 'e6c', 1, { notas: 'el bueno' }, 'op63')).r;
    assert.equal(r.ok, true);
    const d = await datosDe('entradas_log', 'e6c');
    assert.equal(d.notas, 'el bueno');
    assert.equal(d.nota, undefined, 'quedó el comentario viejo de la v82');
});
await ok('…y un comentario que escribió la v82 en `nota` no se esconde', async () => {
    await registrarE('hA', ENTRADA('e6b'));
    await db.exec(`UPDATE entradas_log SET datos = datos || '{"nota":"escrito por la v82"}'::jsonb WHERE id='e6b'`);
    const m = (await historial('hA')).r.movimientos.find(x => x.id === 'e6b');
    assert.equal(m.nota, 'escrito por la v82');
});

/* H07 */
await registrar('hA', CONTEO('c70'));
await ok('H07 · el mismo intento repetido sigue contestando que ya estaba', async () => {
    await editar('hA', 'conteo', 'c70', 1, { cerradasBodega: 8 }, 'opY');
    const b = (await editar('hA', 'conteo', 'c70', 1, { cerradasBodega: 8 }, 'opY')).r;
    assert.equal(b.ok, true);
    assert.equal(b.repetida, true);
});
await ok('…pero con OTRO contenido ya no finge: avisa del conflicto', async () => {
    const c = (await editar('hA', 'conteo', 'c70', 1, { cerradasBodega: 6 }, 'opY')).r;
    assert.equal(c.ok, false);
    assert.equal(c.motivo, 'conflicto', 'se entera de que su intento sí había entrado');
    assert.equal(Number((await datosDe('inventario_conteos', 'c70')).cerradasBodega), 8);
});
await ok('…y con la versión al día ese cambio nuevo sí entra', async () => {
    const d = (await editar('hA', 'conteo', 'c70', 2, { cerradasBodega: 6 }, 'opY')).r;
    assert.equal(d.ok, true);
    assert.equal(Number((await datosDe('inventario_conteos', 'c70')).cerradasBodega), 6);
});

/* H08 */
await registrarE('hA', ENTRADA('e80'));
await ok('H08 · `concepto` ya no se puede tocar', async () => {
    const r = (await editar('hA', 'entrada', 'e80', 1, { concepto: 'merma' }, 'op81')).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'sin-cambios', 'la llave ni se mira');
    assert.equal((await datosDe('entradas_log', 'e80')).concepto, 'entrada');
});
await ok('…y lo que NO es una entrada no se corrige por esta puerta', async () => {
    await registrarE('hA', ENTRADA('e82', { concepto: 'merma' }));
    const r = (await editar('hA', 'entrada', 'e82', 1, { cantidad: 3 }, 'op82')).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'tipo');
});
await ok('…y el historial lo DICE, en vez de dejar un botón apagado sin razón', async () => {
    const m = (await historial('hA')).r.movimientos.find(x => x.id === 'e82');
    assert.equal(m.puedeEditar, false);
    assert.equal(m.motivoBloqueo, 'Aquí solo se corrigen entradas');
});
await ok('…y corregir la CANTIDAD de una entrada de verdad sigue funcionando', async () => {
    const r = (await editar('hA', 'entrada', 'e80', 1, { cantidad: 9 }, 'op83')).r;
    assert.equal(r.ok, true);
    assert.equal(Number((await datosDe('entradas_log', 'e80')).cantidad), 9);
});

/* H09 */
await ok('H09 · el cierre de BARRA ya no congela una entrada de COCINA', async () => {
    const r = (await editar('hB', 'entrada', 'e9', 1, { cantidad: 4 }, 'op91')).r;
    assert.equal(r.ok, true);
    assert.equal(Number((await datosDe('entradas_log', 'e9')).cantidad), 4);
});
await ok('…pero el cierre de COCINA sí la congela', async () => {
    await db.exec(`INSERT INTO inventarios (id, negocio_id, datos) VALUES
        ('inv_cocina','neg1','{"cerrado":true,"fecha":"2026-10-21","cierreOperativo":"2026-10-21T14:00:00Z","sucursalId":"s1","area":"cocina","nombre":"Cocina 21"}')`);
    const r = (await editar('hB', 'entrada', 'e9', 2, { cantidad: 3 }, 'op92')).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'cerrado');
});
await ok('…y una captura SIN área se sigue midiendo contra cualquier cierre', async () => {
    await registrarE('hA', ENTRADA('e93', { registrado: '2026-10-21T12:30:00Z' }));
    await db.exec(`UPDATE entradas_log SET datos = datos - 'area' WHERE id='e93'`);
    const r = (await editar('hA', 'entrada', 'e93', 1, { cantidad: 2 }, 'op93')).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'cerrado', 'ante la duda, está dentro');
});
/* El desacuerdo entre lector y escritor: sin `registrado`, el historial usaba
   `created_at` y el editor `''` — y con `''` el guardia contesta que no hay
   cierre. Una captura vieja podía eludirlo. */
await ok('…y una captura sin `registrado` tampoco elude el cierre', async () => {
    await registrarE('hA', ENTRADA('e94', { area: 'cocina' }));
    await db.exec(`UPDATE entradas_log SET datos = datos - 'registrado',
                          created_at = '2026-10-21T12:00:00Z' WHERE id='e94'`);
    const r = (await editar('hA', 'entrada', 'e94', 1, { cantidad: 2 }, 'op94')).r;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'cerrado');
});

/* ── Lo legítimo sigue vivo ─────────────────────────────────────────────── */
console.log('\n══ Y lo que ya funcionaba, sigue funcionando ══');
await ok('la versión equivocada sigue avisando del conflicto', async () => {
    await registrar('hA', CONTEO('cz'));
    const r = (await editar('hA', 'conteo', 'cz', 99, { cerradasBodega: 1 })).r;
    assert.equal(r.motivo, 'conflicto');
});
await ok('lo de otro sigue sin poderse tocar', async () => {
    const r = (await editar('hB', 'conteo', 'cz', 1, { cerradasBodega: 1 })).r;
    assert.equal(r.motivo, 'autor');
});
await ok('…y un encargado sí puede', async () => {
    const r = (await editar('hG', 'conteo', 'cz', 1, { cerradasBodega: 1 })).r;
    assert.equal(r.ok, true);
});
await ok('un conteo YA APLICADO sigue sin poderse corregir ni reiniciar', async () => {
    await db.exec(`UPDATE inventario_conteos SET datos = datos || '{"aplicado":true}'::jsonb WHERE id='cz'`);
    const r = (await editar('hA', 'conteo', 'cz', 2, { cerradasBodega: 4 })).r;
    assert.equal(r.motivo, 'aplicado');
    const antes = await datosDe('inventario_conteos', 'cz');
    await registrar('hA', CONTEO('cz', { cerradasBodega: 999, ver: 99 }));
    const d = await datosDe('inventario_conteos', 'cz');
    assert.equal(Number(d.cerradasBodega), Number(antes.cerradasBodega));
    assert.equal(d.aplicado, true, 'el sello sigue puesto');
});
await ok('los ayudantes internos siguen sin estar expuestos a anon', async () => {
    const p = await uno(`SELECT
        has_function_privilege('anon','_entrada_periodo_cerrado(text,text,text,text)','EXECUTE') AS periodo,
        has_function_privilege('anon','entrada_editar(text,text,text,text,text,integer,jsonb,text)','EXECUTE') AS editar`);
    assert.equal(p.periodo, false, 'el guardia del periodo quedó expuesto');
    assert.equal(p.editar, true,  'y el editor tiene que seguir abierto al QR');
});
await ok('la puerta vieja de 3 argumentos ya no existe', async () => {
    const r = await q(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                        WHERE n.nspname='public' AND p.proname='_entrada_periodo_cerrado'
                          AND pg_get_function_identity_arguments(p.oid)='text, text, text'`);
    assert.equal(r.length, 0);
});
await ok('correrla dos veces no cambia nada', async () => {
    await db.exec(V83);
    const r = (await editar('hA', 'entrada', 'e80', 2, { cantidad: 11 }, 'op99')).r;
    assert.equal(r.ok, true);
    assert.equal(Number((await datosDe('entradas_log', 'e80')).cantidad), 11);
});

await db.close();
console.log('\nSQL v83: ' + cuenta + ' casos, 0 fallas');
