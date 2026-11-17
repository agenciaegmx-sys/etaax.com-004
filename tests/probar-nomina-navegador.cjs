/* Nómina en un navegador DE VERDAD — el hueco que el reporte del 6-nov dejó
   escrito: «nada de esto se ha ejercitado en un navegador con la v85 corrida;
   el candado corre en un DOM simulado».

   Chromium real carga administrativo/diario.html tal cual, desde el disco. Lo
   único de mentira es Supabase: un SDK falso con una «nube» que sobrevive a
   las recargas y que COMPARTEN las pestañas del mismo navegador (vive en el
   localStorage del contexto, y cada caso abre un contexto limpio), así que se
   puede probar lo que queda guardado y no solo lo que se pinta —y dos
   pestañas pagando a la vez escriben en la misma nube, como en la vida real—.
   Ninguna petición sale del origen de prueba: lo que no sea un archivo del
   repo se corta y se anota. Esa maquinaria vive en tests/navegador-comun.cjs.

   Se maneja como lo haría una persona: tarjeta → contraseña → «Pagar nómina»
   → ⋯ del renglón → opción del menú → botón del modal. Las fechas se fijan con
   un reloj falso, para que la prueba no dependa del día en que se corra.

   Ejecutar: node tests/probar-nomina-navegador.cjs                         */
'use strict';
const assert = require('node:assert/strict');
const { chromium, ORIGEN, abrir, pestana } = require('./navegador-comun.cjs');
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
/* Si la cola ya está a la vista (la app vuelve sola a ella después de pagar),
   no se toca el botón de abajo: el clic caería en el fondo del modal y la app
   —con razón— preguntaría si se quiere cerrar. */
async function abrirCola(page) {
    await leerAvisos(page);
    if (await page.locator('#selPagoLista').isVisible().catch(() => false)) {
        await page.evaluate(() => _nomPintarListas());
        return;
    }
    await page.click('#btnPagarNomina');
    await page.waitForSelector('#selPagoLista');
}
async function fila(page, nombre) {
    return page.locator('#selPagoLista > div', { hasText: nombre }).first();
}
async function textoFila(page, nombre) { return (await fila(page, nombre)).innerText(); }
/* Lo que la app dijo y nadie leyó todavía: se anota para el reporte. */
const avisosSueltos = [];
async function menu(page, nombre, opcion) {
    const av = await leerAvisos(page);
    if (av.length) { avisosSueltos.push(...av); console.log('     (aviso en pantalla: ' + av.join(' | ') + ')'); }
    await (await fila(page, nombre)).locator('button[title^="Generar, editar"]').click();
    const it = page.locator('.cx-menu >> text=' + opcion).first();
    await it.waitFor();
    return it;
}

