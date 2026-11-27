/* Archivo del admin maestro. Se guarda antes de imprimir; las reimpresiones
   usan el HTML/PDF archivado, nunca los precios actuales del catálogo. */
(function(){
'use strict';
var filas=[], cargando=false, busqueda='', tipo='', estado='', desde='', hasta='', mes=hoy().slice(0,7), grupo='';
/* (27-nov, Edwin: «dame una vista previa de los recibos y presupuestos; separa
   presupuestos de recibos, y los recibos de suscripciones de los de servicios
   que no contienen pago de suscripción»). El grupo lo decide el núcleo
   (EtaaxCore.grupoDocumentoAdmin), con la misma vara que el MRR. */
var GRUPOS=[
 {k:'suscripcion',t:'Recibos de suscripción',d:'Traen pago de suscripción (pueden sumar servicios).'},
 {k:'servicio',t:'Recibos de servicios',d:'Solo servicios: no contienen pago de suscripción.'},
 {k:'clasificar',t:'Recibos por clasificar',d:'Falta el importe de suscripción o el primer mes cubierto: sin eso no cuentan en el MRR.'},
 {k:'presupuesto',t:'Presupuestos',d:'No son ingresos hasta convertirse en recibo.'}
];
function grupoDe(d){return (window.EtaaxCore&&EtaaxCore.grupoDocumentoAdmin)?EtaaxCore.grupoDocumentoAdmin(d):(d.tipo==='presupuesto'?'presupuesto':'clasificar');}
var columnas='id,folio,tipo,estado,cliente_negocio_id,cliente,fecha,total,moneda,suscripcion_monto,meses,periodo_desde,fecha_pago,metodo,referencia,origen,presupuesto_id,version,created_at';
/* (v95, 26-nov) Editar con el generador y eliminar. Sin la v95 las columnas de
   «eliminado» no existen: se lee como antes y no se ofrece eliminar. */
var columnasV95=columnas+',eliminado_at,eliminado_motivo', sinV95=false;
function vivo(d){return !d.eliminado_at;}
function e(x){return esc(x==null?'':String(x));}
function hoy(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function id(){return crypto.randomUUID();}
function folio(t){return (t==='recibo'?'REC-':'PRE-')+hoy().replace(/-/g,'')+'-'+id().slice(0,8).toUpperCase();}
function dinero(v){return '$'+Number(v||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});}
function error(r){if(r.error)throw Error(r.error.code==='23505'?'Ese folio o documento de origen ya existe. Búscalo en el historial.':r.error.message);return r.data;}
function registro(r){var d=error(r);d=Array.isArray(d)?d[0]:d;if(!d||!d.id)throw Error('El servidor no confirmó el documento. Vuelve a intentarlo.');return d;}
function mensaje(s){var n=document.getElementById('admDocsAviso');if(n)n.textContent=s;}
function base(){var q=busqueda.toLowerCase().trim();return filas.filter(function(d){return (!q||(d.folio+' '+d.cliente).toLowerCase().includes(q))&&(!tipo||d.tipo===tipo)&&(estado==='eliminado'?!vivo(d):(vivo(d)&&(!estado||d.estado===estado)))&&(!desde||d.fecha>=desde)&&(!hasta||d.fecha<=hasta);});}
function visible(){return base().filter(function(d){return !grupo||grupoDe(d)===grupo;});}
function guardarEnLista(d){var i=filas.findIndex(function(x){return x.id===d.id;});if(i<0)filas.unshift(d);else filas[i]=d;pintar();}
async function cargar(){
 if(cargando)return;cargando=true;mensaje('Cargando histórico…');
 try{var nuevas=[],offset=0;while(true){var r=await _supabase.from('admin_documentos').select(sinV95?columnas:columnasV95).order('fecha',{ascending:false}).order('id',{ascending:false}).range(offset,offset+199);if(r.error&&!sinV95&&/eliminado/.test(r.error.message||'')){sinV95=true;continue;}var chunk=error(r)||[];nuevas=nuevas.concat(chunk);if(chunk.length<200)break;offset+=200;}
 filas=nuevas;mensaje('');pintar();}catch(err){mensaje('No se pudo cargar el histórico: '+err.message);}finally{cargando=false;}
}
function montar(){
 var box=document.getElementById('tab-documentos');if(!box)return;
 if(!box.dataset.iniciado){box.dataset.iniciado='1';box.innerHTML='<div class="adoc-head"><div><h2>Recibos y presupuestos</h2><p>Archivo de documentos y control de cobros de ETAAX.</p></div><div class="adoc-actions"><button onclick="abrirDocumentoModal(\'recibo\',\'\')">Nuevo recibo</button><button onclick="abrirDocumentoModal(\'presupuesto\',\'\')">Nuevo presupuesto</button><button onclick="AdminDocs.importar()">Importar PDF anterior</button><button onclick="AdminDocs.cargar()">Actualizar</button></div></div>'+
 '<div class="adoc-periodo"><label>Resumen del mes <input id="admDocsMes" type="month" value="'+mes+'" onchange="AdminDocs.filtro(\'mes\',this.value)"></label><span>MRR documentado: suscripciones de los meses cubiertos, sin servicios adicionales. Importes según el documento, con IVA cuando se indicó.</span></div><div id="admDocsMetricas" class="adoc-metricas"></div>'+
 '<div id="admDocsGrupos" class="adoc-grupos" role="tablist" aria-label="Grupos de documentos"></div>'+
 '<div class="adoc-filtros"><input aria-label="Buscar folio o cliente" placeholder="Buscar folio o cliente…" oninput="AdminDocs.filtro(\'busqueda\',this.value)"><select aria-label="Estado" onchange="AdminDocs.filtro(\'estado\',this.value)"><option value="">Todos los estados</option><option value="pendiente">Pendientes</option><option value="pagado">Pagados</option><option value="anulado">Anulados</option><option value="eliminado">Eliminados</option></select><label>Desde <input type="date" onchange="AdminDocs.filtro(\'desde\',this.value)"></label><label>Hasta <input type="date" onchange="AdminDocs.filtro(\'hasta\',this.value)"></label><button onclick="AdminDocs.csv()">Exportar CSV</button></div><p id="admDocsAviso" role="status"></p><div id="admDocsTabla" class="adoc-table-wrap"></div>';
 }cargar();
}
function pintar(){
 var met=document.getElementById('admDocsMetricas'),box=document.getElementById('admDocsTabla');if(!met||!box)return;
 var r=EtaaxCore.resumenDocumentosAdmin(filas.filter(vivo),mes);
 met.innerHTML=[['Emitido en el mes',r.emitido],['Cobrado en el mes',r.cobrado],['Pendiente · todos los meses',r.pendiente],['MRR documentado del mes',r.mrr]].map(function(x){return '<div><small>'+x[0]+'</small><strong>'+dinero(x[1])+'</strong></div>';}).join('')+(r.porClasificar?'<p>'+r.porClasificar+' recibo(s) necesitan clasificar suscripción y periodo para el MRR.</p>':'');
 /* Los grupos: una fila de botones (con cuántos hay) y, en «Todos», una tabla
    por grupo con su total; con un grupo elegido, solo su tabla. */
 var todos=base(), cuenta={};todos.forEach(function(d){var g=grupoDe(d);cuenta[g]=(cuenta[g]||0)+1;});
 var gb=document.getElementById('admDocsGrupos');
 if(gb)gb.innerHTML=[{k:'',t:'Todos'}].concat(GRUPOS).filter(function(g){return !g.k||g.k!=='clasificar'||cuenta.clasificar||grupo==='clasificar';}).map(function(g){var n=g.k?(cuenta[g.k]||0):todos.length;
   return '<button type="button" role="tab" class="adoc-grupo-btn'+(grupo===g.k?' on':'')+(g.k==='clasificar'?' aviso':'')+'" aria-selected="'+(grupo===g.k)+'" onclick="AdminDocs.grupo(\''+g.k+'\')">'+e(g.k?g.t.replace('Recibos de ','').replace('Recibos ','').replace(/^./,function(c){return c.toUpperCase();}):g.t)+' <b>'+n+'</b></button>';}).join('');
 box.className='adoc-grupos-wrap';
 var lista=visible();
 if(!lista.length){box.innerHTML='<p class="adoc-vacio">No hay documentos con estos filtros.</p>';return;}
 box.innerHTML=GRUPOS.filter(function(g){return !grupo||grupo===g.k;}).map(function(g){
   var gs=lista.filter(function(d){return grupoDe(d)===g.k;});if(!gs.length)return '';
   var suma=gs.reduce(function(a,d){return a+(d.estado==='anulado'||!vivo(d)?0:Number(d.total||0));},0);
   return '<section class="adoc-grupo adoc-g-'+g.k+'"><header class="adoc-grupo-cab"><div><h3>'+e(g.t)+'</h3><p>'+e(g.d)+'</p></div><span><b>'+gs.length+'</b> '+(gs.length===1?'documento':'documentos')+' · '+dinero(suma)+'</span></header>'+
     '<div class="adoc-table-wrap"><table class="adoc-table"><thead><tr><th>Folio / documento</th><th>Cliente</th><th>Emisión</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>'+gs.map(filaDoc).join('')+'</tbody></table></div></section>';
 }).join('');
}
function detalleGrupo(d){
 var g=grupoDe(d),sus=Number(d.suscripcion_monto||0),tot=Number(d.total||0),m=Math.max(1,parseInt(d.meses,10)||1);
 if(g==='suscripcion')return 'Suscripción '+dinero(sus)+(m>1?' · '+m+' meses':'')+(d.periodo_desde?' desde '+String(d.periodo_desde).slice(0,7):'')+(tot-sus>0.004?' · + servicios '+dinero(tot-sus):'');
 if(g==='servicio')return 'Servicios · sin suscripción';
 if(g==='clasificar')return 'MRR por clasificar';
 return d.presupuesto_id?'':'Presupuesto';
}
function filaDoc(d){var arg=e(JSON.stringify(d.id));
 return '<tr><td><button type="button" class="adoc-folio" title="Vista previa" onclick="AdminDocs.vista('+arg+')">'+e(d.folio)+'</button><small>'+e(d.tipo)+(d.origen!=='generado'?' · recuperado':'')+'</small></td>'+
  '<td>'+e(d.cliente)+'<small'+(grupoDe(d)==='clasificar'?' class="adoc-aviso"':'')+'>'+e(detalleGrupo(d))+'</small></td><td>'+e(d.fecha)+'</td><td>'+dinero(d.total)+'</td>'+
  '<td><span class="adoc-estado '+e(d.estado)+'">'+e(d.estado)+'</span>'+(d.fecha_pago?'<small>Pago: '+e(d.fecha_pago)+'</small>':'')+'</td>'+
  '<td><div class="adoc-actions">'+(vivo(d)?'<button onclick="AdminDocs.vista('+arg+')">Vista previa</button><button onclick="AdminDocs.ver('+arg+')">Editar</button><button onclick="AdminDocs.imprimir('+arg+')">Reimprimir</button>'+(sinV95?'':'<button class="adoc-eliminar" onclick="AdminDocs.eliminar('+arg+')">Eliminar</button>'):'<small class="adoc-motivo">Eliminado'+(d.eliminado_motivo?': '+e(d.eliminado_motivo):'')+'</small><button onclick="AdminDocs.vista('+arg+')">Vista previa</button><button onclick="AdminDocs.restaurar('+arg+')">Restaurar</button>')+'</div></td></tr>';
}
function filtroGrupo(g){grupo=g||'';pintar();}
function filtro(k,v){if(k==='grupo')grupo=v;else if(k==='mes')mes=v;else if(k==='busqueda')busqueda=v;else if(k==='tipo')tipo=v;else if(k==='estado')estado=v;else if(k==='desde')desde=v;else if(k==='hasta')hasta=v;pintar();}
async function obtener(key){return error(await _supabase.from('admin_documentos').select('*').eq('id',key).single());}
function modal(titulo,contenido){var old=document.getElementById('adocModal');if(old)old.remove();var ov=document.createElement('div');ov.id='adocModal';ov.className='adoc-overlay';ov.setAttribute('data-adm-dialog','1');ov.innerHTML='<section class="adoc-modal"><header><h2>'+e(titulo)+'</h2><button data-cerrar>Cerrar</button></header><div class="adoc-body">'+contenido+'</div><p class="adoc-error" role="status"></p></section>';document.body.appendChild(ov);ov.querySelector('[data-cerrar]').onclick=function(){ov.remove();};return ov;}
function bitacora(cambios){return '<ul>'+cambios.map(function(c){var v=c.cambios||{},detalle=c.accion==='creado'?'Documento archivado':c.accion==='recuperado'?'PDF original recuperado':c.accion==='reemitido'?'Editado en el generador'+(c.antes&&c.antes.total!=null?' · antes '+dinero(c.antes.total):''):c.accion==='eliminado'?'Eliminado':c.accion==='restaurado'?'Restaurado':'Datos de control actualizados';if(v.estado)detalle+=' · '+v.estado;if(v.fecha_pago)detalle+=' · pago '+v.fecha_pago;if(v.nota)detalle+=' · '+v.nota;return '<li><small>'+e(new Date(c.fecha).toLocaleString('es-MX'))+'</small><br>'+e(detalle)+'</li>';}).join('')+'</ul>';}
function campo(nombre,html){return '<label class="adoc-campo">'+nombre+html+'</label>';}
function input(k,v,t){return '<input id="adoc-'+k+'" type="'+(t||'text')+'" value="'+e(v)+'">';}
function leer(k){return document.getElementById('adoc-'+k).value;}
function imprimirArchivo(d){
 if(d.pdf_base64){var bytes=Uint8Array.from(atob(d.pdf_base64),function(x){return x.charCodeAt(0);}),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));var a=document.createElement('a');a.href=url;a.download=d.folio+'.pdf';a.click();setTimeout(function(){URL.revokeObjectURL(url);},60000);return;}
 if(!etaaxAbrirReporte(htmlDocumento(d)))throw Error('El documento está guardado. Permite abrir la impresión y vuelve a intentarlo desde el historial.');
}
/* El HTML archivado, con el estado de cobro de HOY (pagado, fecha, método):
   lo usan la reimpresión y la vista previa. */
