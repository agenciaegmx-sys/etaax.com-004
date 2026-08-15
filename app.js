/* ============================================================
   ETAAX - Costeos y Escandallos
   app.js · Conectado a BD insumos
   ============================================================ */

// ── Sesión / negocio activo ───────────────────────────────────
function getNegocioActivo() {
    return localStorage.getItem('etaax_negocio_activo') || '';
}
function _sk(key) {
    var id = getNegocioActivo();
    return id ? ('etaax_' + id + '_' + key) : ('etaax_' + key);
}
// Lee una clave con prefijo de negocio; si no existe aún para este negocio,
// migra silenciosamente desde la clave legacy (etaax_{key}) una sola vez.
function _skGet(key) {
    var k   = _sk(key);
    var raw = localStorage.getItem(k);
    if (raw !== null) return raw;                       // ya tiene datos propios
    var id = getNegocioActivo();
    if (!id) return null;                               // sin negocio → usa key plana
    var legacy = localStorage.getItem('etaax_' + key);
    if (legacy && legacy !== 'null') {
        localStorage.setItem(k, legacy);               // migrar una sola vez
        return legacy;
    }
    return null;
}

// ── Recetas — cache + Supabase ────────────────────────────────
var _cacheRecetas = null;

function getRecetas() {
    return _cacheRecetas || [];
}
// Resolver id→receta CANÓNICO por sucursal (insumo-label.js): recetas/sub-recetas guardan
// el id del maestro; si hay una copia de receta para la sucursal activa, la devuelve
// transparente. Sin copias, equivale a getRecetas().find por id.
if (typeof window !== 'undefined' && typeof window._makeRecetaResolver === 'function' && !window._recetaResolver) {
    window._recetaResolver = window._makeRecetaResolver(getRecetas);
}
// Recetas acotadas a la SUCURSAL activa (regla "sin sucursal = matriz: ve todo").
// SOLO para mostrar listas; getRecetas() sigue completo para lookups por id y
// para reconstruir el cache (si filtráramos ahí, se borrarían recetas de otras
// sucursales al hacer setRecetas(getRecetas().filter(...))).
// Sucursales donde "vive" una receta. Membresía múltiple: usa el array `sucursales`
// si existe; si no, cae al `sucursalId` único (backward-compatible). Vacío = Matriz (todas).
function _recetaSucursales(r) {
    if (r && r.sucursales && r.sucursales.length) return r.sucursales;
    if (r && r.sucursalId) return [r.sucursalId];
    return [];
}
function getRecetasScope() {
    var s = localStorage.getItem('etaax_sucursal_activa') || '';
    var l = getRecetas();
    if (!s) return l; // Matriz / catálogo global → todas
    // Regla única de visibilidad (insumo-label.js): vive aquí + activa global
    // + no PAUSADA en esta sucursal (inactivaEn).
    return l.filter(function(r){
        if (typeof window._recetaActivaEnSuc === 'function') return window._recetaActivaEnSuc(r, s);
        if (r.status === 'inactiva') return false;
        var sucs = _recetaSucursales(r);
        if (!sucs.length) return s === 'suc_principal';
        return sucs.indexOf(s) >= 0;
    });
}
/* ── TOMBSTONES de recetas borradas ───────────────────────────────────────────
   Insumos ya tenía esto (ins_borrados) justo porque "los borrados revivían"; a
   recetas nunca se le aplicó. El merge de _sbInitRecetas conserva y RE-SUBE lo que
   está en localStorage y no en Supabase — pensado para rescatar lo que no alcanzó a
   sincronizar, pero también resucita lo borrado: basta que otra pestaña con la lista
   vieja en memoria guarde cualquier receta para que reescriba localStorage con las
   borradas dentro, y en la siguiente carga se re-suben a la nube.
   Los ids salen de genId() y nunca se reusan → marcar uno como borrado es seguro. */
var _REC_TOMB_TTL = 90 * 864e5;   // 90 días y se podan solas
function _recTombKey(){ return _sk('rec_borradas'); }
function _recTombLoad(){ try { return JSON.parse(localStorage.getItem(_recTombKey())) || {}; } catch(e){ return {}; } }
var _recBorradas = _recTombLoad();
function _recTombSave(){ try { localStorage.setItem(_recTombKey(), JSON.stringify(_recBorradas)); } catch(e){} }
function _recTombPrune(){ var now=Date.now(), ch=false; for (var k in _recBorradas){ if (now-_recBorradas[k] > _REC_TOMB_TTL){ delete _recBorradas[k]; ch=true; } } if (ch) _recTombSave(); }
function _recTombRefresh(){ _recBorradas = _recTombLoad(); _recTombPrune(); }
function _recTombAdd(ids){ var now=Date.now(); (ids||[]).forEach(function(id){ if(id) _recBorradas[id]=now; }); _recTombSave(); }
function _recTombHas(id){ return !!(id && _recBorradas[id]); }
window._recTombAdd = _recTombAdd;
window._recTombRefresh = _recTombRefresh;
_recTombPrune();

function setRecetas(data) {
    // Filtro de entrada: aunque otra pestaña (o un módulo con la lista vieja en
    // memoria) intente escribir una receta ya borrada, aquí no pasa. Se releen las
    // lápidas de localStorage —no la copia en memoria— porque la pestaña que escribe
    // pudo cargarse ANTES del borrado y tendría el mapa vacío.
    _recBorradas = _recTombLoad();
    if (Object.keys(_recBorradas).length) data = (data || []).filter(function(r){ return !(r && _recTombHas(r.id)); });
    _cacheRecetas = data;
    // localStorage fallback (sin fotos base64 para evitar quota)
    try {
        var sinFotos = data.map(function(r) {
            if (!r.fotos || !r.fotos.length) return r;
            var c = Object.assign({}, r);
            c.fotos = []; c.foto = '';
            return c;
        });
        localStorage.setItem(_sk('recetas'), JSON.stringify(sinFotos));
    } catch(e) {}
}

function _sbUpReceta(rec) {
    var negId = getNegocioActivo();
    if (!negId) { console.warn('[recetas] SIN negocio activo → no se sube:', rec && rec.id); return; }
    console.log('[recetas] upsert', rec && rec.id, '· neg', negId);
    sbUpsert('recetas', rec, negId);
}
function _sbDelReceta(id) {
    sbDelete('recetas', id);
}
async function _sbInitRecetas() {
    var negId = getNegocioActivo(); if (!negId) return;
    var res = await _supabase.from('recetas').select('datos').eq('negocio_id', negId).order('created_at', {ascending: true});
    if (res.error) {
        // Sin conexión / error de esquema: usar respaldo local.
        console.warn('[recetas] no se pudo leer de Supabase →', res.error.message,
            '· (si dice "created_at"/"id no existe", falta correr la migración v17)');
        try { _cacheRecetas = JSON.parse(_skGet('recetas')) || []; } catch(e) { _cacheRecetas = []; }
        if (typeof renderGridRecetas === 'function') renderGridRecetas();
        return;
    }
    var remote = (res.data || []).map(function(x){ return x.datos; }).filter(Boolean);
    _recTombRefresh();   // lápidas del negocio activo (sobreviven a la recarga)
    // dedup defensivo por id + descartar lo que ya se borró
    var vistos = {}, dedup = [], revividas = [];
    remote.forEach(function(r){
        if (!r || !r.id) return;
        if (_recTombHas(r.id)) { revividas.push(r.id); return; }
        if (!vistos[r.id]) { vistos[r.id] = 1; dedup.push(r); }
    });
    remote = dedup;
    // Auto-reparación: si la nube todavía trae recetas que ya borramos (el delete se
    // canceló al navegar, o lo revivió otra pestaña), re-emitir el borrado.
    if (revividas.length) {
        console.log('[recetas] auto-reparación: re-borrando', revividas.length, 'receta(s) que resucitaron');
        revividas.forEach(function(id){ try { _sbDelReceta(id); } catch(e) {} });
    }
    // MERGE: conservar las recetas locales que NO están en Supabase. Antes esto
    // SOBREESCRIBÍA con lo remoto → si una receta no había sincronizado (ej. el
    // upsert falló por foto base64 pesada) se "perdía" al abrir en otro dispositivo.
    var local = [];
    try { local = JSON.parse(_skGet('recetas')) || []; } catch(e) {}
    var soloLocal = (local || []).filter(function(r){ return r && r.id && !vistos[r.id] && !_recTombHas(r.id); });
    console.log('[recetas] init · neg', negId, '· Supabase:', remote.length, '· solo-local (re-subir):', soloLocal.length);
    _cacheRecetas = remote.concat(soloLocal);
    // Re-empujar a Supabase las que solo existían localmente (ya sin base64 → el
    // upsert pasa) para que aparezcan en los demás dispositivos.
    soloLocal.forEach(function(r){ if (typeof _sbUpReceta === 'function') _sbUpReceta(r); });
    if (typeof renderGridRecetas === 'function') renderGridRecetas();
    // Carátula abierta en modal (embed): renderizó ANTES de que cargaran las recetas
    // (async) → mostraba "0 recetas". Al terminar la carga, re-renderizar la vista.
    var _vc = document.getElementById('vistaCaratula');
    if (_vc && _vc.style.display !== 'none') {
        try {
            if (typeof caratulaTipoActual !== 'undefined' && caratulaTipoActual) {
                if (typeof renderCaratulaDetalleTabla === 'function') renderCaratulaDetalleTabla();
            } else if (typeof renderCaratulaSelector === 'function') { renderCaratulaSelector(); }
        } catch(e) {}
    }
    // Si se entró con ?r=<id> y la receta no estaba cargada todavía, abrirla ahora.
    if (window._pendingOpenReceta) {
        var _rid = window._pendingOpenReceta;
        if (_cacheRecetas.find(function(x){ return x.id === _rid; })) {
            window._pendingOpenReceta = null;
            if (typeof entrarEscandallos === 'function') entrarEscandallos();
            if (typeof _showEscForm === 'function') _showEscForm();
            if (typeof cargarReceta === 'function') cargarReceta(_rid);
        }
    }
    // Recetas ya en memoria → re-ligar sub-recetas-insumo huérfanas y resolver ?subins=.
    if (typeof window._onRecetasListas === 'function') { try { window._onRecetasListas(); } catch(e) {} }
    _subRecetasRealtime(negId);
}

// Catálogo de insumos para el editor de recetas. El editor lee los insumos de
// localStorage (getCatalogoInsumos → _skGet('insumos')), que SOLO se llena al
// visitar insumos.html. Si el usuario entra directo a Recetas, el catálogo sale
// vacío. Aquí lo cargamos desde Supabase al iniciar el módulo de recetas.
async function _sbInitInsumosCatalogo() {
    var negId = getNegocioActivo(); if (!negId) return;
    if (typeof _supabase === 'undefined') return;
    try {
        // OJO: los insumos del negocio viven en la tabla `negocio_insumos`
        // (negocio_id + insumo_id + datos), NO en `insumos`. Misma lectura
        // paginada que usa insumos.js.
        var remote = [], from = 0, BATCH = 200, guard = 0, huboError = false;
        while (guard++ < 200) {
            var res = await _supabase.from('negocio_insumos')
                .select('datos').eq('negocio_id', negId)
                .order('insumo_id', { ascending: true })
                .range(from, from + BATCH - 1);
            if (res.error) {
                huboError = true;
                console.warn('[recetas] no se pudo cargar el catálogo de insumos:', res.error.message);
                break;
            }
            var chunk = (res.data || []).map(function(r){ return r.datos; }).filter(Boolean);
            if (!chunk.length) break;
            remote = remote.concat(chunk);
            from += chunk.length;
            if (chunk.length < BATCH) break;
        }
        // Si vino vacío por error, no pisar el caché local.
        if (!remote.length && huboError) return;
        // Dedup + conservar insumos solo-locales (aún sin sincronizar).
        var vistos = {}, dedup = [];
        remote.forEach(function(i){ if (i && i.id && !vistos[i.id]) { vistos[i.id] = 1; dedup.push(i); } });
        var local = [];
        try { local = JSON.parse(_skGet('insumos')) || []; } catch(e) {}
        var soloLocal = (local || []).filter(function(i){ return i && i.id && !vistos[i.id]; });
        var lista = dedup.concat(soloLocal);
        // localStorage sin fotos base64 (quota). El editor solo usa nombre/costos/presentaciones.
        var paraLocal = lista.map(function(ins) {
            if (ins && ins.foto && String(ins.foto).indexOf('data:') === 0) {
                var d = Object.assign({}, ins); d.foto = ''; return d;
            }
            return ins;
        });
        try { localStorage.setItem(_sk('insumos'), JSON.stringify(paraLocal)); } catch(e) {}
        console.log('[recetas] catálogo de insumos cargado · negocio_insumos:', dedup.length, '· solo-local:', soloLocal.length);
        // Refrescar la tabla del editor si ya está abierta, pero SIN interrumpir si
        // el usuario está escribiendo un ingrediente en ese momento (perdería foco).
        if (typeof renderTabla === 'function') {
            var act = document.activeElement;
            var escribiendo = act && act.getAttribute && act.getAttribute('data-ing') === 'nombre';
            if (!escribiendo) { try { renderTabla(); } catch(e) {} }
        }
        // Ya con el catálogo cargado, re-evaluar el botón "Agregar como insumo"
        // de la sub-receta abierta (por si venía sin datos al abrir).
        if (typeof _actualizarBotonAgregarInsumo === 'function') { try { _actualizarBotonAgregarInsumo(); } catch(e) {} }
    } catch(e) { console.warn('[recetas] error al cargar insumos:', e); }
}

// Realtime: si otro dispositivo cambia una receta, recargamos solos (sin F5).
var _recetasRtCh = null;
function _subRecetasRealtime(negId) {
    if (_recetasRtCh || typeof sbRealtime !== 'function' || !negId) return;
    _recetasRtCh = sbRealtime('recetas', negId, function() {
        console.log('[recetas] cambio en vivo desde otro dispositivo → recargando');
        _sbInitRecetas();
    });
}
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2,5);
}


// ── Helper: leer campos extra según tipo ────────────────────
function leerCamposExtra(tipo) {
    const get = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const getChecked = () => [...document.querySelectorAll('#alergenos-wrap input:checked')].map(x => x.value);
    switch(tipo) {
        case 'alimentos':
            var getAcomp = function() { return typeof getTagsFromContainer === 'function' ? getTagsFromContainer('acomp-tags') : []; };
            var getAlerg = function() { return typeof getTagsFromContainer === 'function' ? getTagsFromContainer('alergenos-tags') : []; };
            return { porciones: get('porciones'), unidadPorcion: get('unidadPorcion'),
                     temperaturaServicio: get('temperaturaServicio'),
                     alergenos: getAlerg(),
                     acompañamientos: getAcomp() };
        case 'sub-alimentos':
            return {
                tipoMedicion:           typeof getTipoMedicion === 'function' ? getTipoMedicion() : 'granel',
                rendimientoFinal:       get('rendimientoFinal'),
                unidadRendimientoFinal: get('unidadRendimientoFinal'),
                unidadRendBruto:        get('unidadRendBruto'),
                pesoPieza:              get('pesoPieza'),
                unidadPesoPieza:        get('unidadPesoPieza'),
                mermaManual:            get('mermaManual'),
                porcionesQty:           get('porcionesQty'),
                porcionesUnidad:        get('porcionesUnidad'),
                pesoPorcion:            get('pesoPorcion'),
                unidadPesoPorcion:      get('unidadPesoPorcion'),
                unidadPesoAutoDisplay:  get('unidadPesoAutoDisplay'),
                porcionesUnidadFila2:   get('porcionesUnidadFila2'),
                vidaUtilNum:            get('vidaUtilNum'),
                vidaUtilUnidad:         get('vidaUtilUnidad'),
                almacenamiento:         get('almacenamiento'),
                envaseCapacidad:        get('envaseCapacidad'),  // envase físico del prebatch
                envaseCapUnidad:        get('envaseCapUnidad'),  // ml | L
                envasePesoLleno:        get('envasePesoLleno'),  // peso del envase LLENO
                envasePesoUnidad:       get('envasePesoUnidad'), // g | kg
                envaseTara:             get('envaseTara'),       // g (auto: lleno − contenido; editable)
            };
        case 'bebidas':
            return { metodoPre: get('metodoPre'), garnish: get('garnish'),
                     rendimientoBebida: get('rendimientoBebida'),
                     unidadRendimientoBebida: get('unidadRendimientoBebida') };
        case 'sub-bebidas':
            return {
                tipoMedicion:           typeof getTipoMedicion === 'function' ? getTipoMedicion() : 'granel',
                rendimientoFinal:       get('rendimientoFinal'),
                unidadRendimientoFinal: get('unidadRendimientoFinal'),
                unidadRendBruto:        get('unidadRendBruto'),
                pesoPieza:              get('pesoPieza'),
                unidadPesoPieza:        get('unidadPesoPieza'),
                mermaManual:            get('mermaManual'),
                porcionesQty:           get('porcionesQty'),
                porcionesUnidad:        get('porcionesUnidad'),
                pesoPorcion:            get('pesoPorcion'),
                unidadPesoPorcion:      get('unidadPesoPorcion'),
                unidadPesoAutoDisplay:  get('unidadPesoAutoDisplay'),
                porcionesUnidadFila2:   get('porcionesUnidadFila2'),
                vidaUtilNum:            get('vidaUtilNum'),
                vidaUtilUnidad:         get('vidaUtilUnidad'),
                almacenamiento:         get('almacenamiento'),
                envaseCapacidad:        get('envaseCapacidad'),  // envase físico del prebatch
                envaseCapUnidad:        get('envaseCapUnidad'),  // ml | L
                envasePesoLleno:        get('envasePesoLleno'),  // peso del envase LLENO
                envasePesoUnidad:       get('envasePesoUnidad'), // g | kg
                envaseTara:             get('envaseTara'),       // g (auto: lleno − contenido; editable)
            };
        default: return {};
    }
}

