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
    throw new Error('No se cumplió: ' + expression + ' · '+JSON.stringify(await evalPage(sid,'({url:location.href,errors:window.__errors,stacks:window.__stacks,ready:document.readyState,admin:typeof AdminDocs,calls:window.__calls?.slice(-3)})')));
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
    let user = { id: staff ? 's1' : 'u1', email: mode==='admin' ? 'admin@etaax.com' : staff ? 'compartida@fixture.invalid' : 'ana@fixture.invalid',
        user_metadata: { nombre: mode === 'xss' ? 'Ana <img src=x onerror="window.__xss=1">' : 'Ana González' } };
    window.__calls = [];
    const negocios = [{ id: 'n1', usuario_id: 'u1', staff_uid: 's1', datos: { nombre: 'Café de prueba', tipo: 'cafe', organizacion: 'corporativo', color: '#3dbe7a' } },
        { id: 'n2', usuario_id: 'u1', staff_uid: 's2', datos: { nombre: 'Otra marca', tipo: 'restaurante', color: '#3dbe7a' } }];
    function query(table) {
        const filters = {}, q = { select() { return q; }, eq(k,v) { filters[k] = v; return q; },
            range(start) { q.start=start; return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, neq() { return q; }, or() { return q; },
            single() { q.isSingle=true;return q; }, maybeSingle() { q.isSingle = true; return q; }, update(value) { q.value = value; return q; },
            upsert(value) { q.value = value; return q; }, insert(value) { q.value = value; return q; },
            then(resolve, reject) {
                window.__calls.push({ type: 'table', table, filters: { ...filters }, value: q.value });
                let data = null, error = null;
                if (q.value) {
                    data = q.value;
                    if (table === 'negocio_insumos' || table === 'recetas' || table === 'inventarios') {
                        const key = table === 'inventarios' ? '__fixture_inventarios' : table === 'recetas' ? '__fixture_recetas' : '__fixture_insumos';
                        const prev = JSON.parse(sessionStorage.getItem(key) || '[]');
                        (Array.isArray(q.value) ? q.value : [q.value]).forEach(r => {
                            const i = prev.findIndex(x => x.id === r.datos.id);
                            if (i >= 0) prev[i] = r.datos; else prev.push(r.datos);
                        });
                        sessionStorage.setItem(key, JSON.stringify(prev));
                    }
                }
                else if (table === 'admin_documentos') data = (q.start>0?[]:JSON.parse(sessionStorage.getItem('__fixture_admin_docs')||'[]')).filter(d=>Object.keys(filters).every(k=>d[k]===filters[k]));
                else if (table === 'negocio_insumos') data = q.start > 0 ? [] : JSON.parse(sessionStorage.getItem('__fixture_insumos') || '[]').map(datos => ({datos}));
                else if (table === 'inventarios') data = JSON.parse(sessionStorage.getItem('__fixture_inventarios') || '[]').map(datos => ({datos}));
                else if (table === 'recetas') data = q.start > 0 ? [] : JSON.parse(sessionStorage.getItem('__fixture_recetas') || '[]').map(datos => ({datos}));
                else if (table === 'negocios') data = negocios.filter(n => Object.keys(filters).every(k => n[k] === filters[k]));
                else if (table === 'negocio_sucursales') data = { datos: { sucursales: filters.negocio_id === 'n2' ? [{id:'matriz',nombre:'Matriz',activa:true,fechaCreado:'2026-08-07'}]
                    : [{id:'matriz',nombre:'Centro',activa:true,fechaCreado:'2026-08-07'},{id:'norte',nombre:'Norte',activa:true,fechaCreado:'2026-08-07'}], cfg:{} } };
                else if (table === 'suscripciones') data = { estado: mode === 'pending' ? 'pendiente' : mode === 'stripe' ? 'vencida' : 'activa', proximo_cobro: '2026-11-13', dias_tolerancia:3,
                    stripe_subscription_id: mode === 'stripe' ? 'sub_fixture' : null };
                else if (table === 'catalogo_insumos') data = q.start > 0 ? [] : JSON.parse(sessionStorage.getItem('__fixture_catalogo') || 'null')?.map(datos => ({datos})) || [{datos:{id:'cat-prueba',nombre:'Ron de prueba',marca:'Marca de prueba',familia:'Bebidas',categoria:'Destilados',presentaciones:[{contNeto:1000,umContenido:'ML',precio:300}]}}];
                else if (table === 'usuarios') data = { id:'u1',nombre:user.user_metadata.nombre,plan:'pyme' };
                else data = q.isSingle ? null : [];
                if(mode==='admin' && !q.value && !q.isSingle){
                    if(table==='usuarios')data=[{id:'u1',nombre:'Admin de prueba',email:'admin@etaax.com',plan:'pyme'}];
                    if(table==='suscripciones')data=[];
                    if(table==='negocio_sucursales'&&!filters.negocio_id)data=[{negocio_id:'n1',datos:{sucursales:[{id:'matriz',nombre:'Centro',activa:true},{id:'norte',nombre:'Norte',activa:true}],cfg:{}}}];
                }
                if (window.__fail && table === 'suscripciones') error = { message:'Fallo controlado' };
                if (q.isSingle && Array.isArray(data)) data = data[0] || null;
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
                if(name==='is_platform_admin')return {data:mode==='admin',error:null};
                if(name==='admin_documento_crear'||name==='admin_documento_actualizar'){
                    if(mode!=='admin'||window.__failDocs)return {data:null,error:{message:'Fallo controlado de guardado'}};
                    const docs=JSON.parse(sessionStorage.getItem('__fixture_admin_docs')||'[]');let d;
                    if(name==='admin_documento_crear'){
                        d={...args.p_documento,folio:args.p_documento.folio.trim().toUpperCase(),version:1,cambios:[{accion:'creado'}],origen:args.p_documento.origen||'generado'};
                        const same=docs.find(x=>x.id===d.id);if(same)return {data:same,error:null};
                        if(docs.some(x=>x.folio===d.folio||d.presupuesto_id&&x.presupuesto_id===d.presupuesto_id))return {data:null,error:{code:'23505',message:'Duplicado'}};
                        docs.push(d);
                    }else{
                        const at=docs.findIndex(x=>x.id===args.p_id);if(at<0||docs[at].version!==args.p_version)return {data:null,error:{message:'El documento cambió en otra ventana'}};
                        d={...docs[at],...args.p_cambios,version:args.p_version+1};d.cambios=[...docs[at].cambios,{accion:'actualizado'}];if(d.estado!=='pagado')d.fecha_pago=null;docs[at]=d;
                    }
                    sessionStorage.setItem('__fixture_admin_docs',JSON.stringify(docs));return {data:d,error:null};
                }

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
    const init = `window.__case=${JSON.stringify(mode)};window.__errors=[];window.__stacks=[];window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason?.stack||e.reason)));window.addEventListener('error',e=>window.__stacks.push({stack:e.error?.stack,file:e.filename,line:e.lineno}));window.addEventListener('error',e=>{if(e.message)window.__errors.push(e.message)});
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
 const dir=path.join(os.tmpdir(),'etaax-ventanas-insumos');fs.mkdirSync(dir,{recursive:true});
 if (process.env.ETAAX_PRUEBA_DOCUMENTOS) { await probarDocumentosAdmin(base,dir); return; }
 if (process.env.ETAAX_PRUEBA_SALIDAS) { await probarSalidasCalendario(base,dir); return; }
 if (process.env.ETAAX_PRUEBA_STOCK) { await probarStockCosteo(base,dir); return; }
 if (process.env.ETAAX_PRUEBA_TOUCH) { await probarReordenTactil(base,dir); return; }
 if (process.env.ETAAX_PRUEBA_RENDIMIENTOS) { await probarRendimientosSucursales(base,dir); return; }
 for(const width of [1440,768,390]){
  const p=await page(base,'/hub.html','owner',width,true);
  await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
  await go(p,'location.href='+JSON.stringify(base+'/recetas/index.html'),"typeof abrirEscModal==='function' && document.querySelector('#ctxBar #etxCambiarModulo')");
  await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click();abrirEscModal('alimentos')");
  const editor="document.getElementById('iframeInsumo').contentWindow";
  await until(p.sid,editor+" && typeof "+editor+".abrirInsumoDesde==='function'");
  for(const mode of ['etaax','globalneg','nuevo']){
   await evalPage(p.sid,editor+".abrirInsumoDesde("+JSON.stringify(mode)+")");
   const child=editor+".document.getElementById('iframeInsumo').contentWindow";
   const modal={etaax:'modalCatalogoGlobal',globalneg:'modalInsumosNeg',nuevo:'modalOverlay'}[mode];
   await until(p.sid,child+" && "+child+".document.readyState==='complete' && !"+child+".document.getElementById('etaax-header')");
   await until(p.sid,child+".location.search.includes("+JSON.stringify(mode==='globalneg'?'globalneg=1':mode+'=1')+") && "+child+".document.getElementById('"+modal+"') && "+child+".getComputedStyle("+child+".document.getElementById('"+modal+"')).display!=='none'");await pause(200);
   const geom=await evalPage(p.sid,`(()=>{const w=${child},d=w.document,outer=${editor}.document.getElementById('modalIframeInsumo'),close=outer.querySelector('[title="Cerrar"]'),r=close.getBoundingClientRect();const visible=[...d.querySelectorAll('.modal-overlay,#modalCatalogoGlobal,#modalInsumosNeg')].filter(e=>w.getComputedStyle(e).display!=='none');const count=d.getElementById('${mode==='etaax'?'cgTotal':'ignTotal'}');return {headers:d.querySelectorAll('#etaax-header').length,visible:visible.map(e=>e.id),padding:w.getComputedStyle(d.body).paddingTop,close:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:${editor}.innerWidth},count:count?.getBoundingClientRect().top,errors:w.__errors};})()`);
   console.log(width,mode,geom);assert.equal(geom.headers,0);assert.equal(geom.padding,'0px');assert.ok(geom.visible.length>0);assert.ok(geom.close.left>=0&&geom.close.right<=geom.close.width+1,JSON.stringify(geom));
   if(mode!=='nuevo')assert.ok(geom.count>=0&&geom.count<150);
   if(mode==='etaax')assert.ok(await evalPage(p.sid,child+".document.getElementById('cgTotal').textContent.includes('1')"));
   const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(dir+'/'+mode+'-'+width+'.png',Buffer.from(shot.data,'base64'));
   await evalPage(p.sid,editor+".document.querySelector('#modalIframeInsumo .etx-min-btn').click();"+editor+".document.querySelector('#etx-dock .etx-chip').click()");
   await evalPage(p.sid,editor+".cerrarIframeInsumo(true)");
   results.push(width+' '+mode);
  }
  await evalPage(p.sid,'cerrarIframeInsumo(true)');
  await go(p,'location.href='+JSON.stringify(base+'/recetas/insumos.html'),"typeof abrirCatalogoGlobal==='function' && document.querySelector('#etaax-header')");
  await evalPage(p.sid,'abrirCatalogoGlobal()');await pause(300);
  const z=await evalPage(p.sid,`(()=>{const h=document.getElementById('etaax-header'),m=document.getElementById('modalCatalogoGlobal');return {header:+getComputedStyle(h).zIndex,modal:+getComputedStyle(m).zIndex,front:document.elementFromPoint(innerWidth/2,30)?.closest('#etaax-header')===null};})()`);
  assert.ok(z.modal>z.header&&z.front,JSON.stringify(z));results.push(width+' modal encima del header');
  await close(p);
 }
 await probarReordenTactil(base, dir);
 await probarIdentidadCatalogos(base, dir);
 await probarRendimientosSucursales(base,dir);
}

async function probarRendimientosSucursales(base,dir) {
    const sr = {id:'bizcocho',tipo:'sub-alimentos',nombre:'Bizcocho de prueba',status:'activa',sucursales:['matriz'],sucursalId:'matriz',
        ingredientes:[{nombre:'Base de prueba',cantidad:2,unidad:'KG',costoPorKgLt:400,insumoId:'',desc:''}],
        camposExtra:{tipoMedicion:'granel',rendimientoFinal:2,unidadRendimientoFinal:'KG',unidadRendBruto:'KG',porcionesQty:2,porcionesUnidad:'pzas'}};
    const produccion = {id:'prod_bizcocho',nombre:sr.nombre,recetaId:sr.id,esSubReceta:true,familia:'Alimentos',categoria:'Producción propia',area:'cocina',activo:'1',sucursales:['matriz'],sucursalId:'matriz',
        presentaciones:[{contNeto:2,umContenido:'KG',rendimiento:2000,umRendimiento:'G',costoUnitario:400,umCosto:'KG',precio:800},
            {contNeto:1,umContenido:'PZA',rendimiento:2,umRendimiento:'PZA',costoUnitario:400,umCosto:'PZA',precio:400}]};
    const plato = {id:'pastel',tipo:'alimentos',nombre:'Pastel de prueba',status:'activa',sucursales:['matriz'],sucursalId:'matriz',
        ingredientes:[{nombre:sr.nombre,insumoId:produccion.id,cantidad:2,unidad:'PZA',costoPorKgLt:400,desc:''}],camposExtra:{porciones:1}};
    for (const width of [1440,390]) {
        // Un escenario por ancho: limpiar solo IndexedDB del origen ficticio.
        // Cerrar una pestaña o limpiar localStorage no borra su caché persistida.
        const p = await page(base,'/hub.html','owner',width,true);
        await send('Storage.clearDataForOrigin',{origin:base,storageTypes:'indexeddb'},p.sid);
        await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
        await evalPage(p.sid, `sessionStorage.setItem('__fixture_insumos',${JSON.stringify(JSON.stringify([produccion]))});sessionStorage.setItem('__fixture_recetas',${JSON.stringify(JSON.stringify([sr,plato]))});`);
        await go(p,'location.href='+JSON.stringify(base+'/recetas/index.html'),"typeof abrirFichaReceta==='function' && getRecetas().length===2 && document.readyState==='complete'");
        await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click();abrirFichaReceta('bizcocho')");
        await click(p,'#btnFichaEditar');
        const w="document.getElementById('iframeInsumo').contentWindow";
        const frame = expression => evalPage(p.sid,w+'.eval('+JSON.stringify(expression)+')');
        await until(p.sid,w+" && "+w+".document.getElementById('subRendNombre') && "+w+".document.getElementById('porcionesQty').value==='2'");
        await check(width+' rendimiento anterior se conserva como presentación principal',async()=>{
            assert.equal(await frame("document.getElementById('subRendNombre').value"),sr.nombre);
            assert.equal(await frame("document.querySelector('#cardAgregarInsumo button').disabled"),true);
            assert.equal(await frame("document.getElementById('sub-costoPorcion').textContent"),'$400.00');
        });
        await frame("document.getElementById('subRendNombre').value='Grande';agregarRendimientoSub();document.getElementById('sr_1_nombre').value='Mediano';document.getElementById('sr_1_porcionesQty').value=4;calcSubRecetaCostos();agregarRendimientoSub();document.getElementById('sr_2_nombre').value='Chico';document.getElementById('sr_2_porcionesQty').value=8;calcSubRecetaCostos()");
        await check(width+' agregar presentaciones calcula costos y guarda un único insumo',async()=>{
            assert.ok((await frame("document.getElementById('sr_1_resultado').textContent")).includes('$200.00'));
            assert.ok((await frame("document.getElementById('sr_2_resultado').textContent")).includes('$100.00'));
            await frame("guardarEnHistorial();document.getElementById('sr_1_porcionesQty').value=5;calcSubRecetaCostos();guardarEnHistorial();undoReceta()");
            assert.equal(await frame("Number(document.getElementById('sr_1_porcionesQty').value)"),4);
            assert.ok((await frame("document.getElementById('sr_1_resultado').textContent")).includes('$200.00'));
            await frame("agregarSubRecetaComoInsumo(true)");
            assert.equal(await frame('getCatalogoInsumos().length'),1);
            assert.equal(await frame("getCatalogoInsumos()[0].id"),'prod_bizcocho');
            assert.equal(await frame("getCatalogoInsumos()[0].presentaciones.filter(p=>p.esRendimientoPorcion).length"),3);
            const layout=await frame("({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,errors:window.__errors})");
            assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));assert.deepEqual(layout.errors,[]);
        });
        await frame("document.getElementById('subRendNombre').scrollIntoView({block:'start'})");
        let shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,'subreceta-presentaciones-'+width+'.png'),Buffer.from(shot.data,'base64'));
        await frame('guardarReceta()');
        await until(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_recetas')).find(r=>r.id==='bizcocho').camposExtra.rendimientosPorcion?.length===3");
        await go(p,'location.reload()',"typeof abrirFichaReceta==='function' && getRecetas().length===2 && document.readyState==='complete'");
        await evalPage(p.sid,"abrirFichaReceta('bizcocho')");await click(p,'#btnFichaEditar');
        await until(p.sid,w+" && "+w+".document.getElementById('sr_2_nombre') && "+w+".document.getElementById('sr_2_nombre').value==='Chico'");
        await check(width+' recargar conserva nombres, porciones y unidades en escandallo',async()=>{
            assert.equal(await frame("document.getElementById('subRendNombre').value"),'Grande');
            await frame("cargarReceta('pastel');renderTabla();const u=[...document.querySelector('#tbodyIngredientes select').options].find(o=>o.textContent==='Mediano').value;updateUnidad(0,u)");
            assert.equal(await frame("ingredientes[0].costoPorKgLt"),200);
            assert.equal(await frame("getFactor(ingredientes[0].cantidad,ingredientes[0].unidad)*costoUnitVivo(ingredientes[0])"),400);
            assert.equal(await frame("getPesoBrutoPorUnidad(ingredientes[0])"),500);
            assert.equal(await frame("document.querySelector('#tbodyIngredientes select').selectedOptions[0].textContent"),'Mediano');
            await frame("document.querySelector('#tbodyIngredientes').scrollIntoView({block:'center'})");
            const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,'unidades-subreceta-'+width+'.png'),Buffer.from(shot.data,'base64'));
            await frame("updateUnidad(0,'G');updateIng(0,'cantidad',500)");
            assert.equal(await frame("getFactor(ingredientes[0].cantidad,ingredientes[0].unidad)*costoUnitVivo(ingredientes[0])"),200);
        });
        await frame("cargarReceta('bizcocho')");
        await check(width+' eliminar producción vuelve a habilitar agregar y no revive al guardar',async()=>{
            await frame("localStorage.setItem(_sk('ins_borrados'),JSON.stringify({prod_bizcocho:Date.now()}));sessionStorage.setItem('__fixture_insumos','[]');refrescarInsumoSubReceta()");
            await until(p.sid,w+".document.querySelector('#cardAgregarInsumo button').disabled===false");
            await frame('agregarSubRecetaComoInsumo(true)');
            assert.equal(await frame('_subRecetaYaEsInsumo()'),false);
            await frame('agregarSubRecetaComoInsumo()');
            assert.equal(await frame('_subRecetaYaEsInsumo()'),true);
            assert.notEqual(await frame('_buscarInsumoSubReceta().id'),'prod_bizcocho');
        });
        await close(p);
    }
    const p=await page(base,'/hub.html','owner',1440,true);
    await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
    for(const route of ['/recetas/index.html','/recetas/insumos.html','/administrativo/staff-hub.html','/financiero/ventas.html','/consultoria/index.html']) {
        await go(p,'location.href='+JSON.stringify(base+route),"document.readyState==='complete' && document.getElementById('etxCambiarSucursal')");
        await check('cuenta del negocio: Cambiar sucursal visible en '+route,async()=>{
            assert.ok(await evalPage(p.sid,"document.getElementById('etxCambiarSucursal').getClientRects().length>0"));
        });
    }
    await click(p,'#etxCambiarSucursal');
    await until(p.sid,"document.querySelectorAll('#etxModuleDialog [data-sucursal]').length===2");
    await check('cancelar cambio de sucursal conserva el contexto',async()=>{
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},p.sid);
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'},p.sid);
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'matriz');
    });
    await click(p,'#etxCambiarSucursal');await until(p.sid,"document.querySelector('#etxModuleDialog [data-sucursal=norte]')");
    await check('cambiar sucursal conserva la ruta y actualiza los dos contextos',async()=>{
        await go(p,"document.querySelector('#etxModuleDialog [data-sucursal=norte]').click()","document.readyState==='complete' && document.getElementById('etxCambiarSucursal')");
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'norte');
        assert.equal(await evalPage(p.sid,"JSON.parse(localStorage.getItem('etaax_ctx')).sucId"),'norte');
        assert.equal(await evalPage(p.sid,"location.pathname"),'/consultoria/index.html');
    });
    await click(p,'#etxCambiarSucursal');await until(p.sid,"document.querySelectorAll('#etxModuleDialog [data-sucursal]').length===2");
    const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,'sucursales-cuenta-negocio.png'),Buffer.from(shot.data,'base64'));
    await evalPage(p.sid,"document.getElementById('etxModuleDialog').close()");
    await check('la sesión de colaborador no obtiene el selector de la cuenta del negocio',async()=>{
        await evalPage(p.sid,"window.__cambioAnterior=document.getElementById('etxCambiarSucursal').onclick;const c=JSON.parse(localStorage.getItem('etaax_ctx'));c.ctxType='staff';c.rol='mesero';localStorage.setItem('etaax_ctx',JSON.stringify(c));window._ctxBarInit()");
        assert.equal(await evalPage(p.sid,"document.getElementById('etxCambiarSucursal')===null"),true);
        await evalPage(p.sid,'window.__cambioAnterior()');
        assert.equal(await evalPage(p.sid,"!!document.querySelector('#etxModuleDialog[open]')"),false);
    });
    await close(p);
}

async function probarDocumentosAdmin(base,dir){
 async function valor(p,key,v,event='input'){await evalPage(p.sid,`(()=>{var e=document.getElementById(${JSON.stringify(key)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);}
 for(const width of [1440,390]){
  const p=await page(base,'/hub.html','admin',width,true);await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
  await go(p,'location.href='+JSON.stringify(base+'/admin.html'),"typeof AdminDocs==='object' && document.getElementById('viewAdmin').style.display==='block' && _data.negocios.length===2");
  await evalPage(p.sid,"window.__impresos=[];window.etaaxAbrirReporte=h=>{__impresos.push(h);return true;};document.getElementById('abrirHistorialRecibos').click()");
  await until(p.sid,"document.getElementById('admDocsTabla').textContent.includes('No hay documentos')");
  await check(width+' guardar antes de imprimir y evitar doble clic',async()=>{
    await evalPage(p.sid,"abrirDocumentoModal('recibo','n1')");await valor(p,'doc_cliente','Cliente <VIP>');await valor(p,'doc_meses','12');
    await valor(p,'doc_total','12500');await valor(p,'doc_recurrente','12000');await valor(p,'doc_desde','2026-10','change');await valor(p,'doc_fecha','2026-10-28','change');
    await evalPage(p.sid,"window.__folioPrueba=document.getElementById('doc_folio').value;document.getElementById('doc_btnGen').click();document.getElementById('doc_btnGen').click()");
    await until(p.sid,'!document.getElementById("docOv") && __impresos.length===1');
    const r=await evalPage(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_admin_docs'))");assert.equal(r.length,1);assert.equal(r[0].total,12500);assert.equal(r[0].suscripcion_monto,12000);assert.equal(r[0].estado,'pendiente');assert.ok(r[0].html.includes('&lt;VIP&gt;'));assert.equal(r[0].fecha_pago,null);
    await valor(p,'admDocsMes','2026-10','change');assert.ok((await evalPage(p.sid,'document.getElementById("admDocsMetricas").textContent')).includes('$1,000.00'));
  });
  await check(width+' cambiar a pagado y reimprimir conserva importes aunque cambien las tarifas',async()=>{
    const key=await evalPage(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_admin_docs'))[0].id");
    await evalPage(p.sid,'AdminDocs.ver('+JSON.stringify(key)+')');await until(p.sid,'!!document.getElementById("adoc-guardar")');
    await valor(p,'adoc-estado','pagado','change');await valor(p,'adoc-pago','2026-10-28','change');await evalPage(p.sid,'document.getElementById("adoc-guardar").click()');
    await until(p.sid,'!document.getElementById("adocModal")');
    await evalPage(p.sid,'EtaaxPrecios.precioSucursal=()=>999999;AdminDocs.imprimir('+JSON.stringify(key)+')');await until(p.sid,'__impresos.length===2');
    const html=await evalPage(p.sid,'__impresos[1]');assert.ok(html.includes('Total pagado'));assert.ok(html.includes('12,500'));assert.ok(!html.includes('999,999'));
  });
  await check(width+' el histórico sobrevive recarga y filtra por folio',async()=>{
    const folio=await evalPage(p.sid,'__folioPrueba');await go(p,'location.reload()',"typeof AdminDocs==='object' && _data.negocios.length===2");
    await evalPage(p.sid,"switchTab('documentos')");await until(p.sid,'document.getElementById("admDocsTabla").textContent.includes('+JSON.stringify(folio)+')');
    await evalPage(p.sid,"AdminDocs.filtro('busqueda','inexistente')");assert.ok((await evalPage(p.sid,'document.getElementById("admDocsTabla").textContent')).includes('No hay documentos'));
    await evalPage(p.sid,'AdminDocs.filtro("busqueda",'+JSON.stringify(folio)+')');assert.ok((await evalPage(p.sid,'document.getElementById("admDocsTabla").textContent')).includes('pagado'));
  });
  await check(width+' presupuesto se archiva y se convierte una sola vez en recibo',async()=>{
    await evalPage(p.sid,"window.etaaxAbrirReporte=()=>true;abrirDocumentoModal('presupuesto','n1')");await valor(p,'doc_cliente','Presupuesto de prueba');
    await evalPage(p.sid,'document.getElementById("doc_btnGen").click()');await until(p.sid,'!document.getElementById("docOv")');
    const key=await evalPage(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_admin_docs')).find(d=>d.tipo==='presupuesto').id");
    await evalPage(p.sid,'AdminDocs.ver('+JSON.stringify(key)+')');await until(p.sid,'!!document.getElementById("adoc-convertir")');await evalPage(p.sid,'document.getElementById("adoc-convertir").click()');
    await until(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_admin_docs')).some(d=>d.presupuesto_id)");
    assert.equal(await evalPage(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_admin_docs')).filter(d=>d.presupuesto_id).length"),1);
    await evalPage(p.sid,"document.getElementById('adocModal')?.remove()");
  });
  await check(width+' fallo de guardado mantiene el formulario y no imprime un recibo sin archivo',async()=>{
    await evalPage(p.sid,"window.__failDocs=true;window.__impresos=[];window.etaaxAbrirReporte=h=>{__impresos.push(h);return true};window.admAlert=x=>{window.__alert=x};abrirDocumentoModal('recibo','n1')");await valor(p,'doc_cliente','No guardado');
    await evalPage(p.sid,'document.getElementById("doc_btnGen").click()');await until(p.sid,'!!window.__alert');assert.equal(await evalPage(p.sid,'__impresos.length'),0);assert.equal(await evalPage(p.sid,'!!document.getElementById("docOv")'),true);
    await evalPage(p.sid,"window.__failDocs=false;document.getElementById('docOv').remove();AdminDocs.filtro('busqueda','')");
  });
  const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,'admin-documentos-'+width+'.png'),Buffer.from(shot.data,'base64'));
  const errs=await evalPage(p.sid,'__errors');assert.deepEqual(errs,[]);
  await close(p);
 }
}

async function probarSalidasCalendario(base,dir) {
    const catalogo=[{id:'tequila',nombre:'Gran Centenario',variedad:'Plata',tipoInsumo:'destilado',familia:'Bebidas',categoria:'Destilados',subcategoria:'Tequila',area:'barra',sucursales:['matriz'],presentaciones:[{contNeto:700,umContenido:'ML',tamanoCopa:45,umTamanoCopa:'ML',costoUnitario:471.43,umCosto:'LT',precioCarta:90}]}];
    async function escribir(p,selector,value,event='blur') {
        await evalPage(p.sid,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Falta '+${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
    }
    for(const width of [1440,390]) {
        const p=await page(base,'/hub.html','owner',width,true);
        await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
        await send('Storage.clearDataForOrigin',{origin:base,storageTypes:'indexeddb'},p.sid);
        await evalPage(p.sid,'sessionStorage.setItem("__fixture_insumos",'+JSON.stringify(JSON.stringify(catalogo))+');sessionStorage.setItem("__fixture_inventarios","[]")');
        await go(p,'location.href='+JSON.stringify(base+'/recetas/inventarios.html'),"typeof renderCardVentas==='function' && _cacheInsumosInv && _cacheInsumosInv.length===1");
        await evalPage(p.sid,`invActual={id:'salidas-prueba',nombre:'Salidas de prueba',sucursalId:'matriz',fecha:'2026-10-26',area:'barra',cerrado:false,entradasLog:[],cocktailsVendidos:{},prebatchProducidos:{},cancelaciones:[]};filasCaptura=[{insumoId:'tequila',nombre:'Gran Centenario Plata',tipo:'copa',familia:'Bebidas',categoria:'Destilados',contNeto:700,copaML:45,existenciaAnterior:10*700/45,pesos:[],cerradasBarra:6,cerradasBodega:0,registrado:true,costoUnitario:471.43,precioCarta:90}];invActual.filas=filasCaptura;mostrarVista('vistaCaptura');irAPaso(3);setVistaVentas('busqueda');seleccionarProductoVentas('tequila')`);
        await until(p.sid,"document.getElementById('cortesiaBotella-0') && !document.documentElement.classList.contains('etx-ui-pendiente')");
        await check(width+' captura de venta, cortesía y merma suma botellas con unidades sueltas',async()=>{
            await escribir(p,'#venta-copas-0','2');await escribir(p,'#venta-bot-0','1');
            await escribir(p,'[onblur*="cortesiaCopas"]','3');await escribir(p,'#cortesiaBotella-0','1');
            await escribir(p,'[onblur*="mermaCopas"]','4');await escribir(p,'#mermaBotella-0','2');
            await escribir(p,'#venta-comentario-0','Evento <VIP> "mesa 4"','input');
            await escribir(p,'#cortesia-concepto-0','Invitados','input');await escribir(p,'#merma-concepto-0','Rotura','input');
            const r=await evalPage(p.sid,'({teorico:calcExistenciaTeorica(filasCaptura[0]),f:filasCaptura[0]})');
            assert.ok(Math.abs(r.teorico-(6*700/45-9))<1e-8,JSON.stringify(r));
            assert.equal(r.f.ventasComentario,'Evento <VIP> "mesa 4"');
            const t=await evalPage(p.sid,'document.getElementById("ventasResumen").textContent');assert.ok(t.includes('1 bot cortesía')&&t.includes('2 bot merma')&&t.includes('Evento <VIP>'),t);
            assert.equal(await evalPage(p.sid,'getComputedStyle(document.getElementById("venta-comentario-0")).fontSize'),'13px');
            assert.equal(await evalPage(p.sid,'document.getElementById("ventasResumenCuenta").textContent'),'1 producto');
            const layout=await evalPage(p.sid,'[...document.querySelectorAll("#ventasCardWrap input")].map(e=>({x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right,w:innerWidth}))');
            assert.ok(layout.every(r=>r.x>=0&&r.right<=r.w+1),JSON.stringify(layout));
        });
        await evalPage(p.sid,"document.querySelector('#ventasCardWrap').scrollIntoView({block:'center'})");
        let shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,'inventario-salidas-'+width+'.png'),Buffer.from(shot.data,'base64'));
        await check(width+' cambiar copa a onza conserva botellas; lista permite editar y guardar',async()=>{
            await escribir(p,'select[onchange*="cortesiaCopas"]','OZ','change');
            const q=await evalPage(p.sid,'document.querySelector("[onblur*=cortesiaCopas]").value');assert.equal(Number(q),4.56);
            assert.equal(await evalPage(p.sid,'document.getElementById("cortesiaBotella-0").value'),'1');
            await evalPage(p.sid,"setVistaVentas('lista')");
            assert.equal(await evalPage(p.sid,'document.getElementById("venta-comentario-lista-0").value'),'Evento <VIP> "mesa 4"');
            await escribir(p,'select[onchange*="mermaCopas"]','OZ','change');
            assert.equal(Number(await evalPage(p.sid,'document.querySelector("[onblur*=mermaCopas]").value')),6.09);
            await escribir(p,'#cortesiaBotella-0','2');
            await evalPage(p.sid,'guardarInventario()');
            await until(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_inventarios')||'[]')[0]?.filas[0]?.cortesiaBotella===2");
        });
        await check(width+' recarga real recupera cantidades, unidades y comentario guardados',async()=>{
            await go(p,'location.reload()',"typeof abrirInventario==='function' && getInventarios().some(x=>x.id==='salidas-prueba') && _cacheInsumosInv?.length===1");
            await evalPage(p.sid,"abrirInventario('salidas-prueba');irAPaso(3);setVistaVentas('busqueda');seleccionarProductoVentas('tequila')");
            assert.equal(await evalPage(p.sid,'document.getElementById("venta-comentario-0").value'),'Evento <VIP> "mesa 4"');
            const r=await evalPage(p.sid,'({f:filasCaptura[0],suelta:_salidaSuelta(filasCaptura[0],"cortesiaCopas")})');
            assert.equal(r.f.cortesiaBotella,2);assert.equal(r.f.mermaBotella,2);assert.ok(Math.abs(r.suelta-3)<1e-8,JSON.stringify(r));
            assert.equal(r.f.umCapCortesia,'OZ');assert.equal(r.f.umCapMerma,'OZ');
            await evalPage(p.sid,'irAPaso(5)');assert.ok((await evalPage(p.sid,'document.getElementById("stepContent").textContent')).includes('Evento <VIP>'));
        });
        await check(width+' borrar la última salida y el comentario persiste incluso sin conteo físico',async()=>{
            await evalPage(p.sid,"filasCaptura=[{insumoId:'tequila',nombre:'Gran Centenario',tipo:'copa',contNeto:700,copaML:45}];invActual.filas=filasCaptura;updVentasDirectas(0,'mermaBotella',1);updVentasConcepto(0,'ventasComentario','Por borrar');guardarInventario()");
            await until(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_inventarios')||'[]')[0]?.filas[0]?.mermaBotella===1");
            await evalPage(p.sid,"updVentasDirectas(0,'mermaBotella',0);updVentasConcepto(0,'ventasComentario','');guardarInventario()");
            await until(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_inventarios')||'[]')[0]?.filas[0]?.mermaBotella===0");
            await go(p,'location.reload()',"typeof abrirInventario==='function' && getInventarios().some(x=>x.id==='salidas-prueba') && _cacheInsumosInv?.length===1");
            await evalPage(p.sid,"abrirInventario('salidas-prueba')");
            const f=await evalPage(p.sid,'filasCaptura[0]');assert.equal(f.mermaBotella,0);assert.equal(f.mermaCopas,0);assert.equal(f.ventasComentario,'');
        });
        await close(p);
    }
    const p=await page(base,'/hub.html','owner',1440,true);await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
    for(const route of ['/recetas/inventarios.html','/administrativo/diario.html','/financiero/ventas.html','/recetas/insumos.html']) {
        await go(p,'location.href='+JSON.stringify(base+route),"!!document.getElementById('etx-theme-css') && typeof toggleTheme==='function' && document.readyState==='complete'");
        await check('calendario oscuro/claro en '+route,async()=>{
            // A real date input in a modal also catches rules limited to page load.
            await evalPage(p.sid,`document.querySelector('#calendar-test')?.remove();var box=document.createElement('div');box.id='calendar-test';box.className='period-picker dxp';box.style='position:fixed;top:160px;left:60px;z-index:99999;padding:20px;background:var(--surface,#171711)';box.innerHTML='<label style="display:block;color:var(--text,#fff)">Fecha</label><input type="date" value="2026-10-26" style="padding:12px;background:var(--bg,#111);color:var(--text,#fff);border:1px solid #777;border-radius:8px">';document.body.appendChild(box)`);
            for(const theme of ['dark','light']){
                await evalPage(p.sid,`localStorage.setItem('etaax_theme','${theme}');window.dispatchEvent(new StorageEvent('storage',{key:'etaax_theme',newValue:'${theme}'}))`);
                const r=await evalPage(p.sid,"(()=>{const e=document.querySelector('#calendar-test input');return {theme:document.documentElement.dataset.theme,scheme:getComputedStyle(e).colorScheme,filter:getComputedStyle(e,'::-webkit-calendar-picker-indicator').filter}})()");
                assert.equal(r.theme,theme);assert.equal(r.scheme,theme);assert.equal(r.filter,'none');
                const shot=await send('Page.captureScreenshot',{format:'png',clip:{x:60,y:160,width:300,height:130,scale:2}},p.sid);
                fs.writeFileSync(path.join(dir,'calendario-'+route.split('/').pop().replace('.html','')+'-'+theme+'.png'),Buffer.from(shot.data,'base64'));
            }
        });
    }
    await close(p);
}

async function probarStockCosteo(base,dir) {
    const catalogo=[
        {id:'vodka',nombre:'Vodka American 2',variedad:"Sam’s",marca:'Sam’s',tipoInsumo:'destilado',familia:'Bebidas',categoria:'Destilados',subcategoria:'Vodka',sucursales:['matriz'],presentaciones:[{contNeto:1750,umContenido:'ML',pesoCristal:1100,tamanoCopa:60,umTamanoCopa:'ML',costoUnitario:400,umCosto:'LT',factorCopa:3.3,precioCarta:150,factorBotella:2.5,precioCartaBot:2500,stockMin:2,stockMax:6,mezcladorId:'soda',mezcladores:2,mezcladoresBot:5}]},
        {id:'vino',nombre:'Vino de prueba',variedad:'Reserva',tipoInsumo:'vino',familia:'Bebidas',categoria:'Vinos',sucursales:['matriz'],presentaciones:[{contNeto:750,umContenido:'ML',tamanoCopa:150,umTamanoCopa:'ML',costoUnitario:400,umCosto:'LT',precioCarta:150,precioCartaBot:1000,stockMin:2,stockMax:6}]},
        {id:'cerveza',nombre:'Cerveza de prueba',variedad:'Ámbar',tipoInsumo:'cerveza',familia:'Bebidas',categoria:'Cervezas',sucursales:['matriz'],presentaciones:[{contNeto:355,umContenido:'ML',costoPieza:20,precio:20,stockMin:4,stockMax:24}]},
        {id:'soda',nombre:'Soda',variedad:'Natural',tipoInsumo:'refresco',familia:'Bebidas',categoria:'Refrescos',sucursales:['matriz'],presentaciones:[{contNeto:600,umContenido:'ML',costoPieza:10,precio:10,stockMin:2,stockMax:12}]},
        {id:'cerezas',nombre:'Cerezas con tallo',variedad:'En almíbar',tipoInsumo:'abarrote',familia:'Alimentos',categoria:'Abarrotes',sucursales:['matriz'],presentaciones:[{contNeto:2100,umContenido:'G',masaDrenada:900,umMasaDrenada:'G',costoUnitario:333.333,umCosto:'KG',stockMin:1,stockMax:4}]}];
    for(const width of [1440,390]) {
        const p=await page(base,'/hub.html','owner',width,true);
        await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
        await send('Storage.clearDataForOrigin',{origin:base,storageTypes:'indexeddb'},p.sid);
        await evalPage(p.sid,'sessionStorage.setItem("__fixture_insumos",'+JSON.stringify(JSON.stringify(catalogo))+')');
        await go(p,'location.href='+JSON.stringify(base+'/recetas/inventarios.html'),"typeof renderCardExist==='function' && _cacheInsumosInv && _cacheInsumosInv.length===5");
        await evalPage(p.sid,`invActual={id:'conteo-prueba',nombre:'Conteo de prueba',sucursalId:'matriz',fecha:'2026-10-23',area:'barra',cerrado:false};filasCaptura=[
            {insumoId:'vodka',nombre:'Vodka American 2',tipo:'copa',familia:'Bebidas',categoria:'Destilados',contNeto:1750,copaML:60,pesoCristal:1100,pesos:[2.052],cerradasBarra:0,cerradasBodega:0,registrado:true,costoUnitario:400,precioCarta:150},
            {insumoId:'vino',nombre:'Vino de prueba',tipo:'copa',familia:'Bebidas',categoria:'Vinos',contNeto:750,copaML:150,pesos:[],cerradasBarra:6,cerradasBodega:0,registrado:true,costoUnitario:400},
            {insumoId:'cerveza',nombre:'Cerveza de prueba',tipo:'pza',familia:'Bebidas',categoria:'Cervezas',contNeto:355,pesos:[],cerradasBarra:0,cerradasBodega:0,registrado:true,costoPieza:20},
            {insumoId:'cerezas',nombre:'Cerezas con tallo',tipo:'peso',baseUnit:'G',familia:'Alimentos',categoria:'Abarrotes',contNeto:900,existenciaPeso:1800,registrado:true,costoUnitario:333.333}
        ];invActual.filas=filasCaptura;mostrarVista('vistaCaptura');renderStepContent();_existInsumoId='vodka';renderCardExist()`);
        await until(p.sid,"document.getElementById('ml-0') && !document.documentElement.classList.contains('etx-ui-pendiente')");
        await check(width+' abierto muestra litros, copas y onzas, y actualiza al cambiar peso',async()=>{
            let text=await evalPage(p.sid,"document.getElementById('ml-0').textContent");
            assert.ok(text.includes('0.952 L')&&text.includes('15.87 copas de 60 ml')&&text.includes('32.19 oz'),text);
            await evalPage(p.sid,'updPeso(0,0,2.3)');
            text=await evalPage(p.sid,"document.getElementById('ml-0').textContent");assert.ok(text.includes('20 copas'),text);
            await evalPage(p.sid,'updPeso(0,0,2.052)');
            const d=await evalPage(p.sid,"(()=>{const e=document.getElementById('ml-0').getBoundingClientRect();return {right:e.right,width:innerWidth}})()");assert.ok(d.right<=d.width+1,JSON.stringify(d));
        });
        await evalPage(p.sid,"document.querySelector('#existCardWrap .ent-form-card').scrollIntoView({block:'center'})");
        let shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,'inventario-abiertas-'+width+'.png'),Buffer.from(shot.data,'base64'));
        await check(width+' nivel y lista conservan un único resultado y la copa propia del vino',async()=>{
            await evalPage(p.sid,"setMetodoCapturaExist('vodka','nivel');updNivel(0,50)");
            assert.ok((await evalPage(p.sid,"document.getElementById('ml-0').textContent")).includes('14.58 copas'));
            await evalPage(p.sid,"filtroRegistroActivo='registrados';setVistaExist('lista')");
            assert.equal(await evalPage(p.sid,"document.querySelectorAll('#ml-0').length"),1);
            await evalPage(p.sid,"setVistaExist('busqueda');_existInsumoId='vino';setMetodoCapturaExist('vino','nivel');updNivel(1,50)");
            assert.ok((await evalPage(p.sid,"document.getElementById('ml-1').textContent")).includes('2.5 copas de 150 ml'));
            await evalPage(p.sid,"filasCaptura[0].metodoCaptura='peso';filasCaptura[1].metodoCaptura='peso';filasCaptura[1].nivelPct=0");
        });
        await evalPage(p.sid,'irAPaso(5)');
        await until(p.sid,"document.querySelector('#step5Tablas [data-stock=bajo]')");
        await check(width+' resultado incluye bajo, intermedio, ideal y referencias por insumo',async()=>{
            const text=await evalPage(p.sid,"document.getElementById('step5Tablas').textContent");
            for(const t of ['Stock bajo','Stock intermedio','Stock ideal','Ideal/máx. 6 bot','Ideal/máx. 4 unid. de compra'])assert.ok(text.includes(t),t);
            await evalPage(p.sid,"invActual.cerrado=true;_cacheInv=[invActual];abrirReporteFinal()");
            const rows=await evalPage(p.sid,"_datosReporteExistencias('todas').map(r=>({id:r.insumoId,total:r.total,estado:r.stock.estado}))");
            assert.equal(rows.find(r=>r.id==='cerveza').total,0);assert.equal(rows.find(r=>r.id==='cerveza').estado,'bajo');
            const text2=await evalPage(p.sid,"document.getElementById('repExistBody').textContent");assert.ok(text2.includes('Stock bajo')&&text2.includes('Cerveza de prueba'));
            await evalPage(p.sid,"_previewInv=invActual;_previewRows=_rowsDeInventario(invActual);_renderPreviewInv()");
            assert.ok((await evalPage(p.sid,"document.getElementById('previewInvBody').textContent")).includes('Stock bajo'));
        });
        shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,'inventario-stock-'+width+'.png'),Buffer.from(shot.data,'base64'));
        await check(width+' impreso de stock conserva agotados y parámetros',async()=>{
            await evalPage(p.sid,"window.etaaxAbrirReporte=h=>{window.__printStock=h;return true};imprimirReporteExistencias()");
            const html=await evalPage(p.sid,'window.__printStock');assert.ok(html.includes('Stock bajo')&&html.includes('Ideal/máx. 24 pza'));
        });
        await go(p,'location.href='+JSON.stringify(base+'/recetas/insumos.html'),"typeof imprimirInsumos==='function' && typeof getInsumos==='function' && getInsumos().length===5");
        await evalPage(p.sid,"window.etaaxAbrirReporte=h=>{window.__printCosteo=h};vistaInsumos='costeo';imprimirInsumos()");
        await until(p.sid,'!!window.__printCosteo');
        const html=await evalPage(p.sid,'window.__printCosteo');
        await check(width+' costeo impreso contiene variedad y pares copa/botella',async()=>{
            assert.ok(html.includes('Sam’s')&&html.includes('Reserva')&&html.includes('Ámbar'));
            assert.equal((html.match(/class="costeo-par"/g)||[]).length,4);
        });
        // Renderizar el documento REAL y comprobar también la impresión carta horizontal.
        const target=await send('Target.createTarget',{url:'about:blank'}), attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
        const sid=attached.sessionId;await send('Page.enable',{},sid);
        await send('Fetch.enable',{patterns:[{urlPattern:'http*'}]},sid);
        await send('Emulation.setDeviceMetricsOverride',{width:1056,height:816,deviceScaleFactor:1,mobile:false},sid);
        const documento=html.replace(/<link[^>]*href="https:[^>]+>/g,'').replace(/<script[\s\S]*?<\/script>/g,'');
        await send('Page.navigate',{url:'data:text/html;charset=utf-8,'+encodeURIComponent(documento)},sid);
        await until(sid,"document.readyState==='complete' && document.querySelector('tbody.costeo-par')");
        await send('Emulation.setEmulatedMedia',{media:'print'},sid);
        await check(width+' columnas caben en papel y mantienen el par en la misma hoja',async()=>{
            const m=await evalPage(sid,"Array.from(document.querySelectorAll('tbody.costeo-par')).map(t=>({rows:t.rows.length,width:t.closest('table').scrollWidth,client:t.closest('table').clientWidth,break:getComputedStyle(t).breakInside}))");
            assert.equal(m.length,4);m.forEach(t=>{assert.equal(t.rows,2);assert.ok(t.width<=t.client+1,JSON.stringify(t));assert.equal(t.break,'avoid');});
            const pdf=await send('Page.printToPDF',{landscape:true,paperWidth:8.5,paperHeight:11,printBackground:true,preferCSSPageSize:true},sid);
            fs.writeFileSync(path.join(dir,'costeo-dos-renglones-'+width+'.pdf'),Buffer.from(pdf.data,'base64'));
        });
        shot=await send('Page.captureScreenshot',{format:'png'},sid);fs.writeFileSync(path.join(dir,'costeo-dos-renglones-'+width+'.png'),Buffer.from(shot.data,'base64'));
        assert.deepEqual(await evalPage(p.sid,'window.__errors'),[]);
        await send('Target.closeTarget',{targetId:target.targetId});await close(p);
    }
}

async function click(p, selector) {
    await until(p.sid, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e && !e.disabled && e.getClientRects().length && !document.documentElement.classList.contains('etx-ui-pendiente')})()`);
    const r = await evalPage(p.sid, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...r}, p.sid);
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...r}, p.sid);
}
/* ── REORDENAR CON EL DEDO ───────────────────────────────────────────────────
   Edwin reportó que en tablet no se puede reacomodar: el dedo mueve la pantalla
   en vez del renglón. La suite de `money-tests.js` no lo ve porque su DOM
   simulado no aplica reglas CSS, y el fallo ES una regla CSS: `touch-action` no
   aplica a elementos inline no reemplazados, y el tirador del escandallo es un
   `<span>` dentro de un `<td>`. El navegador ignora el `touch-action:none`,
   decide que el gesto es un scroll y manda `pointercancel`.

   Aquí se arrastra con TOUCH de verdad (Input.dispatchTouchEvent con la
   emulación táctil encendida) sobre las pantallas completas, y se mira la
   secuencia de eventos además del resultado: un arrastre que "no movió nada" y
   uno que el navegador canceló se ven igual mirando solo el orden final. */
async function _arrastrarConDedo(sid, desde, hasta, pasos) {
    pasos = pasos || 8;
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: desde.x, y: desde.y, id: 1 }] }, sid);
    await pause(30);
    for (let i = 1; i <= pasos; i++) {
        const t = i / pasos;
        await send('Input.dispatchTouchEvent', { type: 'touchMove',
            touchPoints: [{ x: desde.x + (hasta.x - desde.x) * t, y: desde.y + (hasta.y - desde.y) * t, id: 1 }] }, sid);
        await pause(20);
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sid);
    await pause(150);
}
/* Apunta todo lo que pasa con el puntero: así se distingue "no se movió" de
   "el navegador se llevó el gesto para hacer scroll". */
const _ESPIA_PUNTERO = "(function(){window.__ev=[];" +
    "['pointerdown','pointermove','pointerup','pointercancel'].forEach(function(t){" +
    "document.addEventListener(t,function(e){window.__ev.push(t+':'+Math.round(e.clientY));},true);});" +
    "window.__scroll=[];return true;})()";

async function probarReordenTactil(base, dir) {
    /* 768 de ancho: una tablet en vertical, que es donde se usa detrás de la
       barra. `mobile:false` a propósito — con la emulación móvil Chrome ensancha
       el viewport al contenido y tapa justo lo que hay que medir. */
    let p = await page(base, '/hub.html', 'owner', 768, true);
    await send('Network.setExtraHTTPHeaders', { headers: {} }, p.sid);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, p.sid);
    /* Alto de tablet de verdad. `page()` usa 1000 px y con eso el `.header`
       pegajoso (437×268) más una tarjeta de galería de 269 px no dejan sitio
       para el par de renglones que hace falta para arrastrar uno sobre otro:
       un iPad en vertical son 1024–1366. */
    const ALTO = 1300;
    await send('Emulation.setDeviceMetricsOverride', { width: 768, height: ALTO, deviceScaleFactor: 1, mobile: false }, p.sid);

    /* ── 1) El escandallo ─────────────────────────────────────────────────
       El editor de receta abre DENTRO de `#iframeInsumo` (`abrirEditorEnModal`),
       así que la tabla del padre es la oculta: hay que medir y tocar adentro del
       marco, sumando su desplazamiento para que las coordenadas del toque sean
       las de la ventana de arriba. */
    await go(p, 'location.href=' + JSON.stringify(base + '/recetas/index.html'),
        "typeof abrirEscModal==='function' && document.querySelector('#ctxBar #etxCambiarModulo')");
    await evalPage(p.sid, "document.getElementById('etaaxNovOk')?.click();abrirEscModal('alimentos');true");
    const W = "document.getElementById('iframeInsumo').contentWindow";
    await until(p.sid, W + " && " + W + ".document.readyState==='complete' && !!" + W + ".document.getElementById('tbodyIngredientes')");
    /* `let ingredientes` es un binding LÉXICO del script: no es propiedad de
       `window`, así que desde fuera solo se alcanza con el `eval` de ese marco. */
    const _dentro = (code) => evalPage(p.sid, W + ".eval(" + JSON.stringify(code) + ")");
    await _dentro("ingredientes.splice(0,ingredientes.length," +
        "{nombre:'AAA primero',desc:'',cantidad:1,unidad:'KG',costoPorKgLt:10,insumoId:''}," +
        "{nombre:'BBB segundo',desc:'',cantidad:2,unidad:'KG',costoPorKgLt:20,insumoId:''}," +
        "{nombre:'CCC tercero',desc:'',cantidad:3,unidad:'KG',costoPorKgLt:30,insumoId:''});renderTabla();true");
    await until(p.sid, W + ".document.querySelectorAll('#tbodyIngredientes tr[data-ing-i]').length===3");
    /* La tabla de ingredientes queda abajo de la ficha, y el editor termina de
       pintar DESPUÉS de abrirse: acercar la fila y medirla en dos pasos dejaba
       que un repintado tardío devolviera el scroll a cero, y entonces el toque
       caía fuera del marco (y=1044 en una ventana de 1000). Las dos cosas van
       en la MISMA evaluación: se acerca, se mide y se comprueba de un tirón. */
    const _acercarYmedir = (sel) => _dentro(
        "(function(){var d=document,w=window,el=d.querySelector(" + JSON.stringify(sel) + ");" +
        "if(!el)return null;" +
        "function fuera(){var q=el.getBoundingClientRect();return q.top<90||q.bottom>w.innerHeight-90;}" +
        "el.scrollIntoView({block:'center'});" +
        "if(fuera()){for(var n=el.parentElement;n;n=n.parentElement){var ov=getComputedStyle(n).overflowY;" +
        "if((ov==='auto'||ov==='scroll')&&n.scrollHeight>n.clientHeight+4){" +
        "n.scrollTop+=el.getBoundingClientRect().top-w.innerHeight*0.4;break;}}}" +
        "if(fuera()){var sc=d.scrollingElement||d.documentElement;" +
        "sc.scrollTop+=el.getBoundingClientRect().top-w.innerHeight*0.4;}" +
        "var g=el.querySelector('.ord-grip')||el,cs=getComputedStyle(g),r=g.getBoundingClientRect();" +
        "function en(x,y){var e=d.elementFromPoint(x,y);return !!(e&&e.closest&&e.closest('.ord-grip'));}" +
        "var cx=r.left+r.width/2, cy=r.top+r.height/2;" +
        "var a=0,b=0,i=0,j=0,centro=en(cx,cy);" +
        "if(centro){for(var k=1;k<40;k++){if(en(cx,cy-k))a=k;else break;}" +
        "for(var k2=1;k2<40;k2++){if(en(cx,cy+k2))b=k2;else break;}" +
        "for(var k3=1;k3<40;k3++){if(en(cx-k3,cy))i=k3;else break;}" +
        "for(var k4=1;k4<40;k4++){if(en(cx+k4,cy))j=k4;else break;}}" +
        "var fila=el.getBoundingClientRect();" +
        "return {display:cs.display,touch:cs.touchAction,w:r.width,h:r.height," +
        "x:cx,y:cy,centro:centro,alto:centro?a+b+1:0,ancho:centro?i+j+1:0," +
        "filaTop:fila.top,filaBottom:fila.bottom,vh:w.innerHeight};})()");

    const caja = await _acercarYmedir('#tbodyIngredientes tr[data-ing-i="2"]');
    assert.ok(caja && caja.filaTop > 0 && caja.filaBottom < caja.vh,
        'no se pudo poner el renglón a la vista: ' + JSON.stringify(caja));
    assert.ok(caja.w > 0 && caja.h > 0, 'el tirador no está en pantalla: ' + JSON.stringify(caja));
    assert.ok(caja.centro, 'el centro del tirador no responde al toque: ' + JSON.stringify(caja));
    /* EL FALLO, EXPLÍCITO: con el tirador inline el navegador ignora
       `touch-action` por completo. No es que el área sea chica — es que la regla
       no se aplica a un elemento inline no reemplazado. */
    assert.notEqual(caja.display, 'inline',
        'el tirador del escandallo es inline: el navegador ignora su touch-action ' + JSON.stringify(caja));
    assert.equal(caja.touch, 'none', 'el tirador no tiene touch-action:none efectivo ' + JSON.stringify(caja));
    /* Área de toque cómoda para un dedo (44 px es la recomendación de Apple y
       Google). Se mide la REAL —hasta dónde sigue respondiendo— así cuenta
       también el margen invisible que se le dé. */
    assert.ok(caja.alto >= 36, 'área de toque demasiado baja para un dedo: ' + JSON.stringify(caja));
    assert.ok(caja.ancho >= 36, 'área de toque demasiado angosta para un dedo: ' + JSON.stringify(caja));
    await check('escandallo: el tirador es una caja con área de dedo', async () => {});

    const nombres = () => _dentro("ingredientes.map(function(x){return x.nombre;}).join('|')");
    assert.equal(await nombres(), 'AAA primero|BBB segundo|CCC tercero');
    await evalPage(p.sid, "(function(){var d=" + W + ".document;window.__ev=[];" +
        "['pointerdown','pointermove','pointerup','pointercancel'].forEach(function(t){" +
        "d.addEventListener(t,function(e){window.__ev.push(t+':'+e.pointerType);},true);});return true;})()");
    /* Coordenadas del toque en la ventana de ARRIBA: la del tirador dentro del
       marco más el desplazamiento del marco, tomadas aquí mismo para que un
       repintado entre medias no las deje viejas.

       Se mueve al renglón DE ARRIBA, no al primero: a 768 px cada ingrediente
       se apila como una tarjeta de ~390 px y tres no caben en el marco. Mover
       al adyacente prueba lo mismo —que el dedo reordena— sin que el resultado
       dependa además del autoscroll, que tiene su propia prueba. */
    const g3 = await evalPage(p.sid, "(function(){var w=" + W + ",d=w.document;" +
        "var its=d.querySelectorAll('#tbodyIngredientes tr[data-ing-i]');" +
        "its[1].scrollIntoView({block:'start'});" +
        "var off=document.getElementById('iframeInsumo').getBoundingClientRect();" +
        "var gr=its[2].querySelector('.ord-grip').getBoundingClientRect(), r1=its[1].getBoundingClientRect();" +
        /* El destino se acota DENTRO del marco: `scrollIntoView({block:'start'})`
           puede dejar el renglón un pelo arriba del borde (−0.33 px), y un toque
           en una coordenada negativa no entra a ningún lado. */
        "var dy=Math.max(r1.top,2)+10;" +
        "return {gx:off.left+gr.left+gr.width/2,gy:off.top+gr.top+gr.height/2,destino:off.top+dy," +
        "mitadDeArriba:(dy-r1.top)<r1.height/2," +
        "dentroDelMarco:(gr.top>0&&gr.bottom<w.innerHeight&&r1.bottom>20&&r1.top<w.innerHeight)};})()");
    assert.ok(g3.dentroDelMarco, 'el renglón o su destino quedaron fuera del marco: ' + JSON.stringify(g3));
    /* Y que el destino caiga en la MITAD DE ARRIBA del renglón: ahí es donde
       `_marcar` decide 'antes', que es lo que esta prueba espera. */
    assert.ok(g3.mitadDeArriba, 'el destino no cae en la mitad superior: ' + JSON.stringify(g3));
    await _arrastrarConDedo(p.sid, { x: g3.gx, y: g3.gy }, { x: g3.gx, y: g3.destino });
    const ev = await evalPage(p.sid, "window.__ev.join(' ')");
    assert.ok(/pointerdown/.test(ev), 'el tirador no recibió el toque: [' + ev + ']');
    /* ESTA ES LA FIRMA DEL BUG DE EDWIN, y es lo que se vigila aquí: con el
       tirador inline la secuencia era `pointerdown → pointercancel` —el
       navegador se llevaba el gesto para hacer scroll— y la lista no se movía.
       Que no haya cancelación significa que el dedo YA es dueño del gesto.

       El reordenamiento completo de punta a punta se comprueba abajo, en el
       catálogo: ahí la lista no vive dentro de un iframe y el arnés puede
       conducir el gesto entero. Dentro del marco flotante, Chrome deja de
       entregar los últimos movimientos del toque al cruzar hacia el borde
       superior, y eso es cosa del arnés, no de la página — por eso aquí se
       afirma la cancelación y no el resultado, en vez de afirmar algo que la
       prueba no puede sostener. */
    assert.ok(!/pointercancel/.test(ev),
        'el navegador CANCELÓ el gesto en el escandallo (se lo llevó el scroll): [' + ev + ']');
    assert.ok(/pointermove/.test(ev), 'el gesto no avanzó ni un movimiento: [' + ev + ']');
    await check('escandallo: el dedo se queda con el gesto (ya no lo cancela el scroll)', async () => {});

    /* El dedo FUERA del tirador tiene que seguir desplazando: si el renglón
       entero atrapa el gesto, la tabla larga se vuelve una trampa. */
    assert.notEqual(await evalPage(p.sid, "(function(){var w=" + W + ";" +
        "return w.getComputedStyle(w.document.querySelector('#tbodyIngredientes tr[data-ing-i]')).touchAction;})()"),
        'none', 'el renglón entero atrapa el dedo: ya no se puede desplazar la lista');
    /* Y los campos siguen alcanzables: el área del tirador no puede tapar el
       nombre del ingrediente. */
    /* El área de dedo del tirador no puede estar tapando el campo del
       ingrediente: ensancharla de más fue justo lo que pasó en el primer
       intento de arreglo, y esta prueba lo cazó. */
    const tapa = await evalPage(p.sid, "(function(){var d=" + W + ".document;" +
        "var i=d.querySelector('#tbodyIngredientes [data-ing=\"nombre\"]');" +
        "i.scrollIntoView({block:'center'});" +    /* tras el gesto la tarjeta se movió */
        "var r=i.getBoundingClientRect();" +
        "var e=d.elementFromPoint(r.left+r.width/2,r.top+r.height/2);" +
        "return {sobre:e?(e.tagName+'|'+(e.className||'')):null," +
        "esTirador:!!(e&&e.closest&&e.closest('.ord-grip'))," +
        "alcanzable:!!(e&&(e===i||i.contains(e)||i===e.closest('.ing-name-control')||(e.closest&&e.closest('.ing-name-control')&&e.closest('.ing-name-control').contains(i))))};})()");
    assert.ok(!tapa.esTirador, 'el área de toque del tirador tapa el campo del ingrediente: ' + JSON.stringify(tapa));
    assert.ok(tapa.alcanzable, 'el campo del ingrediente quedó cubierto por algo: ' + JSON.stringify(tapa));
    await check('escandallo: se puede desplazar y escribir como siempre', async () => {});
    const shot1 = await send('Page.captureScreenshot', { format: 'png' }, p.sid);
    fs.writeFileSync(dir + '/touch-escandallo.png', Buffer.from(shot1.data, 'base64'));
    await evalPage(p.sid, "typeof cerrarIframeInsumo==='function'&&cerrarIframeInsumo(true);true");

    /* ── 2) El catálogo de insumos, en sus dos vistas ─────────────────────
       En pestaña propia: la ventana flotante del escandallo deja su iframe y su
       estado en la página, y navegar encima de eso dejaba el catálogo a medio
       arrancar. Una pestaña nueva arranca limpio y además prueba la entrada
       directa, que es como lo abre quien lo usa. */
    await close(p);
    /* Cuatro insumos de la sucursal activa: los suficientes para arrastrar el
       tercero sobre el primero y que quede claro cuál se movió. */
    const catTac = ['Agave', 'Betabel', 'Cilantro', 'Durazno'].map((n, i) => ({
        id: 'tac' + i, nombre: n, variedad: 'de prueba', tipoInsumo: 'abarrote',
        familia: 'Alimentos', categoria: 'Abarrotes', activo: '1', orden: i,
        sucursales: ['matriz'], sucursalId: 'matriz',
        presentaciones: [{ contNeto: 1000, umContenido: 'G', costoUnitario: 50, umCosto: 'KG' }]
    }));
    const c = await page(base, '/hub.html', 'owner', 768, true);
    await send('Network.setExtraHTTPHeaders', { headers: {} }, c.sid);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, c.sid);
    await send('Emulation.setDeviceMetricsOverride', { width: 768, height: ALTO, deviceScaleFactor: 1, mobile: false }, c.sid);
    await send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'indexeddb' }, c.sid);
    await evalPage(c.sid, 'sessionStorage.setItem("__fixture_insumos",' + JSON.stringify(JSON.stringify(catTac)) + ')');
    await go(c, 'location.href=' + JSON.stringify(base + '/recetas/insumos.html'),
        "typeof toggleModoOrden==='function' && typeof getInsumos==='function' && getInsumos().length>=3 && document.readyState==='complete'");
    await evalPage(c.sid, "document.getElementById('etaaxNovOk')?.click();true");
    p = c;
    for (const vista of ['lista', 'grid']) {
        await evalPage(p.sid, "if(_modoOrden)toggleModoOrden();setVistaInsumos(" + JSON.stringify(vista) + ");true");
        await pause(150);
        await evalPage(p.sid, "if(!_modoOrden)toggleModoOrden();true");
        const cont = vista === 'lista' ? '#tbodyInsumos' : '#gridInsumos';
        await until(p.sid, "document.querySelectorAll('" + cont + " [data-ord-id]').length>=3");
        /* En las dos vistas tiene que haber tirador. Sin él el asa es la tarjeta
           entera: el dedo que quería desplazar arrastra un insumo, y soltar
           encima abre su ficha. */
        const tiradores = await evalPage(p.sid, "document.querySelectorAll('" + cont + " .ord-grip').length");
        assert.ok(tiradores >= 3, vista + ': sin tirador en modo Ordenar, el asa es la tarjeta entera (' + tiradores + ')');
        const d = await evalPage(p.sid, "(function(){var g=document.querySelector('" + cont + " .ord-grip');" +
            "var cs=getComputedStyle(g);return {display:cs.display,touch:cs.touchAction};})()");
        assert.notEqual(d.display, 'inline', vista + ': tirador inline ' + JSON.stringify(d));
        assert.equal(d.touch, 'none', vista + ': sin touch-action efectivo ' + JSON.stringify(d));

        const orden = "Array.from(document.querySelectorAll('" + cont + " [data-ord-id]')).slice(0,4).map(function(x){return x.getAttribute('data-ord-id');}).join('|')";
        await pause(300);   // que termine de pintar la lista en modo Ordenar
        const antes = (await evalPage(p.sid, orden)).split('|');
        await evalPage(p.sid, _ESPIA_PUNTERO);
        /* Acercar y medir en la MISMA evaluación: tomar las coordenadas sin
           acercar dejaba el toque en y=1226 con una ventana de 1000, y un toque
           fuera de la ventana se cancela — parecía que el arrastre no servía
           cuando lo que fallaba era la puntería de la prueba. */
        /* NI EL ORIGEN NI EL DESTINO SE ADIVINAN: SE BUSCAN.
           Apuntar a coordenadas calculadas falló por turnos —la fila de la
           lista es más ancha que la pantalla, el centro de la tarjeta cae sobre
           el icono de su foto, y a 768 px el `.header` es un bloque pegajoso de
           437×268 px con z-index 49 que se queda encima del contenido y se come
           los toques—. Así que se recorre la lista buscando un par vecino donde
           el tirador del de abajo reciba el toque Y algún punto de la mitad
           superior del de arriba responda A ESA tarjeta, que es justo la
           pregunta que hace `_marcar` al soltar. Si no hay ningún par usable,
           la prueba lo dice en vez de arrastrar al vacío y pasar por la razón
           equivocada. */
        const g = await evalPage(p.sid, "(function(){" +
            "var its=document.querySelectorAll('" + cont + " [data-ord-id]');" +
            /* Se prueban las tres alineaciones: con la tarjeta centrada, su
               mitad superior cae dentro de la banda del header pegajoso y no
               hay dónde soltar; bajándola queda despejada. */
            "var alin=['end','center','start'];" +
            "for(var a=0;a<alin.length;a++)" +
            "for(var k=its.length-1;k>=1;k--){" +
            "  var mov=its[k], dest=its[k-1];" +
            "  dest.scrollIntoView({block:alin[a]});" +
            "  var gt=mov.querySelector('.ord-grip'); if(!gt) continue;" +
            "  var gr=gt.getBoundingClientRect();" +
            "  if(!(gr.top>0 && gr.bottom<innerHeight)) continue;" +
            "  var eo=document.elementFromPoint(gr.left+gr.width/2,gr.top+gr.height/2);" +
            "  if(!(eo&&eo.closest&&eo.closest('.ord-grip'))) continue;" +
            "  var r=dest.getBoundingClientRect(), xs=[];" +
            "  var gd=dest.querySelector('.ord-grip');" +
            "  if(gd){var q=gd.getBoundingClientRect();xs.push(q.left+q.width/2);}" +
            "  xs.push(Math.min(Math.max(r.left+24,8),innerWidth-8));" +
            "  xs.push(Math.min(Math.max(r.left+r.width/2,8),innerWidth-8));" +
            "  for(var dy=4;dy<r.height/2;dy+=6){" +
            "    for(var i=0;i<xs.length;i++){" +
            "      var y=r.top+dy; if(y<=0||y>=innerHeight) continue;" +
            "      var e=document.elementFromPoint(xs[i],y);" +
            "      var f=e&&e.closest?e.closest('[data-ord-id]'):null;" +
            "      if(f===dest) return {gx:gr.left+gr.width/2,gy:gr.top+gr.height/2," +
            "        destinoX:xs[i],destino:y,mov:mov.getAttribute('data-ord-id')," +
            "        dest:dest.getAttribute('data-ord-id'),i:k};" +
            "    }}}" +
            "return {mov:null};})()");
        assert.ok(g.mov, vista + ': no hay un par de renglones donde se pueda soltar ' +
            '(¿el header pegajoso tapa el contenido?): ' + JSON.stringify(g));
        await _arrastrarConDedo(p.sid, { x: g.gx, y: g.gy }, { x: g.destinoX, y: g.destino });
        const ev2 = await evalPage(p.sid, "window.__ev.join(' ')");
        assert.ok(!/pointercancel/.test(ev2), vista + ': el navegador canceló el gesto: [' + ev2 + ']');
        /* El arrastrado pasa ARRIBA de su vecino: se afirma el orden EXACTO,
           no solo que "algo cambió" —un repintado que revuelva la lista también
           cambiaría la cadena—. */
        const esperado = antes.slice();
        esperado.splice(g.i - 1, 0, esperado.splice(g.i, 1)[0]);
        assert.equal(await evalPage(p.sid, orden), esperado.join('|'),
            vista + ': el dedo no reacomodó el catálogo como se esperaba (movió ' + g.mov +
            ' sobre ' + g.dest + ') · [' + ev2 + ']');
        /* Soltar un arrastre no puede abrir la ficha: la tarjeta tiene su
           propio onclick y en galería ocupa toda el área. */
        assert.ok(!await evalPage(p.sid, "!!document.querySelector('#modalOverlay[style*=\"flex\"]')"),
            vista + ': soltar el arrastre abrió la ficha del insumo');
        await check('catálogo ' + vista + ': el dedo reacomoda y no abre la ficha', async () => {});
        const shot = await send('Page.captureScreenshot', { format: 'png' }, p.sid);
        fs.writeFileSync(dir + '/touch-catalogo-' + vista + '.png', Buffer.from(shot.data, 'base64'));
    }

    /* Costeo agrupa presentaciones: no hay tabla que ordenar a mano, así que el
       botón no puede quedarse prendido aparentando que sí. */
    await evalPage(p.sid, "if(_modoOrden)toggleModoOrden();setVistaInsumos('costeo');true");
    await pause(200);
    await evalPage(p.sid, "if(!_modoOrden)toggleModoOrden();true");
    await pause(250);
    const costeo = await evalPage(p.sid, "({vista:vistaInsumos,modo:!!_modoOrden})");
    assert.ok(costeo.vista !== 'costeo' || !costeo.modo,
        'Ordenar quedó prendido en Costeo, donde no hay nada que arrastrar: ' + JSON.stringify(costeo));
    await check('Costeo: Ordenar no se queda prendido sin poder ordenar', async () => {});

    /* Y al salir no puede quedar basura del gesto: ni el documento sin
       selección ni marcas de destino pegadas. */
    const limpio = await evalPage(p.sid, "({doc:document.body.classList.contains('ord-arrastrando-doc')," +
        "marcas:document.querySelectorAll('.ord-antes,.ord-despues,.ord-arrastrando').length})");
    assert.ok(!limpio.doc && limpio.marcas === 0, 'quedó rastro del gesto: ' + JSON.stringify(limpio));
    await check('al salir del modo no queda rastro del gesto', async () => {});
    await close(p);
}

async function probarIdentidadCatalogos(base, dir) {
    const maestro = {id:'maestro-1',nombre:'Maestro de prueba',marca:'Marca',tipoInsumo:'licor',familia:'Bebidas',categoria:'Licores',activo:'1',sucursales:[],sucursalId:'',
        presentaciones:[{contNeto:700,umContenido:'ML',precio:799,costoUnitario:1141.428571,umCosto:'LT'}]};
    const otro = {...maestro,id:'maestro-2',variedad:'Otra presentación'};
    const tercero = {...maestro,id:'maestro-3',variedad:'Nueva en ETAAX'};
    const copia = (m, suc) => ({...m,id:m.id+'-'+suc,origenId:m.id,sucursales:[suc],sucursalId:suc});
    for (const width of [1440,390]) {
        const p = await page(base,'/hub.html','owner',width,true);
        await send('Storage.clearDataForOrigin',{origin:base,storageTypes:'indexeddb'},p.sid);
        await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
        const fixture = [maestro,copia(maestro,'matriz'),copia(maestro,'norte'),otro,copia(otro,'norte')];
        await evalPage(p.sid, `sessionStorage.setItem('__fixture_insumos',${JSON.stringify(JSON.stringify(fixture))});sessionStorage.setItem('__fixture_catalogo',${JSON.stringify(JSON.stringify([maestro,otro,tercero]))});localStorage.setItem('etaax_n1_insumos',${JSON.stringify(JSON.stringify(fixture))});`);
        await go(p,'location.href='+JSON.stringify(base+'/recetas/insumos.html'),"typeof abrirInsumosGlobalNeg==='function' && getInsumos().length===5 && document.readyState==='complete'");
        await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click()");
        await click(p,'[onclick="abrirInsumosGlobalNeg()"]');
        await until(p.sid,"document.getElementById('modalInsumosNeg').style.display==='flex' && _ignTodos.length===2");
        await check(width+' negocio: solo maestros y copia existente bloqueada', async () => {
            const r = await evalPage(p.sid,"({ids:_ignTodos.map(x=>x.id),disabled:document.querySelectorAll('#ignLista button:disabled').length,add:document.querySelectorAll('#ignLista button:not(:disabled)').length})");
            assert.deepEqual(r.ids,['maestro-1','maestro-2']); assert.equal(r.disabled,1); assert.equal(r.add,1);
        });
        await click(p,'#ignBtn_maestro-2');
        await check(width+' negocio: importar conserva una sola copia por destino', async () => {
            await until(p.sid,"document.querySelectorAll('#ignLista button:disabled').length===2");
            await evalPage(p.sid,"ignAgregar('maestro-1-norte');ignAgregar('maestro-2')");
            assert.equal(await evalPage(p.sid,"getInsumos().filter(x=>x.origenId==='maestro-2' && _insumoEnSuc(x,'matriz')).length"),1);
            assert.equal(await evalPage(p.sid,"getInsumos().length"),6);
        });
        let shot = await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,'catalogo-negocio-'+width+'.png'),Buffer.from(shot.data,'base64'));
        await evalPage(p.sid,'cerrarInsumosNeg()');
        await click(p,'[onclick="abrirCatalogoGlobal()"]');
        await until(p.sid,"_cgCargado && _cgTodos.length===3 && document.querySelectorAll('#cgLista button').length===3");
        await check(width+' ETAAX: reconoce las copias importadas desde ambos catálogos', async () => {
            assert.equal(await evalPage(p.sid,"document.querySelectorAll('#cgLista button:disabled').length"),2);
            assert.equal(await evalPage(p.sid,"document.querySelectorAll('#cgLista button:not(:disabled)').length"),1);
            const anchoNombre = await evalPage(p.sid,"document.querySelector('#cgLista .ins-catalogo-info').getBoundingClientRect().width");
            assert.ok(anchoNombre >= 200, 'El indicador oculta el nombre del insumo: '+anchoNombre);
        });
        await click(p,'#cgBtn_maestro-3');
        await evalPage(p.sid,"Promise.all([cgAgregar('maestro-3'),cgAgregar('maestro-3')])");
        await check(width+' ETAAX: repetir el alta no duplica y sobrevive a recargar', async () => {
            assert.equal(await evalPage(p.sid,"getInsumos().length"),8);
            await until(p.sid,"JSON.parse(sessionStorage.getItem('__fixture_insumos')).length===8");
            await go(p,'location.reload()',"typeof abrirCatalogoGlobal==='function' && getInsumos().length===8 && document.readyState==='complete'");
            await evalPage(p.sid,'abrirCatalogoGlobal()');
            await until(p.sid,"document.querySelectorAll('#cgLista button:disabled').length===3");
            assert.equal(await evalPage(p.sid,"document.querySelectorAll('#cgLista button:not(:disabled)').length"),0);
            assert.deepEqual(await evalPage(p.sid,'window.__errors'),[]);
        });
        shot = await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(dir,'catalogo-etaax-'+width+'.png'),Buffer.from(shot.data,'base64'));
        await close(p);
    }
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
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'etaax-ventanas-chrome-'));
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
    console.log('VENTANAS INSUMOS: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
