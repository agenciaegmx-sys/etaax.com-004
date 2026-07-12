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
const A = cargarInline(crearContexto(), 'administrativo/diario.html');
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

test('getEntradasBottles suma filas manuales + log del inventario', () => {
    const f = { ...filaCopa, entradas: ['1', '2'] };
    setVar(B, 'filasCaptura', [f]);
    vm.runInContext("invActual.entradasLog = [{ insumoId: 'ron1', cantidad: 3 }, { insumoId: 'otro', cantidad: 99 }];", B);
    eq(B.getEntradasBottles('ron1'), 6);
    vm.runInContext('invActual.entradasLog = [];', B); setVar(B, 'filasCaptura', [filaCopa]);
});
test('ingredienteML convierte onzas (2 oz = 59.147 ml)', () => eq(B.ingredienteML(2, 'OZ'), 2 * 29.5735));
test('ingredienteML convierte litros', () => eq(B.ingredienteML(1.5, 'LT'), 1500));

/* ═══════════════ RESUMEN ═══════════════ */
console.log('\n════════════════════════════════════');
console.log(FALLA === 0
    ? '🔒 CANDADO OK — ' + PASA + ' fórmulas verificadas, 0 fallas'
    : '🚨 ' + FALLA + ' FÓRMULA(S) ROTA(S) de ' + (PASA + FALLA) + ' — NO pushear hasta entender por qué');
process.exit(FALLA === 0 ? 0 : 1);
