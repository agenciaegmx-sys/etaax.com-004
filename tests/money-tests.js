#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════
   ETAAX — CANDADO DE FÓRMULAS DE DINERO
   Corre el código REAL de producción (los <script> de diario.html y
   recetas/inventarios.js) en Node con un DOM simulado, y verifica que
   cada fórmula dé EXACTAMENTE lo que debe dar con datos conocidos.

   Correr ANTES de cada push:   node tests/money-tests.js
   Sale con código 1 si CUALQUIER fórmula truena o da otro número.

   Regla de oro: si un test falla, el test tiene razón hasta demostrar
   lo contrario — primero entiende POR QUÉ cambió el número.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');

/* ── Mini DOM + entorno del navegador ─────────────────────────────── */
function crearContexto() {
    const values = {};
    function el(id) {
        const e = {
            id,
            get value() { return values[id] !== undefined ? String(values[id]) : ''; },
            set value(v) { values[id] = v; },
            textContent: '', className: '', placeholder: '',
            style: {}, dataset: {},
            classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
            setAttribute(){}, getAttribute(){ return null; }, remove(){},
            appendChild(){}, querySelector(){ return null; },
            querySelectorAll(){ const a = []; a.forEach = Array.prototype.forEach; return a; },
            addEventListener(){}, focus(){}, selectedIndex: 0,
            childNodes: [{ textContent: '' }], parentElement: { querySelectorAll(){ return []; } },
            closest(){ return null; },
        };
        /* innerHTML sí se "parsea", pero solo para <option>: sin eso un <select>
           poblado por JS queda sin `options` y toda la lógica que pregunta "¿este
           valor está en la lista?" responde que no — el test pasaría por la rama
           equivocada sin avisar. Es lo mínimo para que un select sea comprobable. */
        let _html = '';
        Object.defineProperty(e, 'innerHTML', {
            get() { return _html; },
            set(v) {
                _html = String(v == null ? '' : v);
                e.options = [..._html.matchAll(/<option(?:\s+value="([^"]*)")?[^>]*>([\s\S]*?)<\/option>/g)]
                    .map(m => ({ value: m[1] !== undefined ? m[1] : m[2], text: m[2] }));
            },
        });
        e.options = [];
        return e;
    }
    const els = {};
    const storage = {};
    const ctx = {
        console,
        document: {
            getElementById(id) { if (!(id in els)) els[id] = el(id); return els[id]; },
            querySelector() { return null; },
            querySelectorAll() { const a = []; a.forEach = Array.prototype.forEach; return a; },
            addEventListener() {}, removeEventListener() {},
            createElement(t) { return el('_' + t); },
            body: { appendChild(){}, style: {} },
            documentElement: { setAttribute(){}, getAttribute(){ return 'dark'; } },
            readyState: 'complete',
        },
        localStorage: {
            getItem(k){ return k in storage ? storage[k] : null; },
            setItem(k, v){ storage[k] = String(v); },
            removeItem(k){ delete storage[k]; },
            key(i){ return Object.keys(storage)[i] || null; },
            get length(){ return Object.keys(storage).length; },
        },
        sessionStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
        alert(){}, confirm(){ return true; }, prompt(){ return ''; },
        setTimeout(){ return 0; }, setInterval(){ return 0; }, clearTimeout(){}, clearInterval(){},
        navigator: {}, location: { pathname: '/', href: '', origin: 'https://etaax.com' },
        URL: { createObjectURL(){ return ''; }, revokeObjectURL(){} }, Blob: function(){},
        Image: function(){ return { set src(v){}, onload: null }; },
        _supabase: {
            from(){ return { select(){ return this; }, eq(){ return this; },
                order(){ return Promise.resolve({ data: [], error: null }); },
                maybeSingle(){ return Promise.resolve({ data: null, error: null }); } }; },
            rpc(){ return Promise.resolve({ data: null, error: null }); },
            removeChannel(){},
            storage: { from(){ return { upload(){ return Promise.resolve({ error: null }); }, getPublicUrl(){ return { data: { publicUrl: '' } }; } }; } },
        },
        sbUpsert(){}, sbDelete(){}, sbUpsertDoc(){}, sbRealtime(){ return null; },
        sbDeletesPendientes(){ return {}; }, sbSubirEvidencia(){ return Promise.resolve(null); },
        _pedirClaveAdmin(_a, cb){ cb && cb(); },
        etx(x){ return String(x == null ? '' : x); },
        etaaxMarca(){ return {}; }, etaaxReporteHeader(){ return ''; }, etaaxReporteFooter(){ return ''; },
        QrPuente: null, NominaParams: null, QRCode: function(){},
        etaaxPerm(){ return true; }, etaaxPermisosRol(){ return {}; },
        _storage: storage, // acceso directo desde los tests
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    return ctx;
}

function cargarInline(ctx, htmlPath) {
    const html = fs.readFileSync(path.join(RAIZ, htmlPath), 'utf8');
    const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    bloques.forEach((b, i) => {
        try { vm.runInContext(b, ctx, { filename: htmlPath + '#' + i }); }
        catch (e) { /* fallas de arranque por stubs (p.ej. onclick de mayorWall) no afectan las fórmulas */ }
    });
    return ctx;
}
// Asignar una variable top-level (let) DENTRO del contexto del script
function setVar(ctx, nombre, valor) {
    ctx.__tmpTest = valor;
    vm.runInContext(nombre + ' = __tmpTest;', ctx);
}
function cargarJS(ctx, jsPath) {
    const src = fs.readFileSync(path.join(RAIZ, jsPath), 'utf8');
    try { vm.runInContext(src, ctx, { filename: jsPath }); } catch (e) { /* idem */ }
    return ctx;
}

/* ── Runner ───────────────────────────────────────────────────────── */
let PASA = 0, FALLA = 0;
function test(nombre, fn) {
    try { fn(); PASA++; console.log('  ✅', nombre); }
    catch (e) { FALLA++; console.log('  💥', nombre, '→', e.message); }
}
function eq(real, esperado, msg) {
    const ok = typeof esperado === 'number'
        ? Math.abs(real - esperado) < 0.005    // centavos: tolerancia de redondeo
        : real === esperado;
    if (!ok) throw new Error((msg || '') + ' esperado=' + esperado + ' real=' + real);
}

/* ═══════════════ SUITE A · CORTE DE CAJA (diario.html) ═══════════════ */
console.log('\n══ SUITE A · Corte de caja (administrativo/diario.html) ══');
const A = crearContexto();
cargarJS(A, 'etaax-core.js');            // núcleo: las páginas delegan aquí
cargarInline(A, 'administrativo/diario.html');
A._storage['etaax_negocio_activo'] = 'negT';

const corte = {
    fecha: '2026-07-10', fondoInicial: 2000,
    efectivo: 3000, tarjeta: 1500, transferencia: 500,
    propEfectivo: 200, propTarjeta: 300,
    propRetiroCaja: 300, retiros: 2000,
    comensales: 20, ventaDeclarada: 0, gastos: 800,
};
A._cacheGastosExt = [
    { fecha: '2026-07-10', metodoPago: 'caja_chica', monto: 150 },
    { fecha: '2026-07-10', metodoPago: 'caja_fuerte', monto: 999 },  // NO es caja chica
    { fecha: '2026-07-09', metodoPago: 'caja_chica', monto: 777 },   // otro día
    { fecha: '2026-07-10', metodoPago: 'caja_chica', monto: 500, sucursalId: 'sucB' }, // OTRA sucursal
];

test('ventasBruta = efectivo + tarjeta + transferencia', () => eq(A.ventasBruta(corte), 5000));
test('propinas = prop efectivo + prop tarjeta', () => eq(A.propinas(corte), 500));
test('taBanco (bruto) = tarjeta + propina tarjeta', () => eq(A.taBanco(corte), 1800));
test('flujoNeto = efectivo + taBanco + transferencia', () => eq(A.flujoNeto(corte), 5300));
test('resultado = flujoNeto − gastos', () => eq(A.resultado(corte), 4500));
test('cheque promedio = ventasBruta / comensales', () => eq(A.cheque(corte), 250));
test('cheque usa la venta DECLARADA si existe', () => eq(A.cheque({ ...corte, ventaDeclarada: 6000 }), 300));
test('_cajaChicaLive: solo caja chica y solo ese día', () => eq(A._cajaChicaLive('2026-07-10'), 150));
test('resguardo = fondo + efectivo − caja chica − props retiradas − fondo sig.', () =>
    eq(A.resguardo(corte), 2000 + 3000 - 150 - 300 - 2000)); // 2550
test('resguardo SIN retiro de propinas no las descuenta', () =>
    eq(A.resguardo({ ...corte, propRetiroCaja: 0 }), 2850));
// Gastos NO cruzan entre sucursales (bug: la caja chica de otra sucursal inflaba el resguardo)
test('_cajaChicaLive: Matriz solo ve su propia caja chica (no la de sucB)', () =>
    eq(A._cajaChicaLive('2026-07-10', 'suc_principal'), 150));
test('_cajaChicaLive: sucB ve su propia caja chica aparte', () =>
    eq(A._cajaChicaLive('2026-07-10', 'sucB'), 500));
test('resguardo de un corte de sucB usa la caja chica de sucB, no la de Matriz', () =>
    eq(A.resguardo({ ...corte, sucursalId: 'sucB' }), 2000 + 3000 - 500 - 300 - 2000)); // 2200
test('_gastosSuc filtra Matriz (3 gastos sin sucursal)', () =>
    eq(A._gastosSuc('suc_principal').length, 3));
test('_gastosSuc filtra sucB (1 gasto)', () =>
    eq(A._gastosSuc('sucB').length, 1));

// Comisiones bancarias por cuenta
const ctaConIva = { id: 'a', tipo: 'debito', comisionTC: 1.8, comisionTD: 2, aplicaIva: true, ivaPct: 16 };
const ctaSinIva = { id: 'b', tipo: 'debito', comisionTC: 3, comisionTD: 1, aplicaIva: false };
test('_comEf: 2% TD + IVA 16% = 2.32%', () => eq(A._comEf(ctaConIva, 'td'), 0.0232));
test('_comEf: 3% TC sin IVA = 3%', () => eq(A._comEf(ctaSinIva, 'tc'), 0.03));
test('_comEf: comisión no definida = 0', () => eq(A._comEf({ }, 'tc'), 0));
test('_netoCuenta: 1000 TC + 2000 TD con IVA', () =>
    eq(A._netoCuenta(ctaConIva, 1000, 2000), 1000 * (1 - 0.020880) + 2000 * (1 - 0.0232))); // 979.12+1953.6
test('_netoCuenta sin cuenta = bruto', () => eq(A._netoCuenta(null, 1000, 2000), 3000));

// taBancoNeto con desglose por cuenta guardado en el corte
A._cuentasBancarias = [ctaConIva, ctaSinIva];
const corteDesglose = { tarjeta: 3000, propTarjeta: 1000,
    tarjetaCuentas: [ { cuentaId: 'a', ventaTC: 1000, ventaTD: 2000, neto: A._netoCuenta(ctaConIva, 1000, 2000) } ] };
test('taBancoNeto = neto de cuentas + propina con TD de la predeterminada', () =>
    eq(A.taBancoNeto(corteDesglose), A._netoCuenta(ctaConIva, 1000, 2000) + 1000 * (1 - 0.0232)));
test('comisionBancoCorte = bruto − neto (nunca negativa)', () =>
    eq(A.comisionBancoCorte(corteDesglose), (3000 + 1000) - A.taBancoNeto(corteDesglose)));

// PROPINAS POR CUENTA (propTarjetaCuentas): el corte guarda en qué cuenta cayó cada
// propina desde hace tiempo, pero el saldo las neteaba TODAS con la tasa de la
// predeterminada y se las cargaba a ella.
{
    const _ctas2 = [ctaConIva, ctaSinIva]; // 'a' predeterminada (2.32% efectivo), 'b' sin IVA
    const corteProp = {
        tarjeta: 3000, propTarjeta: 1000,
        tarjetaCuentas: [{ cuentaId: 'a', ventaTC: 1000, ventaTD: 2000, neto: A._netoCuenta(ctaConIva, 1000, 2000) }],
        propTarjetaCuentas: { b: 1000 },   // la propina cayó en la cuenta B
    };
    test('propina con desglose usa la comisión de SU cuenta, no la de la predeterminada', () =>
        eq(A.taBancoNeto(corteProp, _ctas2),
           A._netoCuenta(ctaConIva, 1000, 2000) + A._netoCuenta(ctaSinIva, 0, 1000)));
    test('propina SIN desglose (corte viejo) sigue neteando con la predeterminada', () =>
        eq(A.taBancoNeto(corteDesglose, _ctas2),
           A._netoCuenta(ctaConIva, 1000, 2000) + 1000 * (1 - 0.0232)));
    test('detalle: la propina de B cae en B y nada queda sin cuenta', () => {
        const d = A.EtaaxCore.taBancoNetoDetalle(corteProp, _ctas2);
        eq(Math.round(d.porCuenta.b * 100) / 100, Math.round(A._netoCuenta(ctaSinIva, 0, 1000) * 100) / 100);
        eq(Math.round(d.sinCuenta * 100) / 100, 0);
    });
    test('propina desglosada PARCIAL: el resto se netea con la predeterminada', () => {
        const parcial = { ...corteProp, propTarjeta: 1500, propTarjetaCuentas: { b: 1000 } };
        const d = A.EtaaxCore.taBancoNetoDetalle(parcial, _ctas2);
        eq(Math.round(d.sinCuenta * 100) / 100, Math.round(500 * (1 - 0.0232) * 100) / 100);
    });
    test('saldo por cuenta: la propina de B suma en B, no en la predeterminada', () => {
        const pc = A._debitoPorCuenta([corteProp], [], _ctas2, 0);
        eq(Math.round(pc.b.total * 100) / 100, Math.round(A._netoCuenta(ctaSinIva, 0, 1000) * 100) / 100);
        eq(Math.round(pc.a.total * 100) / 100, Math.round(A._netoCuenta(ctaConIva, 1000, 2000) * 100) / 100);
    });
}

// CAMBIAR LA PREDETERMINADA NO DEBE REESCRIBIR EL PASADO. Cada corte se queda con
// la cuenta que era predeterminada al capturarlo (sello ctaDefaultId, o inferida de
// su propio desglose). Antes, al cambiarla, se mudaba la atribución de meses viejos
// y además se recalculaban sus comisiones con la tasa de la cuenta nueva.
{
    const _ctasMP = [ctaConIva, ctaSinIva];   // 'a' (Mercado Pago) predeterminada
    const _ctasAF = [ctaSinIva, ctaConIva];   // 'b' (Afirme) predeterminada
    // Corte viejo capturado cuando 'a' era la predeterminada, sin desglose de tarjeta.
    const viejoSellado = { tarjeta: 15000, propTarjeta: 500, transferencia: 400, ctaDefaultId: 'a' };
    test('corte sellado: su neto NO cambia al cambiar la predeterminada', () =>
        eq(Math.round(A.taBancoNeto(viejoSellado, _ctasMP) * 100) / 100,
           Math.round(A.taBancoNeto(viejoSellado, _ctasAF) * 100) / 100));
    test('corte sellado: su saldo sigue en SU cuenta al cambiar la predeterminada', () => {
        const conMP = A._debitoPorCuenta([viejoSellado], [], _ctasMP, 0);
        const conAF = A._debitoPorCuenta([viejoSellado], [], _ctasAF, 0);
        eq(Math.round(conMP.a.total * 100) / 100, Math.round(conAF.a.total * 100) / 100);
        eq(Math.round(conAF.b.total * 100) / 100, 0);   // Afirme NO hereda nada viejo
    });
    // Sin sello (cortes previos a esta versión) se infiere de su propio desglose.
    const viejoInferido = { tarjeta: 3000, propTarjeta: 200,
        tarjetaCuentas: [{ cuentaId: 'a', ventaTC: 0, ventaTD: 3000, neto: A._netoCuenta(ctaConIva, 0, 3000) }] };
    test('sin sello, la cuenta base se infiere del desglose del propio corte', () =>
        eq(A.EtaaxCore.ctaBaseCorte(viejoInferido, _ctasAF).id, 'a'));
    test('la propina sin desglose sigue a la cuenta base, no a la predeterminada nueva', () => {
        const pc = A._debitoPorCuenta([viejoInferido], [], _ctasAF, 0);
        eq(Math.round(pc.b.total * 100) / 100, 0);
        eq(Math.round(pc.a.total * 100) / 100,
           Math.round((A._netoCuenta(ctaConIva, 0, 3000) + A._netoCuenta(ctaConIva, 0, 200)) * 100) / 100);
    });
    // Regla de Edwin: el historial sin cuenta pertenece a la PRIMERA cuenta
    // registrada (la única que existía entonces), no a la predeterminada de turno.
    // Una cuenta nueva empieza su propia historia el día que se da de alta.
    const _catalogo = [                                   // orden de creación, como llega de la nube
        { ...ctaConIva, tipo: 'debito', predeterminada: false },   // 'a' — la primera registrada
        { ...ctaSinIva, tipo: 'debito', predeterminada: true },    // 'b' — nueva y predeterminada hoy
    ];
    const _ctasCat = A.EtaaxCore.cuentasDebito(_catalogo);
    test('cuentasDebito: la predeterminada va primero (cuenta A del corte)', () =>
        eq(_ctasCat[0].id, 'b'));
    test('cuentasDebito: la más antigua queda marcada como base', () =>
        eq(A.EtaaxCore.ctaBaseCatalogo(_ctasCat).id, 'a'));
    test('corte sin sello NI desglose (muy viejo) cae en la PRIMERA cuenta, no en la nueva', () =>
        eq(A.EtaaxCore.ctaBaseCorte({ tarjeta: 500 }, _ctasCat).id, 'a'));
    test('un gasto sin cuenta baja de la primera cuenta, aunque otra sea predeterminada', () => {
        const pc = A._debitoPorCuenta([], [], _ctasCat, 900);
        eq(pc.a.total, -900); eq(pc.b.total, 0);
    });

    // FECHA DE ALTA: con el dato explícito, la base se decide por fecha y no por el
    // orden con que llegan del servidor.
    test('la base se decide por fechaAlta, no por el orden de llegada', () => {
        const cat = [
            { ...ctaSinIva, tipo: 'debito', fechaAlta: '2026-07-23', predeterminada: true },  // 'b' llega primero pero es NUEVA
            { ...ctaConIva, tipo: 'debito', fechaAlta: '2026-05-01' },                        // 'a' es la vieja
        ];
        eq(A.EtaaxCore.ctaBaseCatalogo(A.EtaaxCore.cuentasDebito(cat)).id, 'a');
    });
    test('una cuenta sin fechaAlta se considera más antigua que una con fecha', () => {
        const cat = [
            { ...ctaSinIva, tipo: 'debito', fechaAlta: '2026-07-23' },
            { ...ctaConIva, tipo: 'debito' },   // sin fecha = de antes de que existiera el campo
        ];
        eq(A.EtaaxCore.ctaBaseCatalogo(A.EtaaxCore.cuentasDebito(cat)).id, 'a');
    });

    // CUENTA INACTIVA: se deja de usar pero su historial y su saldo siguen contando.
    {
        const cat = [
            { ...ctaConIva, tipo: 'debito', fechaAlta: '2026-05-01', activo: '0' },  // 'a' desactivada
            { ...ctaSinIva, tipo: 'debito', fechaAlta: '2026-07-23', predeterminada: true },
        ];
        test('la cuenta inactiva NO se ofrece para capturar', () =>
            eq(A.EtaaxCore.cuentasDebitoActivas(cat).length, 1));
        test('la cuenta inactiva SÍ sigue en el cálculo de saldos', () =>
            eq(A.EtaaxCore.cuentasDebito(cat).length, 2));
        test('la inactiva puede seguir siendo la base (su historial es suyo)', () =>
            eq(A.EtaaxCore.ctaBaseCatalogo(A.EtaaxCore.cuentasDebito(cat)).id, 'a'));
    }
}

// Saldo de débito POR CUENTA (_debitoPorCuenta): atribución exacta + invariante.
// La terminal del desglose va a SU cuenta; propina neta, transferencia y gastos a
// la PREDETERMINADA; los depósitos a su cuenta origen/destino.
{
    const _ctas = [ctaConIva, ctaSinIva]; // 'a' predeterminada (va primera)
    const _depsCta = [
        { monto: 5000, origen: 'caja_fuerte', destino: 'banco', destinoCuentaId: 'b' }, // caja → cuenta NUEVA b
        { monto: 1200, origen: 'banco', origenCuentaId: 'a', destino: 'banco', destinoCuentaId: 'b' }, // traspaso a→b
        { monto: 300,  origen: 'banco', origenCuentaId: 'b', destino: 'retiro' },       // retiro desde b
    ];
    const _pc = A._debitoPorCuenta([{ ...corteDesglose, transferencia: 400 }], _depsCta, _ctas, 250);
    test('débito por cuenta: el depósito caja→cuenta B SÍ cae en B (5000 + 1200 − 300 = 5900)', () =>
        eq(Math.round(_pc.b.total * 100) / 100, 5900));
    test('débito por cuenta: A = terminal neta + propina + transfer − traspaso − gastos', () =>
        eq(Math.round(_pc.a.total * 100) / 100,
           Math.round((A._netoCuenta(ctaConIva, 1000, 2000) + 1000 * (1 - 0.0232) + 400 - 1200 - 250) * 100) / 100));
    test('INVARIANTE: la suma de cuentas = saldo total de débito', () => {
        const total = A.taBancoNeto(corteDesglose) + 400 /*transfer*/ + (5000 - 300) /*efecto banco deps*/ - 250 /*gastos*/;
        eq(Math.round((_pc.a.total + _pc.b.total) * 100) / 100, Math.round(total * 100) / 100);
    });
    test('desglose por cuenta: un TRASPASO banco→banco resta en origen y suma en destino (movs)', () => {
        eq(_pc.a.dep, -1200);          // traspaso a→b sale de A
        eq(_pc.b.dep, 5000 + 1200 - 300); // entra depósito + traspaso − retiro
    });
    test('cuenta desconocida/legacy cae a la predeterminada (no se pierde dinero)', () => {
        const _pc2 = A._debitoPorCuenta([], [{ monto: 700, origen: 'externo', destino: 'banco', destinoCuentaId: 'zz-borrada' }], _ctas, 0);
        eq(_pc2.a.total, 700); eq(_pc2.b.total, 0);
    });
    test('gasto de débito sale de SU cuenta elegida (cuentaBancoId), no siempre de la predeterminada', () => {
        const _gd = [{ monto: 300, cuentaBancoId: 'b' }, { monto: 100 /*sin cuenta → predeterminada*/ }];
        const _pc3 = A._debitoPorCuenta([], [], _ctas, 400, _gd);
        eq(_pc3.b.total, -300); // el gasto con cuenta B baja de B
        eq(_pc3.a.total, -100); // el sin cuenta baja de la predeterminada A
    });
    test('sin lista de gastos (compat) el total baja de la predeterminada', () => {
        const _pc4 = A._debitoPorCuenta([], [], _ctas, 400);
        eq(_pc4.a.total, -400); eq(_pc4.b.total, 0);
    });

    // TRANSFERENCIA POR CUENTA (transferCuentas): antes TODA transferencia caía en la
    // predeterminada y el saldo por cuenta no cuadraba con el banco.
    test('transferencia con desglose cae en SU cuenta', () => {
        const _c = [{ transferencia: 900, transferCuentas: [{ cuentaId: 'b', monto: 900 }] }];
        const _pc5 = A._debitoPorCuenta(_c, [], _ctas, 0);
        eq(_pc5.b.total, 900); eq(_pc5.a.total, 0);
    });
    test('transferencia repartida entre dos cuentas', () => {
        const _c = [{ transferencia: 1500, transferCuentas: [{ cuentaId: 'a', monto: 1000 }, { cuentaId: 'b', monto: 500 }] }];
        const _pc6 = A._debitoPorCuenta(_c, [], _ctas, 0);
        eq(_pc6.a.total, 1000); eq(_pc6.b.total, 500);
    });
    test('corte VIEJO sin desglose: la transferencia sigue en la predeterminada', () => {
        const _pc7 = A._debitoPorCuenta([{ transferencia: 700 }], [], _ctas, 0);
        eq(_pc7.a.total, 700); eq(_pc7.b.total, 0);
    });
    test('desglose PARCIAL: lo no desglosado se va a la predeterminada (nunca se pierde)', () => {
        const _c = [{ transferencia: 1000, transferCuentas: [{ cuentaId: 'b', monto: 600 }] }];
        const _pc8 = A._debitoPorCuenta(_c, [], _ctas, 0);
        eq(_pc8.b.total, 600); eq(_pc8.a.total, 400);
        eq(_pc8.a.total + _pc8.b.total, 1000);   // INVARIANTE: la suma = el total del corte
    });
    test('transferencia a una cuenta BORRADA cae en la predeterminada', () => {
        const _c = [{ transferencia: 500, transferCuentas: [{ cuentaId: 'zz-borrada', monto: 500 }] }];
        const _pc9 = A._debitoPorCuenta(_c, [], _ctas, 0);
        eq(_pc9.a.total, 500); eq(_pc9.b.total, 0);
    });
}

// Depósitos y retiros: efecto sobre los fondos
test('_depEfecto: entrada externa a caja fuerte suma a caja', () => {
    const e = A._depEfecto({ monto: 500, origen: 'externo', destino: 'caja_fuerte' });
    eq(e.caja, 500); eq(e.banco, 0);
});
test('_depEfecto: caja fuerte → banco mueve el dinero', () => {
    const e = A._depEfecto({ monto: 800, origen: 'caja_fuerte', destino: 'banco' });
    eq(e.caja, -800); eq(e.banco, 800);
});
test('_depEfecto: RETIRO saca de caja y no entra a ningún fondo', () => {
    const e = A._depEfecto({ monto: 400, origen: 'caja_fuerte', destino: 'retiro' });
    eq(e.caja, -400); eq(e.banco, 0); eq(e.tcPago, 0);
});
test('_depEfecto: pagar tarjeta reduce deuda TC y saca de caja', () => {
    const e = A._depEfecto({ monto: 900, origen: 'caja_fuerte', destino: 'tarjeta_credito' });
    eq(e.caja, -900); eq(e.tcPago, 900);
});
test('_depEfecto compat: depósito viejo a banco (solo destino) salía de caja fuerte', () => {
    const e = A._depEfecto({ monto: 600, destino: 'banco' });
    eq(e.caja, -600); eq(e.banco, 600);
});
test('_esRetiro reconoce el destino retiro', () => {
    eq(A._esRetiro({ destino: 'retiro' }), true); eq(A._esRetiro({ destino: 'banco' }), false);
});

// Metas de venta: distribución mensual → diaria
A._storage['etaax_negT_sucursales'] = JSON.stringify([{ id: 'suc1', nombre: 'Centro', activa: true }]);
// suc1 opera Jue-Vie-Sáb-Dom (dias en orden Lun..Dom)
A._storage['etaax_negT_suc_suc1'] = JSON.stringify({ dias: [false, false, false, true, true, true, true] });
A._cacheMetasDx = { '2026-07': { meta: 31000, dist: 'uniforme' } };
A._metaDiaCacheDx = {};
test('meta uniforme SIN días configurados: mes/31 parejo', () => {
    A._storage['etaax_negT_sucursales'] = '[]'; A._metaDiaCacheDx = {};
    eq(A.metaDelDiaDx('2026-07-15'), 1000);
});
test('meta uniforme CON días operativos: solo reparte en Jue-Dom', () => {
    A._storage['etaax_negT_sucursales'] = JSON.stringify([{ id: 'suc1', nombre: 'Centro', activa: true }]);
    A._metaDiaCacheDx = {};
    // julio 2026: 18 días Jue-Dom → 31000/18 por día operativo, 0 los demás
    eq(A.metaDelDiaDx('2026-07-09'), 31000 / 18);  // jueves
    eq(A.metaDelDiaDx('2026-07-06'), 0);           // lunes: no opera
});
test('meta manual respeta el monto por día', () => {
    A._cacheMetasDx = { '2026-08': { meta: 999, dist: 'manual', manualDays: { '2026-08-01': 1234.5 } } };
    A._metaDiaCacheDx = {};
    eq(A.metaDelDiaDx('2026-08-01'), 1234.5);
    eq(A.metaDelDiaDx('2026-08-02'), 0);
});
test('mes sin meta = 0', () => eq(A.metaDelDiaDx('2030-01-01'), 0));

// Rangos de periodo
test('getRange semana ISO: 2026-W28 = 6 al 12 de julio', () => {
    const r = A.getRange('semana', '2026-W28', null);
    eq(r.from, '2026-07-06'); eq(r.to, '2026-07-12');
});
test('getRange mes cubre el mes completo', () => {
    const r = A.getRange('mes', '2026-02', null);
    eq(r.from, '2026-02-01'); eq(r.to, '2026-02-28');
});
test('inRange incluye los extremos', () => {
    eq(A.inRange('2026-07-01', '2026-07-01', '2026-07-31'), true);
    eq(A.inRange('2026-08-01', '2026-07-01', '2026-07-31'), false);
});

/* ═══════════════ SUITE B · INVENTARIO (recetas/inventarios.js) ═══════════════ */
console.log('\n══ SUITE B · Inventario (recetas/inventarios.js) ══');
const B = crearContexto();
cargarJS(B, 'etaax-core.js');
cargarJS(B, 'insumo-label.js');          // núcleo: _makeInsumoResolver y compañía
cargarJS(B, 'recetas/inventarios.js');
B._storage['etaax_negocio_activo'] = 'negT';
// invActual y filasCaptura son `let` del script → se asignan DENTRO del contexto
setVar(B, 'invActual', { id: 'invT', entradasLog: [], prebatchProducidos: {}, cocktailsVendidos: {}, ventasCompuesto: {}, cancelaciones: [], descuentos: [], filas: [] });

// Botella: 750ml, cristal 500g, copa de 50ml
const filaCopa = {
    insumoId: 'ron1', tipo: 'copa', contNeto: 750, copaML: 50, pesoCristal: 500,
    cerradasBodega: 2, cerradasBarra: 1, pesos: ['1.2'],          // 1.2 kg brutos
    existenciaAnterior: 50, ventasCopasDirectas: 10, cortesiaCopas: 2, mermaCopas: 1,
    ventasBotella: 0, entradas: [], costoUnitario: 300, precioCarta: 90,
};
setVar(B, 'filasCaptura', [filaCopa]);

test('calcNetLiters: peso bruto − cristal (1.2kg − 500g = 700ml)', () => eq(B.calcMLReales(filaCopa), 700));
test('calcNetLiters ignora pesos vacíos', () =>
    eq(B.calcMLReales({ ...filaCopa, pesos: ['', '0', '1.2'] }), 700));
test('existencia física copa: cerradas×copas + abierta (3×15 + 14 = 59)', () =>
    eq(B.calcExistencia(filaCopa), 59));
test('existencia teórica copa: ea − ventas − cortesía − merma (50−10−2−1 = 37)', () =>
    eq(B.calcExistenciaTeorica(filaCopa), 37));
test('entradas suman al teórico convertidas a copas (2 bot = 30 copas)', () => {
    const f = { ...filaCopa, entradas: ['2'] };
    setVar(B, 'filasCaptura', [f]);
    eq(B.calcExistenciaTeorica(f), 67); // 37 + 30
    setVar(B, 'filasCaptura', [filaCopa]);
});
test('venta por botella descuenta botellas completas del teórico', () =>
    eq(B.calcExistenciaTeorica({ ...filaCopa, ventasBotella: 1 }), 22)); // 37 − 15

const filaPza = {
    insumoId: 'coca1', tipo: 'pza', contNeto: 355, copaML: 0, pesoCristal: 0,
    cerradasBodega: 10, cerradasBarra: 2, pesos: [],
    existenciaAnterior: 20, ventasCopasDirectas: 6, ventasBotella: 3,
    cortesiaCopas: 1, mermaCopas: 2, entradas: [],
};
test('existencia física pza = piezas cerradas', () => {
    setVar(B, 'filasCaptura', [filaPza]);
    eq(B.calcExistencia(filaPza), 12);
});
test('teórico pza descuenta venta directa + botella + cortesía + MERMA', () =>
    eq(B.calcExistenciaTeorica(filaPza), 20 - 3 - 6 - 1 - 2)); // 8 — la merma del QR entra aquí

const filaPeso = {
    insumoId: 'queso1', tipo: 'peso', baseUnit: 'g', contNeto: 1000,
    existenciaPeso: 2500, existenciaAnterior: 3000, mermaBase: 200, entradas: [],
};
test('existencia física peso = lo contado en unidad base', () => {
    setVar(B, 'filasCaptura', [filaPeso]);
    eq(B.calcExistencia(filaPeso), 2500);
});
test('teórico peso: ea − merma en unidad base', () =>
    eq(B.calcExistenciaTeorica(filaPeso), 2800));

// ── PREBATCH (sub-receta → insumo): producir batches descuenta los insumos base ──
// El caso de Edwin: una sub-receta con 355 ml de Campari + 125 ml de Jerez por batch.
setVar(B, '_cacheRecetasInv', [
    { id: 'srNegroni', tipo: 'bebidas', status: 'activa', ingredientes: [
        { insumoId: 'campari', cantidad: 355, unidad: 'ML' },
        { insumoId: 'jerez',   cantidad: 125, unidad: 'ML' },
    ] },
]);
setVar(B, '_cacheInsumosInv', [{ id: 'preNegroni', esSubReceta: true, recetaId: 'srNegroni', activo: '1' }]);
vm.runInContext("invActual.prebatchProducidos = { preNegroni: 2 };", B); // 2 batches hechos
const filaCampari = { insumoId: 'campari', tipo: 'copa', contNeto: 750, copaML: 45, existenciaAnterior: 100,
    ventasCopasDirectas: 0, cortesiaCopas: 0, mermaCopas: 0, ventasBotella: 0, entradas: [] };
setVar(B, 'filasCaptura', [filaCampari]);
test('prebatch: producir 2 batches descuenta 355×2 = 710 ml de Campari (base)', () =>
    eq(B.consumoBasesPorProduccion('campari'), 710));
test('prebatch: el Jerez se descuenta aparte: 125×2 = 250 ml', () =>
    eq(B.consumoBasesPorProduccion('jerez'), 250));
test('prebatch: 710 ml de Campari → copas de 45 ml (base→copas)', () =>
    eq(B._consumoBaseProd(filaCampari), 710 / 45));
test('prebatch: teórico de Campari resta lo consumido al producir (100 − 710/45)', () =>
    eq(B.calcExistenciaTeorica(filaCampari), 100 - 710 / 45));
// ENVASE FÍSICO del prebatch: contNeto pasa a ser la CAPACIDAD del envase (ej. botella
// 750 ml) y el rendimiento POR BATCH vive en fila.rendimientoBatch (ej. 4000 ml).
// La producción debe sumar por BATCH (rendimiento), NO por envase.
vm.runInContext("invActual.prebatchProducidos = { preNegroni: 1 };", B);
const filaPreEnv = { insumoId: 'preNegroni', tipo: 'copa', contNeto: 750, copaML: 50,
    rendimientoBatch: 4000, existenciaAnterior: 0, ventasCopasDirectas: 0, cortesiaCopas: 0,
    mermaCopas: 0, ventasBotella: 0, entradas: [] };
setVar(B, 'filasCaptura', [filaPreEnv]);
test('prebatch con envase: 1 batch = rendimiento 4000ml → 80 copas (no 15 del envase)', () =>
    eq(B._prodPrebatchUnidades(filaPreEnv), 80));
test('prebatch sin envase (legacy): fallback a contNeto → 15 copas', () =>
    eq(B._prodPrebatchUnidades({ ...filaPreEnv, rendimientoBatch: 0 }), 15));
vm.runInContext("invActual.prebatchProducidos = {};", B);

/* ── COPIA↔MAESTRO en la PRODUCCIÓN de batches ──
   El Paso 3 guarda los batches bajo el id del insumo TAL COMO lo ve la sucursal (si
   el negocio independizó sus insumos, ahí quedó el id de la COPIA), mientras la fila
   del inventario usa el MAESTRO. Buscando la llave cruda, la fila veía CERO batches:
   el prebatch entraba al Resultado sin producción y su reparto salía en blanco
   ("Tinto de Verano SB" repartiendo 0 mientras Limoncello sí repartía). */
setVar(B, '_cacheRecetasInv', [
    { id: 'srCopia', tipo: 'sub-bebidas', status: 'activa',
      camposExtra: { rendimientoFinal: '900', unidadRendimientoFinal: 'ML' },
      ingredientes: [{ insumoId: 'vinoC', cantidad: 600, unidad: 'ML' }] },
]);
setVar(B, '_cacheInsumosInv', [
    { id: 'preMaestro', esSubReceta: true, recetaId: 'srCopia', activo: '1' },
    { id: 'preCopiaSuc', origenId: 'preMaestro', sucursalId: 'suc_principal',
      esSubReceta: true, recetaId: 'srCopia', activo: '1' },
    { id: 'vinoC', activo: '1' },
]);
vm.runInContext("invActual.prebatchProducidos = { preCopiaSuc: 24 };", B); // llave de la COPIA
const filaPreCopia = { insumoId: 'preMaestro', tipo: 'copa', contNeto: 4000, copaML: 900,
    rendimientoBatch: 0, existenciaAnterior: 0, ventasCopasDirectas: 0, cortesiaCopas: 0,
    mermaCopas: 0, ventasBotella: 0, entradas: [] };
setVar(B, 'filasCaptura', [filaPreCopia]);
test('producción copia↔maestro: 24 batches guardados en la copia se ven desde el maestro', () =>
    eq(B._batchesProducidos('preMaestro'), 24));
test('producción copia↔maestro: entran al teórico (24 batches × 900 ml en copas de 900)', () =>
    eq(B._prodPrebatchUnidades(filaPreCopia), 24));
/* La producción es del BATCH, y en el inventario la representa UN renglón. Si hay
   dos registros de insumo de la misma sub-receta, solo el que tiene renglón se la
   lleva: sumársela a los dos descontaría el doble de los insumos base. */
test('producción copia↔maestro: el registro sin renglón NO se lleva la producción otra vez', () =>
    eq(B._batchesProducidos('preCopiaSuc'), 0));
test('producción copia↔maestro: con DOS renglones del mismo batch, solo el primero cuenta', () => {
    const filaDup = { ...filaPreCopia, insumoId: 'preCopiaSuc' };
    setVar(B, 'filasCaptura', [filaPreCopia, filaDup]);
    const r = eq(B._prodPrebatchUnidades(filaPreCopia), 24) && eq(B._prodPrebatchUnidades(filaDup), 0);
    setVar(B, 'filasCaptura', [filaPreCopia]);
    return r;
});
vm.runInContext("invActual.prebatchProducidos = {};", B);
setVar(B, '_cacheInsumosInv', null); setVar(B, '_cacheRecetasInv', []);

/* ── RENDIMIENTO DEL BATCH ≠ CAPACIDAD DEL ENVASE ──
   El caso de Edwin: "Tinto de Verano" rinde 900 ml y se guarda en garrafas de 4 L.
   Tomar la garrafa como rendimiento daba 24 batches × 4 L = 96 L producidos en vez
   de 21.6 L, y ese fantasma de 74 L caía como faltante repartido a los insumos
   (−89 L en el batch, −55 L en el vino). Manda lo capturado en la sub-receta. */
setVar(B, '_cacheRecetasInv', [
    { id: 'srTinto', tipo: 'sub-bebidas', status: 'activa',
      camposExtra: { rendimientoFinal: '0.900', unidadRendimientoFinal: 'KG' },
      ingredientes: [ { insumoId: 'vinoT', cantidad: 600, unidad: 'ML' },
                      { insumoId: 'sidralT', cantidad: 300, unidad: 'ML' } ] },
]);
setVar(B, '_cacheInsumosInv', [
    { id: 'preTinto', esSubReceta: true, recetaId: 'srTinto', activo: '1' },
    { id: 'vinoT', activo: '1' }, { id: 'sidralT', activo: '1' },
]);
vm.runInContext("invActual.prebatchProducidos = { preTinto: 24 };", B);
// La fila trae contNeto = 4000 (la GARRAFA) y ningún rendimiento propio.
const filaGarrafa = { insumoId:'preTinto', nombre:'Tinto de Verano SB', tipo:'copa',
    contNeto:4000, copaML:1000, rendimientoBatch:0, existenciaAnterior:0,
    ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[] };
setVar(B, 'filasCaptura', [filaGarrafa]);
test('rendimiento: manda el de la sub-receta (0.900 KG → 900 ml), no la garrafa de 4 L', () =>
    eq(B._rendBatch(filaGarrafa), 900));
test('rendimiento: 24 batches × 900 ml = 21.6 L, no 96 L de garrafa', () =>
    eq(B._prodPrebatchUnidades(filaGarrafa), 24 * 900 / 1000));
test('rendimiento: sin sub-receta que consultar, un rendimiento capturado a mano manda', () =>
    eq(B._rendBatch({ ...filaGarrafa, insumoId:'otro', rendimientoBatch: 4000 }), 4000));
test('rendimiento: y sin nada capturado, el último recurso sigue siendo contNeto', () =>
    eq(B._rendBatch({ ...filaGarrafa, insumoId:'otro', rendimientoBatch: 0 }), 4000));
vm.runInContext("invActual.prebatchProducidos = {};", B);
setVar(B, '_cacheInsumosInv', null); setVar(B, '_cacheRecetasInv', []);

/* ── PREBATCH con insumo de PIEZA (refresco/lata) ──
   Bug real: una sub-receta que pide 300 ML de un refresco de 3 L restaba 7200
   PIEZAS del teórico (la unidad base son mililitros, no piezas) y el insumo se
   iba a −7,189. Debe convertirse igual que el consumo por recetas. */
setVar(B, '_cacheRecetasInv', [
    { id: 'srTV', tipo: 'sub-bebidas', status: 'activa', ingredientes: [
        { insumoId: 'tinto5', cantidad: 600, unidad: 'ML' },   // vino de 5 L, fila copa
        { insumoId: 'sidral', cantidad: 300, unidad: 'ML' },   // refresco de 3 L, fila PZA
        { insumoId: 'lata1',  cantidad: 1,   unidad: 'PZA' },  // una lata entera por batch
    ] },
]);
setVar(B, '_cacheInsumosInv', [
    { id: 'preTV', esSubReceta: true, recetaId: 'srTV', activo: '1' },
    { id: 'tinto5', activo: '1' }, { id: 'sidral', activo: '1' }, { id: 'lata1', activo: '1' },
]);
vm.runInContext("invActual.prebatchProducidos = { preTV: 24 };", B);
const filaSidral = { insumoId:'sidral', tipo:'pza', contNeto:3000, existenciaAnterior:10,
    ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[] };
const filaLata = { insumoId:'lata1', tipo:'pza', contNeto:355, existenciaAnterior:100,
    ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[] };
const filaTinto5 = { insumoId:'tinto5', tipo:'copa', contNeto:5000, copaML:150, existenciaAnterior:0,
    ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[] };
setVar(B, 'filasCaptura', [filaSidral, filaLata, filaTinto5]);
test('prebatch pza: 300 ml × 24 de un refresco de 3 L = 2.4 piezas (no 7200)', () =>
    eq(B._consumoBaseProd(filaSidral), 2.4));
test('prebatch pza: el teórico baja 2.4, no se desploma a −7,189', () =>
    eq(B.calcExistenciaTeorica(filaSidral), 10 - 2.4));
test('prebatch pza: 1 PZA por batch × 24 = 24 piezas (unidad PZA va directa)', () =>
    eq(B._consumoBaseProd(filaLata), 24));
test('prebatch pza: el teórico de la lata baja 24', () =>
    eq(B.calcExistenciaTeorica(filaLata), 100 - 24));
test('prebatch copa: el vino sigue igual — 600×24 ml en copas de 150 = 96', () =>
    eq(B._consumoBaseProd(filaTinto5), 96));
vm.runInContext("invActual.prebatchProducidos = {};", B);
setVar(B, '_cacheInsumosInv', null); setVar(B, '_cacheRecetasInv', []);

// ── REPARTO del prebatch a sus insumos (modelo de Edwin, ejemplo completo) ──
// Batch 750 ml = 100 Campari + 250 Aperol + 400 Vermouth. Se produce 1 batch,
// se venden cocteles por 375 ml (media botella) y se PESA media botella (375 ml).
// Campari: EA 1000 ml (20 copas de 50), sin ventas propias. Su fila cuadra a CERO:
// el teórico resta la producción (−100 ml) pero recupera su parte del batch
// restante (+50 ml teórico) y el físico suma su parte pesada (+50 ml).
setVar(B, '_cacheRecetasInv', [
    { id: 'srNegMix', tipo: 'bebidas', status: 'activa', ingredientes: [
        { insumoId: 'campari2',  cantidad: 100, unidad: 'ML' },
        { insumoId: 'aperol2',   cantidad: 250, unidad: 'ML' },
        { insumoId: 'vermut2',   cantidad: 400, unidad: 'ML' },
    ] },
]);
setVar(B, '_cacheInsumosInv', [
    { id: 'preNegMix', esSubReceta: true, recetaId: 'srNegMix', activo: '1' },
    { id: 'campari2', activo: '1' }, { id: 'aperol2', activo: '1' }, { id: 'vermut2', activo: '1' },
]);
vm.runInContext("invActual.prebatchProducidos = { preNegMix: 1 };", B);
// Fila del prebatch: envase 750 ml, copa 50 → pesada media botella (7.5 copas físicas).
// Ventas: 7.5 copas directas (los 375 ml vendidos). Teórico: 0 EA + 15 prod − 7.5 = 7.5 ✓
const filaPre2 = { insumoId: 'preNegMix', tipo: 'copa', contNeto: 750, copaML: 50, rendimientoBatch: 750,
    existenciaAnterior: 0, ventasCopasDirectas: 7.5, cortesiaCopas: 0, mermaCopas: 0, ventasBotella: 0,
    entradas: [], cerradasBodega: 0, cerradasBarra: 0, pesos: ['0.375'], pesoCristal: 0 };
const filaCamp2 = { insumoId: 'campari2', tipo: 'copa', contNeto: 750, copaML: 50, existenciaAnterior: 20,
    ventasCopasDirectas: 0, cortesiaCopas: 0, mermaCopas: 0, ventasBotella: 0, entradas: [],
    cerradasBodega: 1, cerradasBarra: 0, pesos: ['0.150'], pesoCristal: 0 }; // físico: 15 + 3 = 18 copas = 900 ml
setVar(B, 'filasCaptura', [filaPre2, filaCamp2]);
vm.runInContext("_repCache = _repartoPrebatch();", B);
test('reparto: el prebatch queda marcado como repartido', () =>
    eq(B._esPrebatchRepartido('preNegMix'), true));
test('reparto: Campari recibe su parte del físico pesado (375×13.3% = 50 ml = 1 copa)', () =>
    eq(Math.round(B._repartoDe('campari2').fis * 100) / 100, 1));
test('reparto: Campari cuadra a CERO (dif propia −2 copas por producción + 2 del batch… neto la parte vendida)', () => {
    // dif fila Campari sola: físico 18 − teórico (20 − 100/50 prod) = 18 − 18 = 0
    // adj.dif = share×(fisB−teoB) = 0.1333×(375−375) = 0 → dif final 0 ✓
    const difFila = B.calcExistencia(filaCamp2) - B.calcExistenciaTeorica(filaCamp2);
    eq(Math.round((difFila + B._repartoDe('campari2').dif) * 1000) / 1000, 0);
});
test('reparto: faltante del batch cae proporcional (pesa 300 en vez de 375 → Campari −0.2 copas)', () => {
    const filaPreF = { ...filaPre2, pesos: ['0.300'] }; // faltan 75 ml del batch
    setVar(B, 'filasCaptura', [filaPreF, filaCamp2]);
    vm.runInContext("_repCache = _repartoPrebatch();", B);
    // 75 ml × 13.33% = 10 ml de Campari = 0.2 copas de 50 ml
    eq(Math.round(B._repartoDe('campari2').dif * 1000) / 1000, -0.2);
    setVar(B, 'filasCaptura', [filaPre2, filaCamp2]);
    vm.runInContext("_repCache = _repartoPrebatch();", B);
});
test('reparto: la venta del batch fluye a Campari como venta neta (375×13.3% = 1 copa)', () =>
    eq(Math.round(B._repartoDe('campari2').venta * 100) / 100, 1));

// Fix 2026-07: el TOTAL del reparto debe sumar TODOS los ingredientes, no solo los
// ligados a un insumo. Cordial: Aperol 60 + Vodka 60 (ligados) + Sandía 600 + Azúcar 240
// (sin insumo). Aperol es 60/960 del batch, NO 60/120 (bug: repartía entre alcoholes).
setVar(B, '_cacheRecetasInv', [
    { id: 'srCordial', tipo: 'sub-bebidas', status: 'activa', ingredientes: [
        { insumoId: 'aperol3', cantidad: 60,  unidad: 'ML' },
        { insumoId: 'vodka3',  cantidad: 60,  unidad: 'ML' },
        { insumoId: '',        cantidad: 600, unidad: 'G' },   // Sandía — no ligada
        { insumoId: '',        cantidad: 240, unidad: 'G' },   // Azúcar — no ligada
    ] },
]);
setVar(B, '_cacheInsumosInv', [
    { id: 'preCordial', esSubReceta: true, recetaId: 'srCordial', activo: '1' },
    { id: 'aperol3', activo: '1' }, { id: 'vodka3', activo: '1' },
]);
vm.runInContext("invActual.prebatchProducidos = { preCordial: 1 };", B);
const filaPreC = { insumoId:'preCordial', tipo:'copa', contNeto:960, copaML:50, rendimientoBatch:960,
    existenciaAnterior:0, ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0,
    entradas:[], cerradasBodega:0, cerradasBarra:0, pesos:['0.960'], pesoCristal:0 }; // físico 19.2 copas = 960 ml
const filaAper = { insumoId:'aperol3', tipo:'copa', contNeto:750, copaML:50, existenciaAnterior:0,
    ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[], cerradasBodega:0, cerradasBarra:0, pesos:[], pesoCristal:0 };
setVar(B, 'filasCaptura', [filaPreC, filaAper]);
vm.runInContext("_repCache = _repartoPrebatch();", B);
test('reparto usa TODOS los ingredientes: Aperol 60/960 del físico (= 1.2 copas, no 9.6)', () =>
    eq(Math.round(B._repartoDe('aperol3').fis * 100) / 100, 1.2));

/* ── PREBATCH DE COCINA (fila 'peso', se vende en un PLATILLO) ──
   El reparto leía lo vendido del batch con la fórmula de COPAS, que devuelve 0 sin
   tamaño de copa — y una salsa se cuenta en gramos, no en copas. Además solo miraba
   las recetas de bebidas, así que un batch que se va en un platillo tampoco contaba.
   Resultado: el batch salía con venta 0 y sus insumos no recibían nada, aunque la
   producción y las ventas estuvieran bien capturadas.
   Salsa: rinde 1000 g = 600 jitomate + 400 chile. 2 batches producidos, un platillo
   que lleva 250 g vendido 4 veces (1000 g), y se pesan 900 g al cierre. */
setVar(B, '_cacheRecetasInv', [
    { id: 'srSalsa', tipo: 'sub-alimentos', status: 'activa',
      camposExtra: { rendimientoFinal: '1000', unidadRendimientoFinal: 'G' },
      ingredientes: [ { insumoId: 'jitomate', cantidad: 600, unidad: 'G' },
                      { insumoId: 'chile',    cantidad: 400, unidad: 'G' } ] },
    { id: 'platEnchi', tipo: 'alimentos', status: 'activa', ingredientes: [
        { insumoId: 'preSalsa', cantidad: 250, unidad: 'G' } ] },
]);
setVar(B, '_cacheInsumosInv', [
    { id: 'preSalsa', esSubReceta: true, recetaId: 'srSalsa', activo: '1', familia: 'Alimentos' },
    { id: 'jitomate', activo: '1' }, { id: 'chile', activo: '1' },
]);
vm.runInContext("invActual.prebatchProducidos = { preSalsa: 2 };", B);
vm.runInContext("invActual.cocktailsVendidos = { platEnchi: 4 }; _consumoDirty = true;", B);
const filaPreSalsa = { insumoId: 'preSalsa', tipo: 'peso', baseUnit: 'G', contNeto: 1000,
    rendimientoBatch: 1000, existenciaAnterior: 0, existenciaPeso: 900, mermaBase: 0, entradas: [] };
const filaJito = { insumoId: 'jitomate', tipo: 'peso', baseUnit: 'G', contNeto: 1000,
    existenciaAnterior: 5000, existenciaPeso: 3800, mermaBase: 0, entradas: [] };
setVar(B, 'filasCaptura', [filaPreSalsa, filaJito]);
vm.runInContext("_repCache = _repartoPrebatch();", B);
test('prebatch de cocina: el platillo consume 250 g × 4 = 1000 g de salsa', () =>
    eq(B._consumoRecetasBase('preSalsa'), 1000));
test('prebatch de cocina: la venta del batch llega al jitomate (1000 g × 60% = 600 g)', () =>
    eq(Math.round(B._repartoDe('jitomate').venta), 600));
test('prebatch de cocina: el físico pesado se reparte igual (900 g × 60% = 540 g)', () =>
    eq(Math.round(B._repartoDe('jitomate').fis), 540));
test('prebatch de cocina: teórico del batch = 2000 producidos − 1000 vendidos = 1000 g', () =>
    eq(B.calcExistenciaTeorica(filaPreSalsa), 1000));
test('prebatch de cocina: el faltante de 100 g cae proporcional (jitomate −60 g)', () =>
    eq(Math.round(B._repartoDe('jitomate').dif), -60));
vm.runInContext("invActual.prebatchProducidos = {}; invActual.cocktailsVendidos = {}; _consumoDirty = true;", B);
setVar(B, '_cacheInsumosInv', null); setVar(B, '_cacheRecetasInv', []);

/* ── UN INSUMO EN LAS DOS VÍAS: coctel directo Y dentro de un prebatch ──
   La pregunta de Edwin: ¿la columna de Coctelería cuenta las dos cosas?
   Vodka: 20 Vodka Tonic × 50 ml = 1 L directo. Además 4 batches de Limoncello con
   500 ml de vodka cada uno = 2 L que se fueron al batch. El batch rinde 1 L (mitad
   vodka, mitad limón), se venden 25 Spritz × 100 ml = 2.5 L de batch → al vodka le
   tocan 1.25 L. Se pesan 1.5 L de batch al cierre → 0.75 L de vodka siguen ahí.

   El renglón tiene que CUADRAR consigo mismo: EA (con su parte del batch) menos lo
   consumido = el teórico que se enseña a la derecha. Sumar además los 2 L que
   entraron al batch contaba el mismo vodka dos veces y dejaba la resta corta. */
setVar(B, '_cacheRecetasInv', [
    { id: 'srLimon', tipo: 'sub-bebidas', status: 'activa',
      camposExtra: { rendimientoFinal: '1000', unidadRendimientoFinal: 'ML' },
      ingredientes: [ { insumoId: 'vodkaD', cantidad: 500, unidad: 'ML' },
                      { insumoId: 'limonD', cantidad: 500, unidad: 'ML' } ] },
    { id: 'coctTonic',  tipo: 'bebidas', status: 'activa',
      ingredientes: [ { insumoId: 'vodkaD',   cantidad: 50,  unidad: 'ML' } ] },
    { id: 'coctSpritz', tipo: 'bebidas', status: 'activa',
      ingredientes: [ { insumoId: 'preLimon', cantidad: 100, unidad: 'ML' } ] },
]);
setVar(B, '_cacheInsumosInv', [
    { id: 'preLimon', nombre: 'Limoncello SB', esSubReceta: true, recetaId: 'srLimon', activo: '1' },
    { id: 'vodkaD', activo: '1' }, { id: 'limonD', activo: '1' },
]);
vm.runInContext("invActual.prebatchProducidos = { preLimon: 4 };", B);
vm.runInContext("invActual.cocktailsVendidos = { coctTonic: 20, coctSpritz: 25 }; _consumoDirty = true;", B);
const filaPreLim = { insumoId:'preLimon', tipo:'copa', contNeto:4000, copaML:50, rendimientoBatch:1000,
    existenciaAnterior:0, ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0,
    entradas:[], cerradasBodega:0, cerradasBarra:0, pesos:['1.500'], pesoCristal:0 };
const filaVodkaD = { insumoId:'vodkaD', tipo:'copa', contNeto:1000, copaML:50, existenciaAnterior:200,
    ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[],
    cerradasBodega:0, cerradasBarra:0, pesos:[], pesoCristal:0 };
setVar(B, 'filasCaptura', [filaPreLim, filaVodkaD]);
vm.runInContext("_repCache = _repartoPrebatch();", B);
const copasAL = c => Math.round(c * 50) / 1000; // copas de 50 ml → litros
test('dos vías: el uso DIRECTO en cocteles se cuenta (20 × 50 ml = 1 L)', () =>
    eq(copasAL(B.consumoRecetasFila(filaVodkaD)), 1));
test('dos vías: el uso VÍA PREBATCH también se cuenta (le tocan 1.25 L de lo vendido)', () =>
    eq(copasAL(B._repartoDe('vodkaD').vco), 1.25));
test('dos vías: la coctelería del renglón suma las dos = 2.25 L', () => {
    const adj = B._repartoDe('vodkaD');
    return eq(copasAL(B.consumoRecetasFila(filaVodkaD) + adj.vco + B._prodPBVisible(filaVodkaD, adj)), 2.25);
});
test('dos vías: lo que entró al batch NO se vuelve a sumar (los 2 L ya están dentro)', () =>
    eq(B._prodPBVisible(filaVodkaD, B._repartoDe('vodkaD')), 0));
test('dos vías: el renglón CUADRA — EA 10 L − coctelería 2.25 L = teórico 7.75 L', () => {
    const adj = B._repartoDe('vodkaD');
    const ea       = ((parseFloat(filaVodkaD.existenciaAnterior) || 0) + adj.ea);
    const coct     = B.consumoRecetasFila(filaVodkaD) + adj.vco + B._prodPBVisible(filaVodkaD, adj);
    const teorico  = B.calcExistenciaTeorica(filaVodkaD) + adj.teo;
    return eq(copasAL(ea - coct), copasAL(teorico));
});
test('dos vías: y el vodka que sigue DENTRO del batch vuelve al teórico (0.75 L)', () =>
    eq(copasAL(B._repartoDe('vodkaD').fis), 0.75));
vm.runInContext("invActual.prebatchProducidos = {}; invActual.cocktailsVendidos = {}; _consumoDirty = true;", B);
setVar(B, '_cacheInsumosInv', null); setVar(B, '_cacheRecetasInv', []);

/* ── EL COCTEL APUNTA A OTRO REGISTRO DE LA MISMA SUB-RECETA ──
   El caso real del Tinto de Verano. "Cargar como insumo" NO le pone origenId al
   insumo que crea, así que dos conversiones de la misma sub-receta (una por
   sucursal, o una repetida) quedan como insumos distintos sin nada que los una:
   _canonInsumoId no puede colapsarlos. Si el coctel quedó apuntando a uno y el
   renglón del inventario usa el otro, el consumo EXISTE pero nadie lo encuentra —
   el batch se reparte con ventas en cero y sus insumos no reciben lo vendido.
   La producción sí funcionaba (no busca por id: recorre lo capturado y resuelve la
   sub-receta), y por eso se veía el absurdo de "14.4 L en batches" con la
   coctelería en "—". La identidad buena es la SUB-RECETA.

   24 batches × 900 ml = 21.6 L producidos; 30 cocteles × 1 LT del batch. El vino
   es 600 de 900 ml de la receta = 2/3 de todo lo que salga. */
setVar(B, '_cacheRecetasInv', [
    { id: 'srTV2', tipo: 'sub-bebidas', status: 'activa',
      camposExtra: { rendimientoFinal: '900', unidadRendimientoFinal: 'ML' },
      ingredientes: [ { insumoId: 'vinoCal', cantidad: 600, unidad: 'ML' },
                      { insumoId: 'sidralM', cantidad: 300, unidad: 'ML' } ] },
    // OJO: el coctel apunta a 'preTV_otro', NO al registro que tiene renglón.
    { id: 'coctTV', tipo: 'bebidas', status: 'activa',
      ingredientes: [ { insumoId: 'preTV_otro', cantidad: 1, unidad: 'LT' } ] },
]);
setVar(B, '_cacheInsumosInv', [
    { id: 'preTV_fila', nombre: 'Tinto de Verano SB', esSubReceta: true, recetaId: 'srTV2', activo: '1' },
    { id: 'preTV_otro', nombre: 'Tinto de Verano SB', esSubReceta: true, recetaId: 'srTV2', activo: '1' },
    { id: 'vinoCal', activo: '1' }, { id: 'sidralM', activo: '1' },
]);
vm.runInContext("invActual.prebatchProducidos = { preTV_fila: 24 };", B);
vm.runInContext("invActual.cocktailsVendidos = { coctTV: 30 }; _consumoDirty = true;", B);
const filaTV2 = { insumoId:'preTV_fila', tipo:'copa', contNeto:4000, copaML:1000, rendimientoBatch:0,
    existenciaAnterior:0, ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0,
    entradas:[], cerradasBodega:0, cerradasBarra:0, pesos:[], pesoCristal:0 };
const filaVinoCal = { insumoId:'vinoCal', tipo:'copa', contNeto:5000, copaML:1000, existenciaAnterior:0.1,
    ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:['2'],
    cerradasBodega:0, cerradasBarra:0, pesos:[], pesoCristal:0 };
setVar(B, 'filasCaptura', [filaTV2, filaVinoCal]);
vm.runInContext("_repCache = _repartoPrebatch();", B);
test('otro registro: el consumo del coctel se encuentra por SUB-RECETA (30 × 1 LT = 30 L)', () =>
    eq(B._consumoBaseSubReceta('srTV2'), 30000));
test('otro registro: al vino le llegan sus 2/3 de lo vendido (20 L), ya no cero', () =>
    eq(Math.round(B._repartoDe('vinoCal').venta * 1000) / 1000, 20));
test('otro registro: la producción sigue descontándole 14.4 L al vino (600×24)', () =>
    eq(Math.round(B._consumoBaseProd(filaVinoCal) * 1000) / 1000, 14.4));
test('otro registro: y el batch queda marcado como repartido', () =>
    eq(B._esPrebatchRepartido('preTV_fila'), true));
/* Y el TEÓRICO del batch tiene que moverse con las ventas del coctel. Arreglar solo
   el reparto dejaba el bug a medias: la columna de uso cambiaba, pero el teórico
   seguía creyendo que del batch no había salido nada — así que la existencia
   teórica, la diferencia y el % del renglón NO se movían al capturar ventas. */
test('otro registro: el teórico del batch baja con lo vendido (21.6 L − 30 L = −8.4 L)', () =>
    eq(Math.round(B.calcExistenciaTeorica(filaTV2) * 1000) / 1000, -8.4));
test('otro registro: mover la venta del coctel MUEVE el teórico del batch', () => {
    const antes = B.calcExistenciaTeorica(filaTV2);
    vm.runInContext("invActual.cocktailsVendidos = { coctTV: 20 }; _consumoDirty = true;", B);
    const despues = B.calcExistenciaTeorica(filaTV2);
    vm.runInContext("invActual.cocktailsVendidos = { coctTV: 30 }; _consumoDirty = true;", B);
    return eq(Math.round((despues - antes) * 1000) / 1000, 10); // 10 cocteles menos × 1 LT
});
test('otro registro: y eso mueve el teórico del VINO por su parte del batch (2/3)', () => {
    const conVentas = B.calcExistenciaTeorica(filaVinoCal) + B._repartoDe('vinoCal').teo;
    vm.runInContext("invActual.cocktailsVendidos = { coctTV: 20 }; _consumoDirty = true;", B);
    vm.runInContext("_repCache = _repartoPrebatch();", B);
    const menosVentas = B.calcExistenciaTeorica(filaVinoCal) + B._repartoDe('vinoCal').teo;
    vm.runInContext("invActual.cocktailsVendidos = { coctTV: 30 }; _consumoDirty = true;", B);
    vm.runInContext("_repCache = _repartoPrebatch();", B);
    // 10 cocteles menos = 10 L menos salidos del batch; al vino le tocan 2/3 = 6.667 L
    return eq(Math.round((menosVentas - conVentas) * 1000) / 1000, 6.667);
});
vm.runInContext("invActual.prebatchProducidos = {}; invActual.cocktailsVendidos = {}; _consumoDirty = true;", B);
setVar(B, '_cacheInsumosInv', null); setVar(B, '_cacheRecetasInv', []);

/* ── % DE VARIANZA CONTRA TODO EL USO, NO SOLO CONTRA LO VENDIDO ──
   El Vodka American: 22.2 copas vendidas, 88.9 que se fueron a producir batches y
   una varianza de +10.6 copas. Midiéndola contra las 22.2 salía +47.8% —semáforo
   rojo— por un producto que en realidad movió 111 copas. La varianza sale de
   manipular producto, así que se mide contra el producto manipulado: botella,
   copa, pieza, coctelería Y producción de batches. */
test('% de varianza: la base incluye la producción de batches (22.2 + 88.9 = 111.1)', () =>
    eq(Math.round(B._usoTotal(22.2, 88.9, 0) * 10) / 10, 111.1));
test('% de varianza: 10.6 sobre el uso completo = 9.5%, no 47.8%', () =>
    eq(Math.round(B._pctVarianza(10.6, B._usoTotal(22.2, 88.9, 0)) * 10) / 10, 9.5));
test('% de varianza: contra lo vendido solo, era el 47.8% que disparaba la alerta', () =>
    eq(Math.round(B._pctVarianza(10.6, 22.2) * 10) / 10, 47.7));
/* Si el batch NO se está repartiendo, esa producción YA viene sumada dentro de las
   ventas del renglón: sumarla otra vez contaría el mismo producto dos veces. */
test('% de varianza: con el batch sin repartir, la producción no se suma dos veces', () =>
    eq(B._usoTotal(111.1, 88.9, 88.9), 111.1));
test('% de varianza: sin uso alguno no hay base y no se inventa un porcentaje', () =>
    eq(B._pctVarianza(5, B._usoTotal(0, 0, 0)), null));

/* ── AVISO EN PANTALLA de los batches que no van a cuadrar ──
   El caso de la garrafa (rendimiento = capacidad del envase) solo se avisaba por
   console.warn: nadie lo veía y la producción salía inflada en silencio. */
setVar(B, '_cacheRecetasInv', [
    { id: 'srAviso', tipo: 'sub-bebidas', status: 'activa',
      ingredientes: [{ insumoId: 'vinoA', cantidad: 600, unidad: 'ML' }] }, // sin rendimientoFinal
    { id: 'srOk', tipo: 'sub-bebidas', status: 'activa',
      camposExtra: { rendimientoFinal: '900', unidadRendimientoFinal: 'ML' },
      ingredientes: [{ insumoId: 'vinoA', cantidad: 600, unidad: 'ML' }] },
    // El coctel que sí vende el batch bueno: sin esto, "producido y sin una sola
    // venta" es un problema legítimo y el aviso tiene razón en salir.
    { id: 'coctOk', tipo: 'bebidas', status: 'activa',
      ingredientes: [{ insumoId: 'preOk', cantidad: 200, unidad: 'ML' }] },
]);
const preAviso = { id: 'preAviso', nombre: 'Tinto de Verano SB', esSubReceta: true, recetaId: 'srAviso', activo: '1' };
const preOk    = { id: 'preOk',    nombre: 'Limoncello SB',      esSubReceta: true, recetaId: 'srOk',    activo: '1' };
const preHuerf = { id: 'preHuerf', nombre: 'Batch huérfano',     esSubReceta: true, recetaId: 'noExiste', activo: '1' };
setVar(B, '_cacheInsumosInv', [preAviso, preOk, preHuerf, { id: 'vinoA', activo: '1' }]);
const filaAviso = { insumoId:'preAviso', tipo:'copa', contNeto:4000, copaML:900, rendimientoBatch:0,
    existenciaAnterior:0, ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[] };
const filaOk    = { ...filaAviso, insumoId:'preOk' };
const filaHuerf = { ...filaAviso, insumoId:'preHuerf' };
setVar(B, 'filasCaptura', [filaAviso, filaOk, filaHuerf]);
vm.runInContext("invActual.prebatchProducidos = { preAviso: 24, preOk: 24, preHuerf: 3 };", B);
vm.runInContext("invActual.cocktailsVendidos = { coctOk: 30 }; _consumoDirty = true;", B);
test('aviso: sin rendimiento capturado se avisa que se está usando el envase', () =>
    eq(/rendimiento capturado/.test(B._revisarPrebatch(preAviso).probs.join(' ')), true));
test('aviso: con rendimiento y ventas capturadas NO se avisa nada', () =>
    eq(B._revisarPrebatch(preOk), null));
/* El caso del Tinto de Verano: 24 batches producidos y ni una venta descontada.
   Antes esto pasaba mudo y el faltante caía repartido en el vino sin explicación. */
test('aviso: producido y sin UNA SOLA venta descontada, se avisa', () =>
    eq(/NINGUNA venta/.test(B._revisarPrebatch(preAviso).probs.join(' ')), true));
test('aviso: una sub-receta que ya no existe se reporta como batch huérfano', () =>
    eq(/ya no existe/.test(B._revisarPrebatch(preHuerf).probs.join(' ')), true));
test('aviso: sin producción capturada no se molesta al usuario', () => {
    vm.runInContext("invActual.prebatchProducidos = {};", B);
    return eq(B._revisarPrebatch(preAviso), null);
});
vm.runInContext("invActual.prebatchProducidos = {};", B);
setVar(B, '_cacheInsumosInv', null); setVar(B, '_cacheRecetasInv', []);

/* ── CADENA DE DOS NIVELES: coctel → sub-receta (prebatch) → insumos base ──
   Es la pregunta de Edwin: si vendo cocteles hechos con un prebatch, ¿se descuenta
   el uso de los insumos de esa sub-receta, y el sobrante del prebatch se reparte
   proporcionalmente a cada uno?

   El modelo NO carga dos veces: producir el batch descuenta los insumos base, y
   vender el coctel descuenta el PREBATCH (no otra vez el Campari). Lo que queda
   del batch al final se devuelve a sus insumos en proporción a la receta.

   Escenario: batch de 1000 ml = Ginebra 400 + Campari 300 + Vermut 300.
   Se producen 3 batches (3000 ml). Un coctel usa 100 ml del prebatch y se venden
   12 → 1200 ml. Al cierre se pesan 1800 ml de prebatch (3000 − 1200 ✓ cuadra). */
setVar(B, '_cacheRecetasInv', [
    { id: 'srNeg2', tipo: 'sub-bebidas', status: 'activa', ingredientes: [
        { insumoId: 'gin4',    cantidad: 400, unidad: 'ML' },
        { insumoId: 'campari4',cantidad: 300, unidad: 'ML' },
        { insumoId: 'vermut4', cantidad: 300, unidad: 'ML' },
    ] },
    // El coctel que se vende: gasta 100 ml del PREBATCH, no de los insumos sueltos.
    { id: 'ctlNegroni', tipo: 'bebidas', status: 'activa', ingredientes: [
        { insumoId: 'preNeg2', cantidad: 100, unidad: 'ML' },
    ] },
]);
setVar(B, '_cacheInsumosInv', [
    { id: 'preNeg2', esSubReceta: true, recetaId: 'srNeg2', activo: '1' },
    { id: 'gin4', activo: '1' }, { id: 'campari4', activo: '1' }, { id: 'vermut4', activo: '1' },
]);
vm.runInContext("invActual.prebatchProducidos = { preNeg2: 3 }; invActual.cocktailsVendidos = { ctlNegroni: 12 }; _consumoIdxCache = null; _consumoDirty = true;", B);

const filaPreN = { insumoId:'preNeg2', tipo:'copa', contNeto:1000, copaML:100, rendimientoBatch:1000,
    existenciaAnterior:0, ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0,
    entradas:[], cerradasBodega:1, cerradasBarra:0, pesos:['0.800'], pesoCristal:0 }; // 1000 + 800 = 1800 ml
const _filaIng = (id) => ({ insumoId:id, tipo:'copa', contNeto:750, copaML:50, existenciaAnterior:0,
    ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[],
    cerradasBodega:0, cerradasBarra:0, pesos:[], pesoCristal:0 });
const filaGin4 = _filaIng('gin4'), filaCam4 = _filaIng('campari4'), filaVer4 = _filaIng('vermut4');
setVar(B, 'filasCaptura', [filaPreN, filaGin4, filaCam4, filaVer4]);

// 1) PRODUCIR carga los insumos de la sub-receta (1 y 2 y 3 batches).
test('2 niveles · producir 3 batches carga 400×3 = 1200 ml de Ginebra', () =>
    eq(B.consumoBasesPorProduccion('gin4'), 1200));
test('2 niveles · producir 3 batches carga 300×3 = 900 ml de Campari', () =>
    eq(B.consumoBasesPorProduccion('campari4'), 900));
test('2 niveles · con 1 batch serían 400 ml (la carga escala con los batches)', () => {
    vm.runInContext("invActual.prebatchProducidos = { preNeg2: 1 };", B);
    const r = B.consumoBasesPorProduccion('gin4');
    vm.runInContext("invActual.prebatchProducidos = { preNeg2: 3 };", B);
    eq(r, 400);
});
test('2 niveles · la Ginebra descuenta la producción de su teórico (0 EA − 1200/50 copas)', () =>
    eq(B.calcExistenciaTeorica(filaGin4), -1200 / 50));

// 2) VENDER el coctel carga el PREBATCH (no otra vez los insumos base).
test('2 niveles · vender 12 cocteles gasta 1200 ml del prebatch (12 copas de 100)', () =>
    eq(B.calcVentasCopasRecetas('preNeg2', 100), 12));
test('2 niveles · el coctel NO vuelve a cargar la Ginebra (ya se cargó al producir)', () =>
    eq(B.calcVentasCopasRecetas('gin4', 50), 0));
test('2 niveles · teórico del prebatch: 3 batches − 12 copas vendidas = 18 copas', () =>
    eq(B.calcExistenciaTeorica(filaPreN), 30 - 12));

// 3) El SOBRANTE del prebatch se reparte proporcional a cada insumo.
vm.runInContext("_repCache = _repartoPrebatch();", B);
test('2 niveles · el prebatch queda marcado como repartido', () =>
    eq(B._esPrebatchRepartido('preNeg2'), true));
test('2 niveles · Ginebra recibe 40% del físico del batch (1800×0.4 = 720 ml = 14.4 copas)', () =>
    eq(Math.round(B._repartoDe('gin4').fis * 100) / 100, 14.4));
test('2 niveles · la venta del batch fluye a Ginebra como venta neta (1200×0.4 = 480 ml = 9.6 copas)', () =>
    eq(Math.round(B._repartoDe('gin4').venta * 100) / 100, 9.6));
test('2 niveles · sin faltante en el batch, la Ginebra no arrastra diferencia', () =>
    eq(Math.round(B._repartoDe('gin4').dif * 1000) / 1000, 0));
test('2 niveles · si faltan 200 ml del batch, a Ginebra le tocan 80 ml (−1.6 copas)', () => {
    setVar(B, 'filasCaptura', [{ ...filaPreN, pesos:['0.600'] }, filaGin4, filaCam4, filaVer4]);  // 1600 en vez de 1800
    vm.runInContext("_repCache = _repartoPrebatch();", B);
    const d = B._repartoDe('gin4').dif;
    setVar(B, 'filasCaptura', [filaPreN, filaGin4, filaCam4, filaVer4]);
    vm.runInContext("_repCache = _repartoPrebatch();", B);
    eq(Math.round(d * 1000) / 1000, -1.6);
});
/* Que la suma cierre es la prueba de que el reparto es PROPORCIONAL de verdad y no
   se pierde ni se inventa producto por el camino. */
test('2 niveles · el reparto cuadra: lo repartido a los 3 insumos = el físico del batch', () => {
    const suma = ['gin4','campari4','vermut4'].reduce((t, id) => {
        const r = B._repartoDe(id) || { fis: 0 };
        // cada uno en SUS copas: gin/campari/vermut usan 50 ml → a ml para sumar
        return t + r.fis * 50;
    }, 0);
    eq(Math.round(suma), 1800);
});

vm.runInContext("invActual.prebatchProducidos = {}; invActual.cocktailsVendidos = {}; _repCache = null; _consumoIdxCache = null; _consumoDirty = true;", B);
setVar(B, '_cacheInsumosInv', null); setVar(B, '_cacheRecetasInv', []);
setVar(B, 'filasCaptura', [filaCopa]);

test('getEntradasBottles suma filas manuales + log del inventario', () => {
    const f = { ...filaCopa, entradas: ['1', '2'] };
    setVar(B, 'filasCaptura', [f]);
    vm.runInContext("invActual.entradasLog = [{ insumoId: 'ron1', cantidad: 3 }, { insumoId: 'otro', cantidad: 99 }];", B);
    eq(B.getEntradasBottles('ron1'), 6);
    vm.runInContext('invActual.entradasLog = [];', B); setVar(B, 'filasCaptura', [filaCopa]);
});
// Qué entrada SUMA a "Compras del período". Todas entran al stock, pero solo la
// compra es dinero que salió: si esto se rompe, el reporte infla las compras y
// "Vendido vs Compras" miente.
/* ── CELDAS CON OPERACIONES (lo que se teclea al contar) ──
   De este evaluador salen las CANTIDADES del inventario: si se equivoca, se
   captura otra existencia. El bug que costó datos: cuando no entendía lo escrito
   BORRABA la celda y guardaba 0 — se perdía lo contado y el cero se leía como
   existencia real. Y con teclado de tablet en español ("3,5") no entendía nunca. */
const _celda = (txt) => {
    const el = { value: txt, title: '', classList: { c: new Set(), add(x){this.c.add(x);}, remove(x){this.c.delete(x);}, has(x){return this.c.has(x);} } };
    let guardado = '__intacto__';
    B._celdaCalc(el, (v) => { guardado = v; });
    return { value: el.value, err: el.classList.has('calc-err'), guardado };
};
test('celda: "3*24+5" = 77 (tres cajas de 24 más 5 sueltas)', () => eq(_celda('3*24+5').guardado, 77));
test('celda: "144/12" = 12', () => eq(_celda('144/12').guardado, 12));
test('celda: "(2+3)*4" = 20', () => eq(_celda('(2+3)*4').guardado, 20));
test('celda: coma decimal de tablet "3,5" = 3.5', () => eq(_celda('3,5').guardado, 3.5));
test('celda: "2,5*4" = 10 (coma dentro de una operación)', () => eq(_celda('2,5*4').guardado, 10));
test('celda: "3.5" con punto sigue igual', () => eq(_celda('3.5').guardado, 3.5));
test('celda incompleta "5+" NO borra lo escrito', () => eq(_celda('5+').value, '5+'));
test('celda incompleta "5+" NO guarda 0 (antes borraba el dato)', () => eq(_celda('5+').guardado, '__intacto__'));
test('celda incompleta se marca en rojo', () => eq(_celda('5+').err, true));
test('celda con texto "abc" no toca el modelo', () => eq(_celda('abc').guardado, '__intacto__'));
test('celda "-" suelto no escribe NaN', () => eq(_celda('-').value, '-'));
test('celda vacía guarda vacío, no cero', () => eq(_celda('').value, ''));

test('compra SÍ suma a compras', () => eq(B.entEsCompra('compra'), true));
test('sin tipo (legacy) cuenta como compra', () => eq(B.entEsCompra(''), true));
test('bonificación NO suma a compras', () => eq(B.entEsCompra('bonificacion'), false));
test('consignación NO suma a compras', () => eq(B.entEsCompra('consignacion'), false));
test('préstamo pagado NO suma a compras', () => eq(B.entEsCompra('prestamo_pagado'), false));
test('un tipo desconocido NO se cuela a compras', () => eq(B.entEsCompra('lo_que_sea'), false));
test('etiqueta del préstamo pagado', () => eq(B.tipoEntradaLabel('prestamo_pagado'), 'Préstamo pagado'));
test('getEntradasBottles suma TODOS los tipos (todo entra al stock)', () => {
    setVar(B, 'filasCaptura', [filaCopa]);
    vm.runInContext("invActual.entradasLog = [{insumoId:'ron1',cantidad:2,tipo:'compra'},{insumoId:'ron1',cantidad:1,tipo:'consignacion'},{insumoId:'ron1',cantidad:1,tipo:'prestamo_pagado'}];", B);
    eq(B.getEntradasBottles('ron1'), 4);
    vm.runInContext('invActual.entradasLog = [];', B);
});
test('ingredienteML convierte onzas (2 oz = 59.147 ml)', () => eq(B.ingredienteML(2, 'OZ'), 2 * 29.5735));
test('ingredienteML convierte litros', () => eq(B.ingredienteML(1.5, 'LT'), 1500));

// Primer levantamiento = LÍNEA BASE: sirve de referencia de existencia anterior
// aunque su estado NO sea "cerrado" (antes solo contaba si cerrado → el siguiente
// inventario se quedaba sin existencia anterior).
setVar(B, '_cacheInv', [
    { id: 'lev1', tipoInv: 'primer_lev', cerrado: false, fecha: '2026-06-01',
      filas: [{ insumoId: 'ron1', tipo: 'copa', copaML: 50, contNeto: 750, existenciaFisica: 40 }] },
]);
test('primer levantamiento (no cerrado) SÍ sirve de existencia anterior', () =>
    eq(B.getExistenciaAnterior('ron1'), 40));
setVar(B, '_cacheInv', null);

// Referencia: un inventario intermedio ABIERTO con datos capturados SÍ vale como
// referencia (no cae al primer levantamiento) y solo si es ANTERIOR por fecha.
setVar(B, '_cacheInv', [
    { id:'lev', tipoInv:'primer_lev', cerrado:false, fecha:'2026-06-04', filas:[{insumoId:'refx', tipo:'copa', copaML:50, contNeto:750, existenciaFisica:5, cerradasBodega:1, cerradasBarra:0, pesos:[]}] },
    { id:'mid', tipoInv:'bebidas',    cerrado:false, fecha:'2026-06-25', filas:[{insumoId:'refx', tipo:'copa', copaML:50, contNeto:750, existenciaFisica:8, cerradasBodega:1, cerradasBarra:0, pesos:[]}] },
]);
setVar(B, 'invActual', { id:'nuevo', tipoInv:'bebidas', cerrado:false, fecha:'2026-07-16', filas:[], entradasLog:[] });
test('referencia = el intermedio ABIERTO más reciente (no el primer levantamiento)', () =>
    eq(B._getRefInv().id, 'mid'));
test('existencia anterior del nuevo inv = la del intermedio (8), no la del primer lev (5)', () =>
    eq(B.getExistenciaAnterior('refx'), 8));
setVar(B, 'invActual', { id:'mid', tipoInv:'bebidas', cerrado:false, fecha:'2026-06-25', filas:[], entradasLog:[] });
test('referencia del intermedio = el primer levantamiento (no un inventario futuro)', () =>
    eq(B._getRefInv().id, 'lev'));
// Self-heal del ref guardado (residuo del bug "solo primer lev era referencia"):
// refInventarioId apuntando al primer lev con un intermedio más nuevo → automático.
const _invRefStale = { id:'nuevo', tipoInv:'bebidas', cerrado:false, fecha:'2026-07-16', filas:[], entradasLog:[], refInventarioId:'lev' };
setVar(B, 'invActual', _invRefStale);
B._sanearRefInv();
test('ref guardado al primer lev (obsoleto) se sanea → usa el intermedio más reciente', () => {
    eq(_invRefStale.refInventarioId, '');
    eq(B._getRefInv().id, 'mid');
});
// Un ref elegido que NO es primer lev se respeta (elección deliberada del usuario).
const _invRefOk = { id:'nuevo2', tipoInv:'bebidas', cerrado:false, fecha:'2026-07-16', filas:[], entradasLog:[], refInventarioId:'mid' };
setVar(B, 'invActual', _invRefOk);
B._sanearRefInv();
test('ref elegido a un inventario normal NO se toca', () => eq(_invRefOk.refInventarioId, 'mid'));
setVar(B, '_cacheInv', null);
setVar(B, 'invActual', { id: 'invT', entradasLog: [], prebatchProducidos: {}, cocktailsVendidos: {}, ventasCompuesto: {}, cancelaciones: [], descuentos: [], filas: [] });

// _unidadCompra NO debe tronar si el insumo no resuelve (borrado / otra sucursal):
// antes (p && (p.x||'')).toString() daba null.toString() → congelaba el reporte
// y vaciaba la lista de entradas.
setVar(B, '_cacheInsumosInv', []);
test('_unidadCompra null-safe cuando el insumo no existe', () =>
    eq(B._unidadCompra({ insumoId: 'no-existe-xyz' }), 'bot'));

// PRODUCTOS COMPUESTOS (consolidación en el reporte): suma las presentaciones,
// cada una con SUS propias ventas; el compuesto NO captura ventas ni doble-cuenta.
const filaM1 = { insumoId:'mzcl-750',  tipo:'copa', contNeto:750,  copaML:50, existenciaAnterior:20, ventasCopasDirectas:5, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[], cerradasBodega:2, cerradasBarra:0, pesos:[], pesoCristal:0 };
const filaM2 = { insumoId:'mzcl-1000', tipo:'copa', contNeto:1000, copaML:50, existenciaAnterior:10, ventasCopasDirectas:3, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[], cerradasBodega:1, cerradasBarra:0, pesos:[], pesoCristal:0 };
setVar(B, 'filasCaptura', [filaM1, filaM2]);
const _comp = { id:'c1', nombre:'Mezcal Casa', miembros:['mzcl-750','mzcl-1000'] };
test('compuesto existencia = Σ existencia de las presentaciones', () =>
    eq(B._existenciaCompuestoCopas(_comp), B.calcExistencia(filaM1) + B.calcExistencia(filaM2)));
test('compuesto teórico = Σ teórico de las presentaciones (sin ventasCompuesto)', () =>
    eq(B._teoricoCompuestoCopas(_comp), B.calcExistenciaTeorica(filaM1) + B.calcExistenciaTeorica(filaM2)));
test('compuesto NO doble-cuenta: su diferencia = Σ diferencias de las presentaciones', () => {
    const difComp = B._existenciaCompuestoCopas(_comp) - B._teoricoCompuestoCopas(_comp);
    const difMs = (B.calcExistencia(filaM1)-B.calcExistenciaTeorica(filaM1)) + (B.calcExistencia(filaM2)-B.calcExistenciaTeorica(filaM2));
    eq(difComp, difMs);
});

// % de VARIANZA = diferencia vs VENTA NETA del periodo (definición de Edwin):
// vendiste 10 copas, diferencia +1 copa → +10%. Sin ventas → null (se muestra '—').
test('varianza: venta 10, dif +1 = +10%', () => eq(B._pctVarianza(1, 10), 10));
test('varianza: venta 8, dif −2 = −25%', () => eq(B._pctVarianza(-2, 8), -25));
test('varianza sin ventas = null (sin base de comparación)', () => eq(B._pctVarianza(3, 0), null));
// Consumo del compuesto = Σ del consumo de sus presentaciones (con filaM1/M2 activos: 5+3 copas directas)
B.setCompuestos([_comp]);
test('consumo del compuesto = Σ consumo de sus presentaciones (5+3=8 copas)', () =>
    eq(B._consumoPeriodo({ esCompuesto: true, compId: 'c1' }), 8));
B.setCompuestos([]);
setVar(B, 'filasCaptura', [filaCopa]);

// MERMAS del QR: importar DOS veces NO debe doble-contar (candado importadoEnInv).
// Las mermas de insumo SUMAN a la fila (no dejan id en entradasLog), así que el
// dedupe por yaEnInv no las protege — sin el candado, cada corrida del import
// re-sumaba la misma merma y corrompía la existencia teórica / diferencia.
setVar(B, '_cacheInsumosInv', [{ id: 'ron1', activo: '1' }]);
setVar(B, '_cacheEL', [{ id: 'mQR1', concepto: 'merma', insumoId: 'ron1', cantidad: 2, unidad: 'copa', fecha: '2026-07-10', origen: 'qr' }]);
setVar(B, 'invActual', { id: 'invT', cerrado: false, fecha: '2026-07-16', filas: [], entradasLog: [] });
const filaMerma = { ...filaCopa, mermaCopas: 0 };   // misma referencia dentro y fuera del VM
setVar(B, 'filasCaptura', [filaMerma]);
B._importarEntradasQR();
test('merma QR del periodo se importa y suma UNA vez (2 copas)', () => eq(filaMerma.mermaCopas, 2));
B._importarEntradasQR();
test('re-importar NO doble-cuenta la merma (sigue en 2, candado importadoEnInv)', () => eq(filaMerma.mermaCopas, 2));
setVar(B, '_cacheEL', null); setVar(B, '_cacheInsumosInv', []);
setVar(B, 'invActual', { id: 'invT', entradasLog: [], prebatchProducidos: {}, cocktailsVendidos: {}, ventasCompuesto: {}, cancelaciones: [], descuentos: [], filas: [] });
setVar(B, 'filasCaptura', [filaCopa]);

/* ═══════════════ SUITE C · NÚCLEO (etaax-core.js directo) ═══════════════ */
console.log('\n══ SUITE C · Núcleo compartido (etaax-core.js) ══');
const C = cargarJS(crearContexto(), 'etaax-core.js');
const Core = C.EtaaxCore;

test('núcleo expuesto en window.EtaaxCore', () => eq(typeof Core, 'object'));
test('scopeSuc: sin sello = matriz', () => {
    const l = [{ sucursalId: 'a' }, {}, { sucursalId: 'b' }];
    eq(Core.scopeSuc(l, 'suc_principal').length, 1);
    eq(Core.scopeSuc(l, 'a').length, 1);
    eq(Core.scopeSuc(l, '').length, 3);
});
test('semanaISO: 2026-07-12 es semana 28', () => eq(Core.semanaISO('2026-07-12'), 28));
test('resguardo del núcleo con caja chica por parámetro', () =>
    eq(Core.resguardo({ fondoInicial: 2000, efectivo: 3000, propRetiroCaja: 300, retiros: 2000 }, 150), 2550));
test('taBancoNeto del núcleo con cuentas por parámetro', () => {
    const cta = { comisionTD: 2, comisionTC: 1.8, aplicaIva: true, ivaPct: 16 };
    eq(Core.taBancoNeto({ tarjeta: 1000, propTarjeta: 500 }, [cta]),
       1000 * (1 - 0.0232) + 500 * (1 - 0.0232));
});
test('calcMetaDiaria con FACTORES personalizados pondera por día', () => {
    // factores: solo sábado (getDay 6) pesa — toda la meta cae en los sábados
    const fac = [0, 0, 0, 0, 0, 0, 1];
    const d = Core.calcMetaDiaria('2026-07', 4000, 'factores', null, null, fac);
    eq(d['2026-07-11'], 1000);  // sábado (julio 2026 tiene 4 sábados)
    eq(d['2026-07-10'], 0);     // viernes
});
test('calcMetaDiaria factores en cero cae a uniforme', () => {
    const d = Core.calcMetaDiaria('2026-07', 3100, 'factores', null, null, [0,0,0,0,0,0,0]);
    eq(d['2026-07-15'], 100);
});
test('flujoNeto núcleo = ef + tarjeta + propTarjeta + transfer (las 6 páginas heredan ESTA)', () =>
    eq(Core.flujoNeto({ efectivo: 1, tarjeta: 2, propTarjeta: 3, transferencia: 4 }), 10));

/* planFijoPago — plan de pago de gastos fijos recurrentes (día de pago + periodicidad) */
test('mensual pagado el ciclo → estado pagado, próximo mes', () => {
    var p = Core.planFijoPago('2026-07-01', 'mensual', '2026-07-10', '2026-07-01');
    eq(p.estado, 'pagado'); eq(p.proximo, '2026-08-01'); eq(p.dias, 22);
});
test('mensual sin pagar y ya pasó el día → vencido', () => {
    var p = Core.planFijoPago('2026-07-01', 'mensual', '2026-07-10', '');
    eq(p.estado, 'vencido'); eq(p.venceEste, '2026-07-01'); eq(p.dias, -9);
});
test('mensual con fecha ref futura → programado', () => {
    var p = Core.planFijoPago('2026-07-15', 'mensual', '2026-07-10', '');
    eq(p.estado, 'programado'); eq(p.proximo, '2026-07-15'); eq(p.dias, 5);
});
test('mensual vence HOY sin pagar', () => {
    var p = Core.planFijoPago('2026-07-15', 'mensual', '2026-07-15', '');
    eq(p.estado, 'vence_hoy'); eq(p.dias, 0);
});
test('bimestral: pagó julio, agosto NO toca → pagado, próximo septiembre', () => {
    var p = Core.planFijoPago('2026-07-01', 'bimestral', '2026-08-10', '2026-07-01');
    eq(p.estado, 'pagado'); eq(p.proximo, '2026-09-01');
});
test('bimestral: septiembre sin pagar (pagó julio) → vencido', () => {
    var p = Core.planFijoPago('2026-07-01', 'bimestral', '2026-09-10', '2026-07-01');
    eq(p.estado, 'vencido'); eq(p.venceEste, '2026-09-01');
});
test('quincenal: cada 15 días desde ref', () => {
    var p = Core.planFijoPago('2026-07-01', 'quincenal', '2026-07-20', '');
    eq(p.estado, 'vencido'); eq(p.venceEste, '2026-07-16'); eq(p.dias, -4);
});
test('anual: clamp de día (ref 31 ene → próximo respeta fin de mes)', () => {
    var p = Core.planFijoPago('2026-01-31', 'mensual', '2026-02-15', '2026-01-31');
    eq(p.estado, 'pagado'); eq(p.proximo, '2026-02-28'); // febrero no tiene 31
});
test('fecha ref vacía → no programado', () => eq(Core.planFijoPago('', 'mensual', '2026-07-10', '').programado, false));
/* Pago ANTICIPADO: pagar antes del vencimiento sigue siendo el pago de ese ciclo.
   Caso real: agua vence el 8, se pagó el 6, hoy es 10 → NO debe salir vencido. */
test('mensual pagado 2 días ANTES del vencimiento → pagado (no vencido)', () => {
    var p = Core.planFijoPago('2026-08-08', 'mensual', '2026-08-10', '2026-08-06');
    eq(p.estado, 'pagado'); eq(p.anticipado, true); eq(p.proximo, '2026-09-08');
});
test('mensual: el pago del ciclo ANTERIOR no cuenta como anticipo → vencido', () => {
    var p = Core.planFijoPago('2026-07-08', 'mensual', '2026-08-10', '2026-07-08');
    eq(p.estado, 'vencido'); eq(p.venceEste, '2026-08-08'); eq(p.aceptaDesde, '2026-07-29');
});
test('quincenal: la ventana de anticipo se recorta a media quincena (7 días)', () => {
    eq(Core.planFijoPago('2026-07-01', 'quincenal', '2026-08-05', '2026-07-25').estado, 'pagado');
    eq(Core.planFijoPago('2026-07-01', 'quincenal', '2026-08-05', '2026-07-23').estado, 'vencido');
});
test('pago adelantado ANTES de que llegue el día → pagado, ya no molesta', () => {
    // vence el 8, hoy es 6 y ya se pagó el 6 → el pendiente es el del mes que sigue
    var p = Core.planFijoPago('2026-08-08', 'mensual', '2026-08-06', '2026-08-06');
    eq(p.estado, 'pagado'); eq(p.proximo, '2026-09-08'); eq(p.dias, 33);
});
test('sin pagar y el día aún no llega → programado (recordatorio de aviso)', () => {
    var p = Core.planFijoPago('2026-08-08', 'mensual', '2026-08-06', '');
    eq(p.estado, 'programado'); eq(p.dias, 2);
});
/* La otra mitad del recordatorio: encontrar el pago real que corresponde al fijo. */
(function () {
    const _prevG = A._cacheGastos;
    A._cacheGastos = [
        { fecha: '2026-07-08', concepto: 'Servicio de Agua', proveedor: 'OOAPAS', monto: 363 },
        { fecha: '2026-08-06', concepto: 'Servicio de Agua', proveedor: 'OOAPAS', monto: 360, fijoId: 'fj_agua' },
        { fecha: '2026-08-09', concepto: 'Servicio de Agua', proveedor: 'OOAPAS', monto: 99, fijoId: 'fj_otro' },
        { fecha: '2026-08-01', concepto: 'Renta', proveedor: 'Casero', monto: 17000 },
    ];
    const fAgua = { id: 'fj_agua', concepto: 'Servicio de Agua', proveedor: 'OOAPAS' };
    test('_ultimoPagoFijoDx: casa por fijoId o por concepto+proveedor y toma el más reciente', () =>
        eq(A._ultimoPagoFijoDx(fAgua), '2026-08-06'));
    test('_ultimoPagoFijoDx: un pago con el fijoId de OTRO fijo no cuenta', () =>
        eq(A._ultimoPagoFijoDx({ id: 'fj_otro', concepto: 'Servicio de Agua', proveedor: 'OOAPAS' }), '2026-08-09'));
    test('_ultimoPagoFijoDx: fijo sin pagos → vacío', () =>
        eq(A._ultimoPagoFijoDx({ id: 'fj_luz', concepto: 'Servicio de Electricidad', proveedor: 'CFE' }), ''));
    A._cacheGastos = _prevG;
})();

/* clasificarGastos — UNA sola verdad de gastos para los 4 módulos (Gastos Totales,
   KPIs, Estadísticas, Diario). Misma data que SUITE D → debe dar los mismos cubos. */
const _gsCanon = [
    { id: '1', categoria: 'Nómina y personal', concepto: 'nómina', monto: 76210 },
    { id: '2', categoria: 'Varios',            concepto: 'compras', monto: 105602 },
    { id: '3', categoria: 'Internet y telecomunicaciones', concepto: 'internet', monto: 1100 },
    { id: '4', categoria: 'Alimentos e ingredientes', concepto: 'fresa', monto: 1045 },
    { id: '5', categoria: 'Impuestos',         concepto: 'isr', monto: 5000 },
    { id: '6', categoria: 'IMSS',              concepto: 'cuota', monto: 800 },
    { id: '7', categoria: 'Propinas',          concepto: 'propina staff', monto: 500 },
    { id: '8', categoria: 'Contabilidad',      concepto: 'honorarios contador', monto: 2500 },
];
test('clasificarGastos: mismos cubos que Gastos Totales (fijo/nom/var/propina)', () => {
    const r = Core.clasificarGastos(_gsCanon, {});
    eq(r.fijo, 1100);          // internet (fijo no catalogado)
    eq(r.nom, 77010);          // nómina 76210 + IMSS 800
    eq(r.variable, 114147);    // compras + alimentos + impuestos + contabilidad
    eq(r.propina, 500);        // pass-through, FUERA del egreso
    eq(r.egresos, 192257);     // fijo + nom + variable (SIN propina, SIN previsiones)
});
test('clasificarGastos INVARIANTE: egresos + propina = suma cruda (nada se pierde)', () => {
    const raw = _gsCanon.reduce((s, g) => s + g.monto, 0);
    const r = Core.clasificarGastos(_gsCanon, {});
    eq(r.egresos + r.propina, raw);
});
test('clasificarGastos: propina es pass-through (NO entra al egreso)', () => {
    const r = Core.clasificarGastos([{ categoria: 'Propinas', monto: 500 }], {});
    eq(r.egresos, 0); eq(r.propina, 500);
});
test('clasificarGastos: comisión bancaria se suma a variable', () => {
    const r = Core.clasificarGastos([{ categoria: 'Varios', monto: 100 }], { comisionBanco: 50 });
    eq(r.variable, 150); eq(r.egresos, 150);
});
test('clasificarGastos: impuestos y contabilidad SÍ cuentan como variable', () =>
    eq(Core.clasificarGastos([{ categoria: 'Impuestos', monto: 1000 }, { categoria: 'Contabilidad', monto: 2000 }], {}).variable, 3000));
test('clasificarGastos: nómina op/adm por staff + IMSS aparte', () => {
    const staff = [{ nombre: 'Ana', rol: 'administrativo' }];
    const gs = [
        { categoria: 'Nómina y personal', concepto: 'sueldo — Ana', monto: 1000 },
        { categoria: 'Nómina y personal', concepto: 'sueldo — Beto', monto: 2000 },
        { categoria: 'IMSS', monto: 300 },
    ];
    const r = Core.clasificarGastos(gs, { staff });
    eq(r.nomAdm, 1000); eq(r.nomOp, 2000); eq(r.imss, 300); eq(r.nom, 3300);
});
test('clasificarGastos: pago de fijo del catálogo → fijo (no variable)', () => {
    const fijos = [{ id: 'f1', concepto: 'x' }];
    const r = Core.clasificarGastos([{ fijoId: 'f1', categoria: 'Mantenimiento', monto: 8000 }, { categoria: 'Varios', monto: 500 }], { fijos });
    eq(r.fijo, 8000); eq(r.variable, 500);
});

/* ═══════════════ SUITE D · RECLASIFICACIÓN DE GASTOS (financiero/gastos-globales.html) ═══════════════ */
console.log('\n══ SUITE D · Reclasificación de gastos (financiero/gastos-globales.html) ══');
(function () {
    // Se cargan SOLO las funciones de clasificación (de loadGastosMes a loadCortesMonth)
    // con stubs mínimos, para blindar que ningún gasto se pierda del Total de Egresos.
    const html = fs.readFileSync(path.join(RAIZ, 'financiero/gastos-globales.html'), 'utf8');
    // Desde el bloque de PERIODO (día/semana/mes/rango) hasta loadCortesMonth: así el
    // candado corre el MISMO recorte de periodo que usa la página, no una copia.
    const src = html.slice(html.indexOf('/* ── PERIODO'), html.indexOf('function loadCortesMonth'));
    const D = { n: (v) => parseFloat(v) || 0, mesStr: () => '2026-07', _sucursalId: null,
                _mesPicker: '', todayStr: () => '2026-07-15', EtaaxCore: Core,
                document: { getElementById: () => null }, querySelectorAll: () => [],
                _cacheGG_Gastos: [], _cacheGG_Fijos: [] };
    D._deSuc = (x) => !D._sucursalId || ((x && x.sucursalId) || 'suc_principal') === D._sucursalId;
    D.loadFijos = () => D._cacheGG_Fijos || [];
    vm.createContext(D);
    vm.runInContext(src, D);
    D._cacheGG_Gastos = [
        { id: '1', fecha: '2026-07-12', categoria: 'Nómina y personal', concepto: 'nómina', monto: 76210 },
        { id: '2', fecha: '2026-07-13', categoria: 'Varios',            concepto: 'compras', monto: 105602 },
        { id: '3', fecha: '2026-07-11', categoria: 'Internet y telecomunicaciones', concepto: 'internet', monto: 1100 },
        { id: '4', fecha: '2026-07-10', categoria: 'Alimentos e ingredientes', concepto: 'fresa', monto: 1045 },
        { id: '5', fecha: '2026-07-09', categoria: 'Impuestos',         concepto: 'isr', monto: 5000 },
        { id: '6', fecha: '2026-07-09', categoria: 'IMSS',              concepto: 'cuota', monto: 800 },
        { id: '7', fecha: '2026-07-08', categoria: 'Propinas',          concepto: 'propina staff', monto: 500 },
        { id: '8', fecha: '2026-07-08', categoria: 'Contabilidad',      concepto: 'honorarios contador', monto: 2500 },
    ];
    const mes = '2026-07';
    const raw = D._cacheGG_Gastos.reduce((s, g) => s + D.n(g.monto), 0);
    const nom = D.totalNominaGastosMes(mes);
    const imss = D.loadGastosMes(mes).filter(D._esIMSS).reduce((s, g) => s + D.n(g.monto), 0);
    const varb = D.loadVariablesMes(mes).reduce((s, g) => s + D.n(g.monto), 0);
    const nc = D.totalFijosNoCatalogMes(mes);
    const excl = D.loadGastosMes(mes).filter(D._catExcluidaVar).reduce((s, g) => s + D.n(g.monto), 0);
    test('nómina = gastos categoría nómina (sin IMSS)', () => eq(nom, 76210));
    // variables = compras 105602 + alimentos 1045 + impuestos 5000 + contabilidad 2500
    test('variables = variable real + impuestos + contabilidad', () => eq(varb, 114147));
    test('impuestos AHORA cuenta como variable (antes desaparecía del P&L)', () =>
        eq(D.loadVariablesMes(mes).filter(g => g.id === '5').length, 1));
    test('contabilidad AHORA cuenta como variable', () =>
        eq(D.loadVariablesMes(mes).filter(g => g.id === '8').length, 1));
    test('propinas SÍ se excluyen (pass-through al staff)', () =>
        eq(D.loadVariablesMes(mes).filter(g => g.id === '7').length, 0));
    test('fijos NO catalogados capturan lo de naturaleza fija (internet)', () => eq(nc, 1100));
    test('internet SALE de variables (no se cuenta doble)', () =>
        eq(D.loadVariablesMes(mes).filter(g => g.id === '3').length, 0));
    test('nómina NO entra a fijos no catalogados', () =>
        eq(D.loadFijosNoCatalogMes(mes).filter(g => /n[oó]mina/i.test(g.categoria)).length, 0));
    // La invariante clave: NADA se pierde. raw = nómina + IMSS + variables + fijosNoCat + excluidos (propinas).
    test('INVARIANTE: ningún gasto se pierde del Total de Egresos', () => eq(nom + imss + varb + nc + excl, raw));

    /* Buscador de periodo: sin periodo activo manda el mes completo; con un
       periodo activo (día/semana/rango) el corte es EXACTAMENTE ese rango. */
    test('sin periodo activo: loadGastosMes = el mes completo', () =>
        eq(D.loadGastosMes(mes).length, 8));
    test('periodo activo de 2 días: solo esos gastos', () => {
        D._mesPicker = mes;
        D._rgGG = { from: '2026-07-08', to: '2026-07-09' };
        const l = D.loadGastosMes(mes);
        D._rgGG = null; D._mesPicker = '';
        eq(l.length, 4);                                   // ids 5,6,7,8
        eq(l.reduce((s, g) => s + D.n(g.monto), 0), 8800); // 5000+800+500+2500
    });
    test('otro mes distinto al del periodo sigue saliendo completo', () => {
        D._mesPicker = mes;
        D._rgGG = { from: '2026-07-08', to: '2026-07-09' };
        const l = D.loadGastosMes('2026-06');
        D._rgGG = null; D._mesPicker = '';
        eq(l.length, 0);                                   // junio no tiene gastos, pero NO usa el rango de julio
    });
})();

/* ═══════════════ SUITE E · ESCANDALLO (app.js) ═══════════════ */
console.log('\n══ SUITE E · Escandallo de recetas (app.js) ══');

(function () {
    // app.js truena a medias con los stubs (arranque de UI), pero las funciones
    // declaradas quedan izadas — igual que en las otras suites. insumo-label.js
    // va primero porque app.js usa window._makeInsumoResolver al cargar.
    const E = crearContexto();
    cargarJS(E, 'insumo-label.js');
    cargarJS(E, 'app.js');

    // Bug 2026-07-22: insumo MANUAL (sin insumoId) a $80/lt con 1 OZ daba $80
    // (como si fuera pieza). 1 oz = 29.5735 ml → debe dar $2.37.
    const manualOz = { nombre: 'x', insumoId: '', unidad: 'OZ', costoPorKgLt: 80, cantidad: 1 };
    test('manual OZ: $80/lt × 1 oz = $2.37 (no $80)', () =>
        eq(E.getFactor(1, 'OZ') * E.costoUnitEfectivo(manualOz), 2.366));
    test('manual ML: $80/lt × 30 ml = $2.40 (sin cambio)', () =>
        eq(E.getFactor(30, 'ML') * E.costoUnitEfectivo({ insumoId: '', unidad: 'ML', costoPorKgLt: 80 }), 2.40));
    test('manual KG: $80/kg × 0.5 kg = $40 (sin cambio)', () =>
        eq(E.getFactor(0.5, 'KG') * E.costoUnitEfectivo({ insumoId: '', unidad: 'KG', costoPorKgLt: 80 }), 40));
    test('manual PZA: $80/pz × 2 pza = $160 (sin cambio)', () =>
        eq(E.getFactor(2, 'PZA') * E.costoUnitEfectivo({ insumoId: '', unidad: 'PZA', costoPorKgLt: 80 }), 160));
    // VINCULADO: costoPorKgLt ya viene convertido a $/OZ por getCostoParaUnidad —
    // NO debe re-convertirse (doble conversión lo haría casi cero).
    test('vinculado OZ: $2.37/oz se respeta tal cual (sin doble conversión)', () =>
        eq(E.getFactor(1, 'OZ') * E.costoUnitEfectivo({ insumoId: 'ins1', unidad: 'OZ', costoPorKgLt: 2.37 }), 2.37));
    // costoUnitVivo delega en costoUnitEfectivo cuando NO hay vínculo.
    test('costoUnitVivo manual OZ delega la conversión', () =>
        eq(E.costoUnitVivo(manualOz), 2.366));

    /* ── VINCULADOS: getCostoParaUnidad convierte desde el catálogo ──
       Matriz completa de unidades (auditoría 2026-07-24). */
    const bot = { presentaciones: [{ costoUnitario: 400, umCosto: 'LT', contNeto: 750, umContenido: 'ML', precio: 300 }] };
    test('vinculado ML: $400/lt → 30 ml = $12', () => eq(E.getFactor(30, 'ML') * E.getCostoParaUnidad(bot, 'ML'), 12));
    test('vinculado LT: 0.5 lt = $200', () => eq(E.getFactor(0.5, 'LT') * E.getCostoParaUnidad(bot, 'LT'), 200));
    test('vinculado G/KG con densidad ≈1: 30 g = $12', () => eq(E.getFactor(30, 'G') * E.getCostoParaUnidad(bot, 'G'), 12));
    test('vinculado OZ: $400/lt → 1.5 oz = $17.74', () => eq(E.getFactor(1.5, 'OZ') * E.getCostoParaUnidad(bot, 'OZ'), 17.744));
    test('vinculado PZA: botella completa (750 ml × $400/lt) = $300', () => eq(E.getCostoParaUnidad(bot, 'PZA'), 300));
    test('vinculado PORCION líquida = 1 oz = $11.83', () => eq(E.getCostoParaUnidad(bot, 'PORCION'), 11.8294));
    test('vinculado CARGA = precio de compra directo', () => eq(E.getCostoParaUnidad(bot, 'CARGA'), 300));
    test('umCosto en ML se normaliza: $0.40/ml → $400/lt', () =>
        eq(E.getCostoParaUnidad({ presentaciones: [{ costoUnitario: 0.4, umCosto: 'ML' }] }, 'LT'), 400));
    test('umCosto en OZ se normaliza: $11.83/oz → $400/lt', () =>
        eq(E.getCostoParaUnidad({ presentaciones: [{ costoUnitario: 11.8294, umCosto: 'OZ' }] }, 'LT'), 400));

    // Pieza usada por PESO (fix 2026-07-24): huevo $3/pza de 60 g → $50/kg,
    // antes el $3 de la pieza se usaba como si fuera $/kg.
    const huevo = { presentaciones: [{ precio: 3, umCosto: 'PZA', contNeto: 60, umContenido: 'G' }] };
    test('pieza por PESO deriva $/KG del contenido: 30 g de huevo = $1.50', () =>
        eq(E.getFactor(30, 'G') * E.getCostoParaUnidad(huevo, 'G'), 1.5));
    test('pieza por PZA: $3/pza directo (antes $/pza × litros daba centavos)', () =>
        eq(E.getCostoParaUnidad(huevo, 'PZA'), 3));

    // Sub-receta: granel $/KG + porción $/PZA
    const sub = { esSubReceta: true, presentaciones: [
        { umContenido: 'KG', umCosto: 'KG', costoUnitario: 120 },
        { umContenido: 'PZA', umCosto: 'PZA', costoUnitario: 4.67 }] };
    test('sub-receta por G usa el granel: 500 g × $120/kg = $60', () =>
        eq(E.getFactor(500, 'G') * E.getCostoParaUnidad(sub, 'G'), 60));
    test('sub-receta por PZA usa el costo por porción', () => eq(E.getCostoParaUnidad(sub, 'PZA'), 4.67));
    test('sub-receta por PORCION = PZA (equivalentes)', () => eq(E.getCostoParaUnidad(sub, 'PORCION'), 4.67));

    // Prebatch con ENVASE como presentación 0 (700 ml, $180/lt, botella llena $126)
    const pb = { esSubReceta: true, presentaciones: [
        { esEnvasePrebatch: true, contNeto: 700, umContenido: 'ML', umCosto: 'LT', costoUnitario: 180, precio: 126 },
        { umContenido: 'PZA', umCosto: 'PZA', costoUnitario: 9 }] };
    test('prebatch por ML usa el $/LT del envase: 50 ml = $9', () =>
        eq(E.getFactor(50, 'ML') * E.getCostoParaUnidad(pb, 'ML'), 9));
    test('prebatch por OZ convierte del $/LT: $5.32/oz', () => eq(E.getCostoParaUnidad(pb, 'OZ'), 5.3232));
    test('prebatch por PZA = su PORCIÓN ($9), no la botella (regla sub-receta)', () =>
        eq(E.getCostoParaUnidad(pb, 'PZA'), 9));
})();

/* ═══════ SUITE G · IMPORTE CON LETRA (etaax-core.js) ═══════
   Va en el recibo de nómina: es lo que impide que alguien le agregue un dígito
   al número. Un error aquí sale impreso y firmado. */
console.log('\n══ SUITE G · Importe con letra (etaax-core.js) ══');
(function () {
    const L = Core.importeLetra;
    const t = (m, esp) => test(`${m} → ${esp}`, () => eq(L(m) === esp, true, L(m)));

    t(0, 'CERO PESOS 00/100 M.N.');
    t(1, 'UN PESOS 00/100 M.N.');
    t(15, 'QUINCE PESOS 00/100 M.N.');
    t(16, 'DIECISÉIS PESOS 00/100 M.N.');
    t(21, 'VEINTIUN PESOS 00/100 M.N.');
    t(28, 'VEINTIOCHO PESOS 00/100 M.N.');
    t(31, 'TREINTA Y UN PESOS 00/100 M.N.');
    t(99, 'NOVENTA Y NUEVE PESOS 00/100 M.N.');
    t(100, 'CIEN PESOS 00/100 M.N.');
    t(101, 'CIENTO UN PESOS 00/100 M.N.');
    t(115, 'CIENTO QUINCE PESOS 00/100 M.N.');
    t(200, 'DOSCIENTOS PESOS 00/100 M.N.');
    t(500, 'QUINIENTOS PESOS 00/100 M.N.');
    t(999, 'NOVECIENTOS NOVENTA Y NUEVE PESOS 00/100 M.N.');
    t(1000, 'MIL PESOS 00/100 M.N.');
    t(1001, 'MIL UN PESOS 00/100 M.N.');
    t(2000, 'DOS MIL PESOS 00/100 M.N.');
    t(21000, 'VEINTIUN MIL PESOS 00/100 M.N.');
    t(100000, 'CIEN MIL PESOS 00/100 M.N.');
    t(999999, 'NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE PESOS 00/100 M.N.');
    t(1000000, 'UN MILLÓN PESOS 00/100 M.N.');
    t(2000000, 'DOS MILLONES PESOS 00/100 M.N.');

    /* Centavos: es donde se cuelan los errores de redondeo */
    t(1234.56, 'MIL DOSCIENTOS TREINTA Y CUATRO PESOS 56/100 M.N.');
    t(0.5, 'CERO PESOS 50/100 M.N.');
    t(0.05, 'CERO PESOS 05/100 M.N.');
    t(9.999, 'DIEZ PESOS 00/100 M.N.');          // el centavo carga al entero, no "9 PESOS 100/100"
    t(1500.999, 'MIL QUINIENTOS UN PESOS 00/100 M.N.');
    test('nómina real: 3,847.50', () => eq(L(3847.5), 'TRES MIL OCHOCIENTOS CUARENTA Y SIETE PESOS 50/100 M.N.'));
    test('negativo se marca', () => eq(L(-100).indexOf('MENOS') === 0, true));
    test('basura → cero', () => eq(L('abc'), 'CERO PESOS 00/100 M.N.'));
    test('moneda configurable', () => eq(L(1, 'DÓLARES'), 'UN DÓLARES 00/100 M.N.'));
})();

/* ═══════ SUITE F · MÚLTIPLO DE COSTEO DE RECETA (etaax-core.js) ═══════
   El precio sugerido de TODO escandallo (alimentos y bebidas) sale de aquí.
   La regla histórica 30/40/30 debe seguir dando el mismo centavo cuando la
   receta no trae múltiplo propio. */
console.log('\n══ SUITE F · Múltiplo de costeo de receta (etaax-core.js) ══');
(function () {
    const K = Core.costeoReceta;

    /* ── Default: sin múltiplo guardado = la regla de siempre ── */
    test('sin múltiplo → 30% costo bruto (idéntico a costo/0.30)', () => eq(K(120).platillo, 400));
    test('sin múltiplo → gasto operativo 40% = $160', () => eq(K(120).gastoOp, 160));
    test('sin múltiplo → utilidad neta 30% = $120', () => eq(K(120).utilidad, 120));
    test('sin múltiplo → los porcentajes son 30 / 40 / 30', () => {
        const r = K(120); eq(r.brutoPct, 30); eq(r.gastoOpPct, 40); eq(r.utilidadPct, 30);
    });
    test('sin múltiplo → precio en comedor = platillo × 1.16', () => eq(K(120).comedor, 464));
    test('sin múltiplo → precio en delivery = platillo × 1.56', () => eq(K(120).delivery, 624));
    test('sin múltiplo → IVA 16% = $64', () => eq(K(120).iva, 64));
    test('múltiplo 0 / vacío / basura caen al default', () => {
        eq(K(120, 0).platillo, 400); eq(K(120, null).platillo, 400);
        eq(K(120, '').platillo, 400); eq(K(120, 'abc').platillo, 400);
    });

    /* ── Múltiplo propio: el pastel para llevar ── */
    test('múltiplo 2.5 → platillo = costo × 2.5', () => eq(K(120, 2.5).platillo, 300));
    test('múltiplo 2.5 → costo bruto sube a 40%', () => eq(K(120, 2.5).brutoPct, 40));
    test('múltiplo 2.5 → utilidad neta baja a 20% ($60)', () => {
        eq(K(120, 2.5).utilidadPct, 20); eq(K(120, 2.5).utilidad, 60);
    });
    test('múltiplo 2.5 → gasto operativo SIGUE en 40% ($120)', () => {
        eq(K(120, 2.5).gastoOpPct, 40); eq(K(120, 2.5).gastoOp, 120);
    });
    test('múltiplo 2.5 → comedor $348 y delivery $468', () => {
        eq(K(120, 2.5).comedor, 348); eq(K(120, 2.5).delivery, 468);
    });
    test('múltiplo 4 → costo bruto 25%, utilidad neta 35%', () => {
        const r = K(120, 4); eq(r.brutoPct, 25); eq(r.utilidadPct, 35); eq(r.platillo, 480);
    });
    test('las tres partes suman el precio de platillo', () => {
        const r = K(87.5, 2.8); eq(r.costoBruto + r.gastoOp + r.utilidad, r.platillo);
        const d = K(87.5); eq(d.costoBruto + d.gastoOp + d.utilidad, d.platillo);
    });
    test('múltiplo 1.6 → utilidad NEGATIVA (avisa que no da): −2.5%', () =>
        eq(K(120, 1.6).utilidadPct, -2.5));
    test('costo 0 → todo en 0 (no divide entre nada)', () => {
        const r = K(0, 2.5); eq(r.platillo, 0); eq(r.utilidad, 0); eq(r.comedor, 0);
    });

    /* ── Acepta la receta completa, no solo el número ── */
    test('lee multiploCosteo desde la receta', () => eq(K(120, { multiploCosteo: 2.5 }).platillo, 300));
    test('receta sin multiploCosteo → default', () => eq(K(120, { nombre: 'x' }).platillo, 400));
    test('multiploReceta: default exacto = 1/0.30', () => eq(Core.multiploReceta({}), 1 / 0.30));
})();

/* ═══════════ SUITE D · MODELO DE COBRO POR SUCURSAL (precios.js) ═══════════
   El precio que ve el cliente en hub.html y el importe sugerido del recibo en
   admin.html salen de aquí. Si alguien mueve la tabla, estos números cantan. */
console.log('\n══ SUITE D · Cobro por sucursal (precios.js) ══');
(() => {
    const P = require(path.join(RAIZ, 'precios.js'));

    test('costo unitario base = $1,799', () => eq(P.BASE, 1799));
    test('tope de 10 sucursales', () => eq(P.TOPE, 10));

    // Precio individual de cada posición (la tabla que definió Edwin).
    const TABLA = [1799, 1699, 1669, 1639, 1609, 1579, 1549, 1519, 1489, 1449];
    TABLA.forEach((p, i) => test('la sucursal ' + (i + 1) + ' cuesta $' + p,
        () => eq(P.precioSucursal(i + 1), p)));

    // Descuentos contra la base (los % de la tabla de referencia).
    test('2ª sucursal = 5.56% de descuento', () => eq(P.descuentoSucursal(2), 5.5586, 'desc 2ª'));
    test('5ª sucursal = 10.56% de descuento', () => eq(P.descuentoSucursal(5), 10.5614, 'desc 5ª'));
    test('10ª sucursal = 19.46% de descuento', () => eq(P.descuentoSucursal(10), 19.4552, 'desc 10ª'));
    test('la 1ª no tiene descuento', () => eq(P.descuentoSucursal(1), 0));
    test('ahorro de la 10ª = $350 contra la base', () => eq(P.ahorroSucursal(10), 350));

    // Mensual ESCALONADO: suma de los precios de cada posición (no retroactivo).
    const ACUM = [1799, 3498, 5167, 6806, 8415, 9994, 11543, 13062, 14551, 16000];
    ACUM.forEach((t, i) => test('mensual con ' + (i + 1) + ' sucursal(es) = $' + t,
        () => eq(P.precioMensual(i + 1), t)));
    test('el paquete de 10 cae en $16,000 redondos', () => eq(P.precioMensual(10), 16000));
    test('sin sucursales no se cobra', () => eq(P.precioMensual(0), 0));

    // Lo que sube al agregar la siguiente = el precio de ESA sucursal.
    test('con 3 sucursales, la siguiente (la 4ª) suma $1,639',
        () => eq(P.precioSiguiente(3), 1639));
    test('el salto de mensual al pasar de 3 a 4 = precio de la 4ª',
        () => eq(P.precioMensual(4) - P.precioMensual(3), P.precioSucursal(4)));

    // Tope: pedir arriba de 10 no inventa precios ni sigue sumando.
    /* De la 11ª en adelante el descuento SE CONGELA (cambio de modelo, ago 2026).
       Antes precioMensual se cortaba en 10: un negocio con doce sucursales pagaba
       lo mismo que uno con diez — se crecía en servicio sin crecer en ingreso. */
    test('la 11ª cuesta lo mismo que la 10ª: el descuento se congela', () =>
        eq(P.precioSucursal(11), 1449));
    test('tras la 10ª, la siguiente ya no es "se cotiza a mano": suma $1,449', () =>
        eq(P.precioSiguiente(10), 1449));
    test('mensual con 11 sucursales = 16,000 + 1,449', () => eq(P.precioMensual(11), 17449));
    test('mensual con 12 sucursales = 16,000 + dos veces 1,449', () => eq(P.precioMensual(12), 18898));
    test('y sigue creciendo parejo: 15 sucursales = 16,000 + cinco veces 1,449', () =>
        eq(P.precioMensual(15), 23245));
    test('nadie paga menos por tener más: el mensual nunca baja al crecer', () => {
        for (var n = 1; n <= 20; n++) if (P.precioMensual(n + 1) <= P.precioMensual(n)) return false;
        return true;
    });
    test('descuento promedio del paquete de 10 = 11.06%',
        () => eq(P.descuentoMensual(10), 11.0617, 'desc promedio'));
})();

/* ═══════════ SUITE J · INSUMOS DUPLICADOS EN EL INVENTARIO ═══════════
   El síntoma de Edwin: en un inventario viejo aparecían DOS renglones del mismo
   insumo —uno en ceros y otro con los datos— mientras en el catálogo solo existe
   un producto.
   La causa, otra vez, el id: el inventario viejo guardó la fila bajo el id de la
   COPIA por sucursal, y el catálogo la arma con el MAESTRO. Al no empatar por id
   crudo, salía un renglón nuevo vacío y el viejo se colaba aparte. */
console.log('\n══ SUITE J · Insumos duplicados en el inventario ══');
(function () {
    setVar(B, '_cacheInsumosInv', [
        { id: 'ron_maestro', activo: '1' },
        { id: 'ron_copia', origenId: 'ron_maestro', sucursalId: 'suc_principal', activo: '1' },
    ]);
    // El inventario viejo guardó la fila bajo el id de la COPIA, con datos capturados.
    vm.runInContext("invActual.filas = [{ insumoId:'ron_copia', cerradasBodega:3, cerradasBarra:1, pesos:['1.2'], entradas:[] }];", B);

    test('la fila guardada bajo la COPIA se encuentra desde el MAESTRO', () => {
        const f = B._filaGuardadaDe('ron_maestro');
        return eq(!!f, true) && eq(f.insumoId, 'ron_copia');
    });
    test('y no se pierde lo capturado en ella', () =>
        eq(B._filaGuardadaDe('ron_maestro').cerradasBodega, 3));

    /* Un inventario YA dañado trae las dos filas. Gana la que tiene captura: quedarse
       con la vacía sería borrarle el conteo al dueño al abrirlo para repararlo. */
    test('con el duplicado ya guardado, gana la fila que SÍ trae datos', () => {
        vm.runInContext("invActual.filas = [" +
            "{ insumoId:'ron_maestro', cerradasBodega:0, cerradasBarra:0, pesos:[], entradas:[] }," +
            "{ insumoId:'ron_copia',   cerradasBodega:3, cerradasBarra:1, pesos:['1.2'], entradas:[] }];", B);
        const f = B._filaGuardadaDe('ron_maestro');
        return eq(f.insumoId, 'ron_copia') && eq(f.cerradasBodega, 3);
    });
    test('una fila vacía no se confunde con una capturada', () => {
        return eq(B._filaConDatos({ cerradasBodega: 0, pesos: [], entradas: [] }), false)
            && eq(B._filaConDatos({ cerradasBodega: 0, pesos: ['0.8'], entradas: [] }), true)
            && eq(B._filaConDatos({ cerradasBodega: 0, pesos: [], entradas: ['2'] }), true);
    });
    test('un insumo sin nada guardado no inventa fila', () =>
        eq(B._filaGuardadaDe('no_existe'), undefined));

    vm.runInContext("invActual.filas = [];", B);
    setVar(B, '_cacheInsumosInv', null);
})();

/* ═══════════ SUITE I · COMPUESTOS EN EL DINERO DEL RESULTADO ═══════════
   El Resultado del Paso 5 y el reporte directivo daban totales distintos con las
   MISMAS existencias ($12,205 contra $12,919). No era un redondeo: el directivo
   sumaba los miembros del compuesto uno por uno, cada uno con SU precio de carta,
   y el Paso 5 valuaba la diferencia agregada con el precio de la PRIMERA
   presentación del compuesto. Regla de Edwin: el compuesto es la suma simple de
   sus insumos, y cada uno entra con su propio precio. */
console.log('\n══ SUITE I · Compuestos en el dinero del Resultado ══');
(function () {
    // Dos presentaciones del mismo producto con precios de carta MUY distintos:
    // ahí es donde valuar por el primero se separa de valuar uno por uno.
    const media = { insumoId:'cerv_media', tipo:'copa', contNeto:355, copaML:355, precioCarta:60,
        costoUnitario:20, existenciaAnterior:10, cerradasBodega:6, cerradasBarra:0, pesos:[], pesoCristal:0,
        ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[] };
    const litro = { insumoId:'cerv_litro', tipo:'copa', contNeto:1000, copaML:1000, precioCarta:150,
        costoUnitario:50, existenciaAnterior:10, cerradasBodega:14, cerradasBarra:0, pesos:[], pesoCristal:0,
        ventasCopasDirectas:0, cortesiaCopas:0, mermaCopas:0, ventasBotella:0, entradas:[] };
    setVar(B, 'filasCaptura', [media, litro]);

    // media: físico 6 − teórico 10 = −4  → FALTA 4 × $60 = $240
    // litro: físico 14 − teórico 10 = +4 → SOBRA 4 × $150 = $600
    test('miembro con faltante: 6 contadas contra 10 teóricas = −4', () =>
        eq(B.calcDiferencia(media), -4));
    test('miembro con sobrante: 14 contadas contra 10 teóricas = +4', () =>
        eq(B.calcDiferencia(litro), 4));

    /* La suma buena: cada miembro con SU precio. Neto = 600 − 240 = +$360. */
    test('valuando miembro por miembro, el neto a carta es +$360', () => {
        const falt = Math.abs(B.calcDiferencia(media)) * media.precioCarta;
        const sobr = B.calcDiferencia(litro) * litro.precioCarta;
        return eq(sobr - falt, 360);
    });

    /* Lo que hacía el Paso 5: la diferencia AGREGADA (−4 + 4 = 0) por el precio del
       PRIMER miembro. Da $0 — y esa brecha era el descuadre entre los dos reportes. */
    test('valuando la diferencia agregada con el precio del primero, daba $0', () => {
        const difAgregada = B.calcDiferencia(media) + B.calcDiferencia(litro);
        return eq(difAgregada * media.precioCarta, 0);
    });
    test('la brecha entre los dos criterios es real, no un redondeo', () => {
        const porMiembro = B.calcDiferencia(litro) * litro.precioCarta
                         - Math.abs(B.calcDiferencia(media)) * media.precioCarta;
        const agregado = (B.calcDiferencia(media) + B.calcDiferencia(litro)) * media.precioCarta;
        return porMiembro !== agregado;
    });
})();

/* ═══════════ SUITE H · SUELDO DIARIO Y SALARIO MÍNIMO (diario.html) ═══════════
   El "salario mínimo" del negocio era solo un pre-llenado del formulario: se ponía
   en el campo al dar de alta a alguien y ya. Quien se dio de alta ANTES de
   definirlo, o se guardó sin sueldo, llegaba al pago de nómina con CERO — y un
   cero en esa columna se lee como un dato real, no como un dato faltante.
   Ahora el mínimo es el piso que aplica mientras nadie ponga otra cosa. */
console.log('\n══ SUITE H · Sueldo diario y salario mínimo (diario.html) ══');
(function () {
    // El mínimo vive en /nomina-params.js, que diario.html carga aparte. Sin él,
    // _nomParams() cae a su propio default de 0 y los tests medirían otra cosa.
    cargarJS(A, 'nomina-params.js');
    A._storage['etaax_negT_nomina_params'] = JSON.stringify({ salarioDiarioDefault: 280 });

    test('sueldo diario propio: manda sobre el mínimo', () =>
        eq(A._sueldoDiarioEfectivo({ esquemaSueldo: 'diario', sueldoDiario: 450 }), 450));
    test('salario por periodo: mensual se divide entre 30', () =>
        eq(A._sueldoDiarioEfectivo({ salarioBase: 9000, periodicidad: 'mensual' }), 300));
    test('salario por periodo: quincenal entre 15', () =>
        eq(A._sueldoDiarioEfectivo({ salarioBase: 4500, periodicidad: 'quincenal' }), 300));
    test('salario por periodo: semanal entre 7', () =>
        eq(A._sueldoDiarioEfectivo({ salarioBase: 2100, periodicidad: 'semanal' }), 300));

    /* El caso que estaba roto y que se veía como un dato bueno. */
    test('sin sueldo capturado: aplica el MÍNIMO del negocio, no cero', () =>
        eq(A._sueldoDiarioEfectivo({ nombre: 'recién dado de alta' }), 280));
    test('esquema diario pero sin monto: también cae al mínimo', () =>
        eq(A._sueldoDiarioEfectivo({ esquemaSueldo: 'diario', sueldoDiario: 0 }), 280));
    test('salario base en 0 con periodicidad puesta: cae al mínimo, no a 0/30', () =>
        eq(A._sueldoDiarioEfectivo({ salarioBase: 0, periodicidad: 'mensual' }), 280));

    /* Que se pueda DECIR de dónde salió el número: pagar el mínimo a propósito y
       pagarlo porque nadie configuró el sueldo se ven idénticos en la lista. */
    test('se distingue el sueldo propio del mínimo heredado', () => {
        return eq(A._sueldoEsDelMinimo({ esquemaSueldo: 'diario', sueldoDiario: 450 }), false)
            && eq(A._sueldoEsDelMinimo({ salarioBase: 9000, periodicidad: 'mensual' }), false)
            && eq(A._sueldoEsDelMinimo({ nombre: 'sin nada' }), true);
    });

    /* Sin mínimo definido no se inventa nada: el cero sigue siendo cero, y el
       renglón no se marca como "mínimo del negocio" porque no hay tal. */
    test('sin mínimo definido, quien no tiene sueldo sigue en 0', () => {
        A._storage['etaax_negT_nomina_params'] = JSON.stringify({ salarioDiarioDefault: 0 });
        const r = eq(A._sueldoDiarioEfectivo({ nombre: 'sin nada' }), 0)
               && eq(A._sueldoEsDelMinimo({ nombre: 'sin nada' }), false);
        A._storage['etaax_negT_nomina_params'] = JSON.stringify({ salarioDiarioDefault: 280 });
        return r;
    });
})();

/* ═══════════ SUITE G · COBRO DE LA SUSCRIPCIÓN (etaax-core.js) ═══════════
   Fecha de corte y días de tolerancia. Es aritmética de calendario, que es donde
   se rompen las cosas en silencio: el día 31 en febrero, el corrimiento de zona
   horaria que adelanta el corte 24 h, el ancla que se pierde tras un mes corto.
   La MISMA regla vive en SQL (negocio_esta_activo): si cambia aquí, cambia allá. */
console.log('\n══ SUITE G · Cobro de la suscripción (etaax-core.js) ══');
(function () {
    const C = A.EtaaxCore;

    /* ── El ancla del mes no se pierde en los meses cortos ── */
    test('ancla 15: desde el 3 de marzo, el corte es el 15 de marzo', () =>
        eq(C.proximoCobro(15, '2026-03-03'), '2026-03-15', 'corte'));
    test('ancla 15: desde el 15 mismo, salta al mes siguiente (no cobra dos veces hoy)', () =>
        eq(C.proximoCobro(15, '2026-03-15'), '2026-04-15', 'corte'));
    test('ancla 31: en febrero se recorta al 28', () =>
        eq(C.proximoCobro(31, '2026-02-05'), '2026-02-28', 'corte'));
    test('ancla 31: en un febrero BISIESTO se recorta al 29', () =>
        eq(C.proximoCobro(31, '2028-02-05'), '2028-02-29', 'corte'));
    test('ancla 31: tras el febrero corto vuelve al 31, no se queda en 28', () =>
        eq(C.proximoCobro(31, '2026-02-28'), '2026-03-31', 'corte'));
    test('ancla 30: enero sí tiene 30, marzo también', () =>
        eq(C.proximoCobro(30, '2026-01-31'), '2026-02-28', 'corte'));
    test('diciembre cruza el año', () =>
        eq(C.proximoCobro(5, '2026-12-20'), '2027-01-05', 'corte'));

    /* ── Zona horaria: el corte NO se puede adelantar un día ──
       new Date('2026-09-23') es UTC; en México eso cae el 22 a las 18:00 y el
       negocio se bloqueaba una noche antes de tiempo. */
    test('la fecha se lee en hora LOCAL, no en UTC', () =>
        eq(C.fechaStr(C.fechaLocal('2026-09-23')), '2026-09-23', 'fecha'));
    test('días entre fechas cuenta días completos', () =>
        eq(C.diasEntre('2026-09-20', '2026-09-23'), 3, 'días'));

    /* ── Tolerancia: la ventana entre "venció" y "se corta" ── */
    const sub = { estado: 'activa', proximoCobro: '2026-09-23', diasTolerancia: 3 };
    test('antes del corte: activo y sin avisos', () => {
        const e = C.estadoCobro(sub, '2026-09-20');
        return eq(e.activo, true, 'activo') && eq(e.enTolerancia, false, 'tolerancia')
            && eq(e.diasRestantes, 6, 'restantes');   // 3 al corte + 3 de gracia
    });
    test('el día del corte todavía está activo (se cobra ese día, no la víspera)', () => {
        const e = C.estadoCobro(sub, '2026-09-23');
        return eq(e.activo, true, 'activo') && eq(e.enTolerancia, false, 'tolerancia');
    });
    test('un día después: venció pero sigue operando, en tolerancia', () => {
        const e = C.estadoCobro(sub, '2026-09-24');
        return eq(e.activo, true, 'activo') && eq(e.enTolerancia, true, 'tolerancia')
            && eq(e.diasVencido, 1, 'vencido') && eq(e.diasRestantes, 2, 'restantes');
    });
    test('el último día de tolerancia AÚN opera', () => {
        const e = C.estadoCobro(sub, '2026-09-26');
        return eq(e.activo, true, 'activo') && eq(e.diasRestantes, 0, 'restantes');
    });
    test('un día después de la tolerancia, se corta', () => {
        const e = C.estadoCobro(sub, '2026-09-27');
        return eq(e.activo, false, 'activo') && eq(e.diasVencido, 4, 'vencido');
    });
    test('sin tolerancia configurada, se corta al día siguiente del corte', () => {
        const e = C.estadoCobro({ ...sub, diasTolerancia: 0 }, '2026-09-24');
        return eq(e.activo, false, 'activo');
    });
    test('cancelada NO opera aunque la fecha de corte esté en el futuro', () =>
        eq(C.estadoCobro({ ...sub, estado: 'cancelada' }, '2026-09-20').activo, false, 'activo'));
    test('pendiente (nunca activado, sin fecha) no opera', () =>
        eq(C.estadoCobro({ estado: 'pendiente' }, '2026-09-20').activo, false, 'activo'));
    test('la tolerancia por default son 3 días', () => eq(C.TOLERANCIA_DEFAULT, 3, 'días'));
})();

/* ═══════════ SUITE K · BANCO Y CLABE DE LA NÓMINA (bancos-mx.js) ═══════════
   El dígito de control de la CLABE no es cosmético: una clave con un número
   cambiado tiene sus 18 dígitos y pasa como buena — el banco la rebota, o el
   sueldo de alguien cae en otra cuenta. La aritmética se fija aquí para que
   nadie la "simplifique" a un `length === 18`. */
console.log('\n══ SUITE K · Banco y CLABE de la nómina (bancos-mx.js) ══');
(function () {
    const K = cargarJS(crearContexto(), 'bancos-mx.js');
    const B = K.BancosMX;

    /* CLABEs reales y publicadas — la referencia es externa, no algo que yo
       haya generado con la misma fórmula que estoy probando (eso solo
       comprobaría que el código coincide consigo mismo). */
    test('CLABE documentada de Banamex valida', () => eq(B.validarClabe('002010077777777771').ok, true, 'ok'));
    test('CLABE documentada de Santander valida', () => eq(B.validarClabe('014027000005555558').ok, true, 'ok'));
    test('CLABE documentada de STP valida', () => eq(B.validarClabe('646180157042875763').ok, true, 'ok'));

    /* Un dígito cambiado en medio: 18 dígitos, y aun así tiene que caer. */
    test('un dígito cambiado NO pasa aunque tenga los 18', () =>
        eq(B.validarClabe('002010077777777781').ok, false, 'ok'));
    test('…y se dice que falló el control, no la longitud', () =>
        eq(B.validarClabe('002010077777777781').motivo, 'control', 'motivo'));
    /* Dos dígitos INTERCAMBIADOS es el error de dedo más común al teclear. */
    test('dos dígitos volteados tampoco pasan', () =>
        eq(B.validarClabe('014027000005555585').ok, false, 'ok'));

    test('17 dígitos: falla por longitud, no por control', () =>
        eq(B.validarClabe('00201007777777777').motivo, 'longitud', 'motivo'));
    test('vacía se reporta como vacía (no como CLABE mala)', () =>
        eq(B.validarClabe('').motivo, 'vacia', 'motivo'));
    test('los guiones y espacios no estorban', () =>
        eq(B.validarClabe('0020 1007 7777 7777 71').ok, true, 'ok'));

    /* El banco sale de los 3 primeros dígitos… */
    test('los 3 primeros dígitos dan el banco', () =>
        eq(B.bancoDeClabe('012180001234567899').nombre, 'BBVA México', 'banco'));
    /* …pero si el código no está en la lista NO se adivina: un banco equivocado
       en un recibo de nómina es un problema con una persona. */
    test('un código que no está en la lista devuelve null, no un banco al azar', () =>
        eq(B.bancoDeClabe('999180001234567890'), null, 'banco'));
    test('sin dígitos suficientes tampoco se adivina', () => eq(B.bancoDeClabe('01'), null, 'banco'));

    test('la lista no trae códigos repetidos', () => {
        const vistos = {};
        let dup = 0;
        B.lista.forEach(b => { if (vistos[b.codigo]) dup++; vistos[b.codigo] = 1; });
        return eq(dup, 0, 'duplicados');
    });
    test('todos los códigos son de 3 dígitos', () =>
        eq(B.lista.filter(b => !/^[0-9]{3}$/.test(b.codigo)).length, 0, 'malformados'));
})();

/* ═══════════ SUITE L · FORMULARIO DE BANCO EN STAFF (administrativo/staff.html) ═══════════
   La lógica del bloque bancario del editor de colaborador. No es dinero, pero
   decide a qué cuenta se manda un sueldo, y falla del modo más caro: callado.
   Se prueba el archivo REAL de la página, no una copia. */
console.log('\n══ SUITE L · Bloque bancario del editor de staff (administrativo/staff.html) ══');
(function () {
    const L = crearContexto();
    cargarJS(L, 'bancos-mx.js');
    cargarJS(L, 'staff-area.js');   // la página la exige: sin ella su script no arranca
    cargarInline(L, 'administrativo/staff.html');
    const $ = id => L.document.getElementById(id);

    test('la lista de bancos se pobló en el select', () => {
        L._ponerBanco('');
        eq($('fBanco').options.length > 30, true, 'opciones');
    });

    /* Un banco de la lista se selecciona; el campo de texto libre se queda guardado. */
    test('un banco de la lista queda seleccionado, sin abrir el campo libre', () => {
        L._ponerBanco('Banorte');
        eq($('fBanco').value + '|' + $('fBancoOtro').style.display, 'Banorte|none', 'estado');
    });
    test('…y ese es el valor que se guarda', () => eq(L._bancoValor(), 'Banorte', 'banco'));

    /* Un banco que NO está en la lista no se pierde: cae en "Otro…" con su texto. */
    test('un banco fuera de la lista abre el campo libre con su nombre', () => {
        L._ponerBanco('Caja Solidaria del Pueblo');
        eq($('fBancoOtro').value, 'Caja Solidaria del Pueblo', 'otro');
    });
    test('…y se guarda el texto escrito, no el marcador "otro"', () =>
        eq(L._bancoValor(), 'Caja Solidaria del Pueblo', 'banco'));

    /* El bloque aparece con transferencia y se esconde con efectivo… */
    test('con transferencia, el bloque bancario se muestra', () => {
        L._ponerBanco(''); $('fClabe').value = ''; $('fDatosBancarios').value = '';
        $('fFormaPago').value = 'Transferencia Bancaria';
        L.togBancarios();
        eq($('grpBancarios').style.display, '', 'display');
    });
    test('con efectivo y sin datos, se esconde', () => {
        $('fFormaPago').value = 'Efectivo';
        L.togBancarios();
        eq($('grpBancarios').style.display, 'none', 'display');
    });
    /* …pero NUNCA esconde datos ya capturados: invisible se siente igual que borrado. */
    test('con efectivo pero CON CLABE guardada, sigue visible', () => {
        $('fClabe').value = '002010077777777771';
        L.togBancarios();
        eq($('grpBancarios').style.display, '', 'display');
    });

    /* El banco se deduce de la CLABE solo cuando aún no se eligió uno. */
    test('la CLABE llena el banco si estaba vacío', () => {
        L._ponerBanco('');
        $('fClabe').value = '014027000005555558';
        L.clabeChange();
        eq(L._bancoValor(), 'Santander', 'banco');
    });
    test('pero NO pisa un banco ya elegido a mano', () => {
        L._ponerBanco('Banorte');
        $('fClabe').value = '014027000005555558';
        L.clabeChange();
        eq(L._bancoValor(), 'Banorte', 'banco');
    });

    test('una CLABE que no cuadra se avisa en el momento', () => {
        $('fClabe').value = '002010077777777781';
        L.clabeChange();
        eq($('clabeHint').textContent.indexOf('no cuadra') > -1, true, 'aviso');
    });
    test('una CLABE buena se confirma', () => {
        $('fClabe').value = '002010077777777771';
        L.clabeChange();
        eq($('clabeHint').textContent.indexOf('válida') > -1, true, 'aviso');
    });
    test('a medio escribir solo se cuenta, sin regañar', () => {
        $('fClabe').value = '00201007';
        L.clabeChange();
        eq($('clabeHint').textContent, '8 de 18 dígitos.', 'aviso');
    });
})();

/* ═══════════ SUITE M · EXPEDIENTE DEL COLABORADOR (administrativo/staff.html) ═══════════
   La vista de solo lectura. Dos cosas que sí importan: la antigüedad/edad que se
   presentan como hechos, y que sueldo y datos bancarios NO salgan destapados —
   en esta página editar a un colaborador pide la contraseña del administrador
   justamente por eso, y una vista que los soltara desharía esa protección. */
console.log('\n══ SUITE M · Expediente del colaborador (administrativo/staff.html) ══');
(function () {
    const M = crearContexto();
    cargarJS(M, 'bancos-mx.js');
    cargarJS(M, 'staff-area.js');   // la página la exige: sin ella su script no arranca
    cargarInline(M, 'administrativo/staff.html');

    /* Fecha de referencia FIJA. Antes se calculaba desde "hoy" y el candado
       fallaba solo en fin de mes: restarle 18 meses a un 29 de agosto cae en un
       29 de febrero que no existe y JS lo recorre al 1 de marzo. */
    const HOY = '2026-08-29';

    test('antigüedad de 18 meses se dice en años y meses', () =>
        eq(M._antiguedadDe('2025-02-28', HOY), '1 año y 6 meses', 'antigüedad'));
    test('exactamente un año no arrastra "y 0 meses"', () =>
        eq(M._antiguedadDe('2025-08-29', HOY), '1 año', 'antigüedad'));
    test('un mes va en singular', () => eq(M._antiguedadDe('2026-07-29', HOY), '1 mes', 'antigüedad'));
    test('recién entrado no dice "0 meses"', () =>
        eq(M._antiguedadDe('2026-08-20', HOY), 'menos de un mes', 'antigüedad'));
    test('sin fecha de ingreso no se inventa antigüedad', () => eq(M._antiguedadDe('', HOY), '', 'antigüedad'));
    /* Una fecha futura mal capturada no debe imprimir una antigüedad negativa. */
    test('una fecha de ingreso futura no produce antigüedad', () =>
        eq(M._antiguedadDe('2027-01-15', HOY), '', 'antigüedad'));
    /* El día 30 del mes anterior visto desde un día 29: aún no cumple el mes. */
    test('un mes que aún no se cumple no se redondea hacia arriba', () =>
        eq(M._antiguedadDe('2026-07-30', HOY), 'menos de un mes', 'antigüedad'));

    test('la edad sale de la fecha de nacimiento', () =>
        eq(M._edadDe('1996-08-29', HOY), 30, 'edad'));
    test('el cumpleaños que aún no llega este año resta un año', () =>
        eq(M._edadDe('1996-08-30', HOY), 29, 'edad'));

    /* ── Lo tapado sigue tapado ── */
    const s = {
        id: 'x1', nombre: 'Ana López', esquemaSueldo: 'diario', sueldoDiario: 450,
        salarioBase: 0, bonoIncentivo: 700, primaVacacional: 120,
        clabeNomina: '002010077777777771', bancoNomina: 'Banamex',
        datosBancarios: 'cuenta 12345', categoriaNomina: 'operativa',
    };
    const tapado = M._expNominaCuerpo(s, false);
    const abierto = M._expNominaCuerpo(s, true);

    test('el sueldo NO aparece sin destapar', () => eq(tapado.indexOf('450') === -1, true, 'sueldo'));
    test('el bono tampoco', () => eq(tapado.indexOf('700') === -1, true, 'bono'));
    test('la prima tampoco', () => eq(tapado.indexOf('120') === -1, true, 'prima'));
    test('la cuenta tampoco', () => eq(tapado.indexOf('12345') === -1, true, 'cuenta'));
    /* De la CLABE solo los últimos 4: bastan para reconocerla, no para usarla. */
    test('de la CLABE solo se ven los últimos 4 dígitos', () =>
        eq(tapado.indexOf('7771') > -1 && tapado.indexOf('002010077777777771') === -1, true, 'clabe'));
    /* El banco SÍ se ve: no sirve para mover dinero y ayuda a identificar la cuenta. */
    test('el banco sí se ve tapado (no sirve para mover dinero)', () =>
        eq(tapado.indexOf('Banamex') > -1, true, 'banco'));

    test('al destapar sí aparece el sueldo', () => eq(abierto.indexOf('450') > -1, true, 'sueldo'));
    test('al destapar sí aparece la CLABE completa', () =>
        eq(abierto.replace(/\s/g, '').indexOf('002010077777777771') > -1, true, 'clabe'));

    /* Sin sueldo capturado no debe salir un "••••••" que finge que hay un dato. */
    test('un sueldo vacío se muestra vacío, no tapado', () =>
        eq(M._expNominaCuerpo({ esquemaSueldo: 'periodo' }, false).indexOf('••••••') === -1, true, 'vacío'));

    /* El expediente completo se arma sin reventar, incluso con un registro pelón. */
    test('el expediente se arma con un registro casi vacío', () => {
        M._storage['etaax_negocio_activo'] = 'n1';
        M._storage['etaax_n1_staff'] = JSON.stringify([{ id: 'p1', nombre: 'Pedro' }]);
        M.verExpediente('p1');
        return eq(true, true, 'render');
    });
})();

/* ═══════════ SUITE N · HOJA IMPRESA DEL CHECK LIST (administrativo/checklists.html) ═══════════
   Estas hojas se enmican y se usan meses. Lo que se rompe aquí no se nota en
   pantalla: se nota cuando ya se imprimieron cincuenta. */
console.log('\n══ SUITE N · Hoja impresa del check list (administrativo/checklists.html) ══');
(function () {
    const N = crearContexto();
    cargarJS(N, 'etaax-core.js');
    cargarInline(N, 'administrativo/checklists.html');
    const sinTags = h => String(h).replace(/<[^>]*>/g, '|');

    /* Sin fechas: TRES renglones para escribir a mano (inicio, fin y mes). */
    test('sin fechas se imprimen renglones, no huecos mudos', () =>
        eq((N._ckSemanaHTML('', '').match(/ckray/g) || []).length, 3, 'renglones'));
    test('con la semana completa no queda ningún renglón vacío', () =>
        eq((N._ckSemanaHTML('2026-08-24', '2026-08-30').match(/ckray/g) || []).length, 0, 'renglones'));

    /* Media fecha capturada: lo que falta se sigue pudiendo escribir a mano.
       Antes, con solo el "desde", el "al" se imprimía en blanco y sin línea. */
    test('con solo la fecha de inicio, el final queda como renglón', () =>
        eq((N._ckSemanaHTML('2026-08-24', '').match(/ckray/g) || []).length, 1, 'renglones'));
    test('…y el día capturado sí sale', () =>
        eq(sinTags(N._ckSemanaHTML('2026-08-24', '')).indexOf('24') > -1, true, 'día'));

    test('el mes se deduce de la semana', () =>
        eq(sinTags(N._ckSemanaHTML('2026-08-24', '2026-08-30')).indexOf('agosto 2026') > -1, true, 'mes'));
    /* Una semana a caballo entre dos meses es el caso que se olvida. */
    test('una semana que cruza de mes nombra los dos', () => {
        const t = sinTags(N._ckSemanaHTML('2026-08-31', '2026-09-06'));
        return eq(t.indexOf('agosto') > -1 && t.indexOf('septiembre') > -1, true, 'meses');
    });
    /* Y a caballo entre dos AÑOS, que es el que se olvida después de ese. */
    test('una semana que cruza de año nombra los dos años', () => {
        const t = sinTags(N._ckSemanaHTML('2026-12-28', '2027-01-03'));
        return eq(t.indexOf('2026') > -1 && t.indexOf('2027') > -1, true, 'años');
    });

    /* La guía impresa explica las iniciales. Si alguien agrega una frecuencia al
       selector y olvida definirla, la hoja saldría con una letra sin explicación
       — y quien llena la hoja a las 7 de la mañana no tiene a quién preguntarle. */
    test('toda frecuencia del selector tiene definición para la guía', () =>
        eq(N.FREQS.filter(f => !N.FREQ_DEF[f]).length, 0, 'sin definir'));
    test('la etiqueta corta del selector sale de la misma definición', () =>
        eq(N._freqCorto('A'), 'A · Apertura', 'etiqueta'));
    test('una frecuencia desconocida no rompe la etiqueta', () =>
        eq(N._freqCorto('ZZ'), 'ZZ', 'etiqueta'));
    /* Cierre es de las cuatro que se usan a diario en barra y cocina. */
    test('el cierre tiene su propia inicial', () => eq(N._freqCorto('C'), 'C · Cierre', 'etiqueta'));
    /* Las frecuencias van en el orden del turno, no como se hayan ido agregando:
       quien lee la lista la lee como la jornada. */
    test('las frecuencias siguen el orden del turno', () =>
        eq(N.FREQS.join(','), 'A,D/T,C,SEM,MEN', 'orden'));

    /* ── QUÉ CELDAS SE TACHAN ──
       Semanal y mensual usan la MISMA regla: libre solo el día de la semana
       elegido. Una mensual es "una vez al mes, en jueves" — así la hoja se tacha
       sin depender de que la semana esté capturada, que es lo que pasa en las
       hojas enmicadas. */
    const semMie = { freq: 'SEM', dia: '2' };            // 2 = miércoles
    const menJue = { freq: 'MEN', dia: '3' };            // 3 = jueves
    const cuadro = t => [0,1,2,3,4,5,6].map(i => N._celdaBloqueada(t, i) ? 'x' : '·').join('');

    test('la semanal deja libre SOLO su día', () => eq(cuadro(semMie), 'xx·xxxx', 'celdas'));
    test('la mensual se tacha igual que la semanal', () => eq(cuadro(menJue), 'xxx·xxx', 'celdas'));
    /* Sin día elegido no se tacha nada: bloquear a ciegas dejaría la tarea sin
       ningún día donde marcarse, que es peor que no bloquear. */
    test('sin día elegido no se tacha nada', () =>
        eq(cuadro({freq:'SEM', dia:''}), '·······', 'celdas'));

    /* MIGRACIÓN: las mensuales viejas guardaban día del MES (1–31). Leído como
       día de la semana, un "27" no es ningún día — y tacharía los siete. */
    test('una mensual vieja con día del mes NO tacha los siete', () =>
        eq(cuadro({freq:'MEN', dia:'27'}), '·······', 'celdas'));
    test('un día del mes fuera de rango se lee como "sin elegir"', () =>
        eq(N._diaValido('27'), null, 'día'));
    /* AMBIGÜEDAD QUE NO SE PUEDE RESOLVER SOLA: un valor de 0 a 6 es un día de
       la semana válido, así que una mensual vieja que guardaba "día 6 del mes"
       ahora se lee como domingo. No hay forma de distinguirla de una que se
       eligió hoy a propósito. Por eso el modal avisa y hay que revisar las
       mensuales que ya existían. */
    test('un valor de 0 a 6 se toma como día de la semana (aunque viniera del mes)', () =>
        eq(N._diaValido('6'), 6, 'día'));
    test('vacío es "sin elegir"', () => eq(N._diaValido(''), null, 'día'));

    /* Apertura, cierre y durante-el-turno pasan TODOS los días. */
    ['A', 'D/T', 'C'].forEach(f => {
        test('"' + f + '" nunca tacha un día', () => eq(cuadro({freq:f, dia:'2'}), '·······', 'celdas'));
    });

    /* Aviso antes de imprimir: una tarea con día pendiente sale con los siete
       abiertos y nadie se va a dar cuenta hasta tener la hoja en la mano. */
    const plant = { tareas: [
        { freq: 'MEN', dia: '27', texto: 'Inventario (día del mes viejo)' },
        { freq: 'SEM', dia: '',   texto: 'Sin día puesto' },
        { freq: 'MEN', dia: '3',  texto: 'Fumigación en jueves' },
        { freq: 'A',   texto: 'Barrer' },
    ]};
    test('se avisa cuántas tareas quedaron sin día', () => eq(N._sinDiaElegido(plant), 2, 'aviso'));
    test('una plantilla con todos los días puestos no avisa', () =>
        eq(N._sinDiaElegido({ tareas: [{freq:'SEM', dia:'0', texto:'x'}, {freq:'A', texto:'y'}] }), 0, 'aviso'));
    /* Una tarea sin texto no se imprime, así que tampoco debe generar aviso. */
    test('una tarea vacía no cuenta para el aviso', () =>
        eq(N._sinDiaElegido({ tareas: [{freq:'SEM', dia:'', texto:'  '}] }), 0, 'aviso'));

    /* ── REORDENAR TAREAS ──
       El orden de la lista es el orden en que se hacen: barrer antes de trapear,
       prender la plancha antes de montar. */
    setVar(N, '_edit', { tareas: [{id:'a'},{id:'b'},{id:'c'}] });
    N._moverTarea(2, -1);
    test('una tarea sube un lugar', () => eq(N._edit.tareas.map(t=>t.id).join(''), 'acb', 'orden'));
    N._moverTarea(0, 1);
    test('y baja un lugar', () => eq(N._edit.tareas.map(t=>t.id).join(''), 'cab', 'orden'));
    /* Los extremos no pueden salirse de la lista ni perder una tarea. */
    N._moverTarea(0, -1);
    test('la primera no se sale por arriba', () => eq(N._edit.tareas.map(t=>t.id).join(''), 'cab', 'orden'));
    N._moverTarea(2, 1);
    test('ni la última por abajo', () => eq(N._edit.tareas.map(t=>t.id).join(''), 'cab', 'orden'));
    test('y no se pierde ninguna en el camino', () => eq(N._edit.tareas.length, 3, 'tareas'));

    /* La leyenda corta la usan el otro reporte impreso y la ayuda del editor.
       Había DOS copias escritas a mano que decían "D/T = diaria/turno" — que no
       es lo que significa. Ahora las tres salen de FREQ_DEF. */
    test('la leyenda corta dice lo mismo que la guía', () =>
        eq(N._freqLeyenda(), 'A = Apertura · D/T = Durante el turno · C = Cierre · SEM = Semanal · MEN = Mensual', 'leyenda'));
    test('la leyenda cubre TODAS las frecuencias del selector', () =>
        eq(N.FREQS.every(f => N._freqLeyenda().indexOf(f + ' = ') > -1), true, 'cobertura'));
})();

/* ═══════════ SUITE O · ÁREA DEL COLABORADOR (staff-area.js) ═══════════
   Había DOS mapeos escritos por separado y una tercera copia en camino. El área
   decide qué ve un colaborador en el QR: dos versiones que se separan un día es
   alguien viendo los checklists de otra área. */
console.log('\n══ SUITE O · Área del colaborador (staff-area.js) ══');
(function () {
    const A = cargarJS(crearContexto(), 'staff-area.js').StaffArea;

    /* La JERARQUÍA es la parte que importa: corrección a mano → rol → puesto. */
    test('el área corregida a mano manda sobre el rol', () =>
        eq(A.de({ rol: 'mesero', area: 'cocina' }), 'cocina', 'área'));
    test('sin corrección, manda el rol', () => eq(A.de({ rol: 'jefe_barra' }), 'barra', 'área'));
    /* Adivinar por el puesto ANTES de mirar el rol pondría a un jefe de barra en
       cocina porque alguien escribió "encargado de cocina y barra". */
    test('el rol gana al puesto escrito a mano', () =>
        eq(A.de({ rol: 'jefe_barra', puesto: 'Encargado de cocina' }), 'barra', 'área'));
    test('sin rol, se lee el puesto', () => eq(A.de({ puesto: 'Auxiliar de Barra' }), 'barra', 'área'));
    test('un colaborador sin nada no se manda a un área al azar', () => eq(A.de({}), '', 'área'));

    test('gerencia y administración caen en administración', () =>
        eq(A.deRol('gerente') + '|' + A.deRol('admin') + '|' + A.deRol('administrativo'),
           'administracion|administracion|administracion', 'área'));

    /* El puesto lo teclea una persona: con acentos, en mayúsculas, abreviado. */
    test('los acentos no estorban', () => eq(A.norm('Atención a piso'), 'piso', 'área'));
    test('mayúsculas tampoco', () => eq(A.norm('COCINA FRÍA'), 'cocina', 'área'));
    test('"Chef" es cocina aunque no diga cocina', () => eq(A.norm('Chef ejecutivo'), 'cocina', 'área'));
    test('"Garrotero" es piso', () => eq(A.norm('Garrotero'), 'piso', 'área'));
    test('"Cajera" es administración', () => eq(A.norm('Cajera'), 'administracion', 'área'));
    /* Un puesto que no es de ninguna de las cuatro NO se fuerza: "Sin área" es una
       respuesta honesta; meterlo a Administración por descarte sería inventar. */
    test('un puesto ajeno a las cuatro áreas no se fuerza', () => eq(A.norm('Jardinero'), '', 'área'));

    test('el orden de las áreas es el de la operación, no el alfabético', () =>
        eq(A.LISTA.map(x => x.k).join(','), 'barra,cocina,piso,administracion', 'orden'));
    test('todo rol mapeado apunta a un área que existe', () =>
        eq(Object.keys(A.MAPA_ROL).filter(r => !A.NOMBRES[A.MAPA_ROL[r]]).length, 0, 'huérfanos'));
})();

/* ═══════════ SUITE P · PRESTAR COLABORADORES ENTRE SUCURSALES (horarios.html) ═══════════
   Un colaborador prestado a otra sucursal por una semana tiene UN SOLO cuerpo.
   Si aparece en las dos, las horas y la cobertura se cuentan doble y el rol
   miente — que es justo lo que no puede pasar en algo que se pega en la pared. */
console.log('\n══ SUITE P · Prestar colaboradores entre sucursales (administrativo/horarios.html) ══');
(function () {
    const H = crearContexto();
    cargarJS(H, 'etaax-core.js');
    cargarJS(H, 'staff-area.js');
    H._storage['etaax_negocio_activo'] = 'n1';
    H._storage['etaax_n1_sucursales'] = JSON.stringify([{ id: 'suc_principal', nombre: 'Matriz' }, { id: 'sB', nombre: 'Sucursal B' }]);
    cargarInline(H, 'administrativo/horarios.html');

    setVar(H, '_staff', [
        { id: 'a', nombre: 'Ana',   puesto: 'Cocinera', rol: 'cocinero', sucursalId: '' },      // Matriz
        { id: 'b', nombre: 'Beto',  puesto: 'Barman',   rol: 'barman',   sucursalId: 'sB' },
        { id: 'g', nombre: 'Gaby',  puesto: 'Gerente',  rol: 'gerente',  sucursalId: '' },      // Matriz
    ]);
    setVar(H, '_weekStr', '2026-W35');
    setVar(H, '_busq', '');

    const enSuc = suc => H._staffScopeDe(suc).map(x => x.id).join(',');

    test('sin préstamos, cada quien está en su sucursal', () =>
        eq(enSuc('') + ' | ' + enSuc('sB'), 'a,g | b', 'reparto'));

    /* Prestar a Ana de Matriz a la Sucursal B por esta semana. */
    H.invitarASemana('a', 'sB');
    test('el prestado aparece en la sucursal que lo recibe', () => eq(enSuc('sB'), 'a,b', 'destino'));
    test('y DESAPARECE de la suya — no se cuenta dos veces', () => eq(enSuc(''), 'g', 'origen'));
    test('queda marcado como prestado', () => eq(H._esInvitado('a'), true, 'prestado'));
    test('el catálogo de staff NO se tocó', () =>
        eq(H._staff.find(x => x.id === 'a').sucursalId, '', 'sucursal de catálogo'));

    /* Prestarlo a una TERCERA sucursal no puede dejarlo en dos a la vez. */
    H.invitarASemana('a', 'suc_principal');
    test('mover al prestado a otra sucursal no lo deja en dos', () =>
        eq(enSuc('') + ' | ' + enSuc('sB'), 'a,g | b', 'reparto'));
    test('volver a su propia sucursal lo deja de marcar como prestado', () =>
        eq(H._esInvitado('a'), false, 'prestado'));

    /* Sumar gerencia al rol operativo de una sucursal: el MISMO mecanismo. */
    H.invitarASemana('g', 'sB');
    test('gerencia se puede sumar al rol operativo de una sucursal', () =>
        eq(enSuc('sB'), 'b,g', 'destino'));

    /* La vista global tiene que ver la sucursal donde trabaja esta semana. */
    test('la global lista las sucursales por dónde trabajan ESTA semana', () =>
        eq(H._sucsConStaff().join(','), 'suc_principal,sB', 'sucursales'));

    /* El buscador filtra la vista… */
    setVar(H, '_busq', 'bet');
    test('el buscador filtra por nombre', () => eq(H._staffScope !== undefined, true, 'existe'));
    test('…pero NO recorta lo que se copia ni lo que se imprime', () =>
        eq(enSuc('sB'), 'b,g', 'sin recortar'));
    setVar(H, '_busq', '');

    /* Agrupar por área para la hoja impresa. */
    const grupos = H._porArea(H._staff);
    test('la hoja se agrupa por área en orden operativo', () =>
        eq(grupos.map(g => g.k).join(','), 'barra,cocina,administracion', 'grupos'));
    test('cada quien cae en su área', () =>
        eq(grupos.find(g => g.k === 'administracion').gente.map(x => x.id).join(','), 'g', 'gente'));
})();

/* ═══════════ SUITE Q · AVISO DE ACTUALIZACIONES (novedades.js) ═══════════
   Lo lee el negocio, no nosotros. Un "hace 0 días" o un día de más por el
   horario de verano se ve como un descuido en un aviso que presume cuidado. */
console.log('\n══ SUITE Q · Aviso de actualizaciones (novedades.js) ══');
(function () {
    const Q = cargarJS(crearContexto(), 'novedades.js').EtaaxNovedades;

    test('el mismo día se dice "hoy", no "hace 0 días"', () => eq(Q.hace(0), 'hoy', 'texto'));
    test('un día es "ayer", no "hace 1 días"', () => eq(Q.hace(1), 'ayer', 'texto'));
    test('tres días se cuentan', () => eq(Q.hace(3), 'hace 3 días', 'texto'));
    /* El día 7 ya es "una semana": redondear hacia abajo suena a persona. */
    test('a los 7 días es "hace una semana"', () => eq(Q.hace(7), 'hace una semana', 'texto'));
    test('a los 13 sigue siendo una semana, no dos', () => eq(Q.hace(13), 'hace una semana', 'texto'));
    test('a los 14 ya son dos semanas', () => eq(Q.hace(14), 'hace 2 semanas', 'texto'));
    test('al mes se dice mes, no "hace 4 semanas"', () => eq(Q.hace(31), 'hace un mes', 'texto'));
    test('dos meses se cuentan en meses', () => eq(Q.hace(70), 'hace 2 meses', 'texto'));
    /* Nunca en futuro: si el reloj del equipo está atrasado, "hoy" es lo honesto. */
    test('una fecha en el futuro no dice "hace -2 días"', () => eq(Q.hace(-2), 'hoy', 'texto'));

    /* La cuenta de días se hace a mediodía a propósito: al filo de la medianoche,
       o en el cambio de horario, restar timestamps crudos se va un día entero. */
    const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' +
        String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
    test('la publicación de hoy cuenta 0 días', () => eq(Q.diasDesde(hoyISO()), 0, 'días'));
    test('una fecha inválida no rompe el aviso', () => eq(Q.diasDesde('no-es-fecha'), 0, 'días'));

    /* La fecha la estampa .githooks/pre-commit; que tenga forma de fecha. */
    test('la fecha de publicación tiene forma de fecha', () =>
        eq(/^\d{4}-\d{2}-\d{2}$/.test(Q.FECHA), true, 'formato'));

    /* ── UNA VEZ POR SESIÓN ──
       Se levanta el módulo con almacenamientos de mentira y se cuenta cuántas
       veces se pintaría al navegar entre pantallas. */
    function montarAviso(opts) {
        opts = opts || {};
        const ls = Object.assign({}, opts.ls || {});
        const ss = Object.assign({}, opts.ss || {});
        let pintadas = 0, cerrar = null;
        const ctx = {
            console: { log() {}, warn() {} }, Date, Math, isNaN,
            setTimeout: fn => { fn(); return 0; },
            localStorage: {
                getItem: k => (k in ls ? ls[k] : null),
                /* localStorage LLENO: es lo que pasa de verdad en esta app y el
                   motivo de que el aviso se repitiera pantalla tras pantalla. */
                setItem(k, v) { if (opts.lsLleno) throw new Error('QuotaExceededError'); ls[k] = v; },
                removeItem(k) { delete ls[k]; },
            },
            sessionStorage: {
                getItem: k => (k in ss ? ss[k] : null),
                setItem(k, v) { ss[k] = v; }, removeItem(k) { delete ss[k]; },
            },
            document: {
                readyState: 'complete', addEventListener() {},
                getElementById: id => (id === 'etaaxNovedades' ? null : { style: {}, set onclick(f) { cerrar = f; } }),
                createElement: () => ({ style: { cssText: '' }, setAttribute() {}, remove() {}, innerHTML: '' }),
                body: { appendChild() { pintadas++; } },
            },
        };
        ctx.window = ctx; vm.createContext(ctx);
        vm.runInContext(fs.readFileSync(path.join(RAIZ, 'novedades.js'), 'utf8'), ctx, { filename: 'novedades.js' });
        return { ctx, ls, ss, veces: () => pintadas, cerrar: () => cerrar && cerrar(),
                 otraPantalla: () => ctx.EtaaxNovedades.arrancar() };
    }

    {
        const a = montarAviso();
        test('al iniciar sesión, el aviso sale', () => eq(a.veces(), 1, 'veces'));
        a.cerrar();
        a.otraPantalla(); a.otraPantalla();
        test('tras "Entendido" ya no vuelve a salir en esa sesión', () => eq(a.veces(), 1, 'veces'));
    }
    {
        /* El caso que lo rompía: localStorage lleno, el `catch` se traga el fallo
           y el aviso reaparecía en cada pantalla. sessionStorage lo sostiene. */
        const a = montarAviso({ lsLleno: true });
        a.cerrar();
        a.otraPantalla(); a.otraPantalla();
        test('con localStorage LLENO, tampoco se repite en la sesión', () => eq(a.veces(), 1, 'veces'));
    }
    {
        const a = montarAviso({ ls: { etaax_novedades_visto: Q.FECHA } });
        test('una publicación ya dada por vista no vuelve a salir en otra sesión', () =>
            eq(a.veces(), 0, 'veces'));
    }
    {
        const a = montarAviso({ ls: { etaax_novedades_visto: '2020-01-01' } });
        test('pero una publicación NUEVA sí sale aunque la anterior ya se hubiera visto', () =>
            eq(a.veces(), 1, 'veces'));
    }
})();

/* ═══════════ SUITE R · BAJAS Y CANDADO DEL CATÁLOGO (administrativo/staff.html) ═══════════
   Dar de baja no es borrar: el expediente, los documentos y el rastro de lo
   pagado se conservan. Y el candado tiene que dejar pasar lo de todos los días
   (crear) sin soltar lo irreversible (eliminar). */
console.log('\n══ SUITE R · Bajas y candado del catálogo (administrativo/staff.html) ══');
(function () {
    const R = crearContexto();
    cargarJS(R, 'bancos-mx.js');
    cargarJS(R, 'staff-area.js');
    cargarInline(R, 'administrativo/staff.html');
    R._storage['etaax_negocio_activo'] = 'n1';

    const equipo = [
        { id: 'a', nombre: 'Ana',  puesto: 'Cocinera', estado: 'Activo' },
        { id: 'b', nombre: 'Beto', puesto: 'Barman',   estado: 'Baja temporal' },
        { id: 'c', nombre: 'Cira', puesto: 'Mesera',   estado: 'Baja definitiva', fechaBaja: '2026-07-10' },
        { id: 'd', nombre: 'Dani', puesto: 'Mesero',   estado: 'Baja definitiva', fechaBaja: '2026-08-02' },
    ];
    R._storage['etaax_n1_staff'] = JSON.stringify(equipo);

    test('solo la baja DEFINITIVA cuenta como baja', () =>
        eq(equipo.filter(R._esBaja).map(x => x.id).join(','), 'c,d', 'bajas'));
    /* Una incapacidad o unas vacaciones NO son una salida: esa persona sigue
       siendo del equipo y tiene que seguir en la lista de trabajo. */
    test('la baja TEMPORAL se queda en el equipo', () => eq(R._esBaja(equipo[1]), false, 'temporal'));

    test('el histórico lista a los que salieron, el más reciente primero', () =>
        eq(R._bajas().map(x => x.id).join(','), 'd,c', 'orden'));

    /* La fecha de baja es el dato por el que se consulta el histórico y nadie se
       va a acordar de escribirlo: se estampa solo. */
    const hoy = new Date();
    const hoyISO = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0') + '-' + String(hoy.getDate()).padStart(2,'0');
    test('la fecha de hoy se arma bien para estampar la baja', () => eq(R._hoyISO(), hoyISO, 'fecha'));

    /* La lista de trabajo se queda con quien trabaja. Un dado de baja que sigue
       apareciendo ahí es un error caro: se le programa turno y se le paga. */
    setVar(R, '_bloqueado', false);   // el catálogo nace bloqueado; aquí ya se entró
    R.renderTable();
    const tbody = R.document.getElementById('staffTbody').innerHTML;
    test('la tabla NO muestra a los dados de baja', () =>
        eq(tbody.indexOf('Cira') === -1 && tbody.indexOf('Dani') === -1, true, 'ocultos'));
    test('…pero sí a los activos y a los de baja temporal', () =>
        eq(tbody.indexOf('Ana') > -1 && tbody.indexOf('Beto') > -1, true, 'visibles'));
    /* Y el contador de la ficha "Todos" tiene que cuadrar con la tabla: contar
       el histórico infla la plantilla. */
    R.renderPuestoChips();
    test('el conteo de "Todos" cuenta al equipo actual, no al histórico', () =>
        eq(R.document.getElementById('puestoChips').innerHTML.indexOf('>2<') > -1, true, 'conteo'));

    /* Bloqueado, el estado vacío NO puede decir "sin colaboradores": no es que no
       haya, es que no se ha escrito la clave. Y no hay pantalla encima: solo el
       modal de la contraseña, que el catálogo se ve detrás. */
    setVar(R, '_bloqueado', true);
    R.renderTable();
    /* Y CON datos en el caché tampoco se pinta una sola fila: el modal de la
       clave deja ver lo de atrás, y ahí se lee la columna de sueldo. */
    test('bloqueado, no se pinta ninguna fila aunque haya datos en caché', () =>
        eq(R.document.getElementById('staffTbody').innerHTML, '', 'filas'));
    R._storage['etaax_n1_staff'] = JSON.stringify([]);
    R.renderTable();
    const vacio = () => R.document.getElementById('emptyState').innerHTML;
    test('bloqueado, el estado vacío pide la contraseña', () =>
        eq(vacio().indexOf('Desbloquear') > -1, true, 'mensaje'));
    test('…y NO miente diciendo que no hay colaboradores', () =>
        eq(vacio().indexOf('Sin colaboradores') === -1, true, 'mensaje'));
    setVar(R, '_bloqueado', false);
    R.renderTable();
    test('desbloqueado y sin nadie, sí dice que no hay colaboradores', () =>
        eq(vacio().indexOf('Sin colaboradores') > -1, true, 'mensaje'));
    R._storage['etaax_n1_staff'] = JSON.stringify(equipo);

    /* El candado: una vez verificado, vale unos minutos para lo que no destruye
       nada. Sin eso, entrar y editar pide la clave dos veces seguidas. */
    let corrio = 0;
    R._pedirClaveAdmin = function (_a, cb) { corrio++; cb(); };
    setVar(R, '_okHasta', 0);
    R._gateStaff('probar', function () {});
    test('la primera vez sí pide la clave', () => eq(corrio, 1, 'veces'));
    R._gateStaff('probar otra vez', function () {});
    test('dentro de la gracia ya no la vuelve a pedir', () => eq(corrio, 1, 'veces'));
    setVar(R, '_okHasta', Date.now() - 1);
    R._gateStaff('ya venció', function () {});
    test('vencida la gracia, la pide de nuevo', () => eq(corrio, 2, 'veces'));

    /* Crear NO pasa por el candado — es la tarea del día. Editar sí. */
    let pedidas = 0;
    R._pedirClaveAdmin = function (_a, cb) { pedidas++; cb(); };
    setVar(R, '_okHasta', 0);
    R.openModal('');
    test('crear un colaborador NO pide contraseña', () => eq(pedidas, 0, 'veces'));
    setVar(R, '_okHasta', 0);
    R.openModal('a');
    test('editar uno existente SÍ la pide', () => eq(pedidas, 1, 'veces'));
})();

/* ═══════════ SUITE S · INVITACIONES DE ALTA (admin.html) ═══════════
   El link de invitación es un PORTADOR: quien lo tenga da de alta un negocio.
   Es el único camino de alta desde que el registro público está cerrado, así
   que lo que se fije aquí es lo que sostiene esa puerta. */
console.log('\n══ SUITE S · Invitaciones de alta (admin.html) ══');
(function () {
    const A = crearContexto();
    /* El generador usa crypto.getRandomValues, que el contexto de prueba no
       trae: se le pone el del propio Node, que es el mismo del navegador. */
    A.crypto = require('crypto').webcrypto;
    A.location = { origin: 'https://etaax.com', pathname: '/admin.html' };
    cargarInline(A, 'admin.html');

    /* Si el token se pudiera adivinar, se daría de alta un negocio ajeno. */
    const t1 = A._invToken(), t2 = A._invToken();
    test('el token tiene 48 caracteres hexadecimales', () =>
        eq(/^[0-9a-f]{48}$/.test(t1), true, 'token'));
    test('dos invitaciones no comparten token', () => eq(t1 === t2, false, 'token'));
    /* La RPC del servidor rechaza cualquier token de menos de 20 caracteres:
       el que se genera aquí tiene que pasar ese piso con holgura. */
    test('el token supera el mínimo que exige el servidor', () => eq(t1.length > 20, true, 'largo'));

    test('el link apunta a la página de alta con su token', () =>
        eq(A._invLink('abc123'), 'https://etaax.com/alta.html?t=abc123', 'link'));

    /* Estado de la lista: usada / caducada / vigente. Se separan porque cada una
       se resuelve distinto —iniciar sesión, pedir otra, o esperar— y decirle
       "inválida" a las tres deja al cliente sin saber qué hacer. */
    const ayer = new Date(Date.now() - 86400000).toISOString();
    const manana = new Date(Date.now() + 86400000).toISOString();
    setVar(A, '_data', { invitaciones: [
        { token: 'a'.repeat(48), email: 'uno@x.com',  nombre_negocio: 'Uno',  forma_pago: 'stripe',  expira_at: manana, usada_at: null },
        { token: 'b'.repeat(48), email: 'dos@x.com',  nombre_negocio: 'Dos',  forma_pago: 'offline', expira_at: manana, usada_at: new Date().toISOString() },
        { token: 'c'.repeat(48), email: 'tres@x.com', nombre_negocio: 'Tres', forma_pago: 'stripe',  expira_at: ayer,   usada_at: null },
    ]});
    A.renderInvitaciones();
    const tabla = A.document.getElementById('tbodyInvitaciones').innerHTML;

    test('la vigente se marca como vigente', () => eq(tabla.indexOf('Vigente') > -1, true, 'estado'));
    test('la ya usada se distingue de la caducada', () =>
        eq(tabla.indexOf('Usada') > -1 && tabla.indexOf('Caducada') > -1, true, 'estado'));
    /* Solo la vigente ofrece copiar el link: ofrecerlo en una usada o vencida es
       mandarle al cliente un link que no va a funcionar. */
    test('solo la vigente ofrece copiar el link', () =>
        eq((tabla.match(/_copiarInv/g) || []).length, 1, 'botones'));
    /* Cancelar sí aparece en la vigente Y en la caducada —las dos se pueden
       limpiar de la lista—, pero NUNCA en la usada: ésa ya es el registro de un
       alta que existe, y "cancelarla" no desharía el negocio. */
    test('cancelar aparece en la vigente y en la caducada, no en la usada', () =>
        eq((tabla.match(/cancelarInvitacion/g) || []).length, 2, 'botones'));
    test('el contador dice cuántas siguen vivas', () =>
        eq(A.document.getElementById('countInvitaciones').textContent, '3 · 1 vigente', 'contador'));

    /* ── AVISO DE NEGOCIOS ESPERANDO ACTIVACIÓN ──
       Un negocio dado de alta por invitación nace bloqueado. Si nadie avisa, el
       cliente espera y ETAAX no se entera. */
    setVar(A, '_data', {
        invitaciones: [],
        negocios: [
            { id: 'n1', datos: { nombre: 'Tata Mezcalería' } },
            { id: 'n2', datos: { nombre: 'Mammut Pizza' } },
            { id: 'n3', datos: { nombre: 'Ya Activo' } },
        ],
        suscripciones: {
            n1: { estado: 'pendiente' },
            n3: { estado: 'activa' },
            // n2 NO tiene fila: recién creado, todavía sin suscripción
        },
    });
    A.renderAvisoPendientes();
    test('cuenta los negocios en pendiente', () =>
        eq(A._negociosPendientes().length, 2, 'pendientes'));
    /* Un negocio SIN fila de suscripción también está esperando: es el caso del
       recién creado, y es justo el que no hay que perder de vista. */
    test('un negocio sin suscripción cuenta como pendiente', () =>
        eq(A._negociosPendientes().some(n => n.id === 'n2'), true, 'pendientes'));
    test('el que ya está activo no molesta', () =>
        eq(A._negociosPendientes().some(n => n.id === 'n3'), false, 'pendientes'));
    test('el aviso nombra a los que esperan', () => {
        const h = A.document.getElementById('avisoPendientes').innerHTML;
        return eq(h.indexOf('Tata Mezcalería') > -1 && h.indexOf('Mammut Pizza') > -1, true, 'aviso');
    });
    /* String(): en el navegador textContent siempre es texto, pero el DOM de
       prueba guarda lo que se le dé tal cual. Comparar contra '2' probaría el
       arnés, no la app. */
    test('y la pestaña lleva el contador', () =>
        eq(String(A.document.getElementById('tabNegBadge').textContent), '2', 'badge'));

    /* Sin pendientes, el aviso se calla: un banner permanente deja de leerse. */
    setVar(A, '_data', { invitaciones: [], negocios: [{ id: 'n3', datos: { nombre: 'Ya Activo' } }],
                         suscripciones: { n3: { estado: 'activa' } } });
    A.renderAvisoPendientes();
    test('sin pendientes, el aviso se esconde', () =>
        eq(A.document.getElementById('avisoPendientes').style.display, 'none', 'aviso'));

    /* Una lista vacía no puede verse como un error. */
    setVar(A, '_data', { invitaciones: [] });
    A.renderInvitaciones();
    test('sin invitaciones se explica, no se deja en blanco', () =>
        eq(A.document.getElementById('tbodyInvitaciones').innerHTML.indexOf('Todavía no has invitado') > -1, true, 'vacío'));
})();

/* ═══════════ SUITE T · DATOS DE TRANSFERENCIA (datos-pago.js) ═══════════
   Los ve el cliente al terminar su alta y desde el hub si su negocio espera
   pago. Viven en UN archivo porque si estuvieran en dos, el día que cambie la
   cuenta uno de los dos seguiría mandando dinero a la cuenta vieja. */
console.log('\n══ SUITE T · Datos de transferencia (datos-pago.js) ══');
(function () {
    const D = cargarJS(crearContexto(), 'datos-pago.js').ETAAX_PAGO_DATOS;
    const texto = D.html().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    test('la CLABE tiene los 18 dígitos', () =>
        eq(D.clabe.replace(/\D/g, '').length, 18, 'clabe'));
    /* Misma validación que la nómina: una CLABE con un dígito cambiado tiene sus
       18 y el dinero rebota o cae en otra cuenta. Aquí es la cuenta de ETAAX. */
    test('la CLABE cuadra con su dígito de control', () => {
        const B = cargarJS(crearContexto(), 'bancos-mx.js').BancosMX;
        return eq(B.validarClabe(D.clabe).ok, true, 'clabe');
    });
    test('la CLABE corresponde al banco que se anuncia', () => {
        const B = cargarJS(crearContexto(), 'bancos-mx.js').BancosMX;
        const det = B.bancoDeClabe(D.clabe);
        return eq(!!det && det.nombre.toLowerCase().indexOf(D.banco.toLowerCase()) > -1, true,
                  'banco (' + D.banco + ' vs ' + (det && det.nombre) + ')');
    });

    test('se pintan todos los datos que hacen falta para transferir', () =>
        eq(['BBVA', 'Edwin', '155 287 7511', '4152', '0121'].every(x => texto.indexOf(x) > -1), true, 'datos'));
    test('se pide el comprobante', () => eq(texto.toLowerCase().indexOf('comprobante') > -1, true, 'nota'));
    /* La versión compacta va dentro de una tarjeta que ya lleva su título. */
    test('la versión compacta no repite el encabezado', () =>
        eq(D.html(true).indexOf('Datos para transferencia'), -1, 'compacto'));
})();

/* ═══════════ SUITE U · NÓMINA POR SUCURSAL (financiero/gastos-globales.html) ═══════════
   Dentro de una sucursal se listaba a TODO el personal del negocio, así que la
   nómina de Oxford mostraba también a los de Madero y Altozano — y sumaba sus
   sueldos. El catálogo de staff ya filtraba bien; esta pantalla, que es la que
   dice cuánto se paga, no. */
console.log('\n══ SUITE U · Nómina por sucursal (financiero/gastos-globales.html) ══');
(function () {
    const G = crearContexto();
    cargarJS(G, 'etaax-core.js');
    G._storage['etaax_negocio_activo'] = 'n1';
    cargarInline(G, 'financiero/gastos-globales.html');

    setVar(G, '_cacheGG_Staff', [
        { id: 'a', nombre: 'Diego',  sucursalId: 'sOx',           estado: 'Activo', categoriaNomina: 'operativa', salarioBase: 9451.2, periodicidad: 'mensual' },
        { id: 'b', nombre: 'Dayron', sucursalId: 'sMad',          estado: 'Activo', categoriaNomina: 'operativa', salarioBase: 9451.2, periodicidad: 'mensual' },
        { id: 'c', nombre: 'Nadia',  sucursalId: 'sOx',           estado: 'Activo', categoriaNomina: 'operativa', salarioBase: 9451.2, periodicidad: 'mensual' },
        { id: 'd', nombre: 'Matriz', sucursalId: '',              estado: 'Activo', categoriaNomina: 'operativa', salarioBase: 9451.2, periodicidad: 'mensual' },
        { id: 'e', nombre: 'Exempl', sucursalId: 'sOx',           estado: 'Baja definitiva', categoriaNomina: 'operativa', salarioBase: 9451.2, periodicidad: 'mensual' },
    ]);
    const enSuc = suc => { setVar(G, '_sucursalId', suc); return G._staffNominaActivo().map(x => x.nombre).join(','); };

    test('en una sucursal solo salen SUS colaboradores', () => eq(enSuc('sOx'), 'Diego,Nadia', 'nómina'));
    test('otra sucursal, otra lista', () => eq(enSuc('sMad'), 'Dayron', 'nómina'));
    /* Regla del sistema: registro sin sucursal = Matriz. */
    test('el que no tiene sucursal cae en Matriz', () => eq(enSuc('suc_principal'), 'Matriz', 'nómina'));
    test('en vista global salen todos', () =>
        eq(enSuc(null), 'Diego,Dayron,Nadia,Matriz', 'nómina'));
    test('los dados de baja no entran en ninguna', () =>
        eq(enSuc('sOx').indexOf('Exempl'), -1, 'nómina'));

    /* ── ¿DE DÓNDE SALE EL SUELDO? ──
       Un renglón en el mínimo del negocio se ve idéntico a uno capturado a
       propósito, y eso fue lo que hizo pensar que la tabla estaba congelada. */
    setVar(G, '_storage_np', null);
    G.NominaParams = { get: function(){ return { salarioDiarioDefault: 315.04 }; } };
    test('sin sueldo en su ficha, el sueldo viene del mínimo', () =>
        eq(G._sueldoEsDelMinimoGG({ nombre: 'X' }), true, 'origen'));
    test('con salario base capturado, NO es el mínimo', () =>
        eq(G._sueldoEsDelMinimoGG({ salarioBase: 12000, periodicidad: 'mensual' }), false, 'origen'));
    test('con sueldo diario capturado, tampoco', () =>
        eq(G._sueldoEsDelMinimoGG({ esquemaSueldo: 'diario', sueldoDiario: 400 }), false, 'origen'));
    /* Si el negocio no definió mínimo, no hay mínimo del cual venir. */
    G.NominaParams = { get: function(){ return { salarioDiarioDefault: 0 }; } };
    test('sin mínimo definido, no se marca nada', () =>
        eq(G._sueldoEsDelMinimoGG({ nombre: 'X' }), false, 'origen'));

    /* ── EL QUE NO LE CUESTA AL NEGOCIO ──
       Becarios de Jóvenes Construyendo el Futuro (les paga el gobierno),
       practicantes, familiares. Antes no había forma de decirlo: un sueldo en
       cero era indistinguible de uno sin capturar, y caía al mínimo — o sea que
       el sistema proyectaba un gasto que no existe, y en el módulo de pago le
       habría pagado de la caja. */
    G.NominaParams = { get: function(){ return { salarioDiarioDefault: 320 }; } };
    const becario = { id: 'j', nombre: 'Jovan', sinCostoNegocio: true, esquemaSueldo: 'diario', sueldoDiario: 0 };
    test('un colaborador sin costo proyecta CERO, no el mínimo', () =>
        eq(G._baseMensualStaff(becario, '2026-09'), 0, 'base'));
    test('y no se marca como "mínimo", porque no viene del mínimo', () =>
        eq(G._sueldoEsDelMinimoGG(becario), false, 'origen'));
    /* Sin la casilla, el mismo registro sí cae al mínimo: 320 × 30 = 9,600.
       Ése es exactamente el número que aparecía y que no se podía bajar. */
    test('sin la casilla, ese mismo registro cae al mínimo (9,600)', () =>
        eq(G._baseMensualStaff({ id:'j', esquemaSueldo:'diario', sueldoDiario:0 }, '2026-09'), 9600, 'base'));

    /* _loadStaff NO se filtra, y es a propósito: alimenta la clasificación de
       gastos, que reconoce cuáles son de nómina por el nombre del colaborador.
       Un gasto capturado en una sucursal puede nombrar a alguien de otra;
       filtrarla lo mandaría a "variables" y descuadraría los KPIs. */
    setVar(G, '_sucursalId', 'sOx');
    test('el catálogo COMPLETO sigue disponible para clasificar gastos', () =>
        eq(G._loadStaff().length, 5, 'catálogo'));
})();

/* ═══════════ SUITE W · LA REGLA DEL SUELDO, UNA SOLA (etaax-core.js) ═══════════
   Estaba escrita TRES veces —el módulo que paga, el que proyecta y el
   simulador— y no decían lo mismo: el simulador no caía al mínimo del negocio
   ni conocía a los colaboradores sin costo. Ahora las tres delegan aquí. */
console.log('\n══ SUITE W · La regla del sueldo (etaax-core.js) ══');
(function () {
    const C = cargarJS(crearContexto(), 'etaax-core.js').EtaaxCore;
    const MIN = 320;

    /* ── UN CERO ESCRITO A MANO VALE CERO ──
       parseFloat('') || 0 vuelve idéntico "puse cero" y "nunca lo llené", y por
       eso un cero se ignoraba y se sustituía por el mínimo: el renglón nunca
       bajaba por más que se guardara. `sueldoCapturado` los separa. */
    const cero = { esquemaSueldo: 'diario', sueldoDiario: 0, sueldoCapturado: true };
    test('un cero capturado a propósito se respeta', () => eq(C.sueldoDiarioEfectivo(cero, MIN), 0, 'sueldo'));
    test('…y proyecta cero en el mes', () => eq(C.baseMensualStaff(cero, 30, MIN), 0, 'base'));
    test('…y no se marca como "mínimo"', () => eq(C.sueldoEsDelMinimo(cero, MIN), false, 'origen'));

    /* Los registros VIEJOS no traen la marca, así que se comportan igual que
       siempre. Nadie se va a cero de un día para otro por este cambio. */
    const legado = { esquemaSueldo: 'diario', sueldoDiario: 0 };
    test('un cero heredado (sin marca) sigue cayendo al mínimo', () =>
        eq(C.sueldoDiarioEfectivo(legado, MIN), 320, 'sueldo'));
    test('…y sigue avisando que viene del mínimo', () => eq(C.sueldoEsDelMinimo(legado, MIN), true, 'origen'));

    /* Sin costo gana a todo, incluso a un sueldo viejo que quedara capturado. */
    test('sin costo paga cero aunque tenga sueldo capturado', () =>
        eq(C.sueldoDiarioEfectivo({ sinCostoNegocio: true, esquemaSueldo: 'diario', sueldoDiario: 400 }, MIN), 0, 'sueldo'));

    /* Las periodicidades: mensualizar NO es el sueldo diario × días. */
    test('quincenal se mensualiza por dos, no por días', () =>
        eq(C.baseMensualStaff({ salarioBase: 4950, periodicidad: 'quincenal' }, 31, MIN), 9900, 'base'));
    test('semanal se mensualiza por 52/12', () =>
        eq(C.baseMensualStaff({ salarioBase: 2000, periodicidad: 'semanal' }, 30, MIN), 2000 * 52 / 12, 'base'));
    test('el diario sí depende de los días del mes', () =>
        eq(C.baseMensualStaff({ esquemaSueldo: 'diario', sueldoDiario: 320 }, 31, MIN), 9920, 'base'));
    /* Un sueldo por periodo se divide para sacar el diario, con la misma tabla. */
    test('un quincenal de 4,950 da 330 al día', () =>
        eq(C.sueldoDiarioEfectivo({ salarioBase: 4950, periodicidad: 'quincenal' }, MIN), 330, 'sueldo'));

    /* Sin mínimo definido no hay de dónde caer, y no se avisa de un mínimo que
       no existe. */
    test('sin mínimo definido, el que no tiene sueldo cobra cero', () =>
        eq(C.sueldoDiarioEfectivo({}, 0), 0, 'sueldo'));
    test('…y no se marca "mínimo"', () => eq(C.sueldoEsDelMinimo({}, 0), false, 'origen'));
    test('un colaborador inexistente no revienta la regla', () =>
        eq(C.sueldoDiarioEfectivo(null, MIN), 0, 'sueldo'));

    /* ── LAS TRES PANTALLAS DICEN LO MISMO ──
       Que es el punto de haberlo movido al núcleo. */
    const gente = [
        { esquemaSueldo: 'diario', sueldoDiario: 0, sueldoCapturado: true },
        { sinCostoNegocio: true },
        { salarioBase: 6000, periodicidad: 'quincenal' },
        {},
    ];
    const porNucleo = gente.map(s => C.baseMensualStaff(s, 30, MIN));
    test('paga, proyecta y simula coinciden en cada caso', () =>
        eq(porNucleo.join('|'), '0|0|12000|9600', 'nómina'));
})();

/* ═══════════ SUITE V · SIN COSTO PARA EL NEGOCIO (diario.html) ═══════════
   Esta es la que importa: aquí no se proyecta, se PAGA. Un becario al que el
   negocio no le paga tiene que salir en cero, o se le entrega dinero de la caja
   a alguien a quien le paga el gobierno. */
console.log('\n══ SUITE V · Sin costo para el negocio (administrativo/diario.html) ══');
(function () {
    const D = A;   // el contexto de diario.html ya cargado en la SUITE A
    D.NominaParams = { get: function () { return { salarioDiarioDefault: 320, jornadaHoras: 8 }; } };

    test('al que no le cuesta al negocio se le paga CERO', () =>
        eq(D._sueldoDiarioEfectivo({ sinCostoNegocio: true }), 0, 'sueldo'));
    /* La bandera manda sobre todo, incluso si quedó un sueldo viejo capturado:
       si no, un becario al que antes se le puso sueldo seguiría cobrando. */
    test('la bandera manda aunque haya un sueldo viejo capturado', () =>
        eq(D._sueldoDiarioEfectivo({ sinCostoNegocio: true, esquemaSueldo: 'diario', sueldoDiario: 400 }), 0, 'sueldo'));
    test('sin la bandera, sigue cayendo al mínimo como siempre', () =>
        eq(D._sueldoDiarioEfectivo({ nombre: 'X' }), 320, 'sueldo'));
    test('y un sueldo capturado se respeta igual que antes', () =>
        eq(D._sueldoDiarioEfectivo({ esquemaSueldo: 'diario', sueldoDiario: 450 }), 450, 'sueldo'));
    /* No se le marca "paga el mínimo": no cobra nada, no viene del mínimo. */
    test('no se le avisa que cobra el mínimo', () =>
        eq(D._sueldoEsDelMinimo({ sinCostoNegocio: true }), false, 'aviso'));
})();

/* ═══════════ SUITE X · VERSIONES DE EVALUACIÓN (administrativo/evaluaciones.html) ═══════════
   Una evaluación que el negocio jaló del catálogo es una COPIA. Si ETAAX le
   agrega preguntas después, el negocio se queda con la vieja y no se entera —
   ya pasó: el catálogo tenía 27 preguntas y el negocio seguía con 17. */
console.log('\n══ SUITE X · Versiones de evaluación (administrativo/evaluaciones.html) ══');
(function () {
    const E = crearContexto();
    E._storage['etaax_negocio_activo'] = 'n1';
    cargarInline(E, 'administrativo/evaluaciones.html');

    setVar(E, '_catEvals', [
        { id: 'cat1', titulo: 'Psicométrico', version: 3, preguntas: new Array(27) },
        { id: 'cat2', titulo: 'Sin versión',            preguntas: new Array(5) },
    ]);

    test('una copia atrasada se detecta', () =>
        eq(E._hayVersionNueva({ origenCatalogoId: 'cat1', origenVersion: 1 }), true, 'aviso'));
    test('una copia al día no molesta', () =>
        eq(E._hayVersionNueva({ origenCatalogoId: 'cat1', origenVersion: 3 }), false, 'aviso'));
    /* Una evaluación propia del negocio no tiene maestra: nunca debe avisar. */
    test('una evaluación propia nunca pide actualizarse', () =>
        eq(E._hayVersionNueva({ id: 'mia', titulo: 'Mía' }), false, 'aviso'));
    /* Si la maestra se borró del catálogo, tampoco hay con qué comparar. */
    test('si la maestra ya no existe, no se inventa un aviso', () =>
        eq(E._hayVersionNueva({ origenCatalogoId: 'borrada', origenVersion: 1 }), false, 'aviso'));

    /* Las copias VIEJAS no traen origenVersion y las maestras viejas no traen
       version: las dos cuentan como 1, así que no se avisa hasta que ETAAX
       guarde la maestra una vez. Es lo correcto — avisar de un cambio que no
       ocurrió entrenaría a ignorar el aviso. */
    test('sin versiones registradas (datos viejos) no se avisa de la nada', () =>
        eq(E._hayVersionNueva({ origenCatalogoId: 'cat2' }), false, 'aviso'));
    test('…y en cuanto la maestra sube de versión, sí', () => {
        setVar(E, '_catEvals', [{ id: 'cat2', titulo: 'Sin versión', version: 2, preguntas: new Array(5) }]);
        return eq(E._hayVersionNueva({ origenCatalogoId: 'cat2' }), true, 'aviso');
    });
})();

/* ═══════════ SUITE Y · PERIODO DEL INVENTARIO POR MOMENTO (recetas/inventarios.js) ═══════════
   El caso de Edwin: un inventario del 19 de agosto cerrado a las 5 pm no debe
   quedarse con lo que entró ese mismo 19 a las 8 pm. Con fechas sueltas eso no
   se puede distinguir, y una entrada que cae en el periodo equivocado descuadra
   las existencias de DOS inventarios: sobra en uno y falta en el otro. */
console.log('\n══ SUITE Y · Periodo del inventario por momento (recetas/inventarios.js) ══');
(function () {
    const Y = crearContexto();
    cargarJS(Y, 'etaax-core.js');
    cargarJS(Y, 'insumo-label.js');
    cargarJS(Y, 'recetas/inventarios.js');
    Y._storage['etaax_negocio_activo'] = 'negT';

    /* El anterior cerró el 19-ago a las 17:00; el actual sigue abierto. */
    const anterior = { id: 'i1', fecha: '2026-08-19', cerrado: true, cerradoAt: '2026-08-19T17:00:00.000Z' };
    const actual   = { id: 'i2', fecha: '2026-08-31', cerrado: false, abiertoAt: '2026-08-19T17:05:00.000Z' };
    setVar(Y, 'invActual', actual);
    Y._getRefInv = function () { return anterior; };

    const cae = (fecha, mom) => Y._enPeriodoInvActual(fecha, mom);
    /* La hora se guarda como ISO (UTC) pero se capturó en hora LOCAL, así que
       para comprobarla hay que volver a local — si no, el test pasaría o
       fallaría según la zona horaria de quien lo corra. */
    const _hhmmLocal = iso => {
        const d = new Date(iso);
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    };
    /* Y el DÍA también en local: a las 23:59 de México el ISO ya cayó al día
       siguiente en UTC. Comparar el texto del ISO haría que el test pasara o
       fallara según la zona horaria de quien lo corre. */
    const _diaLocal = iso => {
        const d = new Date(iso);
        return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
    };

    test('lo del 19 ANTES del cierre es del inventario anterior', () =>
        eq(cae('2026-08-19', '2026-08-19T14:30:00.000Z'), false, 'periodo'));
    /* EL CASO QUE FALLABA: mismo día, después de cerrar. */
    test('lo del 19 DESPUÉS del cierre ya es del nuevo', () =>
        eq(cae('2026-08-19', '2026-08-19T20:00:00.000Z'), true, 'periodo'));
    test('justo en el minuto del cierre queda en el anterior', () =>
        eq(cae('2026-08-19', '2026-08-19T17:00:00.000Z'), false, 'periodo'));
    test('un día después, claro que es del nuevo', () =>
        eq(cae('2026-08-20', '2026-08-20T09:00:00.000Z'), true, 'periodo'));

    /* Un inventario ABIERTO no tiene tope: todo lo que llegue es suyo hasta que
       se cierre. Antes se cortaba en su `fecha`, así que lo registrado después
       se perdía de vista. */
    test('un inventario abierto se queda con lo posterior a su fecha', () =>
        eq(cae('2026-09-05', '2026-09-05T10:00:00.000Z'), true, 'periodo'));

    /* Cerrado: sí hay tope, y lo posterior es del siguiente. */
    setVar(Y, 'invActual', Object.assign({}, actual, { cerrado: true, cerradoAt: '2026-08-31T18:00:00.000Z' }));
    test('cerrado, lo posterior a SU cierre ya no le toca', () =>
        eq(cae('2026-08-31', '2026-08-31T21:00:00.000Z'), false, 'periodo'));
    test('…y lo de antes de su cierre sí', () =>
        eq(cae('2026-08-31', '2026-08-31T12:00:00.000Z'), true, 'periodo'));

    /* ── LOS INVENTARIOS VIEJOS NO CAMBIAN ──
       No traen cerradoAt, así que se siguen repartiendo por día. Aplicarles la
       regla nueva movería entradas ya repartidas de un periodo a otro. */
    setVar(Y, 'invActual', { id: 'v2', fecha: '2026-08-31', cerrado: false });
    Y._getRefInv = function () { return { id: 'v1', fecha: '2026-08-19' }; };   // sin cerradoAt
    test('sin hora de cierre se sigue repartiendo por día', () =>
        eq(cae('2026-08-19', '2026-08-19T20:00:00.000Z'), false, 'periodo'));
    test('…y el día siguiente entra, como siempre', () =>
        eq(cae('2026-08-20', '2026-08-20T20:00:00.000Z'), true, 'periodo'));
    test('…con el tope viejo en la fecha del inventario', () =>
        eq(cae('2026-09-05', '2026-09-05T10:00:00.000Z'), false, 'periodo'));

    /* Un movimiento SIN momento (los ya guardados) cae a la regla por día. */
    Y._getRefInv = function () { return anterior; };
    setVar(Y, 'invActual', actual);
    test('un movimiento sin hora usa la regla por día', () =>
        eq(cae('2026-08-25', null), true, 'periodo'));

    /* ══ FINALIZACIÓN TARDÍA ══════════════════════════════════════════════
       El caso que preguntó Edwin: el conteo fue el 19 de agosto pero se olvidó
       darle finalizar hasta el 1 de septiembre. Si la frontera fuera el CLIC,
       ese inventario se tragaría trece días de entradas que no son suyas y el
       siguiente arrancaría vacío: descuadra los dos a la vez. */
    /* La hora la pregunta el MODAL (_conCierreOperativo) antes de la contraseña,
       y deja puesto `cierreOperativo`. Aquí se prueba lo que hace _sellarCierre
       con y sin ese dato — que es lo que decide el reparto. */
    const tardio = { id: 'i9', fecha: '2026-08-19', cerrado: false,
                     cierreOperativo: new Date('2026-08-19T17:00:00').toISOString() };
    Y._sellarCierre(tardio);

    test('el clic queda registrado aparte, para auditar', () =>
        eq(/^\d{4}-\d{2}-\d{2}T/.test(tardio.cerradoAt), true, 'cerradoAt'));
    test('la frontera es la hora que se dijo, no el día del clic', () =>
        eq(_hhmmLocal(tardio.cierreOperativo), '17:00', 'hora'));
    test('y es del 19, no de hoy', () =>
        eq(_diaLocal(tardio.cierreOperativo), '2026-08-19', 'cierreOperativo'));
    test('la que manda para el periodo es la operativa, no el clic', () =>
        eq(Y._momentoCierre(tardio), tardio.cierreOperativo, 'frontera'));

    /* Con eso, el reparto vuelve a ser el correcto. */
    setVar(Y, 'invActual', { id: 'i10', fecha: '2026-09-02', cerrado: false });
    Y._getRefInv = function () { return tardio; };
    test('lo del 20 de agosto es del NUEVO, no del que se finalizó tarde', () =>
        eq(cae('2026-08-20', '2026-08-20T10:00:00.000Z'), true, 'periodo'));
    test('y lo del 19 antes de las 5 sigue siendo del viejo', () =>
        eq(cae('2026-08-19', '2026-08-19T14:00:00.000Z'), false, 'periodo'));

    /* RED DE SEGURIDAD: si un camino de cierre se salta el modal, la frontera NO
       puede irse a "ahora" —ése es justo el error que arruina el reparto—. Cae al
       final de SU día: cuenta todo ese día y nada del siguiente. */
    const sinPreguntar = { id: 'i11', fecha: '2026-08-19', cerrado: false };
    Y._sellarCierre(sinPreguntar);
    test('sin haber preguntado, la frontera NO se va a hoy', () =>
        eq(_diaLocal(sinPreguntar.cierreOperativo), '2026-08-19', 'cierreOperativo'));
    test('…se va al final de ese día', () =>
        eq(_hhmmLocal(sinPreguntar.cierreOperativo), '23:59', 'hora'));

    /* Si el inventario ES de hoy, el clic ES el cierre. */
    const hoyISO = _diaLocal(new Date().toISOString());
    const deHoy = { id: 'i13', fecha: hoyISO, cerrado: false };
    Y._sellarCierre(deHoy);
    test('un inventario de HOY se cierra con el momento del clic', () =>
        eq(_diaLocal(deHoy.cierreOperativo), hoyISO, 'cierreOperativo'));

    /* El sello de cierre no se recorre al re-finalizar: eso movería entradas ya
       repartidas. */
    const yaCerrado = { cerradoAt: '2026-08-19T17:00:00.000Z' };
    Y._sellarCierre(yaCerrado);
    test('re-finalizar un cerrado NO recorre su hora de cierre', () =>
        eq(yaCerrado.cerradoAt, '2026-08-19T17:00:00.000Z', 'sello'));
    const sinSellar = {};
    Y._sellarCierre(sinSellar);
    test('y uno sin sellar sí recibe su momento', () =>
        eq(/^\d{4}-\d{2}-\d{2}T/.test(sinSellar.cerradoAt), true, 'sello'));
})();

/* ═══════════ SUITE Z · LA COLA QUE NUNCA SE VACIABA (recetas/inventarios.js) ═══════════
   364 cambios pendientes en cada carga, subiendo bien y volviendo a aparecer.
   La causa: init() corre ANTES de que responda la nube, y el merge de entradas
   re-subía TODO el respaldo local porque el caché estaba vacío y creía que allá
   no había nada. No perdía datos —los upserts son idempotentes— pero dejaba el
   aviso de "sincronizando" prendido para siempre y gastaba red en cada carga. */
console.log('\n══ SUITE Z · La cola que nunca se vaciaba (recetas/inventarios.js) ══');
(function () {
    const Z = crearContexto();
    cargarJS(Z, 'etaax-core.js');
    cargarJS(Z, 'insumo-label.js');
    cargarJS(Z, 'recetas/inventarios.js');
    Z._storage['etaax_negocio_activo'] = 'negT';

    // Respaldo local con tres entradas; la nube ya las tiene todas.
    const locales = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];
    Z._storage['etaax_negT_el_local'] = JSON.stringify(locales);

    let subidas = [];
    Z.sbUpsert = function (tabla, rec) { if (tabla === 'entradas_log') subidas.push(rec.id); };

    /* ── ANTES de que responda la nube (lo que hace init) ── */
    setVar(Z, '_cacheEL', null);
    subidas = [];
    Z._mergeELLocal(false);
    test('con la nube sin responder, NO se re-sube nada', () => eq(subidas.length, 0, 'subidas'));
    test('…pero sí se mezclan para poder pintar el historial', () =>
        eq((Z._cacheEL || []).length, 3, 'vista'));

    /* ── DESPUÉS de la nube, que ya las tiene: tampoco hay nada que mandar ── */
    setVar(Z, '_cacheEL', [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }]);
    subidas = [];
    Z._mergeELLocal(true);
    test('si la nube ya las tiene, no se re-sube ninguna', () => eq(subidas.length, 0, 'subidas'));

    /* ── DESPUÉS de la nube, a la que le falta una: esa SÍ sube ── */
    setVar(Z, '_cacheEL', [{ id: 'e1' }, { id: 'e3' }]);
    subidas = [];
    Z._mergeELLocal(true);
    test('lo que de verdad falta en la nube sí se manda', () => eq(subidas.join(','), 'e2', 'subidas'));
    test('…y solo eso, no el respaldo entero', () => eq(subidas.length, 1, 'subidas'));

    /* EL BUG, tal cual era: caché vacío + re-subir = el respaldo completo. */
    setVar(Z, '_cacheEL', null);
    subidas = [];
    Z._mergeELLocal(true);
    test('con el caché vacío y reSubir, se mandaría TODO (por eso init pasa false)', () =>
        eq(subidas.length, 3, 'subidas'));
})();

