/* El INVENTARIO en un navegador de verdad (Chromium) — recetas/inventarios.html.

   Lo que vigila son cosas que el candado de Node no puede ver:
     · el ANCHO: en una tablet, el encabezado del Paso 5 se salía por la derecha
       (a 1280 px la página medía 1542), el navegador alejaba la página entera
       y el Resultado quedaba en el 83 % de la pantalla;
     · lo PEGAJOSO: el encabezado se pegaba debajo de la barra de contexto;
     · el CATÁLOGO: la página lo cargaba una sola vez. Un inventario nuevo salía
       con insumos de menos («190 de 230») y una sub-receta creada en otra
       pestaña no tenía receta: su batch no descontaba a sus ingredientes;
     · RECALCULAR: releía la copia local y armaba dos veces, con dos catálogos;
     · y que en Chromium `localStorage.getItem` NO está parchado: el inventario
       tiene que leer su copia por el almacén (etaax-store), no por ahí.

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-inventario-navegador.cjs */
'use strict';
const assert = require('node:assert/strict');
const { chromium, abrir, pestana } = require('./navegador-comun.cjs');

const RELOJ = '2026-11-18T12:00:00-06:00';
const resultados = [];
async function caso(nombre, fn) {
    try { await fn(); resultados.push([nombre, true]); console.log('  ✅ ' + nombre); }
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n')[0]); }
}

/* ── datos ───────────────────────────────────────────────────────────── */
const base = (id, x) => Object.assign({ id, familia: 'Bebidas', area: 'barra', activo: '1',
    sucursalId: 'suc_principal', sucursales: ['suc_principal'] }, x);
const destilados = (n) => Array.from({ length: n }, (_, i) => base('d' + String(i).padStart(3, '0'), {
    nombre: 'Destilado ' + i, tipoInsumo: 'destilado', categoria: 'Destilados',
    presentaciones: [{ contNeto: 750, umContenido: 'ML', costoUnitario: 300, precioCarta: 80 }] }));
const SPRITE = base('sprite', { nombre: 'Sprite', variedad: '2 LTS', tipoInsumo: 'refresco', categoria: 'Refrescos',
    presentaciones: [{ contNeto: 2, umContenido: 'LT', costoPieza: 38, precioCarta: 60 }] });
const SQUIRT = base('squirt', { nombre: 'Squirt', variedad: '2 LTS', tipoInsumo: 'refresco', categoria: 'Refrescos',
    presentaciones: [{ contNeto: 2, umContenido: 'LT', costoPieza: 36, precioCarta: 60 }] });
const BATCH = base('prePal', { nombre: 'Batch Paloma', categoria: 'Producción propia', esSubReceta: true, recetaId: 'srPal',
    ocultoInventario: false, presentaciones: [{ contNeto: 2, umContenido: 'LT' }] });
const SUB = { id: 'srPal', nombre: 'Batch Paloma', tipo: 'sub-bebidas', status: 'activa', sucursalId: 'suc_principal',
    camposExtra: { rendimientoFinal: '2000', unidadRendimientoFinal: 'ML' },
    ingredientes: [{ insumoId: 'sprite', cantidad: 500, unidad: 'ML' }, { insumoId: 'squirt', cantidad: 500, unidad: 'ML' }] };
const filasNube = (lista) => lista.map(x => ({ id: x.id, negocio_id: 'n1', datos: x }));
const INV = { ruta: '/recetas/inventarios.html', listo: () => window._INV_CARGADO === true };

/* ── pasos ───────────────────────────────────────────────────────────── */
const nuevoInv = (page) => page.evaluate(() => {
    nuevoInventario();
    document.getElementById('invTipoInv').value = 'bebidas';
    document.getElementById('invArea').value = 'barra';
    iniciarInventario();
});
const nFilas = (page) => page.evaluate(() => filasCaptura.length);
const desborde = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

