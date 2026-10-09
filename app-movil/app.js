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
        if (g && g.n && g.t) { NEG = g.n; TOKEN = g.t; SUC = g.s || ''; NEG_NOM = g.nom || ''; }
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

/* ══ EL PORTAL DEL COLABORADOR ═════════════════════════════════════════════
   Lo de arriba (entradas, mermas, cortesías, conteo) es REGISTRAR: sale dinero
   o entra producto y queda escrito. Esto es CONSULTAR Y CUMPLIR: qué hay que
   hacer en el turno y cómo se hace.

   Son las mismas tres cosas que ya ofrece checklist.html y por las MISMAS
   consultas del servidor —checklist_plantillas, portal_recetas, portal_guias—.
   Ninguna regla se reescribe aquí: qué recetas ve cada quien, qué checklists le
   tocan y qué campos se mandan lo decide el servidor, que es donde ya está
   pensado. Lo único que cambia es la pantalla.

   Y OJO CON LO QUE EL SERVIDOR NO MANDA: portal_recetas arma la receta campo
   por campo con una lista blanca, sin un solo costo. Es a propósito —si mañana
   alguien agrega un campo con dinero adentro, con lista blanca no se filtra
   solo—. No pedir «la receta completa» desde aquí es parte de eso. */
var PLANTILLAS = [], RECETARIO = null, GUIAS = null;
var RUN = null;                  // el checklist que se está ejecutando
var _recFiltro = '', _recTab = '';

var MAX_ITEMS = 15, MAX_FOTOS = 10;
var BUCKET = 'evidencias-priv', REF_PRIV = 'priv:';
var _PREV = {};                // ref → miniatura local (el bucket es privado)

/* ══ EL VOCABULARIO DE ÁREAS, SI ES EL NUEVO ═══════════════════════════════
   NO basta con preguntar si existe `window.StaffArea`. El proyecto sirve los
   .js con `stale-while-revalidate` de una semana: después de un despliegue, un
   teléfono puede traer el archivo VIEJO —el objeto existe, pero sin las
   funciones nuevas— y entonces `StaffArea.veInsumo(...)` revienta con «is not a
   function» y la pantalla de entrar se queda muerta. Pasó en producción.

   Se pregunta por la FUNCIÓN que se va a usar. Si no está, se devuelve null y
   quien llama cae a su camino de «sin vocabulario», que ya existe y falla
   abierto: se ve de más durante una carga, en vez de no poder trabajar. */
function _SA() {
    var S = window.StaffArea;
    return (S && typeof S.veInsumo === 'function' && typeof S.veAreas === 'function' &&
            typeof S.nomIns === 'function' && S.AREAS_INSUMO) ? S : null;
}

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
var PANTS = ['pInicio', 'pCuenta', 'pCandado', 'pPin', 'pHome',
             'pLogin', 'pMenu', 'pFlujo', 'pHist', 'pChecks', 'pRun', 'pRecetas', 'pReceta', 'pGuias'];
function mostrar(id, titulo, sub, conVolver, conBarra) {
    PANTS.forEach(function (p) { $(p).hidden = (p !== id); });
    $('hdrTit').textContent = titulo;
    $('hdrSub').textContent = sub || '';
    $('btnVolver').hidden = !conVolver;
    $('barra').hidden = !conBarra;
    document.body.classList.toggle('con-barra', !!conBarra);
    window.scrollTo(0, 0);
}

/* Lo que cuenta.js averiguó al entrar. Se guarda en el teléfono para que el
   equipo de barra y cocina entre con su NIP sin que nadie reparta un enlace con
   el token dentro. La SUCURSAL no se guarda a propósito: la pone el NIP de quien
   entra — guardarla haría que el teléfono del encargado sellara todo con la
   suya. */
var NEG_NOM = '';
function _fijarQR(neg, token, nombre) {
    NEG = neg; TOKEN = token; NEG_NOM = nombre || '';
    try { localStorage.setItem(LS, JSON.stringify({ n: NEG, t: TOKEN, s: '', nom: NEG_NOM })); } catch (e) {}
}
window._appFijarQR = _fijarQR;

/* ══ 0 · LA PORTADA ════════════════════════════════════════════════════════
   Dos puertas que no se mezclan. La del NIP (QR) y la de la cuenta.
   `_destinoNip` recuerda a cuál de las dos cosas iba quien tecleó su NIP: sin
   eso, el botón del portal y el de registrar llevarían al mismo sitio y uno de
   los dos sobraría. */