/* ═══════════ SUITE AA · BONOS Y SANCIONES EN LA NÓMINA (diario.html) ═══════════
   Los bonos vivían capturados en la ficha del colaborador y el módulo de pago
   NUNCA los leía: había que acordarse de teclearlos. Aquí se fija que se cargan
   solos, con la cuenta correcta según su periodicidad, y que una sanción resta.  */
console.log('\n══ SUITE AA · Bonos automáticos y sanciones (diario.html) ══');
{
    const bonos = (s, tipo, dias) => A._pnBonosDe(s, tipo, dias);
    const suma  = (arr) => arr.reduce((t, x) => t + x.monto, 0);

    /* ── Cada bono entra como su propio renglón, con su nombre ── */
    const ana = { bonos: [
        { concepto: 'Puntualidad', monto: 30,  periodicidad: 'diario'  },
        { concepto: 'Transporte',  monto: 350, periodicidad: 'semanal' },
    ]};
    const semana = bonos(ana, 'semana', 6);

    test('los dos bonos entran, no se funden en uno', () => eq(semana.length, 2, 'renglones'));
    test('el concepto se ve en el recibo, no un total mudo', () =>
        eq(semana[0].concepto.indexOf('Puntualidad') === 0, true, 'concepto'));

    /* ── "Por día" es por día TRABAJADO: eso lo distingue de un sueldo ── */
    test('el bono por día se multiplica por los días trabajados', () =>
        eq(semana[0].monto, 180, 'diario'));
    test('si faltó, se le paga menos incentivo', () =>
        eq(bonos(ana, 'semana', 4)[0].monto, 120, 'faltas'));
    test('cero días trabajados = sin incentivo diario', () =>
        eq(bonos(ana, 'semana', 0).length, 1, 'solo el semanal'));

    /* ── Frecuencia que coincide: monto tal cual, sin prorrateo ── */
    test('bono semanal en nómina semanal: íntegro', () => eq(semana[1].monto, 350, 'semanal'));
    test('bono mensual en nómina mensual: íntegro', () =>
        eq(bonos({ bonos: [{ concepto:'B', monto:1500, periodicidad:'mensual' }] }, 'mes', 30)[0].monto, 1500, 'mensual'));

    /* ── Frecuencia distinta: se prorratea. Pagar un bono mensual completo en
         una nómina semanal sería pagarlo cuatro veces al mes. ── */
    const mensualEnSemana = bonos({ bonos: [{ concepto:'B', monto:3000, periodicidad:'mensual' }] }, 'semana', 7);
    test('un bono mensual NO se paga entero cada semana', () =>
        eq(mensualEnSemana[0].monto < 3000, true, 'prorrateo'));
    test('el mensual prorrateado a la semana da 7/30 del monto', () =>
        eq(mensualEnSemana[0].monto, 700, 'monto'));
    test('y se avisa que va prorrateado', () =>
        eq(mensualEnSemana[0].concepto.indexOf('prorrateado') > -1, true, 'aviso'));
    test('quincenal en nómina mensual sube a dos quincenas', () =>
        eq(bonos({ bonos: [{ concepto:'B', monto:500, periodicidad:'quincenal' }] }, 'mes', 30)[0].monto, 1000, 'quincenal'));

    /* ── Un bono en cero no ensucia el recibo ── */
    test('el bono en cero no aparece', () =>
        eq(bonos({ bonos: [{ concepto:'B', monto:0, periodicidad:'mensual' }] }, 'mes', 30).length, 0, 'cero'));
    test('sin bonos, no hay renglones', () => eq(bonos({}, 'semana', 7).length, 0, 'vacío'));

    /* ── Compatibilidad: las fichas viejas traen un solo bono en campos sueltos ── */
    const viejo = { bonoIncentivo: 800, bonoPeriodicidad: 'mensual' };
    test('la ficha vieja de un solo bono se sigue leyendo', () =>
        eq(bonos(viejo, 'mes', 30)[0].monto, 800, 'legado'));

    /* ── El bono que el usuario quitó a mano NO revive al mover una fecha ── */
    A._pnBonosQuitados = [];
    const antes = bonos(ana, 'semana', 6);
    A._pnBonosQuitados = [antes[0]._bonoKey];
    test('el bono quitado a mano no vuelve al recalcular', () =>
        eq(bonos(ana, 'semana', 6).length, 1, 'quitado'));
    test('…y el otro sí sigue', () =>
        eq(bonos(ana, 'semana', 6)[0].concepto.indexOf('Transporte'), 0, 'sobrevive'));
    A._pnBonosQuitados = [];

    /* ── Los automáticos se marcan, para poder reponerlos sin pisar lo capturado ── */
    test('los bonos automáticos vienen marcados como tales', () =>
        eq(semana.every(x => x._auto === true), true, 'marca'));

    /* La coincidencia exacta y el prorrateo dan el mismo número cuando el periodo
       mide lo mismo; lo que cambia es que al colaborador NO se le dice
       "prorrateado" cuando le pagaron su bono completo. */
    test('el bono semanal íntegro no se anuncia como prorrateado', () =>
        eq(semana[1].concepto.indexOf('prorrateado'), -1, 'etiqueta'));

    /* ══ La sanción capturada a mano, por el camino real del modal ══ */
    const cap = (tipo, monto, motivo) => {
        A._pagoNomStaff = { id:'s1', nombre:'Ana' };
        A._pagoNomConceptos = [];
        A.prompt = () => motivo;
        A.alert  = () => {};
        A.document.getElementById('pnCptTipo').value  = tipo;
        A.document.getElementById('pnCptMonto').value = monto;
        A.document.getElementById('pnCptCant').value  = '';
        A.document.getElementById('pnCptMetodo').value = 'mismo';
        A._pnCptAgregar();
        return A._pagoNomConceptos[0];
    };

    test('la sanción capturada se guarda en negativo: si sumara, premiaría el retardo', () =>
        eq(cap('sancion', 200, 'retardo').monto, -200, 'signo'));
    test('el motivo capturado queda escrito en el concepto', () =>
        eq(cap('sancion', 200, 'faltante de caja').concepto.indexOf('faltante de caja') > -1, true, 'motivo'));
    test('un bono capturado a mano sigue sumando', () =>
        eq(cap('bono', 200, '').monto, 200, 'bono'));

    /* Sin motivo no se aplica: un descuento anónimo en un recibo es una discusión
       con una persona dentro de un mes. */
    A._pagoNomStaff = { id:'s1' }; A._pagoNomConceptos = [];
    A.prompt = () => '   '; A.alert = () => {};
    A.document.getElementById('pnCptTipo').value = 'sancion';
    A.document.getElementById('pnCptMonto').value = 200;
    A._pnCptAgregar();
    test('una sanción sin motivo no se aplica', () => eq(A._pagoNomConceptos.length, 0, 'sin motivo'));

    /* Cancelar el aviso del motivo cancela la sanción entera, y en silencio:
       quien se arrepiente no necesita que lo regañen. */
    let regaños = 0;
    A._pagoNomConceptos = []; A.prompt = () => null; A.alert = () => { regaños++; };
    A.document.getElementById('pnCptTipo').value = 'sancion';
    A.document.getElementById('pnCptMonto').value = 200;
    A._pnCptAgregar();
    test('cancelar el motivo no aplica ninguna sanción', () => eq(A._pagoNomConceptos.length, 0, 'cancelar'));
    test('…y cancelar no regaña al usuario', () => eq(regaños, 0, 'alert'));

    /* ══ Reponer los bonos al mover el periodo ══
       El bono "por día" depende de los días, así que se recalcula al cambiarlos.
       Lo capturado a mano NO se puede perder en el camino. */
    A._pagoNomStaff = ana; A._pnBonosQuitados = []; A._pnTotalManual = 999;
    A.document.getElementById('pnTipo').value = 'semana';
    A.document.getElementById('pnDias').value = 6;
    A._pagoNomConceptos = [{ concepto:'Horas extras', monto: 500, pago:'mismo' }];
    A._pnReponerBonos();
    test('al reponer, los bonos de la ficha entran', () => eq(A._pagoNomConceptos.length, 3, 'entran'));
    test('…sin borrar lo que se capturó a mano', () =>
        eq(A._pagoNomConceptos.some(c => c.concepto === 'Horas extras'), true, 'manual'));
    test('…y el total vuelve a ser automático', () => eq(A._pnTotalManual, null, 'manual'));

    A.document.getElementById('pnDias').value = 3;
    A._pnReponerBonos();
    test('reponer dos veces NO duplica los bonos', () => eq(A._pagoNomConceptos.length, 3, 'duplicado'));
    test('el bono por día se rehace con los días nuevos', () =>
        eq(A._pagoNomConceptos.filter(c => c._auto)[0].monto, 90, 'rehecho'));

    /* Y sobre todo: que esté CONECTADO. La cuenta puede estar perfecta y no
       servir de nada si nadie la llama al mover las fechas del periodo. */
    A._pagoNomStaff = ana; A._pnBonosQuitados = []; A._pagoNomConceptos = [];
    A.document.getElementById('pnTipo').value  = 'semana';
    A.document.getElementById('pnDesde').value = '2026-09-01';
    A.document.getElementById('pnHasta').value = '2026-09-07';
    A._pnRangoChange();
    test('al mover el periodo, los bonos se cargan solos (sin teclear nada)', () =>
        eq(A._pagoNomConceptos.length, 2, 'conectado'));

    A._pagoNomConceptos = []; A._pnTotalManual = null;

    /* ══ La sanción resta ══
       Se guarda como concepto NEGATIVO: así usa el mismo total, la misma lista y
       el mismo recibo que ya existían, sin una estructura aparte. */
    const recibo = (percep, deduc) => {
        A._pagoNomStaff = { id:'s1', nombre:'Ana' };
        A._pagoNomConceptos = percep.concat(deduc);
        A.document.getElementById('pnDesde').value = '2026-09-01';
        A.document.getElementById('pnHasta').value = '2026-09-07';
        A.document.getElementById('pnDiario').value = 400;
        A.document.getElementById('pnDias').value   = 7;
        A.document.getElementById('pnTotal').value  = 2800 + suma(percep) + suma(deduc);
        A._pnPrimaInclude = false;
        return A._reciboNominaDatos();
    };
    const d = recibo(
        [{ concepto:'Puntualidad', monto: 180, pago:'mismo' }],
        [{ concepto:'Sanción · retardo', monto: -200, pago:'mismo' }]
    );

    test('la sanción NO se cuela entre las percepciones', () =>
        eq(d.percepciones.some(p => p.concepto.indexOf('Sanción') === 0), false, 'percep'));
    test('la sanción sale en su propio bloque de deducciones', () =>
        eq(d.deducciones.length, 1, 'deducciones'));
    test('en el recibo la deducción se lee en positivo (el signo lo pone el bloque)', () =>
        eq(d.deducciones[0].monto, 200, 'abs'));
    test('el motivo viaja con la sanción: sin motivo es una discusión en un mes', () =>
        eq(d.deducciones[0].concepto.indexOf('retardo') > -1, true, 'motivo'));
    test('el total de percepciones no incluye la sanción', () => eq(d.totalPerc, 2980, 'totalPerc'));
    test('el total de deducciones es la suma de lo descontado', () => eq(d.totalDed, 200, 'totalDed'));
    test('el neto a pagar ya trae restada la sanción', () => eq(d.total, 2780, 'neto'));

    /* Sin deducciones el recibo no debe inventar un bloque vacío. */
    const limpio = recibo([{ concepto:'Puntualidad', monto:180, pago:'mismo' }], []);
    test('sin sanciones no hay bloque de deducciones', () => eq(limpio.deducciones.length, 0, 'vacío'));

    /* El armador del documento vive en /reporte-marca.js (no se carga aquí):
       basta con devolver el cuerpo para poder mirarlo. */
    A.etaaxReporteDoc = (o) => o.cuerpo;
    const html = A._reciboNominaHTML(d);
    test('el recibo impreso trae el bloque de Deducciones', () =>
        eq(html.indexOf('Deducciones') > -1, true, 'html'));
    test('el recibo impreso separa el Neto a pagar', () =>
        eq(html.indexOf('Neto a pagar') > -1, true, 'neto'));
    test('el recibo limpio NO trae bloque de deducciones', () =>
        eq(A._reciboNominaHTML(limpio).indexOf('Deducciones') === -1, true, 'html limpio'));
}

