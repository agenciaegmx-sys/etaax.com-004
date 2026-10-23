/* Navegación real con recursos visuales retrasados, caché fría/caliente y 304.
   Supabase simulado; ninguna petición de la página sale del origen local.
   NAV_CAPTURES elige capturas; NAV_VISUAL_SOURCE permite comparar las versiones
   anteriores de etaax-ui-inicio.js y etaax-modulos-ui.css. */
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, socket, closing = false, next = 0;
const pending = new Map(), results = [], forbidden = [], delaySessions=new Set(), failureSessions=new Map(), cacheEvents=[];
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
    const mode = window.__case || 'owner';
    const staff = mode === 'staff' || mode === 'staff-server';
    let user = { id: staff ? 's1' : 'u1', email: staff ? 'compartida@fixture.invalid' : 'ana@fixture.invalid',
        user_metadata: { nombre: mode === 'xss' ? 'Ana <img src=x onerror="window.__xss=1">' : 'Ana González' } };
    window.__calls = [];
    const negocios = [{ id: 'n1', usuario_id: 'u1', staff_uid: 's1', datos: { nombre: 'Café de prueba', tipo: 'cafe', organizacion: 'corporativo', color: '#3dbe7a' } },
        { id: 'n2', usuario_id: 'u1', staff_uid: 's2', datos: { nombre: 'Otra marca', tipo: 'restaurante', color: '#3dbe7a' } }];
    function query(table) {
        const filters = {}, q = { select() { return q; }, eq(k,v) { filters[k] = v; return q; },
            order() { return q; }, range() { return q; }, limit() { return q; }, neq() { return q; }, or() { return q; }, delete() { q.deleting=true; return q; }, not() { return q; }, in() { return q; }, is() { return q; },
            maybeSingle() { q.single = true; return q; }, update(value) { q.value = value; return q; },
            upsert(value) { q.value = value; return q; }, insert(value) { q.value = value; return q; },
            then(resolve, reject) {
                window.__calls.push({ type: 'table', table, filters: { ...filters }, value: q.value });
                let data = null, error = null;
                if (q.value) {
                    data = q.value;
                    if(['staff','recetas','insumos'].includes(table)) {
                        const registros=Array.isArray(q.value)?q.value:[q.value];
                        const prev=JSON.parse(sessionStorage.getItem('__fixture_'+table)||'[]');registros.forEach(r=>{const i=prev.findIndex(x=>x.id===r.datos.id);if(i>=0)prev[i]=r.datos;else prev.push(r.datos);});sessionStorage.setItem('__fixture_'+table,JSON.stringify(prev));
                    }
                }
                else if(['staff','recetas','insumos'].includes(table)) data=q.deleting?[]:JSON.parse(sessionStorage.getItem('__fixture_'+table)||'[]').map(datos=>({datos}));
                else if(table==='negocio_insumos') data=JSON.parse(sessionStorage.getItem('__fixture_insumos')||'[]').map(datos=>({datos}));
                else if (table === 'negocios') data = negocios.filter(n => Object.keys(filters).every(k => n[k] === filters[k]));
                else if (table === 'negocio_sucursales') data = { datos: { sucursales: filters.negocio_id === 'n2' ? [{id:'suc_principal',nombre:'Matriz',activa:true,fechaCreado:'2026-08-07'}]
                    : [{id:'suc_principal',nombre:'Centro',activa:true,fechaCreado:'2026-08-07'},{id:'norte',nombre:'Norte',activa:true,fechaCreado:'2026-08-07'}], cfg:{} } };
                else if (table === 'suscripciones') data = { estado: mode === 'pending' ? 'pendiente' : mode === 'stripe' ? 'vencida' : 'activa', proximo_cobro: '2026-11-13', dias_tolerancia:3,
                    stripe_subscription_id: mode === 'stripe' ? 'sub_fixture' : null };
                else if (table === 'usuarios') data = { id:'u1',nombre:user.user_metadata.nombre,plan:'pyme' };
                else data = q.single ? null : [];
                if (window.__fail && table === 'suscripciones') error = { message:'Fallo controlado' };
                if (q.single && Array.isArray(data)) data = data[0] || null;
                if(mode === 'race' && filters.negocio_id === 'n1'){
                    (window.__held ||= []).push(()=>({data,error}));
                    return new Promise(r=>{(window.__release ||= []).push(()=>r({data,error}));}).then(resolve,reject);
                }
                if(window.__slowQueries && ['insumos','negocio_insumos'].includes(table))return new Promise(r=>(window.__heldData ||= []).push(()=>r({data,error}))).then(resolve,reject);return Promise.resolve({data,error}).then(resolve,reject);
            }
        }; return q;
    }
    const auth = {
        getUser: async () => ({ data:{user:mode === 'anon' ? null : user},error:null }),
        getSession: async () => ({ data:{session:mode === 'anon' ? null : {user}},error:null }),
        onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}),
        updateUser: async value => {
            window.__calls.push({type:'updateUser',value});
            if (value.data) user = {...user,user_metadata:{...user.user_metadata,...value.data}};
            if (value.email && mode !== 'email-confirm') user = {...user,email:value.email};
            return {data:{user},error:null};
        },
        signOut: async options => { window.__calls.push({type:'signOut',options});return {error:null}; }
    };
    window.supabase = {createClient(_url,_key,options) {
        if (['etaax-verificar-cuenta','etaax-verify'].includes(options?.auth?.storageKey)) return {auth:{
            signInWithPassword: async args => {window.__calls.push({type:'verify',email:args.email});return {data:{},error:args.password === 'Current123' ? null : {message:'Wrong password'}};},
            signOut: auth.signOut
        }};
        return {auth,from:query,
            rpc: async (name,args) => {
                window.__calls.push({type:'rpc',name,args});
                return {error:null,data:name === 'negocio_cobro_estado' ? {activo:mode !== 'pending' && mode !== 'stripe',estado:mode === 'pending' ? 'pendiente' : mode === 'stripe' ? 'vencida' : 'activa',proximoCobro:'2026-11-13',diasTolerancia:3,diasRestantes:34} : null};
            },
            functions:{invoke:async (name,args) => {window.__calls.push({type:'invoke',name,args});return {data:{url:'javascript:alert(1)'},error:null};}},
            channel(){return {on(){return this;},subscribe(){return this;},send:async()=>{},unsubscribe(){}};},
            removeChannel:async()=>{}
        };
    }};
}
async function page(base, route, mode = 'owner', width = 1440, navigation = false) {
    const { targetId } = await send('Target.createTarget', { url:'about:blank' });
    const { sessionId:sid } = await send('Target.attachToTarget', { targetId, flatten:true });
    await send('Page.enable', {}, sid);
    await send('Fetch.enable', {patterns:[{urlPattern:'*'}]}, sid);
    if(navigation){
        await send('Network.enable',{},sid);
        await send('Network.setExtraHTTPHeaders',{headers:{'X-Etaax-Prueba-Rutas':'1'}},sid);
    }
    await send('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:width<720}, sid);
    const init = `window.__case=${JSON.stringify(mode)};window.__errors=[];window.__stacks=[];window.addEventListener('unhandledrejection',e=>window.__errors.push('Promesa: '+e.reason?.stack));window.addEventListener('error',e=>window.__stacks.push({stack:e.error?.stack,file:e.filename,line:e.lineno}));window.addEventListener('error',e=>{if(e.message)window.__errors.push(e.message)});
        ${navigation ? "if(!sessionStorage.getItem('__etaax_fixture_seed')){" : ''}
        localStorage.clear();sessionStorage.clear();localStorage.setItem('etaax_negocio_activo','n1');localStorage.setItem('etaax_sucursal_activa','suc_principal');
        localStorage.setItem('etaax_ctx',JSON.stringify({ctxType:${JSON.stringify(mode === 'staff' ? 'staff' : 'owner')},userName:'Ana González',negId:'n1',negNombre:'Café de prueba'}));
        localStorage.setItem('etaax_qses',JSON.stringify({usuarioId:'u1',nombre:'Ana González',email:'ana@fixture.invalid',plan:'pyme',ts:Date.now()}));
        localStorage.setItem('etaax_negocios',JSON.stringify([{id:'n1',usuarioId:'u1',nombre:'Café de prueba',tipo:'cafe',organizacion:'corporativo',color:'#3dbe7a'}]));
        localStorage.setItem('etaax_n1_sucursales',JSON.stringify([{id:'suc_principal',nombre:'Centro',activa:true,fechaCreado:'2026-08-07'}]));
        ${mode === 'staff' ? "sessionStorage.setItem('etaax_sesion_hub',JSON.stringify({type:'staff',nombre:'José de prueba',staffId:'col1',negocioId:'n1',rol:'mesero',expira:Date.now()+3600000}));" : ''}
        ${mode === 'failure' ? 'window.__fail=true;' : ''}
        ${navigation ? "sessionStorage.setItem('__etaax_fixture_seed','1');}window.__fixtureGeneration=Number(sessionStorage.getItem('__etaax_fixture_generation')||0)+1;sessionStorage.setItem('__etaax_fixture_generation',String(window.__fixtureGeneration));" : ''}`;
    await send('Page.addScriptToEvaluateOnNewDocument', {source:init}, sid);
    await send('Page.navigate', {url:base+route}, sid);
    await until(sid, mode === 'race' ? "document.getElementById('planNegocio') && window.__release && __release.length===2 && !!document.querySelector('.cuenta-loading')" : route.startsWith('/hub') ? "document.getElementById('etaax-header') && Array.from(document.querySelectorAll('.neg-activo-bar')).some(x=>x.getClientRects().length)" :
        "document.getElementById('cuentaContenido') && !document.querySelector('.cuenta-loading')");
    return {sid,targetId};
}
async function close(p) { await send('Target.closeTarget',{targetId:p.targetId}); }
async function check(name, fn) { await fn(); results.push(name); console.log('PASA '+name); }
async function layout(p, gap) {
    const m = await evalPage(p.sid, `(()=>{const h=document.getElementById('etaax-header').getBoundingClientRect();const content=document.querySelector('.cuenta-shell,.hub-shell').getBoundingClientRect();return {header:h.bottom,content:content.top,width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,padding:parseFloat(getComputedStyle(document.body).paddingTop)}})()`);
    assert.equal(m.padding,m.header);assert.ok(m.content>=m.header);
    if(gap) assert.ok(await evalPage(p.sid, `(()=>{const bar=Array.from(document.querySelectorAll('.neg-activo-bar')).find(x=>x.getClientRects().length);return bar.getBoundingClientRect().top-document.getElementById('etaax-header').getBoundingClientRect().bottom})()` ) >= gap);
    assert.ok(m.scroll<=m.width+1,JSON.stringify(m));
}


async function run(base) {
 const dir=process.env.NAV_CAPTURES||path.join(os.tmpdir(),'etaax-navegacion-visual');fs.mkdirSync(dir,{recursive:true});
 // Cada preload debe pedir exactamente el URL/version del script que se ejecuta.
 await check('29 páginas precargan su presentación y activan el arranque antes del contenido',async()=>{
  let n=0;for(const carpeta of ['administrativo','recetas','financiero','consultoria'])for(const name of fs.readdirSync(path.join(root,carpeta))){
   if(!name.endsWith('.html'))continue;const s=fs.readFileSync(path.join(root,carpeta,name),'utf8');if(!s.includes('etaax-ui-inicio.js'))continue;n++;
   const head=s.slice(0,s.indexOf('</head>')),body=s.slice(s.indexOf('</head>')+7).trimStart();
   assert.match(body,/^<body[^>]*>\s*<script src="\/etaax-ui-inicio\.js[^\"]*"><\/script>/);
   for(const m of s.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)){
    const nombre=m[1].split('?')[0].split('/').pop();if(!/^(etaax-iconos|etaax-sidebar|etaax-header|etaax-modulos-ui)\.js$/.test(nombre)&&!nombre.endsWith('-ui.js'))continue;
    assert.ok(head.includes('rel="preload" as="script" href="'+m[1]+'"'),carpeta+'/'+name+' '+m[1]);
   }
  }assert.equal(n,29);
 });
 async function preparar(width){
  const p=await page(base,'/hub.html','owner',width,true);await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__visualFrames=[];function sample(){if(document.body&&document.querySelector('.main-content,.cf-wrap,#viewport')){const opacity=getComputedStyle(document.body).opacity;__visualFrames.push({opacity,ready:document.readyState,nav:!document.getElementById('nav')||!!document.querySelector('.etx-nav-identidad'),header:!!document.getElementById('etaax-header'),pending:document.documentElement.classList.contains('etx-ui-pendiente')});}if(__visualFrames.length<300)requestAnimationFrame(sample);}requestAnimationFrame(sample);`},p.sid);return p;
 }
 async function snapshot(p,name){const r=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(r.data,'base64'));}
 async function navegar(p,route){const gen=await evalPage(p.sid,'__fixtureGeneration');await evalPage(p.sid,`setTimeout(()=>location.href=${JSON.stringify(route)},25)`);await until(p.sid,`__fixtureGeneration>${gen} && document.querySelector('.main-content,.cf-wrap,#viewport') && !window.etaaxEstilizarNav`);}
 for(const width of [1440,390])for(const cache of ['fria','caliente']){
  const p=await preparar(width);
  await send('Network.setCacheDisabled',{cacheDisabled:cache==='fria'},p.sid);
  if(cache==='caliente')await go(p,"location.href='/recetas/insumos'","document.readyState==='complete' && document.querySelector('.etx-nav-identidad') && !document.documentElement.classList.contains('etx-ui-pendiente')");
  delaySessions.add(p.sid);
  for(const route of ['/recetas/','/recetas/insumos','/administrativo/staff-hub','/administrativo/horarios','/financiero/ventas','/consultoria/']){
   await check(route+' · caché '+cache+' · '+width,async()=>{
    await navegar(p,route);await pause(40);
    if(route==='/recetas/'&&cache==='fria')await snapshot(p,'durante-'+width);
    assert.equal(await evalPage(p.sid,"getComputedStyle(document.body).opacity"),'0','no exponer el HTML anterior mientras llegan los decoradores');
    assert.equal(await evalPage(p.sid,"getComputedStyle(document.documentElement,'::after').content"),'""','indicador de carga');
    await until(p.sid,"document.readyState==='complete' && !document.documentElement.classList.contains('etx-ui-pendiente')");await pause(50);
    assert.equal(await evalPage(p.sid,"getComputedStyle(document.body).opacity"),'1');
    assert.equal(await evalPage(p.sid,"!!document.querySelector('#etaax-header') && (!document.getElementById('nav') || (!!document.querySelector('#nav .etx-nav-identidad') && !!document.querySelector('#nav use')))"),true);
    assert.equal(await evalPage(p.sid,"document.body.hasAttribute('aria-busy') || !!document.getElementById('etxUiCarga')"),false);
    const frames=await evalPage(p.sid,"__visualFrames.filter(x=>x.opacity!=='0'&&(!x.nav||!x.header))");assert.deepEqual(frames,[],'ningún cuadro visible con nav/header anteriores');
    if(route==='/recetas/'&&cache==='fria')await snapshot(p,'lista-'+width);
    assert.deepEqual(await evalPage(p.sid,'__errors'),[]);
   });
  }
  delaySessions.delete(p.sid);
  await check('volver y avanzar por historial conserva la presentación · '+cache+' · '+width,async()=>{
   await evalPage(p.sid,'history.back()');await until(p.sid,"location.pathname==='/financiero/ventas' && document.readyState==='complete' && !document.documentElement.classList.contains('etx-ui-pendiente')");
   assert.equal(await evalPage(p.sid,'getComputedStyle(document.body).opacity'),'1');
   await evalPage(p.sid,'history.forward()');await until(p.sid,"location.pathname==='/consultoria/' && document.readyState==='complete' && !document.documentElement.classList.contains('etx-ui-pendiente')");
  });
  await close(p);
 }
 for(const query of ['embed=1','solo=1']){
  const p=await preparar(768);delaySessions.add(p.sid);
  await check('ventana '+query+' se revela decorada, sin header exterior',async()=>{
   await navegar(p,'/recetas/insumos?'+query);assert.equal(await evalPage(p.sid,'getComputedStyle(document.body).opacity'),'0');
   await until(p.sid,"document.readyState==='complete' && !document.documentElement.classList.contains('etx-ui-pendiente')");
   assert.equal(await evalPage(p.sid,"!!document.querySelector('.i-ui-title-icon,.i-ui-icon')"),true);
   assert.equal(await evalPage(p.sid,"!!document.getElementById('etaax-header')"),false);
  });await close(p);
 }
 for(const fail of ['etaax-modulos-ui.js','insumos-ui.js']){
  const p=await preparar(1440);failureSessions.set(p.sid,fail);
  await check('fallo de '+fail+' no deja la página permanentemente oculta',async()=>{
   const gen=await evalPage(p.sid,'__fixtureGeneration');await evalPage(p.sid,"setTimeout(()=>location.href='/recetas/insumos',25)");
   await until(p.sid,`__fixtureGeneration>${gen} && document.readyState==='complete' && !document.documentElement.classList.contains('etx-ui-pendiente')`);
   assert.equal(await evalPage(p.sid,'getComputedStyle(document.body).opacity'),'1');assert.equal(await evalPage(p.sid,"!!document.getElementById('searchInput')"),true);
  });await close(p);
 }
 // Las consultas de datos no forman parte de la barrera visual.
 {
  const p=await preparar(1440);await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__slowQueries=true;"},p.sid);
  await check('datos lentos no mantienen oculta la interfaz',async()=>{
   await go(p,"location.href='/recetas/insumos'","document.readyState==='complete' && !document.documentElement.classList.contains('etx-ui-pendiente')");
   assert.equal(await evalPage(p.sid,"!!document.querySelector('#nav .etx-nav-identidad')"),true);
   assert.ok(await evalPage(p.sid,'(__heldData||[]).length>0'));assert.equal(await evalPage(p.sid,'getComputedStyle(document.body).opacity'),'1');
  });await close(p);
 }
 assert.ok(cacheEvents.some(e=>e.status===304&&/\.js/.test(e.path)),'se ejercitó revalidación HTTP con 304');
 assert.deepEqual(forbidden,[]);console.log('CACHE 304: '+cacheEvents.filter(e=>e.status===304).length+' respuestas. Capturas: '+dir);
}

(async()=>{
    server=http.createServer((req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name.startsWith('/__visual-fonts/')){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'font/ttf');res.end(fs.readFileSync(path.join(root, "docs/continuidad-codex-2026-10-13/fuentes") + path.sep+path.basename(name)));return;}
        if(name==='/__sdk-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end('('+sdkFixture.toString()+')()');return;}
        /* Las pruebas de ruta no cargan ni prueban el cálculo de cada reporte:
           usan el URL real, el contexto persistido y sus nav/ctx-bar reales. */
        if(req.headers['x-etaax-prueba-rutas']==='1' && /^(\/financiero\/(ventas|resumen|kpis|estadisticas|gastos-globales)\.html|\/recetas\/(index|insumos)\.html|\/administrativo\/(staff|horarios|proveedores|clientes)\.html)$/.test(name)){
            const nav=name.startsWith('/financiero/')?'/financiero/nav.js':'/global-nav.js';
            res.setHeader('Content-Type','text/html; charset=utf-8');
            res.end('<!doctype html><html><head><meta charset="UTF-8"><script src="/negocio-tab.js"></script><script src="/__sdk-fixture.js"></script><script src="/supabase-config.js"></script></head><body><div id="ctxBar"></div><nav id="nav"><div class="nav-top"><span class="nav-brand-sub"></span></div></nav><script src="'+nav+'"></script><script src="/ctx-bar.js"></script><script>window.__rutaPrueba=true;</script></body></html>');return;
        }
        let filename=path.resolve(root,'.'+decodeURIComponent(name));
        if(!path.extname(filename)&&fs.existsSync(filename+'.html'))filename+='.html';else if(fs.existsSync(filename)&&fs.statSync(filename).isDirectory()&&fs.existsSync(path.join(filename,'index.html')))filename=path.join(filename,'index.html');
        if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||fs.statSync(filename).isDirectory()){res.writeHead(404);res.end();return;}
        if(process.env.NAV_VISUAL_SOURCE && ['etaax-ui-inicio.js','etaax-modulos-ui.css'].includes(path.basename(filename))){
            const previous=path.join(process.env.NAV_VISUAL_SOURCE,path.basename(filename));
            if(fs.existsSync(previous))filename=previous;
        }
        const ext=path.extname(filename), mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
        res.setHeader('Content-Type',mime[ext]||'text/plain');
        const etag='"'+require('node:crypto').createHash('sha256').update(fs.readFileSync(filename)).digest('hex')+'"';res.setHeader('Cache-Control','public,no-cache,must-revalidate');res.setHeader('ETag',etag);if(req.headers['if-none-match']===etag){cacheEvents.push({path:name,status:304});res.writeHead(304);res.end();return;}cacheEvents.push({path:name,status:200});
        if(ext==='.html'){
            let html=fs.readFileSync(filename,'utf8').replace(/<link[^>]*href="https:[^>]+>/g,'')
                .replace(/src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^\"]+"/g,'src="/__sdk-fixture.js"');
            res.end(html.replace('</head>','<link rel="stylesheet" href="/__visual-fonts/fonts.css"></head>'));
        }else if(name==='/supabase-config.js')res.end("var SUPABASE_URL='http://fixture.invalid';var SUPABASE_ANON='fixture';var _supabase=supabase.createClient(SUPABASE_URL,SUPABASE_ANON,{});");
        else res.end(fs.readFileSync(filename));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+server.address().port;
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'etaax-recetas-chrome-'));
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
                if(url.startsWith(base+'/')){const fail=failureSessions.get(m.sessionId);if(fail&&url.split('?')[0].endsWith('/'+fail)){await send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Failed'},m.sessionId);return;}if(delaySessions.has(m.sessionId)&&/\/(etaax-iconos|etaax-sidebar|etaax-header|etaax-modulos-ui)\.js/.test(url))await pause(1100);await send('Fetch.continueRequest',{requestId:m.params.requestId},m.sessionId);}
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
    console.log('NAVEGACIÓN VISUAL: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
