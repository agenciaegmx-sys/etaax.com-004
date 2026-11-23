/* MIGRAR UNA SUCURSAL — la pantalla del panel admin, en un navegador de verdad.

   Lo que se vigila: que se pueda elegir (sin la Matriz), que el plan se lea
   antes de tocar nada, que «Migrar ahora» NO se prenda sin respaldo ni sin
   escribir el nombre de la sucursal, que primero se copien las fotos y luego
   corra UNA llamada a admin_migrar_sucursal con el plan, y que un error del
   servidor se diga sin dar por hecha la migración. La función SQL se prueba
   aparte, contra Postgres (tests/probar-sql-v86.mjs).

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
const fila = (t, id, neg, d) => ({ id, negocio_id: neg, datos: Object.assign({ id }, d) });
const nube = {
    usuarios: [{ id: 'u1', nombre: 'EGMx', plan: 'gran' }, { id: 'u2', nombre: 'Dueño Miami', plan: 'pyme' }],
    negocios: [{ id: 'A', usuario_id: 'u1', datos: { id: 'A', nombre: 'EGMx' } }, { id: 'B', usuario_id: 'u2', datos: { id: 'B', nombre: 'Miami SA' } }],
    negocio_sucursales: [
        { negocio_id: 'A', updated_at: '2026-11-20T10:00:00+00:00', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz', activa: true }, { id: S, nombre: 'El Miami', activa: true }] } },
        { negocio_id: 'B', updated_at: '2026-11-20T10:00:00+00:00', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz B', activa: true }] } }],
    cortes: [fila('cortes', 'c1', 'A', { sucursalId: S, foto: 'priv:A/cortes/f1.jpg' }), fila('cortes', 'c2', 'A', {})],
    inventarios: [fila('inventarios', 'inv1', 'A', { sucursalId: S, cocktailsVendidos: { r1: 2 } })],
    staff: [fila('staff', 'st1', 'A', { sucursalId: S, nombre: 'Ana' })],
    negocio_insumos: [{ negocio_id: 'A', insumo_id: 'i1', datos: { id: 'i1', nombre: 'Ron', sucursales: [S] } }],
    recetas: [fila('recetas', 'r1', 'A', { nombre: 'Mojito', sucursales: [S] })],
    suscripciones: [], staff_: [], solicitudes_plan: [], invitaciones: [], catalogo_proveedores: []
};

(async () => {
    const browser = await C.chromium.launch();
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
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

        console.log('\n══ Migrar sucursal · la pantalla ══');
        await caso('la tarjeta «Migrar sucursal» ya abre su pantalla (no es «Próximamente»)', async () => {
            await page.click('.adm-card[data-card="migrar"]'); await page.waitForTimeout(300);
            assert.ok(await page.evaluate(() => document.getElementById('tab-migrar').classList.contains('active') && !!document.getElementById('migOrig')));
        });
        await page.selectOption('#migOrig', 'A'); await page.waitForTimeout(150);
        await caso('al elegir el origen, la lista de sucursales trae las suyas SIN la Matriz', async () =>
            assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#migSuc option')].map(o => o.value).filter(Boolean)), [S]));
        await caso('…y el destino no ofrece el mismo negocio', async () =>
            assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#migDest option')].map(o => o.value).filter(Boolean)), ['B']));
        await page.selectOption('#migSuc', S); await page.selectOption('#migDest', 'B'); await page.waitForTimeout(150);
        await page.click('#tab-migrar .btn-prim'); await page.waitForTimeout(800);
        await caso('«Revisar» enseña el plan: qué se muda y qué se copia', async () => {
            const t = await page.evaluate(() => document.getElementById('migPlan').innerText.replace(/\s+/g, ' '));
            assert.match(t, /El Miami · de EGMx → a Miami SA/);
            assert.match(t, /Cortes de caja 1/);
            assert.match(t, /Colaboradores 1/);
            assert.match(t, /Recetas y sub-recetas .*1/);
            assert.match(t, /Se queda en el negocio original/i);
        });
        const btnMigrar = () => page.evaluate(() => document.getElementById('migBtn').disabled);
        await caso('«Migrar ahora» empieza apagado', async () => assert.equal(await btnMigrar(), true));
        await page.fill('#migConfirma', 'El Miami');
        await caso('…y escribir el nombre NO basta: falta el respaldo', async () => assert.equal(await btnMigrar(), true));
        const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#migPlan .btn-mini')]);
        await caso('el respaldo se descarga con todo lo que el plan toca', async () => {
            const txt = fs.readFileSync(await descarga.path(), 'utf8'), r = JSON.parse(txt);
            assert.equal(r._tipo, 'respaldo_migracion_sucursal_etaax');
            assert.deepEqual(r.origen.tablas.cortes.map(x => x.id), ['c1']);
            assert.equal(r.plan.sucursal, S);
        });
        await caso('con respaldo y el nombre escrito, se prende', async () => assert.equal(await btnMigrar(), false));
        await page.screenshot({ path: process.env.CAPTURAS ? process.env.CAPTURAS + '/admin-migrar.png' : '/dev/null', fullPage: true }).catch(() => {});

        // Un error del servidor: se dice y NO se da por hecha.
        await page.evaluate(() => {
            window.__llamadas = []; window.__copias = [];
            _supabase.storage.from = (b) => ({ copy: async (de, a) => { __copias.push(b + ':' + de + '>' + a); return { error: null }; } });
            _supabase.rpc = async (fn, args) => { __llamadas.push({ fn, args }); return { data: null, error: { message: 'Could not find the function public.admin_migrar_sucursal in the schema cache' } }; };
        });
        await page.click('#migBtn'); await page.waitForTimeout(200);
        await page.click('[data-adm-dialog] [data-act="yes"]'); await page.waitForTimeout(600);
        await caso('si falta la función en el servidor, lo dice (correr la v86) y no se da por migrada', async () => {
            const t = await page.evaluate(() => [...document.querySelectorAll('[data-adm-dialog]')].map(d => d.innerText).join(' '));
            assert.match(t, /supabase-migration-v86\.sql/);
            assert.match(t, /No se movió nada/);
            assert.ok(await page.evaluate(() => !!document.getElementById('migBtn')), 'el plan se quedó para reintentar');
        });
        await caso('…antes de la migración se copiaron las fotos privadas a la carpeta del destino', async () =>
            assert.deepEqual(await page.evaluate(() => __copias), ['evidencias-priv:A/cortes/f1.jpg>B/cortes/f1.jpg']));
        await page.evaluate(() => document.querySelectorAll('[data-adm-dialog]').forEach(d => d.remove()));

        // Ahora el servidor dice que sí.
        await page.evaluate(() => {
            _supabase.rpc = async (fn, args) => { __llamadas.push({ fn, args }); return { data: { ok: true, id: 'mig_1', cuenta: { cortes: 1, inventarios: 1, staff: 1, insumos_copiados: 1, recetas_copiadas: 1 } }, error: null }; };
        });
        await page.click('#migBtn'); await page.waitForTimeout(200);
        await page.click('[data-adm-dialog] [data-act="yes"]'); await page.waitForTimeout(900);
        await caso('«Migrar» hace UNA llamada a admin_migrar_sucursal con el plan', async () => {
            const l = await page.evaluate(() => __llamadas[__llamadas.length - 1]);
            assert.equal(l.fn, 'admin_migrar_sucursal');
            assert.deepEqual([l.args.p_plan.origen, l.args.p_plan.destino, l.args.p_plan.sucursal], ['A', 'B', S]);
            assert.ok(l.args.p_plan.tablas.indexOf('cortes') > -1 && l.args.p_plan.remap['priv:A/cortes/f1.jpg'] === 'priv:B/cortes/f1.jpg');
        });
        await caso('…y dice lo que movió, con los pendientes (QR, recargar)', async () => {
            const t = await page.evaluate(() => document.getElementById('migPlan').innerText.replace(/\s+/g, ' '));
            assert.match(t, /Migración hecha/);
            assert.match(t, /3 registros mudados, 1 insumos y 1 recetas copiados/);
            assert.match(t, /QR/);
        });
        await page.screenshot({ path: process.env.CAPTURAS ? process.env.CAPTURAS + '/admin-migrar-hecho.png' : '/dev/null' }).catch(() => {});
        await ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]).length;
    console.log(malos ? '\n🚨 ' + malos + ' de ' + resultados.length + ' casos fallaron' : '\n🔒 MIGRAR SUCURSAL EN NAVEGADOR OK — ' + resultados.length + ' casos');
    process.exit(malos ? 1 : 0);
})();
