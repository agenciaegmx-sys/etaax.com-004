'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
module.exports=function({test,eq,crearContexto,cargarJS}){
    const c=crearContexto(), root=path.resolve(__dirname,'..');cargarJS(c,'etaax-core.js');cargarJS(c,'insumo-label.js');
    function cargar(file,nombres){
        const s=fs.readFileSync(path.join(root,file),'utf8');
        nombres.forEach(n=>{
            const a=s.indexOf('function '+n+'(');if(a<0)throw Error(n);
            let i=s.indexOf('{',a),d=0;
            for(;i<s.length;i++){if(s[i]==='{')d++;else if(s[i]==='}'&&!--d)break;}
            vm.runInContext(s.slice(a,i+1),c,{filename:file+':'+n});
        });
    }
    cargar('recetas/inventarios.js',['calcNetLiters','calcMLReales','calcExistencia','calcExistenciaBot','fmtLt','fmtBot','_liquidoAbiertoHTML','_parametrosStockFila','_stockDeFila','_stockHTML','_stockFilaHTML','_stockReporteHTML','_costoCompraStock','_rowsDeInventario','_fusionarRows','refreshFilaDisplay']);
    c.etx=s=>String(s==null?'':s).replace(/[<>&"]/g,x=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[x]));
    const core=c.EtaaxCore, estado=(q,min,max)=>core.estadoStockInventario(q,min,max).estado;
    const f={insumoId:'vodka',nombre:'Vodka',tipo:'copa',contNeto:1750,copaML:60,pesoCristal:1100,pesos:[2.052],cerradasBarra:5};
    console.log('\n══ Inventarios · líquido abierto, stock y costeo impreso ══');
    test('952 ml abiertos equivalen a 15.866667 copas de 60 ml y 32.191 oz',()=>{
        const e=core.equivalenciasLiquidoInventario(c.calcMLReales(f),60);
        eq(Math.abs(e.ml-952)<1e-8,true);eq(Math.abs(e.copas-952/60)<1e-8,true);eq(Math.abs(e.onzas-952/29.5735)<1e-8,true);
    });
    test('las botellas cerradas no alteran las equivalencias del líquido abierto',()=>eq(c._liquidoAbiertoHTML(f),c._liquidoAbiertoHTML({...f,cerradasBarra:100,cerradasBodega:80})));
    test('la copa de vino usa su medida propia; sin copa no inventa una de 60 ml',()=>{
        eq(core.equivalenciasLiquidoInventario(450,150).copas,3);eq(core.equivalenciasLiquidoInventario(450,0).copas,null);
        eq(c._liquidoAbiertoHTML({...f,copaML:0}).includes('copas'),false);
    });
    test('captura por nivel usa el mismo neto y convierte onzas sin truncar',()=>{
        const e=core.equivalenciasLiquidoInventario(c.calcMLReales({...f,metodoCaptura:'nivel',nivelPct:50}),60);eq(e.ml,875);eq(e.copas,875/60);
        eq(core.equivalenciasLiquidoInventario(-12,60).ml,0);
    });
    test('al modificar el peso se refrescan las tres cifras visibles',()=>{
        c.filasCaptura=[f];c._regBtnState=()=>({txt:'Registrar'});c.refreshFilaDisplay(0);
        const html=c.document.getElementById('ml-0').innerHTML;eq(html.includes('0.952'),true);eq(html.includes('15.87 copas'),true);eq(html.includes('32.19 oz'),true);
    });
    test('bajo incluye el mínimo y cero; ideal incluye el máximo; entre ambos es intermedio',()=>{
        eq(estado(0,2,6),'bajo');eq(estado(2,2,6),'bajo');eq(estado(4,2,6),'intermedio');eq(estado(6,2,6),'ideal');eq(estado(8,2,6),'ideal');
    });
    test('cero como mínimo se respeta; sin límites no fabrica una alerta',()=>{
        eq(estado(0,0,6),'bajo');eq(estado(1,0,6),'intermedio');eq(estado(0,'',''),'sin-parametros');eq(estado(0,0,0),'sin-parametros');
    });
    test('mínimo sin máximo avisa bajo, pero no inventa un stock ideal',()=>{eq(estado(1,2,''),'bajo');eq(estado(8,2,''),'intermedio');});
    test('parámetros invertidos, negativos o ilegibles se señalan',()=>{
        eq(estado(4,6,2),'revisar');eq(estado(4,-1,2),'revisar');eq(estado(4,'abc',6),'revisar');eq(estado(null,2,6),'sin-equivalencia');
    });
    test('stock de copa se compara en botellas, no en número de copas',()=>eq(core.unidadesCompraInventario(25,{tipo:'copa',copaML:60,contNeto:750}),2));
    for(const [nombre,fila,q,esperado] of [
        ['cerveza',{tipo:'pza',contNeto:355},24,24],['refresco',{tipo:'pza',contNeto:600},12,12],
        ['abarrote drenado',{tipo:'peso',baseUnit:'G',contNeto:900},1800,2],
        ['fruta',{tipo:'peso',baseUnit:'G',contNeto:1000},3500,3.5],
        ['alimento líquido',{tipo:'peso',baseUnit:'ML',contNeto:2000},3000,1.5],
        ['alimento por pieza',{tipo:'peso',baseUnit:'PZA'},7,7],
        ['producción propia',{tipo:'peso',baseUnit:'G',contNeto:2000},1000,0.5]]){
        test('stock de '+nombre+' conserva la unidad de compra',()=>eq(core.unidadesCompraInventario(q,fila),esperado));
    }
    test('sin contenido medible no presenta gramos como si fueran paquetes',()=>eq(core.unidadesCompraInventario(500,{tipo:'peso',baseUnit:'G',contNeto:0}),null));
    c.invActual={sucursalId:'norte'};
    c._insumoResolver=(_id,suc)=>suc==='norte'?{stockMin:9,presentaciones:[{stockMin:0,stockMax:6}]}:{presentaciones:[{stockMin:4,stockMax:10}]};
    test('cada sucursal lee su referencia y cero gana al valor viejo',()=>{
        const n=c._stockDeFila(f,25,'norte'),m=c._stockDeFila(f,25,'matriz');eq(n.minimo,0);eq(n.maximo,6);eq(m.minimo,4);eq(m.maximo,10);
    });
    test('una captura vacía no es un agotado; registrar en cero sí activa la alerta',()=>{
        const vacia={insumoId:'vodka',tipo:'copa',contNeto:750,copaML:60,pesos:['','','',''],cerradasBarra:'',cerradasBodega:''};
        eq(c._stockDeFila(vacia,0,'norte').estado,'sin-conteo');
        eq(c._stockDeFila({...vacia,registrado:true},0,'norte').estado,'bajo');
        eq(c._stockDeFila({...vacia,cerradasBarra:0},0,'norte').estado,'bajo');
    });
    test('si desaparece el catálogo conserva ambos límites del inventario',()=>{
        const prev=c._insumoResolver;c._insumoResolver=()=>null;
        const s=c._stockDeFila({...f,stockMin:1,stockMax:4},0);eq(s.minimo,1);eq(s.maximo,4);eq(s.estado,'bajo');c._insumoResolver=prev;
    });
    test('el capital ideal de un paquete de 900 g no usa el precio de un gramo',()=>{
        c.costoCopa=()=>0.05;eq(c._costoCompraStock({tipo:'peso',baseUnit:'G',contNeto:900}),45);
        c.costoCopa=()=>24;eq(c._costoCompraStock({tipo:'copa',copaML:60,contNeto:750}),300);
    });
    test('el reporte conserva productos agotados y sus alertas',()=>{
        c.getInsumos=()=>[];c._filasUnicasInventario=rows=>rows;c._filaLive=x=>x;c._existenciaArea=()=>0;c._grupoCategoria=()=> 'Bebidas';c.costoCopa=()=>24;
        const rows=c._rowsDeInventario({sucursalId:'norte',filas:[{...f,pesos:[],cerradasBarra:0,registrado:true}]});
        eq(rows.length,1);eq(rows[0].total,0);eq(rows[0].stock.estado,'bajo');eq(rows[0].stock.maximo,6);
    });
    test('los compuestos conservan la alerta de cada insumo al fusionarse',()=>{
        c.getCompuestos=()=>[{id:'comp',nombre:'Variantes',miembros:['a','b']}];c._midCanon=x=>x;
        const row=id=>({insumoId:id,nombre:id,tipo:'pza',total:0,barra:0,bodega:0,capital:0,capBarra:0,capBodega:0,stock:{estado:'bajo',minimo:2,maximo:6,actual:0,unidad:'pza'}});
        const r=c._fusionarRows([row('a'),row('b')]);eq(r.length,1);eq(r[0].stockMiembros.length,2);eq((c._stockReporteHTML(r[0],true).match(/Stock bajo/g)||[]).length,2);
    });
    // Impreso real: comprobar valores, variedad y dos renglones sin duplicar fórmulas.
    cargar('recetas/insumos.js',['_costoPorMLp','_mezBotDatos','_costeoCopaDatos','_costeoPiezaDatos','_refrescoCostoPorPieza','calcCostoCopa','toML','_grupoIns','_agruparPDF','_filaGrupoPDF','_presTxtPDF','_imprimirCosteoPDF']);
    c.OZ_ML=29.5735;c.COPA_ML=60;c._CSS_TABLA_PDF='';c._notaAlcance=()=>'';c._optsReporteIns=()=>({});c._abrirHorizontal=html=>{c.impreso=html;};c.etaaxReporteDoc=o=>o.cuerpo;c.fmtMXN=v=>'$'+Number(v).toFixed(2);c._subUnidadNombre=()=>'';
    const soda={id:'soda',nombre:'Soda',variedad:'Natural',tipoInsumo:'refresco',presentaciones:[{contNeto:600,umContenido:'ML',precio:10,costoPieza:10,costoUnitario:10/0.6,factorPieza:2,precioCarta:25}]};
    const ron={id:'ron',nombre:'Ron',variedad:'Añejo <script>',tipoInsumo:'destilado',subcategoria:'Ron',presentaciones:[{contNeto:750,umContenido:'ML',costoUnitario:400,umCosto:'LT',tamanoCopa:60,umTamanoCopa:'ML',factorCopa:3.3,precioCarta:150,factorBotella:2.5,precioCartaBot:1000,mezcladorId:'soda',mezcladores:2,mezcladoresBot:5}]};
    c.getInsumos=()=>[ron,soda];c._imprimirCosteoPDF([ron,soda]);
    test('costeo impreso incluye variedad escapada de bebidas y de cervezas/refrescos',()=>{
        eq(c.impreso.includes('Añejo &lt;script&gt;'),true);eq(c.impreso.includes('Natural'),true);eq(c.impreso.includes('<script>'),false);
    });
    test('costeo impreso separa copa y botella y conserva el precio con servicio',()=>{
        eq((c.impreso.match(/class="costeo-par"/g)||[]).length,2);eq((c.impreso.match(/rowspan="2" class="w ind"/g)||[]).length,2);
        ['Por copa','Por botella','$24.00','$300.00','$99.20','$800.00','Sin servicio: $750.00','$50.00'].forEach(t=>eq(c.impreso.includes(t),true,t));
    });


    /* ══ EQUIVALENCIAS EN EL RENGLÓN DE VERDAD ═══════════════════════════════
       La conversión ya tiene sus pruebas en BE22 del candado. Lo que falta
       comprobar —y es la trampa que más se repite en este proyecto— es que el
       RENGLÓN la use: un motor correcto que la pantalla no llama se ve igual de
       verde. Así que se corre `_rowCopa`, el constructor real de la fila de
       barra, y se lee lo que deja en el HTML. */
    cargar('recetas/inventarios.js',['_equivBarra','_nEquiv','_equivBarraHTML','_fmtBase','_fmtCop','_fmtCopSgn','_fmtContenido','_rowCopa','_pctVarianza','_usoTotal','_medidaInsumo','_fmtEquivalenteBatch']);
    /* Lo que la fila pide del resto del módulo y no es asunto de esta prueba.
       Todo en cero para que los números que se afirman abajo sean los del
       fixture y no el resultado de otra cosa. */
    Object.assign(c, {
        _repartoDe:()=>({ea:0,ent:0,vco:0,cm:0,can:0,teo:0,fis:0}),
        getEntradasBottles:()=>0, getEntradasCopas:()=>0, getCancelacionesCopas:()=>0,
        consumoRecetasFila:()=>0, _prodPBVisible:()=>0, _consumoBaseProd:()=>0,
        _stockFilaHTML:()=>'', _comentarioVentaHTML:()=>'', _dentroBat:()=>'',
        _tituloCoct:()=>'', _lineaProd:()=>'', _unidadCompra:()=>'bot',
        esBateo:()=>false, _btnNotaInsumo:()=>'', _btnOcultoImpreso:()=>'',
        _nb:v=>String(v), toggleBateo:()=>{}, insumoTitulo:x=>x.nombre||'',
    });
    /* Botella de 750 con copa de 60: 25 copas de físico y un faltante de 350 ml
       (−5.8333 copas). Son los ejemplos de la factura. */
    const fcopa={insumoId:'ron1',nombre:'Ron',tipo:'copa',contNeto:750,copaML:60,
        existenciaAnterior:0,ventasBotella:0,ventasCopasDirectas:0,cortesiaCopas:0,
        mermaCopas:0,precioCarta:0,entradas:[]};
    c.calcExistencia=()=>25;                       // 25 copas = 1,500 ml
    c.calcExistenciaTeorica=()=>25+350/60;         // falta 350 ml contra el teórico
    c.window=c; const fila=c._rowCopa(fcopa);
    test('el renglón de barra dice a cuántas botellas, onzas y copas equivale lo que hay',()=>{
        eq(fila.html.includes('2.00 bot · 50.7 oz · 25.0 cp'),true,
            'el físico no trae su equivalencia: '+(fila.html.match(/≈[^<]*/g)||[]).join(' // '));
    });
    test('…y la diferencia conserva el signo en las tres lecturas',()=>{
        eq(fila.html.includes('-0.47 bot · -11.8 oz · -5.8 cp'),true,
            'la diferencia no trae su equivalencia con signo: '+(fila.html.match(/≈[^<]*/g)||[]).join(' // '));
    });
    test('…y las dos equivalencias van en el renglón, una por cifra',()=>
        eq((fila.html.match(/≈ /g)||[]).length,2,'van '+(fila.html.match(/≈ /g)||[]).length));
    /* Un sobrante no puede salir con el signo de un faltante. */
    test('un sobrante sale en positivo',()=>{
        c.calcExistenciaTeorica=()=>25-350/60;
        const r=c._rowCopa(fcopa);
        return eq(r.html.includes('+0.47 bot · +11.8 oz · +5.8 cp'),true,
            (r.html.match(/≈[^<]*/g)||[]).join(' // '));
    });
    /* `−0.00 bot` se lee como un error del sistema, no como «cuadró». */
    test('un faltante diminuto no sale como −0.00',()=>{
        c.calcExistenciaTeorica=()=>25+0.0001;
        const r=c._rowCopa(fcopa);
        eq(r.html.includes('-0.00'),false,'salió el menos cero');
        return eq(r.html.includes('0.00 bot'),true,'y sí dice que cuadró');
    });
    /* Sin referencia no se inventa: se dice qué falta capturar. */
    /* Sin contenido de botella capturado no hay botellas que decir — pero los
       LITROS sí se saben, y «1.5 L» ayuda donde «— bot» no ayuda a nadie. */
    test('sin contenido de botella lo dice en litros, no con un guion',()=>{
        c.calcExistencia=()=>25;c.calcExistenciaTeorica=()=>25;
        const r=c._rowCopa({...fcopa,contNeto:0});
        eq(r.html.includes('1.50 L'),true,'no dijo los litros: '+(r.html.match(/≈[^<]*/g)||[]).join(' // '));
        return eq(r.html.includes('— bot'),false,'dejó el guion pudiendo decir litros');
    });
    /* Y si NO hay ni tamaño de copa, no hay mililitros: ahí sí no se sabe nada
       y lo que toca es decir qué falta capturar. */
    test('sin tamaño de copa no se inventa nada y dice qué falta',()=>{
        const r=c._rowCopa({...fcopa,copaML:0});
        eq(r.html.includes('— bot'),true,'inventó botellas sin saber la copa');
        eq(r.html.includes('— oz'),true,'inventó onzas sin saber la copa');
        return eq(r.html.includes('Falta capturar'),true,'no dijo qué falta');
    });
    test('y un abarrote por peso no recibe onzas líquidas',()=>
        eq(c._equivBarra(5,{tipo:'peso',contNeto:1000,baseUnit:'G'}),null,'nada de onzas'));
    test('ni una cerveza por pieza recibe copas',()=>
        eq(c._equivBarra(5,{tipo:'pza',contNeto:355}),null,'nada de copas'));
    /* El impreso se lleva al anaquel: ahí no hay tema, ni se puede pasar el
       ratón por encima. Si la línea viaja con variables de CSS, en papel sale
       de un color que no se ve o de ninguno. */
    test('la versión impresa no depende del tema ni de pasar el ratón',()=>{
        const h=c._equivBarraHTML(25,fcopa,{impreso:true});
        eq(h.includes('2.00 bot · 50.7 oz · 25.0 cp'),true,'dice lo mismo');
        eq(/var\(--/.test(h),false,'se llevó una variable de tema al papel');
        return eq(/cursor:help|title=/.test(h),false,'puso ayuda de ratón en el papel');
    });
    /* EL DESGLOSE IMPRESO lo pidió Edwin: se lleva al anaquel para contar, así
       que ahí «−23.3 cop» tampoco sirve. Correr `verReporteDirectivo` entero
       pediría media pantalla de dobles; lo que se vigila es que sus dos
       columnas de cantidad —lo que hay y la varianza— pidan la línea en
       versión de papel, incluidos los miembros de un compuesto. */
    test('el desglose impreso pide la equivalencia en sus dos cantidades',()=>{
        const src=fs.readFileSync(path.join(root,'recetas/inventarios.js'),'utf8');
        const a=src.indexOf('function verReporteDirectivo(');
        const cuerpo=src.slice(a,src.indexOf('\nfunction ',a+10));
        eq(/_equivBarraHTML\(a\.fisico, a\.f, \{impreso:true\}\)/.test(cuerpo),true,'falta en lo que hay');
        eq(/_equivBarraHTML\(a\.dif, a\.f, \{signo:true, impreso:true\}\)/.test(cuerpo),true,'falta en la varianza');
        eq(/_equivBarraHTML\(m\.fisico, m\.f/.test(cuerpo),true,'falta en los miembros de un compuesto');
        return eq(/_equivBarraHTML\(m\.dif, m\.f/.test(cuerpo),true,'falta en la varianza de los miembros');
    });
    /* Complemento, no sustituto: que el reporte impreso de existencias siga
       pidiendo la versión de papel. Correr ese reporte entero aquí pediría
       media pantalla de dobles; las pruebas de arriba cubren la conversión y
       el formato, y esto vigila que no se desconecte. */
    test('el reporte impreso de existencias pide la línea en versión de papel',()=>{
        const src=fs.readFileSync(path.join(root,'recetas/inventarios.js'),'utf8');
        const a=src.indexOf('function imprimirReporteExistencias(');
        const cuerpo=src.slice(a,src.indexOf('\nfunction ',a+10));
        return eq(/_equivBarraHTML\(r\.total, r, \{impreso:true\}\)/.test(cuerpo),true,'lo pide');
    });

    /* ══ UN COMPUESTO NO TIENE UN TAMAÑO DE COPA ═════════════════════════════
       Un compuesto agrupa presentaciones distintas —la de 750 con copa de 60 y
       la de 1,750 con copa de 45—. Convertir su total con el envase del PRIMER
       miembro insinuaría un tamaño único y daría un número falso. La fila
       fusionada no trae referencia a propósito, así que no hay equivalencia que
       inventar; lo que sí tiene que cuadrar es su total, que se suma pasando
       cada miembro por SU envase antes de agregar. */
    c.getCompuestos=()=>[{id:'cmp1',nombre:'Ron de la casa',miembros:['r750','r1750']}];
    c._midCanon=x=>x;
    const miembros=[
        {insumoId:'r750', nombre:'Ron 750', tipo:'copa',contNeto:750, copaML:60,barra:12.5,bodega:0,total:12.5,capBarra:0,capBodega:0,capital:100,fecha:'2026-10-01'},
        {insumoId:'r1750',nombre:'Ron 1750',tipo:'copa',contNeto:1750,copaML:45,barra:0,bodega:38.88888888888889,total:38.88888888888889,capBarra:0,capBodega:0,capital:200,fecha:'2026-10-02'},
    ];
    const fus=c._fusionarRows(miembros.map(x=>({...x})));
    test('el compuesto suma pasando cada miembro por SU envase',()=>{
        eq(fus.length,1,'no fusionó');
        /* 12.5 copas de 60 en botella de 750 = 1 botella.
           38.888… copas de 45 en botella de 1,750 = 1 botella. Total: 2. */
        return eq(Math.abs(fus[0].total-2)<1e-9,true,'dio '+fus[0].total+' en vez de 2');
    });
    test('…y no se le inventa una equivalencia con el envase de uno de ellos',()=>
        eq(c._equivBarra(fus[0].total,fus[0]),null,'se inventó una copa que no existe'));

    /* ══ UNA CAPTURA DEL QR QUE SE CORRIGIÓ DESPUÉS ══════════════════════════
       Desde la v82 el colaborador puede corregir lo que mandó. El log global
       sube de versión, pero el inventario calcula con SU copia: si no se
       reconcilia, el log dice 8 y el inventario sigue diciendo 10, y el que
       corrigió cree que ya quedó. Lo que no se puede hacer es agregar otra
       entrada de 8 — eso contaría doble, que es justo lo que el editor vino a
       evitar. */
    cargar('recetas/inventarios.js',['_reconciliarEntradaEnInv']);
    const entrada=(ver,cant)=>({id:'e1',insumoId:'ron1',nombre:'Ron',concepto:'compra',
        cantidad:cant,unidad:'pza',fecha:'2026-10-20',registrado:'2026-10-20T19:00:00Z',ver:ver});
    test('corregir una entrada ya importada la actualiza EN SU SITIO',()=>{
        c.invActual={entradasLog:[Object.assign(entrada(1,10),{importadoEnInv:'inv1'})]};
        const cambio=c._reconciliarEntradaEnInv(entrada(2,8));
        eq(cambio,true,'no vio el cambio');
        eq(c.invActual.entradasLog.length,1,'agregó otra entrada: contaría doble');
        eq(Number(c.invActual.entradasLog[0].cantidad),8,'quedó en la cantidad vieja');
        return eq(Number(c.invActual.entradasLog[0].ver),2,'no subió de versión');
    });
    test('…sin pisar las marcas que el ERP le puso a su copia',()=>{
        c.invActual={entradasLog:[Object.assign(entrada(1,10),{importadoEnInv:'inv1',_qrBase:3})]};
        c._reconciliarEntradaEnInv(entrada(2,8));
        const le=c.invActual.entradasLog[0];
        eq(le.importadoEnInv,'inv1','se llevó la marca de importación');
        return eq(Number(le._qrBase),3,'se llevó el rastro del ERP');
    });
    /* Y al contrario: una recarga normal no puede deshacer lo que ya está. */
    test('la misma versión no toca nada',()=>{
        c.invActual={entradasLog:[entrada(2,8)]};
        eq(c._reconciliarEntradaEnInv(entrada(2,99)),false,'se dejó pisar');
        return eq(Number(c.invActual.entradasLog[0].cantidad),8,'cambió la cantidad');
    });
    test('una versión más vieja de la nube no degrada la copia',()=>{
        c.invActual={entradasLog:[entrada(3,8)]};
        eq(c._reconciliarEntradaEnInv(entrada(2,10)),false,'aceptó ir hacia atrás');
        return eq(Number(c.invActual.entradasLog[0].cantidad),8,'la degradó');
    });
    test('una entrada que no está en este inventario no se inventa',()=>{
        c.invActual={entradasLog:[]};
        eq(c._reconciliarEntradaEnInv(entrada(2,8)),false,'dijo que reconcilió algo');
        return eq(c.invActual.entradasLog.length,0,'se metió una entrada ajena al periodo');
    });
    /* LA PRUEBA QUE DE VERDAD IMPORTA: que el importador LLAME a la
       reconciliación. Un motor correcto que nadie invoca se ve igual de verde
       —es la trampa que este proyecto ya lleva anotada—. Así que se corre
       `_importarEntradasQR`, que es quien recorre el log en cada render. */
    cargar('recetas/inventarios.js',['_importarEntradasQR']);
    test('el importador reconcilia lo ya importado en vez de saltárselo',()=>{
        let invalidado=0;
        Object.assign(c,{
            _scopeSucInsumos:l=>l, getInsumos:()=>[{id:'ron1'}],
            _enPeriodoInvActual:()=>true, _sucActiva:()=>'',
            _canonInsumoId:x=>x, _insumoResolver:()=>({id:'ron1',tipo:'pza'}),
            _unidadCompra:()=>'pza', _recomputarMovsQR:()=>{},
            _guardarELLocal:()=>{}, _sbUpEL:()=>{},
            _invalidarStep5:()=>{invalidado++;},
            getEntradasLog:()=>[entrada(2,8)],          // la nube ya trae la corrección
        });
        c.window=c; c.window._soloVistaInv=false;
        c.invActual={id:'inv1',cerrado:false,entradasLog:[entrada(1,10)]};
        const n=c._importarEntradasQR();
        eq(c.invActual.entradasLog.length,1,'metió otra entrada: el inventario contaría doble');
        eq(Number(c.invActual.entradasLog[0].cantidad),8,'el inventario se quedó con la cantidad vieja');
        eq(n>0,true,'no contó el cambio, así que nada se repinta');
        return eq(invalidado>0,true,'no invalidó el resultado: el reporte seguiría con lo viejo');
    });
    test('…y si nada cambió, no repinta por gusto',()=>{
        let invalidado=0;
        c._invalidarStep5=()=>{invalidado++;};
        c.getEntradasLog=()=>[entrada(1,10)];
        c.invActual={id:'inv1',cerrado:false,entradasLog:[entrada(1,10)]};
        eq(c._importarEntradasQR(),0,'contó un cambio que no hubo');
        return eq(invalidado,0,'invalidó el resultado sin motivo');
    });
    /* Un inventario cerrado o en solo-lectura no se toca: ahí la corrección es
       un ajuste autorizado, no una reconciliación silenciosa. */
    test('sin inventario abierto no hay nada que reconciliar',()=>{
        c.invActual=null;
        return eq(c._reconciliarEntradaEnInv(entrada(2,8)),false,'tocó algo sin inventario');
    });

    /* Y lo de siempre: agregar etiquetas no puede mover el dinero. */
    test('las etiquetas no tocan la diferencia ni su costo',()=>{
        c.calcExistencia=()=>25;c.calcExistenciaTeorica=()=>25+350/60;
        const r=c._rowCopa({...fcopa,precioCarta:90});
        eq(Math.abs(r.dif-(-350/60))<1e-9,true,'la diferencia cambió: '+r.dif);
        return eq(Math.abs(r.difCosto-(-350/60*90))<1e-9,true,'el costo cambió: '+r.difCosto);
    });
};
