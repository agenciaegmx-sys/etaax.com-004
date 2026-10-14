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
const root = path.resolve(__dirname, '..');
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
/* ── Los casos de la primera entrega ────────────────────────────────────── */
async function run(base) {
    /* Estas puertas se abren con un QR: no hay sesión del panel ni contexto de
       negocio. Se cargan tal cual, como las abre un colaborador. */
    async function abrir(ruta, ancho) {
        const { targetId } = await send('Target.createTarget', { url:'about:blank' });
        const { sessionId:sid } = await send('Target.attachToTarget', { targetId, flatten:true });
        await send('Page.enable', {}, sid);
        await send('Fetch.enable', {patterns:[{urlPattern:'*'}]}, sid);
        await send('Runtime.enable', {}, sid);
        await send('Emulation.setDeviceMetricsOverride', {width:ancho,height:760,deviceScaleFactor:1,mobile:ancho<720}, sid);
        await send('Page.addScriptToEvaluateOnNewDocument',
            {source:'window.__errors=[];window.addEventListener("error",function(e){if(e.message)window.__errors.push(e.message)});'}, sid);
        await send('Page.navigate', {url:base+ruta}, sid);
        await until(sid, "document.readyState==='complete'");
        await pause(600);
        return { sid, targetId };
    }

    for (const ancho of [320, 390, 1440]) {
        for (const ruta of ['/entrada.html', '/checklist.html']) {
            const p = await abrir(ruta, ancho);
            await check(ruta + ' a ' + ancho + 'px: el regreso al menú se ve y se toca', async () => {
                const d = await evalPage(p.sid, `(()=>{
                    const b=[...document.querySelectorAll('.volver-menu')];
                    const uno=b[0]; if(!uno) return JSON.stringify({error:'sin botón de menú'});
                    /* Se mide uno que esté a la vista: los demás viven en pantallas ocultas. */
                    uno.closest('[id$=Screen]') && (uno.closest('[id$=Screen]').style.display='block');
                    const r=uno.getBoundingClientRect(), cs=getComputedStyle(uno);
                    return JSON.stringify({cuantos:b.length, alto:Math.round(r.height), texto:uno.textContent.trim(),
                        pegado:cs.position, fondo:cs.backgroundColor!=='rgba(0, 0, 0, 0)',
                        errores:window.__errors.slice(0,3)});})()`);
                const o = JSON.parse(d);
                assert.ok(o.cuantos > 0, 'no hay botón de regreso al menú');
                assert.ok(o.alto >= 48, 'mide ' + o.alto + 'px: un dedo no acierta por debajo de 48');
                assert.equal(o.texto, 'Regresar al menú');
                assert.equal(o.pegado, 'sticky', 'se pierde al recorrer una lista larga');
                assert.ok(o.fondo, 'sin fondo opaco, el contenido se lee por debajo');
                assert.deepEqual(o.errores, []);
            });
            await check(ruta + ' a ' + ancho + 'px: se puede hacer zoom', async () => {
                const v = await evalPage(p.sid, "(document.querySelector('meta[name=viewport]')||{}).content||''");
                assert.ok(!/maximum-scale/.test(v), 'el zoom sigue bloqueado: ' + v);
            });
            await check(ruta + ' a ' + ancho + 'px: sin desbordamiento horizontal', async () => {
                const ok = await evalPage(p.sid, 'document.documentElement.scrollWidth<=innerWidth+1');
                assert.ok(ok, 'la pantalla se sale de ancho');
            });
            await send('Target.closeTarget', { targetId: p.targetId });
        }
    }

    /* La flecha de la marca sustituye a la de texto, y espera al sprite si
       llega tarde — el «rendirse en silencio» que ya costó dos diagnósticos. */
    {
        const p = await abrir('/entrada.html', 390);
        await check('la flecha es el icono de la marca, no un carácter', async () => {
            const d = await evalPage(p.sid, `(()=>{
                const b=document.querySelector('.volver-menu');
                return JSON.stringify({svg:!!b.querySelector('svg use'), texto:b.textContent.trim()});})()`);
            const o = JSON.parse(d);
            assert.ok(o.svg, 'la flecha sigue siendo un carácter de texto');
            assert.equal(o.texto, 'Regresar al menú', 'quedó la flecha de texto dentro del rótulo');
        });
        await check('el ayudante no toca el NIP ni las llamadas al servidor', async () => {
            const js = fs.readFileSync(path.join(root, 'portal-operativo.js'), 'utf8');
            assert.ok(!/rpc|supabase|nip|NIP|token/i.test(js.replace(/\/\*[\s\S]*?\*\//g, '')),
                      'el ayudante de presentación se metió con datos o con el acceso');
        });
        await send('Target.closeTarget', { targetId: p.targetId });
    }

    /* Captura empareja una foto con una captura de la computadora: NO tiene
       menú al que volver, y el plan prohíbe inventarle uno. */
    {
        const p = await abrir('/captura.html', 390);
        await check('captura.html recibe el estilo pero NO un regreso inventado', async () => {
            const d = await evalPage(p.sid, `JSON.stringify({
                portal:document.body.classList.contains('etx-portal'),
                menus:document.querySelectorAll('.volver-menu').length,
                errores:window.__errors.slice(0,3)})`);
            const o = JSON.parse(d);
            assert.ok(o.portal, 'no recibió el estilo del portal');
            assert.equal(o.menus, 0, 'le inventaron un menú que no existe');
            assert.deepEqual(o.errores, []);
        });
        await send('Target.closeTarget', { targetId: p.targetId });
    }

    /* Una foto de cada puerta, para mirarla con ojos y no solo medirla. */
    for (const [ruta, nombre] of [['/entrada.html','entrada'], ['/checklist.html','checklist']]) {
        const p = await abrir(ruta, 390);
        await evalPage(p.sid, "document.querySelectorAll('[id$=Screen]').forEach(function(d,i){d.style.display=i===0?'block':'none'});");
        await pause(400);
        const shot = await send('Page.captureScreenshot', { format:'png' }, p.sid);
        fs.writeFileSync('/private/tmp/portal-' + nombre + '.png', Buffer.from(shot.data,'base64'));
        await send('Target.closeTarget', { targetId: p.targetId });
    }

    assert.equal(forbidden.length, 0, 'alguna página pidió algo fuera del origen de prueba');
    console.log('PORTAL QR: ' + results.length + ' casos, 0 fallas. Sin NIP, sin token y sin datos reales.');
}

(async()=>{
    server=http.createServer((req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name.startsWith('/__visual-fonts/')){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'font/ttf');res.end(fs.readFileSync(path.join(root, 'docs/continuidad-codex-2026-10-13/fuentes') + path.sep+path.basename(name)));return;}
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
