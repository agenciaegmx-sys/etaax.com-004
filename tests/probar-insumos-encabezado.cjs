/* INSUMOS · EL ENCABEZADO FIJO DEL CATÁLOGO (Edwin, 26-nov) — en un Chromium de
   verdad con insumos.html tal cual y el Supabase de mentira.
     · Buscador, filtros, vistas y acciones viven en UN encabezado fijo y bajito
       (ya no hay tarjeta de filtros ni cabecera aparte del catálogo).
     · Al bajar, el encabezado no se mueve y la cabecera de la tabla se queda
       pegada debajo de él: solo se mueve la lista.
     · «Agregar insumo» despliega Nuevo / Del catálogo ETAAX / Del catálogo del
       negocio; se cierra al elegir, al tocar fuera y con Esc.
     · «Optimizar fotos» es una cámara chica que al tocarla se abre con su
       nombre y dice para qué sirve.
     · Los permisos esconden cada opción; sin ninguna, se va el botón entero.
     · En tablet (1280) cabe en dos renglones; en el teléfono no se sale.

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-insumos-encabezado.cjs
   SHOTS=<carpeta> guarda capturas. */
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
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n').filter(Boolean).slice(0, 6).join(' ')); }
}
const FAM = [['Alimentos', 'Pescado', 'carne', 'almacen_cocina'], ['Bebidas', 'Destilados', 'destilado', 'barra'], ['Abarrotes', 'Granos', 'abarrote', 'almacen_general']];
const insumos = [];
for (let i = 0; i < 40; i++) {
    const f = FAM[i % 3];
    insumos.push({ negocio_id: 'n1', insumo_id: 'i' + i, datos: { id: 'i' + i, activo: '1', sucursales: ['suc_principal'], nombre: 'Insumo ' + String(i).padStart(2, '0'),
        tipoInsumo: f[2], familia: f[0], categoria: f[1], area: f[3],
        presentaciones: [{ presentacionCompra: 'Pieza', contNeto: '1000', umContenido: 'G', precio: String(20 + i) }] } });
}
const NUBE = {
    __auth: [{ id: 'u1', email: 'duena@etaax.prueba', password: 'x', meta: { nombre: 'Dueña' } }],
    negocios: [{ id: 'n1', usuario_id: 'u1', datos: { nombre: 'GRUPO JP' } }],
    negocio_sucursales: [{ negocio_id: 'n1', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz', activa: true }] } }],
    suscripciones: [{ negocio_id: 'n1', estado: 'activa', plan: null }],
    inv_ajustes: [{ negocio_id: 'n1', datos: { compuestos: {}, bateo: {} } }],
    negocio_insumos: insumos, recetas: [], permisos: []
};
function semilla(n, tema) {
    return `(() => {
        window.__avisos = []; window.alert = (m) => __avisos.push(String(m)); window.confirm = (m) => { __avisos.push('¿' + m); return false; };
        if (!localStorage.getItem('__sembrado')) {
            localStorage.clear();
            localStorage.setItem('__nube', ${JSON.stringify(JSON.stringify(n))});
            localStorage.setItem('etaax_negocio_activo', 'n1');
            localStorage.setItem('etaax_sucursal_activa', 'suc_principal');
            localStorage.setItem('etaax_ctx', JSON.stringify({ ctxType: 'owner', negId: 'n1', negNombre: 'GRUPO JP', sucId: 'suc_principal', sucNombre: 'Matriz', userName: 'Dueña' }));
            localStorage.setItem('etaax_negocios', JSON.stringify([{ id: 'n1', usuarioId: 'u1', nombre: 'GRUPO JP' }]));
            localStorage.setItem('etaax_n1_sucursales', JSON.stringify([{ id: 'suc_principal', nombre: 'Matriz' }]));
            localStorage.setItem('etaax_novedades_vista', '{}');
            ${tema ? `localStorage.setItem('etaax_theme', '${tema}');` : ''}
            localStorage.setItem('__sembrado', '1');
        }
        if (!sessionStorage.getItem('__ses')) sessionStorage.setItem('__ses', JSON.stringify({ id: 'u1', email: 'duena@etaax.prueba' }));
    })();`;
}
async function abrir(browser, viewport, tema) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 800 } });
    await ctx.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === ORIGEN) {
            const p = path.join(RAIZ, decodeURIComponent(url.pathname));
            if (p.startsWith(RAIZ) && fs.existsSync(p) && fs.statSync(p).isFile())
                return route.fulfill({ status: 200, body: fs.readFileSync(p), headers: { 'content-type': TIPOS[path.extname(p)] || 'application/octet-stream' } });
            return route.fulfill({ status: 404, body: '' });
        }
        if (/supabase-js/.test(url.href)) return route.fulfill({ status: 200, body: '(' + sdkEtx.toString() + ')();', headers: { 'content-type': 'application/javascript' } });
        if (/fonts\.(googleapis|gstatic)/.test(url.host)) return route.fulfill({ status: 200, body: '' });
        return route.abort();
    });
    await ctx.addInitScript(semilla(NUBE, tema));
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    await page.goto(ORIGEN + '/recetas/insumos.html');
    await page.waitForFunction(() => typeof getInsumos === 'function' && getInsumos().length >= 40 && document.querySelector('#tbodyInsumos tr'), null, { timeout: 30000 });
    await page.waitForTimeout(700);
    return { ctx, page };
}
const foto = (page, nombre) => process.env.SHOTS ? page.waitForTimeout(400).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png'), fullPage: false })) : null;
const caja = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom), r: Math.round(b.right) }; }, s);
const visible = (p, s) => p.evaluate((s) => { const e = document.querySelector(s); return !!(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); }, s);
const sinDesborde = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

