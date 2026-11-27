/* ══ TABLERO DE INGRESOS DE ETAAX (Edwin, 27-nov) ═════════════════════════════
   El «Resumen financiero» de ETAAX como negocio: lo que cobra mes a mes y quién
   le paga. Sale de los recibos del historial (admin_documentos) con la MISMA
   vara que el resumen del mes —recibos, sin anulados ni eliminados, en MXN, el
   MRR repartido entre los meses que cubre cada suscripción— y del estado de
   suscripción de cada negocio (el mismo de la lista de Negocios).
     · cuatro cifras: MRR (y su ARR), cobrado, pendiente y clientes al corriente;
     · la gráfica del MRR de los últimos 12 meses, con su tabla;
     · la cobranza por cliente.
   Las fórmulas viven en el núcleo (EtaaxCore.serieIngresosAdmin y
   clientesIngresosAdmin): aquí solo se pintan. */
(function () {
    'use strict';
    var _mes = '', _docs = [], _cargado = false;
    var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
    function dinero(v) { return '$' + Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function corto(v) {
        v = Number(v || 0);
        if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + ' M';
        if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + ' k';
        return '$' + Math.round(v);
    }
    function hoyMes() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
    function nomMes(k, largo) { var m = +String(k).slice(5, 7); return (MESES[m - 1] || '') + (largo ? ' ' + String(k).slice(0, 4) : ' ' + String(k).slice(2, 4)); }
    function ic(n, t) { return (typeof window.etaaxIcono === 'function') ? (window.etaaxIcono(n, { tam: t || 18 }) || '') : ''; }

    function estilos() {
        if ($('atbEstilos')) return;
        var st = document.createElement('style'); st.id = 'atbEstilos';
        st.textContent =
            '.atb,#atbCuerpo{display:flex;flex-direction:column;gap:16px}' +
            '.atb-cab{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.atb-cab label{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}' +
            '.atb-cab input{background:var(--s2);border:1px solid var(--b1);color:var(--text);font:inherit;font-size:13px;border-radius:9px;padding:9px 10px}' +
            '.atb-cab p{flex:1;min-width:240px;margin:0;font-size:12px;color:var(--muted);line-height:1.5}' +
            '.atb-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}@media(max-width:900px){.atb-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
            '.atb-kpi{padding:16px 18px;border:1px solid var(--b1);border-radius:14px;background:var(--s1);min-width:0}' +
            '.atb-kpi small{display:block;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted)}' +
            '.atb-kpi strong{display:block;font-size:26px;font-weight:700;letter-spacing:-.5px;margin:6px 0 3px;color:var(--text);font-variant-numeric:tabular-nums}' +
            '.atb-kpi span{font-size:12px;color:var(--muted)}.atb-kpi span b{color:var(--text);font-weight:600}' +
            '.atb-kpi .sube{color:var(--green)}.atb-kpi .baja{color:var(--red)}' +
            '.atb-aviso{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border:1px solid rgba(224,169,61,.5);border-radius:12px;background:rgba(224,169,61,.07);font-size:12.5px;color:var(--text)}' +
            '.atb-aviso button,.atb-btn{background:transparent;border:1px solid var(--b1);color:var(--text);border-radius:9px;padding:7px 12px;font:inherit;font-size:12px;cursor:pointer}' +
            '.atb-aviso button:hover,.atb-btn:hover{border-color:var(--cyan-line)}' +
            '.atb-caja{border:1px solid var(--b1);border-radius:16px;background:var(--s1);padding:16px 18px}' +
            '.atb-caja h3{margin:0;font-size:15px;color:var(--text)}.atb-caja>p{margin:3px 0 12px;font-size:12px;color:var(--muted)}' +
            /* La gráfica: una sola serie (el MRR), barras delgadas ancladas a la base, extremo redondeado de 4 px,
               rejilla tenue, cuadrito al pasar y la cifra solo en el mes elegido. */
            '.atb-graf{position:relative}.atb-graf svg{display:block;width:100%;height:auto;overflow:visible}' +
            '.atb-graf .rej{stroke:var(--b1);stroke-width:1}.atb-graf .eje{fill:var(--muted);font-size:11px;font-family:inherit}' +
            '.atb-graf .barra,.atb-graf .val,.atb-graf .eje{pointer-events:none}.atb-graf .barra{fill:var(--cyan);opacity:.55}.atb-graf .barra.on{opacity:1}.atb-graf .val{fill:var(--text);font-size:11.5px;font-weight:600;font-family:inherit}' +
            '.atb-graf .zona{fill:transparent;cursor:pointer}.atb-graf .zona:hover+.barra,.atb-graf .zona:focus+.barra{opacity:1}' +
            '.atb-tip{position:absolute;pointer-events:none;z-index:5;min-width:160px;padding:9px 11px;border-radius:10px;background:var(--s2);border:1px solid var(--b1);box-shadow:0 8px 22px rgba(0,0,0,.25);font-size:12px;color:var(--text);transform:translate(-50%,-100%)}' +
            '.atb-tip b{display:block;margin-bottom:4px}.atb-tip div{display:flex;justify-content:space-between;gap:14px;color:var(--muted)}.atb-tip div span:last-child{color:var(--text);font-variant-numeric:tabular-nums}' +
            '.atb-caja details{margin-top:10px}.atb-caja summary{cursor:pointer;font-size:12px;color:var(--cyan)}' +
            '.atb-tabla{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}.atb-tabla th{text-align:left;font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--b1)}' +
            '.atb-tabla td{padding:10px;border-bottom:1px solid var(--b1);color:var(--text);vertical-align:middle}.atb-tabla td.n,.atb-tabla th.n{text-align:right;font-variant-numeric:tabular-nums}' +
            '.atb-tabla td small{display:block;color:var(--muted);font-size:11px}.atb-wrap{overflow-x:auto}' +
            '.atb-estado{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 9px;border-radius:20px;border:1px solid var(--b1);white-space:nowrap}' +
            '.atb-estado i{width:7px;height:7px;border-radius:50%;display:inline-block}' +
            '.atb-vacio{padding:18px;text-align:center;color:var(--muted);font-size:13px}';
        document.head.appendChild(st);
    }

    async function montar() {
        var box = $('tab-tablero'); if (!box) return;
        estilos();
        if (!_mes) _mes = hoyMes();
        box.innerHTML = '<div class="atb"><div class="atb-cab"><label>Mes <input type="month" id="atbMes" value="' + esc(_mes) + '"></label>' +
            '<p>Con la misma vara del historial de recibos: solo recibos (los presupuestos no son ingreso), sin anulados ni eliminados, en MXN. ' +
            'El MRR reparte cada suscripción entre los meses que cubre.</p>' +
            '<button type="button" class="atb-btn" id="atbActualizar">Actualizar</button></div><div id="atbCuerpo"><p class="atb-vacio">Leyendo los recibos…</p></div></div>';
        $('atbMes').onchange = function () { if (this.value) { _mes = this.value; pintar(); } };
        $('atbActualizar').onclick = function () { _cargado = false; montar(); };
        if (!_cargado) {
            try { if (window.AdminDocs && AdminDocs.cargar) { await AdminDocs.cargar(); _docs = AdminDocs.lista(); } } catch (e) { _docs = []; }
            _cargado = true;
        }
        pintar();
    }

    function estadoNegocio(id) {
        if (!id || typeof window._estadoSuscripcion !== 'function') return null;
        try { return window._estadoSuscripcion(id); } catch (e) { return null; }
    }
    function nombreNegocio(id) {
        var n = ((window._data && window._data.negocios) || []).find(function (x) { return x.id === id; });
        return (n && n.datos && n.datos.nombre) || '';
    }

    function pintar() {
        var c = $('atbCuerpo'); if (!c || !window.EtaaxCore) return;
        var C = window.EtaaxCore, r = C.resumenDocumentosAdmin(_docs, _mes);
        var serie = C.serieIngresosAdmin(_docs, _mes, 12), prev = serie.length > 1 ? serie[serie.length - 2].mrr : 0;
        var clientes = C.clientesIngresosAdmin(_docs, _mes);
        var negs = (window._data && window._data.negocios) || [], cuenta = { activa: 0, tolerancia: 0, vencida: 0, otros: 0 };
        negs.forEach(function (n) { var e = estadoNegocio(n.id), k = e && e.estado; if (k === 'activa' || k === 'tolerancia' || k === 'vencida') cuenta[k]++; else cuenta.otros++; });
        var pendientes = _docs.filter(function (d) { return d.tipo === 'recibo' && d.estado === 'pendiente'; }).length;
        var dif = prev ? (r.mrr - prev) / prev * 100 : null;

        var kpis = '<div class="atb-kpis">' +
            '<div class="atb-kpi"><small>MRR · ' + esc(nomMes(_mes, true)) + '</small><strong>' + dinero(r.mrr) + '</strong><span>ARR <b>' + dinero(r.mrr * 12) + '</b>' +
                (dif == null ? '' : ' · <b class="' + (dif >= 0 ? 'sube' : 'baja') + '">' + (dif >= 0 ? '+' : '') + dif.toFixed(1) + '%</b> vs. mes anterior') + '</span></div>' +
            '<div class="atb-kpi"><small>Cobrado en el mes</small><strong>' + dinero(r.cobrado) + '</strong><span>Emitido <b>' + dinero(r.emitido) + '</b></span></div>' +
            '<div class="atb-kpi"><small>Pendiente de cobro</small><strong>' + dinero(r.pendiente) + '</strong><span><b>' + pendientes + '</b> ' + (pendientes === 1 ? 'recibo pendiente' : 'recibos pendientes') + ' · todos los meses</span></div>' +
            '<div class="atb-kpi"><small>Clientes al corriente</small><strong>' + cuenta.activa + ' <span style="font-size:15px;font-weight:500">de ' + negs.length + '</span></strong><span><b>' + cuenta.tolerancia + '</b> en tolerancia · <b>' + cuenta.vencida + '</b> ' + (cuenta.vencida === 1 ? 'vencido' : 'vencidos') + '</span></div>' +
        '</div>';
        var aviso = r.porClasificar ? '<div class="atb-aviso">' + ic('rec-alerta', 18) + '<span><b>' + r.porClasificar + '</b> ' + (r.porClasificar === 1 ? 'recibo sin clasificar no cuenta' : 'recibos sin clasificar no cuentan') + ' en el MRR.</span>' +
            '<button type="button" onclick="AdmTablero.clasificar()">Clasificarlos en el historial</button></div>' : '';

        c.innerHTML = kpis + aviso +
            '<section class="atb-caja"><h3>MRR documentado · últimos 12 meses</h3><p>Lo que ETAAX factura en suscripciones cada mes, sin servicios. Toca una barra para ver el mes.</p>' +
                '<div class="atb-graf" id="atbGraf">' + grafica(serie, c.clientWidth - 38) + '</div>' +
                '<details><summary>Ver los números</summary><div class="atb-wrap"><table class="atb-tabla"><thead><tr><th>Mes</th><th class="n">MRR</th><th class="n">Emitido</th><th class="n">Cobrado</th></tr></thead><tbody>' +
                    serie.slice().reverse().map(function (x) { return '<tr><td>' + esc(nomMes(x.mes, true)) + '</td><td class="n">' + dinero(x.mrr) + '</td><td class="n">' + dinero(x.emitido) + '</td><td class="n">' + dinero(x.cobrado) + '</td></tr>'; }).join('') +
                '</tbody></table></div></details></section>' +
            '<section class="atb-caja"><h3>Cobranza por cliente</h3><p>Primero los que más aportan al MRR de ' + esc(nomMes(_mes, true)) + '. El estado es el de su suscripción.</p>' +
                (clientes.length ? '<div class="atb-wrap"><table class="atb-tabla"><thead><tr><th>Cliente</th><th>Suscripción</th><th class="n">MRR del mes</th><th class="n">Cobrado</th><th class="n">Pendiente</th><th>Último pago</th><th></th></tr></thead><tbody>' +
                    clientes.map(function (x) {
                        var e = estadoNegocio(x.negocioId), nom = (x.negocioId && nombreNegocio(x.negocioId)) || x.cliente || '—';
                        return '<tr><td><b>' + esc(nom) + '</b><small>' + x.recibos + (x.recibos === 1 ? ' recibo' : ' recibos') + (x.negocioId ? '' : ' · sin negocio ligado') + '</small></td>' +
                            '<td>' + (e ? '<span class="atb-estado"><i style="background:' + esc(e.color) + '"></i>' + esc(e.label) + '</span>' : '<span class="atb-estado">—</span>') + '</td>' +
                            '<td class="n">' + dinero(x.mrr) + '</td><td class="n">' + dinero(x.cobrado) + '</td><td class="n">' + dinero(x.pendiente) + '</td>' +
                            '<td>' + esc(x.ultimoPago || '—') + '</td>' +
                            '<td>' + (x.negocioId && typeof window.abrirDetalleNegocio === 'function' ? '<button type="button" class="atb-btn" onclick="abrirDetalleNegocio(\'' + esc(x.negocioId).replace(/'/g, '') + '\')">Ver negocio</button>' : '') + '</td></tr>';
                    }).join('') + '</tbody></table></div>' : '<p class="atb-vacio">Todavía no hay recibos. Emite el primero desde «Presupuesto / recibo».</p>') +
            '</section>';
        engancharGrafica(serie);
        if (!_redibujo) { _redibujo = true; var t = 0; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(function () { if ($('atbGraf')) pintar(); }, 200); }); }
    }
    var _redibujo = false;

    /* SVG a mano (sin librerías: la CSP no deja otras). Una serie, un eje. */
    /* Se dibuja al ancho REAL de su caja: así las letras miden lo que dicen
       (un viewBox fijo estirado las agrandaba con la pantalla). */
    function grafica(serie, ancho0) {
        var W = Math.max(320, Math.round(ancho0 || 720)), H = 220, izq = 56, der = 10, arr = 18, aba = 26, w = W - izq - der, h = H - arr - aba;
        var max = Math.max.apply(null, serie.map(function (x) { return x.mrr; }).concat([0]));
        var tope = max > 0 ? Math.pow(10, Math.floor(Math.log10(max))) : 1000;
        tope = Math.ceil((max || 1000) / tope) * tope;
        var n = serie.length, paso = w / n, ancho = Math.max(6, Math.min(34, paso * 0.56)), out = '';
        for (var g = 0; g <= 4; g++) {
            var y = arr + h - h * g / 4;
            out += '<line class="rej" x1="' + izq + '" x2="' + (W - der) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>' +
                '<text class="eje" x="' + (izq - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + esc(corto(tope * g / 4)) + '</text>';
        }
        serie.forEach(function (x, i) {
            var bh = tope ? h * x.mrr / tope : 0, cx = izq + paso * i + paso / 2, bx = cx - ancho / 2, by = arr + h - bh, on = x.mes === _mes;
            var r = Math.min(4, bh, ancho / 2);
            /* Extremo redondeado arriba, recto en la base. */
            var d = bh <= 0 ? '' : 'M' + bx.toFixed(1) + ',' + (arr + h).toFixed(1) + 'V' + (by + r).toFixed(1) + 'Q' + bx.toFixed(1) + ',' + by.toFixed(1) + ' ' + (bx + r).toFixed(1) + ',' + by.toFixed(1) +
                'H' + (bx + ancho - r).toFixed(1) + 'Q' + (bx + ancho).toFixed(1) + ',' + by.toFixed(1) + ' ' + (bx + ancho).toFixed(1) + ',' + (by + r).toFixed(1) + 'V' + (arr + h).toFixed(1) + 'Z';
            out += '<rect class="zona" data-i="' + i + '" tabindex="0" role="img" aria-label="' + esc(nomMes(x.mes, true) + ': MRR ' + dinero(x.mrr)) + '" x="' + (izq + paso * i).toFixed(1) + '" y="' + arr + '" width="' + paso.toFixed(1) + '" height="' + h + '"/>' +
                (d ? '<path class="barra' + (on ? ' on' : '') + '" d="' + d + '"/>' : '') +
                '<text class="eje" x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(nomMes(x.mes)) + '</text>' +
                (on && x.mrr > 0 ? '<text class="val" x="' + cx.toFixed(1) + '" y="' + (by - 6).toFixed(1) + '" text-anchor="middle">' + esc(corto(x.mrr)) + '</text>' : '');
        });
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="MRR de los últimos 12 meses">' + out + '</svg>';
    }
    function engancharGrafica(serie) {
        var g = $('atbGraf'); if (!g) return;
        var tip = document.createElement('div'); tip.className = 'atb-tip'; tip.hidden = true; g.appendChild(tip);
        var ver = function (el) {
            var x = serie[+el.getAttribute('data-i')]; if (!x) return;
            tip.innerHTML = '<b>' + esc(nomMes(x.mes, true)) + '</b><div><span>MRR</span><span>' + dinero(x.mrr) + '</span></div>' +
                '<div><span>Emitido</span><span>' + dinero(x.emitido) + '</span></div><div><span>Cobrado</span><span>' + dinero(x.cobrado) + '</span></div>';
            var rg = g.getBoundingClientRect(), rb = el.getBoundingClientRect();
            tip.style.left = Math.max(80, Math.min(rg.width - 80, rb.left - rg.left + rb.width / 2)) + 'px';
            tip.style.top = Math.max(0, rb.top - rg.top + 8) + 'px';
            tip.hidden = false;
        };
        g.querySelectorAll('.zona').forEach(function (z) {
            z.addEventListener('mouseenter', function () { ver(z); });
            z.addEventListener('focus', function () { ver(z); });
            z.addEventListener('click', function () { ver(z); });
            z.addEventListener('mouseleave', function () { tip.hidden = true; });
            z.addEventListener('blur', function () { tip.hidden = true; });
        });
    }

    window.AdmTablero = {
        montar: montar,
        clasificar: function () { if (typeof window.switchTab === 'function') switchTab('documentos'); setTimeout(function () { if (window.AdminDocs && AdminDocs.grupo) AdminDocs.grupo('clasificar'); }, 60); }
    };
})();
