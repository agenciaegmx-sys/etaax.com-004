'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(require('node:path').join(__dirname,'../admin-catalogo-insumos.html'),'utf8');
function extract(name){const start=src.indexOf('function '+name+'('),a=src.indexOf('{',start);let i=a,depth=0;for(;i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'&&!--depth)break;}return (src.slice(start-6,start)==='async '?'async ':'')+src.slice(start,i+1);}
async function run(opt={}){
 const writes=[],alerts=[],base={id:'master',nombre:'Nombre curado',foto:'https://img.test/antes.jpg',presentaciones:[{precio:10}]};
 const c=vm.createContext({console,document:{getElementById:()=>({checked:opt.checked!==false})},_catalogoMem:[base],_novActu:[{insumoId:'master',datosNeg:{nombre:'Nombre del negocio',foto:opt.photo===undefined?'https://img.test/nueva.jpg':opt.photo,presentaciones:[{precio:10}]}}],sbSubirFotoBase64:async()=>opt.uploadFails?null:'https://img.test/subida.jpg',_supabase:{from:()=>({upsert:async rows=>{writes.push(rows);return {error:opt.dbFails?{message:'Fallo controlado'}:null};}})},alert:m=>alerts.push(m),_novDescartarItems(){},_novClave(){},_novFirmaActu(){},_renderNovedades(){}});
 ['_fotoN','_fotoCambioN','_aplicarActualizacion'].forEach(n=>vm.runInContext(extract(n),c));await c._aplicarActualizacion(0);return {writes,alerts,c};
}
(async()=>{
 let r=await run();assert.equal(r.writes[0][0].datos.foto,'https://img.test/nueva.jpg');assert.equal(r.c._catalogoMem[0].nombre,'Nombre curado');
 r=await run({photo:''});assert.equal(r.writes[0][0].datos.foto,'https://img.test/antes.jpg');
 r=await run({checked:false});assert.equal(r.writes[0][0].datos.foto,'https://img.test/antes.jpg');
 r=await run({photo:'data:image/png;base64,AAAA'});assert.equal(r.writes[0][0].datos.foto,'https://img.test/subida.jpg');
 r=await run({photo:'data:image/png;base64,AAAA',uploadFails:true});assert.equal(r.writes.length,0);assert.equal(r.c._catalogoMem[0].foto,'https://img.test/antes.jpg');assert.equal(r.alerts.length,1);
 r=await run({dbFails:true});assert.equal(r.c._catalogoMem[0].foto,'https://img.test/antes.jpg');assert.equal(r.c._novActu.length,1);
 console.log('FOTOS ADMIN: 6 casos, 0 fallas');
})().catch(e=>{console.error(e);process.exitCode=1;});
