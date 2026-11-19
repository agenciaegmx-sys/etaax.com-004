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

        /* ── B · un solo encabezado fijo, con los pasos en un botón ──────────
           Edwin (18-nov): la barra de pasos se escondía detrás del encabezado o
           dejaba un hueco enorme, y el encabezado se compactaba al bajar. Ahora
           no hay barra de pasos: un botón «③ Ventas ▾» del encabezado despliega
           los cinco, y el encabezado queda FIJO en todos los pasos, sin
           animaciones. */
        console.log('\n══ B · Encabezado fijo y los pasos en un botón ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV,
                { nube: { negocio_insumos: filasNube(destilados(60)) }, viewport: { width: 1280, height: 800 } }));
            await nuevoInv(page);
            const pos = () => page.evaluate(() => {
                const caja = (s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect();
                    const x = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(b.height / 2, 20));   // al centro: a la izquierda está el menú lateral
                    return { top: Math.round(b.top), bottom: Math.round(b.bottom), visible: !!(x && e.contains(x)) }; };
                const h = document.querySelector('#vistaCaptura .inv-wizard-header');
                return { ctx: caja('#ctxBar'), hdr: caja('#vistaCaptura .inv-wizard-header'), pasos: caja('#invSteps'),
                         compacto: h.classList.contains('inv-hdr-compacto'), boton: document.getElementById('btnPasoMenu').textContent.replace(/\s+/g, '') };
            });
            await caso('ya no hay barra de pasos', async () => assert.equal((await pos()).pasos, null));
            for (const paso of [1, 3, 5]) {
                await page.evaluate(p => irAPaso(p), paso);
                await page.waitForTimeout(paso === 5 ? 1200 : 500);
                await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
                const arriba = await pos();
                await page.evaluate(() => window.scrollTo(0, 2000)); await page.waitForTimeout(250);
                const abajo = await pos();
                await caso('Paso ' + paso + ': el botón dice el paso, y el encabezado se ve arriba y al bajar, sin cambiar de alto', async () => {
                    assert.equal(arriba.boton, paso + ['', 'Existencias', 'Entradas', 'Ventas', 'Cancelaciones', 'Resultado'][paso] + '▾');
                    assert.ok(arriba.hdr.visible && abajo.hdr.visible, 'tapado: ' + JSON.stringify({ arriba, abajo }));
                    assert.equal(abajo.hdr.bottom - abajo.hdr.top, arriba.hdr.bottom - arriba.hdr.top, 'cambió de alto al bajar');
                    assert.ok(!abajo.compacto, 'se compactó');
                    assert.ok(Math.abs(abajo.hdr.top - abajo.ctx.bottom) < 2, 'no quedó pegado bajo la barra de contexto: ' + JSON.stringify(abajo));
                    /* Sin corrimiento (19-nov): arriba del todo ya está en su lugar
                       fijo; antes arrancaba 24 px abajo y se recorría al bajar. */
                    assert.equal(arriba.hdr.top, abajo.hdr.top, 'se corre al bajar: ' + arriba.hdr.top + ' → ' + abajo.hdr.top);
                });
            }
            /* Título y botones en dos renglones como mucho, más la barra del paso
               (buscador y filtros fijos, 19-nov): tres renglones. */
            await caso('…y no se come la pantalla: tres renglones como mucho (≤ 180 px) con la barra del paso', async () => {
                const r = await pos(); assert.ok(r.hdr.bottom - r.hdr.top <= 180, JSON.stringify(r));
            });
            await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
            await caso('el botón despliega los cinco pasos y marca dónde estás', async () => {
                await page.click('#btnPasoMenu'); await page.waitForTimeout(200);
                assert.equal(await page.evaluate(() => document.getElementById('pasoMenuPop').innerText.replace(/\s+/g, ' ').trim()),
                    '✓ Existencias ✓ Entradas ✓ Ventas ✓ Cancelaciones 5 Resultado estás aquí');
            });
            await caso('…elegir uno te lleva y cierra el menú', async () => {
                await page.evaluate(() => [...document.querySelectorAll('#pasoMenuPop button')][1].click()); await page.waitForTimeout(400);
                assert.deepEqual(await page.evaluate(() => [pasoActual, document.getElementById('pasoMenuPop').hidden]), [2, true]);
            });
            await caso('…y tocar fuera lo cierra sin moverte', async () => {
                await page.click('#btnPasoMenu'); await page.waitForTimeout(150);
                await page.mouse.click(700, 700); await page.waitForTimeout(150);
                assert.deepEqual(await page.evaluate(() => [pasoActual, document.getElementById('pasoMenuPop').hidden]), [2, true]);
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
                await page.evaluate(() => { irAPaso(3); setVistaVentas('prebatch'); });
                await page.waitForTimeout(400);
                /* En la lista de producción solo la de «Sí». La de «No» se menciona
                   plegada («marcados con No»), por si se quiere cambiar; la de
                   cocina, ni eso: este inventario es de barra. */
                const r = await page.evaluate(() => ({
                    lista: [...document.querySelectorAll('#stepContent .step3-lista .s3-nom')].map(e => e.textContent),
                    plegada: (document.querySelector('#stepContent details.s3-no') || {}).textContent || '',
                    abierta: document.querySelector('#stepContent details.s3-no') ? document.querySelector('#stepContent details.s3-no').open : false,
                    todo: document.getElementById('stepContent').textContent }));
                assert.deepEqual(r.lista, ['Batch Paloma']);
                assert.ok(/Jarabe Oculto/.test(r.plegada) && !r.abierta, 'la de «No» debe ir plegada');
                assert.ok(!/Salsa de Cocina/.test(r.todo), 'aparece la de cocina en el Paso 3 de barra');
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

        /* ── G · producción propia sin rastrear: pasarla con un toque ────────
           La tablet de Edwin: «8 producciones propias sin rastrear». Sus
           insumos de producción propia se habían BORRADO (limpieza de
           duplicados de la sub-receta) y el inventario seguía apuntando a los
           borrados: sus batches no descontaban nada. Aquí el inventario trae un
           renglón contado de un insumo que ya no existe, con 4 batches, y el
           catálogo trae el vigente de la misma sub-receta. */
        console.log('\n══ G · Producción propia sin rastrear: «Pasarlo a» ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV,
                { nube: { negocio_insumos: filasNube([SPRITE, SQUIRT, BATCH]), recetas: [{ id: SUB.id, negocio_id: 'n1', datos: SUB }] } }));
            await nuevoInv(page);
            await page.waitForFunction(() => filasCaptura.some(f => f.insumoId === 'prePal'), null, { polling: 100, timeout: 8000 });
            page.on('dialog', d => d.accept());
            await page.evaluate(() => {
                const muerto = { insumoId: 'prod_borrado1', nombre: 'Batch Paloma', tipo: 'copa', contNeto: 2000, copaML: 250,
                    existenciaAnterior: 0, entradas: [], pesos: [], cerradasBodega: 0, cerradasBarra: 2, registrado: true };
                invActual.filas = filasCaptura.map(f => Object.assign({}, f)).concat([muerto]);
                invActual.prebatchProducidos = { prod_borrado1: 4 };
                cargarProductosCaptura();
                _consumoDirty = true; window._step5Dirty = true; window._step5Force = true;
                irAPaso(5);
            });
            await page.waitForTimeout(1200);
            const texto = () => page.evaluate(() => document.getElementById('step5Keep').textContent.replace(/\s+/g, ' '));
            await caso('el aviso dice que su insumo ya no está, y el bloque de batches dice el NOMBRE', async () => {
                const t = await texto();
                assert.match(t, /1 producción propia sin rastrear/);
                assert.match(t, /Batch Paloma — su insumo ya no está en el catálogo/);
                assert.ok(!/prod_borrado1/.test(t), 'enseña el id del insumo borrado');
            });
            await caso('…y sus 4 batches todavía no descuentan Sprite', async () =>
                assert.equal(await page.evaluate(() => _consumoBaseProd(filasCaptura.find(f => f.insumoId === 'sprite'))), 0));
            await caso('el botón «Pasarlo a «Batch Paloma»» lo arregla desde ahí', async () => {
                await page.evaluate(() => [...document.querySelectorAll('#step5Keep button')].find(b => /Pasarlo a/.test(b.textContent)).click());
                await page.waitForTimeout(1200);
                const r = await page.evaluate(() => ({
                    viejo: filasCaptura.some(f => f.insumoId === 'prod_borrado1'),
                    nuevo: (filasCaptura.find(f => f.insumoId === 'prePal') || {}).cerradasBarra,
                    prod: JSON.stringify(invActual.prebatchProducidos) }));
                assert.deepEqual(r, { viejo: false, nuevo: 2, prod: '{"prePal":4}' });
            });
            await caso('…y AHORA sí descuentan: 4 batches × 500 ml = 1 Sprite', async () =>
                assert.equal(Math.round(await page.evaluate(() => _consumoBaseProd(filasCaptura.find(f => f.insumoId === 'sprite'))) * 1000) / 1000, 1));
            await caso('…y el aviso desaparece', async () => assert.ok(!/sin rastrear/.test(await texto())));
            await ctx.close();
        }

        /* ── H · el Paso 3 en cuatro vistas y 3 Mix Negroni ──────────────────
           Edwin: «hice 3 mix negroni: que se descuente de cada insumo que lleva
           y que aparezca en su fila». Y el Paso 3 en LISTA: insumos (primero),
           cocteles y prebatch, con una búsqueda que encuentre los tres. Más un
           prebatch sin área —los cargados antes del selector de área— que no
           salía en ningún lado. */
        console.log('\n══ H · Paso 3 en cuatro vistas y el uso del prebatch ══');
        {
            const lic = (id, nombre) => base(id, { nombre, tipoInsumo: 'licor', categoria: 'Licores',
                presentaciones: [{ contNeto: 750, umContenido: 'ML', costoUnitario: 400, precioCarta: 120 }] });
            const MIX = base('prMix', { nombre: 'Mix Negroni PR', categoria: 'Producción propia', esSubReceta: true, recetaId: 'srMix',
                ocultoInventario: false, presentaciones: [{ contNeto: 1000, umContenido: 'ML', rendimiento: 900 }] });
            const SINAREA = base('prVen', { nombre: 'Venecia Spritz PR', area: '', categoria: 'Producción propia', esSubReceta: true,
                recetaId: 'srVen', presentaciones: [{ contNeto: 1000, umContenido: 'ML' }] });
            const sub = (id, nombre, ings) => ({ id, nombre, tipo: 'sub-bebidas', status: 'activa', sucursalId: 'suc_principal',
                camposExtra: { rendimientoFinal: '900', unidadRendimientoFinal: 'ML' }, ingredientes: ings });
            const RECS = [
                sub('srMix', 'Mix Negroni', [{ insumoId: 'gin', cantidad: 300, unidad: 'ML' }, { insumoId: 'campari', cantidad: 300, unidad: 'ML' },
                                             { insumoId: 'vermut', cantidad: 300, unidad: 'ML' }]),
                sub('srVen', 'Venecia Spritz', [{ insumoId: 'campari', cantidad: 200, unidad: 'ML' }]),
                { id: 'rNeg', nombre: 'Negroni', tipo: 'bebidas', status: 'activa', sucursalId: 'suc_principal', precioEnCarta: 160,
                  ingredientes: [{ insumoId: 'prMix', cantidad: 90, unidad: 'ML' }] }];
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV, { nube: {
                negocio_insumos: filasNube([lic('gin', 'Gin Tanqueray'), lic('campari', 'Campari'), lic('vermut', 'Vermouth Rosso'), MIX, SINAREA]),
                recetas: RECS.map(r => ({ id: r.id, negocio_id: 'n1', datos: r })) } }));
            page.on('dialog', d => d.accept());
            await nuevoInv(page);
            await page.waitForFunction(() => filasCaptura.some(f => f.insumoId === 'prMix'), null, { polling: 100, timeout: 8000 });
            await page.evaluate(() => irAPaso(3)); await page.waitForTimeout(400);
            const contenido = () => page.evaluate(() => document.getElementById('stepContent').innerText.replace(/\s+/g, ' '));
            await caso('el Paso 3 abre en «Búsqueda rápida», junto al buscador, con las cuatro vistas en la barra fija', async () => {
                assert.equal(await page.evaluate(() => vistaVentas), 'busqueda');
                assert.match(await page.evaluate(() => document.getElementById('pasoHerr').innerText.replace(/\s+/g, ' ').trim()),
                    /^Búsqueda rápida Insumos Cocteles Prebatch 1/);
            });
            await page.evaluate(() => setVistaVentas('prebatch')); await page.waitForTimeout(300);
            await caso('Prebatch: el Mix Negroni en LISTA, y dice qué lleva', async () => {
                const r = await page.evaluate(() => ({ lista: !!document.querySelector('#stepContent .step3-lista'),
                    txt: document.querySelector('#stepContent .step3-lista').innerText.replace(/\s+/g, ' ') }));
                assert.ok(r.lista);
                assert.match(r.txt, /Mix Negroni PR.*hace: Mix Negroni.*Gin Tanqueray, Campari, Vermouth Rosso/);
            });
            await caso('…y el que no tiene área dice por qué no sale, con el botón para arreglarlo', async () =>
                assert.match(await contenido(), /Venecia Spritz PR — no tiene área asignada 📍 Ponerlo en Barra/));
            await page.evaluate(() => { const i = document.getElementById('prod-prMix'); i.value = '3'; i.dispatchEvent(new Event('blur')); });
            await page.waitForTimeout(300);
            await caso('3 Mix Negroni descuentan 900 ml de CADA insumo que lleva', async () => {
                const r = await page.evaluate(() => ['gin', 'campari', 'vermut'].map(id => consumoBasesPorProduccion(id)));
                assert.deepEqual(r, [900, 900, 900]);
            });
            await page.evaluate(() => setVistaVentas('lista')); await page.waitForTimeout(300);
            await caso('Insumos: cada uno dice su uso en prebatch, en copas y en ml', async () => {
                const t = await contenido();
                for (const n of ['Gin Tanqueray', 'Campari', 'Vermouth Rosso'])
                    assert.match(t, new RegExp(n + '[^]*?Uso en prebatch [\\d.]+ cop · 900 ml'), n);
            });
            await page.evaluate(() => setVistaVentas('menu')); await page.waitForTimeout(300);
            await caso('Cocteles: en LISTA, con su contador', async () => {
                assert.ok(await page.evaluate(() => !!document.querySelector('#stepContent .step3-lista #cnt-rNeg')));
            });
            await page.evaluate(() => setVistaVentas('busqueda')); await page.waitForTimeout(300);
            await page.fill('#ventasBuscador', 'negroni'); await page.waitForTimeout(300);
            await caso('Búsqueda rápida: «negroni» encuentra el insumo, el coctel y el prebatch', async () => {
                const t = await page.evaluate(() => document.getElementById('ventasChips').innerText.replace(/\s+/g, ' '));
                assert.match(t, /INSUMOS Mix Negroni PR.*COCTELES Negroni.*PREBATCH Mix Negroni PR/);
                assert.ok(await page.evaluate(() => !!document.querySelector('#ventasChips #cnt-rNeg') && !!document.querySelector('#ventasChips #prod-prMix')),
                    'sin contadores en los resultados');
            });
            await page.evaluate(() => setVistaVentas('prebatch')); await page.waitForTimeout(300);
            await caso('«Ponerlo en Barra» lo arregla: sale para anotarle batches y tiene su renglón', async () => {
                await page.evaluate(() => [...document.querySelectorAll('.s3-arreglar')].find(b => /Venecia/.test(b.parentElement.textContent)).click());
                await page.waitForTimeout(800);
                const r = await page.evaluate(() => ({ prod: prebatchesProducibles().map(p => p.id).sort().join(','),
                    fila: filasCaptura.some(f => f.insumoId === 'prVen'), guardado: (getInsumos().find(x => x.id === 'prVen') || {}).area }));
                assert.deepEqual(r, { prod: 'prMix,prVen', fila: true, guardado: 'barra' });
            });
            await page.evaluate(() => { _consumoDirty = true; window._step5Dirty = true; window._step5Force = true; irAPaso(5); });
            await page.waitForTimeout(1300);
            await caso('Resultado: el renglón de cada insumo dice su uso en prebatch', async () => {
                const r = await page.evaluate(() => [...document.querySelectorAll('#step5Tablas tr.s5-r1')].map(tr => {
                    const m = tr.nextElementSibling.textContent.replace(/\s+/g, ' ').match(/Uso en prebatch\s*([\d.]+ cop)\s*900 ml/);
                    return tr.querySelector('.s5-nom').textContent + (m ? ': ' + m[1] : ''); }).filter(x => /:/.test(x)).sort());
                assert.equal(r.length, 3, JSON.stringify(r));
            });
            await ctx.close();
        }

        /* ── I · más de mil insumos: el catálogo llega COMPLETO ──────────────
           Supabase entrega como mucho 1000 renglones por consulta, sin aviso.
           El inventario leía el catálogo de un jalón y se quedaba con los
           primeros mil por orden de id: los `prod_…` (producción propia) caen
           al final, y por eso los prebatch no salían aunque Recetas dijera
           «✓ Agregado a insumos». La nube falsa corta igual que la real. */
        console.log('\n══ I · Más de 1000 insumos: el catálogo llega completo ══');
        {
            const muchos = Array.from({ length: 1150 }, (_, i) => base('ins_' + String(i).padStart(4, '0'), {
                nombre: 'Insumo ' + i, tipoInsumo: 'destilado', categoria: 'Destilados',
                presentaciones: [{ contNeto: 750, umContenido: 'ML', costoUnitario: 300 }] }));
            const MIXP = base('prod_mix', { nombre: 'Mix Negroni PR', categoria: 'Producción propia', esSubReceta: true, recetaId: 'srMixI',
                ocultoInventario: false, presentaciones: [{ contNeto: 1000, umContenido: 'ML', rendimiento: 900 }] });
            const SUBI = { id: 'srMixI', nombre: 'Mix Negroni', tipo: 'sub-bebidas', status: 'activa', sucursalId: 'suc_principal',
                camposExtra: { rendimientoFinal: '900', unidadRendimientoFinal: 'ML' }, ingredientes: [{ insumoId: 'ins_0001', cantidad: 300, unidad: 'ML' }] };
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV, { nube: {
                negocio_insumos: muchos.concat([MIXP]).map(x => ({ id: x.id, insumo_id: x.id, negocio_id: 'n1', datos: x })),
                recetas: [{ id: SUBI.id, negocio_id: 'n1', datos: SUBI }] } }));
            await nuevoInv(page);
            await page.waitForFunction(() => getInsumos().length > 1000, null, { polling: 100, timeout: 15000 }).catch(() => {});
            await caso('el catálogo del inventario trae los 1151, no los primeros 1000', async () =>
                assert.equal(await page.evaluate(() => getInsumos().length), 1151));
            await caso('…y el prebatch (prod_…, después del corte) sale para anotarle batches', async () => {
                await page.evaluate(() => { irAPaso(3); setVistaVentas('prebatch'); }); await page.waitForTimeout(400);
                assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#stepContent .step3-lista .s3-nom')].map(e => e.textContent)), ['Mix Negroni PR']);
            });
            await caso('…y la copia local del catálogo no queda pisada con una lista cortada', async () =>
                assert.equal(await page.evaluate(() => JSON.parse(_skGet('insumos') || '[]').length), 1151));
            await ctx.close();
        }

        /* ── J · la barra del paso: buscador y filtros fijos en el encabezado ──
           Edwin (19-nov): un buscador fijo en el encabezado que se adapte a la
           página visible, con los filtros de cada paso. Se escribe con el
           teclado de verdad: el foco no se puede perder a media palabra. */
        console.log('\n══ J · Buscador y filtros del paso, fijos en el encabezado ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV,
                { nube: { negocio_insumos: filasNube(destilados(30).concat([SPRITE, SQUIRT])) }, viewport: { width: 1280, height: 800 } }));
            await nuevoInv(page);
            await page.waitForTimeout(600);
            const barra = () => page.evaluate(() => document.getElementById('pasoHerr').innerText.replace(/\s+/g, ' ').trim());
            const escribir = async (sel, txt) => { await page.click(sel); await page.keyboard.type(txt, { delay: 15 }); await page.waitForTimeout(350); };
            const foco = () => page.evaluate(() => (document.activeElement || {}).id || '');
            await page.evaluate(() => { irAPaso(1); }); await page.waitForTimeout(300);
            await caso('Paso 1: el buscador y los contadores en la barra, sin «Rápida / Lista»', async () => {
                const b = await barra();
                assert.match(b, /Pendientes \d+ Registrados \d+/);
                assert.ok(!/Rápida|Lista/.test(b), b);
            });
            await escribir('#existBuscador', 'Destilado 1');
            await caso('…escribir filtra pendientes Y registrados, y el foco se queda en el buscador', async () => {
                assert.equal(await foco(), 'existBuscador');
                const r = await page.evaluate(() => [...document.querySelectorAll('#p1Pend .p12-item, #p1Reg .p12-item')].map(e => e.textContent));
                assert.ok(r.length > 0 && r.every(x => /Destilado 1/.test(x)), JSON.stringify(r.slice(0, 3)));
            });
            await page.evaluate(() => { const i = document.getElementById('existBuscador'); i.value = ''; buscarInsumoExist(''); });
            await page.evaluate(() => { irAPaso(2); }); await page.waitForTimeout(400);
            await caso('Paso 2: buscar para registrar, y el buscador y las pestañas de lo registrado', async () => {
                assert.ok(await page.evaluate(() => !!document.querySelector('#pasoHerr #entBuscador') && !!document.querySelector('#pasoHerr #entBuscar') &&
                    document.querySelector('#pasoHerr #entTipoChips').children.length > 0), 'faltan piezas');
            });
            await escribir('#entBuscador', 'Squ');
            await caso('…y buscar para registrar encuentra sin perder el foco', async () => {
                assert.equal(await foco(), 'entBuscador');
                assert.match(await page.evaluate(() => document.getElementById('entChips').innerText), /Squirt/);
            });
            await page.evaluate(() => { irAPaso(4); }); await page.waitForTimeout(300);
            await caso('Paso 4: Cancelaciones y Descuentos fijos en la barra', async () => {
                assert.match(await barra(), /🚫 Cancelaciones 0 💸 Descuentos/);
                await page.evaluate(() => [...document.querySelectorAll('#pasoHerr button')].find(b => /Descuentos/.test(b.textContent)).click());
                await page.waitForTimeout(250);
                assert.equal(await page.evaluate(() => _paso4Tab), 'descuentos');
            });
            await page.evaluate(() => { irAPaso(5); }); await page.waitForTimeout(1300);
            await escribir('#phBuscar', 'Sprite');
            await caso('Paso 5: el buscador del Resultado vive en la barra y filtra las tablas', async () => {
                assert.equal(await foco(), 'phBuscar');
                await page.waitForTimeout(300);
                const nombres = await page.evaluate(() => [...document.querySelectorAll('#step5Tablas .s5-nom')].map(e => e.textContent));
                assert.ok(nombres.length > 0 && nombres.every(n => /Sprite/.test(n)), JSON.stringify(nombres));
                assert.equal(await page.evaluate(() => document.querySelectorAll('[placeholder="Buscar producto en el resultado…"]').length), 1);
            });
            await page.evaluate(() => window.scrollTo(0, 3000)); await page.waitForTimeout(300);
            await caso('…y al bajar la barra sigue a la vista, pegada al encabezado', async () => {
                const r = await page.evaluate(() => { const b = document.getElementById('pasoHerr').getBoundingClientRect(); const x = document.elementFromPoint(b.left + 60, b.top + b.height / 2); return { top: b.top, visible: !!(x && document.getElementById('pasoHerr').contains(x)) }; });
                assert.ok(r.visible && r.top > 0 && r.top < 450, JSON.stringify(r));
            });
            await caso('ningún id de buscador está repetido en la página', async () => {
                const rep = await page.evaluate(() => ['existBuscador', 'entBuscador', 'entBuscar', 'entTipoChips', 'ventasBuscador', 'phBuscar', 'filtroFamStep']
                    .filter(id => document.querySelectorAll('#' + id).length > 1));
                assert.deepEqual(rep, []);
            });
            await ctx.close();
        }

        /* ── K · la barra lateral plegada es una caja, no un riel ────────────
           Edwin (19-nov): plegada, una caja rectangular de esquinas redondeadas
           junto a la tarjeta del negocio —un poco menos alta que ella— con su
           icono y «Expandir barra»; expandida, crece y trae «Ocultar barra». Y
           como la caja no baja de la tarjeta, el contenido usa todo el ancho. */
        console.log('\n══ K · Barra lateral: caja al plegar, panel al expandir ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV,
                { nube: { negocio_insumos: filasNube(destilados(10)) }, viewport: { width: 1280, height: 800 } }));
            const estado = () => page.evaluate(() => {
                const nav = document.getElementById('nav'), b = nav.getBoundingClientRect(), t = document.querySelector('#ctxBar .ctx-bar-inner').getBoundingClientRect();
                const m = document.getElementById('mainContent').getBoundingClientRect();
                return { cerrada: nav.classList.contains('cerrado'), w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top),
                         tarjetaTop: Math.round(t.top), tarjetaH: Math.round(t.height), tarjetaIzq: Math.round(t.left), mainIzq: Math.round(m.left),
                         radio: getComputedStyle(nav).borderTopLeftRadius, texto: document.getElementById('navToggleBtn').innerText.trim(),
                         enlaces: [...nav.querySelectorAll('a.nav-link')].filter(a => a.offsetParent).length };
            });
            const plegar = async (quiere) => {
                if ((await page.evaluate(() => document.getElementById('nav').classList.contains('cerrado'))) !== quiere) await page.click('#navToggleBtn');
                await page.waitForTimeout(450);
            };
            await plegar(true);
            const p = await estado();
            await caso('plegada: una caja junto a la tarjeta del negocio, un poco menos alta que ella', async () => {
                assert.equal(p.top, p.tarjetaTop, 'no arranca a la altura de la tarjeta');
                assert.ok(p.h < p.tarjetaH && p.h >= p.tarjetaH - 20, 'alto: ' + p.h + ' vs tarjeta ' + p.tarjetaH);
                assert.ok(p.w > p.h, 'debe ser rectangular (más ancha que alta): ' + p.w + '×' + p.h);
                assert.notEqual(p.radio, '0px');
            });
            await caso('…con su icono y «Expandir barra», sin el riel de iconos de los módulos', async () => {
                assert.equal(p.texto, 'Expandir barra');
                assert.ok(await page.evaluate(() => !!document.querySelector('#navToggleBtn .etx-nav-tg-ic svg')));
                assert.equal(p.enlaces, 0);
            });
            await caso('…y el contenido usa TODO el ancho (ya no le deja carril a la barra)', async () => {
                assert.equal(p.mainIzq, 0);
                assert.ok(p.tarjetaIzq >= 24 + p.w, 'la tarjeta se encima con la caja');
            });
            await plegar(false);
            const e = await estado();
            await caso('expandida: «Ocultar barra» se ve como botón (contorno grueso) y «MÓDULO» va en vertical', async () => {
                const r = await page.evaluate(() => { const b = getComputedStyle(document.getElementById('navToggleBtn')), n = document.querySelector('#nav .etx-nav-numero');
                    const hijos = [...document.querySelector('#nav .etx-nav-identidad').children].map(x => x.className || x.tagName);
                    return { borde: parseFloat(b.borderTopWidth), modo: n ? getComputedStyle(n).writingMode : '', primero: hijos[0] }; });
                assert.ok(r.borde >= 2, 'borde: ' + r.borde);
                assert.equal(r.modo, 'vertical-rl');
                assert.equal(r.primero, 'etx-nav-numero', 'la etiqueta debe ir a la izquierda del icono');
            });
            await caso('…y la cabecera no se aplasta: el botón queda entero dentro de ella', async () => {
                const r = await page.evaluate(() => { const top = document.querySelector('#nav .nav-top').getBoundingClientRect(), b = document.getElementById('navToggleBtn').getBoundingClientRect();
                    return { dentro: b.bottom <= top.bottom + 0.5, top: [top.top, top.bottom], btn: [b.top, b.bottom] }; });
                assert.ok(r.dentro, JSON.stringify(r));
            });
            await caso('expandida: crece a lo ancho y a lo largo, con los módulos y «Ocultar barra»', async () => {
                assert.ok(e.w > p.w && e.h > p.h * 3, JSON.stringify(e));
                assert.equal(e.texto, 'Ocultar barra');
                assert.ok(e.enlaces >= 4, 'enlaces: ' + e.enlaces);
                assert.ok(e.mainIzq >= e.w, 'el contenido se mete debajo de la barra');
            });
            await plegar(true);
            await caso('«Ocultar barra» la regresa a la caja, y se recuerda', async () => {
                const r = await estado();
                assert.ok(r.cerrada && r.w === p.w && r.h === p.h, JSON.stringify(r));
                assert.equal(await page.evaluate(() => localStorage.getItem('etaax_nav_abierta')), '0');
            });
            await ctx.close();
        }

        /* ── L · Pasos 1 y 2 en dos columnas ─────────────────────────────────
           Edwin (19-nov): Paso 1 = pendientes | registrados (lista o iconos),
           el registro en modal y sin «Rápida / Lista». Paso 2 = la lista
           completa de insumos a la izquierda (se vuelve el formulario al tocar
           uno) y lo registrado AGRUPADO por insumo a la derecha, con la
           existencia contada en el Paso 1. */
        console.log('\n══ L · Pasos 1 y 2 en dos columnas ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV,
                { nube: { negocio_insumos: filasNube(destilados(12)) }, viewport: { width: 1280, height: 800 } }));
            await nuevoInv(page);
            await page.waitForTimeout(600);
            await page.evaluate(() => irAPaso(1)); await page.waitForTimeout(300);
            const n = () => page.evaluate(() => [document.querySelectorAll('#p1Pend .p12-item').length, document.querySelectorAll('#p1Reg .p12-item').length]);
            await caso('Paso 1: todos a la izquierda (pendientes), nada a la derecha', async () => assert.deepEqual(await n(), [12, 0]));
            await page.click('#p1Pend .p12-item');
            await page.waitForTimeout(300);
            const primero = await page.evaluate(() => _existInsumoId);
            await caso('tocar un insumo abre su registro en un MODAL', async () => {
                assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('p1Modal')).display), 'flex');
                assert.ok(await page.evaluate(() => !!document.querySelector('#p1Modal .ent-form-card')));
            });
            await page.evaluate(() => [...document.querySelectorAll('#existCardWrap button')].find(b => /Siguiente/.test(b.textContent)).click());
            await page.waitForTimeout(400);
            await caso('«Registrar — Siguiente» lo pasa a la derecha y abre el siguiente pendiente', async () => {
                assert.deepEqual(await n(), [11, 1]);
                const ahora = await page.evaluate(() => _existInsumoId);
                assert.ok(ahora && ahora !== primero, primero + ' → ' + ahora);
            });
            await page.evaluate(() => [...document.querySelectorAll('#existCardWrap button')].find(b => b.textContent.trim() === '✕').click());
            await page.waitForTimeout(250);
            await caso('…y la ✕ cierra SIN marcarlo como registrado', async () => {
                assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('p1Modal')).display), 'none');
                assert.deepEqual(await n(), [11, 1]);
            });
            await page.evaluate(() => setModoCaptura('galeria')); await page.waitForTimeout(250);
            await caso('lista o iconos: la misma vista, en cuadrícula', async () =>
                assert.ok(await page.evaluate(() => document.getElementById('p1Pend').classList.contains('p12-iconos') && document.querySelectorAll('#p1Pend .p12-item').length === 11)));
            await page.evaluate(() => setModoCaptura('lista'));
            // Paso 2
            await page.evaluate((id) => {
                invActual.entradasLog = [
                    { id: 'x1', insumoId: id, nombreProducto: 'Destilado 0', tipo: 'compra', cantidad: 2, fecha: '2026-11-14' },
                    { id: 'x2', insumoId: id, nombreProducto: 'Destilado 0', tipo: 'consignacion', cantidad: 1, fecha: '2026-11-15' },
                    { id: 'x3', insumoId: id, nombreProducto: 'Destilado 0', tipo: 'compra', cantidad: 3, fecha: '2026-11-16' }];
                irAPaso(2);
            }, primero);
            await page.waitForTimeout(500);
            await caso('Paso 2: la lista COMPLETA de insumos a la izquierda, sin teclear nada', async () =>
                assert.equal(await page.evaluate(() => document.querySelectorAll('#entChips .p12-item').length), 12));
            await caso('…y lo registrado agrupado por insumo: «3 entradas», el total y la existencia del Paso 1', async () => {
                const s = await page.evaluate(() => [...document.querySelectorAll('#entLogList .eg > summary')].map(x => x.innerText.replace(/\s+/g, ' ').trim()));
                assert.equal(s.length, 1, JSON.stringify(s));
                assert.match(s[0], /3 entradas Existencia actual \d+(\.\d+)? bot \+6 bot$/);
            });
            await caso('…al abrirlo: cada entrada con su tipo, fecha, ✏️ y el total', async () => {
                await page.evaluate(() => { document.querySelector('#entLogList .eg').open = true; });
                const r = await page.evaluate(() => { const c = document.querySelector('#entLogList .eg .eg-cuerpo');
                    return { filas: c.querySelectorAll('.ent-log-fila').length, editar: c.querySelectorAll('[title="Editar registro completo"]').length,
                             tipos: c.innerText.match(/Compra|Consignaci/g) || [], total: c.querySelector('.eg-total').innerText.replace(/\s+/g, ' ') }; });
                assert.deepEqual([r.filas, r.editar, r.tipos.length], [3, 3, 3]);
                assert.match(r.total, /Total \+6 bot/);
            });
            await page.click('#entChips .p12-item'); await page.waitForTimeout(300);
            await caso('tocar un insumo vuelve ese espacio el registro de la entrada; la ✕ regresa a la lista', async () => {
                assert.equal(await page.evaluate(() => document.querySelectorAll('#entChips .p12-item').length), 0);
                assert.ok(await page.evaluate(() => !!document.querySelector('#entFormCard .ent-form-card')));
                await page.evaluate(() => limpiarSeleccionEntrada()); await page.waitForTimeout(200);
                assert.equal(await page.evaluate(() => document.querySelectorAll('#entChips .p12-item').length), 12);
            });
            await ctx.close();
        }

        /* ── M · detalles antes de publicar (19-nov) ─────────────────────────
           Paso 2: modal de editar más chico, iconos de la app en vez de emojis,
           «Existencia actual» en texto y la foto de evidencia por QR. Paso 3:
           abre en «Búsqueda rápida», la lista por bloques (venta, cortesía,
           merma con su comentario) y cocteles en dos columnas. */
        console.log('\n══ M · Detalles de los Pasos 2 y 3 ══');
        {
            const RECS = Array.from({ length: 4 }, (_, i) => ({ id: 'rc' + i, nombre: 'Coctel ' + i, tipo: 'bebidas', status: 'activa', sucursalId: 'suc_principal',
                precioEnCarta: 150, ingredientes: [{ insumoId: 'd00' + i, cantidad: 60, unidad: 'ML' }] }));
            const { ctx, page } = await abrir(browser, RELOJ, Object.assign({}, INV, { nube: { negocio_insumos: filasNube(destilados(6)),
                recetas: RECS.map(r => ({ id: r.id, negocio_id: 'n1', datos: r })) }, viewport: { width: 1280, height: 800 } }));
            await nuevoInv(page);
            await page.waitForTimeout(600);
            await page.evaluate(() => { const f = filasCaptura[0]; f.cerradasBodega = 2; f.registrado = true;
                invActual.entradasLog = [{ id: 'm1', insumoId: f.insumoId, nombreProducto: f.nombre, tipo: 'compra', cantidad: 2, fecha: '2026-11-14' }]; irAPaso(2); });
            await page.waitForTimeout(500);
            const emojis = () => page.evaluate(() => (document.getElementById('vistaCaptura').innerText.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).filter(c => c !== '✓' && c !== '✕'));
            await caso('Paso 2 sin emojis: los iconos son los de la app', async () => {
                assert.deepEqual(await emojis(), []);
                assert.ok(await page.evaluate(() => document.querySelectorAll('#vistaCaptura svg.inv-ic').length) > 5);
            });
            await caso('…y lo registrado dice «Existencia actual» en texto', async () =>
                assert.match(await page.evaluate(() => document.querySelector('#entLogList .eg > summary').innerText.replace(/\s+/g, ' ')), /Existencia actual 2 bot/));
            await page.click('#entChips .p12-item'); await page.waitForTimeout(300);
            await caso('el registro de una entrada nueva trae la foto de evidencia, también por QR', async () => {
                assert.ok(await page.evaluate(() => !!document.querySelector('#entFormCard .ent-evid .inv-qr-btn') && !!document.querySelector('#entFormCard .ent-evid input[type=file]')));
                await page.click('#entFormCard .inv-qr-btn'); await page.waitForTimeout(600);
                assert.ok(await page.evaluate(() => !!document.querySelector('#entRapidaQrSlot #invQrEvid')), 'no se abrió el recuadro del QR');
                assert.ok(await page.evaluate(() => (JSON.parse(localStorage.getItem('__nube') || '{}').pairing_sesiones || []).length > 0), 'no pidió el token del QR');
            });
            await caso('…y el QR sobrevive a repintar el formulario (cambiar de tipo)', async () => {
                await page.evaluate(() => setTipoEntrada('consignacion')); await page.waitForTimeout(200);
                assert.ok(await page.evaluate(() => !!document.querySelector('#entRapidaQrSlot #invQrEvid')));
            });
            await page.evaluate(() => limpiarSeleccionEntrada());
            await page.evaluate(() => abrirEditorEntrada('m1')); await page.waitForTimeout(300);
            await caso('el modal de editar entrada es más chico y también ofrece el QR', async () => {
                const r = await page.evaluate(() => ({ w: document.querySelector('.ent-ed-card').getBoundingClientRect().width, qr: !!document.querySelector('.ent-ed-card .inv-qr-btn') }));
                assert.ok(r.w <= 480 && r.qr, JSON.stringify(r));
            });
            await page.evaluate(() => cerrarEditorEntrada());
            await page.evaluate(() => irAPaso(3)); await page.waitForTimeout(400);
            await caso('Ventas abre en «Búsqueda rápida»', async () => assert.equal(await page.evaluate(() => vistaVentas), 'busqueda'));
            await page.evaluate(() => setVistaVentas('lista')); await page.waitForTimeout(300);
            await caso('lista de insumos: venta, cortesía y merma, cada una con dos campos y su comentario', async () => {
                const r = await page.evaluate(() => { const tr = document.querySelector('#step3VentasListaCont tr.s3i-row');
                    return { bloques: tr.querySelectorAll('.s3i-blq').length, coment: [...tr.querySelectorAll('.s3i-coment')].map(i => Math.round(i.getBoundingClientRect().width)),
                             info: tr.querySelector('.s3i-info').innerText.replace(/\s+/g, ' ') }; });
                assert.equal(r.bloques, 3);
                assert.equal(r.coment.length, 3);
                assert.ok(r.coment.every(w => w > 150), 'comentarios diminutos: ' + r.coment);
                assert.match(r.info, /Existencia actual 2 bot Entradas \+2 bot/);
            });
            await caso('…y el comentario de la cortesía se guarda en el insumo', async () => {
                await page.fill('#step3VentasListaCont tr.s3i-row .s3i-blq:nth-child(3) .s3i-coment', 'Mesa 4 cumpleaños');
                assert.equal(await page.evaluate(() => filasCaptura[0].cortesiaConcepto), 'Mesa 4 cumpleaños');
            });
            await page.evaluate(() => setVistaVentas('menu')); await page.waitForTimeout(300);
            await caso('cocteles en DOS columnas, con contadores grandes', async () => {
                const r = await page.evaluate(() => { const l = document.querySelector('#stepContent .step3-lista');
                    return { cols: getComputedStyle(l).gridTemplateColumns.split(' ').length, alto: Math.round(l.querySelector('.step3-counter button').getBoundingClientRect().height) }; });
                assert.deepEqual([r.cols, r.alto >= 44], [2, true], JSON.stringify(r));
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
