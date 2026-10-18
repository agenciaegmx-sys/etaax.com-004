/* Navegador real + servidor local + Supabase simulado. Ninguna petición de la
   página puede salir del origen de prueba. Ejecutar con node; CHROME_BIN permite
   elegir Chromium en otros equipos. Los perfiles y capturas viven en /tmp. */
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, socket, closing = false, next = 0;
const pending = new Map(), results = [], forbidden = [];
function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP sin respuesta: ' + method)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}
async function evalPage(sid, expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
}
async function until(sid, expression) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
        try { if (await evalPage(sid, expression)) return; }
        catch(e) { if (!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(e.message)) throw e; }
        await pause(30);
    }
    console.log(await evalPage(sid,`JSON.stringify({url:location.href,errors:window.__errors,calls:window.__calls,body:document.body.innerText.slice(-2400),scope:typeof _sucSel==='undefined'?'':_sucSel})`));
    throw new Error('No se cumplió: ' + expression);
}
async function go(p, expression, condition) {
    const generation=await evalPage(p.sid,'window.__fixtureGeneration');
    /* La acción navega de verdad: se responde al CDP antes de destruir el
       contexto y se exige un documento NUEVO, no el DOM que aún sale de escena. */
    await evalPage(p.sid,'setTimeout(function(){'+expression+'},25)');
    await until(p.sid,'window.__fixtureGeneration>'+generation+' && ('+condition+')');
}

