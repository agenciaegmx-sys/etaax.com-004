/* Presentación de Gastos fijos. Conserva los nodos y handlers del listado,
   la autorización y el formulario original de gasto. */
(function () {
    'use strict';
    var RAICES = '#dxOv_fijos,#modalSelPago';
    var pendiente = false;
    var prefijo = /^(?:\s|[🏢🏦🏛💼🖨⬇✕✖＋+−—✓⏳📅⚠🔴]|\uFE0F)+/u;
    function cada(s, fn) { document.querySelectorAll(s).forEach(fn); }
    function icono(el, nombre) {
        if (!el || typeof window.etaaxIcono !== 'function') return;
        var actual = el.querySelector(':scope > .f-ui-icon');
        if (actual && actual.dataset.icono === nombre) return;
        if (actual) actual.remove();
        el.querySelectorAll(':scope > .etx-emoji-slot,:scope > .n-ui-icon').forEach(function (n) { n.remove(); });
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 3) n.textContent = n.textContent.replace(prefijo, '');
            else if (n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true' && !n.querySelector('svg') && /^[\s—−✕✖]+$/.test(n.textContent)) n.remove();
        });
        var s = document.createElement('span'); s.className = 'f-ui-icon';
        s.dataset.icono = nombre; s.setAttribute('aria-hidden', 'true');
        s.innerHTML = window.etaaxIcono('fij-' + nombre, {tam:20});
        el.insertBefore(s, el.firstChild); el.dataset.etxEmoji = '1';
    }
    function titulo(el, principal) {
        if (!el || el.querySelector('.f-title-copy')) return;
        var texto = el.textContent.replace(prefijo, '').trim();
        el.textContent = '';
        var placa = document.createElement('span'); placa.className = 'f-title-plate';
        icono(placa, 'gasto-fijo'); el.appendChild(placa);
        var copia = document.createElement('span'); copia.className = 'f-title-copy';
        if (principal) copia.classList.add('f-title-daily');
        var partes = texto.split(/(fijos?)/i);
        partes.forEach(function (p) {
            var s = document.createElement('span'); s.textContent = /^fijos?$/i.test(p) ? p.toLowerCase() : p;
            if (/^fijos?$/i.test(p)) s.className = 'f-title-accent'; copia.appendChild(s);
        });
        el.appendChild(copia); el.dataset.etxEmoji = '1';
    }
    function estado(el) {
        if (!el) return;
        var txt = el.textContent.replace(prefijo, '').trim().toLowerCase();
        var nombre = /^pagado/.test(txt) ? 'pagado' : /^programado/.test(txt) ? 'programado'
            : /^vencido|^vence/.test(txt) ? 'alerta' : /^pendiente|^por pagar/.test(txt) ? 'pendiente' : '';
        if (nombre) { el.classList.add('f-status'); icono(el, nombre); }
    }
    function pintar() {
        pendiente = false;
        if (typeof window.etaaxIcono !== 'function') return;
        titulo(document.querySelector('#dxOv_fijos .dx-win-title'), true);
        var selector = document.getElementById('modalSelPago'), title = document.getElementById('selPagoTitle');
        var fijo = !!(title && /Pagar gasto fijo/.test(title.textContent));
        if (selector) {
            selector.classList.toggle('f-selector', fijo);
            if (!fijo) selector.querySelectorAll('.f-ui-icon').forEach(function (n) { n.remove(); });
        }
        if (fijo) titulo(title, false);
        cada('#dxOv_fijos,#modalSelPago.f-selector', function (raiz) {
            raiz.querySelectorAll('.etx-min-btn').forEach(function (b) { icono(b, 'minimizar'); });
            raiz.querySelectorAll('.dx-win-close,.modal-close').forEach(function (b) { icono(b, 'cerrar'); });
        });
        var controles = { '#btnPagarFijo':'gasto-fijo', '#dxOv_fijos [onclick^="dxImprimir"]':'imprimir',
            '#dxOv_fijos [onclick^="dxCSV"]':'exportar-csv', '#dxOv_fijos .card-header h2':'recibo',
            '#emptyFijosPag .empty-state-icon':'sin-pagos', '#dxOv_fijos .met-caja':'caja-fuerte',
            '#dxOv_fijos .met-banco':'banco', '#dxOv_fijos .met-chica':'caja-chica' };
        Object.keys(controles).forEach(function (s) { cada(s, function (el) { icono(el, controles[s]); }); });
        var boton = document.getElementById('btnPagarFijo'); if (boton) boton.parentElement.classList.add('f-toolbar');
        cada('#tbodyFijosPag tr', function (fila) { estado(fila.cells[3] && fila.cells[3].firstElementChild); });
        cada('#modalSelPago.f-selector #selPagoBody > [onclick] > div:first-child > div:last-child > span', estado);
    }
    function iniciar() {
        pintar();
        new MutationObserver(function (cambios) {
            if (pendiente) return;
            if (cambios.some(function (m) {
                var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                return el && (el.closest(RAICES) || Array.from(m.addedNodes).some(function (n) { return n.nodeType === 1 && n.matches(RAICES); }));
            })) { pendiente = true; window.requestAnimationFrame(pintar); }
        }).observe(document.body, {childList:true,subtree:true,characterData:true});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
