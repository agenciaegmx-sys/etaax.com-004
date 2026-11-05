'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'etaax-paginador-audit-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let chrome,socket,next=0;const pending=new Map();
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function ev(sid,expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sid);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
(async()=>{try{
chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--password-store=basic','--use-mock-keychain','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
const portFile=path.join(profile,'DevToolsActivePort');for(let k=0;!(fs.existsSync(portFile)&&fs.readFileSync(portFile,'utf8').trim().split('\n')[1]);k++){if(k>300)throw Error('Chrome timeout');await sleep(50);}
const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split('\n');socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);});
const js=fs.readFileSync(path.join(root,'recetas/inventarios.js'),'utf8');
const funcs=js.slice(js.indexOf('function _rdPodarPorModo('),js.indexOf('// ── Reporte directivo',js.indexOf('function _rdConstruirPaginas(')));
const pre=fs.readFileSync(path.join(root,'tests/money-tests.js'),'utf8').split('/* ═══════════════ SUITE A')[0].replace(/^#![^\n]*\n/,'');
const {crearContexto,cargarJS,setVar}=new Function('require','__dirname',pre+'\nreturn {crearContexto,cargarJS,setVar};')(require,__dirname);
const F=crearContexto();cargarJS(F,'etaax-core.js');cargarJS(F,'security.js');cargarJS(F,'insumo-label.js');cargarJS(F,'recetas/inventarios.js');F._storage.etaax_negocio_activo='audit';
setVar(F,'invActual',{id:'audit',fecha:'2026-11-04',entradasLog:[],prebatchProducidos:{},cocktailsVendidos:{},ventasCompuesto:{},cancelaciones:[],descuentos:[]});
setVar(F,'filasCaptura',Array.from({length:120},(_,i)=>({insumoId:'p'+i,nombre:'Producto de prueba '+i,tipo:'pza',categoria:i<60?'Cervezas':'Refrescos',existenciaAnterior:10,cerradasBarra:i%2?15:5,costoUnitario:30,precioCarta:70,entradas:[]})));
let html='';F.document.body.appendChild=n=>html=n.innerHTML;try{F.verReporteDirectivo(false,'faltsobr');}catch(e){if(!html)throw e;}

for(const grande of [false,true]){
const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId:sid}=await send('Target.attachToTarget',{targetId,flatten:true});await send('Page.enable',{},sid);await send('Network.enable',{},sid);await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},sid);await send('Emulation.setDeviceMetricsOverride',{width:1100,height:950,deviceScaleFactor:1,mobile:false},sid);const {frameTree}=await send('Page.getFrameTree',{},sid);
await send('Page.setDocumentContent',{frameId:frameTree.frame.id,html:'<!doctype html><meta charset="utf-8"><div id="rdOverlay">'+html+'</div>'},sid);
await ev(sid,funcs);await ev(sid,"_rdPodarPorModo(document.querySelector('#rd-src'),'faltsobr')");
if(grande)await ev(sid,"document.querySelector('#rd-src tbody td').appendChild(Object.assign(document.createElement('div'),{textContent:'Comentario de inventario '.repeat(700)+'FIN_NOTA_AUDIT'}))");
const originalText=await ev(sid,"document.querySelector('#rd-src tbody td').textContent");
const before=await ev(sid,"Array.from(document.querySelectorAll('#rd-src tbody tr')).filter(r=>r.textContent.includes('Producto de prueba')).length");
await ev(sid,"_rdConstruirPaginas(document.querySelector('#rd-src'),document.querySelector('#rd-pages'),'<div style=\"height:50px\">Encabezado de prueba</div>','<div style=\"height:25px\">Pie de prueba</div>')");
const result=await ev(sid,"({pages:document.querySelectorAll('.rd-paper').length,rows:Array.from(document.querySelectorAll('#rd-pages tbody tr')).filter(r=>r.textContent.includes('Producto de prueba')).length,overflow:Array.from(document.querySelectorAll('.rd-pagebody')).map((b,i)=>({page:i+1,available:b.clientHeight,content:b.querySelector('.rd-bodyinner').offsetHeight})).filter(x=>x.content>x.available),neto:document.querySelector('#rd-pages').textContent.includes('Resultado neto')})");
assert.equal(result.rows,before,'se perdieron productos');assert.deepEqual(result.overflow,[],'contenido recortado');assert.equal(result.neto,true,'falta el resultado');
if(grande){
 const recovered=await ev(sid,"(()=>{const rows=Array.from(document.querySelectorAll('#rd-pages tbody tr'));let txt=rows[0].cells[0].textContent;for(let i=1;i<rows.length && rows[i].hasAttribute('data-rd-continuacion');i++) txt+=rows[i].cells[0].textContent.replace(/^\\(continuación\\) /,'');return txt;})()");
 assert.equal(recovered,originalText,'la nota no se conservó completa');
}
const pdf=await send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true},sid);fs.writeFileSync(path.join(os.tmpdir(),'etaax-v84-paginador-')+(grande?'nota-larga':'normal')+'.pdf',Buffer.from(pdf.data,'base64'));
console.log('AUDIT '+JSON.stringify({caso:grande?'nota_mayor_que_pagina':'120_filas',filasFuente:before,...result}));await send('Target.closeTarget',{targetId});
}
}finally{try{socket?.close();}catch{}chrome?.kill();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
