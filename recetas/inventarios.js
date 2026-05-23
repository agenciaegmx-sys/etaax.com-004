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

// ── Storage ───────────────────────────────────────────────────
function getInsumos()     { try { return JSON.parse(_skGet('insumos'))     || []; } catch { return []; } }
function getRecetas()     { try { return JSON.parse(_skGet('recetas'))     || []; } catch { return []; } }
function getInventarios() { try { return JSON.parse(_skGet('inventarios')) || []; } catch { return []; } }
function setInventarios(d){ localStorage.setItem(_sk('inventarios'), JSON.stringify(d)); }
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
const TIPOS_ICON = { bebidas:'🍸', alimentos:'🍽️', almacen:'📦', restaurante:'🏪', otro:'📋' };

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

function getCancelacionesCopas(insumoId) {
    return (invActual?.cancelaciones || [])
        .filter(c => c.insumoId === insumoId)
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
    const totalCopas  = ventasRec + ventasDir + cancelCopas;
    // entradas en copas (from log sum)
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

function getFilasFiltradas() {
    const b = busquedaCapt.toLowerCase();
    return filasCaptura.filter(f =>
        (!filtroFamActivo || f.familia === filtroFamActivo) &&
        (!filtroCatActiva || f.categoria === filtroCatActiva) &&
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
                        <button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px"
                            onclick="abrirInventario('${inv.id}')">📋 Abrir</button>
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
    return `<div class="hist-card ${inv.cerrado?'cerrado':''}" onclick="abrirInventario('${inv.id}')">
        <div class="hist-card-icon">${tipoIcon(inv.tipoInv)}</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
            <div class="hist-card-nombre">${inv.nombre||'Sin nombre'}</div>
            <span class="pill ${inv.cerrado?'pill-green':'pill-amber'}" style="flex-shrink:0;margin-left:8px">
                ${inv.cerrado?'Cerrado':'Abierto'}</span>
        </div>
        <div class="hist-card-meta">
            ${new Date(inv.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'})}
            ${inv.turno?' · '+inv.turno:''} ${inv.area?' · '+inv.area:''}
            ${inv.negocio?'<br>'+inv.negocio:''}
        </div>
        <div style="border-top:1px solid var(--border);padding-top:10px">
            <div class="hist-card-stat"><span>Capital costo</span><span style="color:var(--accent);font-weight:500">$${(inv.capitalCosto||0).toFixed(0)}</span></div>
            <div class="hist-card-stat"><span>Capital carta</span><span style="color:var(--green);font-weight:500">$${(inv.capitalCarta||0).toFixed(0)}</span></div>
            <div class="hist-card-stat"><span>Diferencia</span>
                <span style="color:${dif>=0?'var(--green)':'var(--red)'};font-weight:600">${dif>=0?'+':''}$${dif.toFixed(0)}</span></div>
            <div class="hist-card-stat"><span>Productos</span><span>${(inv.filas||[]).length}</span></div>
        </div>
        <div class="hist-card-actions" onclick="event.stopPropagation()">
            <button class="btn-vista" style="padding:5px 10px;font-size:11px;flex:1"
                onclick="abrirInventario('${inv.id}')">📋 Abrir</button>
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

function abrirInventario(id) {
    const inv = getInventarios().find(x => x.id === id);
    if (!inv) return;
    invActual = JSON.parse(JSON.stringify(inv));
    if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
    if (!invActual.cancelaciones)     invActual.cancelaciones     = [];
    if (!invActual.entradasLog)       invActual.entradasLog       = [];
    filasCaptura = invActual.filas || [];
    mostrarVista('vistaForm');
    poblarFormulario();
    document.getElementById('formModo').textContent   = invActual.cerrado ? 'Inventario cerrado' : 'Editando inventario';
    document.getElementById('formTitulo').textContent = invActual.nombre || 'Sin nombre';
    document.getElementById('btnIniciarInv').textContent = 'Continuar inventario →';
}

function poblarFormulario() {
    document.getElementById('invTipoInv').value = invActual.tipoInv || 'bebidas';
    document.getElementById('invNegocio').value = invActual.negocio || '';
    document.getElementById('invNombre').value  = invActual.nombre  || '';
    document.getElementById('invFecha').value   = invActual.fecha   || '';
    document.getElementById('invTurno').value   = invActual.turno   || 'cierre';
    document.getElementById('invArea').value    = invActual.area    || 'barra';
    document.getElementById('invNotas').value   = invActual.notas   || '';
}

function limpiarFormulario() {
    document.getElementById('invTipoInv').value = 'bebidas';
    document.getElementById('invNegocio').value = '';
    document.getElementById('invNombre').value  = '';
    document.getElementById('invFecha').value   = new Date().toISOString().slice(0,10);
    document.getElementById('invTurno').value   = 'cierre';
    document.getElementById('invArea').value    = 'barra';
    document.getElementById('invNotas').value   = '';
}

function iniciarInventario() {
    const esNuevo = !invActual;
    if (esNuevo) {
        invActual = {
            id: genId(), cerrado: false,
            cocktailsVendidos: {}, cancelaciones: [], entradasLog: [],
            filas: [], capitalCosto: 0, capitalCarta: 0, diferenciaCosto: 0
        };
    }
    invActual.tipoInv = document.getElementById('invTipoInv').value;
    invActual.negocio = document.getElementById('invNegocio').value.trim();
    invActual.nombre  = document.getElementById('invNombre').value.trim() ||
        'Inventario ' + new Date().toLocaleDateString('es-MX');
    invActual.fecha   = document.getElementById('invFecha').value || new Date().toISOString().slice(0,10);
    invActual.turno   = document.getElementById('invTurno').value;
    invActual.area    = document.getElementById('invArea').value;
    invActual.notas   = document.getElementById('invNotas').value;

    if (esNuevo || !filasCaptura.length) cargarProductosCaptura();

    pasoActual = 1;
    busquedaCapt = ''; filtroFamActivo = ''; filtroCatActiva = '';
    mostrarVista('vistaCaptura');
    document.getElementById('captTitulo').textContent = invActual.nombre;
    actualizarStepBar();
    actualizarNavBtns();
    renderStepContent();
}

function eliminarInventario(id) {
    if (!confirm('¿Eliminar este inventario?')) return;
    setInventarios(getInventarios().filter(x => x.id !== id));
    init();
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
const PASO_LABELS = ['','Existencias','Entradas','Ventas','Cancelaciones','Resultado'];

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
    const btnAnt = document.getElementById('btnPasoAnt');
    const btnSig = document.getElementById('btnPasoSig');
    const btnCer = document.getElementById('btnCerrar');
    if (btnAnt) btnAnt.style.display = pasoActual > 1 ? 'inline-flex' : 'none';
    if (btnSig) btnSig.style.display = pasoActual < 5 ? 'inline-flex' : 'none';
    if (btnCer) {
        btnCer.style.display  = pasoActual === 5 ? 'inline-flex' : 'none';
        btnCer.disabled       = !!(invActual?.cerrado);
        btnCer.textContent    = invActual?.cerrado ? '✅ Cerrado' : '✅ Cerrar';
    }
}

function renderStepContent() {
    const cont = document.getElementById('stepContent');
    if (!cont) return;
    const renders = [null, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5];
    cont.innerHTML = renders[pasoActual]();
    // Restore filter selects
    const ffF = document.getElementById('filtroFamStep');
    const ffC = document.getElementById('filtroCatStep');
    if (ffF) ffF.value = filtroFamActivo;
    if (ffC) ffC.value = filtroCatActiva;
    if (pasoActual === 2 && vistaEntradas2 === 'busqueda') initEntradaRapidaUI();
    if (pasoActual === 1 && vistaCapturaExist === 'busqueda') initExistBusquedaUI();
    if (pasoActual === 3 && vistaVentas === 'busqueda') initVentasBusquedaUI();
}

// ── Toolbar para steps 1 y 2 ──────────────────────────────────
function buildToolbar(conModo = true) {
    const fams = [...new Set(filasCaptura.map(f=>f.familia).filter(Boolean))].sort();
    const cats = [...new Set(filasCaptura.map(f=>f.categoria).filter(Boolean))].sort();
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
        ${conModo ? `<div class="vista-toggle" style="margin-left:auto">
            <button class="${modoListaCapt==='lista'?'active':''}" onclick="setModoCaptura('lista')">≡ Lista</button>
            <button class="${modoListaCapt==='galeria'?'active':''}" onclick="setModoCaptura('galeria')">⊞ Galería</button>
        </div>` : ''}
    </div>`;
}

function onBusqueda(val)  { busquedaCapt    = val; rerenderCaptura(); }
function onFiltroFam(val) { filtroFamActivo = val; rerenderCaptura(); }
function onFiltroCat(val) { filtroCatActiva = val; rerenderCaptura(); }
function setModoCaptura(m){ modoListaCapt   = m;   rerenderCaptura(); }

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
}

function updCaptura(idx, campo, val) { filasCaptura[idx][campo] = val; refreshFilaDisplay(idx); }
function updPeso(idx, pi, val)       { filasCaptura[idx].pesos[pi] = val; refreshFilaDisplay(idx); }

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
        const capturados = filasCaptura.filter(f =>
            (f.cerradasBodega || 0) + (f.cerradasBarra || 0) > 0 ||
            (f.metodoCaptura === 'nivel' && (f.nivelPct || 0) > 0) ||
            (f.metodoCaptura !== 'nivel' && (f.pesos || []).some(p => parseFloat(p) > 0))
        ).length;
        return buildVistaSwitcherExist() + `
            <div class="ent-rapida-wrap">
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Buscar producto</div>
                    <input type="text" id="existBuscador" class="ent-buscador"
                        placeholder="Escribe el nombre del producto…"
                        oninput="buscarInsumoExist(this.value)" autocomplete="off">
                    <div id="existChips" class="ent-chips"></div>
                </div>
                <div id="existCardWrap"></div>
                <div>
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                        <span style="font-size:11px;color:var(--text-dim);font-weight:500;text-transform:uppercase;letter-spacing:0.5px">Capturados</span>
                        <span style="font-size:13px;font-weight:700;color:var(--text)">${capturados} / ${filasCaptura.length} productos</span>
                    </div>
                    <div id="existResumen"></div>
                </div>
            </div>`;
    }

    const filas = getFilasFiltradas();
    const noData = !filasCaptura.length
        ? `<div class="empty-state" style="padding:60px">
            <div class="empty-icon">🗄️</div><div class="empty-title">Sin insumos en catálogo</div>
            <div class="empty-desc">Agrega insumos en Catálogo → Insumos</div></div>`
        : !filas.length
        ? `<div class="empty-state" style="padding:40px">
            <div class="empty-icon">🔍</div><div class="empty-title">Sin resultados</div>
            <div class="empty-desc">Cambia los filtros de búsqueda</div></div>` : null;

    return buildVistaSwitcherExist() + buildToolbar(true) + (noData || (
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
    const matches = filasCaptura.filter(f => f.nombre.toLowerCase().includes(q));
    if (!matches.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Sin resultados para "${_existBusqueda}"</div>`;
        return;
    }
    cont.innerHTML = matches.map(f => {
        const tieneData = (f.cerradasBodega||0)+(f.cerradasBarra||0) > 0 ||
            (f.metodoCaptura==='nivel' && (f.nivelPct||0)>0) ||
            (f.metodoCaptura!=='nivel' && (f.pesos||[]).some(p=>parseFloat(p)>0));
        return `<button class="ent-chip ${_existInsumoId===f.insumoId?'active':''}"
            onclick="seleccionarProductoExist('${f.insumoId}')" style="position:relative">
            ${f.nombre}
            ${f.categoria?`<span style="font-size:10px;opacity:0.65;margin-left:4px">${f.categoria}</span>`:''}
            ${tieneData?'<span style="position:absolute;top:4px;right:6px;width:6px;height:6px;background:var(--green);border-radius:50%"></span>':''}
        </button>`;
    }).join('');
}

function seleccionarProductoExist(insumoId) {
    _existInsumoId = insumoId;
    renderChipsExist();
    renderCardExist();
}

function limpiarSeleccionExist() {
    _existInsumoId = null;
    _existBusqueda = '';
    const inp = document.getElementById('existBuscador');
    if (inp) { inp.value = ''; inp.focus(); }
    renderChipsExist();
    renderCardExist();
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
        </div>`;
}

function renderResumenExist() {
    const cont = document.getElementById('existResumen');
    if (!cont) return;
    const capturados = filasCaptura.filter(f =>
        (f.cerradasBodega||0)+(f.cerradasBarra||0)>0 ||
        (f.metodoCaptura==='nivel'&&(f.nivelPct||0)>0) ||
        (f.metodoCaptura!=='nivel'&&(f.pesos||[]).some(p=>parseFloat(p)>0))
    );
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
        return `<tr class="inv-row">
            <td class="inv-td-prod">
                <div class="inv-prod-name">${fila.nombre}</div>
                <div class="inv-prod-meta">
                    ${fila.categoria?`<span class="inv-tag">${fila.categoria}</span>`:''}
                    <span class="inv-tag" style="${tipoSt}">${fila.tipo}</span>
                    <button class="btn-ver-prod" onclick="abrirFichaTecnica('${fila.insumoId}')">📋 Ver</button>
                </div>
            </td>
            <td class="inv-td-input" style="width:110px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">${unidad}</div>
                <input type="number" class="inv-num-input" value="${fila.ventasCopasDirectas||0}" min="0" step="0.5"
                    oninput="updVentasDirectas(${idx},'ventasCopasDirectas',+this.value)">
            </td>
            <td class="inv-td-input" style="width:110px">
                <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-bottom:3px">bot</div>
                <input type="number" class="inv-num-input" value="${fila.ventasBotella||0}" min="0" step="1"
                    oninput="updVentasDirectas(${idx},'ventasBotella',+this.value)">
            </td>
        </tr>`;
    }).join('');
    return buildToolbar(true) + `<div class="inv-table-wrap">
        <table class="inv-capture-table">
            <thead><tr>
                <th class="inv-th">Producto</th>
                <th class="inv-th inv-th-c" style="width:110px">Copas / Pzas</th>
                <th class="inv-th inv-th-c" style="width:110px">Botellas</th>
            </tr></thead>
            <tbody>${rows||'<tr><td colspan="3" style="text-align:center;color:var(--text-dim);padding:32px">Sin resultados</td></tr>'}</tbody>
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
        (f.ventasCopasDirectas||0) > 0 || (f.ventasBotella||0) > 0
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
        const tieneVentas = (f.ventasCopasDirectas||0)>0 || (f.ventasBotella||0)>0;
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
            <div style="display:flex;gap:16px;flex-wrap:wrap">
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">${unidad} vendidas</div>
                    <input type="number" id="venta-copas-${idx}" class="inv-num-input"
                        style="width:110px" value="${fila.ventasCopasDirectas||0}" min="0" step="0.5"
                        oninput="updVentasDirectas(${idx},'ventasCopasDirectas',+this.value);renderResumenVentas()">
                </div>
                <div>
                    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px">Botellas vendidas</div>
                    <input type="number" id="venta-bot-${idx}" class="inv-num-input"
                        style="width:110px" value="${fila.ventasBotella||0}" min="0" step="1"
                        oninput="updVentasDirectas(${idx},'ventasBotella',+this.value);renderResumenVentas()">
                </div>
            </div>
            ${fila.costoUnitario ? `<div style="margin-top:12px;font-size:11px;color:var(--text-dim)">
                Costo referencia: <span style="color:var(--accent)">$${(fila.costoUnitario).toFixed(2)}/bot</span>
            </div>` : ''}
        </div>`;
}

