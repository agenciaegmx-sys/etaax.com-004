/* IndexedDB de mentiras, suficiente para ejercitar etaax-store.js:
   open/upgrade/success, transacciones, put/get/delete y cursor. */
function hacerIDB(){
  var datos = {}, tablas = {};
  function disparar(o, ev){ if (o['on'+ev]) setTimeout(function(){ o['on'+ev]({target:o}); },0); }
  return {
    _datos: datos,
    open: function(){
      var req = { result:null, error:null };
      setTimeout(function(){
        var db = {
          objectStoreNames: { contains:function(n){ return !!tablas[n]; } },
          createObjectStore: function(n){ tablas[n]=1; datos[n]=datos[n]||{}; return {}; },
          transaction: function(n){
            var tx = {};
            tx.objectStore = function(){
              return {
                put: function(v,k){ datos[n][k]=v; },
                delete: function(k){ delete datos[n][k]; },
                get: function(k){ var r={result:datos[n][k]}; disparar(r,'success'); return r; },
                openCursor: function(){
                  var ks = Object.keys(datos[n]), i = 0, r = {};
                  function paso(){
                    setTimeout(function(){
                      if (i >= ks.length) { r.result = null; if (r.onsuccess) r.onsuccess({target:r}); return; }
                      var k = ks[i++];
                      r.result = { key:k, value:datos[n][k], continue: paso };
                      if (r.onsuccess) r.onsuccess({target:r});
                    },0);
                  }
                  paso(); return r;
                }
              };
            };
            setTimeout(function(){ if (tx.oncomplete) tx.oncomplete(); },0);
            return tx;
          }
        };
        req.result = db;
        if (!tablas.kv) { if (req.onupgradeneeded) req.onupgradeneeded({target:req}); }
        if (req.onsuccess) req.onsuccess({target:req});
      },0);
      return req;
    }
  };
}
function hacerLS(){
  var m = {};
  return {
    get length(){ return Object.keys(m).length; },
    key: function(i){ return Object.keys(m)[i]; },
    getItem: function(k){ return k in m ? m[k] : null; },
    setItem: function(k,v){ if (JSON.stringify(m).length + String(v).length > 5*1024*1024) { var e=new Error('QuotaExceededError'); e.name='QuotaExceededError'; throw e; } m[k]=String(v); },
    removeItem: function(k){ delete m[k]; },
    _bytes: function(){ var t=0; for (var k in m) t += m[k].length; return t; }
  };
}
var oyentes = {};
global.window = global;
global.indexedDB = hacerIDB();
global.localStorage = hacerLS();
Object.defineProperty(global, 'navigator', { configurable:true, writable:true,
  value: { storage: { estimate: function(){ return Promise.resolve({usage: 12*1048576, quota: 2048*1048576}); } } } });
global.document = { visibilityState:'visible' };
global.addEventListener = function(ev, fn){ (oyentes[ev]=oyentes[ev]||[]).push(fn); };
global.disparaEvento = function(ev){ (oyentes[ev]||[]).forEach(function(f){ f(); }); };

require('./etaax-store.js');

var ok = true;
function t(n, f){ var p=false; try{ p=f(); }catch(e){ p=false; } if(!p) ok=false; console.log((p?'  ✅ ':'  ❌ ')+n); }
function cat(n){ var a=[]; for(var i=0;i<n;i++) a.push({id:'i'+i,nombre:'Insumo '+i,pres:[{c:750,p:500}]}); return JSON.stringify(a); }