async function guardarReceta() {
    const nombre = document.getElementById('nombreReceta').value.trim();
    if (!nombre) { alert('Agrega un nombre a la receta antes de guardar'); return false; }
    var _guardandoDesdeCaratula = !!window._volverACaratula;

    const tiempoNum    = document.getElementById('tiempoNum')?.value    || '';
    const tiempoUnidad = document.getElementById('tiempoUnidad')?.value || 'min';

    // Sucursal donde vive la receta: si el selector está visible, usa la elección;
    // si no, conserva la existente al editar o estampa la sucursal activa al crear.
    var _exRec = getRecetas().find(function(r){ return r.id === (recetaActualId||''); });
    var _selSucR = document.getElementById('receta-sucursal');
    var _rowSucR = document.getElementById('row-receta-sucursal');
    var _sucRec = (_rowSucR && _rowSucR.style.display !== 'none' && _selSucR)
        ? _selSucR.value
        : ((_exRec && _exRec.sucursalId !== undefined)
            ? _exRec.sucursalId
            : (localStorage.getItem('etaax_sucursal_activa') || ''));
    // CATÁLOGO GLOBAL: la receta NUEVA nace solo como maestro global (igual que el
    // insumo), sin copia de sucursal. Antes heredaba `etaax_sucursal_activa` — la
    // sucursal donde estuviste por última vez — y nacían dos registros de golpe.
    var _catGlobRec = false;
    try { _catGlobRec = sessionStorage.getItem('etaax_cat_global') === '1'; } catch (e) {}
    if (_catGlobRec && !_exRec) _sucRec = '';

    // MERGE con el registro existente: el objeto NO se reconstruye desde cero.
    // Así se CONSERVAN los campos que el editor no maneja — sobre todo la
    // membresía multi-sucursal (`sucursales`, se administra con "Copiar a
    // sucursal" en el catálogo global) y `status` (inactiva). Antes, guardar
    // desde una sucursal borraba `sucursales` → la receta "se iba" al global.
    const receta = Object.assign({}, _exRec || {}, {
        id:           recetaActualId || genId(),
        sucursalId:   _sucRec,
        tipo:         recetaTipoActual || 'alimentos',
        nombre,
        grupo:        document.getElementById('grupo')?.value        || '',
        categoria:    document.getElementById('categoria')?.value    || '',
        cristaleria:  document.getElementById('cristaleria')?.value  || '',
        tiempo:       tiempoNum ? tiempoNum + ' ' + tiempoUnidad : '',
        procedimiento:document.getElementById('procedimiento')?.value || '',
        precioEnCarta:(document.getElementById('precioFormulario') || document.getElementById('precioEnCarta') || {value:''}).value || '',
        // Múltiplo del costeo sugerido ('' = default 3.33). Se guarda como número
        // para que reportes y carátula lo lean sin parsear.
        multiploCosteo: _multiploDelEditor(),
        ingredientes: JSON.parse(JSON.stringify(ingredientes)),
        fotos:        JSON.parse(JSON.stringify(fotosReceta)),
        foto:         fotosReceta[0] || '',  // compatibilidad plantillas
        camposExtra:  typeof leerCamposExtra === 'function' ? leerCamposExtra(recetaTipoActual||'alimentos') : {},
        // Activa/Inactiva desde la pastilla del editor (persistido de verdad).
        status:       (document.getElementById('statusPill') && document.getElementById('statusPill').textContent === 'Inactiva') ? 'inactiva' : 'activa',
        fechaGuardado: new Date().toISOString(),
        updatedBy:     _usuarioActualRec(),   // quién dejó así el costeo
    });

    // Subir fotos base64 a Storage y dejar solo URLs (evita el payload gigante
    // que hacía fallar el upsert → la receta se "perdía" al recargar).
    if (window.sbSubirFotoBase64 && receta.fotos && receta.fotos.length) {
        var _btnSv = document.getElementById('btnGuardarReceta');
        var _btnSvTxt = _btnSv ? _btnSv.textContent : '';
        if (_btnSv) { _btnSv.textContent = 'Subiendo fotos…'; _btnSv.disabled = true; }
        var urls = [];
        for (var _i = 0; _i < receta.fotos.length; _i++) {
            var _f = receta.fotos[_i];
            if (_f && _f.indexOf('data:') === 0) {
                var _u = await sbSubirFotoBase64('recetas', _f, getNegocioActivo());
                urls.push(_u || _f);
            } else if (_f) { urls.push(_f); }
        }
        receta.fotos = urls;
        receta.foto  = urls[0] || '';
        if (_btnSv) { _btnSv.textContent = _btnSvTxt; _btnSv.disabled = false; }
    }

    const lista = getRecetas();
    const idx   = lista.findIndex(r => r.id === receta.id);
    // NUEVA receta creada DENTRO de una sucursal → generar su MAESTRO global (sin
    // sucursal) y dejar ESTA receta como la COPIA vinculada de la sucursal (origenId →
    // maestro). Así queda el maestro en el catálogo global + la copia independiente donde
    // se creó, ligadas por origenId. El editor sigue sobre la copia (lo que ve la
    // sucursal). Sin sucursal activa (admin ETAAX / catálogo global) → nace maestro, sin copia.
    var _masterRec = null;
    if (idx < 0 && !receta.origenId && _sucRec) {
        _masterRec = JSON.parse(JSON.stringify(receta));
        _masterRec.id = genId();
        _masterRec.sucursales = []; _masterRec.sucursalId = '';
        _masterRec._global = true; // maestro del catálogo global: NO aparece operativamente
                                   // en Matriz (sus copias sirven a cada sucursal). Recetas
                                   // legacy "sin sucursal" (sin _global) siguen viéndose en Matriz.
        delete _masterRec.origenId;
        receta.origenId   = _masterRec.id;
        receta.sucursales = [_sucRec];
        receta.sucursalId = _sucRec;
        lista.push(_masterRec);
    }
    // Nacida en el catálogo global (sin sucursal) → marcarla como maestro global para
    // que muestre "🌐 Global · sin asignar" y NO se cuele como receta operativa de Matriz.
    if (idx < 0 && !receta.origenId && !_sucRec && _catGlobRec) receta._global = true;
    if (idx >= 0) lista[idx] = receta;
    else lista.push(receta);

    setRecetas(lista);
    if (typeof _sbUpReceta === 'function') { if (_masterRec) _sbUpReceta(_masterRec); _sbUpReceta(receta); }
    recetaActualId = receta.id;
    window._escDirty = false; // ya se guardó → sin cambios pendientes
    if (typeof window._avisarDirty === 'function') window._avisarDirty();
    // Si es una sub-receta con insumo convertido, refrescarlo (y sus copias por
    // sucursal) para que el costo/ficha se actualice en TODOS lados sin re-convertir.
    var _esSubR = (recetaTipoActual === 'sub-alimentos' || recetaTipoActual === 'sub-bebidas' || (String(receta.tipo||'').indexOf('sub') === 0));
    if (_esSubR && typeof agregarSubRecetaComoInsumo === 'function' && typeof getCatalogoInsumos === 'function') {
        var _hayConvertido = getCatalogoInsumos().some(function(x){ return x.esSubReceta && x.recetaId === receta.id; });
        if (_hayConvertido) { try { agregarSubRecetaComoInsumo(true); } catch(e) { console.warn('[auto-update sub-receta→insumo]', e); } }
    }
    // Modal embebido (escandallo abierto DENTRO de otro escandallo): guardar
    // cierra el modal y el padre refresca costos — no regresar al menú de recetas.
    if (window.parent !== window && /[?&]embed=1/.test(window.location.search)) {
        try { window.parent.postMessage({ type: 'recetaGuardada', recetaId: receta.id }, window.location.origin); } catch (e) {}
        return true;
    }
    alert('✅ Receta "' + nombre + '" guardada');
    var btnImp = document.getElementById('btnImprimirHeader');
    if (btnImp) btnImp.style.display = '';
    if (typeof _showEscMenu === 'function' && !_guardandoDesdeCaratula) _showEscMenu();
    return true;
}

// ── Hacer una copia de la receta/sub-receta actual ──────────────
// Crea un duplicado independiente (nuevo id, nombre + " (copia)") y deja el
// editor trabajando sobre la copia. El original queda intacto.
function duplicarReceta() {
    var nEl = document.getElementById('nombreReceta');
    if (!nEl || !nEl.value.trim()) { alert('Agrega un nombre a la receta antes de copiarla.'); return; }
    if (!recetaActualId) { alert('Guarda la receta una vez antes de hacer una copia.'); return; }
    if (window._escDirty) { alert('Tienes cambios sin guardar. Guarda primero para incluirlos en la copia.'); return; }
    var src = getRecetas().find(function(r){ return r.id === recetaActualId; });
    if (!src) { alert('No se encontró la receta a copiar.'); return; }
    var copia = JSON.parse(JSON.stringify(src));
    copia.id     = genId();
    copia.nombre = (src.nombre || 'Receta') + ' (copia)';
    var lista = getRecetas(); lista.push(copia); setRecetas(lista);
    if (typeof _sbUpReceta === 'function') _sbUpReceta(copia);
    // El editor ya muestra el mismo contenido → solo lo "reapuntamos" a la copia.
    recetaActualId = copia.id;
    nEl.value = copia.nombre;
    if (typeof _syncBrandNombre === 'function') _syncBrandNombre();
    window._escDirty = false;
    if (typeof window._avisarDirty === 'function') window._avisarDirty();
    alert('✅ Copia creada: "' + copia.nombre + '". Ya la estás editando; el original quedó intacto.');
}

function cargarReceta(id) {
    const r = getRecetas().find(x => x.id === id);
    if (!r) return;

    recetaActualId    = r.id;
    recetaTipoActual  = r.tipo || 'alimentos';

    if (typeof _pobSucursalReceta === 'function') _pobSucursalReceta(r.sucursalId || ''); // sucursal asignada
    // Pastilla Activa/Inactiva: restaurar desde el status guardado (antes la
    // pastilla no se restauraba ni se guardaba — el toggle era solo visual).
    var _pillSt = document.getElementById('statusPill');
    if (_pillSt) {
        var _inact = r.status === 'inactiva';
        _pillSt.textContent = _inact ? 'Inactiva' : 'Activa';
        _pillSt.classList.toggle('pill-red',   _inact);
        _pillSt.classList.toggle('pill-amber', !_inact);
    }
    document.getElementById('nombreReceta').value  = r.nombre       || '';
    if (typeof _syncBrandNombre === 'function') _syncBrandNombre(); // nombre vivo bajo el título sticky
    document.getElementById('grupo').value         = r.grupo        || '';
    document.getElementById('categoria').value     = r.categoria    || '';
    document.getElementById('cristaleria').value   = r.cristaleria  || '';
    document.getElementById('procedimiento').value = r.procedimiento|| '';
    document.getElementById('precioEnCarta').value = r.precioEnCarta|| '';
    var _multEl = document.getElementById('s-multiplo');
    if (_multEl) _multEl.value = r.multiploCosteo || '';   // vacío = 3.33 de siempre
    _pintarSelloReceta(r);

    // Tiempo
    if (r.tiempo) {
        const parts = r.tiempo.split(' ');
        if (document.getElementById('tiempoNum'))    document.getElementById('tiempoNum').value    = parts[0] || '';
        if (document.getElementById('tiempoUnidad')) document.getElementById('tiempoUnidad').value = parts[1] || 'min';
    }

    // Renderizar formulario con datos guardados
    if (typeof renderFormularioPorTipo === 'function') {
        const datosForm = Object.assign({
            nombreReceta: r.nombre, grupo: r.grupo, categoria: r.categoria,
            cristaleria: r.cristaleria, precioEnCarta: r.precioEnCarta,
            tiempoNum: r.tiempo ? r.tiempo.split(' ')[0] : '',
            tiempoUnidad: r.tiempo ? r.tiempo.split(' ')[1] || 'min' : 'min',
        }, r.camposExtra || {});
        renderFormularioPorTipo(recetaTipoActual, datosForm);
    }

    // Fotos — soporta tanto array nuevo como foto única legacy
    fotosReceta     = r.fotos && r.fotos.length ? JSON.parse(JSON.stringify(r.fotos))
                    : (r.foto && r.foto.startsWith('data:') ? [r.foto] : []);
    fotoIndexActual = 0;
    renderCarrusel();
    if (typeof _cerrarPuenteReceta === 'function') _cerrarPuenteReceta(); // QR cerrado al cargar otra receta

    ingredientes = JSON.parse(JSON.stringify(r.ingredientes || []));
    // Re-sincronizar el costo de los ingredientes VINCULADOS al catálogo: si el insumo
    // cambió de precio en el módulo de Insumos, la receta lo refleja al abrirla
    // (antes quedaba congelado el costo guardado al agregarlo).
    if (typeof recalcularCostoDesdeInsumo === 'function') {
        ingredientes.forEach(function(ing, i) { if (ing && ing.insumoId) recalcularCostoDesdeInsumo(i); });
    }
    renderTabla();

    // Sub-recetas: la sección de rendimiento/porciones se reconstruye leyendo el DOM
    // (renderRendimientoSub usa los <input> actuales, no los datos). Según la ruta de
    // apertura (p.ej. ?r= desde insumos) esos inputs pueden quedar vacíos al momento de
    // leerlos → se "resetean". Re-sembramos los valores guardados al final (setTimeout 0)
    // y re-renderizamos para que NUNCA se pierdan.
    if (recetaTipoActual === 'sub-alimentos' || recetaTipoActual === 'sub-bebidas') {
        var _ce = r.camposExtra || {};
        setTimeout(function() {
            ['rendimientoFinal','unidadRendimientoFinal','unidadRendBruto','pesoPieza','unidadPesoPieza',
             'mermaManual','porcionesQty','porcionesUnidad','pesoPorcion','unidadPesoPorcion',
             'unidadPesoAutoDisplay','porcionesUnidadFila2','vidaUtilNum','vidaUtilUnidad','almacenamiento'
            ].forEach(function(id){
                var el = document.getElementById(id);
                if (el && _ce[id] != null && _ce[id] !== '') el.value = _ce[id];
            });
            if (typeof renderRendimientoSub === 'function') { try { renderRendimientoSub(); } catch(e) {} }
            if (typeof calcSubRecetaCostos === 'function') { try { calcSubRecetaCostos(); } catch(e) {} }
        }, 0);
    }

    if (typeof guardarEnHistorial === 'function') guardarEnHistorial();
    // Recién cargada → sin cambios pendientes (las cargas programáticas no disparan input).
    window._escDirty = false;
    if (typeof window._avisarDirty === 'function') window._avisarDirty();
    // Show print button for saved recipe
    var btnImp = document.getElementById('btnImprimirHeader');
    if (btnImp) btnImp.style.display = '';
}

// IDs de sesión
let recetaActualId   = null;
let recetaTipoActual = 'alimentos';

// ── Logo SVG compartido ──────────────────────────────────────
// Logo oficial ETAAX (eta·ax) para IMPRESIÓN = variante clara (letras tinta, punto verde).
const LOGO_SVG_PRINT = (typeof window!=='undefined' && typeof window.etaaxLogoSVG==='function')
    ? window.etaaxLogoSVG({ variant:'claro', height:24 })
    : '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="4650 98600 244400 53400"><g transform="matrix(1172.115912,0,0,1172.115912,3418.038957,87250.941841)"><g transform="matrix(1,0,0,1.05042,-2.857143,-0.529412)"><path d="M4,31C4,19.5 12.5,10.5 25,10.5C37.5,10.5 45.5,19.5 45.5,30.5C45.5,32 45.3,33.5 45,35L14,35C15.5,40.5 19.5,44 25,44C29.5,44 33,42 35,39.5L43.5,43.5C40,49.5 33,53 25,53C12.5,53 4,44 4,31Z" fill="#0f0e0c"/></g><g transform="matrix(1,0,0,1,-2.857143,0)"><path d="M14.5,28L37,28C35.5,23 31.5,20 25.5,20C19.5,20 16,23 14.5,28Z" fill="#ffffff"/></g><path d="M52,12L61,12L61,21L72,21L72,30L61,30L61,42C61,44.8 62.5,46 65,46L72,46L72,54.5L64.5,54.5C57,54.5 52,50.5 52,43L52,30L46,30L46,21L52,21L52,12Z" fill="#0f0e0c"/><g transform="matrix(1,0,0,1,-3.571429,0)"><path d="M78,41C78,34.5 83.5,30.5 92.5,29.5L104,28.5L104,27.5C104,23.5 101.5,21 97,21C93,21 90,23 89,26.5L80.5,24C82.5,17.5 89,13 97,13C107.5,13 113,18.5 113,28.5L113,54.5L104,54.5L104,51C102,53.5 98.5,55 94,55C85.5,55 78,50.5 78,41Z" fill="#0f0e0c"/></g><g transform="matrix(1,0,0,1,-2.857143,0)"><path d="M104,37L95.5,38C92.5,38.5 90.5,40 90.5,42.5C90.5,45 92.5,46.5 95.5,46.5C101,46.5 104,43.5 104,39L104,37Z" fill="#ffffff"/></g><path d="M126,41C126,34.5 131.5,30.5 140.5,29.5L152,28.5L152,27.5C152,23.5 149.5,21 145,21C141,21 138,23 137,26.5L128.5,24C130.5,17.5 137,13 145,13C155.5,13 161,18.5 161,28.5L161,54.5L152,54.5L152,51C150,53.5 146.5,55 142,55C133.5,55 126,50.5 126,41Z" fill="#0f0e0c"/><path d="M152,37L143.5,38C140.5,38.5 138.5,40 138.5,42.5C138.5,45 140.5,46.5 143.5,46.5C149,46.5 152,43.5 152,39L152,37Z" fill="#ffffff"/><g transform="matrix(1,0,0,1,-3.571429,0)"><path d="M168,13L179,13L190,30L201,13L212,13L196.5,34.5L213,54.5L202,54.5L190,38.5L178,54.5L167,54.5L183.5,34.5L168,13Z" fill="#0f0e0c"/></g><g transform="matrix(1.086406,0,0,1.086406,70.712678,4.362883)"><circle cx="45" cy="11" r="6" fill="#3dbe7a"/></g></g></svg>';