function sdkFixture() {
 const user={id:'u1',email:'ana@fixture.invalid',user_metadata:{nombre:'Ana González'}};
 const docs=['organigrama','negocio_sucursales'];window.__calls=[];
 function query(table){
  const filters={},q={isSingle:false,select(){return q;},eq(k,v){filters[k]=v;return q;},neq(){return q;},in(){return q;},not(){return q;},or(){return q;},order(){return q;},limit(){return q;},range(){return q;},maybeSingle(){q.isSingle=true;return q;},single(){q.isSingle=true;return q;},delete(){q.del=true;return q;},update(value){q.value=value;return q;},insert(value){q.value=value;return q;},upsert(value){q.value=value;return q;},then(resolve,reject){
   window.__calls.push({table,filters:{...filters},value:q.value,del:q.del});
   const db=JSON.parse(sessionStorage.getItem('__db')||'{}');let rows=db[table]||[];
   if(q.value){
    for(const row of Array.isArray(q.value)?q.value:[q.value]){
     const id=row.id||filters.id||row.negocio_id||filters.negocio_id;
     const pos=rows.findIndex(x=>(x.id||x.negocio_id)===id);
     const value={...row,...(!row.id&&filters.id?{id:filters.id}:{})};
     if(pos>=0)rows[pos]={...rows[pos],...value};else rows.push(value);
    }
    db[table]=rows;sessionStorage.setItem('__db',JSON.stringify(db));
   }else if(q.del){rows=rows.filter(x=>!Object.entries(filters).every(([k,v])=>x[k]===v));db[table]=rows;sessionStorage.setItem('__db',JSON.stringify(db));}
   let data=rows.filter(x=>Object.entries(filters).every(([k,v])=>x[k]===v));
   if(table==='suscripciones')data=[{estado:'activa',proximo_cobro:'2026-11-13',dias_tolerancia:3}];
   if(table==='usuarios')data=[{id:'u1',nombre:'Ana González',plan:'pyme'}];
   if(q.isSingle)data=data[0]||null;
   return Promise.resolve({data,error:null}).then(resolve,reject);
  }};return q;
 }
 window.supabase={createClient(){return {auth:{getUser:async()=>({data:{user},error:null}),getSession:async()=>({data:{session:{user}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null}),signInWithPassword:async()=>({data:{user},error:null})},from:query,
 rpc:async(name)=>({data:name==='negocio_cobro_estado'?{activo:true,estado:'activa',proximoCobro:'2026-11-13',diasRestantes:34}:name==='entrada_token_asegurar'?'token-fixture':null,error:null}),
 channel(){return{on(){return this;},subscribe(){return this;},send:async()=>{},unsubscribe(){}};},removeChannel:async()=>{},storage:{from(){return{remove:async()=>({error:null}),createSignedUrls:async()=>({data:[],error:null})}}}}}};
}
const empleados=[{id:'col1',nombre:'Ana González',puesto:'Gerente',rol:'gerente',estado:'Activo',sucursalId:'suc_principal',activo:true},{id:'col2',nombre:'José de prueba',puesto:'Barman',rol:'barman',estado:'Activo',sucursalId:'suc_principal',activo:true},{id:'col3',nombre:'Luis Norte',puesto:'Cocinero',rol:'cocinero',estado:'Activo',sucursalId:'norte',activo:true}];
const perfil={id:'pp1',puesto:'Gerente de restaurante',general:{empresa:'Café de prueba',sucursal:'Centro',horario:'09:00–17:00',prestaciones:['Prestaciones de ley']},competencias:{educacion:['Licenciatura'],habilidades:['Organización','Comunicación'],estandares:['Higiene']},salud:{edadMin:'18',edadMax:'65',items:[{t:'Condición',d:'Trabajo de pie'}]},funciones:{proposito:['Coordinar el servicio'],contexto:[],responsabilidades:[{t:'Apertura',d:'Supervisar al equipo'}]}};
const plantilla={id:'ck1',nombre:'Apertura de barra',tipo:'apertura',area:'Barra',sucursalId:'suc_principal',activo:true,tareas:[{id:'t1',texto:'Limpiar y desinfectar la estación',txt:'Limpiar y desinfectar la estación',freq:'A'},{id:'t2',texto:'Verificar temperaturas y existencias',txt:'Verificar temperaturas y existencias',freq:'D/T'},{id:'t3',texto:'Revisar equipo de refrigeración',txt:'Revisar equipo de refrigeración',freq:'SEM',dia:1}]};
const evaluacion={id:'ev1',titulo:'Servicio y operación',categoria:'operativas',descripcion:'Evaluación del equipo de servicio',sucursalId:'suc_principal',activa:true,token:'visual-token',secciones:[{id:'sec1',nombre:'Servicio'}],preguntas:[{id:'q1',texto:'¿Cómo recibes al cliente?',tipo:'opcion',seccionId:'sec1',requerida:true,opciones:[{texto:'Saludar y ofrecer ayuda',valor:10},{texto:'Esperar',valor:0}]},{id:'q2',texto:'Explica el protocolo de cierre.',tipo:'texto',requerida:false}]};
const initialDB={negocios:[{id:'n1',usuario_id:'u1',datos:{nombre:'Café de prueba',tipo:'cafe',organizacion:'corporativo',color:'#3dbe7a'}}],negocio_sucursales:[{negocio_id:'n1',datos:{sucursales:[{id:'suc_principal',nombre:'Centro',activa:true},{id:'norte',nombre:'Norte',activa:true}],cfg:{}}}],staff:empleados.map(datos=>({id:datos.id,negocio_id:'n1',datos})),checklists:[{id:'ck1',negocio_id:'n1',datos:plantilla}],checklist_ejecuciones:[{id:'ce1',negocio_id:'n1',datos:{id:'ce1',plantillaId:'ck1',plantillaNombre:'Apertura de barra',colaborador:'José de prueba',sucursalId:'suc_principal',tipo:'apertura',area:'Barra',fecha:'2026-10-18',horaInicio:'08:00',hora:'08:10',duracionMin:10,pct:100,cumplidas:3,marcas:{t1:'ok',t2:'ok',t3:'ok'},notas:'Todo listo para abrir'}}],organigrama:[{negocio_id:'n1',datos:{nodos:[{id:'nd1',puesto:'Gerente',nombre:'Ana González',perfilId:'pp1',x:0,y:0,color:'#3dbe7a'},{id:'nd2',puesto:'Barra',nombre:'José de prueba',x:250,y:160,color:'#7ab8f5'}],conexiones:[{from:'nd1',to:'nd2'}]}}],perfiles_puesto:[{id:'pp1',negocio_id:'n1',datos:perfil}],evaluaciones:[{id:'ev1',negocio_id:'n1',datos:evaluacion}],evaluacion_respuestas:[{id:'r1',negocio_id:'n1',datos:{id:'r1',evaluacionId:'ev1',respondente:{nombre:'José de prueba',puesto:'Barman'},recibidoEn:'2026-10-18T09:00:00',scorePct:100,score:10,scoreMax:10,respuestas:[{preguntaId:'q1',texto:'¿Cómo recibes al cliente?',respuesta:'Saludar y ofrecer ayuda',puntos:10}]}}],catalogo_perfiles:[{id:'catp1',datos:{...perfil,id:'catp1',puesto:'Chef de cocina'}}],catalogo_evaluaciones:[{id:'cate1',datos:{...evaluacion,id:'cate1',titulo:'Evaluación de cocina'}}]};
async function page(base,route,width=1440,light=false){
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId:sid}=await send('Target.attachToTarget',{targetId,flatten:true});
 await send('Page.enable',{},sid);await send('Fetch.enable',{patterns:[{urlPattern:'*'}]},sid);
 await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<720},sid);
 const init=`window.__errors=[];window.addEventListener('error',e=>{if(e.message)window.__errors.push(e.message)});window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason?.stack||e.reason)));
 if(!sessionStorage.getItem('__seed')){localStorage.clear();sessionStorage.clear();sessionStorage.setItem('__seed','1');sessionStorage.setItem('__db',${JSON.stringify(JSON.stringify(initialDB))});localStorage.setItem('etaax_negocio_activo','n1');localStorage.setItem('etaax_sucursal_activa','suc_principal');localStorage.setItem('etaax_ctx',JSON.stringify({ctxType:'owner',userName:'Ana González',negId:'n1',negNombre:'Café de prueba'}));localStorage.setItem('etaax_qses',JSON.stringify({usuarioId:'u1',nombre:'Ana González',email:'ana@fixture.invalid',plan:'pyme',ts:Date.now()}));localStorage.setItem('etaax_negocios',JSON.stringify([{id:'n1',usuarioId:'u1',nombre:'Café de prueba',tipo:'cafe',organizacion:'corporativo'}]));localStorage.setItem('etaax_n1_staff',${JSON.stringify(JSON.stringify(empleados))});localStorage.setItem('etaax_n1_sucursales',JSON.stringify([{id:'suc_principal',nombre:'Centro',activa:true},{id:'norte',nombre:'Norte',activa:true}]));localStorage.setItem('etaax_theme',${JSON.stringify(light?'light':'dark')});}
 window.__fixtureGeneration=Number(sessionStorage.getItem('__gen')||0)+1;sessionStorage.setItem('__gen',String(window.__fixtureGeneration));
 window.QRCode=function(el){el.innerHTML='<svg width="210" height="210" viewBox="0 0 21 21"><path fill="black" d="M0 0h7v7H0zM14 0h7v7h-7zM0 14h7v7H0z"/></svg>'};`;
 await send('Page.addScriptToEvaluateOnNewDocument',{source:init},sid);await send('Page.navigate',{url:base+route},sid);
 await until(sid,"document.body && typeof etaaxIcono==='function' && (document.body.classList.contains('etx-op-page') || typeof abrirTool==='function')");
 await evalPage(sid,"document.getElementById('etaaxNovOk')?.click();document.fonts.ready");return {sid,targetId};
}
async function close(p){await send('Target.closeTarget',{targetId:p.targetId});}
async function check(name,fn){await fn();results.push(name);console.log('PASA '+name);}
async function shot(p,name){await pause(140);const s=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(__dirname,name+'.png'),Buffer.from(s.data,'base64'));}
async function bounded(p,selector){
 assert.ok(await evalPage(p.sid,'document.documentElement.scrollWidth<=innerWidth+1'),'sin desborde exterior');
 const bad=await evalPage(p.sid,`Array.from(document.querySelectorAll(${JSON.stringify(selector||':not(*)')})).filter(x=>x.getClientRects().length).filter(x=>{const r=x.getBoundingClientRect();return r.width>innerWidth||r.right>innerWidth+1||r.left< -1}).map(x=>({id:x.id,cls:x.className,w:x.getBoundingClientRect().width,right:x.getBoundingClientRect().right}))`);assert.deepEqual(bad,[],'controles dentro de pantalla');
}