var _destinoNip = 'registrar';
function verInicio() {
    /* Los botones de NIP solo tienen sentido si la app sabe de qué negocio es.
       Sin eso NO se esconden a secas: se dice cómo conseguirlo, porque un
       teléfono recién instalado SIEMPRE llega así y dejar media pantalla en
       blanco se lee como que la app está incompleta.

       Se consigue de dos maneras, y las dos están a la mano:
         · que alguien entre UNA vez con su cuenta (el encargado configura el
           teléfono y su equipo ya solo usa el NIP);
         · o escanear el QR de la sucursal, que trae las credenciales. */
    var listo = !!(NEG && TOKEN);
    $('inicioRapido').hidden = !listo;
    $('inicioSub').textContent = listo && NEG_NOM ? NEG_NOM : 'Tu operación, en el bolsillo';
    $('inicioAviso').innerHTML = listo
        ? 'Los dos de arriba funcionan igual que escanear el QR: solo piden tu NIP.'
        : '<b style="color:var(--txt)">¿Eres de barra o cocina?</b><br>' +
          'Este teléfono todavía no está ligado a un negocio. Pídele a tu encargado que ' +
          'entre una vez con su cuenta aquí, o escanea el <b>QR de tu sucursal</b> con la ' +
          'cámara. Después entras solo con tu NIP.';
    mostrar('pInicio', 'ETAAX', listo ? 'elige cómo entrar' : 'empieza por aquí', false, false);
}
function irNip(destino) {
    _destinoNip = destino;
    NIP = ''; pintarPuntos(); $('nipMsg').textContent = '';
    mostrar('pLogin', destino === 'portal' ? 'Portal del colaborador' : 'Registrar',
            'identifícate con tu NIP', true, false);
}
function verCuenta() {
    $('ctaMsg').textContent = '';
    var c = window._cuenta ? window._cuenta.correo() : '';
    if (c && !$('ctaCorreo').value) $('ctaCorreo').value = c;
    mostrarCuenta('pCuenta', 'Entrar', 'con tu cuenta de ETAAX');
}
/* cuenta.js no conoce las pantallas: se las pide a la cáscara por aquí. */
function mostrarCuenta(id, tit, sub) { mostrar(id, tit, sub, true, false); }
function toastC(m, c) { toast(m, c); }

/* ══ EL MENÚ DE LA CUENTA ══════════════════════════════════════════════════
   Los módulos llegan por fases. Lo que todavía no está se enseña APAGADO y
   diciendo dónde sí se hace: esconderlo haría pensar que la app está rota o
   incompleta, y eso es lo que hace que nadie la vuelva a abrir. */
var MODULOS_CUENTA = [
    { ico:'💸', tit:'Agregar un gasto',   sub:'Con su foto, desde donde estés',            fn:'' },
    { ico:'🧾', tit:'Ver los cortes',     sub:'Lo capturado desde la computadora',          fn:'' },
    { ico:'🥃', tit:'Insumos',            sub:'Consultar, corregir precios, agregar uno',   fn:'' },
    { ico:'📖', tit:'Recetas',            sub:'Consultar y crear una sencilla',             fn:'' },
    { ico:'📊', tit:'Resultados',         sub:'El resumen del mes y las estadísticas',      fn:'' }
];
function verHome() {
    var correo = (window._cuenta && window._cuenta.correo()) || '';
    $('homeQuien').innerHTML = '<b>' + etx(NEG_NOM || 'Tu cuenta') + '</b>' +
        (correo ? '<small>' + etx(correo) + '</small>' : '') +
        (NEG && TOKEN ? '<small style="color:var(--verde);margin-top:4px">✓ Tu equipo ya puede entrar con su NIP en este teléfono</small>' : '');
    $('homeMenu').innerHTML = MODULOS_CUENTA.map(function (m) {
        var listo = !!m.fn;
        return '<button class="mcard"' + (listo ? ' onclick="' + m.fn + '"' : ' disabled style="opacity:.42"') + '>' +
            '<span class="mcard-ico">' + m.ico + '</span>' +
            '<span class="mcard-txt"><b>' + etx(m.tit) + '</b><small>' + etx(m.sub) +
            (listo ? '' : ' <span style="color:var(--dim)">· pronto</span>') + '</small></span></button>';
    }).join('') +
    '<div class="avisos" style="margin-top:4px;text-align:left">Esta app es una <b>beta</b>: lo que ' +
    'todavía no está aquí se sigue haciendo desde la computadora, igual que siempre.</div>';
    mostrar('pHome', 'Tu cuenta', (window._cuenta && window._cuenta.correo()) || '', false, false);
}
window._appCuentaLista = verHome;
window._appCuentaFuera = verInicio;

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
        /* El catálogo y los checklists se piden EN PARALELO: en serie son dos
           viajes a Supabase con la señal de una cocina, y el colaborador los
           espera mirando la pantalla de entrar. */
        await Promise.all([cargarInsumos(), cargarPlantillas()]);
        irMenu();
        /* Quien tocó «Portal del colaborador» quería el portal, no el menú de
           registrar: llevarlo al menú le haría buscar otra vez lo que ya pidió. */
        if (_destinoNip === 'portal') {
            if (PLANTILLAS.length) abrirChecklists();
            else if (window.StaffArea) abrirRecetario();
        }
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
                /* LA SUCURSAL SALE DEL NIP, no del enlace.

                   El QR la lleva en la dirección (&s=…) porque cada sucursal
                   imprime el suyo. La app instalada no puede: se instala UNA vez
                   y la usa quien sea del negocio, así que pedirle al admin que
                   elija una al generar el enlace deja la puerta abierta a
                   registrar en la sucursal equivocada.

                   Y no hace falta: el token dice de qué NEGOCIO es y el NIP dice
                   QUIÉN ES — y la ficha de esa persona ya trae su sucursal.

                   El enlace manda solo si la persona NO tiene sucursal asignada:
                   ahí el QR pegado en esa barra sabe más que una ficha vacía. */
                if (p.sucursalId) SUC = p.sucursalId;
        var crudo = (p.areaReal !== undefined) ? p.areaReal
                  : (p.area === 'administracion' ? '' : p.area);
        AREA_COLAB = window.StaffArea
            ? StaffArea.de({ area: crudo, rol: p.rol, puesto: p.puesto }) : '';
    } catch (e) { /* sin perfil: se ven todas las áreas, como antes */ }
    var perm = areasPermitidas();
    if (perm.indexOf(AREA) < 0) AREA = perm[0];
}