(async () => {
    const browser = await chromium.launch();
    try {
        /* ── A · el ancho del Resultado en una tablet ─────────────────────── */
        console.log('\n══ A · El Resultado ocupa la pantalla (tablet) ══');
        for (const [w, h, dpr] of [[1280, 800, 1.5], [1440, 900, 1.3333], [1920, 1200, 1]]) {
            for (const cerrada of [false, true]) {
                const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV,
                    { nube: { negocio_insumos: filasNube(destilados(40)) }, viewport: { width: w, height: h }, dpr }));
                if (cerrada) await page.evaluate(() => toggleNav());
                await nuevoInv(page);
                await page.evaluate(() => irAPaso(5));
                await page.waitForTimeout(900);
                await caso(w + '×' + h + ' @' + dpr + (cerrada ? ', barra lateral cerrada' : '') + ': nada se sale por la derecha', async () => {
                    assert.equal(await desborde(page), 0, 'la página es más ancha que la pantalla');
                });
                await ctx.close();
            }
        }

        /* ── B · lo pegajoso no queda debajo de la barra de contexto ──────── */
        console.log('\n══ B · La barra de pasos se ve al bajar ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV,
                { nube: { negocio_insumos: filasNube(destilados(60)) }, viewport: { width: 1280, height: 800 } }));
            await nuevoInv(page);
            await page.evaluate(() => irAPaso(5));
            await page.waitForTimeout(900);
            await page.evaluate(() => window.scrollTo(0, 900));
            await page.waitForTimeout(400);
            await caso('al bajar, la barra de pasos queda justo debajo de la barra de contexto, sin taparse', async () => {
                const r = await page.evaluate(() => ({ ctx: document.getElementById('ctxBar').getBoundingClientRect().bottom,
                                                       pasos: document.getElementById('invSteps').getBoundingClientRect().top }));
                assert.ok(r.pasos >= r.ctx - 1, 'la barra de pasos queda tapada: ' + JSON.stringify(r));
                assert.ok(r.pasos - r.ctx < 4, 'quedó un hueco: ' + JSON.stringify(r));
            });
            await ctx.close();
        }

        /* ── C · copia vieja en el dispositivo y red lenta ────────────────── */
        console.log('\n══ C · El catálogo de la copia vieja se completa solo ══');
        {
            const cat = destilados(230);
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV, { nube: { negocio_insumos: filasNube(cat) } }));
            // Este dispositivo se quedó con la copia de hace días (190) y hoy la red va lenta.
            await page.evaluate((viejo) => { etaaxStore.set('etaax_n1_insumos', JSON.stringify(viejo)); localStorage.setItem('__demora', '2500'); }, cat.slice(0, 190));
            await page.waitForFunction(() => etaaxStore.pendientes() === 0, null, { polling: 100 });
            await page.reload();
            await page.waitForFunction(() => typeof nuevoInventario === 'function' && window.etaaxStore && etaaxStore.hidratado(), null, { polling: 50 });
            await caso('sin nube todavía, el inventario usa la copia del dispositivo (por el almacén, no por localStorage)', async () => {
                assert.equal(await page.evaluate(() => getInsumos().length), 190);
            });
            await nuevoInv(page);
            await caso('…y lo dice: «Actualizando el catálogo desde la nube»', async () => {
                assert.match(await page.evaluate(() => document.getElementById('stepContent').textContent), /Actualizando el catálogo/);
            });
            await caso('al llegar la nube, el inventario nuevo se completa SOLO (190 → 230), sin navegar', async () => {
                await page.waitForFunction(() => filasCaptura.length === 230, null, { polling: 100, timeout: 15000 });
                await page.waitForTimeout(200);
                assert.doesNotMatch(await page.evaluate(() => document.getElementById('stepContent').textContent), /Actualizando el catálogo/,
                    'el aviso se quedó aunque ya llegó la nube');
            });
            await page.evaluate(() => irAPaso(5));
            await page.waitForTimeout(600);
            await page.evaluate(() => recalcularResultado());
            await page.waitForTimeout(300);
            await caso('Recalcular con red lenta no regresa a la copia vieja mientras viaja la nube', async () => {
                assert.equal(await nFilas(page), 230);
                assert.match(await page.evaluate(() => document.getElementById('btnRecalc5').textContent), /Recalculando/);
            });
            await caso('…y termina con UN rearmado: 230, y el botón vuelve', async () => {
                await page.waitForFunction(() => !/Recalculando/.test(document.getElementById('btnRecalc5').textContent), null, { polling: 100, timeout: 15000 });
                assert.equal(await nFilas(page), 230);
            });
            await ctx.close();
        }

        /* ── D · la sub-receta se crea en otra pestaña DESPUÉS de abrir ────── */
        console.log('\n══ D · Sub-receta creada en otra pestaña ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV,
                { nube: { negocio_insumos: filasNube(destilados(20).concat([SPRITE, SQUIRT])), recetas: [] } }));
            // Otra pestaña da de alta la sub-receta como prebatch y su insumo.
            const otra = await pestana(ctx, INV);
            await otra.evaluate(({ BATCH, SUB }) => {
                const db = __nube.leer();
                db.negocio_insumos.push({ id: BATCH.id, negocio_id: 'n1', datos: BATCH });
                db.recetas = [{ id: SUB.id, negocio_id: 'n1', datos: SUB }];
                __nube.escribir(db);
            }, { BATCH, SUB });
            await otra.close();
            await page.bringToFront();
            await nuevoInv(page);
            await caso('el inventario nuevo trae el batch Y conoce su receta', async () => {
                await page.waitForFunction(() => filasCaptura.some(f => f.insumoId === 'prePal') && getRecetas().some(r => r.id === 'srPal'),
                    null, { polling: 100, timeout: 8000 });
            });
            // Paso 3: 4 batches, con el control de verdad.
            await page.evaluate(() => { irAPaso(3); });
            await page.waitForTimeout(300);
            await page.evaluate(() => setProduccionPrebatch('prePal', 4));
            await caso('4 batches capturados en el Paso 3 descuentan 1 Sprite (500 ml × 4 ÷ 2 L)', async () => {
                const v = await page.evaluate(() => _consumoBaseProd(filasCaptura.find(f => f.insumoId === 'sprite')));
                assert.equal(Math.round(v * 1000) / 1000, 1);
            });
            await page.evaluate(() => irAPaso(5));
            await page.waitForTimeout(900);
            await caso('…y el Resultado lo dice en el renglón de la Sprite: «Uso en prebatch 1 pza»', async () => {
                const t = await page.evaluate(() => document.getElementById('step5Keep').textContent.replace(/\s+/g, ' '));
                assert.match(t, /Sprite · 2 LTS[^]*?Uso en prebatch\s*1 pza se fue en producir batches/);
            });
            await caso('…y el batch tiene su renglón, con lo producido', async () => {
                const t = await page.evaluate(() => document.getElementById('step5Keep').textContent.replace(/\s+/g, ' '));
                assert.match(t, /Batch Paloma[^]*?Producido\s*\+/);
            });
            await ctx.close();
        }
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]).length;
    console.log('\n' + (malos ? '🚨 ' + malos + ' de ' + resultados.length + ' casos fallaron'
                              : '🔒 INVENTARIO EN NAVEGADOR OK — ' + resultados.length + ' casos'));
    process.exit(malos ? 1 : 0);
})();