const CSS_PRINT_BASE = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'DM Sans',sans-serif; background:#fff; color:#1a1916; }
.pagina {
    width:100%;
    /* Altura mínima = hoja carta útil (27.94cm − márgenes @page 2cm − holgura):
       el pie (.footer-imp con margin-top:auto) queda ANCLADO al final de la
       HOJA, no al final del contenido. */
    min-height: 25.4cm;
    padding:1.2cm 1.4cm;
    page-break-after: always;
    display: flex;
    flex-direction: column;
}
.header-imp {
    display:flex; justify-content:space-between; align-items:center;
    padding-bottom:10px; border-bottom:3px solid #3dbe7a; margin-bottom:14px;
    flex-shrink: 0;
}
.header-left { display:flex; align-items:center; gap:12px; }
.receta-tipo { font-size:10px; letter-spacing:3px; text-transform:uppercase; color:#888; margin-bottom:2px; }
.receta-nombre { font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:1px; color:#1a1916; line-height:1; }
.body-imp { display:flex; flex-direction:column; gap:12px; flex:1 1 auto; min-height:0; }
/* Fotos: se reparten el alto que sobra de la hoja en vez de un 160px fijo — una
   sola foto se veía diminuta en media página vacía. Máximo 4 por renglón; con
   menos, cada una crece hasta llenar el ancho disponible. object-fit:contain
   mantiene la proporción (nada se recorta). */
.fotos-imp {
    flex:1 1 auto; min-height:6cm;
    display:flex; flex-wrap:wrap; gap:8px;
    justify-content:center; align-items:stretch; align-content:stretch;
    margin-top:14px;
}
/* Cada foto va en su CELDA: la celda se reparte el espacio y la imagen se centra
   dentro sin pasarse. Absoluta a propósito — con la imagen en flujo, una foto
   vertical a todo el ancho se volvía altísima y se brincaba a la hoja siguiente. */
.foto-cell { position:relative; min-width:0; }
.foto-cell img {
    position:absolute; top:0; right:0; bottom:0; left:0; margin:auto;
    max-width:100%; max-height:100%; width:auto; height:auto; object-fit:contain;
    border-radius:8px; border:1px solid #e8e8e8; background:#fafafa;
}
.body-imp.compact .fotos-imp { min-height:4.5cm; }
.body-imp.mini .fotos-imp    { min-height:3.5cm; }
.sec-title {
    font-size:9px; letter-spacing:3px; text-transform:uppercase;
    color:#3dbe7a; font-weight:600; margin-bottom:5px;
    padding-bottom:3px; border-bottom:1px solid #e8e8e8;
}
.tabla-ing { width:100%; border-collapse:collapse; }
.tabla-ing td  { padding:4px 7px; font-size:10px; color:#333; }
.tabla-ing th  { padding:5px 7px; font-size:9px; color:#666; text-transform:uppercase; letter-spacing:1px; }
.costeo-block { page-break-inside: avoid; }
.footer-imp {
    display:flex; justify-content:space-between;
    padding-top:10px; border-top:1px solid #e8e8e8;
    font-size:9px; color:#aaa; margin-top:auto; /* pie anclado al final de la hoja */
    letter-spacing:1px; flex-shrink:0;
}
/* Escala dinámica — se activa antes */
.tabla-ing.compact td  { padding:3px 6px; font-size:9.5px; }
.tabla-ing.compact th  { padding:4px 6px; font-size:8.5px; }
.body-imp.compact { gap:8px; }
.tabla-ing.mini td  { padding:2px 5px; font-size:9px; }
.tabla-ing.mini th  { padding:3px 5px; font-size:8px; }
.body-imp.mini { gap:6px; }
.receta-nombre.compact { font-size:24px; }
.receta-nombre.mini { font-size:20px; }
@media print {
    @page { size:letter; margin:1cm 1.2cm; }
    body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .pagina { page-break-after:always; padding:0; }
    .costeo-block { page-break-inside: avoid; }
}`;

const LOGO_SVG_DARK_BG='<svg xmlns="http://www.w3.org/2000/svg" height="27" viewBox="4650 98600 244400 53400"><g transform="matrix(1172.115912,0,0,1172.115912,3418.038957,87250.941841)"><g transform="matrix(1,0,0,1.05042,-2.857143,-0.529412)"><path d="M4,31C4,19.5 12.5,10.5 25,10.5C37.5,10.5 45.5,19.5 45.5,30.5C45.5,32 45.3,33.5 45,35L14,35C15.5,40.5 19.5,44 25,44C29.5,44 33,42 35,39.5L43.5,43.5C40,49.5 33,53 25,53C12.5,53 4,44 4,31Z" fill="#f0ece4"/></g><g transform="matrix(1,0,0,1,-2.857143,0)"><path d="M14.5,28L37,28C35.5,23 31.5,20 25.5,20C19.5,20 16,23 14.5,28Z" fill="#0f0e0c"/></g><path d="M52,12L61,12L61,21L72,21L72,30L61,30L61,42C61,44.8 62.5,46 65,46L72,46L72,54.5L64.5,54.5C57,54.5 52,50.5 52,43L52,30L46,30L46,21L52,21L52,12Z" fill="#f0ece4"/><g transform="matrix(1,0,0,1,-3.571429,0)"><path d="M78,41C78,34.5 83.5,30.5 92.5,29.5L104,28.5L104,27.5C104,23.5 101.5,21 97,21C93,21 90,23 89,26.5L80.5,24C82.5,17.5 89,13 97,13C107.5,13 113,18.5 113,28.5L113,54.5L104,54.5L104,51C102,53.5 98.5,55 94,55C85.5,55 78,50.5 78,41Z" fill="#f0ece4"/></g><g transform="matrix(1,0,0,1,-2.857143,0)"><path d="M104,37L95.5,38C92.5,38.5 90.5,40 90.5,42.5C90.5,45 92.5,46.5 95.5,46.5C101,46.5 104,43.5 104,39L104,37Z" fill="#0f0e0c"/></g><path d="M126,41C126,34.5 131.5,30.5 140.5,29.5L152,28.5L152,27.5C152,23.5 149.5,21 145,21C141,21 138,23 137,26.5L128.5,24C130.5,17.5 137,13 145,13C155.5,13 161,18.5 161,28.5L161,54.5L152,54.5L152,51C150,53.5 146.5,55 142,55C133.5,55 126,50.5 126,41Z" fill="#f0ece4"/><path d="M152,37L143.5,38C140.5,38.5 138.5,40 138.5,42.5C138.5,45 140.5,46.5 143.5,46.5C149,46.5 152,43.5 152,39L152,37Z" fill="#0f0e0c"/><g transform="matrix(1,0,0,1,-3.571429,0)"><path d="M168,13L179,13L190,30L201,13L212,13L196.5,34.5L213,54.5L202,54.5L190,38.5L178,54.5L167,54.5L183.5,34.5L168,13Z" fill="#f0ece4"/></g><g transform="matrix(1.086406,0,0,1.086406,70.712678,4.362883)"><circle cx="45" cy="11" r="6" fill="#3dbe7a"/></g></g></svg>';
function _getRendNeto(r,g){var cx=r.camposExtra||{};if(g.key==='alimentos')return (parseFloat(cx.porciones)||1)+' '+(cx.unidadPorcion||'PLATILLO').toUpperCase();if(g.key==='bebidas'){if(cx.rendimientoBebida&&cx.unidadRendimientoBebida)return cx.rendimientoBebida+' '+cx.unidadRendimientoBebida.toUpperCase();return '1 BEBIDA';}return '1 '+g.rendDefault;}
function _fmtNumP(n){if(n===0)return '0';return parseFloat(n.toFixed(3))+'';}
function buildPlantillaCaratula(recetas,grupo){var _mk=(typeof etaaxMarca==='function')?etaaxMarca():{negocio:'',emoji:'',sucursal:'',logo:''};var estab=_mk.negocio||'Establecimiento',g=grupo||{label:'Recetas',tipo:'normal',rendDefault:'PLATILLO',emoji:'',key:'alimentos',subtitulo:'Carátula de Costos'};var esSub=g.tipo==='sub',fecha=new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'}),subtitulo=g.subtitulo||'Carátula de Costos';var CSS=`* { margin:0; padding:0; box-sizing:border-box; }body { font-family:'DM Sans',sans-serif; background:#fff; color:#1a1916; -webkit-print-color-adjust:exact; print-color-adjust:exact; }.pagina { width:27.9cm; min-height:20.9cm; display:flex; flex-direction:column; }.pie-hoja { margin-top:auto; }.cab { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:3px solid #3dbe7a; }.cab-left { display:flex; align-items:center; gap:12px; }.cab-right { display:flex; align-items:center; gap:14px; }.neg-nombre { font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:1px; color:#1a1916; line-height:1; }.neg-sub { font-size:9px; letter-spacing:3px; text-transform:uppercase; color:#888; margin-top:2px; }.neg-logo { width:52px; height:52px; object-fit:contain; border:1px solid #eee; border-radius:6px; }.fecha-txt { font-size:9px; color:#aaa; letter-spacing:1px; text-align:right; }.fecha-cnt { font-size:10px; color:#888; margin-top:2px; text-align:right; }table.ct { width:100%; border-collapse:collapse; }table.ct thead tr { background:#f5f5f5; }table.ct thead th { padding:8px 10px; font-size:8.5px; font-weight:700; color:#666; text-transform:uppercase; letter-spacing:1.5px; border-bottom:2px solid #e0e0e0; }table.ct tbody tr { border-bottom:1px solid #f0f0f0; } table.ct tbody tr:nth-child(even) { background:#fafafa; }table.ct tbody td { padding:7px 10px; font-size:11px; }table.ct tfoot td { background:#f8f8f8; border-top:2px solid #3dbe7a; padding:9px 10px; }.pill { display:inline-block; border-radius:20px; padding:3px 11px; font-size:11px; font-weight:700; }.pg { background:#e8faf2; color:#1a7a46; } .pa { background:#fef9e7; color:#9a6f00; } .pr { background:#fdecea; color:#b52a1a; }.grp { font-size:8.5px; color:#aaa; margin-top:1px; }.footer { display:flex; justify-content:space-between; padding:10px 20px; border-top:1px solid #e8e8e8; font-size:9px; color:#aaa; }.footer strong { color:#3dbe7a; }@media print { @page { size:letter landscape; margin:0; } }`;function cc(r){return (r.ingredientes||[]).reduce(function(s,i){return s+costoIngredienteVivo(i);},0);}var tablaHTML;if(!esSub){var sU=0,cU=0;var filas=recetas.map(function(r){var c=cc(r),sC=EtaaxCore.costeoReceta(c,r).comedor,p=parseFloat(r.precioEnCarta)||0,si=p>0?p/1.16:0,cP=si>0?(c/si)*100:0,uP=si>0?100-cP-40:0,uM=si*(uP/100),tP=p>0,in2=r.status==='inactiva',gr=r.grupo||'',rend=_getRendNeto(r,g);if(tP){sU+=uP;cU++;}var pc=uP>=30?'pg':uP>=15?'pa':'pr';return '<tr style="'+(in2?'opacity:0.55':'')+'"><td style="font-weight:600">'+r.nombre+(in2?' <span style="font-size:8px;color:#aaa;border:1px solid #ddd;padding:1px 4px;border-radius:3px">inactiva</span>':'')+(gr?'<div class="grp">'+gr+'</div>':'')+'</td><td style="text-align:center;color:#777">'+rend+'</td><td style="text-align:right;color:#b8860b;font-weight:700">$'+c.toFixed(2)+'</td><td style="text-align:right;color:#888">$'+sC.toFixed(2)+'</td><td style="text-align:right;font-weight:700;color:'+(tP?'#1a7a46':'#bbb')+'">'+(tP?'$'+p.toFixed(2):'—')+'</td><td style="text-align:right;color:#555">'+(tP?'$'+uM.toFixed(2):'—')+'</td><td style="text-align:center">'+(tP?'<span class="pill '+pc+'">'+uP.toFixed(0)+'%</span>':'<span style="color:#ccc">—</span>')+'</td></tr>';}).join('');var prom=cU>0?sU/cU:null,pc2=prom!==null?(prom>=30?'pg':prom>=15?'pa':'pr'):'';tablaHTML='<table class="ct"><thead><tr><th style="text-align:left">NOMBRE DE RECETA</th><th style="text-align:center">RENDIMIENTO NETO</th><th style="text-align:right">COSTO BRUTO</th><th style="text-align:right">PRECIO SUGERIDO CON IVA</th><th style="text-align:right">PRECIO EN CARTA</th><th style="text-align:right">$ DE UTILIDAD NETA</th><th style="text-align:center">% DE UTILIDAD NETA</th></tr></thead><tbody>'+filas+'</tbody><tfoot><tr><td colspan="6" style="text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#888">Porcentaje promedio de utilidad neta</td><td style="text-align:center">'+(prom!==null?'<span class="pill '+pc2+'" style="font-size:13px;padding:4px 16px">'+prom.toFixed(2)+'%</span>':'<span style="color:#ccc">—</span>')+'</td></tr></tfoot></table>';}else{var fS=recetas.map(function(r){var c=cc(r),cx=r.camposExtra||{},rN=parseFloat(cx.rendimientoFinal)||0,rU=(cx.unidadRendimientoFinal||'').toUpperCase();var rS=rN>0?_fmtNumP(rN)+' '+rU.toLowerCase():'—';var rB=rN;if(rU==='G'||rU==='ML')rB=rN/1000;var cKL=rB>0?c/rB:0,uBase=(rU==='G'||rU==='KG')?'kg':(rU==='ML'||rU==='LT')?'lts':rU.toLowerCase();var pQ=parseFloat(cx.porcionesQty)||0,pUn=(cx.porcionesUnidad||'pzs').toLowerCase(),pP=parseFloat(cx.pesoPorcion)||0,uPor=(cx.unidadPesoPorcion||'').toLowerCase(),pD='—',uPD='—',cP=0;if(pQ>0){pD=pQ.toFixed(0)+' porciones';cP=c/pQ;if(rN>0)uPD=_fmtNumP(rN/pQ)+' '+rU.toLowerCase();else if(pP>0)uPD=_fmtNumP(pP)+' '+uPor;}else if(pP>0&&rN>0){var pC=rN/pP;pD=pC.toFixed(0)+' porciones';cP=c/pC;uPD=_fmtNumP(pP)+' '+uPor;}var in2=r.status==='inactiva',gr=r.grupo||'';return '<tr style="'+(in2?'opacity:0.55':'')+'"><td style="font-weight:600">'+r.nombre+(in2?' <span style="font-size:8px;color:#aaa;border:1px solid #ddd;padding:1px 4px;border-radius:3px">inactiva</span>':'')+(gr?'<div class="grp">'+gr+'</div>':'')+'</td><td style="text-align:center;color:#555">'+rS+'</td><td style="text-align:right;color:#b8860b;font-weight:700">$'+c.toFixed(2)+'</td><td style="text-align:center;color:#555">'+pD+'</td><td style="text-align:center;color:#555">'+uPD+'</td><td style="text-align:right;color:#1a7a46;font-weight:700">'+(cP>0?'$'+cP.toFixed(2):'—')+'</td><td style="text-align:right;color:#555;font-weight:600">'+(cKL>0?'$'+cKL.toFixed(2)+' <span style="font-size:8px;color:#aaa">/'+uBase+'</span>':'—')+'</td></tr>';}).join('');tablaHTML='<table class="ct"><thead><tr><th style="text-align:left">NOMBRE DE SUB RECETA</th><th style="text-align:center">RENDIMIENTO NETO</th><th style="text-align:right">COSTO BRUTO</th><th style="text-align:center">RENDIMIENTO x PORCIONES</th><th style="text-align:center">UNIDAD DE MEDIDA x PORCIÓN</th><th style="text-align:right">COSTO POR PORCIÓN</th><th style="text-align:right">COSTO POR kg o LT</th></tr></thead><tbody>'+fS+'</tbody></table>';}var _hdrDer='<div class="fecha-txt">'+fecha+'</div><div class="fecha-cnt">'+recetas.length+' recetas</div>';var _hdr=(typeof etaaxReporteHeader==='function')?etaaxReporteHeader(subtitulo,_hdrDer):'<div class="cab"><div class="cab-left"><div><div class="neg-nombre">'+estab+'</div><div class="neg-sub">'+subtitulo+'</div></div></div><div class="cab-right"><div>'+_hdrDer+'</div></div></div>';var _ftr=(typeof etaaxReporteFooter==='function')?etaaxReporteFooter(g.emoji+' '+g.label):'<div class="footer"><span>etaax.com · EGMx Consultoría Estratégica a&b</span><strong>'+g.emoji+' '+g.label+'</strong><span>'+fecha+'</span></div>';var pagina='<div class="pagina">'+_hdr+tablaHTML+'<div class="pie-hoja">'+_ftr+'</div></div>';return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>'+subtitulo+' — '+estab+'</title><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"><style>'+CSS+'</style></head><body>'+pagina+'<scr'+'ipt>window.onload=function(){window.print();}<\/scr'+'ipt></body></html>';}


function buildWrapperHTML(paginasHTML, titulo) {
    return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
        '<title>' + titulo + ' — ETAAX</title>' +
        '<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">' +
        '<style>' + CSS_PRINT_BASE + '</style></head><body>' +
        paginasHTML +
        '<scr' + 'ipt>window.onload=function(){window.print();}<\/scr' + 'ipt>' +
        '</body></html>';
}

// ── VERSIÓN OPERATIVA ─────────────────────────────────────────
// Sin costos — ingredientes, procedimiento, foto, cristalería/tiempo al pie


// ── Label de cristalería según tipo de receta ───────────────
function getCristalLabel(tipo) {
    var labels = {
        'alimentos': 'VAJILLA / CRISTALERIA',
        'sub-alimentos': 'Tipo de envasado',
        'bebidas': 'CRISTALERIA / VAJILLA',
        'sub-bebidas': 'Tipo de envasado',
    };
    return labels[tipo] || 'VAJILLA / CRISTALERIA';
}

// ── Chips de info extra para plantillas de impresión ────────
function buildChipsExtra(r) {
    var cx = r.camposExtra || {};
    var chips = [];
    // Bebidas
    if (cx.metodoPre)   chips.push({label:'Método', val: cx.metodoPre});
    if (cx.garnish)     chips.push({label:'Garnish', val: cx.garnish});
    if (cx.rendimientoBebida && cx.unidadRendimientoBebida)
        chips.push({label:'Rendimiento', val: cx.rendimientoBebida + ' ' + cx.unidadRendimientoBebida});
    // Alimentos
    if (cx.porciones)
        chips.push({label:'Rendimiento', val: cx.porciones + (cx.unidadPorcion ? ' ' + cx.unidadPorcion : '')});
    if (cx.temperaturaServicio) chips.push({label:'Temperatura de servicio', val: cx.temperaturaServicio});
    if (cx.acompañamientos && cx.acompañamientos.length)
        chips.push({label:'Acompañamientos', val: cx.acompañamientos.join(', ')});
    if (cx.alergenos && cx.alergenos.length)
        chips.push({label:'Alérgenos', val: cx.alergenos.join(', ')});
    // Sub recetas
    if (cx.rendimientoSub && cx.unidadRendimiento)
        chips.push({label:'Rinde', val: cx.rendimientoSub + ' ' + cx.unidadRendimiento});
    if (cx.vidaUtilNum && cx.vidaUtilUnidad)
        chips.push({label:'Vida útil', val: cx.vidaUtilNum + ' ' + cx.vidaUtilUnidad});
    if (cx.almacenamiento) chips.push({label:'Almacenamiento', val: cx.almacenamiento});

    if (!chips.length) return '';
    return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' +
        chips.map(function(c) {
            var isAlerg = c.label === 'Alérgenos';
            var bg    = isAlerg ? '#fff5f5' : '#f5f5f5';
            var color = isAlerg ? '#c0392b' : '#555';
            var lcolor= isAlerg ? '#e74c3c' : '#aaa';
            return '<span style="font-size:10px;background:'+bg+';border-radius:4px;padding:4px 10px;color:'+color+';' +
                (isAlerg ? 'border:1px solid #f5c6c6;' : '') + '">' +
                '<span style="color:'+lcolor+';letter-spacing:1px;text-transform:uppercase;font-size:9px">' +
                c.label + '&nbsp;</span>' + c.val + '</span>';
        }).join('') + '</div>';
}


// ── Detectar si es sub-receta ────────────────────────────────
function esSubRecetaTipo(tipo) {
    return tipo === 'sub-alimentos' || tipo === 'sub-bebidas';
}

// ── Bloque de info operativa para sub-recetas ────────────────
function buildSubRecetaInfoBlock(r) {
    var cx = r.camposExtra || {};
    var rows = [];
    if (r.tiempo)           rows.push(['Tiempo de elaboración', r.tiempo]);
    if (r.cristaleria)      rows.push([getCristalLabel(r.tipo), r.cristaleria]);
    if (cx.vidaUtilNum && cx.vidaUtilUnidad) rows.push(['Vida útil', cx.vidaUtilNum + ' ' + cx.vidaUtilUnidad]);
    if (cx.almacenamiento)  rows.push(['Almacenamiento', cx.almacenamiento]);
    if (cx.rendimientoFinal && cx.unidadRendimientoFinal)
        rows.push(['Rendimiento final', cx.rendimientoFinal + ' ' + cx.unidadRendimientoFinal]);
    
    // Calcular % merma si hay rendimiento final
    if (cx.rendimientoFinal && cx.unidadRendimientoFinal) {
        var fU = { G:1, KG:1000, ML:1, LT:1000 };
        var costoTotal = (r.ingredientes||[]).reduce(function(s,i){ return s + getFactor(i.cantidad,i.unidad)*costoUnitEfectivo(i); }, 0);
        var sumaBase = (r.ingredientes||[]).reduce(function(s,i){
            return s + i.cantidad * getPesoBrutoPorUnidad(i);
        }, 0);
        var rendBase = parseFloat(cx.rendimientoFinal) * (fU[cx.unidadRendimientoFinal.toUpperCase()]||1);
        if (sumaBase > 0 && rendBase > 0) {
            var merma = ((sumaBase - rendBase) / sumaBase * 100);
            if (merma > 0) rows.push(['% Merma', merma.toFixed(1) + '%']);
        }
    }
    // Porciones
    if (cx.porcionesQty && cx.porcionesUnidad)
        rows.push(['Rendimiento', cx.porcionesQty + ' ' + cx.porcionesUnidad]);
    // Peso por porción: valor directo (fila 2) o calculado auto (fila 1)
    if (cx.pesoPorcion && cx.unidadPesoPorcion) {
        rows.push(['Peso por porción', cx.pesoPorcion + ' ' + cx.unidadPesoPorcion]);
    } else if (cx.porcionesQty && cx.rendimientoFinal && cx.unidadRendimientoFinal) {
        var fU2p = { G:1, KG:1000, ML:1, LT:1000 };
        var rBaseP  = parseFloat(cx.rendimientoFinal) * (fU2p[(cx.unidadRendimientoFinal||'G').toUpperCase()]||1);
        var pesoAP  = rBaseP / parseFloat(cx.porcionesQty);
        var uFinalP = (cx.unidadRendimientoFinal||'G').toUpperCase();
        var uDispP  = (cx.unidadPesoAutoDisplay || (uFinalP==='ML'||uFinalP==='LT' ? 'ML' : 'G')).toUpperCase();
        var pesoDP  = (uDispP==='KG'||uDispP==='LT') ? pesoAP/1000 : pesoAP;
        rows.push(['Peso por porción', (uDispP==='KG'||uDispP==='LT' ? pesoDP.toFixed(3) : String(parseFloat(pesoDP.toFixed(1)))) + ' ' + uDispP]);
    }

    if (!rows.length) return '';
    return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #efefef">' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
        rows.map(function(r2) {
            return '<span style="font-size:10px;background:#f5f5f5;border-radius:4px;padding:5px 12px;color:#555">' +
                '<span style="color:#888;letter-spacing:1px;text-transform:uppercase;font-size:9px">' +
                r2[0] + '&nbsp;</span>' + r2[1] + '</span>';
        }).join('') + '</div></div>';
}

// ── Bloque de costos para sub-recetas administrativo ─────────
function buildSubRecetaCostoBlock(r) {
    var cx = r.camposExtra || {};
    var costoTotal = (r.ingredientes||[]).reduce(function(s,i){ return s + costoIngredienteVivo(i); }, 0);
    if (!costoTotal) return '';

    var fU = { G:0.001, KG:1, ML:0.001, LT:1 };
    var rendFinal   = parseFloat(cx.rendimientoFinal) || 0;
    var unidadFinal = (cx.unidadRendimientoFinal || 'KG').toUpperCase();
    var rendFinalKg = rendFinal > 0 ? rendFinal * (fU[unidadFinal]||0.001) : 0;
    var esLiq = unidadFinal === 'ML' || unidadFinal === 'LT';
    var costoXkg = rendFinalKg > 0 ? costoTotal / rendFinalKg : 0;
    var costoXg  = rendFinalKg > 0 ? costoTotal / (rendFinalKg * 1000) : 0;
    var porcionQty = parseFloat(cx.porcionesQty) || 0;
    // Si no hay porcionesQty, calcular desde pesoPorcion
    if (!porcionQty && cx.pesoPorcion && cx.unidadPesoPorcion && rendFinalKg > 0) {
        var fU2 = { G:1, KG:1000, ML:1, LT:1000 };
        var pesoPorzBase = parseFloat(cx.pesoPorcion) * (fU2[(cx.unidadPesoPorcion||'G').toUpperCase()]||1);
        var rendBaseG    = rendFinalKg * 1000;
        porcionQty = pesoPorzBase > 0 ? Math.floor(rendBaseG / pesoPorzBase) : 0;
    }
    var costoPorcion = porcionQty > 0 ? costoTotal / porcionQty : 0;

    var html = '<div style="border-top:2px solid #3dbe7a;margin-top:14px;padding-top:12px">' +
        '<div class="sec-title" style="margin-bottom:12px">Costeo de la Sub Receta</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
            '<div style="background:#fafafa;border:1px solid #3dbe7a;border-radius:8px;padding:14px">' +
                '<div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#3dbe7a;margin-bottom:10px">💰 Costo Final</div>' +
                '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #eee;font-size:11px"><span style="color:#666">Costo total ingredientes</span><span style="font-weight:700;color:#1a1916">$' + costoTotal.toFixed(2) + '</span></div>' +
                (rendFinal > 0 ? (function(){
                    var fUM = { G:1, KG:1000, ML:1, LT:1000 };
                    var sumaBaseM = (r.ingredientes||[]).reduce(function(s,i){
                        return s + i.cantidad * getPesoBrutoPorUnidad(i);
                    }, 0);
                    var rendBaseM = rendFinal * (fUM[unidadFinal]||1);
                    var mermaM = (sumaBaseM > 0 && rendBaseM > 0) ? Math.max(0,(sumaBaseM-rendBaseM)/sumaBaseM*100) : 0;
                    var mermaRow = mermaM > 0
                        ? '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #eee;font-size:11px"><span style="color:#666">% Merma</span><span style="font-weight:600;color:'+(mermaM>30?'#e05a3a':mermaM>15?'#f5c842':'#3dbe7a')+'">'+mermaM.toFixed(1)+'%</span></div>'
                        : '';
                    return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #eee;font-size:11px"><span style="color:#666">Rendimiento final</span><span style="font-weight:600">' + rendFinal + ' ' + unidadFinal + '</span></div>' +
                        mermaRow +
                        '<div style="display:flex;justify-content:space-between;padding:7px 8px;margin-top:4px;background:#f0faf5;border-radius:4px;font-size:11px"><span style="font-weight:700;color:#333">Costo / ' + (esLiq?'LT':'KG') + ' (con merma)</span><span style="font-weight:700;color:#3dbe7a">$' + costoXkg.toFixed(2) + '</span></div>' +
                        '<div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:10px;color:#888"><span>' + (esLiq?'Costo / ML':'Costo / G') + '</span><span>$' + costoXg.toFixed(4) + '</span></div>';
                })() : '') +
            '</div>' +
            '<div style="background:#fafafa;border:1px solid #f5c842;border-radius:8px;padding:14px">' +
                '<div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#f5c842;margin-bottom:10px">⚖️ Costo por Porción</div>' +
                (costoPorcion > 0 ? (function(){
                    var pesoRow = '';
                    if (cx.pesoPorcion && cx.unidadPesoPorcion) {
                        pesoRow = '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #eee;font-size:11px"><span style="color:#666">Peso por porción</span><span style="font-weight:600">' + cx.pesoPorcion + ' ' + cx.unidadPesoPorcion + '</span></div>';
                    } else if (cx.porcionesQty && rendFinal > 0) {
                        var fU2p = {G:1,KG:1000,ML:1,LT:1000};
                        var rBaseP = rendFinal * (fU2p[unidadFinal]||1);
                        var pesoAP = rBaseP / parseFloat(cx.porcionesQty);
                        var uDispP = (cx.unidadPesoAutoDisplay || (esLiq?'ML':'G')).toUpperCase();
                        var pesoDP = (uDispP==='KG'||uDispP==='LT') ? pesoAP/1000 : pesoAP;
                        pesoRow = '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #eee;font-size:11px"><span style="color:#666">Peso por porción</span><span style="font-weight:600">' + (uDispP==='KG'||uDispP==='LT' ? pesoDP.toFixed(3) : String(parseFloat(pesoDP.toFixed(1)))) + ' ' + uDispP + '</span></div>';
                    }
                    return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #eee;font-size:11px"><span style="color:#666">Porciones totales</span><span style="font-weight:600">' + porcionQty + '</span></div>' +
                        pesoRow +
                        '<div style="display:flex;justify-content:space-between;padding:7px 8px;margin-top:4px;background:#fff8e1;border-radius:4px;font-size:12px"><span style="font-weight:700;color:#333">Costo / porción</span><span style="font-weight:700;color:#f5c842">$' + costoPorcion.toFixed(2) + '</span></div>';
                })() : '<div style="font-size:10px;color:#aaa;padding:16px 0;text-align:center">Agrega porciones en el escandallo</div>') +
            '</div>' +
        '</div></div>';
    return html;
}

function buildPlantillaOperativa(recetas) {
    var paginasHTML = recetas.map(function(r) {
        var esSub = esSubRecetaTipo(r.tipo);
        var numIng = (r.ingredientes||[]).length;
        var sizeClass = numIng > 13 ? 'mini' : numIng > 7 ? 'compact' : '';
        var filas = (r.ingredientes||[]).map(function(i) {
            return '<tr>' +
                '<td style="border-bottom:1px solid #efefef">' + (i.nombre||'—') + '</td>' +
                '<td style="border-bottom:1px solid #efefef;text-align:center;color:#555">' + (i.desc||'—') + '</td>' +
                '<td style="border-bottom:1px solid #efefef;text-align:center;font-weight:600">' + i.cantidad + '</td>' +
                '<td style="border-bottom:1px solid #efefef;text-align:center;color:#888">' + i.unidad + '</td>' +
            '</tr>';
        }).join('');

        var fotos = r.fotos && r.fotos.length ? r.fotos : (r.foto && r.foto.startsWith('data:') ? [r.foto] : []);
        // Reparto: hasta 4 por renglón; con 1, 2 o 3 fotos cada una toma la parte
        // proporcional del ancho libre (no un tamaño fijo). Con 5+ se acomodan en
        // renglones de 4 y el bloque crece hacia abajo.
        var _porFila = Math.min(fotos.length, 4);
        var _anchoFoto = _porFila > 0
            ? 'calc((100% - ' + ((_porFila - 1) * 8) + 'px) / ' + _porFila + ')'
            : '100%';
        var fotoHTML = fotos.length
            ? '<div class="fotos-imp">' +
              fotos.map(function(src) {
                  return '<div class="foto-cell" style="flex:1 1 ' + _anchoFoto + ';max-width:' + _anchoFoto + '">' +
                         '<img src="' + src + '"></div>';
              }).join('') +
              '</div>'
            : '';

        // Título: sub-recetas muestran tipo + grupo
        var tipoLabel = r.tipo === 'sub-alimentos' ? 'Sub Receta Alimentos'
                      : r.tipo === 'sub-bebidas'   ? 'Sub Receta Bebidas'
                      : '';
        var recetaTipoLine = esSub
            ? (tipoLabel + (r.grupo ? ' · ' + r.grupo : ''))
            : ((r.grupo||'') + (r.categoria?' · '+r.categoria:''));

        var infoBlock = esSub ? buildSubRecetaInfoBlock(r) : (
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid #efefef">' +
                (r.cristaleria ? '<span style="font-size:10px;background:#f5f5f5;border-radius:4px;padding:5px 12px;color:#555"><span style="color:#888;letter-spacing:1px;text-transform:uppercase;font-size:9px">' + getCristalLabel(r.tipo) + '&nbsp;</span>' + r.cristaleria + '</span>' : '') +
                (r.tiempo      ? '<span style="font-size:10px;background:#f5f5f5;border-radius:4px;padding:5px 12px;color:#555"><span style="color:#888;letter-spacing:1px;text-transform:uppercase;font-size:9px">Tiempo de elaboración&nbsp;</span>' + r.tiempo + '</span>' : '') +
            '</div>' + buildChipsExtra(r)
        );

        return '<div class="pagina">' +
            '<div class="header-imp">' +
                '<div class="header-left">' +
                    '<div>' + LOGO_SVG_PRINT + '</div>' +
                    '<div>' +
                        '<div class="receta-tipo">' + recetaTipoLine + '</div>' +
                        '<div class="receta-nombre' + (sizeClass?' '+sizeClass:'') + '">' + r.nombre + '</div>' +
                    '</div>' +
                '</div>' +
                _recetaHeaderMarca() +
            '</div>' +
            '<div class="body-imp' + (sizeClass?' '+sizeClass:'') + '">' +
                '<div class="sec-title">Ingredientes</div>' +
                '<table class="tabla-ing' + (sizeClass?' '+sizeClass:'') + '">' +
                    '<thead><tr style="background:#f8f8f8">' +
                        '<th style="font-weight:600;color:#666;text-transform:uppercase;letter-spacing:1px;text-align:left">Ingrediente</th>' +
                        '<th style="font-weight:600;color:#666;text-transform:uppercase;letter-spacing:1px;text-align:center">Descripción</th>' +
                        '<th style="font-weight:600;color:#666;text-transform:uppercase;letter-spacing:1px;text-align:center">Cant.</th>' +
                        '<th style="font-weight:600;color:#666;text-transform:uppercase;letter-spacing:1px;text-align:center">Unidad</th>' +
                    '</tr></thead>' +
                    '<tbody>' + filas + '</tbody>' +
                '</table>' +
                (r.procedimiento ? (
                    '<div class="sec-title" style="margin-top:4px">Procedimiento</div>' +
                    '<p style="font-size:11px;color:#444;line-height:1.8;text-align:justify">' + r.procedimiento + '</p>'
                ) : '') +
                fotoHTML +
                infoBlock +
            '</div>' +
            '<div class="footer-imp">' +
                '<span>etaax.com</span>' +
                '<span style="color:#3dbe7a;font-weight:600">' + r.nombre + '</span>' +
                '<span>EGMx Consultoría Estratégica a&b</span>' +
            '</div>' +
        '</div>';
    }).join('');

    return buildWrapperHTML(paginasHTML, 'Receta Operativa');
}

// Bloque DERECHO del encabezado de la hoja de receta: identidad del negocio
// automática desde reporte-marca.js. Logo GRANDE = marca base (ajustes del
// negocio); la sucursal se distingue con su PUNTITO de color junto al nombre.
function _recetaHeaderMarca() {
    if (typeof etaaxMarca !== 'function') return '';
    var m = etaaxMarca();
    if (!m.negocio && !m.logo) return '';
    var _dot = (m.sucursal && m.sucursalColor)
        ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + etx(m.sucursalColor) + ';margin-right:4px;vertical-align:middle"></span>'
        : '';
    // Logo con la MISMA jerarquía que los reportes financieros (etaaxMarca):
    // el de la SUCURSAL activa si lo tiene → si no, el del NEGOCIO → si no,
    // el emoji. Antes esto leía `logoNegocio` a secas, así que una sucursal con
    // marca propia (Tata, Mammut…) imprimía sus recetas sin logo.
    return '<div style="display:flex;align-items:center;gap:10px;flex-shrink:0">' +
        (!m.logo && m.emoji ? '<span style="font-size:20px;line-height:1">' + m.emoji + '</span>' : '') +
        '<div style="text-align:right">' +
            '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:17px;letter-spacing:1px;color:#1a1916;line-height:1">' + etx(m.negocio || '') + '</div>' +
            (m.sucursal ? '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#999;margin-top:3px">' + _dot + etx(m.sucursal) + '</div>' : '') +
        '</div>' +
        (m.logo ? '<img src="' + m.logo + '" style="width:40px;height:40px;object-fit:contain;border:1px solid #eee;border-radius:6px;background:#fff" alt="logo">' : '') +
    '</div>';
}

// ── VERSIÓN ADMINISTRATIVA ────────────────────────────────────
// Con costos completos — misma estructura + columna costo + bloque costeo
function buildPlantillaAdministrativa(recetas) {
    var paginasHTML = recetas.map(function(r) {
        var esSub = esSubRecetaTipo(r.tipo);
        var chipsExtra = esSub ? '' : buildChipsExtra(r);
        var costo = (r.ingredientes||[]).reduce(function(s,i) {
            return s + costoIngredienteVivo(i);
        }, 0);
        var _sug         = EtaaxCore.costeoReceta(costo, r);   // múltiplo propio de la receta
        var sPlatillo    = _sug.platillo;
        var sComedor     = _sug.comedor;
        var sDelivery    = _sug.delivery;
        var precioEnCarta = parseFloat(r.precioEnCarta) || 0;
        var aSinIva      = precioEnCarta > 0 ? precioEnCarta / 1.16 : 0;
        var aCostoP      = aSinIva > 0 ? (costo/aSinIva)*100 : 0;
        var aUtilidadP   = aSinIva > 0 ? 100 - aCostoP - 40 : 0;

        var numIng = (r.ingredientes||[]).length;
        var sizeClass = numIng > 13 ? 'mini' : numIng > 7 ? 'compact' : '';
        var filas = (r.ingredientes||[]).map(function(i) {
            var cuUnit = costoUnitVivo(i);
            var cu = getFactor(i.cantidad,i.unidad)*cuUnit;
            // Reference unit cost label ($/kg, $/lt, $/pz)
            var uRef = i.unidad;
            var refLabel = '$/pz';
            if(['G','KG'].indexOf((uRef||'').toUpperCase())>=0) refLabel='$/kg';
            else if(['ML','LT'].indexOf((uRef||'').toUpperCase())>=0) refLabel='$/lt';
            var refVal = cuUnit > 0
                ? '<span style="color:#999;font-size:9px">'+refLabel+'&nbsp;</span>$' + cuUnit.toFixed(2)
                : '<span style="color:#ccc">—</span>';
            return '<tr>' +
                '<td style="border-bottom:1px solid #efefef">' + (i.nombre||'—') + '</td>' +
                '<td style="border-bottom:1px solid #efefef;text-align:center;color:#555">' + (i.desc||'—') + '</td>' +
                '<td style="border-bottom:1px solid #efefef;text-align:center;font-weight:600">' + i.cantidad + '</td>' +
                '<td style="border-bottom:1px solid #efefef;text-align:center;color:#888">' + i.unidad + '</td>' +
                '<td style="border-bottom:1px solid #efefef;text-align:right;color:#999">' + refVal + '</td>' +
                '<td style="border-bottom:1px solid #efefef;text-align:right;color:#3dbe7a;font-weight:600">$' + cu.toFixed(2) + '</td>' +
            '</tr>';
        }).join('');

        var costoTotalRow = '<tr style="background:#fafafa"><td colspan="5" style="padding:6px 7px;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#333">Costo total</td>' +
            '<td style="padding:6px 7px;text-align:right;font-weight:700;font-size:15px;color:#1a1916">$' + costo.toFixed(2) + '</td></tr>';

        var bloquesSugerido =
            '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:11px"><span style="color:#666">Precio sugerido comedor</span><span style="font-weight:700;color:#f5c842">$' + sComedor.toFixed(2) + '</span></div>' +
            '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px"><span style="color:#666">Precio sugerido delivery</span><span style="font-weight:700;color:#f5c842">$' + sDelivery.toFixed(2) + '</span></div>';

        var bloquesAplicado = precioEnCarta > 0
            ? '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:11px"><span style="color:#666">Precio en carta (IVA inc.)</span><span style="font-weight:700;color:#3dbe7a">$' + precioEnCarta.toFixed(2) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:11px"><span style="color:#666">Costo bruto %</span><span style="font-weight:700;color:' + (aCostoP<=32?'#3dbe7a':aCostoP<=45?'#f5c842':'#e05a3a') + '">' + aCostoP.toFixed(1) + '%</span></div>' +
              '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px"><span style="color:#666">Utilidad neta %</span><span style="font-weight:700;color:' + (aUtilidadP>=25?'#3dbe7a':aUtilidadP>=10?'#f5c842':'#e05a3a') + '">' + aUtilidadP.toFixed(1) + '%</span></div>'
            : '<div style="font-size:10px;color:#aaa;padding:8px 0">Sin precio en carta registrado</div>';

        var chipsExtra = buildChipsExtra(r);
        return '<div class="pagina">' +
            '<div class="header-imp">' +
                '<div class="header-left">' +
                    '<div>' + LOGO_SVG_PRINT + '</div>' +
                    '<div>' +
                        '<div class="receta-tipo">' + (esSub
                            ? (r.tipo==='sub-alimentos'?'Sub Receta Alimentos':'Sub Receta Bebidas') + (r.grupo?' · '+r.grupo:'')
                            : (r.grupo||'') + (r.categoria?' · '+r.categoria:'')) + '</div>' +
                        '<div class="receta-nombre' + (sizeClass?' '+sizeClass:'') + '">' + r.nombre + '</div>' +
                    '</div>' +
                '</div>' +
                _recetaHeaderMarca() +
            '</div>' +
            '<div class="body-imp' + (sizeClass?' '+sizeClass:'') + '">' +
                '<div class="sec-title">Ingredientes</div>' +
                '<table class="tabla-ing' + (sizeClass?' '+sizeClass:'') + '">' +
                    '<thead><tr style="background:#f8f8f8">' +
                        '<th style="font-weight:600;color:#666;text-transform:uppercase;letter-spacing:1px;text-align:left">Ingrediente</th>' +
                        '<th style="font-weight:600;color:#666;text-transform:uppercase;letter-spacing:1px;text-align:center">Descripción</th>' +
                        '<th style="font-weight:600;color:#666;text-transform:uppercase;letter-spacing:1px;text-align:center">Cant.</th>' +
                        '<th style="font-weight:600;color:#666;text-transform:uppercase;letter-spacing:1px;text-align:center">Unidad</th>' +
                        '<th style="font-weight:600;color:#999;text-transform:uppercase;letter-spacing:1px;text-align:right">Precio ref.</th>' +
                        '<th style="font-weight:600;color:#666;text-transform:uppercase;letter-spacing:1px;text-align:right">Costo</th>' +
                    '</tr></thead>' +
                    '<tbody>' + filas + '</tbody>' +
                    '<tfoot>' + costoTotalRow + '</tfoot>' +
                '</table>' +
                (r.procedimiento ? (
                    '<div class="sec-title" style="margin-top:6px">Procedimiento</div>' +
                    '<p style="font-size:11px;color:#444;line-height:1.8;text-align:justify">' + r.procedimiento + '</p>'
                ) : '') +
'' +
                (!esSub ? ('<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid #efefef">' +
                    (r.cristaleria ? '<span style="font-size:10px;background:#f5f5f5;border-radius:4px;padding:5px 12px;color:#555"><span style="color:#888;letter-spacing:1px;text-transform:uppercase;font-size:9px">' + getCristalLabel(r.tipo) + '&nbsp;</span>' + r.cristaleria + '</span>' : '') +
                    (r.tiempo ? '<span style="font-size:10px;background:#f5f5f5;border-radius:4px;padding:5px 12px;color:#555"><span style="color:#888;letter-spacing:1px;text-transform:uppercase;font-size:9px">Tiempo de elaboración&nbsp;</span>' + r.tiempo + '</span>' : '') +
                '</div>') : '') +
                (esSub ? buildSubRecetaInfoBlock(r) : chipsExtra) +
                (esSub ? buildSubRecetaCostoBlock(r) : (function(){
                    var R = '<div class="costeo-block" style="border-top:2px solid #3dbe7a;margin-top:10px;padding-top:8px">';
                    R += '<div class="sec-title" style="margin-bottom:6px">Costeo</div>';
                    // row: helper
                    function cr(lbl,val,bold,color){
                        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #f5f5f5;font-size:9.5px">'
                            +'<span style="color:#666">'+lbl+'</span>'
                            +'<span style="font-weight:'+(bold?'700':'500')+';color:'+(color||'#333')+'">'+val+'</span>'
                            +'</div>';
                    }
                    function priceRow(lbl,val,bg,color){
                        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;margin-top:3px;border-radius:4px;background:'+bg+';font-size:10px">'
                            +'<span style="font-weight:700;color:#333">'+lbl+'</span>'
                            +'<span style="font-weight:700;color:'+color+'">'+val+'</span>'
                            +'</div>';
                    }
                    R += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
                    // SUGERIDO
                    R += '<div style="background:#fafafa;border:1px solid #f5c842;border-radius:6px;padding:8px 10px">';
                    R += '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#f5c842;margin-bottom:5px">📐 Costeo Sugerido</div>';
                    var _p1 = function(v){ return (Math.round(v*10)/10).toFixed(1).replace(/\.0$/,''); };
                    R += cr('Costo Bruto '+_p1(_sug.brutoPct)+'%','$'+costo.toFixed(2),true,'#c8960a');
                    R += cr('Gasto Operativo '+_p1(_sug.gastoOpPct)+'%','$'+_sug.gastoOp.toFixed(2),false);
                    R += cr('Utilidad Neta '+_p1(_sug.utilidadPct)+'%','$'+_sug.utilidad.toFixed(2),false);
                    R += cr('Precio platillo','$'+sPlatillo.toFixed(2),false,'#555');
                    R += cr('+ IVA 16%','$'+_sug.iva.toFixed(2),false,'#888');
                    R += priceRow('Precio Comedor 116%','$'+sComedor.toFixed(2),'#fff8e1','#c8960a');
                    R += '</div>';
                    // APLICADO
                    R += '<div style="background:#fafafa;border:1px solid #3dbe7a;border-radius:6px;padding:8px 10px">';
                    R += '<div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#3dbe7a;margin-bottom:5px">💳 Costeo Aplicado</div>';
                    if(precioEnCarta > 0){
                        R += '<div style="font-size:13px;font-weight:700;color:#1a1916;margin-bottom:4px">$'+precioEnCarta.toFixed(2)+'<span style="font-size:8px;color:#888;font-weight:400;margin-left:4px">con IVA</span></div>';
                        R += cr('Precio sin IVA','$'+aSinIva.toFixed(2),false,'#555');
                        R += cr('Costo Bruto','<span style="color:'+(aCostoP<=32?'#3dbe7a':aCostoP<=45?'#c8960a':'#e05a3a')+'">'+aCostoP.toFixed(1)+'%</span>  $'+costo.toFixed(2),false);
                        R += cr('Gasto Operativo 40%','$'+(aSinIva*0.40).toFixed(2),false);
                        R += cr('Utilidad Neta','<span style="color:'+(aUtilidadP>=25?'#3dbe7a':aUtilidadP>=10?'#c8960a':'#e05a3a')+'">'+aUtilidadP.toFixed(1)+'%</span>  $'+(aSinIva*(aUtilidadP/100)).toFixed(2),false);
                        R += cr('IVA incluido 16%','$'+(precioEnCarta-aSinIva).toFixed(2),false,'#888');
                        R += priceRow('Precio Comedor','$'+precioEnCarta.toFixed(2),'#f0faf5','#3dbe7a');
                    } else {
                        R += '<div style="font-size:10px;color:#aaa;padding:12px 0;text-align:center">Sin precio en carta registrado</div>';
                    }
                    R += '</div>';
                    R += '</div></div>';
                    return R;
                })()) +
            '</div>' +
            '<div class="footer-imp">' +
                '<span>etaax.com</span>' +
                '<span style="color:#3dbe7a;font-weight:600">' + r.nombre + '</span>' +
                '<span>EGMx Consultoría Estratégica a&b</span>' +
            '</div>' +
        '</div>';
    }).join('');

    return buildWrapperHTML(paginasHTML, 'Receta Administrativa');
}

// Mantener compatibilidad — por defecto usa administrativa
function buildPlantillaHTML(recetas) {
    return buildPlantillaAdministrativa(recetas);
}

// Helpers de impresión
function abrirVentanaImpresion(html) {
    var win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
}


// ── Catálogo de insumos ──────────────────────────────────────
function getCatalogoInsumos() {
    try { return JSON.parse(_skGet('insumos')) || []; }
    catch { return []; }
}
// Resolver para la etiqueta canónica (insumo-label.js): id → insumo del catálogo.
// Cachea por FIRMA del localStorage (no por longitud): si cambia el PRECIO de un
// insumo sin cambiar la cantidad de registros, igual se reconstruye el índice.
// (El bug viejo comparaba solo `_n!==a.length` → quedaba stale ante cambios de precio.)
// Usa la fábrica compartida (insumo-label.js). Fuente: getCatalogoInsumos (localStorage
// 'insumos'); firma: el string crudo del localStorage → se reindexa al cambiar precios.
window._insumoResolver = window._makeInsumoResolver(getCatalogoInsumos, function(){ try{ return _skGet('insumos')||''; }catch(e){ return ''; } });

// Costo POR unidad (kg/lt/pza) VIVO de un ingrediente vinculado: se recalcula
// desde el insumo ACTUAL del catálogo, evitando el "drift" de costos congelados
// en listas/carátulas/reportes (antes solo se refrescaba al abrir la receta).
// Si el ingrediente NO está vinculado a un insumo, respeta el costo manual guardado.
function costoUnitVivo(ing) {
    if (ing && ing.insumoId && typeof window._insumoResolver === 'function') {
        var ins = window._insumoResolver(ing.insumoId);
        if (ins) return _redondeaCosto(getCostoParaUnidad(ins, ing.unidad));
    }
    return costoUnitEfectivo(ing);
}
// Costo total (línea) de un ingrediente: su cantidad × costo/unidad VIVO.
function costoIngredienteVivo(ing) {
    return getFactor(ing.cantidad, ing.unidad) * costoUnitVivo(ing);
}

// Catálogo acotado a la SUCURSAL donde se trabaja (regla "sin sucursal = matriz").
// El escandallo de una sucursal solo debe ofrecer SUS insumos, no los de todo el
// negocio. En modo catálogo global (o sin sucursal activa) devuelve todo.
function getCatalogoInsumosScope() {
    var cat = getCatalogoInsumos();
    // Inactivos GLOBALES fuera SIEMPRE (una receta no debe usar un insumo dado de baja).
    cat = cat.filter(function(x){ return x && x.activo !== '0'; });
    var catGlobal = false;
    try { catGlobal = sessionStorage.getItem('etaax_cat_global') === '1'; } catch(e) {}
    // Catálogo GLOBAL: no hay sucursal, así que el representante es el MAESTRO.
    // (Esta salida anticipada se saltaba el colapso de copias: por eso el
    // buscador seguía mostrando el mismo insumo una vez por sucursal.)
    if (catGlobal) return _unoPorProducto(cat, true);
    var sucActiva = localStorage.getItem('etaax_sucursal_activa') || '';
    if (sucActiva) {
        // Visibilidad por sucursal: vive aquí + no pausado aquí (regla única, insumo-label.js).
        cat = cat.filter(function(x){ return (typeof window._insumoActivoEnSuc === 'function')
            ? window._insumoActivoEnSuc(x, sucActiva)
            : ((x.sucursalId || 'suc_principal') === sucActiva); });
    }
    return _unoPorProducto(cat);
}

/* Un renglón por PRODUCTO, no por copia ────────────────────────────────
   Al independizar los insumos por sucursal, cada producto queda como un
   maestro + una copia por sucursal. Todas comparten `origenId`, así que el
   buscador de ingredientes mostraba el mismo Disaronno cuatro veces y no había
   forma de saber cuál elegir. Se colapsa por id canónico y se deja el que
   aplica al contexto (la copia de la sucursal activa; si no, el maestro).
   OJO: dos insumos DISTINTOS con el mismo nombre siguen apareciendo los dos —
   eso no son copias, son duplicados del catálogo y hay que arreglarlos ahí. */
function _unoPorProducto(cat, preferirMaestro) {
    var porK = {}, orden = [];
    (cat || []).forEach(function (x) {
        if (!x || !x.id) return;
        var k = x.origenId || x.id;
        if (!porK[k]) { porK[k] = []; orden.push(k); }
        porK[k].push(x);
    });
    return orden.map(function (k) {
        var grupo = porK[k];
        // En el catálogo global mandamos el maestro (el que NO es copia); en una
        // sucursal, el resolver devuelve la copia que aplica ahí.
        var maestro = grupo.find(function (x) { return !x.origenId; });
        if (preferirMaestro) return maestro || grupo[0];
        return (typeof window._insumoResolver === 'function' && window._insumoResolver(k)) || maestro || grupo[0];
    });
}

// Devuelve el contenido real en ml/g de 1 pieza de un insumo.
// Busca la presentación más relevante: primero la que tiene umContenido != PZA
// (porque contNeto está en ML/G), luego cualquiera con contNeto > 0.
// Devuelve 0 si no hay datos suficientes.
function getContenidoPorPieza(insumoId) {
    if (!insumoId) return 0;
    const ins = getCatalogoInsumos().find(x => x.id === insumoId);
    if (!ins) return 0;
    const pres = ins.presentaciones || [];
    if (!pres.length) return 0;

    const OZ_ML = 29.5735;
    const factorToML = { ML:1, LT:1000, G:1, KG:1000, OZ:OZ_ML, PZA:0, CARGA:0, PORCION:0 };

    // Buscar presentación con contenido medible (ML/G/LT/KG/OZ)
    for (var k = 0; k < pres.length; k++) {
        var p = pres[k];
        var cont = parseFloat(p.contNeto) || 0;
        var um   = (p.umContenido || 'ML').toUpperCase();
        var f    = factorToML[um];
        if (cont > 0 && f > 0) return cont * f; // en ml o g
    }
    return 0;
}

function getCostoParaUnidad(insumo, unidadEscandallo) {
    const pres = insumo.presentaciones || [];
    const umEs = (unidadEscandallo || 'ML').toUpperCase();
    // Sub-recetas: tienen UNA presentación por cada rendimiento (granel KG/LT y por
    // porción PZA). Usar la que COINCIDE con la unidad seleccionada → su costoUnitario
    // directo. Ej. PZA → costo por porción ($4.67), NO el costo de toda la tanda.
    if (insumo.esSubReceta) {
        // PZA y PORCION son equivalentes (ambos = rendimiento por porción de la sub-receta).
        const _grp = function(u){ u = (u||'').toUpperCase(); return (u === 'PZA' || u === 'PORCION') ? 'POR' : u; };
        const pM = pres.find(function(x){
            return _grp(x.umContenido) === _grp(umEs) || _grp(x.umCosto) === _grp(umEs);
        });
        if (pM) {
            const cuM = parseFloat(pM.costoUnitario) || parseFloat(pM.precio) || 0;
            if (cuM > 0) return cuM;
        }
    }
    const p   = pres[0];
    if (!p) return 0;
    const cu   = parseFloat(p.costoUnitario) || parseFloat(p.precio) || 0;
    if (!cu) return 0;
    const umCu = (p.umCosto || 'LT').toUpperCase();
    const OZ_ML = 29.5735;

    // getFactor() divide ML y G entre 1000, y devuelve directamente PZA/CARGA/LT/KG/OZ
    // Por eso costoPorKgLt debe estar en la misma escala:
    //   ML/LT → devolver $/LT  (getFactor divide ml/1000 → necesita $/LT)
    //   G/KG  → devolver $/KG  (getFactor divide g/1000  → necesita $/KG)
    //   PZA/CARGA/PORCION/OZ → devolver $/unidad

    // Primero normalizar cu a $/LT (base)
    var cuPorLt;
    if (umCu === 'LT')  cuPorLt = cu;
    else if (umCu === 'ML')  cuPorLt = cu * 1000;
    else if (umCu === 'KG')  cuPorLt = cu;        // densidad ≈1 para líquidos
    else if (umCu === 'G')   cuPorLt = cu * 1000;
    else if (umCu === 'OZ')  cuPorLt = cu * (1000 / OZ_ML);
    else {
        // umCosto PZA/CARGA/PORCION = $/unidad. Si el escandallo pide PESO o
        // VOLUMEN, derivar $/LT-KG del contenido real de la pieza — antes el
        // precio de la pieza COMPLETA se usaba como si fuera $/kg-lt.
        cuPorLt = cu;
        if (['ML','LT','G','KG','OZ'].indexOf(umEs) >= 0) {
            const _cont = parseFloat(p.contNeto) || 0;
            const _umC2 = (p.umContenido || 'ML').toUpperCase();
            const _toLt2 = { ML: 1/1000, LT: 1, G: 1/1000, KG: 1, OZ: OZ_ML/1000 };
            const _enLt2 = _cont * (_toLt2[_umC2] || 1/1000);
            if (_enLt2 > 0) cuPorLt = cu / _enLt2;
        }
    }

    // Para unidades de escandallo que getFactor divide entre 1000 → necesitan $/LT o $/KG
    if (umEs === 'ML' || umEs === 'LT') return cuPorLt;       // $/LT
    if (umEs === 'G'  || umEs === 'KG') return cuPorLt;       // $/KG (densidad ≈1)
    if (umEs === 'OZ') return cuPorLt * (OZ_ML / 1000);       // $/OZ → getFactor devuelve oz directo
    // PZA → costo de la pieza completa (botella, lata, huevo, etc.)
    if (umEs === 'PZA') {
        // 1. Si ya tenemos costoPieza calculado (refrescos/cervezas), usarlo directo
        const costoPiezaCalc = parseFloat(p.costoPieza);
        if (costoPiezaCalc > 0) return costoPiezaCalc;

        // 1b. El costo ya está POR PIEZA (umCosto PZA/CARGA/PORCION): directo —
        // antes caía al paso 2 y multiplicaba $/pza × litros (daba centavos).
        if (umCu === 'PZA' || umCu === 'CARGA' || umCu === 'PORCION') return cu;

        // 2. Destilados/vinos/licores: costoUnitario ($/LT) × contenido en LT
        const contNeto = parseFloat(p.contNeto) || 0;
        const umCont   = (p.umContenido || 'ML').toUpperCase();
        const toTL = { ML: 1/1000, LT: 1, G: 1/1000, KG: 1, OZ: OZ_ML/1000 };
        const contEnLt = contNeto * (toTL[umCont] || 1/1000);
        if (cuPorLt > 0 && contEnLt > 0) return cuPorLt * contEnLt;

        // 3. Fallback: precio de compra directo
        return parseFloat(p.precio) || 0;
    }

    // PORCION: si el insumo es líquido (umCosto LT o ML) = 1 OZ
    if (umEs === 'PORCION') {
        if (umCu === 'LT' || umCu === 'ML') {
            return cuPorLt * (OZ_ML / 1000); // $/OZ
        }
        return parseFloat(p.precio) || cu;
    }

    // CARGA → precio directo de compra
    if (umEs === 'CARGA') {
        return parseFloat(p.precio) || cu;
    }

    return cuPorLt;
}

// Devuelve cuántos ml/g aporta 1 unidad de un ingrediente al peso bruto.
// PORCION líquida = 1 OZ; PZA/CARGA = contenido real del catálogo.
function getPesoBrutoPorUnidad(ing) {
    const OZ_ML = 29.5735;
    const u = (ing.unidad || '').toUpperCase();
    const factores = { G:1, KG:1000, ML:1, LT:1000, OZ:OZ_ML };
    if (factores[u] !== undefined) return factores[u];

    if (u === 'PORCION') {
        // Verificar si el insumo es líquido (umCosto LT/ML)
        const ins = getCatalogoInsumos().find(x => x.id === ing.insumoId);
        const p   = ins && (ins.presentaciones || [])[0];
        const umC = p && (p.umCosto || '').toUpperCase();
        if (umC === 'LT' || umC === 'ML') return OZ_ML; // 1 porción = 1 OZ
        return getContenidoPorPieza(ing.insumoId); // otros
    }
    // PZA o CARGA → contenido real de la pieza
    return getContenidoPorPieza(ing.insumoId);
}

// ── Estado de ingredientes ──────────────────────────────────
let ingredientes = [
    { nombre: 'Licor del 43',   desc: '',                    cantidad: 60,  unidad: 'ML',    costoPorKgLt: 0, insumoId: '' },
    { nombre: 'Café espresso',  desc: '1 Carga de espresso', cantidad: 1,   unidad: 'CARGA', costoPorKgLt: 0, insumoId: '' },
];

// ── Factor de conversión según unidad ───────────────────────
function getFactor(cantidad, unidad) {
    const u = (unidad || '').toUpperCase();
    if (u === 'ML' || u === 'G') return cantidad / 1000;
    return cantidad;
}

// Costo por unidad EFECTIVO de un ingrediente, listo para multiplicar por
// getFactor(). Vinculado al catálogo: costoPorKgLt ya viene convertido a la
// unidad del escandallo por getCostoParaUnidad ($/OZ, $/LT, $/KG, $/PZA).
// Manual (sin insumoId): el usuario captura $/KG-LT-PZ (así lo dice la columna)
// y OZ era el hueco — getFactor devuelve las oz directas, así que el precio
// capturado por litro debe pasarse a $/OZ (× 29.5735/1000). Las demás unidades
// ya cuadran con getFactor (ML/G ÷1000; LT/KG/PZA/PORCION/CARGA directas).
function costoUnitEfectivo(ing) {
    var c = parseFloat(ing && ing.costoPorKgLt) || 0;
    if (ing && !ing.insumoId && (ing.unidad || '').toUpperCase() === 'OZ') return c * 29.5735 / 1000;
    return c;
}

// ── Autocomplete ─────────────────────────────────────────────
function buscarInsumos(query) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    // Acotado a la sucursal donde se trabaja (no todo el catálogo global del negocio).
    var lista = getCatalogoInsumosScope().filter(x =>
        x.nombre.toLowerCase().includes(q) ||
        (x.marca||'').toLowerCase().includes(q) ||
        (x.variedad||'').toLowerCase().includes(q) ||
        (x.categoria||'').toLowerCase().includes(q)
    );
    // Priorizar coincidencias por NOMBRE (ej. "Campari" antes que los de marca "Campari México")
    // y los que EMPIEZAN con la búsqueda. Si no, con tope de 8 el insumo real se perdía.
    lista.sort(function(a, b){
        var an = (a.nombre||'').toLowerCase(), bn = (b.nombre||'').toLowerCase();
        var as = an.indexOf(q) === 0 ? 0 : (an.indexOf(q) >= 0 ? 1 : 2);
        var bs = bn.indexOf(q) === 0 ? 0 : (bn.indexOf(q) >= 0 ? 1 : 2);
        if (as !== bs) return as - bs;
        return an.localeCompare(bn);
    });
    return lista.slice(0, 12);
}

function cerrarTodosDropdowns() {
    document.querySelectorAll('.ins-dropdown').forEach(d => d.remove());
}

function crearItemDropdown(ins, idx) {
    var p  = (ins.presentaciones||[])[0];
    var cu = parseFloat((p && (p.costoUnitario || p.precio)) || 0);
    var um = (p && p.umCosto) || 'LT';
    var div = document.createElement('div');
    div.style.cssText = 'padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);' +
        'display:flex;align-items:center;gap:10px;transition:background 0.15s;';
    div.addEventListener('mouseenter', function(){ this.style.background = 'var(--surface2)'; });
    div.addEventListener('mouseleave', function(){ this.style.background = 'transparent'; });
    div.addEventListener('mousedown', function(e){
        e.preventDefault(); // evita blur del input antes del click
        seleccionarInsumo(idx, ins.id);
    });

    var fotoDiv = document.createElement('div');
    fotoDiv.style.cssText = 'width:32px;height:32px;border-radius:6px;background:var(--surface2);' +
        'border:1px solid var(--border);display:flex;align-items:center;justify-content:center;' +
        'font-size:13px;flex-shrink:0;overflow:hidden;';
    if (ins.foto) {
        var img = document.createElement('img');
        img.src = ins.foto;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        fotoDiv.appendChild(img);
    } else {
        fotoDiv.textContent = '📦';
    }

    var infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex:1;min-width:0;';
    var nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-size:13px;font-weight:500;color:var(--text);' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    nameDiv.textContent = insumoTitulo(ins);
    var catDiv = document.createElement('div');
    catDiv.style.cssText = 'font-size:10px;color:var(--text-dim);margin-top:2px;';
    catDiv.textContent = insumoMeta(ins);
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(catDiv);

    var costoDiv = document.createElement('div');
    costoDiv.style.cssText = 'text-align:right;flex-shrink:0;';
    var monto = document.createElement('div');
    monto.style.cssText = 'font-size:13px;font-weight:600;color:var(--green);';
    monto.textContent = '$'+cu.toFixed(2);
    var umDiv = document.createElement('div');
    umDiv.style.cssText = 'font-size:9px;color:var(--text-dim);';
    umDiv.textContent = '/'+um;
    costoDiv.appendChild(monto);
    costoDiv.appendChild(umDiv);

    div.appendChild(fotoDiv);
    div.appendChild(infoDiv);
    div.appendChild(costoDiv);
    return div;
}

function mostrarDropdown(idx, query) {
    cerrarTodosDropdowns();
    var resultados = buscarInsumos(query);
    if (!resultados.length) return;

    var allInputs = document.querySelectorAll('#tbodyIngredientes [data-ing="nombre"]');
    var input = allInputs[idx];
    if (!input) return;

    var rect = input.getBoundingClientRect();
    var dd   = document.createElement('div');
    dd.className  = 'ins-dropdown';
    dd.style.cssText =
        'position:fixed;z-index:9999;' +
        'top:'  + (rect.bottom + 4) + 'px;' +
        'left:' + rect.left + 'px;' +
        'width:' + Math.max(320, rect.width) + 'px;' +
        'background:var(--surface);border:1px solid var(--border);' +
        'border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.6);' +
        'max-height:280px;overflow-y:auto;';

    resultados.forEach(function(ins) {
        dd.appendChild(crearItemDropdown(ins, idx));
    });

    document.body.appendChild(dd);
}


// Redondea el costo por unidad a 2 decimales (centavos) — el COSTO es $/KG-LT-PZ,
// así no se arrastran decimales de más (ej. $25.8513824 → $25.85).
function _redondeaCosto(v) { return Math.round((parseFloat(v) || 0) * 100) / 100; }

function seleccionarInsumo(idx, insumoId) {
    const ins = getCatalogoInsumos().find(x => x.id === insumoId);
    if (!ins) return;
    const costo = _redondeaCosto(getCostoParaUnidad(ins, ingredientes[idx].unidad));
    ingredientes[idx].nombre       = insumoTitulo(ins);
    ingredientes[idx].insumoId     = insumoId;
    ingredientes[idx].costoPorKgLt = costo;
    cerrarTodosDropdowns();
    renderTabla();
    if (typeof guardarEnHistorial === 'function') guardarEnHistorial();
}

function recalcularCostoDesdeInsumo(idx) {
    const ing = ingredientes[idx];
    if (!ing.insumoId) return;
    // Por el resolver, no por .find directo: si el negocio independizó sus
    // insumos por sucursal, la receta puede traer el id del maestro y el
    // catálogo tener solo la copia (o al revés) — con el .find crudo el
    // ingrediente se quedaba en $0.00 aunque el insumo sí existiera.
    const ins = (typeof window._insumoResolver === 'function' ? window._insumoResolver(ing.insumoId) : null)
             || getCatalogoInsumos().find(x => x.id === ing.insumoId);
    if (ins) ing.costoPorKgLt = _redondeaCosto(getCostoParaUnidad(ins, ing.unidad));
}

document.addEventListener('click', function(e) {
    if (!e.target.closest('.ins-dropdown') && !e.target.closest('[data-ing="nombre"]'))
        cerrarTodosDropdowns();
});

// ── Render tabla de ingredientes ────────────────────────────
function renderTabla() {
    const tbody = document.getElementById('tbodyIngredientes');
    tbody.innerHTML = '';

    ingredientes.forEach((ing, i) => {
        const costoU   = getFactor(ing.cantidad, ing.unidad) * costoUnitEfectivo(ing);
        const vinculado = !!ing.insumoId;

        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td style="color:var(--text-dim);width:32px">'+(i+1)+'</td>' +
            '<td style="position:relative">' +
                '<div style="display:flex;align-items:center;gap:5px">' +
                (vinculado ? '<span style="width:6px;height:6px;border-radius:50%;background:var(--green);flex-shrink:0" title="Vinculado al catálogo"></span>' : '') +
                '<input type="text" data-ing="nombre" value="'+ing.nombre+'" placeholder="Ingrediente" autocomplete="off"' +
                ' oninput="updateIng('+i+',\'nombre\',this.value);mostrarDropdown('+i+',this.value)"' +
                ' onblur="setTimeout(cerrarTodosDropdowns,200)"' +
                ' onkeydown="if(event.key===\'Escape\')cerrarTodosDropdowns()"' +
                ' style="width:100%">' +
                '</div></td>' +
            '<td><input type="text" value="'+ing.desc+'" placeholder="Detalle" oninput="updateIng('+i+',\'desc\',this.value)"></td>' +
            '<td><input type="number" value="'+ing.cantidad+'" min="0" step="1" oninput="updateIng('+i+',\'cantidad\',parseFloat(this.value)||0)"></td>' +
            '<td><select onchange="updateUnidad('+i+',this.value)" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:4px 6px;border-radius:4px;font-family:\'DM Sans\',sans-serif;font-size:13px;outline:none;">' +
                ['ML','LT','G','KG','PZA','CARGA','OZ','PORCION'].map(u =>
                    '<option value="'+u+'"'+(ing.unidad===u?' selected':'')+'>'+u+'</option>'
                ).join('') +
            '</select></td>' +
            '<td><div style="display:flex;align-items:center;gap:4px">' +
                '<span style="color:var(--amber);font-size:14px">$</span>' +
                '<input type="number" value="'+(ing.costoPorKgLt||'')+'" min="0" step="0.01" placeholder="0.00"' +
                ' oninput="updateIng('+i+',\'costoPorKgLt\',parseFloat(this.value)||0)"></div></td>' +
            '<td class="costo-u">$'+costoU.toFixed(2)+'</td>' +
            '<td style="white-space:nowrap">' +
                (vinculado ? '<button onclick="verFichaInsumo(\''+ing.insumoId+'\')" style="background:transparent;border:none;color:var(--green);cursor:pointer;font-size:13px;padding:2px 5px;opacity:0.85" title="Ver ficha técnica">◉</button>' : '') +
                '<button onclick="eliminarIng('+i+')" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:15px;padding:2px 6px;" title="Eliminar">✕</button>' +
            '</td>';
        tbody.appendChild(tr);
    });

    calcularCosteos();
}

// ── Actualizar campo de un ingrediente ───────────────────────
function updateIng(i, campo, val) {
    ingredientes[i][campo] = val;
    if (campo === 'nombre') ingredientes[i].insumoId = '';
    const costoU = getFactor(ingredientes[i].cantidad, ingredientes[i].unidad) * costoUnitEfectivo(ingredientes[i]);
    const rows = document.querySelectorAll('#tbodyIngredientes tr');
    if (rows[i]) rows[i].querySelector('.costo-u').textContent = '$'+costoU.toFixed(2);
    calcularCosteos();
}

function updateUnidad(i, val) {
    ingredientes[i].unidad = val;
    recalcularCostoDesdeInsumo(i);
    renderTabla();
}

// ── Agregar / eliminar ingredientes ─────────────────────────
function agregarIngrediente() {
    ingredientes.push({ nombre: '', desc: '', cantidad: 0, unidad: 'ML', costoPorKgLt: 0, insumoId: '' });
    renderTabla();
    if (typeof guardarEnHistorial === 'function') guardarEnHistorial();
    setTimeout(function() {
        var rows = document.querySelectorAll('#tbodyIngredientes tr');
        var last = rows[rows.length-1];
        if (last) { var inp = last.querySelector('[data-ing="nombre"]'); if(inp) inp.focus(); }
    }, 50);
}

function eliminarIng(i) {
    ingredientes.splice(i, 1);
    renderTabla();
    if (typeof guardarEnHistorial === 'function') guardarEnHistorial();
}

// ── Ficha técnica de insumo desde el escandallo ──────────────
function _fichaEsc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _fichaFila(label, val) {
    return '<div style="display:flex;justify-content:space-between;align-items:baseline;' +
           'padding:7px 0;border-bottom:1px solid var(--border)">' +
               '<span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;' +
               'letter-spacing:1px;flex-shrink:0;margin-right:12px">' + label + '</span>' +
               '<span style="font-size:13px;color:var(--text);font-weight:500;text-align:right">' +
               _fichaEsc(String(val)) + '</span>' +
           '</div>';
}

function verFichaInsumo(insumoId) {
    const ins    = getCatalogoInsumos().find(x => x.id === insumoId);
    const modal  = document.getElementById('modalFichaInsumo');
    const tipoEl = document.getElementById('fichaInsumoTipo');
    const body   = document.getElementById('fichaInsumoContent');
    if (!ins || !modal) return;

    const esSub = !!ins.esSubReceta;
    const pres  = (ins.presentaciones || [])[0] || {};
    tipoEl.textContent = esSub ? 'Sub-receta' : (ins.tipoInsumo || ins.familia || 'Insumo');

    let html = '';

    html += '<div style="font-size:20px;font-weight:700;color:var(--text);margin-bottom:16px">' +
            _fichaEsc(ins.nombre) + '</div>';

    if (esSub) {
        const costoKL  = parseFloat(pres.costoUnitario) || 0;
        const umCosto  = pres.umCosto || 'KG';
        const contNeto = parseFloat(pres.contNeto) || 0;
        const umCont   = pres.umContenido || '';
        if (contNeto) html += _fichaFila('Rendimiento', contNeto + ' ' + umCont);
        if (costoKL)  html += _fichaFila('Costo por ' + umCosto, '$' + costoKL.toFixed(2));
        const costo0  = parseFloat(pres.costoPieza) || 0;
        if (costo0)   html += _fichaFila('Costo total lote', '$' + costo0.toFixed(2));
        html += '<div style="margin-top:14px;padding:12px;background:var(--surface2);border:1px solid var(--border);' +
                'border-radius:8px;font-size:12px;color:var(--text-dim)">Los datos se actualizan al guardar la sub-receta.</div>';
    } else {
        if (ins.familia)      html += _fichaFila('Familia',              ins.familia);
        if (ins.categoria)    html += _fichaFila('Categoría',            ins.categoria);
        if (ins.marca)        html += _fichaFila('Marca',                ins.marca);
        if (ins.variedad)     html += _fichaFila('Variedad',             ins.variedad);
        if (ins.subcategoria) html += _fichaFila('Subcategoría',         ins.subcategoria);
        if (ins.maduracion)   html += _fichaFila('Añejamiento / Estado', ins.maduracion);
        if (ins.notas)        html += _fichaFila('Notas',                ins.notas);

        const presArr = ins.presentaciones || [];
        if (presArr.length) {
            html += '<div style="margin-top:16px;margin-bottom:8px;font-size:9px;letter-spacing:2px;' +
                    'text-transform:uppercase;color:var(--text-dim)">Presentaciones</div>';
            presArr.forEach(function(p) {
                const costoKL    = parseFloat(p.costoUnitario) || 0;
                const costoPieza = parseFloat(p.costoPieza)    || 0;
                html += '<div style="background:var(--surface2);border:1px solid var(--border);' +
                        'border-radius:8px;padding:10px 14px;margin-bottom:8px">' +
                            '<div style="font-weight:600;font-size:13px;margin-bottom:6px">' +
                            _fichaEsc(p.nombre || '—') + '</div>' +
                            '<div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--text-dim)">' +
                                (p.contNeto  ? '<span>' + p.contNeto + ' ' + _fichaEsc(p.umContenido || '') + '</span>' : '') +
                                (costoPieza  ? '<span>$' + costoPieza.toFixed(2) + ' / pieza</span>' : '') +
                                (costoKL     ? '<span style="color:var(--green);font-weight:600">$' +
                                              costoKL.toFixed(2) + ' / ' + _fichaEsc(p.umCosto || 'KG') + '</span>' : '') +
                            '</div>' +
                        '</div>';
            });
        }
    }

    html += '<div style="display:flex;gap:10px;margin-top:20px">';
    if (esSub && ins.recetaId) {
        html += '<button onclick="abrirEditorEnModal(\'index.html?embed=1&r=' + _fichaEsc(ins.recetaId) + '\',\'Escandallo · ' + _fichaEsc(ins.nombre) + '\')" ' +
                'style="flex:1;padding:10px;background:var(--green);color:#fff;border:none;' +
                'border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Ver escandallo</button>';
    } else {
        html += '<button onclick="abrirEditorEnModal(\'insumos.html?solo=1&id=' + _fichaEsc(insumoId) + '\',\'Editar insumo · ' + _fichaEsc(ins.nombre) + '\')" ' +
                'style="flex:1;padding:10px;background:var(--green);color:#fff;border:none;' +
                'border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Editar insumo</button>';
    }
    html += '<button onclick="cerrarFichaInsumo()" ' +
            'style="padding:10px 18px;background:var(--surface2);color:var(--text);border:1px solid var(--border);' +
            'border-radius:8px;font-size:13px;cursor:pointer">Cerrar</button>';
    html += '</div>';

    body.innerHTML = html;
    modal.style.display = 'flex';
}

function cerrarFichaInsumo() {
    const m = document.getElementById('modalFichaInsumo');
    if (m) m.style.display = 'none';
}

// ── Editor de insumo / escandallo en modal iframe ────────────
function abrirEditorEnModal(url, label) {
    const modal = document.getElementById('modalIframeInsumo');
    const frame = document.getElementById('iframeInsumo');
    const lbl   = document.getElementById('iframeInsumoLabel');
    if (!modal || !frame) return;
    cerrarFichaInsumo();
    if (lbl) lbl.textContent = label || '';
    frame.src = url;
    modal.style.display = 'flex';
}

// ¿La ventana flotante tiene un editor con cambios sin guardar? Lo dice el hijo.
var _iframeDirty = false;

/* Cerrar la ventana flotante. Si adentro hay un escandallo con cambios sin
   guardar, NO se cierra de golpe: el botón queda a la vista detrás de las otras
   ventanas y es facilísimo darle por error. Mismas tres salidas que el resto
   del editor: seguir editando, guardar y cerrar, o cerrar sin guardar. */
function cerrarIframeInsumo(forzar) {
    const modal = document.getElementById('modalIframeInsumo');
    const frame = document.getElementById('iframeInsumo');
    if (!forzar && _iframeDirty && modal && modal.style.display !== 'none') {
        var _cerrar = function(){ _iframeDirty = false; cerrarIframeInsumo(true); };
        var _guardar = function(){
            try { frame.contentWindow.postMessage({ type:'guardarYCerrar' }, window.location.origin); }
            catch (e) { _cerrar(); }
        };
        if (typeof etaaxDialog === 'function') {
            etaaxDialog({
                icon: '❓',
                title: '¿Cerrar la ventana?',
                msg: 'Tienes cambios sin guardar en esta receta.',
                buttons: [
                    { label: 'Seguir editando',   kind: 'ghost',   onClick: null },
                    { label: 'Guardar y cerrar',  kind: 'primary', onClick: _guardar },
                    { label: 'Cerrar sin guardar',kind: 'danger',  onClick: _cerrar }
                ]
            });
        } else if (confirm('¿Cerrar sin guardar? Los cambios se perderán.')) _cerrar();
        return;
    }
    _iframeDirty = false;
    if (modal) modal.style.display = 'none';
    // Recalcular YA desde localStorage: el iframe lo actualizó de forma síncrona,
    // así que el costo nuevo del insumo/sub-receta ya está disponible al instante.
    ingredientes.forEach((ing, i) => recalcularCostoDesdeInsumo(i));
    renderTabla();
    // Blanquear el iframe con RETRASO. Hacerlo al instante destruía su documento y
    // CANCELABA las escrituras a Supabase en vuelo (guardar la sub-receta + upsert
    // del insumo con el costo nuevo). localStorage sí quedaba al día, pero la nube
    // conservaba el costo viejo → al recargar, el pull de Supabase lo revertía y el
    // escandallo padre "perdía" el precio. El retraso deja que esos writes terminen.
    if (frame) setTimeout(function(){
        if (modal && modal.style.display === 'none') frame.src = 'about:blank';
    }, 4000);
}

window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'insumoGuardado') {
        var _insumoId = e.data.insumoId;
        // Sincronizar nombre y costo del insumo editado en los ingredientes actuales
        var _insActualizado = _insumoId ? getCatalogoInsumos().find(function(x) { return x.id === _insumoId; }) : null;
        ingredientes.forEach(function(ing, i) {
            if (_insActualizado && ing.insumoId === _insumoId) {
                ing.nombre = _insActualizado.nombre;
            }
            recalcularCostoDesdeInsumo(i);
        });
        try { renderTabla(); } catch (err) {}
        cerrarIframeInsumo();
    } else if (e.data.type === 'recetaGuardada') {
        // Sub-escandallo guardado en el modal embebido: cerrar y refrescar costos
        // (cerrarIframeInsumo ya recalcula los ingredientes y re-pinta la tabla).
        cerrarIframeInsumo();
    } else if (e.data.type === 'cerrarEditor') {
        cerrarIframeInsumo(true);          // la pidió el propio hijo: ya decidió
    } else if (e.data.type === 'escDirty') {
        _iframeDirty = !!e.data.dirty;     // el hijo reporta si tiene cambios
    } else if (e.data.type === 'guardarYCerrar') {
        // Lo manda el padre: guardar aquí dentro y avisar que ya se puede cerrar.
        if (typeof guardarReceta === 'function') {
            Promise.resolve(guardarReceta()).then(function(ok){
                if (ok === false) return;  // la validación falló: quedarse a corregir
                window._escDirty = false;
                if (typeof window._avisarDirty === 'function') window._avisarDirty();
                try { window.parent.postMessage({ type:'cerrarEditor' }, window.location.origin); } catch (err) {}
            }).catch(function(){});
        }
    }
});

// ── Cálculos principales ─────────────────────────────────────
function calcularCosteos() {
    const costoTotal = ingredientes.reduce(function(sum, ing) {
        return sum + getFactor(ing.cantidad, ing.unidad) * costoUnitEfectivo(ing);
    }, 0);

    document.getElementById('costoTotalDisplay').textContent = '$'+costoTotal.toFixed(2);

    // Costeo sugerido: el múltiplo del escandallo manda (vacío = 3.33 de siempre).
    // La fórmula vive en el núcleo — aquí solo se pinta.
    var _sug = EtaaxCore.costeoReceta(costoTotal, _multiploDelEditor());
    setVal('s-costobruto', costoTotal);
    setVal('s-gasto',      _sug.gastoOp);
    setVal('s-utilidad',   _sug.utilidad);
    setVal('s-platillo',   _sug.platillo);
    setVal('s-iva',        _sug.iva);
    setVal('s-comedor',    _sug.comedor);
    setVal('s-delivery',   _sug.delivery);
    _pintarPctSugerido(_sug);

    const precioEnCarta = parseFloat(document.getElementById('precioEnCarta').value) || 0;
    if (precioEnCarta > 0) {
        const aSinIva        = precioEnCarta / 1.16;
        const aCostoBrutoPct = costoTotal > 0 ? (costoTotal / aSinIva) * 100 : 0;
        const aUtilidadPct   = 100 - aCostoBrutoPct - 40;

        setVal('a-siniva',   aSinIva);
        setVal('a-gasto',    aSinIva * 0.40);
        setVal('a-iva',      precioEnCarta - aSinIva);
        setVal('a-comedor',  precioEnCarta);
        setVal('a-delivery', aSinIva * 1.56);

        document.getElementById('a-costobruto-monto').textContent = '$'+costoTotal.toFixed(2);
        document.getElementById('a-utilidad-monto').textContent   = '$'+(aSinIva*(aUtilidadPct/100)).toFixed(2);

        var cbEl = document.getElementById('a-costobruto-pct');
        cbEl.textContent = aCostoBrutoPct.toFixed(1)+'%';
        cbEl.className   = aCostoBrutoPct <= 32 ? 'costeo-pct val-green' : aCostoBrutoPct <= 45 ? 'costeo-pct val-amber' : 'costeo-pct val-red';

        var utilEl = document.getElementById('a-utilidad-pct');
        utilEl.textContent = aUtilidadPct.toFixed(1)+'%';
        utilEl.className   = aUtilidadPct >= 25 ? 'costeo-pct val-green' : aUtilidadPct >= 10 ? 'costeo-pct val-amber' : 'costeo-pct val-red';
    } else {
        ['a-siniva','a-gasto','a-iva','a-comedor','a-delivery','a-costobruto-monto','a-utilidad-monto'].forEach(function(id){
            var el = document.getElementById(id); if(el) el.textContent = '$0.00';
        });
        document.getElementById('a-costobruto-pct').textContent = '—%';
        document.getElementById('a-utilidad-pct').textContent   = '—%';
    }
}

/* Sello de auditoría de la receta: cuándo y quién. Se pinta bajo el nombre en el
   encabezado del escandallo — sirve para saber si el costeo que estás leyendo es de
   ayer o del año pasado, y a quién preguntarle. */
function _usuarioActualRec() {
    try {
        var c = JSON.parse(localStorage.getItem('etaax_ctx') || '{}');
        return c.userName || c.staffNombre || c.negNombre || '';
    } catch (e) { return ''; }
}
function _pintarSelloReceta(r) {
    var el = document.getElementById('recSello');
    if (!el) return;
    var iso = (r && (r.fechaGuardado || r.createdAt)) || '';
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) { el.innerHTML = ''; return; }
    var dias = Math.floor((Date.now() - d.getTime()) / 86400000);
    var rel = dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : dias < 30 ? ('hace ' + dias + ' días')
            : dias < 365 ? ('hace ' + Math.floor(dias / 30) + ' mes' + (dias < 60 ? '' : 'es'))
            : ('hace ' + Math.floor(dias / 365) + ' año' + (dias < 730 ? '' : 's'));
    var quien = (r && r.updatedBy) || '';
    el.title = 'Última actualización: ' + d.toLocaleString('es-MX', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
    el.style.cssText = 'margin-top:3px;font-size:10.5px;color:var(--text-dim)';
    el.innerHTML = '🕒 Actualizado ' + etx(rel) + (quien ? ' · <span style="color:var(--text-muted)">' + etx(quien) + '</span>' : '');
}

// Múltiplo tecleado en el escandallo (vacío/0 → null = default del núcleo).
function _multiploDelEditor() {
    var el = document.getElementById('s-multiplo');
    var v = el ? parseFloat(el.value) : NaN;
    return (v > 0) ? v : null;
}
// Los porcentajes del costeo sugerido dejan de ser fijos: los dicta el múltiplo.
// La utilidad se pinta en rojo cuando el múltiplo no alcanza a pagar el 40% de gasto.
function _pintarPctSugerido(sug) {
    var _txt = function (id, t, cls) {
        var el = document.getElementById(id); if (!el) return;
        el.textContent = t;
        if (cls !== undefined) el.className = cls;
    };
    var _pct = function (v) { return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%'; };
    _txt('s-pct-bruto',    _pct(sug.brutoPct));
    _txt('s-pct-gasto',    _pct(sug.gastoOpPct));
    _txt('s-pct-utilidad', _pct(sug.utilidadPct),
         sug.utilidadPct < 0 ? 'costeo-pct val-red' : sug.utilidadPct < 15 ? 'costeo-pct val-amber' : 'costeo-pct');
    var hint = document.getElementById('s-mult-hint');
    if (hint) {
        hint.textContent = _pct(sug.brutoPct) + ' de costo bruto' +
            (sug.utilidadPct < 0 ? ' · no cubre el gasto operativo' : '');
        hint.style.color = sug.utilidadPct < 0 ? 'var(--red)' : '';
    }
}
// Volver al múltiplo de siempre (3.33 = 30% de costo bruto).
function resetMultiploReceta() {
    var el = document.getElementById('s-multiplo');
    if (el) { el.value = ''; calcularCosteos(); window._escDirty = true; if (window._avisarDirty) _avisarDirty(); }
}

function setVal(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = '$'+val.toFixed(2);
}

// ── Vista cocina / administrador ─────────────────────────────
function cambiarVista() {
    var boton  = document.getElementById('btnVista');
    var esSub  = typeof recetaTipoActual !== 'undefined' &&
                 (recetaTipoActual === 'sub-alimentos' || recetaTipoActual === 'sub-bebidas');

    if (esSub) {
        var costoFinal   = document.getElementById('subCardCostoFinal');
        var costoPorcion = document.getElementById('subCardCostoPorcion');
        var barraCosto   = document.getElementById('barraCostoTotal');
        var enAdmin      = boton.dataset.vistaActual === 'admin';

        if (enAdmin) {
            // Cambiar a OPERATIVA: ocultar costos
            if (costoFinal)   costoFinal.style.display   = 'none';
            if (costoPorcion) costoPorcion.style.display = 'none';
            if (barraCosto)   barraCosto.style.display   = 'none';
            boton.textContent       = 'VISTA ADMIN';
            boton.style.color       = 'var(--green)';
            boton.style.borderColor = 'var(--green)';
            boton.dataset.vistaActual = 'operativa';
        } else {
            // Cambiar a ADMIN: mostrar costos
            if (costoFinal)   costoFinal.style.display   = '';
            if (costoPorcion) costoPorcion.style.display = '';
            if (barraCosto)   barraCosto.style.display   = '';
            boton.textContent       = 'VISTA OPERATIVA';
            boton.style.color       = '';
            boton.style.borderColor = '';
            boton.dataset.vistaActual = 'admin';
        }
    } else {
        const seccion = document.getElementById('seccionCostos');
        seccion.classList.toggle('oculto');
        if (seccion.classList.contains('oculto')) {
            boton.textContent       = 'VISTA ADMIN';
            boton.style.color       = 'var(--green)';
            boton.style.borderColor = 'var(--green)';
        } else {
            boton.textContent       = 'VISTA OPERATIVA';
            boton.style.color       = '';
            boton.style.borderColor = '';
        }
    }
}

function toggleStatus() {
    const pill = document.getElementById('statusPill');
    if (pill.textContent === 'Activa') {
        pill.textContent = 'Inactiva';
        pill.classList.remove('pill-amber');
        pill.classList.add('pill-red');
    } else {
        pill.textContent = 'Activa';
        pill.classList.remove('pill-red');
        pill.classList.add('pill-amber');
    }
}

// ── Galería de fotos ─────────────────────────────────────────
let fotosReceta    = [];   // array de base64
let fotoIndexActual = 0;

function cargarFotos(input) {
    const files = Array.from(input.files);
    if (!files.length) return;
    let pendientes = files.length;
    files.forEach(function(file) {
        // Antes se guardaba la foto CRUDA como base64 (varios MB). Eso hacía que
        // el upsert de la receta a Supabase fallara (payload enorme) → la receta
        // se "perdía" al recargar. Ahora se redimensiona y comprime (~50 KB).
        _comprimirFotoReceta(file, 512, 0.7, function(b64) {
            if (b64) fotosReceta.push(b64);
            pendientes--;
            if (pendientes === 0) {
                fotoIndexActual = Math.max(0, fotosReceta.length - files.length);
                renderCarrusel();
                if (typeof guardarEnHistorial === 'function') guardarEnHistorial();
            }
        });
    });
    input.value = ''; // reset para poder volver a subir mismos archivos
}

function _comprimirFotoReceta(file, maxPx, calidad, cb) {
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
            catch (err) { cb(e.target.result); }
        };
        img.onerror = function() { cb(e.target.result); };
        img.src = e.target.result;
    };
    reader.onerror = function() { cb(''); };
    reader.readAsDataURL(file);
}

