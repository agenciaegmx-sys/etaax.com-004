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
    function taBancoNeto(c, cuentasDebito) {
        var ctas = cuentasDebito || [];
        var tarNeto;
        if (c.tarjetaCuentas && c.tarjetaCuentas.length) {
            tarNeto = c.tarjetaCuentas.reduce(function (s, t) { return s + (parseFloat(t.neto) || 0); }, 0);
        } else {
            var cta0 = ctas[0] || null;
            tarNeto = cta0 ? netoCuenta(cta0, 0, n(c.tarjeta)) : n(c.tarjeta);
        }
        var ctaP = ctas[0] || null;
        var propNeta = ctaP ? netoCuenta(ctaP, 0, n(c.propTarjeta)) : n(c.propTarjeta);
        return tarNeto + propNeta;
    }
    function comisionBancoCorte(c, cuentasDebito) { return Math.max(0, taBanco(c) - taBancoNeto(c, cuentasDebito)); }

    /* ── Depósitos / retiros: efecto sobre los fondos ────────── */
    // Compat: depósitos viejos solo tenían `destino` ('banco' implicaba salir de caja fuerte).
    function depEfecto(d) {
        var m = n(d.monto);
        var origen = d.origen || (d.destino === 'banco' ? 'caja_fuerte' : 'externo');
        var dest = d.destino || 'caja_fuerte';
        var e = { caja: 0, banco: 0, tcPago: 0 };
        if (dest === 'caja_fuerte') e.caja += m; else if (dest === 'banco') e.banco += m; else if (dest === 'tarjeta_credito') e.tcPago += m;
        if (origen === 'caja_fuerte') e.caja -= m; else if (origen === 'banco') e.banco -= m;
        return e; // destino 'retiro': el dinero deja el negocio (no suma a ningún fondo)
    }
    function esRetiro(d) { return (d && d.destino) === 'retiro'; }

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

    window.EtaaxCore = {
        n: n, fmtM: fmtM, fmtN: fmtN, genId: genId, todayStr: todayStr,
        getNegocioActivo: getNegocioActivo, sucActiva: sucActiva, scopeSuc: scopeSuc,
        getWeekStr: getWeekStr, semanaISO: semanaISO, getRange: getRange, prevRange: prevRange, inRange: inRange,
        efNeto: efNeto, taBanco: taBanco, ventasBruta: ventasBruta, flujoNeto: flujoNeto,
        propinas: propinas, cheque: cheque, resultado: resultado, resguardo: resguardo,
        comEf: comEf, netoCuenta: netoCuenta, taBancoNeto: taBancoNeto, comisionBancoCorte: comisionBancoCorte,
        depEfecto: depEfecto, esRetiro: esRetiro,
        DIA_FACTORES_DEFAULT: DIA_FACTORES_DEFAULT, diasOperativos: diasOperativos, operaDow: operaDow, calcMetaDiaria: calcMetaDiaria,
    };
})();