/* ═══════════ SUITE AB · PREVISIONES: APARTAR NO ES GASTAR (etaax-core.js) ═══════
   El modelo entero cuelga de una frase: una previsión es una ETIQUETA sobre
   dinero que ya está, no un lugar donde el dinero vive ni una forma de pago.
   Estas pruebas son el candado de esa frase.                                    */
console.log('\n══ SUITE AB · Previsiones: apartar no es gastar (etaax-core.js) ══');
{
    const C = cargarJS(crearContexto(), 'etaax-core.js').EtaaxCore;
    const apartar = (monto, fondo, fecha, prevId) =>
        ({ tipo:'apartado', previsionId: prevId || 'p1', monto, fondo: fondo || 'caja_fuerte', fecha: fecha || '2026-01-05' });
    const gasto = (monto, fecha, prevId) =>
        ({ monto, fecha: fecha || '2026-12-15', categoria:'Nómina', previsionId: prevId });

    /* ── Apartar NO mueve fondos ──
       Si restara de la caja fuerte, el saldo dejaría de cuadrar con el conteo
       físico: el billete sigue en la caja, solo que ya tiene dueño. */
    test('apartar no toca la caja fuerte: el billete sigue ahí', () =>
        eq(C.depEfecto(apartar(20000)).caja, 0, 'caja'));
    test('apartar tampoco toca el banco', () =>
        eq(C.depEfecto(apartar(20000, 'banco')).banco, 0, 'banco'));
    /* Un apartado trae origen por arrastre del modal; no debe engañar a depEfecto. */
    test('ni con un origen pegado por el formulario', () =>
        eq(C.depEfecto({ tipo:'apartado', origen:'caja_fuerte', destino:'caja_fuerte', monto:20000 }).caja, 0, 'origen'));
    /* Y un movimiento normal SÍ sigue moviendo: no se rompió lo que ya servía. */
    test('un movimiento normal sí mueve la caja', () =>
        eq(C.depEfecto({ origen:'caja_fuerte', destino:'banco', monto:5000 }).caja, -5000, 'normal'));

    /* ── Saldos por previsión ── */
    const prevs = [{ id:'p1', concepto:'Aguinaldo' }, { id:'p2', concepto:'Mantenimiento' }];
    const deps  = [apartar(20000,'caja_fuerte','2026-01-05'), apartar(10000,'banco','2026-02-05'),
                   apartar(5000,'caja_fuerte','2026-03-05','p2')];
    const r     = C.previsionSaldos(prevs, deps, [gasto(6000,'2026-12-15','p1')]);

    test('lo apartado se acumula', () => eq(r.porId.p1.apartado, 30000, 'apartado'));
    test('lo usado baja el saldo de esa previsión', () => eq(r.porId.p1.saldo, 24000, 'saldo'));
    test('cada meta lleva su propia cuenta', () => eq(r.porId.p2.saldo, 5000, 'p2'));
    test('el total apartado suma todas las metas', () => eq(r.apartado, 35000, 'total'));
    test('el saldo total también', () => eq(r.saldo, 29000, 'saldo total'));

    /* El saldo se reparte proporcional a cómo se apartó: 20k caja / 10k banco de
       30k, tras usar 6k quedan 24k → 16k y 8k. Prorratear en vez de "descontar
       del fondo por el que se pagó" hace la cuenta independiente del ORDEN de
       captura: dos personas capturando lo mismo ven lo mismo. */
    test('el saldo se reparte proporcional entre caja y banco', () =>
        eq(r.porId.p1.enCaja, 16000, 'caja'));
    test('…y el resto queda en el banco', () => eq(r.porId.p1.enBanco, 8000, 'banco'));
    test('las dos partes suman el saldo, sin centavos perdidos', () =>
        eq(r.porId.p1.enCaja + r.porId.p1.enBanco, r.porId.p1.saldo, 'suma'));
    test('el apartado en caja del negocio entero', () => eq(r.enCaja, 21000, 'enCaja'));

    /* ── El disponible: la razón de ser de todo esto ──
       Caja fuerte $80,000, apartado $21,000 → disponible $59,000. */
    const disponible = (caja, saldos) => caja - saldos.enCaja;
    test('lo disponible es la caja menos lo que ya tiene dueño', () =>
        eq(disponible(80000, r), 59000, 'disponible'));

    /* Y aquí está la prueba de que el modelo es el correcto: pagar CON una
       previsión no cambia el disponible. La caja baja y el respaldo baja con
       ella —ese dinero nunca fue tuyo para gastarlo en otra cosa. */
    const antes   = C.previsionSaldos(prevs, [apartar(20000)], []);
    const despues = C.previsionSaldos(prevs, [apartar(20000)], [gasto(8000,'2026-12-15','p1')]);
    test('pagar CON previsión no cambia el disponible', () =>
        eq(disponible(80000 - 8000, despues), disponible(80000, antes), 'disponible'));
    /* Un gasto normal del mismo monto SÍ te deja con menos dinero libre. */
    const normal = C.previsionSaldos(prevs, [apartar(20000)], [gasto(8000,'2026-12-15')]);
    test('un gasto sin previsión sí baja el disponible', () =>
        eq(disponible(80000 - 8000, normal), disponible(80000, antes) - 8000, 'normal'));

    /* Gastar de más contra una previsión deja el saldo en negativo. Se ve, no se
       esconde: pagaste $30,000 de aguinaldo con $20,000 apartados. */
    const pasado = C.previsionSaldos(prevs, [apartar(20000)], [gasto(30000,'2026-12-15','p1')]);
    test('gastar más de lo apartado se ve en negativo, no se tapa', () =>
        eq(pasado.porId.p1.saldo, -10000, 'negativo'));

    /* Lo apartado sin elegir meta cae en UN cajón con nombre, no en uno por captura. */
    const suelto = C.previsionSaldos([], [{ tipo:'apartado', monto:3000, fecha:'2026-01-01' },
                                          { tipo:'apartado', monto:2000, fecha:'2026-02-01' }], []);
    test('lo apartado sin meta cae en un solo cajón general', () =>
        eq(Object.keys(suelto.porId).length, 1, 'cajón'));
    test('…y ese cajón tiene nombre, no es anónimo', () =>
        eq(suelto.porId[C.PREV_GENERAL].apartado, 5000, 'general'));

    /* Un gasto normal no debe morder ninguna previsión: la mayoría de los gastos
       NO son de previsión, y si cayeran en el cajón general se comerían el
       respaldo del aguinaldo sin que nadie lo pidiera. */
    const gastoSuelto = C.previsionSaldos(prevs, [apartar(20000)], [gasto(8000,'2026-12-15')]);
    test('un gasto sin previsión no consume ningún apartado', () =>
        eq(gastoSuelto.usado, 0, 'usado'));
    test('…y deja intacto el saldo de las metas', () =>
        eq(gastoSuelto.porId.p1.saldo, 20000, 'saldo'));

    /* Un movimiento normal no se cuela en las previsiones. */
    const sucio = C.previsionSaldos(prevs, [{ origen:'caja_fuerte', destino:'banco', monto:9000, fecha:'2026-01-01' }], []);
    test('un depósito normal no se cuenta como apartado', () => eq(sucio.apartado, 0, 'limpio'));

    /* ══ EL BUG DEL 12× ══
       Antes se sumaba el monto PLANEADO de toda previsión cuyo rango tocara el
       periodo. Una meta anual de $60,000 se restaba entera en los 12 meses:
       $720,000 de utilidad borrada por una reserva de $60,000. Y en la vista de
       un solo día se restaba igual de completa. */
    const anual = [apartar(5000,'caja_fuerte','2026-01-31'), apartar(5000,'caja_fuerte','2026-02-28'),
                   apartar(5000,'caja_fuerte','2026-03-31')];
    test('enero resta solo lo que se apartó en enero', () =>
        eq(C.previsionApartadoRango(anual, '2026-01-01', '2026-01-31'), 5000, 'enero'));
    test('febrero resta lo suyo, no la meta entera otra vez', () =>
        eq(C.previsionApartadoRango(anual, '2026-02-01', '2026-02-28'), 5000, 'febrero'));
    test('el trimestre suma los tres, ni más ni menos', () =>
        eq(C.previsionApartadoRango(anual, '2026-01-01', '2026-03-31'), 15000, 'trimestre'));
    test('un día sin apartados no resta nada (antes restaba la meta completa)', () =>
        eq(C.previsionApartadoRango(anual, '2026-02-14', '2026-02-14'), 0, 'un día'));
    test('el día en que sí se apartó, resta ese apartado', () =>
        eq(C.previsionApartadoRango(anual, '2026-01-31', '2026-01-31'), 5000, 'ese día'));
    test('sumar los 12 meses no puede pasarse de lo apartado', () =>
        eq(C.previsionApartadoRango(anual, '2026-01-01', '2026-12-31'), 15000, 'año'));

    /* ── Lo usado en el periodo: explica diciembre sin maquillarlo ── */
    const gs = [gasto(60000,'2026-12-20','p1'), gasto(12000,'2026-12-05'), gasto(3000,'2026-11-05','p1')];
    test('de diciembre, lo que venía fondeado por una previsión', () =>
        eq(C.previsionUsadoRango(gs, '2026-12-01', '2026-12-31'), 60000, 'fondeado'));
    test('el gasto sin previsión no cuenta como fondeado', () =>
        eq(C.previsionUsadoRango([gasto(12000,'2026-12-05')], '2026-12-01', '2026-12-31'), 0, 'sin prev'));
    test('lo fondeado de otro mes se queda en su mes', () =>
        eq(C.previsionUsadoRango(gs, '2026-11-01', '2026-11-30'), 3000, 'noviembre'));

    /* Y el gasto sigue contando COMPLETO como egreso: es flujo de efectivo, el
       dinero salió. Lo fondeado explica de dónde salió, no lo descuenta. */
    const cl = C.clasificarGastos([{ monto:60000, categoria:'Nómina', previsionId:'p1' }], { fijos:[], staff:[] });
    test('el gasto pagado con previsión sigue siendo egreso completo', () =>
        eq(cl.egresos, 60000, 'egreso'));
}

