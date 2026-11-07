/* Selector real en Chrome, con HTML/CSS del módulo y fixtures locales.
 * Sin acceso a Supabase; no sustituye una prueba en tablet física. */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'etaax-cancelaciones-'));
const source=fs.readFileSync(path.join(root,'recetas/inventarios.html'),'utf8');
const head=source.slice(source.indexOf('<head>')+6,source.indexOf('</head>')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]+href=["']https:[^>]+>/g,'');
const estilos=[...source.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('');
const html='<!doctype html><html data-theme="dark"><head>'+head+estilos+'</head><body><div id="fixture"></div></body></html>';
const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/fixture'){res.setHeader('Content-Type','text/html');return res.end(html);}const file=path.resolve(root,'.'+u);if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',u.endsWith('.css')?'text/css':'text/plain');return res.end(fs.readFileSync(file));}res.writeHead(404);res.end();});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let chrome,socket,next=0;const pending=new Map();
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function ev(sid,expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sid);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
(async()=>{try{
await new Promise(r=>server.listen(0,'127.0.0.1',r));
chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--password-store=basic','--use-mock-keychain','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
const portFile=path.join(profile,'DevToolsActivePort');for(let k=0;!(fs.existsSync(portFile)&&fs.readFileSync(portFile,'utf8').trim().split('\n')[1]);k++){if(k>300)throw Error('Chrome timeout');await sleep(50);}
const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split('\n');socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);await new Promise(r=>socket.addEventListener('open',r,{once:true}));socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);});
for(const [width,height,touch] of [[1280,900,false],[1024,768,true],[390,844,true]]){
 const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId:sid}=await send('Target.attachToTarget',{targetId,flatten:true});
 await send('Page.enable',{},sid);await send('Network.enable',{},sid);await send('Network.setBlockedURLs',{urls:['*supabase*','*cdn.jsdelivr*','*fonts.googleapis*','*fonts.gstatic*']},sid);
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch},sid);await send('Emulation.setTouchEmulationEnabled',{enabled:touch},sid);
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/fixture'},sid);
 for(let i=0;!(await ev(sid,"!!document.getElementById('fixture')"));i++){if(i>100)throw Error('page timeout');await sleep(50);}
 for(const file of ['etaax-core.js','security.js','insumo-label.js','recetas/inventarios.js']){
  let js=fs.readFileSync(path.join(root,file),'utf8');if(file.endsWith('inventarios.js'))js=js.slice(0,js.indexOf('// Render inicial AL FINAL'));
  await ev(sid,js);
 }
 await ev(sid,`_autoGuardar=()=>{};renderStepContent=()=>{document.getElementById('fixture').innerHTML=_renderCancelacionesTab(invActual.cancelaciones);};
 _cacheRecetasInv=[{id:'spritz',nombre:'Limón Spritz',tipo:'bebidas',status:'activa'}];
 filasCaptura=[{insumoId:'vodka',nombre:'Vodka American 2',tipo:'copa',categoria:'Destilados'},...Array.from({length:150},(_,i)=>({insumoId:'p'+i,nombre:'Producto '+i,tipo:'pza',categoria:'Refrescos'}))];
 _cacheInsumosInv=filasCaptura.map(f=>({id:f.insumoId,nombre:f.nombre,activo:'1'}));
 invActual={id:'local',cancelaciones:[{nombreProducto:'CREMOSO DE LIMON',cantidad:3,recetaId:'spritz',recetaNombre:'Limón Spritz'}]};renderStepContent();
 document.querySelector('[data-cancel-match]').click();`);
 assert.equal(await ev(sid,"document.activeElement.id"),'cancelMatchBusca');
 const layout=await ev(sid,`(()=>{const d=document.querySelector('.cancel-match-dialog').getBoundingClientRect(),r=document.getElementById('cancelMatchResultados'),h=document.querySelector('.cancel-match-header');const top=h.getBoundingClientRect().top;r.scrollTop=500;return {width:innerWidth,left:d.left,right:d.right,top:d.top,bottom:d.bottom,height:innerHeight,scroll:r.scrollTop,fixed:top===h.getBoundingClientRect().top};})()`);
 assert.ok(layout.left>=0&&layout.right<=layout.width&&layout.top>=0&&layout.bottom<=layout.height,JSON.stringify(layout));assert.ok(layout.scroll>0&&layout.fixed);
 await send('Input.insertText',{text:'spritz limon'},sid);
 assert.equal(await ev(sid,"document.querySelectorAll('#cancelMatchResultados button').length"),1);
 assert.equal(await ev(sid,"document.querySelector('#cancelMatchResultados button').dataset.valor"),'r:spritz');
 await ev(sid,"document.getElementById('cancelMatchBusca').value='ZZZ';_renderCancelMatch('ZZZ')");
 assert.equal(await ev(sid,"document.querySelectorAll('#cancelMatchResultados button').length"),0);
 const pos=await ev(sid,"(()=>{const r=document.querySelector('.cancel-match-none').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
 if(touch){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pos]},sid);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},sid);}else await ev(sid,"document.querySelector('.cancel-match-none').click()");
 await sleep(60);
 assert.deepEqual(await ev(sid,"({manual:invActual.cancelaciones[0].matchManual,receta:invActual.cancelaciones[0].recetaId,insumo:invActual.cancelaciones[0].insumoId,abierto:!!document.getElementById('cancelMatchOverlay')})"),{manual:true,receta:null,insumo:null,abierto:false});
 await ev(sid,"_reDetectarCancelaciones();document.querySelector('[data-cancel-match]').click();document.getElementById('cancelMatchBusca').value='vodka';_renderCancelMatch('vodka');document.querySelector('#cancelMatchResultados button').click()");
 assert.equal(await ev(sid,"invActual.cancelaciones[0].insumoId"),'vodka');
 await ev(sid,"document.querySelector('[data-cancel-match]').click()");
 const shot=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync(path.join(os.tmpdir(),'etaax-cancelaciones-'+width+'.png'),Buffer.from(shot.data,'base64'));
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},sid);
 assert.equal(await ev(sid,"!!document.getElementById('cancelMatchOverlay')"),false);
 console.log('OK selector '+width+'×'+height+(touch?' · touch emulado':''));await send('Target.closeTarget',{targetId});
}
}finally{try{socket?.close();}catch{}chrome?.kill();server.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