function areasPermitidas() {
    var S = _SA();
    var l = (S && S.veAreas(AREA_COLAB)) || null;
    if (l) return l;
    return S ? S.AREAS_INSUMO.map(function (a) { return a.k; })
             : ['barra', 'cocina', 'almacen_general'];
}
function nomArea(k) { return (_SA() && _SA().nomIns(k)) || k; }

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
    FLUJO = ''; SEL = null; LOTE = []; FOTOS = []; SUB = {}; RUN = null;
    var det = [PUESTO, (window.StaffArea && AREA_COLAB) ? StaffArea.nom(AREA_COLAB) : '']
                .filter(Boolean).join(' · ');
    $('quienCard').innerHTML = '<b>' + etx(COLAB) + '</b>' +
        (det ? '<small>' + etx(det) + '</small>' : '');
    pintarPortal();
    pintarInstalar();
    detectarInstalada();
    mostrar('pMenu', 'Registro', '¿Qué vas a registrar?', false, false);
}

function salir() {
    NIP = ''; NIPHASH = ''; COLAB = ''; PUESTO = ''; AREA_COLAB = '';
    /* TODO lo del turno anterior se borra. El teléfono de la barra lo usan
       varias personas: dejar el recetario o los checklists de quien acaba de
       salir le enseñaría al siguiente lo que no le toca. */
    INSUMOS = []; RECETAS = null; PLANTILLAS = []; RECETARIO = null; GUIAS = null; RUN = null;
    pintarPuntos();
    $('nipMsg').textContent = '';
    verInicio();
}

/* Las opciones del portal se arman según el perfil. El recetario solo tiene
   sentido para quien cocina o prepara: a piso y administración no se les
   enseña. No es un permiso —el servidor igual no les devolvería recetas— es no
   llenarles la pantalla con algo que no van a abrir nunca. */
function pintarPortal() {
    var g = $('grupoPortal'), m = $('menuPortal');
    if (!g || !m) return;
    var a = window.StaffArea ? StaffArea.norm(AREA_COLAB) : '';
    var cocina = !a || a === 'barra' || a === 'cocina';
    var ops = [];
    ops.push(_opcion('📋', 'Mis check lists',
        PLANTILLAS.length ? (PLANTILLAS.length + (PLANTILLAS.length === 1 ? ' disponible' : ' disponibles'))
                          : 'Ninguno para tu área',
        PLANTILLAS.length ? 'abrirChecklists()' : ''));
    if (cocina) ops.push(_opcion('📖', 'Recetario', 'Cómo se prepara, paso a paso', 'abrirRecetario()'));
    ops.push(_opcion('📚', 'Guías de uso', 'Manuales de ETAAX', 'abrirGuias()'));
    m.innerHTML = ops.join('');
    g.hidden = false; m.hidden = false;
}
function _opcion(ico, tit, sub, accion) {
    var off = !accion;
    return '<button class="mcard mcard-sec"' + (off ? ' disabled style="opacity:.45"' : ' onclick="' + accion + '"') + '>' +
        '<span class="mcard-ico">' + ico + '</span>' +
        '<span class="mcard-txt"><b>' + etx(tit) + '</b><small>' + etx(sub) + '</small></span></button>';
}

/* Los checklists de SU área y SU sucursal: lo decide el servidor (v59), que
   para eso lee el perfil del NIP. Aquí solo se piden. */
async function cargarPlantillas() {
    try {
        var r = await _supabase.rpc('checklist_plantillas',
            { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH });
        PLANTILLAS = (r && r.data) || [];
    } catch (e) { PLANTILLAS = []; }
}

/* ══ CHECK LISTS ═══════════════════════════════════════════════════════════ */
var TIPO_CHK = { apertura:['🌅','Apertura'], cierre:['🌙','Cierre'], turno:['🔁','Turno'],
                 limpieza:['🧽','Limpieza'], mantenimiento:['🔧','Mantenimiento'] };
function abrirChecklists() {
    mostrar('pChecks', 'Mis check lists', 'los de tu área', true, false);
    $('checksList').innerHTML = PLANTILLAS.length
        ? PLANTILLAS.map(function (p, i) {
            var t = TIPO_CHK[p.tipo] || ['📋', p.tipo || ''];
            var n2 = (p.tareas || []).length;
            return '<button class="rec-it" data-chk="' + i + '">' +
                '<span class="rec-it-ico">' + t[0] + '</span>' +
                '<span style="flex:1;min-width:0"><b>' + etx(p.nombre || '—') + '</b>' +
                '<small>' + etx(t[1]) + ' · ' + n2 + ' tarea' + (n2 === 1 ? '' : 's') + '</small></span>' +
                '<span style="color:var(--dim)">›</span></button>';
        }).join('')
        : '<div class="hvacio">No hay check lists para tu área.<br>Tu encargado los arma desde el sistema.</div>';
    $('checksList').onclick = function (e) {
        var b = e.target.closest('[data-chk]'); if (!b) return;
        abrirRun(PLANTILLAS[parseInt(b.getAttribute('data-chk'), 10)]);
    };
}

