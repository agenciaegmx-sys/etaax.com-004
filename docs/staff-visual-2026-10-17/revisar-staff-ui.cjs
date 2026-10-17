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
            order() { return q; }, limit() { return q; }, neq() { return q; }, or() { return q; }, delete() { q.deleting=true; return q; }, not() { return q; }, in() { return q; },
            maybeSingle() { q.single = true; return q; }, update(value) { q.value = value; return q; },
            upsert(value) { q.value = value; return q; }, insert(value) { q.value = value; return q; },
            then(resolve, reject) {
                window.__calls.push({ type: 'table', table, filters: { ...filters }, value: q.value });
                let data = null, error = null;
                if (q.value) {
                    data = q.value;
                    if(table==='staff') {
                        const registros=Array.isArray(q.value)?q.value:[q.value];
                        sessionStorage.setItem('__fixture_staff',JSON.stringify(registros.map(r=>r.datos)));
                    }
                }
                else if(table==='staff') data=q.deleting?[]:JSON.parse(sessionStorage.getItem('__fixture_staff')||'[]').map(datos=>({datos}));
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
 const dir=path.join(os.tmpdir(),'etaax-staff-ui');fs.mkdirSync(dir,{recursive:true});
 const empleados=[
  {id:'col1',nombre:'Ana González',puesto:'Gerente',rol:'gerente',usuario:'ana.staff',passwordHash:'hash-que-se-conserva',nipHash:'nip-que-se-conserva',estado:'Activo',sucursalId:'suc_principal',esquemaSueldo:'diario',sueldoDiario:315.04,categoriaNomina:'operativa',periodicidad:'semanal',diaPago:'viernes',formaPagoNomina:'Efectivo',fechaIngreso:'2024-06-11',correo:'ana@fixture.invalid',celular:'5512345678',bonos:[{concepto:'Puntualidad',monto:200,periodicidad:'mensual'}],documentos:[{nombre:'Contrato de prueba.txt',tipo:'text/plain',data:'data:text/plain;base64,UHJ1ZWJh'}],notas:'Conservar notas <sin HTML>.'},
  {id:'col2',nombre:'José de prueba',puesto:'Barman',rol:'barman',estado:'Activo',sucursalId:'suc_principal',esquemaSueldo:'diario',sueldoDiario:315.04,categoriaNomina:'operativa',periodicidad:'semanal'},
  {id:'col3',nombre:'Persona de Norte',puesto:'Cocinero',rol:'cocinero',estado:'Activo',sucursalId:'norte'},
  {id:'col4',nombre:'Colaborador archivado',puesto:'Mesero',rol:'mesero',estado:'Baja definitiva',sucursalId:'suc_principal',fechaBaja:'2026-10-01',fechaIngreso:'2024-01-10'}
 ];
 async function auth(p) {
  await until(p.sid,"document.getElementById('modalAdminGuard') && getComputedStyle(modalAdminGuard).display!=='none'");
  await evalPage(p.sid,"adminGuardInput.value='Current123';adminGuardBtn.click()");
  await until(p.sid,"getComputedStyle(modalAdminGuard).display==='none'");
  await pause(80);await evalPage(p.sid,"document.querySelector('.a-authorized .etaax-ui-btn')?.click()");
 }
 async function shot(p,name) {await pause(160);const s=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(dir+'/'+name+'.png',Buffer.from(s.data,'base64'));}
 async function bounded(p, selector) {
  assert.ok(await evalPage(p.sid,"document.documentElement.scrollWidth<=innerWidth+1"),'sin desborde exterior: '+selector);
  const bad=await evalPage(p.sid,`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(x=>x.getClientRects().length).filter(x=>{const r=x.getBoundingClientRect();return r.width>innerWidth||r.right>innerWidth+1||r.left< -1}).map(x=>({id:x.id,cls:x.className,w:x.getBoundingClientRect().width,right:x.getBoundingClientRect().right}))`);
  assert.deepEqual(bad,[], 'controles dentro de pantalla');
 }
 for(const width of (process.env.STAFF_IFRAME_ONLY ? [] : [1440,768,390,320])) {
  const p=await page(base,'/hub.html','owner',width,true);
  await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
  await evalPage(p.sid,`localStorage.setItem('etaax_n1_staff',${JSON.stringify(JSON.stringify(empleados))});sessionStorage.setItem('__fixture_staff',${JSON.stringify(JSON.stringify(empleados))});localStorage.setItem('etaax_n1_nomina_params',JSON.stringify({primaVacacionalPct:25,jornadaHoras:8,salarioDiarioDefault:315.04}));`);
  await go(p,'location.href='+JSON.stringify(base+'/administrativo/staff.html'),"document.getElementById('modalAdminGuard') && typeof renderAll==='function'");
  await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click();document.fonts.ready");
  assert.equal(await evalPage(p.sid,"document.querySelectorAll('#staffTbody tr').length"),0);
  await evalPage(p.sid,"adminGuardInput.value='incorrecta';adminGuardBtn.click()");
  await until(p.sid,"adminGuardError.textContent.length>0");
  assert.equal(await evalPage(p.sid,"_bloqueado"),true);
  await shot(p,'autorizacion-'+width);await auth(p);
  await until(p.sid,"!_bloqueado && document.querySelectorAll('#staffTbody tr').length===2 && document.querySelector('#btnAgregarColaborador .s-ui-icon')");
  assert.equal(await evalPage(p.sid,"staffTbody.textContent.includes('Persona de Norte')"),false);
  await shot(p,'catalogo-'+width);await bounded(p,'.controls-bar button,.filtros-bar input,.filtros-bar select');
  await evalPage(p.sid,"searchInput.value='José';searchInput.dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await evalPage(p.sid,"document.querySelectorAll('#staffTbody tr').length"),1);
  await evalPage(p.sid,"searchInput.value='';renderAll();document.querySelector('#staffTbody tr [title=Opciones]').click()");
  await until(p.sid,"document.querySelector('.st-menu .s-ui-icon')");await shot(p,'acciones-'+width);
  await evalPage(p.sid,"document.querySelector('.st-menu [onclick*=verExpediente]').click()");
  await until(p.sid,"document.querySelector('.s-exp-card')");
  assert.ok(await evalPage(p.sid,"expNomina.textContent.includes('••••••')"));
  assert.equal(await evalPage(p.sid,"expNomina.textContent.includes('$315.04')"),false);
  await shot(p,'expediente-'+width);await bounded(p,'.s-exp-section,.s-exp-header button');
  await evalPage(p.sid,"expBtnVer.click()");await auth(p);
  assert.ok(await evalPage(p.sid,"expNomina.textContent.includes('$315.04')"));
  await evalPage(p.sid,"document.querySelector('#expOverlay [onclick^=verDoc]').click()");
  await until(p.sid,"document.getElementById('docVisor')");await shot(p,'documento-'+width);
  await evalPage(p.sid,"cerrarDoc();document.querySelector('#expOverlay [onclick^=\"_expCerrar();openModal\"]').click()");
  await until(p.sid,"modalStaff.classList.contains('open') && document.querySelector('#modalTitle .s-title-copy')");
  assert.deepEqual(await evalPage(p.sid,"[fUsuario.readOnly,fPwd.readOnly,fSueldoDiario.readOnly,fRol.value,fNip.maxLength]"),[true,true,true,'gerente',5]);
  await shot(p,'editor-personales-'+width);await bounded(p,'#modalStaff input:not([type=hidden]),#modalStaff select,#modalStaff textarea,#modalStaff .modal-footer button');
  await evalPage(p.sid,"fSueldoDiario.scrollIntoView({block:'center'})");await shot(p,'editor-nomina-'+width);
  assert.equal(await evalPage(p.sid,"document.querySelector('#modalStaff [onclick=\"saveStaff()\"]').getBoundingClientRect().bottom<=innerHeight"),true);
  await evalPage(p.sid,"btnModSueldoDiario.click()");await auth(p);
  assert.equal(await evalPage(p.sid,"fSueldoDiario.readOnly"),false);
  await evalPage(p.sid,"fSueldoDiario.value=330;fSueldoDiario.dispatchEvent(new Event('input',{bubbles:true}));fNotas.value='Notas editadas <literal>';document.querySelector('#modalStaff [onclick=\"saveStaff()\"]').click()");
  await until(p.sid,"!modalStaff.classList.contains('open')");
  const saved=await evalPage(p.sid,"load().find(x=>x.id==='col1')");
  assert.equal(saved.sueldoDiario,330);assert.equal(saved.passwordHash,'hash-que-se-conserva');assert.equal(saved.nipHash,'nip-que-se-conserva');assert.equal(saved.sucursalId,'suc_principal');assert.equal(saved.notas,'Notas editadas <literal>');
  assert.equal(await evalPage(p.sid,"load().filter(x=>x.id==='col1').length"),1);
  await evalPage(p.sid,"btnAgregarColaborador.click()");
  await until(p.sid,"document.querySelector('#modalStaff .etx-min-btn .s-ui-icon')");
  await evalPage(p.sid,"document.querySelector('#modalStaff .etx-min-btn').click();document.querySelector('#etx-dock .etx-chip').click()");
  assert.notEqual(await evalPage(p.sid,"getComputedStyle(modalStaff).display"),'none');
  assert.deepEqual(await evalPage(p.sid,"[fSueldoDiario.value,fUsuario.readOnly,fPwd.readOnly]"),['315.04',false,false]);
  await evalPage(p.sid,"fRol.value='barman';fRol.dispatchEvent(new Event('change',{bubbles:true}))");
  assert.notEqual(await evalPage(p.sid,"getComputedStyle(accesoNip).display"),'none');
  await evalPage(p.sid,"fSinCosto.checked=true;fSinCosto.dispatchEvent(new Event('change',{bubbles:true}));closeModal();btnBajas.click()");
  await until(p.sid,"document.querySelector('.s-baja-row')");await shot(p,'bajas-'+width);
  await evalPage(p.sid,"document.querySelector('#bajasList [onclick^=reactivarStaff]').click()");
  await until(p.sid,"load().find(x=>x.id==='col4').estado==='Activo' && staffTbody.textContent.includes('Colaborador archivado')");
  await evalPage(p.sid,"cerrarBajas();EtaaxTheme.set('light')");await shot(p,'catalogo-claro-'+width);
  await evalPage(p.sid,"btnSalarioMinimo.click()");await auth(p);
  await until(p.sid,"document.getElementById('np_overlay')?.classList.contains('open')");await shot(p,'parametros-'+width);
  assert.deepEqual(await evalPage(p.sid,"[np_prima.value,np_jornada.value,np_diario.value]"),['25','8','315.04']);
  await evalPage(p.sid,"np_diario.value=320;document.querySelector('#np_overlay .np-btn-primary').click()");
  await until(p.sid,"!np_overlay.classList.contains('open')");
  assert.equal(await evalPage(p.sid,"NominaParams.get('n1').salarioDiarioDefault"),320);
  await evalPage(p.sid,"localStorage.setItem('etaax_n1_sucursales',JSON.stringify([{id:'suc_principal',nombre:'Centro',activa:true},{id:'norte',nombre:'Norte',activa:true}]))");
  await evalPage(p.sid,"EtaaxTheme.set('dark')");
  await go(p,"btnRolesPermisos.click()","document.getElementById('rolModal') && document.getElementById('modalAdminGuard')");
  assert.ok(await evalPage(p.sid,"!!document.getElementById('permLockOverlay')"));
  await auth(p);await until(p.sid,"!document.getElementById('permLockOverlay') && document.querySelector('.mod-icon .s-ui-icon')");
  await evalPage(p.sid,"selectRol('gerente')");await shot(p,'roles-'+width);await bounded(p,'.roles-tabs button,.save-bar button,.mod-card');
  assert.ok(await evalPage(p.sid,"Array.from(permisosGrid.querySelectorAll('input')).every(x=>x.disabled)"));
  await evalPage(p.sid,"document.querySelector('[onclick=\"editarRol()\"]').click()");
  assert.equal(await evalPage(p.sid,"tog_insumos.disabled"),false);
  const original=await evalPage(p.sid,"!!getRolPermisos('gerente').insumos");
  await evalPage(p.sid,"tog_insumos.click()");
  assert.equal(await evalPage(p.sid,"!!getRolPermisos('gerente').insumos"),original,'el borrador no publica antes de guardar');
  await evalPage(p.sid,"document.querySelector('[onclick=\"guardarPermisos()\"]').click()");await until(p.sid,"!_editando");
  assert.equal(await evalPage(p.sid,"!!getRolPermisos('gerente').insumos"),!original);
  await evalPage(p.sid,"renderSucBar();selectSuc('norte');editarRol();tog_insumos.click();document.querySelector('[onclick=\"guardarPermisos()\"]').click()");
  await until(p.sid,"!_editando");
  assert.equal(await evalPage(p.sid,"!!getRolPermisos('gerente').insumos"),original);
  await shot(p,'permisos-sucursal-'+width);
  await evalPage(p.sid,"selectSuc('suc_principal')");
  assert.equal(await evalPage(p.sid,"!!getRolPermisos('gerente').insumos"),!original);
  await evalPage(p.sid,"selectSuc('');selectRol('admin')");
  assert.ok(await evalPage(p.sid,"Array.from(permisosGrid.querySelectorAll('input')).every(x=>x.disabled)"));
  assert.equal(await evalPage(p.sid,"getComputedStyle(accsLectura).display"),'none');
  await evalPage(p.sid,"document.querySelector('[onclick=\"nuevoRol()\"]').click()");
  await until(p.sid,"document.querySelectorAll('.rm-emo .s-ui-icon').length===16");
  await evalPage(p.sid,"rmNombre.value='Recepción especial';rmNombre.dispatchEvent(new Event('input',{bubbles:true}));Array.from(document.querySelectorAll('.rm-emo')).find(x=>x.getAttribute('onclick').includes('💁')).click()");
  await shot(p,'editor-rol-'+width);await bounded(p,'.rm-card,.rm-emo,.rm-in,.rm-sel,.rm-ft button');
  assert.equal(await evalPage(p.sid,"_rmIcono"),'💁');
  await evalPage(p.sid,"rmOk.click()");await until(p.sid,"!rolModal.classList.contains('on')");
  assert.equal(await evalPage(p.sid,"_rolDe(_rolActivo).icon"),'💁');
  const rolekey=await evalPage(p.sid,'_rolActivo');
  await evalPage(p.sid,"renombrarRol();rmNombre.value='Recepción <literal>';rmOk.click()");
  assert.equal(await evalPage(p.sid,'_rolActivo'),rolekey);assert.equal(await evalPage(p.sid,'_rolDe(_rolActivo).label'),'Recepción <literal>');
  await evalPage(p.sid,"EtaaxTheme.set('light')");await shot(p,'roles-claro-'+width);
  assert.deepEqual(await evalPage(p.sid,'__errors'),[]);results.push(width);console.log('PASA '+width+'px: candado, filtros, expediente, nómina oculta, visor, editor, credenciales, guardar sin duplicar, alta, bajas, parámetros, permisos, rol e icono original.');await close(p);
 }
 for(const frameWidth of [1280,768,390,320]) {
 const p=await page(base,'/hub.html','owner',frameWidth,true);await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
 await evalPage(p.sid,`localStorage.setItem('etaax_n1_staff',${JSON.stringify(JSON.stringify(empleados))});sessionStorage.setItem('__fixture_staff',${JSON.stringify(JSON.stringify(empleados))});sessionStorage.setItem('etaax_staff_gracia',String(Date.now()+300000));`);
 await go(p,'location.href='+JSON.stringify(base+'/administrativo/staff-hub.html'),"typeof abrirTool==='function'");
 await evalPage(p.sid,"document.getElementById('etaaxNovOk')?.click();abrirTool('staff.html','Catálogo de Staff','👥')");
 await until(p.sid,"document.querySelector('#toolModal.s-staff-tool') && tmFrame.contentWindow.document.querySelector('#btnRolesPermisos .s-ui-icon')");
 await until(p.sid,"tmFrame.contentWindow.document.querySelectorAll('#staffTbody tr').length===2");
 assert.ok(await evalPage(p.sid,"tmFrame.contentWindow.document.documentElement.scrollWidth<=tmFrame.contentWindow.innerWidth+1"),'sin desborde exterior dentro del iframe');
 assert.equal(await evalPage(p.sid,"getComputedStyle(tmBack).display"),'none');assert.notEqual(await evalPage(p.sid,"getComputedStyle(tmClose).display"),'none');await shot(p,'flotante-catalogo-'+frameWidth);
 await evalPage(p.sid,"tmFrame.contentWindow.document.getElementById('btnRolesPermisos').click()");
 await until(p.sid,"tmFrame.contentWindow.document.getElementById('rolModal') && tmFrame.contentWindow.document.getElementById('modalAdminGuard')");
 await until(p.sid,"getComputedStyle(tmClose).display==='none' && getComputedStyle(tmBack).display!=='none'");
 await evalPage(p.sid,"var w=tmFrame.contentWindow;w.document.getElementById('adminGuardInput').value='Current123';w.document.getElementById('adminGuardBtn').click()");
 await until(p.sid,"!tmFrame.contentWindow.document.getElementById('permLockOverlay')");
 await until(p.sid,"tmFrame.contentWindow.document.querySelector('.a-authorized .etaax-ui-btn')");await evalPage(p.sid,"tmFrame.contentWindow.document.querySelector('.a-authorized .etaax-ui-btn').click()");await shot(p,'flotante-permisos-'+frameWidth);
 assert.equal(await evalPage(p.sid,"tmIcon.querySelector('.s-ui-icon').dataset.icono"),'roles');
 assert.ok(await evalPage(p.sid,"tmFrame.contentWindow.document.documentElement.scrollWidth<=tmFrame.contentWindow.innerWidth+1"),'permisos dentro del iframe');
 await evalPage(p.sid,"tmBack.click()");
 await until(p.sid,"tmFrame.contentWindow.document.getElementById('staffTable') && !tmFrame.contentWindow._bloqueado");
 assert.equal(await evalPage(p.sid,"getComputedStyle(tmBack).display"),'none');
 await evalPage(p.sid,"tmFrame.contentWindow.openModal('col1')");
 await until(p.sid,"tmFrame.contentWindow.document.getElementById('modalStaff').classList.contains('open')");
 await shot(p,'flotante-editor-'+frameWidth);
 assert.ok(await evalPage(p.sid,"(()=>{var w=tmFrame.contentWindow,b=w.document.querySelector('#modalStaff [onclick=\"saveStaff()\"]').getBoundingClientRect();return b.right<=w.innerWidth && b.bottom<=w.innerHeight})()"));
 await evalPage(p.sid,"tmFrame.contentWindow.closeModal();tmClose.click()");assert.equal(await evalPage(p.sid,"toolModal.classList.contains('on')"),false);assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_staff_gracia')"),null);
 await close(p);results.push('iframe-'+frameWidth);console.log('PASA iframe '+frameWidth+'px: catálogo → permisos → volver → editor → cerrar, sin desbordes y con contraseña rearmada.');
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
    console.log('STAFF: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
