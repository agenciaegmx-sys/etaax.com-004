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
            order() { return q; }, range() { return q; }, limit() { return q; }, neq() { return q; }, or() { return q; }, delete() { q.deleting=true; return q; }, not() { return q; }, in() { return q; }, is() { return q; },
            maybeSingle() { q.single = true; return q; }, update(value) { q.value = value; return q; },
            upsert(value) { q.value = value; return q; }, insert(value) { q.value = value; return q; },
            then(resolve, reject) {
                window.__calls.push({ type: 'table', table, filters: { ...filters }, value: q.value });
                let data = null, error = null;
                if (q.value) {
                    data = q.value;
                    if(['staff','recetas','insumos','negocio_insumos'].includes(table)) {
                        const registros=Array.isArray(q.value)?q.value:[q.value];
                        const prev=JSON.parse(sessionStorage.getItem('__fixture_'+(table==='negocio_insumos'?'insumos':table))||'[]');registros.forEach(r=>{const i=prev.findIndex(x=>x.id===r.datos.id);if(i>=0)prev[i]=r.datos;else prev.push(r.datos);});sessionStorage.setItem('__fixture_'+(table==='negocio_insumos'?'insumos':table),JSON.stringify(prev));
                    }
                }
                else if(['staff','recetas','insumos','negocio_insumos'].includes(table)) data=q.deleting?[]:JSON.parse(sessionStorage.getItem('__fixture_'+(table==='negocio_insumos'?'insumos':table))||'[]').map(datos=>({datos}));
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

async function run(base) {
    const dir=path.join(os.tmpdir(),'etaax-abarrotes-calculo');fs.mkdirSync(dir,{recursive:true});
    async function shot(sid,name){await pause(180);const s=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(s.data,'base64'));}
    for(const width of [1440,390]) {
        const {targetId}=await send('Target.createTarget',{url:'about:blank'});
        const {sessionId:sid}=await send('Target.attachToTarget',{targetId,flatten:true});
        await send('Page.enable',{},sid);await send('Fetch.enable',{patterns:[{urlPattern:'*'}]},sid);
        await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<720},sid);
        await send('Page.addScriptToEvaluateOnNewDocument',{source:`
            window.__errors=[];window.addEventListener('error',e=>{if(e.message)__errors.push(e.message)});window.addEventListener('unhandledrejection',e=>__errors.push(String(e.reason?.stack||e.reason)));
            localStorage.clear();sessionStorage.clear();localStorage.setItem('etaax_negocio_activo','n1');localStorage.setItem('etaax_sucursal_activa','suc_principal');
            localStorage.setItem('etaax_ctx',JSON.stringify({ctxType:'owner',userName:'Ana González',negId:'n1',negNombre:'Café de prueba'}));
            localStorage.setItem('etaax_qses',JSON.stringify({usuarioId:'u1',nombre:'Ana González',email:'ana@fixture.invalid',plan:'pyme',ts:Date.now()}));
            localStorage.setItem('etaax_negocios',JSON.stringify([{id:'n1',usuarioId:'u1',nombre:'Café de prueba',tipo:'cafe',organizacion:'corporativo'}]));
        `},sid);
        await send('Page.navigate',{url:base+'/recetas/insumos.html'},sid);
        await until(sid,"typeof abrirModalConTipo==='function' && typeof EtaaxCore==='object' && typeof getInsumos==='function' && _insumosSupaCargado");
        await evalPage(sid,`document.getElementById('etaaxNovOk')?.click();abrirModalConTipo('abarrote');document.getElementById('ins-nombre').value='Cerezas de prueba';
            window.campo=function(k,v){
                var esPrecio=k==='precio', sel=k==='presentacionCompra'?'select[onchange^="onPresCompraChange(0"]':k==='umPresCompra'?'select[onchange^="onUmPresChange(0"]':null;
                var el=esPrecio?document.querySelector('#listaPresentaciones input[oninput^="inputPrecioRaw"]'):sel?document.querySelector('#listaPresentaciones '+sel):Array.from(document.querySelectorAll('#listaPresentaciones input,#listaPresentaciones select')).find(e=>(e.getAttribute('oninput')||e.getAttribute('onchange')||'').includes("updPres(0,'"+k+"'"));
                if(!el)throw new Error('Sin campo '+k);el.focus();el.value=v;el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return el===document.activeElement;
            };
            campo('cantPresCompra','1');campo('umPresCompra','PZA');campo('umContenido','KG');campo('contNeto','2.1');campo('masaDrenada','900');campo('incluyeImpuesto','1');campo('precio','30');campo('nombreSubUnidad','Cerezas');`);
        for(const n of ['1','15','150'])assert.equal(await evalPage(sid,`campo('unidadesPorPieza',${JSON.stringify(n)})`),true,'Conservar foco mientras se capturan varias cifras');
        const leer=()=>evalPage(sid,`({p:presentacionesTemp[0],bote:document.getElementById('ref-pieza-0').textContent,kilo:document.getElementById('ref-costoum-0').textContent,cereza:document.getElementById('ref-subun-0').textContent,peso:document.getElementById('peso-subun-0').textContent})`);
        let r=await leer();assert.equal(r.p.contNeto,'2.1');assert.match(r.bote,/30\.00/);assert.match(r.kilo,/33\.33/);assert.match(r.cereza,/0\.200/);assert.match(r.peso,/6 G/);
        await evalPage(sid,"document.getElementById('ref-pieza-0').scrollIntoView({block:'center'})");await shot(sid,'cerezas-drenadas-'+width);
        await evalPage(sid,"campo('masaDrenada','')");r=await leer();assert.equal(await evalPage(sid,"document.getElementById('precio-final-masa-0').textContent"),'');assert.match(r.kilo,/14\.29/);assert.match(r.cereza,/0\.200/);assert.match(r.peso,/14 G/);
        await evalPage(sid,"campo('masaDrenada','900');document.querySelector('#modalOverlay [onclick=\"guardarInsumo()\"]').click()");
        await until(sid,"getInsumos().some(x=>x.nombre==='Cerezas de prueba') && document.getElementById('modalOverlay').style.display==='none'");
        await until(sid,"__calls.some(c=>c.table==='negocio_insumos' && c.value)");
        const guardado=await evalPage(sid,"getInsumos().find(x=>x.nombre==='Cerezas de prueba')");
        assert.equal(guardado.presentaciones[0].contNeto,'2.1');assert.equal(guardado.presentaciones[0].costoSubUnidad,'0.20000000');
        await evalPage(sid,"editarInsumo(getInsumos().find(x=>x.nombre==='Cerezas de prueba').id)");
        r=await leer();assert.equal(r.p.unidadesPorPieza,'150');assert.match(r.kilo,/33\.33/);assert.match(r.peso,/6 G/);
        await evalPage(sid,"campo('presentacionCompra','Kilo');campo('umPresCompra','KG');campo('cantPresCompra','1');campo('contNeto','1');campo('masaDrenada','');campo('unidadesPorPieza','16');campo('nombreSubUnidad','Huevos');campo('precio','30')");
        r=await leer();assert.equal(r.p.contNeto,'1');assert.match(r.kilo,/30\.00/);assert.match(r.cereza,/1\.875/);assert.match(r.peso,/62\.5 G/);
        await evalPage(sid,"campo('cantPresCompra','2');campo('precio','60');document.getElementById('ref-pieza-0').scrollIntoView({block:'center'})");
        r=await leer();assert.match(r.bote,/30\.00/);assert.match(r.kilo,/30\.00/);assert.match(r.cereza,/1\.875/);await shot(sid,'huevos-granel-'+width);
        await evalPage(sid,"campo('precio','')");r=await leer();assert.equal(Number(r.p.costoPieza),0);assert.equal(Number(r.p.costoUnitario),0);assert.equal(Number(r.p.costoSubUnidad),0);
        assert.deepEqual(await evalPage(sid,'__errors'),[]);
        results.push('editor-'+width);console.log('PASA '+width+'px: cerezas, masa drenada, foco, guardar/reabrir, granel por KG y limpiar precio.');
        await send('Target.closeTarget',{targetId});
    }
    console.log('Capturas: '+dir);
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
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'etaax-abarrotes-chrome-'));
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
    console.log('ABARROTES: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
