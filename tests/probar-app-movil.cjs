/* LA APP MÓVIL POR MÓDULO — en un navegador de verdad, con tamaño de teléfono.

   Lo que se vigila (Edwin, 25-nov): «primero se define el acceso, entrar con
   usuario o con clave; la clave es para vistas y la de usuario y contraseña es
   para usar parte de los módulos».
     · La portada son dos puertas: «Entrar con mi clave» y «Entrar con usuario y
       contraseña». Sin el negocio ligado, la de la clave se apaga y se explica.
     · Con la clave, el menú va por módulo: Cost·ax (entradas, mermas,
       cortesías, conteo, recetario, lo registrado), Equip·ax (mis horarios, mis
       check lists, evaluaciones) y Learn·ax (guías). Con íconos de la marca.
     · Lo que la sucursal no contrató no se ve (portal_apps, v91); sin la v91
       se ve todo y «Mis horarios» dice que todavía no está activado.
     · Mis horarios: solo sus turnos, con la fecha y el total de horas.
     · Evaluaciones: las abiertas, con su enlace de siempre.
     · Con la cuenta, los módulos ·ax del plan.
     · En un teléfono no hay desplazamiento a lo ancho.

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-app-movil.cjs
   SHOTS=<carpeta>: capturas para revisarlas a ojo. */
'use strict';
const assert = require('node:assert/strict');
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const { sdkEtx } = require('./sdk-cuentas.cjs');
const RAIZ = path.resolve(__dirname, '..');
const ORIGEN = 'https://etaax.prueba';
const TIPOS = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const resultados = [];
async function caso(nombre, fn) {
    try { await fn(); resultados.push([nombre, true]); console.log('  ✅ ' + nombre); }
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n').filter(Boolean).slice(0, 4).join(' ')); }
}

/* Las RPC de la app, de mentira pero con las mismas reglas: el NIP 12345 es Ana
   (barra, sucursal Polanco); cualquier otro no entra. */
