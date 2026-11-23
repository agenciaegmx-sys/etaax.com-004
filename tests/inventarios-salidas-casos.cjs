'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=function({test,eq,crearContexto,cargarJS}){
    const c=crearContexto();cargarJS(c,'etaax-core.js');
    const src=fs.readFileSync(path.resolve(__dirname,'../recetas/inventarios.js'),'utf8');
    ['_camposSalida','_c2Copas','_c2Previo','updCortesia2','_cortPartes','_cortPartesJuntas','_s5CortCelda','_s5c2','_salidaBotellasCopas','_aporteBotellaAnterior','_salidaSuelta','_actualizarSalida','updVentasDirectas','_recomputarMovsQR','calcExistenciaTeorica','_filaConDatos','_comentarioVentaHTML','_umCampo','_capturaOZ','_copAUm','_umACop','updVentasUM'].forEach(n=>{
        const a=src.indexOf('function '+n+'(');let i=src.indexOf('{',a),d=0;
        if(a<0)throw Error(n);
        for(;i<src.length;i++){if(src[i]==='{')d++;else if(src[i]==='}'&&!--d)break;}
        vm.runInContext(src.slice(a,i+1),c,{filename:'inventarios.js:'+n});
    });
    const near=(a,b)=>eq(Math.abs(a-b)<1e-8,true,a+' ≠ '+b);
    c._autoGuardar=()=>{};c.invActual={sucursalId:'matriz'};c._sucActiva=()=> 'matriz';c._canonInsumoId=x=>x;c._enPeriodoInvActual=()=>true;
    c._CAMPO_UM={ventasCopasDirectas:'umCapVenta',cortesiaCopas:'umCapCortesia',mermaCopas:'umCapMerma'};c.OZ_ML=29.5735;
    c.etx=s=>String(s||'').replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]));
    ['_prodPrebatchUnidades','_consumoBaseProd','cancelRecetasFila','calcVentasCopasRecetas','calcVentasPzaRecetas','getCancelacionesCopas','getEntradasCopas'].forEach(k=>c[k]=()=>0);
    console.log('\n══ Inventarios · salidas por botella y comentarios ══');
    for(const [cont,copa] of [[700,45],[750,60],[750,150],[1750,60]]){
        test(cont+' ml / copa '+copa+': venta, cortesía y merma restan sus botellas UNA vez',()=>{
            const f={insumoId:'ron',tipo:'copa',contNeto:cont,copaML:copa,existenciaAnterior:10*cont/copa};c.filasCaptura=[f];c.getEntradasLog=()=>[];
            c.updVentasDirectas(0,'ventasBotella',1);c.updVentasDirectas(0,'cortesiaCopas',2);c.updVentasDirectas(0,'cortesiaBotella',1);c.updVentasDirectas(0,'mermaCopas',3);c.updVentasDirectas(0,'mermaBotella',2);
            near(c.calcExistenciaTeorica(f),6*cont/copa-5);near(c._salidaSuelta(f,'cortesiaCopas'),2);near(c._salidaSuelta(f,'mermaCopas'),3);
            for(let i=0;i<10;i++)c._recomputarMovsQR();near(c.calcExistenciaTeorica(f),6*cont/copa-5);
            c.filasCaptura=[JSON.parse(JSON.stringify(f))];c._recomputarMovsQR();near(c.calcExistenciaTeorica(c.filasCaptura[0]),6*cont/copa-5);
        });
    }
    for(const p of ['merma','cortesia']){
        test(p+': editar/borrar botellas o sueltos conserva QR y refleja cambios del QR',()=>{
            const campo=p+'Copas',k=c._camposSalida(campo),f={insumoId:'ron',tipo:'copa',contNeto:750,copaML:60};c.filasCaptura=[f];c.getEntradasLog=()=>[];
            c.updVentasDirectas(0,campo,2);c.updVentasDirectas(0,p+'Botella',2);
            let cantidad=1;c.getEntradasLog=()=>[{insumoId:'ron',sucursalId:'matriz',concepto:p==='merma'?'merma':'salida',unidad:'botella',cantidad}];
            c._recomputarMovsQR();near(f[campo],39.5);near(f[k.manual],2);
            c.updVentasDirectas(0,p+'Botella',1);near(f[campo],27);
            c.updVentasDirectas(0,campo,15.5);near(f[k.manual],3);near(f[campo],28);
            cantidad=2;c._recomputarMovsQR();near(f[campo],40.5);
            cantidad=0;c._recomputarMovsQR();near(f[campo],15.5);
            c.updVentasDirectas(0,p+'Botella',0);near(f[campo],3);
            c.updVentasDirectas(0,campo,0);near(f[campo],0);
        });
        test(p+': onzas se suman a botellas usando la medida del insumo',()=>{
            const f={tipo:'copa',contNeto:700,copaML:45,umCapCortesia:'OZ',umCapMerma:'OZ'};c.filasCaptura=[f];
            c.updVentasUM(0,p+'Copas',2);c.updVentasDirectas(0,p+'Botella',1);
            near(f[p+'Copas']*45,700+2*29.5735);near(c._copAUm(f,c._salidaSuelta(f,p+'Copas'),p+'Copas'),2);
        });
    }
    test('cambiar contenido/copa recalcula la botella sin convertirla en una salida manual duplicada',()=>{
        const f={tipo:'copa',contNeto:750,copaML:60};c.filasCaptura=[f];c.updVentasDirectas(0,'mermaCopas',2);c.updVentasDirectas(0,'mermaBotella',1);
        f.contNeto=1000;f.copaML=50;c._actualizarSalida(f,'mermaCopas',{});near(f.mermaCopas,22);near(f.mermaManual,2);
        c._actualizarSalida(f,'mermaCopas',{});near(f.mermaCopas,22);
    });
    test('filas antiguas sin botellas conservan sus cantidades, incluyendo QR ya importado',()=>{
        const f={insumoId:'ron',tipo:'copa',contNeto:750,copaML:60,mermaCopas:5};c.filasCaptura=[f];c.getEntradasLog=()=>[{insumoId:'ron',concepto:'merma',unidad:'copa',cantidad:2}];
        c._recomputarMovsQR();near(f.mermaCopas,5);near(f.mermaManual,3);near(c._salidaSuelta(f,'mermaCopas'),5);
    });
    test('cerveza por pieza mantiene merma/cortesía por pieza y no acepta botellas extra',()=>{
        const f={tipo:'pza',contNeto:355,existenciaAnterior:24};c.filasCaptura=[f];c.updVentasDirectas(0,'mermaCopas',2);c.updVentasDirectas(0,'cortesiaCopas',3);c.updVentasDirectas(0,'mermaBotella',1);
        near(c.calcExistenciaTeorica(f),19);eq(f.mermaBotella,undefined);
    });
    test('no inventa una conversión de botellas sin contenido o sin tamaño de copa',()=>{
        for(const f of [{tipo:'copa',contNeto:0,copaML:45},{tipo:'copa',contNeto:700,copaML:0}]){c.filasCaptura=[f];c.updVentasDirectas(0,'cortesiaBotella',2);eq(f.cortesiaBotella,undefined);}
    });
    test('comentarios y salidas borrados se persisten; HTML se escapa en pantalla y papel',()=>{
        const f={ventasComentario:'Mesa 4 <img src=x onerror=alert(1)> "evento"'};
        eq(c._filaConDatos(f),true);eq(c._filaConDatos({ventasComentario:''}),true);eq(c._filaConDatos({mermaBotella:0,mermaCopas:0}),true);eq(c._filaConDatos({}),false);
        for(const papel of [true,false]){const h=c._comentarioVentaHTML(f,papel);eq(h.includes('<img'),false);eq(h.includes('&lt;img'),true);eq(h.includes('&quot;evento&quot;'),true);}
    });
    /* ══ CORTESÍA EN DOS CONCEPTOS (Edwin, 23-nov) ══ 56 de cortesía y 6 de
       consumo interno en el mismo renglón. cortesiaCopas sigue siendo el TOTAL
       (lo que leen el teórico y los reportes); el segundo concepto es una parte
       de ese total que no se revuelve con el primero ni con el QR. */
    test('cortesía en dos conceptos: el total suma los dos y el teórico descuenta los dos',()=>{
        const f={insumoId:'ron',tipo:'copa',contNeto:750,copaML:50,existenciaAnterior:30};c.filasCaptura=[f];c.getEntradasLog=()=>[];
        c.updVentasDirectas(0,'cortesiaCopas',4);c.updCortesia2(0,'cortesia2Copas',2);c.updCortesia2(0,'cortesia2Botella',1);
        near(f.cortesiaCopas,4+2+15);near(c._salidaSuelta(f,'cortesiaCopas'),4);near(c.calcExistenciaTeorica(f),30-21);
        c.updVentasDirectas(0,'cortesiaCopas',6);near(f.cortesiaCopas,23);near(c._salidaSuelta(f,'cortesiaCopas'),6);
    });
    test('…el QR suma al primer concepto sin tocar el segundo, y repetir no duplica',()=>{
        const f={insumoId:'ron',tipo:'copa',contNeto:750,copaML:50};c.filasCaptura=[f];c.getEntradasLog=()=>[];
        c.updVentasDirectas(0,'cortesiaCopas',6);c.updCortesia2(0,'cortesia2Copas',2);c.updCortesia2(0,'cortesia2Botella',1);
        c.getEntradasLog=()=>[{insumoId:'ron',sucursalId:'matriz',concepto:'salida',unidad:'copa',cantidad:3}];
        for(let i=0;i<5;i++)c._recomputarMovsQR();
        near(f.cortesiaCopas,6+3+17);near(c._salidaSuelta(f,'cortesiaCopas'),9);
    });
    test('…cambiar contenido/copa recalcula las botellas del segundo concepto sin duplicarlas',()=>{
        const f={insumoId:'ron',tipo:'copa',contNeto:750,copaML:50};c.filasCaptura=[f];c.getEntradasLog=()=>[];
        c.updVentasDirectas(0,'cortesiaCopas',6);c.updCortesia2(0,'cortesia2Copas',2);c.updCortesia2(0,'cortesia2Botella',1);
        f.contNeto=1000;c._actualizarSalida(f,'cortesiaCopas',{});near(f.cortesiaCopas,6+2+20);
        c._actualizarSalida(f,'cortesiaCopas',{});near(f.cortesiaCopas,28);near(c._salidaSuelta(f,'cortesiaCopas'),6);
    });
    test('…quitar el segundo concepto deja solo el primero',()=>{
        const f={insumoId:'ron',tipo:'copa',contNeto:750,copaML:50};c.filasCaptura=[f];c.getEntradasLog=()=>[];
        c.updVentasDirectas(0,'cortesiaCopas',6);c.updCortesia2(0,'cortesia2Copas',2);
        c.updCortesia2(0,'cortesia2Copas','');near(f.cortesiaCopas,6);
    });
    test('…por pieza también (cerveza): 56 de cortesía y 6 de consumo interno',()=>{
        const f={insumoId:'cer',tipo:'pza',contNeto:355,existenciaAnterior:100};c.filasCaptura=[f];c.getEntradasLog=()=>[];
        c.updVentasDirectas(0,'cortesiaCopas',56);c.updCortesia2(0,'cortesia2Copas',6);c.updCortesia2(0,'cortesia2Botella',1);
        near(f.cortesiaCopas,62);near(c.calcExistenciaTeorica(f),38);eq(f.cortesia2Botella,undefined);
    });
    test('el Resultado enseña cada concepto con su cantidad en el lugar de las cortesías',()=>{
        const f={insumoId:'cer',tipo:'pza',contNeto:355,cortesiaConcepto:'Cortesía',cortesia2Concepto:'Consumo interno'};c.filasCaptura=[f];c.getEntradasLog=()=>[];
        c.updVentasDirectas(0,'cortesiaCopas',56);c.updCortesia2(0,'cortesia2Copas',6);
        const ps=c._cortPartes(f);eq(ps.map(p=>p.concepto+':'+p.copas).join(','),'Cortesía:56,Consumo interno:6');
        const h=c._s5CortCelda(ps,f.cortesiaCopas,x=>x+' pza').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
        // Sin el título fijo: cada concepto con su cantidad y abajo el total (23-nov, 2ª vuelta).
        eq(h,'Cortesía 56 pza Consumo interno 6 pza Total 62 pza');
    });
    test('…con un solo concepto, el concepto ES el título, con su cantidad (sin «Cortesías» fijo)',()=>{
        eq(c._s5CortCelda([{concepto:'Producción del restaurante',copas:3}],3,x=>x+' cop').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),'Producción del restaurante 3 cop');
        eq(c._s5CortCelda([],0,x=>x).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),'Cortesías —');
        eq(/&lt;b&gt;/.test(c._s5CortCelda([{concepto:'<b>',copas:1}],1,x=>x)),true);
    });
    test('…y en un compuesto, los conceptos de sus presentaciones se juntan por nombre',()=>{
        const a={tipo:'pza',cortesiaCopas:4,cortesiaConcepto:'Cortesía'},b={tipo:'pza',cortesiaCopas:5,_c2Previo:2,cortesia2Copas:2,cortesiaConcepto:'cortesía',cortesia2Concepto:'Consumo interno'};
        eq(c._cortPartesJuntas([a,b]).map(p=>p.concepto+':'+p.copas).join(','),'Cortesía:7,Consumo interno:2');
    });
    test('el QR ya no le pisa a la cortesía el concepto elegido a mano',()=>{
        const f={insumoId:'ron',tipo:'copa',contNeto:750,copaML:50,cortesiaConcepto:'Consumo interno'};c.filasCaptura=[f];
        c.getEntradasLog=()=>[{insumoId:'ron',sucursalId:'matriz',concepto:'salida',unidad:'copa',cantidad:1,notas:'VIP'}];
        c._recomputarMovsQR();eq(f.cortesiaConcepto,'Consumo interno');
        const g={insumoId:'ron',tipo:'copa',contNeto:750,copaML:50};c.filasCaptura=[g];c._recomputarMovsQR();eq(g.cortesiaConcepto,'🎁 Cortesía: VIP');
        c.getEntradasLog=()=>[{insumoId:'ron',sucursalId:'matriz',concepto:'salida',unidad:'copa',cantidad:2,notas:'Cumple'}];
        c._recomputarMovsQR();eq(g.cortesiaConcepto,'🎁 Cortesía: Cumple');
    });
};
