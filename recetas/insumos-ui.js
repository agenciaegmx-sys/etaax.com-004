/* Decoración del catálogo y editor: conserva nodos, eventos, valores y permisos. */
(function () {
    'use strict';
    var pagina=location.pathname.split('/').filter(Boolean).pop()||'';
    if(pagina!=='insumos'&&pagina!=='insumos.html')return;
    document.body.classList.add('etx-insumos-page');
    var pendiente=false;
    var prefijo=/^(?:\s|[🗜🏢🔔🔗🌐＋+✕✖🖨💾👁📷📱📦🍳🍷🍸📍🕰⏸✅⊞☰☐☑⠿↕−—⋯…🥃🍹🥤🧃🍺🛢🧂🥩🥬🗑✏⏱📋📜🎯]|\uFE0F)+/u;
    var tipos={destilado:'destilado',licor:'licor',vino:'vino',refresco:'refresco',cerveza:'cerveza',cerveza_barril:'barril',abarrote:'abarrote',carne:'carne',fruta:'fruta',otro:'catalogo'};
    var emojis={'🥃':'destilado','🍹':'licor','🍷':'vino','🥤':'refresco','🧃':'refresco','🍺':'cerveza','🛢️':'barril','🧂':'abarrote','🥩':'carne','🥬':'fruta','📦':'catalogo','🍳':'sub-receta'};
    function cada(s,fn){document.querySelectorAll(s).forEach(fn);}
    function icono(el,nombre,solo){
        if(!el||!nombre||typeof window.etaaxIcono!=='function')return;
        var actual=el.querySelector(':scope > .i-ui-icon');
        if(actual&&actual.dataset.icono===nombre)return;
        if(actual)actual.remove();
        if(solo)el.textContent='';
        else{
            el.querySelectorAll(':scope > .etx-emoji-slot').forEach(function(n){n.remove();});
            Array.from(el.childNodes).forEach(function(n){
                if(n.nodeType===3)n.textContent=n.textContent.replace(prefijo,'');
                else if(n.nodeType===1&&!n.querySelector('svg')&&/^[\s👁📷📦＋+✕✖−—\uFE0F]+$/u.test(n.textContent))n.remove();
            });
        }
        var s=document.createElement('span');s.className='i-ui-icon';s.dataset.icono=nombre;s.setAttribute('aria-hidden','true');
        s.innerHTML=window.etaaxIcono('ins-'+nombre,{tam:20});el.insertBefore(s,el.firstChild);el.dataset.etxEmoji='1';
        if(el.tagName==='BUTTON'&&!el.textContent.trim())el.setAttribute('aria-label',el.title||nombre);
    }
    function titulo(el,nombre){
        if(!el||el.querySelector(':scope > .i-title-plate'))return;
        var texto=el.textContent.replace(prefijo,'').replace(/[🥃🍹🍷🥤🧃🍺🛢🧂🥩🥬📦]\uFE0F?/gu,'').replace(/\s+/g,' ').trim();el.textContent='';
        var placa=document.createElement('span');placa.className='i-title-plate';icono(placa,nombre);
        var copia=document.createElement('span');copia.className='i-title-copy';copia.textContent=texto;
        el.appendChild(placa);el.appendChild(copia);el.dataset.etxEmoji='1';
    }
    function pintar(){
        pendiente=false;if(typeof window.etaaxIcono!=='function')return;
        var controles={
            '#btnOptFotosNeg':'optimizar','#btnInsumosNegGlobal':'negocio','#btnNovedadesIns':'novedades','#btnCatalogoEtaax':'global','#btnAgregarInsumo':'agregar',
            '#btnVistaGrid':'galeria','#btnVistaLista':'lista','#btnVistaCosteo':'costeo','#btnModoSeleccion':'seleccionar','#btnModoOrden':'ordenar','#btnImprimirIns':'imprimir',
            '#modalOverlay [onclick="guardarInsumo()"]':'guardar','#btnAgregarCosteo':'agregar','#modalOverlay [onclick^="agregarConceptoCampo"]':'agregar',
            '#btnQrInsumo':'celular',
            '#listaPresentaciones [onclick^="eliminarPresentacion"]':'eliminar','#listaPresentaciones [onclick^="abrirPanelProv"]':'proveedor',
            '#modalOverlay .foto-icon':'foto','#tbodyInsumos [onclick^="verFicha"]':'ficha','.ins-mas-btn':'mas',
            '.ins-menu-pop [onclick*="verFicha"]':'ficha','.ins-menu-pop [onclick*="editarInsumo"]':'editar','.ins-menu-pop [onclick*="eliminarInsumo"]':'eliminar',
            '.ins-menu-pop [onclick*="asignar"]':'negocio','#modalImportar .modal-footer [onclick]':'cerrar'
        };
        Object.keys(controles).forEach(function(s){cada(s,function(e){icono(e,controles[s]);});});
        cada('#filtroEstadoIns option,#ins-area option',function(e){if(e.hasAttribute('value')){var t=e.textContent.replace(prefijo,'');if(e.textContent!==t)e.textContent=t;}});
        cada('.search-icon',function(e){icono(e,'buscar',true);});icono(document.getElementById('clearSearch'),'limpiar',true);
        cada('.modal-close',function(e){icono(e,'cerrar');e.setAttribute('aria-label','Cerrar');});
        cada('.etx-min-btn',function(e){icono(e,'minimizar');});
        titulo(document.getElementById('modalTitulo'),'editar');
        titulo(document.querySelector('#modalFicha .modal-header h2'),'ficha');
        titulo(document.querySelector('#modalCategoria .modal-header h2'),'catalogo');
        titulo(document.querySelector('#modalImportar .modal-header h2'),'global');
        titulo(document.getElementById('cgTitulo'),'global');titulo(document.getElementById('ignTitulo'),'negocio');
        cada('#modalCatalogoGlobal [onclick="cerrarCatalogoGlobal()"],#modalInsumosNeg [onclick="cerrarInsumosNeg()"]',function(e){icono(e,'cerrar');});
        icono(document.querySelector('#insumosCatalogCard > .card-header h2'),'catalogo');
        var vista=typeof vistaInsumos==='string'?vistaInsumos:'lista';
        [['btnVistaGrid','grid'],['btnVistaLista','lista'],['btnVistaCosteo','costeo']].forEach(function(p){var e=document.getElementById(p[0]);if(e)e.classList.toggle('i-selected',vista===p[1]);});
        var seleccion=document.getElementById('btnModoSeleccion');if(seleccion)seleccion.classList.toggle('i-selected',typeof _modoSeleccion!=='undefined'&&!!_modoSeleccion);
        var ordenar=document.getElementById('btnModoOrden');if(ordenar)ordenar.classList.toggle('i-selected',typeof _modoOrden!=='undefined'&&!!_modoOrden);
        cada('#modalCategoria .cat-btn',function(e){var m=(e.getAttribute('onclick')||'').match(/abrirModalConTipo\('([^']+)'\)/);if(m)icono(e.querySelector('span'),tipos[m[1]]||'catalogo',true);});
        var tipo=typeof tipoInsumoActual==='string'?tipoInsumoActual:'otro';icono(document.getElementById('iconTipoActual'),tipos[tipo]||'catalogo',true);
        cada('#convertirTipoGrid button',function(e){var m=(e.getAttribute('onclick')||'').match(/'([^']+)'/);if(m)icono(e,tipos[m[1]]||'convertir');});
        cada('#gridInsumos .card-emoji,#tbodyInsumos .i-insumo-placeholder',function(e){var t=e.textContent.trim();if(emojis[t])icono(e,emojis[t],true);});
        cada('#modalOverlay .proc-label',function(e){var t=e.textContent;if(/Foto del producto/.test(t))icono(e,'foto');else if(/Área/.test(t))icono(e,'zona');else if(/Descripción/.test(t))icono(e,'descripcion');});
        cada('#listaPresentaciones .i-presentacion > div:first-child > span',function(e){icono(e,'unidad');});
        cada('.i-tax-panel > div:first-child',function(e){icono(e,'impuestos');});
        cada('.i-costeo-panel > div:first-child',function(e){icono(e,'costeo');});
        cada('.i-stock-panel > div:first-child',function(e){icono(e,'stock');});
        cada('.i-editor-presentaciones > div:first-child > span',function(e){icono(e,'unidad');});
        cada('#listaPresentaciones .meta-item > label',function(e){
            var t=e.textContent,n=/^Precio de compra/.test(t)?'precio':/^Proveedor/.test(t)?'proveedor':/^Zona/.test(t)?'zona':/^Masa drenada/.test(t)?'drenado':/^Contenido/.test(t)?'contenido':/^Stock/.test(t)?'stock':/^Peso/.test(t)?'peso':null;
            if(n)icono(e,n);
        });
        cada('.i-ficha-section',function(e){icono(e,e.dataset.iIcon);});
        var ficha=document.getElementById('fichaContenido');
        if(ficha&&ficha.firstElementChild){
            ficha.firstElementChild.classList.add('i-ficha-identidad');
            Array.from(ficha.children).forEach(function(e){if(e.getAttribute('style')&&/background:var\(--surface2\)/.test(e.getAttribute('style')))e.classList.add('i-ficha-presentacion');});
            var foto=ficha.firstElementChild.firstElementChild;if(foto&&foto.textContent.trim()==='📦')icono(foto,'catalogo',true);
            cada('#fichaContenido span',function(e){var t=e.textContent.trimStart();if(t.startsWith('🏢'))icono(e,'proveedor');else if(t.startsWith('📍'))icono(e,'zona');else if(t.startsWith('🍷'))icono(e,'vino');});
        }
    }
    function agendar(){if(!pendiente){pendiente=true;requestAnimationFrame(pintar);}}
    function iniciar(){
        pintar();document.addEventListener('change',agendar);
        new MutationObserver(function(cambios){if(cambios.some(function(m){var e=m.target.nodeType===1?m.target:m.target.parentElement;return e&&!e.closest('.etx-sprite');}))agendar();}).observe(document.body,{childList:true,subtree:true,characterData:true});
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar);else iniciar();
})();
