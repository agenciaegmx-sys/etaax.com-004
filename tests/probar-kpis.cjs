/* KPIs: navegador real, servidor local y negocio ficticio con Supabase simulado. Ninguna petición de la
   página puede salir del origen de prueba. Ejecutar con node; CHROME_BIN permite
   elegir Chromium en otros equipos. Los perfiles y capturas viven en el directorio temporal.
   Ejecutar: node tests/probar-kpis.cjs. KPI_CAPTURES elige el destino;
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
async function page(base,mode='owner',width=1440){
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
    await send('Page.navigate',{url:base+'/financiero/kpis.html'},sid);
    const p={sid,targetId};
    await until(sid,"typeof _kCache!=='undefined' && document.querySelectorAll('[data-kpi]').length===8");
    if(mode!=='slow')await ready(p);
    return p;
}
async function ready(p){
    await until(p.sid,"_kCache.listo && document.getElementById('etaax-header')");
    await evalPage(p.sid,"periodoTipo='mes';document.getElementById('pickerInput').value='2026-10';renderAll();document.getElementById('etaaxNovOk')?.click();document.fonts.ready");
    await until(p.sid,"(()=>{const b=document.getElementById('etaaxNovOk');if(b)b.click();return !document.getElementById('etaaxNovedades')})()");
}
async function close(p){closedSessions.add(p.sid);await send('Target.closeTarget',{targetId:p.targetId});}
async function check(name,fn){await fn();results.push(name);console.log('PASA '+name);}
async function model(p){return evalPage(p.sid,"_kpiOperativosModelo(getPeriodoData('2026-10-01','2026-10-31'),loadTargets())");}
function numeric(actual,expected){assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);}
async function shot(p,name){const s=await send('Page.captureScreenshot',{format:'png'},p.sid);fs.writeFileSync(path.join(captures,name+'.png'),Buffer.from(s.data,'base64'));}
async function run(base){
    const p=await page(base);
    await check('Ocho tarjetas, utilidad y los seis conceptos conservados',async()=>{
        const ui=await evalPage(p.sid,"({titles:Array.from(document.querySelectorAll('[data-kpi] h2')).map(e=>e.textContent),six:document.querySelectorAll('#distGrid .dist-col').length,targets:document.querySelectorAll('.targets-grid .tgt-col').length})");
        assert.equal(ui.titles.length,8);assert.ok(ui.titles.includes('Utilidad'));assert.ok(!ui.titles.includes('Ganancia de la operación'));assert.equal(ui.six,6);assert.equal(ui.targets,6);
    });
    await check('Todas las tarjetas permiten definir o editar su meta con una fuente',async()=>{
        for(const k of ['cocina','barra','staff','primo','utilidad','cheque','propinas','extra']){
            await evalPage(p.sid,"document.querySelector('[data-kpi="+k+"] .kpi-definir-meta').click()");
            assert.ok(await evalPage(p.sid,"document.getElementById('metaIndicadorDialog').open"));
            assert.ok(await evalPage(p.sid,"document.querySelector('#metaIndicadorDialog .meta-ind-fuente').href.startsWith('https://')"));
            await evalPage(p.sid,"document.getElementById('metaIndicadorCancelar').click()");
        }
    });
    await check('La sugerencia es visible sin reemplazar la meta guardada',async()=>{
        const before=await evalPage(p.sid,'JSON.stringify(_kCache.targets)');
        await evalPage(p.sid,"definirMetaIndicador('cocina');document.getElementById('metaIndicadorMix').value='50';document.getElementById('metaIndicadorMix').dispatchEvent(new Event('input'));document.getElementById('metaIndicadorUsar').click()");
        assert.equal(await evalPage(p.sid,"document.getElementById('metaIndicadorValor').value"),'17.5');
        await evalPage(p.sid,"document.getElementById('metaIndicadorCancelar').click()");assert.equal(await evalPage(p.sid,'JSON.stringify(_kCache.targets)'),before);
    });
    await check('Cocina y barra usan compras pagadas sin pedidos pendientes',async()=>{
        const m=await model(p);numeric(m[0].valor,20);numeric(m[1].valor,12);
        const area=await evalPage(p.sid,"EtaaxCore.costoInsumosPorArea(getPeriodoData('2026-10-01','2026-10-31').gastos)");assert.deepEqual(area,{cocina:60000,barra:36000});
    });
    await check('Nómina incluye IMSS; Prime cost suma insumos y nómina una vez',async()=>{const m=await model(p);numeric(m[2].valor,27);numeric(m[3].valor,59);});
    await check('Propinas no inflan ingresos, utilidad ni ventas',async()=>{
        const d=await evalPage(p.sid,"getPeriodoData('2026-10-01','2026-10-31')");assert.equal(d.ventas,300000);assert.equal(d.ingresos,312000);assert.equal(d.egresos,240000);assert.equal(d.util,67800);assert.equal(d.prevs,4200);
        numeric((await model(p))[4].valor,67800/312000*100);
    });
    await check('Promedios ponderados por comensales, sin tratar personas como tickets',async()=>{
        const m=await model(p);numeric(m[5].valor,300);numeric(m[6].valor,20);
        assert.match(m[5].desc,/comensales/);assert.match(m[6].desc,/comensales/);
        const c=await evalPage(p.sid,"EtaaxCore.indicadoresRestaurante({ventas:1000,cortes:[{efectivo:100,comensales:1,propEfectivo:10},{efectivo:900,comensales:9,propEfectivo:90}]})");numeric(c.cheque,100);numeric(c.propinas,10);
    });
    await check('Consumo extra no inventa cero sin consumos comparables',async()=>{const m=(await model(p))[7];assert.equal(m.valor,null);assert.equal(m.etiqueta,'Sin datos comparables');assert.equal(m.estado,'pendiente');});
    await check('Metas cargadas rellenan el formulario en lugar de sobreescribirlas',async()=>{
        const t=await evalPage(p.sid,"({fijos:document.getElementById('tgtFijos').value,cocina:document.getElementById('metaCocina').value,cheque:document.getElementById('metaCheque').value,disabled:document.getElementById('btnGuardarTargets').disabled})");assert.deepEqual(t,{fijos:'10.5',cocina:'22',cheque:'310',disabled:false});
    });
    await check('Metas de máximo y mínimo califican según su dirección',async()=>{const m=await model(p);assert.equal(m[0].estado,'cumplida');assert.equal(m[5].estado,'fuera');assert.equal(m[6].estado,'cumplida');assert.equal(m[4].estado,'cumplida');});
    await check('Comparación de límite no cambia por redondeo flotante',async()=>{
        const m=await evalPage(p.sid,"(()=>{const t=loadTargets();t.operativos={...t.operativos,cocina:20,propinas:20};return _kpiOperativosModelo(getPeriodoData('2026-10-01','2026-10-31'),t)})()");assert.equal(m[0].estado,'cumplida');assert.equal(m[6].estado,'cumplida');
    });
    await check('Cambiar sucursal también filtra los apartados de previsiones',async()=>{
        await evalPage(p.sid,"document.getElementById('sucChip').click();document.querySelector('#sucMenu [data-suc=\"norte\"]').click()");
        const d=await evalPage(p.sid,"getPeriodoData('2026-10-01','2026-10-31')");assert.equal(d.ventas,120000);assert.equal(d.prevs,2000);assert.equal(d.util,28000);
        const m=await model(p);numeric(m[1].valor,12.5);numeric(m[3].valor,60);numeric(m[4].valor,28000/123000*100);
    });
    await check('Matriz incluye registros antiguos sin sello y excluye Norte',async()=>{
        await evalPage(p.sid,"document.getElementById('sucChip').click();document.querySelector('#sucMenu [data-suc=\"suc_principal\"]').click()");
        const d=await evalPage(p.sid,"getPeriodoData('2026-10-01','2026-10-31')");assert.equal(d.ventas,180000);assert.equal(d.prevs,2200);assert.equal(d.util,39800);
        await evalPage(p.sid,"document.getElementById('sucChip').click();document.querySelector('#sucMenu [data-suc=\"\"]').click()");
    });
    await check('Día y rango actualizan las tarjetas y excluyen otras fechas',async()=>{
        await evalPage(p.sid,"document.getElementById('tabDia').click();document.getElementById('pickerInput').value='2026-10-06';document.getElementById('pickerInput').dispatchEvent(new Event('change'))");
        assert.equal(await evalPage(p.sid,"document.querySelector('[data-kpi=barra] .kpi-oper-valor').textContent"),'12.5%');
        await evalPage(p.sid,"document.getElementById('tabRango').click();document.getElementById('pickerInput').value='2026-10-05';document.getElementById('pickerEnd').value='2026-10-05';renderAll()");
        numeric(await evalPage(p.sid,"_kpiOperativosModelo(getPeriodoData(getRangoSel().from,getRangoSel().to),loadTargets())[4].valor"),30800/180000*100);
    });
    await check('Semana usa el mismo rango compartido del resto de finanzas',async()=>{
        await evalPage(p.sid,"document.getElementById('tabSemana').click();document.getElementById('pickerInput').value='2026-W41';renderAll()");const d=await evalPage(p.sid,"getRangoSel()");assert.equal(d.from,'2026-10-05');assert.equal(d.to,'2026-10-11');
        numeric(await evalPage(p.sid,"_kpiOperativosModelo(getPeriodoData(getRangoSel().from,getRangoSel().to),loadTargets())[3].valor"),59);
    });
    await check('Sin ventas los porcentajes quedan sin dato y sin meta cumplida',async()=>{
        await evalPage(p.sid,"document.getElementById('tabDia').click();document.getElementById('pickerInput').value='2026-10-20';renderAll()");const states=await evalPage(p.sid,"Array.from(document.querySelectorAll('[data-kpi]')).map(e=>({value:e.querySelector('.kpi-oper-valor').textContent,state:e.querySelector('.kpi-oper-estado').textContent}))");assert.ok(states.every(c=>c.value==='—'));assert.ok(states.every(c=>c.state!=='Meta cumplida'));
        await evalPage(p.sid,"document.getElementById('tabMes').click();document.getElementById('pickerInput').value='2026-10';renderAll()");
    });
    await check('Utilidad negativa se conserva como pérdida y no se trunca a cero',async()=>{const m=await evalPage(p.sid,"EtaaxCore.indicadoresRestaurante({ventas:100,ingresos:100,utilidad:-50})");assert.equal(m.utilidad,-50);});
    await check('Sin metas nuevas no aplica las cifras del ejemplo de referencia',async()=>{
        const m=await evalPage(p.sid,"_kpiOperativosModelo(getPeriodoData('2026-10-01','2026-10-31'),{...loadTargets(),operativos:{},primo:undefined})");assert.equal(m[0].meta,null);assert.equal(m[1].meta,null);assert.equal(m[5].meta,null);assert.equal(m[3].meta,null);assert.equal(m[2].meta,28);
    });
    await check('Guardar una tarjeta conserva las otras metas y campos desconocidos',async()=>{await evalPage(p.sid,"definirMetaIndicador('cocina');document.getElementById('metaIndicadorValor').value='22';document.getElementById('metaIndicadorGuardar').click()");await until(p.sid,"!document.getElementById('metaIndicadorDialog').open");const t=await evalPage(p.sid,'_kCache.targets');assert.equal(t.operativos.cocina,22);assert.equal(t.operativos.barra,15);assert.equal(t.operativos.desconocida,77);assert.equal(t.nota,'conservar');});
    await check('Guardar acepta metas cero y conserva campos ajenos',async()=>{
        await evalPage(p.sid,"document.getElementById('metaCocina').value='0';document.getElementById('tgtUtil').value='0';document.getElementById('btnGuardarTargets').click()");
        await until(p.sid,"localStorage.getItem('__kpi_targets')!==null");
        const t=await evalPage(p.sid,"JSON.parse(localStorage.getItem('__kpi_targets'))");assert.equal(t.util,0);assert.equal(t.operativos.cocina,0);assert.equal(t.fijos,10.5);assert.equal(t.nota,'conservar');assert.equal(t.food,30);assert.equal(t.operativos.desconocida,77);
    });
    await check('Las metas sobreviven a recargar con el almacenamiento simulado',async()=>{
        const gen=await evalPage(p.sid,'__fixtureGeneration');await send('Page.reload',{},p.sid);await until(p.sid,'window.__fixtureGeneration>'+gen+' && typeof _kCache!=="undefined" && _kCache.listo');await ready(p);
        assert.equal(await evalPage(p.sid,"document.getElementById('metaCocina').value"),'0');assert.equal(await evalPage(p.sid,"document.getElementById('tgtUtil').value"),'0');
    });
    await check('Una meta inválida no cambia el documento guardado',async()=>{
        const before=await evalPage(p.sid,"localStorage.getItem('__kpi_targets')");await evalPage(p.sid,"document.getElementById('metaCocina').value='101';document.getElementById('btnGuardarTargets').click()");assert.equal(await evalPage(p.sid,"localStorage.getItem('__kpi_targets')"),before);assert.ok(await evalPage(p.sid,"document.getElementById('kpiMetasEstado').classList.contains('error')"));
    });
    await check('Importes negativos no se guardan como metas',async()=>{const before=await evalPage(p.sid,"localStorage.getItem('__kpi_targets')");await evalPage(p.sid,"document.getElementById('metaCocina').value='0';document.getElementById('metaCheque').value='-1';document.getElementById('btnGuardarTargets').click()");assert.equal(await evalPage(p.sid,"localStorage.getItem('__kpi_targets')"),before);await evalPage(p.sid,"document.getElementById('metaCheque').value='310'");});
    await check('Una meta opcional vacía borra sólo ese objetivo',async()=>{
        await evalPage(p.sid,"document.getElementById('metaCocina').value='';document.getElementById('btnGuardarTargets').click()");await until(p.sid,"!('cocina' in JSON.parse(localStorage.getItem('__kpi_targets')).operativos)");const t=await evalPage(p.sid,"JSON.parse(localStorage.getItem('__kpi_targets'))");assert.equal(t.operativos.desconocida,77);assert.equal(t.operativos.barra,15);
    });
    await check('Reporte usa las ocho tarjetas, los mismos datos y los seis conceptos',async()=>{
        await evalPage(p.sid,"window.open=()=>({document:{write(html){window.__reporte=html;},close(){}}});imprimirKPIs()");const h=await evalPage(p.sid,'__reporte');assert.match(h,/Costo de cocina/);assert.match(h,/Prime cost/);assert.match(h,/59\.0%/);assert.match(h,/Cheque promedio/);assert.match(h,/300\.00/);assert.match(h,/DISTRIBUCIÓN/i);assert.match(h,/N[oó]mina/i);assert.doesNotMatch(h,/NaN|undefined|Ganancia de la operación/);
    });
    await check('Desglose original sigue accesible sobre el encabezado',async()=>{
        await evalPage(p.sid,"abrirDesglose('vars')");assert.ok(await evalPage(p.sid,"(()=>{const e=document.getElementById('modalDrill');return getComputedStyle(e).display!=='none'&&Number(getComputedStyle(e).zIndex)>Number(getComputedStyle(document.getElementById('etaax-header')).zIndex)})()"));await evalPage(p.sid,'cerrarDesglose()');
    });
    await close(p);
    for(const mode of ['failure','targets-failure','sales-failure','comensales','branch','slow']){
        const q=await page(base,mode);
        if(mode==='slow'){
            await check('Durante la carga no permite guardar metas ni declara éxito',async()=>{
                assert.ok(await evalPage(q.sid,"!_kCache.listo && document.getElementById('btnGuardarTargets').disabled && Array.from(document.querySelectorAll('.kpi-oper-estado')).every(e=>e.textContent==='Cargando datos')"));
            });await ready(q);
        }
        if(mode==='failure'){
            await check('Fallo de gastos: costos pendientes, promedios disponibles y aviso explícito',async()=>{const m=await model(q);assert.ok(m.slice(0,5).every(c=>c.valor===null&&c.etiqueta==='Datos incompletos'),JSON.stringify({m,cache:await evalPage(q.sid,'_kCache.falló')}));numeric(m[5].valor,300);assert.match(await evalPage(q.sid,"document.getElementById('kpiFalla').textContent"),/gastos/);});
            await check('El reporte también declara que los datos están incompletos',async()=>{await evalPage(q.sid,"window.open=()=>({document:{write(html){window.__reporte=html;},close(){}}});imprimirKPIs()");assert.match(await evalPage(q.sid,'__reporte'),/INCOMPLETO/);});
        }
        if(mode==='targets-failure')await check('Sin lectura de metas: conservar datos y bloquear su sobreescritura',async()=>{const m=await model(q);assert.equal(m[0].valor,20);assert.equal(m[0].meta,null);assert.equal(m[0].etiqueta,'Meta no disponible');assert.ok(await evalPage(q.sid,"document.getElementById('btnGuardarTargets').disabled"));});
        if(mode==='sales-failure')await check('Sin lectura de ventas no se muestran porcentajes ni promedios falsos',async()=>{const m=await model(q);assert.ok(m.slice(0,7).every(c=>c.valor===null&&c.estado==='pendiente'));});
        if(mode==='comensales')await check('Comensales incompletos no fabrican promedios a partir de una parte',async()=>{const m=await model(q);assert.equal(m[5].valor,null);assert.equal(m[6].valor,null);assert.equal(m[5].etiqueta,'Faltan comensales');numeric(m[3].valor,59);});
        if(mode==='branch')await check('El acceso de sucursal queda limitado a sus datos',async()=>{const d=await evalPage(q.sid,"getPeriodoData('2026-10-01','2026-10-31')");assert.equal(d.ventas,120000);assert.equal(d.prevs,2000);assert.equal(await evalPage(q.sid,'_SUC_LOCK'),'norte');});
        await check(mode+': sin errores JavaScript',async()=>{assert.deepEqual(await evalPage(q.sid,'__errors'),[]);});await close(q);
    }
    for(const width of [1440,1080,390,320]){
        const v=await page(base,'owner',width);
        for(const theme of ['dark','light']){
            await evalPage(v.sid,"EtaaxTheme.set('"+theme+"');document.fonts.ready");await pause(200);
            await check(width+'px '+theme+': tarjetas, metas y seis conceptos sin desbordar',async()=>{
                const ui=await evalPage(v.sid,"({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:Array.from(document.querySelectorAll('[data-kpi]')).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}}),cols:getComputedStyle(document.getElementById('kpiOperativos')).gridTemplateColumns.split(' ').length})");assert.ok(ui.scroll<=width,JSON.stringify(ui));assert.ok(ui.cards.every(c=>c.left>=0&&c.right<=width));assert.equal(ui.cols,width>1200?4:width>640?2:1);
                await evalPage(v.sid,"document.getElementById('kpiMetasOperativas').open=true");assert.ok(await evalPage(v.sid,'document.documentElement.scrollWidth<=innerWidth'));await evalPage(v.sid,"document.getElementById('kpiMetasOperativas').open=false");
            });
            await shot(v,'kpis-'+width+'-'+theme);
            if(width===1440){const h=await evalPage(v.sid,'document.documentElement.scrollHeight');const full=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:h,scale:1}},v.sid);fs.writeFileSync(path.join(captures,'kpis-completo-'+theme+'.png'),Buffer.from(full.data,'base64'));}
            if(width===1440){await evalPage(v.sid,"document.getElementById('kpiOperativos').scrollIntoView({block:'start'});scrollBy(0,-90)");await shot(v,'kpis-tarjetas-'+width+'-'+theme);}
            await evalPage(v.sid,"document.querySelector('.kpi-vista-original').scrollIntoView({block:'start'})");await shot(v,'kpis-conceptos-'+width+'-'+theme);await evalPage(v.sid,'scrollTo(0,0)');
        }
        await check(width+'px: meta flotante visible y sin desbordar',async()=>{await evalPage(v.sid,"definirMetaIndicador('cocina')");const r=await evalPage(v.sid,"(()=>{const r=document.getElementById('metaIndicadorDialog').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()");assert.ok(r.left>=0&&r.right<=width&&r.top>=0&&r.bottom<=1000);await shot(v,'meta-cocina-'+width);await evalPage(v.sid,"document.getElementById('metaIndicadorCancelar').click()");});
        await check(width+'px: colores distinguen resultado y meta',async()=>{
            const colors=await evalPage(v.sid,"({actual:getComputedStyle(document.querySelector('.kpi-oper-relleno')).backgroundColor,meta:getComputedStyle(document.querySelector('.kpi-oper-marca')).backgroundColor})");assert.notEqual(colors.actual,colors.meta);assert.notEqual(colors.actual,'rgba(0, 0, 0, 0)');
        });await check(width+'px: sin errores JavaScript',async()=>{assert.deepEqual(await evalPage(v.sid,'__errors'),[]);});await close(v);
    }
    assert.equal(forbidden.length,0,'Intentó salir del origen local: '+forbidden.join(', '));
    console.log('Capturas: '+captures);
}
(async()=>{
    server=http.createServer((req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        if(name.startsWith('/__visual-fonts/') && process.env.KPI_FONTS){const file=path.join(process.env.KPI_FONTS,path.basename(name));if(fs.existsSync(file)){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'font/ttf');res.end(fs.readFileSync(file));return;}}
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
    console.log('KPIs: '+results.length+' casos, 0 fallas. Supabase simulado; sin llamadas de producción.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
    closing=true;
    try{if(socket?.readyState===WebSocket.OPEN)await send('Browser.close');}catch{}
    socket?.close();if(chrome&&chrome.exitCode===null)chrome.kill('SIGTERM');server?.close();
});