function renderResumenVentas() {
    const cont = document.getElementById('ventasResumen');
    if (!cont) return;
    const conVentas = filasCaptura.filter(f => (f.ventasCopasDirectas||0)>0 || (f.ventasBotella||0)>0);
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
function updVentasDirectas(idx, campo, val) { filasCaptura[idx][campo] = val; }

// ═══════════════════════════════════════════════════════════════
// PASO 4 — Cancelaciones y descuentos
// ═══════════════════════════════════════════════════════════════
function renderStep4() {
    const cancelaciones = invActual?.cancelaciones || [];
    const opsProd = filasCaptura.map(f=>`<option value="${f.insumoId}">${f.nombre}</option>`).join('');

    const tablaReg = cancelaciones.length ? `<div class="tabla-wrap"><table>
        <thead><tr>
            <th>Producto</th><th>Tipo</th><th style="text-align:center">Copas</th>
            <th style="text-align:right">Importe</th><th>Motivo</th><th>Responsable</th><th></th>
        </tr></thead>
        <tbody>${cancelaciones.map((c,i)=>`<tr>
            <td style="font-size:12px;font-weight:500">${c.nombreProducto||c.insumoId}</td>
            <td><span class="pill pill-amber" style="font-size:10px">${c.tipo}</span></td>
            <td style="text-align:center">${c.cantidad}</td>
            <td style="text-align:right;color:var(--accent)">$${(c.importe||0).toFixed(2)}</td>
            <td style="color:var(--text-dim)">${c.motivo||'—'}</td>
            <td style="color:var(--text-dim)">${c.responsable||'—'}</td>
            <td style="text-align:right">
                <button class="btn-vista" style="padding:3px 8px;font-size:10px;color:var(--red);border-color:var(--red)"
                    onclick="eliminarCancelacion(${i})">🗑️</button>
            </td>
        </tr>`).join('')}</tbody>
    </table></div>` : `<div class="empty-state" style="padding:40px">
        <div class="empty-icon">📋</div>
        <div class="empty-title">Sin registros</div>
        <div class="empty-desc">Agrega cancelaciones manualmente o pega desde Excel</div>
    </div>`;

    return `
    <!-- Sección de carga: paste / CSV -->
    <div class="card" style="max-width:none;margin:16px 16px 0">
        <div class="card-header"><h2>📥 Importar datos</h2></div>
        <div class="card-body">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">
                Pega datos desde Excel (Tab-separado) o carga un CSV.<br>
                Columnas: <strong>Producto · Tipo · Copas · Importe · Motivo · Responsable</strong>
            </div>
            <textarea id="cancelPaste" rows="5"
                style="width:100%;font-size:12px;font-family:monospace;border:1px solid var(--border);
                background:var(--bg);color:var(--text);border-radius:8px;padding:10px;box-sizing:border-box"
                placeholder="Pega aquí los datos copiados de Excel...&#10;Ej: Grey Goose Vodka	cancelacion	2	150	Cliente rechazó	Juan"></textarea>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
                <button class="btn-vista" style="color:var(--accent);border-color:var(--accent)"
                    onclick="procesarPaste()">⬆️ Procesar pegado</button>
                <label class="btn-vista" style="cursor:pointer">
                    📂 Cargar CSV
                    <input type="file" accept=".csv,.txt" style="display:none" onchange="cargarCSV(event)">
                </label>
                <button class="btn-vista" onclick="descargarPlantillaCSV()">⬇️ Plantilla CSV</button>
            </div>
        </div>
    </div>

    <!-- Formulario manual -->
    <div class="cancel-toolbar">
        <div class="cancel-field">
            <label>Producto</label>
            <select id="cancelProd" style="min-width:180px">${opsProd}</select>
        </div>
        <div class="cancel-field">
            <label>Tipo</label>
            <select id="cancelTipo">
                <option value="cancelacion">Cancelación</option>
                <option value="descuento">Descuento</option>
                <option value="cortesia">Cortesía</option>
                <option value="derrame">Derrame</option>
                <option value="otro">Otro</option>
            </select>
        </div>
        <div class="cancel-field">
            <label>Copas</label>
            <input type="number" id="cancelCantidad" style="width:80px" placeholder="0" min="0" step="0.5">
        </div>
        <div class="cancel-field">
            <label>Importe $</label>
            <input type="number" id="cancelImporte" style="width:90px" placeholder="0.00" min="0" step="0.01">
        </div>
        <div class="cancel-field">
            <label>Motivo</label>
            <input type="text" id="cancelMotivo" style="width:160px" placeholder="Ej. Cliente rechazó pedido">
        </div>
        <div class="cancel-field">
            <label>Responsable</label>
            <input type="text" id="cancelResp" style="width:110px" placeholder="Nombre">
        </div>
        <div style="display:flex;align-items:flex-end">
            <button class="btn-vista" style="color:var(--green);border-color:var(--green);padding:7px 16px"
                onclick="agregarCancelacion()">+ Agregar</button>
        </div>
    </div>

    <!-- Tabla de registros -->
    <div class="card" style="max-width:none;margin:0 16px 24px">
        <div class="card-header">
            <h2>Registros de cancelaciones y descuentos</h2>
            <span class="pill ${cancelaciones.length?'pill-amber':''}">
                ${cancelaciones.length} registro${cancelaciones.length!==1?'s':''}
            </span>
        </div>
        <div class="card-body" style="padding:0">${tablaReg}</div>
    </div>`;
}

function procesarPaste() {
    const text = document.getElementById('cancelPaste')?.value.trim();
    if (!text) return;
    const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
    let added = 0;
    lines.forEach(line => {
        const cols = line.includes('\t') ? line.split('\t') : line.split(',');
        if (cols.length < 3) return;
        const [nombreProd, tipo, cantStr, importeStr, motivo, responsable] = cols.map(c=>c.trim().replace(/^"|"$/g,''));
        if (!nombreProd || nombreProd.toLowerCase() === 'producto') return; // skip header
        const cantidad = parseFloat(cantStr) || 0;
        if (cantidad <= 0) return;
        // fuzzy match product name
        const fila = filasCaptura.find(f =>
            f.nombre.toLowerCase().includes(nombreProd.toLowerCase()) ||
            nombreProd.toLowerCase().includes(f.nombre.toLowerCase().split(' ')[0].toLowerCase())
        );
        if (!invActual.cancelaciones) invActual.cancelaciones = [];
        invActual.cancelaciones.push({
            insumoId: fila?.insumoId || nombreProd,
            nombreProducto: fila?.nombre || nombreProd,
            tipo: tipo || 'cancelacion',
            cantidad, importe: parseFloat(importeStr)||0,
            motivo: motivo||'', responsable: responsable||''
        });
        added++;
    });
    if (added > 0) {
        const ta = document.getElementById('cancelPaste');
        if (ta) ta.value = '';
        renderStepContent();
        alert(`✅ ${added} registro(s) importados correctamente.`);
    } else {
        alert('No se encontraron datos válidos.\nVerifica el formato: Producto · Tipo · Copas · Importe · Motivo · Responsable');
    }
}

function cargarCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const ta = document.getElementById('cancelPaste');
        if (ta) ta.value = e.target.result;
        procesarPaste();
    };
    reader.readAsText(file);
    event.target.value = ''; // reset for re-upload
}

