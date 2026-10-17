/* Depósitos, retiros y previsiones: presentación sobre los controles originales.
   No sustituye eventos, cálculos, consultas, valores ni guardados. */
(function () {
    'use strict';
    var RAICES = '#dxOv_depositos,#modalDeposito,#depOverlay';
    var pendiente = false;
    var prefijo = /^(?:\s|[💸💵🏦🏛💳📤📥➕🔮📋📅🎯👤✅🖨⬇✕✖✏🗑＋+−—]|\uFE0F)+/u;
    function cada(s, fn) { document.querySelectorAll(s).forEach(fn); }
    function icono(el, nombre) {
        if (!el || typeof window.etaaxIcono !== 'function') return;
        var actual = el.querySelector(':scope > .m-ui-icon');
        if (actual && actual.dataset.icono === nombre) return;
        if (actual) actual.remove();
        el.querySelectorAll(':scope > .etx-emoji-slot').forEach(function (n) { n.remove(); });
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 3) n.textContent = n.textContent.replace(prefijo, '');
            else if (n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true' && !n.querySelector('svg') && /^[\s—−✕✖]+$/.test(n.textContent)) n.remove();
        });
        var s = document.createElement('span'); s.className = 'm-ui-icon'; s.dataset.icono = nombre;
        s.setAttribute('aria-hidden', 'true'); s.innerHTML = window.etaaxIcono('mov-' + nombre, {tam:20});
        el.insertBefore(s, el.firstChild); el.dataset.etxEmoji = '1';
    }
    function titulo(el, principal, nombre) {
        if (!el || el.querySelector('.m-title-copy')) return;
        var texto = el.textContent.replace(prefijo, '').trim();
        el.textContent = '';
        var placa = document.createElement('span'); placa.className = 'm-title-plate';
        icono(placa, nombre); el.appendChild(placa);
        var copia = document.createElement('span'); copia.className = 'm-title-copy';
        if (principal) copia.classList.add('m-title-daily');
        texto.split(/(retiros?|previsión)/i).forEach(function (p) {
            var s = document.createElement('span'); s.textContent = /^(retiros?|previsión)$/i.test(p) ? p.toLowerCase() : p;
            if (/^(retiros?|previsión)$/i.test(p)) s.className = 'm-title-accent'; copia.appendChild(s);
        });
        el.appendChild(copia); el.dataset.etxEmoji = '1';
    }
    function fondo(valor) {
        if (!valor) return 'origen';
        return valor.indexOf('prev:') === 0 ? 'prevision' : valor.indexOf('banco:') === 0 ? 'banco'
            : valor.indexOf('tc:') === 0 ? 'tarjeta' : valor === 'retiro' ? 'retirar'
            : valor === 'caja_fuerte' ? 'caja-fuerte' : 'depositar';
    }
    function campo(id, nombre) {
        var el = document.getElementById(id), fg = el && el.closest('.fg');
        if (fg) icono(fg.querySelector('label'), nombre);
    }
    /* Solo marcadores de la ruta creada por _depMovTxt: el texto de cuentas,
       conceptos y personas se conserva. No se recorre texto libre del negocio. */
    function ruta(el) {
        if (!el || el.dataset.mRuta) return;
        el.querySelectorAll('.etx-emoji-slot').forEach(function (n) { n.remove(); });
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType !== 3) return;
            var texto = n.textContent, re = /^(🔮 Apartado en )(🏦 |🏛️? )|(^| → )(?:➕ )?(🏦 |🏛️? |💳 |📤 )|^(🔮 )/gu, m, cursor = 0;
            var frag = document.createDocumentFragment(), cambio = false;
            while ((m = re.exec(texto))) {
                cambio = true; frag.appendChild(document.createTextNode(texto.slice(cursor, m.index)));
                if (m[1]) {
                    var reserva = document.createElement('span'); icono(reserva, 'prevision'); frag.appendChild(reserva);
                    frag.appendChild(document.createTextNode(m[1].replace(/^🔮 /u, '')));
                } else frag.appendChild(document.createTextNode(m[3] || ''));
                var span = document.createElement('span'), marca = m[2] || m[4] || m[5];
                icono(span, marca.indexOf('🏦') >= 0 ? 'caja-fuerte' : marca.indexOf('🏛') >= 0 ? 'banco' : marca.indexOf('💳') >= 0 ? 'tarjeta' : marca.indexOf('📤') >= 0 ? 'retirar' : 'prevision');
                frag.appendChild(span); cursor = re.lastIndex;
            }
            if (cambio) { frag.appendChild(document.createTextNode(texto.slice(cursor))); n.replaceWith(frag); }
        });
        el.dataset.mRuta = '1'; el.dataset.etxEmoji = '1';
    }
    function pintar() {
        pendiente = false;
        if (typeof window.etaaxIcono !== 'function') return;
        titulo(document.querySelector('#dxOv_depositos .dx-win-title'), true, 'movimientos');
        var destino = document.getElementById('depDestino2');
        titulo(document.getElementById('depModalTitulo'), false, destino ? fondo(destino.value) : 'movimientos');
        titulo(document.querySelector('#depOverlay .cj-title'), false, 'vista-completa');
        cada(RAICES, function (raiz) {
            raiz.querySelectorAll('.etx-min-btn').forEach(function (b) { icono(b, 'minimizar'); });
            raiz.querySelectorAll('.dx-win-close,.modal-close').forEach(function (b) { icono(b, 'cerrar'); });
        });
        var controles = {
            '#btnDepositar':'depositar', '#btnRetirar':'retirar', '#btnApartarPrev':'prevision', '#btnVerDepositos':'vista-completa',
            '#btnNuevoDepCard':'agregar', '#dxOv_depositos [onclick^="dxImprimir"]':'imprimir', '#dxOv_depositos [onclick^="dxCSV"]':'exportar-csv',
            '#dxOv_depositos [onclick^="depVista(\'dep\'"]':'depositar', '#dxOv_depositos [onclick^="depVista(\'ret\'"]':'retirar',
            '#dxOv_depositos [onclick^="depVista(\'prev\'"]':'prevision', '#depEmpty .empty-state-icon':'movimientos',
            '#modalDeposito [onclick="guardarDeposito()"]':'guardar', '#modalDeposito .corte-sec-title':'datos-movimiento',
            '#depOverlay [onclick^="cerrarVerDepositos();abrirModalDeposito()"]':'agregar',
            '#depTbody [onclick^="abrirModalDeposito"]':'editar', '#depTbody [onclick^="eliminarDeposito"]':'eliminar',
            '#depOverlayBody [onclick^="cerrarVerDepositos();abrirModalDeposito"]':'editar', '#depOverlayBody [onclick^="_elimDepOv"]':'eliminar'
        };
        Object.keys(controles).forEach(function (s) { cada(s, function (el) { icono(el, controles[s]); }); });
        var boton = document.getElementById('btnDepositar'); if (boton) boton.parentElement.classList.add('m-toolbar');
        var campos = {depFecha:'periodo',depMonto:'datos-movimiento',depCategoria:'categoria',depConcepto:'datos-movimiento',depFinalidad:'finalidad',depAutoriza:'autoriza',depDeposita:'persona',depNotas:'notas'};
        Object.keys(campos).forEach(function (id) { campo(id, campos[id]); });
        var origen = document.getElementById('depOrigen');
        if (origen) campo('depOrigen', fondo(origen.value));
        if (destino) campo('depDestino2', fondo(destino.value));
        var hint = document.getElementById('depMovHint');
        if (hint) icono(hint, destino && destino.value.indexOf('prev:') === 0 ? 'prevision' : destino && destino.value === 'retiro' ? 'retirar' : 'movimientos');
        cada('#depOrigen option,#depDestino2 option', function (o) {
            var texto = o.textContent.replace(/^(?:➕ |🏦 |🏛️? |💳 |📤 |🔮 )/u, ''); if (texto !== o.textContent) o.textContent = texto;
        });
        var nueva = document.querySelector('#depCategoria option[value="__nueva"]');
        if (nueva && nueva.textContent.indexOf('➕') === 0) nueva.textContent = nueva.textContent.replace(/^➕\s*/, '');
        var cardTitle = document.getElementById('depCardTitulo');
        if (cardTitle) icono(cardTitle, window._depVista === 'ret' ? 'retirar' : window._depVista === 'prev' ? 'prevision' : 'movimientos');
        cada('#depTbody td:nth-child(2) > span', ruta);
        cada('#depFooter > span', function (el, i) { if (i < 2) icono(el, i === 0 ? 'caja-fuerte' : 'banco'); });
        var body = document.getElementById('depOverlayBody');
        if (body && body.children.length === 2) {
            var kpis = body.children[0], cards = body.children[1]; kpis.classList.add('m-kpis'); cards.classList.add('m-cards');
            Array.from(kpis.children).forEach(function (el, i) { icono(el.firstElementChild, ['caja-fuerte','banco','tarjeta'][i]); });
            Array.from(cards.children).forEach(function (card) {
                if (!card.querySelector('button')) return;
                card.classList.add('m-record');
                var cabecera = card.firstElementChild, izq = cabecera && cabecera.firstElementChild;
                if (izq) {
                    card.classList.toggle('m-withdrawal', /→\s*(?:📤\s*)?Retiro(?:\s|$)/u.test(izq.firstElementChild.textContent));
                    ruta(izq.firstElementChild); icono(izq.lastElementChild, 'periodo');
                }
                // Las tres etiquetas de metadatos se reconocen por su prefijo
                // fijo, sin tocar el contenido del concepto u otras notas.
                card.querySelectorAll(':scope > div > span').forEach(function (el) {
                    if (/^🎯 /.test(el.textContent)) icono(el, 'finalidad');
                    else if (/^👤 /.test(el.textContent)) icono(el, 'persona');
                    else if (/^✅ /.test(el.textContent)) icono(el, 'autoriza');
                });
            });
        }
        cada('#depTbody button:has(.m-ui-icon),#depOverlayBody button:has(.m-ui-icon)', function (b) {
            if (!b.textContent.trim() && !b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.classList.contains('del') ? 'Eliminar movimiento' : 'Editar movimiento');
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
        }).observe(document.body, {childList:true,subtree:true,characterData:true});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
