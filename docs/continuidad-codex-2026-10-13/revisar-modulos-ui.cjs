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
            order() { return q; }, limit() { return q; }, neq() { return q; }, or() { return q; },
            maybeSingle() { q.single = true; return q; }, update(value) { q.value = value; return q; },
            upsert(value) { q.value = value; return q; }, insert(value) { q.value = value; return q; },
            then(resolve, reject) {
                window.__calls.push({ type: 'table', table, filters: { ...filters }, value: q.value });
                let data = null, error = null;
                if (q.value) data = q.value;
                else if (table === 'negocios') data = negocios.filter(n => Object.keys(filters).every(k => n[k] === filters[k]));
                else if (table === 'negocio_sucursales') data = { datos: { sucursales: filters.negocio_id === 'n2' ? [{id:'matriz',nombre:'Matriz',activa:true,fechaCreado:'2026-08-07'}]
                    : [{id:'matriz',nombre:'Centro',activa:true,fechaCreado:'2026-08-07'},{id:'norte',nombre:'Norte',activa:true,fechaCreado:'2026-08-07'}], cfg:{} } };
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
                return Promise.resolve({data,error}).then(resolve,reject);
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
    const init = `window.__case=${JSON.stringify(mode)};window.__errors=[];window.__stacks=[];window.addEventListener('error',e=>window.__stacks.push({stack:e.error?.stack,file:e.filename,line:e.lineno}));window.addEventListener('error',e=>{if(e.message)window.__errors.push(e.message)});
        ${navigation ? "if(!sessionStorage.getItem('__etaax_fixture_seed')){" : ''}
        localStorage.clear();sessionStorage.clear();localStorage.setItem('etaax_negocio_activo','n1');localStorage.setItem('etaax_sucursal_activa','matriz');
        localStorage.setItem('etaax_ctx',JSON.stringify({ctxType:${JSON.stringify(mode === 'staff' ? 'staff' : 'owner')},userName:'Ana González',negId:'n1',negNombre:'Café de prueba'}));
        localStorage.setItem('etaax_qses',JSON.stringify({usuarioId:'u1',nombre:'Ana González',email:'ana@fixture.invalid',plan:'pyme',ts:Date.now()}));
        localStorage.setItem('etaax_negocios',JSON.stringify([{id:'n1',usuarioId:'u1',nombre:'Café de prueba',tipo:'cafe',organizacion:'corporativo',color:'#3dbe7a'}]));
        localStorage.setItem('etaax_n1_sucursales',JSON.stringify([{id:'matriz',nombre:'Centro',activa:true,fechaCreado:'2026-08-07'}]));
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
    const dir='/private/tmp/etaax-modulos-ui';fs.mkdirSync(dir,{recursive:true});
    const casos=[['administrativo','/administrativo/diario.html',5],['recetas','/recetas/index.html?escandallos=1',4],['financiero','/financiero/ventas.html',7],['consultoria','/consultoria/guias.html',3]];
    for(const width of [1440,390,320])for(const [id,ruta,total] of casos){
        const p=await page(base,'/hub.html','owner',width,true);await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
        await go(p,'location.href='+JSON.stringify(base+ruta),"document.querySelector('#ctxBar #etxCambiarModulo') && document.querySelector('#nav .etx-nav-identidad')");
        await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click();document.fonts.ready");await pause(300);
        const r=await evalPage(p.sid,"(()=>{const bar=document.getElementById('ctxBar').getBoundingClientRect(),nav=document.getElementById('nav').getBoundingClientRect();return{width:innerWidth,scroll:document.documentElement.scrollWidth,ctx:{top:bar.top,bottom:bar.bottom},nav:{left:nav.left,top:nav.top,width:nav.width,right:nav.right},hd:document.getElementById('etaax-header').getBoundingClientRect().bottom,tarjeta:document.querySelector('.ctx-bar-inner').getBoundingClientRect().left,cerrado:document.getElementById('nav').classList.contains('cerrado'),icons:[...document.querySelectorAll('#nav a.nav-link:not(.etx-nav-back) use')].map(x=>x.getAttribute('href')),cards:[...document.querySelectorAll('.etx-tool-card')].filter(x=>x.getClientRects().length).length,errors:__errors};})()");
        if(r.errors.length)console.log(await evalPage(p.sid,'JSON.stringify(__stacks)'));assert.ok(r.scroll<=width,JSON.stringify(r));assert.equal(r.icons.length,total);/* La barra sube junto al subheader (decisión del dueño: estaba demasiado
           abajo). Lo que se sigue exigiendo es que NO se meta bajo el header ni
           se encabalgue con la tarjeta del subheader — que es lo que de verdad
           rompería la pantalla. */
        if (width > 900) { assert.ok(r.nav.top >= r.hd, JSON.stringify(r)); assert.ok(r.nav.right <= r.tarjeta + 1, JSON.stringify(r));
            /* Y QUE NADIE LA TAPE. Medir dónde está no basta: la franja del
               subheader ocupa todo el ancho y es opaca, así que la barra puede
               estar en su sitio y aun así no verse. Se pregunta quién contesta
               en su cabecera; si no es la barra, algo le pasó por encima. */
            assert.ok(await evalPage(p.sid, "(()=>{const n=document.getElementById('nav'),r=n.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+10);return !!(e&&n.contains(e));})()"),
                      'la barra lateral quedó tapada por el subheader');
                           assert.ok(r.nav.top < r.ctx.bottom, 'la barra volvió a quedar debajo del subheader: ' + JSON.stringify(r)); }
        else { assert.ok(r.nav.top>=r.ctx.bottom, JSON.stringify(r)); }assert.equal(await evalPage(p.sid,"document.querySelectorAll('.theme-toggle').length"),0);assert.equal(await evalPage(p.sid,"document.querySelectorAll('#etaax-header').length"),1);assert.deepEqual(r.errors,[]);
        if(width<600)assert.equal(r.cerrado,true);
        if(id==='recetas'){assert.equal(r.cards,7);assert.ok(await evalPage(p.sid,"[...document.querySelectorAll('#vistaMenuReceta .cat-btn')].every(x=>x.querySelector('svg use'))"));}
        console.log(width+' '+id+': '+JSON.stringify(r));
        for(const theme of (width===1440?['dark','light']:['dark'])){
            await evalPage(p.sid,"EtaaxTheme.set("+JSON.stringify(theme)+")");await pause(150);
            const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(dir+'/'+id+'-'+width+'-'+theme+'.png',Buffer.from(shot.data,'base64'));
        }
        await evalPage(p.sid,"document.getElementById('etxCambiarModulo').click()");await until(p.sid,"document.getElementById('etxModuleDialog').open");
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('#etxModuleDialog [data-modulo]').length"),4);
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},p.sid);await until(p.sid,"!document.getElementById('etxModuleDialog').open");assert.equal(await evalPage(p.sid,'document.activeElement.id'),'etxCambiarModulo');
        await evalPage(p.sid,"document.getElementById('etxInfoSucursal').click()");assert.ok(await evalPage(p.sid,"document.getElementById('etxModuleDialog').textContent.includes('Centro')"));await evalPage(p.sid,"document.getElementById('etxModuleDialog').close()");
        await evalPage(p.sid,'toggleNav()');await pause(150);assert.ok(await evalPage(p.sid,'document.documentElement.scrollWidth<=innerWidth'));
        if(width===1440&&id==='recetas'){
            const ctx=await evalPage(p.sid,"localStorage.getItem('etaax_ctx')");await evalPage(p.sid,"document.getElementById('etxCambiarModulo').click()");
            /* Por indicación del dueño, cambiar de módulo ya NO devuelve al hub:
               entra a la portada del módulo elegido, con su barra lateral y sus
               herramientas. Antes eran dos pantallas para un movimiento lateral.
               Se sigue exigiendo lo de siempre: el negocio y la sucursal no se
               mueven, y el hub queda enterado del módulo por si se vuelve. */
            await go(p,"document.querySelector('#etxModuleDialog [data-modulo=\"financiero\"]').click()",/* Se espera al botón del subheader, no al título: el título es marcado
               estático y ya está antes de que los scripts pinten la barra, así que
               esperarlo a él dejaba la comprobación corriendo contra una pantalla a
               medio montar —y pasaba o fallaba según lo rápido que fuera el equipo. */
            "location.pathname==='/financiero/index.html' && document.getElementById('etxCambiarModulo')");assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_ctx')"),ctx);assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'matriz');
            assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_hub_modulo')"),'financiero');
            assert.equal(await evalPage(p.sid,"document.querySelector('#etxCambiarModulo')?1:0"),1);
            console.log('Cambiar módulo ENTRA al módulo, conserva contexto y sucursal.');
        }
        await close(p);
    }
    const embed=await page(base,'/hub.html','owner',1440,true);await send('Network.setExtraHTTPHeaders',{headers:{}},embed.sid);await go(embed,'location.href='+JSON.stringify(base+'/recetas/index.html?embed=1&escandallos=1'),"document.getElementById('vistaMenuReceta')?.style.display==='flex'");assert.equal(await evalPage(embed.sid,"document.querySelector('#etaax-header')"),null);assert.equal(await evalPage(embed.sid,"document.body.classList.contains('etx-modulos-ui')"),false);await close(embed);
    assert.equal(forbidden.length,0);console.log('REVISIÓN: PC, móvil, temas, selector, tarjetas e iframe correctos.');
}
(async()=>{
    server=http.createServer((req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name.startsWith('/__visual-fonts/')){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'font/ttf');res.end(fs.readFileSync(path.join(__dirname, 'fuentes') + path.sep+path.basename(name)));return;}
        if(name==='/__sdk-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end('('+sdkFixture.toString()+')()');return;}
        /* Las pruebas de ruta no cargan ni prueban el cálculo de cada reporte:
           usan el URL real, el contexto persistido y sus nav/ctx-bar reales. */
        if(req.headers['x-etaax-prueba-rutas']==='1' && /^(\/financiero\/(ventas|resumen|kpis|estadisticas|gastos-globales)\.html|\/recetas\/(index|insumos)\.html|\/administrativo\/(staff|horarios|proveedores|clientes)\.html)$/.test(name)){
            const nav=name.startsWith('/financiero/')?'/financiero/nav.js':'/global-nav.js';
            res.setHeader('Content-Type','text/html; charset=utf-8');
            res.end('<!doctype html><html><head><meta charset="UTF-8"><script src="/negocio-tab.js"></script><script src="/__sdk-fixture.js"></script><script src="/supabase-config.js"></script></head><body><div id="ctxBar"></div><nav id="nav"><div class="nav-top"><span class="nav-brand-sub"></span></div></nav><script src="'+nav+'"></script><script src="/ctx-bar.js"></script><script>window.__rutaPrueba=true;</script></body></html>');return;
        }
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
    const profile=fs.mkdtempSync('/private/tmp/etaax-cuenta-chrome-');
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
    console.log('CUENTA Y HEADER: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
