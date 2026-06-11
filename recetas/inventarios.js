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
function getRecetas()     { return _cacheRecetasInv || []; }
function getInventarios() { return _cacheInv || []; }
function getEntradasLog() { return _cacheEL || []; }

// ── Helpers Supabase inventarios ──────────────────────────────
function _sbUpInv(inv) {
    var negId = getNegocioActivo(); if (!negId || typeof _supabase === 'undefined') return;
    _supabase.from('inventarios').upsert({
        id: inv.id, negocio_id: negId, datos: inv,
        updated_at: new Date().toISOString()
    }).then(function(r){ if (r.error) console.error('[inventarios] upsert:', r.error.message); });
}
function _sbDelInv(id) {
    if (typeof _supabase === 'undefined') return;
    _supabase.from('inventarios').delete().eq('id', id)
        .then(function(r){ if (r.error) console.error('[inventarios] delete:', r.error.message); });
}
function _sbUpEL(entry) {
    var negId = getNegocioActivo(); if (!negId || typeof _supabase === 'undefined') return;
    _supabase.from('entradas_log').upsert({
        id: entry.id, negocio_id: negId, datos: entry,
        updated_at: new Date().toISOString()
    }).then(function(r){ if (r.error) console.error('[entradas_log] upsert:', r.error.message); });
}
function _sbDelEL(id) {
    if (typeof _supabase === 'undefined') return;
    _supabase.from('entradas_log').delete().eq('id', id)
        .then(function(r){ if (r.error) console.error('[entradas_log] delete:', r.error.message); });
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
    if (!r[0].error) _cacheInv  = (r[0].data || []).map(function(x){ return x.datos; });
    if (!r[1].error) _cacheEL   = (r[1].data || []).map(function(x){ return x.datos; });
    if (!r[2].error) _cacheRecetasInv = (r[2].data || []).map(function(x){ return x.datos; });
    if (!r[3].error) {
        _cacheInsumosInv = (r[3].data || []).map(function(x){ return x.datos; });
        // actualizar localStorage para compatibilidad con insumos.js
        try { localStorage.setItem(_sk('insumos'), JSON.stringify(_cacheInsumosInv.map(function(ins){ var c=Object.assign({},ins); c.foto=''; c.fotoUrl=''; return c; }))); } catch(e) {}
    }
    if (typeof init === 'function') init();
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

function setInventarios(d) {
    var prev = _cacheInv || [];
    _cacheInv = d;
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

function setEntradasLog(d) {
    var prev = _cacheEL || [];
    _cacheEL = d;
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

function getExistenciaAnterior(insumoId) {
    const cerrados = getInventarios().filter(x => x.cerrado);
    if (!cerrados.length) return 0;
    const ultimo = cerrados[cerrados.length - 1];
    const fila   = (ultimo.filas || []).find(f => f.insumoId === insumoId);
    if (!fila) return 0;
    return fila.existenciaFisica !== undefined ? fila.existenciaFisica : calcExistencia(fila);
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
    const cerradas = (fila.cerradasBodega || 0) + (fila.cerradasBarra || 0);
    const mlReales = calcMLReales(fila);
    if (fila.tipo === 'pza') return cerradas + (mlReales > 0 ? 1 : 0);
    const contNeto = fila.contNeto || 0;
    if (contNeto <= 0) return cerradas;
    return cerradas + mlReales / contNeto;
}

function calcExistencia(fila) {
    const cerradas = (fila.cerradasBodega || 0) + (fila.cerradasBarra || 0);
    const mlReales = calcMLReales(fila);
    if (fila.tipo === 'pza') return cerradas + (mlReales > 0 ? 1 : 0);
    const copasBot   = fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0;
    const copasAbier = fila.copaML > 0 ? mlReales / fila.copaML : 0;
    return cerradas * copasBot + copasAbier;
}

function calcExistenciaTeorica(fila) {
    const ea          = parseFloat(fila.existenciaAnterior) || 0;
    const ventasRec   = calcVentasCopasRecetas(fila.insumoId, fila.copaML);
    const ventasDir   = parseFloat(fila.ventasCopasDirectas) || 0;
    const cancelCopas = getCancelacionesCopas(fila.insumoId);
    const cortesia    = parseFloat(fila.cortesiaCopas) || 0;
    const merma       = parseFloat(fila.mermaCopas) || 0;
    const totalCopas  = ventasRec + ventasDir + cancelCopas + cortesia + merma;
    const entTotal    = getEntradasCopas(fila);
    if (fila.tipo === 'pza') return ea + entTotal - (fila.ventasBotella || 0);
    return ea + entTotal - totalCopas - (fila.ventasBotella || 0) * (fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0);
}

function getEntradasBottles(insumoId) {
    const fila    = filasCaptura.find(f => f.insumoId === insumoId);
    const deFilas = fila ? (fila.entradas || []).reduce((s, e) => s + (parseFloat(e)||0), 0) : 0;
    const deLog   = (invActual?.entradasLog || [])
        .filter(e => e.insumoId === insumoId)
        .reduce((s, e) => s + (parseFloat(e.cantidad)||0), 0);
    return deFilas + deLog;
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
        el.textContent = total > 0 ? '+' + (total % 1 ? total.toFixed(1) : total) + ' bot' : '—';
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
    return getInventarios().filter(inv => {
        if (!inv.fecha) return false;
        const [y, m] = inv.fecha.split('-').map(Number);
        return y === anio && m === mes;
    });
}

// ── Gestión de vistas ─────────────────────────────────────────
const VISTAS = ['vistaLista', 'vistaForm', 'vistaCaptura', 'vistaEntradas'];
function mostrarVista(id) {
    VISTAS.forEach(v => {
        const el = document.getElementById(v);
        if (el) el.style.display = v === id ? 'block' : 'none';
    });
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
    const lista  = getInventarios();
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

function renderHistorial() {
    const cont = document.getElementById('historialContent');
    if (!cont) return;
    if (modoHistorial === 'mes') { cont.innerHTML = renderCalendario(); return; }
    const lista = [...getInventarios()].reverse();
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
                        onclick="abrirInventario('${inv.id}')">▶ Continuar</button>`;
                return `<tr>
                    <td style="color:var(--text-muted)">${new Date(inv.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}</td>
                    <td style="font-weight:500">${tipoIcon(inv.tipoInv)} ${inv.nombre||'Sin nombre'}</td>
                    <td style="color:var(--text-dim);font-size:11px">${inv.area||'—'}</td>
                    <td style="color:var(--text-muted)">${(inv.filas||[]).length}</td>
                    <td style="color:var(--accent);font-weight:500">$${(inv.capitalCosto||0).toFixed(0)}</td>
                    <td style="color:var(--green);font-weight:500">$${(inv.capitalCarta||0).toFixed(0)}</td>
                    <td style="color:${dif>=0?'var(--green)':'var(--red)'};font-weight:500">${dif>=0?'+':''}$${dif.toFixed(0)}</td>
                    <td><span class="pill ${inv.cerrado?'pill-green':'pill-amber'}">${inv.cerrado?'Cerrado':'Abierto'}</span></td>
                    <td style="text-align:right;white-space:nowrap">
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
            onclick="abrirInventario('${inv.id}')">▶ Continuar</button>`;
    return `<div class="hist-card ${inv.cerrado?'cerrado':''}">
        <div class="hist-card-icon">${tipoIcon(inv.tipoInv)}</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
            <div class="hist-card-nombre">${inv.nombre||'Sin nombre'}</div>
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
    const el   = document.getElementById('invFechaUltimo');
    const f    = _getUltimoInvFecha();
    if (!el) return;
    el.textContent = f
        ? new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' })
        : 'Sin inventarios previos';
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
            cocktailsVendidos: {}, cancelaciones: [], descuentos: [], entradasLog: [],
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
    const insumos = getInsumos(); // load ALL insumos (no active filter - user can see all)
    if (!insumos.length) { filasCaptura = []; return; }

    filasCaptura = insumos.map(ins => {
        const existe = (invActual.filas || []).find(f => f.insumoId === ins.id);
        if (existe) {
            if (!existe.entradas) existe.entradas = ['','','','',''];
            return existe;
        }

        const p      = (ins.presentaciones || [])[0];
        const catLow = (ins.categoria || '').toLowerCase();
        const tipo   = catLow.includes('cerveza') || catLow.includes('refresco') ||
                       catLow.includes('soda')    || catLow.includes('agua') ? 'pza' : 'copa';

        let copaML = COPA_STD.default;
        for (const [key, val] of Object.entries(COPA_STD)) {
            if (catLow.includes(key)) { copaML = val; break; }
        }
        if (ins.tamanoCopa) {
            const tc = parseFloat(ins.tamanoCopa) || 0;
            if (tc > 0) copaML = (ins.umTamanoCopa||'ML').toUpperCase()==='OZ' ? tc*OZ_ML : tc;
        }

        const pesoCristal = parseFloat(p?.pesoCristal) || 0;
        const contML = (() => {
            const cn = parseFloat(p?.contNeto) || 0;
            return (p?.umContenido||'ML').toUpperCase()==='LT' ? cn*1000 : cn;
        })();

        return {
            insumoId: ins.id,
            nombre:   ins.nombre + (ins.variedad ? ' '+ins.variedad : ''),
            categoria: ins.categoria  || '',
            subcategoria: ins.subcategoria || '',
            familia:  ins.familia    || '',
            tipo, copaML, contNeto: contML, pesoCristal,
            costoUnitario:  parseFloat(p?.costoUnitario) || parseFloat(p?.precio) || 0,
            precioCarta:    parseFloat(p?.precioCarta)   || 0,
            precioCartaBot: parseFloat(p?.precioCartaBot)|| 0,
            stockMin:       parseFloat(ins.stockMin)     || 0,
            existenciaAnterior: getExistenciaAnterior(ins.id),
            // Paso 1: existencias físicas
            cerradasBodega: 0, cerradasBarra: 0,
            pesos: ['','','',''],   // 4 botellas abiertas (kg)
            // Paso 2: entradas (hasta 5 por producto)
            entradas: ['','','','',''],
            // Paso 3: ventas directas
            ventasCopasDirectas: 0, ventasBotella: 0,
        };
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
    const steps  = document.getElementById('invSteps');

    if (esLev) {
        if (btnAnt) btnAnt.style.display = 'none';
        if (btnSig) btnSig.style.display = 'none';
        if (btnLev) { btnLev.style.display = 'inline-flex'; btnLev.disabled = !!(invActual?.cerrado); btnLev.textContent = invActual?.cerrado ? '✅ Guardado' : '✅ Guardar levantamiento'; }
        if (steps)  steps.style.display = 'none';
        const lbl = document.getElementById('stepLabel');
        if (lbl) lbl.textContent = 'Primer Levantamiento — Captura de existencias';
    } else {
        if (btnLev) btnLev.style.display = 'none';
        if (steps)  steps.style.display = '';
        if (btnAnt) btnAnt.style.display = pasoActual > 1 ? 'inline-flex' : 'none';
        if (btnSig) btnSig.style.display = pasoActual < 5 ? 'inline-flex' : 'none';
    }
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

function onBusqueda(val)     { busquedaCapt       = val; rerenderCaptura(); }
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
    const efUnit = fila.tipo === 'pza' ? 'pza' : 'bot';
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

    const filas = getFilasFiltradas(true); // true = aplica filtro registro
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

    return buildVistaSwitcherExist() + buildFiltroRegistroBar() + buildToolbar(true) + (noData || (
        modoListaCapt === 'galeria' ? renderStep1Galeria(filas) : renderStep1Lista(filas)
    ));
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
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Sin resultados para "${_existBusqueda}"</div>`;
        return;
    }
    cont.innerHTML = matches.map(f => {
        const reg = _esRegistrado(f);
        return `<button class="ent-chip ${_existInsumoId===f.insumoId?'active':''}"
            onclick="seleccionarProductoExist('${f.insumoId}')" style="position:relative">
            ${f.nombre}
            ${f.subcategoria?`<span style="font-size:10px;opacity:0.65;margin-left:4px">${f.subcategoria}</span>`:
              f.categoria?`<span style="font-size:10px;opacity:0.65;margin-left:4px">${f.categoria}</span>`:''}
            ${reg?'<span style="position:absolute;top:4px;right:6px;width:6px;height:6px;background:var(--green);border-radius:50%"></span>':''}
        </button>`;
    }).join('');
}

function seleccionarProductoExist(insumoId) {
    _existInsumoId = insumoId;
    renderChipsExist();
    renderCardExist();
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
                <input type="file" accept="image/*" capture="environment" style="display:none"
                    onchange="previewFotoExist('${fila.insumoId}',this)">
            </label>
            ${fila.fotoUrl ? `<img id="foto-preview-${fila.insumoId}" src="${fila.fotoUrl}"
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
    const metodo = fila.metodoCaptura || 'peso';
    const exist  = calcExistenciaBot(fila);
    const efUnit = fila.tipo === 'pza' ? 'pza' : 'bot';
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
                    <div style="font-weight:700;font-size:17px;color:var(--text)">${fila.nombre}</div>
                    <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">
                        ${fila.categoria?`<span class="inv-tag">${fila.categoria}</span>`:''}
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
        const efUnit = fila.tipo==='pza'?'pza':'bot';
        const metodo = fila.metodoCaptura || 'peso';
        const metIcon = metodo==='nivel'?'🌡️':metodo==='foto'?'📷':'⚖️';
        return `<div class="ent-log-fila" onclick="seleccionarProductoExist('${fila.insumoId}')"
            style="cursor:pointer">
            <span class="ent-log-nombre">${fila.nombre}</span>
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
        const eaUnit   = fila.tipo === 'pza' ? 'pza' : 'bot';
        const lts      = calcNetLiters(fila);
        const existBot = calcExistenciaBot(fila);
        const efUnit   = fila.tipo === 'pza' ? 'pza' : 'bot';
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
                    <input type="file" accept="image/*" capture="environment" style="display:none"
                        onchange="previewFotoExist('${fila.insumoId}',this)">
                </label>
                ${fila.fotoUrl ? `<img src="${fila.fotoUrl}" style="width:60px;height:40px;object-fit:cover;border-radius:4px;margin-top:4px">` : ''}
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
                <div class="inv-prod-name">${fila.nombre}</div>
                <div class="inv-prod-meta">
                    ${fila.categoria ? `<span class="inv-tag">${fila.categoria}</span>` : ''}
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
                <div class="inv-prod-name">${fila.nombre}</div>
                <div class="inv-prod-meta" style="margin-top:6px">
                    ${fila.categoria ? `<span class="inv-tag">${fila.categoria}</span>` : ''}
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
            </div>
            <div class="inv-item-card-bot">${(() => {
                const lt = calcNetLiters(fila);
                const eb = calcExistenciaBot(fila);
                const eu = fila.tipo==='pza'?'pza':'bot';
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
        const efUnit   = fila.tipo === 'pza' ? 'pza' : 'bot';
        const precio   = fila.costoUnitario || 0;
        const tipoSt   = fila.tipo === 'pza'
            ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
            : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';
        return `<tr class="inv-row">
            <td class="inv-td-prod">
                <div class="inv-prod-name">${fila.nombre}</div>
                <div class="inv-prod-meta">
                    ${fila.categoria ? `<span class="inv-tag">${fila.categoria}</span>` : ''}
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
                        <input type="number" class="inv-peso-input" value="${e||''}" placeholder="0" min="0" step="1"
                            oninput="updEntrada(${idx},${ei},this.value)">
                    </div>`).join('')}
                </div>
            </td>
            <td class="inv-td-ef" id="ent-tot-${idx}"
                style="color:${total>0?'var(--green)':'var(--text-dim)'}">
                ${total>0?'+'+(total%1?total.toFixed(1):total)+' bot':'—'}
            </td>
        </tr>`;
    }).join('');

    return `<div class="inv-table-wrap">
        <table class="inv-capture-table">
            <thead><tr>
                <th class="inv-th">Producto</th>
                <th class="inv-th inv-th-c" style="width:90px">Existencia</th>
                <th class="inv-th inv-th-c" style="width:80px;color:var(--text-dim)">$ Ref.</th>
                <th class="inv-th inv-th-c inv-th-pesos">Entradas — cantidad (bot / pzas)</th>
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
        const efUnit   = fila.tipo === 'pza' ? 'pza' : 'bot';
        const precio   = fila.costoUnitario || 0;
        const tipoSt   = fila.tipo === 'pza'
            ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
            : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';
        return `<div class="inv-item-card">
            <div class="inv-item-card-top">
                <div class="inv-prod-name">${fila.nombre}</div>
                <div class="inv-prod-meta" style="margin-top:6px">
                    ${fila.categoria ? `<span class="inv-tag">${fila.categoria}</span>` : ''}
                    <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                </div>
                <div style="margin-top:8px;font-size:11px;color:var(--text-dim)">
                    Exist: <span style="color:var(--text-muted);font-weight:600">${fmtBot(existBot)} ${efUnit}</span>
                    ${precio > 0 ? ` · <span style="color:var(--accent)">$${precio.toFixed(2)}/bot</span>` : ''}
                </div>
            </div>
            <div class="inv-item-card-body">
                <div class="inv-gal-label" style="margin-bottom:6px">Entradas (bot / pzas)</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px">
                    ${(fila.entradas||['','','','','']).map((e,ei)=>`
                    <div>
                        <div style="font-size:9px;color:var(--text-dim);text-align:center;margin-bottom:3px">E${ei+1}</div>
                        <input type="number" class="inv-pesos-grid-input" value="${e||''}" placeholder="0" min="0" step="1"
                            oninput="updEntrada(${idx},${ei},this.value)"
                            style="height:42px;font-size:16px;text-align:center;border:1px solid var(--border);
                                   border-radius:8px;background:var(--bg);color:var(--text);width:100%;
                                   font-family:'DM Sans',sans-serif;transition:border-color 0.15s;box-sizing:border-box">
                    </div>`).join('')}
                </div>
            </div>
            <div class="inv-item-card-bot">
                <span style="font-size:11px;color:var(--text-dim)">Total entradas</span>
                <span id="ent-tot-${idx}" style="font-weight:700;font-size:15px;color:${total>0?'var(--green)':'var(--text-dim)'}">
                    ${total>0?'+'+(total%1?total.toFixed(1):total)+' bot':'—'}
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
            <span>${e.fecha||'—'} · ${e.cantidad} bot · $${(e.costo||0).toFixed(2)} · ${e.notas||''}</span>
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
    return switcher + renderStep3Menu();
}

function renderStep3Insumos() {
    const filas    = filasCaptura;
    const b        = busquedaCapt.toLowerCase();
    const filtradas = filas.filter(f =>
        (!filtroFamActivo || f.familia === filtroFamActivo) &&
        (!filtroCatActiva || f.categoria === filtroCatActiva) &&
        (!b || f.nombre.toLowerCase().includes(b))
    );
    const rows = filtradas.map(fila => {
        const idx    = filasCaptura.indexOf(fila);
        const unidad = fila.tipo === 'pza' ? 'pza' : 'cop';
        const tipoSt = fila.tipo === 'pza'
            ? 'background:rgba(61,190,122,0.15);border-color:rgba(61,190,122,0.45);color:var(--green)'
            : 'background:rgba(245,200,66,0.12);border-color:rgba(245,200,66,0.45);color:var(--accent)';
        const esCopa = fila.tipo !== 'pza';
        return `<tr class="inv-row">
            <td class="inv-td-prod">
                <div class="inv-prod-name">${fila.nombre}</div>
                <div class="inv-prod-meta">
                    ${fila.categoria?`<span class="inv-tag">${fila.categoria}</span>`:''}
                    <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">📋 Ver</button>
                </div>
            </td>
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">${unidad}</div>
                <input type="number" class="inv-num-input" value="${fila.ventasCopasDirectas||0}" min="0" step="0.5"
                    oninput="updVentasDirectas(${idx},'ventasCopasDirectas',+this.value)">
            </td>
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">bot</div>
                <input type="number" class="inv-num-input" value="${fila.ventasBotella||0}" min="0" step="1"
                    oninput="updVentasDirectas(${idx},'ventasBotella',+this.value)">
            </td>
            ${esCopa ? `
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">cortesía</div>
                <input type="number" class="inv-num-input" style="border-color:rgba(155,141,232,.4)"
                    value="${fila.cortesiaCopas||0}" min="0" step="0.5"
                    oninput="updVentasDirectas(${idx},'cortesiaCopas',+this.value)">
            </td>
            <td class="inv-td-input" style="width:95px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">merma</div>
                <input type="number" class="inv-num-input" style="border-color:rgba(224,90,58,.35)"
                    value="${fila.mermaCopas||0}" min="0" step="0.5"
                    oninput="updVentasDirectas(${idx},'mermaCopas',+this.value)">
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
        el.textContent = nuevo;
        el.classList.toggle('active', nuevo > 0);
        const item = el.closest('.step3-menu-item');
        if (item) item.classList.toggle('has-cnt', nuevo > 0);
    }
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
        <span style="font-size:15px;font-weight:700;color:var(--green)">${totalItems} unidades</span>
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
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.nombre}</div>
                            ${ingStr?`<div style="font-size:10px;color:var(--text-dim);margin-top:2px;
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ingStr}</div>`:''}
                            ${p>0?`<div style="font-size:12px;color:var(--green);font-weight:600;margin-top:2px">$${p.toFixed(0)}</div>`:''}
                        </div>
                        <div class="step3-counter">
                            <button onclick="updCntMenu('${r.id}',-1)">−</button>
                            <span id="cnt-${r.id}" class="step3-cnt-val ${cnt>0?'active':''}">${cnt}</span>
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
    const matches = filasCaptura.filter(f => f.nombre.toLowerCase().includes(q));
    if (!matches.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Sin resultados para "${_ventasBusqueda}"</div>`;
        return;
    }
    cont.innerHTML = matches.map(f => {
        const tieneVentas = (f.ventasCopasDirectas||0)>0 || (f.ventasBotella||0)>0 || (f.cortesiaCopas||0)>0 || (f.mermaCopas||0)>0;
        return `<button class="ent-chip ${_ventasInsumoId===f.insumoId?'active':''}"
            onclick="seleccionarProductoVentas('${f.insumoId}')" style="position:relative">
            ${f.nombre}
            ${f.categoria?`<span style="font-size:10px;opacity:0.65;margin-left:4px">${f.categoria}</span>`:''}
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
                    <div style="font-weight:700;font-size:17px;color:var(--text)">${fila.nombre}</div>
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

function renderResumenVentas() {
    const cont = document.getElementById('ventasResumen');
    if (!cont) return;
    const conVentas = filasCaptura.filter(f =>
        (f.ventasCopasDirectas||0)>0 || (f.ventasBotella||0)>0 ||
        (f.cortesiaCopas||0)>0 || (f.mermaCopas||0)>0
    );
    const countEl = document.querySelector('#ventasResumen')?.previousElementSibling?.querySelector('span:last-child');
    if (!conVentas.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:20px 0">Sin ventas capturadas aún</div>`;
        return;
    }
    cont.innerHTML = conVentas.map(fila => {
        const unidad = fila.tipo==='pza'?'pza':'cop';
        const partes = [];
        if ((fila.ventasCopasDirectas||0)>0) partes.push(`${fila.ventasCopasDirectas} ${unidad}`);
        if ((fila.ventasBotella||0)>0)       partes.push(`${fila.ventasBotella} bot`);
        if ((fila.cortesiaCopas||0)>0)       partes.push(`${fila.cortesiaCopas} cortesía`);
        if ((fila.mermaCopas||0)>0)          partes.push(`${fila.mermaCopas} merma`);
        return `<div class="ent-log-fila" onclick="seleccionarProductoVentas('${fila.insumoId}')" style="cursor:pointer">
            <span class="ent-log-nombre">${fila.nombre}</span>
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
        `<option value="${f.insumoId}">${f.nombre}</option>`
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
                <td style="font-size:12px;font-weight:500">${c.nombreProducto||'—'}</td>
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
function renderStep5() {
    let capitalCosto=0, capitalCarta=0, difCostoTotal=0, conAlerta=0;
    filasCaptura.forEach(fila => {
        const exist = calcExistencia(fila);
        const cc    = costoCopa(fila);
        const dif   = calcDiferencia(fila);
        capitalCosto  += exist * cc;
        capitalCarta  += exist * (fila.precioCarta||0);
        difCostoTotal += dif * cc;
        const ref = calcExistenciaTeorica(fila);
        if (ref>0 && Math.abs(dif/ref)*100>25) conAlerta++;
    });
    if (invActual) invActual.diferenciaCosto = difCostoTotal;
    const colorDif = difCostoTotal>=0 ? 'var(--green)' : 'var(--red)';

    const numCancel       = (invActual?.cancelaciones||[]).length;
    const totalDescuentos = (invActual?.descuentos||[]).reduce((s,d)=>s+(parseFloat(d.monto)||0),0);

    const kpis = `<div class="wrap" style="padding-bottom:0">
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
            <button class="btn-vista" style="color:var(--accent);border-color:var(--accent)"
                onclick="verReporteDirectivo()">📄 Reporte directivo</button>
        </div>
        <div class="stats-grid" style="grid-template-columns:repeat(6,1fr)">
            <div class="stat-card"><div class="stat-label">Capital a costo</div><div class="stat-val">$${capitalCosto.toFixed(0)}</div></div>
            <div class="stat-card"><div class="stat-label">Capital a carta</div><div class="stat-val green">$${capitalCarta.toFixed(0)}</div></div>
            <div class="stat-card"><div class="stat-label">Diferencia total</div>
                <div class="stat-val" style="color:${colorDif}">${difCostoTotal>=0?'+':''}$${difCostoTotal.toFixed(2)}</div></div>
            <div class="stat-card"><div class="stat-label">Con alerta >25%</div>
                <div class="stat-val" style="color:${conAlerta>0?'var(--red)':'var(--green)'}">${conAlerta}</div></div>
            <div class="stat-card"><div class="stat-label">Cancelaciones POS</div>
                <div class="stat-val" style="color:${numCancel>0?'var(--accent)':'var(--text)'}">${numCancel}</div></div>
            <div class="stat-card"><div class="stat-label">Total descuentos</div>
                <div class="stat-val" style="color:${totalDescuentos>0?'var(--red)':'var(--text)'}">$${totalDescuentos.toFixed(2)}</div></div>
        </div>
    </div>`;

    // Split filas into copa-type (bebidas con botella y copa) and pza-type groups
    const gruposCopa = {};
    const gruposPza  = {};
    filasCaptura.forEach(f => {
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
            const entBotStr = entBot > 0 ? `+${entBot % 1 ? entBot.toFixed(1) : entBot} bot` : '—';
            const fisicoBot = copasBot > 0 ? (fisico/copasBot).toFixed(2) : fisico.toFixed(1);
            // Diferencia in copas, with sign and unit label
            const difStr    = `${dif>=0?'+':''}${dif.toFixed(1)} cop`;
            grpDif += difCosto;
            return `<tr>
                <td style="min-width:140px">
                    <div style="font-size:12px;font-weight:600">${fila.nombre}</div>
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
                    <div style="font-size:12px;font-weight:600">${fila.nombre}</div>
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

    const sinDatos = !tablasCopa && !tablasPza
        ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Sin productos capturados</div>'
        : '';

    return kpis + `<div style="padding:16px 0 24px">${sinDatos}${tablasCopa}${tablasPza}</div>`;
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
  <span style="color:#f5f0e8;font-size:14px;font-weight:700">📊 Reporte Directivo — ${inv.nombre || 'Inventario'}</span>
  <div style="display:flex;gap:8px">
    <button onclick="window.print()" style="padding:7px 18px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;background:#f5c842;color:#1a1916;border:none">🖨️ Imprimir / Exportar PDF</button>
    <button onclick="document.getElementById('rdOverlay').remove()" style="padding:7px 14px;border-radius:6px;cursor:pointer;font-size:12px;background:transparent;border:1px solid rgba(255,255,255,.3);color:#f5f0e8">✕ Cerrar</button>
  </div>
</div>

<!-- ═══════════════════════════════════ PÁGINA 1 — RESUMEN EJECUTIVO -->
<div class="rd-paper">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
    <div>
      <div class="rd-h1">${tipoIcon(inv.tipoInv)} ${inv.nombre || 'Inventario'}</div>
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
          <td style="font-weight:600">${a.f.nombre}<br><span style="font-size:9px;color:#aaa;font-weight:400">${a.f.categoria||''}</span></td>
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
    ${estancados.slice(0, 20).map(a => `<span style="font-size:10px;background:#f5f5f0;border:1px solid #e0e0d8;border-radius:4px;padding:2px 8px;color:#666">${a.f.nombre}</span>`).join('')}
    ${estancados.length > 20 ? `<span style="font-size:10px;color:#aaa;padding:2px 8px">+${estancados.length - 20} más…</span>` : ''}
  </div>
  ` : ''}

  <div class="rd-foot">Reporte Directivo · ${inv.negocio || ''} · ${fecha} · ETAAX Sistema de Inventarios</div>
</div>

<!-- ═══════════════════════════════════ PÁGINA 2 — DESGLOSE COMPLETO -->
<div class="rd-paper" style="margin-bottom:40px">

  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #1a1916">
    <span style="font-size:14px;font-weight:900;color:#1a1916">${inv.nombre || 'Inventario'} — Desglose por familia</span>
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
          <td style="font-weight:600">${a.f.nombre}</td>
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
          <td style="font-weight:600">${a.f.nombre}</td>
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
          <td style="font-weight:600;max-width:125px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.f.nombre}</td>
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
        <td style="font-weight:500">${c.nombreProducto||'—'}</td>
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
        || (f.ventasBotella || 0) > 0;
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
}

let _autoGuardarTimer = null;
function _autoGuardar() {
    if (!invActual) return;
    clearTimeout(_autoGuardarTimer);
    _autoGuardarTimer = setTimeout(function() {
        try { guardarInventario(); } catch(e) { console.warn('[autoGuardar]', e); return; }
        const ind = document.getElementById('autoGuardarInd');
        if (ind) {
            ind.textContent = '✓ Guardado';
            ind.style.opacity = '1';
            setTimeout(() => { ind.style.opacity = '0'; }, 1800);
        }
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
    _entLogInsumoCache = getInsumos(); // cache once to avoid repeated JSON parse on every keystroke
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
            ${ins.nombre}${ins.variedad ? ' <span style="color:var(--text-muted)">' + ins.variedad + '</span>' : ''}
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
    log.push({
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
    });
    setEntradasLog(log);

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
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Sin resultados para "${_entRapidaBusqueda}"</div>`;
        return;
    }
    cont.innerHTML = matches.map(f => `
        <button class="ent-chip ${_entRapidaInsumoId === f.insumoId ? 'active' : ''}"
            onclick="seleccionarProductoEntrada('${f.insumoId}')">
            ${f.nombre}
            ${f.categoria ? `<span style="font-size:10px;opacity:0.65;margin-left:4px">${f.categoria}</span>` : ''}
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
                    <div style="font-weight:700;font-size:17px;color:var(--text)">${fila.nombre}</div>
                    ${fila.categoria ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${fila.categoria}</div>` : ''}
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
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Cantidad (bot / pzas)</div>
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

function renderListadoEntradas() {
    const cont = document.getElementById('entLogList');
    if (!cont) return;
    // Use inventory-specific log when active, global log otherwise
    let log, useGlobal;
    if (invActual) {
        log = invActual.entradasLog || [];
        useGlobal = false;
    } else {
        log = [...getEntradasLog()].reverse();
        useGlobal = true;
    }
    const countEl = document.getElementById('entLogCount');
    if (countEl) countEl.textContent = log.length + ' registro' + (log.length !== 1 ? 's' : '');
    if (!log.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:24px 0">
            Sin entradas registradas</div>`;
        return;
    }
    const rows = useGlobal ? log : [...log].reverse();
    cont.innerHTML = rows.map((e, i) => {
        const color   = tipoEntradaColor(e.tipo);
        const nombre  = e.nombreProducto || e.nombre || '—';
        const delFn   = useGlobal
            ? `eliminarEntradaGlobal('${e.id}')`
            : `eliminarEntradaRapida(${i})`;
        return `<div class="ent-log-fila">
            <span class="ent-log-nombre">${nombre}</span>
            <span class="ent-log-badge" style="color:${color};background:${color}1a;border-color:${color}50">${tipoEntradaLabel(e.tipo)}</span>
            <span class="ent-log-fecha">${e.fecha || '—'}</span>
            <span class="ent-log-cant">+${(e.cantidad||0) % 1 ? (e.cantidad||0).toFixed(1) : (e.cantidad||0)} bot</span>
            <button class="ent-log-del" onclick="${delFn}"
                onmouseenter="this.classList.add('hover')" onmouseleave="this.classList.remove('hover')">🗑️</button>
        </div>`;
    }).join('');
}

function eliminarEntradaGlobal(id) {
    _pedirClaveAdmin('Eliminar entrada', function() {
        setEntradasLog(getEntradasLog().filter(e => e.id !== id));
        renderListadoEntradas();
    });
}

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
    cont.innerHTML = `
        <div class="ent-rapida-wrap">
            ${searchSection}
            <div>
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
                ${ins.foto ? `<img src="${ins.foto}" style="width:100%;height:100%;object-fit:cover">` : '📦'}
            </div>
            <div style="flex:1">
                <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;
                    color:var(--accent);margin-bottom:4px">
                    ${[ins.familia, ins.categoria, ins.subcategoria].filter(Boolean).join(' · ')}
                </div>
                <div style="font-size:20px;font-weight:600;color:var(--text);margin-bottom:3px">${ins.nombre}</div>
                <div style="font-size:12px;color:var(--text-muted)">
                    ${[ins.marca, ins.variedad, ins.maduracion].filter(Boolean).join(' · ')}
                </div>
                ${ins.empaque ? `<div style="font-size:11px;color:var(--text-dim);margin-top:3px">${ins.empaque}</div>` : ''}
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
function init() { _limpiarStorageEmergencia(); renderStats(); renderHistorial(); }
init();

// ── Bloqueo de navegación mientras haya un inventario abierto ──
let _pendingNavHref = null;

function _estaEnWizard() {
    return !!invActual && document.getElementById('vistaCaptura')?.style.display !== 'none';
}

function _cancelarSalirInv() {
    _pendingNavHref = null;
    document.getElementById('modalSalirInv').style.display = 'none';
}

function _confirmarSalirInv() {
    try { guardarInventario(); } catch(e) { console.warn('[confirmarSalirInv] guardar error:', e); }
    invActual = null;
    const href = _pendingNavHref;
    _pendingNavHref = null;
    const modal = document.getElementById('modalSalirInv');
    if (modal) modal.style.display = 'none';
    if (href) {
        window.location.href = href;
    } else {
        mostrarVista('vistaLista');
    }
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
