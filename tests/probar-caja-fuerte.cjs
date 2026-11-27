/* LA CAJA FUERTE EN VISTAS (Edwin, 26-nov) — en un Chromium de verdad con
   diario.html tal cual y el Supabase de mentira.
     · Gestión trae una tarjeta por vista: Saldo disponible, Cuentas bancarias,
       Previsiones, Anticipos y Otros apartados; cada una abre la caja en la suya.
     · Saldo disponible: TOTAL (todo el dinero) y DISPONIBLE (lo conciliado sin
       previsiones, anticipos ni otros apartados), con su desglose.
     · Cuentas bancarias: por cuenta, total calculado, conciliado, sin conciliar,
       y lo comprometido de esa cuenta (el anticipo que entró ahí) fuera del
       disponible; «Conciliar» con una sola cuenta.
     · Otros apartados: crear con concepto, apartar más y liberar (queda rastro).

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-caja-fuerte.cjs
   SHOTS=<carpeta> guarda capturas. */
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
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n').filter(Boolean).slice(0, 6).join(' ')); }
}
const reg = (tabla, d) => ({ id: d.id, negocio_id: 'n1', datos: Object.assign({ negocioId: 'n1', sucursalId: 'suc_principal' }, d) });
const NUBE = {
    __auth: [{ id: 'u1', email: 'duena@etaax.prueba', password: 'x', meta: { nombre: 'Dueña' } }],
    negocios: [{ id: 'n1', usuario_id: 'u1', datos: { nombre: 'GRUPO JP' } }],
    negocio_sucursales: [{ negocio_id: 'n1', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz', activa: true }] } }],
    suscripciones: [{ negocio_id: 'n1', estado: 'activa', plan: null }],
    tarjetas_credito: [reg('t', { id: 'c1', tipo: 'debito', banco: 'BBVA', alias: 'Principal', digitos: '1234', predeterminada: true, activa: true })],
    depositos: [
        reg('d', { id: 'm1', fecha: '2026-11-20', monto: 10000, origen: 'externo', destino: 'caja_fuerte', concepto: 'Fondo inicial' }),
        reg('d', { id: 'm2', fecha: '2026-11-20', monto: 5000, origen: 'externo', destino: 'banco', destinoCuentaId: 'c1', concepto: 'Depósito' }),
        reg('d', { id: 'an1', tipo: 'anticipo', fecha: '2026-11-21', monto: 700, cliente: 'Boda Pérez', concepto: 'Anticipo boda', fechaEvento: '2026-12-20',
                   fondo: 'banco', cuentaId: 'c1', origen: 'externo', destino: 'banco', destinoCuentaId: 'c1' }),
        reg('d', { id: 'an2', tipo: 'anticipo', fecha: '2026-11-22', monto: 250, cliente: 'Cumpleaños Ruiz', concepto: 'Anticipo', fechaEvento: '2026-11-01',
                   fondo: 'caja_fuerte', origen: 'externo', destino: 'caja_fuerte' }),
        reg('d', { id: 'ap1', tipo: 'apartado', previsionId: 'p1', fondo: 'caja_fuerte', fecha: '2026-11-22', monto: 1000, concepto: 'Apartado aguinaldo' }),
        reg('d', { id: 'ap2', tipo: 'apartado', previsionId: 'a1', fondo: 'banco', fondoCuentaId: 'c1', fecha: '2026-11-23', monto: 500, concepto: 'Apartado · Fondo de emergencia' }),
    ],
    previsiones: [reg('p', { id: 'p1', concepto: 'Aguinaldo', montoObjetivo: 6000, estado: 'en_curso', fechaObjetivo: '2026-12-15' }),
                  reg('p', { id: 'a1', concepto: 'Fondo de emergencia', clase: 'apartado', tipo: 'apartado', estado: 'en_curso', montoObjetivo: 0 })],
    cortes: [], gastos: [], permisos: []
};
function semilla(n) {
    return `(() => {
        window.alert = (m) => { (window.__avisos = window.__avisos || []).push(String(m)); };
        if (!localStorage.getItem('__sembrado')) {
            localStorage.clear();
            localStorage.setItem('__nube', ${JSON.stringify(JSON.stringify(n))});
            localStorage.setItem('etaax_negocio_activo', 'n1');
            localStorage.setItem('etaax_sucursal_activa', 'suc_principal');
            localStorage.setItem('etaax_ctx', JSON.stringify({ ctxType: 'owner', negId: 'n1', negNombre: 'GRUPO JP', sucId: 'suc_principal', sucNombre: 'Matriz', userName: 'Dueña' }));
            localStorage.setItem('etaax_negocios', JSON.stringify([{ id: 'n1', usuarioId: 'u1', nombre: 'GRUPO JP' }]));
            localStorage.setItem('etaax_n1_sucursales', JSON.stringify([{ id: 'suc_principal', nombre: 'Matriz' }]));
            localStorage.setItem('etaax_novedades_vista', '{}');
            localStorage.setItem('__sembrado', '1');
        }
        if (!sessionStorage.getItem('__ses')) sessionStorage.setItem('__ses', JSON.stringify({ id: 'u1', email: 'duena@etaax.prueba' }));
    })();`;
}
const foto = (page, nombre) => process.env.SHOTS ? page.waitForTimeout(400).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png') })) : null;
const tiles = (p) => p.evaluate(() => [...document.querySelectorAll('#cajBody .cjv-tile')].map(t => t.querySelector('.cjv-tile-tit').textContent + '=' + t.querySelector('.cjv-tile-val').textContent));
const filas = (p, raiz) => p.evaluate((r) => [...document.querySelectorAll((r || '#cajBody .cjv-vista > .cjv-eq') + ' .cjv-fila')].map(f => (f.querySelector('.cjv-signo').textContent + ' ' + f.querySelector('.cjv-lbl').firstChild.textContent + ' ' + f.querySelector('.cjv-monto').textContent).trim()), raiz);

(async () => {
    const browser = await chromium.launch();
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (url.origin === ORIGEN) {
                const f = path.join(RAIZ, decodeURIComponent(url.pathname));
                if (f.startsWith(RAIZ) && fs.existsSync(f) && fs.statSync(f).isFile())
                    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' } });
                return route.fulfill({ status: 404, body: '' });
            }
            if (/supabase-js/.test(url.href)) return route.fulfill({ status: 200, body: '(' + sdkEtx.toString() + ')();', headers: { 'content-type': 'application/javascript' } });
            if (/fonts\.(googleapis|gstatic)/.test(url.host)) return route.fulfill({ status: 200, body: '' });
            return route.abort();
        });
        await ctx.addInitScript(semilla(NUBE));
        const p = await ctx.newPage();
        p.setDefaultTimeout(15000);
        p.on('pageerror', e => console.log('  [pageerror]', e.message));
        await p.goto(ORIGEN + '/administrativo/diario.html?vista=gestion');
        await p.waitForFunction(() => typeof abrirCajaFuerte === 'function' && (window._cacheDeps || []).length >= 6 && (window._cachePrevs || []).length >= 2 && (window._cuentasBancarias || []).length >= 1, null, { timeout: 30000 });
        await p.waitForTimeout(800);

        console.log('\n══ La puerta: contraseña una vez, al entrar ══');
        await foto(p, 'k0a-candado');
        await caso('al entrar a «Caja fuerte · Gestión de saldos» pide la contraseña y las tarjetas quedan ocultas', async () => {
            const r = await p.evaluate(() => [document.getElementById('modalAdminGuard') && getComputedStyle(document.getElementById('modalAdminGuard')).display !== 'none',
                document.body.classList.contains('cj-cerrada'), [...document.querySelectorAll('.dx-card[data-fn]')].some(b => b.offsetParent), document.getElementById('etxCtxTitulo').textContent]);
            assert.deepEqual(r, [true, true, false, 'Caja fuerte']);
        });
        await p.evaluate(() => { window.__claves = 0; window._pedirClaveAdmin = (a, cb) => { __claves++; cb(); }; _cerrarAdminGuard(); _cjPedirEntrada(); });
        await caso('…con la contraseña se abre', async () =>
            assert.deepEqual(await p.evaluate(() => [document.body.classList.contains('cj-cerrada'), __claves]), [false, 1]));

        console.log('\n══ Gestión · una tarjeta por vista ══');
        await foto(p, 'k0-gestion');
        await caso('Gestión trae Saldo disponible, Cuentas bancarias, Previsiones, Anticipos y Otros apartados', async () => {
            const t = await p.evaluate(() => [...document.querySelectorAll('.dx-card[data-fn]')].filter(b => b.offsetParent).map(b => b.querySelector('.dx-card-title').textContent.trim()));
            assert.deepEqual(t, ['Saldo disponible', 'Cuentas bancarias', 'Previsiones', 'Anticipos', 'Otros apartados']);
        });

        console.log('\n══ Saldo disponible ══');
        await p.click('.dx-card[data-fn="caja"]'); await p.waitForSelector('#cajOverlay.open .cjv-tabs');
        await foto(p, 'k1-disponible');
        await caso('TOTAL $15,950 (caja 10,250 + banco 5,700) y DISPONIBLE $13,500', async () =>
            assert.deepEqual(await tiles(p), ['Total=$15,950.00', 'Disponible=$13,500.00']));
        await caso('…con su desglose: total, menos previsiones, anticipos y otros apartados = disponible', async () =>
            assert.deepEqual(await filas(p), ['Efectivo en caja fuerte $10,250.00', '+ Bancos · conciliado $5,700.00', '= Total $15,950.00',
                '− Previsiones $1,000.00', '− Anticipos por aplicar $950.00', '− Otros apartados $500.00', '= Disponible $13,500.00']));
        await caso('las pestañas dicen cuánto hay en cada vista', async () => {
            const t = await p.evaluate(() => [...document.querySelectorAll('#cajBody .cjv-tab')].map(b => b.querySelector('.cjv-tab-tx').textContent + ' ' + b.querySelector('b').textContent));
            assert.deepEqual(t, ['Saldo disponible $13,500.00', 'Cuentas bancarias $5,700.00', 'Previsiones $1,000.00', 'Anticipos $950.00', 'Otros apartados $500.00']);
        });

        console.log('\n══ Cuentas bancarias ══');
        await p.click('#cajBody .cjv-tab[data-vista="bancos"]'); await p.waitForTimeout(200);
        await foto(p, 'k2-bancos');
        await caso('total calculado, sin conciliar y disponible en bancos (5,700 − 700 anticipo − 500 apartado)', async () =>
            assert.deepEqual(await tiles(p), ['Total calculado=$5,700.00', 'Sin conciliar=$0.00', 'Disponible en bancos=$4,500.00']));
        await caso('la cuenta BBVA desglosa conciliado, el anticipo que entró ahí y el apartado: disponible $4,500', async () =>
            assert.deepEqual(await filas(p, '#cajBody .cjv-cta .cjv-eq'), ['Total calculado $5,700.00', 'Conciliado $5,700.00', '− Anticipos por aplicar $700.00', '− Otros apartados $500.00', '= Disponible $4,500.00']));
        await caso('…y con UNA sola cuenta ya se puede conciliar', async () => {
            await p.click('#cajBody .cjv-cta [onclick^="conciliarCuenta"]'); await p.waitForTimeout(200);
            assert.equal(await p.evaluate(() => document.getElementById('concOverlay').classList.contains('open') && document.getElementById('concCalc').textContent), '$5,700.00');
            await p.evaluate(() => cerrarConciliar());
        });

        console.log('\n══ Previsiones y anticipos ══');
        await p.click('#cajBody .cjv-tab[data-vista="previsiones"]'); await p.waitForTimeout(200);
        await foto(p, 'k3-previsiones');
        await caso('Previsiones: el Aguinaldo con su meta y su saldo (sin el fondo de emergencia)', async () => {
            const r = await p.evaluate(() => [...document.querySelectorAll('#cajBody .cjv-tabla tbody tr')].map(tr => tr.cells[0].querySelector('b').textContent + ' ' + tr.cells[1].textContent + ' ' + tr.cells[4].textContent));
            assert.deepEqual(r, ['Aguinaldo $6,000.00 $1,000.00']);
        });
        await caso('…y sus metas se gestionan desde aquí (sin ir a otra página ni a Fin·ax)', async () =>
            assert.deepEqual(await p.evaluate(() => [!!document.querySelector('#cajBody a[href*="financiero/"]'), !!document.querySelector('#cajBody [onclick="abrirCjCfg(\'previsiones\',1)"]'), !!document.querySelector('#cajBody [onclick="abrirCjCfg(\'previsiones\')"]')]), [false, true, true]));
        await p.click('#cajBody .cjv-tab[data-vista="anticipos"]'); await p.waitForTimeout(200);
        await foto(p, 'k4-anticipos');
        await caso('Anticipos: los dos con su saldo, dónde está cada uno, y el vencido marcado', async () => {
            const r = await p.evaluate(() => [...document.querySelectorAll('#cajBody .cjv-tabla tbody tr')].map(tr => tr.cells[0].querySelector('b').textContent + ' · ' + tr.cells[3].textContent + ' · ' + tr.cells[4].textContent + (tr.classList.contains('cjv-venc') ? ' · vencido' : '')).sort());
            assert.deepEqual(r, ['Boda Pérez · BBVA · Principal ····1234 · $700.00', 'Cumpleaños Ruiz · Caja fuerte · $250.00 · vencido']);
        });

        console.log('\n══ Otros apartados ══');
        await p.click('#cajBody .cjv-tab[data-vista="apartados"]'); await p.waitForTimeout(200);
        await caso('el Fondo de emergencia con sus $500 en el banco', async () => {
            const r = await p.evaluate(() => [...document.querySelectorAll('#cajBody .cjv-tabla tbody tr')].map(tr => tr.cells[0].querySelector('b').textContent + ' ' + tr.cells[1].textContent + ' ' + tr.cells[2].textContent));
            assert.deepEqual(r, ['Fondo de emergencia $500.00 banco $500.00']);
        });
        await p.click('#cajBody [onclick="abrirAptLibre(\'nuevo\')"]'); await p.waitForSelector('#modalAptLibre.open');
        await p.fill('#aptConcepto', 'Remodelación'); await p.fill('#aptMonto', '2000'); await p.selectOption('#aptFondo', 'caja_fuerte');
        await foto(p, 'k5-nuevo-apartado');
        await caso('la ventanita de nuevo apartado queda encima de la caja fuerte', async () => {
            const r = await p.evaluate(() => { const b = document.getElementById('aptBtnGuardar').getBoundingClientRect(); return document.elementFromPoint(b.left + 5, b.top + 5).closest('#modalAptLibre') !== null; });
            assert.equal(r, true);
        });
        await p.click('#aptBtnGuardar'); await p.waitForTimeout(300);
        await caso('crear «Remodelación» con $2,000 en caja: aparece y el disponible baja a $11,500', async () => {
            const r = await p.evaluate(() => [...document.querySelectorAll('#cajBody .cjv-tabla tbody tr')].map(tr => tr.cells[0].querySelector('b').textContent + ' ' + tr.cells[1].textContent));
            assert.deepEqual(r, ['Remodelación $2,000.00', 'Fondo de emergencia $500.00']);
            assert.equal(await p.evaluate(() => document.querySelector('#cajBody .cjv-tab[data-vista="disponible"] b').textContent), '$11,500.00');
        });
        await caso('…se guarda como previsión de clase «apartado» y un movimiento que no mueve dinero', async () => {
            const n = await p.evaluate(() => JSON.parse(localStorage.getItem('__nube')));
            const prev = n.previsiones.map(x => x.datos).find(x => x.concepto === 'Remodelación');
            const mov = n.depositos.map(x => x.datos).find(x => x.previsionId === (prev && prev.id));
            assert.deepEqual([prev && prev.clase, mov && mov.tipo, mov && mov.monto, mov && mov.fondo], ['apartado', 'apartado', 2000, 'caja_fuerte']);
        });
        await p.evaluate(() => { const b = [...document.querySelectorAll('#cajBody .cjv-tabla tbody tr')].find(tr => /Remodelación/.test(tr.textContent)); b.querySelector('[onclick^="abrirAptLibre(\'liberar\'"]').click(); });
        await p.waitForSelector('#modalAptLibre.open');
        await p.fill('#aptMonto', '500'); await p.click('#aptBtnGuardar'); await p.waitForTimeout(300);
        await caso('liberar $500 deja $1,500 y el disponible sube a $12,000 (con rastro: un apartado en negativo)', async () => {
            const r = await p.evaluate(() => [...document.querySelectorAll('#cajBody .cjv-tabla tbody tr')].find(tr => /Remodelación/.test(tr.textContent)).cells[1].textContent);
            assert.equal(r, '$1,500.00');
            assert.equal(await p.evaluate(() => document.querySelector('#cajBody .cjv-tab[data-vista="disponible"] b').textContent), '$12,000.00');
            assert.equal(await p.evaluate(() => (window._cacheDeps || []).filter(d => d.tipo === 'apartado' && d.monto < 0).length), 1);
        });
        await caso('no deja liberar más de lo apartado', async () => {
            await p.evaluate(() => abrirAptLibre('liberar', 'a1')); await p.fill('#aptMonto', '9999'); await p.click('#aptBtnGuardar'); await p.waitForTimeout(200);
            /* Las alertas del sistema son su propia ventanita (etaax-ui), no el alert del navegador. */
            const aviso = await p.evaluate(() => { const o = [...document.querySelectorAll('.etaax-ui-ov')].pop(); const t = o ? o.textContent : (window.__avisos || []).pop() || '';
                if (o) { const b = o.querySelector('button'); if (b) b.click(); } return t; });
            assert.match(aviso, /Solo tiene \$500\.00/);
            await p.waitForTimeout(150); await p.evaluate(() => cerrarAptLibre());
        });
        await foto(p, 'k6-apartados');

        console.log('\n══ Cada tarjeta abre su vista (ya sin contraseña) ══');
        await p.evaluate(() => cerrarCajaFuerte());
        await p.click('.dx-card[data-fn="caja_ant"]'); await p.waitForSelector('#cajOverlay.open');
        await caso('«Anticipos» abre la caja directo en Anticipos', async () =>
            assert.equal(await p.evaluate(() => document.querySelector('#cajBody .cjv-tab.on').dataset.vista), 'anticipos'));
        await caso('…y ninguna tarjeta volvió a pedir la contraseña (solo la puerta)', async () => assert.equal(await p.evaluate(() => __claves), 1));

        console.log('\n══ Cuentas bancarias y previsiones se gestionan DESDE la caja ══');
        await p.click('#cajBody .cjv-tab[data-vista="bancos"]'); await p.waitForTimeout(200);
        await p.click('#cajBody [onclick="abrirCjCfg(\'cuentas\',1)"]');
        await p.waitForFunction(() => { const f = document.getElementById('cjCfgFrame'); try { return f.contentWindow.document.querySelector('.cb-modal.open'); } catch (e) { return false; } }, null, { timeout: 20000 });
        await foto(p, 'k8-agregar-cuenta');
        await caso('«Agregar cuenta» abre la página de cuentas encima de la caja, con su formulario de alta ya abierto', async () => {
            const r = await p.evaluate(() => { const ov = document.getElementById('cjCfgOv'), f = document.getElementById('cjCfgFrame');
                return [ov.classList.contains('open'), f.getAttribute('src'), getComputedStyle(ov).zIndex > getComputedStyle(document.getElementById('cajOverlay')).zIndex]; });
            assert.deepEqual(r, [true, '/financiero/cuentas-bancarias.html?embed=1&nueva=1', true]);
        });
        await caso('…embebida: sin la barra de módulos y con su botón naranja de letra blanca', async () => {
            const r = await p.evaluate(() => { const d = document.getElementById('cjCfgFrame').contentWindow.document, b = d.querySelector('.cb-save');
                return [!!(d.getElementById('etaax-header') && d.getElementById('etaax-header').offsetParent), getComputedStyle(b).color]; });
            assert.deepEqual(r, [false, 'rgb(255, 255, 255)']);
        });
        /* (27-nov) Edwin: «al crear o administrar se abre el modal viejo conectado al Fin·ax
           viejo». Las páginas no cargaban embed.js: adentro salía el encabezado viejo, la
           barra «Salud financiera», «Ir a Módulos» y «Cerrar sesión». */
        const cromoViejo = () => p.evaluate(() => { const d = document.getElementById('cjCfgFrame').contentWindow.document;
            const vis = (s) => [...d.querySelectorAll(s)].some(e => e.offsetParent !== null && e.getBoundingClientRect().height > 0);
            return { arriba: vis('.top-bar'), lateral: vis('nav.nav, .fin-nav, .etx-fin-nav, aside'), salir: [...d.querySelectorAll('a,button')].some(e => e.offsetParent && /Ir a Módulos|Cerrar sesión/.test(e.textContent)),
                     ventana: document.querySelector('#cjCfgOv .op-title-copy') && document.querySelector('#cjCfgOv .op-title-copy').textContent }; });
        await caso('…sin el Fin·ax viejo adentro: ni su encabezado, ni la barra lateral, ni «Ir a Módulos» / «Cerrar sesión»; la ventana dice «Caja fuerte · Cuentas bancarias»', async () =>
            assert.deepEqual(await cromoViejo(), { arriba: false, lateral: false, salir: false, ventana: 'Caja fuerte · Cuentas bancarias' }));
        await p.evaluate(() => { const d = document.getElementById('cjCfgFrame').contentWindow.document; const b = d.querySelector('.cb-cancel'); if (b) b.click(); });
        await p.waitForTimeout(300);
        await foto(p, 'k9-gestionar-cuentas');
        await p.evaluate(() => abrirCjCfg('previsiones'));
        await p.waitForFunction(() => { const f = document.getElementById('cjCfgFrame'); try { return /previsiones/.test(f.contentWindow.location.href) && f.contentWindow.document.readyState === 'complete' && f.contentWindow.document.querySelector('.main-content'); } catch (e) { return false; } }, null, { timeout: 20000 });
        await p.waitForTimeout(700);
        await foto(p, 'k10-gestionar-previsiones');
        await caso('previsiones igual: sin el Fin·ax viejo y la ventana dice «Caja fuerte · Previsiones»', async () =>
            assert.deepEqual(await cromoViejo(), { arriba: false, lateral: false, salir: false, ventana: 'Caja fuerte · Previsiones' }));
        await p.evaluate(() => cerrarCjCfg()); await p.waitForTimeout(300);
        await caso('cerrar la ventana vuelve a la caja y relee los saldos', async () =>
            assert.deepEqual(await p.evaluate(() => [document.getElementById('cjCfgOv').classList.contains('open'), document.getElementById('cajOverlay').classList.contains('open')]), [false, true]));
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
        await foto(p, 'k7-telefono');
        await caso('en el teléfono la caja no se sale de la pantalla', async () =>
            assert.equal(await p.evaluate(() => { const b = document.querySelector('#cajOverlay .cj-panel').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1; }), true));
        await ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log(malos.length ? '\n🚨 CAJA FUERTE EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '\n🔒 CAJA FUERTE EN NAVEGADOR OK — ' + resultados.length + ' casos');
    process.exit(malos.length ? 1 : 0);
})();
