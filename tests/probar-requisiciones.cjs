/* REQUISICIONES — en un navegador de verdad.

   Lo que se vigila:
     · EL CATÁLOGO CARGA (Edwin, 23-nov: «no carga insumos»): se pedía ordenado
       por created_at y `negocio_insumos` no tiene esa columna. El Supabase de
       mentira contesta ese error igual que producción.
     · Lee el catálogo COMPLETO, paginado (aquí con páginas de verdad: el tope de
       una consulta no deja fuera insumos).
     · Solo los insumos de ESTA sucursal, sin sub-recetas.
     · El botón de los pasos es el de inventarios («① Existencias ▾»).
     · Cost·ax es independiente: con Cost·ax solo no se leen las ventas (cortes)
       ni se enseña «Compra vs venta»; con el paquete, sí.

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-requisiciones.cjs */
'use strict';
const assert = require('node:assert/strict');
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const { sdkEtx } = require('./sdk-cuentas.cjs');
const RAIZ = path.resolve(__dirname, '..');
const ORIGEN = 'https://etaax.prueba';
const TIPOS = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const resultados = [];
async function caso(nombre, fn) {
    try { await fn(); resultados.push([nombre, true]); console.log('  ✅ ' + nombre); }
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n')[0]); }
}
const pres = (min, max) => [{ nombre: 'Botella 750 ml', contenido: 750, unidad: 'ml', stockMin: min, stockMax: max, costoPieza: 200 }];
const ins = (id, d) => ({ negocio_id: 'n1', insumo_id: id, datos: Object.assign({ id, presentaciones: pres(2, 6), activo: '1' }, d) });
function nube(plan) {
    // 1,203 insumos de la sucursal: más que el tope de 1000 de una sola consulta.
    const muchos = Array.from({ length: 1200 }, (_, i) => ins('x' + String(i).padStart(4, '0'), { nombre: 'Insumo ' + i, familia: 'Abarrotes', sucursales: ['suc_principal'] }));
    return {
        __auth: [{ id: 'u1', email: 'duena@etaax.prueba', password: 'x', meta: { nombre: 'Dueña' } }],
        negocios: [{ id: 'n1', usuario_id: 'u1', datos: { nombre: 'Café de prueba' } }],
        negocio_sucursales: [{ negocio_id: 'n1', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz', activa: true }, { id: 'suc_dos', nombre: 'Dos', activa: true }] } }],
        suscripciones: [{ negocio_id: 'n1', estado: 'activa', plan: plan }],
        negocio_insumos: [
            ins('a_mezcal', { nombre: 'Mezcal Espadín', familia: 'Destilados', area: 'barra', sucursales: ['suc_principal'] }),
            ins('a_limon', { nombre: 'Limón', familia: 'Frutas', area: 'cocina', sucursales: ['suc_principal', 'suc_dos'] }),
            ins('a_ron', { nombre: 'Ron Blanco', familia: 'Destilados', sucursales: ['suc_dos'] }),          // de otra sucursal
            ins('a_batch', { nombre: 'Batch Paloma', esSubReceta: true, sucursales: ['suc_principal'] })    // sub-receta
        ].concat(muchos),
        cortes: [{ id: 'c1', negocio_id: 'n1', datos: { id: 'c1', fecha: '2026-11-20', sucursalId: 'suc_principal', efectivo: 5000 } }],
        req_pedido: [], req_historial: [], permisos: []
    };
}
function semilla(n) {
    return `(() => {
        window.alert = () => {}; window.confirm = () => true;
        if (!localStorage.getItem('__sembrado')) {
            localStorage.clear();
            localStorage.setItem('__nube', ${JSON.stringify(JSON.stringify(n))});
            localStorage.setItem('etaax_negocio_activo', 'n1');
            localStorage.setItem('etaax_sucursal_activa', 'suc_principal');
            localStorage.setItem('etaax_ctx', JSON.stringify({ ctxType: 'owner', negId: 'n1', negNombre: 'Café de prueba', sucId: 'suc_principal', sucNombre: 'Matriz', userName: 'Dueña' }));
            localStorage.setItem('etaax_negocios', JSON.stringify([{ id: 'n1', usuarioId: 'u1', nombre: 'Café de prueba' }]));
            localStorage.setItem('etaax_n1_sucursales', JSON.stringify([{ id: 'suc_principal', nombre: 'Matriz' }, { id: 'suc_dos', nombre: 'Dos' }]));
            ${n.suscripciones[0].plan ? `localStorage.setItem('etaax_n1_plan', ${JSON.stringify(JSON.stringify(n.suscripciones[0].plan))});` : ''}
            localStorage.setItem('etaax_novedades_vista', '{}');
            localStorage.setItem('__sembrado', '1');
        }
        if (!sessionStorage.getItem('__ses')) sessionStorage.setItem('__ses', JSON.stringify({ id: 'u1', email: 'duena@etaax.prueba' }));
    })();`;
}
async function abrir(browser, n) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === ORIGEN) {
            const p = path.join(RAIZ, decodeURIComponent(url.pathname));
            if (p.startsWith(RAIZ) && fs.existsSync(p) && fs.statSync(p).isFile())
                return route.fulfill({ status: 200, body: fs.readFileSync(p), headers: { 'content-type': TIPOS[path.extname(p)] || 'application/octet-stream' } });
            return route.fulfill({ status: 404, body: '' });
        }
        if (/supabase-js/.test(url.href)) {
            /* Páginas de 1000 como Supabase: el SDK de mentira recorta a 1000 lo que no traiga límite menor. */
            const sdk = '(' + sdkEtx.toString() + ')();';
            return route.fulfill({ status: 200, body: sdk, headers: { 'content-type': 'application/javascript' } });
        }
        if (/fonts\.(googleapis|gstatic)/.test(url.host)) return route.fulfill({ status: 200, body: '' });
        return route.abort();
    });
    await ctx.addInitScript(semilla(n));
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    await page.goto(ORIGEN + '/recetas/requisiciones.html');
    await page.waitForFunction(() => typeof _cacheInsumosReq !== 'undefined' && _cacheInsumosReq && document.getElementById('cntPend').textContent !== '0', null, { timeout: 20000 }).catch(() => {});
    return { ctx, page };
}

