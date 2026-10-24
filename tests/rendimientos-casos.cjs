'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
module.exports = function({test,eq,crearContexto,cargarJS}) {
    const root = path.resolve(__dirname,'..'), c = crearContexto();
    cargarJS(c,'etaax-core.js'); cargarJS(c,'insumo-label.js');
    function cargar(file, ...nombres) {
        const s = fs.readFileSync(path.join(root,file),'utf8');
        nombres.forEach(n => {
            const a=s.indexOf('function '+n+'('); if(a<0)throw new Error(n);
            let i=s.indexOf('{',a), profundidad=0;
            for(;i<s.length;i++) {
                if(s[i]==='{')profundidad++;
                else if(s[i]==='}'&&!--profundidad)break;
            }
            vm.runInContext(s.slice(a,i+1),c,{filename:file+':'+n});
        });
    }
    const core=c.EtaaxCore, cx={rendimientoFinal:2,unidadRendimientoFinal:'KG'};
    const formas=[{id:'principal',nombre:'Grande',porcionesQty:2},{id:'mediano',nombre:'Mediano',porcionesQty:4},{id:'chico',nombre:'Chico',porcionesQty:8}];
    const pres=formas.map(r=>{
        const p=core.calcularPorcionSubReceta(cx,r,800);
        return {esRendimientoPorcion:true,rendimientoId:r.id,nombreRendimiento:r.nombre,
            contenidoPorcionBase:p.contenidoBase,unidadPorcionBase:p.unidadBase,costoUnitario:p.costo,
            precio:p.costo,contNeto:1,umContenido:'PZA',umCosto:'PZA',rendimiento:p.cantidad};
    });
    const ins={id:'produccion',esSubReceta:true,recetaId:'sr1',nombre:'Bizcocho',sucursales:['s1'],sucursalId:'s1',
        presentaciones:[{contNeto:2,umContenido:'KG',rendimiento:2000,umRendimiento:'G',costoUnitario:400,umCosto:'KG',precio:800},...pres]};
    c._insumoResolver=id=>id==='produccion'?ins:null;
    c.getCatalogoInsumos=()=>[ins]; c.etx=s=>String(s).replace(/[<>&"']/g,x=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[x]));
    cargar('app.js','getCostoParaUnidad','getFactor','getPesoBrutoPorUnidad','unidadIngredienteNombre','opcionesRendimientosIngrediente','datosPorcionesSub','tablaPorcionesSubReceta');
    cargar('recetas/inventarios.js','_normIngrediente','_costoIngrediente');
    console.log('\n══ Presentaciones de subreceta · una identidad y varias unidades ══');
    formas.forEach((r,i)=>{
        const peso=[1000,500,250][i], costo=[400,200,100][i];
        test(r.nombre+': peso y costo conservan la tanda completa',()=>{
            const p=core.calcularPorcionSubReceta(cx,r,800);
            eq(p.contenidoBase,peso);eq(p.costo,costo);eq(p.cantidad*p.costo,800);eq(p.cantidad*p.contenidoBase,2000);
        });
        test(r.nombre+': el escandallo usa el costo de su unidad',()=>eq(c.getCostoParaUnidad(ins,'RENDIMIENTO:'+r.id),costo));
        test(r.nombre+': el peso bruto usa la misma equivalencia',()=>eq(c.getPesoBrutoPorUnidad({insumoId:'produccion',unidad:'RENDIMIENTO:'+r.id}),peso));
        test(r.nombre+': inventario convierte dos porciones a gramos',()=>{
            const z=c._normIngrediente({insumoId:'produccion',cantidad:2,unidad:'RENDIMIENTO:'+r.id});eq(z.cant,2*peso);eq(z.unidad,'G');
        });
    });
    test('kilos y gramos conservan el costo por kilo común a las presentaciones',()=>{
        eq(c.getCostoParaUnidad(ins,'KG'),400);eq(c.getFactor(500,'G')*c.getCostoParaUnidad(ins,'G'),200);
    });
    test('PZA y PORCION antiguas siguen apuntando al primer rendimiento',()=>{
        eq(c.getCostoParaUnidad(ins,'PZA'),400);eq(c.getCostoParaUnidad(ins,'PORCION'),400);
        eq(c._normIngrediente({insumoId:'produccion',cantidad:1,unidad:'PZA'}).cant,1000);
    });
    test('el costo en la ficha de inventario usa gramos por porción, no la cantidad como gramos',()=>{
        c.filasCaptura=[{insumoId:'produccion',tipo:'peso',baseUnit:'G',contNeto:2000}];c.costoCopa=()=>.4;
        eq(c._costoIngrediente({insumoId:'produccion',unidad:'RENDIMIENTO:mediano',cantidad:2}),400);
    });
    test('la ficha de inventario también calcula porción si el insumo no está en la captura',()=>{
        c.filasCaptura=[];eq(c._costoIngrediente({insumoId:'produccion',unidad:'RENDIMIENTO:chico',cantidad:2}),200);
    });
    test('renombrar no cambia la referencia de la unidad',()=>{
        pres[1].nombreRendimiento='Mediano nuevo';eq(c.getCostoParaUnidad(ins,'RENDIMIENTO:mediano'),200);
        eq(c.unidadIngredienteNombre({insumoId:'produccion',unidad:'RENDIMIENTO:mediano'}),'Mediano nuevo');pres[1].nombreRendimiento='Mediano';
    });
    test('las opciones contienen nombres editables e IDs estables',()=>{
        const html=c.opcionesRendimientosIngrediente({insumoId:'produccion',unidad:'RENDIMIENTO:mediano'});
        eq(html.includes('value="RENDIMIENTO:mediano" selected>Mediano'),true);eq(html.includes('>Chico</option>'),true);
    });
    test('archivar oculta la opción nueva y conserva el cálculo en recetas que ya la usan',()=>{
        pres[2].inactiva=true;eq(c.opcionesRendimientosIngrediente({insumoId:'produccion',unidad:'G'}).includes('RENDIMIENTO:chico'),false);
        eq(c.opcionesRendimientosIngrediente({insumoId:'produccion',unidad:'RENDIMIENTO:chico'}).includes('RENDIMIENTO:chico'),true);
        eq(c.getCostoParaUnidad(ins,'RENDIMIENTO:chico'),100);delete pres[2].inactiva;
    });
    test('presentación desconocida no cae al costo o peso del lote entero',()=>{
        eq(c.getCostoParaUnidad(ins,'RENDIMIENTO:eliminada'),0);
        eq(c._normIngrediente({insumoId:'produccion',cantidad:1,unidad:'RENDIMIENTO:eliminada'}).cant,0);
    });
    test('un peso de 300 g cuesta su proporción exacta sin redondear a tandas o piezas completas',()=>{
        const p=core.calcularPorcionSubReceta(cx,{pesoPorcion:300,unidadPesoPorcion:'G'},800);
        eq(p.costo,120);eq(p.contenidoBase,300);eq(p.cantidad,2000/300);
    });
    test('líquidos: 2 L y 8 porciones descuentan 250 ml, con el mismo costo por litro',()=>{
        const p=core.calcularPorcionSubReceta({rendimientoFinal:2,unidadRendimientoFinal:'LT'},{porcionesQty:8},800);
        eq(p.contenidoBase,250);eq(p.unidadBase,'ML');eq(p.costo,100);
    });
    test('cambiar unidades del peso conserva la conversión',()=>{
        const p=core.calcularPorcionSubReceta(cx,{pesoPorcion:.5,unidadPesoPorcion:'KG'},800);
        eq(p.costo,200);eq(p.cantidad,4);eq(p.contenidoBase,500);
    });
    test('masa y volumen incompatibles no producen una conversión inventada',()=>eq(core.calcularPorcionSubReceta(cx,{pesoPorcion:250,unidadPesoPorcion:'ML'},800).valido,false));
    test('datos vacíos o negativos no generan una presentación válida',()=>{
        eq(core.calcularPorcionSubReceta(cx,{},800).valido,false);eq(core.calcularPorcionSubReceta(cx,{porcionesQty:-2},800).valido,false);
    });
    test('migración en lectura: el rendimiento actual pasa a principal con nombre editable',()=>{
        const r=core.rendimientosSubReceta({...cx,porcionesQty:9},'Bizcocho');eq(r[0].id,'principal');eq(r[0].nombre,'Bizcocho');eq(r[0].porcionesQty,9);
    });
    test('subreceta antigua: conserva el peso por porción desde el rendimiento total',()=>{
        const vieja=JSON.parse(JSON.stringify(ins));vieja.presentaciones=vieja.presentaciones.slice(0,2);delete vieja.presentaciones[1].esRendimientoPorcion;
        eq(core.porcionSubRecetaParaUnidad(vieja,'PZA').contenidoPorcionBase,1000);
    });
    test('costeo e impresión muestran todas las presentaciones',()=>{
        const html=c.tablaPorcionesSubReceta({nombre:'Bizcocho',camposExtra:{...cx,rendimientosPorcion:formas}},800,true);
        ['Grande','Mediano','Chico','$400.00','$200.00','$100.00'].forEach(t=>eq(html.includes(t),true));
    });
    test('el nombre de la presentación se escapa antes de pintar',()=>{
        pres[0].nombreRendimiento='<img src=x>';eq(c.opcionesRendimientosIngrediente({insumoId:'produccion',unidad:'G'}).includes('<img'),false);pres[0].nombreRendimiento='Grande';
    });

    // Ejecutar el conversor REAL, incluidos catálogo, tombstones y botón.
    cargarJS(c,'recetas/subreceta-rendimientos.js');
    cargar('recetas/index.html','_normNombreSR','_buscarInsumoSubReceta','_subRecetaYaEsInsumo','_actualizarBotonAgregarInsumo','_insumoDeSubReceta','_setChkIncluirInv','_areaDefaultSubReceta','agregarSubRecetaComoInsumo');
    let catalogo=[],serial='[]',contador=0;
    c.recetaActualId='sr1';c.recetaTipoActual='sub-alimentos';c.ingredientes=[{cantidad:1,unidad:'KG',costoPorKgLt:800}];
    c.costoUnitEfectivo=i=>i.costoPorKgLt;c.genId=()=>String(++contador);
    c.getNegocioActivo=()=> 'n1';c._sk=k=>'test_'+k;c._skGet=()=>serial;c._skPut=(_k,s)=>{serial=s;};
    c.setCatalogoInsumosMem=a=>{catalogo=a;};c.getCatalogoInsumos=()=>catalogo;
    c.localStorage.setItem('etaax_sucursal_activa','s1');c.document.getElementById('nombreReceta').value='Bizcocho';
    c.document.getElementById('rendimientoFinal').value=2;c.document.getElementById('unidadRendimientoFinal').value='KG';
    c.cargarRendimientosSub({...cx,rendimientosPorcion:formas},'Bizcocho');
    const boton={style:{}};c.document.querySelector=q=>q==='#cardAgregarInsumo button'?boton:null;
    test('convertir crea un único insumo con tres unidades de rendimiento',()=>{
        c.agregarSubRecetaComoInsumo();eq(catalogo.length,1);eq(catalogo[0].presentaciones.filter(p=>p.esRendimientoPorcion).length,3);
        eq(boton.disabled,true);eq(boton.textContent,'✓ Agregado a insumos');
    });
    test('volver a guardar actualiza los rendimientos y conserva el ID y metadatos de la ficha',()=>{
        const id=catalogo[0].id;catalogo[0].origenId='maestro';serial=JSON.stringify(catalogo);
        c.agregarSubRecetaComoInsumo(true);eq(catalogo.length,1);eq(catalogo[0].id,id);eq(catalogo[0].origenId,'maestro');
    });
    test('eliminar habilita el botón y el guardado silencioso no resucita el insumo',()=>{
        const id=catalogo[0].id;c.localStorage.setItem('test_ins_borrados',JSON.stringify({[id]:Date.now()}));
        c._actualizarBotonAgregarInsumo();eq(boton.disabled,false);
        c.agregarSubRecetaComoInsumo(true);eq(c._subRecetaYaEsInsumo(),false);
    });
    test('volver a agregar después de eliminar genera una identidad nueva',()=>{
        const id=catalogo[0].id;c.agregarSubRecetaComoInsumo();eq(catalogo.length,1);eq(catalogo[0].id===id,false);eq(boton.disabled,true);
    });
    test('una copia solo de otra sucursal no bloquea ni se comparte al agregar aquí',()=>{
        const id=catalogo[0].id;c.localStorage.setItem('etaax_sucursal_activa','s2');
        c._actualizarBotonAgregarInsumo();eq(boton.disabled,false);c.agregarSubRecetaComoInsumo();
        eq(catalogo.length,2);eq(catalogo[0].id,id);eq(catalogo[0].sucursales.length,1);eq(catalogo[1].sucursales[0],'s2');
    });
};
