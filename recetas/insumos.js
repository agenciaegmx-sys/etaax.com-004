/* ============================================================
   ETAAX - Insumos
   insumos.js · v2 — Importador por posición de fila
   ============================================================ */

   const UNIDADES     = ['ML','LT','G','KG','PZA','CARGA','PORCION'];
   const UNIDADES_REN = ['OZ','ML','LT','G','KG','PZA','PORCION','COPA'];
   const OZ_ML        = 29.5735;   // ml por onza líquida
   const COPA_ML      = 44.36;     // ml por copa estándar
   const _MXN         = '<span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span>';
   
   // ── Helpers de sesión (mirror de app.js para páginas sin app.js) ──
   function getNegocioActivo() { return localStorage.getItem('etaax_negocio_activo') || ''; }
   function _getSucsIns() {
       var negId = getNegocioActivo();
       try { return JSON.parse(localStorage.getItem('etaax_' + negId + '_sucursales') || '[]'); } catch(e) { return []; }
   }
   function _getSucActivaIns() { return localStorage.getItem('etaax_sucursal_activa') || ''; }
   // Permiso "cambiar de sucursal": permitido salvo que el dueño lo apague (fail-open).
   function _puedeCambiarSucIns() {
       var ctx; try { ctx = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch(e) {}
       if (!ctx || ctx.ctxType !== 'staff') return true;
       if ((ctx.rol||'') === 'admin') return true;
       var perms = window.etaaxPermisosRol ? etaaxPermisosRol(ctx.negId||getNegocioActivo(), ctx.rol) : {};
       return perms.cambiarSucursal !== false;
   }
   // Sin sucursal = matriz (sucursal por defecto), no "global en todas".
   var MATRIZ_ID_INS = 'suc_principal';
   function _effSucIns(id) { return id || MATRIZ_ID_INS; }
   // Nombre real de una sucursal (para los badges). Busca en la lista primero (así la Matriz
   // muestra su nombre real, ej. "Mammut Pizza Madero", no un genérico "Matriz").
   function _sucNomIns(id) {
       try { var sucs = JSON.parse(localStorage.getItem('etaax_' + getNegocioActivo() + '_sucursales') || '[]');
             var s = sucs.find(function(x){ return x.id === id; }); if (s) return s.nombre || id; } catch(e){}
       return (!id || id === MATRIZ_ID_INS) ? 'Matriz' : id;
   }
   // Badges de dónde vive el insumo. Sin asignar = está en el ALMACÉN global pero en ninguna
   // sucursal → badge gris "Global · sin asignar". Asignado → nombre real de cada sucursal.
   // Copias por sucursal ligadas a un maestro (origenId) — índice cacheado por referencia.
   var _copiasIdxRef = null, _copiasIdx = null;
   function _copiasDe(masterId) {
       var arr = getInsumos();
       if (_copiasIdxRef !== arr) {
           _copiasIdx = {};
           arr.forEach(function(c){ if (c && c.origenId) { (_copiasIdx[c.origenId] = _copiasIdx[c.origenId] || []).push(c); } });
           _copiasIdxRef = arr;
       }
       return _copiasIdx[masterId] || [];
   }
   function _insumoBadgesIns(ins) {
       // MAESTRO con copias por sucursal (origenId) → mostrar la VINCULACIÓN (🔗 N sucursales).
       if (ins && !ins.origenId) {
           var cop = _copiasDe(ins.id);
           if (cop.length) {
               var noms = cop.map(function(c){ var m = window._insumoSucursales(c); return _sucNomIns(m[0]||''); }).filter(Boolean);
               return '<span style="font-size:8px;letter-spacing:.5px;text-transform:uppercase;background:rgba(61,190,122,.14);color:var(--green);border:1px solid rgba(61,190,122,.35);border-radius:10px;padding:1px 6px;white-space:nowrap" title="Copias independientes en: ' + etx(noms.join(', ')) + '">🔗 ' + cop.length + ' sucursal' + (cop.length !== 1 ? 'es' : '') + '</span>';
           }
       }
       var s = (window._insumoSucursales ? window._insumoSucursales(ins) : (ins.sucursalId ? [ins.sucursalId] : []));
       if (!s.length) return '<span style="font-size:8px;letter-spacing:.5px;text-transform:uppercase;background:rgba(155,149,138,.14);color:var(--text-dim);border:1px solid var(--border);border-radius:10px;padding:1px 6px;white-space:nowrap">🌐 Global · sin asignar</span>';
       return s.map(function(id){ return '<span style="font-size:8px;letter-spacing:.5px;text-transform:uppercase;background:rgba(122,184,245,.12);color:#7ab8f5;border:1px solid rgba(122,184,245,.3);border-radius:10px;padding:1px 6px;white-space:nowrap;margin-right:3px">' + etx(_sucNomIns(id)) + '</span>'; }).join('');
   }

   // ── Modal "VINCULAR a sucursal": cada sucursal marcada tiene una COPIA independiente
   //    ligada al maestro (origenId). Marcar = crear el vínculo (copia); desmarcar = quitarlo.
   //    (Antes se compartía el MISMO registro entre sucursales → rompía la independencia.)
   // Insumos PROPIOS de cada sucursal (sin vínculo) que coinciden con el maestro → {suc: insumo}.
   // La identidad es la clave canónica (_keyInsumo: nombre|marca|variedad), la misma que usa
   // el resto del sistema para decir "es el mismo insumo".
   function _candAdopcionIns(master, lista) {
       var k = window._keyInsumo ? window._keyInsumo(master) : '', out = {};
       if (!k || k === '||') return out;
       (lista || []).forEach(function(x){
           if (!x || x.origenId || x.id === master.id) return;
           if ((window._keyInsumo ? window._keyInsumo(x) : '') !== k) return;
           var mem = window._insumoSucursales(x) || [];
           if (!mem.length) return;                       // maestro global sin asignar → no es "propio de una sucursal"
           mem.forEach(function(sc){ var e = sc || MATRIZ_ID_INS; if (!out[e]) out[e] = x; });
       });
       return out;
   }
   var _insumoSucEditId = null;
   function abrirInsumoSuc(id) {
       var ins = getInsumos().find(function(x){ return x.id === id; }); if (!ins) return;
       // Operar SIEMPRE sobre el maestro (si abriste una copia, sube a su origen).
       var master = ins.origenId ? (getInsumos().find(function(x){ return x.id === ins.origenId; }) || ins) : ins;
       _insumoSucEditId = master.id;
       // Sucursales con vínculo: las que ya tienen COPIA + (legacy) la membresía propia del maestro.
       var vinc = {};
       _copiasDe(master.id).forEach(function(c){ (window._insumoSucursales(c) || []).forEach(function(s){ vinc[s || MATRIZ_ID_INS] = 1; }); });
       (window._insumoSucursales(master) || []).forEach(function(s){ vinc[s || MATRIZ_ID_INS] = 1; });
       var sucs = _getSucsIns(), opts = [];
       if (!sucs.some(function(s){ return s.id === MATRIZ_ID_INS; })) opts.push({ id: MATRIZ_ID_INS, nombre: 'Matriz' });
       opts = opts.concat(sucs);
       document.getElementById('insumoSucNombre').textContent = (typeof insumoTitulo === 'function') ? insumoTitulo(master) : (master.nombre || 'Insumo');
       document.getElementById('insumoSucLista').innerHTML = opts.map(function(s){
           var on = !!vinc[s.id];
           return '<label style="display:flex;align-items:center;gap:10px;padding:11px 13px;border:1px solid ' + (on ? 'rgba(61,190,122,.4)' : 'var(--border)') + ';border-radius:9px;margin-bottom:7px;cursor:pointer">' +
               '<input type="checkbox" data-suc="' + etx(s.id) + '" ' + (on ? 'checked' : '') + ' style="width:17px;height:17px;accent-color:var(--green)">' +
               '<span style="font-size:13px;color:var(--text)">' + (on ? '🔗 ' : '') + etx(s.nombre || s.id) + '</span></label>';
       }).join('');
       document.getElementById('modalInsumoSuc').style.display = 'flex';
   }
   function cerrarInsumoSuc() { var m = document.getElementById('modalInsumoSuc'); if (m) m.style.display = 'none'; _insumoSucEditId = null; }
   async function guardarInsumoSuc() {
       var lista = getInsumos();
       var master = lista.find(function(x){ return x.id === _insumoSucEditId; }); if (!master) { cerrarInsumoSuc(); return; }
       var sel = [];
       document.querySelectorAll('#insumoSucLista input[type=checkbox]').forEach(function(c){ if (c.checked) sel.push(c.getAttribute('data-suc')); });
       // Copias vinculadas actuales, por sucursal.
       var copPorSuc = {};
       _copiasDe(master.id).forEach(function(c){ (window._insumoSucursales(c) || []).forEach(function(s){ copPorSuc[s || MATRIZ_ID_INS] = c; }); });
       var nuevas = [], borrar = [], adoptadas = [];
       // ADOPTAR EN VEZ DE DUPLICAR: si la sucursal ya tiene SU PROPIO insumo con la misma
       // identidad canónica, se liga ese al maestro (conserva sus datos) en vez de crear otro.
       var _cand = _candAdopcionIns(master, lista), _adoptar = {};
       var _pend = sel.filter(function(sc){ return !copPorSuc[sc] && _cand[sc]; });
       if (_pend.length) {
           var _txt = _pend.map(function(sc){ return '   • ' + _sucNomIns(sc) + ' → "' + ((typeof insumoTitulo==='function') ? insumoTitulo(_cand[sc]) : (_cand[sc].nombre||'')) + '"'; }).join('\n');
           if (confirm('🔗 ESA SUCURSAL YA TIENE SU PROPIO INSUMO:\n\n' + _txt + '\n\n' +
               'ACEPTAR = adoptarlo como la copia vinculada.\n' +
               '   Conserva SUS presentaciones y costos — no se sobreescribe con los del maestro.\n\n' +
               'CANCELAR = crear una copia nueva del maestro (la sucursal quedará con DOS).'))
               _pend.forEach(function(sc){ _adoptar[sc] = _cand[sc]; });
       }
       // CREAR vínculo (copia ligada) para las marcadas que aún no tienen copia — incluye
       // convertir la membresía LEGACY del maestro en copias reales.
       sel.forEach(function(suc){
           if (copPorSuc[suc]) return;
           if (_adoptar[suc]) { _adoptar[suc].origenId = master.id; adoptadas.push(_adoptar[suc]); return; }
           var real = (suc === MATRIZ_ID_INS) ? '' : suc;
           var copia = JSON.parse(JSON.stringify(master));
           copia.id = genId(); copia.origenId = master.id; copia.sucursales = [real]; copia.sucursalId = real;
           delete copia._memPreMigra;
           nuevas.push(copia);
       });
       // DESLIGAR (no borrar) las DESMARCADAS que tenían copia: la copia SE QUEDA en su
       // sucursal pero deja de estar ligada al maestro (independiente, ya sin novedades).
       var desligadas = [];
       Object.keys(copPorSuc).forEach(function(suc){
           if (sel.indexOf(suc) >= 0) return;
           var c = copPorSuc[suc]; if (c && c.origenId) { delete c.origenId; desligadas.push(c); }
       });
       // El maestro queda GLOBAL (sin membresía propia); las copias sirven a cada sucursal.
       master.sucursales = []; master.sucursalId = '';
       var all = lista.concat(nuevas); // nada se borra; las desligadas ya están en `lista` (mutadas)
       setInsumos(all);
       try { if (typeof _sincronizarInsumosSupabase === 'function') await _sincronizarInsumosSupabase(getNegocioActivo(), nuevas.concat([master]).concat(desligadas).concat(adoptadas)); } catch(e){}
       cerrarInsumoSuc();
       try { filtrar(); } catch(e) {}
   }
   window.abrirInsumoSuc = abrirInsumoSuc;
   window.cerrarInsumoSuc = cerrarInsumoSuc;
   window.guardarInsumoSuc = guardarInsumoSuc;

   // ── INDEPENDIZAR POR SUCURSAL (paso 4): auto-detecta insumos COMPARTIDOS (viven en >1
   //    sucursal) y crea una COPIA independiente por sucursal, ligada al maestro (origenId).
   //    Aditivo, idempotente y reversible. NO toca inventarios/mermas ya capturados (esos
   //    referencian el id CANÓNICO = el del maestro, que se conserva; el resolver por sucursal
   //    hace ver la copia). Respaldo automático antes de ejecutar. ──────────────────────────
   function _respaldarCatalogoIns() {
       try {
           var data = JSON.stringify({ tipo:'respaldo-insumos', negocio:getNegocioActivo(), fecha:new Date().toISOString(), insumos:getInsumos() }, null, 2);
           var a = document.createElement('a');
           a.href = URL.createObjectURL(new Blob([data], {type:'application/json'}));
           a.download = 'respaldo-insumos-' + (getNegocioActivo()||'negocio') + '-' + new Date().toISOString().slice(0,10) + '.json';
           document.body.appendChild(a); a.click(); a.remove();
           setTimeout(function(){ try{ URL.revokeObjectURL(a.href); }catch(e){} }, 3000);
           return true;
       } catch(e) { console.warn('[respaldo insumos]', e); return false; }
   }
   function _independizarInsumosPorSuc(dryRun) {
       var lista = getInsumos();
       var toFork = [];
       lista.forEach(function(ins){
           if (!ins || ins.origenId) return; // ya es una copia
           var mem = window._insumoSucursales ? window._insumoSucursales(ins) : (ins.sucursalId ? [ins.sucursalId] : []);
           if (mem.length <= 1) return; // no compartido (0 o 1 sucursal) → ya es independiente
           toFork.push({ ins: ins, mem: mem.slice() });
       });
       if (dryRun) return { maestros: toFork.length, copias: toFork.reduce(function(s,p){ return s + p.mem.length; }, 0) };
       var nuevas = [];
       toFork.forEach(function(p){
           p.ins._memPreMigra = p.mem.slice(); // huella para revertir si hiciera falta
           p.mem.forEach(function(suc){
               var copia = JSON.parse(JSON.stringify(p.ins));
               copia.id        = genId();
               copia.origenId  = p.ins.id;        // liga al maestro (canónico)
               copia.sucursales = [suc];
               copia.sucursalId = suc || '';
               delete copia._memPreMigra;
               nuevas.push(copia);
           });
           p.ins.sucursales = []; // el maestro queda global-only (sin sucursal); las copias sirven a cada una
           p.ins.sucursalId = '';
       });
       var all = getInsumos().concat(nuevas);
       setInsumos(all);
       try { _sincronizarInsumosSupabase(getNegocioActivo(), nuevas.concat(toFork.map(function(p){ return p.ins; }))); } catch(e){}
       return { maestros: toFork.length, copias: nuevas.length };
   }
   function abrirIndependizarSucIns() {
       var plan = _independizarInsumosPorSuc(true);
       if (!plan.maestros) { alert('✅ No hay insumos compartidos entre sucursales. Ya trabajan independientes.'); return; }
       if (!_respaldarCatalogoIns()) { if (!confirm('⚠️ No se pudo descargar el respaldo automático. ¿Continuar de todas formas?')) return; }
       var ok = confirm('🔗 INDEPENDIZAR INSUMOS POR SUCURSAL\n\n' +
           'Detectados: ' + plan.maestros + ' insumo(s) compartido(s) entre sucursales.\n' +
           'Se crearán ' + plan.copias + ' copia(s) independiente(s) (una por sucursal), ligadas a su maestro.\n\n' +
           '✔ Tus inventarios/mermas YA capturados NO se tocan (referencian el id del maestro).\n' +
           '✔ Es reversible (ya se descargó un respaldo .json).\n\n' +
           'Ya se descargó el respaldo. ¿Ejecutar ahora?');
       if (!ok) return;
       var res = _independizarInsumosPorSuc(false);
       alert('✅ Listo: ' + res.copias + ' copia(s) creadas de ' + res.maestros + ' insumo(s).\nCada sucursal ahora edita la suya de forma independiente.');
       try { init(); } catch(e){}
   }
   window.abrirIndependizarSucIns = abrirIndependizarSucIns;
   function _catGlobalIns() { return sessionStorage.getItem('etaax_cat_global') === '1'; }
   // Refleja en el header/banner si entramos en modo Catálogo Global del negocio
   // (se activa desde el menú "Catálogos Globales" del hub → flag etaax_cat_global).
   function _actualizarBannerGlobal() {
       var on  = _catGlobalIns();
       var lbl = document.querySelector('.brand-label');
       var ttl = document.querySelector('.brand-title');
       var bn  = document.getElementById('btnInsumosNegGlobal');
       if (lbl) lbl.textContent = on ? 'Catálogo Global del negocio' : 'Catálogo de productos';
       if (ttl) ttl.innerHTML   = on ? 'Insumos <span style="color:#7ab8f5">· Global</span>' : 'Insumos';
       // En modo global no tiene sentido el botón de copiar entre sucursales.
       if (bn) bn.style.display = on ? 'none' : '';
       // Independizar por sucursal: retirado de la vista. El modelo maestro + copia
       // ya deja cada sucursal independiente al crear o al vincular.
       var bi = document.getElementById('btnIndepSucIns');
       if (bi) bi.style.display = 'none';
       // Novedades: en el GLOBAL muestra los cambios de TODAS las sucursales; dentro
       // de una sucursal, solo los suyos (que es lo que ahí importa).
       var bnv = document.getElementById('btnNovedadesIns');
       if (bnv) {
           bnv.style.display = '';
           bnv.textContent = on ? '🔔 Novedades' : '🔔 Cambios recientes';
           bnv.title = on
               ? 'Cambios recientes de insumos por sucursal: decide si suben al catálogo global o se quedan en su sucursal'
               : 'Cambios recientes de los insumos de esta sucursal';
       }
   }
   function _poblarFiltroSucIns() {
       var sucs = _getSucsIns();
       var el = document.getElementById('filtroSucursalIns');
       if (!el || sucs.length <= 1) { if (el) el.style.display = 'none'; return; }
       el.style.display = '';
       var cur = el.value;
       var tieneMatriz = sucs.some(function(s){ return s.id === MATRIZ_ID_INS; });
       el.innerHTML = '<option value="">Todas las sucursales</option>' +
           (tieneMatriz ? '' : '<option value="' + MATRIZ_ID_INS + '">Matriz</option>') +
           sucs.map(function(s){ return '<option value="' + (s.id||'') + '">' + (s.nombre || s.id) + '</option>'; }).join('');
       if (cur) el.value = cur;
   }
   function _sk(key) {
       var id = getNegocioActivo();
       return id ? ('etaax_' + id + '_' + key) : ('etaax_' + key);
   }
   function _skGet(key) {
       var k = _sk(key), raw = localStorage.getItem(k);
       if (raw !== null) return raw;
       var id = getNegocioActivo();
       if (!id) return null;
       var legacy = localStorage.getItem('etaax_' + key);
       if (legacy && legacy !== 'null') { localStorage.setItem(k, legacy); return legacy; }
       return null;
   }

   // ── Insumos: caché en memoria + Supabase + localStorage fallback ──
   var _insumosCache       = null;
   var _insumosCacheNegId  = null;
   var _insumosSyncTimer   = null;
   var _insumosSupaCargado = false;

   function getInsumos() {
       var negId = getNegocioActivo();
       if (_insumosCacheNegId !== negId) { _insumosCache = null; _insumosCacheNegId = negId; if (typeof _tombRefresh === 'function') _tombRefresh(); }
       if (_insumosCache !== null) return _insumosCache;
       try { _insumosCache = JSON.parse(_skGet('insumos')) || []; }
       catch(e) { _insumosCache = []; }
       // La clave localStorage 'insumos' la comparte la página de recetas (app.js).
       // Si otro módulo la reescribió con insumos ya borrados, filtrarlos aquí para
       // que la UI NUNCA muestre un tombstoneado (y limpiar la clave de paso).
       if (_insumosCache.length && _insBorrados && Object.keys(_insBorrados).length) {
           var _antes = _insumosCache.length;
           _insumosCache = _insumosCache.filter(function(x){ return !(x && _insBorrados[x.id]); });
           if (_insumosCache.length !== _antes) { try { localStorage.setItem(_sk('insumos'), JSON.stringify(_insumosCache)); } catch(e) {} }
       }
       return _insumosCache;
   }
   // Resolver para la etiqueta canónica (insumo-label.js): id → insumo del catálogo.
   // Usa la fábrica compartida (insumo-label.js). Fuente: getInsumos resuelto al MOMENTO
   // de la llamada (admin-catalogo-insumos.html lo sobreescribe después de cargar este
   // script). Defensivo: si la página no cargó insumo-label.js, fallback simple en vez
   // de morir con TypeError (eso dejaba el módulo a medias y la lista en 0).
   window._insumoResolver = (typeof window._makeInsumoResolver === 'function')
       ? window._makeInsumoResolver(function () { return getInsumos(); })
       : function (id) { var a = getInsumos() || []; for (var i = 0; i < a.length; i++) { if (a[i] && a[i].id === id) return a[i]; } return null; };

   function setInsumos(data) {
       var negId = getNegocioActivo();
       // Si un id vuelve a estar VIVO (re-agregado desde el catálogo ETAAX, que reusa
       // el id), limpiar su tombstone → si no, la auto-reparación lo borraría de nuevo.
       if (typeof _tombClear === 'function') _tombClear((data || []).map(function(x){ return x && x.id; }));
       _insumosCache      = data; // memoria: datos completos (con foto)
       _insumosCacheNegId = negId;
       // localStorage: sin fotos base64 para evitar QuotaExceededError
       var paraLocal = data.map(function(ins) {
           if (!ins.foto || !ins.foto.startsWith('data:')) return ins;
           var d = Object.assign({}, ins); d.foto = ''; return d;
       });
       try { localStorage.setItem(_sk('insumos'), JSON.stringify(paraLocal)); } catch(e) {}
       // Supabase: datos completos con fotos (JSONB no tiene límite práctico)
       _insumosSyncPend = { negId: negId, data: data };
       clearTimeout(_insumosSyncTimer);
       _insumosSyncTimer = setTimeout(function() {
           _insumosSyncPend = null;
           _sincronizarInsumosSupabase(negId, data).catch(function(e) {
               console.warn('[setInsumos] sync error:', e);
           });
       }, 1200);
   }

   // Si quedó un sync pendiente al navegar de módulo, dispararlo ya (best-effort).
   // El merge en la carga recupera lo que no alcance a subir aquí.
   var _insumosSyncPend = null;
   window.addEventListener('pagehide', function() {
       if (_insumosSyncPend) {
           clearTimeout(_insumosSyncTimer);
           var p = _insumosSyncPend; _insumosSyncPend = null;
           try { _sincronizarInsumosSupabase(p.negId, p.data); } catch(e) {}
       }
   });

   // ── Tombstones PERSISTENTES de insumos eliminados (evita que "reaparezcan") ──
   // Antes vivían solo en memoria y se liberaban a los 20s: si borrabas y navegabas
   // (la recarga perdía los tombstones y CANCELABA el delete en vuelo), la nube
   // conservaba los registros y el merge los revivía. Ahora se guardan en localStorage
   // por negocio y, al cargar, si la nube devuelve un insumo tombstoneado se RE-BORRA
   // (auto-reparación). Los ids se generan únicos (genId) → nunca se reusan, así que
   // marcar uno como borrado para siempre es seguro (re-agregar crea un id nuevo).
   var _TOMB_TTL = 90 * 864e5; // 90 días: margen amplio; luego se podan solos.
   function _tombKey(){ return _sk('ins_borrados'); }
   function _tombLoad(){ try { return JSON.parse(localStorage.getItem(_tombKey())) || {}; } catch(e){ return {}; } }
   function _tombSave(){ try { localStorage.setItem(_tombKey(), JSON.stringify(_insBorrados)); } catch(e){} }
   function _tombPrune(){ var now=Date.now(), ch=false; for (var k in _insBorrados){ if (now-_insBorrados[k] > _TOMB_TTL){ delete _insBorrados[k]; ch=true; } } if (ch) _tombSave(); }
   function _tombRefresh(){ _insBorrados = _tombLoad(); _tombPrune(); } // recargar para el negocio activo
   function _tombAdd(ids){ var now=Date.now(); (ids||[]).forEach(function(id){ if(id) _insBorrados[id]=now; }); _tombSave(); }
   function _tombClear(ids){ var ch=false; (ids||[]).forEach(function(id){ if(id && _insBorrados[id]!==undefined){ delete _insBorrados[id]; ch=true; } }); if(ch) _tombSave(); }
   var _insBorrados = _tombLoad(); _tombPrune();

   async function _cargarInsumosDeSupabase(opts) {
       opts = opts || {};
       var negId = getNegocioActivo();
       // '__catalogo__' = catálogo ETAAX en admin-catalogo-insumos.html: SUS datos
       // viven en la tabla catalogo_insumos (la página los maneja), NO en
       // negocio_insumos → aquí no hay nada que cargar ni que empujar.
       if (!negId || negId === '__catalogo__' || typeof _supabase === 'undefined') return;
       _pullSubcatsCloud(negId); // subcategorías propias desde la nube (fire-and-forget)
       _tombRefresh(); // tombstones persistentes del negocio activo (sobreviven a recargas)
       try {
           // Carga PAGINADA y resiliente. Una sola query de hasta 5000 trayendo el
           // `datos` completo (con fotos base64 viejas y pesadas) podía tardar o
           // fallar por payload demasiado grande. Se pagina en lotes y, si un lote
           // falla, se reduce; si un registro no se puede traer, se omite.
           var remote = [], from = 0, BATCH = 200, guard = 0, skips = 0, huboError = false;
           while (guard++ < 10000) {
               var res = await _supabase.from('negocio_insumos')
                   .select('datos').eq('negocio_id', negId)
                   .order('insumo_id', { ascending: true })
                   .range(from, from + BATCH - 1);
               if (res.error) {
                   huboError = true;
                   if (BATCH > 1) { BATCH = Math.max(1, Math.floor(BATCH / 2)); continue; }
                   if (++skips > 3) { console.warn('[insumos] errores sistemáticos, aborta carga remota:', res.error.message); break; }
                   from += 1; BATCH = 200; continue; // saltar registro problemático
               }
               skips = 0;
               var chunk = (res.data || []).map(function(r){ return r.datos; }).filter(Boolean);
               if (!chunk.length) break;
               remote = remote.concat(chunk);
               from += chunk.length;
               BATCH = 200;
           }
           console.log('[insumos] negocio', negId, '→ Supabase:', remote.length, 'insumos' + (huboError ? ' (con reintentos)' : ''));
           // Si no se pudo traer nada y hubo error, conservar el caché local.
           if (!remote.length && huboError) return;
           // Dedup defensivo por id (por si quedaron duplicados de versiones previas).
           // Tombstones: excluir insumos recién eliminados que aún no se reflejan en
           // remote (el delete podía estar en vuelo) → evita que "reaparezcan".
           var _vistos = {}, _dedup = [], _revividos = [];
           remote.forEach(function(x){
               if (!x || !x.id) return;
               if (_insBorrados[x.id]) { _revividos.push(x.id); return; } // tombstoneado → no revivir
               if (!_vistos[x.id]) { _vistos[x.id] = 1; _dedup.push(x); }
           });
           remote = _dedup;
           // Auto-reparación: si la nube todavía tiene insumos que ya borramos (el delete
           // se canceló al navegar, o falló), re-emitir el borrado para que sea durable.
           if (_revividos.length) {
               console.log('[insumos] auto-reparación: re-borrando', _revividos.length, 'insumos que resucitaron');
               _borrarInsumosSupabase(negId, _revividos).catch(function(){});
           }

           // MERGE: conservar las adiciones locales que aún no sincronizaron
           // (ej. agregar del catálogo y navegar de módulo antes del sync).
           // Antes esto sobreescribía con lo remoto y "perdía" los recién agregados.
           var local = _insumosCache;
           if (local === null) { try { local = JSON.parse(_skGet('insumos')) || []; } catch(e) { local = []; } }
           var soloLocal = (local || []).filter(function(x){ return x && x.id && !_vistos[x.id] && !_insBorrados[x.id]; });
           var lista = remote.concat(soloLocal);

           // MEMBRESÍAS PENDIENTES ("+ Copiar aquí" de Insumos Globales): el pull
           // podía traer un snapshot ANTERIOR al push de la membresía y pisarla —
           // el insumo "desaparecía" de la sucursal recién agregada. Se re-aplican
           // hasta que la nube ya las traiga (entonces se dan por confirmadas).
           var _pend = window._insMembPend || {};
           lista.forEach(function(x){
               var p = x && x.id && _pend[x.id];
               if (!p) return;
               var s = (window._insumoSucursales ? window._insumoSucursales(x) : (x.sucursalId ? [x.sucursalId] : []))
                   .map(function(v){ return v || 'suc_principal'; });
               if (s.indexOf(p.suc) < 0) { s.push(p.suc); x.sucursales = s; }
               else delete _pend[x.id]; // la nube ya la trae → confirmada
           });

           _insumosCache      = lista;
           _insumosCacheNegId = negId;
           // localStorage: versión sin fotos base64
           var sinFotos = lista.map(function(ins) {
               if (!ins.foto || !ins.foto.startsWith('data:')) return ins;
               var d = Object.assign({}, ins); d.foto = ''; return d;
           });
           try { localStorage.setItem(_sk('insumos'), JSON.stringify(sinFotos)); } catch(e) {}
           renderStats(); cargarFiltros(); setVistaInsumos(vistaInsumos);

           // Empujar a Supabase lo que solo existía localmente (no sincronizado).
           // OJO: NO empujar cuando la recarga viene del realtime (es el eco de
           // nuestro propio write) — eso causaba el bucle push → realtime → push
           // que hacía parpadear la pantalla y mataba los botones de editar/ver.
           if (soloLocal.length && !opts.realtime) _sincronizarInsumosSupabase(negId, soloLocal).catch(function(){});
           // Realtime: si otro dispositivo cambia un insumo, recargar solos (estilo Drive).
           _subInsumosRealtime(negId);
       } catch(e) { console.warn('[_cargarInsumosDeSupabase]', e); }
   }

   // Realtime: el servidor empuja cambios de negocio_insumos → este dispositivo se
   // actualiza solo (sin recargar), como recetas y sucursales.
   var _insumosRtCh = null, _insumosRtNeg = null, _insRtT = null, _insRtCargando = false;
   function _subInsumosRealtime(negId) {
       if (!negId || _insumosRtNeg === negId || typeof sbRealtime !== 'function') return;
       if (_insumosRtCh && _supabase.removeChannel) { try { _supabase.removeChannel(_insumosRtCh); } catch(e) {} }
       _insumosRtNeg = negId;
       _insumosRtCh = sbRealtime('negocio_insumos', negId, function() {
           // No interrumpir si el usuario está editando un insumo (modal abierto).
           var modal = document.getElementById('modalOverlay');
           if (modal && modal.style.display !== 'none' && modal.offsetParent !== null) return;
           if (getNegocioActivo() !== negId) return;
           // Debounce: coalescer ráfagas de eventos en UNA sola recarga (sin parpadeo)
           // y sin re-empujar (realtime:true) → ya no hay bucle.
           clearTimeout(_insRtT);
           _insRtT = setTimeout(function() {
               if (_insRtCargando) return;
               _insRtCargando = true;
               Promise.resolve(_cargarInsumosDeSupabase({ realtime: true }))
                   .catch(function(){})
                   .then(function(){ _insRtCargando = false; });
           }, 450);
       });
   }

   async function _sincronizarInsumosSupabase(negId, data) {
       if (!negId || negId === '__catalogo__' || typeof _supabase === 'undefined') return; // el catálogo ETAAX sync-ea aparte

       // ALIGERAR: subir las fotos base64 (incluidas las viejas y pesadas) a
       // Storage y dejar URL. Así el payload siempre es liviano → el upsert no
       // falla por tamaño ("Sin sincronizar") y se migra lo viejo de forma
       // transparente. Muta los objetos (compartidos con el cache) → quedan ligeros.
       if (window.sbAligerarRecord) {
           for (var a = 0; a < data.length; a++) {
               try { await sbAligerarRecord(data[a], 'insumos', negId); } catch(e) {}
           }
           // Reflejar en localStorage que ya son URLs (no base64)
           try {
               localStorage.setItem(_sk('insumos'), JSON.stringify((_insumosCache || data).map(function(x) {
                   if (!x.foto || !x.foto.startsWith('data:')) return x;
                   var c = Object.assign({}, x); c.foto = ''; return c;
               })));
           } catch(e) {}
       }
       // SOLO upsert (PK negocio_id+insumo_id) — NUNCA borra: las eliminaciones
       // son explícitas vía _borrarInsumosSupabase. Lotes chicos y resiliente:
       // si un lote falla lo reduce; si un registro no pasa, se omite (no corta el resto).
       var records = data.map(function(ins) {
           return { negocio_id: negId, insumo_id: ins.id, datos: ins };
       });
       var i = 0, BATCH = 50, fallo = false;
       while (i < records.length) {
           var rUp = await _supabase.from('negocio_insumos').upsert(records.slice(i, i + BATCH));
           if (rUp.error) {
               if (BATCH > 1) { BATCH = Math.max(1, Math.floor(BATCH / 2)); continue; }
               console.warn('[insumos] registro no sincronizado, se omite:', records[i].insumo_id, rUp.error.message);
               fallo = true; i += 1; BATCH = 50; continue;
           }
           i += records.slice(i, i + BATCH).length; BATCH = 50;
       }
       if (fallo) _sbToastError('Algunos insumos no se sincronizaron (registro problemático omitido).');
   }

   // Borrado explícito en Supabase (las eliminaciones ya no dependen del diff)
   async function _borrarInsumosSupabase(negId, ids) {
       if (!negId || negId === '__catalogo__' || typeof _supabase === 'undefined' || !ids || !ids.length) return; // el catálogo ETAAX borra vía _syncCatalogToSupabase
       var BATCH = 100;
       for (var i = 0; i < ids.length; i += BATCH) {
           var r = await _supabase.from('negocio_insumos')
               .delete().eq('negocio_id', negId).in('insumo_id', ids.slice(i, i + BATCH));
           if (r.error) { _sbToastError('eliminar insumo: ' + r.error.message); break; }
       }
   }
   
   function genId() {
       return Date.now().toString(36) + Math.random().toString(36).slice(2,5);
   }
   
   // ── Stats ─────────────────────────────────────────────────────
   // Insumos en el alcance de la sucursal actual (sin aplicar búsqueda/familia/
   // categoría). En modo global incluye todas las sucursales. Lo usan las stats
   // para que el conteo de abajo sea independiente por sucursal, igual que arriba.
   function _insumosScope() {
       var lista = getInsumos();
       if (_catGlobalIns()) return lista;
       var fSucEl = document.getElementById('filtroSucursalIns');
       var sucFil = fSucEl ? fSucEl.value : '';
       var sucActiva = _getSucActivaIns();
       if (sucFil)        return lista.filter(function(x){ return _effSucIns(x.sucursalId) === sucFil; });
       if (sucActiva)     return lista.filter(function(x){ return _effSucIns(x.sucursalId) === sucActiva; });
       return lista;
   }

   // ── Identidad y sincronización entre sucursales ──────────────
   // Mismo nombre+marca = el mismo insumo en otra sucursal (igual que _keyIns).
   function _keyInsLocal(x){ return window._keyInsumo(x); } // identidad canónica (insumo-label.js) — no duplicar la lógica
   // Dedup para el catálogo global: un representante por identidad (prefiere el original).
   function _dedupGlobal(lista){
       var seen = {}, out = [];
       lista.forEach(function(x){
           var k = _keyInsLocal(x);
           if (seen[k] === undefined) { seen[k] = out.length; out.push(x); }
           else if (!x.origenId && out[seen[k]].origenId) { out[seen[k]] = x; }
       });
       return out;
   }
   // "Actualizar en catálogo global": empuja ficha + presentaciones + precios de este
   // insumo a TODAS las sucursales que tengan el mismo insumo (misma identidad).
   function actualizarEnGlobal(id){
       var lista = getInsumos();
       var src = lista.find(function(x){ return x.id === id; });
       if (!src) return;
       var k = _keyInsLocal(src);
       var hermanos = lista.filter(function(x){ return x.id !== src.id && _keyInsLocal(x) === k; });
       if (!hermanos.length) {
           alert('«' + (src.nombre || 'Este insumo') + '» ya es único en el catálogo global (no está en otras sucursales).');
           return;
       }
       var _aplicar = function () {
       hermanos.forEach(function(h){
           var i = lista.findIndex(function(x){ return x.id === h.id; });
           if (i < 0) return;
           var upd = JSON.parse(JSON.stringify(src));
           upd.id         = h.id;          // conservar identidad por registro
           upd.sucursalId = h.sucursalId;
           upd.origenId   = h.origenId;
           lista[i] = upd;
       });
       setInsumos(lista);
       if (window.etaaxAlert) etaaxAlert('Actualizado en ' + hermanos.length + ' sucursal' + (hermanos.length > 1 ? 'es' : '') + '.');
       filtrar();
       };
       var _msg = 'Su ficha técnica, presentaciones y precios quedarán iguales a este insumo en ' +
                  hermanos.length + ' sucursal' + (hermanos.length > 1 ? 'es' : '') + ' más.';
       if (window.etaaxConfirm) etaaxConfirm('Actualizar «' + (src.nombre || '') + '» en el global', _msg, _aplicar, null, { yesLabel: 'Actualizar', danger: false });
       else if (confirm(_msg)) _aplicar();
   }
   window.actualizarEnGlobal = actualizarEnGlobal;

   /* (El "limpiador de duplicados" por identidad de texto se ELIMINÓ 2026-07-06:
      la identidad de un insumo es su ID — productos distintos pueden llamarse
      igual con variedad/presentación diferente. Ver memoria del proyecto.) */

   // ── Pausar / reactivar un insumo EN LA SUCURSAL ACTIVA ───────────────────
   // Pausado = sigue viviendo aquí (membresía e historial intactos) pero deja de
   // aparecer en inventarios/escandallo/requisiciones/QR de ESTA sucursal.
   // (Inactivo GLOBAL = pastilla "Activo/Inactivo" del editor → desaparece de
   // todo el negocio y solo se ve en el catálogo global con filtro Inactivos.)
   function togglePausaInsumo(id) {
       var suc = _getSucActivaIns();
       if (!suc) return; // solo tiene sentido dentro de una sucursal
       var eff = _effSucIns(suc);
       var ins = getInsumos().find(function(x){ return x.id === id; });
       if (!ins) return;
       var p = (ins.inactivoEn || []).slice();
       var i = p.indexOf(eff);
       if (i >= 0) p.splice(i, 1); else p.push(eff);
       ins.inactivoEn = p;
       setInsumos(getInsumos());
       try { _sincronizarInsumosSupabase(getNegocioActivo(), [ins]); } catch(e) {}
       try { filtrar(); } catch(e) {}
   }
   window.togglePausaInsumo = togglePausaInsumo;

   // Sub-recetas convertidas a insumo: mostrar/ocultar MANUALMENTE en el Paso 1 del
   // inventario (default: VISIBLE — se captura la existencia del prebatch; ocultarla
   // es decisión del dueño con este botón). inventarios.js lee ins.ocultoInventario.
   function toggleVisibleInventario(id) {
       var ins = getInsumos().find(function(x){ return x.id === id; });
       if (!ins) return;
       ins.ocultoInventario = !ins.ocultoInventario;
       setInsumos(getInsumos());
       try { _sincronizarInsumosSupabase(getNegocioActivo(), [ins]); } catch(e) {}
       try { filtrar(); } catch(e) {}
   }
   window.toggleVisibleInventario = toggleVisibleInventario;

   // Llegada desde requisiciones (btn editar insumo): ?q=<nombre> prellena la busqueda.
   document.addEventListener('DOMContentLoaded', function () {
       try {
           var q = new URLSearchParams(location.search).get('q');
           if (!q) return;
           var inp = document.getElementById('buscador') || document.querySelector('input[type="search"], input[placeholder*="uscar"]');
           if (inp) { inp.value = q; inp.dispatchEvent(new Event('input', { bubbles: true })); try { filtrar(); } catch (e) {} }
       } catch (e) {}
   });

   // Reactivar un insumo INACTIVO GLOBAL (pastilla del editor) desde la lista.
   function activarInsumoGlobal(id) {
       var ins = getInsumos().find(function(x){ return x.id === id; });
       if (!ins) return;
       ins.activo = '1';
       setInsumos(getInsumos());
       try { _sincronizarInsumosSupabase(getNegocioActivo(), [ins]); } catch(e) {}
       try { filtrar(); } catch(e) {}
   }
   window.activarInsumoGlobal = activarInsumoGlobal;

   function renderStats() {
       // El stats footer se RETIRÓ de las páginas (2026-07-06); si los elementos
       // no existen, no hay nada que pintar (muchos callers siguen llamando aquí).
       if (!document.getElementById('statTotal')) return;
       // En el Catálogo Global cuenta INSUMOS ÚNICOS (deduplicados por identidad), igual que
       // el contador de arriba → antes contaba los 400 registros crudos (con duplicados) y no cuadraba.
       let insumos = _insumosScope();
       const cats    = [...new Set(insumos.map(x => x.categoria).filter(Boolean))];
       const provs   = [...new Set(insumos.flatMap(x =>
           (x.presentaciones||[]).map(p => p.proveedor).filter(Boolean)
       ))];
       const totalPres = insumos.reduce((s,x) => s + (x.presentaciones||[]).length, 0);
   
       document.getElementById('statTotal').textContent = insumos.length;
       document.getElementById('statCats').textContent  = cats.length;
       document.getElementById('statPres').textContent  = totalPres;
       document.getElementById('statProvs').textContent = provs.length;
   }
   
   // ── Filtros ───────────────────────────────────────────────────
   // Las sub-recetas convertidas a insumo NO entran en las familias normales
   // (Alimentos/Bebidas): se agrupan en su propia sección "Producción propia".
   var FAMILIA_SUBRECETA = 'Producción propia';
   function _familiaIns(ins){ return (ins && ins.esSubReceta) ? FAMILIA_SUBRECETA : ((ins && ins.familia) || ''); }

   function cargarFiltros() {
       const insumos  = getInsumos();
       const familias = [...new Set(insumos.map(x => _familiaIns(x)).filter(Boolean))].sort();
       const cats     = [...new Set(insumos.map(x => x.categoria).filter(Boolean))].sort();
       if (!familias.length && !cats.length) return; // nada que cargar aún

       const fFam = document.getElementById('filtroFamilia');
       const fCat = document.getElementById('filtroCategoria');
       if (!fFam || !fCat) return;
       const selFam = fFam.value;
       const selCat = fCat.value;

       fFam.innerHTML = '<option value="">Todas las familias</option>' +
           familias.map(f => `<option value="${etx(f)}" ${f===selFam?'selected':''}>${etx(f)}</option>`).join('');
       fCat.innerHTML = '<option value="">Todas las categorías</option>' +
           cats.map(c => `<option value="${etx(c)}" ${c===selCat?'selected':''}>${etx(c)}</option>`).join('');
   }

   function filtrar() {
       // Si los selects de filtro están vacíos (solo la opción default), recargarlos
       const fFam = document.getElementById('filtroFamilia');
       const fCat = document.getElementById('filtroCategoria');
       if (fFam && fFam.options.length <= 1) cargarFiltros();
       _poblarFiltroSucIns();

       const q      = (fFam ? document.getElementById('searchInput').value : '').toLowerCase();
       const fam    = fFam ? fFam.value : '';
       const cat    = fCat ? fCat.value : '';
       const fSucEl = document.getElementById('filtroSucursalIns');
       const sucFil = fSucEl ? fSucEl.value : '';
       const catGlobal  = _catGlobalIns();
       const sucActiva  = _getSucActivaIns();

       var lista = getInsumos();
       if (q)   lista = lista.filter(x =>
           x.nombre.toLowerCase().includes(q) ||
           (x.marca||'').toLowerCase().includes(q) ||
           (x.categoria||'').toLowerCase().includes(q)
       );
       if (fam) lista = lista.filter(x => _familiaIns(x) === fam);
       if (cat) lista = lista.filter(x => x.categoria === cat);
       // Sin sucursal = matriz. Con catálogo global, no se filtra por sucursal.
       // Filtro Estado (regla única de visibilidad — ver insumo-label.js):
       //  · Sucursal: default ACTIVOS (viven aquí, activos globales, no pausados);
       //    "Inactivos" = los PAUSADOS en esta sucursal (para reactivarlos).
       //    Los inactivos GLOBALES no aparecen en ninguna sucursal.
       //  · Global: default activos; "Inactivos" = el grupo inactivo del negocio.
       var fEstIns = document.getElementById('filtroEstadoIns');
       var estadoIns = (fEstIns && fEstIns.value) || 'activos';
       if (!catGlobal) {
           // Membresía: el insumo aparece si VIVE en esa sucursal (array `sucursales`), no por sucursalId único.
           var _sucVista = sucFil || sucActiva;
           if (_sucVista) {
               lista = lista.filter(x => window._insumoEnSuc(x, _sucVista));
               var _pausado = x => window._insumoPausadoEn && window._insumoPausadoEn(x, _effSucIns(_sucVista));
               // "Inactivos" de la sucursal = pausados AQUÍ (⏸) + inactivos GLOBALES
               // (pastilla del editor) que viven aquí — cada uno con su botón.
               lista = (estadoIns === 'inactivos')
                   ? lista.filter(x => x.activo === '0' || _pausado(x))
                   : lista.filter(x => x.activo !== '0' && !_pausado(x));
           }
       } else {
           // Catálogo GLOBAL = maestros. Las COPIAS por sucursal (origenId) NO se listan aquí
           // (viven en su sucursal); se administran/actualizan vía el botón de Novedades.
           lista = lista.filter(x => !x.origenId);
           lista = (estadoIns === 'inactivos')
               ? lista.filter(x => x.activo === '0')
               : lista.filter(x => x.activo !== '0');
       }
       // Catálogo global del negocio: TODOS los registros, SIN deduplicar por
       // nombre/marca (identidad = id: productos distintos pueden llamarse igual;
       // el dedup por texto colapsaba productos legítimos e invertía contadores).

       _listaFiltrada = lista;
       // La página se resetea SOLO cuando cambia algún filtro/búsqueda. En los
       // demás re-renders (guardar un insumo, pausar, eliminar, realtime) se
       // CONSERVA la página actual — antes editar en la página 2 te regresaba a la 1.
       var _firmaF = [q, fam, cat, sucFil, sucActiva, catGlobal, estadoIns, vistaInsumos].join('|');
       if (_firmaF !== _filtroFirmaAnt) { _paginaActual = 0; _filtroFirmaAnt = _firmaF; }
       _renderPagina();
       renderStats(); // stats por sucursal (se actualiza al cambiar el filtro de sucursal)
   }

   /* (Aviso de duplicados por texto eliminado 2026-07-06 — identidad = id.) */

   // ── Toggle vista lista / cuadrícula ───────────────────────────
   var vistaInsumos = 'lista'; // lista por default: más ligera que galería (imágenes)

   function setVistaInsumos(modo) {
       vistaInsumos = modo;
       var contLista = document.getElementById('contenedorLista');
       var contGrid  = document.getElementById('contenedorGrid');
       var contCosteo= document.getElementById('contenedorCosteo');
       var pgBar     = document.getElementById('pgBar');
       function _off(b){ if(b){ b.style.background='transparent'; b.style.color='var(--text-muted)'; } }
       function _on(b){ if(b){ b.style.background='var(--accent)'; b.style.color='#0f0e0c'; } }
       if (contLista)  contLista.style.display  = 'none';
       if (contGrid)   contGrid.style.display   = 'none';
       if (contCosteo) contCosteo.style.display = 'none';
       _off(document.getElementById('btnVistaLista'));
       _off(document.getElementById('btnVistaGrid'));
       _off(document.getElementById('btnVistaCosteo'));

       if (modo === 'costeo') {
           if (contCosteo) contCosteo.style.display = '';
           if (pgBar) pgBar.style.display = 'none';
           _on(document.getElementById('btnVistaCosteo'));
           renderCosteoBebidas();
           return;
       }
       if (pgBar) pgBar.style.display = '';
       if (modo === 'lista') { if (contLista) contLista.style.display = ''; _on(document.getElementById('btnVistaLista')); }
       else                  { if (contGrid)  contGrid.style.display  = ''; _on(document.getElementById('btnVistaGrid')); }
       filtrar();
   }

   const _PG_SIZE = 100;
   let _paginaActual = 0;
   let _listaFiltrada = [];
   let _filtroFirmaAnt = null; // firma de filtros: si no cambia, se conserva la página

   function _renderPagina() {
       const lista    = _listaFiltrada;
       const total    = lista.length;
       const totalPgs = Math.max(1, Math.ceil(total / _PG_SIZE));
       if (_paginaActual > totalPgs - 1) _paginaActual = totalPgs - 1; // la lista se encogió
       const desde    = _paginaActual * _PG_SIZE;
       const pagina   = lista.slice(desde, desde + _PG_SIZE);

       if (vistaInsumos === 'grid') {
           renderGrid(pagina);
       } else {
           renderTabla(pagina);
       }
       // El conteo separa lo que se COMPRA de lo que se PRODUCE: las sub-recetas
       // convertidas a insumo (esSubReceta) no son compras, son producción propia,
       // y mezclarlas inflaba el número del catálogo.
       const subs   = lista.filter(function (x) { return x && x.esSubReceta; }).length;
       const compra = total - subs;
       const cl = document.getElementById('countLabel');
       if (cl) cl.textContent = subs
           ? `${compra} insumo${compra !== 1 ? 's' : ''} · ${subs} sub-receta${subs !== 1 ? 's' : ''}`
           : `${total} insumo${total !== 1 ? 's' : ''}`;
       _renderPaginacion(totalPgs);
   }

   function _renderPaginacion(totalPgs) {
       var bar = document.getElementById('pgBar');
       if (!bar) return;
       // Botones de tamaño uniforme + texto con ancho fijo (antes se encimaban y
       // "se veía raro"). El pager va centrado y a la derecha vive el botón de
       // Seleccionar (misma función que el de arriba, refleja el estado actual).
       var _b = function (lbl, pg, on) {
           return on
               ? `<button onclick="_irPagina(${pg})" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 0;width:110px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:500">${lbl}</button>`
               : `<button disabled style="background:transparent;border:1px solid var(--border);color:var(--text-dim);padding:7px 0;width:110px;border-radius:8px;font-family:inherit;font-size:12px;opacity:.35;cursor:default">${lbl}</button>`;
       };
       var pager = totalPgs > 1
           ? _b('← Anterior', _paginaActual - 1, _paginaActual > 0) +
             `<span style="font-size:12px;color:var(--text-muted);min-width:96px;text-align:center;white-space:nowrap">Página ${_paginaActual+1} de ${totalPgs}</span>` +
             _b('Siguiente →', _paginaActual + 1, _paginaActual < totalPgs - 1)
           : '';
       var selOn = (typeof _modoSeleccion !== 'undefined') && _modoSeleccion;
       var sel = `<button onclick="toggleModoSeleccion()" style="background:${selOn ? 'var(--accent)' : 'transparent'};color:${selOn ? '#0f0e0c' : 'var(--text-muted)'};border:1px solid ${selOn ? 'var(--accent)' : 'var(--border)'};border-radius:8px;padding:7px 14px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap" title="Selección múltiple">${selOn ? '✕ Cancelar selección' : '☐ Seleccionar'}</button>`;
       bar.innerHTML =
           `<div style="flex:1"></div>` +
           `<div style="display:flex;align-items:center;gap:12px">${pager}</div>` +
           `<div style="flex:1;display:flex;justify-content:flex-end">${sel}</div>`;
   }

   function _irPagina(n) {
       _paginaActual = n;
       _renderPagina();
       var cont = document.getElementById('contenedorTabla') || document.getElementById('contenedorGrid');
       if (cont) cont.scrollTop = 0;
   }

   /* ════════════════════════════════════════════════════════════
      VISTA COSTEO DE BEBIDAS — tabla tipo carátula de precios.
      Destilados/Licores/Vinos: copa + botella. Cervezas/Refrescos: pieza.
      Costo = 0%; utilidad y múltiplo sobre el costo. Usa la 1ª presentación.
      ════════════════════════════════════════════════════════════ */
   function _grupoIns(ins){ return ins.subcategoria || ins.categoria || ins.familia || '—'; }
   function _costoPorMLp(p){
       var cu = parseFloat(p.costoUnitario)||0, um = (p.umCosto||'LT').toUpperCase();
       if (um==='LT') return cu/1000;
       if (um==='ML') return cu;
       var cp = parseFloat(p.costoPieza||p.precio)||0, cml = toML(p.contNeto, p.umContenido||'ML');
       return cml>0 ? cp/cml : 0;
   }
   function _cMoney(v){ return v>0 ? fmtMXN(v) : '<span style="color:var(--text-dim)">—</span>'; }
   function _cUtil(precio, costo){
       if (!(precio>0) || !(costo>0)) return '<span style="color:var(--text-dim)">—</span>';
       var pct=(precio-costo)/costo*100, mult=precio/costo, col=pct>=0?'var(--green)':'var(--red)';
       return '<span style="color:'+col+';font-weight:600">'+(pct>=0?'+':'')+pct.toFixed(0)+'%</span>'+
              '<span style="color:var(--text-dim);font-size:10px"> · '+mult.toFixed(1)+'x</span>';
   }
   var _CTH  = 'padding:8px 10px;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);text-align:right;border-bottom:1px solid var(--border);white-space:nowrap';
   var _CTHL = _CTH + ';text-align:left';
   var _CTD  = 'padding:7px 10px;font-size:12px;text-align:right;border-bottom:1px solid var(--border);white-space:nowrap';
   var _CTDL = _CTD + ';text-align:left;color:var(--text)';

   function _costeoSecTitle(txt, n){
       return '<div style="display:flex;align-items:center;gap:8px;padding:18px 16px 8px">'+
           '<span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--accent)">'+txt+'</span>'+
           '<span class="pill pill-amber" style="font-size:10px">'+n+'</span></div>';
   }
   function _unitTxt(p){
       return (parseFloat(p.costoUnitario)||0)>0
           ? fmtMXN(parseFloat(p.costoUnitario))+'<span style="color:var(--text-dim);font-size:10px">/'+(p.umCosto||'LT')+'</span>'
           : '<span style="color:var(--text-dim)">—</span>';
   }

   function renderCosteoBebidas(){
       var cont = document.getElementById('contenedorCosteo');
       if (!cont) return;
       var todos = getInsumos();
       var byN = function(a,b){ return (a.nombre||'').localeCompare(b.nombre||''); };
       var g1 = todos.filter(function(x){ return ['destilado','licor','vino'].indexOf(x.tipoInsumo)!==-1; }).sort(byN);
       var g2 = todos.filter(function(x){ return ['cerveza','cerveza_barril','refresco'].indexOf(x.tipoInsumo)!==-1; }).sort(byN);
       var html = '';
       if (g1.length) html += _costeoTablaCopa(g1, todos);
       if (g2.length) html += _costeoTablaPieza(g2);
       if (!g1.length && !g2.length)
           html = '<div class="empty-state" style="padding:48px 20px"><div class="empty-icon">🍸</div><div class="empty-title">Sin bebidas</div><div class="empty-desc">Registra destilados, licores, vinos, cervezas o refrescos para ver su costeo.</div></div>';
       cont.innerHTML = html;
       var cl = document.getElementById('countLabel'); if (cl) cl.textContent = (g1.length+g2.length)+' bebidas';
   }

   function _costeoTablaCopa(lista, todos){
       var head = '<tr>'+
           '<th style="'+_CTHL+'">Bebida</th><th style="'+_CTHL+'">Grupo</th>'+
           '<th style="'+_CTH+'">Costo unit.</th><th style="'+_CTH+'">Costo/oz</th><th style="'+_CTH+'">Costo/copa</th>'+
           '<th style="'+_CTH+'">Sug. copa</th><th style="'+_CTH+'">Carta copa</th><th style="'+_CTH+'">Utilidad copa</th>'+
           '<th style="'+_CTH+';text-align:center">Mezcl.</th>'+
           '<th style="'+_CTH+'">Costo bot.</th><th style="'+_CTH+'">Sug. bot.</th><th style="'+_CTH+'">Carta bot.</th><th style="'+_CTH+'">Utilidad bot.</th></tr>';
       var rows = lista.map(function(ins){
           var p = (ins.presentaciones||[])[0] || {};
           var cml = _costoPorMLp(p);
           var costoOz = cml*OZ_ML;
           var copaCalc = calcCostoCopa(p.costoUnitario, p.umCosto||'LT', p.tamanoCopa, p.umTamanoCopa||'ML');
           var costoCopa = copaCalc ? parseFloat(copaCalc.costoCopa)||0 : 0;
           var fCopa = parseFloat(p.factorCopa)||3.3;
           var sugCopa = costoCopa*fCopa;
           var cartaCopa = parseFloat(String(p.precioCarta||'').replace(/,/g,''))||0;
           var refIns = p.mezcladorId ? todos.find(function(x){return x.id===p.mezcladorId;}) : null;
           var mezPiezas = parseFloat(p.mezcladores)||0;
           var mezCost = (refIns&&mezPiezas>0) ? mezPiezas*_refrescoCostoPorPieza(refIns) : 0;
           var costoTrago = costoCopa+mezCost;
           var contML = toML(p.contNeto, p.umContenido||'ML');
           var costoBot = cml*contML;
           var fBot = parseFloat(p.factorBotella)||2.5;
           var sugBot = costoBot*fBot;
           var cartaBot = parseFloat(String(p.precioCartaBot||'').replace(/,/g,''))||0;
           return '<tr>'+
               '<td style="'+_CTDL+';font-weight:600">'+etx(ins.nombre)+'</td>'+
               '<td style="'+_CTDL+';color:var(--text-muted)">'+etx(_grupoIns(ins))+'</td>'+
               '<td style="'+_CTD+'">'+_unitTxt(p)+'</td>'+
               '<td style="'+_CTD+'">'+_cMoney(costoOz)+'</td>'+
               '<td style="'+_CTD+'">'+_cMoney(costoCopa)+'</td>'+
               '<td style="'+_CTD+'">'+_cMoney(sugCopa)+'<span style="color:var(--text-dim);font-size:10px"> ×'+fCopa+'</span></td>'+
               '<td style="'+_CTD+';color:var(--accent)">'+_cMoney(cartaCopa)+'</td>'+
               '<td style="'+_CTD+'">'+_cUtil(cartaCopa, costoTrago)+'</td>'+
               '<td style="'+_CTD+';text-align:center">'+(p.mezcladorId?'🥤':'<span style="color:var(--text-dim)">—</span>')+'</td>'+
               '<td style="'+_CTD+'">'+_cMoney(costoBot)+'</td>'+
               '<td style="'+_CTD+'">'+_cMoney(sugBot)+'<span style="color:var(--text-dim);font-size:10px"> ×'+fBot+'</span></td>'+
               '<td style="'+_CTD+';color:var(--accent)">'+_cMoney(cartaBot)+'</td>'+
               '<td style="'+_CTD+'">'+_cUtil(cartaBot, costoBot)+'</td>'+
               '</tr>';
       }).join('');
       return _costeoSecTitle('🥃 Destilados · Licores · Vinos', lista.length)+
           '<div class="tabla-wrap"><table style="min-width:1140px"><thead>'+head+'</thead><tbody>'+rows+'</tbody></table></div>';
   }

   function _costeoTablaPieza(lista){
       var head = '<tr>'+
           '<th style="'+_CTHL+'">Bebida</th><th style="'+_CTHL+'">Grupo</th>'+
           '<th style="'+_CTH+'">Costo unit.</th><th style="'+_CTH+'">Costo/oz</th><th style="'+_CTH+'">Costo/pza</th>'+
           '<th style="'+_CTH+'">Sug. pza</th><th style="'+_CTH+'">Carta</th><th style="'+_CTH+'">Utilidad</th></tr>';
       var rows = lista.map(function(ins){
           var p = (ins.presentaciones||[])[0] || {};
           var cml = _costoPorMLp(p);
           var costoOz = cml*OZ_ML;
           var costoPieza = parseFloat(p.costoPieza) || (parseFloat(p.precio)||0);
           var fP = parseFloat(p.factorPieza)||2.0;
           var sugPza = costoPieza*fP;
           var carta = parseFloat(String(p.precioCarta||'').replace(/,/g,''))||0;
           return '<tr>'+
               '<td style="'+_CTDL+';font-weight:600">'+etx(ins.nombre)+'</td>'+
               '<td style="'+_CTDL+';color:var(--text-muted)">'+etx(_grupoIns(ins))+'</td>'+
               '<td style="'+_CTD+'">'+_unitTxt(p)+'</td>'+
               '<td style="'+_CTD+'">'+_cMoney(costoOz)+'</td>'+
               '<td style="'+_CTD+'">'+_cMoney(costoPieza)+'</td>'+
               '<td style="'+_CTD+'">'+_cMoney(sugPza)+'<span style="color:var(--text-dim);font-size:10px"> ×'+fP+'</span></td>'+
               '<td style="'+_CTD+';color:var(--accent)">'+_cMoney(carta)+'</td>'+
               '<td style="'+_CTD+'">'+_cUtil(carta, costoPieza)+'</td>'+
               '</tr>';
       }).join('');
       return _costeoSecTitle('🍺 Cervezas · Refrescos y Sodas', lista.length)+
           '<div class="tabla-wrap"><table style="min-width:780px"><thead>'+head+'</thead><tbody>'+rows+'</tbody></table></div>';
   }

   // ── Tabla ─────────────────────────────────────────────────────
   function renderTabla(lista) {
       const tbody = document.getElementById('tbodyInsumos');
       const empty = document.getElementById('emptyState');
       if (!tbody || !empty) return;

       if (!lista.length) {
           tbody.innerHTML = '';
           empty.style.display = 'block';
           return;
       }
       empty.style.display = 'none';
   
       tbody.innerHTML = lista.map(ins => {
           const pres = ins.presentaciones || [];
           const p0   = pres[0];

           // Costo base: precio por presentación de compra (ej. $346.00 / 700 ML)
           let costo = '—';
           if (p0) {
               const precio = parseFloat(p0.precio) || 0;
               const cont   = p0.contNeto || '';
               const um     = p0.umContenido || '';
               if (precio > 0 && cont) {
                   costo = `$${precio.toFixed(2)} / ${cont} ${um}`;
               } else if (precio > 0) {
                   costo = `$${precio.toFixed(2)}`;
               } else if (p0.costoUnitario) {
                   costo = `$${(+p0.costoUnitario).toFixed(2)} / ${p0.umCosto||'LT'}`;
               }
           }
           const prov = p0?.proveedor || '—';
   
           const sel     = _modoSeleccion && _seleccionados.has(ins.id);
           const rowBg   = sel ? 'background:rgba(245,200,66,.07);' : '';
           const tdSel   = _modoSeleccion
               ? `<td data-sel-id="${ins.id}" style="width:36px;text-align:center;padding:0 10px;${rowBg}" onclick="_toggleSeleccionCard('${ins.id}',event)">
                      <input type="checkbox" ${sel?'checked':''} style="width:16px;height:16px;accent-color:var(--accent);cursor:pointer"
                          onclick="_toggleSeleccionCard('${ins.id}',event)">
                  </td>` : '';
           const accionesTd = _modoSeleccion
               ? `<td></td>`
               : `<td style="text-align:right;white-space:nowrap">
                   <button class="btn-vista" style="padding:6px 14px;font-size:12px;margin-right:6px;
                       display:inline-flex;align-items:center;gap:5px"
                       onclick="verFicha('${ins.id}')">
                       <span style="font-size:14px">👁️</span> Ver
                   </button>
                   ${_insMasBtn(ins.id)}
               </td>`;

           return `<tr data-sel-id="${ins.id}" style="${rowBg}cursor:${_modoSeleccion?'pointer':'default'}"
               ${_modoSeleccion ? `onclick="_toggleSeleccionCard('${ins.id}',event)"` : ''}>
               ${tdSel}
               <td>
                   <div style="display:flex;align-items:center;gap:10px">
                       ${ins.foto
                           ? `<img src="${etx(ins.foto)}" loading="lazy" decoding="async" style="width:36px;height:36px;border-radius:6px;object-fit:cover;border:1px solid var(--border)">`
                           : `<div style="width:36px;height:36px;border-radius:6px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:16px">${ins.esSubReceta ? '🍳' : '📦'}</div>`
                       }
                       <div>
                           <div style="font-weight:500">${etx(insumoTitulo(ins))}${ins.esSubReceta ? ' <span style="font-size:9px;background:rgba(245,200,66,.15);color:var(--accent);border:1px solid rgba(245,200,66,.3);border-radius:4px;padding:1px 6px;vertical-align:middle;white-space:nowrap">🍳 Sub-receta</span>' : ''}</div>
                           ${(insumoContenido(ins)||ins.marca) ? `<div style="font-size:11px;color:var(--text-muted)">${insumoMetaHTML(ins)}</div>` : ''}
                           ${_catGlobalIns() ? `<div style="margin-top:3px">${_insumoBadgesIns(ins)}</div>` : ''}
                       </div>
                   </div>
               </td>
               <td style="color:var(--text-muted)">${etx(ins.categoria||'')} ${ins.subcategoria ? '· '+etx(ins.subcategoria) : ''}</td>
               <td style="white-space:nowrap">
                   ${pres.map(p =>
                       `<span class="pill pill-amber" style="margin:2px;font-size:9px;white-space:nowrap">${etx(p.contNeto)} ${etx(p.umContenido)} · ${etx(p.rendimiento||'—')} ${etx(p.umRendimiento||'')}</span>`
                   ).join('')}
               </td>
               <td style="color:var(--green);font-weight:500;white-space:nowrap">${etx(costo)}</td>
               <td style="color:var(--text-muted)">${etx(prov)}</td>
               ${accionesTd}
           </tr>`;
       }).join('');
   }

   // ── Cuadrícula ────────────────────────────────────────────────
   function renderGrid(lista) {
       var grid  = document.getElementById('gridInsumos');
       var empty = document.getElementById('emptyStateGrid');
       if (!grid || !empty) return;

       if (!lista.length) {
           grid.innerHTML = '';
           empty.style.display = 'block';
           return;
       }
       empty.style.display = 'none';

       var tipoEmojis = {
           destilado:'🥃', vino:'🍷', refresco:'🥤', cerveza:'🍺',
           destilado:'🥃', licor:'🍹', vino:'🍷', refresco:'🥤', cerveza:'🍺', cerveza_barril:'🛢️',
       };

       grid.innerHTML = lista.map(function(ins) {
           var pres  = ins.presentaciones || [];
           var p0    = pres[0];
           var emoji = ins.esSubReceta ? '🍳' : (tipoEmojis[ins.tipoInsumo] || '📦');

           var costo = '—';
           if (p0) {
               var precio = parseFloat(p0.precio) || 0;
               var cont   = p0.contNeto || '';
               var um     = p0.umContenido || '';
               if (precio > 0 && cont)    costo = '$' + precio.toFixed(2) + ' / ' + cont + ' ' + um;
               else if (precio > 0)       costo = '$' + precio.toFixed(2);
               else if (p0.costoUnitario) costo = '$' + (+p0.costoUnitario).toFixed(2) + ' / ' + (p0.umCosto||'LT');
           }

           var prov         = (p0 && p0.proveedor) ? etx(p0.proveedor) : '';
           var variedadLine = etx([ins.maduracion, ins.variedad].filter(Boolean).join(' · '));
           var cat          = etx([ins.categoria, ins.subcategoria].filter(Boolean).join(' · '));
           var nPres    = pres.length;

           var fotoHTML = ins.foto
               ? '<img src="' + etx(ins.foto) + '" alt="" loading="lazy" decoding="async">'
               : '<span class="card-emoji">' + emoji + '</span>';

           var tipoBadge = ins.categoria
               ? '<div class="insumo-card-tipo-badge">' + etx(ins.familia) + '</div>'
               : '';

           var presChips = pres.slice(0,3).map(function(p) {
               return '<span class="pill pill-amber" style="font-size:9px;white-space:nowrap">' +
                   etx(p.contNeto||'') + ' ' + etx(p.umContenido||'') + '</span>';
           }).join('');
           if (nPres > 3) presChips += '<span style="font-size:9px;color:var(--text-dim)">+' + (nPres-3) + '</span>';

           var sel     = _modoSeleccion && _seleccionados.has(ins.id);
           var selStyle = sel ? 'border-color:var(--accent);background:rgba(245,200,66,.07);' : '';
           var selOverlay = _modoSeleccion
               ? '<div style="position:absolute;top:7px;left:7px;z-index:4;width:22px;height:22px;border-radius:6px;' +
                 'border:2px solid ' + (sel ? 'var(--accent)' : 'rgba(255,255,255,.45)') + ';' +
                 'background:' + (sel ? 'var(--accent)' : 'rgba(0,0,0,.45)') + ';' +
                 'display:flex;align-items:center;justify-content:center;' +
                 'font-size:13px;font-weight:700;color:#0f0e0c;pointer-events:none" class="sel-badge">' +
                 (sel ? '✓' : '') + '</div>'
               : '';
           var cardClick = _modoSeleccion
               ? 'onclick="_toggleSeleccionCard(\'' + ins.id + '\',event)" style="cursor:pointer;position:relative;' + selStyle + '"'
               : 'style="position:relative"';
           var actionsHtml = _modoSeleccion ? '' :
               '<div class="insumo-card-actions">' +
                   '<button class="btn-ver" onclick="verFicha(\'' + ins.id + '\')">👁️ Ver</button>' +
                   _insMasBtn(ins.id, 'en-card') +
               '</div>';

           return '<div class="insumo-card" data-sel-id="' + ins.id + '" ' + cardClick + '>' +
               selOverlay +
               '<div class="insumo-card-foto">' +
                   fotoHTML +
                   tipoBadge +
               '</div>' +
               '<div class="insumo-card-body">' +
                   '<div class="insumo-card-nombre" title="' + etx(insumoEtiqueta(ins)) + '">' + etx(insumoTitulo(ins)) + '</div>' +
                   (ins.esSubReceta ? '<div style="font-size:9px;color:var(--accent);margin-top:2px">🍳 Sub-receta</div>' : '') +
                   ((insumoContenido(ins)||ins.marca) ? '<div class="insumo-card-variedad">' + insumoMetaHTML(ins) + '</div>' : '') +
                   (cat ? '<div class="insumo-card-cat">' + cat + '</div>' : '') +
                   '<div class="insumo-card-costo">' + etx(costo) + '</div>' +
                   (prov ? '<div class="insumo-card-prov">📍 ' + prov + '</div>' : '') +
                   (presChips ? '<div class="insumo-card-pres">' + presChips + '</div>' : '') +
               '</div>' +
               actionsHtml +
           '</div>';
       }).join('');
   }

   // ── Selección múltiple ────────────────────────────────────────
   let _modoSeleccion = false;
   let _seleccionados = new Set();

   function toggleModoSeleccion() {
       _modoSeleccion = !_modoSeleccion;
       _seleccionados.clear();
       const btn  = document.getElementById('btnModoSeleccion');
       const bar  = document.getElementById('seleccionBar');
       const thS  = document.getElementById('thSeleccion');
       if (_modoSeleccion) {
           btn.style.background  = 'var(--accent)';
           btn.style.color       = '#0f0e0c';
           btn.style.borderColor = 'var(--accent)';
           btn.textContent       = '✕ Cancelar selección';
           bar.style.display     = 'flex';
           if (thS) thS.style.display = '';
       } else {
           btn.style.background  = 'transparent';
           btn.style.color       = 'var(--text-muted)';
           btn.style.borderColor = 'var(--border)';
           btn.textContent       = '☐ Seleccionar';
           bar.style.display     = 'none';
           if (thS) thS.style.display = 'none';
       }
       _renderPagina();
   }

   function _toggleSeleccionCard(id, e) {
       if (e) e.stopPropagation();
       if (_seleccionados.has(id)) _seleccionados.delete(id);
       else _seleccionados.add(id);
       const sel = _seleccionados.has(id);
       _actualizarBarraSeleccion();
       // Actualiza todos los elementos con data-sel-id (card en grid, td y tr en lista)
       document.querySelectorAll('[data-sel-id="' + id + '"]').forEach(function(el) {
           if (el.tagName === 'TR') {
               el.style.background = sel ? 'rgba(245,200,66,.07)' : '';
           } else if (el.tagName === 'DIV') {
               el.style.borderColor = sel ? 'var(--accent)' : '';
               el.style.background  = sel ? 'rgba(245,200,66,.07)' : '';
               const badge = el.querySelector('.sel-badge');
               if (badge) {
                   badge.textContent = sel ? '✓' : '';
                   badge.style.borderColor  = sel ? 'var(--accent)' : 'rgba(255,255,255,.45)';
                   badge.style.background   = sel ? 'var(--accent)' : 'rgba(0,0,0,.45)';
               }
           }
           const cb = el.querySelector('input[type=checkbox]');
           if (cb) cb.checked = sel;
       });
       // Actualiza el "seleccionar todos" del thead
       const chkTodos = document.getElementById('chkSelTodos');
       if (chkTodos) {
           chkTodos.checked       = _seleccionados.size === _listaFiltrada.length;
           chkTodos.indeterminate = _seleccionados.size > 0 && _seleccionados.size < _listaFiltrada.length;
       }
   }

   function _toggleSeleccionTodos(checked) {
       if (checked) _listaFiltrada.forEach(function(ins){ _seleccionados.add(ins.id); });
       else _seleccionados.clear();
       _actualizarBarraSeleccion();
       _renderPagina();
   }

   function _seleccionarTodaVista() {
       _listaFiltrada.forEach(function(ins){ _seleccionados.add(ins.id); });
       _actualizarBarraSeleccion();
       _renderPagina();
   }

   function _deseleccionarTodo() {
       _seleccionados.clear();
       _actualizarBarraSeleccion();
       _renderPagina();
   }

   function _actualizarBarraSeleccion() {
       const n      = _seleccionados.size;
       const countEl = document.getElementById('seleccionCount');
       const btnEl   = document.getElementById('btnEliminarSelec');
       if (countEl) countEl.textContent = n + ' seleccionado' + (n !== 1 ? 's' : '');
       if (btnEl) {
           btnEl.disabled     = n === 0;
           btnEl.style.opacity = n === 0 ? '.4' : '1';
           btnEl.style.cursor  = n === 0 ? 'default' : 'pointer';
       }
   }

   function _eliminarSeleccionados() {
       // Se elimina EXACTAMENTE lo seleccionado (identidad = id). La vieja cascada
       // "por identidad" en el global borraba productos distintos que se llamaban
       // igual — eliminada 2026-07-06 (el global ya no deduplica la vista).
       let ids = Array.from(_seleccionados);
       if (!ids.length) return;
       var idSet = {}; ids.forEach(function(id){ idSet[id] = 1; });
       _pedirClaveAdmin('Eliminar ' + ids.length + ' insumo' + (ids.length !== 1 ? 's' : ''), async function() {
           // Tombstones ANTES de recargar → aunque un realtime/recarga llegue con el delete en
           // vuelo, NO reviven (igual que el borrado individual). Clave para el "reset".
           _tombAdd(ids); // tombstones PERSISTENTES (sobreviven a recarga/navegación)
           setInsumos(getInsumos().filter(function(x){ return !idSet[x.id]; }));
           _seleccionados.clear();
           toggleModoSeleccion();
           try { filtrar(); renderStats(); } catch(e) {} // re-render local (sin recargar de Supabase → más rápido)
           // Borrar en Supabase y ESPERAR confirmación. Si la navegación cancela el
           // delete en vuelo, el tombstone persistente lo re-borra en la próxima carga.
           try { await _borrarInsumosSupabase(getNegocioActivo(), ids); }
           catch(e){ console.warn('[eliminar masivo] ', e); }
       });
   }

   // ── Modal insumo ──────────────────────────────────────────────
   let editandoId = null;
   let presentacionesTemp = [];
   let fotoInsumoBase64 = '';
   
   // ── Tipo de insumo activo ────────────────────────────────────
   let tipoInsumoActual = 'destilado';
   
   const SUBCATS_DESTILADO = [
       '— Seleccionar —',
       'Tequila', 'Mezcal', 'Ron', 'Vodka', 'Ginebra',
       'Whiskey (Escocés)', 'Whiskey (Irlandés)', 'Whiskey (Japonés)',
       'Bourbon / Whiskey Americano',
       'Brandy', 'Cognac', 'Pisco',
       'Sotol', 'Bacanora', 'Raicilla'
   ];

   const SUBCATS_LICOR = [
       '— Seleccionar —',
       'Aperitivo', 'Bitter', 'Vermouth', 'Vino Fortificado',
       'Licor de Frutas', 'Licor de Cítricos', 'Licor de Hierbas', 'Licor de Especias',
       'Licor Botánico', 'Licor de Semillas', 'Licor de Frutos Secos',
       'Licor de Café', 'Licor de Cacao',
       'Crema', 'Crema Irlandesa',
       'Anís', 'Sambuca', 'Absenta',
       'Triple Sec', 'Curacao', 'Amaretto',
       'Otros Licores'
   ];

   var CATS_REFRESCO = [
       'Refrescos / Sodas',
       'Jugos y Néctares',
       'Aguas',
       'Energizantes',
       'Jarabes y Siropes',
   ];

   var GRUPOS_ABARROTE = [
       '— Seleccionar grupo —',
       'Secos y Semillas',
       'Enlatados y Conservas',
       'Aceites y Grasas',
       'Lácteos',
       'Huevo y Proteínas',
       'Especias y Condimentos',
       'Líquidos y Mezcladores',
       'Panadería y Repostería',
   ];

   const TIPO_CONFIG = {
       destilado: { label:'Destilado',       icon:'🥃', familia:'Bebidas', categoria:'Destilados',
           campos: ['contenido','rendimiento','peso','proveedor','costeo','copa','precioManual','presentacionCompra'] },
       licor:     { label:'Licor',           icon:'🍹', familia:'Bebidas', categoria:'Licores',
           campos: ['contenido','rendimiento','peso','proveedor','costeo','copa','precioManual','presentacionCompra'] },
       vino:      { label:'Vinos de mesa', icon:'🍷', familia:'Bebidas', categoria:'Vinos',
           campos: ['contenido','rendimiento','peso','proveedor','costeo','copa','precioManual','presentacionCompra'] },
       refresco:  { label:'Refrescos, sodas, jugos...', icon:'🧃', familia:'Bebidas', categoria:'',
           campos: ['contenido','rendimiento','proveedor','costeo','precioManual','presentacionCompra'] },
       cerveza:   { label:'Cerveza',           icon:'🍺', familia:'Bebidas', categoria:'Cervezas',
           campos: ['contenido','rendimiento','proveedor','costeo','precioManual','presentacionCompra'] },
       cerveza_barril: { label:'Cerveza de barril', icon:'🛢️', familia:'Bebidas', categoria:'Cervezas',
           campos: ['contenido','rendimiento','proveedor','costeo','precioManual','presentacionCompra'] },
       abarrote:  { label:'Abarrotes y más',   icon:'🧂', familia:'Abarrotes', categoria:'',
           campos: ['contenido','rendimiento','proveedor','costeo','presentacionCompra'] },
       carne:     { label:'Proteínas',           icon:'🥩', familia:'Proteínas', categoria:'',
           campos: ['pesoCompra','proveedor','costeo','presentacionCompra'] },
       fruta:     { label:'Fruta y Verdura',   icon:'🥬', familia:'Frutas y Verduras', categoria:'',
           campos: ['pesoCompra','proveedor','costeo','presentacionCompra'] },
       otro:      { label:'Otro',              icon:'📦', familia:'', categoria:'',
           campos: ['contenido','proveedor','costeo','presentacionCompra'] },
   };
   
   // ── Listas para vinos ────────────────────────────────────────
   var TIPOS_VINO = [
       'Vino Tinto',
       'Vino Blanco',
       'Vino Rosado',
       'Vino Espumoso / Cava / Champagne',
       'Vino Naranja (Orange Wine)',
       'Vino Dulce / De Postre (Late Harvest, Ice Wine)',
       'Vino Generoso / Fortificado (Oporto, Jerez)',
       'Vino Sin Alcohol / Desalcoholizado'
   ];

   var UVAS_VINO = [
       'Cabernet Sauvignon','Merlot','Syrah / Shiraz','Pinot Noir','Malbec',
       'Tempranillo','Nebbiolo','Carmenère','Sangiovese','Zinfandel',
       'Garnacha / Grenache','Cabernet Franc','Petit Verdot',
       'Chardonnay','Sauvignon Blanc','Chenin Blanc','Riesling',
       'Pinot Grigio / Pinot Gris','Albariño','Moscato / Moscatel',
       'Macabeo','Verdejo',
       'Ensamble Tinto (Blend)','Ensamble Blanco (Blend)','Sin Especificar / Vino de Casa'
   ];

   var TEMPS_VINO = [
       '4°C a 8°C (Refrigeración Profunda / Espumosos y Dulces)',
       '8°C a 12°C (Cava Fría / Blancos y Rosados)',
       '13°C a 15°C (Cava Templada / Tintos Jóvenes y Ligeros)',
       '16°C a 18°C (Cava Clásica / Tintos de Crianza, Reserva y Gran Reserva)',
       '19°C a 22°C (Temperatura Ambiente Controlada / Almacén)'
   ];

   // ── Listas para proteínas ────────────────────────────────────
   var CATS_PROTEINA = ['— Seleccionar —','Res','Cerdo','Pollo','Pescado','Marisco','Molusco','Ave','Caza'];
   var ESTADOS_PROTEINA = [
       'Fresco / Refrigerado (0°C a 4°C)',
       'Congelado (-18°C o menos)',
       'IQF — Congelado Individual (-18°C)'
   ];
   var TEMPS_PROTEINA = [
       '0°C a 4°C (Refrigeración — Frescos)',
       '-18°C o menos (Congelación profunda)',
       '-25°C a -30°C (Ultracongelación / IQF)'
   ];

   // ── Listas para frutas y verduras ────────────────────────────
   var CATS_FRUTA = [
       '— Seleccionar —',
       'Fruta tropical','Fruta de temporada','Fruta cítrica','Fruta seca / deshidratada',
       'Verdura de hoja verde','Verdura de raíz','Verdura crucífera',
       'Allium (cebolla, ajo, poro)','Legumbre fresca','Hierba aromática / Quelite',
       'Hongo / Seta','Tubérculo','Germinado / Microgreen','Flor comestible'
   ];
   var TIPOS_COMPRA_FRUTA = [
       '— Seleccionar —',
       'A granel — por kg (peso exacto)',
       'Por pieza (peso variable)',
       'Por manojo / atado (peso variable)',
       'Por caja o cubeta',
       'Por bolsa o red (peso aprox.)',
       'Por charola o bandeja'
   ];
   var ALMACENAJE_FRUTA = [
       'Refrigeración 0°C a 4°C (hoja verde, hierbas, setas)',
       'Refrigeración 4°C a 8°C (cítricos, crucíferas, raíces)',
       'Temperatura fresca 8°C a 12°C (tomate maduro, aguacate abierto)',
       'Temperatura ambiente 15°C a 20°C (plátano, aguacate verde, mango verde)',
       'Oscuridad seca — bodega (papa, cebolla, ajo)',
       'Sumergida en agua fría (hierbas frescas, flores comestibles)'
   ];

   function toggleUvaChip(uva) {
       var hidden = document.getElementById('ins-variedad');
       if (!hidden) return;
       var vals = hidden.value ? hidden.value.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
       var idx = vals.indexOf(uva);
       if (idx >= 0) vals.splice(idx, 1); else vals.push(uva);
       hidden.value = vals.join(', ');
       modalDirty = true;
       document.querySelectorAll('#uva-picker .uva-chip').forEach(function(c) {
           c.classList.toggle('active', vals.includes(c.dataset.uva));
       });
   }

   function agregarUvaPersonalizada() {
       var inp = document.getElementById('uva-nueva-input');
       if (!inp) return;
       var nombre = inp.value.trim();
       if (!nombre) return;
       var hidden = document.getElementById('ins-variedad');
       if (!hidden) return;
       var vals = hidden.value ? hidden.value.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
       // Ignorar si ya existe (case-insensitive)
       if (vals.some(function(v){ return v.toLowerCase() === nombre.toLowerCase(); })) {
           inp.value = ''; return;
       }
       vals.push(nombre);
       hidden.value = vals.join(', ');
       modalDirty = true;
       // Crear chip en el picker
       var picker = document.getElementById('uva-picker');
       if (picker) {
           var esc = nombre.replace(/'/g, "\\'");
           var chip = document.createElement('div');
           chip.className = 'uva-chip active';
           chip.dataset.uva = nombre;
           chip.innerHTML = etx(nombre) + ' <span style="opacity:.5;font-size:9px">✕</span>';
           chip.onclick = function(){ toggleUvaChip(esc); };
           picker.appendChild(chip);
       }
       inp.value = '';
       inp.focus();
   }

   // ── Ajustar campos del modal según tipo de insumo ────────────
   var FAMILIA_POR_TIPO = {
       destilado: 'Bebidas', licor: 'Bebidas', vino: 'Bebidas', cerveza: 'Bebidas', cerveza_barril: 'Bebidas', refresco: 'Bebidas',
       carne: 'Proteínas', fruta: 'Frutas y Verduras', abarrote: 'Abarrotes', otro: ''
   };

   /* ── Subcategorías personalizadas (agregar manualmente, como en gastos) ──
      Lista = base predefinida + las que el usuario agregó (localStorage por
      negocio) + las ya usadas por insumos del catálogo. Sin migración. */
   var _SUBCAT_SEL = 'width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none';
   var _subcatsCustom = null;

   function _loadSubcatsCustom() {
       if (_subcatsCustom) return _subcatsCustom;
       try { _subcatsCustom = JSON.parse(_skGet('subcats_custom')) || {}; }
       catch (e) { _subcatsCustom = {}; }
       return _subcatsCustom;
   }
   function _saveSubcatsCustom() {
       try { localStorage.setItem(_sk('subcats_custom'), JSON.stringify(_subcatsCustom || {})); } catch (e) {}
       _pushSubcatsCloud(); // respaldo en la nube (inv_ajustes.subcats)
   }
   // Sincronización en la nube de las subcategorías propias (antes solo localStorage).
   // Read-modify-write del doc inv_ajustes para no pisar compuestos/bateo/metodos.
   async function _pushSubcatsCloud() {
       var negId = (typeof getNegocioActivo === 'function' && getNegocioActivo()) || '';
       if (!negId || typeof _supabase === 'undefined' || typeof sbUpsertDoc !== 'function') return;
       try {
           var r = await _supabase.from('inv_ajustes').select('datos').eq('negocio_id', negId).maybeSingle();
           var d = (r && r.data && r.data.datos) || {};
           d.subcats = _subcatsCustom || {};
           sbUpsertDoc('inv_ajustes', d, negId);
       } catch (e) {}
   }
   async function _pullSubcatsCloud(negId) {
       if (!negId || typeof _supabase === 'undefined') return;
       try {
           var r = await _supabase.from('inv_ajustes').select('datos').eq('negocio_id', negId).maybeSingle();
           if (r.error || !r.data) return;
           var sc = (r.data.datos || {}).subcats;
           if (sc && typeof sc === 'object') {
               _subcatsCustom = sc;
               try { localStorage.setItem(_sk('subcats_custom'), JSON.stringify(sc)); } catch (e) {}
           }
       } catch (e) {}
   }

   function _subcatsLista(tipo) {
       var base = tipo === 'destilado' ? SUBCATS_DESTILADO
                : tipo === 'licor'     ? SUBCATS_LICOR
                : tipo === 'abarrote'  ? GRUPOS_ABARROTE
                : null;
       if (!base) return null;
       var out = base.slice();
       (_loadSubcatsCustom()[tipo] || []).forEach(function (s) { if (s && out.indexOf(s) === -1) out.push(s); });
       try {
           getInsumos().forEach(function (x) {
               if (x.tipoInsumo === tipo && x.subcategoria && out.indexOf(x.subcategoria) === -1) out.push(x.subcategoria);
           });
       } catch (e) {}
       return out;
   }

   function _subcatSelectHTML(tipo, currentSub) {
       var lista = _subcatsLista(tipo);
       var label = tipo === 'abarrote' ? 'Grupo de abarrote' : 'Subcategoría';
       var opts = lista.map(function (s) {
           var val = s === '— Seleccionar —' ? '' : s;
           return '<option value="' + etx(val) + '"' + (currentSub === val ? ' selected' : '') + '>' + etx(s) + '</option>';
       }).join('');
       opts += '<option value="__add__">➕ Agregar nueva…</option>';
       return '<label>' + label + '</label>' +
           '<select id="ins-subcategoria" style="' + _SUBCAT_SEL + '" onchange="_onSubcatChange(this,\'' + tipo + '\')">' + opts + '</select>';
   }

   function _onSubcatChange(sel, tipo) {
       if (sel.value !== '__add__') return;
       sel.value = ''; // reset mientras se captura
       var _ask = window.etaaxPrompt || function(t,d,cb){ cb(window.prompt(t) || ''); };
       _ask('Nueva subcategoría', '', function(val){
           var nombre = (val || '').trim();
           if (!nombre) return;
           var cust = _loadSubcatsCustom();
           if (!cust[tipo]) cust[tipo] = [];
           if (cust[tipo].indexOf(nombre) === -1) cust[tipo].push(nombre);
           _saveSubcatsCustom();
           var wrap = sel.parentElement;
           if (wrap) wrap.innerHTML = _subcatSelectHTML(tipo, nombre);
       }, { icon:'🏷️', placeholder:'Ej. Quesos, Embutidos…' });
   }

   function ajustarCamposPorTipo(tipo) {
       var SEL = 'width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none';

       // Reset order, spans y visibilidad de empaque (limpio antes de aplicar carne)
       ['row-nombre','row-familia','row-categoria','row-marca','row-variedad',
        'row-maduracion','row-temp-conservacion','row-vida-util-abrir','row-subcategoria','row-empaque']
           .forEach(function(id) {
               var el = document.getElementById(id);
               if (el) el.style.order = '';
           });
       var _rvag = document.getElementById('row-vida-util-abrir');
       var _rsag = document.getElementById('row-subcategoria');
       if (_rvag) _rvag.style.gridColumn = '';
       if (_rsag) _rsag.style.gridColumn = '';
       var _remp = document.getElementById('row-empaque');
       if (_remp) _remp.style.display = '';

       // Reset filas exclusivas de frutas
       var _rcong = document.getElementById('row-como-congelar');
       var _rvidc = document.getElementById('row-vida-congelado');
       if (_rcong) { _rcong.style.display = 'none'; _rcong.style.gridColumn = ''; _rcong.style.order = ''; }
       if (_rvidc) { _rvidc.style.display = 'none'; _rvidc.style.gridColumn = ''; _rvidc.style.order = ''; }

       // Auto-rellenar familia
       var elFam = document.getElementById('ins-familia');
       if (elFam && !elFam.value) elFam.value = FAMILIA_POR_TIPO[tipo] || '';

       // Marca base
       var rowMarca = document.getElementById('row-marca');
       if (rowMarca) {
        var ocultarMarca = ['cerveza','cerveza_barril','refresco','abarrote'].includes(tipo);
           rowMarca.style.display = ocultarMarca ? 'none' : '';
           var lblMarca = rowMarca.querySelector('label');
           if (lblMarca) lblMarca.textContent = tipo === 'vino' ? 'Bodega / Productor' : tipo === 'carne' ? 'Marca / Empacador' : (['destilado','licor'].includes(tipo) ? 'Marca del producto' : 'Marca base');
           var elMarca = document.getElementById('ins-marca');
           if (elMarca) elMarca.placeholder = tipo === 'vino' ? 'Ej. Casillero del Diablo, Zuccardi' : tipo === 'carne' ? 'Ej. La Superior, Don Jorge, Rancho Campestre' : (['destilado','licor'].includes(tipo) ? 'Ej. Tanqueray, Havana, 400 Conejos' : 'Ej. La Costeña');
       }

       // ── Variedad / Tipo de uva (ins-variedad) ──────────────────
       var varEl = document.getElementById('ins-variedad');
       var varWrap = varEl ? varEl.closest('.meta-item') : null;
       if (varWrap) {
           var currentVar = varEl.value || '';
           if (tipo === 'vino') {
               varWrap.style.gridColumn = 'span 2';
               var selUvas = currentVar ? currentVar.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
               // Chips del catálogo predefinido
               var chips = UVAS_VINO.map(function(u) {
                   var esc = u.replace(/'/g, "\\'");
                   return '<div class="uva-chip' + (selUvas.includes(u) ? ' active' : '') + '" ' +
                       'data-uva="' + u + '" onclick="toggleUvaChip(\'' + esc + '\')">' + u + '</div>';
               }).join('');
               // Chips de uvas personalizadas (están en la selección pero no en UVAS_VINO)
               var customChips = selUvas.filter(function(u){ return !UVAS_VINO.includes(u); }).map(function(u) {
                   var esc = u.replace(/'/g, "\\'");
                   return '<div class="uva-chip active" data-uva="' + u + '" onclick="toggleUvaChip(\'' + esc + '\')">'
                       + u + ' <span style="opacity:.5;font-size:9px">✕</span></div>';
               }).join('');
               varWrap.innerHTML = '<label id="lbl-variedad" style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);display:block;margin-bottom:4px">'
                   + 'Tipo de uva <span style="opacity:.5;font-weight:400">(selección múltiple)</span></label>'
                   + '<div id="uva-picker" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;'
                   + 'max-height:180px;overflow-y:auto;padding:6px 2px;border-top:1px solid var(--border)">'
                   + chips + customChips
                   + '</div>'
                   + '<div style="display:flex;gap:6px;margin-top:8px;align-items:center">'
                   + '<input type="text" id="uva-nueva-input" placeholder="Otra uva o cepa…" '
                   + 'style="flex:1;font-size:12px;padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:inherit" '
                   + 'onkeydown="if(event.key===\'Enter\'){event.preventDefault();agregarUvaPersonalizada()}">'
                   + '<button onclick="agregarUvaPersonalizada()" '
                   + 'style="background:var(--surface2);border:1px solid var(--border);color:var(--text-muted);border-radius:6px;padding:6px 12px;font-family:inherit;font-size:12px;cursor:pointer;white-space:nowrap">+ Agregar</button>'
                   + '</div>'
                   + '<input type="hidden" id="ins-variedad" value="' + currentVar + '">';
           } else {
               varWrap.style.gridColumn = '';
               if (document.getElementById('uva-picker')) {
                   varWrap.innerHTML = '<label id="lbl-variedad">Marca del producto</label>'
                       + '<input type="text" id="ins-variedad" value="' + currentVar + '" placeholder="Ej. Absolut">';
               }
               var lblV = document.getElementById('lbl-variedad');
               if (lblV) {
                   if (['cerveza','cerveza_barril','refresco'].includes(tipo)) lblV.textContent = 'Marca del producto';
                   else if (tipo === 'abarrote') lblV.textContent = 'Marca / Variedad';
                   else if (tipo === 'carne') lblV.textContent = 'Corte / Variedad';
                   else if (tipo === 'fruta') lblV.textContent = 'Variedad comercial';
                   else lblV.textContent = 'Variedad';
               }
           }
       }

       // ── Añejamiento / Tipo de vino / Tipo de compra (ins-maduracion) ──
       var rowMad = document.getElementById('row-maduracion');
       if (rowMad) {
        rowMad.style.display = ['vino','refresco','cerveza','cerveza_barril','carne','fruta'].includes(tipo) ? '' : 'none';
           var madEl = document.getElementById('ins-maduracion');
           var currentMad = madEl ? madEl.value || '' : '';
           if (tipo === 'vino') {
               rowMad.innerHTML = '<label id="lbl-maduracion">Añejamiento</label>' +
                   '<input type="text" id="ins-maduracion" value="' + currentMad + '" ' +
                   'placeholder="Ej. 10 años en roble, Reserva, Crianza, Sin roble">';
           } else if (tipo === 'refresco') {
               if (madEl && madEl.tagName === 'SELECT') {
                   rowMad.innerHTML = '<label id="lbl-maduracion">Sabor / Variedad</label>' +
                       '<input type="text" id="ins-maduracion" value="' + currentMad + '" ' +
                       'placeholder="Ej. Original, Light, Zero, Sin Azúcar">';
               } else if (madEl) {
                   var lblMadR = document.getElementById('lbl-maduracion');
                   if (lblMadR) lblMadR.textContent = 'Sabor / Variedad';
                   madEl.placeholder = 'Ej. Original, Light, Zero, Sin Azúcar';
               }
           } else if (['cerveza','cerveza_barril'].includes(tipo)) {
               if (madEl && madEl.tagName === 'SELECT') {
                   rowMad.innerHTML = '<label id="lbl-maduracion">Estilo / Variedad</label>' +
                       '<input type="text" id="ins-maduracion" value="' + currentMad + '" ' +
                       'placeholder="Ej. Clara, Oscura, Stout, IPA, Weizen, Artesanal">';
               } else if (madEl) {
                   var lblMadC = document.getElementById('lbl-maduracion');
                   if (lblMadC) lblMadC.textContent = 'Estilo / Variedad';
                   madEl.placeholder = 'Ej. Clara, Oscura, Stout, IPA, Weizen, Artesanal';
               }
           } else if (tipo === 'carne') {
               var currentMadC = madEl ? madEl.value || '' : '';
               var optEst = ESTADOS_PROTEINA.map(function(t) {
                   return '<option value="' + t + '"' + (currentMadC === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowMad.innerHTML = '<label id="lbl-maduracion">Estado de compra</label>' +
                   '<select id="ins-maduracion" style="' + SEL + '">' +
                   '<option value="">— Seleccionar estado —</option>' + optEst + '</select>';
           } else if (tipo === 'fruta') {
               var currentMadF = madEl ? madEl.value || '' : '';
               var optCompraF = TIPOS_COMPRA_FRUTA.map(function(t) {
                   var val = t === '— Seleccionar —' ? '' : t;
                   return '<option value="' + val + '"' + (currentMadF === val ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowMad.innerHTML = '<label id="lbl-maduracion">Tipo de compra</label>' +
                   '<select id="ins-maduracion" style="' + SEL + '">' + optCompraF + '</select>';
           } else {
               if (madEl && madEl.tagName === 'SELECT') {
                   rowMad.innerHTML = '<label id="lbl-maduracion">Variedad / Añejamiento</label>' +
                       '<input type="text" id="ins-maduracion" value="' + currentMad + '" ' +
                       'placeholder="Ej. Reposado, Original, 12 años...">';
               } else if (madEl) {
                   var lblMad = document.getElementById('lbl-maduracion');
                   if (lblMad) lblMad.textContent = 'Variedad / Añejamiento';
               }
           }
       }

       // ── Placeholders ────────────────────────────────────────────
       var elNombre  = document.getElementById('ins-nombre');
       var elEmpaque = document.getElementById('ins-empaque');
       var elMad2    = document.getElementById('ins-maduracion');
       var elVar2    = document.getElementById('ins-variedad');
       if (tipo === 'licor') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Original, Menta, Rosso, Seco';
           if (elNombre)  elNombre.placeholder  = 'Ej. Baileys, Aperol, Licor 43, Kahlúa';
           if (elMad2 && elMad2.tagName !== 'SELECT') elMad2.placeholder = 'Ej. Original, Menta, Rosso, Seco';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Botella de vidrio, Garrafa, Lata';
       } else if (tipo === 'destilado') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Reposado, Añejo, Ten, 7 años';
           if (elNombre)  elNombre.placeholder  = 'Ej. Tanqueray, Patrón, Havana, 400 Conejos';
           if (elMad2 && elMad2.tagName !== 'SELECT') elMad2.placeholder = 'Ej. Reposado, Original, 12 años...';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Botella vidrio, Garrafa, Lata';
       } else if (tipo === 'vino') {
           if (elNombre)  elNombre.placeholder  = 'Ej. Casillero del Diablo, Don Melchor, Zuccardi';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Vidrio, Tetrapack, Bag in Box, Magnum';
       } else if (tipo === 'refresco') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Coca-Cola, Jarritos, Sidral Mundet';
           if (elNombre)  elNombre.placeholder  = 'Ej. Coca, Fanta, Sprite, Naranjada';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Lata 355ml, PET 600ml, Vidrio 355ml';
       } else if (tipo === 'cerveza') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Corona, Modelo, Heineken, Pacifico, Artesanal';
           if (elNombre)  elNombre.placeholder  = 'Ej. Corona Extra, Modelo Especial, Bohemia Oscura';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Botella 355ml, Lata 355ml, Caguama 940ml';
       } else if (tipo === 'cerveza_barril') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Corona, Modelo, Heineken, Artesanal';
           if (elNombre)  elNombre.placeholder  = 'Ej. Corona Extra de barril, Modelo de grifo';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Barril 20L, Tina 50L, Barril americano 58.7L';
       } else if (tipo === 'abarrote') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Del Monte, La Costeña, Herdez, Lala, Nestlé';
           if (elNombre)  elNombre.placeholder  = 'Ej. Arroz, Atún en agua, Aceite de oliva, Harina, Sal';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Bolsa 1kg, Lata 400g, Botella 1L, Frasco 250g';
       } else if (tipo === 'carne') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Rib Eye, T-Bone, Pechuga s/h, Lomo entero';
           if (elNombre)  elNombre.placeholder  = 'Ej. Rib Eye Black Angus, Camarón 21/25, Pechuga de Pollo';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Caja 10kg, Bolsa cryovac, Bolsa individual 200g';
       } else if (tipo === 'fruta') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Hass, Roma, Tabasco, Cherry, Manila';
           if (elNombre)  elNombre.placeholder  = 'Ej. Aguacate Hass, Jitomate Roma, Plátano Tabasco';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Caja 20kg, Costal 25kg, Bolsa 5kg';
       } else if (tipo === 'otro') {
           if (elVar2 && elVar2.type !== 'hidden') elVar2.placeholder = 'Ej. Látex, Nitrilo, Talla M, 500ml';
           if (elNombre)  elNombre.placeholder  = 'Ej. Guantes desechables, Charolas aluminio, Palillos';
           if (elEmpaque) elEmpaque.placeholder = 'Ej. Caja 100 pzas, Paquete x50, Frasco 1L';
       }

       // ── Categoría: ocultar para abarrote (usa familia+grupo) ─────
       var catEl = document.getElementById('ins-categoria');
       var catWrap = catEl ? catEl.closest('.meta-item') : null;
       if (catWrap) {
           catWrap.style.display = tipo === 'abarrote' ? 'none' : '';
           if (tipo === 'abarrote') catEl.value = 'Abarrotes'; // valor silencioso
       }
       if (catWrap && tipo !== 'abarrote') {
           var currentCat = catEl.value || '';
           if (tipo === 'vino') {
               var optCats = TIPOS_VINO.map(function(t) {
                   return '<option value="' + t + '"' + (currentCat === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               catWrap.innerHTML = '<label>Tipo de vino</label>' +
                   '<select id="ins-categoria" style="' + SEL + '">' +
                   '<option value="">— Tipo de vino —</option>' + optCats + '</select>';
           } else if (tipo === 'refresco') {
               var optRef = CATS_REFRESCO.map(function(t) {
                   return '<option value="' + t + '"' + (currentCat === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               catWrap.innerHTML = '<label>Categoría</label>' +
                   '<select id="ins-categoria" style="' + SEL + '">' +
                   '<option value="">— Seleccionar —</option>' + optRef + '</select>';
           } else if (tipo === 'carne') {
               var optCarne = CATS_PROTEINA.map(function(t) {
                   var val = t === '— Seleccionar —' ? '' : t;
                   return '<option value="' + val + '"' + (currentCat === val ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               catWrap.innerHTML = '<label>Tipo de proteína</label>' +
                   '<select id="ins-categoria" style="' + SEL + '">' + optCarne + '</select>';
           } else if (tipo === 'fruta') {
               var optFruta = CATS_FRUTA.map(function(t) {
                   var val = t === '— Seleccionar —' ? '' : t;
                   return '<option value="' + val + '"' + (currentCat === val ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               catWrap.innerHTML = '<label>Tipo de producto</label>' +
                   '<select id="ins-categoria" style="' + SEL + '">' + optFruta + '</select>';
           } else {
               if (catEl.tagName === 'SELECT') {
                   catWrap.innerHTML = '<label>Categoría</label>' +
                       '<input type="text" id="ins-categoria" value="' + currentCat + '" placeholder="Ej. Destilados"' +
                       ' readonly style="opacity:.55;cursor:default;pointer-events:none">';
               }
           }
       }

       // ── Temperatura de conservación / almacenaje ────────────────
       var rowTemp = document.getElementById('row-temp-conservacion');
       var rowVida = document.getElementById('row-vida-util-abrir');
       if (rowTemp) {
           rowTemp.style.display = (tipo === 'vino' || tipo === 'carne' || tipo === 'fruta') ? '' : 'none';
           if (tipo === 'vino') {
               var tempEl = document.getElementById('ins-tempConservacion');
               var currentTemp = tempEl ? tempEl.value || '' : '';
               var optTemps = TEMPS_VINO.map(function(t) {
                   return '<option value="' + t + '"' + (currentTemp === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowTemp.innerHTML = '<label>Temperatura de conservación</label>' +
                   '<select id="ins-tempConservacion" style="' + SEL + '">' +
                   '<option value="">— Seleccionar temperatura —</option>' + optTemps + '</select>';
           } else if (tipo === 'carne') {
               var tempElC = document.getElementById('ins-tempConservacion');
               var currentTempC = tempElC ? tempElC.value || '' : '';
               var optTempsC = TEMPS_PROTEINA.map(function(t) {
                   return '<option value="' + t + '"' + (currentTempC === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowTemp.innerHTML = '<label>Temperatura de almacenaje</label>' +
                   '<select id="ins-tempConservacion" style="' + SEL + '">' +
                   '<option value="">— Seleccionar temperatura —</option>' + optTempsC + '</select>';
           } else if (tipo === 'fruta') {
               var tempElF = document.getElementById('ins-tempConservacion');
               var currentTempF = tempElF ? tempElF.value || '' : '';
               var optAlmF = ALMACENAJE_FRUTA.map(function(t) {
                   return '<option value="' + t + '"' + (currentTempF === t ? ' selected' : '') + '>' + t + '</option>';
               }).join('');
               rowTemp.innerHTML = '<label>Almacenaje fresco</label>' +
                   '<select id="ins-tempConservacion" style="' + SEL + '">' +
                   '<option value="">— Cómo almacenar —</option>' + optAlmF + '</select>';
           } else {
               var tempEl2 = document.getElementById('ins-tempConservacion');
               if (tempEl2 && tempEl2.tagName === 'SELECT') {
                   rowTemp.innerHTML = '<label>Temperatura de conservación</label>' +
                       '<input type="text" id="ins-tempConservacion" placeholder="Ej. 12-16°C">';
               }
           }
       }
       if (rowVida) {
           rowVida.style.display = (tipo === 'vino' || tipo === 'carne' || tipo === 'fruta') ? '' : 'none';
           if (tipo === 'vino') {
               var vidaEl = document.getElementById('ins-vidaUtilAbrir');
               var vidaEl2 = document.getElementById('ins-vidaUtilAbrirNum');
               // Solo reemplazar si aún no se ha convertido
               if (vidaEl && !vidaEl2) {
                   var selVida = '<select id="ins-vidaUtilAbrirUnidad" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none">' +
                       ['días','semanas','meses'].map(function(u){ return '<option>' + u + '</option>'; }).join('') + '</select>';
                   rowVida.innerHTML = '<label>Vida útil al abrir</label>' +
                       '<div style="display:flex;gap:6px">' +
                       '<input type="number" id="ins-vidaUtilAbrirNum" placeholder="3" min="1" ' +
                       'style="width:80px;flex-shrink:0">' + selVida + '</div>';
               }
           } else if (tipo === 'carne') {
               var vidaElC  = document.getElementById('ins-vidaUtilAbrir');
               var vidaNumC = document.getElementById('ins-vidaUtilAbrirNum');
               if (!vidaNumC) {
                   var existingVidaC = vidaElC ? vidaElC.value || '' : '';
                   var matchVidaC    = existingVidaC.match(/^(\d+)\s+(.+)$/);
                   var numValC  = matchVidaC ? matchVidaC[1] : '';
                   var unitValC = matchVidaC ? matchVidaC[2] : 'horas';
                   var selVidaC = '<select id="ins-vidaUtilAbrirUnidad" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none">' +
                       ['horas','días','semanas'].map(function(u){ return '<option value="'+u+'"'+(unitValC===u?' selected':'')+'>'+u+'</option>'; }).join('') + '</select>';
                   rowVida.innerHTML = '<label>Vida útil post-descongelación</label>' +
                       '<div style="display:flex;gap:6px">' +
                       '<input type="number" id="ins-vidaUtilAbrirNum" placeholder="48" min="1" value="'+numValC+'" ' +
                       'style="width:80px;flex-shrink:0">' + selVidaC + '</div>';
               }
           } else if (tipo === 'fruta') {
               var vidaElF  = document.getElementById('ins-vidaUtilAbrir');
               var vidaNumF = document.getElementById('ins-vidaUtilAbrirNum');
               if (!vidaNumF) {
                   var existingVidaF = vidaElF ? vidaElF.value || '' : '';
                   var matchVidaF    = existingVidaF.match(/^(\d+)\s+(.+)$/);
                   var numValF  = matchVidaF ? matchVidaF[1] : '';
                   var unitValF = matchVidaF ? matchVidaF[2] : 'días';
                   var selVidaF = '<select id="ins-vidaUtilAbrirUnidad" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none">' +
                       ['horas','días','semanas','meses'].map(function(u){ return '<option value="'+u+'"'+(unitValF===u?' selected':'')+'>'+u+'</option>'; }).join('') + '</select>';
                   rowVida.innerHTML = '<label>Vida útil fresca</label>' +
                       '<div style="display:flex;gap:6px">' +
                       '<input type="number" id="ins-vidaUtilAbrirNum" placeholder="7" min="1" value="'+numValF+'" ' +
                       'style="width:80px;flex-shrink:0">' + selVidaF + '</div>';
               }
           } else {
               // Restaurar texto si venía de vino o carne
               var numEl3 = document.getElementById('ins-vidaUtilAbrirNum');
               if (numEl3) {
                   rowVida.innerHTML = '<label>Vida útil al abrir</label>' +
                       '<input type="text" id="ins-vidaUtilAbrir" ' +
                       'placeholder="Ej. 3 días, 1 semana, 2-3 semanas">';
               }
           }
       }

       // ── Subcategoría ────────────────────────────────────────────
       var rowSub = document.getElementById('row-subcategoria');
       if (rowSub) rowSub.style.display = (tipo === 'vino' || tipo === 'refresco' || tipo === 'cerveza') ? 'none' : '';

       if (tipo !== 'vino') {
           var subcatEl = document.getElementById('ins-subcategoria');
           var subcatWrap = subcatEl ? subcatEl.parentElement : null;
           if (subcatWrap) {
               var currentSub = subcatEl.value || '';
               var listaSub = tipo === 'destilado' ? SUBCATS_DESTILADO
                            : tipo === 'licor'     ? SUBCATS_LICOR
                            : tipo === 'abarrote'  ? GRUPOS_ABARROTE
                            : null;
               if (listaSub) {
                   subcatWrap.innerHTML = _subcatSelectHTML(tipo, currentSub);
               } else {
                   var esDesce  = tipo === 'carne' || tipo === 'fruta';
                   var subLabel = esDesce ? 'Método de descongelación'
                                : tipo === 'otro' ? 'Subcategoría / Uso' : 'Subcategoría';
                   var subPh    = esDesce ? 'Ej. Refrigeración gradual, Chorro de agua fría, Cocción directa'
                                : tipo === 'otro' ? 'Ej. Limpieza de cocina, Protección personal, Servicio'
                                : 'Ej. Vodka';
                   var subOpc   = esDesce ? '(opcional)' : '';
                   subcatWrap.innerHTML = '<label>' + subLabel + ' <span style="opacity:.4;font-weight:400;font-size:10px">' + subOpc + '</span></label>' +
                       '<input type="text" id="ins-subcategoria" ' +
                       'value="' + currentSub + '" placeholder="' + subPh + '">';
               }
           }
       }

       // ── Jerarquía y visibilidad exclusiva para Proteínas ────────
       if (tipo === 'carne') {
           ['row-nombre','row-familia','row-categoria','row-marca','row-variedad',
            'row-maduracion','row-temp-conservacion','row-vida-util-abrir','row-subcategoria']
               .forEach(function(id, idx) {
                   var el = document.getElementById(id);
                   if (el) el.style.order = String(idx + 1);
               });
           var _rowEmpC = document.getElementById('row-empaque');
           if (_rowEmpC) { _rowEmpC.style.order = '99'; _rowEmpC.style.display = 'none'; }
           var _rowVidaC = document.getElementById('row-vida-util-abrir');
           if (_rowVidaC) _rowVidaC.style.gridColumn = 'span 2';
           var _rowSubC = document.getElementById('row-subcategoria');
           if (_rowSubC) _rowSubC.style.gridColumn = 'span 2';
       }

       // ── Jerarquía y visibilidad exclusiva para Frutas y Verduras ─
       if (tipo === 'fruta') {
           ['row-nombre','row-categoria','row-variedad',
            'row-maduracion','row-temp-conservacion',
            'row-vida-util-abrir','row-vida-congelado',
            'row-como-congelar','row-subcategoria']
               .forEach(function(id, idx) {
                   var el = document.getElementById(id);
                   if (el) el.style.order = String(idx + 1);
               });
           // Ocultar marca, empaque y familia (siempre "Frutas y Verduras")
           var _rowMarcaF = document.getElementById('row-marca');
           if (_rowMarcaF) _rowMarcaF.style.display = 'none';
           var _rowEmpF = document.getElementById('row-empaque');
           if (_rowEmpF) { _rowEmpF.style.order = '99'; _rowEmpF.style.display = 'none'; }
           var _rowFamF = document.getElementById('row-familia');
           if (_rowFamF) _rowFamF.style.display = 'none';
           // Mostrar y configurar nuevas filas
           var _rowCongF = document.getElementById('row-como-congelar');
           if (_rowCongF) { _rowCongF.style.display = ''; _rowCongF.style.gridColumn = 'span 2'; }
           var _rowVidCF = document.getElementById('row-vida-congelado');
           if (_rowVidCF) {
               _rowVidCF.style.display = '';
               // Convertir a num+select si aún es texto plano
               if (!document.getElementById('ins-vidaUtilCongeladoNum')) {
                   var _vcExist  = document.getElementById('ins-vidaUtilCongelado');
                   var _vcVal    = _vcExist ? _vcExist.value || '' : '';
                   var _vcMatch  = _vcVal.match(/^(\d+)\s+(.+)$/);
                   var _vcNum    = _vcMatch ? _vcMatch[1] : '';
                   var _vcUnit   = _vcMatch ? _vcMatch[2] : 'meses';
                   var _vcSel    = '<select id="ins-vidaUtilCongeladoUnidad" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:9px 10px;border-radius:6px;font-family:sans-serif;font-size:14px;outline:none">' +
                       ['días','semanas','meses'].map(function(u){ return '<option value="'+u+'"'+(_vcUnit===u?' selected':'')+'>'+u+'</option>'; }).join('') + '</select>';
                   _rowVidCF.innerHTML = '<label>Vida útil congelado</label>' +
                       '<div style="display:flex;gap:6px">' +
                       '<input type="number" id="ins-vidaUtilCongeladoNum" placeholder="3" min="1" value="'+_vcNum+'" ' +
                       'style="width:80px;flex-shrink:0">' + _vcSel + '</div>';
               }
           }
           var _rowSubF = document.getElementById('row-subcategoria');
           if (_rowSubF) _rowSubF.style.gridColumn = 'span 2';
           var _rowVidaF = document.getElementById('row-vida-util-abrir');
           if (_rowVidaF) _rowVidaF.style.gridColumn = '';
       }
   }

   function abrirSelectorCategoria() {
       document.getElementById('modalCategoria').style.display = 'flex';
   }
   
   function cerrarModalCategoria(e) {
       if (e.target === document.getElementById('modalCategoria'))
           document.getElementById('modalCategoria').style.display = 'none';
   }
   
   function abrirModalConTipo(tipo) {
       tipoInsumoActual = tipo;
       document.getElementById('modalCategoria').style.display = 'none';
       const cfg = TIPO_CONFIG[tipo];
       // Pre-llenar familia y categoría según tipo
       abrirModal(null, cfg.familia, cfg.categoria);
   }
   
   const _soloMode = new URLSearchParams(location.search).get('solo') === '1';

   // Delegado listener registrado una sola vez al inicio
   document.addEventListener('DOMContentLoaded', () => {
       const overlay = document.getElementById('modalOverlay');
       if (overlay) {
           overlay.addEventListener('input',  e => { if (e.target.closest('.modal')) modalDirty = true; });
           overlay.addEventListener('change', e => { if (e.target.closest('.modal')) modalDirty = true; });
       }
       const _q = new URLSearchParams(location.search);
       const urlId = _q.get('id');
       if (urlId) setTimeout(() => editarInsumo(urlId), 150);
       // Embed: abrir directo la fuente pedida desde el escandallo
       else if (_q.get('nuevo') === '1')     setTimeout(() => { if (typeof abrirModal === 'function') abrirModal(); }, 150);
       else if (_q.get('globalneg') === '1') setTimeout(() => { if (typeof abrirInsumosGlobalNeg === 'function') abrirInsumosGlobalNeg(); }, 200);
       else if (_q.get('etaax') === '1')     setTimeout(() => { if (typeof abrirCatalogoGlobal === 'function') abrirCatalogoGlobal(); }, 200);

       /* Modo SOLO (abierto desde el escandallo): la página no debe verse como
          una página. Antes quedaba una "ventana de en medio" con la barra de
          contexto del negocio y el fondo del módulo, y encima el modal del
          catálogo: tres marcos con tres botones de cerrar para una sola cosa.
          Aquí el modal ES la ventana: ocupa todo el iframe, sin cromo detrás. */
       if (_soloMode) {
           const s = document.createElement('style');
           s.textContent =
               '.top-bar,.app-shell,#ctxBar,.ctx-bar,.theme-toggle,.global-nav{display:none!important}' +
               'html,body{background:transparent!important;padding:0!important;margin:0!important;overflow:hidden}' +
               // Los tres modales que abre el escandallo: el editor (.modal-overlay),
               // el catálogo del negocio y el de ETAAX (con estilos en línea).
               '.modal-overlay,#modalCatalogoGlobal,#modalInsumosNeg{background:transparent!important;padding:0!important;align-items:stretch!important}' +
               '.modal-overlay > *,#modalCatalogoGlobal > *,#modalInsumosNeg > *{max-width:none!important;width:100%!important;height:100vh!important;' +
                   'max-height:100vh!important;border-radius:0!important;border:0!important;resize:none!important;margin:0!important}' +
               // La ventana de afuera ya trae Minimizar/Cerrar: adentro sobran,
               // incluido el "✕ Cerrar" gris propio de cada catálogo.
               '.etx-hd-btns{display:none!important}' +
               '#modalCatalogoGlobal [onclick*="cerrarCatalogoGlobal"],' +
               '#modalInsumosNeg [onclick*="cerrarInsumosNeg"]{display:none!important}';
           document.head.appendChild(s);
           /* Cerrar el modal = cerrar la VENTANA. Antes el ✕ dejaba el iframe en
              blanco con la ventana abierta, y había que cerrarla otra vez. Se
              envuelven las funciones de cierre en vez de escuchar clics: cada
              modal tiene su botón con su propio onclick, sin clase común. */
           ['cerrarCatalogoGlobal', 'cerrarInsumosNeg', 'cerrarModal'].forEach(function (fn) {
               var orig = window[fn];
               if (typeof orig !== 'function') return;
               window[fn] = function () {
                   var r = orig.apply(this, arguments);
                   setTimeout(function () {
                       try { window.parent.postMessage({ type: 'cerrarEditor' }, window.location.origin); } catch (e) {}
                   }, 60);
                   return r;
               };
           });
       }
   });

   function abrirModal(ins = null, familiaDefault = '', categoriaDefault = '') {
       editandoId = ins ? ins.id : null;
       const cfg = TIPO_CONFIG[tipoInsumoActual] || TIPO_CONFIG['destilado'];
       const tituloTipo = ins ? 'Editar insumo' : `Nuevo insumo · ${cfg.icon} ${cfg.label}`;
       document.getElementById('modalTitulo').textContent = tituloTipo;
       var _sl = document.getElementById('insSello');
       if (_sl) _sl.innerHTML = ins ? _selloHTML(ins) : '';
   
       document.getElementById('ins-nombre').value       = ins?.nombre       || '';
       document.getElementById('ins-familia').value      = ins?.familia      || familiaDefault;
       document.getElementById('ins-categoria').value    = ins?.categoria    || categoriaDefault;
       document.getElementById('ins-subcategoria').value = ins?.subcategoria || '';
       (function(){ var elA = document.getElementById('ins-area'); if (elA) elA.value = ins?.area || ''; })();
       document.getElementById('ins-marca').value        = ins?.marca        || '';
       document.getElementById('ins-variedad').value     = ins?.variedad     || '';
       var _madEl = document.getElementById('ins-maduracion'); if (_madEl) _madEl.value = ins?.maduracion || '';
       var _tmpEl = document.getElementById('ins-tempConservacion'); if (_tmpEl) _tmpEl.value = ins?.tempConservacion || '';
       var _vidaEl = document.getElementById('ins-vidaUtilAbrir'); if (_vidaEl) _vidaEl.value = ins?.vidaUtilAbrir || '';
       document.getElementById('ins-empaque').value          = ins?.empaque           || '';
       var _congEl = document.getElementById('ins-comoCongelar'); if (_congEl) _congEl.value = ins?.comoCongelar || '';
       var _vcEl   = document.getElementById('ins-vidaUtilCongelado'); if (_vcEl) _vcEl.value = ins?.vidaUtilCongelado || '';
       document.getElementById('ins-notas').value        = ins?.notas        || '';
   
       // Si es edición, detectar tipo desde tipoInsumo guardado o desde familia/categoria
       if (ins) {
           if (ins.tipoInsumo && TIPO_CONFIG[ins.tipoInsumo]) {
               tipoInsumoActual = ins.tipoInsumo;
           } else {
               const fam = (ins.familia||'').toLowerCase();
               const cat = (ins.categoria||'').toLowerCase();
               if (fam.includes('carne'))  tipoInsumoActual = 'carne';
               else if (fam.includes('fruta') || fam.includes('verdura')) tipoInsumoActual = 'fruta';
               else if (fam.includes('abarro')) tipoInsumoActual = 'abarrote';
               else if (cat.includes('refresco') || cat.includes('soda') || cat.includes('agua')) tipoInsumoActual = 'refresco';
               else if (cat.includes('cerveza')) tipoInsumoActual = 'cerveza';
               else if (cat.includes('vino') || cat.includes('espumoso')) tipoInsumoActual = 'vino';
               else if (cat.includes('licor')) tipoInsumoActual = 'licor';
               else tipoInsumoActual = 'destilado';
           }
       }
   
       // Pill activo/inactivo
       const activo = ins ? (ins.activo === '0' ? '0' : '1') : '1';
       document.getElementById('ins-activo').value = activo;
       actualizarPillActivo(activo);
   
       // Foto
       fotoInsumoBase64 = '';
       _cerrarPuenteInsumo(); // resetear el escáner QR al abrir/cambiar de insumo
       const fotoImg = document.getElementById('insFotoImg');
       const fotoPh  = document.getElementById('insFotoPlaceholder');
       if (ins?.foto) {
           fotoImg.src           = ins.foto;
           fotoImg.style.display = 'block';
           fotoPh.style.display  = 'none';
       } else {
           fotoImg.src           = '';
           fotoImg.style.display = 'none';
           fotoPh.style.display  = 'flex';
       }
   
       presentacionesTemp = ins ? JSON.parse(JSON.stringify(ins.presentaciones||[])) : [];
       if (!presentacionesTemp.length) agregarPresentacion();
       else renderPresentaciones();

       ajustarCamposPorTipo(tipoInsumoActual);
       const _iconEl = document.getElementById('iconTipoActual');
       if (_iconEl) _iconEl.textContent = (TIPO_CONFIG[tipoInsumoActual] || TIPO_CONFIG['destilado']).icon;

       // Pre-rellenar vida útil num+unidad si es vino editado
       if (tipoInsumoActual === 'vino' && ins && ins.vidaUtilAbrir) {
           var _match = ins.vidaUtilAbrir.match(/^(\d+)\s+(.+)$/);
           var _numEl = document.getElementById('ins-vidaUtilAbrirNum');
           var _unEl  = document.getElementById('ins-vidaUtilAbrirUnidad');
           if (_match && _numEl && _unEl) {
               _numEl.value = _match[1];
               _unEl.value  = _match[2];
           }
       }

       // Pre-rellenar campos de fruta editada
       if (tipoInsumoActual === 'fruta' && ins) {
           if (ins.vidaUtilAbrir) {
               var _matchF = ins.vidaUtilAbrir.match(/^(\d+)\s+(.+)$/);
               var _numFEl = document.getElementById('ins-vidaUtilAbrirNum');
               var _unFEl  = document.getElementById('ins-vidaUtilAbrirUnidad');
               if (_matchF && _numFEl && _unFEl) { _numFEl.value = _matchF[1]; _unFEl.value = _matchF[2]; }
           }
           var _congEl2 = document.getElementById('ins-comoCongelar');
           if (_congEl2 && ins.comoCongelar) _congEl2.value = ins.comoCongelar;
           // Pre-rellenar vida útil congelado (num+unidad)
           if (ins.vidaUtilCongelado) {
               var _matchVC = ins.vidaUtilCongelado.match(/^(\d+)\s+(.+)$/);
               var _numVC = document.getElementById('ins-vidaUtilCongeladoNum');
               var _unVC  = document.getElementById('ins-vidaUtilCongeladoUnidad');
               if (_matchVC && _numVC && _unVC) { _numVC.value = _matchVC[1]; _unVC.value = _matchVC[2]; }
               else { var _vcEl2 = document.getElementById('ins-vidaUtilCongelado'); if (_vcEl2) _vcEl2.value = ins.vidaUtilCongelado; }
           }
       }

       modalDirty = false;
       _actualizarDatalistProveedores();
       // Datalists de conceptos reutilizables (empaque, zona)
       _poblarDatalistConcepto('empaque', 'dl-empaque', EMPAQUE_DEFAULTS);
       _poblarDatalistConcepto('zona', 'dl-zona', ZONA_DEFAULTS);
       // Sucursal: poblar select si hay más de 1 sucursal
       (function() {
           var sucs = _getSucsIns();
           var rowEl = document.getElementById('row-ins-sucursal');
           var selEl = document.getElementById('ins-sucursal');
           if (!rowEl || !selEl) return;
           if (sucs.length <= 1 || !_puedeCambiarSucIns()) { rowEl.style.display = 'none'; return; }
           rowEl.style.display = '';
           var tieneMatriz = sucs.some(function(s){ return s.id === MATRIZ_ID_INS; });
           selEl.innerHTML = '<option value="">— Sin asignar (Matriz) —</option>' +
               (tieneMatriz ? '' : '<option value="' + MATRIZ_ID_INS + '">Matriz</option>') +
               sucs.map(function(s){ return '<option value="' + (s.id||'') + '">' + (s.nombre||s.id) + '</option>'; }).join('');
           selEl.value = ins ? (ins.sucursalId || '') : (_getSucActivaIns() || '');
       })();
       document.getElementById('modalOverlay').style.display = 'flex';
       setTimeout(() => document.getElementById('ins-nombre').focus(), 100);
   }
   
   function toggleActivoInsumo() {
       const inp = document.getElementById('ins-activo');
       const nuevoVal = inp.value === '1' ? '0' : '1';
       inp.value = nuevoVal;
       actualizarPillActivo(nuevoVal);
   }
   
   function actualizarPillActivo(val) {
       const pill = document.getElementById('ins-activo-pill');
       if (!pill) return;
       if (val === '1') {
           pill.textContent = 'Activo';
           pill.className   = 'pill pill-green';
       } else {
           pill.textContent = 'Inactivo';
           pill.className   = 'pill pill-red';
       }
   }
   
   var modalDirty = false;

   /* Cerrar con cambios pendientes: mismo candado de 3 botones que el escandallo,
      con el diálogo de la casa. El confirm() del navegador salía como "etaax.com
      dice" y solo ofrecía aceptar o cancelar — no dejaba guardar. */
   function _cerrarConCandado(continuar) {
       if (!modalDirty) { continuar(); return; }
       if (typeof window.etaaxDialog !== 'function') {   // sin security.js cargado
           if (confirm('¿Salir sin guardar? Los cambios se perderán.')) continuar();
           return;
       }
       etaaxDialog({
           icon: '💾', title: 'Tienes cambios sin guardar',
           msg: 'Este insumo tiene cambios que todavía no se guardan.',
           buttons: [
               { label: 'Seguir editando', kind: 'ghost' },
               { label: 'Cerrar sin guardar', kind: 'danger', onClick: function () { modalDirty = false; continuar(); } },
               { label: '💾 Guardar y cerrar', kind: 'primary', onClick: function () {
                   Promise.resolve(guardarInsumo()).then(function () { modalDirty = false; }).catch(function () {});
               } }
           ]
       });
   }
   function _cerrarModalYa() {
       modalDirty = false;
       _cerrarPuenteInsumo();
       document.getElementById('modalOverlay').style.display = 'none';
   }
   function cerrarModal(e) {
       if (e.target !== document.getElementById('modalOverlay')) return;
       _cerrarConCandado(_cerrarModalYa);
   }

   function cerrarModalBtn() {
       _cerrarConCandado(function () {
           _cerrarModalYa();
           if (_soloMode) window.parent.postMessage({ type: 'cerrarEditor' }, '*');
       });
   }
   
   /* ── Menú "⋯" de acciones del insumo ────────────────────────────────
      Editar, Copiar, Vincular, Inventario y Eliminar viven aquí: en la lista
      solo queda "Ver" y todo se ve más limpio. El menú se pinta en
      position:fixed sobre <body> — dentro de la tabla lo recortaba el overflow
      del contenedor y quedaba a medias. */
   var _insMenuEl = null;
   function _insMenuCerrar() { if (_insMenuEl) { _insMenuEl.remove(); _insMenuEl = null; } }
   window._insMenuCerrar = _insMenuCerrar;
   document.addEventListener('click', function (e) {
       if (!_insMenuEl || !e.target.closest) return;
       if (e.target.closest('.ins-menu-pop') || e.target.closest('.ins-mas-btn')) return;
       _insMenuCerrar();
   });
   window.addEventListener('scroll', _insMenuCerrar, true);
   window.addEventListener('resize', _insMenuCerrar);
   function _insMenuItem(icono, texto, accion, clase) {
       return '<button type="button" class="' + (clase || '') + '" onclick="_insMenuCerrar();' + accion + '">' +
           '<span class="ic">' + icono + '</span>' + texto + '</button>';
   }
   function _insMenuAbrir(ev, id) {
       ev.stopPropagation();
       var yaAbierto = _insMenuEl && _insMenuEl.getAttribute('data-id') === id;
       _insMenuCerrar();
       if (yaAbierto) return;   // segundo clic en el mismo botón = cerrar
       var ins = getInsumos().find(function (x) { return x.id === id; });
       if (!ins) return;
       var q = "'" + id + "'";
       var items = [_insMenuItem('✏️', 'Editar', 'editarInsumo(' + q + ')')];
       if (!ins.esSubReceta)
           items.push(_insMenuItem('📋', 'Copiar', 'copiarInsumo(' + q + ')'));
       if (_catGlobalIns())
           items.push(_insMenuItem('🔗', 'Vincular a sucursal', 'abrirInsumoSuc(' + q + ')'));
       if (!_catGlobalIns() && _getSucActivaIns() && ins.activo === '0')
           items.push(_insMenuItem('▶', 'Activar en el negocio', 'activarInsumoGlobal(' + q + ')'));
       if (ins.esSubReceta)
           items.push(_insMenuItem(ins.ocultoInventario ? '📋' : '🚫',
               ins.ocultoInventario ? 'Mostrar en inventario' : 'Ocultar del inventario',
               'toggleVisibleInventario(' + q + ')'));
       items.push('<div class="sep"></div>');
       items.push(_insMenuItem('🗑️', 'Eliminar', 'eliminarInsumo(' + q + ')', 'peligro'));

       var pop = document.createElement('div');
       pop.className = 'ins-menu-pop';
       pop.setAttribute('data-id', id);
       pop.innerHTML = items.join('');
       document.body.appendChild(pop);
       // Anclaje: si la lista se re-renderizó, el botón del evento puede haber
       // quedado huérfano y su rect sale en ceros → el menú se iba a la esquina.
       // Se vuelve a buscar por id y, en última instancia, se ancla arriba a la derecha.
       var btn = ev.currentTarget;
       var r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
       if (!r || (!r.width && !r.height)) {
           // Tabla y galería conviven en el DOM (una oculta): buscar el botón VISIBLE.
           var cands = document.querySelectorAll('.ins-mas-btn[data-id="' + id + '"]');
           for (var ci = 0; ci < cands.length; ci++) {
               var rr = cands[ci].getBoundingClientRect();
               if (rr.width || rr.height) { btn = cands[ci]; r = rr; break; }
           }
       }
       var w = pop.offsetWidth, h = pop.offsetHeight;
       if (!r || (!r.width && !r.height)) r = { right: window.innerWidth - 20, bottom: 70, top: 70 };
       pop.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + 'px';
       pop.style.top  = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
       _insMenuEl = pop;
   }
   window._insMenuAbrir = _insMenuAbrir;
   // Botón "⋯" (mismo en tabla y en tarjetas).
   function _insMasBtn(id, clase) {
       return '<button type="button" class="ins-mas-btn ' + (clase || '') + '" title="Más acciones" ' +
           'data-id="' + id + '" onclick="_insMenuAbrir(event,\'' + id + '\')">⋯</button>';
   }

   function editarInsumo(id) {
       const ins = getInsumos().find(x => x.id === id);
       if (!ins) return;
       // PRODUCCIÓN PROPIA (sub-receta convertida a insumo): NO se edita como
       // insumo — se abre su ESCANDALLO en el módulo de recetas. Si conserva la
       // liga (recetaId) se abre directo; si se perdió, se pasa el id del insumo
       // y la página de recetas lo re-liga por nombre (self-healing).
       if (ins.esSubReceta) {
           window.location.href = ins.recetaId
               ? 'index.html?r=' + encodeURIComponent(ins.recetaId)
               : 'index.html?subins=' + encodeURIComponent(ins.id);
           return;
       }
       abrirModal(ins);
   }

   // Duplicar un insumo (como el "copiar" de recetas/sub-recetas): copia profunda
   // con id nuevo y presentaciones con ids nuevos, nombre "(copia)", y abre el
   // editor para ajustar costos/nombre antes de que quede fijo. Hereda la misma
   // membresía de sucursales que el original.
   function copiarInsumo(id) {
       const ins = getInsumos().find(x => x.id === id);
       if (!ins) return;
       if (ins.esSubReceta) { alert('Las producciones propias (sub-recetas) se copian desde su escandallo en Recetas, no aquí.'); return; }
       // Confirmación + contraseña de admin: una copia accidental ensucia el
       // catálogo (y sus costos alimentan escandallos e inventarios).
       var _conf = window.etaaxConfirm || function(t, m, onYes){ if (window.confirm(t + '\n' + m)) onYes(); };
       _conf('¿Copiar insumo?', '¿Deseas hacer una copia de "' + (ins.nombre || 'este insumo') + '"?', function(){
           _pedirClaveAdmin('Copiar insumo "' + (ins.nombre || '') + '"', function(){ _hacerCopiaInsumo(ins); });
       }, null, { icon:'📋', yesLabel:'Sí, copiar', noLabel:'No', danger:false });
   }
   function _hacerCopiaInsumo(ins) {
       const copia = JSON.parse(JSON.stringify(ins));
       copia.id = genId();
       copia.nombre = ((ins.nombre || 'Insumo') + ' (copia)').slice(0, 120);
       delete copia.origenId; // es un insumo nuevo, no ligado a otro
       (copia.presentaciones || []).forEach(function(p){ if (p) p.id = genId(); });
       const lista = getInsumos();
       lista.push(copia);
       setInsumos(lista); // persiste local + sync a Supabase (mismo camino que guardar)
       init();            // re-render de la lista
       editarInsumo(copia.id); // abrir la copia para ajustarla
   }
   window.copiarInsumo = copiarInsumo;

   function eliminarInsumo(id) {
       const ins = getInsumos().find(x => x.id === id);
       if (!ins) return;
       // Aviso si es un MAESTRO con copias vinculadas: al borrarlo, las copias siguen vivas
       // en sus sucursales pero quedan independientes (ya sin novedades).
       if (!ins.origenId) {
           var _cop = _copiasDe(id);
           if (_cop.length && !confirm('⚠️ "' + (ins.nombre||'insumo') + '" es un MAESTRO con ' + _cop.length + ' copia(s) en sucursales.\n\nAl borrarlo, esas copias SIGUEN funcionando en sus sucursales (con lo capturado), pero quedan INDEPENDIENTES (ya no reciben novedades).\n\n¿Continuar?')) return;
       }
       _pedirClaveAdmin('Eliminar insumo "' + ins.nombre + '"', async function() {
           _tombAdd([id]); // tombstone PERSISTENTE (sobrevive a recarga/navegación)
           // Quitar de local + render YA (UX inmediata).
           setInsumos(getInsumos().filter(x => x.id !== id));
           init();
           // Borrar en Supabase y ESPERAR a que confirme. Si la navegación cancela el
           // delete en vuelo, el tombstone persistente lo re-borra en la próxima carga.
           try { await _borrarInsumosSupabase(getNegocioActivo(), [id]); }
           catch(e) { console.warn('[eliminar] ', e); }
       });
   }

   // ── Convertir tipo de insumo ──────────────────────────────────
   const _TIPOS_ORDEN = [
       ['destilado','🥃','Destilado'],
       ['licor',    '🍹','Licor'],
       ['vino',     '🍷','Vino'],
       ['refresco', '🧃','Refresco'],
       ['cerveza',  '🍺','Cerveza'],
       ['cerveza_barril','🛢️','Barril'],
       ['abarrote', '🧂','Abarrote'],
       ['carne',    '🥩','Proteína'],
       ['fruta',    '🥬','Fruta/Verd.'],
       ['otro',     '📦','Otro'],
   ];

   function toggleConvertirTipoPop(e) {
       e.stopPropagation();
       const pop  = document.getElementById('convertirTipoPop');
       const grid = document.getElementById('convertirTipoGrid');
       if (pop.style.display !== 'none') { pop.style.display = 'none'; return; }
       grid.innerHTML = _TIPOS_ORDEN.map(([tipo, icon, label]) => {
           const activo = tipo === tipoInsumoActual;
           return `<button onclick="_aplicarConversionTipo('${tipo}')"
               style="display:flex;align-items:center;gap:6px;background:${activo ? 'rgba(245,200,66,.15)' : 'var(--surface2)'};
               border:1px solid ${activo ? 'var(--accent)' : 'var(--border)'};border-radius:7px;
               padding:6px 9px;cursor:pointer;font-family:inherit;font-size:11px;color:${activo ? 'var(--accent)' : 'var(--text)'};
               text-align:left;width:100%">
               <span style="font-size:15px">${icon}</span><span>${label}</span>
           </button>`;
       }).join('');
       pop.style.display = 'block';
       const closePop = () => { pop.style.display = 'none'; document.removeEventListener('click', closePop); };
       setTimeout(() => document.addEventListener('click', closePop), 0);
   }

   function _aplicarConversionTipo(tipo) {
       if (tipo === tipoInsumoActual) { document.getElementById('convertirTipoPop').style.display = 'none'; return; }
       tipoInsumoActual = tipo;
       modalDirty = true;
       const cfg = TIPO_CONFIG[tipo] || TIPO_CONFIG['destilado'];
       const nombre = document.getElementById('ins-nombre').value.trim();
       document.getElementById('modalTitulo').textContent = nombre ? nombre : `Insumo · ${cfg.icon} ${cfg.label}`;
       const iconEl = document.getElementById('iconTipoActual');
       if (iconEl) iconEl.textContent = cfg.icon;
       // Al CONVERTIR, la categoría y la familia siguen al nuevo tipo (Destilados→Licores, etc.).
       // Antes quedaban vacías/viejas y el insumo no se agrupaba bien en los reportes.
       const elCatConv = document.getElementById('ins-categoria');
       if (elCatConv && cfg.categoria) elCatConv.value = cfg.categoria;
       const elFamConv = document.getElementById('ins-familia');
       if (elFamConv && cfg.familia) elFamConv.value = cfg.familia;
       ajustarCamposPorTipo(tipo);
       renderPresentaciones();
       document.getElementById('convertirTipoPop').style.display = 'none';
   }

   // ── Foto ──────────────────────────────────────────────────────
   function cargarFotoInsumo(input) {
       const file = input.files[0];
       if (!file) return;
       // Antes se guardaba la foto CRUDA como base64 (varios MB dentro del dato).
       // Ahora se redimensiona y comprime: una foto de celular pasa de ~4 MB a ~50 KB.
       _comprimirFotoInsumo(file, 512, 0.7, function(b64) {
           if (!b64) return;
           fotoInsumoBase64 = b64;
           const img = document.getElementById('insFotoImg');
           const ph  = document.getElementById('insFotoPlaceholder');
           img.src           = b64;
           img.style.display = 'block';
           ph.style.display  = 'none';
       });
   }

   // ── Subir foto del insumo desde el celular vía QR (mismo puente que cortes/gastos/recetas) ──
   function _abrirPuenteInsumo() {
       var box = document.getElementById('qrInsumoBox');
       if (!box || !window.QrPuente) return;
       box.style.display = 'block';
       var btn = document.getElementById('btnQrInsumo');
       if (btn) btn.textContent = '✕ Cerrar escaneo';
       QrPuente.abrir(getNegocioActivo(), 'insumo', box, function(foto) {
           if (!foto || !foto.url) return;
           fotoInsumoBase64 = foto.url; // ya es URL de Storage (liviana)
           var img = document.getElementById('insFotoImg');
           var ph  = document.getElementById('insFotoPlaceholder');
           if (img) { img.src = foto.url; img.style.display = 'block'; }
           if (ph)  ph.style.display = 'none';
       });
   }
   function _cerrarPuenteInsumo() {
       if (window.QrPuente) { try { QrPuente.cerrar(); } catch(e) {} }
       var box = document.getElementById('qrInsumoBox');
       if (box) { box.style.display = 'none'; box.innerHTML = ''; }
       var btn = document.getElementById('btnQrInsumo');
       if (btn) btn.textContent = '📱 Subir foto desde el celular';
   }
   function _toggleQrInsumo() {
       var box = document.getElementById('qrInsumoBox');
       if (!box) return;
       if (box.style.display === 'none' || !box.style.display) _abrirPuenteInsumo();
       else _cerrarPuenteInsumo();
   }
   window._toggleQrInsumo = _toggleQrInsumo;
   window._cerrarPuenteInsumo = _cerrarPuenteInsumo;

   function _comprimirFotoInsumo(file, maxPx, calidad, cb) {
       var reader = new FileReader();
       reader.onload = function(e) {
           var img = new Image();
           img.onload = function() {
               var w = img.width, h = img.height, M = maxPx || 512;
               if (w > h) { if (w > M) { h = Math.round(h * M / w); w = M; } }
               else        { if (h > M) { w = Math.round(w * M / h); h = M; } }
               var c = document.createElement('canvas');
               c.width = w; c.height = h;
               c.getContext('2d').drawImage(img, 0, 0, w, h);
               try { cb(c.toDataURL('image/jpeg', calidad || 0.7)); }
               catch (err) { cb(e.target.result); } // fallback: original si el canvas falla
           };
           img.onerror = function() { cb(e.target.result); };
           img.src = e.target.result;
       };
       reader.onerror = function() { cb(''); };
       reader.readAsDataURL(file);
   }
   
   // ── Helpers de presentaciones ────────────────────────────────
   /** Factor de precio según selección de impuesto y checkboxes manuales */
   function calcImpFactor(p) {
       if (p.incluyeImpuesto !== '0') return 1; // precio ya incluye impuesto
       let f = 1;
       if (p.ivaCheck  === '1') f *= 1.16;
       if (p.iepsCheck === '1') f *= (1 + parseFloat(p.iepsTasa || '26.5') / 100);
       return f;
   }

   // ── Presentaciones ────────────────────────────────────────────
   function agregarPresentacion() {
       var hoy = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
       presentacionesTemp.push({
           id: genId(), contNeto: '', umContenido: 'ML',
           pesoUnidad: '', umPeso: 'G', pesoCristal: '',
           masaDrenada: '', umMasaDrenada: 'G', rendimiento: '', umRendimiento: 'OZ',
           tamanoCopa: '', umTamanoCopa: 'ML', umLectura: '',
           factorCopa: '3.3', factorBotella: '2.5', factorPieza: '2.0', costoPieza: '',
           proveedor: '', zona: '', fecha: hoy,
           precio: '', costoUnitario: '', umCosto: 'LT',
           incluyeImpuesto: '0', ivaCheck: '0', iepsCheck: '0', iepsTasa: '26.5', notas: '',
           precioCarta: '', precioCartaBot: '',
           stockMin: '', stockMax: '',
           unidadesPorPieza: '', nombreSubUnidad: '', costoSubUnidad: '', contSub: '',
           costeos: []
       });
       renderPresentaciones();
   }
   
   function eliminarPresentacion(i) {
       if (presentacionesTemp.length <= 1) { alert('Mínimo una presentación'); return; }
       presentacionesTemp.splice(i, 1);
       renderPresentaciones();
   }
   
   /* ── Tercer nivel: sub-unidades dentro de cada pieza ───────────────────
      Caja de 16 bolsas · cada bolsa trae 40 tostadas. El costo por bolsa ya lo
      da `costoPieza`; esto agrega el costo de LA TOSTADA, que es la unidad con
      la que de verdad se cocina y se cuesta una receta. Sin esto había que
      sacar la división a mano cada vez. */
   // Tarjeta "Costo por tostada / rebanada / lo que sea". Solo aparece cuando el
   // insumo declaró cuántas sub-unidades trae cada pieza.
   /* Quién está trabajando: el colaborador si entró con su cuenta, si no el dueño.
      Va junto a la fecha para que "lo actualizó alguien" tenga nombre y apellido. */
   function _usuarioActual() {
       try {
           var c = JSON.parse(localStorage.getItem('etaax_ctx') || '{}');
           return c.userName || c.staffNombre || c.negNombre || '';
       } catch (e) { return ''; }
   }
   /* "hace 3 días · Edwin" — relativo porque es lo que se lee de un golpe; la fecha
      exacta queda en el title del elemento. */
   function _selloActualizacion(o) {
       if (!o) return '';
       // El movimiento más reciente puede estar en una copia de sucursal, no aquí.
       var ultimo = (_historialDe(o)[0] || {}).ts || '';
       var iso = ultimo || o.updatedAt || o.createdAt || '';
       if (!iso) return '';
       var d = new Date(iso); if (isNaN(d)) return '';
       var dias = Math.floor((Date.now() - d.getTime()) / 86400000);
       var rel = dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : dias < 30 ? ('hace ' + dias + ' días')
               : dias < 365 ? ('hace ' + Math.floor(dias / 30) + ' mes' + (dias < 60 ? '' : 'es'))
               : ('hace ' + Math.floor(dias / 365) + ' año' + (dias < 730 ? '' : 's'));
       var quien = ultimo ? ((_historialDe(o)[0] || {}).quien || o.updatedBy || '') : (o.updatedBy || '');
       return { rel: rel, quien: quien, fecha: d.toLocaleString('es-MX', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' }) };
   }
   function _selloHTML(o, estilo) {
       var s = _selloActualizacion(o);
       if (!s) return '';
       return '<div title="Última actualización: ' + etx(s.fecha) + '" style="font-size:10.5px;color:var(--text-dim);' + (estilo || '') + '">'
            + '🕒 Actualizado ' + etx(s.rel) + (s.quien ? ' · <span style="color:var(--text-muted)">' + etx(s.quien) + '</span>' : '') + '</div>';
   }
   window._selloHTML = _selloHTML;

   /* ── HISTÓRICO DE CAMBIOS ──────────────────────────────────────────────────
      Un renglón por guardado, con lo que de verdad cambió (nombre, costo, copa,
      stock…), quién y en qué sucursal. Vive en el propio insumo (ins.historial) y
      se poda a 90 DÍAS: es metadato de consulta, no un libro contable.
      De aquí come el buscador de NOVEDADES del catálogo global. */
   var _HIST_DIAS = 90;
   // Campos que vale la pena registrar: los que cambian una decisión.
   var _HIST_CAMPOS = [
       { k:'nombre',       lbl:'Nombre' },
       { k:'marca',        lbl:'Marca' },
       { k:'variedad',     lbl:'Variedad' },
       { k:'categoria',    lbl:'Categoría' },
       { k:'subcategoria', lbl:'Subcategoría' },
       { k:'area',         lbl:'Área' },
       { k:'activo',       lbl:'Activo' }
   ];
   var _HIST_PRES = [
       { k:'precio',           lbl:'Precio de compra',  money:true },
       { k:'costoUnitario',    lbl:'Costo unitario',    money:true },
       { k:'contNeto',         lbl:'Contenido' },
       { k:'umContenido',      lbl:'Unidad' },
       { k:'tamanoCopa',       lbl:'Tamaño de copa' },
       { k:'precioCarta',      lbl:'Precio carta',      money:true },
       { k:'unidadesPorPieza', lbl:'Piezas por unidad' },
       { k:'stockMin',         lbl:'Stock mínimo' },
       { k:'stockMax',         lbl:'Stock máximo' },
       { k:'proveedor',        lbl:'Proveedor' }
   ];
   function _valTxt(v) { return (v === undefined || v === null || v === '') ? '—' : String(v); }
   function _diffInsumo(nuevo, viejo) {
       var out = [];
       if (!viejo) return out;                        // insumo nuevo: sin comparación
       _HIST_CAMPOS.forEach(function (c) {
           // "Activo: — → 1" no es un cambio del usuario: es el default que rellena el
           // editor en registros viejos que no traían el campo. Ensucia el historial.
           if (c.k === 'activo' && viejo[c.k] === undefined) return;
           if (_valTxt(nuevo[c.k]) !== _valTxt(viejo[c.k]))
               out.push({ campo: c.lbl, de: _valTxt(viejo[c.k]), a: _valTxt(nuevo[c.k]) });
       });
       var pn = (nuevo.presentaciones || [])[0] || {}, pv = (viejo.presentaciones || [])[0] || {};
       _HIST_PRES.forEach(function (c) {
           var a = _valTxt(pn[c.k]), b = _valTxt(pv[c.k]);
           if (a === b) return;
           if (c.money) { a = a === '—' ? a : fmtMXN(parseFloat(a) || 0); b = b === '—' ? b : fmtMXN(parseFloat(b) || 0); }
           out.push({ campo: c.lbl, de: b, a: a });
       });
       return out;
   }
   function _registrarCambios(insumo, previo) {
       var cambios = _diffInsumo(insumo, previo);
       var esNuevo = !previo;
       if (!esNuevo && !cambios.length) return;       // guardó sin tocar nada
       var hist = (previo && previo.historial) || insumo.historial || [];
       hist = hist.slice();
       // Editado DESDE el catálogo global = cambio del maestro, no de una sucursal.
       // Sin esto se sellaba con la sucursal que la pestaña trajera fijada y el
       // renglón mentía sobre dónde se hizo el cambio.
       var _enGlobal = _catGlobalIns();
       var _sucEd = _enGlobal ? '' : (_getSucActivaIns() || '');
       hist.unshift({
           ts: insumo.updatedAt,
           quien: insumo.updatedBy || '',
           suc: _sucEd,
           sucNom: _enGlobal ? 'Catálogo global' : _sucNomIns(_sucEd),
           global: _enGlobal || undefined,
           tipo: esNuevo ? 'alta' : 'edicion',
           cambios: cambios.slice(0, 12)              // 12 renglones bastan para leerlo
       });
       var corte = Date.now() - _HIST_DIAS * 864e5;
       insumo.historial = hist.filter(function (h) {
           var t = Date.parse(h && h.ts || '');
           return isNaN(t) ? false : t >= corte;
       }).slice(0, 40);
   }

   /* Bitácora del insumo dentro de su ficha técnica: quién lo tocó, cuándo, desde
      qué sucursal y qué cambió. Mismo formato que el historial de conciliaciones
      bancarias: una línea por evento, lo más reciente arriba. 90 días. */
   /* Historial COMPLETO del producto: el suyo + el de sus hermanos (maestro y copias
      por sucursal). En el catálogo global se ve el MAESTRO, pero quien se edita es la
      COPIA de la sucursal — mirando solo el registro abierto, la ficha del maestro
      salía siempre vacía aunque hubiera movimiento en las sucursales. */
   function _historialDe(ins) {
       if (!ins) return [];
       var canon = ins.origenId || ins.id;
       var todos = [];
       (getInsumos() || []).forEach(function (x) {
           if (!x) return;
           if ((x.origenId || x.id) !== canon) return;
           (x.historial || []).forEach(function (h) { todos.push(h); });
       });
       return todos.sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
   }
   function _historialHTML(ins) {
       var hist = _historialDe(ins);
       var corte = Date.now() - _HIST_DIAS * 864e5;
       hist = hist.filter(function (h) { var t = Date.parse((h && h.ts) || ''); return !isNaN(t) && t >= corte; });
       var sello = _selloActualizacion(ins);
       if (!hist.length) {
           return '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">'
               + '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px">Historial de cambios</div>'
               + '<div style="font-size:12px;color:var(--text-dim)">'
               + (sello ? 'Última actualización ' + etx(sello.rel) + (sello.quien ? ' · ' + etx(sello.quien) : '') + '. Sin cambios registrados en los últimos 90 días.'
                        : 'Todavía no hay cambios registrados. Se van guardando cada vez que se edita el insumo.')
               + '</div></div>';
       }
       var filas = hist.map(function (h) {
           var d = new Date(h.ts);
           var fch = isNaN(d) ? '—' : d.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })
                   + ' · ' + d.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
           var det = (h.cambios || []).map(function (c) {
               return '<div style="font-size:11.5px;color:var(--text-muted);padding-top:2px">'
                   + etx(c.campo) + ': <span style="color:var(--text-dim);text-decoration:line-through">' + etx(c.de) + '</span>'
                   + ' → <span style="color:var(--green);font-weight:600">' + etx(c.a) + '</span></div>';
           }).join('') || '<div style="font-size:11.5px;color:var(--text-dim);padding-top:2px">Alta del insumo.</div>';
           return '<div style="padding:9px 0;border-top:1px solid var(--border)">'
               + '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--text-dim)">'
                   + '<span>' + (h.tipo === 'alta' ? '🆕 Alta' : '✏️ Edición') + (h.sucNom ? ' · <b style="color:#7ab8f5">' + etx(h.sucNom) + '</b>' : '') + (h.quien ? ' · ' + etx(h.quien) : '') + '</span>'
                   + '<span>' + etx(fch) + '</span>'
               + '</div>' + det + '</div>';
       }).join('');
       return '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">'
           + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:2px">'
               + '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim)">📜 Historial de cambios</div>'
               + '<div style="font-size:10.5px;color:var(--text-dim)">últimos 90 días · ' + hist.length + ' movimiento' + (hist.length !== 1 ? 's' : '') + '</div>'
           + '</div>' + filas + '</div>';
   }

   /* ══════════════════════════════════════════════════════════════════════════
      NOVEDADES — cambios recientes en las sucursales, vistos desde el global
      Junta el historial de TODOS los insumos y lo ordena por fecha. Por cada
      novedad se decide: subirla al catálogo global (queda igual en todas las
      sucursales que tienen ese insumo) o dejarla donde está. Al decidir, la
      novedad se marca como vista y desaparece de la lista — no se borra el
      historial, solo deja de pedir atención.
      ══════════════════════════════════════════════════════════════════════════ */
   var _NOV_VISTAS = {};   // { insumoId|ts : 1 } — decisiones ya tomadas
   function _novKeyStore() { return _sk('nov_vistas_ins'); }
   function _novCargarVistas() {
       try { _NOV_VISTAS = JSON.parse(localStorage.getItem(_novKeyStore()) || '{}'); } catch (e) { _NOV_VISTAS = {}; }
   }
   function _novGuardarVistas() {
       try { localStorage.setItem(_novKeyStore(), JSON.stringify(_NOV_VISTAS)); } catch (e) {}
   }
   function _novLista() {
       _novCargarVistas();
       var out = [];
       var corte = Date.now() - _HIST_DIAS * 864e5;
       // Fuera del catálogo global se ven SOLO los cambios hechos en esta sucursal.
       var sucAct = _catGlobalIns() ? '' : (_getSucActivaIns() || '');
       (getInsumos() || []).forEach(function (ins) {
           (ins.historial || []).forEach(function (h) {
               if (!h || !h.ts) return;
               // Dentro de una sucursal se ven SUS cambios y los del catálogo global
               // (esos le llegaron a ella, así que también son novedad suya).
               if (sucAct && (h.suc || '') !== sucAct && !h.global) return;
               var t = Date.parse(h.ts);
               if (isNaN(t) || t < corte) return;             // la poda también al leer:
               var k = ins.id + '|' + h.ts;                   // datos viejos no se cuelan
               if (_NOV_VISTAS[k]) return;                    // ya se decidió
               out.push({ key: k, ins: ins, h: h });
           });
       });
       out.sort(function (a, b) { return String(b.h.ts).localeCompare(String(a.h.ts)); });
       return out;
   }
   function _novFecha(iso) {
       var d = new Date(iso); if (isNaN(d)) return '';
       var dias = Math.floor((Date.now() - d.getTime()) / 86400000);
       return dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : 'hace ' + dias + ' días';
   }
   // ¿En cuántas sucursales más vive este insumo? Es lo que se actualizaría.
   function _novHermanos(ins) {
       var k = _keyInsLocal(ins);
       return (getInsumos() || []).filter(function (x) { return x.id !== ins.id && _keyInsLocal(x) === k; });
   }
   function abrirNovedadesIns() {
       var ov = document.createElement('div');
       ov.id = 'novOverlay';
       ov.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px';
       ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
       ov.innerHTML = '<div class="modal" style="max-width:860px;width:100%;max-height:88vh;display:flex;flex-direction:column">'
           + '<div class="modal-header"><h2>' + (_catGlobalIns() ? '🔔 Novedades del catálogo' : '🔔 Cambios recientes · ' + etx(_sucNomIns(_getSucActivaIns() || ''))) + '</h2>'
           + '<button class="modal-close" onclick="document.getElementById(\'novOverlay\').remove()">✕</button></div>'
           + '<div style="padding:0 18px 10px"><input id="novBuscar" class="ins-buscador" placeholder="🔍 Buscar por insumo, sucursal o quién lo cambió…" '
           + 'oninput="_novRender(this.value)" style="width:100%;box-sizing:border-box"></div>'
           + '<div id="novLista" class="modal-body" style="flex:1;overflow-y:auto;padding:0 18px 18px"></div></div>';
       document.body.appendChild(ov);
       _novRender('');
   }
   function _novRender(q) {
       var cont = document.getElementById('novLista'); if (!cont) return;
       q = String(q || '').toLowerCase().trim();
       var lista = _novLista().filter(function (n) {
           if (!q) return true;
           return ((insumoTitulo(n.ins) || '') + ' ' + (n.h.sucNom || '') + ' ' + (n.h.quien || '')).toLowerCase().indexOf(q) >= 0;
       });
       if (!lista.length) {
           cont.innerHTML = '<div style="text-align:center;padding:44px 20px;color:var(--text-dim)">'
               + '<div style="font-size:34px;margin-bottom:8px">✅</div>'
               + '<div style="font-size:14px;color:var(--text-muted)">' + (q ? 'Sin resultados para «' + etx(q) + '»' : 'Todo al día: no hay cambios pendientes de revisar.') + '</div></div>';
           return;
       }
       cont.innerHTML = lista.map(function (n) {
           var herm = _novHermanos(n.ins).length;
           var filas = (n.h.cambios || []).map(function (c) {
               return '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;font-size:12px;padding:4px 0;border-top:1px solid var(--border)">'
                   + '<span style="color:var(--text-muted)">' + etx(c.campo) + '</span>'
                   + '<span style="color:var(--text-dim);text-decoration:line-through">' + etx(c.de) + '</span>'
                   + '<span style="color:var(--text-dim)">→</span>'
                   + '<span style="color:var(--green);font-weight:600">' + etx(c.a) + '</span></div>';
           }).join('') || '<div style="font-size:12px;color:var(--text-dim);padding-top:5px">Alta del insumo.</div>';
           return '<div class="ins-card" style="padding:13px 15px;margin-bottom:10px">'
               + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">'
                   + '<div style="min-width:0">'
                       + '<div style="font-weight:700;font-size:14px;color:var(--text)">' + etx(insumoTitulo(n.ins)) + '</div>'
                       + '<div style="font-size:11px;color:var(--text-dim);margin-top:3px">'
                           + (n.h.tipo === 'alta' ? '🆕 Alta' : '✏️ Edición') + ' · ' + etx(_novFecha(n.h.ts))
                           + (n.h.sucNom ? ' · <b style="color:#7ab8f5">' + etx(n.h.sucNom) + '</b>' : '')
                           + (n.h.quien ? ' · ' + etx(n.h.quien) : '') + '</div>'
                   + '</div>'
                   + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
                       + '<button class="btn-vista" style="font-size:11px;padding:5px 10px" onclick="verFicha(\'' + n.ins.id + '\')">📋 Ficha</button>'
                       + ((herm && _catGlobalIns()) ? '<button class="btn-vista" style="font-size:11px;padding:5px 10px;color:var(--green);border-color:var(--green)" onclick="_novAplicar(\'' + n.key + '\',\'' + n.ins.id + '\')">⬆️ Subir al global (' + herm + ')</button>' : '')
                       + '<button class="btn-vista" style="font-size:11px;padding:5px 10px" onclick="_novDejar(\'' + n.key + '\')">Dejar así</button>'
                   + '</div>'
               + '</div>' + filas + '</div>';
       }).join('');
   }
   // Subir al global: propaga a las demás sucursales y da la novedad por resuelta.
   function _novAplicar(key, insId) {
       actualizarEnGlobal(insId);
       _NOV_VISTAS[key] = 1; _novGuardarVistas();
       _novRender(document.getElementById('novBuscar') ? document.getElementById('novBuscar').value : '');
   }
   // Dejar así: se queda como cambio local de esa sucursal y sale de la lista.
   function _novDejar(key) {
       _NOV_VISTAS[key] = 1; _novGuardarVistas();
       _novRender(document.getElementById('novBuscar') ? document.getElementById('novBuscar').value : '');
   }
   window.abrirNovedadesIns = abrirNovedadesIns;
   window._novRender = _novRender;
   window._novAplicar = _novAplicar;
   window._novDejar = _novDejar;

   function _subUnidadNombre(p) {
       var n = String(p.nombreSubUnidad || '').trim();
       return n || 'unidad';
   }
   function _subUnidadCardHTML(p, i) {
       var hay = parseFloat(p.unidadesPorPieza) > 1;
       var v = parseFloat(p.costoSubUnidad) || 0;
       return '<div class="meta-item" id="box-subun-'+i+'"'+(hay?'':' style="display:none"')+'>'
           + '<label id="lbl-subun-'+i+'">Costo por '+etx(_subUnidadNombre(p))+' '+_MXN+'</label>'
           + '<div id="ref-subun-'+i+'" style="background:var(--surface);border:1px solid var(--blue);border-radius:6px;'
           + 'padding:8px 12px;font-size:14px;color:var(--blue);font-weight:700">'+fmtMXN(v, 3)+'</div></div>';
   }

   /* CONTENIDO: se captura el de UNA sub-unidad (una tostada, una vara, una lata),
      que es lo que la gente tiene a la mano. El sistema multiplica por cuántas trae
      la pieza y guarda el TOTAL en contNeto — la llave que leen inventarios y
      recetas, que no cambia de significado. Antes se pedía el peso del paquete
      completo y había que dividir a mano; ahora es al revés.
        paquete de 14 varas · 30 G cada una  →  contNeto = 420 G la pieza
        caja de 11 paquetes · 40 tostadas c/u · 25 G cada tostada
              →  costo por paquete = precio/11 · por tostada = ese ÷ 40
              →  contNeto = 25 × 40 = 1000 G por paquete → $/kg y $/g correctos   */
   function _contSubDe(p) {
       // Valor que va en la ventanilla: el de la sub-unidad. Sin sub-unidades, el de
       // la pieza. Registros viejos (guardaron el total) se convierten al vuelo.
       var n = parseFloat(p.unidadesPorPieza) || 0;
       if (!(n > 1)) return p.contNeto || '';
       if (p.contSub !== undefined && p.contSub !== '') return p.contSub;
       var c = parseFloat(p.contNeto) || 0;
       return c > 0 ? String(Math.round((c / n) * 1000) / 1000) : '';
   }
   // Guarda lo tecleado como sub-unidad y recalcula el TOTAL de la pieza.
   function _setContSub(p, val) {
       p.contSub = val;
       var n = parseFloat(p.unidadesPorPieza) || 0;
       var v = parseFloat(val) || 0;
       p.contNeto = (n > 1) ? String(Math.round(v * n * 10000) / 10000) : val;
   }
   function _hintSubUnidadHTML(p, i) {
       return '<div id="hint-subun-'+i+'" style="font-size:10.5px;color:var(--blue);margin:-6px 0 8px;line-height:1.5">'
           + _hintSubUnidadTexto(p) + '</div>';
   }
   function _hintSubUnidadTexto(p) {
       var n = parseFloat(p.unidadesPorPieza) || 0;
       var cada = parseFloat(_contSubDe(p)) || 0;
       if (!(n > 1) || cada <= 0) return '';
       var um = (p.umContenido || 'G').toUpperCase();
       var tot = Math.round(cada * n * 1000) / 1000;
       var nom = _subUnidadNombre(p), sing = nom.replace(/s$/, '');
       return '📐 ' + n + ' ' + etx(nom) + ' × ' + cada + ' ' + um + ' cada ' + etx(sing)
            + ' = <b>' + tot + ' ' + um + '</b> por pieza. De ahí salen el costo por '
            + etx(sing) + ', por pieza y por kilo/litro.';
   }
   function _pintarHintSubUnidad(p, i) {
       var el = document.getElementById('hint-subun-'+i);
       if (el) el.innerHTML = _hintSubUnidadTexto(p);
   }

   function _calcCostoSubUnidad(p, costoPieza) {
       const n = parseFloat(p.unidadesPorPieza) || 0;
       p.costoSubUnidad = (n > 1 && costoPieza > 0) ? (costoPieza / n).toFixed(4) : '';
   }

   // ── Auxiliares de cálculo para updPres ────────────────────────────────────
   // ¿La presentación de compra se cobra por PESO/VOLUMEN? Ahí la cantidad son
   // kilos o litros, no piezas, y dividir sería incorrecto.
   const _PRES_A_GRANEL = ['kilo','kilos','litro','litros','gramo','gramos','a granel — kg','granel','a granel'];
   function _presEsGranel(nom) {
       return _PRES_A_GRANEL.indexOf(String(nom || '').toLowerCase().trim()) >= 0;
   }
   function _calcCostosAbarrote(p, precioEfectivo, contML) {
       const cantPres = parseFloat(p.cantPresCompra) || 1;
       const presCompra = p.presentacionCompra || 'Pieza';

       // Antes solo dividían Caja, Paquete y Costal. Una BOLSA de 16 piezas, una
       // rejilla, un tarro — o cualquier concepto que el negocio agregue con
       // "＋ Agregar concepto" — se quedaban sin dividir y el costo por pieza
       // salía igual al precio de TODA la caja. Lo que manda es la cantidad, no
       // cómo se llame el empaque; se excluye solo lo que se compra a granel.
       const piezasEnPack = (cantPres > 1 && !_presEsGranel(presCompra)) ? cantPres : 1;
       const costoPieza = precioEfectivo / piezasEnPack;
       p.costoPieza = costoPieza.toFixed(2);
       _calcCostoSubUnidad(p, costoPieza);

       // Si hay masa drenada usar ese contenido para el costo, si no el contenido del producto
       const masaDrena  = parseFloat(p.masaDrenada) || 0;
       const umEfectivo = masaDrena > 0
           ? (p.umMasaDrenada || 'G').toUpperCase()
           : (p.umContenido   || 'G').toUpperCase();
       const contEfML   = masaDrena > 0 ? toML(masaDrena, umEfectivo) : contML;

       if (umEfectivo === 'ML') {
           p.costoUnitario = contEfML > 0 ? (costoPieza / contEfML).toFixed(4) : '0';
           p.umCosto = 'ML';
       } else if (umEfectivo === 'LT') {
           p.costoUnitario = contEfML > 0 ? (costoPieza / (contEfML / 1000)).toFixed(2) : '0';
           p.umCosto = 'LT';
       } else if (umEfectivo === 'G') {
           p.costoUnitario = contEfML > 0 ? (costoPieza / contEfML).toFixed(4) : '0';
           p.umCosto = 'G';
       } else if (umEfectivo === 'KG') {
           p.costoUnitario = contEfML > 0 ? (costoPieza / (contEfML / 1000)).toFixed(2) : '0';
           p.umCosto = 'KG';
       } else if (['PZA','CARGA','PORCION'].includes(umEfectivo)) {
           p.costoUnitario = costoPieza.toFixed(2);
           p.umCosto = 'PZA';
       } else {
           p.costoUnitario = contEfML > 0 ? (costoPieza / (contEfML / 1000)).toFixed(2) : '0';
           p.umCosto = 'KG';
       }
   }

   function _calcCostosBarril(p, precioEfectivo, contML) {
       const litrosBarril = parseFloat(p.cantPresCompra) || 1;
       const barrilML     = litrosBarril * 1000;
       const vasoML       = contML > 0 ? contML : 1;
       p.costoPieza    = barrilML > 0 ? (precioEfectivo * vasoML / barrilML).toFixed(2) : '0';
       p.costoUnitario = litrosBarril > 0 ? (precioEfectivo / litrosBarril).toFixed(2) : '0';
       p.umCosto       = 'LT';
   }

   // Proteínas: usa cantPresCompra + umPresCompra como peso/volumen total de compra
   function _calcCostosProteina(p, precioEfectivo) {
       const cantPres = parseFloat(p.cantPresCompra) || 0;
       const umPres   = (p.umPresCompra || 'KG').toUpperCase();
       const isPiezas = ['PZA','PORCION'].includes(umPres);

       if (!isPiezas && cantPres > 0) {
           // Compra por peso/volumen total (Rack 24 KG, Bolsa 5 KG, Granel 10 KG, etc.)
           p.costoPieza = precioEfectivo.toFixed(2);
           _calcCostoSubUnidad(p, precioEfectivo);
           const totalML  = toML(cantPres, umPres); // KG→1000 G→1 LT→1000 ML→1
           const isWeight = ['KG','G'].includes(umPres);
           if (totalML > 0) {
               // costoUnitario = $/KG o $/LT (unidad "grande")
               p.costoUnitario = (precioEfectivo / (totalML / 1000)).toFixed(4);
               p.umCosto = isWeight ? 'KG' : 'LT';
           } else {
               p.costoUnitario = '0';
               p.umCosto = 'KG';
           }
       } else {
           // Compra por piezas (10 PZA de 200G c/u)
           const piezas     = cantPres > 0 ? cantPres : 1;
           const costoPieza = precioEfectivo / piezas;
           p.costoPieza = costoPieza.toFixed(2);
           _calcCostoSubUnidad(p, costoPieza);
           const contML2 = toML(p.contNeto, p.umContenido || 'G');
           const umCont  = (p.umContenido || 'G').toUpperCase();
           const isWeight = ['KG','G'].includes(umCont);
           if (contML2 > 0) {
               p.costoUnitario = (costoPieza / (contML2 / 1000)).toFixed(4);
               p.umCosto = isWeight ? 'KG' : 'LT';
           } else {
               p.costoUnitario = '0';
               p.umCosto = isWeight ? 'KG' : 'LT';
           }
       }
   }

   function _calcCostosRefrescoCerveza(p, precioEfectivo, contML) {
       const presCompra = p.presentacionCompra || 'Pieza';
       const cantPres   = parseFloat(p.cantPresCompra) || 1;
       const costoPieza = ['Caja','Rejilla'].includes(presCompra) && cantPres > 0
           ? precioEfectivo / cantPres
           : precioEfectivo;
       p.costoPieza = costoPieza.toFixed(2);
       if (contML > 0) {
           const _um = (p.umCosto || 'LT').toUpperCase();
           p.costoUnitario = (_um === 'PZA')
               ? costoPieza.toFixed(2)
               : (costoPieza / (contML / 1000)).toFixed(2);
       }
   }

   function _updateDisplaysRefrescoCerv(p, i) {
       const _cp  = parseFloat(p.costoPieza)||0;
       const _fp  = parseFloat(p.factorPieza)||2.0;
       const { oz: _ozV, lt: _ltV } = calcOzLt(p.costoPieza, p.contNeto, p.umContenido);
       var _elP     = document.getElementById('ref-pieza-'+i);
       var _elO     = document.getElementById('ref-onza-'+i);
       var _elL     = document.getElementById('ref-litro-'+i);
       var _elCarta = document.getElementById('ref-precio-carta-'+i);
       if (_elP) _elP.textContent = fmtMXN(_cp);
       if (_elO) _elO.textContent = _ozV;
       if (_elL) _elL.textContent = _ltV;

       // Precio sugerido = costo pieza \u00d7 factor
       var _precioSugerido = _cp * _fp;
       if (tipoInsumoActual === 'cerveza_barril') {
           const _ltNum = _ltV !== '\u2014' ? parseFloat(_ltV.replace('$ ','').replace(/,/g,'')) : 0;
           _precioSugerido = _ltNum * _fp;
           if (_elCarta) _elCarta.textContent = fmtMXN(_precioSugerido);
           var _elVaso = document.getElementById('ref-precio-vaso-'+i);
           if (_elVaso) _elVaso.textContent = fmtMXN(_cp * _fp);
       } else {
           if (_elCarta) _elCarta.textContent = fmtMXN(_precioSugerido);
       }

       // Auto-poblar precioCarta con el precio sugerido si est\u00e1 vac\u00edo o igual al sugerido anterior
       if (_precioSugerido > 0) {
           const _pcActual = parseFloat(p.precioCarta) || 0;
           // Solo auto-fill si precioCarta est\u00e1 vac\u00edo \u2014 no sobreescribir si el usuario lo cambi\u00f3
           if (!_pcActual) {
               p.precioCarta = _precioSugerido.toFixed(2);
               const _elInput = document.querySelector(`#listaPresentaciones [oninput*="updPres(${i},'precioCarta'"]`);
               if (_elInput) _elInput.value = fmtPrecio(p.precioCarta);
           }
       }
   }

   function updPres(i, campo, val) {
       presentacionesTemp[i][campo] = val;
       const p = presentacionesTemp[i];
       // El contenido se teclea POR SUB-UNIDAD; contNeto guarda el total de la pieza.
       if (campo === 'contSub') _setContSub(p, val);
       // Cambiar cuántas sub-unidades trae la pieza recalcula el total con el mismo
       // contenido unitario (14 varas → 20 varas, sin volver a teclear los gramos).
       if (campo === 'unidadesPorPieza') _setContSub(p, _contSubDe(p));
   
       // ── 1. Auto-calcular costoUnitario desde precio + contenido ──
       // Solo si el usuario no lo ha llenado manualmente o si cambia precio/contenido
       const precio         = parseFloat(p.precio) || 0;
       const precioEfectivo = precio * calcImpFactor(p);
       const contML         = toML(p.contNeto, p.umContenido || 'ML');
   
       const _triggerCosto = ['precio','contNeto','contSub','umContenido','cantPresCompra','presentacionCompra','umPresCompra','factorPieza','tamanoCopa','ivaCheck','iepsCheck','iepsTasa','incluyeImpuesto','masaDrenada','umMasaDrenada','unidadesPorPieza','nombreSubUnidad'];
       if (_triggerCosto.includes(campo) && precioEfectivo > 0) {
           if (tipoInsumoActual === 'cerveza_barril') {
               _calcCostosBarril(p, precioEfectivo, contML);
           } else if (['refresco','cerveza'].includes(tipoInsumoActual)) {
               _calcCostosRefrescoCerveza(p, precioEfectivo, contML);
           } else if (tipoInsumoActual === 'carne' || tipoInsumoActual === 'fruta') {
               _calcCostosProteina(p, precioEfectivo);
           } else if (tipoInsumoActual === 'abarrote') {
               _calcCostosAbarrote(p, precioEfectivo, contML);
           } else if (contML > 0) {
               p.costoUnitario = (precioEfectivo / (contML / 1000)).toFixed(2);
               p.umCosto = 'LT';
           }
           const elCU = document.querySelector(`#listaPresentaciones [oninput*="updPres(${i},'costoUnitario"]`);
           if (elCU) elCU.value = p.costoUnitario;
           // Actualizar display auto-calc (solo lectura)
           const elCUAuto = document.getElementById(`cu-auto-val-${i}`);
           if (elCUAuto) elCUAuto.textContent = fmtPrecio(p.costoUnitario);
           // Actualizar precio final c/impuestos
           const elPF = document.getElementById(`precio-final-val-${i}`);
           if (elPF) {
               const _base = parseFloat(p.precio) || 0;
               const _dis  = p.incluyeImpuesto !== '0';
               let _factor = 1;
               if (!_dis) {
                   if (p.ivaCheck === '1')  _factor *= 1.16;
                   if (p.iepsCheck === '1') _factor *= (1 + parseFloat(p.iepsTasa || '26.5') / 100);
               }
               elPF.textContent = fmtMXN(_base * _factor);
           }
           // Actualizar displays de refresco/cerveza/abarrote
           if (['refresco','cerveza','cerveza_barril'].includes(tipoInsumoActual)) {
               _updateDisplaysRefrescoCerv(p, i);
           }
           if (tipoInsumoActual === 'abarrote' || tipoInsumoActual === 'carne' || tipoInsumoActual === 'fruta') {
               const _cp    = parseFloat(p.costoPieza)||0;
               const _cu    = parseFloat(p.costoUnitario)||0;
               const _um2   = (p.umCosto || 'KG').toUpperCase();
               const _cuBig2   = ['ML','G'].includes(_um2) ? _cu * 1000 : _cu;
               const _cuSmall2 = ['LT','KG'].includes(_um2) ? _cu / 1000 : _cu;
               const _elP  = document.getElementById('ref-pieza-'+i);
               const _elC  = document.getElementById('ref-costoum-'+i);
               const _elS  = document.getElementById('ref-costomlgr-'+i);
               if (_elP) _elP.textContent = fmtMXN(_cp);
               if (_elC) _elC.textContent = fmtMXN(_cuBig2);
               if (_elS) _elS.textContent = fmtMXN(_cuSmall2, 3);
               // La tarjeta SIEMPRE está en el DOM y solo se muestra/oculta: volver a
               // pintar el formulario en cada tecla mataba el foco y solo dejaba
               // escribir un dígito en "Cada pieza trae".
               const _elUW = document.getElementById('box-subun-'+i);
               const _elU  = document.getElementById('ref-subun-'+i);
               const _elUL = document.getElementById('lbl-subun-'+i);
               const _hay  = parseFloat(p.unidadesPorPieza) > 1;
               if (_elUW) _elUW.style.display = _hay ? '' : 'none';
               if (_elU)  _elU.textContent  = fmtMXN(parseFloat(p.costoSubUnidad)||0, 3);
               if (_elUL) _elUL.textContent = 'Costo por '+_subUnidadNombre(p)+' MXN';
               _pintarHintSubUnidad(p, i);
           }
       }
   
       // ── Auto-calcular rendimiento desde contenido neto ────────────
       // Convierte contML a la unidad de rendimiento elegida
       if ((campo === 'contNeto' || campo === 'umContenido' || campo === 'umRendimiento') && contML > 0) {
           const umRen  = (p.umRendimiento || 'OZ').toUpperCase();
           const rend   = contML / toML(1, umRen);
           p.rendimiento = rend.toFixed(2);
           // Actualizar input visual — buscar por atributo oninput
           const allInputs = document.querySelectorAll('#listaPresentaciones input[type="number"]');
           allInputs.forEach(el => {
               if (el.getAttribute('oninput') === `updPres(${i},'rendimiento',this.value)`) {
                   el.value = p.rendimiento;
               }
           });
           // Actualizar costo/um label
           const elCostoUm  = document.getElementById(`costo-um-${i}`);
           const elLblCosto = document.getElementById(`lbl-costoum-${i}`);
           if (elCostoUm) {
               const c = calcCostoPorUm(p.costoUnitario, p.umCosto||'LT', umRen);
               elCostoUm.textContent = c ? '$'+c : '—';
           }
           if (elLblCosto) elLblCosto.textContent = `Costo / ${umRen} (auto)`;
       }
   
       // ── 2. Recalcular peso cristal ────────────────────────────────
       const pesoUnidad = parseFloat(p.pesoUnidad) || 0;
       const umPeso     = (p.umPeso || 'G').toUpperCase();
       const pesoUnidag = umPeso === 'KG' ? pesoUnidad * 1000 : pesoUnidad;
       // contML ya está en ML (mismo que gramos para líquidos densidad≈1)
       if (contML > 0 && pesoUnidag > 0) {
           p.pesoCristal = (pesoUnidag - contML).toFixed(0);
       }
   
       // ── 3. Actualizar campos calculados en DOM ────────────────────
       const CALCULA_CRISTAL = ['contNeto','pesoUnidad','umContenido','umPeso'];
       const CALCULA_COPA    = ['costoUnitario','umCosto','tamanoCopa','umTamanoCopa','contNeto','umContenido','precio','factorCopa','factorBotella','factorPieza'];
   
       if (CALCULA_CRISTAL.includes(campo)) {
           const el = document.getElementById(`cristal-${i}`);
           if (el) el.textContent = p.pesoCristal ? `${p.pesoCristal} g` : '— g';
       }
   
       if (CALCULA_COPA.includes(campo)) {
           actualizarCopaCosto(i);
       }
   
       // Costo por UM — actualizar siempre que cambie algo relevante
       if (['rendimiento','umRendimiento','costoUnitario','umCosto','precio','contNeto','umContenido'].includes(campo)) {
           const elCostoUm  = document.getElementById(`costo-um-${i}`);
           const elLblCosto = document.getElementById(`lbl-costoum-${i}`);
           if (elCostoUm) {
               const c = calcCostoPorUm(p.costoUnitario, p.umCosto||'LT', p.umRendimiento||'OZ');
               elCostoUm.textContent = c ? '$'+c : '—';
           }
           if (elLblCosto) elLblCosto.textContent = `Costo / ${p.umRendimiento||'OZ'} (auto)`;
       }
   
       if (campo === 'tamanoCopa' || campo === 'umTamanoCopa') {
           const el = document.getElementById(`copa-equiv-${i}`);
           if (el) {
               const tc = parseFloat(p.tamanoCopa)||0;
               const um = p.umTamanoCopa||'ML';
               el.textContent = !tc ? '\u2014'
                   : um==='ML' ? `${tc} ML = ${(tc/OZ_ML).toFixed(2)} OZ`
                   : `${tc} OZ = ${(tc*OZ_ML).toFixed(1)} ML`;
           }
           actualizarCopaCosto(i);
       }
       _actualizarUtilidad(i);
   }

   function actualizarCopaCosto(i) {
       const p    = presentacionesTemp[i];
       const wrap = document.getElementById(`copa-cards-${i}`);
       if (!wrap) return;
       // Rendimiento en copas
       const contML = toML(p.contNeto, p.umContenido||'ML');
       const tML    = toML(p.tamanoCopa, p.umTamanoCopa||'ML');
       const elRend = document.getElementById('copas-rend-' + i);
       if (elRend) elRend.textContent = (contML > 0 && tML > 0) ? Math.floor(contML / tML) + ' copas' : '—';
       wrap.innerHTML = _costeoCardsHTML(p);
   }
   
   // ── Helpers de formato de precio ─────────────────────────────
   function fmtPrecio(val) {
       const n = parseFloat(String(val).replace(/,/g,''));
       if (!n) return '';
       return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
   }

   function focusCurrency(el) {
       el.value = el.value.replace(/,/g, '');
   }

   function blurCurrency(el, idx, campo) {
       const raw = el.value.replace(/,/g, '');
       const n = parseFloat(raw);
       if (n) el.value = n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
       updPres(idx, campo, raw);
   }

   function inputCurrency(el, idx, campo) {
       updPres(idx, campo, el.value.replace(/,/g, ''));
   }

   // aliases para compatibilidad con llamadas existentes
   function focusPrecioInput(el)        { focusCurrency(el); }
   function blurPrecioInput(el, idx)    { blurCurrency(el, idx, 'precio'); }
   function inputPrecioRaw(el, idx)     { inputCurrency(el, idx, 'precio'); }

   // Formatea número con comas de miles para mostrar en displays (no inputs)
   function fmtMXN(val, dec) {
       if (dec === undefined) dec = 2;
       const n = parseFloat(val) || 0;
       if (!n) return '\u2014';
       const parts = n.toFixed(dec).split('.');
       parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
       return '$ ' + parts.join('.');
   }

   // ── Helpers de conversión ─────────────────────────────────────
   /** Convierte una cantidad en `um` a mililitros */
   function toML(valor, um) {
       const v = parseFloat(valor) || 0;
       const u = (um || 'ML').toUpperCase();
       const factor = { LT:1000, ML:1, OZ:OZ_ML, G:1, KG:1000, PZA:1, PORCION:1, COPA:COPA_ML };
       return v * (factor[u] || 1);
   }

   /**
    * Calcula costo por onza y por litro a partir de costoPieza y contenido.
    * Devuelve { oz, lt } como strings con '$' o '—'.
    */
   function calcOzLt(costoPieza, contNeto, umContenido) {
       const cp  = parseFloat(costoPieza) || 0;
       const cML = toML(contNeto, umContenido);
       if (!cp || !cML) return { oz: '\u2014', lt: '\u2014' };
       return {
           oz: fmtMXN(cp / (cML / OZ_ML)),
           lt: fmtMXN(cp / (cML / 1000)),
       };
   }

   // ── Costo por unidad de medida (auto) ────────────────────────
   // Convierte costoUnitario (en umCosto) al costo por 1 unidad de umRendimiento
   function calcCostoPorUm(costoUnitario, umCosto, umRendimiento) {
       const cu = parseFloat(costoUnitario) || 0;
       if (!cu) return null;
   
       // Factores de conversión a ML (base)
       const aML = { LT:1000, ML:1, OZ:OZ_ML, G:1, KG:1000, PZA:1, PORCION:1, COPA:COPA_ML };
   
       // 1 umCosto → ML
       const mlPorUmCosto = aML[umCosto] || 1000;
       // costo por ML
       const costoPorML = cu / mlPorUmCosto;
   
       // 1 umRendimiento → ML
       const mlPorUmRen = aML[umRendimiento] || 1;
       const costoPorUm = costoPorML * mlPorUmRen;
   
       return costoPorUm.toFixed(2);
   }
   
   // ── Calcular costo de copa ────────────────────────────────────
   // costoUnitario siempre en $/LT
   // tamaño copa en ML u OZ → convierte a ML → costo = $/LT × (ml/1000)
   function calcCostoCopa(costoUnitario, umCosto, tamanoCopa, umTamano) {
       const cu = parseFloat(costoUnitario) || 0;
       const tc = parseFloat(tamanoCopa)   || 0;
       if (!cu || !tc) return null;
   
       // Normalizar costo a $/LT
       let costoPorLt = cu;
       if (umCosto === 'KG') costoPorLt = cu; // asumimos densidad 1 para líquidos
   
       // Tamaño copa a ML
       const tamML = umTamano === 'OZ' ? tc * OZ_ML : tc;
   
       const costoCopa = costoPorLt * (tamML / 1000);
       const costoOz   = costoPorLt * (OZ_ML / 1000);
   
       return {
           costoCopa: costoCopa.toFixed(2),
           costoOz:   costoOz.toFixed(2),
           tamML:     tamML.toFixed(1)
       };
   }
   
   // ── Sub-render helpers para renderPresentaciones ─────────────────────────

   function _renderImpuestosBlock(p, i, esAbarrote) {
       if (p.incluyeImpuesto === undefined) return '';
       const dis     = p.incluyeImpuesto !== '0';
       const ivaChk  = p.ivaCheck==='1' || p.incluyeImpuesto==='1' || p.incluyeImpuesto==='2';
       const iepsChk = p.iepsCheck==='1' || p.incluyeImpuesto==='2';

       const _hasMasaDrenada = esAbarrote && parseFloat(p.masaDrenada) > 0;
       const _hasImpuesto    = !dis && (p.ivaCheck==='1' || p.iepsCheck==='1');
       let precioFinalHtml = '';
       if (_hasMasaDrenada || _hasImpuesto) {
           const base   = parseFloat(p.precio)||0;
           let factor   = 1;
           let tags     = '';
           if (_hasImpuesto) {
               if (p.ivaCheck==='1')  factor *= 1.16;
               if (p.iepsCheck==='1') factor *= (1 + parseFloat(p.iepsTasa||'26.5')/100);
               tags = [p.ivaCheck==='1'?'+ IVA 16%':'', p.iepsCheck==='1'?'+ IEPS '+(p.iepsTasa||'26.5')+'%':''].filter(Boolean).join(' · ');
           }
           const masaLabel = _hasMasaDrenada
               ? `<div style="font-size:9px;color:var(--text-dim);margin-top:2px">Masa drenada: ${p.masaDrenada} ${p.umMasaDrenada||'G'}</div>`
               : '';
           precioFinalHtml = `<div class="meta-item" style="margin-top:10px" id="precio-final-block-${i}">
               <label>${_hasImpuesto ? 'Precio final (c/impuestos)' : 'Precio base (masa drenada)'} ${_MXN}</label>
               <div style="background:var(--surface);border:1px solid var(--green-dim);border-radius:6px;padding:8px 12px">
                   <div id="precio-final-val-${i}" style="font-size:15px;font-weight:700;color:var(--green)">${fmtMXN(base * factor)}</div>
                   ${tags ? `<div style="font-size:9px;color:var(--text-dim);margin-top:2px">${tags}</div>` : ''}
                   ${masaLabel}
               </div>
           </div>`;
       }

       return `<div style="background:rgba(245,200,66,.04);border:1px solid rgba(245,200,66,.15);border-radius:8px;padding:12px 14px;margin-bottom:10px">
           <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);opacity:.7;margin-bottom:10px">Impuestos</div>
           <div class="meta-grid" style="grid-template-columns:1fr 1fr;gap:8px">
               <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px">
                   <input type="checkbox" id="iva-${i}" ${ivaChk?'checked':''} ${dis?'disabled':''}
                       onchange="updPres(${i},'ivaCheck',this.checked?'1':'0');renderPresentaciones()"
                       style="width:16px;height:16px;accent-color:var(--accent);cursor:${dis?'default':'pointer'}">
                   <label for="iva-${i}" style="cursor:pointer;font-size:12px;flex:1">
                       <span style="font-weight:600">IVA</span><span style="color:var(--accent);margin-left:4px">16%</span>
                   </label>
               </div>
               <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px">
                   <input type="checkbox" id="ieps-${i}" ${iepsChk?'checked':''} ${dis?'disabled':''}
                       onchange="updPres(${i},'iepsCheck',this.checked?'1':'0');renderPresentaciones()"
                       style="width:16px;height:16px;accent-color:var(--accent);cursor:${dis?'default':'pointer'}">
                   <label for="ieps-${i}" style="cursor:pointer;font-size:12px;flex:1;display:flex;align-items:center;gap:6px">
                       <span style="font-weight:600">IEPS</span>
                       <select onchange="updPres(${i},'iepsTasa',this.value);renderPresentaciones()"
                           style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:3px 6px;border-radius:4px;font-size:11px;font-family:inherit">
                           ${['26.5','30','8','50','160'].map(t =>
                               '<option value="'+t+'"'+((p.iepsTasa||'26.5')===t?' selected':'')+'>'+t+'%</option>'
                           ).join('')}
                       </select>
                   </label>
               </div>
           </div>
           ${precioFinalHtml}
       </div>`;
   }

   function _renderFilaCostosBlock(p, i, flags) {
       const { esBarril, esRefrescoCerv, esBebidaCompleta, esAbarrote, esCarne } = flags;
       const show = true;
       const _cp  = parseFloat(p.costoPieza)||0;
       const { oz: _ozV, lt: _ltV } = calcOzLt(p.costoPieza, p.contNeto, p.umContenido);
       const _fp  = parseFloat(p.factorPieza)||2.0;
       const _csV = _ltV !== '\u2014' ? fmtMXN(parseFloat(_ltV.replace('$ ','').replace(/,/g,'')) * _fp) : '\u2014';

       let innerHtml = '';
       if (esBarril) {
           innerHtml = '<div class="meta-item"><label>Costo por onza '+_MXN+'</label>'
               + '<div id="ref-onza-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--accent);font-weight:600">'+_ozV+'</div></div>'
               + '<div class="meta-item"><label>Costo por litro '+_MXN+'</label>'
               + '<div id="ref-litro-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--text-dim);font-weight:600">'+_ltV+'</div></div>'
               + '<div class="meta-item"><label>Costo sugerido por litro '+_MXN+'</label>'
               + '<div id="ref-precio-carta-'+i+'" style="background:var(--surface);border:1px solid var(--accent);border-radius:6px;padding:8px 12px;font-size:15px;color:var(--accent);font-weight:700">'+_csV+'</div></div>';
       } else if (esRefrescoCerv) {
           innerHtml = '<div class="meta-item"><label>Costo por pieza '+_MXN+'</label>'
               + '<div id="ref-pieza-'+i+'" style="background:var(--surface);border:1px solid var(--green-dim);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--green);font-weight:600">'+fmtMXN(_cp)+'</div></div>'
               + '<div class="meta-item"><label>Costo por onza '+_MXN+'</label>'
               + '<div id="ref-onza-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--accent);font-weight:600">'+_ozV+'</div></div>'
               + '<div class="meta-item"><label>Costo por litro '+_MXN+'</label>'
               + '<div id="ref-litro-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--text-dim);font-weight:600">'+_ltV+'</div></div>';
       } else if (esAbarrote || esCarne) {
           const _um      = (p.umCosto || 'KG').toUpperCase();
           const _cu      = parseFloat(p.costoUnitario)||0;
           const _umCont  = (p.umContenido || 'G').toUpperCase();
           const _esPieza = ['PZA','CARGA','PORCION'].includes(_umCont);

           const _cuBig   = ['ML','G'].includes(_um) ? _cu * 1000 : _cu;
           const _cuSmall = ['LT','KG'].includes(_um) ? _cu / 1000 : _cu;

           innerHtml = (!_esPieza
               ? '<div class="meta-item"><label>Costo por pieza '+_MXN+'</label>'
                 + '<div id="ref-pieza-'+i+'" style="background:var(--surface);border:1px solid var(--green-dim);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--green);font-weight:600">'+fmtMXN(_cp)+'</div></div>'
               : '')
               + (!_esPieza ? '<div class="meta-item"><label>Costo por KG/LT '+_MXN+'</label>'
               + '<div id="ref-costoum-'+i+'" style="background:var(--surface);border:1px solid var(--accent);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--accent);font-weight:700">'+fmtMXN(_cuBig)+'</div></div>' : '')
               + (!_esPieza ? '<div class="meta-item"><label>Costo por ML/GR '+_MXN+'</label>'
               + '<div id="ref-costomlgr-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:13px;color:var(--text-dim);font-weight:600">'+fmtMXN(_cuSmall, 3)+'</div></div>' : '')
               + _subUnidadCardHTML(p, i);
       } else {
           innerHtml = `<div class="meta-item">
               <label>Rendimiento</label>
               <input type="number" value="${p.rendimiento||''}" placeholder="23.33"
                   oninput="updPres(${i},'rendimiento',this.value)">
           </div>
           <div class="meta-item">
               <label>Unidad rendimiento</label>
               <select onchange="updPres(${i},'umRendimiento',this.value)">
                   ${UNIDADES_REN.map(u =>
                       '<option value="'+u+'"'+((p.umRendimiento||'OZ')===u?' selected':'')+'>'+u+'</option>'
                   ).join('')}
               </select>
           </div>
           <div class="meta-item">
               <label id="lbl-costoum-${i}">Costo / ${p.umRendimiento||'OZ'} (auto) ${_MXN}</label>
               <div id="costo-um-${i}" style="background:var(--surface);border:1px solid var(--green-dim);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--green);font-weight:600">
                   ${(()=>{ const c = calcCostoPorUm(p.costoUnitario, p.umCosto||'LT', p.umRendimiento||'OZ'); return c ? '$'+c : '—'; })()}
               </div>
           </div>`;
       }
       return `<div class="mg-3"${show ? '' : ' style="display:none"'}>${innerHtml}</div>`;
   }

   function _renderCosteoAutoBlock(p, i, tieneCopa, esVino) {
       if (!tieneCopa) return '';

       const copaInputs = esVino ? `
           <div class="mg-3" style="grid-template-columns:repeat(4,1fr)">
               <div class="meta-item">
                   <label>Tamaño de copa</label>
                   <input type="number" value="${p.tamanoCopa||''}" placeholder="150" min="0" step="0.5"
                       oninput="updPres(${i},'tamanoCopa',this.value)">
               </div>
               <div class="meta-item">
                   <label>Unidad copa</label>
                   <select onchange="updPres(${i},'umTamanoCopa',this.value);renderPresentaciones()">
                       <option value="ML" ${(p.umTamanoCopa||'ML')==='ML'?'selected':''}>ML</option>
                       <option value="OZ" ${(p.umTamanoCopa||'ML')==='OZ'?'selected':''}>OZ</option>
                   </select>
               </div>
               <div class="meta-item">
                   <label>Leer consumo en <span style="text-transform:none;letter-spacing:0;color:var(--text-dim)">(inventario)</span></label>
                   <select onchange="updPres(${i},'umLectura',this.value)">
                       <option value="" ${!p.umLectura?'selected':''}>Automático</option>
                       <option value="COPA" ${p.umLectura==='COPA'?'selected':''}>Copas</option>
                       <option value="OZ" ${p.umLectura==='OZ'?'selected':''}>Onzas</option>
                       <option value="ML" ${p.umLectura==='ML'?'selected':''}>Mililitros</option>
                       <option value="LT" ${p.umLectura==='LT'?'selected':''}>Litros</option>
                   </select>
               </div>
               <div class="meta-item">
                   <label>Rendimiento en copas</label>
                   <div id="copas-rend-${i}" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:14px;color:var(--accent);font-weight:600">
                       ${(()=>{ const cML=toML(p.contNeto,p.umContenido||'ML'); const tML=toML(p.tamanoCopa,p.umTamanoCopa||'ML'); return (cML>0&&tML>0)?Math.floor(cML/tML)+' copas':'\u2014'; })()}
                   </div>
               </div>
           </div>` : `
           <div class="meta-grid" style="grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px">
               <div class="meta-item">
                   <label>Tamaño de copa</label>
                   <input type="number" value="${p.tamanoCopa||''}" placeholder="45" min="0" step="0.5"
                       oninput="updPres(${i},'tamanoCopa',this.value)">
               </div>
               <div class="meta-item">
                   <label>Unidad copa</label>
                   <select onchange="updPres(${i},'umTamanoCopa',this.value);renderPresentaciones()">
                       <option value="ML" ${(p.umTamanoCopa||'ML')==='ML'?'selected':''}>ML</option>
                       <option value="OZ" ${(p.umTamanoCopa||'ML')==='OZ'?'selected':''}>OZ</option>
                   </select>
               </div>
               <div class="meta-item">
                   <label>Leer consumo en <span style="text-transform:none;letter-spacing:0;color:var(--text-dim)">(inventario)</span></label>
                   <select onchange="updPres(${i},'umLectura',this.value)">
                       <option value="" ${!p.umLectura?'selected':''}>Automático</option>
                       <option value="COPA" ${p.umLectura==='COPA'?'selected':''}>Copas</option>
                       <option value="OZ" ${p.umLectura==='OZ'?'selected':''}>Onzas</option>
                       <option value="ML" ${p.umLectura==='ML'?'selected':''}>Mililitros</option>
                       <option value="LT" ${p.umLectura==='LT'?'selected':''}>Litros</option>
                   </select>
               </div>
               <div class="meta-item">
                   <label>Mezcladores (pzas)</label>
                   <input type="number" value="${p.mezcladores||''}" placeholder="0" min="0" step="1"
                       oninput="updPres(${i},'mezcladores',this.value);actualizarCopaCosto(${i})">
               </div>
               <div class="meta-item">
                   <label>Mezclador (refresco)</label>
                   ${_mezcladorSelectHTML(p, i)}
               </div>
           </div>`;

       const cardsHtml = _costeoCardsHTML(p);

       return `<div style="padding-top:12px;border-top:1px solid var(--border)">
           <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:10px">Costeo automático</div>
           ${copaInputs}
           <div style="display:flex;align-items:center;gap:16px;margin-bottom:10px;padding:5px 10px;background:rgba(255,255,255,0.03);border-radius:6px">
               <span style="font-size:10px;color:var(--text-dim);letter-spacing:.05em;opacity:.5;white-space:nowrap;text-transform:uppercase">Factores \xd7</span>
               <div style="display:flex;align-items:center;gap:6px;flex:1">
                   <label style="font-size:11px;color:var(--text-dim);opacity:.6;white-space:nowrap;margin:0">copa</label>
                   <span style="color:var(--text-dim);font-size:11px;opacity:.4">\xd7</span>
                   <input type="number" value="${p.factorCopa||'3.3'}" placeholder="3.3" min="0.1" step="0.1"
                       style="color:var(--accent);flex:1;min-width:0;font-size:13px;padding:4px 8px;background:rgba(245,200,66,.06);border-color:rgba(245,200,66,.2)"
                       oninput="updPres(${i},'factorCopa',this.value)">
               </div>
               <div style="display:flex;align-items:center;gap:6px;flex:1">
                   <label style="font-size:11px;color:var(--text-dim);opacity:.6;white-space:nowrap;margin:0">botella</label>
                   <span style="color:var(--text-dim);font-size:11px;opacity:.4">\xd7</span>
                   <input type="number" value="${p.factorBotella||'2.5'}" placeholder="2.5" min="0.1" step="0.1"
                       style="color:var(--green);flex:1;min-width:0;font-size:13px;padding:4px 8px;background:rgba(61,190,122,.06);border-color:rgba(61,190,122,.2)"
                       oninput="updPres(${i},'factorBotella',this.value)">
               </div>
           </div>
           <div id="copa-cards-${i}">${cardsHtml}</div>
           ${_costeosExtraHTML(p, i)}
       </div>`;
   }

   /* ── Stock mínimo y máximo — para TODAS las familias ──────────────────
      Antes vivían dentro del bloque de "Precio carta", que solo se dibuja para
      lo que se vende directo (destilados, licores, vinos, cervezas, refrescos):
      abarrotes, proteínas, frutas y verduras se quedaban SIN poder definir
      stocks, y son justo las que más se piden. El stock es planeación de
      compra, no precio de venta — por eso va en su propio bloque. */
   function _renderStockBlock(p, i, tieneCopa) {
       var unidad = tieneCopa ? 'botellas' : 'unidades de compra';
       return `<div style="padding-top:12px;border-top:1px solid var(--border)">
           <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--blue);margin-bottom:8px">Stock · para requisiciones y alertas</div>
           <div class="meta-grid" style="grid-template-columns:1fr 1fr;gap:8px">
               <div class="meta-item">
                   <label>Stock mínimo</label>
                   <input type="number" value="${p.stockMin||''}" placeholder="0" min="0" step="1"
                       oninput="updPres(${i},'stockMin',this.value)">
               </div>
               <div class="meta-item">
                   <label>Stock máximo</label>
                   <input type="number" value="${p.stockMax||''}" placeholder="0" min="0" step="1"
                       oninput="updPres(${i},'stockMax',this.value)">
               </div>
           </div>
           <div style="font-size:10.5px;color:var(--text-dim);margin-top:7px;line-height:1.5">
               En ${unidad}. El mínimo dispara la alerta de "hay que pedir"; el máximo es hasta dónde surtir.
           </div>
       </div>`;
   }

   function _renderPrecioManualBlock(p, i, campos, tieneCopa) {
       if (!campos.includes('precioManual')) return '';
       return `<div style="padding-top:12px;border-top:1px solid var(--border)">
           <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--green);margin-bottom:8px">Precio carta (dato del negocio)</div>
           <div class="meta-grid" style="grid-template-columns:1fr 1fr;gap:8px">
               <div class="meta-item">
                   <label>${tieneCopa ? 'Precio copa' : 'Precio unitario'} <span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span></label>
                   <div style="display:flex;align-items:center;gap:4px">
                       <span style="color:var(--green);font-weight:600">$</span>
                       <input type="text" inputmode="decimal" value="${fmtPrecio(p.precioCarta)}" placeholder="0.00"
                           oninput="inputCurrency(this,${i},'precioCarta')"
                           onfocus="focusCurrency(this)"
                           onblur="blurCurrency(this,${i},'precioCarta')"
                           style="border-color:var(--green-dim);color:var(--green)">
                   </div>
               </div>
               ${tieneCopa ? `
               <div class="meta-item">
                   <label>Precio botella <span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span></label>
                   <div style="display:flex;align-items:center;gap:4px">
                       <span style="color:var(--green);font-weight:600">$</span>
                       <input type="text" inputmode="decimal" value="${fmtPrecio(p.precioCartaBot)}" placeholder="0.00"
                           oninput="inputCurrency(this,${i},'precioCartaBot')"
                           onfocus="focusCurrency(this)"
                           onblur="blurCurrency(this,${i},'precioCartaBot')"
                           style="border-color:var(--green-dim);color:var(--green)">
                   </div>
               </div>` : ''}
           </div>
           <div id="utilidad-${i}">${_utilidadHTML(p)}</div>
       </div>`;
   }

   // ── % de utilidad según el precio de carta vs el costo (costo = 0%) ──
   function _utilidadHTML(p) {
       var copa = calcCostoCopa(p.costoUnitario, p.umCosto||'LT', p.tamanoCopa, p.umTamanoCopa||'ML');
       var costoCopaNum = copa ? (parseFloat(copa.costoCopa) || 0) : 0;
       var refIns    = p.mezcladorId ? getInsumos().find(function(x){ return x.id === p.mezcladorId; }) : null;
       var mezPiezas = parseFloat(p.mezcladores) || 0;
       var mezCost   = (refIns && mezPiezas > 0) ? mezPiezas * _refrescoCostoPorPieza(refIns) : 0;
       var costoTrago = costoCopaNum + mezCost;
       var cu       = parseFloat(p.costoUnitario) || 0;
       var contML   = toML(p.contNeto, p.umContenido||'ML');
       var costoBot = cu > 0 && contML > 0 ? cu*(contML/1000) : 0;
       var precioCopa = parseFloat(String(p.precioCarta||'').replace(/,/g,'')) || 0;
       var precioBot  = parseFloat(String(p.precioCartaBot||'').replace(/,/g,'')) || 0;
       var items = [];
       if (precioCopa > 0 && costoTrago > 0)
           items.push(_utilChip(mezCost > 0 ? 'Utilidad trago' : 'Utilidad copa', (precioCopa - costoTrago)/costoTrago*100, precioCopa, costoTrago));
       if (precioBot > 0 && costoBot > 0)
           items.push(_utilChip('Utilidad botella', (precioBot - costoBot)/costoBot*100, precioBot, costoBot));
       if (!items.length) return '';
       return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">' + items.join('') + '</div>';
   }

   function _utilChip(label, pct, precio, costo) {
       var col = pct >= 0 ? 'var(--green)' : 'var(--red)';
       return '<div style="flex:1;min-width:140px;background:var(--surface);border:1px solid ' + col + ';border-radius:8px;padding:10px;text-align:center">' +
           '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px">' + label + '</div>' +
           '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;color:' + col + ';letter-spacing:1px">' + (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%</div>' +
           '<div style="font-size:9px;color:var(--text-dim)">precio ' + fmtMXN(precio) + ' · costo ' + fmtMXN(costo) + '</div>' +
           '</div>';
   }

   function _actualizarUtilidad(i) {
       var el = document.getElementById('utilidad-' + i);
       if (el) el.innerHTML = _utilidadHTML(presentacionesTemp[i]);
   }

   function renderPresentaciones() {
       const cfg    = TIPO_CONFIG[tipoInsumoActual] || TIPO_CONFIG['destilado'];
       const campos = cfg.campos;
       const esBebidaCompleta = ['destilado','licor','vino'].includes(tipoInsumoActual);
       const esVino           = tipoInsumoActual === 'vino';
       const esRefresco       = tipoInsumoActual === 'refresco';
       const esCerveza        = ['cerveza','cerveza_barril'].includes(tipoInsumoActual);
       const esBarril         = tipoInsumoActual === 'cerveza_barril';
       const esRefrescoCerv   = esRefresco || esCerveza;
       const esCarne          = tipoInsumoActual === 'carne';
       const esFruta          = tipoInsumoActual === 'fruta';
       const esCarneOFruta    = esCarne || esFruta;
       const esAbarrote       = tipoInsumoActual === 'abarrote';
       const tienePeso        = campos.includes('peso');
       const tieneCopa        = campos.includes('copa');
       const tienePresCompra  = campos.includes('presentacionCompra');
   
       var _btnC = document.getElementById('btnAgregarCosteo');
       if (_btnC) _btnC.style.display = tieneCopa ? '' : 'none';
       document.getElementById('listaPresentaciones').innerHTML =
           presentacionesTemp.map((pRaw, i) => {
               const p = _escCampos(pRaw);
               const contNeto   = parseFloat(p.contNeto)   || 0;
               const pesoUnidad = parseFloat(p.pesoUnidad) || 0;
               const umCont = (p.umContenido || 'ML').toUpperCase();
               const umPeso = (p.umPeso     || 'G').toUpperCase();
               const contNetog  = umCont === 'LT' ? contNeto * 1000 : contNeto;
               const pesoUnidag = umPeso === 'KG' ? pesoUnidad * 1000 : pesoUnidad;
               const pesoCristal = pesoUnidag > 0 && contNetog > 0
                   ? (pesoUnidag - contNetog).toFixed(0)
                   : '—';
   
               return `
               <div style="background:var(--surface2);border:1px solid var(--border);
                   border-radius:8px;padding:12px;margin-bottom:10px">
                   <div style="display:flex;justify-content:space-between;
                       align-items:center;margin-bottom:10px">
                       <span style="font-size:10px;letter-spacing:2px;
                           text-transform:uppercase;color:var(--accent)">Presentación ${i+1}</span>
                       <button class="btn-vista"
                           style="padding:2px 8px;font-size:11px;color:var(--red);border-color:var(--red)"
                           onclick="eliminarPresentacion(${i})">✕ Quitar</button>
                   </div>
   
                   ${tienePresCompra ? `
                   <!-- Presentación de compra -->
                   <div class="mg-3">
                       <div class="meta-item"><label>Presentación de compra</label>
                           <select onchange="onPresCompraChange(${i}, this)">
                               ${(function(){
                                   var base = esBarril ? ['Barril','Barriles']
                                       : esCarne ? ['Caja','Pieza completa / Corte primario','Rack','Bolsa','Granel','Paquete porcionado','Kilo','Otro']
                                       : esFruta ? ['A granel — kg','Por pieza','Por manojo / atado','Por caja','Por bolsa / red','Por charola','Kilo','Otro']
                                       : esAbarrote ? ['Pieza','Caja','Paquete','Bolsa','Costal','Tarro','Frasco','Lata','Kilo','Litro','Otro']
                                       : ['Pieza','Caja','Rejilla','Paquete','Rack','Bolsa','Lata','Botella','Frasco','Kilo','Gramo','Litro','Otro'];
                                   var def  = esBarril ? 'Barril' : esCarne ? 'Caja' : esFruta ? 'A granel — kg' : 'Pieza';
                                   var customs = _getConceptos('presentacionCompra').filter(function(c){ return base.indexOf(c) === -1; });
                                   var all = base.concat(customs);
                                   var cur = p.presentacionCompra || def;
                                   if (cur && all.indexOf(cur) === -1) all.push(cur);
                                   return all.map(function(t){
                                       return '<option value="' + String(t).replace(/"/g,'&quot;') + '" ' + (cur === t ? 'selected' : '') + '>' + t + '</option>';
                                   }).join('') + '<option value="__nuevo__">＋ Agregar concepto…</option>';
                               })()}
                           </select>
                       </div>
                       <div class="meta-item"><label>${esBarril ? 'Litros del barril' : esCarne ? 'Cantidad / Piezas' : esFruta ? 'Cantidad / Kilos o Piezas' : esAbarrote ? 'Piezas / Cantidad' : 'Cantidad'}</label>
                           <input type="number" value="${p.cantPresCompra||''}" placeholder="${esBarril?'20':esCarneOFruta?'10':'1'}"
                               oninput="updPres(${i},'cantPresCompra',this.value)">
                       </div>
                       <div class="meta-item"><label>Unidad</label>
                           ${esBarril
                               ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:9px 12px;font-size:14px;color:var(--text-dim)">LT</div>`
                               : `<select onchange="updPres(${i},'umPresCompra',this.value);renderPresentaciones()">
                                   ${(esFruta ? ['KG','G','PZA','CARGA','PORCION'] : ['PZA','G','KG','ML','LT','PORCION']).map(u =>
                                       `<option value="${u}" ${(p.umPresCompra||(esFruta?'KG':'PZA'))===u?'selected':''}>${u}</option>`
                                   ).join('')}
                                  </select>`
                           }
                       </div>
                   </div>
                   ${esBarril ? '' : `
                   <!-- Tercer nivel: lo que trae CADA pieza (caja → bolsa → tostada) -->
                   <div class="mg-2" style="margin-top:2px">
                       <div class="meta-item">
                           <label>Cada pieza trae (opcional)</label>
                           <input type="number" value="${p.unidadesPorPieza||''}" placeholder="Ej. 40" min="0" step="1"
                               oninput="updPres(${i},'unidadesPorPieza',this.value)">
                       </div>
                       <div class="meta-item">
                           <label>¿De qué? </label>
                           <input type="text" value="${(p.nombreSubUnidad||'').replace(/"/g,'&quot;')}" placeholder="Ej. tostadas, rebanadas, bolsitas"
                               oninput="updPres(${i},'nombreSubUnidad',this.value)">
                       </div>
                   </div>
                   <div style="font-size:10.5px;color:var(--text-dim);margin:-4px 0 4px;line-height:1.5">
                       Para empaques de tres niveles: una caja de 16 bolsas y cada bolsa con 40 tostadas
                       → te da el costo de la bolsa <b>y</b> el de cada tostada.
                   </div>`}` : ''}

                   <!-- Proveedor/Zona (todos los tipos) -->
                   <div class="mg-2">
                       <div class="meta-item">
                           <label>Proveedor</label>
                           <div style="display:flex;gap:6px;align-items:center">
                               <input type="text" list="etaax-provs-list" value="${p.proveedor||''}" placeholder="${esCarne ? 'Ej. Carnes Selectas' : esFruta ? 'Ej. Central de Abasto' : esRefrescoCerv ? 'Ej. Grupo Modelo' : 'Ej. Viños América'}"
                                   oninput="updPres(${i},'proveedor',this.value)" style="flex:1;min-width:0">
                               <button type="button" onclick="abrirPanelProvIns(${i})" title="Catálogo de proveedores"
                                   style="flex-shrink:0;background:var(--surface);border:1px solid var(--border);color:var(--text-muted);border-radius:6px;padding:9px 11px;cursor:pointer;font-size:14px;line-height:1">📋</button>
                           </div>
                       </div>
                       <div class="meta-item">
                           <label>Zona / Ciudad</label>
                           <div style="display:flex;gap:6px;align-items:center">
                               <input type="text" list="dl-zona" value="${p.zona||''}" placeholder="${esRefrescoCerv ? 'Ej. CDMX' : 'Ej. Morelia'}"
                                   oninput="updPres(${i},'zona',this.value)" style="flex:1;min-width:0">
                               <button type="button" onclick="agregarConceptoPres('zona',${i},'dl-zona',this)" title="Guardar como concepto reutilizable"
                                   style="flex-shrink:0;background:var(--surface);border:1px solid var(--border);color:var(--green);border-radius:6px;padding:9px 12px;cursor:pointer;font-size:15px;line-height:1;font-weight:700">＋</button>
                           </div>
                       </div>
                   </div>

                   <!-- FILA 1: Contenido / Peso compra · Unidad -->
                   <div class="mg-2">
                       <div class="meta-item">
                           <label>${esBarril ? 'Contenido por vaso/jarra'
                               : (parseFloat(p.unidadesPorPieza) > 1
                                   ? 'Contenido de cada <span style="text-transform:none;letter-spacing:0;color:var(--blue)">'+etx(_subUnidadNombre(p).replace(/s$/,''))+'</span>'
                                   : 'Contenido por pieza')}</label>
                           <input type="number" value="${_contSubDe(p)}" placeholder="${esCarne?'1000':esAbarrote?'500':'700'}"
                               oninput="updPres(${i},'contSub',this.value)">
                       </div>
                       <div class="meta-item">
                           <label>Unidad</label>
                           <select onchange="updPres(${i},'umContenido',this.value);renderPresentaciones()">
                               ${UNIDADES.map(u =>
                                   `<option value="${u}" ${p.umContenido===u?'selected':''}>${u}</option>`
                               ).join('')}
                           </select>
                       </div>
                   </div>
                   ${_hintSubUnidadHTML(p, i)}

                   <!-- Masa drenada (solo abarrotes) -->
                   ${esAbarrote ? `<div class="mg-2">
                       <div class="meta-item">
                           <label>Masa drenada</label>
                           <input type="number" value="${p.masaDrenada||''}" placeholder="0"
                               oninput="updPres(${i},'masaDrenada',this.value)">
                       </div>
                       <div class="meta-item">
                           <label>Unidad</label>
                           <select onchange="updPres(${i},'umMasaDrenada',this.value);renderPresentaciones()">
                               ${['G','KG','ML','LT'].map(u =>
                                   `<option value="${u}" ${(p.umMasaDrenada||'G')===u?'selected':''}>${u}</option>`
                               ).join('')}
                           </select>
                       </div>
                   </div>` : ''}


                   <!-- Precio de compra -->
                   <div class="mg-1">
                       <div class="meta-item">
                           <label>Precio de compra <span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span></label>
                           <div style="display:flex;align-items:center;gap:4px">
                               <span style="color:var(--accent);font-weight:600;font-size:14px">$</span>
                               <input type="text" inputmode="decimal" value="${fmtPrecio(p.precio)}" placeholder="0.00"
                                   style="color:var(--accent);border-color:var(--accent-dim)"
                                   oninput="inputPrecioRaw(this,${i})"
                                   onfocus="focusPrecioInput(this)"
                                   onblur="blurPrecioInput(this,${i})">
                           </div>
                       </div>
                   </div>

                   <!-- Incluye impuesto -->
                   <div class="mg-1">
                       <div class="meta-item">
                           <label>Incluye impuesto</label>
                           <select onchange="updPres(${i},'incluyeImpuesto',this.value);renderPresentaciones()">
                               <option value="0" ${p.incluyeImpuesto==='0'?'selected':''}>No</option>
                               <option value="1" ${p.incluyeImpuesto==='1'?'selected':''}>Sí (IVA)</option>
                               <option value="2" ${p.incluyeImpuesto==='2'?'selected':''}>Sí (IVA + IEPS)</option>
                           </select>
                       </div>
                   </div>

                   <!-- IMPUESTOS -->
                   ${_renderImpuestosBlock(p, i, esAbarrote)}
   
                   <!-- FILA 2: Costos calculados -->
                   ${_renderFilaCostosBlock(p, i, {esBarril, esRefrescoCerv, esBebidaCompleta, esAbarrote, esCarne: esCarneOFruta})}
   
   


                   <!-- FILA 4: Precio sugerido (bebidas, no abarrotes ni proteínas ni fruta) -->
                   ${!esAbarrote && !esCarneOFruta ? `<div class="mg-3">
                       ${esBarril ? `
                       <div class="meta-item">
                           <label>Precio sugerido por vaso/jarra ${_MXN}</label>
                           <div id="ref-precio-vaso-${i}" style="background:var(--surface);
                               border:1px solid var(--accent);border-radius:6px;
                               padding:8px 12px;font-size:15px;color:var(--accent);font-weight:700">
                               ${(()=>{
                                   const cp = parseFloat(p.costoPieza)||0;
                                   const fp = parseFloat(p.factorPieza)||2.0;
                                   return fmtMXN(cp * fp);
                               })()}
                           </div>
                       </div>` : esRefrescoCerv ? `
                       <div class="meta-item">
                           <label>Precio sugerido / carta ${_MXN}</label>
                           <div id="ref-precio-carta-${i}" style="background:var(--surface);
                               border:1px solid var(--accent);border-radius:6px;
                               padding:8px 12px;font-size:15px;color:var(--accent);font-weight:700">
                               ${(()=>{
                                   const cp = parseFloat(p.costoPieza)||0;
                                   const fp = parseFloat(p.factorPieza)||2.0;
                                   return fmtMXN(cp * fp);
                               })()}
                           </div>
                       </div>` : `
                       <div class="meta-item">
                           ${(()=>{
                               const _autoCalc = parseFloat(p.precio) > 0 && parseFloat(p.contNeto) > 0;
                               const _umLbl = (p.umCosto || 'LT').toUpperCase();
                               if (_autoCalc) {
                                   return `<label>Costo / ${_umLbl} <span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN · auto</span></label>
                                   <div style="display:flex;align-items:center;gap:4px;background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.2);border-radius:6px;padding:8px 12px;cursor:default">
                                       <span style="color:var(--accent);font-weight:600;font-size:14px">$</span>
                                       <span id="cu-auto-val-${i}" style="color:var(--accent);font-weight:700;font-size:14px">${fmtPrecio(p.costoUnitario)}</span>
                                       <span style="font-size:9px;color:var(--text-dim);margin-left:4px">/ ${_umLbl}</span>
                                   </div>`;
                               }
                               return `<label>Costo unitario <span style="font-size:9px;letter-spacing:1px;color:var(--text-muted);font-weight:400;margin-left:4px">MXN</span></label>
                               <div style="display:flex;align-items:center;gap:4px">
                                   <span style="color:var(--accent);font-weight:600;font-size:14px">$</span>
                                   <input type="text" inputmode="decimal" value="${fmtPrecio(p.costoUnitario)}" placeholder="0.00"
                                       style="color:var(--accent)"
                                       oninput="inputCurrency(this,${i},'costoUnitario')"
                                       onfocus="focusCurrency(this)"
                                       onblur="blurCurrency(this,${i},'costoUnitario')">
                               </div>`;
                           })()}
                       </div>`}
                       ${esRefrescoCerv ? `
                       <div class="meta-item">
                           <label>Factor × pieza</label>
                           <div style="display:flex;align-items:center;gap:6px">
                               <span style="color:var(--text-dim);font-size:11px;opacity:.5">×</span>
                               <input type="number" value="${p.factorPieza||'2.0'}"
                                   placeholder="2.0" min="0.1" step="0.1"
                                   style="color:var(--accent);font-size:13px;padding:4px 8px;
                                       background:rgba(245,200,66,.06);border-color:rgba(245,200,66,.2)"
                                   oninput="updPres(${i},'factorPieza',this.value)">
                           </div>
                       </div>` : `
                       <div class="meta-item">
                           <label>UM costo</label>
                           <select onchange="updPres(${i},'umCosto',this.value)">
                               ${['LT','ML','KG','G','PZA','OZ','PORCION'].map(u =>
                                   '<option value="'+u+'"'+((p.umCosto||'LT')===u?' selected':'')+'>'+u+'</option>'
                               ).join('')}
                           </select>
                       </div>`}
                   </div>` : ''}
   

                   <!-- FILA 5: Peso botella (solo destilados/vinos) -->
                   ${tienePeso ? `
                   <div class="mg-3">` : '<div style="display:none">'}
                       <div class="meta-item">
                           <label>Peso botella llena</label>
                           <input type="number" value="${p.pesoUnidad||''}" placeholder="1310"
                               oninput="updPres(${i},'pesoUnidad',this.value)">
                       </div>
                       <div class="meta-item">
                           <label>Unidad peso</label>
                           <select onchange="updPres(${i},'umPeso',this.value);renderPresentaciones()">
                               ${['G','KG','ML','LT'].map(u =>
                                   `<option value="${u}" ${(p.umPeso||'G')===u?'selected':''}>${u}</option>`
                               ).join('')}
                           </select>
                       </div>
                       <div class="meta-item">
                           <label>Peso cristal (auto)</label>
                           <div id="cristal-${i}" style="background:var(--surface);border:1px solid var(--border);
                               border-radius:6px;padding:8px 12px;font-size:13px;
                               color:var(--green);font-weight:500">
                               ${pesoCristal} g
                           </div>
                       </div>
                   </div>
                   ${tienePeso ? '' : '</div>'}
   


                   <!-- NOTAS -->
                   <div class="mg-1">
                       <div class="meta-item">
                           <label>Notas de presentación y compra</label>
                           <input type="text" value="${p.notas||''}" placeholder="Opcional"
                               oninput="updPres(${i},'notas',this.value)">
                       </div>
                   </div>
   
                   <!-- ── COSTEO AUTOMÁTICO (solo bebidas) ──── -->
                   ${_renderCosteoAutoBlock(p, i, tieneCopa, esVino)}
   
                   <!-- ── PRECIO CARTA (dato manual) ──────────── -->
                   ${_renderPrecioManualBlock(p, i, campos, tieneCopa)}
                   ${_renderStockBlock(p, i, tieneCopa)}
   
               </div>`;
           }).join('');
   }
   
   // ── Guardar insumo ────────────────────────────────────────────
   /* ════════════════════════════════════════════════════════════
      MEZCLADORES (refrescos / sodas del catálogo) para destilados
      El mezclador de cada presentación referencia un refresco del
      catálogo; su costo POR PIEZA se jala en vivo y, × las piezas, se
      suma al costo de la copa → costo del trago.
      ════════════════════════════════════════════════════════════ */
   function _esRefresco(x) {
       if (!x) return false;
       if (x.tipoInsumo === 'refresco') return true;
       var s = ((x.categoria||'') + ' ' + (x.subcategoria||'') + ' ' + (x.familia||'')).toLowerCase();
       return /refresc|soda|t[oó]nica|jugo|mezclador|agua/.test(s);
   }

   // Costo de UNA pieza del refresco según su primera presentación (en vivo)
   function _refrescoCostoPorPieza(ins) {
       var p = ((ins && ins.presentaciones) || [])[0];
       if (!p) return 0;
       var cp = parseFloat(p.costoPieza) || 0;
       if (cp > 0) return cp;
       var precio = parseFloat(p.precio) || 0;   // fallback
       return precio * (typeof calcImpFactor === 'function' ? calcImpFactor(p) : 1);
   }

   function _refrescosDelCatalogo() {
       return getInsumos().filter(_esRefresco).map(function(x) {
           return { id: x.id, nombre: insumoEtiqueta(x), pza: _refrescoCostoPorPieza(x) };
       }).sort(function(a, b){ return a.nombre.localeCompare(b.nombre); });
   }

   // <select> de mezclador (refresco del catálogo) para la presentación i
   function _mezcladorSelectHTML(p, i) {
       var refrescos = _refrescosDelCatalogo();
       var opts = '<option value="">— Ninguno —</option>' + refrescos.map(function(r) {
           return '<option value="' + etx(r.id) + '"' + (((p.mezcladorId||'') === r.id) ? ' selected' : '') + '>' +
               etx(r.nombre) + ' (' + fmtMXN(r.pza) + '/pza)</option>';
       }).join('');
       return '<select onchange="updPres(' + i + ',\'mezcladorId\',this.value);actualizarCopaCosto(' + i + ')">' + opts + '</select>';
   }

   function _cardCosteo(border, labelCol, valCol, label, value, sub) {
       return '<div style="background:var(--surface);border:1px solid ' + border + ';border-radius:8px;padding:10px;text-align:center">' +
           '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:' + labelCol + ';margin-bottom:4px">' + label + '</div>' +
           '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;color:' + valCol + ';letter-spacing:1px">' + value + '</div>' +
           '<div style="font-size:9px;color:var(--text-dim)">' + sub + '</div></div>';
   }

   // Tarjetas de costeo automático (compartidas por el render inicial y el live)
   /* ── COSTEOS EXTRA (copa sencilla / copa doble / caballito…) ───────────────
      El costeo base de la presentación (tamanoCopa + factorCopa) es el que lee el
      INVENTARIO y el que usan las recetas. Estos costeos adicionales son dato de
      CARTA: sirven para saber qué cobrar por una copa doble sin inventar otro
      insumo. Viven en p.costeos[] y no tocan el conteo. */
   function _costeosExtraHTML(p, i) {
       var lista = p.costeos || [];
       var filas = lista.map(function (c, j) {
           var calc = calcCostoCopa(p.costoUnitario, p.umCosto || 'LT', c.tamano, c.um || 'ML');
           var costo = calc ? (parseFloat(calc.costoCopa) || 0) : 0;
           var f     = parseFloat(c.factor) || parseFloat(p.factorCopa) || 3.3;
           var sug   = costo * f;
           var pc    = parseFloat(c.precioCarta) || 0;
           var util  = (pc > 0 && costo > 0) ? ((pc - costo) / costo) * 100 : null;
           return '<div style="display:grid;grid-template-columns:1.3fr .8fr .7fr .8fr .9fr .9fr 28px;gap:7px;align-items:end;' +
               'padding:8px;margin-bottom:6px;background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:7px">' +
               '<div class="meta-item"><label>Nombre</label><input type="text" value="' + etx(c.nombre || '') + '" placeholder="Copa doble" ' +
                   'oninput="updCosteo(' + i + ',' + j + ',\'nombre\',this.value)"></div>' +
               '<div class="meta-item"><label>Tamaño</label><input type="number" value="' + etx(c.tamano || '') + '" placeholder="90" min="0" step="0.5" ' +
                   'oninput="updCosteo(' + i + ',' + j + ',\'tamano\',this.value)"></div>' +
               '<div class="meta-item"><label>Unidad</label><select onchange="updCosteo(' + i + ',' + j + ',\'um\',this.value)">' +
                   '<option value="ML"' + ((c.um || 'ML') === 'ML' ? ' selected' : '') + '>ML</option>' +
                   '<option value="OZ"' + ((c.um || 'ML') === 'OZ' ? ' selected' : '') + '>OZ</option></select></div>' +
               '<div class="meta-item"><label>Factor \xd7</label><input type="number" value="' + etx(c.factor || '') + '" placeholder="' + (p.factorCopa || '3.3') + '" min="0.1" step="0.1" ' +
                   'style="color:var(--accent)" oninput="updCosteo(' + i + ',' + j + ',\'factor\',this.value)"></div>' +
               '<div class="meta-item"><label>Precio carta</label><input type="number" value="' + etx(c.precioCarta || '') + '" placeholder="0.00" min="0" step="0.5" ' +
                   'style="color:var(--green)" oninput="updCosteo(' + i + ',' + j + ',\'precioCarta\',this.value)"></div>' +
               '<div style="font-size:11px;line-height:1.5;padding-bottom:4px">' +
                   '<div style="color:var(--text-dim)">costo <b style="color:var(--text)">' + (costo > 0 ? fmtMXN(costo) : '—') + '</b></div>' +
                   '<div style="color:var(--text-dim)">sug. <b style="color:var(--accent)">' + (sug > 0 ? fmtMXN(sug) : '—') + '</b>' +
                   (util !== null ? ' <span style="color:' + (util >= 200 ? 'var(--green)' : 'var(--accent)') + '">+' + util.toFixed(0) + '%</span>' : '') + '</div>' +
               '</div>' +
               '<button onclick="eliminarCosteo(' + i + ',' + j + ')" title="Quitar costeo" ' +
                   'style="background:transparent;border:1px solid var(--border);color:var(--red);border-radius:6px;padding:5px 0;cursor:pointer;font-family:inherit">\u2715</button>' +
           '</div>';
       }).join('');
       if (!filas) return '';
       return '<div style="margin-top:10px">' + filas +
           '<div style="font-size:10px;color:var(--text-dim);margin-top:2px">Dato de carta (copa doble, caballito\u2026). El inventario sigue contando con la copa de arriba.</div>' +
       '</div>';
   }
   function agregarCosteo(i) {
       var idx = (i == null) ? _presConCopa() : i;
       if (idx < 0) return;
       var p = presentacionesTemp[idx]; if (!p) return;
       if (!p.costeos) p.costeos = [];
       p.costeos.push({ id: genId(), nombre: p.costeos.length ? '' : 'Copa doble', tamano: '', um: p.umTamanoCopa || 'ML', factor: '', precioCarta: '' });
       renderPresentaciones();
   }
   function updCosteo(i, j, campo, valor) {
       var p = presentacionesTemp[i]; if (!p || !p.costeos || !p.costeos[j]) return;
       p.costeos[j][campo] = valor;
       modalDirty = true;
       if (campo === 'nombre' || campo === 'precioCarta') return;   // no re-render: no perder el foco al teclear
       renderPresentaciones();
   }
   function eliminarCosteo(i, j) {
       var p = presentacionesTemp[i]; if (!p || !p.costeos) return;
       p.costeos.splice(j, 1);
       modalDirty = true;
       renderPresentaciones();
   }
   // Primera presentación que dibuja bloque de copa (destilados, licores, vinos).
   function _presConCopa() {
       var cfg = TIPO_CONFIG[tipoInsumoActual] || TIPO_CONFIG['destilado'];
       if (!(cfg.campos || []).includes('copa')) return -1;
       return presentacionesTemp.length ? 0 : -1;
   }
   window.agregarCosteo = agregarCosteo;
   window.updCosteo = updCosteo;
   window.eliminarCosteo = eliminarCosteo;

   function _costeoCardsHTML(p) {
       var copa = calcCostoCopa(p.costoUnitario, p.umCosto||'LT', p.tamanoCopa, p.umTamanoCopa||'ML');
       if (!copa) return '<div style="font-size:11px;color:var(--text-dim);margin-bottom:10px">Ingresa costo unitario y tamaño de copa para ver el costeo automático</div>';
       var costoCopaNum = parseFloat(copa.costoCopa) || 0;
       var cu       = parseFloat(p.costoUnitario) || 0;
       var contML   = toML(p.contNeto, p.umContenido||'ML');
       var costoBot = cu > 0 && contML > 0 ? cu*(contML/1000) : 0;
       var fCopa    = parseFloat(p.factorCopa)    || 3.3;
       var fBot     = parseFloat(p.factorBotella) || 2.5;
       // Mezclador (refresco del catálogo, por pieza)
       var refIns    = p.mezcladorId ? getInsumos().find(function(x){ return x.id === p.mezcladorId; }) : null;
       var mezPiezas = parseFloat(p.mezcladores) || 0;
       var mezCost   = (refIns && mezPiezas > 0) ? mezPiezas * _refrescoCostoPorPieza(refIns) : 0;
       var precioCopaAuto = costoCopaNum * fCopa;          // markup SOLO sobre la copa
       var precioTrago    = precioCopaAuto + mezCost;      // + mezclador a costo (sin multiplicar)
       var precioBotAuto  = costoBot > 0 ? (costoBot * fBot).toFixed(2) : null;

       var cards = [];
       cards.push(_cardCosteo('var(--border)','var(--text-dim)','var(--text)','Costo copa', fmtMXN(copa.costoCopa), (p.tamanoCopa||0)+' '+(p.umTamanoCopa||'ML')));
       cards.push(_cardCosteo('var(--accent)','var(--accent)','var(--accent)','Precio copa ×'+fCopa, fmtMXN(precioCopaAuto), mezCost>0?'solo copa':'sugerido carta'));
       if (mezCost > 0)
           cards.push(_cardCosteo('var(--green)','var(--green)','var(--green)','Precio trago', fmtMXN(precioTrago), 'copa ×'+fCopa+' + '+fmtMXN(mezCost)+' mezcl.'));
       cards.push(_cardCosteo('var(--border)','var(--text-dim)','var(--text)','Costo botella', costoBot>0?fmtMXN(costoBot):'—', contML>0?contML+' ML':'sin contenido'));
       cards.push(_cardCosteo('var(--green)','var(--green)','var(--green)','Precio bot. ×'+fBot, precioBotAuto?fmtMXN(precioBotAuto):'—', 'sugerido carta'));
       return '<div style="display:grid;grid-template-columns:repeat('+cards.length+',1fr);gap:8px;margin-bottom:10px">' + cards.join('') + '</div>';
   }

   async function guardarInsumo() {
       const nombre = document.getElementById('ins-nombre').value.trim();
       if (!nombre) { alert('El nombre es obligatorio'); return; }
   
       const fotoAnterior = editandoId
           ? getInsumos().find(x => x.id === editandoId)?.foto || ''
           : '';
       // Identidad ORIGINAL (nombre+marca antes de editar) para encontrar los
       // "hermanos" en otras sucursales aunque el nombre cambie en esta edición.
       var _origKeyProp = '';
       if (editandoId && typeof _keyIns === 'function') {
           var _prevIns = getInsumos().find(x => x.id === editandoId);
           if (_prevIns) _origKeyProp = _keyIns(_prevIns);
       }

       // Asegurar familia auto-rellenada antes de guardar
       var famEl = document.getElementById('ins-familia');
       if (famEl && !famEl.value) famEl.value = FAMILIA_POR_TIPO[tipoInsumoActual] || '';

       const insumo = {
           id:           editandoId || genId(),
           tipoInsumo:   tipoInsumoActual,
           nombre,
           familia:      document.getElementById('ins-familia').value.trim(),
           categoria:    document.getElementById('ins-categoria').value.trim(),
           subcategoria: document.getElementById('ins-subcategoria').value.trim(),
           marca:        document.getElementById('ins-marca').value.trim(),
           variedad:     document.getElementById('ins-variedad').value.trim(),
           maduracion:        document.getElementById('ins-maduracion').value.trim(),
           tempConservacion:  document.getElementById('ins-tempConservacion').value.trim(),
           vidaUtilAbrir:     (function(){
               var n = document.getElementById('ins-vidaUtilAbrirNum');
               var u = document.getElementById('ins-vidaUtilAbrirUnidad');
               if (n && u) return (n.value + ' ' + u.value).trim();
               var el = document.getElementById('ins-vidaUtilAbrir');
               return el ? el.value.trim() : '';
           })(),
           empaque:           document.getElementById('ins-empaque').value.trim(),
           comoCongelar:      (function(){ var el = document.getElementById('ins-comoCongelar'); return el ? el.value.trim() : ''; })(),
           vidaUtilCongelado: (function(){
               var n = document.getElementById('ins-vidaUtilCongeladoNum');
               var u = document.getElementById('ins-vidaUtilCongeladoUnidad');
               if (n && u) return (n.value + ' ' + u.value).trim();
               var el = document.getElementById('ins-vidaUtilCongelado');
               return el ? el.value.trim() : '';
           })(),
           notas:        document.getElementById('ins-notas').value.trim(),
           activo:       document.getElementById('ins-activo').value || '1',
           foto:         fotoInsumoBase64 || fotoAnterior,
           presentaciones: presentacionesTemp,
           area:         (function(){ var el = document.getElementById('ins-area'); return el ? el.value : ''; })(),
           sucursalId:   '' // ya no se elige aquí; se define por membresía abajo
       };

       // Membresía por sucursal. NUEVO → nace como MAESTRO global (sin sucursal) y, si se
       // crea DENTRO de una sucursal, se genera además su COPIA vinculada ahí (abajo, en
       // la persistencia). EDICIÓN → conserva la membresía y el sucursalId que ya tenía.
       var _sucCopiaNueva = ''; // sucursal donde nace la copia vinculada del insumo nuevo ('' = ninguna)
       if (editandoId) {
           var _orig = getInsumos().find(function(x){ return x.id === editandoId; });
           // El select de Área ya vive en el editor y se pobla al abrir → su valor
           // manda (incluido vacío = "Sin área"). Solo se conserva el original si
           // la página no tiene el campo (ej. algún contexto sin ese <select>).
           if (_orig && _orig.area && !document.getElementById('ins-area')) insumo.area = _orig.area;
           // Identidad de PRODUCCIÓN PROPIA: nunca destruir la liga a la sub-receta
           // al guardar por el editor de insumo (si no, deja de abrir el escandallo).
           if (_orig && _orig.esSubReceta) {
               insumo.esSubReceta = true;
               insumo.recetaId    = _orig.recetaId || insumo.recetaId || null;
           }
           insumo.sucursalId = _orig ? (_orig.sucursalId || '') : '';
           insumo.sucursales = (_orig && _orig.sucursales && _orig.sucursales.length)
               ? _orig.sucursales.slice()
               : (_orig && _orig.sucursalId ? [_orig.sucursalId] : []);
       } else {
           // El registro que se edita/guarda ES el MAESTRO global (sin sucursal). La copia
           // vinculada de la sucursal activa se crea aparte en la persistencia. El admin del
           // catálogo ETAAX tiene _getSucActivaIns()='' → solo maestro (sin copia).
           insumo.sucursalId = '';
           insumo.sucursales = [];
           // En el Catálogo Global no hay sucursal de trabajo: nace SOLO el maestro.
           // (Sin esto heredaba `etaax_sucursal_activa` y nacían dos registros.)
           _sucCopiaNueva = _catGlobalIns() ? '' : _getSucActivaIns();
       }

       // #2 Storage: si la foto es base64, súbela a Storage y guarda solo la URL
       // (saca la imagen de adentro del dato → registros ligeros). Si falla, se
       // queda el base64 ya comprimido (#1) como respaldo.
       if (insumo.foto && insumo.foto.indexOf('data:') === 0 && window.sbSubirFotoBase64) {
           var _btnG = document.querySelector('[onclick="guardarInsumo()"]');
           var _btnTxt = _btnG ? _btnG.textContent : '';
           if (_btnG) { _btnG.textContent = 'Subiendo foto…'; _btnG.disabled = true; }
           try {
               var _url = await sbSubirFotoBase64('insumos', insumo.foto, getNegocioActivo() || 'catalogo');
               if (_url) insumo.foto = _url;
           } catch (e) { /* fallback: base64 comprimido */ }
           if (_btnG) { _btnG.textContent = _btnTxt; _btnG.disabled = false; }
       }

       // Sello de auditoría: cuándo y quién. Se pinta en la ficha y en el editor para
       // saber de un vistazo si el costo que estás leyendo es de ayer o de hace un año.
       insumo.updatedAt = new Date().toISOString();
       insumo.updatedBy = _usuarioActual();
       if (!insumo.createdAt) insumo.createdAt = insumo.updatedAt;
       // Histórico: qué cambió respecto de lo que había, quién y desde qué sucursal.
       // Se poda a 90 días para que el registro no engorde el JSON del insumo.
       _registrarCambios(insumo, editandoId ? getInsumos().find(function(x){ return x.id === editandoId; }) : null);

       const lista = getInsumos();
       var _copiaNueva = null;
       if (editandoId) {
           const i = lista.findIndex(x => x.id === editandoId);
           if (i >= 0) lista[i] = insumo; else lista.push(insumo);
       } else {
           lista.push(insumo);
           // Copia vinculada en la sucursal donde se creó (maestro global + copia ligada
           // por origenId). Se clona DESPUÉS de subir la foto → hereda la misma URL.
           if (_sucCopiaNueva) {
               _copiaNueva = JSON.parse(JSON.stringify(insumo));
               _copiaNueva.id = genId();
               _copiaNueva.origenId = insumo.id;
               _copiaNueva.sucursales = [_sucCopiaNueva];
               _copiaNueva.sucursalId = _sucCopiaNueva;
               lista.push(_copiaNueva);
           }
       }

       setInsumos(lista);
       modalDirty = false;
       // Forzar el upsert de ESTE insumo a Supabase AHORA (no esperar el debounce de
       // 1.2s). Si navegas enseguida a recetas/otra página, ésta relee el catálogo
       // desde Supabase; sin esto, a veces leía el dato viejo y parecía que "el
       // cambio no se guardó" hasta el segundo intento. (Antes solo se forzaba en
       // modo iframe; ahora también en el flujo normal.)
       clearTimeout(_insumosSyncTimer);
       _insumosSyncPend = null;
       try { await _sincronizarInsumosSupabase(getNegocioActivo(), _copiaNueva ? [insumo, _copiaNueva] : [insumo]); } catch(e) {}
       if (_soloMode) {
           window.parent.postMessage({ type: 'insumoGuardado', insumoId: insumo.id }, '*');
           return;
       }
       var _eraEdicion = !!editandoId;
       cerrarModalBtn();
       init();
       // En el Catálogo Global del negocio: si editaste un insumo que también
       // existe en otras sucursales, ofrecer propagar su ficha técnica.
       if (_eraEdicion && _catGlobalIns() && typeof _ofrecerPropagacion === 'function') {
           _ofrecerPropagacion(insumo, _origKeyProp);
       }
   }

   // ── Ficha técnica ─────────────────────────────────────────────
   // Copia superficial con todos los campos string escapados (XSS-safe
   // para templates que insertan con innerHTML)
   function _escCampos(o) {
       var c = {};
       for (var k in o) { c[k] = (typeof o[k] === 'string') ? etx(o[k]) : o[k]; }
       return c;
   }
   // Lightbox: amplía la foto a pantalla completa (clic para cerrar)
   function _ampliarFotoFicha(src) {
       if (!src) return;
       var ov = document.createElement('div');
       ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
       ov.onclick = function () { ov.remove(); };
       var img = document.createElement('img');
       img.src = src;
       img.style.cssText = 'max-width:92vw;max-height:92vh;object-fit:contain;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.6)';
       ov.appendChild(img);
       document.body.appendChild(ov);
   }

   function verFicha(id) {
       const insRaw = getInsumos().find(x => x.id === id);
       if (!insRaw) return;

       const ins  = _escCampos(insRaw);
       const pres = (insRaw.presentaciones || []).map(_escCampos);
   
       document.getElementById('fichaContenido').innerHTML = `
           <div style="display:flex;gap:16px;align-items:flex-start;
               padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:16px">
               ${ins.foto
                   ? `<div style="width:150px;height:150px;background:var(--surface2);border-radius:10px;
                       border:1px solid var(--border);overflow:hidden;flex-shrink:0;cursor:zoom-in;
                       transition:transform .2s ease,border-color .2s ease" title="Clic para ampliar"
                       onmouseover="this.style.transform='scale(1.25)';this.style.borderColor='var(--accent)';this.style.zIndex='5';this.style.position='relative'"
                       onmouseout="this.style.transform='scale(1)';this.style.borderColor='var(--border)';this.style.zIndex=''"
                       onclick="var im=this.querySelector('img'); if(im) _ampliarFotoFicha(im.src);">
                       <img src="${ins.foto}" style="width:100%;height:100%;object-fit:cover;display:block">
                     </div>`
                   : `<div style="width:150px;height:150px;background:var(--surface2);border-radius:10px;
                       border:1px solid var(--border);flex-shrink:0;display:flex;align-items:center;
                       justify-content:center;font-size:40px;color:var(--text-dim)">📦</div>`}
               <div style="flex:1">
                   <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;
                       color:var(--accent);margin-bottom:4px">
                       ${[ins.familia, ins.categoria, ins.subcategoria].filter(Boolean).join(' · ')}
                   </div>
                   <div style="font-size:22px;font-weight:600;color:var(--text);margin-bottom:2px">${etx(insumoTitulo(ins))}</div>
                   <div style="font-size:12px;color:var(--text-muted)">${insumoMetaHTML(ins)}</div>
               </div>
               <span class="pill ${ins.activo==='1'?'pill-amber':'pill-red'}" style="flex-shrink:0">
                   ${ins.activo==='1'?'Activo':'Inactivo'}
               </span>
           </div>
   
           <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;
               color:var(--text-dim);margin-bottom:10px">Presentaciones</div>
   
           ${pres.length ? pres.map(p => `
               <div style="background:var(--surface2);border:1px solid var(--border);
                   border-radius:8px;padding:12px;margin-bottom:8px">
                   <div style="display:flex;justify-content:space-between;
                       align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
                       <div>
                           <span style="font-size:15px;font-weight:500;color:var(--text)">
                               ${p.contNeto} ${p.umContenido}
                           </span>
                           ${p.pesoUnidad ? `<span style="font-size:11px;color:var(--text-dim);margin-left:8px">· ${p.pesoUnidad} ${p.umPeso||'G'} llena</span>` : ''}
                           ${p.pesoCristal ? `<span style="font-size:11px;color:var(--text-dim);margin-left:4px">· cristal ${p.pesoCristal}g</span>` : ''}
                       </div>
                       <div style="text-align:right">
                           ${p.precio ? `
                           <div style="font-size:16px;font-weight:600;color:var(--text)">
                               $${(+p.precio).toFixed(2)}
                           </div>
                           <div style="font-size:10px;color:var(--text-dim);margin-top:1px">precio de compra</div>` : ''}
                           ${p.costoUnitario ? `
                           <div style="font-size:12px;font-weight:500;color:var(--green);margin-top:4px">
                               $${(+p.costoUnitario).toFixed(2)} / ${p.umCosto||'LT'}
                           </div>` : ''}
                       </div>
                   </div>
                   <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:6px">
                       ${p.rendimiento ? `<span style="font-size:12px;font-weight:500;color:var(--accent)">🥃 ${p.rendimiento} ${p.umRendimiento||'OZ'} por botella</span>` : ''}
                       ${p.proveedor   ? `<span style="font-size:11px;color:var(--text-muted)">🏪 ${p.proveedor}</span>` : ''}
                       ${p.zona        ? `<span style="font-size:11px;color:var(--text-muted)">📍 ${p.zona}</span>` : ''}
                       ${p.marcaComercial ? `<span style="font-size:11px;color:var(--text-muted)">🏷️ ${p.marcaComercial}</span>` : ''}
                       ${p.incluyeImpuesto==='1' ? `<span style="font-size:11px;color:var(--accent)">IVA incluido</span>` : ''}
                   </div>
                   ${(p.precioCarta || p.precioCartaBot) ? `
                   <div style="background:var(--surface);border-radius:6px;padding:8px 10px;display:flex;gap:16px;flex-wrap:wrap">
                       ${p.precioCarta    ? `<span style="font-size:12px;color:var(--green)">Copa: $${(+p.precioCarta).toFixed(2)}</span>` : ''}
                       ${p.precioCartaBot ? `<span style="font-size:12px;color:var(--green)">Botella: $${(+p.precioCartaBot).toFixed(2)}</span>` : ''}
                       ${p.stockMin ? `<span style="font-size:11px;color:var(--text-dim)">Stock min: ${p.stockMin}</span>` : ''}
                       ${p.stockMax ? `<span style="font-size:11px;color:var(--text-dim)">Stock max: ${p.stockMax}</span>` : ''}
                   </div>` : ''}
                   ${p.notas ? `<div style="font-size:11px;color:var(--text-dim);margin-top:6px">${p.notas}</div>` : ''}
               </div>`).join('')
           : '<div style="color:var(--text-dim);font-size:13px">Sin presentaciones registradas</div>'}
   
           ${(ins.tipoInsumo === 'fruta' && (ins.maduracion || ins.tempConservacion || ins.vidaUtilAbrir || ins.vidaUtilCongelado || ins.comoCongelar || ins.subcategoria)) ? `
               <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
                   <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px">🥬 Almacenaje y vida útil</div>
                   <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--text-muted)">
                       ${ins.maduracion       ? `<div><span style="color:var(--text-dim)">Tipo de compra: </span>${ins.maduracion}</div>` : ''}
                       ${ins.tempConservacion ? `<div><span style="color:var(--text-dim)">Almacenaje: </span>${ins.tempConservacion}</div>` : ''}
                       ${ins.vidaUtilAbrir    ? `<div><span style="color:var(--text-dim)">Vida útil fresca: </span>${ins.vidaUtilAbrir}</div>` : ''}
                       ${ins.vidaUtilCongelado? `<div><span style="color:var(--text-dim)">V. útil congelado: </span>${ins.vidaUtilCongelado}</div>` : ''}
                       ${ins.comoCongelar     ? `<div style="grid-column:span 2"><span style="color:var(--text-dim)">Cómo congelar: </span>${ins.comoCongelar}</div>` : ''}
                       ${ins.subcategoria     ? `<div style="grid-column:span 2"><span style="color:var(--text-dim)">Descongelación: </span>${ins.subcategoria}</div>` : ''}
                   </div>
               </div>` : ''}

           ${ins.notas ? `
               <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
                   <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;
                       color:var(--text-dim);margin-bottom:6px">Notas</div>
                   <p style="font-size:13px;color:var(--text-muted);line-height:1.7">${ins.notas}</p>
               </div>` : ''}
           ${_historialHTML(insRaw)}
       `;
   
       document.getElementById('modalFicha').style.display = 'flex';
   }
   
   function cerrarFicha(e) {
       if (e.target === document.getElementById('modalFicha'))
           document.getElementById('modalFicha').style.display = 'none';
   }
   
   // ══════════════════════════════════════════════════════════════
   // IMPORTADOR CSV — vinculación por POSICIÓN DE FILA
   // Las 3 hojas tienen 201 filas alineadas: fila N de productos
   // corresponde a fila N de presentaciones y costos.
   // ══════════════════════════════════════════════════════════════
   
   function abrirImportar() {
       document.getElementById('modalImportar').style.display = 'flex';
       ['status1','status2','status3'].forEach(id => {
           document.getElementById(id).textContent = '—';
           document.getElementById(id).style.color = 'var(--text-dim)';
       });
   }
   
   function cerrarImportar(e) {
       if (e.target === document.getElementById('modalImportar'))
           document.getElementById('modalImportar').style.display = 'none';
   }
   
   function onDropCSV(e, tipo) {
       e.preventDefault();
       const file = e.dataTransfer.files[0];
       if (file) importarArchivo(file, tipo);
   }
   
   function importarProductos(input)     { if (input.files[0]) importarArchivo(input.files[0], 'prod'); }
   function importarPresentaciones(input){ if (input.files[0]) importarArchivo(input.files[0], 'pres'); }
   function importarCostos(input)        { if (input.files[0]) importarArchivo(input.files[0], 'cost'); }
   
   // ── Parser CSV robusto ────────────────────────────────────────
   function parseCSV(texto) {
       // Divide respetando comillas
       function splitLine(line) {
           const result = [];
           let cur = '', inQ = false;
           for (let i = 0; i < line.length; i++) {
               const c = line[i];
               if (c === '"') { inQ = !inQ; continue; }
               if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; continue; }
               cur += c;
           }
           result.push(cur.trim());
           return result;
       }
   
       const lines = texto.split('\n').filter(l => l.trim());
       const header = splitLine(lines[0]).map(h =>
           h.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
            .replace(/\s+/g,'_')
       );
   
       return lines.slice(1).map((line, rowIndex) => {
           const cols = splitLine(line);
           const obj  = { _rowIndex: rowIndex };
           header.forEach((h, i) => obj[h] = (cols[i] || '').trim());
           return obj;
       }).filter(r => Object.values(r).some(v => v && v !== ''));
   }
   
   // ── Importar archivo ──────────────────────────────────────────
   function importarArchivo(file, tipo) {
       const reader = new FileReader();
       reader.onload = e => {
           const rows = parseCSV(e.target.result);
           if (!rows.length) { setStatus(tipo==='prod'?1:tipo==='pres'?2:3, '❌ Archivo vacío'); return; }
           if (tipo === 'prod') procesarProductos(rows);
           if (tipo === 'pres') procesarPresentaciones(rows);
           if (tipo === 'cost') procesarCostos(rows);
       };
       reader.readAsText(file, 'UTF-8');
   }
   
   // ── PASO 1: Productos ─────────────────────────────────────────
   function procesarProductos(rows) {
       // Limpiamos insumos importados anteriormente y reconstruimos
       const lista    = getInsumos().filter(x => !x._csvRow && x._csvRow !== 0);
       let nuevos = 0, actualizados = 0;
   
       rows.forEach((r, idx) => {
           const nombre = (r['nombre_base'] || r['nombre'] || '').trim();
           if (!nombre) return;
   
           const activo = (r['activo_inactivo']||'').toUpperCase();
   
           const datos = {
               _csvRow:      idx,                          // índice para vincular con las otras hojas
               nombre,
               familia:      r['familia']       || 'Bebidas',
               categoria:    r['categoria']     || r['categoría'] || '',
               subcategoria: r['sub__categoria']|| r['sub_categoria'] || '',
               variedad:     r['variedad_base'] || '',
               maduracion:   r['maduracion']    || r['maduración'] || '',
               marca:        r['marca_base']    || '',
               empaque:      r['tipo_de_empaque']|| '',
               notas:        r['notas_detalles'] || '',
               activo:       activo === 'FALSE' ? '0' : '1',
               foto:         '',
               presentaciones: []
           };
   
           // Si ya existe por nombre lo actualizamos
           const existe = lista.find(x =>
               x.nombre.toLowerCase() === nombre.toLowerCase() &&
               (x.variedad||'').toLowerCase() === (datos.variedad||'').toLowerCase()
           );
   
           if (existe) {
               Object.assign(existe, datos);
               actualizados++;
           } else {
               lista.push({ id: genId(), ...datos });
               nuevos++;
           }
       });
   
       setInsumos(lista);
       setStatus(1, `✅ ${nuevos} nuevos · ${actualizados} actualizados`);
       // No llamar init() aquí — se renderiza solo al finalizar el paso 3
   }
   
   // ── PASO 2: Presentaciones — vincula por posición de fila ─────
   function procesarPresentaciones(rows) {
       const lista = getInsumos();
       // Ordenar por _csvRow para asegurar el índice correcto
       const porFila = lista
           .filter(x => x._csvRow !== undefined)
           .sort((a,b) => a._csvRow - b._csvRow);
   
       let vinculados = 0, sinVincular = 0;
   
       rows.forEach((r, idx) => {
           // Buscar el insumo que corresponde a esta fila
           const insumo = porFila[idx] || lista.find(x => x._csvRow === idx);
   
           if (!insumo) { sinVincular++; return; }
   
           const contNeto   = parseFloat(r['cont_neto'])   || 0;
           const pesoUnidad = parseFloat(r['peso_unidad']) || 0;
           // Normalizar unidades: el CSV puede traer "ml" con valor 0.700 (que es LT)
           // o "gr"/"g" con valor 1.310 (que es KG). Detectamos por magnitud.
           let umCont = (r['um_cont_neto']   || 'ML').toUpperCase().replace('GR','G');
           let umPeso = (r['um_peso_unidad'] || 'G').toUpperCase().replace('GR','G');
           // Si contNeto < 5 con ML → casi seguro está en LT
           if (umCont === 'ML' && contNeto > 0 && contNeto < 5) umCont = 'LT';
           // Si pesoUnidad < 5 con G → casi seguro está en KG
           if (umPeso === 'G'  && pesoUnidad > 0 && pesoUnidad < 5) umPeso = 'KG';
           const contNetog  = umCont === 'LT' ? contNeto * 1000 : contNeto;
           const pesoUnidag = umPeso === 'KG' ? pesoUnidad * 1000 : pesoUnidad;
           const pesoCristal = contNetog > 0 && pesoUnidag > 0
               ? (pesoUnidag - contNetog).toFixed(0)
               : '';
   
           const pres = {
               id:            genId(),
               contNeto:      r['cont_neto']    || '',
               umContenido:   umCont,
               masaDrenada:   r['masa_drenada'] || '',
               rendimiento:   r['rendimiento']  || '',
               umRendimiento: (r['um_rendimiento'] || 'OZ').toUpperCase(),
               pesoUnidad:    r['peso_unidad']  || '',
               umPeso:        umPeso,
               pesoCristal,
               proveedor:     '',
               zona:          '',
               fecha:         '',
               precio:        '',
               costoUnitario: '',
               umCosto:       'LT',
               marcaComercial:'',
               incluyeImpuesto: '0',
               notas:         r['notas'] || '',
               precioCarta:   '',
               precioCartaBot:'',
               stockMin:      '',
               stockMax:      ''
           };
   
           // Reemplazar presentaciones existentes de esta importación
           insumo.presentaciones = [pres];
           vinculados++;
       });
   
       setInsumos(lista);
       setStatus(2, `✅ ${vinculados} vinculadas · ${sinVincular} sin vincular`);
       // No llamar init() aquí — se renderiza solo al finalizar el paso 3
   }
   
   // ── PASO 3: Costos — vincula por posición de fila ─────────────
   function procesarCostos(rows) {
       const lista = getInsumos();
       const porFila = lista
           .filter(x => x._csvRow !== undefined)
           .sort((a,b) => a._csvRow - b._csvRow);
   
       let vinculados = 0, sinVincular = 0;
   
       // Limpia $, comas y espacios — devuelve string numérico o vacío
       const limpiarNum = v => {
           const s = (v || '').toString().replace(/[$,\s]/g, '');
           const n = parseFloat(s);
           return isNaN(n) ? '' : String(n);
       };
   
       rows.forEach((r, idx) => {
           const insumo = porFila[idx] || lista.find(x => x._csvRow === idx);
           if (!insumo || !insumo.presentaciones?.length) { sinVincular++; return; }
   
           const pres = insumo.presentaciones[0];
   
           pres.proveedor       = (r['provedor']         || r['proveedor']        || '').trim();
           pres.zona            = (r['zona']              || '').trim();
           pres.fecha           = (r['fecha']             || '').trim();
           pres.precio          = limpiarNum(r['precio_compra']);
           pres.marcaComercial  = (r['marca_comercial']   || r['marca comercial'] || '').trim();
           pres.costoUnitario   = limpiarNum(r['costo_unitario']);
           pres.umCosto         = (r['um_costo_unitario'] || r['um_costo_unitarioi'] || 'LT').trim().toUpperCase();
           pres.incluyeImpuesto = (r['incluye_impuesto']  || '').toUpperCase().includes('IVA') ? '1' : '0';
           pres.observaciones   = (r['observaciones']     || '').trim();
   
           vinculados++;
       });
   
       setInsumos(lista);
       setStatus(3, `✅ ${vinculados} costos vinculados · ${sinVincular} sin vincular`);
       init();
   }
   
   // ── Status helper ─────────────────────────────────────────────
   function setStatus(paso, msg) {
       const el = document.getElementById(`status${paso}`);
       if (!el) return;
       el.textContent = msg;
       el.style.color = msg.includes('✅') ? 'var(--green)' : 'var(--red)';
   }
   
   // ── Navegación Enter / Tab en modal ──────────────────────────
   document.addEventListener('keydown', function(e) {
       // Solo actuar dentro del modal de insumo
       const modal = document.getElementById('modalOverlay');
       if (!modal || modal.style.display === 'none') return;
       if (e.key !== 'Enter' && e.key !== 'Tab') return;
       if (e.target.tagName === 'TEXTAREA') return;
       if (e.target.tagName === 'SELECT') return;
       // Si el foco está en un botón, Enter ejecuta su acción normal (click)
       if (e.key === 'Enter' && e.target.tagName === 'BUTTON') return;

       // En inputs de texto/número: Enter avanza al siguiente campo
       if (e.key === 'Enter') {
           e.preventDefault();
           const focusable = [...modal.querySelectorAll('input, select, button, textarea')]
               .filter(el => !el.disabled && el.offsetParent !== null);
           const idx = focusable.indexOf(e.target);
           if (idx >= 0 && focusable[idx + 1]) focusable[idx + 1].focus();
       }
   });
   
   // ── Catálogo de proveedores en el editor de insumo (panel estilo gastos) ──
   var _provsCacheIns = null;
   var _provPanelIdx  = -1;
   function _normProvIns(s){ return (s||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
   function _loadProvsIns() {
       if (_provsCacheIns) return _provsCacheIns;
       var negId = getNegocioActivo();
       try { _provsCacheIns = JSON.parse(localStorage.getItem('etaax_' + negId + '_proveedores') || '[]'); } catch(e) { _provsCacheIns = []; }
       return _provsCacheIns;
   }
   async function _cargarProveedoresIns() {
       var negId = getNegocioActivo();
       if (!negId || typeof _supabase === 'undefined') return;
       try {
           var r = await _supabase.from('proveedores').select('datos').eq('negocio_id', negId).order('datos->>nombre');
           if (!r.error) {
               _provsCacheIns = (r.data || []).map(function(x){ return x.datos; }).filter(Boolean);
               try { localStorage.setItem('etaax_' + negId + '_proveedores', JSON.stringify(_provsCacheIns)); } catch(e){}
           }
       } catch(e) {}
   }
   function abrirPanelProvIns(idx) {
       _provPanelIdx = idx;
       var ov = document.getElementById('panelProvInsOverlay');
       if (!ov) return;
       ov.style.display = 'flex';
       var f = document.getElementById('nuevoProvInsForm'); if (f) f.style.display = 'none';
       var s = document.getElementById('panelProvInsSearch'); if (s) { s.value = ''; setTimeout(function(){ s.focus(); }, 50); }
       renderPanelProvIns();
       // Refrescar desde la nube en background y re-pintar si sigue abierto.
       _cargarProveedoresIns().then(function(){
           if (document.getElementById('panelProvInsOverlay').style.display === 'flex') renderPanelProvIns();
       });
   }
   function cerrarPanelProvIns() {
       var ov = document.getElementById('panelProvInsOverlay'); if (ov) ov.style.display = 'none';
   }
   function renderPanelProvIns() {
       var q = _normProvIns(document.getElementById('panelProvInsSearch').value);
       var actual = (_provPanelIdx >= 0 && presentacionesTemp[_provPanelIdx]) ? presentacionesTemp[_provPanelIdx].proveedor : '';
       var typed = _normProvIns(actual);
       var provs = _loadProvsIns();
       var lista = q ? provs.filter(function(p){ return _normProvIns(p.nombre).includes(q); }) : provs;
       var body = document.getElementById('panelProvInsBody');
       if (!lista.length) {
           body.innerHTML = '<div style="text-align:center;padding:26px 8px;color:var(--text-dim);font-size:13px">' +
               (provs.length ? 'Sin resultados para "' + etx(document.getElementById('panelProvInsSearch').value) + '"' : 'Sin proveedores en catálogo. Agrega el primero.') + '</div>';
           return;
       }
       body.innerHTML = lista.map(function(p){
           var sub = [p.tel, p.contacto, p.correo].filter(Boolean).map(etx).join(' · ').slice(0,70);
           var esActual = typed && _normProvIns(p.nombre) === typed;
           return '<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border)">' +
               '<div style="flex:1;min-width:0">' +
                   '<div style="font-size:13px;color:var(--text);font-weight:500">' + etx(p.nombre) + '</div>' +
                   (sub ? '<div style="font-size:11px;color:var(--text-muted)">' + sub + '</div>' : '') +
               '</div>' +
               '<button onclick="selProvIns(\'' + etx(p.nombre).replace(/'/g,'&#39;') + '\')" ' +
                   'style="flex-shrink:0;background:' + (esActual?'var(--green)':'transparent') + ';border:1px solid ' + (esActual?'var(--green)':'var(--border)') + ';color:' + (esActual?'#0f0e0c':'var(--text-muted)') + ';border-radius:6px;padding:5px 12px;font-family:inherit;font-size:11px;cursor:pointer;white-space:nowrap">' +
                   (esActual?'✓ Activo':'Seleccionar') + '</button>' +
           '</div>';
       }).join('');
   }
   function selProvIns(nombre) {
       if (_provPanelIdx >= 0) { updPres(_provPanelIdx, 'proveedor', nombre); renderPresentaciones(); _actualizarDatalistProveedores(); }
       cerrarPanelProvIns();
   }
   function toggleNuevoProvInsForm() {
       var f = document.getElementById('nuevoProvInsForm');
       var visible = f.style.display === 'flex';
       f.style.display = visible ? 'none' : 'flex';
       if (!visible) {
           var typed = (_provPanelIdx >= 0 && presentacionesTemp[_provPanelIdx]) ? (presentacionesTemp[_provPanelIdx].proveedor || '') : '';
           var sq = document.getElementById('panelProvInsSearch').value.trim();
           document.getElementById('npiNombre').value = sq || typed || '';
           document.getElementById('npiTel').value = '';
           document.getElementById('npiContacto').value = '';
           document.getElementById('npiError').style.display = 'none';
           var w = document.getElementById('npiWarning'); w.style.display = 'none'; w._confirmado = false;
           document.getElementById('npiNombre').focus();
       }
   }
   function guardarNuevoProvIns() {
       var nombre = document.getElementById('npiNombre').value.trim();
       var errEl = document.getElementById('npiError');
       var warnEl = document.getElementById('npiWarning');
       if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.style.display = 'block'; return; }
       var provs = _loadProvsIns();
       var exacto = provs.find(function(p){ return _normProvIns(p.nombre) === _normProvIns(nombre); });
       if (exacto) { errEl.textContent = 'Ya existe un proveedor con ese nombre.'; errEl.style.display = 'block'; return; }
       var similares = provs.filter(function(p){ return _normProvIns(p.nombre).includes(_normProvIns(nombre)) || _normProvIns(nombre).includes(_normProvIns(p.nombre)); });
       if (similares.length && !warnEl._confirmado) {
           warnEl.textContent = '⚠ Posibles coincidencias: ' + similares.map(function(p){ return p.nombre; }).join(', ') + '. Clic en Guardar otra vez para confirmar.';
           warnEl.style.display = 'block'; warnEl._confirmado = true; return;
       }
       var np = {
           id: genId(), nombre: nombre,
           tel: document.getElementById('npiTel').value.trim(),
           contacto: document.getElementById('npiContacto').value.trim(),
           celContacto:'', correo:'', formaPago:'', clabe:'', banco:'', metodoFacturacion:'', notas:'', documentos:[],
           sucursalId: (localStorage.getItem('etaax_sucursal_activa') || '')
       };
       provs.push(np);
       _provsCacheIns = provs;
       try { localStorage.setItem('etaax_' + getNegocioActivo() + '_proveedores', JSON.stringify(provs)); } catch(e){}
       if (window.sbUpsert) { try { sbUpsert('proveedores', np); } catch(e){} }
       errEl.style.display='none'; warnEl.style.display='none'; warnEl._confirmado=false;
       document.getElementById('nuevoProvInsForm').style.display='none';
       selProvIns(np.nombre);
   }

   // ── Conceptos reutilizables por negocio (empaque, zona, presentación) ──
   // Se guardan en localStorage para reutilizarlos al instante; además, una vez
   // usados en un insumo guardado se sincronizan vía la data de insumos.
   var EMPAQUE_DEFAULTS = ['Botella vidrio','Botella plástico','Lata','Caja','Bolsa','Frasco','Tetrapak','Barril','Garrafón','Costal','Paquete','Tarro'];
   var ZONA_DEFAULTS    = [];
   function _getConceptosStore() {
       var negId = getNegocioActivo();
       try { return JSON.parse(localStorage.getItem('etaax_' + negId + '_conceptos') || '{}'); } catch(e) { return {}; }
   }
   function _getConceptos(tipo) {
       var s = _getConceptosStore();
       return Array.isArray(s[tipo]) ? s[tipo] : [];
   }
   function _addConcepto(tipo, valor) {
       valor = (valor || '').trim();
       if (!valor) return false;
       var negId = getNegocioActivo();
       var s = _getConceptosStore();
       if (!Array.isArray(s[tipo])) s[tipo] = [];
       if (s[tipo].some(function(v){ return v.toLowerCase() === valor.toLowerCase(); })) return false;
       s[tipo].push(valor);
       try { localStorage.setItem('etaax_' + negId + '_conceptos', JSON.stringify(s)); } catch(e) {}
       return true;
   }
   function _conceptosUsados(tipo) {
       var set = new Set();
       getInsumos().forEach(function(ins){
           if (tipo === 'empaque') { if (ins.empaque) set.add(ins.empaque); }
           else (ins.presentaciones || []).forEach(function(pr){ if (pr[tipo]) set.add(pr[tipo]); });
       });
       return Array.from(set);
   }
   function _sugerenciasConcepto(tipo, defaults) {
       var s = new Set(defaults || []);
       _conceptosUsados(tipo).forEach(function(v){ s.add(v); });
       _getConceptos(tipo).forEach(function(v){ s.add(v); });
       return Array.from(s).filter(Boolean);
   }
   function _poblarDatalistConcepto(tipo, listId, defaults) {
       var dl = document.getElementById(listId);
       if (!dl) { dl = document.createElement('datalist'); dl.id = listId; document.body.appendChild(dl); }
       dl.innerHTML = _sugerenciasConcepto(tipo, defaults).sort().map(function(v){
           return '<option value="' + String(v).replace(/"/g,'&quot;') + '">';
       }).join('');
   }
   function _flashBtnConcepto(btn, ok) {
       if (!btn) return;
       var t = btn.textContent;
       btn.textContent = ok ? '✓' : '–';
       btn.style.color = ok ? 'var(--green)' : 'var(--text-dim)';
       setTimeout(function(){ btn.textContent = t; btn.style.color = 'var(--green)'; }, 800);
   }
   // Botón ＋ para campos de texto (empaque): guarda el valor escrito como concepto.
   function agregarConceptoCampo(tipo, inputId, listId, btn, defaults) {
       var el = document.getElementById(inputId);
       var val = el ? (el.value || '').trim() : '';
       if (!val) { _flashBtnConcepto(btn, false); return; }
       _addConcepto(tipo, val);
       _poblarDatalistConcepto(tipo, listId, defaults);
       _flashBtnConcepto(btn, true);
   }
   // Botón ＋ para campos dentro de una presentación (zona).
   function agregarConceptoPres(tipo, i, listId, btn, defaults) {
       var val = (presentacionesTemp[i] && (presentacionesTemp[i][tipo] || '').trim()) || '';
       if (!val) { _flashBtnConcepto(btn, false); return; }
       _addConcepto(tipo, val);
       _poblarDatalistConcepto(tipo, listId, defaults);
       _flashBtnConcepto(btn, true);
   }
   // Cambio en el select de presentación de compra (intercepta "＋ Agregar concepto").
   function onPresCompraChange(i, sel) {
       if (sel.value === '__nuevo__') {
           sel.value = ''; // reset mientras se captura
           var _ask = window.etaaxPrompt || function(t,d,cb){ cb(window.prompt(t) || ''); };
           _ask('Nuevo concepto de presentación de compra', '', function(val){
               var v = (val || '').trim();
               if (v) { _addConcepto('presentacionCompra', v); updPres(i, 'presentacionCompra', v); }
               renderPresentaciones();
           }, { icon:'📦', placeholder:'Ej. Bote, Caja, Costal…' });
           return;
       }
       updPres(i, 'presentacionCompra', sel.value);
       renderPresentaciones();
   }

   // ── Datalist de proveedores (catálogo global + usados en insumos) ──
   function _actualizarDatalistProveedores() {
       var listId = 'etaax-provs-list';
       var dl = document.getElementById(listId);
       if (!dl) { dl = document.createElement('datalist'); dl.id = listId; document.body.appendChild(dl); }
       // Proveedores del catálogo del negocio (tabla proveedores) + clave legacy
       var catalogados = [];
       try { catalogados = JSON.parse(localStorage.getItem('etaax_proveedores') || '[]'); } catch(e){}
       var nombres = new Set(catalogados.map(function(p){ return p.nombre; }).filter(Boolean));
       _loadProvsIns().forEach(function(p){ if (p && p.nombre) nombres.add(p.nombre); });
       // Proveedores usados en insumos de este negocio (puede que no estén en catálogo)
       var todosInsumos = getInsumos();
       todosInsumos.forEach(function(ins){
           (ins.presentaciones || []).forEach(function(pr){
               if (pr.proveedor) nombres.add(pr.proveedor);
           });
       });
       dl.innerHTML = Array.from(nombres).sort().map(function(n){
           return '<option value="' + n.replace(/"/g,'&quot;') + '">';
       }).join('');
   }

   // ── Limpieza de fotos base64 en localStorage ──────────────────
   // Las fotos base64 pueden pesar >500KB cada una y agotar el cupo de 5MB.
   // Se reemplaza por '' — la foto sigue en Supabase (catálogo global) o se
   // puede volver a subir localmente en el insumo del negocio.
   function _limpiarFotosBase64() {
       var key = _sk('insumos');
       var raw = localStorage.getItem(key);
       if (!raw) return;
       var tamanoMB = raw.length / 1024 / 1024;
       if (tamanoMB < 1.5) return; // solo limpiar si hay riesgo real (>1.5 MB)
       try {
           var lista = JSON.parse(raw) || [];
           var changed = false;
           lista.forEach(function(ins) {
               if (ins.foto && ins.foto.startsWith('data:')) {
                   ins.foto = '';
                   changed = true;
               }
           });
           if (changed) localStorage.setItem(key, JSON.stringify(lista));
       } catch(e) {}
   }

   // ── Init ──────────────────────────────────────────────────────
   function init() {
       _limpiarFotosBase64();
       _actualizarBannerGlobal();
       renderStats();
       cargarFiltros();
       setVistaInsumos(vistaInsumos);
       // Primera carga: sincronizar con Supabase en background
       if (!_insumosSupaCargado && getNegocioActivo()) {
           _insumosSupaCargado = true;
           _cargarInsumosDeSupabase();
           _cargarProveedoresIns(); // catálogo de proveedores para el editor
       }
   }

   // OJO: insumos.js puede cargar ANTES que security.js (etx) y otros helpers.
   // Si arrancamos init() de inmediato, cargarFiltros() usa etx() indefinido y
   // aborta init() antes de pintar la vista. Esperar a DOMContentLoaded garantiza
   // que todos los <script> síncronos (security/ctx-bar/etaax-db/supabase) ya
   // cargaron. En el admin (carga dinámica) readyState ya es 'complete' → corre ya.
   if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
   else init();