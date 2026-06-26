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

function getInsumos()     { return _cacheInsumosInv || (function(){ try { return JSON.parse(_skGet('insumos')) || []; } catch { return []; } }()); }
// Resolver para la etiqueta canónica (insumo-label.js): id → insumo del catálogo.
(function(){ var _ix=null,_n=-1; window._insumoResolver=function(id){ var a=getInsumos()||[]; if(!_ix||_n!==a.length){_ix={};a.forEach(function(x){if(x&&x.id)_ix[x.id]=x;});_n=a.length;} return _ix[id]||null; }; })();
// Insumos acotados a la SUCURSAL activa (regla "sin sucursal = matriz: ve todo").
// Sin esto, el inventario leía los insumos de TODAS las sucursales y los duplicaba.
function _scopeSucInsumos(lista) {
    const s = localStorage.getItem('etaax_sucursal_activa') || '';
    if (!s) return lista || [];
    return (lista || []).filter(x => (x && (x.sucursalId || 'suc_principal')) === s);
}
// Inventarios de la SUCURSAL activa (independientes por sucursal). "Sin sucursal = ve todo".
function _scopeSucInvs(lista) {
    const s = localStorage.getItem('etaax_sucursal_activa') || '';
    if (!s) return lista || [];
    return (lista || []).filter(x => (x && (x.sucursalId || 'suc_principal')) === s);
}
function getRecetas()     { return _cacheRecetasInv || []; }
function getInventarios() { return _cacheInv || []; }
function getEntradasLog() { return _cacheEL || []; }

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
    if (!r[0].error) { _cacheInv = (r[0].data || []).map(function(x){ return x.datos; }); _marcarSynced(_cacheInv.map(function(c){ return c && c.id; })); }
    _mergeDraftsLocal(); // recuperar borradores que aún no sincronizaron a la nube
    if (!r[1].error) _cacheEL   = (r[1].data || []).map(function(x){ return x.datos; });
    _mergeELLocal(); // recuperar entradas que aún no sincronizaron a la nube
    if (!r[2].error) _cacheRecetasInv = (r[2].data || []).map(function(x){ return x.datos; });
    if (!r[3].error) {
        _cacheInsumosInv = (r[3].data || []).map(function(x){ return x.datos; });
        // actualizar localStorage para compatibilidad con insumos.js
        try { localStorage.setItem(_sk('insumos'), JSON.stringify(_cacheInsumosInv.map(function(ins){ var c=Object.assign({},ins); c.foto=''; c.fotoUrl=''; return c; }))); } catch(e) {}
    }
    if (typeof init === 'function') init();
    _subInvRealtime(negId);
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
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const TIPOS_ICON = { primer_lev:'📋', bebidas:'🍸', alimentos:'🍽️', almacen:'📦', restaurante:'🏪', otro:'📋' };

// ── Helpers matemáticos ───────────────────────────────────────
function ingredienteML(cantidad, unidad) {
    const u = (unidad || 'ML').toUpperCase();
    if (u === 'OZ') return cantidad * OZ_ML;
    if (u === 'LT') return cantidad * 1000;
    return cantidad;
}