// ── Subir foto de la receta desde el celular vía QR (mismo puente que cortes/gastos) ──
function _abrirPuenteReceta() {
    var box = document.getElementById('qrRecetaBox');
    if (!box || !window.QrPuente) return;
    box.style.display = 'block';
    var btn = document.getElementById('btnQrReceta');
    if (btn) btn.textContent = '✕ Cerrar escaneo';
    QrPuente.abrir(getNegocioActivo(), 'receta', box, function(foto){
        if (!foto || !foto.url) return;
        if (typeof fotosReceta === 'undefined') return;
        fotosReceta.push(foto.url);
        fotoIndexActual = fotosReceta.length - 1;
        renderCarrusel();
        window._escDirty = true; // foto nueva = cambio sin guardar
    });
}
function _cerrarPuenteReceta() {
    if (window.QrPuente) QrPuente.cerrar();
    var box = document.getElementById('qrRecetaBox');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    var btn = document.getElementById('btnQrReceta');
    if (btn) btn.textContent = '📱 Subir foto desde el celular';
}
function _toggleQrReceta() {
    var box = document.getElementById('qrRecetaBox');
    if (!box) return;
    if (box.style.display === 'none' || !box.style.display) _abrirPuenteReceta();
    else _cerrarPuenteReceta();
}

