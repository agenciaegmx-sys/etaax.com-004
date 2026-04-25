/* ============================================================
   ETAAX - Inventarios
   inventarios.js · v1 — Conectado a BD de insumos
   ============================================================ */

// ── LocalStorage ─────────────────────────────────────────────
function getInsumos() {
    try { return JSON.parse(localStorage.getItem('etaax_insumos')) || []; }
    catch { return []; }
}
function getInventarios() {
    try { return JSON.parse(localStorage.getItem('etaax_inventarios')) || []; }
    catch { return []; }
}
function setInventarios(data) {
    localStorage.setItem('etaax_inventarios', JSON.stringify(data));
}
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2,5);
}

// ── Estado actual ─────────────────────────────────────────────
let invActual    = null;  // inventario en edición
let filasCaptura = [];    // filas de captura del inventario activo

// ── Constantes ───────────────────────────────────────────────
const OZ_ML = 29.5735;
// Copa estándar por categoría (ML)
const COPA_STD = {
    'destilados': 44.36, 'licores': 29.57, 'vinos': 147.87,
    'espumosos': 88.72,  'cervezas': 355,  'default': 44.36
};

// ── Stats vista lista ─────────────────────────────────────────
function renderStats() {
    const lista  = getInventarios();
    const ultimo = lista[lista.length - 1];

    document.getElementById('statInvs').textContent   = lista.length;
    document.getElementById('statUltimo').textContent = ultimo
        ? new Date(ultimo.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short'})
        : '—';

    if (ultimo) {
        const capitalStr = ultimo.capitalCosto > 0
            ? '$'+ultimo.capitalCosto.toFixed(0) : '—';
        document.getElementById('statCapital').textContent = capitalStr;
        const difStr = ultimo.diferenciaCosto !== undefined
            ? (ultimo.diferenciaCosto >= 0 ? '+' : '') + '$'+ultimo.diferenciaCosto.toFixed(0)
            : '—';
        const difEl = document.getElementById('statDif');
        difEl.textContent = difStr;
        difEl.style.color = ultimo.diferenciaCosto >= 0
            ? 'var(--green)' : 'var(--red)';
    } else {
        document.getElementById('statCapital').textContent = '$0';
        document.getElementById('statDif').textContent     = '—';
    }
}

// ── Tabla historial ───────────────────────────────────────────
function renderHistorial() {
    const lista  = getInventarios();
    const tbody  = document.getElementById('tbodyInvs');
    const empty  = document.getElementById('emptyInvs');

    if (!lista.length) {
        tbody.innerHTML    = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = [...lista].reverse().map(inv => {
        const dif = inv.diferenciaCosto || 0;
        return `<tr>
            <td style="color:var(--text-muted)">${new Date(inv.fecha+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}</td>
            <td style="font-weight:500">${inv.nombre||'Sin nombre'}</td>
            <td style="color:var(--text-muted)">${(inv.filas||[]).length} productos</td>
            <td style="color:var(--accent);font-weight:500">$${(inv.capitalCosto||0).toFixed(2)}</td>
            <td style="color:var(--green);font-weight:500">$${(inv.capitalCarta||0).toFixed(2)}</td>
            <td style="color:${dif>=0?'var(--green)':'var(--red)'};font-weight:500">
                ${dif>=0?'+':''}$${dif.toFixed(2)}
            </td>
            <td><span class="pill ${inv.cerrado?'pill-green':'pill-amber'}">${inv.cerrado?'Cerrado':'Abierto'}</span></td>
            <td style="text-align:right;white-space:nowrap">
                <button class="btn-vista" style="padding:4px 10px;font-size:11px;margin-right:4px"
                    onclick="abrirInventario('${inv.id}')">📋 Abrir</button>
                <button class="btn-vista" style="padding:4px 10px;font-size:11px;color:var(--red);border-color:var(--red)"
                    onclick="eliminarInventario('${inv.id}')">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

// ── Nuevo inventario ──────────────────────────────────────────
function nuevoInventario() {
    invActual = {
        id:     genId(),
        nombre: '',
        fecha:  new Date().toISOString().slice(0,10),
        turno:  'cierre',
        area:   'barra',
        notas:  '',
        filas:  [],
        cerrado: false,
        capitalCosto: 0,
        capitalCarta: 0,
        diferenciaCosto: 0
    };
    filasCaptura = [];
    mostrarVistaCaptura();
    cargarProductosCaptura();
}

function abrirInventario(id) {
    const inv = getInventarios().find(x => x.id === id);
    if (!inv) return;
    invActual    = JSON.parse(JSON.stringify(inv));
    filasCaptura = invActual.filas || [];
    mostrarVistaCaptura();
    renderTablaCaptura();
    actualizarTotales();
}

function eliminarInventario(id) {
    if (!confirm('¿Eliminar este inventario?')) return;
    setInventarios(getInventarios().filter(x => x.id !== id));
    init();
}

// ── Vistas ───────────────────────────────────────────────────
function mostrarVistaCaptura() {
    document.getElementById('vistaLista').style.display    = 'none';
    document.getElementById('vistaCaptura').style.display  = 'block';
    document.getElementById('vistaReporte').style.display  = 'none';

    document.getElementById('invNombre').value = invActual.nombre || '';
    document.getElementById('invFecha').value  = invActual.fecha  || '';
    document.getElementById('invTurno').value  = invActual.turno  || 'cierre';
    document.getElementById('invArea').value   = invActual.area   || 'barra';
    document.getElementById('invNotas').value  = invActual.notas  || '';
    document.getElementById('captTitulo').textContent = invActual.nombre || 'Nuevo inventario';
}

function volverLista() {
    document.getElementById('vistaLista').style.display   = 'block';
    document.getElementById('vistaCaptura').style.display = 'none';
    document.getElementById('vistaReporte').style.display = 'none';
    init();
}

function volverCaptura() {
    document.getElementById('vistaLista').style.display   = 'none';
    document.getElementById('vistaCaptura').style.display = 'block';
    document.getElementById('vistaReporte').style.display = 'none';
}

// ── Cargar productos desde catálogo ──────────────────────────
function cargarProductosCaptura() {
    const insumos = getInsumos().filter(x => x.activo !== '0');
    if (!insumos.length) {
        filasCaptura = [];
        renderTablaCaptura();
        return;
    }

    // Crear filas para cada insumo activo, preservando capturas existentes
    filasCaptura = insumos.map(ins => {
        const existe = (invActual.filas||[]).find(f => f.insumoId === ins.id);
        if (existe) return existe;

        const p = (ins.presentaciones||[])[0];
        const catLow = (ins.categoria||'').toLowerCase();
        const tipo = catLow.includes('cerveza') || catLow.includes('refresco') ||
                     catLow.includes('soda')    || catLow.includes('agua') ? 'pza' : 'copa';

        // Copa estándar según categoría
        let copaML = COPA_STD.default;
        for (const [key, val] of Object.entries(COPA_STD)) {
            if (catLow.includes(key)) { copaML = val; break; }
        }

        // Peso cristal y contenido en ML
        const pesoCristal = parseFloat(p?.pesoCristal) || 0;
        const contML = (()=>{
            const cn = parseFloat(p?.contNeto)||0;
            const um = (p?.umContenido||'ML').toUpperCase();
            return um==='LT' ? cn*1000 : cn;
        })();

        return {
            insumoId:     ins.id,
            nombre:       ins.nombre + (ins.variedad ? ' '+ins.variedad : ''),
            categoria:    ins.categoria || '',
            subcategoria: ins.subcategoria || '',
            familia:      ins.familia || '',
            tipo,
            copaML,
            contNeto:     contML,
            pesoCristal,
            umCosto:      p?.umCosto || 'LT',
            costoUnitario: parseFloat(p?.costoUnitario) || parseFloat(p?.precio) || 0,
            precioCarta:  parseFloat(p?.precioCarta) || 0,
            precioCartaBot: parseFloat(p?.precioCartaBot) || 0,
            // Campos de captura
            cerradasBodega: 0,
            cerradasBarra:  0,
            pesos:          ['','','','','',''],  // hasta 6 botellas abiertas
            entradas:       0,
            ventasCopas:    0,
            ventasBotella:  0,
        };
    });

    cargarFiltrosCaptura();
    renderTablaCaptura();
    actualizarTotales();
}

// ── Filtros de captura ────────────────────────────────────────
function cargarFiltrosCaptura() {
    const familias = [...new Set(filasCaptura.map(f=>f.familia).filter(Boolean))].sort();
    const cats     = [...new Set(filasCaptura.map(f=>f.categoria).filter(Boolean))].sort();
    const ffFam = document.getElementById('filtroFamiliaInv');
    const ffCat = document.getElementById('filtroCatInv');
    ffFam.innerHTML = '<option value="">Todas las familias</option>' +
        familias.map(f => `<option value="${f}">${f}</option>`).join('');
    ffCat.innerHTML = '<option value="">Todas las categorías</option>' +
        cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function filtrarProductosInv() {
    renderTablaCaptura();
}

function getFilasFiltradas() {
    const fam = document.getElementById('filtroFamiliaInv')?.value || '';
    const cat = document.getElementById('filtroCatInv')?.value || '';
    return filasCaptura.filter(f =>
        (!fam || f.familia === fam) &&
        (!cat || f.categoria === cat)
    );
}

// ── Cálculo ML reales ─────────────────────────────────────────
function calcMLReales(fila) {
    const pesosNum = fila.pesos.map(p => parseFloat(p)||0).filter(p=>p>0);
    if (!pesosNum.length) return 0;
    // ML reales = suma(peso_bruto - peso_cristal) por cada botella abierta
    const pc = fila.pesoCristal || 0;
    return pesosNum.reduce((sum, p) => sum + Math.max(0, p - pc), 0);
}

function calcExistencia(fila) {
    const cerradas = (fila.cerradasBodega||0) + (fila.cerradasBarra||0);
    const mlReales = calcMLReales(fila);
    if (fila.tipo === 'pza') {
        return cerradas + (mlReales > 0 ? 1 : 0);
    }
    // copas = cerradas * (contNeto / copaML) + mlReales / copaML
    const copasBot   = fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0;
    const copasAbier = fila.copaML > 0 ? mlReales / fila.copaML : 0;
    return cerradas * copasBot + copasAbier;
}

function calcExistenciaTeorica(fila) {
    // Teórico = entradas - ventas
    if (fila.tipo === 'pza') {
        return (fila.entradas||0) - (fila.ventasBotella||0);
    }
    const copasBot = fila.contNeto > 0 && fila.copaML > 0 ? fila.contNeto / fila.copaML : 0;
    return ((fila.entradas||0) * copasBot) - (fila.ventasCopas||0) - ((fila.ventasBotella||0) * copasBot);
}

function calcDiferencia(fila) {
    return calcExistencia(fila) - calcExistenciaTeorica(fila);
}

function semaforo(dif, existencia) {
    if (existencia === 0) return 'var(--text-dim)';
    const pct = Math.abs(dif / existencia) * 100;
    return pct <= 25 ? 'var(--green)' : pct <= 50 ? 'var(--accent)' : 'var(--red)';
}

// ── Tabla de captura ──────────────────────────────────────────
function renderTablaCaptura() {
    const tbody  = document.getElementById('tbodyCaptura');
    const filas  = getFilasFiltradas();

    tbody.innerHTML = filas.map((fila, i) => {
        const idxReal = filasCaptura.indexOf(fila);
        const mlReal  = calcMLReales(fila);
        const exist   = calcExistencia(fila);
        const teorica = calcExistenciaTeorica(fila);
        const dif     = calcDiferencia(fila);
        const color   = semaforo(dif, exist);
        const unidad  = fila.tipo === 'pza' ? 'pza' : 'cop';

        // Costo por copa/pza
        const cu = fila.costoUnitario || 0;
        const costoCopa = fila.copaML > 0 && cu > 0 ? cu * (fila.copaML/1000) : cu;
        const difCosto  = dif * costoCopa;

        return `<tr>
            <td>
                <div style="font-size:12px;font-weight:500">${fila.nombre}</div>
                <div style="font-size:10px;color:var(--text-dim)">${fila.categoria||''}</div>
            </td>
            <td style="font-size:11px;color:var(--text-muted)">${fila.tipo}</td>
            <td>
                <input type="number" value="${fila.cerradasBodega||0}" min="0" step="1"
                    style="width:60px"
                    oninput="updCaptura(${idxReal},'cerradasBodega',+this.value)">
            </td>
            <td>
                <input type="number" value="${fila.cerradasBarra||0}" min="0" step="1"
                    style="width:60px"
                    oninput="updCaptura(${idxReal},'cerradasBarra',+this.value)">
            </td>
            ${fila.pesos.map((p, pi) => `
            <td>
                <input type="number" value="${p||''}" min="0" step="1"
                    placeholder="—" style="width:60px"
                    oninput="updPeso(${idxReal},${pi},this.value)">
            </td>`).join('')}
            <td style="color:${mlReal>0?'var(--green)':'var(--text-dim)'};font-weight:500">
                ${mlReal>0?mlReal.toFixed(0)+' ml':'—'}
            </td>
            <td>
                <input type="number" value="${fila.entradas||0}" min="0" step="1"
                    style="width:60px"
                    oninput="updCaptura(${idxReal},'entradas',+this.value)">
            </td>
            <td>
                <input type="number" value="${fila.ventasCopas||0}" min="0" step="1"
                    style="width:60px"
                    oninput="updCaptura(${idxReal},'ventasCopas',+this.value)">
            </td>
            <td>
                <input type="number" value="${fila.ventasBotella||0}" min="0" step="1"
                    style="width:60px"
                    oninput="updCaptura(${idxReal},'ventasBotella',+this.value)">
            </td>
            <td style="font-weight:600;color:${color}">
                ${dif>=0?'+':''}${dif.toFixed(1)} ${unidad}
            </td>
            <td style="font-weight:600;color:${color}">
                ${difCosto>=0?'+':''}$${difCosto.toFixed(2)}
            </td>
        </tr>`;
    }).join('');

    actualizarTotales();
}

function updCaptura(idx, campo, val) {
    filasCaptura[idx][campo] = val;
    renderTablaCaptura();
}

function updPeso(idx, pi, val) {
    filasCaptura[idx].pesos[pi] = val;
    renderTablaCaptura();
}

// ── Totales ───────────────────────────────────────────────────
function actualizarTotales() {
    let capitalCosto = 0, capitalCarta = 0, difTotal = 0, difCostoTotal = 0;

    filasCaptura.forEach(fila => {
        const exist  = calcExistencia(fila);
        const cu     = fila.costoUnitario || 0;
        const costoCopa = fila.copaML > 0 && cu > 0 ? cu*(fila.copaML/1000) : cu;
        const pc     = fila.precioCarta || 0;
        const dif    = calcDiferencia(fila);

        capitalCosto += exist * costoCopa;
        capitalCarta += exist * pc;
        difTotal     += dif;
        difCostoTotal+= dif * costoCopa;
    });

    const elCosto = document.getElementById('totalCosto');
    const elCarta = document.getElementById('totalCarta');
    const elDif   = document.getElementById('totalDif');
    const elDifC  = document.getElementById('totalDifCosto');

    if (elCosto) elCosto.textContent = '$'+capitalCosto.toFixed(2);
    if (elCarta) elCarta.textContent = '$'+capitalCarta.toFixed(2);
    if (elDif)   elDif.textContent = (difTotal>=0?'+':'')+difTotal.toFixed(1)+' uds';
    if (elDifC) {
        elDifC.textContent = (difCostoTotal>=0?'+':'')+'$'+difCostoTotal.toFixed(2);
        elDifC.style.color = difCostoTotal>=0?'var(--green)':'var(--red)';
    }

    // Guardar en estado
    if (invActual) {
        invActual.capitalCosto   = capitalCosto;
        invActual.capitalCarta   = capitalCarta;
        invActual.diferenciaCosto = difCostoTotal;
    }
}

// ── Guardar inventario ────────────────────────────────────────
function guardarInventario() {
    if (!invActual) return;
    invActual.nombre = document.getElementById('invNombre').value.trim() || 'Inventario '+new Date().toLocaleDateString('es-MX');
    invActual.fecha  = document.getElementById('invFecha').value;
    invActual.turno  = document.getElementById('invTurno').value;
    invActual.area   = document.getElementById('invArea').value;
    invActual.notas  = document.getElementById('invNotas').value;
    invActual.filas  = filasCaptura;
    invActual.fecha  = invActual.fecha || new Date().toISOString().slice(0,10);

    document.getElementById('captTitulo').textContent = invActual.nombre;
    document.getElementById('btnReporte').style.display = 'inline-flex';

    const lista = getInventarios();
    const idx   = lista.findIndex(x => x.id === invActual.id);
    if (idx >= 0) lista[idx] = invActual;
    else lista.push(invActual);

    setInventarios(lista);
    alert('✅ Inventario guardado');
}

// ── Reporte ───────────────────────────────────────────────────
function verReporte() {
    if (!invActual) return;
    document.getElementById('vistaCaptura').style.display = 'none';
    document.getElementById('vistaReporte').style.display = 'block';
    document.getElementById('repTitulo').textContent      = invActual.nombre || 'Reporte';
    renderReporte();
}

function renderReporte() {
    const cont   = document.getElementById('repContenido');
    const filas  = filasCaptura;

    // Agrupar por familia
    const grupos = {};
    filas.forEach(f => {
        const g = f.familia || f.categoria || 'Otros';
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push(f);
    });

    let totalCosto = 0, totalCarta = 0, totalDif = 0;

    const html = Object.entries(grupos).map(([grp, items]) => {
        const rows = items.map(fila => {
            const exist   = calcExistencia(fila);
            const teorica = calcExistenciaTeorica(fila);
            const dif     = calcDiferencia(fila);
            const cu      = fila.costoUnitario || 0;
            const costoCopa = fila.copaML > 0 && cu > 0 ? cu*(fila.copaML/1000) : cu;
            const capitalC  = exist * costoCopa;
            const capitalCa = exist * (fila.precioCarta||0);
            const difCosto  = dif * costoCopa;
            const color     = semaforo(dif, exist);

            totalCosto += capitalC;
            totalCarta += capitalCa;
            totalDif   += difCosto;

            return `<tr>
                <td style="font-size:12px">${fila.nombre}</td>
                <td style="text-align:center;color:var(--text-muted)">${exist.toFixed(1)}</td>
                <td style="text-align:center;color:var(--text-muted)">${teorica.toFixed(1)}</td>
                <td style="text-align:center;font-weight:600;color:${color}">
                    ${dif>=0?'+':''}${dif.toFixed(1)}
                </td>
                <td style="text-align:right;color:var(--accent)">$${capitalC.toFixed(2)}</td>
                <td style="text-align:right;color:var(--green)">$${capitalCa.toFixed(2)}</td>
                <td style="text-align:right;font-weight:600;color:${color}">
                    ${difCosto>=0?'+':''}$${difCosto.toFixed(2)}
                </td>
            </tr>`;
        }).join('');

        return `
        <div class="card" style="margin-bottom:16px">
            <div class="card-header">
                <h2>${grp}</h2>
                <span class="pill pill-amber">${items.length} productos</span>
            </div>
            <div class="card-body" style="padding:0">
                <div class="tabla-wrap">
                    <table>
                        <thead><tr>
                            <th>Producto</th>
                            <th style="text-align:center">Real</th>
                            <th style="text-align:center">Teórico</th>
                            <th style="text-align:center">Diferencia</th>
                            <th style="text-align:right">Capital costo</th>
                            <th style="text-align:right">Capital carta</th>
                            <th style="text-align:right">Dif. $</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    }).join('');

    // Totales generales
    const resumen = `
    <div class="stats-grid" style="margin-bottom:20px">
        <div class="stat-card">
            <div class="stat-label">Capital a costo</div>
            <div class="stat-val">$${totalCosto.toFixed(0)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Capital a carta</div>
            <div class="stat-val green">$${totalCarta.toFixed(0)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Diferencia total</div>
            <div class="stat-val ${totalDif>=0?'green':'red'}" style="font-size:22px">
                ${totalDif>=0?'+':''}$${totalDif.toFixed(2)}
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Productos</div>
            <div class="stat-val">${filas.length}</div>
        </div>
    </div>`;

    cont.innerHTML = resumen + html;
}

// ── Init ──────────────────────────────────────────────────────
function init() {
    renderStats();
    renderHistorial();
}

init();