const resultados = [];
async function caso(nombre, fn) {
    try { await fn(); resultados.push([nombre, true]); console.log('  ✅ ' + nombre); }
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n')[0]); }
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
            await page.waitForSelector('#modalPagoNom.open', { state:'detached' });
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
        /* La vista del panel arranca en el MES: una semana pagada es PARCIAL
           (7 de 30 días) y se queda con los pendientes —falta el resto del mes—. */
        await caso('…y en la vista del mes Ana queda PARCIAL, 7 de 30 días', async () => {
            await abrirCola(page);
            assert.match(await textoFila(page, 'Ana Prueba'), /PARCIAL\s*7 de 30 días/);
        });
        await caso('…con «Generar gasto» apagado: esa semana ya se pagó', async () => {
            await (await fila(page, 'Ana Prueba')).locator('button[title^="Generar, editar"]').click();
            const vivos = await page.evaluate(() => Array.from(document.querySelectorAll('.cx-menu [onclick]'))
                .map(e => e.getAttribute('onclick')));
            await page.evaluate(() => _cerrarMenusCorte());
            assert.equal(vivos.some(o => /generarGastoNomina/.test(o)), false, 'deja pagar dos veces');
        });

        /* ── B · cancelar el gasto no paga nada ─────────────────────────── */
        console.log('\n══ B · Abrir el gasto y cancelar ══');
        await caso('Beto: recibo listo, abrir el gasto y cancelar → nada se paga', async () => {
            await (await menu(page, 'Beto Prueba', 'Generar recibo')).click();
            await page.waitForSelector('#modalPagoNom.open');
            await page.click('#pnBtnConfirmar');
            await page.waitForSelector('#modalPagoNom.open', { state:'detached' });
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
            await c.page.waitForSelector('#modalPagoNom.open', { state:'detached' });
        });
        await caso('…y después de guardarlo, se puede PAGAR desde la cola', async () => {
            await c.page.waitForSelector('#selPagoLista');
            const t = await textoFila(c.page, 'Beto Prueba');
            const it = await menu(c.page, 'Beto Prueba', 'Generar gasto');
            const vivo = await it.evaluate(e => !!e.closest('[onclick]'));
            await c.page.evaluate(() => _cerrarMenusCorte());
            assert.ok(/Recibo listo/i.test(t) && vivo,
                'el recibo recién guardado no aparece: renglón «' + t.replace(/\s+/g, ' ') + '», «Generar gasto» ' + (vivo ? 'activo' : 'APAGADO'));
        });
        await c.ctx.close();

        /* ── E · la misma semana, dos veces ───────────────────────────────
           Con la vista en el mes, una semana pagada deja «Generar recibo»
           encendido (falta el resto del mes) y el modal vuelve a proponer LA
           SEMANA EN CURSO —la que ya se pagó—. Encontrado el 17-nov en este
           arnés: se guardaba un segundo recibo (_2) y se pagaba otra vez. */
        console.log('\n══ E · Volver a generar el recibo de una semana ya pagada ══');
        const e = await abrir(browser, '2026-11-17T12:00:00-06:00');
        await entrarANominas(e.page); await abrirCola(e.page);
        const pagarAna = async () => {
            await (await menu(e.page, 'Ana Prueba', 'Generar recibo')).click();
            await e.page.waitForSelector('#modalPagoNom.open');
            await e.page.click('#pnBtnConfirmar');
            await leerAvisos(e.page);
            await e.page.waitForTimeout(300);
            const it = await menu(e.page, 'Ana Prueba', 'Generar gasto');
            if (!(await it.evaluate(x => !!x.closest('[onclick]')))) { await e.page.evaluate(() => _cerrarMenusCorte()); return; }
            await it.click();
            await e.page.waitForTimeout(300);
            if (await e.page.evaluate(() => !!(document.getElementById('gMonto') && gMonto.offsetParent))) {
                await e.page.click('#btnGuardar'); await leerAvisos(e.page); await e.page.waitForTimeout(300);
            }
        };
        await pagarAna();                       // la primera vez, legítima
        await abrirCola(e.page);
        await caso('«Generar recibo» ya no propone la semana pagada: propone la siguiente y lo dice', async () => {
            await (await menu(e.page, 'Ana Prueba', 'Generar recibo')).click();
            await e.page.waitForSelector('#modalPagoNom.open');
            const v = await e.page.evaluate(() => ({ d:pnDesde.value, h:pnHasta.value,
                aviso: pnCorrBanner.offsetParent ? pnCorrBanner.textContent : '' }));
            assert.deepEqual([v.d, v.h], ['2026-11-23', '2026-11-29'], 'propuso ' + v.d + '→' + v.h);
            assert.match(v.aviso, /ya está pagado/);
        });
        await caso('regresando a mano las fechas a la semana pagada, NO se guarda y dice por qué', async () => {
            await e.page.fill('#pnDesde', '2026-11-16'); await e.page.dispatchEvent('#pnDesde', 'change');
            await e.page.fill('#pnHasta', '2026-11-22'); await e.page.dispatchEvent('#pnHasta', 'change');
            await e.page.click('#pnBtnConfirmar');
            const av = await leerAvisos(e.page);
            assert.ok(av.some(t => /ya tiene pagado del 16 nov al 22 nov/.test(t)), 'sin aviso: ' + JSON.stringify(av));
            assert.equal(await e.page.evaluate(() => document.getElementById('modalPagoNom').classList.contains('open')),
                         true, 'cerró el modal y perdió la captura');
            const n = await e.page.evaluate(() => [_cacheRecibos.length,
                _cacheGastos.filter(x => x.staffId === 's_ana' && x.nomina).length]);
            assert.deepEqual(n, [1, 1], 'quedó un segundo recibo o un segundo pago');
            await e.page.evaluate(() => _cerrarPagoNom());
        });
        await e.ctx.close();

        /* ── F · dos pestañas pagan el mismo recibo ───────────────────────
           El hueco que dejó escrito el reporte del 17-nov. El celular de la
           dueña y la tablet del gerente —aquí, dos pestañas— ven a Ana con
           «Recibo listo». Las dos abren el gasto antes de que ninguna guarde,
           y las dos guardan. El gasto nacía con un id al azar: salían dos
           pagos de la misma semana. */
        console.log('\n══ F · Dos pestañas pagan el mismo recibo ══');
        const f = await abrir(browser, '2026-11-17T12:00:00-06:00');
        await entrarANominas(f.page); await abrirCola(f.page);
        await (await menu(f.page, 'Ana Prueba', 'Generar recibo')).click();
        await f.page.waitForSelector('#modalPagoNom.open');
        await f.page.click('#pnBtnConfirmar');
        await f.page.waitForSelector('#modalPagoNom.open', { state:'detached' });
        await f.page.waitForTimeout(300);
        const f2 = await pestana(f.ctx);
        await entrarANominas(f2); await abrirCola(f2);
        /* Se trae la pestaña al frente antes de usarla, como haría una persona.
           Además, una pestaña de fondo no pinta cuadros, y waitForFunction
           sondea por cuadro: se le pide sondear por tiempo. */
        const abrirGasto = async (pg, quien) => {
            await pg.bringToFront();
            await (await menu(pg, quien || 'Ana Prueba', 'Generar gasto')).click();
            await pg.waitForFunction(() => document.getElementById('gMonto') && document.getElementById('gMonto').offsetParent,
                                     null, { polling: 100 });
        };
        await caso('la segunda pestaña ve el recibo listo (viene de la nube)', async () => {
            assert.match(await textoFila(f2, 'Ana Prueba'), /Recibo listo/i);
        });
        await caso('las dos pagan a la vez → en la nube queda UN gasto, y el recibo apunta a él', async () => {
            await abrirGasto(f.page); await abrirGasto(f2);          // las dos con el modal abierto
            await f.page.click('#btnGuardar'); await leerAvisos(f.page);
            await f2.click('#btnGuardar');     await leerAvisos(f2);
            await f.page.waitForTimeout(500);
            const nube = await f.page.evaluate(() => __nube.leer());
            const g = (nube.gastos || []).map(r => r.datos).filter(x => x.staffId === 's_ana' && x.nomina);
            const r = (nube.nomina_recibos || []).map(r => r.datos).find(x => x.staffId === 's_ana');
            assert.equal(g.length, 1, 'la misma semana se pagó ' + g.length + ' veces: ' + g.map(x => x.id).join(', '));
            assert.equal(r.gastoId, g[0].id, 'el recibo no apunta al gasto');
        });
        await f2.close();

        /* ── G · a la otra pestaña le llegó el gasto, pero no el sello ─────
           La lista de gastos se refresca sola (realtime) cuando no hay modal
           abierto; la cola de recibos no. Esa pestaña ve el pago en gastos y,
           en la cola, el recibo todavía «listo». Pagar otra vez pisaría el
           gasto de la primera con su método y su fecha. */
        console.log('\n══ G · Le llegó el gasto, pero no el sello del recibo ══');
        await (await menu(f.page, 'Beto Prueba', 'Generar recibo')).click();
        await f.page.waitForSelector('#modalPagoNom.open');
        await f.page.click('#pnBtnConfirmar');
        await f.page.waitForSelector('#modalPagoNom.open', { state:'detached' });
        await f.page.waitForTimeout(300);
        const g2 = await pestana(f.ctx);
        await entrarANominas(g2); await abrirCola(g2);
        await abrirGasto(f.page, 'Beto Prueba');
        await f.page.click('#btnGuardar'); await leerAvisos(f.page);
        await f.page.waitForTimeout(400);
        await g2.bringToFront();
        await g2.evaluate(() => _reloadGastosRT());                    // lo que hace el realtime de gastos
        await caso('«Generar gasto» en la otra pestaña reconoce el pago: no paga otra vez y lo dice', async () => {
            await (await menu(g2, 'Beto Prueba', 'Generar gasto')).click();
            const av = await leerAvisos(g2);
            const abierto = await g2.evaluate(() => !!(document.getElementById('gMonto') && gMonto.offsetParent));
            assert.equal(abierto, false, 'abrió otro pago');
            assert.ok(av.some(t => /ya se pagó/.test(t)), 'sin aviso: ' + JSON.stringify(av));
            const nube = await g2.evaluate(() => __nube.leer());
            const gs = (nube.gastos || []).map(r => r.datos).filter(x => x.staffId === 's_beto' && x.nomina);
            assert.equal(gs.length, 1, 'pagos de Beto en la nube: ' + gs.length);
        });
        await caso('…y en esa pestaña el recibo queda sellado: Beto sale de «por pagar»', async () => {
            const sellado = await g2.evaluate(() => { const r = _cacheRecibos.find(x => x.staffId === 's_beto');
                                                      return !!(r && r.gastoId && r.pagadoEn); });
            assert.equal(sellado, true, 'el recibo sigue sin sello');
            await abrirCola(g2);
            assert.doesNotMatch(await textoFila(g2, 'Beto Prueba'), /Recibo listo/i);
        });
        await f.ctx.close();
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]).length;
    console.log('\n' + (malos ? '🚨 ' + malos + ' de ' + resultados.length + ' casos fallaron'
                              : '🔒 NÓMINA EN NAVEGADOR OK — ' + resultados.length + ' casos'));
    process.exit(malos ? 1 : 0);
})();
