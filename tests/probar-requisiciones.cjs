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
     · (24-nov) El encabezado y el Paso 1 son los de inventarios: «Paso 1 —
       Existencias», Info general · Historial · Salir · Finalizar requisición, el
       buscador con Pendientes/Registrados y UNA vista en dos columnas; la captura
       en modal. La ficha técnica se VE sin contraseña; EDITAR sí la pide. Sin
       emojis: íconos de la app.
     · (24-nov, 2) La página abre en la PORTADA (el historial, como inventarios):
       «+ Nueva requisición» desde ahí; cada requisición —abierta o finalizada—
       es su propio renglón de req_historial y se continúa o edita, se ve su
       pedido, se finaliza o se elimina. La abierta del documento viejo
       (req_pedido) se pasa sola a su renglón.

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
            ins('a_mezcal', { nombre: 'Mezcal Espadín', familia: 'Destilados', area: 'barra', tipoInsumo: 'destilado', sucursales: ['suc_principal'] }),
            // Refresco por caja de 24: el stock va en CAJAS y cada caja cuesta $480.
            ins('a_coca', { nombre: 'Coca-Cola', familia: 'Refrescos', area: 'barra', tipoInsumo: 'refresco', sucursales: ['suc_principal'],
                presentaciones: [{ nombre: 'Caja', presentacionCompra: 'Caja', cantPresCompra: '24', precio: '480', incluyeImpuesto: '1', costoPieza: '20',
                                   contNeto: '355', umContenido: 'ML', stockMin: '2', stockMax: '6' }] }),
            ins('a_limon', { nombre: 'Limón', familia: 'Frutas', area: 'cocina', sucursales: ['suc_principal', 'suc_dos'] }),
            ins('a_ron', { nombre: 'Ron Blanco', familia: 'Destilados', sucursales: ['suc_dos'] }),          // de otra sucursal
            ins('a_batch', { nombre: 'Batch Paloma', esSubReceta: true, sucursales: ['suc_principal'] })    // sub-receta
        ].concat(muchos),
        cortes: [{ id: 'c1', negocio_id: 'n1', datos: { id: 'c1', fecha: '2026-11-20', sucursalId: 'suc_principal', efectivo: 5000 } }],
        req_pedido: [], req_historial: [], permisos: []
    };
}
const nubeDe = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('__nube')));
const filasReq = async (p) => ((await nubeDe(p)).req_historial || []).map(x => x.datos);
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
        /* El editor de insumos (el iframe de «Editar ficha») es pesado y aquí solo
           importa QUÉ abre: se sirve una página ligera para no tumbar el navegador. */
        if (url.origin === ORIGEN && url.pathname === '/recetas/insumos.html')
            return route.fulfill({ status: 200, body: '<!doctype html><meta charset="utf-8"><title>Editor de insumo</title>', headers: { 'content-type': 'text/html' } });
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
    await page.waitForFunction(() => typeof _cacheInsumosReq !== 'undefined' && _cacheInsumosReq && _cacheReqHist !== null && insumos.length > 0, null, { timeout: 20000 }).catch(() => {});
    return { ctx, page };
}

