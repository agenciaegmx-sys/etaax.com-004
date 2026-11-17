/* La COLA DE SALIDA con dos pestañas, en un navegador DE VERDAD.

   El bug (17-nov): había una sola cola para todo el navegador. Cada pestaña la
   cargaba en su memoria al abrir y la guardaba ENTERA en cada cambio. Dos
   pestañas sin red: A encola su gasto, B encola el suyo y guarda SU lista
   —que no conoce el de A— encima. A se cierra o se recarga, vuelve la red, y
   el gasto de A no llega nunca. Reproducido aquí: «en la nube: gB1».

   Ahora cada pestaña tiene su cola y un candado del navegador (Web Locks)
   mientras vive; la cola de una pestaña muerta la adopta otra. Esto lo prueba
   con IndexedDB y Web Locks reales —lo único que el candado de Node no tiene:
   ahí se simulan los dos, y una simulación mía de un candado del navegador
   prueba lo que yo creo que hace el navegador, no lo que hace—.

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-cola-navegador.cjs */
'use strict';
const assert = require('node:assert/strict');
const { chromium, abrir, pestana } = require('./navegador-comun.cjs');

const RELOJ = '2026-11-17T12:00:00-06:00';
const resultados = [];
async function caso(nombre, fn) {
    try { await fn(); resultados.push([nombre, true]); console.log('  ✅ ' + nombre); }
    catch (e) { resultados.push([nombre, false]); console.log('  💥 ' + nombre + '\n     ' + String(e.message).split('\n')[0]); }
}

/* ── pasos ────────────────────────────────────────────────────────────── */
const sinRed  = (pg) => pg.evaluate(() => { __nube.caida = true; });
/* Vuelve la red y la pestaña se entera como en la vida real: el evento
   `online` dispara su flush. */
const conRed  = (pg) => pg.evaluate(() => { __nube.caida = false; window.dispatchEvent(new Event('online')); });
/* Guardar algo «como la app»: por la cola, con su id. Y esperar a que la cola
   de esa pestaña ya esté en el disco —si no, cerrar la pestaña probaría el
   debounce de 250 ms y no la cola—. */
async function guardar(pg, id, extra) {
    await pg.bringToFront();
    await pg.evaluate(({ id, extra }) => sbUpsert('gastos', Object.assign({ id: id, monto: 1, concepto: 'prueba ' + id }, extra || {})),
                      { id, extra });
    await pg.waitForFunction(() => etaaxStore.pendientes() === 0, null, { polling: 100 });
}
const enNube   = async (pg) => (await pg.evaluate(() => (__nube.leer().gastos || []).map(r => r.id))).sort();
const subidas  = async (pg, id) => (await pg.evaluate(() => __nube.log())).filter(x => x === 'gastos:' + id).length;
const datosDe  = async (pg, id) => pg.evaluate((id) => ((__nube.leer().gastos || []).find(r => r.id === id) || {}).datos, id);
/* Se espera a que la nube tenga lo que se pide, con un tope: si no llega, el
   caso falla diciendo qué sí llegó. */
async function esperarNube(pg, ids, ms) {
    try {
        await pg.waitForFunction((ids) => {
            const hay = (__nube.leer().gastos || []).map(r => r.id);
            return ids.every(i => hay.indexOf(i) > -1);
        }, ids, { polling: 200, timeout: ms || 8000 });
    } catch (e) {
        throw new Error('en la nube: ' + JSON.stringify(await enNube(pg)) + ' · esperado: ' + JSON.stringify(ids));
    }
}
const colasEnDisco = (pg) => pg.evaluate(async () =>
    Object.keys(await etaaxStore.leerDisco(k => /outbox_v1$/.test(k))).sort());

