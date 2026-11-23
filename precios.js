/* ============================================================================
   ETAAX — MODELO DE COBRO POR SUCURSAL (ago 2026)

   UNA SOLA VERDAD del precio: hub.html (planes, alta de sucursal) y admin.html
   (importe sugerido de la suscripción) delegan aquí. Nunca copiar la tabla ni
   recalcular a mano en una página.

   Regla: el costo unitario de una sucursal es de $1,799/mes, y cada sucursal
   NUEVA entra con un descuento más grande sobre esa base — el descuento NO es
   retroactivo: cada sucursal conserva el precio de su posición y el mensual del
   negocio es la SUMA de esos precios (escalonado).

     #    costo    desc. vs $1,799     acumulado
     1   $1,799        0.00%            $1,799
     2   $1,699        5.56%            $3,498
     3   $1,669        7.23%            $5,167
     4   $1,639        8.89%            $6,806
     5   $1,609       10.56%            $8,415
     6   $1,579       12.23%            $9,994
     7   $1,549       13.90%           $11,543
     8   $1,519       15.56%           $13,062
     9   $1,489       17.23%           $14,551
    10   $1,449       19.46%           $16,000  ← número redondo a propósito

   Los saltos son de $30 salvo dos deliberados: $100 de la 1ª a la 2ª (el gancho
   para abrir la segunda sucursal) y $40 de la 9ª a la 10ª, que es el que cuadra
   el paquete completo en $16,000 exactos.

   De la 11ª en adelante el descuento SE CONGELA: cada sucursal extra cuesta lo
   mismo que la 10ª ($1,449). No hay tope de sucursales — un negocio puede seguir
   abriendo y cada una se cobra a ese precio. (Antes precioMensual se cortaba en 10
   y un negocio con doce pagaba lo mismo que uno con diez: se crecía en servicio
   sin crecer en ingreso.) TOPE ya no es un máximo, es dónde TERMINA LA ESCALERA
   del descuento.
   ============================================================================ */
