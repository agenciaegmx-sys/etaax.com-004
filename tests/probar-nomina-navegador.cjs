/* Nómina en un navegador DE VERDAD — el hueco que el reporte del 6-nov dejó
   escrito: «nada de esto se ha ejercitado en un navegador con la v85 corrida;
   el candado corre en un DOM simulado».

   Chromium real carga administrativo/diario.html tal cual, desde el disco. Lo
   único de mentira es Supabase: un SDK falso con una «nube» en memoria que
   sobrevive a las recargas (vive en sessionStorage de la pestaña), así que se
   puede probar lo que queda guardado y no solo lo que se pinta. Ninguna
   petición sale del origen de prueba: lo que no sea un archivo del repo se
   corta y se anota.

   Se maneja como lo haría una persona: tarjeta → contraseña → «Pagar nómina»
   → ⋯ del renglón → opción del menú → botón del modal. Las fechas se fijan con
   un reloj falso, para que la prueba no dependa del día en que se corra.

   Ejecutar: node tests/probar-nomina-navegador.cjs                         */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const ORIGEN = 'http://etaax.prueba';
const TIPOS = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml',
                '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.json':'application/json',
                '.woff2':'font/woff2' };

/* ══ EL SUPABASE DE MENTIRA ═══════════════════════════════════════════════
   Filas {id, negocio_id, datos}, igual que las tablas de verdad. upsert por id
   (o por negocio_id cuando la tabla es documento único). Se inyecta como si
   fuera el UMD del CDN, así que supabase-config.js crea el cliente de siempre. */
function sdkFalso() {
    var LLAVE = '__nube';
    function nube(){ try { return JSON.parse(sessionStorage.getItem(LLAVE) || '{}'); } catch(e){ return {}; } }
    function guarda(db){ sessionStorage.setItem(LLAVE, JSON.stringify(db)); }
    window.__nube = { leer: nube, escribir: guarda, caida: false, escrituras: [] };
    var user = { id:'u1', email:'duena@fixture.invalid', user_metadata:{ nombre:'Dueña de prueba' } };
    function query(tabla){
        var f = [], q = {}, modo = 'select', valor = null, opc = {}, single = false;
        ['select','order','limit','range','gt','gte','lt','lte','neq','or','not','ilike','like','filter','contains'].forEach(function(k){ q[k] = function(){ return q; }; });
        q.eq = function(k, v){ f.push([k, v]); return q; };
        q.in = function(k, v){ f.push([k, v, 'in']); return q; };
        q.maybeSingle = function(){ single = 'maybe'; return q; };
        q.single = function(){ single = 'one'; return q; };
        q.upsert = function(v, o){ modo = 'upsert'; valor = v; opc = o || {}; return q; };
        q.insert = function(v){ modo = 'upsert'; valor = v; return q; };
        q.update = function(v){ modo = 'update'; valor = v; return q; };
        q.delete = function(){ modo = 'delete'; return q; };
        q.then = function(res, rej){
            var db = nube(), filas = db[tabla] || [], data = null, error = null;
            var pasa = function(r){ return f.every(function(c){
                var val = c[0] === 'id' ? r.id : c[0] === 'negocio_id' ? r.negocio_id : (r.datos || {})[c[0]];
                return c[2] === 'in' ? c[1].indexOf(val) > -1 : val === c[1]; }); };
            if (modo !== 'select' && window.__nube.caida) {
                error = { message: 'Failed to fetch' };
            } else if (modo === 'upsert') {
                (Array.isArray(valor) ? valor : [valor]).forEach(function(v){
                    var clave = opc.onConflict === 'negocio_id' ? 'negocio_id' : 'id';
                    var i = filas.findIndex(function(r){ return r[clave] === v[clave]; });
                    var fila = { id: v.id || v.negocio_id, negocio_id: v.negocio_id, datos: v.datos };
                    if (i > -1) filas[i] = fila; else filas.push(fila);
                    window.__nube.escrituras.push({ tabla: tabla, id: fila.id });
                });
                db[tabla] = filas; guarda(db); data = valor;
            } else if (modo === 'update') {
                filas.filter(pasa).forEach(function(r){ if (valor.datos) r.datos = valor.datos; });
                db[tabla] = filas; guarda(db);
            } else if (modo === 'delete') {
                db[tabla] = filas.filter(function(r){ return !pasa(r); }); guarda(db);
            } else {
                data = JSON.parse(JSON.stringify(filas.filter(pasa)));
                if (single) data = data[0] || null;
            }
            return Promise.resolve({ data: data, error: error, count: Array.isArray(data) ? data.length : 0 }).then(res, rej);
        };
        return q;
    }
    window.supabase = { createClient: function(){ return {
        auth: {
            getUser: async function(){ return { data:{ user:user }, error:null }; },
            getSession: async function(){ return { data:{ session:{ user:user, access_token:'x' } }, error:null }; },
            onAuthStateChange: function(){ return { data:{ subscription:{ unsubscribe:function(){} } } }; },
            signInWithPassword: async function(){ return { data:{ user:user }, error:null }; },
            signOut: async function(){ return { error:null }; },
            refreshSession: async function(){ return { data:{ session:{ user:user } }, error:null }; }
        },
        from: query,
        rpc: async function(){ return { data:null, error:null }; },
        channel: function(){ return { on:function(){ return this; }, subscribe:function(){ return this; },
            track:async function(){}, presenceState:function(){ return {}; }, unsubscribe:function(){} }; },
        removeChannel: async function(){},
        storage: { from: function(){ return { upload:async function(){ return { error:null }; },
            getPublicUrl:function(){ return { data:{ publicUrl:'' } }; } }; } }
    }; } };
}

