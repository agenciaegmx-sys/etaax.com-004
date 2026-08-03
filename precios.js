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

   Tope de 10 sucursales (primer año de producción). Un negocio con más se
   cotiza a mano — por eso precioMensual() no inventa precios arriba de 10.
   ============================================================================ */
(function () {
    var BASE = 1799;                 // costo unitario de una sucursal, sin descuento
    var TOPE = 10;                   // máximo de sucursales que el sistema cobra solo
    // Costo de la N-ésima sucursal (índice 0 = la 1ª).
    var TABLA = [1799, 1699, 1669, 1639, 1609, 1579, 1549, 1519, 1489, 1449];

    function _n(x) { var v = parseInt(x, 10); return isNaN(v) ? 0 : v; }

    // Costo mensual de la sucursal número n (1 = matriz). Fuera de rango se
    // recorta al tope: pedir la 11ª devuelve el precio de la 10ª, no inventa.
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
    function precioMensual(nSucs) {
        nSucs = Math.min(_n(nSucs), TOPE);
        var t = 0;
        for (var i = 1; i <= nSucs; i++) t += precioSucursal(i);
        return t;
    }
    // Descuento promedio del paquete completo (lo que trae el negocio hoy).
    function descuentoMensual(nSucs) {
        nSucs = Math.min(_n(nSucs), TOPE);
        if (nSucs < 1) return 0;
        var sinDesc = BASE * nSucs;
        return (sinDesc - precioMensual(nSucs)) / sinDesc * 100;
    }
    // Cuánto SUBE el mensual al agregar la siguiente sucursal (= precio de ésa).
    function precioSiguiente(nSucsActuales) {
        var n = _n(nSucsActuales) + 1;
        return n > TOPE ? 0 : precioSucursal(n);
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
        fmt: fmt, fmtPct: fmtPct
    };
    if (typeof window !== 'undefined') window.EtaaxPrecios = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
