'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
module.exports=function({test,eq,crearContexto,cargarJS,setVar}){
    const C=crearContexto();['etaax-core.js','security.js','insumo-label.js','recetas/inventarios.js'].forEach(f=>cargarJS(C,f));
    const run=s=>vm.runInContext(s,C),cerca=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,a+' != '+b);
    C._storage.etaax_negocio_activo='prueba';
    function preparar(copaA=45,copaB=45,tipo='copa'){
        const filas=[{insumoId:'a950',nombre:'Centenario 950',contNeto:950,copaML:copaA,metodoCaptura:'nivel',nivelPct:50,existenciaAnterior:475/copaA,ventasCopasDirectas:1},
            {insumoId:'b700',nombre:'Centenario 700',contNeto:700,copaML:copaB,cerradasBarra:1,existenciaAnterior:700/copaB}]
            .map(f=>({tipo,categoria:tipo==='copa'?'Destilados':'Cervezas',entradas:[],precioCarta:80,costoUnitario:250,cortesiaCopas:0,mermaCopas:0,...f}));
        setVar(C,'filasCaptura',filas);setVar(C,'_cacheInsumosInv',filas.map(f=>({id:f.insumoId,nombre:f.nombre,activo:'1'})));
        setVar(C,'_cacheRecetasInv',[]);setVar(C,'invActual',{id:'prueba',fecha:'2026-11-07',entradasLog:[],cancelaciones:[],prebatchProducidos:{},cocktailsVendidos:{},ventasCompuesto:{},descuentos:[]});
        const comp={id:'centenario',nombre:'Centenario Plata',miembros:['a950','b700']};C.localStorage.setItem(C._compuestosKey(),JSON.stringify([comp]));
        run('_consumoDirty=true; _repCache=null;');return {filas,comp};
    }
    const partes=(filas,cant)=>filas.map(fila=>({fila,cantidad:cant(fila)}));
    const fis=(filas)=>partes(filas,f=>C.calcExistencia(f));
    const dif=(filas)=>partes(filas,f=>C.calcDiferencia(f));
    const textos=h=>(h.match(/≈ [^<]+/g)||[]);
    test('compuesto 950/700: 1.5 botellas = 1175 ml; convierte por presentación antes de sumar',()=>{
        const {filas}=preparar(),e=C._equivBarraGrupo(fis(filas));
        cerca(e.botellas,1.5);cerca(e.ml,1175);cerca(e.onzas,1175/29.5735);cerca(e.copas,1175/45);
    });
    test('la fila agrupada y ambas presentaciones muestran existencia y diferencia',()=>{
        preparar();const html=C._step5TablasHTML(),lineas=textos(html);
        eq(lineas.length,6);
        for(const t of ['1.50 bot · 39.7 oz · 26.1 cp','0.50 bot · 16.1 oz · 10.6 cp','1.00 bot · 23.7 oz · 15.6 cp','+0.05 bot · +1.5 oz · +1.0 cp','0.00 bot · 0.0 oz · 0.0 cp']) eq(html.includes(t),true,t);
        eq(lineas.filter(t=>t.includes('+0.05 bot')).length,2,'total y presentación con diferencia');
    });
    test('copas de distinto tamaño mantienen su medida y no convierten todo con la primera',()=>{
        const {filas}=preparar(60,45),e=C._equivBarraGrupo(fis(filas));
        cerca(e.ml,1175);cerca(e.botellas,1.5);cerca(e.copas,475/60+700/45);
        eq(C._equivBarraGrupoHTML(fis(filas)).includes('1.50 bot · 39.7 oz · 23.5 cp'),true);
    });
    test('faltantes y sobrantes se suman con su signo en cada unidad, sin promediar capacidades',()=>{
        const {filas}=preparar(60,45),p=[{fila:filas[0],cantidad:2},{fila:filas[1],cantidad:-1}],e=C._equivBarraGrupo(p);
        cerca(e.copas,1);cerca(e.ml,75);cerca(e.botellas,120/950-45/700);
        eq(C._equivBarraGrupoHTML(p,{signo:true}).includes('+0.06 bot · +2.5 oz · +1.0 cp'),true);
    });
    test('copas netas cero no borra una diferencia de volumen cuando las copas son distintas',()=>{
        const {filas}=preparar(45,60),p=[{fila:filas[0],cantidad:1},{fila:filas[1],cantidad:-1}],e=C._equivBarraGrupo(p);
        eq(e.copas,0);eq(e.ml,-15);eq(C._equivBarraGrupoHTML(p,{signo:true}).includes('-0.5 oz · 0.0 cp'),true);
    });
    test('sumar no redondea a los miembros; la diferencia pequeña no imprime menos cero',()=>{
        const {filas}=preparar(),p=Array.from({length:6},()=>({fila:filas[0],cantidad:-0.00001})),e=C._equivBarraGrupo(p);
        cerca(e.copas,-0.00006);eq(C._equivBarraGrupoHTML(p,{signo:true}).includes('-0.00'),false);
    });
    test('sin contenido de una botella no inventa un total parcial de botellas; conserva litros/onzas',()=>{
        const {filas}=preparar(),p=fis(filas);p[0].fila={...p[0].fila,contNeto:0};const e=C._equivBarraGrupo(p);
        eq(e.botellas,null);cerca(e.ml,1175);eq(C._equivBarraGrupoHTML(p).includes(' L · 39.7 oz · 26.1 cp'),true);
        eq(C._equivBarraGrupoHTML(p).includes('Falta capturar'),true);
    });
    test('sin tamaño de copa no presenta litros ni onzas parciales como total',()=>{
        const {filas}=preparar(),p=fis(filas);p[0].fila={...p[0].fila,copaML:0};const e=C._equivBarraGrupo(p);
        eq(e.ml,null);eq(e.onzas,null);eq(e.botellas,null);eq(C._equivBarraGrupoHTML(p).includes('— bot · — oz'),true);
    });
    test('los compuestos de piezas, peso y mezclas no reciben onzas líquidas ficticias',()=>{
        const {filas}=preparar(),p=fis(filas);
        for(const tipo of ['pza','peso']){eq(C._equivBarraGrupo(p.map(x=>({...x,fila:{...x.fila,tipo}}))),null);eq(C._equivBarraGrupoHTML([{...p[0],fila:{...p[0].fila,tipo}},p[1]]),'');}
        eq(C._equivBarraGrupo([]),null);preparar(45,45,'pza');eq(textos(C._step5TablasHTML()).length,0);
    });
    test('la galería muestra el mismo desglose del total agrupado',()=>{
        const {comp}=preparar();const html=C._step5DesgloseCard(C._virtualFilaCompuesto(comp),{});
        eq(html.includes('1.50 bot · 39.7 oz · 26.1 cp'),true);eq(html.includes('+0.05 bot · +1.5 oz · +1.0 cp'),true);eq(textos(html).length,2);
    });
    test('el impreso incluye total y miembros con las mismas equivalencias, sin variables de tema',()=>{
        const {filas}=preparar();let html='';C.document.body.appendChild=n=>{html=n.innerHTML;};
        try{C.verReporteDirectivo(false,'desglose');}catch(e){if(!html)throw e;}
        const inicio=html.indexOf('<tr style="background:#faf7ff">'),fin=html.indexOf('</tr>',inicio),grupo=html.slice(inicio,fin);
        assert.ok(inicio>=0,'falta el compuesto en el impreso');
        eq(grupo.includes('1.50 bot · 39.7 oz · 26.1 cp'),true);eq(grupo.includes('+0.05 bot · +1.5 oz · +1.0 cp'),true);
        eq(html.includes('0.50 bot · 16.1 oz · 10.6 cp'),true);eq(html.includes('1.00 bot · 23.7 oz · 15.6 cp'),true);
        eq(/var\(--|cursor:help|title=/.test(C._equivBarraGrupoHTML(fis(filas),{impreso:true})),false);
    });
    test('añadir el desglose no altera captura, teórico, diferencia ni dinero',()=>{
        const {filas,comp}=preparar(),antes=JSON.stringify(run('invActual')),vf=C._virtualFilaCompuesto(comp);
        const dinero=filas.reduce((s,f)=>s+C.calcDiferencia(f)*f.precioCarta,0);
        cerca(C.calcDiferencia(vf),1);cerca(dinero,80);C._step5TablasHTML();C._step5DesgloseCard(vf,{});
        eq(JSON.stringify(run('invActual')),antes);cerca(filas.reduce((s,f)=>s+C.calcDiferencia(f)*f.precioCarta,0),dinero);
    });
};
if(require.main===module){
    const pre=fs.readFileSync(path.join(__dirname,'money-tests.js'),'utf8').split('/* ═══════════════ SUITE A')[0].replace(/^#![^\n]*\n/,'');
    const h=new Function('require','__dirname',pre+'\nreturn {crearContexto,cargarJS,setVar};')(require,__dirname);let n=0;
    module.exports({...h,eq:(a,b,m)=>assert.equal(a,b,m),test:(nombre,fn)=>{fn();n++;console.log('OK '+nombre);}});console.log(n+' casos aprobados');
}