/* ══ LA SEMILLA: un negocio, una sucursal, dos colaboradores ═══════════════ */
const STAFF = [
    { id:'s_ana',  nombre:'Ana Prueba',  puesto:'Barista', sucursalId:'suc_principal', estado:'Activo',
      esquemaSueldo:'diario', sueldoDiario:300, periodicidad:'semanal', multaRetardo:25, bonos:[] },
    { id:'s_beto', nombre:'Beto Prueba', puesto:'Cocinero', sucursalId:'suc_principal', estado:'Activo',
      esquemaSueldo:'diario', sueldoDiario:400, periodicidad:'quincenal', multaRetardo:25, bonos:[] }
];
function semilla(reloj) {
    return `(() => {
      /* Reloj falso: Date sin argumentos devuelve el instante elegido. */
      const T0 = ${JSON.stringify(reloj)};
      if (T0) {
        const Real = Date, base = Real.parse(T0), arranque = Real.now();
        const Falso = function(...a){ if (!(this instanceof Falso)) return new Real(base + (Real.now()-arranque)).toString();
                                      return a.length ? new Real(...a) : new Real(base + (Real.now()-arranque)); };
        Falso.prototype = Real.prototype; Falso.parse = Real.parse; Falso.UTC = Real.UTC;
        Falso.now = () => base + (Real.now() - arranque);
        window.Date = Falso;
      }
      window.__errores = [];
      addEventListener('error', e => __errores.push(String(e.message)));
      addEventListener('unhandledrejection', e => __errores.push('promesa: ' + String(e.reason && e.reason.message || e.reason)));
      window.__avisos = [];
      window.alert = m => { __avisos.push(String(m)); };
      window.__confirmar = true; window.confirm = m => { __avisos.push('¿' + String(m)); return __confirmar; };
      window.__motivo = 'Prueba'; window.prompt = m => { __avisos.push('? ' + String(m)); return __motivo; };
      if (!sessionStorage.getItem('__sembrado')) {
        localStorage.clear();
        localStorage.setItem('etaax_negocio_activo', 'n1');
        localStorage.setItem('etaax_sucursal_activa', 'suc_principal');
        localStorage.setItem('etaax_ctx', JSON.stringify({ ctxType:'owner', userId:'u1', userName:'Dueña de prueba',
            negId:'n1', negNombre:'Café de prueba' }));
        localStorage.setItem('etaax_qses', JSON.stringify({ usuarioId:'u1', nombre:'Dueña de prueba', plan:'pyme', ts:Date.now() }));
        localStorage.setItem('etaax_negocios', JSON.stringify([{ id:'n1', usuarioId:'u1', nombre:'Café de prueba', tipo:'cafe' }]));
        localStorage.setItem('etaax_n1_sucursales', JSON.stringify([{ id:'suc_principal', nombre:'Matriz', activa:true }]));
        localStorage.setItem('etaax_novedades_vista', JSON.stringify({}));
        sessionStorage.setItem('__nube', JSON.stringify({
          negocios: [{ id:'n1', negocio_id:'n1', datos:{ id:'n1', usuarioId:'u1', nombre:'Café de prueba', tipo:'cafe' } }],
          staff: ${JSON.stringify(STAFF.map(s => ({ id:s.id, negocio_id:'n1', datos:s })))}
        }));
        sessionStorage.setItem('__sembrado', '1');
      }
    })();`;
}