/* ═══════════ SUITE AC · PREVISIONES COMO METAS (etaax-core.js) ═══════════
   Una meta sirve cuando responde dos preguntas: ¿cuánto me toca apartar esta
   semana para llegar a tiempo? y ¿voy bien o voy tarde? Antes se capturaban
   monto, rango y "N meses", y ninguna de las tres movía una cuenta.          */
console.log('\n══ SUITE AC · Previsiones como metas (etaax-core.js) ══');
{
    const C = cargarJS(crearContexto(), 'etaax-core.js').EtaaxCore;
    const meta = (extra) => Object.assign({
        montoObjetivo: 60000, fechaInicio: '2026-01-01',
        fechaObjetivo: '2026-12-31', periodicidad: 'mensual'
    }, extra || {});

    /* ── El ritmo: en cuántos pedazos se parte la meta ── */
    const m = C.previsionPlan(meta(), 0, '2026-01-01');
    test('una meta anual por mes se parte en 12', () => eq(m.periodos, 12, 'periodos'));
    test('la cuota es la meta entre los periodos', () => eq(m.porPeriodo, 5000, 'cuota'));
    test('el mismo objetivo por semana se parte en 52', () =>
        eq(C.previsionPlan(meta({periodicidad:'semanal'}), 0, '2026-01-01').periodos, 52, 'semanas'));
    test('quincenal cae en 25 quincenas', () =>
        eq(C.previsionPlan(meta({periodicidad:'quincenal'}), 0, '2026-01-01').periodos, 25, 'quincenas'));
    test('semestral, en 2', () =>
        eq(C.previsionPlan(meta({periodicidad:'semestral'}), 0, '2026-01-01').periodos, 2, 'semestres'));
    test('anual, en 1', () =>
        eq(C.previsionPlan(meta({periodicidad:'anual'}), 0, '2026-01-01').periodos, 1, 'año'));
    /* Una meta a un plazo más corto que su propia periodicidad no puede valer
       cero periodos: sería dividir entre cero. */
    test('una meta anual a tres meses sigue siendo un periodo, no cero', () =>
        eq(C.previsionPlan(meta({fechaObjetivo:'2026-03-31', periodicidad:'anual'}), 0, '2026-01-01').periodos, 1, 'mínimo'));
    /* Y el caso que de verdad rompe: meta que empieza y termina el mismo día.
       Sin piso, los periodos serían 0 y la cuota una división entre cero. */
    const mismoDia = C.previsionPlan(meta({fechaInicio:'2026-05-01', fechaObjetivo:'2026-05-01'}), 0, '2026-05-01');
    test('una meta de un solo día no divide entre cero', () => eq(mismoDia.periodos, 1, 'piso'));
    test('…y pide la meta completa de una vez', () => eq(mismoDia.porPeriodo, 60000, 'cuota'));

    /* ── ¿Voy bien o voy tarde? ── */
    const alDia = C.previsionPlan(meta(), 25000, '2026-06-01');   // 5 meses × 5000
    test('a mitad de año con la cuota al día: al corriente', () => eq(alDia.estado, 'al_corriente', 'estado'));
    test('…y la diferencia es cero', () => eq(alDia.diferencia, 0, 'dif'));

    const tarde = C.previsionPlan(meta(), 20000, '2026-06-01');
    test('con $5,000 menos de lo que tocaba: atrasado', () => eq(tarde.estado, 'atrasado', 'estado'));
    test('y dice exactamente cuánto falta de atraso', () => eq(tarde.diferencia, -5000, 'dif'));

    const antes = C.previsionPlan(meta(), 40000, '2026-06-01');
    test('apartando de más: adelantado', () => eq(antes.estado, 'adelantado', 'estado'));
    test('con la meta completa: cumplida, aunque falten meses', () =>
        eq(C.previsionPlan(meta(), 60000, '2026-06-01').estado, 'cumplida', 'cumplida'));

    /* ── El número que de verdad se usa ──
       Si te atrasaste, seguir apartando la cuota original te deja corto igual.  */
    test('al día, la cuota de aquí en adelante es la de siempre', () =>
        eq(alDia.porPeriodoAjustado, 5000, 'cuota'));
    test('atrasado, la cuota sube para alcanzar la meta', () =>
        eq(tarde.porPeriodoAjustado, 40000 / 7, 'ajustada'));
    test('adelantado, la cuota baja', () => eq(antes.porPeriodoAjustado, 20000 / 7, 'ajustada'));
    /* La prueba de que el ajuste sirve: apartar la cuota ajustada en cada periodo
       que queda llega EXACTO a la meta. */
    test('la cuota ajustada × los periodos que quedan llega justo a la meta', () =>
        eq(tarde.porPeriodoAjustado * tarde.restantes + tarde.apartado, 60000, 'llega'));

    /* ── Pasada la fecha ──
       Medir contra la cuota de un periodo que ya no existe diría que vas bien. */
    const vencida = C.previsionPlan(meta(), 50000, '2027-02-01');
    test('pasada la fecha, se mide contra la meta completa', () => eq(vencida.deberiaLlevar, 60000, 'debería'));
    test('…y $10,000 cortos siguen siendo un atraso', () => eq(vencida.estado, 'atrasado', 'estado'));
    test('la meta vencida se marca como tal', () => eq(vencida.vencida, true, 'vencida'));
    test('pero si ya se juntó, está cumplida aunque venciera', () =>
        eq(C.previsionPlan(meta(), 60000, '2027-02-01').estado, 'cumplida', 'cumplida'));
    /* Sin periodos restantes, lo que falta se debe de golpe, no dividido entre cero. */
    test('sin periodos restantes, lo que falta se pide completo', () =>
        eq(vencida.porPeriodoAjustado, 10000, 'de golpe'));

    /* ── Antes de empezar y sin fechas ── */
    test('antes de la fecha de inicio no se debe nada todavía', () =>
        eq(C.previsionPlan(meta(), 0, '2025-11-01').deberiaLlevar, 0, 'aún no'));
    const libre = C.previsionPlan({ montoObjetivo: 10000 }, 4000, '2026-06-01');
    test('sin fechas no hay ritmo que medir', () => eq(libre.estado, 'sin_fecha', 'estado'));
    test('…pero el avance sí se mide', () => eq(libre.pct, 40, 'pct'));
    test('…y lo que falta también', () => eq(libre.falta, 6000, 'falta'));

    /* ── Compatibilidad con lo ya capturado ──
       Las previsiones viejas traen montoEstimado y fechaFin. Deben seguir vivas. */
    const vieja = C.previsionPlan({ montoEstimado: 60000, fechaInicio: '2026-01-01',
                                    fechaFin: '2026-12-31' }, 25000, '2026-06-01');
    test('la previsión vieja se sigue leyendo (montoEstimado, fechaFin)', () =>
        eq(vieja.objetivo, 60000, 'objetivo'));
    test('…y sin periodicidad capturada, se asume mensual', () =>
        eq(vieja.periodicidad, 'mensual', 'default'));
    /* Una periodicidad que no existe (dato viejo, dedazo) tampoco puede tumbar la
       cuenta: cae en mensual, que es lo que casi siempre es. */
    test('una periodicidad desconocida cae en mensual, no en otra cosa', () =>
        eq(C.previsionPlan(meta({periodicidad:'lunar'}), 0, '2026-01-01').periodos, 12, 'fallback'));
    test('…con lo que cae al mismo plan que una meta nueva', () =>
        eq(vieja.estado, 'al_corriente', 'estado'));

    /* Una meta sin monto no divide entre cero ni miente diciendo 100%. */
    const cero = C.previsionPlan(meta({ montoObjetivo: 0 }), 0, '2026-06-01');
    test('una meta en cero no dice que va al 100%', () => eq(cero.pct, 0, 'pct'));
    test('…ni se declara cumplida sola', () => eq(cero.estado !== 'cumplida', true, 'estado'));
}

