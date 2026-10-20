/* Presentación de nóminas: conserva nodos, handlers, valores y cálculos.
   Solo decora rótulos conocidos; nombres y conceptos del negocio son texto. */
(function () {
    'use strict';
    var RAICES = '#dxOv_nominas,#modalPagoNom,#modalSelPago';
    var pendiente = false;
    var prefijo = /^(?:\s|[💰🖨⬇✕✖＋+−—☀💡🧾💵💼🏦🏛🗑🗓✏]|\uFE0F)+/u;
    function cada(s, fn) { document.querySelectorAll(s).forEach(fn); }
    function icono(el, nombre) {
        if (!el || typeof window.etaaxIcono !== 'function') return;
        var actual = el.querySelector(':scope > .n-ui-icon');
        if (actual && actual.dataset.icono === nombre) return;
        if (actual) actual.remove();
        el.querySelectorAll(':scope > .etx-emoji-slot').forEach(function (s) { s.remove(); });
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 3) {
                n.textContent = n.textContent.replace(prefijo, '');
                if (nombre === 'continuar') n.textContent = n.textContent.replace(/\s*→\s*$/, '');
            }
            else if (n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true' && !n.querySelector('svg') && /^[\s—−✕✖]+$/.test(n.textContent)) n.remove();
        });
        var s = document.createElement('span'); s.className = 'n-ui-icon';
        s.dataset.icono = nombre; s.setAttribute('aria-hidden', 'true');
        s.innerHTML = window.etaaxIcono('nom-' + nombre, { tam:20 });
        el.insertBefore(s, el.firstChild); el.dataset.etxEmoji = '1';
    }
    function titulo(el, principal) {
        if (!el || el.querySelector('.n-title-copy')) return;
        var texto = el.textContent.replace(/^\s*💰\s*/u, '').trimStart();
        el.textContent = '';
        var placa = document.createElement('span'); placa.className = 'n-title-plate';
        icono(placa, 'pagar-nomina'); el.appendChild(placa);
        var copia = document.createElement('span'); copia.className = 'n-title-copy';
        if (principal) copia.classList.add('n-title-daily');
        // El nombre del colaborador se conserva literalmente después del título.
        var fijo = texto.match(/^Pagar [Nn]óminas?/);
        if (fijo) {
            copia.appendChild(document.createTextNode('Pagar '));
            var acento = document.createElement('span'); acento.className = 'n-title-accent';
            acento.textContent = fijo[0].slice(6).toLowerCase(); copia.appendChild(acento);
            copia.appendChild(document.createTextNode(texto.slice(fijo[0].length)));
        } else copia.textContent = texto;
        el.appendChild(copia); el.dataset.etxEmoji = '1';
    }
    function pintar() {
        pendiente = false;
        if (typeof window.etaaxIcono !== 'function') return;
        titulo(document.querySelector('#dxOv_nominas .dx-win-title'), true);
        titulo(document.getElementById('pagoNomTitle'), false);
        var selector = document.getElementById('modalSelPago');
        var title = document.getElementById('selPagoTitle');
        var nomina = !!(title && /Pagar nómina/.test(title.textContent));
        if (selector) selector.classList.toggle('n-selector', nomina);
        if (nomina) titulo(title, false);
        cada('#dxOv_nominas,#modalPagoNom,#modalSelPago.n-selector', function (raiz) {
            raiz.querySelectorAll('.etx-min-btn').forEach(function (b) { icono(b, 'minimizar'); });
            raiz.querySelectorAll('.modal-close,.dx-win-close').forEach(function (b) { icono(b, 'cerrar'); });
        });
        var controles = {
            '#btnPagarNomina':'pagar-nomina', '#dxOv_nominas [onclick^="dxImprimir"]':'imprimir',
            '#dxOv_nominas [onclick^="dxCSV"]':'exportar-csv', '#emptyNomPagos .empty-state-icon':'sin-pagos',
            '#dxOv_nominas .card-header h2':'recibo', '#pnCptCalcBtn':'calcular',
            '#modalPagoNom [onclick="_pnCptAgregar()"]':'agregar',
            '#modalPagoNom [onclick="imprimirReciboNomina()"]':'recibo',
            '#modalPagoNom [onclick="_confirmarPagoNom()"]':'continuar',
            '#pnPrimaDom label > span':'prima-dominical', '#pnTotalHint':'conceptos',
            '#dxOv_nominas .met-caja':'caja-fuerte', '#dxOv_nominas .met-chica':'caja-chica',
            '#dxOv_nominas .met-banco':'banco'
        };
        Object.keys(controles).forEach(function (s) { cada(s, function (el) { icono(el, controles[s]); }); });
        var boton = document.getElementById('btnPagarNomina');
        if (boton) boton.parentElement.classList.add('n-toolbar');
        cada('#modalPagoNom .gs-sec-title', function (el, i) {
            icono(el, ['periodo','sueldo','descuento','conceptos'][i]); el.dataset.paso = ('0' + (i + 1)).slice(-2);
        });
        var total = document.getElementById('pnTotal');
        if (total) total.parentElement.parentElement.classList.add('n-total');
        var tipo = document.getElementById('pnCptTipo');
        var conceptos = { bono:['Bono','bono'], sancion:['Sanción / descuento','descuento'],
            horas:['Horas extras','horas-extras'], festivo:['Día festivo','festivo'],
            doble:['Día doble','dia-doble'], prima:['Prima dominical','prima-dominical'], otro:['Otro','conceptos'] };
        if (tipo) {
            Array.from(tipo.options).forEach(function (o) {
                if (conceptos[o.value] && o.textContent !== conceptos[o.value][0]) o.textContent = conceptos[o.value][0];
            });
            icono(tipo.parentElement.querySelector('label'), (conceptos[tipo.value] || conceptos.otro)[1]);
        }
        cada('#pnCptMetodo option', function (o) {
            var limpio = o.textContent.replace(prefijo, ''); if (limpio !== o.textContent) o.textContent = limpio;
        });
        cada('#pnCptList [onclick^="_pnCptEliminar"]', function (b) { icono(b, 'cerrar'); });
        var asistencia = document.getElementById('pnAsisBox');
        if (asistencia && /Desde Horarios:/.test(asistencia.textContent)) icono(asistencia, 'asistencia');
        cada('#pnCptList > div > span:first-child > span:first-child > span', function (badge) {
            var texto = badge.textContent;
            if (/Efectivo/.test(texto)) icono(badge, 'caja-chica');
            else if (/Caja fuerte/.test(texto)) icono(badge, 'caja-fuerte');
            else if (/Transferencia/.test(texto)) icono(badge, 'banco');
        });
        cada('#tbodyNomPagos tr', function (fila) {
            var estado = fila.cells[3] && fila.cells[3].firstElementChild;
            if (!estado) return;
            var texto = estado.textContent.trim().toLowerCase();
            if (['pagado','pendiente','programado'].indexOf(texto) < 0) return;
            estado.classList.add('n-status', 'n-status-' + texto); icono(estado, texto);
        });
    }
    function agendar() { if (!pendiente) { pendiente = true; window.requestAnimationFrame(pintar); } }
    function iniciar() {
        pintar();
        document.addEventListener('change', function (e) { if (e.target.closest(RAICES)) agendar(); });
        new MutationObserver(function (cambios) {
            if (cambios.some(function (m) {
                var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                return el && (el.closest(RAICES) || Array.from(m.addedNodes).some(function (n) { return n.nodeType === 1 && n.matches(RAICES); }));
            })) agendar();
        }).observe(document.body, {childList:true, subtree:true, characterData:true});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