function rpcs(opc) {
    return `(() => {
        const NIPH = '__NIPH__', hoy = new Date();
        const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
        const lunes2 = new Date(lunes); lunes2.setDate(lunes.getDate() + 7);
        const ok = (p) => p.p_token === 'tokA' && p.p_niphash === window.__niphash;
        window.__rpcSinCorrer = ${JSON.stringify(opc.sinCorrer || [])};
        window.__rpcExtra = {
            entrada_validar_nip: (p) => ok(p) ? 'Ana López' : null,
            portal_perfil: (p) => ok(p) ? { nombre: 'Ana López', puesto: 'Bartender', rol: 'barra', areaReal: 'barra', area: 'barra', sucursalId: 'suc_dos', estado: 'Activo' } : null,
            entrada_catalogo: (p) => ok(p) ? { ok: true, sucursal: 'suc_dos', insumos: [{ id: 'i1', nombre: 'Tequila Blanco', activo: '1', sucursales: ['suc_dos'] }] } : null,
            checklist_plantillas: (p) => [{ id: 'c1', nombre: 'Apertura de barra', tipo: 'apertura', tareas: [{ texto: 'Hielo' }, { texto: 'Limones' }] }],
            portal_apps: (p) => ok(p) ? { sucursalId: 'suc_dos', apps: ${JSON.stringify(opc.apps === undefined ? null : opc.apps)} } : null,
            portal_horarios: (p) => ok(p) ? { hoy: iso(hoy), semanas: [
                { semana: '2026-W48', lunes: iso(lunes), turnos: [{ sucursalId: 'suc_dos', sucursal: 'Polanco', dias: { d0: { in: '09:00', out: '17:00' }, d1: { desc: 1 }, d4: { in: '18:00', out: '02:00' } } }] },
                { semana: '2026-W49', lunes: iso(lunes2), turnos: [] }] } : null,
            portal_evaluaciones: (p) => ok(p) ? [{ titulo: 'Barra nivel 1', categoria: 'operativas', descripcion: '', token: 't-e1', preguntas: 12 }] : null,
            portal_guias: () => [{ titulo: 'Cómo registrar una entrada', url: '#', tipo: 'pdf' }],
            entrada_token_asegurar: () => 'tokA'
        };
    })();`;
}
function semilla(opc) {
    const n = {
        __auth: [{ id: 'u1', email: 'duena@etaax.prueba', password: 'secreta', meta: { nombre: 'Dueña' } }],
        negocios: [{ id: 'n1', usuario_id: 'u1', nombre: 'Café de prueba', datos: { nombre: 'Café de prueba' } }],
        suscripciones: [{ negocio_id: 'n1', estado: 'activa', plan: opc.planCuenta === undefined ? null : opc.planCuenta }]
    };
    return `(() => {
        window.alert = () => {}; window.confirm = () => true;
        if (!localStorage.getItem('__sembrado')) {
            localStorage.clear();
            localStorage.setItem('__nube', ${JSON.stringify(JSON.stringify(n))});
            ${opc.ligado === false ? '' : `localStorage.setItem('etaax_appmovil_qr', JSON.stringify({ n: 'n1', t: 'tokA', s: '', nom: 'Café de prueba' }));`}
            localStorage.setItem('__sembrado', '1');
        }
    })();`;
}
async function abrir(browser, opc) {
    opc = opc || {};
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
                                           serviceWorkers: 'block' });
    await ctx.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === ORIGEN) {
            let p = path.join(RAIZ, decodeURIComponent(url.pathname));
            if (p.endsWith('/')) p = path.join(p, 'index.html');
            if (p.startsWith(RAIZ) && fs.existsSync(p) && fs.statSync(p).isFile())
                return route.fulfill({ status: 200, body: fs.readFileSync(p), headers: { 'content-type': TIPOS[path.extname(p)] || 'application/octet-stream' } });
            return route.fulfill({ status: 404, body: '' });
        }
        if (/supabase-js/.test(url.href))
            return route.fulfill({ status: 200, body: '(' + sdkEtx.toString() + ')();', headers: { 'content-type': 'application/javascript' } });
        if (/fonts\.(googleapis|gstatic)/.test(url.host)) return route.fulfill({ status: 200, body: '' });
        return route.abort();
    });
    await ctx.addInitScript(semilla(opc));
    await ctx.addInitScript(rpcs(opc));
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    await page.goto(ORIGEN + '/app-movil/index.html');
    await page.waitForFunction(() => !document.getElementById('pInicio').hidden || !document.getElementById('pHome').hidden, null, { timeout: 15000 });
    /* El hash del NIP 12345, calculado por la propia página (el mismo de siempre). */
    await page.evaluate(async () => {
        const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('etaax-staff|nip|12345'));
        window.__niphash = 'v2$' + Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
    });
    return { ctx, page };
}
const foto = (page, nombre) => process.env.SHOTS ? page.waitForTimeout(400).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png'), fullPage: true })) : null;
const nip = async (p, n) => { for (const d of n) await p.click('#teclado [data-k="' + d + '"]'); await p.waitForFunction(() => !document.getElementById('pMenu').hidden, null, { timeout: 15000 }).catch(async (e) => { throw new Error('no entró: ' + await p.evaluate(() => document.getElementById('nipMsg').textContent + ' · rpcs=' + (window.__rpcs || []).join(','))); }); await p.waitForTimeout(200); };
const modulos = (p) => p.evaluate(() => [...document.querySelectorAll('#menuPortal .mod-nom')].map(x => x.textContent));
const opciones = (p) => p.evaluate(() => [...document.querySelectorAll('#menuPortal .mcard b')].map(x => x.textContent));
const sinAncho = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
    const browser = await chromium.launch();
    try {
        console.log('\n══ App móvil · las dos puertas y el menú por módulo ══');
        const { ctx, page: p } = await abrir(browser, {});
        await foto(p, 'm0-portada');
        await caso('la portada son dos puertas: «Entrar con mi clave» y «Entrar con usuario y contraseña»', async () => {
            const r = await p.evaluate(() => [...document.querySelectorAll('#pInicio .puerta:not([hidden]) b')].map(b => b.textContent));
            assert.deepEqual(r, ['Entrar con mi clave', 'Entrar con usuario y contraseña']);
        });
        await caso('…la de la clave es para vistas y la de la cuenta para usar los módulos (lo dicen)', async () => {
            const r = await p.evaluate(() => [...document.querySelectorAll('#pInicio .puerta:not([hidden]) small')].map(b => b.textContent));
            assert.match(r[0], /NIP de 5 dígitos · para ver y registrar en tu turno/);
            assert.match(r[1], /para usar los módulos/);
        });
        await caso('…con íconos de la marca, no emojis', async () =>
            assert.equal(await p.evaluate(() => document.querySelectorAll('#pInicio .puerta:not([hidden]) .mcard-ico svg.etx-ic').length), 2));

        await p.click('#btnPuertaClave'); await p.waitForTimeout(150);
        await nip(p, '12345');
        await foto(p, 'm1-menu');
        await caso('con la clave: Cost·ax, Equip·ax y Learn·ax, en ese orden', async () =>
            assert.deepEqual(await modulos(p), ['Cost·ax', 'Equip·ax', 'Learn·ax']));
        await caso('…Cost·ax con entradas, mermas, cortesías, conteo, recetario (es de barra) y lo registrado; Equip·ax con horarios, check lists y evaluaciones', async () =>
            assert.deepEqual(await opciones(p), ['Entrada de insumos', 'Merma', 'Cortesía o préstamo', 'Contar existencias', 'Recetario', 'Lo registrado',
                'Mis horarios', 'Mis check lists', 'Evaluaciones', 'Guías de uso']));
        await caso('…dice quién entró y cada opción lleva su ícono de la marca', async () => {
            assert.match(await p.evaluate(() => document.getElementById('quienCard').textContent), /Ana López/);
            assert.equal(await p.evaluate(() => [...document.querySelectorAll('#menuPortal .mcard .mcard-ico')].every(x => x.querySelector('svg.etx-ic'))), true);
        });
        await caso('…y no se desborda a lo ancho', async () => assert.equal(await sinAncho(p), true));

        await p.click('#menuPortal .mcard:has-text("Mis horarios")'); await p.waitForTimeout(300);
        await foto(p, 'm2-horarios');
        await caso('Mis horarios: lunes de 9:00 a 17:00, martes de descanso, y la semana suma 2 turnos · 16 h', async () => {
            const t = await p.evaluate(() => document.getElementById('horariosLista').innerText.replace(/\s+/g, ' '));
            assert.match(t, /Lunes \d+ \w+ 09:00 – 17:00/); assert.match(t, /Martes \d+ \w+ Descanso/);
            assert.match(t, /Esta semana · semana 48\s*2 turnos · 16 h/i);
            assert.match(t, /La que sigue · semana 49/i);
        });
        await caso('…hoy va marcado', async () => assert.equal(await p.evaluate(() => document.querySelectorAll('#horariosLista .hor-dia.hoy').length), 1));
        await p.click('#btnVolver'); await p.waitForTimeout(150);
        await p.click('#menuPortal .mcard:has-text("Evaluaciones")'); await p.waitForTimeout(300);
        await caso('Evaluaciones: las abiertas con su enlace de siempre', async () => {
            const r = await p.evaluate(() => { const a = document.querySelector('#evalsLista a'); return [a.textContent.replace(/\s+/g, ' ').trim(), a.getAttribute('href'), a.target]; });
            assert.deepEqual(r, ['Barra nivel 1Operativa · 12 preguntas↗', '/evaluacion.html?t=t-e1', '_blank']);
        });
        await p.click('#btnVolver'); await p.waitForTimeout(150);
        await p.click('#pMenu .salir'); await p.waitForTimeout(200);
        await caso('al cerrar sesión vuelve a las dos puertas', async () =>
            assert.equal(await p.evaluate(() => !document.getElementById('pInicio').hidden), true));
        await ctx.close();

        console.log('\n══ App móvil · lo no contratado no se ve ══');
        const b = await abrir(browser, { apps: ['costax'] });
        await b.page.click('#btnPuertaClave'); await nip(b.page, '12345');
        await caso('una sucursal con solo Cost·ax: Cost·ax y Learn·ax, sin Equip·ax', async () =>
            assert.deepEqual(await modulos(b.page), ['Cost·ax', 'Learn·ax']));
        await b.ctx.close();
        const c = await abrir(browser, { apps: ['equipax'] });
        await c.page.click('#btnPuertaClave'); await nip(c.page, '12345');
        await caso('…y con solo Equip·ax: Equip·ax y Learn·ax (sin entradas ni recetario)', async () => {
            assert.deepEqual(await modulos(c.page), ['Equip·ax', 'Learn·ax']);
            assert.equal((await opciones(c.page)).indexOf('Recetario'), -1);
        });
        await c.ctx.close();

        console.log('\n══ App móvil · sin la v91 corrida ══');
        const d = await abrir(browser, { sinCorrer: ['portal_apps', 'portal_horarios', 'portal_evaluaciones'] });
        await d.page.click('#btnPuertaClave'); await nip(d.page, '12345');
        await caso('sin saber el plan se ve todo, como antes', async () =>
            assert.deepEqual(await modulos(d.page), ['Cost·ax', 'Equip·ax', 'Learn·ax']));
        await d.page.click('#menuPortal .mcard:has-text("Mis horarios")'); await d.page.waitForTimeout(300);
        await caso('…y «Mis horarios» dice que todavía no está activado (sin el error crudo)', async () =>
            assert.equal(await d.page.evaluate(() => document.getElementById('horariosLista').textContent.trim()), 'Esta parte de la app todavía no está activada en tu negocio.'));
        await d.ctx.close();

        console.log('\n══ App móvil · sin negocio ligado ══');
        const e = await abrir(browser, { ligado: false });
        await caso('sin ligar, se ofrece «Escanear el QR de mi sucursal» (en iPhone el ícono de inicio no ve lo de Safari)', async () =>
            assert.equal(await e.page.evaluate(() => !document.getElementById('btnEscanearQR').hidden), true));
        await caso('la puerta de la clave se apaga y se explica cómo ligar el teléfono', async () => {
            const r = await e.page.evaluate(() => [document.getElementById('btnPuertaClave').disabled, document.getElementById('inicioAviso').textContent]);
            assert.equal(r[0], true); assert.match(r[1], /Escanea el QR de tu sucursal con el botón de arriba[\s\S]*entre una vez con su cuenta aquí/);
        });
        await e.page.evaluate(() => window._appMovil.ligar(window._appMovil.credsDeQR(location.origin + '/entrada.html?n=n1&t=tokA&s=suc_dos')));
        await e.page.waitForTimeout(200);
        await caso('al leer el QR impreso de siempre, el teléfono queda ligado y pasa directo a la clave', async () => {
            assert.equal(await e.page.evaluate(() => !document.getElementById('pLogin').hidden), true);
            assert.match(await e.page.evaluate(() => localStorage.getItem('etaax_appmovil_qr')), /"n":"n1","t":"tokA"/);
        });
        await nip(e.page, '12345');
        await caso('…y con la clave entra a su menú por módulo', async () => assert.deepEqual(await modulos(e.page), ['Cost·ax', 'Equip·ax', 'Learn·ax']));
        await e.page.click('#pMenu .salir'); await e.page.waitForTimeout(150);
        await caso('ya ligado, el botón de escanear desaparece', async () =>
            assert.equal(await e.page.evaluate(() => document.getElementById('btnEscanearQR').hidden), true));
        await e.page.click('#btnPuertaClave'); await e.page.waitForTimeout(100);
        await e.page.click('#btnVolver'); await e.page.waitForTimeout(150);
        await caso('«atrás» desde la clave, sin haber entrado, regresa a la portada (no a un menú vacío)', async () =>
            assert.equal(await e.page.evaluate(() => !document.getElementById('pInicio').hidden && document.getElementById('pMenu').hidden), true));
        await e.ctx.close();

        console.log('\n══ App móvil · la cuenta ══');
        const f = await abrir(browser, { planCuenta: { base: ['costax'] } });
        await f.page.click('#pInicio .puerta:has-text("usuario y contraseña")'); await f.page.waitForTimeout(150);
        await f.page.fill('#ctaCorreo', 'duena@etaax.prueba'); await f.page.fill('#ctaPwd', 'secreta');
        await f.page.click('#ctaBtn');
        await f.page.waitForFunction(() => !document.getElementById('pCandado').hidden || !document.getElementById('pHome').hidden, null, { timeout: 15000 });
        if (await f.page.evaluate(() => !document.getElementById('pCandado').hidden)) await f.page.click('.cand-no');
        await f.page.waitForFunction(() => !document.getElementById('pHome').hidden, null, { timeout: 15000 });
        await f.page.waitForTimeout(400);
        await foto(f.page, 'm3-cuenta');
        await caso('con la cuenta, los módulos del plan: solo Cost·ax (Insumos y Recetas, «pronto»)', async () => {
            const r = await f.page.evaluate(() => [[...document.querySelectorAll('#homeMenu .mod-nom')].map(x => x.textContent), [...document.querySelectorAll('#homeMenu .mcard b')].map(x => x.textContent)]);
            assert.deepEqual(r, [['Cost·ax'], ['Insumos', 'Recetas']]);
        });
        await caso('…y el teléfono quedó ligado: la puerta de la clave ya sirve para el equipo', async () =>
            assert.match(await f.page.evaluate(() => document.getElementById('homeQuien').textContent), /Tu equipo ya puede entrar con su clave/));
        await f.ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log(malos.length ? '\n🚨 APP MÓVIL EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '\n🔒 APP MÓVIL EN NAVEGADOR OK — ' + resultados.length + ' casos');
    process.exit(malos.length ? 1 : 0);
})();
