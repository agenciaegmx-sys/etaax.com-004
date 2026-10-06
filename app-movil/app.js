/* ══════════════════════════════════════════════════════════════════════════
   ETAAX · App móvil de registro — barra y cocina

   QUÉ ES Y QUÉ NO. Es la misma captura que hoy se hace escaneando el QR en el
   navegador, pero instalable: ícono en la pantalla de inicio, sin barra de
   navegador y abriendo al instante aunque la señal esté mala.

   NO reimplementa nada del negocio. Llama a las MISMAS funciones del servidor
   que entrada.html —entrada_validar_nip, portal_perfil, entrada_insumos,
   entrada_recetas, entrada_registrar, inventario_conteo_registrar,
   entrada_historial— y usa el MISMO vocabulario de áreas (/staff-area.js). Si
   mañana cambia quién ve qué, cambia en un lugar y las dos pantallas se
   enteran. Duplicar esas reglas aquí sería garantizar que un día digan cosas
   distintas.

   LO QUE TODAVÍA NO HACE, dicho claro: no captura sin señal. La app ABRE sin
   internet (eso lo resuelve el service worker), pero el registro necesita red.
   Capturar offline y subirlo al volver la señal es el siguiente paso.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ── Credenciales del QR ───────────────────────────────────────────────────
   Vienen en el enlace (?n=negocio&t=token&s=sucursal). Se guardan porque al
   INSTALAR la app el acceso directo abre la raíz, sin parámetros: sin esto, el
   ícono instalado sería una pantalla muerta y habría que volver a escanear el
   QR cada vez — justo lo que la instalación viene a evitar.

   El token no caduca y es el mismo que lleva impreso el QR pegado en la barra,
   así que guardarlo en el teléfono no abre nada que una foto del QR no abriera
   ya. Lo que autoriza cada registro es el NIP, y ese sí se pide siempre. */
var LS = 'etaax_appmovil_qr';
var Q = new URLSearchParams(location.search);
var NEG = Q.get('n') || Q.get('neg') || '';
var TOKEN = Q.get('t') || '';
var SUC = Q.get('s') || '';
try {
    if (NEG && TOKEN) localStorage.setItem(LS, JSON.stringify({ n: NEG, t: TOKEN, s: SUC }));
    else {
        var g = JSON.parse(localStorage.getItem(LS) || 'null');
        if (g && g.n && g.t) { NEG = g.n; TOKEN = g.t; SUC = g.s || ''; }
    }
} catch (e) {}

/* ── Estado ── */
var NIP = '', NIPHASH = '', COLAB = '', PUESTO = '', AREA_COLAB = '';
var AREA = '';                 // dónde cae el movimiento (se sella en el registro)
var INSUMOS = [], RECETAS = null;
var FLUJO = '';                // 'entrada' | 'merma' | 'salida' | 'conteo'
var SEL = null;                // el producto elegido
var LOTE = [], FOTOS = [];     // lo que se va a mandar
var SUB = {};                  // opciones del flujo (qué se mermó, tipo de salida…)
var _instalador = null;

var MAX_ITEMS = 15, MAX_FOTOS = 10;
var BUCKET = 'evidencias-priv', REF_PRIV = 'priv:';
var _PREV = {};                // ref → miniatura local (el bucket es privado)