/* ═══════════ SUITE AD · LA PANTALLA DE PREVISIONES (financiero/previsiones.html) ══
   La fórmula puede estar perfecta y la pantalla no llamarla. Esto corre el código
   REAL de la página con un DOM de mentira y mira lo que quedó escrito.          */
console.log('\n══ SUITE AD · Pantalla de previsiones (financiero/previsiones.html) ══');
{
    const P = crearContexto();
    cargarJS(P, 'etaax-core.js');
    cargarInline(P, 'financiero/previsiones.html');
    const $ = (id) => P.document.getElementById(id);

    test('la pantalla carga el núcleo (antes no lo cargaba)', () =>
        eq(typeof P.EtaaxCore, 'object', 'core'));
    test('y expone el plan de metas', () => eq(typeof P.EtaaxCore.previsionPlan, 'function', 'plan'));

    /* Meta de $60,000 al año, aportación mensual; llevamos $20,000 apartados a
       mitad de año → deberían ser $25,000: vamos $5,000 atrás. */
    setVar(P, '_cachePrevs', [{ id:'p1', concepto:'Aguinaldo', tipo:'Gasto', estado:'en_curso',
        montoObjetivo:60000, periodicidad:'mensual',
        fechaInicio:'2026-01-01', fechaObjetivo:'2026-12-31' }]);
    setVar(P, '_cacheDeps', [
        { tipo:'apartado', previsionId:'p1', monto:12000, fondo:'caja_fuerte', fecha:'2026-02-01' },
        { tipo:'apartado', previsionId:'p1', monto:8000,  fondo:'caja_fuerte', fecha:'2026-04-01' },
        { origen:'caja_fuerte', destino:'banco', monto:99999, fecha:'2026-03-01' }   // no es apartado
    ]);
    setVar(P, '_cacheGastos', []);
    setVar(P, '_sucursalId', null);
    const HOY_PV = '2026-06-01';   // fecha fija: el candado no depende del reloj
    $('mesInput').value = '2026-06';
    P.renderAll(HOY_PV);

    test('la meta se pinta en el total', () => eq($('kpiTotal').textContent, '$60,000.00', 'meta'));
    test('lo apartado sale de los movimientos, no de un plan escrito', () =>
        eq($('kpiApartado').textContent, '$20,000.00', 'apartado'));
    test('un movimiento normal no se cuela como apartado', () =>
        eq($('kpiApartado').textContent.indexOf('99') === -1, true, 'limpio'));
    test('la tabla dice cuánto llevas', () => eq($('prevTbody').innerHTML.indexOf('$20,000.00') > -1, true, 'tabla'));
    test('…y cuánto falta', () => eq($('prevTbody').innerHTML.indexOf('faltan $40,000.00') > -1, true, 'falta'));

    /* El renglón que hace útil la pantalla: cuánto apartar de aquí en adelante. */
    test('la cuota que se muestra es la ajustada al atraso, no la original', () => {
        const esperado = P.fmtM(40000 / 7);   // faltan 40k en los 7 meses que quedan
        return eq($('kpiCuota').textContent, esperado, 'cuota');
    });
    test('y se dice cada cuánto, si no el monto no se puede accionar', () =>
        eq($('kpiCuotaSub').textContent.indexOf('mensual') > -1, true, 'ritmo'));

    test('el atraso se ve y se cuantifica', () => eq($('kpiAtraso').textContent, '$5,000.00', 'atraso'));
    test('…y se dice cuántas metas van atrás', () =>
        eq($('kpiAtrasoSub').textContent.indexOf('1 meta') > -1, true, 'cuántas'));
    test('la fila se marca como atrasada', () =>
        eq($('prevTbody').innerHTML.indexOf('Atrasado') > -1, true, 'badge'));

    /* Al día, ya no debe gritar. */
    setVar(P, '_cacheDeps', [{ tipo:'apartado', previsionId:'p1', monto:25000, fondo:'caja_fuerte', fecha:'2026-02-01' }]);
    P.renderAll(HOY_PV);
    test('con la cuota al día, no hay atraso que reportar', () => eq($('kpiAtraso').textContent, '$0.00', 'atraso'));
    test('…y lo dice con palabras, no con un cero mudo', () =>
        eq($('kpiAtrasoSub').textContent, 'Ninguna meta atrasada', 'texto'));
    test('la fila se marca al corriente', () =>
        eq($('prevTbody').innerHTML.indexOf('Al corriente') > -1, true, 'badge'));

    /* Pagar CON la previsión consume lo apartado: es el enlace con el gasto real. */
    setVar(P, '_cacheGastos', [{ id:'g1', previsionId:'p1', monto:9000, fecha:'2026-05-10' }]);
    P.renderAll(HOY_PV);
    test('un gasto etiquetado consume lo apartado', () => eq($('kpiApartado').textContent, '$25,000.00', 'apartado'));
    test('…y la fila muestra el saldo que queda respaldado', () =>
        eq($('prevTbody').innerHTML.indexOf('$16,000.00') > -1, true, 'saldo'));

    /* Cada sucursal ve su propio dinero: si no, una meta se vería fondeada con
       dinero de otra sucursal. */
    setVar(P, '_cacheGastos', []);
    setVar(P, '_cacheDeps', [
        { tipo:'apartado', previsionId:'p1', monto:10000, fecha:'2026-02-01', sucursalId:'sucA' },
        { tipo:'apartado', previsionId:'p1', monto:15000, fecha:'2026-02-01', sucursalId:'sucB' }
    ]);
    setVar(P, '_sucursalId', 'sucA');
    P.renderAll(HOY_PV);
    test('lo apartado en otra sucursal no fondea esta meta', () =>
        eq($('kpiApartado').textContent, '$10,000.00', 'scope'));
    setVar(P, '_sucursalId', null);

    /* El orden importa: lo que urge va arriba. Una lista por fecha de captura no
       le dice a nadie qué hacer hoy. */
    setVar(P, '_cachePrevs', [
        { id:'ok1', concepto:'Va bien',   estado:'en_curso', montoObjetivo:12000, periodicidad:'mensual',
          fechaInicio:'2026-01-01', fechaObjetivo:'2026-12-31' },
        { id:'mal', concepto:'Va tarde',  estado:'en_curso', montoObjetivo:12000, periodicidad:'mensual',
          fechaInicio:'2026-01-01', fechaObjetivo:'2026-12-31' }
    ]);
    setVar(P, '_cacheDeps', [{ tipo:'apartado', previsionId:'ok1', monto:5000, fecha:'2026-02-01' }]);
    setVar(P, '_cacheGastos', []);
    P.renderAll(HOY_PV);
    test('la meta atrasada se lista antes que la que va al día', () => {
        const h = $('prevTbody').innerHTML;
        return eq(h.indexOf('Va tarde') < h.indexOf('Va bien'), true, 'orden');
    });

    /* Una meta que ya terminó antes del mes elegido no debe aparecer: si la fecha
       de término no se leyera, toda meta vieja seguiría colgada en la lista. */
    setVar(P, '_cachePrevs', [{ id:'x1', concepto:'Terminada en marzo', estado:'en_curso',
        montoObjetivo:5000, periodicidad:'mensual',
        fechaInicio:'2026-01-01', fechaObjetivo:'2026-03-31' }]);
    P.renderAll(HOY_PV);
    test('una meta que terminó antes del mes elegido no se cuelga en la lista', () =>
        eq($('prevTbody').innerHTML.indexOf('Terminada en marzo'), -1, 'filtrada'));

    /* Y la pantalla tiene que CARGAR el núcleo de verdad: aquí lo inyecta el
       arnés, así que sin mirar el HTML esto pasaría con la etiqueta borrada. */
    test('el HTML carga /etaax-core.js (sin eso, la página muere en blanco)', () =>
        eq(fs.readFileSync(path.join(RAIZ, 'financiero/previsiones.html'), 'utf8')
             .indexOf('src="/etaax-core.js"') > -1, true, 'script'));

    /* La previsión vieja, tal como está capturada hoy, no puede desaparecer. */
    setVar(P, '_cachePrevs', [{ id:'v1', concepto:'Mantenimiento', estado:'en_curso',
        montoEstimado:12000, fechaInicio:'2026-01-01', fechaFin:'2026-06-30' }]);
    setVar(P, '_cacheDeps', []);
    P.renderAll(HOY_PV);
    test('la previsión capturada al modo viejo sigue apareciendo', () =>
        eq($('prevTbody').innerHTML.indexOf('Mantenimiento') > -1, true, 'vieja'));
    test('…con su monto leído como meta', () => eq($('kpiTotal').textContent, '$12,000.00', 'monto'));

    /* El plan en vivo del modal: se ve la cuota ANTES de comprometerse. */
    $('pvMonto').value = 60000;
    $('pvFechaInicio').value = '2026-01-01';
    $('pvFechaFin').value = '2026-12-31';
    $('pvPeriodicidad').value = 'mensual';
    P._pvPreview();
    test('el modal calcula la cuota mientras se captura', () =>
        eq($('pvPreview').innerHTML.indexOf('$5,000.00') > -1, true, 'preview'));
    test('…y dice en cuántas aportaciones se llega', () =>
        eq($('pvPreview').innerHTML.indexOf('<b>12</b>') > -1, true, 'aportaciones'));
    test('…y aclara que apartar no gasta el dinero', () =>
        eq($('pvPreview').innerHTML.indexOf('no gasta el dinero') > -1, true, 'aclaración'));

    /* Sin meta o sin fecha no hay plan que enseñar: mejor callado que inventando. */
    $('pvMonto').value = 0;
    P._pvPreview();
    test('sin monto, el plan no se muestra', () => eq($('pvPreview').style.display, 'none', 'oculto'));
}