async function run(base){
 for(const width of (process.env.OP_WIDTH?[Number(process.env.OP_WIDTH)]:[1440,768,390,320])){
  for(const tool of ['horarios','checklists','organigrama','perfiles-puesto','evaluaciones'].filter(t=>!process.env.OP_TOOL||t===process.env.OP_TOOL)){
   const p=await page(base,'/administrativo/'+tool+'.html?embed=1',width);
   await check(tool+' · '+width,async()=>{
    if(tool==='horarios'){
     await until(p.sid,"typeof abrirEditor==='function' && _cargaLista && document.querySelector('.hr-person,.hr-card')");
     await evalPage(p.sid,"abrirEditor('col1',0);hrmIn.value='09:00';hrmOut.value='17:00'");
     await until(p.sid,"document.querySelector('#hrmTitle .op-icon')");
     if(width===1440||width===390)await shot(p,'horarios-turno-'+width);
     await bounded(p,'#hrModal input,#hrModal button');
     await evalPage(p.sid,"editorGuardar();marcarAsistencia('col1',0,'si');marcarRetardo('col1',0)");
     await until(p.sid,"document.querySelector('.hr-asis .op-icon')");
     assert.deepEqual(await evalPage(p.sid,"[curRecord().turnos.col1.d0.in,curRecord().turnos.col1.d0.asis,curRecord().turnos.col1.d0.ret]"),['09:00','si',true]);
     await evalPage(p.sid,"setVista('cards')");await pause(50);await bounded(p,'.hr-toolbar button,.hr-toolbar input,.hr-card');
     await evalPage(p.sid,"abrirPDF()");await pause(60);await bounded(p,'#hrPdfModal button');
     if(width===1440)await shot(p,'horarios-impresion');
     await evalPage(p.sid,"cerrarPDF()");
    }else if(tool==='checklists'){
     await until(p.sid,"typeof editarPlantilla==='function' && document.querySelector('.ck-card .op-icon')");
     await evalPage(p.sid,"editarPlantilla('ck1')");await until(p.sid,"document.querySelector('#ckModal .op-icon') && ckModal.classList.contains('on')");
     await bounded(p,'#ckModal input,#ckModal select,#ckModal button');
     if(width===1440||width===390)await shot(p,'checklists-editor-'+width);
     await evalPage(p.sid,"ckmNombre.value='Apertura actualizada';document.querySelector('#ckmTareas input').value='Estación lista';document.querySelector('#ckmTareas input').dispatchEvent(new Event('input',{bubbles:true}));guardarPlantilla();abrirEjecDe('ck1');ciclarCelda('t1',0);setFirma(0,'Ana')");
     assert.deepEqual(await evalPage(p.sid,"[curRun().marcas.t1.d0,curRun().firmas.d0,_plantillas.find(p=>p.id==='ck1').nombre]"),['ok','Ana','Apertura actualizada']);
     await pause(60);await bounded(p,'.ck-toolbar button,.ck-toolbar select');
     if(width===1440)await shot(p,'checklists-ejecucion');
     await evalPage(p.sid,"setTab('cumpl');verEjecucion('ce1')");await pause(60);await bounded(p,'#ckDetOv button');
     if(width===390)await shot(p,'checklists-detalle');
     await evalPage(p.sid,"document.getElementById('ckDetOv').remove();setTab('plant');abrirImprimir('ck1')");await pause(50);await bounded(p,'#ckPrintModal input,#ckPrintModal button');
     if(width===1440)await shot(p,'checklists-impresion');
     await evalPage(p.sid,"cerrarImprimir();abrirQrChecklist()");await until(p.sid,"qrCkUrl.textContent.includes('token-fixture')");await bounded(p,'#qrCkModal button');
     if(width===390)await shot(p,'checklists-qr');
     await evalPage(p.sid,"qrCkModal.style.display='none'");
    }else if(tool==='organigrama'){
     await until(p.sid,"typeof abrirModal==='function' && document.querySelectorAll('.org-node').length===2 && document.querySelector('#links path')");
     assert.equal(await evalPage(p.sid,"document.querySelector('.org-node').offsetWidth"),188);
     await bounded(p,'.org-top button');
     await until(p.sid,"document.getElementById('viewport').getBoundingClientRect().top>=document.querySelector('.org-top').getBoundingClientRect().bottom-1");
     await evalPage(p.sid,"abrirModal('nd1')");await until(p.sid,"document.querySelector('#nmTitle .op-icon')");await bounded(p,'#nodeOv input,#nodeOv select,#nodeOv button,#nodeOv textarea');
     if(width===1440||width===390)await shot(p,'organigrama-editor-'+width);
     await evalPage(p.sid,"nmPuesto.value='Gerencia general';guardarNodo();zoomBtn(1.2);resetVista(true);toggleDisconnect();_disconnectClick('nd1');_disconnectClick('nd2');toggleDisconnect();toggleConnect();_connectClick('nd1');_connectClick('nd2');toggleConnect()");
     assert.equal(await evalPage(p.sid,"_conex.length"),1);assert.equal(await evalPage(p.sid,"_nodos[0].puesto"),'Gerencia general');
     await pause(800);
     assert.equal(await evalPage(p.sid,"JSON.parse(sessionStorage.__db).organigrama[0].datos.nodos[0].puesto"),'Gerencia general');
    }else if(tool==='perfiles-puesto'){
     await until(p.sid,"typeof editarPerfil==='function' && document.querySelector('.pp-card .op-icon')");
     await evalPage(p.sid,"editarPerfil('pp1')");await pause(80);await bounded(p,'.pp-field input,.pp-field textarea,#viewEditor button');
     if(width===1440||width===390)await shot(p,'perfiles-editor-'+width);
     await evalPage(p.sid,"fPuesto.value='Gerencia actualizada';guardarPerfil()");await until(p.sid,"docPreview.textContent.includes('Gerencia actualizada')");
     await bounded(p,'.pp-doc');if(width===1440||width===390)await shot(p,'perfiles-ficha-'+width);
     await evalPage(p.sid,"verLista();abrirPerfilesEtaax()");await until(p.sid,"document.querySelector('.cate-add .op-icon')");await bounded(p,'.cate-box,.cate-add');
     if(width===390)await shot(p,'perfiles-catalogo');
     await evalPage(p.sid,"document.querySelector('.cate-cerrar').click()");
    }else{
     await until(p.sid,"typeof editarEval==='function' && document.querySelector('.ev-card .op-icon')");
     await evalPage(p.sid,"editarEval('ev1')");await pause(100);await bounded(p,'#viewEditor input,#viewEditor select,#viewEditor textarea,#viewEditor button');
     if(width===1440||width===390)await shot(p,'evaluaciones-editor-'+width);
     await evalPage(p.sid,"edTitulo.value='Servicio actualizado';agregarSeccion();agregarPregunta();guardarEval()");
     await until(p.sid,"getComputedStyle(viewEditor).display==='none'");
     assert.equal(await evalPage(p.sid,"_evals.find(e=>e.id==='ev1').preguntas.length"),3);
     await evalPage(p.sid,"compartir('ev1')");await pause(50);await bounded(p,'#shareOverlay input,#shareOverlay button');
     if(width===390)await shot(p,'evaluaciones-compartir');
     await evalPage(p.sid,"cerrarShare();verResultados('ev1')");await until(p.sid,"document.querySelector('.res-card .op-icon')");
     await bounded(p,'.res-card,.res-stat');await evalPage(p.sid,"document.querySelector('.res-card-top').click()");
     assert.equal(await evalPage(p.sid,"document.querySelector('.res-score').textContent.includes('100%')"),true);
     if(width===1440||width===390)await shot(p,'evaluaciones-resultados-'+width);
     await evalPage(p.sid,"cerrarResultados()");
    }
    await pause(100);await bounded(p,'');
    assert.deepEqual(await evalPage(p.sid,'window.__errors'),[]);
    assert.equal(await evalPage(p.sid,"document.getElementById('etaax-header')?getComputedStyle(document.getElementById('etaax-header')).display:'none'"),'none');
    if(width===1440||width===390)await shot(p,tool+'-'+width);
   });await close(p);
  }
 }
 for(const width of (process.env.OP_MAIN_ONLY?[]:[1440,390])){
  const p=await page(base,'/administrativo/staff-hub.html',width);
  await until(p.sid,"typeof abrirTool==='function' && document.querySelectorAll('.op-staff-card .op-icon').length===5");
  for(const [file,name] of [['horarios.html','Horarios Operativos'],['checklists.html','Checklists Operativos'],['organigrama.html','Organigrama'],['perfiles-puesto.html','Perfiles de Puesto'],['evaluaciones.html','Evaluaciones']]){
   await check('Flotante '+file+' · '+width,async()=>{
    await evalPage(p.sid,`abrirTool(${JSON.stringify(file)},${JSON.stringify(name)},'')`);
    await until(p.sid,`tmFrame.contentWindow.location.pathname.endsWith(${JSON.stringify(file)}) && tmFrame.contentWindow.document.readyState==='complete' && toolModal.classList.contains('op-tool') && tmFrame.contentWindow.document.body?.classList.contains('etx-op-page') && tmFrame.contentWindow.document.querySelector('.op-title-icon .op-icon') && document.querySelector('#toolModal .etx-min-btn .op-icon')`);
    await pause(100);
    assert.ok(await evalPage(p.sid,"tmFrame.contentWindow.document.documentElement.scrollWidth<=tmFrame.contentWindow.innerWidth+1"));
    assert.ok(await evalPage(p.sid,"(()=>{var d=tmFrame.contentWindow.document;return Array.from(d.querySelectorAll('#etaax-header,.top-bar,#ctxBar,nav.nav')).every(el=>getComputedStyle(el).display==='none')})()"));
    await bounded(p,'#tmClose,#toolModal .etx-min-btn');
    if(width===1440)await shot(p,'flotante-'+file.replace('.html',''));
    await evalPage(p.sid,"document.querySelector('#toolModal .etx-min-btn').click()");
    await until(p.sid,"document.querySelector('#etx-dock .etx-chip')");
    await evalPage(p.sid,"document.querySelector('#etx-dock .etx-chip').click()");
    assert.notEqual(await evalPage(p.sid,"getComputedStyle(toolModal).display"),'none');
    await evalPage(p.sid,"tmClose.click()");assert.equal(await evalPage(p.sid,"toolModal.classList.contains('on')"),false);
   });
  }
  await check('Cambio de marco al catálogo · '+width,async()=>{
   await evalPage(p.sid,"abrirTool('staff.html','Catálogo de Staff','👥')");
   await until(p.sid,"toolModal.classList.contains('s-staff-tool') && !toolModal.classList.contains('op-tool') && tmFrame.contentWindow.document.getElementById('modalAdminGuard')");
   assert.equal(await evalPage(p.sid,"document.querySelectorAll('#toolModal .op-icon').length"),0);
   await until(p.sid,"document.querySelectorAll('#tmIcon svg').length===1");
  });await close(p);
 }
 for(const tool of ['horarios','checklists','organigrama','perfiles-puesto','evaluaciones'].filter(t=>!process.env.OP_MAIN_ONLY&&(!process.env.OP_TOOL||t===process.env.OP_TOOL))){
  const p=await page(base,'/administrativo/'+tool+'.html',1440,true);
  await check('Página y tema claro · '+tool,async()=>{
   await until(p.sid,"document.documentElement.dataset.theme==='light' && document.querySelector('#etaax-header')");
   assert.notEqual(await evalPage(p.sid,"getComputedStyle(document.getElementById('etaax-header')).display"),'none');
   await bounded(p,'.hr-toolbar button,.ck-head button,.pp-head button,.ev-head button,.org-top button');
   if(tool==='organigrama'){await pause(100);assert.ok(await evalPage(p.sid,"document.querySelector('.org-top').getBoundingClientRect().top>=document.getElementById('ctxBar').getBoundingClientRect().bottom-1"));await until(p.sid,"document.getElementById('viewport').getBoundingClientRect().top>=document.querySelector('.org-top').getBoundingClientRect().bottom-1");}
   await shot(p,'claro-'+tool);assert.deepEqual(await evalPage(p.sid,'window.__errors'),[]);
   if(tool==='perfiles-puesto'){
    await evalPage(p.sid,"editarPerfil('pp1');fResponsabilidades.scrollIntoView({block:'center'})");await pause(100);
    assert.ok(await evalPage(p.sid,"document.querySelector('#viewEditor>.pp-head').getBoundingClientRect().top>=document.getElementById('ctxBar').getBoundingClientRect().bottom-1"));
    await evalPage(p.sid,"verPerfil('pp1')");await send('Emulation.setEmulatedMedia',{media:'print'},p.sid);
    assert.equal(await evalPage(p.sid,"getComputedStyle(docPreview).backgroundColor"),'rgb(255, 255, 255)');
    await send('Emulation.setEmulatedMedia',{media:'screen'},p.sid);
   }
  });await close(p);
 }
 assert.equal(forbidden.length,0);console.log('Capturas: '+__dirname);
}