/* TRES ESTADOS, no dos: cumplida, no se pudo, y pendiente. «No se pudo» y «no
   lo he hecho» no son lo mismo —una es un problema que reportar y la otra es
   trabajo sin terminar— y revolverlas hace inútil el reporte. */
var MARCA_SIG = { '': 'si', si: 'no', no: '' };
var MARCA_ICO = { si: '✅', no: '❌', '': '' };
function abrirRun(p) {
    if (!p) return;
    /* Se sella CUÁNDO empezó: la hora de envío sola no dice si el check tomó
       tres minutos o dos horas, que es justo lo que interesa revisar. */
    RUN = { plant: p, marcas: {}, fotos: [], inicioTs: new Date().toISOString(), horaInicio: horaStr() };
    var t = TIPO_CHK[p.tipo] || ['📋', p.tipo || ''];
    mostrar('pRun', p.nombre || 'Check list', t[1], true, true);
    $('btnEnviar').textContent = 'Enviar el check list';
    $('runNota').value = '';
    pintarTareas(); pintarFotosRun(); barraMsg('');
}
function pintarTareas() {
    var tareas = (RUN.plant.tareas || []);
    $('runTareas').innerHTML =
        '<div class="run-ayuda">Toca cada tarea: una vez ✅ cumplida, otra ❌ no se pudo, ' +
        'otra la deja pendiente.</div>' +
        tareas.map(function (t) {
            var est = RUN.marcas[t.id] || '';
            return '<button class="tarea ' + est + '" data-t="' + etx(t.id) + '">' +
                '<span class="tarea-txt">' + (t.freq ? '<span class="tarea-freq">' + etx(t.freq) + '</span>' : '') +
                etx(t.texto || '') + '</span>' +
                '<span class="tarea-marca">' + (MARCA_ICO[est] || '') + '</span></button>';
        }).join('');
    $('runTareas').onclick = function (e) {
        var b = e.target.closest('[data-t]'); if (!b) return;
        var id = b.getAttribute('data-t');
        RUN.marcas[id] = MARCA_SIG[RUN.marcas[id] || ''];
        pintarTareas();
    };
    cuentaRun();
}
function cuentaRun() {
    var tot = (RUN.plant.tareas || []).length;
    var ok = 0, no = 0;
    Object.keys(RUN.marcas).forEach(function (k) {
        if (RUN.marcas[k] === 'si') ok++; else if (RUN.marcas[k] === 'no') no++;
    });
    var hechas = ok + no;
    var pct = tot ? Math.round(ok / tot * 100) : 0;
    $('runProgBar').style.width = (tot ? Math.round(hechas / tot * 100) : 0) + '%';
    $('runCuenta').textContent = hechas + '/' + tot + (no ? ' · ' + no + ' ✕' : '');
    /* Se puede enviar incompleto: un turno que se corta a la mitad es un dato,
       no un error. Lo que no se marcó queda como pendiente y se ve en el
       reporte. */
    $('btnEnviar').disabled = false;
    return { tot: tot, ok: ok, no: no, pct: pct };
}
async function tomarFotoRun(input) { await _fotosA(input, RUN.fotos, pintarFotosRun); }
function pintarFotosRun() { _pintarFotos($('runFotos'), RUN.fotos, pintarFotosRun); }

