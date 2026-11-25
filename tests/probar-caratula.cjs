/* LA CARÁTULA DE COSTOS — en un navegador de verdad (25-nov).

   Edwin: «vamos a hacerla más profesional… quiero que los porcentajes de gasto
   operativo sean ajustables dependiendo del caso, y el food cost también».
   Lo que se vigila:
     · Las metas salen del TIPO de platillo de cada receta (entradas, fuertes,
       postres, bebidas, general): tarjetas de meta de food cost, gasto
       operativo y utilidad objetivo, con el real promedio.
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

        await caso('las tres tarjetas de meta: food cost 30%, gasto 33–44% (según el tipo), utilidad 26–37%', async () => {
            const k = await p.evaluate(() => [...document.querySelectorAll('#caratulaDetalleBody .car-kpi b')].map(b => b.textContent));
            assert.deepEqual(k, ['30%', '33–44%', '26–37%']);
        });
        await caso('…con el real promedio de las que tienen precio y cuántas van en la meta', async () => {
            const t = await p.evaluate(() => document.querySelector('#caratulaDetalleBody .car-kpis').innerText.replace(/\s+/g, ' '));
            assert.match(t, /Real promedio \d+\.\d%/);
            assert.match(t, /de 5 en la meta 1 sin precio/);
        });
        await caso('las diez columnas de la referencia, con «Costo operativo» y «Diagnóstico»', async () => {
            const th = await p.evaluate(() => [...document.querySelectorAll('#caratulaDetalleBody thead th')].map(x => x.textContent.trim()));
            assert.deepEqual(th, ['Nombre de receta', 'Rendimiento neto', 'Costo bruto', 'Food cost %', 'Precio carta c/IVA', 'Costo operativo', 'IVA 16%', 'Utilidad neta $', 'Utilidad neta %', 'Diagnóstico']);
        });
        await caso('Taco de Pork Belly a $69, igual que la referencia: 30.0% · $23.79 · $9.52 · $17.84 · 30.0% · Óptimo', async () => {
            const c = await celdas(p, 'Taco de Pork Belly');
            assert.deepEqual(c.real.slice(2), ['$17.85', '30.0%', '$69.00', '$23.79 40%', '$9.52', '$17.84', '30.0%', 'Óptimo']);
        });
        await caso('…y debajo su proyección sugerida: regla 30-40-30, $69.02 con IVA y su delivery', async () => {
            const c = await celdas(p, 'Taco de Pork Belly');
            assert.match(c.proy[0], /Proyección sugerida regla 30-40-30/);
            assert.match(c.proy[4], /^\$69\.02 delivery \$92\.82$/);
            assert.equal(c.proy[9], 'En la meta');
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
            assert.deepEqual(o, ['Todos los tipos', 'Entradas (2)', 'Platos fuertes (1)', 'Postres (1)', 'General (2)']);   // «Sopas» cuenta como entrada
        });
        await p.selectOption('#caratulaFiltroTipo', 'fuerte'); await p.waitForTimeout(200);
        await caso('…y filtra: «Platos fuertes» deja solo la Arrachera, con sus tarjetas', async () => {
            const r = await p.evaluate(() => [[...document.querySelectorAll('#caratulaDetalleBody .car-real b')].map(b => b.textContent), [...document.querySelectorAll('#caratulaDetalleBody .car-kpi b')].map(b => b.textContent), document.querySelector('.k-op small').textContent]);
            assert.deepEqual(r, [['Arrachera'], ['30%', '44%', '26%'], 'Platos fuertes']);
        });
        await p.selectOption('#caratulaFiltroTipo', ''); await p.waitForTimeout(200);

        /* Cambiar el tipo desde la carátula: es editar la receta. */
        await p.selectOption('#caratulaDetalleBody tbody.car-par:first-of-type .car-tipo select', 'fuerte'); await p.waitForTimeout(400);
        await caso('cambiar el tipo en la carátula lo guarda en la receta (y en la nube) y recalcula: Pork Belly como fuerte → 44%', async () => {
            const c = await celdas(p, 'Taco de Pork Belly');
            assert.match(c.real[5], /^\$26\.17 44%$/);
            assert.equal(await p.evaluate(() => getRecetas().find(r => r.id === 'r1').perfilCosteo), 'fuerte');
            await p.waitForFunction(() => ((JSON.parse(localStorage.getItem('__nube')).recetas || []).find(r => r.id === 'r1') || {}).datos.perfilCosteo === 'fuerte', null, { timeout: 25000 });
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
        await caso('«Ajustar porcentajes» abre los cinco tipos con su rango recomendado', async () => {
            const r = await p.evaluate(() => [document.getElementById('dlgPerfilesCosteo').open, [...document.querySelectorAll('#dlgPerfCuerpo .pf-nom b')].map(b => b.textContent), document.querySelector('#dlgPerfCuerpo .pf-fila[data-id="fuerte"] small').textContent]);
            assert.deepEqual(r.slice(0, 2), [true, ['Entradas', 'Platos fuertes', 'Postres', 'Bebidas y coctelería', 'General']]);
            assert.match(r[2], /Recomendado 42–45% de gasto operativo/);
        });
        await p.fill('#dlgPerfCuerpo .pf-fila[data-id="general"] [data-k="op"]', '38');
        await caso('…la utilidad objetivo se recalcula al teclear', async () =>
            assert.equal(await p.evaluate(() => document.querySelector('#dlgPerfCuerpo .pf-fila[data-id="general"] .pf-ut b').textContent), '32%'));
        await p.click('#dlgPerfGuardar'); await p.waitForTimeout(500);
        await caso('…al guardar va a costeo_config (solo lo que se aparta de la referencia) y la carátula se repinta', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('dlgPerfilesCosteo').open), false);
            const c = await celdas(p, 'Taco de Suadero');
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
        await caso('en bebidas: gasto 28% y utilidad objetivo 42% (Bebidas y coctelería)', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#caratulaDetalleBody .car-kpi b')].map(b => b.textContent)), ['30%', '28%', '42%']));

        /* El escandallo: el tipo y sus % en la sección de Costeo */
        await p.evaluate(() => { cerrarCaratulaBtnX(); if (typeof entrarEscandallos === 'function') entrarEscandallos(); if (typeof _showEscForm === 'function') _showEscForm(); cargarReceta('r4'); });
        await p.waitForTimeout(700);
        await p.evaluate(() => document.getElementById('seccionCostos').scrollIntoView({ block: 'center' }));
        await foto(p, 'c5-escandallo');
        await caso('el escandallo enseña el tipo (automático: Platos fuertes) y sus % en los campos vacíos', async () => {
            const r = await p.evaluate(() => [document.getElementById('s-perfil').selectedOptions[0].textContent, document.getElementById('s-food').placeholder, document.getElementById('s-op').placeholder, document.getElementById('s-util-obj').textContent, document.getElementById('s-pct-gasto').textContent, document.getElementById('a-pct-gasto').textContent]);
            assert.deepEqual(r, ['Automático · Platos fuertes', '30', '44', '26%', '44%', '44%']);
        });
        await p.selectOption('#s-perfil', 'entrada'); await p.fill('#s-food', '28'); await p.waitForTimeout(200);
        await caso('elegir otro tipo y una meta propia recalcula al momento', async () =>
            assert.deepEqual(await p.evaluate(() => [document.getElementById('s-pct-gasto').textContent, document.getElementById('s-util-obj').textContent, document.getElementById('s-pct-bruto').textContent]), ['33%', '39%', '28%']));
        await p.evaluate(() => guardarReceta()); await p.waitForTimeout(500);
        await caso('…y al guardar la receta se quedan su tipo y su meta', async () => {
            const r = await p.evaluate(() => { const x = getRecetas().find(r => r.id === 'r4'); return [x.perfilCosteo, Math.round(100 / x.multiploCosteo * 100) / 100, x.gastoOpPct]; });
            assert.deepEqual(r, ['entrada', 28, '']);
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
            assert.deepEqual(await q.evaluate(() => JSON.parse(localStorage.getItem('etaax_n1_costeo_cfg')).perfiles), { entrada: { food: 30, op: 31 } });
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