/* ── Utilidades ── */
function $(id) { return document.getElementById(id); }
function etx(s) { return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function n(v) { var x = parseFloat(String(v).replace(/,/g, '')); return isNaN(x) ? 0 : x; }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function hoyStr() { var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function horaStr() { var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

var _toastT = null;
function toast(msg, clase) {
    var t = $('toast');
    t.className = 'toast' + (clase ? ' ' + clase : '');
    t.innerHTML = msg; t.hidden = false;
    clearTimeout(_toastT); _toastT = setTimeout(function () { t.hidden = true; }, 3400);
}
function barraMsg(msg, clase) {
    var m = $('barraMsg'); m.className = 'barra-msg' + (clase ? ' ' + clase : ''); m.innerHTML = msg || '';
}

/* El mismo hash que security.js y entrada.html: el NIP se guarda como
   nipHash = v2$sha256('etaax-staff|nip|'+pin). Cambiarlo aquí dejaría a todos
   fuera sin que nada más se rompiera. */
async function hashNip(pin) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('etaax-staff|nip|' + pin));
    return 'v2$' + Array.prototype.map.call(new Uint8Array(buf),
        function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

/* ── Tema ── */
function toggleTema() {
    var o = document.documentElement.getAttribute('data-tema') === 'oscuro';
    document.documentElement.setAttribute('data-tema', o ? 'claro' : 'oscuro');
    $('temaIco').textContent = o ? '🌙' : '☀️';
    try { localStorage.setItem('etaax_appmovil_tema', o ? 'claro' : 'oscuro'); } catch (e) {}
    var mt = document.querySelector('meta[name="theme-color"]');
    if (mt) mt.setAttribute('content', o ? '#f3f1ec' : '#13120f');
}
try {
    if (localStorage.getItem('etaax_appmovil_tema') === 'claro') {
        document.documentElement.setAttribute('data-tema', 'claro');
        var mt0 = document.querySelector('meta[name="theme-color"]'); if (mt0) mt0.setAttribute('content', '#f3f1ec');
    }
} catch (e) {}

/* ── Navegación entre pantallas ── */
var PANTS = ['pLogin', 'pMenu', 'pFlujo', 'pHist'];
function mostrar(id, titulo, sub, conVolver, conBarra) {
    PANTS.forEach(function (p) { $(p).hidden = (p !== id); });
    $('hdrTit').textContent = titulo;
    $('hdrSub').textContent = sub || '';
    $('btnVolver').hidden = !conVolver;
    $('barra').hidden = !conBarra;
    document.body.classList.toggle('con-barra', !!conBarra);
    window.scrollTo(0, 0);
}

/* ══ 1 · ENTRAR CON EL NIP ═════════════════════════════════════════════════
   Teclado propio y no el del sistema: con dedos mojados y en media luz, cinco
   botones grandes se aciertan y un campo de texto no. Además así no se abre el
   teclado del teléfono, que en pantallas chicas tapa justo lo que se escribe. */
var TECLAS = ['1','2','3','4','5','6','7','8','9','borrar','0','entrar'];
function pintarTeclado() {
    $('teclado').innerHTML = TECLAS.map(function (k) {
        if (k === 'borrar') return '<button class="tecla tecla-acc" data-k="borrar" aria-label="Borrar">⌫</button>';
        if (k === 'entrar') return '<button class="tecla tecla-acc" data-k="entrar" aria-label="Entrar">✓</button>';
        return '<button class="tecla" data-k="' + k + '">' + k + '</button>';
    }).join('');
    $('teclado').onclick = function (e) {
        var b = e.target.closest('[data-k]'); if (!b) return;
        tecla(b.getAttribute('data-k'));
    };
}
function pintarPuntos() {
    $('nipPuntos').innerHTML = [0,1,2,3,4].map(function (i) {
        return '<i class="' + (i < NIP.length ? 'on' : '') + '"></i>';
    }).join('');
}
function tecla(k) {
    if (k === 'borrar') { NIP = NIP.slice(0, -1); $('nipMsg').textContent = ''; pintarPuntos(); return; }
    if (k === 'entrar') { entrar(); return; }
    if (NIP.length >= 5) return;
    NIP += k; pintarPuntos();
    /* Con los 5 dígitos entra solo: pedir además un «aceptar» es un toque de más
       cien veces al día. */
    if (NIP.length === 5) setTimeout(entrar, 120);
}

var _entrando = false;
async function entrar() {
    if (_entrando) return;
    if (NIP.length !== 5) { $('nipMsg').textContent = 'El NIP son 5 dígitos.'; return; }
    if (!navigator.onLine) { $('nipMsg').textContent = 'Sin internet. Esta app todavía necesita señal para entrar.'; return; }
    _entrando = true; $('nipMsg').textContent = 'Comprobando…';
    try {
        var h = await hashNip(NIP);
        var rv = await _supabase.rpc('entrada_validar_nip', { p_neg: NEG, p_token: TOKEN, p_niphash: h });
        if (rv.error) { $('nipMsg').textContent = 'No se pudo comprobar: ' + rv.error.message; _entrando = false; return; }
        if (!rv.data) {
            $('nipMsg').innerHTML = 'NIP no reconocido.<br>Pídele a tu encargado tu NIP de 5 dígitos.';
            NIP = ''; pintarPuntos(); _entrando = false; return;
        }
        COLAB = rv.data; NIPHASH = h;
        await cargarPerfil(h);
        await cargarInsumos();
        irMenu();
    } catch (e) {
        $('nipMsg').textContent = 'Error: ' + ((e && e.message) || e);
    }
    _entrando = false;
}

/* EL ÁREA LA DICE EL PERFIL, NO EL DEDO. Y se resuelve con la jerarquía
   completa —campo a mano → rol del sistema → puesto escrito—, porque la
   consulta rellena `area` con 'administracion' cuando nadie la capturó y leer
   solo ese campo manda a todos a ver el negocio entero. */
async function cargarPerfil(h) {
    try {
        var rp = await _supabase.rpc('portal_perfil', { p_neg: NEG, p_token: TOKEN, p_niphash: h });
        var p = rp && rp.data;
        if (!p) return;
        PUESTO = p.puesto || '';
        var crudo = (p.areaReal !== undefined) ? p.areaReal
                  : (p.area === 'administracion' ? '' : p.area);
        AREA_COLAB = window.StaffArea
            ? StaffArea.de({ area: crudo, rol: p.rol, puesto: p.puesto }) : '';
    } catch (e) { /* sin perfil: se ven todas las áreas, como antes */ }
    var perm = areasPermitidas();
    if (perm.indexOf(AREA) < 0) AREA = perm[0];
}

function areasPermitidas() {
    var l = (window.StaffArea && StaffArea.veAreas(AREA_COLAB)) || null;
    if (l) return l;
    return window.StaffArea ? StaffArea.AREAS_INSUMO.map(function (a) { return a.k; })
                            : ['barra', 'cocina', 'almacen_general'];
}
function nomArea(k) { return (window.StaffArea && StaffArea.nomIns(k)) || k; }

/* ── El catálogo ──
   Se deduplica maestro/copia y se acota a la sucursal del QR: el colaborador
   tiene que ver UN producto por producto, no uno por sucursal. */
async function cargarInsumos() {
    var ri = await _supabase.rpc('entrada_insumos', { p_neg: NEG, p_token: TOKEN });
    INSUMOS = unoPorProducto((ri.data || []).filter(function (x) {
        return x && x.id && x.activo !== '0' && enSuc(x);
    }));
    INSUMOS.sort(function (a, b) { return (a.nombre || '').localeCompare(b.nombre || ''); });
}
function enSuc(x) {
    if (!SUC || !x) return true;
    if ((x.inactivoEn || []).indexOf(SUC) >= 0 || (x.inactivaEn || []).indexOf(SUC) >= 0) return false;
    var ss = (x.sucursales && x.sucursales.length) ? x.sucursales : (x.sucursalId ? [x.sucursalId] : null);
    if (!ss || !ss.length) return true;
    return ss.indexOf(SUC) >= 0;
}
/* Un producto vive como MAESTRO + una COPIA por sucursal. Sin esto el buscador
   enseña el mismo tequila cuatro veces y no hay forma de saber cuál tocar. */
function unoPorProducto(lista) {
    var por = {}, orden = [];
    (lista || []).forEach(function (x) {
        var k = x.origenId || x.id;
        if (!(k in por)) { por[k] = x; orden.push(k); return; }
        /* Dentro de una sucursal manda SU copia; en el QR sin sucursal, el
           maestro. Quedarse con el equivocado enseña precios de otra sucursal. */
        var esCopia = !!x.origenId, actualEsCopia = !!por[k].origenId;
        if (SUC ? (esCopia && !actualEsCopia) : (!esCopia && actualEsCopia)) por[k] = x;
    });
    return orden.map(function (k) { return por[k]; });
}

/* ══ 2 · MENÚ ══════════════════════════════════════════════════════════════ */
function irMenu() {
    FLUJO = ''; SEL = null; LOTE = []; FOTOS = []; SUB = {};
    var det = [PUESTO, (window.StaffArea && AREA_COLAB) ? StaffArea.nom(AREA_COLAB) : '']
                .filter(Boolean).join(' · ');
    $('quienCard').innerHTML = '<b>' + etx(COLAB) + '</b>' +
        (det ? '<small>' + etx(det) + '</small>' : '');
    pintarInstalar();
    mostrar('pMenu', 'Registro', '¿Qué vas a registrar?', false, false);
}

function salir() {
    NIP = ''; NIPHASH = ''; COLAB = ''; PUESTO = ''; AREA_COLAB = '';
    INSUMOS = []; RECETAS = null; pintarPuntos();
    $('nipMsg').textContent = '';
    mostrar('pLogin', 'Registro', 'barra / cocina', false, false);
}

/* ══ 3 · LOS CUATRO FLUJOS ═════════════════════════════════════════════════
   Son el mismo gesto —elegir producto, poner cuánto, agregar al lote— y por eso
   comparten pantalla. Lo que cambia entre ellos son tres cosas: el título, los
   campos de en medio y qué se manda al servidor. */
var FLUJOS = {
    entrada: { tit: 'Entrada de insumos', sub: 'Llegó mercancía', btn: 'Registrar entradas' },
    merma:   { tit: 'Merma',              sub: 'Se rompió, se derramó o se desperdició', btn: 'Registrar mermas' },
    salida:  { tit: 'Cortesía o préstamo', sub: 'Salió sin ser venta', btn: 'Registrar salidas' },
    conteo:  { tit: 'Contar existencias', sub: 'Antes del inventario', btn: 'Mandar el conteo' }
};

function abrirFlujo(f) {
    FLUJO = f; SEL = null; LOTE = []; FOTOS = []; SUB = {};
    if (f === 'merma')  SUB.que = 'insumo';
    if (f === 'salida') { SUB.que = 'insumo'; SUB.tipo = 'cortesia'; }
    var c = FLUJOS[f];
    mostrar('pFlujo', c.tit, c.sub, true, true);
    $('btnEnviar').textContent = c.btn;
    $('buscar').value = ''; $('nota').value = '';
    pintarAreas(); pintarExtra(); pintarSugs([]); pintarLote(); pintarFotos();
    limpiarElegido();
    barraMsg('');
}

/* Las áreas donde ESTE colaborador puede dejar un movimiento. Con una sola, el
   bloque deja de ser selector y pasa a ser rótulo: decir dónde estás parado
   sirve; poder cambiarlo con el dedo era el problema. */
function pintarAreas() {
    var perm = areasPermitidas(), c = $('flujoArea');
    if (perm.length === 1) {
        c.innerHTML = '<span class="chip-fijo">' + etx(nomArea(perm[0])) + ' <em>tu área</em></span>';
        AREA = perm[0]; return;
    }
    if (perm.indexOf(AREA) < 0) AREA = perm[0];
    c.innerHTML = perm.map(function (k) {
        return '<button class="chip-b' + (AREA === k ? ' on' : '') + '" data-area="' + etx(k) + '">' +
               etx(nomArea(k)) + '</button>';
    }).join('');
    c.onclick = function (e) {
        var b = e.target.closest('[data-area]'); if (!b) return;
        setArea(b.getAttribute('data-area'));
    };
}
/* Esconder el chip no es negarlo: se compara contra la lista de permitidas, que
   es lo que de verdad autoriza. */
function setArea(a) {
    if (areasPermitidas().indexOf(a) < 0) return;
    AREA = a; pintarAreas(); buscar($('buscar').value || '');
}

/* Los campos de en medio, por flujo. */
function pintarExtra() {
    var c = $('flujoExtra');
    if (FLUJO === 'merma' || FLUJO === 'salida') {
        var lblQue = FLUJO === 'merma' ? '¿Qué se mermó?' : '¿Qué salió?';
        c.innerHTML =
            '<label class="lbl">' + lblQue + '</label>' +
            '<div class="chips-area">' +
                btnSub('que', 'insumo', '🧴 Insumo') +
                btnSub('que', 'producto', '🍹 Producto del menú') +
            '</div>' +
            (FLUJO === 'salida'
                ? '<label class="lbl">Tipo</label><div class="chips-area">' +
                  btnSub('tipo', 'cortesia', '🎁 Cortesía') +
                  btnSub('tipo', 'prestamo', '🔁 Préstamo') + '</div>'
                : '');
        c.onclick = function (e) {
            var b = e.target.closest('[data-sub]'); if (!b) return;
            SUB[b.getAttribute('data-sub')] = b.getAttribute('data-val');
            SEL = null; limpiarElegido(); pintarExtra();
            $('buscar').value = ''; pintarSugs([]);
        };
        return;
    }
    if (FLUJO === 'entrada') {
        c.innerHTML =
            '<label class="lbl" for="entTipo">Tipo de entrada</label>' +
            '<select class="campo" id="entTipo">' +
                '<option value="compra">Compra</option>' +
                '<option value="bonificacion">Bonificación</option>' +
                '<option value="consignacion">Consignación</option>' +
                '<option value="prestamo">Préstamo pagado</option>' +
                '<option value="traspaso">Traspaso de otra sucursal</option>' +
            '</select>' +
            '<label class="lbl" for="entFecha">Fecha</label>' +
            '<input class="campo" id="entFecha" type="date" value="' + hoyStr() + '">';
        c.onclick = null;
        return;
    }
    c.innerHTML = ''; c.onclick = null;
}
function btnSub(campo, val, lbl) {
    return '<button class="chip-b' + (SUB[campo] === val ? ' on' : '') + '" ' +
           'data-sub="' + campo + '" data-val="' + val + '">' + lbl + '</button>';
}

/* ── El buscador ── */
function fuente() {
    /* Mermas y cortesías de PRODUCTO buscan en la carta, no en el almacén. */
    if ((FLUJO === 'merma' || FLUJO === 'salida') && SUB.que === 'producto') return RECETAS || [];
    return INSUMOS;
}
/* Lo que se VE lo decide quién eres, no el chip. El chip solo sella dónde cae el
   movimiento. Es la misma regla de /staff-area.js que usa el QR del navegador. */
function visible(x) {
    if (!window.StaffArea) return true;
    if ((FLUJO === 'merma' || FLUJO === 'salida') && SUB.que === 'producto') {
        var t = String((x && x.tipo) || '').toLowerCase();
        var ar = t.indexOf('bebida') >= 0 ? 'barra' : (t.indexOf('aliment') >= 0 ? 'cocina' : '');
        if (!ar) return true;                       // sin tipo: no se puede saber
        var mia = StaffArea.norm(AREA_COLAB);
        if (mia !== 'barra' && mia !== 'cocina') return true;
        return ar === mia;
    }
    return StaffArea.veInsumo(AREA_COLAB, x);
}

var _buscarT = null;
function buscar(q) {
    clearTimeout(_buscarT);
    /* Un respiro antes de filtrar: con mil insumos, pintar en cada tecla hace
       que el teclado se sienta pegajoso en un teléfono de barra. */
    _buscarT = setTimeout(function () { _buscar(q); }, 110);
}
async function _buscar(q) {
    q = String(q || '').trim().toLowerCase();
    if ((FLUJO === 'merma' || FLUJO === 'salida') && SUB.que === 'producto' && RECETAS === null) {
        await cargarRecetas();
    }
    if (!q) { pintarSugs([]); return; }
    var pal = q.split(/\s+/);
    var res = fuente().filter(function (x) {
        if (!visible(x)) return false;
        var txt = [x.nombre, x.marca, x.categoria, x.subcategoria, x.variedad, x.familia]
                    .join(' ').toLowerCase();
        return pal.every(function (p) { return txt.indexOf(p) >= 0; });
    }).slice(0, 25);
    pintarSugs(res, q);
}
async function cargarRecetas() {
    try {
        var rr = await _supabase.rpc('entrada_recetas', { p_neg: NEG, p_token: TOKEN });
        RECETAS = unoPorProducto((rr.data || []).filter(function (x) { return x && x.id && enSuc(x); }));
    } catch (e) { RECETAS = []; }
}
function pintarSugs(lista, q) {
    var c = $('sugs');
    if (!lista.length) {
        c.innerHTML = q ? '<div class="sug-vacio">Nada con «' + etx(q) + '».<br>' +
            'Si es de otra área, no te aparece: cada quien ve lo suyo.</div>' : '';
        return;
    }
    c.innerHTML = lista.map(function (x, i) {
        var meta = [x.marca, x.categoria, x.subcategoria].filter(Boolean).join(' · ');
        return '<button class="sug" data-i="' + i + '"><b>' + etx(x.nombre || '—') + '</b>' +
               (meta ? '<small>' + etx(meta) + '</small>' : '') + '</button>';
    }).join('');
    c.onclick = function (e) {
        var b = e.target.closest('[data-i]'); if (!b) return;
        elegir(lista[parseInt(b.getAttribute('data-i'), 10)]);
    };
}

function elegir(x) {
    SEL = x;
    $('elegido').hidden = false;
    $('elegidoNom').textContent = x.nombre || '—';
    $('sugs').innerHTML = '';
    $('buscar').value = '';
    pintarUnidades();
    pintarCamposFlujo();
    setTimeout(function () { $('cant').focus(); }, 60);
}
function limpiarElegido() {
    SEL = null; $('elegido').hidden = true;
    var c = $('cant'); if (c) c.value = '';
}

/* Las unidades que tienen sentido para ESTE producto. Ofrecer «litros» para una
   caja de servilletas es invitar a capturar una cantidad que nadie puede leer
   después. */
function pintarUnidades() {
    var p = (SEL && SEL.presentaciones && SEL.presentaciones[0]) || {};
    var u = String(p.umContenido || '').toUpperCase();
    var ops;
    if (FLUJO === 'entrada' || FLUJO === 'conteo') {
        ops = ['PZA', 'BOT', 'CAJA', 'KG', 'LT'];
        $('boxUnidad').hidden = false;
    } else {
        ops = (u === 'ML' || u === 'LT') ? ['OZ', 'ML', 'COPA', 'PZA', 'BOT'] : ['PZA', 'G', 'KG', 'PORCION'];
        $('boxUnidad').hidden = false;
    }
    $('unidad').innerHTML = ops.map(function (o) {
        return '<option value="' + o + '">' + o + '</option>';
    }).join('');
}

function pintarCamposFlujo() {
    var c = $('camposFlujo');
    if (FLUJO === 'merma') {
        c.innerHTML = '<label class="lbl" for="motivo">Motivo</label>' +
            '<select class="campo" id="motivo">' +
                '<option value="se_rompio">Se rompió</option>' +
                '<option value="se_derramo">Se derramó</option>' +
                '<option value="mal_preparado">Mal preparado</option>' +
                '<option value="caducado">Caducado</option>' +
                '<option value="otro">Otro</option>' +
            '</select>';
        return;
    }
    c.innerHTML = '';
}

/* ── El lote ──
   Se arma una lista y se manda de un golpe. Capturar de uno en uno con señal de
   barra es donde se pierde la mitad de los registros. */
function agregarAlLote() {
    if (!SEL) { toast('Elige primero un producto.', 'err'); return; }
    var cant = n($('cant').value);
    if (!(cant > 0)) { toast('Pon la cantidad.', 'err'); return; }
    if (LOTE.length >= MAX_ITEMS) { toast('Van ' + MAX_ITEMS + ' en la lista. Manda esta y sigues con otra.', 'err'); return; }
    var it = {
        id: genId(), insumoId: SEL.id, nombre: SEL.nombre || '—',
        familia: SEL.familia || '', cantidad: cant,
        unidad: $('unidad') ? $('unidad').value : 'PZA'
    };
    if (FLUJO === 'entrada') it.tipo = ($('entTipo') || {}).value || 'compra';
    if (FLUJO === 'merma')   { it.motivo = ($('motivo') || {}).value || 'otro'; it.mermaTipo = SUB.que; }
    if (FLUJO === 'salida')  { it.salidaTipo = SUB.tipo; it.salidaQue = SUB.que; }
    LOTE.push(it);
    limpiarElegido(); pintarLote(); barraMsg('');
    $('buscar').focus();
}
function quitarDelLote(id) {
    LOTE = LOTE.filter(function (x) { return x.id !== id; });
    pintarLote();
}
function pintarLote() {
    var c = $('lote');
    if (!LOTE.length) { c.innerHTML = ''; $('btnEnviar').disabled = true; return; }
    $('btnEnviar').disabled = false;
    c.innerHTML = '<div class="lote-tit">En la lista (' + LOTE.length + '/' + MAX_ITEMS + ')</div>' +
        LOTE.map(function (it) {
            var det = [it.tipo, it.motivo, it.salidaTipo].filter(Boolean).join(' · ');
            return '<div class="lote-it"><span>' + etx(it.nombre) +
                (det ? '<small>' + etx(det) + '</small>' : '') + '</span>' +
                '<b>' + it.cantidad + ' ' + etx(it.unidad) + '</b>' +
                '<button data-del="' + it.id + '" aria-label="Quitar">✕</button></div>';
        }).join('');
    c.onclick = function (e) {
        var b = e.target.closest('[data-del]'); if (!b) return;
        quitarDelLote(b.getAttribute('data-del'));
    };
}

/* ── Fotos ──
   Se comprimen fuerte antes de subir: la señal de una cocina no manda una foto
   de 4 MB, y una foto que no sube es una merma sin evidencia. */
function comprimir(file) {
    return new Promise(function (resolve) {
        var r = new FileReader();
        r.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                var MAX = 1100, w = img.width, h = img.height;
                if (w > MAX || h > MAX) { var k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
                var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                cv.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.72);
            };
            img.onerror = function () { resolve(null); };
            img.src = e.target.result;
        };
        r.onerror = function () { resolve(null); };
        r.readAsDataURL(file);
    });
}
async function tomarFoto(input) {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    for (var i = 0; i < files.length; i++) {
        if (FOTOS.length >= MAX_FOTOS) { toast('Van ' + MAX_FOTOS + ' fotos, que es el tope.', 'err'); break; }
        var marca = { id: genId(), ref: '', subiendo: true, prev: '' };
        try { marca.prev = URL.createObjectURL(files[i]); } catch (e) {}
        FOTOS.push(marca); pintarFotos();
        var ref = await subirFoto(files[i]);
        marca.subiendo = false;
        if (ref) { marca.ref = ref; }
        else { FOTOS = FOTOS.filter(function (f) { return f.id !== marca.id; }); toast('No se pudo subir esa foto.', 'err'); }
        pintarFotos();
    }
}
async function subirFoto(file) {
    var blob = await comprimir(file);
    if (!blob) return '';
    /* La ruta la valida la política del bucket (v28): <negocio>/entradas/<token>/…
       Cambiarla aquí haría que el servidor rechace la subida sin decir por qué. */
    var path = NEG + '/entradas/' + TOKEN + '/' + genId() + '.jpg';
    try {
        var up = await _supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
        if (up.error) return '';
    } catch (e) { return ''; }
    var ref = REF_PRIV + path;
    try { _PREV[ref] = URL.createObjectURL(blob); } catch (e) {}
    return ref;
}
function pintarFotos() {
    $('fotos').innerHTML = FOTOS.map(function (f) {
        return '<div class="foto-th">' + (f.prev ? '<img src="' + f.prev + '" alt="">' : '') +
            (f.subiendo ? '<div class="foto-sub">subiendo…</div>'
                        : '<button data-foto="' + f.id + '" aria-label="Quitar">✕</button>') + '</div>';
    }).join('');
    $('fotos').onclick = function (e) {
        var b = e.target.closest('[data-foto]'); if (!b) return;
        FOTOS = FOTOS.filter(function (f) { return f.id !== b.getAttribute('data-foto'); });
        pintarFotos();
    };
}

/* ── Mandar ──
   Un registro por renglón, igual que el QR del navegador. Lo que falle se queda
   en la lista para reintentar: perder en silencio una merma de una botella de
   mezcal es peor que pedir que se vuelva a tocar el botón. */
function armarRegistro(it) {
    var refs = FOTOS.filter(function (f) { return f.ref; }).map(function (f) { return f.ref; });
    var base = {
        id: it.id, sucursalId: SUC || '', area: AREA,
        fecha: (FLUJO === 'entrada' && $('entFecha')) ? ($('entFecha').value || hoyStr()) : hoyStr(),
        hora: horaStr(), registrado: new Date().toISOString(),
        foto_url: refs[0] || '', foto_urls: refs,
        notas: ($('nota').value || '').trim()
    };
    if (FLUJO === 'entrada') return Object.assign(base, {
        concepto: 'entrada', insumoId: it.insumoId, nombre: it.nombre, familia: it.familia,
        cantidad: it.cantidad, costo: 0, tipo: it.tipo
    });
    if (FLUJO === 'merma') return Object.assign(base, {
        concepto: 'merma', mermaTipo: it.mermaTipo,
        insumoId: it.mermaTipo === 'insumo' ? it.insumoId : '',
        recetaId: it.mermaTipo === 'producto' ? it.insumoId : '',
        nombre: it.nombre, familia: it.familia, cantidad: it.cantidad, unidad: it.unidad, motivo: it.motivo
    });
    if (FLUJO === 'salida') return Object.assign(base, {
        concepto: 'salida', salidaTipo: it.salidaTipo, insumoId: it.insumoId,
        nombre: it.nombre, familia: it.familia, cantidad: it.cantidad, unidad: it.unidad
    });
    // conteo
    return Object.assign(base, {
        insumoId: it.insumoId, nombre: it.nombre, cantidad: it.cantidad, unidad: it.unidad
    });
}

var _enviando = false;
async function enviarLote() {
    if (_enviando) return;
    if (!LOTE.length) { barraMsg('Agrega algo a la lista.', 'err'); return; }
    if (FOTOS.some(function (f) { return f.subiendo; })) { barraMsg('Espera a que suban las fotos.', 'err'); return; }
    if (!navigator.onLine) {
        barraMsg('Sin internet. Tu lista NO se ha perdido: en cuanto vuelva la señal, vuelve a tocar Registrar.', 'err');
        return;
    }
    _enviando = true;
    $('btnEnviar').disabled = true;
    var total = LOTE.length, ok = 0, fallidos = [];
    for (var i = 0; i < LOTE.length; i++) {
        barraMsg('Mandando ' + (ok + 1) + ' de ' + total + '…');
        try {
            var fn = (FLUJO === 'conteo') ? 'inventario_conteo_registrar' : 'entrada_registrar';
            var r = await _supabase.rpc(fn, {
                p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH, p_datos: armarRegistro(LOTE[i])
            });
            if (r.error) fallidos.push(LOTE[i]); else ok++;
        } catch (e) { fallidos.push(LOTE[i]); }
    }
    LOTE = fallidos; pintarLote();
    _enviando = false;
    $('btnEnviar').disabled = !LOTE.length ? true : false;
    if (!fallidos.length) {
        FOTOS = []; pintarFotos(); $('nota').value = '';
        barraMsg('');
        toast('✓ ' + ok + ' registro' + (ok === 1 ? '' : 's') + ' guardado' + (ok === 1 ? '' : 's') + '.', 'ok');
    } else {
        barraMsg(ok + ' guardados · ' + fallidos.length + ' fallaron. Siguen en la lista: vuelve a tocar Registrar.', 'err');
    }
}

/* ══ 4 · LO REGISTRADO ═════════════════════════════════════════════════════ */
var ICONO = { entrada: '📦', merma: '🍷', salida: '🎁' };
var NOMBRE = { entrada: 'Entrada', merma: 'Merma', salida: 'Cortesía / préstamo' };
var _HIST = { movs: [], cnts: [], filtro: 'todo' };

async function abrirHistorial() {
    mostrar('pHist', 'Lo registrado', 'desde el último inventario', true, false);
    $('histSub').textContent = 'Cargando…';
    $('histBody').innerHTML = ''; $('histChips').innerHTML = '';
    if (!navigator.onLine) {
        $('histSub').innerHTML = '<div class="sinred">Sin internet. Esto se lee del servidor, así que hace falta señal.</div>';
        return;
    }
    try {
        var r = await _supabase.rpc('entrada_historial',
            { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH, p_suc: (SUC || ''), p_area: AREA });
        if (r.error || !r.data || !r.data.ok) { $('histSub').textContent = 'No se pudo cargar.'; return; }
        _HIST.movs = r.data.movimientos || [];
        _HIST.cnts = r.data.conteos || [];
        $('histSub').textContent = r.data.desde
            ? ('Desde el cierre de ' + (r.data.inventario || 'el último inventario'))
            : 'Todo lo registrado (aún no hay un inventario cerrado)';
        _HIST.filtro = 'todo';
        pintarHist();
    } catch (e) { $('histSub').textContent = 'Error: ' + ((e && e.message) || e); }
}

function pintarHist() {
    var cta = { entrada: 0, merma: 0, salida: 0 };
    _HIST.movs.forEach(function (m) { if (cta[m.concepto] !== undefined) cta[m.concepto]++; });
    var chip = function (k, lbl, num) {
        return '<button class="chip-b' + (_HIST.filtro === k ? ' on' : '') + '" data-f="' + k + '">' +
               lbl + ' <b>' + num + '</b></button>';
    };
    $('histChips').innerHTML =
        chip('todo', '📋 Todo', _HIST.movs.length + _HIST.cnts.length) +
        chip('entrada', '📦', cta.entrada) + chip('merma', '🍷', cta.merma) +
        chip('salida', '🎁', cta.salida) + chip('conteo', '📋 Conteos', _HIST.cnts.length);
    $('histChips').onclick = function (e) {
        var b = e.target.closest('[data-f]'); if (!b) return;
        _HIST.filtro = b.getAttribute('data-f'); pintarHist();
    };

    var f = _HIST.filtro, html = '';
    if (f === 'conteo') {
        html = _HIST.cnts.map(function (c) {
            return fila('📋', c.nombre || '—', 'Conteo · ' + (c.fecha || '') + horaDe(c), c.quien);
        }).join('');
    } else {
        html = _HIST.movs.filter(function (m) { return f === 'todo' || m.concepto === f; })
            .map(function (m) {
                var cant = m.cantidad ? (m.cantidad + (m.unidad ? ' ' + m.unidad : '')) : '';
                return fila(ICONO[m.concepto] || '•',
                    (m.nombre || '—') + (cant ? '  ·  ' + cant : ''),
                    (NOMBRE[m.concepto] || m.concepto || '') + ' · ' + (m.fecha || '') + horaDe(m),
                    m.quien);
            }).join('');
        if (f === 'todo' && _HIST.cnts.length) {
            html += _HIST.cnts.map(function (c) {
                return fila('📋', c.nombre || '—', 'Conteo · ' + (c.fecha || '') + horaDe(c), c.quien);
            }).join('');
        }
    }
    $('histBody').innerHTML = html ||
        '<div class="hvacio">Nada por aquí todavía.<br>Lo que registres aparece al momento.</div>';
}
/* La hora sale del MOMENTO completo, convertida a la hora del negocio. Cortar el
   texto del ISO da la hora de Greenwich: seis horas corrida, y con esa no se
   puede decir si un movimiento cayó antes o después del cierre. */
function horaDe(m) {
    if (m.hora) return ' · ' + m.hora;
    if (!m.registrado && !m.creado) return '';
    var d = new Date(m.registrado || m.creado);
    if (isNaN(d)) return '';
    return ' · ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fila(ico, titulo, sub, quien) {
    return '<div class="hmov"><div class="hmov-ico">' + ico + '</div><div class="hmov-txt">' +
        '<b>' + etx(titulo) + '</b><small>' + etx(sub) + (quien ? ' · ' + etx(quien) : '') +
        '</small></div></div>';
}

/* ══ INSTALAR ══════════════════════════════════════════════════════════════
   NO HAY UNA SOLA MANERA DE INSTALAR, y fingir que sí es lo que estaba mal.

     · ANDROID / Chrome: el navegador ofrece instalar de verdad. Se guarda su
       aviso y se usa cuando tiene sentido —en el menú, ya con sesión— y no en
       la cara apenas abre.
     · IPHONE: Apple no permite instalar NADA fuera del App Store. La única vía
       es Compartir → «Agregar a inicio», y la hace la persona, no la página: no
       existe forma de dispararla desde el código. Ahí se enseñan los pasos.
       Poner un botón que diga «Instalar» y luego sacar un texto es prometer algo
       que no se puede cumplir.
     · IPHONE pero en Chrome/Firefox: «Agregar a inicio» de esos navegadores
       deja un acceso que abre el navegador otra vez, no la app. Hay que decir
       que se abra en Safari.
     · YA INSTALADA: no se ofrece nada. Ofrecer instalar lo ya instalado hace
       dudar de si de verdad quedó instalado.                                   */
function esStandalone() {
    try {
        return window.matchMedia('(display-mode: standalone)').matches ||
               navigator.standalone === true;
    } catch (e) { return false; }
}
function esIOS() {
    var ua = navigator.userAgent || '';
    /* El iPad moderno se anuncia como Mac: lo delata que la pantalla responda al
       tacto. Sin esto, a un iPad se le enseñan los pasos de Android. */
    return /iPad|iPhone|iPod/.test(ua) ||
           (/Macintosh/.test(ua) && typeof document.ontouchend !== 'undefined');
}
function esSafari() {
    var ua = navigator.userAgent || '';
    /* En iOS TODOS los navegadores usan el motor de Safari, así que no basta con
       buscar «Safari» —Chrome en iPhone también lo trae—. Se descartan por su
       marca propia. */
    return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
}

function pintarInstalar() {
    var el = $('instalar'); if (!el) return;
    if (esStandalone()) { el.hidden = true; return; }   // ya está instalada

    if (_instalador) {                                   // Android: se puede de verdad
        el.innerHTML =
            '<div class="instalar-fila"><div>' +
                '<b>Instálala en el teléfono</b>' +
                '<small>Queda un ícono y ya no hay que escanear el QR cada vez.</small>' +
            '</div><button class="btn btn-sec" onclick="instalar()">Instalar</button></div>';
        el.hidden = false; return;
    }

    if (esIOS()) {
        el.innerHTML = esSafari()
            ? '<b>Déjala en tu pantalla de inicio</b>' +
              '<small>Queda un ícono y ya no hay que escanear el QR cada vez.</small>' +
              '<ol class="pasos">' +
                '<li><i>1</i><span>Toca <b>compartir</b> <span class="icono-share">⬆️</span> ' +
                    'abajo de la pantalla.</span></li>' +
                '<li><i>2</i><span>Baja y elige <b>«Agregar a inicio»</b>.</span></li>' +
                '<li><i>3</i><span>Toca <b>Agregar</b>. Listo.</span></li>' +
              '</ol>' +
              '<div class="instalar-nota">En iPhone esta es la única manera: Apple no permite ' +
                'instalar apps fuera del App Store. Queda igual que cualquier otra, con su ícono ' +
                'y a pantalla completa.</div>'
            : '<b>Ábrela en Safari para dejarla en tu pantalla</b>' +
              '<small>Desde este navegador el acceso que se crea vuelve a abrir el navegador, ' +
              'no la app. Copia la dirección, ábrela en <b>Safari</b> y ahí sí aparece ' +
              '«Agregar a inicio».</small>';
        el.hidden = false; return;
    }

    /* Escritorio, o un Android que todavía no ofrece el aviso (Chrome espera a
       que la página se use un poco antes de ofrecerlo). No se inventa un botón:
       se dice dónde está la opción. */
    el.innerHTML =
        '<b>Instálala en el teléfono</b>' +
        '<small>Ábrela en el celular del área y busca <b>«Instalar app»</b> o ' +
        '<b>«Agregar a pantalla de inicio»</b> en el menú del navegador. ' +
        'Queda un ícono y ya no hay que escanear el QR cada vez.</small>';
    el.hidden = false;
}

window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); _instalador = e; pintarInstalar();
});
async function instalar() {
    if (!_instalador) { pintarInstalar(); return; }
    _instalador.prompt();
    try { await _instalador.userChoice; } catch (e) {}
    _instalador = null;
    pintarInstalar();
}