async function enviarRun() {
    if (!RUN) return;
    if (RUN.fotos.some(function (f) { return f.subiendo; })) { barraMsg('Espera a que suban las fotos.', 'err'); return; }
    if (!navigator.onLine) { barraMsg('Sin internet. Vuelve a tocar Enviar cuando haya señal.', 'err'); return; }
    var c = cuentaRun();
    var pend = c.tot - c.ok - c.no;
    $('btnEnviar').disabled = true; barraMsg('Enviando…');
    var refs = RUN.fotos.filter(function (f) { return f.ref; }).map(function (f) { return f.ref; });
    var entry = {
        plantillaId: RUN.plant.id, plantillaNombre: RUN.plant.nombre || '', tipo: RUN.plant.tipo || '',
        sucursalId: SUC, area: AREA_COLAB || '',
        fecha: hoyStr(), hora: horaStr(),
        horaInicio: RUN.horaInicio, inicioTs: RUN.inicioTs, finTs: new Date().toISOString(),
        duracionMin: Math.max(0, Math.round((Date.now() - Date.parse(RUN.inicioTs)) / 60000)),
        marcas: RUN.marcas, totalTareas: c.tot, cumplidas: c.ok, noRealizadas: c.no,
        pendientes: pend, pct: c.pct,
        notas: ($('runNota').value || '').trim(),
        foto_url: refs[0] || '', foto_urls: refs,
        registrado: new Date().toISOString()
        // `colaborador` lo sella el servidor desde el NIP validado
    };
    try {
        var r = await _supabase.rpc('checklist_registrar',
            { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH, p_datos: entry });
        if (r.error) { $('btnEnviar').disabled = false; barraMsg('No se pudo guardar: ' + r.error.message, 'err'); return; }
        RUN = null;
        toast('✓ Check list enviado · ' + c.pct + '% cumplido', 'ok');
        irMenu();
    } catch (e) {
        $('btnEnviar').disabled = false;
        barraMsg('No se pudo guardar: ' + ((e && e.message) || e), 'err');
    }
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
    if (!_SA()) return true;
    if ((FLUJO === 'merma' || FLUJO === 'salida') && SUB.que === 'producto') {
        var t = String((x && x.tipo) || '').toLowerCase();
        var ar = t.indexOf('bebida') >= 0 ? 'barra' : (t.indexOf('aliment') >= 0 ? 'cocina' : '');
        if (!ar) return true;                       // sin tipo: no se puede saber
        var mia = _SA().norm(AREA_COLAB);
        if (mia !== 'barra' && mia !== 'cocina') return true;
        return ar === mia;
    }
    return _SA().veInsumo(AREA_COLAB, x);
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
/* La identidad que distingue un producto de su hermano: contenido, variedad y
   marca. Misma redacción que el QR del navegador (_insMetaParts en
   entrada.html): si las dos pantallas rotularan distinto, el mismo conteo se
   leería de dos maneras según por dónde se mire. */
function metaIns(x) {
    if (!x) return '';
    var partes = [];
    var cont = x.contNeto ? (x.contNeto + ' ' + String(x.umContenido || 'ML').toLowerCase()) : '';
    if (cont) partes.push('📦 ' + cont);
    var sub = [x.variedad, x.marca].filter(Boolean).join(' · ');
    if (sub) partes.push(sub);
    return partes.join(' · ');
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
    var _em = $('elegidoMeta'); if (_em) _em.textContent = metaIns(x);
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
        /* Se guarda al AGREGAR, no al mandar: cuando el lote sale, SEL ya es
           otro producto y la identidad del primero se habría perdido. */
        meta: metaIns(SEL),
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
            /* El meta primero: en una lista de ocho renglones es lo que
               distingue las tres Bohemias que se acaban de agregar. */
            var det = [it.meta, it.tipo, it.motivo, it.salidaTipo].filter(Boolean).join(' · ');
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
/* Una sola implementación de fotos para los dos flujos que las usan —el lote de
   registro y el checklist—. Con dos copias, el día que cambie el tope o la
   compresión, una de ellas se queda atrás sin que nadie lo note. */
async function _fotosA(input, arr, repintar) {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    for (var i = 0; i < files.length; i++) {
        if (arr.length >= MAX_FOTOS) { toast('Van ' + MAX_FOTOS + ' fotos, que es el tope.', 'err'); break; }
        var marca = { id: genId(), ref: '', subiendo: true, prev: '' };
        try { marca.prev = URL.createObjectURL(files[i]); } catch (e) {}
        arr.push(marca); repintar();
        var ref = await subirFoto(files[i]);
        marca.subiendo = false;
        if (ref) marca.ref = ref;
        else {
            /* La foto que no subió se SACA de la lista: dejarla haría creer que
               la evidencia quedó guardada cuando no existe en ningún lado. */
            var k = arr.indexOf(marca); if (k >= 0) arr.splice(k, 1);
            toast('No se pudo subir esa foto.', 'err');
        }
        repintar();
    }
}
function _pintarFotos(cont, arr, repintar) {
    if (!cont) return;
    cont.innerHTML = arr.map(function (f) {
        return '<div class="foto-th">' + (f.prev ? '<img src="' + f.prev + '" alt="">' : '') +
            (f.subiendo ? '<div class="foto-sub">subiendo…</div>'
                        : '<button data-foto="' + f.id + '" aria-label="Quitar">✕</button>') + '</div>';
    }).join('');
    cont.onclick = function (e) {
        var b = e.target.closest('[data-foto]'); if (!b) return;
        var id = b.getAttribute('data-foto');
        var k = -1;
        arr.forEach(function (f, i) { if (f.id === id) k = i; });
        if (k >= 0) arr.splice(k, 1);
        repintar();
    };
}
async function tomarFoto(input) { await _fotosA(input, FOTOS, pintarFotos); }
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
function pintarFotos() { _pintarFotos($('fotos'), FOTOS, pintarFotos); }

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
        insumoId: it.insumoId, nombre: it.nombre, cantidad: it.cantidad, unidad: it.unidad,
        /* Viaja con el conteo: el historial lo arma el servidor y ahí no está
           el catálogo. Sin esto, tres conteos de tres Bohemias distintas se
           leen como tres renglones idénticos que dicen «Bohemia». */
        meta: it.meta || ''
    });
}

