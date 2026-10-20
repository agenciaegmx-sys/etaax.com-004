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


async function run(base){
 const dir=__dirname;
 const tipos=['destilado','licor','vino','refresco','cerveza','cerveza_barril','abarrote','carne','fruta','otro'];
 const pres={id:'p1',presentacionCompra:'Botella',cantPresCompra:1,umPresCompra:'PZA',contNeto:1000,umContenido:'ML',precio:300,costoUnitario:300,umCosto:'LT',costoPieza:300,proveedor:'Proveedor de prueba',zona:'Morelia',incluyeImpuesto:'1',iva:true,ieps:false,mlCopa:60,stockMin:1,stockMax:4};
 const insumos=tipos.map((t,i)=>({id:'i'+i,nombre:i?'Insumo '+t:'Carpano de prueba',tipoInsumo:t,marca:'Marca de prueba',variedad:'Variedad',activo:'1',sucursalId:'suc_principal',familia:i<6?'Bebidas':'Abarrotes',categoria:i<6?'Destilados':'Abarrotes',area:'barra',notas:'Descripción del producto de prueba. Se conserva el texto y las condiciones de almacenamiento.',presentaciones:[{...pres,id:'p'+i}]}));
 insumos[6].nombre='Cerezas de prueba';insumos[6].presentaciones=[{...pres,id:'p6',presentacionCompra:'Pieza',contNeto:2.1,umContenido:'KG',masaDrenada:900,umMasaDrenada:'G',unidadesPorPieza:150,nombreSubUnidad:'Cereza',costoUnitario:333.333333,umCosto:'KG',costoSubUnidad:2}];
 insumos.push({id:'norte',nombre:'Exclusivo Norte',tipoInsumo:'abarrote',activo:'1',sucursalId:'norte',presentaciones:[pres]});
 const receta={id:'r1',nombre:'South Side de prueba',tipo:'bebidas',status:'activa',sucursales:['suc_principal'],sucursalId:'suc_principal',grupo:'Clásicos',precioEnCarta:116,ingredientes:Array.from({length:16},(_,i)=>({insumoId:'i0',nombre:'Carpano de prueba',cantidad:10+i,unidad:'ML',costoPorKgLt:300,desc:'Prueba de scroll'})),camposExtra:{tipoMedicion:'granel',porcionCant:1,porcionUnidad:'BEBIDA'}};
 async function shot(p,name){await pause(150);const r=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(r.data,'base64'));}
 async function bounded(p,doc='document'){
  const a=await evalPage(p.sid,`(()=>{const d=${doc};return {w:d.defaultView.innerWidth,s:d.documentElement.scrollWidth}})()`);
  if(a.s>a.w+1)console.log('DESBORDE',await evalPage(p.sid,`(()=>{const d=${doc},w=d.defaultView.innerWidth;return [...d.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();if(r.width<=0||r.right<=w+1)return false;for(let p=e.parentElement;p&&p!==d.body;p=p.parentElement)if(/auto|scroll|hidden|clip/.test(d.defaultView.getComputedStyle(p).overflowX)&&p.getBoundingClientRect().right<=w+1)return false;return true;}).slice(0,10).map(e=>({id:e.id,cl:e.className,r:e.getBoundingClientRect().right,style:e.getAttribute('style')}))})()`));
  assert.ok(a.s<=a.w+1,JSON.stringify(a));
 }
 for(const width of (process.env.INS_WIDTHS?process.env.INS_WIDTHS.split(',').map(Number):[1440,768,390,320])){
  const p=await page(base,'/hub.html','owner',width,true);await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
  await evalPage(p.sid,`sessionStorage.setItem('__fixture_insumos',${JSON.stringify(JSON.stringify(insumos))});sessionStorage.setItem('__fixture_recetas',${JSON.stringify(JSON.stringify([receta]))});`);
  await go(p,"location.href='/recetas/insumos'","document.readyState==='complete' && typeof editarInsumo==='function' && document.querySelector('.etx-insumos-page')");
  await until(p.sid,"getInsumos().length>=11 && document.querySelector('#btnAgregarInsumo .i-ui-icon')");await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click();document.fonts.ready");
  await check('Lista, galería, costeo, filtros y selección por sucursal · '+width,async()=>{
   await evalPage(p.sid,"setVistaInsumos('lista')");await until(p.sid,"document.querySelector('#tbodyInsumos .i-ui-icon')");assert.equal(await evalPage(p.sid,"tbodyInsumos.textContent.includes('Exclusivo Norte')"),false);await shot(p,'catalogo-'+width);await bounded(p);
   await evalPage(p.sid,"searchInput.value='Cerezas';filtrar()");assert.equal(await evalPage(p.sid,'tbodyInsumos.rows.length'),1);
   await evalPage(p.sid,"searchInput.value='';filtrar();setVistaInsumos('grid')");await until(p.sid,"document.querySelector('#gridInsumos .i-ui-icon')");await shot(p,'galeria-'+width);await bounded(p);
   await evalPage(p.sid,"setVistaInsumos('costeo')");await bounded(p);await evalPage(p.sid,"setVistaInsumos('lista');toggleModoSeleccion()");assert.equal(await evalPage(p.sid,"getComputedStyle(btnModoSeleccion).display!=='none'"),true);await evalPage(p.sid,"toggleModoSeleccion();btnAgregarInsumo.style.display='none';document.body.appendChild(document.createElement('span'))");await pause(60);assert.equal(await evalPage(p.sid,'getComputedStyle(btnAgregarInsumo).display'),'none');await evalPage(p.sid,"btnAgregarInsumo.style.display=''");
  });
  await check('Selector de tipos con iconos y controles originales · '+width,async()=>{await evalPage(p.sid,'abrirSelectorCategoria()');await until(p.sid,"document.querySelectorAll('#modalCategoria .cat-btn .i-ui-icon').length===10");await bounded(p);await shot(p,'tipos-'+width);await evalPage(p.sid,"modalCategoria.style.display='none'");});
  for(const tipo of (width===1440||width===390?tipos:['destilado','abarrote','cerveza_barril'])){
   const idx=tipos.indexOf(tipo);
   await check('Editor '+tipo+' conserva campos, costos y pie visible · '+width,async()=>{
    await evalPage(p.sid,`editarInsumo('i${idx}')`);await until(p.sid,"getComputedStyle(modalOverlay).display!=='none' && document.querySelector('#modalTitulo .i-title-copy') && document.querySelector('.i-presentacion .i-ui-icon')");
    assert.equal(await evalPage(p.sid,"document.getElementById('ins-nombre').value"),insumos[idx].nombre);
    assert.equal(await evalPage(p.sid,'presentacionesTemp[0].precio'),300);
    if(tipo==='abarrote'){const a=await evalPage(p.sid,"(()=>{const p=presentacionesTemp[0];return {kg:Number(p.costoUnitario),pz:Number(p.costoPieza),u:Number(p.costoSubUnidad)}})()");assert.ok(Math.abs(a.kg-333.333333)<.01,JSON.stringify(a));assert.equal(a.pz,300);assert.equal(a.u,2);}
    assert.ok(await evalPage(p.sid,"document.querySelector('#modalOverlay [onclick=\"guardarInsumo()\"]').getBoundingClientRect().bottom<=innerHeight"));
    await bounded(p);if(['destilado','abarrote'].includes(tipo)){await shot(p,'editor-'+tipo+'-'+width);await evalPage(p.sid,"document.querySelector('#modalOverlay .modal-body').scrollTop=99999");await shot(p,'costos-'+tipo+'-'+width);}
    await evalPage(p.sid,'cerrarModalBtn()');
   });
  }
  await check('Ficha, nombre vivo, convertir y minimizar/restaurar · '+width,async()=>{
   await evalPage(p.sid,"verFicha('i0')");await until(p.sid,"document.querySelector('#modalFicha .i-title-plate') && document.querySelector('.i-ficha-identidad')");await bounded(p);await shot(p,'ficha-'+width);assert.equal(await evalPage(p.sid,"fichaContenido.textContent.includes('300.00')"),true);await evalPage(p.sid,"modalFicha.style.display='none';editarInsumo('i0');document.getElementById('ins-nombre').value='Nombre actualizado';document.getElementById('ins-nombre').dispatchEvent(new Event('input',{bubbles:true}))");assert.equal(await evalPage(p.sid,'insNombreHd.textContent'),'Nombre actualizado');
   await evalPage(p.sid,"btnConvertirTipo.click()");await until(p.sid,"getComputedStyle(convertirTipoPop).display!=='none'");await bounded(p);await evalPage(p.sid,"btnConvertirTipo.click();document.querySelector('#modalOverlay .etx-min-btn').click();document.querySelector('#etx-dock .etx-chip').click()");assert.equal(await evalPage(p.sid,"document.getElementById('ins-nombre').value"),'Nombre actualizado');await evalPage(p.sid,'cerrarModalBtn()');
  });
  if(width===1440||width===390){await check('Tema claro y guardar mantiene presentación e importes · '+width,async()=>{
   await evalPage(p.sid,"EtaaxTheme.set('light');editarInsumo('i6')");await shot(p,'editor-claro-'+width);await evalPage(p.sid,"document.getElementById('ins-nombre').value='Cerezas guardadas';guardarInsumo()");await until(p.sid,"getComputedStyle(modalOverlay).display==='none' && getInsumos().find(x=>x.id==='i6').nombre==='Cerezas guardadas'");
   const a=await evalPage(p.sid,"getInsumos().find(x=>x.id==='i6').presentaciones[0]");assert.equal(Number(a.precio),300);assert.equal(a.masaDrenada,900);assert.equal(a.unidadesPorPieza,150);assert.equal(Number(a.costoSubUnidad),2);await evalPage(p.sid,"EtaaxTheme.set('dark')");
  });}
  assert.deepEqual(await evalPage(p.sid,'__errors'),[]);
  await go(p,"location.href='/recetas/index?escandallos=1'","typeof abrirEscModal==='function' && document.readyState==='complete'");await until(p.sid,'getRecetas().length>=1');await evalPage(p.sid,"abrirFichaReceta('r1');btnFichaEditar.click()");
  await until(p.sid,"iframeInsumo.contentWindow.location.pathname.includes('index') && iframeInsumo.contentDocument.readyState==='complete' && iframeInsumo.contentDocument.getElementById('editorWrap')?.style.display!=='none' && iframeInsumo.contentDocument.getElementById('tbodyIngredientes')?.rows.length>=16");
  const fx=exp=>evalPage(p.sid,'iframeInsumo.contentWindow.eval('+JSON.stringify(exp)+')');
  await check('Botón y menú de insumos quedan debajo del header al desplazar · '+width,async()=>{
   await fx("window.__b=document.querySelector('[onclick=\"_toggleInsumoMenu(event)\"]');window.__h=document.getElementById('recetaEditorHeader');window.scrollTo(0,__b.getBoundingClientRect().top+scrollY-__h.offsetHeight/2)");await pause(100);
   const m=await fx("(()=>{const r=__b.getBoundingClientRect(),h=__h.getBoundingClientRect();return {bt:r.top,bb:r.bottom,ht:h.top,hb:h.bottom,front:__h.contains(document.elementFromPoint(r.left+r.width/2,Math.max(1,r.top+r.height/2)))}})()");assert.ok(m.bt<m.hb&&m.bb>m.ht,JSON.stringify(m));assert.equal(m.front,true,JSON.stringify(m));await shot(p,'escandallo-scroll-'+width);
   await fx("__b.click()");const covered=await fx("(()=>{const h=__h.getBoundingClientRect();return __h.contains(document.elementFromPoint(h.left+h.width/2,h.top+h.height/2))})()");assert.equal(covered,true);await fx("window.scrollTo(0,0);insumoMenu.style.display='none';__b.scrollIntoView({block:'center'})");await pause(100);await fx("__b.click()");
   assert.equal(await fx("getComputedStyle(insumoMenu).display!=='none'"),true);const visible=await fx("(()=>{const r=insumoMenu.querySelector('button').getBoundingClientRect();return insumoMenu.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()");assert.equal(visible,true);assert.equal(await fx("insumoMenu.getBoundingClientRect().top>=__h.getBoundingClientRect().bottom"),true);await fx("window.scrollBy(0,20)");await pause(60);assert.equal(await fx("getComputedStyle(insumoMenu).display"),'none');
   await bounded(p,'iframeInsumo.contentDocument');assert.deepEqual(await fx('__errors'),[]);
  });
  await close(p);
 }
 assert.equal(forbidden.length,0);
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
        if(!path.extname(filename)&&fs.existsSync(filename+'.html'))filename+='.html';
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
    console.log('INSUMOS: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
