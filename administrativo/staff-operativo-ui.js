/* Decoración de controles existentes. No sustituye eventos, formularios,
   valores de opciones, permisos, almacenamiento ni reglas operativas. */
(function () {
 'use strict';
 var pagina=location.pathname.split('/').filter(Boolean).pop()||'';
 if(pagina.indexOf('.')<0)pagina+='.html';
 var paginas={'horarios.html':'horarios','checklists.html':'checklists','organigrama.html':'organigrama','perfiles-puesto.html':'perfiles','evaluaciones.html':'evaluaciones'};
 var tipo=paginas[pagina], pendiente=false;
 if(!tipo&&pagina!=='staff-hub.html')return;
 if(tipo){document.body.classList.add('etx-op-page');document.body.dataset.opPagina=tipo;}
 var prefijo=/^(?:\s|[🗓📅🕒✅📋📱🧠📝🌐🖨💾✏✎🗑🔗✂📊💬✉⬇⧉⊞▦▤⟲◀▶▲▼↑↓✓✕✖＋+−—←👤💼🎂]|\uFE0F)+/u;
 function cada(s,fn,raiz){(raiz||document).querySelectorAll(s).forEach(fn);}
 function icono(el,k,solo){
  if(!el||typeof window.etaaxIcono!=='function')return;
  cada(':scope > span[aria-hidden="true"]:not(.op-icon)',function(n){if(!n.querySelector('svg')&&/^[\s—−✕✖]+$/.test(n.textContent))n.remove();},el);
  var actual=el.querySelector(':scope > .op-icon');
  if(actual&&actual.dataset.icono===k)return;
  if(solo){el.textContent='';}else{
   cada(':scope > .op-icon,:scope > .s-ui-icon,:scope > .etx-emoji-slot',function(n){n.remove();},el);
   var inicio=true;Array.from(el.childNodes).forEach(function(n){if(n.nodeType===3&&inicio){n.textContent=n.textContent.replace(prefijo,'');inicio=false;}});
  }
  var s=document.createElement('span');s.className='op-icon';s.dataset.icono=k;s.setAttribute('aria-hidden','true');s.innerHTML=window.etaaxIcono('sto-'+k,{tam:20});el.insertBefore(s,el.firstChild);el.dataset.etxEmoji='1';
  if(el.tagName==='BUTTON'&&!el.textContent.trim())el.setAttribute('aria-label',el.title||k.replace(/-/g,' '));
 }
 function titulo(el,k){
  if(!el)return;
  var p=el.querySelector(':scope > .op-title-icon');
  if(!p){Array.from(el.childNodes).some(function(n){if(n.nodeType!==3)return false;n.textContent=n.textContent.replace(prefijo,'');return true;});p=document.createElement('span');p.className='op-title-icon';p.setAttribute('aria-hidden','true');el.insertBefore(p,el.firstChild);}
  icono(p,k,true);
 }
 var acciones={
  abrirAgregar:'agregar',copiarSemanaAnterior:'copiar',abrirPDF:'imprimir',irHoy:'calendario',editorLimpiar:'eliminar',editorDescanso:'descanso',editorGuardar:'guardar',cerrarAgregar:'cerrar',cerrarPersona:'cerrar',cerrarPDF:'volver',imprimirHorario:'imprimir',regresarASuSucursal:'volver',
  abrirQrChecklist:'qr',setTab:'plantillas',nuevaPlantilla:'agregar',abrirEjecDe:'ejecutar',abrirImprimir:'imprimir',editarPlantilla:'editar',copiarPlantASucursal:'copiar',eliminarPlantilla:'eliminar',addTareaRow:'agregar',cerrarEditor:'volver',guardarPlantilla:'guardar',cerrarImprimir:'cerrar',imprimirPlantilla:'imprimir',imprimirChecklist:'imprimir',descargarQrCk:'descargar',verEjecucion:'detalle',purgarEvidencias:'eliminar',
  nuevoNodo:'agregar',toggleConnect:'conectar',toggleDisconnect:'desconectar',resetVista:'centrar',abrirPerfilDeNodo:'perfiles',borrarNodo:'eliminar',cerrarModal:'volver',guardarNodo:'guardar',
  nuevoPerfil:'agregar',abrirPerfilesEtaax:'global',verLista:'volver',editarPerfil:'editar',guardarPerfil:'guardar',eliminarPerfil:'eliminar',
  nuevaEval:'agregar',abrirEvalsEtaax:'global',cancelarEdit:'volver',guardarEval:'guardar',agregarPregunta:'pregunta',agregarSeccion:'seccion',eliminarSeccion:'eliminar',agregarOpcion:'opciones',eliminarPregunta:'eliminar',eliminarOpcion:'eliminar',eliminarEval:'eliminar',editarEval:'editar',compartir:'compartir',verResultados:'resultados',copiarEvalASucursal:'copiar',cerrarResultados:'volver',cerrarShare:'cerrar',shCopiar:'copiar',shWhats:'whatsapp',shCorreo:'correo',actualizarDesdeCatalogo:'estado',imprimirResultado:'imprimir',_copiarUrl:'copiar','window.print':'imprimir'
 };
 var peligrosas=/^(?:eliminar|borrarNodo|purgarEvidencias|editorLimpiar)/;
 function botones(){
  cada('.hr-wrap button,.hr-modal-bg button,.ck-wrap button,.ck-modal-bg button,#qrCkModal button,.org-top button,.org-modal button,.pp-wrap button,.ev-wrap button,.ev-share button',function(el){
   var h=el.getAttribute('onclick')||'',fn=Array.from(h.matchAll(/(?:^|;)\s*([\w.]+)\(/g)).map(function(m){return m[1];}).find(function(n){return acciones[n]||/^(cambiarSemana|setVista|zoomBtn|_moverTarea|moverPregunta)$/.test(n);}),k=acciones[fn];
   if(fn==='cambiarSemana')k=h.indexOf('-1')>=0?'anterior':'siguiente';
   if(fn==='setVista')k=h.indexOf('cards')>=0?'tarjetas':'cuadricula';
   if(fn==='setTab')k=h.indexOf('cumpl')>=0?'cumplimiento':h.indexOf('ejec')>=0?'ejecutar':'plantillas';
   if(fn==='zoomBtn')k=h.indexOf('1.2')>=0?'zoom-mas':'zoom-menos';
   if(fn==='_moverTarea'||fn==='moverPregunta')k=h.indexOf('-1')>=0?'subir':'bajar';
   if(el.matches('#qrCkModal button[onclick*="style.display"]'))k='cerrar';
   if(k)icono(el,k,fn==='zoomBtn');
   if(fn&&peligrosas.test(fn))el.classList.add('op-danger');
  });
  cada('.hr-asis button',function(el){var t=el.title,k=t==='Asistió'?'asistencia':t==='No asistió'?'ausencia':'retardo';icono(el,k,true);el.setAttribute('aria-label',t);el.setAttribute('aria-pressed',el.classList.contains('on')?'true':'false');});
  cada('.ck-tarea-del,.ev-q-del,.ev-opt-del,.ev-sec-del,.ck-modal-x',function(el){icono(el,el.matches('.ck-modal-x')?'cerrar':'eliminar',true);});
  cada('.cate-cerrar',function(el){icono(el,'cerrar');});
  cada('.cate-add',function(el){icono(el,el.disabled?'estado':'agregar');});
  cada('#ckDetOv button',function(el){icono(el,'cerrar');});
 }
 function pintarPagina(){
  botones();
  [['.hr-title','horarios'],['.ck-title','checklists'],['.org-eyebrow','organigrama'],['.pp-title','perfiles'],['.ev-title','evaluaciones'],['#hrmTitle','reloj'],['#hrAddModal h3','persona'],['#hrPerNom','persona'],['#hrPdfModal h3','imprimir'],['#ckmTitle','plantillas'],['#ckpTitulo','imprimir'],['#nmTitle','puesto']].forEach(function(par){cada(par[0],function(el){titulo(el,par[1]);});});
  cada('.pp-sec',function(el){var t=el.textContent.trim(),k=/Información/.test(t)?'puesto':/competencias/.test(t)?'competencias':/Salud/.test(t)?'salud':'funciones';icono(el,k);});
  cada('.ev-share-hdr>span',function(el){icono(el,'compartir');});
  cada('.cate-tt',function(el){icono(el,'global');});
  cada('.ck-tag.apertura,.ck-tag.cierre,.ck-tag.intermedio,.ck-tag.limpieza',function(el){var k=['apertura','cierre','intermedio','limpieza'].find(function(v){return el.classList.contains(v);});icono(el,k);});
  cada('.ev-cat-ic',function(el){icono(el,'evaluaciones',true);});
  cada('#edFicha>div>label:first-child>span',function(el){var campo=el.previousElementSibling&&el.previousElementSibling.dataset.fich;icono(el,({nombre:'persona',puesto:'puesto',edad:'calendario',tel:'whatsapp',correo:'correo'})[campo]||'persona');});
  cada('.ev-link-box>span:first-child',function(el){icono(el,'enlace',true);});
  cada('.org-meta',function(el){var t=el.textContent.trim();if(t.indexOf('🔗')===0)icono(el,'enlace');else if(t.indexOf('📋')===0)icono(el,'perfiles');});
  cada('.hr-empty>.ic,.ck-empty>.ic,.org-empty>.big',function(el){icono(el,tipo,true);});
  cada('.pp-empty,.ev-empty',function(el){var d=el.querySelector(':scope > div:first-child');if(d&&(/^[\s📋📝📊🌐]+$/u.test(d.textContent)||d.querySelector('.op-icon')))icono(d,tipo,true);});
  cada('#qrCkModal>div>div:first-child',function(el){icono(el,'qr');});
  cada('#ckDetOv>div>div:first-child>div:first-child>div:first-child',function(el){icono(el,'cumplimiento');});
  cada('#hrBuscar,#hrAddQ',function(el){if(el.placeholder.indexOf('🔍')===0)el.placeholder=el.placeholder.replace(/^🔍\s*/u,'');});
  var agregar=document.querySelector('[onclick="abrirAgregar()"]');if(agregar)agregar.classList.add('op-primary');
 }
 function pintarMarco(){
  cada('.cf-card[onclick*="abrirTool"]',function(el){var m=(el.getAttribute('onclick')||'').match(/abrirTool\('([^']+)'/),k=m&&paginas[m[1]];if(k){el.classList.add('op-staff-card');icono(el.querySelector('.cf-card-icon'),k,true);}});
  var raiz=document.getElementById('toolModal');if(!raiz)return;
  var archivo=typeof window._tmArchivo==='function'?window._tmArchivo():window._toolBase;
  var k=paginas[archivo];raiz.classList.toggle('op-tool',!!k);
  if(!k){cada('.op-icon',function(el){el.remove();},raiz);return;}
  icono(document.getElementById('tmIcon'),k,true);
  icono(document.getElementById('tmBack'),'volver');icono(document.getElementById('tmClose'),'cerrar');
  cada('.etx-min-btn',function(el){icono(el,'minimizar');},raiz);
 }
 function medirBarra(){var barra=document.querySelector('.org-top');if(barra){var h=Math.ceil(barra.getBoundingClientRect().height)+'px';if(document.body.style.getPropertyValue('--op-org-toolbar-h')!==h)document.body.style.setProperty('--op-org-toolbar-h',h);}}
 function pintar(){pendiente=false;if(typeof window.etaaxIcono!=='function')return;if(tipo)pintarPagina();else pintarMarco();if(tipo==='organigrama')medirBarra();}
 function agendar(){if(!pendiente){pendiente=true;requestAnimationFrame(pintar);}}
 pintar();document.addEventListener('change',agendar);
 new MutationObserver(agendar).observe(document.body,{childList:true,subtree:true,characterData:true});
 if(tipo==='organigrama'&&window.ResizeObserver)new ResizeObserver(medirBarra).observe(document.querySelector('.org-top'));
})();