function renderCarrusel() {
    var ph   = document.getElementById('fotoPlaceholder');
    var img  = document.getElementById('fotoImg');
    var left = document.getElementById('fotoLeft');
    var right= document.getElementById('fotoRight');
    var cont = document.getElementById('fotoContador');
    var del  = document.getElementById('fotoBtnEliminar');
    var minis= document.getElementById('fotoMiniaturas');

    if (!fotosReceta.length) {
        if (ph)   { ph.style.display  = 'flex'; }
        if (img)  { img.style.display = 'none'; img.src = ''; }
        if (left) left.style.display  = 'none';
        if (right)right.style.display = 'none';
        if (cont) cont.style.display  = 'none';
        if (del)  del.style.display   = 'none';
        if (minis)minis.innerHTML     = '';
        return;
    }

    // Clamp index
    if (fotoIndexActual >= fotosReceta.length) fotoIndexActual = fotosReceta.length - 1;
    if (fotoIndexActual < 0) fotoIndexActual = 0;

    if (ph)  ph.style.display  = 'none';
    if (img) { img.src = fotosReceta[fotoIndexActual]; img.style.display = 'block'; }
    if (del) del.style.display = 'flex';
    if (cont) { cont.textContent = (fotoIndexActual+1) + ' / ' + fotosReceta.length; cont.style.display = 'block'; }
    if (left)  left.style.display  = fotosReceta.length > 1 ? 'flex' : 'none';
    if (right) right.style.display = fotosReceta.length > 1 ? 'flex' : 'none';

    // Miniaturas
    if (minis) {
        minis.innerHTML = fotosReceta.map(function(src, i) {
            return '<div onclick="irAFoto(' + i + ')" style="width:44px;height:44px;border-radius:6px;' +
                'border:2px solid ' + (i===fotoIndexActual?'var(--green)':'var(--border)') + ';' +
                'overflow:hidden;cursor:pointer;flex-shrink:0">' +
                '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover"></div>';
        }).join('');
    }
}

