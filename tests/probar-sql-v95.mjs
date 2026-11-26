/* RECIBOS Y PRESUPUESTOS: EDITAR CON EL GENERADOR Y ELIMINAR (v95) — contra un
   Postgres DE VERDAD (PGlite), sobre la v81 tal cual.
     · Reemitir: mismo id y MISMO folio, versión que sube, bitácora con el
       «antes», sin cambiar de tipo, solo documentos generados.
     · Eliminar: marca (no borra), pide motivo, suelta el vínculo con su
       presupuesto; restaurar lo regresa.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado. */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {PGlite} = createRequire((process.env.PGLITE_DIR || '/tmp/etaax-billing-sql') + '/test.cjs')('@electric-sql/pglite');
const db = new PGlite(); let cuenta = 0;
async function ok(nombre, fn) { await fn(); cuenta++; console.log('PASA ' + nombre); }
await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;
  CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('prueba.admin',true),'false')='true'$$;
  CREATE TABLE public.negocios(id text primary key); INSERT INTO public.negocios VALUES ('n1'), ('n2');
  GRANT USAGE ON SCHEMA public,auth TO authenticated;`);
const leer = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
await db.exec(leer('supabase-migration-v81.sql'));
await db.exec(leer('supabase-migration-v95.sql')); await db.exec(leer('supabase-migration-v95.sql'));
await db.exec("SET ROLE authenticated;SET prueba.admin='true'");
const q = async (s, a) => (await db.query(s, a)).rows;
const crear = async d => (await q('select * from public.admin_documento_crear($1::jsonb)', [JSON.stringify(d)]))[0];
const reemitir = async (id, v, d) => (await q('select * from public.admin_documento_reemitir($1,$2,$3::jsonb)', [id, v, JSON.stringify(d)]))[0];
const eliminar = async (id, v, m) => (await q('select * from public.admin_documento_eliminar($1,$2,$3)', [id, v, m]))[0];
const restaurar = async (id, v) => (await q('select * from public.admin_documento_restaurar($1,$2)', [id, v]))[0];
const base = { id: 'r1', folio: 'REC-1', tipo: 'recibo', estado: 'pendiente', cliente: 'EL MIAMI', cliente_negocio_id: 'n1', fecha: '2026-11-23',
               total: 900, suscripcion_monto: 900, meses: 1, periodo_desde: '2026-11-01', datos: { tipo: 'recibo', total: 900 }, html: '<html>900</html>' };

await crear(base);
await ok('reemitir: el MISMO documento y folio, con lo nuevo; la versión sube', async () => {
    const d = await reemitir('r1', 1, { tipo: 'recibo', folio: 'OTRO-FOLIO', cliente: 'EL MIAMI SA', cliente_negocio_id: 'n1', fecha: '2026-11-25', total: 2699,
        suscripcion_monto: 1799, meses: 1, periodo_desde: '2026-11-01', estado: 'pagado', fecha_pago: '2026-11-25', metodo: 'Transferencia', referencia: '123',
        datos: { tipo: 'recibo', total: 2699 }, html: '<html>2699</html>' });
    const fp = (await q(`select fecha_pago::text f from admin_documentos where id='r1'`))[0].f;
    assert.deepEqual([d.id, d.folio, Number(d.total), d.cliente, d.estado, fp, d.html, d.version], ['r1', 'REC-1', 2699, 'EL MIAMI SA', 'pagado', '2026-11-25', '<html>2699</html>', 2]);
});
await ok('…y la bitácora guarda cómo estaba antes', async () => {
    const c = (await q(`select cambios from admin_documentos where id='r1'`))[0].cambios;
    const u = c[c.length - 1];
    assert.deepEqual([u.accion, Number(u.antes.total), u.antes.cliente, u.antes.estado], ['reemitido', 900, 'EL MIAMI', 'pendiente']);
});
await ok('una pestaña atrasada no pisa la edición', async () =>
    assert.rejects(() => reemitir('r1', 1, { tipo: 'recibo', total: 5, html: 'x' }), /otra ventana/));
await ok('no cambia de tipo, y no deja un total en cero ni una suscripción mayor que el total', async () => {
    await assert.rejects(() => reemitir('r1', 2, { tipo: 'presupuesto', total: 100, html: 'x' }), /no cambia de tipo/);
    await assert.rejects(() => reemitir('r1', 2, { tipo: 'recibo', total: 0, html: 'x' }), /check constraint/);
    await assert.rejects(() => reemitir('r1', 2, { tipo: 'recibo', total: 100, suscripcion_monto: 500, periodo_desde: '2026-11-01', html: 'x' }), /check constraint/);
});
await ok('anular al reemitir pide motivo; pagado pide fecha', async () => {
    await assert.rejects(() => reemitir('r1', 2, { tipo: 'recibo', total: 100, estado: 'anulado', html: 'x' }), /motivo/);
    await assert.rejects(() => reemitir('r1', 2, { tipo: 'recibo', total: 100, estado: 'pagado', html: 'x' }), /check constraint/);
});
await ok('un PDF recuperado no se rearma', async () => {
    await crear({ ...base, id: 'pdf1', folio: 'ARCH-1', origen: 'pdf_recuperado', origen_clave: 'pdf:1', html: '', pdf_base64: 'JVBERi0=' });
    await assert.rejects(() => reemitir('pdf1', 1, { tipo: 'recibo', total: 100, html: 'x' }), /PDF recuperado/);
});

/* ── Eliminar y restaurar ── */
await crear({ ...base, id: 'p1', folio: 'PRE-1', tipo: 'presupuesto' });
await crear({ ...base, id: 'r2', folio: 'REC-2', presupuesto_id: 'p1' });
await ok('eliminar pide motivo', async () => assert.rejects(() => eliminar('r2', 1, '  '), /por qué/));
await ok('eliminar MARCA (no borra): queda con motivo y bitácora, y suelta su presupuesto', async () => {
    const d = await eliminar('r2', 1, 'Duplicado');
    assert.ok(d.eliminado_at); assert.equal(d.eliminado_motivo, 'Duplicado');
    assert.deepEqual([d.presupuesto_id, d.presupuesto_id_previo, d.version], [null, 'p1', 2]);
    assert.equal((await q(`select count(*)::int n from admin_documentos where id='r2'`))[0].n, 1);
    assert.equal(d.cambios[d.cambios.length - 1].accion, 'eliminado');
});
await ok('…con el presupuesto libre se puede volver a generar su recibo', async () =>
    assert.equal((await crear({ ...base, id: 'r3', folio: 'REC-3', presupuesto_id: 'p1' })).presupuesto_id, 'p1'));
await ok('un eliminado no se edita hasta restaurarlo', async () =>
    assert.rejects(() => reemitir('r2', 2, { tipo: 'recibo', total: 100, html: 'x' }), /eliminado/));
await ok('restaurar lo regresa; el vínculo vuelve solo si nadie lo ocupó (aquí ya lo ocupa REC-3)', async () => {
    const d = await restaurar('r2', 2);
    assert.deepEqual([d.eliminado_at, d.eliminado_motivo, d.presupuesto_id, d.version], [null, '', null, 3]);
    assert.equal(d.cambios[d.cambios.length - 1].accion, 'restaurado');
});
await ok('…y si nadie lo ocupó, el vínculo regresa', async () => {
    const e = await eliminar('r3', 1, 'prueba');
    const d = await restaurar('r3', e.version);
    assert.equal(d.presupuesto_id, 'p1');
});

/* ── Candados ── */
await ok('el admin no puede saltarse las RPC (sin UPDATE ni DELETE directos)', async () => {
    await assert.rejects(() => q(`update admin_documentos set total=1 where id='r1'`), /permission denied/);
    await assert.rejects(() => q(`delete from admin_documentos where id='r1'`), /permission denied/);
});
await ok('quien no es admin maestro no reemite, ni elimina, ni restaura', async () => {
    await db.exec("SET prueba.admin='false'");
    await assert.rejects(() => reemitir('r1', 2, { tipo: 'recibo', total: 100, html: 'x' }), /admin maestro/);
    await assert.rejects(() => eliminar('r1', 2, 'x'), /admin maestro/);
    await assert.rejects(() => restaurar('r1', 2), /admin maestro/);
    await db.exec("SET prueba.admin='true'");
});
await db.exec('RESET ROLE;SET ROLE anon');
await ok('anónimo ni siquiera puede llamarlas', async () => {
    await assert.rejects(() => eliminar('r1', 2, 'x'), /permission denied/);
    await assert.rejects(() => reemitir('r1', 2, { tipo: 'recibo', total: 1, html: 'x' }), /permission denied/);
});
await db.close();
console.log('\n🔒 v95 OK — ' + cuenta + ' comprobaciones contra Postgres');
