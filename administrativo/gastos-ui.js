/* Gastos diarios: presentación únicamente. No reemplaza controles, eventos,
   valores, filtros ni cálculos de diario.html. Los renderizados existentes
   pueden recrear su texto; se repone solo el SVG decorativo cuando ocurre. */
(function () {
    'use strict';
    var RAICES = '#dxOv_gastos, #modalGasto, #modalLimiteGasto, #modalVerGasto';
    var prefijo = /^(?:[\s]+|[📤📋💳🏦💼🏛🧾📎📁📱✅🔴🟢⏳📅🔮📍🎚🖨⬇✕✖✔✗✏＋+−—]|\uFE0F)+/u;
    var pendiente = false;

    function cada(selector, fn) { document.querySelectorAll(selector).forEach(fn); }
    function icono(el, nombre) {
        if (!el || typeof window.etaaxIcono !== 'function') return;
        var actual = el.querySelector(':scope > .g-ui-icon');
        if (actual && actual.dataset.icono === nombre) return;
        var svg = window.etaaxIcono('adm-' + nombre, { tam: 20 });
        if (!svg) return;
        if (actual) actual.remove();
        /* La capa compartida puede haber decorado este botón antes. Se quita
           solo su dibujo, nunca sus listeners ni las etiquetas del control. */
        el.querySelectorAll(':scope > .etx-emoji-slot').forEach(function (n) { n.remove(); });
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 3) n.textContent = n.textContent.replace(prefijo, '');
            else if (n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true' && !n.querySelector('svg') && /^[\s—−✕✖]+$/.test(n.textContent)) n.remove();
        });
        var s = document.createElement('span');
        s.className = 'g-ui-icon'; s.dataset.icono = nombre;
        s.setAttribute('aria-hidden', 'true'); s.innerHTML = svg;
        el.insertBefore(s, el.firstChild);
        el.dataset.etxEmoji = '1';
    }
    function poner(selector, nombre) { cada(selector, function (el) { icono(el, nombre); }); }
    function iconosEnTexto(el) {
        if (!el) return;
        var mapa = { '⏳': 'pendiente', '📅': 'programado', '🔮': 'prevision' };
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 1 && !n.classList.contains('g-ui-icon')) iconosEnTexto(n);
            if (n.nodeType !== 3 || !/[⏳📅🔮]/u.test(n.textContent)) return;
            var fragmento = document.createDocumentFragment();
            n.textContent.split(/(⏳|📅|🔮)/u).forEach(function (parte) {
                if (!mapa[parte]) { fragmento.appendChild(document.createTextNode(parte)); return; }
                var s = document.createElement('span'); icono(s, mapa[parte]); fragmento.appendChild(s);
            });
            n.replaceWith(fragmento);
        });
    }
    function titulo(el, principal) {
        if (!el || el.querySelector('.g-title-copy')) return;
        var texto = el.textContent.replace(prefijo, '').trim();
        // Solo rótulos fijos, nunca conceptos ni nombres capturados por el usuario.
        if (!/^(Gastos Diarios|Gastos diarios|Nuevo gasto|Editar gasto)$/.test(texto)) return;
        var partes = texto.split(' ');
        el.textContent = '';
        var placa = document.createElement('span'); placa.className = 'g-title-plate';
        icono(placa, 'gastos-diarios'); el.appendChild(placa);
        var copia = document.createElement('span'); copia.className = 'g-title-copy';
        if (principal) copia.classList.add('g-title-daily');
        copia.appendChild(document.createTextNode(partes[0] + ' '));
        var acento = document.createElement('span'); acento.className = 'g-title-accent';
        acento.textContent = partes[1].toLowerCase(); copia.appendChild(acento); el.appendChild(copia);
        el.dataset.etxEmoji = '1';
    }
    function pintar() {
        pendiente = false;
        if (typeof window.etaaxIcono !== 'function') return;
        titulo(document.querySelector('#dxOv_gastos .dx-win-title'), true);
        titulo(document.getElementById('gModalTitulo'), false);
        cada(RAICES, function (raiz) {
            raiz.querySelectorAll('.etx-min-btn').forEach(function (el) { icono(el, 'minimizar'); });
            raiz.querySelectorAll('.modal-close, .dx-win-close').forEach(function (el) { icono(el, 'cerrar'); });
        });
        var controles = {
            '#btnNuevoGasto': 'agregar', '#btnLimiteGasto': 'limite',
            '#dxOv_gastos [onclick^="dxImprimir"]': 'imprimir',
            '#dxOv_gastos [onclick^="dxCSV"]': 'exportar-csv',
            '#emptyMenores .empty-state-icon': 'sin-registros',
            '#btnMenor': 'pagado', '#btnMayor': 'gasto-mayor',
            '#mCajaFuerte': 'caja-fuerte', '#mCajaChica': 'caja-chica', '#mBanco': 'banco',
            '#bancoOpts .metodo-btn': 'banco', '#gCuentaBancoWrap label': 'banco',
            '#gPrevWrap label': 'prevision', '#row-gasto-sucursal label': 'sucursal',
            '#modalGasto [onclick="abrirPanelProveedores()"]': 'proveedor',
            '#sBtn_pagado': 'pagado', '#sBtn_pendiente': 'pendiente', '#sBtn_programado': 'programado',
            '#btnGuardar': 'guardar', '#modalLimiteGasto h2': 'limite',
            '#modalLimiteGasto [onclick="_guardarLimiteGasto()"]': 'guardar',
            '#modalVerGasto [onclick="cerrarVerGasto()"]': 'cerrar', '#vgEditBtn': 'datos-gasto'
        };
        Object.keys(controles).forEach(function (s) { poner(s, controles[s]); });
        var qr = document.getElementById('btnQrGasto');
        icono(qr, qr && qr.textContent.indexOf('Cerrar') >= 0 ? 'cerrar' : 'celular');
        var nuevo = document.getElementById('btnNuevoGasto');
        if (nuevo) nuevo.parentElement.classList.add('g-toolbar');
        var secciones = ['categoria', 'datos-gasto', 'banco', 'comprobante', 'adjunto'];
        cada('#modalGasto .gs-sec-title', function (el, i) {
            icono(el, secciones[i] || 'notas');
            if (!el.dataset.paso) el.dataset.paso = ('0' + (i + 1)).slice(-2);
        });
        var evidencia = document.getElementById('gEvidencia');
        if (evidencia) {
            var zona = evidencia.parentElement;
            zona.classList.add('g-upload');
            icono(zona.querySelector('div'), 'subir-archivo');
            // Conserva el mismo click del cargador y lo hace accesible con teclado.
            if (!zona.hasAttribute('tabindex')) {
                zona.tabIndex = 0; zona.setAttribute('role', 'button');
                zona.setAttribute('aria-label', 'Adjuntar foto o PDF del gasto');
                zona.addEventListener('keydown', function (e) {
                    if (e.target === zona && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); zona.click(); }
                });
            }
        }
        /* Los select nativos no admiten SVG dentro de option. Se conserva el
           texto, value y orden; el icono se usa en sus controles equivalentes. */
        cada('#filtroMetodo option, #filtroEstatus option', function (el) {
            var limpio = el.textContent.replace(prefijo, '');
            if (limpio !== el.textContent) el.textContent = limpio;
        });
        poner('#dxOv_gastos .met-caja', 'caja-fuerte');
        poner('#dxOv_gastos .met-chica', 'caja-chica');
        poner('#dxOv_gastos .met-banco', 'banco');
        iconosEnTexto(document.getElementById('gSumPorPagarDet'));
        iconosEnTexto(document.getElementById('gPrevHint'));
        var tipo = document.getElementById('vgTipo');
        if (tipo) {
            var mayor = tipo.textContent.indexOf('mayor') >= 0;
            tipo.classList.toggle('g-type-major', mayor);
            tipo.classList.toggle('g-type-minor', !mayor);
            icono(tipo, mayor ? 'gasto-mayor' : 'pagado');
        }
        // Solo las filas fijas de método y estado; no se recorren concepto,
        // proveedor, notas ni otro texto libre de la ficha.
        var metodo = document.querySelector('#vgBody > div:nth-child(3) > span:last-child');
        if (metodo) icono(metodo, metodo.textContent.indexOf('Caja fuerte') >= 0 ? 'caja-fuerte' : metodo.textContent.indexOf('Caja chica') >= 0 ? 'caja-chica' : 'banco');
        var estadoFicha = document.querySelector('#vgBody > div:nth-child(5) > span:last-child > span:first-child');
        if (estadoFicha) {
            var nombreEstado = estadoFicha.textContent.replace(prefijo, '').trim().toLowerCase();
            if (['pagado', 'pendiente', 'programado'].indexOf(nombreEstado) >= 0) {
                estadoFicha.classList.add('g-status', 'g-status-' + nombreEstado); icono(estadoFicha, nombreEstado);
            }
        }
        cada('#tbodyMenores tr', function (fila) {
            var estado = fila.cells[6] && fila.cells[6].firstElementChild;
            if (!estado) return;
            var txt = estado.textContent.trim().toLowerCase();
            if (['pagado', 'pendiente', 'programado'].indexOf(txt) < 0) return;
            estado.classList.add('g-status', 'g-status-' + txt); icono(estado, txt);
        });
    }
    function programar() {
        if (!pendiente) { pendiente = true; window.requestAnimationFrame(pintar); }
    }
    function iniciar() {
        pintar();
        new MutationObserver(function (cambios) {
            if (cambios.some(function (m) {
                var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                if (el && el.closest(RAICES)) return true;
                return Array.from(m.addedNodes).some(function (n) { return n.nodeType === 1 && n.matches(RAICES); });
            })) programar();
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();
