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
            entrada_catalogo: (p) => ok(p) ? { ok: true, sucursal: 'suc_dos', insumos: [{ id: 'i1', nombre: 'Tequila Blanco', activo: '1', sucursales: ['suc_dos'] },
                                                                                       { id: 'i2', nombre: 'Refresco Cola', activo: '1', sucursales: ['suc_dos'], contNeto: 600, umContenido: 'ML' }] } : null,
            /* Lo que la app manda queda en window.__regs (para revisar la nota). */
            entrada_registrar: (p) => ok(p) ? ((window.__regs = (window.__regs || []).concat([p.p_datos])), 'id-' + window.__regs.length) : null,
            entrada_historial: (p) => ok(p) ? { ok: true, desde: null, inventario: null, conteos: [], movimientos: [
                { id: 'e1', concepto: 'entrada', nombre: 'Refresco Cola', insumoId: 'i2', cantidad: '12', unidad: 'PZA', tipoEntrada: 'compra', fecha: '2026-11-25', quien: 'Ana López', notaId: 'N1', notaFolio: 'F-1', notaProveedor: 'Coca-Cola FEMSA', fotos: 1, ver: 1, puedeEditar: true },
                { id: 'e2', concepto: 'entrada', nombre: 'Agua mineral', insumoId: 'i3', cantidad: '6', unidad: 'PZA', tipoEntrada: 'compra', fecha: '2026-11-25', quien: 'Ana López', notaId: 'N1', notaFolio: 'F-1', notaProveedor: 'Coca-Cola FEMSA', fotos: 1, ver: 1, puedeEditar: true },
                { id: 'e3', concepto: 'entrada', nombre: 'Tequila Blanco', insumoId: 'i1', cantidad: '2', unidad: 'BOT', tipoEntrada: 'prestamo_pagado', fecha: '2026-11-24', quien: 'Ana López', ver: 1, puedeEditar: true },
                { id: 'e4', concepto: 'entrada', nombre: 'Tequila Blanco', insumoId: 'i1', cantidad: '3', unidad: 'BOT', tipoEntrada: 'compra', fecha: '2026-11-24', quien: 'Beto', ver: 1, puedeEditar: false, motivoBloqueo: 'La capturó alguien más' },
                { id: 'm1', concepto: 'merma', nombre: 'Limón', cantidad: '1', fecha: '2026-11-25', quien: 'Ana López' }] } : null,
            entrada_nota_agrupar: (p) => ok(p) ? ((window.__agrupar = p), { ok: true, notaId: 'N2', n: p.p_ids.length }) : null,
            entrada_nota_desagrupar: (p) => ok(p) ? ((window.__desag = p), { ok: true, n: 2 }) : null,
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
            movil_estado: (p) => (${opc.apagado ? 'false' : "p.p_token === 'tokA'"})
                ? { activo: true, sucursalId: 'suc_dos', negocio: 'Café de prueba', sucursal: 'Polanco', giro: 'Bar', logo: ${JSON.stringify(opc.logo || '')} }
                : { activo: false, sucursalId: null },
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
            ${process.env.TEMA_CLARO ? "localStorage.setItem('etaax_appmovil_tema', 'claro');" : ''}   // solo para fotos en claro (TEMA_CLARO=1 SHOTS=…)
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
        await caso('la portada: «Inicia sesión» en chico dentro del recuadro de la CLAVE (por default), con su teclado a la vista', async () =>
            assert.deepEqual(await p.evaluate(() => [document.querySelector('#pInicio .clave-card .clave-tit').textContent, document.getElementById('inicioSub').textContent,
                document.querySelectorAll('#teclado .tecla').length, document.getElementById('nipZona').classList.contains('apagada')]),
                ['Inicia sesión', 'Ingresa tu clave de 5 dígitos', 12, false]));
        await p.waitForFunction(() => /Polanco/.test(document.getElementById('sucMarca').textContent), null, { timeout: 8000 }).catch(() => {});
        await caso('arriba, la SUCURSAL del QR EN HORIZONTAL y centrada en la página: su inicial (sin logo), el pin, su nombre y giro · negocio', async () => {
            const r = await p.evaluate(() => {
                const m = document.getElementById('sucMarca'), f = m.querySelector('.suc-fila').getBoundingClientRect(),
                      l = m.querySelector('.suc-logo').getBoundingClientRect(), n = m.querySelector('.suc-nom').getBoundingClientRect(),
                      c = document.querySelector('.clave-card').getBoundingClientRect();
                return [m.hidden, m.querySelector('.suc-ini').textContent, !!m.querySelector('.suc-nom svg.etx-ic'), m.querySelector('.suc-nom').textContent,
                        m.querySelector('.suc-giro').textContent, Math.abs((f.left + f.right) / 2 - innerWidth / 2) < 2,
                        l.right <= n.left && Math.abs((l.top + l.bottom) / 2 - (f.top + f.bottom) / 2) < 3, m.getBoundingClientRect().bottom <= c.top];
            });
            assert.deepEqual(r, [false, 'P', true, 'Polanco', 'Bar · Café de prueba', true, true, true]);
        });
        await caso('…el ✓ del teclado es la acción, en terracota (como «Iniciar sesión» del sistema)', async () =>
            assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('#teclado [data-k="entrar"]')).backgroundColor), 'rgb(251, 155, 111)'));
        const puertas = () => p.evaluate(() => [document.getElementById('tabClave').classList.contains('on'), document.getElementById('btnUsuario').classList.contains('on'),
            document.getElementById('claveCard').hidden, document.getElementById('cuentaForm').hidden]);
        await caso('bajo la sucursal, dos botones: «Entrar con clave» (elegido) e «Iniciar sesión»; arriba del recuadro de la clave', async () => {
            const r = await p.evaluate(() => [[...document.querySelectorAll('.ini-puertas .ini-puerta')].map(b => b.textContent.trim()),
                document.querySelector('.ini-puertas').getBoundingClientRect().bottom <= document.getElementById('claveCard').getBoundingClientRect().top,
                document.getElementById('sucMarca').getBoundingClientRect().bottom <= document.querySelector('.ini-puertas').getBoundingClientRect().top]);
            assert.deepEqual(r, [['Entrar con clave', 'Iniciar sesión'], true, true]);
            assert.deepEqual(await puertas(), [true, false, false, true]);
        });
        await caso('…«Iniciar sesión» enseña usuario y contraseña y esconde la clave', async () => {
            await p.click('#btnUsuario');
            assert.deepEqual(await puertas(), [false, true, true, false]);
            assert.equal(await p.evaluate(() => document.getElementById('btnUsuario').getAttribute('aria-expanded')), 'true');
        });
        await foto(p, 'm0b-cuenta');
        await caso('…igual al acceso del sistema: campos con su ícono, el ojo que enseña la contraseña y «Iniciar sesión» en terracota', async () => {
            const r = await p.evaluate(() => [
                [...document.querySelectorAll('#cuentaForm .auth-label')].map(x => x.textContent),
                document.querySelectorAll('#cuentaForm .auth-caja .auth-ic svg.etx-ic').length,
                document.getElementById('ctaBtn').textContent.trim(),
                getComputedStyle(document.getElementById('ctaBtn')).backgroundColor]);
            assert.deepEqual(r, [['Correo o usuario', 'Contraseña'], 2, 'Iniciar sesión', 'rgb(251, 155, 111)']);
            await p.click('#ctaOjo');
            assert.equal(await p.evaluate(() => document.getElementById('ctaPwd').type), 'text');
            await p.click('#ctaOjo');
            assert.equal(await p.evaluate(() => document.getElementById('ctaPwd').type), 'password');
        });
        /* Edwin, 25-nov: «en el modo claro los íconos tienen contorno blanco y no
           se ven». Los de la marca se pintan con --text; la app lo trae puente. */
        await caso('en el tema CLARO los íconos se pintan oscuros (no crema sobre blanco), y en el oscuro claros', async () => {
            const color = () => p.evaluate(() => [...document.querySelectorAll('#cuentaForm .auth-ic svg, #ctaOjo svg, #temaIco svg')]
                .map(x => getComputedStyle(x).color));
            const oscuro = await color();
            await p.evaluate(() => toggleTema());
            const claro = await color();
            await foto(p, 'm0c-cuenta-claro');
            await p.evaluate(() => toggleTema());
            assert.equal(claro.length, 5);
            assert.deepEqual([...new Set(claro)], ['rgb(26, 25, 22)']);
            assert.deepEqual([...new Set(oscuro)], ['rgb(240, 236, 228)']);
        });
        await caso('…y «Entrar con clave» regresa al teclado (y esconde la cuenta)', async () => {
            await p.click('#tabClave');
            assert.deepEqual(await puertas(), [true, false, false, true]);
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
        await caso('los módulos en tarjeta CUADRADA como en el sistema (ícono, «Módulo N», isla), lado a lado, con «Ver» en terracota', async () => {
            const r = await p.evaluate(() => [...document.querySelectorAll('#menuPortal .mod-card')].map(c => {
                const t = c.querySelector('.mod-tile').getBoundingClientRect(), v = c.querySelector('.btn-ver');
                return [c.querySelector('.mod-num').textContent, !!c.querySelector('.mod-tile svg.etx-ic'), Math.abs(t.width - t.height) < 2,
                        Math.round(t.top), v.textContent.trim(), getComputedStyle(v).backgroundColor];
            }));
            assert.equal(r.length, 2);
            assert.deepEqual(r.map(x => [x[0], x[1], x[2], x[4], x[5]]), [['Módulo 1', true, true, 'Ver', 'rgb(251, 155, 111)'], ['Módulo 2', true, true, 'Ver', 'rgb(251, 155, 111)']]);
            assert.equal(r[0][3], r[1][3], 'lado a lado');
        });
        await caso('«Cerrar sesión» es un botón grande arriba a la derecha, junto al saludo', async () => {
            const r = await p.evaluate(() => {
                const b = document.querySelector('#pMenu .btn-salir').getBoundingClientRect(), q = document.getElementById('quienCard').getBoundingClientRect(),
                      m = document.getElementById('menuPortal').getBoundingClientRect();
                return [b.height >= 44, b.right > innerWidth - 40, b.left > q.left, b.bottom <= m.top, !document.querySelector('#pMenu .salir')];
            });
            assert.deepEqual(r, [true, true, true, true, true]);
        });
        await p.click('#menuPortal [data-mod="costax"] .btn-ver'); await p.waitForTimeout(200);
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
        await p.click('[data-despl="inventarios"]'); await p.waitForTimeout(100);
        await p.click('[data-despl="recetas"]'); await p.waitForTimeout(300);
        await foto(p, 'm2b-recetas');
        await caso('…Recetas: los CUATRO grupos fijos; los de cocina, opacos para quien es de barra', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#rejRecetas .rec-grupo')].map(b =>
                b.querySelector('b').textContent + ':' + (b.disabled ? 'opaco' : b.querySelector('small').textContent) + ':' + (getComputedStyle(b).opacity < 0.5))),
                ['Recetas alimentos:opaco:true', 'Sub recetas alimentos:opaco:true', 'Recetas bebidas:2 recetas:false', 'Sub recetas bebidas:0 recetas:false']));
        await p.click('#rejRecetas .rec-grupo[data-grupo="bebidas"]'); await p.waitForTimeout(200);
        await foto(p, 'm2c-grupo');
        await caso('…tocar «Recetas bebidas» despliega su lista debajo, y los cuatro grupos se quedan arriba', async () =>
            assert.deepEqual(await p.evaluate(() => [document.querySelectorAll('#rejRecetas .rec-grupo').length,
                document.querySelector('.rec-grupo[aria-pressed="true"] b').textContent,
                [...document.querySelectorAll('#recItems .rect b')].map(b => b.textContent)]), [4, 'Recetas bebidas', ['Margarita', 'Paloma']]));
        await p.click('#recItems .rect:has-text("Margarita")'); await p.waitForTimeout(200);
        await caso('una receta abre su ficha (sin costos) y «atrás» regresa a Cost·ax con lo que estaba abierto', async () => {
            assert.match(await p.evaluate(() => document.getElementById('recFicha').textContent), /Tequila[\s\S]*Agitar con hielo/);
            await p.click('#btnVolver'); await p.waitForTimeout(200);
            assert.deepEqual(await p.evaluate(() => [!document.getElementById('pModulo').hidden, !document.getElementById('rejRecetas').hidden,
                document.querySelectorAll('#recItems .rect').length]), [true, true, 2]);
        });
        await p.click('#btnVolver'); await p.waitForTimeout(150);
        await p.click('#menuPortal [data-mod="equipax"] .btn-ver'); await p.waitForTimeout(200);
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

        console.log('\n══ App móvil · entradas, como en el sistema ══');
        const E = await abrir(browser, {});
        await nip(E.page, '12345');
        const ep = E.page;
        await ep.click('#menuPortal [data-mod="costax"] .btn-ver'); await ep.waitForTimeout(150);
        await ep.click('[data-despl="inventarios"]'); await ep.waitForTimeout(100);
        await ep.click('#rejInventarios .rect:has-text("Registrar entradas")'); await ep.waitForTimeout(300);
        await foto(ep, 'm8-entradas');
        await caso('entradas: dos vistas arriba (Catálogo y Entradas registradas) y el catálogo a la vista con «+ registrar»', async () => {
            const r = await ep.evaluate(() => [!document.getElementById('entVistas').hidden,
                [...document.querySelectorAll('#entVistas .ent-vista')].map(b => b.textContent.trim() + ':' + b.classList.contains('on')),
                [...document.querySelectorAll('#sugs .cat-it')].map(b => b.querySelector('b').textContent + '|' + b.querySelector('.cat-reg').textContent)]);
            assert.deepEqual(r, [true, ['Catálogo:true', 'Entradas registradas:false'], ['Refresco Cola|+ registrar', 'Tequila Blanco|+ registrar']], JSON.stringify(r));
        });
        await ep.click('#sugs .cat-it:has-text("Tequila Blanco")'); await ep.waitForTimeout(150);
        await foto(ep, 'm8b-tarjeta');
        await caso('…la tarjeta del producto: los cuatro tipos del sistema en botones (Compra elegido), fecha y «+ Agregar» en verde', async () => {
            const r = await ep.evaluate(() => [[...document.querySelectorAll('#elegidoTipos .ent-tipo')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')),
                !!document.getElementById('entFecha'), document.getElementById('btnAgregar').textContent,
                getComputedStyle(document.getElementById('btnAgregar')).backgroundColor]);
            assert.deepEqual(r, [['Compra*', 'Bonificación', 'Consignación', 'Préstamo pagado'], true, '+ Agregar', 'rgb(61, 190, 122)']);
        });
        await ep.click('#elegidoTipos .ent-tipo:has-text("Préstamo pagado")');
        await ep.fill('#cant', '3'); await ep.click('#btnAgregar'); await ep.waitForTimeout(150);
        await ep.click('#btnEnviar'); await ep.waitForTimeout(500);
        await caso('…«Préstamo pagado» viaja como lo nombra el sistema (prestamo_pagado), sin nota', async () => {
            const r = await ep.evaluate(() => window.__regs.map(x => [x.concepto, x.insumoId, x.cantidad, x.tipo, x.notaId || '']));
            assert.deepEqual(r, [['entrada', 'i1', 3, 'prestamo_pagado', '']]);
        });
        await ep.click('.btn-nota'); await ep.waitForTimeout(150);
        await ep.fill('#notaProv', 'Refrescos del Norte'); await ep.fill('#notaFolio', 'A-77');
        for (const [prod, cant] of [['Refresco Cola', '6'], ['Refresco Cola', '4'], ['Tequila Blanco', '2']]) {
            await ep.click('#sugs .cat-it:has-text("' + prod + '")'); await ep.waitForTimeout(100);
            await ep.fill('#cant', cant); await ep.click('#btnAgregar'); await ep.waitForTimeout(150);
        }
        await foto(ep, 'm8c-nota');
        await caso('NOTA / FACTURA: proveedor, folio y fecha una vez; el mismo producto se SUMA; el botón dice cuántos van', async () => {
            const r = await ep.evaluate(() => [!!document.querySelector('.nota-card'),
                [...document.querySelectorAll('.nota-it')].map(x => x.querySelector('.nota-it-nom').firstChild.textContent + ':' + x.querySelector('.nota-cant').value),
                document.getElementById('btnEnviar').textContent, document.getElementById('fotosLbl').textContent.indexOf('Evidencia de la nota') === 0]);
            assert.deepEqual(r, [true, ['Refresco Cola:10', 'Tequila Blanco:2'], 'Registrar nota · 2 productos', true]);
        });
        await ep.click('#btnEnviar'); await ep.waitForTimeout(600);
        await caso('…al registrarla, cada entrada lleva el MISMO notaId, folio y proveedor (los campos del sistema), y la nota se cierra', async () => {
            const r = await ep.evaluate(() => [window.__regs.slice(1).map(x => [x.insumoId, x.cantidad, x.tipo, x.notaFolio, x.notaProveedor]),
                new Set(window.__regs.slice(1).map(x => x.notaId)).size, !!window.__regs[1].notaId, !!document.querySelector('.nota-card')]);
            assert.deepEqual(r, [[['i2', 10, 'compra', 'A-77', 'Refrescos del Norte'], ['i1', 2, 'compra', 'A-77', 'Refrescos del Norte']], 1, true, false]);
        });
        await ep.click('#entVistas [data-vista="registradas"]'); await ep.waitForTimeout(400);
        await foto(ep, 'm8d-registradas');
        await caso('ENTRADAS REGISTRADAS: la barra de abajo se va; arriba las notas con sus productos, abajo por producto (sin mermas)', async () => {
            const r = await ep.evaluate(() => [document.getElementById('barra').hidden,
                [...document.querySelectorAll('#vistaRegistradas .reg-sec')].map(x => x.textContent),
                [...document.querySelectorAll('#vistaRegistradas .reg-grupo summary .reg-g-txt b')].map(x => x.textContent),
                document.getElementById('vistaRegistradas').textContent.indexOf('Limón')]);
            assert.deepEqual(r, [true, ['Notas / facturas', 'Por producto'], ['Coca-Cola FEMSA · Folio F-1', 'Refresco Cola', 'Agua mineral', 'Tequila Blanco'], -1]);
        });
        await caso('…cada producto con su total (+5 BOT de Tequila: 2 + 3)', async () =>
            assert.match(await ep.evaluate(() => [...document.querySelectorAll('.reg-grupo')].find(g => /Tequila/.test(g.textContent)).querySelector('.reg-g-tot').textContent), /\+5 BOT/));
        await ep.click('.btn-agrupar'); await ep.waitForTimeout(150);
        await caso('AGRUPAR EN NOTA: casillas en cada entrada; la que capturó alguien más no se puede marcar', async () => {
            const r = await ep.evaluate(() => [...document.querySelectorAll('#vistaRegistradas .reg-fila.sel')].map(l => l.querySelector('b').textContent + ':' + !l.querySelector('input').disabled));
            assert.deepEqual(r, ['Refresco Cola:true', 'Agua mineral:true', 'Tequila Blanco:true', 'Tequila Blanco:false']);
        });
        await ep.check('#vistaRegistradas .reg-fila.sel:has-text("Prestamo") input, #vistaRegistradas .reg-fila.sel:has-text("Préstamo pagado") input');
        await ep.fill('#selProv', 'Licores del Centro'); await ep.click('#btnAgruparOk'); await ep.waitForTimeout(400);
        await caso('…«Agrupar» manda las marcadas con proveedor y folio (entrada_nota_agrupar, v94)', async () => {
            const a = await ep.evaluate(() => window.__agrupar);
            assert.deepEqual([a.p_ids, a.p_proveedor, a.p_folio], [['e3'], 'Licores del Centro', '']);
        });
        await ep.click('.reg-grupo:has-text("Coca-Cola FEMSA") summary'); await ep.waitForTimeout(150);
        await ep.click('.reg-grupo:has-text("Coca-Cola FEMSA") .btn-desag'); await ep.waitForTimeout(400);
        await caso('…y una nota se puede desagrupar (entrada_nota_desagrupar)', async () =>
            assert.equal(await ep.evaluate(() => window.__desag && window.__desag.p_nota), 'N1'));
        await caso('…sin desbordarse a lo ancho', async () => assert.equal(await sinAncho(ep), true));
        await E.ctx.close();

        console.log('\n══ App móvil · lo no contratado y lo que no hay ══');
        const b = await abrir(browser, { apps: ['costax'], evals: [] });
        await nip(b.page, '12345');
        await caso('una sucursal con solo Cost·ax no ve Equip·ax', async () => assert.deepEqual(await islas(b.page, '#menuPortal'), ['Cost·ax']));
        await b.ctx.close();
        const c = await abrir(browser, { apps: ['equipax'], evals: [] });
        await nip(c.page, '12345');
        await caso('…con solo Equip·ax no ve Cost·ax, y sin evaluaciones abiertas no sale «Evaluaciones»', async () => {
            assert.deepEqual(await islas(c.page, '#menuPortal'), ['Equip·ax']);
            await c.page.click('#menuPortal [data-mod="equipax"] .btn-ver'); await c.page.waitForTimeout(150);
            assert.deepEqual(await c.page.evaluate(() => [...document.querySelectorAll('#modCuerpo .rect b')].map(x => x.textContent)), ['Ver mis horarios', 'Realizar check list']);
        });
        await c.ctx.close();
        const d = await abrir(browser, { sinCorrer: ['portal_apps', 'portal_horarios', 'portal_evaluaciones'] });
        await nip(d.page, '12345');
        await caso('sin la v91: se ve todo, y Mis horarios dice que todavía no está activado', async () => {
            assert.deepEqual(await islas(d.page, '#menuPortal'), ['Cost·ax', 'Equip·ax']);
            await d.page.click('#menuPortal [data-mod="equipax"] .btn-ver'); await d.page.waitForTimeout(150);
            await d.page.click('#modCuerpo .rect:has-text("Ver mis horarios")'); await d.page.waitForTimeout(300);
            assert.equal(await d.page.evaluate(() => document.getElementById('horariosLista').textContent.trim()), 'Esta parte de la app todavía no está activada en tu negocio.');
        });
        await d.ctx.close();

        console.log('\n══ App móvil · sin negocio ligado ══');
        const e = await abrir(browser, { ligado: false });
        await caso('la clave se apaga, «Iniciar sesión» se abre solo y AHÍ se explica cómo ligar el teléfono', async () => {
            const r = await e.page.evaluate(() => [document.getElementById('nipZona').classList.contains('apagada'), document.getElementById('cuentaForm').hidden,
                document.getElementById('claveCard').hidden, document.getElementById('cuentaAviso').textContent, document.getElementById('inicioAviso').textContent]);
            assert.deepEqual(r.slice(0, 3), [true, false, true]);
            assert.match(r[3], /todavía no está ligado[\s\S]*una vez con tu cuenta[\s\S]*QR de tu sucursal/);
            assert.match(r[4], /entre una vez con su cuenta en «Iniciar sesión», o abre el QR de tu sucursal/);
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
