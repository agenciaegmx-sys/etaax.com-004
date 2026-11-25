/* LA CARÁTULA DE COSTOS — en un navegador de verdad (25-nov).

   Edwin: «vamos a hacerla más profesional… quiero que los porcentajes de gasto
   operativo sean ajustables dependiendo del caso, y el food cost también».
   Lo que se vigila:
     · Las metas salen del TIPO de platillo de cada receta: cocina (entradas,
       comida rápida, fuertes, postres) con FOOD cost y barra (coctelería,
       destilados, cerveza y refrescos) con BAR cost, más «General». Tarjetas
       de meta de costo, gasto operativo y utilidad objetivo, con el real
       promedio; el semáforo es el RANGO SANO de cada tipo.
     · Cada receta en dos renglones: lo real y la proyección sugerida, con su
       diagnóstico. Los números de la referencia de Edwin (Taco de Pork Belly a
       $69: operativo $23.79, IVA $9.52, utilidad $17.84) salen idénticos.
     · El tipo se cambia desde la carátula y se guarda en la receta.
     · «Ajustar porcentajes» guarda los % del negocio en costeo_config (v90); sin
       la v90 corrida se guarda solo en el dispositivo y lo avisa, sin mandar a
       la cola de salida algo que va a fallar.
     · El escandallo enseña el tipo y sus % en la sección de Costeo.
     · La hoja impresa sale con los mismos filtros.

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-caratula.cjs
   SHOTS=<carpeta>: capturas para revisarlas a ojo. */
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

