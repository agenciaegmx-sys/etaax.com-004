/* ============================================================
   ETAAX — NÚCLEO DE FÓRMULAS Y UTILIDADES (una sola verdad)
   Cargar con <script src="/etaax-core.js"> ANTES del script de
   la página (patrón insumo-label.js). Las páginas mantienen sus
   nombres locales como alias delgados que delegan aquí — así el
   candado de tests (tests/money-tests.js) verifica UNA fórmula
   y todas las páginas la heredan sin poder divergir.

   Regla: NADA de DOM aquí. Todo recibe sus datos por parámetro
   (las cuentas bancarias, la caja chica del día, los factores…)
   salvo los helpers de contexto que leen localStorage.
   ============================================================ */
(function () {
    'use strict';

    /* ── Utilidades base ─────────────────────────────────────── */
    function n(v) { return parseFloat(v) || 0; }
    function fmtM(v) { return '$' + n(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function fmtN(v) { return n(v).toLocaleString('es-MX'); }
    function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
    function todayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function getNegocioActivo() { return localStorage.getItem('etaax_negocio_activo') || ''; }
    function sucActiva() { return localStorage.getItem('etaax_sucursal_activa') || ''; }
    // Acotar una lista a una sucursal (regla del sistema: sin sello = matriz 'suc_principal')
    function scopeSuc(lista, suc) {
        if (!suc) return lista || [];
        return (lista || []).filter(function (x) { return ((x && x.sucursalId) || 'suc_principal') === suc; });
    }

    /* ── Periodos (día / semana ISO / mes / rango) ───────────── */
    function getWeekStr(d) { var tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); var dn = tmp.getUTCDay() || 7; tmp.setUTCDate(tmp.getUTCDate() + 4 - dn); var ys = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1)); var wn = Math.ceil((((tmp - ys) / 86400000) + 1) / 7); return tmp.getUTCFullYear() + '-W' + String(wn).padStart(2, '0'); }
    function semanaISO(fechaStr) { var d = new Date(fechaStr + 'T12:00:00'); var t = new Date(d.valueOf()); t.setDate(t.getDate() - ((d.getDay() + 6) % 7) + 3); var w1 = new Date(t.getFullYear(), 0, 4); return 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7); }
    function getRange(tipo, val, end) {
        if (tipo === 'dia') return { from: val, to: val };
        if (tipo === 'mes') { var y = parseInt(val.slice(0, 4)), m = parseInt(val.slice(5, 7)); return { from: val + '-01', to: new Date(y, m, 0).toISOString().slice(0, 10) }; }
        if (tipo === 'semana') {
            var p = val.split('-W'), yr = parseInt(p[0]), wk = parseInt(p[1]);
            var j4 = new Date(yr, 0, 4);
            var ws = new Date(j4.getTime() + (wk - 1) * 7 * 86400000); ws.setDate(ws.getDate() - (ws.getDay() || 7) + 1);
            var we = new Date(ws); we.setDate(ws.getDate() + 6);
            return { from: ws.toISOString().slice(0, 10), to: we.toISOString().slice(0, 10) };
        }
        return { from: val, to: end };
    }
    function prevRange(tipo, val, end) {
        var r = getRange(tipo, val, end);
        if (tipo === 'dia') { var d = new Date(r.from + 'T12:00:00'); d.setDate(d.getDate() - 1); return getRange('dia', d.toISOString().slice(0, 10), null); }
        if (tipo === 'mes') { var y = parseInt(val.slice(0, 4)), m = parseInt(val.slice(5, 7)) - 1; if (m === 0) { m = 12; y--; } return getRange('mes', y + '-' + String(m).padStart(2, '0'), null); }
        if (tipo === 'semana') { var p2 = val.split('-W'), yr2 = parseInt(p2[0]), wk2 = parseInt(p2[1]) - 1; if (wk2 === 0) { yr2--; wk2 = 52; } return getRange('semana', yr2 + '-W' + String(wk2).padStart(2, '0'), null); }
        var fromD = new Date(r.from + 'T12:00:00'), toD = new Date(r.to + 'T12:00:00');
        var span = Math.round((toD - fromD) / 86400000) + 1;
        var pe = new Date(fromD); pe.setDate(pe.getDate() - 1);
        var pf = new Date(pe); pf.setDate(pf.getDate() - span + 1);
        return { from: pf.toISOString().slice(0, 10), to: pe.toISOString().slice(0, 10) };
    }
    function inRange(fecha, from, to) { return fecha >= from && fecha <= to; }

    /* ── Dinero del CORTE ────────────────────────────────────── */
    function efNeto(c) { return n(c.efectivo); }                                    // solo la venta en efectivo
    function taBanco(c) { return n(c.tarjeta) + n(c.propTarjeta); }                 // venta + propina → banco (BRUTO)
    function ventasBruta(c) { return n(c.efectivo) + n(c.tarjeta) + n(c.transferencia); }
    function flujoNeto(c) { return efNeto(c) + taBanco(c) + n(c.transferencia); }   // = ef + tarjeta + propTarjeta + transfer
    function propinas(c) { return n(c.propEfectivo) + n(c.propTarjeta); }
    function cheque(c) { var com = n(c.comensales); var ven = n(c.ventaDeclarada) || ventasBruta(c) || (n(c.comedor) + n(c.paraLlevar)); return com > 0 ? ven / com : 0; }
    function resultado(c) { return flujoNeto(c) - n(c.gastos); }
    // Resguardo físico del cajón. cajaChicaDia = gastos de caja chica de la fecha del corte.
    function resguardo(c, cajaChicaDia) { return n(c.fondoInicial) + n(c.efectivo) - n(cajaChicaDia) - n(c.propRetiroCaja) - n(c.retiros); }

    /* ── Comisiones bancarias ────────────────────────────────── */
    // Fracción efectiva (0..1) que descuenta el banco: comisión TC/TD + IVA si aplica.
    function comEf(cta, cual) {
        var base = parseFloat(cual === 'tc' ? cta.comisionTC : cta.comisionTD);
        if (isNaN(base)) return 0;
        var f = cta.aplicaIva ? (1 + (parseFloat(cta.ivaPct) || 0) / 100) : 1;
        return base * f / 100;
    }
    function netoCuenta(cta, tc, td) { return cta ? (tc * (1 - comEf(cta, 'tc')) + td * (1 - comEf(cta, 'td'))) : (tc + td); }
    // Neto que llega al banco por un corte. cuentasDebito = cuentas de débito ordenadas
    // (la predeterminada primero); su [0] da la tasa de la propina y de cortes viejos.
    /* Lo NETO que llega al banco por este corte, DESGLOSADO por cuenta.
       Una sola verdad para el total (taBancoNeto) y para el saldo por cuenta:
       · terminal → del desglose `tarjetaCuentas` (cada cuenta con su comisión);
       · propinas de tarjeta → del desglose `propTarjetaCuentas` si el corte lo trae
         (antes TODAS se neteaban con la tasa de la predeterminada y se le cargaban);
       · lo que no traiga cuenta (cortes viejos, captura parcial) se netea con la
         predeterminada y queda en `sinCuenta` — nunca se pierde ni se duplica. */
    /* Cuenta "de la casa" de UN corte: la que estaba predeterminada cuando se
       capturó, NO la de hoy. Sin esto, cambiar la predeterminada reescribía el
       pasado (se llevaba la atribución y recalculaba comisiones de meses viejos).
       Orden: el sello del corte → la cuenta A de su propio desglose (el formulario
       siempre pone la predeterminada primero) → la predeterminada actual. */
    /* Cuentas de débito listas para las fórmulas, a partir del catálogo tal como
       viene de la nube (ORDEN DE CREACIÓN):
       · la PREDETERMINADA va primero → es la "cuenta A" del corte;
       · la más ANTIGUA queda marcada `esBase` → a ella pertenece el historial que
         no dice de qué cuenta es, porque era la única que existía entonces.
       Antes ese historial seguía a la predeterminada de turno y cambiarla lo mudaba
       de cuenta. Una cuenta nueva empieza su propia historia el día que se registra. */
    // Una cuenta que se dejó de usar se DESACTIVA (activo:'0'), no se borra: su
    // historial sigue contando en los saldos, pero ya no se ofrece para capturar.
    function ctaActiva(c) { return !c || c.activo === undefined || (c.activo !== '0' && c.activo !== false); }
    function cuentasDebito(cuentasBancarias) {
        var todas = (cuentasBancarias || []).filter(function (c) { return c && c.tipo === 'debito'; });
        // La BASE es la de alta más antigua. Con fechaAlta se decide con el dato real;
        // sin ella (cuentas viejas) manda el orden de creación con el que llegan.
        var base = null;
        todas.forEach(function (c, i) {
            if (!base) { base = { c: c, f: c.fechaAlta || '', i: i }; return; }
            var f = c.fechaAlta || '';
            if (base.f && f) { if (f < base.f) base = { c: c, f: f, i: i }; }
            else if (!base.f && f) { /* la que SÍ tiene fecha no desbanca a una sin fecha: la sin fecha es más vieja */ }
            else if (base.f && !f) { base = { c: c, f: '', i: i }; }   // sin fecha = de antes de que existiera el campo
        });
        var baseId = base ? base.c.id : '';
        return todas.slice()
            .sort(function (a, b) { return (b.predeterminada ? 1 : 0) - (a.predeterminada ? 1 : 0); })
            .map(function (c) { return c.id === baseId ? Object.assign({}, c, { esBase: true }) : c; });
    }
    // Solo las que se pueden usar HOY (para los selectores de captura).
    function cuentasDebitoActivas(cuentasBancarias) {
        return cuentasDebito(cuentasBancarias).filter(ctaActiva);
    }
    // La cuenta a la que pertenece lo NO atribuido: la marcada `esBase` (la más
    // antigua) y, si el catálogo no viene marcado, la primera de la lista.
    function ctaBaseCatalogo(cuentasDebito) {
        var ctas = cuentasDebito || [];
        for (var i = 0; i < ctas.length; i++) if (ctas[i] && ctas[i].esBase) return ctas[i];
        return ctas[0] || null;
    }
    function ctaBaseCorte(c, cuentasDebito) {
        var ctas = cuentasDebito || [];
        var buscar = function (id) { for (var i = 0; i < ctas.length; i++) if (ctas[i].id === id) return ctas[i]; return null; };
        var cta = c && c.ctaDefaultId ? buscar(c.ctaDefaultId) : null;
        if (!cta && c && c.tarjetaCuentas && c.tarjetaCuentas.length) cta = buscar(c.tarjetaCuentas[0].cuentaId);
        return cta || ctaBaseCatalogo(ctas);
    }
    function taBancoNetoDetalle(c, cuentasDebito) {
        var ctas = cuentasDebito || [];
        var det = { porCuenta: {}, sinCuenta: 0, ctaBaseId: '' };
        var buscar = function (id) { for (var i = 0; i < ctas.length; i++) if (ctas[i].id === id) return ctas[i]; return null; };
        var addC = function (id, v) { if (!v) return; det.porCuenta[id] = (det.porCuenta[id] || 0) + v; };
        var cta0 = ctaBaseCorte(c, ctas);
        det.ctaBaseId = cta0 ? cta0.id : '';

        // ── Terminal ──
        var brutoDes = 0;
        (c.tarjetaCuentas || []).forEach(function (t) {
            addC(t.cuentaId, parseFloat(t.neto) || 0);
            brutoDes += (parseFloat(t.ventaTC) || 0) + (parseFloat(t.ventaTD) || 0);
        });
        var restoBruto = n(c.tarjeta) - brutoDes;   // sin desglose (corte viejo) o captura parcial
        if (restoBruto > 0.005) det.sinCuenta += cta0 ? netoCuenta(cta0, 0, restoBruto) : restoBruto;

        // ── Propinas de tarjeta ──
        var pc = c.propTarjetaCuentas, propDes = 0;
        if (pc && typeof pc === 'object') {
            Object.keys(pc).forEach(function (id) {
                var m = n(pc[id]); if (!m) return;
                propDes += m;
                var cta = buscar(id);
                addC(id, cta ? netoCuenta(cta, 0, m) : m);
            });
        }
        var propResto = n(c.propTarjeta) - propDes;
        if (propResto > 0.005) det.sinCuenta += cta0 ? netoCuenta(cta0, 0, propResto) : propResto;

        return det;
    }
    function taBancoNeto(c, cuentasDebito) {
        var d = taBancoNetoDetalle(c, cuentasDebito), t = d.sinCuenta;
        for (var k in d.porCuenta) if (d.porCuenta.hasOwnProperty(k)) t += d.porCuenta[k];
        return t;
    }
    function comisionBancoCorte(c, cuentasDebito) { return Math.max(0, taBanco(c) - taBancoNeto(c, cuentasDebito)); }

    /* ── Depósitos / retiros: efecto sobre los fondos ────────── */
    // Compat: depósitos viejos solo tenían `destino` ('banco' implicaba salir de caja fuerte).
    /* Cajón para lo que se aparta sin elegir previsión del catálogo. Es UNO, con
       nombre: un cajón anónimo por captura deja $40,000 apartados que en tres
       meses nadie sabe para qué eran. */
    var PREV_GENERAL = '_general';

    function depEfecto(d) {
        var m = n(d.monto);
        // Apartar es etiquetar, no mover: la caja fuerte no se entera (ver arriba).
        if (esApartado(d)) return { caja: 0, banco: 0, tcPago: 0 };
        /* Un abono de terminal tampoco es un movimiento suelto: es la venta con
           tarjeta que POR FIN cayó. Entra al saldo por la vía de la conciliación
           (tpvConciliacion.aportaBanco); sumarlo aquí la contaría dos veces. */
        if (esAbonoTpv(d)) return { caja: 0, banco: 0, tcPago: 0 };
        var origen = d.origen || (d.destino === 'banco' ? 'caja_fuerte' : 'externo');
        var dest = d.destino || 'caja_fuerte';
        var e = { caja: 0, banco: 0, tcPago: 0 };
        if (dest === 'caja_fuerte') e.caja += m; else if (dest === 'banco') e.banco += m; else if (dest === 'tarjeta_credito') e.tcPago += m;
        if (origen === 'caja_fuerte') e.caja -= m; else if (origen === 'banco') e.banco -= m;
        return e; // destino 'retiro': el dinero deja el negocio (no suma a ningún fondo)
    }
    function esRetiro(d) { return (d && d.destino) === 'retiro'; }

    /* ── PREVISIONES: dinero APARTADO, que no es dinero gastado ────────────────
       Una previsión es una ETIQUETA sobre dinero que ya está en la caja o en el
       banco — no es un lugar donde el dinero vive, ni una forma de pago.

       De ahí sale toda la regla:

       · APARTAR no mueve fondos. El billete sigue físicamente en la caja fuerte,
         solo que ya tiene dueño. Por eso el saldo total NO baja (sigue cuadrando
         con el conteo físico) y lo único que baja es lo DISPONIBLE. Por eso
         `depEfecto` devuelve cero para un apartado: no es un movimiento.

       · APARTAR tampoco es un gasto. El dinero no salió del negocio. Contarlo
         como egreso sería cobrarlo dos veces: al apartar y al pagar.

       · GASTAR sí es el gasto, en el mes en que se paga (ETAAX es flujo de
         efectivo de punta a punta). Si el gasto trae `previsionId`, además baja
         el apartado de esa previsión: la caja fuerte pierde el dinero y la
         previsión pierde el respaldo, así que lo DISPONIBLE no se mueve —que es
         justo lo correcto, porque ese dinero nunca fue tuyo para gastar en otra
         cosa.                                                                    */
    function esApartado(d) { return !!d && d.tipo === 'apartado'; }
    // Fondo donde está parado el dinero apartado: 'caja_fuerte' (default) o 'banco'.
    function apartadoFondo(d) { return (d && d.fondo === 'banco') ? 'banco' : 'caja_fuerte'; }

    /* Saldos por previsión: cuánto se apartó, cuánto se usó y cuánto queda.
       `prevs` = catálogo de previsiones, `deps` = movimientos (los apartados van
       ahí con tipo 'apartado'), `gastos` = gastos ya filtrados por sucursal.
       Todo llega por parámetro: sin DOM, sin localStorage. */
    function previsionSaldos(prevs, deps, gastos) {
        var porId = {};
        function slot(id) {
            if (!porId[id]) porId[id] = { id: id, prevision: null, apartado: 0, usado: 0,
                                          saldo: 0, enCaja: 0, enBanco: 0,
                                          aptCaja: 0, aptBanco: 0 };
            return porId[id];
        }
        (prevs || []).forEach(function (p) { if (p && p.id) slot(p.id).prevision = p; });

        (deps || []).forEach(function (d) {
            if (!esApartado(d)) return;
            var s = slot(d.previsionId || PREV_GENERAL), m = n(d.monto);
            s.apartado += m;
            if (apartadoFondo(d) === 'banco') s.aptBanco += m; else s.aptCaja += m;
        });
        (gastos || []).forEach(function (g) {
            if (!g || !g.previsionId) return;
            slot(g.previsionId).usado += n(g.monto);
        });

        var r = { porId: porId, apartado: 0, usado: 0, saldo: 0, enCaja: 0, enBanco: 0 };
        Object.keys(porId).forEach(function (k) {
            var s = porId[k];
            s.saldo = s.apartado - s.usado;
            /* El saldo se reparte entre caja y banco PROPORCIONAL a cómo se apartó.
               Descontar el uso "del fondo por el que se pagó" suena más fino, pero
               depende del orden en que se capturen los gastos: dos personas
               capturando lo mismo en distinto orden verían saldos distintos. */
            var mix = s.apartado > 0 ? (s.saldo / s.apartado) : 0;
            s.enCaja  = s.aptCaja  * mix;
            s.enBanco = s.aptBanco * mix;
            r.apartado += s.apartado; r.usado += s.usado;
            r.saldo += s.saldo; r.enCaja += s.enCaja; r.enBanco += s.enBanco;
        });
        return r;
    }

    /* ── CONCILIACIÓN DE VENTA CON TARJETA ─────────────────────────────────────
       Hoy la venta con tarjeta entra al saldo del banco en cuanto se captura el
       corte. Pero el dinero cae a T+1 o T+2, así que el saldo NUNCA cuadra con la
       app del banco: siempre trae de más lo que todavía viene en camino.

       Regla nueva: la venta con tarjeta llega al saldo cuando se CONCILIA — cuando
       alguien vio el abono en el banco y anotó su folio. Mientras tanto vive como
       EN TRÁNSITO, a la vista, con su antigüedad.

       El banco deposita el NETO (ya sin comisión). Por eso se concilia contra el
       neto: comparar contra el bruto haría que todos los abonos, todos los días,
       se vean cortos por la comisión, y la función se volvería ruido.

       ¿Desde cuándo cuenta? Desde el corte más viejo que se haya conciliado en esa
       cuenta. Lo anterior se da por caído —no se estaba rastreando— y así el día
       que se enciende la función ningún saldo histórico se desploma. Sin fecha que
       configurar y se corrige solo. */
    function esAbonoTpv(d) { return !!d && d.tipo === 'abono_tpv'; }

    /* Bruto y neto de tarjeta de UN corte en UNA cuenta.
       `cuentaId` null/ausente = TODAS las cuentas. La cadena vacía NO es "todas":
       es el cubo de lo que se capturó sin cuenta asignada, que existe en los
       cortes viejos. Confundirlos hacía que ese cubo sumara todo otra vez. */
    function tpvDeCorte(corte, cuentaId) {
        var r = { bruto: 0, neto: 0 };
        ((corte && corte.tarjetaCuentas) || []).forEach(function (t) {
            if (!t) return;
            if (cuentaId != null && (t.cuentaId || '') !== cuentaId) return;
            r.bruto += n(t.ventaTC) + n(t.ventaTD);
            r.neto  += n(t.neto);
        });
        return r;
    }

    /* Estado de una cuenta: qué se vendió, qué ya cayó, qué falta y desde cuándo.
       `cortes` y `deps` llegan ya filtrados por sucursal. */
    /* ¿Esta cuenta concilia? Tres estados, y el default no cambia nada:
         false → NO concilia nunca: la venta con tarjeta entra al saldo al capturar
                 el corte, como siempre. Para el negocio que no quiere el proceso.
         true  → sí concilia, aunque todavía no haya ningún abono capturado.
         sin definir → automático: concilia desde que se registra el primer abono. */
    function tpvCuentaConcilia(cta) {
        if (!cta || cta.conciliaTpv == null) return null;   // automático
        return !!cta.conciliaTpv;
    }

    function tpvConciliacion(cortes, deps, cuentaId, hoyStr, modo) {
        var abonos = (deps || []).filter(function (d) {
            return esAbonoTpv(d) && (cuentaId == null || (d.cuentaId || '') === cuentaId);
        });
        var conciliado = abonos.reduce(function (t, a) { return t + n(a.monto); }, 0);

        // Cortes de esta cuenta con venta de tarjeta, del más viejo al más nuevo.
        var conVenta = (cortes || []).map(function (c) {
            var v = tpvDeCorte(c, cuentaId);
            return { fecha: c.fecha || '', id: c.id, bruto: v.bruto, neto: v.neto };
        }).filter(function (x) { return x.bruto > 0 || x.neto > 0; })
          .sort(function (a, b) { return (a.fecha || '').localeCompare(b.fecha || ''); });

        /* El arranque: el corte más viejo que ya tiene conciliación. Los cortes de
           antes se dan por caídos. */
        var idsConc = {};
        abonos.forEach(function (a) { if (a.corteId) idsConc[a.corteId] = 1; });
        var desde = '';
        conVenta.forEach(function (x) {
            if (idsConc[x.id] && (!desde || x.fecha < desde)) desde = x.fecha;
        });
        if (!desde) {
            // Conciliaciones sin corte de origen: el arranque es el abono más viejo.
            abonos.forEach(function (a) { if (a.fecha && (!desde || a.fecha < desde)) desde = a.fecha; });
        }

        /* Apagada a mano: nada queda en tránsito y todo lo vendido cuenta en el
           banco desde el corte. Es exactamente el comportamiento de siempre. */
        if (modo === false) desde = '';
        /* Encendida a mano sin ningún abono todavía: se concilia TODO lo que haya,
           así que el arranque es el corte más viejo. */
        if (modo === true && !desde && conVenta.length) desde = conVenta[0].fecha;

        var r = { conciliado: conciliado, desde: desde, historico: 0, vendido: 0,
                  bruto: 0, comision: 0, transito: 0, aportaBanco: 0,
                  pendienteDesde: '', diasPendiente: 0,
                  activa: modo === false ? false : !!desde, apagada: modo === false };
        conVenta.forEach(function (x) {
            if (desde && x.fecha >= desde) { r.vendido += x.neto; r.bruto += x.bruto; }
            else r.historico += x.neto;      // antes de conciliar: se da por caído
        });
        r.comision = Math.max(0, r.bruto - r.vendido);
        r.transito = r.vendido - conciliado;
        /* Lo que suma al banco: lo viejo (ya cayó) + lo que de verdad se vio caer.
           Lo que falta por caer NO suma: es justo lo que descuadraba contra la app
           del banco. */
        r.aportaBanco = r.historico + conciliado;
        /* Apagada: todo lo vendido cuenta y nada queda en tránsito. Sumar además
           lo ya conciliado lo contaría dos veces —el abono es ese mismo dinero. */
        if (modo === false) { r.transito = 0; r.aportaBanco = r.historico; }

        /* Antigüedad: se consumen los abonos contra los cortes del más viejo al más
           nuevo. El primero que no queda cubierto es el que lleva esperando. Un
           monto solo no alarma; "7 días" sí. */
        if (r.transito > 0.005) {
            var resto = conciliado;
            for (var i = 0; i < conVenta.length; i++) {
                var x = conVenta[i];
                if (desde && x.fecha < desde) continue;
                if (resto >= x.neto - 0.005) { resto -= x.neto; continue; }
                r.pendienteDesde = x.fecha; break;
            }
            if (r.pendienteDesde && hoyStr) r.diasPendiente = Math.max(0, diasEntre(r.pendienteDesde, hoyStr) || 0);
        }
        return r;
    }

    /* Lo conciliado de UN corte en UNA cuenta: es el desglose del día que se ve al
       pie del corte (capturado · conciliado · comisión). */
    function tpvDelCorte(corte, deps, cuentaId) {
        var v = tpvDeCorte(corte, cuentaId);
        var conc = (deps || []).reduce(function (t, d) {
            if (!esAbonoTpv(d)) return t;
            if ((d.corteId || '') !== ((corte && corte.id) || '')) return t;
            if (cuentaId != null && (d.cuentaId || '') !== cuentaId) return t;
            return t + n(d.monto);
        }, 0);
        return { bruto: v.bruto, neto: v.neto, conciliado: conc,
                 comision: Math.max(0, v.bruto - v.neto), falta: v.neto - conc };
    }

    /* ¿Este folio ya se capturó en esta cuenta? Capturar dos veces el mismo abono
       es el error más probable, y dejaría el pendiente más chico de lo que es. */
    function tpvFolioRepetido(deps, cuentaId, folio, idPropio) {
        var f = String(folio == null ? '' : folio).trim().toLowerCase();
        if (!f) return null;
        for (var i = 0; i < (deps || []).length; i++) {
            var d = deps[i];
            if (!esAbonoTpv(d) || d.id === idPropio) continue;
            if ((d.cuentaId || '') !== (cuentaId || '')) continue;
            if (String(d.folio || '').trim().toLowerCase() === f) return d;
        }
        return null;
    }

    /* ── METAS: una previsión es una meta de ahorro con fecha ──────────────────
       Antes se capturaba "monto estimado + rango de fechas + N meses" y ninguna
       de las tres cosas movía una cuenta. Una meta sirve cuando responde: ¿cuánto
       me toca apartar esta semana para llegar a tiempo, y voy bien o voy tarde?  */
    var PREV_FREQS = [
        { k: 'semanal',    nom: 'Semanal',    dias: 7 },
        { k: 'quincenal',  nom: 'Quincenal',  dias: 15 },
        { k: 'mensual',    nom: 'Mensual',    meses: 1 },
        { k: 'bimestral',  nom: 'Bimestral',  meses: 2 },
        { k: 'trimestral', nom: 'Trimestral', meses: 3 },
        { k: 'semestral',  nom: 'Semestral',  meses: 6 },
        { k: 'anual',      nom: 'Anual',      meses: 12 }
    ];
    function prevFreq(k) {
        for (var i = 0; i < PREV_FREQS.length; i++) if (PREV_FREQS[i].k === k) return PREV_FREQS[i];
        return PREV_FREQS[2];   // mensual: lo que casi siempre es
    }
    /* Periodos (con fracción) entre dos fechas. Los de días se miden en días; los
       de meses en meses de calendario, porque una meta mensual la piensa la gente
       por mes, no por bloques de 30 días que se van recorriendo. */
    function previsionPeriodos(desde, hasta, freq) {
        var a = fechaLocal(desde), b = fechaLocal(hasta);
        if (!a || !b) return 0;
        var f = prevFreq(freq);
        if (f.dias) return Math.max(0, diasEntre(desde, hasta) / f.dias);
        var meses = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
                  + (b.getDate() - a.getDate()) / 30;
        return Math.max(0, meses / f.meses);
    }

    /* El plan de una meta: el número que de verdad se usa es `porPeriodoAjustado`
       —cuánto apartar de aquí en adelante para llegar—. La cuota original no
       sirve si ya te atrasaste: seguir apartándola te deja corto igual. */
    function previsionPlan(p, apartado, hoyStr) {
        p = p || {};
        var objetivo = n(p.montoObjetivo != null ? p.montoObjetivo : p.montoEstimado);
        var apt = n(apartado);
        var hoy = hoyStr || fechaStr(new Date());
        var ini = p.fechaInicio || '', fin = p.fechaObjetivo || p.fechaFin || '';
        var freq = p.periodicidad || 'mensual';
        var r = {
            objetivo: objetivo, apartado: apt,
            falta: Math.max(0, objetivo - apt),
            pct: objetivo > 0 ? Math.min(100, apt / objetivo * 100) : 0,
            periodicidad: freq, freqNom: prevFreq(freq).nom,
            conFecha: !!(ini && fin),
            periodos: 0, transcurridos: 0, restantes: 0,
            porPeriodo: 0, porPeriodoAjustado: 0,
            deberiaLlevar: 0, diferencia: 0, estado: 'sin_fecha', vencida: false
        };
        if (apt >= objetivo && objetivo > 0) r.estado = 'cumplida';
        if (!r.conFecha) return r;   // sin fechas no hay ritmo que medir, solo avance

        r.periodos    = Math.max(1, Math.ceil(previsionPeriodos(ini, fin, freq)));
        r.transcurridos = Math.max(0, Math.min(r.periodos, Math.floor(previsionPeriodos(ini, hoy, freq))));
        r.restantes   = r.periodos - r.transcurridos;   // transcurridos ya viene topado
        r.porPeriodo  = objetivo / r.periodos;
        r.vencida     = hoy > fin;
        /* Pasada la fecha objetivo esto da el objetivo COMPLETO solito: los
           periodos transcurridos vienen topados al total, y la cuota por el total
           es la meta. Por eso no hay una rama aparte para las vencidas. */
        r.deberiaLlevar = r.porPeriodo * r.transcurridos;
        r.diferencia  = apt - r.deberiaLlevar;
        r.porPeriodoAjustado = r.restantes > 0 ? (r.falta / r.restantes) : r.falta;

        if (r.estado !== 'cumplida') {
            r.estado = r.diferencia < -0.005 ? 'atrasado'
                     : r.diferencia >  0.005 ? 'adelantado' : 'al_corriente';
        }
        return r;
    }

    /* Lo apartado DENTRO de un periodo: esto es lo que la utilidad del mes deja
       de tener disponible. Antes se sumaba el monto PLANEADO de toda previsión
       cuyo rango tocara el periodo, así que una meta anual de $60,000 se restaba
       completa los 12 meses —$720,000 de utilidad borrada por una reserva de
       $60,000—, y en una vista de un día se restaba igual de completa. */
    function previsionApartadoRango(deps, desde, hasta) {
        return (deps || []).reduce(function (t, d) {
            if (!esApartado(d)) return t;
            var f = d.fecha || '';
            if (desde && f < desde) return t;
            if (hasta && f > hasta) return t;
            return t + n(d.monto);
        }, 0);
    }
    /* Del gasto del periodo, cuánto venía respaldado por una previsión. El gasto
       cuenta completo como egreso (es flujo); esto solo dice de dónde salió, para
       que diciembre no parezca una catástrofe cuando el aguinaldo estaba fondeado. */
    function previsionUsadoRango(gastos, desde, hasta) {
        return (gastos || []).reduce(function (t, g) {
            if (!g || !g.previsionId) return t;
            var f = g.fecha || '';
            if (desde && f < desde) return t;
            if (hasta && f > hasta) return t;
            return t + n(g.monto);
        }, 0);
    }

    /* ── Metas de venta (distribución mensual → diaria) ──────── */
    var DIA_FACTORES_DEFAULT = [0.7, 0.85, 0.9, 0.9, 0.95, 1.4, 1.3]; // Dom..Sáb (getDay)
    // Días en que opera el negocio, indexado por getDay() (0=Dom … 6=Sáb).
    // sucursalId: '' = unión de todas las sucursales activas; con id = SOLO esa.
    // Devuelve null si nadie tiene días configurados (= opera todos los días).
    function diasOperativos(negId, sucursalId) {
        if (!negId) return null;
        var sucs = [];
        try { sucs = JSON.parse(localStorage.getItem('etaax_' + negId + '_sucursales') || '[]'); } catch (e) {}
        if (sucursalId) sucs = sucs.filter(function (s) { return s && s.id === sucursalId; });
        var operLD = [false, false, false, false, false, false, false], hay = false; // Lun..Dom
        sucs.forEach(function (suc) {
            if (!suc || suc.activa === false) return;
            var cfg = {};
            try { cfg = JSON.parse(localStorage.getItem('etaax_' + negId + '_suc_' + suc.id) || '{}'); } catch (e) {}
            if (cfg && Array.isArray(cfg.dias) && cfg.dias.length === 7) { hay = true; for (var i = 0; i < 7; i++) if (cfg.dias[i]) operLD[i] = true; }
        });
        if (!hay) return null;
        var oper = []; for (var d = 0; d < 7; d++) oper[d] = operLD[(d + 6) % 7]; // Lun..Dom → getDay()
        return oper;
    }
    function operaDow(oper, dow) { return !oper || oper[dow]; }
    // Reparte la meta mensual por día. oper/factores llegan por parámetro (puras).
    function calcMetaDiaria(mesStr, metaMensual, dist, manualDays, oper, factores) {
        var y = parseInt(mesStr.slice(0, 4)), m = parseInt(mesStr.slice(5, 7));
        var diasEnMes = new Date(y, m, 0).getDate();
        var result = {}, i, f, dw;
        if (dist === 'manual' && manualDays) {
            for (i = 1; i <= diasEnMes; i++) { f = mesStr + '-' + String(i).padStart(2, '0'); result[f] = n(manualDays[f]); }
        } else if (dist === 'uniforme') {
            var nOper = 0;
            for (i = 1; i <= diasEnMes; i++) { if (operaDow(oper, new Date(y, m - 1, i).getDay())) nOper++; }
            if (nOper === 0) nOper = diasEnMes;
            for (i = 1; i <= diasEnMes; i++) { f = mesStr + '-' + String(i).padStart(2, '0'); result[f] = operaDow(oper, new Date(y, m - 1, i).getDay()) ? metaMensual / nOper : 0; }
        } else {
            var fac = factores || DIA_FACTORES_DEFAULT, sumF = 0;
            for (i = 1; i <= diasEnMes; i++) { dw = new Date(y, m - 1, i).getDay(); if (operaDow(oper, dw)) sumF += fac[dw]; }
            if (sumF <= 0) return calcMetaDiaria(mesStr, metaMensual, 'uniforme', null, oper, fac);
            for (i = 1; i <= diasEnMes; i++) { f = mesStr + '-' + String(i).padStart(2, '0'); dw = new Date(y, m - 1, i).getDay(); result[f] = operaDow(oper, dw) ? (fac[dw] / sumF) * metaMensual : 0; }
        }
        return result;
    }

    /* ── Plan de pago de un GASTO FIJO recurrente ──────────────────
       fechaRef 'YYYY-MM-DD' = pago de referencia / inicio del ciclo.
       per: quincenal|mensual|bimestral|trimestral|semestral|anual.
       hoy 'YYYY-MM-DD'; ultimoPago 'YYYY-MM-DD' o '' (pago real más reciente).
       Calcula el vencimiento del ciclo vigente, si ya se pagó y la próxima fecha.
       `dias` = días hasta el pago que TOCA hacer (≤0 vencido/hoy; >0 por venir).
       PAGO ANTICIPADO: pagar unos días ANTES del vencimiento sigue siendo el pago
       de ESE ciclo. Se acepta hasta ANTICIPO_DIAS antes, nunca más de la mitad del
       ciclo, para no confundirlo con un pago tardío del ciclo anterior. */
    var PERIODO_MESES = { mensual:1, bimestral:2, trimestral:3, semestral:6, anual:12 };
    var ANTICIPO_DIAS = 10;
    function _pfParse(s){ if(!s) return null; var p=String(s).slice(0,10).split('-'); if(p.length<3) return null; var d=new Date(+p[0],+p[1]-1,+p[2],12,0,0); return isNaN(d.getTime())?null:d; }
    function _pfFmt(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    function _pfAddMonths(ref, k){ var dia=ref.getDate(), m=ref.getMonth()+k, yy=ref.getFullYear()+Math.floor(m/12), mm=((m%12)+12)%12, ult=new Date(yy,mm+1,0).getDate(); return new Date(yy,mm,Math.min(dia,ult),12,0,0); }
    function _pfDias(a,b){ return Math.round((a-b)/86400000); }
    function planFijoPago(fechaRef, per, hoy, ultimoPago){
        var ref=_pfParse(fechaRef); if(!ref) return { programado:false };
        var h=_pfParse(hoy)||_pfParse(todayStr()); per=(per||'mensual').toLowerCase();
        var up=_pfParse(ultimoPago);
        var quinc=(per==='quincenal'), step=PERIODO_MESES[per]||1;
        // ocurrencia i-ésima del calendario de pagos (i puede ser 0,1,2…)
        var occ=function(i){ return quinc ? new Date(ref.getTime()+i*15*86400000) : _pfAddMonths(ref, i*step); };
        var i=0, guard=0; while(occ(i+1)<=h && guard++<6000) i++;
        var idx = (occ(0)<=h) ? i : -1;                 // -1 = la referencia aún no llega
        var venceEste = idx>=0 ? occ(idx) : null;       // el vencimiento del ciclo vigente
        var proximo   = occ(idx+1);                     // el siguiente del calendario
        var menos=function(d,n){ return new Date(d.getTime()-n*86400000); };
        var ciclo = Math.max(1, _pfDias(venceEste?proximo:occ(idx+2), venceEste||proximo));
        var antic = Math.max(0, Math.min(ANTICIPO_DIAS, Math.floor(ciclo/2)));
        var desde = menos(venceEste||proximo, antic);   // desde aquí un pago ya cuenta para ese ciclo
        var pagadoEste = !!(venceEste && up && up>=desde);
        // Ref futura (aún no vence) pero YA se pagó por adelantado → el pendiente es el de después.
        var pagadoProx = !!(!venceEste && up && up>=desde);
        if(pagadoProx) proximo = occ(idx+2);
        var objetivo = (venceEste && !pagadoEste) ? venceEste : proximo;
        var dias = _pfDias(objetivo, h);
        var pagado = pagadoEste || pagadoProx;
        var estado = pagado ? 'pagado' : (!venceEste ? 'programado' : (dias===0 ? 'vence_hoy' : (dias<0 ? 'vencido' : 'por_pagar')));
        return { programado:true, estado:estado, pagado:pagado, dias:dias,
                 objetivo:_pfFmt(objetivo), venceEste:venceEste?_pfFmt(venceEste):'', proximo:_pfFmt(proximo), ultimoPago:up?_pfFmt(up):'',
                 aceptaDesde:_pfFmt(desde), anticipado:!!(pagado && up<(venceEste||occ(idx+1))) };
    }

    /* ── Clasificación de GASTOS — UNA sola verdad para los 4 módulos ──────────
       (Gastos Totales, KPIs, Estadísticas, Gastos Diarios). Reglas confirmadas:
        · propinas/gratificaciones = pass-through (NUNCA gasto → cubo aparte).
        · nómina/personal + IMSS = cubo Nómina (IMSS a operativa por convención del caller).
        · pagos de fijos del catálogo + categorías de naturaleza fija (renta, luz,
          internet, agua, gas, servicios, software…) = cubo Fijo.
        · el resto (INCLUIDOS impuestos y contabilidad) = Variable.
        · la comisión bancaria de los cortes se SUMA como Variable (opts.comisionBanco).
        · Previsiones NO entran (son reserva; van aparte del egreso del mes).
       `gastos` llega YA filtrado por periodo y sucursal. */
    function _catKey(s){ return String(s == null ? '' : s).toLowerCase().trim(); }
    function _gnorm(s){ return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
    function gastoEsIMSS(g){ return /\bimss\b|seguro\s*social|cargas\s*sociales/i.test(((g && g.categoria) || '') + ' ' + ((g && g.concepto) || '')); }
    function gastoEsNomina(g){ return /n[oó]mina|personal/i.test((g && g.categoria) || ''); }
    function gastoEsPropina(g){ return /propina|gratificaci/i.test((g && g.categoria) || ''); }
    function gastoEsFijoPat(g){ return /renta|arrendamiento|servicio|\bagua\b|\bluz\b|electric|energ[ií]a|internet|telecom|tel[eé]fon|\bgas\b|predial|software|suscripci/i.test((g && g.categoria) || ''); }
    function gastoEsPagoFijo(g, fijos){
        fijos = fijos || [];
        for (var i = 0; i < fijos.length; i++) {
            var f = fijos[i]; if (!f) continue;
            if (g.fijoId) { if (g.fijoId === f.id) return true; continue; }
            if (_gnorm(g.concepto) !== _gnorm(f.concepto)) continue;
            if (!f.proveedor || _gnorm(g.proveedor) === _gnorm(f.proveedor)) return true;
        }
        return false;
    }
    // ¿Esta categoría de nómina va al cubo administrativo? Socios sí: no producen
    // el servicio, y así lo cuenta también el documento de nóminas.
    function _nomEsAdm(cat){ return cat === 'administrativa' || cat === 'socios'; }
    function nomTipoGasto(g, staff){
        if (g.categoriaNomina) return g.categoriaNomina;
        var c = String(g.concepto || ''), ix = c.lastIndexOf('—');
        var name = ix >= 0 ? c.slice(ix + 1).trim() : '';
        if (name && staff) { for (var i = 0; i < staff.length; i++) { var s = staff[i]; if (s && _gnorm(s.nombre) === _gnorm(name)) return s.categoriaNomina || (s.rol === 'administrativo' ? 'administrativa' : 'operativa'); } }
        return 'operativa';
    }
    /* Grupo al que pertenece UN gasto. Es la regla de clasificarGastos extraída para
       poder desglosar (reportes, tablas) sin recalcular a mano y sin divergir:
       'propina' | 'fijo' | 'nomOp' | 'nomAdm' | 'imss' | 'variable'. */
    function grupoGasto(g, opts) {
        opts = opts || {};
        var fijos = opts.fijos || [], staff = opts.staff || [];
        if (!g) return 'variable';
        if (gastoEsPropina(g)) return 'propina';                    // pass-through: fuera del gasto
        if (gastoEsPagoFijo(g, fijos)) return 'fijo';               // pago de un fijo del catálogo
        if (gastoEsIMSS(g)) return 'imss';
        /* SOCIOS cuenta como administrativa, igual que en el documento de nóminas
           (que ya sumaba socios en `adm`). Aquí se comparaba solo contra
           'administrativa', así que el mismo pago caía en operativa si entraba por
           Gastos y en administrativa si entraba por Nóminas: dos cubos distintos
           para el mismo dinero, según la puerta. */
        if (gastoEsNomina(g)) return _nomEsAdm(nomTipoGasto(g, staff)) ? 'nomAdm' : 'nomOp';
        if (!opts._catsFijos) {                                     // memo: se arma una sola vez por llamada
            var cf = {};
            for (var k = 0; k < fijos.length; k++) if (fijos[k] && fijos[k].categoria) cf[_catKey(fijos[k].categoria)] = 1;
            opts._catsFijos = cf;
        }
        if (opts._catsFijos[_catKey(g.categoria)] || gastoEsFijoPat(g)) return 'fijo'; // fijo no catalogado
        return 'variable';                                          // resto (incl. impuestos/contabilidad)
    }
    // Grupo "grueso" para mostrar: fijo | nom | variable | propina
    function grupoGastoUI(g, opts) {
        var t = grupoGasto(g, opts);
        return (t === 'nomOp' || t === 'nomAdm' || t === 'imss') ? 'nom' : t;
    }
    function clasificarGastos(gastos, opts){
        opts = opts || {};
        var r = { fijo: 0, nomOp: 0, nomAdm: 0, imss: 0, variable: 0, propina: 0 };
        (gastos || []).forEach(function (g) {
            if (!g) return;
            var m = n(g.monto);
            r[grupoGasto(g, opts)] += m;   // una sola regla, compartida con los reportes
        });
        r.variable += n(opts.comisionBanco);                                   // comisión bancaria = variable
        r.nom = r.nomOp + r.nomAdm + r.imss;                                   // nómina total (IMSS incluido)
        r.egresos = r.fijo + r.nom + r.variable;                              // egreso del mes (SIN previsiones)
        return r;
    }

    /* ── COSTEO DE RECETA: múltiplo sobre el costo bruto ───────────────────────────
       Regla histórica: costo bruto 30% → precio de platillo = costo / 0.30 (múltiplo
       3.333…), gasto operativo 40%, utilidad neta el resto. El múltiplo ahora es
       EDITABLE por receta (un pastel para llevar lleva un múltiplo menor), pero el
       gasto operativo se mantiene fijo en 40% y la utilidad neta sale de la resta.
       Sin múltiplo guardado se usa el default exacto 1/0.30 — así las recetas viejas
       no cambian ni un centavo.
         m = 2.5  →  costo bruto 40% · gasto op 40% · utilidad neta 20%              */
    var COSTEO_GASTO_OP_PCT = 40;    // fijo (por ahora no editable)
    /* ══ COBRO DE LA SUSCRIPCIÓN: fecha de corte y días de tolerancia ══════════
       Una sola verdad para "¿este negocio está al corriente?". La misma regla vive
       además en SQL (negocio_esta_activo), porque el gate no puede depender de que
       el navegador la calcule bien; aquí se usa para lo que la pantalla necesita
       decir —cuántos días le quedan, si ya está en tolerancia— y para el panel.
       Si un día cambia la regla, se cambia en los dos lados y su test lo cacha. */
    var TOLERANCIA_DEFAULT = 3;   // días de gracia tras la fecha de corte

    // Fecha (YYYY-MM-DD) → Date en hora local a medianoche. Sin esto, `new Date('2026-09-23')`
    // se interpreta como UTC y en México cae un día antes: el corte se adelantaba 24 h.
    function fechaLocal(s) {
        if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
        var p = String(s || '').slice(0, 10).split('-');
        if (p.length !== 3) return null;
        var d = new Date(+p[0], +p[1] - 1, +p[2]);
        return isNaN(d.getTime()) ? null : d;
    }
    function fechaStr(d) {
        return d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
    }
    function diasEntre(a, b) {   // días completos de a → b (b − a)
        var x = fechaLocal(a), y = fechaLocal(b);
        if (!x || !y) return null;
        return Math.round((y - x) / 86400000);
    }
    /* Siguiente fecha de cobro a partir de un DÍA ANCLA del mes. El día se recorta al
       último día del mes cuando no existe: un negocio anclado al 31 cobra el 28 en
       febrero (o el 29 en bisiesto) y vuelve al 31 en marzo — el ancla NO se pierde,
       que es el error clásico de ir sumando "un mes" sobre la última fecha cobrada. */
    function proximoCobro(diaCobro, desde) {
        var dia = Math.min(31, Math.max(1, Math.round(n(diaCobro)) || 1));
        var base = fechaLocal(desde || todayStr());
        if (!base) return '';
        function enMes(anio, mes) {                       // mes 0-11
            var ultimo = new Date(anio, mes + 1, 0).getDate();
            return new Date(anio, mes, Math.min(dia, ultimo));
        }
        var cand = enMes(base.getFullYear(), base.getMonth());
        if (cand <= base) cand = enMes(base.getFullYear(), base.getMonth() + 1);
        return fechaStr(cand);
    }
    /* Estado de cobro de un negocio. `sub` = { estado, proximoCobro, diasTolerancia }.
       · activo        → puede usar la app (incluye los días de tolerancia)
       · enTolerancia  → ya venció pero todavía no se corta: es la ventana para avisar
       · diasRestantes → hasta el corte REAL (fecha + tolerancia). Negativo = ya cortado. */
    function estadoCobro(sub, hoy) {
        var s = sub || {};
        var estado = s.estado || 'pendiente';
        var tol    = Math.max(0, Math.round(n(s.diasTolerancia != null ? s.diasTolerancia : TOLERANCIA_DEFAULT)));
        var corte  = s.proximoCobro ? String(s.proximoCobro).slice(0, 10) : '';
        var hoyS   = hoy ? String(hoy).slice(0, 10) : todayStr();
        if (estado === 'cancelada' || !corte) {
            return { activo:false, enTolerancia:false, vencido:estado !== 'pendiente',
                     diasRestantes:null, diasVencido:null, corte:corte, tolerancia:tol, estado:estado };
        }
        var aCorte  = diasEntre(hoyS, corte);             // >0 faltan, 0 hoy, <0 ya pasó
        var limite  = fechaStr(new Date(fechaLocal(corte).getTime() + tol * 86400000));
        var aLimite = diasEntre(hoyS, limite);
        var activo  = estado === 'activa' && aLimite >= 0;
        return {
            activo: activo,
            enTolerancia: activo && aCorte < 0,           // ya venció, sigue dentro de la gracia
            vencido: aCorte < 0,
            diasRestantes: aLimite,                        // hasta el corte real
            diasVencido: aCorte < 0 ? -aCorte : 0,
            corte: corte, limite: limite, tolerancia: tol, estado: estado
        };
    }

    var COSTEO_IVA_PCT      = 16;
    var COSTEO_DELIVERY_PCT = 40;    // recargo de delivery sobre el precio de platillo
    var COSTEO_MULT_DEFAULT = 1 / 0.30;
    function multiploReceta(r) {
        var m = n(r && (r.multiploCosteo != null ? r.multiploCosteo : r));   // acepta receta o número
        return m > 0 ? m : COSTEO_MULT_DEFAULT;
    }
    function costeoReceta(costo, multiplo) {
        var c = n(costo), m = multiploReceta(multiplo);
        var platillo = c > 0 ? c * m : 0;
        var brutoPct = 100 / m;                                    // el múltiplo ES el inverso del % de costo
        var utilPct  = 100 - brutoPct - COSTEO_GASTO_OP_PCT;       // puede salir negativa: es el aviso de que el múltiplo no da
        return {
            multiplo: m, costoBruto: c, platillo: platillo,
            brutoPct: brutoPct, gastoOpPct: COSTEO_GASTO_OP_PCT, utilidadPct: utilPct,
            gastoOp:  platillo * (COSTEO_GASTO_OP_PCT / 100),
            utilidad: platillo * (utilPct / 100),
            iva:      platillo * (COSTEO_IVA_PCT / 100),
            comedor:  platillo * (1 + COSTEO_IVA_PCT / 100),
            delivery: platillo * (1 + (COSTEO_IVA_PCT + COSTEO_DELIVERY_PCT) / 100),
        };
    }

    /* ── IMPORTE CON LETRA (recibos) ───────────────────────────────────────────────
       Todo recibo lleva el monto escrito: es lo que impide que alguien le agregue un
       dígito al número. Formato mexicano: "MIL DOSCIENTOS PESOS 50/100 M.N.".        */
    var _LT_U = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
                 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE',
                 'DIECIOCHO', 'DIECINUEVE', 'VEINTE'];
    var _LT_D = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
    var _LT_C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
                 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
    function _letraCentena(x) {                       // 0..999
        if (x === 0) return '';
        if (x === 100) return 'CIEN';
        var c = Math.floor(x / 100), r = x % 100, out = _LT_C[c];
        if (r === 0) return out;
        var dec;
        if (r <= 20) dec = _LT_U[r];
        else if (r < 30) dec = 'VEINTI' + _LT_U[r - 20];
        else { var d = Math.floor(r / 10), u = r % 10; dec = _LT_D[d] + (u ? ' Y ' + _LT_U[u] : ''); }
        return (out ? out + ' ' : '') + dec;
    }
    function importeLetra(monto, moneda) {
        var v = Math.abs(n(monto));
        var ent = Math.floor(v + 1e-9);
        var cent = Math.round((v - ent) * 100);
        if (cent === 100) { cent = 0; ent += 1; }      // 9.999 → DIEZ PESOS 00/100
        var txt;
        if (ent === 0) txt = 'CERO';
        else {
            var mill = Math.floor(ent / 1000000), miles = Math.floor((ent % 1000000) / 1000), resto = ent % 1000;
            var p = [];
            if (mill) p.push(mill === 1 ? 'UN MILLÓN' : _letraCentena(mill) + ' MILLONES');
            if (miles) p.push(miles === 1 ? 'MIL' : _letraCentena(miles) + ' MIL');
            if (resto) p.push(_letraCentena(resto));
            txt = p.join(' ');
        }
        var neg = n(monto) < 0 ? 'MENOS ' : '';
        return neg + txt + ' ' + (moneda || 'PESOS') + ' ' + String(cent).padStart(2, '0') + '/100 M.N.';
    }

    /* ══ EL SUELDO DE UN COLABORADOR ═══════════════════════════════════════
       Estaba escrito TRES veces —el módulo que paga, el que proyecta y el
       simulador— y las tres no decían lo mismo: el simulador no caía al mínimo
       del negocio ni sabía de los colaboradores sin costo, así que su nómina
       salía distinta de la que se pagaba. Aquí vive la única versión.

       El ORDEN importa y es deliberado:
       1) sin costo para el negocio — becarios de Jóvenes Construyendo el Futuro
          (les paga el gobierno), practicantes, familiares. Va PRIMERO, incluso
          antes de un sueldo viejo que hubiera quedado capturado: si no, se le
          pagaría de la caja a quien no hay que pagarle.
       2) el sueldo de su ficha, incluido un CERO capturado a propósito.
       3) el mínimo del negocio, solo si nunca se le capturó nada. Devolver cero
          ahí haría que la proyección saliera más baja que la realidad, y un
          renglón en cero nadie lo revisa: parece que ese colaborador no cuesta.

       `sueldoCapturado` es lo que separa "puse cero" de "nunca lo llené":
       parseFloat('') || 0 los vuelve idénticos, y sin esa marca un cero escrito
       a mano se ignoraba y se sustituía por el mínimo. Los registros viejos no
       la traen, así que se siguen comportando igual que siempre. */
    function sueldoDiarioEfectivo(s, salarioDiarioDefault) {
        if (!s) return 0;
        if (s.sinCostoNegocio) return 0;
        var cap = !!s.sueldoCapturado;
        if (s.esquemaSueldo === 'diario') {
            var d = n(s.sueldoDiario);
            if (d > 0 || cap) return d;
        } else {
            var b = n(s.salarioBase);
            if (b > 0 || cap) {
                if (s.periodicidad === 'semanal')   return b / 7;
                if (s.periodicidad === 'quincenal') return b / 15;
                return b / 30;                      // mensual o sin especificar
            }
        }
        return n(salarioDiarioDefault);
    }

    /* Lo que cuesta ese colaborador en un mes. No es sueldoDiarioEfectivo × días:
       un sueldo fijo por periodo se mensualiza por su periodicidad, no por los
       días que traiga el mes. */
    function baseMensualStaff(s, diasDelMes, salarioDiarioDefault) {
        if (!s) return 0;
        if (s.sinCostoNegocio) return 0;
        var cap = !!s.sueldoCapturado, dias = n(diasDelMes) || 30;
        if (s.esquemaSueldo === 'diario') {
            var d = n(s.sueldoDiario);
            if (d > 0 || cap) return d * dias;
        } else {
            var b = n(s.salarioBase);
            if (b > 0 || cap) {
                if (s.periodicidad === 'semanal')   return b * (52 / 12);
                if (s.periodicidad === 'quincenal') return b * 2;
                return b;
            }
        }
        return n(salarioDiarioDefault) * dias;
    }

    /* ¿El sueldo sale del mínimo del negocio y no de su ficha? Para decirlo en
       pantalla: pagar el mínimo por descuido y pagarlo a propósito se ven igual. */
    function sueldoEsDelMinimo(s, salarioDiarioDefault) {
        if (!s || s.sinCostoNegocio || s.sueldoCapturado) return false;
        if (s.esquemaSueldo === 'diario' && n(s.sueldoDiario) > 0) return false;
        if (s.esquemaSueldo !== 'diario' && n(s.salarioBase) > 0) return false;
        return n(salarioDiarioDefault) > 0;
    }

    window.EtaaxCore = {
        sueldoDiarioEfectivo: sueldoDiarioEfectivo,
        baseMensualStaff: baseMensualStaff,
        sueldoEsDelMinimo: sueldoEsDelMinimo,
        n: n, fmtM: fmtM, fmtN: fmtN, genId: genId, todayStr: todayStr,
        gastoEsIMSS: gastoEsIMSS, gastoEsNomina: gastoEsNomina, gastoEsPropina: gastoEsPropina,
        gastoEsFijoPat: gastoEsFijoPat, gastoEsPagoFijo: gastoEsPagoFijo, nomTipoGasto: nomTipoGasto,
        clasificarGastos: clasificarGastos, grupoGasto: grupoGasto, grupoGastoUI: grupoGastoUI,
        planFijoPago: planFijoPago,
        getNegocioActivo: getNegocioActivo, sucActiva: sucActiva, scopeSuc: scopeSuc,
        getWeekStr: getWeekStr, semanaISO: semanaISO, getRange: getRange, prevRange: prevRange, inRange: inRange,
        efNeto: efNeto, taBanco: taBanco, ventasBruta: ventasBruta, flujoNeto: flujoNeto,
        propinas: propinas, cheque: cheque, resultado: resultado, resguardo: resguardo,
        comEf: comEf, netoCuenta: netoCuenta, taBancoNeto: taBancoNeto, taBancoNetoDetalle: taBancoNetoDetalle,
        ctaBaseCorte: ctaBaseCorte, ctaBaseCatalogo: ctaBaseCatalogo,
        cuentasDebito: cuentasDebito, cuentasDebitoActivas: cuentasDebitoActivas, ctaActiva: ctaActiva,
        comisionBancoCorte: comisionBancoCorte,
        nomEsAdm: _nomEsAdm,
        depEfecto: depEfecto, esRetiro: esRetiro,
        esApartado: esApartado, apartadoFondo: apartadoFondo, PREV_GENERAL: PREV_GENERAL,
        esAbonoTpv: esAbonoTpv, tpvDeCorte: tpvDeCorte, tpvConciliacion: tpvConciliacion,
        tpvCuentaConcilia: tpvCuentaConcilia,
        tpvDelCorte: tpvDelCorte, tpvFolioRepetido: tpvFolioRepetido,
        previsionSaldos: previsionSaldos,
        PREV_FREQS: PREV_FREQS, prevFreq: prevFreq,
        previsionPeriodos: previsionPeriodos, previsionPlan: previsionPlan,
        previsionApartadoRango: previsionApartadoRango, previsionUsadoRango: previsionUsadoRango,
        importeLetra: importeLetra,
        multiploReceta: multiploReceta, costeoReceta: costeoReceta,
        COSTEO_MULT_DEFAULT: COSTEO_MULT_DEFAULT, COSTEO_GASTO_OP_PCT: COSTEO_GASTO_OP_PCT,
        DIA_FACTORES_DEFAULT: DIA_FACTORES_DEFAULT, diasOperativos: diasOperativos, operaDow: operaDow, calcMetaDiaria: calcMetaDiaria,
        TOLERANCIA_DEFAULT: TOLERANCIA_DEFAULT, fechaLocal: fechaLocal, fechaStr: fechaStr, diasEntre: diasEntre,
        proximoCobro: proximoCobro, estadoCobro: estadoCobro,
    };
})();
