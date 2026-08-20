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
        return {
            id,
            get value() { return values[id] !== undefined ? String(values[id]) : ''; },
            set value(v) { values[id] = v; },
            textContent: '', innerHTML: '', className: '', placeholder: '',
            style: {}, dataset: {},
            classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
            setAttribute(){}, getAttribute(){ return null; }, remove(){},
            appendChild(){}, querySelector(){ return null; },
            querySelectorAll(){ const a = []; a.forEach = Array.prototype.forEach; return a; },
            addEventListener(){}, options: [], selectedIndex: 0,
            childNodes: [{ textContent: '' }], parentElement: { querySelectorAll(){ return []; } },
            closest(){ return null; },
        };
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
test('producción copia↔maestro: la llave de la copia sigue empatando consigo misma', () =>
    eq(B._batchesProducidos('preCopiaSuc'), 24));
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

/* ── AVISO EN PANTALLA de los batches que no van a cuadrar ──
   El caso de la garrafa (rendimiento = capacidad del envase) solo se avisaba por
   console.warn: nadie lo veía y la producción salía inflada en silencio. */
setVar(B, '_cacheRecetasInv', [
    { id: 'srAviso', tipo: 'sub-bebidas', status: 'activa',
      ingredientes: [{ insumoId: 'vinoA', cantidad: 600, unidad: 'ML' }] }, // sin rendimientoFinal
    { id: 'srOk', tipo: 'sub-bebidas', status: 'activa',
      camposExtra: { rendimientoFinal: '900', unidadRendimientoFinal: 'ML' },
      ingredientes: [{ insumoId: 'vinoA', cantidad: 600, unidad: 'ML' }] },
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
test('aviso: sin rendimiento capturado se avisa que se está usando el envase', () =>
    eq(/rendimiento capturado/.test(B._revisarPrebatch(preAviso).probs.join(' ')), true));
test('aviso: con rendimiento en la sub-receta NO se avisa nada', () =>
    eq(B._revisarPrebatch(preOk), null));
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
    test('la 11ª no se cobra sola (se cotiza a mano)', () => eq(P.precioSiguiente(10), 0));
    test('mensual con 12 sucursales se corta en el de 10', () => eq(P.precioMensual(12), 16000));
    test('descuento promedio del paquete de 10 = 11.06%',
        () => eq(P.descuentoMensual(10), 11.0617, 'desc promedio'));
})();

/* ═══════════════ RESUMEN ═══════════════ */
console.log('\n════════════════════════════════════');
console.log(FALLA === 0
    ? '🔒 CANDADO OK — ' + PASA + ' fórmulas verificadas, 0 fallas'
    : '🚨 ' + FALLA + ' FÓRMULA(S) ROTA(S) de ' + (PASA + FALLA) + ' — NO pushear hasta entender por qué');
process.exit(FALLA === 0 ? 0 : 1);
