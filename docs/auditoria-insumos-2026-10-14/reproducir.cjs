#!/usr/bin/env node
'use strict';
// Auditoría local: ejecuta funciones originales con datos ficticios. Sin red.
// Los defectos detectados se registran como evidencia, no como pruebas aprobadas.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.resolve(__dirname, '../..');
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
function fn(file, name) {
    const s = src(file), p = s.indexOf('function ' + name + '(');
    assert(p >= 0, 'No existe ' + name);
    const start = s.slice(Math.max(0, p - 6), p) === 'async ' ? p - 6 : p;
    const open = s.indexOf('{', p); let depth = 0;
    for (let i = open; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}' && --depth === 0) {
            const code = s.slice(start, i + 1);
            new vm.Script(code, {filename:file + ':' + name});
            return code;
        }
    }
    throw Error('Sin cierre: ' + name);
}
function context(catalog = [], branch = 's1') {
    const nodes = {}, storage = {etaax_sucursal_activa:branch}; let n = 0;
    const c = {
        console, Date, JSON, Math, parseFloat, isNaN,
        catalog:clone(catalog), globalMode:false, writes:[], alerts:[],
        localStorage:{getItem:k=>storage[k]||null, setItem:(k,v)=>{storage[k]=String(v);}},
        document:{getElementById(id){return nodes[id] || (nodes[id]={value:'',style:{},classList:{remove(){},add(){}},remove(){}});},
            querySelector(){return null;}, querySelectorAll(){return [];}, addEventListener(){}},
        genId:()=> 'nuevo_' + (++n), alert:x=>c.alerts.push(x), confirm:()=>true,
        clearTimeout(){}, setTimeout(){},
        getInsumos:()=>c.catalog, setInsumos:a=>{c.catalog=a;},
        getCatalogoInsumos:()=>c.catalog,
        getNegocioActivo:()=> 'negocio_ficticio',
        _getSucActivaIns:()=>storage.etaax_sucursal_activa,
        _catGlobalIns:()=>c.globalMode, MATRIZ_ID_INS:'suc_principal',
        _sincronizarInsumosSupabase:async(neg,a)=>{c.writes.push({neg,ids:a.map(x=>x.id)});},
        _avisarPadreIns(){}, filtrar(){}, init(){}, cerrarModalBtn(){}, renderReq(){},
        _cgMarcarAgregado(){}, _usuarioActual:()=> 'Auditoría ficticia',
        // Sello/UI externos al guardado: no alteran la estructura de identidad.
        _registrarCambios(){}, _soloMode:true, _insumosSyncTimer:null,
        editandoId:null, tipoInsumoActual:'licor', fotoInsumoBase64:'', presentacionesTemp:[], FAMILIA_POR_TIPO:{licor:'Bebidas'},
    };
    c.window=c; vm.createContext(c);
    vm.runInContext(src('insumo-label.js'), c, {filename:'insumo-label.js'});
    c._insumoResolver=c._makeInsumoResolver(()=>c.catalog);
    c.branch=v=>{storage.etaax_sucursal_activa=v;};
    c.load=(file,...names)=>names.forEach(name=>vm.runInContext(fn(file,name),c,{filename:file+':'+name}));
    return c;
}
const master={id:'m',nombre:'Tónica',marca:'Marca',variedad:'Clásica',activo:'1',sucursales:[],area:'barra',
    presentaciones:[{contNeto:1000,umContenido:'ML',precio:100,presentacionCompra:'Caja',cantPresCompra:24,umPresCompra:'Botellas'}]};
const copy=(branch,changes={})=>Object.assign(clone(master),{id:'c_'+branch,origenId:'m',sucursales:[branch],sucursalId:branch},changes);
let controls=0, findings=0;
function record(kind,name,data){if(kind==='CONTROL')controls++;else findings++; console.log(JSON.stringify({tipo:kind,caso:name,evidencia:data}));}
function qr(c){ c.SUC='s1'; c.load('entrada.html','_enSucQR','_unoPorProductoQR');
    return c._unoPorProductoQR(c.catalog.filter(x=>x.activo!=='0'&&c._enSucQR(x))); }