(async () => {
    const browser = await chromium.launch();
    try {
        console.log('\n══ Cola de salida · arranque ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ);
            await caso('la página trabaja con una cola POR PESTAÑA (hay Web Locks)', async () => {
                const d = await page.evaluate(() => { const c = console.log; console.log = () => {};
                                                      try { return _sbColaDiag(); } finally { console.log = c; } });
                assert.equal(d.cola_por_pestana, true, 'arrancó con la cola común');
                assert.match(d.llave, /^etaax_tab[a-z0-9]+_outbox_v1$/);
            });
            await ctx.close();
        }

        /* ── A · el caso reproducido: se CIERRA la pestaña que encoló ─────── */
        console.log('\n══ A · Dos pestañas sin red; una se cierra ══');
        {
            const { ctx, page: A } = await abrir(browser, RELOJ);
            const B = await pestana(ctx);
            await sinRed(A); await sinRed(B);
            await guardar(A, 'gA1');
            await guardar(B, 'gB1');
            await caso('cada pestaña guarda SU cola en el disco: ninguna pisa a la otra', async () => {
                const k = await colasEnDisco(B);
                assert.equal(k.length, 2, 'colas en disco: ' + JSON.stringify(k));
            });
            await A.close();
            await conRed(B);
            await caso('se cierra A, vuelve la red en B → los DOS gastos llegan a la nube', async () => {
                await esperarNube(B, ['gA1', 'gB1']);
            });
            await caso('…cada uno una sola vez', async () => {
                assert.deepEqual([await subidas(B, 'gA1'), await subidas(B, 'gB1')], [1, 1]);
            });
            await caso('…y no quedan colas huérfanas en el disco', async () => {
                await B.waitForTimeout(400);
                assert.deepEqual(await colasEnDisco(B), []);
            });
            await ctx.close();
        }

        /* ── B · se RECARGA la pestaña que encoló ─────────────────────────── */
        console.log('\n══ B · Dos pestañas sin red; una se recarga ══');
        {
            const { ctx, page: A } = await abrir(browser, RELOJ);
            const B = await pestana(ctx);
            await sinRed(A); await sinRed(B);
            await guardar(A, 'gA1');
            await guardar(B, 'gB1');
            await A.reload();
            await A.waitForFunction(() => window.etaaxStore && etaaxStore.hidratado(), null, { polling: 100 });
            await sinRed(A);
            await conRed(B);
            await caso('se recarga A, vuelve la red → los DOS gastos llegan a la nube', async () => {
                await esperarNube(B, ['gA1', 'gB1']);
            });
            await caso('…cada uno una sola vez', async () => {
                assert.deepEqual([await subidas(B, 'gA1'), await subidas(B, 'gB1')], [1, 1]);
            });
            await ctx.close();
        }

        /* ── C · las dos VIVAS: nadie sube lo de la otra ──────────────────── */
        console.log('\n══ C · Las dos pestañas vivas ══');
        {
            const { ctx, page: A } = await abrir(browser, RELOJ);
            const B = await pestana(ctx);
            await sinRed(A); await sinRed(B);
            await guardar(A, 'gA1');
            await guardar(B, 'gB1');
            await conRed(B);
            await caso('vuelve la red solo en B → sube lo suyo y NO toca la cola de A (A vive)', async () => {
                await esperarNube(B, ['gB1']);
                await B.waitForTimeout(600);
                assert.equal(await subidas(B, 'gA1'), 0, 'B subió lo de una pestaña viva');
            });
            await conRed(A);
            await caso('…y A sube lo suyo cuando le toca: cada gasto una sola vez', async () => {
                await esperarNube(A, ['gA1', 'gB1']);
                await A.waitForTimeout(400);
                assert.deepEqual([await subidas(A, 'gA1'), await subidas(A, 'gB1')], [1, 1]);
            });
            await ctx.close();
        }

        /* ── D · el MISMO registro en las dos pestañas: gana el más nuevo ─── */
        console.log('\n══ D · El mismo registro editado en las dos ══');
        {
            const { ctx, page: A } = await abrir(browser, RELOJ);
            const B = await pestana(ctx);
            await sinRed(A); await sinRed(B);
            await guardar(A, 'gX', { monto: 100, concepto: 'versión vieja (A)' });
            await A.waitForTimeout(50);
            await guardar(B, 'gX', { monto: 250, concepto: 'versión nueva (B)' });
            await A.close();
            await conRed(B);
            await caso('A editó primero y se cerró; B editó después → en la nube queda la de B', async () => {
                await esperarNube(B, ['gX']);
                await B.waitForTimeout(600);
                const d = await datosDe(B, 'gX');
                assert.equal(d && d.monto, 250, 'quedó la versión vieja: ' + JSON.stringify(d));
            });
            await ctx.close();
        }

        /* ── F · la que tiene red se entera AL INSTANTE ──────────────────────
           B tiene red y está quieta; A —sin red en ese aparato— guarda y se
           cierra. Nada dispara el flush de B (ni un guardado, ni `online`):
           sin vigilar el candado de A, lo de A esperaría la vuelta de 20 s.
           Vigilándolo, el navegador avisa a B en cuanto A muere. */
        console.log('\n══ F · La pestaña con red adopta en cuanto la otra se cierra ══');
        {
            const { ctx, page: A } = await abrir(browser, RELOJ);
            const B = await pestana(ctx);
            await sinRed(A);
            await guardar(A, 'gA1');
            await guardar(B, 'gB1');                 // B sube lo suyo y, de paso, ve la cola viva de A
            await esperarNube(B, ['gB1']);
            /* Con B al frente, que corran sus temporizadores retrasados: el de
               arranque (1.5 s) se queda congelado mientras la pestaña está de
               fondo y se suelta después, justo cuando se mide esto. */
            await B.bringToFront();
            await B.waitForTimeout(2000);
            await caso('B, al ver la cola de A viva, se forma en la fila de su candado', async () => {
                const enFila = await B.evaluate(async () => (await navigator.locks.query()).pending.map(l => l.name));
                assert.ok(enFila.some(n => /^etaax-cola-/.test(n)), 'nadie vigila a A: ' + JSON.stringify(enFila));
            });
            /* B en OTRA ventana: cerrar A no le da el foco. Si lo recibiera, su
               `focus` correría el flush y esto pasaría sin vigilar nada. */
            await B.evaluate(() => {
                window.addEventListener('focus', e => e.stopImmediatePropagation(), true);
                document.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
            });
            await A.close();
            await caso('se cierra A → B sube lo de A sin esperar su vuelta de 20 s', async () => {
                await esperarNube(B, ['gA1'], 1500);
                assert.equal(await subidas(B, 'gA1'), 1);
            });
            await ctx.close();
        }

        /* ── E · la cola COMÚN de la versión anterior no se pierde ─────────── */
        console.log('\n══ E · La cola que dejó la versión anterior ══');
        {
            const { ctx, page } = await abrir(browser, RELOJ);
            await sinRed(page);
            /* Lo que deja en disco una pestaña con el código de antes del 17-nov. */
            await page.evaluate(() => {
                etaaxStore.set('etaax_outbox_v1', JSON.stringify([{
                    op: 'upsert', tabla: 'gastos', k: 'gViejo', uid: Date.now().toString(36) + 'legado',
                    payload: { id: 'gViejo', negocio_id: 'n1', datos: { id: 'gViejo', monto: 7 } },
                    opts: { onConflict: 'id' } }]));
            });
            await page.waitForFunction(() => etaaxStore.pendientes() === 0, null, { polling: 100 });
            const nueva = await pestana(ctx);
            await page.close();
            await conRed(nueva);
            await caso('una pestaña nueva adopta la cola común y la sube', async () => {
                await esperarNube(nueva, ['gViejo']);
                assert.equal(await subidas(nueva, 'gViejo'), 1);
            });
            await caso('…y la cola común desaparece del disco', async () => {
                await nueva.waitForTimeout(400);
                assert.deepEqual(await colasEnDisco(nueva), []);
            });
            await ctx.close();
        }
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]).length;
    console.log('\n' + (malos ? '🚨 ' + malos + ' de ' + resultados.length + ' casos fallaron'
                              : '🔒 COLA EN NAVEGADOR OK — ' + resultados.length + ' casos'));
    process.exit(malos ? 1 : 0);
})();
