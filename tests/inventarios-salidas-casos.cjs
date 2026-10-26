'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=function({test,eq,crearContexto,cargarJS}){
    const c=crearContexto();cargarJS(c,'etaax-core.js');
    const src=fs.readFileSync(path.resolve(__dirname,'../recetas/inventarios.js'),'utf8');
    ['_camposSalida','_salidaBotellasCopas','_aporteBotellaAnterior','_salidaSuelta','_actualizarSalida','updVentasDirectas','_recomputarMovsQR','calcExistenciaTeorica','_filaConDatos','_comentarioVentaHTML','_umCampo','_capturaOZ','_copAUm','_umACop','updVentasUM'].forEach(n=>{
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
};