function htmlDocumento(d){
 var doc=new DOMParser().parseFromString(d.html,'text/html');
 var valores={'estado':d.estado==='pagado'?'Pagado':d.estado==='anulado'?'Anulado':'Pendiente de pago','fecha-pago':d.fecha_pago||'Pendiente','metodo':d.metodo||'—','referencia':d.referencia||'—','total-label':d.estado==='pagado'?'Total pagado':d.estado==='anulado'?'Total anulado':'Total por pagar'};
 Object.keys(valores).forEach(function(k){doc.querySelectorAll('[data-doc-'+k+']').forEach(function(n){n.textContent=valores[k];});});
 return '<!doctype html>'+doc.documentElement.outerHTML;
}
/* LA VISTA PREVIA (27-nov): el documento tal cual se imprimiría, en una ventana
   del panel —sin abrir otra pestaña ni el diálogo de impresión—. El HTML va en un
   iframe con `sandbox` (no corre nada de lo que traiga); el PDF recuperado se
   incrusta en computadora y en tableta/teléfono se descarga (ahí el navegador no
   pinta un PDF dentro de una página). */
async function vistaPrevia(key){
 var d;try{d=await obtener(key);}catch(err){admAlert(err.message);return;}
 var old=document.getElementById('adocVista');if(old)old.remove();
 var url=null,cuerpo,pdfAqui=window.matchMedia&&window.matchMedia('(pointer:fine)').matches&&window.innerWidth>900;
 if(d.pdf_base64){var bytes=Uint8Array.from(atob(d.pdf_base64),function(x){return x.charCodeAt(0);});url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  cuerpo=pdfAqui?'<iframe class="adoc-vista-frame" src="'+url+'#view=FitH" title="'+e(d.folio)+'"></iframe>':'<div class="adoc-vista-pdf"><p>Es el PDF original archivado.</p><a class="adoc-vista-btn" href="'+url+'" download="'+e(d.folio)+'.pdf">Descargar PDF</a></div>';}
 else if(d.html)cuerpo='<iframe class="adoc-vista-frame" sandbox title="'+e(d.folio)+'"></iframe>';
 else cuerpo='<p class="adoc-vacio">Este documento no tiene archivo guardado.</p>';
 var g=GRUPOS.find(function(x){return x.k===grupoDe(d);})||{t:d.tipo};
 var ov=document.createElement('div');ov.id='adocVista';ov.className='adoc-overlay';ov.setAttribute('data-adm-dialog','1');
 ov.innerHTML='<section class="adoc-modal adoc-vista" role="dialog" aria-label="Vista previa '+e(d.folio)+'"><header><div><h2>'+e(d.folio)+'</h2><small>'+e(g.t)+' · '+e(d.cliente)+' · '+dinero(d.total)+' · '+e(d.estado)+'</small></div>'+
  '<div class="adoc-actions">'+(vivo(d)?'<button data-acc="editar">Editar</button>':'')+'<button data-acc="imprimir">Reimprimir</button><button data-cerrar>Cerrar</button></div></header><div class="adoc-vista-cuerpo">'+cuerpo+'</div></section>';
 document.body.appendChild(ov);
 var fr=ov.querySelector('iframe[sandbox]');if(fr)fr.srcdoc=htmlDocumento(d);
 var cerrar=function(){ov.remove();if(url)setTimeout(function(){URL.revokeObjectURL(url);},1000);};
 ov.querySelector('[data-cerrar]').onclick=cerrar;
 ov.onclick=function(ev){if(ev.target===ov)cerrar();};
 var bi=ov.querySelector('[data-acc="imprimir"]');if(bi)bi.onclick=function(){try{imprimirArchivo(d);}catch(err){admAlert(err.message);}};
 var be=ov.querySelector('[data-acc="editar"]');if(be)be.onclick=function(){cerrar();ver(d.id);};
}
async function imprimir(key){try{imprimirArchivo(await obtener(key));}catch(err){admAlert(err.message);}}
async function crear(cfg,html,key){
 var d={id:key||id(),folio:cfg.folio,tipo:cfg.tipo,estado:cfg.tipo==='presupuesto'?'pendiente':(cfg.estado||'pendiente'),cliente_negocio_id:cfg.negocioId||null,cliente:cfg.razonRec||cfg.cliente||cfg.negocio||'',fecha:cfg.fecha,total:cfg.total,
 suscripcion_monto:cfg.recurrenteMonto===undefined?EtaaxCore.montoRecurrenteDocumento(cfg):cfg.recurrenteMonto,meses:cfg.meses||1,periodo_desde:cfg.periodoDesde||cfg.fecha.slice(0,7)+'-01',fecha_pago:cfg.estado==='pagado'?cfg.fpago:null,metodo:cfg.metodo||'',referencia:cfg.ref||'',datos:cfg,html:html,presupuesto_id:cfg.presupuestoId||null};
 var saved=registro(await _supabase.rpc('admin_documento_crear',{p_documento:d}));guardarEnLista(saved);return saved;
}
/* EDITAR = el MISMO generador con el que se hizo (Edwin, 26-nov), lleno con
   lo guardado. Solo los documentos generados traen con qué rearmarse; un PDF
   recuperado sigue con su ventanita de estado y clasificación. */
