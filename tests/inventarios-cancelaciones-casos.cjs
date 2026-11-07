'use strict';
const vm = require('node:vm');
const assert = require('node:assert/strict');
const plain = x => JSON.parse(JSON.stringify(x));
module.exports = function({test, eq, crearContexto, cargarJS, setVar}) {
    const C = crearContexto();
    ['etaax-core.js','security.js','insumo-label.js','recetas/inventarios.js'].forEach(f=>cargarJS(C,f));
    C._storage.etaax_negocio_activo='prueba';
    const ejecutar=s=>vm.runInContext(s,C);
    // Solo se sustituyen efectos externos. Matching, cálculos, reparto y HTML son reales.
    ejecutar('function _autoGuardar(){} function renderStepContent(){}');
    const receta=(id,nombre,ingredientes,tipo='bebidas')=>({id,nombre,ingredientes,tipo,status:'activa'});
    const ing=(insumoId,cantidad,unidad)=>({insumoId,cantidad,unidad});
    const recetas=[
        receta('negroni','Negroni',[ing('gin',45,'ML'),ing('campari',30,'ML')]),
        receta('abeja','Abeja Reina',[ing('gin',60,'ML')]),
        receta('limon','Limón Spritz',[ing('botellaMix',70,'ML'),ing('gin',45,'ML'),ing('soda',1,'PZA'),ing('azucar',20,'G')]),
        {...receta('srMix','Mix de limón',[ing('vodka',350,'ML'),ing('gin',350,'ML')],'sub-bebidas'),camposExtra:{rendimientoFinal:700,unidadRendimientoFinal:'ML'}},
        {...receta('srBotella','Botella de mix',[ing('mix',700,'ML')],'sub-bebidas'),camposExtra:{rendimientoFinal:700,unidadRendimientoFinal:'ML'}},
        {...receta('pausada','Receta pausada',[]),status:'inactiva'},
    ];
    const fila=(id,nombre,tipo='copa',extra={})=>({insumoId:id,nombre,tipo,categoria:tipo==='copa'?'Destilados':tipo==='pza'?'Refrescos':'Abarrotes',
        contNeto:750,copaML:60,existenciaAnterior:100,cerradasBarra:6,registrado:true,
        ventasCopasDirectas:0,ventasBotella:0,cortesiaCopas:0,mermaCopas:0,mermaBase:0,
        costoUnitario:240,precioCarta:120,entradas:[],...extra});
    const filas=[fila('gin','Ginebra Beefeater','copa',{copaML:45}),fila('campari','Campari','copa',{copaML:30}),
        fila('vodka',"Vodka American 2 · Sam's"),fila('appleton','Appleton Estate'),fila('kingston','Kingston White'),
        fila('vino','Vino Aglianico','copa',{copaML:150}),
        fila('beer','XX Lager Heineken','pza',{contNeto:355,copaML:0,existenciaAnterior:40}),
        fila('soda','Refresco Toronja','pza',{contNeto:355,copaML:0,existenciaAnterior:40}),
        fila('azucar','Azúcar blanca','peso',{contNeto:1000,copaML:0,baseUnit:'G',existenciaAnterior:1000,pesoTotal:700}),
        fila('mix','Mix de limón PR','copa',{contNeto:700,copaML:70,existenciaAnterior:20,cerradasBarra:1}),
        fila('botellaMix','Botella de mix PR','copa',{contNeto:700,copaML:70,existenciaAnterior:20,cerradasBarra:1})];
    function base(cancels=[],ventas={}) {
        C._storage.etaax_sucursal_activa='';
        setVar(C,'_cacheRecetasInv',plain(recetas));
        setVar(C,'_cacheInsumosInv',filas.map(f=>({id:f.insumoId,nombre:f.nombre,activo:'1',...(f.insumoId==='mix'?{esSubReceta:true,recetaId:'srMix'}:f.insumoId==='botellaMix'?{esSubReceta:true,recetaId:'srBotella'}:{})})));
        setVar(C,'filasCaptura',plain(filas));
        setVar(C,'invActual',{id:'invA',fecha:'2026-11-07',area:'barra',sucursalId:'norte',entradasLog:[],prebatchProducidos:{},cocktailsVendidos:ventas,ventasCompuesto:{},cancelaciones:plain(cancels),descuentos:[],filas:[]});
        ejecutar('_autoMatchFirma=""; _consumoDirty=true; _repCache=null;');
    }
    const f=id=>ejecutar('filasCaptura').find(x=>x.insumoId===id);
    const cancel=()=>ejecutar('invActual.cancelaciones');
    function cambiar(cancels) { ejecutar('invActual.cancelaciones='+JSON.stringify(cancels)+'; _autoMatchFirma="";'); }
    function medicion() {
        ejecutar('_repCache=_repartoPrebatch();');
        return plain({teoricos:ejecutar('filasCaptura.map(calcExistenciaTeorica)'),reparto:C._repartoPrebatch(),
            filas:C._step5TablasHTML(),
            galeria:C._step5GaleriaHTML('',{},[])});
    }
    test('el POS relaciona Negroni y Abeja Reina con recetas; la cerveza con su insumo',()=>{
        base();eq(C._matchCancelacion('NEGRONI').id,'negroni');eq(C._matchCancelacion('ABEJA REINA').id,'abeja');eq(C._matchCancelacion('XX LAGER').id,'beer');
        ejecutar('filasCaptura.push({insumoId:"homonimo",nombre:"Negroni",tipo:"copa"})');eq(C._matchCancelacion('NEGRONI').tipo,'receta');
    });
    test('sin semejanza no inventa match; subrecetas y recetas inactivas no son opciones de carta',()=>{
        base();eq(C._matchCancelacion('ZZZQWX'),null);eq(C._recetasCancelables().length,3);
    });
    test('una receta desactivada en la sucursal tampoco entra en el match',()=>{
        base();C._storage.etaax_sucursal_activa='norte';C._recetaActivaEnSuc=r=>r.id!=='negroni' && r.status!=='inactiva';
        eq(C._matchCancelacion('NEGRONI'),null);delete C._recetaActivaEnSuc;
    });
    test('TE sin match no se cuela en Estate ni White, ni en ningún insumo',()=>{
        base([{nombreProducto:'TE',cantidad:7}]);for(const row of filas)eq(C.getCancelacionesCopas(row.insumoId),0,row.nombre);
        eq(cancel()[0].insumoId,null);eq(cancel()[0].recetaId,null);
    });
    test('el match es excluyente al pasar de insumo a receta y viceversa',()=>{
        const c={insumoId:'gin'};C._aplicarMatchCancel(c,{tipo:'receta',id:'negroni',nombre:'Negroni'});eq(c.insumoId,null);eq(c.recetaId,'negroni');
        C._aplicarMatchCancel(c,{tipo:'insumo',id:'beer',nombre:'XX Lager'});eq(c.recetaId,null);eq(c.insumoId,'beer');
    });
    test('una cancelación directa solo aparece en el ID asociado y no baja el teórico',()=>{
        base([{nombreProducto:'XX LAGER',cantidad:3}]);eq(C.getCancelacionesCopas('beer'),3);eq(C.getCancelacionesCopas('gin'),0);eq(C.calcExistenciaTeorica(f('beer')),40);
    });
    test('la referencia directa se refresca al cambiar cantidad, abrir otro inventario y recargar',()=>{
        base([{nombreProducto:'XX LAGER',cantidad:1}]);eq(C.getCancelacionesCopas('beer'),1);
        cancel()[0].cantidad=3;eq(C.getCancelacionesCopas('beer'),3);
        setVar(C,'invActual',{id:'otro',cancelaciones:[]});eq(C.getCancelacionesCopas('beer'),0);
        cambiar([{nombreProducto:'XX LAGER',cantidad:2}]);eq(C.getCancelacionesCopas('beer'),2);
    });
    test('el auto-match de receta se estabiliza con cero pendientes',()=>{
        base([{nombreProducto:'NEGRONI',cantidad:2}]);C._autoMatchCancelaciones();const firma=ejecutar('_autoMatchFirma');
        C._autoMatchCancelaciones();eq(ejecutar('_autoMatchFirma'),firma);eq(/\|0$/.test(firma),true);
    });
    test('cancelar un cóctel deja idénticos los renglones y galería de todos sus insumos, incluso prebatch anidados',()=>{
        base([],{limon:2,negroni:4});const antes=medicion();
        cambiar([{nombreProducto:'LIMON SPRITZ',cantidad:9},{nombreProducto:'NEGRONI',cantidad:5}]);
        assert.deepEqual(medicion(),antes);eq(cancel()[0].recetaId,'limon');
        const rep=C._repartoPrebatch();eq(rep.porInsumo.vodka.vco>0,true,'el vodka sí recibe ventas a través del batch');
        eq(C.getCancelacionesCopas('vodka'),0);
    });
    test('cancelar directamente un prebatch no propaga la referencia a sus ingredientes',()=>{
        base();const antes=C._repartoPrebatch();cambiar([{nombreProducto:'Mix de limón PR',insumoId:'mix',cantidad:5,matchManual:true}]);
        assert.deepEqual(plain(C._repartoPrebatch()),plain(antes));eq(C.getCancelacionesCopas('mix'),5);eq(C.getCancelacionesCopas('vodka'),0);
    });
    for (const id of ['gin','vino','beer','soda','azucar']) test('cancelación directa no cambia existencia ni uso de '+id,()=>{
        base([],{limon:2,negroni:4});const row=f(id),antes=C.calcExistenciaTeorica(row),uso=C.consumoRecetasFila(row);
        cambiar([{nombreProducto:row.nombre,insumoId:id,cantidad:19,matchManual:true}]);
        eq(C.calcExistenciaTeorica(row),antes);eq(C.consumoRecetasFila(row),uso);eq(C.getCancelacionesCopas(id),19);
    });
    test('ventas, cortesías, mermas y producción siguen descontando sus cantidades reales',()=>{
        base([{nombreProducto:'NEGRONI',cantidad:20}],{negroni:4});eq(C.calcExistenciaTeorica(f('gin')),96);
        Object.assign(f('gin'),{ventasCopasDirectas:2,cortesiaCopas:1,mermaCopas:3});eq(C.calcExistenciaTeorica(f('gin')),90);
        f('azucar').mermaBase=25;eq(C.calcExistenciaTeorica(f('azucar')),975);
        ejecutar('invActual.prebatchProducidos={mix:2}');eq(C.calcExistenciaTeorica(f('vodka')),100-700/60);
    });
    // Observabilidad en el cuerpo REAL del reporte, después de todas sus sumas.
    // No se copian fórmulas ni se sustituyen los cálculos que se están probando.
    const originalReporte=C.verReporteDirectivo;
    const punto='    // Rankings y grupos';
    assert.ok(originalReporte.toString().includes(punto));
    const medirReporte=vm.runInContext('('+originalReporte.toString().replace(punto,
        'return {analisis,capitalCosto,capitalCarta,difTotal,vendidoCosto,faltCosto,sobrCosto,faltCarta,sobrCarta,netCosto,netCarta,conAlerta,conRiesgo,conOk};\n'+punto)+')',C);
    const financiero=()=>{const r=plain(medirReporte(false,'completo'));r.analisis.forEach(x=>delete x.cancel);return r;};
    test('reportes: consumo, porcentajes, capital, faltantes, sobrantes y totales no cambian por cancelaciones',()=>{
        base([],{limon:2,negroni:4});ejecutar('invActual.prebatchProducidos={mix:2}');
        const antes=financiero();cambiar([{nombreProducto:'LIMON SPRITZ',cantidad:11},{nombreProducto:'NEGRONI',cantidad:7},
            ...['vodka','gin','beer','soda','azucar'].map(id=>({nombreProducto:id,insumoId:id,cantidad:19,matchManual:true}))]);
        assert.deepEqual(financiero(),antes);
        const analisis=medirReporte(false,'completo').analisis;eq(analisis.find(a=>a.f.insumoId==='vodka').cancel,19,'solo las directas');
    });
    test('el informe impreso conserva el cóctel cancelado y el detalle POS original',()=>{
        base([{nombreProducto:'CREMOSO DE LIMON',cantidad:3,recetaId:'limon',recetaNombre:'Limón Spritz',motivo:'Mesa: T4',mesero:'Persona de prueba',matchManual:true}]);
        let html='';C.document.body.appendChild=n=>{html=n.innerHTML;};
        try{originalReporte(false,'completo');}catch(e){if(!html)throw e;}
        eq(html.includes('CREMOSO DE LIMON'),true);eq(html.includes('Mesa: T4'),true);eq(html.includes('Cancelaciones POS · informativo'),true);
        const tab=C._renderCancelacionesTab(cancel());eq(tab.includes('Limón Spritz'),true);eq(tab.includes('Buscar / cambiar match'),true);
    });
    test('Sin match explícito persiste después de guardar/recargar y Re-detectar automáticos',()=>{
        base([{nombreProducto:'NEGRONI',cantidad:2}]);C._autoMatchCancelaciones();C._setCancelInsumo(0,'');
        cambiar(plain(cancel()));C._autoMatchCancelaciones();C._reDetectarCancelaciones();
        eq(cancel()[0].recetaId,null);eq(cancel()[0].insumoId,null);eq(cancel()[0].matchManual,true);
    });
    test('un match manual se respeta; el botón automático permite volver a detectar',()=>{
        base([{nombreProducto:'NEGRONI',cantidad:2}]);C._setCancelInsumo(0,'beer');C._reDetectarCancelaciones();eq(cancel()[0].insumoId,'beer');
        ejecutar('_cancelMatchEdicion={inventario:invActual,cancelacion:invActual.cancelaciones[0]}');C._elegirCancelMatch('',true);
        eq(cancel()[0].recetaId,'negroni');eq(cancel()[0].matchManual,false);
    });
    test('rechaza IDs inexistentes y no cambia asociaciones al estar en solo lectura',()=>{
        base([{nombreProducto:'NEGRONI',cantidad:2}]);C._autoMatchCancelaciones();C._setCancelInsumo(0,'fantasma');eq(cancel()[0].recetaId,'negroni');
        C._setCancelInsumo(0,'r:srMix');eq(cancel()[0].recetaId,'negroni');C._soloVistaInv=true;C._setCancelInsumo(0,'');eq(cancel()[0].recetaId,'negroni');C._soloVistaInv=false;
    });
    test('un selector abierto de otro inventario no modifica el inventario nuevo',()=>{
        base([{nombreProducto:'NEGRONI',cantidad:2}]);ejecutar('_cancelMatchEdicion={inventario:invActual,cancelacion:invActual.cancelaciones[0]}');
        const nuevo={id:'nuevo',cancelaciones:[{nombreProducto:'XX LAGER',cantidad:8}]};setVar(C,'invActual',nuevo);C._elegirCancelMatch('gin');assert.deepEqual(plain(ejecutar('invActual')),nuevo);
    });
    test('el buscador ignora acentos, combina palabras y busca categoría o variedad',()=>{
        base();eq(C._opcionesCancelMatch('spritz limon')[0].valor,'r:limon');eq(C._opcionesCancelMatch('azucar')[0].valor,'azucar');
        eq(C._opcionesCancelMatch('vodka destilados')[0].valor,'vodka');eq(C._opcionesCancelMatch('ZZZQWX').length,0);
        eq(C._opcionesCancelMatch('').some(o=>o.valor==='r:pausada'||o.valor==='r:srMix'),false);
        eq(new Set(C._opcionesCancelMatch('').map(o=>o.grupo)).size,2);
    });
    test('las puertas de captura manual y tabla pegada conservan match a receta',()=>{
        base();C.document.getElementById('cancelProd').value='NEGRONI';C.document.getElementById('cancelCantidad').value='2';C.agregarCancelacionManual();eq(cancel()[0].recetaId,'negroni');
        C.document.getElementById('cancelPasteBody').rows=[{cells:['1','','ABEJA REINA','2','','',''].map(textContent=>({textContent}))}];C.confirmarTablaCancelaciones();eq(cancel()[1].recetaId,'abeja');
    });
    test('re-detectar corrige matches antiguos no marcados manualmente',()=>{
        base([{nombreProducto:'NEGRONI',insumoId:'beer',cantidad:2}]);C._reDetectarCancelaciones();eq(cancel()[0].recetaId,'negroni');eq(cancel()[0].insumoId,null);
    });
};

if (require.main === module) {
    const fs=require('node:fs');
    const pre=fs.readFileSync(require('node:path').join(__dirname,'money-tests.js'),'utf8').split('/* ═══════════════ SUITE A')[0].replace(/^#![^\n]*\n/,'');
    const h=new Function('require','__dirname',pre+'\nreturn {crearContexto,cargarJS,setVar};')(require,__dirname);
    let n=0;
    module.exports({...h,eq:(actual,esperado,mensaje)=>assert.equal(actual,esperado,mensaje),test:(nombre,fn)=>{fn();n++;console.log('OK '+nombre);}});
    console.log(n+' casos de cancelaciones aprobados');
}
