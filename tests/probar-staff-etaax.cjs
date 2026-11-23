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

/* ── El Supabase de mentira, con cuentas de verdad ─────────────────────────── */
function sdkEtx() {
    var LL = '__nube';
    function nube() { try { return JSON.parse(localStorage.getItem(LL) || '{}'); } catch (e) { return {}; } }
    function guarda(db) { localStorage.setItem(LL, JSON.stringify(db)); }
    function ses() { try { return JSON.parse(sessionStorage.getItem('__ses') || 'null'); } catch (e) { return null; } }
    function user() { var s = ses(); return s ? { id: s.id, email: s.email, user_metadata: s.meta || {} } : null; }
    window.__nube = { leer: nube, escribir: guarda, caida: false, escrituras: [], log: function () { return []; } };
    window.__rpcs = [];
    function val(r, k) { return (k in r) ? r[k] : (r.datos || {})[k]; }
    function query(tabla) {
        var f = [], modo = 'select', valor = null, opc = {}, single = false, orden = null, desc = false, q = {};
        ['range', 'gte', 'lt', 'lte', 'neq', 'or', 'not', 'ilike', 'like', 'filter', 'contains', 'gt', 'limit'].forEach(function (k) { q[k] = function () { return q; }; });
        q.select = function () { return q; };
        q.order = function (c, o) { orden = c; desc = !!(o && o.ascending === false); return q; };
        q.eq = function (k, v) { f.push([k, v]); return q; };
        q.in = function (k, v) { f.push([k, v, 'in']); return q; };
        q.maybeSingle = function () { single = true; return q; };
        q.single = function () { single = true; return q; };
        q.upsert = function (v, o) { modo = 'upsert'; valor = v; opc = o || {}; return q; };
        q.insert = function (v) { modo = 'upsert'; valor = v; return q; };
        q.update = function (v) { modo = 'update'; valor = v; return q; };
        q.delete = function () { modo = 'delete'; return q; };
        q.then = function (res, rej) {
            var db = nube(), filas = db[tabla] || [], data = null;
            var pasa = function (r) { return f.every(function (c) { return c[2] === 'in' ? c[1].indexOf(val(r, c[0])) > -1 : val(r, c[0]) === c[1]; }); };
            if (modo === 'upsert') {
                (Array.isArray(valor) ? valor : [valor]).forEach(function (v) {
                    var claves = (opc.onConflict || (v.id !== undefined ? 'id' : 'negocio_id')).split(',');
                    var i = filas.findIndex(function (r) { return claves.every(function (k) { return r[k] === v[k]; }); });
                    var fila = JSON.parse(JSON.stringify(v));
                    if (i > -1) filas[i] = Object.assign(filas[i], fila); else filas.push(fila);
                    window.__nube.escrituras.push(tabla);
                });
                db[tabla] = filas; guarda(db); data = valor;
            } else if (modo === 'update') {
                filas.filter(pasa).forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(valor))); });
                db[tabla] = filas; guarda(db);
            } else if (modo === 'delete') {
                db[tabla] = filas.filter(function (r) { return !pasa(r); }); guarda(db);
            } else {
                data = JSON.parse(JSON.stringify(filas.filter(pasa)));
                if (orden) data.sort(function (a, b) { var x = String(val(a, orden)), y = String(val(b, orden)); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); });
                if (single) data = data[0] || null;
            }
            return Promise.resolve({ data: data, error: null }).then(res, rej);
        };
        return q;
    }
    function activo(x) { return !!x && (x.datos || {}).activo !== false; }
    var RPC = {
        etx_mis_negocios: function () {
            var u = user(), db = nube(); if (!u) return [];
            var s = (db.etaax_staff || []).find(function (x) { return x.uid === u.id; });
            if (!activo(s)) return [];
            return (db.etaax_staff_accesos || []).filter(function (a) { return a.uid === u.id && activo(a); }).map(function (a) {
                var n = (db.negocios || []).find(function (x) { return x.id === a.negocio_id; }) || {};
                return { negocio_id: a.negocio_id, negocio: n.datos || {}, acceso: a.datos };
            });
        },
        admin_etx_uid: function (p) { var x = (nube().__auth || []).find(function (u) { return u.email === String(p.p_email).toLowerCase(); }); return x ? x.id : null; },
        admin_etx_clave: function (p) {
            var db = nube(), x = (db.__auth || []).find(function (u) { return u.id === p.p_uid; });
            if (!x || !/@staff\.etaax\.app$/.test(x.email)) throw new Error('Esa cuenta no es del Staff ETAAX.');
            x.password = p.p_clave; guarda(db); return null;
        },
        admin_etx_baja: function (p) {
            var db = nube();
            db.etaax_staff = (db.etaax_staff || []).filter(function (s) { return s.uid !== p.p_uid; });
            db.etaax_staff_accesos = (db.etaax_staff_accesos || []).filter(function (s) { return s.uid !== p.p_uid; });
            var x = (db.__auth || []).find(function (u) { return u.id === p.p_uid; }); if (x) x.password = '~' + Math.random();
            guarda(db); return null;
        }
    };
    /* La Edge Function admin-staff-etaax, de mentira: mismas respuestas y mismos
       candados (solo la sesión del admin). `__funcionDesplegada = false` simula
       que todavía no se desplegó (el navegador no recibe respuesta). */
    var fetchReal = window.fetch;
    window.__funcionDesplegada = true; window.__llamadas = [];
    window.fetch = async function (url, opc) {
        if (String(url).indexOf('/functions/v1/admin-staff-etaax') === -1) return fetchReal.apply(this, arguments);
        if (!window.__funcionDesplegada) throw new TypeError('Failed to fetch');
        var resp = function (b, st) { return new Response(JSON.stringify(b), { status: st || 200, headers: { 'Content-Type': 'application/json' } }); };
        var u = user();
        if (!u || u.email !== 'admin@etaax.com' || !/^Bearer ./.test((opc.headers || {}).Authorization || '')) return resp({ ok: false, error: 'Sesión no válida.' }, 401);
        var b = JSON.parse(opc.body), db = nube(); db.__auth = db.__auth || [];
        window.__llamadas.push(b.accion);
        var delStaff = function (uid) { var x = db.__auth.find(function (a) { return a.id === uid; }); return !!x && /@staff\.etaax\.app$/.test(x.email); };
        if (b.accion === 'crear') {
            if ((db.etaax_staff || []).some(function (x) { return x.usuario === b.usuario; })) return resp({ ok: false, error: 'Ya hay alguien del Staff ETAAX con ese usuario.' }, 409);
            if ((db.staff || []).some(function (x) { return (x.datos || {}).usuario === b.usuario; })) return resp({ ok: false, error: 'Ese usuario ya lo tiene un colaborador de un negocio. Elige otro.' }, 409);
            var email = b.usuario + '@staff.etaax.app', x = db.__auth.find(function (a) { return a.email === email; });
            if (x) x.password = b.password;
            else { x = { id: 'uid-' + Math.random().toString(36).slice(2, 10), email: email, password: b.password, meta: { nombre: b.nombre } }; db.__auth.push(x); }
            db.etaax_staff = (db.etaax_staff || []).filter(function (r) { return r.uid !== x.id; });
            db.etaax_staff.push({ uid: x.id, usuario: b.usuario, datos: { nombre: b.nombre } });
            guarda(db); return resp({ ok: true, uid: x.id });
        }
        if (b.accion === 'clave') {
            if (!delStaff(b.uid)) return resp({ ok: false, error: 'Esa cuenta no es del Staff ETAAX.' }, 400);
            db.__auth.find(function (a) { return a.id === b.uid; }).password = b.password; guarda(db); return resp({ ok: true });
        }
        if (b.accion === 'baja') {
            if (!delStaff(b.uid)) return resp({ ok: false, error: 'Esa cuenta no es del Staff ETAAX.' }, 400);
            db.etaax_staff = (db.etaax_staff || []).filter(function (r) { return r.uid !== b.uid; });
            db.etaax_staff_accesos = (db.etaax_staff_accesos || []).filter(function (r) { return r.uid !== b.uid; });
            db.__auth = db.__auth.filter(function (a) { return a.id !== b.uid; });
            guarda(db); return resp({ ok: true });
        }
        return resp({ ok: false, error: 'Acción desconocida.' }, 400);
    };
    window.supabase = { createClient: function (url, key, o) {
        var efimero = !!(o && o.auth && o.auth.persistSession === false), local = null;
        var quien = function () { return efimero ? local : user(); };
        return {
            auth: {
                getSession: async function () { var u = quien(); return { data: { session: u ? { user: u, access_token: 'x' } : null }, error: null }; },
                getUser: async function () { return { data: { user: quien() }, error: null }; },
                onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
                signInWithPassword: async function (c) {
                    var x = (nube().__auth || []).find(function (u) { return u.email === String(c.email).toLowerCase() && u.password === c.password; });
                    if (!x) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
                    var uu = { id: x.id, email: x.email, user_metadata: x.meta || {} };
                    if (efimero) local = uu; else sessionStorage.setItem('__ses', JSON.stringify({ id: x.id, email: x.email, meta: x.meta }));
                    return { data: { user: uu, session: { user: uu } }, error: null };
                },
                // Como en producción: los registros abiertos están apagados.
                signUp: async function () { return { data: { user: null }, error: { message: 'Signups not allowed for this instance' } }; },
                signOut: async function () { if (efimero) local = null; else sessionStorage.removeItem('__ses'); return { error: null }; },
                refreshSession: async function () { return { data: { session: null }, error: null }; },
                updateUser: async function () { return { data: {}, error: null }; }
            },
            from: query,
            rpc: async function (fn, p) {
                window.__rpcs.push(fn);
                if (RPC[fn]) { try { return { data: RPC[fn](p || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } }
                return { data: null, error: null };
            },
            channel: function () { return { on: function () { return this; }, subscribe: function () { return this; }, track: async function () {}, presenceState: function () { return {}; }, unsubscribe: function () {} }; },
            removeChannel: async function () {},
            storage: { from: function () { return { upload: async function () { return { error: null }; }, getPublicUrl: function () { return { data: { publicUrl: '' } }; },
                createSignedUrl: async function () { return { data: { signedUrl: '' }, error: null }; } }; } }
        };
    } };
}

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