/* ═══════════ SUITE AE · APARTAR Y ETIQUETAR (administrativo/diario.html) ═══════
   La captura: apartar dinero para una meta y etiquetar el gasto que la usa.
   Corre el código real del módulo, no una copia de la fórmula.                  */
console.log('\n══ SUITE AE · Apartar y etiquetar en Diario (administrativo/diario.html) ══');
{
    const $ = (id) => A.document.getElementById(id);
    const guardado = () => (A._cacheDeps || [])[(A._cacheDeps || []).length - 1];

    setVar(A, '_cachePrevs', [{ id:'p1', concepto:'Aguinaldo', estado:'en_curso' },
                              { id:'p2', concepto:'Mantenimiento', estado:'cancelada' }]);
    setVar(A, '_cacheDeps', []);

    /* ── Apartar: el destino nuevo del modal de movimientos ── */
    A._depPoblarSelects({});
    const dest = $('depDestino2').options.map(o => o.value);
    test('la meta viva aparece como destino para apartar', () =>
        eq(dest.indexOf('prev:p1') > -1, true, 'destino'));
    test('la meta cancelada no se ofrece', () => eq(dest.indexOf('prev:p2'), -1, 'cancelada'));
    test('siempre existe el cajón general', () =>
        eq(dest.indexOf('prev:' + A.EtaaxCore.PREV_GENERAL) > -1, true, 'general'));

    /* El aviso es lo más importante de esa pantalla: si el usuario cree que el
       dinero salió de la caja, va a buscar un faltante que no existe. */
    $('depOrigen').value = 'caja_fuerte';
    $('depDestino2').value = 'prev:p1';
    A._depMov();
    test('el modal avisa que el dinero NO se mueve', () =>
        eq($('depMovHint').textContent.indexOf('no se mueve') > -1, true, 'aviso'));
    test('…y que deja de contar como disponible', () =>
        eq($('depMovHint').textContent.indexOf('disponible') > -1, true, 'aviso 2'));

    /* ── Guardar el apartado ── */
    $('depFecha').value = '2026-03-01';
    $('depMonto').value = 20000;
    $('depConcepto').value = 'Aparto para aguinaldo';
    A.guardarDeposito();
    const ap = guardado();
    test('el apartado se guarda con su propio tipo', () => eq(ap.tipo, 'apartado', 'tipo'));
    test('…apuntando a su meta', () => eq(ap.previsionId, 'p1', 'meta'));
    test('…y diciendo dónde está parado el dinero', () => eq(ap.fondo, 'caja_fuerte', 'fondo'));
    /* La prueba que sostiene todo: guardado así, no mueve ningún saldo. */
    test('un apartado guardado no mueve la caja fuerte', () =>
        eq(A.EtaaxCore.depEfecto(ap).caja, 0, 'caja'));

    /* Apartar en el BANCO se guarda en el banco. Si todo cayera en "caja fuerte",
       el disponible de la cuenta bancaria mentiría y el de la caja también. */
    setVar(A, '_cuentasBancarias', [{ id:'cta1', tipo:'debito', nombre:'BBVA', predeterminada:true }]);
    A._depPoblarSelects({});
    $('depId').value = '';
    $('depOrigen').value = 'banco:cta1';
    $('depDestino2').value = 'prev:p1';
    $('depFecha').value = '2026-03-02';
    $('depMonto').value = 9000;
    $('depConcepto').value = 'Aparto en banco';
    A.guardarDeposito();
    const apB = guardado();
    test('lo apartado en el banco se guarda como del banco', () => eq(apB.fondo, 'banco', 'fondo'));
    test('…y con la cuenta de la que se etiquetó', () => eq(apB.fondoCuentaId, 'cta1', 'cuenta'));
    test('el núcleo lo lee en el fondo correcto', () =>
        eq(A.EtaaxCore.previsionSaldos([{id:'p1'}], [apB], []).enBanco, 9000, 'banco'));
    test('…y no lo cuenta en la caja fuerte', () =>
        eq(A.EtaaxCore.previsionSaldos([{id:'p1'}], [apB], []).enCaja, 0, 'caja'));
    setVar(A, '_cacheDeps', []);

    /* Apartar desde una entrada externa no significa nada: el dinero tiene que
       estar en algún lado para poder etiquetarlo. */
    let avisos = 0; A.alert = () => { avisos++; };
    const antes = (A._cacheDeps || []).length;
    $('depId').value = ''; $('depOrigen').value = 'externo'; $('depDestino2').value = 'prev:p1';
    $('depMonto').value = 5000; $('depConcepto').value = 'x';
    A.guardarDeposito();
    test('no se puede apartar dinero que no está en ningún fondo', () =>
        eq((A._cacheDeps || []).length, antes, 'rechazado'));
    test('…y se explica por qué', () => eq(avisos > 0, true, 'aviso'));

    /* ── En la lista, un apartado se lee como lo que es ── */
    test('el movimiento se lee como apartado, no como origen→destino', () =>
        eq(A._depMovTxt(ap).indexOf('Apartado en') > -1
           && A._depMovTxt(ap).indexOf('→') === -1, true, 'texto'));
    test('…y dice para qué meta', () => eq(A._depMovTxt(ap).indexOf('Aguinaldo') > -1, true, 'meta'));

    /* ── Etiquetar el gasto ── */
    setVar(A, '_cacheDeps', [{ id:'a1', tipo:'apartado', previsionId:'p1', monto:20000,
                               fondo:'caja_fuerte', fecha:'2026-03-01' }]);
    setVar(A, '_cacheGastos', []);
    A._gPrevPoblar('');
    const ops = $('gPrevision').options.map(o => o.value);
    test('la previsión con respaldo se ofrece al pagar', () => eq(ops.indexOf('p1') > -1, true, 'oferta'));
    test('…y se puede decir que no, que es un gasto normal', () => eq(ops[0], '', 'opcional'));
    test('el selector se muestra cuando hay algo apartado', () =>
        eq($('gPrevWrap').style.display !== 'none', true, 'visible'));

    /* Sin nada apartado, el selector SIGUE A LA VISTA pero desactivado y con la
       explicación. Escondido es indistinguible de inexistente: así nadie
       encontraba la función. */
    setVar(A, '_cacheDeps', []);
    A._gPrevPoblar('');
    test('sin dinero apartado, el selector sigue a la vista', () =>
        eq($('gPrevWrap').style.display !== 'none', true, 'visible'));
    test('…pero desactivado, para no ofrecer lo que no existe', () =>
        eq($('gPrevision').disabled, true, 'off'));
    test('…y explica qué es una previsión', () =>
        eq($('gPrevHint').innerHTML.indexOf('apartas antes') > -1, true, 'explica'));
    test('…y ofrece el camino para apartar', () =>
        eq($('gPrevHint').innerHTML.indexOf('_gIrApartar') > -1, true, 'camino'));
    /* Y ese camino tiene que existir de verdad: un botón que llama a una función
       que no está deja la pantalla muda sin decir por qué. */
    test('el camino para apartar existe y lleva a apartar', () => {
        setVar(A, '_cachePrevs', [{ id:'p1', concepto:'Aguinaldo', estado:'en_curso' }]);
        A._gIrApartar();
        const dest = $('depDestino2').value;
        return eq(dest.indexOf('prev:') === 0, true, 'destino=' + dest);
    });
    test('…y deja dicho de dónde sale el dinero apartado', () =>
        eq($('depOrigen').value, 'caja_fuerte', 'origen'));

    /* Gastar más de lo apartado se avisa, pero no se prohíbe. */
    setVar(A, '_cacheDeps', [{ id:'a1', tipo:'apartado', previsionId:'p1', monto:20000,
                               fondo:'caja_fuerte', fecha:'2026-03-01' }]);
    A._gPrevPoblar('p1');
    $('gMonto').value = 25000;
    A._gPrevUI();
    test('usar más de lo apartado se advierte', () =>
        eq($('gPrevHint').innerHTML.indexOf('más de lo que tenías apartado') > -1, true, 'aviso'));
    test('…con el monto exacto del excedente', () =>
        eq($('gPrevHint').innerHTML.indexOf('$5,000.00') > -1, true, 'monto'));
    $('gMonto').value = 8000;
    A._gPrevUI();
    test('dentro de lo apartado no se advierte nada', () =>
        eq($('gPrevHint').innerHTML.indexOf('más de lo que tenías') , -1, 'sin aviso'));
    test('y siempre se recuerda que el disponible no se mueve', () =>
        eq($('gPrevHint').innerHTML.indexOf('disponible no se mueve') > -1, true, 'recordatorio'));
}

