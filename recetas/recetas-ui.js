/* Capa visual del recetario. Conserva nodos, listeners, valores y cálculos;
   solo decora controles conocidos y añade clases a las vistas existentes. */
(function () {
    'use strict';
    document.body.classList.add('etx-recetas-page');
    var pendiente = false;
    var tipos = {'🍽️':'alimentos','🥃':'bebidas','🥣':'sub-alimentos','🧃':'sub-bebidas','🥘':'sub-alimentos','📋':'catalogo'};
    var prefijo = /^(?:\s|[🍽🥃🥣🥘🧃📚📋📊🧾💾🗑✏🖨💰📐💳⚖⚡📦🏢🌐➕🔍📷📱🔗🔔⊞☰↕✕✖＋+−—←]|\uFE0F)+/u;
    function cada(s, fn) { document.querySelectorAll(s).forEach(fn); }
    function icono(el, nombre, exacto) {
        if (!el || typeof window.etaaxIcono !== 'function') return;
        el.querySelectorAll(':scope > span[aria-hidden="true"]:not(.r-ui-icon)').forEach(function (s) {
            if (!s.querySelector('svg') && /^[\s—−✕✖]+$/.test(s.textContent)) s.remove();
        });
        var actual = el.querySelector(':scope > .r-ui-icon');
        if (actual && actual.dataset.icono === nombre) return;
        if (actual) actual.remove();
        el.querySelectorAll(':scope > .etx-emoji-slot').forEach(function (s) { s.remove(); });
        var inicio = true;
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType !== 3 || !inicio) return;
            var t = n.textContent.trimStart();
            n.textContent = exacto !== undefined ? (t.indexOf(exacto) === 0 ? t.slice(exacto.length).trimStart() : n.textContent) : n.textContent.replace(prefijo, '');
            inicio = false;
        });
        var s = document.createElement('span'); s.className = 'r-ui-icon';
        s.dataset.icono = nombre; s.setAttribute('aria-hidden','true');
        s.innerHTML = window.etaaxIcono('rec-' + nombre, {tam:20});
        el.insertBefore(s, el.firstChild); el.dataset.etxEmoji = '1';
    }
    function dibujo(el, nombre) {
        if (!el) return;
        if (!el.querySelector('.r-ui-icon')) el.textContent = '';
        icono(el, nombre);
    }
    function titulo(el, nombre, limpiar) {
        if (!el) return;
        var placa = el.querySelector(':scope > .r-title-plate');
        if (placa) { icono(placa, nombre); return; }
        var texto = el.textContent; // Los nombres de recetas se conservan literalmente.
        if (limpiar) texto = texto.replace(prefijo,'');
        el.textContent = '';
        placa = document.createElement('span'); placa.className = 'r-title-plate'; icono(placa, nombre);
        var copia = document.createElement('span'); copia.className = 'r-title-copy'; copia.textContent = texto;
        el.appendChild(placa); el.appendChild(copia); el.dataset.etxEmoji = '1';
    }
    function tipoActual() { return typeof recetaTipoActual === 'undefined' ? 'alimentos' : recetaTipoActual; }
    function tipoFicha() {
        if (typeof fichaRecetaActualId === 'undefined' || typeof getRecetas !== 'function') return 'ficha';
        var r = getRecetas().find(function (x) { return x.id === fichaRecetaActualId; });
        return r && r.tipo || 'ficha';
    }
    function seleccionado(el, si) { if (el) el.classList.toggle('r-selected', !!si); }
    function pintar() {
        pendiente = false;
        if (typeof window.etaaxIcono !== 'function') return;
        var controles = {
            '#btnGuardarReceta':'guardar','#btnGuardarCaratulaEdit':'guardar','#btnEliminarReceta':'eliminar',
            '#btnImprimirHeader':'imprimir','#btnConvertir':'simple','#btnNuevaReceta':'agregar',
            '#btnFichaEditar':'editar','#btnFichaCosteo':'costeo','#btnFichaImprimir':'imprimir',
            '#btnNuevaRecCat':'agregar','#btnImprimirSeleccion':'imprimir','#btnNovedadesRec':'cambios',
            '#btnVistaRecGrid':'galeria','#btnVistaRecLista':'lista','#btnModoOrdenRec':'ordenar',
            '#rp-alimentos':'alimentos','#rp-bebidas':'bebidas','#rp-sub':'sub-alimentos','#rp-sub-alimentos':'sub-alimentos','#rp-sub-bebidas':'sub-bebidas',
            '#caratulaBtnVolver':'volver','#caratulaBtnPrint':'imprimir','#caratulaBtnCerrar':'cerrar',
            '#editorWrap [onclick="agregarIngrediente()"]':'agregar',
            '[onclick="_toggleInsumoMenu(event)"]':'insumos',
            '#insumoMenu [onclick="abrirInsumoDesde(\'globalneg\')"]':'negocio',
            '#insumoMenu [onclick="abrirInsumoDesde(\'etaax\')"]':'catalogo',
            '#insumoMenu [onclick="abrirInsumoDesde(\'nuevo\')"]':'agregar',
            '[onclick="agregarSubRecetaComoInsumo()"]':'agregar',
            '#btnQrReceta':'celular','#fotoPlaceholder > span:first-child':'fotos',
            '#fotoBtnEliminar':'eliminar','.video-icon':'enlace',
            '[onclick="document.getElementById(\'fotoInput\').click()"]:is(button)':'subir',
            '#barraSelRecetas [onclick="selRecetasVisibles()"]':'seleccionar',
            '#barraSelRecetas [onclick="limpiarSelRecetas()"]':'limpiar',
            '#caratulaDetalleBody .btn-ver-ficha':'ficha',
            '#modalCosteoFlotante button[onclick*="style.display"]':'cerrar',
            '#modalFichaInsumo [onclick="cerrarFichaInsumo()"]':'cerrar',
            '#fichaLightbox button:last-child':'cerrar',
            '#modalIframeInsumo [onclick="cerrarIframeInsumo()"]':'cerrar'
        };
        Object.keys(controles).forEach(function (s) { cada(s, function (el) { icono(el, controles[s]); }); });
        var tipo = tipoActual();
        titulo(document.getElementById('brandTitle'), tipo === 'simple' ? 'simple' : tipo, false);
        dibujo(document.getElementById('recetaTipoIcon'), tipo === 'simple' ? 'simple' : tipo);
        titulo(document.querySelector('#modalVerRecetas .etx-modal-hd h2'),'catalogo',true);
        titulo(document.getElementById('fichaTitulo'),tipoFicha(),false);
        titulo(document.getElementById('costeoFlotanteNombre'),'costeo',false);
        titulo(document.getElementById('caratulaTituloHeader'),'caratula',true);
        titulo(document.getElementById('iframeInsumoLabel'),'ficha',true);
        cada('#modalNuevaReceta .modal-header h2,#modalConvertirReceta .modal-header h2', function (el) { titulo(el,'simple',true); });
        titulo(document.querySelector('#modalImpresion .modal-header h2'),'imprimir',true);
        cada('.modal-header .modal-close,#modalVerRecetas .modal-close', function (el) { icono(el,'cerrar'); el.setAttribute('aria-label','Cerrar'); });
        cada('.etx-min-btn', function (el) { icono(el,'minimizar'); });
        cada('.rec-mas-btn', function (el) { dibujo(el,'mas'); el.setAttribute('aria-label','Acciones de la receta'); });
        cada('#gridRecetas > div[style*="grid-column:span 4"] > div:first-child', function (el) { dibujo(el,'catalogo'); });
        cada('#gridRecetas [data-rec-card]', function (el) {
            var d = el.querySelector(':scope > div[style*="font-size:20px"][style*="text-align:center"]');
            if (d) { var t = tipos[d.textContent.trim()]; if (t) { dibujo(d,t); d.classList.add('r-recipe-type'); } }
            seleccionado(el, typeof recetasSeleccionadas !== 'undefined' && recetasSeleccionadas.has(el.dataset.recCard));
        });
        cada('#gridRecetas td:nth-child(2) > span[style*="margin-right:7px"]', function (el) {
            var t = tipos[el.textContent.trim()]; if (t) dibujo(el,t);
        });
        cada('#modalNuevaReceta .modal-body button,#modalConvertirReceta .modal-body button', function (el) {
            var m = (el.getAttribute('onclick') || '').match(/\('(alimentos|bebidas|sub-alimentos|sub-bebidas)'\)/);
            if (m) dibujo(el.querySelector(':scope > span:first-child'),m[1]);
        });
        cada('#modalImpresion .cat-btn', function (el) { dibujo(el.querySelector(':scope > span:first-child'), /operativa/.test(el.getAttribute('onclick')) ? 'procedimiento' : 'costeo'); });
        cada('#caratulaSelectorGrid > button,#caratulaSelectorGrid > div', function (el) {
            var m = (el.getAttribute('onclick') || '').match(/\('(alimentos|bebidas|sub-alimentos|sub-bebidas)'\)/);
            if (m) { el.classList.add('r-group-card'); dibujo(el.querySelector(':scope > div > span:first-child'),m[1]); }
        });
        cada('.rec-menu-pop button .ic', function (el) {
            var t = el.textContent.trim();
            var mapa = {'📋':'ficha','✏️':'editar','📄':'duplicar','🖨️':'imprimir','🔗':'enlace','🏢':'negocio','🗑️':'eliminar','⏸':'candado','▶':'seleccionar','🔔':'cambios'};
            if (mapa[t]) dibujo(el,mapa[t]);
        });
        cada('#editorWrap .card-header h2', function (el) {
            var mapa = {'Ingredientes':'insumos','Procedimiento & Media':'procedimiento','Rendimiento':'rendimiento','Costeo':'costeo'};
            var t = el.textContent.trim(); if (mapa[t]) icono(el,mapa[t]);
        });
        cada('#editorWrap .costeo-col-title', function (el) { icono(el, el.closest('.col-aplicado') ? 'aplicado' : 'sugerido'); });
        cada('#cardAgregarInsumo .card-body > div:first-child > div > div:first-child', function (el) { icono(el,'insumos','📦'); });
        cada('#cardAgregarInsumo label:has(#chkIncluirInventario) > span', function (el) { icono(el,'inventario','📦'); });
        var area = document.getElementById('selAreaSubReceta');
        if (area) {
            icono(area.previousElementSibling,'inventario','📍');
            Array.from(area.options).forEach(function (o) {
                if (!o.hasAttribute('value')) return;
                var limpio = o.textContent.replace(/^(?:🍸|🍳|📦|🍽️)\s*/u,'');
                if (limpio !== o.textContent) o.textContent = limpio;
            });
        }
        cada('#costeoFlotanteContenido > div > div', function (el,i) {
            el.classList.add('r-cost-panel');
            if (el.firstElementChild) icono(el.firstElementChild, /sub-/.test(tipoFicha()) ? (i ? 'porciones':'rendimiento') : (i ? 'aplicado':'sugerido'));
        });
        var ficha = document.getElementById('fichaRecetaContenido');
        if (ficha) {
            if (ficha.firstElementChild) ficha.firstElementChild.classList.add('r-ficha-meta');
            // Un contenedor de desplazamiento conserva la tabla y sus columnas.
            ficha.querySelectorAll(':scope > table').forEach(function (tabla) {
                var scroll = document.createElement('div'); scroll.className = 'r-table-scroll';
                tabla.before(scroll); scroll.appendChild(tabla);
            });
            var grupo = ficha.querySelector('.r-ficha-meta > div:first-child > div:nth-child(2)');
            var emoji = {alimentos:'🍽️',bebidas:'🥃','sub-alimentos':'🥣','sub-bebidas':'🧃'}[tipoFicha()];
            if (grupo && emoji) icono(grupo,tipoFicha(),emoji);
            cada('#fichaRecetaContenido > div', function (el) {
                var t = el.textContent.trim();
                if (t === 'Ingredientes') icono(el,'insumos');
                if (t === 'Procedimiento') icono(el,'procedimiento');
            });
            var hist = ficha.querySelector(':scope > div:last-child > div:first-child > div:first-child');
            if (hist && hist.textContent.trim().indexOf('📜 Historial de cambios') === 0) icono(hist,'cambios','📜');
        }
        var v = document.getElementById('btnVista');
        if (v) icono(v, /OPERATIVA/i.test(v.textContent) ? 'procedimiento' : 'costeo');
        if (typeof vistaRecetas !== 'undefined') {
            seleccionado(document.getElementById('btnVistaRecGrid'),vistaRecetas==='grid');
            seleccionado(document.getElementById('btnVistaRecLista'),vistaRecetas==='lista');
        }
        if (typeof filtroRecetaTipo !== 'undefined') {
            var filtros = {'rp-todas':'','rp-alimentos':'alimentos','rp-sub':'sub','rp-sub-alimentos':'sub-alimentos','rp-bebidas':'bebidas','rp-sub-bebidas':'sub-bebidas'};
            Object.keys(filtros).forEach(function (id) { seleccionado(document.getElementById(id),filtroRecetaTipo===filtros[id]); });
        }
        var buscar = document.getElementById('buscarReceta');
        if (buscar) dibujo(buscar.previousElementSibling,'buscar');
        buscar = document.getElementById('caratulaBuscar'); if (buscar) dibujo(buscar.previousElementSibling,'buscar');
        // Clases en rejillas dinámicas: mantienen valores, unidades, bloqueos y handlers.
        var rend = document.getElementById('cardRendimientoBody');
        if (rend) {
            if (rend.firstElementChild) rend.firstElementChild.classList.add('r-yield-grid');
            cada('#cardRendimientoBody [style*="grid-template-columns:1fr auto 1fr"]', function (el) { el.classList.add('r-portions-grid'); });
            cada('#cardRendimientoBody [style*="letter-spacing:2px"]', function (el) {
                if (el.textContent.trim().indexOf('⚖️ Rendimiento en porciones') === 0) icono(el,'porciones','⚖️');
            });
        }
        cada('#editorWrap .meta-item', function (el) { el.classList.add('r-field'); });
        cada('#tablaIngredientes [onclick^="eliminarIng"]', function (el) { dibujo(el,'eliminar'); });
        cada('#tablaIngredientes [onclick^="verFichaInsumo"]', function (el) { dibujo(el,'ficha'); });
    }
    function agendar() { if (!pendiente) { pendiente = true; requestAnimationFrame(pintar); } }
    pintar();
    document.addEventListener('change', agendar);
    new MutationObserver(agendar).observe(document.body,{childList:true,subtree:true,characterData:true});
})();