async function main(){
    const large=[];
    for(let i=0;i<1000;i++)large.push({id:'m'+i,nombre:'Producto '+i,activo:'1',sucursales:[],area:'barra'});
    for(const [branch,count] of [['s1',200],['s2',500],['s3',100]])
        for(let i=0;i<count;i++)large.push({id:branch+'_'+i,origenId:'m'+i,nombre:'Producto '+i,activo:'1',sucursales:[branch],area:'barra'});
    const big=context(large); big.load('recetas/inventarios.js','_scopeSucInsumos');
    const counts={};
    for(const [branch,count] of [['s1',200],['s2',500],['s3',100]]){big.branch(branch); counts[branch]=big._scopeSucInsumos(big.catalog).length; assert.equal(counts[branch],count);}
    assert.equal(big.catalog.filter(x=>!x.origenId).length,1000);
    record('CONTROL','Catálogo/inventario con sucursal explícita y copias sanas',counts);
    big.load('entrada.html','_enSucQR','_unoPorProductoQR');
    const qrCounts={}; for(const branch of ['s1','s2','s3']){big.SUC=branch;qrCounts[branch]=big._unoPorProductoQR(big.catalog.filter(x=>big._enSucQR(x))).length;assert.equal(qrCounts[branch],1000);}
    record('DEFECTO','QR incluye los maestros globales no asignados', {esperado:counts,observado:qrCounts});
    big.load('app-movil/app.js','enSuc','unoPorProducto'); big.SUC='s1';
    assert.equal(big.unoPorProducto(big.catalog.filter(x=>big.enSuc(x))).length,1000);
    record('DEFECTO','App móvil repite el filtro abierto del QR',{esperado:200,observado:1000});
    big.branch(''); assert.equal(big._scopeSucInsumos(big.catalog).length,1800);
    record('DEFECTO','Sin sucursal, inventario devuelve maestros y todas las copias',{observado:1800});
    big.branch('s1');big.invActual={sucursalId:'s2'};
    assert.equal(big._scopeSucInsumos(big.catalog).length,200);
    record('DEFECTO','Scope del inventario depende de pestaña, no de invActual',{sucursalInventario:'s2',sucursalPestana:'s1',esperado:500,observado:200});

    const paused=context([master,copy('s1',{activo:'0'})]);
    const activeQR=qr(paused); assert.equal(activeQR[0].id,'m');
    record('DEFECTO','QR vuelve a ofrecer maestro cuando su copia está inactiva',{idOfrecido:activeQR[0].id});
    const matrix=context([master,copy('',{id:'c_matriz'})],'suc_principal');
    matrix.SUC='suc_principal';matrix.load('entrada.html','_enSucQR','_unoPorProductoQR');
    assert(matrix._insumoEnSuc(matrix.catalog[1],'suc_principal'));assert(!matrix._enSucQR(matrix.catalog[1]));
    record('DEFECTO','QR no normaliza la membresía vacía de Matriz',{catalogoAcepta:true,qrAceptaCopia:false});

    const edited=context([master,copy('s1'),copy('s2')]);
    edited.load('recetas/insumos.js','guardarInsumo'); edited.editandoId='c_s1';
    edited.document.getElementById('ins-nombre').value='Tónica';
    edited.presentacionesTemp=[{contNeto:750,umContenido:'ML',precio:20}];
    await edited.guardarInsumo();
    const lost=edited.catalog.find(x=>x.id==='c_s1'); assert.equal(lost.origenId,undefined);
    assert.equal(edited.catalog.filter(x=>!x.origenId).length,2);
    record('DEFECTO','Editor pierde origenId y la copia pasa al global',{id:lost.id,origenId:lost.origenId||null,maestrosVisibles:2});

    const shared=context([master,copy('s1')],'s2');
    shared.load('recetas/insumos.js','_effSucIns'); shared.load('recetas/insumos.html','ignAgregar');
    shared.ignAgregar('c_s1'); assert.deepEqual(Array.from(shared.catalog[1].sucursales),['s1','s2']);
    record('DEFECTO','Copiar aquí comparte la misma copia entre sucursales',{id:shared.catalog[1].id,sucursales:shared.catalog[1].sucursales,registros:shared.catalog.length});
    shared.load('recetas/insumos.js','eliminarInsumo');shared._tombAdd=()=>{};shared._borrarInsumosSupabase=async()=>{};
    let deletion;shared._pedirClaveAdmin=(msg,cb)=>{deletion=cb();};shared.eliminarInsumo('c_s1');await deletion;
    assert.equal(shared.catalog.length,1);
    record('DEFECTO','Eliminar copia compartida por importador la quita de ambas sucursales',{restantes:shared.catalog.map(x=>x.id)});

    const etaax=context([]); etaax._cgTodos=[master];etaax.load('recetas/insumos.html','cgAgregar');
    await etaax.cgAgregar('m');etaax.branch('s2');await etaax.cgAgregar('m');
    assert.equal(etaax.catalog.length,1);assert.deepEqual(Array.from(etaax.catalog[0].sucursales),['s1','s2']);
    record('DEFECTO','Importar ETAAX en dos sucursales conserva un solo ID compartido',{id:etaax.catalog[0].id,origenId:etaax.catalog[0].origenId||null,sucursales:etaax.catalog[0].sucursales});

    const duplicate=context([]);duplicate.load('recetas/insumos.js','guardarInsumo');
    duplicate.document.getElementById('ins-nombre').value='Tónica';
    await duplicate.guardarInsumo();await duplicate.guardarInsumo();
    assert.equal(duplicate.catalog.length,4);assert.equal(duplicate.alerts.length,0);
    record('DEFECTO','Alta manual repetida no alerta duplicado',{maestros:2,copiasSucursal:2,alertas:duplicate.alerts.length});

    const valid=context([master,copy('s1'),copy('s2')]);valid.load('recetas/insumos.js','eliminarInsumo');
    valid._tombAdd=()=>{};valid._borrarInsumosSupabase=async()=>{};
    let del;valid._pedirClaveAdmin=(msg,cb)=>{del=cb();};valid.eliminarInsumo('c_s1');await del;
    assert.deepEqual(valid.catalog.map(x=>x.id),['m','c_s2']);
    record('CONTROL','Eliminar una copia bien formada respeta maestro y otra sucursal',{restantes:valid.catalog.map(x=>x.id)});
    assert.equal(valid._insumoResolver('m').id,'m');
    record('DEFECTO','Resolver revive maestro después de eliminar copia local',{sucursal:'s1',idResuelto:valid._insumoResolver('m').id});

    const renamed=context([master,copy('s1',{nombre:'Tónica de la casa'})]);
    assert.equal(renamed._insumoResolver('c_s1').id,'m');
    renamed.load('app.js','_calcCatalogoInsumosScope','_unoPorProducto');
    assert.equal(renamed._calcCatalogoInsumosScope()[0].id,'m');
    record('DEFECTO','Renombrar copia hace que resolver y buscador ofrezcan maestro',{idSolicitado:'c_s1',idResuelto:'m'});

    const packaging=context([master,copy('s1',{presentaciones:[{contNeto:750,umContenido:'ML',presentacionCompra:'Caja',cantPresCompra:12,umPresCompra:'Botellas'}]})]);
    packaging.load('recetas/inventarios.js','_canonInsumoId','_empaqueCompra','_empaqueDeFila');
    assert.equal(packaging._insumoResolver('m').presentaciones[0].cantPresCompra,12);
    assert.equal(packaging._empaqueDeFila({insumoId:'m'}).factor,24);
    packaging.load('app.js','getContenidoPorPieza');assert.equal(packaging.getContenidoPorPieza('m'),1000);
    record('DEFECTO','Lecturas crudas usan empaque/contenido del maestro',{cajaLocal:12,cajaUsada:24,mlLocal:750,mlUsados:1000});

    const importCSV=context([copy('s2',{marca:'Otra',presentaciones:[{precio:900}]})]);
    importCSV.setStatus=()=>{};importCSV.load('recetas/insumos.js','procesarProductos');
    importCSV.procesarProductos([{nombre_base:'Tónica',variedad_base:'Clásica',marca_base:'Importada'}]);
    assert.equal(importCSV.catalog[0].marca,'Importada');assert.equal(importCSV.catalog[0].presentaciones.length,0);
    record('DEFECTO','CSV desde s1 modifica ficha de s2 por nombre/variedad',{idModificado:importCSV.catalog[0].id,sucursal:importCSV.catalog[0].sucursalId,presentacionesRestantes:0});

    const req=context([]);req.reqData={c_s1:{pedidoManual:2,nota:'S1'},c_s2:{pedidoManual:8,nota:'S2'}};
    req.getHistorial=()=>[];req.setHistorial=h=>{req.hist=h;};req.setReqData=d=>{req.saved=d;};req.calcResumen=()=>({totalItems:1,totalCosto:20});
    req.load('recetas/requisiciones.html','cerrarRequisicion');req.cerrarRequisicion();
    assert.equal(req.reqData.c_s2.pedidoManual,'');assert.equal(req.hist[0].sucursalId,undefined);
    record('DEFECTO','Archivar requisición S1 limpia pedido S2 y guarda historial mezclado',{pedidoS2:req.reqData.c_s2.pedidoManual,idsArchivados:Object.keys(req.hist[0].items),sucursalArchivada:req.hist[0].sucursalId||null});

    const sync=context([copy('s1'),copy('s2')]);sync.load('recetas/insumos.js','_keyInsLocal','actualizarEnGlobal');
    sync.actualizarEnGlobal('c_s1');assert.deepEqual(Array.from(sync.catalog[1].sucursales),['s1']);
    record('DEFECTO','Ruta antigua actualizarEnGlobal sobrescribe membresía del destino',{idDestino:'c_s2',sucursalId:sync.catalog[1].sucursalId,sucursales:sync.catalog[1].sucursales});

    const save=context([master,copy('s1'),copy('s2')]);let later;
    save._sk=k=>k;save._skPut=()=>{};save._insumosCache=null;
    save.setTimeout=cb=>{later=cb;return 1;};save.load('recetas/insumos.js','setInsumos');
    save.catalog[1].presentaciones[0].precio=20;
    save.setInsumos(save.catalog);await later();
    assert.deepEqual(save.writes[0].ids,['m','c_s1','c_s2']);
    record('DEFECTO','Debounce de setInsumos sincroniza también registros ajenos sin modificar',{registroEditado:'c_s1',idsEnviados:save.writes[0].ids});

    const fork=context([Object.assign(clone(master),{sucursales:['s1','s2']})]);
    fork.load('recetas/insumos.js','_forkInsumo');
    const forked=fork._forkInsumo(fork.catalog[0],['s1','s2']);
    assert.notEqual(forked[0].id,forked[1].id);assert.equal(forked[0].origenId,'m');
    forked[0].presentaciones[0].precio=777;assert.equal(forked[1].presentaciones[0].precio,100);
    record('CONTROL','Fork moderno crea copias con IDs y presentaciones independientes',{ids:forked.map(x=>x.id),precioOtraSucursal:100});
    const cached=context([master]);cached._copiasIdxRef=null;cached._copiasIdx=null;cached.load('recetas/insumos.js','_copiasDe');
    assert.equal(cached._copiasDe('m').length,0);cached.catalog.push(copy('s1'));cached.setInsumos(cached.catalog);
    assert.equal(cached._copiasDe('m').length,0);
    record('DEFECTO','Índice de copias queda viejo al agregar con la misma referencia',{copiasReales:1,copiasIndexadas:0});

    const nov=context([master,copy('s1'),copy('s2')]);const ts=new Date().toISOString();
    nov.catalog[0].historial=[{ts,global:true,suc:'',cambios:[]}];
    nov._sk=k=>'negocio_ficticio_'+k;nov._HIST_DIAS=90;nov._NOV_VISTAS={};nov._novInvalidar=()=>{};nov._novRender=()=>{};
    nov.load('recetas/insumos.js','_insumosDeEstaVista','_novKeyStore','_novCargarVistas','_novGuardarVistas','_novLista','_novDejar');
    assert.equal(nov._novLista().length,1);nov._novDejar('m|'+ts);nov.branch('s2');
    assert.equal(nov._novLista().length,0);
    record('DEFECTO','Descartar novedad global en S1 la oculta también en S2 en este dispositivo',{pendientesS2:0});
    nov.catalog[0].historial=[];nov.catalog[1].historial=[{ts,suc:'s1',cambios:[]}];
    assert.equal(nov._novLista().length,0);
    record('DEFECTO','Cambios de S1 no avisan a S2 aunque comparten maestro',{avisosS2:0});
    for(const name of ['_HIST_CAMPOS','_HIST_PRES'])
        vm.runInContext(src('recetas/insumos.js').match(new RegExp('var '+name+' = \\[([\\s\\S]*?)\\];'))[0],nov);
    nov.fmtMXN=n=>'$'+n;nov.load('recetas/insumos.js','_valTxt','_diffInsumo');
    const before=clone(master);before.presentaciones.push({precio:500});const after=clone(before);after.presentaciones[1].precio=999;
    assert.equal(nov._diffInsumo(after,before).length,0);
    record('DEFECTO','Cambiar precio en presentación 2 no genera diff de novedades',{precioAntes:500,precioDespues:999,cambiosDetectados:0});

    const area=context();vm.runInContext(src('staff-area.js'),area);
    assert(area.StaffArea.veInsumo('barra',{nombre:'Sin clasificar'}));
    assert(!area.StaffArea.veInsumo('barra',{area:'cocina'}));
    record('CONTROL','Área explícita cocina queda fuera de barra',{cocinaVisible:false});
    record('DEFECTO','Insumo sin área ni familia pasa filtro de cualquier colaborador',{barraVisible:true});
    console.log(JSON.stringify({controles:controls,defectosReproducidos:findings,red:'ninguna',datos:'ficticios',base:'49c6d87'}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