function descargarPlantillaCSV() {
    const content = 'Producto,Tipo,Copas,Importe,Motivo,Responsable\nGrey Goose Vodka,cancelacion,2,150,Cliente rechazó pedido,Juan García\nJack Daniel\'s,cortesia,1,80,Mesa VIP,María López';
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'plantilla_cancelaciones.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

function agregarCancelacion() {
    const insumoId = document.getElementById('cancelProd')?.value;
    const fila     = filasCaptura.find(f=>f.insumoId===insumoId);
    const tipo     = document.getElementById('cancelTipo')?.value || 'cancelacion';
    const cantidad = parseFloat(document.getElementById('cancelCantidad')?.value) || 0;
    const importe  = parseFloat(document.getElementById('cancelImporte')?.value)  || 0;
    const motivo   = document.getElementById('cancelMotivo')?.value.trim() || '';
    const resp     = document.getElementById('cancelResp')?.value.trim()   || '';
    if (!insumoId || cantidad <= 0) { alert('Selecciona un producto e indica la cantidad en copas.'); return; }
    if (!invActual.cancelaciones) invActual.cancelaciones = [];
    invActual.cancelaciones.push({ insumoId, nombreProducto: fila?.nombre||insumoId, tipo, cantidad, importe, motivo, responsable: resp });
    renderStepContent();
}

function eliminarCancelacion(idx) {
    if (invActual?.cancelaciones) { invActual.cancelaciones.splice(idx,1); renderStepContent(); }
}

// ═══════════════════════════════════════════════════════════════
// PASO 5 — Resultado
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

    const kpis = `<div class="wrap" style="padding-bottom:0">
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
            <button class="btn-vista" style="color:var(--accent);border-color:var(--accent)"
                onclick="verReporteDirectivo()">📄 Reporte directivo</button>
        </div>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-label">Capital a costo</div><div class="stat-val">$${capitalCosto.toFixed(0)}</div></div>
            <div class="stat-card"><div class="stat-label">Capital a carta</div><div class="stat-val green">$${capitalCarta.toFixed(0)}</div></div>
            <div class="stat-card"><div class="stat-label">Diferencia total</div>
                <div class="stat-val" style="color:${colorDif}">${difCostoTotal>=0?'+':''}$${difCostoTotal.toFixed(2)}</div></div>
            <div class="stat-card"><div class="stat-label">Con alerta >25%</div>
                <div class="stat-val" style="color:${conAlerta>0?'var(--red)':'var(--green)'}">${conAlerta}</div></div>
        </div>
    </div>`;

    const grupos = {};
    filasCaptura.forEach(f => {
        const g = f.familia || f.categoria || 'Otros';
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push(f);
    });

    const tablas = Object.entries(grupos).map(([grp,items]) => {
        let grpDif = 0;
        const rows = items.map(fila => {
            const ea        = parseFloat(fila.existenciaAnterior)||0;
            const copasBot  = fila.contNeto>0&&fila.copaML>0 ? fila.contNeto/fila.copaML : 0;
            const entCopas  = getEntradasCopas(fila);
            const ventas    = calcVentasCopasRecetas(fila.insumoId,fila.copaML)
                            + (fila.ventasCopasDirectas||0)
                            + (fila.tipo==='pza'?0:(fila.ventasBotella||0)*copasBot);
            const cancelCop = getCancelacionesCopas(fila.insumoId);
            const teorico   = calcExistenciaTeorica(fila);
            const fisico    = calcExistencia(fila);
            const dif       = fisico - teorico;
            const cc        = costoCopa(fila);
            const difCosto  = dif * cc;
            const ref       = teorico>0?teorico:fisico;
            const color     = semaforo(dif,ref);
            const pctVal    = ref>0 ? (dif/ref*100) : null;
            const pctStr    = pctVal!==null ? (pctVal>=0?'+':'')+pctVal.toFixed(1)+'%' : '—';
            const unidad    = fila.tipo==='pza'?'pza':'cop';
            grpDif += difCosto;
            return `<tr>
                <td><div style="font-size:12px;font-weight:500">${fila.nombre}</div>
                    <div style="font-size:10px;color:var(--text-dim)">${fila.categoria||''}</div></td>
                <td style="text-align:center">${ea.toFixed(1)}</td>
                <td style="text-align:center;color:var(--green)">${entCopas.toFixed(1)}</td>
                <td style="text-align:center;color:var(--accent)">${ventas.toFixed(1)}</td>
                <td style="text-align:center;color:var(--text-muted)">${cancelCop>0?cancelCop.toFixed(1):'—'}</td>
                <td style="text-align:center">${teorico.toFixed(1)} ${unidad}</td>
                <td style="text-align:center;font-weight:600">${fisico.toFixed(1)} ${unidad}</td>
                <td style="text-align:center;font-weight:700;color:${color}">${dif>=0?'+':''}${dif.toFixed(1)}</td>
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
                    <th style="text-align:center;width:60px">Exist. ant.</th>
                    <th style="text-align:center;width:65px">Entradas</th>
                    <th style="text-align:center;width:65px">Ventas</th>
                    <th style="text-align:center;width:70px">Cancelac.</th>
                    <th style="text-align:center;width:80px">Teórico</th>
                    <th style="text-align:center;width:80px">Físico</th>
                    <th style="text-align:center;width:75px">Varianza</th>
                    <th style="text-align:center;width:55px">%</th>
                    <th style="text-align:right;width:85px">Dif. $</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table></div></div>
        </div>`;
    }).join('');

    return kpis + `<div style="padding:16px 0 24px">${tablas||'<div style="text-align:center;padding:40px;color:var(--text-dim)">Sin productos capturados</div>'}</div>`;
}

// ── Reporte directivo ─────────────────────────────────────────
function verReporteDirectivo() {
    if (!invActual) return;
    let capitalCosto=0, capitalCarta=0, difTotal=0;
    filasCaptura.forEach(f => {
        const e=calcExistencia(f), cc=costoCopa(f), d=calcDiferencia(f);
        capitalCosto+=e*cc; capitalCarta+=e*(f.precioCarta||0); difTotal+=d*cc;
    });
    const grupos={};
    filasCaptura.forEach(f=>{const g=f.familia||f.categoria||'Otros';if(!grupos[g])grupos[g]=[];grupos[g].push(f);});
    const inv = invActual;
    const fecha = new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

    const tablasHtml = Object.entries(grupos).map(([grp,items])=>{
        let gDif=0;
        const rows=items.map(f=>{
            const e=calcExistencia(f),t=calcExistenciaTeorica(f),d=e-t,cc=costoCopa(f),dc=d*cc;
            const pct=t>0?(d/t*100):0; gDif+=dc;
            const col=Math.abs(pct)>25?(pct<0?'#c0392b':'#1a7a4a'):'#555';
            const u=f.tipo==='pza'?'pza':'cop';
            return `<tr><td>${f.nombre}</td><td style="text-align:center">${e.toFixed(1)} ${u}</td>
                <td style="text-align:center">${t.toFixed(1)} ${u}</td>
                <td style="text-align:center;color:${col};font-weight:600">${d>=0?'+':''}${d.toFixed(1)}</td>
                <td style="text-align:center;color:${col}">${pct.toFixed(1)}%</td>
                <td style="text-align:right">$${(e*cc).toFixed(2)}</td>
                <td style="text-align:right;color:${col};font-weight:600">${dc>=0?'+':''}$${dc.toFixed(2)}</td></tr>`;
        }).join('');
        const gc=gDif>=0?'#1a7a4a':'#c0392b';
        return `<h2 style="font-size:13px;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #1a1916">
                ${grp} <span style="font-size:11px;color:${gc}">${gDif>=0?'+':''}$${gDif.toFixed(2)}</span></h2>
            <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px">
                <thead><tr style="background:#f5f5f0">
                    <th style="padding:5px 8px;text-align:left;border-bottom:2px solid #ddd">Producto</th>
                    <th style="padding:5px 8px;text-align:center;border-bottom:2px solid #ddd">Físico</th>
                    <th style="padding:5px 8px;text-align:center;border-bottom:2px solid #ddd">Teórico</th>
                    <th style="padding:5px 8px;text-align:center;border-bottom:2px solid #ddd">Varianza</th>
                    <th style="padding:5px 8px;text-align:center;border-bottom:2px solid #ddd">%</th>
                    <th style="padding:5px 8px;text-align:right;border-bottom:2px solid #ddd">Capital</th>
                    <th style="padding:5px 8px;text-align:right;border-bottom:2px solid #ddd">Dif. $</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }).join('');

    const cancelHtml = (inv.cancelaciones||[]).length ? `
        <h2 style="font-size:13px;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #1a1916">Cancelaciones y descuentos</h2>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#f5f5f0">
                <th style="padding:5px 8px;text-align:left;border-bottom:2px solid #ddd">Producto</th>
                <th style="padding:5px 8px;text-align:left;border-bottom:2px solid #ddd">Tipo</th>
                <th style="padding:5px 8px;text-align:center;border-bottom:2px solid #ddd">Copas</th>
                <th style="padding:5px 8px;text-align:right;border-bottom:2px solid #ddd">Importe</th>
                <th style="padding:5px 8px;border-bottom:2px solid #ddd">Motivo</th>
            </tr></thead>
            <tbody>${(inv.cancelaciones||[]).map(c=>`<tr>
                <td style="padding:4px 8px;border-bottom:1px solid #eee">${c.nombreProducto||c.insumoId}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee">${c.tipo}</td>
                <td style="padding:4px 8px;text-align:center;border-bottom:1px solid #eee">${c.cantidad}</td>
                <td style="padding:4px 8px;text-align:right;border-bottom:1px solid #eee">$${(c.importe||0).toFixed(2)}</td>
                <td style="padding:4px 8px;border-bottom:1px solid #eee">${c.motivo||'—'}</td>
            </tr>`).join('')}</tbody>
        </table>` : '';

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Reporte — ${inv.nombre}</title>
    <style>body{font-family:Arial,sans-serif;font-size:12px;color:#1a1916;margin:0;padding:32px}
    @media print{.no-print{display:none!important}}</style></head>
    <body>
    <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #1a1916">
        <strong style="font-size:16px">Reporte Directivo</strong>
        <div style="display:flex;gap:8px">
            <button onclick="window.print()" style="padding:7px 16px;border:1px solid #1a1916;border-radius:6px;cursor:pointer;font-size:12px">🖨️ Imprimir</button>
            <button onclick="window.close()" style="padding:7px 16px;border:1px solid #ccc;border-radius:6px;cursor:pointer;font-size:12px">✕ Cerrar</button>
        </div>
    </div>
    <div style="font-size:22px;font-weight:900;margin-bottom:4px">${tipoIcon(inv.tipoInv)} ${inv.nombre||'Inventario'}</div>
    <div style="font-size:11px;color:#666;margin-bottom:20px">
        ${inv.negocio?inv.negocio+' · ':''}
        ${new Date(inv.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'})}
        ${inv.turno?' · '+inv.turno:''} ${inv.area?' · '+inv.area:''}
        ${inv.notas?' · '+inv.notas:''}
        ${inv.cerrado?' · <strong>INVENTARIO CERRADO</strong>':' · BORRADOR'}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
        <div style="border:1px solid #ddd;border-radius:8px;padding:14px">
            <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px">Capital a costo</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px">$${capitalCosto.toFixed(0)}</div>
        </div>
        <div style="border:1px solid #ddd;border-radius:8px;padding:14px">
            <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px">Capital a carta</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px;color:#1a7a4a">$${capitalCarta.toFixed(0)}</div>
        </div>
        <div style="border:1px solid #ddd;border-radius:8px;padding:14px;border-left:4px solid ${difTotal>=0?'#1a7a4a':'#c0392b'}">
            <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px">Diferencia total</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px;color:${difTotal>=0?'#1a7a4a':'#c0392b'}">${difTotal>=0?'+':''}$${difTotal.toFixed(2)}</div>
        </div>
    </div>
    ${tablasHtml}
    ${cancelHtml}
    <div style="margin-top:30px;padding-top:12px;border-top:1px solid #ddd;font-size:10px;color:#999">
        Generado el ${fecha} · ETAAX Sistema de Inventarios
    </div>
    <script>setTimeout(()=>window.print(),400)<\/script>
    </body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
    else { alert('Permite ventanas emergentes para ver el reporte.'); }
}

// ═══════════════════════════════════════════════════════════════
// GUARDAR / CERRAR
// ═══════════════════════════════════════════════════════════════
function guardarInventario() {
    if (!invActual) return;
    invActual.filas = filasCaptura.map(f=>({...f, existenciaFisica: calcExistencia(f)}));
    const lista = getInventarios();
    const idx   = lista.findIndex(x=>x.id===invActual.id);
    if (idx>=0) lista[idx]=invActual; else lista.push(invActual);
    setInventarios(lista);
    alert('✅ Inventario guardado');
}

function cerrarInventario() {
    if (!invActual) return;
    if (invActual.cerrado) { alert('Este inventario ya está cerrado.'); return; }
    if (!confirm('¿Cerrar este inventario? No podrás modificarlo después.')) return;
    invActual.cerrado = true;
    invActual.filas   = filasCaptura.map(f=>({...f, existenciaFisica: calcExistencia(f)}));
    const lista = getInventarios();
    const idx   = lista.findIndex(x=>x.id===invActual.id);
    if (idx>=0) lista[idx]=invActual; else lista.push(invActual);
    setInventarios(lista);
    actualizarNavBtns();
    alert('✅ Inventario cerrado. La existencia física queda como punto de partida del siguiente.');
}

function eliminarInventario(id) {
    if (!confirm('¿Eliminar este inventario?')) return;
    setInventarios(getInventarios().filter(x=>x.id!==id));
    init();
}

// ═══════════════════════════════════════════════════════════════
// VISTA ENTRADAS — registro rápido de entradas
// ═══════════════════════════════════════════════════════════════
function abrirRegistroEntradas() {
    const lista   = getInventarios();
    const abierto = [...lista].reverse().find(x => !x.cerrado);
    if (!abierto) {
        alert('No hay inventarios abiertos.\nCrea un nuevo inventario primero.');
        return;
    }
    invActual = JSON.parse(JSON.stringify(abierto));
    if (!invActual.cocktailsVendidos) invActual.cocktailsVendidos = {};
    if (!invActual.cancelaciones)     invActual.cancelaciones     = [];
    if (!invActual.entradasLog)       invActual.entradasLog       = [];

    if ((invActual.filas || []).length) {
        filasCaptura = invActual.filas.map(f => ({...f, entradas: f.entradas || ['','','','','']}));
    } else {
        cargarProductosCaptura();
    }
    busquedaCapt = ''; filtroFamActivo = ''; filtroCatActiva = '';
    _entRapidaInsumoId = null; _entRapidaBusqueda = '';
    mostrarVista('vistaEntradas');
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
    if (!invActual?.entradasLog) return;
    invActual.entradasLog.splice(idx, 1);
    guardarEntradas();
    renderFormEntrada();
    renderListadoEntradas();
    renderChipsEntrada();
}

function renderListadoEntradas() {
    const cont = document.getElementById('entLogList');
    if (!cont) return;
    const log = invActual?.entradasLog || [];
    const countEl = document.getElementById('entLogCount');
    if (countEl) countEl.textContent = log.length + ' registro' + (log.length !== 1 ? 's' : '');
    if (!log.length) {
        cont.innerHTML = `<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:24px 0">
            Sin entradas registradas en este período</div>`;
        return;
    }
    cont.innerHTML = [...log].map((e, i) => {
        const color = tipoEntradaColor(e.tipo);
        return `<div class="ent-log-fila">
            <span class="ent-log-nombre">${e.nombreProducto}</span>
            <span class="ent-log-badge" style="color:${color};background:${color}1a;border-color:${color}50">${tipoEntradaLabel(e.tipo)}</span>
            <span class="ent-log-fecha">${e.fecha || '—'}</span>
            <span class="ent-log-cant">+${e.cantidad % 1 ? e.cantidad.toFixed(1) : e.cantidad} bot</span>
            <button class="ent-log-del" onclick="eliminarEntradaRapida(${i})"
                onmouseenter="this.classList.add('hover')" onmouseleave="this.classList.remove('hover')">🗑️</button>
        </div>`;
    }).reverse().join('');
}

function renderVistaEntradas() {
    const cont = document.getElementById('entContent');
    if (!cont) return;

    if (!invActual) {
        cont.innerHTML = `<div class="empty-state" style="padding:60px">
            <div class="empty-icon">📭</div>
            <div class="empty-title">Sin inventario activo</div>
            <div class="empty-desc">Crea un inventario primero desde la pantalla principal</div>
        </div>`;
        return;
    }

    const tituloEl  = document.getElementById('entTitulo');
    const periodoEl = document.getElementById('entPeriodo');
    if (tituloEl)  tituloEl.textContent = invActual.nombre || 'Registro de entradas';
    if (periodoEl) {
        const fecha = new Date(invActual.fecha + 'T12:00:00')
            .toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' });
        periodoEl.textContent = fecha
            + (invActual.turno ? ' · ' + invActual.turno : '')
            + (invActual.area  ? ' · ' + invActual.area  : '');
    }

    cont.innerHTML = `
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
                    <span id="entLogCount" style="font-size:13px;font-weight:700;color:var(--text)">${(invActual.entradasLog||[]).length} registro${(invActual.entradasLog||[]).length !== 1 ? 's' : ''}</span>
                </div>
                <div id="entLogList"></div>
            </div>
        </div>`;

    initEntradaRapidaUI();
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
    localStorage.setItem(_invSk('insumos'), JSON.stringify(lista));
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
function init() { renderStats(); renderHistorial(); }
init();
