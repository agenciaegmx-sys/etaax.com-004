/* Regresiones de interfaz de la reauditoría. Ejecuta funciones de producción;
   comparte únicamente el DOM simulado del candado, no sus casos de prueba. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pre=fs.readFileSync(path.join(__dirname,'money-tests.js'),'utf8').split('/* ═══════════════ SUITE A')[0].replace(/^#![^\n]*\n/,'');
const {crearContexto,cargarJS,setVar,getVar}=new Function('require','__dirname',pre+'\nreturn {crearContexto,cargarJS,setVar,getVar};')(require,__dirname);
let n=0;
async function test(name,fn){await fn();console.log('PASA '+name);n++;}
function contexto(){const F=crearContexto();cargarJS(F,'etaax-core.js');cargarJS(F,'security.js');cargarJS(F,'insumo-label.js');cargarJS(F,'recetas/inventarios.js');F._storage.etaax_negocio_activo='negT';return F;}
function setup(F){
 const comp={id:'comp',nombre:'Caguamas',miembros:['a','b']};F._storage[F._compuestosKey()]=JSON.stringify([comp]);
 const filas=[{insumoId:'a',nombre:'Cerveza A 940',categoria:'Cervezas',tipo:'pza',existenciaAnterior:10,cerradasBodega:0,cerradasBarra:5,costoUnitario:30,entradas:[]},
 {insumoId:'b',nombre:'Cerveza B 940',categoria:'Cervezas',tipo:'pza',existenciaAnterior:10,cerradasBodega:0,cerradasBarra:15,costoUnitario:40,entradas:[]}];
 setVar(F,'filasCaptura',filas);setVar(F,'invActual',{id:'inv',sucursalId:'s1',area:'barra',fecha:'2026-11-04',filas,entradasLog:[],prebatchProducidos:{},cocktailsVendidos:{},ventasCompuesto:{},cancelaciones:[],descuentos:[],compuestos:[comp]});return filas;
}
function render(F){let html='';F.document.body.appendChild=e=>html=e.innerHTML;try{F.verReporteDirectivo(false,'faltsobr');}catch(e){if(!html)throw e;}return html;}
function qr(){const F=contexto();setup(F);F._qrEstado=()=>{};F._qrQuitarEstado=()=>{};F._persistirBorradorLocal=()=>{};F._guardarDraftsLocal=()=>{};F.renderStepContent=()=>{};F._invalidarStep5=()=>{};F.cargarConteosQR=async()=>{};
 F.cargarProductosCaptura=()=>setVar(F,'filasCaptura',getVar(F,'invActual').filas);F._exigeInv=()=>true;F.etaaxConfirm=(a,b,fn)=>fn();F.alert=()=>{};return F;}
const counts=[{id:'q1',ver:2,insumoId:'a',cerradasBodega:3,cerradasBarra:0},{id:'q2',ver:1,insumoId:'a',cerradasBodega:4,cerradasBarra:0},{id:'q3',ver:1,insumoId:'b',cerradasBodega:2,cerradasBarra:0}];
function accept(args){const i=JSON.parse(JSON.stringify(args.p_inventario));i.qrRevision=(i.qrRevision||0)+1;i.qrOperaciones={[args.p_op]:'hash'};return {data:{ok:true,inventario:i}};}
(async()=>{
 await test('horarios: identidad distinta por negocio sin colisiones de separadores',()=>{const F=contexto();const k=F.EtaaxCore.horarioId;assert.notEqual(k('n1','','2026-W45'),k('n2','','2026-W45'));assert.notEqual(k('a_b','c','2026-W45'),k('a','b_c','2026-W45'));});
 for(const search of ['Caguamas','Cerveza A'])for(const mode of ['lista','galeria'])await test('compuestos: '+search+' / '+mode,()=>{const F=contexto();setup(F);setVar(F,'_busqStep5',search);setVar(F,'_difStep5','falta');setVar(F,'_step5Modo',mode);assert.ok(F._step5TablasHTML().includes('Caguamas'));assert.equal(F._gruposVisiblesS5().join(','),'Cervezas');const paper=render(F);assert.ok(paper.includes('Cerveza A 940'));});
 await test('buscar el sobrante no incluye el compuesto en solo faltantes',()=>{const F=contexto();setup(F);setVar(F,'_busqStep5','Cerveza B');setVar(F,'_difStep5','falta');assert.equal(F._gruposVisiblesS5().length,0);assert.equal(F._step5TablasHTML().includes('Caguamas'),false);});
 await test('QR: dos conteos del mismo producto se suman a lo manual tras confirmar',async()=>{const F=qr();let sent;F._supabase={rpc:async(name,args)=>{assert.equal(name,'inventario_conteos_aplicar');sent=args;assert.equal(getVar(F,'filasCaptura')[0].cerradasBodega,0);return accept(args);}};await F._resolverConteosQR(counts,false);assert.equal(sent.p_inventario.filas[0].cerradasBodega,7);assert.equal(sent.p_inventario.filas[0].cerradasBarra,5);assert.equal(sent.p_inventario.filas[1].cerradasBodega,2);assert.equal(getVar(F,'invActual').qrRevision,1);assert.equal(F._qrPendiente(),null);});
 await test('QR: conflicto no cambia las cantidades ni marca aplicado localmente',async()=>{const F=qr();F._supabase={rpc:async()=>({data:{ok:false,motivo:'conflicto-conteo'}})};assert.equal(await F._resolverConteosQR(counts,false),false);assert.equal(getVar(F,'filasCaptura')[0].cerradasBodega,0);assert.equal(F._qrPendiente(),null);});
 await test('QR: respuesta perdida conserva exactamente la operación y sus versiones',async()=>{const F=qr();let sent;F._supabase={rpc:async(name,args)=>{sent=JSON.stringify(args);throw new Error('network');}};await F._resolverConteosQR(counts,false);assert.ok(F._qrPendiente());assert.equal(getVar(F,'filasCaptura')[0].cerradasBodega,0);F._supabase.rpc=async(name,args)=>{assert.equal(JSON.stringify(args),sent);return accept(args);};await F.reintentarConteosQR();assert.equal(F._qrPendiente(),null);assert.equal(getVar(F,'filasCaptura')[0].cerradasBodega,7);});
 await test('QR: descartar un producto envía todos sus conteos sin alterar existencias',async()=>{const F=qr();setVar(F,'_conteosQR',counts);let done;const finished=new Promise(r=>done=r);F._supabase={rpc:async(name,args)=>{assert.equal(args.p_descartar,true);assert.equal(args.p_conteos.length,2);assert.equal(args.p_inventario.filas[0].cerradasBarra,5);done();return accept(args);}};F.descartarConteoQR(0);await finished;});
 await test('confirmación limpia solo snapshots anteriores del mismo inventario y negocio',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../etaax-db.js'),'utf8');
  const code=source.match(/window\.sbConfirmarInventarioQR = function[\s\S]*?\n    \};/)[0];
  let queue=[{op:'upsert',tabla:'inventarios',payload:{id:'i',negocio_id:'n',datos:{}}},
   {op:'upsert',tabla:'inventarios',payload:{id:'i',negocio_id:'otro',datos:{}}},
   {op:'upsert',tabla:'inventarios',payload:{id:'i',negocio_id:'n',datos:{qrRevision:2}}},
   {op:'delete',tabla:'inventarios',id:'i'}];
  const win={};new Function('window','_obLoad','_obSave','_obIndicador',code)(win,()=>queue,q=>queue=q,()=>{});
  win.sbConfirmarInventarioQR('n','i',1);assert.equal(queue.length,3);assert.equal(queue[0].payload.negocio_id,'otro');assert.equal(queue[2].op,'delete');
 });
 await test('QR: sin espacio no se envía una operación sin respaldo',async()=>{const F=qr();let sent=false;F.localStorage.setItem=()=>{throw new Error('quota');};F._supabase={rpc:async()=>{sent=true;}};assert.equal(await F._resolverConteosQR(counts,false),false);assert.equal(sent,false);});
 console.log('Reauditoría v84: '+n+' casos, 0 fallas');
})().catch(e=>{console.error(e);process.exitCode=1;});
