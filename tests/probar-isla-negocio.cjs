/* LA ISLA DEL NEGOCIO, «SUB MÓDULOS» Y EL TÍTULO ARRIBA — en un navegador de verdad.

   Lo que se vigila (Edwin, 24-nov):
     · La franja del negocio es una isla de una línea: logo, sucursal con su pin
       y su giro. Sin el rótulo «Negocio / Sucursal activa» ni el plan (eso lo
       dice el menú de la cuenta).
     · El título de la pantalla sube a la isla, chico; el rótulo y el párrafo
       que lo acompañaban se quitan. El original se queda solo para lectores de
       pantalla, y si la pantalla cambia el título, la isla lo sigue.
     · «Cambiar sucursal» y «Cambiar módulo» son botones chicos que se expanden
       al tocarlos y despliegan sus opciones DEBAJO de ellos; Escape lo cierra
       todo y el botón vuelve a su tamaño.
     · «Información de sucursal» vive en el menú de la cuenta.
     · La barra lateral es el desplegable «Sub módulos»: no le quita ancho al
       contenido, se abre al tocarlo y se cierra al elegir, al tocar fuera o con
       Escape.
     · El hub: la misma isla, «Tu espacio de trabajo» dentro de ella, y las
       sucursales desplegadas bajo su botón.
     · En un teléfono no aparece desplazamiento a lo ancho.

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-isla-negocio.cjs */
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
function nube() {
    return {
        __auth: [{ id: 'u1', email: 'duena@etaax.prueba', password: 'x', meta: { nombre: 'Dueña' } }],
        negocios: [{ id: 'n1', usuario_id: 'u1', datos: { nombre: 'Café de prueba' } }],
        negocio_sucursales: [{ negocio_id: 'n1', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz', activa: true }, { id: 'suc_dos', nombre: 'Dos', activa: true }] } }],
        suscripciones: [{ negocio_id: 'n1', estado: 'activa', plan: null }],
        negocio_insumos: [], cortes: [], req_pedido: [], req_historial: [], permisos: []
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
async function abrir(browser, ancho) {
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
    await ctx.addInitScript(semilla(nube()));
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    return { ctx, page };
}
const ir = async (p, ruta) => { await p.goto(ORIGEN + ruta); await p.waitForFunction(() => document.getElementById('etxCtxTitulo') || document.querySelector('.hub-isla-titulo'), null, { timeout: 20000 }); await p.waitForTimeout(600); };

(async () => {
    const browser = await chromium.launch();
    try {
        const { ctx, page: p } = await abrir(browser);
        await ir(p, '/administrativo/diario.html');

        await caso('la isla del negocio: logo, sucursal con su pin y su giro — sin rótulo del negocio ni plan', async () => {
            const r = await p.evaluate(() => {
                const bar = document.querySelector('#ctxBar .etx-ctx-isla');
                const giro = EtaaxNegocio.giro(EtaaxNegocio.adivinarGiro('Restaurante bar')).nom;   // el giro de la sucursal, como lo nombra la app
                return { isla: !!bar, nombre: bar.querySelector('.ctx-neg-name').textContent.trim(), giro: bar.querySelector('.ctx-neg-tipo').textContent.trim() === giro ? 'el de la sucursal' : bar.querySelector('.ctx-neg-tipo').textContent,
                         marca: !!bar.querySelector('.etx-ctx-marca'), plan: !!bar.querySelector('.ctx-badge-plan'), info: !!document.getElementById('etxInfoSucursal'),
                         alto: Math.round(bar.getBoundingClientRect().height) };
            });
            assert.deepEqual([r.isla, r.nombre, r.giro, r.marca, r.plan, r.info], [true, 'Matriz', 'el de la sucursal', false, false, false], JSON.stringify(r));
            assert.ok(r.alto <= 60, 'la isla mide ' + r.alto + ' px de alto');
        });
        await caso('el título va a la orilla izquierda, la sucursal al CENTRO DE LA PÁGINA y los botones a la derecha', async () => {
            const r = await p.evaluate(() => {
                const t = document.getElementById('etxCtxTitulo').getBoundingClientRect(), id = document.querySelector('#ctxBar .etx-ctx-ident').getBoundingClientRect();
                const isla = document.querySelector('#ctxBar .etx-ctx-isla').getBoundingClientRect(), b = document.querySelector('#ctxBar .ctx-right').getBoundingClientRect();
                return { izq: t.left - isla.left < 24, centro: Math.abs((id.left + id.right) / 2 - innerWidth / 2) < 2, orden: t.right <= id.left && id.right <= b.left, derecha: isla.right - b.right < 12 };
            });
            assert.deepEqual(r, { izq: true, centro: true, orden: true, derecha: true });
        });
        await caso('«Cambiar sucursal» tiene su propio ícono (no el pin de junto al nombre)', async () =>
            assert.deepEqual(await p.evaluate(() => [!!document.querySelector('#etxCambiarSucursal use[href="#etx-sh-cambiar-sucursal"]'), !!document.querySelector('#etxCambiarSucursal use[href="#etx-sh-matriz"]')]), [true, false]));
        await caso('el título de la pantalla sube a la isla; su rótulo y su párrafo se quitan', async () => {
            const r = await p.evaluate(() => ({
                isla: document.getElementById('etxCtxTitulo').textContent, g: document.querySelector('#etxCtxTitulo .g').textContent,
                subido: document.querySelector('.dx-hero-title').classList.contains('etx-titulo-subido'),
                alto: Math.round(document.querySelector('.dx-hero-title').getBoundingClientRect().height),
                rotulo: getComputedStyle(document.querySelector('.dx-hero-eyebrow')).display, parrafo: getComputedStyle(document.querySelector('.dx-hero-sub')).display,
                hero: Math.round(document.querySelector('.dx-hero').getBoundingClientRect().height)
            }));
            assert.deepEqual([r.isla, r.g, r.subido, r.alto <= 1, r.rotulo, r.parrafo, r.hero], ['Ventas y Gastos Diarios', 'Diarios', true, true, 'none', 'none', 0]);
        });
        await caso('…y si la pantalla cambia su título, la isla lo sigue', async () => {
            await p.evaluate(() => { document.querySelector('.dx-hero-title').firstChild.textContent = 'Caja y Gastos '; });
            await p.waitForFunction(() => document.getElementById('etxCtxTitulo').textContent === 'Caja y Gastos Diarios');
        });
        await caso('«Sub módulos»: no le quita ancho al contenido y arranca cerrado (aunque la barra estuviera «plegada»)', async () => {
            const r = await p.evaluate(() => {
                const nav = document.getElementById('nav'), m = document.getElementById('mainContent');
                return { txt: nav.querySelector('#navToggleBtn .etx-sub-txt').textContent, abierto: nav.classList.contains('etx-sub-abierto'),
                         ancho: Math.round(nav.getBoundingClientRect().width), margen: parseFloat(getComputedStyle(m).marginLeft),
                         links: [...nav.querySelectorAll('a.nav-link')].filter(a => a.getClientRects().length).length };
            });
            assert.deepEqual([r.txt, r.abierto, r.margen, r.links], ['Sub módulos', false, 0, 0]);
            assert.ok(r.ancho < 230, 'el botón mide ' + r.ancho);
        });
        await caso('…se abre al tocarlo y se cierra con Escape', async () => {
            await p.click('#navToggleBtn');
            assert.equal(await p.evaluate(() => document.getElementById('nav').classList.contains('etx-sub-abierto') && document.querySelectorAll('#nav a.nav-link').length > 0 &&
                [...document.querySelectorAll('#nav a.nav-link')].every(a => a.getClientRects().length > 0)), true);
            assert.equal(await p.evaluate(() => document.getElementById('navToggleBtn').getAttribute('aria-expanded')), 'true');
            await p.keyboard.press('Escape');
            assert.equal(await p.evaluate(() => document.getElementById('nav').classList.contains('etx-sub-abierto')), false);
        });
        await caso('…y al tocar fuera', async () => {
            await p.click('#navToggleBtn');
            await p.mouse.click(640, 860);
            assert.equal(await p.evaluate(() => document.getElementById('nav').classList.contains('etx-sub-abierto')), false);
        });
        await caso('«Cambiar módulo»: se expande y despliega sus opciones debajo de él', async () => {
            await p.keyboard.press('Escape');
            await p.click('#etxCambiarModulo');
            const r = await p.evaluate(() => {
                const d = document.getElementById('etxModuleDialog'), b = document.getElementById('etxCambiarModulo');
                const rd = d.getBoundingClientRect(), rb = b.getBoundingClientRect();
                return { open: d.open, pop: d.classList.contains('etx-pop'), n: d.querySelectorAll('[data-modulo]').length, abierto: b.classList.contains('abierto'),
                         debajo: rd.top >= rb.bottom && rd.top - rb.bottom < 20, derecha: Math.abs(rd.right - rb.right) < 2, isla: !!d.querySelector('.etx-isla') };
            });
            assert.deepEqual(r, { open: true, pop: true, n: 5, abierto: true, debajo: true, derecha: true, isla: true });   // Cost·ax, Admin·ax, Fin·ax, Equip·ax, Learn·ax
        });
        await caso('…Escape lo cierra y el botón vuelve a su tamaño', async () => {
            await p.keyboard.press('Escape');
            await p.waitForFunction(() => !document.getElementById('etxModuleDialog').open);
            await p.waitForTimeout(100);
            assert.equal(await p.evaluate(() => document.getElementById('etxCambiarModulo').classList.contains('abierto')), false);
            assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), 'etxCambiarModulo');
        });
        await caso('«Cambiar sucursal»: «Actualizando…» y luego la lista, sin cerrarse ni perder lo expandido', async () => {
            await p.click('#etxCambiarSucursal');
            await p.waitForFunction(() => document.querySelectorAll('#etxModuleDialog [data-sucursal]').length === 2);
            await p.waitForTimeout(150);
            assert.deepEqual(await p.evaluate(() => [document.getElementById('etxModuleDialog').open, document.getElementById('etxModuleDialog').classList.contains('etx-pop'),
                document.getElementById('etxCambiarSucursal').classList.contains('abierto')]), [true, true, true]);
            await p.keyboard.press('Escape');
            await p.waitForFunction(() => !document.getElementById('etxModuleDialog').open);
        });
        await caso('«Información de sucursal» está en el menú de la cuenta y abre al centro', async () => {
            await p.click('#etxHdCuenta');
            await p.click('#etxHdInfoSucOp');
            const r = await p.evaluate(() => { const d = document.getElementById('etxModuleDialog'); return [d.open, d.classList.contains('etx-pop'), /555 123 4567/.test(d.textContent)]; });
            assert.deepEqual(r, [true, false, true]);
            await p.keyboard.press('Escape');
        });
        await caso('al bajar, entre la isla y las cabeceras fijas (Clientes, Insumos) no queda hueco por donde se asome el contenido', async () => {
            for (const ruta of ['/administrativo/clientes.html', '/recetas/insumos.html']) {
                await ir(p, ruta);
                await p.evaluate(() => { const m = document.getElementById('mainContent'); const d = document.createElement('div'); d.style.height = '2500px'; m.appendChild(d); });
                await p.mouse.move(640, 600); await p.mouse.wheel(0, 500); await p.waitForTimeout(400);
                /* La cabecera se pega bajo la franja; su sombra del color del fondo
                   cubre todo el hueco hasta la isla. */
                const r = await p.evaluate(() => {
                    const isla = document.querySelector('#ctxBar .etx-ctx-isla').getBoundingClientRect();
                    const el = [...document.querySelectorAll('#mainContent > .header')].find(x => x.getClientRects().length), h = el.getBoundingClientRect();
                    const n = getComputedStyle(el).boxShadow.replace(/rgba?\([^)]*\)/, '').trim().split(/\s+/).map(parseFloat);   // «0px -18px 0px 0px»
                    const banda = -(n[1] || 0);
                    return { hueco: Math.round(h.top - isla.bottom), banda };
                });
                assert.ok(r.hueco >= 0 && r.banda >= r.hueco, ruta + ': ' + JSON.stringify(r));
            }
        });
        await caso('Clientes e Inventarios: su título también sube a la isla', async () => {
            await ir(p, '/administrativo/clientes.html');
            assert.equal(await p.evaluate(() => document.getElementById('etxCtxTitulo').textContent), 'Clientes');
            await ir(p, '/recetas/inventarios.html');
            assert.equal(await p.evaluate(() => document.getElementById('etxCtxTitulo').textContent.trim().toLowerCase()), 'inventarios');
        });

        /* (24-nov) Las barras «Sub módulos» se arman de un solo lugar, con sus grupos.
           Equip·ax: Catálogo, Operativo (Horarios, Checklists), Evaluaciones y
           Estructura de staff. Admin·ax: Ingresos, Egresos, Gestión (vistas de Ventas
           y Gastos Diarios), Configuración (Cuentas bancarias y Previsiones, que viven
           en /financiero/) y Clientes. Proveedores se mudó a Cost·ax. */
        const barra = () => p.evaluate(() => [...document.querySelectorAll('#nav .nav-section > *')].map(x => x.classList.contains('etx-nav-grupo') ? '[' + x.textContent + ']' :
            ((x.querySelector('.nav-text') || x).textContent.trim() + (x.classList.contains('active') ? '*' : '') + (x.classList.contains('etx-nav-pronto') ? '(pronto)' : ''))).join(' · '));
        const EQUIPO = (act) => ['Catálogo', '[Operativo]', 'Horarios', 'Checklists', 'Evaluaciones', '[Estructura de staff]', 'Organigrama', 'Perfiles de puesto', 'Reglamento(pronto)']
            .map(x => x === act ? x + '*' : x).join(' · ');
        const ADMIN = (act) => ['Ingresos', 'Egresos', 'Gestión', '[Configuración]', 'Cuentas bancarias', 'Previsiones', 'Clientes'].map(x => x === act ? x + '*' : x).join(' · ');
        for (const [ruta, esperado] of [['/administrativo/horarios.html', EQUIPO('Horarios')], ['/administrativo/checklists.html', EQUIPO('Checklists')],
                                        ['/administrativo/diario.html?vista=egresos', ADMIN('Egresos')], ['/financiero/cuentas-bancarias.html', ADMIN('Cuentas bancarias')],
                                        ['/administrativo/proveedores.html', 'Escandallos · Insumos · Inventarios · Requisiciones · Proveedores*']]) {
            await ir(p, ruta);
            await caso('«Sub módulos» en ' + ruta + ': ' + esperado, async () => assert.equal(await barra(), esperado));
        }
        await ir(p, '/recetas/insumos.html');
        await caso('Cost·ax: sus páginas conservan su barra y ganan Proveedores', async () => {
            const b = await barra();
            assert.ok(/Insumos\*/.test(b) && / · Proveedores$/.test(b), b);
        });
        for (const [vista, titulo, fns] of [['ingresos', 'Ingresos', ['cortes', 'extras']], ['egresos', 'Egresos', ['gastos', 'depositos', 'fijos', 'nominas', 'mayores']], ['gestion', 'Gestión', ['caja']]]) {
            await ir(p, '/administrativo/diario.html?vista=' + vista);
            await caso('Admin·ax, ' + titulo + ': su título en la isla y SOLO sus tarjetas, en su orden', async () => {
                const r = await p.evaluate(() => ({ t: document.getElementById('etxCtxTitulo').textContent,
                    fns: [...document.querySelectorAll('.dx-card[data-fn]')].filter(b => b.offsetParent).sort((a, b) => (+getComputedStyle(a).order) - (+getComputedStyle(b).order)).map(b => b.dataset.fn),
                    reporte: !!document.querySelector('.dx-toolbar').offsetParent }));
                assert.deepEqual(r, { t: titulo, fns, reporte: vista === 'gestion' });
            });
        }
        await ir(p, '/administrativo/horarios.html');
        await caso('Equip·ax: «Cambiar módulo» lo marca como el módulo actual (Módulo 4)', async () => {
            await p.click('#etxCambiarModulo');
            const r = await p.evaluate(() => { const b = document.querySelector('#etxModuleDialog [data-modulo="equipo"]'); return b && [b.getAttribute('aria-current'), b.textContent.replace(/\s+/g, ' ').trim()]; });
            assert.ok(r && r[0] === 'true' && /Módulo 4/.test(r[1]) && /Equip·ax/.test(r[1]), JSON.stringify(r));
            await p.keyboard.press('Escape');
        });
        await ir(p, '/hub.html');
        await caso('hub: la misma isla, con «Tu espacio de trabajo» dentro y sin rótulo del negocio, plan ni «Información de sucursal»', async () => {
            const r = await p.evaluate(() => {
                const vis = (s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; };
                return { titulo: document.querySelector('#negActBar .hub-isla-titulo').textContent, marca: vis('#chipMarcaHub'), plan: vis('#userPlanChip'), info: vis('#btnInfoSuc'),
                         explora: !!document.querySelector('.hub-trabajo-hero'), pos: getComputedStyle(document.getElementById('negActBar')).position };
            });
            assert.deepEqual(r, { titulo: 'Tu espacio de trabajo', marca: false, plan: false, info: false, explora: false, pos: 'sticky' });
        });
        await caso('…«Información de sucursal» en el menú de la cuenta', async () => {
            await p.click('#etxHdCuenta');
            assert.equal(await p.evaluate(() => !!document.getElementById('etxHdInfoSucOp')), true);
            await p.keyboard.press('Escape');
        });
        await caso('…y las sucursales se despliegan bajo su botón, que se expande', async () => {
            await p.click('#btnCambiarSucursal');
            const r = await p.evaluate(() => {
                const m = document.getElementById('modalCambiarSucursal'), b = document.getElementById('btnCambiarSucursal');
                const rb = b.getBoundingClientRect(), rm = m.querySelector('.modal-box').getBoundingClientRect();
                return { abierto: m.style.display === 'flex', pop: m.classList.contains('hub-pop'), exp: b.classList.contains('abierto'), debajo: rm.top >= rb.bottom && rm.top - rb.bottom < 20 };
            });
            assert.deepEqual(r, { abierto: true, pop: true, exp: true, debajo: true });
            await p.keyboard.press('Escape');
            assert.equal(await p.evaluate(() => document.getElementById('btnCambiarSucursal').classList.contains('abierto')), false);
        });
        /* (24-nov) La rueda de módulos: el elegido siempre al centro. */
        const rueda = () => p.evaluate(() => {
            const dock = document.getElementById('hubModuloDock').getBoundingClientRect(), sel = document.querySelector('#hubModuloDock [aria-selected="true"]');
            const r = sel.getBoundingClientRect(), ir = document.getElementById('hubIrAlModulo').getBoundingClientRect();
            return { id: sel.dataset.modulo, centro: Math.abs((r.left + r.right) / 2 - (dock.left + dock.right) / 2) < 3,
                     irCentrado: Math.abs((ir.left + ir.right) / 2 - (r.left + r.right) / 2) < 3, irDebajo: ir.top >= r.bottom - 1 };
        });
        await p.evaluate(() => etaaxSeleccionarModulo('recetas')); await p.waitForTimeout(700);
        await caso('hub: la rueda deja al módulo elegido al centro, con «Ir al módulo» centrado debajo', async () =>
            assert.deepEqual(await rueda(), { id: 'recetas', centro: true, irCentrado: true, irDebajo: true }));
        await caso('…la flecha de la derecha gira al siguiente (y queda al centro)', async () => {
            await p.click('.hub-rueda-flecha[data-dir="1"]'); await p.waitForTimeout(700);
            assert.deepEqual(await rueda(), { id: 'administrativo', centro: true, irCentrado: true, irDebajo: true });
        });
        await caso('…es media luna: en el primero la flecha izquierda se apaga y no da la vuelta', async () => {
            await p.click('.hub-rueda-flecha[data-dir="-1"]'); await p.waitForTimeout(700);
            assert.equal((await rueda()).id, 'recetas');
            assert.equal(await p.evaluate(() => document.querySelector('.hub-rueda-flecha[data-dir="-1"]').disabled), true);
        });
        await caso('…y en el último se apaga la derecha', async () => {
            await p.evaluate(() => etaaxSeleccionarModulo('consultoria')); await p.waitForTimeout(700);
            assert.deepEqual(await p.evaluate(() => [document.querySelector('.hub-rueda-flecha[data-dir="1"]').disabled, document.querySelector('.hub-rueda-flecha[data-dir="-1"]').disabled]), [true, false]);
        });
        await caso('…debajo, centrado y sin ícono: el nombre del módulo y lo que se hace ahí', async () => {
            const r = await p.evaluate(() => {
                const sel = document.getElementById('hubModuloSelector').getBoundingClientRect(), t = document.getElementById('hubModuloTitulo').getBoundingClientRect();
                return { titulo: document.getElementById('hubModuloTitulo').textContent, desc: !!document.getElementById('hubModuloDescripcion').textContent.trim(),
                         centrado: Math.abs((t.left + t.right) / 2 - (sel.left + sel.right) / 2) < 3, icono: !!document.getElementById('hubModuloIcono').getClientRects().length };
            });
            assert.deepEqual(r, { titulo: 'Learn·ax', desc: true, centrado: true, icono: false });
        });
        await caso('…y arrastrar con el dedo hacia la izquierda trae el de la derecha', async () => {
            await p.evaluate(() => etaaxSeleccionarModulo('financiero')); await p.waitForTimeout(700);
            const c = await p.evaluate(() => { const r = document.getElementById('hubModuloDock').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
            await p.mouse.move(c.x, c.y); await p.mouse.down(); await p.mouse.move(c.x - 170, c.y, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(700);
            assert.deepEqual(await rueda(), { id: 'equipo', centro: true, irCentrado: true, irDebajo: true });
        });
        /* (24-nov) Las portadas de módulo: tarjetas bajitas en dos columnas, con su grupo adentro. */
        await ir(p, '/equipo/index.html');
        await caso('portada de Equip·ax: sin encabezados de sección, dos columnas y cada tarjeta con su grupo', async () => {
            const r = await p.evaluate(() => {
                const cards = [...document.querySelectorAll('.etx-portada-modulos .cf-card')].filter(c => c.offsetParent);
                const xs = [...new Set(cards.map(c => Math.round(c.getBoundingClientRect().left)))];
                return { encabezados: [...document.querySelectorAll('.cf-section-hdr')].some(h => h.offsetParent), columnas: xs.length,
                         grupos: cards.map(c => (c.querySelector('.etx-card-grupo') || {}).textContent).join(','), alto: Math.max.apply(null, cards.map(c => c.getBoundingClientRect().height)) };
            });
            assert.equal(r.encabezados, false); assert.equal(r.columnas, 2);
            assert.equal(r.grupos, 'Personal,Operativo,Operativo,Desarrollo,Estructura de staff,Estructura de staff,Estructura de staff');
            assert.ok(r.alto <= 160, 'tarjeta de ' + r.alto + ' px');
        });
        /* (24-nov) Centrado de verdad y la foto del negocio solo en el botón de la cuenta. */
        await p.evaluate(() => localStorage.setItem('etaax_n1_logo', 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#c0442a"/></svg>')));
        await p.goto(ORIGEN + '/hub.html?negocios=1'); await p.waitForFunction(() => document.querySelector('#brandInfoBar .hub-isla-ident'), null, { timeout: 20000 }); await p.waitForTimeout(600);
        await caso('hub, página del negocio: la isla con su título, el negocio centrado en la página y su foto SOLO en la cuenta', async () => {
            const r = await p.evaluate(() => {
                const id = document.querySelector('#brandInfoBar .hub-isla-ident'), lg = id.querySelector('.neg-activo-emoji-wrap').getBoundingClientRect(), nm = id.querySelector('.neg-activo-nombre').getBoundingClientRect();
                return { titulo: document.getElementById('negIslaTitulo').textContent.trim().toLowerCase(), centro: Math.abs((lg.left + nm.right) / 2 - innerWidth / 2) < 2,
                         islaFoto: !!document.querySelector('#brandInfoBar img'), cuentaFoto: !!document.querySelector('#etaax-header .etx-hd-avatar img'),
                         tituloGrande: !!document.getElementById('negHeroTitle').getClientRects().length };
            });
            assert.deepEqual(r, { titulo: 'administra tus sucursales', centro: true, islaFoto: false, cuentaFoto: true, tituloGrande: false });
        });
        await caso('hub: el botón «Inicio» de arriba y el negocio de la isla, los dos al centro de la página', async () => {
            const r = await p.evaluate(() => { const c = document.querySelector('#etaax-header .etx-hd-centro').getBoundingClientRect(); return Math.abs((c.left + c.right) / 2 - document.documentElement.clientWidth / 2) < 1.5; });
            assert.equal(r, true);
        });
        await ir(p, '/recetas/inventarios.html');
        await caso('módulo: «Módulos» (con Atrás y Adelante) al centro de la página, justo arriba de la sucursal', async () => {
            const r = await p.evaluate(() => {
                const c = document.querySelector('#etaax-header .etx-hd-centro').getBoundingClientRect(), id = document.querySelector('.etx-ctx-ident');
                const lg = id.querySelector('.ctx-neg-emoji-wrap').getBoundingClientRect(), nm = id.querySelector('.ctx-neg-name span').getBoundingClientRect();
                return Math.abs((c.left + c.right) / 2 - (lg.left + nm.right) / 2) < 1.5;
            });
            assert.equal(r, true);
        });
        await caso('módulo: la sucursal centrada del círculo a la última letra del nombre, y la foto del negocio solo en la cuenta', async () => {
            const r = await p.evaluate(() => {
                const id = document.querySelector('.etx-ctx-ident'), lg = id.querySelector('.ctx-neg-emoji-wrap').getBoundingClientRect(), nm = id.querySelector('.ctx-neg-name span').getBoundingClientRect();
                return { centro: Math.abs((lg.left + nm.right) / 2 - innerWidth / 2) < 2, islaFoto: !!id.querySelector('img'), cuentaFoto: !!document.querySelector('#etaax-header .etx-hd-avatar img') };
            });
            assert.deepEqual(r, { centro: true, islaFoto: false, cuentaFoto: true });
        });
        await ctx.close();

        /* (24-nov) El centrado automático no depende de un ancho fijo: a 1024 px también. */
        const med = await abrir(browser, 1024), pm = med.page;
        for (const ruta of ['/recetas/inventarios.html', '/hub.html?negocios=1']) {
            await pm.goto(ORIGEN + ruta); await pm.waitForFunction(() => document.querySelector('.etx-ctx-ident, #brandInfoBar .hub-isla-ident'), null, { timeout: 20000 }); await pm.waitForTimeout(800);
            await caso('a 1024 px, ' + ruta + ': el botón de arriba y la sucursal/negocio al centro de la página (y centrados de alto)', async () => {
                const r = await pm.evaluate(() => {
                    const W = document.documentElement.clientWidth / 2, hd = document.querySelector('#etaax-header .etx-hd-centro').getBoundingClientRect();
                    const id = [...document.querySelectorAll('.etx-ctx-ident, .hub-isla-ident')].find(e => e.getClientRects().length);
                    const lg = id.querySelector('.ctx-neg-emoji-wrap, .neg-activo-emoji-wrap').getBoundingClientRect(), nm = id.querySelector('.ctx-neg-name span, .neg-activo-nombre').getBoundingClientRect();
                    const isla = id.closest('.etx-ctx-isla, .hub-modulos-bar').getBoundingClientRect();
                    return { arriba: Math.abs((hd.left + hd.right) / 2 - W) < 1.5, isla: Math.abs((lg.left + nm.right) / 2 - W) < 1.5, alto: Math.abs((lg.top + lg.bottom) / 2 - (isla.top + isla.bottom) / 2) < 2 };
                });
                assert.deepEqual(r, { arriba: true, isla: true, alto: true });
            });
        }
        await med.ctx.close();

        const tel = await abrir(browser, 390);
        for (const ruta of ['/administrativo/diario.html', '/administrativo/clientes.html', '/hub.html']) {
            await ir(tel.page, ruta);
            await caso('teléfono (390 px), ' + ruta + ': sin desplazamiento a lo ancho', async () =>
                assert.equal(await tel.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true));
        }
        await tel.ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log('\n' + (malos.length ? '🚨 ISLA DEL NEGOCIO EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '🔒 ISLA DEL NEGOCIO EN NAVEGADOR OK — ' + resultados.length + ' casos'));
    process.exit(malos.length ? 1 : 0);
})();
