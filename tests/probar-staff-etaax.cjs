/* STAFF ETAAX — el recorrido completo en un navegador de verdad:
     1. el admin maestro da de alta a una persona (usuario + contraseña) y le da
        acceso a negocios: sucursales, módulos y sub-permisos;
     2. esa persona entra en el login de siempre con SU USUARIO, ve su portada
        (sus negocios), entra a uno, ve SOLO sus sucursales, entra a una y ve
        sus módulos con los permisos que se le dieron;
     3. si le quitan el acceso o la desactivan, se entera al recargar.

   El Supabase de mentira de aquí SÍ distingue cuentas: cada signIn revisa
   correo y contraseña, y la sesión es de quien entró (las RPC del Staff ETAAX
   responden según esa sesión, como la v88). La regla de la base se prueba
   aparte, contra Postgres con RLS (tests/probar-sql-v88.mjs).

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-staff-etaax.cjs */
'use strict';
const assert = require('node:assert/strict');
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const RAIZ = path.resolve(__dirname, '..');
const ORIGEN = 'https://etaax.prueba';
const TIPOS = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const resultados = [];
async function caso(nombre, fn) {
    try { await fn(); resultados.push([nombre, true]); console.log('  ✅ ' + nombre); }
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n')[0]); }
}

const { sdkEtx } = require('./sdk-cuentas.cjs');   // el Supabase de mentira con cuentas