var _enviando = false;
async function enviarLote() {
    /* El botón de la barra es UNO solo y sirve a dos pantallas. Aquí se decide
       a cuál: con el checklist abierto, manda el checklist. Tener dos botones
       distintos abajo sería dos sitios donde mirar. */
    if (RUN) { await enviarRun(); return; }
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

/* ══ RECETARIO OPERATIVO ═══════════════════════════════════════════════════
   La ficha de cómo se prepara, SIN un solo costo. Eso no lo decide esta
   pantalla: portal_recetas arma cada receta campo por campo con lista blanca y
   el dinero simplemente no viaja. Pedirla así —y no «la receta completa»— es lo
   que hace que mañana, cuando alguien agregue un campo con un precio adentro,
   no se filtre solo. */
async function abrirRecetario() {
    mostrar('pRecetas', 'Recetario', 'cómo se prepara', true, false);
    if (RECETARIO === null) {
        $('recLista').innerHTML = '<div class="hvacio">Cargando…</div>';
        if (!navigator.onLine) {
            $('recLista').innerHTML = '<div class="sinred">Sin internet. El recetario se lee del servidor.</div>';
            return;
        }
        try {
            var r = await _supabase.rpc('portal_recetas',
                { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH });
            RECETARIO = (r && r.data) || [];
        } catch (e) { RECETARIO = []; }
        _recFiltro = ''; _recTab = '';
        $('recBuscar').value = '';
    }
    pintarRecetario();
}
function filtrarRecetario(q) { _recFiltro = String(q || ''); pintarRecetario(); }
var TIPO_REC = { bebidas:'🍸 Bebidas', 'sub-bebidas':'🧪 Preparados', alimentos:'🍳 Alimentos',
                 'sub-alimentos':'🥣 Bases' };
function pintarRecetario() {
    var todas = RECETARIO || [];
    /* Las pestañas salen de lo que de verdad hay: enseñar «Bebidas» a una
       cocina que no tiene ninguna es una pestaña que solo da clics en vacío. */
    var tipos = [];
    todas.forEach(function (r) { if (r.tipo && tipos.indexOf(r.tipo) < 0) tipos.push(r.tipo); });
    $('recTabs').innerHTML = (tipos.length > 1)
        ? '<button class="chip-b' + (!_recTab ? ' on' : '') + '" data-tab="">Todas</button>' +
          tipos.map(function (t) {
              return '<button class="chip-b' + (_recTab === t ? ' on' : '') + '" data-tab="' + etx(t) + '">' +
                     (TIPO_REC[t] || etx(t)) + '</button>';
          }).join('')
        : '';
    $('recTabs').onclick = function (e) {
        var b = e.target.closest('[data-tab]'); if (!b) return;
        _recTab = b.getAttribute('data-tab'); pintarRecetario();
    };

    var q = _recFiltro.trim().toLowerCase();
    var pal = q ? q.split(/\s+/) : [];
    var lista = todas.filter(function (r) {
        if (_recTab && r.tipo !== _recTab) return false;
        if (!pal.length) return true;
        var txt = [r.nombre, r.grupo, r.categoria].join(' ').toLowerCase();
        return pal.every(function (p) { return txt.indexOf(p) >= 0; });
    });
    $('recLista').innerHTML = lista.length
        ? lista.map(function (r, i) {
            var ico = (String(r.tipo || '').indexOf('bebida') >= 0) ? '🍸' : '🍳';
            var meta = [r.grupo, r.categoria].filter(Boolean).join(' · ');
            return '<button class="rec-it" data-rec="' + i + '"><span class="rec-it-ico">' + ico + '</span>' +
                '<span style="flex:1;min-width:0"><b>' + etx(r.nombre || '—') + '</b>' +
                (meta ? '<small>' + etx(meta) + '</small>' : '') + '</span>' +
                '<span style="color:var(--dim)">›</span></button>';
        }).join('')
        : '<div class="hvacio">' + (q ? 'Nada con «' + etx(q) + '».' : 'No hay recetas para tu área.') + '</div>';
    $('recLista').onclick = function (e) {
        var b = e.target.closest('[data-rec]'); if (!b) return;
        verReceta(lista[parseInt(b.getAttribute('data-rec'), 10)]);
    };
}
function verReceta(r) {
    if (!r) return;
    mostrar('pReceta', r.nombre || 'Receta', [r.grupo, r.categoria].filter(Boolean).join(' · '), true, false);
    var ings = r.ingredientes || [];
    var cx = r.camposExtra || {};
    var chips = [];
    if (r.cristaleria) chips.push('🥃 ' + r.cristaleria);
    if (r.tiempo)      chips.push('⏱️ ' + r.tiempo);
    Object.keys(cx).forEach(function (k) { if (cx[k]) chips.push(k + ': ' + cx[k]); });

    $('recFicha').innerHTML =
        (r.foto ? '<img class="ficha-foto" src="' + etx(r.foto) + '" alt="" loading="lazy">' : '') +
        '<div class="ficha-tit">' + etx(r.nombre || '—') + '</div>' +
        (chips.length ? '<div class="ficha-meta">' + chips.map(function (c) {
            return '<span class="rs-chip chip-b" style="min-height:0;padding:5px 11px;font-size:12px">' +
                   etx(c) + '</span>'; }).join('') + '</div>' : '<div style="height:12px"></div>') +
        (ings.length
            ? '<div class="ficha-sec">Lleva</div>' + ings.map(function (i) {
                return '<div class="ficha-ing"><span>' + etx(i.nombre || '—') +
                    (i.desc ? '<small>' + etx(i.desc) + '</small>' : '') + '</span>' +
                    '<b>' + etx([i.cantidad, i.unidad].filter(Boolean).join(' ')) + '</b></div>';
              }).join('')
            : '') +
        (r.procedimiento
            ? '<div class="ficha-sec">Cómo se hace</div><div class="ficha-proc">' +
              etx(r.procedimiento) + '</div>'
            : '<div class="ficha-sec">Cómo se hace</div><div class="hvacio" style="padding:20px 0">' +
              'Esta receta todavía no tiene el procedimiento escrito.</div>');
}

/* ══ GUÍAS DE USO ══════════════════════════════════════════════════════════ */
async function abrirGuias() {
    mostrar('pGuias', 'Guías de uso', 'manuales de ETAAX', true, false);
    if (GUIAS === null) {
        $('guiasLista').innerHTML = '<div class="hvacio">Cargando…</div>';
        if (!navigator.onLine) {
            $('guiasLista').innerHTML = '<div class="sinred">Sin internet. Las guías se leen del servidor.</div>';
            return;
        }
        try {
            var r = await _supabase.rpc('portal_guias', { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH });
            GUIAS = (r && r.data) || [];
        } catch (e) { GUIAS = []; }
    }
    $('guiasLista').innerHTML = (GUIAS && GUIAS.length)
        ? GUIAS.map(function (g) {
            /* target=_blank + rel=noopener: sin eso, la página abierta puede
               manipular la que la abrió. Y en una app instalada, salir a un PDF
               sin pestaña nueva deja al colaborador sin forma de volver. */
            return '<a class="guia-it" href="' + etx(g.url || '#') + '" target="_blank" rel="noopener">' +
                '<span class="rec-it-ico">' + (String(g.tipo || '') === 'video' ? '🎬' : '📄') + '</span>' +
                '<span style="flex:1;min-width:0"><b>' + etx(g.titulo || '—') + '</b>' +
                (g.descripcion ? '<small>' + etx(g.descripcion) + '</small>' : '') + '</span>' +
                '<span style="color:var(--dim)">↗</span></a>';
        }).join('')
        : '<div class="hvacio">Todavía no hay guías publicadas.</div>';
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

    /* Un conteo se mira para saber CUÁNTO se contó y DE CUÁL — no a qué hora.
       Esta pantalla decía el nombre y la hora, que es justo lo que no hace
       falta. (El `cerradas*` viene del QR del navegador y `cantidad` de aquí:
       los dos flujos escriben en la misma tabla y la lista los lee a los dos.) */
    function filaConteo(c) {
        var pz = [];
        if (c.cerradasBodega !== '' && c.cerradasBodega != null) pz.push(c.cerradasBodega + ' bodega');
        if (c.cerradasBarra  !== '' && c.cerradasBarra  != null) pz.push(c.cerradasBarra + ' barra');
        if (!pz.length && c.cantidad) pz.push(c.cantidad + (c.unidad ? ' ' + c.unidad : ''));
        var cant = pz.join(' · ');
        /* Los conteos VIEJOS no traen `meta` —se empezó a guardar con esta
           entrega— así que se resuelven contra el catálogo ya cargado. */
        var m = c.meta;
        if (!m && c.insumoId) {
            var ins = (INSUMOS || []).find(function (x) { return x.id === c.insumoId; });
            if (ins) m = metaIns(ins);
        }
        return fila('📋', (c.nombre || '—') + (cant ? '  ·  ' + cant : ''),
            ['Conteo', m, (c.fecha || '')].filter(Boolean).join(' · ') + horaDe(c), c.quien);
    }

    var f = _HIST.filtro, html = '';
    if (f === 'conteo') {
        html = _HIST.cnts.map(function (c) {
            return filaConteo(c);
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
                return filaConteo(c);
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
/* ¿ESTA ventana ES la app instalada? Ojo con el alcance: esto contesta cómo se
   está viendo AHORA, no si existe una copia instalada en el teléfono. Abrir la
   misma dirección en el navegador da `false` aunque el ícono ya esté en la
   pantalla de inicio — y ahí es donde la tarjeta de instalar volvía a salir
   después de instalarla. Por eso hay tres caminos más, abajo. */
function esStandalone() {
    try {
        return window.matchMedia('(display-mode: standalone)').matches ||
               navigator.standalone === true;
    } catch (e) { return false; }
}

/* ══ ¿YA ESTÁ INSTALADA EN ESTE TELÉFONO? ══════════════════════════════════
   Tres maneras, porque ninguna sola alcanza:

   1. SE USÓ COMO APP alguna vez. Al abrir desde el ícono se deja una marca; de
      ahí en adelante el navegador del mismo teléfono ya sabe que existe.
      OJO CON IPHONE: la app agregada a la pantalla de inicio tiene su PROPIO
      almacenamiento, separado del de Safari. La marca que se escribe adentro
      NO la ve Safari. Sirve en Android; en iPhone hace falta la tercera.

   2. SE LO PREGUNTAMOS AL NAVEGADOR (getInstalledRelatedApps). Chrome en
      Android sabe contestarlo —por eso el manifest se declara a sí mismo como
      app relacionada—. Safari no tiene nada parecido.

   3. LO DICE LA PERSONA: «ya la tengo». Es la única que funciona en todos
      lados, y por eso existe. No es un parche: cuando el sistema no puede
      saber algo, preguntarlo una vez es mejor que insistir para siempre. */
var MARCA_INST = 'etaax_appmovil_instalada';
function _marcar(v) { try { localStorage.setItem(MARCA_INST, v); } catch (e) {} }
function _marca()   { try { return localStorage.getItem(MARCA_INST) || ''; } catch (e) { return ''; } }

function yaInstalada() {
    if (esStandalone()) return true;
    return _marca() === 'si' || _marca() === 'dicho';
}
/* Se corre al arrancar: si Chrome contesta que sí, se deja la marca y la
   tarjeta no vuelve a salir en ese navegador. */
async function detectarInstalada() {
    if (esStandalone()) { _marcar('si'); return; }
    try {
        if (!navigator.getInstalledRelatedApps) return;
        var apps = await navigator.getInstalledRelatedApps();
        if (apps && apps.length) { _marcar('si'); pintarInstalar(); }
    } catch (e) { /* el navegador no sabe contestar: queda el botón de «ya la tengo» */ }
}
/* «Ya la tengo»: la persona lo sabe aunque el navegador no. */
function yaLaTengo() { _marcar('dicho'); pintarInstalar(); toast('Listo, no te la vuelvo a ofrecer.', 'ok'); }
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
    if (yaInstalada()) { el.hidden = true; return; }    // ya está: no se ofrece de nuevo

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
                'y a pantalla completa.</div>' + _btnYaLaTengo()
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
        'Queda un ícono y ya no hay que escanear el QR cada vez.</small>' + _btnYaLaTengo();
    el.hidden = false;
}
/* Safari no tiene forma de decirnos si ya está instalada, y en iPhone el
   almacenamiento de la app agregada ni siquiera se comparte con el navegador.
   Cuando el sistema no puede saberlo, se pregunta una vez. */
function _btnYaLaTengo() {
    return '<button class="ya-tengo" onclick="yaLaTengo()">Ya la tengo instalada — no me lo vuelvas a mostrar</button>';
}

window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); _instalador = e; pintarInstalar();
});
/* Android avisa cuando la instalación terminó, incluso si se hizo desde el menú
   del navegador y no desde nuestro botón. Es la señal más confiable que hay. */
window.addEventListener('appinstalled', function () {
    _marcar('si'); _instalador = null; pintarInstalar();
});
async function instalar() {
    if (!_instalador) { pintarInstalar(); return; }
    _instalador.prompt();
    try {
        var r = await _instalador.userChoice;
        /* Si aceptó, se deja la marca aquí mismo: el evento `appinstalled` no
           siempre llega —depende del navegador— y sin esto la tarjeta volvería
           a salir en la siguiente apertura, que es justo lo que se corrigió. */
        if (r && r.outcome === 'accepted') _marcar('si');
    } catch (e) {}
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
window.addEventListener('DOMContentLoaded', async function () {
    pintarTeclado(); pintarPuntos();
    $('loginAviso').innerHTML = 'Tu NIP dice quién registró qué.<br>Si no lo tienes, pídeselo a tu encargado.';
    /* Si hay sesión guardada, cuenta.js se encarga —pidiendo huella o PIN si hay
       candado— y la portada no se llega a ver. Si no, se muestra. */
    var conSesion = false;
    try { conSesion = window._cuenta ? await window._cuenta.alAbrir() : false; } catch (e) {}
    if (!conSesion) verInicio();
});

/* Lo que el HTML llama por onclick. */
window.toggleTema = toggleTema;
window.verInicio = verInicio;
window.verCuenta = verCuenta;
window.verHome = verHome;
window.irNip = irNip;
window.mostrarCuenta = mostrarCuenta;
window.toastC = toastC;
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
window.yaLaTengo = yaLaTengo;
window.abrirChecklists = abrirChecklists;
window.abrirRecetario = abrirRecetario;
window.filtrarRecetario = filtrarRecetario;
window.abrirGuias = abrirGuias;
window.tomarFotoRun = tomarFotoRun;

/* Para poder probarlo desde la consola y desde el candado. */
window._appMovil = {
    areasPermitidas: areasPermitidas, setArea: setArea, visible: visible,
    unoPorProducto: unoPorProducto, enSuc: enSuc, armarRegistro: armarRegistro,
    horaDe: horaDe, esIOS: esIOS, esSafari: esSafari, esStandalone: esStandalone,
    pintarInstalar: pintarInstalar, yaInstalada: yaInstalada, detectarInstalada: detectarInstalada,
    yaLaTengo: yaLaTengo, pintarPortal: pintarPortal, cuentaRun: cuentaRun,
    _setRun: function (r) { RUN = r; },
    _set: function (k, v) {
        if (k === 'AREA_COLAB') AREA_COLAB = v; if (k === 'AREA') AREA = v;
        if (k === 'FLUJO') FLUJO = v; if (k === 'SUB') SUB = v;
        if (k === 'SUC') SUC = v; if (k === 'LOTE') LOTE = v; if (k === 'FOTOS') FOTOS = v;
    },
    _get: function (k) { return { AREA: AREA, AREA_COLAB: AREA_COLAB, FLUJO: FLUJO, LOTE: LOTE }[k]; }
};

})();
