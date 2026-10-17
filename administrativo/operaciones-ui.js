/* Presentación de Caja fuerte, Anticipos/Ventas especiales, Gastos mayores y
   recordatorios. No reemplaza controles, handlers, reglas ni datos guardados. */
(function () {
    'use strict';
    var RAICES = '#cajOverlay,#concOverlay,#concHistOverlay,#dxOv_extras,#modalAnticipo,#modalVentaExtra,#dxOv_mayores,#modalConfirm,#dxRecordatorio';
    var prefijo = /^(?:\s|[🔒🔐🔓💰🏢🏦🏛💳🔮🎟🎪🎉🍽📦📋📜⚖💵🔀📅🗓🎯👤✅🖨⬇✕✖✏🗑↩🔴⚠⏳🔔⭐⏸＋+−—]|\uFE0F)+/u;
    var pendiente = false;
    function cada(s, fn) { document.querySelectorAll(s).forEach(fn); }
    function icono(el, familia, nombre) {
        if (!el || typeof window.etaaxIcono !== 'function') return;
        var clave = familia + '-' + nombre, actual = el.querySelector(':scope > .op-icon');
        if (actual && actual.dataset.icono === clave) return;
        var svg = window.etaaxIcono(clave, {tam:20}); if (!svg) return;
        if (actual) actual.remove();
        el.querySelectorAll(':scope > .etx-emoji-slot').forEach(function (n) { n.remove(); });
        var inicio = true;
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 3 && inicio) { n.textContent = n.textContent.replace(prefijo, ''); inicio = false; }
            else if (n.nodeType === 1 && n.getAttribute('aria-hidden') === 'true' && !n.querySelector('svg') && /^[\s—−✕✖]+$/.test(n.textContent)) n.remove();
        });
        var s = document.createElement('span'); s.className = 'op-icon'; s.dataset.icono = clave;
        s.setAttribute('aria-hidden', 'true'); s.innerHTML = svg;
        el.insertBefore(s, el.firstChild); el.dataset.etxEmoji = '1';
    }
    function titulo(el, familia, nombre, principal) {
        if (!el || el.querySelector('.op-title-copy')) return;
        var texto = el.textContent.replace(prefijo, '').trim(); el.textContent = '';
        var placa = document.createElement('span'); placa.className = 'op-title-plate';
        icono(placa, familia, nombre); el.appendChild(placa);
        var copia = document.createElement('span'); copia.className = 'op-title-copy';
        if (principal) copia.classList.add('op-title-daily');
        texto.split(/(Fuerte|Especiales|Mayores|Anticipo)/).forEach(function (p) {
            var s = document.createElement('span'); s.textContent = /^(Fuerte|Especiales|Mayores)$/.test(p) ? p.toLowerCase() : p;
            if (/^(Fuerte|Especiales|Mayores|Anticipo)$/.test(p)) s.className = 'op-title-accent'; copia.appendChild(s);
        });
        el.appendChild(copia); el.dataset.etxEmoji = '1';
    }
    // Se usa solo en metadatos construidos por el sistema, nunca en conceptos,
    // notas, nombres de personas ni encabezados que contienen texto libre.
    function marcas(el) {
        if (!el) return;
        var mapa = {'🏦':['cjf','caja-fuerte'],'🏛':['cjf','banco'],'💳':['cjf','credito'],
            '⚠':['rem','alerta'],'⏳':['rem','pendiente'],'⚖':['cjf','conciliar']};
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 1 && !n.classList.contains('op-icon') && !n.classList.contains('etx-ic')) { marcas(n); return; }
            if (n.nodeType !== 3 || !/[🏦🏛💳⚠⏳⚖]/u.test(n.textContent)) return;
            var fragmento = document.createDocumentFragment();
            n.textContent.split(/(🏦|🏛\uFE0F?|💳|⚠\uFE0F?|⏳|⚖\uFE0F?)/u).forEach(function (p) {
                var datos = mapa[p.replace(/\uFE0F/g, '')];
                if (!datos) fragmento.appendChild(document.createTextNode(p));
                else { var s = document.createElement('span'); icono(s, datos[0], datos[1]); fragmento.appendChild(s); }
            }); n.replaceWith(fragmento);
        });
    }
    function etiqueta(id, familia, nombre) {
        var campo = document.getElementById(id), fg = campo && campo.closest('.fg');
        if (fg) icono(fg.querySelector('label'), familia, nombre);
    }
    function caja() {
        titulo(document.querySelector('#cajOverlay .cj-title'), 'cjf', 'caja-fuerte', false);
        titulo(document.querySelector('#concOverlay .cj-title'), 'cjf', 'conciliar', false);
        titulo(document.querySelector('#concHistOverlay .cj-title'), 'cjf', 'historial', false);
        var nombres = {'Disponible de verdad':'disponible','Saldo disponible total':'disponible',
            'En camino del banco':'credito','Apartado en previsiones':'prevision','Anticipos por aplicar':'anticipo',
            'Caja Fuerte':'caja-fuerte','Cuentas Bancarias':'banco'};
        cada('#cajBody .cj-acum-lbl', function (el) {
            var texto = el.textContent.replace(prefijo, '').trim();
            if (!nombres[texto]) return;
            icono(el, 'cjf', nombres[texto]);
            var nota = el.nextElementSibling; if (nota) marcas(nota);
            if (texto === 'Apartado en previsiones') el.closest('.cj-acum').classList.add('op-reserve');
        });
        cada('#cajBody .cj-ctas-grid > div', function (bloque) {
            var tituloCuenta = bloque.querySelector('.cj-acum > div:first-child > div:first-child');
            if (tituloCuenta) Array.from(tituloCuenta.children).forEach(function (el, i) {
                if (el.classList.contains('op-icon')) return;
                if (i === 0) icono(el, 'cjf', 'banco');
                else if (/Predeterminada/.test(el.textContent)) icono(el, 'cjf', 'predeterminada');
                else if (/Inactiva/.test(el.textContent)) icono(el, 'cjf', 'inactiva');
            });
            var comision = bloque.querySelector(':scope > div:last-child > span:first-child');
            if (comision && /Comisiones/.test(comision.textContent)) icono(comision, 'cjf', 'comision');
        });
        cada('#cajBody > div > span:first-child', function (el) {
            if (/Saldo por cuenta de débito/.test(el.textContent)) { el.classList.add('op-section-label'); icono(el, 'cjf', 'banco'); }
        });
        cada('#cajBody > div[style*="display:grid"] > div > div:first-child', function (el) {
            if (el.textContent.replace(prefijo, '').trim() === 'Tarjetas de Crédito') { el.classList.add('op-section-label'); icono(el, 'cjf', 'credito'); }
        });
        var controles = {'#cajBody [onclick^="conciliarCuenta"]':'conciliar','#cajBody [onclick="abrirHistConciliaciones()"]':'historial',
            '#cajBody [onclick="congelarHistorialCuentas()"]':'congelar','#cajBody [onclick^="pagarTarjetaCredito"]':'credito',
            '#cjCortesBtn > span:first-child':'detalle','#concBtnGuardar':'guardar','#concCuentaNombre':'banco'};
        Object.keys(controles).forEach(function (s) { cada(s, function (el) { icono(el, 'cjf', controles[s]); }); });
        cada('#concHistBody tbody td:nth-child(2)', function (el) {
            icono(el, 'cjf', 'banco'); var tipo = el.querySelector('div');
            if (tipo) icono(tipo, 'cjf', /saldo/.test(tipo.textContent) ? 'conciliar' : 'credito');
        });
    }
    function extras() {
        titulo(document.querySelector('#dxOv_extras .dx-win-title'), 'ev', 'venta-especial', true);
        titulo(document.querySelector('#modalAnticipo h2'), 'ev', 'anticipo', false);
        titulo(document.querySelector('#modalVentaExtra h2'), 'ev', 'venta-especial', false);
        var controles = {'#btnVentaExtra':'agregar','#btnNuevoAnticipo':'anticipo','#btnAgregarVexCard':'agregar',
            '#antBtnGuardar':'guardar','#modalVentaExtra [onclick="guardarVentaExtra()"]':'guardar',
            '#modalVentaExtra .corte-sec-title':'venta-especial','#cardVentasExtra h2':'venta-especial','#vexEmpty > div:first-child':'venta-especial',
            '#vexTbody [onclick^="abrirModalVentaExtra"]':'editar','#vexTbody [onclick^="eliminarVentaExtra"]':'eliminar',
            '#antResumen [onclick^="abrirModalAnticipo"]':'editar','#antResumen [onclick^="devolverAnticipo"]':'devolver'};
        Object.keys(controles).forEach(function (s) { cada(s, function (el) { icono(el, 'ev', controles[s]); }); });
        var boton = document.getElementById('btnVentaExtra'); if (boton) boton.parentElement.classList.add('op-extras-toolbar');
        var campos = {antFecha:'fecha',antMonto:'efectivo',antCliente:'cliente',antConcepto:'evento',antFechaEvento:'fecha',
            antCuenta:'banco',antNotas:'notas',vexFecha:'fecha',vexConcepto:'venta-especial',
            vexMonto:'efectivo',vexResponsable:'cliente',vexComensales:'comensales',vexNotas:'notas'};
        Object.keys(campos).forEach(function (id) { etiqueta(id, 'ev', campos[id]); });
        var fondo = document.getElementById('antFondo'); if (fondo) etiqueta('antFondo', 'ev', fondo.value === 'banco' ? 'banco' : 'caja-fuerte');
        var tipos = {evento:'evento',festival:'festival',cena_especial:'cena',renta_espacio:'renta',catering:'catering',otro:'otro'};
        var metodos = {efectivo:'efectivo',transferencia:'transferencia',tarjeta:'tarjeta',mixto:'mixto'};
        var tipo = document.getElementById('vexTipo'), metodo = document.getElementById('vexMetodo');
        if (tipo) etiqueta('vexTipo', 'ev', tipos[tipo.value] || 'evento');
        if (metodo) etiqueta('vexMetodo', 'ev', metodos[metodo.value] || 'efectivo');
        cada('#antFondo option,#vexTipo option,#vexMetodo option', function (o) {
            var limpio = o.textContent.replace(prefijo, ''); if (limpio !== o.textContent) o.textContent = limpio;
        });
        var tiposTexto = {'Evento':'evento','Festival':'festival','Cena especial':'cena','Renta':'renta','Catering':'catering','Otro':'otro'};
        var metTexto = {'Ef.':'efectivo','Transfer.':'transferencia','Tarjeta':'tarjeta','Mixto':'mixto'};
        cada('#vexTbody tr', function (fila) {
            var t = fila.cells[1] && fila.cells[1].firstElementChild, m = fila.cells[3];
            if (t && tiposTexto[t.textContent.replace(prefijo, '').trim()]) icono(t, 'ev', tiposTexto[t.textContent.replace(prefijo, '').trim()]);
            if (m && metTexto[m.textContent.replace(prefijo, '').trim()]) icono(m, 'ev', metTexto[m.textContent.replace(prefijo, '').trim()]);
        });
        cada('#antResumen > div:has(>div)', function (el) {
            if (!el.querySelector('button')) return; el.classList.add('op-advance-row');
        });
        var encabezado = document.querySelector('#antResumen > div > span:first-child');
        if (encabezado && /Anticipos por aplicar/.test(encabezado.textContent)) icono(encabezado, 'ev', 'anticipo');
    }
    function mayores() {
        titulo(document.querySelector('#dxOv_mayores .dx-win-title'), 'gm', 'gasto-mayor', true);
        var controles = {'#btnGastoMayor':'agregar','#mayorWall .mw-title':'gasto-mayor',
            '#mayorWall button':'autorizar','#dxOv_mayores [onclick="bloquearMayores()"]':'candado',
            '#dxOv_mayores [onclick^="dxImprimir"]':'imprimir','#dxOv_mayores [onclick^="dxCSV"]':'exportar-csv',
            '#mayorContent h2':'gasto-mayor','#emptyMayores .empty-state-icon':'sin-registros',
            '#tbodyMayores .met-caja':'caja-fuerte','#tbodyMayores .met-chica':'caja-chica','#tbodyMayores .met-banco':'banco'};
        Object.keys(controles).forEach(function (s) { cada(s, function (el) { icono(el, 'gm', controles[s]); }); });
        var boton = document.getElementById('btnGastoMayor'); if (boton) boton.parentElement.classList.add('op-toolbar');
        cada('#tbodyMayores tr', function (fila) {
            var estado = fila.cells[6] && fila.cells[6].firstElementChild;
            if (!estado) return; var texto = estado.textContent.trim().toLowerCase();
            if (['pagado','pendiente','programado'].indexOf(texto) >= 0) { estado.classList.add('op-status'); icono(estado, 'gm', texto); }
        });
    }
    function recordatorios() {
        var card = document.querySelector('#dxRecordatorio > div'); if (!card) return;
        card.classList.add('op-reminder');
        cada('#dxRecordatorio > div > div[style*="justify-content:space-between"]', function (fila) {
            fila.classList.add('op-reminder-row'); var texto = fila.firstElementChild;
            var vencido = /vencido/.test(texto.textContent), hoy = /vence HOY/.test(texto.textContent);
            fila.classList.toggle('op-overdue', vencido); fila.classList.toggle('op-due', hoy);
            icono(texto, 'rem', vencido || hoy ? 'alerta' : 'pendiente');
        });
        var header = card.querySelector(':scope > div:first-of-type');
        if (header && /Recordatorio de pagos/.test(header.textContent)) { header.classList.add('op-reminder-title'); icono(header, 'rem', 'recordatorio'); }
        cada('#dxRecordatorio [onclick="_cerrarRecordatorio()"]', function (el) { icono(el, 'rem', 'cerrar'); el.setAttribute('aria-label', 'Cerrar recordatorio por hoy'); });
        cada('#dxRecordatorio [onclick*="dxAbrir"]', function (el) { icono(el, 'rem', 'ir-a-pagar'); });
    }
    function pintar() {
        pendiente = false; if (typeof window.etaaxIcono !== 'function') return;
        cada(RAICES, function (raiz) {
            if (raiz.id === 'dxRecordatorio') return;
            raiz.classList.add('op-ui');
            var familia = /extras|Anticipo|VentaExtra/.test(raiz.id) ? 'ev' : raiz.id === 'dxOv_mayores' ? 'gm' : 'cjf';
            raiz.querySelectorAll('.etx-min-btn').forEach(function (b) { icono(b, familia, 'minimizar'); });
            raiz.querySelectorAll('.modal-close,.dx-win-close').forEach(function (b) { icono(b, familia, 'cerrar'); });
        });
        caja(); extras(); mayores(); recordatorios();
        var ok = document.getElementById('cfOk'), modal = document.getElementById('modalConfirm');
        if (ok && modal) modal.classList.toggle('op-confirm-danger', /--red|e05a3a|224,\s*90,\s*58/i.test(ok.style.background));
        cada('#dxOv_extras .btn-row,#dxOv_mayores .btn-row', function (b) {
            if (!b.textContent.trim() && !b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.title || (b.classList.contains('del') ? 'Eliminar registro' : 'Editar registro'));
        });
    }
    function agendar() { if (!pendiente) { pendiente = true; window.requestAnimationFrame(pintar); } }
    function iniciar() {
        pintar();
        document.addEventListener('change', function (e) { if (e.target.closest(RAICES)) agendar(); });
        new MutationObserver(function (cambios) {
            if (cambios.some(function (m) {
                var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                return el && el.closest(RAICES);
            })) agendar();
        }).observe(document.body, {childList:true,subtree:true,characterData:true});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
