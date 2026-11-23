/* PASAR UNA SUCURSAL A OTRO NEGOCIO — la pantalla del panel admin, en un
   navegador de verdad. Flujo (Edwin, 23-nov): COPIAR (el original no se toca)
   → revisar → ELIMINAR del original (al archivo, su staff pasa a la copia) →
   RESTAURAR desde el archivo.

   Lo que se vigila: que se pueda elegir (sin la Matriz); que la copia se lea
   antes de hacerla; que copiar escriba en el destino y NO toque el original;
   que eliminar pida escribir el nombre, proponga pasar el staff a donde está
   la copia y llame a admin_archivar_sucursal; y que el archivo liste lo
   eliminado con «Restaurar». Las funciones SQL se prueban aparte, contra
   Postgres (tests/probar-sql-v86.mjs).

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-admin-migrar.cjs */
'use strict';
const assert = require('node:assert/strict');
const path = require('path'), fs = require('fs');
const C = require('./navegador-comun.cjs');
const RAIZ = path.resolve(__dirname, '..');
const TIPOS = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const resultados = [];
async function caso(nombre, fn) {
    try { await fn(); resultados.push([nombre, true]); console.log('  ✅ ' + nombre); }
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n')[0]); }
}
const S = 'suc_mia';
const fila = (id, neg, d) => ({ id, negocio_id: neg, datos: Object.assign({ id }, d) });
const nube = {
    usuarios: [{ id: 'u1', nombre: 'EGMx', plan: 'gran' }, { id: 'u2', nombre: 'Dueño Miami', plan: 'pyme' }],
    negocios: [{ id: 'A', usuario_id: 'u1', datos: { id: 'A', nombre: 'EGMx' } }, { id: 'B', usuario_id: 'u2', datos: { id: 'B', nombre: 'Miami SA' } }],
    negocio_sucursales: [
        { negocio_id: 'A', updated_at: '2026-11-20T10:00:00+00:00', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz', activa: true }, { id: S, nombre: 'El Miami', activa: true }] } },
        { negocio_id: 'B', updated_at: '2026-11-20T10:00:00+00:00', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz B', activa: true }] } }],
    cortes: [fila('c1', 'A', { sucursalId: S, foto: 'priv:A/cortes/f1.jpg', tarjetaCuentas: [{ cuentaId: 'cta_mia', neto: 100 }] }), fila('c2', 'A', {})],
    // Cuentas bancarias (del negocio): la base de débito y la que usa la sucursal viajan; la otra, no.
    tarjetas_credito: [fila('cta_base', 'A', { tipo: 'debito', banco: 'BBVA', fechaAlta: '2025-01-01' }),
                       fila('cta_mia', 'A', { tipo: 'debito', banco: 'Banorte', fechaAlta: '2026-01-01' }),
                       fila('cta_otra', 'A', { tipo: 'debito', banco: 'Santander', fechaAlta: '2026-02-01' })],
    inventarios: [fila('inv1', 'A', { sucursalId: S, cocktailsVendidos: { r1: 2 } })],
    staff: [fila('st1', 'A', { sucursalId: S, nombre: 'Ana' })],
    negocio_insumos: [{ negocio_id: 'A', insumo_id: 'i1', datos: { id: 'i1', nombre: 'Ron', sucursales: [S] } }],
    recetas: [fila('r1', 'A', { nombre: 'Mojito', sucursales: [S] })],
    admin_sucursales_archivo: [{ id: 'arc_1', negocio_id: 'A', sucursal_id: 'suc_tul', created_at: '2026-11-22T10:00:00+00:00', restaurada_at: null,
        datos: { nombre: 'Tulum', cuenta: { cortes: 12, inventarios: 3, staff: 2 } } }],
    suscripciones: [], solicitudes_plan: [], invitaciones: [], catalogo_proveedores: []
};

(async () => {
    const browser = await C.chromium.launch();
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (url.origin === C.ORIGEN) {
                const p = path.join(RAIZ, decodeURIComponent(url.pathname));
                if (p.startsWith(RAIZ) && fs.existsSync(p) && fs.statSync(p).isFile())
                    return route.fulfill({ status: 200, body: fs.readFileSync(p), headers: { 'content-type': TIPOS[path.extname(p)] || 'application/octet-stream' } });
                return route.fulfill({ status: 404, body: '' });
            }
            if (/supabase-js/.test(url.href))   // el SDK de prueba, con la cuenta maestra
                return route.fulfill({ status: 200, body: '(' + C.sdkFalso.toString().replace("email:'duena@fixture.invalid'", "email:'admin@etaax.com'") + ')();',
                                       headers: { 'content-type': 'application/javascript' } });
            return route.abort();
        });
        await ctx.addInitScript(C.semilla('2026-11-23T12:00:00-06:00', nube));
        const page = await ctx.newPage();
        page.on('pageerror', e => console.log('  [pageerror]', e.message));
        await page.goto(C.ORIGEN + '/admin.html');
        await page.waitForFunction(() => document.getElementById('viewAdmin').style.display === 'block' && document.querySelector('.adm-card[data-card="migrar"]'), null, { timeout: 15000 });
        await page.waitForTimeout(600);
        const enNube = (t) => page.evaluate((t) => JSON.parse(localStorage.getItem('__nube'))[t] || [], t);

        console.log('\n══ Pasar una sucursal a otro negocio · la pantalla ══');
        await page.click('.adm-card[data-card="migrar"]'); await page.waitForTimeout(400);
        await caso('la pantalla explica los 3 pasos y tiene copiar, eliminar y el archivo', async () => {
            const t = await page.evaluate(() => document.getElementById('tab-migrar').innerText.replace(/\s+/g, ' '));
            assert.match(t, /Copia la sucursal al negocio nuevo \(el original no se toca\)/);
            assert.match(t, /Copiar a otro negocio.*Eliminar una sucursal.*Sucursales eliminadas/);
        });
        await page.selectOption('#migOrig', 'A'); await page.waitForTimeout(150);
        await caso('al elegir el origen, sus sucursales SIN la Matriz; el destino no ofrece el mismo negocio', async () => {
            assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#migSuc option')].map(o => o.value).filter(Boolean)), [S]);
            assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#migDest option')].map(o => o.value).filter(Boolean)), ['B']);
        });
        await page.selectOption('#migSuc', S); await page.selectOption('#migDest', 'B'); await page.waitForTimeout(150);
        await page.click('#tab-migrar .btn-prim'); await page.waitForTimeout(800);
        await caso('«Revisar» enseña lo que se va a copiar y avisa que el staff pasa al eliminar', async () => {
            const t = await page.evaluate(() => document.getElementById('migPlan').innerText.replace(/\s+/g, ' '));
            assert.match(t, /El Miami · de EGMx → a Miami SA/);
            assert.match(t, /Cortes de caja 1/);
            assert.match(t, /Cuentas bancarias y tarjetas las que usan sus cortes, depósitos y gastos, y la principal de débito 2/);
            assert.match(t, /no se copia: su usuario es único/);
            assert.match(t, /El negocio original NO se toca/);
        });
        await page.evaluate(() => {
            window.__copias = [];
            _supabase.storage.from = (b) => ({ copy: async (de, a) => { __copias.push(b + ':' + de + '>' + a); return { error: null }; } });
        });
        await page.click('#migBtn'); await page.waitForTimeout(200);
        await page.click('[data-adm-dialog] [data-act="yes"]'); await page.waitForTimeout(1500);
        await caso('«Copiar» escribe la copia en el destino (ids nuevos) y NO toca el original', async () => {
            const cortes = await enNube('cortes');
            const copia = cortes.find(c => c.negocio_id === 'B');
            assert.ok(copia && copia.id !== 'c1' && copia.datos.foto === 'priv:B/cortes/f1.jpg', JSON.stringify(copia));
            assert.equal(cortes.find(c => c.id === 'c1').negocio_id, 'A');
            assert.equal((await enNube('staff')).filter(x => x.negocio_id === 'B').length, 0);
            assert.deepEqual(await page.evaluate(() => __copias), ['evidencias-priv:A/cortes/f1.jpg>B/cortes/f1.jpg']);
        });
        await caso('…con las cuentas que usa la sucursal (y el corte nombra a la copia de su cuenta)', async () => {
            const ctas = (await enNube('tarjetas_credito')).filter(c => c.negocio_id === 'B');
            assert.deepEqual(ctas.map(c => c.datos.banco).sort(), ['BBVA', 'Banorte']);
            const copia = (await enNube('cortes')).find(c => c.negocio_id === 'B');
            const mia = ctas.find(c => c.datos.banco === 'Banorte');
            assert.equal(copia.datos.tarjetaCuentas[0].cuentaId, mia.id);
            assert.equal((await enNube('tarjetas_credito')).filter(c => c.negocio_id === 'A').length, 3);
        });
        await caso('…la sucursal aparece en el destino diciendo de dónde viene, y la pantalla lo confirma', async () => {
            const b = (await enNube('negocio_sucursales')).find(x => x.negocio_id === 'B');
            assert.ok(b.datos.sucursales.some(s => s.id === S && s.copiaDe && s.copiaDe.negocio === 'A'));
            assert.match(await page.evaluate(() => document.getElementById('migPlan').innerText), /Copia hecha/);
        });
        await caso('después de copiar, «Eliminar» ya tiene el original elegido y propone pasar el staff a la copia', async () => {
            const r = await page.evaluate(() => ({ neg: document.getElementById('migArcNeg').value, suc: document.getElementById('migArcSuc').value,
                staff: document.getElementById('migArcStaff').value, txt: document.getElementById('migArcStaff').selectedOptions[0].textContent }));
            assert.deepEqual([r.neg, r.suc, r.staff], ['A', S, 'B|' + S]);
            assert.match(r.txt, /Pasa a «Miami SA»/);
        });
        await caso('«Eliminar» empieza apagado y solo se prende al escribir el nombre', async () => {
            assert.equal(await page.evaluate(() => document.getElementById('migArcBtn').disabled), true);
            await page.fill('#migArcConfirma', 'el miami');
            assert.equal(await page.evaluate(() => document.getElementById('migArcBtn').disabled), false);
        });
        await page.screenshot({ path: process.env.CAPTURAS ? process.env.CAPTURAS + '/admin-migrar.png' : '/dev/null', fullPage: true }).catch(() => {});
        await page.evaluate(() => {
            window.__llamadas = [];
            _supabase.rpc = async (fn, args) => { __llamadas.push({ fn, args }); return { data: { ok: true, id: 'arc_2', cuenta: { cortes: 1, inventarios: 1, staff_pasado: 1 } }, error: null }; };
        });
        await page.click('#migArcBtn'); await page.waitForTimeout(200);
        await page.click('[data-adm-dialog] [data-act="yes"]'); await page.waitForTimeout(800);
        await caso('…llama a admin_archivar_sucursal con el staff hacia la copia, y dice lo que guardó', async () => {
            const l = await page.evaluate(() => __llamadas[0]);
            assert.equal(l.fn, 'admin_archivar_sucursal');
            assert.deepEqual(l.args, { p_neg: 'A', p_suc: S, p_staff_a: 'B', p_staff_suc: S });
            assert.match(await page.evaluate(() => document.getElementById('migEliminar').innerText), /2 registros guardados en el archivo, 1 colaborador pasó a Miami SA/);
        });
        await caso('el archivo lista las sucursales eliminadas con «Restaurar»', async () => {
            await page.waitForSelector('#migArchivo button', { timeout: 5000 });
            const t = await page.evaluate(() => document.getElementById('migArchivo').textContent.replace(/\s+/g, ' '));
            assert.match(t, /Tulum.*EGMx.*17.*en el archivo.*Restaurar/, t);   // 12 cortes + 3 inventarios + 2 colaboradores archivados
        });
        await page.click('#migArchivo button'); await page.waitForTimeout(200);
        await page.click('[data-adm-dialog] [data-act="yes"]'); await page.waitForTimeout(800);
        await caso('«Restaurar» llama a admin_restaurar_sucursal con ese archivo', async () => {
            const l = await page.evaluate(() => __llamadas[__llamadas.length - 1]);
            assert.deepEqual([l.fn, l.args], ['admin_restaurar_sucursal', { p_id: 'arc_1' }]);
        });
        await page.evaluate(() => { _supabase.rpc = async () => ({ data: null, error: { message: 'Could not find the function public.admin_restaurar_sucursal in the schema cache' } }); });
        await page.click('#migArchivo button'); await page.waitForTimeout(200);
        await page.click('[data-adm-dialog] [data-act="yes"]'); await page.waitForTimeout(600);
        await caso('si falta la v87 en el servidor, lo dice y no da nada por hecho', async () => {
            const t = await page.evaluate(() => [...document.querySelectorAll('[data-adm-dialog]')].map(d => d.innerText).join(' '));
            assert.match(t, /supabase-migration-v87\.sql/);
            assert.match(t, /No se restauró nada/);
        });
        await ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]).length;
    console.log(malos ? '\n🚨 ' + malos + ' de ' + resultados.length + ' casos fallaron' : '\n🔒 PASAR SUCURSAL EN NAVEGADOR OK — ' + resultados.length + ' casos');
    process.exit(malos ? 1 : 0);
})();
