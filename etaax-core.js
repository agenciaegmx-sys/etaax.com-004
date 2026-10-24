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
    /* ══ ¿ESTE REGISTRO ES DE ESTA SUCURSAL? ══════════════════════════
       LA REGLA DEL SISTEMA: un registro SIN sello de sucursal es de Matriz.
       Son los de antes de que existieran las sucursales, y tienen que sumar
       en UN solo lado.

       Estaba escrita a mano en cinco pantallas —kpis, estadísticas, ventas,
       gastos globales y resumen— y cuatro coincidían. La quinta, el Resumen
       financiero, decía `|| !(x && x.sucursalId)`: aceptaba los registros sin
       sello en TODAS las sucursales. Un corte viejo sumaba en Matriz Y en
       Tulum, el P&L no cuadraba con KPIs sobre el mismo mes, y no había forma
       de saber cuál creer.

       Por eso el predicado vive aquí y las cinco lo llaman. Copiar el cuerpo
       es lo que permitió que una se desviara. */
    function esDeSuc(x, suc) {
        if (!suc) return true;                                   // vista global
        return ((x && x.sucursalId) || 'suc_principal') === suc;
    }
    // Acotar una lista a una sucursal, con la MISMA regla de arriba.
    function scopeSuc(lista, suc) {
        if (!suc) return lista || [];
        return (lista || []).filter(function (x) { return esDeSuc(x, suc); });
    }

    /* ── Periodos (día / semana ISO / mes / rango) ───────────── */
    function getWeekStr(d) { var tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); var dn = tmp.getUTCDay() || 7; tmp.setUTCDate(tmp.getUTCDate() + 4 - dn); var ys = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1)); var wn = Math.ceil((((tmp - ys) / 86400000) + 1) / 7); return tmp.getUTCFullYear() + '-W' + String(wn).padStart(2, '0'); }
    function semanaISO(fechaStr) { var d = new Date(fechaStr + 'T12:00:00'); var t = new Date(d.valueOf()); t.setDate(t.getDate() - ((d.getDay() + 6) % 7) + 3); var w1 = new Date(t.getFullYear(), 0, 4); return 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7); }
    function getRange(tipo, val, end) {
        if(tipo==='anio'){var y=/^\d{4}$/.test(String(val))?Number(val):new Date().getFullYear();return {from:y+'-01-01',to:y+'-12-31'};}
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
    /* ── ANTICIPOS APLICADOS A UN CORTE ──────────────────────────────────────
       Un anticipo es dinero que YA entró a la caja o al banco semanas antes, pero
       que todavía no era venta: es un pasivo, producto que se debe. Se vuelve
       venta el día del evento.

       Por eso suma a la VENTA pero no al FLUJO del día: ese dinero no llegó hoy,
       llegó cuando se cobró el anticipo. Contarlo en los dos lados lo duplicaría
       —una vez al recibirlo y otra al usarlo— y el saldo de caja fuerte quedaría
       inflado justo por lo que ya estaba ahí dentro. */
    function anticipoAplicado(c) {
        return ((c && c.anticipos) || []).reduce(function (t, a) { return t + n(a && a.monto); }, 0);
    }
    function ventasBruta(c) { return n(c.efectivo) + n(c.tarjeta) + n(c.transferencia) + anticipoAplicado(c); }
    function flujoNeto(c) { return efNeto(c) + taBanco(c) + n(c.transferencia); }   // = ef + tarjeta + propTarjeta + transfer
    function propinas(c) { return n(c.propEfectivo) + n(c.propTarjeta); }
    function cheque(c) { var com = n(c.comensales); var ven = n(c.ventaDeclarada) || ventasBruta(c) || (n(c.comedor) + n(c.paraLlevar)); return com > 0 ? ven / com : 0; }
    function resultado(c) { return flujoNeto(c) - n(c.gastos); }
    /* ── LA CAJA CHICA ES UNA BOLSA POR DÍA, NO UNA POR TURNO ────────────────
       `resguardo` recibe la caja chica del DÍA. Con un solo corte diario eso está
       bien, pero el sistema admite varios turnos (mañana, tarde, noche) y ahí el
       mismo gasto se restaba en CADA corte de ese día: dos turnos con $300 de
       caja chica descontaban $600, y el saldo de caja fuerte salía corto por
       $300 todos los días con doble turno.

       No hay forma de saber en qué turno se gastó —el gasto no lleva turno— así
       que la bolsa se le atribuye ENTERA a un solo corte: el primero del día.
       Es arbitrario en el renglón, exacto en el total, y es la única lectura que
       no inventa datos. El orden es por turno y, a igualdad, por id, para que no
       cambie de corte entre recargas. */
    var _TURNO_ORD = { dia: 0, manana: 1, tarde: 2, noche: 3 };
    function _rangoTurno(c) {
        var t = (c && c.turno) || '';
        return _TURNO_ORD[t] === undefined ? 9 : _TURNO_ORD[t];
    }
    function absorbeCajaChica(corte, cortes) {
        if (!corte) return false;
        var f = corte.fecha || '', su = (corte.sucursalId || 'suc_principal');
        var mismos = (cortes || []).filter(function (c) {
            return c && (c.fecha || '') === f && ((c.sucursalId || 'suc_principal') === su);
        });
        if (mismos.length <= 1) return true;       // un solo corte: le toca toda
        mismos.sort(function (a, b) {
            var d = _rangoTurno(a) - _rangoTurno(b);
            return d !== 0 ? d : String(a.id || '').localeCompare(String(b.id || ''));
        });
        return (mismos[0].id || '') === (corte.id || '');
    }

    /* ── LOS MOVIMIENTOS DE CAJA DE UN CORTE ─────────────────────────────────
       EL BUG: el corte tenía desde siempre una sección de "Depósitos / Ingresos
       adicionales". Se capturaban, se guardaban en el corte y se veían en el
       detalle… y NO ENTRABAN EN NINGUNA FÓRMULA. Ni en el resguardo, ni en el
       flujo, ni en la venta. O sea: se registraba un depósito y el efectivo
       final salía exactamente igual que si no se hubiera capturado nada.

       Y un corte de caja de verdad tiene más movimientos que la venta:

         · de caja fuerte entran $800 al cajón porque no hay cambio,
         · se retira efectivo que NO es un gasto (se sube a la caja fuerte),
         · se deposita el efectivo del día en el banco,
         · cae a la cuenta un anticipo que se cobró la semana pasada — no es
           venta de hoy, pero sí es dinero que llegó hoy.

       Todos son la misma cosa con distinto signo: CUÁNTO y de dónde a dónde.
       Por eso se resuelven con una sola tabla en vez de cinco funciones.

       La llave `ingresosExtra` se conserva —es donde ya viven los capturados—
       y el TIPO es lo nuevo. Los viejos no lo traen: todos eran dinero que
       entraba, y lo único que los distingue es por dónde entró.              */
    /* TRES columnas, no dos, y la tercera es la que casi se me va: el saldo de
       CAJA FUERTE se calcula como la suma de los resguardos de todos los cortes
       (`Σ resguardo + movimientos de depósitos − gastos`). O sea que subir el
       resguardo de un corte sube la caja fuerte.

       Por eso un movimiento que TOCA la caja fuerte tiene que compensarse ahí:

         · «cambio desde caja fuerte»: el cajón gana $800 y la caja fuerte los
           PIERDE. Sin la compensación, esos $800 volverían con el resguardo y
           la caja fuerte acabaría con $800 que nunca tuvo — contados dos veces.
         · «retiro de efectivo»: el cajón pierde $500 y la caja fuerte los
           RECIBE. Sin la compensación, el dinero se esfumaría del sistema.

       Los otros tres no la tocan: lo que entra nuevo sube por el resguardo, lo
       que se deposita nunca llega a la caja fuerte, y lo que cae a la cuenta no
       pasa por ninguna caja.                                                  */
    var MOV_TIPOS = {
        ingreso_ef:    { efectivo:  1, banco: 0, fuerte:  0 },  // entra efectivo al cajón
        ingreso_banco: { efectivo:  0, banco: 1, fuerte:  0 },  // cae a la cuenta (anticipo viejo, transfer)
        desde_fuerte:  { efectivo:  1, banco: 0, fuerte: -1 },  // caja fuerte manda cambio al cajón
        retiro_ef:     { efectivo: -1, banco: 0, fuerte:  1 },  // sale del cajón y sube a la caja fuerte
        deposito:      { efectivo: -1, banco: 1, fuerte:  0 },  // el efectivo del día se va al banco
    };
    function movTipo(m) {
        var t = m && m.tipo;
        if (t && MOV_TIPOS[t]) return t;
        return (m && m.origen === 'transfer') ? 'ingreso_banco' : 'ingreso_ef';
    }
    function movEfecto(m) {
        var s = MOV_TIPOS[movTipo(m)], val = n(m && m.monto);
        return { efectivo: s.efectivo * val, banco: s.banco * val, fuerte: s.fuerte * val };
    }
    function movsCorte(movs) {
        return (movs || []).reduce(function (t, m) {
            var e = movEfecto(m);
            t.efectivo += e.efectivo; t.banco += e.banco; t.fuerte += e.fuerte; return t;
        }, { efectivo: 0, banco: 0, fuerte: 0 });
    }
    /* Lo que estos movimientos le hacen a la CAJA FUERTE, sumando varios
       cortes. Va aparte porque quien calcula ese saldo recorre los cortes, no
       los movimientos. */
    function movsFuerte(cortes) {
        return (cortes || []).reduce(function (t, c) {
            return t + movsCorte(c && c.ingresosExtra).fuerte;
        }, 0);
    }

    // Resguardo físico del cajón. cajaChicaDia = gastos de caja chica de la fecha del corte.
    /* Los movimientos de caja entran aquí: es el único número que se compara
       contra lo que hay FÍSICAMENTE en el cajón al cerrar. Si de caja fuerte
       entraron $800, el cajón tiene $800 más — negarlo hacía que el corte
       "faltara" por esa cantidad todos los días que hubiera movimientos. */
    function resguardo(c, cajaChicaDia) {
        return n(c.fondoInicial) + n(c.efectivo) + movsCorte(c && c.ingresosExtra).efectivo
             - n(cajaChicaDia) - n(c.propRetiroCaja) - n(c.retiros);
    }

    /* ── LO QUE LLEGA A LAS CUENTAS BANCARIAS POR ESTE CORTE ──────────────────
       El corte decía cuánto efectivo quedaba en el cajón y NO decía cuánto
       había llegado al banco — que hoy es la mitad del dinero de un
       restaurante. Tarjeta (venta + propina, que viajan en la misma
       transacción), transferencias, y lo que los movimientos mandaron allá.
       BRUTO: lo que el cliente pagó. La comisión se descuenta después, y el
       desglose por cuenta la muestra aparte. */
    function bancoCorte(c) {
        return taBanco(c) + n(c.transferencia) + movsCorte(c && c.ingresosExtra).banco;
    }

    /* ── Comisiones bancarias ────────────────────────────────── */
    // Fracción efectiva (0..1) que descuenta el banco: comisión TC/TD + IVA si aplica.
    function comEf(cta, cual) {
        var base = parseFloat(cual === 'tc' ? cta.comisionTC : cta.comisionTD);
        if (isNaN(base)) return 0;
        var f = cta.aplicaIva ? (1 + (parseFloat(cta.ivaPct) || 0) / 100) : 1;
        return base * f / 100;
    }
    function netoCuenta(cta, tc, td) { return cta ? (tc * (1 - comEf(cta, 'tc')) + td * (1 - comEf(cta, 'td'))) : (tc + td); }

    /* ── NETO DE UNA PROPINA DE TARJETA ────────────────────────────────────────
       Crédito y débito cobran comisiones distintas, y la propina se netea con la
       tasa de la tarjeta con la que se pagó. Pero la propina NO se captura
       separada por tipo —sería un campo más, todos los días, para un número
       chico— y hasta ahora se neteaba TODA como débito: la comisión salía corta.

       No hace falta capturar nada: la propina viaja en la MISMA transacción que
       la venta, así que se reparte con la mezcla crédito/débito de esa cuenta en
       ese corte. Si el 63% de lo que cobró esa terminal fue crédito, el 63% de la
       propina pagó tasa de crédito. Es el dato real del día, no un supuesto.

       Sin mezcla conocida (cortes viejos, sin desglose) se queda como estaba:
       débito. Cambiarlo ahí recalcularía comisiones de meses ya cerrados. */
    function netoPropina(cta, prop, tc, td) {
        if (!cta) return n(prop);
        var base = n(tc) + n(td);
        if (base <= 0) return netoCuenta(cta, 0, n(prop));
        var pTc = n(prop) * (n(tc) / base);
        return netoCuenta(cta, pTc, n(prop) - pTc);
    }
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
        // Mezcla crédito/débito de cada cuenta EN ESTE CORTE: con eso se netea su
        // propina (ver netoPropina), en vez de darla toda por débito.
        var mix = {}, mixTot = { tc: 0, td: 0 };
        (c.tarjetaCuentas || []).forEach(function (t) {
            if (!t) return;
            var id = t.cuentaId || '';
            if (!mix[id]) mix[id] = { tc: 0, td: 0 };
            mix[id].tc += n(t.ventaTC); mix[id].td += n(t.ventaTD);
            mixTot.tc += n(t.ventaTC);  mixTot.td += n(t.ventaTD);
        });
        var pc = c.propTarjetaCuentas, propDes = 0;
        if (pc && typeof pc === 'object') {
            Object.keys(pc).forEach(function (id) {
                var m = n(pc[id]); if (!m) return;
                propDes += m;
                var cta = buscar(id), mz = mix[id] || { tc: 0, td: 0 };
                addC(id, cta ? netoPropina(cta, m, mz.tc, mz.td) : m);
            });
        }
        var propResto = n(c.propTarjeta) - propDes;
        if (propResto > 0.005) det.sinCuenta += cta0 ? netoPropina(cta0, propResto, mixTot.tc, mixTot.td) : propResto;

        return det;
    }
    function taBancoNeto(c, cuentasDebito) {
        var d = taBancoNetoDetalle(c, cuentasDebito), t = d.sinCuenta;
        for (var k in d.porCuenta) if (d.porCuenta.hasOwnProperty(k)) t += d.porCuenta[k];
        return t;
    }
    /* Comisión bancaria de un corte. Sin `deps` devuelve la PROYECCIÓN (la tasa
       configurada), que es como se calculó siempre. Con `deps`, las cuentas que ya
       se conciliaron aportan su comisión REAL —la que cobró el banco— y las demás
       siguen con la proyección. Mezclado es el caso normal: un corte puede tener
       una terminal conciliada y otra todavía no.
       Este es el número que Gastos Variables y KPIs cuentan como comisión. */
    function comisionBancoCorte(c, cuentasDebito, deps) {
        var proy = Math.max(0, taBanco(c) - taBancoNeto(c, cuentasDebito));
        if (!c || !deps || !deps.length) return proy;
        var cid = c.id || '', porCta = {}, hay = false;
        deps.forEach(function (d) {
            if (!esAbonoTpv(d) || (d.corteId || '') !== cid) return;
            var k = d.cuentaId || '';
            porCta[k] = (porCta[k] || 0) + n(d.comision);
            hay = true;
        });
        if (!hay) return proy;
        var real = 0, proyCubierta = 0;
        Object.keys(porCta).forEach(function (k) {
            var h = tpvHechos(c, deps, k, cuentasDebito);
            // Solo manda lo real donde el corte YA cerró en esa cuenta.
            if (h.cerrado) { real += h.comisionReal; proyCubierta += h.comisionProy; }
        });
        return Math.max(0, proy - proyCubierta + real);
    }

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
    function tpvDeCorte(corte, cuentaId, ctas) {
        var r = { bruto: 0, neto: 0 }, brutoDes = 0;
        ((corte && corte.tarjetaCuentas) || []).forEach(function (t) {
            if (!t) return;
            brutoDes += n(t.ventaTC) + n(t.ventaTD);
            if (cuentaId != null && (t.cuentaId || '') !== cuentaId) return;
            r.bruto += n(t.ventaTC) + n(t.ventaTD);
            r.neto  += n(t.neto);
        });
        /* Los cortes VIEJOS no traen desglose por cuenta: la tarjeta vive en un
           campo plano. Sin esto, un corte de agosto con $21,180 de tarjeta no
           tenía nada que conciliar y el bloque no aparecía. Se atribuye a la
           cuenta base del corte, igual que hace el saldo (taBancoNetoDetalle):
           si las dos no usaran la misma regla, el saldo y la conciliación
           dirían cosas distintas.

           Las PROPINAS de tarjeta entran también: el banco deposita el abono
           completo, venta y propina juntas, y es contra ese abono que se
           concilia. */
        if (ctas && corte) {
            var cta0 = ctaBaseCorte(corte, ctas);
            var baseId = cta0 ? cta0.id : '';
            if (cuentaId == null || cuentaId === baseId) {
                var resto = n(corte.tarjeta) - brutoDes;
                if (resto > 0.005) {
                    r.bruto += resto;
                    r.neto  += cta0 ? netoCuenta(cta0, 0, resto) : resto;
                }
            }
            // Misma mezcla que usa el saldo: si aquí se neteara distinto, el banco
            // y la conciliación dirían números distintos del mismo abono.
            var mixC = {}, mixT = { tc: 0, td: 0 };
            ((corte.tarjetaCuentas) || []).forEach(function (t) {
                if (!t) return;
                var id = t.cuentaId || '';
                if (!mixC[id]) mixC[id] = { tc: 0, td: 0 };
                mixC[id].tc += n(t.ventaTC); mixC[id].td += n(t.ventaTD);
                mixT.tc += n(t.ventaTC);     mixT.td += n(t.ventaTD);
            });
            var pc = corte.propTarjetaCuentas, propDes = 0;
            if (pc && typeof pc === 'object') {
                Object.keys(pc).forEach(function (id) {
                    var m = n(pc[id]); if (!m) return;
                    propDes += m;
                    if (cuentaId != null && id !== cuentaId) return;
                    var cta = null;
                    for (var i = 0; i < ctas.length; i++) if (ctas[i].id === id) cta = ctas[i];
                    var mz = mixC[id] || { tc: 0, td: 0 };
                    r.bruto += m;
                    r.neto  += cta ? netoPropina(cta, m, mz.tc, mz.td) : m;
                });
            }
            if (cuentaId == null || cuentaId === baseId) {
                var propResto = n(corte.propTarjeta) - propDes;
                if (propResto > 0.005) {
                    r.bruto += propResto;
                    r.neto  += cta0 ? netoPropina(cta0, propResto, mixT.tc, mixT.td) : propResto;
                }
            }
        }
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

    /* ── LOS HECHOS DE UN CORTE EN UNA CUENTA, EN UN SOLO LUGAR ──────────────
       Antes había dos maneras de medir lo mismo: el bloque al pie del corte
       restaba contra el NETO proyectado y el saldo de caja fuerte hacía su propia
       cuenta. Mientras la comisión fuera siempre la de la tasa configurada, las
       dos daban igual. Ya no: la comisión REAL se captura al conciliar, y dos
       reglas separadas se habrían desincronizado en cuanto una difiriera — es el
       mismo error que costó tres migraciones en el bucket.

       EL CAMBIO DE FONDO: se concilia contra el BRUTO, no contra el neto.
       El neto es una proyección (venta × tasa configurada) y nunca cuadra al
       centavo con el banco; por eso hacía falta un movimiento de ajuste. El
       BRUTO es un dato duro: es la venta que se capturó. Entonces la regla de
       cierre es una igualdad exacta:

           lo que cayó  +  la comisión que cobró el banco  =  la venta capturada

       Así un día que cae en tres depósitos, cada uno con su comisión, cierra
       solo cuando los tres suman la venta. Y si faltan $2, se ven los $2.

       `netoEfectivo` / `comisionEfectiva`: lo REAL si el corte ya cerró, la
       proyección mientras no. Sin esa regla, los cortes todavía sin conciliar se
       irían a cero en los reportes el día que esto se enciende. */
    function tpvHechos(corte, deps, cuentaId, ctas) {
        var v = tpvDeCorte(corte, cuentaId, ctas);
        var cid = (corte && corte.id) || '';
        var monto = 0, com = 0, nAb = 0;
        (deps || []).forEach(function (d) {
            if (!esAbonoTpv(d)) return;
            if ((d.corteId || '') !== cid) return;
            if (cuentaId != null && (d.cuentaId || '') !== cuentaId) return;
            monto += n(d.monto); com += n(d.comision); nAb++;
        });
        var explicado = monto + com;
        var falta = v.bruto - explicado;
        var proy = Math.max(0, v.bruto - v.neto);
        var cerrado = nAb > 0 && Math.abs(falta) < 0.005;
        return {
            bruto: v.bruto,                 // venta capturada: el dato duro
            neto: v.neto,                   // proyección con la tasa configurada
            comisionProy: proy,
            conciliado: monto,              // lo que de verdad cayó
            comisionReal: com,              // lo que de verdad cobró el banco
            explicado: explicado,
            falta: falta,                   // lo que falta para cuadrar con la venta
            abonos: nAb,
            cerrado: cerrado,
            netoEfectivo:     cerrado ? monto : v.neto,
            comisionEfectiva: cerrado ? com   : proy,
            // Compat: el bloque del corte pinta `comision` como "comisión del día".
            comision: cerrado ? com : proy
        };
    }

    /* ── ANTICIPOS: dinero recibido que todavía se debe en producto ──────────
       Espejo de las previsiones, al revés:
         · previsión = dinero MÍO apartado para un gasto futuro   → baja el disponible
         · anticipo  = dinero AJENO recibido por una venta futura → está en la caja,
                       pero una parte de ese saldo ya tiene dueño

       Un anticipo SÍ mueve el fondo (el billete entra de verdad), a diferencia del
       apartado, que solo etiqueta. Por eso `depEfecto` lo trata como cualquier
       depósito y aquí solo se lleva la cuenta de cuánto falta por aplicar.       */
    function esAnticipo(d)    { return !!d && d.tipo === 'anticipo'; }
    function esAnticipoDev(d) { return !!d && d.tipo === 'anticipo_dev'; }
    function anticipoFondo(d) { return (d && d.fondo === 'banco') ? 'banco' : 'caja_fuerte'; }

    /* Saldos por anticipo: cuánto se recibió, cuánto se devolvió, cuánto se aplicó
       y cuánto queda por aplicar. `deps` trae los anticipos y sus devoluciones;
       `cortes` y `vex` (ventas especiales) traen dónde se usaron.
       Todo por parámetro: sin DOM, sin localStorage. */
    function anticipoSaldos(deps, cortes, vex) {
        var porId = {};
        function slot(id) {
            if (!porId[id]) porId[id] = { id: id, anticipo: null, recibido: 0, devuelto: 0,
                                          aplicado: 0, saldo: 0, enCaja: 0, enBanco: 0 };
            return porId[id];
        }
        (deps || []).forEach(function (d) {
            if (esAnticipo(d)) {
                var s = slot(d.id), m = n(d.monto);
                s.anticipo = d; s.recibido += m;
                if (anticipoFondo(d) === 'banco') s.enBanco += m; else s.enCaja += m;
            } else if (esAnticipoDev(d) && d.anticipoId) {
                var v = slot(d.anticipoId), md = n(d.monto);
                v.devuelto += md;
                if (anticipoFondo(d) === 'banco') v.enBanco -= md; else v.enCaja -= md;
            }
        });
        function aplicar(lista) {
            (lista || []).forEach(function (x) {
                ((x && x.anticipos) || []).forEach(function (a) {
                    if (a && a.anticipoId) slot(a.anticipoId).aplicado += n(a.monto);
                });
            });
        }
        aplicar(cortes); aplicar(vex);

        var tot = { recibido: 0, devuelto: 0, aplicado: 0, saldo: 0, enCaja: 0, enBanco: 0 };
        Object.keys(porId).forEach(function (k) {
            var s = porId[k];
            /* Lo aplicado y lo devuelto ya no están pendientes. Nunca baja de cero:
               aplicar de más sería un error de captura, y dejar un saldo negativo
               restando del total lo escondería en vez de enseñarlo. */
            s.saldo = Math.max(0, s.recibido - s.devuelto - s.aplicado);
            tot.recibido += s.recibido; tot.devuelto += s.devuelto;
            tot.aplicado += s.aplicado; tot.saldo += s.saldo;
            tot.enCaja += s.enCaja;     tot.enBanco += s.enBanco;
        });
        return { porId: porId, total: tot };
    }

    /* ¿Cuáles TOCAN hoy? Si al capturar el anticipo se puso la fecha del evento,
       el corte de ese día lo propone solo. Sin eso, el cajero tendría que
       acordarse de que hace tres semanas alguien dejó dinero a cuenta — y un
       anticipo que nadie aplica se queda inflando el saldo para siempre.
       Los que ya pasaron de fecha y siguen con saldo van primero entre "otros":
       son los que alguien olvidó. */
    function anticiposDelDia(saldos, fecha) {
        var f = String(fecha || '').slice(0, 10);
        var delDia = [], otros = [];
        var porId = (saldos && saldos.porId) || {};
        Object.keys(porId).forEach(function (k) {
            var s = porId[k];
            if (!s || s.saldo <= 0.005 || !s.anticipo) return;
            var fe = String(s.anticipo.fechaEvento || '').slice(0, 10);
            if (fe && f && fe === f) delDia.push(s); else otros.push(s);
        });
        var ord = function (a, b) {
            var fa = String((a.anticipo && a.anticipo.fechaEvento) || a.anticipo.fecha || '');
            var fb = String((b.anticipo && b.anticipo.fechaEvento) || b.anticipo.fecha || '');
            return fa.localeCompare(fb);
        };
        delDia.sort(ord); otros.sort(ord);
        /* Vencidos: con fecha de evento YA pasada y saldo vivo. Se marcan para
           poder avisar, no para esconderlos. */
        var vencidos = otros.filter(function (s) {
            var fe = String(s.anticipo.fechaEvento || '').slice(0, 10);
            return fe && f && fe < f;
        });
        return { delDia: delDia, otros: otros, vencidos: vencidos };
    }

    function tpvConciliacion(cortes, deps, cuentaId, hoyStr, modo, ctas) {
        var abonos = (deps || []).filter(function (d) {
            return esAbonoTpv(d) && (cuentaId == null || (d.cuentaId || '') === cuentaId);
        });
        var conciliado = abonos.reduce(function (t, a) { return t + n(a.monto); }, 0);

        /* Cortes de esta cuenta con venta de tarjeta, del más viejo al más nuevo.
           `neto` aquí es el EFECTIVO (real si el corte ya cerró, proyección si no):
           con la proyección, un corte conciliado con comisión distinta a la tasa
           dejaba un tránsito residual que no se iba nunca. */
        var conVenta = (cortes || []).map(function (c) {
            var h = tpvHechos(c, deps, cuentaId, ctas);
            return { fecha: c.fecha || '', id: c.id, bruto: h.bruto,
                     neto: h.netoEfectivo, netoProy: h.neto };
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
                  bruto: 0, comision: 0, transito: 0, aportaBanco: 0, ajusteNeto: 0,
                  pendienteDesde: '', diasPendiente: 0,
                  activa: modo === false ? false : !!desde, apagada: modo === false };
        /* ── LA CORRECCIÓN DE COMISIÓN, PARA QUIEN PARTE DE LA PROYECCIÓN ──────
           El saldo TOTAL se arma sumando lo que de verdad cayó, así que ya trae la
           comisión real. Pero el saldo POR CUENTA se arma al revés: suma la venta
           neteada con la TASA CONFIGURADA y después resta lo que falta por caer.
           Cuando la comisión que cobró el banco no fue la de la tasa, ese camino
           se queda con la proyección y el desglose no cuadra con el total —
           medido con un caso real: $42.89 proyectados contra $53.18 cobrados,
           $10.29 de diferencia.

           `ajusteNeto` es justo ese hueco: lo que hay que sumarle a la proyección
           para llegar a lo real. Es cero mientras nadie corrija una comisión, así
           que no mueve un solo saldo histórico. */
        conVenta.forEach(function (x) { r.ajusteNeto += (x.neto - x.netoProy); });
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
    function tpvDelCorte(corte, deps, cuentaId, ctas) {
        return tpvHechos(corte, deps, cuentaId, ctas);
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
    /* ── ¿ESTE GASTO YA SALIÓ DEL NEGOCIO? ────────────────────────────────────
       Un gasto PENDIENTE o PROGRAMADO está capturado pero NO pagado: el dinero
       sigue en la caja. Contarlo como egreso infla el gasto del mes, encoge la
       utilidad y hace que el saldo no cuadre con lo que de verdad hay.

       Sin estatus = pagado: así se capturó siempre antes de que existiera el
       campo, y cambiarles el significado reescribiría meses ya cerrados. */
    function gastoEstatus(g) {
        var e = String((g && g.estatus) || 'pagado').toLowerCase();
        return (e === 'pendiente' || e === 'programado') ? e : 'pagado';
    }
    function gastoPagado(g) { return gastoEstatus(g) === 'pagado'; }

    /* ── CUÁNTO ESPERÓ UN GASTO ──────────────────────────────────────────────
       Un gasto pendiente es un dato fantasma: existe en el registro pero no ha
       salido de ninguna cuenta. Lo que interesa medir es el HUECO entre el día en
       que se generó (`fecha`) y el día en que de verdad se pagó (`pagadoEl`).
       Si todavía no se paga, el hueco se mide contra hoy y sigue creciendo: es la
       diferencia entre "tengo un pendiente" y "llevo 40 días debiéndolo".

       OJO: `fechaPago` es OTRA cosa —la fecha en que se PROGRAMÓ pagarlo— y
       confundirlas haría que un gasto programado a diciembre se reportara como
       pagado desde hoy. */
    function gastoEspera(g, hoyStr) {
        var desde = String((g && g.fecha) || '').slice(0, 10);
        if (!desde) return null;
        var pagado = gastoPagado(g);
        var hasta = pagado ? String((g && g.pagadoEl) || '').slice(0, 10)
                           : String(hoyStr || '').slice(0, 10);
        if (!hasta) return null;   // pagado sin sello: no se inventa una duración
        return { pagado: pagado, desde: desde, hasta: hasta,
                 dias: Math.max(0, diasEntre(desde, hasta) || 0) };
    }

    function clasificarGastos(gastos, opts){
        opts = opts || {};
        var r = { fijo: 0, nomOp: 0, nomAdm: 0, imss: 0, variable: 0, propina: 0,
                  /* Lo comprometido y todavía no pagado: NO entra al egreso, pero
                     se devuelve para poder enseñarlo —es plata que ya se debe. */
                  pendiente: 0, programado: 0, porPagar: 0 };
        (gastos || []).forEach(function (g) {
            if (!g) return;
            var m = n(g.monto);
            var est = gastoEstatus(g);
            if (est !== 'pagado') { r[est] += m; r.porPagar += m; return; }
            r[grupoGasto(g, opts)] += m;   // una sola regla, compartida con los reportes
        });
        r.variable += n(opts.comisionBanco);                                   // comisión bancaria = variable
        r.nom = r.nomOp + r.nomAdm + r.imss;                                   // nómina total (IMSS incluido)
        r.egresos = r.fijo + r.nom + r.variable;                              // egreso del mes (SIN previsiones)
        return r;
    }

    /* ══ RESUMEN DE RESULTADOS (P&L) ═══════════════════════════════════════════
       El estado de resultados del periodo, en los renglones con los que de
       verdad se habla de un restaurante: ventas, food cost, nómina, fijos,
       otros variables, previsiones y utilidad. Cada uno con su porcentaje
       sobre venta, que es la unidad en que se compara un negocio con otro y
       consigo mismo el mes pasado.

       BASE DE FLUJO, igual que todo ETAAX: cuenta lo que SALIÓ de la caja en el
       periodo. Mezclar flujo con devengado en la misma columna da una utilidad
       que no cuadra con el banco y que nadie puede explicar.

       EL FOOD COST SALE DE LOS GASTOS POR CATEGORÍA, no del inventario.

       Hubo una versión de esto que mostraba además el food cost «consumido»,
       sacado del inventario cerrado. Se quitó, por dos razones y las dos
       pesan:

         1. NO SE INVENTARÍA TODO. Un negocio cuenta la barra y no la cocina, o
            cuenta por áreas en semanas distintas. Ese consumo parcial dividido
            entre la venta COMPLETA da un food cost bajísimo, que se lee como
            una mejora espectacular cuando lo único que pasó es que faltan
            categorías. Es el peor tipo de número: convincente y falso.
         2. El dato ni siquiera se guardaba. `vendidoCosto` se calcula al pintar
            el Paso 5 del inventario y se queda ahí; el registro no lo conserva.
            Así que la pantalla invitaba a cerrar un inventario para ver algo
            que nunca iba a aparecer.

       Cuando los inventarios se conecten de verdad —guardando el consumo
       valorizado y sabiendo qué áreas cubre cada uno— esto se vuelve a poner.
       Mientras tanto, el resumen es lo que dice ser: ingresos contra egresos
       por categoría.                                                        */

    /* Qué categorías de gasto son INSUMO de producto. Limpieza, desechables y
       empaque NO van aquí: son suministros de operación, no costo del platillo.
       Meterlos infla el food cost y hace que se persiga un problema que no
       está en la cocina. */
    var CATS_INSUMO = {
        'alimentos e ingredientes': 1,
        'bebidas y licores': 1,
        'insumos de barra (garnish, hielo…)': 1,
        'insumos de barra (garnish, hielo...)': 1
    };
    function esGastoInsumo(g) {
        if (!g) return false;
        return !!CATS_INSUMO[String(g.categoria || '').trim().toLowerCase()];
    }

    /* ── COCINA Y BARRA, POR SEPARADO ─────────────────────────────────────────
       Un costo de insumos de 25% no dice nada: puede ser una cocina cara con
       una barra sana, o al revés, y se arreglan de maneras opuestas. La barra
       es el área donde el descuadre se nota menos y pesa más.

       OJO CON LO QUE ESTO ES Y LO QUE NO: aquí se parte el COSTO, no la venta.
       El corte de caja registra la venta por forma de pago (efectivo, tarjeta,
       transferencia), no por lo que se vendió, así que NO se puede saber cuánto
       vendió la cocina y cuánto la barra. Los dos porcentajes van sobre la
       venta TOTAL. El «bar cost» de los reportes de la industria —costo de
       barra entre VENTA de barra— necesita un dato que ETAAX no captura hoy;
       llamarle así a esto sería mentir con un número que parece el bueno. */
    var CATS_BARRA = {
        'bebidas y licores': 1,
        'insumos de barra (garnish, hielo…)': 1,
        'insumos de barra (garnish, hielo...)': 1
    };
    function areaInsumo(g) {
        if (!esGastoInsumo(g)) return '';
        return CATS_BARRA[String(g.categoria || '').trim().toLowerCase()] ? 'barra' : 'cocina';
    }
    /* El mismo costo de insumos de costoInsumos(), partido en dos. Se calcula
       con las MISMAS tres condiciones —pagado, variable, de insumo— para que la
       suma de las partes sea exactamente el total y no una aproximación. */
    function costoInsumosPorArea(gastos, opts) {
        opts = opts || {};
        var r = { cocina: 0, barra: 0 };
        (gastos || []).forEach(function (g) {
            if (!esGastoInsumo(g)) return;
            if (gastoEstatus(g) !== 'pagado') return;
            if (grupoGasto(g, opts) !== 'variable') return;
            r[areaInsumo(g)] += n(g.monto);
        });
        return r;
    }
    /* Indicadores del restaurante con la misma base de flujo del P&L.
       Cocina/barra son COMPRAS sobre venta TOTAL: los cortes no guardan ventas
       por área ni tickets cerrados. Los promedios usan comensales y exigen que
       todos los cortes con venta o propina tengan ese dato, sin mezclar bases.
       El consumo real vs. receta aún no tiene una fuente valorizada comparable. */
    function indicadoresRestaurante(d) {
        d = d || {};
        var area = costoInsumosPorArea(d.gastos || [], d.gastoOpts || {});
        var ventas = n(d.ventas), ingresos = n(d.ingresos), nomina = n(d.nomina);
        var prop = 0, com = 0, incompletos = 0;
        (d.cortes || []).forEach(function (c) {
            var personas = n(c.comensales), p = propinas(c);
            prop += p;
            if (personas > 0 && isFinite(personas)) com += personas;
            else if (ventasBruta(c) !== 0 || p !== 0) incompletos++;
        });
        function pct(m, base) { return base > 0 && isFinite(m) && isFinite(base) ? m / base * 100 : null; }
        var promedio = com > 0 && !incompletos;
        var primo = area.cocina + area.barra + nomina;
        return {
            cocina: pct(area.cocina, ventas), barra: pct(area.barra, ventas),
            staff: pct(nomina, ventas), primo: pct(primo, ventas),
            utilidad: pct(n(d.utilidad), ingresos),
            cheque: promedio ? ventas / com : null,
            propinas: promedio ? prop / com : null,
            extra: null,
            comprasCocina: area.cocina, comprasBarra: area.barra, costoPrimo: primo,
            nomina: nomina, utilidadMonto: n(d.utilidad), propinasMonto: prop,
            comensales: com, cortesSinComensales: incompletos
        };
    }
    /* Desglose por producto solo cuando TODOS los cortes cuadran contra la
       venta por medios. Un campo vacío o un corte antiguo no implica venta 0. */
    function ventasPorArea(cortes) {
        var r={alimentos:0,bebidas:0,otros:0,ventas:0,incompletos:0,completa:false};
        (cortes||[]).forEach(function(c){
            var v=ventasBruta(c); r.ventas+=v;
            if(v===0)return;
            var vals=['alimentos','bebidas','otros'].map(function(k){
                return c[k]===null||c[k]===undefined||String(c[k]).trim()===''?NaN:Number(c[k]);
            });
            if(vals.some(function(x){return !isFinite(x)||x<0;})||Math.abs(vals[0]+vals[1]+vals[2]-v)>.01){r.incompletos++;return;}
            r.alimentos+=vals[0];r.bebidas+=vals[1];r.otros+=vals[2];
        });
        r.completa=r.ventas>0&&r.incompletos===0;
        return r;
    }
    function metaRestaurante(t,k){
        t=t||{};
        function val(v){if(v==null||String(v).trim()==='')return null;var x=Number(v);return isFinite(x)&&x>=0?x:null;}
        var x=k==='utilidad'?val(t.util):val((t.operativos||{})[k]);
        if(x===null&&k==='staff'){
            var op=val(t.nomOp),ad=val(t.nomAdm);
            if(op!==null||ad!==null)x=(op||0)+(ad||0);
        }
        if(x===null&&k==='primo')x=val(t.primo);
        return x;
    }
    /* Referencias editoriales revisadas en octubre 2026. Son propuestas,
       nunca metas guardadas. Cocina/barra se ADAPTAN a venta total; la mezcla
       registrada debe cuadrar, y la alternativa se declara como supuesto. */
    function sugerenciasRestaurante(cortes,t,mezcla){
        var a=ventasPorArea(cortes),mix=mezcla||{};
        var cocina=a.completa?a.alimentos/a.ventas*100:70;
        var barra=a.completa?a.bebidas/a.ventas*100:30;
        if(mix.cocina!=null&&isFinite(Number(mix.cocina)))cocina=Math.max(0,Math.min(100,Number(mix.cocina)));
        if(mix.barra!=null&&isFinite(Number(mix.barra)))barra=Math.max(0,Math.min(100,Number(mix.barra)));
        var chequeMeta=metaRestaurante(t,'cheque');if(chequeMeta===null)chequeMeta=300;
        function red(x){return Math.round(x*100)/100;}
        return {cocina:red(35*cocina/100),barra:red(22*barra/100),staff:35,primo:65,
            utilidad:5,cheque:300,propinas:red(chequeMeta*.10),extra:2,
            mezcla:{cocina:red(cocina),barra:red(barra),origen:a.completa&&!mezcla?'registrada':'estimada'}};
    }
    /* Modelo del resumen: recibe el MISMO periodo ya acotado. Ventas, cobros,
       anticipos aplicados, otros ingresos y reservas conservan su identidad. */
    function detalleResumenFinanciero(d){
        d=d||{};var cortes=d.cortes||[],gastos=d.gastos||[],ctas=cuentasDebito(d.ctas||[]),deps=d.deps||[];
        var comision=cortes.reduce(function(t,c){return t+comisionBancoCorte(c,ctas,deps);},0);
        var opts={fijos:d.fijos||[],staff:d.staff||[],comisionBanco:comision};
        var cl=clasificarGastos(gastos,opts),area=costoInsumosPorArea(gastos,{fijos:opts.fijos,staff:opts.staff});
        var r={ventas:0,efectivo:0,tarjeta:0,transferencias:0,anticipos:0,propinas:0,comision:comision,
            nomina:{operativa:0,administrativa:0,socios:0,imss:0},impuestos:0,financieros:costoFinanciero(gastos,opts),
            pendientes:cl.pendiente,programados:cl.programado,compras:area,cuentas:[],cuentasInconsistentes:false,tpvPendiente:0,tpvDetalle:[],diasConCorte:0};
        var mapa={},dias={};
        function cuenta(id){id=id||'';if(!mapa[id]){var c=ctas.find(function(x){return x.id===id;});mapa[id]={id:id,nombre:c?(c.nombre||c.banco||'Cuenta'):'Sin cuenta asignada',tarjeta:0,transferencias:0};}return mapa[id];}
        cortes.forEach(function(c){
            r.ventas+=ventasBruta(c);r.efectivo+=n(c.efectivo);r.tarjeta+=n(c.tarjeta);r.transferencias+=n(c.transferencia);
            r.anticipos+=anticipoAplicado(c);r.propinas+=propinas(c);if(c.fecha)dias[c.fecha]=1;
            var b=ctaBaseCorte(c,ctas),baseId=b?b.id:'',td=0,tr=0;
            (c.tarjetaCuentas||[]).forEach(function(x){var m=n(x.ventaTC)+n(x.ventaTD);td+=m;cuenta(x.cuentaId).tarjeta+=m;});
            if(td>n(c.tarjeta)+.01)r.cuentasInconsistentes=true;
            else if(n(c.tarjeta)-td>.01)cuenta(baseId).tarjeta+=n(c.tarjeta)-td;
            (c.transferCuentas||[]).forEach(function(x){var m=n(x.monto);tr+=m;cuenta(x.cuentaId).transferencias+=m;});
            if(tr>n(c.transferencia)+.01)r.cuentasInconsistentes=true;
            else if(n(c.transferencia)-tr>.01)cuenta(baseId).transferencias+=n(c.transferencia)-tr;
            /* Pendiente de CONCILIAR: no afirma que el banco no haya pagado.
               Incluye propina TPV y respeta las comisiones reales al cerrar. */
            var h=tpvDelCorte(c,deps,null,ctas),pendiente=Math.max(0,h.netoEfectivo-h.conciliado);r.tpvPendiente+=pendiente;
            if(pendiente>0)r.tpvDetalle.push({fecha:c.fecha,concepto:'Corte '+(c.turno||''),sub:'Neto esperado menos abonos conciliados',monto:pendiente});
        });
        gastos.forEach(function(g){
            if(gastoEstatus(g)!=='pagado')return;var gr=grupoGasto(g,opts);
            if(gr==='imss')r.nomina.imss+=n(g.monto);
            else if(gr==='nomOp'||gr==='nomAdm'){
                var tipo=nomTipoGasto(g,opts.staff);r.nomina[tipo==='socios'?'socios':gr==='nomOp'?'operativa':'administrativa']+=n(g.monto);
            }
            if(gr!=='propina'&&/impuesto|\biva\b|\bisr\b|predial/i.test(g.categoria||''))r.impuestos+=n(g.monto);
        });
        r.cuentas=Object.keys(mapa).map(function(k){return mapa[k];});r.diasConCorte=Object.keys(dias).length;
        r.otros=n(d.otros);r.ingresos=r.ventas+r.otros;r.egresos=cl.egresos;
        r.apartados=previsionApartadoRango(deps,d.desde,d.hasta);
        r.resultado=r.ingresos-r.egresos;r.utilidad=r.resultado-r.apartados;
        r.areas=ventasPorArea(cortes);
        r.indicadores=indicadoresRestaurante({ventas:r.ventas,ingresos:r.ingresos,nomina:cl.nomOp+cl.nomAdm+cl.imss,
            utilidad:r.utilidad,gastos:gastos,gastoOpts:{fijos:opts.fijos,staff:opts.staff},cortes:cortes});
        return r;
    }

    /* Lo gastado en insumos del periodo.
       SOLO lo PAGADO: un pedido que todavía se debe no es costo de este mes
       (misma regla que clasificarGastos).

       Y SOLO lo que clasificarGastos ya puso en VARIABLE. Esto no es un detalle:
       `grupoGasto` puede mandar una compra a 'fijo' —si está ligada a un gasto
       fijo del catálogo, o si su categoría coincide con uno— y entonces ese
       dinero ya está contado en el renglón de fijos. Sumarlo también aquí lo
       contaría DOS VECES, y el «otros variables = variable − food» le restaría
       a un cubo donde nunca estuvo.

       Con este filtro queda garantizado que food ⊆ variable, que es lo que hace
       que los renglones del resumen sumen exactamente los egresos y ni un peso
       más. */
    function costoInsumos(gastos, opts) {
        opts = opts || {};
        return (gastos || []).reduce(function (t, g) {
            if (!esGastoInsumo(g)) return t;
            if (gastoEstatus(g) !== 'pagado') return t;
            if (grupoGasto(g, opts) !== 'variable') return t;
            return t + n(g.monto);
        }, 0);
    }

    /* El P&L del periodo. Recibe lo ya calculado por quien lo llama —ingresos,
       la clasificación de gastos, previsiones— para no volver a recorrer nada
       ni depender del DOM.

       `otrosVar` es el variable SIN los insumos: si no se restaran, el insumo
       se contaría dos veces (una en food cost y otra en variables) y la suma de
       porcentajes pasaría de 100 sin que se entienda por qué.                */
    function resumenPL(d) {
        d = d || {};
        var ventas   = n(d.ingresos);
        var food     = n(d.food);
        var nom      = n(d.nom);
        var fijos    = n(d.fijos);
        var otrosVar = Math.max(0, n(d.variables) - food);
        var prevs    = n(d.prevs);
        var egresos  = food + nom + fijos + otrosVar;
        var utilidad = ventas - egresos - prevs;
        /* Sin ventas no hay porcentaje que calcular: devolver 0 es más honesto
           que un Infinity o un NaN pintado en pantalla. */
        var pc = function (v) { return ventas > 0 ? (v / ventas) * 100 : 0; };
        return {
            ventas: ventas,
            lineas: [
                { k: 'food',   nom: 'Food cost',      monto: food,     pct: pc(food) },
                { k: 'nom',    nom: 'Nómina',         monto: nom,      pct: pc(nom) },
                { k: 'fijos',  nom: 'Gastos fijos',   monto: fijos,    pct: pc(fijos) },
                { k: 'otros',  nom: 'Otros variables',monto: otrosVar, pct: pc(otrosVar) },
                { k: 'prevs',  nom: 'Previsiones',    monto: prevs,    pct: pc(prevs) }
            ],
            egresos: egresos,
            prevs: prevs,
            utilidad: utilidad,
            utilidadPct: pc(utilidad)
        };
    }

    /* ── LA ESCALERA DEL RESTAURANTE ──────────────────────────────────────────
       El P&L de arriba contesta «cuánto entró y cuánto salió por cubo». Un
       restaurante se lee además por PELDAÑOS, y en ese orden, porque cada uno
       tiene una palanca distinta:

         Venta
          − Costo directo (lo que se compra para vender)  → UTILIDAD BRUTA
          − Nómina                                        → COSTO PRIMO
          − Gastos operativos                             → UTILIDAD OPERATIVA
          − Previsiones y financieros                     → UTILIDAD NETA

       EL COSTO PRIMO (prime cost) es el número que se mira primero en esta
       industria: insumos + nómina juntos. Sirve porque los dos se intercambian
       —se puede bajar el costo de producto a punta de mano de obra (hacer en
       casa lo que antes se compraba hecho) o al revés— y mirarlos por separado
       deja que uno tape al otro. Sano: 60-65% de la venta.

       LA UTILIDAD OPERATIVA es lo que queda de operar, antes de lo que no es
       operación. NO se le llama EBITDA aquí: EBITDA descuenta además
       depreciación y amortización, y ETAAX no lleva activos fijos. Ponerle ese
       nombre a un número que no los descuenta es dar por bueno un dato que un
       contador rechazaría. */
    function escaleraPL(pl, extra) {
        extra = extra || {};
        var ventas  = n(pl && pl.ventas);
        var linea   = function (k) {
            var l = ((pl && pl.lineas) || []).find(function (x) { return x.k === k; });
            return l ? n(l.monto) : 0;
        };
        var food    = linea('food');
        var nom     = linea('nom');
        var opex    = linea('fijos') + linea('otros');
        var prevs   = linea('prevs');
        var finan   = n(extra.financieros);        // sale del OPEX: no es operación
        var pc      = function (v) { return ventas > 0 ? (v / ventas) * 100 : 0; };

        var bruta   = ventas - food;
        var primo   = food + nom;
        /* Los financieros salen del operativo: pagar intereses no es operar. Si
           no se separan, un crédito caro se lee como una operación ineficiente
           y se va a apretar la cocina por un problema que está en el banco. */
        var opexOp  = Math.max(0, opex - finan);
        var operativa = bruta - nom - opexOp;
        var neta    = operativa - finan - prevs;

        return {
            ventas: ventas,
            bruta: bruta,        brutaPct: pc(bruta),
            primo: primo,        primoPct: pc(primo),
            opex: opexOp,        opexPct: pc(opexOp),
            financieros: finan,  financierosPct: pc(finan),
            operativa: operativa, operativaPct: pc(operativa),
            prevs: prevs,        prevsPct: pc(prevs),
            neta: neta,          netaPct: pc(neta)
        };
    }

    /* Lo gastado en intereses, comisiones de crédito y demás costo del dinero.
       Se mira la categoría del gasto, igual que todo lo demás. */
    var CATS_FINANCIERO = { 'gastos financieros': 1 };
    function costoFinanciero(gastos, opts) {
        opts = opts || {};
        return (gastos || []).reduce(function (t, g) {
            if (!g) return t;
            if (gastoEstatus(g) !== 'pagado') return t;
            if (!CATS_FINANCIERO[String(g.categoria || '').trim().toLowerCase()]) return t;
            var gr = grupoGasto(g, opts);
            if (gr !== 'variable' && gr !== 'fijo') return t;   // ya contado en otro cubo
            return t + n(g.monto);
        }, 0);
    }

    /* ── EL SCORE: qué tan cerca está de SUS metas ────────────────────────────
       Se mide contra las metas que el negocio configuró, no contra un estándar
       de revista: un bar de autor y una fonda tienen food costs sanos muy
       distintos, y calificar a los dos con la misma vara no ayuda a ninguno.

       Cada renglón da 0-100: 100 si cumple la meta o la mejora, y baja
       proporcionalmente conforme se aleja. La utilidad PESA DOBLE — es la
       razón de ser de todo lo demás, y un negocio puede tener food cost
       perfecto y seguir perdiendo dinero.

       Un renglón sin meta configurada NO se inventa: se queda fuera del
       promedio. Calificar contra un número que nadie puso es dar una nota
       falsa. */
    var PL_PESOS   = { food: 1, nom: 1, fijos: 1, otros: 1, prevs: 1, util: 2 };
    /* Para el gasto, menor es mejor; para la utilidad, mayor es mejor. */
    var PL_MAYOR   = { util: 1 };

    function _puntoLinea(real, meta, mayorEsMejor) {
        if (meta === null || meta === undefined || isNaN(meta)) return null;
        if (meta === 0) return (mayorEsMejor ? real >= 0 : real <= 0) ? 100 : 0;
        var razon = mayorEsMejor ? (real / meta) : (meta / real);
        if (!isFinite(razon)) return real <= 0 ? 100 : 0;
        if (razon >= 1) return 100;                 // cumple o mejora
        /* Se alejó: la nota baja con la distancia, y toca cero cuando se
           desvía el doble de la meta. Un castigo lineal es explicable; una
           curva «elegante» nadie la puede defender frente a un dueño. */
        return Math.max(0, Math.round(razon * 100));
    }

    function scorePL(pl, metas) {
        metas = metas || {};
        var det = [], suma = 0, peso = 0;
        (pl.lineas || []).forEach(function (l) {
            var p = _puntoLinea(l.pct, metas[l.k], !!PL_MAYOR[l.k]);
            det.push({ k: l.k, nom: l.nom, real: l.pct, meta: metas[l.k], punto: p });
            if (p === null) return;
            var w = PL_PESOS[l.k] || 1;
            suma += p * w; peso += w;
        });
        var pu = _puntoLinea(pl.utilidadPct, metas.util, true);
        det.push({ k: 'util', nom: 'Utilidad', real: pl.utilidadPct, meta: metas.util, punto: pu });
        if (pu !== null) { suma += pu * PL_PESOS.util; peso += PL_PESOS.util; }
        return {
            /* Sin una sola meta configurada no hay score: null, y la pantalla
               invita a ponerlas. Un 0 ahí diría «vas pésimo», que es mentira. */
            score: peso > 0 ? Math.round(suma / peso) : null,
            detalle: det,
            metasPuestas: peso > 0
        };
    }

    /* ── LA PROYECCIÓN: mover un renglón y ver todo lo demás ──────────────────
       `cambios` trae lo que el usuario movió: { ventas, food:{pct|monto}, … }.
       La UTILIDAD NUNCA se edita: es el resultado, no una entrada. Dejarla
       editar permitiría «proyectar» una utilidad que no sale de ningún lado —
       justo la clase de número que luego nadie puede explicar. */
    function proyectarPL(base, cambios) {
        cambios = cambios || {};
        var ventas = (cambios.ventas !== undefined && cambios.ventas !== null)
            ? n(cambios.ventas) : n(base.ventas);
        var lineas = (base.lineas || []).map(function (l) {
            var c = cambios[l.k] || {};
            var monto, pct;
            if (c.pct !== undefined && c.pct !== null) {
                /* Tocó el PORCENTAJE: manda, y el monto se recalcula sobre las
                   ventas proyectadas. */
                pct = n(c.pct); monto = ventas * pct / 100;
            } else if (c.monto !== undefined && c.monto !== null) {
                monto = n(c.monto); pct = ventas > 0 ? (monto / ventas) * 100 : 0;
            } else {
                /* Sin tocar: se conserva el PORCENTAJE, no el monto. Si suben
                   las ventas, el food cost sube con ellas — es variable. Dejar
                   el monto fijo proyectaría una cocina que produce de más sin
                   comprar de más, que no existe. */
                pct = l.pct; monto = ventas * pct / 100;
            }
            return { k: l.k, nom: l.nom, monto: monto, pct: pct };
        });
        /* Los FIJOS son la excepción: no suben porque vendas más. Esa es su
           definición, y es de donde sale la mitad del apalancamiento de un
           restaurante — venderle más al mismo local. */
        lineas.forEach(function (l) {
            var c = cambios[l.k] || {};
            if (l.k !== 'fijos') return;
            if (c.pct !== undefined && c.pct !== null) return;
            var monto = (c.monto !== undefined && c.monto !== null)
                ? n(c.monto)
                : (base.lineas.filter(function (x) { return x.k === 'fijos'; })[0] || {}).monto || 0;
            l.monto = monto;
            l.pct = ventas > 0 ? (monto / ventas) * 100 : 0;
        });
        var egresos = lineas.reduce(function (t, l) { return t + l.monto; }, 0);
        var utilidad = ventas - egresos;
        return {
            ventas: ventas, lineas: lineas, egresos: egresos,
            utilidad: utilidad,
            utilidadPct: ventas > 0 ? (utilidad / ventas) * 100 : 0
        };
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
       2) el mínimo vigente si su sueldo está vinculado a ese parámetro.
       3) el sueldo personalizado, incluido un CERO capturado a propósito.
       4) el mínimo del negocio, si nunca se le capturó nada. Devolver cero
          ahí haría que la proyección saliera más baja que la realidad, y un
          renglón en cero nadie lo revisa: parece que ese colaborador no cuesta.

       `sueldoCapturado` es lo que separa "puse cero" de "nunca lo llené":
       parseFloat('') || 0 los vuelve idénticos, y sin esa marca un cero escrito
       a mano se ignoraba y se sustituía por el mínimo. Los registros viejos no
       la traen. `origenSueldo` y la foto de referencias en los parámetros
       separan el mínimo precargado del sueldo personalizado de esos registros. */
    function minimoDiarioNomina(params) {
        return n(params && typeof params === 'object' ? params.salarioDiarioDefault : params);
    }

    /* Los registros nuevos dicen su origen. Para los anteriores, el parámetro
       conserva una foto de su referencia ANTES de cambiar el mínimo: así un
       sueldo personalizado no se vincula si el mínimo alcanza después su monto.
       La firma del importe también protege cambios desde un editor antiguo. */
    function sueldoUsaMinimo(s, params) {
        if (!s || s.esquemaSueldo !== 'diario') return false;
        if (s.origenSueldo === 'personalizado') return false;
        if (s.origenSueldo === 'minimo') return true;
        var refs = params && typeof params === 'object' && params.referenciasSueldo;
        var ref = refs && Object.prototype.hasOwnProperty.call(refs, s.id) ? refs[s.id] : null;
        if (ref) return ref.origen === 'minimo' &&
            Math.round(n(ref.sueldoDiario) * 100) === Math.round(n(s.sueldoDiario) * 100);
        var diario = n(s.sueldoDiario), minimo = minimoDiarioNomina(params);
        if (!diario) return !s.sueldoCapturado;
        return !!(params && typeof params === 'object' && minimo > 0 &&
            Math.round(diario * 100) === Math.round(minimo * 100));
    }

    /* Descuento por ocurrencia: cantidad entera, tarifa editable y centavos al
       final. Comparte la regla el perfil y el editor de pago de nómina. */
    function descuentoRetardos(cantidad, tarifa) {
        var cant = Number(cantidad), importe = Number(tarifa);
        cant = Number.isFinite(cant) ? Math.max(0, Math.floor(cant)) : 0;
        importe = Number.isFinite(importe) ? Math.max(0, Math.round(importe * 100) / 100) : 0;
        return {cantidad:cant, tarifa:importe, monto:Math.round(cant * importe * 100) / 100};
    }

    function sueldoDiarioEfectivo(s, salarioDiarioDefault) {
        if (!s) return 0;
        if (s.sinCostoNegocio) return 0;
        if (sueldoUsaMinimo(s, salarioDiarioDefault)) return minimoDiarioNomina(salarioDiarioDefault);
        var cap = !!s.sueldoCapturado || s.origenSueldo === 'personalizado';
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
        return minimoDiarioNomina(salarioDiarioDefault);
    }

    /* Lo que cuesta ese colaborador en un mes. No es sueldoDiarioEfectivo × días:
       un sueldo fijo por periodo se mensualiza por su periodicidad, no por los
       días que traiga el mes. */
    function baseMensualStaff(s, diasDelMes, salarioDiarioDefault) {
        if (!s) return 0;
        if (s.sinCostoNegocio) return 0;
        var cap = !!s.sueldoCapturado || s.origenSueldo === 'personalizado', dias = n(diasDelMes) || 30;
        if (sueldoUsaMinimo(s, salarioDiarioDefault)) return minimoDiarioNomina(salarioDiarioDefault) * dias;
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
        return minimoDiarioNomina(salarioDiarioDefault) * dias;
    }

    /* ¿El sueldo sale del mínimo del negocio y no de su ficha? Para decirlo en
       pantalla: pagar el mínimo por descuido y pagarlo a propósito se ven igual. */
    function sueldoEsDelMinimo(s, salarioDiarioDefault) {
        if (s && !s.sinCostoNegocio && sueldoUsaMinimo(s, salarioDiarioDefault))
            return minimoDiarioNomina(salarioDiarioDefault) > 0;
        if (!s || s.sinCostoNegocio || s.sueldoCapturado || s.origenSueldo === 'personalizado') return false;
        if (s.esquemaSueldo === 'diario' && n(s.sueldoDiario) > 0) return false;
        if (s.esquemaSueldo !== 'diario' && n(s.salarioBase) > 0) return false;
        return minimoDiarioNomina(salarioDiarioDefault) > 0;
    }

    /* Compra por contenido: contNeto es el contenido de UNA pieza/empaque de
       referencia. Contar cerezas/huevos nunca multiplica ese contenido.
       La masa drenada, cuando existe, es el contenido que se puede utilizar. */
    function contenidoUtilPresentacion(p) {
        p = p || {};
        var drenada = n(p.masaDrenada) > 0;
        var cantidad = Math.max(0, n(drenada ? p.masaDrenada : p.contNeto));
        var um = String((drenada ? p.umMasaDrenada : p.umContenido) || 'G').toUpperCase();
        var factores = { G:1, KG:1000, ML:1, LT:1000, OZ:29.5735 };
        return { cantidad: cantidad, um: um, base: cantidad * (factores[um] || 0),
                 umBase: ['G','KG'].indexOf(um) >= 0 ? 'G' : 'ML', drenada: drenada };
    }
    function factorImpuestoPresentacion(p) {
        if (p.incluyeImpuesto !== '0') return 1;
        return (p.ivaCheck === '1' ? 1.16 : 1) *
            (p.iepsCheck === '1' ? 1 + n(p.iepsTasa || '26.5') / 100 : 1);
    }
    // En frutas/proteínas a granel el editor anterior podía guardar 1 KG
    // como peso de CADA fruto y multiplicarlo por 160. Reconocer únicamente
    // esa referencia exacta (la compra o una unidad de compra), sin reinterpretar
    // paquetes cuyo contenido individual sí estaba bien capturado.
    function contenidoCompraPresentacion(p, tipoInsumo) {
        p = p || {};
        var contenido = p.contNeto || '';
        if (['fruta','carne'].indexOf(tipoInsumo) < 0) return contenido;
        var factores = { G:1, KG:1000, ML:1, LT:1000 };
        var umCompra = String(p.umPresCompra || 'KG').toUpperCase();
        var umCont = String(p.umContenido || 'G').toUpperCase();
        var mismaDimension = (['KG','G'].indexOf(umCompra) >= 0) === (['KG','G'].indexOf(umCont) >= 0);
        var total = n(contenido) * (factores[umCont] || 0);
        var sub = n(p.contSub) * (factores[umCont] || 0);
        var compra = n(p.cantPresCompra) * (factores[umCompra] || 0);
        var piezas = n(p.unidadesPorPieza);
        var coincide = function(a,b){ return Math.abs(a-b) < 0.000001; };
        if (mismaDimension && piezas > 1 && compra > 0 && sub > 0 && total > compra &&
            coincide(total, sub * piezas) && (coincide(sub, compra) || coincide(sub, factores[umCompra] || 0))) {
            return p.contSub;
        }
        return contenido;
    }
    function costosAbarrote(p, precioEfectivo, tipoInsumo) {
        p = p || {};
        var contenidoCompra = contenidoCompraPresentacion(p, tipoInsumo);
        if (contenidoCompra !== p.contNeto) p = Object.assign({}, p, { contNeto:contenidoCompra });
        // Masa drenada es una captura de Abarrotes; conservar el criterio de
        // frutas/proteínas aunque la ficha provenga de una conversión de tipo.
        if (['fruta','carne'].indexOf(tipoInsumo) >= 0 && n(p.masaDrenada) > 0)
            p = Object.assign({}, p, { masaDrenada:'' });
        var precio = Math.max(0, precioEfectivo === undefined
            ? n(p.precio) * factorImpuestoPresentacion(p) : n(precioEfectivo));
        var cantidad = n(p.cantPresCompra) > 0 ? n(p.cantPresCompra) : 1;
        var umCompra = String(p.umPresCompra || (['fruta','carne'].indexOf(tipoInsumo) >= 0 ? 'KG' : '')).toUpperCase();
        // La unidad manda, incluso si la presentación se llama Bolsa o Costal.
        // Las fichas antiguas sin unidad conservan su referencia Kilo/Litro.
        if (!umCompra) {
            var nombre = String(p.presentacionCompra || '').toLowerCase().trim();
            if (/^(kilo|kilos|granel|a granel|a granel — kg)$/.test(nombre)) umCompra = 'KG';
            else if (/^(litro|litros)$/.test(nombre)) umCompra = 'LT';
            else if (/^(gramo|gramos)$/.test(nombre)) umCompra = 'G';
        }
        var factores = { G:1, KG:1000, ML:1, LT:1000, OZ:29.5735 };
        var compraBase = cantidad * (factores[umCompra] || 0);
        var neto = Math.max(0, n(p.contNeto)) * (factores[String(p.umContenido || 'G').toUpperCase()] || 0);
        var util = contenidoUtilPresentacion(p);
        var piezas = cantidad;
        if (compraBase > 0) {
            var pesoCompra = ['G','KG'].indexOf(umCompra) >= 0;
            var pesoNeto = ['G','KG'].indexOf(String(p.umContenido || 'G').toUpperCase()) >= 0;
            // Una compra de 5 KG puede describir una referencia de 1 KG con
            // 16 huevos. Su costo de referencia es 1/5 del importe comprado.
            var referencia = neto > 0 && pesoCompra === pesoNeto ? neto : factores[umCompra];
            piezas = compraBase / referencia;
            if (!(util.base > 0)) util = { base: referencia, umBase: pesoCompra ? 'G' : 'ML', drenada:false };
        }
        var costoPieza = precio / piezas;
        var porPieza = Math.max(0, n(p.unidadesPorPieza));
        var medible = util.base > 0;
        return { costoCompra: precio, costoPieza: costoPieza,
            costoUnitario: medible ? costoPieza * 1000 / util.base : costoPieza,
            umCosto: medible ? (util.umBase === 'G' ? 'KG' : 'LT') : 'PZA',
            costoSubUnidad: porPieza > 0 ? costoPieza / porPieza : 0,
            contenidoSubUnidad: porPieza > 0 ? util.base / porPieza : 0,
            contenidoBase: util.base, umBase: util.umBase, drenada: util.drenada };
    }

    // Cantidades de inventario: la familia no cambia la conversión. PZA es
    // un empaque; su contNeto ya está expresado en g/ml utilizables por la fila.
    function cantidadBaseInventario(cantidad, unidad) {
        var u = String(unidad || '').toUpperCase();
        var factor = (u === 'KG' || u === 'LT' || u === 'L') ? 1000 : (u === 'OZ' ? 29.5735 : 1);
        return n(cantidad) * factor;
    }
    function cantidadFilaInventario(cantidad, unidad, fila) {
        var u = String(unidad || '').toUpperCase();
        var base = cantidadBaseInventario(cantidad, u);
        if (!fila) return base;
        var entradaPieza = u === 'PZA' || u === 'PZ' || u === '';
        var salidaPieza = fila.tipo === 'pza' ||
            (fila.tipo === 'peso' && String(fila.baseUnit || '').toUpperCase() === 'PZA');
        var contenido = n(fila.contNeto);
        if (entradaPieza) {
            if (salidaPieza) return base;
            base *= contenido;
        }
        if (salidaPieza) return contenido > 0 ? base / contenido : 0;
        if (fila.tipo === 'copa') return n(fila.copaML) > 0 ? base / n(fila.copaML) : 0;
        return base;
    }

    // Equivalencias del líquido abierto; las botellas cerradas no entran aquí.
    function equivalenciasLiquidoInventario(ml, copaML) {
        var liquido = Math.max(0, n(ml)), copa = n(copaML);
        return { ml:liquido, copas:copa > 0 ? liquido / copa : null, onzas:liquido / 29.5735 };
    }
    // Los límites del catálogo están en botellas/piezas/unidades de compra.
    // La fila, en cambio, puede estar en copas, gramos o mililitros utilizables.
    function unidadesCompraInventario(cantidad, fila) {
        if (!fila) return null;
        var q = n(cantidad), contenido = n(fila.contNeto);
        if (fila.tipo === 'pza' || (fila.tipo === 'peso' && String(fila.baseUnit).toUpperCase() === 'PZA')) return q;
        if (fila.tipo === 'copa') return contenido > 0 && n(fila.copaML) > 0 ? q * n(fila.copaML) / contenido : null;
        if (fila.tipo === 'peso') return contenido > 0 ? q / contenido : null;
        return null;
    }
    function estadoStockInventario(existencia, minimo, maximo) {
        function numero(v) { return v == null || String(v).trim() === '' ? null : Number(v); }
        var min = numero(minimo), max = numero(maximo), actual = numero(existencia);
        var invalido = [min,max].some(function(v){ return v !== null && (!isFinite(v) || v < 0); });
        // Cero es el valor histórico de "sin máximo". Un mínimo de cero sí vale.
        if (max === 0) max = null;
        if (invalido || (max !== null && min !== null && max < min)) return { estado:'revisar', minimo:min, maximo:max, actual:actual };
        var estado = 'sin-parametros';
        if (max !== null || min > 0) {
            if (actual === null || !isFinite(actual)) estado = 'sin-equivalencia';
            else if (max !== null && actual >= max - 1e-9) estado = 'ideal';
            else if (actual <= (min === null ? 0 : min) + 1e-9) estado = 'bajo';
            else estado = 'intermedio';
        }
        return { estado:estado, minimo:min, maximo:max, actual:actual };
    }

    // Una subreceta tiene una tanda base y varias maneras de porcionarla.
    // Los IDs pertenecen a la unidad seleccionada; el insumo sigue siendo uno.
    function rendimientosSubReceta(cx, nombre) {
        cx = cx || {};
        var lista = Array.isArray(cx.rendimientosPorcion) && cx.rendimientosPorcion.length
            ? cx.rendimientosPorcion : [Object.assign({ id:'principal', nombre:nombre || '' }, cx)];
        return lista.map(function(r, i){
            return { id:String(r.id || (i === 0 ? 'principal' : 'rend_' + i)),
                nombre:String(r.nombre || (i === 0 ? nombre || '' : 'Presentación ' + (i+1))), inactiva:r.inactiva === true,
                porcionesQty:n(r.porcionesQty) > 0 ? n(r.porcionesQty) : '',
                porcionesUnidad:r.porcionesUnidad || 'pzas',
                pesoPorcion:n(r.pesoPorcion) > 0 ? n(r.pesoPorcion) : '',
                unidadPesoPorcion:r.unidadPesoPorcion || 'G' };
        });
    }
    function calcularPorcionSubReceta(cx, r, costo) {
        cx = cx || {}; r = r || {};
        var u = String(cx.unidadRendimientoFinal || 'G').toUpperCase();
        var base = cantidadBaseInventario(n(cx.rendimientoFinal), u);
        var unidadBase = u === 'KG' ? 'G' : (u === 'LT' || u === 'L' || u === 'OZ') ? 'ML' : u;
        if (u === 'PZA' && n(cx.pesoPieza) > 0) {
            base *= cantidadBaseInventario(n(cx.pesoPieza), cx.unidadPesoPieza);
            unidadBase = /^(ML|LT|L|OZ)$/i.test(cx.unidadPesoPieza) ? 'ML' : 'G';
        }
        var qty = n(r.porcionesQty), peso = n(r.pesoPorcion);
        var pu = /^(ML|LT|L|OZ)$/i.test(r.unidadPesoPorcion || '') ? 'ML' : 'G';
        if (!(base > 0) || !isFinite(base)) return { valido:false, cantidad:0, contenidoBase:0, costo:0, unidadBase:unidadBase };
        if (!(qty > 0) && peso > 0 && pu === unidadBase) qty = base / cantidadBaseInventario(peso, r.unidadPesoPorcion);
        if (!(qty > 0) || !isFinite(qty)) return { valido:false, cantidad:0, contenidoBase:0, costo:0, unidadBase:unidadBase };
        return { valido:true, cantidad:qty, contenidoBase:base/qty,
            costo:n(costo)/qty, unidadBase:unidadBase, rendimientoBase:base };
    }
    function porcionesInsumoSubReceta(ins) {
        if (!ins || !ins.esSubReceta) return [];
        var pres = ins.presentaciones || [];
        var definidas = pres.filter(function(p){ return p.esRendimientoPorcion; });
        if (definidas.length) return definidas;
        // Compatibilidad: las conversiones antiguas guardaban una sola PZA.
        var p = pres.find(function(p){ return /^(PZA|PORCION)$/i.test(p.umCosto || p.umContenido); });
        if (!p) return [];
        var tanda = pres.find(function(x){ return /^(G|KG|ML|LT)$/i.test(x.umRendimiento || x.umContenido); });
        var base = tanda ? cantidadBaseInventario(n(tanda.rendimiento) || n(tanda.contNeto), tanda.umRendimiento || tanda.umContenido) : 0;
        return [Object.assign({}, p, { rendimientoId:'principal', nombreRendimiento:ins.nombre,
            contenidoPorcionBase:base > 0 && n(p.rendimiento) > 0 ? base/n(p.rendimiento) : 1,
            unidadPorcionBase:tanda && /^(ML|LT)$/i.test(tanda.umRendimiento || tanda.umContenido) ? 'ML' : tanda ? 'G' : 'PZA' })];
    }
    function porcionSubRecetaParaUnidad(ins, unidad) {
        var u = String(unidad || '').toUpperCase(), lista = porcionesInsumoSubReceta(ins);
        if (u === 'PZA' || u === 'PORCION') return lista[0] || null;
        if (u.indexOf('RENDIMIENTO:') !== 0) return null;
        return lista.find(function(p){ return String(p.rendimientoId).toUpperCase() === u.slice(12); }) || null;
    }
    window.EtaaxCore = {
        equivalenciasLiquidoInventario: equivalenciasLiquidoInventario,
        unidadesCompraInventario: unidadesCompraInventario,
        estadoStockInventario: estadoStockInventario,
        rendimientosSubReceta: rendimientosSubReceta,
        calcularPorcionSubReceta: calcularPorcionSubReceta,
        porcionesInsumoSubReceta: porcionesInsumoSubReceta,
        porcionSubRecetaParaUnidad: porcionSubRecetaParaUnidad,
        cantidadBaseInventario: cantidadBaseInventario,
        cantidadFilaInventario: cantidadFilaInventario,
        contenidoUtilPresentacion: contenidoUtilPresentacion,
        factorImpuestoPresentacion: factorImpuestoPresentacion,
        costosAbarrote: costosAbarrote,
        costosPresentacion: costosAbarrote,
        contenidoCompraPresentacion: contenidoCompraPresentacion,
        sueldoDiarioEfectivo: sueldoDiarioEfectivo,
        descuentoRetardos: descuentoRetardos,
        sueldoUsaMinimo: sueldoUsaMinimo,
        baseMensualStaff: baseMensualStaff,
        sueldoEsDelMinimo: sueldoEsDelMinimo,
        n: n, fmtM: fmtM, fmtN: fmtN, genId: genId, todayStr: todayStr,
        gastoEsIMSS: gastoEsIMSS, gastoEsNomina: gastoEsNomina, gastoEsPropina: gastoEsPropina,
        gastoEsFijoPat: gastoEsFijoPat, gastoEsPagoFijo: gastoEsPagoFijo, nomTipoGasto: nomTipoGasto,
        clasificarGastos: clasificarGastos, grupoGasto: grupoGasto, grupoGastoUI: grupoGastoUI,
        CATS_INSUMO: CATS_INSUMO, esGastoInsumo: esGastoInsumo, costoInsumos: costoInsumos,
        resumenPL: resumenPL, scorePL: scorePL, proyectarPL: proyectarPL,
        CATS_BARRA: CATS_BARRA, areaInsumo: areaInsumo, costoInsumosPorArea: costoInsumosPorArea,
        indicadoresRestaurante: indicadoresRestaurante,
        ventasPorArea: ventasPorArea, metaRestaurante: metaRestaurante,
        sugerenciasRestaurante: sugerenciasRestaurante, detalleResumenFinanciero: detalleResumenFinanciero,
        escaleraPL: escaleraPL, CATS_FINANCIERO: CATS_FINANCIERO, costoFinanciero: costoFinanciero,
        PL_PESOS: PL_PESOS,
        planFijoPago: planFijoPago,
        getNegocioActivo: getNegocioActivo, sucActiva: sucActiva, scopeSuc: scopeSuc, esDeSuc: esDeSuc,
        getWeekStr: getWeekStr, semanaISO: semanaISO, getRange: getRange, prevRange: prevRange, inRange: inRange,
        efNeto: efNeto, taBanco: taBanco, ventasBruta: ventasBruta, flujoNeto: flujoNeto,
        propinas: propinas, cheque: cheque, resultado: resultado, resguardo: resguardo,
        comEf: comEf, netoCuenta: netoCuenta, taBancoNeto: taBancoNeto, taBancoNetoDetalle: taBancoNetoDetalle,
        ctaBaseCorte: ctaBaseCorte, ctaBaseCatalogo: ctaBaseCatalogo,
        cuentasDebito: cuentasDebito, cuentasDebitoActivas: cuentasDebitoActivas, ctaActiva: ctaActiva,
        comisionBancoCorte: comisionBancoCorte,
        nomEsAdm: _nomEsAdm, gastoEstatus: gastoEstatus, gastoPagado: gastoPagado, gastoEspera: gastoEspera,
        absorbeCajaChica: absorbeCajaChica,
        esAnticipo: esAnticipo, esAnticipoDev: esAnticipoDev, anticipoFondo: anticipoFondo,
        anticipoSaldos: anticipoSaldos, anticipoAplicado: anticipoAplicado,
        anticiposDelDia: anticiposDelDia,
        netoPropina: netoPropina,
        depEfecto: depEfecto, esRetiro: esRetiro,
        MOV_TIPOS: MOV_TIPOS, movTipo: movTipo, movEfecto: movEfecto,
        movsCorte: movsCorte, movsFuerte: movsFuerte, bancoCorte: bancoCorte,
        esApartado: esApartado, apartadoFondo: apartadoFondo, PREV_GENERAL: PREV_GENERAL,
        esAbonoTpv: esAbonoTpv, tpvDeCorte: tpvDeCorte, tpvConciliacion: tpvConciliacion,
        tpvCuentaConcilia: tpvCuentaConcilia,
        tpvHechos: tpvHechos, tpvDelCorte: tpvDelCorte, tpvFolioRepetido: tpvFolioRepetido,
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