// Inventario cerrado que se toma como referencia para la "existencia anterior".
// Por defecto el último cerrado; el usuario puede elegir otro (invActual.refInventarioId).
function _getRefInv() {
    const cerrados = _scopeSucInvs(getInventarios()).filter(x => x.cerrado && (!invActual || x.id !== invActual.id));
    if (!cerrados.length) return null;
    if (invActual && invActual.refInventarioId) {
        const r = cerrados.find(x => x.id === invActual.refInventarioId);
        if (r) return r;
    }
    return cerrados[cerrados.length - 1];
}
function getExistenciaAnterior(insumoId) {
    const inv = _getRefInv();
    if (!inv) return 0;
    const fila = (inv.filas || []).find(f => f.insumoId === insumoId);
    if (!fila) return 0;
    return fila.existenciaFisica !== undefined ? fila.existenciaFisica : calcExistencia(fila);
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
    var cerrados = _scopeSucInvs(getInventarios()).filter(function(x){ return x && x.cerrado && (!invActual || x.id !== invActual.id); });
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

function calcVentasCopasRecetas(insumoId, copaML) {
    if (!copaML || copaML <= 0) return 0;
    const recetas  = getRecetas().filter(r => r.tipo === 'bebidas');
    const vendidos = (invActual && invActual.cocktailsVendidos) || {};
    let total = 0;
    recetas.forEach(r => {
        const uds = parseFloat(vendidos[r.id]) || 0;
        if (!uds) return;
        (r.ingredientes || []).forEach(ing => {
            if (ing.insumoId === insumoId)
                total += (ingredienteML(parseFloat(ing.cantidad)||0, ing.unidad) * uds) / copaML;
        });
    });
    return total;
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
    const recetas  = getRecetas().filter(r => r.tipo === 'alimentos' && r.status !== 'inactiva');
    const vendidos = (invActual && invActual.cocktailsVendidos) || {};
    let total = 0;
    recetas.forEach(r => {
        const uds = parseFloat(vendidos[r.id]) || 0;
        if (!uds) return;
        (r.ingredientes || []).forEach(ing => {
            if (ing.insumoId === insumoId)
                total += ingredienteBase(parseFloat(ing.cantidad) || 0, ing.unidad) * uds;
        });
    });
    return total; // g / ml / pza
}

// ── PREBATCH: producción de batches (sub-receta→insumo) ──────────
// Insumos prebatch disponibles = sub-recetas convertidas a insumo.
function prebatchesProducibles() {
    return _scopeSucInsumos(getInsumos()).filter(function(x){ return x.esSubReceta && x.recetaId; });
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
    if (fila.tipo === 'copa') return n * (fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0); // batches→copas
    if (fila.tipo === 'peso') return n * (fila.contNeto || 0); // batches→unidad base
    return n; // pza: 1 batch = 1 pza
}
// Consumo de ESTE insumo base por la producción de batches, en la unidad de su fila.
function _consumoBaseProd(fila) {
    var u = consumoBasesPorProduccion(fila.insumoId); // ml / g / pza base
    if (!u) return 0;
    if (fila.tipo === 'copa') return fila.copaML > 0 ? u / fila.copaML : 0; // base ml → copas
    return u; // peso (g/ml) y pza: directo
}

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

function _autoMatchCancelaciones() {
    (invActual?.cancelaciones || []).forEach(c => {
        if (!c.insumoId) {
            const m = _matchInsumo(c.nombreProducto);
            if (m) { c.insumoId = m.insumoId; c.insumoNombre = m.nombre; }
        }
    });
}

function getCancelacionesCopas(insumoId) {
    _autoMatchCancelaciones();
    const fila = filasCaptura.find(f => f.insumoId === insumoId);
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
    if (fila.tipo === 'pza') return ea + entTotal + prodAdd - (fila.ventasBotella || 0) - prodSub;
    return ea + entTotal + prodAdd - totalCopas - prodSub - (fila.ventasBotella || 0) * (fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0);
}

function getEntradasBottles(insumoId) {
    const fila    = filasCaptura.find(f => f.insumoId === insumoId);
    const deFilas = fila ? (fila.entradas || []).reduce((s, e) => s + (parseFloat(e)||0), 0) : 0;
    const deLog   = (invActual?.entradasLog || [])
        .filter(e => e.insumoId === insumoId)
        .reduce((s, e) => s + (parseFloat(e.cantidad)||0), 0);
    return deFilas + deLog;
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
    var umP = (p && (p.umPresCompra || '')).toString().toUpperCase();
    if (umP === 'LT')  return 'L';
    if (umP === 'ML')  return 'ml';
    if (umP === 'KG')  return 'kg';
    if (umP === 'G' || umP === 'GR') return 'g';
    // 2) Se compra por pieza/contenedor → usar el empaque que ve el usuario (Garrafa, Botella, Lata…).
    var emp = (ins && (ins.empaque || '')).toString().toLowerCase();
    if (emp.indexOf('garrafa') >= 0) return 'garrafa';
    if (emp.indexOf('botella') >= 0) return 'bot';
    if (emp.indexOf('lata')    >= 0) return 'lata';
    if (emp.indexOf('barril')  >= 0) return 'barril';
    if (emp.indexOf('bolsa')   >= 0) return 'bolsa';
    if (emp.indexOf('caja')    >= 0) return 'caja';
    // 3) Presentación de compra (dropdown) como respaldo.
    var pc = (p && (p.presentacionCompra || '')).toString();
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

function semaforo(dif, ref) {
    if (!ref) return 'var(--text-dim)';
    const pct = Math.abs(dif / ref) * 100;
    return pct <= 25 ? 'var(--green)' : pct <= 50 ? 'var(--accent)' : 'var(--red)';
}

function costoCopa(fila) {
    const cu = fila.costoUnitario || 0;
    if (fila.tipo === 'peso') { const cn = fila.contNeto || 0; return cn > 0 ? cu / cn : cu; } // costo por unidad base
    if (fila.tipo === 'pza') return cu;
    return fila.copaML > 0 && cu > 0 ? cu * (fila.copaML / 1000) : cu;
}

function tipoIcon(tipo) { return TIPOS_ICON[tipo] || '📋'; }

function getFilasFiltradas(conRegistro = false) {
    const b = busquedaCapt.toLowerCase();
    return filasCaptura.filter(f =>
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
    window._invEditando = (id !== 'vistaLista') && !!invActual && !invActual.cerrado;
    if (id === 'vistaLista')    init();
    if (id === 'vistaEntradas') renderVistaEntradas();
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
        document.getElementById('statCapital').textContent = '$'+(ultimo.capitalCosto||0).toFixed(0);
        const dif = ultimo.diferenciaCosto || 0;
        const el  = document.getElementById('statDif');
        el.textContent = (dif>=0?'+':'')+'$'+Math.abs(dif).toFixed(0);
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
        if (!acc[c.id]) { acc[c.id] = { _comp:c, barraB:0, bodegaB:0, totalB:0, capBarra:0, capBodega:0, capital:0, fecha:'' }; out.push(acc[c.id]); }
        var fc = acc[c.id];
        fc.barraB += toBase(r.barra); fc.bodegaB += toBase(r.bodega); fc.totalB += toBase(r.total);
        fc.capBarra += r.capBarra; fc.capBodega += r.capBodega; fc.capital += r.capital;
        if ((r.fecha||'') > fc.fecha) fc.fecha = r.fecha;
    });
    return out.map(function(r){
        if (!r._comp) return r;
        var c = r._comp;
        var conv = function(b){ return c.unidad==='lt'||c.unidad==='kg' ? b/1000 : c.unidad==='botella' ? b/750 : b; };
        var totU = conv(r.totalB);
        return { insumoId:'_comp_'+c.id, nombre:c.nombre, familia:'🧩 Compuesto', tipo:'_comp', unidadComp:c.unidad,
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
    return '<div class="rd-sec">🧩 Productos compuestos (fusionados)</div>'+
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
        var o = porIns[id], f = o.fila, ins = insById[id];
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
        '<div style="font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:var(--text-dim);margin-top:3px">'+(_repFusion?'Reporte final (fusionado)':'Existencias por área')+' · '+etx(areaTxt)+(op?' · Operativa':'')+'</div></div>'+
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
    (inv.filas || []).forEach(function(f){
        if (!f || !f.insumoId) return;
        var ins = insById[f.insumoId];
        var cc = costoCopa(f);
        var barra = _existenciaArea(f, 'barra', ins);
        var bodega = _existenciaArea(f, 'bodega', ins);
        var total = calcExistencia(f);
        if (barra <= 0 && bodega <= 0 && total <= 0) return;
        var copasBot = (f.tipo === 'copa' && f.contNeto > 0 && f.copaML > 0) ? f.contNeto/f.copaML : 0;
        var costoCompra = f.tipo === 'copa' ? cc*copasBot : cc;
        rows.push({ nombre:f.nombre||'—', familia:f.familia||f.categoria||'Otros', tipo:f.tipo,
            copaML:f.copaML, contNeto:f.contNeto, baseUnit:f.baseUnit, barra:barra, bodega:bodega, total:total,
            costoUnit:costoCompra, capital:total*cc, capBarra:barra*cc, capBodega:bodega*cc });
    });
    return rows;
}
function verPreviewInventario(id) {
    var inv = getInventarios().find(function(x){ return x.id === id; });
    if (!inv) return;
    var rows = _rowsDeInventario(inv);
    rows.sort(function(a,b){ return b.total - a.total; });
    var capB = rows.reduce(function(s,r){ return s+r.capBarra; }, 0);
    var capBo= rows.reduce(function(s,r){ return s+r.capBodega; }, 0);
    var capT = rows.reduce(function(s,r){ return s+r.capital; }, 0);
    var negNom = (function(){ try { return (JSON.parse(localStorage.getItem('etaax_ctx')||'{}').negocio||{}).nombre || ''; } catch(e){ return ''; } })();
    var fechaInv = _repFecha(inv.fecha);
    var estado = inv.cerrado ? 'Cerrado' : 'Abierto';
    var html = '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px 12px;border-bottom:3px solid var(--green);margin-bottom:10px">'+
        '<div><div style="font-family:\'Bebas Neue\',sans-serif;font-size:24px;letter-spacing:1px;color:var(--text);line-height:1">'+etx(inv.nombre||negNom||'Inventario')+'</div>'+
        '<div style="font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:var(--text-dim);margin-top:3px">'+etx(negNom)+' · '+(inv.area||'general')+' · '+fechaInv+' · '+estado+'</div></div>'+
        '<div style="text-align:right"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:2px;color:var(--text)">ET<span style="color:var(--green)">AA</span>X</div>'+
        '<div style="font-size:9px;color:var(--text-dim);margin-top:2px">'+rows.length+' insumos</div></div></div>';
    function _chip(lbl,cap,col){ return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 16px;min-width:120px"><div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">'+lbl+'</div><div style="font-size:18px;font-weight:800;color:'+col+';margin-top:2px">'+_repMoney(cap)+'</div></div>'; }
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;padding:0 16px 10px">'+_chip('📍 Barra',capB,'var(--accent)')+_chip('📍 Bodega',capBo,'var(--accent)')+
        '<div style="background:rgba(61,190,122,.12);border:1px solid rgba(61,190,122,.35);border-radius:10px;padding:10px 16px;min-width:120px"><div style="font-size:11px;color:var(--green);text-transform:uppercase;letter-spacing:1px">TOTAL</div><div style="font-size:18px;font-weight:800;color:var(--green);margin-top:2px">'+_repMoney(capT)+'</div></div></div>';
    if (!rows.length) {
        html += '<div class="empty-state" style="padding:40px"><div class="empty-icon">📦</div><div class="empty-title">Sin existencias en este inventario</div></div>';
    } else {
        html += '<div class="tabla-wrap" style="padding:0 8px"><table style="font-size:12px"><thead><tr><th style="text-align:left">Insumo</th><th style="text-align:left">Familia</th><th style="text-align:right">Exist. Barra</th><th style="text-align:right">Exist. Bodega</th><th style="text-align:right">Total exist.</th><th style="text-align:right">Costo prov.</th><th style="text-align:right">Capital</th></tr></thead><tbody>'+
            rows.map(function(r){ var cont=_fmtContenido(r); return '<tr><td style="font-weight:600">'+etx(r.nombre)+(cont?'<div style="font-size:10px;color:#7ab8f5;font-weight:400">📦 '+cont+'</div>':'')+'</td><td style="color:var(--text-dim)">'+etx(r.familia)+'</td><td style="text-align:right">'+_fmtCant(r.barra,r)+'</td><td style="text-align:right">'+_fmtCant(r.bodega,r)+'</td><td style="text-align:right;font-weight:700;color:var(--text)">'+_fmtCant(r.total,r)+'</td><td style="text-align:right;color:var(--text-muted)">'+_repMoney(r.costoUnit)+'</td><td style="text-align:right;color:var(--accent);font-weight:600">'+_repMoney(r.capital)+'</td></tr>'; }).join('')+
            '</tbody></table></div>';
    }
    document.getElementById('previewInvBody').innerHTML = html;
    document.getElementById('modalPreviewInv').style.display = 'flex';
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
function setCompuestos(arr) { try { localStorage.setItem(_compuestosKey(), JSON.stringify(arr)); } catch(e) {} }

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
    var sup = 0;
    (comp.miembros||[]).forEach(function(mid){
        var f = filasCaptura.find(function(x){ return x.insumoId === mid; });
        if (f) sup += calcExistenciaTeorica(f);
    });
    var v = (invActual && invActual.ventasCompuesto && invActual.ventasCompuesto[comp.id]) || {};
    return sup - (parseFloat(v.ventas)||0) - (parseFloat(v.cortesia)||0) - (parseFloat(v.merma)||0);
}
// Fila VIRTUAL del compuesto para renderizar como un insumo copa más.
function _virtualFilaCompuesto(comp) {
    var v = (invActual && invActual.ventasCompuesto && invActual.ventasCompuesto[comp.id]) || {};
    var m0 = filasCaptura.find(function(x){ return (comp.miembros||[]).indexOf(x.insumoId) >= 0; });
    return {
        esCompuesto: true, compId: comp.id, insumoId: '_comp_' + comp.id,
        nombre: comp.nombre, categoria: '🧩 Compuesto', subcategoria: '', familia: '🧩 Compuestos',
        tipo: 'copa', copaML: _copaMLCompuesto(comp), contNeto: 0,
        costoUnitario: m0 ? (m0.costoUnitario || 0) : 0, precioCarta: m0 ? (m0.precioCarta || 0) : 0,
        ventasCopasDirectas: v.ventas || 0, cortesiaCopas: v.cortesia || 0, mermaCopas: v.merma || 0, ventasBotella: 0,
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
    var url = location.origin + '/entrada.html?n=' + encodeURIComponent(negId) + '&t=' + encodeURIComponent(token);
    urlEl.textContent = url;
    function gen() {
        box.innerHTML = '';
        var d = document.createElement('div');
        d.style.cssText = 'background:#fff;padding:14px;border-radius:12px;display:inline-block';
        box.appendChild(d);
        try { new QRCode(d, { text: url, width: 210, height: 210, colorDark: '#0a0908', colorLight: '#ffffff' }); }
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
function _renderParamLista() {
    var comps = getCompuestos();
    var html = '<div style="padding:16px 18px">'+
        '<div style="font-size:12px;color:var(--text-dim);margin-bottom:12px;line-height:1.5">Une 2+ presentaciones del MISMO producto (ej. Mezcal Granel + Mezcal Botella) → en el reporte final salen como uno solo. La captura sigue siendo independiente.</div>'+
        '<button class="btn-vista" style="color:var(--green);border-color:var(--green);margin-bottom:14px" onclick="nuevoCompuesto()">+ Nuevo producto compuesto</button>'+
        (comps.length ? comps.map(function(c){
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px">'+
                '<div><div style="font-weight:600;color:var(--text)">🧩 '+etx(c.nombre)+'</div>'+
                '<div style="font-size:11px;color:var(--text-dim)">'+(c.miembros||[]).length+' insumos · unidad final: '+(c.unidad||'—')+'</div></div>'+
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
    var el = document.getElementById('compCount'); if (el) el.textContent = _compMiembros.length + ' seleccionados';
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
        '<label style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Unidad de la vista final</label>'+
        '<select id="compUnidad" style="'+inpSt+';margin:4px 0 12px">'+
        ['pza','botella','ml','lt','g','kg'].map(function(u){ return '<option value="'+u+'"'+((c.unidad||'lt')===u?' selected':'')+'>'+u+'</option>'; }).join('')+'</select>'+
        '<label style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Insumos a fusionar · <span id="compCount">'+_compMiembros.length+' seleccionados</span></label>'+
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
    if (_compMiembros.length < 2) { alert('Selecciona al menos 2 insumos para fusionar.'); return; }
    var unidad = document.getElementById('compUnidad').value;
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
    if (_repFusion) rows = _fusionarRows(rows); // Reporte final: fusiona productos compuestos
    if (!rows.length){ alert('No hay existencias para imprimir.'); return; }
    rows.sort(function(a,b){ return b.capital - a.capital; });
    var negNom = (function(){ try { return (JSON.parse(localStorage.getItem('etaax_ctx')||'{}').negocio||{}).nombre || ''; } catch(e){ return ''; } })();
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
    var pagina = '<div class="cab"><div><div class="neg-nombre">'+(negNom?etx(negNom):'Existencias')+'</div>'+
        '<div class="neg-sub">Existencias por área · '+etx(areaTxt)+(op?' · Operativa':'')+'</div></div>'+
        '<div><div class="etx-mark">ET<span>AA</span>X</div>'+
        '<div class="fecha-txt">'+fechaLarga+'</div><div class="fecha-cnt">'+nIns+' insumos</div></div></div>'+
        resumen + tabla +
        '<div class="footer"><span>etaax.com · EGMx Consultoría Estratégica a&b</span>'+
        '<strong>📊 Existencias por área</strong><span>'+fechaLarga+'</span></div>';

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
    // Acotar por sucursal, PERO siempre incluir los borradores abiertos (cerrado=false)
    // aunque el scope no los muestre → un inventario en curso NUNCA se oculta/pierde.
    const todos  = getInventarios();
    const scoped = _scopeSucInvs(todos);
    const _ids   = {}; scoped.forEach(function(x){ if (x && x.id) _ids[x.id] = 1; });
    todos.forEach(function(x){ if (x && x.id && !x.cerrado && !_ids[x.id]) scoped.push(x); });
    const lista = [...scoped].reverse();
    if (!lista.length) {
        cont.innerHTML = `<div class="empty-state" style="margin-top:16px">
            <div class="empty-icon">📦</div>
            <div class="empty-title">Sin inventarios</div>
            <div class="empty-desc">Crea tu primer inventario</div>
        </div>`; return;
    }
    cont.innerHTML = modoListaHist === 'galeria'
        ? `<div class="hist-galeria">${lista.map(renderHistCard).join('')}</div>`
        : renderHistTabla(lista);
}

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
        setInventarios(lista); // guarda local + nube
        renderStats(); renderHistorial();
    });
}

function renderHistTabla(lista) {
    return `<div class="card" style="max-width:none;margin-top:12px">
        <div class="card-body" style="padding:0"><div class="tabla-wrap"><table>
            <thead><tr>
                <th>Fecha</th><th>Inventario</th><th>Área</th><th>Productos</th>
                <th>Capital costo</th><th>Capital carta</th><th>Diferencia</th><th>Estado</th><th></th>
            </tr></thead>
            <tbody>${lista.map(inv => {
                const dif = inv.diferenciaCosto || 0;
                const accionBtn = inv.cerrado
                    ? `<button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px;color:var(--accent);border-color:var(--accent)"
                        onclick="editarInventario('${inv.id}')">✏️ Editar</button>`
                    : `<button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px"
                        onclick="abrirInventario('${inv.id}')">▶ Continuar</button>
                       <button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px;color:var(--green);border-color:var(--green)"
                        onclick="finalizarInventarioHistorial('${inv.id}')">✅ Finalizar</button>`;
                return `<tr>
                    <td style="color:var(--text-muted)">${new Date(inv.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}</td>
                    <td style="font-weight:500">${tipoIcon(inv.tipoInv)} ${etx(inv.nombre||'Sin nombre')}</td>
                    <td style="color:var(--text-dim);font-size:11px">${inv.area||'—'}</td>
                    <td style="color:var(--text-muted)">${(inv.filas||[]).length}</td>
                    <td style="color:var(--accent);font-weight:500">$${(inv.capitalCosto||0).toFixed(0)}</td>
                    <td style="color:var(--green);font-weight:500">$${(inv.capitalCarta||0).toFixed(0)}</td>
                    <td style="color:${dif>=0?'var(--green)':'var(--red)'};font-weight:500">${dif>=0?'+':''}$${dif.toFixed(0)}</td>
                    <td><span class="pill ${inv.cerrado?'pill-green':'pill-amber'}">${inv.cerrado?'Cerrado':'Abierto'}</span></td>
                    <td style="text-align:right;white-space:nowrap">
                        <button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px"
                            onclick="verPreviewInventario('${inv.id}')">👁️ Ver</button>
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
    const dif = inv.diferenciaCosto || 0;
    const accionBtn = inv.cerrado
        ? `<button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1;color:var(--accent);border-color:var(--accent)"
            onclick="editarInventario('${inv.id}')">✏️ Editar</button>`
        : `<button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1"
            onclick="abrirInventario('${inv.id}')">▶ Continuar</button>
           <button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1;color:var(--green);border-color:var(--green)"
            onclick="finalizarInventarioHistorial('${inv.id}')">✅ Finalizar</button>`;
    return `<div class="hist-card ${inv.cerrado?'cerrado':''}">
        <div class="hist-card-icon">${tipoIcon(inv.tipoInv)}</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
            <div class="hist-card-nombre">${etx(inv.nombre||'Sin nombre')}</div>
            <span class="pill ${inv.cerrado?'pill-green':'pill-amber'}" style="flex-shrink:0;margin-left:8px">
                ${inv.cerrado?'Cerrado':'Abierto'}</span>
        </div>
        <div class="hist-card-meta">
            ${new Date(inv.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'})}
            ${inv.turno && /^\d{2}:\d{2}/.test(inv.turno) ? ' · '+inv.turno+'h' : ''} ${inv.area?' · '+inv.area:''}
            ${inv.negocio?'<br>'+inv.negocio:''}
        </div>
        <div style="border-top:1px solid var(--border);padding-top:10px">
            <div class="hist-card-stat"><span>Capital costo</span><span style="color:var(--accent);font-weight:500">$${(inv.capitalCosto||0).toFixed(0)}</span></div>
            <div class="hist-card-stat"><span>Capital carta</span><span style="color:var(--green);font-weight:500">$${(inv.capitalCarta||0).toFixed(0)}</span></div>
            <div class="hist-card-stat"><span>Diferencia</span>
                <span style="color:${dif>=0?'var(--green)':'var(--red)'};font-weight:600">${dif>=0?'+':''}$${dif.toFixed(0)}</span></div>
            <div class="hist-card-stat"><span>Productos</span><span>${(inv.filas||[]).length}</span></div>
        </div>
        <div class="hist-card-actions">
            <button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1"
                onclick="verPreviewInventario('${inv.id}')">👁️ Ver</button>
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

function abrirInventario(id) {
    const inv = getInventarios().find(x => x.id === id);
    if (!inv) return;
    invActual = JSON.parse(JSON.stringify(inv));
    if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
    if (!invActual.ventasCompuesto)   invActual.ventasCompuesto   = {};
    if (!invActual.cancelaciones)     invActual.cancelaciones     = [];
    if (!invActual.descuentos)        invActual.descuentos        = [];
    if (!invActual.entradasLog)       invActual.entradasLog       = [];
    // Siempre recarga desde insumos para mostrar el catálogo completo;
    // cargarProductosCaptura hace merge: usa filas guardadas si existen, default si no
    cargarProductosCaptura();
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

function _getUltimoInvFecha() {
    const lista = getInventarios();
    if (!lista.length) return null;
    return lista[lista.length - 1].fecha || null;
}

function onTipoInvChange(tipo) {
    const mapa = { primer_lev:'general', bebidas:'barra', alimentos:'cocina', almacen:'bodega', restaurante:'general', otro:'general' };
    const sel  = document.getElementById('invArea');
    if (sel) sel.value = mapa[tipo] || 'general';
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
    const cerrados = _scopeSucInvs(getInventarios())
        .filter(x => x.cerrado && (!invActual || x.id !== invActual.id))
        .slice().sort((a,b) => String(b.fecha||'').localeCompare(String(a.fecha||''))); // más reciente primero
    if (!cerrados.length) { el.innerHTML = '<option value="">Sin inventarios previos</option>'; el.disabled = true; return; }
    el.disabled = false;
    const ref = _getRefInv();
    const refId = ref ? ref.id : cerrados[0].id;
    el.innerHTML = cerrados.map(inv => {
        const fch = inv.fecha ? new Date(inv.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' }) : 's/f';
        return `<option value="${inv.id}" ${refId === inv.id ? 'selected' : ''}>${etx(inv.nombre || 'Inventario')} · ${fch}</option>`;
    }).join('');
}

function poblarFormulario() {
    const tipo = invActual.tipoInv || 'bebidas';
    document.getElementById('invTipoInv').value = tipo;
    document.getElementById('invNegocio').value = invActual.negocio || _getNegocioNombre();
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
    document.getElementById('invNegocio').value = _getNegocioNombre();
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
function cargarProductosCaptura() {
    const insumos = _scopeSucInsumos(getInsumos()); // solo los insumos de la sucursal activa (evita duplicados entre sucursales)
    if (!insumos.length) { filasCaptura = []; return; }

    filasCaptura = insumos.map(ins => {
        const existe = (invActual.filas || []).find(f => f.insumoId === ins.id);
        if (existe) {
            if (!existe.entradas) existe.entradas = ['','','','',''];
            return existe;
        }

        const p      = (ins.presentaciones || [])[0];
        const catLow = (ins.categoria || '').toLowerCase();
        // ALIMENTOS: tipo 'peso' (conteo en unidad base g/ml/pza, descuento por recetas).
        const esFood = (ins.familia || '').toLowerCase().includes('aliment');
        const tipo   = esFood ? 'peso'
                     : (catLow.includes('cerveza') || catLow.includes('refresco') ||
                        catLow.includes('soda')    || catLow.includes('agua') ? 'pza' : 'copa');

        let copaML = COPA_STD.default;
        for (const [key, val] of Object.entries(COPA_STD)) {
            if (catLow.includes(key)) { copaML = val; break; }
        }
        if (ins.tamanoCopa) {
            const tc = parseFloat(ins.tamanoCopa) || 0;
            if (tc > 0) copaML = (ins.umTamanoCopa||'ML').toUpperCase()==='OZ' ? tc*OZ_ML : tc;
        }

        const pesoCristal = parseFloat(p?.pesoCristal) || 0;
        const _umP = (p?.umContenido || 'ML').toUpperCase();
        // Contenido neto en unidad base: licor en ML; alimentos en g/ml/pza (KG/LT → ×1000).
        const contBase = (() => {
            const cn = parseFloat(p?.contNeto) || 0;
            return (_umP === 'LT' || _umP === 'KG') ? cn * 1000 : cn;
        })();

        return {
            insumoId: ins.id,
            nombre:   ins.nombre + (ins.variedad ? ' '+ins.variedad : ''),
            categoria: ins.categoria  || '',
            subcategoria: ins.subcategoria || '',
            familia:  ins.familia    || '',
            tipo, copaML, contNeto: contBase, pesoCristal,
            baseUnit: esFood ? unidadBaseInsumo(ins) : '',   // g / ml / pza (solo alimentos)
            costoUnitario:  parseFloat(p?.costoUnitario) || parseFloat(p?.precio) || 0,
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
}

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
    if (cont) cont.innerHTML = _step1ListaInner();
    else rerenderCaptura();
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

function renderStep1() {
    if (vistaCapturaExist === 'busqueda') {
        const nReg  = filasCaptura.filter(_esRegistrado).length;
        const nPend = filasCaptura.length - nReg;
        const placeholder = filtroRegistroActivo === 'registrados'
            ? 'Buscar en registrados…' : 'Buscar producto pendiente…';
        return buildVistaSwitcherExist() + buildFiltroRegistroBar() + `
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
    return buildVistaSwitcherExist() + buildFiltroRegistroBar() + buildToolbar(true) +
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
                        ${insumoMeta(fila)?`<span class="inv-tag">${etx(insumoMeta(fila))}</span>`:''}
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
                    ${insumoMeta(fila) ? `<span class="inv-tag">${etx(insumoMeta(fila))}</span>` : ''}
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
                    ${insumoMeta(fila) ? `<span class="inv-tag">${etx(insumoMeta(fila))}</span>` : ''}
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
                    ${insumoMeta(fila) ? `<span class="inv-tag">${etx(insumoMeta(fila))}</span>` : ''}
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
                    ${insumoMeta(fila) ? `<span class="inv-tag">${etx(insumoMeta(fila))}</span>` : ''}
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
    invActual.entradasLog.push({ insumoId: _entradaInsumoId, cantidad, costo, fecha, notas });
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
    if (vistaVentas === 'lista')    return switcher + renderStep3Insumos();
    if (vistaVentas === 'busqueda') return switcher + renderStep3BusquedaScaffold();
    return switcher + _renderProduccionPrebatch() + renderStep3Menu();
}

function renderStep3Insumos() {
    const b        = busquedaCapt.toLowerCase();
    const mapa     = _compDeInsumo();
    // Compuestos (virtuales) primero; luego las filas que NO son miembros.
    const comps = _compuestosActivos()
        .filter(c => !b || (c.nombre||'').toLowerCase().includes(b))
        .map(_virtualFilaCompuesto);
    const filtradas = filasCaptura.filter(f =>
        !mapa[f.insumoId] &&                                   // miembros se ocultan (se venden en el compuesto)
        (!filtroFamActivo || f.familia === filtroFamActivo) &&
        (!filtroCatActiva || f.categoria === filtroCatActiva) &&
        (!b || f.nombre.toLowerCase().includes(b))
    );
    const items = comps.concat(filtradas);
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
                        : (insumoMeta(fila)?`<span class="inv-tag">${etx(insumoMeta(fila))}</span>`:'')}
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
                ${esComp
                    ? `<div style="text-align:center;color:var(--text-dim);font-size:18px;padding-top:4px">—</div>`
                    : `<input type="text" inputmode="decimal" class="inv-num-input" value="${fila.ventasBotella||0}"
                        oninput="this.value=this.value.replace(/[^0-9.]/g,'');updVentasDirectas(${idx},'ventasBotella',+this.value)">`}
            </td>
            ${esCopa ? `
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">cortesía</div>
                <input type="text" inputmode="decimal" class="inv-num-input" style="border-color:rgba(155,141,232,.4)"
                    value="${fila.cortesiaCopas||0}" oninput="this.value=this.value.replace(/[^0-9.]/g,'');${hC}">
            </td>
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">merma</div>
                <input type="text" inputmode="decimal" class="inv-num-input" style="border-color:rgba(224,90,58,.35)"
                    value="${fila.mermaCopas||0}" oninput="this.value=this.value.replace(/[^0-9.]/g,'');${hM}">
            </td>` : '<td colspan="2"></td>'}
        </tr>`;
    }).join('');
    return buildToolbar(true) + `<div class="inv-table-wrap">
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
    invActual.cocktailsVendidos[id] = nuevo;
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
    invActual.cocktailsVendidos[id] = nuevo;
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
    if (!pres.length) return '';
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

function renderStep3Menu() {
    const recetas  = getRecetas().filter(r =>
        (r.tipo === 'alimentos' || r.tipo === 'bebidas') && r.status !== 'inactiva'
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
    const resumenHtml = `<div style="padding:12px 16px;display:flex;align-items:center;gap:12px">
        <span style="font-size:11px;color:var(--text-dim)">Total registrado:</span>
        <span id="step3MenuTotal" style="font-size:15px;font-weight:700;color:var(--green)">${totalItems} unidades</span>
    </div>`;
    const gruposHtml = Object.entries(grupos).map(([grp, items]) => `
        <div style="padding:0 16px 16px">
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
                    return `<div class="step3-menu-item ${cnt>0?'has-cnt':''}">
                        <div style="flex:1;min-width:0">
                            <div style="font-weight:600;font-size:14px;color:var(--text);
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${etx(r.nombre)}</div>
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
    const mapa = _compDeInsumo();
    const comps = _compuestosActivos().filter(c => (c.nombre||'').toLowerCase().includes(q)).map(_virtualFilaCompuesto);
    const matchesF = filasCaptura.filter(f => !mapa[f.insumoId] && f.nombre.toLowerCase().includes(q)); // miembros ocultos
    const matches = comps.concat(matchesF);
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
    if (_ventasInsumoId.indexOf('_comp_') === 0) { // producto compuesto
        const comp = getCompuestos().find(c => '_comp_' + c.id === _ventasInsumoId);
        cont.innerHTML = comp ? _cardVentasCompuesto(comp) : '';
        return;
    }
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
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Botellas vendidas</div>
                    <input type="number" id="venta-bot-${idx}" class="inv-num-input"
                        style="width:100px" value="${fila.ventasBotella||0}" min="0" step="1"
                        oninput="updVentasDirectas(${idx},'ventasBotella',+this.value);renderResumenVentas()">
                </div>
            </div>

            ${esCopa ? `
            <div style="border-top:1px solid var(--border);padding-top:14px;margin-bottom:14px">
                <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600">Cortesía</div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
                    <div>
                        <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Copas</div>
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
                        <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Copas</div>
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
            </div>` : ''}

            ${fila.costoUnitario ? `<div style="margin-top:14px;font-size:11px;color:var(--text-dim);border-top:1px solid var(--border);padding-top:10px">
                Costo referencia: <span style="color:var(--accent)">$${(fila.costoUnitario).toFixed(2)}/bot</span>
            </div>` : ''}
        </div>`;
}

function _cardVentasCompuesto(comp) {
    const vf = _virtualFilaCompuesto(comp);
    const _n = v => (v % 1 ? (Math.round(v*10)/10).toFixed(1) : v);
    const members = (comp.miembros||[]).map(mid => filasCaptura.find(f => f.insumoId === mid)).filter(Boolean);
    const inp = 'type="text" inputmode="decimal" class="inv-num-input"';
    return `
        <div class="ent-form-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
                <div>
                    <div style="font-weight:700;font-size:17px;color:var(--text)">🧩 ${etx(comp.nombre)}</div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">
                        <span class="inv-tag" style="background:rgba(122,184,245,0.12);border-color:rgba(122,184,245,0.4);color:#7ab8f5">Compuesto · ${members.length} presentaciones</span>
                        <span class="inv-tag" style="background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)">copa</span>
                    </div>
                    <div style="font-size:11px;color:var(--text-dim);margin-top:6px">${members.map(m => etx(insumoTitulo(m))).join('  +  ')}</div>
                </div>
                <button onclick="limpiarSeleccionVentas()" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:20px;padding:0;line-height:1">✕</button>
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;font-size:12px">
                <span style="color:var(--text-dim)">Existencia disponible: <b style="color:var(--text)">${_n(vf._existCopas)} cop</b></span>
                <span style="color:var(--text-dim)">Teórico tras ventas: <b id="compTeo-${comp.id}" style="color:${vf._teoricoCopas<0?'var(--red)':'var(--green)'}">${_n(vf._teoricoCopas)} cop</b></span>
            </div>
            <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600">Ventas (en copas)</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px">
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Copas vendidas</div>
                    <input ${inp} style="width:110px" value="${vf.ventasCopasDirectas||0}"
                        oninput="this.value=this.value.replace(/[^0-9.]/g,'');updVentasCompuesto('${comp.id}','ventas',+this.value);renderResumenVentas()">
                </div>
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Cortesía (copas)</div>
                    <input ${inp} style="width:110px;border-color:rgba(155,141,232,.5)" value="${vf.cortesiaCopas||0}"
                        oninput="this.value=this.value.replace(/[^0-9.]/g,'');updVentasCompuesto('${comp.id}','cortesia',+this.value);renderResumenVentas()">
                </div>
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Merma (copas)</div>
                    <input ${inp} style="width:110px;border-color:rgba(224,90,58,.4)" value="${vf.mermaCopas||0}"
                        oninput="this.value=this.value.replace(/[^0-9.]/g,'');updVentasCompuesto('${comp.id}','merma',+this.value);renderResumenVentas()">
                </div>
            </div>
        </div>`;
}

function renderResumenVentas() {
    const cont = document.getElementById('ventasResumen');
    if (!cont) return;
    const mapaC = _compDeInsumo();
    const conVentas = filasCaptura.filter(f =>
        !mapaC[f.insumoId] && (                                  // miembros se reportan en el compuesto
        (f.ventasCopasDirectas||0)>0 || (f.ventasBotella||0)>0 ||
        (f.cortesiaCopas||0)>0 || (f.mermaCopas||0)>0)
    );
    const compsConVentas = _compuestosActivos().map(_virtualFilaCompuesto).filter(vf =>
        (vf.ventasCopasDirectas||0)>0 || (vf.cortesiaCopas||0)>0 || (vf.mermaCopas||0)>0);
    const todos = compsConVentas.concat(conVentas);
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
    invActual.cocktailsVendidos[id] = val;
}
function updVentasDirectas(idx, campo, val) { filasCaptura[idx][campo] = val; _autoGuardar(); }
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
// ── Consumo (uso) de un insumo en el periodo, en la unidad de su fila ──
function _consumoPeriodo(f) {
    if (f.tipo === 'peso') return calcVentasBaseRecetas(f.insumoId);
    if (f.tipo === 'pza')  return (parseFloat(f.ventasBotella)||0) + (parseFloat(f.ventasCopasDirectas)||0);
    var copasBot = f.contNeto>0 && f.copaML>0 ? f.contNeto/f.copaML : 0;
    return calcVentasCopasRecetas(f.insumoId, f.copaML) + (parseFloat(f.ventasCopasDirectas)||0) + (parseFloat(f.ventasBotella)||0)*copasBot;
}
// ── FASE 1 — Resumen ejecutivo del inventario (faltantes/sobrantes, merma,
//    vendidos por categoría, usados/sin usar, vendido vs compras) ──
function _resumenEjecutivo() {
    var faltU=0, sobrU=0, faltCosto=0, sobrCosto=0, faltCarta=0, sobrCarta=0;
    var mermados=[], mermaCosto=0, usados=0, sinUsar=0, sinUsarLista=[], vendidoCosto=0;
    var _mapaRE = _compDeInsumo();
    // Miembros de un compuesto NO se evalúan sueltos (su venta va al compuesto) → evita falsos faltantes.
    filasCaptura.filter(function(f){ return !_mapaRE[f.insumoId]; }).concat(_compuestosActivos().map(_virtualFilaCompuesto)).forEach(function(f){
        var cc = costoCopa(f), dif = calcDiferencia(f);
        if (dif < -0.001) { faltU++; faltCosto += Math.abs(dif)*cc; faltCarta += Math.abs(dif)*(f.precioCarta||0); }
        else if (dif > 0.001) { sobrU++; sobrCosto += dif*cc; sobrCarta += dif*(f.precioCarta||0); }
        var merma = (parseFloat(f.mermaCopas)||0) + (parseFloat(f.mermaBase)||0);
        if (merma > 0) { mermados.push({nombre:f.nombre, costo:merma*cc, f:f, m:merma}); mermaCosto += merma*cc; }
        var cons = _consumoPeriodo(f);
        if (cons > 0.001) { usados++; vendidoCosto += cons*cc; } else { sinUsar++; if (sinUsarLista.length<60) sinUsarLista.push(f.nombre); }
    });
    var comprasCosto = ((invActual && invActual.entradasLog) || []).reduce(function(s,e){ return s + (parseFloat(e.cantidad)||0)*(parseFloat(e.costo)||0); }, 0);
    // Vendidos por categoría (a precio carta)
    var porCat = {}, recetas = getRecetas().filter(function(r){ return r.tipo==='alimentos'||r.tipo==='bebidas'; });
    var vendidos = (invActual && invActual.cocktailsVendidos) || {};
    recetas.forEach(function(r){ var n=parseFloat(vendidos[r.id])||0; if(!n) return; var cat=r.categoria||r.grupo||'Otros'; var c=porCat[cat]=porCat[cat]||{u:0,carta:0}; c.u+=n; c.carta+=n*(parseFloat(r.precioEnCarta)||0); });
    var cats = Object.keys(porCat).sort(function(a,b){ return porCat[b].carta - porCat[a].carta; });
    var totVendCarta = cats.reduce(function(s,c){ return s+porCat[c].carta; }, 0);

    function card(lbl, val, col, sub){ return '<div class="stat-card"><div class="stat-label">'+lbl+'</div><div class="stat-val" style="color:'+col+';font-size:18px">'+val+'</div>'+(sub?'<div style="font-size:10px;color:var(--text-dim);margin-top:2px">'+sub+'</div>':'')+'</div>'; }
    var M = function(n){ return '$'+(Math.round((n||0))).toLocaleString('es-MX'); };

    var bloqueKpis = '<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">'+
        card('Faltante a costo', M(faltCosto), 'var(--red)', faltU+' insumos · '+M(faltCarta)+' a carta')+
        card('Sobrante a costo', M(sobrCosto), 'var(--green)', sobrU+' insumos · '+M(sobrCarta)+' a carta')+
        card('Merma del periodo', M(mermaCosto), 'var(--accent)', mermados.length+' productos')+
        card('Insumos sin usar', String(sinUsar), sinUsar>0?'var(--accent)':'var(--green)', usados+' usados en el periodo')+
        '</div>'+
        '<div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">'+
        card('Vendido a precio proveedor', M(vendidoCosto), 'var(--text)', 'costo de lo que salió')+
        card('Compras del periodo', M(comprasCosto), 'var(--text)', 'entradas registradas')+
        card('Vendido vs Compras', (vendidoCosto-comprasCosto>=0?'+':'−')+M(Math.abs(vendidoCosto-comprasCosto)), (vendidoCosto-comprasCosto>=0?'var(--green)':'var(--red)'), vendidoCosto>=comprasCosto?'compraste menos de lo que vendiste':'compraste más de lo que vendiste')+
        '</div>';

    var tablaCat = cats.length ? ('<div class="card" style="max-width:none;margin:0 16px 12px"><div class="card-body" style="padding:0"><div style="padding:12px 16px;font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent)">🍽️ Vendidos por categoría — '+M(totVendCarta)+' a carta</div><div class="tabla-wrap"><table style="font-size:12px"><thead><tr><th style="text-align:left">Categoría</th><th style="text-align:right">Unidades</th><th style="text-align:right">$ a carta</th><th style="text-align:right">%</th></tr></thead><tbody>'+
        cats.map(function(c){ var p=totVendCarta>0?(porCat[c].carta/totVendCarta*100):0; return '<tr><td style="font-weight:600">'+etx(c)+'</td><td style="text-align:right">'+porCat[c].u+'</td><td style="text-align:right;color:var(--green);font-weight:600">'+M(porCat[c].carta)+'</td><td style="text-align:right;color:var(--text-dim)">'+p.toFixed(0)+'%</td></tr>'; }).join('')+
        '</tbody></table></div></div></div>') : '';

    var tablaMerma = mermados.length ? ('<div class="card" style="max-width:none;margin:0 16px 12px"><div class="card-body" style="padding:0"><div style="padding:12px 16px;font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent)">🗑️ Productos mermados — '+M(mermaCosto)+'</div><div class="tabla-wrap"><table style="font-size:12px"><thead><tr><th style="text-align:left">Producto</th><th style="text-align:right">Merma</th><th style="text-align:right">$ a costo</th></tr></thead><tbody>'+
        mermados.sort(function(a,b){return b.costo-a.costo;}).map(function(x){ return '<tr><td style="font-weight:600">'+etx(x.nombre)+'</td><td style="text-align:right">'+_fmtBase(x.m)+'</td><td style="text-align:right;color:var(--accent);font-weight:600">'+M(x.costo)+'</td></tr>'; }).join('')+
        '</tbody></table></div></div></div>') : '';

    var listaSinUsar = sinUsar ? ('<div class="card" style="max-width:none;margin:0 16px 12px"><div class="card-body" style="padding:12px 16px"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;color:var(--text-muted);margin-bottom:8px">💤 Insumos sin usar en este periodo ('+sinUsar+')</div><div style="display:flex;flex-wrap:wrap;gap:6px">'+
        sinUsarLista.map(function(n){ return '<span style="font-size:11px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:3px 9px;color:var(--text-dim)">'+etx(n)+'</span>'; }).join('')+
        (sinUsar>sinUsarLista.length?'<span style="font-size:11px;color:var(--text-dim)">+'+(sinUsar-sinUsarLista.length)+' más</span>':'')+'</div></div></div>') : '';

    return '<div class="wrap" style="padding-top:0"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1.5px;color:var(--text);margin:6px 0 10px">📊 Resumen ejecutivo</div>'+bloqueKpis+'</div>'+tablaCat+tablaMerma+listaSinUsar;
}

function renderStep5() {
    const mapaC5 = _compDeInsumo();
    const vcomps = _compuestosActivos().map(_virtualFilaCompuesto);
    let capitalCosto=0, capitalCarta=0, difCostoTotal=0, conAlerta=0;
    // Capital: existencia real de TODAS las filas (los miembros cuentan su capital una vez).
    filasCaptura.forEach(fila => {
        const exist = calcExistencia(fila);
        const cc    = costoCopa(fila);
        capitalCosto  += exist * cc;
        capitalCarta  += exist * (fila.precioCarta||0);
        // La diferencia de los MIEMBROS se evalúa en su compuesto, no individual.
        if (!mapaC5[fila.insumoId]) {
            const dif = calcDiferencia(fila);
            difCostoTotal += dif * cc;
            const ref = calcExistenciaTeorica(fila);
            if (ref>0 && Math.abs(dif/ref)*100>25) conAlerta++;
        }
    });
    // Diferencia de los compuestos (existencia sumada − ventas en copas).
    vcomps.forEach(vf => {
        const dif = calcDiferencia(vf);
        difCostoTotal += dif * costoCopa(vf);
        const ref = calcExistenciaTeorica(vf);
        if (ref>0 && Math.abs(dif/ref)*100>25) conAlerta++;
    });
    if (invActual) invActual.diferenciaCosto = difCostoTotal;
    const colorDif = difCostoTotal>=0 ? 'var(--green)' : 'var(--red)';

    const numCancel       = (invActual?.cancelaciones||[]).length;
    const totalDescuentos = (invActual?.descuentos||[]).reduce((s,d)=>s+(parseFloat(d.monto)||0),0);

    const _M2 = v => (v||0).toLocaleString('es-MX', { minimumFractionDigits:2, maximumFractionDigits:2 }); // $1,832,994.00
    const kpis = `<div class="wrap" style="padding-bottom:0">
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
            <button class="btn-vista" style="color:var(--accent);border-color:var(--accent)"
                onclick="verReporteDirectivo()">📄 Reporte directivo</button>
        </div>
        <div class="stats-grid" style="grid-template-columns:repeat(6,1fr)">
            <div class="stat-card"><div class="stat-label">Capital a costo</div><div class="stat-val">$${_M2(capitalCosto)}</div></div>
            <div class="stat-card"><div class="stat-label">Capital a carta</div><div class="stat-val green">$${_M2(capitalCarta)}</div></div>
            <div class="stat-card"><div class="stat-label">Diferencia total</div>
                <div class="stat-val" style="color:${colorDif}">${difCostoTotal>=0?'+':''}$${_M2(difCostoTotal)}</div></div>
            <div class="stat-card"><div class="stat-label">Con alerta >25%</div>
                <div class="stat-val" style="color:${conAlerta>0?'var(--red)':'var(--green)'}">${conAlerta}</div></div>
            <div class="stat-card"><div class="stat-label">Cancelaciones POS</div>
                <div class="stat-val" style="color:${numCancel>0?'var(--accent)':'var(--text)'}">${numCancel}</div></div>
            <div class="stat-card"><div class="stat-label">Total descuentos</div>
                <div class="stat-val" style="color:${totalDescuentos>0?'var(--red)':'var(--text)'}">$${_M2(totalDescuentos)}</div></div>
        </div>
    </div>`;

    const searchBar5 = `<div class="wrap" style="padding:0 0 4px"><div class="step-toolbar"><div class="inv-search">
        <input type="text" placeholder="Buscar producto en el resultado…" value="${etx(_busqStep5)}" oninput="onBusqStep5(this.value)">
    </div></div></div>`;
    return kpis + _resumenEjecutivo() + searchBar5 + `<div id="step5Tablas">${_step5TablasHTML()}</div>`;
}

var _busqStep5 = '';
function onBusqStep5(val) {
    _busqStep5 = val;
    const cont = document.getElementById('step5Tablas');
    if (cont) cont.innerHTML = _step5TablasHTML(); // solo re-renderiza las tablas → no pierde el foco
}
function _step5TablasHTML() {
    const q      = (_busqStep5 || '').toLowerCase();
    const mapaC5 = _compDeInsumo();
    const vcomps = _compuestosActivos().map(_virtualFilaCompuesto)
        .filter(vf => !q || (vf.nombre||'').toLowerCase().includes(q));
    // Split filas into copa-type (bebidas con botella y copa) and pza-type groups
    const gruposCopa = {};
    const gruposPza  = {};
    filasCaptura.forEach(f => {
        if (mapaC5[f.insumoId]) return; // miembros de un compuesto: salen en la sección de compuestos
        if (q && !(f.nombre||'').toLowerCase().includes(q)) return; // buscador del Paso 5
        const g = f.familia || f.categoria || 'Otros';
        if (f.tipo === 'pza') {
            if (!gruposPza[g])  gruposPza[g]  = [];
            gruposPza[g].push(f);
        } else {
            if (!gruposCopa[g]) gruposCopa[g] = [];
            gruposCopa[g].push(f);
        }
    });

    // ── Copa block: columnas separadas para venta bot, venta copa, cortesía/merma, cancelac. ──
    const tablasCopa = Object.entries(gruposCopa).map(([grp, items]) => {
        let grpDif = 0;
        const rows = items.map(fila => {
            const ea        = parseFloat(fila.existenciaAnterior) || 0;
            const copasBot  = fila.contNeto>0 && fila.copaML>0 ? fila.contNeto/fila.copaML : 0;
            const entBot    = getEntradasBottles(fila.insumoId);
            const ventaBot  = parseFloat(fila.ventasBotella) || 0;
            const ventaCopa = calcVentasCopasRecetas(fila.insumoId, fila.copaML) + (parseFloat(fila.ventasCopasDirectas)||0);
            const cortesia  = parseFloat(fila.cortesiaCopas) || 0;
            const merma     = parseFloat(fila.mermaCopas)    || 0;
            const cmTotal   = cortesia + merma;
            const cmConc    = [fila.cortesiaConcepto, fila.mermaConcepto].filter(Boolean).join(' / ');
            const cancelCop = getCancelacionesCopas(fila.insumoId);
            const teorico   = calcExistenciaTeorica(fila);
            const fisico    = calcExistencia(fila);
            const dif       = fisico - teorico;
            const cc        = costoCopa(fila);
            const difCosto  = dif * cc;
            const ref       = teorico > 0 ? teorico : fisico;
            const color     = semaforo(dif, ref);
            const pctVal    = ref > 0 ? (dif/ref*100) : null;
            const pctStr    = pctVal !== null ? (pctVal>=0?'+':'')+pctVal.toFixed(1)+'%' : '—';
            // Show existencia anterior and actual in bottles
            const eaBot     = copasBot > 0 ? (ea/copasBot).toFixed(1) : ea.toFixed(1);
            const entBotStr = entBot > 0 ? `+${entBot % 1 ? entBot.toFixed(1) : entBot} ${_unidadCompra(fila)}` : '—';
            const fisicoBot = copasBot > 0 ? (fisico/copasBot).toFixed(2) : fisico.toFixed(1);
            // Diferencia in copas, with sign and unit label
            const difStr    = `${dif>=0?'+':''}${dif.toFixed(1)} cop`;
            grpDif += difCosto;
            return `<tr>
                <td style="min-width:140px">
                    <div style="font-size:12px;font-weight:600">${etx(insumoTitulo(fila))}</div>
                    <div style="font-size:10px;color:var(--text-dim)">${fila.categoria||''}</div>
                </td>
                <td style="text-align:center;white-space:nowrap">${eaBot} bot</td>
                <td style="text-align:center;color:var(--green);white-space:nowrap">${entBotStr}</td>
                <td style="text-align:center;color:var(--accent)">${ventaBot > 0 ? ventaBot + ' bot' : '—'}</td>
                <td style="text-align:center;color:var(--accent)">${ventaCopa > 0 ? ventaCopa.toFixed(1) + ' cop' : '—'}</td>
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
        }).join('');
        return `<div class="card" style="max-width:none;margin:0 16px 12px">
            <div class="card-header">
                <h2>${grp}</h2>
                <span class="pill ${grpDif>=0?'pill-green':'pill-red'}" style="font-size:11px">
                    ${grpDif>=0?'+':''}$${grpDif.toFixed(2)}</span>
            </div>
            <div class="card-body" style="padding:0"><div class="tabla-wrap" style="overflow-x:auto"><table style="min-width:900px">
                <thead>
                    <tr>
                        <th rowspan="2" style="text-align:left;vertical-align:bottom">Producto</th>
                        <th rowspan="2" style="text-align:center;width:70px;vertical-align:bottom">Exist.<br>anterior</th>
                        <th rowspan="2" style="text-align:center;width:65px;vertical-align:bottom">Entradas</th>
                        <th colspan="2" style="text-align:center;border-bottom:1px solid var(--border);padding-bottom:4px">Ventas</th>
                        <th rowspan="2" style="text-align:center;width:95px;vertical-align:bottom">Cortesía /<br>Merma</th>
                        <th rowspan="2" style="text-align:center;width:70px;vertical-align:bottom">Cancelac.<br>POS</th>
                        <th rowspan="2" style="text-align:center;width:80px;vertical-align:bottom">Exist.<br>actual</th>
                        <th rowspan="2" style="text-align:center;width:80px;vertical-align:bottom">Diferencia</th>
                        <th rowspan="2" style="text-align:center;width:50px;vertical-align:bottom">%</th>
                        <th rowspan="2" style="text-align:right;width:80px;vertical-align:bottom">Dif. $</th>
                    </tr>
                    <tr>
                        <th style="text-align:center;width:65px;font-size:10px;color:var(--text-muted)">Botella</th>
                        <th style="text-align:center;width:65px;font-size:10px;color:var(--text-muted)">Copa</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table></div></div>
        </div>`;
    }).join('');

    // ── Pza block: layout original (una sola columna ventas) ──
    const tablasPza = Object.entries(gruposPza).map(([grp, items]) => {
        let grpDif = 0;
        const rows = items.map(fila => {
            const ea        = parseFloat(fila.existenciaAnterior) || 0;
            const entTotal  = getEntradasCopas(fila);
            const ventas    = (fila.ventasBotella || 0);
            const cancelPza = getCancelacionesCopas(fila.insumoId);
            const teorico   = calcExistenciaTeorica(fila);
            const fisico    = calcExistencia(fila);
            const dif       = fisico - teorico;
            const cc        = costoCopa(fila);
            const difCosto  = dif * cc;
            const ref       = teorico > 0 ? teorico : fisico;
            const color     = semaforo(dif, ref);
            const pctVal    = ref > 0 ? (dif/ref*100) : null;
            const pctStr    = pctVal !== null ? (pctVal>=0?'+':'')+pctVal.toFixed(1)+'%' : '—';
            grpDif += difCosto;
            return `<tr>
                <td>
                    <div style="font-size:12px;font-weight:600">${etx(insumoTitulo(fila))}</div>
                    <div style="font-size:10px;color:var(--text-dim)">${fila.categoria||''}</div>
                </td>
                <td style="text-align:center">${ea.toFixed(0)} pza</td>
                <td style="text-align:center;color:var(--green)">${entTotal>0?'+'+entTotal.toFixed(0)+' pza':'—'}</td>
                <td style="text-align:center;color:var(--accent)">${ventas>0?ventas+' pza':'—'}</td>
                <td style="text-align:center;color:var(--text-muted)">${cancelPza>0?cancelPza.toFixed(0)+' pza':'—'}</td>
                <td style="text-align:center">${teorico.toFixed(0)} pza</td>
                <td style="text-align:center;font-weight:600">${fisico.toFixed(0)} pza</td>
                <td style="text-align:center;font-weight:700;color:${color}">${dif>=0?'+':''}${dif.toFixed(0)} pza</td>
                <td style="text-align:center;font-size:11px;color:${color}">${pctStr}</td>
                <td style="text-align:right;font-weight:600;color:${color}">${difCosto>=0?'+':''}$${difCosto.toFixed(2)}</td>
            </tr>`;
        }).join('');
        return `<div class="card" style="max-width:none;margin:0 16px 12px">
            <div class="card-header">
                <h2>${grp}</h2>
                <span class="pill ${grpDif>=0?'pill-green':'pill-red'}" style="font-size:11px">
                    ${grpDif>=0?'+':''}$${grpDif.toFixed(2)}</span>
            </div>
            <div class="card-body" style="padding:0"><div class="tabla-wrap"><table>
                <thead><tr>
                    <th>Producto</th>
                    <th style="text-align:center;width:70px">Exist. ant.</th>
                    <th style="text-align:center;width:65px">Entradas</th>
                    <th style="text-align:center;width:65px">Ventas</th>
                    <th style="text-align:center;width:70px">Cancelac.</th>
                    <th style="text-align:center;width:70px">Teórico</th>
                    <th style="text-align:center;width:70px">Físico</th>
                    <th style="text-align:center;width:75px">Diferencia</th>
                    <th style="text-align:center;width:50px">%</th>
                    <th style="text-align:right;width:80px">Dif. $</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table></div></div>
        </div>`;
    }).join('');

    // ── Sección de PRODUCTOS COMPUESTOS: una línea por compuesto (copas) ──
    const _nc = v => (v % 1 ? (Math.round(v*10)/10).toFixed(1) : v);
    let _compGrpDif = 0;
    const _compRows = vcomps.map(vf => {
        const comp = getCompuestos().find(c => c.id === vf.compId) || {};
        const members = (comp.miembros||[]).map(mid => filasCaptura.find(f=>f.insumoId===mid)).filter(Boolean);
        let ea=0, ent=0, cancel=0;
        members.forEach(m => { ea += (parseFloat(m.existenciaAnterior)||0); ent += getEntradasCopas(m); cancel += getCancelacionesCopas(m.insumoId); });
        const ventaCopa = (vf.ventasCopasDirectas||0);
        const cm        = (vf.cortesiaCopas||0) + (vf.mermaCopas||0);
        const fisico    = calcExistencia(vf);
        const teorico   = calcExistenciaTeorica(vf);
        const dif       = fisico - teorico;
        const cc        = costoCopa(vf);
        const difCosto  = dif * cc;
        const ref       = teorico>0 ? teorico : fisico;
        const color     = semaforo(dif, ref);
        const pctStr    = ref>0 ? ((dif/ref*100>=0?'+':'')+(dif/ref*100).toFixed(1)+'%') : '—';
        _compGrpDif += difCosto;
        // Columnas FÍSICAS en la unidad final definida (ej. L), no en copas. Ventas se quedan en copas (así se capturan).
        const cml = vf.copaML || 0;
        const uF  = comp.unidad || 'lt';
        const uLbl = uF==='lt'?'L':uF==='botella'?'bot':uF;
        const toF = c => { if (!cml) return c; const ml = c*cml; return (uF==='lt'||uF==='kg')?ml/1000:uF==='botella'?ml/750:(uF==='ml'||uF==='g')?ml:ml/1000; };
        return `<tr>
            <td style="min-width:140px">
                <div style="font-size:12px;font-weight:600">🧩 ${etx(comp.nombre||vf.nombre)}</div>
                <div style="font-size:10px;color:var(--text-dim)">${members.map(m=>etx(insumoTitulo(m))).join(' + ')}</div>
            </td>
            <td style="text-align:center;white-space:nowrap">${_nc(toF(ea))} ${uLbl}</td>
            <td style="text-align:center;color:var(--green);white-space:nowrap">${ent>0?'+'+_nc(toF(ent))+' '+uLbl:'—'}</td>
            <td style="text-align:center;color:var(--text-dim)">—</td>
            <td style="text-align:center;color:var(--accent)">${ventaCopa>0?_nc(ventaCopa)+' cop':'—'}</td>
            <td style="text-align:center">${cm>0?`<div style="color:var(--red);font-size:12px;font-weight:600">${_nc(cm)} cop</div>`:'—'}</td>
            <td style="text-align:center;color:var(--text-muted)">${cancel>0?_nc(cancel)+' cop':'—'}</td>
            <td style="text-align:center;font-weight:600;white-space:nowrap">${_nc(toF(fisico))} ${uLbl}</td>
            <td style="text-align:center;font-weight:700;color:${color};white-space:nowrap">${dif>=0?'+':''}${_nc(toF(dif))} ${uLbl}</td>
            <td style="text-align:center;font-size:11px;color:${color}">${pctStr}</td>
            <td style="text-align:right;font-weight:600;color:${color};white-space:nowrap">${difCosto>=0?'+':''}$${difCosto.toFixed(2)}</td>
        </tr>`;
    }).join('');
    const tablaComp = vcomps.length ? `<div class="card" style="max-width:none;margin:0 16px 12px">
        <div class="card-header">
            <h2>🧩 Productos compuestos</h2>
            <span class="pill ${_compGrpDif>=0?'pill-green':'pill-red'}" style="font-size:11px">${_compGrpDif>=0?'+':''}$${_compGrpDif.toFixed(2)}</span>
        </div>
        <div class="card-body" style="padding:0"><div class="tabla-wrap" style="overflow-x:auto"><table style="min-width:900px">
            <thead>
                <tr>
                    <th rowspan="2" style="text-align:left;vertical-align:bottom">Producto</th>
                    <th rowspan="2" style="text-align:center;width:70px;vertical-align:bottom">Exist.<br>anterior</th>
                    <th rowspan="2" style="text-align:center;width:65px;vertical-align:bottom">Entradas</th>
                    <th colspan="2" style="text-align:center;border-bottom:1px solid var(--border);padding-bottom:4px">Ventas</th>
                    <th rowspan="2" style="text-align:center;width:95px;vertical-align:bottom">Cortesía /<br>Merma</th>
                    <th rowspan="2" style="text-align:center;width:70px;vertical-align:bottom">Cancelac.<br>POS</th>
                    <th rowspan="2" style="text-align:center;width:80px;vertical-align:bottom">Exist.<br>actual</th>
                    <th rowspan="2" style="text-align:center;width:80px;vertical-align:bottom">Diferencia</th>
                    <th rowspan="2" style="text-align:center;width:50px;vertical-align:bottom">%</th>
                    <th rowspan="2" style="text-align:right;width:80px;vertical-align:bottom">Dif. $</th>
                </tr>
                <tr>
                    <th style="text-align:center;width:65px;font-size:10px;color:var(--text-muted)">Botella</th>
                    <th style="text-align:center;width:65px;font-size:10px;color:var(--text-muted)">Copa</th>
                </tr>
            </thead>
            <tbody>${_compRows}</tbody>
        </table></div></div>
    </div>` : '';

    const sinDatos = !tablasCopa && !tablasPza && !tablaComp
        ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Sin productos capturados</div>'
        : '';

    return `<div style="padding:16px 0 24px">${sinDatos}${tablaComp}${tablasCopa}${tablasPza}</div>`;
}

// ── Reporte directivo ─────────────────────────────────────────
function verReporteDirectivo() {
    if (!invActual) return;

    // ── Analytics ──────────────────────────────────────────────────
    let capitalCosto = 0, capitalCarta = 0, difTotal = 0;
    let conAlerta = 0, conRiesgo = 0, conOk = 0;

    const analisis = filasCaptura.map(f => {
        const fisico    = calcExistencia(f);
        const teorico   = calcExistenciaTeorica(f);
        const dif       = fisico - teorico;
        const cc        = costoCopa(f);
        const difCosto  = dif * cc;
        const ea        = parseFloat(f.existenciaAnterior) || 0;
        const entBot    = getEntradasBottles(f.insumoId);
        const copasBot  = f.contNeto > 0 && f.copaML > 0 ? f.contNeto / f.copaML : 1;
        const ventaCopa = calcVentasCopasRecetas(f.insumoId, f.copaML) + (parseFloat(f.ventasCopasDirectas) || 0);
        const ventaBot  = parseFloat(f.ventasBotella) || 0;
        const cortesia  = parseFloat(f.cortesiaCopas)  || 0;
        const merma     = parseFloat(f.mermaCopas)     || 0;
        const cancel    = getCancelacionesCopas(f.insumoId);
        const consumo   = f.tipo === 'pza'
            ? ventaBot + cancel
            : ventaCopa + ventaBot * copasBot + cortesia + merma + cancel;
        const disponible = ea + (f.tipo === 'pza' ? entBot : entBot * copasBot);
        const pctConsumo = disponible > 0 ? (consumo / disponible) * 100 : 0;
        const varPct     = teorico > 0 ? (dif / teorico) * 100 : 0;
        capitalCosto += fisico * cc;
        capitalCarta += fisico * (f.precioCarta || 0);
        difTotal     += difCosto;
        if (Math.abs(varPct) > 25) conAlerta++;
        else if (Math.abs(varPct) > 10) conRiesgo++;
        else conOk++;
        return { f, fisico, teorico, dif, cc, difCosto, ea, entBot, copasBot,
                 ventaCopa, ventaBot, cortesia, merma, cancel, consumo,
                 disponible, pctConsumo, varPct };
    });

    const totalProds = analisis.length;
    const pctControl = totalProds > 0 ? (conOk / totalProds * 100) : 0;
    const numCancel  = (invActual.cancelaciones || []).length;
    const totalDesc  = (invActual.descuentos || []).reduce((s, d) => s + (parseFloat(d.monto) || 0), 0);
    const margenPot  = capitalCarta - capitalCosto;

    // Rankings y grupos
    const top10      = [...analisis].sort((a, b) => b.consumo - a.consumo).slice(0, 10).filter(a => a.consumo > 0);
    const estancados = analisis.filter(a => a.consumo === 0 && a.fisico > 0);
    const alertasCrit= analisis.filter(a => a.varPct < -25).sort((a, b) => a.varPct - b.varPct);
    const alertasSob = analisis.filter(a => a.varPct > 25).sort((a, b) => b.varPct - a.varPct);
    const gruposTabla = {};
    analisis.forEach(a => {
        const g = a.f.familia || a.f.categoria || 'Otros';
        if (!gruposTabla[g]) gruposTabla[g] = [];
        gruposTabla[g].push(a);
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
        recos.push({ t:'info', ico:'🔵', txt:`Descuentos aplicados por <strong>$${totalDesc.toFixed(2)}</strong>. Verificar que todas las autorizaciones estén dentro de la política de la casa.` });
    if (estancados.length)
        recos.push({ t:'info', ico:'🔵', txt:`<strong>${estancados.length} producto${estancados.length>1?'s sin':' sin'} movimiento</strong> en el período. Evaluar si hay sobre-stock o baja demanda; considerar promoción o devolución al proveedor.` });
    if (!recos.length)
        recos.push({ t:'ok', ico:'🟢', txt:`<strong>Operación saludable.</strong> Todos los productos están dentro del margen de control esperado. Sin alertas activas en este período.` });

    // Helpers
    const [cOk, cWarn, cCrit] = ['#1a7a4a', '#c0870c', '#c0392b'];
    function vc(pct) { const a = Math.abs(pct); return a <= 10 ? cOk : a <= 25 ? cWarn : cCrit; }
    const inv      = invActual;
    const fecha    = new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const invFecha = inv.fecha ? new Date(inv.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' }) : '—';

    // Limpiar overlay anterior si existiera
    document.getElementById('rdOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'rdOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9998;overflow-y:auto;background:#1a1916';

    overlay.innerHTML = `
<style>
.rd-paper{background:#fff;width:216mm;padding:18mm 18mm 16mm;margin:58px auto 24px;box-shadow:0 4px 40px rgba(0,0,0,.55);font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1a1916}
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
.rd-t td{padding:4px 7px;border-bottom:1px solid #f0f0ec;vertical-align:middle}
.rd-t tr:last-child td{border-bottom:none}
.tc{text-align:center!important}.tr{text-align:right!important}
.rd-rank{display:inline-block;width:18px;height:18px;border-radius:50%;background:#1a1916;color:#f5c842;font-size:9px;font-weight:900;text-align:center;line-height:18px}
.rd-foot{margin-top:18px;padding-top:10px;border-top:1px solid #eee;font-size:9px;color:#bbb;text-align:center}
@media print{
  body>*:not(#rdOverlay){display:none!important}
  #rdOverlay{position:static!important;overflow:visible!important;background:white!important}
  #rd-toolbar{display:none!important}
  .rd-paper{box-shadow:none!important;width:100%!important;margin:0!important;padding:12mm 14mm!important;page-break-after:always;break-after:page}
}
</style>

<div id="rd-toolbar" style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#1a1916;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.5)">
  <span style="color:#f5f0e8;font-size:14px;font-weight:700">📊 Reporte Directivo — ${etx(inv.nombre || 'Inventario')}</span>
  <div style="display:flex;gap:8px">
    <button onclick="window.print()" style="padding:7px 18px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;background:#f5c842;color:#1a1916;border:none">🖨️ Imprimir / Exportar PDF</button>
    <button onclick="document.getElementById('rdOverlay').remove()" style="padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;background:transparent;border:1px solid rgba(255,255,255,.3);color:#f5f0e8">✕ Cerrar</button>
  </div>
</div>

<!-- ═══════════════════════════════════ PÁGINA 1 — RESUMEN EJECUTIVO -->
<div class="rd-paper">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
    <div>
      <div class="rd-h1">${tipoIcon(inv.tipoInv)} ${etx(inv.nombre || 'Inventario')}</div>
      <div class="rd-sub">${inv.negocio ? inv.negocio + ' · ' : ''}${invFecha}${inv.turno ? ' · ' + inv.turno : ''}${inv.area ? ' · ' + inv.area : ''} · ${inv.cerrado ? '<strong style="color:#c0392b">CERRADO</strong>' : '<em>BORRADOR</em>'}</div>
    </div>
    <div style="text-align:right;font-size:9px;color:#aaa;line-height:1.8">
      Reporte Directivo<br>${fecha}
    </div>
  </div>

  <!-- KPIs -->
  <div class="rd-sec">Resumen ejecutivo</div>
  <div class="rd-kgrid rd-k6" style="margin-bottom:8px">
    <div class="rd-kpi">
      <div class="rd-kl">Capital a costo</div>
      <div class="rd-kv">$${capitalCosto.toFixed(0)}</div>
      <div class="rd-ks">Existencia valorada</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Capital a carta</div>
      <div class="rd-kv" style="color:${cOk}">$${capitalCarta.toFixed(0)}</div>
      <div class="rd-ks">Valor potencial de venta</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Margen potencial</div>
      <div class="rd-kv" style="color:${cOk}">$${margenPot.toFixed(0)}</div>
      <div class="rd-ks">Carta − costo</div>
    </div>
    <div class="rd-kpi" style="border-left:4px solid ${difTotal >= 0 ? cOk : cCrit}">
      <div class="rd-kl">Diferencia total</div>
      <div class="rd-kv" style="color:${difTotal >= 0 ? cOk : cCrit}">${difTotal >= 0 ? '+' : ''}$${difTotal.toFixed(2)}</div>
      <div class="rd-ks">${difTotal >= 0 ? 'Sobrante' : 'Faltante'} en inventario</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Cancelaciones POS</div>
      <div class="rd-kv" style="color:${numCancel > 5 ? cCrit : numCancel > 0 ? cWarn : '#555'}">${numCancel}</div>
      <div class="rd-ks">Registros del período</div>
    </div>
    <div class="rd-kpi" style="border-left:4px solid ${totalDesc > 0 ? cWarn : '#e8e8e0'}">
      <div class="rd-kl">Descuentos aplicados</div>
      <div class="rd-kv" style="color:${totalDesc > 0 ? cWarn : '#555'}">$${totalDesc.toFixed(0)}</div>
      <div class="rd-ks">Total del período</div>
    </div>
  </div>

  <!-- Semáforo de control -->
  <div class="rd-sec">Control de inventario — semáforo por producto</div>
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
          <td class="tc">${a.ventaCopa > 0 ? a.ventaCopa.toFixed(1)+' c' : '—'}</td>
          <td class="tc">${a.ventaBot > 0 ? a.ventaBot+' b' : '—'}</td>
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

  <!-- Productos sin movimiento -->
  ${estancados.length > 0 ? `
  <div class="rd-sec">Productos sin movimiento (${estancados.length}) — evaluar sobre-stock o baja demanda</div>
  <div style="display:flex;flex-wrap:wrap;gap:5px">
    ${estancados.slice(0, 20).map(a => `<span style="font-size:10px;background:#f5f5f0;border:1px solid #e0e0d8;border-radius:4px;padding:2px 8px;color:#666">${etx(a.f.nombre)}</span>`).join('')}
    ${estancados.length > 20 ? `<span style="font-size:10px;color:#aaa;padding:2px 8px">+${estancados.length - 20} más…</span>` : ''}
  </div>
  ` : ''}

  ${_seccionCompuestosDirectivo()}

  <div class="rd-foot">Reporte Directivo · ${inv.negocio || ''} · ${fecha} · ETAAX Sistema de Inventarios</div>
</div>

<!-- ═══════════════════════════════════ PÁGINA 2 — DESGLOSE COMPLETO -->
<div class="rd-paper" style="margin-bottom:40px">

  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #1a1916">
    <span style="font-size:14px;font-weight:900;color:#1a1916">${etx(inv.nombre || 'Inventario')} — Desglose por familia</span>
    <span style="font-size:9px;color:#aaa">${invFecha} · ${fecha}</span>
  </div>

  <!-- Faltantes críticos -->
  ${alertasCrit.length > 0 ? `
  <div class="rd-sec" style="color:${cCrit};border-color:${cCrit}">🔴 Faltantes críticos — varianza &gt; 25% (acción inmediata recomendada)</div>
  <table class="rd-t" style="margin-bottom:14px">
    <thead><tr>
      <th>Producto</th><th class="tc">Familia</th>
      <th class="tc">Físico</th><th class="tc">Teórico</th>
      <th class="tc">Diferencia</th><th class="tc">Varianza %</th>
      <th class="tr">Dif. $</th>
    </tr></thead>
    <tbody>
      ${alertasCrit.map(a => {
        const u = a.f.tipo === 'pza' ? 'pza' : 'cop';
        return `<tr>
          <td style="font-weight:600">${etx(a.f.nombre)}</td>
          <td class="tc" style="color:#888">${a.f.familia || a.f.categoria || '—'}</td>
          <td class="tc">${a.fisico.toFixed(1)} ${u}</td>
          <td class="tc">${a.teorico.toFixed(1)} ${u}</td>
          <td class="tc" style="font-weight:700;color:${cCrit}">${a.dif >= 0 ? '+' : ''}${a.dif.toFixed(1)}</td>
          <td class="tc" style="color:${cCrit};font-weight:700">${a.varPct.toFixed(1)}%</td>
          <td class="tr" style="color:${cCrit};font-weight:700">${a.difCosto >= 0 ? '+' : ''}$${a.difCosto.toFixed(2)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
  ` : ''}

  <!-- Sobrantes significativos -->
  ${alertasSob.length > 0 ? `
  <div class="rd-sec" style="color:${cWarn};border-color:${cWarn}">🟡 Sobrantes significativos — varianza &gt; 25% positiva (verificar captura)</div>
  <table class="rd-t" style="margin-bottom:14px">
    <thead><tr>
      <th>Producto</th>
      <th class="tc">Físico</th><th class="tc">Teórico</th>
      <th class="tc">Diferencia</th><th class="tc">Varianza %</th>
      <th class="tr">Dif. $</th>
    </tr></thead>
    <tbody>
      ${alertasSob.map(a => {
        const u = a.f.tipo === 'pza' ? 'pza' : 'cop';
        return `<tr>
          <td style="font-weight:600">${etx(a.f.nombre)}</td>
          <td class="tc">${a.fisico.toFixed(1)} ${u}</td>
          <td class="tc">${a.teorico.toFixed(1)} ${u}</td>
          <td class="tc" style="font-weight:700;color:${cWarn}">+${a.dif.toFixed(1)}</td>
          <td class="tc" style="color:${cWarn};font-weight:700">+${a.varPct.toFixed(1)}%</td>
          <td class="tr" style="color:${cOk};font-weight:700">+$${a.difCosto.toFixed(2)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
  ` : ''}

  <!-- Inventario completo por familia -->
  <div class="rd-sec">Inventario completo por familia</div>
  ${Object.entries(gruposTabla).map(([grp, items]) => {
    let gDif = 0;
    const rows = items.map(a => {
        gDif += a.difCosto;
        const u = a.f.tipo === 'pza' ? 'pza' : 'cop';
        const entStr = a.f.tipo === 'pza'
            ? (a.entBot > 0 ? '+' + a.entBot + ' p' : '—')
            : (a.entBot > 0 ? '+' + a.entBot.toFixed(1) + ' b' : '—');
        const ventStr = a.f.tipo === 'pza'
            ? (a.ventaBot > 0 ? a.ventaBot + ' p' : '—')
            : (a.ventaCopa > 0 ? a.ventaCopa.toFixed(1) + ' c' : (a.ventaBot > 0 ? a.ventaBot + ' b' : '—'));
        const cmStr = (a.cortesia + a.merma) > 0 ? (a.cortesia + a.merma).toFixed(1) : '—';
        const vcol  = vc(a.varPct);
        return `<tr>
          <td style="font-weight:600;max-width:125px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${etx(a.f.nombre)}</td>
          <td class="tc" style="color:#888">${a.ea.toFixed(1)} ${u}</td>
          <td class="tc" style="color:${cOk}">${entStr}</td>
          <td class="tc">${ventStr}</td>
          <td class="tc" style="color:${(a.cortesia+a.merma)>0?'#7d5fa3':'#ccc'}">${cmStr}</td>
          <td class="tc" style="color:${a.cancel>0?cWarn:'#ccc'}">${a.cancel>0 ? a.cancel.toFixed(1) : '—'}</td>
          <td class="tc" style="font-weight:600">${a.fisico.toFixed(1)} ${u}</td>
          <td class="tc" style="color:${vcol};font-weight:700">${a.dif>=0?'+':''}${a.dif.toFixed(1)}</td>
          <td class="tc" style="color:${vcol}">${a.varPct.toFixed(0)}%</td>
          <td class="tr" style="color:${vcol};font-weight:700">${a.difCosto>=0?'+':''}$${a.difCosto.toFixed(2)}</td>
        </tr>`;
    }).join('');
    const gc = gDif >= 0 ? cOk : cCrit;
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 4px">
      <span style="font-size:11px;font-weight:700;color:#1a1916">${grp}</span>
      <span style="font-size:11px;font-weight:700;color:${gc}">${gDif>=0?'+':''}$${gDif.toFixed(2)}</span>
    </div>
    <table class="rd-t" style="margin-bottom:6px">
      <thead><tr>
        <th>Producto</th>
        <th class="tc">Exist. ant.</th>
        <th class="tc">Entradas</th>
        <th class="tc">Ventas</th>
        <th class="tc">Cort/Merma</th>
        <th class="tc">Cancel.</th>
        <th class="tc">Exist. act.</th>
        <th class="tc">Varianza</th>
        <th class="tc">%</th>
        <th class="tr">Dif. $</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }).join('')}

  <!-- Cancelaciones -->
  ${numCancel > 0 ? `
  <div class="rd-sec">Cancelaciones del período — ${numCancel} registro${numCancel !== 1 ? 's' : ''}</div>
  <table class="rd-t">
    <thead><tr>
      <th>Fecha / Hora</th><th>Producto</th>
      <th class="tc">Cant.</th><th>Autorizó</th><th>Motivo</th><th>Mesero</th>
    </tr></thead>
    <tbody>
      ${(invActual.cancelaciones || []).map(c => `<tr>
        <td style="white-space:nowrap;color:#888">${c.fechaHora||'—'}</td>
        <td style="font-weight:500">${etx(c.nombreProducto||'—')}</td>
        <td class="tc" style="font-weight:700">${c.cantidad||'—'}</td>
        <td>${c.autorizo||c.responsable||'—'}</td>
        <td style="color:#888">${c.motivo||'—'}</td>
        <td style="color:#888">${c.mesero||'—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ` : ''}

  <!-- Descuentos -->
  ${(invActual.descuentos || []).length > 0 ? `
  <div class="rd-sec">Descuentos del período — Total: <span style="color:${cCrit}">$${totalDesc.toFixed(2)}</span></div>
  <table class="rd-t">
    <thead><tr>
      <th>Fecha / Hora</th><th class="tc">%</th>
      <th class="tr">Monto $</th><th>Folio</th><th>Motivo</th><th>Autorizó</th>
    </tr></thead>
    <tbody>
      ${(invActual.descuentos || []).map(d => `<tr>
        <td style="white-space:nowrap;color:#888">${d.fechaHora||'—'}</td>
        <td class="tc">${d.porcentaje != null ? d.porcentaje + '%' : '—'}</td>
        <td class="tr" style="color:${cCrit};font-weight:700">$${(parseFloat(d.monto)||0).toFixed(2)}</td>
        <td>${d.folio||'—'}</td>
        <td style="color:#888">${d.motivo||'—'}</td>
        <td>${d.autorizo||'—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ` : ''}

  <div class="rd-foot">Reporte Directivo · ${inv.negocio || ''} · Generado: ${fecha} · ETAAX Sistema de Inventarios</div>
</div>`;

    document.body.appendChild(overlay);
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
        || parseFloat(f.mermaBase) > 0;
}
function _esRegistrado(f) { return _filaConDatos(f); }

function guardarInventario() {
    if (!invActual) return;
    // Solo guardar filas con datos capturados — evita guardar 1400+ filas vacías
    invActual.filas = filasCaptura
        .filter(_filaConDatos)
        .map(f => ({...f, existenciaFisica: calcExistencia(f)}));
    const lista = getInventarios();
    const idx   = lista.findIndex(x=>x.id===invActual.id);
    if (idx>=0) lista[idx]=invActual; else lista.push(invActual);
    const ok = setInventarios(lista);
    if (!ok) throw new Error('storage-full');
    // FORZAR el upsert a la nube: el diff de setInventarios no detecta el cambio
    // porque _persistirBorradorLocal ya mutó _cacheInv (= prev). Sin esto, el
    // inventario solo vivía en localStorage y no sincronizaba entre dispositivos.
    try { _sbUpInv(invActual); } catch(e) { console.warn('[guardarInventario upsert]', e); }
}

// Respaldo INMEDIATO del borrador en localStorage (síncrono, en cada cambio).
// No espera el debounce ni a Supabase → aunque refresques al instante, no se pierde.
function _persistirBorradorLocal() {
    if (!invActual || invActual.cerrado) return;
    try {
        invActual.filas = filasCaptura.filter(_filaConDatos).map(function(f){ return Object.assign({}, f, { existenciaFisica: calcExistencia(f) }); });
        var lista = getInventarios();
        var idx = lista.findIndex(function(x){ return x.id === invActual.id; });
        if (idx >= 0) lista[idx] = invActual; else lista.push(invActual);
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
function _autoGuardar() {
    if (!invActual) return;
    _persistirBorradorLocal(); // ← respaldo local INMEDIATO en cada cambio
    _setGuardadoInd('guardando');
    clearTimeout(_autoGuardarTimer);
    _autoGuardarTimer = setTimeout(function() {
        try { guardarInventario(); } catch(e) { console.warn('[autoGuardar]', e); return; }
        _setGuardadoInd('ok'); // queda fijo "✓ Todos los cambios guardados"
    }, 600);
}

function guardarYSalir() {
    if (!invActual) return;
    invActual.cerrado = true;
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
        invActual.cerrado = true;
        let ok = false;
        try { guardarInventario(); ok = true; } catch(e) {}
        if (!ok) { invActual.cerrado = false; alert('No se pudo guardar (almacenamiento lleno).'); return; }
        mostrarVista('vistaLista');
    });
}

function cerrarInventario() {
    if (!invActual) return;
    if (invActual.cerrado) { alert('Este inventario ya está cerrado.'); return; }
    _solicitarClave('Cerrar y finalizar inventario', function() {
        invActual.cerrado = true;
        let ok = false;
        try { guardarInventario(); ok = true; } catch(e) {}
        if (!ok) { invActual.cerrado = false; alert('No se pudo guardar (almacenamiento lleno).'); return; }
        actualizarNavBtns();
        mostrarVista('vistaLista');
    });
}

function editarInventario(id) {
    _solicitarClave('Editar inventario', function() {
        // Re-abrir si estaba cerrado
        const lista = getInventarios();
        const idx   = lista.findIndex(x=>x.id===id);
        if (idx >= 0 && lista[idx].cerrado) {
            lista[idx].cerrado = false;
            setInventarios(lista);
        }
        // Cargar el inventario en memoria
        const inv = getInventarios().find(x=>x.id===id);
        if (!inv) { alert('Inventario no encontrado'); return; }
        invActual = JSON.parse(JSON.stringify(inv));
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
            ${etx(ins.nombre)}${ins.variedad ? ' <span style="color:var(--text-muted)">' + etx(ins.variedad) + '</span>' : ''}
        </button>`
    ).join('');
}

function seleccionarEntLogInsumo(id) {
    const ins = (_entLogInsumoCache || getInsumos()).find(x => x.id === id);
    if (!ins) return;
    _entRapidaInsumoId = id;
    document.getElementById('entLogInsumoId').value = id;
    document.getElementById('entLogInsumoNombre').textContent = ins.nombre + (ins.variedad ? ' ' + ins.variedad : '');
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
        registrado: new Date().toISOString()
    };
    log.push(_nuevaEnt);
    setEntradasLog(log);
    // FORZAR el upsert a la nube: setEntradasLog no detecta la nueva entrada porque
    // log === _cacheEL (misma referencia ya mutada por el push). Sin esto, la entrada
    // solo vivía en localStorage y no sincronizaba entre dispositivos.
    try { _sbUpEL(_nuevaEnt); } catch(e) { console.warn('[guardarEntradaLog upsert]', e); }

    // Also save to active inventory so it appears in vistaEntradas historial
    if (invActual) {
        if (!invActual.entradasLog) invActual.entradasLog = [];
        invActual.entradasLog.push({
            insumoId,
            nombreProducto: ins ? ins.nombre + (ins.variedad ? ' ' + ins.variedad : '') : '—',
            cantidad,
            costo,
            tipo,
            notas,
            fecha
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
                    ${insumoMeta(fila) ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${etx(insumoMeta(fila))}</div>` : ''}
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
    if (!invActual.entradasLog) invActual.entradasLog = [];
    invActual.entradasLog.push({
        insumoId:       _entRapidaInsumoId,
        nombreProducto: fila?.nombre || _entRapidaInsumoId,
        tipo:           _entRapidaTipo,
        cantidad:       cant,
        fecha
    });
    guardarEntradas();
    const cantEl = document.getElementById('entRapidaCant');
    if (cantEl) { cantEl.value = ''; cantEl.focus(); }
    renderFormEntrada();
    renderListadoEntradas();
    renderChipsEntrada();
}

function eliminarEntradaRapida(idx) {
    _pedirClaveAdmin('Eliminar entrada', function() {
        if (!invActual?.entradasLog) return;
        invActual.entradasLog.splice(idx, 1);
        guardarEntradas();
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

function renderListadoEntradas() {
    const cont = document.getElementById('entLogList');
    if (!cont) return;
    // Use inventory-specific log when active, global log otherwise
    let log, useGlobal;
    if (invActual) {
        log = invActual.entradasLog || [];
        useGlobal = false;
    } else {
        log = [...getEntradasLog()].filter(function(e){ return _entEnPeriodo(e.fecha); }).reverse();
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
    cont.innerHTML = rows.map((e) => {
        const color   = tipoEntradaColor(e.tipo);
        const nombre  = etx(e.nombreProducto || e.nombre || '—');
        const cant    = (e.cantidad||0) % 1 ? (e.cantidad||0).toFixed(1) : (e.cantidad||0);
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
            <button class="ent-log-del" title="Editar" onclick="_entEditId='${e.id}';renderListadoEntradas()">✏️</button>
            <button class="ent-log-del" title="Eliminar" onclick="eliminarEntradaPorId('${e.id}')"
                onmouseenter="this.classList.add('hover')" onmouseleave="this.classList.remove('hover')">🗑️</button>
        </div>`;
    }).join('');
}

var _entEditId = null;
function eliminarEntradaPorId(id) {
    _pedirClaveAdmin('Eliminar entrada', function() {
        if (invActual) {
            invActual.entradasLog = (invActual.entradasLog || []).filter(e => e.id !== id);
            guardarEntradas();
        } else {
            setEntradasLog(getEntradasLog().filter(e => e.id !== id));
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
        if (periodoEl) periodoEl.textContent = 'Historial global';
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
    document.getElementById('ftNombre').textContent = ins.nombre + (ins.variedad ? ' ' + ins.variedad : '');
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
                <div style="font-size:20px;font-weight:600;color:var(--text);margin-bottom:3px">${etx(ins.nombre)}</div>
                <div style="font-size:12px;color:var(--text-muted)">
                    ${[ins.variedad || ins.maduracion, insumoContenido(ins), ins.marca].filter(Boolean).join(' · ')}
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
    document.getElementById('ftNombre').textContent = ins.nombre + (ins.variedad ? ' ' + ins.variedad : '');
    const p = (ins.presentaciones || [])[0] || {};
    document.getElementById('ftBody').innerHTML = `
        <div class="ft-grid">
            <div><label class="ft-lbl">Nombre</label><input id="ft_nombre" class="ft-input" value="${(ins.nombre||'').replace(/"/g,'&quot;')}"></div>
            <div><label class="ft-lbl">Variedad</label><input id="ft_variedad" class="ft-input" value="${(ins.variedad||'').replace(/"/g,'&quot;')}"></div>
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