const S = 'suc_mia';
const NUBE = {
    __auth: [{ id: 'adm', email: 'admin@etaax.com', password: 'clave-admin' }],
    usuarios: [{ id: 'u1', nombre: 'EGMx', plan: 'gran' }],
    negocios: [{ id: 'A', usuario_id: 'u1', datos: { nombre: 'EGMx', tipo: 'bar', emoji: '🍸' } },
               { id: 'B', usuario_id: 'u2', datos: { nombre: 'Miami SA', tipo: 'bar' } },
               { id: 'C', usuario_id: 'u3', datos: { nombre: 'Café Otro', tipo: 'cafe' } }],
    negocio_sucursales: [
        { negocio_id: 'A', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz', activa: true }, { id: S, nombre: 'El Miami', activa: true }, { id: 'suc_tul', nombre: 'Tulum', activa: true }] } },
        { negocio_id: 'B', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz B', activa: true }] } }],
    staff: [{ id: 'st1', negocio_id: 'A', datos: { id: 'st1', nombre: 'Beto', usuario: 'beto' } }],
    suscripciones: [], solicitudes_plan: [], invitaciones: [], catalogo_proveedores: [], etaax_staff: [], etaax_staff_accesos: []
};
function semilla(nube, sesion) {
    return `(() => {
        window.__avisos = [];
        window.alert = m => { __avisos.push(String(m)); };
        window.confirm = m => { __avisos.push('¿' + String(m)); return true; };
        window.__motivo = ''; window.prompt = m => { __avisos.push('? ' + String(m)); return __motivo; };
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
/* SHOTS=<carpeta>: guarda capturas de cada pantalla para revisarlas a ojo. */
const foto = (page, nombre) => process.env.SHOTS ? page.waitForTimeout(1500).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png'), fullPage: true })) : null;
const nubeDe = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('__nube')));

(async () => {
    const browser = await chromium.launch();
    let nubeFinal = null;
    try {
        /* ══ 1) El admin da de alta y da accesos ══ */
        console.log('\n══ Staff ETAAX · el panel admin ══');
        const { page } = await contexto(browser, NUBE, { id: 'adm', email: 'admin@etaax.com' });
        await page.goto(ORIGEN + '/admin.html');
        await page.waitForFunction(() => document.getElementById('viewAdmin').style.display === 'block' && document.querySelector('.adm-card[data-card="auditores"]'), null, { timeout: 15000 });
        await page.waitForTimeout(500);
        await caso('la tarjeta «Staff ETAAX» ya no es «Próximamente» y abre su pantalla', async () => {
            assert.equal(await page.evaluate(() => document.querySelector('.adm-card[data-card="auditores"]').tagName), 'BUTTON');
            await page.evaluate(() => admArea('plataforma')); await page.waitForTimeout(150);   // (27-nov) la portada va por áreas
            await page.click('.adm-card[data-card="auditores"]'); await page.waitForTimeout(400);
            const t = await texto(page, '#tab-auditores');
            assert.match(t, /Da de alta a la persona con su usuario y su contraseña/);
            assert.match(t, /Todavía no hay nadie/);
        });
        await page.click('#tab-auditores .btn-add'); await page.waitForTimeout(200);
        await page.fill('#etxAltaNombre', 'Ana Auditora');
        await page.fill('#etxAltaUsuario', 'beto'); await page.fill('#etxAltaPass', 'Audita2026Seg');
        await page.click('#etxAltaBtn'); await page.waitForTimeout(300);
        await caso('no deja usar el usuario de un colaborador de un negocio', async () =>
            assert.match(await texto(page, '#tab-auditores'), /ya lo tiene un colaborador/));
        await page.fill('#etxAltaUsuario', 'Ána Auditora'); await page.fill('#etxAltaPass', 'corta');
        await caso('el usuario se normaliza al teclearlo (sin acentos ni espacios)', async () =>
            assert.match(await texto(page, '#etxAltaPrevia'), /Entrará como «ana\.auditora»/));
        await page.click('#etxAltaBtn'); await page.waitForTimeout(300);
        await caso('…y una contraseña débil no pasa', async () =>
            assert.match(await texto(page, '#tab-auditores'), /Contraseña débil/));
        await page.fill('#etxAltaPass', 'Audita2026Seg');
        await page.evaluate(() => { window.__funcionDesplegada = false; });
        await page.click('#etxAltaBtn'); await page.waitForTimeout(500);
        await caso('si la función del servidor no está desplegada, lo dice (y no deja nada a medias)', async () => {
            assert.match(await texto(page, '#tab-auditores'), /Falta desplegar la función «admin-staff-etaax»/);
            assert.equal((await nubeDe(page)).etaax_staff.length, 0);
            assert.equal(await page.evaluate(() => document.getElementById('etxAltaUsuario').value), 'ana.auditora');   // lo tecleado se queda
        });
        await page.evaluate(() => { window.__funcionDesplegada = true; });
        await page.click('#etxAltaBtn'); await page.waitForTimeout(800);
        let uid = null;
        await caso('dar de alta crea la cuenta (correo interno) en el SERVIDOR —sin signUp, que está apagado— con su contraseña y su ficha', async () => {
            const n = await nubeDe(page);
            const cuenta = n.__auth.find(u => u.email === 'ana.auditora@staff.etaax.app');
            assert.ok(cuenta, 'sin cuenta de Auth');
            assert.equal(cuenta.password, 'Audita2026Seg');
            uid = cuenta.id;
            assert.deepEqual(n.etaax_staff.map(s => [s.uid, s.usuario, s.datos.nombre]), [[uid, 'ana.auditora', 'Ana Auditora']]);
            assert.deepEqual(await page.evaluate(() => window.__llamadas), ['crear']);
        });
        await caso('…y queda elegida, diciendo con qué usuario entra', async () =>
            assert.match(await texto(page, '#tab-auditores'), /Entra con el usuario ana\.auditora en el login de siempre/));

        await page.selectOption('#etxNuevoNeg', 'A'); await page.click('text=+ Agregar'); await page.waitForTimeout(250);
        await caso('un acceso nuevo nace con Recetas e Insumos y todas las sucursales, sin guardar', async () => {
            const t = await texto(page, '.etx-acceso[data-neg="A"]');
            assert.match(t, /EGMx Sin guardar/);
            const on = await page.evaluate(() => [...document.querySelectorAll('.etx-acceso[data-neg="A"] .etx-mod.on')].map(x => x.innerText.split('\n')[0].trim()));
            assert.deepEqual(on, ['Escandallos', 'Insumos', 'Inventarios', 'Requisiciones']);
        });
        await page.click('.etx-acceso[data-neg="A"] .mig-check input'); await page.waitForTimeout(200);
        await page.click('.etx-acceso[data-neg="A"] .btn-prim'); await page.waitForTimeout(200);
        await caso('sin «Todas», pide al menos una sucursal (y solo ofrece las de ese negocio)', async () => {
            assert.match(await texto(page, '.etx-acceso[data-neg="A"]'), /Elige al menos una sucursal/);
            assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.etx-acceso[data-neg="A"] .etx-chips .etx-chk')].map(x => x.innerText.trim())),
                ['Matriz', 'El Miami', 'Tulum']);
        });
        await page.click('.etx-acceso[data-neg="A"] .etx-chips .etx-chk:nth-child(2) input'); await page.waitForTimeout(150);
        // Inventarios: ajustar y apagar «Cerrar el inventario».
        await page.evaluate(() => [...document.querySelectorAll('.etx-acceso[data-neg="A"] .etx-mod')].find(x => /Inventarios/.test(x.innerText)).querySelector('.etx-ajustar').click());
        await page.waitForTimeout(150);
        await page.evaluate(() => [...document.querySelectorAll('.etx-acceso[data-neg="A"] .etx-subs .etx-chk')].find(x => /Cerrar el inventario/.test(x.innerText)).querySelector('input').click());
        await page.waitForTimeout(150);
        // Y le damos también Ventas y Cortes (cualquier módulo se puede dar).
        await page.evaluate(() => [...document.querySelectorAll('.etx-acceso[data-neg="A"] .etx-mod')].find(x => /Ventas y Cortes/.test(x.innerText)).querySelector('input').click());
        await page.waitForTimeout(150);
        await caso('el módulo ajustado dice cuántos de sus permisos tiene', async () =>
            assert.match(await texto(page, '.etx-acceso[data-neg="A"]'), /Inventarios 5 de 6/));
        await page.click('.etx-acceso[data-neg="A"] .btn-prim'); await page.waitForTimeout(400);
        await caso('guardar escribe el acceso: su sucursal, sus módulos y el sub-permiso apagado', async () => {
            const a = (await nubeDe(page)).etaax_staff_accesos.find(x => x.uid === uid && x.negocio_id === 'A');
            assert.deepEqual(a.datos.sucursales, [S]);
            assert.equal(a.datos.permisos.recetas, true);
            assert.equal(a.datos.permisos.ventas, true);
            assert.equal(a.datos.permisos.gastos, false);
            assert.equal(a.datos.permisos.inventarios.cerrar, false);
            assert.equal(a.datos.permisos.inventarios.capturar, true);
            assert.equal('_contadas' in a.datos, false);
        });
        await page.selectOption('#etxNuevoNeg', 'B'); await page.click('text=+ Agregar'); await page.waitForTimeout(200);
        await page.click('.etx-acceso[data-neg="B"] .btn-prim'); await page.waitForTimeout(400);
        await page.click('.etx-acceso[data-neg="B"] >> text=Pausar'); await page.waitForTimeout(400);
        await caso('un segundo negocio con todas sus sucursales, y en pausa', async () => {
            const b = (await nubeDe(page)).etaax_staff_accesos.find(x => x.uid === uid && x.negocio_id === 'B');
            assert.deepEqual(b.datos.sucursales, []);
            assert.equal(b.datos.activo, false);
            assert.match(await texto(page, '.etx-acceso[data-neg="B"]'), /En pausa/);
        });
        await caso('el negocio ya dado no se vuelve a ofrecer', async () =>
            assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#etxNuevoNeg option')].map(o => o.value).filter(Boolean)), ['C']));
        await page.fill('#etxClaveNueva', 'NuevaClave2026x'); await page.click('text=Cambiar contraseña'); await page.waitForTimeout(400);
        await caso('cambiar la contraseña la cambia en su cuenta', async () => {
            assert.equal((await nubeDe(page)).__auth.find(u => u.id === uid).password, 'NuevaClave2026x');
            assert.match(await texto(page, '#tab-auditores'), /Contraseña cambiada/);
        });
        await foto(page, '1-admin-staff-etaax');
        nubeFinal = await nubeDe(page);

        /* ══ 2) La persona entra con su usuario ══ */
        console.log('\n══ Staff ETAAX · entrar y trabajar ══');
        const s2 = await contexto(browser, nubeFinal, null);
        const p2 = s2.page;
        await p2.goto(ORIGEN + '/hub.html');
        await p2.waitForFunction(() => document.getElementById('viewLogin').style.display !== 'none');
        await p2.fill('#loginEmail', 'ana.auditora'); await p2.fill('#loginPwd', 'Audita2026Seg');
        await p2.click('#viewLogin .btn-auth'); await p2.waitForTimeout(1200);
        await caso('con la contraseña vieja no entra (y el mensaje no delata nada)', async () =>
            assert.match(await texto(p2, '#loginError'), /Usuario o contraseña incorrectos/));
        await p2.fill('#loginPwd', 'NuevaClave2026x');
        await Promise.all([p2.waitForURL(/staff-etaax\.html/), p2.click('#viewLogin .btn-auth')]);
        await p2.waitForFunction(() => document.getElementById('vPortal').style.display !== 'none');
        await caso('con su usuario entra a SU portada: solo el negocio activo (el pausado no sale)', async () => {
            const t = await texto(p2, '#vPortal');
            assert.match(t, /Hola, Ana Auditora/);
            assert.deepEqual(await p2.evaluate(() => [...document.querySelectorAll('.neg')].map(x => x.dataset.neg)), ['A']);
            assert.match(await texto(p2, '.neg[data-neg="A"]'), /1 sucursal EGMx Escandallos Insumos Inventarios Requisiciones Ventas y Cortes Entrar/);
        });
        await foto(p2, '2-portada');
        await Promise.all([p2.waitForURL(/hub\.html/), p2.click('.neg[data-neg="A"]')]);
        await p2.waitForFunction(() => document.getElementById('viewNegocios').style.display !== 'none' && document.querySelector('#listSucursales .suc-caja'));
        await caso('al entrar al negocio ve sus sucursales como cualquier negocio, pero SOLO la suya', async () => {
            assert.deepEqual(await p2.evaluate(() => [...document.querySelectorAll('#listSucursales .neg-card-nombre')].map(x => x.innerText.replace(/\s+/g, ' ').trim())), ['El Miami']);
            assert.match(await texto(p2, '#negHeroTitle'), /ELIGE UNA SUCURSAL/);
            assert.match(await texto(p2, '#sucPlanSub'), /1 sucursal con acceso/);
        });
        await caso('…sin lo del dueño: ni ajustes de sucursal, ni sucursal nueva, ni precios, ni globales', async () => {
            const vis = await p2.evaluate(() => ['.hub-suc-ajustes', '#btnNuevaSucWrap', '.hub-global-grid', '#hubConfigNeg']
                .map(s => { const e = document.querySelector(s); return !!(e && e.getClientRects().length); }));
            assert.deepEqual(vis, [false, false, false, false]);
            assert.match(await texto(p2, '#brandInfoBar'), /Mis negocios/);
        });
        await foto(p2, '3-sucursales');
        await Promise.all([p2.waitForNavigation(), p2.click('#listSucursales .hub-suc-accion:not(.hub-suc-ajustes)')]);
        await p2.waitForFunction(() => document.getElementById('viewModulos').style.display !== 'none');
        await p2.waitForTimeout(400);
        await caso('al entrar a la sucursal: sus módulos, como colaborador con el rol del Staff ETAAX', async () => {
            const c = await p2.evaluate(() => JSON.parse(localStorage.getItem('etaax_ctx')));
            assert.deepEqual([c.ctxType, c.rol, c.sucId, c.negId, c.userBadge], ['staff', 'etaax_staff', S, 'A', 'Staff ETAAX']);
            const btn = await p2.evaluate(() => { const b = document.getElementById('btnEtxSucursales'); return !!(b && b.getClientRects().length); });
            assert.equal(btn, true);
        });
        await foto(p2, '4-modulos');
        await caso('los permisos salen de SU acceso: inventario sí (sin cerrar), ventas sí, gastos no', async () => {
            const r = await p2.evaluate(() => [etaaxPerm('A', 'etaax_staff', 'inventarios.capturar'), etaaxPerm('A', 'etaax_staff', 'inventarios.cerrar'),
                etaaxPerm('A', 'etaax_staff', 'ventas'), etaaxPerm('A', 'etaax_staff', 'gastos'), etaaxPerm('A', 'etaax_staff', 'recetas', 'suc_tul')]);
            assert.deepEqual(r, [true, false, true, false, false]);
        });
        await caso('la bitácora lo registra como staff_etaax', async () =>
            assert.ok((await p2.evaluate(() => window.__rpcs)).indexOf('acceso_registrar') > -1));
        await p2.goto(ORIGEN + '/financiero/kpis.html'); await p2.waitForURL(/hub\.html/, { timeout: 8000 }).catch(() => {});
        await caso('a un módulo que no le dieron (Financiero), page-guard lo regresa al hub', async () =>
            assert.match(p2.url(), /hub\.html\?denegado=financiero/));
        await p2.waitForFunction(() => document.getElementById('viewModulos').style.display !== 'none' || document.getElementById('viewNegocios').style.display !== 'none');
        await p2.evaluate(() => _etxVerSucursales()); await p2.waitForTimeout(300);
        await caso('«← Sucursales» regresa a la lista de sucursales del negocio', async () => {
            assert.equal(await p2.evaluate(() => document.getElementById('viewNegocios').style.display !== 'none'), true);
            assert.equal(await p2.evaluate(() => localStorage.getItem('etaax_sucursal_activa')), null);
        });

        /* ══ 3) Le quitan el acceso / lo desactivan ══ */
        console.log('\n══ Staff ETAAX · quitar y desactivar ══');
        await p2.evaluate(() => { const n = JSON.parse(localStorage.getItem('__nube')); n.etaax_staff_accesos = n.etaax_staff_accesos.filter(a => a.negocio_id !== 'A'); localStorage.setItem('__nube', JSON.stringify(n)); });
        await Promise.all([p2.waitForURL(/staff-etaax\.html/), p2.reload()]);
        await p2.waitForFunction(() => document.getElementById('vPortal').style.display !== 'none');
        await caso('sin el acceso, al recargar regresa a su portada y ya no ve el negocio', async () => {
            assert.match(await texto(p2, '#listaNeg'), /Todavía no tienes negocios asignados/);
            assert.equal(await p2.evaluate(() => localStorage.getItem('etaax_A_acceso_etx')), null);
        });
        await p2.evaluate(() => { const n = JSON.parse(localStorage.getItem('__nube')); n.etaax_staff[0].datos.activo = false; localStorage.setItem('__nube', JSON.stringify(n)); });
        await p2.reload(); await p2.waitForFunction(() => document.getElementById('vAviso').style.display !== 'none');
        await caso('desactivado: su portada se lo dice y no enseña nada', async () =>
            assert.match(await texto(p2, '#vAviso'), /Tu acceso está desactivado/));
        await caso('sin sesión, la portada manda al login', async () => {
            await p2.evaluate(() => sessionStorage.removeItem('__ses'));
            await Promise.all([p2.waitForURL(/hub\.html/), p2.reload()]);
        });
        await s2.ctx.close();

        /* ══ 4) Baja ══ */
        console.log('\n══ Staff ETAAX · baja ══');
        await page.evaluate(() => { window.__motivo = 'ana.auditora'; });
        await page.click('text=Dar de baja'); await page.waitForTimeout(500);
        await caso('dar de baja pide escribir el usuario, borra ficha, accesos y su cuenta', async () => {
            const n = await nubeDe(page);
            assert.equal(n.etaax_staff.length, 0);
            assert.equal(n.etaax_staff_accesos.length, 0);
            assert.equal(n.__auth.some(u => u.email === 'ana.auditora@staff.etaax.app'), false);
            assert.match(await texto(page, '#tab-auditores'), /Todavía no hay nadie/);
        });
        await page.fill('#etxNombre', 'x').catch(() => {});
        await page.click('#tab-auditores .btn-add'); await page.waitForTimeout(150);
        await page.fill('#etxAltaNombre', 'Ana Otra Vez'); await page.fill('#etxAltaUsuario', 'ana.auditora'); await page.fill('#etxAltaPass', 'Regreso2026Ok');
        await page.click('#etxAltaBtn'); await page.waitForTimeout(800);
        await caso('se puede volver a dar de alta con el mismo usuario, con la contraseña nueva', async () => {
            const n = await nubeDe(page);
            const cuentas = n.__auth.filter(u => u.email === 'ana.auditora@staff.etaax.app');
            assert.equal(cuentas.length, 1);
            assert.equal(cuentas[0].password, 'Regreso2026Ok');
            assert.deepEqual(n.etaax_staff.map(s => s.uid), [cuentas[0].id]);
        });
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log('\n' + (malos.length ? '🚨 STAFF ETAAX EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '🔒 STAFF ETAAX EN NAVEGADOR OK — ' + resultados.length + ' casos'));
    process.exit(malos.length ? 1 : 0);
})();