(function () {
    var BASE = 1799;                 // costo unitario de una sucursal, sin descuento
    var TOPE = 10;                   // hasta dónde baja el descuento; de ahí se congela
    // Costo de la N-ésima sucursal (índice 0 = la 1ª).
    var TABLA = [1799, 1699, 1669, 1639, 1609, 1579, 1549, 1519, 1489, 1449];

    function _n(x) { var v = parseInt(x, 10); return isNaN(v) ? 0 : v; }

    // Costo mensual de la sucursal número n (1 = matriz). De la 11ª en adelante,
    // el precio de la 10ª: la escalera termina ahí y el descuento se congela.
    function precioSucursal(n) {
        n = _n(n); if (n < 1) return 0;
        return TABLA[Math.min(n, TOPE) - 1];
    }
    // Descuento en % de la sucursal n contra el costo unitario base.
    function descuentoSucursal(n) {
        var p = precioSucursal(n);
        return p ? (BASE - p) / BASE * 100 : 0;
    }
    // Ahorro en pesos de la sucursal n contra el costo unitario base.
    function ahorroSucursal(n) {
        var p = precioSucursal(n);
        return p ? BASE - p : 0;
    }
    // Mensual del negocio = SUMA de los precios de cada sucursal (escalonado).
    /* Mensual del negocio = SUMA de los precios de cada sucursal (escalonado).
       NO se corta en 10: las de más allá suman al precio congelado de la 10ª.
       Se calcula sin ciclo largo para que 200 sucursales no cuesten 200 vueltas. */
    function precioMensual(nSucs) {
        nSucs = _n(nSucs);
        if (nSucs < 1) return 0;
        var enEscalera = Math.min(nSucs, TOPE), t = 0;
        for (var i = 1; i <= enEscalera; i++) t += precioSucursal(i);
        if (nSucs > TOPE) t += (nSucs - TOPE) * precioSucursal(TOPE);
        return t;
    }
    // Descuento promedio del paquete completo (lo que trae el negocio hoy).
    function descuentoMensual(nSucs) {
        nSucs = _n(nSucs);
        if (nSucs < 1) return 0;
        var sinDesc = BASE * nSucs;
        return (sinDesc - precioMensual(nSucs)) / sinDesc * 100;
    }
    // Cuánto SUBE el mensual al agregar la siguiente sucursal (= precio de ésa).
    // Cuánto SUBE el mensual al agregar la siguiente (= precio de ésa). Pasando la
    // 10ª ya no devuelve 0 —eso era "se cotiza a mano"—, sino el precio congelado.
    function precioSiguiente(nSucsActuales) {
        return precioSucursal(_n(nSucsActuales) + 1);
    }
    /* ══ LAS APPS DE ETAAX (nov 2026) ═══════════════════════════════════════
       ETAAX se vende como Adobe: cada app por separado o el paquete completo.
       Cada SUCURSAL contrata las suyas; el precio de lista de la sucursal es la
       suma de sus apps (topada en el paquete completo) y sobre ese precio corre
       la MISMA escalera de arriba (la 2ª sucursal con su descuento, etc.).
         · Paquete completo = $1,799 (la tabla de siempre).
         · El puntito de «Cost·ax» es el de etaax: dice de quién es la app.
       Los ids NO se renombran nunca: viven en la base (suscripciones.plan) y en
       page-guard.js (ETAAX_APPS_SUITE), que decide qué se ve. */
    var APPS = [
        { id: 'costax',  nombre: 'Cost\u00b7ax',  precio: 899, lema: 'Costeo, recetas e inventario',
          incluye: 'Escandallos, insumos, inventarios y requisiciones' },
        { id: 'finax',   nombre: 'Fin\u00b7ax',   precio: 999, lema: 'Administración y finanzas',
          incluye: 'Ventas y cortes, gastos, caja fuerte, proveedores, clientes, carta y salud financiera' },
        { id: 'equipax', nombre: 'Equip\u00b7ax', precio: 599, lema: 'Recursos humanos',
          incluye: 'Horarios, checklists, evaluaciones, organigrama, perfiles de puesto y nómina' },
        { id: 'ventax',  nombre: 'Vent\u00b7ax',  precio: 0, lema: 'Punto de venta', proximamente: true },
        { id: 'timbrax', nombre: 'Timbr\u00b7ax', precio: 0, lema: 'Facturación electrónica', proximamente: true }
    ];
    var PAQUETE = { id: 'suite', nombre: 'Paquete completo' };
    /* Anual: se pagan ANUAL_MESES y se usan 12 (Edwin, 23-nov: «paga 9»). */
    var ANUAL_MESES = 9;

    function app(id) { for (var i = 0; i < APPS.length; i++) if (APPS[i].id === id) return APPS[i]; return null; }
    function appsDisponibles() { return APPS.filter(function (a) { return !a.proximamente; }).map(function (a) { return a.id; }); }
    /* Lo que contrata una sucursal: 'suite' o una lista de apps disponibles,
       sin repetidas y en el orden del catálogo. Con TODAS las disponibles es el
       paquete. Vacío no existe: una sucursal sin apps se cobra como paquete. */
    function normalizarApps(sel) {
        if (sel === 'suite' || sel == null) return 'suite';
        var disp = appsDisponibles(), lista = Array.isArray(sel) ? sel : [sel];
        var ok = disp.filter(function (id) { return lista.indexOf(id) !== -1; });
        if (!ok.length || ok.length === disp.length) return 'suite';
        return ok;
    }
    function sumaApps(apps) {
        return apps.reduce(function (t, id) { var a = app(id); return t + (a ? a.precio : 0); }, 0);
    }
    /* Precio de LISTA de una sucursal (antes de la escalera). Nunca más que el
       paquete: dos apps que sumen más que las tres juntas se cobran como paquete. */
    function precioLista(sel) {
        var apps = normalizarApps(sel);
        return apps === 'suite' ? BASE : Math.min(sumaApps(apps), BASE);
    }
    /* ¿Le conviene el paquete? Cuando sus apps ya cuestan lo mismo o más. */
    function convienePaquete(sel) {
        var apps = normalizarApps(sel);
        return apps !== 'suite' && sumaApps(apps) >= BASE;
    }
    /* Mensual de la sucursal en la posición n con esas apps: la escalera es un
       porcentaje sobre el precio de lista (precioSucursal(n) / BASE). */
    function precioSucursalApps(n, sel) {
        var p = precioSucursal(n);
        if (!p) return 0;
        var apps = normalizarApps(sel);
        return apps === 'suite' ? p : Math.round(precioLista(apps) * p / BASE);
    }
    /* El plan de un negocio (suscripciones.plan). NULL = paquete completo,
       mensual, cobro junto: así quedan todos los negocios de antes.
         { ciclo:'mensual'|'anual', cobro:'negocio'|'sucursal',
           base:'suite'|[apps]   ← para las sucursales que no tienen la suya,
           sucursales:{ <sucId>: 'suite'|[apps] } } */
    function planNormal(plan) {
        plan = plan || {};
        var suc = {};
        Object.keys(plan.sucursales || {}).forEach(function (k) { suc[k] = normalizarApps(plan.sucursales[k]); });
        return { ciclo: plan.ciclo === 'anual' ? 'anual' : 'mensual',
                 cobro: plan.cobro === 'sucursal' ? 'sucursal' : 'negocio',
                 base: normalizarApps(plan.base == null ? 'suite' : plan.base), sucursales: suc };
    }
    function appsDe(plan, sucId) {
        var p = planNormal(plan);
        return Object.prototype.hasOwnProperty.call(p.sucursales, sucId) ? p.sucursales[sucId] : p.base;
    }
    function nombreApps(sel) {
        var apps = normalizarApps(sel);
        if (apps === 'suite') return PAQUETE.nombre;
        return apps.map(function (id) { return app(id).nombre; }).join(' + ');
    }
    /* La cotización completa de un negocio: una línea por sucursal (en el orden
       de la lista, que es el que decide su escalón), el mensual y, si el ciclo es
       anual, el anual (paga ANUAL_MESES) y lo que se ahorra. */
    function cotizar(plan, sucursales) {
        var p = planNormal(plan);
        var lista = (sucursales && sucursales.length) ? sucursales : [{ id: 'suc_principal', nombre: 'Matriz' }];
        var lineas = lista.map(function (s, i) {
            var apps = appsDe(p, s.id), m = precioSucursalApps(i + 1, apps);
            return { id: s.id, nombre: s.nombre || (i ? 'Sucursal ' + (i + 1) : 'Matriz'), n: i + 1, apps: apps,
                     paquete: apps === 'suite', nombreApps: nombreApps(apps), mensual: m, anual: m * ANUAL_MESES,
                     convienePaquete: convienePaquete(apps) };
        });
        var mensual = lineas.reduce(function (t, l) { return t + l.mensual; }, 0);
        return { ciclo: p.ciclo, cobro: p.cobro, lineas: lineas, mensual: mensual,
                 anual: mensual * ANUAL_MESES, ahorroAnual: mensual * (12 - ANUAL_MESES),
                 total: p.ciclo === 'anual' ? mensual * ANUAL_MESES : mensual,
                 todoPaquete: lineas.every(function (l) { return l.paquete; }) };
    }
    function fmt(v) { return '$' + Number(v || 0).toLocaleString('en-US'); }
    // "5.6%" — un decimal, sin ceros de relleno (5.56 → 5.6, 12.23 → 12.2).
    function fmtPct(v) { return (Math.round(Number(v || 0) * 10) / 10) + '%'; }

    var API = {
        BASE: BASE, TOPE: TOPE, TABLA: TABLA,
        precioSucursal: precioSucursal,
        descuentoSucursal: descuentoSucursal,
        ahorroSucursal: ahorroSucursal,
        precioMensual: precioMensual,
        descuentoMensual: descuentoMensual,
        precioSiguiente: precioSiguiente,
        APPS: APPS, PAQUETE: PAQUETE, ANUAL_MESES: ANUAL_MESES,
        app: app, appsDisponibles: appsDisponibles, normalizarApps: normalizarApps,
        precioLista: precioLista, convienePaquete: convienePaquete, precioSucursalApps: precioSucursalApps,
        planNormal: planNormal, appsDe: appsDe, nombreApps: nombreApps, cotizar: cotizar,
        fmt: fmt, fmtPct: fmtPct
    };
    if (typeof window !== 'undefined') window.EtaaxPrecios = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