(async () => {
    const browser = await chromium.launch();
    try {
        const { page: p } = await abrir(browser);
        console.log('\n══ Insumos · todo en un encabezado ══');
        await foto(p, 'e1-tablet');
        await caso('buscador, filtros, vistas y acciones están DENTRO del encabezado', async () => {
            const r = await p.evaluate(() => ['searchInput', 'filtroFamilia__btn', 'filtroCategoria__btn', 'filtroEstadoIns', 'filtroAreaIns', 'btnAreasIns',
                'btnVistaLista', 'btnVistaGrid', 'btnVistaCosteo', 'btnModoSeleccion', 'ordenModoIns', 'btnModoOrden', 'btnImprimirIns', 'countLabel',
                'btnOptFotosNeg', 'btnNovedadesIns', 'btnAgregarMenu'].filter(id => { const e = document.getElementById(id); return !e || !e.closest('#insCab'); }));
            assert.deepEqual(r, []);
        });
        await caso('…ya no hay tarjeta de filtros ni cabecera aparte del catálogo', async () =>
            assert.deepEqual(await p.evaluate(() => [document.querySelectorAll('.filtros-grid').length, document.querySelectorAll('#insumosCatalogCard > .card-header').length]), [0, 0]));
        await caso('«Insumos ETAAX» e «Insumos GRUPO JP» ya no son botones sueltos: viven en el menú de Agregar', async () => {
            assert.equal(await visible(p, '#btnCatalogoEtaax'), false);
            assert.equal(await visible(p, '#btnInsumosNegGlobal'), false);
            assert.equal(await p.evaluate(() => !!document.getElementById('btnCatalogoEtaax').closest('#insAgregarPop')), true);
        });
        await caso('en tablet (1280) cabe en DOS renglones y es bajito (≤ 115 px)', async () => {
            const c = await caja(p, '#insCab'), f = await caja(p, '#insCab .i-cab-filtros'), v = await caja(p, '#insCab .i-cab-vistas'), a = await caja(p, '#insCab .hdr-acts');
            assert.ok(c.h <= 115, 'mide ' + c.h);
            assert.ok(f.h <= 36, 'los filtros se partieron: ' + f.h);
            assert.ok(Math.abs(a.y - v.y) <= 4, 'las acciones bajaron a un tercer renglón (' + a.y + ' vs ' + v.y + ')');
            assert.ok(a.r <= c.r, 'las acciones se salen');
        });
        await caso('…y nada se sale de la página', async () => assert.equal(await sinDesborde(p), true));

        console.log('\n══ Insumos · fijo al bajar ══');
        const antes = await caja(p, '#insCab');
        await p.evaluate(() => window.scrollTo(0, 900)); await p.waitForTimeout(350);
        await foto(p, 'e2-abajo');
        await caso('al bajar, el encabezado se queda en su sitio', async () => {
            const d = await caja(p, '#insCab');
            assert.equal(await p.evaluate(() => scrollY > 500), true, 'la página no bajó');
            assert.ok(Math.abs(d.y - antes.y) <= 1, 'se movió: ' + antes.y + ' → ' + d.y);
        });
        await caso('…y la cabecera de la tabla se pega justo debajo de él (solo se mueve la lista)', async () => {
            const c = await caja(p, '#insCab'), th = await caja(p, '#contenedorLista thead th:nth-child(2)');
            assert.ok(Math.abs(th.y - c.b) <= 2, 'cabecera en ' + th.y + ', encabezado termina en ' + c.b);
        });
        await caso('…y las filas pasan POR DEBAJO del encabezado, no encima', async () => {
            const z = await p.evaluate(() => { const c = document.getElementById('insCab').getBoundingClientRect(); const e = document.elementFromPoint(c.left + 20, c.top + c.height / 2); return !!e.closest('#insCab'); });
            assert.equal(z, true);
        });
        await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(250);

        console.log('\n══ Insumos · «Agregar insumo ▾» ══');
        await p.click('#btnAgregarMenu');
        await foto(p, 'e3-agregar');
        await caso('despliega las tres formas de agregar', async () => {
            assert.equal(await p.getAttribute('#btnAgregarMenu', 'aria-expanded'), 'true');
            const t = await p.locator('#insAgregarPop .i-menu-it b').allTextContents();
            assert.deepEqual(t.map(x => x.trim()), ['Nuevo insumo', 'Del catálogo ETAAX', 'Del catálogo de GRUPO JP']);
        });
        await caso('…la ventanita cabe en la pantalla y queda encima de la lista', async () => {
            const m = await caja(p, '#insAgregarPop');
            assert.ok(m.r <= 1280 && m.x >= 0, 'se sale: ' + JSON.stringify(m));
            const encima = await p.evaluate(() => { const b = document.querySelector('#insAgregarPop .i-menu-it:last-child').getBoundingClientRect(); const e = document.elementFromPoint(b.left + 30, b.top + b.height / 2); return !!e.closest('#insAgregarPop'); });
            assert.equal(encima, true);
        });
        await p.evaluate(() => { window.__llamo = []; window.abrirCatalogoGlobal = () => __llamo.push('etaax'); window.abrirInsumosGlobalNeg = () => __llamo.push('negocio'); window.abrirSelectorCategoria = () => __llamo.push('nuevo'); });
        await p.click('#btnCatalogoEtaax');
        await caso('elegir «Del catálogo ETAAX» abre el catálogo y cierra el menú', async () => {
            assert.deepEqual(await p.evaluate(() => __llamo), ['etaax']);
            assert.equal(await visible(p, '#insAgregarPop'), false);
            assert.equal(await p.getAttribute('#btnAgregarMenu', 'aria-expanded'), 'false');
        });
        await p.click('#btnAgregarMenu'); await p.click('#btnInsumosNegGlobal');
        await p.click('#btnAgregarMenu'); await p.click('#btnAgregarInsumo');
        await caso('…«Del catálogo de GRUPO JP» y «Nuevo insumo» abren lo suyo', async () =>
            assert.deepEqual(await p.evaluate(() => __llamo), ['etaax', 'negocio', 'nuevo']));
        await p.click('#btnAgregarMenu'); await p.mouse.click(640, 600); await p.waitForTimeout(100);
        await caso('se cierra al tocar fuera', async () => assert.equal(await visible(p, '#insAgregarPop'), false));
        await p.click('#btnAgregarMenu'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
        await caso('…y con Esc, regresando el foco al botón', async () => {
            assert.equal(await visible(p, '#insAgregarPop'), false);
            assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), 'btnAgregarMenu');
        });

        console.log('\n══ Insumos · la cámara de «Optimizar fotos» ══');
        await caso('es un botón chico, solo la cámara (con su nombre para lectores de pantalla)', async () => {
            const b = await caja(p, '#btnOptFotosNeg');
            assert.ok(b.w <= 36, 'mide ' + b.w);
            assert.equal(await p.evaluate(() => !!document.querySelector('#btnOptFotosNeg .i-ui-icon svg')), true, 'sin ícono');
            assert.equal((await p.locator('#btnOptFotosNeg').textContent()).trim(), 'Optimizar fotos');
        });
        const cabAntes = await caja(p, '#insCab');
        await p.click('#btnOptFotosNeg');
        await foto(p, 'e4-camara');
        await caso('al tocarla se abre con su nombre y dice para qué sirve', async () => {
            assert.equal(await p.getAttribute('#btnOptFotosNeg', 'aria-expanded'), 'true');
            assert.equal((await p.locator('#insOptFotosPop .i-pop-tit').textContent()).trim(), 'Optimizar fotos');
            const t = await p.locator('#insOptFotosPop .i-pop-txt').textContent();
            assert.ok(/fotos/.test(t) && /más rápido/.test(t), t);
        });
        await caso('…sin mover el encabezado (las acciones no se van a otro renglón)', async () =>
            assert.deepEqual(await caja(p, '#insCab'), cabAntes));
        await caso('…abrir una ventanita cierra la otra', async () => {
            await p.click('#btnAgregarMenu');
            assert.deepEqual([await visible(p, '#insOptFotosPop'), await visible(p, '#insAgregarPop')], [false, true]);
            assert.equal(await p.getAttribute('#btnOptFotosNeg', 'aria-expanded'), 'false');
            await p.click('#btnOptFotosNeg');
        });
        await p.evaluate(() => { window.__opt = 0; window.migrarFotosNegocio = () => { __opt++; }; });
        await p.click('#btnOptFotosIr');
        await caso('«Optimizar ahora» corre la optimización y cierra la ventanita', async () => {
            assert.equal(await p.evaluate(() => __opt), 1);
            assert.equal(await visible(p, '#insOptFotosPop'), false);
        });

        await caso('Seleccionar, Ordenar e Imprimir con el mismo borde fino que los demás (no el del navegador)', async () =>
            assert.deepEqual(await p.evaluate(() => ['btnModoSeleccion', 'btnModoOrden', 'btnImprimirIns'].map(id => getComputedStyle(document.getElementById(id)).borderBottomStyle + ' ' + getComputedStyle(document.getElementById(id)).borderBottomWidth)),
                ['solid 1px', 'solid 1px', 'solid 1px']));

        console.log('\n══ Insumos · las vistas siguen funcionando ══');
        await p.click('#btnVistaGrid'); await p.waitForTimeout(300);
        await caso('Galería se marca y enseña la cuadrícula', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('btnVistaGrid').classList.contains('i-selected')), true);
            assert.equal(await visible(p, '#contenedorGrid'), true);
            assert.equal(await visible(p, '#contenedorLista'), false);
        });
        await p.click('#btnVistaLista'); await p.waitForTimeout(300);
        await p.fill('#searchInput', 'Insumo 07'); await p.waitForTimeout(400);
        await caso('el buscador filtra la lista y el contador lo dice', async () => {
            assert.deepEqual(await p.evaluate(() => _listaFiltrada.map(x => x.id)), ['i7']);
            assert.match(await p.locator('#countLabel').textContent(), /^1 /);
        });

        console.log('\n══ Insumos · permisos ══');
        await caso('sin ninguna de las tres formas de agregar, se va el botón entero', async () => {
            const r = await p.evaluate(() => {
                const ids = ['btnAgregarInsumo', 'btnCatalogoEtaax', 'btnInsumosNegGlobal'];
                ids.slice(0, 2).forEach(_insOcultar); _insAgregarSync(); const conUna = getComputedStyle(document.getElementById('insAgregarWrap')).display !== 'none';
                _insOcultar(ids[2]); _insAgregarSync(); const sinNinguna = getComputedStyle(document.getElementById('insAgregarWrap')).display === 'none';
                return [conUna, sinNinguna];
            });
            assert.deepEqual(r, [true, true]);
        });
        await p.context().close();

        console.log('\n══ Insumos · tema claro, pantalla grande y teléfono ══');
        const { page: c } = await abrir(browser, { width: 1280, height: 800 }, 'light');
        await c.click('#btnAgregarMenu');
        await foto(c, 'e5-claro');
        await caso('en tema claro el encabezado tiene fondo propio (no se transparenta la lista)', async () => {
            const bg = await c.evaluate(() => getComputedStyle(document.getElementById('insCab')).backgroundColor);
            assert.ok(bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg), bg);
        });
        await c.context().close();
        const { page: g } = await abrir(browser, { width: 1920, height: 1000 });
        await foto(g, 'e6-grande');
        await caso('en pantalla grande las acciones suben al renglón del buscador', async () => {
            const f = await caja(g, '#insCab .i-cab-filtros'), a = await caja(g, '#insCab .hdr-acts');
            assert.ok(Math.abs(a.y - f.y) <= 4, 'acciones en ' + a.y + ', filtros en ' + f.y);
            assert.ok((await caja(g, '#insCab')).h <= 115);
        });
        await g.context().close();
        const { page: t } = await abrir(browser, { width: 390, height: 844 });
        await foto(t, 'e7-telefono');
        await caso('en el teléfono nada se sale de la pantalla (ni por la izquierda)', async () => {
            assert.equal(await sinDesborde(t), true);
            const fuera = await t.evaluate(() => [...document.querySelectorAll('#insCab button, #insCab select, #insCab input')].filter(e => e.getClientRects().length && !e.closest('.i-pop'))
                .filter(e => { const b = e.getBoundingClientRect(); return b.left < 0 || b.right > innerWidth; }).map(e => e.id || e.className));
            assert.deepEqual(fuera, []);
        });
        await t.click('#btnOptFotosNeg');
        await caso('…la ventanita de la cámara cabe', async () => { const m = await caja(t, '#insOptFotosPop'); assert.ok(m.x >= 0 && m.r <= 390, JSON.stringify(m)); });
        await t.keyboard.press('Escape');
        await t.click('#btnAgregarMenu');
        await caso('…y el menú de agregar cabe', async () => { const m = await caja(t, '#insAgregarPop'); assert.ok(m.x >= 0 && m.r <= 390, JSON.stringify(m)); });
        await foto(t, 'e8-telefono-menu');
        await t.context().close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log(malos.length ? '\n🚨 ENCABEZADO DE INSUMOS: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '\n🔒 ENCABEZADO DE INSUMOS OK — ' + resultados.length + ' casos');
    process.exit(malos.length ? 1 : 0);
})();