(async()=>{
    server=http.createServer((req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name.startsWith('/__visual-fonts/')){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'font/ttf');res.end(fs.readFileSync(path.join(root, "docs/continuidad-codex-2026-10-13/fuentes") + path.sep+path.basename(name)));return;}
        if(name==='/__sdk-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end('('+sdkFixture.toString()+')()');return;}
        const filename=path.resolve(root,'.'+decodeURIComponent(name));
        if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||fs.statSync(filename).isDirectory()){res.writeHead(404);res.end();return;}
        const ext=path.extname(filename), mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
        res.setHeader('Content-Type',mime[ext]||'text/plain');
        if(ext==='.html'){
            let html=fs.readFileSync(filename,'utf8').replace(/<link[^>]*href="https:[^>]+>/g,'')
                .replace(/src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^\"]+"/g,'src="/__sdk-fixture.js"');
            res.end(html.replace('</head>','<link rel="stylesheet" href="/__visual-fonts/fonts.css"></head>'));
        }else if(name==='/supabase-config.js')res.end("var SUPABASE_URL='http://fixture.invalid';var SUPABASE_ANON='fixture';var _supabase=supabase.createClient(SUPABASE_URL,SUPABASE_ANON,{});");
        else res.end(fs.readFileSync(filename));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+server.address().port;
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'etaax-staff-operativo-'));
    chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
        '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--password-store=basic','--use-mock-keychain','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
    ],{stdio:['ignore','pipe','pipe']});
    let err='';chrome.stderr.on('data',chunk=>{err+=chunk.toString();});chrome.stdout.on('data',chunk=>{err+=chunk.toString();});
    const end=Date.now()+45000;let address;
    while(!address){
        address=err.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
        const portFile=path.join(profile,'DevToolsActivePort');
        if(!address&&fs.existsSync(portFile)){const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split('\n');if(port&&endpoint)address='ws://127.0.0.1:'+port+endpoint;}
        if(address)break;
        if(chrome.exitCode!==null||Date.now()>end)throw new Error('No inició Chrome (exit='+chrome.exitCode+', perfil='+fs.readdirSync(profile).join(',')+'): '+err.slice(-1200));
        await pause(50);
    }
    socket=new WebSocket(address);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message',async ev=>{
        const m=JSON.parse(ev.data);
        if(m.id){const w=pending.get(m.id);if(!w)return;pending.delete(m.id);clearTimeout(w.timer);m.error?w.reject(new Error(JSON.stringify(m.error))):w.resolve(m.result);}
        else if(m.method==='Fetch.requestPaused'){
            const url=m.params.request.url;
            try {
                if(url.startsWith(base+'/'))await send('Fetch.continueRequest',{requestId:m.params.requestId},m.sessionId);
                else{forbidden.push(url);await send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
            } catch(e) {
                // Una redirección puede cancelar la petición antes de que CDP
                // continúe su InterceptionId. No es un fallo de la página.
                if(!closing && !/Invalid InterceptionId/.test(e.message)) throw e;
            }
        }
        else if(m.method==='Page.javascriptDialogOpening'){
            await send('Page.handleJavaScriptDialog',{accept:true},m.sessionId);
        }
    });
    await run(base);
    console.log('STAFF OPERATIVO: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
