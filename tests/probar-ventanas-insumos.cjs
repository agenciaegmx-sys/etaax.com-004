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
            range(start) { q.start=start; return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, neq() { return q; }, or() { return q; },
            maybeSingle() { q.single = true; return q; }, update(value) { q.value = value; return q; },
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
 const dir=path.join(os.tmpdir(),'etaax-ventanas-insumos');fs.mkdirSync(dir,{recursive:true});
 if (process.env.ETAAX_PRUEBA_SALIDAS) { await probarSalidasCalendario(base,dir); return; }
 if (process.env.ETAAX_PRUEBA_STOCK) { await probarStockCosteo(base,dir); return; }
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