function navegarFoto(dir) {
    fotoIndexActual = (fotoIndexActual + dir + fotosReceta.length) % fotosReceta.length;
    renderCarrusel();
}

function irAFoto(i) {
    fotoIndexActual = i;
    renderCarrusel();
}

function eliminarFotoActual() {
    if (!fotosReceta.length) return;
    fotosReceta.splice(fotoIndexActual, 1);
    if (fotoIndexActual >= fotosReceta.length) fotoIndexActual = fotosReceta.length - 1;
    renderCarrusel();
    if (typeof guardarEnHistorial === 'function') guardarEnHistorial();
}

// Compatibilidad con código que usa cargarFoto (singular)
function cargarFoto(input) { cargarFotos(input); }



document.getElementById('videoUrl').addEventListener('input', function() {
    const url = this.value.trim();
    const btn = document.getElementById('videoBtn');
    if (url) { btn.href = url; btn.style.display = 'inline-flex'; }
    else btn.style.display = 'none';
});

// ── CSS dropdown ─────────────────────────────────────────────
(function(){
    var s = document.createElement('style');
    s.textContent = '.ins-dropdown::-webkit-scrollbar{width:4px}.ins-dropdown::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}';
    document.head.appendChild(s);
})();

// ── Inicializar ───────────────────────────────────────────────
renderTabla();