function editable(d){return !!(d&&d.origen==='generado'&&d.datos&&d.datos.tipo&&vivo(d)&&!sinV95&&typeof window.abrirDocumentoModal==='function');}
async function ver(key){
 try{var d=await obtener(key);if(editable(d)){window.abrirDocumentoModal(d.tipo,d.cliente_negocio_id||'',d);return;}
 var ov=modal(d.folio,'<p><b>'+e(d.cliente)+'</b> · '+e(d.tipo)+' · '+dinero(d.total)+'</p>'+(d.datos&&d.datos.recuperacionNota?'<p>'+e(d.datos.recuperacionNota)+'</p>':'')+
 '<div class="adoc-grid">'+campo('Estado','<select id="adoc-estado">'+['pendiente','pagado','anulado'].filter(function(x){return d.tipo==='recibo'||x!=='pagado';}).map(function(x){return '<option'+(x===d.estado?' selected':'')+'>'+x+'</option>';}).join('')+'</select>')+campo('Fecha de pago',input('pago',d.fecha_pago||hoy(),'date'))+campo('Método de pago',input('metodo',d.metodo))+campo('Referencia',input('ref',d.referencia))+'</div>'+
 '<h3>Suscripción para MRR</h3><p>Importe de suscripción incluido en este documento. Usa 0 para servicios sin suscripción; vacío significa por clasificar.</p><div class="adoc-grid">'+campo('Importe de suscripción (MXN)',input('recurrente',d.suscripcion_monto,'number'))+campo('Meses cubiertos',input('meses',d.meses,'number'))+campo('Primer mes cubierto',input('periodo',(d.periodo_desde||'').slice(0,7),'month'))+'</div>'+campo('Nota de control / motivo de anulación',input('nota',''))+
 '<div class="adoc-actions"><button id="adoc-guardar">Guardar cambios</button><button id="adoc-print">'+(d.pdf_base64?'Descargar PDF original':'Reimprimir')+'</button>'+(d.tipo==='presupuesto'&&d.estado!=='anulado'&&d.origen==='generado'?'<button id="adoc-convertir">Generar recibo</button>':'')+(sinV95||!vivo(d)?'':'<button id="adoc-eliminar" class="adoc-eliminar">Eliminar</button>')+'</div><details><summary>Historial de cambios</summary>'+bitacora(d.cambios||[])+'</details>');
 ov.querySelector('#adoc-print').onclick=function(){imprimirArchivo(d);};
 ov.querySelector('#adoc-guardar').onclick=async function(){var btn=this;btn.disabled=true;try{var c={estado:leer('estado'),fecha_pago:leer('pago'),metodo:leer('metodo'),referencia:leer('ref'),suscripcion_monto:leer('recurrente')===''?null:Number(leer('recurrente')),meses:Number(leer('meses')),periodo_desde:leer('periodo')?leer('periodo')+'-01':null,nota:leer('nota')};var saved=registro(await _supabase.rpc('admin_documento_actualizar',{p_id:d.id,p_version:d.version,p_cambios:c}));guardarEnLista(saved);ov.remove();}catch(err){ov.querySelector('.adoc-error').textContent=err.message;btn.disabled=false;}};
 var conv=ov.querySelector('#adoc-convertir');if(conv)conv.onclick=async function(){conv.disabled=true;try{var saved=await convertir(d);ov.remove();await ver(saved.id);}catch(err){ov.querySelector('.adoc-error').textContent=err.message;conv.disabled=false;}};
 var del=ov.querySelector('#adoc-eliminar');if(del)del.onclick=function(){ov.remove();eliminar(d.id);};
 }catch(err){admAlert(err.message);}
}
/* Un presupuesto se vuelve recibo (el recibo nuevo nombra a su presupuesto). */
async function convertir(d){var cfg=Object.assign({},d.datos,{tipo:'recibo',folio:folio('recibo'),fecha:hoy(),estado:'pendiente',fpago:'',negocioId:d.cliente_negocio_id,cliente:d.cliente,total:Number(d.total),meses:d.meses,periodoDesde:d.periodo_desde,recurrenteMonto:d.suscripcion_monto,presupuestoId:d.id});var html=construirDocumentoHTML(cfg);return await crear(cfg,html);}
/* Guardar lo editado en el generador: el MISMO documento y folio, versión
   nueva y la bitácora con el «antes» (v95). */