/* ══ SERVICE WORKER ════════════════════════════════════════════════════════
   Guarda la CÁSCARA para que la app abra sin esperar a la red. Los datos no: un
   inventario viejo servido desde la caché es peor que una pantalla que dice
   «sin señal» — alguien contaría contra existencias de hace tres días. */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
    });
}

/* ── Arranque ── */
window.addEventListener('DOMContentLoaded', function () {
    pintarTeclado(); pintarPuntos();
    if (!NEG || !TOKEN) {
        $('nipMsg').innerHTML = 'Esta app todavía no está ligada a un negocio.<br>' +
            'Ábrela escaneando el QR de tu sucursal (Inventarios → 📱 QR de entradas) y vuelve a instalarla.';
        $('teclado').innerHTML = '';
        return;
    }
    $('loginAviso').innerHTML = 'Tu NIP dice quién registró qué.<br>Si no lo tienes, pídeselo a tu encargado.';
});

/* Lo que el HTML llama por onclick. */
window.toggleTema = toggleTema;
window.irMenu = irMenu;
window.salir = salir;
window.abrirFlujo = abrirFlujo;
window.abrirHistorial = abrirHistorial;
window.buscar = buscar;
window.limpiarElegido = limpiarElegido;
window.agregarAlLote = agregarAlLote;
window.enviarLote = enviarLote;
window.tomarFoto = tomarFoto;
window.instalar = instalar;

/* Para poder probarlo desde la consola y desde el candado. */
window._appMovil = {
    areasPermitidas: areasPermitidas, setArea: setArea, visible: visible,
    unoPorProducto: unoPorProducto, enSuc: enSuc, armarRegistro: armarRegistro,
    horaDe: horaDe, esIOS: esIOS, esSafari: esSafari, esStandalone: esStandalone,
    pintarInstalar: pintarInstalar,
    _set: function (k, v) {
        if (k === 'AREA_COLAB') AREA_COLAB = v; if (k === 'AREA') AREA = v;
        if (k === 'FLUJO') FLUJO = v; if (k === 'SUB') SUB = v;
        if (k === 'SUC') SUC = v; if (k === 'LOTE') LOTE = v; if (k === 'FOTOS') FOTOS = v;
    },
    _get: function (k) { return { AREA: AREA, AREA_COLAB: AREA_COLAB, FLUJO: FLUJO, LOTE: LOTE }[k]; }
};

})();
