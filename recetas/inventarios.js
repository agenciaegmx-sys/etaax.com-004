/* ============================================================
   ETAAX — Inventarios  v4
   ============================================================ */

// ── Helpers de sesión (mirror de app.js para páginas sin app.js) ──
function getNegocioActivo() { return localStorage.getItem('etaax_negocio_activo') || ''; }
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

// ── Storage — cache + Supabase ────────────────────────────────
var _cacheInv  = null;
var _cacheEL   = null;
var _cacheRecetasInv = null; // recetas para uso interno de este módulo
var _cacheInsumosInv = null; // insumos para uso interno de este módulo

// OJO: devolver SIEMPRE la MISMA referencia de array. Antes, si _cacheInsumosInv
// era null, cada llamada hacía un JSON.parse nuevo → el índice de _insumoResolver
// (compara la referencia del array) se reconstruía en CADA resolve → con 179 filas
// el reporte se CONGELABA. Memoizamos el parse en el propio caché.
function getInsumos() {
    if (_cacheInsumosInv) return _cacheInsumosInv;
    try { _cacheInsumosInv = JSON.parse(_skGet('insumos')) || []; } catch (e) { _cacheInsumosInv = []; }
    return _cacheInsumosInv;
}
// Resolver id→insumo con la fábrica compartida (insumo-label.js): misma lógica que
// insumos.js/app.js; fuente = getInsumos de este módulo.
window._insumoResolver = window._makeInsumoResolver(getInsumos);
// Resolver id→receta CANÓNICO por sucursal (mismo patrón): recetas/sub-recetas guardan el
// id del maestro; si hay copia de receta para la sucursal activa, la devuelve transparente.
if (typeof window._makeRecetaResolver === 'function') window._recetaResolver = window._makeRecetaResolver(getRecetas);
// Insumos acotados a la SUCURSAL activa (regla "sin sucursal = matriz: ve todo").
// Sin esto, el inventario leía los insumos de TODAS las sucursales y los duplicaba.
function _scopeSucInsumos(lista) {
    const s = localStorage.getItem('etaax_sucursal_activa') || '';
    // Inactivos GLOBALES fuera siempre (dados de baja en el negocio).
    lista = (lista || []).filter(x => x && x.activo !== '0');
    if (!s) return lista;
    // Visibilidad por sucursal: vive aquí + no PAUSADO aquí (regla única, insumo-label.js).
    return lista.filter(x => (typeof window._insumoActivoEnSuc === 'function')
        ? window._insumoActivoEnSuc(x, s)
        : ((x && (x.sucursalId || 'suc_principal')) === s));
}
// Inventarios de la SUCURSAL activa (independientes por sucursal). "Sin sucursal = ve todo".
function _scopeSucInvs(lista) {
    const s = localStorage.getItem('etaax_sucursal_activa') || '';
    if (!s) return lista || [];
    return (lista || []).filter(x => (x && (x.sucursalId || 'suc_principal')) === s);
}
function getRecetas()     { return _cacheRecetasInv || []; }
function getInventarios() { return _cacheInv || []; }
function getEntradasLog() {
    // Sanea nulos IN-PLACE (misma referencia → el backfill que hace _gl.push() sigue
    // escribiendo sobre _cacheEL). Un solo null en el cache reventaba el render del
    // historial (null.concepto); esto lo blinda en el origen, para todos los callers.
    if (_cacheEL) { for (var i = _cacheEL.length - 1; i >= 0; i--) { if (!_cacheEL[i]) _cacheEL.splice(i, 1); } }
    return _cacheEL || [];
}

// ── Helpers Supabase inventarios ──────────────────────────────
function _sbUpInv(inv) {
    var negId = getNegocioActivo(); if (!negId || typeof _supabase === 'undefined') return;
    sbUpsert('inventarios', inv, negId);
}
function _sbDelInv(id) {
    sbDelete('inventarios', id);
}
function _sbUpEL(entry) {
    var negId = getNegocioActivo(); if (!negId || typeof _supabase === 'undefined') return;
    sbUpsert('entradas_log', entry, negId);
}
function _sbDelEL(id) {
    sbDelete('entradas_log', id);
}

async function _sbInitInv() {
    var negId = getNegocioActivo();
    if (!negId || typeof _supabase === 'undefined') return;
    var r = await Promise.all([
        _supabase.from('inventarios').select('datos').eq('negocio_id', negId).order('created_at', {ascending: true}),
        _supabase.from('entradas_log').select('datos').eq('negocio_id', negId).order('created_at', {ascending: true}),
        _supabase.from('recetas').select('datos').eq('negocio_id', negId).order('created_at', {ascending: true}),
        _supabase.from('negocio_insumos').select('datos').eq('negocio_id', negId).order('created_at', {ascending: true}),
    ]);
    // .filter(Boolean): si una fila viene con datos:null NO debe entrar al cache —
    // un null en _cacheEL reventaba el render del historial de entradas (TypeError).
    if (!r[0].error) { _cacheInv = (r[0].data || []).map(function(x){ return x.datos; }).filter(Boolean); _marcarSynced(_cacheInv.map(function(c){ return c && c.id; })); }
    _mergeDraftsLocal(); // recuperar borradores que aún no sincronizaron a la nube
    if (!r[1].error) _cacheEL   = (r[1].data || []).map(function(x){ return x.datos; }).filter(Boolean);
    _mergeELLocal(); // recuperar entradas que aún no sincronizaron a la nube
    if (!r[2].error) _cacheRecetasInv = (r[2].data || []).map(function(x){ return x.datos; }).filter(Boolean);
    await _pullInvAjustes(negId); // compuestos + bateo desde la nube → localStorage
    if (!r[3].error) {
        _cacheInsumosInv = (r[3].data || []).map(function(x){ return x.datos; }).filter(Boolean);
        // actualizar localStorage para compatibilidad con insumos.js
        try { localStorage.setItem(_sk('insumos'), JSON.stringify(_cacheInsumosInv.map(function(ins){ var c=Object.assign({},ins); c.foto=''; c.fotoUrl=''; return c; }))); } catch(e) {}
    }
    if (typeof init === 'function') init();
    _subInvRealtime(negId);
    _subEntradasRealtime(negId); // el QR de entradas/mermas aparece SOLO (requiere v32)
    _subAjustesRealtime(negId);  // compuestos + bateo en vivo entre dispositivos (v37 + v39)
}

// ── Realtime del QR (entradas_log): lo registrado desde el celular aparece SOLO ──
// Antes había que refrescar la página. Requiere v32 (entradas_log en la publicación).
var _elRtCh = null, _elRtNeg = null, _elRtT = null;
function _subEntradasRealtime(negId) {
    if (!negId || _elRtNeg === negId || typeof sbRealtime !== 'function') return;
    if (_elRtCh && _supabase.removeChannel) { try { _supabase.removeChannel(_elRtCh); } catch(e) {} }
    _elRtNeg = negId;
    _elRtCh = sbRealtime('entradas_log', negId, function() {
        clearTimeout(_elRtT);
        _elRtT = setTimeout(_reloadEntradasRT, 400); // coalescer ráfagas en una recarga
    });
}
async function _reloadEntradasRT() {
    var negId = getNegocioActivo();
    if (!negId || _elRtNeg !== negId || typeof _supabase === 'undefined') return;
    var r = await _supabase.from('entradas_log').select('datos').eq('negocio_id', negId).order('created_at', {ascending: true});
    if (r.error) return;
    var frescas = (r.data || []).map(function(x){ return x.datos; }).filter(Boolean);
    // Conservar las locales aún sin sincronizar (outbox) para que no desaparezcan.
    var vistos = {}; frescas.forEach(function(e){ if (e && e.id) vistos[e.id] = 1; });
    (_cacheEL || []).forEach(function(e){ if (e && e.id && !vistos[e.id]) frescas.push(e); });
    _cacheEL = frescas;
    window._step5Dirty = true; // llegaron datos nuevos del QR → invalidar el resumen
    try { localStorage.setItem(_sk('el_local'), JSON.stringify(_cacheEL)); } catch(e) {}
    // Refrescar lo que esté en pantalla: el registro de entradas, o el inventario
    // abierto (importa las nuevas del QR al momento).
    try {
        var ve = document.getElementById('vistaEntradas');
        if (ve && ve.style.display !== 'none') { renderVistaEntradas(); return; }
        if (invActual && !invActual.cerrado) {
            var n = _importarEntradasQR();
            if (n && typeof renderStepContent === 'function') renderStepContent();
        }
    } catch(e) {}
}

// ── Realtime de AJUSTES (compuestos + bateo, tabla inv_ajustes v37): al crearlos
//    en otro dispositivo aparecen SOLO. Requiere inv_ajustes en la publicación
//    realtime (v39) y la tabla creada (v37). Sin realtime, solo sincronizan al recargar.
var _ajRtCh = null, _ajRtNeg = null, _ajRtT = null;
function _subAjustesRealtime(negId) {
    if (!negId || _ajRtNeg === negId || typeof sbRealtime !== 'function') return;
    if (_ajRtCh && _supabase.removeChannel) { try { _supabase.removeChannel(_ajRtCh); } catch(e) {} }
    _ajRtNeg = negId;
    _ajRtCh = sbRealtime('inv_ajustes', negId, function() {
        clearTimeout(_ajRtT);
        _ajRtT = setTimeout(_reloadAjustesRT, 400); // coalescer ráfagas
    });
}
async function _reloadAjustesRT() {
    var negId = getNegocioActivo();
    if (!negId || _ajRtNeg !== negId || typeof _pullInvAjustes !== 'function') return;
    await _pullInvAjustes(negId);   // refresca compuestos/bateo en localStorage
    window._step5Dirty = true;      // el resumen depende de los compuestos
    try {
        // Repintar en vivo: el modal de compuestos si está abierto, y el paso actual.
        var mp = document.getElementById('modalParametros');
        if (mp && mp.style.display !== 'none' && typeof _renderParamLista === 'function') _renderParamLista();
        if (invActual && !invActual.cerrado && typeof renderStepContent === 'function') renderStepContent();
    } catch(e) {}
}

// Realtime: si otro dispositivo registra/edita un inventario, el historial se
// actualiza solo (estilo Drive). OJO: NO refresca si el usuario está en el wizard
// de captura (vistaForm/Captura/Entradas) — solo cuando ve el historial (vistaLista).
var _invRtCh = null, _invRtNeg = null;
async function _reloadInvRT() {
    var negId = getNegocioActivo();
    if (!negId || typeof _supabase === 'undefined') return;
    var r = await _supabase.from('inventarios').select('datos').eq('negocio_id', negId).order('created_at', { ascending: true });
    if (r.error) return;
    var remote = (r.data || []).map(function(x){ return x.datos; }).filter(Boolean);
    var vistos = {}; remote.forEach(function(c){ if (c && c.id) vistos[c.id] = 1; });
    _marcarSynced(remote.map(function(c){ return c.id; }));
    var synced = _getSynced();
    // Conservar SOLO borradores que nunca se sincronizaron. Si un inventario ya
    // estuvo en la nube y ahora no está, fue BORRADO en otro equipo → soltarlo.
    var soloLocal = (_cacheInv || []).filter(function(c){ return c && c.id && !vistos[c.id] && !synced[c.id]; });
    _cacheInv = remote.concat(soloLocal);
    _mergeDraftsLocal(); // nunca perder borradores locales en un reload de realtime
    _guardarDraftsLocal(); // reflejar el borrado en el respaldo local (no resucitar al refrescar)
    if (typeof renderStats === 'function') renderStats();
    if (typeof renderHistorial === 'function') renderHistorial();
}
function _subInvRealtime(negId) {
    if (!negId || _invRtNeg === negId || typeof sbRealtime !== 'function') return;
    if (_invRtCh && _supabase.removeChannel) { try { _supabase.removeChannel(_invRtCh); } catch(e) {} }
    _invRtNeg = negId;
    _invRtCh = sbRealtime('inventarios', negId, function() {
        var lista = document.getElementById('vistaLista');
        // Solo refrescar viendo el historial; en el wizard de captura no interrumpir.
        if (!lista || lista.style.display === 'none') return;
        if (getNegocioActivo() === negId) _reloadInvRT();
    });
}

function _limpiarStorageEmergencia() {
    const keys = ['insumos', 'inventarios', 'recetas', 'entradas_log'];
    keys.forEach(k => {
        const legacyKey = 'etaax_' + k;
        const modernKey = _sk(k);
        if (legacyKey !== modernKey && localStorage.getItem(legacyKey) !== null) {
            localStorage.removeItem(legacyKey);
        }
    });
}

// ── Respaldo local de TODOS los inventarios ──────────────────────
// El inventario vive en Supabase, pero si el upsert a la nube falla (o tarda),
// se perdía la captura al refrescar — borradores Y cerrados. Guardamos TODOS
// los inventarios en localStorage y los mezclamos al cargar (los que la nube
// aún no tiene). Si la nube falla, el inventario sigue ahí en este equipo.
function _guardarDraftsLocal() {
    try {
        localStorage.setItem(_sk('inv_local'), JSON.stringify(_cacheInv || []));
    } catch(e) {
        // Si no cabe (quota), al menos respaldar los borradores abiertos (lo más crítico).
        try { localStorage.setItem(_sk('inv_local'), JSON.stringify((_cacheInv||[]).filter(function(x){return x && !x.cerrado;}))); } catch(e2) {}
    }
}
function _cargarDraftsLocal() {
    try { return JSON.parse(localStorage.getItem(_sk('inv_local')) || '[]') || []; } catch(e) { return []; }
}
// IDs que YA se vieron en la nube alguna vez. Sirve para distinguir un borrador
// nunca sincronizado (conservar) de un inventario que estaba sincronizado y se
// BORRÓ en otro dispositivo (no resucitar). Sin esto, el borrado no se propagaba.
var _syncedIds = null;
function _getSynced() {
    if (!_syncedIds) { try { _syncedIds = JSON.parse(localStorage.getItem(_sk('inv_synced')) || '{}') || {}; } catch(e) { _syncedIds = {}; } }
    return _syncedIds;
}
function _marcarSynced(ids) {
    var s = _getSynced(), ch = false;
    (ids || []).forEach(function(id){ if (id && !s[id]) { s[id] = 1; ch = true; } });
    if (ch) { try { localStorage.setItem(_sk('inv_synced'), JSON.stringify(s)); } catch(e) {} }
}
function _mergeDraftsLocal() {
    var locales = _cargarDraftsLocal();
    if (!locales.length) return;
    if (!_cacheInv) _cacheInv = [];
    var ids = {}; _cacheInv.forEach(function(x){ if (x && x.id) ids[x.id] = 1; });
    var synced = _getSynced();
    locales.forEach(function(d){
        // Solo recuperar/re-subir borradores que NUNCA se sincronizaron. Si ya estuvo
        // en la nube y ahora no está, fue BORRADO en otro equipo → no resucitar.
        if (d && d.id && !ids[d.id] && !synced[d.id]) {
            _cacheInv.push(d);
            try { _sbUpInv(d); } catch(e) {} // re-subir: una vez que la nube funcione (v17), se sincroniza solo
        }
    });
}

function setInventarios(d) {
    var prev = _cacheInv || [];
    _cacheInv = d;
    _guardarDraftsLocal(); // respaldo inmediato del borrador (sobrevive al refresh)
    // Upsert changed/added records
    d.forEach(function(inv) {
        var old = prev.find(function(x){ return x.id === inv.id; });
        if (!old || JSON.stringify(old) !== JSON.stringify(inv)) _sbUpInv(inv);
    });
    // Delete removed records
    prev.forEach(function(inv) {
        if (!d.find(function(x){ return x.id === inv.id; })) _sbDelInv(inv.id);
    });
    return true; // ya no falla por quota
}

// ── Respaldo local de entradas (entradas_log) ──────────────────────
// Mismo problema que los inventarios: si el upsert a la nube falla/tarda, al
// refrescar se perdían. Respaldo en localStorage + merge (y re-subida) al cargar.
function _guardarELLocal() {
    try { localStorage.setItem(_sk('el_local'), JSON.stringify(_cacheEL || [])); } catch(e) {}
}
function _cargarELLocal() {
    try { return JSON.parse(localStorage.getItem(_sk('el_local')) || '[]') || []; } catch(e) { return []; }
}
function _mergeELLocal() {
    var locales = _cargarELLocal();
    if (!locales.length) return;
    if (!_cacheEL) _cacheEL = [];
    var ids = {}; _cacheEL.forEach(function(x){ if (x && x.id) ids[x.id] = 1; });
    locales.forEach(function(e){ if (e && e.id && !ids[e.id]) { _cacheEL.push(e); try { _sbUpEL(e); } catch(err){} } });
}

function setEntradasLog(d) {
    var prev = _cacheEL || [];
    _cacheEL = d;
    _guardarELLocal(); // respaldo inmediato (sobrevive al refresh)
    // Upsert new entries
    d.forEach(function(e) {
        if (!prev.find(function(x){ return x.id === e.id; })) _sbUpEL(e);
    });
    // Delete removed entries
    prev.forEach(function(e) {
        if (!d.find(function(x){ return x.id === e.id; })) _sbDelEL(e.id);
    });
}
function genId()          { return Date.now().toString(36) + Math.random().toString(36).slice(2,5); }

// ── Estado global ─────────────────────────────────────────────
let invActual    = null;
let filasCaptura = [];
let pasoActual   = 1;

// Vista lista
let modoHistorial   = 'todos';
let anioVista       = new Date().getFullYear();
let mesSeleccionado = null;
let modoListaHist   = 'lista';

// Vista captura
let modoListaCapt  = 'lista';
let busquedaCapt   = '';
let filtroFamActivo = '';
let filtroCatActiva = '';
let filtroSubcatActiva = '';
let filtroRegistroActivo = 'pendientes'; // 'pendientes' | 'registrados'

// Paso 4 — tab activo
let _paso4Tab = 'cancelaciones';

// Vista entradas rápidas
let _entRapidaInsumoId  = null;
let _entRapidaTipo      = 'compra';
let _entRapidaBusqueda  = '';

// Ficha técnica
let _ftInsumoId = null;

// Vista existencias paso 1 — default: búsqueda rápida
let vistaCapturaExist = 'busqueda'; // 'busqueda' | 'lista'
let _existBusqueda    = '';
let _existInsumoId    = null;

// Vista entradas paso 2 — default: búsqueda rápida
let vistaEntradas2 = 'busqueda'; // 'busqueda' | 'lista'

// Vista ventas paso 3 — default: menú
let vistaVentas    = 'menu';     // 'menu' | 'lista' | 'busqueda'
let _ventasBusqueda = '';
let _ventasInsumoId = null;

// ── Constantes ────────────────────────────────────────────────
const OZ_ML    = 29.5735;
const COPA_STD = {
    'destilados': 44.36, 'licores': 29.57, 'vinos': 147.87,
    'espumosos':  88.72, 'cervezas': 355,  'default': 44.36
};
// Tamaño de copa (ml) del insumo: respeta el explícito; si no, lo deduce por
// tipoInsumo/categoría/subcategoría. Antes solo miraba categoría → vinos con
// categoría "Blanco/Tinto" caían al default de licor y descuadraban las copas.
function _copaMLInsumo(ins) {
    if (!ins) return COPA_STD.default;
    if (ins.tamanoCopa) { var tc = parseFloat(ins.tamanoCopa)||0; if (tc > 0) return (ins.umTamanoCopa||'ML').toUpperCase()==='OZ' ? tc*OZ_ML : tc; }
    var t = (ins.tipoInsumo||'').toLowerCase();
    if (t === 'vino')      return COPA_STD.vinos;
    if (t === 'licor')     return COPA_STD.licores;
    if (t === 'destilado') return COPA_STD.destilados;
    var hay = ((ins.categoria||'') + ' ' + (ins.subcategoria||'')).toLowerCase();
    if (hay.indexOf('espumos')>=0 || hay.indexOf('cava')>=0 || hay.indexOf('champ')>=0 || hay.indexOf('prosecco')>=0) return COPA_STD.espumosos;
    if (hay.indexOf('vino')>=0)     return COPA_STD.vinos;
    if (hay.indexOf('licor')>=0)    return COPA_STD.licores;
    if (hay.indexOf('destilad')>=0) return COPA_STD.destilados;
    return COPA_STD.default;
}
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const TIPOS_ICON = { primer_lev:'📋', bebidas:'🍸', alimentos:'🍽️', almacen:'📦', restaurante:'🏪', otro:'📋' };

// Grupo grande de categoría para los reportes (legibilidad): Destilados, Licores, Vinos,
// Cervezas, Refrescos/Sodas, Alimentos, Otros. Usa tipoInsumo y, si falta (p.ej. insumos
// convertidos sin categoría), cae a heurística por subcategoría/categoría.
function _grupoCategoria(f) {
    if (!f) return 'Otros';
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(f.insumoId) : null;
    var t = ((ins && ins.tipoInsumo) || f.tipoInsumo || '').toLowerCase();
    if (t === 'destilado') return 'Destilados';
    if (t === 'licor')     return 'Licores';
    if (t === 'vino')      return 'Vinos';
    if (t === 'cerveza' || t === 'cerveza_barril') return 'Cervezas';
    if (t === 'refresco')  return 'Refrescos / Sodas';
    var fam = ((ins && ins.familia) || f.familia || '').toLowerCase();
    if (fam.indexOf('aliment') >= 0 || f.tipo === 'peso') return 'Alimentos';
    var hay = (((ins && ins.subcategoria) || f.subcategoria || '') + ' ' + ((ins && ins.categoria) || f.categoria || '')).toLowerCase();
    if (/espumos|cava|champ|prosecco/.test(hay)) return 'Vinos';
    if (/vino|tinto|blanco|ros[eé]|cabernet|merlot|syrah|garnacha|grigio/.test(hay)) return 'Vinos';
    if (/cerveza|lager|ale|stout|pilsner/.test(hay)) return 'Cervezas';
    if (/refresco|soda|agua|jugo|t[oó]nica|sifon/.test(hay)) return 'Refrescos / Sodas';
    if (/licor|crema de|amaretto|triple sec|vermouth|aperol|campari|baileys/.test(hay)) return 'Licores';
    if (/destilad|tequila|mezcal|whisk|ron|ginebra|gin|vodka|brandy|cognac|coñac/.test(hay)) return 'Destilados';
    return f.subcategoria || f.categoria || 'Otros';
}

// ── Helpers matemáticos ───────────────────────────────────────
function ingredienteML(cantidad, unidad) {
    const u = (unidad || 'ML').toUpperCase();
    if (u === 'OZ') return cantidad * OZ_ML;
    if (u === 'LT') return cantidad * 1000;
    return cantidad;
}

// ¿El inventario x puede servir de REFERENCIA (existencia anterior)?
// Sirve cualquier inventario ANTERIOR con datos capturados: cerrado, primer
// levantamiento (línea base), O un intermedio ABIERTO que ya se contó. Antes solo
// valían los cerrados/línea base → un intermedio abierto se saltaba y caía al primer lev.
function _esRefValida(x) {
    if (!x) return false;
    if (invActual && x.id === invActual.id) return false;                 // no a sí mismo
    if (invActual && String(x.fecha||'') > String(invActual.fecha||'9999-99-99')) return false; // solo anteriores/mismo día
    return x.cerrado || x.tipoInv === 'primer_lev' || (x.filas||[]).some(_filaConDatos);
}
function _refsDisponibles() {
    return _scopeSucInvs(getInventarios()).filter(_esRefValida)
        .slice().sort(function(a,b){ return String(a.fecha||'').localeCompare(String(b.fecha||'')); }); // viejo→nuevo
}
function _getRefInv() {
    const cands = _refsDisponibles();
    if (!cands.length) return null;
    if (invActual && invActual.refInventarioId) {
        const r = cands.find(x => x.id === invActual.refInventarioId);
        if (r) return r;
    }
    return cands[cands.length - 1]; // el más reciente ANTERIOR (no el primer lev si hay uno intermedio)
}
function getExistenciaAnterior(insumoId) {
    const inv = _getRefInv();
    if (!inv) return 0;
    const fila = (inv.filas || []).find(f => f.insumoId === insumoId);
    if (!fila) return 0;
    const ea = fila.existenciaFisica !== undefined ? fila.existenciaFisica : calcExistencia(fila);
    // Las copas dependen del tamaño de copa. Si la copa del insumo cambió desde el
    // inventario anterior (p.ej. vinos corregidos de 44ml→148ml), re-escalar: las copas
    // varían inversamente con el ml de copa, así no infla las botellas.
    if (fila.tipo === 'copa') {
        const ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(insumoId) : null;
        const copaNew = ins ? _copaMLInsumo(ins) : 0;
        const copaOld = parseFloat(fila.copaML) || 0;
        if (copaNew > 0 && copaOld > 0 && Math.abs(copaNew - copaOld) > 0.01) return ea * (copaOld / copaNew);
    }
    return ea;
}
// Self-heal del ref guardado: inventarios creados durante el bug "solo el primer
// levantamiento es referencia" quedaron con refInventarioId apuntando al primer lev
// AUNQUE ya existan inventarios más recientes → la existencia anterior salía de la
// línea base vieja y los cambios del inventario intermedio no se reflejaban.
// Si el ref guardado es el primer lev y hay un candidato más reciente → automático.
// Solo en inventarios ABIERTOS (los cerrados/históricos no se tocan).
function _sanearRefInv() {
    if (!invActual || !invActual.refInventarioId || invActual.cerrado || invActual._eraCerrado) return;
    var cands = _refsDisponibles();
    var sel  = cands.find(function(x){ return x.id === invActual.refInventarioId; });
    var last = cands[cands.length - 1];
    if (sel && last && sel.tipoInv === 'primer_lev' && last.id !== sel.id) {
        invActual.refInventarioId = ''; // '' = automático (el anterior más reciente)
    }
}
// Cambiar el inventario de referencia → recalcula la existencia anterior de todas las filas.
function onCambiarRefInv(id) {
    if (!invActual) return;
    invActual.refInventarioId = id || '';
    filasCaptura.forEach(function(f){ f.existenciaAnterior = getExistenciaAnterior(f.insumoId); });
    _setFechaUltimo();
    if (typeof _autoGuardar === 'function') _autoGuardar();
}

// Última fila de un inventario CERRADO previo (misma sucursal, distinto del actual)
// que contó este insumo → para copiar su existencia (desglose bodega/barra/pesos).
function _filaAnteriorInsumo(insumoId) {
    // Prioriza el inventario de referencia elegido; si ahí no está el insumo, busca el más reciente que sí lo tenga.
    var ref = _getRefInv();
    if (ref) {
        var fr = (ref.filas || []).find(function(x){ return x && x.insumoId === insumoId; });
        if (fr) return fr;
    }
    var cerrados = _scopeSucInvs(getInventarios()).filter(function(x){ return x && (x.cerrado || x.tipoInv === 'primer_lev') && (!invActual || x.id !== invActual.id); });
    for (var i = cerrados.length - 1; i >= 0; i--) {
        var f = (cerrados[i].filas || []).find(function(x){ return x && x.insumoId === insumoId; });
        if (f) return f;
    }
    return null;
}
// Copia la existencia del inventario anterior a la captura actual de esa fila.
function copiarExistenciaAnterior(idx) {
    var fila = filasCaptura[idx];
    if (!fila) return;
    var prev = _filaAnteriorInsumo(fila.insumoId);
    if (!prev) { alert('No hay un inventario anterior con este insumo.'); return; }
    if (fila.tipo === 'peso') {
        fila.existenciaPeso = (prev.existenciaPeso != null && prev.existenciaPeso !== '') ? prev.existenciaPeso
                            : (prev.existenciaFisica != null ? prev.existenciaFisica : '');
    } else {
        fila.cerradasBodega = prev.cerradasBodega || 0;
        fila.cerradasBarra  = prev.cerradasBarra  || 0;
        fila.pesos          = Array.isArray(prev.pesos) ? prev.pesos.slice() : (fila.pesos || ['','','','']);
        if (prev.metodoCaptura)    fila.metodoCaptura = prev.metodoCaptura;
        if (prev.nivelPct != null) fila.nivelPct      = prev.nivelPct;
    }
    _autoGuardar();
    if (typeof vistaCapturaExist !== 'undefined' && vistaCapturaExist === 'busqueda') renderCardExist();
    else renderStepContent();
}

// Botón "Copiar existencia anterior" — vacío si no hay inventario previo con el insumo.
function _btnCopiarAnterior(idx, fila, estilo) {
    var pf = _filaAnteriorInsumo(fila.insumoId);
    if (!pf) return '';
    var pe = pf.tipo === 'peso' ? (parseFloat(pf.existenciaPeso) || parseFloat(pf.existenciaFisica) || 0) : calcExistenciaBot(pf);
    var pu = pf.tipo === 'peso' ? (pf.baseUnit || 'g').toLowerCase() : (pf.tipo === 'pza' ? 'pza' : 'bot');
    var lbl = (pe % 1 === 0 ? pe.toFixed(0) : pe.toFixed(1)) + ' ' + pu;
    if (estilo === 'mini') {
        return '<button onclick="copiarExistenciaAnterior(' + idx + ')" title="Copiar existencia anterior (' + lbl + ')" '+
            'style="width:96px;margin-top:5px;background:rgba(122,184,245,.10);border:1px solid rgba(122,184,245,.45);color:#7ab8f5;border-radius:7px;padding:5px 0;font-family:inherit;font-size:10px;font-weight:600;cursor:pointer">📋 Copiar ant.</button>';
    }
    return '<button onclick="copiarExistenciaAnterior(' + idx + ')" '+
        'style="width:100%;margin-bottom:14px;background:rgba(122,184,245,.10);border:1px solid rgba(122,184,245,.5);color:#7ab8f5;border-radius:8px;padding:9px 0;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">📋 Copiar existencia anterior (' + lbl + ')</button>';
}

// ── Índice inverso de consumo por insumo (rendimiento) ──────────────────────
// Antes cada calcVentas*Recetas recorría TODAS las recetas por CADA insumo → O(insumos×recetas)
// en cada render (lento con 200+ insumos). Ahora se recorren las recetas UNA vez y se acumula por
// insumo; la consulta por fila es O(1). Se re-calcula solo si cambian recetas o lo vendido.
var _consumoIdxCache = null, _consumoIdxKey = '', _consumoDirty = true; window._step5Dirty = true;
function _consumoIdx() {
    var vendidos = (invActual && invActual.cocktailsVendidos) || {};
    var recetas  = getRecetas();
    // Llave BARATA + dirty-flag: antes la llave hacía JSON.stringify(vendidos) en
    // CADA llamada (200 filas × varios cálculos por render = miles de stringify)
    // — parte importante de la lentitud del Paso 5. Los 3 puntos que escriben
    // cocktailsVendidos marcan _consumoDirty.
    var key = (invActual && invActual.id || '') + '|' + recetas.length;
    if (_consumoIdxCache && !_consumoDirty && _consumoIdxKey === key) return _consumoIdxCache;
    var idx = {};
    function slot(id){ return idx[id] || (idx[id] = { mlBeb:0, baseAli:0, pzaDir:0, mlPza:0 }); }
    recetas.forEach(function(r){
        var uds = parseFloat(vendidos[r.id]) || 0;
        if (!uds) return;
        var esBeb = r.tipo === 'bebidas', esAli = r.tipo === 'alimentos', activa = r.status !== 'inactiva';
        if (!esBeb && !esAli) return;
        (r.ingredientes || []).forEach(function(ing){
            var id = ing.insumoId; if (!id) return;
            var cant = parseFloat(ing.cantidad) || 0, u = (ing.unidad || '').toUpperCase();
            var s = slot(id);
            if (esBeb)            s.mlBeb   += ingredienteML(cant, ing.unidad) * uds;      // copas (bebidas, cualquier estatus)
            if (esAli && activa)  s.baseAli += ingredienteBase(cant, ing.unidad) * uds;    // alimentos activos (unidad base)
            if (activa) {                                                                   // pza (bebidas+alimentos activos)
                if (u === 'PZA' || u === 'PZ' || u === '') s.pzaDir += cant * uds;
                else                                       s.mlPza  += ingredienteML(cant, ing.unidad) * uds;
            }
        });
    });
    _consumoIdxCache = idx; _consumoIdxKey = key; _consumoDirty = false;
    return idx;
}
function calcVentasCopasRecetas(insumoId, copaML) {
    if (!copaML || copaML <= 0) return 0;
    var s = _consumoIdx()[insumoId];
    return s ? s.mlBeb / copaML : 0;
}

// ── INVENTARIO DE ALIMENTOS: consumo teórico en unidad base (g/ml/pza) ──
// Convierte la cantidad de un ingrediente de receta a la unidad base chica.
function ingredienteBase(cantidad, unidad) {
    const u = (unidad || '').toUpperCase();
    if (u === 'KG' || u === 'LT') return cantidad * 1000; // a g / ml
    if (u === 'OZ') return cantidad * OZ_ML;              // a ml
    return cantidad;                                       // G, ML, PZA, PORCION… tal cual
}
// Unidad base de un insumo de alimentos según su presentación.
function unidadBaseInsumo(ins) {
    const p = ((ins && ins.presentaciones) || [])[0] || {};
    const u = (p.umContenido || '').toUpperCase();
    if (u === 'KG' || u === 'G') return 'G';
    if (u === 'LT' || u === 'ML') return 'ML';
    return 'PZA';
}
// Consumo teórico de un insumo por las recetas de ALIMENTOS vendidas (en unidad base).
function calcVentasBaseRecetas(insumoId) {
    var s = _consumoIdx()[insumoId];
    return s ? s.baseAli : 0; // g / ml / pza
}

// Consumo de un insumo PZA (refresco/cerveza/lata) por las recetas/menú vendidos, EN PIEZAS.
// Antes no se contaba (calcVentasCopasRecetas devuelve 0 si no hay copaML) → no descontaba.
function calcVentasPzaRecetas(insumoId) {
    var s = _consumoIdx()[insumoId];
    if (!s) return 0;
    const fila     = filasCaptura.find(f => f.insumoId === insumoId);
    const contNeto = fila ? (fila.contNeto || 0) : 0; // ml por pieza
    return s.pzaDir + (contNeto > 0 ? s.mlPza / contNeto : 0); // pza directa + (ml → piezas)
}

// ── PREBATCH: producción de batches (sub-receta→insumo) ──────────
// Insumos prebatch disponibles = sub-recetas convertidas a insumo.
// Respeta "incluir en inventario" (ocultoInventario) Y el ÁREA del inventario:
// sin área asignada, o de otra área, NO aparece en la Producción de prebatch (Paso 3).
function prebatchesProducibles() {
    return _scopeSucInsumos(getInsumos()).filter(function(x){ return x.esSubReceta && x.recetaId && !x.ocultoInventario && _insumoEnAreaInv(x); });
}
// Cuánto de un insumo BASE se consumió al producir batches (en su unidad base ml/g/pza).
function consumoBasesPorProduccion(insumoId) {
    var prod = (invActual && invActual.prebatchProducidos) || {};
    var total = 0;
    Object.keys(prod).forEach(function(pid) {
        var n = parseFloat(prod[pid]) || 0;
        if (!n) return;
        var pre = getInsumos().find(function(x){ return x.id === pid; });
        if (!pre || !pre.recetaId) return;
        var sr = getRecetas().find(function(r){ return r.id === pre.recetaId; });
        if (!sr) return;
        (sr.ingredientes || []).forEach(function(ing){
            if (ing.insumoId === insumoId)
                total += ingredienteBase(parseFloat(ing.cantidad) || 0, ing.unidad) * n; // x batch x #batches
        });
    });
    return total; // unidad base del ingrediente (ml / g / pza)
}
// Producción de ESTE insumo si es un prebatch, en la unidad de su fila (copas / base / pza).
function _prodPrebatchUnidades(fila) {
    var n = (invActual && invActual.prebatchProducidos && parseFloat(invActual.prebatchProducidos[fila.insumoId])) || 0;
    if (!n) return 0;
    // ml/g POR BATCH = rendimiento de la sub-receta (fila.rendimientoBatch). Fallback a
    // contNeto: antes de definir envase físico, contNeto ERA el rendimiento del batch.
    // (Con envase: contNeto = capacidad de la botella/garrafa, ≠ rendimiento del batch.)
    var rB = parseFloat(fila.rendimientoBatch) || fila.contNeto || 0;
    if (fila.tipo === 'copa') return n * (rB > 0 && fila.copaML > 0 ? rB / fila.copaML : 0); // batches→copas
    if (fila.tipo === 'peso') return n * rB; // batches→unidad base
    return n; // pza: 1 batch = 1 pza
}
// Consumo de ESTE insumo base por la producción de batches, en la unidad de su fila.
function _consumoBaseProd(fila) {
    var u = consumoBasesPorProduccion(fila.insumoId); // ml / g / pza base
    if (!u) return 0;
    if (fila.tipo === 'copa') return fila.copaML > 0 ? u / fila.copaML : 0; // base ml → copas
    return u; // peso (g/ml) y pza: directo
}

// ══ REPARTO DEL PREBATCH A SUS INSUMOS (Resultado — modelo de Edwin) ══════════
// El prebatch NO es una línea con diferencia propia en el Resultado: su contenido
// pertenece proporcionalmente a sus insumos según la sub-receta (100 Campari +
// 250 Aperol + 400 Vermouth). Cada insumo recibe su parte de TODO el prebatch:
// EA, entradas, ventas (cocteles hechos del batch), teórico restante y físico
// PESADO. La producción se cancela sola: el prodSub del insumo (base consumida
// al producir) se compensa con su parte del prodAdd del batch → neto, el insumo
// solo "pierde" lo que salió por ventas, y lo que sigue dentro de la botella
// pesada NO genera falso faltante. El faltante real del batch aparece
// proporcional en cada destilado.
function _repartoPrebatch() {
    var out = { porInsumo: {}, esPB: {}, lista: [] };
    (filasCaptura || []).forEach(function(pf){
        if (!pf || pf.tipo === 'pza' || pf.esCompuesto) return;
        var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(pf.insumoId) : null;
        if (!ins || !ins.esSubReceta || !ins.recetaId) return;
        var sr = getRecetas().find(function(r){ return r.id === ins.recetaId; });
        if (!sr || !(sr.ingredientes || []).length) return;
        // TOTAL = suma de TODOS los ingredientes de la sub-receta (rendimiento base),
        // no solo los ligados a un insumo. Así cada insumo recibe su proporción real
        // dentro del batch completo (ej. Aperol 60 de 1180 ml), no dentro del subconjunto
        // de alcoholes (bug: repartía 2500 entre 120 → 1250 c/u en vez de ~127 c/u).
        var partes = [], total = 0;
        (sr.ingredientes || []).forEach(function(ing){
            var b = ingredienteBase(parseFloat(ing.cantidad) || 0, ing.unidad); // → ml/g base
            if (b <= 0) return;
            total += b;                                        // todos cuentan para el rendimiento
            if (ing.insumoId) partes.push({ id: ing.insumoId, b: b }); // solo los ligados se reparten
        });
        if (!total) return;
        // Magnitudes del prebatch en unidad BASE (ml/g)
        var toB = pf.tipo === 'copa' ? (parseFloat(pf.copaML) || 0) : 1;
        if (pf.tipo === 'copa' && !toB) return;
        var eaB    = (parseFloat(pf.existenciaAnterior) || 0) * toB;
        var entB   = getEntradasCopas(pf) * toB;
        var ventaB = (calcVentasCopasRecetas(pf.insumoId, pf.copaML) + (parseFloat(pf.ventasCopasDirectas) || 0)) * toB
                   + (parseFloat(pf.ventasBotella) || 0) * (parseFloat(pf.contNeto) || 0);
        var cmB    = ((parseFloat(pf.cortesiaCopas) || 0) + (parseFloat(pf.mermaCopas) || 0)) * toB + (parseFloat(pf.mermaBase) || 0);
        var canB   = getCancelacionesCopas(pf.insumoId) * toB;
        var teoB   = calcExistenciaTeorica(pf) * toB;
        var fisB   = calcExistencia(pf) * toB;
        out.esPB[pf.insumoId] = 1;
        var desg = [];
        partes.forEach(function(p){
            var sh = p.b / total;
            var fi = filasCaptura.find(function(x){ return x.insumoId === p.id; });
            desg.push({ insumoId: p.id, nombre: fi ? fi.nombre : p.id, ml: fisB * sh });
            if (!fi) return; // ingrediente sin fila en este inventario → solo informativo
            var u = fi.tipo === 'copa' ? (parseFloat(fi.copaML) || 0) : (fi.tipo === 'pza' ? (parseFloat(fi.contNeto) || 0) : 1);
            if (fi.tipo !== 'peso' && !(u > 0)) return;
            var conv = function(v){ return (v * sh) / (fi.tipo === 'peso' ? 1 : u); }; // base → unidad de la fila
            var a = out.porInsumo[p.id] || (out.porInsumo[p.id] = { ea:0, ent:0, vco:0, cm:0, can:0, teo:0, fis:0, dif:0, venta:0 });
            a.ea  += conv(eaB);   a.ent += conv(entB);
            a.vco += conv(ventaB); a.venta += conv(ventaB);
            a.cm  += conv(cmB);   a.can += conv(canB);
            a.teo += conv(teoB);  a.fis += conv(fisB);
            a.dif += conv(fisB - teoB);
        });
        out.lista.push({ insumoId: pf.insumoId, nombre: pf.nombre, fisML: fisB, teoML: teoB, desglose: desg });
    });
    return out;
}
var _repCache = null;
var _repZero  = { ea:0, ent:0, vco:0, cm:0, can:0, teo:0, fis:0, dif:0, venta:0 };
function _repartoDe(id) { return (_repCache && _repCache.porInsumo[id]) || _repZero; }
function _esPrebatchRepartido(id) { return !!(_repCache && _repCache.esPB[id]); }

// ── Fuzzy match cancelación → insumo ─────────────────────────
function _normMatch(s) {
    return (s || '').toString()
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\b\d+\s*(?:ml|oz|lt|lts|cl|g|kg|cc)\b/gi, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function _matchInsumo(nombreProducto) {
    if (!nombreProducto || !filasCaptura.length) return null;
    const q      = _normMatch(nombreProducto);
    const words  = q.split(' ').filter(p => p.length >= 3);
    if (!words.length) return null;
    let best = null, bestScore = 0;
    filasCaptura.forEach(fila => {
        const n = _normMatch(fila.nombre);
        let score = 0;
        words.forEach(w => { if (n.includes(w)) score++; });
        if (n.includes(q) || q.includes(n)) score += 0.5;
        if (score > bestScore) { bestScore = score; best = fila; }
    });
    return bestScore > 0 ? best : null;
}

var _autoMatchFirma = '';
function _autoMatchCancelaciones() {
    const lista = invActual?.cancelaciones || [];
    // Guarda: si no hay cancelaciones sin insumoId nuevas, no hay nada que hacer.
    // (Antes corría el matching de texto completo EN CADA llamada — y se llama
    // por fila en el Paso 5/reporte → era el retraso de varios segundos.)
    const firma = (invActual?.id || '') + '|' + lista.length + '|' + lista.reduce((s,c)=>s+(c.insumoId?0:1),0);
    if (firma === _autoMatchFirma) return;
    lista.forEach(c => {
        if (!c.insumoId) {
            const m = _matchInsumo(c.nombreProducto);
            if (m) { c.insumoId = m.insumoId; c.insumoNombre = m.nombre; }
        }
    });
    _autoMatchFirma = (invActual?.id || '') + '|' + lista.length + '|' + lista.reduce((s,c)=>s+(c.insumoId?0:1),0);
}

function getCancelacionesCopas(insumoId) {
    _autoMatchCancelaciones(); // idempotente y con guarda: solo trabaja si hay cancelaciones nuevas
    const fila = _filaDe(insumoId);
    return (invActual?.cancelaciones || [])
        .filter(c => {
            if (c.insumoId) return c.insumoId === insumoId;
            // legacy fallback
            return fila && c.nombreProducto &&
                fila.nombre.toLowerCase().includes(c.nombreProducto.toLowerCase().split(' ')[0]);
        })
        .reduce((s, c) => s + (parseFloat(c.cantidad) || 0), 0);
}

// Pesos ingresados en KG; pesoCristal almacenado en gramos → convertir a KG
function calcNetLiters(fila) {
    const metodo = fila.metodoCaptura || 'peso';
    if (metodo === 'nivel') {
        const pct = parseFloat(fila.nivelPct) || 0;
        return (pct / 100) * (fila.contNeto || 0) / 1000; // contNeto en mL → litros
    }
    const pcKg = (fila.pesoCristal || 0) / 1000;
    return (fila.pesos || []).reduce((s, p) => {
        const n = parseFloat(p) || 0;
        return n > 0 ? s + Math.max(0, n - pcKg) : s;
    }, 0);
}

function calcMLReales(fila) {
    return calcNetLiters(fila) * 1000;
}

function calcExistenciaBot(fila) {
    if (fila.tipo === 'peso') return parseFloat(fila.existenciaPeso) || 0; // alimentos: conteo en unidad base
    const cerradas = (fila.cerradasBodega || 0) + (fila.cerradasBarra || 0);
    const mlReales = calcMLReales(fila);
    if (fila.tipo === 'pza') return cerradas + (mlReales > 0 ? 1 : 0);
    const contNeto = fila.contNeto || 0;
    if (contNeto <= 0) return cerradas;
    return cerradas + mlReales / contNeto;
}

function calcExistencia(fila) {
    if (fila.esCompuesto) return fila._existCopas || 0; // producto compuesto: suma de miembros (copas)
    if (fila.tipo === 'peso') return parseFloat(fila.existenciaPeso) || 0; // alimentos: conteo en unidad base
    const cerradas = (fila.cerradasBodega || 0) + (fila.cerradasBarra || 0);
    const mlReales = calcMLReales(fila);
    if (fila.tipo === 'pza') return cerradas + (mlReales > 0 ? 1 : 0);
    const copasBot   = fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0;
    const copasAbier = fila.copaML > 0 ? mlReales / fila.copaML : 0;
    return cerradas * copasBot + copasAbier;
}

function calcExistenciaTeorica(fila) {
    if (fila.esCompuesto) return fila._teoricoCopas || 0; // producto compuesto
    // Alimentos (unidad base): existencia anterior + entradas − consumo por recetas − merma.
    // Prebatch: + lo producido (si esta fila es un prebatch) / − lo consumido al producir batches (si es base).
    const prodAdd = _prodPrebatchUnidades(fila);
    const prodSub = _consumoBaseProd(fila);
    if (fila.tipo === 'peso') {
        const eaP    = parseFloat(fila.existenciaAnterior) || 0;
        const entP   = getEntradasBottles(fila.insumoId);     // entradas en unidad base
        const ventP  = calcVentasBaseRecetas(fila.insumoId);  // consumo por platillos vendidos
        const mermaP = parseFloat(fila.mermaBase) || 0;
        return eaP + entP + prodAdd - ventP - mermaP - prodSub;
    }
    const ea          = parseFloat(fila.existenciaAnterior) || 0;
    const ventasRec   = calcVentasCopasRecetas(fila.insumoId, fila.copaML);
    const ventasDir   = parseFloat(fila.ventasCopasDirectas) || 0;
    const cancelCopas = getCancelacionesCopas(fila.insumoId);
    const cortesia    = parseFloat(fila.cortesiaCopas) || 0;
    const merma       = parseFloat(fila.mermaCopas) || 0;
    const totalCopas  = ventasRec + ventasDir + cancelCopas + cortesia + merma;
    const entTotal    = getEntradasCopas(fila);
    if (fila.tipo === 'pza') {
        const ventaPzaRec = calcVentasPzaRecetas(fila.insumoId);     // venta por menú/recetas (piezas)
        const ventaPzaDir = parseFloat(fila.ventasCopasDirectas) || 0; // venta directa por pieza (campo "Pzas")
        return ea + entTotal + prodAdd
            - (fila.ventasBotella || 0) - ventaPzaDir - ventaPzaRec
            - cancelCopas - cortesia - merma - prodSub;
    }
    return ea + entTotal + prodAdd - totalCopas - prodSub - (fila.ventasBotella || 0) * (fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0);
}

// Índice fila-por-insumo (se reconstruye si cambia el arreglo o su tamaño):
// getEntradasBottles/getCancelacionesCopas se llaman POR FILA en el Paso 5 y el
// reporte — con .find lineal eran O(filas²) y tardaban segundos con 200+ insumos.
var _filaIdxCache = null, _filaIdxRef = null, _filaIdxLen = -1;
function _filaDe(insumoId) {
    if (_filaIdxRef !== filasCaptura || _filaIdxLen !== filasCaptura.length || !_filaIdxCache) {
        _filaIdxCache = {};
        filasCaptura.forEach(f => { if (f && f.insumoId) _filaIdxCache[f.insumoId] = f; });
        _filaIdxRef = filasCaptura; _filaIdxLen = filasCaptura.length;
    }
    return _filaIdxCache[insumoId];
}

function getEntradasBottles(insumoId) {
    const fila    = _filaDe(insumoId);
    const deFilas = fila ? (fila.entradas || []).reduce((s, e) => s + (parseFloat(e)||0), 0) : 0;
    const deLog   = (invActual?.entradasLog || [])
        .filter(e => e.insumoId === insumoId)
        .reduce((s, e) => s + (parseFloat(e.cantidad)||0), 0);
    return deFilas + deLog;
}

// ── Auto-importar las entradas del QR al inventario en curso (Opción A) ──────
// Las entradas del QR viven en la tabla global (entradas_log/_cacheEL) con origen:'qr'.
// El inventario calcula entradas desde invActual.entradasLog, así que hay que copiarlas.
// Se importan SOLO las del QR (las manuales ya se guardan en ambos lados), SOLO las de esta
// sucursal, y SOLO las no importadas aún (se marca importadoEnInv para no duplicar entre inventarios).
// Sucursal activa ('' = matriz / sin sucursal). Helper local: inventarios.js no
// carga los de ventas/gastos y las funciones de QR por sucursal lo necesitan.
function _sucActiva() { return localStorage.getItem('etaax_sucursal_activa') || ''; }

// PERIODO del inventario activo: de la fecha de la REFERENCIA (exclusivo) a la fecha
// del inventario (inclusivo). Una entrada pertenece al inventario cuyo periodo cubre
// su fecha → así el primer inventario que abras no se traga TODAS las entradas.
function _enPeriodoInvActual(fecha) {
    if (!invActual) return true;
    var refI = _getRefInv();
    var from = refI ? String(refI.fecha || '') : '';
    var to   = String(invActual.fecha || '9999-99-99');
    var f = String(fecha || ''); if (!f) return true;   // sin fecha: no la excluimos (compat)
    if (from && f <= from) return false;                 // antes/igual que la referencia → de otro periodo
    return f <= to;                                       // hasta la fecha del inventario
}

// Recalcula FRESCO (idempotente) la merma/cortesía-préstamo del QR por insumo, en su
// PROPIO tracking (_qrMerma/_qrCort/_qrBase). El total que leen todos y la fórmula del
// candado (mermaCopas/cortesiaCopas/mermaBase) = MANUAL + QR. Reemplaza el viejo dedupe
// por importadoEnInv que dejaba mermas ATORADAS (una vez importadas a un inventario, si su
// suma se perdía —p.ej. la fila se cayó por el filtro de área— ya nunca reaparecían).
function _recomputarMovsQR() {
    if (!invActual || !Array.isArray(filasCaptura) || !filasCaptura.length) return;
    var suc = _sucActiva();
    var byIns = {};
    (getEntradasLog() || []).forEach(function(e){
        if (!e || e.borrada || !e.insumoId) return;
        if (e.concepto !== 'merma' && e.concepto !== 'salida') return;
        if (e.mermaTipo === 'producto' || e.recetaId) return; // productos → mermasProductoQR
        if (e.sucursalId && suc && e.sucursalId !== suc) return; // sello de sucursal
        if (!_enPeriodoInvActual(e.fecha)) return;               // periodo de este inventario
        (byIns[e.insumoId] = byIns[e.insumoId] || []).push(e);
    });
    filasCaptura.forEach(function(f){
        var arr = byIns[f.insumoId] || [];
        var m = 0, c = 0, b = 0, concQR = [];
        arr.forEach(function(e){
            var cant = parseFloat(e.cantidad) || 0; if (!(cant > 0)) return;
            var u = (e.unidad || '').toLowerCase();
            var esMerma = e.concepto === 'merma';
            var val;
            if (f.tipo === 'peso') {
                val = cant; if (u === 'botella') val = f.contNeto > 0 ? cant * f.contNeto : cant;
                b += val; // peso: merma y salida van a la unidad base
            } else if (f.tipo === 'pza') {
                val = cant; if (u === 'ml') val = f.contNeto > 0 ? cant / f.contNeto : cant;
                if (esMerma) m += val; else c += val;
            } else { // copa
                var copasBot = (f.contNeto > 0 && f.copaML > 0) ? f.contNeto / f.copaML : 0;
                val = cant;
                if (u === 'oz') val = f.copaML > 0 ? cant * OZ_ML / f.copaML : cant;
                else if (u === 'ml') val = f.copaML > 0 ? cant / f.copaML : cant;
                else if (u === 'botella' || u === 'pza') val = copasBot ? cant * copasBot : cant;
                if (esMerma) m += val; else c += val;
            }
            if (!esMerma) concQR.push((e.salidaTipo === 'prestamo' ? '🔁 Préstamo' : '🎁 Cortesía') + (e.notas ? ': ' + e.notas : ''));
        });
        if (concQR.length) f.cortesiaConcepto = concQR.join(' · '); // concepto de cortesías/préstamos del QR
        // Derivar el MANUAL quitando la contribución PREVIA del QR. En la 1ª pasada (migración)
        // el QR previo aún no existe → se usa el FRESCO (= lo que la vieja lógica ya había sumado),
        // así NO se duplica lo antes importado y SÍ reaparece lo que se había perdido/atorado.
        var prevM = (f._qrMerma !== undefined) ? (parseFloat(f._qrMerma) || 0) : m;
        var prevC = (f._qrCort  !== undefined) ? (parseFloat(f._qrCort)  || 0) : c;
        var prevB = (f._qrBase  !== undefined) ? (parseFloat(f._qrBase)  || 0) : b;
        f.mermaManual     = Math.max(0, (parseFloat(f.mermaCopas)    || 0) - prevM);
        f.cortesiaManual  = Math.max(0, (parseFloat(f.cortesiaCopas) || 0) - prevC);
        f.mermaBaseManual = Math.max(0, (parseFloat(f.mermaBase)     || 0) - prevB);
        f._qrMerma = m; f._qrCort = c; f._qrBase = b;
        f.mermaCopas    = f.mermaManual     + m;
        f.cortesiaCopas = f.cortesiaManual  + c;
        f.mermaBase     = f.mermaBaseManual + b;
    });
}

function _importarEntradasQR() {
    if (!invActual || invActual.cerrado || window._soloVistaInv) return 0; // 👁️ solo lectura: no muta el inventario
    if (!invActual.entradasLog) invActual.entradasLog = [];
    var idsSuc = {}; _scopeSucInsumos(getInsumos()).forEach(function(x){ if (x && x.id) idsSuc[x.id] = 1; });
    var yaEnInv = {}; invActual.entradasLog.forEach(function(e){ if (e && e.id) yaEnInv[e.id] = 1; });
    // Sacar de ESTE inventario las entradas (QR o manuales del ERP) mal importadas
    // (fuera de su periodo) → quedan libres para que el inventario correcto las reclame.
    var _globalIds = {}; (getEntradasLog() || []).forEach(function(g){ if (g && g.id && g.concepto !== 'merma' && g.concepto !== 'salida') _globalIds[g.id] = 1; });
    invActual.entradasLog = invActual.entradasLog.filter(function(le){
        return !(le && le.id && _globalIds[le.id] && !_enPeriodoInvActual(le.fecha));
    });
    yaEnInv = {}; invActual.entradasLog.forEach(function(e){ if (e && e.id) yaEnInv[e.id] = 1; });
    var n = 0;
    (getEntradasLog() || []).forEach(function(e) {
        if (!e) return;                        // QR y manuales del ERP: ambas se importan por periodo
        // Sello de sucursal: si el registro trae sucursal y NO es la activa, no se importa aquí
        var _sucImp = _sucActiva();
        if (e.sucursalId && _sucImp && e.sucursalId !== _sucImp) return;
        if (!_enPeriodoInvActual(e.fecha)) return;   // periodo: pertenece a OTRO inventario
        if (e.id && yaEnInv[e.id]) return;      // ya está en este inventario
        if (e.borrada) return; // borrada a propósito por el usuario (flag explícito).
        // OJO: NO usamos importadoEnInv como candado — confundía "borrada" con "no
        // persistió": tras finalizar/reabrir, el push al log a veces no se guardaba en
        // Supabase y la entrada quedaba marcada importadoEnInv=<este inv> pero AUSENTE del
        // log → se saltaba para siempre. Ahora el yaEnInv (arriba) evita duplicados cuando
        // sí persistió, y si se perdió, se re-clama. El borrado real usa `borrada`.
        // ── MERMAS de PRODUCTO del menú (QR): se listan en el reporte (no descuentan
        //    insumos). Las mermas de INSUMO y las SALIDAS (cortesía/préstamo) las recalcula
        //    _recomputarMovsQR() fresco por render (abajo) → ya no se atoran ni se pierden.
        if (e.concepto === 'merma') {
            var cantMP = parseFloat(e.cantidad) || 0;
            if (cantMP > 0 && (e.mermaTipo === 'producto' || e.recetaId)) {
                if (!invActual.mermasProductoQR) invActual.mermasProductoQR = [];
                if (!invActual.mermasProductoQR.some(function(x){ return x.id === e.id; })) {
                    invActual.mermasProductoQR.push({ id: e.id, recetaId: e.recetaId || '',
                        nombre: e.nombre || '—', cantidad: cantMP, unidad: e.unidad || 'pza',
                        motivo: e.motivo || '', fecha: e.fecha || '', foto_url: e.foto_url || '', foto_urls: e.foto_urls || [] });
                    n++;
                }
            }
            return; // mermas de INSUMO → _recomputarMovsQR
        }
        if (e.concepto === 'salida') return; // salidas de insumo → _recomputarMovsQR
        // (Ya pasó el SELLO de sucursal y el PERIODO). NO exigimos que el insumo esté
        // en el scope activo (idsSuc): si su membresía cambió o quedó fuera del scope,
        // ocultar una entrada YA capturada es peor que mostrarla. Si el insumo no es una
        // fila de este inventario simplemente no se atribuye a ninguna existencia
        // (getEntradasBottles filtra por insumoId); el sello de sucursal es la defensa.
        invActual.entradasLog.push({
            id: e.id, insumoId: e.insumoId,
            nombreProducto: e.nombre || '—',
            cantidad: parseFloat(e.cantidad) || 0,
            costo: parseFloat(e.costo) || 0,
            tipo: e.tipo || '', notas: e.notas || '',
            fecha: e.fecha || '', origen: e.origen || 'manual',
            sucursalId: e.sucursalId || _sucActiva() || '', // sello: hereda la sucursal del registro
            foto_url: e.foto_url || '',         // evidencia visual del QR (1ª foto)
            foto_urls: e.foto_urls || []        // lote: varias fotos de evidencia
        });
        e.importadoEnInv = invActual.id;        // marcar el registro global para no re-importar
        try { _sbUpEL(e); } catch(err) {}
        n++;
    });
    // Merma/cortesía-préstamo de INSUMO (QR): se recalculan frescas por render (idempotente),
    // así siempre se reflejan en el reporte aunque el insumo entre después (por área, etc.).
    try { _recomputarMovsQR(); } catch(err) { console.warn('[recomputar movs QR]', err); }
    if (n) { try { guardarInventario(); } catch(err) {} } // persiste con el candado anti-borrado
    // BACK-FILL al log global: entradas que viven SOLO en el inventario (búsqueda rápida
    // vieja, que no espejaba al log global) → subirlas para que aparezcan en el "Registro
    // de entradas" global. Idempotente (dedupe por id); reconcilia la divergencia histórica.
    try {
        var _glob = {}; (getEntradasLog() || []).forEach(function(g){ if (g && g.id) _glob[g.id] = 1; });
        var _gl = getEntradasLog(); var _added = false;
        (invActual.entradasLog || []).forEach(function(le){
            if (!le || !le.id || _glob[le.id]) return; // ya está en el log global
            _gl.push({
                id: le.id, insumoId: le.insumoId || '',
                nombre: le.nombreProducto || le.nombre || '—', familia: '',
                cantidad: parseFloat(le.cantidad) || 0, costo: parseFloat(le.costo) || 0,
                tipo: le.tipo || '', notas: le.notas || '', fecha: le.fecha || '',
                origen: le.origen || 'manual',
                foto_url: le.foto_url || '', foto_urls: le.foto_urls || [],
                sucursalId: le.sucursalId || _sucActiva() || 'suc_principal',
                importadoEnInv: invActual.id, registrado: new Date().toISOString()
            });
            _glob[le.id] = 1; _added = true;
            try { _sbUpEL(_gl[_gl.length - 1]); } catch(e) {} // el diff no ve el push → forzar
        });
        if (_added) _guardarELLocal();
    } catch(e) { console.warn('[backfill log global]', e); }
    return n;
}

// Unidad de la ENTRADA según la presentación de compra del insumo (no siempre "bot").
// Granel→L, Garrafa→garrafa, Pieza→pza, Botella→bot, etc. Así la entrada se lee en su presentación real.
var _UCOMPRA = { 'Botella':'bot', 'Garrafa':'garrafa', 'Lata':'lata', 'Pieza':'pza', 'Barril':'barril', 'Caja':'caja', 'Paquete':'paq', 'Costal':'costal', 'Bolsa':'bolsa' };
function _unidadCompra(o) {
    if (!o) return 'bot';
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(o.insumoId) : null;
    var p   = ins && ins.presentaciones && ins.presentaciones[0];
    // 1) Unidad de COMPRA real (la "Unidad" junto a Cantidad en la presentación de compra).
    //    Si se compra por volumen/peso, ESA es la unidad de la entrada (ej. LT → litros).
    // OJO paréntesis: si p/ins es null (insumo borrado o de otra sucursal → no
    // resuelve), (p && (p.x||'')) daba NULL y NULL.toString() lanzaba → congelaba
    // el reporte y vaciaba la lista de entradas. ((p && p.x) || '') defaultea a ''.
    var umP = ((p && p.umPresCompra) || '').toString().toUpperCase();
    if (umP === 'LT')  return 'L';
    if (umP === 'ML')  return 'ml';
    if (umP === 'KG')  return 'kg';
    if (umP === 'G' || umP === 'GR') return 'g';
    // 2) Se compra por pieza/contenedor → usar el empaque que ve el usuario (Garrafa, Botella, Lata…).
    var emp = ((ins && ins.empaque) || '').toString().toLowerCase();
    if (emp.indexOf('garrafa') >= 0) return 'garrafa';
    if (emp.indexOf('botella') >= 0) return 'bot';
    if (emp.indexOf('lata')    >= 0) return 'lata';
    if (emp.indexOf('barril')  >= 0) return 'barril';
    if (emp.indexOf('bolsa')   >= 0) return 'bolsa';
    if (emp.indexOf('caja')    >= 0) return 'caja';
    // 3) Presentación de compra (dropdown) como respaldo.
    var pc = ((p && p.presentacionCompra) || '').toString();
    if (_UCOMPRA[pc]) return _UCOMPRA[pc];
    if (pc && pc !== 'Pieza') return pc.toLowerCase();
    return o.tipo === 'pza' ? 'pza' : (o.tipo === 'peso' ? (o.baseUnit || 'u').toLowerCase() : 'bot');
}

function getEntradasCopas(fila) {
    const totalBot = getEntradasBottles(fila.insumoId);
    if (fila.tipo === 'pza') return totalBot;
    const copasBot = fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0;
    return totalBot * copasBot;
}

function getTotalEntradas(fila) {
    return (fila.entradas || []).reduce((s, e) => s + (parseFloat(e) || 0), 0);
}

function updEntrada(idx, ei, val) {
    if (!filasCaptura[idx].entradas) filasCaptura[idx].entradas = ['','','','',''];
    filasCaptura[idx].entradas[ei] = val;
    const total = getTotalEntradas(filasCaptura[idx]);
    const el    = document.getElementById('ent-tot-' + idx);
    if (el) {
        el.textContent = total > 0 ? '+' + (total % 1 ? total.toFixed(1) : total) + ' ' + _unidadCompra(filasCaptura[idx]) : '—';
        el.style.color = total > 0 ? 'var(--green)' : 'var(--text-dim)';
    }
    _autoGuardar();
}

function calcDiferencia(fila) { return calcExistencia(fila) - calcExistenciaTeorica(fila); }
// (semaforo() se eliminó: sin callers; el color por % vive en cada render con _pctVarianza.)

// ¿El insumo es refresco/cerveza/soda/agua? Revisa tipoInsumo, categoría Y subcategoría
// (algunos tienen categoría "No alcohólicas" y la pista está en la subcategoría).
function _esRefrescoCerveza(ins) {
    if (!ins) return false;
    var t = (ins.tipoInsumo || '').toLowerCase();
    if (['refresco','cerveza','cerveza_barril'].indexOf(t) >= 0) return true;
    var txt = ((ins.categoria || '') + ' ' + (ins.subcategoria || '')).toLowerCase();
    return txt.indexOf('refresco') >= 0 || txt.indexOf('cerveza') >= 0 || txt.indexOf('soda') >= 0 || txt.indexOf('agua') >= 0;
}
function costoCopa(fila) {
    // Usa el costo ACTUAL del insumo (refleja ediciones); si no, el congelado en la fila.
    var _ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(fila.insumoId) : null;
    var _p   = _ins && _ins.presentaciones && _ins.presentaciones[0];
    var cu       = (_p && parseFloat(_p.costoUnitario)) || fila.costoUnitario || 0;
    var costoPza = (_p && parseFloat(_p.costoPieza))    || fila.costoPieza    || 0;
    var umc      = ((_p && _p.umCosto) || '').toString().toUpperCase();

    // Refrescos/cervezas: SIEMPRE costo por pieza (aunque la captura los guardó como 'copa').
    if (fila.tipo !== 'peso' && !fila.esCompuesto && _esRefrescoCerveza(_ins) && costoPza > 0) return costoPza;

    // peso (alimentos): costo por unidad base (g/ml). costoUnitario viene en $/KG o $/LT.
    if (fila.tipo === 'peso') {
        if (umc === 'KG' || umc === 'LT') return cu / 1000;          // $/KG o $/LT → $/g o $/ml
        if (umc === 'G' || umc === 'GR' || umc === 'ML') return cu;  // ya viene por g/ml
        var cnP = fila.contNeto || 0; return cnP > 0 ? cu / cnP : cu;
    }
    // pza (refrescos/latas): costo de COMPRA por pieza, NO el costo por litro/ml.
    if (fila.tipo === 'pza') {
        if (costoPza > 0) return costoPza;
        return umc === 'ML' ? cu * (fila.contNeto || 0) : (fila.contNeto > 0 ? cu * fila.contNeto / 1000 : cu);
    }
    // copa (licor/destilados/vinos): costo por copa.
    return fila.copaML > 0 && cu > 0 ? cu * (fila.copaML / 1000) : cu;
}

// Devuelve la fila con los datos del insumo ACTUALIZADOS desde el catálogo (nombre, familia,
// presentación y costos), conservando las CANTIDADES CONTADAS. Así, editar un insumo (costo,
// presentación, nombre…) se refleja en cualquier inventario —incluso ya finalizado— sin recapturar.
// Si el insumo ya no existe o es compuesto, regresa la fila tal cual (su dato congelado).
function _filaLive(fila) {
    if (!fila || !fila.insumoId || fila.esCompuesto) return fila;
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(fila.insumoId) : null;
    if (!ins || ins.esCompuesto) return fila;
    var p = (ins.presentaciones && ins.presentaciones[0]) || {};
    var esFood = (ins.familia || '').toLowerCase().indexOf('aliment') >= 0;
    var esPza  = _esRefrescoCerveza(ins);
    var umP = (p.umContenido || 'ML').toUpperCase();
    var cn = parseFloat(p.contNeto) || 0;
    var contBase = (umP === 'LT' || umP === 'KG') ? cn * 1000 : cn;
    var m = Object.assign({}, fila); // conserva cerradas*, pesos, existenciaPeso, entradas, etc.
    m.nombre = ins.nombre + (ins.variedad ? ' ' + ins.variedad : '');
    m.categoria = ins.categoria || m.categoria || '';
    m.subcategoria = ins.subcategoria || m.subcategoria || '';
    m.familia = ins.familia || m.familia || '';
    m.tipo = esFood ? 'peso' : (esPza ? 'pza' : 'copa');
    var cml = _copaMLInsumo(ins); if (cml > 0) m.copaML = cml;
    if (contBase > 0) m.contNeto = contBase;
    m.pesoCristal = parseFloat(p.pesoCristal) || m.pesoCristal || 0;
    if (esFood) m.baseUnit = unidadBaseInsumo(ins);
    m.costoUnitario = parseFloat(p.costoUnitario) || parseFloat(p.precio) || m.costoUnitario || 0;
    m.costoPieza = parseFloat(p.costoPieza) || m.costoPieza || 0;
    m.precioCarta = parseFloat(p.precioCarta) || m.precioCarta || 0;
    return m;
}

function tipoIcon(tipo) { return TIPOS_ICON[tipo] || '📋'; }

function getFilasFiltradas(conRegistro = false) {
    const b = busquedaCapt.toLowerCase();
    return filasCaptura.filter(f =>
        !f._subReceta && // sub-recetas→insumo: solo en Producción de prebatch, no en la lista
        (!filtroFamActivo    || f.familia     === filtroFamActivo) &&
        (!filtroCatActiva    || f.categoria   === filtroCatActiva) &&
        (!filtroSubcatActiva || f.subcategoria === filtroSubcatActiva) &&
        (!conRegistro || (filtroRegistroActivo === 'registrados' ? _esRegistrado(f) : !_esRegistrado(f))) &&
        (!b || f.nombre.toLowerCase().includes(b))
    );
}

function getInventariosMes(anio, mes) {
    return _scopeSucInvs(getInventarios()).filter(inv => {
        if (!inv.fecha) return false;
        const [y, m] = inv.fecha.split('-').map(Number);
        return y === anio && m === mes;
    });
}

// ── Gestión de vistas ─────────────────────────────────────────
const VISTAS = ['vistaLista', 'vistaForm', 'vistaCaptura', 'vistaEntradas'];
// Flag explícito: ¿hay un inventario ABIERTO en edición? Se actualiza en CADA cambio
// de vista (única fuente de verdad para la navegación segura — sin depender del DOM).
window._invEditando = false;
function mostrarVista(id) {
    VISTAS.forEach(v => {
        const el = document.getElementById(v);
        if (el) el.style.display = v === id ? 'block' : 'none';
    });
    // Al volver a la LISTA, ningún inventario está activo. Blindaje anti-"reabrir el
    // primero": no importa por qué ruta se salga (finalizar, salir, cerrar tour, etc.),
    // aquí se garantiza que no quede un invActual/filasCaptura/soloVista colgando que el
    // siguiente "nuevo/continuar" pudiera reusar por error.
    if (id === 'vistaLista') { invActual = null; filasCaptura = []; window._soloVistaInv = false; }
    window._invEditando = (id !== 'vistaLista') && !!invActual && !invActual.cerrado;
    if (id === 'vistaLista')    init();
    if (id === 'vistaEntradas') renderVistaEntradas();
    if (typeof _ajustarStickyInv === 'function') setTimeout(_ajustarStickyInv, 0); // reposicionar sticky de la vista visible
}
function volverForm() { mostrarVista('vistaForm'); }

// Re-render según vista activa (wizard o registro entradas)
function rerenderCaptura() {
    if (document.getElementById('vistaEntradas')?.style.display !== 'none') {
        renderVistaEntradas();
    } else {
        renderStepContent();
    }
}

// ═══════════════════════════════════════════════════════════════
// VISTA LISTA
// ═══════════════════════════════════════════════════════════════
function renderStats() {
    const lista  = _scopeSucInvs(getInventarios());
    const ultimo = lista[lista.length - 1];
    document.getElementById('statInvs').textContent   = lista.length;
    document.getElementById('statUltimo').textContent = ultimo
        ? new Date(ultimo.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short'}) : '—';
    if (ultimo) {
        try { if ((ultimo.filas||[]).length) _calcCapitalesInv(ultimo); } catch(e){}
        document.getElementById('statCapital').textContent = '$'+_money2(ultimo.capitalCosto);
        const dif = ultimo.diferenciaCosto || 0;
        const el  = document.getElementById('statDif');
        el.textContent = (dif>=0?'+':'')+'$'+_money2(Math.abs(dif));
        el.style.color = dif >= 0 ? 'var(--green)' : 'var(--red)';
    } else {
        document.getElementById('statCapital').textContent = '$0';
        document.getElementById('statDif').textContent     = '—';
    }
}

function setModoHistorial(modo) {
    modoHistorial = modo;
    document.getElementById('tabTodos').classList.toggle('active', modo==='todos');
    document.getElementById('tabMes').classList.toggle('active', modo==='mes');
    const tw = document.getElementById('toggleHistWrap');
    if (tw) tw.style.display = modo==='todos' ? 'flex' : 'none';
    mesSeleccionado = null;
    renderHistorial();
}

function setModoListaHist(modo) {
    modoListaHist = modo;
    document.getElementById('btnHistLista').classList.toggle('active', modo==='lista');
    document.getElementById('btnHistGal').classList.toggle('active', modo==='galeria');
    renderHistorial();
}

// ═══════════════════════════════════════════════════════════════
// REPORTE — Existencias por área (cantidad + capital a costo proveedor + última fecha)
// ═══════════════════════════════════════════════════════════════
var _repArea = 'todas';
var _repSubcat = '';
function setReporteSubcat(s){ _repSubcat = s; _renderReporteExistencias(); }
// Filtra filas del reporte por subcategoría (o categoría) seleccionada.
function _filtraSubcatRep(rows){ return _repSubcat ? rows.filter(function(r){ return (r.subcat||'') === _repSubcat; }) : rows; }
var _repModoOp = false; // false = admin (con capital y totales) · true = operativa (sin dinero agregado)
var _repFusion = false; // true = Reporte FINAL (fusiona los productos compuestos)

// Aplica los productos compuestos: agrupa los miembros en una sola fila (suma en
// unidad base y muestra en la unidad definida). Lo demás sale igual.
function _fusionarRows(rows) {
    var comps = getCompuestos();
    if (!comps.length) return rows;
    var compDe = {}; comps.forEach(function(c){ (c.miembros||[]).forEach(function(m){ compDe[m] = c; }); });
    var acc = {}, out = [];
    rows.forEach(function(r){
        var c = compDe[r.insumoId];
        if (!c) { out.push(r); return; }
        var toBase = function(qty){ return r.tipo === 'copa' ? qty * (r.copaML || 0) : qty; }; // copas→ml; pza/peso ya en base
        if (!acc[c.id]) { acc[c.id] = { _comp:c, copaML:0, barraB:0, bodegaB:0, totalB:0, capBarra:0, capBodega:0, capital:0, fecha:'' }; out.push(acc[c.id]); }
        var fc = acc[c.id];
        if (!fc.copaML && r.copaML > 0) fc.copaML = r.copaML; // tamaño de copa del compuesto = el de sus presentaciones
        fc.barraB += toBase(r.barra); fc.bodegaB += toBase(r.bodega); fc.totalB += toBase(r.total);
        fc.capBarra += r.capBarra; fc.capBodega += r.capBodega; fc.capital += r.capital;
        if ((r.fecha||'') > fc.fecha) fc.fecha = r.fecha;
    });
    return out.map(function(r){
        if (!r._comp) return r;
        var c = r._comp;
        // Estándar único: el compuesto SIEMPRE se muestra en COPAS (ml acumulados ÷ copa),
        // sin importar la unidad que tuviera guardada de antes (lt/botella/…).
        var conv = function(b){ return r.copaML > 0 ? b / r.copaML : b; };
        var totU = conv(r.totalB);
        return { insumoId:'_comp_'+c.id, nombre:c.nombre, familia:'🧩 Compuesto', tipo:'_comp', unidadComp:'cop',
            barra:conv(r.barraB), bodega:conv(r.bodegaB), total:totU,
            costoUnit: totU>0 ? r.capital/totU : 0, capital:r.capital, capBarra:r.capBarra, capBodega:r.capBodega, fecha:r.fecha };
    });
}
// Compuestos del inventario ACTUAL (filasCaptura) → para el Reporte Directivo.
function _rowsCompuestosActual() {
    if (!getCompuestos().length) return [];
    var rows = [];
    filasCaptura.forEach(function(f){
        if (!f || !f.insumoId) return;
        var cc = costoCopa(f);
        var ins = getInsumos().find(function(x){ return x.id === f.insumoId; });
        var barra = _existenciaArea(f,'barra',ins), bodega = _existenciaArea(f,'bodega',ins), total = calcExistencia(f);
        if (barra<=0 && bodega<=0 && total<=0) return;
        rows.push({ insumoId:f.insumoId, nombre:f.nombre, familia:f.familia||f.categoria||'Otros', tipo:f.tipo,
            copaML:f.copaML, contNeto:f.contNeto, baseUnit:f.baseUnit, barra:barra, bodega:bodega, total:total,
            capital:total*cc, capBarra:barra*cc, capBodega:bodega*cc, costoUnit:0, fecha:'' });
    });
    return _fusionarRows(rows).filter(function(r){ return r.tipo === '_comp'; });
}
function _seccionCompuestosDirectivo() {
    var rows = _rowsCompuestosActual();
    if (!rows.length) return '';
    return '<div class="rd-sec">🧩 Productos compuestos</div>'+
        '<table class="rd-t" style="margin-bottom:14px"><thead><tr><th>Producto</th><th class="tr">Existencia</th><th class="tr">Capital</th></tr></thead><tbody>'+
        rows.map(function(r){ return '<tr><td style="font-weight:600">'+etx(r.nombre)+'</td><td class="tr">'+_fmtCant(r.total,r)+'</td><td class="tr" style="color:#1a7a46;font-weight:700">'+_repMoney(r.capital)+'</td></tr>'; }).join('')+
        '</tbody></table>';
}
function toggleReporteVista(){
    _repModoOp = !_repModoOp;
    var btn = document.getElementById('repVistaBtn');
    if (btn) btn.textContent = _repModoOp ? '🔒 Vista operativa' : '👁️ Vista admin';
    _renderReporteExistencias();
}
const _AREA_LBL = { barra:'Barra', bodega:'Bodega', cocina:'Cocina', general:'General' };
function _areaNom(a){ return _AREA_LBL[a] || (a ? (a.charAt(0).toUpperCase()+a.slice(1)) : 'General'); }

// Última existencia registrada de cada insumo (del inventario CERRADO más reciente
// que lo contó), acotado por área. Devuelve filas con cantidad, costo y capital.
// Existencia de UNA fila en un área dada (en la unidad de la fila: copas / pza / base).
// Licor/pza: botellas cerradas por área (la botella ABIERTA se cuenta en barra).
// Alimentos (peso): no se separan por bodega/barra → van al área del insumo (default cocina).
function _existenciaArea(fila, area, ins) {
    if (fila.tipo === 'peso') {
        var aIns = (ins && ins.area) || 'cocina';
        return area === aIns ? (parseFloat(fila.existenciaPeso) || 0) : 0;
    }
    var cerr   = area === 'bodega' ? (fila.cerradasBodega || 0)
               : area === 'barra'  ? (fila.cerradasBarra  || 0) : 0;
    var mlOpen = area === 'barra' ? calcMLReales(fila) : 0; // la botella abierta vive en barra
    if (fila.tipo === 'pza') return cerr + (mlOpen > 0 ? 1 : 0);
    var copasBot   = (fila.contNeto > 0 && fila.copaML > 0) ? fila.contNeto / fila.copaML : 0;
    var copasAbier = fila.copaML > 0 ? mlOpen / fila.copaML : 0;
    return cerr * copasBot + copasAbier;
}

function _datosReporteExistencias(area) {
    var invs = _scopeSucInvs(getInventarios()).filter(function(i){ return i && i.cerrado && (i.filas||[]).length; });
    invs.sort(function(a,b){ return String(b.fecha||'').localeCompare(String(a.fecha||'')); }); // más reciente primero
    // Última fila registrada de cada insumo (de cualquier inventario).
    var porIns = {};
    invs.forEach(function(inv){
        (inv.filas||[]).forEach(function(f){
            if (!f || !f.insumoId || porIns[f.insumoId]) return;
            porIns[f.insumoId] = { fila:f, fecha:inv.fecha };
        });
    });
    var insById = {}; getInsumos().forEach(function(x){ if (x && x.id) insById[x.id] = x; });
    // UNA fila por insumo, con su existencia en barra, en bodega y el total.
    var rows = [];
    Object.keys(porIns).forEach(function(id){
        var o = porIns[id], f = _filaLive(o.fila), ins = insById[id];
        var cc     = costoCopa(f);
        var barra  = _existenciaArea(f, 'barra',  ins);
        var bodega = _existenciaArea(f, 'bodega', ins);
        var total  = calcExistencia(f); // total real (incluye la botella abierta pesada)
        if (barra <= 0 && bodega <= 0 && total <= 0) return;
        // Costo prov. = PRECIO DE COMPRA por unidad de conteo (botella/pza/base), no el costo por litro.
        var copasBot = (f.tipo === 'copa' && f.contNeto > 0 && f.copaML > 0) ? f.contNeto / f.copaML : 0;
        var costoCompra = f.tipo === 'copa' ? cc * copasBot : cc; // costo de 1 botella/pza/unidad base
        rows.push({
            insumoId: id, nombre: f.nombre || '—', familia: f.familia || f.categoria || 'Otros',
            subcat: f.subcategoria || f.categoria || '',
            tipo: f.tipo, copaML: f.copaML, contNeto: f.contNeto, baseUnit: f.baseUnit,
            barra: barra, bodega: bodega, total: total,
            costoUnit: costoCompra,
            capBarra: barra * cc, capBodega: bodega * cc, capital: total * cc, fecha: o.fecha
        });
    });
    // Filtro por área: muestra solo los insumos con existencia en esa área
    if (area && area !== 'todas') rows = rows.filter(function(r){ return (area === 'barra' ? r.barra : r.bodega) > 0; });
    return rows;
}
function _fmtCant(qty, r){
    var e = qty || 0;
    if (e <= 0) return '—';
    if (r.tipo === '_comp') return (Math.round(e*10)/10) + ' ' + (r.unidadComp || 'u'); // producto compuesto
    if (r.tipo === 'peso') return _fmtBase(e) + ' ' + (r.baseUnit || 'u');
    if (r.tipo === 'pza')  return _fmtBase(e) + ' pza';
    var copasBot = (r.contNeto > 0 && r.copaML > 0) ? r.contNeto / r.copaML : 0;
    var bot = copasBot > 0 ? e / copasBot : e;
    return (Math.round(bot * 10) / 10) + ' bot';
}
function _repFecha(f){ return f ? new Date(f+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—'; }
function _repMoney(n){ return '$' + (Math.round((n||0)*100)/100).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}); }

function abrirReporteFinal(){ abrirReporteExistencias(true); }
function abrirReporteExistencias(fusion){
    _repFusion = !!fusion;
    // Selector: siempre ofrece Barra/Bodega/Cocina + cualquier otra área presente (ej. General)
    var rows = _datosReporteExistencias('todas');
    var presentes = [...new Set(rows.map(function(r){ return r.area; }))];
    var fijas = ['barra','bodega','cocina'];
    var areas = fijas.concat(presentes.filter(function(a){ return fijas.indexOf(a) < 0; }));
    areas = [...new Set(areas)];
    var sel = document.getElementById('repAreaSel');
    if (sel) sel.innerHTML = '<option value="todas">Todas las áreas</option>' +
        areas.map(function(a){ return '<option value="'+a+'">'+_areaNom(a)+'</option>'; }).join('');
    _repArea = 'todas';
    if (sel) sel.value = 'todas';
    // Subcategorías presentes (Mezcal, Licor, Brandy, Refresco, Cerveza…) para el filtro.
    var subs = [...new Set(rows.map(function(r){ return r.subcat; }).filter(Boolean))].sort();
    var ssel = document.getElementById('repSubcatSel');
    if (ssel) ssel.innerHTML = '<option value="">Todas las categorías</option>' +
        subs.map(function(s){ return '<option value="'+etx(s)+'">'+etx(s)+'</option>'; }).join('');
    _repSubcat = '';
    if (ssel) ssel.value = '';
    _repModoOp = false;
    var vbtn = document.getElementById('repVistaBtn'); if (vbtn) vbtn.textContent = '👁️ Vista admin';
    _renderReporteExistencias();
    document.getElementById('modalReporteExist').style.display = 'flex';
}
function setReporteArea(a){ _repArea = a; _renderReporteExistencias(); }

function _renderReporteExistencias(){
    var body = document.getElementById('repExistBody');
    if (!body) return;
    var rows = _datosReporteExistencias(_repArea);
    rows = _filtraSubcatRep(rows); // filtro por subcategoría (Mezcal, Licor, Refresco…)
    if (_repFusion) rows = _fusionarRows(rows); // Reporte final: fusiona productos compuestos
    if (!rows.length){
        body.innerHTML = '<div class="empty-state" style="padding:50px"><div class="empty-icon">📦</div>'+
            '<div class="empty-title">Sin existencias registradas</div>'+
            '<div class="empty-desc">Cierra al menos un inventario de esta área.</div></div>';
        return;
    }
    var op = _repModoOp; // operativa: sin capital ni totales en dinero
    var negNom = (function(){ try { return (JSON.parse(localStorage.getItem('etaax_ctx')||'{}').negocio||{}).nombre || ''; } catch(e){ return ''; } })();
    var fechaL = new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'});
    var areaTxt = _repArea === 'todas' ? 'Todas las áreas' : _areaNom(_repArea);
    // Encabezado branded ETAAX (estilo hoja de recetas)
    var html = '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:3px solid var(--green);margin-bottom:10px">'+
        '<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:24px;letter-spacing:1px;color:var(--text);line-height:1">'+etx(negNom||'Existencias')+'</div>'+
        '<div style="font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:var(--text-dim);margin-top:3px">'+(_repFusion?'Reporte de existencias':'Existencias por área')+' · '+etx(areaTxt)+(op?' · Operativa':'')+'</div></div>'+
        '<div style="text-align:right"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;color:var(--text)">ET<span style="color:var(--green)">AA</span>X</div>'+
        '<div style="font-size:9px;color:var(--text-dim);margin-top:2px">'+fechaL+'</div></div></div>';
    // Resumen FIJO arriba (solo en vista ADMIN) → capital en barra, bodega y total
    if (!op) {
        var _all = _datosReporteExistencias('todas');
        var _capBarra  = _all.reduce(function(s,r){ return s + r.capBarra;  }, 0);
        var _capBodega = _all.reduce(function(s,r){ return s + r.capBodega; }, 0);
        var _capTotal  = _all.reduce(function(s,r){ return s + r.capital;   }, 0);
        function _chip(lbl, cap, col){
            return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 16px;min-width:130px">'+
                '<div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">'+lbl+'</div>'+
                '<div style="font-size:18px;font-weight:800;color:'+col+';margin-top:2px">'+_repMoney(cap)+'</div></div>';
        }
        html += '<div style="display:flex;gap:10px;flex-wrap:wrap;padding:14px 16px 8px">'+
            _chip('📍 Barra',  _capBarra,  'var(--accent)') +
            _chip('📍 Bodega', _capBodega, 'var(--accent)') +
            '<div style="background:rgba(61,190,122,.12);border:1px solid rgba(61,190,122,.35);border-radius:10px;padding:10px 16px;min-width:130px">'+
            '<div style="font-size:11px;color:var(--green);text-transform:uppercase;letter-spacing:1px">TOTAL · '+(new Set(_all.map(function(r){return r.insumoId;}))).size+' insumos</div>'+
            '<div style="font-size:18px;font-weight:800;color:var(--green);margin-top:2px">'+_repMoney(_capTotal)+'</div></div></div>';
    } else {
        html += '<div style="padding:10px 16px 4px;font-size:11px;color:var(--text-dim)">🔒 Vista operativa · existencias y costo por producto (sin totales en dinero)</div>';
    }

    // Tabla: UNA fila por insumo con Barra | Bodega | Total
    rows.sort(function(a,b){ return b.total - a.total; });
    var totBarra = rows.reduce(function(s,r){ return s + r.capBarra;  }, 0);
    var totBodega= rows.reduce(function(s,r){ return s + r.capBodega; }, 0);
    var totCap   = rows.reduce(function(s,r){ return s + r.capital;   }, 0);
    html += '<div class="tabla-wrap" style="padding:0 8px"><table style="font-size:12px"><thead><tr>'+
        '<th style="text-align:left">Insumo</th><th style="text-align:left">Familia</th>'+
        '<th style="text-align:right">Exist. Barra</th><th style="text-align:right">Exist. Bodega</th>'+
        '<th style="text-align:right">Total exist.</th><th style="text-align:right">Costo prov.</th>'+
        (op ? '' : '<th style="text-align:right">Capital</th>')+'<th style="text-align:center">Última existencia</th></tr></thead><tbody>'+
        rows.map(function(r){
            var cont = _fmtContenido(r);
            return '<tr><td style="font-weight:600">'+etx(r.nombre)+(cont?'<div style="font-size:10px;color:#7ab8f5;font-weight:400">📦 '+cont+'</div>':'')+'</td>'+
                '<td style="color:var(--text-dim)">'+etx(r.familia)+'</td>'+
                '<td style="text-align:right">'+_fmtCant(r.barra, r)+'</td>'+
                '<td style="text-align:right">'+_fmtCant(r.bodega, r)+'</td>'+
                '<td style="text-align:right;font-weight:700;color:var(--text)">'+_fmtCant(r.total, r)+'</td>'+
                '<td style="text-align:right;color:var(--text-muted)">'+_repMoney(r.costoUnit)+'</td>'+
                (op ? '' : '<td style="text-align:right;color:var(--accent);font-weight:600">'+_repMoney(r.capital)+'</td>')+
                '<td style="text-align:center;color:var(--text-dim);font-size:11px">'+_repFecha(r.fecha)+'</td></tr>';
        }).join('')+
        (op ? '' :
        '<tr style="border-top:2px solid var(--border)"><td colspan="6" style="text-align:right;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:1px;color:var(--text-muted)">'+
        'Capital · Barra '+_repMoney(totBarra)+' · Bodega '+_repMoney(totBodega)+'</td>'+
        '<td style="text-align:right;font-weight:800;color:var(--green)">'+_repMoney(totCap)+'</td><td></td></tr>')+
        '</tbody></table></div>';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-top:1px solid var(--border);font-size:9px;color:var(--text-dim);margin-top:8px">'+
        '<span>etaax.com · EGMx Consultoría Estratégica a&b</span><strong style="color:var(--green)">📊 Existencias por área</strong><span>'+fechaL+'</span></div>';
    body.innerHTML = html;
}

// ── Vista previa de UN inventario (estilo reporte de existencias) ──
function _rowsDeInventario(inv) {
    var insById = {}; getInsumos().forEach(function(x){ if (x && x.id) insById[x.id] = x; });
    var rows = [];
    (inv.filas || []).forEach(function(_f){
        if (!_f || !_f.insumoId) return;
        var f = _filaLive(_f);
        var ins = insById[f.insumoId];
        var cc = costoCopa(f);
        var barra = _existenciaArea(f, 'barra', ins);
        var bodega = _existenciaArea(f, 'bodega', ins);
        var total = calcExistencia(f);
        if (barra <= 0 && bodega <= 0 && total <= 0) return;
        var copasBot = (f.tipo === 'copa' && f.contNeto > 0 && f.copaML > 0) ? f.contNeto/f.copaML : 0;
        var costoCompra = f.tipo === 'copa' ? cc*copasBot : cc;
        rows.push({ nombre:f.nombre||'—', familia:f.familia||f.categoria||'Otros',
            subcat:f.subcategoria||f.categoria||'', tipo:f.tipo,
            copaML:f.copaML, contNeto:f.contNeto, baseUnit:f.baseUnit, barra:barra, bodega:bodega, total:total,
            costoUnit:costoCompra, capital:total*cc, capBarra:barra*cc, capBodega:bodega*cc });
    });
    return rows;
}
// Vista previa de existencias del inventario EN CURSO (desde el header del wizard).
function verPreviewActual() {
    if (!invActual) { alert('Abre o inicia un inventario primero.'); return; }
    try { guardarInventario(); } catch(e) {} // asegurar invActual.filas al día
    verPreviewInventario(invActual.id);
}
var _previewInv = null, _previewRows = [], _previewBusq = '', _previewSubcat = '';
function verPreviewInventario(id) {
    var inv = getInventarios().find(function(x){ return x.id === id; });
    if (!inv) return;
    _previewInv = inv;
    _previewRows = _rowsDeInventario(inv);
    _previewRows.sort(function(a,b){ return b.total - a.total; });
    _previewBusq = ''; _previewSubcat = '';
    _renderPreviewInv();
    document.getElementById('modalPreviewInv').style.display = 'flex';
    var body = document.getElementById('previewInvBody'); if (body) body.scrollTop = 0;
}
function onPreviewBusq(v){ _previewBusq = v; _renderPreviewTabla(); }     // solo re-renderiza la tabla → no pierde foco
function setPreviewSubcat(v){ _previewSubcat = v; _renderPreviewTabla(); }
function _renderPreviewInv() {
    var inv = _previewInv; if (!inv) return;
    var all = _previewRows;
    var capB = all.reduce(function(s,r){ return s+r.capBarra; }, 0);
    var capBo= all.reduce(function(s,r){ return s+r.capBodega; }, 0);
    var capT = all.reduce(function(s,r){ return s+r.capital; }, 0);
    var negNom = (function(){ try { return (JSON.parse(localStorage.getItem('etaax_ctx')||'{}').negocio||{}).nombre || ''; } catch(e){ return ''; } })();
    var fechaInv = _repFecha(inv.fecha), estado = inv.cerrado ? 'Cerrado' : 'Abierto';
    var subs = [...new Set(all.map(function(r){ return r.subcat || r.familia; }).filter(Boolean))].sort();
    function _chip(lbl,cap,col){ return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:8px 14px;min-width:110px"><div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">'+lbl+'</div><div style="font-size:17px;font-weight:800;color:'+col+';margin-top:2px">'+_repMoney(cap)+'</div></div>'; }
    // ── Encabezado FIJO (sticky): título + capitales + búsqueda + filtro ──
    var header = '<div style="position:sticky;top:0;background:var(--surface);z-index:3;padding:8px 0 0">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px 10px;border-bottom:3px solid var(--green)">'+
            '<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:1px;color:var(--text);line-height:1">'+etx(inv.nombre||negNom||'Inventario')+'</div>'+
            '<div style="font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:var(--text-dim);margin-top:3px">'+etx(negNom)+' · '+(inv.area||'general')+' · '+fechaInv+' · '+estado+'</div></div>'+
            '<div style="text-align:right"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:2px;color:var(--text)">ET<span style="color:var(--green)">AA</span>X</div>'+
            '<div style="font-size:9px;color:var(--text-dim);margin-top:2px">'+all.length+' insumos</div></div></div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap;padding:10px 14px 8px">'+_chip('📍 Barra',capB,'var(--accent)')+_chip('📍 Bodega',capBo,'var(--accent)')+
            '<div style="background:rgba(61,190,122,.12);border:1px solid rgba(61,190,122,.35);border-radius:10px;padding:8px 14px;min-width:110px"><div style="font-size:10px;color:var(--green);text-transform:uppercase;letter-spacing:1px">TOTAL</div><div style="font-size:17px;font-weight:800;color:var(--green);margin-top:2px">'+_repMoney(capT)+'</div></div></div>'+
        '<div style="display:flex;gap:8px;padding:0 14px 10px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--border)">'+
            '<div class="inv-search" style="flex:1;min-width:200px;max-width:340px"><input type="text" placeholder="Buscar producto…" value="'+etx(_previewBusq)+'" oninput="onPreviewBusq(this.value)" style="width:100%;box-sizing:border-box"></div>'+
            '<select class="filtro-select" onchange="setPreviewSubcat(this.value)" style="font-size:11px;padding:6px 8px;max-width:200px"><option value="">Todas las categorías</option>'+subs.map(function(s){ return '<option value="'+etx(s)+'" '+(_previewSubcat===s?'selected':'')+'>'+etx(s)+'</option>'; }).join('')+'</select>'+
        '</div></div>';
    document.getElementById('previewInvBody').innerHTML = header + '<div id="previewInvTabla"></div>';
    _renderPreviewTabla();
}
function _renderPreviewTabla() {
    var cont = document.getElementById('previewInvTabla'); if (!cont) return;
    var q = (_previewBusq||'').toLowerCase();
    var rows = _previewRows.filter(function(r){
        return (!q || (r.nombre||'').toLowerCase().includes(q)) && (!_previewSubcat || (r.subcat||r.familia) === _previewSubcat);
    });
    if (!rows.length) { cont.innerHTML = '<div class="empty-state" style="padding:40px"><div class="empty-icon">🔍</div><div class="empty-title">Sin resultados</div></div>'; return; }
    cont.innerHTML = '<div class="tabla-wrap" style="padding:0 8px"><table style="font-size:12px"><thead><tr><th style="text-align:left">Insumo</th><th style="text-align:left">Familia</th><th style="text-align:right">Exist. Barra</th><th style="text-align:right">Exist. Bodega</th><th style="text-align:right">Total exist.</th><th style="text-align:right">Costo prov.</th><th style="text-align:right">Capital</th></tr></thead><tbody>'+
        rows.map(function(r){ var cont2=_fmtContenido(r); return '<tr><td style="font-weight:600">'+etx(r.nombre)+(cont2?'<div style="font-size:10px;color:#7ab8f5;font-weight:400">📦 '+cont2+'</div>':'')+'</td><td style="color:var(--text-dim)">'+etx(r.familia)+'</td><td style="text-align:right">'+_fmtCant(r.barra,r)+'</td><td style="text-align:right">'+_fmtCant(r.bodega,r)+'</td><td style="text-align:right;font-weight:700;color:var(--text)">'+_fmtCant(r.total,r)+'</td><td style="text-align:right;color:var(--text-muted)">'+_repMoney(r.costoUnit)+'</td><td style="text-align:right;color:var(--accent);font-weight:600">'+_repMoney(r.capital)+'</td></tr>'; }).join('')+
        '</tbody></table></div>';
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTOS COMPUESTOS (fusionar insumos) — config por sucursal
// La captura es independiente; el reporte FINAL/directivo lee esta config.
// ═══════════════════════════════════════════════════════════════
function _compuestosKey() {
    var neg = getNegocioActivo() || '';
    var suc = localStorage.getItem('etaax_sucursal_activa') || 'matriz';
    return 'etaax_' + neg + '_inv_compuestos_' + suc;
}
function getCompuestos() { try { return JSON.parse(localStorage.getItem(_compuestosKey()) || '[]') || []; } catch(e) { return []; } }
function setCompuestos(arr) { try { localStorage.setItem(_compuestosKey(), JSON.stringify(arr)); } catch(e) {} _pushInvAjustes(); }

// ── Sincronización en la nube de los ajustes de inventario (compuestos + bateo) ──
// Antes vivían SOLO en localStorage (se perdían al cambiar de dispositivo/caché).
// Doc por negocio en la tabla inv_ajustes (v37): { compuestos:{[suc]:[]}, bateo:{[suc]:[]} }.
var _invAjustesCache = null;
async function _pullInvAjustes(negId) {
    if (!negId || typeof _supabase === 'undefined') return;
    try {
        var r = await _supabase.from('inv_ajustes').select('datos').eq('negocio_id', negId).maybeSingle();
        if (r.error || !r.data) { if (!_invAjustesCache) _invAjustesCache = { compuestos:{}, bateo:{} }; return; }
        var d = r.data.datos || {};
        // Conservar TODAS las llaves del doc (para no pisar futuras configs) y
        // garantizar compuestos/bateo.
        _invAjustesCache = d;
        if (!_invAjustesCache.compuestos) _invAjustesCache.compuestos = {};
        if (!_invAjustesCache.bateo)      _invAjustesCache.bateo = {};
        Object.keys(_invAjustesCache.compuestos).forEach(function(suc){
            try { localStorage.setItem('etaax_' + negId + '_inv_compuestos_' + suc, JSON.stringify(_invAjustesCache.compuestos[suc] || [])); } catch(e){}
        });
        Object.keys(_invAjustesCache.bateo).forEach(function(suc){
            try { localStorage.setItem('etaax_' + negId + '_inv_bateo_' + suc, JSON.stringify(_invAjustesCache.bateo[suc] || [])); } catch(e){}
        });
    } catch(e) {}
}
function _pushInvAjustes() {
    var negId = getNegocioActivo(); if (!negId || typeof sbUpsertDoc !== 'function') return;
    var suc = localStorage.getItem('etaax_sucursal_activa') || 'matriz';
    if (!_invAjustesCache) _invAjustesCache = { compuestos:{}, bateo:{} };
    try { _invAjustesCache.compuestos[suc] = JSON.parse(localStorage.getItem(_compuestosKey()) || '[]'); } catch(e){}
    try { _invAjustesCache.bateo[suc]      = JSON.parse(localStorage.getItem(_bateoKey()) || '[]'); } catch(e){}
    sbUpsertDoc('inv_ajustes', _invAjustesCache, negId);
}

// ── Insumos "de bateo": alta varianza es normal (se sirve a ojo / barra libre).
// Se separan en su propio grupo arriba del resultado y NO cuentan como crítico/riesgo.
const GRUPO_BATEO = '🏏 Insumos de bateo';
function _bateoKey() {
    var neg = getNegocioActivo() || '';
    var suc = localStorage.getItem('etaax_sucursal_activa') || 'matriz';
    return 'etaax_' + neg + '_inv_bateo_' + suc;
}
function getBateo() { try { return JSON.parse(localStorage.getItem(_bateoKey()) || '[]') || []; } catch(e) { return []; } }
function esBateo(insumoId) { return getBateo().indexOf(insumoId) >= 0; }
function toggleBateo(insumoId) {
    var arr = getBateo(), i = arr.indexOf(insumoId);
    if (i >= 0) arr.splice(i, 1); else arr.push(insumoId);
    try { localStorage.setItem(_bateoKey(), JSON.stringify(arr)); } catch(e) {}
    _pushInvAjustes(); // respaldo en la nube (inv_ajustes)
    // Refrescar EN VIVO: renderStep5() solo DEVUELVE html (no pinta — por eso el
    // insumo no brincaba al grupo de bateo). Se repinta el contenedor de tablas
    // directo (rápido y conserva la vista); fallback al re-render del paso.
    var cont = document.getElementById('step5Tablas');
    if (cont && typeof _step5TablasHTML === 'function') cont.innerHTML = _step5TablasHTML();
    else if (typeof renderStepContent === 'function') renderStepContent();
}

// ── Compuestos en VENTAS (Paso 3) y RESULTADO ──────────────────────────────
// El compuesto REEMPLAZA a sus presentaciones miembro: se vende en copas contra
// el compuesto (un solo ítem) y el resultado sale en una sola línea.
function _compDeInsumo() {
    var map = {};
    getCompuestos().forEach(function(c){ (c.miembros||[]).forEach(function(m){ map[m] = c; }); });
    return map;
}
// Compuestos que tienen al menos un miembro presente en la captura actual.
function _compuestosActivos() {
    return getCompuestos().filter(function(c){
        return (c.miembros||[]).some(function(mid){ return filasCaptura.some(function(f){ return f.insumoId === mid; }); });
    });
}
function _copaMLCompuesto(comp) {
    var f = filasCaptura.find(function(x){ return (comp.miembros||[]).indexOf(x.insumoId) >= 0 && x.copaML > 0; });
    return f ? f.copaML : 0;
}
// Existencia FÍSICA total del compuesto en copas (suma de miembros).
function _existenciaCompuestoCopas(comp) {
    var total = 0;
    (comp.miembros||[]).forEach(function(mid){
        var f = filasCaptura.find(function(x){ return x.insumoId === mid; });
        if (f) total += calcExistencia(f); // tipo copa → ya en copas
    });
    return total;
}
// Existencia TEÓRICA del compuesto en copas: suministro de los miembros
// (anterior + entradas + producción, sin ventas porque van al compuesto) − ventas del compuesto.
function _teoricoCompuestoCopas(comp) {
    // Σ del teórico de cada presentación (cada miembro ya resta SUS propias ventas,
    // cortesía y merma). El compuesto es solo la vista CONSOLIDADA — no captura
    // ventas propias (modelo nuevo: ventas por presentación).
    var sup = 0;
    (comp.miembros||[]).forEach(function(mid){
        var f = filasCaptura.find(function(x){ return x.insumoId === mid; });
        if (f) sup += calcExistenciaTeorica(f);
    });
    return sup;
}
// Fila VIRTUAL del compuesto para renderizar como un insumo copa más.
function _virtualFilaCompuesto(comp) {
    var mems = (comp.miembros||[]).map(function(mid){ return filasCaptura.find(function(x){ return x.insumoId === mid; }); }).filter(Boolean);
    var m0 = mems[0];
    // Ventas del compuesto = Σ de las presentaciones (modelo nuevo, ya no ventasCompuesto).
    // Son SOLO para mostrar; el teórico/existencia usan _teoricoCopas/_existCopas.
    var vD = mems.reduce(function(s,m){ return s + (parseFloat(m.ventasCopasDirectas)||0); }, 0);
    var cD = mems.reduce(function(s,m){ return s + (parseFloat(m.cortesiaCopas)||0); }, 0);
    var mD = mems.reduce(function(s,m){ return s + (parseFloat(m.mermaCopas)||0); }, 0);
    return {
        esCompuesto: true, compId: comp.id, insumoId: '_comp_' + comp.id,
        nombre: comp.nombre, categoria: '🧩 Compuesto', subcategoria: '', familia: '🧩 Compuestos',
        tipo: 'copa', copaML: _copaMLCompuesto(comp), contNeto: 0,
        costoUnitario: m0 ? (m0.costoUnitario || 0) : 0, precioCarta: m0 ? (m0.precioCarta || 0) : 0,
        ventasCopasDirectas: vD, cortesiaCopas: cD, mermaCopas: mD, ventasBotella: 0,
        _existCopas: _existenciaCompuestoCopas(comp), _teoricoCopas: _teoricoCompuestoCopas(comp)
    };
}
function updVentasCompuesto(compId, campo, val) {
    if (!invActual.ventasCompuesto) invActual.ventasCompuesto = {};
    if (!invActual.ventasCompuesto[compId]) invActual.ventasCompuesto[compId] = {};
    invActual.ventasCompuesto[compId][campo] = parseFloat(val) || 0;
    _autoGuardar();
}

var _compEditId = null, _compMiembros = [], _compBusca = '';
function abrirParametros() {
    _compEditId = null;
    _renderParamLista();
    document.getElementById('modalParametros').style.display = 'flex';
}

// QR de entradas por negocio: abre entrada.html en el cel SIN login (token + NIP).
async function abrirQrEntradas() {
    var negId = getNegocioActivo();
    if (!negId) { alert('No hay negocio activo.'); return; }
    document.getElementById('modalQrEntradas').style.display = 'flex';
    var box = document.getElementById('qrEntradasBox');
    var urlEl = document.getElementById('qrEntradasUrl');
    box.innerHTML = '<div style="color:var(--text-dim);font-size:12px">Generando…</div>';
    urlEl.textContent = '';
    // Obtener (o crear) el token secreto del negocio que va en el QR.
    var token = '';
    try {
        var r = await _supabase.rpc('entrada_token_asegurar', { p_neg: negId });
        if (r.error) throw r.error;
        token = r.data || '';
    } catch (e) {
        box.innerHTML = '<div style="color:var(--red);font-size:12px;line-height:1.5">No se pudo generar el token del QR.<br>¿Corriste la migración v27 en Supabase?<br><span style="color:var(--text-dim)">' + etx((e && e.message) || e) + '</span></div>';
        return;
    }
    // QR ÚNICO POR SUCURSAL: lleva la sucursal activa — los registros quedan sellados
    // con ella y el colaborador solo ve insumos/menú de ESA sucursal.
    var sucQR = localStorage.getItem('etaax_sucursal_activa') || '';
    var url = location.origin + '/entrada.html?n=' + encodeURIComponent(negId) + '&t=' + encodeURIComponent(token)
        + (sucQR ? '&s=' + encodeURIComponent(sucQR) : '');
    // Blindaje multi-sucursal: sin sucursal activa, las entradas quedan SIN sello y no
    // aparecen en el historial de ninguna sucursal (se acabó el "historial global").
    urlEl.innerHTML = etx(url) + (sucQR ? '' : '<div style="color:var(--accent);margin-top:8px;font-size:11px;line-height:1.5;text-align:left">⚠️ Estás en <b>vista global (sin sucursal)</b>. Las entradas de este QR quedarían <b>sin sucursal</b> y NO se verían en el historial de una sucursal específica. Entra a una <b>sucursal</b> antes de generar el QR para que queden selladas.</div>');
    function gen() {
        box.innerHTML = '';
        var d = document.createElement('div');
        d.style.cssText = 'background:#fff;padding:14px;border-radius:12px;display:inline-block';
        box.appendChild(d);
        try {
            new QRCode(d, { text: url, width: 210, height: 210, colorDark: '#0a0908', colorLight: '#ffffff' });
            if (window.etaaxQrLogo) window.etaaxQrLogo(d);
        }
        catch(e) { box.innerHTML = '<div style="color:var(--red);font-size:12px">No se pudo generar el QR.</div>'; }
    }
    if (window.QRCode) gen();
    else {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js';
        s.onload = gen;
        s.onerror = function(){ box.innerHTML = '<div style="color:var(--red);font-size:12px">No se pudo cargar el generador de QR.</div>'; };
        document.head.appendChild(s);
    }
}
// ── Icono ETAAX al centro del QR (placa blanca + favicon; el corrector H lo tolera) ──
if (!window.etaaxQrLogo) window.etaaxQrLogo = function (cont) {
    try {
        var canvas = cont && cont.querySelector('canvas');
        if (!canvas) return;
        var img = cont.querySelector('img');
        var ctx = canvas.getContext('2d');
        var s = canvas.width;
        var logo = new Image();
        logo.onload = function () {
            var box = Math.round(s * 0.24), ico = Math.round(s * 0.19);
            var x = (s - box) / 2, y = (s - box) / 2, r = Math.round(box * 0.2);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, box, box, r); else ctx.rect(x, y, box, box);
            ctx.fill();
            ctx.drawImage(logo, (s - ico) / 2, (s - ico) / 2, ico, ico);
            if (img) img.src = canvas.toDataURL('image/png'); // la lib muestra el <img>: sincronizarlo
        };
        logo.src = '/favicon.svg';
    } catch (e) {}
};

// ── QR de entradas: exportar/imprimir ──────────────────────────
// El QR generado (canvas del lib qrcodejs, con fallback a su <img>) como data URL.
function _qrEntradasDataURL() {
    var box = document.getElementById('qrEntradasBox');
    if (!box) return '';
    var canvas = box.querySelector('canvas');
    if (canvas) { try { return canvas.toDataURL('image/png'); } catch(e) {} }
    var img = box.querySelector('img');
    return img ? img.src : '';
}
function descargarQrEntradas() {
    var data = _qrEntradasDataURL();
    if (!data) { alert('Primero espera a que se genere el QR.'); return; }
    var m = (typeof etaaxMarca === 'function') ? etaaxMarca() : {};
    var a = document.createElement('a');
    a.href = data;
    a.download = ('qr-entradas-' + (m.negocio || 'negocio') + (m.sucursal ? '-' + m.sucursal : ''))
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.png';
    a.click();
}
// Hoja imprimible: marca del negocio + QR grande + instrucciones. Mismo patrón que el
// reporte directivo: los estilos de impresión viven DENTRO del overlay y se destruyen
// con él (no contaminan otros flujos de window.print de la página).
function imprimirQrEntradas() {
    var data = _qrEntradasDataURL();
    if (!data) { alert('Primero espera a que se genere el QR.'); return; }
    var url = (document.getElementById('qrEntradasUrl') || {}).textContent || '';
    var m = (typeof etaaxMarca === 'function') ? etaaxMarca() : {};
    var viejo = document.getElementById('qrPrintOverlay'); if (viejo) viejo.remove();
    var ov = document.createElement('div');
    ov.id = 'qrPrintOverlay';
    ov.innerHTML =
        '<style>' +
        '#qrPrintOverlay{display:none}' +
        '@media print{' +
            '@page{size:letter;margin:14mm}' +
            'body>*:not(#qrPrintOverlay){display:none!important}' +
            '#qrPrintOverlay{display:block!important;background:#fff;color:#1a1916;font-family:Arial,Helvetica,sans-serif;text-align:center}' +
        '}' +
        '</style>' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:12px;border-bottom:3px solid #3dbe7a;padding-bottom:14px;margin-bottom:22px">' +
            (m.logo ? '<img src="' + m.logo + '" style="width:52px;height:52px;object-fit:cover;border-radius:10px">' : '') +
            '<div style="text-align:left">' +
                '<div style="font-weight:800;font-size:22px;letter-spacing:1px">' + etx(m.negocio || '') + '</div>' +
                (m.sucursal ? '<div style="font-size:13px;color:#555">' +
                    (m.sucursalColor ? '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + m.sucursalColor + ';margin-right:5px"></span>' : '') +
                    etx(m.sucursal) + '</div>' : '') +
            '</div>' +
        '</div>' +
        '<div style="font-weight:800;font-size:26px;letter-spacing:2px;margin-bottom:4px">📱 QR DE ENTRADAS</div>' +
        '<div style="font-size:13px;color:#555;margin-bottom:20px">Registro de entradas de insumos — cocina / barra / bodega</div>' +
        '<img src="' + data + '" style="width:290px;height:290px;border:1px solid #ddd;border-radius:14px;padding:14px;background:#fff">' +
        '<div style="max-width:430px;margin:22px auto 0;text-align:left;font-size:13px;color:#333;line-height:1.7">' +
            '<b>Instrucciones:</b><br>' +
            '1. Escanea el QR con la cámara del celular.<br>' +
            '2. Escribe tu <b>NIP de 5 dígitos</b> (el de Gestión de Staff).<br>' +
            '3. Registra el insumo, la cantidad y la foto de la entrada.' +
        '</div>' +
        '<div style="font-size:9px;color:#999;word-break:break-all;margin-top:18px">' + etx(url) + '</div>' +
        '<div style="border-top:1px solid #eee;margin-top:14px;padding-top:8px;font-size:9px;color:#bbb">etaax.com · EGMx Consultoría Estratégica a&b</div>';
    document.body.appendChild(ov);
    var limpiar = function(){ var o = document.getElementById('qrPrintOverlay'); if (o) o.remove(); };
    window.addEventListener('afterprint', limpiar, { once: true });
    window.print();
    setTimeout(limpiar, 2000); // respaldo por si afterprint no dispara (Safari viejo)
}

function _renderParamLista() {
    var comps = getCompuestos();
    var html = '<div style="padding:16px 18px">'+
        '<div style="font-size:12px;color:var(--text-dim);margin-bottom:12px;line-height:1.5">Une 2+ presentaciones del MISMO producto (ej. Mezcal Granel + Mezcal Botella) → en el reporte final salen como uno solo. La captura sigue siendo independiente.</div>'+
        '<button class="btn-vista" style="color:var(--green);border-color:var(--green);margin-bottom:14px" onclick="nuevoCompuesto()">+ Nuevo producto compuesto</button>'+
        (comps.length ? comps.map(function(c){
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px">'+
                '<div><div style="font-weight:600;color:var(--text)">🧩 '+etx(c.nombre)+'</div>'+
                '<div style="font-size:11px;color:var(--text-dim)">'+(c.miembros||[]).length+' presentaciones combinadas</div></div>'+
                '<div style="display:flex;gap:6px"><button class="btn-vista" style="padding:4px 10px;font-size:11px" onclick="editarCompuesto(\''+c.id+'\')">✏️ Editar</button>'+
                '<button class="btn-vista" style="padding:4px 10px;font-size:11px;color:var(--red);border-color:var(--red)" onclick="eliminarCompuesto(\''+c.id+'\')">🗑️</button></div></div>';
        }).join('') : '<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:30px 0">Sin productos compuestos todavía.</div>')+
        '</div>';
    document.getElementById('paramBody').innerHTML = html;
}
function nuevoCompuesto() { _compEditId = null; _compMiembros = []; _compBusca = ''; _renderCompForm({}); }
function editarCompuesto(id) {
    var c = getCompuestos().find(function(x){ return x.id === id; }); if (!c) return;
    _compEditId = id; _compMiembros = (c.miembros||[]).slice(); _compBusca = '';
    _renderCompForm(c);
}
function _toggleMiembro(id) {
    var i = _compMiembros.indexOf(id);
    if (i >= 0) _compMiembros.splice(i,1); else _compMiembros.push(id);
    var el = document.getElementById('compCount'); if (el) el.textContent = _compMiembros.length + ' seleccionadas';
}
function _compChecklistHTML() {
    var insumos = _scopeSucInsumos(getInsumos());
    var q = _compBusca.toLowerCase();
    var lista = insumos.filter(function(x){ return !q || (x.nombre||'').toLowerCase().indexOf(q) >= 0 || (x.marca||'').toLowerCase().indexOf(q) >= 0; });
    return lista.slice(0,120).map(function(x){ var sel=_compMiembros.indexOf(x.id)>=0;
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:6px;'+(sel?'background:rgba(61,190,122,.1)':'')+'">'+
        '<input type="checkbox" '+(sel?'checked':'')+' onchange="_toggleMiembro(\''+x.id+'\')"><span style="font-size:13px;color:var(--text)">'+etx(insumoEtiqueta(x))+'</span></label>';
    }).join('');
}
// La búsqueda actualiza SOLO la lista (no el input) → no se pierde el foco al escribir.
function onCompBusca(val) {
    _compBusca = val;
    var cont = document.getElementById('compChecklist');
    if (cont) cont.innerHTML = _compChecklistHTML();
}
function _renderCompForm(c) {
    c = c || {};
    var inpSt = 'width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px;font-size:14px';
    var html = '<div style="padding:16px 18px">'+
        '<input id="compNombre" placeholder="Nombre (ej. Mezcal de la Casa)" value="'+etx(c.nombre||'')+'" style="'+inpSt+';margin-bottom:10px">'+
        // Sin selector de unidad: el compuesto SIEMPRE consolida en COPAS (el parámetro
        // de conteo ya está definido en la copa de cada presentación miembro).
        '<div style="font-size:12px;color:var(--text-dim);margin:0 0 12px">📏 Resultado en <b style="color:var(--text)">copas</b> — usa el tamaño de copa definido en cada presentación.</div>'+
        '<label style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Presentaciones a combinar · <span id="compCount">'+_compMiembros.length+' seleccionadas</span></label>'+
        '<input placeholder="Buscar insumo…" value="'+etx(_compBusca)+'" oninput="onCompBusca(this.value)" style="'+inpSt.replace('14px','13px')+';margin:4px 0 8px">'+
        '<div id="compChecklist" style="max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px">'+
        _compChecklistHTML()+'</div>'+
        '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn-vista" onclick="_renderParamLista()">← Volver</button>'+
        '<button class="btn-vista" style="color:var(--green);border-color:var(--green);margin-left:auto" onclick="guardarCompuesto()">💾 Guardar</button></div></div>';
    document.getElementById('paramBody').innerHTML = html;
}
function guardarCompuesto() {
    var nombre = (document.getElementById('compNombre').value || '').trim();
    if (!nombre) { alert('Ponle nombre al producto compuesto.'); return; }
    if (_compMiembros.length < 2) { alert('Selecciona al menos 2 presentaciones a combinar.'); return; }
    var unidad = 'copa'; // estándar único: el compuesto consolida en copas (al re-guardar, normaliza los viejos)
    var comps = getCompuestos();
    if (_compEditId) {
        var c = comps.find(function(x){ return x.id === _compEditId; });
        if (c) { c.nombre = nombre; c.unidad = unidad; c.miembros = _compMiembros.slice(); }
    } else {
        comps.push({ id: genId(), nombre: nombre, unidad: unidad, miembros: _compMiembros.slice() });
    }
    setCompuestos(comps);
    _renderParamLista();
}
function eliminarCompuesto(id) {
    setCompuestos(getCompuestos().filter(function(x){ return x.id !== id; }));
    _renderParamLista();
}

function imprimirReporteExistencias(){
    var rows = _datosReporteExistencias(_repArea);
    rows = _filtraSubcatRep(rows); // filtro por subcategoría (Mezcal, Licor, Refresco…)
    if (_repFusion) rows = _fusionarRows(rows); // Reporte final: fusiona productos compuestos
    if (!rows.length){ alert('No hay existencias para imprimir.'); return; }
    rows.sort(function(a,b){ return b.capital - a.capital; });
    // Nombre para el <title> de la ventana (el encabezado usa la marca compartida).
    var negNom = (typeof etaaxMarca === 'function') ? (etaaxMarca().negocio || '') : '';
    var totBarra = rows.reduce(function(s,r){ return s + r.capBarra;  }, 0);
    var totBodega= rows.reduce(function(s,r){ return s + r.capBodega; }, 0);
    var totCap   = rows.reduce(function(s,r){ return s + r.capital;   }, 0);
    var fechaLarga = new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'});
    var nIns = (new Set(rows.map(function(r){return r.insumoId;}))).size;
    var areaTxt = _repArea === 'todas' ? 'Todas las áreas' : _areaNom(_repArea);

    var CSS = "* { margin:0; padding:0; box-sizing:border-box; }"+
        "body { font-family:'DM Sans',sans-serif; background:#fff; color:#1a1916; -webkit-print-color-adjust:exact; print-color-adjust:exact; }"+
        ".cab { display:flex; align-items:center; justify-content:space-between; padding:14px 22px; border-bottom:3px solid #3dbe7a; }"+
        ".neg-nombre { font-family:'Bebas Neue',sans-serif; font-size:28px; letter-spacing:1px; color:#1a1916; line-height:1; }"+
        ".neg-sub { font-size:9px; letter-spacing:3px; text-transform:uppercase; color:#888; margin-top:3px; }"+
        ".etx-mark { font-family:'Bebas Neue',sans-serif; font-size:24px; letter-spacing:2px; color:#1a1916; text-align:right; }"+
        ".etx-mark span { color:#3dbe7a; }"+
        ".fecha-txt { font-size:9px; color:#aaa; letter-spacing:1px; text-align:right; margin-top:3px; }"+
        ".fecha-cnt { font-size:10px; color:#888; text-align:right; }"+
        "table.ct { width:100%; border-collapse:collapse; margin-top:6px; }"+
        "table.ct thead tr { background:#f5f5f5; }"+
        "table.ct thead th { padding:8px 10px; font-size:8.5px; font-weight:700; color:#666; text-transform:uppercase; letter-spacing:1.5px; border-bottom:2px solid #e0e0e0; }"+
        "table.ct tbody tr { border-bottom:1px solid #f0f0f0; }"+
        "table.ct tbody tr:nth-child(even) { background:#fafafa; }"+
        "table.ct tbody td { padding:7px 10px; font-size:11px; }"+
        "table.ct tfoot td { background:#f8f8f8; border-top:2px solid #3dbe7a; padding:9px 10px; font-weight:700; }"+
        ".r { text-align:right; } .c { text-align:center; } .b { font-weight:700; color:#1a7a46; }"+
        ".grp { font-size:8.5px; color:#aaa; margin-top:1px; }"+
        ".footer { display:flex; justify-content:space-between; padding:10px 22px; border-top:1px solid #e8e8e8; font-size:9px; color:#aaa; margin-top:10px; }"+
        ".footer strong { color:#3dbe7a; }"+
        // Hoja carta horizontal: el pie queda ANCLADO al fondo de la hoja (no del contenido).
        ".pagina { min-height:19.3cm; display:flex; flex-direction:column; }"+
        ".pie-hoja { margin-top:auto; }"+
        "@page { size:letter landscape; margin:1cm; }";

    var op = _repModoOp;
    var tabla = '<table class="ct"><thead><tr>'+
        '<th style="text-align:left">Insumo</th><th style="text-align:left">Familia</th>'+
        '<th class="r">Exist. Barra</th><th class="r">Exist. Bodega</th><th class="r">Total exist.</th>'+
        '<th class="r">Costo prov.</th>'+(op?'':'<th class="r">Capital</th>')+'<th class="c">Última existencia</th></tr></thead><tbody>'+
        rows.map(function(r){ var cont=_fmtContenido(r); return '<tr><td style="font-weight:600">'+etx(r.nombre)+(cont?'<div class="grp" style="color:#5a8fc7">📦 '+cont+'</div>':'')+'</td><td style="color:#888">'+etx(r.familia)+'</td>'+
            '<td class="r">'+_fmtCant(r.barra,r)+'</td><td class="r">'+_fmtCant(r.bodega,r)+'</td>'+
            '<td class="r b" style="color:#1a1916">'+_fmtCant(r.total,r)+'</td><td class="r" style="color:#888">'+_repMoney(r.costoUnit)+'</td>'+
            (op?'':'<td class="r b">'+_repMoney(r.capital)+'</td>')+'<td class="c" style="color:#aaa">'+_repFecha(r.fecha)+'</td></tr>'; }).join('')+
        '</tbody>'+(op?'':'<tfoot><tr><td colspan="6" class="r" style="text-transform:uppercase;font-size:9px;letter-spacing:1.5px;color:#888">Capital · Barra '+_repMoney(totBarra)+' &nbsp;·&nbsp; Bodega '+_repMoney(totBodega)+'</td>'+
        '<td class="r b" style="font-size:13px">'+_repMoney(totCap)+'</td><td></td></tr></tfoot>')+'</table>';

    var resumen = op ? '' : '<div style="display:flex;gap:22px;padding:10px 22px 0;font-size:11px;color:#555">'+
        '<span>📍 <b>Barra</b> '+_repMoney(totBarra)+'</span>'+
        '<span>📍 <b>Bodega</b> '+_repMoney(totBodega)+'</span>'+
        '<span style="color:#1a7a46;font-weight:700">TOTAL '+_repMoney(totCap)+' · '+nIns+' insumos</span></div>';
    // Encabezado/pie con la marca COMPARTIDA (reporte-marca.js): negocio + sucursal
    // + logo automáticos, mismo formato que carátula/recetas/requisiciones.
    var _subRep  = 'Reporte de existencias · ' + areaTxt + (op ? ' · Operativa' : '');
    var _hdrDer  = '<div class="fecha-txt">'+fechaLarga+'</div><div class="fecha-cnt">'+nIns+' insumos</div>';
    var _hdrRep  = (typeof etaaxReporteHeader === 'function')
        ? etaaxReporteHeader(_subRep, _hdrDer)
        : '<div class="cab"><div><div class="neg-nombre">'+(negNom?etx(negNom):'Existencias')+'</div>'+
          '<div class="neg-sub">'+etx(_subRep)+'</div></div>'+
          '<div><div class="etx-mark">ET<span>AA</span>X</div>'+_hdrDer+'</div></div>';
    var _ftrRep  = (typeof etaaxReporteFooter === 'function')
        ? etaaxReporteFooter('📊 Reporte de existencias')
        : '<div class="footer"><span>etaax.com · EGMx Consultoría Estratégica a&b</span>'+
          '<strong>📊 Reporte de existencias</strong><span>'+fechaLarga+'</span></div>';
    var pagina = '<div class="pagina">' + _hdrRep + resumen + tabla +
        '<div class="pie-hoja">' + _ftrRep + '</div></div>';

    var w = window.open('', '_blank');
    w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Existencias por área — '+(negNom?etx(negNom):'ETAAX')+'</title>'+
        '<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">'+
        '<style>'+CSS+'</style></head><body>'+pagina+'</body></html>');
    w.document.close(); w.focus(); setTimeout(function(){ w.print(); }, 350);
}

function renderHistorial() {
    const cont = document.getElementById('historialContent');
    if (!cont) return;
    if (modoHistorial === 'mes') { cont.innerHTML = renderCalendario(); return; }
    // Acotar por sucursal. Se rescatan SOLO los borradores abiertos SIN sucursal
    // asignada (para no perderlos); los que ya tienen sucursalId se muestran ÚNICAMENTE
    // en la suya (antes se filtraban a TODAS las sucursales → bug de inventarios repetidos).
    const todos  = getInventarios();
    const scoped = _scopeSucInvs(todos);
    const _ids   = {}; scoped.forEach(function(x){ if (x && x.id) _ids[x.id] = 1; });
    todos.forEach(function(x){ if (x && x.id && !x.cerrado && !_ids[x.id] && !((x.sucursalId||'').trim())) scoped.push(x); });
    const lista = [...scoped].reverse();
    if (!lista.length) {
        cont.innerHTML = `<div class="empty-state" style="margin-top:16px">
            <div class="empty-icon">📦</div>
            <div class="empty-title">Sin inventarios</div>
            <div class="empty-desc">Crea tu primer inventario</div>
        </div>`; return;
    }
    // Recalcular capital en vivo (refleja ediciones de costos/insumos en inventarios previos).
    lista.forEach(function(inv){ if (inv && (inv.filas||[]).length) { try { _calcCapitalesInv(inv); } catch(e){} } });
    cont.innerHTML = modoListaHist === 'galeria'
        ? `<div class="hist-galeria">${lista.map(renderHistCard).join('')}</div>`
        : renderHistTabla(lista);
}

// Formato de dinero con separador de miles y 2 decimales: 2400 → "2,400.00".
function _money2(v){ return (parseFloat(v)||0).toLocaleString('es-MX', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
// Calcular capital a costo / a carta de un inventario guardado (sus filas).
function _calcCapitalesInv(inv) {
    var capCosto = 0, capCarta = 0;
    (inv.filas || []).forEach(function(f){
        var exist = (f.existenciaFisica !== undefined && f.existenciaFisica !== null) ? f.existenciaFisica : calcExistencia(f);
        capCosto += exist * costoCopa(f);
        capCarta += exist * (parseFloat(f.precioCarta) || 0);
    });
    inv.capitalCosto = capCosto;
    inv.capitalCarta = capCarta;
}
// Finalizar (cerrar) un inventario desde el historial: ABIERTO → CERRADO.
function finalizarInventarioHistorial(id) {
    var inv = getInventarios().find(function(x){ return x.id === id; });
    if (!inv) return;
    if (inv.cerrado) { alert('Este inventario ya está cerrado.'); return; }
    _solicitarClave('Finalizar y cerrar inventario', function(){
        inv.cerrado = true;
        _calcCapitalesInv(inv); // refrescar capital al cerrar
        var lista = getInventarios();
        var idx = lista.findIndex(function(x){ return x.id === id; });
        if (idx >= 0) lista[idx] = inv;
        setInventarios(lista); // guarda local
        // FORZAR el upsert a la nube: setInventarios compara el MISMO objeto (mutado
        // in-place) → su diff NO detecta el cerrado → sin esto, "finalizar" solo vivía
        // en localStorage y Supabase revertía el inventario a ABIERTO al recargar.
        try { _sbUpInv(inv); } catch(e) { console.warn('[finalizar upsert]', e); }
        // Finalizar desde la LISTA no debe dejar colgando un invActual de una visita
        // previa (tour/wizard abortado): si no, el siguiente "Nuevo/Continuar" lo reusaba
        // y "reabría el primero". Estado limpio al terminar.
        invActual = null; filasCaptura = []; window._soloVistaInv = false;
        renderStats(); renderHistorial();
    });
}

function renderHistTabla(lista) {
    return `<div class="card" style="max-width:none;margin-top:12px">
        <div class="card-body" style="padding:0"><div class="tabla-wrap"><table>
            <thead><tr>
                <th>Fecha</th><th>Inventario</th><th>Área</th><th>Productos</th>
                <th>Capital costo</th><th>Capital carta</th><th>Faltante / Sobrante</th><th>Estado</th><th></th>
            </tr></thead>
            <tbody>${lista.map(inv => {
                // Faltante/sobrante A COSTO proveedor (se guarda al visitar el Paso 5);
                // inventarios viejos sin el dato caen al valor anterior (a carta).
                const dif = (inv.difNetoCosto !== undefined ? inv.difNetoCosto : inv.diferenciaCosto) || 0;
                // El PRIMER LEVANTAMIENTO es una LÍNEA BASE, no un conteo a reconciliar:
                // no lleva Continuar/Finalizar (eso confundía y "revivía" el botón). Se abre
                // para ajustarlo y siempre sirve de referencia de existencia anterior.
                const esLev = inv.tipoInv === 'primer_lev';
                const accionBtn = esLev
                    ? `<button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px;color:var(--viol);border-color:var(--viol)"
                        onclick="abrirInventario('${inv.id}')">✏️ Ajustar línea base</button>`
                    : inv.cerrado
                    ? `<button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px;color:var(--accent);border-color:var(--accent)"
                        onclick="editarInventario('${inv.id}')">✏️ Editar</button>`
                    : `<button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px"
                        onclick="abrirInventario('${inv.id}')">▶ Continuar</button>
                       <button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px;color:var(--green);border-color:var(--green)"
                        onclick="finalizarInventarioHistorial('${inv.id}')">✅ Finalizar</button>`;
                const estadoPill = esLev
                    ? `<span class="pill" style="background:rgba(155,141,232,.15);color:var(--viol);border:1px solid rgba(155,141,232,.35)">Línea base</span>`
                    : `<span class="pill ${inv.cerrado?'pill-green':'pill-amber'}">${inv.cerrado?'Cerrado':'Abierto'}</span>`;
                return `<tr>
                    <td style="color:var(--text-muted)">${new Date(inv.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}</td>
                    <td style="font-weight:500">${tipoIcon(inv.tipoInv)} ${etx(inv.nombre||'Sin nombre')}</td>
                    <td style="color:var(--text-dim);font-size:11px">${inv.area||'—'}</td>
                    <td style="color:var(--text-muted)">${(inv.filas||[]).length}</td>
                    <td style="color:var(--accent);font-weight:500">$${_money2(inv.capitalCosto)}</td>
                    <td style="color:var(--green);font-weight:500">$${_money2(inv.capitalCarta)}</td>
                    <td style="color:${dif>=0?'var(--green)':'var(--red)'};font-weight:500">${dif>=0?'+':''}$${_money2(dif)}</td>
                    <td>${estadoPill}</td>
                    <td style="text-align:right;white-space:nowrap">
                        <button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px"
                            onclick="verInventarioTour('${inv.id}')">👁️ Ver</button>
                        ${accionBtn}
                        <button class="btn-vista" style="padding:4px 10px;font-size:11px;color:var(--red);border-color:var(--red)"
                            onclick="eliminarInventario('${inv.id}')">🗑️</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table></div></div>
    </div>`;
}

function renderHistCard(inv) {
    const dif = (inv.difNetoCosto !== undefined ? inv.difNetoCosto : inv.diferenciaCosto) || 0;
    const esLev = inv.tipoInv === 'primer_lev'; // línea base: sin Continuar/Finalizar
    const accionBtn = esLev
        ? `<button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1;color:var(--viol);border-color:var(--viol)"
            onclick="abrirInventario('${inv.id}')">✏️ Ajustar línea base</button>`
        : inv.cerrado
        ? `<button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1;color:var(--accent);border-color:var(--accent)"
            onclick="editarInventario('${inv.id}')">✏️ Editar</button>`
        : `<button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1"
            onclick="abrirInventario('${inv.id}')">▶ Continuar</button>
           <button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1;color:var(--green);border-color:var(--green)"
            onclick="finalizarInventarioHistorial('${inv.id}')">✅ Finalizar</button>`;
    const estadoPill = esLev
        ? `<span class="pill" style="flex-shrink:0;margin-left:8px;background:rgba(155,141,232,.15);color:var(--viol);border:1px solid rgba(155,141,232,.35)">Línea base</span>`
        : `<span class="pill ${inv.cerrado?'pill-green':'pill-amber'}" style="flex-shrink:0;margin-left:8px">${inv.cerrado?'Cerrado':'Abierto'}</span>`;
    return `<div class="hist-card ${inv.cerrado?'cerrado':''}">
        <div class="hist-card-icon">${tipoIcon(inv.tipoInv)}</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
            <div class="hist-card-nombre">${etx(inv.nombre||'Sin nombre')}</div>
            ${estadoPill}
        </div>
        <div class="hist-card-meta">
            ${new Date(inv.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'})}
            ${inv.turno && /^\d{2}:\d{2}/.test(inv.turno) ? ' · '+inv.turno+'h' : ''} ${inv.area?' · '+inv.area:''}
            ${inv.negocio?'<br>'+inv.negocio:''}
        </div>
        <div style="border-top:1px solid var(--border);padding-top:10px">
            <div class="hist-card-stat"><span>Capital costo</span><span style="color:var(--accent);font-weight:500">$${_money2(inv.capitalCosto)}</span></div>
            <div class="hist-card-stat"><span>Capital carta</span><span style="color:var(--green);font-weight:500">$${_money2(inv.capitalCarta)}</span></div>
            <div class="hist-card-stat"><span>${dif>=0?'Sobrante':'Faltante'} a costo</span>
                <span style="color:${dif>=0?'var(--green)':'var(--red)'};font-weight:600">${dif>=0?'+':''}$${_money2(dif)}</span></div>
            <div class="hist-card-stat"><span>Productos</span><span>${(inv.filas||[]).length}</span></div>
        </div>
        <div class="hist-card-actions">
            <button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1"
                onclick="verInventarioTour('${inv.id}')">👁️ Ver</button>
            ${accionBtn}
            <button class="btn-vista" style="padding:5px 10px;font-size:11px;color:var(--red);border-color:var(--red)"
                onclick="eliminarInventario('${inv.id}')">🗑️</button>
        </div>
    </div>`;
}

function renderCalendario() {
    const mesesHtml = MESES.map((nombre, i) => {
        const n    = getInventariosMes(anioVista, i+1).length;
        const esAct = mesSeleccionado === i+1;
        return `<div class="cal-mes ${n>0?'con-inv':''} ${esAct?'activo':''}" onclick="seleccionarMes(${i+1})">
            <div class="cal-mes-nombre">${nombre}</div>
            <div class="cal-mes-count ${n>0?'verde':'dim'}">${n}</div>
        </div>`;
    }).join('');

    let listaMes = '';
    if (mesSeleccionado) {
        const invsMes = [...getInventariosMes(anioVista, mesSeleccionado)].reverse();
        listaMes = `<div style="border-top:1px solid var(--border);padding-top:16px;margin-top:4px">
            <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;color:var(--text-muted);margin-bottom:12px">
                ${invsMes.length} inventario${invsMes.length!==1?'s':''} — ${MESES[mesSeleccionado-1]} ${anioVista}
            </div>
            ${invsMes.length
                ? (modoListaHist==='galeria'
                    ? `<div class="hist-galeria">${invsMes.map(renderHistCard).join('')}</div>`
                    : renderHistTabla(invsMes))
                : `<div style="color:var(--text-dim);font-size:13px;padding:20px 0">Sin inventarios este mes</div>`
            }
        </div>`;
    }

    return `<div class="cal-nav">
        <button class="cal-nav-btn" onclick="cambiarAnio(-1)">‹</button>
        <div class="cal-year">${anioVista}</div>
        <button class="cal-nav-btn" onclick="cambiarAnio(1)">›</button>
    </div>
    <div style="padding:0 16px">${
        '<div class="cal-grid">'+mesesHtml+'</div>'+listaMes
    }</div>`;
}

function seleccionarMes(mes) { mesSeleccionado = mesSeleccionado===mes ? null : mes; renderHistorial(); }
function cambiarAnio(delta)  { anioVista += delta; mesSeleccionado = null; renderHistorial(); }

// ═══════════════════════════════════════════════════════════════
// VISTA FORM
// ═══════════════════════════════════════════════════════════════
function nuevoInventario() {
    invActual = null; filasCaptura = [];
    mostrarVista('vistaForm');
    limpiarFormulario();
    document.getElementById('formModo').textContent  = 'Nuevo inventario';
    document.getElementById('formTitulo').textContent = 'Datos generales';
    document.getElementById('btnIniciarInv').textContent = 'Iniciar inventario →';
}

function nuevoPrimerLev() {
    invActual = null; filasCaptura = [];
    mostrarVista('vistaForm');
    limpiarFormulario();
    document.getElementById('invTipoInv').value = 'primer_lev';
    onTipoInvChange('primer_lev');
    document.getElementById('formModo').textContent   = 'Nuevo registro';
    document.getElementById('formTitulo').textContent = 'Primer Levantamiento';
    document.getElementById('btnIniciarInv').textContent = 'Iniciar levantamiento →';
}

// ── VISTA SOLO LECTURA (tour) ────────────────────────────────────────────────
// Reutiliza TODO el wizard pero sin editar ni guardar: navegas los 5 pasos con
// la info capturada. invActual es un clon y las mutaciones están bloqueadas por
// window._soloVistaInv (guardarInventario/_autoGuardar/_persistir/_importarQR).
// ── Notas por INSUMO en el reporte final (préstamo, venta cruzada, etc.) ─────
// Se guardan en invActual.notasInsumo[insumoId] y se muestran en su fila.
function _notaInsumo(id) { return (invActual && invActual.notasInsumo && invActual.notasInsumo[id]) || ''; }
var _notaInsEditId = null;
function editarNotaInsumo(id) {
    if (!invActual) return;
    _notaInsEditId = id;
    // Caso especial: nota del sobrante/faltante NETO del inventario (no es un insumo).
    if (id === '__neto__') {
        document.getElementById('notaInsNombre').textContent = '📊 Sobrante / Faltante neto del inventario';
        document.getElementById('notaInsInput').value = invActual.comentarioNeto || '';
        document.getElementById('modalNotaInsumo').style.display = 'flex';
        setTimeout(function(){ var t = document.getElementById('notaInsInput'); if (t) t.focus(); }, 60);
        return;
    }
    // Nombre bonito del insumo/compuesto para el encabezado del modal.
    var fila = filasCaptura.find(function(f){ return f.insumoId === id; });
    var nom = fila ? (typeof insumoTitulo === 'function' ? insumoTitulo(fila) : (fila.nombre||'')) : '';
    if (!nom && typeof getCompuestos === 'function') { var c = getCompuestos().find(function(x){ return x.id === id; }); if (c) nom = '🧩 ' + (c.nombre||''); }
    document.getElementById('notaInsNombre').textContent = nom || 'Insumo';
    document.getElementById('notaInsInput').value = _notaInsumo(id);
    document.getElementById('modalNotaInsumo').style.display = 'flex';
    setTimeout(function(){ var t = document.getElementById('notaInsInput'); if (t) t.focus(); }, 60);
}
function _cerrarNotaInsumo() {
    var m = document.getElementById('modalNotaInsumo'); if (m) m.style.display = 'none';
    _notaInsEditId = null;
}
function _guardarNotaInsumo() {
    if (!invActual || !_notaInsEditId) { _cerrarNotaInsumo(); return; }
    var id = _notaInsEditId;
    var txt = (document.getElementById('notaInsInput').value || '').trim();
    // Caso especial: comentario del sobrante/faltante neto (vive en invActual.comentarioNeto).
    if (id === '__neto__') {
        invActual.comentarioNeto = txt;
        _autoGuardar({ soloNota: true });
        _cerrarNotaInsumo();
        var wN = document.getElementById('notaWrap-__neto__');
        if (wN) { wN.outerHTML = _btnNotaNeto(); return; }
        var contN = document.getElementById('step5Tablas');
        if (contN && typeof renderStepContent === 'function') renderStepContent();
        return;
    }
    if (!invActual.notasInsumo) invActual.notasInsumo = {};
    if (txt) invActual.notasInsumo[id] = txt; else delete invActual.notasInsumo[id];
    // Una nota NO cambia ningún número → no invalida el resumen (soloNota) y no dispara
    // un recálculo pesado. El guardado local va debounced dentro de _autoGuardar.
    _autoGuardar({ soloNota: true });
    _cerrarNotaInsumo();
    // Actualizar SOLO la celda de la nota (antes re-renderizaba TODAS las tablas → lento).
    var w = document.getElementById('notaWrap-' + id);
    if (w) { w.outerHTML = _btnNotaInsumo(id); return; }
    var cont = document.getElementById('step5Tablas');
    if (cont && typeof _step5TablasHTML === 'function') cont.innerHTML = _step5TablasHTML();
}
window.editarNotaInsumo = editarNotaInsumo;
window._cerrarNotaInsumo = _cerrarNotaInsumo;
window._guardarNotaInsumo = _guardarNotaInsumo;
// Botón + display de nota para la celda de nombre de una fila del reporte.
function _btnNotaInsumo(id) {
    var n = _notaInsumo(id);
    // Envuelto en un span con id → al guardar la nota se actualiza SOLO esta celda
    // (antes se re-renderizaban TODAS las tablas del reporte = lento).
    return '<span id="notaWrap-' + id + '">' +
        '<button onclick="event.stopPropagation();editarNotaInsumo(\'' + id + '\')" ' +
        'style="margin-top:3px;margin-left:4px;font-size:9px;padding:1px 6px;border-radius:4px;cursor:pointer;background:transparent;' +
        'border:1px solid ' + (n?'var(--accent)':'#888') + ';color:' + (n?'var(--accent)':'#999') + '">📝 ' + (n?'Nota ✓':'Nota') + '</button>' +
        (n ? '<div style="font-size:10px;color:var(--accent);margin-top:3px;font-style:italic;max-width:200px">📝 ' + etx(n) + '</div>' : '') +
    '</span>';
}
// Botón + display de la nota del sobrante/faltante NETO (mismo estilo que la nota de insumo).
function _btnNotaNeto() {
    var n = (invActual && invActual.comentarioNeto) || '';
    return '<span id="notaWrap-__neto__" style="display:inline-block">' +
        '<button onclick="event.stopPropagation();editarNotaInsumo(\'__neto__\')" ' +
        'style="font-size:11px;padding:4px 10px;border-radius:6px;cursor:pointer;background:transparent;' +
        'border:1px solid ' + (n?'var(--accent)':'#888') + ';color:' + (n?'var(--accent)':'#999') + '">📝 ' + (n?'Nota ✓':'Agregar nota') + '</button>' +
        (n ? '<div style="font-size:11px;color:var(--accent);margin-top:5px;font-style:italic;line-height:1.5">📝 ' + etx(n) + '</div>' : '') +
    '</span>';
}
window._btnNotaNeto = _btnNotaNeto;

// ── Menú COMPARTIR del reporte ───────────────────────────────────────────────
function _toggleRdShare(e) {
    if (e) e.stopPropagation();
    var m = document.getElementById('rdShareMenu'); if (!m) return;
    var abrir = m.style.display === 'none';
    m.style.display = abrir ? 'block' : 'none';
    if (abrir) setTimeout(function(){ document.addEventListener('click', _rdShareClose, { once: true }); }, 0);
}
function _rdShareClose() { var m = document.getElementById('rdShareMenu'); if (m) m.style.display = 'none'; }

// ── Generar el PDF del reporte y COMPARTIRLO (Web Share) o descargarlo ────────
// Carga html2canvas + jsPDF bajo demanda (jsdelivr, permitido por la CSP).
var _libPDFCargada = false;
function _cargarLibPDF() {
    if (_libPDFCargada) return Promise.resolve();
    function load(src){ return new Promise(function(res, rej){ var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function(){ rej(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s); }); }
    return Promise.all([
        load('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'),
        load('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js')
    ]).then(function(){ _libPDFCargada = true; });
}
function _nombrePDFReporte() {
    var base = 'Reporte-inventario';
    try { var l = (window._rdShareTxt || '').split('\n'); if (l[2]) base = l[2].replace(/[^\w\s·-]/g,'').replace(/\s+/g,'-').slice(0, 60); } catch(e) {}
    return base + '.pdf';
}
// Cada .rd-paper (hoja A4) → una página del PDF (bordes limpios, sin cortes).
async function _generarPDFReporte() {
    await _cargarLibPDF();
    var pages = Array.prototype.slice.call(document.querySelectorAll('#rdOverlay .rd-paper'));
    if (!pages.length) return null;
    var landscape = false; // el reporte de inventario es A4 vertical
    var jsPDFctor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    var pdf = new jsPDFctor({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' });
    var W = landscape ? 297 : 210, H = landscape ? 210 : 297;
    for (var i = 0; i < pages.length; i++) {
        var canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        var img = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, 0, W, H);
    }
    return pdf.output('blob');
}
async function _compartirPDF() {
    var btn = document.getElementById('rdBtnCompartirPDF'); var txt0 = btn ? btn.textContent : '';
    if (btn) { btn.textContent = '⏳ Generando PDF…'; btn.disabled = true; }
    try {
        var blob = await _generarPDFReporte();
        if (!blob) { alert('No se pudo generar el PDF (abre el reporte primero).'); return; }
        var file = new File([blob], _nombrePDFReporte(), { type: 'application/pdf' });
        // Celular: hoja nativa de compartir CON el PDF adjunto (correo, WhatsApp…).
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Reporte de inventario', text: window._rdShareTxt || '' });
        } else {
            // Escritorio: se descarga el PDF (el navegador no permite adjuntarlo solo).
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
            alert('📄 PDF descargado: ' + file.name + '\nAdjúntalo a tu correo o WhatsApp.');
        }
    } catch(e) {
        if (e && e.name === 'AbortError') { /* el usuario canceló la hoja de compartir */ }
        else alert('No se pudo compartir el PDF: ' + ((e && e.message) || e));
    } finally { if (btn) { btn.textContent = txt0; btn.disabled = false; } }
}
window._toggleRdShare = _toggleRdShare;
window._rdShareClose = _rdShareClose;
window._compartirPDF = _compartirPDF;

// Fuerza un render nuevo del Paso 5 (estilo "renderizar" de Premiere) — por si
// el usuario editó pasos anteriores y quiere refrescar el resultado a mano.
function recalcularResultado() {
    window._step5Dirty = true;
    window._step5Force = true; // fuerza el recálculo aunque haya caché (el botón SÍ hace algo)
    if (pasoActual === 5 && typeof renderStepContent === 'function') renderStepContent();
}
window.recalcularResultado = recalcularResultado;
// Avisa en el Paso 5 que los datos cambiaron y hay que recalcular (badge + botón resaltado).
function _marcarStep5Stale(stale) {
    var b = document.getElementById('step5StaleBadge');
    if (b) b.style.display = stale ? 'inline-flex' : 'none';
    var btn = document.getElementById('btnRecalc5');
    if (btn) { btn.style.color = stale ? 'var(--accent)' : 'var(--text-muted)'; btn.style.borderColor = stale ? 'var(--accent)' : ''; }
}
window._marcarStep5Stale = _marcarStep5Stale;

function verInventarioTour(id) {
    const inv = getInventarios().find(x => x.id === id);
    if (!inv) return;
    window._soloVistaInv = true;
    invActual = JSON.parse(JSON.stringify(inv));
    if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
    if (!invActual.ventasCompuesto)   invActual.ventasCompuesto   = {};
    if (!invActual.cancelaciones)     invActual.cancelaciones     = [];
    if (!invActual.descuentos)        invActual.descuentos        = [];
    if (!invActual.entradasLog)       invActual.entradasLog       = [];
    cargarProductosCaptura(); // (NO se importa QR: _importarEntradasQR está bloqueado)
    pasoActual = 1;
    busquedaCapt = ''; filtroFamActivo = ''; filtroCatActiva = ''; filtroSubcatActiva = ''; filtroRegistroActivo = 'registrados';
    window._step5Dirty = true; // render fresco del resumen para este inventario
    mostrarVista('vistaCaptura');
    document.getElementById('captTitulo').textContent = invActual.nombre || 'Inventario';
    actualizarStepBar();
    actualizarNavBtns();
    renderStepContent();
    _aplicarSoloVista();
}
window.verInventarioTour = verInventarioTour;

// Aplica el modo solo-lectura al wizard (se re-llama en cada render de paso).
function _aplicarSoloVista() {
    if (!window._soloVistaInv) return;
    var ind = document.getElementById('autoGuardarInd');
    if (ind) { ind.textContent = '👁️ Vista de solo lectura'; ind.style.color = 'var(--accent)'; }
    ['btnInfoGeneral','btnFinalizarInv','btnFinalizarLev'].forEach(function(bid){
        var b = document.getElementById(bid); if (b) b.style.display = 'none';
    });
    var salir = document.getElementById('btnGuardarInv');
    if (salir) { salir.textContent = '✕ Cerrar vista'; salir.onclick = cerrarVistaInv; }
    ['stepContent','step5Keep'].forEach(function(cid){
        var c = document.getElementById(cid); if (c) c.classList.add('inv-readonly');
    });
}
function cerrarVistaInv() {
    window._soloVistaInv = false;
    invActual = null; filasCaptura = [];
    var salir = document.getElementById('btnGuardarInv');
    if (salir) { salir.textContent = '🚪 Salir'; salir.onclick = pedirSalirInv; }
    var ind = document.getElementById('autoGuardarInd');
    if (ind) ind.style.color = 'var(--green)';
    ['stepContent','step5Keep'].forEach(function(cid){ var c = document.getElementById(cid); if (c) c.classList.remove('inv-readonly'); });
    mostrarVista('vistaLista');
}
window.cerrarVistaInv = cerrarVistaInv;

function abrirInventario(id) {
    const inv = getInventarios().find(x => x.id === id);
    if (!inv) return;
    window._soloVistaInv = false; // modo edición al abrir para editar/continuar
    // Limpiar residuos de la vista de solo lectura (el indicador y el bloqueo se
    // quedaban al pasar de "👁️ solo lectura" a edición).
    var _indE = document.getElementById('autoGuardarInd');
    if (_indE && /solo lectura/i.test(_indE.textContent)) { _indE.textContent = '✓ Todos los cambios guardados'; _indE.style.color = 'var(--green)'; }
    ['stepContent','step5Keep'].forEach(function(cid){ var c = document.getElementById(cid); if (c) c.classList.remove('inv-readonly'); });
    invActual = JSON.parse(JSON.stringify(inv));
    if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
    if (!invActual.ventasCompuesto)   invActual.ventasCompuesto   = {};
    if (!invActual.cancelaciones)     invActual.cancelaciones     = [];
    if (!invActual.descuentos)        invActual.descuentos        = [];
    if (!invActual.entradasLog)       invActual.entradasLog       = [];
    // Siempre recarga desde insumos para mostrar el catálogo completo;
    // cargarProductosCaptura hace merge: usa filas guardadas si existen, default si no
    cargarProductosCaptura();
    try { _importarEntradasQR(); } catch(e) { console.warn('[importar QR]', e); } // jala las entradas del QR de esta sucursal
    pasoActual = 1;
    busquedaCapt = ''; filtroFamActivo = ''; filtroCatActiva = ''; filtroSubcatActiva = ''; filtroRegistroActivo = 'pendientes';
    mostrarVista('vistaCaptura');
    document.getElementById('captTitulo').textContent = invActual.nombre || 'Inventario';
    actualizarStepBar();
    actualizarNavBtns();
    renderStepContent();
}

function _getNegocioNombre() {
    const id = getNegocioActivo();
    if (!id) return '';
    try {
        const lista = JSON.parse(localStorage.getItem('etaax_negocios') || '[]');
        const neg   = lista.find(n => n.id === id);
        return neg ? (neg.nombre || '') : '';
    } catch { return ''; }
}

// Nombre para el campo "Sucursal activa" del formulario: la SUCURSAL real
// (vía etaaxMarca, reporte-marca.js); si el negocio no maneja sucursales,
// cae al nombre del negocio. Antes siempre ponía el nombre del negocio.
function _getSucursalNombreInv() {
    if (typeof etaaxMarca === 'function') {
        var m = etaaxMarca();
        return m.sucursal || m.negocio || _getNegocioNombre();
    }
    return _getNegocioNombre();
}

function _getUltimoInvFecha() {
    const lista = getInventarios();
    if (!lista.length) return null;
    return lista[lista.length - 1].fecha || null;
}

function onTipoInvChange(tipo) {
    const mapa = { primer_lev:'general', bebidas:'barra', alimentos:'cocina', almacen:'bodega', restaurante:'general', otro:'general' };
    const sel  = document.getElementById('invArea');
    if (sel) sel.value = mapa[tipo] || 'general';
    _setFechaUltimo(); // repuebla/bloquea la referencia según el tipo (primer lev = sin referencia)
}

// ═══════════════════════════════════════════════════════════════
// AUTH — Verifica con la contraseña de inicio de sesión (Supabase)
// ═══════════════════════════════════════════════════════════════
let _claveCallback = null;
let _sesionEmail   = null;

// Carga el email de la sesión activa en cuanto el script corre
(async function _cargarSesion() {
    try {
        const { data } = await _supabase.auth.getSession();
        _sesionEmail = data?.session?.user?.email || null;
    } catch(e) { _sesionEmail = null; }
})();

function _solicitarClave(accion, callback) {
    _claveCallback = callback;
    document.getElementById('claveAccionLabel').textContent = accion;
    document.getElementById('claveError').textContent       = '';
    document.getElementById('claveInput').value             = '';
    // Mostrar correo del usuario activo
    const info = document.getElementById('claveEmailInfo');
    if (info) info.textContent = _sesionEmail || '(sin sesión activa)';
    document.getElementById('modalAuthClave').style.display = 'flex';
    setTimeout(() => { const inp = document.getElementById('claveInput'); if (inp) inp.focus(); }, 80);
}

function _cerrarModalClave() {
    document.getElementById('modalAuthClave').style.display = 'none';
    _claveCallback = null;
}

async function _confirmarClave() {
    const errEl   = document.getElementById('claveError');
    const btnConf = document.getElementById('btnConfirmarClave');
    const pass    = (document.getElementById('claveInput').value || '').trim();

    if (!pass) { errEl.textContent = 'Ingresa tu contraseña'; return; }
    if (!_sesionEmail) {
        // intento de recuperar sesión en el momento
        try {
            const { data } = await _supabase.auth.getSession();
            _sesionEmail = data?.session?.user?.email || null;
        } catch(e) {}
        if (!_sesionEmail) { errEl.textContent = 'No hay sesión activa. Vuelve a iniciar sesión desde el Hub.'; return; }
    }

    if (btnConf) { btnConf.textContent = 'Verificando…'; btnConf.disabled = true; }
    errEl.textContent = '';
    try {
        const { error } = await _supabase.auth.signInWithPassword({ email: _sesionEmail, password: pass });
        if (error) throw new Error('Contraseña incorrecta');
    } catch(e) {
        errEl.textContent = e.message || 'Error al verificar';
        document.getElementById('claveInput').value = '';
        document.getElementById('claveInput').focus();
        if (btnConf) { btnConf.textContent = 'Confirmar'; btnConf.disabled = false; }
        return;
    }
    if (btnConf) { btnConf.textContent = 'Confirmar'; btnConf.disabled = false; }
    // Cerrar modal ANTES de ejecutar la acción (fuera del try-catch)
    const cb = _claveCallback;
    _cerrarModalClave();
    if (cb) cb();
}

function _setFechaUltimo() {
    const el = document.getElementById('invRefSelect');
    if (!el) return;
    // PRIMER LEVANTAMIENTO = es la primera existencia del negocio → NO tiene
    // inventario de referencia. Se bloquea el select en ese estado.
    const _tipoEl = document.getElementById('invTipoInv');
    if (_tipoEl && _tipoEl.value === 'primer_lev') {
        el.innerHTML = '<option value="">— Sin referencia · primer levantamiento —</option>';
        el.value = ''; el.disabled = true;
        return;
    }
    const refs = _refsDisponibles().slice().reverse(); // más reciente primero (incluye intermedios ABIERTOS con datos)
    if (!refs.length) { el.innerHTML = '<option value="">Sin inventarios previos</option>'; el.disabled = true; return; }
    el.disabled = false;
    // '' = AUTOMÁTICO (el anterior más reciente). Solo se marca un inventario específico
    // si el usuario lo eligió a propósito (invActual.refInventarioId).
    const elegido = (invActual && invActual.refInventarioId) || '';
    const auto = refs[0];
    const fchA = auto.fecha ? new Date(auto.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }) : 's/f';
    el.innerHTML = `<option value="" ${!elegido ? 'selected' : ''}>🔄 Automático — ${etx(auto.nombre || 'Inventario')} · ${fchA}</option>` +
        refs.map(inv => {
        const fch = inv.fecha ? new Date(inv.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }) : 's/f';
        const tag = inv.tipoInv === 'primer_lev' ? ' · línea base' : (!inv.cerrado ? ' · abierto' : '');
        return `<option value="${inv.id}" ${elegido === inv.id ? 'selected' : ''}>${etx(inv.nombre || 'Inventario')} · ${fch}${tag}</option>`;
    }).join('');
}

function poblarFormulario() {
    const tipo = invActual.tipoInv || 'bebidas';
    document.getElementById('invTipoInv').value = tipo;
    document.getElementById('invNegocio').value = invActual.negocio || _getSucursalNombreInv();
    document.getElementById('invFecha').value   = invActual.fecha   || '';
    // Hora: si el valor guardado parece HH:MM lo usamos, si no dejamos vacío
    const t = invActual.turno || '';
    document.getElementById('invTurno').value   = /^\d{2}:\d{2}/.test(t) ? t : '';
    document.getElementById('invArea').value    = invActual.area    || 'barra';
    document.getElementById('invNotas').value   = invActual.notas   || '';
    _setFechaUltimo();
}

// Volver a la pantalla de configuración general del inventario en curso (para editar
// tipo/área/fecha/notas). Los datos capturados se conservan (cargarProductosCaptura merge).
function abrirInfoGeneral() {
    if (!invActual) { mostrarVista('vistaLista'); return; }
    try { guardarInventario(); } catch(e) {} // persistir lo capturado antes de ir a la config (no perder nada)
    poblarFormulario();
    if (typeof onTipoInvChange === 'function') onTipoInvChange(invActual.tipoInv || 'bebidas');
    var fm = document.getElementById('formModo');    if (fm) fm.textContent = 'Editar información general';
    var ft = document.getElementById('formTitulo');  if (ft) ft.textContent = invActual.tipoInv === 'primer_lev' ? 'Primer Levantamiento' : 'Inventario';
    var bi = document.getElementById('btnIniciarInv'); if (bi) bi.textContent = 'Guardar y continuar →';
    mostrarVista('vistaForm');
}

function limpiarFormulario() {
    const hoy  = new Date();
    const hh   = String(hoy.getHours()).padStart(2,'0');
    const mm   = String(hoy.getMinutes()).padStart(2,'0');
    document.getElementById('invTipoInv').value = 'bebidas';
    document.getElementById('invNegocio').value = _getSucursalNombreInv();
    document.getElementById('invFecha').value   = hoy.toISOString().slice(0,10);
    document.getElementById('invTurno').value   = hh + ':' + mm;
    document.getElementById('invArea').value    = 'barra';
    document.getElementById('invNotas').value   = '';
    _setFechaUltimo();
}

function iniciarInventario() {
    const esNuevo = !invActual;
    if (esNuevo) {
        invActual = {
            id: genId(), cerrado: false,
            sucursalId: localStorage.getItem('etaax_sucursal_activa') || '', // independiente por sucursal
            cocktailsVendidos: {}, prebatchProducidos: {}, ventasCompuesto: {}, cancelaciones: [], descuentos: [], entradasLog: [],
            filas: [], capitalCosto: 0, capitalCarta: 0, diferenciaCosto: 0
        };
    }
    invActual.tipoInv = document.getElementById('invTipoInv').value;
    invActual.negocio = document.getElementById('invNegocio').value.trim();
    invActual.fecha   = document.getElementById('invFecha').value || new Date().toISOString().slice(0,10);
    invActual.turno   = document.getElementById('invTurno').value;
    invActual.area    = document.getElementById('invArea').value;
    invActual.notas   = document.getElementById('invNotas').value;
    // Auto-generar nombre a partir de tipo + área + fecha
    const _tipoLabel = { bebidas:'Bebidas', alimentos:'Alimentos', almacen:'Almacén', restaurante:'Restaurante', otro:'Inventario' };
    const _areaLabel = { barra:'Barra', bodega:'Bodega', cocina:'Cocina', general:'General' };
    invActual.nombre  = (_tipoLabel[invActual.tipoInv] || 'Inventario') + ' ' +
        (_areaLabel[invActual.area] || invActual.area) + ' · ' +
        new Date(invActual.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' });

    if (esNuevo || !filasCaptura.length) cargarProductosCaptura();

    pasoActual = 1;
    busquedaCapt = ''; filtroFamActivo = ''; filtroCatActiva = ''; filtroSubcatActiva = ''; filtroRegistroActivo = 'pendientes';
    mostrarVista('vistaCaptura');
    document.getElementById('captTitulo').textContent = invActual.nombre;
    actualizarStepBar();
    actualizarNavBtns();
    renderStepContent();
}

// ── Cargar productos ──────────────────────────────────────────
// ¿El insumo/sub-receta pertenece al ÁREA de este inventario?
// Regla: SIN área asignada NO aparece en ningún inventario; con área, solo en el
// inventario de esa misma área (el inventario 'general' incluye todas las que SÍ
// tengan área). Aplica igual a insumos y a sub-recetas-como-insumo.
function _insumoEnAreaInv(ins) {
    if (!ins) return false;
    var insA = (ins.area || '').toString().trim().toLowerCase();
    if (!insA) return false;                       // sin área → nunca aparece
    var invA = ((invActual && invActual.area) || '').toString().trim().toLowerCase();
    if (!invA || invA === 'general') return true;  // inventario general → todas las que tengan área
    return insA === invA;                          // área del insumo == área del inventario
}

// insumoIds con movimiento del QR (entrada/merma/salida) en el periodo+sucursal de
// ESTE inventario. Deben aparecer aunque no tengan área asignada, para poder atribuir
// su merma/entrada (si no, una merma de cerveza sin área se caía del reporte).
function _insumosConMovimientoQR() {
    var set = {}, suc = _sucActiva();
    (getEntradasLog() || []).forEach(function(e){
        if (!e || e.borrada || !e.insumoId) return;
        if (e.sucursalId && suc && e.sucursalId !== suc) return; // sello de sucursal
        if (!_enPeriodoInvActual(e.fecha)) return;               // periodo de este inventario
        set[e.insumoId] = 1;
    });
    return set;
}

function cargarProductosCaptura() {
    // Solo insumos de la sucursal activa Y del ÁREA de este inventario. Sin área → no
    // entra (qué hace la canela en un inventario de barra 😅). PERO sí entran: lo YA
    // capturado en este inventario, y los que tienen un MOVIMIENTO del QR (merma/entrada/
    // salida) en su periodo+sucursal — así su merma siempre se refleja en el reporte.
    const _movQR = _insumosConMovimientoQR();
    const insumos = _scopeSucInsumos(getInsumos()).filter(function(ins){
        if (_insumoEnAreaInv(ins)) return true;
        if (_movQR[ins.id]) return true; // tiene merma/entrada del QR en este periodo → incluir
        var f = (invActual && (invActual.filas || []).find(function(x){ return x.insumoId === ins.id; }));
        return !!(f && _filaConDatos(f));
    });
    if (!insumos.length) { filasCaptura = []; return; }
    _sanearRefInv(); // ref guardado obsoleto (primer lev con intermedios más nuevos) → automático

    filasCaptura = insumos.map(ins => {
        const existe = (invActual.filas || []).find(f => f.insumoId === ins.id);
        if (existe) {
            // Sub-receta convertida a insumo: visible por DEFAULT (se captura la
            // existencia del prebatch); solo se oculta si el dueño lo marcó con el
            // botón "Visible en inventario" del catálogo (ins.ocultoInventario).
            existe._subReceta = !!(ins.esSubReceta && ins.ocultoInventario);
            if (!existe.entradas) existe.entradas = ['','','','',''];
            // Corregir refrescos/cervezas guardados como 'copa' por error → pza (conteo por pieza).
            if (existe.tipo === 'copa' && _esRefrescoCerveza(ins)) existe.tipo = 'pza';
            // Recalcular el tamaño de copa (vinos guardados con copa de licor descuadraban).
            if (existe.tipo === 'copa') existe.copaML = _copaMLInsumo(ins);
            // Asegurar subcategoría/categoría en filas viejas (para agrupar bien en el resultado).
            if (!existe.subcategoria && ins.subcategoria) existe.subcategoria = ins.subcategoria;
            // ── Refrescar los PARÁMETROS del insumo VIVO (igual que _filaLive) ──
            // Editar el insumo (peso de botella llena → pesoCristal, contenido neto,
            // costos, nombre) se refleja al reabrir/continuar el inventario, SIN tocar
            // lo ya contado (pesos capturados, cerradas, entradas, mermas…).
            {
                const pEx  = (ins.presentaciones || [])[0] || {};
                const umEx = (pEx.umContenido || 'ML').toUpperCase();
                const cnEx = parseFloat(pEx.contNeto) || 0;
                const contBaseEx = (umEx === 'LT' || umEx === 'KG') ? cnEx * 1000 : cnEx;
                if (contBaseEx > 0) existe.contNeto = contBaseEx;
                const pcEx = parseFloat(pEx.pesoCristal);
                if (!isNaN(pcEx)) existe.pesoCristal = pcEx; // puede bajar a 0 a propósito
                existe.rendimientoBatch = parseFloat(pEx.rendimiento) || 0; // sub-recetas: ml/g por batch
                existe.nombre = ins.nombre + (ins.variedad ? ' ' + ins.variedad : '');
                if (ins.familia)  existe.familia  = ins.familia;
                if (ins.categoria) existe.categoria = ins.categoria;
                const cuEx = parseFloat(pEx.costoUnitario) || parseFloat(pEx.precio) || 0;
                if (cuEx > 0) existe.costoUnitario = cuEx;
                const cpEx = parseFloat(pEx.costoPieza) || 0;
                if (cpEx > 0) existe.costoPieza = cpEx;
                const pcaEx = parseFloat(pEx.precioCarta) || 0;
                if (pcaEx > 0) existe.precioCarta = pcaEx;
            }
            // Refrescar la "existencia anterior" desde el inventario de referencia actual:
            // si editaste el inventario anterior / primer levantamiento, se actualiza aquí.
            existe.existenciaAnterior = getExistenciaAnterior(ins.id);
            return existe;
        }

        const p      = (ins.presentaciones || [])[0];
        // ALIMENTOS: tipo 'peso' (conteo en unidad base g/ml/pza, descuento por recetas).
        const esFood = (ins.familia || '').toLowerCase().includes('aliment');
        // REFRESCOS/CERVEZAS → pza (revisa tipoInsumo + categoría + subcategoría).
        const esPza  = _esRefrescoCerveza(ins);
        const tipo   = esFood ? 'peso' : (esPza ? 'pza' : 'copa');

        const copaML = _copaMLInsumo(ins);

        const pesoCristal = parseFloat(p?.pesoCristal) || 0;
        const _umP = (p?.umContenido || 'ML').toUpperCase();
        // Contenido neto en unidad base: licor en ML; alimentos en g/ml/pza (KG/LT → ×1000).
        const contBase = (() => {
            const cn = parseFloat(p?.contNeto) || 0;
            return (_umP === 'LT' || _umP === 'KG') ? cn * 1000 : cn;
        })();

        return {
            insumoId: ins.id,
            _subReceta: !!(ins.esSubReceta && ins.ocultoInventario), // oculto SOLO si el dueño lo marcó en el catálogo
            nombre:   ins.nombre + (ins.variedad ? ' '+ins.variedad : ''),
            categoria: ins.categoria  || '',
            subcategoria: ins.subcategoria || '',
            familia:  ins.familia    || '',
            tipo, copaML, contNeto: contBase, pesoCristal,
            rendimientoBatch: parseFloat(p?.rendimiento) || 0, // sub-recetas: ml/g POR BATCH (producciones)
            baseUnit: esFood ? unidadBaseInsumo(ins) : '',   // g / ml / pza (solo alimentos)
            costoUnitario:  parseFloat(p?.costoUnitario) || parseFloat(p?.precio) || 0,
            costoPieza:     parseFloat(p?.costoPieza) || 0,   // costo de compra por pieza (refrescos/latas por rejilla/caja)
            precioCarta:    parseFloat(p?.precioCarta)   || 0,
            precioCartaBot: parseFloat(p?.precioCartaBot)|| 0,
            stockMin:       parseFloat(ins.stockMin)     || 0,
            existenciaAnterior: getExistenciaAnterior(ins.id),
            // Paso 1: existencias físicas
            cerradasBodega: 0, cerradasBarra: 0,
            pesos: ['','','',''],   // 4 botellas abiertas (kg)
            existenciaPeso: '',     // alimentos: conteo físico en unidad base
            // Paso 2: entradas (hasta 5 por producto)
            entradas: ['','','','',''],
            // Paso 3: ventas directas / merma
            ventasCopasDirectas: 0, ventasBotella: 0, mermaBase: 0,
        };
    });
    // Salvaguarda: conservar filas YA capturadas cuyo insumo no esté en el scope
    // actual (ej. se capturó en otra sucursal/contexto) → nunca perder lo registrado.
    (invActual && invActual.filas || []).forEach(function(sf){
        if (sf && sf.insumoId && !filasCaptura.some(function(f){ return f.insumoId === sf.insumoId; })) {
            if (!sf.entradas) sf.entradas = ['','','','',''];
            filasCaptura.push(sf);
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// WIZARD — navegación
// ═══════════════════════════════════════════════════════════════
const PASO_LABELS = ['','Existencias','Entradas','Ventas','Cancelaciones','Resumen de Resultado'];

function irAPaso(n) {
    pasoActual = n;
    if (n === 2) { try { _importarEntradasQR(); } catch(e) {} } // al entrar a Entradas, jala lo del QR
    actualizarStepBar();
    actualizarNavBtns();
    renderStepContent();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function pasoSiguiente() { if (pasoActual < 5) irAPaso(pasoActual+1); }
function pasoAnterior()  { if (pasoActual > 1) irAPaso(pasoActual-1); }

function actualizarStepBar() {
    document.getElementById('stepLabel').textContent = `Paso ${pasoActual} — ${PASO_LABELS[pasoActual]}`;
    document.querySelectorAll('#invSteps .inv-step').forEach(el => {
        const n = parseInt(el.dataset.step);
        el.classList.toggle('active', n === pasoActual);
        el.classList.toggle('done',   n < pasoActual);
    });
}

function actualizarNavBtns() {
    const esLev  = invActual && invActual.tipoInv === 'primer_lev';
    const btnAnt = document.getElementById('btnPasoAnt');
    const btnSig = document.getElementById('btnPasoSig');
    const btnLev = document.getElementById('btnFinalizarLev');
    const btnFin = document.getElementById('btnFinalizarInv');
    const steps  = document.getElementById('invSteps');
    const cerr   = !!(invActual && invActual.cerrado);

    if (esLev) {
        if (btnAnt) btnAnt.style.display = 'none';
        if (btnSig) btnSig.style.display = 'none';
        if (btnFin) btnFin.style.display = 'none'; // primer_lev usa su propio botón
        if (btnLev) { btnLev.style.display = 'inline-flex'; btnLev.disabled = cerr; btnLev.textContent = cerr ? '✅ Guardado' : '✅ Guardar levantamiento'; }
        if (steps)  steps.style.display = 'none';
        const lbl = document.getElementById('stepLabel');
        if (lbl) lbl.textContent = 'Primer Levantamiento — Captura de existencias';
    } else {
        if (btnLev) btnLev.style.display = 'none';
        if (btnFin) { btnFin.style.display = 'inline-flex'; btnFin.disabled = cerr; btnFin.textContent = cerr ? '✅ Cerrado' : '✅ Finalizar inventario'; }
        if (steps)  steps.style.display = '';
        if (btnAnt) btnAnt.style.display = pasoActual > 1 ? 'inline-flex' : 'none';
        if (btnSig) btnSig.style.display = pasoActual < 5 ? 'inline-flex' : 'none';
    }
    // Acciones del Resultado (Recalcular / reportes): fijas en el header, solo en el Paso 5.
    var s5b = document.getElementById('step5HeaderBtns');
    if (s5b) s5b.style.display = (!esLev && pasoActual === 5) ? 'inline-flex' : 'none';
    if (typeof _ajustarStickyInv === 'function') setTimeout(_ajustarStickyInv, 0); // el header pudo crecer/encoger
}
// Finalizar el inventario actual desde el wizard (cierra: ABIERTO → CERRADO).
function finalizarInventarioActual() {
    if (!invActual) return;
    if (invActual.cerrado) { alert('Este inventario ya está cerrado.'); return; }
    if (invActual.tipoInv === 'primer_lev') { finalizarPrimerLev(); return; }
    cerrarInventario();
}

function renderStepContent() {
    const cont = document.getElementById('stepContent');
    if (!cont) return;
    // Primer levantamiento solo captura existencias
    const paso = (invActual && invActual.tipoInv === 'primer_lev') ? 1 : pasoActual;
    const renders = [null, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5];
    // ── Paso 5 con CACHÉ DE RENDER (estilo Premiere) ─────────────────────────
    // El resumen se renderiza UNA vez en un contenedor persistente (#step5Keep);
    // al volver, solo se muestra (instantáneo). Se re-renderiza únicamente si
    // hubo cambios (_step5Dirty: cualquier guardado/venta/realtime) o cambió el
    // inventario. Las interacciones internas del paso 5 (búsqueda, bateo,
    // galería) mutan el DOM vivo → no invalidan.
    let _keep5 = document.getElementById('step5Keep');
    if (paso === 5) {
        cont.style.display = 'none';
        const _invId = (invActual && invActual.id) || '';
        // Ya hay resumen renderizado para este inventario → mostrarlo AL INSTANTE, sin
        // recalcular en CADA navegación (era lento con 200+ insumos). Si hubo cambios,
        // se AVISA para recalcular a mano con 🔄 (el botón deja de ser "de adorno").
        // El reporte impreso (verReporteDirectivo) siempre recalcula fresco por su cuenta.
        if (_keep5 && _keep5.dataset.inv === _invId && _keep5.innerHTML && !window._step5Force) {
            _keep5.style.display = '';
            _marcarStep5Stale(!!window._step5Dirty);
            return;
        }
        if (!_keep5) {
            _keep5 = document.createElement('div');
            _keep5.id = 'step5Keep';
            cont.parentNode.insertBefore(_keep5, cont.nextSibling);
        }
        _keep5.dataset.inv = _invId;
        _keep5.style.display = '';
        _keep5.innerHTML = '<div style="text-align:center;padding:90px 20px;color:var(--text-dim)"><div style="font-size:32px;margin-bottom:12px">📊</div>Generando resumen de resultado…</div>';
        clearTimeout(window._step5RenderT);
        window._step5RenderT = setTimeout(function(){
            if (pasoActual !== 5) return; // el usuario ya se movió a otro paso
            try {
                _keep5.innerHTML = renderStep5();
                window._step5Dirty = false;
                window._step5Force = false;
                if (typeof _marcarStep5Stale === 'function') _marcarStep5Stale(false);
            } catch (e) {
                // Antes, si renderStep5 lanzaba, la pantalla quedaba CONGELADA en el
                // spinner. Ahora se muestra el error y un botón para reintentar.
                console.error('[renderStep5]', e);
                _keep5.innerHTML = '<div style="text-align:center;padding:70px 20px;color:var(--text-dim)">'+
                    '<div style="font-size:32px;margin-bottom:10px">⚠️</div>'+
                    '<div style="color:var(--text)">No se pudo generar el resumen</div>'+
                    '<div style="font-size:12px;margin-top:6px;max-width:520px;margin-left:auto;margin-right:auto">'+etx((e&&e.message)||String(e))+'</div>'+
                    '<button class="btn-vista" style="margin-top:14px" onclick="recalcularResultado()">🔄 Reintentar</button></div>';
            }
        }, 30);
        return;
    }
    if (_keep5) _keep5.style.display = 'none';
    cont.style.display = '';
    cont.innerHTML = renders[paso]();
    // Restore filter selects
    const ffF = document.getElementById('filtroFamStep');
    const ffC = document.getElementById('filtroCatStep');
    const ffS = document.getElementById('filtroSubcatStep');
    if (ffF) ffF.value = filtroFamActivo;
    if (ffC) ffC.value = filtroCatActiva;
    if (ffS) ffS.value = filtroSubcatActiva;
    if (paso === 2 && vistaEntradas2 === 'busqueda') initEntradaRapidaUI();
    if (paso === 1 && vistaCapturaExist === 'busqueda') initExistBusquedaUI();
    if (paso === 3 && vistaVentas === 'busqueda') initVentasBusquedaUI();
    if (paso === 4) _initPaso4Tables();
    _ajustarStickyInv(); // recolocar pasos + toolbar bajo el header (altura real)
    if (window._soloVistaInv) _aplicarSoloVista(); // reaplica solo-lectura (actualizarNavBtns re-muestra botones)
}

// Ajusta los offsets STICKY del wizard según la altura REAL del header (que puede
// envolver en pantallas chicas) → pasos y toolbar quedan pegados sin huecos ni
// solaparse con las barras superiores fijas (top-bar + ctx-bar = 96px, o 48 sin ctx).
function _ajustarStickyInv() {
    try {
        var base = document.body.classList.contains('has-ctx') ? 96 : 48;
        // Header y pasos de la VISTA visible (captura o entradas).
        var vistas = ['vistaCaptura', 'vistaEntradas'];
        vistas.forEach(function(vid){
            var v = document.getElementById(vid);
            if (!v || v.style.display === 'none') return;
            var hdr = v.querySelector('.inv-wizard-header');
            var steps = v.querySelector('.inv-steps');
            var hH = hdr ? hdr.offsetHeight : 60;
            var topSteps = base + hH;
            if (steps) steps.style.top = topSteps + 'px';
            var sH = steps ? steps.offsetHeight : 0;
            var topTool = topSteps + sH;
            v.querySelectorAll('.step-toolbar').forEach(function(tb){ tb.style.top = topTool + 'px'; });
        });
    } catch(e) {}
}
window.addEventListener('resize', function(){ if (typeof _ajustarStickyInv === 'function') _ajustarStickyInv(); });

// ── Toolbar para steps 1 y 2 ──────────────────────────────────
function buildFiltroRegistroBar() {
    const nPend = filasCaptura.filter(f => !_esRegistrado(f)).length;
    const nReg  = filasCaptura.filter(_esRegistrado).length;
    const btnSt = (activo) => activo
        ? 'background:var(--surface2);border-color:var(--accent);color:var(--accent);font-weight:700'
        : 'background:transparent;border-color:var(--border);color:var(--text-muted);font-weight:500';
    return `<div style="display:flex;gap:8px;padding:10px 0 4px">
        <button onclick="setFiltroRegistro('pendientes')"
            style="${btnSt(filtroRegistroActivo==='pendientes')};border:1px solid;border-radius:20px;
            padding:5px 14px;font-family:inherit;font-size:12px;cursor:pointer">
            🔍 Pendientes <span style="opacity:.7">(${nPend})</span>
        </button>
        <button onclick="setFiltroRegistro('registrados')"
            style="${btnSt(filtroRegistroActivo==='registrados')};border:1px solid;border-radius:20px;
            padding:5px 14px;font-family:inherit;font-size:12px;cursor:pointer">
            ✅ Registrados <span style="opacity:.7">(${nReg})</span>
        </button>
    </div>`;
}

function buildToolbar(conModo = true) {
    const pool = filasCaptura
        .filter(f => !filtroFamActivo || f.familia === filtroFamActivo)
        .filter(f => !filtroCatActiva || f.categoria === filtroCatActiva);
    const fams    = [...new Set(filasCaptura.map(f=>f.familia).filter(Boolean))].sort();
    const cats    = [...new Set(filasCaptura.map(f=>f.categoria).filter(Boolean))].sort();
    const subcats = [...new Set(pool.map(f=>f.subcategoria).filter(Boolean))].sort();
    return `<div class="step-toolbar">
        <div class="inv-search">
            <input type="text" placeholder="Buscar producto..." value="${busquedaCapt}"
                oninput="onBusqueda(this.value)">
        </div>
        <select class="filtro-select" id="filtroFamStep" onchange="onFiltroFam(this.value)"
            style="font-size:11px;padding:6px 8px">
            <option value="">Todas las familias</option>
            ${fams.map(f=>`<option value="${f}" ${filtroFamActivo===f?'selected':''}>${f}</option>`).join('')}
        </select>
        <select class="filtro-select" id="filtroCatStep" onchange="onFiltroCat(this.value)"
            style="font-size:11px;padding:6px 8px">
            <option value="">Todas las categorías</option>
            ${cats.map(c=>`<option value="${c}" ${filtroCatActiva===c?'selected':''}>${c}</option>`).join('')}
        </select>
        ${subcats.length ? `<select class="filtro-select" id="filtroSubcatStep" onchange="onFiltroSubcat(this.value)"
            style="font-size:11px;padding:6px 8px">
            <option value="">Todas las sub.</option>
            ${subcats.map(s=>`<option value="${s}" ${filtroSubcatActiva===s?'selected':''}>${s}</option>`).join('')}
        </select>` : ''}
        ${conModo ? `<div class="vista-toggle" style="margin-left:auto">
            <button class="${modoListaCapt==='lista'?'active':''}" onclick="setModoCaptura('lista')">≡ Lista</button>
            <button class="${modoListaCapt==='galeria'?'active':''}" onclick="setModoCaptura('galeria')">⊞ Galería</button>
        </div>` : ''}
    </div>`;
}

function onBusqueda(val) {
    busquedaCapt = val;
    // Actualizar SOLO la lista, no el input → no se pierde el foco al escribir.
    var cont = document.getElementById('step1ListaCont');
    if (cont) { cont.innerHTML = _step1ListaInner(); return; }
    var cont3 = document.getElementById('step3VentasListaCont'); // Paso 3 · Lista completa (ventas)
    if (cont3) { cont3.innerHTML = _step3VentasInner(); return; }
    rerenderCaptura();
}
function onFiltroFam(val)    { filtroFamActivo    = val; filtroSubcatActiva = ''; rerenderCaptura(); }
function onFiltroCat(val)    { filtroCatActiva    = val; filtroSubcatActiva = ''; rerenderCaptura(); }
function onFiltroSubcat(val) { filtroSubcatActiva = val; rerenderCaptura(); }
function setModoCaptura(m)   { modoListaCapt      = m;   rerenderCaptura(); }
function setFiltroRegistro(modo) { filtroRegistroActivo = modo; _existBusqueda = ''; _existInsumoId = null; renderStepContent(); }

// ── Actualizar cells calculadas sin re-render ─────────────────
function fmtBot(n) { return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2); }
function fmtLt(l)  { return l > 0 ? l.toFixed(3) + ' L' : '—'; }

function refreshFilaDisplay(idx) {
    const fila   = filasCaptura[idx];
    const lts    = calcNetLiters(fila);
    const exist  = calcExistenciaBot(fila);
    const efUnit = fila.tipo === 'peso' ? (fila.baseUnit||'g').toLowerCase() : (fila.tipo === 'pza' ? 'pza' : 'bot');
    const elML   = document.getElementById('ml-'+idx);
    const elEF   = document.getElementById('ef-'+idx);
    if (elML) {
        elML.textContent = fmtLt(lts);
        elML.style.color = lts > 0 ? 'var(--green)' : 'var(--text-dim)';
    }
    if (elEF) elEF.textContent = fmtBot(exist) + ' ' + efUnit;
    // Actualizar botón Listo según si hay datos
    const elBtn = document.getElementById('btn-listo-'+idx);
    if (elBtn) {
        const tiene = exist > 0;
        elBtn.textContent        = tiene ? '✓ Registrado — Siguiente →' : '⊙ Registrar en cero — Siguiente →';
        elBtn.style.background   = tiene ? 'rgba(61,190,122,.15)' : 'rgba(245,200,66,.08)';
        elBtn.style.borderColor  = tiene ? 'var(--green)' : 'var(--accent)';
        elBtn.style.color        = tiene ? 'var(--green)' : 'var(--accent)';
    }
    // Botón "Registrar" de la vista de LISTA — cambia a verde al entrar datos
    const elReg = document.getElementById('btn-reg-'+idx);
    if (elReg) { var s = _regBtnState(fila); elReg.textContent = s.txt; elReg.style.background = s.bg; elReg.style.borderColor = s.col; elReg.style.color = s.col; }
}
// Estado del botón Registrar en la lista (verde si hay existencia o ya está registrado; ámbar si va en cero).
function _regBtnState(fila) {
    if (fila.registrado === true) return { col:'var(--green)', bg:'rgba(61,190,122,.18)', txt:'✓ Registrado' };
    if (calcExistenciaBot(fila) > 0) return { col:'var(--green)', bg:'rgba(61,190,122,.10)', txt:'✓ Registrar' };
    return { col:'var(--accent)', bg:'rgba(245,200,66,.08)', txt:'⊙ En cero' };
}

function updCaptura(idx, campo, val) { filasCaptura[idx][campo] = val; refreshFilaDisplay(idx); _autoGuardar(); }
function updPeso(idx, pi, val)       { filasCaptura[idx].pesos[pi] = val; refreshFilaDisplay(idx); _autoGuardar(); }

// ═══════════════════════════════════════════════════════════════
// PASO 1 — Existencias físicas
// ═══════════════════════════════════════════════════════════════
function buildVistaSwitcherExist() {
    return `<div class="exist-vista-switcher">
        <button class="exist-vista-btn ${vistaCapturaExist==='busqueda'?'active':''}"
            onclick="setVistaExist('busqueda')">🔍 Búsqueda rápida</button>
        <button class="exist-vista-btn ${vistaCapturaExist==='lista'?'active':''}"
            onclick="setVistaExist('lista')">≡ Lista completa</button>
    </div>`;
}

function setVistaExist(modo) {
    vistaCapturaExist = modo;
    if (modo !== 'busqueda') { _existBusqueda = ''; _existInsumoId = null; }
    renderStepContent();
}

// Aviso: cuántos insumos no aparecen por no tener área (o ser de otra área).
// Guía al usuario a asignarles su área en el catálogo para incluirlos.
function _avisoAreaHTML() {
    var invA = ((invActual && invActual.area) || '').toString().trim().toLowerCase();
    var scope = _scopeSucInsumos(getInsumos());
    var sinArea = 0, otraArea = 0;
    scope.forEach(function(x){
        var a = (x && x.area || '').toString().trim().toLowerCase();
        if (!a) sinArea++;
        else if (invA && invA !== 'general' && a !== invA) otraArea++;
    });
    if (!sinArea && !otraArea) return '';
    var parts = [];
    if (sinArea)  parts.push('<b style="color:var(--text)">'+sinArea+'</b> sin área');
    if (otraArea) parts.push('<b style="color:var(--text)">'+otraArea+'</b> de otra área');
    return '<div class="wrap" style="padding-top:0"><div style="padding:10px 14px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:8px;background:var(--surface);font-size:12.5px;color:var(--text-dim);line-height:1.5">'+
        '📍 '+parts.join(' · ')+' no aparecen en este inventario de <b style="color:var(--text)">'+etx(invA||'—')+'</b>. Asígnales su área en el <b>Catálogo de insumos</b> (campo «📍 Área — dónde se guarda») para incluirlas aquí.</div></div>';
}

function renderStep1() {
    if (vistaCapturaExist === 'busqueda') {
        const nReg  = filasCaptura.filter(_esRegistrado).length;
        const nPend = filasCaptura.length - nReg;
        const placeholder = filtroRegistroActivo === 'registrados'
            ? 'Buscar en registrados…' : 'Buscar producto pendiente…';
        return buildVistaSwitcherExist() + _avisoAreaHTML() + buildFiltroRegistroBar() + `
            <div class="ent-rapida-wrap">
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Buscar producto</div>
                    <input type="text" id="existBuscador" class="ent-buscador"
                        placeholder="${placeholder}"
                        oninput="buscarInsumoExist(this.value)" autocomplete="off">
                    <div id="existChips" class="ent-chips"></div>
                </div>
                <div id="existCardWrap"></div>
                <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <span style="font-size:11px;color:var(--text-dim);font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Registrados</span>
                            <span style="font-size:13px;font-weight:700;color:${nReg>0?'var(--green)':'var(--text)'}">${nReg} / ${filasCaptura.length} productos</span>
                        </div>
                        ${nReg > 0 ? `
                        <div style="display:flex;gap:8px">
                            <button onclick="guardarYSalir()"
                                style="background:rgba(245,200,66,.1);border:1px solid var(--accent);color:var(--accent);
                                border-radius:7px;padding:6px 14px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">
                                💾 Guardar y salir
                            </button>
                            <button onclick="typeof finalizarPrimerLev==='function'?finalizarPrimerLev():guardarYSalir()"
                                style="background:rgba(61,190,122,.1);border:1px solid var(--green);color:var(--green);
                                border-radius:7px;padding:6px 14px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">
                                ✅ Finalizar
                            </button>
                        </div>` : ''}
                    </div>
                    <div id="existResumen"></div>
                </div>
            </div>`;
    }

    // La lista va en su propio contenedor → la búsqueda actualiza SOLO esto (no el
    // input del toolbar) para no perder el foco al escribir.
    return buildVistaSwitcherExist() + _avisoAreaHTML() + buildFiltroRegistroBar() + buildToolbar(true) +
        '<div id="step1ListaCont">' + _step1ListaInner() + '</div>';
}

// Contenido de la lista (filas filtradas) — se re-renderiza solo al buscar/filtrar.
function _step1ListaInner() {
    const filas = getFilasFiltradas(true);
    const noData = !filasCaptura.length
        ? `<div class="empty-state" style="padding:60px">
            <div class="empty-icon">🗄️</div><div class="empty-title">Sin insumos en catálogo</div>
            <div class="empty-desc">Agrega insumos en Catálogo → Insumos</div></div>`
        : !filas.length
        ? `<div class="empty-state" style="padding:40px">
            <div class="empty-icon">${filtroRegistroActivo==='registrados'?'✅':'🔍'}</div>
            <div class="empty-title">${filtroRegistroActivo==='registrados'?'Sin registrados aún':'Todos registrados'}</div>
            <div class="empty-desc">${filtroRegistroActivo==='registrados'?'Captura existencias en Búsqueda rápida':'¡Levantamiento completo!'}</div>
        </div>` : null;
    return noData || (modoListaCapt === 'galeria' ? renderStep1Galeria(filas) : renderStep1Lista(filas));
}

// ── Búsqueda rápida existencias ───────────────────────────────
function buscarInsumoExist(val) {
    _existBusqueda = val;
    renderChipsExist();
}

function renderChipsExist() {
    const cont = document.getElementById('existChips');
    if (!cont) return;
    const q = _existBusqueda.trim().toLowerCase();
    if (!q) { cont.innerHTML = ''; return; }
    // Filtrar pool según estado de registro activo
    const pool = filtroRegistroActivo === 'registrados'
        ? filasCaptura.filter(_esRegistrado)
        : filasCaptura.filter(f => !_esRegistrado(f));
    const matches = pool.filter(f => f.nombre.toLowerCase().includes(q));
    if (!matches.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Sin resultados para "${etx(_existBusqueda)}"</div>`;
        return;
    }
    cont.innerHTML = matches.map(f => {
        const reg = _esRegistrado(f);
        return `<button class="ent-chip ${_existInsumoId===f.insumoId?'active':''}"
            onclick="seleccionarProductoExist('${f.insumoId}')" style="position:relative">
            ${etx(insumoEtiqueta(f))}
            ${reg?'<span style="position:absolute;top:4px;right:6px;width:6px;height:6px;background:var(--green);border-radius:50%"></span>':''}
        </button>`;
    }).join('');
}

function seleccionarProductoExist(insumoId) {
    _existInsumoId = insumoId;
    renderChipsExist();
    renderCardExist();
}

// Registrar una fila desde la vista de LISTA completa (marca registrado, aunque sea en cero).
function registrarFilaLista(idx) {
    var fila = filasCaptura[idx];
    if (!fila) return;
    fila.registrado = true;
    _autoGuardar();
    renderStepContent(); // actualiza el contador "registrados" y respeta el filtro pendientes/registrados
}
function limpiarSeleccionExist() {
    // Marcar el producto actual como registrado (aunque tenga ceros)
    if (_existInsumoId) {
        const fila = filasCaptura.find(f => f.insumoId === _existInsumoId);
        if (fila) { fila.registrado = true; _autoGuardar(); }
    }
    _existInsumoId = null;
    _existBusqueda = '';
    // Re-render completo para actualizar contadores y filtros
    renderStepContent();
    setTimeout(() => { const inp = document.getElementById('existBuscador'); if (inp) inp.focus(); }, 40);
}

function setMetodoCapturaExist(insumoId, metodo) {
    const fila = filasCaptura.find(f => f.insumoId === insumoId);
    if (!fila) return;
    fila.metodoCaptura = metodo;
    const idx = filasCaptura.indexOf(fila);
    if (vistaCapturaExist === 'busqueda') {
        renderCardExist();
    } else {
        renderStepContent();
    }
}

function updNivel(idx, val) {
    filasCaptura[idx].nivelPct = parseFloat(val) || 0;
    const fila = filasCaptura[idx];
    // update visual fill
    const bar = document.getElementById('nivel-bar-' + idx);
    const pct = document.getElementById('nivel-pct-' + idx);
    if (bar) bar.style.height = (fila.nivelPct || 0) + '%';
    if (pct) pct.textContent = (fila.nivelPct || 0) + '%';
    refreshFilaDisplay(idx);
    _autoGuardar();
}

function previewFotoExist(insumoId, input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const fila = filasCaptura.find(f => f.insumoId === insumoId);
        if (fila) fila.fotoUrl = e.target.result;
        const prev = document.getElementById('foto-preview-' + insumoId);
        if (prev) { prev.src = e.target.result; prev.style.display = 'block'; }
    };
    reader.readAsDataURL(file);
}

function buildInputsExist(fila, idx) {
    const metodo = fila.metodoCaptura || 'peso';
    if (metodo === 'nivel') {
        const pct = fila.nivelPct || 0;
        return `<div class="exist-nivel-wrap">
            <div class="exist-nivel-bottle">
                <div class="exist-nivel-bar" id="nivel-bar-${idx}" style="height:${pct}%"></div>
            </div>
            <div style="flex:1">
                <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Nivel de líquido</div>
                <input type="range" min="0" max="100" value="${pct}" class="nivel-slider"
                    oninput="updNivel(${idx},this.value)">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                    <span id="nivel-pct-${idx}" style="font-size:28px;font-weight:700;color:var(--accent)">${pct}%</span>
                    <span id="ml-${idx}" style="font-size:13px;color:${calcNetLiters(fila)>0?'var(--green)':'var(--text-dim)'}">
                        ${fmtLt(calcNetLiters(fila))}</span>
                </div>
                <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Arrastra para ajustar el nivel de la botella abierta</div>
            </div>
        </div>`;
    }
    if (metodo === 'foto') {
        return `<div>
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Foto de botella</div>
            <label style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;
                padding:24px;border:2px dashed var(--border);border-radius:12px;transition:border-color 0.15s"
                onmouseenter="this.style.borderColor='var(--accent)'" onmouseleave="this.style.borderColor='var(--border)'">
                <span style="font-size:36px">📷</span>
                <span style="font-size:13px;color:var(--text-dim)">Tomar foto o seleccionar imagen</span>
                <input type="file" accept="image/*" style="display:none"
                    onchange="previewFotoExist('${fila.insumoId}',this)">
            </label>
            ${fila.fotoUrl ? `<img id="foto-preview-${fila.insumoId}" src="${etx(fila.fotoUrl)}"
                style="width:100%;border-radius:10px;margin-top:10px;object-fit:cover;max-height:200px">` :
                `<img id="foto-preview-${fila.insumoId}" style="display:none;width:100%;border-radius:10px;margin-top:10px">`}
            <div style="margin-top:10px;padding:10px 12px;background:rgba(245,200,66,0.08);border-radius:8px;
                font-size:11px;color:var(--accent)">
                ⚡ Próximamente: análisis automático de nivel por visión artificial
            </div>
        </div>`;
    }
    // metodo === 'peso' (default)
    const lts = calcNetLiters(fila);
    return `<div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Botellas abiertas — peso con cristal (kg)</div>
        <div class="inv-pesos-row" style="flex-wrap:wrap">
            ${(fila.pesos||['','','','']).map((p,pi)=>`
            <div class="inv-peso-cell">
                <div class="inv-peso-lbl">B${pi+1}</div>
                <input type="number" class="inv-peso-input" value="${p||''}" placeholder="kg" min="0" step="0.001"
                    oninput="updPeso(${idx},${pi},this.value)">
            </div>`).join('')}
        </div>
        <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:var(--text-dim)">Neto líquido</span>
            <span id="ml-${idx}" style="font-size:15px;font-weight:700;color:${lts>0?'var(--green)':'var(--text-dim)'}">
                ${fmtLt(lts)}</span>
        </div>
    </div>`;
}

function renderCardExist() {
    const cont = document.getElementById('existCardWrap');
    if (!cont) return;
    if (!_existInsumoId) { cont.innerHTML = ''; return; }
    const fila = filasCaptura.find(f => f.insumoId === _existInsumoId);
    if (!fila) { cont.innerHTML = ''; return; }
    const idx    = filasCaptura.indexOf(fila);
    if (fila.tipo === 'peso') { cont.innerHTML = _cardExistPeso(fila, idx); return; } // alimentos: tarjeta propia
    const metodo = fila.metodoCaptura || 'peso';
    const exist  = calcExistenciaBot(fila);
    const efUnit = fila.tipo === 'peso' ? (fila.baseUnit||'g').toLowerCase() : (fila.tipo === 'pza' ? 'pza' : 'bot');
    const eaCopas = parseFloat(fila.existenciaAnterior) || 0;
    const copasBot = fila.contNeto>0&&fila.copaML>0 ? fila.contNeto/fila.copaML : 0;
    const eaBot  = fila.tipo==='pza' ? eaCopas : (copasBot>0 ? eaCopas/copasBot : eaCopas);
    const tipoSt = fila.tipo === 'pza'
        ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
        : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';

    cont.innerHTML = `
        <div class="ent-form-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
                <div>
                    <div style="font-weight:700;font-size:17px;color:var(--text)">${etx(insumoTitulo(fila))}</div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">
                        ${insumoMeta(fila)?`<span class="inv-tag">${insumoMetaHTML(fila)}</span>`:''}
                        <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                        <span style="font-size:11px;color:var(--text-dim);margin-left:4px">
                            Anterior: ${eaBot%1===0?eaBot.toFixed(0):eaBot.toFixed(1)} bot</span>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">📋 Ver</button>
                    <button onclick="limpiarSeleccionExist()"
                        style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:20px;padding:0;line-height:1">✕</button>
                </div>
            </div>

            <!-- Método de captura -->
            <div style="margin-bottom:16px">
                <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500">Método de captura</div>
                <div class="ent-tipo-row">
                    <button class="ent-tipo-btn ${metodo==='peso'?'active':''}" onclick="setMetodoCapturaExist('${fila.insumoId}','peso')">⚖️ Peso</button>
                    <button class="ent-tipo-btn ${metodo==='nivel'?'active':''}" onclick="setMetodoCapturaExist('${fila.insumoId}','nivel')">🌡️ Nivel</button>
                    <button class="ent-tipo-btn ${metodo==='foto'?'active':''}" onclick="setMetodoCapturaExist('${fila.insumoId}','foto')">📷 Foto</button>
                </div>
            </div>

            <!-- Copiar existencia anterior -->
            ${_btnCopiarAnterior(idx, fila)}

            <!-- Botellas cerradas -->
            <div style="display:flex;gap:12px;margin-bottom:16px">
                <div style="flex:1">
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Cerradas Bodega</div>
                    <input type="number" class="inv-num-input" style="width:100%;box-sizing:border-box"
                        value="${fila.cerradasBodega||0}" min="0" step="1"
                        oninput="updCaptura(${idx},'cerradasBodega',+this.value)">
                </div>
                <div style="flex:1">
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Cerradas Barra</div>
                    <input type="number" class="inv-num-input" style="width:100%;box-sizing:border-box"
                        value="${fila.cerradasBarra||0}" min="0" step="1"
                        oninput="updCaptura(${idx},'cerradasBarra',+this.value)">
                </div>
            </div>

            <!-- Inputs según método -->
            ${buildInputsExist(fila, idx)}

            <!-- Resultado -->
            <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);
                display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:12px;color:var(--text-dim)">Existencia actual</span>
                <span id="ef-${idx}" style="font-size:22px;font-weight:900;color:var(--accent)">
                    ${fmtBot(exist)} ${efUnit}</span>
            </div>

            <!-- Botón Listo / Siguiente -->
            <div style="margin-top:14px;display:flex;gap:8px">
                <button id="btn-listo-${idx}" onclick="limpiarSeleccionExist()"
                    style="flex:1;background:${exist>0?'rgba(61,190,122,.15)':'rgba(245,200,66,.08)'};
                    border:1px solid ${exist>0?'var(--green)':'var(--accent)'};
                    color:${exist>0?'var(--green)':'var(--accent)'};
                    border-radius:8px;padding:10px 0;font-family:inherit;font-size:13px;
                    font-weight:600;cursor:pointer;transition:all .15s">
                    ${exist>0?'✓ Registrado — Siguiente →':'⊙ Registrar en cero — Siguiente →'}
                </button>
            </div>
        </div>`;
}

// ── ALIMENTOS: tarjeta de captura por peso (unidad base) ──────
function _fmtBase(v){ v = parseFloat(v)||0; return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1); }
// Contenido de la presentación (ej. 750 ml, 1 L, 350 pza) para la info del producto.
function _fmtContenido(fila){
    var cn = parseFloat(fila && fila.contNeto) || 0;
    if (cn <= 0) return '';
    if (fila.tipo === 'pza') return _fmtBase(cn) + ' ' + (fila.baseUnit || 'pza');
    if (fila.tipo === 'peso') return _fmtBase(cn) + ' ' + (fila.baseUnit || 'g');
    return cn >= 1000 ? _fmtBase(cn/1000) + ' L' : _fmtBase(cn) + ' ml';
}
function _cardExistPeso(fila, idx) {
    const u    = (fila.baseUnit || 'G').toLowerCase();
    const ea   = parseFloat(fila.existenciaAnterior) || 0;
    const ent  = getEntradasBottles(fila.insumoId);
    const cons = calcVentasBaseRecetas(fila.insumoId);
    const merm = parseFloat(fila.mermaBase) || 0;
    const teo  = calcExistenciaTeorica(fila);
    const fis  = parseFloat(fila.existenciaPeso) || 0;
    const dif  = fis - teo;
    const difCol = Math.abs(dif) <= teo * 0.1 ? 'var(--green)' : 'var(--red)';
    return `
        <div class="ent-form-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
                <div>
                    <div style="font-weight:700;font-size:17px;color:var(--text)">${etx(insumoTitulo(fila))}</div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;align-items:center">
                        ${fila.categoria?`<span class="inv-tag">${etx(fila.categoria)}</span>`:''}
                        <span class="inv-tag" style="background:rgba(61,190,122,.15);border-color:rgba(61,190,122,.45);color:var(--green)">⚖️ ${u}</span>
                        <span style="font-size:11px;color:var(--text-dim);margin-left:4px">Anterior: ${_fmtBase(ea)} ${u}</span>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">📋 Ver</button>
                    <button onclick="limpiarSeleccionExist()" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:20px;padding:0;line-height:1">✕</button>
                </div>
            </div>

            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:var(--text-muted);line-height:1.7">
                Anterior <b>${_fmtBase(ea)}</b> + entradas <b>${_fmtBase(ent)}</b> − consumo recetas <b style="color:var(--accent)">${_fmtBase(cons)}</b> − merma <b>${_fmtBase(merm)}</b>
                <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center">
                    <span>Existencia teórica</span>
                    <b id="teo-${idx}" style="color:var(--text);font-size:14px">${_fmtBase(teo)} ${u}</b>
                </div>
            </div>

            ${_btnCopiarAnterior(idx, fila)}

            <div style="display:flex;gap:10px;margin-bottom:8px">
                <div style="flex:1.3">
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Existencia física (${u})</div>
                    <input type="number" class="inv-num-input" style="width:100%;box-sizing:border-box" value="${fila.existenciaPeso||''}" min="0" step="any" placeholder="0"
                        oninput="updCapturaPeso(${idx},'existenciaPeso',this.value)">
                </div>
                <div style="flex:1">
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Entradas (${u})</div>
                    <input type="number" class="inv-num-input" style="width:100%;box-sizing:border-box" value="${(fila.entradas&&fila.entradas[0])||''}" min="0" step="any" placeholder="0"
                        oninput="updCapturaPeso(${idx},'entrada0',this.value)">
                </div>
                <div style="flex:1">
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Merma (${u})</div>
                    <input type="number" class="inv-num-input" style="width:100%;box-sizing:border-box" value="${fila.mermaBase||''}" min="0" step="any" placeholder="0"
                        oninput="updCapturaPeso(${idx},'mermaBase',this.value)">
                </div>
            </div>

            <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:12px;color:var(--text-dim)">Diferencia (física − teórica)</span>
                <span id="ef-${idx}" style="font-size:20px;font-weight:900;color:${difCol}">${dif>0?'+':''}${_fmtBase(dif)} ${u}</span>
            </div>

            <div style="margin-top:14px;display:flex;gap:8px">
                <button onclick="limpiarSeleccionExist()" style="flex:1;background:rgba(61,190,122,.15);border:1px solid var(--green);color:var(--green);border-radius:8px;padding:10px 0;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer">✓ Registrado — Siguiente →</button>
            </div>
        </div>`;
}
function updCapturaPeso(idx, campo, val) {
    const fila = filasCaptura[idx]; if (!fila) return;
    if (campo === 'entrada0') { if (!fila.entradas) fila.entradas = ['','','','','']; fila.entradas[0] = val; }
    else if (campo === 'mermaBase') {
        // Input muestra el TOTAL (manual + QR); manual = total − QR (peso).
        fila.mermaBaseManual = Math.max(0, (parseFloat(val) || 0) - (parseFloat(fila._qrBase) || 0));
        fila.mermaBase = (parseFloat(fila.mermaBaseManual) || 0) + (parseFloat(fila._qrBase) || 0);
    }
    else fila[campo] = val;
    // Actualizar teórica + diferencia sin re-render (no perder el foco del input).
    const u   = (fila.baseUnit || 'G').toLowerCase();
    const teo = calcExistenciaTeorica(fila);
    const fis = parseFloat(fila.existenciaPeso) || 0;
    const dif = fis - teo;
    const teoEl = document.getElementById('teo-' + idx);
    if (teoEl) teoEl.textContent = _fmtBase(teo) + ' ' + u;
    const efEl = document.getElementById('ef-' + idx);
    if (efEl) { efEl.textContent = (dif > 0 ? '+' : '') + _fmtBase(dif) + ' ' + u; efEl.style.color = Math.abs(dif) <= teo * 0.1 ? 'var(--green)' : 'var(--red)'; }
    _autoGuardar();
}

function renderResumenExist() {
    const cont = document.getElementById('existResumen');
    if (!cont) return;
    const capturados = filasCaptura.filter(_esRegistrado);
    if (!capturados.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:20px 0">Aún no hay existencias capturadas</div>`;
        return;
    }
    cont.innerHTML = capturados.map(fila => {
        const idx    = filasCaptura.indexOf(fila);
        const exist  = calcExistenciaBot(fila);
        const efUnit = fila.tipo==='peso'?(fila.baseUnit||'g').toLowerCase():(fila.tipo==='pza'?'pza':'bot');
        const metodo = fila.metodoCaptura || 'peso';
        const metIcon = metodo==='nivel'?'🌡️':metodo==='foto'?'📷':'⚖️';
        return `<div class="ent-log-fila" onclick="seleccionarProductoExist('${fila.insumoId}')"
            style="cursor:pointer">
            <span class="ent-log-nombre">${etx(insumoTitulo(fila))}</span>
            <span style="font-size:13px;color:var(--text-dim)">${metIcon}</span>
            <span class="ent-log-cant">${fmtBot(exist)} ${efUnit}</span>
        </div>`;
    }).join('');
}

function initExistBusquedaUI() {
    if (_existBusqueda) {
        const inp = document.getElementById('existBuscador');
        if (inp) inp.value = _existBusqueda;
        renderChipsExist();
    }
    if (_existInsumoId) renderCardExist();
    renderResumenExist();
}

function renderStep1Lista(filas) {
    const rows = filas.map(fila => {
        const idx    = filasCaptura.indexOf(fila);
        const metodo = fila.metodoCaptura || 'peso';
        const eaCopas  = parseFloat(fila.existenciaAnterior) || 0;
        const copasBot = fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0;
        const eaBot    = fila.tipo === 'pza' ? eaCopas : (copasBot > 0 ? eaCopas / copasBot : eaCopas);
        const eaUnit   = fila.tipo === 'peso' ? (fila.baseUnit||'g').toLowerCase() : (fila.tipo === 'pza' ? 'pza' : 'bot');
        const lts      = calcNetLiters(fila);
        const existBot = calcExistenciaBot(fila);
        const efUnit   = fila.tipo === 'peso' ? (fila.baseUnit||'g').toLowerCase() : (fila.tipo === 'pza' ? 'pza' : 'bot');
        const tipoSt   = fila.tipo === 'pza'
            ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
            : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';

        let inputCell = '';
        if (metodo === 'nivel') {
            const pct = fila.nivelPct || 0;
            inputCell = `<td class="inv-td-pesos" style="min-width:200px">
                <div style="display:flex;align-items:center;gap:10px">
                    <div class="exist-nivel-bottle-sm">
                        <div class="exist-nivel-bar" id="nivel-bar-${idx}" style="height:${pct}%"></div>
                    </div>
                    <div style="flex:1">
                        <input type="range" min="0" max="100" value="${pct}" class="nivel-slider"
                            oninput="updNivel(${idx},this.value)">
                        <div style="display:flex;justify-content:space-between;margin-top:2px">
                            <span id="nivel-pct-${idx}" style="font-size:14px;font-weight:700;color:var(--accent)">${pct}%</span>
                            <span id="ml-${idx}" style="font-size:11px;color:${lts>0?'var(--green)':'var(--text-dim)'}">
                                ${fmtLt(lts)}</span>
                        </div>
                    </div>
                </div>
            </td>`;
        } else if (metodo === 'foto') {
            inputCell = `<td class="inv-td-pesos" style="min-width:160px">
                <label style="cursor:pointer;display:flex;align-items:center;gap:8px;
                    padding:8px 12px;border:1px dashed var(--border);border-radius:8px;font-size:12px;color:var(--text-dim)">
                    <span style="font-size:20px">📷</span>
                    ${fila.fotoUrl ? 'Cambiar foto' : 'Tomar foto'}
                    <input type="file" accept="image/*" style="display:none"
                        onchange="previewFotoExist('${fila.insumoId}',this)">
                </label>
                ${fila.fotoUrl ? `<img src="${etx(fila.fotoUrl)}" style="width:60px;height:40px;object-fit:cover;border-radius:4px;margin-top:4px">` : ''}
            </td>`;
        } else {
            inputCell = `<td class="inv-td-pesos">
                <div class="inv-pesos-row">
                ${(fila.pesos||['','','','']).map((p,pi)=>`
                    <div class="inv-peso-cell">
                        <div class="inv-peso-lbl">B${pi+1}</div>
                        <input type="number" class="inv-peso-input" value="${p||''}" placeholder="kg" min="0" step="0.001"
                            oninput="updPeso(${idx},${pi},this.value)">
                    </div>`).join('')}
                </div>
            </td>`;
        }

        return `<tr class="inv-row">
            <td class="inv-td-prod">
                <div class="inv-prod-name">${etx(insumoTitulo(fila))}</div>
                <div class="inv-prod-meta">
                    ${insumoMeta(fila) ? `<span class="inv-tag">${insumoMetaHTML(fila)}</span>` : ''}
                    <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                    <span class="inv-metodo-toggle">
                        <button class="${metodo==='peso'?'on':''}" onclick="setMetodoCapturaExist('${fila.insumoId}','peso')" title="Peso">⚖️</button>
                        <button class="${metodo==='nivel'?'on':''}" onclick="setMetodoCapturaExist('${fila.insumoId}','nivel')" title="Nivel">🌡️</button>
                        <button class="${metodo==='foto'?'on':''}" onclick="setMetodoCapturaExist('${fila.insumoId}','foto')" title="Foto">📷</button>
                    </span>
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">📋 Ver</button>
                </div>
            </td>
            <td class="inv-td-ant">
                <span class="inv-ant-val">${eaBot % 1 === 0 ? eaBot.toFixed(0) : eaBot.toFixed(1)}</span>
                <span class="inv-ant-unit"> ${eaUnit}</span>
            </td>
            <td class="inv-td-input">
                <input type="number" class="inv-num-input" value="${fila.cerradasBodega||0}" min="0" step="1"
                    oninput="updCaptura(${idx},'cerradasBodega',+this.value)">
            </td>
            <td class="inv-td-input">
                <input type="number" class="inv-num-input" value="${fila.cerradasBarra||0}" min="0" step="1"
                    oninput="updCaptura(${idx},'cerradasBarra',+this.value)">
            </td>
            ${inputCell}
            <td class="inv-td-result" ${metodo !== 'peso' ? 'style="display:none"' : ''}>
                <span id="ml-${idx}" style="color:${lts>0?'var(--green)':'var(--text-dim)'}">
                    ${metodo === 'peso' ? fmtLt(lts) : ''}</span></td>
            <td class="inv-td-ef" id="ef-${idx}">${fmtBot(existBot)} ${efUnit}</td>
            <td class="inv-td-c" style="width:104px">
                ${(function(){ var s = _regBtnState(fila);
                    return '<button id="btn-reg-'+idx+'" onclick="registrarFilaLista('+idx+')" style="width:96px;padding:7px 0;border-radius:7px;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;background:'+s.bg+';border:1px solid '+s.col+';color:'+s.col+'">'+s.txt+'</button>'; })()}
                ${_btnCopiarAnterior(idx, fila, 'mini')}
            </td>
        </tr>`;
    }).join('');

    return `<div class="inv-table-wrap">
        <table class="inv-capture-table">
            <thead><tr>
                <th class="inv-th">Producto</th>
                <th class="inv-th inv-th-c" style="width:90px">Anterior</th>
                <th class="inv-th inv-th-c" style="width:96px">Bodega</th>
                <th class="inv-th inv-th-c" style="width:96px">Barra</th>
                <th class="inv-th inv-th-c inv-th-pesos">Botella abierta</th>
                <th class="inv-th inv-th-c" style="width:82px;color:var(--green)">Total (L)</th>
                <th class="inv-th inv-th-c" style="width:92px;color:var(--accent)">Existencia</th>
                <th class="inv-th inv-th-c" style="width:104px">Registrar</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

function renderStep1Galeria(filas) {
    const cards = filas.map(fila => {
        const idx    = filasCaptura.indexOf(fila);
        const mlReal = calcMLReales(fila);
        const exist  = calcExistencia(fila);
        const unidad = fila.tipo === 'pza' ? 'pza' : 'cop';
        const tipoSt = fila.tipo === 'pza'
            ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
            : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';
        return `<div class="inv-item-card">
            <div class="inv-item-card-top">
                <div class="inv-prod-name">${etx(insumoTitulo(fila))}</div>
                <div class="inv-prod-meta" style="margin-top:6px">
                    ${insumoMeta(fila) ? `<span class="inv-tag">${insumoMetaHTML(fila)}</span>` : ''}
                    <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                </div>
                <div style="margin-top:8px;font-size:11px;color:var(--text-dim)">
                    Anterior: <span style="color:var(--text-muted);font-weight:600">${(() => {
                        const ec = parseFloat(fila.existenciaAnterior)||0;
                        const cb = fila.contNeto>0&&fila.copaML>0 ? fila.contNeto/fila.copaML : 0;
                        const eb = fila.tipo==='pza' ? ec : (cb>0 ? ec/cb : ec);
                        const u  = fila.tipo==='pza' ? 'pza' : 'bot';
                        return (eb%1===0?eb.toFixed(0):eb.toFixed(1))+' '+u;
                    })()}</span>
                </div>
            </div>
            <div class="inv-item-card-body">
                <div style="display:flex;gap:8px">
                    <div style="flex:1">
                        <div class="inv-gal-label">Bodega</div>
                        <input type="number" class="inv-num-input" style="width:100%;box-sizing:border-box"
                            value="${fila.cerradasBodega||0}" min="0"
                            oninput="updCaptura(${idx},'cerradasBodega',+this.value)">
                    </div>
                    <div style="flex:1">
                        <div class="inv-gal-label">Barra</div>
                        <input type="number" class="inv-num-input" style="width:100%;box-sizing:border-box"
                            value="${fila.cerradasBarra||0}" min="0"
                            oninput="updCaptura(${idx},'cerradasBarra',+this.value)">
                    </div>
                </div>
                <div>
                    <div class="inv-gal-label" style="margin-bottom:6px">Pesos botellas abiertas (g)</div>
                    <div class="inv-pesos-grid">
                        ${(fila.pesos||['','','','']).map((p,pi)=>`
                        <div>
                            <div style="font-size:9px;color:var(--text-dim);text-align:center;margin-bottom:3px">Bot ${pi+1}</div>
                            <input type="number" value="${p||''}" placeholder="kg" min="0" step="0.001"
                                oninput="updPeso(${idx},${pi},this.value)">
                        </div>`).join('')}
                    </div>
                </div>
                ${(function(){ var b=_btnCopiarAnterior(idx, fila); return b ? '<div style="margin-top:10px">'+b.replace('margin-bottom:14px','margin-bottom:0')+'</div>' : ''; })()}
            </div>
            <div class="inv-item-card-bot">${(() => {
                const lt = calcNetLiters(fila);
                const eb = calcExistenciaBot(fila);
                const eu = fila.tipo==='peso'?(fila.baseUnit||'g').toLowerCase():(fila.tipo==='pza'?'pza':'bot');
                return `
                <span id="ml-${idx}" style="font-size:13px;color:${lt>0?'var(--green)':'var(--text-dim)'}">
                    ${fmtLt(lt)}</span>
                <span id="ef-${idx}" style="font-weight:700;font-size:15px;color:var(--accent)">
                    ${fmtBot(eb)} ${eu}</span>`;
            })()}</div>
        </div>`;
    }).join('');
    return `<div class="inv-galeria-wrap">${cards}</div>`;
}

// ═══════════════════════════════════════════════════════════════
// PASO 2 — Entradas
// ═══════════════════════════════════════════════════════════════
function buildVistaSwitcherEnt() {
    return `<div class="exist-vista-switcher">
        <button class="exist-vista-btn ${vistaEntradas2==='busqueda'?'active':''}"
            onclick="setVistaEntradas2('busqueda')">🔍 Búsqueda rápida</button>
        <button class="exist-vista-btn ${vistaEntradas2==='lista'?'active':''}"
            onclick="setVistaEntradas2('lista')">≡ Lista completa</button>
    </div>`;
}

function setVistaEntradas2(v) {
    vistaEntradas2 = v;
    if (v !== 'busqueda') { _entRapidaBusqueda = ''; _entRapidaInsumoId = null; }
    renderStepContent();
}

function renderStep2() {
    const switcher = buildVistaSwitcherEnt();
    if (vistaEntradas2 === 'lista') {
        const filas  = getFilasFiltradas();
        const noData = !filasCaptura.length
            ? `<div class="empty-state" style="padding:60px"><div class="empty-icon">📥</div><div class="empty-title">Sin insumos</div></div>` : null;
        return switcher + buildToolbar(true) + (noData || renderStep2Lista(filas));
    }
    // vista búsqueda (default)
    const logCount = (invActual?.entradasLog || []).length;
    return switcher + `
        <div class="ent-rapida-wrap">
            <div>
                <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Buscar producto</div>
                <input type="text" id="entBuscador" class="ent-buscador"
                    placeholder="Escribe el nombre del producto…"
                    oninput="buscarInsumoEntrada(this.value)" autocomplete="off">
                <div id="entChips" class="ent-chips"></div>
            </div>
            <div id="entFormCard"></div>
            <div>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                    <span style="font-size:11px;color:var(--text-dim);font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Entradas del período</span>
                    <span id="entLogCount" style="font-size:13px;font-weight:700;color:var(--text)">${logCount} registro${logCount !== 1 ? 's' : ''}</span>
                </div>
                <div id="entLogList"></div>
            </div>
        </div>`;
}

function initEntradaRapidaUI() {
    if (_entRapidaBusqueda) {
        const inp = document.getElementById('entBuscador');
        if (inp) inp.value = _entRapidaBusqueda;
        renderChipsEntrada();
    }
    if (_entRapidaInsumoId) renderFormEntrada();
    renderListadoEntradas();
}

function renderStep2Lista(filas) {
    const rows = filas.map(fila => {
        const idx      = filasCaptura.indexOf(fila);
        const total    = getTotalEntradas(fila);
        const existBot = calcExistenciaBot(fila);
        const efUnit   = fila.tipo === 'peso' ? (fila.baseUnit||'g').toLowerCase() : (fila.tipo === 'pza' ? 'pza' : 'bot');
        const precio   = fila.costoUnitario || 0;
        const tipoSt   = fila.tipo === 'pza'
            ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
            : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';
        return `<tr class="inv-row">
            <td class="inv-td-prod">
                <div class="inv-prod-name">${etx(insumoTitulo(fila))}</div>
                <div class="inv-prod-meta">
                    ${insumoMeta(fila) ? `<span class="inv-tag">${insumoMetaHTML(fila)}</span>` : ''}
                    <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">📋 Ver</button>
                </div>
            </td>
            <td class="inv-td-ant">
                <span class="inv-ant-val">${fmtBot(existBot)}</span>
                <span class="inv-ant-unit"> ${efUnit}</span>
            </td>
            <td class="inv-td-result" style="color:var(--text-muted);font-size:13px">
                ${precio > 0 ? '$' + precio.toFixed(2) : '—'}
            </td>
            <td class="inv-td-pesos">
                <div class="inv-pesos-row">
                ${(fila.entradas||['','','','','']).map((e,ei)=>`
                    <div class="inv-peso-cell">
                        <div class="inv-peso-lbl">E${ei+1}</div>
                        <input type="text" inputmode="decimal" class="inv-peso-input" value="${e||''}" placeholder="0"
                            oninput="this.value=this.value.replace(/[^0-9.]/g,'');updEntrada(${idx},${ei},this.value)">
                    </div>`).join('')}
                </div>
            </td>
            <td class="inv-td-ef" id="ent-tot-${idx}"
                style="color:${total>0?'var(--green)':'var(--text-dim)'}">
                ${total>0?'+'+(total%1?total.toFixed(1):total)+' '+_unidadCompra(fila):'—'}
            </td>
        </tr>`;
    }).join('');

    return `<div class="inv-table-wrap">
        <table class="inv-capture-table">
            <thead><tr>
                <th class="inv-th">Producto</th>
                <th class="inv-th inv-th-c" style="width:90px">Existencia</th>
                <th class="inv-th inv-th-c" style="width:80px;color:var(--text-dim)">$ Ref.</th>
                <th class="inv-th inv-th-c inv-th-pesos">Entradas — cantidad (en su presentación)</th>
                <th class="inv-th inv-th-c" style="width:90px;color:var(--green)">Total</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

function renderStep2Galeria(filas) {
    const cards = filas.map(fila => {
        const idx      = filasCaptura.indexOf(fila);
        const total    = getTotalEntradas(fila);
        const existBot = calcExistenciaBot(fila);
        const efUnit   = fila.tipo === 'peso' ? (fila.baseUnit||'g').toLowerCase() : (fila.tipo === 'pza' ? 'pza' : 'bot');
        const precio   = fila.costoUnitario || 0;
        const tipoSt   = fila.tipo === 'pza'
            ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
            : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';
        return `<div class="inv-item-card">
            <div class="inv-item-card-top">
                <div class="inv-prod-name">${etx(insumoTitulo(fila))}</div>
                <div class="inv-prod-meta" style="margin-top:6px">
                    ${insumoMeta(fila) ? `<span class="inv-tag">${insumoMetaHTML(fila)}</span>` : ''}
                    <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                </div>
                <div style="margin-top:8px;font-size:11px;color:var(--text-dim)">
                    Exist: <span style="color:var(--text-muted);font-weight:600">${fmtBot(existBot)} ${efUnit}</span>
                    ${precio > 0 ? ` · <span style="color:var(--accent)">$${precio.toFixed(2)}/bot</span>` : ''}
                </div>
            </div>
            <div class="inv-item-card-body">
                <div class="inv-gal-label" style="margin-bottom:6px">Entradas (en su presentación)</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px">
                    ${(fila.entradas||['','','','','']).map((e,ei)=>`
                    <div>
                        <div style="font-size:9px;color:var(--text-dim);text-align:center;margin-bottom:3px">E${ei+1}</div>
                        <input type="text" inputmode="decimal" class="inv-pesos-grid-input" value="${e||''}" placeholder="0"
                            oninput="this.value=this.value.replace(/[^0-9.]/g,'');updEntrada(${idx},${ei},this.value)"
                            style="height:42px;font-size:16px;text-align:center;border:1px solid var(--border);
                                   border-radius:8px;background:var(--bg);color:var(--text);width:100%;
                                   font-family:'DM Sans',sans-serif;transition:border-color 0.15s;box-sizing:border-box">
                    </div>`).join('')}
                </div>
            </div>
            <div class="inv-item-card-bot">
                <span style="font-size:11px;color:var(--text-dim)">Total entradas</span>
                <span id="ent-tot-${idx}" style="font-weight:700;font-size:15px;color:${total>0?'var(--green)':'var(--text-dim)'}">
                    ${total>0?'+'+(total%1?total.toFixed(1):total)+' '+_unidadCompra(fila):'—'}
                </span>
            </div>
        </div>`;
    }).join('');
    return `<div class="inv-galeria-wrap">${cards}</div>`;
}

// ── Modal de entrada ──────────────────────────────────────────
let _entradaInsumoId = null;
function abrirModalEntrada(insumoId, nombre) {
    _entradaInsumoId = insumoId;
    const modal = document.getElementById('modalEntrada');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('modalEntNombre').textContent = nombre;
    document.getElementById('entCantidad').value = '';
    document.getElementById('entCosto').value    = '';
    document.getElementById('entFecha').value    = new Date().toISOString().slice(0,10);
    document.getElementById('entNotas').value    = '';
    // Show existing log for this insumo
    const log   = (invActual?.entradasLog||[]).filter(e=>e.insumoId===insumoId);
    const logEl = document.getElementById('logEntradaActual');
    if (logEl) logEl.innerHTML = log.length ? `
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:8px">Entradas anteriores:</div>
        ${log.map((e,i)=>`<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border)">
            <span>${e.fecha||'—'} · ${e.cantidad} bot · $${(e.costo||0).toFixed(2)} · ${etx(e.notas||'')}</span>
            <button onclick="eliminarEntradaLog('${insumoId}',${i})"
                style="color:var(--red);background:none;border:none;cursor:pointer;font-size:11px">🗑️</button>
        </div>`).join('')}` : `<div style="font-size:11px;color:var(--text-dim)">Sin entradas previas</div>`;
}

function cerrarModalEntrada() {
    const modal = document.getElementById('modalEntrada');
    if (modal) modal.style.display = 'none';
    _entradaInsumoId = null;
}

function guardarEntrada() {
    if (!_entradaInsumoId) return;
    const cantidad = parseFloat(document.getElementById('entCantidad').value) || 0;
    if (cantidad <= 0) { alert('Ingresa una cantidad mayor a 0.'); return; }
    const costo  = parseFloat(document.getElementById('entCosto').value)  || 0;
    const fecha  = document.getElementById('entFecha').value || '';
    const notas  = document.getElementById('entNotas').value.trim();
    if (!invActual.entradasLog) invActual.entradasLog = [];
    // Sella con la sucursal del inventario (independencia multi-sucursal): así la entrada
    // no se sale de esta sucursal ni al respaldarse al log global. id estable para editar/borrar.
    invActual.entradasLog.push({
        id: genId() + genId(),
        insumoId: _entradaInsumoId, cantidad, costo, fecha, notas,
        sucursalId: (invActual && invActual.sucursalId) || _sucActiva() || 'suc_principal',
        origen: 'manual'
    });
    cerrarModalEntrada();
    renderStepContent();
}

function eliminarEntradaLog(insumoId, idx) {
    const log = invActual?.entradasLog;
    if (!log) return;
    const idsForIns = log.reduce((arr, e, i) => { if (e.insumoId===insumoId) arr.push(i); return arr; }, []);
    if (idsForIns[idx] !== undefined) {
        log.splice(idsForIns[idx], 1);
        abrirModalEntrada(insumoId, document.getElementById('modalEntNombre')?.textContent || insumoId);
    }
}

// ═══════════════════════════════════════════════════════════════
// PASO 3 — Ventas
// ═══════════════════════════════════════════════════════════════
function setVistaVentas(v) {
    vistaVentas = v;
    if (v !== 'busqueda') { _ventasBusqueda = ''; _ventasInsumoId = null; }
    renderStepContent();
}

function renderStep3() {
    const switcher = `<div class="exist-vista-switcher">
        <button class="exist-vista-btn ${vistaVentas==='menu'?'active':''}"    onclick="setVistaVentas('menu')">📋 Menú</button>
        <button class="exist-vista-btn ${vistaVentas==='lista'?'active':''}"   onclick="setVistaVentas('lista')">≡ Lista completa</button>
        <button class="exist-vista-btn ${vistaVentas==='busqueda'?'active':''}" onclick="setVistaVentas('busqueda')">🔍 Búsqueda rápida</button>
    </div>`;
    // La sección de PREBATCH (batches hechos) va en las TRES vistas del Paso 3:
    // antes solo salía en "Menú" y parecía que la función no existía.
    if (vistaVentas === 'lista')    return switcher + _renderProduccionPrebatch() + renderStep3Insumos();
    if (vistaVentas === 'busqueda') return switcher + _renderProduccionPrebatch() + renderStep3BusquedaScaffold();
    return switcher + _renderProduccionPrebatch() + renderStep3Menu();
}

function renderStep3Insumos() {
    // El buscador actualiza SOLO esta lista (no el toolbar) → no se pierde el foco al escribir.
    return buildToolbar(true) + '<div id="step3VentasListaCont">' + _step3VentasInner() + '</div>';
}
function _step3VentasInner() {
    const b        = busquedaCapt.toLowerCase();
    // Modelo nuevo: cada PRESENTACIÓN (miembro) se vende por separado y aquí es una
    // fila normal. El compuesto es solo consolidación en el reporte → no aparece aquí.
    const filtradas = filasCaptura.filter(f =>
        (!filtroFamActivo || f.familia === filtroFamActivo) &&
        (!filtroCatActiva || f.categoria === filtroCatActiva) &&
        (!b || f.nombre.toLowerCase().includes(b))
    );
    const items = filtradas;
    const _ncop = v => (v % 1 ? (Math.round(v*10)/10).toFixed(1) : v);
    const rows = items.map(fila => {
        const esComp = !!fila.esCompuesto;
        const idx    = esComp ? -1 : filasCaptura.indexOf(fila);
        const unidad = fila.tipo === 'pza' ? 'pza' : 'cop';
        const tipoSt = fila.tipo === 'pza'
            ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
            : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';
        const esCopa = fila.tipo !== 'pza';
        const hV = esComp ? `updVentasCompuesto('${fila.compId}','ventas',+this.value)`   : `updVentasDirectas(${idx},'ventasCopasDirectas',+this.value)`;
        const hC = esComp ? `updVentasCompuesto('${fila.compId}','cortesia',+this.value)` : `updVentasDirectas(${idx},'cortesiaCopas',+this.value)`;
        const hM = esComp ? `updVentasCompuesto('${fila.compId}','merma',+this.value)`    : `updVentasDirectas(${idx},'mermaCopas',+this.value)`;
        return `<tr class="inv-row">
            <td class="inv-td-prod">
                <div class="inv-prod-name">${esComp ? '🧩 ' + etx(fila.nombre) : etx(insumoTitulo(fila))}</div>
                <div class="inv-prod-meta">
                    ${esComp
                        ? `<span class="inv-tag" style="background:rgba(122,184,245,0.12);border-color:rgba(122,184,245,0.4);color:#7ab8f5">compuesto · ${_ncop(fila._existCopas)} cop disp.</span>`
                        : (insumoMeta(fila)?`<span class="inv-tag">${insumoMetaHTML(fila)}</span>`:'')}
                    <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                    ${esComp ? '' : `<button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">📋 Ver</button>`}
                </div>
            </td>
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">${unidad}</div>
                <input type="text" inputmode="decimal" class="inv-num-input" value="${fila.ventasCopasDirectas||0}"
                    oninput="this.value=this.value.replace(/[^0-9.]/g,'');${hV}">
            </td>
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">bot</div>
                ${(esComp || fila.tipo === 'pza')
                    ? `<div style="text-align:center;color:var(--text-dim);font-size:18px;padding-top:4px">—</div>`
                    : `<input type="text" inputmode="decimal" class="inv-num-input" value="${fila.ventasBotella||0}"
                        oninput="this.value=this.value.replace(/[^0-9.]/g,'');updVentasDirectas(${idx},'ventasBotella',+this.value)">`}
            </td>
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">cortesía</div>
                <input type="text" inputmode="decimal" class="inv-num-input" style="border-color:rgba(155,141,232,.4)"
                    value="${fila.cortesiaCopas||0}" oninput="this.value=this.value.replace(/[^0-9.]/g,'');${hC}">
            </td>
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">merma</div>
                <input type="text" inputmode="decimal" class="inv-num-input" style="border-color:rgba(224,90,58,.35)"
                    value="${fila.mermaCopas||0}" oninput="this.value=this.value.replace(/[^0-9.]/g,'');${hM}">
            </td>
        </tr>`;
    }).join('');
    return `<div class="inv-table-wrap">
        <table class="inv-capture-table">
            <thead><tr>
                <th class="inv-th">Producto</th>
                <th class="inv-th inv-th-c" style="width:95px">Copas / Pzas</th>
                <th class="inv-th inv-th-c" style="width:95px">Botellas</th>
                <th class="inv-th inv-th-c" style="width:95px">Cortesía</th>
                <th class="inv-th inv-th-c" style="width:95px">Merma</th>
            </tr></thead>
            <tbody>${rows||'<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:32px">Sin resultados</td></tr>'}</tbody>
        </table>
    </div>`;
}

function updCntMenu(id, delta) {
    if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
    const actual = parseFloat(invActual.cocktailsVendidos[id] || 0);
    const nuevo  = Math.max(0, actual + delta);
    invActual.cocktailsVendidos[id] = nuevo; _consumoDirty = true; window._step5Dirty = true;
    const el = document.getElementById('cnt-' + id);
    if (el) {
        el.value = nuevo; // ahora es un input editable
        el.classList.toggle('active', nuevo > 0);
        const item = el.closest('.step3-menu-item');
        if (item) item.classList.toggle('has-cnt', nuevo > 0);
    }
    _updStep3MenuTotal();
    _autoGuardar();
}
// Captura manual: el usuario teclea la cantidad vendida directamente.
function setCntMenu(id, val) {
    if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
    const nuevo = Math.max(0, parseFloat(val) || 0);
    invActual.cocktailsVendidos[id] = nuevo; _consumoDirty = true; window._step5Dirty = true;
    const el = document.getElementById('cnt-' + id);
    if (el) {
        el.classList.toggle('active', nuevo > 0);
        const item = el.closest('.step3-menu-item');
        if (item) item.classList.toggle('has-cnt', nuevo > 0);
    }
    _updStep3MenuTotal();
    _autoGuardar();
}
function _updStep3MenuTotal() {
    const el = document.getElementById('step3MenuTotal');
    if (!el) return;
    const v = (invActual && invActual.cocktailsVendidos) || {};
    const t = Object.keys(v).reduce(function(s, k){ return s + (parseFloat(v[k]) || 0); }, 0);
    el.textContent = (t % 1 ? t.toFixed(1) : t) + ' unidades';
}

// ── Producción de prebatch (batches hechos) ──────────────────────
function updProduccionPrebatch(id, delta) {
    if (!invActual.prebatchProducidos) invActual.prebatchProducidos = {};
    const actual = parseFloat(invActual.prebatchProducidos[id] || 0);
    const nuevo  = Math.max(0, actual + delta);
    invActual.prebatchProducidos[id] = nuevo;
    window._step5Dirty = true; // la producción cambia la matemática del resumen
    if (typeof _autoGuardar === 'function') _autoGuardar(); // persistir (antes solo quedaba en memoria)
    const el = document.getElementById('prod-' + id);
    if (el) {
        el.textContent = nuevo;
        el.classList.toggle('active', nuevo > 0);
        const item = el.closest('.step3-menu-item');
        if (item) item.classList.toggle('has-cnt', nuevo > 0);
    }
}

function _renderProduccionPrebatch() {
    const pres = prebatchesProducibles();
    if (!pres.length) {
        // Estado vacío INFORMATIVO (antes devolvía '' y la función parecía no existir).
        // Diagnóstico: insumos de producción propia SIN liga a su sub-receta.
        const rotos = _scopeSucInsumos(getInsumos()).filter(x => x.esSubReceta && !x.recetaId);
        return `<div style="margin:0 16px 14px;padding:10px 14px;border:1px dashed var(--border);border-radius:10px;font-size:12px;color:var(--text-dim);line-height:1.6">
            🍸 <strong style="color:var(--text-muted)">Producción de prebatch:</strong> convierte una sub-receta a insumo
            (botón <strong style="color:var(--text-muted)">"Cargar como insumo"</strong> en el editor de la sub-receta) y aparecerá aquí
            para registrar los batches hechos — suma existencia al prebatch y descuenta sus insumos base automáticamente.
            ${rotos.length ? `<br>⚠️ <strong style="color:var(--accent)">${etx(rotos.map(x=>x.nombre).slice(0,4).join(', '))}</strong> ${rotos.length===1?'es producción propia pero no tiene':'son producción propia pero no tienen'} liga a su sub-receta — ábrela y vuelve a usar "Cargar como insumo" para ligarla.` : ''}
        </div>`;
    }
    const prod = invActual?.prebatchProducidos || {};
    const items = pres.map(p => {
        const n  = parseFloat(prod[p.id]) || 0;
        const sr = getRecetas().find(r => r.id === p.recetaId);
        const bases = sr ? (sr.ingredientes||[]).map(ing => {
            const ins = getInsumos().find(x => x.id === ing.insumoId);
            return ins ? ins.nombre.split(' ')[0] : '?';
        }).slice(0,3).join(', ') : '';
        return `<div class="step3-menu-item ${n>0?'has-cnt':''}">
            <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px;color:var(--text);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${etx(p.nombre)}</div>
                ${bases?`<div style="font-size:10px;color:var(--text-dim);margin-top:2px;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">↓ ${etx(bases)}</div>`:''}
            </div>
            <div class="step3-counter">
                <button onclick="updProduccionPrebatch('${p.id}',-1)">−</button>
                <span id="prod-${p.id}" class="step3-cnt-val ${n>0?'active':''}">${n}</span>
                <button onclick="updProduccionPrebatch('${p.id}',1)">+</button>
            </div>
        </div>`;
    }).join('');
    return `<div style="padding:0 16px 16px">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1.5px;
            color:var(--accent);padding:12px 0 4px;border-bottom:1px solid var(--border);margin-bottom:4px">
            🍸 Producción de prebatch — batches hechos
        </div>
        <div style="font-size:11px;color:var(--text-dim);padding:0 0 10px">
            Anota cuántos batches hiciste: descuenta los insumos base por receta y le suma la producción al prebatch.
        </div>
        <div class="step3-menu-grid">${items}</div>
    </div>`;
}

// Buscador de cocteles/recetas en la vista Menú del Paso 3 (filtra sin re-render → no pierde foco).
var _menuBusquedaVentas = '';
function _filtrarMenuVentas(q){
    _menuBusquedaVentas = q || '';
    var t = (q||'').toLowerCase().trim();
    document.querySelectorAll('[data-menu-nom]').forEach(function(el){
        el.style.display = (!t || el.getAttribute('data-menu-nom').indexOf(t) >= 0) ? '' : 'none';
    });
    document.querySelectorAll('[data-menu-grupo]').forEach(function(g){
        var vis = false;
        g.querySelectorAll('[data-menu-nom]').forEach(function(c){ if (c.style.display !== 'none') vis = true; });
        g.style.display = vis ? '' : 'none';
    });
}
function renderStep3Menu() {
    // Visibilidad (regla única, insumo-label.js): activa global + vive en la
    // sucursal + no pausada aquí. Sin sucursal activa → solo el status global.
    const _sucP3 = localStorage.getItem('etaax_sucursal_activa') || '';
    const recetas  = getRecetas().filter(r =>
        (r.tipo === 'alimentos' || r.tipo === 'bebidas') &&
        ((_sucP3 && typeof window._recetaActivaEnSuc === 'function')
            ? window._recetaActivaEnSuc(r, _sucP3)
            : r.status !== 'inactiva')
    );
    const vendidos = invActual?.cocktailsVendidos || {};
    if (!recetas.length) {
        return `<div class="empty-state" style="padding:60px">
            <div class="empty-icon">📋</div>
            <div class="empty-title">Sin menú activo</div>
            <div class="empty-desc">Activa recetas en Administrativo → Menú</div>
        </div>`;
    }
    const grupos = {};
    recetas.forEach(r => {
        const g = r.grupo || (r.tipo === 'alimentos' ? '🍽️ Alimentos' : '🍹 Bebidas');
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push(r);
    });
    const totalItems = recetas.reduce((s, r) => s + (parseFloat(vendidos[r.id]) || 0), 0);
    const resumenHtml = `<div style="padding:12px 16px 4px;display:flex;align-items:center;gap:12px">
        <span style="font-size:11px;color:var(--text-dim)">Total registrado:</span>
        <span id="step3MenuTotal" style="font-size:15px;font-weight:700;color:var(--green)">${totalItems} unidades</span>
    </div>
    <div style="padding:4px 16px 10px">
        <input type="text" id="menuBuscarCoctel" placeholder="🔍 Buscar coctel o receta…"
            value="${etx(_menuBusquedaVentas||'')}" oninput="_filtrarMenuVentas(this.value)"
            style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:11px 14px;border-radius:10px;font-family:inherit;font-size:14px;outline:none;box-sizing:border-box"
            onfocus="this.style.borderColor='var(--green)'" onblur="this.style.borderColor='var(--border)'">
    </div>`;
    const gruposHtml = Object.entries(grupos).map(([grp, items]) => `
        <div style="padding:0 16px 16px" data-menu-grupo>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1.5px;
                color:var(--text-muted);padding:12px 0 8px;border-bottom:1px solid var(--border);margin-bottom:10px">
                ${grp}
            </div>
            <div class="step3-menu-grid">
                ${items.map(r => {
                    const p   = parseFloat(r.precioEnCarta) || 0;
                    const cnt = parseFloat(vendidos[r.id]) || 0;
                    const ingStr = (r.ingredientes||[]).map(ing => {
                        const ins = filasCaptura.find(f=>f.insumoId===ing.insumoId);
                        return ins ? ins.nombre.split(' ')[0] : '?';
                    }).slice(0,3).join(', ');
                    return `<div class="step3-menu-item ${cnt>0?'has-cnt':''}" data-menu-nom="${etx((r.nombre||'').toLowerCase())}">
                        <div style="flex:1;min-width:0">
                            <div style="display:flex;align-items:center;gap:6px;min-width:0">
                                <div style="font-weight:600;font-size:14px;color:var(--text);
                                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${etx(r.nombre)}</div>
                                <button onclick="verFichaReceta('${r.id}')" title="Ficha técnica" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:13px;padding:0;flex-shrink:0">📋</button>
                            </div>
                            ${ingStr?`<div style="font-size:10px;color:var(--text-dim);margin-top:2px;
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ingStr}</div>`:''}
                            ${p>0?`<div style="font-size:12px;color:var(--green);font-weight:600;margin-top:2px">$${p.toFixed(0)}</div>`:''}
                        </div>
                        <div class="step3-counter">
                            <button onclick="updCntMenu('${r.id}',-1)">−</button>
                            <input id="cnt-${r.id}" type="text" inputmode="numeric"
                                class="step3-cnt-val ${cnt>0?'active':''}" value="${cnt}"
                                oninput="this.value=this.value.replace(/[^0-9.]/g,'');setCntMenu('${r.id}',this.value)"
                                style="width:42px;text-align:center;background:transparent;border:none;outline:none;font-family:inherit">
                            <button onclick="updCntMenu('${r.id}',1)">+</button>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`).join('');
    return resumenHtml + gruposHtml;
}

// Costo de un ingrediente, calculado EN VIVO desde el costo actual del insumo
// (no el ing.costo guardado, que suele venir en 0/viejo).
function _costoIngrediente(ing) {
    var fila = filasCaptura.find(function(f){ return f.insumoId === ing.insumoId; });
    if (!fila) return parseFloat(ing.costo) || 0; // insumo fuera de la captura → respaldo
    var cc   = costoCopa(fila); // por copa (licor) / por base g-ml (alimento) / por pza
    var cant = parseFloat(ing.cantidad) || 0;
    var u    = (ing.unidad || '').toString().toUpperCase();
    if (fila.tipo === 'pza' || u === 'PZA' || u === 'PZ') return cc * cant;
    if (fila.tipo === 'peso') return cc * ingredienteBase(cant, ing.unidad);
    // licor: cantidad → ml, ÷ copaML = copas, × costo por copa
    var ml = ingredienteML(cant, ing.unidad);
    return fila.copaML > 0 ? (ml / fila.copaML) * cc : 0;
}
// Ficha técnica de una receta (igual que en escandallos): ingredientes, costo, carta, margen.
function _frKpi(lbl, val, col) {
    return '<div style="flex:1;min-width:88px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px">'+
        '<div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">'+lbl+'</div>'+
        '<div style="font-size:16px;font-weight:700;color:'+col+';margin-top:2px">'+val+'</div></div>';
}
var _frRecetaId = null;
function verFichaReceta(recetaId, editar) {
    var r = getRecetas().find(function(x){ return x.id === recetaId; });
    if (!r) { alert('Receta no encontrada.'); return; }
    _frRecetaId = recetaId;
    var ed = !!editar;
    var ings = r.ingredientes || [];
    var costoTotal = ings.reduce(function(s,ing){ return s + _costoIngrediente(ing); }, 0); // costo EN VIVO
    var precio = parseFloat(r.precioEnCarta) || 0;
    var margen = precio > 0 ? ((precio - costoTotal)/precio*100) : 0;
    var foodCost = precio > 0 ? (costoTotal/precio*100) : 0;
    var inpSt = 'background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:13px';
    var html = '<div style="padding:18px 20px">'+
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px">'+
            '<div><div style="font-size:20px;font-weight:700;color:var(--text)">'+etx(r.nombre)+'</div>'+
            '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">'+etx(r.grupo||(r.tipo==='alimentos'?'Alimentos':'Bebidas'))+'</div></div>'+
            '<div style="display:flex;gap:6px">'+
                (ed ? '<button class="btn-vista" style="color:var(--green);border-color:var(--green)" onclick="guardarFichaReceta()">💾 Guardar</button>'
                    : '<button class="btn-vista" onclick="verFichaReceta(\''+recetaId+'\',true)">✏️ Editar</button>')+
                '<button class="btn-vista" onclick="document.getElementById(\'modalFichaReceta\').style.display=\'none\'">✕</button>'+
            '</div></div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
            (ed ? '<div style="flex:1;min-width:90px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">Precio carta</div><input id="frPrecio" type="number" min="0" step="0.01" value="'+precio+'" style="'+inpSt+';width:100%;margin-top:3px;font-size:15px;font-weight:700;box-sizing:border-box"></div>'
                : _frKpi('Precio carta', '$'+precio.toFixed(2), 'var(--green)'))+
            _frKpi('Costo', '$'+costoTotal.toFixed(2), 'var(--accent)')+
            _frKpi('Margen', (precio>0?margen.toFixed(1)+'%':'—'), 'var(--text)')+
            _frKpi('Food cost', (precio>0?foodCost.toFixed(1)+'%':'—'), foodCost>30?'var(--red)':'var(--green)')+
        '</div>'+
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px;font-weight:600">Ingredientes ('+ings.length+')</div>'+
        '<table style="width:100%;border-collapse:collapse;font-size:13px">'+
            '<thead><tr style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px"><th style="text-align:left;padding:5px 8px">Insumo</th><th style="text-align:right">Cantidad</th><th style="text-align:right;padding-right:8px">Costo</th></tr></thead>'+
            '<tbody>'+(ings.length?ings.map(function(ing,i){
                var costo = _costoIngrediente(ing);
                var cantCell = ed
                    ? '<input id="frCant-'+i+'" type="number" min="0" step="any" value="'+(ing.cantidad||'')+'" style="'+inpSt+';width:62px;text-align:right"> '+etx(ing.unidad||'')
                    : (ing.cantidad||'')+' '+etx(ing.unidad||'');
                return '<tr style="border-top:1px solid var(--border)"><td style="padding:7px 8px;color:var(--text)">'+etx(ing.nombre||'—')+'</td>'+
                '<td style="text-align:right;color:var(--text-muted);white-space:nowrap">'+cantCell+'</td>'+
                '<td style="text-align:right;padding-right:8px;color:var(--accent)">$'+costo.toFixed(2)+'</td></tr>';
            }).join(''):'<tr><td colspan="3" style="text-align:center;color:var(--text-dim);padding:16px">Sin ingredientes</td></tr>')+
            '<tr style="border-top:2px solid var(--border)"><td style="padding:8px;font-weight:700;color:var(--text)">Total costo</td><td></td><td style="text-align:right;padding-right:8px;font-weight:700;color:var(--accent)">$'+costoTotal.toFixed(2)+'</td></tr>'+
            '</tbody></table>'+
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin:16px 0 6px;font-weight:600">Preparación</div>'+
        (ed ? '<textarea id="frPrep" style="'+inpSt+';width:100%;min-height:70px;resize:vertical;box-sizing:border-box">'+etx(r.preparacion||'')+'</textarea>'
            : (r.preparacion?'<div style="font-size:13px;color:var(--text-muted);line-height:1.6;white-space:pre-wrap">'+etx(r.preparacion)+'</div>':'<div style="font-size:12px;color:var(--text-dim)">—</div>'))+
        '</div>';
    document.getElementById('fichaRecetaBody').innerHTML = html;
    document.getElementById('modalFichaReceta').style.display = 'flex';
}
// Guarda la edición de la receta en la tabla `recetas` → se actualiza en todos lados.
function guardarFichaReceta() {
    var r = getRecetas().find(function(x){ return x.id === _frRecetaId; });
    if (!r) return;
    var pEl = document.getElementById('frPrecio'); if (pEl) r.precioEnCarta = parseFloat(pEl.value) || 0;
    var prep = document.getElementById('frPrep');  if (prep) r.preparacion = prep.value;
    (r.ingredientes || []).forEach(function(ing, i){
        var c = document.getElementById('frCant-' + i);
        if (c) ing.cantidad = parseFloat(c.value) || 0;
        ing.costo = Math.round(_costoIngrediente(ing) * 100) / 100; // recalcular y guardar el costo
    });
    r.costo = (r.ingredientes || []).reduce(function(s, ing){ return s + (parseFloat(ing.costo) || 0); }, 0);
    r.updatedAt = new Date().toISOString();
    try {
        var negId = getNegocioActivo();
        if (typeof sbUpsert === 'function' && negId) sbUpsert('recetas', r, negId); // nube → todos los módulos
    } catch(e) { console.warn('[guardarFichaReceta]', e); }
    if (typeof renderStepContent === 'function') renderStepContent(); // refresca el menú/ventas
    verFichaReceta(_frRecetaId, false);
}

// ── Búsqueda rápida ventas ────────────────────────────────────
function renderStep3BusquedaScaffold() {
    const conVentas = filasCaptura.filter(f =>
        (f.ventasCopasDirectas||0)>0 || (f.ventasBotella||0)>0 ||
        (f.cortesiaCopas||0)>0 || (f.mermaCopas||0)>0
    ).length;
    return `<div class="ent-rapida-wrap">
        <div>
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Buscar producto</div>
            <input type="text" id="ventasBuscador" class="ent-buscador"
                placeholder="Escribe el nombre del producto…"
                oninput="buscarInsumoVentas(this.value)" autocomplete="off">
            <div id="ventasChips" class="ent-chips"></div>
        </div>
        <div id="ventasCardWrap"></div>
        <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                <span style="font-size:11px;color:var(--text-dim);font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Ventas capturadas</span>
                <span style="font-size:13px;font-weight:700;color:var(--text)">${conVentas} producto${conVentas!==1?'s':''}</span>
            </div>
            <div id="ventasResumen"></div>
        </div>
    </div>`;
}

function initVentasBusquedaUI() {
    if (_ventasBusqueda) {
        const inp = document.getElementById('ventasBuscador');
        if (inp) inp.value = _ventasBusqueda;
        renderChipsVentas();
    }
    if (_ventasInsumoId) renderCardVentas();
    renderResumenVentas();
}

function buscarInsumoVentas(val) {
    _ventasBusqueda = val;
    renderChipsVentas();
}

function renderChipsVentas() {
    const cont = document.getElementById('ventasChips');
    if (!cont) return;
    const q = _ventasBusqueda.trim().toLowerCase();
    if (!q) { cont.innerHTML = ''; return; }
    // Cada presentación se vende como fila normal (el compuesto es solo consolidación en el reporte).
    const matches = filasCaptura.filter(f => f.nombre.toLowerCase().includes(q));
    if (!matches.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Sin resultados para "${etx(_ventasBusqueda)}"</div>`;
        return;
    }
    cont.innerHTML = matches.map(f => {
        const esComp = !!f.esCompuesto;
        const tieneVentas = (f.ventasCopasDirectas||0)>0 || (!esComp && (f.ventasBotella||0)>0) || (f.cortesiaCopas||0)>0 || (f.mermaCopas||0)>0;
        return `<button class="ent-chip ${_ventasInsumoId===f.insumoId?'active':''}"
            onclick="seleccionarProductoVentas('${f.insumoId}')" style="position:relative">
            ${esComp ? '🧩 ' + etx(f.nombre) : etx(insumoEtiqueta(f))}
            ${tieneVentas?'<span style="position:absolute;top:4px;right:6px;width:6px;height:6px;background:var(--green);border-radius:50%"></span>':''}
        </button>`;
    }).join('');
}

function seleccionarProductoVentas(insumoId) {
    _ventasInsumoId = insumoId;
    renderChipsVentas();
    renderCardVentas();
}

function limpiarSeleccionVentas() {
    _ventasInsumoId = null;
    _ventasBusqueda = '';
    const inp = document.getElementById('ventasBuscador');
    if (inp) { inp.value = ''; inp.focus(); }
    renderChipsVentas();
    renderCardVentas();
}

function renderCardVentas() {
    const cont = document.getElementById('ventasCardWrap');
    if (!cont) return;
    if (!_ventasInsumoId) { cont.innerHTML = ''; return; }
    // (Los compuestos ya no se venden: cada presentación se vende como fila normal.)
    const fila = filasCaptura.find(f => f.insumoId === _ventasInsumoId);
    if (!fila) { cont.innerHTML = ''; return; }
    const idx    = filasCaptura.indexOf(fila);
    const unidad = fila.tipo === 'pza' ? 'pza' : 'cop';
    const tipoSt = fila.tipo === 'pza'
        ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
        : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';
    const esCopa = fila.tipo !== 'pza';
    cont.innerHTML = `
        <div class="ent-form-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
                <div>
                    <div style="font-weight:700;font-size:17px;color:var(--text)">${etx(insumoTitulo(fila))}</div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">
                        ${fila.categoria?`<span class="inv-tag">${fila.categoria}</span>`:''}
                        <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                    </div>
                </div>
                <div style="display:flex;gap:6px;align-items:flex-start">
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">📋 Ver</button>
                    <button onclick="limpiarSeleccionVentas()"
                        style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:20px;padding:0;line-height:1">✕</button>
                </div>
            </div>

            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600">Ventas</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">${unidad} vendidas</div>
                    <input type="number" id="venta-copas-${idx}" class="inv-num-input"
                        style="width:100px" value="${fila.ventasCopasDirectas||0}" min="0" step="0.5"
                        oninput="updVentasDirectas(${idx},'ventasCopasDirectas',+this.value);renderResumenVentas()">
                </div>
                ${esCopa ? `<div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Botellas vendidas</div>
                    <input type="number" id="venta-bot-${idx}" class="inv-num-input"
                        style="width:100px" value="${fila.ventasBotella||0}" min="0" step="1"
                        oninput="updVentasDirectas(${idx},'ventasBotella',+this.value);renderResumenVentas()">
                </div>` : ''}
            </div>

            <div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:14px">
                <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600">Cortesía</div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
                    <div>
                        <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">${esCopa?'Copas':'Piezas'}</div>
                        <input type="number" class="inv-num-input"
                            style="width:100px;border-color:rgba(155,141,232,.5)"
                            value="${fila.cortesiaCopas||0}" min="0" step="0.5"
                            oninput="updVentasDirectas(${idx},'cortesiaCopas',+this.value);renderResumenVentas()">
                    </div>
                    <div style="flex:1;min-width:140px">
                        <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Concepto</div>
                        <input type="text" class="inv-num-input"
                            style="width:100%;border-color:rgba(155,141,232,.5)"
                            value="${fila.cortesiaConcepto||''}" placeholder="ej. VIP, degustación…"
                            oninput="updVentasConcepto(${idx},'cortesiaConcepto',this.value)">
                    </div>
                </div>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:14px">
                <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600">Merma</div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
                    <div>
                        <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">${esCopa?'Copas':'Piezas'}</div>
                        <input type="number" class="inv-num-input"
                            style="width:100px;border-color:rgba(224,90,58,.4)"
                            value="${fila.mermaCopas||0}" min="0" step="0.5"
                            oninput="updVentasDirectas(${idx},'mermaCopas',+this.value);renderResumenVentas()">
                    </div>
                    <div style="flex:1;min-width:140px">
                        <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Concepto</div>
                        <input type="text" class="inv-num-input"
                            style="width:100%;border-color:rgba(224,90,58,.4)"
                            value="${fila.mermaConcepto||''}" placeholder="ej. derrame, rotura…"
                            oninput="updVentasConcepto(${idx},'mermaConcepto',this.value)">
                    </div>
                </div>
            </div>

            ${fila.costoUnitario ? `<div style="margin-top:14px;font-size:11px;color:var(--text-dim);border-top:1px solid var(--border);padding-top:10px">
                Costo referencia: <span style="color:var(--accent)">$${(fila.costoUnitario).toFixed(2)}/bot</span>
            </div>` : ''}
        </div>`;
}

// (_cardVentasCompuesto se eliminó: en el modelo nuevo cada presentación se vende
//  como fila normal y el compuesto es solo consolidación de lectura en el Paso 5.
//  updVentasCompuesto queda como writer dormido de invActual.ventasCompuesto.)

function renderResumenVentas() {
    const cont = document.getElementById('ventasResumen');
    if (!cont) return;
    const conVentas = filasCaptura.filter(f =>                    // cada presentación con sus propias ventas
        (f.ventasCopasDirectas||0)>0 || (f.ventasBotella||0)>0 ||
        (f.cortesiaCopas||0)>0 || (f.mermaCopas||0)>0
    );
    const todos = conVentas;
    if (!todos.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:20px 0">Sin ventas capturadas aún</div>`;
        return;
    }
    cont.innerHTML = todos.map(fila => {
        const esComp = !!fila.esCompuesto;
        const unidad = fila.tipo==='pza'?'pza':'cop';
        const partes = [];
        if ((fila.ventasCopasDirectas||0)>0)  partes.push(`${fila.ventasCopasDirectas} ${unidad}`);
        if (!esComp && (fila.ventasBotella||0)>0) partes.push(`${fila.ventasBotella} bot`);
        if ((fila.cortesiaCopas||0)>0)        partes.push(`${fila.cortesiaCopas} cortesía`);
        if ((fila.mermaCopas||0)>0)           partes.push(`${fila.mermaCopas} merma`);
        return `<div class="ent-log-fila" onclick="seleccionarProductoVentas('${fila.insumoId}')" style="cursor:pointer">
            <span class="ent-log-nombre">${esComp ? '🧩 ' + etx(fila.nombre) : etx(insumoTitulo(fila))}</span>
            <span class="ent-log-cant" style="color:var(--accent)">${partes.join(' · ')}</span>
        </div>`;
    }).join('');
}

function updCoctelVendido(id, val) {
    if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
    invActual.cocktailsVendidos[id] = val; _consumoDirty = true; window._step5Dirty = true;
}
function updVentasDirectas(idx, campo, val) {
    var f = filasCaptura[idx]; if (!f) return;
    // Merma/cortesía: el input muestra el TOTAL (manual + QR). Guardamos el MANUAL = total − QR
    // para no perder la parte del QR al recalcular (_recomputarMovsQR).
    if (campo === 'mermaCopas') {
        f.mermaManual = Math.max(0, (parseFloat(val) || 0) - (parseFloat(f._qrMerma) || 0));
        f.mermaCopas  = (parseFloat(f.mermaManual) || 0) + (parseFloat(f._qrMerma) || 0);
    } else if (campo === 'cortesiaCopas') {
        f.cortesiaManual = Math.max(0, (parseFloat(val) || 0) - (parseFloat(f._qrCort) || 0));
        f.cortesiaCopas  = (parseFloat(f.cortesiaManual) || 0) + (parseFloat(f._qrCort) || 0);
    } else {
        f[campo] = val;
    }
    _autoGuardar();
}
function updVentasConcepto(idx, campo, val) { filasCaptura[idx][campo] = val; _autoGuardar(); }

// ═══════════════════════════════════════════════════════════════
// PASO 4 — Cancelaciones y Descuentos (dos sub-tabs)
// ═══════════════════════════════════════════════════════════════
function setPaso4Tab(tab) { _paso4Tab = tab; renderStepContent(); }

function renderStep4() {
    const cancelaciones = invActual?.cancelaciones || [];
    const descuentos    = invActual?.descuentos    || [];
    const totalDesc     = descuentos.reduce((s,d)=>s+(parseFloat(d.monto)||0),0);

    const tabBar = `
    <div style="display:flex;gap:6px;padding:16px 16px 0">
        <button class="btn-vista" onclick="setPaso4Tab('cancelaciones')"
            style="${_paso4Tab==='cancelaciones'?'color:var(--accent);border-color:var(--accent)':''}">
            🚫 Cancelaciones
            <span class="pill pill-amber" style="margin-left:6px;font-size:10px">${cancelaciones.length}</span>
        </button>
        <button class="btn-vista" onclick="setPaso4Tab('descuentos')"
            style="${_paso4Tab==='descuentos'?'color:var(--green);border-color:var(--green)':''}">
            💸 Descuentos
            ${descuentos.length ? `<span class="pill pill-green" style="margin-left:6px;font-size:10px">$${totalDesc.toFixed(0)}</span>` : ''}
        </button>
    </div>`;

    return tabBar + (_paso4Tab === 'cancelaciones'
        ? _renderCancelacionesTab(cancelaciones)
        : _renderDescuentosTab(descuentos, totalDesc));
}

function _renderCancelacionesTab(cancelaciones) {
    // Run auto-match on cancelaciones that haven't been matched yet
    _autoMatchCancelaciones();
    const noMatch = cancelaciones.filter(c => !c.insumoId).length;
    const insumoOpts = filasCaptura.map(f =>
        `<option value="${f.insumoId}">${etx(insumoEtiqueta(f))}</option>`
    ).join('');

    const tabla = cancelaciones.length ? `<div class="tabla-wrap" style="overflow-x:auto"><table style="min-width:820px">
        <thead><tr>
            <th style="width:110px">Fecha / Hora</th>
            <th>Producto POS</th>
            <th style="width:55px;text-align:center">Cant.</th>
            <th style="width:165px">Insumo detectado</th>
            <th>Motivo</th>
            <th style="width:80px">Mesero</th>
            <th style="width:28px"></th>
        </tr></thead>
        <tbody>${cancelaciones.map((c,i)=>{
            const matched = !!c.insumoId;
            const badge = matched
                ? `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(61,190,122,.12);
                    border:1px solid rgba(61,190,122,.4);color:var(--green);border-radius:6px;
                    padding:2px 8px;font-size:11px;font-weight:600;max-width:100%;overflow:hidden;
                    text-overflow:ellipsis;white-space:nowrap" title="${c.insumoNombre||''}">
                    ✓ ${c.insumoNombre||'—'}</span>`
                : `<span style="background:rgba(245,200,66,.12);border:1px solid rgba(245,200,66,.4);
                    color:var(--accent);border-radius:6px;padding:2px 8px;font-size:11px">
                    ⚠ Sin match</span>`;
            return `<tr>
                <td style="font-size:11px;color:var(--text-dim);white-space:nowrap">${c.fechaHora||'—'}</td>
                <td style="font-size:12px;font-weight:500">${etx(c.nombreProducto||'—')}</td>
                <td style="text-align:center;font-weight:600">${c.cantidad||'—'}</td>
                <td>
                    <div style="display:flex;flex-direction:column;gap:4px">
                        ${badge}
                        <select onchange="_setCancelInsumo(${i},this.value)"
                            style="font-size:10px;background:var(--surface2);border:1px solid var(--border);
                            color:var(--text-muted);border-radius:5px;padding:2px 4px;width:100%;font-family:inherit">
                            <option value="">— cambiar insumo —</option>
                            ${insumoOpts}
                        </select>
                    </div>
                </td>
                <td style="color:var(--text-dim);font-size:11px">${c.motivo||'—'}</td>
                <td style="color:var(--text-dim);font-size:11px">${c.mesero||'—'}</td>
                <td><button class="btn-vista" style="padding:3px 8px;font-size:10px;color:var(--red);border-color:var(--red)"
                    onclick="eliminarCancelacion(${i})">🗑️</button></td>
            </tr>`;
        }).join('')}</tbody>
    </table></div>` : `<div class="empty-state" style="padding:40px">
        <div class="empty-icon">🚫</div><div class="empty-title">Sin cancelaciones</div>
        <div class="empty-desc">Agrega manualmente o importa desde tu POS</div></div>`;

    return `
    <div class="card" style="max-width:none;margin:12px 16px 0">
        <div class="card-header">
            <h2>📥 Cancelaciones — pega por columna o importa archivo</h2>
        </div>
        <div class="card-body" style="padding:0">
            <div style="padding:10px 14px 6px;font-size:11px;color:var(--text-dim)">
                Haz clic en una celda y pega (Ctrl+V) — una columna a la vez o un rango completo desde Excel.
            </div>
            <div class="tabla-wrap" style="overflow-x:auto;overflow-y:auto;max-height:280px">
                <table id="cancelPasteTable" class="paste-table">
                    <thead><tr>
                        <th class="pt-num">#</th>
                        <th>Fecha / Hora</th><th>Producto</th>
                        <th style="text-align:center">Cantidad</th>
                        <th>Autorizó</th><th>Motivo</th><th>Mesero</th>
                    </tr></thead>
                    <tbody id="cancelPasteBody"></tbody>
                </table>
            </div>
            <div style="display:flex;gap:8px;padding:8px 14px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border)">
                <button class="btn-vista" onclick="_agregarFilasTabla('cancelPasteBody',6)">+ 10 filas</button>
                <button class="btn-vista" style="color:var(--red);border-color:var(--red)" onclick="_limpiarTabla('cancelPasteBody',6)">🗑 Limpiar</button>
                <button class="btn-vista" style="color:var(--accent);border-color:var(--accent);padding:7px 16px"
                    onclick="confirmarTablaCancelaciones()">✓ Agregar a cancelaciones</button>
            </div>
            <div style="display:flex;gap:8px;padding:0 14px 12px;flex-wrap:wrap;align-items:center">
                <label class="btn-vista" style="cursor:pointer;color:var(--accent);border-color:var(--accent)">
                    📊 .xlsx / .xls
                    <input type="file" accept=".xlsx,.xls" style="display:none" onchange="importarXLSXCancelaciones(event)">
                </label>
                <label class="btn-vista" style="cursor:pointer">
                    📄 PDF
                    <input type="file" accept=".pdf" style="display:none" onchange="importarPDFCancelaciones(event)">
                </label>
                <span style="font-size:11px;color:var(--text-dim)">Importar archivo rellena la tabla automáticamente</span>
            </div>
        </div>
    </div>
    <div class="cancel-toolbar">
        <div class="cancel-field"><label>Fecha / Hora</label>
            <input type="datetime-local" id="cancelFechaHora" style="width:170px"></div>
        <div class="cancel-field"><label>Producto</label>
            <input type="text" id="cancelProd" style="width:180px" placeholder="Nombre del producto"></div>
        <div class="cancel-field"><label>Cantidad</label>
            <input type="number" id="cancelCantidad" style="width:75px" placeholder="0" min="0" step="1"></div>
        <div class="cancel-field"><label>Autorizó</label>
            <input type="text" id="cancelAutorizo" style="width:110px" placeholder="39-TOMAS"></div>
        <div class="cancel-field"><label>Motivo</label>
            <input type="text" id="cancelMotivo" style="width:190px" placeholder="Motivo de la cancelación"></div>
        <div class="cancel-field"><label>Mesero</label>
            <input type="text" id="cancelMesero" style="width:110px" placeholder="Nombre"></div>
        <div style="display:flex;align-items:flex-end">
            <button class="btn-vista" style="color:var(--accent);border-color:var(--accent);padding:7px 16px"
                onclick="agregarCancelacionManual()">+ Agregar</button>
        </div>
    </div>
    <div class="card" style="max-width:none;margin:0 16px 24px">
        <div class="card-header">
            <h2>🚫 Cancelaciones registradas</h2>
            <div style="display:flex;gap:8px;align-items:center">
                <span class="pill ${cancelaciones.length?'pill-amber':''}">
                    ${cancelaciones.length} cancelación${cancelaciones.length!==1?'es':''}</span>
                ${noMatch > 0 ? `<span class="pill pill-amber">${noMatch} sin detectar</span>` : `<span class="pill pill-green">Todos detectados</span>`}
                <button class="btn-vista" style="font-size:11px;padding:4px 10px"
                    onclick="_reDetectarCancelaciones()">🔍 Re-detectar</button>
            </div>
        </div>
        <div class="card-body" style="padding:0">${tabla}</div>
    </div>`;
}

function _renderDescuentosTab(descuentos, totalDesc) {
    const tabla = descuentos.length ? `<div class="tabla-wrap"><table>
        <thead><tr>
            <th>Fecha / Hora</th><th style="text-align:center">% Desc.</th>
            <th style="text-align:right">Monto $</th><th>Folio</th>
            <th>Motivo</th><th>Autorizó</th><th></th>
        </tr></thead>
        <tbody>${descuentos.map((d,i)=>`<tr>
            <td style="font-size:11px;color:var(--text-dim);white-space:nowrap">${d.fechaHora||'—'}</td>
            <td style="text-align:center;font-weight:600">${d.porcentaje!=null?d.porcentaje+'%':'—'}</td>
            <td style="text-align:right;color:var(--red);font-weight:600">$${(parseFloat(d.monto)||0).toFixed(2)}</td>
            <td style="font-size:11px;color:var(--text-dim)">${d.folio||'—'}</td>
            <td style="color:var(--text-dim)">${d.motivo||'—'}</td>
            <td style="font-size:12px">${d.autorizo||'—'}</td>
            <td><button class="btn-vista" style="padding:3px 8px;font-size:10px;color:var(--red);border-color:var(--red)"
                onclick="eliminarDescuento(${i})">🗑️</button></td>
        </tr>`).join('')}</tbody>
    </table></div>` : `<div class="empty-state" style="padding:40px">
        <div class="empty-icon">💸</div><div class="empty-title">Sin descuentos</div>
        <div class="empty-desc">Agrega manualmente o importa desde tu POS</div></div>`;

    return `
    <div class="card" style="max-width:none;margin:12px 16px 0">
        <div class="card-header">
            <h2>📥 Descuentos — pega por columna o importa archivo</h2>
        </div>
        <div class="card-body" style="padding:0">
            <div style="padding:10px 14px 6px;font-size:11px;color:var(--text-dim)">
                Haz clic en una celda y pega (Ctrl+V) — una columna a la vez o un rango completo desde Excel.
            </div>
            <div class="tabla-wrap" style="overflow-x:auto;overflow-y:auto;max-height:280px">
                <table id="descPasteTable" class="paste-table">
                    <thead><tr>
                        <th class="pt-num">#</th>
                        <th>Fecha / Hora</th><th style="text-align:center">% Desc.</th>
                        <th style="text-align:right">Monto $</th>
                        <th>Folio</th><th>Motivo</th><th>Autorizó</th>
                    </tr></thead>
                    <tbody id="descPasteBody"></tbody>
                </table>
            </div>
            <div style="display:flex;gap:8px;padding:8px 14px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border)">
                <button class="btn-vista" onclick="_agregarFilasTabla('descPasteBody',6)">+ 10 filas</button>
                <button class="btn-vista" style="color:var(--red);border-color:var(--red)" onclick="_limpiarTabla('descPasteBody',6)">🗑 Limpiar</button>
                <button class="btn-vista" style="color:var(--green);border-color:var(--green);padding:7px 16px"
                    onclick="confirmarTablaDescuentos()">✓ Agregar a descuentos</button>
            </div>
            <div style="display:flex;gap:8px;padding:0 14px 12px;flex-wrap:wrap;align-items:center">
                <label class="btn-vista" style="cursor:pointer;color:var(--green);border-color:var(--green)">
                    📊 .xlsx / .xls
                    <input type="file" accept=".xlsx,.xls" style="display:none" onchange="importarXLSXDescuentos(event)">
                </label>
                <label class="btn-vista" style="cursor:pointer">
                    📄 PDF
                    <input type="file" accept=".pdf" style="display:none" onchange="importarPDFDescuentos(event)">
                </label>
                <span style="font-size:11px;color:var(--text-dim)">Importar archivo rellena la tabla automáticamente</span>
            </div>
        </div>
    </div>
    <div class="cancel-toolbar">
        <div class="cancel-field"><label>Fecha / Hora</label>
            <input type="datetime-local" id="descFechaHora" style="width:170px"></div>
        <div class="cancel-field"><label>% Descuento</label>
            <input type="number" id="descPorcentaje" style="width:90px" placeholder="0.00" min="0" max="100" step="0.01"></div>
        <div class="cancel-field"><label>Monto $</label>
            <input type="number" id="descMonto" style="width:100px" placeholder="0.00" min="0" step="0.01"></div>
        <div class="cancel-field"><label>Folio</label>
            <input type="text" id="descFolio" style="width:90px" placeholder="44612"></div>
        <div class="cancel-field"><label>Motivo</label>
            <input type="text" id="descMotivo" style="width:200px" placeholder="Motivo del descuento"></div>
        <div class="cancel-field"><label>Autorizó</label>
            <input type="text" id="descAutorizo" style="width:110px" placeholder="39-TOMAS"></div>
        <div style="display:flex;align-items:flex-end">
            <button class="btn-vista" style="color:var(--green);border-color:var(--green);padding:7px 16px"
                onclick="agregarDescuentoManual()">+ Agregar</button>
        </div>
    </div>
    <div class="card" style="max-width:none;margin:0 16px 24px">
        <div class="card-header">
            <h2>💸 Descuentos registrados</h2>
            <span class="pill pill-green" style="font-size:11px">
                Total: $${totalDesc.toFixed(2)}</span>
        </div>
        <div class="card-body" style="padding:0">${tabla}</div>
    </div>`;
}

// ── Cancelaciones — manual + import ───────────────────────────
function agregarCancelacionManual() {
    const fechaHora      = document.getElementById('cancelFechaHora')?.value || '';
    const nombreProducto = document.getElementById('cancelProd')?.value.trim() || '';
    const cantidad       = parseFloat(document.getElementById('cancelCantidad')?.value) || 0;
    const autorizo       = document.getElementById('cancelAutorizo')?.value.trim() || '';
    const motivo         = document.getElementById('cancelMotivo')?.value.trim() || '';
    const mesero         = document.getElementById('cancelMesero')?.value.trim() || '';
    if (!nombreProducto || cantidad <= 0) { alert('Indica el producto y la cantidad.'); return; }
    if (!invActual.cancelaciones) invActual.cancelaciones = [];
    const entrada = { fechaHora, nombreProducto, cantidad, autorizo, motivo, mesero };
    const m = _matchInsumo(nombreProducto);
    if (m) { entrada.insumoId = m.insumoId; entrada.insumoNombre = m.nombre; }
    invActual.cancelaciones.push(entrada);
    _autoGuardar(); renderStepContent();
}

function eliminarCancelacion(idx) {
    _pedirClaveAdmin('Eliminar cancelación', function() {
        if (invActual?.cancelaciones) { invActual.cancelaciones.splice(idx,1); _autoGuardar(); renderStepContent(); }
    });
}

// POS column normalizer
function _normCol(s) { return (s||'').toString().toLowerCase().replace(/[\s_áéíóúüñ]/g, c =>
    ({' ':'','_':'','á':'a','é':'e','í':'i','ó':'o','ú':'u','ü':'u','ñ':'n'}[c]||c)); }

function _mapPOSCancelaciones(rows) {
    if (!rows.length) return [];
    const firstNorm = rows[0].map(_normCol);
    const POS_KEYS = ['seriefolio','numcheque','idmesero','mesero','comanda','cantidad','descripcion','razon','fecha','nombre','usuario'];
    const isHeader = firstNorm.some(h => POS_KEYS.some(k => h.includes(k)));
    const dataRows = isHeader ? rows.slice(1) : rows;
    let colMap = null;
    if (isHeader) {
        colMap = {};
        firstNorm.forEach((h, i) => { colMap[h] = i; });
    }
    const g = (cols, ...keys) => {
        if (!colMap) return undefined;
        for (const k of keys) {
            const idx = Object.keys(colMap).find(h => h.includes(_normCol(k)));
            if (idx !== undefined && cols[colMap[idx]] != null) return (cols[colMap[idx]]||'').toString().trim();
        }
        return '';
    };
    return dataRows.map(cols => {
        if (!cols || cols.every(c => !c)) return null;
        let rec;
        if (colMap) {
            const fechaHora      = g(cols, 'fecha');
            const nombreProducto = g(cols, 'descripcion', 'producto');
            const cantidad       = parseFloat(g(cols, 'cantidad', 'qty') || '1') || 1;
            const autorizo       = [g(cols, 'nombre'), g(cols, 'usuario')].filter(Boolean).join(' / ') || '';
            const motivo         = g(cols, 'razon', 'motivo');
            const mesero         = g(cols, 'mesero');
            rec = { fechaHora, nombreProducto, cantidad, autorizo, motivo, mesero };
        } else {
            const [fh='',np='',qs='',au='',mo='',me=''] = cols.map(c=>(c||'').toString().trim().replace(/^"|"$/g,''));
            rec = { fechaHora:fh, nombreProducto:np, cantidad:parseFloat(qs)||1, autorizo:au, motivo:mo, mesero:me };
        }
        return rec.nombreProducto ? rec : null;
    }).filter(Boolean);
}

// ── Paste table shared helpers ────────────────────────────────
function _initPaso4Tables() {
    const tbodyId = _paso4Tab === 'cancelaciones' ? 'cancelPasteBody' : 'descPasteBody';
    const tbody = document.getElementById(tbodyId);
    if (tbody && !tbody.rows.length) {
        for (let i = 0; i < 15; i++) _addPasteTableRow(tbody, tbodyId, 6);
    }
}

function _addPasteTableRow(tbody, tbodyId, colCount) {
    const rowNum = tbody.rows.length + 1;
    const tr = document.createElement('tr');
    const numTd = document.createElement('td');
    numTd.className = 'pt-num';
    numTd.textContent = rowNum;
    tr.appendChild(numTd);
    for (let i = 0; i < colCount; i++) {
        const td = document.createElement('td');
        td.contentEditable = 'true';
        td.className = 'pt-cell';
        td.setAttribute('onpaste', `_pasteTableCell(event,this,'${tbodyId}',${colCount})`);
        td.setAttribute('onfocus', "this.classList.add('focused')");
        td.setAttribute('onblur', "this.classList.remove('focused')");
        tr.appendChild(td);
    }
    tbody.appendChild(tr);
}

function _agregarFilasTabla(tbodyId, colCount) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    for (let i = 0; i < 10; i++) _addPasteTableRow(tbody, tbodyId, colCount);
}

function _limpiarTabla(tbodyId, colCount) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    for (let i = 0; i < 15; i++) _addPasteTableRow(tbody, tbodyId, colCount);
}

function _pasteTableCell(event, cell, tbodyId, colCount) {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData('text/plain');
    if (!text.trim()) return;
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const allRows = Array.from(tbody.rows);
    const startRowIdx = allRows.indexOf(cell.closest('tr'));
    const startColIdx = cell.cellIndex - 1; // skip # column
    const lines = text.trim().split('\n');
    const hasTab = lines.some(l => l.includes('\t'));
    lines.forEach((line, ri) => {
        const rowIdx = startRowIdx + ri;
        while (tbody.rows.length <= rowIdx) _addPasteTableRow(tbody, tbodyId, colCount);
        const dataCells = Array.from(tbody.rows[rowIdx].cells).slice(1);
        const values = hasTab ? line.split('\t') : [line];
        values.forEach((val, ci) => {
            const idx = startColIdx + ci;
            if (dataCells[idx]) dataCells[idx].textContent = val.trim().replace(/^"|"$/g, '');
        });
    });
    // Renumber rows
    Array.from(tbody.rows).forEach((row, i) => { if (row.cells[0]) row.cells[0].textContent = i + 1; });
}

// ── Cancelaciones — paste table confirm + file import ─────────
function confirmarTablaCancelaciones() {
    const tbody = document.getElementById('cancelPasteBody');
    if (!tbody) return;
    const toAdd = [];
    Array.from(tbody.rows).forEach(row => {
        const tds = Array.from(row.cells).slice(1).map(td => td.textContent.trim());
        const [fechaHora='', nombreProducto='', cantStr='', autorizo='', motivo='', mesero=''] = tds;
        if (!nombreProducto) return;
        const entrada = { fechaHora, nombreProducto, cantidad: parseFloat(cantStr)||1, autorizo, motivo, mesero };
        const m = _matchInsumo(nombreProducto);
        if (m) { entrada.insumoId = m.insumoId; entrada.insumoNombre = m.nombre; }
        toAdd.push(entrada);
    });
    if (!toAdd.length) { alert('Sin datos válidos. Ingresa productos en la columna Producto.'); return; }
    if (!invActual.cancelaciones) invActual.cancelaciones = [];
    invActual.cancelaciones.push(...toAdd);
    _autoGuardar(); renderStepContent();
}

function _reDetectarCancelaciones() {
    (invActual?.cancelaciones || []).forEach(c => {
        const m = _matchInsumo(c.nombreProducto);
        c.insumoId     = m ? m.insumoId : null;
        c.insumoNombre = m ? m.nombre   : null;
    });
    _autoGuardar(); renderStepContent();
}

function _setCancelInsumo(idx, insumoId) {
    const c = invActual?.cancelaciones?.[idx];
    if (!c) return;
    const fila = filasCaptura.find(f => f.insumoId === insumoId);
    c.insumoId     = insumoId || null;
    c.insumoNombre = fila ? fila.nombre : null;
    _autoGuardar(); renderStepContent();
}

function _populateCancelTable(data) {
    const tbody = document.getElementById('cancelPasteBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.forEach(r => {
        _addPasteTableRow(tbody, 'cancelPasteBody', 6);
        const tds = Array.from(tbody.rows[tbody.rows.length - 1].cells).slice(1);
        tds[0].textContent = r.fechaHora       || '';
        tds[1].textContent = r.nombreProducto  || '';
        tds[2].textContent = r.cantidad != null ? r.cantidad : '';
        tds[3].textContent = r.autorizo        || '';
        tds[4].textContent = r.motivo          || '';
        tds[5].textContent = r.mesero          || '';
    });
    for (let i = 0; i < 5; i++) _addPasteTableRow(tbody, 'cancelPasteBody', 6);
}

function importarXLSXCancelaciones(event) {
    const file = event.target.files[0]; if (!file) return;
    event.target.value = '';
    if (typeof XLSX === 'undefined') { alert('Error: librería XLSX no cargada.'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const wb = XLSX.read(e.target.result, { type:'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
            _populateCancelTable(_mapPOSCancelaciones(rows));
        } catch(err) { alert('No se pudo leer el archivo: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
}

async function importarPDFCancelaciones(event) {
    const file = event.target.files[0]; if (!file) return;
    event.target.value = '';
    if (typeof pdfjsLib === 'undefined') { alert('Error: PDF.js no cargado.'); return; }
    try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        const items = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const tc   = await page.getTextContent();
            tc.items.forEach(it => items.push({ x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), text: it.str }));
        }
        _populateCancelTable(_mapPOSCancelaciones(_pdfItemsToRows(items)));
    } catch(err) { alert('No se pudo leer el PDF: ' + err.message); }
}

function _pdfItemsToRows(items) {
    const filtered = items.filter(i => i.text.trim());
    if (!filtered.length) return [];
    filtered.sort((a, b) => b.y - a.y);
    const groups = [];
    let curY = null, curGroup = [];
    filtered.forEach(item => {
        if (curY === null || Math.abs(item.y - curY) > 4) {
            if (curGroup.length) groups.push(curGroup);
            curGroup = [item]; curY = item.y;
        } else {
            curGroup.push(item); curY = (curY + item.y) / 2;
        }
    });
    if (curGroup.length) groups.push(curGroup);
    return groups.map(g => g.sort((a, b) => a.x - b.x).map(i => i.text.trim()).filter(Boolean));
}

// ── Descuentos — manual + import ──────────────────────────────
function agregarDescuentoManual() {
    const fechaHora  = document.getElementById('descFechaHora')?.value  || '';
    const porcentaje = parseFloat(document.getElementById('descPorcentaje')?.value) || 0;
    const monto      = parseFloat(document.getElementById('descMonto')?.value)      || 0;
    const folio      = document.getElementById('descFolio')?.value.trim()   || '';
    const motivo     = document.getElementById('descMotivo')?.value.trim()  || '';
    const autorizo   = document.getElementById('descAutorizo')?.value.trim()|| '';
    if (monto <= 0) { alert('Indica el monto del descuento.'); return; }
    if (!invActual.descuentos) invActual.descuentos = [];
    invActual.descuentos.push({ fechaHora, porcentaje, monto, folio, motivo, autorizo });
    _autoGuardar(); renderStepContent();
}

function eliminarDescuento(idx) {
    _pedirClaveAdmin('Eliminar descuento', function() {
        if (invActual?.descuentos) { invActual.descuentos.splice(idx,1); _autoGuardar(); renderStepContent(); }
    });
}

function _mapPOSDescuentos(rows) {
    if (!rows.length) return [];
    const firstNorm = rows[0].map(_normCol);
    const POS_KEYS = ['fecha','porcentaje','descuento','monto','importe','folio','cuenta','cheque','motivo','razon','concepto','autorizo','nombre','usuario'];
    const isHeader = firstNorm.some(h => POS_KEYS.some(k => h.includes(k)));
    const dataRows = isHeader ? rows.slice(1) : rows;
    let colMap = null;
    if (isHeader) {
        colMap = {};
        firstNorm.forEach((h, i) => { colMap[h] = i; });
    }
    const g = (cols, ...keys) => {
        if (!colMap) return undefined;
        for (const k of keys) {
            const idx = Object.keys(colMap).find(h => h.includes(_normCol(k)));
            if (idx !== undefined && cols[colMap[idx]] != null) return (cols[colMap[idx]]||'').toString().trim().replace('$','');
        }
        return '';
    };
    return dataRows.map(cols => {
        if (!cols || cols.every(c => !c)) return null;
        let rec;
        if (colMap) {
            const fechaHora  = g(cols, 'fecha');
            const porcentaje = parseFloat(g(cols, 'porcentaje', 'descuento', 'percent', 'disc') || '0') || 0;
            const monto      = parseFloat(g(cols, 'monto', 'importe', 'amount') || '0') || 0;
            const folio      = g(cols, 'folio', 'cuenta', 'cheque', 'ticket');
            const motivo     = g(cols, 'motivo', 'razon', 'concepto');
            const autorizo   = [g(cols, 'nombre'), g(cols, 'usuario'), g(cols, 'autorizo')].filter(Boolean).join(' / ') || '';
            rec = { fechaHora, porcentaje, monto, folio, motivo, autorizo };
        } else {
            const [fh='',ps='',ms='',fo='',mo='',au=''] = cols.map(c=>(c||'').toString().trim().replace(/^"|"$/g,'').replace('$',''));
            rec = { fechaHora:fh, porcentaje:parseFloat(ps)||0, monto:parseFloat(ms)||0, folio:fo, motivo:mo, autorizo:au };
        }
        return (rec.monto > 0 || rec.porcentaje > 0) ? rec : null;
    }).filter(Boolean);
}

// ── Descuentos — paste table confirm + file import ───────────
function confirmarTablaDescuentos() {
    const tbody = document.getElementById('descPasteBody');
    if (!tbody) return;
    const toAdd = [];
    Array.from(tbody.rows).forEach(row => {
        const tds = Array.from(row.cells).slice(1).map(td => td.textContent.trim().replace('$', ''));
        const [fechaHora='', pctStr='', montoStr='', folio='', motivo='', autorizo=''] = tds;
        const monto = parseFloat(montoStr) || 0;
        const porcentaje = parseFloat(pctStr) || 0;
        if (monto <= 0 && porcentaje <= 0) return;
        toAdd.push({ fechaHora, porcentaje, monto, folio, motivo, autorizo });
    });
    if (!toAdd.length) { alert('Sin datos válidos. Ingresa al menos Monto o % Descuento.'); return; }
    if (!invActual.descuentos) invActual.descuentos = [];
    invActual.descuentos.push(...toAdd);
    _autoGuardar(); renderStepContent();
}

function _populateDescTable(data) {
    const tbody = document.getElementById('descPasteBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.forEach(r => {
        _addPasteTableRow(tbody, 'descPasteBody', 6);
        const tds = Array.from(tbody.rows[tbody.rows.length - 1].cells).slice(1);
        tds[0].textContent = r.fechaHora  || '';
        tds[1].textContent = r.porcentaje != null ? r.porcentaje : '';
        tds[2].textContent = r.monto      != null ? r.monto : '';
        tds[3].textContent = r.folio      || '';
        tds[4].textContent = r.motivo     || '';
        tds[5].textContent = r.autorizo   || '';
    });
    for (let i = 0; i < 5; i++) _addPasteTableRow(tbody, 'descPasteBody', 6);
}

function importarXLSXDescuentos(event) {
    const file = event.target.files[0]; if (!file) return;
    event.target.value = '';
    if (typeof XLSX === 'undefined') { alert('Error: librería XLSX no cargada.'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const wb = XLSX.read(e.target.result, { type:'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
            _populateDescTable(_mapPOSDescuentos(rows));
        } catch(err) { alert('No se pudo leer el archivo: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
}

async function importarPDFDescuentos(event) {
    const file = event.target.files[0]; if (!file) return;
    event.target.value = '';
    if (typeof pdfjsLib === 'undefined') { alert('Error: PDF.js no cargado.'); return; }
    try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        const items = [];
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const tc   = await page.getTextContent();
            tc.items.forEach(it => items.push({ x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), text: it.str }));
        }
        _populateDescTable(_mapPOSDescuentos(_pdfItemsToRows(items)));
    } catch(err) { alert('No se pudo leer el PDF: ' + err.message); }
}

function _descargarCSV(content, filename) {
    const blob = new Blob([content], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// PASO 5 — Resumen de Resultado
// ═══════════════════════════════════════════════════════════════
// ── Consumo (uso/venta neta) de un insumo en el periodo, en la unidad de su fila ──
function _consumoPeriodo(f) {
    // Compuesto: Σ del consumo de sus presentaciones (el insumoId virtual '_comp_…'
    // no resuelve recetas → sin esto salía "sin usar" aunque los miembros vendieran).
    if (f.esCompuesto) {
        var c = getCompuestos().find(function(x){ return x.id === f.compId; });
        return ((c && c.miembros) || []).reduce(function(s, mid){
            var m = filasCaptura.find(function(x){ return x.insumoId === mid; });
            return m ? s + _consumoPeriodo(m) : s;
        }, 0);
    }
    if (f.tipo === 'peso') return calcVentasBaseRecetas(f.insumoId);
    // pza: directas + coctelería (antes faltaban las recetas → cerveza usada solo en cocteles salía "sin usar")
    if (f.tipo === 'pza')  return calcVentasPzaRecetas(f.insumoId) + (parseFloat(f.ventasBotella)||0) + (parseFloat(f.ventasCopasDirectas)||0);
    var copasBot = f.contNeto>0 && f.copaML>0 ? f.contNeto/f.copaML : 0;
    return calcVentasCopasRecetas(f.insumoId, f.copaML) + (parseFloat(f.ventasCopasDirectas)||0) + (parseFloat(f.ventasBotella)||0)*copasBot;
}
// ── % de VARIANZA: diferencia vs VENTA NETA del periodo ──
// Definición de Edwin: vendiste 10 copas y la diferencia es +1 copa → +10%.
// Sin ventas en el periodo no hay base de comparación → null (se muestra '—').
function _pctVarianza(dif, ventaNeta) {
    var v = parseFloat(ventaNeta) || 0;
    return v > 0 ? (dif / v) * 100 : null;
}
// ── FASE 1 — Resumen ejecutivo del inventario (faltantes/sobrantes, merma,
//    vendidos por categoría, usados/sin usar, vendido vs compras) ──
function _resumenEjecutivo() {
    var faltU=0, sobrU=0, faltCosto=0, sobrCosto=0, faltCarta=0, sobrCarta=0;
    var mermados=[], mermaCosto=0, usados=0, sinUsar=0, sinUsarLista=[], vendidoCosto=0;
    var _mapaRE = _compDeInsumo();
    _repCache = _repartoPrebatch(); // reparto prebatch→insumos (resumen ejecutivo)
    // Miembros de un compuesto NO se evalúan sueltos (su venta va al compuesto) → evita falsos faltantes.
    filasCaptura.filter(function(f){ return !_mapaRE[f.insumoId]; }).concat(_compuestosActivos().map(_virtualFilaCompuesto)).forEach(function(f){
        var _esPBr = !f.esCompuesto && _esPrebatchRepartido(f.insumoId);
        var _aR = (_esPBr || f.esCompuesto) ? _repZero : _repartoDe(f.insumoId);
        var cc = costoCopa(f), dif = _esPBr ? 0 : (calcDiferencia(f) + _aR.dif); // prebatch: dif repartida en sus insumos
        if (dif < -0.001) { faltU++; faltCosto += Math.abs(dif)*cc; faltCarta += Math.abs(dif)*(f.precioCarta||0); }
        else if (dif > 0.001) { sobrU++; sobrCosto += dif*cc; sobrCarta += dif*(f.precioCarta||0); }
        var merma = (parseFloat(f.mermaCopas)||0) + (parseFloat(f.mermaBase)||0);
        if (merma > 0) { mermados.push({nombre:f.nombre, costo:merma*cc, f:f, m:merma}); mermaCosto += merma*cc; }
        var cons = _consumoPeriodo(f) + _aR.venta; // compuesto-aware + su parte de ventas del prebatch
        if (cons > 0.001) { usados++; vendidoCosto += cons*cc; } else { sinUsar++; if (sinUsarLista.length<60) sinUsarLista.push(f.nombre); }
    });
    // Mermas de PRODUCTO del menú registradas por QR (viven en el inventario)
    ((invActual && invActual.mermasProductoQR) || []).forEach(function(mp){
        mermados.push({ nombre: (mp.nombre || '—') + ' · 🍹 producto' + (mp.motivo ? ' (' + String(mp.motivo).replace(/_/g,' ') + ')' : ''),
            costo: 0, esProd: true, m: parseFloat(mp.cantidad) || 0 });
    });
    // Costo de COMPRA por unidad de entrada (botella/garrafa/pieza/base) según el insumo.
    function _costoCompraInsumo(f){
        var cc = costoCopa(f);
        if (f.tipo === 'copa') { var cb = (f.contNeto>0 && f.copaML>0) ? f.contNeto/f.copaML : 0; return cc*cb; }
        return cc; // pza: por pieza · peso: por unidad base
    }
    // Entradas del período, desglosadas por tipo (compra / bonificación / consignación).
    var comprasU=0, comprasCosto=0, bonifU=0, bonifCosto=0, consigU=0, consigCosto=0;
    var bonifItems={}, consigItems={};
    var _filaIns = {}; filasCaptura.forEach(function(f){ if (f && f.insumoId) _filaIns[f.insumoId] = f; });
    ((invActual && invActual.entradasLog) || []).forEach(function(e){
        var f = _filaIns[e.insumoId]; if (!f) return;
        var cant = parseFloat(e.cantidad)||0; if (cant <= 0) return;
        var costo = cant * _costoCompraInsumo(f);
        var t = (e.tipo||'compra').toLowerCase();
        var nm = (f.nombre)||e.nombre||'';
        if (t === 'bonificacion')      { bonifU  += cant; bonifCosto  += costo; if(nm) bonifItems[nm]=(bonifItems[nm]||0)+cant; }
        else if (t === 'consignacion') { consigU += cant; consigCosto += costo; if(nm) consigItems[nm]=(consigItems[nm]||0)+cant; }
        else                           { comprasU += cant; comprasCosto += costo; }
    });
    var _listaItems = function(obj){ return Object.keys(obj).map(function(n){ return etx(n)+' ('+(obj[n]%1?obj[n].toFixed(1):obj[n])+')'; }).join(' · '); };
    // Entradas manuales (5 slots por fila del Paso 2) = compra.
    filasCaptura.forEach(function(f){
        var man = (f.entradas||[]).reduce(function(s,x){ return s+(parseFloat(x)||0); }, 0);
        if (man > 0) { comprasU += man; comprasCosto += man * _costoCompraInsumo(f); }
    });
    // Capital representativo del stock MÍNIMO / MÁXIMO definidos en el catálogo (a precio proveedor),
    // y el capital del stock ACTUAL. % relativo al máximo (como en el Excel).
    var capStockMin=0, capStockMax=0, capActual=0;
    filasCaptura.forEach(function(f){
        if (!f || !f.insumoId) return;
        var cc = costoCopa(f);
        var copasBot = (f.tipo==='copa' && f.contNeto>0 && f.copaML>0) ? f.contNeto/f.copaML : 0;
        var costoCompra = f.tipo==='copa' ? cc*copasBot : cc; // costo por botella/pieza/unidad de compra
        var _ins = (typeof window._insumoResolver==='function') ? window._insumoResolver(f.insumoId) : null;
        var _p   = _ins && _ins.presentaciones && _ins.presentaciones[0];
        var smin = parseFloat((_p && _p.stockMin) || (_ins && _ins.stockMin) || f.stockMin) || 0;
        var smax = parseFloat((_p && _p.stockMax) || (_ins && _ins.stockMax) || f.stockMax) || 0;
        capStockMin += smin * costoCompra;
        capStockMax += smax * costoCompra;
        capActual   += calcExistencia(f) * cc;
    });
    // Vendidos por categoría (a precio carta)
    var porCat = {}, recetas = getRecetas().filter(function(r){ return r.tipo==='alimentos'||r.tipo==='bebidas'; });
    var vendidos = (invActual && invActual.cocktailsVendidos) || {};
    recetas.forEach(function(r){ var n=parseFloat(vendidos[r.id])||0; if(!n) return; var cat=r.categoria||r.grupo||'Otros'; var c=porCat[cat]=porCat[cat]||{u:0,carta:0}; c.u+=n; c.carta+=n*(parseFloat(r.precioEnCarta)||0); });
    var cats = Object.keys(porCat).sort(function(a,b){ return porCat[b].carta - porCat[a].carta; });
    var totVendCarta = cats.reduce(function(s,c){ return s+porCat[c].carta; }, 0);

    function card(lbl, val, col, sub){ return '<div class="stat-card"><div class="stat-label">'+lbl+'</div><div class="stat-val" style="color:'+col+';font-size:18px">'+val+'</div>'+(sub?'<div style="font-size:10px;color:var(--text-dim);margin-top:2px">'+sub+'</div>':'')+'</div>'; }
    var M = function(n){ return '$'+(Math.round((n||0))).toLocaleString('es-MX'); };

    var _pct = function(n,d){ return d>0 ? Math.round(n/d*100) : 0; };
    var bloqueKpis =
        ((capStockMin>0 || capStockMax>0) ? '<div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">'+
            card('Stock mínimo en capital', M(capStockMin), 'var(--accent)', _pct(capStockMin,capStockMax)+'% del máximo · precio proveedor')+
            card('Stock máximo en capital', M(capStockMax), 'var(--text)', 'meta de stock · precio proveedor')+
            card('Stock actual en capital', M(capActual), (capActual<capStockMin?'var(--red)':'var(--green)'), _pct(capActual,capStockMax)+'% del máximo · precio proveedor')+
        '</div>' : '')+
        (function(){
            // Diferencia NETA (sobrante − faltante). El TITULAR es a CARTA: coincide
            // con la suma de la columna "Dif. $" del desglose. Cada cifra lleva su
            // PROPIO signo (antes la de carta usaba el signo del costo → salía + en
            // vez de − cuando a costo había sobrante pero a carta faltante).
            var netCosto = sobrCosto - faltCosto, netCarta = sobrCarta - faltCarta;
            var esSobrCarta = netCarta >= 0;
            var _subNeto = (faltU+sobrU)+' insumos con diferencia · '+(netCosto>=0?'+':'−')+M(Math.abs(netCosto))+' a costo'+
                '<div style="margin-top:6px">'+(typeof _btnNotaNeto==='function'?_btnNotaNeto():'')+'</div>';
            return '<div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">'+
                card(esSobrCarta ? 'Sobrante (a carta)' : 'Faltante (a carta)',
                    (esSobrCarta?'+':'−')+M(Math.abs(netCarta)),
                    esSobrCarta ? 'var(--green)' : 'var(--red)', _subNeto)+
                card('Merma del periodo', M(mermaCosto), 'var(--accent)', mermados.length+' productos')+
                card('Insumos sin usar', String(sinUsar), sinUsar>0?'var(--accent)':'var(--green)', usados+' usados en el periodo')+
            '</div>';
        })()+
        '<div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">'+
        card('Vendido a precio proveedor', M(vendidoCosto), 'var(--text)', 'costo de lo que salió')+
        card('Compras del periodo', M(comprasCosto), 'var(--text)', comprasU>0 ? (comprasU%1?comprasU.toFixed(1):comprasU)+' unid. compradas' : 'sin compras registradas')+
        card('Vendido vs Compras', (vendidoCosto-comprasCosto>=0?'+':'−')+M(Math.abs(vendidoCosto-comprasCosto)), (vendidoCosto-comprasCosto>=0?'var(--green)':'var(--red)'), vendidoCosto>=comprasCosto?'compraste menos de lo que vendiste':'compraste más de lo que vendiste')+
        '</div>'+
        ((bonifU>0 || consigU>0) ? '<div class="stats-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px">'+
            card('🎁 Bonificación', (bonifU%1?bonifU.toFixed(1):bonifU)+' unid.', 'var(--green)', 'valor '+M(bonifCosto)+' (sin costo)'+(bonifU>0?'<br><span style="color:var(--text)"><b>Productos:</b> '+_listaItems(bonifItems)+'</span>':''))+
            card('📦 Consignación', (consigU%1?consigU.toFixed(1):consigU)+' unid.', '#7c7cff', 'valor '+M(consigCosto)+(consigU>0?'<br><span style="color:var(--text)"><b>Productos:</b> '+_listaItems(consigItems)+'</span>':''))+
        '</div>' : '');

    var tablaCat = cats.length ? ('<div class="card" style="max-width:none;margin:0 16px 12px"><div class="card-body" style="padding:0"><div style="padding:12px 16px;font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent)">🍽️ Vendidos por categoría — '+M(totVendCarta)+' a carta</div><div class="tabla-wrap"><table style="font-size:12px"><thead><tr><th style="text-align:left">Categoría</th><th style="text-align:right">Unidades</th><th style="text-align:right">$ a carta</th><th style="text-align:right">%</th></tr></thead><tbody>'+
        cats.map(function(c){ var p=totVendCarta>0?(porCat[c].carta/totVendCarta*100):0; return '<tr><td style="font-weight:600">'+etx(c)+'</td><td style="text-align:right">'+porCat[c].u+'</td><td style="text-align:right;color:var(--green);font-weight:600">'+M(porCat[c].carta)+'</td><td style="text-align:right;color:var(--text-dim)">'+p.toFixed(0)+'%</td></tr>'; }).join('')+
        '</tbody></table></div></div></div>') : '';

    var tablaMerma = mermados.length ? ('<div class="card" style="max-width:none;margin:0 16px 12px"><div class="card-body" style="padding:0"><div style="padding:12px 16px;font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent)">🗑️ Productos mermados — '+M(mermaCosto)+'</div><div class="tabla-wrap"><table style="font-size:12px"><thead><tr><th style="text-align:left">Producto</th><th style="text-align:right">Merma</th><th style="text-align:right">$ a costo</th></tr></thead><tbody>'+
        mermados.sort(function(a,b){return b.costo-a.costo;}).map(function(x){ return '<tr><td style="font-weight:600">'+etx(x.nombre)+'</td><td style="text-align:right">'+(x.esProd?((x.m%1?x.m.toFixed(1):x.m)+' pza'):_fmtBase(x.m))+'</td><td style="text-align:right;color:var(--accent);font-weight:600">'+(x.esProd?'—':M(x.costo))+'</td></tr>'; }).join('')+
        '</tbody></table></div></div></div>') : '';

    var listaSinUsar = sinUsar ? ('<div class="card" style="max-width:none;margin:0 16px 12px"><div class="card-body" style="padding:12px 16px"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;color:var(--text-muted);margin-bottom:8px">💤 Insumos sin usar en este periodo ('+sinUsar+')</div><div style="display:flex;flex-wrap:wrap;gap:6px">'+
        sinUsarLista.map(function(n){ return '<span style="font-size:11px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:3px 9px;color:var(--text-dim)">'+etx(n)+'</span>'; }).join('')+
        (sinUsar>sinUsarLista.length?'<span style="font-size:11px;color:var(--text-dim)">+'+(sinUsar-sinUsarLista.length)+' más</span>':'')+'</div></div></div>') : '';

    return '<div class="wrap" style="padding-top:0"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1.5px;color:var(--text);margin:6px 0 10px">📊 Resumen ejecutivo</div>'+bloqueKpis+'</div>'+tablaCat+tablaMerma+listaSinUsar;
}

function renderStep5() {
    const mapaC5 = _compDeInsumo();
    const vcomps = _compuestosActivos().map(_virtualFilaCompuesto);
    _repCache = _repartoPrebatch(); // reparto del prebatch a sus insumos (una vez por render)
    let capitalCosto=0, capitalCarta=0, difCostoTotal=0, difNetoCosto=0, conAlerta=0;
    // Capital: existencia real de TODAS las filas (los miembros cuentan su capital una vez).
    filasCaptura.forEach(fila => {
        // Prebatch REPARTIDO: su capital/diferencia viven en sus insumos (parte proporcional).
        if (_esPrebatchRepartido(fila.insumoId)) return;
        const adj   = _repartoDe(fila.insumoId);
        const exist = calcExistencia(fila) + adj.fis;
        const cc    = costoCopa(fila);
        capitalCosto  += exist * cc;
        capitalCarta  += exist * (fila.precioCarta||0);
        // La diferencia de los MIEMBROS se evalúa en su compuesto, no individual.
        if (!mapaC5[fila.insumoId]) {
            const dif = calcDiferencia(fila) + adj.dif;
            difCostoTotal += dif * (fila.precioCarta || 0); // diferencia valorada a precio de carta
            difNetoCosto  += dif * cc;                      // faltante/sobrante a COSTO proveedor
            // Alerta con la MISMA métrica que la columna %: dif vs venta neta del periodo
            const pctA = _pctVarianza(dif, _consumoPeriodo(fila) + adj.venta);
            if (pctA !== null && Math.abs(pctA) > 25) conAlerta++;
        }
    });
    // Diferencia de los compuestos (existencia sumada − ventas en copas).
    vcomps.forEach(vf => {
        const dif = calcDiferencia(vf);
        difCostoTotal += dif * (vf.precioCarta || 0);
        difNetoCosto  += dif * costoCopa(vf);
        const pctA = _pctVarianza(dif, _consumoPeriodo(vf)); // compuesto-aware (Σ presentaciones)
        if (pctA !== null && Math.abs(pctA) > 25) conAlerta++;
    });
    if (invActual) {
        invActual.diferenciaCosto = difCostoTotal; invActual.difNetoCosto = difNetoCosto;
        // invActual es un CLON (abrirInventario hace deep-copy): propagar las cifras
        // al registro del historial y persistirlo — si no, la lista seguía mostrando
        // el valor viejo (a carta). No pasa por guardarInventario a propósito
        // (marcaría _step5Dirty y anularía el caché de render del propio Paso 5).
        try {
            const _reg = getInventarios().find(x => x.id === invActual.id);
            if (_reg && _reg !== invActual && (_reg.difNetoCosto !== difNetoCosto || _reg.diferenciaCosto !== difCostoTotal)) {
                _reg.diferenciaCosto = difCostoTotal;
                _reg.difNetoCosto    = difNetoCosto;
                _sbUpInv(_reg);
            }
        } catch(e) {}
    }
    const colorDif = difCostoTotal>=0 ? 'var(--green)' : 'var(--red)';

    const numCancel       = (invActual?.cancelaciones||[]).length;
    const totalDescuentos = (invActual?.descuentos||[]).reduce((s,d)=>s+(parseFloat(d.monto)||0),0);

    const _M2 = v => (v||0).toLocaleString('es-MX', { minimumFractionDigits:2, maximumFractionDigits:2 }); // $1,832,994.00
    const kpis = `<div class="wrap" style="padding-bottom:0">
        <div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">
            <div class="stat-card"><div class="stat-label">Capital a costo</div><div class="stat-val">$${_M2(capitalCosto)}</div></div>
            <div class="stat-card"><div class="stat-label">Capital a carta</div><div class="stat-val green">$${_M2(capitalCarta)}</div></div>
            <div class="stat-card"><div class="stat-label">Cancelaciones POS</div>
                <div class="stat-val" style="color:${numCancel>0?'var(--accent)':'var(--text)'}">${numCancel}</div></div>
            <div class="stat-card"><div class="stat-label">Total descuentos</div>
                <div class="stat-val" style="color:${totalDescuentos>0?'var(--red)':'var(--text)'}">$${_M2(totalDescuentos)}</div></div>
        </div>
    </div>`;

    const _subcatsS5 = [...new Set(filasCaptura.map(f => f.subcategoria || f.categoria).filter(Boolean))].sort();
    const searchBar5 = `<div class="wrap" style="padding:0 0 4px"><div class="step-toolbar">
        <div class="inv-search" style="flex:1;max-width:340px"><input type="text" placeholder="Buscar producto en el resultado…" value="${etx(_busqStep5)}" oninput="onBusqStep5(this.value)" style="width:100%;box-sizing:border-box"></div>
        <select class="filtro-select" onchange="setSubcatStep5(this.value)" style="font-size:11px;padding:6px 8px;max-width:180px">
            <option value="">Todas las categorías</option>
            ${_subcatsS5.map(s => `<option value="${etx(s)}" ${_subcatStep5===s?'selected':''}>${etx(s)}</option>`).join('')}
        </select>
        <div class="vista-toggle" style="margin-left:auto">
            <button id="s5ModoLista" class="${_step5Modo==='lista'?'active':''}" onclick="setStep5Modo('lista')">≡ Lista</button>
            <button id="s5ModoGal" class="${_step5Modo==='galeria'?'active':''}" onclick="setStep5Modo('galeria')">⊞ Galería</button>
        </div>
    </div></div>`;
    return kpis + _resumenEjecutivo() + searchBar5 + `<div id="step5Tablas">${_step5TablasHTML()}</div>`;
}

var _busqStep5 = '';
var _step5Modo = 'lista';
var _subcatStep5 = '';
// Grupos del resultado abiertos (colapsados por defecto). Keyed por nombre de grupo
// para sobrevivir a re-renders de búsqueda/filtro.
var _s5Abiertos = {};
function _s5Toggle(gid, el) {
    var body = document.getElementById('s5body-' + gid), car = document.getElementById('s5car-' + gid);
    if (!body) return;
    var abrir = body.style.display === 'none';
    body.style.display = abrir ? '' : 'none';
    if (car) car.textContent = abrir ? '▾' : '▸';
    var grp = el && el.getAttribute('data-grp');
    if (grp) { if (abrir) _s5Abiertos[grp] = 1; else delete _s5Abiertos[grp]; }
}
function setSubcatStep5(v) {
    _subcatStep5 = v;
    const cont = document.getElementById('step5Tablas');
    if (cont) cont.innerHTML = _step5TablasHTML();
}
var _busqStep5Timer = null;
function onBusqStep5(val) {
    _busqStep5 = val; // el input se actualiza al instante; el re-render pesado se hace con debounce
    clearTimeout(_busqStep5Timer);
    _busqStep5Timer = setTimeout(function(){
        const cont = document.getElementById('step5Tablas');
        if (cont) cont.innerHTML = _step5TablasHTML();
    }, 220);
}
function setStep5Modo(m) {
    _step5Modo = m;
    const cont = document.getElementById('step5Tablas');
    if (cont) cont.innerHTML = _step5TablasHTML();
    const l = document.getElementById('s5ModoLista'), g = document.getElementById('s5ModoGal');
    if (l && g) { l.classList.toggle('active', m==='lista'); g.classList.toggle('active', m==='galeria'); }
}
function _step5TablasHTML() {
    const q      = (_busqStep5 || '').toLowerCase();
    const mapaC5 = _compDeInsumo();
    _repCache    = _repartoPrebatch(); // reparto prebatch→insumos (fresco por render)
    const vcomps = _compuestosActivos().map(_virtualFilaCompuesto)
        .filter(vf => !q || (vf.nombre||'').toLowerCase().includes(q));
    if (_step5Modo === 'galeria') return _step5GaleriaHTML(q, mapaC5, vcomps);

    const _nc  = v => (v % 1 ? (Math.round(v*10)/10).toFixed(1) : v);
    const GPROD = '🏭 Producción propia';

    // ── Agrupar TODO por categoría. Bebidas con copa → tabla "copa"; secos/pza →
    //    tabla "pza"; compuestos → la categoría de su primer miembro. Los prebatch
    //    repartidos NO entran aquí: van al grupo "Producción propia" (opción A).
    const grupos = {};
    const _ens = g => (grupos[g] || (grupos[g] = { copa:[], pza:[], comp:[] }));
    filasCaptura.forEach(f => {
        if (mapaC5[f.insumoId]) return;                 // miembro de compuesto → sale en su compuesto
        if (_esPrebatchRepartido(f.insumoId)) return;   // prebatch → Producción propia
        if (q && !(f.nombre||'').toLowerCase().includes(q)) return;
        if (_subcatStep5 && (f.subcategoria||f.categoria) !== _subcatStep5) return;
        const b = _ens(_grupoCategoria(f));
        (f.tipo === 'pza' ? b.pza : b.copa).push(f);
    });
    vcomps.forEach(vf => {
        const comp = getCompuestos().find(c => c.id === vf.compId) || {};
        const m0   = (comp.miembros||[]).map(id => filasCaptura.find(f=>f.insumoId===id)).find(Boolean);
        if (_subcatStep5 && m0 && (m0.subcategoria||m0.categoria) !== _subcatStep5) return;
        _ens(m0 ? _grupoCategoria(m0) : '🧩 Compuestos').comp.push(vf);
    });

    // ── Constructor de fila COPA (bebida con botella y copa) ──
    function _rowCopa(fila) {
        const adj       = _repartoDe(fila.insumoId);
        const ea        = (parseFloat(fila.existenciaAnterior) || 0) + adj.ea;
        const copasBot  = fila.contNeto>0 && fila.copaML>0 ? fila.contNeto/fila.copaML : 0;
        const entBot    = getEntradasBottles(fila.insumoId) + (copasBot > 0 ? adj.ent / copasBot : 0);
        const ventaBot  = parseFloat(fila.ventasBotella) || 0;
        const ventaCoct    = calcVentasCopasRecetas(fila.insumoId, fila.copaML) + adj.vco;
        const ventaCopaDir = parseFloat(fila.ventasCopasDirectas) || 0;
        const ventaCopa    = ventaCoct + ventaCopaDir;
        const cortesia  = parseFloat(fila.cortesiaCopas) || 0;
        const merma     = parseFloat(fila.mermaCopas)    || 0;
        const cmTotal   = cortesia + merma + adj.cm;
        const cmConc    = [fila.cortesiaConcepto, fila.mermaConcepto].filter(Boolean).join(' / ');
        const cancelCop = getCancelacionesCopas(fila.insumoId) + adj.can;
        const teorico   = calcExistenciaTeorica(fila) + adj.teo;
        const fisico    = calcExistencia(fila) + adj.fis;
        const dif       = fisico - teorico;
        const difCosto  = dif * (fila.precioCarta || 0);
        const color     = Math.abs(dif) < 0.05 ? 'var(--text-dim)' : (dif > 0 ? 'var(--green)' : 'var(--red)');
        const pctVal    = _pctVarianza(dif, ventaCopa + ventaBot * copasBot);
        const pctStr    = pctVal !== null ? (pctVal>=0?'+':'')+pctVal.toFixed(1)+'%' : '—';
        const eaBot     = copasBot > 0 ? (ea/copasBot).toFixed(1) : ea.toFixed(1);
        const entBotStr = entBot > 0 ? `+${entBot % 1 ? entBot.toFixed(1) : entBot} ${_unidadCompra(fila)}` : '—';
        const fisicoBot = copasBot > 0 ? (fisico/copasBot).toFixed(2) : fisico.toFixed(1);
        const difStr    = `${dif>=0?'+':''}${dif.toFixed(1)} cop`;
        const _contC = _fmtContenido(fila);
        const html = `<tr>
                <td style="min-width:140px">
                    <div style="font-size:14px;font-weight:600">${etx(insumoTitulo(fila))}</div>
                    <div style="font-size:11.5px;color:var(--text-dim)">${fila.categoria||''}</div>
                    ${_contC?`<div style="font-size:9.5px;color:#7ab8f5">📦 ${_contC}</div>`:''}
                    <button onclick="event.stopPropagation();toggleBateo('${fila.insumoId}')" style="margin-top:3px;font-size:9px;padding:1px 6px;border-radius:4px;cursor:pointer;border:1px solid ${esBateo(fila.insumoId)?'#3dbe7a':'#888'};background:${esBateo(fila.insumoId)?'#3dbe7a':'transparent'};color:${esBateo(fila.insumoId)?'#fff':'#999'}">🏏 ${esBateo(fila.insumoId)?'De bateo ✓':'Marcar bateo'}</button>${_btnNotaInsumo(fila.insumoId)}
                </td>
                <td style="text-align:center;white-space:nowrap">${eaBot} bot</td>
                <td style="text-align:center;color:var(--green);white-space:nowrap">${entBotStr}</td>
                <td style="text-align:center;color:var(--accent)">${ventaBot > 0 ? ventaBot + ' bot' : '—'}</td>
                <td style="text-align:center;color:var(--accent)">${ventaCopaDir > 0 ? ventaCopaDir.toFixed(1) + ' cop' : '—'}</td>
                <td style="text-align:center;color:var(--viol)">${ventaCoct > 0 ? ventaCoct.toFixed(1) + ' cop' : '—'}</td>
                <td style="text-align:center">
                    ${cmTotal > 0
                        ? `<div style="color:var(--red);font-size:12px;font-weight:600">${cmTotal.toFixed(1)} cop</div>
                           ${cmConc ? `<div style="font-size:10px;color:var(--text-dim);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${cmConc}">${cmConc}</div>` : ''}`
                        : '—'}
                </td>
                <td style="text-align:center;color:var(--text-muted)">${cancelCop > 0 ? cancelCop.toFixed(1) + ' cop' : '—'}</td>
                <td style="text-align:center;font-weight:600;white-space:nowrap">${fisicoBot} bot</td>
                <td style="text-align:center;font-weight:700;color:${color};white-space:nowrap">${difStr}</td>
                <td style="text-align:center;font-size:11px;color:${color}">${pctStr}</td>
                <td style="text-align:right;font-weight:600;color:${color};white-space:nowrap">${difCosto>=0?'+':''}$${difCosto.toFixed(2)}</td>
            </tr>`;
        return { html, dif, difCosto, vend: ventaCopa + ventaBot * copasBot };
    }

    // ── Constructor de fila PZA (secos: refrescos en lata, cervezas, etc.) ──
    function _rowPza(fila) {
        const ea        = parseFloat(fila.existenciaAnterior) || 0;
        const entTotal  = getEntradasCopas(fila);
        const adjP      = _repartoDe(fila.insumoId);
        const ventaCoct = calcVentasPzaRecetas(fila.insumoId) + adjP.vco;
        const ventasDir = (fila.ventasBotella || 0) + (parseFloat(fila.ventasCopasDirectas)||0);
        const ventas    = ventasDir + ventaCoct;
        const cancelPza = getCancelacionesCopas(fila.insumoId) + adjP.can;
        const cortMerma = (parseFloat(fila.cortesiaCopas) || 0) + (parseFloat(fila.mermaCopas) || 0) + adjP.cm;
        const teorico   = calcExistenciaTeorica(fila) + adjP.teo;
        const fisico    = calcExistencia(fila) + adjP.fis;
        const dif       = fisico - teorico;
        const difCosto  = dif * (fila.precioCarta || 0);
        const color     = Math.abs(dif) < 0.05 ? 'var(--text-dim)' : (dif > 0 ? 'var(--green)' : 'var(--red)');
        const pctVal    = _pctVarianza(dif, ventas);
        const pctStr    = pctVal !== null ? (pctVal>=0?'+':'')+pctVal.toFixed(1)+'%' : '—';
        const _contP = _fmtContenido(fila);
        const html = `<tr>
                <td>
                    <div style="font-size:14px;font-weight:600">${etx(insumoTitulo(fila))}</div>
                    <div style="font-size:11.5px;color:var(--text-dim)">${fila.categoria||''}</div>
                    ${_contP?`<div style="font-size:9.5px;color:#7ab8f5">📦 ${_contP}</div>`:''}
                    <button onclick="event.stopPropagation();toggleBateo('${fila.insumoId}')" style="margin-top:3px;font-size:9px;padding:1px 6px;border-radius:4px;cursor:pointer;border:1px solid ${esBateo(fila.insumoId)?'#3dbe7a':'#888'};background:${esBateo(fila.insumoId)?'#3dbe7a':'transparent'};color:${esBateo(fila.insumoId)?'#fff':'#999'}">🏏 ${esBateo(fila.insumoId)?'De bateo ✓':'Marcar bateo'}</button>${_btnNotaInsumo(fila.insumoId)}
                </td>
                <td style="text-align:center">${ea.toFixed(0)} pza</td>
                <td style="text-align:center;color:var(--green)">${entTotal>0?'+'+entTotal.toFixed(0)+' pza':'—'}</td>
                <td style="text-align:center;color:var(--viol)">${ventaCoct>0?(ventaCoct%1?ventaCoct.toFixed(1):ventaCoct)+' pza':'—'}</td>
                <td style="text-align:center;color:var(--accent)">${ventasDir>0?(ventasDir%1?ventasDir.toFixed(1):ventasDir)+' pza':'—'}</td>
                <td style="text-align:center;color:var(--text-muted)">${cancelPza>0?cancelPza.toFixed(0)+' pza':'—'}</td>
                <td style="text-align:center;color:var(--accent)">${cortMerma>0?(cortMerma%1?cortMerma.toFixed(1):cortMerma)+' pza':'—'}</td>
                <td style="text-align:center">${teorico.toFixed(0)} pza</td>
                <td style="text-align:center;font-weight:600">${fisico.toFixed(0)} pza</td>
                <td style="text-align:center;font-weight:700;color:${color}">${dif>=0?'+':''}${dif.toFixed(0)} pza</td>
                <td style="text-align:center;font-size:11px;color:${color}">${pctStr}</td>
                <td style="text-align:right;font-weight:600;color:${color}">${difCosto>=0?'+':''}$${difCosto.toFixed(2)}</td>
            </tr>`;
        return { html, dif, difCosto, vend: ventas };
    }

    // ── Constructor de fila COMPUESTO (misma columna que copa; con desglose) ──
    function _rowComp(vf) {
        const comp = getCompuestos().find(c => c.id === vf.compId) || {};
        const members = (comp.miembros||[]).map(mid => filasCaptura.find(f=>f.insumoId===mid)).filter(Boolean);
        let ea=0, ent=0, cancel=0, ventaBot=0, ventaCopa=0, ventaCoct=0, cm=0, eaBot=0, fisBot=0;
        members.forEach(m => {
            ea       += parseFloat(m.existenciaAnterior)||0;
            ent      += getEntradasCopas(m);
            cancel   += getCancelacionesCopas(m.insumoId);
            const copasBot = m.contNeto>0 && m.copaML>0 ? m.contNeto/m.copaML : 0;
            ventaBot += (parseFloat(m.ventasBotella)||0) * copasBot;
            ventaCopa+= parseFloat(m.ventasCopasDirectas)||0;
            ventaCoct+= calcVentasCopasRecetas(m.insumoId, m.copaML);
            cm       += (parseFloat(m.cortesiaCopas)||0) + (parseFloat(m.mermaCopas)||0);
            // Existencia en BOTELLAS: cada presentación aporta sus propias botellas
            // (su copaML/contNeto). El compuesto suma botellas; la diferencia queda en copas.
            eaBot    += copasBot>0 ? (parseFloat(m.existenciaAnterior)||0)/copasBot : (parseFloat(m.existenciaAnterior)||0);
            fisBot   += copasBot>0 ? calcExistencia(m)/copasBot : calcExistencia(m);
        });
        const fisico    = calcExistencia(vf);
        const teorico   = calcExistenciaTeorica(vf);
        const dif       = fisico - teorico;
        const difCosto  = dif * (vf.precioCarta || 0);
        const pctValC   = _pctVarianza(dif, ventaBot + ventaCopa + ventaCoct);
        const color     = Math.abs(dif) < 0.05 ? 'var(--text-dim)' : (dif > 0 ? 'var(--green)' : 'var(--red)');
        const pctStr    = pctValC !== null ? ((pctValC>=0?'+':'')+pctValC.toFixed(1)+'%') : '—';
        const desgloseRows = members.map(m => {
            const mea = parseFloat(m.existenciaAnterior)||0;
            const ment = getEntradasCopas(m);
            const mcancel = getCancelacionesCopas(m.insumoId);
            const mCopasBot = m.contNeto>0 && m.copaML>0 ? m.contNeto/m.copaML : 0;
            const mVentaBot = (parseFloat(m.ventasBotella)||0) * mCopasBot;
            const mVentaCopa = parseFloat(m.ventasCopasDirectas)||0;
            const mVentaCoct = calcVentasCopasRecetas(m.insumoId, m.copaML);
            const mcm = (parseFloat(m.cortesiaCopas)||0) + (parseFloat(m.mermaCopas)||0);
            const mfis = calcExistencia(m), mteo = calcExistenciaTeorica(m), mdif = mfis - mteo;
            const mDifCosto = mdif * (m.precioCarta || 0);
            const mpct = _pctVarianza(mdif, mVentaBot + mVentaCopa + mVentaCoct);
            const mcol = Math.abs(mdif)<0.05?'var(--text-dim)':(mdif>0?'var(--green)':'var(--red)');
            const meaBot = mCopasBot>0 ? mea/mCopasBot : mea;   // existencia en botellas (su propia presentación)
            const mfisBot = mCopasBot>0 ? mfis/mCopasBot : mfis;
            const mCont   = _fmtContenido(m); // 📦 contenido por botella (ml/pza) de la presentación
            return `<tr>
                <td style="padding:4px 8px;color:var(--text);min-width:150px">${etx(insumoTitulo(m))}${insumoMeta(m)?`<div style="font-size:10px;color:var(--text-dim);margin-top:1px">${insumoMetaHTML(m)}</div>`:''}${mCont?`<div style="font-size:9.5px;color:#7ab8f5;margin-top:1px">📦 ${mCont}</div>`:''}</td>
                <td style="text-align:center;white-space:nowrap">${_nc(meaBot)} bot</td>
                <td style="text-align:center;color:var(--green)">${ment>0?'+'+_nc(ment)+' cop':'—'}</td>
                <td style="text-align:center;color:var(--text-dim)">${mVentaBot>0?_nc(mVentaBot)+' cop':'—'}</td>
                <td style="text-align:center;color:var(--accent)">${mVentaCopa>0?_nc(mVentaCopa)+' cop':'—'}</td>
                <td style="text-align:center;color:var(--viol)">${mVentaCoct>0?_nc(mVentaCoct)+' cop':'—'}</td>
                <td style="text-align:center;color:var(--red)">${mcm>0?_nc(mcm)+' cop':'—'}</td>
                <td style="text-align:center;color:var(--text-muted)">${mcancel>0?_nc(mcancel)+' cop':'—'}</td>
                <td style="text-align:center;font-weight:600;white-space:nowrap">${_nc(mfisBot)} bot</td>
                <td style="text-align:center;font-weight:700;color:${mcol};white-space:nowrap">${mdif>=0?'+':''}${_nc(mdif)} cop</td>
                <td style="text-align:center;font-size:11px;color:${mcol}">${mpct!==null?((mpct>=0?'+':'')+mpct.toFixed(1)+'%'):'—'}</td>
                <td style="text-align:right;font-weight:600;color:${mcol};white-space:nowrap">${mDifCosto>=0?'+':''}$${mDifCosto.toFixed(2)}</td>
            </tr>`;
        }).join('');
        const desglose = `<tr id="compDesg-${comp.id}" style="display:none"><td colspan="12" style="padding:0;background:var(--bg)">
            <div style="padding:8px 20px 12px"><div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-dim);margin-bottom:5px">📐 Desglose por presentación</div>
            <table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr style="color:var(--text-dim);font-size:10px;text-transform:uppercase;letter-spacing:.5px">
                <th style="text-align:left;padding:2px 8px">Presentación</th><th style="text-align:center">Anterior</th><th style="text-align:center">Entradas</th><th style="text-align:center">Botella</th><th style="text-align:center">Copa</th><th style="text-align:center">Coctelería</th><th style="text-align:center">Cortesía/<br>Merma</th><th style="text-align:center">Cancelac.</th><th style="text-align:center">Actual</th><th style="text-align:center">Diferencia</th><th style="text-align:center">%</th><th style="text-align:right">Dif. $</th>
            </tr></thead><tbody>${desgloseRows}</tbody></table></div></td></tr>`;
        const html = `<tr>
            <td style="min-width:150px">
                <div style="font-size:14px;font-weight:600">🧩 ${etx(comp.nombre||vf.nombre)}</div>
                <div style="font-size:10px;color:var(--text-dim)">${members.length} presentaciones</div>
                <span style="display:inline-block;margin-top:3px;font-size:9px;padding:1px 6px;border-radius:4px;border:1px solid var(--viol);color:var(--viol)">🧩 compuesto</span>
                <button onclick="var d=document.getElementById('compDesg-${comp.id}');d.style.display=d.style.display==='none'?'':'none';this.textContent=d.style.display==='none'?'▸ Ver desglose':'▾ Ocultar desglose'" style="margin-top:3px;margin-left:4px;font-size:9px;padding:1px 7px;border-radius:4px;cursor:pointer;border:1px solid var(--viol);background:transparent;color:var(--viol)">▸ Ver desglose</button>
                ${_btnNotaInsumo(vf.compId||vf.insumoId)}
            </td>
            <td style="text-align:center;white-space:nowrap">${_nc(eaBot)} bot</td>
            <td style="text-align:center;color:var(--green);white-space:nowrap">${ent>0?'+'+_nc(ent)+' cop':'—'}</td>
            <td style="text-align:center;color:var(--text-dim)">${ventaBot>0?_nc(ventaBot)+' cop':'—'}</td>
            <td style="text-align:center;color:var(--accent)">${ventaCopa>0?_nc(ventaCopa)+' cop':'—'}</td>
            <td style="text-align:center;color:var(--viol)">${ventaCoct>0?_nc(ventaCoct)+' cop':'—'}</td>
            <td style="text-align:center">${cm>0?`<div style="color:var(--red);font-size:12px;font-weight:600">${_nc(cm)} cop</div>`:'—'}</td>
            <td style="text-align:center;color:var(--text-muted)">${cancel>0?_nc(cancel)+' cop':'—'}</td>
            <td style="text-align:center;font-weight:600;white-space:nowrap">${_nc(fisBot)} bot</td>
            <td style="text-align:center;font-weight:700;color:${color};white-space:nowrap">${dif>=0?'+':''}${_nc(dif)} cop</td>
            <td style="text-align:center;font-size:11px;color:${color}">${pctStr}</td>
            <td style="text-align:right;font-weight:600;color:${color};white-space:nowrap">${difCosto>=0?'+':''}$${difCosto.toFixed(2)}</td>
        </tr>${desglose}`;
        return { html, dif, difCosto, vend: ventaBot + ventaCopa + ventaCoct };
    }

    const COPA_THEAD = `<thead>
                    <tr>
                        <th rowspan="2" style="text-align:left;vertical-align:bottom">Producto</th>
                        <th rowspan="2" style="text-align:center;width:70px;vertical-align:bottom">Exist.<br>anterior</th>
                        <th rowspan="2" style="text-align:center;width:65px;vertical-align:bottom">Entradas</th>
                        <th colspan="3" style="text-align:center;border-bottom:1px solid var(--border);padding-bottom:4px">Ventas</th>
                        <th rowspan="2" style="text-align:center;width:95px;vertical-align:bottom">Cortesía /<br>Merma</th>
                        <th rowspan="2" style="text-align:center;width:70px;vertical-align:bottom">Cancelac.<br>POS</th>
                        <th rowspan="2" style="text-align:center;width:80px;vertical-align:bottom">Exist.<br>actual</th>
                        <th rowspan="2" style="text-align:center;width:80px;vertical-align:bottom">Diferencia</th>
                        <th rowspan="2" style="text-align:center;width:50px;vertical-align:bottom">%</th>
                        <th rowspan="2" style="text-align:right;width:80px;vertical-align:bottom">Dif. $<br><span style="font-size:8px;font-weight:400">a carta</span></th>
                    </tr>
                    <tr>
                        <th style="text-align:center;width:65px;font-size:10px;color:var(--text-muted)">Botella</th>
                        <th style="text-align:center;width:65px;font-size:10px;color:var(--text-muted)">Copa</th>
                        <th style="text-align:center;width:70px;font-size:10px;color:var(--viol)">Coctelería</th>
                    </tr>
                </thead>`;
    const PZA_THEAD = `<thead><tr>
                    <th>Producto</th>
                    <th style="text-align:center;width:70px">Exist. ant.</th>
                    <th style="text-align:center;width:65px">Entradas</th>
                    <th style="text-align:center;width:70px">Coctelería</th>
                    <th style="text-align:center;width:65px">Ventas</th>
                    <th style="text-align:center;width:70px">Cancelac.</th>
                    <th style="text-align:center;width:90px">Cortesía /<br>Merma</th>
                    <th style="text-align:center;width:70px">Teórico</th>
                    <th style="text-align:center;width:70px">Físico</th>
                    <th style="text-align:center;width:75px">Diferencia</th>
                    <th style="text-align:center;width:50px">%</th>
                    <th style="text-align:right;width:80px">Dif. $</th>
                </tr></thead>`;

    // ── Una tarjeta COLAPSABLE por grupo (colapsadas por defecto) con indicadores ──
    const _ordCat = (a,b) => String(a[0]).localeCompare(String(b[0]), 'es');
    let idx = 0;
    const cards = Object.entries(grupos).sort(_ordCat).map(([grp, b]) => {
        idx++;
        const gid = 's5g' + idx;
        let dif = 0, difCosto = 0, vend = 0, copaBody = '', pzaBody = '';
        b.copa.forEach(f  => { const r=_rowCopa(f);  copaBody+=r.html; dif+=r.dif; difCosto+=r.difCosto; vend+=r.vend; });
        b.comp.forEach(vf => { const r=_rowComp(vf); copaBody+=r.html; dif+=r.dif; difCosto+=r.difCosto; vend+=r.vend; });
        b.pza.forEach(f   => { const r=_rowPza(f);   pzaBody+=r.html; dif+=r.dif; difCosto+=r.difCosto; vend+=r.vend; });
        const unidad    = (!copaBody && pzaBody) ? 'pza' : 'cop';
        const copaTable = copaBody ? `<div class="tabla-wrap" style="overflow-x:auto"><table style="min-width:900px;font-size:13.5px">${COPA_THEAD}<tbody>${copaBody}</tbody></table></div>` : '';
        const pzaTable  = pzaBody  ? `<div class="tabla-wrap" style="overflow-x:auto"><table style="font-size:13.5px">${PZA_THEAD}<tbody>${pzaBody}</tbody></table></div>` : '';
        const abierto   = !!_s5Abiertos[grp];
        const faltTxt   = dif < -0.05 ? `faltan ${_nc(Math.abs(dif))} ${unidad}` : (dif > 0.05 ? `sobran ${_nc(dif)} ${unidad}` : 'cuadra');
        const faltCol   = dif < -0.05 ? 'var(--red)' : (dif > 0.05 ? 'var(--green)' : 'var(--text-dim)');
        return `<div class="card" style="max-width:none;margin:0 16px 12px">
            <div class="card-header" data-grp="${etx(grp)}" style="cursor:pointer;user-select:none" onclick="_s5Toggle('${gid}', this)">
                <h2 style="display:flex;align-items:center;gap:8px"><span id="s5car-${gid}" style="font-size:12px;color:var(--text-muted)">${abierto?'▾':'▸'}</span> ${grp}</h2>
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--text-dim)">
                    <span>🥃 <b style="color:var(--text)">${_nc(vend)}</b> ${unidad} vendidas</span>
                    <span style="color:${faltCol}">${faltTxt}</span>
                    <span class="pill ${difCosto>=0?'pill-green':'pill-red'}" style="font-size:11px">${difCosto>=0?'+':''}$${difCosto.toFixed(2)}</span>
                </div>
            </div>
            <div id="s5body-${gid}" class="card-body" style="padding:0;display:${abierto?'':'none'}">${copaTable}${pzaTable}</div>
        </div>`;
    }).join('');

    // ── Producción propia: prebatch repartido a sus insumos (opción A) ──
    const _repL = (_repCache && _repCache.lista) || [];
    let prodCard = '';
    const _prodMatch = !q || GPROD.toLowerCase().includes(q) || _repL.some(r => (r.nombre||'').toLowerCase().includes(q));
    if (_repL.length && !_subcatStep5 && _prodMatch) {
        idx++;
        const gid = 's5g' + idx;
        const abierto = !!_s5Abiertos[GPROD];
        const body = _repL.map(function(r){
            var difML = r.fisML - r.teoML;
            var difTag = Math.abs(difML) < 1 ? '' : ` · dif ${difML>=0?'+':''}${Math.round(difML)} ml repartida`;
            return `<div style="padding:7px 0;border-bottom:1px solid var(--border)">
                <b>${etx(r.nombre)}</b> — ${Math.round(r.fisML)} ml pesados${difTag}
                <div style="color:var(--text-dim);margin-top:2px">Contiene: ${r.desglose.map(function(d){ return etx(d.nombre) + ' ' + Math.round(d.ml) + ' ml'; }).join(' · ')}</div>
            </div>`;
        }).join('');
        prodCard = `<div class="card" style="max-width:none;margin:0 16px 12px">
            <div class="card-header" data-grp="${etx(GPROD)}" style="cursor:pointer;user-select:none" onclick="_s5Toggle('${gid}', this)">
                <h2 style="display:flex;align-items:center;gap:8px"><span id="s5car-${gid}" style="font-size:12px;color:var(--text-muted)">${abierto?'▾':'▸'}</span> ${GPROD}</h2>
                <div style="font-size:11.5px;color:var(--text-dim)">${_repL.length} sub-recetas · su existencia y diferencia se reparten a sus insumos</div>
            </div>
            <div id="s5body-${gid}" class="card-body" style="padding:10px 16px 14px;font-size:12.5px;display:${abierto?'':'none'}">
                <div style="font-size:10px;color:var(--text-dim);margin-bottom:6px">🧪 Cada botella/garrafa pesada se reparte, proporcional a su sub-receta, a los insumos que la componen. La diferencia vive en esos insumos (en sus grupos de categoría).</div>
                ${body}
            </div>
        </div>`;
    }

    const sinDatos = !cards && !prodCard
        ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Sin productos capturados</div>'
        : '';
    return `<div style="padding:16px 0 24px">${sinDatos}${cards}${prodCard}</div>`;
}
// Entradas de un insumo, con fecha (de la cola de entradas del inventario).
function _entradasDeInsumo(insumoId) {
    return ((invActual && invActual.entradasLog) || []).filter(function(e){ return e.insumoId === insumoId; })
        .map(function(e){ return { cantidad: parseFloat(e.cantidad)||0, fecha: e.fecha||'', tipo: e.tipo||'' }; });
}
// Vista GALERÍA del resultado: una tarjeta de desglose por insumo.
function _step5GaleriaHTML(q, mapaC5, vcomps) {
    var items = vcomps.concat(filasCaptura.filter(function(f){
        if (mapaC5[f.insumoId]) return false;
        if (q && !(f.nombre||'').toLowerCase().includes(q)) return false;
        if (_subcatStep5 && (f.subcategoria||f.categoria) !== _subcatStep5) return false;
        return calcExistencia(f) > 0 || (parseFloat(f.existenciaAnterior)||0) > 0
            || getEntradasBottles(f.insumoId) > 0 || _esRegistrado(f)
            || (f.ventasCopasDirectas||0) > 0 || (f.ventasBotella||0) > 0;
    }));
    if (!items.length) return '<div style="text-align:center;padding:40px;color:var(--text-dim)">Sin productos con movimiento</div>';
    // Inventario de referencia precomputado UNA vez (evita _filaAnteriorInsumo O(n²) por tarjeta).
    var _refInv = _getRefInv(), _refMap = {};
    if (_refInv) (_refInv.filas||[]).forEach(function(f){ if (f && f.insumoId) _refMap[f.insumoId] = f; });
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:12px;padding:8px 16px 24px">'+
        items.map(function(fila){ try { return _step5DesgloseCard(fila, _refMap); } catch(e){ console.warn('[desglose]', fila && fila.nombre, e); return ''; } }).join('') + '</div>';
}
function _step5DesgloseCard(fila, refMap) {
    var esComp   = !!fila.esCompuesto;
    var esPB     = !esComp && _esPrebatchRepartido(fila.insumoId);
    var adjG     = (esComp || esPB) ? _repZero : _repartoDe(fila.insumoId);
    var copasBot = (fila.contNeto>0 && fila.copaML>0) ? fila.contNeto/fila.copaML : 0;
    var ea       = (parseFloat(fila.existenciaAnterior)||0) + adjG.ea; // copas
    var fisico   = calcExistencia(fila) + adjG.fis;                    // copas
    var teorico  = calcExistenciaTeorica(fila) + adjG.teo;
    var dif      = fisico - teorico;
    var color    = esPB ? 'var(--text-dim)' : (Math.abs(dif) < 0.05 ? 'var(--text-dim)' : (dif > 0 ? 'var(--green)' : 'var(--red)'));
    var difCarta = esPB ? 0 : dif * (fila.precioCarta||0);
    var pctVal   = esPB ? null : _pctVarianza(dif, _consumoPeriodo(fila) + adjG.venta); // dif vs venta neta
    var pct      = pctVal !== null ? ((pctVal>=0?'+':'')+pctVal.toFixed(1)+'%') : '—';
    var ventaCoct = esComp ? 0 : calcVentasCopasRecetas(fila.insumoId, fila.copaML);
    var ventaDir  = parseFloat(fila.ventasCopasDirectas)||0;
    var ventaBot  = parseFloat(fila.ventasBotella)||0;
    var cort = parseFloat(fila.cortesiaCopas)||0, merma = parseFloat(fila.mermaCopas)||0;
    var cancel = esComp ? 0 : getCancelacionesCopas(fila.insumoId);
    var _n1 = function(v){ return v%1 ? (Math.round(v*10)/10).toFixed(1) : v; };
    var eaDisp, fiDisp, uEx;
    if (esComp) {
        var uF = (getCompuestos().find(function(c){return c.id===fila.compId;})||{}).unidad || 'lt';
        uEx = uF==='lt'?'L':uF==='botella'?'bot':uF;
        var cml = fila.copaML||0;
        var toF = function(c){ if(!cml) return c; var ml=c*cml; return (uF==='lt'||uF==='kg')?ml/1000:uF==='botella'?ml/750:(uF==='ml'||uF==='g')?ml:ml/1000; };
        eaDisp = _n1(toF(ea)); fiDisp = _n1(toF(fisico));
    } else {
        uEx = fila.tipo==='pza'?'pza':(fila.tipo==='peso'?(fila.baseUnit||'u'):'bot');
        eaDisp = copasBot>0 ? _n1(ea/copasBot) : _n1(ea);
        fiDisp = copasBot>0 ? _n1(fisico/copasBot) : _n1(fisico);
    }
    var pesosAct = (fila.pesos||[]).filter(function(p){return parseFloat(p)>0;}).map(function(p){return (Math.round(parseFloat(p)*1000)/1000)+' kg';});
    var prevFila = esComp ? null : (refMap ? refMap[fila.insumoId] : _filaAnteriorInsumo(fila.insumoId));
    var pesosAnt = prevFila ? (prevFila.pesos||[]).filter(function(p){return parseFloat(p)>0;}).map(function(p){return (Math.round(parseFloat(p)*1000)/1000)+' kg';}) : [];
    var entradas = esComp ? [] : _entradasDeInsumo(fila.insumoId);
    var entTotal = esComp ? 0 : getEntradasBottles(fila.insumoId);
    var uEnt = esComp ? uEx : _unidadCompra(fila);
    var fila2 = function(lbl, val, col){ return '<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:12px"><span style="color:var(--text-dim)">'+lbl+'</span><span style="color:'+(col||'var(--text)')+';font-weight:600;text-align:right">'+val+'</span></div>'; };
    var ventasParts = [];
    if (ventaDir>0)  ventasParts.push(_n1(ventaDir)+' copa');
    if (ventaCoct>0) ventasParts.push('<span style="color:var(--viol)">'+_n1(ventaCoct)+' coct</span>');
    if (ventaBot>0)  ventasParts.push(_n1(ventaBot)+' bot');
    return '<div class="inv-item-card" style="padding:14px">'+
        '<div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:2px">'+(esComp?'🧩 ':'')+etx(esComp?fila.nombre:insumoTitulo(fila))+'</div>'+
        '<div style="font-size:10px;color:var(--text-dim);margin-bottom:10px">'+etx(esComp?'Compuesto':insumoMeta(fila))+'</div>'+
        fila2('Exist. anterior', eaDisp+' '+uEx+(pesosAnt.length?' <span style="font-size:10px;color:var(--text-dim)">('+pesosAnt.join(', ')+')</span>':''))+
        fila2('Entradas', entTotal>0?'+'+_n1(entTotal)+' '+uEnt:'—', entTotal>0?'var(--green)':'var(--text-dim)')+
        (entradas.length?'<div style="font-size:10px;color:var(--text-dim);padding:1px 0 4px 10px;line-height:1.6">'+entradas.map(function(e){return '• '+_n1(e.cantidad)+' '+uEnt+(e.fecha?' · '+e.fecha:'')+(e.tipo?' ('+tipoEntradaLabel(e.tipo)+')':'');}).join('<br>')+'</div>':'')+
        fila2('Ventas', ventasParts.length?ventasParts.join(' · '):'—', 'var(--accent)')+
        fila2('Cortesía / Merma', (cort+merma)>0?_n1(cort+merma)+' cop':'—', (cort+merma)>0?'var(--red)':'var(--text-dim)')+
        fila2('Cancelaciones', cancel>0?_n1(cancel)+' cop':'—', 'var(--text-muted)')+
        fila2('Exist. actual', fiDisp+' '+uEx+(pesosAct.length?' <span style="font-size:10px;color:var(--text-dim)">('+pesosAct.join(', ')+')</span>':''))+
        '<div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">'+
            fila2('Diferencia', (dif>=0?'+':'')+_n1(dif)+' cop · '+pct, color)+
            fila2('Dif. $ (carta)', (difCarta>=0?'+':'')+'$'+difCarta.toFixed(2), color)+
        '</div>'+
    '</div>';
}

// ── Paginador del reporte: mide alturas reales y reparte el contenido (#rd-src) en hojas A4
//    discretas (#rd-pages), cada una con encabezado y pie. Si una tabla cruza de hoja, repite
//    su cabecera de columnas. Garantiza: hojas visibles en digital, encabezado en cada hoja,
//    y que NINGUNA fila se corte. ──────────────────────────────────────────────────────────
function _rdConstruirPaginas(src, pagesC, headHtml, footHtml) {
    if (!src || !pagesC) return;
    const mkPage = () => {
        const p = document.createElement('div');
        p.className = 'rd-paper';
        p.innerHTML = '<div class="rd-pagehead-wrap"></div><div class="rd-pagebody"><div class="rd-bodyinner"></div></div><div class="rd-pagefoot-wrap"></div>';
        p.querySelector('.rd-pagehead-wrap').innerHTML = headHtml;
        p.querySelector('.rd-pagefoot-wrap').innerHTML = footHtml;
        pagesC.appendChild(p);
        return p;
    };
    let page = mkPage();
    let bodyOuter = page.querySelector('.rd-pagebody');   // celda estirada (altura disponible)
    let body = page.querySelector('.rd-bodyinner');        // contenido real (altura auto = lo que mide)
    // Cabe si la altura REAL del contenido (body.offsetHeight) entra en el espacio disponible
    // (bodyOuter.clientHeight). Margen de 6px ante el clip (overflow:hidden).
    const fits = () => body.offsetHeight <= bodyOuter.clientHeight - 6;
    const room = () => bodyOuter.clientHeight - body.offsetHeight;
    const newPage = () => { page = mkPage(); bodyOuter = page.querySelector('.rd-pagebody'); body = page.querySelector('.rd-bodyinner'); };
    const shell = (orig) => {
        const t = orig.cloneNode(false);
        const th = orig.querySelector('thead');
        if (th) t.appendChild(th.cloneNode(true));
        t.appendChild(document.createElement('tbody'));
        return t;
    };
    // Reparte las filas de una tabla en varias hojas, repitiendo su cabecera y (en la 1ª) el título.
    const splitTable = (table, titleEl) => {
        const rows = Array.from(table.querySelectorAll('tbody > tr'));
        let s = shell(table), tb = s.querySelector('tbody');
        const wrap = document.createElement('div');
        if (titleEl) wrap.appendChild(titleEl.cloneNode(true));
        wrap.appendChild(s);
        body.appendChild(wrap);
        rows.forEach(r => {
            tb.appendChild(r);
            if (!fits()) {
                tb.removeChild(r);
                newPage();
                s = shell(table); tb = s.querySelector('tbody');
                body.appendChild(s);
                tb.appendChild(r); // una fila siempre cabe en una hoja vacía
            }
        });
    };
    const isHeading = (n) => n.classList && (n.classList.contains('rd-sec') || n.classList.contains('rd-grptitle'));
    Array.from(src.children).forEach(node => {
        if (node.classList && node.classList.contains('rd-break')) { if (body.children.length) newPage(); return; }
        // Evitar encabezado huérfano al pie de la hoja.
        if (isHeading(node) && body.children.length && room() < 90) newPage();
        // Tablas que no caben completas: se PARTEN desde la hoja actual (llenando
        // el espacio que queda) en vez de saltar enteras a la siguiente — eso
        // dejaba hojas casi vacías (solo el título de sección y nada más).
        // Si el espacio restante ya es mínimo (<140px), sí se pasa a hoja nueva.
        if (node.classList && node.classList.contains('rd-grp')) {
            body.appendChild(node);
            if (fits()) return;
            body.removeChild(node);
            if (room() < 140 && body.children.length) newPage();
            body.appendChild(node);
            if (fits()) return;
            body.removeChild(node);
            splitTable(node.querySelector('table'), node.querySelector('.rd-grptitle'));
            return;
        }
        if (node.tagName === 'TABLE') {
            body.appendChild(node);
            if (fits()) return;
            body.removeChild(node);
            if (room() < 140 && body.children.length) newPage();
            body.appendChild(node);
            if (fits()) return;
            body.removeChild(node);
            splitTable(node, null);
            return;
        }
        body.appendChild(node);
        if (!fits() && body.children.length > 1) { body.removeChild(node); newPage(); body.appendChild(node); }
    });
    src.remove();
}

// ── Reporte directivo ─────────────────────────────────────────
function verReporteDirectivo(gerencial, modo) {
    if (!invActual) return;
    const ger = gerencial === true; // Reporte Gerencial: oculta los importes (solo % + neto + dif$ por insumo).
    const desglose = modo === 'desglose'; // Reporte en DOS exportes: resumen general vs desglose por insumo (más orgánico de imprimir).

    // ── Analytics ──────────────────────────────────────────────────
    let capitalCosto = 0, capitalCarta = 0, difTotal = 0;
    let conAlerta = 0, conRiesgo = 0, conOk = 0;

    _repCache = _repartoPrebatch(); // reparto prebatch→insumos (vista operativa)
    const analisis = filasCaptura.map(f => {
        // Prebatch repartido: se excluye del análisis (su variancia vive en sus insumos).
        const esPBo     = _esPrebatchRepartido(f.insumoId);
        const adjO      = esPBo ? _repZero : _repartoDe(f.insumoId);
        const fisico    = calcExistencia(f) + adjO.fis;
        const teorico   = calcExistenciaTeorica(f) + adjO.teo;
        const dif       = fisico - teorico;
        const cc        = costoCopa(f);
        const difCosto  = esPBo ? 0 : dif * (f.precioCarta || 0); // diferencia a precio de carta ($0 si no hay carta)
        const ea        = (parseFloat(f.existenciaAnterior) || 0) + adjO.ea;
        const entBot    = getEntradasBottles(f.insumoId);
        const copasBot  = f.contNeto > 0 && f.copaML > 0 ? f.contNeto / f.copaML : 1;
        // Coctelería = consumo por recetas del menú; copa → en copas, pza → en piezas.
        const ventaCoct    = (f.tipo === 'pza' ? calcVentasPzaRecetas(f.insumoId) : calcVentasCopasRecetas(f.insumoId, f.copaML)) + adjO.vco;
        const ventaCopaDir = parseFloat(f.ventasCopasDirectas) || 0; // venta directa por copa/pza
        const ventaCopa = ventaCoct + ventaCopaDir;
        const ventaBot  = parseFloat(f.ventasBotella) || 0;
        const cortesia  = parseFloat(f.cortesiaCopas)  || 0;
        const merma     = parseFloat(f.mermaCopas)     || 0;
        const cancel    = getCancelacionesCopas(f.insumoId);
        // pza: venta total en piezas = botella + directa + por menú/recetas (igual que el Resultado).
        const ventaPzaTot = f.tipo === 'pza' ? (ventaBot + (parseFloat(f.ventasCopasDirectas)||0) + calcVentasPzaRecetas(f.insumoId)) : 0;
        const consumo   = f.tipo === 'pza'
            ? ventaPzaTot + cortesia + merma + cancel
            : ventaCopa + ventaBot * copasBot + cortesia + merma + cancel;
        const disponible = ea + (f.tipo === 'pza' ? entBot : entBot * copasBot);
        const pctConsumo = disponible > 0 ? (consumo / disponible) * 100 : 0;
        // % de varianza vs VENTA NETA del periodo (misma definición que la columna % del Resultado).
        // Sin ventas → 0 (sin base de comparación, no dispara alerta).
        const ventaNetaF = f.tipo === 'pza' ? ventaPzaTot : (ventaCopa + ventaBot * copasBot);
        const varPct     = esPBo ? 0 : (_pctVarianza(dif, ventaNetaF) ?? 0);
        const _bat       = esBateo(f.insumoId) || esPBo; // de bateo / prebatch repartido: sin alerta propia
        if (!esPBo) { capitalCosto += fisico * cc; capitalCarta += fisico * (f.precioCarta || 0); }
        difTotal     += difCosto;
        if (!_bat && Math.abs(varPct) > 25) conAlerta++;
        else if (!_bat && Math.abs(varPct) > 10) conRiesgo++;
        else conOk++;
        // Prebatch repartido: dif y consumo van en CERO aquí — ya viajan repartidos en
        // sus insumos (si no, faltCosto/vendidoCosto los contarían DOBLE).
        return { f, fisico, teorico, dif: esPBo ? 0 : dif, cc, difCosto, ea, entBot, copasBot,
                 ventaCopa, ventaCoct, ventaCopaDir, ventaBot, ventaPzaTot, cortesia, merma, cancel,
                 consumo: esPBo ? 0 : consumo,
                 disponible, pctConsumo, varPct, esBateo:_bat, esPB: esPBo };
    });

    const totalProds = analisis.length;
    const pctControl = totalProds > 0 ? (conOk / totalProds * 100) : 0;
    const numCancel  = (invActual.cancelaciones || []).length;
    const totalDesc  = (invActual.descuentos || []).reduce((s, d) => s + (parseFloat(d.monto) || 0), 0);
    const margenPot  = capitalCarta - capitalCosto;

    // ── Métricas del resumen ejecutivo (igualadas con el Resultado del inventario) ──
    function _costoCompraF(f){ var c=costoCopa(f); if(f.tipo==='copa'){var cb=(f.contNeto>0&&f.copaML>0)?f.contNeto/f.copaML:0; return c*cb;} return c; }
    let capStockMin=0, capStockMax=0;
    filasCaptura.forEach(f => {
        if(!f||!f.insumoId) return;
        const costoCompra=_costoCompraF(f);
        const _ins=(typeof window._insumoResolver==='function')?window._insumoResolver(f.insumoId):null;
        const _p=_ins&&_ins.presentaciones&&_ins.presentaciones[0];
        capStockMin += (parseFloat((_p&&_p.stockMin)||(_ins&&_ins.stockMin)||f.stockMin)||0)*costoCompra;
        capStockMax += (parseFloat((_p&&_p.stockMax)||(_ins&&_ins.stockMax)||f.stockMax)||0)*costoCompra;
    });
    let comprasU=0, comprasCosto=0, bonifU=0, bonifCosto=0, consigU=0, consigCosto=0;
    const bonifItems={}, consigItems={}; // nombre → unidades acumuladas
    const _filaInsD={}; filasCaptura.forEach(f => { if(f&&f.insumoId) _filaInsD[f.insumoId]=f; });
    ((invActual.entradasLog)||[]).forEach(e => {
        const f=_filaInsD[e.insumoId]; if(!f) return;
        const cant=parseFloat(e.cantidad)||0; if(cant<=0) return;
        const costo=cant*_costoCompraF(f), t=(e.tipo||'compra').toLowerCase();
        const nm=(f.nombre)||e.nombre||'';
        if(t==='bonificacion'){bonifU+=cant;bonifCosto+=costo; if(nm) bonifItems[nm]=(bonifItems[nm]||0)+cant;}
        else if(t==='consignacion'){consigU+=cant;consigCosto+=costo; if(nm) consigItems[nm]=(consigItems[nm]||0)+cant;}
        else{comprasU+=cant;comprasCosto+=costo;}
    });
    const _listaItems = obj => Object.keys(obj).map(n => `${etx(n)} (${obj[n]%1?obj[n].toFixed(1):obj[n]})`).join(' · ');
    filasCaptura.forEach(f => { const man=(f.entradas||[]).reduce((s,x)=>s+(parseFloat(x)||0),0); if(man>0){comprasU+=man;comprasCosto+=man*_costoCompraF(f);} });
    let vendidoCosto=0, faltCosto=0, sobrCosto=0, faltCarta=0, sobrCarta=0;
    analisis.forEach(a => {
        if(a.consumo>0) vendidoCosto+=a.consumo*a.cc;
        if(a.dif<-0.001){ faltCosto+=Math.abs(a.dif)*a.cc; faltCarta+=Math.abs(a.difCosto); }      // a.difCosto = dif × precio de carta
        else if(a.dif>0.001){ sobrCosto+=a.dif*a.cc; sobrCarta+=a.difCosto; }
    });
    const netCosto = sobrCosto - faltCosto;    // sobrante − faltante, a COSTO
    const netCarta = sobrCarta - faltCarta;    // sobrante − faltante, a CARTA (coincide con la suma de "Dif. $" del desglose)
    const pctMinD = capStockMax>0?Math.round(capStockMin/capStockMax*100):0;
    const pctActD = capStockMax>0?Math.round(capitalCosto/capStockMax*100):0;

    // Rankings y grupos
    const top10      = [...analisis].sort((a, b) => b.consumo - a.consumo).slice(0, 10).filter(a => a.consumo > 0);
    const estancados = analisis.filter(a => a.consumo === 0 && a.fisico > 0 && !a.esPB); // prebatch repartido no es "estancado": su consumo vive en sus insumos
    const alertasCrit= analisis.filter(a => !a.esBateo && a.varPct < -25).sort((a, b) => a.varPct - b.varPct);
    const alertasSob = analisis.filter(a => !a.esBateo && a.varPct > 25).sort((a, b) => b.varPct - a.varPct);
    const riesgos    = analisis.filter(a => !a.esBateo && Math.abs(a.varPct) > 10 && Math.abs(a.varPct) <= 25).sort((a, b) => Math.abs(b.varPct) - Math.abs(a.varPct));
    const GPROD_RD = '🏭 Producción propia';
    const _mapaComp = _compDeInsumo();                 // insumoId miembro → compuesto
    const _aById = {}; analisis.forEach(a => { _aById[a.f.insumoId] = a; });
    const gruposTabla = {};
    const _pushG = (g, e) => { (gruposTabla[g] || (gruposTabla[g] = [])).push(e); };
    analisis.forEach(a => {
        if (_mapaComp[a.f.insumoId]) return; // miembro de compuesto → va DENTRO de su compuesto
        // Igual que el Resultado: bateo NO va aparte (vive en su categoría con su chip);
        // prebatch repartido → "Producción propia" (su varianza vive en sus insumos).
        _pushG(a.esPB ? GPROD_RD : _grupoCategoria(a.f), a);
    });
    // Compuestos activos: entrada AGREGADA con su desglose por presentación (igual que el Resultado).
    _compuestosActivos().forEach(comp => {
        const mem = (comp.miembros||[]).map(id => _aById[id]).filter(Boolean);
        if (!mem.length) return;
        let ea=0,entBot=0,vCopaDir=0,vBot=0,vCoct=0,cm=0,cancel=0,fisico=0,teorico=0,dif=0,difCosto=0,eaBot=0,fisBot=0,vendCopas=0,consumo=0;
        mem.forEach(m => {
            ea+=m.ea; entBot+=m.entBot; vCopaDir+=m.ventaCopaDir; vBot+=m.ventaBot; vCoct+=m.ventaCoct;
            cm+=(m.cortesia+m.merma); cancel+=m.cancel; fisico+=m.fisico; teorico+=m.teorico;
            dif+=m.dif; difCosto+=m.difCosto; consumo+=m.consumo;
            eaBot  += m.copasBot>0 ? m.ea/m.copasBot : m.ea;
            fisBot += m.copasBot>0 ? m.fisico/m.copasBot : m.fisico;
            vendCopas += (m.ventaCopa||0) + (m.ventaBot||0)*(m.copasBot||0);
        });
        const varPct = _pctVarianza(dif, vendCopas) ?? 0;
        const nombre = comp.nombre || (mem[0] && mem[0].f.nombre) || 'Compuesto';
        _pushG(_grupoCategoria(mem[0].f), {
            esComp:true, comp, nombre, members:mem,
            ea, entBot, ventaCopaDir:vCopaDir, ventaBot:vBot, ventaCoct:vCoct, cmTotal:cm, cancel,
            fisico, teorico, dif, difCosto, eaBot, fisBot, varPct, vendCopas, consumo,
            f:{ tipo:'copa', nombre, insumoId:'_comp_'+comp.id }
        });
    });

    // Recomendaciones automáticas
    const recos = [];
    if (alertasCrit.length)
        recos.push({ t:'crit', ico:'🔴', txt:`<strong>${alertasCrit.length} producto${alertasCrit.length>1?'s':''} con faltante crítico</strong> (varianza &gt; 25%). Revisar posibles mermas no registradas, derrames o errores de captura en los productos marcados en rojo.` });
    if (alertasSob.length)
        recos.push({ t:'warn', ico:'🟡', txt:`<strong>${alertasSob.length} producto${alertasSob.length>1?'s':''} con sobrante significativo</strong>. Verificar que no haya entradas duplicadas o existencia anterior incorrecta.` });
    if (numCancel > 5)
        recos.push({ t:'warn', ico:'🟡', txt:`Se registraron <strong>${numCancel} cancelaciones</strong> en el período. Analizar patrones con el equipo de piso y validar los procesos de autorización.` });
    if (totalDesc > 0)
        recos.push({ t:'info', ico:'🔵', txt:`Descuentos aplicados por <strong>${ger?'(monto reservado)':'$'+(parseFloat(totalDesc)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong>. Verificar que todas las autorizaciones estén dentro de la política de la casa.` });
    if (estancados.length)
        recos.push({ t:'info', ico:'🔵', txt:`<strong>${estancados.length} producto${estancados.length>1?'s sin':' sin'} movimiento</strong> en el período. Evaluar si hay sobre-stock o baja demanda; considerar promoción o devolución al proveedor.` });
    if (!recos.length)
        recos.push({ t:'ok', ico:'🟢', txt:`<strong>Operación saludable.</strong> Todos los productos están dentro del margen de control esperado. Sin alertas activas en este período.` });

    // Helpers
    const [cOk, cWarn, cCrit] = ['#1a7a4a', '#c0870c', '#c0392b'];
    function vc(pct) { const a = Math.abs(pct); return a <= 10 ? cOk : a <= 25 ? cWarn : cCrit; }
    // Formato de moneda con separador de miles (es-MX): _m0 sin decimales, _m2 con 2 decimales.
    const _m0 = n => (Math.round(parseFloat(n)||0)).toLocaleString('es-MX');
    const _m2 = n => (parseFloat(n)||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    // En modo gerencial se ocultan los importes: muestra el % si existe, o '•••'. En directivo, el monto real.
    const $g = (montoHTML, pct) => ger ? (pct!=null ? pct+'%' : '<span style="color:#bbb">•••</span>') : montoHTML;
    // Existencia en BOTELLAS (licor/vino) o PIEZAS (refresco/cerveza) — no en copas (más legible, igual que el resultado).
    const _exFmt = (a, copas) => { const v = a.f.tipo==='pza' ? copas : (a.copasBot>0 ? copas/a.copasBot : copas); return (a.f.tipo==='pza' ? v.toFixed(0)+' pza' : v.toFixed(2)+' bot'); };
    // Tabla de varianza reutilizable (críticos / riesgo) con su grupo y motivo (físico vs teórico).
    function _rdTablaVar(items){
        if(!items.length) return '<div style="font-size:10px;color:#aaa;padding:4px 0 10px">Ninguno en este estado. ✅</div>';
        return `<table class="rd-t" style="margin-bottom:10px"><thead><tr>
            <th>Producto</th><th class="tc">Grupo</th><th class="tc">Físico</th><th class="tc">Teórico</th>
            <th class="tc">Diferencia</th><th class="tc">Varianza %</th><th class="tr">Dif. $</th></tr></thead><tbody>${
            items.map(a=>{const u=a.f.tipo==='pza'?'pza':'cop';const col=vc(a.varPct);const dc=a.dif>=0?cOk:cCrit;
            return `<tr><td style="font-weight:600">${etx(a.f.nombre)}${_notaInsumo(a.f.insumoId)?`<div style="font-size:8.5px;color:#9a6f00;font-style:italic;margin-top:2px">📝 ${etx(_notaInsumo(a.f.insumoId))}</div>`:''}</td>
                <td class="tc" style="color:#888">${_grupoCategoria(a.f)}</td>
                <td class="tc">${_exFmt(a, a.fisico)}</td><td class="tc">${_exFmt(a, a.teorico)}</td>
                <td class="tc" style="font-weight:700;color:${dc}">${a.dif>=0?'+':''}${a.dif.toFixed(1)} ${u}</td>
                <td class="tc" style="color:${col};font-weight:700">${a.varPct>=0?'+':''}${a.varPct.toFixed(1)}%</td>
                <td class="tr" style="font-weight:700;color:${a.difCosto>=0?cOk:cCrit}">${a.difCosto>=0?'+':''}$${_m2(a.difCosto)}</td></tr>`;
            }).join('')}</tbody></table>`;
    }
    const inv      = invActual;
    const fecha    = new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const invFecha = inv.fecha ? new Date(inv.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' }) : '—';
    // Período del inventario = del inventario de referencia (de donde sale la existencia anterior) al actual.
    const _refInvD   = (typeof _getRefInv === 'function') ? _getRefInv() : null;
    const _fmtD      = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' }) : null;
    const _periodoIni= _refInvD && _refInvD.fecha ? _fmtD(_refInvD.fecha) : null;
    const periodoTxt = _periodoIni ? `del ${_periodoIni} al ${invFecha}` : `levantamiento del ${invFecha}`;
    const _tipoTxt   = ({ bebidas:'de bebidas', alimentos:'de alimentos', almacen:'de almacén', restaurante:'general', primer_lev:'— primer levantamiento', otro:'' })[inv.tipoInv] || '';
    const _estadoInv = inv.cerrado ? 'CERRADO' : 'BORRADOR';

    // ── Encabezado y pie: marca COMPARTIDA de reportes (reporte-marca.js) →
    //    nombre del negocio VIVO + sucursal del inventario + logo automático.
    //    Fallback al formato anterior si el helper no está cargado.
    const brandGreen = '#3dbe7a';
    const _rdDer = `${ger?'Reporte Gerencial':'Reporte Directivo'}<br>Generado: ${fecha}${inv.area?'<br>Área: '+etx(inv.area):''}`;
    const rdHeader = (subt) => (typeof etaaxReporteHeader === 'function')
      ? `<div class="rd-pagehead" style="margin-bottom:14px">${etaaxReporteHeader(subt, _rdDer, { sucursalId: inv.sucursalId || '' })}</div>`
      : `
    <div class="rd-pagehead" style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:3px solid ${brandGreen};margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:30px;font-weight:900;letter-spacing:2px;color:#1a1916;line-height:1">ETAAX<span style="color:${brandGreen}">.</span></div>
        <div style="border-left:1px solid #ddd;padding-left:12px">
          <div style="font-size:16px;font-weight:800;color:#1a1916;line-height:1.1">${etx(inv.negocio||'Negocio')}</div>
          <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;margin-top:2px">${subt}</div>
        </div>
      </div>
      <div style="text-align:right;font-size:9px;color:#aaa;line-height:1.7">${_rdDer}</div>
    </div>`;
    const rdFoot = (typeof etaaxReporteFooter === 'function')
      ? `<div class="rd-foot" style="display:block;padding:0">${etaaxReporteFooter(etx(inv.nombre||'Inventario'))}</div>`
      : `<div class="rd-foot" style="display:flex;justify-content:space-between;align-items:center">
      <span>etaax.com · EGMx Consultoría Estratégica a&amp;b</span>
      <span style="color:${brandGreen};font-weight:700">${etx(inv.nombre||'Inventario')}</span>
      <span>${fecha}</span>
    </div>`;

    // ── Inventario completo: render por grupo y PAGINADO en hojas A4 (~26 filas por hoja) ──
    const _ncRd = v => (v % 1 ? (Math.round(v*10)/10).toFixed(1) : v);
    const _grupoInvHTML = ([grp, items]) => {
        let gDif = 0, gVend = 0, gNet = 0;
        const _pzaGrupo = items.length > 0 && items.every(a => a.f.tipo === 'pza');
        // Color por SIGNO (no por severidad): rojo = FALTANTE (−), verde =
        // SOBRANTE (+), gris = sin diferencia. Igual que el Paso 5 en pantalla.
        const scol = v => Math.abs(v) < 0.05 ? '#999' : (v > 0 ? cOk : cCrit);
        const rows = items.map(a => {
            // ── Compuesto: fila agregada (existencias en BOTELLAS, diferencia en copas)
            //    + una sub-fila por presentación (mismo desglose que el Resultado). ──
            if (a.esComp) {
                gDif += a.difCosto; gNet += a.dif; gVend += a.vendCopas;
                const cDifC = scol(a.dif), cCostC = scol(a.difCosto);
                const mainRow = `<tr style="background:#faf7ff">
              <td style="font-weight:700">🧩 ${etx(a.nombre)} <span style="font-weight:400;color:#999;font-size:8.5px">(${a.members.length} present.)</span>${_notaInsumo(a.f.insumoId)?`<div style="font-size:8.5px;color:#9a6f00;font-style:italic;margin-top:2px">📝 ${etx(_notaInsumo(a.f.insumoId))}</div>`:''}</td>
              <td class="tc" style="color:#888">${_ncRd(a.eaBot)} bot</td>
              <td class="tc" style="color:${cOk}">${a.entBot>0?'+'+_ncRd(a.entBot)+' b':'—'}</td>
              <td class="tc">${a.ventaCopaDir>0?_ncRd(a.ventaCopaDir)+' c':'—'}</td>
              <td class="tc">${a.ventaBot>0?_ncRd(a.ventaBot)+' b':'—'}</td>
              <td class="tc" style="color:#9b8de8">${a.ventaCoct>0?_ncRd(a.ventaCoct)+' c':'—'}</td>
              <td class="tc" style="font-weight:600">${_ncRd(a.fisBot)} bot</td>
              <td class="tc" style="color:${cDifC};font-weight:700">${a.dif>=0?'+':''}${a.dif.toFixed(1)} cop</td>
              <td class="tc" style="color:${cDifC}">${a.varPct.toFixed(0)}%</td>
              <td class="tr" style="color:${cCostC};font-weight:700">${a.difCosto>=0?'+':''}$${_m2(a.difCosto)}</td>
            </tr>`;
                const subRows = a.members.map(m => {
                    const mEaBot  = m.copasBot>0 ? m.ea/m.copasBot : m.ea;
                    const mFisBot = m.copasBot>0 ? m.fisico/m.copasBot : m.fisico;
                    const mcD = scol(m.dif), mcC = scol(m.difCosto), mCont = _fmtContenido(m.f);
                    return `<tr style="background:#fbfaff">
              <td style="padding-left:22px;color:#666;font-size:9px">↳ ${etx(m.f.nombre)}${mCont?` · <span style="color:#2471a3">📦 ${mCont}</span>`:''}</td>
              <td class="tc" style="color:#999">${_ncRd(mEaBot)} bot</td>
              <td class="tc" style="color:${cOk}">${m.entBot>0?'+'+_ncRd(m.entBot)+' b':'—'}</td>
              <td class="tc">${m.ventaCopaDir>0?_ncRd(m.ventaCopaDir)+' c':'—'}</td>
              <td class="tc">${m.ventaBot>0?_ncRd(m.ventaBot)+' b':'—'}</td>
              <td class="tc" style="color:#9b8de8">${m.ventaCoct>0?_ncRd(m.ventaCoct)+' c':'—'}</td>
              <td class="tc">${_ncRd(mFisBot)} bot</td>
              <td class="tc" style="color:${mcD};font-weight:600">${m.dif>=0?'+':''}${m.dif.toFixed(1)} cop</td>
              <td class="tc" style="color:${mcD}">${m.varPct.toFixed(0)}%</td>
              <td class="tr" style="color:${mcC}">${m.difCosto>=0?'+':''}$${_m2(m.difCosto)}</td>
            </tr>`;
                }).join('');
                return mainRow + subRows;
            }
            gDif += a.difCosto;
            gNet += a.dif;
            gVend += a.f.tipo === 'pza' ? (a.ventaPzaTot || 0) : ((a.ventaCopa || 0) + (a.ventaBot || 0) * (a.copasBot || 0));
            const u = a.f.tipo === 'pza' ? 'pza' : 'cop';
            const entStr = a.f.tipo === 'pza' ? (a.entBot>0?'+'+a.entBot+' p':'—') : (a.entBot>0?'+'+a.entBot.toFixed(1)+' b':'—');
            const vtaCopaStr = a.f.tipo === 'pza' ? '—' : (a.ventaCopaDir>0?a.ventaCopaDir.toFixed(1)+' c':'—');
            const vtaBotStr  = a.f.tipo === 'pza' ? ((a.ventaBot+a.ventaCopaDir)>0?(a.ventaBot+a.ventaCopaDir).toFixed(0)+' p':'—') : (a.ventaBot>0?a.ventaBot+' b':'—');
            const coctStr    = a.ventaCoct>0 ? (a.f.tipo==='pza'?a.ventaCoct.toFixed(0)+' p':a.ventaCoct.toFixed(1)+' c') : '—';
            const cDif  = scol(a.dif), cCost = scol(a.difCosto);
            return `<tr>
              <td style="font-weight:600;max-width:200px;white-space:normal;word-break:break-word">${etx(a.f.nombre)}${_fmtContenido(a.f)?`<div style="font-size:8.5px;color:#2471a3;margin-top:1px">📦 ${_fmtContenido(a.f)}</div>`:''}${_notaInsumo(a.f.insumoId)?`<div style="font-size:8.5px;color:#9a6f00;font-style:italic;margin-top:2px">📝 ${etx(_notaInsumo(a.f.insumoId))}</div>`:''}</td>
              <td class="tc" style="color:#888">${_exFmt(a, a.ea)}</td>
              <td class="tc" style="color:${cOk}">${entStr}</td>
              <td class="tc">${vtaCopaStr}</td>
              <td class="tc">${vtaBotStr}</td>
              <td class="tc" style="color:#9b8de8">${coctStr}</td>
              <td class="tc" style="font-weight:600">${_exFmt(a, a.fisico)}</td>
              <td class="tc" style="color:${cDif};font-weight:700">${a.dif>=0?'+':''}${a.dif.toFixed(1)} ${u}</td>
              <td class="tc" style="color:${cDif}">${a.varPct.toFixed(0)}%</td>
              <td class="tr" style="color:${cCost};font-weight:700">${a.difCosto>=0?'+':''}$${_m2(a.difCosto)}</td>
            </tr>`;
        }).join('');
        const gc = gDif >= 0 ? cOk : cCrit;
        const _gU = _pzaGrupo ? 'pza' : 'cop';
        const _netCol = gNet < -0.05 ? cCrit : (gNet > 0.05 ? cOk : '#999');
        const _faltTxt = gNet < -0.05 ? `faltan ${_ncRd(Math.abs(gNet))} ${_gU}` : (gNet > 0.05 ? `sobran ${_ncRd(gNet)} ${_gU}` : 'cuadra');
        return `<div class="rd-grp">
        <div class="rd-grptitle" style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:12px 0 4px">
          <span style="font-size:11px;font-weight:700;color:#1a1916">${grp}</span>
          <span style="flex:1"></span>
          <span style="font-size:9.5px;color:#888">🥃 ${_ncRd(gVend)} ${_gU} vendidas</span>
          <span style="font-size:9.5px;font-weight:600;color:${_netCol}">${_faltTxt}</span>
          <span style="font-size:11px;font-weight:700;color:${gc}">${gDif>=0?'+':''}$${_m2(gDif)}</span>
        </div>
        <table class="rd-t" style="margin-bottom:6px">
          <thead><tr>
            <th>Producto</th><th class="tc">Exist. ant.</th><th class="tc">Entradas</th>
            <th class="tc">Vta. copa</th><th class="tc">Vta. bot.</th><th class="tc">Coctelería</th>
            <th class="tc">Exist. act.</th><th class="tc">Varianza</th>
            <th class="tc">%</th><th class="tr">Dif. $</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
    };
    // ── Hoja de MOVIMIENTOS ESPECIALES: productos cancelados, mermados y cortesías ──
    const _mermados  = analisis.filter(a => a.merma > 0).sort((x,y)=>y.merma-x.merma);
    const _cortesias = analisis.filter(a => a.cortesia > 0).sort((x,y)=>y.cortesia-x.cortesia);
    const _cancels   = invActual.cancelaciones || [];
    const _uMC = a => a.f.tipo === 'pza' ? 'pza' : 'cop';
    const _movTit = t => `<div class="rd-grptitle" style="font-size:11px;font-weight:700;color:#1a1916;margin:12px 0 4px">${t}</div>`;
    const _movVacio = '<div style="font-size:10px;color:#aaa;padding:2px 0 10px">Ninguno en el período. ✅</div>';
    // Desglose de ENTRADAS por insumo (cantidad + fecha) — del entradasLog (QR y
    // manuales con fecha) + la captura directa del Paso 2 (5 slots, sin fecha).
    const _entradasPorInsumoHTML = (function(){
        const porIns = {};
        (invActual.entradasLog || []).forEach(function(e){
            if (!e || !e.insumoId || !(parseFloat(e.cantidad) > 0)) return;
            (porIns[e.insumoId] = porIns[e.insumoId] || []).push({ cant: parseFloat(e.cantidad)||0, fecha: e.fecha || '', nota: e.notas || (e.origen === 'qr' ? 'QR' : '') });
        });
        filasCaptura.forEach(function(f){
            if (!f || !f.insumoId) return;
            const sum = (f.entradas || []).reduce(function(s,x){ return s + (parseFloat(x)||0); }, 0);
            if (sum > 0) (porIns[f.insumoId] = porIns[f.insumoId] || []).push({ cant: sum, fecha: '', nota: 'captura directa' });
        });
        const ids = Object.keys(porIns);
        if (!ids.length) return '';
        const _nom = function(id){ const f = _filaInsD[id]; return f ? f.nombre : id; };
        const _u = function(id){ const f = _filaInsD[id]; return (f && f.tipo === 'pza') ? 'pza' : 'bot'; };
        const rows = ids.sort(function(a,b){ return _nom(a).localeCompare(_nom(b)); }).map(function(id){
            const arr = porIns[id];
            const tot = arr.reduce(function(s,e){ return s + e.cant; }, 0);
            return arr.map(function(e, i){
                return '<tr>' +
                    '<td style="font-weight:'+(i===0?'600':'400')+'">' + (i===0 ? etx(_nom(id)) : '') + '</td>' +
                    '<td class="tc" style="color:#1a7a4a;font-weight:600">+' + (e.cant % 1 ? e.cant.toFixed(1) : e.cant) + ' ' + _u(id) + '</td>' +
                    '<td class="tc" style="color:#888">' + (e.fecha || '—') + '</td>' +
                    '<td style="color:#888">' + etx(e.nota || '') + '</td>' +
                    '<td class="tr" style="color:#888">' + (i===0 ? '<strong style="color:#1a7a4a">+'+(tot % 1 ? tot.toFixed(1) : tot)+' '+_u(id)+'</strong>' : '') + '</td>' +
                '</tr>';
            }).join('');
        }).join('');
        return '<div class="rd-break"></div><div class="rd-sec">📥 Entradas por insumo — cantidad y fecha</div>' +
            '<table class="rd-t"><thead><tr><th>Insumo</th><th class="tc">Entrada</th><th class="tc">Fecha</th><th>Origen / nota</th><th class="tr">Total insumo</th></tr></thead><tbody>' + rows + '</tbody></table>';
    })();

    const movimientosHTML = `
      <div class="rd-sec">Movimientos especiales del período</div>
      ${_cancels.length ? `<div class="rd-grp">${_movTit('🚫 Productos cancelados (POS) — '+_cancels.length)}
        <table class="rd-t"><thead><tr><th>Fecha / Hora</th><th>Producto</th><th class="tc">Cant.</th><th>Autorizó</th><th>Motivo</th><th>Mesero</th></tr></thead>
          <tbody>${_cancels.map(c=>`<tr><td style="white-space:nowrap;color:#888">${c.fechaHora||'—'}</td><td style="font-weight:500">${etx(c.nombreProducto||'—')}</td><td class="tc" style="font-weight:700">${c.cantidad||'—'}</td><td>${etx(c.autorizo||c.responsable||'—')}</td><td style="color:#888">${etx(c.motivo||'—')}</td><td style="color:#888">${etx(c.mesero||'—')}</td></tr>`).join('')}</tbody></table></div>`
        : _movTit('🚫 Productos cancelados (POS) — 0')+_movVacio}
      ${_mermados.length ? `<div class="rd-grp">${_movTit('🗑️ Productos mermados — '+_mermados.length)}
        <table class="rd-t"><thead><tr><th>Producto</th><th class="tc">Grupo</th><th class="tc">Merma</th><th>Motivo</th><th class="tr">Valor (carta)</th></tr></thead>
          <tbody>${_mermados.map(a=>`<tr><td style="font-weight:600">${etx(a.f.nombre)}</td><td class="tc" style="color:#888">${_grupoCategoria(a.f)}</td><td class="tc" style="color:${cCrit};font-weight:700">${a.merma.toFixed(1)} ${_uMC(a)}</td><td style="color:#888">${etx(a.f.mermaConcepto||'—')}</td><td class="tr" style="font-weight:600">$${_m2(a.merma*(a.f.precioCarta||0))}</td></tr>`).join('')}</tbody></table></div>`
        : _movTit('🗑️ Productos mermados — 0')+_movVacio}
      ${_cortesias.length ? `<div class="rd-grp">${_movTit('🎁 Cortesías — '+_cortesias.length)}
        <table class="rd-t"><thead><tr><th>Producto</th><th class="tc">Grupo</th><th class="tc">Cantidad</th><th>Motivo</th><th class="tr">Valor (carta)</th></tr></thead>
          <tbody>${_cortesias.map(a=>`<tr><td style="font-weight:600">${etx(a.f.nombre)}</td><td class="tc" style="color:#888">${_grupoCategoria(a.f)}</td><td class="tc" style="color:#7d5fa3;font-weight:700">${a.cortesia.toFixed(1)} ${_uMC(a)}</td><td style="color:#888">${etx(a.f.cortesiaConcepto||'—')}</td><td class="tr" style="font-weight:600">$${_m2(a.cortesia*(a.f.precioCarta||0))}</td></tr>`).join('')}</tbody></table></div>`
        : _movTit('🎁 Cortesías — 0')+_movVacio}`;
    // Descuentos: van al final del inventario (no es movimiento de producto).
    const _descuentosHTML = `${(!ger && (invActual.descuentos || []).length > 0) ? `
      <div class="rd-sec">Descuentos del período — Total: <span style="color:${cCrit}">$${_m2(totalDesc)}</span></div>
      <table class="rd-t"><thead><tr><th>Fecha / Hora</th><th class="tc">%</th><th class="tr">Monto $</th><th>Folio</th><th>Motivo</th><th>Autorizó</th></tr></thead>
        <tbody>${(invActual.descuentos || []).map(d => `<tr><td style="white-space:nowrap;color:#888">${d.fechaHora||'—'}</td><td class="tc">${d.porcentaje != null ? d.porcentaje + '%' : '—'}</td><td class="tr" style="color:${cCrit};font-weight:700">$${_m2((parseFloat(d.monto)||0))}</td><td>${etx(d.folio||'—')}</td><td style="color:#888">${etx(d.motivo||'—')}</td><td>${etx(d.autorizo||'—')}</td></tr>`).join('')}</tbody></table>` : ''}`;
    // Inventario completo: todos los grupos (bateo primero). El encabezado grande se repite por
    // hoja automáticamente porque TODO el reporte va dentro de una tabla con <thead> (ver abajo).
    const _gruposInvOrden = Object.entries(gruposTabla).sort((a,b)=>{const A=a[0]===GPROD_RD,B=b[0]===GPROD_RD;return A===B?String(a[0]).localeCompare(String(b[0]),'es'):(A?1:-1);});
    const inventarioHTML = `
      <div class="rd-sec">Inventario completo por grupo de categoría</div>
      ${_gruposInvOrden.map(_grupoInvHTML).join('')}`;
    // Encabezado grande y pie que un PAGINADOR (mide alturas) replica en cada hoja A4 discreta.
    const _headHtml = rdHeader(`Inventario ${_tipoTxt} · ${periodoTxt} · ${_estadoInv}${desglose ? ' · Desglose por insumo' : ''}`);
    const _footHtml = rdFoot;

    // Digest de texto para COMPARTIR por WhatsApp/Correo (el PDF no se puede
    // adjuntar desde el navegador; el resumen en texto es lo práctico para el cel).
    (function(){
        var m = (typeof etaaxMarca === 'function') ? etaaxMarca({ sucursalId: inv.sucursalId || '' }) : { negocio: inv.negocio || '', sucursal: '' };
        var netNeto = (invActual && invActual.difNetoCosto !== undefined) ? invActual.difNetoCosto : difTotal;
        var top = alertasCrit.slice(0, 5).map(function(a){
            return '• ' + a.f.nombre + ': ' + a.varPct.toFixed(0) + '% ($' + _m0(a.difCosto) + ')';
        }).join('\n');
        var L = [];
        L.push('📊 REPORTE DE INVENTARIO' + (ger ? ' (gerencial)' : ''));
        L.push((m.emoji ? m.emoji + ' ' : '') + (m.negocio || 'Negocio') + (m.sucursal ? ' · ' + m.sucursal : ''));
        L.push((inv.nombre || 'Inventario') + ' · ' + periodoTxt + ' · ' + _estadoInv);
        L.push('');
        if (!ger) {
            L.push('💰 Capital a costo: $' + _m0(capitalCosto));
            L.push('🏷️ Capital a carta: $' + _m0(capitalCarta));
        }
        // Neto a costo oculto a propósito en el export (a revisar); solo se comparte a carta.
        L.push((netCarta >= 0 ? '🟢 Sobrante' : '🔴 Faltante') + ' a carta: ' + (netCarta >= 0 ? '+' : '−') + '$' + _m0(Math.abs(netCarta)));
        L.push('⚠️ Alertas críticas (>25%): ' + conAlerta);
        if (top) { L.push(''); L.push('Top faltantes:'); L.push(top); }
        L.push('');
        L.push('Generado con ETAAX · etaax.com');
        window._rdShareTxt = L.join('\n');
    })();

    // Limpiar overlay anterior si existiera
    document.getElementById('rdOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'rdOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9998;overflow:auto;background:#1a1916';

    overlay.innerHTML = `
<style>
/* Cada hoja A4 = un .rd-paper de altura fija; el cuerpo (rd-pagebody) tiene la altura útil. */
.rd-paper{background:#fff;width:210mm;height:297mm;margin:24px auto;box-shadow:0 4px 40px rgba(0,0,0,.55);font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1a1916;display:flex;flex-direction:column;overflow:hidden}
.rd-pagehead-wrap{flex:0 0 auto;padding:12mm 10mm 0}
.rd-pagebody{flex:1 1 auto;overflow:hidden;padding:0 10mm}
.rd-bodyinner{padding-top:3mm}
.rd-pagefoot-wrap{flex:0 0 auto;padding:0 10mm 7mm}
.rd-pagehead-wrap .rd-foot,.rd-pagefoot-wrap .rd-foot{margin-top:0}
#rd-pages{padding-top:34px}
/* Fuente de medición: ancho = ancho útil de la hoja (210 − 2×10mm), fuera de pantalla. */
#rd-src{position:absolute;left:-9999px;top:0;width:190mm;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1a1916}
.rd-h1{font-size:22px;font-weight:900;margin:0 0 3px;color:#1a1916}
.rd-sub{font-size:11px;color:#888}
.rd-sec{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;border-bottom:2px solid #1a1916;padding-bottom:5px;margin:18px 0 10px}
.rd-kgrid{display:grid;gap:8px}
.rd-k6{grid-template-columns:repeat(6,1fr)}
.rd-kpi{border:1px solid #e8e8e0;border-radius:8px;padding:10px 12px}
.rd-kl{font-size:9px;color:#999;text-transform:uppercase;letter-spacing:.5px}
.rd-kv{font-size:18px;font-weight:800;margin-top:2px;color:#1a1916}
.rd-ks{font-size:9px;color:#aaa;margin-top:1px}
.rd-sem{display:flex;align-items:center;gap:12px;background:#f9f9f6;border-radius:8px;padding:10px 14px}
.rd-sem-blk{text-align:center;min-width:38px}
.rd-sem-n{font-size:22px;font-weight:900;line-height:1}
.rd-sem-l{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-top:2px}
.rd-bar{flex:1;height:10px;border-radius:5px;overflow:hidden;display:flex}
.rda{border-radius:6px;padding:7px 12px;margin-bottom:5px;font-size:11px;line-height:1.55}
.rda-crit{background:#fff0ee;border-left:4px solid #c0392b}
.rda-warn{background:#fffbee;border-left:4px solid #c0870c}
.rda-info{background:#eef4ff;border-left:4px solid #2471a3}
.rda-ok{background:#eeffee;border-left:4px solid #1a7a4a}
.rd-t{width:100%;border-collapse:collapse;font-size:10px}
.rd-t th{padding:5px 7px;text-align:left;background:#f5f5f0;border-bottom:2px solid #ddd;font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#666;white-space:nowrap}
.rd-t td{padding:6px 7px;border-bottom:1px solid #f0f0ec;vertical-align:middle;line-height:1.25}
.rd-t tr:last-child td{border-bottom:none}
.tc{text-align:center!important}.tr{text-align:right!important}
.rd-rank{display:inline-block;width:18px;height:18px;border-radius:50%;background:#1a1916;color:#f5c842;font-size:9px;font-weight:900;text-align:center;line-height:18px}
.rd-foot{padding-top:10px;border-top:1px solid #eee;font-size:9px;color:#bbb;text-align:center}
.rd-t thead{display:table-header-group}
@media print{
  /* Impresión = la MISMA paginación de la vista digital, en A4 (cada .rd-paper = 1 hoja). */
  @page{size:A4;margin:0}
  body>*:not(#rdOverlay){display:none!important}
  #rdOverlay{position:static!important;overflow:visible!important;background:white!important}
  #rd-toolbar{display:none!important}
  #rd-pages{padding-top:0!important}
  .rd-paper{box-shadow:none!important;margin:0!important;page-break-after:always;break-after:page}
  .rd-paper:last-child{page-break-after:auto;break-after:auto}
}
</style>

<div id="rd-toolbar" style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#1a1916;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.5)">
  <span style="color:#f5f0e8;font-size:14px;font-weight:700">${ger?'🔐 Reporte Gerencial':'📊 Reporte Directivo'}${desglose?' · Desglose por insumo':''} — ${etx(inv.nombre || 'Inventario')}</span>
  <div style="display:flex;gap:8px">
    <button onclick="verReporteDirectivo(${ger?'true':'false'}, '${desglose ? '' : 'desglose'}')" style="padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;background:transparent;border:1px solid rgba(255,255,255,.3);color:#f5f0e8">${desglose ? '📊 Ver resumen' : '📑 Ver desglose por insumo'}</button>
    <div style="position:relative">
      <button onclick="_toggleRdShare(event)" style="padding:7px 18px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;background:#f5c842;color:#1a1916;border:none">📤 Compartir ▾</button>
      <div id="rdShareMenu" style="display:none;position:absolute;right:0;top:calc(100% + 6px);background:#1a1916;border:1px solid rgba(255,255,255,.22);border-radius:10px;overflow:hidden;min-width:230px;box-shadow:0 8px 24px rgba(0,0,0,.5)">
        <button id="rdBtnCompartirPDF" onclick="_rdShareClose();_compartirPDF()" style="display:flex;align-items:center;gap:8px;width:100%;padding:12px 16px;background:rgba(245,200,66,.14);border:none;border-bottom:1px solid rgba(255,255,255,.08);color:#f5c842;font-size:13px;font-weight:700;cursor:pointer;text-align:left" onmouseover="this.style.background='rgba(245,200,66,.22)'" onmouseout="this.style.background='rgba(245,200,66,.14)'">📄 Compartir PDF <span style="font-size:10px;opacity:.75;font-weight:400">(correo / WhatsApp)</span></button>
        <button onclick="_rdShareClose();window.print()" style="display:flex;align-items:center;gap:8px;width:100%;padding:11px 16px;background:transparent;border:none;color:#f5f0e8;font-size:13px;cursor:pointer;text-align:left" onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background='transparent'">🖨️ Imprimir / PDF</button>
      </div>
    </div>
    <button onclick="document.getElementById('rdOverlay').remove()" style="padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;background:transparent;border:1px solid rgba(255,255,255,.3);color:#f5f0e8">✕ Cerrar</button>
  </div>
</div>

<!-- Contenedor donde el paginador (JS) arma las hojas A4 -->
<div id="rd-pages"></div>
<!-- Fuente: TODO el contenido en orden; el paginador lo mide y reparte por hoja -->
<div id="rd-src">

  <!-- KPIs -->
  <div class="rd-sec">Resumen ejecutivo</div>
  <div class="rd-kgrid" style="grid-template-columns:repeat(5,1fr);margin-bottom:8px">
    <div class="rd-kpi">
      <div class="rd-kl">Capital a costo</div>
      <div class="rd-kv">${$g('$'+_m0(capitalCosto))}</div>
      <div class="rd-ks">Existencia valorada</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Capital a carta</div>
      <div class="rd-kv" style="color:${cOk}">${$g('$'+_m0(capitalCarta))}</div>
      <div class="rd-ks">Valor potencial de venta</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Margen potencial</div>
      <div class="rd-kv" style="color:${cOk}">${$g('$'+_m0(margenPot))}</div>
      <div class="rd-ks">Carta − costo</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Cancelaciones POS</div>
      <div class="rd-kv" style="color:${numCancel > 5 ? cCrit : numCancel > 0 ? cWarn : '#555'}">${numCancel}</div>
      <div class="rd-ks">Registros del período</div>
    </div>
    <div class="rd-kpi" style="border-left:4px solid ${totalDesc > 0 ? cWarn : '#e8e8e0'}">
      <div class="rd-kl">Descuentos aplicados</div>
      <div class="rd-kv" style="color:${totalDesc > 0 ? cWarn : '#555'}">${$g('$'+_m0(totalDesc))}</div>
      <div class="rd-ks">Total del período</div>
    </div>
  </div>

  <!-- Stock requerido en capital (precio proveedor) -->
  <div class="rd-kgrid" style="grid-template-columns:repeat(3,1fr);margin-bottom:8px">
    <div class="rd-kpi">
      <div class="rd-kl">Stock mínimo en capital</div>
      <div class="rd-kv" style="color:${cWarn}">${$g('$'+_m0(capStockMin), pctMinD)}</div>
      <div class="rd-ks">${pctMinD}% del máximo${ger?'':' · precio proveedor'}</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Stock máximo en capital</div>
      <div class="rd-kv">${$g('$'+_m0(capStockMax), 100)}</div>
      <div class="rd-ks">meta de stock${ger?'':' · precio proveedor'}</div>
    </div>
    <div class="rd-kpi" style="border-left:4px solid ${capitalCosto<capStockMin?cCrit:cOk}">
      <div class="rd-kl">Stock actual en capital</div>
      <div class="rd-kv" style="color:${capitalCosto<capStockMin?cCrit:cOk}">${$g('$'+_m0(capitalCosto), pctActD)}</div>
      <div class="rd-ks">${pctActD}% del máximo${ger?'':' · precio proveedor'}</div>
    </div>
  </div>

  <!-- Movimiento del período: vendido vs compras -->
  <div class="rd-kgrid" style="grid-template-columns:repeat(3,1fr);margin-bottom:8px">
    <div class="rd-kpi">
      <div class="rd-kl">Vendido a precio proveedor</div>
      <div class="rd-kv">${$g('$'+_m0(vendidoCosto))}</div>
      <div class="rd-ks">costo de lo que salió</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Compras del período</div>
      <div class="rd-kv">${$g('$'+_m0(comprasCosto))}</div>
      <div class="rd-ks">${comprasU>0?(comprasU%1?comprasU.toFixed(1):comprasU)+' unid. compradas':'sin compras'}</div>
    </div>
    <div class="rd-kpi" style="border-left:4px solid ${vendidoCosto-comprasCosto>=0?cOk:cCrit}">
      <div class="rd-kl">Vendido vs Compras</div>
      <div class="rd-kv" style="color:${vendidoCosto-comprasCosto>=0?cOk:cCrit}">${vendidoCosto-comprasCosto>=0?'+':'−'}$${_m0(Math.abs(vendidoCosto-comprasCosto))}</div>
      <div class="rd-ks">${vendidoCosto>=comprasCosto?'compraste menos de lo que vendiste':'compraste más de lo que vendiste'}</div>
    </div>
  </div>

  <!-- Diferencia física neta A CARTA. (El neto a COSTO se ocultó a propósito en el
       reporte impreso hasta revisar bien ese dato; se sigue calculando internamente.) -->
  <div class="rd-kgrid" style="grid-template-columns:1fr;margin-bottom:8px">
    <div class="rd-kpi" style="border-left:4px solid ${netCarta>=0?cOk:cCrit}">
      <div class="rd-kl">${netCarta>=0?'Sobrante':'Faltante'} neto a carta</div>
      <div class="rd-kv" style="color:${netCarta>=0?cOk:cCrit}">${netCarta>=0?'+':'−'}$${_m0(Math.abs(netCarta))}</div>
      <div class="rd-ks">sobrante − faltante · precio de carta</div>
      ${invActual.comentarioNeto ? `<div style="margin-top:8px;border-top:1px dashed #ddd;padding-top:7px">
        <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">📝 Comentario de dirección</div>
        <div style="font-size:11px;color:#1a1916;line-height:1.5;white-space:pre-wrap">${etx(invActual.comentarioNeto)}</div>
      </div>` : ''}
    </div>
  </div>
  ${(bonifU>0||consigU>0)?`
  <div class="rd-kgrid" style="grid-template-columns:repeat(2,1fr);margin-bottom:8px">
    <div class="rd-kpi" style="border-left:4px solid ${cOk}">
      <div class="rd-kl">🎁 Bonificación</div>
      <div class="rd-kv" style="color:${cOk}">${bonifU%1?bonifU.toFixed(1):bonifU} unid.</div>
      <div class="rd-ks">${ger?'sin costo':'valor $'+_m0(bonifCosto)+' (sin costo)'}</div>
      ${bonifU>0?`<div style="font-size:9px;color:#666;margin-top:4px;line-height:1.5"><strong>Productos:</strong> ${_listaItems(bonifItems)}</div>`:''}
    </div>
    <div class="rd-kpi" style="border-left:4px solid #2471a3">
      <div class="rd-kl">📦 Consignación</div>
      <div class="rd-kv" style="color:#2471a3">${consigU%1?consigU.toFixed(1):consigU} unid.</div>
      <div class="rd-ks">${ger?'en consignación':'valor $'+_m0(consigCosto)}</div>
      ${consigU>0?`<div style="font-size:9px;color:#666;margin-top:4px;line-height:1.5"><strong>Productos:</strong> ${_listaItems(consigItems)}</div>`:''}
    </div>
  </div>`:''}

  <!-- Semáforo de control -->
  <div class="rd-sec">Control de inventario — ${totalProds} insumos inventariados</div>
  <div class="rd-sem">
    <div class="rd-sem-blk">
      <div class="rd-sem-n" style="color:${cOk}">${conOk}</div>
      <div class="rd-sem-l">🟢 OK<br>&lt;10% var.</div>
    </div>
    <div class="rd-sem-blk">
      <div class="rd-sem-n" style="color:${cWarn}">${conRiesgo}</div>
      <div class="rd-sem-l">🟡 Riesgo<br>10–25%</div>
    </div>
    <div class="rd-sem-blk">
      <div class="rd-sem-n" style="color:${cCrit}">${conAlerta}</div>
      <div class="rd-sem-l">🔴 Crítico<br>&gt;25%</div>
    </div>
    <div class="rd-bar">
      ${totalProds > 0 ? `
      <div style="width:${(conOk/totalProds*100).toFixed(1)}%;background:${cOk};height:100%"></div>
      <div style="width:${(conRiesgo/totalProds*100).toFixed(1)}%;background:${cWarn};height:100%"></div>
      <div style="width:${(conAlerta/totalProds*100).toFixed(1)}%;background:${cCrit};height:100%"></div>
      ` : ''}
    </div>
    <div style="text-align:right;white-space:nowrap">
      <div style="font-size:22px;font-weight:900;color:${pctControl >= 80 ? cOk : pctControl >= 60 ? cWarn : cCrit}">${pctControl.toFixed(0)}%</div>
      <div style="font-size:9px;color:#aaa">bajo control<br><span style="color:#bbb">${totalProds} productos</span></div>
    </div>
  </div>

  <!-- Recomendaciones -->
  <div class="rd-sec">Acciones recomendadas para dirección</div>
  ${recos.map(r => `<div class="rda rda-${r.t}">${r.ico} ${r.txt}</div>`).join('')}

  <div class="rd-break"></div>
  <!-- Desglose del semáforo: CRÍTICOS (faltante / sobrante > 25%) -->
  <div class="rd-sec" style="color:${cCrit};border-color:${cCrit}">🔴 Estado crítico — varianza mayor a 25% (${alertasCrit.length + alertasSob.length} insumos · acción inmediata)</div>
  <div style="font-size:9.5px;color:#888;margin:-4px 0 8px">Faltante = hay <strong>menos</strong> de lo esperado (posible merma, derrame, robo o error de captura). Sobrante = hay <strong>de más</strong> (posible entrada no registrada o existencia anterior mal capturada).</div>
  <div style="font-size:10px;font-weight:700;color:${cCrit};margin:4px 0 3px">🔻 Faltantes (${alertasCrit.length})</div>
  ${_rdTablaVar(alertasCrit)}
  <div style="font-size:10px;font-weight:700;color:${cWarn};margin:6px 0 3px">🔺 Sobrantes (${alertasSob.length})</div>
  ${_rdTablaVar(alertasSob)}

  <!-- Desglose del semáforo: EN RIESGO (10–25%) -->
  <div class="rd-sec" style="color:${cWarn};border-color:${cWarn}">🟡 En riesgo — varianza entre 10% y 25% (${riesgos.length} insumos · vigilar)</div>
  ${_rdTablaVar(riesgos)}

  <div class="rd-break"></div>
  <!-- Desglose del semáforo: SIN MOVIMIENTO -->
  ${estancados.length > 0 ? `
  <div class="rd-sec">🔵 Sin movimiento (${estancados.length}) — sin ventas en el período · evaluar sobre-stock o baja demanda</div>
  <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">
    ${estancados.map(a => `<span style="font-size:10px;background:#f5f5f0;border:1px solid #e0e0d8;border-radius:4px;padding:2px 8px;color:#666">${etx(a.f.nombre)}</span>`).join('')}
  </div>` : ''}

  <!-- Top 10 más vendidos -->
  <div class="rd-sec">Top 10 productos — mayor movimiento en el período</div>
  ${top10.length ? `
  <table class="rd-t">
    <thead><tr>
      <th style="width:20px">#</th>
      <th>Producto</th>
      <th class="tc">Venta copa</th>
      <th class="tc">Venta bot.</th>
      <th class="tc">Cortesía</th>
      <th class="tc">Merma</th>
      <th class="tc">Cancelac.</th>
      <th class="tc">Total consumo</th>
      <th class="tr">% consumo</th>
    </tr></thead>
    <tbody>
      ${top10.map((a, i) => {
        const u    = a.f.tipo === 'pza' ? 'pza' : 'cop';
        const pcc  = a.pctConsumo;
        const pcol = pcc >= 70 ? cOk : pcc >= 30 ? '#555' : cWarn;
        return `<tr>
          <td><span class="rd-rank">${i+1}</span></td>
          <td style="font-weight:600">${etx(a.f.nombre)}<br><span style="font-size:9px;color:#aaa;font-weight:400">${etx(a.f.categoria||'')}</span></td>
          <td class="tc">${a.f.tipo==='pza' ? (a.ventaPzaTot>0?a.ventaPzaTot.toFixed(0)+' p':'—') : (a.ventaCopa > 0 ? a.ventaCopa.toFixed(1)+' c' : '—')}</td>
          <td class="tc">${a.f.tipo==='pza' ? '—' : (a.ventaBot > 0 ? a.ventaBot+' b' : '—')}</td>
          <td class="tc" style="color:${a.cortesia>0?'#7d5fa3':'#ccc'}">${a.cortesia > 0 ? a.cortesia.toFixed(1) : '—'}</td>
          <td class="tc" style="color:${a.merma>0?cWarn:'#ccc'}">${a.merma > 0 ? a.merma.toFixed(1) : '—'}</td>
          <td class="tc" style="color:${a.cancel>0?cCrit:'#ccc'}">${a.cancel > 0 ? a.cancel.toFixed(1) : '—'}</td>
          <td class="tc" style="font-weight:700">${a.consumo.toFixed(1)} ${u}</td>
          <td class="tr" style="color:${pcol};font-weight:700">${pcc.toFixed(0)}%</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
  <div style="font-size:9px;color:#aaa;margin-top:5px">% consumo = total consumido ÷ (existencia anterior + entradas). &gt;70% alta rotación · &lt;30% baja rotación.</div>
  ` : '<div style="font-size:11px;color:#aaa;padding:8px 0">Sin ventas registradas en el período.</div>'}

  <div class="rd-break"></div>
  ${movimientosHTML}
  ${_entradasPorInsumoHTML}
  ${_descuentosHTML}

  <div class="rd-break"></div>
  ${inventarioHTML}

</div>`;

    document.body.appendChild(overlay);
    // DOS exportes: el RESUMEN (todo lo general) y el DESGLOSE POR INSUMO (las
    // tablas grandes) se imprimen por separado — juntos, el paginado forzaba
    // huecos feos entre secciones. Se poda el contenido según el modo.
    try {
        const _srcPoda = overlay.querySelector('#rd-src');
        let _enDesglose = false;
        Array.from(_srcPoda.children).forEach(n => {
            if (n.classList && n.classList.contains('rd-sec') && /Inventario completo/i.test(n.textContent)) _enDesglose = true;
            if (desglose ? !_enDesglose : _enDesglose) n.remove();
        });
        // rd-breaks colgantes al inicio/fin (dejarían hojas vacías)
        while (_srcPoda.firstElementChild && _srcPoda.firstElementChild.classList.contains('rd-break')) _srcPoda.firstElementChild.remove();
        while (_srcPoda.lastElementChild && _srcPoda.lastElementChild.classList.contains('rd-break')) _srcPoda.lastElementChild.remove();
    } catch(e) { console.warn('[reporte] poda por modo falló:', e); }
    // Paginar: medir alturas reales y repartir el contenido en hojas A4 discretas, cada una con
    // su encabezado y pie, sin cortar filas (cuando una tabla cruza de hoja, repite su cabecera).
    try {
        _rdConstruirPaginas(overlay.querySelector('#rd-src'), overlay.querySelector('#rd-pages'), _headHtml, _footHtml);
    } catch (e) {
        console.error('Paginado del reporte falló, se muestra sin paginar:', e);
        const s = overlay.querySelector('#rd-src'), pg = overlay.querySelector('#rd-pages');
        if (s && pg) { s.removeAttribute('id'); s.style.cssText = ''; const w = document.createElement('div'); w.className = 'rd-paper'; w.appendChild(s); pg.appendChild(w); }
    }
}

// ═══════════════════════════════════════════════════════════════
// GUARDAR / CERRAR
// ═══════════════════════════════════════════════════════════════
function _filaConDatos(f) {
    return f.registrado === true
        || (f.cerradasBodega || 0) + (f.cerradasBarra || 0) > 0
        || (f.metodoCaptura === 'nivel' ? (f.nivelPct || 0) > 0 : (f.pesos || []).some(p => parseFloat(p) > 0))
        || (f.entradas || []).some(e => parseFloat(e) > 0)
        || (f.ventasCopasDirectas || 0) > 0
        || (f.ventasBotella || 0) > 0
        || parseFloat(f.existenciaPeso) > 0   // alimentos: conteo físico
        || parseFloat(f.mermaBase) > 0
        || parseFloat(f.mermaCopas) > 0       // merma de bebidas (QR) → cuenta como dato
        || parseFloat(f.cortesiaCopas) > 0;   // cortesía/préstamo de bebidas (QR) → cuenta como dato
}
function _esRegistrado(f) { return _filaConDatos(f); }

function guardarInventario() {
    if (!invActual) return;
    if (window._soloVistaInv) return; // 👁️ vista de solo lectura: NUNCA persiste
    window._step5Dirty = true; // hubo cambios → el resumen (Paso 5) se re-renderiza al volver
    // Solo guardar filas con datos capturados — evita guardar 1400+ filas vacías
    var _nuevas = filasCaptura.filter(_filaConDatos);
    // 🛡️ Blindaje anti-borrado: si el resultado queda VACÍO (filasCaptura no cargada, o
    // reconstruida desde otra sucursal → todo fresco) pero el inventario YA tenía datos,
    // NO sobrescribir (antes esto borraba las existencias al abrirlo en la sucursal equivocada).
    if (!_nuevas.length && (invActual.filas || []).some(_filaConDatos)) return;
    invActual.filas = _nuevas.map(f => ({...f, existenciaFisica: calcExistencia(f)}));
    // Si se está EDITANDO un inventario cerrado, se persiste como CERRADO (el flag
    // _eraCerrado vive solo en memoria y nunca llega al disco/nube).
    const _persist = Object.assign({}, invActual);
    if (_persist._eraCerrado) _persist.cerrado = true;
    delete _persist._eraCerrado;
    const lista = getInventarios();
    const idx   = lista.findIndex(x=>x.id===invActual.id);
    if (idx>=0) lista[idx]=_persist; else lista.push(_persist);
    const ok = setInventarios(lista);
    if (!ok) throw new Error('storage-full');
    // FORZAR el upsert a la nube: el diff de setInventarios no detecta el cambio
    // porque _persistirBorradorLocal ya mutó _cacheInv (= prev). Sin esto, el
    // inventario solo vivía en localStorage y no sincronizaba entre dispositivos.
    try { _sbUpInv(_persist); } catch(e) { console.warn('[guardarInventario upsert]', e); }
}

// Respaldo INMEDIATO del borrador en localStorage (síncrono, en cada cambio).
// No espera el debounce ni a Supabase → aunque refresques al instante, no se pierde.
function _persistirBorradorLocal() {
    if (!invActual || invActual.cerrado || window._soloVistaInv) return; // 👁️ solo lectura
    try {
        // 🛡️ Mismo blindaje: no sobrescribir con vacío/fresco si el inventario ya tenía datos.
        var _nuevas = filasCaptura.filter(_filaConDatos);
        if (!_nuevas.length && (invActual.filas || []).some(_filaConDatos)) return;
        invActual.filas = _nuevas.map(function(f){ return Object.assign({}, f, { existenciaFisica: calcExistencia(f) }); });
        var _persistB = Object.assign({}, invActual);
        if (_persistB._eraCerrado) _persistB.cerrado = true; // editar un cerrado no lo reabre
        delete _persistB._eraCerrado;
        var lista = getInventarios();
        var idx = lista.findIndex(function(x){ return x.id === invActual.id; });
        if (idx >= 0) lista[idx] = _persistB; else lista.push(_persistB);
        _cacheInv = lista;
        _guardarDraftsLocal();
    } catch(e) { console.warn('[borrador local]', e); }
}
// Flush al cerrar/ocultar la pestaña (móvil incluido).
window.addEventListener('pagehide',     function(){ _persistirBorradorLocal(); });
window.addEventListener('beforeunload', function(){ _persistirBorradorLocal(); });
window.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'hidden') _persistirBorradorLocal(); });

// Indicador de guardado persistente (estilo Google Sheets).
function _setGuardadoInd(estado) {
    const ind = document.getElementById('autoGuardarInd');
    if (!ind) return;
    ind.style.opacity = '1';
    if (estado === 'guardando') { ind.textContent = '💾 Guardando…'; ind.style.color = 'var(--text-muted)'; }
    else { ind.textContent = '✓ Todos los cambios guardados'; ind.style.color = 'var(--green)'; }
}
let _autoGuardarTimer = null;
let _persistLocalTimer = null;
function _autoGuardar(opts) {
    if (!invActual || window._soloVistaInv) return; // 👁️ solo lectura: no guarda
    // Una NOTA/comentario no cambia números → no invalida el resumen del Paso 5.
    if (!(opts && opts.soloNota)) window._step5Dirty = true;
    _setGuardadoInd('guardando');
    // Respaldo local DEBOUNCED. Antes era SÍNCRONO en CADA tecla (mapea todas las
    // filas + calcExistencia + JSON.stringify de todo) → lag al escribir. El flush
    // inmediato al salir ya lo cubren pagehide/beforeunload/visibilitychange.
    clearTimeout(_persistLocalTimer);
    _persistLocalTimer = setTimeout(_persistirBorradorLocal, 300);
    clearTimeout(_autoGuardarTimer);
    _autoGuardarTimer = setTimeout(function() {
        try { guardarInventario(); } catch(e) { console.warn('[autoGuardar]', e); return; }
        _setGuardadoInd('ok'); // queda fijo "✓ Todos los cambios guardados"
    }, 600);
}

function guardarYSalir() {
    if (!invActual) return;
    invActual.cerrado = true; delete invActual._eraCerrado;
    let guardado = false;
    try { guardarInventario(); guardado = true; } catch(e) { console.warn('[guardarYSalir]', e); }
    if (!guardado) {
        invActual.cerrado = false;
        alert('No se pudo guardar el inventario (almacenamiento lleno). Intenta cerrar otras pestañas o liberar espacio y vuelve a intentarlo.');
        return;
    }
    invActual = null;
    mostrarVista('vistaLista');
}

function finalizarPrimerLev() {
    if (!invActual) return;
    if (invActual.cerrado) return;
    _solicitarClave('Guardar y cerrar levantamiento', function() {
        invActual.cerrado = true; delete invActual._eraCerrado;
        let ok = false;
        try { guardarInventario(); ok = true; } catch(e) {}
        if (!ok) { invActual.cerrado = false; alert('No se pudo guardar (almacenamiento lleno).'); return; }
        // Salida LIMPIA: sin esto, invActual quedaba seteado y el siguiente
        // inventario reusaba este objeto (iniciarInventario: esNuevo = !invActual)
        // → "al abrir otro también se abría el primer levantamiento".
        invActual = null; filasCaptura = [];
        mostrarVista('vistaLista');
    });
}

function cerrarInventario() {
    if (!invActual) return;
    if (invActual.cerrado) { alert('Este inventario ya está cerrado.'); return; }
    _solicitarClave('Cerrar y finalizar inventario', function() {
        invActual.cerrado = true; delete invActual._eraCerrado;
        let ok = false;
        try { guardarInventario(); ok = true; } catch(e) {}
        if (!ok) { invActual.cerrado = false; alert('No se pudo guardar (almacenamiento lleno).'); return; }
        actualizarNavBtns();
        invActual = null; filasCaptura = []; // salida limpia (no reusar en el siguiente)
        mostrarVista('vistaLista');
    });
}

function editarInventario(id) {
    _solicitarClave('Editar inventario', function() {
        // Cargar el inventario en memoria
        const inv = getInventarios().find(x=>x.id===id);
        if (!inv) { alert('Inventario no encontrado'); return; }
        invActual = JSON.parse(JSON.stringify(inv));
        // ✏️ Editar un CERRADO ya NO lo reabre en disco: se abre editable solo en
        // MEMORIA y todo guardado lo persiste como CERRADO (_eraCerrado). Antes
        // quedaba ABIERTO para siempre → el primer levantamiento "revivía" y el
        // siguiente inventario perdía su referencia (existencia anterior en $0).
        if (invActual.cerrado) { invActual.cerrado = false; invActual._eraCerrado = true; }
        if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
        if (!invActual.cancelaciones)     invActual.cancelaciones     = [];
        if (!invActual.descuentos)        invActual.descuentos        = [];
        if (!invActual.entradasLog)       invActual.entradasLog       = [];
        cargarProductosCaptura(); // merge filas guardadas con catálogo completo
        // Ir directo al wizard (paso 1), sin pasar por el formulario de datos
        pasoActual = 1;
        busquedaCapt = ''; filtroFamActivo = ''; filtroCatActiva = ''; filtroSubcatActiva = ''; filtroRegistroActivo = 'pendientes';
        mostrarVista('vistaCaptura');
        document.getElementById('captTitulo').textContent = invActual.nombre || 'Inventario';
        actualizarStepBar();
        actualizarNavBtns();
        renderStepContent();
    });
}

function eliminarInventario(id) {
    _pedirClaveAdmin('Eliminar inventario', function() {
        setInventarios(getInventarios().filter(x=>x.id!==id));
        if (invActual && invActual.id === id) mostrarVista('vistaLista');
        else init();
    });
}

// ═══════════════════════════════════════════════════════════════
// VISTA ENTRADAS — registro rápido de entradas
// ═══════════════════════════════════════════════════════════════
let _entLogInsumoCache = null;

function abrirRegistroEntradas() {
    _entLogInsumoCache = _scopeSucInsumos(getInsumos()); // solo insumos de la sucursal activa
    _entRapidaInsumoId = null;
    _entRapidaBusqueda = '';
    _entRapidaTipo     = 'compra';
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('entLogFecha').value    = hoy;
    document.getElementById('entLogCantidad').value = '';
    document.getElementById('entLogCosto').value    = '';
    document.getElementById('entLogNotas').value    = '';
    document.getElementById('entLogTipo').value     = 'compra';
    document.getElementById('entLogInsumoNombre').textContent = 'Selecciona un insumo';
    document.getElementById('entLogInsumoId').value = '';
    document.getElementById('entLogBusqueda').value = '';
    _renderEntLogChips('');
    document.getElementById('modalEntradaLog').style.display = 'flex';
}

function _renderEntLogChips(q) {
    const insumos = _entLogInsumoCache || getInsumos();
    const lista   = q
        ? insumos.filter(x => x.nombre.toLowerCase().includes(q.toLowerCase()) ||
                               (x.marca||'').toLowerCase().includes(q.toLowerCase()))
        : insumos.slice(0, 40);
    const cont = document.getElementById('entLogChips');
    if (!cont) return;
    if (!lista.length) { cont.innerHTML = '<div style="font-size:11px;color:var(--text-dim);padding:8px">Sin resultados</div>'; return; }
    cont.innerHTML = lista.map(ins =>
        `<button onclick="seleccionarEntLogInsumo('${ins.id}')"
            style="background:var(--surface2);border:1px solid var(--border);color:var(--text);
            border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-family:inherit;
            text-align:left;transition:all .15s"
            onmouseover="this.style.borderColor='var(--green)'" onmouseout="this.style.borderColor='var(--border)'">
            ${etx(insumoTitulo(ins))}${(insumoContenido(ins)||ins.marca) ? ` <span style="font-size:10px;color:var(--text-dim)">· ${insumoMetaHTML(ins)}</span>` : ''}
        </button>`
    ).join('');
}

function seleccionarEntLogInsumo(id) {
    const ins = (_entLogInsumoCache || getInsumos()).find(x => x.id === id);
    if (!ins) return;
    _entRapidaInsumoId = id;
    document.getElementById('entLogInsumoId').value = id;
    document.getElementById('entLogInsumoNombre').textContent = insumoEtiqueta(ins);
    // Autocompletar costo desde primera presentación
    const p0 = (ins.presentaciones||[])[0];
    if (p0 && p0.precio && !document.getElementById('entLogCosto').value) {
        document.getElementById('entLogCosto').value = p0.precio;
    }
    document.getElementById('entLogChips').innerHTML = '';
    document.getElementById('entLogBusqueda').value  = '';
}

function guardarEntradaLog() {
    const insumoId = document.getElementById('entLogInsumoId').value;
    const fecha    = document.getElementById('entLogFecha').value;
    const cantidad = parseFloat(document.getElementById('entLogCantidad').value);
    const costo    = parseFloat(document.getElementById('entLogCosto').value) || 0;
    const tipo     = document.getElementById('entLogTipo').value;
    const notas    = document.getElementById('entLogNotas').value.trim();

    if (!insumoId) { alert('Selecciona un insumo'); return; }
    if (!fecha)    { alert('Indica la fecha'); return; }
    if (!cantidad || cantidad <= 0) { alert('Indica la cantidad'); return; }

    const ins = (_entLogInsumoCache || getInsumos()).find(x => x.id === insumoId);

    // Save to global entradas log
    const log = getEntradasLog();
    const _nuevaEnt = {
        id:       genId(),
        insumoId,
        nombre:   ins ? ins.nombre : '—',
        familia:  ins ? (ins.familia||'') : '',
        cantidad,
        costo,
        tipo,
        notas,
        fecha,
        origen:   'manual',   // entrada capturada a mano en el ERP → se importa al inventario por PERIODO
        sucursalId: _sucActiva() || 'suc_principal', // sello: el import a otra sucursal la ignora
        registrado: new Date().toISOString()
    };
    log.push(_nuevaEnt);
    setEntradasLog(log);
    // FORZAR el upsert a la nube: setEntradasLog no detecta la nueva entrada porque
    // log === _cacheEL (misma referencia ya mutada por el push). Sin esto, la entrada
    // solo vivía en localStorage y no sincronizaba entre dispositivos.
    try { _sbUpEL(_nuevaEnt); } catch(e) { console.warn('[guardarEntradaLog upsert]', e); }

    // Also save to active inventory so it appears in vistaEntradas historial
    // Copia inmediata al inventario activo (mismo id → el import por periodo no la
    // duplica). Si su fecha cae fuera del periodo, el import la reubica al inventario correcto.
    if (invActual && _enPeriodoInvActual(fecha)) {
        if (!invActual.entradasLog) invActual.entradasLog = [];
        invActual.entradasLog.push({
            id: _nuevaEnt.id, insumoId,
            nombreProducto: ins ? insumoEtiqueta(ins) : '—',
            cantidad, costo, tipo, notas, fecha, origen: 'manual',
            sucursalId: _nuevaEnt.sucursalId
        });
        guardarEntradas();
    }

    // Close modal and refresh historial
    document.getElementById('modalEntradaLog').style.display = 'none';
    _entLogInsumoCache = null;
    // Re-render the full view if vistaEntradas is visible, otherwise just the list
    if (document.getElementById('vistaEntradas')?.style.display !== 'none') {
        renderVistaEntradas();
    } else {
        renderListadoEntradas();
    }
}

function cerrarEntradaLog() {
    document.getElementById('modalEntradaLog').style.display = 'none';
    renderListadoEntradas();
}


function tipoEntradaLabel(tipo) {
    if (tipo === 'compra')       return 'Compra';
    if (tipo === 'bonificacion') return 'Bonificación';
    if (tipo === 'consignacion') return 'Consignación';
    return tipo;
}

function tipoEntradaColor(tipo) {
    if (tipo === 'compra')       return 'var(--accent)';
    if (tipo === 'bonificacion') return 'var(--green)';
    if (tipo === 'consignacion') return '#7c7cff';
    return 'var(--text-muted)';
}

function buscarInsumoEntrada(val) {
    _entRapidaBusqueda = val;
    renderChipsEntrada();
}

function renderChipsEntrada() {
    const cont = document.getElementById('entChips');
    if (!cont) return;
    const q = _entRapidaBusqueda.trim().toLowerCase();
    if (!q) { cont.innerHTML = ''; return; }
    const matches = filasCaptura.filter(f => f.nombre.toLowerCase().includes(q));
    if (!matches.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Sin resultados para "${etx(_entRapidaBusqueda)}"</div>`;
        return;
    }
    cont.innerHTML = matches.map(f => `
        <button class="ent-chip ${_entRapidaInsumoId === f.insumoId ? 'active' : ''}"
            onclick="seleccionarProductoEntrada('${f.insumoId}')">
            ${etx(insumoEtiqueta(f))}
        </button>`).join('');
}

function seleccionarProductoEntrada(insumoId) {
    _entRapidaInsumoId = insumoId;
    renderChipsEntrada();
    renderFormEntrada();
}

function renderFormEntrada() {
    const cont = document.getElementById('entFormCard');
    if (!cont) return;
    if (!_entRapidaInsumoId) { cont.innerHTML = ''; return; }
    const fila = filasCaptura.find(f => f.insumoId === _entRapidaInsumoId);
    if (!fila) { cont.innerHTML = ''; return; }
    const totalBot = getEntradasBottles(_entRapidaInsumoId);
    cont.innerHTML = `
        <div class="ent-form-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
                <div>
                    <div style="font-weight:700;font-size:17px;color:var(--text)">${etx(insumoTitulo(fila))}</div>
                    ${insumoMeta(fila) ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${insumoMetaHTML(fila)}</div>` : ''}
                    ${totalBot > 0 ? `<div style="font-size:12px;color:var(--green);margin-top:5px;font-weight:600">Ya registrado este período: +${totalBot % 1 ? totalBot.toFixed(1) : totalBot} bot</div>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${_entRapidaInsumoId}')">📋 Ver</button>
                    <button onclick="limpiarSeleccionEntrada()"
                        style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:20px;padding:0;line-height:1">✕</button>
                </div>
            </div>
            <div class="ent-tipo-row">
                <button class="ent-tipo-btn ${_entRapidaTipo === 'compra'       ? 'active' : ''}" onclick="setTipoEntrada('compra')">🛒 Compra</button>
                <button class="ent-tipo-btn ${_entRapidaTipo === 'bonificacion' ? 'active' : ''}" onclick="setTipoEntrada('bonificacion')">🎁 Bonificación</button>
                <button class="ent-tipo-btn ${_entRapidaTipo === 'consignacion' ? 'active' : ''}" onclick="setTipoEntrada('consignacion')">📦 Consignación</button>
            </div>
            <div style="display:flex;gap:12px;align-items:flex-end;margin-top:16px;flex-wrap:wrap">
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Cantidad (${_unidadCompra({insumoId:_entRapidaInsumoId})})</div>
                    <input type="number" id="entRapidaCant" placeholder="0" min="0" step="1"
                        style="width:120px;height:52px;font-size:22px;text-align:center;border:1px solid var(--border);
                               border-radius:10px;background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;
                               box-sizing:border-box;outline:none;transition:border-color 0.15s"
                        onfocus="this.style.borderColor='var(--accent)'"
                        onblur="this.style.borderColor='var(--border)'"
                        onkeydown="if(event.key==='Enter')agregarEntradaRapida()">
                </div>
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Fecha</div>
                    <input type="date" id="entRapidaFecha" value="${new Date().toISOString().slice(0,10)}"
                        style="height:52px;padding:0 10px;border:1px solid var(--border);border-radius:10px;
                               background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;outline:none">
                </div>
                <button onclick="agregarEntradaRapida()"
                    style="height:52px;padding:0 24px;background:var(--green);color:var(--bg);border:none;
                           border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;
                           white-space:nowrap;transition:opacity 0.15s"
                    onmouseenter="this.style.opacity='.85'" onmouseleave="this.style.opacity='1'">
                    + Agregar
                </button>
            </div>
        </div>`;
    document.getElementById('entRapidaCant')?.focus();
}

function setTipoEntrada(tipo) {
    _entRapidaTipo = tipo;
    renderFormEntrada();
}

function limpiarSeleccionEntrada() {
    _entRapidaInsumoId = null;
    _entRapidaBusqueda = '';
    const inp = document.getElementById('entBuscador');
    if (inp) { inp.value = ''; inp.focus(); }
    renderChipsEntrada();
    renderFormEntrada();
}

function agregarEntradaRapida() {
    if (!_entRapidaInsumoId || !invActual) return;
    const cant = parseFloat(document.getElementById('entRapidaCant')?.value) || 0;
    if (cant <= 0) { document.getElementById('entRapidaCant')?.focus(); return; }
    const fecha = document.getElementById('entRapidaFecha')?.value || new Date().toISOString().slice(0,10);
    const fila  = filasCaptura.find(f => f.insumoId === _entRapidaInsumoId);
    const ins   = (typeof window._insumoResolver === 'function') ? window._insumoResolver(_entRapidaInsumoId) : null;
    const _id   = genId() + genId();
    const _suc  = _sucActiva() || 'suc_principal';
    if (!invActual.entradasLog) invActual.entradasLog = [];
    invActual.entradasLog.push({
        id:             _id,
        insumoId:       _entRapidaInsumoId,
        nombreProducto: ins ? insumoEtiqueta(ins) : (fila?.nombre || _entRapidaInsumoId),
        tipo:           _entRapidaTipo,
        cantidad:       cant,
        fecha,
        origen:         'manual',
        sucursalId:     _suc
    });
    guardarEntradas();
    // ESPEJO al log global (fuente maestra) → aparece también en el "Registro de entradas".
    // Antes la búsqueda rápida del inventario solo escribía aquí y ambas vistas divergían.
    try {
        const _gl = getEntradasLog();
        _gl.push({
            id: _id, insumoId: _entRapidaInsumoId,
            nombre: ins ? ins.nombre : (fila?.nombre || ''),
            familia: ins ? (ins.familia || '') : '',
            cantidad: cant, costo: 0, tipo: _entRapidaTipo, notas: '',
            fecha, origen: 'manual', sucursalId: _suc,
            importadoEnInv: invActual.id, registrado: new Date().toISOString()
        });
        _guardarELLocal(); _sbUpEL(_gl[_gl.length - 1]); // diff no ve el push → forzar
    } catch(e) { console.warn('[entRapida espejo global]', e); }
    const cantEl = document.getElementById('entRapidaCant');
    if (cantEl) { cantEl.value = ''; cantEl.focus(); }
    renderFormEntrada();
    renderListadoEntradas();
    renderChipsEntrada();
}

function eliminarEntradaRapida(idx) {
    _pedirClaveAdmin('Eliminar entrada', function() {
        if (!invActual?.entradasLog) return;
        var _rm = invActual.entradasLog[idx];
        invActual.entradasLog.splice(idx, 1);
        guardarEntradas();
        // Marcar `borrada` en el log global para que el import/back-fill no la re-agregue.
        if (_rm && _rm.id) {
            var _g = getEntradasLog().find(function(x){ return x && x.id === _rm.id; });
            if (_g) { _g.borrada = true; _guardarELLocal(); try { _sbUpEL(_g); } catch(e){} }
        }
        renderFormEntrada();
        renderListadoEntradas();
        renderChipsEntrada();
    });
}

// ── Filtro de fechas del historial de entradas (día/semana/mes/rango) ──
var _entPeriodo = 'todos', _entDesde = '', _entHasta = '';
function _entEnPeriodo(fechaStr) {
    if (_entPeriodo === 'todos') return true;
    if (!fechaStr) return false;
    var f = String(fechaStr).slice(0,10);
    var hoy = new Date(); hoy.setHours(0,0,0,0);
    var hoyStr = hoy.toISOString().slice(0,10);
    if (_entPeriodo === 'dia')    return f === hoyStr;
    if (_entPeriodo === 'mes')    return f.slice(0,7) === hoyStr.slice(0,7);
    if (_entPeriodo === 'semana') { var ini = new Date(hoy); ini.setDate(hoy.getDate() - hoy.getDay()); return f >= ini.toISOString().slice(0,10) && f <= hoyStr; }
    if (_entPeriodo === 'rango')  { return (!_entDesde || f >= _entDesde) && (!_entHasta || f <= _entHasta); }
    return true;
}
function setEntPeriodo(p) { _entPeriodo = p; renderVistaEntradas(); }
function setEntRango() {
    _entDesde = (document.getElementById('entDesde')||{}).value || '';
    _entHasta = (document.getElementById('entHasta')||{}).value || '';
    renderListadoEntradas();
}

// Miniaturas de evidencia (una o varias fotos del registro / lote): muestra hasta 3
// y "+N" si hay más. Cada una abre el visor. Compat: foto_url (una) o foto_urls (varias).
function _fotosThumbHTML(e) {
    var arr = (e && e.foto_urls && e.foto_urls.length) ? e.foto_urls : ((e && e.foto_url) ? [e.foto_url] : []);
    if (!arr.length) return '';
    var thumbs = arr.slice(0, 3).map(function(u){
        return '<img src="' + etx(u) + '" onclick="event.stopPropagation();etaaxVerFoto(this.src)" title="Ver evidencia" style="width:28px;height:28px;object-fit:cover;border-radius:5px;border:1px solid var(--border);cursor:zoom-in;flex-shrink:0">';
    }).join('');
    var more = arr.length > 3 ? '<span style="font-size:10px;color:var(--text-dim);align-self:center">+' + (arr.length - 3) + '</span>' : '';
    return '<span style="display:inline-flex;gap:3px;align-items:center">' + thumbs + more + '</span>';
}

function renderListadoEntradas() {
    const cont = document.getElementById('entLogList');
    if (!cont) return;
    // Use inventory-specific log when active, global log otherwise
    let log, useGlobal;
    if (invActual) {
        log = invActual.entradasLog || [];
        useGlobal = false;
    } else {
        log = [...getEntradasLog()].filter(function(e){ return e && !e.borrada && _entEnPeriodo(e.fecha); }).reverse();
        useGlobal = true;
    }
    const countEl = document.getElementById('entLogCount');
    if (countEl) countEl.textContent = log.length + ' registro' + (log.length !== 1 ? 's' : '');
    if (!log.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:24px 0">
            Sin entradas registradas</div>`;
        return;
    }
    // Asegurar id estable en cada entrada (las de inventario no lo traían) → borrar/editar por id.
    const fuente = invActual ? (invActual.entradasLog || []) : getEntradasLog();
    let _ch = false;
    fuente.forEach(e => { if (e && !e.id) { e.id = genId() + genId(); _ch = true; } });
    if (_ch) { if (invActual) { guardarEntradas(); } else { _guardarELLocal(); } }

    const rows = useGlobal ? log : [...log].reverse();
    // Independencia por sucursal (BLINDADO): el "Historial global" es global en el TIEMPO,
    // pero SOLO de la sucursal activa — cada sucursal trabaja aislada. Antes las entradas
    // SIN sucursalId (QR sin sello / legacy) se colaban a TODAS las sucursales → parecía
    // global del negocio. Ahora, en una sucursal específica se muestran EXCLUSIVAMENTE las
    // de esa sucursal (las sin sello quedan solo en la vista matriz). Dentro de un inventario
    // (Paso 2) no se filtra: sus entradas ya están acotadas a él (y no llevan sucursalId).
    const _sucHist = _sucActiva();
    const visibles = rows.filter(function(e){
        if (!e) return false;                        // excluir null/undefined (reventaba el render)
        if (!useGlobal) return true;                 // dentro del inventario → ya acotadas
        if (!_sucHist) return true;                  // matriz / sin sucursal → historial global real
        return (e.sucursalId || '') === _sucHist;    // sucursal específica → SOLO sus entradas
    });
    var _sucNomH = '';
    try {
        var _ssH = JSON.parse(localStorage.getItem('etaax_' + getNegocioActivo() + '_sucursales') || '[]');
        var _fH = _ssH.find(function(x){ return x.id === _sucHist; });
        _sucNomH = _fH ? (_fH.nombre || '') : '';
    } catch(err) {}
    const rowHTML = (e) => {
        const color   = tipoEntradaColor(e.tipo);
        const nombre  = etx(e.nombreProducto || e.nombre || '—');
        const cant    = (e.cantidad||0) % 1 ? (e.cantidad||0).toFixed(1) : (e.cantidad||0);
        // MERMA del QR: se muestra distinta (badge rojo, cantidad negativa, área);
        // NO entra al stock del inventario — es log/auditoría del turno.
const fotoTh = _fotosThumbHTML(e);
        if (e.concepto === 'merma') {
            const areaTx = e.area ? ' · ' + etx(e.area) : '';
            const motivo = { se_rompio:'se rompió', se_derramo:'se derramó', mal_preparado:'mal preparado', caducado:'caducado', otro:'otro' }[e.motivo] || '';
            return `<div class="ent-log-fila">
                <span class="ent-log-nombre">${nombre}${e.mermaTipo === 'producto' ? ' <span style="font-size:9px;color:var(--text-dim)">🍹 producto</span>' : ''}${motivo ? ' <span style="font-size:10px;color:var(--text-dim)">· ' + motivo + '</span>' : ''}</span>
                <span class="ent-log-badge" style="color:var(--red);background:rgba(224,90,58,.12);border-color:rgba(224,90,58,.4)">Merma${areaTx}</span>
                <span class="ent-log-fecha">${e.fecha || '—'}</span>
                <span class="ent-log-cant" style="color:var(--red)">−${cant} ${etx(e.unidad || 'pza')}</span>
                ${fotoTh}
                <button class="ent-log-del" title="Eliminar" onclick="eliminarEntradaPorId('${e.id}')">🗑️</button>
            </div>`;
        }
        if (e.concepto === 'salida') {
            const areaTx = e.area ? ' · ' + etx(e.area) : '';
            const esPrest = e.salidaTipo === 'prestamo';
            const lbl = esPrest ? '🔁 Préstamo' : '🎁 Cortesía';
            const notaTx = e.notas ? ' <span style="font-size:10px;color:var(--text-dim)">· ' + etx(e.notas) + '</span>' : '';
            return `<div class="ent-log-fila">
                <span class="ent-log-nombre">${nombre}${notaTx}</span>
                <span class="ent-log-badge" style="color:#9b7fe0;background:rgba(124,95,211,.12);border-color:rgba(124,95,211,.4)">${lbl}${areaTx}</span>
                <span class="ent-log-fecha">${e.fecha || '—'}</span>
                <span class="ent-log-cant" style="color:#9b7fe0">−${cant} ${etx(e.unidad || 'pza')}</span>
                ${fotoTh}
                <button class="ent-log-del" title="Eliminar" onclick="eliminarEntradaPorId('${e.id}')">🗑️</button>
            </div>`;
        }
        if (_entEditId === e.id) {
            return `<div class="ent-log-fila" style="gap:8px;flex-wrap:wrap">
                <span class="ent-log-nombre">${nombre}</span>
                <input id="entEdCant" type="text" inputmode="decimal" value="${cant}" oninput="this.value=this.value.replace(/[^0-9.]/g,'')"
                    style="width:70px;background:var(--surface2);border:1px solid var(--accent);color:var(--text);border-radius:6px;padding:5px 8px;font-size:13px;text-align:center">
                <input id="entEdFecha" type="date" value="${e.fecha||''}"
                    style="background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:13px">
                <button class="ent-log-del" style="color:var(--green)" onclick="guardarEdicionEntrada('${e.id}')">✓</button>
                <button class="ent-log-del" onclick="_entEditId=null;renderListadoEntradas()">✕</button>
            </div>`;
        }
        return `<div class="ent-log-fila">
            <span class="ent-log-nombre">${nombre}</span>
            <span class="ent-log-badge" style="color:${color};background:${color}1a;border-color:${color}50">${tipoEntradaLabel(e.tipo)}</span>
            <span class="ent-log-fecha">${e.fecha || '—'}</span>
            <span class="ent-log-cant">+${cant} ${_unidadCompra(e)}</span>
            ${fotoTh}
            <button class="ent-log-del" title="Editar" onclick="_entEditId='${e.id}';renderListadoEntradas()">✏️</button>
            <button class="ent-log-del" title="Eliminar" onclick="eliminarEntradaPorId('${e.id}')"
                onmouseenter="this.classList.add('hover')" onmouseleave="this.classList.remove('hover')">🗑️</button>
        </div>`;
    };
    // Mapeo SEGURO: si una entrada trae datos raros y rowHTML lanza, esa fila muestra
    // "(error)" pero las demás SÍ se ven (antes un throw dejaba la lista entera en blanco).
    const _safeRow = (e) => { try { return rowHTML(e); } catch (err) {
        console.warn('[entrada rota]', err, e);
        return `<div class="ent-log-fila"><span class="ent-log-nombre">${etx((e && (e.nombreProducto || e.nombre)) || '—')}</span><span class="ent-log-cant" style="color:var(--red)">(dato inválido)</span></div>`;
    } };
    // BLINDAJE: TODO el armado de secciones va en try/catch. Si algo revienta (un dato
    // raro que no habíamos previsto), en vez de dejar la lista EN BLANCO se cae a un
    // listado plano con _safeRow — así las entradas SIEMPRE se ven.
    try {
        const secHdr = t => `<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim);margin:14px 2px 8px">${t}</div>`;
        // Tres secciones: 📦 Entradas, 🗑️ Mermas y 🎁 Cortesías/Préstamos (listas distintas)
        const entradasArr = visibles.filter(e => e && e.concepto !== 'merma' && e.concepto !== 'salida');
        const mermasArr   = visibles.filter(e => e && e.concepto === 'merma');
        const salidasArr  = visibles.filter(e => e && e.concepto === 'salida');
        if (countEl) countEl.textContent = entradasArr.length + ' entrada' + (entradasArr.length !== 1 ? 's' : '') +
            ' · ' + mermasArr.length + ' merma' + (mermasArr.length !== 1 ? 's' : '') +
            (salidasArr.length ? ' · ' + salidasArr.length + ' cortesía/préstamo' + (salidasArr.length !== 1 ? 's' : '') : '') +
            (_sucNomH ? ' · ' + _sucNomH : '');
        cont.innerHTML =
            (entradasArr.length ? secHdr('📦 Entradas' + (_sucNomH ? ' · ' + etx(_sucNomH) : '')) + entradasArr.map(_safeRow).join('') : '') +
            (mermasArr.length   ? secHdr('🗑️ Mermas'   + (_sucNomH ? ' · ' + etx(_sucNomH) : '')) + mermasArr.map(_safeRow).join('') : '') +
            (salidasArr.length  ? secHdr('🎁 Cortesías / Préstamos' + (_sucNomH ? ' · ' + etx(_sucNomH) : '')) + salidasArr.map(_safeRow).join('') : '') +
            (!visibles.length ? `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:24px 0">Sin registros de esta sucursal</div>` : '');
    } catch (err) {
        console.warn('[registro entradas] render por secciones falló, fallback plano:', err);
        if (countEl) countEl.textContent = visibles.length + ' registro' + (visibles.length !== 1 ? 's' : '');
        cont.innerHTML = visibles.length
            ? visibles.map(_safeRow).join('')
            : `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:24px 0">Sin registros de esta sucursal</div>`;
    }
}

var _entEditId = null;
function eliminarEntradaPorId(id) {
    _pedirClaveAdmin('Eliminar entrada', function() {
        if (invActual) {
            invActual.entradasLog = (invActual.entradasLog || []).filter(e => e.id !== id);
            guardarEntradas();
            // Si viene del log global (QR / manual del ERP), marcarla `borrada` para que
            // el import por periodo NO la vuelva a jalar. Flag explícito (no borramos el
            // registro: queda dormido en la nube, reversible — "nunca perder datos").
            var _g = getEntradasLog().find(function(x){ return x && x.id === id; });
            if (_g) { _g.borrada = true; _guardarELLocal(); try { _sbUpEL(_g); } catch(err){} }
        } else {
            var _g2 = getEntradasLog().find(function(x){ return x && x.id === id; });
            if (_g2) { _g2.borrada = true; _guardarELLocal(); try { _sbUpEL(_g2); } catch(err){} }
        }
        _entEditId = null;
        renderListadoEntradas();
    });
}
function guardarEdicionEntrada(id) {
    const cant  = parseFloat((document.getElementById('entEdCant')||{}).value) || 0;
    const fecha = (document.getElementById('entEdFecha')||{}).value || '';
    if (cant <= 0) { alert('La cantidad debe ser mayor a 0.'); return; }
    if (invActual) {
        const e = (invActual.entradasLog || []).find(x => x.id === id);
        if (e) { e.cantidad = cant; if (fecha) e.fecha = fecha; }
        guardarEntradas();
    } else {
        const arr = getEntradasLog();
        const e = arr.find(x => x.id === id);
        if (e) { e.cantidad = cant; if (fecha) e.fecha = fecha; _guardarELLocal(); try { _sbUpEL(e); } catch(err){} } // forzar sync (el diff no detecta updates)
    }
    _entEditId = null;
    renderListadoEntradas();
}
// Compat: viejos llamados
function eliminarEntradaGlobal(id) { eliminarEntradaPorId(id); }

function renderVistaEntradas() {
    const cont = document.getElementById('entContent');
    if (!cont) return;

    const tituloEl  = document.getElementById('entTitulo');
    const periodoEl = document.getElementById('entPeriodo');
    if (invActual) {
        if (tituloEl)  tituloEl.textContent = invActual.nombre || 'Registro de entradas';
        if (periodoEl) {
            const fecha = new Date(invActual.fecha + 'T12:00:00')
                .toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' });
            periodoEl.textContent = fecha
                + (invActual.turno ? ' · ' + invActual.turno : '')
                + (invActual.area  ? ' · ' + invActual.area  : '');
        }
    } else {
        if (tituloEl)  tituloEl.textContent = 'Registro de entradas';
        if (periodoEl) {
            var _sH = _sucActiva(), _snH = '';
            if (_sH) { try { var _ssH = JSON.parse(localStorage.getItem('etaax_' + getNegocioActivo() + '_sucursales') || '[]'); var _fH = _ssH.find(function(x){ return x.id === _sH; }); _snH = _fH ? (_fH.nombre || '') : ''; } catch(e) {} }
            periodoEl.textContent = _sH ? ('Historial · ' + (_snH || 'sucursal activa')) : 'Historial global · todas las sucursales';
        }
    }

    const searchSection = invActual ? `
        <div>
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Buscar producto</div>
            <input type="text" id="entBuscador" class="ent-buscador"
                placeholder="Escribe el nombre del producto…"
                oninput="buscarInsumoEntrada(this.value)" autocomplete="off">
            <div id="entChips" class="ent-chips"></div>
        </div>
        <div id="entFormCard"></div>` : '';

    const logLen = invActual ? (invActual.entradasLog||[]).length : getEntradasLog().length;
    const _perTab = (p, lbl) => `<button onclick="setEntPeriodo('${p}')" style="border:1px solid ${_entPeriodo===p?'var(--accent)':'var(--border)'};background:${_entPeriodo===p?'rgba(245,200,66,.12)':'transparent'};color:${_entPeriodo===p?'var(--accent)':'var(--text-muted)'};border-radius:20px;padding:5px 14px;font-family:inherit;font-size:12px;cursor:pointer;font-weight:${_entPeriodo===p?'700':'500'}">${lbl}</button>`;
    const _inpDate = 'background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px';
    const filtroFechas = invActual ? '' : `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
            ${_perTab('todos','Todas')}${_perTab('dia','Hoy')}${_perTab('semana','Semana')}${_perTab('mes','Mes')}${_perTab('rango','Rango')}
            ${_entPeriodo==='rango' ? `<input type="date" id="entDesde" value="${_entDesde}" onchange="setEntRango()" style="${_inpDate}">
                <span style="color:var(--text-dim);font-size:12px">a</span>
                <input type="date" id="entHasta" value="${_entHasta}" onchange="setEntRango()" style="${_inpDate}">` : ''}
        </div>`;
    cont.innerHTML = `
        <div class="ent-rapida-wrap">
            ${searchSection}
            <div>
                ${filtroFechas}
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                    <span style="font-size:11px;color:var(--text-dim);font-weight:500;text-transform:uppercase;letter-spacing:0.5px">
                        ${invActual ? 'Entradas del período' : 'Historial de entradas'}
                    </span>
                    <span id="entLogCount" style="font-size:13px;font-weight:700;color:var(--text)">${logLen} registro${logLen !== 1 ? 's' : ''}</span>
                </div>
                <div id="entLogList"></div>
            </div>
        </div>`;

    if (invActual) initEntradaRapidaUI();
    else renderListadoEntradas();
}

function guardarEntradas() {
    if (!invActual) return;
    invActual.filas = filasCaptura.map(f => ({...f, existenciaFisica: calcExistencia(f)}));
    const lista = getInventarios();
    const idx   = lista.findIndex(x => x.id === invActual.id);
    if (idx >= 0) lista[idx] = invActual; else lista.push(invActual);
    setInventarios(lista);
    // FORZAR el upsert a la nube: lista[idx] === invActual (misma referencia mutada en
    // el lugar) → el diff de setInventarios NO lo detecta y solo guardaba en localStorage.
    // Era la raíz de "en el ERP sí aparece la entrada pero en el inventario no persiste".
    try { _sbUpInv(invActual); } catch(e) { console.warn('[guardarEntradas upsert]', e); }

    const btn = document.getElementById('btnGuardarEntradas');
    if (btn) {
        const orig = btn.textContent;
        btn.textContent    = '✅ Guardado';
        btn.style.color    = 'var(--green)';
        btn.style.borderColor = 'var(--green)';
        setTimeout(() => {
            btn.textContent = orig;
            btn.style.color = '';
            btn.style.borderColor = '';
        }, 2000);
    }
}

// ═══════════════════════════════════════════════════════════════
// FICHA TÉCNICA — modal ver / editar insumo
// ═══════════════════════════════════════════════════════════════
let _ftModo = 'ver'; // 'ver' | 'editar'

function _ftSetFooter(modo) {
    const footer = document.getElementById('ftFooter');
    const lbl    = document.getElementById('ftModoLabel');
    if (!footer) return;
    if (modo === 'ver') {
        if (lbl) lbl.textContent = 'Ficha técnica';
        footer.innerHTML = `
            <button onclick="cerrarFichaTecnica()" class="btn-vista">Cerrar</button>
            <button onclick="abrirFichaEditar()" class="btn-vista"
                style="color:var(--accent);border-color:var(--accent)">✏️ Editar</button>`;
    } else {
        if (lbl) lbl.textContent = 'Editando insumo';
        footer.innerHTML = `
            <button onclick="cancelarFichaEditar()" class="btn-vista">Cancelar edición</button>
            <button id="btnFtGuardar" onclick="guardarFichaTecnica()" class="btn-vista"
                style="color:var(--green);border-color:var(--green)">💾 Guardar cambios</button>`;
    }
}

function abrirFichaTecnica(insumoId) {
    _ftInsumoId = insumoId;
    _ftModo     = 'ver';
    const ins   = getInsumos().find(i => i.id === insumoId);
    if (!ins) return;
    const modal = document.getElementById('modalFichaTecnica');
    if (!modal) return;
    modal.style.display = 'flex';
    _ftRenderVer(ins);
    _ftSetFooter('ver');
}

function _ftRenderVer(ins) {
    document.getElementById('ftNombre').textContent = insumoTitulo(ins);
    const pres = ins.presentaciones || [];
    document.getElementById('ftBody').innerHTML = `
        <div style="display:flex;gap:16px;align-items:flex-start;
            padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:4px">
            <div style="width:80px;height:80px;background:var(--surface);border-radius:8px;
                border:1px solid var(--border);overflow:hidden;flex-shrink:0;
                display:flex;align-items:center;justify-content:center;font-size:26px;color:var(--text-dim)">
                ${ins.foto ? `<img src="${etx(ins.foto)}" style="width:100%;height:100%;object-fit:cover">` : '📦'}
            </div>
            <div style="flex:1">
                <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;
                    color:var(--accent);margin-bottom:4px">
                    ${[ins.familia, ins.categoria, ins.subcategoria].filter(Boolean).join(' · ')}
                </div>
                <div style="font-size:20px;font-weight:600;color:var(--text);margin-bottom:3px">${etx(insumoTitulo(ins))}</div>
                <div style="font-size:12px;color:var(--text-muted)">
                    ${insumoMetaHTML(ins)}
                </div>
            </div>
            <span class="pill ${ins.activo==='1'?'pill-amber':'pill-red'}" style="flex-shrink:0">
                ${ins.activo==='1'?'Activo':'Inactivo'}
            </span>
        </div>

        <div class="ft-section-title">Presentaciones</div>

        ${pres.length ? pres.map(p => `
            <div class="ft-pres-card">
                <div class="ft-pres-top">
                    <div>
                        <span style="font-size:15px;font-weight:500;color:var(--text)">${p.contNeto||'—'} ${p.umContenido||''}</span>
                        ${p.pesoUnidad  ? `<span style="font-size:11px;color:var(--text-dim);margin-left:8px">· ${p.pesoUnidad} ${p.umPeso||'G'} llena</span>` : ''}
                        ${p.pesoCristal ? `<span style="font-size:11px;color:var(--text-dim);margin-left:4px">· cristal ${p.pesoCristal}g</span>` : ''}
                    </div>
                    <div style="text-align:right">
                        ${p.precio ? `<div style="font-size:16px;font-weight:600;color:var(--text)">$${(+p.precio).toFixed(2)}</div>
                            <div style="font-size:10px;color:var(--text-dim);margin-top:1px">precio de compra</div>` : ''}
                        ${p.costoUnitario ? `<div style="font-size:12px;font-weight:500;color:var(--green);margin-top:4px">
                            $${(+p.costoUnitario).toFixed(2)} / ${p.umCosto||'LT'}</div>` : ''}
                    </div>
                </div>
                <div class="ft-pres-info">
                    ${p.rendimiento    ? `<span style="font-size:12px;font-weight:500;color:var(--accent)">🥃 ${p.rendimiento} ${p.umRendimiento||'OZ'} por botella</span>` : ''}
                    ${p.proveedor     ? `<span style="font-size:11px;color:var(--text-muted)">🏪 ${p.proveedor}</span>` : ''}
                    ${p.zona          ? `<span style="font-size:11px;color:var(--text-muted)">📍 ${p.zona}</span>` : ''}
                    ${p.marcaComercial? `<span style="font-size:11px;color:var(--text-muted)">🏷️ ${p.marcaComercial}</span>` : ''}
                    ${p.incluyeImpuesto==='1' ? `<span style="font-size:11px;color:var(--accent)">IVA incluido</span>` : ''}
                </div>
                ${(p.precioCarta||p.precioCartaBot||p.stockMin||p.stockMax) ? `
                <div class="ft-pres-precios">
                    ${p.precioCarta    ? `<span style="font-size:12px;color:var(--green)">Copa: $${(+p.precioCarta).toFixed(2)}</span>` : ''}
                    ${p.precioCartaBot ? `<span style="font-size:12px;color:var(--green)">Botella: $${(+p.precioCartaBot).toFixed(2)}</span>` : ''}
                    ${p.stockMin ? `<span style="font-size:11px;color:var(--text-dim)">Stock min: ${p.stockMin}</span>` : ''}
                    ${p.stockMax ? `<span style="font-size:11px;color:var(--text-dim)">Stock max: ${p.stockMax}</span>` : ''}
                </div>` : ''}
                ${p.notas ? `<div style="font-size:11px;color:var(--text-dim);margin-top:6px">${p.notas}</div>` : ''}
            </div>`).join('')
        : '<div style="color:var(--text-dim);font-size:13px">Sin presentaciones registradas</div>'}

        ${ins.notas ? `
            <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
                <div class="ft-section-title" style="margin-top:0">Notas</div>
                <p style="font-size:13px;color:var(--text-muted);line-height:1.7;margin:0">${ins.notas}</p>
            </div>` : ''}`;
}

function _ftRenderEditar(ins) {
    document.getElementById('ftNombre').textContent = insumoTitulo(ins);
    const p = (ins.presentaciones || [])[0] || {};
    document.getElementById('ftBody').innerHTML = `
        <div class="ft-grid">
            <div><label class="ft-lbl">Nombre</label><input id="ft_nombre" class="ft-input" value="${(ins.nombre||'').replace(/"/g,'&quot;')}"></div>
            <div><label class="ft-lbl">Variedad</label><input id="ft_variedad" class="ft-input" placeholder="Lo que lo distingue. Ej. Ten, 7 años, Espadín" value="${(ins.variedad||'').replace(/"/g,'&quot;')}"></div>
            <div><label class="ft-lbl">Familia</label><input id="ft_familia" class="ft-input" value="${(ins.familia||'').replace(/"/g,'&quot;')}"></div>
            <div><label class="ft-lbl">Categoría</label><input id="ft_categoria" class="ft-input" value="${(ins.categoria||'').replace(/"/g,'&quot;')}"></div>
            <div><label class="ft-lbl">Subcategoría</label><input id="ft_subcategoria" class="ft-input" value="${(ins.subcategoria||'').replace(/"/g,'&quot;')}"></div>
            <div><label class="ft-lbl">Stock mínimo</label><input id="ft_stockMin" type="number" class="ft-input" value="${ins.stockMin||0}" min="0"></div>
        </div>
        <div class="ft-section-title">Presentación principal</div>
        <div class="ft-grid">
            <div>
                <label class="ft-lbl">Contenido neto</label>
                <div style="display:flex;gap:6px">
                    <input id="ft_contNeto" type="number" class="ft-input" value="${p.contNeto||''}" min="0" step="0.01" style="flex:1">
                    <select id="ft_umContenido" class="ft-input" style="width:72px">
                        <option value="ML" ${(p.umContenido||'ML')==='ML'?'selected':''}>ML</option>
                        <option value="LT" ${p.umContenido==='LT'?'selected':''}>LT</option>
                    </select>
                </div>
            </div>
            <div><label class="ft-lbl">Peso cristal (g)</label><input id="ft_pesoCristal" type="number" class="ft-input" value="${p.pesoCristal||''}" min="0" step="0.1"></div>
            <div><label class="ft-lbl">Precio compra $</label><input id="ft_precio" type="number" class="ft-input" value="${p.precio||''}" min="0" step="0.01"></div>
            <div><label class="ft-lbl">Costo unitario $</label><input id="ft_costoUnitario" type="number" class="ft-input" value="${p.costoUnitario||''}" min="0" step="0.01"></div>
            <div><label class="ft-lbl">Copa en carta $</label><input id="ft_precioCarta" type="number" class="ft-input" value="${p.precioCarta||''}" min="0" step="0.01"></div>
            <div><label class="ft-lbl">Botella en carta $</label><input id="ft_precioCartaBot" type="number" class="ft-input" value="${p.precioCartaBot||''}" min="0" step="0.01"></div>
            <div>
                <label class="ft-lbl">Tamaño copa</label>
                <div style="display:flex;gap:6px">
                    <input id="ft_tamanoCopa" type="number" class="ft-input" value="${ins.tamanoCopa||''}" min="0" step="0.01" style="flex:1">
                    <select id="ft_umTamanoCopa" class="ft-input" style="width:72px">
                        <option value="ML" ${(ins.umTamanoCopa||'ML')==='ML'?'selected':''}>ML</option>
                        <option value="OZ" ${ins.umTamanoCopa==='OZ'?'selected':''}>OZ</option>
                    </select>
                </div>
            </div>
            <div>
                <label class="ft-lbl">Rendimiento</label>
                <div style="display:flex;gap:6px">
                    <input id="ft_rendimiento" type="number" class="ft-input" value="${p.rendimiento||''}" min="0" step="0.01" style="flex:1">
                    <select id="ft_umRendimiento" class="ft-input" style="width:72px">
                        <option value="OZ" ${(p.umRendimiento||'OZ')==='OZ'?'selected':''}>OZ</option>
                        <option value="ML" ${p.umRendimiento==='ML'?'selected':''}>ML</option>
                    </select>
                </div>
            </div>
        </div>
        <div class="ft-section-title">Notas del producto</div>
        <textarea id="ft_notas" class="ft-input" rows="3"
            style="height:auto;padding:10px;resize:vertical;line-height:1.5">${ins.notas||''}</textarea>`;
}

function abrirFichaEditar() {
    _ftModo = 'editar';
    const ins = getInsumos().find(i => i.id === _ftInsumoId);
    if (!ins) return;
    _ftRenderEditar(ins);
    _ftSetFooter('editar');
}

function cancelarFichaEditar() {
    _ftModo = 'ver';
    const ins = getInsumos().find(i => i.id === _ftInsumoId);
    if (!ins) return;
    _ftRenderVer(ins);
    _ftSetFooter('ver');
}

function cerrarFichaTecnica() {
    const modal = document.getElementById('modalFichaTecnica');
    if (modal) modal.style.display = 'none';
    _ftInsumoId = null;
    _ftModo     = 'ver';
}

function guardarFichaTecnica() {
    if (!_ftInsumoId) return;
    const lista = getInsumos();
    const ins   = lista.find(i => i.id === _ftInsumoId);
    if (!ins) return;
    ins.nombre       = document.getElementById('ft_nombre')?.value.trim()      || ins.nombre;
    ins.variedad     = document.getElementById('ft_variedad')?.value.trim()    || '';
    ins.familia      = document.getElementById('ft_familia')?.value.trim()     || '';
    ins.categoria    = document.getElementById('ft_categoria')?.value.trim()   || '';
    ins.subcategoria = document.getElementById('ft_subcategoria')?.value.trim()|| '';
    ins.stockMin     = parseFloat(document.getElementById('ft_stockMin')?.value)|| 0;
    ins.tamanoCopa   = document.getElementById('ft_tamanoCopa')?.value          || '';
    ins.umTamanoCopa = document.getElementById('ft_umTamanoCopa')?.value        || 'ML';
    ins.notas        = document.getElementById('ft_notas')?.value.trim()        || '';
    if (!ins.presentaciones || !ins.presentaciones.length) ins.presentaciones = [{}];
    const p             = ins.presentaciones[0];
    p.contNeto          = parseFloat(document.getElementById('ft_contNeto')?.value)       || p.contNeto;
    p.umContenido       = document.getElementById('ft_umContenido')?.value                || 'ML';
    p.pesoCristal       = parseFloat(document.getElementById('ft_pesoCristal')?.value)    || 0;
    p.precio            = parseFloat(document.getElementById('ft_precio')?.value)         || p.precio || 0;
    p.costoUnitario     = parseFloat(document.getElementById('ft_costoUnitario')?.value)  || 0;
    p.precioCarta       = parseFloat(document.getElementById('ft_precioCarta')?.value)    || 0;
    p.precioCartaBot    = parseFloat(document.getElementById('ft_precioCartaBot')?.value) || 0;
    p.rendimiento       = document.getElementById('ft_rendimiento')?.value                || p.rendimiento || '';
    p.umRendimiento     = document.getElementById('ft_umRendimiento')?.value              || 'OZ';
    try { localStorage.setItem(_sk('insumos'), JSON.stringify(lista)); } catch(e) {}
    // Sync fila en inventario activo
    const fila = filasCaptura.find(f => f.insumoId === _ftInsumoId);
    if (fila) {
        fila.nombre         = ins.nombre + (ins.variedad ? ' ' + ins.variedad : '');
        fila.categoria      = ins.categoria    || '';
        fila.subcategoria   = ins.subcategoria || '';
        fila.familia        = ins.familia      || '';
        fila.pesoCristal    = p.pesoCristal    || 0;
        fila.contNeto       = (p.umContenido||'ML').toUpperCase()==='LT' ? (p.contNeto||0)*1000 : (p.contNeto||0);
        fila.costoUnitario  = p.costoUnitario  || p.precio || 0;
        fila.precioCarta    = p.precioCarta    || 0;
        fila.precioCartaBot = p.precioCartaBot || 0;
    }
    // Volver a vista después de guardar
    _ftModo = 'ver';
    _ftRenderVer(ins);
    _ftSetFooter('ver');
}

// ── Init ──────────────────────────────────────────────────────
function init() { _limpiarStorageEmergencia(); _mergeDraftsLocal(); _mergeELLocal(); renderStats(); renderHistorial(); }
// OJO: init() se llama AL FINAL del archivo, DESPUÉS de registrar los guardias de
// navegación. Así, si init() llegara a fallar, los guardias ya quedaron activos.

// ── Bloqueo de navegación mientras haya un inventario abierto ──
let _pendingNavHref = null;
let _pendingSalirFn = null; // acción de salida (ej. ctxSalir) a ejecutar tras el card

// El botón "Salir" de la barra superior (ctxSalir) navega por JS y se saltaba el card.
// Lo envolvemos: si hay inventario en curso, muestra el card en vez de salir directo.
document.addEventListener('DOMContentLoaded', function(){
    if (typeof window.ctxSalir === 'function' && !window._ctxSalirWrapInv) {
        window._ctxSalirWrapInv = true;
        var _orig = window.ctxSalir;
        window.ctxSalir = function(){
            if (_estaEnWizard()) { _pendingSalirFn = _orig; document.getElementById('modalSalirInv').style.display = 'flex'; return; }
            return _orig.apply(this, arguments);
        };
    }
});

// Hay un inventario ABIERTO en edición → cualquier salida pide el card.
// Fuente de verdad SIMPLE: invActual existe y no está cerrado. (En el historial
// invActual es null o el inventario está cerrado → no bloquea.)
function _estaEnWizard() {
    return !!invActual && !invActual.cerrado;
}
// Abrir el card de salida (botón "Salir"): sin destino → al historial.
function pedirSalirInv() {
    _pendingNavHref = null; _pendingSalirFn = null;
    var m = document.getElementById('modalSalirInv');
    if (m) m.style.display = 'flex';
}

function _cancelarSalirInv() {
    _pendingNavHref = null; _pendingSalirFn = null;
    document.getElementById('modalSalirInv').style.display = 'none';
}

function _confirmarSalirInv() {
    try { guardarInventario(); } catch(e) { console.warn('[confirmarSalirInv] guardar error:', e); }
    invActual = null;
    const href = _pendingNavHref, fn = _pendingSalirFn;
    _pendingNavHref = null; _pendingSalirFn = null;
    const modal = document.getElementById('modalSalirInv');
    if (modal) modal.style.display = 'none';
    if (fn) { fn(); return; }
    if (href) { window.location.href = href; }
    else { mostrarVista('vistaLista'); }
}

function _salirSinGuardarInv() {
    // Sale sin forzar un guardado final. (El inventario autoguarda mientras capturas,
    // así que esto omite el guardado explícito; lo ya capturado permanece como respaldo.)
    invActual = null;
    const href = _pendingNavHref, fn = _pendingSalirFn;
    _pendingNavHref = null; _pendingSalirFn = null;
    const modal = document.getElementById('modalSalirInv');
    if (modal) modal.style.display = 'none';
    if (fn) { fn(); return; }
    if (href) { window.location.href = href; }
    else { mostrarVista('vistaLista'); }
}

document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href]');
    if (!link || !link.href || link.href.startsWith('javascript')) return;
    if (!_estaEnWizard()) return;
    e.preventDefault();
    e.stopPropagation();
    _pendingNavHref = link.href;
    document.getElementById('modalSalirInv').style.display = 'flex';
}, true);

window.addEventListener('beforeunload', function(e) {
    if (_estaEnWizard()) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// Render inicial AL FINAL — los guardias de navegación ya quedaron registrados arriba.
try { init(); } catch (e) { console.warn('[init]', e); }
