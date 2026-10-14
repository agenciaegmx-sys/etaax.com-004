/* Resumen financiero: navegador real, servidor local y negocio ficticio con Supabase simulado. Ninguna petición de la
   página puede salir del origen de prueba. Ejecutar con node; CHROME_BIN permite
   elegir Chromium en otros equipos. Los perfiles y capturas viven en el directorio temporal.
   Ejecutar: node tests/probar-resumen-financiero.cjs. KPI_CAPTURES elige el destino;
   KPI_FONTS permite usar fuentes locales para la revisión visual. */
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const fixture = require('./fixtures/kpis.cjs');
const captures = process.env.KPI_CAPTURES || path.join(os.tmpdir(),'etaax-kpis-capturas');
fs.mkdirSync(captures,{recursive:true});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, socket, closing = false, next = 0, reportHtml='';
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
function sdkFixture() {
    const mode=window.__case, F=window.__fixtureData;
    const user={id:'u1',email:'ana@fixture.invalid',user_metadata:{nombre:'Ana de prueba'}};
    window.__calls=[];
    function query(table){
        const filters={},q={};let single=false,value=null;
        ['select','order','limit','gt','neq','or','in'].forEach(k=>q[k]=()=>q);
        q.eq=(k,v)=>{filters[k]=v;return q;};
        q.maybeSingle=()=>{single=true;return q;};
        ['upsert','insert','update'].forEach(k=>q[k]=v=>{value=v;return q;});
        q.delete=()=>q;
        q.then=(resolve,reject)=>{
            window.__calls.push({table,filters:{...filters},value});
            let data=[],error=null;
            if(value){
                if(table==='kpi_targets')localStorage.setItem('__kpi_targets',JSON.stringify((Array.isArray(value)?value[0]:value).datos));
                data=value;
            }else if(table==='negocios')data=[{id:'n1',usuario_id:'u1',datos:{nombre:'Café de prueba',tipo:'cafe',organizacion:'corporativo'}}];
            else if(table==='negocio_sucursales')data={datos:{sucursales:[{id:'suc_principal',nombre:'Matriz',activa:true},{id:'norte',nombre:'Norte',activa:true}],cfg:{}}};
            else if(table==='usuarios')data={id:'u1',nombre:'Ana de prueba',plan:'pyme'};
            else if(table==='suscripciones')data={estado:'activa',proximo_cobro:'2026-11-13'};
            else if(table==='sf_metas')data={datos:{'2026-10':{meta:600000,dist:'uniforme'}}};
            else if(table==='gf_nominas')data={datos:{}};
            else if(table==='kpi_targets')data={datos:JSON.parse(localStorage.getItem('__kpi_targets')||JSON.stringify(F.targets))};
            else if(F.tables[table]){
                const list=JSON.parse(JSON.stringify(F.tables[table]));
                if(mode==='comensales'&&table==='cortes')delete list[0].comensales;
                data=list.map(d=>({id:d.id,negocio_id:'n1',datos:d}));
            }
            if((mode==='failure'&&table==='gastos')||(mode==='targets-failure'&&table==='kpi_targets')||(mode==='sales-failure'&&table==='cortes')){data=null;error={message:'Fallo controlado'};}
            if(single&&Array.isArray(data))data=data[0]||null;
            const result={data,error,count:Array.isArray(data)?data.length:1};
            const delayed=mode==='slow'&&['kpi_targets','cortes'].includes(table);
            return (delayed?new Promise(r=>setTimeout(()=>r(result),1300)):Promise.resolve(result)).then(resolve,reject);
        };return q;
    }
    window.supabase={createClient(){return {
        auth:{getUser:async()=>({data:{user},error:null}),getSession:async()=>({data:{session:{user}},error:null}),
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
        from:query,rpc:async()=>({data:{activo:true,estado:'activa'},error:null}),
        channel(){return {on(){return this;},subscribe(){return this;},track:async()=>{},presenceState(){return {};},unsubscribe(){}};},removeChannel:async()=>{}
    };}};
}
async function page(base,mode='owner',width=1440,route='/financiero/resumen.html'){
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId:sid}=await send('Target.attachToTarget',{targetId,flatten:true});
    await send('Page.enable',{},sid);await send('Fetch.enable',{patterns:[{urlPattern:'*'}]},sid);
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<720},sid);
    const seed=`window.__case=${JSON.stringify(mode)};window.__errors=[];window.addEventListener('error',e=>{if(e.message)__errors.push(e.message)});
        if(!sessionStorage.getItem('__kpi_seed')){
        localStorage.clear();sessionStorage.clear();localStorage.setItem('etaax_negocio_activo','n1');
        localStorage.setItem('etaax_ctx',JSON.stringify({ctxType:'owner',userId:'u1',userName:'Ana de prueba',negId:'n1',negNombre:'Café de prueba'}));
        localStorage.setItem('etaax_qses',JSON.stringify({usuarioId:'u1',nombre:'Ana de prueba',email:'ana@fixture.invalid',plan:'pyme',ts:Date.now()}));
        localStorage.setItem('etaax_negocios',JSON.stringify([{id:'n1',usuarioId:'u1',nombre:'Café de prueba',tipo:'cafe',organizacion:'corporativo'}]));
        localStorage.setItem('etaax_n1_sucursales',JSON.stringify([{id:'suc_principal',nombre:'Matriz',activa:true},{id:'norte',nombre:'Norte',activa:true}]));
        sessionStorage.setItem('etaax_fin_global','1');sessionStorage.setItem('__kpi_seed','1');
        ${mode==='branch'?"localStorage.setItem('etaax_sucursal_activa','norte');sessionStorage.removeItem('etaax_fin_global');":''}
        }
        window.__fixtureGeneration=Number(sessionStorage.getItem('__kpi_generation')||0)+1;sessionStorage.setItem('__kpi_generation',String(__fixtureGeneration));`;
    await send('Page.addScriptToEvaluateOnNewDocument',{source:seed},sid);
    await send('Page.navigate',{url:base+route},sid);
    const p={sid,targetId,route};
    if(route.startsWith('/financiero/resumen'))await until(sid,"typeof _c!=='undefined' && document.querySelectorAll('#rsKpis .rs-res-card').length===6");else await until(sid,"document.getElementById('etaax-header') && typeof _cacheCortesSF!=='undefined' && _cacheCortesSF!==null");
    if(mode!=='slow'&&route.startsWith('/financiero/resumen'))await ready(p);
    return p;
}
async function ready(p){
    await until(p.sid,"_c.listo && document.getElementById('etaax-header')");
    await evalPage(p.sid,"if(!location.search){periodoTipo='mes';document.getElementById('pickerInput').value='2026-10';render();}document.getElementById('etaaxNovOk')?.click();document.fonts.ready");
    await until(p.sid,"(()=>{const b=document.getElementById('etaaxNovOk');if(b)b.click();return !document.getElementById('etaaxNovedades')})()");
}
async function close(p){closedSessions.add(p.sid);await send('Target.closeTarget',{targetId:p.targetId});}
async function check(name,fn){await fn();results.push(name);console.log('PASA '+name);}
async function model(p){return evalPage(p.sid,"_kpiOperativosModelo(getPeriodoData('2026-10-01','2026-10-31'),loadTargets())");}
function numeric(actual,expected){assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);}
async function shot(p,name){const s=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(captures,name+'.png'),Buffer.from(s.data,'base64'));}
async function run(base){
    const p=await page(base);
    await check('Resumen financiero y resultados antes de simulación',async()=>{
        assert.match(await evalPage(p.sid,'document.title'),/Resumen financiero/);assert.equal(await evalPage(p.sid,"document.querySelectorAll('#rsKpis .rs-res-card').length"),6);
        assert.ok(await evalPage(p.sid,"document.getElementById('rsKpis').getBoundingClientRect().top<document.querySelector('.rs-card').getBoundingClientRect().top"));
        assert.equal(await evalPage(p.sid,"getComputedStyle(document.getElementById('ed_ventas').parentElement).display"),'none');
    });
    await check('Ventas, cheque y comensales concilian sin incluir otros ingresos',async()=>{
        const a=await evalPage(p.sid,'_RS_INFO');assert.equal(a.ventas,300000);assert.equal(a.indicadores.cheque,300);assert.equal(a.indicadores.comensales,1000);assert.equal(a.otros,12000);
        numeric(await evalPage(p.sid,'metaDelRango()'),600000);
    });
    await check('Resultado y disponibilidad se distinguen y cuadran con KPIs',async()=>{
        const a=await evalPage(p.sid,'_RS_INFO');assert.equal(a.resultado,72000);assert.equal(a.apartados,4200);assert.equal(a.utilidad,67800);
        assert.equal(await evalPage(p.sid,'_RS_BASE.utilidad'),67800);
    });
    await check('Compras, nómina e IMSS conservan la clasificación de gastos',async()=>{
        const a=await evalPage(p.sid,'_RS_INFO');assert.deepEqual(a.compras,{cocina:60000,barra:36000});assert.equal(a.nomina.operativa,75000);assert.equal(a.nomina.imss,6000);assert.equal(a.pendientes,90000);
    });
    await check('Desgloses de resultado, cocina, barra e ingresos extra suman sus tarjetas',async()=>{
        for(const [k,expected] of [['resultado',72000],['disponible',67800],['comprasCocina',60000],['comprasBarra',36000],['otrosIngresos',12000],['pendientes',90000],['propinas',20000]]){
            const n=await evalPage(p.sid,"_DET['"+k+"'].reduce((t,x)=>t+x.monto,0)");assert.equal(n,expected,k);
            await evalPage(p.sid,"verDetalle('"+k+"')");assert.ok(await evalPage(p.sid,"document.getElementById('rsDetOv').textContent.includes('"+expected.toLocaleString('es-MX')+"')"));await evalPage(p.sid,"document.getElementById('rsDetOv').remove()");
        }
    });
    await check('Las oportunidades tienen evidencia y acción, y son como máximo tres',async()=>{
        const ops=await evalPage(p.sid,'_RS_OPS');assert.ok(ops.length>0&&ops.length<=3);assert.ok(ops.every(o=>o.texto&&o.accion&&(o.href||o.js)));assert.ok(ops.some(o=>/pendientes/.test(o.titulo)));
    });
    await check('Simular conserva la realidad y cambia sólo el escenario',async()=>{
        await evalPage(p.sid,"document.getElementById('btnSimular').click()");assert.equal(await evalPage(p.sid,"getComputedStyle(document.getElementById('ed_ventas').parentElement).display"),'table-cell');
        const antes=await evalPage(p.sid,'JSON.stringify(_c.gastos)');await evalPage(p.sid,"document.getElementById('ed_ventas').value='400000';document.getElementById('ed_ventas').dispatchEvent(new Event('change'))");
        assert.equal(await evalPage(p.sid,'JSON.stringify(_c.gastos)'),antes);assert.equal(await evalPage(p.sid,'_RS_BASE.utilidad'),67800);assert.ok(await evalPage(p.sid,'_proy.ventas===400000'));
    });
    await check('Impreso lleva dos páginas de resultados y una simulación opcional',async()=>{
        await evalPage(p.sid,"etaaxAbrirReporte=html=>window.__reporte=html;imprimirResumen()");const h=await evalPage(p.sid,'__reporte');assert.equal((h.match(/data-rf-pagina=/g)||[]).length,3);assert.match(h,/Simulación manual/);
        await evalPage(p.sid,"document.getElementById('btnSimular').click();imprimirResumen()");const real=await evalPage(p.sid,'__reporte');assert.equal((real.match(/data-rf-pagina=/g)||[]).length,2);assert.match(real,/67,800/);assert.match(real,/72,000/);assert.match(real,/Explicación y decisiones/);assert.doesNotMatch(real,/undefined|NaN/);
    });
    await check('El PDF de resultados ocupa realmente dos páginas',async()=>{
        reportHtml=(await evalPage(p.sid,'__reporte')).replace(/<script>window.onload=[\s\S]*?<\/script>/g,'').replace(/<link[^>]*href="https:[^>]+>/g,'');
        if(process.env.KPI_FONTS)reportHtml=reportHtml.replace('</head>','<link rel="stylesheet" href="/__visual-fonts/fonts.css"></head>');
        const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId:sid}=await send('Target.attachToTarget',{targetId,flatten:true});
        await send('Page.enable',{},sid);await send('Fetch.enable',{patterns:[{urlPattern:'*'}]},sid);await send('Page.navigate',{url:base+'/__reporte-financiero.html'},sid);
        await until(sid,"document.querySelectorAll('[data-rf-pagina]').length===2");await evalPage(sid,'document.fonts.ready');
        const pdf=await send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true},sid),bytes=Buffer.from(pdf.data,'base64');fs.writeFileSync(path.join(captures,'resumen-financiero.pdf'),bytes);
        const pages=(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;assert.equal(pages,2,'Número de páginas PDF');await close({sid,targetId});
    });
    await check('Cambiar de periodo descarta los cambios de simulación anteriores',async()=>{
        await evalPage(p.sid,"setPeriodo('dia');document.getElementById('pickerInput').value='2026-10-06';cambiarFechas()");assert.deepEqual(await evalPage(p.sid,'_proy'),{});assert.equal(await evalPage(p.sid,'_RS_INFO.ventas'),120000);assert.equal(await evalPage(p.sid,'_RS_INFO.apartados'),2000);assert.equal(await evalPage(p.sid,'_RS_INFO.utilidad'),28000);
    });
    await check('Semana se abre con un valor válido y Año incluye sus doce meses',async()=>{
        await evalPage(p.sid,"setPeriodo('semana')");assert.match(await evalPage(p.sid,"document.getElementById('pickerInput').value"),/^\d{4}-W\d{2}$/);
        await evalPage(p.sid,"setPeriodo('anio');document.getElementById('pickerInput').value='2026';render()");assert.equal(await evalPage(p.sid,'_RS_INFO.ventas'),350000);assert.ok(await evalPage(p.sid,"document.getElementById('rsKpis').textContent.includes('Meta parcial')"));assert.deepEqual(await evalPage(p.sid,'rango()'),{from:'2026-01-01',to:'2026-12-31'});
    });
    await check('Sucursales: matriz y Norte conservan sus cortes y sus reservas',async()=>{
        await evalPage(p.sid,"periodoTipo='mes';document.getElementById('pickerInput').type='month';document.getElementById('pickerInput').value='2026-10';localStorage.setItem('etaax_sucursal_activa','norte');render()");assert.equal(await evalPage(p.sid,'_RS_INFO.ventas'),120000);assert.equal(await evalPage(p.sid,'_RS_INFO.apartados'),2000);assert.equal(await evalPage(p.sid,'_RS_INFO.utilidad'),28000);
        await evalPage(p.sid,"localStorage.setItem('etaax_sucursal_activa','suc_principal');render()");assert.equal(await evalPage(p.sid,'_RS_INFO.ventas'),180000);assert.equal(await evalPage(p.sid,'_RS_INFO.apartados'),2200);assert.equal(await evalPage(p.sid,'_RS_INFO.utilidad'),39800);
    });
    await check('Comensales parciales no producen un cheque inflado',async()=>{
        await evalPage(p.sid,"delete _c.cortes.find(c=>c.id==='c1').comensales;render()");assert.equal(await evalPage(p.sid,'_RS_INFO.indicadores.cheque'),null);const text=await evalPage(p.sid,"document.getElementById('rsKpis').textContent");assert.match(text,/Faltan comensales/);assert.doesNotMatch(text,/\$450/);
    });
    await check('El desglose incorpora la comisión automática de los cortes',async()=>{
        await evalPage(p.sid,"_c.cortes=[{id:'q1',fecha:'2026-10-06',sucursalId:'suc_principal',tarjeta:1000,comensales:5}];_c.gastos=[];_c.otros=[];_c.deps=[];_c.ctas=[{id:'a',tipo:'debito',comisionTD:3,comisionTC:3}];render()");assert.equal(await evalPage(p.sid,'_DET.otros.reduce((t,x)=>t+x.monto,0)'),30);assert.equal(await evalPage(p.sid,'_DET.resultado.reduce((t,x)=>t+x.monto,0)'),970);assert.equal(await evalPage(p.sid,'_RS_INFO.resultado'),970);
    });
    await check('El detalle financiero respeta la misma prioridad de clasificación',async()=>{
        await evalPage(p.sid,"_c.gastos=[{id:'f',fecha:'2026-10-06',sucursalId:'suc_principal',categoria:'Gastos financieros',concepto:'Pago IMSS',monto:40}];render()");
        assert.equal(await evalPage(p.sid,'_RS_INFO.financieros'),0);assert.equal(await evalPage(p.sid,'_DET.financieros.reduce((t,x)=>t+x.monto,0)'),0);assert.equal(await evalPage(p.sid,'_RS_INFO.nomina.imss'),40);
    });
    await check('Sin gastos pagados no se declara un Score de operación saludable',async()=>{
        await evalPage(p.sid,"_c.gastos=[];_c.ctas=[];render()");assert.ok(await evalPage(p.sid,"document.getElementById('rsScore').textContent.includes('—')"));
    });
    await check('Sin metas guardadas el Score no inventa una calificación',async()=>{
        await evalPage(p.sid,"_c.targets=null;render()");assert.ok(await evalPage(p.sid,"document.getElementById('rsScore').textContent.includes('—')"));
    });
    await check('No se produjeron errores de JavaScript durante las operaciones',async()=>assert.deepEqual(await evalPage(p.sid,'__errors'),[]));await close(p);
    for(const mode of ['failure','targets-failure','comensales']){
        const q=await page(base,mode);
        await check(mode+': fallos y datos faltantes se reconocen sin éxito ficticio',async()=>{
            if(mode==='failure'){
                assert.match(await evalPage(q.sid,"document.getElementById('rsEstadoDatos').textContent"),/parcial/);
                const v=await evalPage(q.sid,"Array.from(document.querySelectorAll('#rsKpis .rs-res-valor')).map(e=>e.textContent)");assert.equal(v[4],'—');assert.equal(v[5],'—');
                await evalPage(q.sid,"etaaxAbrirReporte=html=>window.__reporte=html;imprimirResumen()");assert.match(await evalPage(q.sid,'__reporte'),/INCOMPLETO/);
            }else if(mode==='targets-failure')assert.ok(await evalPage(q.sid,"document.getElementById('rsScore').textContent.includes('—')"));
            else assert.equal(await evalPage(q.sid,'_RS_INFO.indicadores.cheque'),null);
            assert.deepEqual(await evalPage(q.sid,'__errors'),[]);
        });await close(q);
    }
    const ruta=await page(base,'owner',1440,'/financiero/resumen.html?tipo=rango&periodo=2026-10-05&desde=2026-10-05&hasta=2026-10-06');
    await check('Un enlace preserva el rango y lo propaga a sus fuentes',async()=>{assert.deepEqual(await evalPage(ruta.sid,'rango()'),{from:'2026-10-05',to:'2026-10-06'});const u=await evalPage(ruta.sid,"_enlaceRs('ventas.html')");assert.match(u,/desde=2026-10-05/);assert.match(u,/hasta=2026-10-06/);});await close(ruta);
    for(const tipo of ['rango','anio']){
        const f=await page(base,'owner',1440,'/financiero/ventas.html?tipo='+tipo+'&periodo='+ (tipo==='anio'?'2026':'2026-10-05')+'&desde='+ (tipo==='anio'?'2026-01-01':'2026-10-05')+'&hasta='+ (tipo==='anio'?'2026-12-31':'2026-10-06'));
        await check('Ventas reales conserva el filtro '+tipo+' que llega del resumen',async()=>{const r=await evalPage(f.sid,'getRange()');assert.equal(r.from,tipo==='anio'?'2026-01-01':'2026-10-05');assert.equal(r.to,tipo==='anio'?'2026-12-31':'2026-10-06');assert.deepEqual(await evalPage(f.sid,'__errors'),[]);});await close(f);
    }
    for(const width of [1440,390,320]){
        const v=await page(base,'owner',width);
        for(const theme of ['dark','light']){
            await evalPage(v.sid,"EtaaxTheme.set('"+theme+"');document.fonts.ready");await pause(150);
            await check(width+'px '+theme+': resultados y explicación sin desbordar',async()=>{
                const r=await evalPage(v.sid,"({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:Array.from(document.querySelectorAll('.rs-res-card')).map(e=>e.getBoundingClientRect().right)})");assert.ok(r.scroll<=width,JSON.stringify(r));assert.ok(r.cards.every(x=>x<=width));
                await evalPage(v.sid,"verDetalle('comprasCocina')");assert.ok(await evalPage(v.sid,'document.documentElement.scrollWidth<=innerWidth'));await evalPage(v.sid,"document.getElementById('rsDetOv').remove()");
            });
            await shot(v,'resumen-'+width+'-'+theme);
            if(width===1440){const h=await evalPage(v.sid,'document.documentElement.scrollHeight');const full=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:h,scale:1}},v.sid);fs.writeFileSync(path.join(captures,'resumen-completo-'+theme+'.png'),Buffer.from(full.data,'base64'));}
        }
        await check(width+'px: simulación contenida y sin errores JS',async()=>{
            await evalPage(v.sid,'toggleSimulacion()');assert.ok(await evalPage(v.sid,'document.documentElement.scrollWidth<=innerWidth'));assert.deepEqual(await evalPage(v.sid,'__errors'),[]);await evalPage(v.sid,'toggleSimulacion()');
        });await close(v);
    }
    assert.equal(forbidden.length,0,'Intentó salir del origen local: '+forbidden.join(', '));console.log('Capturas: '+captures);
}
(async()=>{
    server=http.createServer((req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name.startsWith('/__visual-fonts/') && process.env.KPI_FONTS){const file=path.join(process.env.KPI_FONTS,path.basename(name));if(fs.existsSync(file)){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'font/ttf');res.end(fs.readFileSync(file));return;}}
        if(name==='/__reporte-financiero.html'){res.setHeader('Content-Type','text/html');res.end(reportHtml);return;}
        if(name==='/__sdk-fixture.js'){res.setHeader('Content-Type','text/javascript');res.end('window.__fixtureData='+JSON.stringify(fixture)+';('+sdkFixture.toString()+')()');return;}
        const filename=path.resolve(root,'.'+decodeURIComponent(name));
        if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||fs.statSync(filename).isDirectory()){res.writeHead(404);res.end();return;}
        const ext=path.extname(filename), mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
        res.setHeader('Content-Type',mime[ext]||'text/plain');
        if(ext==='.html'){
            let html=fs.readFileSync(filename,'utf8').replace(/<link[^>]*href="https:[^>]+>/g,'')
                .replace(/src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^\"]+"/g,'src="/__sdk-fixture.js"');
            res.end(process.env.KPI_FONTS?html.replace('</head>','<link rel="stylesheet" href="/__visual-fonts/fonts.css"></head>'):html);
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
    console.log('RESUMEN FINANCIERO: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