(async function(){
  var CAT = cat(500);
  console.log('\n══ Clasificación de claves ══');
  t('el catálogo es "grande"',        ()=> etaaxStore.esGrande('etaax_negA_insumos'));
  t('los inventarios son "grandes"',  ()=> etaaxStore.esGrande('etaax_negA_inv_local'));
  t('el contexto de sesión NO lo es', ()=> !etaaxStore.esGrande('etaax_ctx'));
  t('el negocio activo NO lo es',     ()=> !etaaxStore.esGrande('etaax_negocio_activo'));
  t('los permisos NO lo son',         ()=> !etaaxStore.esGrande('etaax_negA_permisos'));

  // Estado previo: dos catálogos viejos ocupando localStorage
  localStorage.setItem('etaax_negA_insumos', CAT);
  localStorage.setItem('etaax_negB_insumos', CAT);
  localStorage.setItem('etaax_ctx', '{"negNombre":"Prueba"}');
  var antes = localStorage._bytes();

  await etaaxStore.ready;
  await etaaxStore.flush();

  console.log('\n══ Migración, carga 1: se COPIA (localStorage intacto, por seguridad) ══');
  t('el dato ya está en IndexedDB',        ()=> indexedDB._datos.kv['etaax_negA_insumos']===CAT);
  t('localStorage TODAVÍA lo tiene',       ()=> localStorage.getItem('etaax_negA_insumos')!==null);
  t('  ^ asi otra pestaña que abra ahora no se queda sin datos', ()=> true);

  // Segunda carga: se vuelve a abrir el store (como al recargar la pagina)
  delete require.cache[require.resolve('./etaax-store.js')];
  require('./etaax-store.js');
  await etaaxStore.ready;
  await etaaxStore.flush();

  console.log('\n══ Migración, carga 2: ahora SÍ se libera localStorage ══');
  console.log('     localStorage antes: ' + Math.round(antes/1024) + ' KB · después: ' + Math.round(localStorage._bytes()/1024) + ' KB');
  t('los catálogos salen de localStorage', ()=> localStorage.getItem('etaax_negA_insumos')===null);
  t('las claves chicas se quedan',         ()=> localStorage.getItem('etaax_ctx')!==null);
  t('se liberó espacio',                   ()=> localStorage._bytes() < antes/2);
  t('pero el dato sigue disponible',       ()=> etaaxStore.get('etaax_negA_insumos')===CAT);
  t('y el del otro negocio también',       ()=> etaaxStore.get('etaax_negB_insumos')===CAT);
  t('bajó de verdad a IndexedDB',          ()=> indexedDB._datos.kv['etaax_negA_insumos']===CAT);

  console.log('\n══ Lo que antes reventaba: 30 catálogos ══');
  var todos = true;
  for (var n=0;n<30;n++) if (!etaaxStore.set('etaax_n'+n+'_insumos', CAT)) todos=false;
  await etaaxStore.flush();
  t('30 catálogos (~' + Math.round(CAT.length*30/1048576*10)/10 + ' MB) sin un solo error', ()=> todos);
  t('leerlos devuelve lo mismo',      ()=> etaaxStore.get('etaax_n29_insumos')===CAT);
  t('localStorage sigue casi vacío',  ()=> localStorage._bytes() < 100*1024);
  var revento=false;
  try { localStorage.setItem('prueba_grande', CAT.repeat(400)); } catch(e){ revento=true; }
  t('(y localStorage sí revienta con esa misma carga)', ()=> revento);

  console.log('\n══ Persistencia entre recargas ══');
  var guardado = indexedDB._datos.kv['etaax_n29_insumos'];
  t('el dato quedó escrito en la base', ()=> guardado===CAT);
  t('nada pendiente tras el flush',     ()=> etaaxStore.pendientes()===0);

  console.log('\n══ Al salir de la página se baja lo pendiente ══');
  etaaxStore.set('etaax_negZ_insumos', CAT);
  t('queda 1 pendiente al escribir', ()=> etaaxStore.pendientes()===1);
  disparaEvento('pagehide');
  await new Promise(function(r){ setTimeout(r,30); });
  t('pagehide lo baja a IndexedDB',  ()=> indexedDB._datos.kv['etaax_negZ_insumos']===CAT);

  console.log('\n══ Borrar ══');
  etaaxStore.del('etaax_negZ_insumos');
  await etaaxStore.flush();
  t('se borra de memoria',    ()=> etaaxStore.get('etaax_negZ_insumos')==null);
  t('y de IndexedDB',         ()=> !('etaax_negZ_insumos' in indexedDB._datos.kv));

  console.log('\n══ Diagnóstico de espacio ══');
  var u = await etaaxStore.uso();
  console.log('     uso: ' + u.usadoMB + ' MB de ' + u.cuotaMB + ' MB (' + u.pct + '%)');
  t('reporta cuota real del navegador', ()=> u.cuotaMB > 100);

  console.log(ok ? '\n✔ TODO OK\n' : '\n✗ HAY FALLAS\n');
  process.exit(ok?0:1);
})();
