/* VENTA POR APPS — el recorrido completo en un navegador de verdad:
     1. el DUEÑO: cada sucursal enseña sus apps (Cost·ax, paquete…), dentro de
        una sucursal solo ve lo que contrató (lo demás ni aparece), page-guard no
        lo deja entrar por un enlace, y desde Plan y facturación pide agregar
        apps o pasarse a anual;
     2. el ADMIN: ve el plan de cada negocio, activa esa solicitud, edita el plan
        a mano, cobra un año de un jalón e invita a un negocio nuevo con apps.

   La regla de la base (negocio_plan, el trigger de la invitación) se prueba
   aparte contra Postgres: tests/probar-sql-v89.mjs. Los precios, en BH87.

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-planes-apps.cjs */
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
const PLAN0 = { sucursales: { suc_principal: ['costax'], suc_tul: 'suite' } };
const NUBE = {
    __auth: [{ id: 'u1', email: 'duena@etaax.prueba', password: 'Clave2026x', meta: { nombre: 'Dueña' } },
             { id: 'adm', email: 'admin@etaax.com', password: 'x' }],
    usuarios: [{ id: 'u1', nombre: 'Dueña', plan: 'gran' }],
    negocios: [{ id: 'A', usuario_id: 'u1', datos: { nombre: 'EGMx', tipo: 'bar' } }],
    negocio_sucursales: [{ negocio_id: 'A', datos: { sucursales: [
        { id: 'suc_principal', nombre: 'Matriz', activa: true, fechaCreado: '2026-01-01' },
        { id: 'suc_tul', nombre: 'Tulum', activa: true, fechaCreado: '2026-02-01' }] } }],
    suscripciones: [{ negocio_id: 'A', estado: 'activa', proximo_cobro: '2026-12-31', dia_cobro: 31, dias_tolerancia: 3, plan: PLAN0 }],
    staff: [], permisos: [], solicitudes_plan: [], invitaciones: [], catalogo_proveedores: []
};
function semilla(nube, sesion) {
    return `(() => {
        window.__avisos = [];
        window.alert = m => { __avisos.push(String(m)); };
        window.confirm = m => { __avisos.push('¿' + String(m)); return true; };
        window.prompt = m => { __avisos.push('? ' + String(m)); return ''; };
        if (!localStorage.getItem('__sembrado')) {
            localStorage.clear();
            localStorage.setItem('__nube', ${JSON.stringify(JSON.stringify(nube))});
            localStorage.setItem('etaax_novedades_vista', '{}');
            localStorage.setItem('__sembrado', '1');
        }
        ${sesion ? `if (!sessionStorage.getItem('__ses0')) { sessionStorage.setItem('__ses0', '1'); sessionStorage.setItem('__ses', ${JSON.stringify(JSON.stringify(sesion))}); }` : ''}
    })();`;
}
async function contexto(browser, nube, sesion) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
    await ctx.addInitScript(semilla(nube, sesion));
    const page = await ctx.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    return { ctx, page };
}
const texto = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel).then(t => t.replace(/\s+/g, ' '));
/* SHOTS=<carpeta>: capturas de cada pantalla para revisarlas a ojo. */
const foto = (page, nombre) => process.env.SHOTS ? page.waitForTimeout(1200).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png'), fullPage: true })) : null;
const nubeDe = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('__nube')));

