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
let server, chrome, socket, next = 0;
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
    while (Date.now() < end) { if (await evalPage(sid, expression)) return; await pause(30); }
    throw new Error('No se cumplió: ' + expression);
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
async function page(base, route, mode = 'owner', width = 1440) {
    const { targetId } = await send('Target.createTarget', { url:'about:blank' });
    const { sessionId:sid } = await send('Target.attachToTarget', { targetId, flatten:true });
    await send('Page.enable', {}, sid);
    await send('Fetch.enable', {patterns:[{urlPattern:'*'}]}, sid);
    await send('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:width<720}, sid);
    const init = `window.__case=${JSON.stringify(mode)};window.__errors=[];window.addEventListener('error',e=>{if(e.message)window.__errors.push(e.message)});
        localStorage.clear();sessionStorage.clear();localStorage.setItem('etaax_negocio_activo','n1');localStorage.setItem('etaax_sucursal_activa','matriz');
        localStorage.setItem('etaax_ctx',JSON.stringify({ctxType:${JSON.stringify(mode === 'staff' ? 'staff' : 'owner')},userName:'Ana González',negId:'n1',negNombre:'Café de prueba'}));
        localStorage.setItem('etaax_qses',JSON.stringify({usuarioId:'u1',nombre:'Ana González',email:'ana@fixture.invalid',plan:'pyme',ts:Date.now()}));
        localStorage.setItem('etaax_negocios',JSON.stringify([{id:'n1',usuarioId:'u1',nombre:'Café de prueba',tipo:'cafe',organizacion:'corporativo',color:'#3dbe7a'}]));
        localStorage.setItem('etaax_n1_sucursales',JSON.stringify([{id:'matriz',nombre:'Centro',activa:true,fechaCreado:'2026-08-07'}]));
        ${mode === 'staff' ? "sessionStorage.setItem('etaax_sesion_hub',JSON.stringify({type:'staff',nombre:'José de prueba',staffId:'col1',negocioId:'n1',rol:'mesero',expira:Date.now()+3600000}));" : ''}
        ${mode === 'failure' ? 'window.__fail=true;' : ''}`;
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
    let p = await page(base,'/mi-cuenta.html?volver=%2Ffinanciero%2Fventas.html','owner');
    await check('Cuenta: perfil real, regreso al módulo y espacio del header',async()=>{
        await layout(p);assert.equal(await evalPage(p.sid,"document.getElementById('cuentaVolver').getAttribute('href')"),'/financiero/ventas.html');
        assert.equal(await evalPage(p.sid,"document.getElementById('cuentaEmail').value"),'ana@fixture.invalid');
        const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(os.tmpdir(),'etaax-mi-cuenta-pc.png'),Buffer.from(shot.data,'base64'));
    });
    await check('Un envío cambia el nombre una sola vez y actualiza la sesión',async()=>{
        await evalPage(p.sid,"document.getElementById('cuentaNombre').value='Ana nueva';document.getElementById('cuentaNombreForm').requestSubmit();document.getElementById('cuentaNombreForm').requestSubmit();");
        await until(p.sid,"document.getElementById('cuentaNombreMsg').textContent.includes('actualizado')");
        assert.equal(await evalPage(p.sid,"__calls.filter(x=>x.type==='updateUser').length"),1);
        assert.equal(await evalPage(p.sid,"JSON.parse(localStorage.getItem('etaax_qses')).nombre"),'Ana nueva');
        assert.equal(await evalPage(p.sid,"__calls.filter(x=>x.table==='usuarios'&&x.value).every(x=>x.filters.id==='u1')"),true);
    });
    await check('Tema claro y del dispositivo se sincronizan con el header',async()=>{
        await evalPage(p.sid,"const t=document.getElementById('cuentaTema');t.value='light';t.dispatchEvent(new Event('change'))");
        assert.equal(await evalPage(p.sid,"document.documentElement.getAttribute('data-theme')"),'light');
        assert.ok(await evalPage(p.sid,"document.querySelector('.etx-hd-marca img').src.includes('claro')"));
        await evalPage(p.sid,"document.getElementById('cuentaTema').value='auto';document.getElementById('cuentaTema').dispatchEvent(new Event('change'))");
        assert.equal(await evalPage(p.sid,"EtaaxTheme.elegido()"),'auto');
    });
    await check('Contraseña incorrecta impide la actualización; la correcta limpia el formulario',async()=>{
        await evalPage(p.sid,"document.getElementById('cuentaPassActual').value='wrong';document.getElementById('cuentaPassNueva').value='New123456';document.getElementById('cuentaPassConfirmar').value='New123456';document.getElementById('cuentaPasswordForm').requestSubmit()");
        await until(p.sid,"document.getElementById('cuentaPassMsg').classList.contains('error')");
        assert.equal(await evalPage(p.sid,"__calls.filter(x=>x.type==='updateUser'&&x.value.password).length"),0);
        await evalPage(p.sid,"document.getElementById('cuentaPassActual').value='Current123';document.getElementById('cuentaPasswordForm').requestSubmit()");
        await until(p.sid,"document.getElementById('cuentaPassMsg').classList.contains('exito')");
        assert.equal(await evalPage(p.sid,"__calls.filter(x=>x.type==='updateUser'&&x.value.password).length"),1);
        assert.equal(await evalPage(p.sid,"document.getElementById('cuentaPassNueva').value"),'');
    });
    await check('Menú con teclado y enlaces a las dos vistas',async()=>{
        await evalPage(p.sid,"document.getElementById('etxHdCuenta').click()");
        assert.equal(await evalPage(p.sid,"document.getElementById('etxHdCuenta').getAttribute('aria-expanded')"),'true');
        assert.ok(await evalPage(p.sid,"document.getElementById('etxHdPlanOp').getAttribute('href').startsWith('/plan-facturacion.html')"));
        await evalPage(p.sid,"document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
        assert.equal(await evalPage(p.sid,"document.getElementById('etxHdMenu').classList.contains('abierto')"),false);
    });
    assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    p = await page(base,'/mi-cuenta.html','email-confirm');
    await check('Correo pendiente de confirmación conserva el correo actual',async()=>{
        await evalPage(p.sid,"document.getElementById('cuentaEmailNuevo').value='nueva@fixture.invalid';document.getElementById('cuentaEmailPass').value='Current123';document.getElementById('cuentaEmailForm').requestSubmit()");
        await until(p.sid,"document.getElementById('cuentaEmailMsg').classList.contains('exito')");
        assert.equal(await evalPage(p.sid,"document.getElementById('cuentaEmail').value"),'ana@fixture.invalid');
        assert.equal(await evalPage(p.sid,"document.getElementById('cuentaEmailPass').value"),'');
    });await close(p);
    p=await page(base,'/mi-cuenta.html','staff',390);
    await check('Colaborador: sin credenciales compartidas ni formularios del titular, en móvil',async()=>{
        await layout(p);assert.equal(await evalPage(p.sid,"!!document.getElementById('cuentaPasswordForm')"),false);
        assert.equal(await evalPage(p.sid,"document.body.textContent.includes('compartida@fixture.invalid')"),false);
        await evalPage(p.sid,"document.getElementById('etxHdCuenta').click()");
        assert.ok(await evalPage(p.sid,"document.querySelector('.etx-hd-menu-cab .etx-hd-quien').getBoundingClientRect().height>0"));
    });await close(p);
    p=await page(base,'/mi-cuenta.html','staff-server');
    await check('La base reconoce al colaborador aunque el navegador diga titular',async()=>{
        assert.equal(await evalPage(p.sid,"JSON.parse(localStorage.getItem('etaax_ctx')).ctxType"),'owner');
        assert.equal(await evalPage(p.sid,"!!document.getElementById('cuentaPasswordForm')"),false);
        assert.equal(await evalPage(p.sid,"!!document.getElementById('cuentaEmailForm')"),false);
    });await close(p);
    p=await page(base,'/mi-cuenta.html?volver=https%3A%2F%2Fexample.com','xss');
    await check('Nombre escapado y regreso limitado al mismo sitio',async()=>{
        assert.equal(await evalPage(p.sid,'!!window.__xss'),false);
        assert.equal(await evalPage(p.sid,"document.querySelector('.cuenta-hero').querySelectorAll('img').length"),0);
        assert.equal(await evalPage(p.sid,"document.getElementById('cuentaVolver').getAttribute('href')"),'/hub.html');
    });await close(p);
    p=await page(base,'/plan-facturacion.html','owner');
    await check('Plan: suma la tabla compartida por sucursal, conserva contexto y ofrece facturación',async()=>{
        assert.equal(await evalPage(p.sid,"document.querySelector('.cuenta-precio').textContent.includes('3,498.00')"),true);
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('.cuenta-table tbody tr').length"),2);
        assert.equal(await evalPage(p.sid,"!!document.getElementById('planPagar')"),false);
        assert.ok(await evalPage(p.sid,"Array.from(document.querySelectorAll('a')).some(a=>a.href.startsWith('mailto:')&&a.textContent.includes('factura'))"));
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'matriz');
        const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(os.tmpdir(),'etaax-plan-pc.png'),Buffer.from(shot.data,'base64'));
    });assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    p=await page(base,'/plan-facturacion.html','stripe');
    await check('Una suscripción de tarjeta existente evita abrir otra aunque esté vencida',async()=>{
        assert.equal(await evalPage(p.sid,"!!document.getElementById('planPagar')"),false);
        assert.ok(await evalPage(p.sid,"document.getElementById('planContenido').textContent.includes('suscripción con tarjeta')"));
    });await close(p);
    p=await page(base,'/plan-facturacion.html','failure');
    await check('Fallo de carga del plan se informa y puede reintentarse',async()=>{
        assert.equal(await evalPage(p.sid,"!!document.getElementById('planReintentar')"),true);
        assert.equal(await evalPage(p.sid,"!!document.querySelector('.cuenta-precio')"),false);
        await evalPage(p.sid,"window.__fail=false;document.getElementById('planReintentar').click()");
        await until(p.sid,"!!document.querySelector('.cuenta-precio')");
    });await close(p);
    p=await page(base,'/plan-facturacion.html','race');
    await check('Respuesta vieja de un negocio no pisa el negocio elegido',async()=>{
        // Confirmar que la consulta está retenida antes de cambiar de negocio.
        assert.equal(await evalPage(p.sid,'__release.length'),2);
        await evalPage(p.sid,"document.getElementById('planNegocio').value='n2';document.getElementById('planNegocio').dispatchEvent(new Event('change'))");
        await until(p.sid,"!!document.querySelector('.cuenta-precio')");
        await evalPage(p.sid,'__release.forEach(fn=>fn())');await pause(50);
        assert.equal(await evalPage(p.sid,"document.querySelector('.cuenta-precio').textContent.includes('1,799.00')"),true);
        assert.equal(await evalPage(p.sid,"document.getElementById('planContenido').textContent.includes('Otra marca')"),true);
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_negocio_activo')"),'n1');
    });await close(p);
    p=await page(base,'/plan-facturacion.html','pending');
    await check('Checkout usa el negocio elegido y rechaza una URL insegura',async()=>{
        await evalPage(p.sid,"document.getElementById('planPagar').click();document.getElementById('planPagar').click()");
        await until(p.sid,"!!document.getElementById('planPagoMsg')");
        const calls=await evalPage(p.sid,"__calls.filter(x=>x.type==='invoke')");
        assert.equal(calls.length,1);assert.equal(calls[0].args.body.negocioId,'n1');
        assert.equal(await evalPage(p.sid,"document.getElementById('planPagar').disabled"),false);
    });await close(p);
    p=await page(base,'/plan-facturacion.html','staff',390);
    await check('Plan móvil del colaborador muestra estado sin habilitar cobros',async()=>{
        await layout(p);assert.equal(await evalPage(p.sid,"!!document.getElementById('planPagar')"),false);
        assert.equal(await evalPage(p.sid,"!!document.querySelector('.cuenta-precio')"),false);
        assert.ok(await evalPage(p.sid,"document.getElementById('planContenido').textContent.includes('Servicio activo')"));
    });await close(p);
    p=await page(base,'/mi-cuenta.html','anon');
    await check('Sin sesión no hay datos de cuenta ni acciones de acceso',async()=>{
        assert.equal(await evalPage(p.sid,"!!document.getElementById('cuentaPasswordForm')"),false);
        assert.equal(await evalPage(p.sid,"!!document.getElementById('etxHdCuentaOp')"),false);
    });await close(p);
    for(const route of ['/mi-cuenta.html','/plan-facturacion.html']){
        p=await page(base,route,'owner',320);
        await check('Titular: contenido y menú completos a 320px en '+route,async()=>{
            await layout(p);
            await evalPage(p.sid,"document.getElementById('etxHdCuenta').click()");
            assert.ok(await evalPage(p.sid,"document.getElementById('etxHdCuenta').getBoundingClientRect().right <= document.documentElement.clientWidth"));
            const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);
            fs.writeFileSync(path.join(os.tmpdir(),route.includes('plan-')?'etaax-plan-movil.png':'etaax-mi-cuenta-movil.png'),Buffer.from(shot.data,'base64'));
        });assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    }
    for(const width of [1440,390]){
        p=await page(base,'/hub.html','owner',width);
        await check('Hub: separación real entre header y subheader a '+width+'px',async()=>{await layout(p,width<720?18:24);});
        assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    }
    for(const width of [1440,320]){
        p=await page(base,'/hub.html?negocios=1','owner',width);
        await until(p.sid,"document.getElementById('viewNegocios').getClientRects().length && document.querySelectorAll('#listSucursales .suc-caja').length===2");
        await check('Hub: una identidad de negocio, plan y guía a '+width+'px',async()=>{
            await layout(p,width<720?18:24);
            assert.equal(await evalPage(p.sid,"document.querySelectorAll('#brandInfoBar').length"),1);
            assert.equal(await evalPage(p.sid,"document.querySelector('#brandInfoBar .neg-activo-nombre').textContent"),'Café de prueba');
            assert.equal(await evalPage(p.sid,"document.querySelector('#brandInfoBar .neg-activo-tipo').textContent"),'Corporativo · 2 sucursales');
            assert.equal(await evalPage(p.sid,"document.getElementById('negViewUserPlan').textContent"),'Pequeña Pyme');
            assert.equal(await evalPage(p.sid,"document.getElementById('brandInfoBar').textContent.includes('Sesión activa')"),false);
            assert.ok(await evalPage(p.sid,"document.getElementById('etxHdCuenta').textContent.includes('Ana')"));
            assert.ok(await evalPage(p.sid,"document.querySelector('.hub-guide').textContent.includes('Una operación conectada')"));
            assert.equal(await evalPage(p.sid,"document.querySelector('#brandInfoBar .aviso-priv-btn').getAttribute('href')"),'/aviso-privacidad.html');
            assert.equal(await evalPage(p.sid,"document.querySelector('#brandInfoBar .aviso-priv-btn').target"),'_blank');
            assert.equal(await evalPage(p.sid,"document.getElementById('hubConfigNeg').hasAttribute('onclick')"),false);
            const cols=await evalPage(p.sid,"getComputedStyle(document.querySelector('.hub-global-grid')).gridTemplateColumns.split(' ').length");
            assert.equal(cols,width<720?1:2);
            if(width<720) assert.ok(await evalPage(p.sid,"(()=>{const label=document.querySelector('#viewNegocios .suc-section-label').getBoundingClientRect();const sub=document.getElementById('sucPlanSub').getBoundingClientRect();return sub.top>=label.bottom})()"));
            await evalPage(p.sid,"Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))");
            const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);
            fs.writeFileSync(path.join(os.tmpdir(),width<720?'etaax-hub-movil.png':'etaax-hub-pc.png'),Buffer.from(shot.data,'base64'));
        });
        if(width===1440){
            await check('Configurar negocio conserva su destino; el subheader refresca el plan y el conteo',async()=>{
                await evalPage(p.sid,"document.getElementById('hubConfigNeg').click()");
                assert.equal(await evalPage(p.sid,"document.getElementById('modalAdminGuard').style.display"),'flex');
                assert.equal(await evalPage(p.sid,'_cfgNegId'),null);
                await evalPage(p.sid,"document.getElementById('adminGuardInput').value='Wrong123';_confirmarAdminGuard();");
                await until(p.sid,"document.getElementById('adminGuardError').textContent.includes('incorrecta')");
                assert.equal(await evalPage(p.sid,'_cfgNegId'),null);
                await evalPage(p.sid,"document.getElementById('adminGuardInput').value='Current123';_confirmarAdminGuard();");
                await until(p.sid,"document.getElementById('modalConfigNeg').style.display==='flex'");
                assert.equal(await evalPage(p.sid,"document.getElementById('cfgNegNombre').value"),'Café de prueba');
                assert.equal(await evalPage(p.sid,'_cfgNegId'),'n1');
                await evalPage(p.sid,"cerrarConfigNeg();_setSucursales('n1',Array.from({length:4},(_,i)=>({id:'s'+i,nombre:'S'+i,activa:true,fechaCreado:'2026-10-13'})));_renderSucursales(_misNegocios()[0]);");
                assert.equal(await evalPage(p.sid,"document.getElementById('negViewUserPlan').textContent"),'Gran Pyme');
                assert.equal(await evalPage(p.sid,"document.querySelector('#brandInfoBar .neg-activo-tipo').textContent"),'Corporativo · 4 sucursales');
                assert.equal(await evalPage(p.sid,"document.querySelectorAll('#listSucursales .suc-caja').length"),4);
            });
        }
        assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    }
    assert.equal(forbidden.length,0,'La página intentó salir del origen local: '+forbidden.join(', '));
}
(async()=>{
    server=http.createServer((req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name==='/__sdk-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end('('+sdkFixture.toString()+')()');return;}
        const filename=path.resolve(root,'.'+decodeURIComponent(name));
        if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||fs.statSync(filename).isDirectory()){res.writeHead(404);res.end();return;}
        const ext=path.extname(filename), mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
        res.setHeader('Content-Type',mime[ext]||'text/plain');
        if(ext==='.html'){
            let html=fs.readFileSync(filename,'utf8').replace(/<link[^>]*href="https:[^>]+>/g,'')
                .replace(/src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^\"]+"/g,'src="/__sdk-fixture.js"');
            res.end(html);
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
            if(url.startsWith(base+'/'))await send('Fetch.continueRequest',{requestId:m.params.requestId},m.sessionId);
            else{forbidden.push(url);await send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
        }
        else if(m.method==='Page.javascriptDialogOpening'){
            await send('Page.handleJavaScriptDialog',{accept:true},m.sessionId);
        }
    });
    await run(base);
    console.log('CUENTA Y HEADER: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
