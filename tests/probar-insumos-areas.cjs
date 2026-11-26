/* INSUMOS · ÁREAS, ETIQUETA Y UNIDADES DEL STOCK (Edwin, 26-nov) — en un
   Chromium de verdad con insumos.html tal cual y el Supabase de mentira.
     · La info de cada insumo es solo su identidad: nombre, variedad, marca y
       contenido (ni el empaque «Granel», ni «Congelado -18°C»).
     · El catálogo se filtra por área, con cuántos hay en cada una.
     · «Editar áreas»: renombrar, agregar un área propia dentro de una base y
       eliminar moviendo sus insumos; se guarda en inv_ajustes.areas.
     · El editor del insumo ofrece las áreas propias y guarda area + areaSub.
     · El stock admite g / kg (o ml / L) además de la pieza y la compra.

   Ejecutar: NODE_PATH=<playwright>/node_modules node tests/probar-insumos-areas.cjs
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
const ins = (id, d) => ({ negocio_id: 'n1', insumo_id: id, datos: Object.assign({ id, activo: '1', sucursales: ['suc_principal'] }, d) });
const NUBE = {
    __auth: [{ id: 'u1', email: 'duena@etaax.prueba', password: 'x', meta: { nombre: 'Dueña' } }],
    negocios: [{ id: 'n1', usuario_id: 'u1', datos: { nombre: 'Café de prueba' } }],
    negocio_sucursales: [{ negocio_id: 'n1', datos: { sucursales: [{ id: 'suc_principal', nombre: 'Matriz', activa: true }] } }],
    suscripciones: [{ negocio_id: 'n1', estado: 'activa', plan: null }],
    inv_ajustes: [{ negocio_id: 'n1', datos: { compuestos: {}, bateo: {}, subcats: { destilado: ['Raicilla'] } } }],
    negocio_insumos: [
        ins('i_tilapia', { nombre: 'Pescado Tilapia', marca: 'Pescado Tilapia', maduracion: 'Congelado (-18°C o menos)', tipoInsumo: 'carne', familia: 'Alimentos',
            categoria: 'Pescado', empaque: 'Granel', area: 'almacen_cocina',
            presentaciones: [{ presentacionCompra: 'Granel', umPresCompra: 'KG', contNeto: '1000', umContenido: 'G', precio: '112.52' }] }),
        ins('i_mezcal', { nombre: 'Mezcal', variedad: 'Espadín', marca: 'Casa', tipoInsumo: 'destilado', familia: 'Bebidas', categoria: 'Destilados',
            empaque: 'Botella', area: 'barra', presentaciones: [{ presentacionCompra: 'Botella', contNeto: '750', umContenido: 'ML', precio: '400' }] }),
        ins('i_vino', { nombre: 'Maat', marca: 'Maat', tipoInsumo: 'vino', familia: 'Bebidas', categoria: 'Vino Blanco', empaque: 'Botella', area: 'almacen_general',
            presentaciones: [{ presentacionCompra: 'Botella', contNeto: '750', umContenido: 'ML', precio: '383' }] }),
        ins('i_servilleta', { nombre: 'Servilleta', tipoInsumo: 'abarrote', familia: 'Desechables', categoria: 'Desechables', area: 'almacen_general',
            presentaciones: [{ presentacionCompra: 'Paquete', contNeto: '1', umContenido: 'PZA', precio: '30' }] }),
        ins('i_hielo', { nombre: 'Hielo', tipoInsumo: 'abarrote', familia: 'Abarrotes', categoria: 'Hielo',
            presentaciones: [{ presentacionCompra: 'Bolsa', contNeto: '5', umContenido: 'KG', precio: '45' }] })
    ],
    recetas: [], permisos: []
};
const nubeDe = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('__nube')));
function semilla(n) {
    return `(() => {
        window.__avisos = []; window.alert = (m) => __avisos.push(String(m)); window.confirm = (m) => { __avisos.push('¿' + m); return true; };
        if (!localStorage.getItem('__sembrado')) {
            localStorage.clear();
            localStorage.setItem('__nube', ${JSON.stringify(JSON.stringify(n))});
            localStorage.setItem('etaax_negocio_activo', 'n1');
            localStorage.setItem('etaax_sucursal_activa', 'suc_principal');
            localStorage.setItem('etaax_ctx', JSON.stringify({ ctxType: 'owner', negId: 'n1', negNombre: 'Café de prueba', sucId: 'suc_principal', sucNombre: 'Matriz', userName: 'Dueña' }));
            localStorage.setItem('etaax_negocios', JSON.stringify([{ id: 'n1', usuarioId: 'u1', nombre: 'Café de prueba' }]));
            localStorage.setItem('etaax_n1_sucursales', JSON.stringify([{ id: 'suc_principal', nombre: 'Matriz' }]));
            localStorage.setItem('etaax_novedades_vista', '{}');
            localStorage.setItem('__sembrado', '1');
        }
        if (!sessionStorage.getItem('__ses')) sessionStorage.setItem('__ses', JSON.stringify({ id: 'u1', email: 'duena@etaax.prueba' }));
    })();`;
}
async function abrir(browser) {
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
    await ctx.addInitScript(semilla(NUBE));
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    await page.goto(ORIGEN + '/recetas/insumos.html');
    await page.waitForFunction(() => typeof getInsumos === 'function' && getInsumos().length >= 5 && document.getElementById('filtroAreaIns') &&
        document.getElementById('filtroAreaIns').options.length > 2, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    return { ctx, page };
}
const foto = (page, nombre) => process.env.SHOTS ? page.waitForTimeout(600).then(() => page.screenshot({ path: path.join(process.env.SHOTS, nombre + '.png'), fullPage: false })) : null;
const opciones = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s + ' option')].map(o => o.textContent.trim()), sel);

(async () => {
    const browser = await chromium.launch();
    try {
        const { page: p } = await abrir(browser);
        console.log('\n══ Insumos · la info de cada insumo ══');
        await caso('solo nombre, variedad, marca y contenido: sin «Granel» ni «Congelado -18°C»; 1000 g se lee «1 kg»', async () => {
            const r = await p.evaluate(() => getInsumos().map(x => [x.id, insumoTitulo(x), insumoMeta(x)]).sort());
            assert.deepEqual(r, [['i_hielo', 'Hielo', '5 kg'], ['i_mezcal', 'Mezcal · Espadín', '750 ml · Casa'], ['i_servilleta', 'Servilleta', '1 pza'],
                ['i_tilapia', 'Pescado Tilapia', '1 kg'], ['i_vino', 'Maat', '750 ml']]);
        });
        await caso('…y así sale en el catálogo', async () => {
            const t = await p.evaluate(() => document.getElementById('mainContent').innerText);
            assert.ok(t.indexOf('Pescado Tilapia') > -1 && t.indexOf('Congelado') === -1 && t.indexOf('Granel 1000') === -1, 'se colaron metadatos');
        });

        console.log('\n══ Insumos · filtro por área ══');
        await foto(p, 'a1-filtro');
        await caso('el filtro trae las cinco áreas con cuántos hay en cada una, y «Sin área»', async () =>
            assert.deepEqual(await opciones(p, '#filtroAreaIns'), ['Todas las áreas', 'Barra (1)', 'Cocina (0)', 'Almacén barra (0)', 'Almacén cocina (1)', 'Almacén general (2)', 'Sin área (1)']));
        await p.selectOption('#filtroAreaIns', 'almacen_general'); await p.waitForTimeout(300);
        await caso('…elegir «Almacén general» deja solo los suyos', async () =>
            assert.deepEqual(await p.evaluate(() => _listaFiltrada.map(x => x.id).sort()), ['i_servilleta', 'i_vino']));
        await p.selectOption('#filtroAreaIns', '__sin'); await p.waitForTimeout(200);
        await caso('…y «Sin área» los que no tienen', async () => assert.deepEqual(await p.evaluate(() => _listaFiltrada.map(x => x.id)), ['i_hielo']));
        await p.selectOption('#filtroAreaIns', ''); await p.waitForTimeout(200);

        console.log('\n══ Insumos · editar áreas ══');
        await p.click('#btnAreasIns'); await p.waitForSelector('#areasInsOv .i-areas-caja');
        await foto(p, 'a2-areas');
        await caso('«Editar áreas» enseña cada área con sus insumos y en qué inventario entra', async () => {
            const r = await p.evaluate(() => [...document.querySelectorAll('#areasInsOv .i-areas-fila')].map(f => f.querySelector('input').value + ' | ' + f.querySelector('.i-areas-n').textContent + ' | ' + f.querySelector('small').textContent));
            assert.deepEqual(r, ['Barra | 1 insumo | Entra en el inventario de Barra', 'Cocina | 0 insumos | Entra en el inventario de Cocina',
                'Almacén barra | 0 insumos | Entra en el inventario de Barra y Bodega', 'Almacén cocina | 1 insumo | Entra en el inventario de Cocina y Bodega',
                'Almacén general | 2 insumos | Entra en el inventario de Bodega']);
        });
        await p.fill('#areasInsOv [data-area="almacen_barra"] input', 'Bodega de barra');
        await p.fill('#iAreasNueva', 'Cava'); await p.selectOption('#iAreasNuevaBase', 'almacen_barra'); await p.click('#areasInsOv button:has-text("Agregar")');
        await caso('…agregar «Cava» dentro de la bodega de barra', async () =>
            assert.match(await p.evaluate(() => document.querySelector('#areasInsOv .i-areas-fila:nth-of-type(4)').innerText.replace(/\s+/g, ' ')), /Área propia dentro de Bodega de barra/));
        await p.click('#areasInsOv [data-area="almacen_general"] button:has-text("Eliminar")');
        const cava = await p.evaluate(() => 'sub:' + _areasEd.cfg.extra[0].k);
        await p.selectOption('#areasInsOv [data-area="almacen_general"] select', cava);
        await foto(p, 'a3-areas-editando');
        await caso('…eliminar «Almacén general» pide a dónde mover sus 2 insumos', async () =>
            assert.match(await p.evaluate(() => document.querySelector('#areasInsOv [data-area="almacen_general"]').innerText.replace(/\s+/g, ' ')), /Mover sus 2 a/));
        await p.click('#areasInsOv .i-areas-btn.ok'); await p.waitForTimeout(2200);   // setInsumos sube 1.2 s después
        await caso('al guardar, los insumos se mueven: area = la base (la que entiende el inventario) y areaSub = Cava', async () => {
            const n = await nubeDe(p);
            const r = n.negocio_insumos.filter(x => ['i_vino', 'i_servilleta'].indexOf(x.insumo_id) > -1).map(x => x.datos.area + '/' + (x.datos.areaSub ? 'cava' : ''));
            assert.deepEqual(r, ['almacen_barra/cava', 'almacen_barra/cava']);
        });
        await caso('…la configuración queda en inv_ajustes.areas, sin pisar lo demás del documento', async () => {
            const d = (await nubeDe(p)).inv_ajustes[0].datos;
            assert.deepEqual([d.areas.nombres.almacen_barra, d.areas.extra.map(e => e.label + '@' + e.base), d.areas.ocultas, d.subcats.destilado],
                ['Bodega de barra', ['Cava@almacen_barra'], ['almacen_general'], ['Raicilla']]);
        });
        await caso('…y el filtro ya dice los nombres nuevos (Cava dentro de la bodega de barra; sin Almacén general)', async () =>
            assert.deepEqual(await opciones(p, '#filtroAreaIns'), ['Todas las áreas', 'Barra (1)', 'Cocina (0)', 'Bodega de barra (2)', 'Cava (2)', 'Almacén cocina (1)', 'Sin área (1)']));
        await caso('…el nombre nuevo lo leen todos los módulos (StaffArea.nomIns), con la misma clave', async () =>
            assert.equal(await p.evaluate(() => StaffArea.nomIns('almacen_barra')), '📦 Bodega de barra'));

        console.log('\n══ Insumos · el editor ══');
        await p.evaluate(() => editarInsumo('i_vino')); await p.waitForTimeout(800);
        await caso('el área del insumo ofrece las áreas propias, y la suya viene elegida', async () => {
            const r = await p.evaluate(() => { const s = document.getElementById('ins-area'); return [s.options[s.selectedIndex].textContent.trim(), [...s.options].map(o => o.textContent.trim())]; });
            assert.equal(r[0], 'Cava · dentro de Bodega de barra');
            assert.deepEqual(r[1], ['Sin área', 'Barra', 'Cocina', 'Bodega de barra', 'Cava · dentro de Bodega de barra', 'Almacén cocina']);
        });
        await p.evaluate(() => { cerrarModalBtn && cerrarModalBtn(); }); await p.waitForTimeout(400);
        await p.evaluate(() => editarInsumo('i_tilapia')); await p.waitForTimeout(800);
        await foto(p, 'a4-stock');
        await caso('el stock de un granel de 1000 g ofrece granel, g y kg (no solo «granel»)', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('#stockBlk-0 select.i-stock-um')].map(s => [...s.options].map(o => o.textContent))),
                [['granel', 'g', 'kg'], ['granel', 'g', 'kg']]));
        await p.selectOption('#stockBlk-0 select.i-stock-um >> nth=0', 'kg');
        await caso('…elegir kg queda en la presentación y el núcleo lo convierte (5 kg = 5 piezas de 1 kg)', async () =>
            assert.deepEqual(await p.evaluate(() => { presentacionesTemp[0].stockMin = '5'; const d = EtaaxCore.stockDefinido(presentacionesTemp[0]); return [presentacionesTemp[0].stockMinUm, d.minPiezas]; }), ['kg', 5]));
        await p.evaluate(() => { cerrarModalBtn && cerrarModalBtn(); }); await p.waitForTimeout(300);
        await p.evaluate(() => editarInsumo('i_mezcal')); await p.waitForTimeout(800);
        await caso('…y el de una botella de 750 ml ofrece ml y L', async () =>
            assert.deepEqual(await p.evaluate(() => [...document.querySelector('#stockBlk-0 select.i-stock-um').options].map(o => o.textContent)), ['botella', 'ml', 'L']));
    } finally {
        await browser.close();
    }
    const malos = resultados.filter(r => !r[1]);
    console.log(malos.length ? '\n🚨 INSUMOS EN NAVEGADOR: ' + malos.length + ' de ' + resultados.length + ' FALLAN' : '\n🔒 INSUMOS EN NAVEGADOR OK — ' + resultados.length + ' casos');
    process.exit(malos.length ? 1 : 0);
})();