/* ── Context bar (negocio activo en sub-páginas) ─────────────────── */
function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function initCtxBar() {
    var bar = document.getElementById('ctxBar');
    if (!bar) return;
    var ctx;
    try { ctx = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch(e) {}
    if (!ctx) return;
    var hubPath = '/hub.html';
    var color   = ctx.negColor || '#3dbe7a';
    // El tipo puede traer " · Sucursal" de sesiones viejas; lo recortamos porque
    // ahora la sucursal se muestra como pill aparte (sin duplicar).
    var tipo = (ctx.negTipo || '').split(' · ')[0];
    var catGlobal = false;
    try { catGlobal = sessionStorage.getItem('etaax_cat_global') === '1'; } catch(e) {}
    var pill = catGlobal
        ? '<span class="ctx-suc-pill" style="background:rgba(122,184,245,.15);color:#7ab8f5;border-color:#7ab8f5">🌐 Global · todas las sucursales</span>'
        : (ctx.sucNombre ? '<span class="ctx-suc-pill" style="background:' + color + '1f;color:' + color + ';border-color:' + color + '55">📍 ' + _esc(ctx.sucNombre) + '</span>' : '');
    bar.innerHTML =
        '<div class="ctx-bar-inner" style="border-color:' + (catGlobal ? '#7ab8f544' : (color + '44')) + '">' +
        (function(){ // jerarquía: logo de la sucursal activa → logo del negocio → emoji
            var _lg = '';
            try {
                var _scb = localStorage.getItem('etaax_sucursal_activa') || '';
                if (_scb) _lg = localStorage.getItem('etaax_' + (ctx.negId || '') + '_suc_' + _scb + '_logo') || '';
                if (!_lg) _lg = localStorage.getItem('etaax_' + (ctx.negId || '') + '_logo') || '';
            } catch(e) {}
            return _lg
                ? '<div class="ctx-neg-emoji-wrap" style="background:#fff;border-color:' + color + '33;overflow:hidden;padding:0"><img src="' + _esc(_lg) + '" alt="" style="width:100%;height:100%;object-fit:contain"></div>'
                : '<div class="ctx-neg-emoji-wrap" style="background:' + color + '1a;border-color:' + color + '33">' + _esc(ctx.negEmoji) + '</div>';
        })() +
        '<div class="ctx-neg-id"><div class="ctx-neg-name">' + _esc(ctx.negNombre) + '</div><div class="ctx-neg-tipo">' + _esc(tipo) + '</div></div>' +
        pill +
        '<div class="ctx-nav-btns" id="ctxEditorNav">' +
        '<button class="ctx-btn ctx-btn-icon" id="btnUndo" onclick="ctxNavBack()" title="Atrás">↩</button>' +
        '<button class="ctx-btn ctx-btn-icon" id="btnRedo" onclick="ctxNavForward()" title="Adelante">↪</button>' +
        '</div>' +
        '<div class="ctx-right">' +
        '<div class="ctx-user-badge"><span>' + _esc(ctx.userName.split(' ')[0]) + '</span>' +
        '<span class="ctx-badge-plan" style="background:' + ctx.userColor + '22;color:' + ctx.userColor + '">' + _esc(ctx.userBadge) + '</span></div>' +
        '<a href="' + (catGlobal ? hubPath + '?negocios=1' : hubPath) + '" class="ctx-btn">← ' + (catGlobal ? 'Ir al negocio' : 'Ir a Módulos') + '</a>' +
        '<button class="ctx-btn ctx-btn-danger" onclick="ctxSalir()">Salir</button>' +
        '</div></div>';
    bar.style.display = 'flex';
    document.body.classList.add('has-ctx');
}

function ctxShowEditorNav() {
    var nav = document.getElementById('ctxEditorNav');
    if (nav) nav.style.display = 'flex';
}
function ctxHideEditorNav() {
    var nav = document.getElementById('ctxEditorNav');
    if (nav) nav.style.display = 'none';
}

function ctxNavBack() {
    // Único caso especial: si la carátula está abierta como overlay, cerrarla primero
    var vc = document.getElementById('vistaCaratula');
    if (vc && vc.style.display !== 'none') {
        if (typeof cerrarCaratulaBtnX === 'function') cerrarCaratulaBtnX();
        return;
    }
    history.back();
}

function ctxNavForward() {
    history.forward();
}

function ctxSalir() {
    // Si hay cambios sin guardar en el editor, pedir confirmación antes de salir.
    if (window._escGuardNav) { window._escGuardNav(_ctxSalirReal); return; }
    _ctxSalirReal();
}
function _ctxSalirReal() {
    localStorage.removeItem('etaax_negocio_activo');
    localStorage.removeItem('etaax_ctx');
    sessionStorage.clear();
    window.location.href = '/hub.html?salir=1';
}

document.addEventListener('DOMContentLoaded', initCtxBar);

/* ── Guard de cambios sin guardar en el editor de escandallo ──────────
   Si el usuario está editando una receta y no ha guardado, al intentar ir a
   otro submódulo o cualquier otra ruta se pide confirmación (mismo diálogo que
   el editor de insumos, vía etaaxConfirm). beforeunload cubre recarga/back. */
(function(){
    function _escEditorAbierto() {
        var ew = document.getElementById('editorWrap');
        return !!(ew && ew.style.display !== 'none' && ew.offsetParent !== null);
    }
    window._escEditorAbierto = _escEditorAbierto;
    // El escandallo vive dentro de una ventana flotante cuyo botón "Cerrar" es del
    // padre: si no le avisamos que hay cambios, cierra y se pierde el trabajo.
    function _avisarDirty() {
        if (window.parent === window) return;
        try { window.parent.postMessage({ type:'escDirty', dirty: !!window._escDirty }, window.location.origin); } catch (e) {}
    }
    window._avisarDirty = _avisarDirty;
    function _marcarSucio(e) {
        if (_escEditorAbierto() && e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
            var antes = window._escDirty;
            window._escDirty = true;
            if (!antes) _avisarDirty();
        }
    }
    document.addEventListener('input',  _marcarSucio, true);
    document.addEventListener('change', _marcarSucio, true);

    // Helper reusable: si hay cambios sin guardar en el editor, pide confirmación
    // (3 botones) antes de ejecutar `continuar`. Si no hay cambios, ejecuta directo.
    // Lo usan el interceptor de links Y las acciones onclick (Recetas, Nueva, Salir).
    window._escGuardNav = function(continuar){
        if (typeof continuar !== 'function') return;
        if (!window._escDirty || !_escEditorAbierto()) { continuar(); return; }
        var irse = function(){ window._escDirty = false; continuar(); };
        var guardarYSalir = function(){
            if (typeof guardarReceta !== 'function') { irse(); return; }
            Promise.resolve(guardarReceta()).then(function(ok){
                // Si la validación falló (ok===false) no continúa: el usuario se queda
                // en el editor para corregir (ej. falta el nombre).
                if (ok !== false) { window._escDirty = false; continuar(); }
            }).catch(function(){});
        };
        if (typeof etaaxDialog === 'function') {
            etaaxDialog({
                icon: '❓',
                title: '¿Salir del editor?',
                msg: 'Tienes cambios sin guardar en la receta.',
                buttons: [
                    { label: 'Seguir editando',   kind: 'ghost',   onClick: null },
                    { label: 'Guardar y salir',   kind: 'primary', onClick: guardarYSalir },
                    { label: 'Salir sin guardar', kind: 'danger',  onClick: irse }
                ]
            });
        } else if (confirm('¿Salir sin guardar? Los cambios se perderán.')) { irse(); }
    };

    // Interceptar clics en links que navegan a otra ruta (submódulos, ctx-bar, nav).
    document.addEventListener('click', function(e){
        if (!window._escDirty || !_escEditorAbierto()) return;
        var a = e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#' || href.toLowerCase().indexOf('javascript:') === 0) return;
        e.preventDefault(); e.stopPropagation();
        var url = a.href, blank = a.target === '_blank';
        window._escGuardNav(function(){ if (blank) window.open(url, '_blank'); else window.location.href = url; });
    }, true);

    // Recarga / cierre / botón atrás del navegador (prompt nativo de respaldo).
    window.addEventListener('beforeunload', function(e){
        if (window._escDirty && _escEditorAbierto()) { e.preventDefault(); e.returnValue = ''; return ''; }
    });
})();

document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const focusable = [...document.querySelectorAll('input, select, button, textarea')];
        const i = focusable.indexOf(e.target);
        if (i >= 0 && focusable[i + 1]) focusable[i + 1].focus();
    }
});