async function reemitir(d,cfg,html){
 var doc={tipo:d.tipo,cliente_negocio_id:cfg.negocioId||null,cliente:cfg.razonRec||cfg.cliente||cfg.negocio||'',fecha:cfg.fecha,total:cfg.total,
  suscripcion_monto:cfg.recurrenteMonto===undefined?EtaaxCore.montoRecurrenteDocumento(cfg):cfg.recurrenteMonto,meses:cfg.meses||1,periodo_desde:cfg.periodoDesde||cfg.fecha.slice(0,7)+'-01',
  estado:d.tipo==='presupuesto'?(cfg.estado==='anulado'?'anulado':'pendiente'):(cfg.estado||'pendiente'),fecha_pago:cfg.estado==='pagado'?cfg.fpago:null,metodo:cfg.metodo||'',referencia:cfg.ref||'',nota:cfg.nota||'',datos:cfg,html:html};
 var saved=registro(await _supabase.rpc('admin_documento_reemitir',{p_id:d.id,p_version:d.version,p_documento:doc}));guardarEnLista(saved);return saved;
}
/* Eliminar: se pide el motivo; el documento sale de la lista y de los totales,
   queda en la bitácora y se puede restaurar (filtro «Eliminados»). */
async function eliminar(key){
 try{var d=await obtener(key);
 var ov=modal('Eliminar '+d.folio,'<p><b>'+e(d.cliente)+'</b> · '+e(d.tipo)+' · '+dinero(d.total)+'</p><p>Sale del historial y de los totales del mes. No se borra: queda en la bitácora y se puede restaurar desde el filtro «Eliminados».</p>'+
  campo('Motivo',input('motivo',''))+'<div class="adoc-actions"><button id="adoc-confirmar" class="adoc-eliminar">Eliminar '+e(d.tipo)+'</button></div>');
 var m=document.getElementById('adoc-motivo');if(m)setTimeout(function(){m.focus();},40);
 ov.querySelector('#adoc-confirmar').onclick=async function(){var btn=this,mot=leer('motivo').trim();if(!mot){ov.querySelector('.adoc-error').textContent='Escribe por qué se elimina.';return;}btn.disabled=true;
  try{var saved=registro(await _supabase.rpc('admin_documento_eliminar',{p_id:d.id,p_version:d.version,p_motivo:mot}));guardarEnLista(saved);ov.remove();var g=document.getElementById('docOv');if(g)g.remove();}catch(err){ov.querySelector('.adoc-error').textContent=err.message;btn.disabled=false;}};
 }catch(err){admAlert(err.message);}
}
async function restaurar(key){try{var d=await obtener(key);var saved=registro(await _supabase.rpc('admin_documento_restaurar',{p_id:d.id,p_version:d.version}));guardarEnLista(saved);}catch(err){admAlert(err.message);}}
function bitacoraHTML(d){return bitacora((d&&d.cambios)||[]);}
async function importar(){
 var ov=modal('Archivar un PDF anterior','<p>Conserva el documento original. Captura sus datos tal como aparecen en el PDF.</p>'+campo('PDF original','<input id="adoc-archivo" type="file" accept="application/pdf">')+'<div class="adoc-grid">'+campo('Tipo','<select id="adoc-tipo"><option value="recibo">Recibo</option><option value="presupuesto">Presupuesto</option></select>')+campo('Folio original (vacío si no tiene)',input('folio',''))+campo('Cliente',input('cliente',''))+campo('Fecha de emisión',input('fecha',hoy(),'date'))+campo('Importe total (MXN)',input('total','','number'))+campo('Estado','<select id="adoc-estado"><option value="pendiente">Pendiente</option><option value="pagado">Pagado</option></select>')+campo('Fecha de pago',input('pago',hoy(),'date'))+'</div><p>La clasificación para MRR se puede completar después desde el historial.</p><button id="adoc-importar">Guardar PDF en el histórico</button>');
 var key=id();ov.querySelector('#adoc-importar').onclick=async function(){var btn=this;btn.disabled=true;try{var f=document.getElementById('adoc-archivo').files[0];if(!f||f.size>10*1024*1024)throw Error('Selecciona un PDF de hasta 10 MB.');var bytes=new Uint8Array(await f.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('El archivo no es un PDF válido.');
 var base64=await new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(r.result.split(',')[1]);};r.onerror=reject;r.readAsDataURL(f);});
 var sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(function(x){return x.toString(16).padStart(2,'0');}).join('');
 var t=leer('tipo'),fo=leer('folio').trim().toUpperCase(),est=t==='presupuesto'?'pendiente':leer('estado');var d={id:key,folio:fo||'ARCH-'+sha.slice(0,12).toUpperCase(),tipo:t,estado:est,cliente:leer('cliente').trim(),fecha:leer('fecha'),total:Number(leer('total')),suscripcion_monto:null,meses:1,fecha_pago:est==='pagado'?leer('pago'):null,origen:'pdf_recuperado',origen_clave:'pdf:'+sha,pdf_base64:base64,datos:{archivo:f.name,recuperacionNota:fo?'PDF original importado. Clasificar suscripción y periodo para MRR.':'Original sin folio. El folio ARCH identifica su archivo; no se modificó el PDF.'}};
 var saved=registro(await _supabase.rpc('admin_documento_crear',{p_documento:d}));guardarEnLista(saved);ov.remove();}catch(err){ov.querySelector('.adoc-error').textContent=err.message;btn.disabled=false;}};
}
function csv(){var rows=[['Folio','Tipo','Grupo','Estado','Cliente','Fecha emisión','Fecha pago','Total MXN','Suscripción MXN','Meses','Primer mes','Origen']].concat(visible().map(function(d){return[d.folio,d.tipo,(GRUPOS.find(function(x){return x.k===grupoDe(d);})||{t:''}).t,d.estado,d.cliente,d.fecha,d.fecha_pago,d.total,d.suscripcion_monto,d.meses,d.periodo_desde,d.origen];}));var txt=rows.map(function(row){return row.map(function(v){var s=String(v==null?'':v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');var url=URL.createObjectURL(new Blob(['\uFEFF'+txt],{type:'text/csv;charset=utf-8'}));var a=document.createElement('a');a.href=url;a.download='ETAAX-historico-'+hoy()+'.csv';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}
window.AdminDocs={montar:montar,vista:vistaPrevia,grupo:filtroGrupo,htmlDocumento:htmlDocumento,cargar:cargar,filtro:filtro,ver:ver,imprimir:imprimir,crear:crear,imprimirArchivo:imprimirArchivo,importar:importar,csv:csv,folio:folio,hoy:hoy,
 reemitir:reemitir,eliminar:eliminar,restaurar:restaurar,convertir:convertir,bitacoraHTML:bitacoraHTML,editable:editable};
})();