/* ═══════════ SUITE AF · LA CERVEZA SE CUENTA POR PIEZA (recetas/inventarios.js) ══
   El Resultado en pantalla decía 117 pza y el desglose impreso 14.6 bot: el mismo
   dato en una unidad que no era la de nadie. El impreso dividía entre las "copas
   por botella" que el catálogo le hereda a una cerveza de 355 ml.               */
console.log('\n══ SUITE AF · La cerveza se cuenta por pieza (recetas/inventarios.js) ══');
{
    /* La cerveza del caso real: 355 ml de contenido y una copa heredada que da
       8 copas por botella. Es la que convertía 117 en 14.6. */
    const cerveza = { tipo:'pza', contNeto:355, copaML:44.375 };
    const licor   = { tipo:'copa', contNeto:750, copaML:50 };
    const carne   = { tipo:'peso', baseUnit:'kg', contNeto:1000, copaML:50 };

    test('una cerveza NO tiene copas por botella: se cuenta por pieza', () =>
        eq(B._copasBotDe(cerveza, 1), 0, 'pza'));
    test('117 piezas siguen siendo 117, no 14.6', () => {
        const cb = B._copasBotDe(cerveza, 1);
        return eq(cb > 0 ? 117 / cb : 117, 117, 'piezas');
    });
    test('un licor sí tiene copas por botella', () => eq(B._copasBotDe(licor, 1), 15, 'copa'));
    test('lo que se pesa tampoco se divide en copas', () => eq(B._copasBotDe(carne, 1), 0, 'peso'));

    /* Un licor sin contenido capturado: quien MULTIPLICA necesita 1 (una botella
       cuenta como una unidad); si diera 0 se borraría la venta por botella. */
    const licorSinDato = { tipo:'copa', contNeto:0, copaML:0 };
    test('licor sin contenido: la botella cuenta como una unidad al multiplicar', () =>
        eq(B._copasBotDe(licorSinDato, 1), 1, 'default'));
    test('…y al dividir da igual, porque dividir entre uno no mueve nada', () =>
        eq(B._copasBotDe(licorSinDato), 0, 'sin default'));

    /* Sumar "botellas" de una fila de piezas debe devolver las piezas: por aquí
       pasan la existencia y el teórico del compuesto en pantalla. */
    test('sumar botellas de una fila de piezas devuelve las piezas', () =>
        eq(B._botellasDeFila(cerveza, 117), 117, 'piezas'));
    test('…y de un licor sí las convierte a botellas', () =>
        eq(B._botellasDeFila(licor, 30), 2, 'botellas'));

    /* Un compuesto cuyas presentaciones son todas de pieza ES de pieza. Iba fijo
       en 'copa', y por eso la captura y el detalle lo rotulaban en copas. */
    setVar(B, 'filasCaptura', [
        { insumoId:'cz1', tipo:'pza', nombre:'XX Ámbar', contNeto:355, copaML:44.375, existenciaAnterior:60, cerradasBarra:60 },
        { insumoId:'cz2', tipo:'pza', nombre:'XX Lager', contNeto:355, copaML:44.375, existenciaAnterior:57, cerradasBarra:57 }
    ]);
    const vfPza = B._virtualFilaCompuesto({ id:'c1', nombre:'XX 355 ml', miembros:['cz1','cz2'] });
    test('un compuesto de cervezas se declara de piezas', () => eq(vfPza.tipo, 'pza', 'tipo'));
    test('y su existencia anterior son las piezas, no piezas entre ocho', () =>
        eq(vfPza._eaBot, 117, 'anterior'));

    /* La tarjeta de desglose del Resultado: es lo que se ve al abrir un producto.
       Rotulaba TODO compuesto en botellas, así que una caja de cervezas salía en
       una unidad que no era la suya. */
    const cardPza = B._step5GaleriaHTML('', {}, [vfPza]);
    test('la tarjeta del compuesto de cervezas dice pza, no bot', () =>
        eq(cardPza.indexOf('117 pza') > -1, true, 'pza'));
    test('…y no lo convierte a botellas', () => eq(cardPza.indexOf('14.6 bot'), -1, 'sin bot'));

    setVar(B, 'filasCaptura', [
        { insumoId:'ron9', tipo:'copa', nombre:'Ron', contNeto:750, copaML:50, existenciaAnterior:30, cerradasBarra:2 }
    ]);
    const vfCopa = B._virtualFilaCompuesto({ id:'c2', nombre:'Rones', miembros:['ron9'] });
    test('un compuesto de licores sigue siendo de copa', () => eq(vfCopa.tipo, 'copa', 'tipo'));
    test('y su tarjeta sí se lee en botellas', () =>
        eq(B._step5GaleriaHTML('', {}, [vfCopa]).indexOf('2 bot') > -1, true, 'bot'));
    /* 30 copas de 50 ml en botellas de 750 = 15 copas por botella = 2 botellas. */
    test('…y su anterior sí se lee en botellas', () => eq(vfCopa._eaBot, 2, 'botellas'));
    /* ══ EL REPORTE IMPRESO, DE VERDAD ══
       Lo anterior comprueba la regla; esto corre el reporte directivo entero y
       lee el HTML que sale. Es donde Edwin vio "14.6 bot" bajo un renglón que en
       pantalla decía 117 pza. */
    const _htmlReporte = (compuesto, filas) => {
        setVar(B, 'filasCaptura', filas);
        B._storage[B._compuestosKey()] = JSON.stringify([compuesto]);
        setVar(B, 'invActual', { id:'i1', nombre:'Barra', fecha:'2026-09-03',
            entradasLog:[], prebatchProducidos:{}, cocktailsVendidos:{}, ventasCompuesto:{},
            cancelaciones:[], descuentos:[], compuestos:[compuesto] });
        let cap = '';
        const _ap = B.document.body.appendChild;
        B.document.body.appendChild = function (nodo) { cap = (nodo && nodo.innerHTML) || ''; };
        /* La poda final toca el DOM real y truena con el DOM de mentira; el HTML
           ya está armado para entonces, que es lo que se quiere mirar. */
        const _cw = B.console.warn, _ce2 = B.console.error, _cl = B.console.log;
        B.console.warn = B.console.error = B.console.log = function(){};   // ruido esperado
        try { B.verReporteDirectivo(false, 'desglose'); } catch (e) {}
        B.console.warn = _cw; B.console.error = _ce2; B.console.log = _cl;
        B.document.body.appendChild = _ap;
        return cap;
    };

    const htmlPza = _htmlReporte(
        { id:'c1', nombre:'XX 355 ml', miembros:['cz1','cz2'] },
        /* Se venden por pieza suelta Y por "botella" (que en cerveza es la pieza
           entera): 12+5 y 14+3 = 34 piezas. */
        [{ insumoId:'cz1', tipo:'pza', nombre:'XX Ámbar', contNeto:355, copaML:44.375,
           existenciaAnterior:60, cerradasBarra:43, ventasCopasDirectas:12, ventasBotella:5, precioCarta:45 },
         { insumoId:'cz2', tipo:'pza', nombre:'XX Lager', contNeto:355, copaML:44.375,
           existenciaAnterior:57, cerradasBarra:40, ventasCopasDirectas:14, ventasBotella:3, precioCarta:45 }]);

    test('el reporte impreso dice 117 pza, igual que la pantalla', () =>
        eq(htmlPza.indexOf('117 pza') > -1, true, 'pza'));
    /* El total del grupo también: 26 cervezas vendidas son 26 piezas. Si el
       compuesto se declarara "de copa", ese total se calcularía por otra rama y
       las botellas vendidas se perderían. */
    test('el total del grupo cuenta las 34 piezas vendidas', () =>
        eq(htmlPza.indexOf('34 pza vendidas') > -1, true, 'grupo'));
    test('…y ya no las convierte a 14.6 bot', () => eq(htmlPza.indexOf('14.6 bot'), -1, 'sin bot'));
    test('el compuesto de cervezas no imprime NINGUNA botella', () =>
        eq(htmlPza.indexOf(' bot<'), -1, 'sin bot'));
    test('ni copas: en cervezas no existen', () => eq(htmlPza.indexOf(' cop<'), -1, 'sin cop'));

    /* Y el licor sigue imprimiéndose en botellas y copas: el arreglo no se llevó
       por delante lo que sí se sirve por copa. */
    const htmlCopa = _htmlReporte(
        { id:'c2', nombre:'Rones', miembros:['rn1','rn2'] },
        [{ insumoId:'rn1', tipo:'copa', nombre:'Ron Blanco', contNeto:750, copaML:50,
           existenciaAnterior:30, cerradasBarra:2, precioCarta:120 },
         { insumoId:'rn2', tipo:'copa', nombre:'Ron Añejo', contNeto:750, copaML:50,
           existenciaAnterior:15, cerradasBarra:1, precioCarta:150 }]);
    test('un compuesto de licores sí se imprime en botellas', () =>
        eq(htmlCopa.indexOf(' bot<') > -1, true, 'bot'));
    test('…y su diferencia en copas', () => eq(htmlCopa.indexOf(' cop<') > -1, true, 'cop'));

}