const ing = (nombre, cant, u, precio) => ({ nombre, desc: '', cantidad: cant, unidad: u, costoPorKgLt: precio });
const R = (id, tipo, nombre, grupo, cat, precio, ings, extra) => ({ id, negocio_id: 'n1', datos: Object.assign({ id, tipo, nombre, grupo, categoria: cat, precioEnCarta: precio, status: 'activa', ingredientes: ings, camposExtra: {} }, extra || {}) });
const RECETAS = [
  R('r1', 'alimentos', 'Taco de Pork Belly', 'Tacos', 'Cerdo', 69, [ing('Pork belly', 85, 'G', 210)]),
  R('r2', 'alimentos', 'Taco de Suadero', 'Tacos', 'Res', 69, [ing('Suadero', 50, 'G', 127)]),
  R('r3', 'alimentos', 'Guacamole', 'Entradas', 'Para compartir', 145, [ing('Aguacate', 200, 'G', 190)]),
  R('r4', 'alimentos', 'Arrachera', 'Platos fuertes', 'Cortes', 320, [ing('Arrachera', 250, 'G', 472)]),
  R('r5', 'alimentos', 'Flan napolitano', 'Postres', '', 95, [ing('Base flan', 150, 'G', 140)]),
  R('r6', 'alimentos', 'Sopa del día', 'Sopas', '', '', [ing('Caldo', 300, 'ML', 40)]),
  R('r7', 'bebidas', 'Negroni', 'Coctelería', 'Clásicos', 180, [ing('Campari', 100, 'ML', 529.2)]),
  R('r8', 'bebidas', 'Mezcalita de jamaica', 'Coctelería', 'De la casa', 150, [ing('Mezcal', 60, 'ML', 500)]),
];
function nube(extra) {
    return {
        __auth: [{ id: 'u1', email: 'duena@etaax.prueba', password: 'x', meta: { nombre: 'Dueña' } }],
        negocios: [{ id: 'n1', usuario_id: 'u1', datos: { nombre: 'Café de prueba' } }],
        negocio_sucursales: [{ negocio_id: 'n1', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz', activa: true }, { id: 'suc_dos', nombre: 'Dos', activa: true }] } }],
        suscripciones: [{ negocio_id: 'n1', estado: 'activa', plan: null }],
        negocio_insumos: [], cortes: [], req_pedido: [], req_historial: [], permisos: [], recetas: RECETAS, ...(extra || {})
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
            localStorage.setItem('etaax_ctx', JSON.stringify({ ctxType: 'owner', negId: 'n1', negNombre: 'Café de prueba', sucId: 'suc_principal', sucNombre: 'Matriz', userName: 'Dueña', userBadge: 'Paquete completo' }));
            localStorage.setItem('etaax_negocios', JSON.stringify([{ id: 'n1', usuarioId: 'u1', nombre: 'Café de prueba' }]));
            localStorage.setItem('etaax_n1_sucursales', JSON.stringify([{ id: 'suc_principal', nombre: 'Matriz' }, { id: 'suc_dos', nombre: 'Dos' }]));
            localStorage.setItem('etaax_n1_suc_suc_principal', JSON.stringify({ giro: 'Restaurante bar', telefono: '555 123 4567' }));
            localStorage.setItem('etaax_novedades_vista', '{}');
            localStorage.setItem('etaax_nav_abierta', '0');   // la preferencia vieja de «barra plegada» ya no aplica
            localStorage.setItem('__sembrado', '1');
        }
        if (!sessionStorage.getItem('__ses')) sessionStorage.setItem('__ses', JSON.stringify({ id: 'u1', email: 'duena@etaax.prueba' }));
    })();`;
}
async function abrir(browser, ancho, extra) {
    const ctx = await browser.newContext({ viewport: { width: ancho || 1280, height: 900 } });
    await ctx.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === ORIGEN) {
            const p = path.join(RAIZ, decodeURIComponent(url.pathname));
            if (p.startsWith(RAIZ) && fs.existsSync(p) && fs.statSync(p).isFile())
                return route.fulfill({ status: 200, body: fs.readFileSync(p), headers: { 'content-type': TIPOS[path.extname(p)] || 'application/octet-stream' } });
            return route.fulfill({ status: 404, body: '' });
        }
        if (/supabase-js/.test(url.href))
            return route.fulfill({ status: 200, body: '(' + sdkEtx.toString() + ')();', headers: { 'content-type': 'application/javascript' } });
        if (/fonts\.(googleapis|gstatic)/.test(url.host)) return route.fulfill({ status: 200, body: '' });
        return route.abort();
    });
    await ctx.addInitScript(semilla(nube(extra)));
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    return { ctx, page };
}

const foto = (page, nombre) => process.env.SHOTS ? page.waitForTimeout(500).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png') })) : null;
const abrirRecetas = async (p) => {
    await p.goto(ORIGEN + '/recetas/index.html');
    await p.waitForFunction(() => typeof getRecetas === 'function' && getRecetas().length >= 8, null, { timeout: 20000 });
    await p.waitForTimeout(600);
};
const celdas = (p, nombre) => p.evaluate((n) => {
    const b = [...document.querySelectorAll('#caratulaDetalleBody tbody.car-par')].find(t => t.querySelector('.car-real b').textContent === n);
    if (!b) return null;
    const txt = (tr) => [...tr.children].map(td => td.innerText.replace(/\s+/g, ' ').trim());
    return { real: txt(b.querySelector('.car-real')), proy: b.querySelector('.car-proy') ? txt(b.querySelector('.car-proy')) : null };
}, nombre);
const nube$ = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('__nube') || '{}'));

(async () => {
    const browser = await chromium.launch();
    try {
        console.log('\n══ Carátula de costos · metas por tipo de platillo ══');
        const { ctx, page: p } = await abrir(browser, 1280);
        await abrirRecetas(p);
        await p.evaluate(() => verCaratula()); await p.waitForTimeout(300);
        await foto(p, 'c0-selector');
        await p.evaluate(() => verCaratulaGrupo('alimentos')); await p.waitForTimeout(400);
        await foto(p, 'c1-alimentos');

        await caso('las tres tarjetas de meta según los tipos de la vista: food cost 18–32%, gasto 33–44%, utilidad 24–45%', async () => {
            const k = await p.evaluate(() => [document.querySelector('.k-food span').textContent, ...[...document.querySelectorAll('#caratulaDetalleBody .car-kpi b')].map(b => b.textContent)]);
            assert.deepEqual(k, ['Meta de food cost', '18–32%', '33–44%', '24–45%']);
        });
        await caso('…con el real promedio de las que tienen precio y cuántas van en la meta', async () => {
            const t = await p.evaluate(() => document.querySelector('#caratulaDetalleBody .car-kpis').innerText.replace(/\s+/g, ' '));
            assert.match(t, /Real promedio \d+\.\d%/);
            assert.match(t, /2 de 5 en la meta 1 sin precio/);
        });
        await caso('las diez columnas de la referencia, con «Costo operativo» y «Diagnóstico»', async () => {
            const th = await p.evaluate(() => [...document.querySelectorAll('#caratulaDetalleBody thead th')].map(x => x.textContent.trim()));
            assert.deepEqual(th, ['Nombre de receta', 'Rendimiento neto', 'Costo bruto', 'Food cost %', 'Precio carta c/IVA', 'Costo operativo', 'IVA 16%', 'Utilidad neta $', 'Utilidad neta %', 'Diagnóstico']);
        });
        await caso('los tacos son comida rápida: Pork Belly a $69 → 30.0% (sano 25–32) · $22.60 de operativo (38%) · $19.03 · 32.0% · Óptimo', async () => {
            const c = await celdas(p, 'Taco de Pork Belly');
            assert.match(c.real[0], /Automático · Comida rápida/);
            assert.deepEqual(c.real.slice(2), ['$17.85', '30.0%', '$69.00', '$22.60 38%', '$9.52', '$19.03', '32.0%', 'Óptimo']);
        });
        await caso('…y debajo su proyección sugerida con la regla de su tipo: 28-38-34, $73.95 con IVA y su delivery', async () => {
            const c = await celdas(p, 'Taco de Pork Belly');
            assert.match(c.proy[0], /Proyección sugerida regla 28-38-34/);
            assert.match(c.proy[4], /^\$73\.95 delivery \$99\.45$/);
            assert.match(c.proy[9], /^Faltan \$4\.95$/);
        });
        await caso('el semáforo es el rango sano: el Guacamole al 30.4% (entradas 18–25) y el Flan al 25.6% (postres 15–22) → Ajustar', async () => {
            const g = await celdas(p, 'Guacamole'), f = await celdas(p, 'Flan napolitano');
            assert.deepEqual([g.real[3], g.real[9], f.real[3], f.real[9]], ['30.4%', 'Ajustar merma o precio', '25.6%', 'Ajustar merma o precio']);
        });
        await caso('el tipo se adivina por el grupo: Guacamole es Entrada (33%) y la Arrachera Plato fuerte (44%)', async () => {
            const g = await celdas(p, 'Guacamole'), a = await celdas(p, 'Arrachera');
            assert.match(g.real[0], /Automático · Entradas/); assert.match(g.real[5], / 33%$/);
            assert.match(a.real[0], /Automático · Platos fuertes/); assert.match(a.real[5], / 44%$/);
        });
        await caso('la Arrachera con 42.8% de food cost contra 30% de meta → «Ajustar merma o precio» y le faltan pesos', async () => {
            const a = await celdas(p, 'Arrachera');
            assert.equal(a.real[9], 'Ajustar merma o precio');
            assert.match(a.proy[9], /^Faltan \$/);
        });
        await caso('sin precio en carta no se inventa: «Sin precio»', async () => {
            const s = await celdas(p, 'Sopa del día');
            assert.deepEqual([s.real[4], s.real[9]], ['Sin precio', 'Sin precio']);
        });
        await caso('el filtro de tipo trae solo los tipos del grupo, con cuántas', async () => {
            const o = await p.evaluate(() => [...document.getElementById('caratulaFiltroTipo').options].map(x => x.textContent));
            assert.deepEqual(o, ['Todos los tipos', 'Entradas (2)', 'Comida rápida (2)', 'Platos fuertes (1)', 'Postres (1)']);   // «Sopas» cuenta como entrada
        });
        await p.selectOption('#caratulaFiltroTipo', 'fuerte'); await p.waitForTimeout(200);
        await caso('…y filtra: «Platos fuertes» deja solo la Arrachera, con sus tarjetas y su rango sano', async () => {
            const r = await p.evaluate(() => [[...document.querySelectorAll('#caratulaDetalleBody .car-real b')].map(b => b.textContent), [...document.querySelectorAll('#caratulaDetalleBody .car-kpi b')].map(b => b.textContent), document.querySelector('.k-op small').textContent, document.querySelector('.k-food small').textContent]);
            assert.deepEqual(r, [['Arrachera'], ['32%', '44%', '24%'], 'Platos fuertes', 'Sano 28–35% · real 42.8%']);
        });
        await p.selectOption('#caratulaFiltroTipo', ''); await p.waitForTimeout(200);

        /* Cambiar el tipo desde la carátula: es editar la receta. */
        await caso('el selector de tipo de una receta de cocina solo ofrece tipos de cocina', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelector('#caratulaDetalleBody tbody.car-par .car-tipo select').options].map(o => o.textContent)),
                ['Automático · Comida rápida', 'Entradas', 'Comida rápida', 'Platos fuertes', 'Postres', 'General']));
        await p.selectOption('#caratulaDetalleBody tbody.car-par:first-of-type .car-tipo select', 'general'); await p.waitForTimeout(400);
        await caso('cambiar el tipo en la carátula lo guarda en la receta (y en la nube) y recalcula: Pork Belly en General = la referencia de Edwin', async () => {
            const c = await celdas(p, 'Taco de Pork Belly');
            assert.deepEqual(c.real.slice(2), ['$17.85', '30.0%', '$69.00', '$23.79 40%', '$9.52', '$17.84', '30.0%', 'Óptimo']);
            assert.match(c.proy[0], /regla 30-40-30/); assert.match(c.proy[4], /^\$69\.02 delivery \$92\.82$/);
            assert.equal(await p.evaluate(() => getRecetas().find(r => r.id === 'r1').perfilCosteo), 'general');
            await p.waitForFunction(() => ((JSON.parse(localStorage.getItem('__nube')).recetas || []).find(r => r.id === 'r1') || {}).datos.perfilCosteo === 'general', null, { timeout: 25000 });
        });

        await p.click('#carVerProy'); await p.waitForTimeout(200);
        await caso('«Proyección sugerida» se apaga y se recuerda', async () => {
            assert.equal(await p.evaluate(() => document.querySelectorAll('#caratulaDetalleBody .car-proy').length), 0);
            assert.equal(await p.evaluate(() => localStorage.getItem('etaax_car_proy')), '0');
        });
        await p.click('#carVerProy'); await p.waitForTimeout(200);

        /* Ajustar los porcentajes del negocio */
        await p.click('#btnPerfilesCosteo'); await p.waitForTimeout(300);
        await foto(p, 'c3-perfiles');
        await caso('«Ajustar porcentajes» abre en la pestaña Cocina, con su rango sano de food cost y de operativo', async () => {
            const vis = () => [...document.querySelectorAll('#dlgPerfCuerpo .pf-panel:not([hidden]) .pf-nom b')].map(b => b.textContent);
            const r = await p.evaluate((v) => [document.getElementById('dlgPerfilesCosteo').open, eval(v)(), document.querySelector('#dlgPerfCuerpo .pf-fila[data-id="fuerte"] small').textContent], vis.toString());
            assert.deepEqual(r.slice(0, 2), [true, ['Entradas', 'Comida rápida', 'Platos fuertes', 'Postres', 'General']]);
            assert.match(r[2], /^Food cost sano 28–35% · operativo 42–45%/);
        });
        await p.click('#dlgPerfCuerpo .pf-tabs button[data-area="barra"]'); await p.waitForTimeout(150);
        await foto(p, 'c3b-perfiles-barra');
        await caso('…y la pestaña Barra trae coctelería, destilados y cerveza con su BAR cost', async () => {
            const r = await p.evaluate(() => [[...document.querySelectorAll('#dlgPerfCuerpo .pf-panel:not([hidden]) .pf-nom b')].map(b => b.textContent), document.querySelector('#dlgPerfCuerpo .pf-fila[data-id="coctel"] small').textContent, document.querySelector('#dlgPerfCuerpo .pf-fila[data-id="coctel"] .pf-in span').textContent]);
            assert.deepEqual([r[0], r[2]], [['Coctelería de autor', 'Destilados y tragos largos', 'Cerveza, refrescos y aguas'], 'Bar cost meta']);
            assert.match(r[1], /^Bar cost sano 12–18% · operativo 25–30%/);
        });
        await p.click('#dlgPerfCuerpo .pf-tabs button[data-area="cocina"]'); await p.waitForTimeout(150);
        await p.fill('#dlgPerfCuerpo .pf-fila[data-id="general"] [data-k="op"]', '38');
        await caso('…la utilidad objetivo se recalcula al teclear', async () =>
            assert.equal(await p.evaluate(() => document.querySelector('#dlgPerfCuerpo .pf-fila[data-id="general"] .pf-ut b').textContent), '32%'));
        await p.click('#dlgPerfGuardar'); await p.waitForTimeout(500);
        await caso('…al guardar va a costeo_config (solo lo que se aparta de la referencia) y la carátula se repinta', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('dlgPerfilesCosteo').open), false);
            const c = await celdas(p, 'Taco de Pork Belly');
            assert.match(c.real[5], / 38%$/);
            await p.waitForFunction(() => ((JSON.parse(localStorage.getItem('__nube')).costeo_config || [])[0] || {}).datos, null, { timeout: 25000 });
            const d = (await nube$(p)).costeo_config[0].datos;
            assert.deepEqual(d.perfiles, { general: { food: 30, op: 38 } });
        });

        /* La hoja impresa, con los mismos filtros */
        await p.evaluate(() => { window.__hoja = ''; window.abrirVentanaImpresion = (h) => { window.__hoja = h; }; });
        await p.selectOption('#caratulaFiltroTipo', 'entrada'); await p.waitForTimeout(200);
        await p.evaluate(() => imprimirCaratula());
        await caso('la hoja impresa sale con el filtro de tipo y las metas del tipo', async () => {
            const h = await p.evaluate(() => window.__hoja);
            assert.ok(h.indexOf('Guacamole') > -1 && h.indexOf('Arrachera') < 0);
            assert.match(h, /Metas por tipo de platillo/);
            assert.match(h, /DIAGNÓSTICO/);
        });
        await p.selectOption('#caratulaFiltroTipo', ''); await p.waitForTimeout(200);

        await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light')); await foto(p, 'c4-claro');
        await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await p.evaluate(() => verCaratulaGrupo('bebidas')); await p.waitForTimeout(300);
        await foto(p, 'c2-bebidas');
        await caso('en bebidas es BAR cost: Negroni (clásico) en Destilados 22%, Mezcalita en Coctelería 15%; operativo 28%; utilidad 50–57%', async () => {
            const r = await p.evaluate(() => [document.querySelector('.k-food span').textContent, ...[...document.querySelectorAll('#caratulaDetalleBody .car-kpi b')].map(b => b.textContent), document.querySelector('#caratulaDetalleBody thead th:nth-child(4)').textContent]);
            assert.deepEqual(r, ['Meta de bar cost', '15–22%', '28%', '50–57%', 'Bar cost %']);
        });
        await caso('…y el selector de tipo de una bebida solo ofrece tipos de barra', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelector('#caratulaDetalleBody tbody.car-par .car-tipo select').options].map(o => o.textContent)),
                ['Automático · Destilados y tragos largos', 'Coctelería de autor', 'Destilados y tragos largos', 'Cerveza, refrescos y aguas', 'General']));

        /* El escandallo: el tipo y sus % en la sección de Costeo */
        await p.evaluate(() => { cerrarCaratulaBtnX(); if (typeof entrarEscandallos === 'function') entrarEscandallos(); if (typeof _showEscForm === 'function') _showEscForm(); cargarReceta('r4'); });
        await p.waitForTimeout(700);
        await p.evaluate(() => document.getElementById('seccionCostos').scrollIntoView({ block: 'center' }));
        await foto(p, 'c5-escandallo');
        await caso('el escandallo enseña el tipo (automático: Platos fuertes) y sus % en los campos vacíos', async () => {
            const r = await p.evaluate(() => [document.getElementById('s-perfil').selectedOptions[0].textContent, document.getElementById('s-food').placeholder, document.getElementById('s-op').placeholder, document.getElementById('s-util-obj').textContent, document.getElementById('s-pct-gasto').textContent, document.getElementById('a-pct-gasto').textContent]);
            assert.deepEqual(r, ['Automático · Platos fuertes', '32', '44', '24%', '44%', '44%']);
        });
        await p.selectOption('#s-perfil', 'entrada'); await p.fill('#s-food', '28'); await p.waitForTimeout(200);
        await caso('elegir otro tipo y una meta propia recalcula al momento', async () =>
            assert.deepEqual(await p.evaluate(() => [document.getElementById('s-pct-gasto').textContent, document.getElementById('s-util-obj').textContent, document.getElementById('s-pct-bruto').textContent]), ['33%', '39%', '28%']));
        await p.evaluate(() => guardarReceta()); await p.waitForTimeout(500);
        await caso('…y al guardar la receta se quedan su tipo y su meta', async () => {
            const r = await p.evaluate(() => { const x = getRecetas().find(r => r.id === 'r4'); return [x.perfilCosteo, Math.round(100 / x.multiploCosteo * 100) / 100, x.gastoOpPct]; });
            assert.deepEqual(r, ['entrada', 28, '']);
        });
        await p.evaluate(() => cargarReceta('r7')); await p.waitForTimeout(500);
        await caso('una bebida en el escandallo: «Bar cost meta» y solo tipos de barra', async () => {
            const r = await p.evaluate(() => [document.getElementById('s-food-lbl').textContent, [...document.getElementById('s-perfil').options].map(o => o.textContent), document.getElementById('s-food').placeholder]);
            assert.deepEqual(r, ['Bar cost meta', ['Automático · Destilados y tragos largos', 'Coctelería de autor', 'Destilados y tragos largos', 'Cerveza, refrescos y aguas', 'General'], '22']);   // el Negroni es «Clásicos»
        });
        await ctx.close();

        console.log('\n══ Carátula · sin la migración v90 corrida ══');
        const b = await abrir(browser, 1280, { __sinTabla: ['costeo_config'] });
        const q = b.page;
        await abrirRecetas(q);
        await q.evaluate(() => { window.__alertas = []; window.alert = (m) => window.__alertas.push(String(m)); verCaratula(); verCaratulaGrupo('alimentos'); });
        await q.waitForTimeout(300);
        await q.click('#btnPerfilesCosteo'); await q.waitForTimeout(200);
        await q.fill('#dlgPerfCuerpo .pf-fila[data-id="entrada"] [data-k="op"]', '31');
        await q.click('#dlgPerfGuardar'); await q.waitForTimeout(600);
        await caso('se guarda en el dispositivo y AVISA que falta la v90', async () => {
            assert.match(await q.evaluate(() => window.__alertas.join(' | ')), /falta correr la migración v90/);
            assert.deepEqual(await q.evaluate(() => JSON.parse(localStorage.getItem('etaax_n1_costeo_cfg')).perfiles), { entrada: { food: 22, op: 31 } });
            assert.match((await celdas(q, 'Guacamole')).real[5], / 31%$/);
        });
        await caso('…y no manda a la cola de salida algo que va a fallar ocho veces', async () => {
            const cola = await q.evaluate(() => Object.keys(localStorage).filter(k => /outbox|cola|sync/i.test(k)).map(k => localStorage.getItem(k)).join(''));
            assert.equal(/costeo_config/.test(cola), false);
        });
        await b.ctx.close();

        console.log('\n══ Carátula · en un teléfono ══');
        const c = await abrir(browser, 390);
        await abrirRecetas(c.page);
        await c.page.evaluate(() => { verCaratula(); verCaratulaGrupo('alimentos'); }); await c.page.waitForTimeout(400);
        await foto(c.page, 'c6-telefono');
        await caso('las tarjetas se apilan y la tabla se desliza dentro de su caja (la página no)', async () => {
            const r = await c.page.evaluate(() => { const v = document.getElementById('vistaCaratula'); return [v.scrollWidth <= v.clientWidth + 1, document.querySelector('.car-wrap').scrollWidth > document.querySelector('.car-wrap').clientWidth]; });
            assert.deepEqual(r, [true, true]);
        });
        await c.ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log(malos.length ? '\n🚨 CARÁTULA EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '\n🔒 CARÁTULA EN NAVEGADOR OK — ' + resultados.length + ' casos');
    process.exit(malos.length ? 1 : 0);
})();