(async () => {
    const browser = await chromium.launch();
    let nube = null;
    try {
        /* ══ 1) El dueño ══ */
        console.log('\n══ Apps por sucursal · el dueño ══');
        const { page } = await contexto(browser, NUBE, { id: 'u1', email: 'duena@etaax.prueba', meta: { nombre: 'Dueña' } });
        await page.goto(ORIGEN + '/hub.html');
        await page.waitForFunction(() => document.getElementById('viewNegocios').style.display !== 'none' &&
            [...document.querySelectorAll('#listSucursales .neg-card-apps')].some(x => /Cost/.test(x.textContent)), null, { timeout: 15000 });
        await caso('cada sucursal enseña sus apps (y el plan se bajó de la nube)', async () => {
            const apps = await page.evaluate(() => [...document.querySelectorAll('#listSucursales .suc-caja')].map(c =>
                c.querySelector('.neg-card-nombre').textContent.replace(/\s+/g, ' ').trim().replace(/ Matriz$/, '') + ' → ' + c.querySelector('.neg-card-apps').textContent));
            assert.deepEqual(apps, ['Matriz → Cost·ax', 'Tulum → Paquete completo']);
        });
        await caso('el resumen cobra por apps con la escalera: $899 + $1,699', async () =>
            assert.match(await texto(page, '#sucPlanSub'), /plan actual: \$2,598 MXN\/mes/));
        await caso('el anuncio de sucursal nueva dice desde cuánto con una app', async () =>
            assert.match(await texto(page, '#sucPitch'), /3ª sucursal: desde \$\d{3} MXN\/mes con una app, o \$1,669 con el paquete completo/));
        await foto(page, 'p1-sucursales');
        await Promise.all([page.waitForNavigation(), page.evaluate(() => entrarSucursal('suc_principal', 'A'))]);
        await page.waitForFunction(() => document.getElementById('viewModulos').style.display !== 'none' && document.querySelector('#hubModuloDock [data-modulo]:not([hidden])'));
        await page.waitForTimeout(500);
        /* (24-nov) Equip·ax es módulo propio. Su catálogo de colaboradores va en
           TODOS los planes (es lo que da acceso a la gente), así que Equip·ax se
           ve aun sin la app; Admin·ax (todo de Fin·ax) ya no. */
        await caso('en la Matriz (solo Cost·ax) el dock NO trae Fin·ax ni Admin·ax: ni apagados, simplemente no están', async () => {
            const vis = await page.evaluate(() => [...document.querySelectorAll('#hubModuloDock [data-modulo]')].filter(t => !t.hidden).map(t => t.dataset.modulo));
            assert.deepEqual(vis, ['recetas', 'equipo', 'consultoria']);
            assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('hub-tab-financiero')).display), 'none');
            assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('hub-tab-administrativo')).display), 'none');
        });
        await caso('…y Equip·ax queda con su guía del equipo (sin «Sin acceso para tu rol»)', async () => {
            await page.evaluate(() => etaaxSeleccionarModulo('equipo'));
            const filas = await page.evaluate(() => [...document.querySelectorAll('#hubHerramientasTarjetas .hub-tool-fila h3')].map(h => h.textContent));
            assert.deepEqual(filas, ['Gestión del equipo']);
            assert.equal(await page.evaluate(() => document.body.innerText.indexOf('Sin acceso para tu rol')), -1);
        });
        await caso('…y Cost·ax trae Proveedores (se mudó de Admin·ax; con Cost·ax solo, también se ve)', async () => {
            await page.evaluate(() => etaaxSeleccionarModulo('recetas'));
            const filas = await page.evaluate(() => [...document.querySelectorAll('#hubHerramientasTarjetas .hub-tool-fila h3')].map(h => h.textContent));
            assert.deepEqual(filas, ['Escandallos', 'Insumos', 'Inventarios', 'Requisiciones', 'Proveedores']);
        });
        await caso('los módulos se numeran por lo que se ve', async () =>
            assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#hubModuloDock [data-modulo]:not([hidden]) .hub-module-numero')].map(x => x.textContent)),
                ['Módulo 1', 'Módulo 2', 'Módulo 3']));
        await caso('el menú de la cuenta dice qué apps tiene la sucursal', async () =>
            assert.match(await page.evaluate(() => document.getElementById('etaax-header').textContent.replace(/\s+/g, ' ')), /Cost·ax/));
        await caso('pagar nómina es de Equip·ax: en la Matriz no, en Tulum (paquete) sí', async () => {
            assert.equal(await page.evaluate(() => etaaxPuedeSub('gastos', 'nominas')), false);
            assert.equal(await page.evaluate(() => etaaxPermEnPlan('A', 'suc_tul', 'gastos', 'nominas')), true);
        });
        await page.goto(ORIGEN + '/equipo/index.html'); await page.waitForTimeout(1500);
        await caso('la portada de Equip·ax sin la app: solo el catálogo de colaboradores (lo de RH no se enseña)', async () => {
            assert.match(page.url(), /\/equipo\/index\.html/);
            const vis = await page.evaluate(() => [...document.querySelectorAll('.cf-card[data-perm]')].filter(a => a.offsetParent).map(a => a.dataset.perm));
            assert.deepEqual(vis, ['verCatalogo']);
        });
        await page.goto(ORIGEN + '/financiero/kpis.html'); await page.waitForURL(/hub\.html/, { timeout: 8000 }).catch(() => {});
        await caso('un enlace directo a Salud financiera regresa al hub, también al dueño', async () => assert.match(page.url(), /hub\.html/));
        await page.waitForTimeout(800);
        await page.goto(ORIGEN + '/administrativo/horarios.html'); await page.waitForURL(/hub\.html/, { timeout: 8000 }).catch(() => {});
        await caso('…y a Horarios (Equip·ax), aunque el catálogo de colaboradores sí se puede', async () => assert.match(page.url(), /hub\.html/));
        await page.waitForTimeout(800);

        /* Plan y facturación */
        await page.goto(ORIGEN + '/plan-facturacion.html');
        await page.waitForFunction(() => document.querySelector('.cuenta-table .plan-apps'), null, { timeout: 15000 });
        await caso('Plan y facturación: las apps de cada sucursal con su precio', async () => {
            const t = await texto(page, '#planContenido');
            assert.match(t, /Matriz Cost·ax \$899\.00/);
            assert.match(t, /Tulum Paquete completo \$1,699\.00/);
            assert.match(t, /Total mensual \$2,598\.00/);
        });
        await caso('con un plan por apps no se ofrece la tarjeta (en Stripe solo existe el paquete mensual)', async () => {
            assert.equal(await page.evaluate(() => !!document.getElementById('planPagar')), false);
            assert.match(await texto(page, '#planContenido'), /El pago con tarjeta para planes por app/);
        });
        await page.click('#planCambiar'); await page.waitForTimeout(200);
        await page.click('#planApps_0 input[value="finax"]');
        await page.click('input[name="planCiclo"][value="anual"]'); await page.waitForTimeout(200);
        await foto(page, 'p2-plan-editor');
        await caso('el editor dice cuánto paga hoy y cuánto con el cambio (anual: paga 9)', async () =>
            assert.match(await texto(page, '#planResumen'), /Hoy pagas \$2,598\.00 al mes · con el cambio: \$31,482\.00 al año \(ahorras \$10,494\.00\)/));
        await caso('…y avisa que Cost·ax + Fin·ax ya cuesta lo mismo que el paquete', async () =>
            assert.match(await texto(page, '#planApps_0'), /Por ese precio te llevas el paquete completo/));
        await page.click('#planEnviar'); await page.waitForTimeout(500);
        await caso('«Enviar solicitud» la deja en revisión con el plan pedido (no cambia nada todavía)', async () => {
            const n = await nubeDe(page);
            const sol = n.solicitudes_plan.find(x => x.datos.tipo === 'apps');
            assert.ok(sol, 'sin solicitud');
            assert.deepEqual([sol.datos.estado, sol.datos.planNuevo.ciclo, sol.datos.planNuevo.sucursales.suc_principal, sol.datos.costoNuevo],
                ['pendiente', 'anual', ['costax', 'finax'], 31482]);
            assert.deepEqual(n.suscripciones[0].plan, PLAN0);
            assert.match(await texto(page, '#planContenido'), /mandamos tu solicitud/);
        });
        nube = await nubeDe(page);

        /* ══ 2) El admin ══ */
        console.log('\n══ Apps por sucursal · el admin ══');
        const s2 = await contexto(browser, nube, { id: 'adm', email: 'admin@etaax.com' });
        const pa = s2.page;
        await pa.goto(ORIGEN + '/admin.html');
        await pa.waitForFunction(() => document.getElementById('viewAdmin').style.display === 'block' && window._admCargado, null, { timeout: 15000 });
        await foto(pa, 'p0-admin-portada');
        /* (27-nov) ETAAX como negocio: la portada es el hub de una sucursal, a nivel SaaS. */
        const esp = () => pa.evaluate(() => ({ tabs: [...document.querySelectorAll('.adm-esp-tab')].map(t => t.dataset.area + (t.getAttribute('aria-selected') === 'true' ? '*' : '')),
            tit: (document.querySelector('.adm-esp-cab-tit') || {}).textContent, num: (document.querySelector('.adm-esp-cab-num') || {}).textContent,
            cards: [...document.querySelectorAll('.adm-area:not([hidden]) .adm-card')].map(c => c.dataset.card),
            centro: (() => { const d = document.getElementById('admEspDock').getBoundingClientRect(), t = document.querySelector('.adm-esp-tab[aria-selected="true"]').getBoundingClientRect(); return Math.abs((t.left + t.right) / 2 - (d.left + d.right) / 2) < 3; })() }));
        await caso('ESPACIO ETAAX: la isla «Espacio de trabajo · ETAAX», como la de una sucursal', async () =>
            assert.deepEqual(await pa.evaluate(() => [document.querySelector('.adm-isla-tit').textContent, document.querySelector('.adm-isla-neg b').textContent, !!document.querySelector('.adm-isla-neg img')]),
                ['Espacio de trabajo', 'ETAAX', true]));
        await caso('…la media luna con las cuatro áreas; arranca en la del CENTRO (Ingresos), al centro, con sus herramientas abajo', async () =>
            assert.deepEqual(await esp(), { tabs: ['clientes', 'ingresos*', 'catalogos', 'plataforma'], tit: 'Ingresos', num: 'Área 2 · activa', cards: ['tablero', 'documentos', 'presupuesto'], centro: true }));
        await caso('…cada herramienta con su grupo y el óvalo «Abrir» a la derecha (como las portadas de módulo)', async () =>
            assert.deepEqual(await pa.evaluate(() => [...document.querySelectorAll('.adm-area:not([hidden]) .adm-card')].map(c => c.querySelector('.adm-card-grupo').textContent + ' · ' + c.querySelector('.adm-card-tit').textContent + ' · ' + c.querySelector('.adm-card-cta').textContent)),
                ['Resultados · Tablero de ingresos · Abrir', 'Documentos · Historial de recibos · Abrir', 'Documentos · Presupuesto / recibo · Crear']));
        await pa.click('.adm-esp-flecha[data-dir="1"]'); await pa.waitForTimeout(650); await pa.click('.adm-esp-flecha[data-dir="1"]'); await pa.waitForTimeout(650);
        await caso('…las flechas la giran y tiene TOPE en Plataforma (no da la vuelta)', async () => {
            const r = await esp();
            assert.deepEqual([r.tabs, r.cards, r.centro, await pa.evaluate(() => document.querySelector('.adm-esp-flecha[data-dir="1"]').disabled)],
                [['clientes', 'ingresos', 'catalogos', 'plataforma*'], ['auditores', 'app', 'guias-movil', 'guias-web', 'migrar', 'auditar', 'papelera'], true, true]);
        });
        await pa.click('.adm-esp-tab[data-area="catalogos"]'); await pa.waitForTimeout(650);
        await caso('…tocar el área de al lado la trae al centro: Catálogos con sus tres herramientas', async () => {
            const r = await esp(); assert.deepEqual([r.tabs, r.cards, r.centro], [['clientes', 'ingresos', 'catalogos*', 'plataforma'], ['insumos', 'proveedores', 'rrhh'], true]);
        });
        await pa.evaluate(() => admArea('clientes')); await pa.waitForTimeout(650);
        await caso('…Clientes con sus seis herramientas (negocios activos y nuevos clientes)', async () =>
            assert.deepEqual((await esp()).cards, ['negocios', 'usuarios', 'staff', 'solicitudes', 'invitaciones', 'por-activar']));
        await caso('…las tarjetas de las otras áreas siguen en la página (escondidas), con sus cuentas', async () =>
            assert.deepEqual(await pa.evaluate(() => [document.querySelectorAll('.adm-card').length, !!document.querySelector('.adm-area[hidden] .adm-card[data-card="migrar"]'),
                (document.querySelector('.adm-card[data-card="solicitudes"] .adm-chip') || {}).textContent]), [19, true, '1 pendiente'], JSON.stringify(await pa.evaluate(() => [document.querySelectorAll('.adm-card').length, (document.querySelector('.adm-card[data-card="solicitudes"] .adm-chip') || {}).textContent]))));
        await pa.evaluate(() => { switchTab('migrar'); admInicio(); }); await pa.waitForTimeout(250);
        await caso('…abrir una herramienta y volver deja la portada en SU área (Plataforma)', async () =>
            assert.equal((await esp()).tit, 'Plataforma'));
        await pa.setViewportSize({ width: 390, height: 844 }); await pa.waitForTimeout(500);
        await foto(pa, 'p0b-admin-telefono');
        await caso('…en el teléfono: sin desbordarse a lo ancho, la rueda adentro y las herramientas en una columna', async () => {
            const r = await pa.evaluate(() => { const cs = [...document.querySelectorAll('.adm-area:not([hidden]) .adm-card')].map(c => Math.round(c.getBoundingClientRect().left));
                const sel = document.getElementById('admEspSelector').getBoundingClientRect();
                return [document.documentElement.scrollWidth <= innerWidth + 1, sel.right <= innerWidth + 1, new Set(cs).size]; });
            assert.deepEqual(r, [true, true, 1]);
        });
        await pa.setViewportSize({ width: 1280, height: 900 }); await pa.waitForTimeout(400);
        await pa.evaluate(() => switchTab('negocios')); await pa.waitForTimeout(300);
        await caso('la lista de negocios dice el plan de cada uno', async () =>
            assert.match(await texto(pa, '#tbodyNegocios'), /Cost·ax \(1\) · Paquete completo \(1\) · mensual/));
        await pa.evaluate(() => switchTab('solicitudes')); await pa.waitForTimeout(300);
        await caso('la solicitud de cambio de apps sale con lo que paga hoy y lo que pagaría', async () =>
            assert.match(await texto(pa, '#tbodySolicitudes'), /Cambio de apps.*\$2,598\/mes → \$31,482\/año/));
        await pa.click('#tbodySolicitudes button >> text=Activar cambio'); await pa.waitForTimeout(200);
        await pa.click('[data-adm-dialog] [data-act="yes"]'); await pa.waitForTimeout(700);
        await caso('activarla pone el plan pedido en la suscripción', async () => {
            const n = await nubeDe(pa);
            assert.deepEqual(n.suscripciones[0].plan.sucursales.suc_principal, ['costax', 'finax']);
            assert.equal(n.suscripciones[0].plan.ciclo, 'anual');
            assert.equal(n.solicitudes_plan.find(x => x.datos.tipo === 'apps').datos.estado, 'activada');
        });
        await pa.evaluate(() => { document.querySelectorAll('[data-adm-dialog]').forEach(d => d.remove()); switchTab('negocios'); }); await pa.waitForTimeout(300);
        await caso('con plan anual, el botón de activar cobra un año', async () =>
            assert.match(await texto(pa, '#tbodyNegocios'), /\+1 año/));
        await pa.evaluate(() => activarSuscripcion('A')); await pa.waitForTimeout(500);
        await caso('…y mueve el corte doce meses de un jalón, con su mismo día', async () =>
            assert.equal(String((await nubeDe(pa)).suscripciones[0].proximo_cobro), '2027-12-31'));
        await pa.evaluate(() => abrirDetalleNegocio('A')); await pa.waitForTimeout(300);
        await caso('el detalle del negocio enseña el plan por sucursal', async () => {
            const t = await pa.evaluate(() => document.getElementById('detailBody').textContent.replace(/\s+/g, ' '));
            assert.match(t, /Plan y apps\s*Matriz\s*Cost·ax \+ Fin·ax\s*\$1,799\/mes\s*Tulum\s*Paquete completo\s*\$1,699\/mes/, t.slice(t.indexOf('Plan y apps'), t.indexOf('Plan y apps') + 160));
        });
        await pa.click('#detailBody >> text=Editar plan y apps'); await pa.waitForTimeout(250);
        await foto(pa, 'p3-admin-editor');
        await pa.click('#admpApps_0 input[value="equipax"]'); await pa.waitForTimeout(150);
        await pa.click('#admpGuardar'); await pa.waitForTimeout(500);
        await caso('editar a mano: las tres apps en la Matriz se guardan como paquete completo', async () => {
            const p = (await nubeDe(pa)).suscripciones[0].plan;
            assert.equal(p.sucursales.suc_principal, 'suite');
            assert.equal(p.ciclo, 'anual');
            assert.equal(await pa.evaluate(() => !!document.querySelector('.admp-ov')), false);
        });
        /* (v92) La app móvil se activa por sucursal, aquí, como las apps. */
        await pa.evaluate(() => abrirDetalleNegocio('A')); await pa.waitForTimeout(250);
        await caso('«App móvil» en el detalle: el negocio nace sin app en ninguna sucursal', async () => {
            const t = await pa.evaluate(() => document.getElementById('detailBody').textContent.replace(/\s+/g, ' '));
            assert.match(t, /App móvil.*Matriz\s*Sin app móvil\s*Activar\s*Tulum\s*Sin app móvil\s*Activar/);
        });
        await pa.click('#detailBody .admm-tgl >> nth=0'); await pa.waitForTimeout(400);
        await foto(pa, 'p3b-admin-movil');
        await caso('activar la Matriz la guarda en movil_acceso (Tulum sigue sin app) y el detalle lo dice', async () => {
            const m = ((await nubeDe(pa)).movil_acceso || [])[0] || {};
            assert.deepEqual([m.negocio_id, m.datos && m.datos.sucursales], ['A', { suc_principal: true, suc_tul: false }]);
            const t = await pa.evaluate(() => document.getElementById('detailBody').textContent.replace(/\s+/g, ' '));
            assert.match(t, /Matriz\s*Activa\s*Apagar\s*Tulum\s*Sin app móvil\s*Activar/);
        });
        await pa.evaluate(() => { cerrarDetail(); switchTab('invitaciones'); }); await pa.waitForTimeout(400);
        await caso('una invitación sin elegir nada nace con el paquete completo', async () =>
            assert.match(await texto(pa, '#invPlanResumen'), /Paquete completo · \$1,799\/mes · mensual/));
        await pa.click('text=Elegir apps y forma de pago'); await pa.waitForTimeout(250);
        await pa.click('#admpApps_0 input[value="finax"]'); await pa.click('#admpApps_0 input[value="equipax"]');
        await pa.click('input[name="admpCiclo"][value="anual"]'); await pa.waitForTimeout(150);
        await pa.click('#admpGuardar'); await pa.waitForTimeout(250);
        await caso('elegir solo Cost·ax y anual queda en el resumen', async () =>
            assert.match(await texto(pa, '#invPlanResumen'), /Cost·ax · \$899\/mes · anual \$8,091/));
        await pa.fill('#invEmail', 'nuevo@negocio.mx'); await pa.fill('#invNegocio', 'Barra Nueva');
        await pa.click('#invBtn'); await pa.waitForTimeout(600);
        await caso('la invitación se guarda con su plan (la v89 se lo pasa al negocio al usarla)', async () => {
            const inv = (await nubeDe(pa)).invitaciones.find(i => i.email === 'nuevo@negocio.mx');
            assert.ok(inv, 'sin invitación');
            assert.deepEqual([inv.plan.ciclo, inv.plan.base], ['anual', ['costax']]);
            assert.match(await texto(pa, '#invPlanResumen'), /Paquete completo/);   // el formulario vuelve al paquete
        });

        /* ══ 3) Recibos: editar con el MISMO generador, eliminar y restaurar (v95) ══ */
        console.log('\n══ Recibos y presupuestos · editar y eliminar ══');
        await pa.evaluate(() => {
            const db = window.__nube.leer();
            const cfg = { tipo: 'recibo', negocioId: 'A', estado: 'pagado', meses: 1, periodoDesde: '2026-11-01', recurrenteMonto: 1799, negocio: 'EGMx',
                sucursal: 'Matriz', sucs: [{ id: 'suc_principal', nombre: 'Matriz', logo: '' }], cliente: '', susOn: true, modo: 'paquete', nSucs: 1, indice: 1,
                susMonto: 1799, extras: [{ concepto: 'Consultoría', monto: 900 }], total: 2699, totalManual: false, fecha: '2026-11-23', iva: true, notas: '',
                folio: 'REC-20261125-29BD7408', periodo: 'Noviembre 2026', metodo: 'Transferencia', fpago: '2026-11-25', ref: '', razonRec: 'EL MIAMI', vig: 30, anual: true };
            const hoy = new Date(), mes = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
            db.admin_documentos = [
                { id: 'd1', folio: cfg.folio, tipo: 'recibo', estado: 'pagado', cliente_negocio_id: 'A', cliente: 'EL MIAMI', fecha: mes + '-02', total: 2699, moneda: 'MXN',
                  suscripcion_monto: 1799, meses: 1, periodo_desde: mes + '-01', fecha_pago: mes + '-03', metodo: 'Transferencia', referencia: '', origen: 'generado',
                  presupuesto_id: null, version: 1, created_at: mes + '-02', datos: cfg, html: '<html>viejo</html>', cambios: [{ fecha: '2026-11-25T00:00:00Z', accion: 'creado' }] },
                { id: 'd2', folio: 'ARCH-1', tipo: 'recibo', estado: 'pagado', cliente_negocio_id: null, cliente: 'Recibo viejo', fecha: '2026-10-01', total: 900, moneda: 'MXN',
                  suscripcion_monto: null, meses: 1, periodo_desde: null, fecha_pago: '2026-10-02', metodo: '', referencia: '', origen: 'pdf_recuperado', version: 1,
                  created_at: '2026-10-01', datos: { archivo: 'x.pdf' }, html: '', pdf_base64: 'JVBERi0=', cambios: [] },
                /* (27-nov) Uno de SERVICIOS (sin suscripción: importe 0) y un PRESUPUESTO. */
                { id: 'd3', folio: 'REC-SERV-1', tipo: 'recibo', estado: 'pagado', cliente_negocio_id: 'A', cliente: 'TATA MEZCALERIA', fecha: '2026-10-05', total: 3000, moneda: 'MXN',
                  suscripcion_monto: 0, meses: 1, periodo_desde: '2026-10-01', fecha_pago: '2026-10-05', metodo: 'Transferencia', referencia: '', origen: 'generado', version: 1,
                  created_at: '2026-10-05', datos: { tipo: 'recibo' }, html: '<html><body><h1>Servicio de consultoría</h1></body></html>', cambios: [] },
                { id: 'd4', folio: 'PRE-1', tipo: 'presupuesto', estado: 'pendiente', cliente_negocio_id: null, cliente: 'YA TE LA FORTY SIX', fecha: '2026-10-07', total: 1799, moneda: 'MXN',
                  suscripcion_monto: 1799, meses: 1, periodo_desde: '2026-11-01', fecha_pago: null, metodo: '', referencia: '', origen: 'generado', version: 1,
                  created_at: '2026-10-07', datos: { tipo: 'presupuesto' }, html: '<html><body><h1>Presupuesto</h1></body></html>', cambios: [] }];
            window.__nube.escribir(db);
            const fila = (id) => { const db = window.__nube.leer(); return [db, db.admin_documentos.find(x => x.id === id)]; };
            window.__rpcExtra = Object.assign(window.__rpcExtra || {}, {
                admin_documento_reemitir: (p) => { const [db, r] = fila(p.p_id); if (r.version !== p.p_version) throw new Error('El documento cambió en otra ventana');
                    window.__reemitir = p; Object.assign(r, p.p_documento, { version: r.version + 1 }); delete r.nota; window.__nube.escribir(db); return r; },
                admin_documento_eliminar: (p) => { const [db, r] = fila(p.p_id); window.__eliminar = p;
                    Object.assign(r, { eliminado_at: '2026-11-26T00:00:00Z', eliminado_motivo: p.p_motivo, version: r.version + 1 }); window.__nube.escribir(db); return r; },
                admin_documento_restaurar: (p) => { const [db, r] = fila(p.p_id);
                    Object.assign(r, { eliminado_at: null, eliminado_motivo: '', version: r.version + 1 }); window.__nube.escribir(db); return r; }
            });
            window.__impresos = []; window.etaaxAbrirReporte = (h) => { window.__impresos.push(h); return true; };
        });
        await pa.evaluate(() => switchTab('documentos')); await pa.waitForTimeout(400);
        await pa.evaluate(() => AdminDocs.cargar()); await pa.waitForTimeout(500);
        const filaDoc = (folio) => '#admDocsTabla tr:has-text("' + folio + '")';
        await caso('cada recibo con «Vista previa», «Editar», «Reimprimir» y «Eliminar»', async () =>
            assert.deepEqual(await pa.locator(filaDoc('REC-20261125') + ' .adoc-actions button').allTextContents(), ['Vista previa', 'Editar', 'Reimprimir', 'Eliminar']));
        /* (27-nov) Grupos: presupuestos aparte; recibos de suscripción, de servicios y por clasificar. */
        await foto(pa, 'p3b-grupos');
        await caso('GRUPOS: botones con cuántos hay —Todos, Suscripción, Servicios, Por clasificar, Presupuestos—', async () =>
            assert.deepEqual(await pa.evaluate(() => [...document.querySelectorAll('#admDocsGrupos .adoc-grupo-btn')].map(b => b.textContent.replace(/\s+/g, ' ').trim())),
                ['Todos 4', 'Suscripción 1', 'Servicios 1', 'Por clasificar 1', 'Presupuestos 1']));
        await caso('…en «Todos», una tabla por grupo con su total, cada documento en el suyo', async () =>
            assert.deepEqual(await pa.evaluate(() => [...document.querySelectorAll('#admDocsTabla .adoc-grupo')].map(g => g.querySelector('h3').textContent + ': ' +
                [...g.querySelectorAll('.adoc-folio')].map(b => b.textContent).join(',') + ' · ' + g.querySelector('.adoc-grupo-cab span').textContent.replace(/\s+/g, ' ').trim())),
                ['Recibos de suscripción: REC-20261125-29BD7408 · 1 documento · $2,699.00', 'Recibos de servicios: REC-SERV-1 · 1 documento · $3,000.00',
                 'Recibos por clasificar: ARCH-1 · 1 documento · $900.00', 'Presupuestos: PRE-1 · 1 documento · $1,799.00']));
        await caso('…el recibo de suscripción dice cuánto es suscripción y cuánto servicios; el de servicios, que no trae suscripción', async () =>
            assert.deepEqual(await pa.evaluate(() => [document.querySelector('.adoc-g-suscripcion td:nth-child(2) small').textContent, document.querySelector('.adoc-g-servicio td:nth-child(2) small').textContent]),
                [await pa.evaluate(() => 'Suscripción $1,799.00 desde ' + document.querySelector('.adoc-g-suscripcion td:nth-child(3)').textContent.slice(0, 7) + ' · + servicios $900.00'), 'Servicios · sin suscripción']));
        await pa.click('#admDocsGrupos .adoc-grupo-btn:has-text("Servicios")'); await pa.waitForTimeout(150);
        await caso('…elegir «Servicios» deja solo su tabla', async () =>
            assert.deepEqual(await pa.evaluate(() => [...document.querySelectorAll('#admDocsTabla .adoc-folio')].map(b => b.textContent)), ['REC-SERV-1']));
        await pa.click('#admDocsGrupos .adoc-grupo-btn:has-text("Todos")'); await pa.waitForTimeout(150);
        await pa.click(filaDoc('REC-SERV-1') + ' button:has-text("Vista previa")'); await pa.waitForSelector('#adocVista'); await pa.waitForTimeout(200);
        await foto(pa, 'p3c-vista-previa');
        await caso('VISTA PREVIA: el documento en una ventana del panel (iframe aislado), con su grupo, cliente y total, y sin abrir la impresión', async () => {
            const r = await pa.evaluate(() => { const v = document.getElementById('adocVista'), f = v.querySelector('iframe');
                return [v.querySelector('h2').textContent, v.querySelector('header small').textContent, f.hasAttribute('sandbox'), /Servicio de consultoría/.test(f.srcdoc), window.__impresos.length]; });
            assert.deepEqual(r, ['REC-SERV-1', 'Recibos de servicios · TATA MEZCALERIA · $3,000.00 · pagado', true, true, 0]);
        });
        await pa.click('#adocVista [data-acc="imprimir"]'); await pa.waitForTimeout(150);
        await caso('…«Reimprimir» desde la vista previa imprime ESE documento', async () =>
            assert.equal(await pa.evaluate(() => window.__impresos.length === 1 && /Servicio de consultoría/.test(window.__impresos[0])), true));
        await pa.click('#adocVista [data-cerrar]'); await pa.waitForTimeout(100);
        await pa.click('.adoc-folio:has-text("ARCH-1")'); await pa.waitForSelector('#adocVista'); await pa.waitForTimeout(200);
        await caso('…tocar el folio también la abre; un PDF recuperado se ve incrustado en computadora', async () =>
            assert.equal(await pa.evaluate(() => /^blob:/.test((document.querySelector('#adocVista iframe') || {}).getAttribute('src') || '')), true));
        await pa.evaluate(() => { const v = document.getElementById('adocVista'); if (v) v.remove(); window.__impresos = []; });
        await pa.click(filaDoc('REC-20261125') + ' button:has-text("Editar")'); await pa.waitForSelector('#docOv'); await pa.waitForTimeout(250);
        await foto(pa, 'p4-editar-recibo');
        await caso('«Editar» abre el MISMO generador, lleno con lo guardado, con su folio fijo y sin cambiar de tipo', async () => {
            const r = await pa.evaluate(() => ({
                tit: document.getElementById('doc_titulo').textContent, folio: document.getElementById('doc_folio').value, fijo: document.getElementById('doc_folio').readOnly,
                tipos: getComputedStyle(document.getElementById('doc_tipos')).display, neg: document.getElementById('doc_neg').value,
                sucs: [...document.querySelectorAll('.doc-suc')].map(c => c.getAttribute('data-id') + ':' + c.checked),
                razon: document.getElementById('doc_razonRec').value, extra: [...document.querySelectorAll('#doc_extras input')].map(i => i.value),
                total: document.getElementById('doc_total').value, estado: document.getElementById('doc_estado').value, metodo: document.getElementById('doc_metodo').value,
                boton: document.getElementById('doc_btnGen').textContent }));
            assert.deepEqual(r, { tit: 'Editar recibo · REC-20261125-29BD7408', folio: 'REC-20261125-29BD7408', fijo: true, tipos: 'none', neg: 'A',
                sucs: ['suc_principal:true', 'suc_tul:false'], razon: 'EL MIAMI', extra: ['Consultoría', '900'], total: '2699.00', estado: 'pagado',
                metodo: 'Transferencia', boton: 'Guardar cambios' });
        });
        await pa.fill('#doc_extras input[data-f="monto"]', '1000'); await pa.waitForTimeout(100);
        await pa.click('#docOv [data-act="gen"]'); await pa.waitForTimeout(500);
        await caso('…«Guardar cambios» reemite EL MISMO documento (su versión), con el total nuevo y el documento rearmado', async () => {
            const r = await pa.evaluate(() => ({ abierto: !!document.getElementById('docOv'), v: window.__reemitir.p_version, total: window.__reemitir.p_documento.total,
                folio: 'folio' in window.__reemitir.p_documento, html: window.__nube.leer().admin_documentos[0].html.indexOf('viejo') === -1,
                sus: window.__reemitir.p_documento.suscripcion_monto, fila: document.querySelector('#admDocsTabla').innerText.indexOf('$2,799.00') > -1 }));
            assert.deepEqual(r, { abierto: false, v: 1, total: 2799, folio: false, html: true, sus: 1799, fila: true });
        });
        await pa.click(filaDoc('REC-20261125') + ' button:has-text("Eliminar")'); await pa.waitForSelector('#adocModal');
        await pa.click('#adoc-confirmar'); await pa.waitForTimeout(150);
        await caso('«Eliminar» pide el motivo antes de hacer nada', async () => {
            assert.match(await texto(pa, '#adocModal .adoc-error'), /por qué se elimina/);
            assert.equal(await pa.evaluate(() => !!window.__eliminar), false);
        });
        await pa.fill('#adoc-motivo', 'Duplicado'); await pa.click('#adoc-confirmar'); await pa.waitForTimeout(400);
        await caso('…con motivo, sale del historial y de los totales del mes', async () => {
            const r = await pa.evaluate(() => ({ p: window.__eliminar && window.__eliminar.p_motivo, fila: document.getElementById('admDocsTabla').innerText.indexOf('REC-20261125') > -1,
                emitido: document.querySelector('#admDocsMetricas > div strong').textContent }));
            assert.deepEqual(r, { p: 'Duplicado', fila: false, emitido: '$0.00' });
        });
        await pa.evaluate(() => AdminDocs.filtro('estado', 'eliminado')); await pa.waitForTimeout(150);
        await caso('…en el filtro «Eliminados» aparece con su motivo y «Restaurar»', async () =>
            assert.match((await pa.locator(filaDoc('REC-20261125')).innerText()).replace(/\s+/g, ' '), /Eliminado: Duplicado\s*Vista previa\s*Restaurar/));
        await pa.click(filaDoc('REC-20261125') + ' button:has-text("Restaurar")'); await pa.waitForTimeout(300);
        await pa.evaluate(() => AdminDocs.filtro('estado', '')); await pa.waitForTimeout(150);
        await caso('…y «Restaurar» lo regresa, con sus totales', async () => {
            assert.equal(await pa.evaluate(() => document.getElementById('admDocsTabla').innerText.indexOf('REC-20261125') > -1), true);
            assert.equal(await pa.evaluate(() => document.querySelector('#admDocsMetricas > div strong').textContent), '$2,799.00');
        });
        /* (27-nov) El Tablero de ingresos de ETAAX, con los mismos recibos. */
        await pa.evaluate(() => switchTab('tablero')); await pa.waitForSelector('#tab-tablero .atb-kpi'); await pa.waitForTimeout(300);
        await foto(pa, 'p3d-tablero');
        await caso('TABLERO: MRR, cobrado y pendiente del mes con la MISMA vara que el historial (EtaaxCore.resumenDocumentosAdmin)', async () => {
            const r = await pa.evaluate(() => { const mes = document.getElementById('atbMes').value, x = EtaaxCore.resumenDocumentosAdmin(AdminDocs.lista(), mes),
                f = (v) => '$' + Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return [[...document.querySelectorAll('#tab-tablero .atb-kpi strong')].slice(0, 3).map(s => s.textContent), [f(x.mrr), f(x.cobrado), f(x.pendiente)], x.mrr > 0]; });
            assert.deepEqual(r[0], r[1]); assert.equal(r[2], true);
        });
        await caso('…el ARR es el MRR × 12 y los clientes al corriente salen del estado de su suscripción', async () => {
            const r = await pa.evaluate(() => { const k = document.querySelectorAll('#tab-tablero .atb-kpi'); return [k[0].querySelector('span').textContent, k[3].querySelector('strong').textContent.replace(/\s+/g, ' ')]; });
            assert.match(r[0], /^ARR \$[\d,]+\.\d\d/); assert.match(r[1], /^\d+ de 1$/);
        });
        await caso('…la gráfica: 12 meses, una barra por mes, la cifra solo en el mes elegido, y su tabla con los números', async () =>
            assert.deepEqual(await pa.evaluate(() => [document.querySelectorAll('#atbGraf .zona').length, document.querySelectorAll('#atbGraf .barra.on').length, document.querySelectorAll('#atbGraf .val').length,
                document.querySelectorAll('#tab-tablero details .atb-tabla tbody tr').length]), [12, 1, 1, 12]));
        await pa.hover('#atbGraf .zona[data-i="11"]'); await pa.waitForTimeout(150);
        await caso('…pasar sobre una barra enseña su mes: MRR, emitido y cobrado', async () =>
            assert.match(await pa.evaluate(() => document.querySelector('#atbGraf .atb-tip').textContent), /MRR\$[\d,.]+Emitido\$[\d,.]+Cobrado\$[\d,.]+/));
        await caso('…la cobranza por cliente: por negocio (con «Ver negocio») y los recibos sin negocio por su nombre', async () => {
            const r = await pa.evaluate(() => [...document.querySelectorAll('#tab-tablero .atb-caja:last-child tbody tr')].map(tr => tr.cells[0].querySelector('b').textContent + ' | ' + !!tr.querySelector('button')));
            assert.deepEqual(r.slice().sort(), ['EGMx | true', 'Recibo viejo | false'], JSON.stringify(r));
        });
        await caso('…y avisa que hay recibos sin clasificar que no cuentan en el MRR (con el atajo al historial)', async () => {
            assert.match(await pa.evaluate(() => document.querySelector('#tab-tablero .atb-aviso').textContent), /1 recibo sin clasificar no cuenta en el MRR/);
            await pa.click('#tab-tablero .atb-aviso button'); await pa.waitForTimeout(400);
            assert.deepEqual(await pa.evaluate(() => [document.getElementById('tab-documentos').classList.contains('active'), [...document.querySelectorAll('#admDocsTabla .adoc-folio')].map(b => b.textContent)]),
                [true, ['ARCH-1']]);
            await pa.evaluate(() => AdminDocs.grupo(''));
        });
        await pa.click(filaDoc('ARCH-1') + ' button:has-text("Editar")'); await pa.waitForTimeout(300);
        await caso('un PDF recuperado (no se puede rearmar) sigue con su ventanita de estado, también con «Eliminar»', async () =>
            assert.deepEqual(await pa.evaluate(() => [!!document.getElementById('adoc-guardar'), !!document.getElementById('adoc-eliminar'), !!document.getElementById('docOv')]), [true, true, false]));

        /* (26-nov, v96) Guías de la app móvil: se suben desde el panel admin. */
        console.log('\n══ Panel admin · guías de la app móvil ══');
        await pa.evaluate(() => { const db = window.__nube.leer(); db.guias = [
            { id: 'gx1', titulo: 'Manual Cost·ax', tipo: 'pdf', url: 'https://x/evidencias/_guias/pdf/a.pdf', modulo: 'movil_costax', orden: 0, activa: true, categoria: 'App móvil' },
            { id: 'gx9', titulo: 'Guía de Learn·ax', tipo: 'pdf', url: 'https://x/b.pdf', modulo: 'recetas', orden: 0, activa: true }]; window.__nube.escribir(db);
            window.confirm = () => true;
            /* La ventanita del PDF recuperado (caso anterior) se cierra antes de seguir. */
            document.querySelectorAll('#adocModal, .adoc-overlay').forEach(m => { m.style.display = 'none'; m.classList.remove('open'); }); });
        await pa.evaluate(() => admInicio()); await pa.waitForTimeout(200);
        await caso('el panel admin tiene la tarjeta «Guías de la app móvil»', async () =>
            assert.equal(await pa.evaluate(() => !!document.querySelector('.adm-card[data-card="guias-movil"]')), true));
        await pa.evaluate(() => admArea('plataforma')); await pa.waitForTimeout(150);   // (27-nov) la portada va por áreas
        await pa.click('.adm-card[data-card="guias-movil"]'); await pa.waitForTimeout(500);
        await caso('…abre con Cost·ax y Equip·ax, cada uno con SUS guías (las de Learn·ax no salen)', async () => {
            const r = await pa.evaluate(() => [...document.querySelectorAll('#tab-guias-movil .agm-mod')].map(m => m.querySelector('.agm-mod-nom').textContent + ': ' +
                [...m.querySelectorAll('.agm-it b')].map(b => b.textContent).join(',')));
            assert.deepEqual(r, ['Cost·ax: Manual Cost·ax', 'Equip·ax: ']);
        });
        await pa.selectOption('#agmModulo', 'movil_equipax'); await pa.fill('#agmTitulo', 'Tu turno en la app');
        await pa.click('.agm-tipo[data-tipo="link"]'); await pa.fill('#agmUrl', 'https://youtu.be/abcDEF12345');
        await pa.click('#agmGuardar'); await pa.waitForTimeout(500);
        await caso('…agregar un video de YouTube a Equip·ax lo guarda en `guias` con su módulo y ya se ve en la lista', async () => {
            const g = await pa.evaluate(() => window.__nube.leer().guias.find(x => x.titulo === 'Tu turno en la app'));
            assert.deepEqual([g && g.modulo, g && g.tipo, g && g.url, g && g.activa, g && g.categoria], ['movil_equipax', 'video', 'https://youtu.be/abcDEF12345', true, 'App móvil']);
            assert.match(await pa.evaluate(() => document.querySelectorAll('#tab-guias-movil .agm-mod')[1].textContent), /Tu turno en la app/);
        });
        await caso('…un enlace que no es de YouTube no se guarda', async () => {
            await pa.fill('#agmTitulo', 'Otro'); await pa.fill('#agmUrl', 'https://vimeo.com/123'); await pa.click('#agmGuardar'); await pa.waitForTimeout(200);
            assert.match(await pa.evaluate(() => document.getElementById('agmMsg').textContent), /no parece de YouTube/);
        });
        await pa.click('#tab-guias-movil .agm-it:has-text("Manual Cost·ax") button:has-text("Ocultar")'); await pa.waitForTimeout(400);
        await caso('«Ocultar» la deja fuera de la app sin borrarla; «Eliminar» la quita', async () => {
            assert.equal(await pa.evaluate(() => window.__nube.leer().guias.find(x => x.id === 'gx1').activa), false);
            await pa.click('#tab-guias-movil .agm-it:has-text("Tu turno en la app") button:has-text("Eliminar")'); await pa.waitForTimeout(400);
            assert.equal(await pa.evaluate(() => !!window.__nube.leer().guias.find(x => x.titulo === 'Tu turno en la app')), false);
        });

        /* (27-nov) Guías de la app web: las mismas filas de `guias`, con el id del módulo. */
        console.log('\n══ Panel admin · guías de la app web ══');
        await pa.evaluate(() => admInicio()); await pa.waitForTimeout(200);
        await caso('el panel admin tiene la tarjeta «Guías de la app web»', async () =>
            assert.equal(await pa.evaluate(() => !!document.querySelector('.adm-card[data-card="guias-web"]')), true));
        await pa.evaluate(() => admArea('plataforma')); await pa.waitForTimeout(150);   // (27-nov) la portada va por áreas
        await pa.click('.adm-card[data-card="guias-web"]'); await pa.waitForTimeout(500);
        await caso('…abre con los cinco módulos, cada uno con SUS guías (las de la app móvil no salen) y el otro panel se vacía', async () => {
            const r = await pa.evaluate(() => [[...document.querySelectorAll('#tab-guias-web .agm-mod')].map(m => m.querySelector('.agm-mod-nom').textContent + ': ' +
                [...m.querySelectorAll('.agm-it b')].map(b => b.textContent).join(',')), document.getElementById('tab-guias-movil').innerHTML === '']);
            assert.deepEqual(r, [['Cost·ax: Guía de Learn·ax', 'Admin·ax: ', 'Fin·ax: ', 'Equip·ax: ', 'Learn·ax: '], true]);
        });
        await caso('…en la web cada guía va en un SUBMÓDULO: la lista cambia con el módulo (General + los del módulo)', async () => {
            await pa.selectOption('#agmModulo', 'financiero');
            assert.deepEqual(await pa.evaluate(() => [...document.querySelectorAll('#agmSub option')].map(o => o.value)),
                ['General', 'Resumen financiero', 'Ventas totales', 'Gastos totales', 'KPIs', 'Estadísticas']);
        });
        await pa.selectOption('#agmSub', 'Ventas totales'); await pa.fill('#agmTitulo', 'Cómo leer el resumen');
        await pa.click('.agm-tipo[data-tipo="link"]'); await pa.fill('#agmUrl', 'https://www.youtube.com/watch?v=abcDEF12345');
        await pa.click('#agmGuardar'); await pa.waitForTimeout(500);
        await caso('…agregar una guía a Fin·ax → Ventas totales la guarda con modulo «financiero» y categoría «Fin·ax · Ventas totales» (así la agrupan la portada, el hub y Learn·ax)', async () => {
            const g = await pa.evaluate(() => window.__nube.leer().guias.find(x => x.titulo === 'Cómo leer el resumen'));
            assert.deepEqual([g && g.modulo, g && g.tipo, g && g.categoria, g && g.activa], ['financiero', 'video', 'Fin·ax · Ventas totales', true]);
            assert.match(await pa.evaluate(() => document.querySelectorAll('#tab-guias-web .agm-mod')[2].textContent), /Cómo leer el resumen.*Ventas totales · Tutorial · Video · YouTube/);
            assert.match(await pa.evaluate(() => document.getElementById('agmMsg').textContent), /ya aparece en el sistema/);
        });
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log('\n' + (malos.length ? '🚨 APPS POR SUCURSAL EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '🔒 APPS POR SUCURSAL EN NAVEGADOR OK — ' + resultados.length + ' casos'));
    process.exit(malos.length ? 1 : 0);
})();
