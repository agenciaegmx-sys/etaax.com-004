/* ============================================================
   ETAAX — Inventarios  v4
   ============================================================ */

// ── Helpers de sesión (mirror de app.js para páginas sin app.js) ──
function getNegocioActivo() { return localStorage.getItem('etaax_negocio_activo') || ''; }
/* Puente al almacenamiento grande (etaax-store.js). Las páginas siguen leyendo y
   escribiendo igual; por debajo, las claves que crecen (catálogo, recetas,
   inventarios) viven en IndexedDB y ya no compiten por los 5 MB de localStorage.
   Si el store no está cargado, todo cae a localStorage como siempre. */
/* Espera a que el almacenamiento grande (IndexedDB) tenga su copia en memoria.
   Sin esto, una pestaña que abre después de que otra migró el catálogo leería
   localStorage vacío y arrancaría sin datos. Son milisegundos; si el store no
   está cargado, sigue de largo como siempre. */
function _conStore(fn) {
    if (window.etaaxStore && etaaxStore.ready && etaaxStore.ready.then)
        etaaxStore.ready.then(fn, fn);
    else fn();
}
function _skPut(k, v) {
    if (window.etaaxStore) return etaaxStore.set(k, v);
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
}
function _skRaw(k) {
    if (window.etaaxStore) return etaaxStore.get(k);
    try { return localStorage.getItem(k); } catch (e) { return null; }
}
function _skDel(k) {
    if (window.etaaxStore) return etaaxStore.del(k);
    try { localStorage.removeItem(k); } catch (e) {}
}
function _sk(key) {
    var id = getNegocioActivo();
    return id ? ('etaax_' + id + '_' + key) : ('etaax_' + key);
}
/* ══ SE LEE DE DONDE SE ESCRIBE ═══════════════════════════════════════════
   _skPut escribe en el almacén (etaax-store), pero esto leía el localStorage
   CRUDO, confiando en que el almacén parchaba `localStorage.getItem`. En
   Chromium ese parche no surte efecto —definir `getItem` sobre localStorage
   crea un DATO llamado «getItem», no reemplaza el método—, así que aquí se
   leía una copia vieja que quedaba en localStorage, o nada: el inventario
   arrancaba con el catálogo de hace días (Edwin: «190 de 230»), o vacío,
   hasta que llegaba la nube. Ahora se lee por el almacén, igual que se
   escribe. */
function _skGet(key) {
    var k = _sk(key), raw = _skRaw(k);
    if (raw !== null && raw !== undefined) return raw;
    var id = getNegocioActivo();
    if (!id) return null;
    var legacy = _skRaw('etaax_' + key);
    if (legacy && legacy !== 'null') { _skPut(k, legacy); return legacy; }
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
/* ══ UNA LECTURA DE ANTES DE HIDRATAR ES PROVISIONAL ══════════════════════
   El catálogo local vive en IndexedDB y tarda un momento en cargar. Leído
   antes, el puente devuelve la copia vieja de localStorage o NADA, y esta
   función se quedaba con eso para siempre: el inventario arrancaba con el
   catálogo en cero (o viejo) aunque el dispositivo sí tuviera el bueno. Se
   memoriza igual —misma referencia, por el índice del resolver— pero en
   cuanto el almacén termina de hidratar se vuelve a leer una vez. Lo que
   llega de la nube nunca es provisional. */
var _catProvisional = false;
function _almacenHidratado() {
    return !(window.etaaxStore && typeof etaaxStore.hidratado === 'function') || etaaxStore.hidratado();
}
function getInsumos() {
    if (_cacheInsumosInv && !(_catProvisional && _almacenHidratado())) return _cacheInsumosInv;
    var prov = !_almacenHidratado();
    try { _cacheInsumosInv = JSON.parse(_skGet('insumos')) || []; } catch (e) { _cacheInsumosInv = []; }
    _catProvisional = prov;
    return _cacheInsumosInv;
}
// Resolver id→insumo con la fábrica compartida (insumo-label.js): misma lógica que
// insumos.js/app.js; fuente = getInsumos de este módulo.
function _sucursalInventario() {
    return (typeof invActual !== 'undefined' && invActual && invActual.sucursalId)
        || localStorage.getItem('etaax_sucursal_activa') || '';
}
window._insumoResolver = window._makeInsumoResolver(getInsumos, null, _sucursalInventario);
// Resolver id→receta CANÓNICO por sucursal (mismo patrón): recetas/sub-recetas guardan el
// id del maestro; si hay copia de receta para la sucursal activa, la devuelve transparente.
if (typeof window._makeRecetaResolver === 'function') window._recetaResolver = window._makeRecetaResolver(getRecetas);
// Identidad estable para enlazar filas antiguas (maestro) y locales (copia).
// El nombre y la sucursal seleccionada no cambian el parentesco por ID.
function _canonInsumoId(id) {
    if (!id) return id;
    // Identidad independiente de los nombres y del contexto de navegación.
    // El resolver devuelve una ficha local; aquí necesitamos el parentesco real.
    var r = _indiceInsumosInv()[id];
    return (r && r.origenId) || id;
}
var _catIdentidadInv = null, _idxIdentidadInv = {};
function _indiceInsumosInv() {
    var cat = getInsumos();
    if (_catIdentidadInv !== cat) {
        _catIdentidadInv = cat; _idxIdentidadInv = {};
        cat.forEach(function(x){ if (x && x.id) _idxIdentidadInv[x.id] = x; });
    }
    return _idxIdentidadInv;
}
// El documento manda en el catálogo; sin inventario se usa el contexto activo.
// Sin esto, el inventario leía los insumos de TODAS las sucursales y los duplicaba.
function _scopeSucInsumos(lista) {
    const s = _sucursalInventario();
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
    const s = _sucursalInventario();
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
/* ══ DIAGNÓSTICO DE LA COLA ════════════════════════════════════════════════
   Se corre en la consola: _invDiag()

   Existe porque "371 cambios pendientes cada vez que abro" tiene al menos tres
   causas distintas y desde fuera se ven idénticas:
     · se encolan y suben bien, pero algo las vuelve a encolar en cada carga;
     · se encolan y el servidor las rechaza (RLS), así que nunca bajan;
     · el respaldo local tiene registros que la nube no devuelve, y el merge los
       re-sube una y otra vez.
   Adivinar cuál es cuesta más que medirlo. */
window._invDiag = async function () {
    var negId = getNegocioActivo();
    var out = { negocio: negId };

    var locEL = []; try { locEL = JSON.parse(_skGet(_sk('el_local')) || '[]') || []; } catch (e) {}
    var locInv = []; try { locInv = JSON.parse(_skGet(_sk('inv_local')) || '[]') || []; } catch (e) {}
    out.entradas_local = locEL.length;
    out.inventarios_local = locInv.length;

    try {
        var rE = await _supabase.from('entradas_log').select('datos').eq('negocio_id', negId);
        var rI = await _supabase.from('inventarios').select('datos').eq('negocio_id', negId);
        out.entradas_nube = rE.error ? ('ERROR: ' + rE.error.message) : (rE.data || []).length;
        out.inventarios_nube = rI.error ? ('ERROR: ' + rI.error.message) : (rI.data || []).length;
        if (!rE.error) {
            var enNube = {};
            (rE.data || []).forEach(function (x) { if (x.datos && x.datos.id) enNube[x.datos.id] = 1; });
            var faltan = locEL.filter(function (e) { return e && e.id && !enNube[e.id]; });
            out.entradas_que_el_merge_resube = faltan.length;
            out.ejemplo_id_faltante = faltan.length ? faltan[0].id : null;
        }
    } catch (e) { out.nube = 'no se pudo leer: ' + (e && e.message); }

    /* Una escritura de prueba dice si el servidor ACEPTA lo que se le manda —
       que es la diferencia entre "no bajan" y "no se están mandando". */
    try {
        var pruebaId = 'diag_' + Date.now().toString(36);
        var w = await _supabase.from('entradas_log').insert({ id: pruebaId, negocio_id: negId, datos: { id: pruebaId, _diag: true } });
        out.puede_escribir = w.error ? ('NO · ' + w.error.message) : 'sí';
        if (!w.error) await _supabase.from('entradas_log').delete().eq('id', pruebaId);
    } catch (e) { out.puede_escribir = 'NO · ' + (e && e.message); }

    out.cola_pendientes = (typeof _sbPendientes === 'function') ? _sbPendientes() : '?';
    var cola = (typeof _sbOutbox === 'function') ? _sbOutbox() : [];
    var porTabla = {}; cola.forEach(function (x) { porTabla[x.tabla] = (porTabla[x.tabla] || 0) + 1; });
    out.cola_por_tabla = porTabla;
    out.cola_con_reintentos = cola.filter(function (x) { return (x.intentos || 0) > 0; }).length;

    console.log('──── DIAGNÓSTICO DE INVENTARIOS ────');
    Object.keys(out).forEach(function (k) { console.log('  ' + k + ':', out[k]); });
    return out;
};

/* ══ LEER LAS TABLAS ENTERAS (19-nov-2026) ═══════════════════════════════
   Todo esto se leía con UNA consulta —select('datos').eq('negocio_id', …)—,
   y Supabase entrega como mucho 1000 renglones por consulta, sin error y sin
   aviso. Con más de mil insumos (las copias por sucursal suman rápido), el
   catálogo del inventario se CORTABA por orden de id: los `prod_…` —los
   insumos de producción propia— caen al final y eran justo los que faltaban.
   Por eso «no aparecen los prebatch en el Paso 3» aunque Recetas dijera
   «✓ Agregado a insumos», y por eso renglones de batches que parecían
   borrados. Peor: la lista cortada se guardaba ENCIMA de la copia local
   completa que dejaba el módulo de Insumos.
   Ahora se lee por cursor con etaaxLeerTodo (etaax-db.js), que sigue hasta el
   final y dice si quedó incompleto. Devuelve la forma de supabase-js
   ({ data:[{datos}], error }) para que los que lo usan no cambien, más
   `parcial` cuando un fallo cortó la lectura a medio camino. */
function _leerTablaInv(tabla, negId, opc) {
    opc = opc || {};
    if (typeof window.etaaxLeerTodo !== 'function') {          // respaldo: como antes
        return Promise.resolve(_supabase.from(tabla).select('datos').eq('negocio_id', negId))
            .then(function (r) { return { data: (r && r.data) || [], error: (r && r.error) || null, parcial: false }; });
    }
    return window.etaaxLeerTodo(tabla, negId, { idCol: opc.idCol, pagina: opc.pagina }).then(function (res) {
        var data = (res.filas || []).map(function (d) { return { datos: d }; });
        if (!res.completa) console.warn('[inv] ' + tabla + ' quedó incompleta (' + data.length + '): ' + res.motivo);
        return { data: data, error: (!res.completa && !data.length) ? { message: res.motivo || 'sin respuesta' } : null,
                 parcial: !res.completa, motivo: res.motivo };
    }, function (e) { return { data: [], error: { message: String((e && e.message) || e) }, parcial: true }; });
}
function _leerCatalogoInv(negId) { return _leerTablaInv('negocio_insumos', negId, { idCol: 'insumo_id' }); }
/* Un catálogo cortado por un fallo NO reemplaza a uno más completo. */
function _catalogoSirve(r) {
    return !!r && !r.error && (r.data || []).length > 0 &&
        !(r.parcial && (_cacheInsumosInv || []).length > r.data.length);
}

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

/* ¿Ya llegaron los datos de la nube? Mientras no, la pantalla dice «cargando»
   en vez de enseñar una lista vacía: una lista vacía es una AFIRMACIÓN —«no hay
   nada»— y aquí lo cierto es que todavía no se sabe. */
var _INV_CARGADO = false;

async function _sbInitInv() {
    var negId = getNegocioActivo();
    if (!negId || typeof _supabase === 'undefined') return;
    var r = await Promise.all([
        _leerTablaInv('inventarios', negId, { pagina: 50 }),     // cada inventario trae todos sus renglones: páginas chicas
        _leerTablaInv('entradas_log', negId),
        _leerTablaInv('recetas', negId),
        /* Ordenado por insumo_id, NO por created_at: `negocio_insumos` no tiene esa
           columna y PostgREST devolvía 400. La carga del catálogo del inventario
           llevaba fallando en silencio (el error solo se veía en Network) y solo
           funcionaba de rebote, por la copia que dejaba en localStorage la página
           de Insumos — de ahí el "inventario sin insumos si no pasas antes por el
           catálogo". app.js ya ordenaba bien por insumo_id. */
        _leerCatalogoInv(negId),
    ]);
    // .filter(Boolean): si una fila viene con datos:null NO debe entrar al cache —
    // un null en _cacheEL reventaba el render del historial de entradas (TypeError).
    if (!r[0].error) { _cacheInv = (r[0].data || []).map(function(x){ return x.datos; }).filter(Boolean); _marcarSynced(_cacheInv.map(function(c){ return c && c.id; })); }
    _mergeDraftsLocal(); // recuperar borradores que aún no sincronizaron a la nube
    if (!r[1].error) {
        _cacheEL = (r[1].data || []).map(function(x){ return x.datos; }).filter(Boolean);
        // Lo que la nube SÍ trae, queda marcado: es lo que después permite saber
        // que algo desapareció porque lo borraron, y no porque nunca subió.
        _marcarSyncedEL(_cacheEL.map(function(e){ return e && e.id; }));
    }
    _mergeELLocal(true); // ya se sabe qué hay en la nube: aquí SÍ se re-sube lo que falte
    if (!r[2].error) _cacheRecetasInv = (r[2].data || []).map(function(x){ return x.datos; }).filter(Boolean);
    await _pullInvAjustes(negId); // compuestos + bateo desde la nube → localStorage
    if (_catalogoSirve(r[3])) {
        _cacheInsumosInv = (r[3].data || []).map(function(x){ return x.datos; }).filter(Boolean);
        _catProvisional = false;
        // actualizar localStorage para compatibilidad con insumos.js
        try { _skPut(_sk('insumos'), JSON.stringify(_cacheInsumosInv.map(function(ins){ var c=Object.assign({},ins); c.foto=''; c.fotoUrl=''; return c; }))); } catch(e) {}
        /* Entrar al negocio e ir DIRECTO a editar un inventario ganaba la carrera
           contra esta carga: las filas se armaban con el catálogo vacío y el
           inventario salía sin insumos (había que ir a Insumos y volver). Si el
           inventario ya se abrió, se reconcilia desde la captura que está en
           pantalla, conservando también lo tecleado antes del autoguardado. */
        try {
            if (typeof invActual !== 'undefined' && invActual && _cacheInsumosInv.length &&
                typeof filasCaptura !== 'undefined' &&
                typeof cargarProductosCaptura === 'function') {
                if (filasCaptura.length) invActual.filas = filasCaptura.map(function(f){ return Object.assign({}, f); });
                cargarProductosCaptura();
                if (typeof pasoActual !== 'undefined' && typeof irAPaso === 'function') irAPaso(pasoActual || 1);
                else if (typeof renderStep1 === 'function') renderStep1();
            }
        } catch(e) { console.warn('[inv] re-armado de filas tras cargar insumos:', e); }
    }
    /* YA HAY DATOS DE LA NUBE: repintar LO QUE ESTÉ EN PANTALLA, no solo la
       lista de inventarios.

       EL BUG: init() repinta la vista de LISTA y nada más. Quien entraba al
       negocio y tocaba «Registro de entradas» antes de que resolviera esta
       carga —que es lo normal, son cuatro consultas— veía la pantalla armada
       con el respaldo local: contador en 637 y la lista vacía, porque esas
       entradas de respaldo no traían el sello de sucursal con el que se filtra.
       Cuando los datos buenos llegaban, nadie repintaba. De ahí el «hay que
       refrescar o salir y entrar para que se vean».

       No se repinta a ciegas: si hay un inventario abierto con captura a medias,
       rearmarlo le movería el piso a quien está contando. */
    _INV_CARGADO = true;
    if (!_refrescandoInv && typeof _quitarAvisoCatalogo === 'function') _quitarAvisoCatalogo();   // ya llegó la nube
    try {
        var _ve = document.getElementById('vistaEntradas');
        if (_ve && _ve.style.display !== 'none') renderVistaEntradas();
        else if (typeof init === 'function') init();
    } catch (e) { if (typeof init === 'function') init(); }
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
/* LA REGLA QUE FALTABA en cada relectura del servidor:

     si un registro todavía tiene un cambio MÍO esperando en la cola, la copia
     del servidor es vieja por definición y no puede pisar la mía.

   Sin esto: borras una entrada —que se marca con una bandera y se sube—, el
   envío se atora, llega un evento de realtime, se relee del servidor la versión
   SIN la bandera… y la entrada revive. Y como cada reintento del envío atorado
   vuelve a disparar realtime, la pantalla se recarga sola una y otra vez y no
   deja ni escribir. Fue lo que le pasó a Edwin con cuatro movimientos atorados.

   Lo pendiente de BORRAR se quita de la lista; lo pendiente de GUARDAR se
   reemplaza por mi versión local. */
function _miCambioGana(tabla, remotos, locales) {
    var pend = (typeof sbPendientes === 'function') ? sbPendientes(tabla) : {};
    if (!Object.keys(pend).length) return remotos;
    var mios = {};
    (locales || []).forEach(function(x){ if (x && x.id) mios[x.id] = x; });
    return (remotos || []).map(function(x){
        if (!x || !x.id || !pend[x.id]) return x;
        return pend[x.id] === 'delete' ? null : (mios[x.id] || x);
    }).filter(Boolean);
}

async function _reloadEntradasRT() {
    var negId = getNegocioActivo();
    if (!negId || _elRtNeg !== negId || typeof _supabase === 'undefined') return;
    var r = await _leerTablaInv('entradas_log', negId);
    if (r.error) return;
    var frescas = (r.data || []).map(function(x){ return x.datos; }).filter(Boolean);
    frescas = _miCambioGana('entradas_log', frescas, _cacheEL);
    _marcarSyncedEL(frescas.map(function(e){ return e && e.id; }));
    // Conservar las locales aún sin sincronizar (outbox) para que no desaparezcan.
    var vistos = {}; frescas.forEach(function(e){ if (e && e.id) vistos[e.id] = 1; });
    (_cacheEL || []).forEach(function(e){ if (e && e.id && !vistos[e.id]) frescas.push(e); });
    _cacheEL = frescas;
    window._step5Dirty = true; // llegaron datos nuevos del QR → invalidar el resumen
    try { _skPut(_sk('el_local'), JSON.stringify(_cacheEL)); } catch(e) {}
    // Refrescar lo que esté en pantalla: el registro de entradas, o el inventario
    // abierto (importa las nuevas del QR al momento).
    try {
        var ve = document.getElementById('vistaEntradas');
        if (ve && ve.style.display !== 'none') {
            /* Solo lo registrado y la lista de insumos: rearmar la pantalla
               entera le quitaba el foco a la nota a medio escribir con cada
               entrada que llegaba (el eco de la nuestra incluido). */
            if (document.getElementById('entLogList')) { renderListadoEntradas(); renderChipsEntrada(); }
            else renderVistaEntradas();
            return;
        }
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
    var r = await _leerTablaInv('inventarios', negId, { pagina: 50 });
    if (r.error) return;
    var remote = (r.data || []).map(function(x){ return x.datos; }).filter(Boolean);
    remote = _miCambioGana('inventarios', remote, _cacheInv);
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
        _skPut(_sk('inv_local'), JSON.stringify(_cacheInv || []));
    } catch(e) {
        // Si no cabe (quota), al menos respaldar los borradores abiertos (lo más crítico).
        try { _skPut(_sk('inv_local'), JSON.stringify((_cacheInv||[]).filter(function(x){return x && !x.cerrado;}))); } catch(e2) {}
    }
}
function _cargarDraftsLocal() {
    try { return JSON.parse(_skRaw(_sk('inv_local')) || '[]') || []; } catch(e) { return []; }
}
// IDs que YA se vieron en la nube alguna vez. Sirve para distinguir un borrador
// nunca sincronizado (conservar) de un inventario que estaba sincronizado y se
// BORRÓ en otro dispositivo (no resucitar). Sin esto, el borrado no se propagaba.
var _syncedIds = null;
function _getSynced() {
    if (!_syncedIds) { try { _syncedIds = JSON.parse(_skRaw(_sk('inv_synced')) || '{}') || {}; } catch(e) { _syncedIds = {}; } }
    return _syncedIds;
}
function _marcarSynced(ids) {
    var s = _getSynced(), ch = false;
    (ids || []).forEach(function(id){ if (id && !s[id]) { s[id] = 1; ch = true; } });
    if (ch) { try { _skPut(_sk('inv_synced'), JSON.stringify(s)); } catch(e) {} }
}
function _mergeDraftsLocal() {
    var locales = _cargarDraftsLocal();
    if (!locales.length) return;
    if (!_cacheInv) _cacheInv = [];
    var ids = {}; _cacheInv.forEach(function(x){ if (x && x.id) ids[x.id] = 1; });
    var synced = _getSynced();
    locales.forEach(function(d){
        if (!d || !d.id) return;
        // Solo recuperar/re-subir borradores que NUNCA se sincronizaron. Si ya estuvo
        // en la nube y ahora no está, fue BORRADO en otro equipo → no resucitar.
        if (!ids[d.id] && !synced[d.id]) {
            _cacheInv.push(d);
            try { _sbUpInv(d); } catch(e) {} // re-subir: una vez que la nube funcione (v17), se sincroniza solo
            return;
        }
        /* Está en los dos lados: gana el MÁS NUEVO. Si el guardado a la nube no
           alcanzó a salir (se cerró la pestaña, se cayó la red), el respaldo local
           tiene lo último que se tecleó y la nube una versión vieja — sin esto, al
           reabrir el inventario se veía el número viejo y el nuevo se perdía. */
        if (!ids[d.id]) return;
        var i = _cacheInv.findIndex(function(x){ return x && x.id === d.id; });
        if (i < 0) return;
        var tNube  = Date.parse((_cacheInv[i] && _cacheInv[i].guardadoTs) || '') || 0;
        var tLocal = Date.parse(d.guardadoTs || '') || 0;
        if (tLocal > tNube) {
            _cacheInv[i] = d;
            try { _sbUpInv(d); } catch(e) {}   // y se re-sube para que la nube se ponga al día
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
    try { _skPut(_sk('el_local'), JSON.stringify(_cacheEL || [])); } catch(e) {}
}
function _cargarELLocal() {
    try { return JSON.parse(_skRaw(_sk('el_local')) || '[]') || []; } catch(e) { return []; }
}
/* Sube a la vista lo que está en el respaldo local y no en el caché.

   `reSubir` decide si además se manda a la nube, y NO es un detalle: init() corre
   ANTES de que lleguen los datos de la nube, así que ahí el caché está vacío y
   este merge cree que la nube no tiene NADA. Con reSubir activado, re-encolaba el
   respaldo COMPLETO en cada carga — 364 entradas de golpe, todas con el mismo
   instante en el uid. Subían bien y la cola bajaba a cero… y al recargar,
   otras 364. Un ciclo perpetuo que no perdía datos pero tenía el aviso de
   "sincronizando" prendido para siempre.

   Solo se re-sube cuando de verdad se sabe qué hay en la nube (después de
   _sbInit). Antes de eso se mezcla para VER, que es lo único que init() necesita
   para pintar el historial. */
/* Entradas que ya se vieron EN LA NUBE alguna vez. Es la misma idea que
   `inv_synced` para los inventarios, y sin ella pasaba esto:

     borras una entrada, el borrado SÍ llega al servidor, pero el respaldo local
     todavía la tiene. A la siguiente carga, el servidor ya no la trae, así que
     _mergeELLocal la daba por "local sin subir"… y la volvía a empujar Y a
     subir. La entrada revivía, y cada carga generaba un envío nuevo — de ahí
     una cola que nunca baja.

   Con la marca se distingue lo que NUNCA llegó (hay que subirlo) de lo que ya
   estuvo y desapareció (lo borraron: hay que soltarlo). */
var _elSyncedIds = null;
function _getSyncedEL() {
    if (!_elSyncedIds) { try { _elSyncedIds = JSON.parse(_skRaw(_sk('el_synced')) || '{}') || {}; } catch(e) { _elSyncedIds = {}; } }
    return _elSyncedIds;
}
function _marcarSyncedEL(ids) {
    var s = _getSyncedEL(), ch = false;
    (ids || []).forEach(function(id){ if (id && !s[id]) { s[id] = 1; ch = true; } });
    if (ch) { try { _skPut(_sk('el_synced'), JSON.stringify(s)); } catch(e) {} }
}

function _mergeELLocal(reSubir) {
    var locales = _cargarELLocal();
    if (!locales.length) return;
    if (!_cacheEL) _cacheEL = [];
    var ids = {}; _cacheEL.forEach(function(x){ if (x && x.id) ids[x.id] = 1; });
    var synced = _getSyncedEL();
    var pend = (typeof sbPendientes === 'function') ? sbPendientes('entradas_log') : {};
    var quedan = [];
    locales.forEach(function(e){
        if (!e || !e.id) return;
        if (ids[e.id]) { quedan.push(e); return; }        // está en la nube: nada que hacer
        if (pend[e.id] === 'delete') return;              // yo la borré y va en camino
        if (synced[e.id]) return;                         // ya estuvo y ya no está: la borraron
        _cacheEL.push(e);
        quedan.push(e);
        if (reSubir) { try { _sbUpEL(e); } catch(err){} }
    });
    /* El respaldo local se limpia de lo que ya se soltó. Si no, en cada carga se
       vuelve a evaluar lo mismo y el respaldo crece con fantasmas para siempre. */
    if (quedan.length !== locales.length) { try { _skPut(_sk('el_local'), JSON.stringify(quedan)); } catch(e) {} }
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
let _entRapidaUm        = 'pza';      // 'pza' | 'pres' (caja/rejilla): se guarda SIEMPRE en piezas
let _entRapidaBusqueda  = '';

// Ficha técnica
let _ftInsumoId = null;

// Vista existencias paso 1 — default: búsqueda rápida
let vistaCapturaExist = 'busqueda'; // 'busqueda' | 'lista'
let _existBusqueda    = '';
let _existInsumoId    = null;

// Vista entradas paso 2 — default: búsqueda rápida
let vistaEntradas2 = 'busqueda'; // una sola vista (dos columnas); se ve en lista o cuadrícula (modoListaCapt), como el Paso 1

// Vista ventas paso 3 — default: menú
let vistaVentas    = 'busqueda'; // 'busqueda' (la primera) | 'lista' (insumos) | 'menu' (cocteles) | 'prebatch'
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
    // El editor de insumos guarda la copa en la PRESENTACIÓN; la ficha técnica de
    // inventarios la guarda en la raíz del insumo. Se miran las dos: leyendo solo
    // la raíz, definir la copa desde el catálogo no llegaba nunca al inventario.
    var _p0 = (ins.presentaciones && ins.presentaciones[0]) || {};
    var _tc = parseFloat(ins.tamanoCopa) || parseFloat(_p0.tamanoCopa) || 0;
    var _um = ((ins.tamanoCopa ? ins.umTamanoCopa : _p0.umTamanoCopa) || 'ML').toUpperCase();
    if (_tc > 0) return _um === 'OZ' ? _tc * OZ_ML : _tc;
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
/* El tipo de inventario con el ícono de la app (antes 📋 🍸 🍽️ 📦 🏪). */
const TIPOS_ICON = { primer_lev:'ins-catalogo', bebidas:'cor-bebidas', alimentos:'cor-alimentos', almacen:'ins-stock', restaurante:'restaurante', otro:'mod-inventarios' };

// Grupo grande de categoría para los reportes (legibilidad): Destilados, Licores, Vinos,
// Cervezas, Refrescos/Sodas, Alimentos, Otros. Usa tipoInsumo y, si falta (p.ej. insumos
// convertidos sin categoría), cae a heurística por subcategoría/categoría.
function _grupoCategoria(f) {
    if (!f) return 'Otros';
    /* Los batches van juntos, cada uno con su renglón y su diferencia (modelo
       de consumo, 17-nov): repartidos en Licores o Alimentos no se encuentran. */
    if (!f.esCompuesto && f.insumoId && _recetaIdDePrebatch(f.insumoId)) return '🏭 Producción propia';
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
    return EtaaxCore.cantidadBaseInventario(cantidad, unidad);
}

/* SUB-UNIDADES DEL EMPAQUE (tercer nivel) ────────────────────────────────
   El escandallo puede costear por sub-unidad: un paquete de 11 bolsas, cada bolsa
   con 40 tostadas, y la receta lleva "1 TOSTADA". Para el INVENTARIO eso hay que
   traducirlo a la unidad base del insumo — sin esto, `ingredienteML` cae a su rama
   por default y una tostada descontaría 1 ml en vez de sus 40 g.
   Se normaliza aquí, antes de acumular, para que todo lo de abajo siga viendo
   gramos y mililitros como siempre. */
function _normIngrediente(ing) {
    var cant = parseFloat(ing && ing.cantidad) || 0;
    var uni  = (ing && ing.unidad || '').toUpperCase();
    var sr = (typeof window._insumoResolver === 'function') ? window._insumoResolver(ing && ing.insumoId) : null;
    var rp = EtaaxCore.porcionSubRecetaParaUnidad(sr, uni);
    if (rp) return { cant:cant * (parseFloat(rp.contenidoPorcionBase) || 0), unidad:rp.unidadPorcionBase };
    if (uni.indexOf('RENDIMIENTO:') === 0) return { cant:0, unidad:'G' };
    if (uni !== 'SUBUNIDAD') return { cant: cant, unidad: ing && ing.unidad };
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(ing.insumoId) : null;
    var p   = ins && (ins.presentaciones || [])[0];
    if (!p) return { cant: cant, unidad: 'G' };
    if (['abarrote','fruta','carne'].indexOf(ins.tipoInsumo) >= 0) {
        var util = EtaaxCore.costosPresentacion(p, undefined, ins.tipoInsumo);
        if (util.contenidoSubUnidad > 0) return { cant: cant * util.contenidoSubUnidad, unidad: util.umBase };
    }
    var n    = parseFloat(p.unidadesPorPieza) || 0;
    // `contSub` es el contenido de UNA sub-unidad; en registros viejos solo había
    // `contNeto` (el total de la pieza) y se deriva dividiendo, igual que el catálogo.
    var cada = (p.contSub !== undefined && p.contSub !== '')
        ? parseFloat(p.contSub) || 0
        : (n > 1 ? (parseFloat(p.contNeto) || 0) / n : 0);
    if (!(cada > 0)) return { cant: cant, unidad: 'G' };
    return { cant: cant * cada, unidad: (p.umContenido || 'G').toUpperCase() };
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
    var all = _scopeSucInvs(getInventarios()).filter(_esRefValida)
        .slice().sort(function(a,b){ return String(a.fecha||'').localeCompare(String(b.fecha||'')); }); // viejo→nuevo
    // La existencia anterior debe venir de un inventario de la MISMA área: una BARRA se
    // compara contra la barra anterior, no contra una cocina/bodega que no tiene sus
    // insumos (si no, todos los insumos de barra salían con "anterior 0"). Vacío/general
    // = comodín. Si ningún ref coincide en área, no romper → devolver todos (previo).
    var invA = ((invActual && invActual.area) || '').toString().trim().toLowerCase();
    if (!invA || invA === 'general') return all;
    var mismos = all.filter(function(x){
        var a = (x && x.area || '').toString().trim().toLowerCase();
        return !a || a === 'general' || a === invA;
    });
    return mismos.length ? mismos : all;
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
// Fila de referencia para la "existencia anterior" de un insumo. Prioriza el ref
// ELEGIDO (o el más reciente); si ese ref no CONTIENE el insumo (p.ej. se saltó ese
// conteo, o venía de otra área), cae al inventario anterior más reciente —misma
// área/sucursal— que SÍ lo contó. Empata por id exacto o canónico (copias por sucursal).
function _refFilaInsumo(insumoId) {
    const refs = _refsDisponibles();            // viejo→nuevo (misma área/sucursal)
    if (!refs.length) return null;
    const pref = _getRefInv();                  // el elegido, o el más reciente
    const orden = [];
    if (pref) orden.push(pref);
    for (let i = refs.length - 1; i >= 0; i--) { if (!pref || refs[i].id !== pref.id) orden.push(refs[i]); }
    for (let k = 0; k < orden.length; k++) {
        const fs = _filasUnicasInventario(orden[k].filas || []);
        const f = fs.find(x => x && x.insumoId === insumoId)
               || fs.find(x => x && _canonInsumoId(x.insumoId) === insumoId);
        if (f) return f;
    }
    return null;
}
function getExistenciaAnterior(insumoId, alias) {
    /* `alias`: el id VIEJO de un renglón que se pasó de un insumo que ya no
       está en el catálogo a su reemplazo (_pasarRenglonPrebatch). El
       inventario anterior lo contó con el id viejo: sin buscarlo ahí, el
       batch arrancaría en cero y su faltante saldría inventado. */
    let fila = _refFilaInsumo(insumoId);
    if (!fila && alias) fila = _refFilaInsumo(alias);
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
    filasCaptura.forEach(function(f){ f.existenciaAnterior = getExistenciaAnterior(f.insumoId, f.aliasDe); });
    _setFechaUltimo();
    if (typeof _autoGuardar === 'function') _autoGuardar();
}

// Última fila de un inventario CERRADO previo (misma sucursal, distinto del actual)
// que contó este insumo → para copiar su existencia (desglose bodega/barra/pesos).
function _filaAnteriorInsumo(insumoId) {
    // Misma lógica que la etiqueta "Anterior": ref elegido → anteriores de la misma área
    // con datos (incluye ABIERTOS) → cerrados históricos como último respaldo.
    var fr = _refFilaInsumo(insumoId);
    if (fr) return fr;
    var cerrados = _scopeSucInvs(getInventarios()).filter(function(x){ return x && (x.cerrado || x.tipoInv === 'primer_lev') && (!invActual || x.id !== invActual.id); });
    for (var i = cerrados.length - 1; i >= 0; i--) {
        var f = (cerrados[i].filas || []).find(function(x){ return x && x.insumoId === insumoId; })
             || (cerrados[i].filas || []).find(function(x){ return x && _canonInsumoId(x.insumoId) === insumoId; });
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
        fila.cerradasBodega = (prev.cerradasBodega != null && prev.cerradasBodega !== '') ? prev.cerradasBodega : '';
        fila.cerradasBarra  = (prev.cerradasBarra  != null && prev.cerradasBarra  !== '') ? prev.cerradasBarra  : '';
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
/* Solo las ventas se desglosan en ingredientes. Las cancelaciones de recetas
   se conservan en el informe POS y nunca se reparten entre sus insumos. */
function _consumoIdx() {
    var recetas = getRecetas();
    // Llave BARATA + dirty-flag: antes la llave hacía JSON.stringify(vendidos) en
    // CADA llamada (200 filas × varios cálculos por render = miles de stringify)
    // — parte importante de la lentitud del Paso 5. Los 3 puntos que escriben
    // cocktailsVendidos marcan _consumoDirty.
    var key = (invActual && invActual.id || '') + '|' + recetas.length;
    if (_consumoIdxCache && !_consumoDirty && _consumoIdxKey === key) return _consumoIdxCache;
    var vendidos = (invActual && invActual.cocktailsVendidos) || {};
    var idx = {};
    function slot(id){ return idx[id] || (idx[id] = { mlBeb:0, baseBeb:0, baseAli:0, pzaDir:0, mlPza:0 }); }
    /* La receta guarda el id del insumo TAL COMO estaba al agregarlo: si el
       negocio independizó sus insumos por sucursal, ahí quedó el id de la COPIA.
       Las filas del inventario usan el id MAESTRO, así que el consumo por
       recetas no encontraba a su insumo y la coctelería salía en cero — con el
       costo del ingrediente también en $0.00, que es la otra cara del mismo
       desajuste. Se acumula y se consulta en canónico. */
    recetas.forEach(function(r){
        var uds = parseFloat(vendidos[r.id]) || 0;
        if (!uds) return;
        var esBeb = r.tipo === 'bebidas', esAli = r.tipo === 'alimentos', activa = r.status !== 'inactiva';
        if (!esBeb && !esAli) return;
        (r.ingredientes || []).forEach(function(ing){
            var id = ing.insumoId; if (!id) return;
            id = _canonInsumoId(id) || id;
            // Sub-unidad → unidad base antes de acumular (ver _normIngrediente).
            var _nz = _normIngrediente(ing);
            var cant = _nz.cant, u = (_nz.unidad || '').toUpperCase();
            ing = { insumoId: ing.insumoId, cantidad: cant, unidad: _nz.unidad };
            var base = ingredienteBase(cant, u);
            var fi = _filaDeMiembro(id);
            if (fi && (u === 'PZA' || u === 'PZ' || u === '')) {
                base = EtaaxCore.cantidadFilaInventario(cant, u, fi) * _basePorUnidadFila(fi);
            }
            /* Un PREBATCH se acumula ADEMÁS bajo su sub-receta. El id del insumo no
               sirve de identidad: al convertir una sub-receta a insumo el registro
               no lleva origenId, así que dos conversiones (una por sucursal, o una
               repetida) quedan como insumos distintos sin nada que los una, y
               _canonInsumoId no puede colapsarlos. Si el coctel apunta a uno y el
               renglón del inventario usa el otro, el consumo existe pero nadie lo
               encuentra: el batch se reparte con VENTAS EN CERO y sus insumos no
               reciben lo vendido (el caso del vino del Tinto de Verano).
               La sub-receta sí es identidad estable: dos insumos con el mismo
               recetaId son el mismo producto. */
            var _ids = [id], _rid = _recetaIdDePrebatch(id);
            if (_rid) _ids.push('sr:' + _rid);
            _ids.forEach(function (k) {
                var s = slot(k);
                if (esBeb)            s.mlBeb   += base * uds;      // copas (bebidas, cualquier estatus)
                if (esBeb)            s.baseBeb += base * uds;
                if (esAli && activa)  s.baseAli += base * uds;
                if (activa) {                                                                   // pza (bebidas+alimentos activos)
                    if (u === 'PZA' || u === 'PZ' || u === '') s.pzaDir += cant * uds;
                    else                                       s.mlPza  += base * uds;
                }
            });
        });
    });
    _consumoIdxCache = idx; _consumoIdxKey = key; _consumoDirty = false;
    return idx;
}

/* Consumo por recetas EN LA UNIDAD DE LA FILA. Una lata de 355 ml usada en un
   coctel es 1 PIEZA, no 7.9 copas: dividir entre el tamaño de copa (45 ml por
   default, aunque el insumo sea de pieza) inflaba la columna de coctelería
   casi ocho veces. El teórico ya lo hacía bien; era la vista la que mentía. */
function consumoRecetasFila(f) {
    if (!f) return 0;
    if (f.tipo === 'pza')  return calcVentasPzaRecetas(f.insumoId);
    if (f.tipo === 'peso') return _consumoRecetasBase(f.insumoId);
    return calcVentasCopasRecetas(f.insumoId, f.copaML);
}
/* El montón de consumo de UNA fila. Si la fila es un prebatch, manda el montón de
   su SUB-RECETA (ver _recetaIdDePrebatch): el coctel pudo quedar apuntando a otro
   registro del mismo batch y por su id no se encontraría nada.
   Sin esto, arreglar solo el reparto dejaba el bug a medias: la columna de uso sí
   se movía al capturar ventas del coctel, pero el TEÓRICO del batch seguía creyendo
   que no había salido nada — y por eso el Resultado y la diferencia no cambiaban. */
function _slotConsumo(insumoId, idx) {
    idx = idx || _consumoIdx();
    var rid = _recetaIdDePrebatch(insumoId);
    if (rid) {
        // Renglón duplicado del mismo batch: el principal se lleva todo (si no, doble).
        if (!_esFilaPrincipalPrebatch(insumoId)) return null;
        return idx['sr:' + rid] || null;
    }
    return idx[insumoId] || idx[_canonInsumoId(insumoId)] || null;
}
function calcVentasCopasRecetas(insumoId, copaML, idx) {
    if (!copaML || copaML <= 0) return 0;
    var s = _slotConsumo(insumoId, idx);
    return s ? s.mlBeb / copaML : 0;
}

// ── INVENTARIO DE ALIMENTOS: consumo teórico en unidad base (g/ml/pza) ──
// Convierte la cantidad de un ingrediente de receta a la unidad base chica.
function ingredienteBase(cantidad, unidad) {
    return EtaaxCore.cantidadBaseInventario(cantidad, unidad);
}
// Unidad base de un insumo de alimentos según su presentación.
function unidadBaseInsumo(ins) {
    const p = ((ins && ins.presentaciones) || [])[0] || {};
    if (ins && ['abarrote','fruta','carne'].indexOf(ins.tipoInsumo) >= 0) {
        var util = EtaaxCore.costosPresentacion(p, undefined, ins.tipoInsumo);
        if (util.contenidoBase > 0) return util.umBase;
    }
    const u = (p.umContenido || '').toUpperCase();
    if (u === 'KG' || u === 'G') return 'G';
    if (u === 'LT' || u === 'L' || u === 'ML' || u === 'OZ') return 'ML';
    return 'PZA';
}
function _contenidoBasePresentacion(ins, p) {
    if (['abarrote','fruta','carne'].indexOf(ins.tipoInsumo) >= 0) {
        var util = EtaaxCore.costosPresentacion(p, undefined, ins.tipoInsumo);
        if (util.contenidoBase > 0) return util.contenidoBase;
    }
    var um = (p.umContenido || 'ML').toUpperCase();
    var cn = parseFloat(p.contNeto) || 0;
    return EtaaxCore.cantidadBaseInventario(cn, um);
}
/* Consumo teórico de un insumo por las recetas vendidas, en UNIDAD BASE (ml/g/pza),
   venga de donde venga: bebidas o alimentos. Los dos montones son disjuntos (una
   receta es de un tipo o del otro), así que sumarlos no cuenta doble.
   Antes esto solo miraba los ALIMENTOS, y el tipo de la FILA no siempre coincide con
   el de la RECETA: un jarabe que se cuenta en gramos (fila 'peso', familia Alimentos)
   y se usa en un coctel caía en el montón de bebidas, que nadie leía aquí — el insumo
   nunca se descontaba. Al revés pasa igual con un prebatch de cocina que se va en un
   platillo. */
function _consumoRecetasBase(insumoId, idx) {
    var s = _slotConsumo(insumoId, idx);
    return s ? (s.baseBeb + s.baseAli) : 0; // ml / g
}

// Consumo de un insumo PZA (refresco/cerveza/lata) por las recetas/menú vendidos, EN PIEZAS.
// Antes no se contaba (calcVentasCopasRecetas devuelve 0 si no hay copaML) → no descontaba.
function calcVentasPzaRecetas(insumoId, idx) {
    var s = _slotConsumo(insumoId, idx);
    if (!s) return 0;
    const fila     = filasCaptura.find(f => f.insumoId === insumoId);
    const contNeto = fila ? (fila.contNeto || 0) : 0; // ml por pieza
    return s.pzaDir + (contNeto > 0 ? s.mlPza / contNeto : 0); // pza directa + (ml → piezas)
}

// ── PREBATCH: producción de batches (sub-receta→insumo) ──────────
/* ══ IDENTIDAD DE UN PREBATCH: SU SUB-RECETA, NO EL ID DEL INSUMO ══════════
   Un insumo de producción propia puede existir varias veces (una conversión por
   sucursal, una repetida, un registro viejo) y esos registros NO se enlazan entre
   sí: "Cargar como insumo" no les pone origenId, así que _canonInsumoId los deja
   como productos distintos. El recetaId sí los une: es el mismo batch.
   Todo lo que pregunta "¿cuánto de este prebatch?" —producción, consumo, reparto—
   pasa por aquí, para que no vuelva a depender de a cuál de los registros le tocó
   apuntar a la receta. */
function _recetaIdDePrebatch(insumoId) {
    if (!insumoId) return '';
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(insumoId) : null;
    return (ins && ins.esSubReceta && ins.recetaId) ? ins.recetaId : '';
}
/* Si por lo que sea el inventario trae DOS renglones de la misma sub-receta, solo
   el primero la representa. Sin esto, cada uno se llevaría la producción y las
   ventas COMPLETAS del batch y el descuento saldría al doble. */
var _srFilaCache = null, _srFilaRef = null, _srFilaLen = -1;
function _filaPrincipalSubReceta(recetaId) {
    if (_srFilaRef !== filasCaptura || _srFilaLen !== (filasCaptura || []).length || !_srFilaCache) {
        _srFilaCache = {}; _srFilaRef = filasCaptura; _srFilaLen = (filasCaptura || []).length;
        (filasCaptura || []).forEach(function (f) {
            var rid = _recetaIdDePrebatch(f && f.insumoId);
            if (rid && !_srFilaCache[rid]) _srFilaCache[rid] = f.insumoId;
        });
    }
    return _srFilaCache[recetaId] || '';
}
function _esFilaPrincipalPrebatch(insumoId) {
    var rid = _recetaIdDePrebatch(insumoId);
    if (!rid) return true;                                     // no es prebatch: nada que deduplicar
    return _filaPrincipalSubReceta(rid) === insumoId;
}
// Batches producidos de una sub-receta, sumando TODOS los registros de insumo que
// la representan (el Paso 3 pudo capturar sobre cualquiera de ellos).
function _batchesDeSubReceta(recetaId) {
    var prod = (invActual && invActual.prebatchProducidos) || {};
    var total = 0;
    Object.keys(prod).forEach(function (pid) {
        if (_recetaIdDePrebatch(pid) === recetaId) total += parseFloat(prod[pid]) || 0;
    });
    return total;
}
// Lo VENDIDO de una sub-receta por las recetas del menú, en unidad base (ml/g).
function _consumoBaseSubReceta(recetaId) {
    var s = _consumoIdx()['sr:' + recetaId];
    return s ? (s.baseBeb + s.baseAli) : 0;
}

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
    /* Por id CANÓNICO. La sub-receta guarda el id tal como estaba al agregar el
       ingrediente: si el negocio independizó sus insumos por sucursal, ahí quedó el
       id de la COPIA, mientras la fila del inventario usa el MAESTRO. Comparando
       ids crudos no empataban y la producción salía en CERO — el mismo desajuste
       que ya había dejado la coctelería en blanco. */
    var canon = _canonInsumoId(insumoId) || insumoId;
    Object.keys(prod).forEach(function(pid) {
        var n = parseFloat(prod[pid]) || 0;
        if (!n) return;
        /* ══ POR EL RESOLVER, NO POR UN .find DE ID CRUDO ══════════════════
           Un .find crudo devuelve el MAESTRO; el resolver devuelve la COPIA de
           la sucursal donde se está parado — y la copia puede tener su propia
           liga a otra sub-receta.

           Mientras esto buscaba en crudo, la PANTALLA y el CÁLCULO leían
           registros distintos: la tarjeta del Paso 3 (que sale del catálogo
           acotado a la sucursal) decía «hace Limoncello SB Bot.» y esta cuenta
           descontaba los ingredientes de la otra. Dos verdades a la vez sobre
           el mismo batch, y ninguna pantalla donde se vieran juntas.

           Manda la COPIA: es el registro que la sucursal ve y sobre el que se
           capturó. Sexto sitio de la misma familia copia↔maestro. */
        var pre = (typeof window._insumoResolver === 'function')
            ? window._insumoResolver(pid)
            : getInsumos().find(function(x){ return x.id === pid; });
        if (!pre || !pre.recetaId) return;
        var sr = (window._recetaResolver ? window._recetaResolver(pre.recetaId) : getRecetas().find(function(r){ return r.id === pre.recetaId; }));
        if (!sr) return;
        (sr.ingredientes || []).forEach(function(ing){
            if (ing && ing.insumoId && (_canonInsumoId(ing.insumoId) || ing.insumoId) === canon) {
                var _z = _normIngrediente(ing);           // sub-unidad → unidad base
                total += ingredienteBase(_z.cant, _z.unidad) * n; // x batch x #batches
            }
        });
    });
    return total; // unidad base del ingrediente (ml / g / pza)
}
/* Batches producidos de ESTE prebatch, empatando copia↔maestro.
   El Paso 3 guarda la producción bajo el id del insumo TAL COMO lo ve esa sucursal
   (si el negocio independizó sus insumos, ahí quedó el id de la COPIA), mientras la
   fila del inventario usa el MAESTRO. Buscar la llave cruda devolvía CERO batches:
   la producción no entraba al teórico del prebatch y su reparto salía en blanco.
   Es el cuarto sitio de este mismo desajuste (los otros tres: _consumoIdx,
   consumoBasesPorProduccion y consumoBasesPorProduccionDetalle). */
function _batchesProducidos(insumoId) {
    // Prebatch: identidad por SUB-RECETA (ver _recetaIdDePrebatch). Suma lo capturado
    // sobre CUALQUIER registro de insumo de esa sub-receta; si el inventario trae dos
    // renglones de la misma, solo el principal se la lleva (o se contaría doble).
    var rid = _recetaIdDePrebatch(insumoId);
    if (rid) return _esFilaPrincipalPrebatch(insumoId) ? _batchesDeSubReceta(rid) : 0;
    var prod = (invActual && invActual.prebatchProducidos) || {};
    var canon = _canonInsumoId(insumoId) || insumoId;
    var total = 0;
    Object.keys(prod).forEach(function (pid) {
        if ((_canonInsumoId(pid) || pid) === canon) total += parseFloat(prod[pid]) || 0;
    });
    return total;
}
// Producción de ESTE insumo si es un prebatch, en la unidad de su fila (copas / base / pza).
function _prodPrebatchUnidades(fila) {
    var n = _batchesProducidos(fila.insumoId);
    if (!n) return 0;
    var rB = _rendBatch(fila);
    return EtaaxCore.cantidadFilaInventario(n * rB, _unidadBaseBatch(fila), fila);
}
function _unidadBaseBatch(fila) {
    var sr = _recetaDePrebatch(fila);
    var u = String((sr && sr.camposExtra && sr.camposExtra.unidadRendimientoFinal) ||
        (fila.tipo === 'peso' ? fila.baseUnit || 'G' : 'ML')).toUpperCase();
    return u === 'KG' ? 'G' : (u === 'LT' || u === 'L' || u === 'OZ') ? 'ML' : u === 'PZ' ? 'PZA' : u;
}
function _basePorUnidadFila(fila) {
    if (fila.tipo === 'copa') return parseFloat(fila.copaML) || 0;
    if (fila.tipo === 'pza') {
        if (_recetaIdDePrebatch(fila.insumoId) && _unidadBaseBatch(fila) === 'PZA') return 1;
        return (parseFloat(fila.contNeto) || 0) || (_recetaIdDePrebatch(fila.insumoId) ? 0 : 1);
    }
    return 1;
}
function _unidadBaseDeFila(fila) {
    if (_recetaIdDePrebatch(fila.insumoId)) return _unidadBaseBatch(fila);
    if (fila.tipo === 'pza' && !(parseFloat(fila.contNeto) > 0)) return 'PZA';
    return String(fila.baseUnit || (fila.tipo === 'peso' ? 'G' : 'ML')).toUpperCase();
}
function _fmtEquivalenteBatch(cantidad, unidad) {
    var escala = String(unidad || '').toUpperCase() === 'PZA' ? 10000 : 100;
    return (Math.round((parseFloat(cantidad) || 0) * escala) / escala) + ' ' + String(unidad || 'ML').toLowerCase();
}
/* CUÁNTO RINDE UN BATCH. Es distinto de la CAPACIDAD DEL ENVASE donde se guarda:
   "Tinto de Verano" rinde 900 ml y se almacena en garrafas de 4 L. Confundirlos es
   caro — con 24 batches, tomar la garrafa daba 96 L producidos en vez de 21.6 L, y
   ese fantasma de 74 L caía como faltante repartido a los insumos de la sub-receta
   (−89 L en el batch, −55 L en el vino).

   Orden de preferencia, del dato más confiable al último recurso:
     1. el rendimiento capturado en la SUB-RECETA (lo que el usuario escribió ahí);
     2. el rendimiento de la presentación del insumo (también capturado a mano);
     3. contNeto, que en registros viejos SÍ era el rendimiento… y en los nuevos es
        la capacidad del envase. Se avisa, porque de aquí salen números inventados.
   Lo capturado manda siempre: no se "corrige" con la suma de los ingredientes,
   porque una sub-receta puede rendir menos de lo que entra (reducciones, mermas)
   y ese dato lo sabe el cocinero, no la aritmética. */
var _rendBatchAviso = {};
function _rendBatch(fila) {
    var r = _recetaDePrebatch(fila);
    if (r) {
        var cx = (r.camposExtra || {});
        var rf = parseFloat(cx.rendimientoFinal) || 0;
        if (rf > 0) {
            var u = (cx.unidadRendimientoFinal || '').toString().toUpperCase();
            return ingredienteBase(rf, u);   // a g/ml/pza
        }
    }
    var rp = parseFloat(fila.rendimientoBatch) || 0;
    if (rp > 0) return rp;
    var cn = parseFloat(fila.contNeto) || 0;
    if (cn > 0 && !_rendBatchAviso[fila.insumoId]) {
        _rendBatchAviso[fila.insumoId] = 1;
        console.warn('[inv] "' + (fila.nombre || fila.insumoId) + '": sin rendimiento de sub-receta; ' +
                     'se usa el contenido del envase (' + cn + ') como rendimiento por batch. ' +
                     'Si ese envase es solo de almacenamiento, la producción va a salir inflada.');
    }
    return cn;
}
function _recetaDePrebatch(fila) {
    if (!fila) return null;
    var cid = _canonInsumoId(fila.insumoId) || fila.insumoId;
    var ins = (typeof window._insumoResolver === 'function' && window._insumoResolver(fila.insumoId)) || (getInsumos() || []).find(function (x) {
        return x && (_canonInsumoId(x.id) || x.id) === cid;
    });
    if (!ins || !ins.esSubReceta || !ins.recetaId) return null;
    return (window._recetaResolver ? window._recetaResolver(ins.recetaId) : null)
        || (getRecetas() || []).find(function (r) { return r && r.id === ins.recetaId; })
        || null;
}

// Consumo de ESTE insumo base por la producción de batches, en la unidad de su fila.
/* Lo mismo que consumoBasesPorProduccion, pero SEPARANDO piezas de mililitros.
   Hace falta para las filas de PIEZA: una sub-receta puede pedir "1 PZA de lata"
   o "300 ML de refresco", y esos dos no se pueden sumar en el mismo montón. */
function consumoBasesPorProduccionDetalle(insumoId) {
    var prod = (invActual && invActual.prebatchProducidos) || {};
    var out = { pza: 0, ml: 0 };
    var canon = _canonInsumoId(insumoId) || insumoId;
    Object.keys(prod).forEach(function (pid) {
        var n = parseFloat(prod[pid]) || 0;
        if (!n) return;
        // Por el resolver, igual que consumoBasesPorProduccion: si esta leyera
        // el maestro y aquella la copia, las piezas y los ml de un mismo batch
        // saldrían de recetas distintas.
        var pre = (typeof window._insumoResolver === 'function')
            ? window._insumoResolver(pid)
            : getInsumos().find(function (x) { return x.id === pid; });
        if (!pre || !pre.recetaId) return;
        var sr = (window._recetaResolver ? window._recetaResolver(pre.recetaId) : getRecetas().find(function (r) { return r.id === pre.recetaId; }));
        if (!sr) return;
        (sr.ingredientes || []).forEach(function (ing) {
            if (!ing || !ing.insumoId) return;
            // Por id canónico: la sub-receta puede apuntar a la COPIA por sucursal
            // mientras la fila del inventario usa el MAESTRO.
            if ((_canonInsumoId(ing.insumoId) || ing.insumoId) !== canon) return;
            var _z2 = _normIngrediente(ing);              // sub-unidad → unidad base
            var cant = _z2.cant;
            var u = (_z2.unidad || '').toUpperCase();
            if (u === 'PZA' || u === 'PZ' || u === '') out.pza += cant * n;
            else                                        out.ml  += ingredienteBase(cant, _z2.unidad) * n;
        });
    });
    return out;
}
/* ¿Se enseña la producción aparte en la columna de Coctelería?
   SOLO cuando el batch de esa sub-receta NO se está repartiendo. Si el prebatch
   tiene fila en el inventario, el reparto ya le devuelve al insumo su parte del
   batch y la producción se cancela sola contra ella (por eso el modelo no cuenta
   doble): enseñarla además sumaría el mismo vino dos veces —lo que entró al batch
   y lo que salió vendido del batch— e inflaría el consumo al doble.
   Cuando el prebatch NO se cuenta como existencia, no hay nada que cancele: ahí
   la producción es lo único que se llevó el insumo y sí debe verse. */
function _prodPBVisible(fila, adj) {
    var p = 0;
    try { p = _consumoBaseProd(fila) || 0; } catch (e) { return 0; }
    if (!p) return 0;
    if (adj && (adj.teo || adj.fis || adj.vco || adj.venta)) return 0;   // el reparto ya lo cubre
    return p;
}

function _consumoBaseProd(fila) {
    /* PIEZA: la unidad base de la receta (ml/g) NO son piezas. Un refresco de 3 L
       usado a 300 ml por batch × 24 batches son 7200 ml = 2.4 piezas, no 7200.
       Se restaban 7200 PIEZAS del teórico y el insumo se iba a −7,189. Se convierte
       igual que el consumo por recetas: piezas directas + (ml ÷ contenido de la pieza). */
    var d = consumoBasesPorProduccionDetalle(fila.insumoId);
    return EtaaxCore.cantidadFilaInventario(d.pza, 'PZA', fila) +
           EtaaxCore.cantidadFilaInventario(d.ml, 'ML', fila); // ml/g ya normalizados
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
/* ══ UN BATCH HECHO DE OTRO BATCH ═════════════════════════════════════════
   El caso real: «Limoncello SB Bot.» son las botellas de 750 ml, y su receta
   lleva UN ingrediente — «Limoncello SB 1», que a su vez es el batch de la
   garrafa, hecho con vodka.

   El reparto bajaba UN escalón: el Limoncello de la garrafa le devolvía su
   vodka al vodka, pero el Limoncello EMBOTELLADO le devolvía su contenido al
   Limoncello de la garrafa… y ahí se quedaba. El vodka que hay dentro de las
   botellas no llegaba a ninguna parte: con 1.09 L embotellados, faltaban 0.69
   L de vodka en el Resultado sin que nada lo dijera.

   Ahora los batches se reparten EN ORDEN: primero los que alimentan a otros,
   para que cuando le toque al de abajo ya traiga lo que recibió de arriba.
   Es lo mismo que hace una lista de materiales de dos niveles — y es lo que
   el modelo decía desde el principio; solo faltaba encadenarlo. */
function _ordenPrebatches(filas) {
    /* A va ANTES que B si la receta de A lleva a B: así B hereda lo que A le
       pasó. Orden por inserción con una visita en profundidad; un ciclo
       (A lleva B y B lleva A) no puede existir en una receta real, pero si
       alguien lo captura no se cuelga: se corta y se procesa como venga. */
    var porId = {};
    filas.forEach(function (x) { porId[x.pf.insumoId] = x; });
    var orden = [], estado = {};
    function visita(x) {
        var k = x.pf.insumoId;
        if (estado[k]) return;              // 1 = en curso (ciclo), 2 = listo
        estado[k] = 1;
        (x.sr.ingredientes || []).forEach(function (ing) {
            var id = ing && ing.insumoId; if (!id) return;
            var fi = _filaDeMiembro(id);
            var hijo = fi && porId[fi.insumoId];
            /* El hijo se visita primero SOLO si es otro batch: así cuando se
               reparta él, ya traerá lo que este le entregó. */
            if (hijo && hijo !== x && estado[hijo.pf.insumoId] !== 1) visita(hijo);
        });
        estado[k] = 2;
        orden.unshift(x);                   // los padres quedan delante
    }
    filas.forEach(visita);
    return orden;
}

function _repartoPrebatch() {
    var out = { porInsumo: {}, esPB: {}, lista: [] };
    var _elegibles = [];
    (filasCaptura || []).forEach(function(pf){
        if (!pf || pf.esCompuesto) return;
        var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(pf.insumoId) : null;
        if (!ins || !ins.esSubReceta || !ins.recetaId) return;
        // Dos renglones de la misma sub-receta: solo el primero la representa, o cada
        // uno se llevaría el batch COMPLETO y el descuento saldría al doble.
        if (!_esFilaPrincipalPrebatch(pf.insumoId)) return;
        var sr = (window._recetaResolver ? window._recetaResolver(ins.recetaId) : getRecetas().find(function(r){ return r.id === ins.recetaId; }));
        if (!sr || !(sr.ingredientes || []).length) return;
        _elegibles.push({ pf: pf, ins: ins, sr: sr });
    });
    _ordenPrebatches(_elegibles).forEach(function (_e) {
        var pf = _e.pf, ins = _e.ins, sr = _e.sr;
        // Conservar TODOS los ingredientes, incluso los no ligados a un insumo:
        // si falta el rendimiento, su suma es el último recurso para el reparto.
        var partes = [], total = 0;
        (sr.ingredientes || []).forEach(function(ing){
            var _z3 = _normIngrediente(ing);                       // sub-unidad → unidad base
            var b = ingredienteBase(_z3.cant, _z3.unidad); // → ml/g base
            if (b <= 0) return;
            total += b;
            if (ing.insumoId) partes.push({ id: ing.insumoId, b: b, cantidad: _z3.cant, unidad: _z3.unidad });
        });
        if (!total) return;
        /* La producción añade _rendBatch(pf) por batch. El reparto debe dividir
           entre ESE MISMO rendimiento, no entre la suma de ingredientes:
           350 + 350 con rendimiento 750 repartía 375 de cada uno por batch,
           aunque producirlo solo descontara 350. Cada batch inventaba 25 ml
           por insumo (0.4167 copas de 60 ml). También afecta a reducciones.
           Son equivalentes de materia prima por cantidad de producto terminado;
           el contenido/capacidad de su envase no cambia la fórmula de la receta. */
        var rend = _rendBatch(pf) || total;
        // Magnitudes del prebatch en unidad BASE (ml/g)
        var toB = _basePorUnidadFila(pf);
        if (!toB) return;
        /* ══ LO QUE ESTE BATCH YA RECIBIÓ DE OTRO ════════════════════════
           Si llegó aquí después de un batch que lo lleva como ingrediente, su
           parte ya está en out.porInsumo —en las unidades de SU fila— y hay
           que devolverla a unidad base antes de repartirla hacia abajo. Sin
           esto, el vodka de las botellas de Limoncello se quedaba a medio
           camino. */
        var _rec = out.porInsumo[pf.insumoId];
        var _her = function (campo) { return _rec ? (parseFloat(_rec[campo]) || 0) * toB : 0; };
        var eaB    = (parseFloat(pf.existenciaAnterior) || 0) * toB + _her('ea');
        var entB   = (pf.tipo === 'peso' ? getEntradasBottles(pf.insumoId) : getEntradasCopas(pf)) * toB + _her('ent');
        /* Lo VENDIDO del batch, en unidad base, buscado POR SU SUB-RECETA. Dos
           razones para no usar el id del insumo ni calcVentasCopasRecetas:
             · calcVentasCopasRecetas devuelve 0 sin copaML (un prebatch de cocina se
               cuenta en gramos) y solo mira recetas de bebidas, así que un batch que
               se va en un platillo tampoco contaba;
             · el id del insumo no es identidad estable — si el coctel apunta a otro
               registro de la misma sub-receta, el consumo existe pero no se encuentra.
           En los dos casos el batch salía con venta 0 y sus insumos no recibían nada. */
        var ventaB = _consumoBaseSubReceta(ins.recetaId)
                   + (parseFloat(pf.ventasCopasDirectas) || 0) * toB
                   + (parseFloat(pf.ventasBotella) || 0) * (parseFloat(pf.contNeto) || 0)
                   + _her('vco');
        var cmB    = ((parseFloat(pf.cortesiaCopas) || 0) + (parseFloat(pf.mermaCopas) || 0)) * toB +
                     (parseFloat(pf.mermaBase) || 0) + _her('cm');
        var teoB   = calcExistenciaTeorica(pf) * toB + _her('teo');
        var fisB   = calcExistencia(pf) * toB + _her('fis');
        out.esPB[pf.insumoId] = 1;
        var desg = [];
        partes.forEach(function(p){
            // Por id canónico: si el ingrediente de la sub-receta apunta a la COPIA
            // por sucursal y la fila del inventario usa el MAESTRO, el .find crudo
            // no encontraba nada y ese insumo se quedaba SIN su parte del batch
            // (coctelería en cero aunque el prebatch sí se hubiera consumido).
            var fi = _filaDeMiembro(p.id);
            /* Sin renglón en este inventario se caía al ID CRUDO y el reporte
               imprimía «7d0b72c22» como si fuera un producto. El catálogo sí
               sabe su nombre aunque no se esté contando aquí. */
            var _insP = (typeof window._insumoResolver === 'function') ? window._insumoResolver(p.id) : null;
            var _nomP = (fi && fi.nombre) || (_insP && _insP.nombre) || '(sin renglón)';
            var porBatch = fi ? EtaaxCore.cantidadFilaInventario(p.cantidad, p.unidad, fi) : p.b;
            var baseBatch = fi ? porBatch * _basePorUnidadFila(fi) : p.b;
            var unidad = fi ? _unidadBaseDeFila(fi) : String(p.unidad || 'PZA').toUpperCase();
            if (unidad === 'KG') unidad = 'G';
            if (unidad === 'LT' || unidad === 'L' || unidad === 'OZ') unidad = 'ML';
            desg.push({ insumoId: (fi && fi.insumoId) || p.id, nombre: _nomP, ml: fisB / rend * baseBatch,
                porBatch: baseBatch, unidadBase: unidad });
            if (!fi) return; // ingrediente sin fila en este inventario → solo informativo
            var conv = function(v){ return v / rend * porBatch; }; // producto terminado → unidad de la fila
            // Se guarda bajo el id de la FILA (canónico): _repartoDe() se consulta
            // con ese id, y guardarlo bajo el de la copia lo dejaba inalcanzable.
            var _k = fi.insumoId;
            var a = out.porInsumo[_k] || (out.porInsumo[_k] = { ea:0, ent:0, vco:0, cm:0, teo:0, fis:0, dif:0, venta:0 });
            a.ea  += conv(eaB);   a.ent += conv(entB);
            a.vco += conv(ventaB); a.venta += conv(ventaB);
            a.cm  += conv(cmB);
            a.teo += conv(teoB);  a.fis += conv(fisB);
            a.dif += conv(fisB - teoB);
        });
        /* Lo heredado ya se repartió hacia abajo: si se quedara además en su
           propio renglón, el mismo producto contaría dos veces —una dentro del
           batch de arriba y otra en los insumos de este—. Se vacía. */
        if (_rec) { ['ea','ent','vco','cm','teo','fis','dif','venta'].forEach(function (c) { _rec[c] = 0; }); }
        out.lista.push({ insumoId: pf.insumoId, nombre: pf.nombre, fisML: fisB, teoML: teoB,
            rendimientoBase: rend, unidadBase: _unidadBaseBatch(pf), desglose: desg });
    });
    return out;
}
/* ══ MODELO DE CONSUMO (17-nov-2026, decisión de Edwin) ═══════════════════
   Hasta hoy el prebatch era un TRASLADO: producirlo pasaba la Sprite de su
   botella al batch, la Sprite seguía «siendo suya» y solo bajaba cuando se
   vendía la paloma; lo que le faltara al batch se repartía como faltante entre
   sus insumos. Resultado: el reporte decía «usé 1 Sprite en el prebatch» y el
   teórico de la Sprite no se movía; y si las palomas no se capturaban, la
   Sprite salía con −1 de FALTANTE aunque se hubiera usado en el batch.

   Ahora producir es CONSUMIR. La cuenta de cada insumo es:
     existencia anterior + entradas − venta en botella − venta en copas
     − coctelería (recetas que lo usan DIRECTO + batches producidos que lo usan
       DIRECTO) − cortesías − mermas  =  teórico;   físico − teórico = diferencia
   Un coctel hecho con el batch NO toca la Sprite: consume el batch. Y el batch
   es su propio renglón, con su propia diferencia (anterior + producido −
   vendido en recetas − mermas, contra lo que se contó).

   El reparto se sigue calculando, pero SOLO como información (cuánto de cada
   insumo hay dentro de un batch): ya no entra a ninguna diferencia. */
var _PREBATCH_REPARTE = false;
var _repCache = null;
var _repZero  = { ea:0, ent:0, vco:0, cm:0, teo:0, fis:0, dif:0, venta:0 };
function _repartoDe(id) { return (_PREBATCH_REPARTE && _repCache && _repCache.porInsumo[id]) || _repZero; }

/* ══ CUANDO UN PREBATCH NO SE PUEDE RASTREAR ═══════════════════════════════
   La cadena del prebatch tiene cuatro eslabones: el insumo marcado como
   producción propia, su liga a la sub-receta, la sub-receta con ingredientes,
   y un renglón en ESTE inventario. Si alguno se rompe, hoy no truena nada: el
   Resultado enseña ceros y el faltante del Campari aparece como una diferencia
   sin explicación — que termina pareciendo robo.

   Esto no arregla la cadena: la DELATA. Un cálculo que no se puede hacer tiene
   que decirlo, no devolver cero.                                             */
function _prebatchDiagnostico() {
    var out = [];
    var recs = (typeof getRecetas === 'function') ? getRecetas() : [];
    var porId = {}; recs.forEach(function (r) { if (r && r.id) porId[r.id] = r; });
    var _res = function (id) {
        return (typeof window._insumoResolver === 'function') ? window._insumoResolver(id) : null;
    };
    /* Nombre de sub-receta → la sub-receta. Sirve para delatar el caso más
       feo: un renglón que SE LLAMA como una sub-receta pero que el sistema no
       reconoce como producción propia. Ese es invisible por completo. */
    var porNombre = {};
    recs.forEach(function (r) {
        if (r && String(r.tipo || '').indexOf('sub') === 0 && r.nombre)
            porNombre[String(r.nombre).trim().toLowerCase()] = r;
    });

    (filasCaptura || []).forEach(function (f) {
        if (!f || !f.insumoId) return;
        var ins = _res(f.insumoId);
        var nom = String(f.nombre || '').trim().toLowerCase();
        if (!ins || !ins.esSubReceta) {
            /* Se compara también quitando el sufijo que pone la conversión
               («Mix Negroni PR» ← «Mix Negroni»): es como quedan nombrados. */
            var base = nom.replace(/\s*(pr|prebatch|batch)\s*$/, '');
            var sr0 = porNombre[nom] || porNombre[base];
            if (!sr0) return;
            /* Dos casos que antes decían lo mismo y se arreglan distinto:
               · el insumo EXISTE pero no está marcado → se marca y se liga;
               · el insumo YA NO ESTÁ en el catálogo (se borró al limpiar
                 duplicados de la sub-receta) → el renglón se PASA al insumo
                 de producción propia que sí existe, con lo contado y sus
                 batches. Antes los dos decían «no está marcado», y el
                 segundo no se arreglaba marcando nada. */
            if (ins) {
                out.push({ fila: f.nombre, mal: 'nolink', insumoId: f.insumoId, recetaId: sr0.id,
                    txt: 'se llama como la sub-receta «' + sr0.nombre + '» pero no está marcado como producción propia' });
                return;
            }
            var dest = _insumoPrebatchDeReceta(sr0.id);
            out.push({ fila: f.nombre, mal: 'muerto', insumoId: f.insumoId, recetaId: sr0.id, destino: dest,
                txt: dest
                    ? 'su insumo ya no está en el catálogo (se borró o se reemplazó); el de producción propia de «' +
                      sr0.nombre + '» hoy es «' + dest.nombre + '»'
                    : 'su insumo ya no está en el catálogo y «' + sr0.nombre + '» no tiene insumo de producción propia: ' +
                      'en Recetas ábrela y contesta «Sí» a «¿Usar como prebatch en el inventario?»; al volver aquí sale el botón para pasarlo' });
            return;
        }
        if (!ins.recetaId) {
            out.push({ fila: f.nombre, mal: 'sinreceta',
                txt: 'está marcado como producción propia pero no dice de qué sub-receta' });
            return;
        }
        var sr = porId[ins.recetaId];
        if (!sr) {
            out.push({ fila: f.nombre, mal: 'recetamuerta',
                txt: 'apunta a una sub-receta que ya no existe' });
            return;
        }
        if (!(sr.ingredientes || []).length) {
            out.push({ fila: f.nombre, mal: 'sinings',
                txt: 'su sub-receta «' + sr.nombre + '» no tiene ingredientes capturados' });
            return;
        }
        /* ══ LIGAS CRUZADAS ═══════════════════════════════════════════════
           EL CASO REAL, y costó dos vueltas encontrar la regla buena.

           El insumo «Limoncello SB 1» apuntaba a la sub-receta «Limoncello SB
           Bot.» —la de EMBOTELLAR, que consume Limoncello— mientras el insumo
           «Limoncello SB Bot.» apuntaba a la otra. Capturar batches en el
           primero descontaba Limoncello en vez del vodka, y todo lo demás
           estaba bien formado: ninguna comprobación de las que había se
           quejaba.

           PRIMER INTENTO, MALO: avisar cuando el nombre del insumo y el de su
           sub-receta no coincidían. La conversión les pone sufijos («Mix
           Negroni» → «Mix Negroni PR»), así que gritaba en lo normal.

           LA REGLA BUENA no compara nombres parecidos: pregunta si EXISTE una
           sub-receta que se llame EXACTAMENTE como este insumo y que no sea la
           que tiene ligada. Si existe, no hay ambigüedad posible — hay una
           receta con su nombre exacto y está apuntando a otra. «Mix Negroni
           PR» no dispara nada, porque no existe ninguna receta con ese nombre. */
        var _n = function (x) { return String(x || '').trim().toLowerCase(); };
        /* ══ EL PARENTESCO FALSO ══════════════════════════════════════════
           LA CAUSA REAL, y la que ningún aviso veía. «Limoncello SB Bot.»
           tenía origenId apuntando a «Limoncello SB 1» —de haberla creado
           duplicando— así que el sistema la tomaba por «la copia de esa
           sucursal» de la otra. El mismo recetaId daba DOS respuestas: la
           ficha enseñaba la infusión con su vodka y el cálculo usaba la de
           embotellar.

           El resolver ya no se deja engañar (insumo-label.js ignora una copia
           que se llama distinto), pero el dato sigue torcido y conviene
           arreglarlo: mientras esté así, cualquier pantalla que mire el
           origenId a pelo se vuelve a confundir. */
        var _mal = recs.find(function (r) {
            if (!r || !r.origenId) return false;
            var m = recs.find(function (y) { return y && y.id === r.origenId; });
            return m && _n(m.nombre) && _n(r.nombre) && _n(m.nombre) !== _n(r.nombre) &&
                   (r.id === sr.id || m.id === sr.id);
        });
        if (_mal) {
            var _padre = recs.find(function (y) { return y && y.id === _mal.origenId; });
            out.push({ fila: f.nombre, mal: 'parentesco', soltarId: _mal.id,
                txt: 'la sub-receta «' + _mal.nombre + '» está marcada como copia de «' +
                     ((_padre && _padre.nombre) || '?') + '», pero son recetas distintas — ' +
                     'pasa al crear una duplicando la otra' });
        }

        /* La gemela no puede ser la MISMA receta vista por otro lado. Un
           negocio con sucursales tiene una copia legítima de «Tinto de Verano
           SB» por cada una: todas se llaman igual y todas SON esa receta.
           Avisar ahí es gritar en lo normal — le salieron tres renglones de
           golpe. Se compara por la raíz, no por el id. */
        var _raiz = function (r) { return (r && (r.origenId || r.id)) || ''; };
        var gemela = recs.find(function (r) {
            return r && String(r.tipo || '').indexOf('sub') === 0 &&
                   _n(r.nombre) === _n(f.nombre) && _raiz(r) !== _raiz(sr);
        });
        if (gemela) {
            out.push({ fila: f.nombre, mal: 'ligacruzada', recetaId: gemela.id, insumoId: f.insumoId,
                txt: 'está ligado a «' + sr.nombre + '», pero existe una sub-receta que se llama ' +
                     'exactamente como él: capturar batches aquí descuenta los ingredientes ' +
                     'de la OTRA' });
        }
    });

    /* Y al revés: un coctel que se bebe un prebatch que NO tiene renglón aquí.
       Su consumo no lo descuenta nadie —ni el batch ni sus insumos—, así que
       desaparece del inventario sin dejar rastro. */
    var vendidos = (invActual && invActual.cocktailsVendidos) || {};
    var conFila = {}; (filasCaptura || []).forEach(function (f) { if (f) conFila[f.insumoId] = 1; });
    var yaDicho = {};
    recs.forEach(function (r) {
        if (!r || !(parseFloat(vendidos[r.id]) || 0)) return;
        if (r.tipo !== 'bebidas' && r.tipo !== 'alimentos') return;
        (r.ingredientes || []).forEach(function (ing) {
            var id = ing && ing.insumoId; if (!id) return;
            var cid = (typeof _canonInsumoId === 'function' && _canonInsumoId(id)) || id;
            if (conFila[id] || conFila[cid]) return;
            var ins2 = _res(id);
            if (!ins2 || !ins2.esSubReceta) return;        // insumo normal fuera del área: otra cosa
            /* FALSO POSITIVO QUE SÍ APARECIÓ AL PROBARLO: el coctel puede
               apuntar a OTRO registro del mismo batch (dos conversiones de la
               misma sub-receta no se enlazan entre sí). Eso ya está resuelto
               —el consumo se acumula por recetaId, no por id de insumo— así que
               si hay un renglón de esa MISMA sub-receta, no hay nada que avisar.
               Un aviso que grita en lo que funciona enseña a ignorarlo. */
            if (ins2.recetaId && typeof _filaPrincipalSubReceta === 'function' &&
                _filaPrincipalSubReceta(ins2.recetaId)) return;
            if (yaDicho[cid]) return; yaDicho[cid] = 1;
            out.push({ fila: ins2.nombre || '—', mal: 'sinfila',
                txt: 'se vendió en «' + r.nombre + '» pero no tiene renglón en este inventario: ' +
                     'lo que se fue de ese batch no se le descuenta a nadie' });
        });
    });
    /* EL CASO DE LA SPRITE: un refresco que se cuenta por pieza y no tiene su
       contenido (2 LT) en el catálogo. Lo que el batch usa en ml no se puede
       pasar a piezas, la conversión da CERO sin avisar y el refresco sale con
       un faltante falso de exactamente lo que se usó. */
    var _vistos = {};
    Object.keys((invActual && invActual.prebatchProducidos) || {}).forEach(function (pid) {
        if (!(parseFloat(invActual.prebatchProducidos[pid]) > 0)) return;
        var pre = _res(pid); if (!pre || !pre.recetaId) return;
        var sr = (window._recetaResolver ? window._recetaResolver(pre.recetaId) : null) || porId[pre.recetaId];
        _ingredientesSinContenido(sr).forEach(function (x) {
            if (_vistos[x.insumoId]) return; _vistos[x.insumoId] = 1;
            out.push({ fila: x.nombre, mal: 'sincontenido',
                txt: 'se cuenta por pieza pero no tiene su contenido capturado en el catálogo: lo que usa «' +
                     (pre.nombre || sr.nombre || 'el batch') + '» (' + x.porBatch + ' por batch) no se le puede descontar' });
        });
    });
    return out;
}
/* Ingredientes de una sub-receta pedidos en ml/g cuyo renglón se cuenta por
   PIEZA sin contenido por pieza: imposibles de convertir. */
function _ingredientesSinContenido(sr) {
    var out = [];
    ((sr && sr.ingredientes) || []).forEach(function (ing) {
        if (!ing || !ing.insumoId) return;
        var z = _normIngrediente(ing), u = String(z.unidad || '').toUpperCase();
        if (u === 'PZA' || u === 'PZ' || u === '' || !(parseFloat(z.cant) > 0)) return;
        var fi = _filaDeMiembro(ing.insumoId); if (!fi) return;
        var pieza = fi.tipo === 'pza' || (fi.tipo === 'peso' && String(fi.baseUnit || '').toUpperCase() === 'PZA');
        if (!pieza || parseFloat(fi.contNeto) > 0) return;
        out.push({ insumoId: fi.insumoId, nombre: fi.nombre || ing.insumoId,
                   porBatch: _fmtEquivalenteBatch(ingredienteBase(z.cant, z.unidad), u === 'KG' || u === 'G' ? 'G' : 'ML') });
    });
    return out;
}

/* El insumo de producción propia que HOY representa a una sub-receta, de
   preferencia el de la sucursal del inventario. Con el id canónico, que es
   como se llavean los renglones. */
function _insumoPrebatchDeReceta(recetaId) {
    if (!recetaId) return null;
    var cands = (getInsumos() || []).filter(function (x) {
        return x && x.id && x.esSubReceta && x.recetaId === recetaId && x.activo !== false && String(x.activo) !== '0';
    });
    if (!cands.length) return null;
    var suc = _sucursalInventario() || 'suc_principal';
    var c = (typeof window._insumoEnSuc === 'function' &&
             cands.find(function (x) { return window._insumoEnSuc(x, suc); })) || cands[0];
    return { id: c.origenId || c.id, nombre: c.nombre + (c.variedad ? ' ' + c.variedad : '') };
}
/* El nombre con el que este inventario conoce a un id, aunque el catálogo ya
   no lo tenga: para no enseñar «prod_mrbf2w05» donde había un batch. */
function _nombreEnInventario(id) {
    var buscar = function (arr) { var f = (arr || []).find(function (x) { return x && x.insumoId === id; }); return f && f.nombre; };
    return buscar(filasCaptura) || buscar(invActual && invActual.filas) ||
           buscar(invActual && invActual.respaldoIdentidad && invActual.respaldoIdentidad.filas) || '';
}
/* Pasa TODO lo que el inventario guarda de un insumo a otro: su renglón (con
   lo contado y la marca del id viejo, para su existencia anterior), los
   batches capturados, la nota, lo de fuera del impreso, las entradas y las
   cancelaciones. Solo datos: no pinta ni guarda. */
function _reapuntarInsumoEnInv(inv, viejo, nuevo) {
    if (!inv || !viejo || !nuevo || viejo === nuevo) return false;
    var filas = inv.filas || [];
    filas.forEach(function (f) {
        if (f && f.insumoId === viejo) { f.insumoId = nuevo; if (!f.aliasDe) f.aliasDe = viejo; }
    });
    // El renglón VACÍO que el insumo nuevo ya tenía sobra: el bueno es el contado.
    inv.filas = filas.filter(function (f) { return !(f && f.insumoId === nuevo && !f.aliasDe && !_filaConDatos(f)); });
    var pp = inv.prebatchProducidos;
    if (pp && pp[viejo] != null) {
        pp[nuevo] = (parseFloat(pp[nuevo]) || 0) + (parseFloat(pp[viejo]) || 0);
        delete pp[viejo];
    }
    ['notasInsumo', 'ocultosReporte'].forEach(function (k) {
        var m = inv[k];
        if (m && m[viejo] != null) { if (m[nuevo] == null) m[nuevo] = m[viejo]; delete m[viejo]; }
    });
    ['entradasLog', 'cancelaciones'].forEach(function (k) {
        (inv[k] || []).forEach(function (e) { if (e && e.insumoId === viejo) e.insumoId = nuevo; });
    });
    return true;
}
function _pasarRenglonPrebatch(viejo, nuevo) {
    if (!invActual) return;
    var dest = (typeof window._insumoResolver === 'function') ? window._insumoResolver(nuevo) : null;
    var fv = (filasCaptura || []).find(function (f) { return f.insumoId === viejo; });
    if (!dest || !fv) { alert('No se encontró el renglón o el insumo de producción propia.'); return; }
    var nomD = dest.nombre + (dest.variedad ? ' ' + dest.variedad : '');
    /* Si el nuevo YA tiene su propio conteo, no se juntan solos: juntar dos
       conteos es decidir cuál vale, y eso no lo adivina el sistema. */
    var conDatos = (filasCaptura || []).concat(invActual.filas || []).some(function (f) {
        return f && f.insumoId === nuevo && !f.aliasDe && _filaConDatos(f);
    });
    if (conDatos) {
        alert('«' + nomD + '» ya tiene su propio renglón con conteo en este inventario.' + String.fromCharCode(10, 10) +
              'No los junto solo para no perder ninguno de los dos: revisa cuál es el bueno y deja el otro en cero.');
        return;
    }
    if (!confirm('«' + fv.nombre + '» apunta a un insumo que ya no está en el catálogo.' + String.fromCharCode(10, 10) +
                 'Se va a pasar a «' + nomD + '», el insumo de producción propia de su sub-receta: lo que contaste, ' +
                 'su existencia anterior y los batches capturados se van con él, y lo que esos batches usaron se ' +
                 'descuenta de sus ingredientes.' + String.fromCharCode(10, 10) + '¿Lo pasamos?')) return;
    // Lo tecleado antes del autoguardado no se puede perder en el rearmado.
    invActual.filas = filasCaptura.map(function (f) { return Object.assign({}, f); });
    _reapuntarInsumoEnInv(invActual, viejo, nuevo);
    try {   // la marca de bateo vive aparte, por negocio y sucursal
        var b = getBateo(), i = b.indexOf(viejo);
        if (i >= 0) { b.splice(i, 1); if (b.indexOf(nuevo) < 0) b.push(nuevo); localStorage.setItem(_bateoKey(), JSON.stringify(b)); }
    } catch (e) {}
    try { cargarProductosCaptura(); } catch (e) { console.warn('[inv] pasar renglón:', e); }
    if (typeof _consumoIdxCache !== 'undefined') _consumoIdxCache = null;
    _consumoDirty = true;
    window._step5Dirty = true; window._step5Force = true;
    if (typeof _autoGuardar === 'function') _autoGuardar();
    if (typeof renderStepContent === 'function') renderStepContent();
}
window._pasarRenglonPrebatch = _pasarRenglonPrebatch;

/* ══ ARREGLAR LA LIGA DESDE DONDE SE VE EL PROBLEMA ═══════════════════════
   Un diagnóstico que no se puede atender no sirve de nada. Mandar a alguien a
   otro módulo a buscar un insumo entre tres que se llaman casi igual, para
   cambiarle una liga que no se ve por ningún lado, es pedirle que no lo haga.

   Esto cambia UN dato del insumo —a qué sub-receta produce— y es una
   operación con consecuencias: el inventario abierto empieza a descontar
   otras cosas. Por eso se pregunta con las dos recetas por su nombre, no con
   un «¿seguro?». */
async function _religarPrebatch(insumoId, recetaId) {
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(insumoId) : null;
    var nueva = getRecetas().find(function (r) { return r.id === recetaId; });
    if (!ins || !nueva) { alert('No se encontró el insumo o la sub-receta.'); return; }
    var vieja = getRecetas().find(function (r) { return r.id === ins.recetaId; });
    /* Un insumo que se llama como su sub-receta pero NUNCA se marcó como
       producción propia: ligarlo es también marcarlo. */
    var marcar = !ins.esSubReceta;
    if (!confirm(marcar
            ? '«' + (ins.nombre || '') + '» se va a marcar como producción propia de «' + (nueva.nombre || '') + '».' +
              String.fromCharCode(10, 10) + 'Los batches que captures en él van a descontar los ingredientes de esa sub-receta.' +
              String.fromCharCode(10, 10) + '¿Lo ligamos?'
            : '«' + (ins.nombre || '') + '» va a producir «' + (nueva.nombre || '') + '»' +
              (vieja ? ', en vez de «' + vieja.nombre + '»' : '') + '.' +
              String.fromCharCode(10, 10) +
              'Los batches que ya capturaste van a descontar OTROS insumos: ' +
              'revisa el Resultado después de hacerlo.' +
              String.fromCharCode(10, 10) + '¿Lo ligamos?')) return;

    var antes = ins.recetaId, antesSub = ins.esSubReceta;
    ins.recetaId = recetaId;
    if (marcar) ins.esSubReceta = true;
    var negId = getNegocioActivo();
    try {
        if (typeof _supabase !== 'undefined' && negId) {
            var r = await _supabase.from('negocio_insumos')
                .upsert({ negocio_id: negId, insumo_id: ins.id, datos: ins }, { onConflict: 'negocio_id,insumo_id' });
            if (r.error) throw r.error;
        }
        /* EL ESPEJO LOCAL. Antes esto solo cambiaba el objeto en memoria. El
           catálogo se vuelve a leer de localStorage al recargar, y el realtime
           de insumos lo repuebla desde la nube: cualquiera de los dos revivía
           la liga vieja y parecía que el botón «no hizo nada». */
        try {
            _skPut(_sk('insumos'), JSON.stringify((getInsumos() || []).map(function (x) {
                var c = Object.assign({}, x); c.foto = ''; c.fotoUrl = ''; return c;
            })));
        } catch (e2) {}
    } catch (e) {
        /* SE DESHACE. Dejar el cambio en pantalla cuando no se guardó es la
           peor de las dos opciones: se ve arreglado, se cierra el inventario,
           y al volver está igual que antes sin que nadie sepa por qué. */
        ins.recetaId = antes;
        if (marcar) ins.esSubReceta = antesSub;
        alert('No se pudo guardar el cambio, así que NO se hizo.' +
              String.fromCharCode(10, 10) + ((e && e.message) || e) +
              String.fromCharCode(10, 10) +
              'Vuelve a intentarlo; si sigue, mándame el «ver la liga (ids)» de ese renglón.');
        return;
    }
    /* Todo lo que depende de la liga cambia: el consumo, el reparto, el
       teórico. Se tiran los tres cachés y se repinta. */
    _consumoDirty = true;
    window._step5Dirty = true; window._step5Force = true;
    if (typeof renderStepContent === 'function') renderStepContent();
}
window._religarPrebatch = _religarPrebatch;

/* ══ VOLCADO DE LA CADENA, PARA CUANDO HAY QUE PREGUNTAR ══════════════════
   Llevamos tres vueltas con el mismo síntoma porque yo no veo los datos y
   quien los tiene no ve los ids. Esto copia al portapapeles los registros que
   intervienen —lo capturado, el insumo que manda, su liga, la receta que se
   usa y sus ingredientes— en texto plano, para pegarlo en un mensaje.

   Va solo lo que hace falta para rastrear la cadena: ni precios, ni
   proveedores, ni nada que no sea de este problema. */
function _copiarDiagPrebatch() {
    var L = [];
    L.push('— ETAAX · cadena del prebatch —');
    L.push('negocio: ' + (getNegocioActivo() || '?') +
           '   sucursal: ' + (localStorage.getItem('etaax_sucursal_activa') || '(global)'));
    L.push('inventario: ' + ((invActual && invActual.nombre) || (invActual && invActual.id) || '?') +
           '   área: ' + ((invActual && invActual.area) || '?'));
    var prod = (invActual && invActual.prebatchProducidos) || {};
    Object.keys(prod).forEach(function (pid) {
        var n = parseFloat(prod[pid]) || 0; if (!n) return;
        var pre = window._insumoResolver ? window._insumoResolver(pid) : null;
        L.push('');
        L.push('CAPTURADO EN: ' + pid + '  × ' + n + ' batches');
        if (!pre) { L.push('  (ese insumo no está en el catálogo)'); return; }
        L.push('  insumo que manda: ' + pre.id + ' · "' + (pre.nombre || '') + '"' +
               '  esSubReceta=' + !!pre.esSubReceta +
               '  origenId=' + (pre.origenId || '-') + '  suc=' + (pre.sucursalId || '-'));
        L.push('  su recetaId: ' + (pre.recetaId || '(vacío)'));
        var sr = window._recetaResolver ? window._recetaResolver(pre.recetaId) : null;
        if (!sr) { L.push('  receta usada: NO SE ENCUENTRA'); return; }
        L.push('  receta usada: ' + sr.id + ' · "' + (sr.nombre || '') + '"' +
               '  tipo=' + (sr.tipo || '-') + '  origenId=' + (sr.origenId || '-'));
        (sr.ingredientes || []).forEach(function (ing) {
            var ii = window._insumoResolver ? window._insumoResolver(ing.insumoId) : null;
            L.push('    · ' + (ing.cantidad || 0) + ' ' + (ing.unidad || '') +
                   '  insumoId=' + (ing.insumoId || '-') +
                   '  canon=' + (_canonInsumoId(ing.insumoId) || '-') +
                   '  → ' + (ii ? '"' + (ii.nombre || '') + '"' : 'NO ESTÁ EN EL CATÁLOGO') +
                   '  renglón=' + (_filaDe(_canonInsumoId(ing.insumoId) || ing.insumoId) ? 'sí' : 'NO'));
        });
    });
    /* Las sub-recetas que existen con ese nombre: es lo que delata una liga
       cruzada, y sin verlas juntas no se distingue cuál es cuál. */
    L.push('');
    L.push('SUB-RECETAS DEL NEGOCIO:');
    (getRecetas() || []).filter(function (r) { return r && String(r.tipo || '').indexOf('sub') === 0; })
        .forEach(function (r) {
            L.push('  ' + r.id + ' · "' + (r.nombre || '') + '"  ings=' + ((r.ingredientes || []).length) +
                   '  origenId=' + (r.origenId || '-'));
        });
    var txt = L.join(String.fromCharCode(10));
    try {
        navigator.clipboard.writeText(txt);
        alert('Copiado. Pégalo en el chat.');
    } catch (e) { window.prompt('Copia esto:', txt); }
}
window._copiarDiagPrebatch = _copiarDiagPrebatch;

/* Soltar un parentesco falso: la receta deja de ser «copia de» otra y pasa a
   valerse por sí misma. No se borra nada ni se toca su contenido — solo se
   quita el vínculo que nunca debió existir. */
async function _soltarParentesco(recetaId) {
    var r = getRecetas().find(function (x) { return x.id === recetaId; });
    if (!r) { alert('No se encontró la sub-receta.'); return; }
    var padre = getRecetas().find(function (x) { return x.id === r.origenId; });
    if (!confirm('«' + (r.nombre || '') + '» va a dejar de ser una copia de «' +
                 ((padre && padre.nombre) || '?') + '».' + String.fromCharCode(10, 10) +
                 'No se borra ni se cambia su contenido: solo se quita un vínculo que no ' +
                 'le corresponde, porque son recetas distintas.' +
                 String.fromCharCode(10, 10) + '¿Las separamos?')) return;
    var antes = r.origenId;
    delete r.origenId;
    var negId = getNegocioActivo();
    try {
        if (typeof _supabase !== 'undefined' && negId) {
            var q = await _supabase.from('recetas')
                .upsert({ id: r.id, negocio_id: negId, datos: r }, { onConflict: 'id' });
            if (q.error) throw q.error;
        }
        try { _skPut(_sk('recetas'), JSON.stringify(getRecetas())); } catch (e2) {}
    } catch (e) {
        r.origenId = antes;   // no se guardó: no se hizo
        alert('No se pudo guardar, así que NO se hizo.' + String.fromCharCode(10, 10) +
              ((e && e.message) || e));
        return;
    }
    _consumoDirty = true;
    window._step5Dirty = true; window._step5Force = true;
    if (typeof renderStepContent === 'function') renderStepContent();
}
window._soltarParentesco = _soltarParentesco;

/* Reapuntar un ingrediente de la sub-receta al insumo que SÍ se está
   contando. Cambia un solo campo —a qué insumo señala ese renglón de la
   receta— y no toca la cantidad ni la unidad. */
async function _reapuntarIngrediente(recetaId, viejoId, nuevoId) {
    var r = getRecetas().find(function (x) { return x.id === recetaId; });
    if (!r) { alert('No se encontró la sub-receta.'); return; }
    var ing = (r.ingredientes || []).find(function (i) { return i && i.insumoId === viejoId; });
    if (!ing) { alert('Ese ingrediente ya no está en la receta.'); return; }
    var nue = (typeof window._insumoResolver === 'function') ? window._insumoResolver(nuevoId) : null;
    if (!confirm('En «' + (r.nombre || '') + '», los ' + (ing.cantidad || 0) + ' ' + (ing.unidad || '') +
                 ' van a salir del insumo que SÍ se está contando en este inventario.' +
                 String.fromCharCode(10, 10) +
                 'No cambia la cantidad ni la receta: solo a cuál de los dos insumos con ese ' +
                 'nombre apunta.' + String.fromCharCode(10, 10) + '¿Lo reapuntamos?')) return;
    var antes = ing.insumoId;
    ing.insumoId = nuevoId;
    if (nue && nue.nombre) ing.nombre = nue.nombre;
    var negId = getNegocioActivo();
    try {
        if (typeof _supabase !== 'undefined' && negId) {
            var q = await _supabase.from('recetas')
                .upsert({ id: r.id, negocio_id: negId, datos: r }, { onConflict: 'id' });
            if (q.error) throw q.error;
        }
        try { _skPut(_sk('recetas'), JSON.stringify(getRecetas())); } catch (e2) {}
    } catch (e) {
        ing.insumoId = antes;          // no se guardó: no se hizo
        alert('No se pudo guardar, así que NO se hizo.' + String.fromCharCode(10, 10) +
              ((e && e.message) || e));
        return;
    }
    _consumoDirty = true;
    window._step5Dirty = true; window._step5Force = true;
    if (typeof renderStepContent === 'function') renderStepContent();
}
window._reapuntarIngrediente = _reapuntarIngrediente;

/* ══ ENSEÑAR LA CUENTA, NO SOLO EL RESULTADO ══════════════════════════════
   «Capturo la producción y el vodka no baja» puede romperse en cinco sitios
   distintos, y desde fuera los cinco se ven igual: un cero. Esto desarma la
   cuenta renglón por renglón —cuánto le toca a cada ingrediente y si ese
   ingrediente tiene renglón en ESTE inventario— para que se vea DÓNDE se
   corta en vez de tener que adivinarlo.

   Se enseña siempre que haya producción capturada, no solo cuando algo falla:
   el que acaba de anotar tres batches quiere comprobar que se descontó lo que
   pensaba, y la única forma hoy es ir insumo por insumo. */
function _prebatchDesglose() {
    var prod = (invActual && invActual.prebatchProducidos) || {};
    var recs = (typeof getRecetas === 'function') ? getRecetas() : [];
    var filas = {};
    (filasCaptura || []).forEach(function (f) {
        if (f && f.insumoId) filas[_canonInsumoId(f.insumoId) || f.insumoId] = f;
    });
    var out = [];
    Object.keys(prod).forEach(function (pid) {
        var n = parseFloat(prod[pid]) || 0;
        if (!n) return;
        var pre = (typeof window._insumoResolver === 'function') ? window._insumoResolver(pid) : null;
        var nom = (pre && pre.nombre) || _nombreEnInventario(pid) || pid;
        if (!pre) {
            out.push({ nombre: nom, batches: n, mal: 'Su insumo ya no está en el catálogo: pásalo a su reemplazo con 🔗 en el aviso de arriba', ings: [] });
            return;
        }
        if (!pre.esSubReceta || !pre.recetaId) {
            out.push({ nombre: nom, batches: n, mal: 'El insumo donde se capturó no es producción propia', ings: [] });
            return;
        }
        /* LA MISMA receta que usa el cálculo —por el resolver, no por id crudo—
           o este desglose mentiría igual que la ficha mentía antes. */
        var sr = (window._recetaResolver ? window._recetaResolver(pre.recetaId) : null);
        if (!sr) {
            out.push({ nombre: nom, batches: n, mal: 'Su sub-receta no se encuentra', ings: [] });
            return;
        }
        var ings = (sr.ingredientes || []).map(function (ing) {
            var iid = ing && ing.insumoId;
            var can = iid ? (_canonInsumoId(iid) || iid) : '';
            var ins = iid && typeof window._insumoResolver === 'function' ? window._insumoResolver(iid) : null;
            var z = _normIngrediente(ing || {});
            var u = (z.unidad || '').toUpperCase();
            var base = (u === 'PZA' || u === 'PZ' || u === '') ? z.cant : ingredienteBase(z.cant, z.unidad);
            /* ══ «SIN RENGLÓN» NO SIEMPRE QUIERE DECIR QUE FALTE ══════════
               EL CASO DEL SIDRAL. La receta del Tinto de Verano pedía 2 LT de
               «Sidral Mundet 3L» y el desglose decía «sin renglón en este
               inventario» — mientras el Sidral salía en el reporte con sus
               tres piezas. Las dos cosas eran ciertas: hay DOS insumos con ese
               nombre y la receta apunta al que no se está contando.

               Pasa al rehacer un insumo (el mismo caso del vodka): el nuevo
               entra al inventario y las recetas se quedan señalando al viejo.
               Y es invisible, porque los dos se llaman igual.

               Decir «sin renglón» a secas manda a buscar un renglón que SÍ
               está ahí. Si existe otro insumo con el mismo nombre que sí
               tiene renglón, se dice y se ofrece reapuntar la receta. */
            var otroIgual = null;
            if (!!can && !filas[can] && ins) {
                var nomI = String(ins.nombre || '').trim().toLowerCase();
                var cand = (filasCaptura || []).find(function (fx) {
                    if (!fx || !fx.insumoId) return false;
                    var ix = (typeof window._insumoResolver === 'function')
                        ? window._insumoResolver(fx.insumoId) : null;
                    return ix && String(ix.nombre || '').trim().toLowerCase() === nomI;
                });
                if (cand) otroIgual = { insumoId: cand.insumoId, nombre: cand.nombre,
                                        recetaId: sr.id, viejoId: iid };
            }
            return {
                nombre: (ins && ins.nombre) || (ing && ing.nombre) || '(sin insumo)',
                /* Los ids del ingrediente, para la cadena plegada. Tres vueltas
                   con el Sidral sin poder ver por qué un ingrediente empata y
                   el de al lado no: están en la MISMA receta y el único dato
                   que los distingue es a qué id apuntan. */
                ids: { pide: iid || '-', canon: can || '-',
                       fila: (filas[can] && filas[can].insumoId) || 'NINGUNO' },
                cant: base * n,
                unidad: (u === 'PZA' || u === 'PZ' || u === '') ? 'pza' : (u === 'G' || u === 'KG' ? 'g' : 'ml'),
                sinInsumo: !ins,
                sinFila: !!can && !filas[can],
                otroIgual: otroIgual
            };
        });
        /* ══ LA CADENA CRUDA ══════════════════════════════════════════════
           Tres vueltas discutiendo esto a ciegas: yo no veo los datos de
           Edwin y él no ve los ids. La cadena tiene cuatro eslabones y los
           nombres de tres de ellos se parecen tanto que no se distinguen al
           hablar. Aquí quedan los cuatro, con sus ids, para que una captura
           de pantalla cierre la discusión en vez de abrir otra.

           `capturadoEn` vs `resuelveA` es la pareja que importa: si se
           capturó sobre el maestro y el resolver devuelve la copia de la
           sucursal, la liga que manda es la de la COPIA — y puede ser otra. */
        var mismo = (pre.id === pid);
        out.push({
            nombre: nom, batches: n, receta: sr.nombre, mal: '', ings: ings,
            cadena: {
                capturadoEn: pid,
                resuelveA:   pre.id + (mismo ? '' : '  ⚠️ otro registro'),
                sucDelIns:   pre.sucursalId || (pre.origenId ? 'copia' : 'maestro'),
                recetaId:    pre.recetaId,
                recetaUsada: sr.id + (sr.id === pre.recetaId ? '' : '  ⚠️ copia por sucursal'),
                recetaNom:   sr.nombre
            },
            /* Si existe una sub-receta que se llame EXACTAMENTE como el
               insumo y no sea la que usa, el arreglo se ofrece aquí mismo:
               es donde se está mirando el problema. */
            religarA: (function () {
                // Por la RAÍZ, no por el id: una copia legítima por sucursal
                // es la misma receta y no es ninguna gemela.
                var _rz = function (r) { return (r && (r.origenId || r.id)) || ''; };
                var g = recs.find(function (r) {
                    return r && String(r.tipo || '').indexOf('sub') === 0 && _rz(r) !== _rz(sr) &&
                           String(r.nombre || '').trim().toLowerCase() ===
                           String(nom || '').trim().toLowerCase();
                });
                return g ? { id: g.id, nombre: g.nombre, insumoId: pre.id } : null;
            })()
        });
    });
    return out;
}

function _prebatchDesgloseHTML() {
    var d = [];
    try { d = _prebatchDesglose(); } catch (e) { return ''; }
    if (!d.length) return '';
    var hayProblema = d.some(function (x) { return x.mal || x.ings.some(function (i) { return i.sinInsumo || i.sinFila; }); });
    return '<div style="margin:0 16px 14px;background:var(--surface);border:1px solid ' +
        (hayProblema ? 'rgba(245,200,66,.5)' : 'var(--border)') + ';border-radius:12px;padding:13px 15px">' +
        '<div style="font-size:11.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;' +
        'color:var(--text-muted);margin-bottom:9px">🏭 Qué se llevó la producción de batches' +
        '<button onclick="_copiarDiagPrebatch()" style="margin-left:10px;font-size:10px;' +
        'padding:2px 9px;border-radius:5px;cursor:pointer;background:transparent;' +
        'border:1px solid var(--border);color:var(--text-dim);letter-spacing:0;' +
        'text-transform:none;font-weight:500">📋 Copiar diagnóstico</button></div>' +
        d.map(function (x) {
            if (x.mal) return '<div style="font-size:12px;color:var(--accent);margin-bottom:7px">' +
                '<b style="color:var(--text)">' + etx(x.nombre) + '</b> · ' + x.batches +
                ' batch' + (x.batches === 1 ? '' : 'es') + ' — ' + etx(x.mal) + '</div>';
            var _rel = x.religarA
                ? ' <button onclick="_religarPrebatch(\'' + x.religarA.insumoId + '\',\'' + x.religarA.id + '\')" ' +
                  'style="margin-left:6px;font-size:10px;padding:1px 8px;border-radius:5px;cursor:pointer;' +
                  'background:transparent;border:1px solid var(--green);color:var(--green)">' +
                  '🔗 Ligarlo a «' + etx(x.religarA.nombre) + '»</button>'
                : '';
            /* La cadena va PLEGADA: son ids y no se leen todos los días, pero
               cuando algo no cuadra es lo único que lo resuelve sin adivinar. */
            var _cad = x.cadena ? '<details style="margin-top:4px"><summary style="font-size:10.5px;' +
                'color:var(--text-dim);cursor:pointer;list-style:none">· ver la liga (ids)</summary>' +
                '<div style="font-size:10.5px;color:var(--text-dim);line-height:1.7;margin:4px 0 0 10px;' +
                'font-family:ui-monospace,monospace;word-break:break-all">' +
                'capturado en: ' + etx(x.cadena.capturadoEn) + '<br>' +
                'insumo que manda: ' + etx(x.cadena.resuelveA) + ' (' + etx(x.cadena.sucDelIns) + ')<br>' +
                'su recetaId: ' + etx(x.cadena.recetaId) + '<br>' +
                'receta usada: ' + etx(x.cadena.recetaUsada) + ' — ' + etx(x.cadena.recetaNom) +
                /* Y el porqué de cada ingrediente: a qué id apunta la receta,
                   a cuál se reduce y qué renglón del inventario le tocó. Con
                   dos insumos del mismo nombre es lo único que los separa. */
                (x.ings || []).map(function (i) {
                    if (!i.ids) return '';
                    return '<br>· ' + etx(i.nombre) + ': pide ' + etx(i.ids.pide) +
                           ' → canon ' + etx(i.ids.canon) + ' → renglón ' + etx(i.ids.fila);
                }).join('') +
                '</div></details>' : '';
            return '<div style="margin-bottom:9px">' +
                '<div style="font-size:12.5px;color:var(--text);font-weight:600">' + etx(x.nombre) +
                ' · ' + x.batches + ' batch' + (x.batches === 1 ? '' : 'es') +
                '<span style="font-weight:400;color:var(--text-dim)"> → hace ' + etx(x.receta) + '</span>' +
                _rel + '</div>' + _cad +
                (x.ings.length
                    ? '<div style="font-size:11.5px;color:var(--text-muted);line-height:1.8;margin-top:3px">' +
                      x.ings.map(function (i) {
                          var cant = Math.round(i.cant * 100) / 100;
                          /* El renglón que falta es el dato: un ingrediente sin
                             renglón en este inventario NO se descuenta en ningún
                             lado, y es invisible salvo aquí. */
                          var nota = i.sinInsumo
                              ? ' <span style="color:var(--red)">— ese insumo ya no existe</span>'
                              : i.otroIgual
                              ? ' <span style="color:var(--accent)">— la receta apunta a OTRO insumo con el ' +
                                'mismo nombre, y ese no se está contando</span>' +
                                ' <button onclick="_reapuntarIngrediente(\'' + i.otroIgual.recetaId + '\',\'' +
                                i.otroIgual.viejoId + '\',\'' + i.otroIgual.insumoId + '\')" ' +
                                'style="margin-left:4px;font-size:10px;padding:1px 8px;border-radius:5px;' +
                                'cursor:pointer;background:transparent;border:1px solid var(--green);' +
                                'color:var(--green)">🔗 Apuntarla al que sí</button>'
                              : i.sinFila
                              ? ' <span style="color:var(--accent)">— sin renglón en este inventario: ' +
                                'NO se le descuenta</span>' : '';
                          return '· ' + etx(i.nombre) + ' <b style="color:var(--text)">−' + cant + ' ' + i.unidad +
                                 '</b>' + nota;
                      }).join('<br>') + '</div>'
                    : '<div style="font-size:11.5px;color:var(--accent)">Esa sub-receta no tiene ingredientes.</div>') +
            '</div>';
        }).join('') + '</div>';
}

/* ══ LO DE LOS PREBATCH, PLEGADO (Edwin, 19-nov: «es muy invasiva») ════════
   El aviso de producciones sin rastrear y el desglose de lo que se llevaron
   los batches son INFORMATIVOS: ocupaban media pantalla arriba del Resultado.
   Ahora van detrás de un botón, cerrados de entrada; el botón dice cuántos
   batches y cuántos avisos hay, para que se sepa si vale la pena abrirlo. El
   contenido es el mismo (con sus botones para arreglar). */
var _s5PrebatchAbierto = false;
function _prebatchPlegable(cuerpo) {
    if (!cuerpo) return '';
    var nAv = 0, nBat = 0;
    try { nAv = _prebatchDiagnostico().length; } catch (e) {}
    try { nBat = _prebatchDesglose().reduce(function (t, x) { return t + (x.batches || 0); }, 0); } catch (e) {}
    var resumen = [nBat ? nBat + ' batch' + (nBat === 1 ? '' : 'es') + ' producido' + (nBat === 1 ? '' : 's') : '',
                   nAv ? nAv + ' sin rastrear' : ''].filter(Boolean).join(' · ');
    return '<div class="s5-pb">' +
        '<button type="button" class="s5-pb-btn' + (nAv ? ' s5-pb-av' : '') + '" aria-expanded="' + _s5PrebatchAbierto + '" onclick="_togglePrebatchS5(this)">' +
        _icInv('rec-sub-bebidas', 16) + '<span>Producción de batches</span>' +
        (resumen ? '<span class="s5-pb-n">' + resumen + '</span>' : '') +
        '<span class="s5-pb-acc">' + (_s5PrebatchAbierto ? 'Ocultar ▴' : 'Ver ▾') + '</span></button>' +
        '<div class="s5-pb-cuerpo"' + (_s5PrebatchAbierto ? '' : ' hidden') + '>' + cuerpo + '</div></div>';
}
function _togglePrebatchS5(btn) {
    _s5PrebatchAbierto = !_s5PrebatchAbierto;
    var cuerpo = btn && btn.nextElementSibling;
    if (cuerpo) cuerpo.hidden = !_s5PrebatchAbierto;
    btn.setAttribute('aria-expanded', String(_s5PrebatchAbierto));
    var acc = btn.querySelector('.s5-pb-acc'); if (acc) acc.textContent = _s5PrebatchAbierto ? 'Ocultar ▴' : 'Ver ▾';
}
window._togglePrebatchS5 = _togglePrebatchS5;

/* El aviso, arriba del Resultado. Va donde se mira la diferencia, no en una
   pestaña aparte: el momento en que esto importa es justo cuando alguien está
   viendo un faltante y no se lo explica. */
function _prebatchAvisoHTML() {
    var p = [];
    try { p = _prebatchDiagnostico(); } catch (e) { return ''; }
    if (!p.length) return '';
    return '<div style="margin:0 16px 14px;background:rgba(245,200,66,.08);' +
        'border:1px solid rgba(245,200,66,.45);border-radius:12px;padding:13px 15px">' +
        '<div style="font-size:12.5px;font-weight:700;color:var(--accent);margin-bottom:7px">' +
        '⚠️ ' + p.length + (p.length === 1 ? ' producción propia' : ' producciones propias') + ' sin rastrear</div>' +
        '<div style="font-size:11.5px;color:var(--text-muted);line-height:1.6">' +
        'Lo que estos batches se llevaron <b style="color:var(--text)">no se le está ' +
        'descontando a sus insumos</b>, así que su faltante va a salir aquí como una ' +
        'diferencia sin explicación.</div>' +
        '<ul style="margin:9px 0 0 16px;padding:0;font-size:11.5px;color:var(--text-muted);line-height:1.75">' +
        p.map(function (x) {
            /* Para la liga cruzada se ofrece ARREGLARLA aquí. Mandar a alguien
               a otro módulo a buscar un insumo entre tres que se llaman casi
               igual, para cambiarle una liga que no se ve por ningún lado, es
               pedirle que no lo haga. */
            if (x.mal === 'parentesco' && x.soltarId)
                return '<li><b style="color:var(--text)">' + etx(x.fila) + '</b> — ' + etx(x.txt) +
                    ' <button onclick="_soltarParentesco(\'' + x.soltarId + '\')" ' +
                    'style="margin-left:6px;font-size:10.5px;padding:2px 9px;border-radius:5px;cursor:pointer;' +
                    'background:transparent;border:1px solid var(--green);color:var(--green)">' +
                    '✂️ Separarlas</button></li>';
            var _b = function (fn, txt) {
                return ' <button onclick="' + fn + '" style="margin-left:6px;font-size:10.5px;padding:2px 9px;border-radius:5px;' +
                    'cursor:pointer;background:transparent;border:1px solid var(--green);color:var(--green)">' + txt + '</button>';
            };
            var btn = '';
            if (x.mal === 'ligacruzada' && x.insumoId && x.recetaId)
                btn = _b("_religarPrebatch('" + x.insumoId + "','" + x.recetaId + "')", '🔗 Ligarlo al correcto');
            else if (x.mal === 'nolink' && x.insumoId && x.recetaId)
                btn = _b("_religarPrebatch('" + x.insumoId + "','" + x.recetaId + "')", '🔗 Marcarlo y ligarlo');
            else if (x.mal === 'muerto' && x.destino)
                btn = _b("_pasarRenglonPrebatch('" + x.insumoId + "','" + x.destino.id + "')", '🔗 Pasarlo a «' + etx(x.destino.nombre) + '»');
            return '<li><b style="color:var(--text)">' + etx(x.fila) + '</b> — ' + etx(x.txt) + btn + '</li>';
        }).join('') +
        '</ul><div style="font-size:11px;color:var(--text-dim);margin-top:9px;line-height:1.6">' +
        'Con 🔗 se arregla aquí mismo. Donde no hay botón, se arregla en Recetas: abre la sub-receta y ' +
        'contesta «Sí» a «¿Usar como prebatch en el inventario?».</div></div>';
}
function _esPrebatchRepartido(id) { return !!(_PREBATCH_REPARTE && _repCache && _repCache.esPB[id]); }

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

/* Qué tan bien pega un nombre del POS contra un candidato. Una sola regla para
   insumos y para recetas: si cada lado puntuara distinto, el desempate entre
   «Negroni» el coctel y «Mix Negroni PR» el insumo saldría a cara o cruz. */
function _puntajeMatch(words, q, nombre) {
    const n = _normMatch(nombre);
    let score = 0;
    words.forEach(w => { if (n.includes(w)) score++; });
    if (n.includes(q) || q.includes(n)) score += 0.5;
    return score;
}

function _matchInsumo(nombreProducto) {
    if (!nombreProducto || !filasCaptura.length) return null;
    const q      = _normMatch(nombreProducto);
    const words  = q.split(' ').filter(p => p.length >= 3);
    if (!words.length) return null;
    let best = null, bestScore = 0;
    filasCaptura.forEach(fila => {
        const score = _puntajeMatch(words, q, fila.nombre);
        if (score > bestScore) { bestScore = score; best = fila; }
    });
    return bestScore > 0 ? best : null;
}

/* El match usa las mismas recetas de la carta disponibles en el Paso 3.
   Solo relaciona el informe POS: no representa una salida de ingredientes. */
function _recetasCancelables() {
    const suc = localStorage.getItem('etaax_sucursal_activa') || '';
    return getRecetas().filter(r =>
        (r.tipo === 'alimentos' || r.tipo === 'bebidas') &&
        ((suc && typeof window._recetaActivaEnSuc === 'function')
            ? window._recetaActivaEnSuc(r, suc)
            : r.status !== 'inactiva')
    );
}

/* La receta gana los empates: el POS cancela el producto de la carta.
   Relacionarlo con su prebatch homónimo lo atribuiría al insumo equivocado. */
function _matchCancelacion(nombreProducto) {
    if (!nombreProducto) return null;
    const q     = _normMatch(nombreProducto);
    const words = q.split(' ').filter(p => p.length >= 3);
    if (!words.length) return null;

    let rBest = null, rScore = 0;
    _recetasCancelables().forEach(r => {
        const sc = _puntajeMatch(words, q, r.nombre);
        if (sc > rScore) { rScore = sc; rBest = r; }
    });
    let iBest = null, iScore = 0;
    (filasCaptura || []).forEach(fila => {
        const sc = _puntajeMatch(words, q, fila.nombre);
        if (sc > iScore) { iScore = sc; iBest = fila; }
    });

    if (rBest && rScore >= iScore) return { tipo:'receta', id:rBest.id, nombre:rBest.nombre };
    if (iBest && iScore > 0)       return { tipo:'insumo', id:iBest.insumoId, nombre:iBest.nombre };
    return null;
}

/* Cada cancelación apunta a una sola referencia. Una receta se muestra solo
   en el informe POS; un insumo también en su fila, como dato informativo. */
function _aplicarMatchCancel(c, m) {
    c.insumoId = null; c.insumoNombre = null;
    c.recetaId = null; c.recetaNombre = null;
    if (!m) return;
    if (m.tipo === 'receta') { c.recetaId = m.id; c.recetaNombre = m.nombre; }
    else                     { c.insumoId = m.id; c.insumoNombre = m.nombre; }
}

var _autoMatchFirma = '';
function _autoMatchCancelaciones() {
    const lista = invActual?.cancelaciones || [];
    // Guarda: si no hay cancelaciones sin insumoId nuevas, no hay nada que hacer.
    // (Antes corría el matching de texto completo EN CADA llamada — y se llama
    // por fila en el Paso 5/reporte → era el retraso de varios segundos.)
    /* La firma cuenta los renglones SIN NADA. Antes contaba los que no tenían
       insumoId, y con el match a recetas uno ya resuelto —pero resuelto a una
       receta— seguía contando como pendiente: la firma nunca se estabilizaba y
       el matching completo volvía a correr en cada render. Era justo el retraso
       de varios segundos que esta guarda existe para evitar. */
    const _pend = (l) => l.reduce((s,c)=> s + ((c.insumoId || c.recetaId || c.matchManual) ? 0 : 1), 0);
    const firma = (invActual?.id || '') + '|' + lista.length + '|' + _pend(lista);
    if (firma === _autoMatchFirma) return;
    lista.forEach(c => {
        if (!c.insumoId && !c.recetaId && !c.matchManual) _aplicarMatchCancel(c, _matchCancelacion(c.nombreProducto));
    });
    _autoMatchFirma = (invActual?.id || '') + '|' + lista.length + '|' + _pend(lista);
    window._step5Dirty = true;
}

function getCancelacionesCopas(insumoId) {
    _autoMatchCancelaciones(); // idempotente y con guarda: solo trabaja si hay cancelaciones nuevas
    return (invActual?.cancelaciones || [])
        // Solo la asociación por ID. Buscar la primera palabra del POS metía
        // «TE» en «Estate» y «White», incluso con la cancelación sin match.
        .filter(c => c.insumoId && !c.recetaId && _movimientoDelInsumo(c, insumoId))
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

function _liquidoAbiertoHTML(fila) {
    var e = EtaaxCore.equivalenciasLiquidoInventario(calcMLReales(fila), fila.copaML);
    var num = function(v){ return (Math.round(v * 100) / 100).toLocaleString('es-MX', {maximumFractionDigits:2}); };
    var equivalencias = (e.copas !== null ? num(e.copas) + ' copas de ' + num(fila.copaML) + ' ml · ' : '') + num(e.onzas) + ' oz';
    return '<span style="display:block">' + fmtLt(e.ml / 1000) + '</span>' +
        '<small style="display:block;font-size:11px;font-weight:500;line-height:1.5;white-space:normal">' + equivalencias + '</small>';
}

// Misma presentación base que usa la captura. Resolver con sucursal evita leer
// los límites del maestro cuando esta sucursal tiene su propia configuración.
function _parametrosStockFila(fila, sucursal) {
    fila = fila || {};
    var ins = typeof window._insumoResolver === 'function' ? window._insumoResolver(fila.insumoId, sucursal) : null;
    var p = ins && ins.presentaciones && ins.presentaciones[0];
    function leer(k) {
        if (p && p[k] != null) return p[k]; // incluye cero y vacío explícitos
        if (ins && ins[k] != null) return ins[k];
        return fila[k];
    }
    /* Cada límite puede venir en PIEZAS o en la presentación de compra (caja,
       rejilla…), según su selector del editor (24-nov). Aquí todo se cuenta en
       piezas: se convierte con la regla del núcleo. Sin selector vale pieza,
       que es como se leyó siempre. */
    if (p && p.stockMin != null && window.EtaaxCore && EtaaxCore.stockDefinido) {
        var d = EtaaxCore.stockDefinido(Object.assign({}, p, { stockMin: leer('stockMin'), stockMax: leer('stockMax') }));
        return { stockMin: d.minPiezas, stockMax: d.maxPiezas };
    }
    return { stockMin:leer('stockMin'), stockMax:leer('stockMax') };
}
function _stockDeFila(fila, cantidad, sucursal) {
    fila = fila || {};
    var limites = _parametrosStockFila(fila, sucursal);
    var estado = EtaaxCore.estadoStockInventario(EtaaxCore.unidadesCompraInventario(cantidad, fila), limites.stockMin, limites.stockMax);
    // Una captura vacía todavía no es un conteo en cero. Los registros viejos
    // con ceros explícitos y el botón "Registrar en cero" sí cuentan como cero.
    var capturado = function(v){ return v != null && String(v).trim() !== '' && isFinite(Number(v)); };
    var contado = fila.registrado === true || (fila.tipo === 'peso' ? capturado(fila.existenciaPeso) :
        capturado(fila.cerradasBodega) || capturado(fila.cerradasBarra) ||
        (fila.pesos || []).some(capturado) || (fila.metodoCaptura === 'nivel' && capturado(fila.nivelPct)));
    if (!contado && estado.estado !== 'sin-parametros' && estado.estado !== 'revisar') {
        estado.estado = 'sin-conteo'; estado.actual = null;
    }
    estado.unidad = fila.tipo === 'copa' ? 'bot' : (fila.tipo === 'pza' || String(fila.baseUnit).toUpperCase() === 'PZA' ? 'pza' : 'unid. de compra');
    return estado;
}
function _stockHTML(stock, papel) {
    if (!stock) return '';
    var textos = { ideal:'Stock ideal', intermedio:'Stock intermedio', bajo:'Stock bajo', revisar:'Revisar parámetros de stock', 'sin-parametros':'Stock sin parámetros', 'sin-equivalencia':'Stock sin equivalencia de compra', 'sin-conteo':'Stock pendiente de conteo' };
    var colores = papel ? { ideal:'#1a7a46', intermedio:'#715600', bajo:'#b83227' } : { ideal:'var(--green)', intermedio:'var(--accent)', bajo:'var(--red)' };
    var num = function(v){ return v == null || !isFinite(v) ? '—' : (Math.round(v*100)/100).toLocaleString('es-MX'); };
    return '<div data-stock="' + stock.estado + '" title="Disponible: existencia física del insumo en su unidad de compra. El producto incorporado en subrecetas se controla en la existencia de esas preparaciones." style="font-size:10px;line-height:1.5;margin-top:4px;font-weight:400;color:' + (papel ? '#56514a' : 'var(--text-dim)') + '">' +
        '<b style="color:' + (colores[stock.estado] || (papel ? '#56514a' : 'var(--text-muted)')) + '">' + textos[stock.estado] + '</b>' +
        (stock.actual !== null ? ' · Disponible ' + num(stock.actual) : '') +
        ' · Mín. ' + num(stock.minimo) + ' · Ideal/máx. ' + num(stock.maximo) + ' ' + etx(stock.unidad) + '</div>';
}
function _stockFilaHTML(fila, cantidad, papel, sucursal) {
    if (!fila) return '';
    if (fila.esCompuesto) {
        var comp = getCompuestos().find(function(c){ return c.id === fila.compId; });
        return ((comp && comp.miembros) || []).map(_filaDeMiembro).filter(Boolean).map(function(m){
            return '<div style="margin-top:4px;font-size:10px">' + etx(insumoTitulo(m)) + _stockFilaHTML(m, calcExistencia(m), papel, sucursal) + '</div>';
        }).join('');
    }
    return _stockHTML(_stockDeFila(fila, cantidad, sucursal || (invActual && invActual.sucursalId)), papel);
}
function _stockReporteHTML(row, papel) {
    if (row.stockMiembros) return row.stockMiembros.map(function(m){
        return '<div style="font-size:10px;margin-top:4px">' + etx(m.nombre) + _stockReporteHTML(m, papel) + '</div>';
    }).join('');
    return _stockHTML(row.stock, papel);
}
function _costoCompraStock(fila) {
    var unidades = EtaaxCore.unidadesCompraInventario(1, fila);
    return unidades > 0 ? costoCopa(fila) / unidades : 0;
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
    // Las cancelaciones POS son informativas. Las salidas reales se registran
    // en ventas, cortesías, mermas o producción, nunca se infieren del POS.
    if (fila.tipo === 'peso') {
        const eaP    = parseFloat(fila.existenciaAnterior) || 0;
        const entP   = getEntradasBottles(fila.insumoId);     // entradas en unidad base
        const ventP  = _consumoRecetasBase(fila.insumoId); // consumo por lo vendido (platillos y cocteles)
        const mermaP = parseFloat(fila.mermaBase) || 0;
        return eaP + entP + prodAdd - ventP - mermaP - prodSub;
    }
    const ea          = parseFloat(fila.existenciaAnterior) || 0;
    const ventasRec   = calcVentasCopasRecetas(fila.insumoId, fila.copaML);
    const ventasDir   = parseFloat(fila.ventasCopasDirectas) || 0;
    const cortesia    = parseFloat(fila.cortesiaCopas) || 0;
    const merma       = parseFloat(fila.mermaCopas) || 0;
    const totalCopas  = ventasRec + ventasDir + cortesia + merma;
    const entTotal    = getEntradasCopas(fila);
    if (fila.tipo === 'pza') {
        const ventaPzaRec = calcVentasPzaRecetas(fila.insumoId);     // venta por menú/recetas (piezas)
        const ventaPzaDir = parseFloat(fila.ventasCopasDirectas) || 0; // venta directa por pieza (campo "Pzas")
        return ea + entTotal + prodAdd
            - (fila.ventasBotella || 0) - ventaPzaDir - ventaPzaRec
            - cortesia - merma - prodSub;
    }
    return ea + entTotal + prodAdd - totalCopas - prodSub - (fila.ventasBotella || 0) * (fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0);
}

// Índice fila-por-insumo (se reconstruye si cambia el arreglo o su tamaño):
// getEntradasBottles/getCancelacionesCopas se llaman POR FILA en el Paso 5 y el
// reporte — con .find lineal eran O(filas²) y tardaban segundos con 200+ insumos.
var _filaIdxCache = null, _filaIdxRef = null, _filaIdxLen = -1, _filaIdxCatalogo = null;
function _filaDe(insumoId) {
    if (_filaIdxRef !== filasCaptura || _filaIdxLen !== filasCaptura.length || _filaIdxCatalogo !== getInsumos() || !_filaIdxCache) {
        _filaIdxCache = {};
        filasCaptura.forEach(f => { if (f && f.insumoId) { _filaIdxCache[f.insumoId] = f; _filaIdxCache[_canonInsumoId(f.insumoId)] = f; } });
        _filaIdxRef = filasCaptura; _filaIdxLen = filasCaptura.length;
        _filaIdxCatalogo = getInsumos();
    }
    return _filaIdxCache[insumoId] || _filaIdxCache[_canonInsumoId(insumoId)];
}

function _movimientoDelInsumo(mov, insumoId) {
    if (!mov || !mov.insumoId) return false;
    var suc = _sucursalInventario();
    if (suc && mov.sucursalId && mov.sucursalId !== suc) return false;
    return _canonInsumoId(mov.insumoId) === _canonInsumoId(insumoId);
}

function getEntradasBottles(insumoId) {
    const fila    = _filaDe(insumoId);
    const deFilas = fila ? (fila.entradas || []).reduce((s, e) => s + (parseFloat(e)||0), 0) : 0;
    const deLog   = (invActual?.entradasLog || [])
        .filter(e => _movimientoDelInsumo(e, insumoId))
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
function _sucActiva() { return _sucursalInventario(); }

/* ══ EL CIERRE SON DOS COSAS DISTINTAS ═════════════════════════════════════
   · cerradoAt        — cuándo se le dio CLIC. Es rastro, para auditar.
   · cierreOperativo  — hasta qué momento cuentan sus movimientos. ES LO QUE
                        define el periodo.

   Normalmente coinciden, pero no siempre: si el conteo fue el 19 y se olvidó
   finalizarlo hasta el 1 de septiembre, tomar el clic como frontera haría que
   ese inventario se tragara trece días de entradas que no son suyas — y el
   siguiente arrancaría vacío. Descuadra los dos a la vez.

   Por eso: si la fecha del inventario NO es hoy, se pregunta hasta qué hora de
   ESE día cuentan sus movimientos. Suponerlo en silencio es justo lo que no se
   puede hacer con algo que reparte existencias. */
function _momentoCierre(inv) {
    if (!inv) return '';
    return String(inv.cierreOperativo || inv.cerradoAt || '');
}

function _sellarCierre(inv) {
    if (!inv) return inv;
    /* Se respeta lo que ya tuviera: volver a "finalizar" un inventario ya
       cerrado (pasa al editarlo) no debe recorrer nada — eso movería a otro
       periodo entradas que ya estaban repartidas. */
    if (inv.cerradoAt && inv.cierreOperativo) return inv;
    var ahora = new Date();
    if (!inv.cerradoAt) inv.cerradoAt = ahora.toISOString();
    if (!inv.cierreOperativo) inv.cierreOperativo = _preguntarCierreOperativo(inv, ahora);
    return inv;
}

/* ══ ¿A QUÉ HORA SE CERRÓ? ═════════════════════════════════════════════════
   Se pregunta ANTES de la contraseña, no después: la hora es un DATO y la
   contraseña una autorización. Preguntarla dentro del callback hacía que el
   diálogo saliera encima del modal de la clave, uno sobre otro.

   Llama a `next()` solo si hay respuesta. Cancelar aborta el cierre completo:
   más vale no cerrar que cerrar con una frontera inventada, porque esa frontera
   decide a qué inventario van las entradas de los días siguientes. */
/* SIEMPRE se pregunta, y se pregunta FECHA Y HORA.
   Antes había dos atajos: si el inventario ya traía sello no se preguntaba, y
   si se cerraba el mismo día tampoco. Los dos se caen con «reabrir»: se reabre
   un inventario para meter lo que faltaba y al volver a finalizarlo conservaba
   el sello VIEJO — el movimiento recién capturado quedaba fuera del periodo,
   en silencio. Y el atajo del mismo día impedía corregir una hora mal puesta.
   Preguntar siempre cuesta un clic; equivocarse de periodo cuesta el mes. */
/* Qué proponer en el diálogo: lo que ya tenía sellado —al re-finalizar un
   inventario reabierto, lo normal es confirmar la misma hora— y si nunca se
   cerró, el final de su día de apertura. */
function _cierreSugerido(inv, fecha, ahora) {
    var prev = inv && (inv.cierreOperativo || inv.cerradoAt);
    if (prev) { var l = _isoALocal(prev); if (l) return l; }
    return fecha + 'T23:59';
}

function _conCierreOperativo(inv, next) {
    if (!inv) { next(); return; }
    var ahora = new Date();
    var f = String(inv.fecha || '');
    if (!f) { next(); return; }   // sin fecha no hay periodo que partir

    var lbl = new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    var ov = document.createElement('div');
    ov.id = 'ovHoraCierre';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.74);display:flex;' +
        'align-items:center;justify-content:center;padding:22px';
    ov.innerHTML =
        '<div style="background:var(--surface,#14130f);border:1px solid var(--border,#2a2824);border-radius:16px;' +
             'max-width:430px;width:100%;padding:26px 26px 20px;box-shadow:0 22px 64px rgba(0,0,0,.6);' +
             'font-family:\'DM Sans\',sans-serif;color:var(--text,#f0ece6)">' +
          '<div style="font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:var(--text-dim,#6b6862)">Cierre del inventario</div>' +
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:25px;letter-spacing:1.4px;margin:6px 0 12px;line-height:1.1">' +
            '¿A qué hora terminaste el conteo?</div>' +
          '<div style="font-size:13px;color:var(--text-muted,#a8a29a);line-height:1.6">' +
            'Este inventario abrió el <b style="color:var(--text,#f0ece6)">' + lbl + '</b>.<br>' +
            'Lo que se haya registrado <b>después</b> del momento que pongas aquí se va al siguiente inventario.</div>' +
          '<div style="margin:18px 0 6px">' +
            '<label style="display:block;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim,#6b6862);margin-bottom:6px">Fecha y hora del cierre</label>' +
            '<input type="datetime-local" id="hcHora" value="' + _cierreSugerido(inv, f, ahora) + '" style="width:100%;box-sizing:border-box;background:var(--surface2,#1a1916);' +
              'border:1px solid var(--border,#2a2824);color:var(--text,#f0ece6);padding:12px 14px;border-radius:10px;' +
              'font-family:inherit;font-size:17px;outline:none">' +
            '<div style="font-size:11.5px;color:var(--text-dim,#6b6862);margin-top:6px;line-height:1.5">' +
              'Si no la recuerdas, deja las 23:59: cuenta todo ese día y nada del siguiente.</div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">' +
            '<button id="hcCancel" style="background:transparent;border:1px solid var(--border,#2a2824);color:var(--text-muted,#a8a29a);' +
              'border-radius:9px;padding:10px 18px;font-family:inherit;font-size:13.5px;cursor:pointer">Cancelar</button>' +
            '<button id="hcOk" style="background:var(--green,#3dbe7a);border:none;color:#0a0908;border-radius:9px;' +
              'padding:10px 22px;font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer">Continuar</button>' +
          '</div>' +
        '</div>';
    document.body.appendChild(ov);
    var inp = ov.querySelector('#hcHora');
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);

    function cerrar() { try { ov.remove(); } catch (e) {} }
    ov.querySelector('#hcCancel').onclick = cerrar;
    ov.onclick = function (e) { if (e.target === ov) cerrar(); };
    ov.querySelector('#hcOk').onclick = function () {
        /* Vacío o ilegible → el final del día de apertura, que es lo que valía
           antes de que esto se pudiera elegir. Nunca se deja sin sello: sin él,
           el inventario contaría todo lo registrado hasta hoy. */
        var v = String(inp.value || '').trim();
        var d = v ? new Date(v) : null;
        inv.cierreOperativo = (d && !isNaN(d.getTime()))
            ? d.toISOString()
            : new Date(f + 'T23:59:00').toISOString();
        cerrar();
        next();
    };
    inp.onkeydown = function (e) { if (e.key === 'Enter') ov.querySelector('#hcOk').click(); };
}

function _preguntarCierreOperativo(inv, ahora) {
    /* El día en LOCAL, no en UTC. La `fecha` del inventario es la que se ve en
       pantalla (local), y a las 7 de la tarde en México toISOString() ya devuelve
       el día siguiente: comparar contra eso le preguntaría la hora de cierre a
       un inventario abierto hoy mismo. */
    var hoy = ahora.getFullYear() + '-' +
              ('0' + (ahora.getMonth() + 1)).slice(-2) + '-' +
              ('0' + ahora.getDate()).slice(-2);
    var f = String(inv.fecha || '');
    // Mismo día (o sin fecha): el clic ES el momento del cierre.
    if (!f || f === hoy) return ahora.toISOString();

    var _lbl = new Date(f + 'T12:00:00').toLocaleDateString('es-MX',
        { day: 'numeric', month: 'long', year: 'numeric' });
    /* RED DE SEGURIDAD. Lo normal es que _conCierreOperativo ya haya preguntado y
       dejado `cierreOperativo` puesto; esto solo corre si algún camino de cierre
       se saltó ese paso. Cae al final de SU día —nunca a "ahora"—, que es lo más
       cercano a la verdad sin inventar una hora: cuenta todo ese día y nada del
       siguiente. Poner "ahora" sería justo el error que arruina el reparto. */
    return new Date(f + 'T23:59:00').toISOString();
}

// PERIODO del inventario activo: de la fecha de la REFERENCIA (exclusivo) a la fecha
// del inventario (inclusivo). Una entrada pertenece al inventario cuyo periodo cubre
// su fecha → así el primer inventario que abras no se traga TODAS las entradas.
/* ══ LA HORA DE CAPTURA ════════════════════════════════════════════════════
   La lista enseñaba solo el día. Y resulta que la hora es el dato que DECIDE:
   _enPeriodoInvActual reparte cada movimiento entre un inventario y el
   siguiente comparando el MOMENTO en que se registró contra la hora de cierre.
   Un inventario cerrado a las 5 pm no se queda con lo que entró ese mismo día
   a las 8 pm.

   O sea que el sistema ya decidía por hora y la pantalla solo mostraba el día:
   quien veía un movimiento «del 30 de septiembre» en el inventario de octubre
   no tenía cómo saber si eso estaba bien o era un error. Ahora se ve.

   EL DÍA DEL MOVIMIENTO NO SIEMPRE ES EL DÍA DE LA CAPTURA: una entrada admite
   fecha a mano, así que se puede registrar hoy una compra de la semana pasada.
   Cuando no coinciden se dice —«capturado el 28/07»— porque si no, la hora se
   leería como la del movimiento y sería peor que no ponerla. */
function _horaCaptura(fecha, momento) {
    if (!momento) return '';                       // registro viejo: no se inventa
    var d = new Date(momento);
    if (isNaN(d)) return '';
    var hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    var diaCap = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
                 String(d.getDate()).padStart(2, '0');
    var mismoDia = !fecha || String(fecha).slice(0, 10) === diaCap;
    return { hora: hh, mismoDia: mismoDia, diaCap: diaCap,
             txt: mismoDia ? hh : ('cap. ' + diaCap.slice(8) + '/' + diaCap.slice(5, 7) + ' ' + hh) };
}
/* El trozo de HTML que va junto a la fecha. Separado para que las tres listas
   —entradas, mermas y cortesías— no se vayan separando con el tiempo. */
function _horaCapHTML(e) {
    var h = _horaCaptura(e && e.fecha, e && e.registrado);
    if (!h) return '';
    var t = h.mismoDia ? 'Hora en que se capturó el registro'
                       : 'Se capturó el ' + h.diaCap + ' a las ' + h.hora + ', con fecha de movimiento ' + (e.fecha || '—');
    return ' <span style="opacity:.72;font-size:10.5px" title="' + etx(t) + '">· ' + etx(h.txt) + '</span>';
}

function _enPeriodoInvActual(fecha, momento) {
    if (!invActual) return true;
    var refI = _getRefInv();

    /* ── REGLA NUEVA: por MOMENTO, no por día ──────────────────────────────
       Un inventario del 19 de agosto que se cerró a las 5 pm no debe quedarse
       con lo que entró ese mismo 19 a las 8 pm: eso ya es del siguiente. Con
       fechas sueltas eso no se puede distinguir, y era el hueco real.

       Solo aplica si la referencia trae `cerradoAt` y el movimiento trae su
       momento. Los inventarios que ya existen no tienen hora de cierre, así que
       siguen repartiéndose por día — cambiarles la regla movería entradas ya
       repartidas de un periodo a otro.

       Los ISO se comparan como texto a propósito: mismo formato y misma zona
       (Z), así que el orden alfabético ES el orden cronológico, sin construir
       objetos Date en un bucle que corre por cada movimiento. */
    var desde = refI ? _momentoCierre(refI) : '';
    var mom   = momento ? String(momento) : '';
    if (desde && mom) {
        if (mom <= desde) return false;                  // se registró antes de cerrar el anterior
        var hasta = _momentoCierre(invActual);
        // Inventario ABIERTO: no tiene tope. Todo lo que llegue desde el cierre
        // del anterior es suyo hasta que se cierre.
        return hasta ? (mom <= hasta) : true;
    }

    /* ── REGLA VIEJA: por día. Para los inventarios de antes de este cambio ── */
    var from = refI ? String(refI.fecha || '') : '';
    var to   = String(invActual.fecha || '9999-99-99');
    var f = String(fecha || ''); if (!f) return true;   // sin fecha: no la excluimos (compat)
    if (from && f <= from) return false;                 // antes/igual que la referencia → de otro periodo
    return f <= to;                                       // hasta la fecha del inventario
}

// Recalcula FRESCO (idempotente) la merma/cortesía-préstamo del QR por insumo, en su
// PROPIO tracking (_qrMerma/_qrCort/_qrBase). El total que leen todos y la fórmula del
// candado (mermaCopas/cortesiaCopas) = MANUAL SUELTO + BOTELLAS + QR. Reemplaza el viejo dedupe
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
        if (!_enPeriodoInvActual(e.fecha, e.registrado)) return;  // periodo de este inventario
        var _cid = _canonInsumoId(e.insumoId);                   // por id canónico (empata con la fila)
        (byIns[_cid] = byIns[_cid] || []).push(e);
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
        /* Concepto de las cortesías/préstamos del QR. Antes se escribía encima
           SIEMPRE, y el concepto elegido a mano («Consumo interno») se perdía en
           el siguiente repintado. Ahora solo si el campo está vacío o lo había
           puesto el propio QR. */
        if (concQR.length) {
            var _qrTxt = concQR.join(' · ');
            var _eraQR = f.cortesiaConcepto && (f.cortesiaConcepto === f._qrCortConcepto ||
                (f._qrCortConcepto === undefined && /^(🎁 Cortesía|🔁 Préstamo)/.test(f.cortesiaConcepto)));
            if (!f.cortesiaConcepto || _eraQR) f.cortesiaConcepto = _qrTxt;
            f._qrCortConcepto = _qrTxt;
        }
        // Derivar el MANUAL quitando la contribución PREVIA del QR. En la 1ª pasada (migración)
        // el QR previo aún no existe → se usa el FRESCO (= lo que la vieja lógica ya había sumado),
        // así NO se duplica lo antes importado y SÍ reaparece lo que se había perdido/atorado.
        var prevM = (f._qrMerma !== undefined) ? (parseFloat(f._qrMerma) || 0) : m;
        var prevC = (f._qrCort  !== undefined) ? (parseFloat(f._qrCort)  || 0) : c;
        var prevB = (f._qrBase  !== undefined) ? (parseFloat(f._qrBase)  || 0) : b;
        _actualizarSalida(f, 'mermaCopas', { qr:m, qrAnterior:prevM });
        _actualizarSalida(f, 'cortesiaCopas', { qr:c, qrAnterior:prevC });
        f.mermaBaseManual = Math.max(0, (parseFloat(f.mermaBase)     || 0) - prevB);
        f._qrMerma = m; f._qrCort = c; f._qrBase = b;
        f.mermaBase     = f.mermaBaseManual + b;
    });
}

/* ══ UNA CAPTURA DEL QR QUE SE CORRIGIÓ DESPUÉS ══════════════════════════════
   La copia que vive dentro del inventario abierto es la que se usa para
   calcular; el log global es de donde viene. Cuando alguien corrige su captura
   desde el celular (v82), el log sube de versión y esta copia se queda vieja.

   Se actualiza EN SU SITIO y solo los campos de CAPTURA: la copia de adentro
   lleva además marcas del ERP que no existen en el log y que no hay que
   pisar. Si la versión de la nube no es más nueva, no se toca nada —así una
   recarga normal no deshace una corrección hecha aquí—.

   Lo que la nube trae YA PASÓ por `_miCambioGana`: si hay una escritura local
   pendiente para ese id, gana la local y aquí no llega nada que la deshaga. */
function _reconciliarEntradaEnInv(e) {
    if (!e || !e.id || !invActual || !invActual.entradasLog) return false;
    var i = -1;
    for (var k = 0; k < invActual.entradasLog.length; k++) {
        var le = invActual.entradasLog[k];
        if (le && le.id === e.id) { i = k; break; }
    }
    if (i < 0) return false;
    var copia = invActual.entradasLog[i];
    var vLocal = parseInt(copia.ver, 10) || 1;        // sin `ver` = la primera
    var vNube  = parseInt(e.ver,    10) || 1;
    if (vNube <= vLocal) return false;
    /* LO EDITABLE se copia… y lo que el servidor QUITÓ se quita. Al borrar un
       comentario, SQL elimina la llave; copiar solo las presentes dejaba el
       comentario viejo vivo en la copia de adentro, y el inventario seguía
       enseñando algo que ya no existe en ningún lado.

       `notas` es donde vive el comentario de una entrada; `nota` es el rezago
       de los días en que el editor de la v82 escribía en la llave equivocada,
       y se limpia igual para no dejar dos. */
    ['cantidad', 'notas', 'nota', 'evidencia'].forEach(function (campo) {
        if (campo in e) copia[campo] = e[campo]; else delete copia[campo];
    });
    /* Lo demás ACOMPAÑA: no se edita por el QR, así que su ausencia en el log
       no significa que se haya borrado. */
    ['unidad', 'concepto', 'motivo', 'foto_url', 'foto_urls',
     'ver', 'editadoPor', 'editadoEn'].forEach(function (campo) {
        if (campo in e) copia[campo] = e[campo];
    });
    return true;
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
        return !(le && le.id && _globalIds[le.id] && !_enPeriodoInvActual(le.fecha, le.registrado));
    });
    yaEnInv = {}; invActual.entradasLog.forEach(function(e){ if (e && e.id) yaEnInv[e.id] = 1; });
    var n = 0;
    (getEntradasLog() || []).forEach(function(e) {
        if (!e) return;                        // QR y manuales del ERP: ambas se importan por periodo
        // Sello de sucursal: si el registro trae sucursal y NO es la activa, no se importa aquí
        var _sucImp = _sucActiva();
        if (e.sucursalId && _sucImp && e.sucursalId !== _sucImp) return;
        if (!_enPeriodoInvActual(e.fecha, e.registrado)) return;   // periodo: pertenece a OTRO inventario
        /* YA ESTÁ EN ESTE INVENTARIO… PERO PUEDE HABER CAMBIADO.
           Desde la v82 una captura del QR se puede corregir, y antes esto
           salía de largo: el log global quedaba con 8 botellas y la copia de
           adentro del inventario seguía diciendo 10. El reporte y el resultado
           se calculan con la copia de adentro, así que la corrección no se
           veía por ningún lado —y el que la hizo creía que sí—.

           Se reconcilia POR VERSIÓN y EN SU SITIO: no se agrega otra entrada
           (eso contaría doble, que es justo lo que el editor vino a evitar). */
        if (e.id && yaEnInv[e.id]) {
            if (_reconciliarEntradaEnInv(e)) { n++; try { _invalidarStep5(); } catch (x) {} }
            if (_entSyncNotaEnInv(e)) n++;      // la nota armada (o deshecha) afuera
            return;
        }
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
            id: e.id, insumoId: _canonInsumoId(e.insumoId), // id canónico → empata con la fila
            nombreProducto: e.nombre || '—',
            cantidad: parseFloat(e.cantidad) || 0,
            costo: parseFloat(e.costo) || 0,
            tipo: e.tipo || '', notas: e.notas || '',
            fecha: e.fecha || '', origen: e.origen || 'manual',
            registradoPor: e.registradoPor || '', // quién lo registró en el QR (sello del RPC)
            sucursalId: e.sucursalId || _sucActiva() || '', // sello: hereda la sucursal del registro
            /* El MOMENTO de captura viaja con la entrada. Sin él, el Paso 2
               enseñaba solo el día mientras el historial de afuera decía la hora
               —el mismo registro, dos fichas distintas— y justo aquí es donde
               importa: la hora es la que decide si el movimiento cayó antes o
               después del cierre de este inventario. */
            registrado: e.registrado || '',
            foto_url: e.foto_url || '',         // evidencia visual del QR (1ª foto)
            foto_urls: e.foto_urls || []        // lote: varias fotos de evidencia
        });
        // La nota / factura viaja con sus renglones (si vino en una).
        if (e.notaId) Object.assign(invActual.entradasLog[invActual.entradasLog.length - 1], _entNotaCampos(e));
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
                // La hora en que se CAPTURÓ (la del respaldo solo si no la traía).
                importadoEnInv: invActual.id, registrado: le.registrado || new Date().toISOString()
            });
            if (le.notaId) Object.assign(_gl[_gl.length - 1], _entNotaCampos(le));
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
    /* Si viene en caja/rejilla/paquete, las entradas se guardan en PIEZAS (como
       el QR y el conteo): la etiqueta es la de la pieza, no la de la caja. Antes
       decía «24 rejillas» cuando se habían registrado 24 piezas (Edwin, 24-nov). */
    var _emp = _empaqueCompra(ins);
    if (_emp) {
        var _pz = String(_emp.um || 'Piezas').toLowerCase();
        return /^bot/.test(_pz) ? 'bot' : /^pie|^pza/.test(_pz) ? 'pza' : /^lat/.test(_pz) ? 'lata' : _pz;
    }
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
function costoCopa(fila, sucursal) {
    // Usa el costo ACTUAL del insumo (refleja ediciones); si no, el congelado en la fila.
    var _ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(fila.insumoId, sucursal) : null;
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
function _filaLive(fila, sucursal) {
    if (!fila || !fila.insumoId || fila.esCompuesto) return fila;
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(fila.insumoId, sucursal) : null;
    if (!ins || ins.esCompuesto) return fila;
    var p = (ins.presentaciones && ins.presentaciones[0]) || {};
    var esFood = (ins.familia || '').toLowerCase().indexOf('aliment') >= 0;
    var esPza  = _esRefrescoCerveza(ins);
    var contBase = _contenidoBasePresentacion(ins, p);
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

function tipoIcon(tipo, tam) { return _icInv(TIPOS_ICON[tipo] || 'mod-inventarios', tam || 16); }

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
    if (id !== 'vistaCaptura') _vaciarHerrPaso();
    if (id !== 'vistaEntradas' && typeof _vaciarEntHerr === 'function') _vaciarEntHerr();   // mismos ids que la del paso
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
    var compDe = {}; comps.forEach(function(c){ (c.miembros||[]).forEach(function(m){ compDe[m] = c; compDe[_midCanon(m)] = c; }); });
    var acc = {}, out = [];
    rows.forEach(function(r){
        var c = compDe[r.insumoId] || compDe[_midCanon(r.insumoId)];
        if (!c) { out.push(r); return; }
        // A UNIDADES DE CONTEO (botellas/piezas), cada miembro con SU envase.
        // Antes se pasaba todo a ml y se devolvía en copas: el compuesto salía
        // en una unidad que no era la de ninguna de sus columnas vecinas.
        var copasBot = (r.contNeto > 0 && r.copaML > 0) ? r.contNeto / r.copaML : 0;
        var aUnid = function(qty){ return (r.tipo === 'copa' && copasBot > 0) ? qty / copasBot : qty; };
        if (!acc[c.id]) { acc[c.id] = { _comp:c, barra:0, bodega:0, total:0, capBarra:0, capBodega:0, capital:0, fecha:'', _u:'', stockMiembros:[] }; out.push(acc[c.id]); }
        var fc = acc[c.id];
        fc.stockMiembros.push(r);
        if (!fc._u) fc._u = r.tipo === 'peso' ? (r.baseUnit || 'u') : (r.tipo === 'pza' ? 'pza' : 'bot');
        fc.barra += aUnid(r.barra); fc.bodega += aUnid(r.bodega); fc.total += aUnid(r.total);
        fc.capBarra += r.capBarra; fc.capBodega += r.capBodega; fc.capital += r.capital;
        if ((r.fecha||'') > fc.fecha) fc.fecha = r.fecha;
    });
    return out.map(function(r){
        if (!r._comp) return r;
        var c = r._comp;
        // Mismas columnas que cualquier otra fila: existencias en unidades de
        // conteo y costo promedio por unidad (capital ÷ total).
        return { insumoId:'_comp_'+c.id, nombre:c.nombre, familia:'🧩 Compuesto', tipo:'_comp', unidadComp:r._u||'bot', stockMiembros:r.stockMiembros,
            barra:r.barra, bodega:r.bodega, total:r.total,
            costoUnit: r.total>0 ? r.capital/r.total : 0, capital:r.capital, capBarra:r.capBarra, capBodega:r.capBodega, fecha:r.fecha };
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
function _areaNom(a){
    /* Los nombres salen del vocabulario compartido (staff-area.js) para que el
       reporte y el QR llamen igual a lo mismo. `_AREA_LBL` manda todavía: trae
       los rótulos del eje FÍSICO del conteo (barra/bodega/cocina), que es otra
       cosa —dónde se cuenta— y no se toca aquí. */
    if (_AREA_LBL[a]) return _AREA_LBL[a];
    if (window.StaffArea && StaffArea.nomIns) { var n2 = StaffArea.nomIns(a); if (n2 && n2 !== a) return n2; }
    return a ? (a.charAt(0).toUpperCase() + a.slice(1)) : 'General';
}

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
    invs.reverse().sort(function(a,b){
        return String(b.fecha||'').localeCompare(String(a.fecha||'')) ||
            String(_momentoCierre(b) || b.guardadoTs || '').localeCompare(String(_momentoCierre(a) || a.guardadoTs || ''));
    }); // más reciente primero, también si hubo varios conteos el mismo día
    // Última fila registrada de cada insumo (de cualquier inventario).
    var porIns = {};
    invs.forEach(function(inv){
        _filasUnicasInventario(inv.filas || []).forEach(function(f){
            var cid = _canonInsumoId(f.insumoId);
            var suc = inv.sucursalId || 'suc_principal', clave = suc + '|' + cid;
            if (porIns[clave]) return;
            porIns[clave] = { fila:f, fecha:inv.fecha, insumoId:cid, sucursalId:suc };
        });
    });
    var insById = {}; getInsumos().forEach(function(x){ if (x && x.id) insById[x.id] = x; });
    // UNA fila por insumo, con su existencia en barra, en bodega y el total.
    var rows = [];
    Object.keys(porIns).forEach(function(clave){
        var o = porIns[clave], id = o.insumoId, f = _filaLive(o.fila, o.sucursalId), ins = window._insumoResolver(id, o.sucursalId) || insById[id];
        var cc     = costoCopa(f, o.sucursalId);
        var barra  = _existenciaArea(f, 'barra',  ins);
        var bodega = _existenciaArea(f, 'bodega', ins);
        var total  = calcExistencia(f); // total real (incluye la botella abierta pesada)
        // Costo prov. = PRECIO DE COMPRA por unidad de conteo (botella/pza/base), no el costo por litro.
        var copasBot = (f.tipo === 'copa' && f.contNeto > 0 && f.copaML > 0) ? f.contNeto / f.copaML : 0;
        var costoCompra = f.tipo === 'copa' ? cc * copasBot : cc; // costo de 1 botella/pza/unidad base
        rows.push({
            insumoId: id, sucursalId:o.sucursalId, nombre: f.nombre || '—', familia: f.familia || f.categoria || 'Otros',
            subcat: f.subcategoria || f.categoria || '',
            tipo: f.tipo, copaML: f.copaML, contNeto: f.contNeto, baseUnit: f.baseUnit,
            barra: barra, bodega: bodega, total: total,
            stock:_stockDeFila(f, total, o.sucursalId),
            costoUnit: costoCompra,
            capBarra: barra * cc, capBodega: bodega * cc, capital: total * cc, fecha: o.fecha
        });
    });
    // Filtro por área: muestra solo los insumos con existencia en esa área
    if (area && area !== 'todas') rows = rows.filter(function(r){ return (area === 'barra' ? r.barra : r.bodega) > 0 || r.total === 0; });
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
    if (typeof _exigeInv === 'function' && !_exigeInv('reporte', 'No puedes ver los reportes del inventario.')) return;
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

    // Tabla: UNA fila por insumo, SEPARADA POR GRUPO de producto (igual que el
    // desglose del inventario y que este mismo reporte impreso). Corrida, con
    // 260 renglones, no hay forma de cotejarla contra la bodega.
    rows.sort(function(a,b){ return b.total - a.total; });
    var totBarra = rows.reduce(function(s,r){ return s + r.capBarra;  }, 0);
    var totBodega= rows.reduce(function(s,r){ return s + r.capBodega; }, 0);
    var totCap   = rows.reduce(function(s,r){ return s + r.capital;   }, 0);
    var _nColsRep = op ? 7 : 8;
    var _gruposRep = {};
    rows.forEach(function(r){ var g = r.familia || 'Sin grupo'; (_gruposRep[g] = _gruposRep[g] || []).push(r); });
    var _filaRep = function(r){
        var cont = _fmtContenido(r);
        return '<tr><td style="font-weight:600;padding-left:16px">'+etx(r.nombre)+_stockReporteHTML(r, false)+(cont?'<div style="font-size:10px;color:#7ab8f5;font-weight:400">📦 '+cont+'</div>':'')+'</td>'+
            '<td style="color:var(--text-dim)">'+etx(r.familia)+'</td>'+
            '<td style="text-align:right">'+_fmtCant(r.barra, r)+'</td>'+
            '<td style="text-align:right">'+_fmtCant(r.bodega, r)+'</td>'+
            '<td style="text-align:right;font-weight:700;color:var(--text)">'+_fmtCant(r.total, r)+'</td>'+
            '<td style="text-align:right;color:var(--text-muted)">'+_repMoney(r.costoUnit)+'</td>'+
            (op ? '' : '<td style="text-align:right;color:var(--accent);font-weight:600">'+_repMoney(r.capital)+'</td>')+
            '<td style="text-align:center;color:var(--text-dim);font-size:11px">'+_repFecha(r.fecha)+'</td></tr>';
    };
    var _cuerpoRep = Object.keys(_gruposRep).sort(function(a,b){ return String(a).localeCompare(String(b),'es'); }).map(function(g){
        var lista = _gruposRep[g];
        var sub = lista.reduce(function(t,r){ return t + (r.capital||0); }, 0);
        return '<tr><td colspan="'+_nColsRep+'" style="background:rgba(61,190,122,.08);border-top:2px solid rgba(61,190,122,.35);'+
            'padding:8px 12px;font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--green)">'+
            etx(g)+' <span style="font-weight:400;color:var(--text-dim);letter-spacing:.5px;text-transform:none">· '+lista.length+
            ' insumo'+(lista.length!==1?'s':'')+(op?'':' · '+_repMoney(sub))+'</span></td></tr>' +
            lista.map(_filaRep).join('');
    }).join('');
    html += '<div class="tabla-wrap" style="padding:0 8px"><table style="font-size:12px"><thead><tr>'+
        '<th style="text-align:left">Insumo</th><th style="text-align:left">Familia</th>'+
        '<th style="text-align:right">Exist. Barra</th><th style="text-align:right">Exist. Bodega</th>'+
        '<th style="text-align:right">Total exist.</th><th style="text-align:right">Costo prov.</th>'+
        (op ? '' : '<th style="text-align:right">Capital</th>')+'<th style="text-align:center">Última existencia</th></tr></thead><tbody>'+
        _cuerpoRep+
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
    _filasUnicasInventario(inv.filas || []).forEach(function(_f){
        if (!_f || !_f.insumoId) return;
        var suc = inv.sucursalId || 'suc_principal';
        var f = _filaLive(_f, suc);
        var ins = window._insumoResolver(f.insumoId, suc) || insById[f.insumoId];
        var cc = costoCopa(f, suc);
        var barra = _existenciaArea(f, 'barra', ins);
        var bodega = _existenciaArea(f, 'bodega', ins);
        var total = calcExistencia(f);
        var copasBot = (f.tipo === 'copa' && f.contNeto > 0 && f.copaML > 0) ? f.contNeto/f.copaML : 0;
        var costoCompra = f.tipo === 'copa' ? cc*copasBot : cc;
        /* insumoId SÍ viaja: el encabezado del impreso cuenta insumos únicos
           con un Set sobre este campo, y sin él todos los renglones eran
           `undefined` — el reporte de 120 productos decía «1 insumos». */
        rows.push({ insumoId:f.insumoId, nombre:f.nombre||'—',
            /* ══ AGRUPAR COMO EL RESULTADO, NO POR FAMILIA ════════════════
               La familia de TODA la barra es «Bebidas», así que el reporte
               impreso salía con un solo bloque de 120 productos: destilados,
               cervezas, vinos y refrescos revueltos. Imposible cerrar una
               categoría e irse a la siguiente, que es como se cuenta.

               Se agrupa con la misma regla que el desglose del Paso 5
               (_grupoCategoria): Destilados, Licores, Vinos, Cervezas,
               Refrescos / Sodas… Si las dos pantallas agruparan distinto,
               cotejar una contra otra obligaría a traducir los bloques. */
            familia: (typeof _grupoCategoria === 'function'
                        ? _grupoCategoria(f)
                        : (f.familia||f.categoria||'Otros')),
            subcat:f.subcategoria||f.categoria||'', tipo:f.tipo,
            copaML:f.copaML, contNeto:f.contNeto, baseUnit:f.baseUnit, barra:barra, bodega:bodega, total:total,
            stock:_stockDeFila(f, total, suc),
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
function imprimirPreviewInv(){
    var inv = _previewInv; if (!inv) { alert('No hay inventario abierto en la vista previa.'); return; }
    var q = (_previewBusq||'').toLowerCase();
    var rows = (_previewRows||[]).filter(function(r){
        return (!q || (r.nombre||'').toLowerCase().includes(q)) && (!_previewSubcat || (r.subcat||r.familia) === _previewSubcat);
    });
    imprimirReporteExistencias({ rows: rows, areaTxt: (inv.nombre || _areaNom(inv.area||'general')) + ' · ' + _repFecha(inv.fecha) });
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
            '<div style="text-align:right">'+
            (typeof etaaxLogoSVG === 'function'
                ? '<img src="data:image/svg+xml;charset=utf-8,'+encodeURIComponent(etaaxLogoSVG({variant:'oscuro',height:18}))+'" alt="ETAAX" style="height:18px;display:inline-block">'
                : '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:18px;letter-spacing:2px;color:var(--text)">ETAAX</div>')+
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
    /* Agrupada igual que el impreso y que el desglose del Paso 5. Una lista
       corrida de 120 productos con destilados, cervezas y refrescos revueltos
       no se puede cotejar contra la bodega: se cuenta por categoría, se cierra
       una y se pasa a la siguiente. */
    var _g = {};
    rows.forEach(function (r) { var k = r.familia || 'Otros'; (_g[k] = _g[k] || []).push(r); });
    var _cuerpoP = Object.keys(_g).sort(function (a, b) { return String(a).localeCompare(String(b), 'es'); })
      .map(function (g) {
        var lista = _g[g];
        var sub = lista.reduce(function (t, r) { return t + (r.capital || 0); }, 0);
        return '<tr><td colspan="7" style="background:var(--surface2);border-top:2px solid var(--green);' +
            'padding:7px 10px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;' +
            'color:var(--green)">' + etx(g) + ' <span style="font-weight:400;color:var(--text-dim)">· ' +
            lista.length + ' insumo' + (lista.length !== 1 ? 's' : '') + ' · ' + _repMoney(sub) +
            '</span></td></tr>' +
            lista.map(function(r){ var cont2=_fmtContenido(r); return '<tr><td style="font-weight:600;padding-left:16px">'+etx(r.nombre)+_stockReporteHTML(r, false)+(cont2?'<div style="font-size:10px;color:#7ab8f5;font-weight:400">📦 '+cont2+'</div>':'')+'</td><td style="color:var(--text-dim)">'+etx(r.subcat||'—')+'</td><td style="text-align:right">'+_fmtCant(r.barra,r)+'</td><td style="text-align:right">'+_fmtCant(r.bodega,r)+'</td><td style="text-align:right;font-weight:700;color:var(--text)">'+_fmtCant(r.total,r)+'</td><td style="text-align:right;color:var(--text-muted)">'+_repMoney(r.costoUnit)+'</td><td style="text-align:right;color:var(--accent);font-weight:600">'+_repMoney(r.capital)+'</td></tr>'; }).join('');
      }).join('');
    cont.innerHTML = '<div class="tabla-wrap" style="padding:0 8px"><table style="font-size:12px"><thead><tr><th style="text-align:left">Insumo</th><th style="text-align:left">Subcategoría</th><th style="text-align:right">Exist. Barra</th><th style="text-align:right">Exist. Bodega</th><th style="text-align:right">Total exist.</th><th style="text-align:right">Costo prov.</th><th style="text-align:right">Capital</th></tr></thead><tbody>'+
        _cuerpoP + '</tbody></table></div>';
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
/* ══ FUERA DEL IMPRESO, NO DEL INVENTARIO ═════════════════════════════════
   Hay renglones que hay que seguir viendo al revisar y que NO tienen nada que
   hacer en el reporte que se le pasa a dirección: un insumo que ya se borró
   del catálogo y arrastra su faltante, una infusión que se lleva aparte. Hoy
   la única salida era borrarlos del inventario —y entonces también se pierde
   el dato de quien lo revisa.

   Se guarda EN EL INVENTARIO, no en una preferencia del navegador: la
   decisión es de ese corte («en este cierre no cuenten el vodka viejo»), no
   de quien lo esté mirando. */
function _ocultosImp() { return (invActual && invActual.ocultosReporte) || {}; }
function esOcultoImpreso(insumoId) { return !!_ocultosImp()[insumoId]; }
function toggleOcultoImpreso(insumoId) {
    if (!invActual) return;
    if (!invActual.ocultosReporte) invActual.ocultosReporte = {};
    if (invActual.ocultosReporte[insumoId]) delete invActual.ocultosReporte[insumoId];
    else invActual.ocultosReporte[insumoId] = 1;
    _autoGuardar({ soloNota: true });   // no cambia ningún número: no invalida el resumen
    var e5 = document.getElementById('s5est-' + insumoId);   // el Resultado: solo lo marcado
    if (e5) e5.outerHTML = _s5Estado(insumoId);
    var w = document.getElementById('ocultoWrap-' + insumoId);
    if (w) { w.outerHTML = _btnOcultoImpreso(insumoId); return; }
    if (e5) return;
    if (typeof renderStepContent === 'function') renderStepContent();
}
window.toggleOcultoImpreso = toggleOcultoImpreso;
function _btnOcultoImpreso(insumoId) {
    var o = esOcultoImpreso(insumoId);
    return '<span id="ocultoWrap-' + insumoId + '">' +
        '<button onclick="event.stopPropagation();toggleOcultoImpreso(\'' + insumoId + '\')" ' +
        'title="' + (o ? 'Vuelve a salir en el reporte impreso'
                       : 'Se sigue viendo aquí, pero no sale en el reporte impreso') + '" ' +
        'style="margin-top:3px;margin-left:4px;font-size:9px;padding:1px 6px;border-radius:4px;' +
        'cursor:pointer;border:1px solid ' + (o ? 'var(--accent)' : '#888') + ';background:transparent;' +
        'color:' + (o ? 'var(--accent)' : '#999') + '">' +
        (o ? '🚫 Fuera del impreso' : '🖨️ En el impreso') + '</button></span>';
}
window._btnOcultoImpreso = _btnOcultoImpreso;

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
/* ── Miembros de un compuesto: SIEMPRE por id canónico ──────────────────
   Las filas del inventario guardan el id del insumo MAESTRO (`_cid`), pero el
   selector de compuestos guardaba el id de la COPIA por sucursal. En un negocio
   con insumos independizados por sucursal esos ids no son el mismo, así que el
   compuesto no encontraba a ninguno de sus miembros y simplemente no aparecía
   —el mismo compuesto funcionaba en un negocio sin copias y en otro no—. Aquí
   se comparan los dos lados en canónico, y así siguen sirviendo los compuestos
   ya guardados con el id de la copia. */
function _midCanon(mid) { return _canonInsumoId(mid) || mid; }
function _filaDeMiembro(mid) {
    var c = _midCanon(mid);
    return filasCaptura.find(function(f){ return f.insumoId === mid || _midCanon(f.insumoId) === c; }) || null;
}
function _compDeInsumo() {
    var map = {};
    getCompuestos().forEach(function(c){
        (c.miembros||[]).forEach(function(m){ map[m] = c; map[_midCanon(m)] = c; });
    });
    return map;
}
// Compuestos que tienen al menos un miembro presente en la captura actual.
function _compuestosActivos() {
    return getCompuestos().filter(function(c){
        return (c.miembros||[]).some(function(mid){ return !!_filaDeMiembro(mid); });
    });
}
function _copaMLCompuesto(comp) {
    var f = (comp.miembros||[]).map(_filaDeMiembro).find(function(x){ return x && x.copaML > 0; });
    return f ? f.copaML : 0;
}
// Existencia FÍSICA total del compuesto en copas (suma de miembros).
function _existenciaCompuestoCopas(comp) {
    var total = 0;
    (comp.miembros||[]).forEach(function(mid){
        var f = _filaDeMiembro(mid);
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
        var f = _filaDeMiembro(mid);
        if (f) sup += calcExistenciaTeorica(f);
    });
    return sup;
}
/* ── Un compuesto es una SUMA, no una conversión ────────────────────────
   Junta 2-6 productos (mismo destilado en 750 ml, 1 L, etc.) y muestra el
   total. Cada miembro conserva SU envase: las botellas de uno no valen lo
   mismo que las del otro, así que se convierte miembro por miembro con su
   propio contNeto/copaML — antes se dividía todo entre 750 ml parejo y de ahí
   salían las "cantidades raras". */
/* Copas por botella. Solo existe en lo que se SIRVE por copa: una cerveza o un
   refresco se cuentan por pieza, aunque el catálogo les herede un contenido y una
   copa. Dividir entre eso convertía 117 pza en "14.6 bot" en el desglose impreso,
   mientras el Resultado en pantalla —que sí pregunta el tipo— mostraba las 117.

   `sinDato` es qué devolver cuando es de copa pero no tiene contenido capturado:
   0 para quien solo divide (dividir o no da igual) y 1 para quien multiplica
   (una botella cuenta como una unidad). */
function _copasBotDe(f, sinDato) {
    if (!f || f.tipo === 'pza' || f.tipo === 'peso') return 0;
    return (f.contNeto > 0 && f.copaML > 0) ? f.contNeto / f.copaML : (sinDato || 0);
}
function _botellasDeFila(f, copas) {
    var cb = _copasBotDe(f);            // en piezas no hay copas que dividir
    return cb > 0 ? (copas || 0) / cb : (copas || 0);
}
function _miembrosFila(comp) {
    return ((comp && comp.miembros) || []).map(_filaDeMiembro).filter(Boolean);
}
// Σ sobre los miembros, en BOTELLAS de cada quien.
function _compSumaBot(comp, fn) {
    return _miembrosFila(comp).reduce(function (s, m) { return s + _botellasDeFila(m, fn(m)); }, 0);
}

// Fila VIRTUAL del compuesto para renderizar como un insumo copa más.
function _virtualFilaCompuesto(comp) {
    var mems = (comp.miembros||[]).map(_filaDeMiembro).filter(Boolean);
    var m0 = mems[0];
    // Ventas del compuesto = Σ de las presentaciones (modelo nuevo, ya no ventasCompuesto).
    // Son SOLO para mostrar; el teórico/existencia usan _teoricoCopas/_existCopas.
    var vD = mems.reduce(function(s,m){ return s + (parseFloat(m.ventasCopasDirectas)||0); }, 0);
    var cD = mems.reduce(function(s,m){ return s + (parseFloat(m.cortesiaCopas)||0); }, 0);
    var mD = mems.reduce(function(s,m){ return s + (parseFloat(m.mermaCopas)||0); }, 0);
    return {
        esCompuesto: true, compId: comp.id, insumoId: '_comp_' + comp.id,
        nombre: comp.nombre, categoria: '🧩 Compuesto', subcategoria: '', familia: '🧩 Compuestos',
        /* Un compuesto de cervezas es de PIEZAS. Iba fijo en 'copa', así que la
           captura y el detalle lo rotulaban en copas aunque todas sus
           presentaciones se cuenten por pieza. */
        tipo: (mems.length > 0 && mems.every(function(m){ return m.tipo === 'pza'; })) ? 'pza' : 'copa',
        copaML: _copaMLCompuesto(comp), contNeto: 0,
        costoUnitario: m0 ? (m0.costoUnitario || 0) : 0, precioCarta: m0 ? (m0.precioCarta || 0) : 0,
        ventasCopasDirectas: vD, cortesiaCopas: cD, mermaCopas: mD,
        // Antes iba en 0: si un miembro vendía botellas completas, el compuesto
        // no las mostraba y el resultado no cuadraba con la suma de sus partes.
        ventasBotella: mems.reduce(function(s,m){ return s + (parseFloat(m.ventasBotella)||0); }, 0),
        _existCopas: _existenciaCompuestoCopas(comp), _teoricoCopas: _teoricoCompuestoCopas(comp),
        // Datos que SÍ viven en los miembros y el compuesto solo suma:
        _entBot:   mems.reduce(function(s,m){ return s + (getEntradasBottles(m.insumoId)||0); }, 0),
        _entLista: mems.reduce(function(a,m){ return a.concat((_entradasDeInsumo(m.insumoId)||[]).map(function(e){
                       return Object.assign({}, e, { _de: m.nombre }); })); }, []),
        _ventaCoct: mems.reduce(function(s,m){ return s + (consumoRecetasFila(m)||0); }, 0),
        _cancel:    mems.reduce(function(s,m){ return s + (getCancelacionesCopas(m.insumoId)); }, 0),
        _eaBot:     mems.reduce(function(s,m){ return s + _botellasDeFila(m, parseFloat(m.existenciaAnterior)||0); }, 0),
        _existBot:  _compSumaBot(comp, function(m){ return calcExistencia(m); }),
        _teoBot:    _compSumaBot(comp, function(m){ return calcExistenciaTeorica(m); })
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

/* (25-nov) EL QR DE ENTRADAS YA NO VIVE AQUÍ. Es el acceso a la versión
   móvil y se mudó al menú de la cuenta del hub («Versión móvil · QR y enlace»,
   /etaax-acceso-movil.js), con el mismo permiso (inventarios.qr). Los QR ya
   impresos siguen sirviendo: /entrada.html los manda a la versión móvil. */

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
    return lista.slice(0,120).map(function(x){ var _cid=_midCanon(x.id); var sel=_compMiembros.indexOf(_cid)>=0||_compMiembros.indexOf(x.id)>=0;
        return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;border-radius:6px;'+(sel?'background:rgba(61,190,122,.1)':'')+'">'+
        '<input type="checkbox" '+(sel?'checked':'')+' onchange="_toggleMiembro(\''+_cid+'\')"><span style="font-size:13px;color:var(--text)">'+etx(insumoEtiqueta(x))+'</span></label>';
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

/* `opts` permite imprimir OTRA lista con el mismo formato — lo usa la vista
   previa de un inventario, que antes no tenía cómo imprimirse. */
function imprimirReporteExistencias(opts){
    opts = opts || {};
    var rows = opts.rows ? opts.rows.slice() : _filtraSubcatRep(_datosReporteExistencias(_repArea));
    if (!opts.rows && _repFusion) rows = _fusionarRows(rows); // Reporte final: fusiona compuestos
    if (!rows.length){ alert('No hay existencias para imprimir.'); return; }
    rows.sort(function(a,b){ return b.capital - a.capital; });
    // Nombre para el <title> de la ventana (el encabezado usa la marca compartida).
    var negNom = (typeof etaaxMarca === 'function') ? (etaaxMarca().negocio || '') : '';
    var totBarra = rows.reduce(function(s,r){ return s + r.capBarra;  }, 0);
    var totBodega= rows.reduce(function(s,r){ return s + r.capBodega; }, 0);
    var totCap   = rows.reduce(function(s,r){ return s + r.capital;   }, 0);
    var fechaLarga = new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'});
    var nIns = (new Set(rows.map(function(r){return r.insumoId;}))).size;
    var areaTxt = opts.areaTxt || (_repArea === 'todas' ? 'Todas las áreas' : _areaNom(_repArea));

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
        "table.ct tbody tr.grp-h td { background:#eef4f0; border-top:2px solid #3dbe7a; padding:7px 10px; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; color:#1a7a46; }"+
        "table.ct tbody tr.grp-h { break-inside:avoid; break-after:avoid; }"+
        "@page { size:letter landscape; margin:1cm; }";

    var op = _repModoOp;
    /* ══ «ÚLTIMA EXISTENCIA» NO APLICA AL INVENTARIO EN CURSO ═════════════
       Esa columna existe para el reporte de ÚLTIMAS existencias, donde cada
       producto viene de un inventario distinto y la fecha dice qué tan fresco
       es el dato. Al imprimir el inventario EN CURSO todos los renglones son
       del mismo día —el que ya está en el encabezado— y la columna salía
       vacía, 120 veces.

       Se quita cuando no hay fechas que enseñar. Repetir el total en una
       segunda columna también la llenaría, pero una columna que dice lo mismo
       que la de al lado no es un dato: es una columna menos para lo que sí
       importa, en una hoja horizontal que ya va apretada. */
    var _hayFechas = rows.some(function (r) { return !!r.fecha; });
    // ── Separado POR GRUPO de producto, con su subtotal ──
    // Una lista corrida de 260 insumos no se puede leer ni cotejar contra la
    // bodega; agrupada, cada familia se cuenta y se cierra por su cuenta.
    var _grupos = {};
    rows.forEach(function(r){ var g = r.familia || 'Sin grupo'; (_grupos[g] = _grupos[g] || []).push(r); });
    var _nCols = (op ? 7 : 8) - (_hayFechas ? 0 : 1);
    var _cuerpo = Object.keys(_grupos).sort(function(a,b){ return String(a).localeCompare(String(b),'es'); }).map(function(g){
        var lista = _grupos[g];
        var sub = lista.reduce(function(t,r){ return t + (r.capital||0); }, 0);
        var head = '<tr class="grp-h"><td colspan="'+_nCols+'">'+etx(g)+
            ' <span style="font-weight:400;color:#888">· '+lista.length+' insumo'+(lista.length!==1?'s':'')+
            (op?'':' · '+_repMoney(sub))+'</span></td></tr>';
        return head + lista.map(function(r){ var cont=_fmtContenido(r); return '<tr><td style="font-weight:600;padding-left:18px">'+etx(r.nombre)+_stockReporteHTML(r, true)+(cont?'<div class="grp" style="color:#5a8fc7">📦 '+cont+'</div>':'')+'</td><td style="color:#56514a">'+etx(r.subcat || '—')+'</td>'+
            '<td class="r">'+_fmtCant(r.barra,r)+'</td><td class="r">'+_fmtCant(r.bodega,r)+'</td>'+
            /* Y en el impreso, la misma equivalencia que en pantalla: este
               reporte se lleva al anaquel para contar, que es justo donde «25
               copas» no sirve y «2 botellas» sí. Solo existencias: aquí no hay
               diferencia que mostrar. */
            '<td class="r b" style="color:#1a1916">'+_fmtCant(r.total,r)+_equivBarraHTML(r.total, r, {impreso:true})+'</td><td class="r" style="color:#888">'+_repMoney(r.costoUnit)+'</td>'+
            (op?'':'<td class="r b">'+_repMoney(r.capital)+'</td>')+
            (_hayFechas?'<td class="c" style="color:#56514a">'+_repFecha(r.fecha)+'</td>':'')+'</tr>'; }).join('');
    }).join('');
    var tabla = '<table class="ct"><thead><tr>'+
        /* La columna decía «Familia» y ahora el bloque YA agrupa por eso: en
           cada renglón repetía su propio encabezado. Se enseña la
           subcategoría, que es lo que distingue dentro del grupo (un tequila
           de un mezcal, una lager de una stout). */
        '<th style="text-align:left">Insumo</th><th style="text-align:left">Subcategoría</th>'+
        '<th class="r">Exist. Barra</th><th class="r">Exist. Bodega</th><th class="r">Total exist.</th>'+
        '<th class="r">Costo prov.</th>'+(op?'':'<th class="r">Capital</th>')+
        (_hayFechas?'<th class="c">Última existencia</th>':'')+'</tr></thead><tbody>'+
        _cuerpo+
        '</tbody>'+(op?'':'<tfoot><tr><td colspan="6" class="r" style="text-transform:uppercase;font-size:9px;letter-spacing:1.5px;color:#888">Capital · Barra '+_repMoney(totBarra)+' &nbsp;·&nbsp; Bodega '+_repMoney(totBodega)+'</td>'+
        '<td class="r b" style="font-size:13px">'+_repMoney(totCap)+'</td>'+(_hayFechas?'<td></td>':'')+'</tr></tfoot>')+'</table>';

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

    var _doc = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Existencias por área — '+(negNom?etx(negNom):'ETAAX')+'</title>'+
        '<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">'+
        '<style>'+CSS+'</style></head><body>'+pagina+
        '<scr'+'ipt>window.onload=function(){setTimeout(function(){window.print();},250);}<\/scr'+'ipt></body></html>';
    // Imprime en iframe oculto: sin pestaña huérfana que cerrar después.
    if (typeof window.etaaxAbrirReporte === 'function' && window.etaaxAbrirReporte(_doc)) return;
    var w = window.open('', '_blank');
    if (!w) { alert('El navegador bloqueó la ventana. Permite las ventanas emergentes para imprimir.'); return; }
    w.document.write(_doc); w.document.close(); w.focus();
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
            <div class="empty-icon">${_icInv('mod-inventarios', 36)}</div>
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
    _filasUnicasInventario(inv.filas || []).forEach(function(f){
        var exist = (f.existenciaFisica !== undefined && f.existenciaFisica !== null) ? f.existenciaFisica : calcExistencia(f);
        capCosto += exist * costoCopa(f, inv.sucursalId || 'suc_principal');
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
    // La hora primero (es un dato); la clave después (es la autorización).
    _conCierreOperativo(inv, function(){
    _solicitarClave('Finalizar y cerrar inventario', function(){
        inv.cerrado = true; _sellarCierre(inv);
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
    });   // cierra _conCierreOperativo
}

/* ══ AJUSTES DE UN INVENTARIO ══════════════════════════════════════════════
   Dos cosas que no se podían hacer y que en la operación hacen falta todo el
   tiempo:

   1. REABRIR. Un inventario se finaliza y aparece una entrada que no se había
      capturado, o un conteo que faltaba. Hasta ahora no había vuelta atrás:
      el número quedaba mal para siempre y la única salida era borrar el
      inventario entero y rehacerlo.

   2. CORREGIR LAS HORAS. El inventario parte el tiempo en dos: lo registrado
      ANTES de su cierre operativo cuenta en él, lo de después se va al
      siguiente. Si esa hora quedó mal —se cerró a las 11 pero el conteo fue a
      las 2— los movimientos caen en el periodo equivocado. Cambiarla los
      reacomoda solos, porque todo el sistema lee ese mismo sello.

   LAS DOS PIDEN CONTRASEÑA. No es burocracia: mueven dinero de un periodo a
   otro y el que las toca por error no se entera hasta el corte del mes. */

function _invPorId(id) {
    return (getInventarios() || []).find(function (x) { return x.id === id; }) || null;
}

/* Guarda UN inventario: local y nube.
   El upsert a la nube se FUERZA a propósito. `setInventarios` compara el MISMO
   objeto —se mutó in-place— así que su diff no ve el cambio, y sin esto el
   ajuste viviría solo en este equipo y la nube lo revertiría al recargar. Es
   exactamente lo que ya le pasó a «finalizar». */
function _guardarUno(inv) {
    if (!inv) return;
    var lista = getInventarios();
    var idx = lista.findIndex(function (x) { return x.id === inv.id; });
    if (idx >= 0) lista[idx] = inv;
    setInventarios(lista);
    try { _sbUpInv(inv); } catch (e) { console.warn('[inv guardar]', e); }
}

/* ISO → lo que entiende un <input type="datetime-local"> (sin zona, minutos). */
function _isoALocal(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function reabrirInventario(id) {
    if (typeof _exigeInv === 'function' && !_exigeInv('cerrar', 'No puedes reabrir inventarios.')) return;
    var inv = _invPorId(id);
    if (!inv) return;
    if (!inv.cerrado) { alert('Este inventario ya está abierto.'); return; }
    _solicitarClave('Reabrir inventario: ' + (inv.nombre || 'sin nombre'), function () {
        inv.cerrado = false;
        /* El sello de cierre se CONSERVA. Es la hora hasta la que cuentan sus
           movimientos, y borrarla al reabrir mandaría todo lo del periodo al
           siguiente inventario sin que nadie lo pidiera. Si hay que moverla,
           se mueve a propósito desde «Ajustar horarios». */
        _guardarUno(inv);
        renderStats(); renderHistorial();
        alert('✅ Inventario reabierto.\n\nPuedes continuar capturando. La hora de cierre se conservó: si también hay que moverla, usa «Ajustar horarios».');
    });
}

function ajustarHorariosInv(id) {
    if (typeof _exigeInv === 'function' && !_exigeInv('cerrar', 'No puedes ajustar inventarios.')) return;
    var inv = _invPorId(id);
    if (!inv) return;

    var ov = document.createElement('div');
    ov.id = 'ovHorariosInv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.74);display:flex;' +
        'align-items:center;justify-content:center;padding:22px';
    var cierre = _isoALocal(inv.cierreOperativo || inv.cerradoAt);
    var hAp = /^([01]?\d|2[0-3]):([0-5]\d)/.test(String(inv.turno || '')) ? String(inv.turno).slice(0, 5) : '';
    ov.innerHTML =
        '<div style="background:var(--surface,#14130f);border:1px solid var(--border,#2a2824);border-radius:16px;' +
             'max-width:460px;width:100%;padding:26px 26px 20px;box-shadow:0 22px 64px rgba(0,0,0,.6);' +
             'font-family:\'DM Sans\',sans-serif;color:var(--text,#f0ece6)">' +
          '<div style="font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:var(--text-dim,#6b6862)">Ajustes del inventario</div>' +
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:25px;letter-spacing:1.4px;margin:6px 0 12px;line-height:1.1">' +
            'Horarios de apertura y cierre</div>' +
          '<div style="font-size:12.5px;color:var(--text-muted,#a8a29a);line-height:1.6;margin-bottom:16px">' +
            'La hora de cierre es la que <b style="color:var(--text,#f0ece6)">parte el periodo</b>: lo registrado antes ' +
            'cuenta en este inventario, lo de después se va al siguiente. Moverla reacomoda los movimientos sola.</div>' +
          '<label style="display:block;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim,#6b6862);margin-bottom:6px">Apertura</label>' +
          '<div style="display:flex;gap:8px;margin-bottom:14px">' +
            '<input type="date" id="ahFecha" value="' + etx(inv.fecha || '') + '" style="flex:2;box-sizing:border-box;background:var(--surface2,#1a1916);' +
              'border:1px solid var(--border,#2a2824);color:var(--text,#f0ece6);border-radius:9px;padding:10px;font-family:inherit;font-size:14px">' +
            '<input type="time" id="ahHora" value="' + etx(hAp) + '" style="flex:1;box-sizing:border-box;background:var(--surface2,#1a1916);' +
              'border:1px solid var(--border,#2a2824);color:var(--text,#f0ece6);border-radius:9px;padding:10px;font-family:inherit;font-size:14px">' +
          '</div>' +
          '<label style="display:block;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--text-dim,#6b6862);margin-bottom:6px">Cierre operativo</label>' +
          '<input type="datetime-local" id="ahCierre" value="' + etx(cierre) + '" style="width:100%;box-sizing:border-box;background:var(--surface2,#1a1916);' +
            'border:1px solid var(--border,#2a2824);color:var(--text,#f0ece6);border-radius:9px;padding:10px;font-family:inherit;font-size:14px">' +
          '<div style="font-size:11.5px;color:var(--text-dim,#6b6862);line-height:1.5;margin-top:7px">' +
            (inv.cerrado ? 'Vacío = sin sello: contaría todo lo registrado hasta hoy.' : 'Este inventario sigue abierto; el cierre se sella al finalizarlo.') + '</div>' +
          '<div id="ahErr" style="font-size:12px;color:var(--red,#e05a3a);margin-top:10px;min-height:16px"></div>' +
          '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">' +
            '<button id="ahCancel" style="background:transparent;border:1px solid var(--border,#2a2824);color:var(--text-muted,#a8a29a);' +
              'border-radius:9px;padding:10px 18px;font-family:inherit;font-size:13.5px;cursor:pointer">Cancelar</button>' +
            '<button id="ahOk" style="background:var(--green,#3dbe7a);border:none;color:#0a0908;border-radius:9px;' +
              'padding:10px 22px;font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer">Guardar horarios</button>' +
          '</div>' +
        '</div>';
    document.body.appendChild(ov);
    function cerrar() { try { ov.remove(); } catch (e) {} }
    ov.querySelector('#ahCancel').onclick = cerrar;
    ov.onclick = function (e) { if (e.target === ov) cerrar(); };
    ov.querySelector('#ahOk').onclick = function () {
        var fecha  = String((ov.querySelector('#ahFecha') || {}).value || '').trim();
        var hora   = String((ov.querySelector('#ahHora')  || {}).value || '').trim();
        var cierreV= String((ov.querySelector('#ahCierre')|| {}).value || '').trim();
        var err    = ov.querySelector('#ahErr');
        if (!fecha) { err.textContent = 'La fecha de apertura es obligatoria.'; return; }
        /* Un cierre ANTES de la apertura deja el periodo al revés: ningún
           movimiento cae dentro y el inventario sale en ceros, sin decir por
           qué. Se para aquí, que es donde se puede corregir. */
        if (cierreV) {
            var ap = new Date(fecha + 'T' + (hora || '00:00') + ':00');
            if (new Date(cierreV) < ap) {
                err.textContent = 'El cierre no puede ser anterior a la apertura.';
                return;
            }
        }
        cerrar();
        _solicitarClave('Ajustar horarios: ' + (inv.nombre || 'sin nombre'), function () {
            inv.fecha = fecha;
            if (hora) inv.turno = hora; else delete inv.turno;
            if (cierreV) inv.cierreOperativo = new Date(cierreV).toISOString();
            else delete inv.cierreOperativo;
            _guardarUno(inv);
            renderStats(); renderHistorial();
            alert('✅ Horarios actualizados.\n\nLos movimientos del periodo se reacomodan solos con la nueva hora de cierre.');
        });
    };
}

/* ══ MENÚ DE TRES PUNTOS ═══════════════════════════════════════════════════
   Ver, Continuar/Editar, Ajustar horarios, Reabrir, Finalizar y Eliminar en
   una lista, en vez de tres botones peleando por el ancho de la fila — y con
   el ✅ de finalizar a un pixel del ▶ de continuar. Lo destructivo va abajo,
   separado por una línea, que es donde el dedo no llega por inercia. */
function _invCerrarMenus() {
    var v = document.querySelectorAll('.inv-menu');
    for (var i = 0; i < v.length; i++) { try { v[i].remove(); } catch (e) {} }
}
function _invMi(ic, txt, accion, peligro) {
    return '<button class="' + (peligro ? 'peligro' : '') + '" onclick="_invCerrarMenus();' + accion + '" ' +
        'style="display:flex;align-items:center;justify-content:flex-start;gap:9px;width:100%;background:none;border:none;' +
        'padding:9px 11px;border-radius:7px;cursor:pointer;font-family:inherit;font-size:13px;text-align:left;' +
        'color:' + (peligro ? 'var(--red)' : 'var(--text)') + '" ' +
        'onmouseover="this.style.background=\'var(--surface2)\'" onmouseout="this.style.background=\'none\'">' +
        (_icInv(ic, 16) || '<span style="width:16px"></span>') + txt + '</button>';
}
function _invMenu(ev, id) {
    ev.stopPropagation();
    _invCerrarMenus();
    var inv = _invPorId(id);
    if (!inv) return;
    var esLev = inv.tipoInv === 'primer_lev';
    var q = String(id).replace(/'/g, "\\'");
    var m = document.createElement('div');
    m.className = 'inv-menu';
    var r = ev.currentTarget.getBoundingClientRect();
    m.style.cssText = 'position:fixed;z-index:10001;min-width:218px;background:var(--surface);' +
        'border:1px solid var(--border);border-radius:10px;padding:5px;box-shadow:0 14px 40px rgba(0,0,0,.5);' +
        'top:' + Math.min(r.bottom + 6, window.innerHeight - 280) + 'px;left:' + Math.max(10, r.right - 218) + 'px';
    var html = _invMi('ojo', 'Ver', "verInventarioTour('" + q + "')");
    if (esLev)             html += _invMi('rec-editar', 'Ajustar línea base', "abrirInventario('" + q + "')");
    else if (inv.cerrado)  html += _invMi('rec-editar', 'Editar', "editarInventario('" + q + "')");
    else                   html += _invMi('sto-siguiente', 'Continuar', "abrirInventario('" + q + "')");
    html += _invMi('sto-reloj', 'Ajustar horarios', "ajustarHorariosInv('" + q + "')");
    if (!esLev) {
        html += '<div style="height:1px;background:var(--border);margin:5px 2px"></div>';
        html += inv.cerrado
            ? _invMi('stf-desbloquear', 'Reabrir inventario', "reabrirInventario('" + q + "')")
            : _invMi('adm-pagado', 'Finalizar inventario', "finalizarInventarioHistorial('" + q + "')");
    }
    html += '<div style="height:1px;background:var(--border);margin:5px 2px"></div>';
    html += _invMi('ins-eliminar', 'Eliminar', "eliminarInventario('" + q + "')", true);
    m.innerHTML = html;
    document.body.appendChild(m);
    setTimeout(function () { document.addEventListener('click', _invCerrarMenus, { once: true }); }, 0);
}
function _invBtnMenu(id) {
    return '<button class="btn-vista" onclick="_invMenu(event,\'' + String(id).replace(/'/g, "\\'") + '\')" ' +
        'title="Acciones" style="padding:4px 11px;font-size:13px;line-height:1">⋯</button>';
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
                const estadoPill = esLev
                    ? `<span class="pill" style="background:rgba(155,141,232,.15);color:var(--viol);border:1px solid rgba(155,141,232,.35)">Línea base</span>`
                    : `<span class="pill ${inv.cerrado?'pill-green':'pill-amber'}">${inv.cerrado?'Cerrado':'Abierto'}</span>`;
                return `<tr>
                    <td style="color:var(--text-muted)">${new Date(inv.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}</td>
                    <td style="font-weight:500"><span class="inv-nom-ic">${tipoIcon(inv.tipoInv)}${etx(inv.nombre||'Sin nombre')}</span></td>
                    <td style="color:var(--text-dim);font-size:11px">${inv.area||'—'}</td>
                    <td style="color:var(--text-muted)">${(inv.filas||[]).length}</td>
                    <td style="color:var(--accent);font-weight:500">$${_money2(inv.capitalCosto)}</td>
                    <td style="color:var(--green);font-weight:500">$${_money2(inv.capitalCarta)}</td>
                    <td style="color:${dif>=0?'var(--green)':'var(--red)'};font-weight:500">${dif>=0?'+':''}$${_money2(dif)}</td>
                    <td>${estadoPill}</td>
                    <!-- Un menú en lugar de tres botones: en una tabla de nueve
                         columnas el ✅ de finalizar quedaba a un pixel del ▶ de
                         continuar, y ese descuido sella el conteo del mes. -->
                    <td style="text-align:right;white-space:nowrap">${_invBtnMenu(inv.id)}</td>
                </tr>`;
            }).join('')}</tbody>
        </table></div></div>
    </div>`;
}

function renderHistCard(inv) {
    const dif = (inv.difNetoCosto !== undefined ? inv.difNetoCosto : inv.diferenciaCosto) || 0;
    const esLev = inv.tipoInv === 'primer_lev'; // línea base: sin Continuar/Finalizar
    /* La acción más común se queda a la vista; el resto —incluido finalizar—
       vive en el menú, lejos del dedo. */
    const accionBtn = esLev
        ? `<button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1;color:var(--viol);border-color:var(--viol)"
            onclick="abrirInventario('${inv.id}')">${_icInv('rec-editar', 14)}Ajustar línea base</button>`
        : inv.cerrado
        ? `<button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1;color:var(--accent);border-color:var(--accent)"
            onclick="editarInventario('${inv.id}')">${_icInv('rec-editar', 14)}Editar</button>`
        : `<button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1"
            onclick="abrirInventario('${inv.id}')">${_icInv('sto-siguiente', 14)}Continuar</button>`;
    const estadoPill = esLev
        ? `<span class="pill" style="flex-shrink:0;margin-left:8px;background:rgba(155,141,232,.15);color:var(--viol);border:1px solid rgba(155,141,232,.35)">Línea base</span>`
        : `<span class="pill ${inv.cerrado?'pill-green':'pill-amber'}" style="flex-shrink:0;margin-left:8px">${inv.cerrado?'Cerrado':'Abierto'}</span>`;
    return `<div class="hist-card ${inv.cerrado?'cerrado':''}">
        <div class="hist-card-icon">${tipoIcon(inv.tipoInv, 28)}</div>
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
                onclick="verInventarioTour('${inv.id}')">${_icInv('ojo', 14)}Ver</button>
            ${accionBtn}
            ${_invBtnMenu(inv.id)}
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
    if (typeof _exigeInv === 'function' && !_exigeInv('capturar', 'No puedes abrir inventarios.')) return;
    invActual = null; filasCaptura = [];
    mostrarVista('vistaForm');
    limpiarFormulario();
    document.getElementById('formModo').textContent  = 'Nuevo inventario';
    document.getElementById('formTitulo').textContent = 'Datos generales';
    document.getElementById('btnIniciarInv').textContent = 'Iniciar inventario →';
}

function nuevoPrimerLev() {
    if (typeof _exigeInv === 'function' && !_exigeInv('capturar', 'No puedes abrir inventarios.')) return;
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
    var _TITCARD = {
        '__neto__':      '📊 Sobrante / Faltante neto del inventario',
        '__vtacompras__':'📦 Vendido contra compras del periodo'
    };
    if (_TITCARD[id]) {
        document.getElementById('notaInsNombre').textContent = _TITCARD[id];
        document.getElementById('notaInsInput').value = _notaCard(id);
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
    /* Las tarjetas del resumen no son insumos: su nota va aparte, o
       ensuciaría el mapa que el reporte recorre por insumo. */
    if (String(id).indexOf('__') === 0) {
        if (!invActual.notasCard) invActual.notasCard = {};
        if (txt) invActual.notasCard[id] = txt; else delete invActual.notasCard[id];
        _autoGuardar({ soloNota: true });
        _cerrarNotaInsumo();
        var wC = document.getElementById('notaWrap-' + id);
        if (wC) { wC.outerHTML = _btnNotaCard(id); return; }
        if (typeof renderStepContent === 'function') renderStepContent();
        return;
    }
    if (!invActual.notasInsumo) invActual.notasInsumo = {};
    if (txt) invActual.notasInsumo[id] = txt; else delete invActual.notasInsumo[id];
    // Una nota NO cambia ningún número → no invalida el resumen (soloNota) y no dispara
    // un recálculo pesado. El guardado local va debounced dentro de _autoGuardar.
    _autoGuardar({ soloNota: true });
    _cerrarNotaInsumo();
    // Actualizar SOLO la celda de la nota (antes re-renderizaba TODAS las tablas → lento).
    var e5 = document.getElementById('s5est-' + id);          // el Resultado: la nota bajo el ⋯
    if (e5) e5.outerHTML = _s5Estado(id);
    var w = document.getElementById('notaWrap-' + id);
    if (w) { w.outerHTML = _btnNotaInsumo(id); return; }
    if (e5) return;
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
function _btnNotaNeto() { return _btnNotaCard('__neto__'); }
window._btnNotaNeto = _btnNotaNeto;

/* El mismo botón de nota, para cualquier tarjeta del resumen. Estaba cableado
   al sobrante/faltante; un comprado-contra-vendido que no cuadra pide tanta
   explicación como un faltante —«entró mercancía en consignación», «se surtió
   de la otra sucursal»— y sin eso el reporte directivo enseña un número raro
   sin nadie que lo defienda. */
function _btnNotaCard(id) {
    var n = _notaCard(id);
    return '<span id="notaWrap-' + id + '" style="display:inline-block">' +
        '<button onclick="event.stopPropagation();editarNotaInsumo(\'' + id + '\')" ' +
        'style="font-size:11px;padding:4px 10px;border-radius:6px;cursor:pointer;background:transparent;' +
        'border:1px solid ' + (n?'var(--accent)':'#888') + ';color:' + (n?'var(--accent)':'#999') + '">📝 ' + (n?'Nota ✓':'Agregar nota') + '</button>' +
        (n ? '<div style="font-size:11px;color:var(--accent);margin-top:5px;font-style:italic;line-height:1.5">📝 ' + etx(n) + '</div>' : '') +
    '</span>';
}
window._btnNotaCard = _btnNotaCard;
/* El sobrante neto guarda su nota en un campo propio desde antes (comentarioNeto)
   y se respeta para no perder lo ya escrito; las demás van juntas en un mapa. */
function _notaCard(id) {
    if (id === '__neto__') return (invActual && invActual.comentarioNeto) || '';
    return (invActual && invActual.notasCard && invActual.notasCard[id]) || '';
}

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

/* ══ CATÁLOGO Y RECETAS FRESCOS ═══════════════════════════════════════════
   La página cargaba el catálogo y las recetas UNA vez, al abrir. Con la
   pestaña abierta un rato —lo normal en la tablet de la barra— lo que se
   agregaba en otra pestaña o en otro equipo no existía aquí:
     · un inventario nuevo salía con insumos de menos (Edwin: «190 de 230»);
     · una sub-receta creada después no tenía receta para el inventario: su
       batch podía tener renglón, pero sus ingredientes NO se descontaban;
     · Recalcular releía el catálogo de la copia local de ESTA pestaña (que
       no ve lo de las otras), armaba con eso y luego otra vez con la nube, y
       las recetas no las volvía a pedir nunca: solo refrescar arreglaba.
   Ahora, al abrir un inventario y al Recalcular, se piden los dos a la nube.
   Una sola petición a la vez: si ya va una, se espera esa. */
var _refrescandoInv = null;
function _refrescarDatosInv() {
    if (_refrescandoInv) return _refrescandoInv;
    if (typeof _supabase === 'undefined') return Promise.resolve(false);
    var negId = getNegocioActivo(); if (!negId) return Promise.resolve(false);
    _refrescandoInv = Promise.all([
        _leerCatalogoInv(negId),
        _leerTablaInv('recetas', negId)
    ]).then(function (r) {
        if (getNegocioActivo() !== negId) return false;           // se cambió de negocio a medio viaje
        var llego = false;
        if (_catalogoSirve(r[0])) {
            var lista = (r[0].data || []).map(function (x) { return x.datos; }).filter(Boolean);
            if (lista.length) {
                _cacheInsumosInv = lista; _catProvisional = false; llego = true;
                try { _skPut(_sk('insumos'), JSON.stringify(lista.map(function (ins) { var c = Object.assign({}, ins); c.foto = ''; c.fotoUrl = ''; return c; }))); } catch (e) {}
            }
        }
        if (r[1] && !r[1].error && !(r[1].parcial && (_cacheRecetasInv || []).length > r[1].data.length)) { _cacheRecetasInv = (r[1].data || []).map(function (x) { return x.datos; }).filter(Boolean); llego = true; }
        if (llego) {
            if (typeof _consumoIdxCache !== 'undefined') _consumoIdxCache = null;
            _consumoDirty = true; _repCache = null;
        }
        return llego;
    }, function () { return false; }).then(function (v) { _refrescandoInv = null; return v; },
                                            function () { _refrescandoInv = null; return false; });
    return _refrescandoInv;
}
/* Rearma el inventario abierto con lo fresco, SIN perder lo tecleado mientras
   viajaba la petición. El Resultado se marca para recalcular siempre; el paso
   en pantalla se repinta solo si es el 5 o si cambió la lista (para no mover
   la captura de quien está contando). */
function _rearmarConDatosFrescos(inv) {
    /* Si la carga INICIAL todavía va en camino, ella misma rearma el inventario
       abierto al llegar (catálogo y recetas incluidos): pedir otra vez sería
       bajar lo mismo dos veces por la misma red lenta. */
    if (!_INV_CARGADO) return Promise.resolve(false);
    return _refrescarDatosInv().then(function (llego) {
        _quitarAvisoCatalogo();
        if (!llego || !invActual || invActual !== inv) return llego;
        var antes = (filasCaptura || []).map(function (f) { return f.insumoId; }).join('|');
        if (filasCaptura.length) invActual.filas = filasCaptura.map(function (f) { return Object.assign({}, f); });
        try { cargarProductosCaptura(); } catch (e) { console.warn('[inv] rearmar con datos frescos:', e); return llego; }
        window._step5Dirty = true;
        var despues = (filasCaptura || []).map(function (f) { return f.insumoId; }).join('|');
        if (typeof renderStepContent === 'function' && (pasoActual === 5 || antes !== despues)) renderStepContent();
        return llego;
    });
}

// Fuerza un render nuevo del Paso 5 (estilo "renderizar" de Premiere) — por si
// el usuario editó pasos anteriores y quiere refrescar el resultado a mano.
function recalcularResultado() {
    var inv = invActual;
    if (!inv) return;
    // Lo tecleado antes del autoguardado no se puede perder en el rearmado.
    if (filasCaptura.length) invActual.filas = filasCaptura.map(function(f){ return Object.assign({}, f); });
    var btn = document.getElementById('btnRecalc5'), txt = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Recalculando…'; }
    var fin = function () {
        if (btn) { btn.disabled = false; btn.innerHTML = txt || (_icInv('mov-movimientos') + 'Recalcular'); }
        if (!invActual || invActual !== inv) return;
        /* UN rearmado, con lo más fresco que haya: lo de la nube si llegó, y si
           no (sin red), lo que ya estaba en memoria —nunca la copia local de
           esta pestaña, que no ve lo que se cambió en otra—. */
        if (filasCaptura.length) invActual.filas = filasCaptura.map(function(f){ return Object.assign({}, f); });
        var _antes = (filasCaptura || []).length;
        try { cargarProductosCaptura(); }
        catch (e) { console.warn('[inv] recalcular: no se pudo re-sincronizar con el catálogo', e); }
        if (_antes && !(filasCaptura || []).length && getInsumos().length)
            console.warn('[inv] recalcular dejó 0 filas con catálogo presente');
        if (typeof _consumoIdxCache !== 'undefined') _consumoIdxCache = null;
        _consumoDirty = true;
        window._step5Dirty = true;
        window._step5Force = true;           // fuerza el recálculo aunque haya caché
        if (typeof _marcarStep5Stale === 'function') _marcarStep5Stale(false);
        if (typeof renderStepContent === 'function') renderStepContent();
    };
    _refrescarDatosInv().then(fin, fin);
}
window.recalcularResultado = recalcularResultado;
// Avisa en el Paso 5 que los datos cambiaron y hay que recalcular (badge + botón resaltado).
function _marcarStep5Stale(stale) {
    var b = document.getElementById('step5StaleBadge');
    /* El aviso iba en texto de 11px entre ocho botones: se podía mirar el
       Resultado entero sin verlo. Ahora es una pastilla con fondo. Casi nunca
       sale —el resumen se recalcula solo al entrar con datos nuevos— y por eso
       mismo, cuando sale, tiene que leerse. */
    if (b) {
        b.style.display = stale ? 'inline-flex' : 'none';
        b.style.cssText = (stale ? 'display:inline-flex' : 'display:none') +
            ';align-items:center;gap:4px;font-size:11px;font-weight:700;' +
            'color:#0a0908;background:var(--accent);border-radius:20px;padding:3px 11px';
    }
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
    // Conteos capturados desde el celular (v42): llegan como propuesta, no se aplican solos.
    cargarConteosQR().then(function(){ if (pasoActual === 1) renderStepContent(); });
    pasoActual = 1;
    busquedaCapt = ''; filtroFamActivo = ''; filtroCatActiva = ''; filtroSubcatActiva = ''; filtroRegistroActivo = 'pendientes';
    mostrarVista('vistaCaptura');
    document.getElementById('captTitulo').textContent = invActual.nombre || 'Inventario';
    actualizarStepBar();
    actualizarNavBtns();
    renderStepContent();
    _rearmarConDatosFrescos(invActual);   // catálogo y recetas de la nube: lo de otras pestañas también
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
    /* ══ LA CONTRASEÑA GENERAL (19-nov-2026) ══════════════════════════════
       Esto pedía SOLO la contraseña de la cuenta con sesión de Supabase: el
       colaborador que entra con su usuario veía «Cuenta: el correo del dueño»
       y tenía que saberse la contraseña del dueño. Choca con los roles y
       permisos (Edwin). Ahora va por el guardia general (admin-guard.js), el
       mismo de los borrados de este módulo: acepta la contraseña del
       colaborador con sesión, la de la cuenta, la del dueño o la del admin.
       Lo que cada rol puede hacer lo siguen decidiendo sus permisos
       (_exigeInv), no esta contraseña. */
    if (typeof window._pedirClaveAdmin === 'function') {
        window._pedirClaveAdmin(accion, callback, 'Confirmar');
        return;
    }
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
        /* Con un cliente EFÍMERO, nunca con el global.
           Verificar la contraseña con `_supabase` es firmar de nuevo con la
           sesión activa: supabase-js limpia la sesión antes de intentar, así que
           un intento fallido —o uno hecho con el correo equivocado— TE SACA. Y
           sin sesión, ninguna escritura pasa el RLS: los cambios se quedan
           atorados en la cola y los borrados no persisten, así que las entradas
           "revivían". Todo eso salía de teclear una contraseña para borrar una
           entrada. admin-guard.js ya usaba cliente aparte; esto se quedó atrás. */
        const ok = await _verificarClaveAparte(_sesionEmail, pass);
        if (!ok) throw new Error('Contraseña incorrecta');
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

/* Cliente aparte, sin sesión persistente: valida contra el servidor y no toca la
   sesión de nadie. Se reusa el de admin-guard si ya está cargado, para no abrir
   dos conexiones que hacen lo mismo. */
var _invVerifier = null;
async function _verificarClaveAparte(email, pass) {
    if (!email || !pass) return false;
    if (typeof window._verificarCredEtaax === 'function') return window._verificarCredEtaax(email, pass);
    try {
        if (!_invVerifier) {
            if (typeof supabase === 'undefined' || !supabase.createClient) return false;
            var url = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : (window.SUPABASE_URL || '');
            var key = (typeof SUPABASE_ANON !== 'undefined') ? SUPABASE_ANON : (window.SUPABASE_ANON || '');
            if (!url || !key) return false;
            _invVerifier = supabase.createClient(url, key, {
                auth: { persistSession: false, autoRefreshToken: false,
                        detectSessionInUrl: false, storageKey: 'etaax-verify-inv' }
            });
        }
        var r = await _invVerifier.auth.signInWithPassword({ email: email, password: pass });
        if (!r.error) { try { await _invVerifier.auth.signOut({ scope: 'local' }); } catch (e) {} }
        return !r.error;
    } catch (e) { return false; }
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
    if (typeof _exigeInv === 'function' && !_exigeInv('capturar', 'No puedes abrir inventarios.')) return;
    const esNuevo = !invActual;
    if (esNuevo) {
        invActual = {
            id: genId(), cerrado: false,
            /* Momento REAL de apertura. `fecha` es un dato que se teclea (y se puede
               corregir); esto es cuándo se abrió de verdad, y es la mitad de lo que
               define el periodo. */
            abiertoAt: new Date().toISOString(),
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
    _rearmarConDatosFrescos(invActual);   // catálogo y recetas de la nube: lo de otras pestañas también
}

// ── Cargar productos ──────────────────────────────────────────
// ¿El insumo/sub-receta pertenece al ÁREA de este inventario?
// Regla: SIN área asignada NO aparece en ningún inventario; con área, solo en el
// inventario de esa misma área (el inventario 'general' incluye todas las que SÍ
// tengan área). Aplica igual a insumos y a sub-recetas-como-insumo.
/* ══ QUÉ ÁREAS DE INSUMO ENTRAN A CADA INVENTARIO ═════════════════════════
   El catálogo parte el almacén en tres (almacén barra / cocina / general,
   ver staff-area.js), pero aquí se comparaba el texto exacto contra las áreas
   del inventario (barra, bodega, cocina, general): un insumo —o una
   sub-receta— puesto en «Almacén barra» no salía en el inventario de barra
   ni en el de bodega, solo en el general. Desaparecía sin aviso.

   El inventario de barra cuenta la barra Y lo que la barra guarda (cada
   renglón ya separa «cerradas en barra» y «en bodega»); el de cocina igual;
   el de bodega es el almacén completo. 'bodega' a secas sigue valiendo: es
   almacén general. */
var _AREAS_DE_INV = {
    barra:  ['barra', 'almacen_barra'],
    cocina: ['cocina', 'almacen_cocina'],
    bodega: ['almacen_barra', 'almacen_cocina', 'almacen_general']
};
function _insumoEnAreaInv(ins) {
    if (!ins) return false;
    var crudo = (ins.area || '').toString().trim().toLowerCase();
    if (!crudo) return false;                      // sin área → nunca aparece
    var invA = ((invActual && invActual.area) || '').toString().trim().toLowerCase();
    if (!invA || invA === 'general') return true;  // inventario general → todas las que tengan área
    if (crudo === invA) return true;
    var insA = (window.StaffArea && StaffArea.normIns) ? (StaffArea.normIns(crudo) || crudo) : crudo;
    return (_AREAS_DE_INV[invA] || [invA]).indexOf(insA) >= 0;
}

// insumoIds con movimiento del QR (entrada/merma/salida) en el periodo+sucursal de
// ESTE inventario. Deben aparecer aunque no tengan área asignada, para poder atribuir
// su merma/entrada (si no, una merma de cerveza sin área se caía del reporte).
function _insumosConMovimientoQR() {
    var set = {}, suc = _sucActiva();
    (getEntradasLog() || []).forEach(function(e){
        if (!e || e.borrada || !e.insumoId) return;
        if (e.sucursalId && suc && e.sucursalId !== suc) return; // sello de sucursal
        if (!_enPeriodoInvActual(e.fecha, e.registrado)) return;  // periodo de este inventario
        set[_canonInsumoId(e.insumoId)] = 1;                     // por id canónico (empata con la fila)
    });
    return set;
}

/* ══ CONTAR POR EMPAQUE DE COMPRA ════════════════════════════════════════════
   La barra no cuenta 72 botellas: cuenta 3 rejillas. El insumo ya sabe en qué
   viene ("Caja de 24 Botellas" = presentacionCompra + cantPresCompra + umPresCompra),
   así que el capturista elige la unidad y el sistema multiplica.

   REGLA: el inventario SIEMPRE guarda PIEZAS. La conversión vive solo en la
   ventanilla de captura — igual que copa/onza. Así ninguna fórmula de abajo
   (resguardo, costo, variancia) tiene que saber que existen las rejillas, y los
   inventarios viejos siguen leyéndose igual. */
function _empaqueCompra(ins) {
    var p = (ins && (ins.presentaciones || [])[0]) || {};
    var n = parseFloat(p.cantPresCompra) || 0;
    if (!(n > 1)) return null;                       // "caja de 1" no ahorra nada
    var pres = (p.presentacionCompra || '').toString().trim();
    if (!pres || /^(pieza|piezas|botella|botellas)$/i.test(pres)) return null;
    return { label: pres, factor: n, um: (p.umPresCompra || 'Piezas') };
}
function _empaqueDeFila(fila) {
    if (!fila) return null;
    var cid = _canonInsumoId(fila.insumoId) || fila.insumoId;
    var ins = (getInsumos() || []).find(function (x) {
        return x && (_canonInsumoId(x.id) || x.id) === cid;
    });
    return _empaqueCompra(ins);
}
// ¿Esta fila se está capturando por empaque?
function _porEmpaque(fila) { return !!(fila && fila.umCerr === 'pres' && _empaqueDeFila(fila)); }

// Piezas guardadas → lo que se ENSEÑA en la casilla (cajas, si así se eligió).
function _cerrMostrar(fila, v) {
    if (v == null || v === '') return '';
    var e = _porEmpaque(fila) ? _empaqueDeFila(fila) : null;
    if (!e) return v;
    var n = (parseFloat(v) || 0) / e.factor;
    return String(Math.round(n * 1000) / 1000);
}
// Lo tecleado (cajas) → PIEZAS, que es lo único que se guarda.
function _cerrAPiezas(fila, v) {
    if (v === '' || v == null) return '';
    var e = _porEmpaque(fila) ? _empaqueDeFila(fila) : null;
    if (!e) return v;
    return Math.round((parseFloat(v) || 0) * e.factor * 1000) / 1000;
}
/* COMO UNA CELDA DE EXCEL (Edwin, 22-nov): «2+3+1» se queda escrito en la
   casilla y abajo dice el resultado («= 6»). El número se guarda donde siempre
   (cerradasBodega / cerradasBarra); la operación, aparte, en fila.fx, para
   volver a verla y corregirla. */
function _fxDe(fila, campo) { return (fila && fila.fx && fila.fx[campo]) || ''; }
function _fxResHTML(fila, campo, valor) {
    var fx = _fxDe(fila, campo);
    return fx ? '= ' + etx(String(valor)) : '';
}
function updCerradasCalc(idx, campo, el) {
    var crudo = String(el.value || '').trim();
    var vacio = !crudo;
    var fila = filasCaptura[idx];
    var ok = false;
    _celdaCalc(el, function (v) { ok = true; updCaptura(idx, campo, vacio ? '' : _cerrAPiezas(fila, v)); });
    if (!ok) return;                                      // no se entendió: se queda en rojo, sin tocar nada
    fila = filasCaptura[idx];
    if (!fila.fx) fila.fx = {};
    if (!vacio && _esFormula(crudo)) { fila.fx[campo] = crudo; el.value = crudo; }
    else {
        delete fila.fx[campo];
        // La casilla se queda mostrando lo tecleado (cajas), no las piezas.
        if (!vacio && _porEmpaque(fila)) el.value = _cerrMostrar(fila, fila[campo]);
    }
    var r = document.getElementById('fxr-' + idx + '-' + campo);
    if (r) r.textContent = fila.fx[campo] ? '= ' + _cerrMostrar(fila, fila[campo]) : '';
    if (typeof _autoGuardar === 'function') _autoGuardar();
}
/* «+» y «−» para el teclado numérico de la tablet, que no los trae. Se escribe
   al final de la casilla sin quitarle el foco (pointerdown + preventDefault). */
function _celdaOp(id, op) {
    var el = document.getElementById(id); if (!el) return;
    if (document.activeElement !== el) el.focus();
    var v = String(el.value || '');
    if (/[+\-*/]$/.test(v)) v = v.slice(0, -1);         // cambiar de operador, no apilarlos
    el.value = v + op;
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
}
window._celdaOp = _celdaOp;
window.updCerradasCalc = updCerradasCalc;

// Sufijo del rótulo: "Cerradas Bodega (cajas)" mientras se cuenta por empaque.
function _sufEmpaque(fila) {
    var e = _porEmpaque(fila) ? _empaqueDeFila(fila) : null;
    return e ? ' <span style="color:var(--accent);text-transform:none">(' + etx(e.label.toLowerCase()) + ')</span>' : '';
}
function _tipEmpaque(fila) {
    var e = _empaqueDeFila(fila);
    var base = 'Puedes escribir operaciones: 3*24+5';
    if (!e) return base;
    return _porEmpaque(fila)
        ? 'Contando en ' + etx(e.label.toLowerCase()) + ' · 1 = ' + e.factor + ' ' + etx((e.um || 'piezas').toLowerCase()) + '. ' + base
        : base;
}
/* En la tabla no cabe el selector completo: va un chip que alterna la unidad. */
function _chipEmpaque(fila, idx) {
    var e = _empaqueDeFila(fila); if (!e) return '';
    var porEmp = _porEmpaque(fila);
    return '<button type="button" onclick="setUmCerradas(' + idx + ',\'' + (porEmp ? 'pza' : 'pres') + '\')" ' +
        'title="Cambiar a ' + (porEmp ? etx(e.um || 'piezas') : etx(e.label) + ' de ' + e.factor) + '" ' +
        'style="display:block;margin:3px auto 0;padding:1px 7px;border-radius:10px;font-size:9.5px;cursor:pointer;font-family:inherit;border:1px solid ' +
        (porEmp ? 'var(--accent);background:rgba(245,200,66,.14);color:var(--accent)' : 'var(--border);background:transparent;color:var(--text-dim)') + '">' +
        (porEmp ? etx(e.label.toLowerCase()) + ' ×' + e.factor : etx((e.um || 'pza').toLowerCase())) + '</button>';
}

/* Mismo trato para las ENTRADAS: llega el proveedor con 3 rejillas, no con 72
   botellas. Se teclea en rejillas y se guardan piezas — las entradas alimentan el
   resguardo y el costo, y esas fórmulas siguen hablando de piezas. */
function _porEmpaqueEnt(fila) { return !!(fila && fila.umEnt === 'pres' && _empaqueDeFila(fila)); }
function _entMostrar(fila, v) {
    if (v == null || v === '') return '';
    var e = _porEmpaqueEnt(fila) ? _empaqueDeFila(fila) : null;
    if (!e) return v;
    return String(Math.round(((parseFloat(v) || 0) / e.factor) * 1000) / 1000);
}
/* Entradas con operaciones, igual que las existencias: llegan "3 rejillas + 2
   sueltas" y se escribe 3*24+2. Antes el oninput borraba los operadores letra por
   letra, así que en entradas era imposible teclear una cuenta. */
function updEntradaCalc(idx, ei, el) {
    var vacio = !String(el.value || '').trim();
    _celdaCalc(el, function (v) { updEntradaEmp(idx, ei, vacio ? '' : v); });
}
window.updEntradaCalc = updEntradaCalc;
function updEntradaEmp(idx, ei, val) {
    var fila = filasCaptura[idx];
    var e = _porEmpaqueEnt(fila) ? _empaqueDeFila(fila) : null;
    var piezas = (val === '' || val == null) ? ''
        : (e ? Math.round((parseFloat(val) || 0) * e.factor * 1000) / 1000 : val);
    updEntrada(idx, ei, piezas);
}
window.updEntradaEmp = updEntradaEmp;
function setUmEntradas(idx, modo) {
    var fila = filasCaptura[idx]; if (!fila) return;
    fila.umEnt = (modo === 'pres') ? 'pres' : 'pza';
    _autoGuardar();
    renderStepContent();
}
window.setUmEntradas = setUmEntradas;
// Selector de las entradas (mismo look que el del Paso 1).
function selectorEmpaqueEnt(fila, idx, compacto) {
    var e = _empaqueDeFila(fila);
    if (!e) return '';
    var porEmp = _porEmpaqueEnt(fila);
    var lblPza = (e.um || 'Piezas');
    return '<div style="display:flex;align-items:center;gap:7px;margin-bottom:' + (compacto ? '6px' : '8px') + '">' +
        '<span style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Reciben en</span>' +
        '<div style="display:flex;gap:4px">' +
            '<button type="button" onclick="setUmEntradas(' + idx + ',\'pza\')" ' +
                'style="padding:2px 9px;border-radius:12px;font-size:10.5px;cursor:pointer;font-family:inherit;border:1px solid ' +
                (!porEmp ? 'var(--accent);background:rgba(245,200,66,.14);color:var(--accent)' : 'var(--border);background:transparent;color:var(--text-dim)') + '">' +
                etx(lblPza) + '</button>' +
            '<button type="button" onclick="setUmEntradas(' + idx + ',\'pres\')" ' +
                'title="1 ' + etx(e.label) + ' = ' + e.factor + ' ' + etx(lblPza).toLowerCase() + '" ' +
                'style="padding:2px 9px;border-radius:12px;font-size:10.5px;cursor:pointer;font-family:inherit;border:1px solid ' +
                (porEmp ? 'var(--accent);background:rgba(245,200,66,.14);color:var(--accent)' : 'var(--border);background:transparent;color:var(--text-dim)') + '">' +
                etx(e.label) + ' <span style="opacity:.65">×' + e.factor + '</span></button>' +
        '</div></div>';
}

// Selector "Contar en": solo aparece si el insumo viene en un empaque de más de 1.
function selectorEmpaque(fila, idx, compacto) {
    var e = _empaqueDeFila(fila);
    if (!e) return '';
    var porEmp = _porEmpaque(fila);
    var lblPza = (e.um || 'Piezas');
    return '<div style="display:flex;align-items:center;gap:7px;margin-bottom:' + (compacto ? '7px' : '9px') + '">' +
        '<span style="font-size:' + (compacto ? '10px' : '11px') + ';color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Contar en</span>' +
        '<div style="display:flex;gap:4px">' +
            '<button type="button" onclick="setUmCerradas(' + idx + ',\'pza\')" ' +
                'style="padding:3px 10px;border-radius:14px;font-size:11px;cursor:pointer;font-family:inherit;border:1px solid ' +
                (!porEmp ? 'var(--accent);background:rgba(245,200,66,.14);color:var(--accent)' : 'var(--border);background:transparent;color:var(--text-dim)') + '">' +
                etx(lblPza) + '</button>' +
            '<button type="button" onclick="setUmCerradas(' + idx + ',\'pres\')" ' +
                'title="1 ' + etx(e.label) + ' = ' + e.factor + ' ' + etx(lblPza).toLowerCase() + '" ' +
                'style="padding:3px 10px;border-radius:14px;font-size:11px;cursor:pointer;font-family:inherit;border:1px solid ' +
                (porEmp ? 'var(--accent);background:rgba(245,200,66,.14);color:var(--accent)' : 'var(--border);background:transparent;color:var(--text-dim)') + '">' +
                etx(e.label) + ' <span style="opacity:.65">×' + e.factor + '</span></button>' +
        '</div></div>';
}
/* Cambiar de unidad NO cambia lo contado: las piezas guardadas son las mismas y
   solo se re-expresan. Si contaste 72 botellas y cambias a Caja, ves 3. */
function setUmCerradas(idx, modo) {
    var fila = filasCaptura[idx]; if (!fila) return;
    fila.umCerr = (modo === 'pres') ? 'pres' : 'pza';
    _autoGuardar();
    renderStepContent();
}
window.setUmCerradas = setUmCerradas;

/* Trae el catálogo de insumos de la nube si todavía no está en memoria. Es la red
   de seguridad de la carga inicial: no importa por qué camino se abrió el
   inventario, si no hay insumos se piden y punto. */
var _catInvPidiendo = false;
async function _asegurarCatalogoInv(forzar) {
    if ((!forzar && getInsumos().length) || _catInvPidiendo) return false;
    if (typeof _supabase === 'undefined') return false;
    var negId = getNegocioActivo(); if (!negId) return false;
    _catInvPidiendo = true;
    try {
        var r = await _leerCatalogoInv(negId);
        if (!_catalogoSirve(r)) return false;
        var lista = (r.data || []).map(function (x) { return x.datos; }).filter(Boolean);
        if (!lista.length) return false;
        _cacheInsumosInv = lista;
        _catProvisional = false;
        // Espejo en localStorage, igual que _sbInitInv (sin fotos, por la cuota).
        try {
            _skPut(_sk('insumos'), JSON.stringify(lista.map(function (ins) {
                var c = Object.assign({}, ins); c.foto = ''; c.fotoUrl = ''; return c;
            })));
        } catch (e) {}
        return true;
    } catch (e) { return false; }
    finally { _catInvPidiendo = false; }
}

/* La fila ya capturada de un insumo, buscada por id CANÓNICO.
   Buscarla por id crudo era la mitad del bug de los insumos duplicados: si el
   inventario viejo la guardó bajo el id de la COPIA por sucursal y el catálogo la
   arma con el MAESTRO, no empataban — salía un renglón nuevo en ceros y el que
   traía los datos quedaba suelto al lado.
   Y si hay VARIAS (un inventario que YA se dañó con el duplicado), gana la que trae
   captura de verdad: quedarse con la vacía sería borrarle el conteo al dueño justo
   al abrir el inventario para repararlo. */
function _filaConMovimiento(f) {
    if (!f) return false;
    if ((parseFloat(f.cerradasBodega) || 0) > 0 || (parseFloat(f.cerradasBarra) || 0) > 0) return true;
    if ((f.pesos || []).some(function (p) { return (parseFloat(p) || 0) > 0; })) return true;
    if ((parseFloat(f.existenciaPeso) || 0) > 0) return true;
    if ((f.entradas || []).some(function (e) { return (parseFloat(e) || 0) > 0; })) return true;
    if ((parseFloat(f.ventasCopasDirectas) || 0) > 0 || (parseFloat(f.ventasBotella) || 0) > 0) return true;
    if ((parseFloat(f.cortesiaCopas) || 0) > 0 || (parseFloat(f.mermaCopas) || 0) > 0 || (parseFloat(f.mermaBase) || 0) > 0) return true;
    if ((parseFloat(f.nivelPct) || 0) > 0) return true;
    return false;
}
function _filaGuardadaDe(cid) {
    var cands = (invActual && invActual.filas || []).filter(function (f) {
        return f && f.insumoId && (_canonInsumoId(f.insumoId) || f.insumoId) === cid;
    });
    if (cands.length <= 1) return cands[0];
    // «Registrado en cero» es una captura válida, pero no debe desplazar
    // la fila hermana que sí contiene cantidades (el otro helper incluye registrado).
    return cands.find(_filaConMovimiento) || cands.find(_filaConDatos) || cands[0];
}

function _filasUnicasInventario(filas) {
    var grupos = {}, orden = [];
    (filas || []).forEach(function(f){
        if (!f || !f.insumoId) return;
        var id = _canonInsumoId(f.insumoId);
        if (!grupos[id]) { grupos[id] = []; orden.push(id); }
        grupos[id].push(f);
    });
    return orden.map(function(id){
        var fs = grupos[id];
        return fs.find(_filaConMovimiento) || fs.find(_filaConDatos) || fs[0];
    });
}

function _catalogoUnicoInv() {
    var porId = {}, orden = [];
    _scopeSucInsumos(getInsumos()).forEach(function(ins){
        if (!ins.id) return;
        var cid = _canonInsumoId(ins.id);
        if (!porId[cid]) { porId[cid] = ins; orden.push(cid); }
        // Datos legacy pueden traer maestro Y copia asignados a la sucursal.
        // La ficha local tiene sus cambios; nunca crear dos filas del mismo ID.
        else if (ins.origenId && !porId[cid].origenId) porId[cid] = ins;
    });
    return orden.map(function(id){ return porId[id]; });
}
function _filaHistoricaNecesaria(f, movQR) {
    if (_filaConMovimiento(f) || (parseFloat(f.existenciaAnterior) || 0) !== 0 ||
        (parseFloat(f.existenciaFisica) || 0) !== 0) return true;
    var id = _canonInsumoId(f.insumoId);
    if (movQR[id]) return true;
    // Físico cero no implica inactividad: pudo consumirse en recetas/batches.
    if (consumoRecetasFila(f) > 0 || _consumoBaseProd(f) > 0) return true;
    // Incluye movimientos manuales y cancelaciones aunque el físico sea cero.
    return ['entradasLog', 'cancelaciones'].some(function(campo){
        return ((invActual && invActual[campo]) || []).some(function(x){
            return x && !x.borrada && _movimientoDelInsumo(x, id);
        });
    });
}

function cargarProductosCaptura() {
    _consumoDirty = true; window._step5Dirty = true;
    // Solo insumos de la sucursal activa Y del ÁREA de este inventario. Sin área → no
    // entra (qué hace la canela en un inventario de barra 😅). PERO sí entran: lo YA
    // capturado en este inventario, y los que tienen un MOVIMIENTO del QR (merma/entrada/
    // salida) en su periodo+sucursal — así su merma siempre se refleja en el reporte.
    const _movQR = _insumosConMovimientoQR();
    const insumos = _catalogoUnicoInv().filter(function(ins){
        var _cid = ins.origenId || ins.id; // id canónico (copia → maestro)
        /* Una sub-receta a la que se le dijo «No» a «¿Usar como prebatch en el
           inventario?» queda FUERA, no solo escondida: antes se colaba en las
           cuentas del Resultado aunque no saliera en la lista de captura.
           Salvo que este inventario ya la haya contado: lo capturado no se
           tira por cambiar de opinión a medio inventario. */
        if (ins.esSubReceta && ins.ocultoInventario) {
            var _fg = _filaGuardadaDe(_cid);
            return !!(_fg && _filaConDatos(_fg)) || !!_movQR[_cid];
        }
        if (_insumoEnAreaInv(ins)) return true;
        if (_movQR[_cid]) return true; // tiene merma/entrada del QR en este periodo → incluir
        var f = _filaGuardadaDe(_cid);
        return !!(f && _filaConDatos(f));
    });
    if (!getInsumos().length) {
        // Una carga pendiente/fallida no significa catálogo vacío. Mantener
        // los conteos guardados mientras llega la respuesta, incluso sin fichas.
        filasCaptura = (invActual && invActual.filas || []).slice();
        // El catálogo puede no haber llegado todavía: entrar al negocio e ir DIRECTO
        // a un inventario le gana la carrera al pull de Supabase y el Paso 1 salía
        // vacío ("Sin insumos en catálogo") hasta que ibas a Insumos y volvías. Si de
        // plano no hay catálogo, se pide AHORA y las filas se rearman al llegar.
        if (!getInsumos().length) {
            _asegurarCatalogoInv().then(function (llego) {
                if (!llego || typeof invActual === 'undefined' || !invActual) return;
                cargarProductosCaptura();
                if (typeof irAPaso === 'function') irAPaso(typeof pasoActual !== 'undefined' ? (pasoActual || 1) : 1);
                else if (typeof renderStepContent === 'function') renderStepContent();
            });
        }
        return;
    }
    _sanearRefInv(); // ref guardado obsoleto (primer lev con intermedios más nuevos) → automático

    filasCaptura = insumos.map(ins => {
        // Id CANÓNICO: la fila SIEMPRE se llavea por el maestro (origenId||id), así empata
        // con lo ya capturado y con las recetas, aunque `ins` sea una copia por sucursal.
        const _cid = ins.origenId || ins.id;
        const guardada = _filaGuardadaDe(_cid);
        const existe = guardada && Object.assign({}, guardada);
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
                const contBaseEx = _contenidoBasePresentacion(ins, pEx);
                if (contBaseEx > 0) existe.contNeto = contBaseEx;
                if (['abarrote','fruta','carne'].indexOf(ins.tipoInsumo) >= 0) existe.baseUnit = unidadBaseInsumo(ins);
                const pcEx = parseFloat(pEx.pesoCristal);
                if (!isNaN(pcEx)) existe.pesoCristal = pcEx; // puede bajar a 0 a propósito
                existe.rendimientoBatch = parseFloat(pEx.rendimiento) || 0; // sub-recetas: ml/g por batch
                Object.assign(existe, _parametrosStockFila(existe, invActual && invActual.sucursalId));
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
            existe.existenciaAnterior = getExistenciaAnterior(_cid, existe.aliasDe);
            // Reexpresar las botellas capturadas si cambió contenido/copa del
            // catálogo. El aporte anterior se quita antes de sumar el nuevo.
            ['cortesiaCopas','mermaCopas'].forEach(function(campo) {
                var k = _camposSalida(campo);
                if (existe[k.botella] !== undefined) _actualizarSalida(existe, campo, {});
            });
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
        // Abarrotes: contenido utilizable (drenado si existe), en g/ml.
        const contBase = _contenidoBasePresentacion(ins, p || {});

        return {
            insumoId: _cid, // id canónico (maestro), aunque `ins` sea copia por sucursal
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
            stockMin:       p && p.stockMin != null ? p.stockMin : ins.stockMin,
            stockMax:       p && p.stockMax != null ? p.stockMax : ins.stockMax,
            existenciaAnterior: getExistenciaAnterior(_cid),
            // Paso 1: existencias físicas
            // Vacías, no 0: un cero escrito significa "conté y no hay"; uno puesto por el
            // sistema no significa nada. La aritmética sigue igual porque '' || 0 = 0.
            cerradasBodega: '', cerradasBarra: '',
            pesos: ['','','',''],   // 4 botellas abiertas (kg)
            existenciaPeso: '',     // alimentos: conteo físico en unidad base
            // Paso 2: entradas (hasta 5 por producto)
            entradas: ['','','','',''],
            // Paso 3: ventas directas / merma
            ventasCopasDirectas: 0, ventasBotella: 0, mermaBase: 0,
        };
    });
    // Conservar historia con cantidades/movimientos; no revivir una ficha que
    // salió del catálogo/área y solo arrastra «registrado» con todas las cifras a cero.
    // No se empata por nombre: dos productos distintos pueden llamarse igual.
    (invActual && invActual.filas || []).forEach(function(sf){
        if (!sf || !sf.insumoId) return;
        var cid = _canonInsumoId(sf.insumoId) || sf.insumoId;
        if (filasCaptura.some(function(f){ return (_canonInsumoId(f.insumoId) || f.insumoId) === cid; })) return;
        var elegida = _filaGuardadaDe(cid) || sf;
        if (!_filaHistoricaNecesaria(elegida, _movQR)) return;
        filasCaptura.push(Object.assign({}, elegida, { entradas:elegida.entradas || ['','','','',''] }));
    });
    // Si se retiraron aliases o filas obsoletas, conservar el original dentro
    // del documento. Se persiste únicamente con el guardado normal, una vez.
    // Permite revisar un inventario ya dañado sin borrar su evidencia anterior.
    if (invActual && !invActual.respaldoIdentidad && (_filasUnicasInventario(invActual.filas).length < (invActual.filas || []).length || (invActual.filas || []).some(function(f){
        return f && !filasCaptura.some(function(actual){ return actual.insumoId === f.insumoId; });
    }))) {
        invActual.respaldoIdentidad = { version:1, fecha:new Date().toISOString(), filas:JSON.parse(JSON.stringify(invActual.filas)) };
    }
}

// ═══════════════════════════════════════════════════════════════
// WIZARD — navegación
// ═══════════════════════════════════════════════════════════════
const PASO_LABELS = ['','Existencias','Entradas','Ventas','Cancelaciones','Resumen de Resultado'];

function irAPaso(n) {
    /* El paso 5 es el Resultado: variancias, mermas y el reporte ejecutivo. Se
       pide el mismo permiso que a los reportes de fuera — sería raro cerrarle la
       puerta de la calle y dejarle la de atrás abierta. */
    if (n === 5 && typeof _exigeInv === 'function' &&
        !_exigeInv('reporte', 'No puedes ver el Resultado del inventario.')) return;
    pasoActual = n;
    if (n === 2) { try { _importarEntradasQR(); } catch(e) {} } // al entrar a Entradas, jala lo del QR
    actualizarStepBar();
    actualizarNavBtns();
    renderStepContent();
    _ajustarStickyInv();   // el Paso 5 no pasa por el ajuste del final de renderStepContent
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function pasoSiguiente() { if (pasoActual < 5) irAPaso(pasoActual+1); }
function pasoAnterior()  { if (pasoActual > 1) irAPaso(pasoActual-1); }

function actualizarStepBar() {
    document.getElementById('stepLabel').textContent = `Paso ${pasoActual} — ${PASO_LABELS[pasoActual]}`;
    _pintarPasoMenu();
    document.querySelectorAll('#invSteps .inv-step').forEach(el => {
        const n = parseInt(el.dataset.step);
        el.classList.toggle('active', n === pasoActual);
        el.classList.toggle('done',   n < pasoActual);
    });
}

function actualizarNavBtns() {
    const esLev  = invActual && invActual.tipoInv === 'primer_lev';
    const btnLev = document.getElementById('btnFinalizarLev');
    const btnFin = document.getElementById('btnFinalizarInv');
    const steps  = document.getElementById('invSteps');
    const cerr   = !!(invActual && invActual.cerrado);

    if (esLev) {
        if (btnFin) btnFin.style.display = 'none'; // primer_lev usa su propio botón
        if (btnLev) { btnLev.style.display = 'inline-flex'; btnLev.disabled = cerr; btnLev.innerHTML = _icInv('aut-autorizado') + (cerr ? 'Guardado' : 'Guardar levantamiento'); }
        if (steps)  steps.style.display = 'none';
        _pintarPasoMenu();
        const lbl = document.getElementById('stepLabel');
        if (lbl) lbl.textContent = 'Primer Levantamiento — Captura de existencias';
    } else {
        if (btnLev) btnLev.style.display = 'none';
        if (btnFin) { btnFin.style.display = 'inline-flex'; btnFin.disabled = cerr; btnFin.innerHTML = _icInv('aut-autorizado') + (cerr ? 'Cerrado' : 'Finalizar inventario'); }
        _iconosEncabezadoInv();
        if (steps)  steps.style.display = '';
        /* Sin «← Anterior» ni «Siguiente →» (Edwin, 19-nov): el botón de los
           pasos («③ Ventas ▾») ya lleva a cualquiera de los cinco. */
    }
    // Acciones del Resultado (Recalcular / reportes): fijas en el header, solo en el Paso 5.
    var s5b = document.getElementById('step5HeaderBtns');
    /* `contents`: sus botones fluyen con los demás del encabezado en vez de
       formar un bloque aparte que se iba a su propio renglón. */
    if (s5b) s5b.style.display = (!esLev && pasoActual === 5) ? 'contents' : 'none';
    /* En el Resultado el buscador y los filtros suben al renglón de «Desglose
       · Salir · Finalizar», que tenía todo el lado izquierdo vacío. */
    var hdr = document.querySelector('#vistaCaptura .inv-wizard-header');
    if (hdr) { hdr.classList.toggle('hdr-p5', !esLev && pasoActual === 5); _hdrP5Medir(hdr); }
    if (typeof _ajustarStickyInv === 'function') setTimeout(_ajustarStickyInv, 0); // el header pudo crecer/encoger
}
/* Solo si CABE: buscador + filtros + Desglose + Salir + Finalizar piden ~1180
   px. Con la barra lateral abierta (o una pantalla más angosta) no caben, el
   buscador se partía en dos y el encabezado crecía a cuatro renglones; ahí la
   barra se queda en su propio renglón, como en los demás pasos. Se mide el
   encabezado mismo (ResizeObserver): abrir o cerrar la barra lateral lo cambia
   sin pasar por aquí. */
var _HDR_P5_ANCHO = 1216;
function _hdrP5Medir(hdr) {
    if (!hdr) return;
    hdr.classList.toggle('hdr-ancho', hdr.clientWidth >= _HDR_P5_ANCHO);
    if (!hdr._roP5 && typeof ResizeObserver === 'function') {
        hdr._roP5 = new ResizeObserver(function () { hdr.classList.toggle('hdr-ancho', hdr.clientWidth >= _HDR_P5_ANCHO); });
        hdr._roP5.observe(hdr);
    }
}
// Finalizar el inventario actual desde el wizard (cierra: ABIERTO → CERRADO).
function finalizarInventarioActual() {
    if (typeof _exigeInv === 'function' && !_exigeInv('cerrar', 'No puedes cerrar inventarios.')) return;
    if (!invActual) return;
    if (invActual.cerrado) { alert('Este inventario ya está cerrado.'); return; }
    if (invActual.tipoInv === 'primer_lev') { finalizarPrimerLev(); return; }
    cerrarInventario();
}

function renderStepContent() {
    const cont = document.getElementById('stepContent');
    if (!cont) return;
    _pintarHerrPaso();   // buscador y filtros del paso, fijos en el encabezado
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
        /* ══ «SI ACTUALIZO EL DATO NO SE REFRESCA NINGÚN CAMBIO» ═══════════
           Era esto. El resumen se guardaba renderizado y, al volver, se
           enseñaba TAL CUAL aunque los datos hubieran cambiado: lo único que
           avisaba era una línea de 11px —«⚠️ Los datos cambiaron»— perdida en
           un encabezado con ocho botones, y había que acordarse de picar 🔄.

           Quien captura tres batches y se va al Resultado a ver qué pasó no
           está navegando: está comprobando lo que acaba de hacer. Que le
           enseñen el número viejo sin que se note es peor que esperar.

           La caché se queda —para eso se hizo, el resumen es lento con 200+
           insumos— pero solo para lo que de verdad resuelve: volver al paso 5
           SIN haber tocado nada. Si algo cambió, se recalcula. */
        if (_keep5 && _keep5.dataset.inv === _invId && _keep5.innerHTML &&
            !window._step5Force && !window._step5Dirty) {
            _keep5.style.display = '';
            _marcarStep5Stale(false);
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
    if (paso === 2 && vistaEntradas2 === 'busqueda') { initEntradaRapidaUI(); renderChipsEntrada(); }
    if (paso === 1) initExistBusquedaUI();
    if (paso === 3 && vistaVentas === 'busqueda') initVentasBusquedaUI();
    if (paso === 3 && (vistaVentas === 'menu' || vistaVentas === 'prebatch') && _menuBusquedaVentas) _filtrarMenuVentas(_menuBusquedaVentas);
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
        /* Con la interfaz nueva la barra de contexto es más alta que esos 96 px
           (la tarjeta de la sucursal): el encabezado del inventario se pegaba
           DEBAJO de ella y quedaba tapado más de la mitad. Se mide la barra de
           verdad y el encabezado se pega justo donde ella termina. */
        var _bar = document.getElementById('ctxBar');
        if (_bar && _bar.getClientRects().length) {
            var _pos = getComputedStyle(_bar).position;
            if (_pos === 'fixed' || _pos === 'sticky') base = Math.max(base, Math.round(_bar.getBoundingClientRect().bottom));
        }
        // Header y pasos de la VISTA visible (captura o entradas).
        var vistas = ['vistaCaptura', 'vistaEntradas'];
        vistas.forEach(function(vid){
            var v = document.getElementById(vid);
            if (!v || v.style.display === 'none') return;
            var hdr = v.querySelector('.inv-wizard-header');
            var steps = v.querySelector('.inv-steps');
            /* Con la barra de contexto alta, fijar TAMBIÉN el encabezado (que en el
               Paso 5 ocupa dos líneas de botones) dejaba 420 px tapados en una
               tablet de 800: media pantalla. Ahí el encabezado se va con la página
               y solo se queda fija la barra de pasos. */
            /* El encabezado queda FIJO en todos los pasos, justo debajo de la barra
               de contexto. Ya no hay barra de pasos (vive en el botón «Paso» del
               encabezado) ni modo compacto: nada aparece ni desaparece al bajar. */
            if (hdr) { hdr.style.position = ''; hdr.style.top = base + 'px'; hdr.style.marginBottom = ''; hdr.classList.remove('inv-hdr-compacto'); }
            var hH = hdr ? hdr.offsetHeight : 0;
            var topSteps = base + hH;
            if (steps) steps.style.top = topSteps + 'px';
            var sH = (steps && steps.offsetParent) ? steps.offsetHeight : 0;
            var topTool = topSteps + sH;
            v.querySelectorAll('.step-toolbar').forEach(function(tb){ tb.style.top = topTool + 'px'; });
        });
    } catch(e) {}
}
window.addEventListener('resize', function(){ if (typeof _ajustarStickyInv === 'function') _ajustarStickyInv(); });

/* ══ LOS PASOS, EN UN BOTÓN DEL ENCABEZADO ═════════════════════════════════
   «③ Ventas ▾» dice en qué paso estás y despliega los cinco. Sustituye a la
   barra de pasos, que se comía un renglón fijo entero. */
const PASO_CORTO = ['', 'Existencias', 'Entradas', 'Ventas', 'Cancelaciones', 'Resultado'];
function _pintarPasoMenu() {
    var esLev = invActual && invActual.tipoInv === 'primer_lev';
    var w = document.getElementById('pasoMenuWrap'); if (w) w.style.display = esLev ? 'none' : '';
    var n = document.getElementById('pasoMenuNum'), t = document.getElementById('pasoMenuTxt');
    if (n) n.textContent = pasoActual;
    if (t) t.textContent = PASO_CORTO[pasoActual] || '';
    var pop = document.getElementById('pasoMenuPop');
    if (pop && !pop.hidden) pop.innerHTML = _pasoMenuItemsHTML();
}
function _pasoMenuItemsHTML() {
    var h = '';
    for (var k = 1; k <= 5; k++) {
        var cls = k === pasoActual ? 'actual' : (k < pasoActual ? 'hecho' : '');
        h += '<button role="menuitem" class="' + cls + '" onclick="_irPasoMenu(' + k + ')">' +
             '<span class="n">' + (k < pasoActual ? '✓' : k) + '</span>' + PASO_CORTO[k] +
             (k === pasoActual ? '<small>estás aquí</small>' : '') + '</button>';
    }
    return h;
}
function _cerrarPasoMenu() {
    var pop = document.getElementById('pasoMenuPop'); if (pop) pop.hidden = true;
    var b = document.getElementById('btnPasoMenu'); if (b) b.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', _cerrarPasoMenu, true);
}
function _togglePasoMenu(ev) {
    if (ev) ev.stopPropagation();
    var pop = document.getElementById('pasoMenuPop'); if (!pop) return;
    if (!pop.hidden) { _cerrarPasoMenu(); return; }
    pop.innerHTML = _pasoMenuItemsHTML();
    pop.hidden = false;
    var b = document.getElementById('btnPasoMenu'); if (b) b.setAttribute('aria-expanded', 'true');
    setTimeout(function () {
        document.addEventListener('click', function cerrar(e) {
            if (pop.contains(e.target)) return;
            document.removeEventListener('click', cerrar, true);
            _cerrarPasoMenu();
        }, true);
    }, 0);
}
function _irPasoMenu(n) { _cerrarPasoMenu(); if (n !== pasoActual) irAPaso(n); }
window._togglePasoMenu = _togglePasoMenu; window._irPasoMenu = _irPasoMenu;

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

/* ══ ÍCONOS DE LA APP EN VEZ DE EMOJIS (Edwin, 19-nov) ════════════════════
   Los emojis se ven distinto en cada teléfono y no son del estilo de la app.
   Aquí se piden los mismos SVG del resto de ETAAX (etaax-iconos.js). Si el
   archivo de iconos todavía no cargó, no se pinta nada (el texto basta). */
function _icInv(nombre, tam) {
    return (typeof window.etaaxIcono === 'function') ? window.etaaxIcono(nombre, { tam: tam || 16, clase: 'inv-ic' }) : '';
}
/* Los botones fijos del encabezado (vienen en el HTML con emoji). */
var _ICONOS_HDR = [['btnInfoGeneral', 'sto-detalle', 'Info general'], ['btnPreviewActual', 'fin-estadisticas', 'Existencias'],
    ['btnRecalc5', 'mov-movimientos', 'Recalcular'], ['btnRepGerencial', 'aut-candado', 'Reporte gerencial'],
    ['btnRepDirectivo', 'adm-comprobante', 'Reporte directivo'], ['btnRepDesglose', 'cor-desglose', 'Desglose por insumo'],
    ['btnGuardarInv', 'cerrar-sesion', 'Salir'],
    // La portada (antes con 📊 🧩 📱 📋 📋 📅 ≡ ⊞):
    ['btnReporteExistencias', 'fin-estadisticas', 'Reporte de existencias'], ['btnCompuestos', 'rec-sub-bebidas', 'Compuestos'],
    ['btnRevisarEntradas', 'adm-comprobante', 'Revisar entradas'],
    ['btnPrimerLev', 'ins-catalogo', 'Primer levantamiento'],
    ['statFiltroTodos', 'ins-lista', 'Todos', 26], ['statFiltroMes', 'adm-calendario', 'Mes / Año', 26],
    ['btnHistLista', 'ins-lista', 'Lista', 14], ['btnHistGal', 'ins-galeria', 'Galería', 14]];
function _iconosEncabezadoInv() {
    if (typeof window.etaaxIcono !== 'function') return;
    _ICONOS_HDR.forEach(function (x) { var b = document.getElementById(x[0]); if (b && !b.querySelector('.inv-ic')) b.innerHTML = _icInv(x[1], x[3]) + x[2]; });
}
document.addEventListener('DOMContentLoaded', function () { try { _iconosEncabezadoInv(); } catch (e) {} });

/* ══ LA BARRA DEL PASO, FIJA EN EL ENCABEZADO (Edwin, 19-nov) ═════════════
   Cada paso tenía su buscador y sus filtros dentro del contenido, y al bajar
   se iban. Ahora viven en una franja del encabezado fijo y cambian con el paso
   y la vista. Los manejadores son los de siempre (solo repintan la lista, no
   el buscador), así que escribir no pierde el foco; y la franja solo se vuelve
   a pintar cuando cambia algo más que lo tecleado. */
function _herrSeg(pares, activo, fn) {
    return '<div class="ph-seg">' + pares.map(function (p) {
        return '<button class="' + (p[0] === activo ? 'on' : '') + '" onclick="' + fn + '(\'' + p[0] + '\')">' + p[1] + '</button>';
    }).join('') + '</div>';
}
function _herrBuscar(id, val, ph, fn) {
    return '<input type="search" class="ph-buscar" id="' + id + '" value="' + etx(val || '') + '" placeholder="' + etx(ph) +
        '" oninput="' + fn + '(this.value)" autocomplete="off">';
}
/* A la izquierda, fijos: el buscador y luego los botones de vista. A la
   derecha, solo cuando los hay: los filtros. */
function _herrLados(izq, der) {
    return '<div class="ph-izq">' + izq + '</div>' + (der ? '<div class="ph-der">' + der + '</div>' : '');
}
// Familia/categoría/subcategoría (+ Lista/Galería) de las listas de captura.
function _herrSelectsCapt(conModo) {
    return _herrFiltrosCapt(conModo).replace(/^<input[^>]*>/, '');
}
function _herrBuscarCapt() { return _herrBuscar('phBuscar', busquedaCapt, 'Buscar…', 'onBusqueda'); }
function _herrVistaToggle() {
    return `<div class="vista-toggle" title="Ver en lista o en iconos">
        <button class="${modoListaCapt==='lista'?'active':''}" onclick="setModoCaptura('lista')" title="Lista">${_icInv('ins-lista', 14)}Lista</button>
        <button class="${modoListaCapt==='galeria'?'active':''}" onclick="setModoCaptura('galeria')" title="Galería">${_icInv('ins-galeria', 14)}Galería</button>
    </div>`;
}
// Buscador + familia/categoría/subcategoría (+ Lista/Galería) de las listas de captura.
function _herrFiltrosCapt(conModo) {
    const pool = filasCaptura
        .filter(f => !filtroFamActivo || f.familia === filtroFamActivo)
        .filter(f => !filtroCatActiva || f.categoria === filtroCatActiva);
    const fams    = [...new Set(filasCaptura.map(f=>f.familia).filter(Boolean))].sort();
    const cats    = [...new Set(filasCaptura.map(f=>f.categoria).filter(Boolean))].sort();
    const subcats = [...new Set(pool.map(f=>f.subcategoria).filter(Boolean))].sort();
    return _herrBuscar('phBuscar', busquedaCapt, 'Buscar…', 'onBusqueda') + `
        <select class="filtro-select" id="filtroFamStep" onchange="onFiltroFam(this.value)">
            <option value="">Todas las familias</option>
            ${fams.map(f=>`<option value="${etx(f)}" ${filtroFamActivo===f?'selected':''}>${etx(f)}</option>`).join('')}
        </select>
        <select class="filtro-select" id="filtroCatStep" onchange="onFiltroCat(this.value)">
            <option value="">Todas las categorías</option>
            ${cats.map(c=>`<option value="${etx(c)}" ${filtroCatActiva===c?'selected':''}>${etx(c)}</option>`).join('')}
        </select>
        ${subcats.length ? `<select class="filtro-select" id="filtroSubcatStep" onchange="onFiltroSubcat(this.value)">
            <option value="">Todas las sub.</option>
            ${subcats.map(x=>`<option value="${etx(x)}" ${filtroSubcatActiva===x?'selected':''}>${etx(x)}</option>`).join('')}
        </select>` : ''}
        ${conModo ? `<div class="vista-toggle" title="Ver en lista o en galería">
            <button class="${modoListaCapt==='lista'?'active':''}" onclick="setModoCaptura('lista')" title="Lista">${_icInv('ins-lista', 14)}Lista</button>
            <button class="${modoListaCapt==='galeria'?'active':''}" onclick="setModoCaptura('galeria')" title="Galería">${_icInv('ins-galeria', 14)}Galería</button>
        </div>` : ''}`;
}
function _herrPasoHTML() {
    if (!invActual) return '';
    const paso = invActual.tipoInv === 'primer_lev' ? 1 : pasoActual;
    if (paso === 1) {
        /* Una sola vista (pendientes | registrados): el buscador filtra las dos,
           los contadores se quedan y se elige verlo en lista o en iconos. */
        const nReg = filasCaptura.filter(_esRegistrado).length, nPend = filasCaptura.length - nReg;
        return _herrLados(_herrBuscar('existBuscador', _existBusqueda, 'Buscar producto…', 'buscarInsumoExist') +
            '<div class="ph-ind"><span>' + _icInv('adm-pendiente', 14) + 'Pendientes <span class="ph-n">' + nPend + '</span></span>' +
            '<span>' + _icInv('adm-pagado', 14) + 'Registrados <span class="ph-n">' + nReg + '</span></span></div>', _herrVistaToggle());
    }
    if (paso === 2) {
        /* «Rápida / Lista» se van (Edwin, 19-nov): la tabla de «Lista» ya no
           servía. Es una sola vista en dos columnas que se ve en LISTA o en
           CUADRÍCULA, con el mismo botón del Paso 1. */
        vistaEntradas2 = 'busqueda';
        return _entHerrHTML(true);   // la MISMA barra que el registro de afuera
    }
    if (paso === 3) {
        const nPb = prebatchesProducibles().length;
        /* «Búsqueda rápida» va primero, junto al buscador, y es la vista con la
           que abre Ventas (Edwin, 19-nov). */
        const vistas = _herrSeg([['busqueda', _icInv('adm-buscar', 14) + 'Búsqueda rápida'], ['lista', _icInv('cat-insumos', 14) + 'Insumos'],
            ['menu', _icInv('cor-bebidas', 14) + 'Cocteles'],
            ['prebatch', _icInv('rec-sub-bebidas', 14) + 'Prebatch' + (nPb ? ' <span class="ph-n">' + nPb + '</span>' : '')]], vistaVentas, 'setVistaVentas');
        if (vistaVentas === 'lista')    return _herrLados(_herrBuscarCapt() + vistas, _herrSelectsCapt(false));
        if (vistaVentas === 'menu')     return _herrLados(_herrBuscar('phBuscar', _menuBusquedaVentas, 'Buscar coctel o receta…', '_filtrarMenuVentas') + vistas, '');
        if (vistaVentas === 'prebatch') return _herrLados(_herrBuscar('phBuscar', _menuBusquedaVentas, 'Buscar prebatch…', '_filtrarMenuVentas') + vistas, '');
        return _herrLados(_herrBuscar('ventasBuscador', _ventasBusqueda, 'Buscar insumo, coctel o prebatch…', 'buscarInsumoVentas') + vistas, '');
    }
    if (paso === 4) {
        const c = (invActual.cancelaciones || []).length, d = invActual.descuentos || [];
        const td = d.reduce((t, x) => t + (parseFloat(x.monto) || 0), 0);
        return _herrLados(_herrSeg([['cancelaciones', '🚫 Cancelaciones <span class="ph-n">' + c + '</span>'],
                         ['descuentos', '💸 Descuentos' + (d.length ? ' <span class="ph-n">$' + td.toFixed(0) + '</span>' : '')]], _paso4Tab, 'setPaso4Tab'), '');
    }
    if (paso === 5) {
        const subs = [...new Set(filasCaptura.map(f => f.subcategoria || f.categoria).filter(Boolean))].sort();
        return _herrLados(_herrBuscar('phBuscar', _busqStep5, 'Buscar producto…', 'onBusqStep5'), `
            <select class="filtro-select" onchange="setSubcatStep5(this.value)">
                <option value="">Todas las categorías</option>
                ${subs.map(x => `<option value="${etx(x)}" ${_subcatStep5===x?'selected':''}>${etx(x)}</option>`).join('')}
            </select>
            <select class="filtro-select" onchange="setDifStep5(this.value)" title="Deja en la pantalla solo lo que faltó o solo lo que sobró">
                <option value="" ${_difStep5===''?'selected':''}>Faltantes y sobrantes</option>
                <option value="falta" ${_difStep5==='falta'?'selected':''}>Solo faltantes</option>
                <option value="sobra" ${_difStep5==='sobra'?'selected':''}>Solo sobrantes</option>
            </select>
            <button class="btn-vista" onclick="abrirImprimirS5()" title="Imprimir lo filtrado: exactamente lo que está en pantalla, eligiendo qué grupos van en la hoja">${_icInv('adm-imprimir')}Imprimir</button>
            <div class="vista-toggle">
                <button id="s5ModoLista" class="${_step5Modo==='lista'?'active':''}" onclick="setStep5Modo('lista')">${_icInv('ins-lista', 14)}Lista</button>
                <button id="s5ModoGal" class="${_step5Modo==='galeria'?'active':''}" onclick="setStep5Modo('galeria')">${_icInv('ins-galeria', 14)}Galería</button>
            </div>`);
    }
    return '';
}
var _herrUltimo = null;
function _pintarHerrPaso() {
    var el = document.getElementById('pasoHerr'); if (!el) return;
    var html = '';
    try { html = _herrPasoHTML(); } catch (e) { console.warn('[inv] barra del paso:', e); }
    /* Lo tecleado no cuenta: si solo cambió eso, la franja NO se repinta y el
       campo conserva el foco y el cursor. */
    var llave = html.replace(/ value="[^"]*"/g, '');
    if (llave === _herrUltimo) return;
    var act = document.activeElement, fid = (act && el.contains(act) && act.id) ? act.id : '', s0 = null, s1 = null;
    if (fid) { try { s0 = act.selectionStart; s1 = act.selectionEnd; } catch (e) {} }
    el.innerHTML = html; _herrUltimo = llave;
    if (fid) { var n = document.getElementById(fid); if (n) { n.focus(); try { if (s0 !== null) n.setSelectionRange(s0, s1); } catch (e) {} } }
    if (typeof _ajustarStickyInv === 'function') _ajustarStickyInv();
}
// Fuera del wizard la franja se vacía: el registro de entradas usa los mismos ids.
function _vaciarHerrPaso() { var el = document.getElementById('pasoHerr'); if (el) el.innerHTML = ''; _herrUltimo = null; }

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
            <button class="${modoListaCapt==='lista'?'active':''}" onclick="setModoCaptura('lista')">${_icInv('ins-lista', 14)}Lista</button>
            <button class="${modoListaCapt==='galeria'?'active':''}" onclick="setModoCaptura('galeria')">${_icInv('ins-galeria', 14)}Galería</button>
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
        elML.innerHTML = _liquidoAbiertoHTML(fila);
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
function updPeso(idx, pi, val)       { var f = filasCaptura[idx]; f.pesos = _pesosDe(f); f.pesos[pi] = val; refreshFilaDisplay(idx); _autoGuardar(); }

// ═══════════════════════════════════════════════════════════════
// PASO 1 — Existencias físicas
// ═══════════════════════════════════════════════════════════════
function buildVistaSwitcherExist() {
    return `<div class="exist-vista-switcher">
        <button class="exist-vista-btn ${vistaCapturaExist==='busqueda'?'active':''}"
            onclick="setVistaExist('busqueda')">🔍 Búsqueda rápida</button>
        <button class="exist-vista-btn ${vistaCapturaExist==='lista'?'active':''}"
            onclick="setVistaExist('lista')">${_icInv('ins-lista', 14)}Lista completa</button>
    </div>`;
}

function setVistaExist(modo) {
    vistaCapturaExist = modo;
    if (modo !== 'busqueda') { _existBusqueda = ''; _existInsumoId = null; }
    renderStepContent();
}

// Aviso: cuántos insumos no aparecen por no tener área (o ser de otra área).
// Guía al usuario a asignarles su área en el catálogo para incluirlos.
/* Mientras llega el catálogo de la nube, la lista sale de la copia de este
   dispositivo y puede crecer en unos segundos. Se dice, en vez de que la
   lista cambie sola sin explicación. El contenedor siempre está, para poder
   quitar el aviso sin repintar el paso. */
function _avisoCatalogoHTML() {
    var cargando = !_INV_CARGADO || !!_refrescandoInv;
    return '<div id="avisoCatInv">' + (cargando ? _avisoCatalogoTexto() : '') + '</div>';
}
function _avisoCatalogoTexto() {
    return '<div class="wrap" style="padding-top:0"><div style="padding:8px 14px;border:1px solid var(--border);' +
        'border-left:3px solid #7ab8f5;border-radius:8px;background:var(--surface);font-size:12.5px;color:var(--text-dim)">' +
        _icInv('sto-reloj', 14) + 'Actualizando el catálogo desde la nube: la lista puede crecer en unos segundos.</div></div>';
}
function _quitarAvisoCatalogo() { var el = document.getElementById('avisoCatInv'); if (el) el.innerHTML = ''; }
function _avisoAreaHTML() {
    var invA = ((invActual && invActual.area) || '').toString().trim().toLowerCase();
    var scope = _scopeSucInsumos(getInsumos());
    var sinArea = 0, otraArea = 0;
    scope.forEach(function(x){
        var a = (x && x.area || '').toString().trim().toLowerCase();
        if (!a) sinArea++;
        else if (invA && invA !== 'general' && !_insumoEnAreaInv(x)) otraArea++;   // la MISMA regla que decide quién entra
    });
    if (!sinArea && !otraArea) return '';
    var parts = [];
    if (sinArea)  parts.push('<b style="color:var(--text)">'+sinArea+'</b> sin área');
    if (otraArea) parts.push('<b style="color:var(--text)">'+otraArea+'</b> de otra área');
    return '<div class="wrap" style="padding-top:0"><div style="padding:10px 14px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:8px;background:var(--surface);font-size:12.5px;color:var(--text-dim);line-height:1.5">'+
        _icInv('ins-zona', 14)+parts.join(' · ')+' no aparecen en este inventario de <b style="color:var(--text)">'+etx(invA||'—')+'</b>. Asígnales su área en el <b>Catálogo de insumos</b> (campo «Área — dónde se guarda») para incluirlas aquí.</div></div>';
}

/* ══ EL PASO 1 EN DOS COLUMNAS (Edwin, 19-nov) ══════════════════════════
   Ya no hay «Búsqueda rápida» ni «Lista completa»: una sola vista con los
   PENDIENTES a la izquierda y los REGISTRADOS a la derecha —en lista o en
   iconos—, y el buscador filtra las dos. Al tocar un insumo se abre su captura
   en un modal; «Registrado — Siguiente» pasa al siguiente pendiente. */
function renderStep1() {
    vistaCapturaExist = 'busqueda';
    return _avisoCatalogoHTML() + _avisoAreaHTML() + bannerConteosQR() + `
        <div class="p12-split">
            <section class="p12-col">
                <div class="p12-cab"><span>${_icInv('adm-pendiente', 14)}Pendientes</span><b id="p1NPend"></b></div>
                <div id="p1Pend"></div>
            </section>
            <section class="p12-col">
                <div class="p12-cab"><span>${_icInv('adm-pagado', 14)}Registrados</span><b id="p1NReg"></b></div>
                <div id="p1Reg"></div>
            </section>
        </div>
        <div id="p1Modal" class="p12-modal" style="display:none" onclick="if(event.target===this)_cerrarModalExist()">
            <div class="p12-modal-caja"><div id="existCardWrap"></div></div>
        </div>`;
}
/* Un insumo en la lista (o en iconos): lo que hace falta para reconocerlo y,
   si ya se contó, cuánto. */
function _p1ItemHTML(f, reg) {
    const u = f.tipo === 'peso' ? (f.baseUnit || 'g').toLowerCase() : (f.tipo === 'pza' ? 'pza' : 'bot');
    const ea = parseFloat(f.existenciaAnterior) || 0, cb = f.contNeto > 0 && f.copaML > 0 ? f.contNeto / f.copaML : 0;
    const eaB = f.tipo === 'pza' || f.tipo === 'peso' ? ea : (cb > 0 ? ea / cb : ea);
    const met = (f.metodoCaptura || 'peso'), metIc = _icInv(met === 'nivel' ? 'ins-contenido' : met === 'foto' ? 'ins-foto' : 'ins-peso', 14);
    const dato = reg ? '<b class="p12-ok">' + metIc + fmtBot(calcExistenciaBot(f)) + ' ' + u + '</b>'
                     : '<span class="p12-ant">Anterior ' + fmtBot(Math.round(eaB * 100) / 100) + ' ' + u + '</span>';
    const meta = insumoMeta(f) ? insumoMetaHTML(f) : (f.categoria ? etx(f.categoria) : '');
    return `<button class="p12-item ${reg ? 'reg' : ''}" onclick="seleccionarProductoExist('${f.insumoId}')">
        <span class="p12-nom">${etx(insumoTitulo(f))}${meta ? `<small>${meta}</small>` : ''}</span>${dato}</button>`;
}
function _p1ListasPintar() {
    const pend = document.getElementById('p1Pend'), reg = document.getElementById('p1Reg');
    if (!pend || !reg) return;
    const q = String(_existBusqueda || '').trim().toLowerCase();
    const pasa = (f) => !q || String(f.nombre || '').toLowerCase().indexOf(q) > -1 || String(insumoTitulo(f) || '').toLowerCase().indexOf(q) > -1;
    const p = filasCaptura.filter(f => !_esRegistrado(f) && pasa(f)), r = filasCaptura.filter(f => _esRegistrado(f) && pasa(f));
    const cls = 'p12-lista' + (modoListaCapt === 'galeria' ? ' p12-iconos' : '');
    const vacio = (t) => `<div class="p12-vacio">${t}</div>`;
    pend.className = cls; reg.className = cls;
    pend.innerHTML = p.length ? p.map(f => _p1ItemHTML(f, false)).join('') : vacio(q ? 'Sin pendientes con «' + etx(_existBusqueda) + '»' : _icInv('adm-pagado', 16) + '¡Ya se contó todo!');
    reg.innerHTML = r.length ? r.map(f => _p1ItemHTML(f, true)).join('') : vacio(q ? 'Sin registrados con «' + etx(_existBusqueda) + '»' : 'Aún no hay existencias registradas');
    const np = document.getElementById('p1NPend'), nr = document.getElementById('p1NReg');
    if (np) np.textContent = p.length + (q ? ' de ' + filasCaptura.filter(f => !_esRegistrado(f)).length : '');
    if (nr) nr.textContent = r.length + (q ? ' de ' + filasCaptura.filter(_esRegistrado).length : '');
}
function _abrirModalExist() {
    const m = document.getElementById('p1Modal');
    if (!m) return;
    m.style.display = _existInsumoId ? 'flex' : 'none';
    renderCardExist();
}
/* Cerrar NO marca como registrado: es «todavía no». (La ✕ de la tarjeta lo
   marcaba, que en un modal es una sorpresa.) */
function _cerrarModalExist() {
    _existInsumoId = null;
    const m = document.getElementById('p1Modal'); if (m) m.style.display = 'none';
    const c = document.getElementById('existCardWrap'); if (c) c.innerHTML = '';
    _p1ListasPintar();
}
window._cerrarModalExist = _cerrarModalExist;

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
    _p1ListasPintar();      // filtra pendientes Y registrados
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
    if (document.getElementById('p1Modal')) { _abrirModalExist(); return; }
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
    var actual = _existInsumoId, siguiente = null;
    if (actual) {
        const fila = filasCaptura.find(f => f.insumoId === actual);
        if (fila) { fila.registrado = true; _autoGuardar(); }
        /* «Registrado — Siguiente»: el siguiente PENDIENTE de la lista de la
           izquierda (con el mismo filtro del buscador), para contar de corrido. */
        const q = String(_existBusqueda || '').trim().toLowerCase();
        const pend = filasCaptura.filter(f => !_esRegistrado(f) && (!q || String(f.nombre || '').toLowerCase().indexOf(q) > -1));
        const i = filasCaptura.findIndex(f => f.insumoId === actual);
        const despues = pend.find(f => filasCaptura.indexOf(f) > i) || pend[0];
        siguiente = despues ? despues.insumoId : null;
    }
    _existInsumoId = null;
    // Re-render completo para actualizar contadores y filtros
    renderStepContent();
    if (siguiente && document.getElementById('p1Modal')) { _existInsumoId = siguiente; _abrirModalExist(); return; }
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
                        ${_liquidoAbiertoHTML(fila)}</span>
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
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Botellas abiertas — peso con cristal (kg) · una botella por casilla</div>
        <div class="inv-pesos-row" id="pesos-${idx}" style="flex-wrap:wrap">
            ${_pesosDe(fila).map((p,pi) => _pesoCeldaHTML(idx, pi, p)).join('')}
            <button type="button" class="inv-peso-add" onclick="_pesoAgregar(${idx}, true)" title="Agregar otra botella abierta">+ Agregar botella</button>
        </div>
        <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:var(--text-dim)">Neto líquido</span>
            <span id="ml-${idx}" style="font-size:15px;font-weight:700;color:${lts>0?'var(--green)':'var(--text-dim)'}">
                ${_liquidoAbiertoHTML(fila)}</span>
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
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">${_icInv('rec-ficha', 14)}Ver</button>
                    <button onclick="_cerrarModalExist()" title="Cerrar sin marcar como registrado"
                        style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:20px;padding:0;line-height:1">✕</button>
                </div>
            </div>

            ${chipConteoQR(fila, idx)}
            <!-- Método de captura -->
            <div style="margin-bottom:16px">
                <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;font-weight:500">Método de captura</div>
                <div class="ent-tipo-row">
                    <button class="ent-tipo-btn ${metodo==='peso'?'active':''}" onclick="setMetodoCapturaExist('${fila.insumoId}','peso')">${_icInv('ins-peso')}Peso</button>
                    <button class="ent-tipo-btn ${metodo==='nivel'?'active':''}" onclick="setMetodoCapturaExist('${fila.insumoId}','nivel')">${_icInv('ins-contenido')}Nivel</button>
                    <button class="ent-tipo-btn ${metodo==='foto'?'active':''}" onclick="setMetodoCapturaExist('${fila.insumoId}','foto')">${_icInv('ins-foto')}Foto</button>
                </div>
            </div>

            <!-- Copiar existencia anterior -->
            ${_btnCopiarAnterior(idx, fila)}

            <!-- Botellas cerradas -->
            ${selectorEmpaque(fila, idx)}
            <div style="display:flex;gap:12px;margin-bottom:16px">
                <div style="flex:1">
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Cerradas Bodega${_sufEmpaque(fila)}</div>
                    <div class="calc-celda">
                        <input type="text" inputmode="decimal" class="inv-num-input" id="cb-${idx}" style="width:100%;box-sizing:border-box"
                            value="${etx(_fxDe(fila, 'cerradasBodega') || _cerrMostrar(fila, fila.cerradasBodega))}" placeholder="—"
                            title="Suma y resta como en Excel: 2+3+1, 3*24+5" onkeydown="_celdaKey(event,this)"
                            onblur="updCerradasCalc(${idx},'cerradasBodega',this)">
                        <div class="calc-ops"><button type="button" class="calc-op" onpointerdown="event.preventDefault();_celdaOp('cb-${idx}','+')" title="Sumar">+</button>
                            <button type="button" class="calc-op" onpointerdown="event.preventDefault();_celdaOp('cb-${idx}','-')" title="Restar">−</button></div>
                    </div>
                    <div class="fx-res" id="fxr-${idx}-cerradasBodega">${_fxResHTML(fila, 'cerradasBodega', _cerrMostrar(fila, fila.cerradasBodega))}</div>
                </div>
                <div style="flex:1">
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Cerradas Barra${_sufEmpaque(fila)}</div>
                    <div class="calc-celda">
                        <input type="text" inputmode="decimal" class="inv-num-input" id="cba-${idx}" style="width:100%;box-sizing:border-box"
                            value="${etx(_fxDe(fila, 'cerradasBarra') || _cerrMostrar(fila, fila.cerradasBarra))}" placeholder="—"
                            title="Suma y resta como en Excel: 2+3+1, 3*24+5" onkeydown="_celdaKey(event,this)"
                            onblur="updCerradasCalc(${idx},'cerradasBarra',this)">
                        <div class="calc-ops"><button type="button" class="calc-op" onpointerdown="event.preventDefault();_celdaOp('cba-${idx}','+')" title="Sumar">+</button>
                            <button type="button" class="calc-op" onpointerdown="event.preventDefault();_celdaOp('cba-${idx}','-')" title="Restar">−</button></div>
                    </div>
                    <div class="fx-res" id="fxr-${idx}-cerradasBarra">${_fxResHTML(fila, 'cerradasBarra', _cerrMostrar(fila, fila.cerradasBarra))}</div>
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
/* Contenido de UNA unidad (la lata, la botella, el paquete). OJO: `contNeto`
   siempre viene en unidad BASE (ml para bebidas, g/ml/pza para alimentos) —
   `baseUnit` solo se llena en alimentos. Antes, un refresco (tipo 'pza', sin
   baseUnit) caía al literal 'pza' y se leía "355 pza": la lata trae 355 ML,
   lo que se cuenta por pieza es la lata, no su contenido. */
function _fmtContenido(fila){
    var cn = parseFloat(fila && fila.contNeto) || 0;
    if (cn <= 0) return '';
    if (fila.tipo === 'peso') return _fmtBase(cn) + ' ' + (fila.baseUnit || 'g');
    if (fila.tipo === 'pza' && fila.baseUnit) return _fmtBase(cn) + ' ' + fila.baseUnit;
    return cn >= 1000 ? _fmtBase(cn/1000) + ' L' : _fmtBase(cn) + ' ml';
}
function _cardExistPeso(fila, idx) {
    const u    = (fila.baseUnit || 'G').toLowerCase();
    const ea   = parseFloat(fila.existenciaAnterior) || 0;
    const ent  = getEntradasBottles(fila.insumoId);
    const cons = _consumoRecetasBase(fila.insumoId);
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
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">${_icInv('rec-ficha', 14)}Ver</button>
                    <button onclick="_cerrarModalExist()" title="Cerrar sin marcar como registrado" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:20px;padding:0;line-height:1">✕</button>
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
                    <input type="text" inputmode="decimal" class="inv-num-input" style="width:100%;box-sizing:border-box" value="${fila.existenciaPeso||''}" placeholder="—"
                        title="Puedes escribir operaciones: 1200+340"
                        onblur="updCapturaPesoCalc(${idx},'existenciaPeso',this)" onkeydown="_celdaKey(event,this)">
                </div>
                <div style="flex:1">
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Entradas (${u})</div>
                    <input type="text" inputmode="decimal" class="inv-num-input" style="width:100%;box-sizing:border-box" value="${(fila.entradas&&fila.entradas[0])||''}" placeholder="—"
                        title="Puedes escribir operaciones: 1200+340"
                        onblur="updCapturaPesoCalc(${idx},'entrada0',this)" onkeydown="_celdaKey(event,this)">
                </div>
                <div style="flex:1">
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Merma (${u})</div>
                    <input type="text" inputmode="decimal" class="inv-num-input" style="width:100%;box-sizing:border-box" value="${fila.mermaBase||''}" placeholder="—"
                        title="Puedes escribir operaciones: 1200+340"
                        onblur="updCapturaPesoCalc(${idx},'mermaBase',this)" onkeydown="_celdaKey(event,this)">
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
    const inp = document.getElementById('existBuscador');
    if (inp && inp.value !== (_existBusqueda || '')) inp.value = _existBusqueda || '';
    if (document.getElementById('p1Pend')) { _p1ListasPintar(); if (_existInsumoId) _abrirModalExist(); return; }
    if (_existBusqueda) renderChipsExist();
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
                                ${_liquidoAbiertoHTML(fila)}</span>
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
                        <input type="text" inputmode="decimal" class="inv-peso-input" value="${p||''}" placeholder="kg"
                            title="Puedes escribir operaciones: 0.9+0.75" onkeydown="_celdaKey(event,this)"
                            onblur="updPesoCalc(${idx},${pi},this)">
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
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">${_icInv('rec-ficha', 14)}Ver</button>
                </div>
            </td>
            <td class="inv-td-ant">
                <span class="inv-ant-val">${eaBot % 1 === 0 ? eaBot.toFixed(0) : eaBot.toFixed(1)}</span>
                <span class="inv-ant-unit"> ${eaUnit}</span>
            </td>
            <td class="inv-td-input">
                <input type="text" inputmode="decimal" class="inv-num-input" value="${_cerrMostrar(fila, fila.cerradasBodega)}" placeholder="—"
                    title="${_tipEmpaque(fila)}"
                    onblur="updCerradasCalc(${idx},'cerradasBodega',this)" onkeydown="_celdaKey(event,this)">
                ${_chipEmpaque(fila, idx)}
            </td>
            <td class="inv-td-input">
                <input type="text" inputmode="decimal" class="inv-num-input" value="${_cerrMostrar(fila, fila.cerradasBarra)}" placeholder="—"
                    title="${_tipEmpaque(fila)}"
                    onblur="updCerradasCalc(${idx},'cerradasBarra',this)" onkeydown="_celdaKey(event,this)">
            </td>
            ${inputCell}
            <td class="inv-td-result" ${metodo !== 'peso' ? 'style="display:none"' : ''}>
                <span ${metodo === 'peso' ? `id="ml-${idx}"` : ''} style="color:${lts>0?'var(--green)':'var(--text-dim)'}">
                    ${metodo === 'peso' ? _liquidoAbiertoHTML(fila) : ''}</span></td>
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
                ${selectorEmpaque(fila, idx, true)}
                <div style="display:flex;gap:8px">
                    <div style="flex:1">
                        <div class="inv-gal-label">Bodega${_sufEmpaque(fila)}</div>
                        <input type="text" inputmode="decimal" class="inv-num-input" style="width:100%;box-sizing:border-box"
                            value="${_cerrMostrar(fila, fila.cerradasBodega)}" placeholder="—"
                            title="${_tipEmpaque(fila)}"
                            onblur="updCerradasCalc(${idx},'cerradasBodega',this)" onkeydown="_celdaKey(event,this)">
                    </div>
                    <div style="flex:1">
                        <div class="inv-gal-label">Barra${_sufEmpaque(fila)}</div>
                        <input type="text" inputmode="decimal" class="inv-num-input" style="width:100%;box-sizing:border-box"
                            value="${_cerrMostrar(fila, fila.cerradasBarra)}" placeholder="—"
                            title="${_tipEmpaque(fila)}"
                            onblur="updCerradasCalc(${idx},'cerradasBarra',this)" onkeydown="_celdaKey(event,this)">
                    </div>
                </div>
                <div>
                    <div class="inv-gal-label" style="margin-bottom:6px">Pesos botellas abiertas (g)</div>
                    <div class="inv-pesos-grid">
                        ${(fila.pesos||['','','','']).map((p,pi)=>`
                        <div>
                            <div style="font-size:9px;color:var(--text-dim);text-align:center;margin-bottom:3px">Bot ${pi+1}</div>
                            <input type="text" inputmode="decimal" value="${p||''}" placeholder="kg"
                                title="Puedes escribir operaciones: 0.9+0.75" onkeydown="_celdaKey(event,this)"
                                onblur="updPesoCalc(${idx},${pi},this)">
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
                    ${_liquidoAbiertoHTML(fila)}</span>
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
            onclick="setVistaEntradas2('lista')">${_icInv('ins-lista', 14)}Lista completa</button>
    </div>`;
}

function setVistaEntradas2(v) {
    vistaEntradas2 = v;
    if (v !== 'busqueda') { _entRapidaBusqueda = ''; _entRapidaInsumoId = null; }
    renderStepContent();
}

/* ══ LO QUE ENTRÓ POR EL QR, EN UNA LISTA ══════════════════════════════════
   Las mermas y las cortesías del celular YA se suman en cada insumo —eso
   funciona— pero solo se ven abriendo producto por producto. Con 328 renglones
   eso no es revisar, es buscar. Como historial de movimientos sirve más tener
   la lista corrida: qué salió, cuánto, quién y cuándo.

   Es una VISTA, no un cálculo: los números siguen saliendo de _recomputarMovsQR.
   Si esta lista contara por su cuenta, un día diría algo distinto al inventario
   y no habría forma de saber cuál manda. */
var _movsQRAbierto = false;
function toggleMovsQR() { _movsQRAbierto = !_movsQRAbierto; renderStepContent(); }
window.toggleMovsQR = toggleMovsQR;

function _movsQRDelPeriodo() {
    var suc = _sucActiva();
    return (getEntradasLog() || []).filter(function (e) {
        if (!e || e.borrada) return false;
        if (e.concepto !== 'merma' && e.concepto !== 'salida') return false;
        if (e.sucursalId && suc && e.sucursalId !== suc) return false;
        return _enPeriodoInvActual(e.fecha, e.registrado);
    }).sort(function (a, b) {
        return String(b.registrado || b.fecha || '').localeCompare(String(a.registrado || a.fecha || ''));
    });
}
function _movQRTipo(e) {
    if (e.concepto === 'merma') return { ic: '💔', txt: 'Merma', col: 'var(--red)' };
    return (e.salidaTipo === 'prestamo')
        ? { ic: '🔁', txt: 'Préstamo', col: 'var(--viol)' }
        : { ic: '🎁', txt: 'Cortesía', col: 'var(--accent-text,var(--accent))' };
}
function bannerMovsQR() {
    var movs = _movsQRDelPeriodo();
    if (!movs.length) return '';
    var nM = movs.filter(function (e) { return e.concepto === 'merma'; }).length;
    var nC = movs.length - nM;
    var quienes = {};
    movs.forEach(function (e) { if (e.registradoPor) quienes[e.registradoPor] = 1; });
    var nombres = Object.keys(quienes);
    var lista = !_movsQRAbierto ? '' :
        '<div style="margin-top:10px;border-top:1px solid rgba(224,90,58,.22);padding-top:8px;max-height:320px;overflow-y:auto">'
        + movs.map(function (e) {
            var t = _movQRTipo(e);
            /* OJO: aquí se cortaba el ISO a pelo —slice(11,16)— y eso es la hora
               en UTC, seis horas adelante de la de la barra. El mismo registro
               decía 20:35 en este panel y 14:35 en la lista de abajo, y con esa
               hora nadie podía decidir si cayó antes o después del cierre.
               Ahora las dos salen del mismo helper, que sí convierte. */
            var _hc = _horaCaptura(e.fecha, e.registrado);
            var cuando = (e.fecha || '') + (_hc ? ' · ' + _hc.txt : '');
            return '<div style="display:flex;align-items:baseline;gap:10px;padding:6px 2px;border-bottom:1px solid var(--border);font-size:12.5px">'
                + '<span style="white-space:nowrap;color:' + t.col + '">' + t.ic + ' ' + t.txt + '</span>'
                + '<span style="flex:1;min-width:0;color:var(--text)">' + etx(e.nombre || '—')
                  + (e.motivo ? ' <span style="color:var(--text-dim);font-size:11px">· ' + etx(e.motivo) + '</span>' : '')
                  + (e.notas ? ' <span style="color:var(--text-dim);font-size:11px">· ' + etx(e.notas) + '</span>' : '')
                + '</span>'
                + '<span style="font-weight:600;white-space:nowrap;color:' + t.col + '">'
                  + etx(String(e.cantidad || 0)) + ' ' + etx(e.unidad || '') + '</span>'
                + '<span style="color:var(--text-dim);font-size:11px;white-space:nowrap">'
                  + (e.registradoPor ? etx(e.registradoPor) + ' · ' : '') + etx(cuando) + '</span>'
            + '</div>';
          }).join('')
        + '</div>';
    return '<div style="background:rgba(224,90,58,.06);border:1px solid rgba(224,90,58,.3);border-radius:11px;padding:11px 14px;margin-bottom:14px">'
        + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
        + '<span style="font-size:18px">📤</span>'
        + '<div style="flex:1;min-width:220px;font-size:12.5px;color:var(--text-muted);line-height:1.5">'
            + '<b style="color:var(--text)">' + movs.length + ' movimiento' + (movs.length !== 1 ? 's' : '') + ' desde el QR</b>'
            + ' <span style="color:var(--text-dim)">· ' + nM + ' merma' + (nM !== 1 ? 's' : '')
            + ' · ' + nC + ' cortesía' + (nC !== 1 ? 's' : '') + ' o préstamo' + (nC !== 1 ? 's' : '') + '</span>'
            + (nombres.length ? ' · por ' + etx(nombres.join(', ')) : '') + '<br>'
            + '<span style="color:var(--text-dim)">Ya están sumados en cada insumo. Esta lista es para revisarlos juntos.</span>'
        + '</div>'
        + '<button class="btn-vista" style="color:var(--red);border-color:var(--red)" onclick="toggleMovsQR()">'
            + (_movsQRAbierto ? '▾ Ocultar lista' : '▸ Ver los ' + movs.length) + '</button>'
        + '</div>' + lista
    + '</div>';
}

function renderStep2() {
    // Las vistas, los buscadores y las pestañas de lo registrado van en la barra del paso.
    const switcher = '<div style="padding-top:14px"></div>' + bannerMovsQR();
    vistaEntradas2 = 'busqueda';   // la tabla «Lista» se retiró (19-nov)
    /* ══ DOS COLUMNAS, UNA POR BUSCADOR (Edwin, 19-nov) ═════════════════
       Izquierda: TODOS los insumos del inventario desde el principio (antes
       la columna estaba vacía hasta teclear); el buscador «Producto para
       registrar» la reduce, y al tocar uno ese espacio se vuelve el registro
       de la entrada. Derecha: lo registrado, agrupado por insumo, con su
       existencia contada en el Paso 1 — para no regresar a revisar. */
    const logCount = (invActual?.entradasLog || []).length;
    return bannerMovsQR() + `
        <div class="p12-split p12-split-ent">
            <section class="p12-col">
                <div id="entNotaCard"></div>
                <div id="entFormCard"></div>
                <div id="entChips"></div>
            </section>
            <section class="p12-col">
                <div class="p12-cab"><span>Movimientos del período</span>
                    <b id="entLogCount">${logCount} registro${logCount !== 1 ? 's' : ''}</b>${_entBtnAgruparHTML()}</div>
                <div id="entSelBar"></div>
                <div id="entLogList"></div>
            </section>
        </div>`;
}

function initEntradaRapidaUI() {
    if (_entRapidaBusqueda) {
        const inp = document.getElementById('entBuscador');
        if (inp) inp.value = _entRapidaBusqueda;
    }
    _entPintarNota();
    renderChipsEntrada();
    if (_entRapidaInsumoId || _entNota) renderFormEntrada();
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
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">${_icInv('rec-ficha', 14)}Ver</button>
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
                ${selectorEmpaqueEnt(fila, idx, true)}
                <div class="inv-pesos-row">
                ${(fila.entradas||['','','','','']).map((e,ei)=>`
                    <div class="inv-peso-cell">
                        <div class="inv-peso-lbl">E${ei+1}</div>
                        <input type="text" inputmode="decimal" class="inv-peso-input" value="${_entMostrar(fila, e)}" placeholder="0"
                            title="Puedes escribir operaciones: 3*24+5"
                            onblur="updEntradaCalc(${idx},${ei},this)" onkeydown="_celdaKey(event,this)">
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
                ${selectorEmpaqueEnt(fila, idx, true)}
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px">
                    ${(fila.entradas||['','','','','']).map((e,ei)=>`
                    <div>
                        <div style="font-size:9px;color:var(--text-dim);text-align:center;margin-bottom:3px">E${ei+1}</div>
                        <input type="text" inputmode="decimal" class="inv-pesos-grid-input" value="${_entMostrar(fila, e)}" placeholder="0"
                            title="Puedes escribir operaciones: 3*24+5"
                            onblur="updEntradaCalc(${idx},${ei},this)" onkeydown="_celdaKey(event,this)"
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
    /* El calendario se acota al periodo del inventario: es más barato no poder
       elegir un día imposible que explicar después por qué no se guardó. El
       candado de guardado sigue ahí —el `max` de un input se puede saltar
       escribiendo—, esto solo evita el viaje. */
    const _fEnt = document.getElementById('entFecha');
    const _pEnt = _periodoInvActual();
    _fEnt.max = _pEnt.hasta || '';
    _fEnt.min = _pEnt.desde || '';
    /* Se propone HOY si cae dentro del periodo; si no, el día del inventario.
       Proponer una fecha que el propio candado va a rechazar es una trampa. */
    const _hoyEnt = new Date().toISOString().slice(0,10);
    _fEnt.value = (_pEnt.hasta && _hoyEnt > _pEnt.hasta) ? _pEnt.hasta : _hoyEnt;
    const _ayudaEnt = document.getElementById('entFechaAyuda');
    if (_ayudaEnt) {
        _ayudaEnt.textContent = _pEnt.desde
            ? ('Este inventario cubre del ' + _pEnt.desde + ' al ' + (_pEnt.hasta || 'cierre') + '.')
            : ('Hasta el ' + (_pEnt.hasta || 'cierre') + ', que es la fecha de este inventario.');
    }
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

/* ── QUÉ TAN IDENTIFICABLE ES UN INSUMO ────────────────────────────────────
   Una entrada guarda solo el `insumoId`; el nombre se arma al pintarla, con la
   etiqueta canónica. De ahí salen los dos problemas que Edwin vio en la lista:

   · HUÉRFANA: el id ya no existe en el catálogo (se borró el insumo, o la
     entrada vino de otra sucursal). No hay de dónde sacar el nombre y la fila
     sale a medias, pareciendo una entrada buena.
   · A MEDIAS: el insumo existe pero está capturado sin variedad, contenido ni
     marca. Entonces se ven dos renglones "Torres 10", uno completo y otro pelón,
     imposibles de distinguir — que es justo lo que hizo cargar entradas al
     insumo equivocado.

   Lo primero se ataja al guardar: es un dato roto. Lo segundo NO se bloquea —el
   insumo incompleto es problema del catálogo, no de la entrada— pero se avisa
   antes de guardar, que es cuando todavía se puede corregir. */
/* ── EL PERIODO DEL INVENTARIO, EN PALABRAS ────────────────────────────────
   Devuelve {desde, hasta} en fechas, para poder decirle al usuario dónde puede
   registrar y para acotar el selector. `hasta` vacío = inventario abierto sin
   tope… salvo su propia fecha: un inventario del 8 de septiembre no puede
   recibir una entrada del 10, porque ese movimiento todavía no ocurrió cuando se
   contó. */
function _periodoInvActual() {
    if (!invActual) return { desde: '', hasta: '' };
    var refI = _getRefInv();
    return {
        desde: refI ? String(refI.fecha || '') : '',
        hasta: String(invActual.fecha || '')
    };
}

/* POR QUÉ ESTO ES UN CANDADO Y NO UN DETALLE:

   Guardar una entrada con fecha POSTERIOR al inventario la deja fuera de su
   periodo. En el siguiente render, `_importarEntradasQR` la saca de
   `invActual.entradasLog` —está en el log global y no pertenece a este
   periodo—, eso muta el inventario, el inventario se guarda, el guardado
   dispara realtime, realtime repinta, y el render vuelve a sacarla. La rueda no
   para: es el bucle de "recarga y recarga" que no dejaba ni escribir, con el
   inventario subiéndose en cada vuelta.

   Se ataja en el origen: una entrada no puede quedar fuera del periodo de su
   inventario. */
/* Se propone HOY si cae dentro del periodo; si no, el día del inventario.
   Proponer una fecha que el propio candado va a rechazar es una trampa. */
function _fechaSugeridaEntrada() {
    var hoy = new Date().toISOString().slice(0, 10);
    var p = _periodoInvActual();
    if (p.hasta && hoy > p.hasta) return p.hasta;
    return hoy;
}

function _fechaFueraDePeriodo(fecha) {
    if (!fecha || !invActual) return null;
    var p = _periodoInvActual(), f = String(fecha);
    if (p.hasta && f > p.hasta) {
        return 'La entrada quedaría DESPUÉS del cierre de este inventario (' + p.hasta + '), ' +
               'así que no pertenece a este periodo: al guardarla se saldría sola y el ' +
               'inventario no dejaría de recargarse.\n\nRegístrala en el inventario que ' +
               'cubra esa fecha, o corrige el día.';
    }
    if (p.desde && f <= p.desde) {
        return 'Esa fecha cae en el inventario anterior, que cerró el ' + p.desde + '. ' +
               'Lo que entró hasta ese día ya quedó contado ahí.\n\nCorrige el día si te ' +
               'equivocaste, o regístrala en el inventario que le toca.';
    }
    return null;
}

function _insumoDeEntrada(id) {
    if (!id) return null;
    try { return (typeof window._insumoResolver === 'function') ? window._insumoResolver(id) : null; }
    catch (e) { return null; }
}
function _insumoIdentificable(ins) {
    if (!ins) return false;
    return !!((ins.variedad || '').trim() || (ins.contenido || '').trim() ||
              (ins.marca || '').trim() || (ins.presentacion || '').trim());
}

function guardarEntrada() {
    if (!_entradaInsumoId) return;
    const cantidad = parseFloat(document.getElementById('entCantidad').value) || 0;
    if (cantidad <= 0) { alert('Ingresa una cantidad mayor a 0.'); return; }

    /* Sin insumo real no se guarda: una entrada huérfana no se puede costear, no
       se puede descontar del inventario y en la lista parece buena. */
    const _ins = _insumoDeEntrada(_canonInsumoId(_entradaInsumoId));
    if (!_ins) {
        alert('Ese producto ya no está en el catálogo de insumos, así que la entrada no se puede guardar.\n\n' +
              'Vuelve a elegirlo de la lista, o agrégalo al catálogo primero.');
        return;
    }
    /* Fuera del periodo NO se guarda: es lo que disparaba el bucle (ver
       _fechaFueraDePeriodo). Se lee el campo aquí porque la fecha se declara más
       abajo, y usarla antes revienta por zona muerta. */
    const _fueraP = _fechaFueraDePeriodo(document.getElementById('entFecha').value || '');
    if (_fueraP) { alert(_fueraP); return; }

    /* Existe pero no se distingue de otro con el mismo nombre: se avisa, no se
       bloquea. Es el catálogo el que está incompleto. */
    if (!_insumoIdentificable(_ins) &&
        !confirm('"' + (_ins.nombre || 'Este producto') + '" está capturado sin marca, contenido ni variedad.\n\n' +
                 'En la lista de entradas se va a ver solo con ese nombre, y si tienes otro parecido no vas a ' +
                 'poder distinguirlos.\n\n¿Guardar de todos modos?')) return;
    const costo  = parseFloat(document.getElementById('entCosto').value)  || 0;
    const fecha  = document.getElementById('entFecha').value || '';
    const notas  = document.getElementById('entNotas').value.trim();
    if (!invActual.entradasLog) invActual.entradasLog = [];
    // Sella con la sucursal del inventario (independencia multi-sucursal): así la entrada
    // no se sale de esta sucursal ni al respaldarse al log global. id estable para editar/borrar.
    invActual.entradasLog.push({
        id: genId() + genId(),
        insumoId: _canonInsumoId(_entradaInsumoId), cantidad, costo, fecha, notas,
        sucursalId: (invActual && invActual.sucursalId) || _sucActiva() || 'suc_principal',
        origen: 'manual',
        registrado: new Date().toISOString()   // hora de captura (periodo de apertura/cierre)
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

/* ══ EL PASO 3 EN CUATRO VISTAS, TODAS EN LISTA (Edwin, 18-nov) ═══════════
   Antes: «Menú» (tarjetas de cocteles), «Lista completa» y «Búsqueda rápida»,
   con la producción de prebatch repetida arriba de las tres —y si no había
   prebatch producibles, solo un texto—. Ahora:
     🧴 Insumos (la primera): todos en lista, con su buscador y con lo que se
        usó de cada uno en coctelería y en prebatch.
     🍹 Cocteles: las recetas en LISTA, no en tarjetas.
     🏭 Prebatch: los batches hechos, en lista, y por qué falta el que no sale.
     🔍 Búsqueda rápida: busca insumos, cocteles y prebatch a la vez. */
function renderStep3() {
    const nPb = prebatchesProducibles().length;
    const b = (v, txt) => `<button class="exist-vista-btn ${vistaVentas===v?'active':''}" onclick="setVistaVentas('${v}')">${txt}</button>`;
    const switcher = `<div class="exist-vista-switcher s3-vistas">
        ${b('lista', '🧴 Insumos')}
        ${b('menu', '🍹 Cocteles')}
        ${b('prebatch', '🏭 Prebatch' + (nPb ? ' <span class="s3-cuenta">' + nPb + '</span>' : ''))}
        ${b('busqueda', '🔍 Búsqueda rápida')}
    </div>`;
    // Las cuatro vistas y el buscador van en la barra del paso (encabezado fijo).
    void switcher;
    if (vistaVentas === 'menu')     return renderStep3Menu();
    if (vistaVentas === 'prebatch') return _renderProduccionPrebatch();
    if (vistaVentas === 'busqueda') return renderStep3BusquedaScaffold();
    return renderStep3Insumos();
}

function renderStep3Insumos() {
    // El buscador actualiza SOLO esta lista (no el toolbar) → no se pierde el foco al escribir.
    return '<div id="step3VentasListaCont" style="padding-top:12px">' + _step3VentasInner() + '</div>';
}
/* ══ LA LISTA DE VENTAS POR BLOQUES (Edwin, 19-nov) ═════════════════════
   Cada insumo: su nombre grande con lo que ya se sabe de él (existencia
   actual del Paso 1, entradas del Paso 2 y lo usado en coctelería y en
   batches) y tres bloques —Venta, Cortesía, Merma—, cada uno con sus dos
   campos arriba (copas/piezas y botellas) y su comentario abajo. */
function _step3VentasInner() {
    const b        = busquedaCapt.toLowerCase();
    const filtradas = filasCaptura.filter(f =>
        (!filtroFamActivo || f.familia === filtroFamActivo) &&
        (!filtroCatActiva || f.categoria === filtroCatActiva) &&
        (!b || f.nombre.toLowerCase().includes(b))
    );
    const selSt = "background:transparent;border:none;color:var(--text-dim);font-family:inherit;font-size:10px;cursor:pointer;padding:0;max-width:96px";
    const rows = filtradas.map(fila => {
        const esComp = !!fila.esCompuesto;
        if (esComp) return '';                      // el compuesto es consolidación del reporte
        const idx    = filasCaptura.indexOf(fila);
        const esCopa = fila.tipo === 'copa';
        const u      = fila.tipo === 'peso' ? (fila.baseUnit || 'g').toLowerCase() : (fila.tipo === 'pza' ? 'pza' : 'bot');
        const reg    = _esRegistrado(fila);
        const ent    = getEntradasBottles(fila.insumoId);
        const info   = '<div class="s3i-info">' +
            '<span>Existencia actual <b>' + (reg ? fmtBot(calcExistenciaBot(fila)) + ' ' + u : 'sin contar') + '</b></span>' +
            '<span>Entradas <b>' + (ent > 0 ? '+' + fmtBot(Math.round(ent * 100) / 100) + ' ' + _unidadCompra(fila) : '—') + '</b></span></div>';
        const vV = _copAUm(fila, fila.ventasCopasDirectas, 'ventasCopasDirectas') || 0;
        const campo = (lbl, html) => '<div class="s3i-campo"><span class="s3i-l">' + lbl + '</span>' + html + '</div>';
        // Como Excel (23-nov): la operación se queda escrita, «= n» abajo y «+»/«−».
        const num = (campoNom, val, onblur, estilo) => _celdaS3('s3i-' + campoNom + '-' + idx, idx, campoNom, val, onblur, estilo, true);
        const coment = (campoNom, val, ph) => `<input type="text" class="inv-num-input s3i-coment" value="${etx(val || '')}" placeholder="${ph}"
            oninput="updVentasConcepto(${idx},'${campoNom}',this.value)">`;
        const botSalida = (campoCop) => {
            if (!esCopa) return campo('bot', '<div class="s3i-na">—</div>');
            return campo('Botellas', _inputSalidaBotella(idx, campoCop, true).replace(/<label[^>]*>[^<]*<\/label>/, ''));
        };
        const umSel = (campoNom) => esCopa ? _selUM(idx, campoNom, selSt) : (fila.tipo === 'pza' ? 'pza' : u);
        return `<tr class="inv-row s3i-row">
            <td class="inv-td-prod">
                <div class="s3i-nom">${etx(insumoTitulo(fila))}</div>
                <div class="inv-prod-meta">
                    ${insumoMeta(fila) ? `<span class="inv-tag">${insumoMetaHTML(fila)}</span>` : ''}
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">${_icInv('rec-ficha', 14)}Ver</button>
                </div>
                ${info}
                ${_usoFilaPaso3HTML(fila)}
            </td>
            <td class="s3i-blq">
                <div class="s3i-tit">Venta</div>
                <div class="s3i-par">
                    ${campo(umSel('ventasCopasDirectas'), num('ventasCopasDirectas', vV, `updVentasCalc(${idx},'ventasCopasDirectas',this)`))}
                    ${esCopa ? campo('Botellas', num('ventasBotella', fila.ventasBotella, `updVentasDirCalc(${idx},'ventasBotella',this)`)) : campo('bot', '<div class="s3i-na">—</div>')}
                </div>
                ${coment('ventasComentario', fila.ventasComentario, 'Comentario de venta…')}
            </td>
            <td class="s3i-blq">
                <div class="s3i-tit cort">Cortesía y consumo interno</div>
                <div class="s3i-par">
                    ${campo(umSel('cortesiaCopas'), num('cortesiaCopas', _salidaCaptura(fila, 'cortesiaCopas') || 0, `updVentasCalc(${idx},'cortesiaCopas',this)`, 'border-color:rgba(155,141,232,.45)'))}
                    ${botSalida('cortesiaCopas')}
                </div>
                ${_cortConceptoHTML(idx, 'cortesiaConcepto', fila.cortesiaConcepto, true)}
                ${_cortesia2HTML(idx, true)}
            </td>
            <td class="s3i-blq">
                <div class="s3i-tit merm">Merma</div>
                <div class="s3i-par">
                    ${campo(umSel('mermaCopas'), num('mermaCopas', _salidaCaptura(fila, 'mermaCopas') || 0, `updVentasCalc(${idx},'mermaCopas',this)`, 'border-color:rgba(224,90,58,.4)'))}
                    ${botSalida('mermaCopas')}
                </div>
                ${coment('mermaConcepto', fila.mermaConcepto, 'ej. derrame, rotura…')}
            </td>
        </tr>`;
    }).join('');
    return `<div class="inv-table-wrap">
        <table class="inv-capture-table s3i-tabla">
            <thead><tr>
                <th class="inv-th">Producto</th>
                <th class="inv-th inv-th-c">Venta</th>
                <th class="inv-th inv-th-c">Cortesía</th>
                <th class="inv-th inv-th-c">Merma</th>
            </tr></thead>
            <tbody>${rows||'<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:32px">Sin resultados</td></tr>'}</tbody>
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
/* ══ MEDIO BATCH ES UN BATCH NORMAL ════════════════════════════════════════
   Esto solo tenía botones de − y +: el contador era un <span>, no un campo, y
   el salto era de uno en uno. Capturar 1.5 batches era IMPOSIBLE — y hacer
   medio batch es lo más normal del mundo cuando se acaba el día o cuando la
   botella no da para el batch completo.

   Peor: no se podía escribir «12» de un tirón. Doce batches eran doce clics.

   El contador de cócteles de esta misma pantalla ya era un campo donde se
   escribe (y hasta acepta «6+4»). Esto es lo mismo, con la misma pieza.      */
function _prodPbAplicar(id, nuevo) {
    if (!invActual.prebatchProducidos) invActual.prebatchProducidos = {};
    nuevo = Math.max(0, parseFloat(nuevo) || 0);
    invActual.prebatchProducidos[id] = nuevo;
    /* LAS TRES BANDERAS, no una. Antes solo se marcaba _step5Dirty; las otras
       dos quedaban en false. Hoy la producción no pasa por esos dos montones y
       no mordía, pero es exactamente la familia de bugs que ya costó dos
       sesiones: un dato que cambia y un caché que no se entera. */
    _consumoDirty = true; window._step5Dirty = true;
    if (typeof _autoGuardar === 'function') _autoGuardar(); // persistir (antes solo quedaba en memoria)
    const el = document.getElementById('prod-' + id);
    if (el) {
        /* Se escribe el valor SOLO si no es el campo que se está editando: si
           no, teclear «15» se convierte en «1» en cuanto se procesa el «1». */
        if (el !== document.activeElement) el.value = nuevo > 0 ? nuevo : '';
        el.classList.toggle('active', nuevo > 0);
        const item = el.closest('.step3-menu-item');
        if (item) item.classList.toggle('has-cnt', nuevo > 0);
    }
    _refrescarAvisoPrebatches(); // el aviso solo mira los batches ya capturados
}

/* Los botones ± siguen existiendo para el caso de siempre (uno más, uno menos)
   y ahora respetan los decimales que se hayan escrito: 1.5 + 1 = 2.5. */
function updProduccionPrebatch(id, delta) {
    const actual = parseFloat((invActual.prebatchProducidos || {})[id] || 0);
    _prodPbAplicar(id, actual + delta);
}
// Captura directa: se teclea cuántos batches se hicieron, decimales incluidos.
function setProduccionPrebatch(id, val) { _prodPbAplicar(id, val); }

/* ── ¿Este prebatch va a salir bien en el Resultado? ───────────────────────
   Revisión SIN efectos: mira un prebatch con batches capturados y devuelve lo que
   le falta para que su reparto funcione. Antes esto solo existía como console.warn
   (el del rendimiento) o como nada: el batch salía repartiendo cero y no había
   forma de saber por qué sin abrir la consola.
   Solo revisa los que YA tienen producción capturada — de los demás no hay nada
   que avisar todavía. */
function _revisarPrebatch(pre) {
    if (!pre) return null;
    // Por sub-receta, no por el id de ESTE registro: la producción pudo capturarse
    // sobre otro registro del mismo batch (ver _recetaIdDePrebatch).
    var n = pre.recetaId ? _batchesDeSubReceta(pre.recetaId) : _batchesProducidos(pre.id);
    if (!n) return null;
    var fila  = _filaDeMiembro(pre.id);
    var sr    = (window._recetaResolver ? window._recetaResolver(pre.recetaId) : null)
             || (getRecetas() || []).find(function (r) { return r && r.id === pre.recetaId; });
    var probs = [];
    if (!sr) {
        probs.push('su sub-receta ya no existe: no se descuentan sus insumos base');
    } else {
        var ligados = (sr.ingredientes || []).filter(function (ing) {
            return ing && ing.insumoId && (parseFloat(ing.cantidad) || 0) > 0;
        }).length;
        if (!ligados) probs.push('ningún ingrediente de la sub-receta está ligado a un insumo: produce, pero no descuenta nada');
        _ingredientesSinContenido(sr).forEach(function (x) {
            probs.push('«' + x.nombre + '» se cuenta por pieza pero no tiene su contenido capturado en el catálogo: ' +
                       'lo que este batch usa de él (' + x.porBatch + ' por batch) no se le puede descontar');
        });
    }
    if (!fila) {
        probs.push('no tiene renglón en este inventario: lo producido sí se descuenta de sus insumos, pero el batch no lleva su propia cuenta');
    } else {
        if (fila.tipo === 'pza' && !_basePorUnidadFila(fila))
            probs.push('está capturado por PIEZA pero falta el contenido por pieza para convertir lo producido a piezas');
        var cx = (sr && sr.camposExtra) || {};
        var rendSR = parseFloat(cx.rendimientoFinal) || 0;
        var rendPr = parseFloat(fila.rendimientoBatch) || 0;
        var cn     = parseFloat(fila.contNeto) || 0;
        if (!rendSR && !rendPr && cn > 0)
            probs.push('no tiene rendimiento capturado: se está usando el contenido del envase (' +
                       _fmtBase(cn) + ') como si fuera lo que rinde un batch. Si ese envase es solo ' +
                       'para guardarlo, la producción sale inflada');
        /* Producido pero sin una sola venta: o no se capturaron los cocteles que lo
           usan, o ningún coctel lo lleva como ingrediente. En los dos casos el batch
           entra al Resultado como si nada hubiera salido de él, y el faltante que eso
           genera cae repartido en sus insumos sin explicación a la vista. */
        if (pre.recetaId && !_consumoBaseSubReceta(pre.recetaId)
            && !(parseFloat(fila.ventasCopasDirectas) || 0) && !(parseFloat(fila.ventasBotella) || 0))
            probs.push('se produjo pero no se le descontó NINGUNA venta: revisa que los cocteles ' +
                       'que lo usan estén capturados en este paso y que lo lleven como ingrediente');
    }
    return probs.length ? { nombre: pre.nombre || pre.id, batches: n, probs: probs } : null;
}

// Franja de avisos de los prebatches con producción capturada (mismo lugar donde se anota).
function _avisoPrebatchesHTML(pres) {
    var malos = (pres || []).map(_revisarPrebatch).filter(Boolean);
    if (!malos.length) return '';
    var items = malos.map(function (m) {
        return '<div style="margin-top:6px"><b style="color:var(--text)">' + etx(m.nombre) + '</b> ' +
            '<span style="opacity:.7">(' + m.batches + ' batch' + (m.batches === 1 ? '' : 'es') + ')</span>: ' +
            m.probs.map(etx).join('; ') + '.</div>';
    }).join('');
    return '<div style="margin:0 0 12px;padding:10px 13px;border:1px solid rgba(245,200,66,.35);' +
        'background:rgba(245,200,66,.07);border-radius:9px;font-size:11.5px;color:var(--text-muted);line-height:1.6">' +
        '<b style="color:var(--accent)">Revisa estos batches.</b> Se capturó su producción, pero algo les falta ' +
        'para que el Resultado cuadre:' + items + '</div>';
}
/* Contenedor SIEMPRE presente (aunque no haya avisos): así el aviso puede aparecer o
   irse al capturar el primer batch sin re-renderizar el paso entero y perder el scroll. */
function _avisoPrebatches(pres) {
    return '<div id="avisoPrebatches">' + _avisoPrebatchesHTML(pres) + '</div>';
}
function _refrescarAvisoPrebatches() {
    var el = document.getElementById('avisoPrebatches');
    if (el) el.innerHTML = _avisoPrebatchesHTML(prebatchesProducibles());
}

function _renderProduccionPrebatch() {
    const pres = prebatchesProducibles();
    const prod = invActual?.prebatchProducidos || {};
    const lista = pres.length ? `
        ${_avisoPrebatches(pres)}
        <div class="step3-menu-grid step3-lista" data-menu-grupo>${pres.map(p => _step3PrebatchItemHTML(p, prod)).join('')}</div>`
        : `<div class="s3-vacio">🍸 Todavía no hay ningún prebatch para anotar en este inventario.</div>`;
    return `<div style="padding:0 16px 16px">
        <div class="s3-titulo">🏭 Producción de prebatch — batches hechos</div>
        <div style="font-size:11.5px;color:var(--text-dim);padding:0 0 10px">
            Anota cuántos batches hiciste: descuenta de cada insumo lo que lleva la sub-receta y le suma la producción al prebatch.
        </div>
        ${lista}
        ${_prebatchFueraHTML()}
    </div>`;
}
/* Un renglón de la lista de prebatch (vista Prebatch y Búsqueda rápida). */
function _step3PrebatchItemHTML(p, prod) {
    const n  = parseFloat((prod || {})[p.id]) || 0;
    const sr = (window._recetaResolver ? window._recetaResolver(p.recetaId) : getRecetas().find(r => r.id === p.recetaId));
    /* Por el resolver, no por un .find de id crudo: si el ingrediente apunta
       a la copia por sucursal, el find no lo encuentra y la lista de bases
       salía como «Vino, ?, ?». */
    const bases = sr ? (sr.ingredientes||[]).map(ing => {
        const ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(ing.insumoId) : null;
        return ins ? String(ins.nombre || '') : (ing.nombre || '?');
    }).slice(0, 6).join(', ') : '';
    /* Dice SIEMPRE qué sub-receta va a consumir: capturar aquí descuenta SUS
       ingredientes, y si la liga quedó apuntando a otra se tiene que ver. */
    return `<div class="step3-menu-item pb ${n>0?'has-cnt':''}" data-menu-nom="${etx(String(p.nombre||'').toLowerCase())}">
        <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:flex-start;gap:6px">
                <div class="s3-nom" title="${etx(p.nombre)}">${etx(p.nombre)}</div>
                ${p.recetaId ? `<button onclick="verFichaReceta('${p.recetaId}')" title="Ver la sub-receta" class="s3-ficha">${_icInv('rec-ficha')}</button>` : ''}
            </div>
            ${sr ? `<div class="s3-sub" title="Capturar aquí descuenta los ingredientes de «${etx(sr.nombre)}»">hace: ${etx(sr.nombre)}</div>` : ''}
            ${bases ? `<div class="s3-sub">↓ ${etx(bases)}</div>` : ''}
        </div>
        <div class="step3-counter">
            <button onclick="updProduccionPrebatch('${p.id}',-1)">−</button>
            <input id="prod-${p.id}" type="text" inputmode="decimal"
                class="step3-cnt-val ${n>0?'active':''}" value="${n>0?n:''}" placeholder="—"
                title="Cuántos batches hiciste. Acepta medios (1.5) y operaciones: 2+1"
                onkeydown="_celdaKey(event,this)"
                onblur="_celdaCalc(this,function(v){ setProduccionPrebatch('${p.id}', v); }); if(!(+this.value>0)) this.value='';"
                style="width:46px;text-align:center;background:transparent;border:none;outline:none;font-family:inherit">
            <button onclick="updProduccionPrebatch('${p.id}',1)">+</button>
        </div>
    </div>`;
}
/* Un renglón de la lista de cocteles (vista Cocteles y Búsqueda rápida). */
function _step3RecetaItemHTML(r, vendidos) {
    const p   = parseFloat(r.precioEnCarta) || 0;
    const cnt = parseFloat((vendidos || {})[r.id]) || 0;
    // Los ingredientes por su nombre, en canónico —igual que el consumo—; si el
    // insumo no está en este inventario, con su nombre del catálogo.
    const ingStr = (r.ingredientes||[]).map(ing => {
        const f = _filaDeMiembro(ing.insumoId);
        if (f && f.nombre) return f.nombre;
        const ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(ing.insumoId) : null;
        if (ins && ins.nombre) return ins.nombre;
        return ing.nombre ? String(ing.nombre) : '?';
    }).slice(0, 6).join(', ');
    return `<div class="step3-menu-item ${cnt>0?'has-cnt':''}" data-menu-nom="${etx((r.nombre||'').toLowerCase())}">
        <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;min-width:0">
                <div class="s3-nom">${etx(r.nombre)}</div>
                <button onclick="verFichaReceta('${r.id}')" title="Ficha técnica" class="s3-ficha">${_icInv('rec-ficha')}</button>
                ${p>0?`<span class="s3-precio">$${p.toFixed(0)}</span>`:''}
            </div>
            ${ingStr?`<div class="s3-sub">${etx(ingStr)}</div>`:''}
        </div>
        <div class="step3-counter">
            <button onclick="updCntMenu('${r.id}',-1)">−</button>
            <input id="cnt-${r.id}" type="text" inputmode="decimal"
                class="step3-cnt-val ${cnt>0?'active':''}" value="${cnt>0?cnt:''}" placeholder="—"
                title="Puedes escribir operaciones: 6+4"
                onkeydown="_celdaKey(event,this)"
                onblur="_celdaCalc(this,function(v){ setCntMenu('${r.id}', v); }); if(!(+this.value>0)) this.value='';"
                style="width:42px;text-align:center;background:transparent;border:none;outline:none;font-family:inherit">
            <button onclick="updCntMenu('${r.id}',1)">+</button>
        </div>
    </div>`;
}
/* Lo que se usó de un insumo, debajo de su nombre en la lista del Paso 3:
   coctelería (recetas que lo llevan directo) y prebatch (batches producidos
   que lo llevan). Es lo mismo que el Resultado le va a descontar. */
function _usoFilaPaso3HTML(fila) {
    var coct = 0, pb = 0;
    try { coct = consumoRecetasFila(fila) || 0; } catch (e) {}
    try { pb = _consumoBaseProd(fila) || 0; } catch (e) {}
    if (!(coct > 0.0001) && !(pb > 0.0001)) return '';
    var copa = fila.tipo === 'copa' && parseFloat(fila.copaML) > 0;
    var fmt = fila.tipo === 'copa' ? function (v) { return _fmtCop(v, fila) + (copa ? ' · ' + _mlTxt(v * parseFloat(fila.copaML)) : ''); }
        : function (v) { return _fmtEquivalenteBatch(v, fila.tipo === 'pza' ? 'PZA' : (fila.baseUnit || 'G')); };
    return '<div class="s3-uso">' +
        (coct > 0.0001 ? '<span>' + _icInv('cor-bebidas', 14) + 'Uso en coctelería <b>' + fmt(coct) + '</b></span>' : '') +
        (pb > 0.0001 ? '<span>' + _icInv('rec-sub-bebidas', 14) + 'Uso en prebatch <b>' + fmt(pb) + '</b></span>' : '') + '</div>';
}

/* ══ EL PREBATCH QUE NO SALE, Y POR QUÉ ═════════════════════════════════════
   «No aparecen los prebatch en el Paso 3». Para salir aquí un insumo de
   producción propia necesita: su liga a la sub-receta, NO estar marcado con
   «No» y el ÁREA de este inventario. Los que se cargaron antes de que hubiera
   selector de área no tienen ninguna, y quedaban fuera sin que nada lo dijera.
   Aquí se listan, con el motivo y el botón que lo arregla ahí mismo. */
var _AREA_NOMBRE = { barra:'Barra', cocina:'Cocina', almacen_barra:'Almacén de barra', almacen_cocina:'Almacén de cocina', almacen_general:'Almacén general' };
function _areaInsDelInv() {
    var a = String((invActual && invActual.area) || '').toLowerCase();
    return (typeof _AREAS_DE_INV !== 'undefined' && _AREAS_DE_INV[a]) ? _AREAS_DE_INV[a][0] : a;
}
// Solo los de ESTE tipo de inventario: en barra no se listan los de cocina.
function _prebatchDeEsteTipo(x) {
    var a = String((invActual && invActual.area) || '').toLowerCase(), fam = String(x.familia || '').toLowerCase();
    if (a === 'barra' || a === 'almacen_barra') return !fam || fam.indexOf('bebida') === 0;
    if (a === 'cocina' || a === 'almacen_cocina') return !fam || fam.indexOf('aliment') === 0;
    return true;
}
function _prebatchesFuera() {
    var dentro = {}; prebatchesProducibles().forEach(function (p) { dentro[p.id] = 1; });
    var recs = getRecetas() || [];
    var porNom = {}; recs.forEach(function (r) { if (r && String(r.tipo || '').indexOf('sub') === 0 && r.nombre) porNom[String(r.nombre).trim().toLowerCase()] = r; });
    var out = [];
    _scopeSucInsumos(getInsumos()).forEach(function (x) {
        if (!x || !x.esSubReceta || dentro[x.id] || !_prebatchDeEsteTipo(x)) return;
        var nom = String(x.nombre || '').trim().toLowerCase(), sr0 = porNom[nom] || porNom[nom.replace(/\s*(pr|prebatch|batch)\s*$/, '')];
        if (!x.recetaId) out.push({ ins: x, motivo: 'no está ligado a su sub-receta', accion: sr0 ? 'ligar' : '', recetaId: sr0 && sr0.id, srNom: sr0 && sr0.nombre });
        else if (x.ocultoInventario) out.push({ ins: x, motivo: 'se le contestó «No» a «¿Usar como prebatch en el inventario?»', accion: 'usar' });
        else if (!x.area) out.push({ ins: x, motivo: 'no tiene área asignada', accion: 'area' });
        else out.push({ ins: x, motivo: 'es del área ' + (_AREA_NOMBRE[x.area] || x.area), accion: 'area' });
    });
    return out;
}
function _prebatchFueraHTML() {
    var f = [];
    try { f = _prebatchesFuera(); } catch (e) { return ''; }
    // Sub-recetas de este tipo que ni siquiera se han cargado como insumo.
    var conIns = {}; (getInsumos() || []).forEach(function (x) { if (x && x.esSubReceta && x.recetaId) conIns[x.recetaId] = 1; });
    var a = String((invActual && invActual.area) || '').toLowerCase();
    var tipoSub = (a === 'cocina' || a === 'almacen_cocina') ? 'sub-alimentos' : 'sub-bebidas';
    var sinIns = (getRecetas() || []).filter(function (r) { return r && r.tipo === tipoSub && r.status !== 'inactiva' && !conIns[r.id]; });
    if (!f.length && !sinIns.length) return '';
    var nomArea = _AREA_NOMBRE[_areaInsDelInv()] || (invActual && invActual.area) || 'esta área';
    var btn = function (fn, txt) { return '<button onclick="' + fn + '" class="s3-arreglar">' + txt + '</button>'; };
    var renglon = function (x) {
        var b = x.accion === 'ligar' ? btn("_religarPrebatch('" + x.ins.id + "','" + x.recetaId + "')", '🔗 Ligarlo a «' + etx(x.srNom) + '»')
              : x.accion === 'usar' ? btn("_ajustarPrebatchInv('" + x.ins.id + "','usar')", '✓ Usarlo en el inventario')
              : x.accion === 'area' ? btn("_ajustarPrebatchInv('" + x.ins.id + "','area')", '📍 Ponerlo en ' + etx(nomArea)) : '';
        return '<div class="s3-fuera-r"><b>' + etx(x.ins.nombre || '') + '</b> — ' + etx(x.motivo) + ' ' + b + '</div>';
    };
    /* Los que se marcaron con «No» fue a propósito: no se gritan, van
       plegados, por si se quiere cambiar de opinión. */
    var no = f.filter(function (x) { return x.accion === 'usar'; }), si = f.filter(function (x) { return x.accion !== 'usar'; });
    return '<div class="s3-fuera">' +
        (si.length ? '<div class="s3-fuera-tit">¿No sale un prebatch? ' + si.length + (si.length === 1 ? ' se queda fuera' : ' se quedan fuera') + ' de este inventario:</div>' +
            si.map(renglon).join('') : '') +
        (no.length ? '<details class="s3-sinins s3-no"><summary>' + no.length + ' marcado' + (no.length === 1 ? '' : 's') +
            ' con «No» en «¿Usar como prebatch en el inventario?»</summary>' + no.map(renglon).join('') + '</details>' : '') +
        (sinIns.length ? '<details class="s3-sinins"><summary>' + sinIns.length + ' sub-receta' + (sinIns.length === 1 ? '' : 's') +
            ' de ' + (tipoSub === 'sub-bebidas' ? 'bebidas' : 'alimentos') + ' todavía sin cargar como insumo</summary>' +
            '<div>' + sinIns.map(function (r) { return etx(r.nombre || ''); }).join(' · ') + '</div>' +
            '<div class="s3-nota">Para anotar sus batches: en Recetas abre la sub-receta y contesta «Sí» a «¿Usar como prebatch en el inventario?».</div></details>' : '') +
        '</div>';
}
/* Arregla desde aquí por qué un prebatch no sale: le pone el área de este
   inventario, o lo vuelve a «usar en el inventario». Se guarda en el
   catálogo (y en su espejo local); si no se guarda, se deshace. */
async function _ajustarPrebatchInv(insumoId, accion) {
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(insumoId) : null;
    if (!ins || !invActual) { alert('No se encontró ese insumo.'); return; }
    var areaNueva = _areaInsDelInv(), nomArea = _AREA_NOMBRE[areaNueva] || areaNueva;
    var antes = { area: ins.area, ocultoInventario: ins.ocultoInventario };
    var msg;
    if (accion === 'usar') {
        msg = '«' + (ins.nombre || '') + '» se va a usar en el inventario: sale en la lista, se le anotan sus batches y lleva su propio conteo.';
        ins.ocultoInventario = false;
        if (!ins.area) { ins.area = areaNueva; msg += ' Como no tenía área, queda en ' + nomArea + '.'; }
    } else {
        msg = '«' + (ins.nombre || '') + '» va a quedar en el área ' + nomArea + (ins.area ? ' (antes: ' + (_AREA_NOMBRE[ins.area] || ins.area) + ')' : '') + '.';
        ins.area = areaNueva;
    }
    if (!confirm(msg + String.fromCharCode(10, 10) + '¿Lo hacemos?')) { ins.area = antes.area; ins.ocultoInventario = antes.ocultoInventario; return; }
    var negId = getNegocioActivo();
    try {
        if (typeof _supabase !== 'undefined' && negId) {
            var r = await _supabase.from('negocio_insumos')
                .upsert({ negocio_id: negId, insumo_id: ins.id, datos: ins }, { onConflict: 'negocio_id,insumo_id' });
            if (r.error) throw r.error;
        }
        try {   // el espejo local, sin fotos (la cuota de localStorage)
            _skPut(_sk('insumos'), JSON.stringify((getInsumos() || []).map(function (x) {
                var c = Object.assign({}, x); c.foto = ''; c.fotoUrl = ''; return c;
            })));
        } catch (e2) {}
    } catch (e) {
        ins.area = antes.area; ins.ocultoInventario = antes.ocultoInventario;
        alert('No se pudo guardar el cambio, así que NO se hizo.' + String.fromCharCode(10, 10) + ((e && e.message) || e));
        return;
    }
    // Ya es de este inventario: se rearma para que tenga su renglón.
    if (filasCaptura.length) invActual.filas = filasCaptura.map(function (f) { return Object.assign({}, f); });
    try { cargarProductosCaptura(); } catch (e3) { console.warn('[inv] ajustar prebatch:', e3); }
    _consumoDirty = true; window._step5Dirty = true;
    if (typeof _autoGuardar === 'function') _autoGuardar();
    if (typeof renderStepContent === 'function') renderStepContent();
}
window._ajustarPrebatchInv = _ajustarPrebatchInv;

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
/* ── ¿Esta receta consume algo de ESTE inventario? ────────────────────────────
   El menú del Paso 3 listaba alimentos Y bebidas sin mirar el área: en un
   inventario de barra salían todos los platillos de cocina. La regla correcta no es
   "esconder los alimentos" —un platillo con vino SÍ descuenta de barra— sino
   mostrar la receta donde de verdad toca algo: si alguno de sus ingredientes es una
   fila de este inventario. Es exactamente la resolución que usa el consumo
   (id canónico), así que lo que se ve y lo que se descuenta coinciden. */
var _idsInvCache = null, _idsInvKey = '';
function _idsInvSet() {
    var key = (invActual && invActual.id || '') + '|' + filasCaptura.length;
    if (_idsInvCache && _idsInvKey === key) return _idsInvCache;
    var set = {};
    (filasCaptura || []).forEach(function (f) {
        if (!f || !f.insumoId) return;
        set[_canonInsumoId(f.insumoId) || f.insumoId] = 1;
        set[f.insumoId] = 1;
    });
    _idsInvCache = set; _idsInvKey = key;
    return set;
}
function _recetaTocaInv(r) {
    var set = _idsInvSet();
    return (r && r.ingredientes || []).some(function (ing) {
        var id = ing && ing.insumoId; if (!id) return false;
        return !!(set[id] || set[_canonInsumoId(id) || id]);
    });
}
/* A QUÉ INVENTARIO PERTENECE UNA RECETA.
   Manda su TIPO: una receta de bebidas es del inventario de barra y una de
   alimentos es del de cocina, por sí solas. Eso no se discute — un coctel no
   puede desaparecer del inventario de barra porque a uno de sus insumos (la
   canela, un jarabe) se le olvidó marcarle el área. Antes esa era la ÚNICA
   condición y por eso los cocteles se esfumaban sin explicación.
   "Tocar el inventario" queda como puerta EXTRA, no como requisito: así una
   receta de alimentos que usa un destilado también sale en barra. */
function _areaDeTipoReceta(tipo) {
    if (tipo === 'bebidas'   || tipo === 'sub-bebidas')   return 'barra';
    if (tipo === 'alimentos' || tipo === 'sub-alimentos') return 'cocina';
    return '';
}
function _recetaPerteneceInv(r) {
    if (!r) return false;
    var invA = ((invActual && invActual.area) || '').toString().trim().toLowerCase();
    if (!invA || invA === 'general') return true;           // inventario general: todas
    if (_areaDeTipoReceta(r.tipo) === invA) return true;    // su tipo la ancla aquí
    return _recetaTocaInv(r);                                // o usa insumos de esta área
}

/* POR QUÉ se ocultó una receta. No es lo mismo "usa insumos de la cocina"
   —correcto, ese coctel no se cuenta aquí— que "sus insumos no tienen ÁREA
   asignada", que es un hueco de captura: el insumo sin área nunca genera fila en
   ningún inventario, así que el coctel desaparece de todos y el aviso mandaba a
   buscar al lugar equivocado. Este devuelve los insumos culpables, por nombre. */
function _insumosSinAreaDe(r) {
    var out = [], cat = getInsumos() || [];
    (r && r.ingredientes || []).forEach(function (ing) {
        var id = ing && ing.insumoId; if (!id) return;
        var cid = _canonInsumoId(id) || id;
        var ins = cat.find(function (x) { return x && ((_canonInsumoId(x.id) || x.id) === cid); });
        if (ins && !((ins.area || '').toString().trim())) out.push(ins.nombre || '—');
    });
    return out;
}

var _menuVerTodas = false;
function toggleMenuVerTodas() { _menuVerTodas = !_menuVerTodas; renderStep3(); }
window.toggleMenuVerTodas = toggleMenuVerTodas;

/* Aviso accionable. La receta YA NO se esconde por esto, pero el hueco sigue
   costando: un insumo sin área no tiene fila en ningún inventario, así que lo que
   se vende de él no se le descuenta a nadie y su merma no aparece. Se nombra el
   insumo y las recetas que lo usan, para que se arregle en el catálogo. */
function _avisoSinArea(lista) {
    if (!lista || !lista.length) return '';
    var culpables = {}, recetas = {}, vistas = {};
    lista.forEach(function (r) {
        if (!r || vistas[r.id]) return;
        vistas[r.id] = 1;
        var sa = _insumosSinAreaDe(r);
        if (!sa.length) return;
        recetas[r.nombre || '—'] = 1;
        sa.forEach(function (n) { culpables[n] = 1; });
    });
    var nom = Object.keys(culpables), recs = Object.keys(recetas);
    if (!nom.length) return '';
    var insTxt = nom.slice(0, 8).map(etx).join(', ') + (nom.length > 8 ? ' y ' + (nom.length - 8) + ' más' : '');
    var recTxt = recs.slice(0, 4).map(etx).join(', ') + (recs.length > 4 ? '…' : '');
    return '<div style="margin:0 16px 10px;padding:10px 13px;border:1px solid rgba(245,200,66,.35);' +
        'background:rgba(245,200,66,.07);border-radius:9px;font-size:11.5px;color:var(--text-muted);line-height:1.6">' +
        '<b style="color:var(--accent)">Faltan áreas en el catálogo.</b> Estos insumos no tienen área asignada: ' +
        '<b style="color:var(--text)">' + insTxt + '</b>. No entran a NINGÚN inventario, así que lo que se venda ' +
        'de ellos no se le descuenta a nadie y su merma no va a aparecer. Los usa' +
        (recs.length !== 1 ? 'n' : '') + ': ' + recTxt + '. Asígnales área en Catálogo → Insumos.</div>';
}

function renderStep3Menu() {
    // Visibilidad (regla única, insumo-label.js): activa global + vive en la
    // sucursal + no pausada aquí. Sin sucursal activa → solo el status global.
    const _sucP3 = localStorage.getItem('etaax_sucursal_activa') || '';
    let recetas  = getRecetas().filter(r =>
        (r.tipo === 'alimentos' || r.tipo === 'bebidas') &&
        ((_sucP3 && typeof window._recetaActivaEnSuc === 'function')
            ? window._recetaActivaEnSuc(r, _sucP3)
            : r.status !== 'inactiva')
    );
    const vendidos = invActual?.cocktailsVendidos || {};
    // Las que YA tienen unidades capturadas se muestran siempre, toquen o no: si no,
    // lo registrado se volvería invisible y no habría cómo corregirlo.
    const _ocultas = _menuVerTodas ? [] : recetas.filter(r => !_recetaPerteneceInv(r) && !(parseFloat(vendidos[r.id]) || 0));
    if (_ocultas.length) {
        const _fuera = {};
        _ocultas.forEach(r => { _fuera[r.id] = 1; });
        recetas = recetas.filter(r => !_fuera[r.id]);
    }
    if (!recetas.length && !_menuVerTodas) {
        return `<div class="empty-state" style="padding:60px">
            <div class="empty-icon">📋</div>
            <div class="empty-title">Ninguna receta de esta área</div>
            <div class="empty-desc">Este inventario es de ${etx((invActual && invActual.area) || 'esta área')}: salen sus recetas (bebidas en barra, alimentos en cocina) y cualquier otra que use sus insumos.</div>
            <button class="btn-vista" style="margin-top:14px" onclick="toggleMenuVerTodas()">Ver todas las recetas</button>
        </div>`;
    }
    if (!recetas.length) {
        return `<div class="empty-state" style="padding:60px">
            <div class="empty-icon">📋</div>
            <div class="empty-title">Sin menú activo</div>
            <div class="empty-desc">Activa recetas en Administrativo → Menú</div>
        </div>`;
    }
    const grupos = {};
    recetas.forEach(r => {
        const g = r.grupo || (r.tipo === 'alimentos' ? 'Alimentos' : 'Bebidas');
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push(r);
    });
    const totalItems = recetas.reduce((s, r) => s + (parseFloat(vendidos[r.id]) || 0), 0);
    const resumenHtml = `<div style="padding:12px 16px 4px;display:flex;align-items:center;gap:12px">
        <span style="font-size:11px;color:var(--text-dim)">Total registrado:</span>
        <span id="step3MenuTotal" style="font-size:15px;font-weight:700;color:var(--green)">${totalItems} unidades</span>
    </div>
    ${(_ocultas.length || _menuVerTodas) ? `<div style="padding:0 16px 8px;font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>${_menuVerTodas ? 'Mostrando TODAS las recetas, incluidas las que no consumen de esta área.' : _ocultas.length + ' receta' + (_ocultas.length !== 1 ? 's' : '') + ' oculta' + (_ocultas.length !== 1 ? 's' : '') + ': no usan ningún insumo de esta área.'}</span>
        <button onclick="toggleMenuVerTodas()" style="background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:6px;padding:3px 9px;font-size:11px;cursor:pointer;font-family:inherit">${_menuVerTodas ? 'Ver solo las de esta área' : 'Ver todas'}</button>
    </div>` : ''}
    ${_avisoSinArea(recetas.concat(_ocultas))}
    `;
    const gruposHtml = Object.entries(grupos).map(([grp, items]) => `
        <div style="padding:0 16px 16px" data-menu-grupo>
            <div style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1.5px;
                color:var(--text-muted);padding:12px 0 8px;border-bottom:1px solid var(--border);margin-bottom:10px">
                ${grp}
            </div>
            <div class="step3-menu-grid step3-lista">
                ${items.map(r => _step3RecetaItemHTML(r, vendidos)).join('')}
            </div>
        </div>`).join('');
    return resumenHtml + gruposHtml;
}

// Costo de un ingrediente, calculado EN VIVO desde el costo actual del insumo
// (no el ing.costo guardado, que suele venir en 0/viejo).
function _costoIngrediente(ing) {
    var fila = filasCaptura.find(function(f){ return f.insumoId === ing.insumoId; });
    var ins = typeof window._insumoResolver === 'function' ? window._insumoResolver(ing.insumoId) : null;
    var porcion = EtaaxCore.porcionSubRecetaParaUnidad(ins, ing.unidad);
    if (!fila && porcion) return (parseFloat(ing.cantidad) || 0) * (parseFloat(porcion.costoUnitario) || parseFloat(porcion.precio) || 0);
    if (!fila) return parseFloat(ing.costo) || 0; // insumo fuera de la captura → respaldo
    var cc   = costoCopa(fila); // por copa (licor) / por base g-ml (alimento) / por pza
    var z = _normIngrediente(ing);
    if (z.unidad !== ing.unidad || z.cant !== (parseFloat(ing.cantidad) || 0))
        return cc * EtaaxCore.cantidadFilaInventario(z.cant, z.unidad, fila);
    var cant = parseFloat(ing.cantidad) || 0;
    var u    = (ing.unidad || '').toString().toUpperCase();
    if (fila.tipo === 'pza' || u === 'PZA' || u === 'PZ') return cc * cant;
    if (fila.tipo === 'peso') return cc * ingredienteBase(cant, ing.unidad);
    // licor: cantidad → ml, ÷ copaML = copas, × costo por copa
    var ml = ingredienteML(cant, ing.unidad);
    return fila.copaML > 0 ? (ml / fila.copaML) * cc : 0;
}
function _unidadIngredienteInv(ing) {
    var ins = typeof window._insumoResolver === 'function' ? window._insumoResolver(ing.insumoId) : null;
    var p = EtaaxCore.porcionSubRecetaParaUnidad(ins, ing.unidad);
    return p && String(ing.unidad).indexOf('RENDIMIENTO:') === 0 ? p.nombreRendimiento || 'Presentación' : ing.unidad || '';
}
// Ficha técnica de una receta (igual que en escandallos): ingredientes, costo, carta, margen.
function _frKpi(lbl, val, col) {
    return '<div style="flex:1;min-width:88px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px">'+
        '<div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">'+lbl+'</div>'+
        '<div style="font-size:16px;font-weight:700;color:'+col+';margin-top:2px">'+val+'</div></div>';
}
var _frRecetaId = null;
function verFichaReceta(recetaId, editar) {
    /* ══ LA FICHA Y EL CÁLCULO MIRABAN RECETAS DISTINTAS ═══════════════════
       Esto buscaba por id CRUDO, así que enseñaba el MAESTRO. Todo lo que
       calcula —el consumo por producción, el reparto del batch, el teórico—
       pasa por _recetaResolver, que devuelve la COPIA de la sucursal activa
       cuando existe.

       Con una copia editada, la ficha decía «lleva 1.75 LT de vodka» y el
       inventario descontaba otra cosa. Dos pantallas del mismo sistema
       contradiciéndose sobre el mismo platillo, y la que manda es la que NO se
       ve. Lo que se enseña tiene que ser lo que se descuenta. */
    var r = (window._recetaResolver ? window._recetaResolver(recetaId) : null) ||
            getRecetas().find(function(x){ return x.id === recetaId; });
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
                    : '<button class="btn-vista" title="Abre el escandallo de Recetas (pide contraseña)" onclick="_invEditarReceta(\''+recetaId+'\')">'+_icInv('rec-editar')+'Editar</button>')+
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
                    ? '<input id="frCant-'+i+'" type="number" min="0" step="any" value="'+(ing.cantidad||'')+'" style="'+inpSt+';width:62px;text-align:right"> '+etx(_unidadIngredienteInv(ing))
                    : (ing.cantidad||'')+' '+etx(_unidadIngredienteInv(ing));
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
    /* La MISMA que enseñó la ficha (ver verFichaReceta): si aquí se buscara por
       id crudo, se editaría la copia en pantalla y se guardaría sobre el
       maestro — o al revés. */
    var r = (window._recetaResolver ? window._recetaResolver(_frRecetaId) : null) ||
            getRecetas().find(function(x){ return x.id === _frRecetaId; });
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
        (f.cortesiaCopas||0)>0 || (f.mermaCopas||0)>0 || !!String(f.ventasComentario||'').trim()
    ).length;
    // A lo ancho y lo capturado en DOS columnas (Edwin, 19-nov): aprovechar la pantalla.
    return `<div class="ent-rapida-wrap ent-ancho s3-busq">
        <div>
            <!-- El buscador (insumos, cocteles y prebatch) va en la barra del paso. -->
            <div id="ventasChips" class="ent-chips"></div>
        </div>
        <div id="ventasCardWrap"></div>
        <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                <span style="font-size:11px;color:var(--text-dim);font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Ventas capturadas</span>
                <span id="ventasResumenCuenta" style="font-size:13px;font-weight:700;color:var(--text)">${conVentas} producto${conVentas!==1?'s':''}</span>
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
    /* También cocteles y prebatch, cada uno con su contador ahí mismo: buscar
       «negroni» encuentra el insumo, el coctel y el batch. */
    const recs = _recetasMenuPaso3().filter(r => String(r.nombre || '').toLowerCase().includes(q));
    const pbs  = prebatchesProducibles().filter(p => String(p.nombre || '').toLowerCase().includes(q));
    if (!matches.length && !recs.length && !pbs.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Sin resultados para "${etx(_ventasBusqueda)}"</div>`;
        return;
    }
    const _grp = (tit, html) => html ? `<div class="s3-res-grupo"><div class="s3-res-tit">${tit}</div>${html}</div>` : '';
    cont.innerHTML = _grp('🧴 Insumos', matches.length ? '<div class="ent-chips" style="margin:0">' + _chipsInsumosVentas(matches) + '</div>' : '') +
        _grp('🍹 Cocteles', recs.length ? '<div class="step3-menu-grid step3-lista">' + recs.map(r => _step3RecetaItemHTML(r, (invActual && invActual.cocktailsVendidos) || {})).join('') + '</div>' : '') +
        _grp('🏭 Prebatch', pbs.length ? '<div class="step3-menu-grid step3-lista">' + pbs.map(p => _step3PrebatchItemHTML(p, (invActual && invActual.prebatchProducidos) || {})).join('') + '</div>' : '');
}
/* Las recetas que el menú del Paso 3 ofrece (las activas en esta sucursal). */
function _recetasMenuPaso3() {
    const suc = localStorage.getItem('etaax_sucursal_activa') || '';
    return getRecetas().filter(r => (r.tipo === 'alimentos' || r.tipo === 'bebidas') &&
        ((suc && typeof window._recetaActivaEnSuc === 'function') ? window._recetaActivaEnSuc(r, suc) : r.status !== 'inactiva'));
}
function _chipsInsumosVentas(matches) {
    return matches.map(f => {
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
    const tipoSt = fila.tipo === 'pza'
        ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
        : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';
    const esCopa = fila.tipo !== 'pza';
    const SEL = "background:var(--surface);border:1px solid var(--border);color:var(--text-muted);border-radius:6px;padding:3px 6px;font-family:inherit;font-size:11px;margin-left:6px";
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
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">${_icInv('rec-ficha', 14)}Ver</button>
                    <button onclick="limpiarSeleccionVentas()"
                        style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:20px;padding:0;line-height:1">✕</button>
                </div>
            </div>

            <div class="s3c-tit">Ventas</div>
            <div class="s3c-fila">
                <div class="s3c-campo">
                    <div class="s3c-l"><span>Vendidas</span>${esCopa ? _selUM(idx, 'ventasCopasDirectas', SEL) : ''}</div>
                    ${_celdaS3('venta-copas-' + idx, idx, 'ventasCopasDirectas', _copAUm(fila, fila.ventasCopasDirectas, 'ventasCopasDirectas'),
                        `updVentasCalc(${idx},'ventasCopasDirectas',this);renderResumenVentas()`)}
                </div>
                ${esCopa ? `<div class="s3c-campo">
                    <label class="s3c-l" for="venta-bot-${idx}">Botellas vendidas</label>
                    ${_celdaS3('venta-bot-' + idx, idx, 'ventasBotella', fila.ventasBotella, `updVentasDirCalc(${idx},'ventasBotella',this);renderResumenVentas()`)}
                </div>` : ''}
                <div class="inv-sale-comment">
                    <label for="venta-comentario-${idx}">Comentarios de venta</label>
                    <input id="venta-comentario-${idx}" type="text" class="inv-num-input inv-comment-input"
                        value="${etx(fila.ventasComentario||'')}" placeholder="Ej. evento, mesa o aclaración…"
                        oninput="updVentasConcepto(${idx},'ventasComentario',this.value)">
                </div>
            </div>

            <div class="s3c-blq">
                <div class="s3c-tit">Cortesía y consumo interno</div>
                <div class="s3c-fila">
                    <div class="s3c-campo">
                        <div class="s3c-l"><span>Cantidad</span>${esCopa ? _selUM(idx, 'cortesiaCopas', SEL) : ''}</div>
                        ${_celdaS3('cort-cop-' + idx, idx, 'cortesiaCopas', _salidaCaptura(fila, 'cortesiaCopas'),
                            `updVentasCalc(${idx},'cortesiaCopas',this);renderResumenVentas()`, 'border-color:rgba(155,141,232,.5)')}
                    </div>
                    ${_inputSalidaBotella(idx, 'cortesiaCopas', false)}
                    ${_cortConceptoHTML(idx, 'cortesiaConcepto', fila.cortesiaConcepto)}
                </div>
                ${_cortesia2HTML(idx, false)}
            </div>

            <div class="s3c-blq">
                <div class="s3c-tit">Merma</div>
                <div class="s3c-fila">
                    <div class="s3c-campo">
                        <div class="s3c-l"><span>Cantidad</span>${esCopa ? _selUM(idx, 'mermaCopas', SEL) : ''}</div>
                        ${_celdaS3('merm-cop-' + idx, idx, 'mermaCopas', _salidaCaptura(fila, 'mermaCopas'),
                            `updVentasCalc(${idx},'mermaCopas',this);renderResumenVentas()`, 'border-color:rgba(224,90,58,.4)')}
                    </div>
                    ${_inputSalidaBotella(idx, 'mermaCopas', false)}
                    <div class="inv-sale-comment">
                        <label for="merma-concepto-${idx}">Concepto</label>
                        <input id="merma-concepto-${idx}" type="text" class="inv-num-input inv-comment-input"
                            style="border-color:rgba(224,90,58,.4)"
                            value="${etx(fila.mermaConcepto||'')}" placeholder="ej. derrame, rotura…"
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
        (f.cortesiaCopas||0)>0 || (f.mermaCopas||0)>0 || !!String(f.ventasComentario||'').trim()
    );
    const todos = conVentas;
    const cuenta = document.getElementById('ventasResumenCuenta');
    if (cuenta) cuenta.textContent = todos.length + ' producto' + (todos.length === 1 ? '' : 's');
    if (!todos.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:20px 0">Sin ventas capturadas aún</div>`;
        return;
    }
    cont.innerHTML = todos.map(fila => {
        const esComp = !!fila.esCompuesto;
        const unidad = esComp ? (fila.tipo==='pza'?'pza':'cop') : _umCapLbl(fila);
        const _u = (v, c) => Number((esComp ? (parseFloat(v)||0) : (_copAUm(fila, v, c)||0)).toFixed(4));
        const _lb = c => esComp ? unidad : _umCapLbl(fila, false, c);
        const partes = [];
        if ((fila.ventasCopasDirectas||0)>0)  partes.push(`${_u(fila.ventasCopasDirectas,'ventasCopasDirectas')} ${_lb('ventasCopasDirectas')}`);
        if (!esComp && (fila.ventasBotella||0)>0) partes.push(`${fila.ventasBotella} bot`);
        // Cada parte de la cortesía con SU concepto (23-nov).
        const _cc = (t, def) => { t = String(t || '').trim(); return (t && t.length <= 28 && !/[\u{1F300}-\u{1FAFF}]/u.test(t)) ? t.toLowerCase() : def; };
        const _c1 = _cc(fila.cortesiaConcepto, 'cortesía'), _c2 = _cc(fila.cortesia2Concepto, 'otro concepto');
        if (_salidaSuelta(fila,'cortesiaCopas')>0) partes.push(`${_u(_salidaSuelta(fila,'cortesiaCopas'),'cortesiaCopas')} ${_lb('cortesiaCopas')} ${etx(_c1)}`);
        if ((fila.cortesiaBotella||0)>0) partes.push(`${fila.cortesiaBotella} bot ${etx(_c1)}`);
        if ((parseFloat(fila.cortesia2Copas)||0)>0) partes.push(`${_u(fila.cortesia2Copas,'cortesiaCopas')} ${_lb('cortesiaCopas')} ${etx(_c2)}`);
        if ((parseFloat(fila.cortesia2Botella)||0)>0) partes.push(`${fila.cortesia2Botella} bot ${etx(_c2)}`);
        if (_salidaSuelta(fila,'mermaCopas')>0) partes.push(`${_u(_salidaSuelta(fila,'mermaCopas'),'mermaCopas')} ${_lb('mermaCopas')} merma`);
        if ((fila.mermaBotella||0)>0) partes.push(`${fila.mermaBotella} bot merma`);
        return `<div class="ent-log-fila" onclick="seleccionarProductoVentas('${fila.insumoId}')" style="cursor:pointer">
            <span class="ent-log-nombre">${esComp ? '🧩 ' + etx(fila.nombre) : etx(insumoTitulo(fila))}${_comentarioVentaHTML(fila)}</span>
            <span class="ent-log-cant" style="color:var(--accent)">${partes.join(' · ')}</span>
        </div>`;
    }).join('');
}

function updCoctelVendido(id, val) {
    if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
    invActual.cocktailsVendidos[id] = val; _consumoDirty = true; window._step5Dirty = true;
}
// Los lectores de existencias, prebatch y reportes siguen leyendo un único total
// en copas. La captura separa botellas y sueltos sin descontar dos veces la salida.
function _camposSalida(campo) {
    var p = campo === 'mermaCopas' || campo === 'mermaBotella' ? 'merma' : 'cortesia';
    return { total:p+'Copas', manual:p+'Manual', botella:p+'Botella', previo:'_'+p+'BotCopas', qr:p === 'merma' ? '_qrMerma' : '_qrCort', c2:p === 'cortesia' };
}
/* ══ LA CORTESÍA EN DOS CONCEPTOS (Edwin, 23-nov) ═══════════════════════════
   En el mismo renglón: 56 de cortesía y 6 de consumo interno (o producción del
   restaurante, consumo personal…). Los dos SALEN del inventario, cada uno con
   su concepto y su cantidad.

   `cortesiaCopas` sigue siendo el TOTAL: es lo que leen el teórico, el
   Resultado, los reportes y el candado, y así ninguna fórmula cambia. El
   segundo concepto es una PARTE de ese total (cortesia2Copas sueltas +
   cortesia2Botella), y `_c2Previo` guarda cuánto se le sumó la última vez
   —igual que `_cortesiaBotCopas` con las botellas— para que cambiar el
   contenido o la copa del insumo no lo cuente dos veces. */
function _c2Copas(f) {
    if (!f || f.tipo === 'peso') return 0;
    return Math.max(0, parseFloat(f.cortesia2Copas) || 0) + _salidaBotellasCopas(f, f.cortesia2Botella);
}
function _c2Previo(f) { return (f && f._c2Previo !== undefined) ? (parseFloat(f._c2Previo) || 0) : _c2Copas(f); }
function _salidaBotellasCopas(f, cantidad) {
    return f.tipo === 'copa' ? EtaaxCore.cantidadFilaInventario(Math.max(0, parseFloat(cantidad)||0), 'PZA', f) : 0;
}
function _aporteBotellaAnterior(f, k) {
    return f[k.previo] !== undefined ? (parseFloat(f[k.previo])||0) : _salidaBotellasCopas(f, f[k.botella]);
}
function _salidaSuelta(f, campo) {
    var k = _camposSalida(campo);
    return Math.max(0, (parseFloat(f[k.total])||0) - _aporteBotellaAnterior(f, k) - (k.c2 ? _c2Previo(f) : 0));
}
function _salidaCaptura(f, campo) {
    // Solo presentación: evita 3.0000000000000036 después de separar la botella.
    return Number(_copAUm(f, _salidaSuelta(f, campo), campo).toFixed(6));
}
function _actualizarSalida(f, campo, cambio) {
    var k = _camposSalida(campo), qr = parseFloat(f[k.qr])||0;
    var previoQR = cambio.qrAnterior !== undefined ? cambio.qrAnterior : qr;
    var manual = Math.max(0, _salidaSuelta(f, campo) - previoQR);
    if (cambio.qr !== undefined) qr = cambio.qr;
    if (cambio.sueltas !== undefined) manual = Math.max(0, cambio.sueltas - qr);
    if (cambio.botellas !== undefined) f[k.botella] = Math.max(0, parseFloat(cambio.botellas)||0);
    var botCopas = _salidaBotellasCopas(f, f[k.botella]);
    var c2 = k.c2 ? _c2Copas(f) : 0;                  // el segundo concepto de la cortesía (parte del total)
    f[k.manual] = manual;
    f[k.qr] = qr;
    f[k.previo] = botCopas;
    if (k.c2) f._c2Previo = c2;
    f[k.total] = manual + qr + botCopas + c2;
}
// Captura del segundo concepto: sueltas (ya en copas) o botellas completas.
function updCortesia2(idx, campo, val) {
    var f = filasCaptura[idx]; if (!f || f.tipo === 'peso') return;
    if (campo === 'cortesia2Botella' && (f.tipo !== 'copa' || !(f.contNeto > 0 && f.copaML > 0))) return;
    f[campo] = (val === '' || val == null) ? '' : Math.max(0, parseFloat(val) || 0);
    _actualizarSalida(f, 'cortesiaCopas', {});
    _autoGuardar();
}
function _inputSalidaBotella(idx, campo, compacto) {
    var f = filasCaptura[idx];
    if (!f || f.tipo !== 'copa') return '';
    var k = _camposSalida(campo), valida = f.contNeto > 0 && f.copaML > 0;
    var id = k.botella + '-' + idx, color = campo === 'mermaCopas' ? 'rgba(224,90,58,.4)' : 'rgba(155,141,232,.5)';
    // Como Excel (23-nov): la operación se queda, «= n» abajo y «+»/«−» al lado.
    return `<div class="inv-bottle-out${compacto ? ' is-compact' : ''}">
        <label for="${id}">Botellas${compacto ? '' : ' de ' + (campo === 'mermaCopas' ? 'merma' : 'cortesía')}</label>
        ${valida ? _celdaS3(id, idx, k.botella, f[k.botella], `updVentasDirCalc(${idx},'${k.botella}',this);renderResumenVentas()`, 'border-color:' + color, compacto)
            : `<input id="${id}" type="text" class="inv-num-input" value="${etx(f[k.botella]||'')}" placeholder="—" style="border-color:${color}" disabled title="Define contenido y tamaño de copa en el insumo">`}
        ${valida ? '' : '<small>Falta contenido o tamaño de copa</small>'}
    </div>`;
}
function _comentarioVentaHTML(f, papel) {
    return f.ventasComentario ? '<span class="inv-sale-note"' + (papel ? ' style="display:block;font-size:9px;font-weight:400;color:#555;white-space:normal;overflow-wrap:anywhere;margin-top:3px"' : '') + '>Venta: ' + etx(f.ventasComentario) + '</span>' : '';
}
function updVentasDirectas(idx, campo, val) {
    var f = filasCaptura[idx]; if (!f) return;
    if (campo === 'mermaCopas' || campo === 'cortesiaCopas') {
        _actualizarSalida(f, campo, { sueltas:parseFloat(val)||0 });
    } else if (campo === 'mermaBotella' || campo === 'cortesiaBotella') {
        if (f.tipo !== 'copa' || !(f.contNeto > 0 && f.copaML > 0)) return;
        _actualizarSalida(f, campo, { botellas:val });
    } else {
        f[campo] = val;
    }
    _autoGuardar();
}
function updVentasConcepto(idx, campo, val) { filasCaptura[idx][campo] = val; _autoGuardar(); renderResumenVentas(); }

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

    void tabBar;   // las pestañas van en la barra del paso (encabezado fijo)
    return '<div style="padding-top:4px"></div>' + (_paso4Tab === 'cancelaciones'
        ? _renderCancelacionesTab(cancelaciones)
        : _renderDescuentosTab(descuentos, totalDesc));
}

function _renderCancelacionesTab(cancelaciones) {
    // Run auto-match on cancelaciones that haven't been matched yet
    _autoMatchCancelaciones();
    const noMatch = cancelaciones.filter(c => !c.insumoId && !c.recetaId).length;
    const tabla = cancelaciones.length ? `<div class="tabla-wrap" style="overflow-x:auto"><table style="min-width:820px">
        <thead><tr>
            <th style="width:110px">Fecha / Hora</th>
            <th>Producto POS</th>
            <th style="width:55px;text-align:center">Cant.</th>
            <th style="width:175px">Detectado</th>
            <th>Motivo</th>
            <th style="width:80px">Mesero</th>
            <th style="width:28px"></th>
        </tr></thead>
        <tbody>${cancelaciones.map((c,i)=>{
            // La asociación es informativa; conserva el producto original del POS.
            const esRec  = !!c.recetaId;
            const nombre = esRec ? (c.recetaNombre || '—') : (c.insumoNombre || '—');
            const badge = (esRec || c.insumoId)
                ? `<span style="display:inline-flex;align-items:center;gap:4px;
                    background:${esRec ? 'rgba(122,184,245,.12)' : 'rgba(61,190,122,.12)'};
                    border:1px solid ${esRec ? 'rgba(122,184,245,.45)' : 'rgba(61,190,122,.4)'};
                    color:${esRec ? '#7ab8f5' : 'var(--green)'};border-radius:6px;
                    padding:2px 8px;font-size:11px;font-weight:600;max-width:100%;overflow:hidden;
                    text-overflow:ellipsis;white-space:nowrap"
                    title="${etx(nombre)} — referencia informativa">
                    ${esRec ? '🍸' : '✓'} ${etx(nombre)}</span>`
                : `<span style="background:rgba(245,200,66,.12);border:1px solid rgba(245,200,66,.4);
                    color:var(--accent);border-radius:6px;padding:2px 8px;font-size:11px">
                    ⚠ Sin match</span>`;
            return `<tr>
                <td style="font-size:11px;color:var(--text-dim);white-space:nowrap">${etx(c.fechaHora||'—')}</td>
                <td style="font-size:12px;font-weight:500">${etx(c.nombreProducto||'—')}</td>
                <td style="text-align:center;font-weight:600">${c.cantidad||'—'}</td>
                <td>
                    <div style="display:flex;flex-direction:column;gap:4px">
                        ${badge}
                        <button type="button" class="btn-vista cancel-match-trigger" data-cancel-match="${i}"
                            onclick="abrirMatchCancelacion(${i},this)">Buscar / cambiar match</button>
                    </div>
                </td>
                <td style="color:var(--text-dim);font-size:11px">${etx(c.motivo||'—')}</td>
                <td style="color:var(--text-dim);font-size:11px">${etx(c.mesero||'—')}</td>
                <td><button class="btn-vista" style="padding:3px 8px;font-size:10px;color:var(--red);border-color:var(--red)"
                    onclick="eliminarCancelacion(${i})">🗑️</button></td>
            </tr>`;
        }).join('')}</tbody>
    </table></div>` : `<div class="empty-state" style="padding:40px">
        <div class="empty-icon">🚫</div><div class="empty-title">Sin cancelaciones</div>
        <div class="empty-desc">Agrega manualmente o importa desde tu POS</div></div>`;

    return `
    <p class="cancel-info-note">Las cancelaciones del POS son informativas: no descuentan existencias ni afectan consumo, faltantes o sobrantes. Si hubo una salida real, regístrala como merma o cortesía.</p>
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
                    onclick="_reDetectarCancelaciones()" title="Conserva las selecciones manuales, incluido Sin match">🔍 Re-detectar automáticos</button>
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
    _aplicarMatchCancel(entrada, _matchCancelacion(nombreProducto));
    invActual.cancelaciones.push(entrada);
    window._step5Dirty = true;
    _autoGuardar(); renderStepContent();
}

function eliminarCancelacion(idx) {
    _pedirClaveAdmin('Eliminar cancelación', function() {
        if (invActual?.cancelaciones) {
            invActual.cancelaciones.splice(idx,1);
            _autoMatchFirma = ''; window._step5Dirty = true;
            _autoGuardar(); renderStepContent();
        }
    });
}

// POS column normalizer
function _normCol(s) { return (s||'').toString().toLowerCase().replace(/[\s_áéíóúüñ]/g, c =>
    ({' ':'','_':'','á':'a','é':'e','í':'i','ó':'o','ú':'u','ü':'u','ñ':'n'}[c]||c)); }

/* ¿La primera fila es un encabezado aunque no reconozcamos sus palabras?
   La señal: no trae NINGÚN número y alguna fila de abajo sí. Un renglón de
   cancelación siempre trae una cantidad; un encabezado nunca.

   Sin esto, un POS que rotule sus columnas «Momento / Artículo / Piezas» caía
   en el saco de «sin encabezado» y la fila de rótulos se colaba como una
   cancelación más: un producto llamado «Artículo», cantidad 1. */
function _pareceEncabezado(rows) {
    if (rows.length < 2) return false;
    const _num = (c) => /\d/.test(String(c == null ? '' : c));
    if (rows[0].some(_num)) return false;
    return rows.slice(1).some(r => (r || []).some(_num));
}

function _mapPOSCancelaciones(rows) {
    if (!rows.length) return [];
    const firstNorm = rows[0].map(_normCol);
    const POS_KEYS = ['seriefolio','numcheque','idmesero','mesero','comanda','cantidad','descripcion','razon','fecha','nombre','usuario'];
    /* Dos preguntas distintas que antes eran una sola: si la primera fila SE TIRA
       y si sus nombres sirven para mapear. Un encabezado con palabras que no
       conocemos se tira igual —no es un dato— pero el mapeo cae a posición, que
       es lo mismo que hacía antes y por lo menos acierta cuando el orden
       coincide. Juntas, un encabezado desconocido se colaba como dato. */
    const conNombres = firstNorm.some(h => POS_KEYS.some(k => h.includes(k)));
    const dataRows = (conNombres || _pareceEncabezado(rows)) ? rows.slice(1) : rows;
    let colMap = null;
    if (conNombres) {
        colMap = {};
        firstNorm.forEach((h, i) => { colMap[h] = i; });
    }
    /* `excluir` evita que una columna se cuele en el campo equivocado. El caso
       real: buscando quién autorizó se pregunta por «nombre», y un encabezado
       «Nombre del producto» lo contiene — así que el nombre del cóctel acababa
       en «Autorizó» («NEGRONI / TOMAS»). El producto tiene su propia columna. */
    const g = (cols, keys, excluir) => {
        if (!colMap) return undefined;
        for (const k of keys) {
            const idx = Object.keys(colMap).find(h =>
                h.includes(_normCol(k)) &&
                !(excluir || []).some(x => h.includes(_normCol(x))));
            if (idx !== undefined && cols[colMap[idx]] != null) return (cols[colMap[idx]]||'').toString().trim();
        }
        return '';
    };
    return dataRows.map(cols => {
        if (!cols || cols.every(c => !c)) return null;
        let rec;
        if (colMap) {
            const DEL_PRODUCTO = ['producto', 'descripcion', 'articulo', 'platillo'];
            const fechaHora      = g(cols, ['fecha']);
            const nombreProducto = g(cols, ['descripcion', 'producto', 'articulo']);
            const cantidad       = parseFloat(g(cols, ['cantidad', 'qty']) || '1') || 1;
            const autorizo       = [g(cols, ['autorizo']),
                                    g(cols, ['nombre'], DEL_PRODUCTO),
                                    g(cols, ['usuario'])].filter(Boolean).join(' / ') || '';
            const motivo         = g(cols, ['razon', 'motivo']);
            const mesero         = g(cols, ['mesero']);
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
        _aplicarMatchCancel(entrada, _matchCancelacion(nombreProducto));
        toAdd.push(entrada);
    });
    if (!toAdd.length) { alert('Sin datos válidos. Ingresa productos en la columna Producto.'); return; }
    if (!invActual.cancelaciones) invActual.cancelaciones = [];
    invActual.cancelaciones.push(...toAdd);
    window._step5Dirty = true;
    _autoGuardar(); renderStepContent();
}

function _reDetectarCancelaciones() {
    (invActual?.cancelaciones || []).forEach(c => {
        if (!c.matchManual) _aplicarMatchCancel(c, _matchCancelacion(c.nombreProducto));
    });
    _autoMatchFirma = '';   // se rehízo todo: que la guarda no crea que ya estaba
    window._step5Dirty = true;
    _autoGuardar(); renderStepContent();
}

/* El valor del selector trae de qué lista salió: `r:<id>` una receta, el id
   pelón un insumo. Sin el prefijo no se podrían distinguir — un insumo y una
   receta pueden tener el mismo id si uno se convirtió del otro. */
function _setCancelInsumo(idx, valor) {
    const c = invActual?.cancelaciones?.[idx];
    if (!c || window._soloVistaInv) return;
    let match = null;
    if (valor && valor.indexOf('r:') === 0) {
        const r = _recetasCancelables().find(x => x.id === valor.slice(2));
        if (!r) return;
        match = { tipo:'receta', id:r.id, nombre:r.nombre };
    } else if (valor) {
        const fila = filasCaptura.find(f => f.insumoId === valor);
        if (!fila) return;
        match = { tipo:'insumo', id:valor, nombre:fila.nombre };
    }
    _aplicarMatchCancel(c, match);
    c.matchManual = true; // incluye Sin match: sobrevive guardado, recarga y re-detección.
    _guardarMatchCancelacion();
}

/* El POS conserva su nombre original. El match solo añade una referencia
   informativa; una selección manual, incluso «Sin match», no se re-detecta. */
var _cancelMatchEdicion = null;
function _opcionesCancelMatch(busqueda) {
    const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const palabras = norm(busqueda).trim().split(/\s+/).filter(Boolean);
    const opciones = _recetasCancelables().map(r => ({
        valor:'r:' + r.id, nombre:r.nombre || 'Sin nombre', grupo:'Carta (cócteles y platillos)',
        detalle:r.tipo === 'alimentos' ? 'Platillo' : 'Cóctel'
    })).concat(filasCaptura.map(f => ({
        valor:f.insumoId, nombre:insumoEtiqueta(f), grupo:'Insumos del inventario', detalle:f.categoria || 'Insumo'
    })));
    return opciones.filter(o => palabras.every(p => norm(o.nombre + ' ' + o.detalle).includes(p)))
        .sort((a,b) => a.grupo.localeCompare(b.grupo, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}
function abrirMatchCancelacion(idx, boton) {
    const c = invActual?.cancelaciones?.[idx];
    if (!c || window._soloVistaInv) return;
    cerrarMatchCancelacion();
    _cancelMatchEdicion = { inventario:invActual, cancelacion:c, boton:boton };
    const ov = document.createElement('div');
    ov.id = 'cancelMatchOverlay'; ov.className = 'cancel-match-overlay';
    ov.innerHTML = `<section class="cancel-match-dialog" role="dialog" aria-modal="true" aria-labelledby="cancelMatchTitulo">
        <header class="cancel-match-header">
            <div><h2 id="cancelMatchTitulo">Relacionar cancelación</h2><p>${etx(c.nombreProducto || 'Producto POS')}</p></div>
            <button type="button" class="btn-vista" onclick="cerrarMatchCancelacion()" aria-label="Cerrar selector">✕ Cerrar</button>
        </header>
        <div class="cancel-match-tools">
            <label for="cancelMatchBusca">Buscar receta o insumo</label>
            <input id="cancelMatchBusca" type="search" placeholder="Nombre, variedad o categoría…" autocomplete="off" oninput="_renderCancelMatch(this.value)">
            <button type="button" class="cancel-match-option cancel-match-none" onclick="_elegirCancelMatch('')">
                <strong>Sin match</strong><span>Conservar solo el dato del POS, sin asociarlo a un producto.</span>
            </button>
            <p class="cancel-match-help">Insumo: aparece en su fila. Receta: solo en el informe de cancelaciones. No modifica existencias, consumo ni diferencias.</p>
        </div>
        <div id="cancelMatchResultados" class="cancel-match-results" aria-live="polite"></div>
        <footer class="cancel-match-footer"><button type="button" class="btn-vista" onclick="_elegirCancelMatch('',true)">Detectar automáticamente</button></footer>
    </section>`;
    ov.addEventListener('click', e => { if (e.target === ov) cerrarMatchCancelacion(); });
    ov.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarMatchCancelacion(); }
        if (e.key === 'Tab') {
            const campos = Array.from(ov.querySelectorAll('button:not([disabled]), input'));
            const primero = campos[0], ultimo = campos[campos.length - 1];
            if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
            else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
        }
    });
    document.body.appendChild(ov);
    _renderCancelMatch('');
    document.getElementById('cancelMatchBusca').focus();
}
function cerrarMatchCancelacion() {
    const boton = _cancelMatchEdicion && _cancelMatchEdicion.boton;
    document.getElementById('cancelMatchOverlay')?.remove();
    _cancelMatchEdicion = null;
    if (boton && boton.isConnected) boton.focus();
}
function _renderCancelMatch(busqueda) {
    const el = document.getElementById('cancelMatchResultados');
    if (!el || !_cancelMatchEdicion) return;
    const opciones = _opcionesCancelMatch(busqueda);
    const c = _cancelMatchEdicion.cancelacion;
    const actual = c.recetaId ? 'r:' + c.recetaId : c.insumoId;
    let grupo = '';
    el.innerHTML = opciones.length ? opciones.map(o => {
        const titulo = o.grupo !== grupo ? `<h3>${etx(o.grupo)}</h3>` : '';
        grupo = o.grupo;
        return titulo + `<button type="button" class="cancel-match-option${o.valor === actual ? ' is-selected' : ''}"
            data-valor="${etx(o.valor)}" onclick="_elegirCancelMatch(this.dataset.valor)">
            <strong>${etx(o.nombre)}</strong><span>${etx(o.detalle)}${o.valor === actual ? ' · Selección actual' : ''}</span></button>`;
    }).join('') : '<p class="cancel-match-empty">Sin resultados. Prueba otro nombre o elige «Sin match».</p>';
}
function _elegirCancelMatch(valor, automatico) {
    const ed = _cancelMatchEdicion;
    const idx = ed && invActual === ed.inventario ? (invActual.cancelaciones || []).indexOf(ed.cancelacion) : -1;
    cerrarMatchCancelacion();
    if (idx < 0 || window._soloVistaInv) return;
    if (automatico) {
        ed.cancelacion.matchManual = false;
        _aplicarMatchCancel(ed.cancelacion, _matchCancelacion(ed.cancelacion.nombreProducto));
        _guardarMatchCancelacion();
    } else _setCancelInsumo(idx, valor);
    const boton = document.querySelector('[data-cancel-match="' + idx + '"]');
    if (boton) boton.focus();
}
function _guardarMatchCancelacion() {
    _autoMatchFirma = '';
    window._step5Dirty = true;
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

/* ── LIBRERÍAS PESADAS, SOLO CUANDO SE USAN ────────────────────────────────
   XLSX pesa 861 KB y PDF.js 312 KB. Estaban en el <head> de inventarios.html,
   así que la página bajaba 1.17 MB —bloqueando el pintado— en CADA visita, para
   dos botones de importar que se usan de vez en cuando. Medido: era más de la
   mitad del peso de la página.

   Ahora se piden al elegir el archivo. La primera importación espera la descarga;
   la segunda ya no, porque la promesa se guarda. Y quien nunca importa no paga. */
var _libs = {};
function _cargarLib(url, global) {
    if (window[global]) return Promise.resolve(window[global]);
    if (_libs[url]) return _libs[url];
    _libs[url] = new Promise(function(resolve, reject){
        var sc = document.createElement('script');
        sc.src = url;
        sc.onload  = function(){ resolve(window[global]); };
        // Se borra la promesa fallida: si no, un corte de red dejaba la página sin
        // poder importar nunca más, ni reintentando.
        sc.onerror = function(){ delete _libs[url]; reject(new Error('no se pudo descargar')); };
        document.head.appendChild(sc);
    });
    return _libs[url];
}
function _cargarXLSX() {
    return _cargarLib('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX');
}
function _cargarPDFJS() {
    return _cargarLib('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', 'pdfjsLib')
        .then(function(lib){
            // El worker se configura al tener la librería (antes se hacía en el
            // <head>, cuando ya estaba cargada por fuerza).
            if (lib && lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
                lib.GlobalWorkerOptions.workerSrc =
                    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
            }
            return lib;
        });
}
/* Aviso mientras baja: sin esto, elegir un archivo en una tablet lenta parece
   que no hizo nada y el usuario vuelve a picarle. */
function _libAviso(txt) {
    var el = document.getElementById('_libAviso');
    if (!txt) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = '_libAviso';
        el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:99999;'+
            'background:var(--surface2,#222);color:var(--text,#eee);border:1px solid var(--border,#444);'+
            'border-radius:10px;padding:10px 16px;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.4)';
        document.body.appendChild(el);
    }
    el.textContent = txt;
}
/* Envoltura común: avisa, descarga, y si falla lo dice con su motivo. */
async function _conLib(cargar, nombre, fn) {
    try {
        _libAviso('Preparando el lector de ' + nombre + '…');
        await cargar();
    } catch (e) {
        _libAviso('');
        alert('No se pudo cargar el lector de ' + nombre + '. Revisa tu conexión e inténtalo de nuevo.');
        return false;
    }
    _libAviso('');
    return fn ? fn() : true;
}

function importarXLSXCancelaciones(event) {
    const file = event.target.files[0]; if (!file) return;
    event.target.value = '';
    _conLib(_cargarXLSX, 'Excel', function(){
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
    });
}

async function importarPDFCancelaciones(event) {
    const file = event.target.files[0]; if (!file) return;
    event.target.value = '';
    if (!(await _conLib(_cargarPDFJS, 'PDF'))) return;
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
    // Mismo criterio que en cancelaciones: tirar la primera fila y mapear por
    // nombre son dos decisiones distintas (ver _pareceEncabezado).
    const conNombres = firstNorm.some(h => POS_KEYS.some(k => h.includes(k)));
    const dataRows = (conNombres || _pareceEncabezado(rows)) ? rows.slice(1) : rows;
    let colMap = null;
    if (conNombres) {
        colMap = {};
        firstNorm.forEach((h, i) => { colMap[h] = i; });
    }
    const g = (cols, keys, excluir) => {
        if (!colMap) return undefined;
        for (const k of keys) {
            const idx = Object.keys(colMap).find(h =>
                h.includes(_normCol(k)) &&
                !(excluir || []).some(x => h.includes(_normCol(x))));
            if (idx !== undefined && cols[colMap[idx]] != null) return (cols[colMap[idx]]||'').toString().trim().replace('$','');
        }
        return '';
    };
    return dataRows.map(cols => {
        if (!cols || cols.every(c => !c)) return null;
        let rec;
        if (colMap) {
            /* «Descuento» a secas puede ser el porcentaje O el monto según el
               POS, así que el porcentaje no se lo queda si la columna habla de
               dinero — y al revés. Sin esto, $160 de descuento entraban como
               160 por ciento. */
            const fechaHora  = g(cols, ['fecha']);
            const porcentaje = parseFloat(g(cols, ['porcentaje', 'percent', 'descuento', 'disc'],
                                              ['monto', 'importe', 'total']) || '0') || 0;
            const monto      = parseFloat(g(cols, ['monto', 'importe', 'amount']) || '0') || 0;
            const folio      = g(cols, ['folio', 'cuenta', 'cheque', 'ticket']);
            const motivo     = g(cols, ['motivo', 'razon', 'concepto']);
            const autorizo   = [g(cols, ['autorizo']),
                                g(cols, ['nombre'], ['producto', 'descripcion', 'articulo', 'cliente']),
                                g(cols, ['usuario'])].filter(Boolean).join(' / ') || '';
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
    _conLib(_cargarXLSX, 'Excel', function(){
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
    });
}

async function importarPDFDescuentos(event) {
    const file = event.target.files[0]; if (!file) return;
    event.target.value = '';
    if (!(await _conLib(_cargarPDFJS, 'PDF'))) return;
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
    if (f.tipo === 'peso') return _consumoRecetasBase(f.insumoId);
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
/* BASE DEL % DE VARIANZA = TODO el uso del insumo, no solo lo que se cobró.
   El Vodka American lo dejaba claro: 22.2 copas vendidas y 88.9 que se fueron a
   producir batches. Midiendo la varianza de 10.6 copas contra las 22.2 salía 47.8%
   —un semáforo en rojo por un producto que en realidad movió 111 copas— cuando
   contra el uso completo es ~9.5%. La varianza sale de manipular producto, así que
   se mide contra todo el producto manipulado: botella, copa, pieza, coctelería y
   producción de batches.
   `prodMat > 0` significa que esa producción YA viene sumada dentro de `ventas`
   (el batch no se está repartiendo); ahí no se vuelve a sumar. */
function _usoTotal(ventas, prodVer, prodMat) {
    return (parseFloat(ventas) || 0) + (prodMat > 0 ? 0 : (parseFloat(prodVer) || 0));
}
// ── FASE 1 — Resumen ejecutivo del inventario (faltantes/sobrantes, merma,
//    vendidos por categoría, usados/sin usar, vendido vs compras) ──
function _resumenEjecutivo() {
    // Fresco: la diferencia de cada insumo lleva su parte en prebatch (total contra total).
    _repCache = _repartoPrebatch();
    var faltU=0, sobrU=0, faltCosto=0, sobrCosto=0, faltCarta=0, sobrCarta=0;
    /* ══ LA PANTALLA Y EL IMPRESO DABAN NÚMEROS DISTINTOS ═════════════════
       Y los dos tenían razón: la pantalla enseña TODO y el impreso deja fuera
       lo que se apartó a mano. Edwin sacó el vodka fantasma —−$1,405— y el
       Resultado decía +$643 mientras el reporte decía +$2,048.

       Dos cifras para lo mismo, sin una línea que lo explique, es un error
       aparente. Se calcula también el total del IMPRESO y se dice al lado. */
    var faltCartaImp = 0, sobrCartaImp = 0, ocultosN = 0;
    var faltCostoImp = 0, sobrCostoImp = 0;   // lo mismo a precio proveedor
    var mermados=[], mermaCosto=0, usados=0, sinUsar=0, sinUsarLista=[], vendidoCosto=0;
    var _mapaRE = _compDeInsumo();
    _repCache = _repartoPrebatch(); // reparto prebatch→insumos (resumen ejecutivo)
    /* Miembros de un compuesto: NO se evalúan sueltos para el CONSUMO (su venta va al
       compuesto) → evita falsos faltantes. Pero para el DINERO sí cuentan uno por uno.

       Regla de Edwin: el compuesto es la SUMA SIMPLE de los insumos que incluye, y
       cada uno entra con SU precio. La fila virtual del compuesto usa el precio de
       carta de su PRIMERA presentación para toda la diferencia, así que valuar ahí
       daba otro número — de ahí que el Resultado y el reporte directivo no cuadraran
       ($12,205 contra $12,919 con las mismas existencias). Ahora los dos suman los
       miembros con su propio precio y dan lo mismo. */
    filasCaptura.filter(function(f){ return !_mapaRE[f.insumoId]; }).concat(_compuestosActivos().map(_virtualFilaCompuesto)).forEach(function(f){
        /* El batch (repartido o de consumo) no tiene resultado ni uso propio:
           es un puente. Ni faltante, ni sobrante, ni «sin usar». */
        var _esPBr = !f.esCompuesto && (_esPrebatchRepartido(f.insumoId) || _esBatchFila(f));
        var _aR = (_esPBr || f.esCompuesto) ? _repZero : _repartoDe(f.insumoId);
        var cc = costoCopa(f), dif = _esPBr ? 0 : (calcDiferencia(f) + _aR.dif + _difEnBatches(f.insumoId)); // total contra total
        if (f.esCompuesto) {
            // El dinero del compuesto sale de sus miembros, no de la fila agregada.
            var _comp = getCompuestos().find(function(x){ return x.id === f.compId; });
            ((_comp && _comp.miembros) || []).forEach(function(mid){
                var m = _filaDeMiembro(mid); if (!m) return;
                var mAj = _repartoDe(m.insumoId);
                var mDif = calcDiferencia(m) + mAj.dif + _difEnBatches(m.insumoId), mCc = costoCopa(m);
                /* Un miembro se aparta por su propio renglón o por el de su
                   compuesto: en la tabla se ve dentro del compuesto, así que
                   ocultar el compuesto tiene que llevárselos a todos. */
                var mFuera = esOcultoImpreso(m.insumoId) || esOcultoImpreso(f.compId || f.insumoId);
                if (mDif < -0.001) { faltU++; faltCosto += Math.abs(mDif)*mCc; faltCarta += Math.abs(mDif)*(m.precioCarta||0);
                    if (mFuera) ocultosN++; else { faltCartaImp += Math.abs(mDif)*(m.precioCarta||0); faltCostoImp += Math.abs(mDif)*mCc; } }
                else if (mDif > 0.001) { sobrU++; sobrCosto += mDif*mCc; sobrCarta += mDif*(m.precioCarta||0);
                    if (mFuera) ocultosN++; else { sobrCartaImp += mDif*(m.precioCarta||0); sobrCostoImp += mDif*mCc; } }
            });
        }
        else if (dif < -0.001) { faltU++; faltCosto += Math.abs(dif)*cc; faltCarta += Math.abs(dif)*(f.precioCarta||0);
            if (esOcultoImpreso(f.insumoId)) ocultosN++; else { faltCartaImp += Math.abs(dif)*(f.precioCarta||0); faltCostoImp += Math.abs(dif)*cc; } }
        else if (dif > 0.001) { sobrU++; sobrCosto += dif*cc; sobrCarta += dif*(f.precioCarta||0);
            if (esOcultoImpreso(f.insumoId)) ocultosN++; else { sobrCartaImp += dif*(f.precioCarta||0); sobrCostoImp += dif*cc; } }
        var merma = (parseFloat(f.mermaCopas)||0) + (parseFloat(f.mermaBase)||0);
        if (merma > 0) { mermados.push({nombre:f.nombre, costo:merma*cc, f:f, m:merma}); mermaCosto += merma*cc; }
        // El uso a precio proveedor: venta + coctelería directa + cortesías y mermas
        // + lo que se fue al producir batches (_usoPeriodo, el mismo del reporte).
        if (_esPBr) return;
        var cons = _usoPeriodo(f, _aR);
        if (cons > 0.001) { usados++; vendidoCosto += (f.esCompuesto ? _costoUsoComp(f) : cons*cc); } else { sinUsar++; if (sinUsarLista.length<60) sinUsarLista.push(f.nombre); }
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
    // Entradas del período por tipo. SOLO la compra suma a "Compras del período"
    // (entEsCompra): bonificación, consignación y préstamo pagado entran al stock
    // pero no son dinero que salió.
    var comprasU=0, comprasCosto=0, bonifU=0, bonifCosto=0, consigU=0, consigCosto=0, prestU=0, prestCosto=0;
    var bonifItems={}, consigItems={}, prestItems={};
    var _filaIns = {}; filasCaptura.forEach(function(f){ if (f && f.insumoId) _filaIns[f.insumoId] = f; });
    ((invActual && invActual.entradasLog) || []).forEach(function(e){
        var f = _filaIns[e.insumoId]; if (!f) return;
        var cant = parseFloat(e.cantidad)||0; if (cant <= 0) return;
        var costo = cant * _costoCompraInsumo(f);
        var t = (e.tipo||'compra').toLowerCase();
        var nm = (f.nombre)||e.nombre||'';
        if (t === 'bonificacion')          { bonifU  += cant; bonifCosto  += costo; if(nm) bonifItems[nm]=(bonifItems[nm]||0)+cant; }
        else if (t === 'consignacion')     { consigU += cant; consigCosto += costo; if(nm) consigItems[nm]=(consigItems[nm]||0)+cant; }
        else if (t === 'prestamo_pagado')  { prestU  += cant; prestCosto  += costo; if(nm) prestItems[nm]=(prestItems[nm]||0)+cant; }
        else if (entEsCompra(t))           { comprasU += cant; comprasCosto += costo; }
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
        var costoCompra = _costoCompraStock(f);
        var limites = _parametrosStockFila(f, invActual && invActual.sucursalId);
        capStockMin += (parseFloat(limites.stockMin) || 0) * costoCompra;
        capStockMax += (parseFloat(limites.stockMax) || 0) * costoCompra;
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
            /* Lo que va a decir el IMPRESO, cuando no es lo mismo. Sin esta
               línea, el que compara las dos pantallas encuentra una
               contradicción donde hay una decisión suya. */
            var netCartaImp = sobrCartaImp - faltCartaImp, netCostoImp = sobrCostoImp - faltCostoImp;
            var _sg = function (v) { return (v >= 0 ? '+' : '−') + M(Math.abs(v)); };
            var _cl = function (v) { return v >= 0 ? 'var(--green)' : 'var(--red)'; };
            var _lineaImp = ocultosN > 0
                ? '<div style="margin-top:4px;font-size:11px;color:var(--text-dim);line-height:1.5"' +
                  ' title="Los apartados se siguen viendo aquí; en el reporte impreso no entran, ' +
                  'ni en la tabla ni en los totales.">↳ en el impreso: <b style="color:' + _cl(netCartaImp) + '">' +
                  _sg(netCartaImp) + '</b> a carta · <b style="color:' + _cl(netCostoImp) + '">' + _sg(netCostoImp) + '</b> a proveedor — ' +
                  ocultosN + ' insumo' + (ocultosN === 1 ? '' : 's') + ' fuera del impreso</div>'
                : '';
            /* LAS DOS CIFRAS, IGUAL QUE EL IMPRESO (Edwin, 21-nov): el neto a
               precio carta y a precio proveedor, cada uno con su signo. Si
               uno sobra y el otro falta, el título dice «Diferencia neta». */
            var esSobrCosto = netCosto >= 0;
            var _titNeto = (esSobrCarta && esSobrCosto) ? 'Sobrante neto' : (!esSobrCarta && !esSobrCosto) ? 'Faltante neto' : 'Diferencia neta';
            var _et = function (t) { return '<span style="font-family:inherit;font-size:11px;font-weight:400;letter-spacing:0;color:var(--text-dim);margin-left:6px">' + t + '</span>'; };
            var _subNeto = '<div class="neto-prov" style="font-size:18px;font-weight:700;color:' + _cl(netCosto) + ';margin-top:2px">' + _sg(netCosto) + _et('a precio proveedor') + '</div>' +
                '<div style="margin-top:4px">' + (faltU+sobrU) + ' insumos con diferencia · sobrante − faltante</div>' +
                _lineaImp +
                '<div style="margin-top:6px">'+(typeof _btnNotaNeto==='function'?_btnNotaNeto():'')+'</div>';
            return '<div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">'+
                card(_titNeto, _sg(netCarta) + _et('a precio carta'), _cl(netCarta), _subNeto)+
                card('Merma del periodo', M(mermaCosto), 'var(--accent)', mermados.length+' productos')+
                card('Insumos sin usar', String(sinUsar), sinUsar>0?'var(--accent)':'var(--green)', usados+' usados en el periodo')+
            '</div>';
        })()+
        '<div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">'+
        card('Vendido a precio proveedor', M(vendidoCosto), 'var(--text)', 'costo de lo que salió')+
        card('Compras del periodo', M(comprasCosto), 'var(--text)', comprasU>0 ? (comprasU%1?comprasU.toFixed(1):comprasU)+' unid. compradas' : 'sin compras registradas')+
        card('Vendido vs Compras', (vendidoCosto-comprasCosto>=0?'+':'−')+M(Math.abs(vendidoCosto-comprasCosto)), (vendidoCosto-comprasCosto>=0?'var(--green)':'var(--red)'),
            (vendidoCosto>=comprasCosto?'compraste menos de lo que vendiste':'compraste más de lo que vendiste')+
            '<div style="margin-top:6px">'+(typeof _btnNotaCard==='function'?_btnNotaCard('__vtacompras__'):'')+'</div>')+
        '</div>'+
        (function(){
            // Entradas que NO son compra: cada una con su card, solo si hubo.
            var _u = function(x){ return (x%1?x.toFixed(1):x)+' unid.'; };
            var noCompra = [];
            if (bonifU>0)  noCompra.push(card('🎁 Bonificación', _u(bonifU), 'var(--green)', 'valor '+M(bonifCosto)+' (sin costo)<br><span style="color:var(--text)"><b>Productos:</b> '+_listaItems(bonifItems)+'</span>'));
            if (consigU>0) noCompra.push(card('📦 Consignación', _u(consigU), '#7c7cff', 'valor '+M(consigCosto)+'<br><span style="color:var(--text)"><b>Productos:</b> '+_listaItems(consigItems)+'</span>'));
            if (prestU>0)  noCompra.push(card('🔁 Préstamo pagado', _u(prestU), '#e0a45a', 'valor '+M(prestCosto)+' (no es compra)<br><span style="color:var(--text)"><b>Productos:</b> '+_listaItems(prestItems)+'</span>'));
            return noCompra.length
                ? '<div class="stats-grid" style="grid-template-columns:repeat('+noCompra.length+',1fr);margin-bottom:14px">'+noCompra.join('')+'</div>'
                : '';
        })();

    var tablaCat = cats.length ? ('<div class="card" style="max-width:none;margin:0 16px 12px"><div class="card-body" style="padding:0"><div style="padding:12px 16px;font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent)">🍽️ Vendidos por categoría — '+M(totVendCarta)+' a carta</div><div class="tabla-wrap"><table style="font-size:12px"><thead><tr><th style="text-align:left">Categoría</th><th style="text-align:right">Unidades</th><th style="text-align:right">$ a carta</th><th style="text-align:right">%</th></tr></thead><tbody>'+
        cats.map(function(c){ var p=totVendCarta>0?(porCat[c].carta/totVendCarta*100):0; return '<tr><td style="font-weight:600">'+etx(c)+'</td><td style="text-align:right">'+porCat[c].u+'</td><td style="text-align:right;color:var(--green);font-weight:600">'+M(porCat[c].carta)+'</td><td style="text-align:right;color:var(--text-dim)">'+p.toFixed(0)+'%</td></tr>'; }).join('')+
        '</tbody></table></div></div></div>') : '';

    var tablaMerma = mermados.length ? ('<div class="card" style="max-width:none;margin:0 16px 12px"><div class="card-body" style="padding:0"><div style="padding:12px 16px;font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;color:var(--accent)">🗑️ Productos mermados — '+M(mermaCosto)+'</div><div class="tabla-wrap"><table style="font-size:12px"><thead><tr><th style="text-align:left">Producto</th><th style="text-align:right">Merma</th><th style="text-align:right">$ a costo</th></tr></thead><tbody>'+
        mermados.sort(function(a,b){return b.costo-a.costo;}).map(function(x){ return '<tr><td style="font-weight:600">'+etx(x.nombre)+'</td><td style="text-align:right">'+(x.esProd?((x.m%1?x.m.toFixed(1):x.m)+' pza'):_fmtBase(x.m))+'</td><td style="text-align:right;color:var(--accent);font-weight:600">'+(x.esProd?'—':M(x.costo))+'</td></tr>'; }).join('')+
        '</tbody></table></div></div></div>') : '';

    var listaSinUsar = sinUsar ? ('<div class="card" style="max-width:none;margin:0 16px 12px"><div class="card-body" style="padding:12px 16px"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:1px;color:var(--text-muted);margin-bottom:8px">💤 Insumos sin usar en este periodo ('+sinUsar+')</div><div style="display:flex;flex-wrap:wrap;gap:6px">'+
        sinUsarLista.map(function(n){ return '<span style="font-size:11px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:3px 9px;color:var(--text-dim)">'+etx(n)+'</span>'; }).join('')+
        (sinUsar>sinUsarLista.length?'<span style="font-size:11px;color:var(--text-dim)">+'+(sinUsar-sinUsarLista.length)+' más</span>':'')+'</div></div></div>') : '';

    /* Lo de ABAJO (Edwin, 19-nov): los cocteles vendidos por categoría y los
       insumos sin usar son informativos y empujaban las tablas de cada insumo
       media pantalla hacia abajo. Van después de ellas. */
    _resumenAbajo = tablaCat + listaSinUsar;
    return '<div class="wrap" style="padding-top:0"><div style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;letter-spacing:1.5px;color:var(--text);margin:6px 0 10px">📊 Resumen ejecutivo</div>'+bloqueKpis+'</div>'+tablaMerma;
}
/* La parte de abajo del resumen la deja lista _resumenEjecutivo() (se arma con
   las mismas cuentas, así que no se recalcula). */
var _resumenAbajo = '';

function renderStep5() {
    const mapaC5 = _compDeInsumo();
    const vcomps = _compuestosActivos().map(_virtualFilaCompuesto);
    _repCache = _repartoPrebatch(); // reparto del prebatch a sus insumos (una vez por render)
    let capitalCosto=0, capitalCarta=0, difCostoTotal=0, difNetoCosto=0, conAlerta=0;
    /* ══ EL CAPITAL SE VALÚA COMO ESTÁ, NO COMO SE REPARTE ════════════════
       Esto excluía los batches y le sumaba su contenido a los insumos,
       valuándolo al costo de CADA INGREDIENTE. El reporte de existencias
       —la lista producto por producto que se imprime para ir a contar— los
       incluye tal cual, al costo del batch. Dos números para lo mismo:
       $77,198 contra $77,365.

       Manda el reporte de existencias. El capital es lo que hay en la bodega
       valuado como está: el Limoncello de la garrafa vale lo que vale el
       Limoncello, no la suma de sus partes revaluadas. Y además es la cifra
       que se puede cotejar renglón por renglón con la lista.

       EL REPARTO SE QUEDA donde sirve: en la VARIANCIA, que es su trabajo
       —decidir a quién le falta producto—. Las dos lentes conviven; lo que no
       puede pasar es que dos pantallas den dos capitales. */
    filasCaptura.forEach(fila => {
        const adj   = _repartoDe(fila.insumoId);
        const exist = calcExistencia(fila);
        const cc    = costoCopa(fila);
        capitalCosto  += exist * cc;
        capitalCarta  += exist * (fila.precioCarta||0);
        // El batch no tiene diferencia propia (es un puente): su parte va en sus insumos.
        if (_esPrebatchRepartido(fila.insumoId) || _esBatchFila(fila)) return;
        // La diferencia de los MIEMBROS se evalúa en su compuesto, no individual.
        if (!mapaC5[fila.insumoId]) {
            const dif = calcDiferencia(fila) + adj.dif + _difEnBatches(fila.insumoId);   // total contra total
            difCostoTotal += dif * (fila.precioCarta || 0); // diferencia valorada a precio de carta
            difNetoCosto  += dif * cc;                      // faltante/sobrante a COSTO proveedor
            // Alerta con la MISMA métrica que la columna %: dif vs venta neta del periodo
            const pctA = _pctVarianza(dif, _consumoPeriodo(fila) + adj.venta);
            if (pctA !== null && Math.abs(pctA) > 25) conAlerta++;
        }
    });
    // Diferencia de los compuestos (existencia sumada − ventas en copas).
    vcomps.forEach(vf => {
        /* El dinero del compuesto sale de SUS presentaciones, cada una con su
           precio y su costo (como el resumen y el renglón): con el precio de la
           primera, la lista del historial no cuadraba con el resumen. */
        const _mems = _miembrosFila(getCompuestos().find(c => c.id === vf.compId));
        const dif = calcDiferencia(vf) + _mems.reduce((t, m) => t + _difEnBatches(m.insumoId), 0);
        _mems.forEach(m => {
            const md = calcDiferencia(m) + _repartoDe(m.insumoId).dif + _difEnBatches(m.insumoId);
            difCostoTotal += md * (m.precioCarta || 0);
            difNetoCosto  += md * costoCopa(m);
        });
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
            <div class="stat-card"><div class="stat-label">Capital a costo</div><div class="stat-val">$${_M2(capitalCosto)}</div><div style="font-size:11px;color:var(--text-dim);margin-top:3px">Inversión calculada a precio proveedor</div></div>
            <div class="stat-card"><div class="stat-label">Capital a carta</div><div class="stat-val green">$${_M2(capitalCarta)}</div><div style="font-size:11px;color:var(--text-dim);margin-top:3px">Inversión calculada a precio carta</div></div>
            <div class="stat-card"><div class="stat-label">Cancelaciones POS · informativo</div>
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
        <select class="filtro-select" onchange="setDifStep5(this.value)" style="font-size:11px;padding:6px 8px;max-width:180px"
                title="Deja en la pantalla solo lo que faltó o solo lo que sobró">
            <option value="" ${_difStep5===''?'selected':''}>Faltantes y sobrantes</option>
            <option value="falta" ${_difStep5==='falta'?'selected':''}>Solo faltantes</option>
            <option value="sobra" ${_difStep5==='sobra'?'selected':''}>Solo sobrantes</option>
        </select>
        <button class="btn-vista" style="font-size:11px" onclick="abrirImprimirS5()"
                title="Imprime exactamente lo que está en pantalla, eligiendo qué grupos van en la hoja">🖨️ Imprimir lo filtrado</button>
        <div class="vista-toggle" style="margin-left:auto">
            <button id="s5ModoLista" class="${_step5Modo==='lista'?'active':''}" onclick="setStep5Modo('lista')">${_icInv('ins-lista', 14)}Lista</button>
            <button id="s5ModoGal" class="${_step5Modo==='galeria'?'active':''}" onclick="setStep5Modo('galeria')">${_icInv('ins-galeria', 14)}Galería</button>
        </div>
    </div></div>`;
    void searchBar5;   // el buscador y los filtros van en la barra del paso (encabezado fijo)
    /* Arriba: los totales y el resumen. En medio: las tablas de cada insumo.
       Abajo, informativo: cocteles vendidos, insumos sin usar y la producción
       de batches (plegada). */
    _resumenAbajo = '';
    const _arriba = _resumenEjecutivo();
    return kpis + _arriba +
           `<div id="step5Tablas">${_step5TablasHTML()}</div>` +
           _resumenAbajo + _prebatchPlegable(_prebatchAvisoHTML() + _prebatchDesgloseHTML());
}

var _busqStep5 = '';
var _step5Modo = 'lista';
var _subcatStep5 = '';
/* '' = todo · 'falta' = solo lo que faltó · 'sobra' = solo lo que sobró.
   Lo usan la pantalla Y la hoja impresa: el botón de imprimir saca lo que se
   está viendo, y dos definiciones de «faltante» acaban imprimiendo algo
   distinto de lo que se mira. */
var _difStep5 = '';
/* Grupos elegidos en el modal de impresión. null = todavía no se abre. */
var _gruposImprS5 = null;

/* La diferencia de un renglón del Resultado, sea insumo o compuesto, con el
   reparto del prebatch ya aplicado — la MISMA cuenta que hace el reporte
   impreso (físico+reparto menos teórico+reparto). Un compuesto no tiene
   existencia propia: la suya es la de sus miembros, que es como lo dibuja su
   renglón. */
function _difS5(f) {
    if (!f) return 0;
    if (f.esCompuesto) {
        var comp = getCompuestos().find(function (c) { return c.id === f.compId; }) || {};
        return (comp.miembros || []).map(_filaDeMiembro).filter(Boolean)
            .reduce(function (t, m) { var a = _repartoDe(m.insumoId); return t + calcDiferencia(m) + a.fis - a.teo; }, 0);
    }
    var adj = _repartoDe(f.insumoId);
    return calcDiferencia(f) + adj.fis - adj.teo;
}
/* El mismo umbral que el reporte impreso (0.001): por debajo de eso es ruido
   de redondeo, no un faltante. Si los dos no usaran el mismo número, la hoja
   traería renglones que la pantalla no enseña. */
function _pasaDifS5(f) {
    if (!_difStep5) return true;
    var cumple = function (d) { return _difStep5 === 'falta' ? d < -0.001 : d > 0.001; };
    /* UN COMPUESTO ENTRA SI ALGUNA DE SUS PRESENTACIONES CUMPLE, no por su
       neto. Con una presentación −5 y otra +5 el neto es 0, así que el
       renglón desaparecía de «solo faltantes» —y con él su grupo del modal de
       impresión, que se quedaba vacío— mientras el impreso SÍ traía el
       faltante de la primera. La pantalla escondía lo que el papel enseñaba.
       (Lo encontró Codex.) */
    if (f && f.esCompuesto) {
        var comp = getCompuestos().find(function (c) { return c.id === f.compId; }) || {};
        return (comp.miembros || []).map(_filaDeMiembro).filter(Boolean)
            .some(function (m) { var a = _repartoDe(m.insumoId); return cumple(calcDiferencia(m) + a.fis - a.teo); });
    }
    return cumple(_difS5(f));
}
// Una sola selección para pantalla, grupos y papel. Buscar un miembro de un
// compuesto debe mostrar el compuesto que lo contiene, también en galería.
function _pasaSeleccionS5(f, comp) {
    if (f.esCompuesto) {
        comp = getCompuestos().find(function(c){ return c.id === f.compId; });
        return _miembrosFila(comp).some(function(m){ return _pasaSeleccionS5(m, comp); });
    }
    var q = (_busqStep5 || '').toLowerCase();
    if (q && !(f.nombre || '').toLowerCase().includes(q) &&
        !(comp && (comp.nombre || '').toLowerCase().includes(q))) return false;
    if (_subcatStep5 && (f.subcategoria || f.categoria) !== _subcatStep5) return false;
    return _pasaDifS5(f);
}
function _grupoSeleccionS5(f, comp) {
    return _grupoCategoria((comp && _miembrosFila(comp)[0]) || f);
}
function setDifStep5(v) {
    _difStep5 = v || '';
    const cont = document.getElementById('step5Tablas');
    if (cont) cont.innerHTML = _step5TablasHTML();
}
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
/* ══ IMPRIMIR LO QUE SE ESTÁ VIENDO ══════════════════════════════════════
   El filtro vive en la pantalla —buscador, categoría, faltantes/sobrantes— y
   aquí solo se elige qué GRUPOS van a la hoja. Poner los mismos filtros otra
   vez en el modal es cómo se acaba imprimiendo algo distinto de lo que se
   mira, y entonces la hoja deja de servir para revisar la pantalla. */
function _gruposVisiblesS5() {
    const q = (_busqStep5 || '').toLowerCase();
    const mapaC5 = _compDeInsumo(), vistos = {}, out = [];
    const mete = g => { if (g && !vistos[g]) { vistos[g] = 1; out.push(g); } };
    filasCaptura.forEach(f => {
        if (mapaC5[f.insumoId] || _esPrebatchRepartido(f.insumoId)) return;
        if (q && !(f.nombre || '').toLowerCase().includes(q)) return;
        if (_subcatStep5 && (f.subcategoria || f.categoria) !== _subcatStep5) return;
        if (!_pasaDifS5(f)) return;
        mete(_grupoCategoria(f));
    });
    _compuestosActivos().map(_virtualFilaCompuesto).forEach(vf => {
        if (!_pasaSeleccionS5(vf)) return;
        const comp = getCompuestos().find(c => c.id === vf.compId) || {};
        const m0 = (comp.miembros || []).map(_filaDeMiembro).find(Boolean);
        mete(m0 ? _grupoCategoria(m0) : '🧩 Compuestos');
    });
    return out.sort((a, b) => String(a).localeCompare(String(b), 'es'));
}
function abrirImprimirS5() {
    if (typeof _exigeInv === 'function' &&
        !_exigeInv('reporte', 'No puedes imprimir los reportes del inventario.')) return;
    const grupos = _gruposVisiblesS5();
    if (!grupos.length) {
        alert('Con ese filtro no queda nada en pantalla, así que la hoja saldría vacía.');
        return;
    }
    /* Lo que entra encendido es lo que se está VIENDO. Un grupo que aparece
       después —al soltar el filtro— entra encendido también, no invisible. */
    if (!_gruposImprS5) _gruposImprS5 = {};
    grupos.forEach(g => { if (_gruposImprS5[g] === undefined) _gruposImprS5[g] = true; });
    _pintarImprimirS5();
    document.getElementById('modalImprS5').style.display = 'flex';
}
function cerrarImprimirS5() { document.getElementById('modalImprS5').style.display = 'none'; }
function _pintarImprimirS5() {
    const grupos = _gruposVisiblesS5();
    const filtro = [
        _difStep5 === 'falta' ? 'solo <b>faltantes</b>' : _difStep5 === 'sobra' ? 'solo <b>sobrantes</b>' : 'faltantes <b>y</b> sobrantes',
        _subcatStep5 ? 'categoría <b>' + etx(_subcatStep5) + '</b>' : '',
        _busqStep5 ? 'que digan <b>“' + etx(_busqStep5) + '”</b>' : '',
    ].filter(Boolean).join(' · ');
    document.getElementById('imprS5Filtro').innerHTML =
        'Se imprime lo que estás viendo: ' + filtro + '.<br>' +
        '<span style="color:var(--text-dim)">Para cambiarlo, cierra y ajusta los filtros de la pantalla.</span>';
    document.getElementById('imprS5Grupos').innerHTML = grupos.map(g =>
        '<label style="display:flex;align-items:center;gap:9px;padding:7px 2px;cursor:pointer;font-size:13.5px;color:var(--text)">' +
        '<input type="checkbox" ' + (_gruposImprS5[g] ? 'checked' : '') +
        ' onchange="imprS5Toggle(' + JSON.stringify(g).replace(/"/g, '&quot;') + ', this.checked)"' +
        ' style="width:16px;height:16px;accent-color:var(--green)">' + etx(g) + '</label>').join('');
    const n = grupos.filter(g => _gruposImprS5[g]).length;
    document.getElementById('imprS5Msg').textContent = n
        ? n + (n === 1 ? ' grupo en la hoja' : ' grupos en la hoja')
        : 'Sin grupos elegidos, la hoja saldría vacía.';
}
function imprS5Toggle(g, on) { _gruposImprS5[g] = !!on; _pintarImprimirS5(); }
function imprS5Todos(on) { _gruposVisiblesS5().forEach(g => { _gruposImprS5[g] = !!on; }); _pintarImprimirS5(); }
function imprimirS5Filtrado() {
    const grupos = _gruposVisiblesS5().filter(g => _gruposImprS5[g]);
    if (!grupos.length) { alert('Elige al menos un grupo: así la hoja saldría vacía.'); return; }
    cerrarImprimirS5();
    verReporteDirectivo(false, 'faltsobr');
}

function setStep5Modo(m) {
    _step5Modo = m;
    const cont = document.getElementById('step5Tablas');
    if (cont) cont.innerHTML = _step5TablasHTML();
    const l = document.getElementById('s5ModoLista'), g = document.getElementById('s5ModoGal');
    if (l && g) { l.classList.toggle('active', m==='lista'); g.classList.toggle('active', m==='galeria'); }
}
/* ── Las "copas" se leen en la unidad que declara el insumo ─────────────
   Si el insumo define su medida en OZ, ML o LT, el resultado debe hablar en
   ESA unidad y no en "copas" genéricas: un vino con medida de 1 L usado en
   sub-recetas salía como "50.3 cop" cuando lo que se gastaron fueron 7.4
   litros, y nadie puede cotejar eso contra una caja de 5 L. Cuando el insumo
   NO declara medida (usa la copa estándar de su categoría) se sigue leyendo en
   copas, que ahí sí es la unidad de venta. */
/* ══ CONTEOS DESDE EL QR (v42) ════════════════════════════════════════════════
   Barra cuenta con el celular la noche anterior; esos conteos llegan a
   `inventario_conteos` marcados con quién contó. Aquí se muestran como PROPUESTA
   sobre el inventario abierto: se ve qué contó cada quien, y se aplica —todo o de
   uno en uno— cuando el encargado está de acuerdo. Nunca entran solos: un
   inventario es documento contable y un dedo a las 2 AM no debería moverlo. */
var _conteosQR = [];
async function cargarConteosQR() {
    if (typeof _supabase === 'undefined' || !invActual) return;
    var pendiente = _qrPendiente();
    if (pendiente) { await _qrEnviar(pendiente); return; }
    var negId = getNegocioActivo(); if (!negId) return;
    try {
        var r = await _supabase.from('inventario_conteos').select('datos').eq('negocio_id', negId);
        if (r.error) { _conteosQR = []; return; }          // sin migración v42 → simplemente no hay
        var suc = (invActual.sucursalId || '');
        var area = (invActual.area || '').toLowerCase();
        var _hechos = _conteosResueltos();
        _conteosQR = (r.data || []).map(function (x) { return x.datos; }).filter(function (c) {
            if (!c || c.aplicado) return false;
            if (_hechos[c.id]) return false;           // ya resuelto aquí (aunque el sello no haya subido)
            if ((c.sucursalId || 'suc_principal') !== (suc || 'suc_principal')) return false;
            if (area && area !== 'general' && (c.area || '').toLowerCase() !== area) return false;
            // Solo conteos frescos: uno de hace dos semanas no es de este inventario.
            var t = Date.parse((c.fecha || '') + 'T12:00:00');
            return !isNaN(t) && (Date.now() - t) < 7 * 864e5;
        });
    } catch (e) { _conteosQR = []; }
}
/* TODOS los conteos de ese producto, del más viejo al más nuevo.
   Antes esto devolvía UNO —el primero que encontrara— porque cada producto solo
   podía tener un conteo al día: recontar sobreescribía. Ahora la barra cuenta el
   refrigerador, luego la bodega, luego la cava, y los tres tienen que sumar. El
   orden importa: es el que numera "conteo 1, 2, 3" en la pantalla. */
function _conteosDeFila(fila) {
    if (!fila || !_conteosQR.length) return [];
    var canon = _canonInsumoId(fila.insumoId) || fila.insumoId;
    return _conteosQR.filter(function (c) {
        return (_canonInsumoId(c.insumoId) || c.insumoId) === canon;
    }).sort(function (a, b) {
        return String(a.fecha || '' + a.hora || '').localeCompare(String(b.fecha || '' + b.hora || '')) ||
               String(a.hora || '').localeCompare(String(b.hora || ''));
    });
}
/* Se conserva para lo que solo necesita "¿hay algo?". */
function _conteoDeFila(fila) { return _conteosDeFila(fila)[0] || null; }

/* Piezas de un conteo. El QR cuenta piezas cerradas y nada más: los pesos de
   botellas abiertas se retiraron de esa pantalla porque necesitan báscula y el
   dato de la tara, que vive aquí. */
function _conteoPiezas(c) {
    if (!c) return 0;
    return (parseFloat(c.cerradasBodega) || 0) + (parseFloat(c.cerradasBarra) || 0);
}
function _conteosTotal(lista) {
    return (lista || []).reduce(function (a, c) { return a + _conteoPiezas(c); }, 0);
}
function _conteoResumen(c) {
    var p = [];
    if (c.cerradasBodega !== '' && c.cerradasBodega != null) p.push(c.cerradasBodega + ' bodega');
    if (c.cerradasBarra !== '' && c.cerradasBarra != null) p.push(c.cerradasBarra + ' barra');
    /* Los conteos VIEJOS (anteriores a este cambio) sí pueden traer pesos: se
       siguen leyendo para no perder lo que ya estaba en la tabla. */
    var np = (c.pesos || []).filter(function (x) { return x !== '' && x != null; }).length;
    if (np) p.push(np + ' abierta' + (np !== 1 ? 's' : '') + ' pesada' + (np !== 1 ? 's' : ''));
    return p.join(' · ') || 'sin datos';
}
/* ¿Está desplegada la lista del banner? Vive fuera del render porque el Paso 1
   se repinta con cada tecla del buscador: dentro, la lista se cerraría sola. */
var _bannerQRAbierto = false;
function toggleBannerConteosQR() {
    _bannerQRAbierto = !_bannerQRAbierto;
    renderStepContent();
}
window.toggleBannerConteosQR = toggleBannerConteosQR;

/* El nombre del producto de un conteo, como se llame hoy en el catálogo. El
   conteo solo guarda el id: si se renombró el insumo, el papel viejo mentiría. */
function _nomDeConteo(c) {
    var canon = _canonInsumoId(c.insumoId) || c.insumoId;
    var fila = (filasCaptura || []).find(function (f) {
        return (_canonInsumoId(f.insumoId) || f.insumoId) === canon;
    });
    if (fila && fila.nombre) return fila.nombre;
    return c.nombre || '(producto fuera de este inventario)';
}

/* LA LISTA QUE FALTABA. El desglose por producto ya existía dentro de cada
   tarjeta, pero para saber QUÉ se contó desde el celular había que ir abriendo
   tarjeta por tarjeta — con 328 productos eso no es una revisión, es una
   búsqueda. Aquí va el historial corrido, como en el QR: qué, cuánto, quién y
   cuándo. */
function _listaConteosQR() {
    var orden = _conteosQR.slice().sort(function (a, b) {
        return String((b.fecha || '') + (b.hora || '')).localeCompare(String((a.fecha || '') + (a.hora || '')));
    });
    return '<div style="margin-top:10px;border-top:1px solid rgba(122,184,245,.25);padding-top:8px;max-height:320px;overflow-y:auto">'
        + orden.map(function (c) {
            var cuando = (c.fecha || '') + (c.hora ? ' · ' + c.hora : '');
            return '<div style="display:flex;align-items:baseline;gap:10px;padding:6px 2px;border-bottom:1px solid var(--border);font-size:12.5px">'
                + '<span style="flex:1;min-width:0;color:var(--text)">' + etx(_nomDeConteo(c)) + '</span>'
                + '<span style="color:#7ab8f5;font-weight:600;white-space:nowrap">' + etx(_conteoResumen(c)) + '</span>'
                + '<span style="color:var(--text-dim);font-size:11px;white-space:nowrap">'
                    + (c.contadoPor ? etx(c.contadoPor) + ' · ' : '') + etx(cuando) + '</span>'
            + '</div>';
          }).join('')
    + '</div>';
}

function bannerConteosQR() {
    if (!_conteosQR.length) return '';
    var quienes = {}, _prods = {};
    _conteosQR.forEach(function (c) {
        if (c.contadoPor) quienes[c.contadoPor] = 1;
        _prods[_canonInsumoId(c.insumoId) || c.insumoId] = 1;
    });
    var nombres = Object.keys(quienes);
    var _nProd = Object.keys(_prods).length;
    return '<div style="background:rgba(122,184,245,.07);border:1px solid rgba(122,184,245,.35);border-radius:11px;padding:11px 14px;margin-bottom:14px">'
        + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
        + '<span style="font-size:18px">📋</span>'
        + '<div style="flex:1;min-width:220px;font-size:12.5px;color:var(--text-muted);line-height:1.5">'
            + '<b style="color:var(--text)">' + _nProd + ' producto' + (_nProd !== 1 ? 's' : '') + ' contado' + (_nProd !== 1 ? 's' : '') + ' desde el QR</b>'
            + (_conteosQR.length > _nProd ? ' <span style="color:var(--text-dim)">· ' + _conteosQR.length + ' conteos en total</span>' : '')
            + (nombres.length ? ' · por ' + etx(nombres.join(', ')) : '') + '<br>'
            + '<span style="color:var(--text-dim)">Los conteos de un mismo producto se suman. Revísalos en su tarjeta, o aplícalos todos de una vez.</span>'
        + '</div>'
        + '<button class="btn-vista" style="color:#7ab8f5;border-color:#7ab8f5" onclick="toggleBannerConteosQR()">'
            + (_bannerQRAbierto ? '▾ Ocultar lista' : '▸ Ver los ' + _conteosQR.length + ' conteos') + '</button>'
        + '<button class="btn-vista" style="color:#7ab8f5;border-color:#7ab8f5" onclick="aplicarConteosQR()">Aplicar todos</button>'
        + '</div>'
        + (_bannerQRAbierto ? _listaConteosQR() : '')
    + '</div>';
}
/* Chip dentro de la fila: qué contó el colaborador y el botón para tomarlo. */
/* Qué renglones están desplegados. Vive fuera del render porque la tabla se
   repinta con cada tecla y si no, la lista se cerraría sola. */
var _conteosAbiertos = {};
function toggleConteosQR(insumoId) {
    _conteosAbiertos[insumoId] = !_conteosAbiertos[insumoId];
    renderStepContent();
}
window.toggleConteosQR = toggleConteosQR;

/* El chip de la fila. Dice el TOTAL de lo contado por QR, y de dónde salió.
   El botón cambia de trabajo según lo que ya haya capturado el encargado:
     · con la casilla en cero → "Usar", escribe el total;
     · con algo ya escrito   → "Sumar", lo agrega.
   Eso es lo que pidió Edwin y es lo correcto: el segundo conteo de la noche no
   corrige al primero, se le suma. */
function chipConteoQR(fila, idx) {
    var lista = _conteosDeFila(fila); if (!lista.length) return '';
    var total = _conteosTotal(lista);
    var yaTiene = (parseFloat(fila.cerradasBodega) || 0) + (parseFloat(fila.cerradasBarra) || 0);
    var sumar = yaTiene > 0;
    var abierto = !!_conteosAbiertos[fila.insumoId];
    var quienes = {};
    lista.forEach(function (c) { if (c.contadoPor) quienes[c.contadoPor] = 1; });
    var nombres = Object.keys(quienes);

    var cab = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        + '<span style="font-size:11.5px;color:#7ab8f5">📋 <b>' + _fmtNum(total) + '</b> pza'
            + (total === 1 ? '' : 's') + ' contadas por QR</span>'
        + (lista.length > 1
            ? '<button class="btn-vista" style="font-size:10px;padding:2px 8px;color:#7ab8f5;border-color:rgba(122,184,245,.4)" '
              + 'onclick="toggleConteosQR(\'' + fila.insumoId + '\')">'
              + (abierto ? '▾' : '▸') + ' ' + lista.length + ' conteos</button>'
            : '<span style="font-size:10.5px;color:var(--text-dim)">' + etx(nombres.join(', ')) + ' · ' + etx(lista[0].hora || '') + '</span>')
        + '<button class="btn-vista" style="font-size:10.5px;padding:3px 9px;margin-left:auto" '
            + 'title="' + (sumar ? 'Se agrega a lo que ya tienes capturado' : 'Escribe este total en la existencia') + '" '
            + 'onclick="aplicarConteoQR(' + idx + ')">' + (sumar ? '+ Sumar' : 'Usar') + '</button>'
        + '<button class="btn-vista" title="No tomar estos conteos" style="font-size:10.5px;padding:3px 9px;color:var(--text-dim)" onclick="descartarConteoQR(' + idx + ')">Descartar</button>'
    + '</div>';

    /* El desglose: quién contó qué y a qué hora, y poder tirar UNO sin perder
       los demás — que es justo lo que hace falta cuando alguien manda dos veces
       el mismo refrigerador. */
    var detalle = '';
    if (abierto && lista.length > 1) {
        detalle = '<div style="margin-top:7px;border-top:1px dashed rgba(122,184,245,.28);padding-top:6px">'
            + lista.map(function (c, i) {
                return '<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-muted);padding:3px 0">'
                    + '<span style="color:#7ab8f5;min-width:64px">Conteo ' + (i + 1) + '</span>'
                    + '<span style="min-width:110px">' + etx(_conteoResumen(c)) + '</span>'
                    + '<span style="color:var(--text-dim);flex:1">' + etx(c.contadoPor || '—') + ' · ' + etx(c.hora || '') + '</span>'
                    + (c.nota ? '<span style="color:var(--text-dim);font-style:italic">' + etx(c.nota) + '</span>' : '')
                    + '<button class="btn-vista" title="Quitar solo este conteo" style="font-size:9.5px;padding:2px 7px;color:var(--text-dim)" '
                        + 'onclick="descartarUnConteoQR(\'' + c.id + '\')">✕</button>'
                + '</div>';
            }).join('')
        + '</div>';
    }
    return '<div style="background:rgba(122,184,245,.08);border:1px solid rgba(122,184,245,.3);border-radius:8px;padding:6px 10px;margin-bottom:8px">'
        + cab + detalle + '</div>';
}
/* Número corto: 12 y no 12.000, pero 1.5 si de verdad hay media pieza. */
function _fmtNum(v) { return (Math.round((parseFloat(v) || 0) * 100) / 100) + ''; }
/* Escribe UN conteo en la fila.
   `sumar` decide si se agrega a lo que ya hay o si lo reemplaza. Al aplicar
   varios conteos seguidos, solo el primero puede reemplazar: los demás suman,
   o el último borraría a los anteriores — que es exactamente el bug que esto
   viene a quitar. */
function _aplicarConteoAFila(fila, c, sumar) {
    var bod = parseFloat(c.cerradasBodega), bar = parseFloat(c.cerradasBarra);
    if (!isNaN(bod)) fila.cerradasBodega = (sumar ? (parseFloat(fila.cerradasBodega) || 0) : 0) + bod;
    if (!isNaN(bar)) fila.cerradasBarra  = (sumar ? (parseFloat(fila.cerradasBarra)  || 0) : 0) + bar;
    /* Los conteos VIEJOS pueden traer pesos de botellas abiertas. Se respetan
       —no se tira lo que ya estaba en la tabla— pero no se suman: cada peso es
       UNA botella distinta, no una cantidad que se acumule. */
    var ps = (c.pesos || []).filter(function (x) { return x !== '' && x != null; });
    if (ps.length) { fila.pesos = ps.slice(); while (fila.pesos.length < 4) fila.pesos.push(''); fila.metodoCaptura = 'peso'; }
    // Queda escrito de dónde salió el número, y cuántos conteos lo formaron.
    var previo = (fila.conteoQR && sumar) ? (fila.conteoQR.conteos || 1) : 0;
    fila.conteoQR = { por: c.contadoPor || '', fecha: c.fecha || '', hora: c.hora || '',
                      nota: c.nota || '', conteos: previo + 1 };
}
/* Conteos ya resueltos (aplicados o descartados) en ESTE navegador. Es el seguro
   contra la mala red: si el sello no alcanza a subir, el conteo no reaparece
   ofreciéndose otra vez, y sobre todo el número YA quedó escrito en el inventario. */
function _conteosResueltosKey() { return _sk('conteos_qr_hechos'); }
function _conteosResueltos() {
    try { return JSON.parse(localStorage.getItem(_conteosResueltosKey()) || '{}'); } catch (e) { return {}; }
}
function _marcarResueltoLocal(id) {
    if (!id) return;
    var m = _conteosResueltos();
    m[id] = Date.now();
    // Poda a 30 días: es una lista de control, no un archivo.
    var corte = Date.now() - 30 * 864e5;
    Object.keys(m).forEach(function (k) { if (m[k] < corte) delete m[k]; });
    try { localStorage.setItem(_conteosResueltosKey(), JSON.stringify(m)); } catch (e) {}
}
/* La propuesta queda guardada antes de enviarse. Si la respuesta se pierde,
   se reenvía exactamente la misma operación; el servidor no vuelve a sumarla. */
var _qrEnviando = false;
function _qrClaveOperacion(neg, id) { return 'etaax_' + neg + '_qr_operacion_' + id; }
function _qrPendiente() {
    if (!invActual) return null;
    try { return JSON.parse(localStorage.getItem(_qrClaveOperacion(getNegocioActivo(), invActual.id)) || 'null'); }
    catch(e) { return null; }
}
function _qrEstado(texto, reintentar) {
    var el = document.getElementById('qrConfirmacion');
    if (!el) { el = document.createElement('div'); el.id = 'qrConfirmacion'; document.body.appendChild(el); }
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:24px';
    el.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Confirmación de conteos" style="max-width:440px;background:var(--surface);color:var(--text);padding:24px;border:1px solid var(--border);border-radius:16px">'
        + '<b>Conteos del QR</b><p>' + etx(texto) + '</p>'
        + (reintentar ? '<button class="btn-vista" onclick="reintentarConteosQR()">Reintentar confirmación</button> ' : '')
        + '<button class="btn-vista" onclick="salirConfirmacionQR()">Volver a inventarios</button></div>';
}
function _qrQuitarEstado() { var el = document.getElementById('qrConfirmacion'); if (el) el.remove(); }
function salirConfirmacionQR() { _qrQuitarEstado(); mostrarVista('vistaLista'); }
window.salirConfirmacionQR = salirConfirmacionQR;
async function reintentarConteosQR() { var op = _qrPendiente(); if (op) return _qrEnviar(op); }
window.reintentarConteosQR = reintentarConteosQR;
async function _qrEnviar(op) {
    if (_qrEnviando) return false;
    _qrEnviando = true;
    _qrEstado('Confirmando las cantidades y guardando el inventario…', false);
    var timer, r;
    try {
        r = await Promise.race([
            _supabase.rpc('inventario_conteos_aplicar', op.args),
            new Promise(function(_, reject){ timer = setTimeout(function(){ reject(new Error('timeout')); }, 15000); })
        ]);
        if (!r || r.error || !r.data) throw (r && r.error) || new Error('network');
    } catch(e) {
        if (invActual && invActual.id === op.args.p_inventario.id && getNegocioActivo() === op.args.p_neg)
            _qrEstado('Falta confirmar el resultado. La operación está guardada en este equipo. Reintenta cuando tengas conexión; el mismo conteo no se sumará dos veces.', true);
        return false;
    } finally { clearTimeout(timer); _qrEnviando = false; }
    var d = r.data, id = op.args.p_inventario.id;
    if (!d.ok) {
        // Una respuesta explícita de conflicto acredita que ESTA operación no
        // se aplicó. Una falla de red, en cambio, conserva el intento anterior.
        localStorage.removeItem(_qrClaveOperacion(op.args.p_neg, id));
        if (invActual && invActual.id === id && getNegocioActivo() === op.args.p_neg) {
            _qrQuitarEstado();
            await cargarConteosQR(); renderStepContent();
            alert(d.motivo === 'conflicto-inventario' ? 'Otro equipo actualizó el inventario. Vuelve a abrirlo antes de aplicar los conteos.' :
                  d.motivo === 'cerrado' ? 'El inventario ya está cerrado.' :
                  'El conteo cambió o ya fue resuelto. Revisa las cantidades actualizadas antes de aplicarlo.');
        }
        return false;
    }
    // El resultado viene del servidor. Se guarda incluso si se salió del
    // asistente mientras viajaba la petición; nunca se modifica otro negocio.
    if (getNegocioActivo() === op.args.p_neg) {
        var actual = d.inventario;
        if (window.sbConfirmarInventarioQR) sbConfirmarInventarioQR(op.args.p_neg, id, actual.qrRevision);
        var lista = getInventarios().slice(), idx = lista.findIndex(function(x){ return x.id === id; });
        if (idx >= 0) lista[idx] = actual; else lista.push(actual);
        _cacheInv = lista; _guardarDraftsLocal();
        if (invActual && invActual.id === id) {
            invActual = JSON.parse(JSON.stringify(actual));
            cargarProductosCaptura();
            _conteosQR = _conteosQR.filter(function(c){ return !op.args.p_conteos.some(function(x){ return x.id === c.id; }); });
            _invalidarStep5(); renderStepContent(); _qrQuitarEstado();
        }
    }
    localStorage.removeItem(_qrClaveOperacion(op.args.p_neg, id));
    return true;
}
async function _resolverConteosQR(lista, descartar) {
    if (!invActual || !lista.length || window._soloVistaInv || _qrEnviando) return false;
    if (typeof _exigeInv === 'function' && !_exigeInv('capturar', 'No puedes aplicar conteos.')) return false;
    var pendiente = _qrPendiente(); if (pendiente) return _qrEnviar(pendiente);
    clearTimeout(_autoGuardarTimer); clearTimeout(_persistLocalTimer);
    _autoGuardarTimer = null; _persistLocalTimer = null;
    _persistirBorradorLocal();
    var propuesta = JSON.parse(JSON.stringify(invActual));
    propuesta.filas = JSON.parse(JSON.stringify(filasCaptura));
    var aceptados = [];
    lista.forEach(function(c){
        var fila = propuesta.filas.find(function(f){ return (_canonInsumoId(f.insumoId)||f.insumoId) === (_canonInsumoId(c.insumoId)||c.insumoId); });
        if (!descartar && !fila) return;
        if (!descartar) {
            var sumar = (parseFloat(fila.cerradasBodega)||0) + (parseFloat(fila.cerradasBarra)||0) > 0;
            _aplicarConteoAFila(fila, c, sumar);
            fila.existenciaFisica = calcExistencia(fila);
        }
        aceptados.push({id:c.id, ver:parseInt(c.ver,10)||1});
    });
    if (!aceptados.length) return false;
    delete propuesta._eraCerrado;
    var op = {args:{p_neg:getNegocioActivo(), p_inventario:propuesta, p_conteos:aceptados,
        p_op:'qr_' + Date.now() + '_' + Math.random().toString(36).slice(2), p_descartar:!!descartar}};
    try { localStorage.setItem(_qrClaveOperacion(op.args.p_neg, propuesta.id), JSON.stringify(op)); }
    catch(e) { alert('No hay espacio para respaldar esta operación. No se enviaron los conteos. Libera espacio y vuelve a intentar.'); return false; }
    return _qrEnviar(op);
}
function aplicarConteoQR(idx) {
    return _resolverConteosQR(_conteosDeFila(filasCaptura[idx]), false);
}
function descartarUnConteoQR(id) {
    var c = _conteosQR.find(function(x){ return x.id === id; }); if (!c) return;
    var hacer = function(){ return _resolverConteosQR([c], true); };
    if (window.etaaxConfirm) etaaxConfirm('¿Quitar este conteo?', _conteoResumen(c), hacer, null, {yesLabel:'Quitar',danger:true});
    else if (confirm('¿Quitar este conteo?')) hacer();
}
window.descartarUnConteoQR = descartarUnConteoQR;
function descartarConteoQR(idx) {
    var lista = _conteosDeFila(filasCaptura[idx]); if (!lista.length) return;
    var hacer = function(){ return _resolverConteosQR(lista, true); };
    if (window.etaaxConfirm) etaaxConfirm('¿Descartar los conteos de este producto?', 'La existencia capturada no se modifica.', hacer, null, {yesLabel:'Descartar',danger:true});
    else if (confirm('¿Descartar los conteos de este producto?')) hacer();
}
window.descartarConteoQR = descartarConteoQR;
async function aplicarConteosQR() {
    if (!_conteosQR.length) return;
    var hacer = function(){ return _resolverConteosQR(_conteosQR.slice(), false); };
    if (window.etaaxConfirm) etaaxConfirm('Aplicar conteos del QR', 'Los conteos se suman entre sí y a las existencias ya capturadas.', hacer, null, {yesLabel:'Aplicar'});
    else if (confirm('¿Aplicar los conteos del QR?')) hacer();
}

window.aplicarConteoQR = aplicarConteoQR;
window.aplicarConteosQR = aplicarConteosQR;

/* ══ CELDAS CON OPERACIONES (tipo Excel) ═══════════════════════════════════════
   En una celda de existencias o ventas se puede escribir "12+8", "3*24" o "144/12"
   y al salir queda el resultado. Es lo que de verdad pasa contando: "tres cajas de
   24 más 5 sueltas" — obligar a sacar la cuenta aparte es donde se cuelan los errores.
   Se evalúa SOLO si el texto trae exclusivamente números y + - * / ( ) . y espacios;
   cualquier otra cosa se ignora. Nunca se ejecuta lo que el usuario escriba tal cual. */
/* ══ LAS OPERACIONES, SIN eval (22-nov) ═══════════════════════════════════
   Esto resolvía las operaciones con Function(), y la política de seguridad de
   etaax.com (CSP sin 'unsafe-eval') lo BLOQUEA: en producción toda operación
   salía en rojo y no se guardaba; en el preview, sin CSP, funcionaba. Por eso
   «sumar en la celda» nunca se pudo usar de verdad. Ahora es un calculador
   propio: + − × ÷ y paréntesis, nada más. */
function _evalExpr(t) {
    var i = 0;
    var ws = function () { while (t.charAt(i) === ' ') i++; };
    var num = function () {
        ws(); var m = /^(\d+\.?\d*|\.\d+)/.exec(t.slice(i));
        if (!m) throw new Error('num'); i += m[0].length; return parseFloat(m[0]);
    };
    var factor = function () {
        ws(); var c = t.charAt(i);
        if (c === '+') { i++; return factor(); }
        if (c === '-') { i++; return -factor(); }
        if (c === '(') { i++; var v = expr(); ws(); if (t.charAt(i) !== ')') throw new Error(')'); i++; return v; }
        return num();
    };
    var term = function () {
        var v = factor();
        for (;;) { ws(); var c = t.charAt(i);
            if (c === '*') { i++; v *= factor(); }
            else if (c === '/') { i++; var d = factor(); if (!d) throw new Error('/0'); v /= d; }
            else return v; }
    };
    var expr = function () {
        var v = term();
        for (;;) { ws(); var c = t.charAt(i);
            if (c === '+') { i++; v += term(); }
            else if (c === '-') { i++; v -= term(); }
            else return v; }
    };
    var v = expr(); ws();
    if (i !== t.length) throw new Error('resto');
    return v;
}
function _evalCelda(txt) {
    var t = String(txt == null ? '' : txt).trim();
    if (!t) return null;                                  // vacío = vacío, no cero
    // Como en Excel: «=» al inicio se ignora; «x» / «×» multiplican, «÷» divide.
    t = t.replace(/^=/, '').replace(/[x×X]/g, '*').replace(/÷/g, '/').trim();
    if (!t) return null;
    /* La coma como decimal. El teclado numérico de una tablet en español pone COMA,
       no punto: "3,5" se caía del filtro, la celda se vaciaba y encima escribía 0.
       Solo se traduce si NO hay puntos, para no romper "1.234,5" ni "3,4" como lista. */
    if (t.indexOf(',') >= 0 && t.indexOf('.') < 0 && /^[0-9+\-*/(), ]+$/.test(t)) t = t.replace(/,/g, '.');
    if (/^-?\d*\.?\d*$/.test(t)) {
        var n = parseFloat(t);
        return isFinite(n) ? n : null;                    // "-" o "." sueltos no son números
    }
    if (!/^[0-9+\-*/(). ]+$/.test(t)) return null;        // fuera cualquier otro carácter
    if (/[+\-*/]{2,}/.test(t)) return null;               // "5++3" y similares
    try {
        var v = _evalExpr(t);
        return (typeof v === 'number' && isFinite(v)) ? Math.round(v * 10000) / 10000 : null;
    } catch (e) { return null; }
}
/* «Hay una operación»: algún + − × ÷ que no sea solo el signo del principio. */
function _esFormula(txt) { return /[+\-*/x×÷]/.test(String(txt || '').trim().replace(/^[=+\-]+/, '')); }
/* Handler de celda: evalúa al salir (blur) o con Enter, escribe el resultado en la
   ventanilla y lo manda al modelo con el mismo `upd*` de siempre. */
function _celdaCalc(el, aplicar) {
    var crudo = String(el.value == null ? '' : el.value).trim();
    var v = _evalCelda(el.value);
    el.classList.remove('calc-err');
    /* Si lo escrito NO se pudo resolver ("5+", "3,5" en un teclado raro, un dedazo),
       NO se borra ni se escribe 0. Antes se vaciaba la celda y se guardaba cero: se
       perdía lo capturado y encima el 0 se veía como una existencia real. Ahora se
       queda el texto, se marca en rojo y el modelo no se toca hasta que cuadre. */
    if (v === null && crudo) {
        el.classList.add('calc-err');
        el.title = 'No se entiende "' + crudo + '". Escribe un número o una operación: 3*24+5';
        return;
    }
    el.title = '';
    el.value = (v === null) ? '' : String(v);
    aplicar(v === null ? 0 : v);
}
/* Al vaciar la celda se guarda '' (no 0): si se guardara 0, al volver a dibujar la
   fila reaparecería el cero que justamente se quería quitar. */
function updCapturaCalc(idx, campo, el) {
    var vacio = !String(el.value || '').trim();
    _celdaCalc(el, function (v) { updCaptura(idx, campo, vacio ? '' : v); });
}
function updCapturaPesoCalc(idx, campo, el) {
    var vacio = !String(el.value || '').trim();
    _celdaCalc(el, function (v) { updCapturaPeso(idx, campo, vacio ? '' : v); });
}
window.updCapturaPesoCalc = updCapturaPesoCalc;
// Peso de cada botella abierta: "0.9+0.75" para dos botellas en la misma báscula.
/* ══ LAS BOTELLAS ABIERTAS QUE HAGA FALTA (Edwin, 22-nov) ═════════════════
   Eran cuatro casillas fijas. Ahora: «+ Agregar botella» y, al llenar la
   última, aparece otra vacía. A CADA botella se le resta su cristal (por eso
   es una por casilla): si se escribe «0.944+0.543» en una, se separan en dos
   botellas —sumadas en una sola, el cristal se restaba una vez y el líquido
   salía de más—. */
function _pesosDe(fila) {
    var p = (fila.pesos || []).slice();
    while (p.length < 4) p.push('');
    return p;
}
function _pesoCeldaHTML(idx, pi, p) {
    return '<div class="inv-peso-cell"><div class="inv-peso-lbl">B' + (pi + 1) + '</div>' +
        '<input type="text" inputmode="decimal" class="inv-peso-input" value="' + etx(p == null ? '' : String(p)) + '" placeholder="kg"' +
        ' title="Una botella por casilla. 0.944+0.543 se separa en dos botellas." onkeydown="_celdaKey(event,this)"' +
        ' onblur="updPesoCalc(' + idx + ',' + pi + ',this)"></div>';
}
function _pesoAgregar(idx, enfocar) {
    var f = filasCaptura[idx]; if (!f) return;
    f.pesos = _pesosDe(f);
    f.pesos.push('');
    var cont = document.getElementById('pesos-' + idx);
    if (cont) {
        var btn = cont.querySelector('.inv-peso-add');
        var tmp = document.createElement('div'); tmp.innerHTML = _pesoCeldaHTML(idx, f.pesos.length - 1, '');
        var cel = tmp.firstChild;
        cont.insertBefore(cel, btn);
        if (enfocar) { var inp = cel.querySelector('input'); if (inp) inp.focus(); }
    }
}
window._pesoAgregar = _pesoAgregar;
function updPesoCalc(idx, pi, el) {
    var crudo = String(el.value || '').replace(/^=/, '').trim();
    var f = filasCaptura[idx]; if (!f) return;
    var partes = crudo.indexOf('(') < 0 ? crudo.split('+').map(function (x) { return x.trim(); }).filter(Boolean) : [crudo];
    if (partes.length > 1) {
        var vals = partes.map(_evalCelda);
        if (vals.some(function (v) { return v === null; })) { el.classList.add('calc-err'); el.title = 'No se entiende "' + crudo + '". Una botella por casilla: 0.944'; return; }
        el.classList.remove('calc-err');
        f.pesos = _pesosDe(f);
        f.pesos.splice.apply(f.pesos, [pi, 1].concat(vals));
        refreshFilaDisplay(idx); _autoGuardar();
        if (typeof renderCardExist === 'function') renderCardExist();
        return;
    }
    var ok = false;
    _celdaCalc(el, function (v) { ok = true; updPeso(idx, pi, v === 0 && !el.value ? '' : v); });
    // Al llenar la última botella, aparece otra vacía.
    if (ok && crudo && pi === _pesosDe(filasCaptura[idx]).length - 1) _pesoAgregar(idx, false);
}
window.updPesoCalc = updPesoCalc;
function updVentasCalc(idx, campo, el)  { _celdaFx(idx, campo, el, function (v) { updVentasUM(idx, campo, v); }); }
function updVentasDirCalc(idx, campo, el){
    var vacio = !String(el.value || '').trim();
    _celdaFx(idx, campo, el, function (v) { updVentasDirectas(idx, campo, vacio ? '' : v); });
}
function updCortesia2Calc(idx, campo, el) {
    var vacio = !String(el.value || '').trim();
    _celdaFx(idx, campo, el, function (v) {
        updCortesia2(idx, campo, vacio ? '' : (campo === 'cortesia2Copas' ? _umACop(filasCaptura[idx], v, 'cortesiaCopas') : v));
    });
}
/* ══ EL PASO 3 COMO EXCEL (Edwin, 23-nov) ══════════════════════════════════
   Las casillas ya resolvían «6+4», pero la operación se borraba al salir y el
   teclado numérico de la tablet no trae «+» ni «−». Ahora, igual que las
   cerradas del Paso 1: la operación se queda escrita (fila.fx), abajo dice
   «= 10», y junto a la casilla van «+» y «−».

   La operación solo se enseña mientras siga dando lo que hay guardado: si
   después llega una cortesía del QR o se cambia de copas a onzas, el número
   ya es otro y se enseña el número (una operación que no cuadra miente). */
function _fmtFx(v) { v = Math.round((parseFloat(v) || 0) * 100) / 100; return String(v); }
function _fxVigente(fila, campo, mostrado) {
    var fx = _fxDe(fila, campo); if (!fx) return '';
    var v = _evalCelda(fx);
    return (v !== null && Math.abs(v - (parseFloat(mostrado) || 0)) < 0.006) ? fx : '';
}
function _celdaFx(idx, campo, el, aplicar) {
    var crudo = String(el.value == null ? '' : el.value).trim(), ok = false, val = 0;
    _celdaCalc(el, function (v) { ok = true; val = v; aplicar(v); });
    if (!ok) return;                                   // no se entendió: se queda en rojo, sin tocar nada
    var fila = filasCaptura[idx]; if (!fila) return;
    if (!fila.fx) fila.fx = {};
    if (crudo && _esFormula(crudo)) { fila.fx[campo] = crudo; el.value = crudo; }
    else delete fila.fx[campo];
    var r = document.getElementById('fxr-' + idx + '-' + campo);
    if (r) r.textContent = fila.fx[campo] ? '= ' + _fmtFx(val) : '';
    if (typeof _autoGuardar === 'function') _autoGuardar();
}
function _celdaS3(id, idx, campo, mostrado, onblur, estilo, compacto) {
    var fila = filasCaptura[idx];
    var fx = _fxVigente(fila, campo, mostrado);
    var num = parseFloat(mostrado) || 0;
    var op = function (o, t, l) {
        return '<button type="button" class="calc-op" tabindex="-1" onpointerdown="event.preventDefault();_celdaOp(\'' + id + '\',\'' + o + '\')" title="' + t + '">' + l + '</button>';
    };
    return '<div class="calc-wrap' + (compacto ? ' is-compact' : '') + '"><div class="calc-celda">' +
        '<input type="text" inputmode="decimal" class="inv-num-input" id="' + id + '" value="' + etx(fx || (num ? _fmtFx(num) : '')) + '" placeholder="—"' +
            ' title="Suma y resta como en Excel: 6+4, 2*12-1" onkeydown="_celdaKey(event,this)" onblur="' + onblur + '"' +
            (estilo ? ' style="' + estilo + '"' : '') + '>' +
        '<div class="calc-ops">' + op('+', 'Sumar', '+') + op('-', 'Restar', '−') + '</div></div>' +
        '<div class="fx-res" id="fxr-' + idx + '-' + campo + '">' + (fx ? '= ' + etx(_fmtFx(num)) : '') + '</div></div>';
}

/* El concepto de la cortesía: se escribe lo que sea o se toca uno de los de
   siempre. */
var _CORT_CONCEPTOS = ['Cortesía', 'Consumo interno', 'Producción del restaurante', 'Consumo personal'];
function _cortConceptoHTML(idx, campo, val, compacto) {
    var id = campo + '-' + idx, v = String(val || '').trim().toLowerCase();
    var inp = '<input id="' + id + '" type="text" list="cortConceptos" autocomplete="off" class="inv-num-input ' + (compacto ? 's3i-coment' : 'inv-comment-input') + '"' +
        ' style="border-color:rgba(155,141,232,.5)" value="' + etx(val || '') + '" placeholder="' + (campo === 'cortesia2Concepto' ? 'Segundo concepto…' : 'Cortesía, consumo interno…') + '"' +
        ' oninput="_setCortConcepto(' + idx + ',\'' + campo + '\',this.value,true)">';
    if (compacto) return inp;
    return '<div class="inv-sale-comment s3-cort-conc"><label for="' + id + '">Concepto</label>' + inp +
        '<div class="s3-conc-chips">' + _CORT_CONCEPTOS.map(function (c) {
            return '<button type="button" class="s3-conc-chip' + (v === c.toLowerCase() ? ' on' : '') + '" onclick="_setCortConcepto(' + idx + ',\'' + campo + '\',\'' + c + '\')">' + c + '</button>';
        }).join('') + '</div></div>';
}
function _setCortConcepto(idx, campo, txt, tecleado) {
    var el = document.getElementById(campo + '-' + idx);
    if (el && !tecleado) el.value = txt;
    updVentasConcepto(idx, campo, txt);
    var chips = el && el.parentNode && el.parentNode.querySelector('.s3-conc-chips');
    if (chips) Array.prototype.forEach.call(chips.children, function (b) {
        b.classList.toggle('on', b.textContent.toLowerCase() === String(txt || '').trim().toLowerCase());
    });
}
var _c2Abiertas = {};
function _c2Visible(f) {
    return !!(f && f.tipo !== 'peso' && (_c2Abiertas[f.insumoId] || String(f.cortesia2Concepto || '').trim() ||
        (parseFloat(f.cortesia2Copas) || 0) > 0 || (parseFloat(f.cortesia2Botella) || 0) > 0));
}
function abrirCortesia2(idx) {
    var f = filasCaptura[idx]; if (!f) return;
    _c2Abiertas[f.insumoId] = true;
    _repintarVentasFila();
    var el = document.getElementById('c2-cop-' + idx); if (el) el.focus();
}
function quitarCortesia2(idx) {
    var f = filasCaptura[idx]; if (!f) return;
    delete _c2Abiertas[f.insumoId];
    f.cortesia2Copas = ''; f.cortesia2Botella = ''; f.cortesia2Concepto = '';
    if (f.fx) { delete f.fx.cortesia2Copas; delete f.fx.cortesia2Botella; }
    _actualizarSalida(f, 'cortesiaCopas', {});
    _autoGuardar();
    _repintarVentasFila();
}
// Repinta lo que esté a la vista en el Paso 3 (la tarjeta o la lista).
function _repintarVentasFila() {
    if (document.getElementById('ventasCardWrap') && _ventasInsumoId) renderCardVentas();
    else if (typeof renderStepContent === 'function') renderStepContent();
    if (typeof renderResumenVentas === 'function') renderResumenVentas();
}
function _cortesia2HTML(idx, compacto) {
    var f = filasCaptura[idx]; if (!f || f.tipo === 'peso') return '';
    if (!_c2Visible(f)) return '<button type="button" class="s3-c2-add' + (compacto ? ' is-compact' : '') + '" onclick="abrirCortesia2(' + idx + ')">+ Otro concepto' + (compacto ? '' : ' en este renglón') + '</button>';
    var esCopa = f.tipo === 'copa', valida = esCopa && f.contNeto > 0 && f.copaML > 0;
    var ud = _umCapLbl(f, false, 'cortesiaCopas'), est = 'border-color:rgba(155,141,232,.5)';
    var cant = _celdaS3('c2-cop-' + idx, idx, 'cortesia2Copas', _copAUm(f, f.cortesia2Copas, 'cortesiaCopas'),
        'updCortesia2Calc(' + idx + ',\'cortesia2Copas\',this);renderResumenVentas()', est, compacto);
    var bot = !esCopa ? '' : (valida
        ? _celdaS3('c2-bot-' + idx, idx, 'cortesia2Botella', f.cortesia2Botella,
            'updCortesia2Calc(' + idx + ',\'cortesia2Botella\',this);renderResumenVentas()', est, compacto)
        : '<input type="text" class="inv-num-input" disabled placeholder="—" style="' + est + '" title="Define contenido y tamaño de copa en el insumo">');
    var x = '<button type="button" class="s3-c2-x" title="Quitar este concepto" onclick="quitarCortesia2(' + idx + ')">✕</button>';
    if (compacto) {
        return '<div class="s3-c2 is-compact"><div class="s3i-par">' +
            '<div class="s3i-campo"><span class="s3i-l">' + ud + '</span>' + cant + '</div>' +
            '<div class="s3i-campo"><span class="s3i-l">' + (esCopa ? 'Botellas' : 'bot') + '</span>' + (esCopa ? bot : '<div class="s3i-na">—</div>') + '</div>' +
            '</div><div class="s3-c2-conc">' + _cortConceptoHTML(idx, 'cortesia2Concepto', f.cortesia2Concepto, true) + x + '</div></div>';
    }
    return '<div class="s3-c2"><div class="s3c-fila">' +
        '<div class="s3c-campo"><label class="s3c-l" for="c2-cop-' + idx + '">Cantidad (' + ud + ')</label>' + cant + '</div>' +
        (esCopa ? '<div class="s3c-campo"><label class="s3c-l" for="c2-bot-' + idx + '">Botellas</label>' + bot + '</div>' : '') +
        _cortConceptoHTML(idx, 'cortesia2Concepto', f.cortesia2Concepto) + x +
    '</div></div>';
}
/* Las partes de la cortesía, cada una con su concepto (el Resultado y el
   reporte las enseñan juntas en el lugar de las cortesías). */
function _cortPartes(f) {
    if (!f || f.tipo === 'peso') return [];
    if (f.esCompuesto) {
        var c = (typeof getCompuestos === 'function') ? getCompuestos().find(function (x) { return x.id === f.compId; }) : null;
        return _cortPartesJuntas(((c && c.miembros) || []).map(_filaDeMiembro).filter(Boolean));
    }
    var tot = parseFloat(f.cortesiaCopas) || 0, c2 = Math.min(tot, _c2Previo(f)), r = [];
    if (tot - c2 > 1e-9) r.push({ concepto: String(f.cortesiaConcepto || '').trim() || 'Cortesía', copas: tot - c2 });
    if (c2 > 1e-9) r.push({ concepto: String(f.cortesia2Concepto || '').trim() || 'Otro concepto', copas: c2 });
    return r;
}
function _cortPartesJuntas(filas) {
    var porC = {}, orden = [];
    (filas || []).forEach(function (m) {
        _cortPartes(m).forEach(function (p) {
            var k = p.concepto.toLowerCase();
            if (!porC[k]) { porC[k] = { concepto: p.concepto, copas: 0 }; orden.push(k); }
            porC[k].copas += p.copas;
        });
    });
    return orden.map(function (k) { return porC[k]; });
}
/* La celda de las cortesías en el Resultado (Edwin, 23-nov, 2ª vuelta): sin el
   título fijo «Cortesías». El título ES el concepto (el de la primera opción)
   con su cantidad; con dos conceptos, cada uno con la suya y abajo el TOTAL,
   que es lo que entra al resultado. Sin cortesía, «Cortesías —» como siempre. */
function _s5CortCelda(partes, total, fmt) {
    if (!(total > 0)) return _s5c2('Cortesías', '—');
    if (partes.length <= 1) return _s5c2(etx(partes.length ? partes[0].concepto : 'Cortesía'), '<b class="s5-cv">' + fmt(total) + '</b>');
    return '<div class="s5-c2 s5-cort2">' + partes.map(function (p, i) {
        return '<span class="' + (i ? 's5-cl' : 's5-l') + '">' + etx(p.concepto) + '</span><b class="s5-cv">' + fmt(p.copas) + '</b>';
    }).join('') + '<div class="s5-ct"><span class="s5-cl">Total</span><b>' + fmt(total) + '</b></div></div>';
}
window.updCortesia2Calc = updCortesia2Calc; window.abrirCortesia2 = abrirCortesia2; window.quitarCortesia2 = quitarCortesia2;
window._setCortConcepto = _setCortConcepto;
function _celdaKey(ev, el) {
    // Enter = terminar la celda. blur() dispara el mismo onblur que ya evalúa, así
    // que Enter y salir de la celda se comportan idénticos (antes Enter en algunos
    // teclados de tablet no llegaba a blur y la operación se quedaba sin resolver).
    if (ev.key === 'Enter' || ev.keyCode === 13) { ev.preventDefault(); el.blur(); }
}
window.updCapturaCalc = updCapturaCalc;
window.updVentasCalc = updVentasCalc;
window.updVentasDirCalc = updVentasDirCalc;
window._celdaKey = _celdaKey;

/* ── UNIDAD DE CAPTURA: copas u onzas ─────────────────────────────────────────
   El inventario SIEMPRE guarda COPAS: es la unidad en la que están escritas todas
   las fórmulas (teórico, variancia, costo, coctelería). Lo único que cambia es la
   ventanilla de captura: si el insumo pide onzas, se teclea en onzas y se convierte
   al entrar y al salir. Así nadie tiene que migrar un solo inventario viejo.
   Se define en el insumo ("Capturar ventas en"), junto al "Leer consumo en". */
// Redondeo a 1 decimal, sin ".0" de adorno. Global: antes vivía como const local
// dentro de un render y usarlo fuera tronaba (ese fue el bug de la búsqueda rápida).
function _n1(v) { var r = Math.round((parseFloat(v) || 0) * 10) / 10; return r % 1 ? r.toFixed(1) : String(r); }
/* Cada ventanilla lleva SU propia unidad: se puede vender por copa y mermar por onza
   en el mismo producto. Se guarda una unidad por campo; `umCaptura` era la unidad
   única anterior y se sigue leyendo como default para no alterar lo ya capturado. */
var _CAMPO_UM = { ventasCopasDirectas: 'umCapVenta', cortesiaCopas: 'umCapCortesia', mermaCopas: 'umCapMerma' };
function _umCampo(fila, campo) {
    if (!fila || fila.tipo === 'pza') return '';
    var k = _CAMPO_UM[campo];
    var v = (k && fila[k] !== undefined && fila[k] !== null && fila[k] !== '') ? fila[k] : fila.umCaptura;
    return String(v || '').toUpperCase() === 'OZ' ? 'OZ' : '';
}
function _capturaOZ(fila, campo) { return _umCampo(fila, campo || 'ventasCopasDirectas') === 'OZ'; }
// Selector compacto de unidad para UNA ventanilla.
function _selUM(idx, campo, estilo) {
    var f = filasCaptura[idx];
    var oz = _capturaOZ(f, campo);
    var cml = parseFloat(f && f.copaML) || 0;
    return '<select onchange="updCapturaUM(' + idx + ',this.value,\'' + campo + '\')" ' +
        'title="Unidad de esta ventanilla" style="' + (estilo || '') + '">' +
        '<option value=""' + (oz ? '' : ' selected') + '>Copa' + (cml > 0 ? ' ' + _n1(cml) + ' ml' : '') + '</option>' +
        '<option value="OZ"' + (oz ? ' selected' : '') + '>Onza</option></select>';
}
// Cambiar la unidad de captura de ESTE producto en ESTE inventario. Lo tecleado se
// conserva: el valor guardado son copas, solo cambia la ventanilla que lo muestra.
function updCapturaUM(idx, um, campo) {
    var f = filasCaptura[idx]; if (!f) return;
    var v = (um === 'OZ') ? 'OZ' : '';
    if (campo && _CAMPO_UM[campo]) f[_CAMPO_UM[campo]] = v;
    else { f.umCaptura = v; f.umCapVenta = v; f.umCapCortesia = v; f.umCapMerma = v; }
    _autoGuardar();
    renderCardVentas();
    renderResumenVentas();
    // Vista de tabla: hay que redibujar la fila para que la ventanilla cambie de unidad
    // (en la tarjeta ya lo hizo renderCardVentas).
    var lista = document.getElementById('step3VentasListaCont');
    if (lista) lista.innerHTML = _step3VentasInner();
}
window.updCapturaUM = updCapturaUM;
// Etiqueta de la ventanilla: "oz" u "cop" / "Onzas" u "Copas".
function _umCapLbl(fila, largo, campo) {
    if (fila && fila.tipo === 'pza') return largo ? 'Piezas' : 'pza';
    return _capturaOZ(fila, campo) ? (largo ? 'Onzas' : 'oz') : (largo ? 'Copas' : 'cop');
}
// copas guardadas → número que se muestra en la ventanilla
function _copAUm(fila, copas, campo) {
    var v = parseFloat(copas) || 0;
    if (!v || !_capturaOZ(fila, campo)) return v;
    var cml = parseFloat(fila.copaML) || 0;
    if (!cml) return v;
    return Math.round((v * cml / OZ_ML) * 100) / 100;
}
// número tecleado en la ventanilla → copas que se guardan
function _umACop(fila, val, campo) {
    var v = parseFloat(val) || 0;
    if (!v || !_capturaOZ(fila, campo)) return v;
    var cml = parseFloat(fila.copaML) || 0;
    if (!cml) return v;
    return (v * OZ_ML) / cml;
}
// Captura convertida: recibe lo tecleado en la unidad de ESE campo y guarda copas.
function updVentasUM(idx, campo, val) {
    var fila = filasCaptura[idx];
    updVentasDirectas(idx, campo, _umACop(fila, val, campo));
}
window.updVentasUM = updVentasUM;

function _medidaInsumo(fila) {
    if (!fila || fila.tipo !== 'copa') return null;
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(fila.insumoId) : null;
    if (!ins) return null;
    var p0 = (ins.presentaciones && ins.presentaciones[0]) || {};
    // 1) Lo que el insumo diga EXPLÍCITAMENTE que quiere leer ("umLectura").
    var lec = String(ins.umLectura || p0.umLectura || '').toUpperCase();
    if (lec === 'COPA') return null;                  // se lee en copas, aunque mida 1.5 oz
    if (lec === 'OZ' || lec === 'ML' || lec === 'LT') return { um: lec };
    // 2) Sin elección: una medida grande (≥500 ml) no es un trago, es volumen —
    //    ahí leer "copas" no dice nada. Un trago de bar se sigue leyendo en copas.
    var cml = parseFloat(fila.copaML) || 0;
    return cml >= 500 ? { um: 'ML' } : null;
}
// Formatea una cantidad en COPAS usando la medida declarada del insumo.
function _fmtCop(copas, fila) {
    var v = parseFloat(copas) || 0;
    if (fila && fila.tipo !== 'copa') return _fmtEquivalenteBatch(v, fila.tipo === 'pza' ? 'PZA' : fila.baseUnit || 'G');
    var m = _medidaInsumo(fila);
    var n1 = function (x) { var r = Math.round(x * 10) / 10; return r % 1 ? r.toFixed(1) : String(r); };
    if (!m) return n1(v) + ' cop';
    var ml = v * (parseFloat(fila.copaML) || 0);
    if (m.um === 'OZ') return n1(ml / OZ_ML) + ' oz';
    if (m.um === 'LT') return n1(ml / 1000) + ' L';
    return Math.abs(ml) >= 1000 ? n1(ml / 1000) + ' L' : n1(ml) + ' ml';   // ML (el umbral mira la magnitud: −2500 también es −2.5 L)
}
// Igual, pero con signo (para diferencias).
function _fmtCopSgn(copas, fila) {
    var v = parseFloat(copas) || 0;
    return (v >= 0 ? '+' : '') + _fmtCop(v, fila);
}

/* ══ A CUÁNTAS BOTELLAS, ONZAS Y COPAS EQUIVALE ══════════════════════════════
   Lo pidió Edwin: en barra las cantidades se calculan en copas y así salían.
   «−5.8 copas» no le dice nada a quien está parado frente al anaquel contando
   botellas, y «2 L» tampoco cuando la carta se sirve por onza.

   Son TRES LECTURAS DE LA MISMA CANTIDAD, no tres cantidades que se suman. Van
   debajo de la cifra principal, sin tocarla: el total, el porcentaje, el
   teórico y las alertas de stock siguen siendo los mismos números.

   Una sola función para Lista, Galería e impreso. Con una por pantalla se
   desalinean, y el que compara el impreso con la pantalla deja de creerle a
   las dos.

   La conversión NO se hace aquí: la hace `EtaaxCore.equivalenciasBarra` con las
   referencias de ESTA fila. Aquí solo se redondea para mostrar —redondear antes
   deja centilitros de diferencia entre el impreso y la pantalla— y se decide
   qué hacer con lo que no se puede determinar. */
function _equivBarra(copas, fila) {
    /* Solo líquido servido en copas. Un abarrote en gramos no tiene onzas
       líquidas y una cerveza por pieza no tiene copas: inventárselas sería
       peor que no decir nada. */
    if (!fila || fila.tipo !== 'copa' || typeof EtaaxCore === 'undefined') return null;
    return EtaaxCore.equivalenciasBarra(copas, { contNeto: fila.contNeto, copaML: fila.copaML });
}
/* Un compuesto suma las equivalencias de sus presentaciones. No tiene un
   envase ni una copa únicos: 0.5 bot de 950 ml + 1 bot de 700 ml = 1.5 bot,
   pero son 1175 ml, no 1.5 veces la capacidad de la primera presentación.
   Cantidades con signo conservan el saldo de cada unidad, sin redondear antes.
   Si falta una referencia no se presenta una suma parcial como total. */
function _equivBarraGrupo(partes) {
    if (!partes || !partes.length) return null;
    var medidas = partes.map(function(p){ return _equivBarra(p.cantidad, p.fila); });
    if (medidas.some(function(e){ return !e; })) return null; // piezas/peso/mezclas
    var total = { grupo:true, faltan:[] };
    ['botellas','onzas','copas','litros','ml'].forEach(function(k){
        total[k] = medidas.some(function(e){ return e[k] === null; }) ? null
            : medidas.reduce(function(s,e){ return s + e[k]; }, 0);
    });
    if (medidas.some(function(e){ return e.contNeto === null; })) total.faltan.push('el contenido de la botella');
    if (medidas.some(function(e){ return e.copaML === null; })) total.faltan.push('el tamaño de la copa');
    return total;
}
function _equivBarraGrupoHTML(partes, opts) {
    var e = _equivBarraGrupo(partes);
    return e ? _equivBarraHTML(0, null, Object.assign({}, opts, {equivalencias:e})) : '';
}
/* Un número con su signo y sin `−0.00`: un faltante de 8 microlitros daba
   «−0.00 bot», que se lee como un error del sistema y no como «cuadró».

   El ida y vuelta por `parseFloat` NO es adorno, es lo que mata el signo:
   `(-0.004).toFixed(2)` devuelve «-0.00» tal cual, mientras que pasar por
   `parseFloat` deja −0 y `(-0).toFixed(2)` ya sale «0.00». Formatear directo
   trae el menos de vuelta. */
function _nEquiv(v, dec, signo) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    var r = parseFloat(v.toFixed(dec));
    return (signo && r > 0 ? '+' : '') + r.toFixed(dec);
}
/* ══ EL RESULTADO EN DOS RENGLONES (17-nov-2026, pedido de Edwin) ═════════
   El renglón era «súper alto con letras bien pequeñas»: la celda del producto
   apilaba nombre, stock, categoría, contenido y tres botones, y las cifras
   cargaban debajo sus equivalencias en 9 px. Como en el costeo de destilados:
     · renglón 1 → el producto y sus números, a tamaño legible;
     · renglón 2 → el detalle, cada cosa con su nombre: stock, cómo sale el
       resultado (teórico, físico, diferencia y sus equivalencias), lo usado
       en prebatch, lo producido, la diferencia en dinero a costo proveedor y
       a precio carta, y las acciones.
   Copa, pieza y compuesto sacan el segundo renglón de AQUÍ: si cada uno
   armara el suyo, se separarían. */
function _estiloS5() {
    return '<style>' +
        /* Letra más grande (Edwin, 19-nov: «para que sea más legible»): el
           lugar lo dejó la columna de Cancelaciones. */
        '.s5-r1>td{border-bottom:0!important;padding-top:12px!important;padding-bottom:5px!important;vertical-align:top;font-size:16.5px}' +
        '.s5-r1 .s5-nom{font-size:17.5px;font-weight:600;line-height:1.3}' +
        '.s5-r1 .s5-cont{font-size:13px;color:var(--text-dim);margin-top:3px}' +
        '.s5-sub{display:block;font-size:12.5px;font-weight:400;color:var(--text-dim);white-space:normal;margin-top:3px;line-height:1.35}' +
        '.s5-r2>td{padding-top:3px!important;padding-bottom:14px!important;vertical-align:top;font-size:14.5px;color:var(--text-muted)}' +
        '.s5-tabla .s5-mini{font-size:11.5px!important}' +
        /* Una línea GRUESA cierra cada producto (sus dos renglones); entre
           el primer renglón y el segundo, una punteada apenas visible. */
        '.s5-tabla tr.s5-r1{border-bottom:1px dashed var(--border)!important}' +
        '.s5-r2>td{border-bottom:3px solid color-mix(in srgb,var(--text-dim) 38%,transparent)!important}' +
        /* Cada celda, de los DOS renglones, con su título chiquito arriba. */
        '.s5-c2 .s5-l{display:block;font-size:10.5px;font-weight:500;letter-spacing:.3px;line-height:1.25;text-transform:uppercase;color:var(--text-dim);margin-bottom:3px;white-space:normal}' +
        'th small.s5-th2{display:block;font-size:8.5px;font-weight:400;letter-spacing:.3px;text-transform:none;opacity:.8;margin-top:2px}' +
        '.s5-r2 .s5-c2 b{color:var(--text);font-weight:600}' +
        '.s5-uso{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}' +
        /* El botón de tres puntos (bateo, nota, impreso) y lo que ya está marcado. */
        '.s5-menu{display:flex;align-items:center;gap:6px;flex-wrap:wrap}' +
        '.s5-dots{width:34px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--surface2);color:var(--text);font-size:17px;line-height:1;cursor:pointer;padding:0 0 6px}' +
        '.s5-dots:hover{border-color:var(--accent)}' +
        '.s5-desg{padding:3px 8px;border-radius:6px;cursor:pointer;border:1px solid var(--viol);background:transparent;color:var(--viol);font-size:10.5px}' +
        '.s5-est{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}' +
        '.s5-est:empty{display:none}' +
        '.s5-pill{font-size:10px;padding:1px 7px;border-radius:10px;white-space:nowrap;border:1px solid}' +
        '.s5-nota{flex-basis:100%;font-size:10.5px;color:var(--accent);font-style:italic;line-height:1.4}' +
        /* El stock: solo cómo está y sus límites. */
        '.s5-stk b{font-weight:700}' +
        '.s5-stk .s5-sub{margin-top:1px}' +
        /* Que la tabla quepa en la tablet: títulos sin tanto aire, celdas más
           angostas, los números enteros en su renglón y los desgloses bajando
           de renglón en vez de estirar la columna. */
        '.s5-tabla th{letter-spacing:.6px!important;padding:8px 6px!important}' +
        '.s5-tabla td{padding-left:6px!important;padding-right:6px!important}' +
        '.s5-r1>td:not(:first-child){white-space:nowrap}' +
        '.s5-tabla .s5-sub,.s5-tabla .s5-sub *,.s5-tabla td div[style*="nowrap"]{white-space:normal!important}' +
        /* ALINEADOS (Edwin, 19-nov): todos los títulos de celda ocupan lo de
           dos líneas, con el texto abajo, para que las cifras de un renglón
           queden a la misma altura aunque «Exist. anterior» o «Venta botella»
           se partan en dos y «Entradas» no. */
        '.s5-tabla .s5-c2 .s5-l{display:flex;flex-direction:column;justify-content:flex-end;min-height:2.5em}' +
        /* Líneas que dividen las columnas, de arriba abajo del producto. Entre
           venta botella y venta copa no: abajo comparten el uso en coctelería. */
        '.s5-tabla tr.s5-r1>td+td,.s5-tabla tr.s5-r2>td+td{border-left:1px solid var(--border)!important}' +
        '.s5-tabla tr.s5-r1>td.s5-vc{border-left:0!important}' +
        /* Los comentarios, junto al ⋯. */
        '.s5-menu{align-items:flex-start}' +
        '.s5-coms{flex:1 1 150px;min-width:0;font-size:13px;line-height:1.45;color:var(--text-muted);text-align:left;overflow-wrap:anywhere}' +
        '.s5-coms .s5-l{display:block;font-size:10.5px;font-weight:500;letter-spacing:.3px;line-height:1.25;text-transform:uppercase;color:var(--text-dim);margin-bottom:3px}' +
        '.s5-coms b{color:var(--text);font-weight:600}' +
        /* Las presentaciones de un compuesto: sangradas y unidas a él (línea
           delgada entre ellas; la gruesa cierra al compuesto completo). */
        '.s5-tabla tr.s5-mem>td{background:color-mix(in srgb,var(--viol) 5%,transparent)}' +
        '.s5-tabla tr.s5-mem>td:first-child{padding-left:28px!important}' +
        '.s5-tabla tr.s5-mem .s5-nom{font-size:15px}' +
        '.s5-tabla tr.s5-mem .s5-nom::before{content:"↳ ";color:var(--viol)}' +
        '.s5-tabla tr.s5-r2.s5-comp-abierto>td,.s5-tabla tr.s5-mem.s5-r2:has(+ tr.s5-mem)>td{border-bottom:1px dashed var(--border)!important}' +
        '.s5-lim{font-size:12.5px;color:var(--text-muted);margin-top:4px}' +
        '.s5-tabla{--s5-amarillo:#f5c842}[data-theme="light"] .s5-tabla{--s5-amarillo:#b38600}' +
        '.s5-tabla .s5-exl{font-size:10.5px;font-weight:400;color:var(--text-dim);margin-top:1px;white-space:normal!important}' +
        /* Cortesías: el concepto es el título; con dos, cada uno y abajo el total. */
        '.s5-tabla .s5-c2 b.s5-cv{color:var(--viol);white-space:nowrap}' +
        '.s5-c2 .s5-cl{display:block;font-size:10.5px;font-weight:500;letter-spacing:.3px;line-height:1.25;text-transform:uppercase;color:var(--text-dim);margin:7px 0 2px;white-space:normal}' +
        '.s5-c2 .s5-ct{border-top:1px dashed var(--border);margin-top:7px;padding-top:5px}' +
        '.s5-c2 .s5-ct .s5-cl{margin-top:0}' +
        '.s5-c2 .s5-ct b{white-space:nowrap}' +
        '.s5-exb{font-size:12.5px;font-weight:600;color:var(--viol);margin-top:4px;white-space:normal}' +
        '.s5-ext{font-size:13px;font-weight:700;color:var(--text);margin-top:1px;white-space:normal;border-top:1px solid var(--border);padding-top:2px}' +
        // En su propio renglón, centrado bajo la cifra (display:table encoge al texto).
        '.s5-ind{display:table;margin:4px auto 0;font-size:11.5px;font-weight:700;padding:1px 8px;border-radius:10px;border:1px solid currentColor;' +
            'background:color-mix(in srgb,currentColor 10%,transparent);white-space:nowrap}' +
        '.s5-tabla .s5-enbat{color:var(--viol);opacity:.95;white-space:normal!important}' +
        /* La ficha informativa de cada batch. */
        '.s5-pbt{width:100%;border-collapse:collapse}' +
        '.s5-pbt>tbody>tr>td{padding:14px 16px;border-bottom:3px solid color-mix(in srgb,var(--text-dim) 38%,transparent)}' +
        '.s5b{display:grid;grid-template-columns:minmax(200px,1.1fr) 1fr 1fr;gap:18px;align-items:start}' +
        '.s5b-col{border-left:1px solid var(--border);padding-left:16px;min-width:0}' +
        '.s5b .s5-l{display:block;font-size:10.5px;font-weight:500;letter-spacing:.3px;line-height:1.25;text-transform:uppercase;color:var(--text-dim);margin-bottom:3px}' +
        '.s5b .s5b-l2{margin-top:10px}' +
        '.s5b-val{font-size:16px;font-weight:600;color:var(--text)}' +
        '.s5b-lst{font-size:13.5px;color:var(--text-muted);line-height:1.6}' +
        '.s5b-lst div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dotted var(--border)}' +
        '.s5b-lst b{color:var(--text);font-weight:600;white-space:nowrap}' +
        '.s5b-id .s5-menu{margin-top:8px}' +
        '.s5b .s5-nom{font-size:17.5px;font-weight:600;line-height:1.3}' +
        '.s5b .s5-cont{font-size:13px;color:var(--text-dim);margin-top:3px}' +
        '@media (max-width:900px){.s5b{grid-template-columns:1fr}.s5b-col{border-left:0;padding-left:0}}' +
        /* Los dos renglones son UN producto: se iluminan juntos. */
        '.s5-r1:hover+.s5-r2,.s5-r1:has(+.s5-r2:hover){background:var(--surface2)}' +
        '</style>';
}
/* La versión de PAPEL de la tabla: colores fijos de papel (no dependen del
   tema: el impreso se lleva al anaquel), letra a la medida de una hoja A4 y
   sin anchos mínimos de pantalla. Las variables se redefinen en la tabla
   misma: el paginador la clona al partirla de hoja y se lleva la clase. */
function _estiloS5Papel() {
    return '<style>' +
        '.s5-papel{--text:#1a1916;--text-muted:#4a463e;--text-dim:#78736a;--border:#d6d0c4;--border2:#cbc4b6;--green:#1a7a4a;--red:#c0392b;' +
            '--accent:#9a6a00;--viol:#5b45b8;--surface:#fff;--surface2:#f4f2ee;--bg:#fff;color:#1a1916}' +
        'table.s5-tabla.s5-papel{width:100%;min-width:0!important;border-collapse:collapse;font-size:9.5px!important;margin-bottom:6px}' +
        '.s5-papel .s5-r1>td{font-size:10.5px!important;padding:6px 3px 2px!important;white-space:normal!important}' +
        '.s5-papel .s5-r2>td{font-size:9.5px!important;padding:1px 3px 6px!important;border-bottom:2px solid #9d978b!important}' +
        '.s5-papel .s5-r1 .s5-nom{font-size:11px!important}' +
        '.s5-papel .s5-r1 .s5-cont{font-size:8.5px!important}' +
        '.s5-papel .s5-c2 .s5-l,.s5-papel .s5-l{font-size:7px!important;letter-spacing:.2px!important;margin-bottom:1px!important}' +
        '.s5-papel .s5-c2 .s5-cl{font-size:7px!important;letter-spacing:.2px!important;margin:3px 0 1px!important}' +
        '.s5-papel .s5-c2 .s5-ct{margin-top:3px!important;padding-top:2px!important}' +
        '.s5-papel .s5-sub,.s5-papel .s5-mini{font-size:8px!important}' +
        '.s5-papel .s5-coms{font-size:8.5px;flex-basis:100px}' +
        '.s5-papel .s5-lim{font-size:8px!important}' +
        '.s5-papel{--s5-amarillo:#8a6a00}' +
        '.s5-papel .s5-exl{font-size:7px!important}' +
        '.s5-papel .s5-exb,.s5-papel .s5-ext{font-size:8.5px!important}' +
        '.s5-papel .s5-ind{font-size:7.5px!important;padding:0 4px!important;margin:2px auto 0!important}' +
        '.s5-papel .s5-pill,.s5-papel .s5-nota{font-size:8px}' +
        '.s5-papel tr.s5-r1>td+td,.s5-papel tr.s5-r2>td+td{border-left:1px solid #d6d0c4!important}' +
        '.s5-papel tr.s5-r1>td.s5-vc{border-left:0!important}' +
        '.s5-papel tr.s5-r2.s5-comp-abierto>td,.s5-papel tr.s5-mem.s5-r2:has(+ tr.s5-mem)>td{border-bottom:1px dashed #cfc9bd!important}' +
        '.s5-papel tr.s5-mem>td:first-child{padding-left:12px!important}' +
        '.s5-papel tr.s5-mem .s5-nom{font-size:10px!important}' +
        /* El dinero no se parte en dos líneas («−» arriba, la cifra abajo). */
        '.s5-papel tr.s5-r1>td:not(:first-child),.s5-papel tr.s5-r2>td:last-child{white-space:nowrap!important}' +
        '.s5-papel .s5-sub,.s5-papel .s5-sub *,.s5-papel .s5-mini{white-space:normal!important}' +
        '.s5-papel table{font-size:8.5px!important}' +
        '.s5-papel table th,.s5-papel table td{padding:2px 3px!important}' +
        '.s5p-gt{display:flex;align-items:baseline;gap:10px;margin:12px 0 4px;border-bottom:1px solid #1a1916;padding-bottom:3px}' +
        '.s5p-gn{font-size:11px;font-weight:700;color:#1a1916;margin-right:auto}' +
        '.s5p-gs{font-size:9.5px;color:#78736a}' +
        '.s5p-gd{font-size:11px;font-weight:700}' +
        'table.s5-pbt.s5-papel{width:100%;border-collapse:collapse;margin-bottom:6px}' +
        '.s5-pbt.s5-papel>tbody>tr>td{padding:7px 2px;border-bottom:1px solid #cfcabd}' +
        '.s5-papel .s5b{grid-template-columns:1.1fr 1fr 1fr;gap:10px}' +
        '.s5-papel .s5b-col{padding-left:8px}' +
        '.s5-papel .s5b .s5-l{font-size:7px!important}' +
        '.s5-papel .s5b-val{font-size:10.5px}' +
        '.s5-papel .s5b-lst{font-size:9px;line-height:1.45}' +
        '.s5-papel .s5-nom{font-size:11px}' +
        '.s5-papel .s5-cont{font-size:8.5px;color:#78736a}' +
        '</style>';
}
// El desglose por presentación de un compuesto: se abre y se cierra desde su segundo renglón.
function _toggleCompDesg(id, btn) {
    // Las presentaciones son renglones de la misma tabla (s5-mem compDesg-<id>).
    var rows = document.querySelectorAll('tr.compDesg-' + id); if (!rows.length) return;
    var abrir = rows[0].style.display === 'none';
    rows.forEach(function (r) { r.style.display = abrir ? '' : 'none'; });
    var tr = btn && btn.closest('tr'); if (tr) tr.classList.toggle('s5-comp-abierto', abrir);
    if (btn) btn.textContent = abrir ? '▾ Ocultar desglose' : '▸ Ver desglose';
}
/* ══ EL RESULTADO EN DOS RENGLONES, POR COLUMNAS (18-nov-2026) ════════════
   Pedido de Edwin: cada producto en dos renglones que respetan las COLUMNAS
   —«con sus títulos pero definidas por columnas»—, no un texto corrido abajo.
     Producto        nombre e info            │ su stock
     Exist. anterior botellas                 │ las acciones (bateo, nota, impreso)
     Entradas        lo que entró             │ cuánto representa en dinero
     Ventas          botella · copa           │ coctelería (con lo usado en batches) y comentario
     Mermas          merma y su comentario    │ cancelaciones (informativo)
     Cortesías       cortesía y su comentario │
     Teórico         botellas                 │ copas · onzas
     Exist. actual   botellas                 │ copas · onzas
     Diferencia      cifra y su desglose      │ %
     Dif. $          a precio carta           │ a proveedor
   Copa, pieza y compuesto arman su segundo renglón con estos mismos
   ayudantes: si cada uno armara el suyo, se separarían. */
function _s5c2(lbl, html) {
    return '<div class="s5-c2"><span class="s5-l">' + lbl + '</span>' + (html === '' || html == null ? '—' : html) + '</div>';
}
function _s5sub(html) { return html ? '<span class="s5-sub">' + html + '</span>' : ''; }
// Redondeado ANTES de elegir el signo: un residuo de −0.0000001 pintaba «−$0.00».
function _s5dinero(v) { v = Math.round((parseFloat(v) || 0) * 100) / 100; return (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toFixed(2); }
/* ══ LAS OPCIONES DEL PRODUCTO, EN UN BOTÓN DE TRES PUNTOS (18-nov) ═══════
   Bateo, nota e impreso eran tres botones apilados en cada producto: 200
   productos, 600 botones, y el renglón medía el doble por ellos. Pedido de
   Edwin: un solo botón ⋯ abajo del nombre que los despliega. Lo que YA está
   marcado sí se queda a la vista (de bateo, fuera del impreso, la nota),
   porque eso es información, no un botón. */
function _s5Estado(id) {
    var h = '';
    if (esBateo(id)) h += '<span class="s5-pill" style="color:#3dbe7a;border-color:#3dbe7a">🏏 De bateo</span>';
    if (esOcultoImpreso(id)) h += '<span class="s5-pill" style="color:var(--accent);border-color:var(--accent)">🚫 Fuera del impreso</span>';
    var n = _notaInsumo(id);
    if (n) h += '<span class="s5-nota">📝 ' + etx(n) + '</span>';
    return '<div class="s5-est" id="s5est-' + id + '">' + h + '</div>';
}
/* ══ LOS COMENTARIOS, JUNTO AL ⋯ (Edwin, 19-nov) ══════════════════════════
   El de la venta iba debajo del uso en coctelería y los de merma y cortesía
   debajo de su cifra: ensuciaban las columnas de números y el hueco junto al
   ⋯ quedaba vacío. Ahora van juntos ahí, cada uno con su nombre. */
/* ══ UN BATCH ES INFORMATIVO (Edwin, 19-nov) ═══════════════════════════════
   «Las filas de prebatch solo son informativas, no deben seguir la misma
   estructura que los insumos: ese producto, tanto que se hizo, que tomó tanto
   de tales insumos, y hay tal cantidad que representa esto en cada insumo.»
   Sale de _repartoPrebatch (la misma cuenta del reparto y del consumo): lo
   que rinde un batch, cuánto lleva de cada insumo y a cuánto equivale lo que
   hay. La pantalla y el impreso usan ESTA función. */
function _cantBaseTxt(v, u) {
    u = String(u || 'ML').toUpperCase();
    if (u === 'ML') return _mlTxt(v);
    if (u === 'G') return Math.abs(v) >= 1000 ? (Math.round(v / 10) / 100) + ' kg' : Math.round(v) + ' g';
    return _fmtEquivalenteBatch(v, u);
}
function _batchInfoHTML(fila) {
    var nb = function (x) { var r = Math.round((parseFloat(x) || 0) * 100) / 100; return r % 1 ? String(r) : String(r); };
    var rep = ((_repCache && _repCache.lista) || []).find(function (x) { return x.insumoId === fila.insumoId; }) || null;
    var n = _batchesProducidos(fila.insumoId) || 0;
    var cb = _copasBotDe(fila);
    var u = rep ? rep.unidadBase : _unidadBaseBatch(fila);
    var bot = function (copas) { return cb > 0 ? nb(copas / cb) + ' bot' : ''; };
    var lista = function (xs) {
        return xs.length ? '<div class="s5b-lst">' + xs.map(function (x) { return '<div><span>' + etx(x[0]) + '</span><b>' + x[1] + '</b></div>'; }).join('') + '</div>'
                         : '<div class="s5b-sub">—</div>';
    };
    // Lo producido en el periodo
    var prodBase = rep ? n * rep.rendimientoBase : 0;
    var prodCop = _prodPrebatchUnidades(fila);
    var prodTxt = n > 0 ? nb(n) + ' batch' + (n === 1 ? '' : 'es') +
        [bot(prodCop), prodBase ? _cantBaseTxt(prodBase, u) : ''].filter(Boolean).map(function (t) { return ' · ' + t; }).join('')
        : 'Sin producción en el periodo';
    var tomo = (rep && n > 0) ? rep.desglose.map(function (d) { return [d.nombre, _cantBaseTxt(d.porBatch * n, d.unidadBase)]; }) : [];
    // Lo que hay y a cuánto equivale en cada insumo
    var fis = calcExistencia(fila);
    var fisBase = rep ? rep.fisML : fis * _basePorUnidadFila(fila);
    var hayTxt = [bot(fis), fisBase ? _cantBaseTxt(fisBase, u) : (cb > 0 ? '' : nb(fis))].filter(Boolean).join(' · ') || '0';
    var equiv = (rep && fisBase > 0) ? rep.desglose.map(function (d) { return [d.nombre, _cantBaseTxt(d.ml, d.unidadBase)]; }) : [];
    var cont = _fmtContenido(fila);
    return '<div class="s5b">' +
        '<div class="s5b-id"><div class="s5-nom">' + etx(insumoTitulo(fila)) + '</div>' +
            '<div class="s5-cont">' + ['Producción propia', cont].filter(Boolean).map(etx).join(' · ') + '</div>' +
            _s5Menu(fila.insumoId, false, _s5Comentarios(fila)) + '</div>' +
        '<div class="s5b-col"><span class="s5-l">Producido en el periodo</span><div class="s5b-val">' + prodTxt + '</div>' +
            (n > 0 ? '<span class="s5-l s5b-l2">Tomó de sus insumos</span>' + lista(tomo) : '') + '</div>' +
        '<div class="s5b-col"><span class="s5-l">Hay (existencia actual)</span><div class="s5b-val">' + hayTxt + '</div>' +
            (fisBase > 0 && equiv.length ? '<span class="s5-l s5b-l2">Equivale en sus insumos a</span>' + lista(equiv) : '') + '</div>' +
        '</div>';
}
function _s5Comentarios(f) {
    var c = [['Venta', f.ventasComentario], ['Cortesía', (parseFloat(f.cortesiaCopas) || 0) > 0 ? '' : f.cortesiaConcepto], ['Merma', f.mermaConcepto]]
        .filter(function (x) { return x[1] && String(x[1]).trim(); });
    if (!c.length) return '';
    return '<div class="s5-coms"><span class="s5-l">Comentarios</span>' +
        c.map(function (x) { return '<div><b>' + x[0] + '</b> ' + etx(String(x[1]).trim()) + '</div>'; }).join('') + '</div>';
}
/* En el IMPRESO (papel) no hay botón que tocar: en el lugar del ⋯ van solo
   los comentarios y lo marcado (bateo, nota). Lo prende _step5TablasHTML
   mientras arma la versión de papel. */
var _s5ModoPapel = false;
function _s5Menu(id, conBateo, extra) {
    if (!id) return '';
    if (_s5ModoPapel) return '<div class="s5-menu">' + (extra || '') + '</div>' + _s5Estado(id);
    return '<div class="s5-menu"><button class="s5-dots" title="Bateo, nota e impreso" aria-label="Opciones del producto" ' +
        'onclick="event.stopPropagation();_s5AbrirMenu(this,\'' + id + '\',' + (conBateo ? 1 : 0) + ')">⋯</button>' + (extra || '') + '</div>' +
        _s5Estado(id);
}
function _s5CerrarMenu() {
    var m = document.getElementById('s5Pop'); if (m) m.remove();
    document.removeEventListener('click', _s5CerrarMenu, true);
    window.removeEventListener('scroll', _s5CerrarMenu, true);
}
function _s5AbrirMenu(btn, id, conBateo) {
    var abierto = document.getElementById('s5Pop');
    var mismo = abierto && abierto.dataset.id === id;
    _s5CerrarMenu();
    if (mismo) return;                       // segundo toque en el mismo ⋯: cierra
    var b = esBateo(id), o = esOcultoImpreso(id), n = !!_notaInsumo(id);
    var op = function (fn, ico, txt) {
        return '<button onclick="_s5CerrarMenu();' + fn + '(\'' + id + '\')" style="display:flex;gap:8px;align-items:center;width:100%;' +
            'text-align:left;padding:9px 12px;border:0;border-radius:7px;background:transparent;color:var(--text);font:inherit;font-size:13px;cursor:pointer" ' +
            'onmouseover="this.style.background=\'var(--surface2)\'" onmouseout="this.style.background=\'transparent\'"><span>' + ico + '</span>' + txt + '</button>';
    };
    var m = document.createElement('div');
    m.id = 's5Pop'; m.dataset.id = id;
    m.style.cssText = 'position:fixed;z-index:10050;min-width:210px;padding:5px;border-radius:10px;border:1px solid var(--border2);' +
        'background:var(--surface);box-shadow:0 10px 28px rgba(0,0,0,.35)';
    m.innerHTML = (conBateo ? op('toggleBateo', '🏏', b ? 'Quitar de bateo' : 'Marcar de bateo') : '') +
        op('editarNotaInsumo', '📝', n ? 'Editar la nota' : 'Agregar nota') +
        op('toggleOcultoImpreso', o ? '🖨️' : '🚫', o ? 'Volver a sacarlo en el impreso' : 'Quitarlo del impreso');
    m.addEventListener('click', function (e) { e.stopPropagation(); });
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    var x = Math.min(r.left, window.innerWidth - w - 8), y = r.bottom + 4;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 4);   // sin espacio abajo: se abre hacia arriba
    m.style.left = Math.max(8, x) + 'px'; m.style.top = y + 'px';
    setTimeout(function () {
        document.addEventListener('click', _s5CerrarMenu, true);
        window.addEventListener('scroll', _s5CerrarMenu, true);
    }, 0);
}
window._s5AbrirMenu = _s5AbrirMenu; window._s5CerrarMenu = _s5CerrarMenu;
/* El stock del producto: solo CÓMO está (ideal, medio, bajo) y sus límites.
   La existencia ya está en su columna; repetirla aquí era ruido. */
/* ══ EL BATCH ES UN PUENTE (regla fija de Edwin, 21-nov) ══════════════════
   «Las recetas que usan una sub-receta/prebatch no cuentan en el uso de
   insumos; solo las que tienen al insumo directo. El uso de un insumo es: la
   venta de copas o botellas + los cócteles que lo llevan directo + lo que se
   fue en las recetas producidas de prebatch. Eso es el uso a precio
   proveedor.» Y la existencia del batch es INFORMATIVA: dice cuánto de cada
   insumo hay dentro, para saber el total; no es un resultado propio.
     · _esBatchFila: el renglón de un batch (producción propia).
     · _usoPeriodo: el uso de UN insumo, en las unidades de su renglón. La
       pantalla (resumen ejecutivo) y el reporte piden ESTA función.
     · _enBatches: lo que hay del insumo dentro de los batches (informativo). */
/* El uso de un compuesto a precio proveedor: cada presentación con SU costo. */
function _costoUsoComp(f) {
    var c = getCompuestos().find(function (x) { return x.id === f.compId; });
    return ((c && c.miembros) || []).reduce(function (t, mid) {
        var m = _filaDeMiembro(mid); return m ? t + _usoPeriodo(m, _repartoDe(m.insumoId)) * costoCopa(m) : t;
    }, 0);
}
function _esBatchFila(f) { return !!(f && !f.esCompuesto && f.insumoId && _recetaIdDePrebatch(f.insumoId)); }
function _usoPeriodo(f, adj) {
    if (!f) return 0;
    if (f.esCompuesto) {
        var c = getCompuestos().find(function (x) { return x.id === f.compId; });
        return ((c && c.miembros) || []).reduce(function (t, mid) {
            var m = _filaDeMiembro(mid); return m ? t + _usoPeriodo(m, _repartoDe(m.insumoId)) : t;
        }, 0);
    }
    if (_esBatchFila(f)) return 0;                      // un batch no tiene uso propio
    adj = adj || _repZero;
    var cb    = _copasBotDe(f, 1);
    var coct  = consumoRecetasFila(f) + (adj.vco || 0);  // solo recetas con el insumo DIRECTO
    var dir   = parseFloat(f.ventasCopasDirectas) || 0, bot = parseFloat(f.ventasBotella) || 0;
    var cort  = f.tipo === 'peso' ? 0 : (parseFloat(f.cortesiaCopas) || 0);
    var merma = (parseFloat(f.tipo === 'peso' ? f.mermaBase : f.mermaCopas) || 0) + (adj.cm || 0);
    var venta = f.tipo === 'pza' ? bot + coct + dir : coct + dir + bot * cb;
    return venta + cort + merma + _prodPBVisible(f, adj); // + lo que se fue al PRODUCIR batches
}
function _enBatches(id) { return (!_PREBATCH_REPARTE && _repCache && _repCache.porInsumo && _repCache.porInsumo[id]) || _repZero; }
/* ══ LA FÓRMULA DE EDWIN (21-nov, decisión suya) ═══════════════════════════
   Teórico = existencia anterior TOTAL (en botellas + en prebatch) + entradas
   − venta − coctelería directa − lo producido en prebatch − cortesías y
   mermas. Existencia = TOTAL REAL (en botellas + en prebatch). Diferencia =
   total real − teórico. Al teórico no le llega el prebatch del cierre: solo
   el del arranque (dentro de la anterior).
   Se le advirtió que lo que se queda dentro del batch cuenta como usado (en
   lo producido) y como existencia; él lo eligió así. Esta es la parte del
   prebatch que entra a la diferencia de un insumo: lo que hay al cierre menos
   lo que había al arrancar. */
function _difEnBatches(id) { var e = _enBatches(id); return (e.fis || 0) - (e.ea || 0); }
/* El renglón del Resultado (Edwin, 21-nov): los límites de stock bajo el
   nombre, el indicador en la existencia anterior y, abajo de la existencia
   anterior y de la actual, el desglose en botellas y onzas. */
function _s5StockInfo(fila, existencia) {
    if (!fila || fila.esCompuesto) return null;
    var st = _stockDeFila(fila, existencia == null ? calcExistencia(fila) : existencia, invActual && invActual.sucursalId);
    var txt = { ideal:'Stock ideal', intermedio:'Stock medio', bajo:'Stock bajo', revisar:'Revisar mín./máx.', 'sin-parametros':'Sin mín./máx.',
                'sin-equivalencia':'Sin equivalencia de compra', 'sin-conteo':'Sin conteo' }[st.estado] || st.estado;
    /* SOBRE STOCK (Edwin, 21-nov): el núcleo llama «ideal» a todo lo que llega
       al máximo; pasarlo es otra cosa —dinero parado— y va en amarillo. Solo
       aquí, en el indicador del Resultado: el núcleo lo usan otras pantallas. */
    if (st.estado === 'ideal' && st.maximo != null && st.actual != null && st.actual > st.maximo + 1e-9) { st.estado = 'sobre'; txt = 'Sobre stock'; }
    var col = { ideal:'var(--green)', intermedio:'var(--accent)', bajo:'var(--red)', sobre:'var(--s5-amarillo)' }[st.estado] || 'var(--text-muted)';
    return { st: st, txt: txt, col: col };
}
function _s5Limites(fila) {
    var i = _s5StockInfo(fila); if (!i || i.st.estado === 'sin-parametros') return '';
    var num = function (v) { return v == null || !isFinite(v) ? '—' : (Math.round(v * 100) / 100).toLocaleString('es-MX'); };
    return '<div class="s5-lim">Stock mín. ' + num(i.st.minimo) + ' · máx. ' + num(i.st.maximo) + ' ' + etx(i.st.unidad) + '</div>';
}
/* El indicador dice con palabras cómo está el stock (no solo un color), y cada
   existencia trae el suyo: la anterior, cómo arrancó; la actual, cómo quedó. */
function _s5Indicador(fila, existencia) {
    var i = _s5StockInfo(fila, existencia); if (!i || i.st.estado === 'sin-parametros') return '';
    return '<div class="s5-ind" data-stock="' + i.st.estado + '" style="color:' + i.col + '">' + i.txt + '</div>';
}
/* ══ LAS DOS EXISTENCIAS, IGUALES (Edwin, 21-nov) ══════════════════════════
   «Teórico 6, existencia 5.8, diferencia −4 cop… pero abajo dice +1.2 bot en
   prebatch y total 7: entonces sobra.» No sobra: esa 1.2 bot ES parte de lo
   que se fue a prebatch (el «Uso en prebatch» de abajo), que el teórico ya
   restó. El teórico es lo que debía quedar EN BOTELLAS y se compara contra lo
   contado en botellas. Para que se lea así, la anterior y la actual dicen lo
   mismo y en el mismo orden: en botellas, + prebatch, = total real, y su
   indicador de stock (sobre el total real: es lo que hay del insumo). */
function _s5ExistHTML(cant, enBat, conBat, fmt, indicador, etq, etqTotal) {
    // Abajo sin la unidad (ya va en la cifra de arriba): caben en un renglón.
    var num = function (v) { return String(fmt(v)).replace(/\s+\S+$/, ''); };
    var h = '<div class="s5-exv">' + fmt(cant) + '</div>';
    if (conBat) h += '<div class="s5-exl">' + (etq || 'en botellas') + '</div>' +
        '<div class="s5-exb">+ ' + num(enBat) + ' prebatch</div>' +
        '<div class="s5-ext">= ' + num(cant + enBat) + ' ' + (etqTotal || 'total real') + '</div>';
    return h + (indicador || '');
}
function _s5Stock(fila) {
    if (!fila || fila.esCompuesto) return '';
    var st = _stockDeFila(fila, calcExistencia(fila), invActual && invActual.sucursalId);
    var txt = { ideal:'Ideal', intermedio:'Medio', bajo:'Bajo', revisar:'Revisar mín./máx.', 'sin-parametros':'Sin mín./máx.',
                'sin-equivalencia':'Sin equivalencia de compra', 'sin-conteo':'Sin conteo' }[st.estado] || st.estado;
    var col = { ideal:'var(--green)', intermedio:'var(--accent)', bajo:'var(--red)' }[st.estado] || 'var(--text-muted)';
    var num = function (v) { return v == null || !isFinite(v) ? '—' : (Math.round(v * 100) / 100).toLocaleString('es-MX'); };
    var lim = (st.estado === 'sin-parametros') ? '' : _s5sub('Mín. ' + num(st.minimo) + ' · Máx. ' + num(st.maximo) + ' ' + etx(st.unidad));
    return '<div class="s5-c2 s5-stk" data-stock="' + st.estado + '"><span class="s5-l">Stock</span><b style="color:' + col + '">' + txt + '</b>' + lim + '</div>';
}
/* El % de la diferencia es contra el USO: lo vendido en botella y en copa,
   la coctelería y lo que se fue en batches. Si no hubo uso no hay contra qué
   dividir —y un «—» se leía como «no calculó»—, así que se mide contra el
   teórico y se dice. */
function _s5Pct(dif, uso, teorico) {
    var p = _pctVarianza(dif, uso);
    var f = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };
    if (p !== null) return { lbl: '% del uso', html: f(p) };
    if (Math.abs(dif) < 0.05) return { lbl: '% del uso', html: '0%' };
    var t = parseFloat(teorico) || 0;
    if (t > 0) return { lbl: '% del teórico', html: f(dif / t * 100) + _s5sub('sin venta ni uso') };
    return { lbl: '% del uso', html: '—' + _s5sub('sin venta ni teórico') };
}
/* Abajo de las ventas: el USO en coctelería y, en el mismo lugar, el uso en
   prebatch. Separados: el cóctel vendido y el batch producido son dos usos
   distintos del insumo, y sumados no se sabía cuánto era de cada uno. */
/* …y debajo de cada uso, cuántas BOTELLAS son (Edwin, 23-nov): «1224.4 cop»
   no dice de un vistazo cuánto producto se fue. botCoct/botPre llegan ya en
   botellas (en un compuesto, cada presentación con su botella); null = no se
   sabe (falta contenido o copa) y no se inventa. */
function _s5UsoBot(b) {
    if (b == null || !isFinite(b)) return '';
    return '≈ ' + (Math.round(b * 100) / 100).toFixed(2) + ' bot';
}
function _s5Uso(coct, prebatch, fmt, mlDe, botCoct, botPre) {
    var v = function (x) { return '<b style="color:var(--viol)">' + fmt(x) + '</b>'; };
    var subPre = [mlDe ? mlDe(prebatch) : '', _s5UsoBot(botPre)].filter(Boolean).join(' · ');
    return '<div class="s5-uso">' + _s5c2('Uso en coctelería', coct > 0.0001 ? v(coct) + _s5sub(_s5UsoBot(botCoct)) : '—') +
        (prebatch > 0.0001 ? _s5c2('Uso en prebatch', v(prebatch) + _s5sub(subPre)) : '') + '</div>';
}
/* Mililitros para leer el uso en prebatch contra la receta del batch, que
   está en ml: «30.4 cop» sola no dice que fueron 900 ml. */
function _mlTxt(ml) {
    ml = parseFloat(ml) || 0;
    return Math.abs(ml) >= 1000 ? (Math.round(ml / 10) / 100) + ' L' : Math.round(ml) + ' ml';
}
/* Copas y onzas de una cantidad en copas. Si falta el contenido o la copa,
   se enseña la equivalencia de siempre, que dice QUÉ falta capturar. */
function _eqCopOz(copas, fila, signo) {
    var e = _equivBarra(copas, fila);
    if (!e) return '';
    var cp = _nEquiv(e.copas, 1, signo), oz = _nEquiv(e.onzas, 1, signo);
    if (cp === null || oz === null) return _equivBarraHTML(copas, fila, { signo: signo }).replace(/<(\/?)div\b/g, '<$1span');
    /* Sin contenido de botella no hay botellas arriba: los LITROS sí se saben. */
    var lt = _nEquiv(e.botellas, 2, signo) === null ? _nEquiv(e.litros, 2, signo) : null;
    return (lt !== null ? lt + ' L · ' : '') + cp + ' cop · ' + oz + ' oz';
}
function _equivBarraHTML(copas, fila, opts) {
    opts = opts || {};
    var e = opts.equivalencias || _equivBarra(copas, fila);
    if (!e) return '';
    var bot = _nEquiv(e.botellas, 2, opts.signo);
    var oz  = _nEquiv(e.onzas,    1, opts.signo);
    var cp  = _nEquiv(e.copas,    1, opts.signo);
    /* Sin contenido de botella capturado no hay botellas que decir, pero los
       LITROS sí se saben: mejor «1.5 L» que un guion. */
    var lt  = (bot === null) ? _nEquiv(e.litros, 2, opts.signo) : null;
    /* Sin referencia no se inventa el número: se dice que falta, y se dice
       CUÁL falta, que es lo único accionable. */
    var faltan = e.grupo ? e.faltan : [];
    if (!e.grupo) {
        if (e.contNeto === null && e.ml === null) faltan.push('el contenido de la botella');
        if (e.copaML   === null) faltan.push('el tamaño de la copa');
    }
    /* `sinCopas`: cuando la cifra de arriba YA está en copas (la diferencia),
       repetirlas abajo sobra: el desglose va en botellas y onzas (Edwin, 21-nov). */
    var partes = [
        bot !== null ? bot + ' bot' : (lt !== null ? lt + ' L' : '— bot'),
        (oz  === null ? '—' : oz)  + ' oz'
    ].concat(opts.sinCopas ? [] : [(cp === null ? '—' : cp) + ' cp']).join(' · ');
    var ref = e.grupo ? 'suma por presentación, con su propia botella y copa' :
              [e.contNeto !== null ? _fmtBase(e.contNeto) + ' ml/bot' : null,
               e.copaML   !== null ? _fmtBase(e.copaML)   + ' ml/copa' : null]
              .filter(Boolean).join(' · ');
    var titulo = faltan.length
        ? 'Falta capturar ' + faltan.join(' y ') + (e.grupo ? ' de una o más presentaciones' : ' de este insumo') + ': sin eso no se puede convertir.'
        : 'La MISMA cantidad, leída de tres maneras (no se suman). Referencia: ' + ref;
    /* En el IMPRESO no hay variables de tema ni se puede pasar el ratón por
       encima: el papel se imprime en escala de grises y el `title` no existe
       ahí. Mismo texto, colores fijos y sin cursor de ayuda. */
    if (opts.impreso)
        return '<div style="font-size:8.5px;color:#56514a;white-space:nowrap">≈ ' + partes + '</div>';
    return '<div style="font-size:9px;color:var(--text-dim);white-space:nowrap;margin-top:2px;cursor:help"' +
        ' title="' + etx(titulo) + '">≈ ' + partes + '</div>';
}

/* Diagnóstico manual: en la consola del Paso 5, `diagInsumo('vodka')` imprime
   toda la cadena de un insumo — su fila, qué recetas lo llevan y con qué id,
   cuántas se vendieron, si entra por una sub-receta y qué le tocó del batch.
   Es para no adivinar desde capturas cuando una columna sale en cero. */
window.diagInsumo = function (q) {
    q = String(q || '').toLowerCase();
    var f = (filasCaptura || []).find(function (x) { return (x.nombre || '').toLowerCase().indexOf(q) >= 0; });
    if (!f) return '❌ Ninguna fila del inventario se llama así. Filas: ' +
        (filasCaptura || []).slice(0, 10).map(function (x) { return x.nombre; }).join(' · ');
    var cid = _midCanon(f.insumoId);
    var vendidos = (invActual && invActual.cocktailsVendidos) || {};
    var usan = (getRecetas() || []).filter(function (r) {
        return (r.ingredientes || []).some(function (i) { return i && i.insumoId && _midCanon(i.insumoId) === cid; });
    }).map(function (r) {
        var ing = (r.ingredientes || []).find(function (i) { return i && i.insumoId && _midCanon(i.insumoId) === cid; }) || {};
        return { receta: r.nombre, tipo: r.tipo, vendidos: parseFloat(vendidos[r.id]) || 0,
                 cantidad: ing.cantidad + ' ' + (ing.unidad || ''), idEnLaReceta: ing.insumoId,
                 mismoIdQueLaFila: ing.insumoId === f.insumoId };
    });
    if (!_repCache) { try { _repCache = _repartoPrebatch(); } catch (e) {} }
    return {
        fila: { nombre: f.nombre, id: f.insumoId, idCanonico: cid, tipo: f.tipo, copaML: f.copaML, contNeto: f.contNeto },
        consumoDirectoPorRecetas: (function () { try { return consumoRecetasFila(f); } catch (e) { return 'error'; } })(),
        loQueLeTocaDeAlgunBatch: _repartoDe(f.insumoId),
        recetasQueLoLlevan: usan.length ? usan : 'NINGUNA receta lo lleva como ingrediente',
        prebatchesContadosEnEsteInventario: ((_repCache && _repCache.lista) || []).map(function (x) { return x.nombre; }),
        nota: 'Si "recetasQueLoLlevan" tiene la sub-receta pero "prebatchesContadosEnEsteInventario" NO la incluye, el batch no se está contando en este inventario y por eso no reparte.'
    };
};

/* ── ¿De dónde sale (o por qué NO sale) el consumo de un insumo? ────────
   Cuando la coctelería marca "—" no hay forma de saber si es que ningún coctel
   lo lleva, si los cocteles que lo llevan no se vendieron, o si el ingrediente
   quedó desligado. Esto lo dice en el propio renglón, al pasar el mouse. */
function _origenConsumo(fila) {
    if (!fila || !fila.insumoId) return '';
    var cid = _midCanon(fila.insumoId);
    var vendidos = (invActual && invActual.cocktailsVendidos) || {};
    var usan = [], usanSinVenta = [], viaSub = [];
    (getRecetas() || []).forEach(function (r) {
        if (!r || !(r.ingredientes || []).length) return;
        var lleva = (r.ingredientes || []).some(function (ing) {
            return ing && ing.insumoId && _midCanon(ing.insumoId) === cid;
        });
        if (!lleva) return;
        var uds = parseFloat(vendidos[r.id]) || 0;
        var esSub = /^sub/.test(r.tipo || '');
        if (esSub) viaSub.push(r.nombre || 'sub-receta');
        else if (uds > 0) usan.push((r.nombre || 'receta') + ' ×' + uds);
        else usanSinVenta.push(r.nombre || 'receta');
    });
    if (!usan.length && !usanSinVenta.length && !viaSub.length)
        return 'Ninguna receta lo lleva como ingrediente.';
    var partes = [];
    if (usan.length)        partes.push('Vendidos: ' + usan.slice(0, 6).join(', ') + (usan.length > 6 ? '…' : ''));
    if (usanSinVenta.length)partes.push('Sin ventas capturadas en este inventario: ' + usanSinVenta.slice(0, 6).join(', ') + (usanSinVenta.length > 6 ? '…' : ''));
    if (viaSub.length)      partes.push('Entra por la sub-receta: ' + viaSub.slice(0, 4).join(', ') + ' (su consumo se reparte al producir el batch)');
    return partes.join(' · ');
}

/* ── Ingredientes de receta que no apuntan a ningún insumo ─────────────
   Si un ingrediente quedó apuntando a un insumo que ya no existe en este
   negocio/sucursal, su consumo NO se descuenta del inventario: la coctelería
   sale en cero y el teórico queda inflado, sin ninguna señal de por qué. Esto
   los junta para poder arreglarlos de una, en vez de ir receta por receta.
   Solo mira las recetas que SE VENDIERON en este inventario: las demás no
   afectan el resultado. */
function _ingredientesSinEnlace() {
    var vendidos = (invActual && invActual.cocktailsVendidos) || {};
    var porIns = {};
    (getRecetas() || []).forEach(function (r) {
        if (!r || !(parseFloat(vendidos[r.id]) > 0)) return;
        (r.ingredientes || []).forEach(function (ing) {
            if (!ing || !ing.insumoId) return;
            var res = (typeof window._insumoResolver === 'function') ? window._insumoResolver(ing.insumoId) : null;
            if (res) return;                       // resuelve: todo bien
            if (_filaDeMiembro(ing.insumoId)) return; // está en la captura por id canónico
            var k = ing.insumoId;
            if (!porIns[k]) porIns[k] = { nombre: ing.nombre || '(sin nombre)', recetas: [] };
            if (porIns[k].recetas.indexOf(r.nombre) < 0) porIns[k].recetas.push(r.nombre);
        });
    });
    return Object.keys(porIns).map(function (k) { return porIns[k]; });
}
function _avisoEnlacesHTML() {
    var rotos;
    try { rotos = _ingredientesSinEnlace(); } catch (e) { return ''; }
    if (!rotos.length) return '';
    var lista = rotos.slice(0, 6).map(function (x) {
        return '<li style="margin-top:3px"><b>' + etx(x.nombre) + '</b> — en ' +
            etx(x.recetas.slice(0, 3).join(', ')) + (x.recetas.length > 3 ? ' y ' + (x.recetas.length - 3) + ' más' : '') + '</li>';
    }).join('');
    return '<div style="margin:8px 16px 4px;padding:12px 14px;border:1px solid rgba(245,200,66,.45);' +
        'background:rgba(245,200,66,.07);border-radius:10px;font-size:12.5px;color:var(--text);line-height:1.55">' +
        '<b>⚠️ ' + rotos.length + ' ingrediente' + (rotos.length !== 1 ? 's' : '') + ' de receta sin insumo</b>' +
        '<div style="color:var(--text-dim);font-size:11.5px;margin-top:3px">Su consumo NO se está descontando: la coctelería sale en cero y el teórico queda alto. ' +
        'Ábrelos en la receta y vuelve a elegir el insumo del catálogo (una vez por ingrediente, no por receta).</div>' +
        '<ul style="margin:6px 0 0 18px;color:var(--text-muted)">' + lista +
        (rotos.length > 6 ? '<li style="margin-top:3px;opacity:.7">…y ' + (rotos.length - 6) + ' más</li>' : '') + '</ul></div>';
}

/* ══ EL IMPRESO ES LA MISMA TABLA (Edwin, 19-nov) ═════════════════════════
   «Deben verse igual el Paso 5 y el reporte impreso en el desglose de
   insumos.» El desglose impreso tenía su propio armador, con otras columnas,
   y se separaba de la pantalla en cada ajuste. Ahora el impreso pide ESTA
   función con {papel:true}: mismos renglones, mismas cuentas. Lo que cambia
   en papel: todo el inventario (sin los filtros de la pantalla, menos lo
   marcado «fuera del impreso»), sin botones, colores de papel y, en el
   gerencial (sinCostos), sin el costo de las entradas ni la diferencia a
   proveedor. */
/* La diferencia de un renglón tal como la pinta la tabla (fórmula de Edwin):
   para elegir faltantes y sobrantes con el MISMO número que se ve. */
function _difFilaS5(f) { return calcDiferencia(f) + _repartoDe(f.insumoId).dif + _difEnBatches(f.insumoId); }
function _difCompS5(vf) {
    var c = getCompuestos().find(function (x) { return x.id === vf.compId; });
    return calcDiferencia(vf) + _miembrosFila(c).reduce(function (t, m) { return t + _difEnBatches(m.insumoId); }, 0);
}
function _pasaSignoS5(d, signo) { return signo === 'falta' ? d < -0.05 : signo === 'sobra' ? d > 0.05 : true; }
function _step5TablasHTML(opts) {
    var _antes = _s5ModoPapel;
    _s5ModoPapel = !!(opts && opts.papel);
    try { return _step5TablasArmar(opts || {}); } finally { _s5ModoPapel = _antes; }
}
function _step5TablasArmar(opts) {
    const papel  = !!opts.papel;
    const _costoOk = !(papel && opts.sinCostos);
    const q      = papel ? '' : (_busqStep5 || '').toLowerCase();
    const mapaC5 = _compDeInsumo();
    _repCache    = _repartoPrebatch(); // reparto prebatch→insumos (fresco por render)
    const vcomps = _compuestosActivos().map(_virtualFilaCompuesto)
        .filter(vf => papel ? (!esOcultoImpreso(vf.compId || vf.insumoId) && (!opts.dif || _pasaSignoS5(_difCompS5(vf), opts.dif))) : _pasaSeleccionS5(vf));
    if (!papel && _step5Modo === 'galeria') return _step5GaleriaHTML(q, mapaC5, vcomps);

    // 5.5 · 2.4 · 3 — un decimal cuando hace falta, entero cuando no. El módulo
    // sobre el crudo dejaba pasar la basura de punto flotante (6.0000001 → "6.0").
    const _nc  = v => { const r = Math.round((parseFloat(v)||0) * 10) / 10; return r % 1 ? r.toFixed(1) : String(r); };
    const GPROD = '🏭 Producción propia';

    // ── Agrupar TODO por categoría. Bebidas con copa → tabla "copa"; secos/pza →
    //    tabla "pza"; compuestos → la categoría de su primer miembro. Los prebatch
    //    repartidos NO entran aquí: van al grupo "Producción propia" (opción A).
    const grupos = {};
    const _ens = g => (grupos[g] || (grupos[g] = { copa:[], pza:[], comp:[] }));
    filasCaptura.forEach(f => {
        if (mapaC5[f.insumoId]) return;                 // miembro de compuesto → sale en su compuesto
        if (_esPrebatchRepartido(f.insumoId)) return;   // prebatch → Producción propia
        if (papel) {
            if (esOcultoImpreso(f.insumoId)) return;
            // Faltantes / sobrantes del reporte: por el signo de SU diferencia; el batch no tiene.
            if (opts.dif && (_esBatchFila(f) || !_pasaSignoS5(_difFilaS5(f), opts.dif))) return;
        }
        else {
            if (q && !(f.nombre||'').toLowerCase().includes(q)) return;
            if (_subcatStep5 && (f.subcategoria||f.categoria) !== _subcatStep5) return;
            if (!_pasaDifS5(f)) return;
        }
        const b = _ens(_grupoCategoria(f));
        (f.tipo === 'copa' ? b.copa : b.pza).push(f);
    });
    vcomps.forEach(vf => {
        const comp = getCompuestos().find(c => c.id === vf.compId) || {};
        const m0   = (comp.miembros||[]).map(_filaDeMiembro).find(Boolean);
        if (!papel && !_pasaSeleccionS5(vf)) return;
        _ens(m0 ? _grupoCategoria(m0) : '🧩 Compuestos').comp.push(vf);
    });

    /* Lo que se fue en PRODUCIR batches va COMO SEGUNDA LÍNEA, no sumado dentro de
       la cifra. Las dos cosas importan y se estorban si se juntan en un solo número:
       la suma tiene que cuadrar con el teórico de al lado (todas las columnas del
       renglón ya traen la parte del batch), pero el encargado necesita ver que 4 L
       de vodka se fueron a los batches — si no, la celda no explica el renglón.
       Cuando el prebatch NO se está repartiendo, esa producción SÍ va dentro de la
       cifra (es lo único que se llevó el insumo) y entonces no se repite abajo. */
    /* ══ UN BATCH NO SE MIDE EN COPAS ═════════════════════════════════════
       Esta línea decía «↳ 77.8 cop en batches». El número estaba bien —3500 ml
       entre copas de 45— pero nadie sirve un batch con el copero: la receta
       dice 1.75 LT por batch y lo que se vació fueron DOS BOTELLAS.

       Traducir a copas obliga a deshacer la cuenta en la cabeza justo cuando
       se está revisando si cuadra. Va en la unidad en la que se vertió, y la
       equivalencia en botellas al lado, que es como se cuenta en la bodega. */
    function _lineaProd(fila, prodVer, prodMat, txt) {
        if (!(prodVer > 0) || prodMat > 0) return '';
        var cop = parseFloat(fila.copaML) || 0;
        var cn  = parseFloat(fila.contNeto) || 0;
        var ml  = prodVer * cop;
        var leg = txt;
        if (fila.tipo === 'pza' || fila.tipo === 'peso') {
            leg = _fmtEquivalenteBatch(prodVer * _basePorUnidadFila(fila), _unidadBaseDeFila(fila));
            if (fila.tipo === 'pza') leg += ' · ' + _nc(prodVer) + ' pza';
        } else if (cop > 0 && ml > 0) {
            var n1 = function (x) { var r = Math.round(x * 10) / 10; return r % 1 ? r.toFixed(1) : String(r); };
            leg = (ml >= 1000 ? n1(ml / 1000) + ' L' : n1(ml) + ' ml');
            if (cn > 0) leg += ' · ' + n1(ml / cn) + ' bot';
        }
        return '<div style="font-size:9.5px;opacity:.7;font-weight:500;white-space:nowrap"' +
               ' title="' + etx(txt) + ' — la receta del batch pide ' +
               (cop > 0 ? etx(leg) : etx(txt)) + '">↳ ' + leg + ' en batches</div>';
    }
    function _tituloCoct(fila, prodVer, prodMat) {
        if (!(prodVer > 0)) return _origenConsumo(fila);
        var t = (fila.tipo === 'copa' ? _fmtCop(prodVer, fila) :
            _fmtEquivalenteBatch(prodVer, fila.tipo === 'pza' ? 'PZA' : fila.baseUnit || 'G')) +
            ' se fueron en producir batches de sub-receta.';
        if (prodMat > 0) return t + ' Van sumadas aquí: lo que se usa al producir un batch es consumo de este insumo.';
        return t + ' NO se suman a la cifra de arriba porque ese producto sigue contado ' +
               'dentro del batch — su parte ya viene en el teórico y en el físico de este renglón.';
    }

    // ── Constructor de fila COPA (bebida con botella y copa) ──
    function _rowCopa(fila) {
        const adj       = _repartoDe(fila.insumoId);
        const ea        = (parseFloat(fila.existenciaAnterior) || 0) + adj.ea;
        const copasBot  = fila.contNeto>0 && fila.copaML>0 ? fila.contNeto/fila.copaML : 0;
        const entBot    = getEntradasBottles(fila.insumoId) + (copasBot > 0 ? adj.ent / copasBot : 0);
        const ventaBot  = parseFloat(fila.ventasBotella) || 0;
        /* Lo que se fue en PRODUCIR batches de una sub-receta que lleva este insumo.
           El teórico siempre lo restó, pero la columna no lo enseñaba: un tinto
           usado en 24 batches de "Tinto de Verano" salía con coctelería en "—" y
           una diferencia enorme sin explicación a la vista. */
        /* Dos números distintos a propósito:
           · prodPBmat es lo que SUMA a la coctelería, y vale 0 cuando el reparto
             del batch ya le devuelve al insumo su parte (si no, se contaría el
             mismo vino dos veces: el que entró al batch y el que salió vendido
             del batch).
           · prodPBver es cuánto se fue en producir batches. Se ENSEÑA siempre, en
             su propia línea (_lineaProd), no sumado dentro de la cifra: sumarlo
             dejaba el renglón sin cuadrar, porque todas las demás columnas (EA,
             entradas, teórico, físico) ya vienen con la parte del batch incluida
             y EA − coctelería daba 2 L menos que el teórico de al lado. */
        const prodPBmat    = _prodPBVisible(fila, adj);
        const prodPBver    = (function () { try { return _consumoBaseProd(fila) || 0; } catch (e) { return 0; } })();
        const ventaCoct    = consumoRecetasFila(fila) + adj.vco + prodPBmat;
        const ventaCopaDir = parseFloat(fila.ventasCopasDirectas) || 0;
        const ventaCopa    = ventaCoct + ventaCopaDir;
        const cortesia  = parseFloat(fila.cortesiaCopas) || 0;
        const merma     = parseFloat(fila.mermaCopas)    || 0;
        const cmTotal   = cortesia + merma + adj.cm;
        const cmConc    = [fila.cortesiaConcepto, fila.mermaConcepto].filter(Boolean).join(' / ');
        const cancelCop = getCancelacionesCopas(fila.insumoId);
        /* ══ TOTAL CONTRA TOTAL (Edwin, 21-nov) ══════════════════════════════
           `teorico` y `fisico` son EN BOTELLAS (lo que se cuenta en el anaquel).
           Lo que hay del insumo dentro de los batches (_enB) se suma a los DOS
           lados: al teórico, lo que DEBERÍA haber en prebatch (lo producido
           menos lo que se llevaron los cocteles capturados) y a la existencia,
           lo que HAY. La diferencia es total contra total; abajo dice cuánto es
           de botellas y cuánto de prebatch. Así no se cuenta nada dos veces. */
        const _enB      = _enBatches(fila.insumoId);
        const teorico   = calcExistenciaTeorica(fila) + adj.teo;
        const fisico    = calcExistencia(fila) + adj.fis;
        const dif       = (fisico + _enB.fis) - (teorico + _enB.ea);   // la fórmula de Edwin (ver _difEnBatches)
        const difCosto  = dif * (fila.precioCarta || 0);
        const color     = Math.abs(dif) < 0.05 ? 'var(--text-dim)' : (dif > 0 ? 'var(--green)' : 'var(--red)');
        const pctVal    = _pctVarianza(dif, _usoTotal(ventaCopa + ventaBot * copasBot, prodPBver, prodPBmat));
        const pctStr    = pctVal !== null ? (pctVal>=0?'+':'')+pctVal.toFixed(1)+'%' : '—';
        const eaBot     = copasBot > 0 ? (ea/copasBot).toFixed(2) : ea.toFixed(1);
        /* ══ POR QUÉ EL PASO 1 DICE 1.4 Y ESTE RENGLÓN DICE 3.3 ══════════════
           Porque parte de este producto NO está en sus botellas: está dentro
           de un batch. El Limoncello que hay en la barra lleva vodka adentro, y
           el modelo le devuelve al vodka su parte —en la existencia anterior,
           en el físico y en el teórico— para que la diferencia salga sobre
           TODO el vodka del negocio y no solo sobre el que quedó embotellado.

           La cuenta estaba bien; lo que faltaba era decirlo. Dos pantallas del
           mismo producto con números distintos y sin una línea que lo explique
           no es un modelo, es un error aparente. */
        const _nb = (v) => { const r = Math.round(v * 10) / 10; return r % 1 ? r.toFixed(1) : String(r); };
        const _dentroBat = (copas) => {   // solo el modelo de reparto; el de consumo usa _s5ExistHTML
            if (!(Math.abs(copas) > 0.05) || !(copasBot > 0)) return '';
            /* En botellas Y en litros. Se compara contra la receta del batch,
               que está en litros, y contra la bodega, que cuenta botellas: dar
               solo una de las dos obliga a convertir en la cabeza. */
            var _ml = copas * (parseFloat(fila.copaML) || 0);
            var _lt = _ml ? '  ·  ' + (Math.abs(_ml) >= 1000 ? _nb(_ml / 1000) + ' L' : _nb(_ml) + ' ml') : '';
            return '<div class="s5-mini" style="font-size:9px;opacity:.7;white-space:nowrap" title="Este producto' +
                ' está dentro de un batch (una sub-receta de producción propia). Su parte se le' +
                ' devuelve aquí para que la diferencia mire TODO el producto, no solo el' +
                ' embotellado.">↳ ' + _nb(copas / copasBot) + ' bot' + _lt + ' del insumo en batches</div>';
        };
        // Hay algo del insumo en batches (al empezar, en el teórico o al cerrar): las tres lo dicen igual.
        const _conBat = !_PREBATCH_REPARTE && (Math.abs(_enB.ea) > 0.05 || Math.abs(_enB.fis) > 0.05);
        const _botTxt = (c) => copasBot > 0 ? (Math.round(c / copasBot * 100) / 100).toFixed(2) + ' bot' : _fmtCop(c, fila);
        const entBotStr = entBot > 0 ? `+${entBot % 1 ? entBot.toFixed(1) : entBot} ${_unidadCompra(fila)}` : '—';
        /* Lo PRODUCIDO, si el renglón es un batch: para él es una entrada (suma a
           su teórico). Sin enseñarlo, el teórico del batch sale de la nada. */
        const _prodC  = _prodPrebatchUnidades(fila);
        const prodStr = _prodC > 0 ? '<div class="s5-mini" style="font-size:9.5px;opacity:.85;white-space:nowrap" title="Capturado en el Paso 3 (producción de prebatch). Para el batch es una entrada.">↳ +' +
            (copasBot > 0 ? _nb(_prodC / copasBot) + ' bot · ' : '') + _fmtCop(_prodC, fila) + ' producido</div>' : '';
        const fisicoBot = copasBot > 0 ? (fisico/copasBot).toFixed(2) : fisico.toFixed(1);
        const difStr    = _fmtCopSgn(dif, fila);
        const _contC = _fmtContenido(fila);
        const teoBotS   = copasBot > 0 ? (teorico / copasBot).toFixed(2) + ' bot' : _fmtCop(teorico, fila);
        const fisBotS   = copasBot > 0 ? fisicoBot + ' bot' : _fmtCop(fisico, fila);
        const entDinero = getEntradasCopas(fila) * costoCopa(fila);          // lo que entró, a costo
        /* La diferencia trae su desglose COMPLETO (botellas · onzas · copas),
           el de siempre; teórico y existencia, copas · onzas abajo. */
        const eqDif     = _equivBarraHTML(dif, fila, {signo:true, impreso:papel, sinCopas:true}).replace(/<(\/?)div\b/g, '<$1span');
        /* ══ DOS RENGLONES POR COLUMNAS, CADA CELDA CON SU TÍTULO (18-nov) ═══
           Arriba: existencia anterior, entradas, venta botella, venta copa,
           mermas, cancelaciones, teórico, existencia actual, diferencia y su
           dinero a carta. Abajo, en la misma columna: el ⋯ de opciones, el
           stock, el costo de lo que entró, el uso en coctelería y en prebatch,
           las cortesías, copas · onzas, el % contra el uso y el dinero a
           proveedor. */
        const pc       = _s5Pct(dif, _usoTotal(ventaCopa + ventaBot * copasBot, prodPBver, prodPBmat), teorico + _enB.ea);
        // De dónde sale la diferencia: botellas contra botellas y lo que cambió el prebatch (cierre − arranque).
        const _difPartes = _conBat ? '<div class="s5-exl">botellas ' + _fmtCopSgn(fisico - teorico, fila) + ' · prebatch ' + _fmtCopSgn(_enB.fis - _enB.ea, fila) + '</div>' : '';
        const coctSolo = Math.max(0, ventaCoct - prodPBmat);        // la coctelería sin lo de los batches
        const _fc      = (v) => _fmtCop(v, fila);
        const html = `<tr class="s5-r1">
                <td style="min-width:150px">
                    <div class="s5-nom">${etx(insumoTitulo(fila))}</div>
                    <div class="s5-cont">${[fila.categoria||'', _contC ? _contC + (fila.tipo==='copa'&&parseFloat(fila.copaML)>0 ? ' · copa de ' + _fmtBase(parseFloat(fila.copaML)) + ' ml' : '') : ''].filter(Boolean).map(etx).join(' · ')}</div>
                    ${_s5Limites(fila)}
                    ${(function(){
                        /* ══ UN RENGLÓN SIN INSUMO DETRÁS ══════════════════════
                           El inventario guarda sus renglones cuando se abre. Si
                           después se borra ese insumo del catálogo, el renglón
                           sigue aquí con su existencia anterior — y arrastra un
                           faltante de un producto que ya no existe, sin que
                           nada diga por qué sigue apareciendo. Le pasó con un
                           vodka viejo: «ya revisé y no sé por qué sigue». */
                        var _vivo = (typeof window._insumoResolver === 'function')
                            ? window._insumoResolver(fila.insumoId) : null;
                        if (_vivo) return '';
                        return '<div class="s5-mini" style="font-size:9.5px;color:var(--accent);margin-top:2px;' +
                            'line-height:1.5" title="Este renglón quedó del día que se abrió el ' +
                            'inventario. El insumo ya no está en el catálogo, así que su faltante ' +
                            'no lo explica nadie.">⚠️ este insumo ya no está en el catálogo</div>';
                    })()}
                </td>
                <td style="text-align:center">${_s5c2('Exist. anterior', _PREBATCH_REPARTE ? eaBot + ' bot' + _s5Indicador(fila, ea) + _dentroBat(adj.ea)
                    : _s5ExistHTML(ea, _enB.ea, _conBat, _botTxt, _s5Indicador(fila, ea + _enB.ea)))}</td>
                <td style="text-align:center;color:var(--green)">${_s5c2('Entradas', entBotStr + prodStr)}</td>
                <td style="text-align:center;color:var(--accent)">${_s5c2('Venta botella', ventaBot > 0 ? ventaBot + ' bot' : '—')}</td>
                <td class="s5-vc" style="text-align:center;color:var(--accent)">${_s5c2('Venta copa', ventaCopaDir > 0 ? _fc(ventaCopaDir) : '—')}</td>
                <td style="text-align:center;color:${merma > 0 ? 'var(--red)' : 'inherit'};font-weight:${merma > 0 ? 600 : 400}">${_s5c2('Mermas', (merma > 0 ? _fc(merma) : '—'))}</td>
                <td style="text-align:center">${_s5c2('Teórico', _conBat ? _botTxt(teorico + _enB.ea) : teoBotS)}</td>
                <td style="text-align:center;font-weight:600">${_s5c2('Exist. actual', _PREBATCH_REPARTE ? fisBotS + _s5Indicador(fila, fisico) + _dentroBat(adj.fis)
                    : _s5ExistHTML(fisico, _enB.fis, _conBat, _botTxt, _s5Indicador(fila, fisico + _enB.fis)))}</td>
                <td style="text-align:center;font-weight:700;color:${color}">${_s5c2('Diferencia', difStr + _difPartes + (eqDif ? _s5sub(eqDif) : ''))}</td>
                <td style="text-align:right;font-weight:600;color:${color}">${_s5c2('A carta', _s5dinero(difCosto))}</td>
            </tr>
            <tr class="s5-r2">
                <td>${_s5Menu(fila.insumoId, true, _s5Comentarios(fila))}</td>
                <td style="text-align:center">${_s5c2('Desglose', (_eqCopOz(ea, fila) || '—') + (_conBat ? _s5sub('total ' + _eqCopOz(ea + _enB.ea, fila)) : ''))}</td>
                <td style="text-align:center">${_costoOk ? _s5c2('Costo', entDinero > 0 ? '<b>' + _s5dinero(entDinero).replace('+', '') + '</b>' : '—') : ''}</td>
                <td colspan="2" style="text-align:center;cursor:help" title="${etx(_tituloCoct(fila, prodPBver, prodPBmat))}">${_s5Uso(coctSolo, prodPBver, _fc, parseFloat(fila.copaML) > 0 ? (x) => _mlTxt(x * parseFloat(fila.copaML)) : null,
                    copasBot > 0 ? coctSolo / copasBot : null, copasBot > 0 ? prodPBver / copasBot : null)}</td>
                <td style="text-align:center">${_s5CortCelda(_cortPartes(fila), cortesia, _fc)}</td>
                <td style="text-align:center">${_s5c2('Desglose', _eqCopOz(teorico + (_conBat ? _enB.ea : 0), fila))}</td>
                <td style="text-align:center">${_s5c2('Desglose', _eqCopOz(fisico, fila) + (_conBat ? _s5sub('total ' + _eqCopOz(fisico + _enB.fis, fila)) : ''))}</td>
                <td style="text-align:center;color:${color}">${_s5c2(pc.lbl, pc.html)}</td>
                <td style="text-align:right;color:${color};white-space:nowrap">${_costoOk ? _s5c2('A proveedor', '<b style="color:inherit">' + _s5dinero(dif * costoCopa(fila)) + '</b>') : ''}</td>
            </tr>`;
        return { html, dif, difCosto, vend: ventaCopa + ventaBot * copasBot };
    }

    // ── Constructor de fila PZA (secos: refrescos en lata, cervezas, etc.) ──
    function _rowPza(fila) {
        const adjP      = _repartoDe(fila.insumoId);
        const peso      = fila.tipo === 'peso';
        const unidad    = peso ? fila.baseUnit || 'G' : 'PZA';
        // Dos decimales a la vista: la parte en prebatch da fracciones largas («4.1664 pza»).
        const cant      = v => _fmtEquivalenteBatch(Math.round((parseFloat(v) || 0) * 100) / 100, unidad);
        /* EA y entradas con su parte del batch, igual que el teórico y el físico de
           abajo. Sin sumarlas, un refresco que además vive dentro de una sub-receta
           enseñaba una existencia anterior más chica que la que su propio teórico
           daba por buena — el renglón de pieza era el único que no cuadraba. */
        const ea        = (parseFloat(fila.existenciaAnterior) || 0) + adjP.ea;
        const entTotal  = (peso ? getEntradasBottles(fila.insumoId) : getEntradasCopas(fila)) + adjP.ent;
        const prodPBpMat = _prodPBVisible(fila, adjP);
        const prodPBpVer = (function () { try { return _consumoBaseProd(fila) || 0; } catch (e) { return 0; } })();
        const ventaCoct = consumoRecetasFila(fila) + adjP.vco + prodPBpMat;
        const ventasDir = peso ? 0 : (fila.ventasBotella || 0) + (parseFloat(fila.ventasCopasDirectas)||0);
        const ventas    = ventasDir + ventaCoct;
        const cancelPza = getCancelacionesCopas(fila.insumoId);
        const cortMerma = (peso ? (parseFloat(fila.mermaBase) || 0) :
            (parseFloat(fila.cortesiaCopas) || 0) + (parseFloat(fila.mermaCopas) || 0)) + adjP.cm;
        const _enBP     = _enBatches(fila.insumoId);   // total contra total (ver _rowCopa)
        const teorico   = calcExistenciaTeorica(fila) + adjP.teo;
        const fisico    = calcExistencia(fila) + adjP.fis;
        const dif       = (fisico + _enBP.fis) - (teorico + _enBP.ea);   // la fórmula de Edwin
        const difCosto  = dif * (fila.precioCarta || 0);
        const color     = Math.abs(dif) < 0.05 ? 'var(--text-dim)' : (dif > 0 ? 'var(--green)' : 'var(--red)');
        const pctVal    = _pctVarianza(dif, _usoTotal(ventas, prodPBpVer, prodPBpMat));
        const pctStr    = pctVal !== null ? (pctVal>=0?'+':'')+pctVal.toFixed(1)+'%' : '—';
        const _contP = _fmtContenido(fila);
        /* Mermas y cortesías van en columnas distintas, cada una con su
           comentario (antes salían sumadas en una sola). En alimentos por peso
           solo hay merma. */
        const mermaP    = (peso ? (parseFloat(fila.mermaBase) || 0) : (parseFloat(fila.mermaCopas) || 0)) + adjP.cm;
        const cortP     = peso ? 0 : (parseFloat(fila.cortesiaCopas) || 0);
        const entDinP   = entTotal * costoCopa(fila);                       // lo que entró, a costo
        const _prodP    = _prodPrebatchUnidades(fila);
        const pc        = _s5Pct(dif, _usoTotal(ventas, prodPBpVer, prodPBpMat), teorico + _enBP.ea);
        const coctSoloP = Math.max(0, ventaCoct - prodPBpMat);
        // Lo que hay de este insumo dentro de los batches: informativo, con el total.
        const _conBatP = !_PREBATCH_REPARTE && (Math.abs(_enBP.ea) > 0.005 || Math.abs(_enBP.fis) > 0.005);
        const html = `<tr class="s5-r1">
                <td style="min-width:150px">
                    <div class="s5-nom">${etx(insumoTitulo(fila))}</div>
                    <div class="s5-cont">${[fila.categoria||'', _contP||''].filter(Boolean).map(etx).join(' · ')}</div>
                    ${_s5Limites(fila)}
                </td>
                <td style="text-align:center">${_s5c2('Exist. anterior', _s5ExistHTML(ea, _enBP.ea, _conBatP, cant, _s5Indicador(fila, ea + _enBP.ea), 'en piezas'))}</td>
                <td style="text-align:center;color:var(--green)">${_s5c2('Entradas', (entTotal>0?'+'+cant(entTotal):'—') + (_prodP>0?'<div class="s5-mini" style="font-size:9.5px;opacity:.85;white-space:nowrap" title="Capturado en el Paso 3 (producción de prebatch). Para el batch es una entrada.">↳ +'+cant(_prodP)+' producido</div>':''))}</td>
                <td style="text-align:center;color:var(--accent)">${_s5c2('Ventas', ventasDir>0?cant(ventasDir):'—')}</td>
                <td style="text-align:center;color:${mermaP>0?'var(--red)':'inherit'};font-weight:${mermaP>0?600:400}">${_s5c2('Mermas', (mermaP>0?cant(mermaP):'—'))}</td>
                <td style="text-align:center">${_s5c2('Teórico', cant(teorico + (_conBatP ? _enBP.ea : 0)))}</td>
                <td style="text-align:center;font-weight:600">${_s5c2('Exist. actual', _s5ExistHTML(fisico, _enBP.fis, _conBatP, cant, _s5Indicador(fila, fisico + _enBP.fis), 'en piezas'))}</td>
                <td style="text-align:center;font-weight:700;color:${color}">${_s5c2('Diferencia', (dif>=0?'+':'') + cant(dif) +
                    (_conBatP ? '<div class="s5-exl">piezas ' + ((fisico - teorico) >= 0 ? '+' : '') + cant(fisico - teorico) + ' · prebatch ' + ((_enBP.fis - _enBP.ea) >= 0 ? '+' : '') + cant(_enBP.fis - _enBP.ea) + '</div>' : ''))}</td>
                <td style="text-align:right;font-weight:600;color:${color}">${_s5c2('A carta', _s5dinero(difCosto))}</td>
            </tr>
            <tr class="s5-r2">
                <td>${_s5Menu(fila.insumoId, true, _s5Comentarios(fila))}</td>
                <td></td>
                <td style="text-align:center">${_costoOk ? _s5c2('Costo', entDinP > 0 ? '<b>' + _s5dinero(entDinP).replace('+', '') + '</b>' : '—') : ''}</td>
                <td style="text-align:center;cursor:help" title="${etx(_tituloCoct(fila, prodPBpVer, prodPBpMat))}">${_s5Uso(coctSoloP, prodPBpVer, cant)}</td>
                <td style="text-align:center">${peso ? '' : _s5CortCelda(_cortPartes(fila), cortP, cant)}</td>
                <td></td>
                <td></td>
                <td style="text-align:center;color:${color}">${_s5c2(pc.lbl, pc.html)}</td>
                <td style="text-align:right;color:${color};white-space:nowrap">${_costoOk ? _s5c2('A proveedor', '<b style="color:inherit">' + _s5dinero(dif * costoCopa(fila)) + '</b>') : ''}</td>
            </tr>`;
        return { html, dif, difCosto, vend: ventas };
    }

    /* ── Unidades de una presentación ───────────────────────────────────
       Una LATA no tiene copas ni botellas: se cuenta y se vende por pieza.
       `copaML` trae el tamaño de copa por default (45 ml) aunque el insumo sea
       de pieza, así que dividir por copasBot convertía 86 latas en "10.7 bot".
       Solo las de tipo copa (destilados, licores, vinos) se cuentan en botellas
       y se venden en copas. */
    function _uDe(m) {
        if (!m) return { exist:'u', mov:'u', copasBot:0 };
        if (m.tipo === 'pza')  return { exist:'pza', mov:'pza', copasBot:0 };
        if (m.tipo === 'peso') { var u = m.baseUnit || 'u'; return { exist:u, mov:u, copasBot:0 }; }
        return { exist:'bot', mov:'cop', copasBot:_copasBotDe(m) };
    }
    // Unidad del compuesto = la de sus miembros cuando todos coinciden.
    function _uComp(members) {
        var us = members.map(_uDe);
        var ex = us.length ? us[0].exist : 'u', mv = us.length ? us[0].mov : 'u';
        for (var k=1; k<us.length; k++) { if (us[k].exist !== ex) ex = 'u'; if (us[k].mov !== mv) mv = 'u'; }
        return { exist:ex, mov:mv };
    }

    // ── Constructor de fila COMPUESTO (misma columna que copa; con desglose) ──
    function _rowComp(vf) {
        const comp = getCompuestos().find(c => c.id === vf.compId) || {};
        const members = (comp.miembros||[]).map(_filaDeMiembro).filter(Boolean);
        let ea=0, ent=0, cancel=0, ventaBot=0, ventaCopa=0, ventaCoct=0, cm=0, eaBot=0, fisBot=0;
        // Entradas y venta por botella también EN BOTELLAS, como en las filas
        // individuales de la misma tabla: ahí dicen "+2 bot" y "1 bot", y el
        // compuesto decía "+98 cop" y "15.6 cop" — el mismo dato en otra unidad,
        // que es justo lo que hacía ilegible el renglón.
        let entU=0, ventaBotU=0;
        const uC = _uComp(members);
        let usoComp = 0;
        members.forEach(m => {
            ea       += parseFloat(m.existenciaAnterior)||0;
            ent      += getEntradasCopas(m);
            entU     += getEntradasBottles(m.insumoId);
            cancel   += getCancelacionesCopas(m.insumoId);
            const copasBot = _uDe(m).copasBot;
            ventaBotU+= parseFloat(m.ventasBotella)||0;
            ventaBot += (parseFloat(m.ventasBotella)||0) * (copasBot || 1);
            ventaCopa+= parseFloat(m.ventasCopasDirectas)||0;
            ventaCoct+= consumoRecetasFila(m);
            // Producción de batches del miembro: entra a la base del % igual que en
            // cualquier otro renglón (ver _usoTotal), no solo lo que se cobró.
            usoComp  += _usoTotal(
                (parseFloat(m.ventasCopasDirectas)||0) + (parseFloat(m.ventasBotella)||0)*(copasBot||1) + consumoRecetasFila(m),
                (function(){ try { return _consumoBaseProd(m) || 0; } catch (e) { return 0; } })(),
                _prodPBVisible(m, _repartoDe(m.insumoId)));
            cm       += (parseFloat(m.cortesiaCopas)||0) + (parseFloat(m.mermaCopas)||0);
            // Existencia en BOTELLAS: cada presentación aporta sus propias botellas
            // (su copaML/contNeto). El compuesto suma botellas; la diferencia queda en copas.
            eaBot    += copasBot>0 ? (parseFloat(m.existenciaAnterior)||0)/copasBot : (parseFloat(m.existenciaAnterior)||0);
            fisBot   += copasBot>0 ? calcExistencia(m)/copasBot : calcExistencia(m);
        });
        const fisico    = calcExistencia(vf);
        const teorico   = calcExistenciaTeorica(vf);
        // + lo de cada presentación dentro de los batches (total contra total, ver _rowCopa)
        const dif       = fisico - teorico + members.reduce((t, m) => t + _difEnBatches(m.insumoId), 0);
        /* ══ EL DINERO DEL COMPUESTO SALE DE SUS MIEMBROS ═════════════════
           Esto valuaba TODA la diferencia al precio de la PRIMERA
           presentación. En «La Brü» eso daba −$190 mientras sus cinco
           presentaciones sumaban −$205: +95 la Stout, +220 la IPA, −190 la
           Porter, 0 la lisa y −330 la Maíz Azul. Cinco cervezas a precios
           distintos no se valúan con el precio de una.

           Y como el resumen ejecutivo SÍ sumaba miembro por miembro, los
           chips de grupo daban +$400 y la tarjeta +$643. La regla ya estaba
           escrita —«el compuesto es la SUMA SIMPLE de los insumos que
           incluye, y cada uno entra con SU precio»— y este renglón era el
           único que no la seguía. */
        const difCosto  = members.reduce(function (t, m) {
            var mAj = _repartoDe(m.insumoId);
            return t + (calcDiferencia(m) + mAj.dif + _difEnBatches(m.insumoId)) * (m.precioCarta || 0);
        }, 0);
        const pctValC   = _pctVarianza(dif, usoComp);
        const color     = Math.abs(dif) < 0.05 ? 'var(--text-dim)' : (dif > 0 ? 'var(--green)' : 'var(--red)');
        const pctStr    = pctValC !== null ? ((pctValC>=0?'+':'')+pctValC.toFixed(1)+'%') : '—';
        const esPzaComp0 = members.length > 0 && members.every(m => m.tipo === 'pza');
        /* ══ EL DESGLOSE TIENE LA MISMA ESTRUCTURA (Edwin, 19-nov) ══════════
           Era una tabla aparte, metida en un renglón, con sus propias columnas
           (anterior, entradas, coctelería, ventas, cortesía/merma…): no
           cuadraba con las de arriba y, al partirse de hoja en el impreso, su
           encabezado se colaba arriba de la tabla de afuera. Ahora cada
           presentación es un producto más, con SUS dos renglones (el mismo
           armador que cualquier insumo), sangrado debajo del compuesto. En la
           pantalla se abre con «Ver desglose»; en papel va abierto. */
        const esPzaComp = esPzaComp0;
        const desglose = members.map(m => {
            const r = (esPzaComp0 || m.tipo !== 'copa') ? _rowPza(m) : _rowCopa(m);
            return r.html.replace(/<tr class="s5-r([12])">/g, (x, n) =>
                '<tr class="s5-r' + n + ' s5-mem compDesg-' + comp.id + '"' + (papel ? '' : ' style="display:none"') + '>');
        }).join('');
        const _tdNom = `<td style="min-width:150px">
                <div class="s5-nom">🧩 ${etx(comp.nombre||vf.nombre)}</div>
                <div class="s5-cont">Compuesto · ${members.length} presentaciones</div>
            </td>`;
        /* Las opciones del compuesto van en su ⋯, como las de los demás; «Ver
           desglose» se queda a la vista junto a él (es para leer, no una opción). */
        const _menuComp = _s5Menu(vf.compId||vf.insumoId, false,
            papel ? '' : '<button class="s5-desg" onclick="_toggleCompDesg(\'' + comp.id + '\', this)">▸ Ver desglose</button>');
        /* Mermas y cortesías por separado, y lo demás sumado presentación por
           presentación, cada una con SU botella, su copa y su costo. */
        const merC   = members.reduce((t, m) => t + (parseFloat(m.mermaCopas) || 0), 0);
        const cortC  = members.reduce((t, m) => t + (parseFloat(m.cortesiaCopas) || 0), 0);
        const teoBotC = members.reduce((t, m) => { const cb = _uDe(m).copasBot, v = calcExistenciaTeorica(m); return t + (cb > 0 ? v / cb : v); }, 0);
        const entDinC = members.reduce((t, m) => t + getEntradasCopas(m) * costoCopa(m), 0);
        const difProvC = members.reduce((t, m) => t + (calcDiferencia(m) + _difEnBatches(m.insumoId)) * costoCopa(m), 0);
        const prodC  = members.reduce((t, m) => { try { return t + (_consumoBaseProd(m) || 0); } catch (e) { return t; } }, 0);
        // En botellas, cada presentación con la SUYA; si a alguna le falta, no se inventa.
        const _botDe = (fn) => { let t = 0; for (const m of members) { const cb = _uDe(m).copasBot, x = fn(m);
            if (!(x > 0)) continue; if (!(cb > 0)) return null; t += x / cb; } return t; };
        const coctBotC = _botDe(m => consumoRecetasFila(m));
        const prodBotC = _botDe(m => { try { return _consumoBaseProd(m) || 0; } catch (e) { return 0; } });
        const pcC    = _s5Pct(dif, usoComp, teorico);
        const _grupo = (fn, o) => _equivBarraGrupoHTML(members.map(m => ({ fila: m, cantidad: fn(m) })), Object.assign({ impreso: papel }, o)).replace(/<(\/?)div\b/g, '<$1span');
        const _mer = (u) => `<td style="text-align:center;color:${merC>0?'var(--red)':'inherit'};font-weight:${merC>0?600:400}">${_s5c2('Mermas', merC>0 ? _nc(merC)+' '+u : '—')}</td>`;
        const _fin1 = `
            <td style="text-align:center;font-weight:700;color:${color}">${_s5c2('Diferencia', (dif>=0?'+':'') + _nc(dif) + ' ' + (esPzaComp0 ? 'pza' : uC.mov) + (esPzaComp0 ? '' : _s5sub(_grupo(calcDiferencia, {signo:true, sinCopas:true}))))}</td>
            <td style="text-align:right;font-weight:600;color:${color}">${_s5c2('A carta', _s5dinero(difCosto))}</td>`;
        const _cort = (u) => `<td style="text-align:center">${_s5CortCelda(_cortPartesJuntas(members), cortC, (x) => _nc(x) + ' ' + u)}</td>`;
        const _fin2 = `
            <td style="text-align:center;color:${color}">${_s5c2(pcC.lbl, pcC.html)}</td>
            <td style="text-align:right;color:${color};white-space:nowrap">${_costoOk ? _s5c2('A proveedor', '<b style="color:inherit">' + _s5dinero(difProvC) + '</b>') : ''}</td>`;
        const _costo = `<td style="text-align:center">${_costoOk ? _s5c2('Costo', entDinC > 0 ? '<b>' + _s5dinero(entDinC).replace('+', '') + '</b>' : '—') : ''}</td>`;
        // Compuesto de PIEZAS: mismas columnas que sus vecinos de la tabla de piezas.
        const htmlPza = `<tr class="s5-r1">${_tdNom}
            <td style="text-align:center">${_s5c2('Exist. anterior', _nc(eaBot) + ' pza')}</td>
            <td style="text-align:center;color:var(--green)">${_s5c2('Entradas', ent>0 ? '+'+_nc(ent)+' pza' : '—')}</td>
            <td style="text-align:center;color:var(--accent)">${_s5c2('Ventas', (ventaCopa+ventaBot)>0 ? _nc(ventaCopa+ventaBot)+' pza' : '—')}</td>
            ${_mer('pza')}
            <td style="text-align:center">${_s5c2('Teórico', _nc(teorico) + ' pza')}</td>
            <td style="text-align:center;font-weight:600">${_s5c2('Exist. actual', _nc(fisBot) + ' pza')}</td>${_fin1}
        </tr>
        <tr class="s5-r2${papel ? ' s5-comp-abierto' : ''}">
            <td>${_menuComp}</td>
            <td></td>
            ${_costo}
            <td style="text-align:center">${_s5Uso(ventaCoct, prodC, (x) => _nc(x) + ' pza')}</td>
            ${_cort('pza')}
            <td></td>
            <td></td>${_fin2}
        </tr>${desglose}`;
        const html = `<tr class="s5-r1">${_tdNom}
            <td style="text-align:center">${_s5c2('Exist. anterior', _nc(eaBot) + ' ' + uC.exist)}</td>
            <td style="text-align:center;color:var(--green)">${_s5c2('Entradas', entU>0 ? '+'+_nc(entU)+' '+uC.exist : '—')}</td>
            <td style="text-align:center;color:var(--accent)">${_s5c2('Venta botella', ventaBotU>0 ? _nc(ventaBotU)+' '+uC.exist : '—')}</td>
            <td class="s5-vc" style="text-align:center;color:var(--accent)">${_s5c2('Venta copa', ventaCopa>0 ? _nc(ventaCopa)+' '+uC.mov : '—')}</td>
            ${_mer(uC.mov)}
            <td style="text-align:center">${_s5c2('Teórico', _nc(teoBotC) + ' ' + uC.exist)}</td>
            <td style="text-align:center;font-weight:600">${_s5c2('Exist. actual', _nc(fisBot) + ' ' + uC.exist)}</td>${_fin1}
        </tr>
        <tr class="s5-r2${papel ? ' s5-comp-abierto' : ''}">
            <td>${_menuComp}</td>
            <td></td>
            ${_costo}
            <td colspan="2" style="text-align:center">${_s5Uso(ventaCoct, prodC, (x) => _nc(x) + ' ' + uC.mov, null, coctBotC, prodBotC)}</td>
            ${_cort(uC.mov)}
            <td style="text-align:center">${_s5c2('Equivale a', _grupo(calcExistenciaTeorica))}</td>
            <td style="text-align:center">${_s5c2('Equivale a', _grupo(calcExistencia))}</td>${_fin2}
        </tr>${desglose}`;
        return { html: esPzaComp ? htmlPza : html, dif, difCosto, vend: ventaBot + ventaCopa + ventaCoct, esPza: esPzaComp };
    }

    /* ══ SIN EL RENGLÓN DE TÍTULOS DE ARRIBA (Edwin, 19-nov) ═══════════════
       Cada celda de los dos renglones ya trae su título, así que el
       encabezado de la tabla repetía lo mismo. Se quita y en su lugar va un
       <colgroup> con los anchos: así las columnas siguen alineadas de un
       grupo a otro. Sin Cancelaciones: van en el reporte directivo, con los
       descuentos. */
    const _cols = (ws) => '<colgroup>' + ws.map(w => w ? '<col style="width:' + w + 'px">' : '<col>').join('') + '</colgroup>';
    //                    Producto  Ant.  Entr.  V.bot  V.copa  Merma  Teór.  Actual  Dif.  Dif.$
    const COPA_THEAD = papel ? _cols([0, 52, 54, 48, 48, 52, 54, 56, 68, 74])
                             : _cols([0,     92,   96,    84,    84,     98,    98,    100,    116,  112]);
    //                    Producto  Ant.  Entr.  Ventas  Merma  Teór.  Actual  Dif.  Dif.$
    const PZA_THEAD  = papel ? _cols([0, 54, 56, 56, 54, 54, 56, 66, 74])
                             : _cols([0,     92,   96,    96,     98,    92,    96,    110,  112]);

    // ── Una tarjeta COLAPSABLE por grupo (colapsadas por defecto) con indicadores ──
    // La producción propia es informativa: va al final.
    const _ordCat = (a,b) => ((a[0] === GPROD) - (b[0] === GPROD)) || String(a[0]).localeCompare(String(b[0]), 'es');
    let idx = 0;
    const _pp = papel ? ' s5-papel' : '';
    const cards = Object.entries(grupos).sort(_ordCat).map(([grp, b]) => {
        idx++;
        const gid = 's5g' + idx;
        /* Los batches: una ficha informativa cada uno, sin diferencia ni dinero. */
        if (grp === GPROD) {
            const fichas = b.copa.concat(b.pza).map(f => '<tr><td>' + _batchInfoHTML(f) + '</td></tr>').join('');
            const nB = b.copa.concat(b.pza).reduce((t, f) => t + (_batchesProducidos(f.insumoId) || 0), 0);
            const resumen = 'Informativo · ' + (b.copa.length + b.pza.length) + ' batch' + (b.copa.length + b.pza.length === 1 ? '' : 'es') +
                (nB ? ' · ' + _nc(nB) + ' producido' + (nB === 1 ? '' : 's') + ' en el periodo' : '');
            const tabla = `<table class="s5-pbt${_pp}"><tbody>${fichas}</tbody></table>`;
            if (papel) return `<div class="rd-grp"><div class="rd-grptitle s5p-gt${_pp}"><span class="s5p-gn">${grp}</span><span class="s5p-gs">${resumen}</span></div>${tabla}</div>`;
            const abiertoP = !!_s5Abiertos[grp];
            return `<div class="card" style="max-width:none;margin:0 16px 12px">
            <div class="card-header" data-grp="${etx(grp)}" style="cursor:pointer;user-select:none" onclick="_s5Toggle('${gid}', this)">
                <h2 style="display:flex;align-items:center;gap:8px"><span id="s5car-${gid}" style="font-size:12px;color:var(--text-muted)">${abiertoP?'▾':'▸'}</span> ${grp}</h2>
                <div style="font-size:11.5px;color:var(--text-dim)">${resumen}</div>
            </div>
            <div id="s5body-${gid}" class="card-body" style="padding:0;display:${abiertoP?'':'none'}">${tabla}</div>
        </div>`;
        }
        let dif = 0, difCosto = 0, vend = 0, copaBody = '', pzaBody = '';
        b.copa.forEach(f  => { const r=_rowCopa(f);  copaBody+=r.html; dif+=r.dif; difCosto+=r.difCosto; vend+=r.vend; });
        // Un compuesto de latas pertenece a la tabla de PIEZAS: en la de copas
        // heredaba las columnas "Botella" y "Copa", que no existen para un envase
        // que solo se vende por pieza.
        b.comp.forEach(vf => {
            const r = _rowComp(vf);
            if (r.esPza) pzaBody += r.html; else copaBody += r.html;
            dif+=r.dif; difCosto+=r.difCosto; vend+=r.vend;
        });
        b.pza.forEach(f   => { const r=_rowPza(f);   pzaBody+=r.html; dif+=r.dif; difCosto+=r.difCosto; vend+=r.vend; });
        const unidades = [...new Set(b.copa.concat(b.pza).map(f => _uDe(f).mov.toLowerCase())
            .concat(b.comp.map(f => _uDe(f).mov.toLowerCase())))];
        const mixtas = unidades.length > 1;
        const unidad = unidades[0] || 'u';
        const copaTable = copaBody ? `<div class="tabla-wrap" style="overflow-x:auto"><table class="s5-tabla" style="min-width:900px;font-size:15px">${COPA_THEAD}<tbody>${copaBody}</tbody></table></div>` : '';
        const pzaTable  = pzaBody  ? `<div class="tabla-wrap" style="overflow-x:auto"><table class="s5-tabla" style="font-size:15px">${PZA_THEAD}<tbody>${pzaBody}</tbody></table></div>` : '';
        const abierto   = !!_s5Abiertos[grp];
        const faltTxt   = mixtas ? 'Diferencias por insumo' : dif < -0.05 ? `faltan ${_nc(Math.abs(dif))} ${unidad}` : (dif > 0.05 ? `sobran ${_nc(dif)} ${unidad}` : 'cuadra');
        const faltCol   = dif < -0.05 ? 'var(--red)' : (dif > 0.05 ? 'var(--green)' : 'var(--text-dim)');
        /* En papel: el título del grupo y sus tablas SUELTAS (cada una en su
           .rd-grp): el paginador parte una tabla por bloque, renglón por renglón. */
        if (papel) {
            const tit = `<div class="rd-grptitle s5p-gt${_pp}"><span class="s5p-gn">${grp}</span>` +
                `<span class="s5p-gs">${mixtas ? 'Movimientos por insumo' : _nc(vend) + ' ' + unidad + ' vendidas'}</span>` +
                `<span class="s5p-gs" style="color:${faltCol};font-weight:600">${faltTxt}</span>` +
                `<span class="s5p-gd" style="color:${difCosto >= 0 ? 'var(--green)' : 'var(--red)'}">${difCosto>=0?'+':''}$${difCosto.toFixed(2)}</span></div>`;
            const tC = copaBody ? `<table class="s5-tabla${_pp}">${COPA_THEAD}<tbody>${copaBody}</tbody></table>` : '';
            const tP = pzaBody  ? `<table class="s5-tabla${_pp}">${PZA_THEAD}<tbody>${pzaBody}</tbody></table>` : '';
            return (tC ? `<div class="rd-grp">${tit}${tC}</div>` : '') + (tP ? `<div class="rd-grp">${tC ? '' : tit}${tP}</div>` : '');
        }
        return `<div class="card" style="max-width:none;margin:0 16px 12px">
            <div class="card-header" data-grp="${etx(grp)}" style="cursor:pointer;user-select:none" onclick="_s5Toggle('${gid}', this)">
                <h2 style="display:flex;align-items:center;gap:8px"><span id="s5car-${gid}" style="font-size:12px;color:var(--text-muted)">${abierto?'▾':'▸'}</span> ${grp}</h2>
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--text-dim)">
                    <span>${mixtas ? 'Movimientos por insumo' : '<b style="color:var(--text)">' + _nc(vend) + '</b> ' + unidad + ' vendidas'}</span>
                    <span style="color:${faltCol}">${faltTxt}</span>
                    <span class="pill ${difCosto>=0?'pill-green':'pill-red'}" style="font-size:11px">${difCosto>=0?'+':''}$${difCosto.toFixed(2)}</span>
                </div>
            </div>
            <div id="s5body-${gid}" class="card-body" style="padding:0;display:${abierto?'':'none'}">${copaTable}${pzaTable}</div>
        </div>`;
    }).join('');

    // ── Producción propia: prebatch repartido a sus insumos (opción A) ──
    /* La tarjeta que explicaba el REPARTO del batch entre sus insumos solo
       existe en ese modelo. Con el de consumo, cada batch es un renglón del
       grupo «Producción propia», con su propia diferencia. */
    const _repL = (_PREBATCH_REPARTE && _repCache && _repCache.lista) || [];
    let prodCard = '';
    const _prodMatch = !q || GPROD.toLowerCase().includes(q) || _repL.some(r => (r.nombre||'').toLowerCase().includes(q));
    if (_repL.length && !_subcatStep5 && !_difStep5 && _prodMatch) {
        idx++;
        const gid = 's5g' + idx;
        const abierto = !!_s5Abiertos[GPROD];
        const body = _repL.map(function(r){
            var filaPB = filasCaptura.find(f => f.insumoId === r.insumoId);
            var difML = r.fisML - r.teoML;
            var difTag = Math.abs(difML) < 1 ? '' : ` · dif ${difML>=0?'+':''}${_fmtEquivalenteBatch(difML, r.unidadBase)} repartida`;
            return `<div style="padding:7px 0;border-bottom:1px solid var(--border)">
                <b>${etx(r.nombre)}</b>${_stockFilaHTML(filaPB, filaPB ? calcExistencia(filaPB) : 0, false)} — ${_fmtEquivalenteBatch(r.fisML, r.unidadBase)} de ${r.unidadBase === 'ML' ? 'mix' : 'preparación'} contados${difTag}
                <div style="color:var(--text-dim);margin-top:2px">Equivalentes por insumo: ${r.desglose.map(function(d){ return etx(d.nombre) + ' ' + _fmtEquivalenteBatch(d.ml, d.unidadBase) + ' (' + _nc(d.porBatch) + ' por cada ' + _fmtEquivalenteBatch(r.rendimientoBase, r.unidadBase) + ' de receta)'; }).join(' · ')}</div>
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

    // Papel: los bloques sueltos, para que el paginador los reparta por hoja.
    if (papel) return _estiloS5() + _estiloS5Papel() + (cards || '<div style="font-size:10px;color:#888;padding:8px 0">' + (opts.vacio || 'Sin productos.') + '</div>');
    const sinDatos = !cards && !prodCard
        ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Sin productos capturados</div>'
        : '';
    return `<div style="padding:16px 0 24px">${_estiloS5()}${_avisoEnlacesHTML()}${sinDatos}${cards}${prodCard}</div>`;
}
// Entradas de un insumo, con fecha (de la cola de entradas del inventario).
function _entradasDeInsumo(insumoId) {
    return ((invActual && invActual.entradasLog) || []).filter(function(e){ return _movimientoDelInsumo(e, insumoId); })
        .map(function(e){ return { cantidad: parseFloat(e.cantidad)||0, fecha: e.fecha||'', tipo: e.tipo||'' }; });
}
// Vista GALERÍA del resultado: una tarjeta de desglose por insumo.
function _step5GaleriaHTML(q, mapaC5, vcomps) {
    var items = vcomps.filter(_pasaDifS5).concat(filasCaptura.filter(function(f){
        if (mapaC5[f.insumoId]) return false;
        if (q && !(f.nombre||'').toLowerCase().includes(q)) return false;
        if (_subcatStep5 && (f.subcategoria||f.categoria) !== _subcatStep5) return false;
        if (!_pasaDifS5(f)) return false;
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
    var miembrosEquiv = fila.esCompuesto ? _miembrosFila(getCompuestos().find(function(c){ return c.id === fila.compId; })) : [];
    var esComp   = !!fila.esCompuesto;
    var esPB     = !esComp && _esPrebatchRepartido(fila.insumoId);
    var adjG     = (esComp || esPB) ? _repZero : _repartoDe(fila.insumoId);
    var copasBot = _copasBotDe(fila);
    var ea       = (parseFloat(fila.existenciaAnterior)||0) + adjG.ea; // copas
    var shG      = (esComp || esPB) ? _repZero : _enBatches(fila.insumoId);   // total contra total
    var fisico   = calcExistencia(fila) + adjG.fis + shG.fis;          // copas
    var teorico  = calcExistenciaTeorica(fila) + adjG.teo + shG.ea;   // la fórmula de Edwin
    var dif      = fisico - teorico;
    var color    = esPB ? 'var(--text-dim)' : (Math.abs(dif) < 0.05 ? 'var(--text-dim)' : (dif > 0 ? 'var(--green)' : 'var(--red)'));
    var difCarta = esPB ? 0 : dif * (fila.precioCarta||0);
    var pctVal   = esPB ? null : _pctVarianza(dif, _consumoPeriodo(fila) + adjG.venta); // dif vs venta neta
    var pct      = pctVal !== null ? ((pctVal>=0?'+':'')+pctVal.toFixed(1)+'%') : '—';
    var prodPBg   = esComp ? 0 : _prodPBVisible(fila, adjG);     // lo que se fue al producir batches
    var ventaCoct = esComp ? (fila._ventaCoct||0)
        : consumoRecetasFila(fila) + adjG.vco + prodPBg;
    var producido = esComp ? 0 : _prodPrebatchUnidades(fila);   // si ESTE renglón es un batch
    var ventaDir  = parseFloat(fila.ventasCopasDirectas)||0;
    var ventaBot  = parseFloat(fila.ventasBotella)||0;
    var cort = fila.tipo === 'peso' ? 0 : parseFloat(fila.cortesiaCopas)||0;
    var merma = (parseFloat(fila.tipo === 'peso' ? fila.mermaBase : fila.mermaCopas)||0) + adjG.cm;
    var cancel = esComp ? (fila._cancel||0) : getCancelacionesCopas(fila.insumoId);
    var _n1 = function(v){ return fila.tipo === 'pza' ? Math.round(v*10000)/10000 : v%1 ? (Math.round(v*10)/10).toFixed(1) : v; };
    var eaDisp, fiDisp, uEx;
    if (esComp) {
        // El compuesto se lee en la unidad de sus miembros: botellas si se sirven
        // por copa, PIEZAS si se cuentan por pieza. Antes iba fijo en botellas y
        // una caja de cervezas salía en una unidad que no era la suya.
        uEx = fila.tipo === 'pza' ? 'pza' : 'bot';
        eaDisp = _n1(fila._eaBot||0); fiDisp = _n1(fila._existBot||0);
    } else {
        uEx = fila.tipo==='pza'?'pza':(fila.tipo==='peso'?(fila.baseUnit||'u'):'bot');
        eaDisp = copasBot>0 ? _n1(ea/copasBot) : _n1(ea);
        fiDisp = copasBot>0 ? _n1(fisico/copasBot) : _n1(fisico);
    }
    var pesosAct = (fila.pesos||[]).filter(function(p){return parseFloat(p)>0;}).map(function(p){return (Math.round(parseFloat(p)*1000)/1000)+' kg';});
    var prevFila = esComp ? null : (refMap ? refMap[fila.insumoId] : _filaAnteriorInsumo(fila.insumoId));
    var pesosAnt = prevFila ? (prevFila.pesos||[]).filter(function(p){return parseFloat(p)>0;}).map(function(p){return (Math.round(parseFloat(p)*1000)/1000)+' kg';}) : [];
    // Las entradas del compuesto son las de sus miembros sumadas — antes iban
    // en 0 por código, así que compraste 12 botellas y el compuesto decía "—".
    var entradas = esComp ? (fila._entLista||[]) : _entradasDeInsumo(fila.insumoId);
    var entTotal = esComp ? (fila._entBot||0)   : getEntradasBottles(fila.insumoId);
    var uEnt = esComp ? 'bot' : _unidadCompra(fila);
    var fila2 = function(lbl, val, col){ return '<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:12px"><span style="color:var(--text-dim)">'+lbl+'</span><span style="color:'+(col||'var(--text)')+';font-weight:600;text-align:right">'+val+'</span></div>'; };
    var ventasParts = [];
    if (ventaDir>0)  ventasParts.push(_fmtCop(ventaDir, fila));
    /* «En recetas» y «en batches» por separado: son dos cosas que se revisan
       en lugares distintos (las ventas capturadas y el Paso 3). */
    if (ventaCoct - prodPBg > 0.0001) ventasParts.push('<span style="color:var(--viol)">'+_fmtCop(ventaCoct - prodPBg, fila)+' en recetas</span>');
    if (prodPBg > 0) ventasParts.push('<span style="color:var(--viol)">'+_fmtCop(prodPBg, fila)+' en batches</span>');
    if (ventaBot>0)  ventasParts.push(_n1(ventaBot)+' bot');
    return '<div class="inv-item-card" style="padding:14px">'+
        '<div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:2px">'+(esComp?'🧩 ':'')+etx(esComp?fila.nombre:insumoTitulo(fila))+'</div>'+
        _stockFilaHTML(fila, calcExistencia(fila), false)+_comentarioVentaHTML(fila)+
        '<div style="font-size:10px;color:var(--text-dim);margin-bottom:10px">'+etx(esComp?'Compuesto':insumoMeta(fila))+'</div>'+
        fila2('Exist. anterior', eaDisp+' '+uEx+(pesosAnt.length?' <span style="font-size:10px;color:var(--text-dim)">('+pesosAnt.join(', ')+')</span>':''))+
        fila2('Entradas', entTotal>0?'+'+_n1(entTotal)+' '+uEnt:'—', entTotal>0?'var(--green)':'var(--text-dim)')+
        (entradas.length?'<div style="font-size:10px;color:var(--text-dim);padding:1px 0 4px 10px;line-height:1.6">'+entradas.map(function(e){return '• '+_n1(e.cantidad)+' '+uEnt+(e._de?' · '+etx(e._de):'')+(e.fecha?' · '+e.fecha:'')+(e.tipo?' ('+tipoEntradaLabel(e.tipo)+')':'');}).join('<br>')+'</div>':'')+
        (producido>0?fila2('Producido (Paso 3)', '+'+_fmtCop(producido, fila), 'var(--green)'):'')+
        fila2('Ventas', ventasParts.length?ventasParts.join(' · '):'—', 'var(--accent)')+
        fila2('Cortesía / Merma', (cort+merma)>0?_fmtCop(cort+merma, fila):'—', (cort+merma)>0?'var(--red)':'var(--text-dim)')+
        fila2('Cancelaciones (informativo)', cancel>0?_fmtCop(cancel, fila):'—', 'var(--text-muted)')+
        fila2('Exist. actual', fiDisp+' '+uEx+(pesosAct.length?' <span style="font-size:10px;color:var(--text-dim)">('+pesosAct.join(', ')+')</span>':''))+
        /* La MISMA línea de equivalencias que la vista Lista, con el MISMO
           formateador: si cada pantalla la arma, se desalinean y el que compara
           las dos deja de creerle a ninguna. */
        (esComp ? _equivBarraGrupoHTML(miembrosEquiv.map(function(m){ return {fila:m, cantidad:calcExistencia(m)}; })) : _equivBarraHTML(fisico, fila))+
        '<div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">'+
            fila2('Diferencia', _fmtCopSgn(dif, fila)+' · '+pct, color)+
            (esComp ? _equivBarraGrupoHTML(miembrosEquiv.map(function(m){ return {fila:m, cantidad:calcDiferencia(m)}; }), {signo:true}) : _equivBarraHTML(dif, fila, {signo:true}))+
            fila2('Dif. $ (carta)', (difCarta>=0?'+':'')+'$'+difCarta.toFixed(2), color)+
        '</div>'+
    '</div>';
}

// ── Paginador del reporte: mide alturas reales y reparte el contenido (#rd-src) en hojas A4
//    discretas (#rd-pages), cada una con encabezado y pie. Si una tabla cruza de hoja, repite
//    su cabecera de columnas. Garantiza: hojas visibles en digital, encabezado en cada hoja,
//    y que NINGUNA fila se corte. ──────────────────────────────────────────────────────────
/* ══ TRES REPORTES, UN SOLO DOCUMENTO FUENTE ════════════════════════════════
   El contenido se arma entero una vez y después se PODA según cuál se pidió:

     ''         resumen general   — todo hasta «Inventario completo»
     'desglose' por insumo        — de «Inventario completo» en adelante
     'faltsobr' faltantes/sobrantes — solo su bloque

   Van por separado porque juntos el paginado dejaba huecos feos entre
   secciones. Vive aquí afuera, y no dentro del reporte, para poder correrla
   sola: es una regla de "qué se queda y qué se va", y esas se prueban mal
   cuando hay que levantar media pantalla para llegar a ellas.             */
function _rdPodarPorModo(src, modo) {
    if (!src) return;
    /* `rd-fs` marca las piezas de faltantes y sobrantes. Van SUELTAS, una por
       una, y no envueltas en un contenedor: el paginador solo sabe partir lo
       que cuelga directo de aquí, y un bloque entero que no cabe en la hoja se
       recorta en silencio. */
    const esFS = n => !!(n.classList && n.classList.contains('rd-fs'));
    if (modo === 'faltsobr') {
        // Este reporte es solo él: se va todo lo demás, incluido el resumen.
        Array.from(src.children).forEach(n => { if (!esFS(n)) n.remove(); });
    } else {
        let enDesglose = false;
        Array.from(src.children).forEach(n => {
            if (esFS(n)) return n.remove();   // tiene su propio exporte
            if (n.classList && n.classList.contains('rd-sec') && /Inventario completo/i.test(n.textContent)) enDesglose = true;
            if (modo === 'desglose' ? !enDesglose : enDesglose) n.remove();
        });
    }
    // rd-breaks colgantes al inicio/fin (dejarían hojas vacías)
    while (src.firstElementChild && src.firstElementChild.classList.contains('rd-break')) src.firstElementChild.remove();
    while (src.lastElementChild && src.lastElementChild.classList.contains('rd-break')) src.lastElementChild.remove();
}

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
        // Los anchos de columna viajan con la tabla a la hoja siguiente.
        /* SOLO los propios (:scope >): una tabla metida en un renglón —como el
           desglose viejo de un compuesto— colaba SU encabezado arriba de la
           tabla de afuera, con otras columnas y un hueco a la derecha. */
        const cg = orig.querySelector(':scope > colgroup');
        if (cg) t.appendChild(cg.cloneNode(true));
        const th = orig.querySelector(':scope > thead');
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
        /* UN PRODUCTO NO SE PARTE (19-nov): en el Resultado cada producto son
           dos renglones (s5-r1 + s5-r2, y el desglose de un compuesto). Viajan
           juntos a la hoja siguiente; solo si no caben ni en una hoja nueva se
           reparten renglón por renglón. */
        const unidades = [];
        rows.forEach(r => {
            const pegado = r.classList.contains('s5-r2') || /^compDesg-/.test(r.id || '');
            if (pegado && unidades.length) unidades[unidades.length - 1].push(r); else unidades.push([r]);
        });
        const ponRenglon = (r) => {
            tb.appendChild(r);
            if (!fits()) {
                tb.removeChild(r);
                newPage();
                s = shell(table); tb = s.querySelector('tbody');
                body.appendChild(s);
                tb.appendChild(r);
                if (!fits()) {
                    // Una fila puede contener una nota de varias páginas. Dividir
                    // su texto en continuaciones medidas, sin repetir los importes.
                    tb.removeChild(r);
                    const cells = Array.from(r.cells);
                    let rest = cells.map(c => Array.from(c.textContent || ''));
                    let continuation = false;
                    while (rest.some(t => t.length)) {
                        const fragment = count => {
                            const row = r.cloneNode(false);
                            if (continuation) row.setAttribute('data-rd-continuacion', 'true');
                            cells.forEach((c, i) => {
                                const td = c.cloneNode(false);
                                td.style.whiteSpace = 'pre-wrap'; td.style.overflowWrap = 'anywhere';
                                td.textContent = (continuation && i === 0 ? '(continuación) ' : '') + rest[i].slice(0, count).join('');
                                row.appendChild(td);
                            });
                            return row;
                        };
                        let lo = 1, hi = Math.max(...rest.map(t => t.length)), best = 0;
                        while (lo <= hi) {
                            const n = Math.floor((lo + hi) / 2), probe = fragment(n);
                            tb.appendChild(probe);
                            const ok = fits(); tb.removeChild(probe);
                            if (ok) { best = n; lo = n + 1; } else hi = n - 1;
                        }
                        if (!best) throw new Error('La cabecera no deja espacio para imprimir esta fila. Reduce el tamaño del encabezado.');
                        tb.appendChild(fragment(best));
                        rest = rest.map(t => t.slice(best));
                        continuation = true;
                        if (rest.some(t => t.length)) {
                            newPage(); s = shell(table); tb = s.querySelector('tbody'); body.appendChild(s);
                        }
                    }
                }
            }
        };
        unidades.forEach(u => {
            if (u.length === 1) return ponRenglon(u[0]);
            u.forEach(r => tb.appendChild(r));
            if (fits()) return;
            u.forEach(r => tb.removeChild(r));
            newPage(); s = shell(table); tb = s.querySelector('tbody'); body.appendChild(s);
            u.forEach(r => tb.appendChild(r));
            if (fits()) return;
            u.forEach(r => tb.removeChild(r));
            u.forEach(ponRenglon);
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
    if (typeof _exigeInv === 'function') {
        if (!_exigeInv('reporte', 'No puedes ver los reportes del inventario.')) return;
        /* El GERENCIAL va sin importes (solo % y cantidades): ese sí lo puede ver
           quien no tiene permiso de ver el dinero. El directivo y el desglose
           llevan importes, y ahí se pide además "ver el capital invertido". */
        if (gerencial !== true &&
            !_exigeInv('verCostos', 'Ese reporte lleva importes y no puedes ver el capital invertido. El reporte gerencial sí está disponible.')) return;
    }
    if (!invActual) return;
    const ger = gerencial === true; // Reporte Gerencial: oculta los importes (solo % + neto + dif$ por insumo).
    const desglose = modo === 'desglose'; // Reporte en DOS exportes: resumen general vs desglose por insumo (más orgánico de imprimir).
    const faltsobr = modo === 'faltsobr'; // Solo las dos caras de la diferencia: lo que faltó y lo que sobró, con sus totales.

    // ── Analytics ──────────────────────────────────────────────────
    let capitalCosto = 0, capitalCarta = 0, difTotal = 0;
    let conAlerta = 0, conRiesgo = 0, conOk = 0;

    _repCache = _repartoPrebatch(); // reparto prebatch→insumos (vista operativa)
    /* Los apartados del impreso salen ANTES de cualquier suma: si se filtraran
       solo al pintar la tabla, el capital y los totales seguirían contándolos
       y el reporte no cuadraría consigo mismo. */
    /* Un miembro de compuesto se imprime DENTRO de su compuesto, así que
       apartar el compuesto tiene que llevárselos a todos: si no, la tabla
       esconde el renglón y los totales lo siguen contando. */
    const _compDeMiembro = _compDeInsumo();
    const _fueraImp = (f) => {
        if (!f || !f.insumoId) return false;
        if (esOcultoImpreso(f.insumoId)) return true;
        var c = _compDeMiembro[f.insumoId];
        return !!(c && esOcultoImpreso(c.id || c));
    };
    const analisis = filasCaptura.filter(f => !_fueraImp(f)).map(f => {
        // Prebatch repartido: se excluye del análisis (su variancia vive en sus insumos).
        /* Sin resultado propio: el prebatch repartido y el batch del modelo de
           consumo (un puente, regla de Edwin del 21-nov). Su dif y su uso van en
           cero aquí; su existencia sí entra al capital (lo que hay en el batch ya
           no está en las botellas: no se cuenta dos veces). */
        const esPBo     = _esPrebatchRepartido(f.insumoId) || _esBatchFila(f);
        const adjO      = esPBo ? _repZero : _repartoDe(f.insumoId);
        const shO       = esPBo ? _repZero : _enBatches(f.insumoId);   // total contra total
        const fisico    = calcExistencia(f) + adjO.fis + shO.fis;
        const teorico   = calcExistenciaTeorica(f) + adjO.teo + shO.ea;   // la fórmula de Edwin
        const dif       = fisico - teorico;
        const cc        = costoCopa(f);
        const difCosto  = esPBo ? 0 : dif * (f.precioCarta || 0); // diferencia a precio de carta ($0 si no hay carta)
        const ea        = (parseFloat(f.existenciaAnterior) || 0) + adjO.ea;
        const copasBot  = _copasBotDe(f, 1);   // 1 = sin contenido, la botella cuenta como una
        const entBot    = getEntradasBottles(f.insumoId) + (f.tipo === 'copa' ? (copasBot > 0 ? adjO.ent / copasBot : 0) : adjO.ent);
        // Coctelería = consumo por recetas del menú; copa → en copas, pza → en piezas.
        const ventaCoct    = consumoRecetasFila(f) + adjO.vco;
        /* Lo que se fue en PRODUCIR batches. El teórico ya lo restaba, pero no se
           enseñaba en ninguna columna: el renglón no cuadraba a la vista y parecía
           que al insumo le faltaba producto sin razón. Va aparte de ventaCoct para
           sumarse a ventaCoct, que es venta. Sí entra al CONSUMO (es uso de insumo
           a precio proveedor); no entra a la venta neta, que mide lo que se cobró. */
        const prodPB       = _prodPBVisible(f, adjO);
        // Cuánto se fue en batches SIEMPRE (aunque el reparto ya lo cubra): es lo que
        // se enseña y lo que entra a la base del % de varianza. Ver _usoTotal.
        const prodPBver    = (function () { try { return _consumoBaseProd(f) || 0; } catch (e) { return 0; } })();
        const ventaCopaDir = parseFloat(f.ventasCopasDirectas) || 0; // venta directa por copa/pza
        const ventaCopa = ventaCoct + ventaCopaDir;
        const ventaBot  = parseFloat(f.ventasBotella) || 0;
        const cortesia  = f.tipo === 'peso' ? 0 : parseFloat(f.cortesiaCopas) || 0;
        const merma     = (parseFloat(f.tipo === 'peso' ? f.mermaBase : f.mermaCopas) || 0) + adjO.cm;
        const cancel    = getCancelacionesCopas(f.insumoId);
        // pza: venta total en piezas = botella + directa + por menú/recetas (igual que el Resultado).
        const ventaPzaTot = f.tipo === 'pza' ? ventaBot + ventaCopa : 0;
        /* prodPB entra al CONSUMO: producir un batch gasta el insumo tal cual, así
           que cuenta como uso a precio proveedor igual que una venta. Lo que NO es
           es una venta —no se le cobró a nadie—, por eso vive fuera de ventaNeta y
           del % de varianza, que se miden contra lo vendido. */
        const consumo   = _usoPeriodo(f, adjO);   // la misma cuenta que la pantalla
        const disponible = ea + (f.tipo === 'copa' ? entBot * copasBot : entBot);
        const pctConsumo = disponible > 0 ? (consumo / disponible) * 100 : 0;
        /* % de varianza contra TODO el uso del insumo (misma definición que la columna
           % del Resultado, ver _usoTotal): botella, copa, pieza, coctelería Y producción
           de batches. Midiéndolo solo contra lo vendido, un insumo que se va casi entero
           a producir batches salía con un porcentaje enorme y disparaba alertas rojas
           por una varianza que, contra el producto que de verdad manipuló, es chica.
           Sin uso alguno → 0 (sin base de comparación, no dispara alerta). */
        const ventaNetaF = f.tipo === 'pza' ? ventaPzaTot : (ventaCopa + ventaBot * copasBot);
        /* `?? 0` convierte «no hay contra qué compararlo» en «0%», y un 0% se
           lee como «aquí no pasa nada» — justo encima del renglón que más
           producto perdió, porque un insumo que no se vendió nada es
           exactamente el que no tiene base. Se guarda la diferencia para que
           quien pinta pueda decir «—» en vez de inventar un cero. */
        const _varCruda  = esPBo ? 0 : _pctVarianza(dif, _usoTotal(ventaNetaF, prodPBver, prodPB));
        const varPct     = _varCruda ?? 0;
        const varSinBase = _varCruda === null;
        const _bat       = esBateo(f.insumoId) || esPBo; // de bateo / prebatch repartido: sin alerta propia
        /* Misma regla que el Resultado y que el reporte de existencias: el
           capital es lo que hay, valuado como está. El batch cuenta con su
           propio costo y sus insumos no reciben su parte AQUÍ (sí en la
           variancia, que es otra cosa). */
        const _existCap = calcExistencia(f);
        capitalCosto += _existCap * cc;
        capitalCarta += _existCap * (f.precioCarta || 0);
        difTotal     += difCosto;
        if (!_bat && Math.abs(varPct) > 25) conAlerta++;
        else if (!_bat && Math.abs(varPct) > 10) conRiesgo++;
        else conOk++;
        // Prebatch repartido: dif y consumo van en CERO aquí — ya viajan repartidos en
        // sus insumos (si no, faltCosto/vendidoCosto los contarían DOBLE).
        return { f, fisico, teorico, dif: esPBo ? 0 : dif, cc, difCosto, ea, entBot, copasBot, varSinBase,
                 ventaCopa, ventaCoct, prodPB, prodPBver, ventaCopaDir, ventaBot, ventaPzaTot, cortesia, merma, cancel,
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
        const costoCompra=_costoCompraStock(f);
        const limites=_parametrosStockFila(f, invActual && invActual.sucursalId);
        capStockMin += (parseFloat(limites.stockMin)||0)*costoCompra;
        capStockMax += (parseFloat(limites.stockMax)||0)*costoCompra;
    });
    // Mismo criterio que la pantalla: solo la COMPRA suma a compras (entEsCompra).
    let comprasU=0, comprasCosto=0, bonifU=0, bonifCosto=0, consigU=0, consigCosto=0, prestU=0, prestCosto=0;
    const bonifItems={}, consigItems={}, prestItems={}; // nombre → unidades acumuladas
    const _filaInsD={}; filasCaptura.forEach(f => { if(f&&f.insumoId) _filaInsD[f.insumoId]=f; });
    ((invActual.entradasLog)||[]).forEach(e => {
        const f=_filaInsD[e.insumoId]; if(!f) return;
        const cant=parseFloat(e.cantidad)||0; if(cant<=0) return;
        const costo=cant*_costoCompraF(f), t=(e.tipo||'compra').toLowerCase();
        const nm=(f.nombre)||e.nombre||'';
        if(t==='bonificacion'){bonifU+=cant;bonifCosto+=costo; if(nm) bonifItems[nm]=(bonifItems[nm]||0)+cant;}
        else if(t==='consignacion'){consigU+=cant;consigCosto+=costo; if(nm) consigItems[nm]=(consigItems[nm]||0)+cant;}
        else if(t==='prestamo_pagado'){prestU+=cant;prestCosto+=costo; if(nm) prestItems[nm]=(prestItems[nm]||0)+cant;}
        else if(entEsCompra(t)){comprasU+=cant;comprasCosto+=costo;}
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
    /* TOP 10 MÁS VENDIDOS (Edwin, 21-nov): sin porcentajes —confundían—, solo
       cuánto se vendió y cuánto representa a precio proveedor y a precio carta.
       Se ordena por lo vendido a carta (a proveedor si no tiene precio de
       carta): copas, piezas y gramos no se comparan entre sí; el dinero sí. */
    const _vendU = a => a.f.tipo === 'pza' ? (a.ventaPzaTot || 0) : (a.ventaCopa || 0) + (a.ventaBot || 0) * (a.copasBot || 0);
    const top10 = analisis.filter(a => !a.esPB && _vendU(a) > 0.001)
        .map(a => { const v = _vendU(a); return { a, vend: v, prov: v * a.cc, carta: v * (a.f.precioCarta || 0) }; })
        .sort((x, y) => (y.carta || y.prov) - (x.carta || x.prov)).slice(0, 10);
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
        // usoTotal: como en cualquier renglón, el % se mide contra TODO el uso de los
        // miembros —incluida la producción de batches—, no solo contra lo vendido.
        let usoTotal=0;
        // Compuesto de piezas (cervezas, refrescos): todo se lee y se suma en piezas.
        const esPzaComp = mem.length > 0 && mem.every(m => m.f.tipo === 'pza');
        mem.forEach(m => {
            ea+=m.ea; entBot+=m.entBot; vCopaDir+=m.ventaCopaDir; vBot+=m.ventaBot; vCoct+=m.ventaCoct;
            cm+=(m.cortesia+m.merma); cancel+=m.cancel; fisico+=m.fisico; teorico+=m.teorico;
            dif+=m.dif; difCosto+=m.difCosto; consumo+=m.consumo;
            eaBot  += m.copasBot>0 ? m.ea/m.copasBot : m.ea;
            fisBot += m.copasBot>0 ? m.fisico/m.copasBot : m.fisico;
            /* En piezas la venta ya viene sumada en ventaPzaTot. Multiplicar por
               copasBot (que ahí vale 0) borraba la venta por botella del %. */
            const mVend = m.f.tipo === 'pza' ? (m.ventaPzaTot||0)
                        : ((m.ventaCopa||0) + (m.ventaBot||0)*(m.copasBot||0));
            vendCopas += mVend;
            usoTotal  += _usoTotal(mVend, m.prodPBver, m.prodPB);
        });
        const varPct = _pctVarianza(dif, usoTotal) ?? 0;
        const nombre = comp.nombre || (mem[0] && mem[0].f.nombre) || 'Compuesto';
        _pushG(_grupoCategoria(mem[0].f), {
            esComp:true, comp, nombre, members:mem,
            ea, entBot, ventaCopaDir:vCopaDir, ventaBot:vBot, ventaCoct:vCoct, cmTotal:cm, cancel,
            fisico, teorico, dif, difCosto, eaBot, fisBot, varPct, vendCopas, consumo, esPzaComp,
            ventaPzaTot: esPzaComp ? vendCopas : 0,
            f:{ tipo: esPzaComp ? 'pza' : 'copa', nombre, insumoId:'_comp_'+comp.id }
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
    const _exFmt = (a, copas) => a.f.tipo !== 'copa' ? _fmtEquivalenteBatch(copas, a.f.tipo === 'pza' ? 'PZA' : a.f.baseUnit || 'G') :
        (a.copasBot > 0 ? copas / a.copasBot : copas).toFixed(2) + ' bot';
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
    /* ══ FALTANTES Y SOBRANTES ═══════════════════════════════════════════════
       Las dos caras de la diferencia, cada una con su total, en la MISMA hoja.
       Es el reporte que se lleva a la junta: aquí está lo que faltó, aquí lo
       que sobró, y abajo lo que cuesta cada cosa.

       Sale de `analisis`, el mismo arreglo del que salen faltCosto y sobrCosto
       del resumen ejecutivo. Filtrar por su cuenta —aunque pareciera más
       directo— es cómo un reporte acaba sin cuadrar con el resumen del mismo
       inventario, y entonces no sirve ninguno de los dos.

       NO SE SUMAN LAS UNIDADES. Un total de «12 cop + 3 pza + 500 g» no
       significa nada, y puesto en negritas al pie de una columna parece que
       sí. Lo que se suma es el dinero —a costo, que es lo que se perdió; a
       carta, que es lo que se hubiera cobrado— y cuántos productos son.

       El orden es por IMPACTO en dinero, no alfabético: la junta empieza por
       arriba y lo que más duele tiene que estar ahí. */
    const _ordImpactoFS = (x, y) => Math.abs(y.dif * y.cc) - Math.abs(x.dif * x.cc);
    /* LA HOJA SALE DE LO QUE SE ESTÁ VIENDO en el Resultado: el mismo
       buscador, la misma categoría, el mismo filtro de faltantes/sobrantes y
       los grupos palomeados antes de imprimir. Darle filtros propios a la hoja
       es cómo se acaba imprimiendo algo distinto de lo que se mira, y entonces
       no sirve ni para revisar la pantalla ni para llevarla a la junta. */
    const _qFS = (typeof _busqStep5 === 'string' ? _busqStep5 : '').toLowerCase();
    const _grupoApagadoFS = g => !!(_gruposImprS5 && _gruposImprS5[g] === false);
    const _pasaFiltroFS = (a) => {
        const comp = _compDeMiembro[a.f.insumoId];
        return _pasaSeleccionS5(a.f, comp) && !_grupoApagadoFS(_grupoSeleccionS5(a.f, comp));
    };
    const faltantesFS = (_difStep5 === 'sobra' ? [] : analisis.filter(a => a.dif < -0.001 && _pasaFiltroFS(a))).sort(_ordImpactoFS);
    const sobrantesFS = (_difStep5 === 'falta' ? [] : analisis.filter(a => a.dif >  0.001 && _pasaFiltroFS(a))).sort(_ordImpactoFS);
    const _txtFiltroFS = [
        _difStep5 === 'falta' ? 'solo faltantes' : _difStep5 === 'sobra' ? 'solo sobrantes' : '',
        _subcatStep5 ? 'categoría ' + _subcatStep5 : '',
        _qFS ? 'que digan “' + _qFS + '”' : '',
        (_gruposImprS5 && Object.keys(_gruposImprS5).some(_grupoApagadoFS)) ? 'algunos grupos fuera' : '',
    ].filter(Boolean).join(' · ');
    /* La lista de un lado: partida POR GRUPO, con su subtotal, y al final el
       total del lado. «Me faltan $4,700» no dice qué hacer; «me faltan $4,300
       en destilados y $400 en refrescos» ya apunta a una barra o a una bodega.

       Cada grupo sale en su PROPIA tabla, y todas cuelgan directo del
       documento: así el paginador puede partirlas por renglón. Envueltas en
       un contenedor mide el bulto entero, no cabe, y lo que sobra lo recorta
       sin avisar — que es como esta hoja salía sin sobrantes. */
    /* El dinero de un renglón, definido UNA vez: lo usan la fila, el subtotal
       del compuesto, el del grupo y el total del lado. Cuatro sumas sobre dos
       definiciones distintas es como una hoja acaba sin cuadrar consigo misma. */
    /* LA UNIDAD DE UN RENGLÓN. Un producto por peso no se mide en copas: la
       harina salía como «−500.0 cop». La expresión ya existía bien dos veces
       más abajo en este mismo reporte; ahora es una sola. */
    const _uRd = f => f && f.tipo === 'peso' ? String(f.baseUnit || 'G').toLowerCase()
                    : (f && f.tipo === 'pza' ? 'pza' : 'cop');
    const _costoFS = a => Math.abs(a.dif) * a.cc;      // lo que costó reponerlo
    const _cartaFS = a => Math.abs(a.difCosto);        // lo que se hubiera cobrado
    /* `etiqueta` lleva TEXTO DEL USUARIO —el nombre de un compuesto, el de una
       categoría que alguien tecleó— y se interpola en HTML. Se escapa aquí, en
       el único sitio donde entra, y no en cada llamada: de las tres que hay,
       olvidarlo en una basta. (Lo encontró Codex.) */
    function _lineaTotalFS(etiqueta, n, costo, carta, col, nivel, sust){
        const est = nivel === 'total' ? { borde:'2px solid #1a1916', peso:900, bg:'#f0efe9' }
                  : nivel === 'comp'  ? { borde:'1px dashed #ccc',   peso:600, bg:'#fbfbf8' }
                  :                     { borde:'1px solid #ddd',    peso:700, bg:'#f8f8f4' };
        sust = sust || ['producto', 'productos'];
        return `<tr style="background:${est.bg}">
            <td colspan="5" style="font-weight:${est.peso};border-top:${est.borde}">${etx(etiqueta)} · ${n} ${n === 1 ? sust[0] : sust[1]}</td>
            <td class="tr" style="font-weight:${est.peso};color:${col};border-top:${est.borde}">${$g('$'+_m2(costo))}</td>
            <td class="tr" style="font-weight:${est.peso};color:${col};border-top:${est.borde}">${$g('$'+_m2(carta))}</td></tr>`;
    }
    /* QUÉ ES ESTE RENGLÓN, además de su nombre. «Bacardí Blanco» sale dos
       veces en la hoja —una por presentación— y sin decir cuál es de 700 y
       cuál de 980 no hay manera de saber a cuál le falta.

       Sale de la etiqueta canónica (insumo-label.js), la misma que usan la
       captura y las fichas, y no de un formato propio de esta hoja. Si el
       catálogo todavía no tiene la presentación, se cae al contenido del
       propio renglón antes que dejar la línea muda. Y si el producto está en
       un compuesto, se dice: así se entiende por qué dos renglones distintos
       traen abajo una línea que los suma. */
    function _metaFS(f) {
        if (!f) return '';
        const partes = [];
        let meta = '';
        try { meta = (typeof insumoMeta === 'function') ? insumoMeta(f) : ''; } catch (e) {}
        if (meta) partes.push(meta);
        else {
            const cn = parseFloat(f.contNeto) || 0;
            if (cn > 0) { try { partes.push(_fmtEquivalenteBatch(cn, _unidadBaseDeFila(f))); } catch (e) {} }
        }
        const c = _compDeMiembro[f.insumoId];
        if (c && c.nombre) partes.push('🧩 ' + c.nombre);
        return partes.join(' · ');
    }
    function _rdFilaFS(a, col){
        const u     = _uRd(a.f);
        const costo = _costoFS(a);
        const carta = _cartaFS(a);
        const meta  = _metaFS(a.f);
        let nom = a.f.nombre || '';
        try { nom = (typeof insumoTitulo === 'function' && insumoTitulo(a.f)) || nom; } catch (e) {}
        /* «¿Cuántas botellas me faltan?» es LA pregunta de esta hoja, y «−26
           cop» no la contesta: debajo de la diferencia van las equivalencias
           de barra, con el signo puesto, desde el mismo sitio que el resultado
           y el desglose impreso. En piezas devuelve vacío, que es lo correcto.

           El COLOR de la varianza lo decide el SIGNO, no la magnitud: el
           código de colores del directivo pinta por tamaño, y un −0.4% salía
           verde en la lista de faltantes — un renglón que dice que falta
           producto, en el color de que todo está bien.

           OJO: cualquier comentario va en el CÓDIGO, no en la plantilla de
           abajo. Dentro del texto viaja al HTML y se repite por renglón. */
        return { costo, carta, html: `<tr>
            <td style="font-weight:600">${etx(nom)}${meta?`<div style="font-size:8.5px;color:#777;font-weight:400;margin-top:1px">${etx(meta)}</div>`:''}${_notaInsumo(a.f.insumoId)?`<div style="font-size:8.5px;color:#9a6f00;font-style:italic;margin-top:2px">📝 ${etx(_notaInsumo(a.f.insumoId))}</div>`:''}</td>
            <td class="tc">${_exFmt(a, a.fisico)}</td>
            <td class="tc">${_exFmt(a, a.teorico)}</td>
            <td class="tc" style="font-weight:700;color:${col}">${a.dif>=0?'+':''}${a.dif.toFixed(1)} ${u}${_equivBarraHTML(a.dif, a.f, { signo:true, impreso:true })}</td>
            <td class="tc" style="color:${a.varSinBase ? '#aaa' : (a.varPct < 0 ? cCrit : cOk)};font-weight:700" title="${a.varSinBase ? 'Sin ventas ni producción en el período: no hay contra qué medir la varianza.' : ''}">${a.varSinBase ? '—' : (a.varPct>=0?'+':'') + a.varPct.toFixed(1) + '%'}</td>
            <td class="tr" style="font-weight:700;color:${col}">${$g('$'+_m2(costo))}</td>
            <td class="tr" style="color:${col}">${$g('$'+_m2(carta))}</td></tr>` };
    }
    const _CAB_FS = `<thead><tr><th>Producto</th><th class="tc">Físico</th><th class="tc">Teórico</th>
        <th class="tc">Diferencia</th><th class="tc">Varianza %</th><th class="tr">A costo</th><th class="tr">A carta</th></tr></thead>`;
    /* `out` recibe los totales de la lista. Se devuelven desde aquí en vez de
       volver a sumarlos afuera para el renglón del neto: dos recorridos del
       mismo arreglo es como una hoja acaba contradiciéndose a sí misma. */
    function _rdListaFS(items, esFalta, out){
        const col = esFalta ? cCrit : cOk;
        const quees = esFalta ? 'faltante' : 'sobrante';
        out = out || {};
        out.costo = 0; out.carta = 0; out.n = items.length;
        if (!items.length)
            return `<div class="rd-fs" style="font-size:10.5px;color:#aaa;padding:6px 0 14px">Sin ${esFalta?'faltantes':'sobrantes'} en este inventario. ✅</div>`;
        // Agrupar conservando el orden por impacto de adentro de cada grupo…
        const porGrupo = {}, orden = [];
        items.forEach(a => {
            const g = _grupoSeleccionS5(a.f, _compDeMiembro[a.f.insumoId]) || 'Sin grupo';
            if (!porGrupo[g]) { porGrupo[g] = []; orden.push(g); }
            porGrupo[g].push(a);
        });
        /* LAS PRESENTACIONES DE UN COMPUESTO VAN JUNTAS, con su línea
           combinada debajo. «Caguamas» no es una cosa y otra: es un producto
           que se vende en dos envases, y con los renglones repartidos por la
           tabla no hay manera de ver cuánto le falta AL PRODUCTO. Cada
           presentación sigue en su renglón —ese es el desglose— y la línea de
           abajo es el resumen. */
        const _filasDeGrupo = (lista) => {
            const unidades = [], porComp = {};
            lista.forEach(a => {
                const c = _compDeMiembro[a.f.insumoId];
                if (!c) { unidades.push({ solo:a, costo:_costoFS(a), carta:_cartaFS(a) }); return; }
                let u = porComp[c.id];
                if (!u) { u = porComp[c.id] = { comp:c, items:[], costo:0, carta:0 }; unidades.push(u); }
                u.items.push(a); u.costo += _costoFS(a); u.carta += _cartaFS(a);
            });
            // El compuesto pesa lo que pesan sus presentaciones juntas: así se
            // ordena entre los demás, no por su renglón más caro.
            unidades.sort((x, y) => y.costo - x.costo);
            let html = '', costo = 0, carta = 0, n = 0;
            unidades.forEach(u => {
                if (u.solo) { html += _rdFilaFS(u.solo, col).html; }
                else {
                    html += u.items.map(a => _rdFilaFS(a, col).html).join('');
                    /* Con UNA sola presentación en esta lista la línea
                       combinada repetiría el renglón de arriba palabra por
                       palabra. Un total de un solo sumando no es un total:
                       es ruido que hace más larga la hoja. (Puede pasar de
                       sobra: un envase falta y el otro sobra, y cada uno cae
                       en su lista.) */
                    if (u.items.length > 1)
                        html += _lineaTotalFS('🧩 ' + u.comp.nombre, u.items.length, u.costo, u.carta, col, 'comp', ['presentación', 'presentaciones']);
                }
                costo += u.costo; carta += u.carta; n += u.solo ? 1 : u.items.length;
            });
            return { html, costo, carta, n };
        };
        const bloques = [];
        // …y los GRUPOS también por impacto: el que más dinero mueve, arriba.
        orden.map(g => {
            const r = _filasDeGrupo(porGrupo[g]);
            return { g, filas:[r.html], costo:r.costo, carta:r.carta, n:r.n };
        }).sort((x, y) => y.costo - x.costo).forEach(b => {
            out.costo += b.costo; out.carta += b.carta;
            bloques.push(
                `<div class="rd-grptitle rd-fs" style="font-size:11px;font-weight:700;color:${col};margin:12px 0 4px">${etx(b.g)}</div>` +
                `<table class="rd-t rd-fs" style="margin-bottom:6px">${_CAB_FS}<tbody>${b.filas.join('')}` +
                /* El subtotal va DENTRO del tbody, como una fila más: en un
                   <tfoot> se perdería, porque al partir una tabla larga el
                   paginador clona la cabecera y no el pie — y una hoja de
                   totales sin totales no se ve rota, se ve corta. */
                _lineaTotalFS('Subtotal ' + b.g, b.n, b.costo, b.carta, col, 'grupo') +
                `</tbody></table>`);
        });
        bloques.push(
            `<table class="rd-t rd-fs" style="margin-bottom:14px"><tbody>` +
            _lineaTotalFS('TOTAL ' + quees.toUpperCase(), items.length, out.costo, out.carta, col, 'total') +
            `</tbody></table>`);
        return bloques.join('');
    }
    /* Las dos listas se arman AQUÍ, antes de la plantilla, para que el
       renglón del neto lea totales ya hechos en vez de depender del orden en
       que se evalúan los trozos de un texto. */
    const _totFaltFS = {}, _totSobrFS = {};
    const _htmlFaltFS = _rdListaFS(faltantesFS, true,  _totFaltFS);
    const _htmlSobrFS = _rdListaFS(sobrantesFS, false, _totSobrFS);
    const _netoCostoFS = _totSobrFS.costo - _totFaltFS.costo;
    const _netoCartaFS = _totSobrFS.carta - _totFaltFS.carta;

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

    /* ── Inventario completo (desglose por insumo) ── Es el MISMO armador del
       Paso 5, en versión de papel (_step5TablasHTML({papel:true})): dos
       renglones por producto con su título en cada celda, comentarios junto al
       nombre y los batches como ficha informativa. En el gerencial no van el
       costo de las entradas ni la diferencia a proveedor. */
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
            var _h = _horaCaptura(e.fecha, e.registrado);
            (porIns[e.insumoId] = porIns[e.insumoId] || []).push({ cant: parseFloat(e.cantidad)||0, fecha: e.fecha || '',
                hora: _h ? _h.txt : '', nota: e.notas || (e.origen === 'qr' ? 'QR' : '') });
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
                    '<td class="tc" style="color:#888">' + (e.fecha || '—') +
                        (e.hora ? ' <span style="font-size:9px">' + etx(e.hora) + '</span>' : '') + '</td>' +
                    '<td style="color:#888">' + etx(e.nota || '') + '</td>' +
                    '<td class="tr" style="color:#888">' + (i===0 ? '<strong style="color:#1a7a4a">+'+(tot % 1 ? tot.toFixed(1) : tot)+' '+_u(id)+'</strong>' : '') + '</td>' +
                '</tr>';
            }).join('');
        }).join('');
        return '<div class="rd-break"></div><div class="rd-sec">📥 Entradas por insumo — cantidad y fecha</div>' +
            '<table class="rd-t"><thead><tr><th>Insumo</th><th class="tc">Entrada</th><th class="tc">Fecha</th><th>Origen / nota</th><th class="tr">Total insumo</th></tr></thead><tbody>' + rows + '</tbody></table>';
    })();

    /* Mermas y cortesías, y aparte las cancelaciones (van con los descuentos). */
    const _mermasCortesiasHTML = `
      <div class="rd-sec">Mermas y cortesías del período</div>
      ${_mermados.length ? `<div class="rd-grp">${_movTit('🗑️ Productos mermados — '+_mermados.length)}
        <table class="rd-t"><thead><tr><th>Producto</th><th class="tc">Grupo</th><th class="tc">Merma</th><th>Motivo</th><th class="tr">Valor (carta)</th></tr></thead>
          <tbody>${_mermados.map(a=>`<tr><td style="font-weight:600">${etx(a.f.nombre)}</td><td class="tc" style="color:#888">${_grupoCategoria(a.f)}</td><td class="tc" style="color:${cCrit};font-weight:700">${a.merma.toFixed(1)} ${_uMC(a)}</td><td style="color:#888">${etx(a.f.mermaConcepto||'—')}</td><td class="tr" style="font-weight:600">$${_m2(a.merma*(a.f.precioCarta||0))}</td></tr>`).join('')}</tbody></table></div>`
        : _movTit('🗑️ Productos mermados — 0')+_movVacio}
      ${_cortesias.length ? `<div class="rd-grp">${_movTit('🎁 Cortesías — '+_cortesias.length)}
        <table class="rd-t"><thead><tr><th>Producto</th><th class="tc">Grupo</th><th class="tc">Cantidad</th><th>Concepto</th><th class="tr">Valor (carta)</th></tr></thead>
          <tbody>${_cortesias.map(a=>{ const ps=_cortPartes(a.f); return (ps.length ? ps : [{concepto:a.f.cortesiaConcepto||'—', copas:a.cortesia}]).map((p,i)=>`<tr><td style="font-weight:600">${i ? '' : etx(a.f.nombre)}</td><td class="tc" style="color:#888">${i ? '' : _grupoCategoria(a.f)}</td><td class="tc" style="color:#7d5fa3;font-weight:700">${p.copas.toFixed(1)} ${_uMC(a)}</td><td style="color:#888">${etx(p.concepto)}</td><td class="tr" style="font-weight:600">$${_m2(p.copas*(a.f.precioCarta||0))}</td></tr>`).join(''); }).join('')}</tbody></table></div>`
        : _movTit('🎁 Cortesías — 0')+_movVacio}`;
    const _cancelacionesHTML = `
      ${_cancels.length ? `<div class="rd-grp">${_movTit('🚫 Cancelaciones POS · informativo — '+_cancels.length)}
        <table class="rd-t"><thead><tr><th>Fecha / Hora</th><th>Producto</th><th class="tc">Cant.</th><th>Autorizó</th><th>Motivo</th><th>Mesero</th></tr></thead>
          <tbody>${_cancels.map(c=>`<tr><td style="white-space:nowrap;color:#888">${etx(c.fechaHora||'—')}</td><td style="font-weight:500">${etx(c.nombreProducto||'—')}</td><td class="tc" style="font-weight:700">${c.cantidad||'—'}</td><td>${etx(c.autorizo||c.responsable||'—')}</td><td style="color:#888">${etx(c.motivo||'—')}</td><td style="color:#888">${etx(c.mesero||'—')}</td></tr>`).join('')}</tbody></table></div>`
        : _movTit('🚫 Cancelaciones POS · informativo — 0')+_movVacio}`;
    // Descuentos: van al final del inventario (no es movimiento de producto).
    const _descuentosHTML = `${(!ger && (invActual.descuentos || []).length > 0) ? `
      <div class="rd-grp">${_movTit('💸 Descuentos del período — Total: $' + _m2(totalDesc))}
      <table class="rd-t"><thead><tr><th>Fecha / Hora</th><th class="tc">%</th><th class="tr">Monto $</th><th>Folio</th><th>Motivo</th><th>Autorizó</th></tr></thead>
        <tbody>${(invActual.descuentos || []).map(d => `<tr><td style="white-space:nowrap;color:#888">${d.fechaHora||'—'}</td><td class="tc">${d.porcentaje != null ? d.porcentaje + '%' : '—'}</td><td class="tr" style="color:${cCrit};font-weight:700">$${_m2((parseFloat(d.monto)||0))}</td><td>${etx(d.folio||'—')}</td><td style="color:#888">${etx(d.motivo||'—')}</td><td>${etx(d.autorizo||'—')}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    // Inventario completo: todos los grupos (bateo primero). El encabezado grande se repite por
    // hoja automáticamente porque TODO el reporte va dentro de una tabla con <thead> (ver abajo).
    const inventarioHTML = `
      <div class="rd-sec">Inventario completo por grupo de categoría</div>
      ${_step5TablasHTML({ papel: true, sinCostos: ger })}`;
    // Encabezado grande y pie que un PAGINADOR (mide alturas) replica en cada hoja A4 discreta.
    const _headHtml = rdHeader(`Inventario ${_tipoTxt} · ${periodoTxt} · ${_estadoInv}${desglose ? ' · Desglose por insumo' : faltsobr ? (' · ' + (_difStep5==='falta' ? 'Faltantes' : _difStep5==='sobra' ? 'Sobrantes' : 'Faltantes y sobrantes')) : ''}`);
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
.rd-t td{padding:6px 7px;border-bottom:1px solid #f0f0ec;vertical-align:middle;line-height:1.25;color:#1a1916}
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
  <span style="color:#f5f0e8;font-size:14px;font-weight:700">${ger?'🔐 Reporte Gerencial':'📊 Reporte Directivo'}${desglose?' · Desglose por insumo':faltsobr?' · Faltantes y sobrantes':''} — ${etx(inv.nombre || 'Inventario')}</span>
  <div style="display:flex;gap:8px">
    ${(desglose || faltsobr) ? `<button onclick="verReporteDirectivo(${ger?'true':'false'}, '')" style="padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;background:transparent;border:1px solid rgba(255,255,255,.3);color:#f5f0e8">📊 Ver resumen</button>` : ''}
    ${desglose ? '' : `<button onclick="verReporteDirectivo(${ger?'true':'false'}, 'desglose')" style="padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;background:transparent;border:1px solid rgba(255,255,255,.3);color:#f5f0e8">📑 Ver desglose por insumo</button>`}
    <div style="position:relative">
      <button onclick="_toggleRdShare(event)" style="padding:7px 18px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;background:#f5c842;color:#1a1916;border:none">📤 Compartir ▾</button>
      <div id="rdShareMenu" style="display:none;position:absolute;right:0;top:calc(100% + 6px);background:#1a1916;border:1px solid rgba(255,255,255,.22);border-radius:10px;overflow:hidden;min-width:230px;box-shadow:0 8px 24px rgba(0,0,0,.5)">
        <button id="rdBtnCompartirPDF" onclick="_rdShareClose();_compartirPDF()" style="display:flex;align-items:center;gap:8px;width:100%;padding:12px 16px;background:rgba(245,200,66,.14);border:none;border-bottom:1px solid rgba(255,255,255,.08);color:var(--accent-text,#f5c842);font-size:13px;font-weight:700;cursor:pointer;text-align:left" onmouseover="this.style.background='rgba(245,200,66,.22)'" onmouseout="this.style.background='rgba(245,200,66,.14)'">📄 Compartir PDF <span style="font-size:10px;opacity:.75;font-weight:400">(correo / WhatsApp)</span></button>
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
      <div class="rd-ks">Inversión calculada a precio proveedor</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Capital a carta</div>
      <div class="rd-kv" style="color:${cOk}">${$g('$'+_m0(capitalCarta))}</div>
      <div class="rd-ks">Inversión calculada a precio carta</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Margen potencial</div>
      <div class="rd-kv" style="color:${cOk}">${$g('$'+_m0(margenPot))}</div>
      <div class="rd-ks">Carta − costo</div>
    </div>
    <div class="rd-kpi">
      <div class="rd-kl">Cancelaciones POS · informativo</div>
      <div class="rd-kv" style="color:${numCancel > 5 ? cCrit : numCancel > 0 ? cWarn : '#555'}">${numCancel}</div>
      <div class="rd-ks">No afectan existencias ni consumo</div>
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
      ${_notaCard('__vtacompras__') ? `<div style="margin-top:8px;border-top:1px dashed #b9b3a5;padding-top:7px">
        <div style="font-size:9px;color:#56514a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">📝 Comentario de dirección</div>
        <div style="font-size:11px;color:#15140f;line-height:1.5;white-space:pre-wrap">${etx(_notaCard('__vtacompras__'))}</div>
      </div>` : ''}
    </div>
  </div>

  <!-- Diferencia física NETA: a precio carta y a precio proveedor, igual que la
       tarjeta del Paso 5 (Edwin, 21-nov). En el gerencial, solo carta: va sin costos. -->
  <div class="rd-kgrid" style="grid-template-columns:1fr;margin-bottom:8px">
    <div class="rd-kpi" style="border-left:4px solid ${netCarta>=0?cOk:cCrit}">
      <div class="rd-kl">${(netCarta>=0 && (ger || netCosto>=0)) ? 'Sobrante neto' : (netCarta<0 && (ger || netCosto<0)) ? 'Faltante neto' : 'Diferencia neta'} — sobrante − faltante</div>
      <div style="display:flex;gap:36px;align-items:flex-end;flex-wrap:wrap">
        <div><div class="rd-kv" style="color:${netCarta>=0?cOk:cCrit}">${netCarta>=0?'+':'−'}$${_m0(Math.abs(netCarta))}</div><div class="rd-ks">a precio de carta</div></div>
        ${ger ? '' : `<div><div class="rd-kv" style="color:${netCosto>=0?cOk:cCrit}">${netCosto>=0?'+':'−'}$${_m0(Math.abs(netCosto))}</div><div class="rd-ks">a precio proveedor</div></div>`}
      </div>
      ${invActual.comentarioNeto ? `<div style="margin-top:8px;border-top:1px dashed #ddd;padding-top:7px">
        <div style="font-size:9px;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">📝 Comentario de dirección</div>
        <div style="font-size:11px;color:#1a1916;line-height:1.5;white-space:pre-wrap">${etx(invActual.comentarioNeto)}</div>
      </div>` : ''}
    </div>
  </div>
  ${(function(){
      // Entradas que NO son compra (no entran a "Compras del período"): una card por tipo con dato.
      const _u = x => (x%1?x.toFixed(1):x)+' unid.';
      const kpi = (borde, titulo, valor, color, sub, items) => `
    <div class="rd-kpi" style="border-left:4px solid ${borde}">
      <div class="rd-kl">${titulo}</div>
      <div class="rd-kv" style="color:${color}">${valor}</div>
      <div class="rd-ks">${sub}</div>
      <div style="font-size:9px;color:#666;margin-top:4px;line-height:1.5"><strong>Productos:</strong> ${items}</div>
    </div>`;
      const cards = [];
      if (bonifU>0)  cards.push(kpi(cOk, '🎁 Bonificación', _u(bonifU), cOk, ger?'sin costo':'valor $'+_m0(bonifCosto)+' (sin costo)', _listaItems(bonifItems)));
      if (consigU>0) cards.push(kpi('#2471a3', '📦 Consignación', _u(consigU), '#2471a3', ger?'en consignación':'valor $'+_m0(consigCosto), _listaItems(consigItems)));
      if (prestU>0)  cards.push(kpi('#b5762a', '🔁 Préstamo pagado', _u(prestU), '#b5762a', ger?'préstamo liquidado':'valor $'+_m0(prestCosto)+' (no es compra)', _listaItems(prestItems)));
      return cards.length ? `
  <div class="rd-kgrid" style="grid-template-columns:repeat(${cards.length},1fr);margin-bottom:8px">${cards.join('')}</div>` : '';
  })()}

  <!-- ══ EL REPORTE DIRECTIVO, EN EL ORDEN DE EDWIN (21-nov) ═══════════════
       Sin semáforo (era consumo y no se entendía). Primero el top 10, luego
       las dos listas que importan —faltantes y sobrantes— con la misma vista
       del desglose por insumo, y entre ellas sus totales EN DINERO (a precio
       carta y a precio proveedor: copas, piezas y gramos no se suman).
       Después mermas y cortesías, insumos sin movimiento, cancelaciones y
       descuentos, y al final las entradas. En el gerencial no va lo que es a
       precio proveedor. -->

  <!-- Top 10 más vendidos -->
  <div class="rd-sec">Top 10 más vendidos del período</div>
  ${top10.length ? `
  <table class="rd-t">
    <thead><tr>
      <th style="width:20px">#</th>
      <th>Producto</th>
      <th class="tc">Vendido</th>
      ${ger ? '' : '<th class="tr">A precio proveedor</th>'}
      <th class="tr">A precio carta</th>
    </tr></thead>
    <tbody>
      ${top10.map((t, i) => {
        const a = t.a, u = a.f.tipo === 'pza' ? 'pza' : a.f.tipo === 'peso' ? (a.f.baseUnit || 'g').toLowerCase() : 'cop';
        const n1 = v => (Math.round(v * 10) / 10).toLocaleString('es-MX');
        const bot = a.f.tipo === 'copa' && a.copasBot > 1 ? ' <span style="color:#888;font-weight:400">· ' + (t.vend / a.copasBot).toFixed(2) + ' bot</span>' : '';
        return `<tr>
          <td><span class="rd-rank">${i+1}</span></td>
          <td style="font-weight:600">${etx(a.f.nombre)}<br><span style="font-size:9px;color:#aaa;font-weight:400">${etx(a.f.categoria||'')}</span></td>
          <td class="tc" style="font-weight:700">${n1(t.vend)} ${u}${bot}</td>
          ${ger ? '' : `<td class="tr">$${_m2(t.prov)}</td>`}
          <td class="tr" style="font-weight:700;color:${cOk}">$${_m2(t.carta)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>` : '<div style="font-size:11px;color:#aaa;padding:8px 0">Sin ventas registradas en el período.</div>'}

  <!-- Faltantes -->
  <div class="rd-break"></div>
  <div class="rd-sec" style="color:${cCrit};border-bottom-color:${cCrit}">▼ Faltantes del período — lo que no apareció</div>
  <div style="font-size:11px;color:#1a1916;margin:-4px 0 8px">Total faltante: <b style="color:${cCrit}">−$${_m2(faltCarta)}</b> a precio carta${ger ? '' : ` · <b style="color:${cCrit}">−$${_m2(faltCosto)}</b> a precio proveedor`}</div>
  ${_step5TablasHTML({ papel: true, sinCostos: ger, dif: 'falta', vacio: 'Sin faltantes en el período.' })}

  <!-- Los totales, en dinero -->
  <div class="rd-kgrid" style="grid-template-columns:${ger ? '1fr' : '1fr 1fr'};margin:12px 0 4px">
    <div class="rd-kpi">
      <div class="rd-kl">A precio carta</div>
      <div style="display:flex;gap:22px;align-items:flex-end;flex-wrap:wrap">
        <div><div class="rd-kv" style="color:${cCrit}">−$${_m0(faltCarta)}</div><div class="rd-ks">faltante</div></div>
        <div><div class="rd-kv" style="color:${cOk}">+$${_m0(sobrCarta)}</div><div class="rd-ks">sobrante</div></div>
        <div><div class="rd-kv" style="color:${netCarta>=0?cOk:cCrit}">${netCarta>=0?'+':'−'}$${_m0(Math.abs(netCarta))}</div><div class="rd-ks">neto</div></div>
      </div>
    </div>
    ${ger ? '' : `<div class="rd-kpi">
      <div class="rd-kl">A precio proveedor</div>
      <div style="display:flex;gap:22px;align-items:flex-end;flex-wrap:wrap">
        <div><div class="rd-kv" style="color:${cCrit}">−$${_m0(faltCosto)}</div><div class="rd-ks">faltante</div></div>
        <div><div class="rd-kv" style="color:${cOk}">+$${_m0(sobrCosto)}</div><div class="rd-ks">sobrante</div></div>
        <div><div class="rd-kv" style="color:${netCosto>=0?cOk:cCrit}">${netCosto>=0?'+':'−'}$${_m0(Math.abs(netCosto))}</div><div class="rd-ks">neto</div></div>
      </div>
    </div>`}
  </div>

  <!-- Sobrantes -->
  <div class="rd-sec" style="color:${cOk};border-bottom-color:${cOk}">▲ Sobrantes del período — lo que apareció de más</div>
  <div style="font-size:11px;color:#1a1916;margin:-4px 0 8px">Total sobrante: <b style="color:${cOk}">+$${_m2(sobrCarta)}</b> a precio carta${ger ? '' : ` · <b style="color:${cOk}">+$${_m2(sobrCosto)}</b> a precio proveedor`}</div>
  ${_step5TablasHTML({ papel: true, sinCostos: ger, dif: 'sobra', vacio: 'Sin sobrantes en el período.' })}

  <!-- Mermas y cortesías -->
  <div class="rd-break"></div>
  ${_mermasCortesiasHTML}

  <!-- Insumos sin movimiento -->
  ${estancados.length > 0 ? `
  <div class="rd-sec">Insumos sin movimiento (${estancados.length}) — sin uso en el período</div>
  <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">
    ${estancados.map(a => `<span style="font-size:10px;background:#f5f5f0;border:1px solid #e0e0d8;border-radius:4px;padding:2px 8px;color:#666">${etx(a.f.nombre)}</span>`).join('')}
  </div>` : ''}

  <!-- Cancelaciones y descuentos -->
  <div class="rd-sec">Cancelaciones y descuentos</div>
  ${_cancelacionesHTML}
  ${_descuentosHTML}

  <!-- Entradas -->
  ${_entradasPorInsumoHTML}

  <div class="rd-break"></div>
  ${inventarioHTML}

  <!-- Exporte aparte: las dos caras de la diferencia.
       CADA PIEZA VA SUELTA, hermana de las demás, y marcada con la clase
       rd-fs para que la poda la reconozca. Envueltas en un solo div el
       paginador no puede partirlas: mide el nodo entero, no cabe en la hoja,
       y como .rd-pagebody recorta lo que sobra, todo lo que pasaba de la
       primera hoja —media lista, los sobrantes y el neto— desaparecía sin
       avisar. OJO: aquí dentro NO se pueden usar comillas invertidas; esto
       vive en una plantilla de texto y las cerraría. -->
  ${_txtFiltroFS ? `<div class="rd-fs" style="font-size:10.5px;color:#9a6f00;background:#fffaf0;border-left:3px solid #e0a800;padding:7px 10px;margin:0 0 10px">
    <b>Hoja filtrada:</b> ${etx(_txtFiltroFS)}. Los totales de abajo son de lo que sale impreso, no del inventario completo.</div>` : ''}
  ${_difStep5 === 'sobra' ? '' : `
  <div class="rd-sec rd-fs" style="color:${cCrit};border-bottom-color:${cCrit};font-size:12px">▼ Faltantes — lo que NO apareció</div>
  <div class="rd-fs" style="font-size:10px;color:#888;margin:-4px 0 8px">Físico por debajo del teórico. «A costo» es lo que costó reponerlo; «a carta», lo que se hubiera cobrado.</div>
  ${_htmlFaltFS}`}
  ${_difStep5 === 'falta' ? '' : `
  <div class="rd-sec rd-fs" style="color:${cOk};border-bottom-color:${cOk};font-size:12px;margin-top:26px">▲ Sobrantes — lo que apareció DE MÁS</div>
  <div class="rd-fs" style="font-size:10px;color:#888;margin:-4px 0 8px">Físico por encima del teórico. Casi siempre es una entrada capturada dos veces, una salida sin registrar o una existencia anterior equivocada.</div>
  ${_htmlSobrFS}`}
  <div class="rd-sec rd-fs">Resultado neto ${_txtFiltroFS ? 'de lo impreso' : 'del período'}</div>
  <table class="rd-t rd-fs">
    <thead><tr><th>Concepto</th><th class="tr">A costo</th><th class="tr">A carta</th></tr></thead>
    <tbody>
      <tr><td style="color:${cCrit}">Faltantes (${_totFaltFS.n})</td><td class="tr" style="color:${cCrit}">−${$g('$'+_m2(_totFaltFS.costo))}</td><td class="tr" style="color:${cCrit}">−${$g('$'+_m2(_totFaltFS.carta))}</td></tr>
      <tr><td style="color:${cOk}">Sobrantes (${_totSobrFS.n})</td><td class="tr" style="color:${cOk}">+${$g('$'+_m2(_totSobrFS.costo))}</td><td class="tr" style="color:${cOk}">+${$g('$'+_m2(_totSobrFS.carta))}</td></tr>
      <tr style="background:#f5f5f0"><td style="font-weight:900;border-top:2px solid #ddd">Neto</td>
        <td class="tr" style="font-weight:900;border-top:2px solid #ddd;color:${_netoCostoFS>=0?cOk:cCrit}">${_netoCostoFS>=0?'+':'−'}${$g('$'+_m2(Math.abs(_netoCostoFS)))}</td>
        <td class="tr" style="font-weight:900;border-top:2px solid #ddd;color:${_netoCartaFS>=0?cOk:cCrit}">${_netoCartaFS>=0?'+':'−'}${$g('$'+_m2(Math.abs(_netoCartaFS)))}</td></tr>
    </tbody></table>
  <div class="rd-fs" style="font-size:9px;color:#aaa;margin-top:6px">Las unidades no se suman entre sí a propósito: copas, piezas y gramos no son la misma cosa. Lo que se totaliza es el dinero.</div>

</div>`;

    document.body.appendChild(overlay);
    try { _rdPodarPorModo(overlay.querySelector('#rd-src'), modo || ''); }
    catch(e) { console.warn('[reporte] poda por modo falló:', e); }
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
        // La presencia distingue una edición borrada de una fila nunca tocada.
        // Conservar el cero/vacío permite guardar la eliminación de la última
        // salida o comentario, sin que el blindaje anti-borrado resucite el valor.
        || f.ventasComentario !== undefined
        || f.cortesiaBotella !== undefined || f.mermaBotella !== undefined
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
    invActual.guardadoTs = new Date().toISOString();   // cuál copia es la más nueva
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
/* Al salir hay que soltar TODO lo pendiente, no solo el borrador local. El
   guardado del inventario va con 600 ms de retraso (debounce): si tecleabas "30"
   y navegabas enseguida, ese timer nunca llegaba a correr —solo se escribía el
   respaldo local— y al reabrir el inventario la nube seguía teniendo el número
   viejo. Eso es "puse 30, guardé, volví a entrar y decía 16". */
function _flushPendientes() {
    _persistirBorradorLocal();
    try {
        if (_autoGuardarTimer) {
            clearTimeout(_autoGuardarTimer); _autoGuardarTimer = null;
            guardarInventario();
        }
    } catch (e) { console.warn('[inv] flush al salir:', e); }
}
window._flushPendientes = _flushPendientes;
window.addEventListener('pagehide',     _flushPendientes);
window.addEventListener('beforeunload', _flushPendientes);
window.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'hidden') _flushPendientes(); });

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
    // Aquí no hay clave de por medio, pero la hora sí importa igual: si
    // el inventario no es de hoy, la frontera hay que preguntarla.
    _conCierreOperativo(invActual, function(){
        invActual.cerrado = true; _sellarCierre(invActual); delete invActual._eraCerrado;
        let guardado = false;
        try { guardarInventario(); guardado = true; } catch(e) { console.warn('[guardarYSalir]', e); }
        if (!guardado) {
            invActual.cerrado = false;
            alert('No se pudo guardar el inventario (almacenamiento lleno). Intenta cerrar otras pestañas o liberar espacio y vuelve a intentarlo.');
            return;
        }
        invActual = null;
        mostrarVista('vistaLista');
    });
}

function finalizarPrimerLev() {
    if (typeof _exigeInv === 'function' && !_exigeInv('cerrar', 'No puedes cerrar inventarios.')) return;
    if (!invActual) return;
    if (invActual.cerrado) return;
    _conCierreOperativo(invActual, function(){
    _solicitarClave('Guardar y cerrar levantamiento', function() {
        invActual.cerrado = true; _sellarCierre(invActual); delete invActual._eraCerrado;
        let ok = false;
        try { guardarInventario(); ok = true; } catch(e) {}
        if (!ok) { invActual.cerrado = false; alert('No se pudo guardar (almacenamiento lleno).'); return; }
        // Salida LIMPIA: sin esto, invActual quedaba seteado y el siguiente
        // inventario reusaba este objeto (iniciarInventario: esNuevo = !invActual)
        // → "al abrir otro también se abría el primer levantamiento".
        invActual = null; filasCaptura = [];
        mostrarVista('vistaLista');
    });
    });   // cierra _conCierreOperativo
}

function cerrarInventario() {
    if (typeof _exigeInv === 'function' && !_exigeInv('cerrar', 'No puedes cerrar inventarios.')) return;
    if (!invActual) return;
    if (invActual.cerrado) { alert('Este inventario ya está cerrado.'); return; }
    _conCierreOperativo(invActual, function(){
    _solicitarClave('Cerrar y finalizar inventario', function() {
        invActual.cerrado = true; _sellarCierre(invActual); delete invActual._eraCerrado;
        let ok = false;
        try { guardarInventario(); ok = true; } catch(e) {}
        if (!ok) { invActual.cerrado = false; alert('No se pudo guardar (almacenamiento lleno).'); return; }
        actualizarNavBtns();
        invActual = null; filasCaptura = []; // salida limpia (no reusar en el siguiente)
        mostrarVista('vistaLista');
    });
    });   // cierra _conCierreOperativo
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
    _rearmarConDatosFrescos(invActual);   // catálogo y recetas de la nube: lo de otras pestañas también
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

/* ══ «REVISAR ENTRADAS» ES EL MISMO PASO 2 (Edwin, 23-nov) ═════════════════
   Afuera de un inventario, registrar abría un modal viejo —el insumo en
   chips, fecha, tipo, cantidad y costo— que no se parecía en nada al Paso 2,
   y la lista decía solo «Jumex» tres veces sin saber cuál era cuál. Ahora es
   la MISMA pantalla: a la izquierda todos los insumos de la sucursal (el
   buscador los reduce; al tocar uno, ese espacio se vuelve el registro), a la
   derecha lo registrado, agrupado por insumo y con su ficha completa.

   Las mismas funciones pintan las dos. Lo único que cambia es DE DÓNDE salen
   los insumos (_entFuente) y A DÓNDE va la entrada (_entGuardarNuevas): sin
   inventario abierto va solo al log global, con el sello de la sucursal, y el
   inventario que cubra su fecha la jala al abrirse (el import por periodo de
   siempre). */
function _entFuente() {
    if (invActual) return filasCaptura;
    if (!_entLogInsumoCache) {
        _entLogInsumoCache = _catalogoUnicoInv()
            .filter(function (ins) { return ins && !ins.esSubReceta; })   // un prebatch se produce, no se compra
            .map(function (ins) { return Object.assign({}, ins, { insumoId: _canonInsumoId(ins.id) }); })
            .sort(function (a, b) {
                return String(insumoTitulo(a) || a.nombre || '').localeCompare(String(insumoTitulo(b) || b.nombre || ''), 'es');
            });
    }
    return _entLogInsumoCache;
}
function _entFilaDe(id) {
    var l = _entFuente();
    for (var i = 0; i < l.length; i++) if (l[i] && l[i].insumoId === id) return l[i];
    return null;
}
/* Hoy en la hora de la barra, no en UTC: a las 7 de la noche toISOString ya
   dice mañana. */
function _hoyLocalEnt() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
}
function _entFechaDefault() { return invActual ? _fechaSugeridaEntrada() : _hoyLocalEnt(); }
/* Afuera no hay periodo: lo que sirve para no registrar dos veces es lo que
   ya entró HOY de cada insumo, en esta sucursal. */
function _entHoyMapa() {
    var hoy = _hoyLocalEnt(), suc = _sucActiva(), m = {};
    getEntradasLog().forEach(function (e) {
        if (!e || e.borrada || e.concepto === 'merma' || e.concepto === 'salida') return;
        if (String(e.fecha || '').slice(0, 10) !== hoy) return;
        if (suc && (e.sucursalId || '') !== suc) return;
        var k = _canonInsumoId(e.insumoId);
        m[k] = (m[k] || 0) + (parseFloat(e.cantidad) || 0);
    });
    return m;
}

/* El botón viejo ya no abre un modal: lleva a la pantalla y pone el cursor en
   el buscador de productos. */
function abrirRegistroEntradas() {
    if (typeof _exigeInv === 'function' && !_exigeInv('entradas', 'No puedes registrar entradas de mercancía.')) return;
    var ve = document.getElementById('vistaEntradas');
    if (!ve || ve.style.display === 'none') mostrarVista('vistaEntradas');
    var inp = document.getElementById('entBuscador'); if (inp) inp.focus();
}

/* UNA O VARIAS ENTRADAS NUEVAS (una suelta, o los renglones de una nota) a
   sus dos casas, en un solo lugar:
     · con inventario abierto, a su entradasLog y el espejo al log global
       (como siempre: así sale también en el registro de afuera);
     · sin inventario, solo al log global con el sello de la sucursal; el
       inventario que cubra su fecha la jala solo.
   Antes cada pantalla armaba el registro a su manera, y por eso el de afuera
   se guardaba sin fotos. */
function _entGuardarNuevas(regs) {
    if (!invActual && typeof _exigeInv === 'function' && !_exigeInv('entradas', 'No puedes registrar entradas de mercancía.')) return false;
    if (!regs || !regs.length) return false;
    var suc = _sucActiva() || 'suc_principal', ahora = new Date().toISOString();
    var armadas = regs.map(function (r) {
        var ins = _insumoDeEntrada(r.insumoId), fila = _entFilaDe(r.insumoId);
        var fotos = (r.fotos || []).slice();
        return { r: r, id: genId() + genId(), ins: ins, fila: fila, fotos: fotos,
                 etq: ins ? insumoEtiqueta(ins) : (fila ? (insumoEtiqueta(fila) || fila.nombre) : r.insumoId),
                 nota: _entNotaCampos(r) };
    });
    if (invActual) {
        if (!invActual.entradasLog) invActual.entradasLog = [];
        armadas.forEach(function (a) {
            invActual.entradasLog.push(Object.assign({
                id: a.id, insumoId: a.r.insumoId, nombreProducto: a.etq,
                tipo: a.r.tipo, cantidad: a.r.cantidad, fecha: a.r.fecha,
                /* La hora de captura también en la copia de ADENTRO del
                   inventario (24-nov): solo la llevaba la del registro general,
                   y es la que decide si la entrada cayó antes o después del
                   cierre. Sin ella el inventario la repartía por día. */
                registrado: ahora,
                origen: 'manual', sucursalId: suc,
                foto_urls: a.fotos, foto_url: a.fotos[0] || ''
            }, a.nota));
        });
        guardarEntradas();
    }
    try {
        // Sin caché todavía, el push caía en un arreglo suelto y se perdía aquí.
        if (!_cacheEL) _cacheEL = _cargarELLocal();
        var gl = getEntradasLog(), nuevas = [];
        armadas.forEach(function (a) {
            var g = Object.assign({
                id: a.id, insumoId: a.r.insumoId,
                nombre: a.ins ? a.ins.nombre : (a.fila ? (a.fila.nombre || '') : ''),
                nombreProducto: a.etq,
                familia: a.ins ? (a.ins.familia || '') : '',
                cantidad: a.r.cantidad, costo: 0, tipo: a.r.tipo, notas: '',
                fecha: a.r.fecha, origen: 'manual', sucursalId: suc,
                foto_urls: a.fotos.slice(), foto_url: a.fotos[0] || '',
                registrado: ahora
            }, a.nota);
            if (invActual) g.importadoEnInv = invActual.id;
            gl.push(g); nuevas.push(g);
        });
        _guardarELLocal();
        nuevas.forEach(function (g) { try { _sbUpEL(g); } catch (e) { console.warn('[entrada nueva → nube]', e); } }); // el diff no ve el push → forzar
    } catch (e) { console.warn('[entrada nueva → log global]', e); }
    _invalidarStep5();          // entró producto → el resumen debe rehacerse
    return true;
}

/* ══ ENTRADA POR NOTA / FACTURA (Edwin, 23-nov) ═══════════════════════════
   Una compra de refrescos trae seis productos en el mismo ticket. Uno por uno
   se repetían tipo, fecha y foto seis veces, y la foto del ticket quedaba
   pegada a un solo producto. Ahora se abre una NOTA: proveedor, folio, fecha,
   tipo y las fotos van UNA vez, arriba; se tocan los productos de la lista y
   cada cantidad se va sumando a la nota (el mismo producto dos veces se
   acumula). «Registrar nota» crea una entrada por producto, todas con la misma
   nota (notaId), las mismas fotos y los mismos datos.

   Mientras se arma vive como BORRADOR en este equipo, uno por pantalla (el
   Paso 2 de cada inventario y el registro de afuera de cada sucursal), así que
   recargar la tablet a media nota no la pierde. Nada entra al inventario
   hasta registrarla. */
var _entNota = null, _entNotaQr = false, _entNotaSubiendo = false;
function _entNotaCampos(o) {
    return (o && o.notaId) ? { notaId: o.notaId, notaFolio: o.notaFolio || '', notaProveedor: o.notaProveedor || '' } : {};
}
function _entNotaCtx() { return invActual ? 'inv:' + invActual.id : 'suc:' + (_sucActiva() || ''); }
function _entNotaLlave(ctx) { return 'etaax_' + getNegocioActivo() + '_notaEntrada_' + ctx; }
// La nota de ESTA pantalla (la de otra se queda guardada en su borrador).
function _entNotaSync() {
    var ctx = _entNotaCtx();
    if (_entNota && _entNota.ctx === ctx) return _entNota;
    if (_entNotaQr) { _entNotaQr = false; _qrEvidCerrar(); }
    _entNota = null;
    try {
        var b = JSON.parse(localStorage.getItem(_entNotaLlave(ctx)) || 'null');
        if (b && b.ctx === ctx && Array.isArray(b.items)) { if (!Array.isArray(b.fotos)) b.fotos = []; _entNota = b; }
    } catch (e) {}
    return _entNota;
}
function _entNotaGuardar() {
    try { if (_entNota) localStorage.setItem(_entNotaLlave(_entNota.ctx), JSON.stringify(_entNota)); } catch (e) {}
}
function _entNotaCantDe(id) {
    if (!_entNota) return 0;
    for (var i = 0; i < _entNota.items.length; i++) if (_entNota.items[i].insumoId === id) return parseFloat(_entNota.items[i].cant) || 0;
    return 0;
}
function _entBtnNotaHTML() {
    var n = _entNotaSync();
    return '<button class="btn-vista ph-nota' + (n ? ' on' : '') + '" onclick="abrirNotaEntrada()" ' +
        'title="Una compra con varios productos: se arma la nota y se registra completa">' + _icInv('nom-recibo', 15) +
        (n ? 'Nota abierta · ' + n.items.length : 'Nota / factura') + '</button>';
}
function _entPintarFranja() {
    if (invActual) { if (typeof _pintarHerrPaso === 'function') _pintarHerrPaso(); }
    else _pintarEntHerr();
    /* Repintar la barra deja vacías las pestañas de lo registrado (las llena
       la lista con sus contadores): se vuelven a llenar. */
    var ch = document.getElementById('entTipoChips');
    if (ch && !ch.innerHTML.trim()) renderListadoEntradas();
}
function _entPintarIzq() { _entPintarNota(); renderFormEntrada(); renderChipsEntrada(); _entPintarFranja(); }

function abrirNotaEntrada() {
    if (!invActual && typeof _exigeInv === 'function' && !_exigeInv('entradas', 'No puedes registrar entradas de mercancía.')) return;
    if (!_entNotaSync()) {
        _entNota = { id: genId() + genId(), ctx: _entNotaCtx(), proveedor: '', folio: '', fecha: _entFechaDefault(),
                     tipo: 'compra', fotos: [], items: [], creada: new Date().toISOString() };
        _entNotaGuardar();
    }
    // Lo que se toque ahora va a la nota: el registro suelto que estuviera abierto se cierra.
    _entRapidaInsumoId = null; _entRapidaFotos = [];
    if (_entRapidaQr) { _entRapidaQr = false; _qrEvidCerrar(); }
    _entPintarIzq();
    var c = document.getElementById('entNotaCard');
    if (c && c.scrollIntoView) { try { c.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
}
function _entNotaCampo(campo, val) {
    if (!_entNotaSync()) return;
    _entNota[campo] = val;
    _entNotaGuardar();
}
function setTipoNota(t) {
    if (!_entNotaSync()) return;
    _entNota.tipo = t; _entNotaGuardar(); _entPintarNota();
}
function _entNotaSumar(id, cant) {
    if (!_entNotaSync()) return;
    var it = null;
    for (var i = 0; i < _entNota.items.length; i++) if (_entNota.items[i].insumoId === id) { it = _entNota.items[i]; break; }
    if (it) it.cant = Math.round(((parseFloat(it.cant) || 0) + cant) * 10000) / 10000;
    else _entNota.items.push({ insumoId: id, cant: cant });
    _entNotaGuardar();
    var f = _entFilaDe(id), u = _unidadCompra({ insumoId: id });
    _entAviso('+' + fmtBot(cant) + ' ' + u + ' a la nota · ' + (f ? (insumoTitulo(f) || f.nombre) : '') +
              (it ? ' (van ' + fmtBot(it.cant) + ' ' + u + ')' : ''));
    _entRapidaInsumoId = null;
    _entPintarIzq();
}
function _entNotaCambiarCant(i, val) {
    if (!_entNotaSync() || !_entNota.items[i]) return;
    var n = parseFloat(val);
    if (!(n > 0)) _entNota.items.splice(i, 1); else _entNota.items[i].cant = n;
    _entNotaGuardar(); _entPintarNota(); renderChipsEntrada(); _entPintarFranja();
}
function _entNotaQuitar(i) {
    if (!_entNotaSync()) return;
    _entNota.items.splice(i, 1);
    _entNotaGuardar(); _entPintarNota(); renderChipsEntrada(); _entPintarFranja();
}
function _entNotaDescartar() {
    if (!_entNotaSync()) return;
    var n = _entNota.items.length;
    if (n && !confirm('¿Descartar esta nota con ' + n + ' producto' + (n !== 1 ? 's' : '') + '? No se registra nada.')) return;
    _entNotaCerrar();
}
function _entNotaCerrar() {
    if (_entNota) { try { localStorage.removeItem(_entNotaLlave(_entNota.ctx)); } catch (e) {} }
    _entNota = null;
    if (_entNotaQr) { _entNotaQr = false; _qrEvidCerrar(); }
    _entRapidaInsumoId = null;
    _entPintarIzq();
}
function _entNotaToggleQr() {
    if (!_entNotaSync()) return;
    if (_entNotaQr) { _entNotaQr = false; _qrEvidCerrar(); _entPintarNota(); return; }
    _entNotaQr = true; _entPintarNota();
    _qrEvidAbrir('entNotaQrSlot', function (foto) {
        if (!foto || !foto.url || !_entNota) return;
        _entNota.fotos.push(foto.url); _entNotaGuardar(); _entNotaPintarFotos();
    });
}
async function _entNotaSubirFotos(input) {
    if (!input.files || !input.files.length || !_entNotaSync()) return;
    var files = Array.prototype.slice.call(input.files), nota = _entNota;
    input.value = '';
    _entNotaSubiendo = true; _entNotaPintarFotos();
    for (var i = 0; i < files.length; i++) {
        try { var url = await _entEdSubirUna(files[i]); if (url) nota.fotos.push(url); } catch (e) { console.warn('[foto nota]', e); }
    }
    _entNotaSubiendo = false;
    if (_entNota === nota) _entNotaGuardar();
    _entNotaPintarFotos();
}
function _entNotaQuitarFoto(i) {
    if (!_entNotaSync()) return;
    _entNota.fotos.splice(i, 1); _entNotaGuardar(); _entNotaPintarFotos();
}
function _entNotaPintarFotos() {
    var el = document.getElementById('entNotaFotos'); if (!el || !_entNota) return;
    el.innerHTML = _entNota.fotos.map(function (u, i) {
        return '<span class="ent-ed-foto"><img ' + sbAttr(u) + ' onclick="etaaxVerFoto(this.src)">' +
            '<button title="Quitar foto" onclick="_entNotaQuitarFoto(' + i + ')">✕</button></span>';
    }).join('') +
    '<label class="ent-ed-addfoto" title="Subir desde este equipo">' + (_entNotaSubiendo ? '…' : _icInv('adm-subir-archivo', 20)) +
        '<input type="file" accept="image/*" multiple style="display:none" onchange="_entNotaSubirFotos(this)"></label>';
}
function _entPintarNota() {
    var cont = document.getElementById('entNotaCard'); if (!cont) return;
    if (!_entNotaSync()) { if (cont.innerHTML) cont.innerHTML = ''; return; }
    var qrB = _entNotaQr ? _qrEvidApartar() : null;
    var n = _entNota.items.length, per = _periodoInvActual();
    var items = n ? _entNota.items.map(function (it, i) {
        var f = _entFilaDe(it.insumoId) || _insumoDeEntrada(it.insumoId) || { nombre: it.insumoId };
        var meta = insumoMeta(f) ? insumoMetaHTML(f) : '';
        return '<div class="ent-nota-it"><span class="p12-nom">' + etx(insumoTitulo(f) || f.nombre || '—') + (meta ? '<small>' + meta + '</small>' : '') + '</span>' +
            '<input type="number" class="ent-nota-cant" min="0" step="any" inputmode="decimal" value="' + etx(String(it.cant)) + '" ' +
                'onchange="_entNotaCambiarCant(' + i + ', this.value)" aria-label="Cantidad">' +
            '<span class="ent-nota-u">' + etx(_unidadCompra({ insumoId: it.insumoId })) + '</span>' +
            '<button class="ent-nota-x" title="Quitar de la nota" onclick="_entNotaQuitar(' + i + ')">✕</button></div>';
    }).join('') : '<div class="ent-nota-vacia">Toca los productos en la lista de abajo y escribe cuánto llegó de cada uno. ' +
        'Si repites un producto, se suma.</div>';
    cont.innerHTML = '<div class="ent-form-card ent-nota">' +
        '<div class="ent-nota-cab"><div><div class="ent-nota-tit">' + _icInv('nom-recibo', 18) + 'Nota / factura</div>' +
            '<div class="ent-nota-sub">' + (n ? n + ' producto' + (n !== 1 ? 's' : '') + ' en la nota' : 'Una sola compra con varios productos') + '</div></div>' +
            '<button class="ent-nota-cerrar" title="Descartar la nota" onclick="_entNotaDescartar()">✕</button></div>' +
        '<div class="ent-nota-datos">' +
            '<label><span>Proveedor</span><input id="entNotaProv" type="text" value="' + etx(_entNota.proveedor || '') + '" placeholder="Ej. Coca-Cola" ' +
                'oninput="_entNotaCampo(\'proveedor\', this.value)" autocomplete="off"></label>' +
            '<label><span>Folio</span><input id="entNotaFolio" type="text" value="' + etx(_entNota.folio || '') + '" placeholder="Opcional" ' +
                'oninput="_entNotaCampo(\'folio\', this.value)" autocomplete="off"></label>' +
            '<label><span>Fecha</span><input id="entNotaFecha" type="date" value="' + etx(_entNota.fecha || '') + '" ' +
                'min="' + etx(per.desde || '') + '" max="' + etx(per.hasta || '') + '" onchange="_entNotaCampo(\'fecha\', this.value)"></label>' +
        '</div>' +
        '<div class="ent-tipo-row">' + ENT_TIPOS.map(function (t) {
            return '<button class="ent-tipo-btn ' + (_entNota.tipo === t.id ? 'active' : '') + '" onclick="setTipoNota(\'' + t.id + '\')">' + _icInv(t.ic) + t.lbl + '</button>';
        }).join('') + '</div>' +
        '<div class="ent-nota-items">' + items + '</div>' +
        '<div class="ent-evid"><div class="ent-nota-lbl">Evidencia de la nota: foto del ticket o la factura (vale para todos sus productos)</div>' +
            '<div class="ent-ed-fotos" id="entNotaFotos"></div>' +
            '<div style="margin-top:8px">' + _qrEvidBoton(_entNotaQr, '_entNotaToggleQr()') + '</div><div id="entNotaQrSlot"></div></div>' +
        '<button class="ent-nota-reg" onclick="registrarNotaEntrada()"' + (n ? '' : ' disabled') + '>' +
            (n ? 'Registrar nota · ' + n + ' producto' + (n !== 1 ? 's' : '') : 'Registrar nota') + '</button>' +
    '</div>';
    _entNotaPintarFotos();
    if (qrB) _qrEvidReponer(qrB, 'entNotaQrSlot');
}
function registrarNotaEntrada() {
    if (!invActual && typeof _exigeInv === 'function' && !_exigeInv('entradas', 'No puedes registrar entradas de mercancía.')) return;
    if (!_entNotaSync()) return;
    var nota = _entNota;
    var items = nota.items.filter(function (it) { return (parseFloat(it.cant) || 0) > 0; });
    if (!items.length) { alert('La nota no tiene productos todavía: tócalos en la lista y escribe cuánto llegó de cada uno.'); return; }
    if (_entNotaSubiendo) { alert('Espera a que terminen de subir las fotos de la nota.'); return; }
    var fecha = nota.fecha || _entFechaDefault();
    // El mismo candado que la entrada suelta: fuera del periodo no se guarda.
    var fuera = _fechaFueraDePeriodo(fecha);
    if (fuera) { alert(fuera); var fe = document.getElementById('entNotaFecha'); if (fe) fe.focus(); return; }
    var prov = String(nota.proveedor || '').trim(), folio = String(nota.folio || '').trim();
    var regs = items.map(function (it) {
        return { insumoId: it.insumoId, cantidad: parseFloat(it.cant), tipo: nota.tipo || 'compra', fecha: fecha,
                 fotos: nota.fotos || [], notaId: nota.id, notaFolio: folio, notaProveedor: prov };
    });
    if (!_entGuardarNuevas(regs)) return;
    _entNotaCerrar();
    _entAviso('Nota registrada: ' + regs.length + ' producto' + (regs.length !== 1 ? 's' : '') + (prov ? ' · ' + prov : ''));
    renderListadoEntradas();
}
/* Lo que se acaba de guardar, dicho en un aviso que se va solo: la tarjeta
   se cierra y sin esto no quedaba claro si entró. */
function _entAviso(txt) {
    var el = document.getElementById('entAviso');
    if (!el) {
        el = document.createElement('div'); el.id = 'entAviso'; el.className = 'ent-aviso';
        el.setAttribute('role', 'status'); document.body.appendChild(el);
    }
    el.innerHTML = _icInv('adm-pagado', 16) + '<span>' + etx(txt) + '</span>';
    el.classList.add('on');
    clearTimeout(_entAviso._t);
    _entAviso._t = setTimeout(function () { el.classList.remove('on'); }, 2600);
}
window.abrirNotaEntrada = abrirNotaEntrada; window.registrarNotaEntrada = registrarNotaEntrada;


/* ── TIPOS DE ENTRADA · una sola verdad ───────────────────────────────────
   Todos ENTRAN al stock (llegó mercancía), pero solo la COMPRA es dinero que
   salió: bonificación, consignación y préstamo pagado NO suman a "Compras del
   período" ni a "Vendido vs Compras". Antes la regla era un `else` implícito
   (cualquier tipo desconocido caía en compras) — por eso vive aquí y todos los
   contadores preguntan con entEsCompra(), nunca comparando strings a mano. */
// Va como FUNCIÓN (no solo `var`): las declaraciones se hoistean, así la regla
// está disponible aunque alguien la consulte antes de que corra este tramo.
function entTipos() {
    return [
        { id:'compra',          lbl:'Compra',          emoji:'🛒', ic:'fin-gastos',      color:'var(--accent)', suma:true  },
        { id:'bonificacion',    lbl:'Bonificación',    emoji:'🎁', ic:'nom-bono',        color:'var(--green)',  suma:false },
        { id:'consignacion',    lbl:'Consignación',    emoji:'📦', ic:'mod-inventarios', color:'#7c7cff',       suma:false },
        { id:'prestamo_pagado', lbl:'Préstamo pagado', emoji:'🔁', ic:'ev-devolver',     color:'#e0a45a',       suma:false }
    ];
}
var ENT_TIPOS = entTipos();   // atajo para pintar los botones/selects
function entTipoDef(tipo) {
    var t = String(tipo || 'compra').toLowerCase();
    var lista = entTipos();
    for (var i = 0; i < lista.length; i++) if (lista[i].id === t) return lista[i];
    return null;
}
// ¿Esta entrada suma a Compras? Solo la compra (y el legacy sin tipo, que era compra).
function entEsCompra(tipo) {
    var d = entTipoDef(tipo);
    return d ? !!d.suma : false;
}
function tipoEntradaLabel(tipo) {
    var d = entTipoDef(tipo);
    return d ? d.lbl : (tipo || '—');
}
function tipoEntradaColor(tipo) {
    var d = entTipoDef(tipo);
    return d ? d.color : 'var(--text-muted)';
}

function buscarInsumoEntrada(val) {
    _entRapidaBusqueda = val;
    renderChipsEntrada();
}

function renderChipsEntrada() {
    const cont = document.getElementById('entChips');
    if (!cont) return;
    /* En el Paso 2 en dos columnas: la LISTA COMPLETA de insumos desde el
       principio, reducida por el buscador; mientras se registra uno, el
       espacio es del formulario. */
    if (cont.closest('.p12-split-ent')) {
        if (_entRapidaInsumoId) { cont.innerHTML = ''; return; }
        _entNotaSync();
        const q2 = String(_entRapidaBusqueda || '').trim().toLowerCase();
        /* En el Paso 2, lo del periodo; afuera, lo que ya entró hoy. Se busca
           en la ficha completa (también envase y marca). */
        const hoyM = invActual ? null : _entHoyMapa();
        const lista = _entFuente().filter(f => !q2 || String(f.nombre || '').toLowerCase().indexOf(q2) > -1 || String(insumoEtiqueta(f) || '').toLowerCase().indexOf(q2) > -1);
        // Lista o cuadrícula, con el mismo botón (y la misma preferencia) que el Paso 1.
        cont.className = 'p12-lista' + (modoListaCapt === 'galeria' ? ' p12-iconos' : '');
        cont.innerHTML = lista.length ? lista.map(f => {
            const ya = invActual ? getEntradasBottles(f.insumoId) : (hoyM[f.insumoId] || 0);
            const enNota = _entNotaCantDe(f.insumoId);
            const meta = insumoMeta(f) ? insumoMetaHTML(f) : (f.categoria ? etx(f.categoria) : '');
            const der = enNota > 0 ? `<b class="p12-ok p12-en-nota">${_icInv('nom-recibo', 13)}+${fmtBot(Math.round(enNota * 100) / 100)} ${_unidadCompra(f)}</b>`
                : ya > 0 ? `<b class="p12-ok">+${fmtBot(Math.round(ya * 100) / 100)} ${_unidadCompra(f)}${invActual ? '' : ' hoy'}</b>`
                : `<span class="p12-ant">${_entNota ? '+ a la nota' : '+ registrar'}</span>`;
            return `<button class="p12-item ${ya > 0 || enNota > 0 ? 'reg' : ''}" onclick="seleccionarProductoEntrada('${f.insumoId}')">
                <span class="p12-nom">${etx(insumoTitulo(f))}${meta ? `<small>${meta}</small>` : ''}</span>
                ${der}</button>`;
        }).join('') : (q2 ? `<div class="p12-vacio">Sin insumos con «${etx(_entRapidaBusqueda)}»</div>`
            : `<div class="p12-vacio">${(!invActual && !_INV_CARGADO) ? '⏳ Cargando el catálogo…' : 'No hay insumos en esta sucursal'}</div>`);
        return;
    }
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
    /* Solo se cierra el QR de la entrada suelta: si el abierto es el de la
       nota, sigue esperando la foto del ticket mientras se suman productos. */
    if (_entRapidaInsumoId !== insumoId) { _entRapidaFotos = []; _entRapidaUm = 'pza'; if (_entRapidaQr) { _entRapidaQr = false; _qrEvidCerrar(); } }
    _entRapidaInsumoId = insumoId;
    renderChipsEntrada();
    renderFormEntrada();
}

var _entRapidaFotos = [], _entRapidaQr = false, _entRapidaSubiendo = false;
function _entRapidaToggleQr() {
    if (_entRapidaQr) { _entRapidaQr = false; _qrEvidCerrar(); renderFormEntrada(); return; }
    _entRapidaQr = true; renderFormEntrada();
    _qrEvidAbrir('entRapidaQrSlot', function (foto) {
        if (!foto || !foto.url) return;
        _entRapidaFotos.push(foto.url); _entRapidaPintarFotos();
    });
}
window._entRapidaToggleQr = _entRapidaToggleQr;
async function _entRapidaSubirFotos(input) {
    if (!input.files || !input.files.length) return;
    var files = Array.prototype.slice.call(input.files);
    input.value = '';
    _entRapidaSubiendo = true; _entRapidaPintarFotos();
    for (var i = 0; i < files.length; i++) {
        try { var url = await _entEdSubirUna(files[i]); if (url) _entRapidaFotos.push(url); } catch (e) { console.warn('[foto entrada]', e); }
    }
    _entRapidaSubiendo = false; _entRapidaPintarFotos();
}
window._entRapidaSubirFotos = _entRapidaSubirFotos;
function _entRapidaPintarFotos() {
    var el = document.getElementById('entRapidaFotos'); if (!el) return;
    el.innerHTML = _entRapidaFotos.map(function (u, i) {
        return '<span class="ent-ed-foto"><img ' + sbAttr(u) + ' onclick="etaaxVerFoto(this.src)">' +
            '<button title="Quitar foto" onclick="_entRapidaFotos.splice(' + i + ',1);_entRapidaPintarFotos()">✕</button></span>';
    }).join('') +
    '<label class="ent-ed-addfoto" title="Subir desde este equipo">' + (_entRapidaSubiendo ? '…' : _icInv('adm-subir-archivo', 20)) +
        '<input type="file" accept="image/*" multiple style="display:none" onchange="_entRapidaSubirFotos(this)"></label>';
}
function renderFormEntrada() {
    const cont = document.getElementById('entFormCard');
    if (!cont) return;
    /* Con una nota abierta, tocar un producto solo pide CUÁNTO: tipo, fecha y
       fotos son de la nota. Va ANTES de apartar el QR: si hay uno abierto es
       el de la nota, y vive en su tarjeta. */
    if (_entNotaSync()) {
        const fN = _entRapidaInsumoId ? _entFilaDe(_entRapidaInsumoId) : null;
        if (!fN) { cont.innerHTML = ''; return; }
        const yaN = _entNotaCantDe(_entRapidaInsumoId), uN = _unidadCompra({ insumoId: _entRapidaInsumoId });
        cont.innerHTML = `
        <div class="ent-form-card ent-nota-pide">
            <div class="ent-nota-cab">
                <div>
                    <div class="ent-nota-pide-tit">${etx(insumoTitulo(fN) || fN.nombre || '—')}</div>
                    ${insumoMeta(fN) ? `<div class="ent-nota-pide-meta">${insumoMetaHTML(fN)}</div>` : ''}
                    ${yaN > 0 ? `<div class="ent-nota-pide-ya">Ya va en la nota: +${fmtBot(Math.round(yaN * 100) / 100)} ${uN} · lo que escribas se suma</div>` : ''}
                </div>
                <button class="ent-nota-cerrar" title="Cancelar" onclick="limpiarSeleccionEntrada()">✕</button>
            </div>
            <div class="ent-nota-pide-fila">
                ${_entUmRapidaHTML()}
                <label><span>Cantidad (${etx(_entUmEtiqueta())})</span>
                    <input type="number" id="entRapidaCant" placeholder="0" min="0" step="any" inputmode="decimal"
                        onkeydown="if(event.key==='Enter')agregarEntradaRapida()"></label>
                <button class="ent-nota-sumar" onclick="agregarEntradaRapida()">+ Agregar a la nota</button>
            </div>
        </div>`;
        document.getElementById('entRapidaCant')?.focus();
        return;
    }
    const _qrB = _qrEvidApartar();
    if (!_entRapidaInsumoId) { cont.innerHTML = ''; if (_qrB) _qrEvidCerrar(); _entRapidaQr = false; return; }
    const fila = _entFilaDe(_entRapidaInsumoId);
    if (!fila) { cont.innerHTML = ''; return; }
    // En el Paso 2, lo del periodo; afuera (sin periodo), lo que ya entró hoy.
    const totalBot = invActual ? getEntradasBottles(_entRapidaInsumoId) : (_entHoyMapa()[_entRapidaInsumoId] || 0);
    cont.innerHTML = `
        <div class="ent-form-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
                <div>
                    <div style="font-weight:700;font-size:17px;color:var(--text)">${etx(insumoTitulo(fila))}</div>
                    ${insumoMeta(fila) ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${insumoMetaHTML(fila)}</div>` : ''}
                    ${totalBot > 0 ? `<div style="font-size:12px;color:var(--green);margin-top:5px;font-weight:600">${invActual ? 'Ya registrado este período' : 'Ya entró hoy'}: +${fmtBot(Math.round(totalBot * 100) / 100)} ${_unidadCompra({ insumoId: _entRapidaInsumoId })}</div>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${_entRapidaInsumoId}')">${_icInv('rec-ficha', 14)}Ver</button>
                    <button onclick="limpiarSeleccionEntrada()"
                        style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:20px;padding:0;line-height:1">✕</button>
                </div>
            </div>
            <div class="ent-tipo-row">
                ${ENT_TIPOS.map(t => `<button class="ent-tipo-btn ${_entRapidaTipo === t.id ? 'active' : ''}" onclick="setTipoEntrada('${t.id}')">${_icInv(t.ic)}${t.lbl}</button>`).join('')}
            </div>
            <div style="display:flex;gap:12px;align-items:flex-end;margin-top:16px;flex-wrap:wrap">
                <div>
                    ${_entUmRapidaHTML()}
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Cantidad (${etx(_entUmEtiqueta())})</div>
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
                    <input type="date" id="entRapidaFecha" value="${_entFechaDefault()}"
                        min="${_periodoInvActual().desde || ''}" max="${_periodoInvActual().hasta || ''}"
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
            <div class="ent-evid">
                <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Evidencia (opcional): foto del ticket o del producto</div>
                <div class="ent-ed-fotos" id="entRapidaFotos"></div>
                <div style="margin-top:8px">${_qrEvidBoton(_entRapidaQr, '_entRapidaToggleQr()')}</div>
                <div id="entRapidaQrSlot"></div>
            </div>
        </div>`;
    _entRapidaPintarFotos();
    _qrEvidReponer(_qrB, 'entRapidaQrSlot');
    document.getElementById('entRapidaCant')?.focus();
}

/* «Recibe en»: piezas o la caja/rejilla de compra (×24). Lo tecleado en cajas
   se pasa a piezas al registrar; el inventario solo guarda piezas. */
function _entEmpRapida() { return _entRapidaInsumoId ? _empaqueDeFila({ insumoId: _entRapidaInsumoId }) : null; }
function _entUmRapidaHTML() {
    var e = _entEmpRapida(); if (!e) return '';
    var b = function (m, txt, on) {
        return '<button type="button" class="ent-um-btn' + (on ? ' on' : '') + '" onclick="setUmEntradaRapida(\'' + m + '\')">' + txt + '</button>';
    };
    return '<div class="ent-um"><span>Recibe en</span>' + b('pza', etx(e.um || 'Piezas'), _entRapidaUm !== 'pres') +
        b('pres', etx(e.label) + ' <small>×' + e.factor + '</small>', _entRapidaUm === 'pres') + '</div>';
}
function setUmEntradaRapida(m) {
    var v = (document.getElementById('entRapidaCant') || {}).value;
    _entRapidaUm = m === 'pres' ? 'pres' : 'pza';
    renderFormEntrada();
    var i = document.getElementById('entRapidaCant'); if (i && v) i.value = v;
}
window.setUmEntradaRapida = setUmEntradaRapida;
function _entUmEtiqueta() {
    var e = _entEmpRapida();
    if (e && _entRapidaUm === 'pres') return String(e.label).toLowerCase();
    return _unidadCompra({ insumoId: _entRapidaInsumoId });
}
function _entCantAPiezas(cant) {
    var e = _entEmpRapida();
    return (e && _entRapidaUm === 'pres') ? Math.round(cant * e.factor * 1000) / 1000 : cant;
}
function setTipoEntrada(tipo) {
    _entRapidaTipo = tipo;
    renderFormEntrada();
}

function limpiarSeleccionEntrada() {
    _entRapidaInsumoId = null;
    _entRapidaFotos = []; if (_entRapidaQr) { _entRapidaQr = false; _qrEvidCerrar(); }
    /* En dos columnas se regresa a la lista CON el filtro que había: se sigue
       registrando entre lo que se buscó. */
    if (!document.querySelector('.p12-split-ent')) {
        _entRapidaBusqueda = '';
        const inp = document.getElementById('entBuscador');
        if (inp) { inp.value = ''; inp.focus(); }
    }
    renderChipsEntrada();
    renderFormEntrada();
}

function agregarEntradaRapida() {
    if (!_entRapidaInsumoId) return;
    const cant = _entCantAPiezas(parseFloat(document.getElementById('entRapidaCant')?.value) || 0);   // cajas → piezas
    if (cant <= 0) { document.getElementById('entRapidaCant')?.focus(); return; }
    // Con una nota abierta, la cantidad se SUMA a la nota; se registra al final.
    if (_entNotaSync()) { _entNotaSumar(_entRapidaInsumoId, cant); return; }
    const fecha = document.getElementById('entRapidaFecha')?.value || _entFechaDefault();
    /* Fuera del periodo NO se guarda: es el disparador del bucle. Ver
       _fechaFueraDePeriodo — la entrada se sale sola en el siguiente render, eso
       muta y guarda el inventario, el guardado dispara realtime, realtime
       repinta, y vuelve a empezar. (Afuera, sin inventario, no hay periodo.) */
    const _fueraR = _fechaFueraDePeriodo(fecha);
    if (_fueraR) { alert(_fueraR); document.getElementById('entRapidaFecha')?.focus(); return; }
    const id = _entRapidaInsumoId, fila = _entFilaDe(id);
    if (!_entGuardarNuevas([{ insumoId: id, cantidad: cant, tipo: _entRapidaTipo, fecha: fecha, fotos: _entRapidaFotos }])) return;
    /* LA TARJETA SE CIERRA SOLA (Edwin, 23-nov): ya registrada, cerrarla a
       mano en cada insumo era un clic de más. Regresa a la lista con lo que se
       había buscado, y un aviso dice qué entró. La evidencia era de ESTA
       entrada: la siguiente arranca sin fotos (limpiarSeleccionEntrada). */
    _entAviso('Registrada: +' + fmtBot(cant) + ' ' + _unidadCompra({ insumoId: id }) + (fila ? ' · ' + (insumoTitulo(fila) || fila.nombre) : ''));
    limpiarSeleccionEntrada();
    renderListadoEntradas();
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

/* ══ BUSCAR DENTRO DEL HISTORIAL ═══════════════════════════════════════════
   Con 188 entradas, 9 mermas y 9 cortesías revueltas en una sola lista, los
   únicos filtros eran de tiempo: para contestar «¿cuándo entró el Cinzano?» o
   «¿qué se dio de cortesía este mes?» había que bajar leyendo renglón por
   renglón.

   Dos cosas distintas, a propósito:
     · El TIPO (entradas / mermas / cortesías) es un cambio de lista: cada una
       responde una pregunta distinta y mezclarlas es lo que estorba.
     · El TEXTO busca dentro de lo que quede, en todo lo que se ve del renglón
       —producto, quién lo registró, motivo, nota— porque uno se acuerda de
       cualquiera de esos, no del campo en que lo guardó el sistema. */
var _entTipo = 'todos', _entBusca = '';
/* OJO: estos dos repintan SOLO la lista, no la vista entera. Volver a armar la
   pantalla en cada tecla se lleva el foco del buscador a media palabra. */
function setEntTipo(t) { _entTipo = t; renderListadoEntradas(); }
function setEntBusca(v) { _entBusca = String(v || ''); renderListadoEntradas(); }
/* Las pestañas van en su propio contenedor, SEPARADO del input: así se
   repintan con cada tecla sin tocar el campo donde se está escribiendo. */
function _entPintaChips(cta) {
    var el = document.getElementById('entTipoChips');
    if (!el) return;
    var total = cta.entrada + cta.merma + cta.salida;
    /* El fondo encendido va explícito y no calculado: color-mix no existe en
       navegadores viejos y la pestaña activa se quedaría sin señal de estar
       activa, que es lo único que ese fondo hace. */
    var chip = function (t, ic, lbl, n, col, bg) {
        var on = _entTipo === t;
        return '<button onclick="setEntTipo(\'' + t + '\')" ' +
            'style="border:1px solid ' + (on ? col : 'var(--border)') + ';' +
            'background:' + (on ? bg : 'transparent') + ';' +
            'color:' + (on ? col : 'var(--text-muted)') + ';border-radius:20px;padding:5px 13px;' +
            'font-family:inherit;font-size:12px;cursor:pointer;font-weight:' + (on ? '700' : '500') + '">' +
            _icInv(ic, 15) + lbl + ' <span style="opacity:.75">' + n + '</span></button>';
    };
    el.innerHTML =
        chip('todos',   'ins-lista',       'Todo',      total,       'var(--accent)', 'rgba(245,200,66,.14)') +
        chip('entrada', 'mod-inventarios', 'Entradas',  cta.entrada, 'var(--green)',  'rgba(61,190,122,.14)') +
        chip('merma',   'rec-alerta',      'Mermas',    cta.merma,   'var(--red)',    'rgba(224,90,58,.14)') +
        chip('salida',  'nom-bono',        'Cortesías', cta.salida,  '#9b7fe0',       'rgba(124,95,211,.16)');
}

function _entTipoDe(e) {
    return (e && e.concepto === 'merma') ? 'merma'
         : (e && e.concepto === 'salida') ? 'salida' : 'entrada';
}
/* Todo lo que se ve del renglón, en un solo texto. Buscar solo por nombre
   dejaría fuera «se rompió» o «Diego», que es justo como se busca de memoria. */
function _entTextoBusca(e) {
    if (!e) return '';
    var MOT = { se_rompio:'se rompió', se_derramo:'se derramó', mal_preparado:'mal preparado',
                caducado:'caducado', otro:'otro' };
    return [e.nombreProducto, e.nombre, e.notas, MOT[e.motivo] || e.motivo, e.registradoPor,
            e.area, e.fecha, e.salidaTipo === 'prestamo' ? 'préstamo' : (e.concepto === 'salida' ? 'cortesía' : ''),
            e.concepto === 'merma' ? 'merma' : '',
            e.notaProveedor, e.notaFolio, e.notaId ? 'nota factura' : '',
            (e.insumoId && typeof _entMetaHTML === 'function') ? _entTituloTxt(e) + ' ' + String(_entMetaHTML(e)).replace(/<[^>]*>/g, '') : '',
            (typeof tipoEntradaLabel === 'function' && e.tipo) ? tipoEntradaLabel(e.tipo) : '']
        .join(' ').toLowerCase();
}
/* Qué decir cuando no queda nada. «Sin registros de esta sucursal» con un
   buscador escrito es engañoso: hace pensar que no hay datos cuando lo que pasa
   es que el filtro no deja pasar ninguno, y lo que se necesita es el botón para
   quitarlo. */
function _entVacioHTML() {
    var q = _entBusca.trim();
    var filtrando = q || _entTipo !== 'todos';
    if (!filtrando)
        return '<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:24px 0">Sin registros de esta sucursal</div>';
    var LBL = { entrada:'entradas', merma:'mermas', salida:'cortesías o préstamos' };
    var qué = _entTipo === 'todos' ? 'registros' : LBL[_entTipo];
    return '<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:30px 0;line-height:1.7">' +
        'No hay ' + qué + (q ? ' que digan «<b style="color:var(--text)">' + etx(q) + '</b>»' : '') +
        ' en este periodo.' +
        '<div style="margin-top:12px"><button onclick="_entLimpiarFiltros()" ' +
        'style="background:transparent;border:1px solid var(--border);color:var(--text-muted);border-radius:20px;' +
        'padding:6px 14px;font-family:inherit;font-size:12px;cursor:pointer">↺ Quitar el filtro</button></div></div>';
}
function _entLimpiarFiltros() { _entBusca = ''; _entTipo = 'todos'; _entRepintar(); }
/* Repinta la vista que esté en pantalla. El Paso 2 y el historial de afuera son
   dos armados distintos de la misma lista; llamar al equivocado deja el filtro
   aplicado y la pantalla sin cambiar. */
function _entRepintar() {
    try {
        var ve = document.getElementById('vistaEntradas');
        if (ve && ve.style.display !== 'none') { renderVistaEntradas(); return; }
    } catch (e) {}
    if (typeof renderStepContent === 'function') renderStepContent();
    else renderVistaEntradas();
}

/* EL BUSCADOR Y LAS PESTAÑAS, en un solo lugar: el historial de afuera y el
   Paso 2 del inventario enseñan la misma lista y tienen que filtrarla igual.
   Copiarlo en los dos armados es cómo se separan. */
function _filtroTipoHTML(enBarra) {
    /* En la barra fija del Paso 2 va el MISMO filtro (mismo texto buscado,
       mismo manejador, mismas pestañas), solo que compacto. */
    if (enBarra) return _herrBuscar('entBuscar', _entBusca, 'Buscar en lo registrado: producto, quién, motivo…', 'setEntBusca') +
        '<div id="entTipoChips" class="ph-chips"></div>';
    return '' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
            '<div style="position:relative;flex:1;min-width:200px;max-width:380px">' +
                '<input id="entBuscar" type="search" value="' + etx(_entBusca) + '" ' +
                    'oninput="setEntBusca(this.value)" autocomplete="off" ' +
                    'placeholder="🔍 Buscar por producto, quién lo registró, motivo o nota…" ' +
                    'style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);' +
                           'border-radius:20px;padding:7px 13px;font-family:inherit;font-size:12.5px;outline:none">' +
            '</div>' +
            '<div id="entTipoChips" style="display:flex;gap:6px;flex-wrap:wrap"></div>' +
        '</div>';
}

/* LA CADENA DE FILTRADO, en un solo lugar. Primero el texto, después el tipo,
   y los contadores de las pestañas SOBRE LO BUSCADO —no sobre el total y no
   sobre lo ya filtrado por pestaña—:

     · sobre el total: al teclear «cinzano» las pestañas seguirían diciendo
       «188 entradas» y no servirían de nada;
     · sobre lo filtrado por pestaña: al entrar a Mermas las demás se irían a
       cero y no habría cómo saber que hay algo más — la pestaña se volvería
       una trampa de un solo sentido.

   Va aparte del render para poder probarla con datos en la mano: cuando vivía
   dentro, el candado comprobaba los filtros por su cuenta y no notaba que la
   pantalla dejara de usarlos. */
function _entFiltrar(lista) {
    var buscadas = (lista || []).filter(_entPasaBusca);
    var cta = { entrada:0, merma:0, salida:0 };
    buscadas.forEach(function (e) { cta[_entTipoDe(e)]++; });
    var visibles = (_entTipo === 'todos') ? buscadas
        : buscadas.filter(function (e) { return _entTipoDe(e) === _entTipo; });
    return { visibles: visibles, cta: cta };
}

function _entPasaBusca(e) {
    var q = _entBusca.trim().toLowerCase();
    if (!q) return true;
    /* Varias palabras = todas tienen que estar, en cualquier orden: «cinzano
       diego» encuentra lo que registró Diego de Cinzano sin importar el orden
       en que se escriba. */
    var txt = _entTextoBusca(e);
    return q.split(/\s+/).every(function (p) { return txt.indexOf(p) >= 0; });
}
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
        return '<img ' + sbAttr(u) + ' onclick="event.stopPropagation();etaaxVerFoto(this.src)" title="Ver evidencia" style="width:28px;height:28px;object-fit:cover;border-radius:5px;border:1px solid var(--border);cursor:zoom-in;flex-shrink:0">';
    }).join('');
    var more = arr.length > 3 ? '<span style="font-size:10px;color:var(--text-dim);align-self:center">+' + (arr.length - 3) + '</span>' : '';
    return '<span style="display:inline-flex;gap:3px;align-items:center">' + thumbs + more + '</span>';
}

// Badge "📱 QR" (con quién lo registró) para registros hechos desde el QR de sucursal.
function _qrOrigenHTML(e) {
    if (!e || e.origen !== 'qr') return '';
    var quien = e.registradoPor ? (' · ' + etx(e.registradoPor)) : '';
    return '<span style="font-size:9px;letter-spacing:.3px;background:rgba(122,184,245,.14);color:#7ab8f5;border:1px solid rgba(122,184,245,.35);border-radius:8px;padding:1px 6px;white-space:nowrap;margin-left:5px" title="Registrado desde el QR' + (e.registradoPor ? ' por ' + etx(e.registradoPor) : '') + '">📱 QR' + quien + '</span>';
}
// Celda de nombre: nombre + extra inline (merma/producto/motivo) + badge QR, y debajo el
// COMENTARIO que se capturó al subir el registro (si trae notas).
/* Una entrada guarda solo el `insumoId`: el nombre se arma al pintarla. Si ese id
   ya no resuelve, la fila salía con un nombre a medias —o con el que se guardó
   alguna vez— y parecía una entrada sana. Así se cargaron entradas al insumo
   equivocado. Ahora se dice, y se ofrece arreglarlo ahí mismo. */
function _entAvisoInsumo(e) {
    if (!e || !e.insumoId) return '';
    if (_insumoDeEntrada(_canonInsumoId(e.insumoId))) return '';
    return '<span style="font-size:10.5px;color:#ff9a9a;display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '⚠️ Este producto ya no está en el catálogo' +
        (e.id ? '<button onclick="abrirEditorEntrada(\'' + e.id + '\')" ' +
            'style="background:transparent;border:1px solid #ff9a9a;color:#ff9a9a;border-radius:6px;' +
            'padding:1px 8px;font-size:10px;cursor:pointer;font-family:inherit">Elegir el correcto</button>' : '') +
    '</span>';
}
/* LA FICHA COMPLETA del insumo en cada renglón (Edwin, 23-nov): el log
   global guarda solo `nombre` («Jumex»), y tres Jumex distintos se veían
   iguales. El insumo se resuelve por su id al pintar —nombre y variedad, y
   abajo envase, contenido y marca, como en la lista de la izquierda—; lo
   guardado queda de respaldo para el que ya no está en el catálogo. */
function _entInsDe(e) { return (e && e.insumoId) ? _insumoDeEntrada(_canonInsumoId(e.insumoId)) : null; }
function _entTituloTxt(e) {
    var ins = _entInsDe(e);
    return ins ? (insumoTitulo(ins) || ins.nombre || '—') : ((e && (e.nombreProducto || e.nombre)) || '—');
}
function _entMetaHTML(e) { var ins = _entInsDe(e); return (ins && insumoMeta(ins)) ? insumoMetaHTML(ins) : ''; }
function _entNotaBadgeHTML(e) {
    if (!e || !e.notaId) return '';
    var t = [e.notaProveedor, e.notaFolio ? 'folio ' + e.notaFolio : ''].filter(Boolean).join(' · ');
    return '<span class="ent-nota-badge" title="Registrada en una nota / factura">' + _icInv('nom-recibo', 12) + 'Nota' + (t ? ' · ' + etx(t) : '') + '</span>';
}
function _entNombreCell(e, nombre, extraInline) {
    var meta = _entMetaHTML(e);
    return '<span class="ent-log-nombre" style="display:flex;flex-direction:column;gap:2px">' +
        '<span><span class="eln-n">' + nombre + '</span>' + (extraInline || '') + _qrOrigenHTML(e) + _entNotaBadgeHTML(e) + '</span>' +
        (meta ? '<span class="eln-n eln-meta">' + meta + '</span>' : '') +
        _entAvisoInsumo(e) +
        (e && e.notas ? '<span style="font-size:10.5px;color:var(--text-dim);font-style:italic">📝 ' + etx(e.notas) + '</span>' : '') +
    '</span>';
}

function renderListadoEntradas() {
    const cont = document.getElementById('entLogList');
    if (!cont) return;
    // Use inventory-specific log when active, global log otherwise
    let log, useGlobal;
    if (invActual) {
        /* El Paso 2 enseñaba SOLO entradas; las mermas y cortesías del QR vivían
           aparte, en el panel rojo de arriba. Eran los mismos movimientos del
           mismo periodo partidos en dos lugares, y para revisarlos había que
           mirar en los dos. Ahora van en la misma lista —con sus comentarios y
           su foto, como afuera— y las pestañas sirven para separarlos cuando se
           quiere.

           Las de merma/cortesía se leen del log global, no del inventario: ahí
           es donde viven (el inventario solo guarda las entradas) y así no se
           duplican ni se quedan viejas. */
        var _movs = [];
        try { _movs = _movsQRDelPeriodo(); } catch (e) { _movs = []; }
        log = (invActual.entradasLog || []).concat(_movs);
        useGlobal = false;
    } else {
        log = [...getEntradasLog()].filter(function(e){ return e && !e.borrada && _entEnPeriodo(e.fecha); }).reverse();
        useGlobal = true;
    }
    const countEl = document.getElementById('entLogCount');
    if (countEl) countEl.textContent = log.length + ' registro' + (log.length !== 1 ? 's' : '');
    if (!log.length) {
        /* Las pestañas se pintan igual, en cero: dejar su renglón en blanco se
           ve como si la pantalla se hubiera roto a medio cargar. */
        _entPintaChips({ entrada:0, merma:0, salida:0 });
        /* «Sin entradas registradas» mientras la nube todavía no contesta es una
           AFIRMACIÓN falsa: lo cierto es que aún no se sabe. Y es justo el
           momento en que alguien concluye que se le perdieron los datos. */
        cont.innerHTML = (!invActual && !_INV_CARGADO)
            ? `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:28px 0">
                 ⏳ Cargando el historial…</div>`
            : `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:24px 0">
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
    const deLaSuc = rows.filter(function(e){
        if (!e) return false;                        // excluir null/undefined (reventaba el render)
        if (!useGlobal) return true;                 // dentro del inventario → ya acotadas
        if (!_sucHist) return true;                  // matriz / sin sucursal → historial global real
        return (e.sucursalId || '') === _sucHist;    // sucursal específica → SOLO sus entradas
    });
    const _f = _entFiltrar(deLaSuc);
    _entPintaChips(_f.cta);
    const visibles = _f.visibles;
    var _sucNomH = '';
    try {
        var _ssH = JSON.parse(localStorage.getItem('etaax_' + getNegocioActivo() + '_sucursales') || '[]');
        var _fH = _ssH.find(function(x){ return x.id === _sucHist; });
        _sucNomH = _fH ? (_fH.nombre || '') : '';
    } catch(err) {}
    const rowHTML = (e) => {
        const color   = tipoEntradaColor(e.tipo);
        const nombre  = etx(_entTituloTxt(e));
        const cant    = (e.cantidad||0) % 1 ? (e.cantidad||0).toFixed(1) : (e.cantidad||0);
        // MERMA del QR: se muestra distinta (badge rojo, cantidad negativa, área);
        // NO entra al stock del inventario — es log/auditoría del turno.
const fotoTh = _fotosThumbHTML(e);
        if (e.concepto === 'merma') {
            const areaTx = e.area ? ' · ' + etx(e.area) : '';
            const motivo = { se_rompio:'se rompió', se_derramo:'se derramó', mal_preparado:'mal preparado', caducado:'caducado', otro:'otro' }[e.motivo] || '';
            return `<div class="ent-log-fila">
                ${_entNombreCell(e, nombre, (e.mermaTipo === 'producto' ? ' <span style="font-size:9px;color:var(--text-dim)">🍹 producto</span>' : '') + (motivo ? ' <span style="font-size:10px;color:var(--text-dim)">· ' + motivo + '</span>' : ''))}
                <span class="ent-log-badge" style="color:var(--red);background:rgba(224,90,58,.12);border-color:rgba(224,90,58,.4)">Merma${areaTx}</span>
                <span class="ent-log-fecha">${e.fecha || '—'}${_horaCapHTML(e)}</span>
                <span class="ent-log-cant" style="color:var(--red)">−${cant} ${etx(e.unidad || 'pza')}</span>
                ${fotoTh}
                <button class="ent-log-del" title="Eliminar" onclick="eliminarEntradaPorId('${e.id}')">${_icInv('mov-eliminar')}</button>
            </div>`;
        }
        if (e.concepto === 'salida') {
            const areaTx = e.area ? ' · ' + etx(e.area) : '';
            const esPrest = e.salidaTipo === 'prestamo';
            const lbl = esPrest ? '🔁 Préstamo' : '🎁 Cortesía';
            return `<div class="ent-log-fila">
                ${_entNombreCell(e, nombre, '')}
                <span class="ent-log-badge" style="color:#9b7fe0;background:rgba(124,95,211,.12);border-color:rgba(124,95,211,.4)">${lbl}${areaTx}</span>
                <span class="ent-log-fecha">${e.fecha || '—'}${_horaCapHTML(e)}</span>
                <span class="ent-log-cant" style="color:#9b7fe0">−${cant} ${etx(e.unidad || 'pza')}</span>
                ${fotoTh}
                <button class="ent-log-del" title="Eliminar" onclick="eliminarEntradaPorId('${e.id}')">${_icInv('mov-eliminar')}</button>
            </div>`;
        }
        return `<div class="ent-log-fila">
            ${_entNombreCell(e, nombre, '')}
            <span class="ent-log-badge" style="color:${color};background:${color}1a;border-color:${color}50">${tipoEntradaLabel(e.tipo)}</span>
            <span class="ent-log-fecha">${e.fecha || '—'}${_horaCapHTML(e)}</span>
            <span class="ent-log-cant">+${cant} ${_unidadCompra(e)}</span>
            ${fotoTh}
            <button class="ent-log-del" title="${e.notaId ? 'Cambiar de nota o sacarla de la nota' : 'Agregar a una nota / factura'}" onclick="abrirNotaDeEntrada('${e.id}')">${_icInv('nom-recibo')}</button>
            <button class="ent-log-del" title="Editar registro completo" onclick="abrirEditorEntrada('${e.id}')">${_icInv('rec-editar')}</button>
            <button class="ent-log-del" title="Eliminar" onclick="eliminarEntradaPorId('${e.id}')"
                onmouseenter="this.classList.add('hover')" onmouseleave="this.classList.remove('hover')">${_icInv('mov-eliminar')}</button>
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
        /* Dentro de un inventario: UN renglón por insumo que junta sus
           movimientos («Campo Azul · 3 entradas»), con su total y la
           existencia que se contó en el Paso 1; al abrirlo, cada movimiento
           con su cantidad, tipo, fecha y ✏️. En el historial de afuera, la
           lista corrida de siempre. */
        /* El registro de afuera es el mismo Paso 2 (23-nov): también agrupado
           por insumo. Arriba, las notas / facturas como documento. */
        const _bloque = (arr, tipo) => _entGruposHTML(arr, tipo, _safeRow);
        /* Marcando para agrupar en una nota: las entradas en una lista corrida
           (la más reciente arriba), cada una con su casilla; mermas y cortesías
           no van en una nota de compra. */
        if (_entSelVigente()) {
            cont.innerHTML = secHdr(_icInv('nom-recibo', 14) + 'Marca las entradas de la misma nota o factura') +
                (entradasArr.length ? entradasArr.map(e => _entSelFilaHTML(e, _safeRow)).join('') : _entVacioHTML());
            _entSelPintarBarra();
            return;
        }
        _entSelPintarBarra();
        const notasHTML = _entNotasHTML(entradasArr, _safeRow);
        cont.innerHTML =
            (notasHTML ? secHdr(_icInv('nom-recibo', 14) + 'Notas / facturas') + notasHTML : '') +
            (entradasArr.length ? secHdr(_icInv('mod-inventarios', 14) + 'Entradas' + (_sucNomH ? ' · ' + etx(_sucNomH) : '')) + _bloque(entradasArr, 'entrada') : '') +
            (mermasArr.length   ? secHdr(_icInv('rec-alerta', 14) + 'Mermas'   + (_sucNomH ? ' · ' + etx(_sucNomH) : '')) + _bloque(mermasArr, 'merma') : '') +
            (salidasArr.length  ? secHdr(_icInv('nom-bono', 14) + 'Cortesías / Préstamos' + (_sucNomH ? ' · ' + etx(_sucNomH) : '')) + _bloque(salidasArr, 'salida') : '') +
            (!visibles.length ? _entVacioHTML() : '');
    } catch (err) {
        console.warn('[registro entradas] render por secciones falló, fallback plano:', err);
        if (countEl) countEl.textContent = visibles.length + ' registro' + (visibles.length !== 1 ? 's' : '');
        cont.innerHTML = visibles.length
            ? visibles.map(_safeRow).join('')
            : _entVacioHTML();
    }
}

/* Los movimientos de un insumo, juntos en un renglón que se abre. */
var _entGruposAbiertos = {};
function _entGrupoToggle(el) { if (el && el.dataset) _entGruposAbiertos[el.dataset.k] = !!el.open; }
window._entGrupoToggle = _entGrupoToggle;
function _entGruposHTML(arr, tipo, fila) {
    const grupos = {}, orden = [];
    arr.forEach(function (e) {
        const k = e.insumoId ? 'i:' + (_canonInsumoId(e.insumoId) || e.insumoId) : 'n:' + String(e.nombreProducto || e.nombre || '').toLowerCase();
        if (!grupos[k]) { grupos[k] = []; orden.push(k); }
        grupos[k].push(e);
    });
    const lbl = { entrada: ['entrada', 'entradas'], merma: ['merma', 'mermas'], salida: ['salida', 'salidas'] }[tipo];
    return orden.map(function (k) {
        const es = grupos[k], e0 = es[0];
        const total = es.reduce(function (t, e) { return t + (parseFloat(e.cantidad) || 0); }, 0);
        const unidad = tipo === 'entrada' ? _unidadCompra(e0) : etx(e0.unidad || 'pza');
        const f = e0.insumoId ? (filasCaptura.find(function (x) { return x.insumoId === e0.insumoId; }) || _filaDeMiembro(e0.insumoId)) : null;
        const u = f ? (f.tipo === 'peso' ? (f.baseUnit || 'g').toLowerCase() : (f.tipo === 'pza' ? 'pza' : 'bot')) : '';
        const exist = !f ? '' : (_esRegistrado(f) ? fmtBot(calcExistenciaBot(f)) + ' ' + u : 'sin contar');
        const tot = (tipo === 'entrada' ? '+' : '−') + fmtBot(Math.round(total * 100) / 100) + ' ' + unidad;
        const key = tipo + '|' + k;
        return '<details class="eg" data-k="' + etx(key) + '"' + (_entGruposAbiertos[key] ? ' open' : '') + ' ontoggle="_entGrupoToggle(this)">' +
            '<summary><span class="eg-nom">' + etx(_entTituloTxt(e0)) + (_entMetaHTML(e0) ? '<small>' + _entMetaHTML(e0) + '</small>' : '') + '</span>' +
            '<span class="eg-n">' + es.length + ' ' + lbl[es.length === 1 ? 0 : 1] + '</span>' +
            (f ? '<span class="eg-ex" title="Registrada en el Paso 1">Existencia actual <b>' + exist + '</b></span>' : '') +
            '<b class="eg-tot ' + tipo + '">' + tot + '</b></summary>' +
            '<div class="eg-cuerpo">' + es.map(fila).join('') +
            '<div class="eg-total"><span>Total</span><b class="' + tipo + '">' + tot + '</b></div></div></details>';
    }).join('');
}

/* Las notas / facturas como DOCUMENTO: cada una en un renglón que se abre con
   todos sus productos, como llegó la compra. Sus renglones siguen también en
   la lista por insumo de abajo —ahí se suman al total de cada uno—. */
function _entNotasHTML(arr, fila) {
    var grupos = {}, orden = [];
    (arr || []).forEach(function (e) {
        if (!e || !e.notaId) return;
        if (!grupos[e.notaId]) { grupos[e.notaId] = []; orden.push(e.notaId); }
        grupos[e.notaId].push(e);
    });
    return orden.map(function (k) {
        var es = grupos[k], e0 = es[0], key = 'nota|' + k;
        var tit = [e0.notaProveedor, e0.notaFolio ? 'Folio ' + e0.notaFolio : ''].filter(Boolean).join(' · ') || 'Nota sin proveedor';
        return '<details class="eg eg-nota" data-k="' + etx(key) + '"' + (_entGruposAbiertos[key] ? ' open' : '') + ' ontoggle="_entGrupoToggle(this)">' +
            '<summary><span class="eg-nom">' + _icInv('nom-recibo', 14) + etx(tit) +
                '<small>' + etx(e0.fecha || '—') + ' · ' + etx(tipoEntradaLabel(e0.tipo)) + '</small></span>' +
            _fotosThumbHTML({ foto_urls: _entFotosUnion(es) }) +
            '<b class="eg-tot entrada">' + es.length + ' producto' + (es.length !== 1 ? 's' : '') + '</b></summary>' +
            '<div class="eg-cuerpo">' + es.map(fila).join('') +
            '<div class="eg-nota-pie"><button type="button" class="ent-nota-desag" onclick="_entNotaDesagrupar(\'' + etx(k) + '\')">Desagrupar</button></div>' +
            '</div></details>';
    }).join('');
}

/* Las fotos de evidencia de varias entradas, juntas y sin repetir. */
function _entFotosUnion(es) {
    var vistas = {}, r = [];
    (es || []).forEach(function (e) {
        var arr = (e && e.foto_urls && e.foto_urls.length) ? e.foto_urls : ((e && e.foto_url) ? [e.foto_url] : []);
        arr.forEach(function (u) { if (u && !vistas[u]) { vistas[u] = 1; r.push(u); } });
    });
    return r;
}

/* ══ AGRUPAR EN NOTA LO YA REGISTRADO (Edwin, 23-nov) ══════════════════════
   Lo que se registró suelto —seis refrescos uno por uno, cada cual con su
   foto— se puede juntar después en una nota: «Agrupar en nota», se marcan las
   entradas, proveedor y folio, y listo. Cada entrada se queda igual (cantidad,
   fecha, sus fotos); solo se le pone la nota. La nota enseña juntas TODAS las
   fotos de sus entradas. Si alguna marcada ya era de una nota, las demás se
   suman a ESA nota (y la nota entera toma el proveedor y el folio nuevos). */
var _entSel = null;
function _entSelVigente() { return !!(_entSel && _entSel.ctx === _entNotaCtx()); }
function _entSelIds() { return _entSelVigente() ? Object.keys(_entSel.ids).filter(function (k) { return _entSel.ids[k]; }) : []; }
function _entBtnAgruparHTML() {
    var on = _entSelVigente();
    return '<button type="button" class="ent-agrupar-btn' + (on ? ' on' : '') + '" id="entAgruparBtn" onclick="_entSelModo()" ' +
        'title="Juntar en una nota o factura entradas que ya están registradas">' + _icInv('nom-recibo', 13) + (on ? 'Cancelar' : 'Agrupar en nota') + '</button>';
}
function _entSelModo() {
    if (!_entSelVigente() && !invActual && typeof _exigeInv === 'function' && !_exigeInv('entradas', 'No puedes registrar entradas de mercancía.')) return;
    _entSel = _entSelVigente() ? null : { ctx: _entNotaCtx(), ids: {}, proveedor: '', folio: '' };
    var b = document.getElementById('entAgruparBtn'); if (b) b.outerHTML = _entBtnAgruparHTML();
    renderListadoEntradas();
}
function _entSelFilaHTML(e, fila) {
    var on = !!(e && e.id && _entSel.ids[e.id]);
    return '<label class="ent-sel-fila' + (on ? ' on' : '') + '"><input type="checkbox"' + (on ? ' checked' : '') +
        ' onchange="_entSelMarcar(\'' + etx(e.id) + '\', this.checked, this)">' + fila(e) + '</label>';
}
function _entSelMarcar(id, on, el) {
    if (!_entSelVigente()) return;
    _entSel.ids[id] = !!on;
    var lab = el && el.closest && el.closest('.ent-sel-fila'); if (lab) lab.classList.toggle('on', !!on);
    // Si la marcada ya trae nota, sus datos se proponen (no se pisa lo escrito).
    var e = on ? _entBuscarPorId(id) : null;
    if (e && e.notaId) {
        if (!_entSel.proveedor && e.notaProveedor) _entSel.proveedor = e.notaProveedor;
        if (!_entSel.folio && e.notaFolio) _entSel.folio = e.notaFolio;
    }
    _entSelPintarBarra();
}
function _entSelPintarBarra() {
    var el = document.getElementById('entSelBar'); if (!el) return;
    if (!_entSelVigente()) { if (el.innerHTML) el.innerHTML = ''; return; }
    var es = _entSelIds().map(_entBuscarPorId).filter(Boolean), n = es.length, fotos = _entFotosUnion(es);
    el.innerHTML = '<div class="ent-sel-bar">' +
        '<div class="ent-sel-tit">' + _icInv('nom-recibo', 16) + '<b>Agrupar en una nota</b><span>' +
            (n ? n + ' entrada' + (n !== 1 ? 's' : '') + ' marcada' + (n !== 1 ? 's' : '') +
                 (fotos.length ? ' · se juntan ' + fotos.length + ' foto' + (fotos.length !== 1 ? 's' : '') + ' de evidencia' : '')
               : 'Marca abajo las entradas que llegaron en la misma nota o factura') + '</span></div>' +
        '<div class="ent-sel-datos">' +
            '<input id="entSelProv" type="text" autocomplete="off" placeholder="Proveedor" value="' + etx(_entSel.proveedor || '') + '" oninput="_entSel.proveedor=this.value">' +
            '<input id="entSelFolio" type="text" autocomplete="off" placeholder="Folio (opcional)" value="' + etx(_entSel.folio || '') + '" oninput="_entSel.folio=this.value">' +
            '<button type="button" class="ent-sel-ok" onclick="_entSelAgrupar()"' + (n ? '' : ' disabled') + '>Agrupar' + (n ? ' ' + n : '') + '</button>' +
        '</div>' +
        (fotos.length ? '<div class="ent-sel-fotos">' + _fotosThumbHTML({ foto_urls: fotos }) + '</div>' : '') +
    '</div>';
}
function _entSelAgrupar() {
    if (!invActual && typeof _exigeInv === 'function' && !_exigeInv('entradas', 'No puedes registrar entradas de mercancía.')) return;
    if (!_entSelVigente()) return;
    var es = _entSelIds().map(_entBuscarPorId).filter(Boolean);
    if (!es.length) { alert('Marca las entradas que llegaron en la misma nota o factura.'); return; }
    var conNota = es.filter(function (e) { return e.notaId; });
    var notaId = conNota.length ? conNota[0].notaId : genId() + genId();
    var prov = String(_entSel.proveedor || '').trim(), folio = String(_entSel.folio || '').trim();
    // La nota entera (también las de esa nota que no se marcaron) con los mismos datos.
    var ids = {};
    es.forEach(function (e) { ids[e.id] = 1; });
    ((invActual ? invActual.entradasLog : getEntradasLog()) || []).forEach(function (e) { if (e && e.notaId === notaId) ids[e.id] = 1; });
    Object.keys(ids).forEach(function (id) { _entAplicarCambios(id, { notaId: notaId, notaFolio: folio, notaProveedor: prov }, null); });
    _entSel = null;
    var b = document.getElementById('entAgruparBtn'); if (b) b.outerHTML = _entBtnAgruparHTML();
    _entAviso('Nota armada: ' + es.length + ' entrada' + (es.length !== 1 ? 's' : '') + (prov ? ' · ' + prov : ''));
    _entGruposAbiertos['nota|' + notaId] = true;     // se abre para verla
    renderListadoEntradas();
}
/* Deshacer una nota: sus entradas se quedan, sin nota. En el log global se
   deja `notaId: ''` (vacío a propósito) para que el inventario que ya tenga la
   copia también la suelte (ver _entSyncNotaEnInv). */
function _entNotaDesagrupar(notaId) {
    if (!invActual && typeof _exigeInv === 'function' && !_exigeInv('entradas', 'No puedes registrar entradas de mercancía.')) return;
    if (!notaId || !confirm('¿Desagrupar esta nota? Las entradas se quedan igual, solo sin nota.')) return;
    var cambio = false;
    if (invActual) (invActual.entradasLog || []).forEach(function (e) {
        if (e && e.notaId === notaId) { delete e.notaId; delete e.notaFolio; delete e.notaProveedor; cambio = true; }
    });
    if (cambio) guardarEntradas();
    var gl = getEntradasLog(), sube = [];
    gl.forEach(function (g) { if (g && g.notaId === notaId) { g.notaId = ''; delete g.notaFolio; delete g.notaProveedor; sube.push(g); } });
    if (sube.length) { _guardarELLocal(); sube.forEach(function (g) { try { _sbUpEL(g); } catch (e) {} }); }
    renderListadoEntradas();
}
/* La nota que se armó (o se deshizo) afuera llega a la copia que ya tiene el
   inventario: el log global manda. Solo si el global la nombra (o la quitó
   con `notaId: ''`): una entrada que nunca tuvo nota no toca nada. */
/* ══ LA NOTA DE UNA ENTRADA YA REGISTRADA (Edwin, 23-nov) ══════════════════
   Desde cada entrada (el botón de nota, junto al lápiz): meter una entrada
   suelta a una nota que ya existe, sacarla de su nota o cambiarla a otra, o
   abrir una nota nueva con ella. Solo cambia la nota: cantidad, fecha y fotos
   se quedan. Escribe en las dos casas (inventario y log global); al soltarla,
   el global se queda con `notaId: ''` para que las copias también la suelten. */
var _entNP = null;   // { id, sel, prov, folio }
function _entNotasDisponibles() {
    var fuente = invActual ? (invActual.entradasLog || []) : getEntradasLog();
    var suc = invActual ? '' : _sucActiva(), por = {}, orden = [];
    (fuente || []).forEach(function (e) {
        if (!e || e.borrada || !e.notaId) return;
        if (suc && (e.sucursalId || '') !== suc) return;
        if (!por[e.notaId]) { por[e.notaId] = { id: e.notaId, prov: e.notaProveedor || '', folio: e.notaFolio || '', fecha: e.fecha || '', n: 0 }; orden.push(e.notaId); }
        var o = por[e.notaId]; o.n++;
        if (String(e.fecha || '') > String(o.fecha || '')) o.fecha = e.fecha;
    });
    return orden.map(function (k) { return por[k]; })
        .sort(function (a, b) { return String(b.fecha || '').localeCompare(String(a.fecha || '')); });
}
function _entNotaNombre(n) {
    return [n.prov, n.folio ? 'Folio ' + n.folio : ''].filter(Boolean).join(' · ') || 'Nota sin proveedor';
}
function abrirNotaDeEntrada(id) {
    if (!invActual && typeof _exigeInv === 'function' && !_exigeInv('entradas', 'No puedes registrar entradas de mercancía.')) return;
    var e = _entBuscarPorId(id);
    if (!e) { alert('No se encontró la entrada.'); return; }
    _entNP = { id: id, sel: e.notaId || '', prov: '', folio: '' };
    _entNPPintar();
}
function cerrarNotaDeEntrada() {
    _entNP = null;
    var ov = document.getElementById('entNPOv'); if (ov) ov.remove();
}
function _entNPElegir(v) { if (!_entNP) return; _entNP.sel = v; _entNPPintar(); }
function _entNPPintar() {
    if (!_entNP) return;
    var e = _entBuscarPorId(_entNP.id); if (!e) { cerrarNotaDeEntrada(); return; }
    var ov = document.getElementById('entNPOv');
    if (!ov) {
        ov = document.createElement('div'); ov.id = 'entNPOv'; ov.className = 'ent-ed-ov';
        ov.onclick = function (ev) { if (ev.target === ov) cerrarNotaDeEntrada(); };
        document.body.appendChild(ov);
    }
    var actual = e.notaId || '', notas = _entNotasDisponibles();
    var op = function (v, tit, sub, chip) {
        var on = _entNP.sel === v;
        return '<button type="button" class="ent-np-op' + (on ? ' on' : '') + '" onclick="_entNPElegir(\'' + etaaxJsArgInv(v) + '\')">' +
            '<span class="ent-np-radio"></span><span class="ent-np-txt"><b>' + etx(tit) + '</b>' + (sub ? '<small>' + etx(sub) + '</small>' : '') + '</span>' +
            (chip ? '<span class="ent-np-chip">' + etx(chip) + '</span>' : '') + '</button>';
    };
    var meta = _entMetaHTML(e);
    ov.innerHTML = '<div class="ent-ed-card ent-np-card">' +
        '<div class="ent-ed-hd"><span>' + _icInv('nom-recibo', 18) + 'Nota / factura</span><button onclick="cerrarNotaDeEntrada()" aria-label="Cerrar">✕</button></div>' +
        '<div class="ent-ed-body">' +
            '<div class="ent-np-ent"><b>' + etx(_entTituloTxt(e)) + '</b>' + (meta ? '<small>' + meta + '</small>' : '') +
                '<span>+' + etx(String(parseFloat(e.cantidad) || 0)) + ' ' + etx(_unidadCompra(e)) + ' · ' + etx(e.fecha || '—') + '</span></div>' +
            '<div class="ent-ed-lbl" style="margin-top:14px">¿En qué nota va?</div>' +
            '<div class="ent-np-lista">' +
                op('', 'Suelta (sin nota)', actual ? 'La saca de su nota; la entrada se queda igual' : '', actual ? '' : 'Ahora') +
                notas.map(function (n) {
                    return op(n.id, _entNotaNombre(n), (n.fecha || '—') + ' · ' + n.n + ' producto' + (n.n !== 1 ? 's' : ''), n.id === actual ? 'Ahora' : '');
                }).join('') +
                op('__nueva__', '+ Nota nueva', 'Con esta entrada; después le puedes sumar otras', '') +
            '</div>' +
            (_entNP.sel === '__nueva__' ? '<div class="ent-np-nueva">' +
                '<input id="entNPProv" class="ent-ed-inp" type="text" autocomplete="off" placeholder="Proveedor" value="' + etx(_entNP.prov) + '" oninput="_entNP.prov=this.value">' +
                '<input id="entNPFolio" class="ent-ed-inp" type="text" autocomplete="off" placeholder="Folio (opcional)" value="' + etx(_entNP.folio) + '" oninput="_entNP.folio=this.value">' +
            '</div>' : '') +
            (!notas.length ? '<div class="ent-np-vacio">Todavía no hay notas registradas' + (invActual ? ' en este periodo' : '') + '. Puedes abrir una nueva con esta entrada.</div>' : '') +
            '<div class="ent-ed-acc">' +
                '<button class="ent-ed-btn" onclick="cerrarNotaDeEntrada()">Cancelar</button>' +
                '<button class="ent-ed-btn ok" onclick="guardarNotaDeEntrada()">Guardar</button>' +
            '</div>' +
        '</div></div>';
    if (_entNP.sel === '__nueva__') { var pi = document.getElementById('entNPProv'); if (pi && !_entNP.prov) pi.focus(); }
}
function guardarNotaDeEntrada() {
    if (!_entNP) return;
    if (!invActual && typeof _exigeInv === 'function' && !_exigeInv('entradas', 'No puedes registrar entradas de mercancía.')) return;
    var e = _entBuscarPorId(_entNP.id); if (!e) { cerrarNotaDeEntrada(); return; }
    var sel = _entNP.sel, campos, aviso;
    if (sel === '') {
        if (!e.notaId) { cerrarNotaDeEntrada(); return; }
        campos = { notaId: '', notaFolio: '', notaProveedor: '' };
        aviso = 'Entrada sacada de la nota';
    } else if (sel === '__nueva__') {
        var prov = String(_entNP.prov || '').trim(), folio = String(_entNP.folio || '').trim();
        if (!prov && !folio) { alert('Escribe el proveedor o el folio de la nota nueva.'); return; }
        campos = { notaId: genId() + genId(), notaFolio: folio, notaProveedor: prov };
        aviso = 'Nota nueva: ' + _entNotaNombre({ prov: prov, folio: folio });
    } else {
        if (sel === (e.notaId || '')) { cerrarNotaDeEntrada(); return; }
        var n = null; _entNotasDisponibles().forEach(function (x) { if (x.id === sel) n = x; });
        if (!n) { alert('Esa nota ya no existe.'); return; }
        campos = { notaId: n.id, notaFolio: n.folio, notaProveedor: n.prov };
        aviso = 'Agregada a la nota ' + _entNotaNombre(n);
    }
    _entAplicarCambios(_entNP.id, campos, null);
    if (campos.notaId) _entGruposAbiertos['nota|' + campos.notaId] = true;   // se abre para verla
    cerrarNotaDeEntrada();
    _entAviso(aviso);
    renderListadoEntradas();
}
// Un id de nota dentro de un onclick: es un dato, no código.
function etaaxJsArgInv(v) { return (typeof window.etaaxJsArg === 'function') ? window.etaaxJsArg(v) : String(v).replace(/[^A-Za-z0-9_-]/g, ''); }
window.abrirNotaDeEntrada = abrirNotaDeEntrada; window.guardarNotaDeEntrada = guardarNotaDeEntrada;
window.cerrarNotaDeEntrada = cerrarNotaDeEntrada; window._entNPElegir = _entNPElegir;

function _entSyncNotaEnInv(e) {
    if (!invActual || !e || !e.id || !('notaId' in e)) return false;
    var c = null;
    (invActual.entradasLog || []).forEach(function (x) { if (x && x.id === e.id) c = x; });
    if (!c) return false;
    if ((c.notaId || '') === (e.notaId || '') && (c.notaFolio || '') === (e.notaFolio || '') &&
        (c.notaProveedor || '') === (e.notaProveedor || '')) return false;
    if (e.notaId) Object.assign(c, _entNotaCampos(e));
    else { delete c.notaId; delete c.notaFolio; delete c.notaProveedor; }
    return true;
}
window._entSelModo = _entSelModo; window._entSelMarcar = _entSelMarcar; window._entSelAgrupar = _entSelAgrupar;
window._entNotaDesagrupar = _entNotaDesagrupar;

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
        cerrarEditorEntrada();
        renderListadoEntradas();
        _invalidarStep5();      // se fue producto del disponible → rehacer el resumen
    });
}
/* ══ EDITOR DE ENTRADA (✏️) ══════════════════════════════════════════════
   Antes solo se corregían cantidad y fecha en la propia fila. Ahora se edita el
   registro COMPLETO — concepto, insumo, cantidad, fecha, comentario y fotos —
   venga del QR o del inventario.
   OJO con la doble residencia: una entrada vive en el log GLOBAL (maestro, el
   que sincroniza a Supabase) y, si ya se importó, también como COPIA dentro de
   invActual.entradasLog. Se escribe en AMBOS por id — antes editar desde el
   historial global dejaba al inventario con el dato viejo. Ojo también con el
   nombre: la copia del inventario lo guarda en `nombreProducto` y el global en
   `nombre`. */
var _entEd = null;   // borrador de edición

function _entBuscarPorId(id) {
    var e = null;
    if (invActual) e = (invActual.entradasLog || []).find(function(x){ return x && x.id === id; });
    if (!e) e = getEntradasLog().find(function(x){ return x && x.id === id; });
    return e || null;
}
// Escribe los mismos campos en las dos residencias del registro.
function _entAplicarCambios(id, campos, ins) {
    var etiqueta = ins ? insumoEtiqueta(ins) : '';
    if (invActual) {
        var a = (invActual.entradasLog || []).find(function(x){ return x && x.id === id; });
        if (a) {
            Object.assign(a, campos);
            if (ins) { a.nombreProducto = etiqueta; if (a.nombre !== undefined) a.nombre = ins.nombre || etiqueta; }
            guardarEntradas();
        }
    }
    var g = getEntradasLog().find(function(x){ return x && x.id === id; });
    if (g) {
        Object.assign(g, campos);
        if (ins) { g.nombre = ins.nombre || etiqueta; g.familia = ins.familia || ins.categoria || g.familia || ''; }
        _guardarELLocal();
        try { _sbUpEL(g); } catch(err){}   // el diff no ve updates in-place → forzar
    }
    return !!(g || invActual);
}

/* ══ LA FOTO DE EVIDENCIA, DESDE EL CELULAR CON UN QR (Edwin, 19-nov) ══════
   El mismo puente que usan los cortes y gastos (qr-pairing.js): la pantalla
   enseña un QR, el celular lo escanea, toma la foto y aquí llega sola.
   El recuadro del QR se SACA antes de repintar y se vuelve a poner después:
   repintar lo destruía y el código cambiaba a media escaneada. */
function _qrEvidCerrar() {
    try { if (window.QrPuente) QrPuente.cerrar(); } catch (e) {}
    var b = document.getElementById('invQrEvid'); if (b) b.remove();
}
function _qrEvidAbrir(slotId, onFoto) {
    var slot = document.getElementById(slotId);
    if (!slot) return;
    if (!window.QrPuente) { alert('El escaneo con el celular no está disponible en esta pantalla. Recarga la página.'); return; }
    _qrEvidCerrar();
    var box = document.createElement('div');
    box.id = 'invQrEvid'; box.className = 'inv-qr-evid';
    slot.appendChild(box);
    QrPuente.abrir(getNegocioActivo(), 'entrada', box, onFoto);
}
// Antes de repintar un contenedor, se aparta el QR; después se regresa a su lugar.
function _qrEvidApartar() { var b = document.getElementById('invQrEvid'); if (b && b.parentNode) b.parentNode.removeChild(b); return b; }
function _qrEvidReponer(b, slotId) { if (!b) return; var slot = document.getElementById(slotId); if (slot) slot.appendChild(b); else _qrEvidCerrar(); }
function _qrEvidBoton(activo, fn) {
    return '<button type="button" class="inv-qr-btn' + (activo ? ' on' : '') + '" onclick="' + fn + '">' +
        _icInv(activo ? 'adm-cerrar' : 'cor-escanear-qr', 16) + (activo ? 'Cerrar el escaneo' : 'Subir foto con el celular (QR)') + '</button>';
}
function _entEdToggleQr() {
    if (!_entEd) return;
    if (_entEd.qr) { _entEd.qr = false; _qrEvidCerrar(); _entEdPintar(); return; }
    _entEd.qr = true; _entEdPintar();
    _qrEvidAbrir('entEdQrSlot', function (foto) {
        if (!_entEd || !foto || !foto.url) return;
        _entEd.fotos.push(foto.url); _entEdPintar();
    });
}
window._entEdToggleQr = _entEdToggleQr;

function abrirEditorEntrada(id) {
    var e = _entBuscarPorId(id);
    if (!e) { alert('No se encontró la entrada.'); return; }
    _entEd = {
        id: id,
        tipo: String(e.tipo || 'compra').toLowerCase(),
        insumoId: e.insumoId || '',
        cantidad: parseFloat(e.cantidad) || 0,
        fecha: e.fecha || '',
        notas: e.notas || '',
        fotos: (e.foto_urls && e.foto_urls.length) ? e.foto_urls.slice() : (e.foto_url ? [e.foto_url] : []),
        busca: '',
        subiendo: false
    };
    _entEdPintar();
}
function cerrarEditorEntrada() {
    if (_entEd && _entEd.qr) _qrEvidCerrar();
    _entEd = null;
    var ov = document.getElementById('entEdOv');
    if (ov) ov.remove();
}
// Insumos elegibles: catálogo de la sucursal activa (misma regla que el resto del módulo).
function _entEdInsumos() {
    try { return _scopeSucInsumos(getInsumos()); } catch (e) { return getInsumos() || []; }
}
function _entEdPintar() {
    if (!_entEd) return;
    var ov = document.getElementById('entEdOv');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'entEdOv';
        ov.className = 'ent-ed-ov';
        ov.onclick = function(ev){ if (ev.target === ov) cerrarEditorEntrada(); };
        document.body.appendChild(ov);
    }
    var ins = _entEd.insumoId && typeof window._insumoResolver === 'function'
        ? window._insumoResolver(_entEd.insumoId) : null;
    var q = (_entEd.busca || '').trim().toLowerCase();
    var lista = q ? _entEdInsumos().filter(function(x){
        return x && (insumoEtiqueta(x) || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 12) : [];

    var _qrB = _qrEvidApartar();
    ov.innerHTML =
        '<div class="ent-ed-card" onclick="event.stopPropagation()">' +
            '<div class="ent-ed-hd">' +
                '<span>' + _icInv('rec-editar', 18) + 'Editar entrada</span>' +
                '<button onclick="cerrarEditorEntrada()" title="Cerrar">' + _icInv('adm-cerrar', 18) + '</button>' +
            '</div>' +
            '<div class="ent-ed-body">' +
                '<div class="ent-ed-lbl">Concepto</div>' +
                '<div class="ent-tipo-row">' +
                    ENT_TIPOS.map(function(t){
                        return '<button class="ent-tipo-btn ' + (_entEd.tipo === t.id ? 'active' : '') + '" ' +
                            'onclick="_entEd.tipo=\'' + t.id + '\';_entEdPintar()">' + _icInv(t.ic) + t.lbl + '</button>';
                    }).join('') +
                '</div>' +
                '<div style="font-size:11px;color:var(--text-dim);margin-top:6px">' +
                    (entEsCompra(_entEd.tipo)
                        ? 'Suma a “Compras del período”.'
                        : 'Entra al stock pero <b>no</b> suma a “Compras del período”.') +
                '</div>' +

                '<div class="ent-ed-lbl" style="margin-top:16px">Insumo</div>' +
                '<div class="ent-ed-ins">' + etx(ins ? insumoEtiqueta(ins) : (_entEd.insumoId || '— sin insumo —')) + '</div>' +
                '<input class="ent-ed-inp" type="text" placeholder="Buscar otro insumo…" value="' + etx(_entEd.busca) + '" ' +
                    'oninput="_entEd.busca=this.value;_entEdPintar();var i=document.getElementById(\'entEdBusca\');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}" id="entEdBusca">' +
                (q ? ('<div class="ent-ed-lista">' + (lista.length
                    ? lista.map(function(x){
                        return '<div class="ent-ed-op" onclick="_entEd.insumoId=\'' + x.id + '\';_entEd.busca=\'\';_entEdPintar()">' + etx(insumoEtiqueta(x)) + '</div>';
                      }).join('')
                    : '<div class="ent-ed-op" style="color:var(--text-dim);cursor:default">Sin resultados</div>') + '</div>') : '') +

                '<div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap">' +
                    '<div><div class="ent-ed-lbl">Cantidad</div>' +
                        '<input class="ent-ed-inp" style="width:120px" type="text" inputmode="decimal" value="' + _entEd.cantidad + '" ' +
                            'oninput="this.value=this.value.replace(/[^0-9.]/g,\'\');_entEd.cantidad=parseFloat(this.value)||0"></div>' +
                    '<div><div class="ent-ed-lbl">Fecha</div>' +
                        '<input class="ent-ed-inp" type="date" value="' + etx(_entEd.fecha) + '" onchange="_entEd.fecha=this.value"></div>' +
                '</div>' +

                '<div class="ent-ed-lbl" style="margin-top:16px">Comentario</div>' +
                '<textarea class="ent-ed-inp" rows="2" placeholder="Proveedor, ticket, observación…" ' +
                    'oninput="_entEd.notas=this.value">' + etx(_entEd.notas) + '</textarea>' +

                '<div class="ent-ed-lbl" style="margin-top:16px">Evidencia (' + _entEd.fotos.length + ' foto' + (_entEd.fotos.length === 1 ? '' : 's') + ')</div>' +
                '<div class="ent-ed-fotos">' +
                    _entEd.fotos.map(function(u, i){
                        return '<span class="ent-ed-foto">' +
                            '<img ' + sbAttr(u) + ' onclick="etaaxVerFoto(this.src)">' +
                            '<button title="Quitar foto" onclick="_entEd.fotos.splice(' + i + ',1);_entEdPintar()">✕</button>' +
                        '</span>';
                    }).join('') +
                    '<label class="ent-ed-addfoto" title="Subir desde este equipo">' + (_entEd.subiendo ? '…' : _icInv('adm-subir-archivo', 20)) +
                        '<input type="file" accept="image/*" multiple style="display:none" onchange="_entEdSubirFotos(this)">' +
                    '</label>' +
                '</div>' +
                '<div style="margin-top:8px">' + _qrEvidBoton(!!_entEd.qr, '_entEdToggleQr()') + '</div>' +
                '<div id="entEdQrSlot"></div>' +

                '<div class="ent-ed-acc">' +
                    '<button class="ent-ed-btn" onclick="cerrarEditorEntrada()">Cancelar</button>' +
                    '<button class="ent-ed-btn ok" onclick="guardarEditorEntrada()">Guardar cambios</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    _qrEvidReponer(_qrB, 'entEdQrSlot');
}
// Comprime y sube las fotos nuevas a Storage (bucket 'evidencias', igual que el QR).
async function _entEdSubirFotos(input) {
    if (!_entEd || !input.files || !input.files.length) return;
    var files = Array.prototype.slice.call(input.files);
    input.value = '';
    _entEd.subiendo = true; _entEdPintar();
    for (var i = 0; i < files.length; i++) {
        try {
            var url = await _entEdSubirUna(files[i]);
            if (url) _entEd.fotos.push(url);
        } catch (e) { console.warn('[foto entrada]', e); }
    }
    _entEd.subiendo = false; _entEdPintar();
}
function _entEdComprimir(file) {
    return new Promise(function(resolve){
        var r = new FileReader();
        r.onload = function(e){
            var img = new Image();
            img.onload = function(){
                var w = img.width, h = img.height, M = 1024;
                if (w > h) { if (w > M) { h = Math.round(h * M / w); w = M; } }
                else       { if (h > M) { w = Math.round(w * M / h); h = M; } }
                var c = document.createElement('canvas'); c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                c.toBlob(function(b){ resolve(b); }, 'image/jpeg', 0.65);
            };
            img.onerror = function(){ resolve(null); };
            img.src = e.target.result;
        };
        r.onerror = function(){ resolve(null); };
        r.readAsDataURL(file);
    });
}
async function _entEdSubirUna(file) {
    var blob = await _entEdComprimir(file);
    if (!blob || typeof _supabase === 'undefined') return '';
    var neg = getNegocioActivo() || 'sin-negocio';
    var path = neg + '/entradas/erp/' + genId() + genId() + '.jpg';
    var up = await _supabase.storage.from(sbBucketDe('entradas')).upload(path, blob, { contentType:'image/jpeg' });
    if (up.error) { alert('No se pudo subir la foto: ' + up.error.message); return ''; }
    return sbRefDe('entradas', path);
}
/* Toda mano sobre el LOG DE ENTRADAS tiene que invalidar el Paso 5. Editar o
   borrar una entrada ya registrada cambia el disponible, el teórico y el capital,
   pero esas funciones solo repintaban su propia lista: el resumen se quedaba con
   el cálculo cacheado y enseñaba números de antes del cambio. Además se prende el
   aviso de "Recalcular" para que se vea que hay algo que rehacer. */
function _invalidarStep5() {
    window._step5Dirty = true;
    window._step5Force = true;
    if (typeof _consumoIdxCache !== 'undefined') { _consumoIdxCache = null; _consumoDirty = true; }
    if (typeof _repCache !== 'undefined') _repCache = null;
    if (typeof _marcarStep5Stale === 'function') _marcarStep5Stale(true);
    if (typeof pasoActual !== 'undefined' && pasoActual === 5 && typeof renderStepContent === 'function') {
        try { renderStepContent(); } catch (e) {}
    }
}
window._invalidarStep5 = _invalidarStep5;

function guardarEditorEntrada() {
    if (!_entEd) return;
    if (!(_entEd.cantidad > 0)) { alert('La cantidad debe ser mayor a 0.'); return; }
    if (!_entEd.insumoId)       { alert('Elige un insumo.'); return; }
    /* Editar la fecha puede sacar la entrada del periodo igual que capturarla
       mal, y con el mismo resultado. */
    var _fueraEd = _fechaFueraDePeriodo(_entEd.fecha);
    if (_fueraEd) { alert(_fueraEd); return; }
    var ins = (typeof window._insumoResolver === 'function') ? window._insumoResolver(_entEd.insumoId) : null;
    _entAplicarCambios(_entEd.id, {
        tipo:      _entEd.tipo,
        insumoId:  _entEd.insumoId,
        cantidad:  _entEd.cantidad,
        fecha:     _entEd.fecha,
        notas:     _entEd.notas,
        foto_urls: _entEd.fotos.slice(),
        foto_url:  _entEd.fotos[0] || '',   // compat con lectores viejos (una sola foto)
        editadoEn: new Date().toISOString()
    }, ins);
    cerrarEditorEntrada();
    renderListadoEntradas();
    _invalidarStep5();          // cambió el disponible → el resumen debe rehacerse
    // Dentro del inventario, la ficha del insumo muestra "ya registrado este período":
    // se repinta igual que al agregar una entrada, para que no quede el número viejo.
    if (invActual) {
        try { if (typeof renderFormEntrada === 'function' && _entRapidaInsumoId) renderFormEntrada(); } catch(e){}
        try { if (typeof renderChipsEntrada === 'function') renderChipsEntrada(); } catch(e){}
    }
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

    /* El contador del encabezado lo RELLENA renderListadoEntradas con lo que de
       verdad se pinta. Aquí solo va un valor de arranque, y antes era
       getEntradasLog().length —el cache crudo, con los borrados y con las
       entradas de las otras sucursales—: por eso decía «637 registros» sobre
       una lista de 206. */
    const logLen = invActual ? (invActual.entradasLog||[]).length : 0;
    const _perTab = (p, lbl) => `<button onclick="setEntPeriodo('${p}')" style="border:1px solid ${_entPeriodo===p?'var(--accent)':'var(--border)'};background:${_entPeriodo===p?'rgba(245,200,66,.12)':'transparent'};color:${_entPeriodo===p?'var(--accent)':'var(--text-muted)'};border-radius:20px;padding:5px 14px;font-family:inherit;font-size:12px;cursor:pointer;font-weight:${_entPeriodo===p?'700':'500'}">${lbl}</button>`;
    const _inpDate = 'background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px';
    const filtroFechas = invActual ? '' : `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
            ${_perTab('todos','Todas')}${_perTab('dia','Hoy')}${_perTab('semana','Semana')}${_perTab('mes','Mes')}${_perTab('rango','Rango')}
            ${_entPeriodo==='rango' ? `<input type="date" id="entDesde" value="${_entDesde}" onchange="setEntRango()" style="${_inpDate}">
                <span style="color:var(--text-dim);font-size:12px">a</span>
                <input type="date" id="entHasta" value="${_entHasta}" onchange="setEntRango()" style="${_inpDate}">` : ''}
        </div>`;
    /* LA MISMA PANTALLA QUE EL PASO 2 (Edwin, 23-nov): a la izquierda los
       insumos para registrar (y la nota, si hay una abierta); a la derecha lo
       registrado. El buscador, lista/cuadrícula, la nota y el filtro de lo
       registrado van en la barra fija de arriba (_pintarEntHerr), la misma del
       Paso 2. Sin permiso de registrar, solo la lista. */
    _entLogInsumoCache = null;          // el catálogo pudo llegar o cambiar
    const puedeReg = (typeof _puedeInv !== 'function') || _puedeInv('entradas');
    const lista = `${filtroFechas}
                <div class="p12-cab"><span>${invActual ? 'Entradas del período' : 'Historial de entradas'}</span>
                    <b id="entLogCount">${(!invActual && !_INV_CARGADO) ? '<span style="color:var(--text-dim);font-weight:500">cargando…</span>'
                        : (logLen + ' registro' + (logLen !== 1 ? 's' : ''))}</b>${puedeReg ? _entBtnAgruparHTML() : ''}</div>
                <div id="entSelBar"></div>
                <div id="entLogList"></div>`;
    cont.innerHTML = puedeReg ? `
        <div class="p12-split p12-split-ent ent-hist">
            <section class="p12-col">
                <div id="entNotaCard"></div>
                <div id="entFormCard"></div>
                <div id="entChips"></div>
            </section>
            <section class="p12-col">${lista}</section>
        </div>` : `
        <div class="ent-rapida-wrap ent-ancho"><div>${lista}</div></div>`;
    _pintarEntHerr();
    initEntradaRapidaUI();
}

/* La barra de arriba: la MISMA en el Paso 2 y en el registro de afuera. A la
   izquierda, el buscador de productos, lista/cuadrícula y la nota; a la
   derecha, el buscador de lo registrado y sus pestañas. */
function _entHerrHTML(puedeReg) {
    return _herrLados(puedeReg
        ? _herrBuscar('entBuscador', _entRapidaBusqueda, 'Producto para registrar…', 'buscarInsumoEntrada') + _herrVistaToggle() + _entBtnNotaHTML()
        : '', _filtroTipoHTML(true));
}
var _entHerrUltimo = null;
function _pintarEntHerr() {
    var el = document.getElementById('entHerr'); if (!el) return;
    var html = '';
    try { html = _entHerrHTML((typeof _puedeInv !== 'function') || _puedeInv('entradas')); } catch (e) { console.warn('[inv] barra de entradas:', e); }
    // Igual que la del paso: si solo cambió lo tecleado, no se repinta (no se pierde el foco).
    var llave = html.replace(/ value="[^"]*"/g, '');
    if (llave === _entHerrUltimo && el.innerHTML) return;
    var act = document.activeElement, fid = (act && el.contains(act) && act.id) ? act.id : '', s0 = null, s1 = null;
    if (fid) { try { s0 = act.selectionStart; s1 = act.selectionEnd; } catch (e) {} }
    el.innerHTML = html; _entHerrUltimo = llave;
    if (fid) { var n = document.getElementById(fid); if (n) { n.focus(); try { if (s0 !== null) n.setSelectionRange(s0, s1); } catch (e) {} } }
    if (typeof _ajustarStickyInv === 'function') _ajustarStickyInv();
}
function _vaciarEntHerr() { var el = document.getElementById('entHerr'); if (el) el.innerHTML = ''; _entHerrUltimo = null; }

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
/* ══ EDITAR ES EDITAR DE VERDAD (Edwin, 19-nov) ═══════════════════════════
   «Editar» en una ficha abría un editor recortado del propio inventario (el
   del insumo cambiaba unos campos; el de la receta, precio y cantidades).
   Ahora pide la contraseña general y abre el editor REAL en una ventana
   flotante: el de Insumos (insumos.html?solo=1&id=…) o el escandallo de
   Recetas (index.html?embed=1&r=…) —el mismo que usa Recetas—. Al guardar,
   el editor avisa (insumoGuardado / recetaGuardada) y el inventario toma el
   cambio en ese momento, sin recargar. */
var _invEdDirty = false;
function _invAbrirEditor(url, titulo) {
    _invCerrarEditor(true);
    var ov = document.createElement('div');
    ov.id = 'invEditorOv'; ov.className = 'inv-editor-ov';
    ov.innerHTML = '<div class="inv-editor-caja"><div class="inv-editor-hd"><span>' + _icInv('rec-editar', 18) + etx(titulo || 'Editar') + '</span>' +
        '<button onclick="_invCerrarEditor()" title="Cerrar">' + _icInv('adm-cerrar', 18) + '</button></div>' +
        '<iframe src="' + url + '" title="' + etx(titulo || 'Editor') + '"></iframe></div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) _invCerrarEditor(); });
    document.body.appendChild(ov);
}
function _invCerrarEditor(forzar) {
    var ov = document.getElementById('invEditorOv');
    if (!ov) return;
    if (!forzar && _invEdDirty && !confirm('Tienes cambios sin guardar en la receta. ¿Cerrar sin guardar?')) return;
    _invEdDirty = false;
    ov.remove();
}
function _invEditarInsumo(insumoId) {
    var ins = (typeof window._insumoResolver === 'function' && window._insumoResolver(insumoId)) || getInsumos().find(function (x) { return x.id === insumoId; });
    if (!ins) { alert('No se encontró el insumo en el catálogo.'); return; }
    var nom = ins.nombre + (ins.variedad ? ' ' + ins.variedad : '');
    _pedirClaveAdmin('Editar ' + (ins.esSubReceta ? 'la receta de ' : '') + nom, function () {
        if (ins.esSubReceta && ins.recetaId) _invAbrirEditor('/recetas/index.html?embed=1&r=' + encodeURIComponent(ins.recetaId), 'Escandallo · ' + nom);
        else _invAbrirEditor('/recetas/insumos.html?solo=1&id=' + encodeURIComponent(ins.id), 'Editar insumo · ' + nom);
    }, 'Confirmar');
}
function _invEditarReceta(recetaId) {
    var r = (window._recetaResolver ? window._recetaResolver(recetaId) : null) || getRecetas().find(function (x) { return x.id === recetaId; });
    if (!r) { alert('No se encontró la receta.'); return; }
    _pedirClaveAdmin('Editar la receta ' + (r.nombre || ''), function () {
        _invAbrirEditor('/recetas/index.html?embed=1&r=' + encodeURIComponent(r.id), 'Escandallo · ' + (r.nombre || ''));
    }, 'Confirmar');
}
window._invEditarInsumo = _invEditarInsumo; window._invEditarReceta = _invEditarReceta; window._invCerrarEditor = _invCerrarEditor;
/* El cambio llega en el momento: lo que manda el editor se injerta en el
   catálogo de aquí, se repinta lo que está en pantalla y, por detrás, se
   pide lo fresco a la nube (recetas incluidas) para que todo cuadre. */
function _invTomarCambio(insumos) {
    if (insumos && insumos.length) {
        var cat = getInsumos();
        insumos.forEach(function (n) {
            if (!n || !n.id) return;
            var i = cat.findIndex(function (x) { return x && x.id === n.id; });
            if (i > -1) cat[i] = Object.assign({}, cat[i], n); else cat.push(n);
        });
        if (typeof _consumoIdxCache !== 'undefined') _consumoIdxCache = null;
    }
    _consumoDirty = true; window._step5Dirty = true;
    var repintar = function () {
        if (!invActual) return;
        if (filasCaptura.length) invActual.filas = filasCaptura.map(function (f) { return Object.assign({}, f); });
        try { cargarProductosCaptura(); } catch (e) {}
        if (typeof renderStepContent === 'function') renderStepContent();
        var ft = document.getElementById('modalFichaTecnica');
        if (ft && ft.style.display !== 'none' && _ftInsumoId) { var ins = getInsumos().find(function (x) { return x.id === _ftInsumoId; }); if (ins) _ftRenderVer(ins); }
        var fr = document.getElementById('modalFichaReceta');
        if (fr && fr.style.display !== 'none' && _frRecetaId) verFichaReceta(_frRecetaId);
    };
    repintar();
    if (typeof _refrescarDatosInv === 'function') _refrescarDatosInv().then(function (llego) { if (llego) repintar(); });
}
window.addEventListener('message', function (e) {
    if (!e.data || !e.data.type || e.origin !== location.origin && e.origin !== 'null') return;
    if (!document.getElementById('invEditorOv') && e.data.type !== 'insumosCambiaron') return;
    if (e.data.type === 'insumoGuardado') { _invTomarCambio(e.data.insumos); _invCerrarEditor(true); }
    else if (e.data.type === 'insumosCambiaron') _invTomarCambio(e.data.insumos);
    else if (e.data.type === 'recetaGuardada') { _invTomarCambio(null); _invCerrarEditor(true); }
    else if (e.data.type === 'cerrarEditor') _invCerrarEditor(true);
    else if (e.data.type === 'escDirty') _invEdDirty = !!e.data.dirty;
});

let _ftModo = 'ver'; // 'ver' | 'editar'

function _ftSetFooter(modo) {
    const footer = document.getElementById('ftFooter');
    const lbl    = document.getElementById('ftModoLabel');
    if (!footer) return;
    if (modo === 'ver') {
        if (lbl) lbl.textContent = 'Ficha técnica';
        footer.innerHTML = `
            <button onclick="cerrarFichaTecnica()" class="btn-vista">Cerrar</button>
            <button onclick="_invEditarInsumo(_ftInsumoId)" class="btn-vista" title="Abre el editor de Insumos (pide contraseña)"
                style="color:var(--accent);border-color:var(--accent)">${_icInv('rec-editar')}Editar</button>`;
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

/* El stock en su unidad (piezas o la presentación de compra), como se definió. */
function _stockUnidadesInv(p) {
    var ref = (window.EtaaxCore && EtaaxCore.referenciaCompra) ? EtaaxCore.referenciaCompra({}, p) : { piezasPorCompra: 1 };
    var pl = function (t) { t = String(t || ''); return /s$/i.test(t) ? t : (/[aeiouáéíóú]$/i.test(t) ? t + 's' : t + 'es'); };
    var pieza = String(p.umPresCompra || '').trim(); if (!pieza || /^(kg|g|lt|ml)$/i.test(pieza)) pieza = 'Piezas';
    return { varias: ref.piezasPorCompra > 1, compra: pl(String(p.presentacionCompra || 'Cajas')), pieza: pl(pieza), factor: ref.piezasPorCompra };
}
function _stockUmTxtInv(p, campo) {
    var u = _stockUnidadesInv(p);
    if (!u.varias) return String(p.presentacionCompra || p.umPresCompra || 'piezas').toLowerCase();
    return (p[campo] === 'compra' ? u.compra : u.pieza).toLowerCase();
}
function _stockUmSelInv(p, id, campo) {
    var u = _stockUnidadesInv(p); if (!u.varias) return '';
    var v = p[campo] === 'compra' ? 'compra' : 'pieza';
    return '<select id="' + id + '" class="ft-input" style="width:auto;flex:0 0 auto">' +
        '<option value="pieza"' + (v === 'pieza' ? ' selected' : '') + '>' + etx(u.pieza) + '</option>' +
        '<option value="compra"' + (v === 'compra' ? ' selected' : '') + '>' + etx(u.compra) + ' de ' + u.factor + '</option></select>';
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
                    ${p.stockMin ? `<span style="font-size:11px;color:var(--text-dim)">Stock mín: ${p.stockMin} ${etx(_stockUmTxtInv(p, 'stockMinUm'))}</span>` : ''}
                    ${p.stockMax ? `<span style="font-size:11px;color:var(--text-dim)">Stock máx: ${p.stockMax} ${etx(_stockUmTxtInv(p, 'stockMaxUm'))}</span>` : ''}
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
            <div><label class="ft-lbl">Stock mínimo</label><div style="display:flex;gap:6px"><input id="ft_stockMin" type="number" class="ft-input" style="flex:1;min-width:0" value="${(p.stockMin!=null&&p.stockMin!=='')?p.stockMin:(ins.stockMin||0)}" min="0">${_stockUmSelInv(p, 'ft_stockMinUm', 'stockMinUm')}</div></div>
            <div><label class="ft-lbl">Stock máximo</label><div style="display:flex;gap:6px"><input id="ft_stockMax" type="number" class="ft-input" style="flex:1;min-width:0" value="${(p.stockMax!=null&&p.stockMax!=='')?p.stockMax:(ins.stockMax||0)}" min="0">${_stockUmSelInv(p, 'ft_stockMaxUm', 'stockMaxUm')}</div></div>
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
    ins.stockMax     = parseFloat(document.getElementById('ft_stockMax')?.value)|| 0;
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
    // Los lectores de stock miran PRIMERO la presentación (_p.stockMin) y solo
    // después el insumo: si aquí se escribiera nada más el insumo, editar el
    // stock desde la ficha no cambiaría nada. Se escriben los dos.
    p.stockMin          = ins.stockMin;
    p.stockMax          = ins.stockMax;
    var _umMin = document.getElementById('ft_stockMinUm'), _umMax = document.getElementById('ft_stockMaxUm');
    if (_umMin) p.stockMinUm = _umMin.value;
    if (_umMax) p.stockMaxUm = _umMax.value;
    try { _skPut(_sk('insumos'), JSON.stringify(lista)); } catch(e) {}
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
/* init() corre ANTES de que responda la nube: aquí se mezcla solo para PINTAR.
   Re-subir en este punto sería mandar el respaldo entero, porque todavía no se
   sabe qué hay allá. Lo que falte de verdad lo manda _sbInit al terminar. */
function init() { _limpiarStorageEmergencia(); _mergeDraftsLocal(); _mergeELLocal(false); renderStats(); renderHistorial(); }
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