/* SHOTS=<carpeta>: capturas para revisarlas a ojo. */
const foto = (page, nombre) => process.env.SHOTS ? page.waitForTimeout(800).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png'), fullPage: false })) : null;
(async () => {
    const browser = await chromium.launch();
    try {
        console.log('\n══ Requisiciones · con el paquete completo ══');
        const a = await abrir(browser, nube(null));
        const p = a.page;
        await caso('el catálogo CARGA (antes: ordenado por created_at → error → sin insumos)', async () =>
            assert.ok(await p.evaluate(() => (_cacheInsumosReq || []).length) >= 1200));
        await caso('…completo y paginado: entran los 1,202 de esta sucursal aunque pasen de 1000', async () =>
            assert.equal(await p.evaluate(() => document.getElementById('cntPend').textContent), '1202'));
        await caso('…solo los de esta sucursal y sin sub-recetas', async () => {
            const ids = await p.evaluate(() => insumos.map(x => x.id));
            assert.ok(ids.indexOf('a_mezcal') > -1 && ids.indexOf('a_limon') > -1);
            assert.equal(ids.indexOf('a_ron'), -1);
            assert.equal(ids.indexOf('a_batch'), -1);
        });
        await caso('el botón de los pasos es el de inventarios: «1 Existencias ▾», sin la barra de pasos', async () => {
            assert.match(await p.evaluate(() => document.getElementById('btnPasoMenu').innerText.replace(/\s+/g, ' ')), /1 ?Existencias ▾/);
            assert.equal(await p.evaluate(() => !!document.querySelector('.req-steps') || !!document.getElementById('stepBtn1')), false);
        });
        await foto(p, 'r1-existencias');
        await p.evaluate(() => setVistaCapt('lista')); await foto(p, 'r2-lista');
        await p.evaluate(() => setVistaCapt('rapida'));
        await p.click('#btnPasoMenu'); await p.waitForTimeout(150);
        await foto(p, 'r3-menu');
        await caso('…despliega los tres pasos, con «estás aquí»', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#pasoMenuPop button')].map(b => b.textContent.replace(/\s+/g, ' ').trim())),
                ['1Existenciasestás aquí', '2Proyección', '3Pedido y envío']));
        await p.click('#pasoMenuPop button:nth-child(3)'); await p.waitForTimeout(400);
        await caso('…y lleva al paso: el botón ahora dice «3 Pedido y envío»', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('vistaPaso3').style.display), '');
            assert.match(await p.evaluate(() => document.getElementById('btnPasoMenu').innerText.replace(/\s+/g, ' ')), /3 ?Pedido y envío/);
        });
        await caso('con el paquete (Cost·ax + Fin·ax) sí se cruza la compra contra la venta', async () => {
            assert.notEqual(await p.evaluate(() => document.getElementById('kviCard').style.display), 'none');
            assert.equal(await p.evaluate(() => _cacheCortesReq.length), 1);
        });
        await a.ctx.close();

        console.log('\n══ Requisiciones · solo Cost·ax ══');
        const b = await abrir(browser, nube({ sucursales: { suc_principal: ['costax'] } }));
        const q = b.page;
        await caso('carga igual su catálogo', async () => assert.equal(await q.evaluate(() => document.getElementById('cntPend').textContent), '1202'));
        await caso('NO lee las ventas de Fin·ax (cortes)', async () => assert.equal(await q.evaluate(() => _cacheCortesReq.length), 0));
        await q.evaluate(() => irPaso(3)); await q.waitForTimeout(300);
        await caso('…ni enseña «Compra vs venta»: el pedido se arma y se manda igual', async () => {
            assert.equal(await q.evaluate(() => document.getElementById('kviCard').style.display), 'none');
            assert.notEqual(await q.evaluate(() => document.getElementById('vistaPaso3').style.display), 'none');
        });
        await b.ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log('\n' + (malos.length ? '🚨 REQUISICIONES EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '🔒 REQUISICIONES EN NAVEGADOR OK — ' + resultados.length + ' casos'));
    process.exit(malos.length ? 1 : 0);
})();
