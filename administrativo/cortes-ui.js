/* Presentación de Cortes de caja. Los formularios, eventos y cálculos siguen
   en diario.html / EtaaxCore. Solo se decoran controles y rótulos conocidos;
   no se recorren ni se reescriben nombres, notas o conceptos del negocio. */
(function () {
    'use strict';
    var RAICES = '#dxOv_cortes, #modalCorte, #modalVerCorte';
    var prefijo = /^(?:\s|[🧾📋💳💵💰🏦🏛🍽📤📥🔁📸📷📱🎟🎯📍🔒🔓🔄💸🖨⬇➕✅✕✖✏✓★▶＋+−—]|\uFE0F)+/u;
    var pendiente = false;
    function cada(selector, fn) { document.querySelectorAll(selector).forEach(fn); }
    function icono(el, nombre) {
        if (!el || typeof window.etaaxIcono !== 'function') return;
        var actual = el.querySelector(':scope > .c-ui-icon');
        if (actual && actual.dataset.icono === nombre) return;
        var svg = window.etaaxIcono('cor-' + nombre, { tam: 20 });
        if (!svg) return;
        if (actual) actual.remove();
        el.querySelectorAll(':scope > .etx-emoji-slot').forEach(function (s) { s.remove(); });
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 3) n.textContent = n.textContent.replace(prefijo, '');
            else if (n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true' && !n.querySelector('svg') && /^[\s—−✕✖]+$/.test(n.textContent)) n.remove();
        });
        var s = document.createElement('span'); s.className = 'c-ui-icon';
        s.dataset.icono = nombre; s.setAttribute('aria-hidden', 'true'); s.innerHTML = svg;
        el.insertBefore(s, el.firstChild); el.dataset.etxEmoji = '1';
    }
    function poner(selector, nombre) { cada(selector, function (el) { icono(el, nombre); }); }
    function titulo(el, principal, libre) {
        if (!el || el.querySelector('.c-title-copy')) return;
        var texto = libre ? el.textContent : el.textContent.replace(prefijo, '').trim();
        el.textContent = '';
        var placa = document.createElement('span'); placa.className = 'c-title-plate';
        icono(placa, 'corte-caja'); el.appendChild(placa);
        var copia = document.createElement('span'); copia.className = 'c-title-copy';
        if (principal) copia.classList.add('c-title-daily');
        if (!libre && /corte/i.test(texto)) {
            var partes = texto.split(/(cortes?)/i);
            partes.forEach(function (parte) {
                var s = document.createElement('span'); s.textContent = parte;
                if (/^cortes?$/i.test(parte)) s.className = 'c-title-accent';
                copia.appendChild(s);
            });
        } else copia.textContent = texto;
        el.appendChild(copia); el.dataset.etxEmoji = '1';
    }
    function estadoBoton(id, on) {
        var b = document.getElementById(id); if (!b) return;
        b.classList.toggle('c-selected', !!on); b.setAttribute('aria-pressed', String(!!on));
    }
    function etiqueta(id, nombre) {
        var campo = document.getElementById(id), fg = campo && campo.closest('.fg');
        if (fg) icono(fg.querySelector('label'), nombre);
    }
    function pintar() {
        pendiente = false;
        if (typeof window.etaaxIcono !== 'function') return;
        titulo(document.querySelector('#dxOv_cortes .dx-win-title'), true, false);
        titulo(document.getElementById('modalTitulo'), false, false);
        titulo(document.getElementById('verCorteTitulo'), false, true);
        cada(RAICES, function (raiz) {
            raiz.querySelectorAll('.etx-min-btn').forEach(function (b) { icono(b, 'minimizar'); });
            raiz.querySelectorAll('.modal-close,.dx-win-close').forEach(function (b) { icono(b, 'cerrar'); });
        });
        var controles = {
            '#btnCapturarCorte': 'agregar', '#cortesEmpty .empty-state-icon': 'sin-cortes',
            '#dxOv_cortes [onclick^="dxImprimir"]': 'imprimir', '#dxOv_cortes [onclick^="dxCSV"]': 'exportar-csv',
            '#modalCorte [onclick="guardarCorte()"]': 'guardar', '#verCorteEditBtn': 'datos-corte',
            '#gastosGate > span': 'restringido', '#gastosGate button': 'desglose',
            '#gastosDesgloseBox [onclick="jalarGastosFecha()"]': 'comparativo',
            '#btnPropRetiro': 'pagar-propinas', '#btnCorteGasto': 'gastos-dia', '#btnCorteAnticipo': 'anticipo',
            '#modalCorte [onclick="agregarIngresoExtra()"]': 'agregar',
            '#modalCorte [onclick="_antElegir()"]': 'anticipo',
            '#row-corte-sucursal label': 'sucursal', '#cardMetaSem .sum-card-label':'comparativo'
        };
        Object.keys(controles).forEach(function (s) { poner(s, controles[s]); });
        var qr = document.getElementById('btnQrCorte');
        icono(qr, qr && qr.textContent.indexOf('Cerrar') >= 0 ? 'cerrar' : 'celular');
        var secciones = ['datos-corte', 'formas-pago', 'operativo', 'gastos-dia', 'resguardo', 'movimientos-caja', 'evidencia-visual'];
        cada('#modalCorte .corte-sec-title', function (el, i) {
            icono(el, secciones[i]);
            if (!el.dataset.paso) el.dataset.paso = ('0' + (i + 1)).slice(-2);
        });
        var pagos = { fEfectivo:'efectivo', fTarjeta:'tarjeta', fTarUnicaB:'tarjeta', fTransfer:'transferencia',
            netoAnticipos:'anticipo', fVentaOtros:'otros-pagos', fPropEfectivo:'propinas' };
        Object.keys(pagos).forEach(function (id) {
            var c = document.getElementById(id), fila = c && c.closest('tr');
            if (fila) icono(fila.querySelector('.pago-label'), pagos[id]);
        });
        var tablaPagos = document.querySelector('#modalCorte .pago-tbl');
        if (tablaPagos && tablaPagos.previousElementSibling) {
            tablaPagos.previousElementSibling.classList.add('c-payment-caption');
            icono(tablaPagos.previousElementSibling, 'desglose');
        }
        var campos = { fComensales:'comensales', ticketCalc:'cheque-promedio', fComedor:'comedor',
            fParaLlevar:'para-llevar', fAlimentos:'alimentos', fBebidas:'bebidas', fOtros:'otros-pagos', fNotas:'notas' };
        Object.keys(campos).forEach(function (id) { etiqueta(id, campos[id]); });
        cada('#modalCorte details summary', function (s, i) { icono(s, i === 0 ? 'canal-venta' : 'desglose'); });
        ['taModoS','taModoD','taModoBS','taModoBD'].forEach(function (id, i) {
            var modo = i < 2 ? window._taModoA : window._taModoB;
            estadoBoton(id, modo === (i % 2 ? 'desglose' : 'simple'));
        });
        estadoBoton('btnPropRetiro', window._propRetiro);
        var total = document.getElementById('totVenta');
        if (total) total.parentElement.parentElement.classList.add('c-totales');
        var mov = document.getElementById('iexConcepto');
        if (mov) mov.parentElement.classList.add('c-mov-form');
        var evidencia = document.getElementById('fEvidenciaInput');
        if (evidencia) {
            var zona = evidencia.parentElement; zona.classList.add('c-upload');
            icono(zona.querySelector('div'), 'subir-evidencia');
            if (!zona.hasAttribute('tabindex')) {
                zona.tabIndex = 0; zona.setAttribute('role', 'button');
                zona.setAttribute('aria-label', 'Adjuntar foto o PDF del corte');
                zona.addEventListener('keydown', function (e) {
                    if (e.target === zona && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); zona.click(); }
                });
            }
        }
        // Estas opciones tienen values explícitos: se limpia solo el rótulo.
        cada('#iexOrigen option', function (o) {
            var limpio = o.textContent.replace(/^[\s💵🏦🏛→\uFE0F]+/u, '');
            if (limpio !== o.textContent) o.textContent = limpio;
        });
        var metodos = ['efectivo','tarjeta','transferencia','efectivo','resguardo','transferencia','tarjeta'];
        cada('#dxMetodos .dxm-row .n', function (el, i) { icono(el, metodos[i]); });
        cada('#dxMetodos .dxm-lbl', function (el, i) { icono(el, i === 0 ? 'formas-pago' : 'gastos-dia'); });
        cada('#ingresosExtraList .ingreso-row', function (fila) {
            var marca = fila.firstElementChild, txt = marca && marca.textContent;
            if (txt && !marca.querySelector('svg')) icono(marca, txt.indexOf('📤') >= 0 ? 'salida-efectivo' : txt.indexOf('🏛') >= 0 || txt.indexOf('📥') >= 0 ? 'transferencia' : 'entrada-efectivo');
            var quitar = fila.querySelector('button');
            if (quitar) { icono(quitar, 'cerrar'); quitar.setAttribute('aria-label', 'Quitar movimiento de este corte'); }
        });
        // Encabezados creados por verCorte(). No se toca el contenido libre de
        // las filas (cajero, nombre del corte, notas, conceptos o proveedores).
        var cabeceras = { 'Formas de pago':'formas-pago', 'Desglose operativo':'operativo',
            'Gastos del día':'gastos-dia', 'Efectivo para resguardo':'resguardo',
            'Movimientos de caja':'movimientos-caja', 'Evidencia visual':'evidencia-visual' };
        cada('#verCorteBody > div > div:first-child', function (el) {
            if (el.querySelector('.c-ui-icon')) return;
            var rotulo = el.textContent.replace(prefijo, '').trim();
            if (cabeceras[rotulo]) { el.classList.add('c-detail-title'); icono(el, cabeceras[rotulo]); }
        });
        var rotulosPago = { 'Ventas':'efectivo', 'Propinas':'propinas', 'Transfer.':'transferencia',
            'Caja chica':'efectivo', 'Caja fuerte':'resguardo', 'Banco':'transferencia' };
        cada('#verCorteBody > div > table td:first-child', function (el) {
            var rotulo = el.textContent.replace(prefijo, '').trim();
            if (rotulosPago[rotulo]) icono(el, rotulosPago[rotulo]);
        });
        // Solo el texto inicial de los resúmenes de método, antes de los
        // importes: los valores siguen en sus elementos originales.
        cada('#verCorteBody > div > table + div', function (resumen) {
            Array.from(resumen.childNodes).forEach(function (n) {
                if (n.nodeType === 3 && /^Tarjeta →🏦 /.test(n.textContent)) {
                    n.textContent = n.textContent.replace('🏦 ', '');
                    var s = document.createElement('span'); icono(s, 'transferencia');
                    n.after(s);
                } else if (n.nodeType === 1 && n.tagName === 'SPAN') {
                    var texto = n.firstChild && n.firstChild.nodeType === 3 ? n.firstChild.textContent : '';
                    if (/^💵 Caja chica:/.test(texto)) icono(n, 'efectivo');
                    else if (/^🏦 Caja fuerte:/.test(texto)) icono(n, 'resguardo');
                    else if (/^🏛️ Banco:/.test(texto)) icono(n, 'transferencia');
                }
            });
        });
    }
    function iniciar() {
        pintar();
        new MutationObserver(function (cambios) {
            if (pendiente) return;
            if (cambios.some(function (m) {
                var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                return el && el.closest(RAICES);
            })) { pendiente = true; window.requestAnimationFrame(pintar); }
        }).observe(document.body, { childList:true, subtree:true, characterData:true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