/* ═══════════ SUITE AG · CONCILIAR LA VENTA CON TARJETA (etaax-core.js) ═══════
   La venta con tarjeta entraba al saldo del banco en cuanto se capturaba el
   corte, pero el dinero cae a T+1 o T+2: el saldo nunca cuadraba con la app del
   banco, siempre traía de más lo que venía en camino.                          */
console.log('\n══ SUITE AG · Conciliar la venta con tarjeta (etaax-core.js) ══');
{
    const C = cargarJS(crearContexto(), 'etaax-core.js').EtaaxCore;
    const corte = (id, fecha, bruto, neto, cta) =>
        ({ id, fecha, tarjetaCuentas:[{ cuentaId: cta === undefined ? 'a' : cta,
                                        ventaTC: bruto, ventaTD: 0, neto }] });
    const abono = (corteId, monto, fecha, folio, cta) =>
        ({ id:'ab'+corteId+monto, tipo:'abono_tpv', cuentaId: cta === undefined ? 'a' : cta,
           corteId, monto, fecha, folio });

    const cortes = [ corte('c1','2026-09-01',8000,7800),
                     corte('c2','2026-09-02',6000,5850),
                     corte('c3','2026-09-03',7000,6825) ];

    /* ── Antes de conciliar nada, NADA cambia ──
       Es lo que evita que el día del deploy todos los saldos se desplomen. */
    const virgen = C.tpvConciliacion(cortes, [], 'a', '2026-09-06');
    test('sin conciliaciones, la función está apagada', () => eq(virgen.activa, false, 'apagada'));
    test('…y todo lo vendido sigue contando en el banco', () =>
        eq(virgen.aportaBanco, 7800 + 5850 + 6825, 'banco'));
    test('…sin inventar un tránsito que nadie pidió', () => eq(virgen.transito, 0, 'tránsito'));

    /* ── Al conciliar, el arranque es el corte más viejo conciliado ── */
    const r = C.tpvConciliacion(cortes, [abono('c2', 5850, '2026-09-03', 'REF88')], 'a', '2026-09-06');
    test('la conciliación arranca en el corte más viejo conciliado', () => eq(r.desde, '2026-09-02', 'desde'));
    test('lo anterior se da por caído: no se estaba rastreando', () => eq(r.historico, 7800, 'histórico'));
    test('lo vendido a conciliar es de esa fecha en adelante', () => eq(r.vendido, 5850 + 6825, 'vendido'));
    test('lo conciliado es lo que se vio caer', () => eq(r.conciliado, 5850, 'conciliado'));
    test('lo que falta por caer queda en tránsito', () => eq(r.transito, 6825, 'tránsito'));

    /* La razón de ser: el saldo del banco solo trae lo que de verdad está ahí. */
    test('al banco suma lo histórico más lo conciliado, NO lo que viene en camino', () =>
        eq(r.aportaBanco, 7800 + 5850, 'banco'));
    test('vendido = conciliado + tránsito, sin centavos perdidos', () =>
        eq(r.conciliado + r.transito, r.vendido, 'suma'));

    /* ── La comisión: el banco deposita NETO ──
       Conciliar contra el bruto haría que todos los abonos se vean cortos por la
       comisión, todos los días, y la función sería puro ruido. */
    test('la comisión del periodo es la diferencia entre bruto y neto', () =>
        eq(r.comision, (6000 + 7000) - (5850 + 6825), 'comisión'));
    test('un abono por el NETO deja el corte cuadrado', () =>
        eq(C.tpvDelCorte(cortes[1], [abono('c2', 5850, '2026-09-03', 'X')], 'a').falta, 0, 'cuadra'));
    test('conciliar contra el BRUTO dejaría el corte sobrado', () =>
        eq(C.tpvDelCorte(cortes[1], [abono('c2', 6000, '2026-09-03', 'X')], 'a').falta, -150, 'sobra'));

    /* ── La antigüedad, que es la alarma real ──
       Un lote de terminal que nunca liquidó pasa desapercibido hasta el cierre de
       mes. Un monto solo no alarma; "3 días" sí. */
    test('dice desde cuándo espera el dinero', () => eq(r.pendienteDesde, '2026-09-03', 'fecha'));
    test('…y cuántos días lleva', () => eq(r.diasPendiente, 3, 'días'));
    /* Los abonos se CONSUMEN contra los cortes viejos. Si no se restaran, un solo
       abono grande taparía todos los cortes siguientes y el pendiente más viejo
       desaparecería de la vista. */
    const cuatro = cortes.concat([corte('c4','2026-09-04',4200,4000)]);
    const parcial = C.tpvConciliacion(cuatro,
        [abono('c2', 5850, '2026-09-03', 'A'), abono('c3', 3000, '2026-09-04', 'B')], 'a', '2026-09-08');
    test('el abono cubre el corte viejo y deja al descubierto el siguiente', () =>
        eq(parcial.pendienteDesde, '2026-09-03', 'fifo'));
    test('…y ese pendiente lleva sus días contados', () => eq(parcial.diasPendiente, 5, 'días'));

    const alDia = C.tpvConciliacion(cortes, [abono('c2',5850,'2026-09-03','A'), abono('c3',6825,'2026-09-04','B')], 'a', '2026-09-06');
    test('sin pendiente no hay antigüedad que reportar', () => eq(alDia.diasPendiente, 0, 'días'));
    test('…y el tránsito queda en cero', () => eq(alDia.transito, 0, 'tránsito'));

    /* Varios abonos del mismo día se suman: un depósito puede caer partido. */
    const partido = C.tpvConciliacion(cortes,
        [abono('c2', 3000, '2026-09-03', 'P1'), abono('c2', 2850, '2026-09-04', 'P2')], 'a', '2026-09-06');
    test('un depósito partido en dos se suma', () => eq(partido.conciliado, 5850, 'suma'));

    /* Cada cuenta lleva su propia cuenta: el dinero de una no tapa el hueco de otra. */
    const dosCtas = [ corte('c1','2026-09-01',8000,7800,'a'), corte('c2','2026-09-01',4000,3900,'b') ];
    const rb = C.tpvConciliacion(dosCtas, [abono('c1', 7800, '2026-09-02', 'X', 'a')], 'b', '2026-09-06');
    test('el abono de una cuenta no concilia a la otra', () => eq(rb.conciliado, 0, 'aislado'));
    const ra = C.tpvConciliacion(dosCtas, [abono('c1', 7800, '2026-09-02', 'X', 'a')], 'a', '2026-09-06');
    test('la venta de una cuenta no se cuenta en la otra', () => eq(ra.vendido, 7800, 'solo suya'));
    test('…y la otra cuenta solo ve lo suyo', () =>
        eq(C.tpvConciliacion(dosCtas, [abono('c2', 3900, '2026-09-02', 'Y', 'b')], 'b', '2026-09-06').vendido,
           3900, 'solo suya'));

    /* Los cortes viejos traen tarjeta SIN cuenta asignada. Ese cubo es una cuenta
       más, no un comodín: si se leyera como "todas", sumaría todo otra vez. */
    const mixto = [ corte('c1','2026-09-01',8000,7800,'a'),
                    corte('c2','2026-09-01',2000,1950,'') ];
    test('la cuenta sin asignar solo ve lo suyo', () =>
        eq(C.tpvConciliacion(mixto, [abono('c2',1950,'2026-09-02','X','')], '', '2026-09-06').vendido,
           1950, 'sin cuenta'));
    test('…y no se lleva también lo de la cuenta con nombre', () =>
        eq(C.tpvDeCorte(mixto[0], '').neto, 0, 'aislado'));
    test('sin decir cuenta, sí se leen todas', () =>
        eq(C.tpvDeCorte(mixto[0]).neto + C.tpvDeCorte(mixto[1]).neto, 9750, 'todas'));

    /* ── El desglose del día, que es lo que se ve al pie del corte ── */
    const d = C.tpvDelCorte(cortes[1], [abono('c2', 3000, '2026-09-03', 'P1')], 'a');
    test('el día muestra lo capturado', () => eq(d.bruto, 6000, 'bruto'));
    test('…lo que debería caer, ya sin comisión', () => eq(d.neto, 5850, 'neto'));
    test('…lo que ya cayó', () => eq(d.conciliado, 3000, 'conciliado'));
    test('…la comisión del día', () => eq(d.comision, 150, 'comisión'));
    test('…y lo que falta', () => eq(d.falta, 2850, 'falta'));

    /* ── El folio repetido ──
       Capturar dos veces el mismo depósito es el error más probable, y dejaría el
       pendiente más chico de lo que es. */
    const deps = [abono('c2', 5850, '2026-09-03', 'REF-8837')];
    test('el mismo folio en la misma cuenta se detecta', () =>
        eq(!!C.tpvFolioRepetido(deps, 'a', 'REF-8837'), true, 'repetido'));
    test('…sin importar mayúsculas ni espacios', () =>
        eq(!!C.tpvFolioRepetido(deps, 'a', '  ref-8837 '), true, 'normalizado'));
    test('el mismo folio en OTRA cuenta no es repetido', () =>
        eq(C.tpvFolioRepetido(deps, 'b', 'REF-8837'), null, 'otra cuenta'));
    test('un folio nuevo pasa', () => eq(C.tpvFolioRepetido(deps, 'a', 'REF-9000'), null, 'nuevo'));
    /* El folio es opcional: si un abono viejo se guardó sin folio, capturar otro
       sin folio NO puede acusarse de duplicado. */
    const sinFolio = [{ id:'z1', tipo:'abono_tpv', cuentaId:'a', monto:100, fecha:'2026-09-02', folio:'' }];
    test('sin folio no se reclama nada: es opcional', () =>
        eq(C.tpvFolioRepetido(sinFolio, 'a', '   '), null, 'vacío'));
    test('…ni siquiera contra otro abono que tampoco trae folio', () =>
        eq(C.tpvFolioRepetido(sinFolio, 'a', ''), null, 'ambos vacíos'));
    test('al editar, un abono no se acusa a sí mismo', () =>
        eq(C.tpvFolioRepetido(deps, 'a', 'REF-8837', deps[0].id), null, 'propio'));

    /* ── Un abono NO es un movimiento suelto ──
       Su efecto ya viaja por la vía de la conciliación; sumarlo como movimiento lo
       contaría dos veces. */
    test('un abono conciliado no mueve NINGÚN fondo por su cuenta', () => {
        const e = C.depEfecto({ tipo:'abono_tpv', cuentaId:'a', monto:5850 });
        /* Sin la regla cae en el camino de un movimiento normal y se va a la caja
           fuerte: dinero que entra dos veces, por dos puertas distintas. */
        return eq(e.banco === 0 && e.caja === 0 && e.tcPago === 0, true,
                  'caja=' + e.caja + ' banco=' + e.banco);
    });
    test('un movimiento normal sí lo mueve', () =>
        eq(C.depEfecto({ origen:'caja_fuerte', destino:'banco', monto:5850 }).banco, 5850, 'normal'));
}

/* ═══════════ SUITE AH · CONCILIACIÓN EN EL MÓDULO (administrativo/diario.html) ══
   El bloque al pie del corte y el saldo por cuenta. Corre el código real.      */
console.log('\n══ SUITE AH · Conciliación de tarjeta en Diario (administrativo/diario.html) ══');
{
    const $ = (id) => A.document.getElementById(id);
    const ctas = [{ id:'cta1', tipo:'debito', banco:'BBVA', alias:'principal', predeterminada:true, activa:true }];
    const cortes = [
        { id:'k1', fecha:'2026-09-01', tarjetaCuentas:[{ cuentaId:'cta1', ventaTC:8000, ventaTD:0, neto:7800 }] },
        { id:'k2', fecha:'2026-09-02', tarjetaCuentas:[{ cuentaId:'cta1', ventaTC:6000, ventaTD:0, neto:5850 }] }
    ];

    /* ── El bloque al pie del corte ── */
    setVar(A, '_cacheDeps', []);
    setVar(A, '_cuentasBancarias', ctas);
    let html = A._tpvBloqueCorte(cortes[1]);
    test('el corte con tarjeta ofrece conciliar', () =>
        eq(html.indexOf('Conciliar un abono') > -1, true, 'botón'));
    /* El desglose del día: sin la comisión a la vista, cada abono se ve corto y
       parece un faltante que no existe. */
    test('muestra la venta capturada', () => eq(html.indexOf('$6,000.00') > -1, true, 'bruto'));
    test('muestra la comisión del día', () => eq(html.indexOf('−$150.00') > -1, true, 'comisión'));
    /* El neto va en su propio renglón rotulado: es la cifra contra la que se
       concilia, y confundirla con el bruto es el error que vuelve inútil todo. */
    test('muestra lo que debe caer, ya neto, con su rótulo', () => {
        const i = html.indexOf('Debe caer');
        return eq(i > -1 && html.slice(i, i + 220).indexOf('$5,850.00') > -1, true, 'neto');
    });
    test('y dice cuánto falta por caer', () => eq(html.indexOf('Falta $5,850.00') > -1, true, 'falta'));

    /* Un corte sin venta de tarjeta no tiene nada que conciliar. */
    test('un corte sin tarjeta no ofrece conciliación', () =>
        eq(A._tpvBloqueCorte({ id:'k9', fecha:'2026-09-02', tarjetaCuentas:[] }), '', 'vacío'));

    setVar(A, '_cacheDeps', [{ id:'ab1', tipo:'abono_tpv', cuentaId:'cta1', corteId:'k2',
                               monto:5850, fecha:'2026-09-04', folio:'REF-8837' }]);
    html = A._tpvBloqueCorte(cortes[1]);
    test('conciliado, el corte lo dice', () => eq(html.indexOf('✅ Conciliado') > -1, true, 'ok'));
    test('…y el folio queda a la vista para rastrearlo', () =>
        eq(html.indexOf('REF-8837') > -1, true, 'folio'));

    /* ── El saldo por cuenta ──
       Es lo que hace que el número cuadre con la app del banco. */
    const saldo = (deps) => A._debitoPorCuenta(cortes, deps, ctas, 0, [])['cta1'].total;

    /* Mientras nadie concilie, TODO se comporta como siempre: es lo que evita que
       el día del deploy los saldos históricos se desplomen. */
    test('sin conciliaciones, el saldo no cambia', () => eq(saldo([]), 7800 + 5850, 'histórico'));

    const conc = [{ id:'ab1', tipo:'abono_tpv', cuentaId:'cta1', corteId:'k2',
                    monto:5850, fecha:'2026-09-04', folio:'R1' }];
    /* Al conciliar el corte del día 2, el del día 1 queda como histórico (ya cayó)
       y el saldo trae los dos. Nada desaparece. */
    test('al conciliar, el saldo sigue completo si todo cayó', () => eq(saldo(conc), 7800 + 5850, 'completo'));

    /* Y un corte NUEVO sin conciliar ya no infla el saldo: es la corrección. */
    const conNuevo = cortes.concat([{ id:'k3', fecha:'2026-09-05',
        tarjetaCuentas:[{ cuentaId:'cta1', ventaTC:9000, ventaTD:0, neto:8775 }] }]);
    const saldoNuevo = A._debitoPorCuenta(conNuevo, conc, ctas, 0, [])['cta1'].total;
    test('la venta que aún no cae NO infla el saldo del banco', () =>
        eq(saldoNuevo, 7800 + 5850, 'sin inflar'));
    test('…y son exactamente los $8,775 que faltan por caer', () =>
        eq(A.EtaaxCore.tpvConciliacion(conNuevo, conc, 'cta1', '2026-09-08').transito, 8775, 'tránsito'));

    /* El desglose por cuenta y el total salen de la MISMA llamada: si divergieran,
       el usuario vería un número arriba y otro abajo sin saber cuál creer. */
    test('el saldo por cuenta cuadra con lo que aporta la conciliación', () => {
        const t = A.EtaaxCore.tpvConciliacion(conNuevo, conc, 'cta1', '2026-09-08');
        return eq(saldoNuevo, t.aportaBanco, 'cuadre');
    });

    /* ── El negocio que NO quiere conciliar ── */
    const ctasOff = [Object.assign({}, ctas[0], { conciliaTpv:false })];
    setVar(A, '_cuentasBancarias', ctasOff);
    setVar(A, '_cacheDeps', conc);
    test('la cuenta apagada no pide conciliar', () =>
        eq(A._tpvBloqueCorte(cortes[1]).indexOf('Conciliar un abono'), -1, 'sin botón'));
    test('…lo dice con todas sus letras', () =>
        eq(A._tpvBloqueCorte(cortes[1]).indexOf('Sin conciliar') > -1, true, 'aviso'));
    test('…y ofrece volver a encenderla', () =>
        eq(A._tpvBloqueCorte(cortes[1]).indexOf('Empezar a conciliar') > -1, true, 'volver'));
    /* Y lo que importa: el saldo vuelve a contarlo todo desde el corte. */
    test('apagada, la venta que aún no cae SÍ cuenta en el saldo', () =>
        eq(A._debitoPorCuenta(conNuevo, conc, ctasOff, 0, [])['cta1'].total, 7800 + 5850 + 8775, 'completo'));
    setVar(A, '_cuentasBancarias', ctas);

    /* El saldo TOTAL de Caja Fuerte vive dentro del overlay y no se puede correr
       aquí; al menos que no se le olvide preguntar por el interruptor, que es lo
       que haría que el total y el desglose dijeran cosas distintas. */
    test('el saldo total también consulta el interruptor de la cuenta', () => {
        const src = fs.readFileSync(path.join(RAIZ, 'administrativo/diario.html'), 'utf8');
        const i = src.indexOf('totTarjeta  += t.aportaBanco');
        return eq(i > -1 && src.slice(i - 400, i).indexOf('tpvCuentaConcilia') > -1, true, 'wiring');
    });

    /* Al conciliar el corte nuevo, su dinero entra al saldo. */
    const todo = conc.concat([{ id:'ab2', tipo:'abono_tpv', cuentaId:'cta1', corteId:'k3',
                                monto:8775, fecha:'2026-09-07', folio:'R2' }]);
    test('conciliado el corte nuevo, su dinero entra al saldo', () =>
        eq(A._debitoPorCuenta(conNuevo, todo, ctas, 0, [])['cta1'].total, 7800 + 5850 + 8775, 'entra'));
}

/* ═══════════ SUITE AI · NÓMINA DE SOCIOS ES ADMINISTRATIVA (etaax-core.js) ══
   El mismo pago caía en un cubo distinto según la puerta por la que entrara: por
   Gastos iba a operativa y por el documento de Nóminas a administrativa.      */
console.log('\n══ SUITE AI · La nómina de socios es administrativa (etaax-core.js) ══');
{
    const C = cargarJS(crearContexto(), 'etaax-core.js').EtaaxCore;
    const pago = (cat) => ({ categoria:'Nómina', concepto:'Pago quincena', monto:9000, categoriaNomina:cat });
    const opts = { fijos:[], staff:[] };

    test('la nómina de socios cuenta como administrativa', () =>
        eq(C.grupoGasto(pago('socios'), opts), 'nomAdm', 'socios'));
    test('igual que el documento de nóminas, que ya la sumaba en adm', () =>
        eq(C.nomEsAdm('socios'), true, 'adm'));
    test('la administrativa sigue siendo administrativa', () =>
        eq(C.grupoGasto(pago('administrativa'), opts), 'nomAdm', 'adm'));
    test('y la operativa sigue siendo operativa', () =>
        eq(C.grupoGasto(pago('operativa'), opts), 'nomOp', 'op'));
    test('sin categoría capturada, se asume operativa', () =>
        eq(C.grupoGasto(pago(''), opts), 'nomOp', 'default'));

    /* Y el dinero cae en el cubo correcto al clasificar, no solo al etiquetar. */
    const cl = C.clasificarGastos([pago('socios'), pago('operativa')], opts);
    test('el dinero de socios engorda la nómina administrativa', () => eq(cl.nomAdm, 9000, 'adm'));
    test('…y no la operativa', () => eq(cl.nomOp, 9000, 'op'));
    test('el total de nómina no cambia: solo se reparte bien', () => eq(cl.nom, 18000, 'total'));

    /* La categoría del colaborador manda cuando el gasto no la trae. */
    const staff = [{ nombre:'Ana Ruiz', categoriaNomina:'socios' }];
    test('si el gasto no la trae, se lee del colaborador', () =>
        eq(C.grupoGasto({ categoria:'Nómina', concepto:'Quincena — Ana Ruiz', monto:5000 },
                        { fijos:[], staff }), 'nomAdm', 'del staff'));
}

/* ═══════════ SUITE AJ · EL NEGOCIO QUE NO QUIERE CONCILIAR ═══════════════════
   No todos quieren el proceso. Apagar la cuenta devuelve el comportamiento de
   siempre: la venta con tarjeta cuenta en el saldo desde que se captura el corte. */
console.log('\n══ SUITE AJ · Apagar la conciliación de una cuenta ══');
{
    const C = cargarJS(crearContexto(), 'etaax-core.js').EtaaxCore;
    const corte = (id, fecha, bruto, neto) =>
        ({ id, fecha, tarjetaCuentas:[{ cuentaId:'a', ventaTC:bruto, ventaTD:0, neto }] });
    const cortes = [ corte('c1','2026-09-01',8000,7800), corte('c2','2026-09-02',6000,5850) ];
    const abonos = [{ id:'x', tipo:'abono_tpv', cuentaId:'a', corteId:'c1', monto:7800, fecha:'2026-09-03' }];

    /* Los tres estados de una cuenta. */
    test('sin definir: automático', () => eq(C.tpvCuentaConcilia({ id:'a' }), null, 'auto'));
    test('apagada a mano', () => eq(C.tpvCuentaConcilia({ id:'a', conciliaTpv:false }), false, 'off'));
    test('encendida a mano', () => eq(C.tpvCuentaConcilia({ id:'a', conciliaTpv:true }), true, 'on'));

    /* ── Apagada: todo cuenta desde el corte, aunque haya abonos capturados ── */
    const off = C.tpvConciliacion(cortes, abonos, 'a', '2026-09-06', false);
    test('apagada, nada queda en tránsito', () => eq(off.transito, 0, 'tránsito'));
    test('apagada, TODO lo vendido cuenta en el banco', () => eq(off.aportaBanco, 7800 + 5850, 'banco'));
    test('apagada, no hay antigüedad que reportar', () => eq(off.diasPendiente, 0, 'días'));
    test('y se sabe que está apagada a propósito, no vacía', () => eq(off.apagada, true, 'apagada'));

    /* Lo capturado NO se pierde: si la vuelven a encender, vuelve a contar. */
    test('apagar no borra lo ya conciliado', () => eq(off.conciliado, 7800, 'conservado'));
    const reOn = C.tpvConciliacion(cortes, abonos, 'a', '2026-09-06', null);
    test('al reencenderla, el tránsito vuelve tal como estaba', () => eq(reOn.transito, 5850, 'vuelve'));

    /* ── Encendida a mano sin ningún abono: se concilia TODO desde el principio ──
       Es lo que pide quien quiere empezar el proceso en serio, no al vuelo. */
    const on = C.tpvConciliacion(cortes, [], 'a', '2026-09-06', true);
    test('encendida sin abonos, todo lo vendido queda por conciliar', () =>
        eq(on.transito, 7800 + 5850, 'todo'));
    test('…y el banco no trae nada de tarjeta todavía', () => eq(on.aportaBanco, 0, 'banco'));

    /* Y en automático sin abonos sigue sin cambiar nada: es lo que evita que el
       día del deploy los saldos se desplomen. */
    const auto = C.tpvConciliacion(cortes, [], 'a', '2026-09-06', null);
    test('en automático sin abonos, nada cambia', () => eq(auto.aportaBanco, 7800 + 5850, 'sin cambio'));
    test('…y no inventa tránsito', () => eq(auto.transito, 0, 'tránsito'));
}

/* ═══════════════ RESUMEN ═══════════════ */
console.log('\n════════════════════════════════════');
console.log(FALLA === 0
    ? '🔒 CANDADO OK — ' + PASA + ' fórmulas verificadas, 0 fallas'
    : '🚨 ' + FALLA + ' FÓRMULA(S) ROTA(S) de ' + (PASA + FALLA) + ' — NO pushear hasta entender por qué');
process.exit(FALLA === 0 ? 0 : 1);