async function abrir(browser, reloj) {
    const ctx = await browser.newContext({ viewport:{ width:1280, height:900 }, deviceScaleFactor:1 });
    const fuera = [];
    await ctx.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === ORIGEN) {
            const p = path.join(RAIZ, decodeURIComponent(url.pathname));
            if (p.startsWith(RAIZ) && fs.existsSync(p) && fs.statSync(p).isFile())
                return route.fulfill({ status:200, body:fs.readFileSync(p),
                    headers:{ 'content-type': TIPOS[path.extname(p)] || 'application/octet-stream' } });
            return route.fulfill({ status:404, body:'' });
        }
        if (/supabase-js/.test(url.href))
            return route.fulfill({ status:200, body:'(' + sdkFalso.toString() + ')();',
                                   headers:{ 'content-type':'application/javascript' } });
        if (/fonts\.(googleapis|gstatic)/.test(url.host)) return route.fulfill({ status:200, body:'' });
        fuera.push(url.href);
        return route.abort();
    });
    await ctx.addInitScript(semilla(reloj));
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    await page.goto(ORIGEN + '/administrativo/diario.html');
    await page.waitForFunction(() => Array.isArray(window._cacheRecibos) && Array.isArray(window._cacheStaff) && _cacheStaff.length > 0);
    return { ctx, page, fuera };
}

/* ── pasos de persona ─────────────────────────────────────────────────── */
/* Las tarjetas de aviso de security.js (el alert de la app): se LEEN y se
   cierran con su botón, como haría alguien. Devuelve lo que decían. */
async function leerAvisos(page) {
    const vistos = [];
    for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(120);
        const ov = page.locator('.etaax-ui-ov').last();
        if (!(await ov.count()) || !(await ov.isVisible())) break;
        vistos.push((await ov.innerText()).replace(/\s+/g, ' ').trim());
        await ov.locator('button').last().click();
    }
    return vistos;
}
async function entrarANominas(page) {
    await page.click('button[data-fn="nominas"]');
    await page.waitForSelector('#modalAdminGuard', { state:'visible' });
    await page.click('#adminGuardInput');
    await page.fill('#adminGuardInput', 'cualquiera');
    await page.click('#adminGuardBtn');
    const av = await leerAvisos(page);
    assert.ok(av.some(t => /Autorizado por/.test(t)), 'no confirmó la autorización: ' + JSON.stringify(av));
    await page.waitForSelector('#dxOv_nominas.open');
}
async function abrirCola(page) {
    await page.click('#btnPagarNomina');
    await page.waitForSelector('#selPagoLista');
}
async function fila(page, nombre) {
    return page.locator('#selPagoLista > div', { hasText: nombre }).first();
}
async function textoFila(page, nombre) { return (await fila(page, nombre)).innerText(); }
async function menu(page, nombre, opcion) {
    await (await fila(page, nombre)).locator('button[title^="Generar, editar"]').click();
    const it = page.locator('.cx-menu >> text=' + opcion).first();
    await it.waitFor();
    return it;
}

const resultados = [];
async function caso(nombre, fn) {
    try { await fn(); resultados.push([nombre, true]); console.log('  ✅ ' + nombre); }
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n').join('\n     ')); }
}

