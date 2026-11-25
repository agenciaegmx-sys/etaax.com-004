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
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log('\n' + (malos.length ? '🚨 APPS POR SUCURSAL EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '🔒 APPS POR SUCURSAL EN NAVEGADOR OK — ' + resultados.length + ' casos'));
    process.exit(malos.length ? 1 : 0);
})();
