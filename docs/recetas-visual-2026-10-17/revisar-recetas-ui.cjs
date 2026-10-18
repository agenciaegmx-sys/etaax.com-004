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


async function run(base) {
 const dir=path.join(os.tmpdir(),'etaax-recetas-ui');fs.mkdirSync(dir,{recursive:true});
 const insumos=[{id:'in-a',nombre:'Harina de prueba',sucursalId:'suc_principal',area:'cocina',familia:'Alimentos',presentaciones:[{id:'pa',nombre:'Bolsa',contenido:1,umContenido:'KG',umCosto:'KG',costoUnitario:80,precio:80}]},
 {id:'in-b',nombre:'Mezcla de prueba',sucursalId:'suc_principal',area:'barra',familia:'Bebidas',presentaciones:[{id:'pb',nombre:'Botella',contenido:1,umContenido:'LT',umCosto:'LT',costoUnitario:20,precio:20}]},
 {id:'in-n',nombre:'Insumo exclusivo Norte',sucursalId:'norte',familia:'Alimentos',presentaciones:[{id:'pn',umContenido:'KG',umCosto:'KG',costoUnitario:100}]}];
 const tipos=['alimentos','sub-alimentos','bebidas','sub-bebidas'];
 const recetas=tipos.map((tipo,i)=>({id:'r'+i,nombre:['Plato <de prueba>','Salsa de prueba','Bebida de prueba','Jarabe de prueba'][i],tipo,status:'activa',sucursales:['suc_principal'],sucursalId:'suc_principal',grupo:'Menú de prueba',categoria:'Clásicos',tiempo:'10 min',cristaleria:'Presentación de prueba',procedimiento:'Preparar y servir. Conservar <texto literal>.',precioEnCarta:i===0?116:i===2?58:0,
 ingredientes:[{insumoId:i<2?'in-a':'in-b',nombre:i<2?'Harina de prueba':'Mezcla de prueba',desc:'Prueba local',cantidad:i<2?0.5:i===2?0.25:1,unidad:i<2?'KG':'LT',costoPorKgLt:i<2?80:20}],
 camposExtra:{tipoMedicion:'granel',rendimientoFinal:i===1?'2':i===3?'0.8':'1',unidadRendimientoFinal:i<2?'KG':'LT',porcionesQty:i===1?'10':i===3?'8':'',porcionesUnidad:'pzas',unidadPesoAutoDisplay:i<2?'G':'ML',porcionUnidad:'PLATILLO',porcionCant:1}}));
 recetas.push({...recetas[0],id:'r-norte',nombre:'Receta exclusiva Norte',sucursales:['norte'],sucursalId:'norte'});
 async function shot(p,name){await pause(180);const s=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(dir+'/'+name+'.png',Buffer.from(s.data,'base64'));}
 async function bounded(p,expr='document') {
  const m=await evalPage(p.sid,`(()=>{const d=${expr};const w=d.defaultView;return {w:w.innerWidth,sw:d.documentElement.scrollWidth}})()`);
  if(m.sw>m.w+1)console.log('DESBORDE '+JSON.stringify(await evalPage(p.sid,`(()=>{const d=${expr},w=d.defaultView.innerWidth;return [...d.querySelectorAll('body *')].filter(x=>{const r=x.getBoundingClientRect();if(!(r.width>0&&r.right>w+1))return false;for(let a=x.parentElement;a&&a!==d.body;a=a.parentElement){if(/auto|scroll|hidden|clip/.test(d.defaultView.getComputedStyle(a).overflowX)&&a.getBoundingClientRect().right<=w+1)return false;}return true}).slice(0,24).map(x=>({tag:x.tagName,id:x.id,cls:x.className,r:x.getBoundingClientRect().right,w:x.getBoundingClientRect().width,style:x.getAttribute('style')}))})()`)));assert.ok(m.sw<=m.w+1,JSON.stringify(m));
 }
 for(const width of (process.env.RECETAS_WIDTHS?process.env.RECETAS_WIDTHS.split(',').map(Number):[1440,768,390,320])) {
  const p=await page(base,'/hub.html','owner',width,true);await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
  await evalPage(p.sid,`sessionStorage.setItem('__fixture_recetas',${JSON.stringify(JSON.stringify(recetas))});sessionStorage.setItem('__fixture_insumos',${JSON.stringify(JSON.stringify(insumos))});`);
  await go(p,'location.href='+JSON.stringify(base+'/recetas/index.html?escandallos=1'),"typeof verRecetas==='function' && document.querySelector('.etx-recetas-page')");
  await until(p.sid,"getRecetas().length>=5 && getCatalogoInsumos().length>=3");
  if(process.env.RECETAS_EXTRAS_ONLY) {
   await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click();verRecetas();buscarReceta.value='No coincide';renderGridRecetas()");
   await until(p.sid,"document.querySelector('#gridRecetas > div .r-ui-icon')");
   await shot(p,'catalogo-vacio-'+width);await bounded(p);
   await evalPage(p.sid,"modalVerRecetas.style.display='none';abrirCaratulaModal()");
   await until(p.sid,"iframeInsumo.contentWindow.document.querySelector('.r-group-card')");
   async function fe(e){return evalPage(p.sid,'iframeInsumo.contentWindow.eval('+JSON.stringify(e)+')');}
   await fe("EtaaxTheme.set('light');verCaratulaGrupo('sub-bebidas')");await shot(p,'caratula-claro-'+width);await bounded(p,'iframeInsumo.contentDocument');
   await fe("abrirFichaDesdeCaratula('r3');abrirFichaCosteo()");
   await until(p.sid,"iframeInsumo.contentDocument.querySelector('#costeoFlotanteContenido .r-cost-panel')");
   await shot(p,'costeo-claro-'+width);await bounded(p,'iframeInsumo.contentDocument');
   await fe("document.querySelector('#modalCosteoFlotante button').click();editarDesdeficha()");
   await until(p.sid,"iframeInsumo.contentDocument.querySelector('#mescBody #editorWrap') && iframeInsumo.contentDocument.getElementById('modalEscandalloCaratula').style.display==='flex'");
   await shot(p,'editor-desde-caratula-'+width);await bounded(p,'iframeInsumo.contentDocument');
   assert.ok(await fe("document.getElementById('btnGuardarCaratulaEdit').getBoundingClientRect().bottom<=innerHeight"));
   await fe("cancelarEdicionDesdeCaratula()");
   assert.equal(await fe('caratulaTipoActual'),'sub-bebidas');
   await evalPage(p.sid,"cerrarIframeInsumo(true)");
   if(width===320) {
    await send('Emulation.setDeviceMetricsOverride',{width:320,height:640,deviceScaleFactor:1,mobile:true},p.sid);
    await evalPage(p.sid,"abrirEscModal('sub-bebidas')");
    await until(p.sid,"(()=>{var w=iframeInsumo.contentWindow,d=w.document,e=d.getElementById('editorWrap');return e&&d.querySelector('#brandTitle .r-title-plate')&&w.eval('recetaTipoActual')==='sub-bebidas'&&w.getComputedStyle(e).display!=='none'&&d.getElementById('nombreReceta')})()");
    await shot(p,'pantalla-corta-320');await bounded(p,'iframeInsumo.contentDocument');
    assert.ok(await evalPage(p.sid,"(()=>{var w=iframeInsumo.contentWindow;var b=w.document.getElementById('btnGuardarReceta');return b.getClientRects().length>0&&b.getBoundingClientRect().bottom<=w.innerHeight})()"));
   }
   assert.deepEqual(await evalPage(p.sid,'__errors'),[]);results.push('extras-'+width);console.log('PASA extras '+width+'px: estado vacío, tema claro, costeo, editar desde carátula, cancelar y pantalla corta.');await close(p);continue;
  }

  await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click();document.fonts.ready;verRecetas()");
  await until(p.sid,"document.querySelectorAll('#gridRecetas [data-rec-card]').length===4 && document.querySelector('.r-recipe-type')");
  assert.equal(await evalPage(p.sid,"gridRecetas.textContent.includes('Receta exclusiva Norte')"),false);
  await shot(p,'catalogo-'+width);await bounded(p);
  await evalPage(p.sid,"buscarReceta.value='Salsa';buscarReceta.dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evalPage(p.sid,"_recetasVisibles.length"),1);
  await evalPage(p.sid,"selRecetasVisibles();buscarReceta.value='Bebida';renderGridRecetas();selRecetasVisibles()");
  assert.equal(await evalPage(p.sid,'recetasSeleccionadas.size'),2);
  await evalPage(p.sid,"buscarReceta.value='';renderGridRecetas();setVistaRecetas('lista')");
  assert.equal(await evalPage(p.sid,"gridRecetas.querySelectorAll('tbody tr').length"),4);
  await shot(p,'lista-'+width);await bounded(p);
  await evalPage(p.sid,"limpiarSelRecetas();setVistaRecetas('grid')");
  for(let i=0;i<4;i++) {
   await evalPage(p.sid,`abrirFichaReceta('r${i}')`);
   await until(p.sid,"document.querySelector('#fichaTitulo .r-title-copy')");
   assert.equal(await evalPage(p.sid,"document.querySelector('#fichaTitulo .r-title-copy').textContent"),recetas[i].nombre);
   assert.ok(await evalPage(p.sid,`fichaRecetaContenido.textContent.includes('$${i<2?'40.00':i===2?'5.00':'20.00'}')`));
   await shot(p,'ficha-'+tipos[i]+'-'+width);await bounded(p);
   await evalPage(p.sid,"btnFichaCosteo.click()");
   await until(p.sid,"document.querySelector('#costeoFlotanteContenido .r-cost-panel .r-ui-icon')");
   if(i===1)assert.ok(await evalPage(p.sid,"costeoFlotanteContenido.textContent.includes('$4.00')"));
   if(i===3)assert.ok(await evalPage(p.sid,"costeoFlotanteContenido.textContent.includes('$2.50')"));
   await shot(p,'costeo-'+tipos[i]+'-'+width);await bounded(p);
   await evalPage(p.sid,"document.querySelector('#modalCosteoFlotante button').click();btnFichaImprimir.click()");
   assert.equal(await evalPage(p.sid,"getComputedStyle(modalImpresion).display"),'flex');
   await evalPage(p.sid,"modalImpresion.style.display='none';btnFichaEditar.click()");
   await until(p.sid,`iframeInsumo.contentWindow.document.getElementById('nombreReceta')?.value===${JSON.stringify(recetas[i].nombre)} && iframeInsumo.contentWindow.document.querySelector('#brandTitle .r-title-plate')`);
   async function fe(e){return evalPage(p.sid,'iframeInsumo.contentWindow.eval('+JSON.stringify(e)+')');}
   assert.equal(await fe('recetaTipoActual'),tipos[i]);
   assert.equal(await fe("document.getElementById('costoTotalDisplay').textContent"),'$'+(i<2?'40.00':i===2?'5.00':'20.00'));
   assert.equal(await fe("Array.from(document.querySelectorAll('#etaax-header,.top-bar,.ctx-bar')).some(x=>x.getClientRects().length)"),false);
   await shot(p,'editor-'+tipos[i]+'-'+width);await bounded(p,'iframeInsumo.contentDocument');
   const changed=i<2?0.6:i===2?0.5:2;
   await fe(`updateIng(0,'cantidad',${changed})`);
   assert.equal(await fe("document.getElementById('costoTotalDisplay').textContent"),'$'+(i<2?'48.00':i===2?'10.00':'40.00'));
   await fe(`updateIng(0,'cantidad',${recetas[i].ingredientes[0].cantidad})`);
   if(i===1||i===3) {
    await fe("document.getElementById('cardRendimientoSub').scrollIntoView({block:'start'})");
    await shot(p,'rendimiento-'+tipos[i]+'-'+width);
    assert.ok((await fe("document.getElementById('sub-costoPorcion').textContent")).includes(i===1?'4.00':'2.50'));
   }else{
    await fe("document.getElementById('btnVista').click();document.getElementById('seccionCostos').scrollIntoView({block:'start'})");
    await shot(p,'editor-costeo-'+tipos[i]+'-'+width);
   }
   if(i===0) {
    await fe("document.querySelector('#tablaIngredientes [data-ing=nombre]').scrollIntoView({block:'center'});mostrarDropdown(0,'prueba')");
    assert.equal(await fe("document.querySelector('.ins-dropdown').textContent.includes('Insumo exclusivo Norte')"),false);
    await shot(p,'buscador-insumo-'+width);
    await fe("cerrarTodosDropdowns();document.querySelector('[onclick*=\"_toggleInsumoMenu\"]').click()");
    assert.equal(await fe("getComputedStyle(document.getElementById('insumoMenu')).display"),'block');
    await fe("document.getElementById('insumoMenu').style.display='none'");
   }
   assert.deepEqual(await fe('window.__errors'),[]);
   await fe('guardarReceta()');
   await until(p.sid,"getComputedStyle(modalIframeInsumo).display==='none'");
   await until(p.sid,`getRecetas().find(r=>r.id==='r${i}')?.ingredientes[0].cantidad===${recetas[i].ingredientes[0].cantidad}`);
   assert.equal(await evalPage(p.sid,`getRecetas().filter(r=>r.id==='r${i}').length`),1);
   console.log('PASA '+width+'px '+tipos[i]+': ficha, costeo, edición en iframe, cálculo al cambiar cantidad y guardar.');
  }
  await evalPage(p.sid,"document.getElementById('modalVerRecetas').style.display='none';abrirModalNuevaReceta()");
  await until(p.sid,"document.querySelectorAll('#modalNuevaReceta .modal-body button .r-ui-icon').length===4");
  await shot(p,'nueva-receta-'+width);await bounded(p);
  await evalPage(p.sid,"document.getElementById('modalNuevaReceta').style.display='none';abrirEscModal('alimentos')");
  await until(p.sid,"iframeInsumo.contentWindow.document.getElementById('nombreReceta')?.value==='' && iframeInsumo.contentWindow.document.querySelector('#brandTitle .r-title-plate')");
  assert.equal(await evalPage(p.sid,"iframeInsumo.contentWindow.eval('recetaActualId')"),null);
  await evalPage(p.sid,"document.querySelector('#modalIframeInsumo .etx-min-btn').click();document.querySelector('#etx-dock .etx-chip').click()");
  assert.notEqual(await evalPage(p.sid,"getComputedStyle(modalIframeInsumo).display"),'none');
  await evalPage(p.sid,"cerrarIframeInsumo(true);abrirCaratulaModal()");
  await until(p.sid,"iframeInsumo.contentWindow.document.querySelectorAll('#caratulaSelectorGrid button').length===4 && iframeInsumo.contentWindow.document.querySelector('.r-group-card')");
  await shot(p,'caratula-selector-'+width);await bounded(p,'iframeInsumo.contentDocument');
  for(let i=0;i<4;i++) {
   await evalPage(p.sid,`iframeInsumo.contentWindow.verCaratulaGrupo('${tipos[i]}')`);
   assert.ok(await evalPage(p.sid,"iframeInsumo.contentDocument.getElementById('caratulaDetalleBody').textContent.includes('Ver')"));
   assert.equal(await evalPage(p.sid,"iframeInsumo.contentDocument.getElementById('caratulaDetalleBody').textContent.includes('Receta exclusiva Norte')"),false);
   await shot(p,'caratula-'+tipos[i]+'-'+width);await bounded(p,'iframeInsumo.contentDocument');
  }
  await evalPage(p.sid,"cerrarIframeInsumo(true);crearReceta('alimentos')");
  const papel=await evalPage(p.sid,"(()=>{const r=getRecetas().find(r=>r.id==='r0');return {operativa:buildPlantillaOperativa([r]),administrativa:buildPlantillaAdministrativa([r])}})()");
  assert.equal(papel.operativa.includes('$40.00'),false);assert.ok(papel.administrativa.includes('$40.00'));
  // El CSS no debe volver a mostrar controles ocultados por el permiso original.
  await evalPage(p.sid,"window.etaaxPuedeSub=function(m,s){return !['verCostos','editar','crear','crearSub','caratula'].includes(s)};_aplicarPermisosRec()");
  assert.equal(await evalPage(p.sid,"getComputedStyle(btnGuardarReceta).display"),'none');
  assert.equal(await evalPage(p.sid,"getComputedStyle(btnCaratula).display"),'none');
  assert.equal(await evalPage(p.sid,"getComputedStyle(barraCostoTotal).display"),'none');
  await evalPage(p.sid,"EtaaxTheme.set('light');verRecetas()");await shot(p,'catalogo-claro-'+width);
  assert.deepEqual(await evalPage(p.sid,'__errors'),[]);
  results.push(width);await close(p);
 }
 assert.equal(forbidden.length,0);console.log('Capturas '+dir);
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
    console.log('RECETAS: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