(async () => {
    const browser = await chromium.launch();
    try {
        console.log('\n══ Nómina · arranque ══');
        const { page, fuera } = await abrir(browser, '2026-11-17T12:00:00-06:00');
        await caso('la página carga sin errores de script', async () => {
            const err = await page.evaluate(() => __errores);
            assert.deepEqual(err, []);
        });
        await caso('la puerta pide contraseña y abre el panel', async () => { await entrarANominas(page); });
        await caso('la cola enseña a los dos colaboradores por pagar', async () => {
            await abrirCola(page);
            const t = await page.locator('#selPagoLista').innerText();
            assert.match(t, /Por pagar · 2/i);
            assert.match(t, /Ana Prueba/); assert.match(t, /Beto Prueba/);
        });
        /* ── A · el camino feliz: recibo → gasto → pagada ───────────────── */
        console.log('\n══ A · Generar recibo, recargar, pagar ══');
        await caso('«Generar recibo» abre el modal con la semana en curso y 7 días', async () => {
            await (await menu(page, 'Ana Prueba', 'Generar recibo')).click();
            await page.waitForSelector('#modalPagoNom.open');
            const v = await page.evaluate(() => ({ d:pnDesde.value, h:pnHasta.value, dias:pnDias.value, tot:pnTotal.value }));
            assert.deepEqual([v.d, v.h, v.dias], ['2026-11-16', '2026-11-22', '7']);
            assert.match(String(v.tot), /2,?100/);
        });
        await caso('«Guardar recibo» guarda el recibo y NO crea gasto', async () => {
            await page.click('#pnBtnConfirmar');
            const av = await leerAvisos(page);
            assert.deepEqual(av, []);
            await page.waitForSelector('#modalPagoNom:not(.open)');
            const nube = await page.evaluate(() => __nube.leer());
            assert.equal((nube.nomina_recibos || []).length, 1, 'recibos en la nube');
            assert.equal((nube.gastos || []).length, 0, 'apareció un gasto sin pagar');
        });
        await caso('…y el renglón dice RECIBO LISTO, todavía por pagar', async () => {
            await page.waitForSelector('#selPagoLista');
            const t = await textoFila(page, 'Ana Prueba');
            assert.match(t, /Recibo listo/i); assert.match(t, /POR PAGAR/i);
        });

        /* La «nube» persiste: recargar es como abrir otro día la tablet. */
        await page.reload();
        await page.waitForFunction(() => Array.isArray(window._cacheRecibos) && _cacheStaff && _cacheStaff.length);
        await caso('al recargar, el recibo sigue ahí (viene de la nube, no de la memoria)', async () => {
            await entrarANominas(page); await abrirCola(page);
            assert.match(await textoFila(page, 'Ana Prueba'), /Recibo listo/i);
        });
        await caso('«Generar gasto» abre el gasto con el importe del recibo', async () => {
            await (await menu(page, 'Ana Prueba', 'Generar gasto')).click();
            await page.waitForFunction(() => document.getElementById('gMonto') && document.getElementById('gMonto').offsetParent);
            assert.equal(await page.inputValue('#gMonto'), '2100');
        });
        await caso('guardar el gasto lo registra y SELLA el recibo como pagado', async () => {
            await page.click('#btnGuardar');
            await leerAvisos(page);
            await page.waitForTimeout(400);
            const nube = await page.evaluate(() => __nube.leer());
            const g = (nube.gastos || []).map(r => r.datos);
            const r = (nube.nomina_recibos || []).map(r => r.datos)[0];
            assert.equal(g.length, 1, 'gastos en la nube: ' + g.length);
            assert.equal(g[0].monto, 2100);
            assert.equal(r.gastoId, g[0].id, 'el recibo no apunta al gasto');
            assert.ok(r.pagadoEn, 'sin instante de pago');
        });
        await caso('…y Ana pasa a PAGADAS en la cola', async () => {
            await abrirCola(page);
            const t = await page.locator('#selPagoLista').innerText();
            assert.match(t, /Pagadas · 1/i);
            assert.match(await textoFila(page, 'Ana Prueba'), /PAGADA/);
        });
        await caso('…con el menú apagado para volver a generar o pagar', async () => {
            await (await fila(page, 'Ana Prueba')).locator('button[title^="Generar, editar"]').click();
            const html = await page.locator('.cx-menu').innerHTML();
            await page.mouse.click(5, 5);
            const activo = (txt) => new RegExp('onclick="[^"]*"[^>]*>(?:(?!</div>).)*' + txt).test(html);
            assert.equal(activo('Generar recibo'), false, 'deja generar otro recibo de un periodo pagado');
            assert.equal(activo('Generar gasto'), false, 'deja pagar dos veces');
        });

        /* ── B · cancelar el gasto no paga nada ─────────────────────────── */
        console.log('\n══ B · Abrir el gasto y cancelar ══');
        await caso('Beto: recibo listo, abrir el gasto y cancelar → nada se paga', async () => {
            await (await menu(page, 'Beto Prueba', 'Generar recibo')).click();
            await page.waitForSelector('#modalPagoNom.open');
            await page.click('#pnBtnConfirmar');
            await page.waitForSelector('#modalPagoNom:not(.open)');
            await (await menu(page, 'Beto Prueba', 'Generar gasto')).click();
            await page.waitForFunction(() => document.getElementById('gMonto') && document.getElementById('gMonto').offsetParent);
            await page.evaluate(() => gCerrarModal());
            await page.waitForTimeout(300);
            const nube = await page.evaluate(() => __nube.leer());
            const rb = (nube.nomina_recibos || []).map(r => r.datos).find(r => r.staffId === 's_beto');
            assert.equal((nube.gastos || []).length, 1, 'se coló un gasto al cancelar');
            assert.ok(rb && !rb.gastoId && !rb.pagadoEn, 'el recibo quedó sellado sin pago');
        });

        /* ── D · borrar el gasto desde la lista desliga el recibo (N07) ──── */
        console.log('\n══ D · Borrar el gasto por la lista de gastos ══');
        await caso('el recibo de Ana vuelve a RECIBO LISTO, no se pierde', async () => {
            const gid = await page.evaluate(() => _cacheGastos[0].id);
            await page.evaluate((id) => eliminarGasto(id), gid);
            await page.waitForSelector('#modalAdminGuard', { state:'visible' });
            await page.click('#adminGuardInput'); await page.fill('#adminGuardInput', 'x');
            await page.click('#adminGuardBtn'); await leerAvisos(page);
            await page.waitForTimeout(300);
            const nube = await page.evaluate(() => __nube.leer());
            const ra = (nube.nomina_recibos || []).map(r => r.datos).find(r => r.staffId === 's_ana');
            assert.equal((nube.gastos || []).length, 0, 'el gasto sigue');
            assert.ok(ra, 'el recibo se borró');
            assert.ok(!ra.gastoId && !ra.pagadoEn, 'el recibo sigue sellado como pagado');
            await abrirCola(page);
            assert.match(await textoFila(page, 'Ana Prueba'), /Recibo listo/i);
        });

        /* ── H · la red se cae justo al pagar ───────────────────────────── */
        console.log('\n══ H · Pagar con la red caída ══');
        await caso('con la red caída, gasto y sello quedan en cola y suben juntos al volver', async () => {
            await page.evaluate(() => { __nube.caida = true; });
            await (await menu(page, 'Ana Prueba', 'Generar gasto')).click();
            await page.waitForFunction(() => document.getElementById('gMonto') && document.getElementById('gMonto').offsetParent);
            await page.click('#btnGuardar');
            await leerAvisos(page);
            await page.waitForTimeout(600);
            let nube = await page.evaluate(() => __nube.leer());
            assert.equal((nube.gastos || []).length, 0, 'subió con la red caída');
            await page.evaluate(() => { __nube.caida = false; });
            /* El outbox reintenta solo; se le da un empujón con su propio
               disparador si lo tiene, y si no, se espera. */
            await page.evaluate(() => { if (typeof sbFlushOutbox === 'function') return sbFlushOutbox(); if (typeof _sbFlush === 'function') return _sbFlush(); });
            await page.waitForFunction(() => (__nube.leer().gastos || []).length === 1, null, { timeout: 30000 });
            nube = await page.evaluate(() => __nube.leer());
            const g = nube.gastos[0].datos;
            const ra = nube.nomina_recibos.map(r => r.datos).find(r => r.staffId === 's_ana');
            assert.equal(ra.gastoId, g.id, 'el gasto subió pero el sello no');
        });

        console.log('\n  peticiones cortadas:', fuera.length ? fuera : 'ninguna');
        await page.context().close();

        /* ── C · pagar la quincena ANTERIOR (lo más común en México) ────── */
        console.log('\n══ C · El 3 de noviembre se paga la 2ª quincena de octubre ══');
        const c = await abrir(browser, '2026-11-03T10:00:00-06:00');
        await entrarANominas(c.page); await abrirCola(c.page);
        await caso('el modal propone la quincena en curso (1–15 nov) y se cambia a 16–31 oct', async () => {
            await (await menu(c.page, 'Beto Prueba', 'Generar recibo')).click();
            await c.page.waitForSelector('#modalPagoNom.open');
            assert.equal(await c.page.inputValue('#pnDesde'), '2026-11-01');
            await c.page.fill('#pnDesde', '2026-10-16'); await c.page.dispatchEvent('#pnDesde', 'change');
            await c.page.fill('#pnHasta', '2026-10-31'); await c.page.dispatchEvent('#pnHasta', 'change');
            assert.equal(await c.page.inputValue('#pnDias'), '16');
            await c.page.click('#pnBtnConfirmar');
            await c.page.waitForSelector('#modalPagoNom:not(.open)');
        });
        await caso('…y después de guardarlo, se puede PAGAR desde la cola', async () => {
            await c.page.waitForSelector('#selPagoLista');
            const t = await textoFila(c.page, 'Beto Prueba');
            const it = await menu(c.page, 'Beto Prueba', 'Generar gasto');
            const html = await it.evaluate(e => e.outerHTML);
            await c.page.mouse.click(5, 5);
            assert.ok(/Recibo listo/i.test(t) && /onclick/.test(html),
                'el recibo recién guardado no aparece: renglón «' + t.replace(/\s+/g, ' ') + '», «Generar gasto» ' + (/onclick/.test(html) ? 'activo' : 'APAGADO'));
        });
        await c.ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]).length;
    console.log('\n' + (malos ? '🚨 ' + malos + ' de ' + resultados.length + ' casos fallaron'
                              : '🔒 NÓMINA EN NAVEGADOR OK — ' + resultados.length + ' casos'));
    process.exit(malos ? 1 : 0);
})();
