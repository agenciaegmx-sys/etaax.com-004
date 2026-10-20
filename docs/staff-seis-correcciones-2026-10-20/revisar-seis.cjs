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
let server, chrome, socket, closing = false, next = 0, slowUI=false;
const heldScripts=[];
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
        const filters = {}, q = { select() { return q; }, eq(k,v) { filters[k] = v; return q; }, is(k,v) { filters[k] = v; return q; },
            range() { return q; }, single() { q.one=true;return q; },order() { return q; }, limit() { return q; }, neq() { return q; }, or() { return q; }, delete() { q.deleting=true; return q; }, not() { return q; }, in() { return q; },
            maybeSingle() { q.one = true; return q; }, update(value) { q.value = value; return q; },
            upsert(value) { q.value = value; return q; }, insert(value) { q.value = value; return q; },
            then(resolve, reject) {
                window.__calls.push({ type: 'table', table, filters: { ...filters }, value: q.value, deleting: q.deleting });
                if(window.__fallarNomina&&table==='gf_nomina_params'&&q.value)return Promise.resolve({data:null,error:{message:'Fallo controlado'}}).then(resolve,reject);
                let data = null, error = null;
                if (q.value) {
                    data = q.value;
                    if(table==='gf_nomina_params'){
                        const stamp=sessionStorage.getItem('__fixture_revision')||null;
                        if('updated_at' in filters && stamp!==filters.updated_at)data=[];
                        else {sessionStorage.setItem('__fixture_params',JSON.stringify(q.value.datos));sessionStorage.setItem('__fixture_revision',q.value.updated_at);data=[{negocio_id:'n1'}];}
                    }
                    if(table==='staff') {
                        const registros=Array.isArray(q.value)?q.value:[q.value];
                        const prev=JSON.parse(sessionStorage.getItem('__fixture_staff')||'[]');
                        registros.forEach(r=>{const i=prev.findIndex(s=>s.id===r.datos.id);if(i>=0)prev[i]=r.datos;else prev.push(r.datos);});
                        sessionStorage.setItem('__fixture_staff',JSON.stringify(prev));
                    }
                }
                else if(table==='gf_nomina_params') data={datos:JSON.parse(sessionStorage.getItem('__fixture_params')||'{}'),updated_at:sessionStorage.getItem('__fixture_revision')||null};
                else if(table==='horarios') data=JSON.parse(sessionStorage.getItem('__fixture_horarios')||'[]').map(datos=>({datos}));
                else if(table==='staff') data=q.deleting?[]:JSON.parse(sessionStorage.getItem('__fixture_staff')||'[]').map(datos=>({datos}));
                else if (table === 'negocios') data = negocios.filter(n => Object.keys(filters).every(k => n[k] === filters[k]));
                else if (table === 'negocio_sucursales') data = { datos: { sucursales: filters.negocio_id === 'n2' ? [{id:'suc_principal',nombre:'Matriz',activa:true,fechaCreado:'2026-08-07'}]
                    : [{id:'suc_principal',nombre:'Centro',activa:true,fechaCreado:'2026-08-07'},{id:'norte',nombre:'Norte',activa:true,fechaCreado:'2026-08-07'}], cfg:{} } };
                else if (table === 'suscripciones') data = { estado: mode === 'pending' ? 'pendiente' : mode === 'stripe' ? 'vencida' : 'activa', proximo_cobro: '2026-11-13', dias_tolerancia:3,
                    stripe_subscription_id: mode === 'stripe' ? 'sub_fixture' : null };
                else if (table === 'usuarios') data = { id:'u1',nombre:user.user_metadata.nombre,plan:'pyme' };
                else data = q.one ? null : [];
                if (window.__fail && table === 'suscripciones') error = { message:'Fallo controlado' };
                if (q.one && Array.isArray(data)) data = data[0] || null;
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
        localStorage.setItem('etaax_n1_sucursales',JSON.stringify([{id:'suc_principal',nombre:'Centro',activa:true,fechaCreado:'2026-08-07'},{id:'norte',nombre:'Norte',activa:true,fechaCreado:'2026-08-07'}]));
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
 const empleados=[
  {id:'col1',nombre:'Ana González',puesto:'Gerente',rol:'gerente',usuario:'ana.staff',passwordHash:'conservar-hash',nipHash:'conservar-nip',estado:'Activo',sucursalId:'suc_principal',esquemaSueldo:'diario',sueldoDiario:315.04,sueldoCapturado:true,periodicidad:'semanal',diaPago:'domingo',notas:'Conservar expediente',bonos:[],documentos:[]},
  {id:'legado',nombre:'Mínimo antiguo Norte',puesto:'Mesero',estado:'Activo',sucursalId:'norte',esquemaSueldo:'diario',sueldoDiario:315.04,sueldoCapturado:true,periodicidad:'semanal'},
  {id:'propio',nombre:'Personalizado Centro',puesto:'Barman',estado:'Activo',sucursalId:'suc_principal',esquemaSueldo:'diario',sueldoDiario:450,origenSueldo:'personalizado',periodicidad:'semanal'},
  {id:'propioViejo',nombre:'Personalizado antiguo Norte',puesto:'Cocinero',estado:'Activo',sucursalId:'norte',esquemaSueldo:'diario',sueldoDiario:450,periodicidad:'semanal'}
 ];
 const shot=async(p,name)=>{await pause(100);const r=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(__dirname,name+'.png'),Buffer.from(r.data,'base64'));};
 const fx=(p,exp)=>evalPage(p.sid,'tmFrame.contentWindow.eval('+JSON.stringify(exp)+')');
 const fu=(p,exp)=>until(p.sid,'document.getElementById("tmFrame") && tmFrame.contentWindow.eval('+JSON.stringify(exp)+')');
 async function auth(p,frame=false){
  const e=frame?exp=>fx(p,exp):exp=>evalPage(p.sid,exp),u=frame?exp=>fu(p,exp):exp=>until(p.sid,exp);
  await u("document.getElementById('modalAdminGuard') && getComputedStyle(modalAdminGuard).display!=='none'");
  await e("adminGuardInput.value='Current123';adminGuardBtn.click()");
  await u("getComputedStyle(modalAdminGuard).display==='none'");
  await u("document.querySelector('.a-authorized .etaax-ui-btn')");await e("document.querySelector('.a-authorized .etaax-ui-btn').click()");
 }
 for(const width of [1440,768,390]){
  const p=await page(base,'/hub.html','owner',width,true);await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
  await evalPage(p.sid,`localStorage.setItem('etaax_n1_staff',${JSON.stringify(JSON.stringify(empleados))});sessionStorage.setItem('__fixture_staff',localStorage.getItem('etaax_n1_staff'));localStorage.setItem('etaax_n1_nomina_params',JSON.stringify({salarioDiarioDefault:315.04,primaVacacionalPct:25,jornadaHoras:8}));sessionStorage.setItem('__fixture_params',localStorage.getItem('etaax_n1_nomina_params'));`);
  await go(p,"location.href='/administrativo/staff-hub'","typeof abrirTool==='function' && document.querySelector('.etx-modulos-ui')");
  await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click();abrirTool('staff','Catálogo de Staff','👥')");
  await fu(p,"location.pathname==='/administrativo/staff' && document.readyState==='complete' && typeof openModal==='function'");await auth(p,true);
  await fu(p,"!_bloqueado && document.querySelector('#btnBajas .s-ui-icon')");
  await check('Cancelar permisos conserva catálogo flotante y contexto · '+width,async()=>{
   await fx(p,"_irAPermisos()");await fu(p,"location.pathname.includes('permisos') && document.readyState==='complete' && typeof _volverCatalogoPermisos==='function'");
   await fu(p,"document.getElementById('modalAdminGuard') && getComputedStyle(modalAdminGuard).display!=='none'");
   await evalPage(p.sid,"_tmSincronizar()");assert.equal(await evalPage(p.sid,"tmTitle.textContent"),'Roles y Permisos');
   await fx(p,"_cerrarAdminGuard()");
   await fu(p,"location.pathname==='/administrativo/staff.html' && document.readyState==='complete' && typeof load==='function' && !_bloqueado");
   assert.deepEqual(await fx(p,"[document.documentElement.classList.contains('embed'),document.body.classList.contains('etx-staff-page'),new URLSearchParams(location.search).get('suc'),getComputedStyle(document.getElementById('nav')).display]"),[true,true,'suc_principal','none']);
   assert.equal(await evalPage(p.sid,"tmTitle.textContent"),'Catálogo de Staff');
  });
  await check('Permisos por URL corta y Volver conservan embed · '+width,async()=>{
   await evalPage(p.sid,"tmFrame.src=_tmURL('permisos')");await fu(p,"location.pathname==='/administrativo/permisos' && document.readyState==='complete' && document.querySelector('#modalAdminGuard')");
   await evalPage(p.sid,"_tmSincronizar()");assert.equal(await evalPage(p.sid,"_tmArchivo()"),'permisos.html');assert.equal(await fx(p,"document.body.classList.contains('etx-permisos-page')"),true);
   await fx(p,"document.querySelector('[onclick=\"_volverCatalogoPermisos()\"]').click()");
   await fu(p,"location.pathname==='/administrativo/staff.html' && document.readyState==='complete' && typeof openModal==='function' && !_bloqueado");
  });
  await check('Nombre vivo, minimizar, guardar importe y conservar credenciales · '+width,async()=>{
   await fx(p,"openModal('col1')");await fu(p,"document.querySelector('#modalStaff .s-title-copy')");
   await fx(p,"fNombre.value='Ana González actualizada';fNombre.dispatchEvent(new Event('input',{bubbles:true}));fMultaRetardo.value=25");
   assert.equal(await fx(p,"modalTitle.textContent.includes('Ana González actualizada')"),true);
   await fu(p,"document.querySelector('#modalStaff .etx-min-btn')");await fx(p,"document.querySelector('#modalStaff .etx-min-btn').click()");
   assert.equal(await fx(p,"document.querySelector('#etx-dock .etx-chip').textContent.includes('Ana González')"),true);
   await fx(p,"document.querySelector('#etx-dock .etx-chip').click();fMultaRetardo.scrollIntoView({block:'center'})");await shot(p,'perfil-'+width);
   await fx(p,"saveStaff()");await fu(p,"!modalStaff.classList.contains('open') && !_guardandoStaff");
   assert.deepEqual(await fx(p,"(()=>{const s=load().find(s=>s.id==='col1');return [s.nombre,s.multaRetardo,s.passwordHash,s.nipHash,s.diaPago]})()"),['Ana González actualizada',25,'conservar-hash','conservar-nip','domingo']);
  });
  await check('Parámetros y perfiles separados por sucursal, incluidos antiguos · '+width,async()=>{
   await fx(p,"NominaParams._openReal('n1');np_diario.value=400;NominaParams._save()");await fu(p,"!np_overlay.classList.contains('open') && NominaParams.get('n1').salarioDiarioDefault===400");
   assert.deepEqual(await fx(p,"load().map(s=>EtaaxCore.sueldoDiarioEfectivo(s,NominaParams.get('n1',s.sucursalId)))"),[400,315.04,450,450]);
   await fx(p,"localStorage.setItem('etaax_sucursal_activa','norte');NominaParams._openReal('n1')");assert.equal(await fx(p,"np_alcance.textContent.includes('Norte')"),true);assert.equal(await fx(p,"np_diario.value"),'315.04');
   await fx(p,"np_diario.value=500;np_jornada.value=6;NominaParams._save()");await fu(p,"!np_overlay.classList.contains('open') && NominaParams.get('n1').salarioDiarioDefault===500");
   assert.deepEqual(await fx(p,"load().map(s=>EtaaxCore.sueldoDiarioEfectivo(s,NominaParams.get('n1',s.sucursalId)))"),[400,500,450,450]);
   await fx(p,"openModal('col1')");await fu(p,"modalStaff.classList.contains('open')");assert.equal(await fx(p,"fSueldoDiario.value"),'400');
   await fx(p,"fSucursal.value='norte';fSucursal.dispatchEvent(new Event('change'))");assert.equal(await fx(p,"fSueldoDiario.value"),'500');await fx(p,"closeModal();localStorage.setItem('etaax_sucursal_activa','suc_principal')");
  });
  await check('Segundo editor actualiza título y conserva importe · '+width,async()=>{
   await fx(p,"new Promise((ok,fail)=>{const s=document.createElement('script');s.src='/staff-modal.js';s.onload=ok;s.onerror=fail;document.body.appendChild(s)})");
   await fx(p,"StaffModal.open({negId:'n1',staffId:'col1',skipGate:true})");await fu(p,"document.querySelector('#sm_overlay')?.classList.contains('open')");
   assert.equal(await fx(p,"sm_multaRetardo.value"),'25');await fx(p,"sm_nombre.value='Ana editada';sm_nombre.dispatchEvent(new Event('input'));sm_multaRetardo.value=30");
   assert.equal(await fx(p,"sm_title.textContent.includes('Ana editada')"),true);await fx(p,"StaffModal._save()");await fu(p,"!sm_overlay.classList.contains('open')");
   assert.equal(await fx(p,"JSON.parse(localStorage.getItem('etaax_n1_staff')).find(s=>s.id==='col1').multaRetardo"),30);
  });
  await check('Encabezado opaco permanece fijo al desplazar catálogo · '+width,async()=>{
   await fx(p,"window.__staffPrev=load();localStorage.setItem('etaax_n1_staff',JSON.stringify(__staffPrev.concat(Array.from({length:30},(_,i)=>({id:'scroll'+i,nombre:'Colaborador '+i,puesto:'Mesero',sucursalId:'suc_principal',estado:'Activo'})))));renderAll();window.scrollTo(0,600)");await pause(150);
   const a=await fx(p,"(()=>{const h=document.querySelector('#mainContent>.header');return {top:h.getBoundingClientRect().top,bg:getComputedStyle(h).backgroundColor,pos:getComputedStyle(h).position,scroll:scrollY}})()");
   assert.ok(a.scroll>100,JSON.stringify(a));assert.equal(a.pos,'sticky');assert.ok(Math.abs(a.top)<1,JSON.stringify(a));assert.ok(!['transparent','rgba(0, 0, 0, 0)'].includes(a.bg),JSON.stringify(a));await shot(p,'header-scroll-'+width);
   await fx(p,"window.scrollTo(0,0);localStorage.setItem('etaax_n1_staff',JSON.stringify(__staffPrev));renderAll()");
  });
  await check('Carga inicial mantiene diseño aunque se retrasen decoradores · '+width,async()=>{
   slowUI=true;await evalPage(p.sid,"tmFrame.src=_tmURL('staff')");
   await fu(p,"location.pathname==='/administrativo/staff' && document.body?.classList.contains('etx-staff-page') && document.querySelector('.brand-title')");
   assert.equal(await fx(p,"getComputedStyle(document.querySelector('.brand-title')).fontFamily.includes('DM Sans')"),true);
   const end=Date.now()+4000;while(!heldScripts.length && Date.now()<end)await pause(20);assert.ok(heldScripts.length>0);slowUI=false;heldScripts.splice(0).forEach(fn=>fn());
   await fu(p,"document.readyState==='complete' && document.querySelector('#btnBajas .s-ui-icon')");
  });
  await evalPage(p.sid,"cerrarTool()");await go(p,"location.href='/administrativo/horarios'","document.readyState==='complete' && typeof marcarRetardo==='function' && document.body.classList.contains('etx-op-page')");
  await check('Marcar retardos muestra cantidad e importe estimado en Horarios · '+width,async()=>{
   await evalPage(p.sid,"window.__col=JSON.parse(localStorage.getItem('etaax_n1_staff')).find(s=>s.id==='col1');window.__wk=EtaaxCore.getWeekStr(new Date('2026-10-12T12:00:00'));window.__turnos={col1:{d0:{in:'09:00',out:'17:00',asis:'si'},d1:{in:'09:00',out:'17:00',asis:'si'},d2:{desc:true}}};window.__rec={id:'hor_suc_principal_'+__wk,sucursalId:'suc_principal',semana:__wk,turnos:__turnos};window.curRecord=()=>__rec;window.persist=r=>{localStorage.setItem('etaax_n1_horarios',JSON.stringify({[r.id]:r}));sessionStorage.setItem('__fixture_horarios',JSON.stringify([r]));};window.render=()=>{};marcarRetardo('col1',0);marcarRetardo('col1',1)");
   assert.equal(await evalPage(p.sid,"_retardosSemana('col1')"),2);assert.ok(await evalPage(p.sid,"_descuentoRetardosSemana(__col).includes('60.00')"));
  });
  await go(p,"location.href='/administrativo/diario'","document.readyState==='complete' && typeof abrirPagoNomina==='function'");
  await check('Pago precarga retardos, permite editar y registra neto con desglose · '+width,async()=>{
   await evalPage(p.sid,"_cacheStaff=JSON.parse(localStorage.getItem('etaax_n1_staff'));abrirPagoNomina('col1');pnTipo.value='personalizado';pnDesde.value='2026-10-12';pnHasta.value='2026-10-18';_pnRangoChange()");
   await until(p.sid,"document.querySelector('#modalPagoNom .n-title-copy')");assert.deepEqual(await evalPage(p.sid,"[pnRetardos.value,pnMultaRetardo.value,Number(pnTotal.value),_pagoNomConceptos.filter(c=>c._retardos).length]"),['2','30',1140,1]);
   await evalPage(p.sid,"pnRetardos.value=3;pnMultaRetardo.value=12.35;pnMultaRetardo.dispatchEvent(new Event('input'));_pnReponerBonos();_pnCalc();pnMultaRetardo.scrollIntoView({block:'center'})");
   assert.equal(await evalPage(p.sid,"Number(pnTotal.value)"),1162.95);assert.equal(await evalPage(p.sid,"_reciboNominaDatos().totalDed"),37.05);await shot(p,'nomina-retardos-'+width);
   await evalPage(p.sid,"_confirmarPagoNom()");await until(p.sid,"modalGasto.classList.contains('open')");assert.equal(await evalPage(p.sid,"Number(gMonto.value)"),1162.95);assert.equal(await evalPage(p.sid,"gNotas.value.includes('3 retardos')"),true);
   await evalPage(p.sid,"gCerrarModal();abrirPagoNomina('col1');pnTipo.value='personalizado';pnDesde.value='2026-10-12';pnHasta.value='2026-10-18';_pnRangoChange();pnMultaRetardo.value=0;_pnActualizarRetardos()");assert.equal(await evalPage(p.sid,"_pagoNomConceptos.some(c=>c._retardos)"),false);
  });
  assert.deepEqual(await evalPage(p.sid,'__errors'),[]);
  await check('Cancelar permisos embebidos sin contenedor conserva URL y contexto · '+width,async()=>{
   await go(p,"location.href='/administrativo/permisos?embed=1&neg=n1&suc=norte'","document.readyState==='complete' && typeof _volverCatalogoPermisos==='function' && document.getElementById('modalAdminGuard')");
   await evalPage(p.sid,"_cerrarAdminGuard()");await until(p.sid,"location.pathname==='/administrativo/staff.html' && document.readyState==='complete' && document.body.classList.contains('etx-staff-page')");
   assert.equal(await evalPage(p.sid,"new URLSearchParams(location.search).get('embed')"),'1');assert.equal(await evalPage(p.sid,"new URLSearchParams(location.search).get('suc')"),'norte');
  });assert.ok(await evalPage(p.sid,'document.documentElement.scrollWidth<=innerWidth+1'));await close(p);
 }
 const smoke=await page(base,'/hub.html','owner',1440,true);await send('Network.setExtraHTTPHeaders',{headers:{}},smoke.sid);
 for(const [route,cls] of [['/recetas/insumos','etx-modulos-ui'],['/recetas/index','etx-recetas-page'],['/administrativo/checklists','etx-op-page'],['/administrativo/organigrama','etx-op-page'],['/administrativo/perfiles-puesto','etx-op-page'],['/administrativo/evaluaciones','etx-op-page']]){
  await check('Navegar a '+route+' activa el diseño y carga sin errores de sintaxis',async()=>{
   await go(smoke,'location.href='+JSON.stringify(route),"document.readyState==='complete' && document.body.classList.contains('"+cls+"')");
   assert.deepEqual(await evalPage(smoke.sid,"__errors.filter(e=>/SyntaxError|Invalid or unexpected token/.test(e))"),[]);
   assert.equal(await evalPage(smoke.sid,"document.body.classList.contains('etx-modulos-ui')"),true);
  });
 }
 await close(smoke);
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
        else if(slowUI && /\/(staff-ui|staff-operativo-ui|etaax-modulos-ui)\.js$/.test(name)){heldScripts.push(()=>res.end(fs.readFileSync(filename)));}
        else res.end(fs.readFileSync(filename));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+server.address().port;
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'etaax-staff-chrome-'));
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
    console.log('STAFF SEIS: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
