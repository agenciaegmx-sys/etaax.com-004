/* Regresión del HTML publicado: Netlify reescribe los href sin .html.
   Chrome real, sin SDK ni backend; toda petición fuera del servidor local falla.
   node tests/probar-sidebar.cjs
   SIDEBAR_SOURCE permite comprobar los JS descargados antes de la corrección.
   SIDEBAR_CAPTURES cambia el destino de evidencia; CHROME_BIN cambia Chrome. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = process.env.SIDEBAR_SOURCE || root;
const captures = process.env.SIDEBAR_CAPTURES || path.join(os.tmpdir(), 'etaax-sidebar-capturas');
fs.mkdirSync(captures, {recursive:true});
const published = fs.readFileSync(path.join(root, 'tests/fixtures/sidebar-netlify.nav.txt'), 'utf8');
const local = fs.readFileSync(path.join(root, 'administrativo/diario.html'), 'utf8').match(/<nav\b[\s\S]*?<\/nav>/)[0];
let server, chrome, socket, next = 0, closing = false, base;
const pending = new Map(), closed = new Set(), forbidden = [], results = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        const id = ++next, timer = setTimeout(() => {pending.delete(id);reject(new Error('CDP: '+method));}, 15000);
        pending.set(id, {resolve,reject,timer});
        socket.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
    });
}
async function evaluate(sid, expression) {
    const r = await send('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true}, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
}
async function until(sid, expression) {
    const end = Date.now()+10000;
    while (Date.now()<end) {if (await evaluate(sid,expression)) return;await pause(25);}
    throw new Error('No se cumplió: '+expression);
}
async function check(name, fn) {
    try {await fn();results.push({name,ok:true});console.log('PASA '+name);}
    catch(e) {results.push({name,ok:false});console.error('FALLA '+name+' · '+e.message);}
}
async function open(route, width) {
    const {targetId} = await send('Target.createTarget', {url:'about:blank'});
    const {sessionId:sid} = await send('Target.attachToTarget', {targetId,flatten:true});
    await send('Page.enable', {}, sid);
    await send('Fetch.enable', {patterns:[{urlPattern:'*'}]}, sid);
    await send('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:width<720}, sid);
    await send('Page.addScriptToEvaluateOnNewDocument', {source:"window.__errors=[];window.addEventListener('error',e=>{if(e.message)window.__errors.push(e.message)});"}, sid);
    await send('Page.navigate', {url:base+route}, sid);
    await until(sid,"document.readyState==='complete' && typeof etaaxPintarIconosNav==='function'");
    await evaluate(sid,"if(document.getElementById('nav').classList.contains('cerrado'))toggleNav();window.dispatchEvent(new Event('resize'))");
    await pause(250); // Esperar la transición de ancho antes de medir/capturar.
    return {sid,targetId};
}
async function close(p) {closed.add(p.sid);await send('Target.closeTarget', {targetId:p.targetId});}
async function snapshot(p, name) {
    const s = await send('Page.captureScreenshot', {format:'png'}, p.sid);
    fs.writeFileSync(path.join(captures,name+'.png'), Buffer.from(s.data,'base64'));
}
const slots = "[...document.querySelectorAll('#nav a.nav-link:not(.etx-nav-back)')]";
async function inspect(p) {
    return evaluate(p.sid,`(${slots}).map(a=>({href:a.getAttribute('href'),icon:a.querySelector('.nav-icon use')?.getAttribute('href'),description:a.querySelector('.etx-nav-desc')?.textContent}))`);
}
async function run() {
    for (const width of [1440,768,390,320]) {
        for (const mode of ['local','publicado']) {
            const p = await open('/administrativo/diario'+(mode==='local'?'.html':'')+'?fixture='+mode, width);
            await check(`${width}px ${mode}: cinco SVG y descripciones, mismos destinos`, async () => {
                const rows = await inspect(p);
                await snapshot(p,mode+'-'+width);
                assert.equal(rows.length,5);
                assert.deepEqual(rows.map(r=>r.icon),['#etx-mod-control-administrativo','#etx-cat-colaboradores','#etx-cat-proveedores','#etx-cat-clientes','#etx-mod-escandallos']);
                assert.deepEqual(rows.map(r=>r.description),['Operación diaria','Personal y horarios','Abastecimiento','Directorio de clientes','Carta y precios']);
                assert.deepEqual(rows.map(r=>r.href),mode==='local'?['diario.html','staff-hub.html','proveedores.html','clientes.html','menu.html']:['/administrativo/diario','/administrativo/staff-hub','/administrativo/proveedores','/administrativo/clientes','/administrativo/menu']);
                assert.equal(await evaluate(p.sid,`(${slots}).every(a=>getComputedStyle(a.querySelector('.nav-text')).display!=='none')`),true,'Nombres visibles al expandir en tablet y móvil');
                assert.deepEqual(await evaluate(p.sid,'__errors'),[]);
                const size = await evaluate(p.sid,'({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');
                assert.ok(size.scroll<=size.width+1,JSON.stringify(size));
            });
            if (width===1440 && mode==='local') {
                await check('Volver a módulos conserva su flecha sin repintados continuos', async () => {
                    await evaluate(p.sid,"window.__primerSvg=document.querySelector('#nav a.nav-link .nav-icon svg')");
                    assert.equal(await evaluate(p.sid,'!!__primerSvg'),true);
                    await pause(180);
                    assert.equal(await evaluate(p.sid,"__primerSvg===document.querySelector('#nav a.nav-link .nav-icon svg')"),true);
                    assert.equal(await evaluate(p.sid,"document.querySelector('#nav .etx-nav-back use').getAttribute('href')"),'#etx-flecha');
                });
            }
            if (width===1440 && mode==='publicado') {
                await check('Rutas de cuatro módulos: .html, URL limpia e inicio de Recetas', async () => {
                    for (const [route,icon] of [['/administrativo/clientes','cat-clientes'],['/recetas/inventarios','mod-inventarios'],['/financiero/resumen','fin-resumen-resultados'],['/consultoria/guias','mod-aprende-analiza']]) {
                        assert.equal(await evaluate(p.sid,'etaaxIconoRuta('+JSON.stringify(route)+')'),icon);
                        assert.equal(await evaluate(p.sid,'etaaxIconoRuta('+JSON.stringify(route+'.html')+')'),icon);
                    }
                    assert.equal(await evaluate(p.sid,"etaaxIconoRuta('/recetas/')"),'mod-escandallos');
                    assert.equal(await evaluate(p.sid,"etaaxIconoRuta('/recetas')"),'mod-escandallos');
                    assert.equal(await evaluate(p.sid,"etaaxIconoRuta('/recetas/index')"),'mod-escandallos');
                    assert.equal(await evaluate(p.sid,"etaaxIconoRuta('/otra/ruta')"),'');
                });
                await check('Un menú repintado recupera sus SVG y descripciones', async () => {
                    await evaluate(p.sid,"document.getElementById('nav').innerHTML="+JSON.stringify(published.match(/<nav\b[\s\S]*?<\/nav>/)[0].replace(/^<nav[^>]*>|<\/nav>$/g,'')));
                    await until(p.sid,"document.querySelectorAll('#nav a.nav-link:not(.etx-nav-back) .nav-icon use').length===5");
                    assert.ok((await inspect(p)).every(r=>r.icon && r.description));
                });
            }
            await close(p);
        }
    }
    assert.deepEqual(forbidden,[],'Peticiones fuera del servidor local');
    console.log('SIDEBAR: '+results.length+' casos, '+results.filter(r=>!r.ok).length+' fallas. Sin backend ni peticiones externas.');
    console.log('Capturas: '+captures);
    if(results.some(r=>!r.ok))process.exitCode=1;
}
(async () => {
    server = http.createServer((req,res) => {
        const url = new URL(req.url,'http://localhost'), name = url.pathname;
        if(/^\/administrativo\/diario(?:\.html)?$/.test(name)) {
            res.setHeader('Content-Type','text/html; charset=utf-8');
            res.end('<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/etaax-sidebar.css"><link rel="stylesheet" href="/etaax-modulos-ui.css"></head><body><div id="ctxBar"></div>'+(url.searchParams.get('fixture')==='local'?local:published)+'<main class="main-content"></main><script src="/nav-pref.js"></script><script src="/etaax-iconos.js"></script><script src="/etaax-sidebar.js"></script><script src="/etaax-modulos-ui.js"></script></body></html>');return;
        }
        const dir = ['/etaax-sidebar.js','/etaax-modulos-ui.js','/etaax-iconos.js'].includes(name)?source:root;
        const filename = path.resolve(dir,'.'+name);
        if(!filename.startsWith(dir+path.sep) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/plain');
        res.end(fs.readFileSync(filename));
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    base='http://127.0.0.1:'+server.address().port;
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'etaax-sidebar-chrome-'));
    chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
    const ws=await new Promise((resolve,reject)=>{let text='';const t=setTimeout(()=>reject(new Error('Chrome no inició')),15000);chrome.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});chrome.on('error',reject);});
    socket=new WebSocket(ws);
    await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
    socket.addEventListener('message',async e=>{
        const m=JSON.parse(e.data);
        if(m.id){const q=pending.get(m.id);if(q){clearTimeout(q.timer);pending.delete(m.id);m.error?q.reject(new Error(m.error.message)):q.resolve(m.result);}return;}
        if(m.method==='Fetch.requestPaused'){
            const url=m.params.request.url;
            try {
                if(url.startsWith(base+'/'))await send('Fetch.continueRequest',{requestId:m.params.requestId},m.sessionId);
                else {forbidden.push(url);await send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
            } catch(err) {if(!closing && !closed.has(m.sessionId) && !/Invalid InterceptionId/.test(err.message))throw err;}
        }
    });
    await run();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome && chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
