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
const pending = new Map(), results = [], forbidden = [], closedSessions = new Set();
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
                if (window.__falloSuc && table === 'negocio_sucursales') error = { message:'Fallo controlado de sucursales' };
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
    const init = `window.__case=${JSON.stringify(mode)};window.__errors=[];window.addEventListener('error',e=>{if(e.message)window.__errors.push(e.message)});
        ${navigation ? "if(!sessionStorage.getItem('__etaax_fixture_seed')){" : ''}
        localStorage.clear();sessionStorage.clear();localStorage.setItem('etaax_negocio_activo','n1');localStorage.setItem('etaax_sucursal_activa','matriz');
        localStorage.setItem('etaax_ctx',JSON.stringify({ctxType:${JSON.stringify(mode === 'staff' ? 'staff' : 'owner')},userName:'Ana González',negId:'n1',negNombre:'Café de prueba'}));
        localStorage.setItem('etaax_qses',JSON.stringify({usuarioId:'u1',nombre:'Ana González',email:'ana@fixture.invalid',plan:'pyme',ts:Date.now()}));
        ${mode === 'anon' ? "localStorage.removeItem('etaax_qses');localStorage.removeItem('etaax_ctx');" : ''}
        localStorage.setItem('etaax_negocios',JSON.stringify([{id:'n1',usuarioId:'u1',nombre:'Café de prueba',tipo:'cafe',organizacion:'corporativo',color:'#3dbe7a'}]));
        localStorage.setItem('etaax_n1_sucursales',JSON.stringify([{id:'matriz',nombre:'Centro',activa:true,fechaCreado:'2026-08-07'}]));
        ${mode === 'staff' ? "sessionStorage.setItem('etaax_sesion_hub',JSON.stringify({type:'staff',nombre:'José de prueba',staffId:'col1',negocioId:'n1',rol:'mesero',expira:Date.now()+3600000}));" : ''}
        ${mode === 'failure' ? 'window.__fail=true;' : ''}
        ${navigation ? "sessionStorage.setItem('__etaax_fixture_seed','1');}window.__fixtureGeneration=Number(sessionStorage.getItem('__etaax_fixture_generation')||0)+1;sessionStorage.setItem('__etaax_fixture_generation',String(window.__fixtureGeneration));" : ''}`;
    await send('Page.addScriptToEvaluateOnNewDocument', {source:init}, sid);
    await send('Page.navigate', {url:base+route}, sid);
    await until(sid, mode === 'race' ? "document.getElementById('planNegocio') && window.__release && __release.length===2 && !!document.querySelector('.cuenta-loading')" : route.startsWith('/hub') ? (mode === 'anon' ? "document.getElementById('etaax-header') && document.getElementById('viewLogin').getClientRects().length" : "document.getElementById('etaax-header') && Array.from(document.querySelectorAll('.neg-activo-bar')).some(x=>x.getClientRects().length)") :
        route.startsWith('/recetas/index.html') ? "typeof verRecetas==='function' && document.readyState==='complete'" :
        "document.getElementById('cuentaContenido') && !document.querySelector('.cuenta-loading')");
    return {sid,targetId};
}
async function close(p) { closedSessions.add(p.sid);await send('Target.closeTarget',{targetId:p.targetId}); }
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
        p=await page(base,'/hub.html','anon',width,true);
        await check('Login: el isotipo central abre la landing con teclado a '+width+'px',async()=>{
            const enlace="document.querySelector('#etaax-header .etx-hd-centro a')";
            assert.equal(await evalPage(p.sid,enlace+".getAttribute('href')"),'/index.html');
            assert.equal(await evalPage(p.sid,enlace+".querySelector('img').getAttribute('src')"),'/marca/etaax-isotipo.svg');
            assert.ok(await evalPage(p.sid,enlace+".getAttribute('aria-label').includes('ETAAX')"));
            assert.equal(await evalPage(p.sid,enlace+'.textContent.trim()'),'');
            await until(p.sid,enlace+".querySelector('img').complete && "+enlace+".querySelector('img').naturalWidth>0");
            assert.ok(await evalPage(p.sid,"(()=>{const r="+enlace+".getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth})()"));
            await evalPage(p.sid,enlace+'.focus()');
            assert.equal(await evalPage(p.sid,'document.activeElement==='+enlace),true);
            const captura=await send('Page.captureScreenshot',{format:'png'},p.sid);
            fs.writeFileSync(path.join(os.tmpdir(),'etaax-login-isotipo-'+width+'.png'),Buffer.from(captura.data,'base64'));
            const generation=await evalPage(p.sid,'window.__fixtureGeneration');
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},p.sid);
            await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},p.sid);
            await until(p.sid,"window.__fixtureGeneration>"+generation+" && location.pathname==='/index.html'");
            assert.ok(await evalPage(p.sid,"document.title.includes('Plataforma operativa')"));
        });
        assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    }
    for(const width of [1440,390]){
        p=await page(base,'/hub.html','owner',width);
        await check('Hub: separación real entre header y subheader a '+width+'px',async()=>{
            await layout(p,width<720?18:24);
            assert.equal(await evalPage(p.sid,"document.querySelector('#etaax-header .etx-hd-centro a').getAttribute('href')"),'/hub.html?negocios=1');
            assert.equal(await evalPage(p.sid,"!!document.querySelector('#etaax-header .hub-login-inicio')"),false);
        });
        assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    }
    for(const width of [1440,390]){
        p=await page(base,'/hub.html','owner',width);
        await check('Guía visual: ampliar la captura actual, detalle y regreso al mismo paso a '+width+'px',async()=>{
            await evalPage(p.sid,"etaaxSeleccionarModulo('administrativo');document.body.style.overflow='auto';document.querySelector('.hub-visor[data-clave=\"diario\"] [data-dir=\"1\"]').click();document.querySelector('.hub-visor[data-clave=\"diario\"] [data-dir=\"1\"]').click()");
            const marco="document.querySelector('.hub-visor[data-clave=\"diario\"] .hub-visor-marco')";
            await until(p.sid,marco+' && !'+marco+'.disabled');
            const ctx=await evalPage(p.sid,"localStorage.getItem('etaax_ctx')");
            await evalPage(p.sid,marco+'.focus();'+marco+'.click()');
            await until(p.sid,"document.getElementById('hubCapturaAmpliada').open && !document.querySelector('#hubCapturaAmpliada img').hidden");
            assert.equal(await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada .hub-visor-cuenta').textContent"),'3/10');
            assert.ok(await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada img').src.endsWith('/guia/diario-3.png')"));
            assert.equal(await evalPage(p.sid,"document.body.style.overflow"),'hidden');
            assert.ok(await evalPage(p.sid,"(()=>{const r=document.getElementById('hubCapturaAmpliada').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()"));
            await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada .hub-captura-detalle').click()");
            assert.ok(await evalPage(p.sid,"(()=>{const r=document.querySelector('#hubCapturaAmpliada .hub-captura-imagen');return r.scrollWidth>r.clientWidth||r.scrollHeight>r.clientHeight})()"));
            await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada .hub-captura-detalle').click()");
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'},p.sid);
            await until(p.sid,"!document.querySelector('#hubCapturaAmpliada img').hidden && document.querySelector('#hubCapturaAmpliada img').src.endsWith('/guia/diario-4.png')");
            await until(p.sid,'!'+marco+'.disabled');
            assert.equal(await evalPage(p.sid,"document.querySelector('.hub-visor[data-clave=\"diario\"]').dataset.paso"),'3');
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},p.sid);
            await until(p.sid,"!document.getElementById('hubCapturaAmpliada').open");
            assert.equal(await evalPage(p.sid,'document.activeElement==='+marco),true);
            assert.equal(await evalPage(p.sid,"document.body.style.overflow"),'auto');
            assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_ctx')"),ctx);
            assert.equal(await evalPage(p.sid,'location.pathname'),'/hub.html');
        });
        await check('Guía de Staff: recorrido circular, fondo para cerrar y capturas pendientes a '+width+'px',async()=>{
            const marco="document.querySelector('.hub-visor[data-clave=\"staff\"] .hub-visor-marco')";
            await until(p.sid,'!'+marco+'.disabled');await evalPage(p.sid,marco+'.click()');
            await until(p.sid,"document.getElementById('hubCapturaAmpliada').open && !document.querySelector('#hubCapturaAmpliada img').hidden");
            await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada [data-dir=\"-1\"]').click()");
            await until(p.sid,"!document.querySelector('#hubCapturaAmpliada img').hidden && document.querySelector('#hubCapturaAmpliada img').src.endsWith('/guia/staff-8.png')");
            assert.equal(await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada .hub-visor-cuenta').textContent"),'8/8');
            await send('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1},p.sid);
            await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1},p.sid);
            await until(p.sid,"!document.getElementById('hubCapturaAmpliada').open");
            assert.equal(await evalPage(p.sid,"document.querySelector('.hub-visor[data-clave=\"staff\"]').dataset.paso"),'7');
            await evalPage(p.sid,"etaaxSeleccionarModulo('consultoria')");
            await until(p.sid,"document.querySelector('.hub-visor[data-clave=\"guias\"] .hub-visor-falta').hidden===false");
            await evalPage(p.sid,"document.querySelector('.hub-visor[data-clave=\"guias\"] .hub-visor-marco').click()");
            assert.equal(await evalPage(p.sid,"document.getElementById('hubCapturaAmpliada').open"),false);
            assert.equal(await evalPage(p.sid,"document.body.style.overflow"),'auto');
            await evalPage(p.sid,"etaaxSeleccionarModulo('administrativo')");
        });
        await check('Guía de Proveedores: tres capturas en orden y reapertura inmediata a '+width+'px',async()=>{
            const marco="document.querySelector('.hub-visor[data-clave=\"proveedores\"] .hub-visor-marco')";
            const pies=['El directorio: contactos, sucursal y forma de pago','Agregar proveedor: contacto, pago, facturación y expediente','El proveedor guardado en el directorio'];
            await until(p.sid,'!'+marco+'.disabled');await evalPage(p.sid,marco+'.click()');
            for(let i=0;i<3;i++){
                if(i) await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada [data-dir=\"1\"]').click()");
                await until(p.sid,"document.getElementById('hubCapturaAmpliada').open && !document.querySelector('#hubCapturaAmpliada img').hidden && document.querySelector('#hubCapturaAmpliada img').src.endsWith('/guia/proveedores-"+(i+1)+".png')");
                assert.equal(await evalPage(p.sid,"document.querySelector('#hubCapturaTitulo').textContent"),'Proveedores');
                assert.equal(await evalPage(p.sid,"document.querySelector('#hubCapturaPie').textContent"),pies[i]);
                assert.equal(await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada .hub-visor-cuenta').textContent"),(i+1)+'/3');
                assert.equal(await evalPage(p.sid,"document.querySelector('.hub-visor[data-clave=\"proveedores\"]').dataset.paso"),String(i));
            }
            await until(p.sid,'!'+marco+'.disabled');
            /* close se notifica en una tarea posterior; no debe cerrar el nuevo visor. */
            await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada .hub-captura-cerrar').click();"+marco+'.click()');
            await until(p.sid,"!document.querySelector('#hubCapturaAmpliada img').hidden");
            await pause(80);
            assert.equal(await evalPage(p.sid,"document.getElementById('hubCapturaAmpliada').open"),true);
            assert.equal(await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada .hub-visor-cuenta').textContent"),'3/3');
            await evalPage(p.sid,"document.querySelector('#hubCapturaAmpliada .hub-captura-cerrar').click()");
            assert.equal(await evalPage(p.sid,"document.body.style.overflow"),'auto');
        });
        assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    }
    for(const width of [1010,320]){
        p=await page(base,'/recetas/index.html?escandallos=1','owner',width);
        await check('Recetario flotante: controles sobre el header, minimizar y ventanas anidadas a '+width+'px',async()=>{
            /* Sembrar el contexto del catálogo después del arranque del SDK de prueba. */
            await evalPage(p.sid,"localStorage.setItem('etaax_ctx',JSON.stringify({ctxType:'owner',userName:'Ana González',negId:'n1',negNombre:'Café de prueba',sucId:'matriz',sucNombre:'Centro',userBadge:'Pequeña Pyme'}));initCtxBar();document.getElementById('etaaxNovOk')?.click();verRecetas()");
            const arriba="(()=>{const m=document.getElementById('modalVerRecetas'),h=m.querySelector('.etx-modal-hd'),r=h.getBoundingClientRect();return m.contains(document.elementFromPoint(r.left+10,r.top+10));})()";
            assert.equal(await evalPage(p.sid,arriba),true,'la barra tapa el encabezado del catálogo');
            assert.ok(await evalPage(p.sid,"(()=>{const m=document.querySelector('#modalVerRecetas>.modal');return m.scrollWidth<=m.clientWidth+1;})()"),'el catálogo recorta sus controles horizontalmente');
            assert.ok(await evalPage(p.sid,"(()=>{const b=document.querySelector('#modalVerRecetas .modal-close'),r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()"),'Cerrar debe poder pulsarse');
            await evalPage(p.sid,"document.querySelector('#modalVerRecetas .etx-min-btn').click()");
            assert.equal(await evalPage(p.sid,"document.getElementById('modalVerRecetas').getClientRects().length"),0);
            await evalPage(p.sid,"document.querySelector('#etx-dock .etx-chip').click()");
            assert.equal(await evalPage(p.sid,arriba),true,'el catálogo vuelve a quedar detrás al restaurarlo');
            await evalPage(p.sid,"_cacheRecetas=[{id:'rec-fixture',nombre:'Sopa de prueba',tipo:'alimentos',status:'activa',sucursalId:'matriz',ingredientes:[],porciones:1,precioVenta:60}];abrirFichaReceta('rec-fixture')");
            assert.ok(await evalPage(p.sid,"(()=>{const m=document.getElementById('modalFichaReceta'),r=m.querySelector('.modal').getBoundingClientRect();return m.contains(document.elementFromPoint(r.left+10,r.top+10));})()"),'la ficha queda detrás del catálogo');
            await evalPage(p.sid,"abrirMenuImpresion('rec-fixture')");
            assert.ok(await evalPage(p.sid,"(()=>{const m=document.getElementById('modalImpresion'),r=m.querySelector('.modal').getBoundingClientRect();return m.contains(document.elementFromPoint(r.left+10,r.top+10));})()"),'impresión queda detrás de la ficha');
            await evalPage(p.sid,"document.querySelector('#modalImpresion .modal-close').click();document.querySelector('#modalFichaReceta .modal-close').click()");
            assert.equal(await evalPage(p.sid,arriba),true);
            await evalPage(p.sid,"document.querySelector('#modalVerRecetas .modal-close').click()");
            assert.equal(await evalPage(p.sid,"document.getElementById('modalVerRecetas').getClientRects().length"),0);
            assert.equal(await evalPage(p.sid,"document.getElementById('vistaMenuReceta').getClientRects().length"),1);
            assert.equal(await evalPage(p.sid,'location.pathname'),'/recetas/index.html');
        });
        assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    }
    p=await page(base,'/hub.html','owner',1440,true);
    await check('Módulos: una sola sucursal con pin, selector con teclado y herramientas debajo',async()=>{
        assert.equal(await evalPage(p.sid,"document.getElementById('negActBar').textContent.match(/\\bCentro\\b/g).length"),1);
        assert.equal(await evalPage(p.sid,"document.querySelector('#chipSucursalHub #chipUbicacionHub use').getAttribute('href')"),'#etx-sh-matriz');
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('#hubModuloDock [role=\"tab\"]').length"),4);
        assert.equal(await evalPage(p.sid,"document.getElementById('hubModuloTitulo').textContent"),'Control administrativo');
        await evalPage(p.sid,"document.getElementById('hub-tab-recetas').focus()");
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'},p.sid);
        assert.equal(await evalPage(p.sid,"document.activeElement.id"),'hub-tab-financiero');
        assert.equal(await evalPage(p.sid,"document.getElementById('hubHerramientas').getAttribute('aria-labelledby')"),'hub-tab-financiero');
        /* Siete filas, y ninguna es un enlace: ahora ilustran en vez de navegar.
           Se exige además que cada una traiga su visor, porque una fila sin guía
           es solo un nombre — justo lo que había antes. */
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('#hubHerramientasTarjetas [data-hub-tool]').length"),7);
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('#hubHerramientasTarjetas a').length"),0);
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('#hubHerramientasTarjetas .hub-visor').length"),7);
    });
    for(const [id,total] of [['recetas',4],['financiero',7],['administrativo',5],['consultoria',3]]){
        await check('Herramientas de '+id+': rutas reales y regreso conservando módulo y sucursal',async()=>{
            await evalPage(p.sid,"document.querySelector('[data-modulo=\""+id+"\"]').click()");
            /* Las filas del hub ya no son enlaces: son una guía visual que
               ilustra cada herramienta (indicación del dueño). La ruta sigue
               declarada en la fila, así que lo que esta prueba cuidaba —que las
               19 rutas existan, que el contexto sobreviva al viaje y que el
               regreso funcione— se sigue cuidando igual, navegando a la ruta
               que la fila anuncia en vez de pulsarla. */
            const rutas=await evalPage(p.sid,"[...document.querySelectorAll('#hubHerramientasTarjetas [data-ruta]')].map(x=>x.getAttribute('data-ruta'))");
            assert.equal(rutas.length,total);
            for(const ruta of rutas){
                const destino=new URL(ruta,base+'/hub.html');
                assert.ok(fs.existsSync(path.join(root,destino.pathname)),ruta+' no existe');
                const antes=await evalPage(p.sid,"localStorage.getItem('etaax_ctx')");
                await go(p,"location.href="+JSON.stringify(ruta),"window.__rutaPrueba && location.pathname==="+JSON.stringify(destino.pathname)+" && location.search==="+JSON.stringify(destino.search));
                assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_ctx')"),antes);
                await until(p.sid,"document.querySelector('#ctxBar .ctx-right a.ctx-btn')");
                await go(p,"document.querySelector('#ctxBar .ctx-right a.ctx-btn').click()","document.querySelector('#hubModuloDock [data-modulo=\""+id+"\"][aria-selected=\"true\"]')");
                assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'matriz');
                assert.equal(await evalPage(p.sid,"JSON.parse(localStorage.getItem('etaax_ctx')).sucId"),'matriz');
            }
        });
    }
    await check('Escandallos: la tarjeta abre la herramienta real y una recarga conserva esa vista',async()=>{
        await evalPage(p.sid,"etaaxSeleccionarModulo('recetas')");
        const ctx=await evalPage(p.sid,"localStorage.getItem('etaax_ctx')");
        // Cargar el documento completo, con datos simulados, para detectar un
        // enlace que abra la portada antigua aunque el archivo sí exista.
        await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
        const abierta="document.getElementById('moduloLanding')?.style.display==='none' && document.getElementById('vistaMenuReceta')?.style.display==='flex'";
        /* La fila ya no se pulsa —ilustra—, así que se navega a la ruta que
           ella anuncia. Lo que importa sigue probándose: que ese enlace entra a
           la herramienta real y NO a la portada antigua, y que una recarga
           conserva esa vista. */
        const rutaEsc=await evalPage(p.sid,"document.querySelector('#hubHerramientasTarjetas [data-ruta*=\"escandallos\"]').getAttribute('data-ruta')");
        assert.equal(rutaEsc,'recetas/index.html?escandallos=1');
        await go(p,"location.href="+JSON.stringify(rutaEsc),abierta);
        assert.equal(await evalPage(p.sid,"new URLSearchParams(location.search).get('escandallos')"),'1');
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_ctx')"),ctx);
        await go(p,"location.reload()",abierta);
        assert.equal(await evalPage(p.sid,"new URLSearchParams(location.search).get('escandallos')"),'1');
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'matriz');
    });
    await check('Cambiar módulo: cancelar conserva la herramienta y elegir conserva la sucursal',async()=>{
        const ctx=await evalPage(p.sid,"localStorage.getItem('etaax_ctx')");
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('.theme-toggle').length"),0);
        assert.ok(await evalPage(p.sid,"document.getElementById('etxHdTema')"));
        await evalPage(p.sid,"document.getElementById('etxCambiarModulo').click()");
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('#etxModuleDialog [data-modulo]:not(:disabled)').length"),4);
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},p.sid);
        await until(p.sid,"!document.getElementById('etxModuleDialog').open");
        assert.equal(await evalPage(p.sid,'document.activeElement.id'),'etxCambiarModulo');
        assert.equal(await evalPage(p.sid,'location.pathname'),'/recetas/index.html');
        const moduloAntes=await evalPage(p.sid,"sessionStorage.getItem('etaax_hub_modulo')");
        await evalPage(p.sid,"_showEscForm();window._escDirty=true;document.getElementById('etxCambiarModulo').click();document.querySelector('#etxModuleDialog [data-modulo=\"financiero\"]').click()");
        await until(p.sid,"document.querySelector('.etaax-ui-ov')?.textContent.includes('Tienes cambios sin guardar')");
        assert.equal(await evalPage(p.sid,"document.getElementById('etxModuleDialog').open"),false);
        await evalPage(p.sid,"[...document.querySelectorAll('.etaax-ui-ov button')].find(b=>b.textContent==='Seguir editando').click()");
        assert.equal(await evalPage(p.sid,'location.pathname'),'/recetas/index.html');
        assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_hub_modulo')"),moduloAntes);
        await evalPage(p.sid,"window._escDirty=false;_showEscMenu()");
        await evalPage(p.sid,"document.getElementById('etxCambiarModulo').click()");
        /* Cambiar de módulo ENTRA al módulo —su portada, con sus herramientas—
           en vez de devolver al hub: eran dos pantallas para un movimiento
           lateral. Se sigue exigiendo que negocio y sucursal no se muevan. */
        await go(p,"document.querySelector('#etxModuleDialog [data-modulo=\"financiero\"]').click()","location.pathname==='/financiero/index.html'");
        assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_hub_modulo')"),'financiero');
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_ctx')"),ctx);
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'matriz');
    });
    assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    p=await page(base,'/hub.html','staff',390);
    await check('El selector respeta permisos por herramienta y mantiene las guías disponibles',async()=>{
        assert.equal(await evalPage(p.sid,"document.getElementById('hub-tab-recetas').disabled"),true);
        assert.equal(await evalPage(p.sid,"document.getElementById('hub-tab-financiero').disabled"),true);
        assert.equal(await evalPage(p.sid,"document.getElementById('hubModuloTitulo').textContent"),'Control administrativo');
        /* Las filas ilustran, así que el permiso ya no se lee en un `href` sino
           en cuáles salen marcadas como bloqueadas. Lo que se exige es lo mismo:
           que a este rol solo le queden abiertas sus dos herramientas. */
        assert.deepEqual(await evalPage(p.sid,"[...document.querySelectorAll('#hubHerramientasTarjetas [data-ruta]:not(.hub-tool-bloqueada)')].map(x=>x.getAttribute('data-ruta'))"),['administrativo/diario.html','administrativo/menu.html']);
        assert.ok(await evalPage(p.sid,"document.querySelectorAll('#hubHerramientasTarjetas .hub-tool-bloqueada .hub-fila-sinacceso').length>0"));
        assert.equal(await evalPage(p.sid,"etaaxSeleccionarModulo('financiero')"),false);
        await evalPage(p.sid,"document.getElementById('hub-tab-consultoria').click()");
        assert.deepEqual(await evalPage(p.sid,"[...document.querySelectorAll('#hubHerramientasTarjetas [data-ruta]:not(.hub-tool-bloqueada)')].map(x=>x.getAttribute('data-ruta'))"),['consultoria/guias.html','consultoria/ventas-productos.html']);
    });
    await check('Un cambio de permisos actualiza el selector y una revocación frena un enlace anterior',async()=>{
        /* Las filas ya no son enlaces, así que aquí no queda ningún atajo viejo
           que pulsar: lo que se exige es que al cambiar el permiso la pantalla
           se vuelva a aplicar sola —la herramienta se abre, y al revocarla
           vuelve a quedar bloqueada— y que el módulo elegido deje de estar
           disponible. Entrar sigue dependiendo del guarda de la página. */
        await evalPage(p.sid,"localStorage.setItem('etaax_n1_permisos',JSON.stringify({mesero:{recetas:true}}));window.dispatchEvent(new CustomEvent('etaax:permisos',{detail:{negId:'n1'}}));document.getElementById('hub-tab-recetas').click()");
        assert.equal(await evalPage(p.sid,"[...document.querySelectorAll('#hubHerramientasTarjetas [data-ruta]:not(.hub-tool-bloqueada)')].map(x=>x.getAttribute('data-ruta')).length"),1);
        await evalPage(p.sid,"localStorage.setItem('etaax_n1_permisos',JSON.stringify({mesero:{recetas:false}}));window.dispatchEvent(new CustomEvent('etaax:permisos',{detail:{negId:'n1'}}))");
        await pause(100);
        assert.equal(await evalPage(p.sid,'location.pathname'),'/hub.html');
        assert.equal(await evalPage(p.sid,"document.getElementById('hubModuloTitulo').textContent"),'Aprende y analiza');
        assert.deepEqual(await evalPage(p.sid,"[...document.querySelectorAll('#hubHerramientasTarjetas [data-ruta]:not(.hub-tool-bloqueada)')].map(x=>x.getAttribute('data-ruta'))"),['consultoria/guias.html']);
    });
    assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    p=await page(base,'/hub.html','staff',390,true);
    await check('Cambiar módulo de colaborador: opciones según permisos y misma sucursal',async()=>{
        await send('Network.setExtraHTTPHeaders',{headers:{}},p.sid);
        await go(p,"location.href='/administrativo/diario.html'","document.getElementById('etxCambiarModulo')");
        const ctx=await evalPage(p.sid,"localStorage.getItem('etaax_ctx')");
        await evalPage(p.sid,"document.getElementById('etxCambiarModulo').click()");
        assert.deepEqual(await evalPage(p.sid,"[...document.querySelectorAll('#etxModuleDialog [data-modulo]:not(:disabled)')].map(x=>x.dataset.modulo)"),['administrativo','consultoria']);
        await evalPage(p.sid,"document.querySelector('#etxModuleDialog [data-modulo=\"recetas\"]').click()");
        assert.equal(await evalPage(p.sid,'location.pathname'),'/administrativo/diario.html');
        /* Cambiar de módulo ENTRA al módulo —su portada, con sus herramientas—
           en vez de devolver al hub: eran dos pantallas para un movimiento
           lateral. Se sigue exigiendo que negocio y sucursal no se muevan. */
        await go(p,"document.querySelector('#etxModuleDialog [data-modulo=\"consultoria\"]').click()","location.pathname==='/consultoria/index.html'");
        assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_hub_modulo')"),'consultoria');
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_ctx')"),ctx);
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'matriz');
    });
    assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    p=await page(base,'/hub.html','owner',1440);
    await check('Sin negocio, el selector no ofrece herramientas de una sucursal anterior',async()=>{
        await evalPage(p.sid,"_sesion.isAdmin=true;_showModulos({id:'',nombre:'Hub general',tipo:'otro'})");
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('#hubModuloDock button:not(:disabled)').length"),0);
        assert.equal(await evalPage(p.sid,"document.querySelectorAll('#hubHerramientasTarjetas a').length"),0);
    });await close(p);
    for(const width of [1440,320]){
        p=await page(base,'/hub.html','owner',width,true);
        await check('Módulos: selector real, cancelar y cambio persistente a '+width+'px',async()=>{
            await evalPage(p.sid,"document.getElementById('btnCambiarSucursal').click()");
            await until(p.sid,"document.querySelectorAll('.hub-cambiar-opcion:not(:disabled)').length===2");
            assert.deepEqual(await evalPage(p.sid,"[...document.querySelectorAll('.hub-cambiar-opcion>span')].map(x=>x.textContent)"),['Centro','Norte']);
            const antes=await evalPage(p.sid,"localStorage.getItem('etaax_ctx')");
            await evalPage(p.sid,"document.querySelector('.hub-cambiar-cancelar').click()");
            assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_ctx')"),antes);
            assert.equal(await evalPage(p.sid,"document.activeElement.id"),'btnCambiarSucursal');
            await evalPage(p.sid,"document.getElementById('btnCambiarSucursal').click()");
            await until(p.sid,"document.querySelector('.hub-cambiar-opcion[data-sucursal=\"norte\"]:not(:disabled)')");
            await evalPage(p.sid,"document.querySelector('.hub-cambiar-opcion[data-sucursal=\"norte\"]').click()");
            assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'norte');
            assert.equal(await evalPage(p.sid,"document.getElementById('chipNombre').textContent"),'Norte');
            assert.ok(await evalPage(p.sid,"document.getElementById('chipSucursalHub').textContent.includes('Norte')"));
            assert.equal(await evalPage(p.sid,"JSON.parse(localStorage.getItem('etaax_ctx')).sucId"),'norte');
            assert.equal(await evalPage(p.sid,"document.getElementById('userPlanChip').textContent"),'Pequeña Pyme');
            assert.equal(await evalPage(p.sid,"getComputedStyle(document.getElementById('negActEmojiWrap')).borderRadius"),'50%');
            assert.ok(await evalPage(p.sid,"document.querySelector('#etaax-header a[href=\"/hub.html?negocios=1\"]')"));
            await go(p,'location.reload()',"document.getElementById('chipNombre')?.textContent==='Norte'");
            assert.equal(await evalPage(p.sid,"JSON.parse(localStorage.getItem('etaax_ctx')).sucId"),'norte');
            assert.ok(await evalPage(p.sid,"document.documentElement.scrollWidth<=innerWidth"));
        });
        if(width===1440){
            await check('El selector rechaza bajas y un cambio de negocio desde un diálogo anterior',async()=>{
                await evalPage(p.sid,'abrirCambiarSucursal()');
                await evalPage(p.sid,"localStorage.setItem('etaax_n1_sucursales',JSON.stringify([..._getSucursales('n1'),{id:'baja',nombre:'Baja',activa:false}]));_pintarCambioSucursal(_negocioCambioSucursal(),false)");
                assert.equal(await evalPage(p.sid,"document.querySelector('.hub-cambiar-opcion[data-sucursal=\"baja\"]').disabled"),true);
                await evalPage(p.sid,"cambiarSucursalDesdePanel('baja');cambiarSucursalDesdePanel('desconocida')");
                assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'norte');
                const antes=await evalPage(p.sid,"localStorage.getItem('etaax_ctx')");
                await evalPage(p.sid,"localStorage.setItem('etaax_negocio_activo','n2');cambiarSucursalDesdePanel('matriz')");
                assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_ctx')"),antes);
                assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'norte');
                await evalPage(p.sid,"localStorage.setItem('etaax_negocio_activo','n1');_cerrarPanelGlobal()");
            });
            await check('Si falla actualizar sucursales, se informa y se conserva la lista guardada',async()=>{
                await evalPage(p.sid,"__falloSuc=true;abrirCambiarSucursal()");
                await until(p.sid,"document.getElementById('cambiarSucursalEstado').textContent.includes('No se pudo actualizar')");
                assert.equal(await evalPage(p.sid,"document.querySelectorAll('.hub-cambiar-opcion:not(:disabled)').length"),2);
                await evalPage(p.sid,"__falloSuc=false;_cerrarPanelGlobal()");
            });
        }
        assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    }
    p=await page(base,'/hub.html','staff',390);
    await check('Colaborador: sin selector ni cambio de sucursal por llamada directa',async()=>{
        assert.equal(await evalPage(p.sid,"document.getElementById('btnCambiarSucursal').getClientRects().length"),0);
        const antes=await evalPage(p.sid,"localStorage.getItem('etaax_ctx')");
        await evalPage(p.sid,"abrirCambiarSucursal();_negIdCambioSucursal='n1';cambiarSucursalDesdePanel('norte')");
        assert.equal(await evalPage(p.sid,"document.getElementById('modalCambiarSucursal').getClientRects().length"),0);
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_ctx')"),antes);
    });await close(p);
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
            assert.equal(await evalPage(p.sid,"document.querySelectorAll('.hub-guide-step').length"),5);
            assert.ok(await evalPage(p.sid,"Array.from(document.querySelectorAll('.hub-guide-icon')).every(x=>x.querySelector('svg use'))"));
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
    for(const width of [1440,320]){
        p=await page(base,'/hub.html?negocios=1','owner',width);
        await until(p.sid,"document.querySelectorAll('#listSucursales .suc-caja').length===2");
        await check('Catálogos: seis tarjetas, seis accesos y cierre con teclado a '+width+'px',async()=>{
            await evalPage(p.sid,"document.querySelector('.hub-global-card').click()");
            await until(p.sid,"document.getElementById('modalCatGlobal').getClientRects().length");
            assert.deepEqual(await evalPage(p.sid,"Array.from(document.querySelectorAll('#modalCatGlobal .catg-label')).map(x=>x.textContent)"),['Colaboradores','Recetas / sub-recetas','Proveedores','Horarios','Insumos','Clientes']);
            assert.equal(await evalPage(p.sid,"document.querySelectorAll('#modalCatGlobal .catg-grid button').length"),6);
            assert.ok(await evalPage(p.sid,"Array.from(document.querySelectorAll('#modalCatGlobal .catg-icon')).every(x=>x.querySelector('svg use'))"));
            assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),null);
            assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_cat_global')"),'1');
            assert.equal(await evalPage(p.sid,"document.querySelector('.hub-shell').inert"),true);
            await pause(350);
            const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);
            fs.writeFileSync(path.join(os.tmpdir(),'etaax-catalogos-globales-'+width+'.png'),Buffer.from(shot.data,'base64'));
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers:8},p.sid);
            assert.equal(await evalPage(p.sid,"document.activeElement.textContent.includes('Clientes')"),true);
            await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'},p.sid);
            assert.equal(await evalPage(p.sid,"document.getElementById('modalCatGlobal').style.display"),'none');
            assert.equal(await evalPage(p.sid,"document.querySelector('.hub-shell').inert"),false);
            assert.ok(await evalPage(p.sid,"document.activeElement.matches('.hub-global-card')"));
        });
        await check('Financiero: cinco tarjetas iguales, sin cuentas, a '+width+'px',async()=>{
            await evalPage(p.sid,"document.querySelector('.hub-global-financiero').click()");
            await until(p.sid,"document.getElementById('modalFinGlobal').getClientRects().length");
            assert.deepEqual(await evalPage(p.sid,"Array.from(document.querySelectorAll('#modalFinGlobal .catg-label')).map(x=>x.textContent)"),['Resumen financiero','Ventas totales','KPIs','Estadísticas','Gastos totales']);
            assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_cat_global')"),null);
            assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_fin_global')"),'1');
            assert.ok(await evalPage(p.sid,"(()=>{const cards=[...document.querySelectorAll('#modalFinGlobal .catg-card')].map(x=>x.getBoundingClientRect());return cards.every(r=>Math.abs(r.width-cards[0].width)<1&&Math.abs(r.height-cards[0].height)<1)})()"));
            assert.ok(await evalPage(p.sid,"(()=>{const m=document.querySelector('#modalFinGlobal .modal-box').getBoundingClientRect();return m.left>=0&&m.right<=innerWidth&&m.bottom<=innerHeight})()"));
            await pause(350);
            const shot=await send('Page.captureScreenshot',{format:'png'},p.sid);
            fs.writeFileSync(path.join(os.tmpdir(),'etaax-financiero-global-'+width+'.png'),Buffer.from(shot.data,'base64'));
            await evalPage(p.sid,"cerrarFinGlobal()");
        });
        assert.deepEqual(await evalPage(p.sid,'__errors'),[]);await close(p);
    }
    p=await page(base,'/hub.html?negocios=1','owner',1440,true);
    await check('Recetas/sub-recetas abre el catálogo completo desde una sola tarjeta',async()=>{
        await evalPage(p.sid,'abrirCatalogosGlobalesNeg()');
        await go(p,"document.querySelector('.catg-recetas').click()","window.__rutaPrueba && location.pathname==='/recetas/index.html'");
        assert.equal(await evalPage(p.sid,'location.search'),'');
        assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_cat_global')"),'1');
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),null);
        assert.ok(await evalPage(p.sid,"document.querySelector('#nav a[href=\"/administrativo/horarios.html\"]')"));
    });await close(p);
    p=await page(base,'/hub.html?negocios=1','owner',1440,true);
    await check('Ventas global abre su ruta, conserva el nav y vuelve al nuevo panel',async()=>{
        await evalPage(p.sid,'abrirFinancieroGlobal()');
        await go(p,"document.querySelector('.fing-ventas').click()","window.__rutaPrueba && location.pathname==='/financiero/ventas.html'");
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),null);
        assert.equal(await evalPage(p.sid,"document.querySelector('#nav a[href=\"cuentas-bancarias.html\"]')"),null);
        assert.ok(await evalPage(p.sid,"document.querySelector('#nav a[href=\"ventas.html\"]').classList.contains('active')"));
        assert.equal(await evalPage(p.sid,"document.querySelector('#nav a[data-tooltip=\"Panel Financiero\"]').getAttribute('href')"),'/hub.html?negocios=1&panel=financiero');
        try { await until(p.sid,"document.getElementById('ctxBar').textContent.includes('Global · todas las sucursales')"); }
        catch(e){
            console.error(await evalPage(p.sid,"JSON.stringify({errors:__errors,ctx:localStorage.getItem('etaax_ctx'),fin:sessionStorage.getItem('etaax_fin_global'),text:document.getElementById('ctxBar').textContent,ready:document.readyState})"));
            throw e;
        }
        await go(p,"document.querySelector('#nav a[data-tooltip=\"Panel Financiero\"]').click()","document.getElementById('modalFinGlobal')?.getClientRects().length");
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_negocio_activo')"),'n1');
    });
    await check('Los enlaces viejos del panel financiero global regresan al nuevo',async()=>{
        await go(p,'location.href='+JSON.stringify(base+'/financiero/index.html'),"document.getElementById('modalFinGlobal')?.getClientRects().length");
        assert.equal(await evalPage(p.sid,'location.pathname'),'/hub.html');
    });
    await check('Entrar a una sucursal limpia ambos modos globales y conserva Cuentas',async()=>{
        await go(p,"cerrarFinGlobal();document.querySelector('#listSucursales .hub-suc-accion:not(.hub-suc-ajustes)').click()","document.getElementById('viewModulos')?.getClientRects().length");
        assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_fin_global')"),null);
        assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_cat_global')"),null);
        assert.equal(await evalPage(p.sid,"localStorage.getItem('etaax_sucursal_activa')"),'matriz');
        await go(p,'location.href='+JSON.stringify(base+'/financiero/index.html'),"document.querySelector('.cf-card[href=\"cuentas-bancarias.html\"]')");
        assert.equal(await evalPage(p.sid,'location.pathname'),'/financiero/index.html');
        await go(p,'location.href='+JSON.stringify(base+'/financiero/ventas.html'),'window.__rutaPrueba');
        assert.ok(await evalPage(p.sid,"document.querySelector('#nav a[href=\"cuentas-bancarias.html\"]')"));
        assert.equal(await evalPage(p.sid,"document.querySelector('#nav a[data-tooltip=\"Panel Financiero\"]').getAttribute('href')"),'index.html');
    });await close(p);
    p=await page(base,'/hub.html?negocios=1&panel=financiero','staff',390);
    await check('El enlace de regreso global no abre el panel de dueño a un colaborador',async()=>{
        assert.equal(await evalPage(p.sid,"document.getElementById('modalFinGlobal').getClientRects().length"),0);
        assert.equal(await evalPage(p.sid,"sessionStorage.getItem('etaax_fin_global')"),null);
    });await close(p);
    assert.equal(forbidden.length,0,'La página intentó salir del origen local: '+forbidden.join(', '));
}
(async()=>{
    server=http.createServer((req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name==='/__sdk-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end('('+sdkFixture.toString()+')()');return;}
        /* Las pruebas de ruta no cargan ni prueban el cálculo de cada reporte:
           usan el URL real, el contexto persistido y sus nav/ctx-bar reales. */
        if(req.headers['x-etaax-prueba-rutas']==='1' && /^(\/financiero\/(ventas|resumen|kpis|estadisticas|gastos-globales|previsiones|cuentas-bancarias)\.html|\/recetas\/(index|insumos|inventarios|requisiciones)\.html|\/administrativo\/(staff|staff-hub|horarios|proveedores|clientes|diario|menu)\.html|\/consultoria\/(guias|ventas-productos|simulador-kpis)\.html)$/.test(name)){
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
            try {
                if(url.startsWith(base+'/'))await send('Fetch.continueRequest',{requestId:m.params.requestId},m.sessionId);
                else{forbidden.push(url);await send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}
            } catch(e) {
                // Una redirección o el cierre del target puede cancelar una
                // petición pendiente. Los errores de sesiones vivas sí fallan.
                if(!closing && !closedSessions.has(m.sessionId) && !/Invalid InterceptionId/.test(e.message)) throw e;
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
