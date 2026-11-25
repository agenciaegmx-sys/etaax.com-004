/* LA APP MÓVIL — en un navegador de verdad, con tamaño de teléfono.

   Lo que se vigila (Edwin, 25-nov):
     · La cabecera es la del sistema: ☰ (el menú), el isotipo al centro, el tema
       y quién está en sesión.
     · La portada: la CLAVE por default (el teclado a la vista) y «Iniciar sesión
       con usuario y contraseña» desplegable. Sin el negocio ligado, la clave se
       apaga y la cuenta se abre sola.
     · Con la clave: los módulos con su isla azul (Cost·ax, Equip·ax) y una
       explicación breve. Dentro de Cost·ax, dos desplegables —Inventarios y
       Recetas— con sus opciones en rectángulos de DOS columnas; las recetas son
       las de su área. Dentro de Equip·ax: mis horarios, check list y
       evaluaciones SOLO si hay abiertas. Las guías ya no salen.
     · Lo que la sucursal no contrató no se ve (portal_apps, v91).
     · Usuario y contraseña: el dueño (correo) y los COLABORADORES con acceso al
       sistema (usuario sin @), como en el hub; al entrar queda ligado el teléfono.
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
            portal_evaluaciones: (p) => ok(p) ? ${JSON.stringify(opc.evals === undefined ? [{ titulo: 'Barra nivel 1', categoria: 'operativas', descripcion: '', token: 't-e1', preguntas: 12 }] : opc.evals)} : null,
            portal_recetas: (p) => ok(p) ? [
                { nombre: 'Margarita', tipo: 'bebidas', grupo: 'Coctelería', categoria: 'Clásicos', ingredientes: [{ nombre: 'Tequila', cantidad: 60, unidad: 'ML' }], procedimiento: 'Agitar con hielo.' },
                { nombre: 'Paloma', tipo: 'bebidas', grupo: 'Coctelería', categoria: 'De la casa', ingredientes: [], procedimiento: '' }] : null,
            entrada_token_asegurar: () => 'tokA',
            /* (v92) La app móvil por sucursal: el token de una sucursal activa
               (aquí siempre 'tokA') y si el enlace sigue abierto. */
            movil_token: (p) => { const act = ${JSON.stringify(opc.movil || { suc_principal: true, suc_dos: true })};
                const suc = p.p_suc || (act.suc_principal ? 'suc_principal' : Object.keys(act).find((k) => act[k]));
                return (suc && act[suc]) ? { token: 'tokA', sucursalId: suc } : null; },
            movil_estado: (p) => ({ activo: ${opc.apagado ? 'false' : "p.p_token === 'tokA'"}, sucursalId: null }),
            /* El colaborador con acceso al sistema: usuario «eli» (Elizabeth, gerente). */
            staff_login: (p) => (p.p_usuario === 'eli' && p.p_hash === window.__pwdhash)
                ? [{ negocio_id: 'n1', negocio_datos: { nombre: 'Café de prueba' }, staff_id: 's7', nombre: 'Elizabeth Ruiz', rol: 'gerente', sucursal_id: 'suc_dos' }] : [],
            obtener_staff_cred: (p) => (p.p_neg === 'n1' && p.p_hash === window.__pwdhash) ? { email: 'staff.n1@etaax.app', password: 'cuenta-del-negocio' } : null
        };
    })();`;
}
function semilla(opc) {
    const n = {
        __auth: [{ id: 'u1', email: 'duena@etaax.prueba', password: 'secreta', meta: { nombre: 'Dueña' } },
                 { id: 'u-staff', email: 'staff.n1@etaax.app', password: 'cuenta-del-negocio', meta: {} }],
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
        const b2 = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('etaax-staff|Eli#2026'));
        window.__pwdhash = 'v2$' + Array.from(new Uint8Array(b2)).map(x => x.toString(16).padStart(2, '0')).join('');
    });
    return { ctx, page };
}
const foto = (page, nombre) => process.env.SHOTS ? page.waitForTimeout(400).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png'), fullPage: true })) : null;
const nip = async (p, n) => { for (const d of n) await p.click('#teclado [data-k="' + d + '"]'); await p.waitForFunction(() => !document.getElementById('pMenu').hidden, null, { timeout: 15000 }).catch(async (e) => { throw new Error('no entró: ' + await p.evaluate(() => document.getElementById('nipMsg').textContent)); }); await p.waitForTimeout(200); };
const islas = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s + ' .isla')].map(x => x.textContent), sel);
const sinAncho = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const cabecera = (p) => p.evaluate(() => [document.getElementById('hdrNombre').textContent, document.getElementById('hdrEstado').textContent]);

(async () => {
    const browser = await chromium.launch();
    try {
        console.log('\n══ App móvil · cabecera y portada ══');
        const { ctx, page: p } = await abrir(browser, {});
        await foto(p, 'm0-portada');
        await caso('la cabecera es la del sistema: ☰, el isotipo al centro, el tema y «Sin sesión»', async () => {
            const r = await p.evaluate(() => {
                const m = document.querySelector('.hdr-marca').getBoundingClientRect();
                return [!!document.querySelector('#btnCajon svg'), Math.abs((m.left + m.right) / 2 - innerWidth / 2) < 2,
                        !!document.querySelector('#temaIco svg.etx-ic'), document.getElementById('hdrNombre').textContent];
            });
            assert.deepEqual(r, [true, true, true, 'Sin sesión']);
        });
        await caso('la portada: la CLAVE por default, con su teclado a la vista', async () =>
            assert.deepEqual(await p.evaluate(() => [document.querySelector('#pInicio .login-tit').textContent, document.querySelectorAll('#teclado .tecla').length,
                document.getElementById('nipZona').classList.contains('apagada')]), ['Entrar con tu clave', 12, false]));
        await caso('…y «Iniciar sesión con usuario y contraseña» cerrado, que se despliega al tocarlo', async () => {
            assert.equal(await p.evaluate(() => document.getElementById('cuentaForm').hidden), true);
            await p.click('#btnUsuario');
            assert.deepEqual(await p.evaluate(() => [document.getElementById('cuentaForm').hidden, document.getElementById('btnUsuario').getAttribute('aria-expanded')]), [false, 'true']);
            await p.click('#btnUsuario');
        });

        console.log('\n══ App móvil · con la clave ══');
        await nip(p, '12345');
        await foto(p, 'm1-inicio');
        await caso('con la clave: los módulos con su isla azul, Cost·ax y Equip·ax, y la cabecera dice quién entró', async () => {
            assert.deepEqual(await islas(p, '#menuPortal'), ['Cost·ax', 'Equip·ax']);
            assert.deepEqual(await cabecera(p), ['Ana', 'Sesión activa']);
            assert.match(await p.evaluate(() => document.getElementById('quienCard').textContent), /Hola, Ana/);
        });
        await caso('…sin las guías y sin desbordarse a lo ancho', async () => {
            assert.equal(await p.evaluate(() => document.body.innerText.indexOf('Guías de uso')), -1);
            assert.equal(await sinAncho(p), true);
        });
        await p.click('#menuPortal [data-mod="costax"]'); await p.waitForTimeout(200);
        await caso('dentro de Cost·ax: su isla y dos desplegables, Inventarios y Recetas, cerrados', async () =>
            assert.deepEqual(await p.evaluate(() => [[...document.querySelectorAll('#modCuerpo .isla')].map(x => x.textContent),
                [...document.querySelectorAll('#modCuerpo .despl')].map(b => b.textContent.trim() + ':' + b.getAttribute('aria-expanded'))]),
                [['Cost·ax'], ['Inventarios:false', 'Recetas:false']]));
        await p.click('[data-despl="inventarios"]'); await p.waitForTimeout(150);
        await foto(p, 'm2-costax');
        await caso('…Inventarios despliega sus cinco opciones en rectángulos de DOS columnas', async () => {
            const r = await p.evaluate(() => { const g = document.getElementById('rejInventarios');
                return [[...g.querySelectorAll('.rect b')].map(b => b.textContent), getComputedStyle(g).gridTemplateColumns.split(' ').length]; });
            assert.deepEqual(r, [['Registrar entradas', 'Registrar merma', 'Registrar cortesía / préstamo', 'Registrar existencias', 'Ver lo registrado'], 2]);
        });
        await p.click('[data-despl="recetas"]'); await p.waitForTimeout(300);
        await caso('…y Recetas, las recetas de su área, con la misma vista', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#rejRecetas .rect b')].map(b => b.textContent)), ['Margarita', 'Paloma']));
        await p.click('#rejRecetas .rect:has-text("Margarita")'); await p.waitForTimeout(200);
        await caso('una receta abre su ficha (sin costos) y «atrás» regresa a Cost·ax con lo que estaba abierto', async () => {
            assert.match(await p.evaluate(() => document.getElementById('recFicha').textContent), /Tequila[\s\S]*Agitar con hielo/);
            await p.click('#btnVolver'); await p.waitForTimeout(200);
            assert.deepEqual(await p.evaluate(() => [!document.getElementById('pModulo').hidden, !document.getElementById('rejRecetas').hidden]), [true, true]);
        });
        await p.click('#btnVolver'); await p.waitForTimeout(150);
        await p.click('#menuPortal [data-mod="equipax"]'); await p.waitForTimeout(200);
        await foto(p, 'm3-equipax');
        await caso('dentro de Equip·ax: ver mis horarios, realizar check list y evaluaciones (porque hay una abierta)', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#modCuerpo .rect b')].map(b => b.textContent)),
                ['Ver mis horarios', 'Realizar check list', 'Evaluaciones']));
        await p.click('#modCuerpo .rect:has-text("Ver mis horarios")'); await p.waitForTimeout(300);
        await foto(p, 'm4-horarios');
        await caso('Mis horarios: lunes de 9:00 a 17:00, martes de descanso, y la semana suma 2 turnos · 16 h', async () => {
            const t = await p.evaluate(() => document.getElementById('horariosLista').innerText.replace(/\s+/g, ' '));
            assert.match(t, /Lunes \d+ \w+ 09:00 – 17:00/); assert.match(t, /Martes \d+ \w+ Descanso/);
            assert.match(t, /Esta semana · semana 48\s*2 turnos · 16 h/i);
        });
        await p.click('#btnVolver'); await p.waitForTimeout(150);
        await caso('…«atrás» desde mis horarios regresa a Equip·ax', async () =>
            assert.equal(await p.evaluate(() => !document.getElementById('pModulo').hidden), true));
        await p.click('#modCuerpo .rect:has-text("Evaluaciones")'); await p.waitForTimeout(300);
        await caso('Evaluaciones: las abiertas con su enlace de siempre', async () => {
            const r = await p.evaluate(() => { const a = document.querySelector('#evalsLista a'); return [a.getAttribute('href'), a.target]; });
            assert.deepEqual(r, ['/evaluacion.html?t=t-e1', '_blank']);
        });
        await p.click('#btnCajon'); await p.waitForTimeout(200);
        await foto(p, 'm5-cajon');
        await caso('el menú de tres líneas: quién está en sesión, Inicio, Cost·ax, Equip·ax, el tema y Cerrar sesión', async () => {
            const r = await p.evaluate(() => [document.querySelector('#cajonSesion b').textContent,
                [...document.querySelectorAll('#cajon .cajon-it span')].map(x => x.textContent)]);
            assert.equal(r[0], 'Ana López');
            assert.deepEqual(r[1], ['Inicio', 'Cost·ax · inventario y recetas', 'Equip·ax · tu turno', 'Tema claro', 'Cerrar sesión']);
        });
        await p.click('#cajon .cajon-it:has-text("Cerrar sesión")'); await p.waitForTimeout(200);
        await caso('al cerrar sesión vuelve a la portada y la cabecera dice «Sin sesión»', async () => {
            assert.equal(await p.evaluate(() => !document.getElementById('pInicio').hidden), true);
            assert.equal((await cabecera(p))[0], 'Sin sesión');
        });
        await ctx.close();

        console.log('\n══ App móvil · lo no contratado y lo que no hay ══');
        const b = await abrir(browser, { apps: ['costax'], evals: [] });
        await nip(b.page, '12345');
        await caso('una sucursal con solo Cost·ax no ve Equip·ax', async () => assert.deepEqual(await islas(b.page, '#menuPortal'), ['Cost·ax']));
        await b.ctx.close();
        const c = await abrir(browser, { apps: ['equipax'], evals: [] });
        await nip(c.page, '12345');
        await caso('…con solo Equip·ax no ve Cost·ax, y sin evaluaciones abiertas no sale «Evaluaciones»', async () => {
            assert.deepEqual(await islas(c.page, '#menuPortal'), ['Equip·ax']);
            await c.page.click('#menuPortal [data-mod="equipax"]'); await c.page.waitForTimeout(150);
            assert.deepEqual(await c.page.evaluate(() => [...document.querySelectorAll('#modCuerpo .rect b')].map(x => x.textContent)), ['Ver mis horarios', 'Realizar check list']);
        });
        await c.ctx.close();
        const d = await abrir(browser, { sinCorrer: ['portal_apps', 'portal_horarios', 'portal_evaluaciones'] });
        await nip(d.page, '12345');
        await caso('sin la v91: se ve todo, y Mis horarios dice que todavía no está activado', async () => {
            assert.deepEqual(await islas(d.page, '#menuPortal'), ['Cost·ax', 'Equip·ax']);
            await d.page.click('#menuPortal [data-mod="equipax"]'); await d.page.waitForTimeout(150);
            await d.page.click('#modCuerpo .rect:has-text("Ver mis horarios")'); await d.page.waitForTimeout(300);
            assert.equal(await d.page.evaluate(() => document.getElementById('horariosLista').textContent.trim()), 'Esta parte de la app todavía no está activada en tu negocio.');
        });
        await d.ctx.close();

        console.log('\n══ App móvil · sin negocio ligado ══');
        const e = await abrir(browser, { ligado: false });
        await caso('la clave se apaga, se explica cómo ligar el teléfono y la cuenta se abre sola', async () => {
            const r = await e.page.evaluate(() => [document.getElementById('nipZona').classList.contains('apagada'), document.getElementById('cuentaForm').hidden,
                document.getElementById('inicioAviso').textContent]);
            assert.deepEqual(r.slice(0, 2), [true, false]); assert.match(r[2], /entre una vez con su cuenta aquí abajo, o abre el QR de tu sucursal/);
        });
        await e.ctx.close();

        console.log('\n══ App móvil · usuario y contraseña ══');
        const f = await abrir(browser, { planCuenta: { base: ['costax'] }, ligado: false });
        await f.page.fill('#ctaCorreo', 'eli'); await f.page.fill('#ctaPwd', 'Eli#2026');
        await f.page.click('#ctaBtn');
        await f.page.waitForFunction(() => !document.getElementById('pCandado').hidden || !document.getElementById('pHome').hidden || /incorrect|no se pudo|todavía/i.test(document.getElementById('ctaMsg').textContent), null, { timeout: 15000 });
        await caso('un COLABORADOR con acceso al sistema entra con su usuario (sin @), como en el hub', async () =>
            assert.equal(await f.page.evaluate(() => document.getElementById('ctaMsg').textContent), ''));
        if (await f.page.evaluate(() => !document.getElementById('pCandado').hidden)) await f.page.click('.cand-no');
        await f.page.waitForFunction(() => !document.getElementById('pHome').hidden, null, { timeout: 15000 });
        await f.page.waitForTimeout(400);
        await foto(f.page, 'm6-cuenta');
        await caso('…la cabecera dice quién es, el teléfono queda ligado a su negocio y ve los módulos del plan (solo Cost·ax)', async () => {
            assert.deepEqual(await cabecera(f.page), ['Elizabeth', 'Sesión activa']);
            assert.match(await f.page.evaluate(() => localStorage.getItem('etaax_appmovil_qr')), /"n":"n1","t":"tokA"/);
            assert.deepEqual(await islas(f.page, '#homeMenu'), ['Cost·ax']);
        });
        await f.ctx.close();
        const g = await abrir(browser, {});
        await g.page.click('#btnUsuario'); await g.page.fill('#ctaCorreo', 'eli'); await g.page.fill('#ctaPwd', 'otra');
        await g.page.click('#ctaBtn'); await g.page.waitForTimeout(500);
        await caso('una contraseña equivocada no entra y no dice si el usuario existe', async () =>
            assert.equal(await g.page.evaluate(() => document.getElementById('ctaMsg').textContent), 'Usuario o contraseña incorrectos.'));
        await g.ctx.close();
        const h = await abrir(browser, {});
        await h.page.click('#btnUsuario'); await h.page.fill('#ctaCorreo', 'duena@etaax.prueba'); await h.page.fill('#ctaPwd', 'secreta');
        await h.page.click('#ctaBtn');
        await h.page.waitForFunction(() => !document.getElementById('pCandado').hidden || !document.getElementById('pHome').hidden, null, { timeout: 15000 });
        if (await h.page.evaluate(() => !document.getElementById('pCandado').hidden)) await h.page.click('.cand-no');
        await h.page.waitForFunction(() => !document.getElementById('pHome').hidden, null, { timeout: 15000 });
        await caso('el dueño entra con su correo y ve sus módulos (sin plan = todos)', async () =>
            assert.deepEqual(await islas(h.page, '#homeMenu'), ['Cost·ax', 'Admin·ax', 'Fin·ax', 'Equip·ax']));
        await h.ctx.close();

        /* (v92) La app no es una puerta abierta: solo para las sucursales que
           ETAAX activó, y cada una con su QR. */
        console.log('\n══ App móvil · solo con la sucursal activa (v92) ══');
        const k = await abrir(browser, { apagado: true });
        await k.page.waitForFunction(() => /ya no está activo/.test(document.getElementById('inicioSub').textContent), null, { timeout: 8000 }).catch(() => {});
        await foto(k.page, 'm7-apagada');
        await caso('si apagaron la app de esta sucursal (o el QR ya no vale), la portada lo dice y la clave se apaga', async () => {
            const r = await k.page.evaluate(() => [document.getElementById('inicioSub').textContent,
                document.getElementById('nipZona').classList.contains('apagada'), /apagada/.test(document.getElementById('inicioAviso').textContent)]);
            assert.deepEqual(r, ['Este acceso ya no está activo', true, true]);
        });
        await k.ctx.close();
        const m = await abrir(browser, { ligado: false, movil: { suc_principal: true, suc_dos: false } });
        await m.page.fill('#ctaCorreo', 'eli'); await m.page.fill('#ctaPwd', 'Eli#2026');
        await m.page.click('#ctaBtn');
        await m.page.waitForFunction(() => /no está activa/.test(document.getElementById('ctaMsg').textContent) || !document.getElementById('pHome').hidden || !document.getElementById('pCandado').hidden, null, { timeout: 15000 });
        await caso('con usuario y contraseña: si SU sucursal no tiene la app, no entra (y se dice por qué, no «contraseña mala»)', async () => {
            const r = await m.page.evaluate(() => [document.getElementById('ctaMsg').textContent, document.getElementById('pHome').hidden,
                localStorage.getItem('etaax_movil_perfil'), sessionStorage.getItem('__ses')]);
            assert.match(r[0], /no está activa para tu sucursal/);
            assert.deepEqual(r.slice(1), [true, null, null]);
        });
        await m.ctx.close();
        const o = await abrir(browser, { ligado: false, movil: {} });
        await o.page.fill('#ctaCorreo', 'duena@etaax.prueba'); await o.page.fill('#ctaPwd', 'secreta');
        await o.page.click('#ctaBtn');
        await o.page.waitForFunction(() => /no está activa/.test(document.getElementById('ctaMsg').textContent) || !document.getElementById('pHome').hidden || !document.getElementById('pCandado').hidden, null, { timeout: 15000 });
        await caso('…y el dueño tampoco, si ninguna sucursal de su negocio la tiene', async () =>
            assert.match(await o.page.evaluate(() => document.getElementById('ctaMsg').textContent), /no está activa para tu negocio/));
        await o.ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log(malos.length ? '\n🚨 APP MÓVIL EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '\n🔒 APP MÓVIL EN NAVEGADOR OK — ' + resultados.length + ' casos');
    process.exit(malos.length ? 1 : 0);
})();