/* SHOTS=<carpeta>: capturas para revisarlas a ojo. */
const foto = (page, nombre) => (process.env.SHOTS && (!process.env.SHOTS_SOLO || nombre.indexOf(process.env.SHOTS_SOLO) === 0)) ? page.waitForTimeout(800).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png'), fullPage: false })) : null;
(async () => {
    const browser = await chromium.launch();
    try {
        console.log('\n══ Requisiciones · con el paquete completo ══');
        const a = await abrir(browser, nube(null));
        const p = a.page;
        await caso('el catálogo CARGA (antes: ordenado por created_at → error → sin insumos)', async () =>
            assert.ok(await p.evaluate(() => (_cacheInsumosReq || []).length) >= 1200));
        await caso('…completo y paginado: entran los 1,203 de esta sucursal aunque pasen de 1000', async () =>
            assert.equal(await p.evaluate(() => document.getElementById('cntPend').textContent), '1203'));
        await caso('…solo los de esta sucursal y sin sub-recetas', async () => {
            const ids = await p.evaluate(() => insumos.map(x => x.id));
            assert.ok(ids.indexOf('a_mezcal') > -1 && ids.indexOf('a_limon') > -1);
            assert.equal(ids.indexOf('a_ron'), -1);
            assert.equal(ids.indexOf('a_batch'), -1);
        });
        await caso('abre en la PORTADA, como inventarios: «Requisiciones», «+ Nueva requisición» y sus tarjetas', async () => {
            const v = await p.evaluate(() => ({ lista: getComputedStyle(document.getElementById('vistaListaReq')).display, capt: document.getElementById('vistaCapturaReq').style.display,
                tit: document.querySelector('#vistaListaReq .brand-title').textContent, btn: document.getElementById('btnNuevaReq').textContent.trim(),
                tarj: [...document.querySelectorAll('#vistaListaReq .stat-label')].map(x => x.textContent.trim()), n: document.getElementById('statReqs').textContent,
                vacio: document.getElementById('historialReq').textContent.replace(/\s+/g, ' ').trim() }));
            assert.deepEqual([v.lista !== 'none', v.capt, v.tit, v.btn, v.n], [true, 'none', 'Requisiciones', '+ Nueva requisición', '0']);
            assert.deepEqual(v.tarj, ['Requisiciones', 'Última requisición', 'Ver', 'Filtrar por']);
            assert.match(v.vacio, /Sin requisiciones/);
        });
        await foto(p, 'r0-portada-vacia');
        await p.click('#btnNuevaReq'); await p.waitForTimeout(250);
        await caso('«+ Nueva requisición» abre la captura en blanco (sin guardar nada todavía)', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('vistaCapturaReq').style.display), '');
            assert.equal(await p.evaluate(() => document.getElementById('vistaListaReq').style.display), 'none');
            assert.equal(((await nubeDe(p)).req_historial || []).length, 0);
        });
        await caso('el botón de los pasos es el de inventarios: «1 Existencias ▾», sin la barra de pasos', async () => {
            assert.match(await p.evaluate(() => document.getElementById('btnPasoMenu').innerText.replace(/\s+/g, ' ')), /1 ?Existencias ▾/);
            assert.equal(await p.evaluate(() => !!document.querySelector('.req-steps') || !!document.getElementById('stepBtn1')), false);
        });
        await caso('el encabezado es el de inventarios: «Paso 1 — Existencias», guardado y Info general · Pedido · Salir · Finalizar', async () => {
            const h = await p.evaluate(() => ({
                paso: document.getElementById('stepLabel').textContent, ind: document.getElementById('autoGuardarInd').textContent,
                bot: [...document.querySelectorAll('#hdrBtns > button')].filter(b => b.offsetParent).map(b => b.textContent.trim()),
                fijo: getComputedStyle(document.getElementById('reqHeader')).position }));
            assert.equal(h.paso, 'Paso 1 — Existencias');
            assert.equal(h.ind, 'Todos los cambios guardados');
            assert.deepEqual(h.bot, ['Info general', 'Pedido', 'Salir', 'Finalizar requisición']);
            assert.equal(h.fijo, 'sticky');
        });
        await caso('…con la barra del paso: «Buscar producto…», Pendientes y Registrados, lista o iconos', async () => {
            const t = await p.evaluate(() => ({ ph: document.getElementById('reqBuscador').placeholder,
                ind: [...document.querySelectorAll('#pasoHerr .ph-ind > span')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).join(' | '), vt: document.querySelectorAll('#pasoHerr .vista-toggle button').length }));
            assert.deepEqual([t.ph, t.ind, t.vt], ['Buscar producto…', 'Pendientes 1203 | Registrados 0', 2]);
        });
        await caso('UNA sola vista en dos columnas, Pendientes | Registrados (sin «Uno por uno» ni «Lista completa»)', async () => {
            const v = await p.evaluate(() => ({ cab: [...document.querySelectorAll('.p12-cab')].map(c => c.textContent.replace(/\s+/g, ' ').trim()),
                pend: document.querySelectorAll('#p1Pend .p12-item').length, viejo: !!document.getElementById('vChipRapida') || !!document.getElementById('tablaReq') || /Uno por uno|Lista completa/.test(document.body.innerText) }));
            assert.deepEqual(v.cab, ['Pendientes1203', 'Registrados0']);
            assert.equal(v.pend, 1203);
            assert.equal(v.viejo, false);
        });
        await p.fill('#reqBuscador', 'coca'); await p.waitForTimeout(150);
        await caso('el buscador filtra las dos columnas y no pierde el foco', async () => {
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#p1Pend .p12-item')].map(b => b.dataset.id)), ['a_coca']);
            assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), 'reqBuscador');
            assert.equal(await p.evaluate(() => document.getElementById('p1NPend').textContent), '1 de 1203');
        });
        await p.fill('#reqBuscador', ''); await p.waitForTimeout(150);
        await caso('sin emojis en la pantalla: íconos de la app', async () => {
            const t = await p.evaluate(() => document.getElementById('mainContent').innerText);
            assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(t), false, t.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u));
            assert.ok(await p.evaluate(() => document.querySelectorAll('#reqHeader svg.inv-ic').length >= 4));
        });
        await foto(p, 'r1-existencias');
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

        console.log('\n══ Requisiciones · contar en el modal ══');
        await p.evaluate(() => irPaso(1)); await p.waitForTimeout(150);
        await p.click('#p1Pend .p12-item[data-id="a_coca"]'); await p.waitForTimeout(200);
        await caso('tocar un pendiente abre su captura en un modal', async () =>
            assert.deepEqual(await p.evaluate(() => [document.getElementById('reqCaptModal').style.display, document.getElementById('rcCard').dataset.id]), ['flex', 'a_coca']));
        const tarjeta = () => p.evaluate(() => document.getElementById('rcCard').textContent.replace(/\s+/g, ' '));
        const resultado = () => p.evaluate(() => document.getElementById('rcRes').textContent.replace(/\s+/g, ' '));
        await caso('la tarjeta dice cómo se compra, lo que cuesta la caja y la pieza, y el stock EN CAJAS', async () => {
            const t = await tarjeta();
            assert.match(t, /Presentación de compra\s*Caja de 24 piezas de 355 ml c\/u/);
            assert.equal((t.match(/\$20\.00 por pieza/g) || []).length, 1, 'el precio por pieza no se repite');
            assert.match(t, /\$480\.00 por caja\s*\$20\.00 por pieza/);
            assert.match(t, /mín 2 · máx 6\s*en cajas/);
        });
        await caso('la existencia va en DOS cantidades con su unidad: cajas + piezas (o % de una abierta)', async () => {
            const v = await p.evaluate(() => ({ sel: [...document.querySelectorAll('#rcCard .rc-dos select')].map(x => x.value),
                ops: [...document.querySelector('#rcCard .rc-dos select').options].map(o => o.textContent),
                viejo: !!document.querySelector('#rcCard .ent-tipo-btn') || /Directo|Llenas \+ %|Cerradas \+ piezas/.test(document.getElementById('rcCard').textContent) }));
            assert.deepEqual([v.sel, v.ops, v.viejo], [['caja', 'pieza'], ['cajas', 'piezas', '% abierta'], false]);
        });
        await caso('sin capturar, la tarjeta pide la existencia', async () => assert.match(await resultado(), /Captura lo que hay/));
        let campos = await p.$$('#rcCard .rc-dos input');
        await campos[0].type('1'); await campos[1].type('12');
        await caso('AL TECLEAR (sin salir del campo): 1 caja + 12 piezas = 1.5 ≤ mínimo 2 → pedir hasta 6: 5 cajas · $2,400', async () => {
            const r = await resultado();
            assert.match(r, /Hay pedido: 5 cajas · \$2,400\.00/);
            assert.match(r, /Tienes 1\.5 cajas y el mínimo es 2: se pide hasta el máximo \(6\)/);
            assert.match(await p.evaluate(() => document.getElementById('rcExist').textContent), /1\.5 cajas/);
        });
        await campos[0].fill('3');
        await caso('…y con 3 cajas + 12 piezas (3.5 > 2): «No hay pedido», al momento', async () =>
            assert.match(await resultado(), /No hay pedido.*Tienes 3\.5 cajas: más que el mínimo \(2\)/));
        await foto(p, 'r4-tarjeta');
        await caso('con existencia, el botón dice «Registrado — Siguiente»', async () =>
            assert.match(await p.evaluate(() => document.getElementById('rcSig').textContent), /^Registrado — Siguiente$/));
        await campos[0].fill('2'); await campos[1].fill('0');
        await caso('existencia IGUAL al mínimo (2) también pide: 4 cajas · $1,920', async () =>
            assert.match(await resultado(), /Hay pedido: 4 cajas · \$1,920\.00/));
        await caso('el pedido viene escrito (lo sugerido: 4) y bloqueado; ya no hay «Usar sugerido»', async () => {
            assert.deepEqual(await p.evaluate(() => [document.getElementById('rcPed').value, document.getElementById('rcPed').readOnly, document.getElementById('rcPedCosto').textContent]), ['4', true, '$1,920.00']);
            assert.equal(/Usar sugerido/.test(await tarjeta()), false);
        });
        await p.click('#rcPedEditar'); await p.fill('#rcPed', '7'); await p.waitForTimeout(100);
        await caso('«Pedir otra cantidad» lo deja escribir y el costo cambia al teclear: 7 cajas · $3,360', async () => {
            assert.deepEqual(await p.evaluate(() => [document.getElementById('rcPed').readOnly, document.getElementById('rcPedCosto').textContent, reqData.a_coca.pedidoManual]), [false, '$3,360.00', 7]);
            assert.match(await resultado(), /Hay pedido: 7 cajas · \$3,360\.00\s*Cantidad que pusiste a mano \(la sugerida es 4\)/);
        });
        await p.fill('#rcPed', ''); await p.waitForTimeout(100);
        await caso('…y borrarla regresa a la sugerida', async () => {
            assert.equal(await p.evaluate(() => reqData.a_coca.pedidoManual), '');
            assert.match(await resultado(), /Hay pedido: 4 cajas/);
        });
        await p.evaluate(() => { delete _reqPedEdit.a_coca; _pintarCardReq(); });
        await caso('con una de 1 sola botella: «Botella de 750 ml» y su precio una vez', async () => {
            const t = await p.evaluate(() => { const r = EtaaxCore.referenciaCompra({ tipoInsumo: 'destilado' }, { presentacionCompra: 'Botella', precio: '2065', incluyeImpuesto: '1', contNeto: '750', umContenido: 'ML' });
                const d = document.createElement('div'); d.innerHTML = _refCompraHTML({}, { presentacionCompra: 'Botella' }, r); return d.textContent.replace(/\s+/g, ' '); });
            assert.match(t, /Presentación de compra\s*Botella de 750 ml/, t);
            assert.equal((t.match(/\$2,065\.00/g) || []).length, 1, t);
        });
        await caso('el costo del pedido va por CAJA (antes: por pieza, 24 veces más barato)', async () =>
            assert.equal(await p.evaluate(() => { const c = calcItem(insumos.find(x => x.id === 'a_coca'), reqData.a_coca); return pedidoFinal(c, reqData.a_coca) * c.costoUnitPieza; }), 1920));
        await p.evaluate(() => { window.__claves = 0; window._pedirClaveAdmin = (a, cb) => { window.__claves++; cb(); }; });
        await p.click('#rcCard >> text=Ficha técnica'); await p.waitForTimeout(250);
        await caso('«Ficha técnica» se VE sin pedir contraseña (Edwin, 24-nov)', async () => {
            const f = await p.evaluate(() => ({ claves: window.__claves, ov: !!document.getElementById('reqFichaOv'), editor: !!document.getElementById('reqEditorOv'),
                txt: (document.getElementById('reqFichaOv') || { textContent: '' }).textContent.replace(/\s+/g, ' ') }));
            assert.deepEqual([f.claves, f.ov, f.editor], [0, true, false]);
            assert.match(f.txt, /Coca-Cola.*Presentaciones.*Presentación de compra\s*Caja de 24 piezas.*mín 2 · máx 6/);
        });
        await foto(p, 'r5-ficha');
        await p.click('#reqFichaOv >> text=Editar ficha'); await p.waitForTimeout(250);
        await caso('…«Editar ficha» SÍ pide la contraseña y abre el editor real del insumo en ventana flotante', async () => {
            assert.equal(await p.evaluate(() => window.__claves), 1);
            assert.equal(await p.evaluate(() => !!document.getElementById('reqFichaOv')), false);
            assert.match(await p.evaluate(() => (document.querySelector('#reqEditorOv iframe') || { getAttribute: () => '' }).getAttribute('src')), /\/recetas\/insumos\.html\?solo=1&id=a_coca/);
        });
        await p.evaluate(() => {
            const c = JSON.parse(JSON.stringify(insumos.find(x => x.id === 'a_coca'))); c.presentaciones[0].stockMax = '10';
            window.postMessage({ type: 'insumoGuardado', insumos: [c] }, location.origin);
        });
        await p.waitForTimeout(400);
        await caso('…al guardar, se cierra y la requisición toma el cambio al momento (máx 10 → pedir 8)', async () => {
            assert.equal(await p.evaluate(() => !!document.getElementById('reqEditorOv')), false);
            assert.match(await tarjeta(), /mín 2 · máx 10/);
            assert.match(await resultado(), /Hay pedido: 8 cajas/);
        });
        await caso('mientras espera la pausa de teclas dice «Guardando…»', async () =>
            assert.equal(await p.evaluate(() => { setReqData(reqData); return document.getElementById('autoGuardarInd').textContent; }), 'Guardando…'));
        await p.waitForTimeout(900);   // se guarda en la nube 0.7 s después de la última tecla
        await caso('…y luego «Todos los cambios guardados»', async () =>
            assert.equal(await p.evaluate(() => document.getElementById('autoGuardarInd').textContent), 'Todos los cambios guardados'));
        await p.click('#rcSig'); await p.waitForTimeout(250);
        await caso('«Registrado — Siguiente» pasa al siguiente PENDIENTE (Limón) y la Coca queda en Registrados con su pedido', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('rcCard').dataset.id), 'a_limon');
            assert.match(await p.evaluate(() => document.querySelector('#p1Reg .p12-item[data-id="a_coca"]').textContent.replace(/\s+/g, ' ')), /Pedir 8 cajas · \$3,840\.00\s*Hay 2 cajas/);
            assert.equal(await p.evaluate(() => document.getElementById('cntReg').textContent), '1');
        });
        await caso('sin existencia, el botón ofrece «Registrar en cero — Siguiente»', async () =>
            assert.match(await p.evaluate(() => document.getElementById('rcSig').textContent), /^Registrar en cero — Siguiente$/));
        await p.click('#rcCard .rc-x'); await p.waitForTimeout(150);
        await caso('cerrar el modal NO registra (el Limón sigue pendiente)', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('reqCaptModal').style.display), 'none');
            assert.equal(await p.evaluate(() => esRegistrado(reqData.a_limon)), false);
        });
        await p.click('#btnInfoReq'); await p.waitForTimeout(150);
        await caso('«Info general»: sucursal, estado, revisados, lo que va del pedido y cargar anteriores', async () => {
            const t = await p.evaluate(() => document.getElementById('infoReqBody').textContent.replace(/\s+/g, ' '));
            assert.match(t, /Sucursal\s*Matriz/);
            assert.match(t, /Insumos revisados\s*1 de 1203/);
            assert.match(t, /A pedir\s*1 insumo\s*Costo estimado\s*\$3,840\.00/);
            assert.match(t, /Estado\s*Abierta/);
            assert.match(t, /Cargar existencias anteriores/);
        });
        await foto(p, 'r6-info');
        await p.evaluate(() => cerrarInfoReq());
        await caso('lo capturado se guarda en SU renglón del historial (abierta, de ESTA sucursal)', async () => {
            const f = await filasReq(p);
            assert.equal(f.length, 1);
            assert.deepEqual([f[0].sucursalId, f[0].cerrada, f[0].items.a_coca.existencia], ['suc_principal', false, 2]);
        });
        await p.click('#btnFinalizarReq'); await p.waitForTimeout(600);
        await caso('«Finalizar» la guarda en el historial con su sucursal y su costo, y vuelve a la portada', async () => {
            const h = (await filasReq(p))[0];
            assert.deepEqual([h.sucursalId, h.cerrada, h.resumen.totalItems, h.resumen.totalCosto, !!h.fecha], ['suc_principal', true, 1, 3840, true]);
            assert.equal(await p.evaluate(() => document.getElementById('vistaCapturaReq').style.display), 'none');
            assert.match(await p.evaluate(() => document.getElementById('reqAvisoLista').textContent), /Requisición finalizada/);
        });
        await caso('…en la portada: la requisición, sus revisados, lo que se pide, su costo y «Finalizada»', async () => {
            const t = await p.evaluate(() => [...document.querySelectorAll('#historialReq tbody tr')].map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim())));
            assert.equal(t.length, 1);
            assert.match(t[0][1], /^Requisición · /);
            assert.deepEqual(t[0].slice(2, 6), ['1', '1', '$3,840.00', 'Finalizada']);
            assert.equal(await p.evaluate(() => document.getElementById('statReqs').textContent), '1');
        });
        await p.click('#btnNuevaReq'); await p.waitForTimeout(250);
        await p.click('#p1Pend .p12-item[data-id="a_limon"]'); await p.waitForTimeout(150);
        await p.click('#rcSig'); await p.waitForTimeout(250);
        await caso('«Registrar en cero — Siguiente» registra la existencia en 0 (en cero: se pide todo el máximo)', async () => {
            assert.equal(await p.evaluate(() => reqData.a_limon.existencia), 0);
            assert.match(await p.evaluate(() => document.querySelector('#p1Reg .p12-item[data-id="a_limon"]').textContent.replace(/\s+/g, ' ')), /Pedir 6/);
            assert.equal(await p.evaluate(() => document.getElementById('rcCard').dataset.id), 'a_mezcal');
        });
        await caso('la nueva NO trae lo de la anterior (empieza en blanco)', async () =>
            assert.equal(await p.evaluate(() => esRegistrado(reqData.a_coca)), false));
        await p.evaluate(() => _cerrarCapturaReq());
        await p.click('#btnSalirReq'); await p.waitForTimeout(500);
        await caso('«Salir» guarda y vuelve a la portada: la abierta, arriba', async () => {
            const t = await p.evaluate(() => [...document.querySelectorAll('#historialReq tbody tr td:nth-child(6)')].map(c => c.textContent.trim()));
            assert.deepEqual(t, ['Abierta', 'Finalizada']);
            const ab = (await filasReq(p)).find(x => x.cerrada === false);
            assert.equal(ab.items.a_limon.existencia, 0);
        });
        await p.evaluate(() => setModoListaHistReq('galeria')); await foto(p, 'r7-portada-galeria');
        await caso('…también en galería, con «Continuar» y «Editar» a la vista', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#historialReq .hist-card')].map(c => [...c.querySelectorAll('.hist-card-actions button')].map(b => b.textContent.trim()).join(' '))),
                ['Pedido Continuar ⋯', 'Pedido Editar ⋯']));
        await p.evaluate(() => setModoListaHistReq('lista')); await foto(p, 'r8-portada');
        await p.click('#btnNuevaReq'); await p.waitForTimeout(250);
        await caso('«+ Nueva» con una abierta: pregunta si continuarla o empezar otra', async () =>
            assert.match(await p.evaluate(() => document.body.innerText), /Ya hay una requisición abierta/));
        await p.click('text=Empezar otra'); await p.waitForTimeout(250);
        await p.click('#btnSalirReq'); await p.waitForTimeout(400);
        await caso('…empezar otra y salir sin capturar NO deja una requisición vacía', async () => {
            assert.equal((await filasReq(p)).length, 2);
            assert.equal(await p.evaluate(() => document.querySelectorAll('#historialReq tbody tr').length), 2);
        });
        await p.click('#historialReq tbody tr:nth-child(2) button'); await p.waitForTimeout(150);
        await caso('el menú «⋯» de una finalizada: Editar, Ver pedido y Eliminar', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.req-menu button')].map(b => b.textContent.trim())), ['Editar', 'Ver pedido', 'Eliminar']));
        await p.click('.req-menu >> text=Editar'); await p.waitForTimeout(300);
        await caso('«Editar» abre la finalizada con lo que tenía, y el botón dice «Guardar cambios»', async () => {
            assert.equal(await p.evaluate(() => reqData.a_coca.existencia), 2);
            assert.match(await p.evaluate(() => document.getElementById('btnFinalizarReq').textContent), /Guardar cambios/);
        });
        await p.click('#p1Reg .p12-item[data-id="a_coca"]'); await p.waitForTimeout(200);
        await (await p.$$('#rcCard .rc-dos input'))[0].fill('1'); await p.waitForTimeout(100);
        await p.evaluate(() => _cerrarCapturaReq());
        await p.click('#btnFinalizarReq'); await p.waitForTimeout(600);
        await caso('…«Guardar cambios» la actualiza en su lugar (no crea otra): 1 caja → pedir 9 · $4,320', async () => {
            const f = await filasReq(p), fin = f.filter(x => x.cerrada);
            assert.equal(f.length, 2);
            assert.equal(fin.length, 1);
            assert.deepEqual([fin[0].items.a_coca.existencia, fin[0].resumen.totalCosto, !!fin[0].editada], [1, 4320, true]);
            assert.match(await p.evaluate(() => document.getElementById('reqAvisoLista').textContent), /Cambios guardados/);
        });
        await p.click('#historialReq tbody tr:nth-child(1) button'); await p.waitForTimeout(150);
        await caso('el menú «⋯» de la abierta: Continuar, Ver pedido, Finalizar y Eliminar', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.req-menu button')].map(b => b.textContent.trim())), ['Continuar', 'Ver pedido', 'Finalizar requisición', 'Eliminar']));
        await p.evaluate(() => { window.__claves = 0; window._pedirClaveAdmin = (a, cb) => { window.__claves++; cb(); }; });
        await p.click('.req-menu >> text=Eliminar'); await p.waitForTimeout(1500);
        await caso('«Eliminar» pide la contraseña y la quita de la portada y de la nube', async () => {
            assert.equal(await p.evaluate(() => window.__claves), 1);
            assert.equal(await p.evaluate(() => document.querySelectorAll('#historialReq tbody tr').length), 1);
            const f = await filasReq(p);
            assert.deepEqual(f.map(x => x.cerrada), [true]);
        });
        await p.click('#historialReq tbody tr:nth-child(1) button'); await p.waitForTimeout(150);
        await p.click('.req-menu >> text=Ver pedido'); await p.waitForTimeout(400);
        await caso('«Ver pedido» abre la requisición en el paso 3 (Pedido y envío)', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('vistaPaso3').style.display), '');
            assert.match(await p.evaluate(() => document.getElementById('btnPasoMenu').innerText.replace(/\s+/g, ' ')), /3 ?Pedido y envío/);
        });
        await p.click('#btnSalirReq'); await p.waitForTimeout(300);
        await p.evaluate(() => setModoHistReq('mes')); await p.waitForTimeout(150);
        await caso('«Mes / Año»: el calendario cuenta las requisiciones de cada mes', async () => {
            const mes = new Date().getMonth();
            assert.equal(await p.evaluate((m) => document.querySelectorAll('#historialReq .cal-mes')[m].querySelector('.cal-mes-count').textContent, mes), '1');
        });
        await p.evaluate(() => setModoHistReq('todos'));
        await caso('portada sin emojis', async () =>
            assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{FE0F}]/u.test(await p.evaluate(() => document.getElementById('vistaListaReq').innerText)), false));

        console.log('\n══ Requisiciones · otra sucursal ══');
        await p.click('#btnNuevaReq'); await p.waitForTimeout(250);
        await p.evaluate(() => { reqData.a_limon = { existencia: 4 }; setReqData(reqData); });
        await p.waitForTimeout(900);
        await p.evaluate(() => localStorage.setItem('etaax_sucursal_activa', 'suc_dos'));
        await p.reload();
        await p.waitForFunction(() => typeof insumos !== 'undefined' && insumos.length > 0 && _cacheReqHist !== null, null, { timeout: 20000 });
        await caso('la portada de otra sucursal NO trae las requisiciones de la Matriz', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('statReqs').textContent), '0');
            assert.equal(await p.evaluate(() => getHistorial().length), 0);
        });
        await p.click('#btnNuevaReq'); await p.waitForTimeout(250);
        await caso('…y su nueva requisición no trae la existencia del Limón (compartido) de la Matriz', async () =>
            assert.equal(await p.evaluate(() => (reqData.a_limon || {}).existencia), undefined));
        await a.ctx.close();

        console.log('\n══ Requisiciones · solo Cost·ax ══');
        const nb = nube({ sucursales: { suc_principal: ['costax'] } });
        nb.req_pedido = [{ negocio_id: 'n1', datos: { __v: 2, porSucursal: {
            suc_principal: { inicio: '2026-11-20T15:00:00.000Z', items: { a_limon: { existencia: 3 } } },
            suc_dos: { inicio: '2026-11-21T15:00:00.000Z', items: { a_limon: { existencia: 9 } } } } } }];
        const b = await abrir(browser, nb);
        const q = b.page;
        await q.waitForTimeout(800);
        await caso('la requisición ABIERTA del documento viejo pasa sola a su renglón y sale en la portada', async () => {
            const f = await filasReq(q);
            assert.deepEqual(f.map(x => [x.sucursalId, x.cerrada, x.items.a_limon.existencia]), [['suc_principal', false, 3]]);
            assert.deepEqual(await q.evaluate(() => [...document.querySelectorAll('#historialReq tbody tr td:nth-child(6)')].map(c => c.textContent.trim())), ['Abierta']);
        });
        await caso('…y sale del documento (la de la otra sucursal se queda para cuando ella abra)', async () => {
            const d = (await nubeDe(q)).req_pedido[0].datos;
            assert.deepEqual(Object.keys(d.porSucursal), ['suc_dos']);
        });

        await caso('carga igual su catálogo', async () => assert.equal(await q.evaluate(() => document.getElementById('cntPend').textContent), '1203'));
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
