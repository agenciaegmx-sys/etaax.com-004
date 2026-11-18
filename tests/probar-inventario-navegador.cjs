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
            /* En el Paso 5 son TRES encabezados fijos (Edwin, 18-nov): la barra de
               contexto, el de Recalcular y los reportes, y los pasos. Antes el del
               medio se iba con la página y, arriba del todo, la barra de pasos
               quedaba DEBAJO de él: desaparecía. */
            const pos = () => page.evaluate(() => {
                const caja = (s) => { const e = document.querySelector(s), b = e.getBoundingClientRect();
                    const x = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);   // al centro: a la izquierda está el menú lateral
                    return { top: b.top, bottom: b.bottom, visible: !!(x && e.contains(x)) }; };
                return { ctx: caja('#ctxBar'), hdr: caja('#vistaCaptura .inv-wizard-header'), pasos: caja('#invSteps'),
                         compacto: document.querySelector('#vistaCaptura .inv-wizard-header').classList.contains('inv-hdr-compacto') };
            });
            await page.evaluate(() => window.scrollTo(0, 60));
            await page.waitForTimeout(500);
            await caso('Paso 5 arriba: la barra de pasos se ve, no queda debajo del encabezado', async () => {
                const r = await pos();
                assert.ok(r.pasos.visible && r.hdr.visible, JSON.stringify(r));
                assert.ok(Math.abs(r.pasos.top - r.hdr.bottom) < 2, 'pasos fuera de su lugar: ' + JSON.stringify(r));
            });
            await page.evaluate(() => window.scrollTo(0, 900));
            await page.waitForTimeout(600);
            await caso('al bajar, los tres quedan fijos y en fila: contexto → encabezado → pasos, sin huecos', async () => {
                const r = await pos();
                assert.ok(r.ctx.visible && r.hdr.visible && r.pasos.visible, 'alguno quedó tapado: ' + JSON.stringify(r));
                assert.ok(Math.abs(r.hdr.top - r.ctx.bottom) < 2 && Math.abs(r.pasos.top - r.hdr.bottom) < 2, 'quedó un hueco: ' + JSON.stringify(r));
            });
            await caso('…y el encabezado se compacta a una línea para no tapar media tablet', async () => {
                const r = await pos();
                assert.ok(r.compacto && r.hdr.bottom - r.hdr.top < 60, JSON.stringify(r));
            });
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(600);
            await caso('de vuelta arriba, el encabezado vuelve a su tamaño y los pasos siguen a la vista', async () => {
                const r = await pos();
                assert.ok(!r.compacto && r.pasos.visible && Math.abs(r.pasos.top - r.hdr.bottom) < 2, JSON.stringify(r));
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
            await caso('…y el Resultado lo dice abajo de las Ventas de la Sprite: «Uso en prebatch 1 pza»', async () => {
                const t = await page.evaluate(() => document.getElementById('step5Keep').textContent.replace(/\s+/g, ' '));
                assert.match(t, /Sprite · 2 LTS[^]*?Uso en coctelería\s*—\s*Uso en prebatch\s*1 pza/);
            });
            await caso('…y el batch tiene su renglón, con lo producido', async () => {
                const t = await page.evaluate(() => document.getElementById('step5Keep').textContent.replace(/\s+/g, ' '));
                assert.match(t, /Batch Paloma[^]*?↳ \+[^]*?producido/);
            });
            /* El ⋯ del renglón de la Sprite: bateo, nota e impreso en un menú. */
            const abrirMenu = () => page.evaluate(() => {
                const nom = [...document.querySelectorAll('#step5Tablas .s5-nom')].find(n => /Sprite/.test(n.textContent));
                nom.closest('tr').nextElementSibling.querySelector('.s5-dots').click();
                const m = document.getElementById('s5Pop'); return m ? m.innerText.replace(/\s+/g, ' ').trim() : '';
            });
            const estadoSprite = () => page.evaluate(() => { const e = document.getElementById('s5est-sprite'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : 'SIN ESTADO'; });
            await caso('el ⋯ abre las tres opciones: bateo, nota e impreso', async () => {
                assert.equal(await abrirMenu(), '🏏 Marcar de bateo 📝 Agregar nota 🚫 Quitarlo del impreso');
            });
            await caso('«Quitarlo del impreso» lo marca a la vista, sin repintar toda la tabla', async () => {
                await page.evaluate(() => { document.querySelector('#step5Tablas table').__marca = 1; });
                await page.evaluate(() => [...document.querySelectorAll('#s5Pop button')].find(b => /impreso/.test(b.textContent)).click());
                assert.equal(await page.evaluate(() => !document.getElementById('s5Pop') && document.querySelector('#step5Tablas table').__marca === 1), true);
                assert.equal(await estadoSprite(), '🚫 Fuera del impreso');
            });
            await caso('la nota se escribe desde el ⋯ y se lee debajo de él', async () => {
                await abrirMenu();
                await page.evaluate(() => [...document.querySelectorAll('#s5Pop button')].find(b => /nota/.test(b.textContent)).click());
                await page.evaluate(() => { document.getElementById('notaInsInput').value = 'Una se rompió al surtir'; _guardarNotaInsumo(); });
                assert.equal(await estadoSprite(), '🚫 Fuera del impreso📝 Una se rompió al surtir');
            });
            await caso('«Marcar de bateo» lo marca, y el menú ya ofrece quitarlo', async () => {
                await abrirMenu();
                await page.evaluate(() => [...document.querySelectorAll('#s5Pop button')].find(b => /bateo/.test(b.textContent)).click());
                await page.waitForTimeout(300);
                assert.match(await estadoSprite(), /^🏏 De bateo/);
                assert.match(await abrirMenu(), /Quitar de bateo[^]*Editar la nota[^]*Volver a sacarlo en el impreso/);
            });
            await ctx.close();
        }

        /* ── E · una sub-receta con «No» no se cuela por ningún lado ─────────
           Edwin: «revisar que no se cuelen si no está marcado que aparezca en
           el inventario». Tres sub-recetas en el catálogo: una de barra con
           «Sí», una de barra con «No» y una de cocina con «Sí». En el
           inventario de BARRA solo puede estar la primera: ni en la lista, ni
           en la producción del Paso 3, ni en el Resultado. */
        console.log('\n══ E · Sub-receta con «No»: no aparece en el inventario ══');
        {
            const OCULTO = base('preOculto', { nombre: 'Jarabe Oculto', categoria: 'Producción propia', esSubReceta: true,
                recetaId: 'srOculto', ocultoInventario: true, presentaciones: [{ contNeto: 1, umContenido: 'LT' }] });
            const COCINA = base('preCocina', { nombre: 'Salsa de Cocina', familia: 'Alimentos', area: 'cocina', categoria: 'Producción propia',
                esSubReceta: true, recetaId: 'srCocina', ocultoInventario: false, presentaciones: [{ contNeto: 1, umContenido: 'KG' }] });
            const subOculto = { id: 'srOculto', nombre: 'Jarabe Oculto', tipo: 'sub-bebidas', status: 'activa', sucursalId: 'suc_principal',
                camposExtra: { rendimientoFinal: '1000', unidadRendimientoFinal: 'ML' }, ingredientes: [{ insumoId: 'sprite', cantidad: 100, unidad: 'ML' }] };
            const subCocina = { id: 'srCocina', nombre: 'Salsa de Cocina', tipo: 'sub-alimentos', status: 'activa', sucursalId: 'suc_principal',
                camposExtra: { rendimientoFinal: '1000', unidadRendimientoFinal: 'G' }, ingredientes: [] };
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV, { nube: {
                negocio_insumos: filasNube(destilados(10).concat([SPRITE, SQUIRT, BATCH, OCULTO, COCINA])),
                recetas: [SUB, subOculto, subCocina].map(r => ({ id: r.id, negocio_id: 'n1', datos: r })) } }));
            await nuevoInv(page);
            await page.waitForTimeout(800);
            const ids = () => page.evaluate(() => filasCaptura.map(f => f.insumoId));
            await caso('la de «Sí» de barra entra; la de «No» y la de cocina NO están en la lista', async () => {
                const l = await ids();
                assert.ok(l.includes('prePal'), 'falta la de «Sí»');
                assert.ok(!l.includes('preOculto'), 'se coló la de «No»');
                assert.ok(!l.includes('preCocina'), 'se coló la de cocina en el inventario de barra');
            });
            await caso('…ni se ofrecen en la producción del Paso 3', async () => {
                const p = await page.evaluate(() => prebatchesProducibles().map(x => x.id));
                assert.deepEqual(p, ['prePal']);
                await page.evaluate(() => irAPaso(3));
                await page.waitForTimeout(400);
                const t = await page.evaluate(() => document.getElementById('stepContent').textContent);
                assert.ok(!/Jarabe Oculto|Salsa de Cocina/.test(t), 'aparecen en el Paso 3');
            });
            await caso('…ni en el Resultado', async () => {
                await page.evaluate(() => irAPaso(5));
                await page.waitForTimeout(900);
                const t = await page.evaluate(() => document.getElementById('step5Keep').textContent);
                assert.ok(!/Jarabe Oculto|Salsa de Cocina/.test(t), 'aparecen en el Resultado');
            });
            await ctx.close();
        }

        /* ── F · el almacén atiende localStorage EN CHROMIUM ─────────────────
           El parche viejo definía `getItem` sobre el objeto localStorage: en
           Chromium eso crea un DATO «getItem» y el método sigue siendo el
           nativo. Staff, horarios y checklists —que se escriben por
           localStorage directo— nunca llegaban al almacén. */
        console.log('\n══ F · El almacén atiende localStorage en Chromium ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV, { nube: {} }));
            const r = await page.evaluate(() => {
                const k = 'etaax_n1_horarios';
                localStorage.setItem(k, '{"semana":"47"}');          // como lo hacen horarios.html y staff.html
                sessionStorage.setItem(k, 'de sesión');
                return { almacen: etaaxStore.get(k), lectura: localStorage.getItem(k),
                         crudo: Object.keys(localStorage).includes(k), basura: Object.keys(localStorage).includes('getItem'),
                         sesion: sessionStorage.getItem(k) };
            });
            await caso('lo que una página escribe por localStorage llega al almacén, y se lee de ahí', async () => {
                assert.equal(r.almacen, '{"semana":"47"}'); assert.equal(r.lectura, '{"semana":"47"}');
            });
            await caso('…sin copia cruda ni datos basura («getItem») en localStorage', async () => {
                assert.equal(r.crudo, false); assert.equal(r.basura, false);
            });
            await caso('…y sessionStorage no pasa por el almacén', async () => assert.equal(r.sesion, 'de sesión'));
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
