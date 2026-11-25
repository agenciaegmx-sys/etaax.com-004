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
var PLANTILLAS = [], RECETARIO = null;
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
    _pintarTemaIco();
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

function _pintarTemaIco() {
    var claro = document.documentElement.getAttribute('data-tema') === 'claro';
    var el = $('temaIco'); if (!el) return;
    /* La luna se ofrece en el claro y el sol en el oscuro: el botón dice a qué cambia. */
    el.innerHTML = _ic(claro ? 'hd-luna' : 'hd-sol', claro ? '☾' : '☀');
}

/* ── Navegación entre pantallas ── */
var PANTS = ['pInicio', 'pCandado', 'pPin', 'pHome', 'pMenu', 'pModulo',
             'pFlujo', 'pHist', 'pChecks', 'pRun', 'pRecetas', 'pReceta', 'pHorarios', 'pEvals'];
var _PANT = '';
/* La barra del título (con su regreso) sale solo en las pantallas de adentro:
   en la portada y en los inicios el contenido se presenta solo. */
function mostrar(id, titulo, sub, conVolver, conBarra) {
    PANTS.forEach(function (p) { var e = $(p); if (e) e.hidden = (p !== id); });
    $('hdrTit').textContent = titulo;
    $('hdrSub').textContent = sub || '';
    $('titBarra').hidden = !conVolver;
    $('barra').hidden = !conBarra;
    document.body.classList.toggle('con-barra', !!conBarra);
    _PANT = id;
    cerrarCajon();
    pintarCabecera();
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
   (25-nov) Por default, la CLAVE: el teclado del NIP a la vista, que es lo que
   usa el equipo. Abajo, desplegable, el usuario y la contraseña. */
function verInicio() {
    /* La clave solo sirve si la app sabe de qué negocio es. Sin eso NO se
       esconde: se APAGA, se dice cómo conseguirlo y se abre la cuenta, que es
       una de las dos maneras:
         · que alguien entre UNA vez con su cuenta (el encargado configura el
           teléfono y su equipo ya solo usa su clave);
         · o abrir el QR de tu sucursal, que trae las credenciales. */
    var listo = !!(NEG && TOKEN);
    NIP = ''; pintarPuntos(); $('nipMsg').textContent = '';
    $('nipZona').classList.toggle('apagada', !listo);
    $('inicioSub').textContent = listo ? ((NEG_NOM ? NEG_NOM + ' · ' : '') + 'tu NIP de 5 dígitos') : 'Este teléfono todavía no está ligado';
    $('inicioAviso').innerHTML = listo
        ? 'Tu clave dice quién registró qué. Si no la tienes, pídesela a tu encargado.'
        : '<b style="color:var(--txt)">¿Eres de barra o cocina?</b><br>' +
          'Pídele a tu encargado que entre una vez con su cuenta aquí abajo, o abre el ' +
          '<b>QR de tu sucursal</b>. Después entras solo con tu clave.';
    _usuarioAbierto(!listo);
    mostrar('pInicio', 'Entrar', '', false, false);
}
function _usuarioAbierto(si) {
    $('cuentaForm').hidden = !si;
    $('btnUsuario').setAttribute('aria-expanded', si ? 'true' : 'false');
    if (si) {
        var c = window._cuenta ? window._cuenta.correo() : '';
        if (c && !$('ctaCorreo').value) $('ctaCorreo').value = c;
    }
}
function toggleUsuario() {
    var abrir = $('cuentaForm').hidden;
    _usuarioAbierto(abrir);
    if (abrir) { $('ctaMsg').textContent = ''; setTimeout(function () { try { $('cuentaForm').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }, 60); }
}
/* Nombres de antes: la clave y la cuenta viven ahora en la misma portada. */
function irNip() { verInicio(); }
function verCuenta() {
    verInicio();
    $('ctaMsg').textContent = '';
    _usuarioAbierto(true);
}
/* cuenta.js no conoce las pantallas: se las pide a la cáscara por aquí. */
function mostrarCuenta(id, tit, sub) { mostrar(id, tit, sub, true, false); }
function toastC(m, c) { toast(m, c); }

/* ══ EL MENÚ DE LA CUENTA ══════════════════════════════════════════════════
   Los módulos llegan por fases. Lo que todavía no está se enseña APAGADO y
   diciendo dónde sí se hace: esconderlo haría pensar que la app está rota o
   incompleta, y eso es lo que hace que nadie la vuelva a abrir. */
var MODULOS_CUENTA = [
    { app:'costax', mod:'Cost\u00b7ax',  lema:'Insumos, recetas e inventarios del negocio', items:[
        { ic:'cat-insumos',    resp:'🥃', tit:'Insumos',     sub:'Consultar, corregir precios, agregar uno', fn:'' },
        { ic:'cat-recetas',    resp:'📖', tit:'Recetas',     sub:'Consultar y crear una sencilla', fn:'' },
        { ic:'mod-inventarios',resp:'📦', tit:'Inventarios', sub:'El último cierre y lo registrado', fn:'' } ] },
    { app:'finax',  mod:'Admin\u00b7ax', lema:'Ingresos y egresos del día', items:[
        { ic:'fin-gastos',     resp:'💸', tit:'Agregar un gasto', sub:'Con su foto, desde donde estés', fn:'' },
        { ic:'cor-corte-caja', resp:'🧾', tit:'Ver los cortes',   sub:'Lo capturado en la computadora', fn:'' } ] },
    { app:'finax',  mod:'Fin\u00b7ax',   lema:'La salud financiera del negocio', items:[
        { ic:'fin-resumen-resultados', resp:'📊', tit:'Resultados', sub:'El resumen del mes y las estadísticas', fn:'' } ] },
    { app:'equipax', mod:'Equip\u00b7ax', lema:'Tu equipo', items:[
        { ic:'sto-horarios',   resp:'🗓️', tit:'Horarios del equipo', sub:'El rol de la semana', fn:'' },
        { ic:'sto-checklists', resp:'✅', tit:'Check lists',         sub:'Lo que se cumplió en cada turno', fn:'' } ] }
];
/* Las apps del NEGOCIO para la cuenta: la base y las de cada sucursal juntas
   (la cuenta no está atada a una sucursal). null = no se sabe → se ve todo. */
var APPS_CTA = null;
function _appsDelPlan(plan) {
    if (!plan) return 'suite';
    var junta = [], suite = false;
    var suma = function (x) {
        if (x == null || x === 'suite') { suite = true; return; }
        (Array.isArray(x) ? x : [x]).forEach(function (a) { if (junta.indexOf(a) < 0) junta.push(a); });
    };
    suma(plan.base);
    Object.keys(plan.sucursales || {}).forEach(function (k) { suma(plan.sucursales[k]); });
    return suite ? 'suite' : junta;
}
function _ctaTiene(app) { return APPS_CTA === null || APPS_CTA === 'suite' || APPS_CTA.indexOf(app) > -1; }
function verHome() {
    var ses = _sesionInfo();
    $('homeQuien').innerHTML = '<b>Hola, ' + etx(_primerNombre(ses.nombre)) + '</b>' +
        (ses.det ? '<small>' + etx(ses.det) + '</small>' : '') +
        (NEG && TOKEN ? '<small style="color:var(--verde);margin-top:4px">✓ Tu equipo ya puede entrar con su clave en este teléfono</small>' : '');
    pintarHome();
    mostrar('pHome', 'Tu cuenta', '', false, false);
    /* El plan se pide con la sesión de la cuenta. Si no se puede (sin red, sin
       la v89), se queda viendo todo: esconder por un error dejaría a un dueño
       sin sus módulos. */
    var cli = window._cuenta && typeof window._cuenta.cliente === 'function' ? window._cuenta.cliente() : null;
    if (cli && NEG) {
        cli.rpc('negocio_plan', { p_neg: NEG }).then(function (r) {
            if (r && !r.error) { APPS_CTA = _appsDelPlan(r.data); pintarHome(); }
        }).catch(function () {});
    }
}
function pintarHome() {
    var visibles = MODULOS_CUENTA.filter(function (g) { return _ctaTiene(g.app); });
    $('homeMenu').innerHTML = visibles.map(function (g) {
        return '<div class="modulo modulo-cta"><span class="modulo-col">' + _islaHTML(g.mod) +
            '<span class="modulo-txt">' + etx(g.lema) + '</span></span></div>' +
            '<div class="rejilla" style="margin:-4px 0 18px">' + g.items.map(function (m) {
                var listo = !!m.fn;
                return _rect(_ic(m.ic, m.resp), m.tit, m.sub + (listo ? '' : ' · pronto'), m.fn);
            }).join('') + '</div>';
    }).join('') +
    '<div class="avisos" style="margin-top:6px;text-align:left">Esta app es una <b>beta</b>: lo que ' +
    'todavía no está aquí se sigue haciendo desde la computadora, igual que siempre.</div>';
}
window._appCuentaLista = verHome;
window._appCuentaFuera = verInicio;

/* ══ LA CABECERA Y EL MENÚ DE TRES LÍNEAS ═════════════════════════════════
   Quién está en sesión sale de la clave (COLAB) o de la cuenta (cuenta.js).
   Es lo mismo en el navegador y en la app instalada: la única diferencia es
   que la tarjeta de «Instalar» ya no se ofrece donde ya está instalada, y vive
   aquí dentro, no en las pantallas. */
function _sesionInfo() {
    if (COLAB) {
        var area = (window.StaffArea && AREA_COLAB) ? StaffArea.nom(AREA_COLAB).replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/, '') : '';
        return { tipo: 'clave', nombre: COLAB, estado: 'Sesión activa',
                 det: [PUESTO, area, NEG_NOM].filter(Boolean).join(' · ') };
    }
    var cta = window._cuenta;
    if (cta && cta.sesion && cta.sesion()) {
        var p = (typeof cta.perfil === 'function' && cta.perfil()) || null;
        return { tipo: 'cuenta', nombre: (p && p.nombre) || cta.correo() || 'Tu cuenta', estado: 'Sesión activa',
                 det: [(p && p.puesto) || (p ? '' : cta.correo()), NEG_NOM].filter(Boolean).join(' · ') };
    }
    return { tipo: '', nombre: 'Sin sesión', estado: NEG && TOKEN ? 'entra con tu clave' : 'entra con tu cuenta',
             det: NEG_NOM || 'Entra con tu clave o con tu cuenta' };
}
function _iniciales(n) {
    var p = String(n || '').trim().split(/\s+/).filter(Boolean);
    return ((p[0] || '').charAt(0) + (p[1] || '').charAt(0)).toUpperCase() || '·';
}
function pintarCabecera() {
    if (!$('hdrNombre')) return;
    var s = _sesionInfo();
    $('hdrNombre').textContent = s.tipo ? _primerNombre(s.nombre) : s.nombre;
    $('hdrEstado').textContent = s.estado;
    $('hdrEstado').classList.toggle('on', !!s.tipo);
    $('hdrAvatar').innerHTML = s.tipo ? etx(_iniciales(s.nombre)) : _ic('usuario', '');
}
function abrirCajon() {
    pintarCajon();
    $('cajon').hidden = false; $('cajonFondo').hidden = false;
    $('btnCajon').setAttribute('aria-expanded', 'true');
}
function cerrarCajon() {
    var c = $('cajon'); if (!c || c.hidden) return;
    c.hidden = true; $('cajonFondo').hidden = true;
    $('btnCajon').setAttribute('aria-expanded', 'false');
}
function _itCajon(ico, txt, accion, on) {
    return '<button class="cajon-it' + (on ? ' on' : '') + '" onclick="cerrarCajon();' + accion + '">' + ico + '<span>' + etx(txt) + '</span></button>';
}
function pintarCajon() {
    var s = _sesionInfo();
    $('cajonSesion').innerHTML = '<div class="cajon-sesion"><span class="hdr-avatar">' +
        (s.tipo ? etx(_iniciales(s.nombre)) : _ic('usuario', '')) + '</span><div style="min-width:0">' +
        '<b>' + etx(s.nombre) + '</b>' + (s.det ? '<small>' + etx(s.det) + '</small>' : '') +
        '<small style="color:' + (s.tipo ? 'var(--verde)' : 'var(--dim)') + '">' + etx(s.estado) + '</small></div></div>';
    var nav = '';
    if (s.tipo === 'clave') {
        nav += _itCajon(_ic('hd-inicio', '⌂'), 'Inicio', 'irInicio()', _PANT === 'pMenu');
        if (_tieneApp('costax')) nav += _itCajon(_ic('mod-recetas-insumos', '◆'), 'Cost·ax · inventario y recetas', "abrirModulo('costax')", _PANT === 'pModulo' && ULT_MOD === 'costax');
        if (_tieneApp('equipax')) nav += _itCajon(_ic('mod-equipax', '◆'), 'Equip·ax · tu turno', "abrirModulo('equipax')", _PANT === 'pModulo' && ULT_MOD === 'equipax');
    } else if (s.tipo === 'cuenta') {
        nav += _itCajon(_ic('hd-inicio', '⌂'), 'Inicio', 'verHome()', _PANT === 'pHome');
    } else {
        nav += _itCajon(_ic('aut-candado', '•'), 'Entrar con tu clave', 'verInicio()', _PANT === 'pInicio');
        nav += _itCajon(_ic('usuario', '•'), 'Entrar con usuario y contraseña', 'verCuenta()', false);
    }
    $('cajonNav').innerHTML = nav;
    var claro = document.documentElement.getAttribute('data-tema') === 'claro';
    $('cajonPie').innerHTML =
        _itCajon(_ic(claro ? 'hd-luna' : 'hd-sol', '◐'), claro ? 'Tema oscuro' : 'Tema claro', 'toggleTema()', false) +
        (s.tipo === 'clave' ? _itCajon(_ic('cerrar-sesion', '⎋'), 'Cerrar sesión', 'salir()', false) : '') +
        (s.tipo === 'cuenta' ? _itCajon(_ic('cerrar-sesion', '⎋'), 'Cerrar sesión', 'salirCuenta()', false) : '');
    pintarInstalar();
    detectarInstalada();
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
        if (rv.error) {
            /* Frenado por intentos (v78): se dice cuánto falta, no el error
               crudo. En un celular, el error crudo no se puede ni leer. */
            var _esp = (typeof etaaxNipEsperaMsg === 'function') ? etaaxNipEsperaMsg(rv) : '';
            $('nipMsg').textContent = _esp || ('No se pudo comprobar: ' + rv.error.message);
            NIP = ''; pintarPuntos(); _entrando = false; return;
        }
        if (!rv.data) {
            $('nipMsg').innerHTML = 'NIP no reconocido.<br>Pídele a tu encargado tu NIP de 5 dígitos.';
            NIP = ''; pintarPuntos(); _entrando = false; return;
        }
        COLAB = rv.data; NIPHASH = h;
        await cargarPerfil(h);
        /* El catálogo y los checklists se piden EN PARALELO: en serie son dos
           viajes a Supabase con la señal de una cocina, y el colaborador los
           espera mirando la pantalla de entrar. */
        await Promise.all([cargarInsumos(), cargarPlantillas(), cargarApps(), cargarEvals()]);
        ULT_MOD = '';
        irInicio();
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
    var _ins = null;
    /* Las DOS llaves (token del QR + NIP) para que el servidor mande solo las
       fichas de la sucursal donde trabaja quien entra, y acotadas: la consulta
       vieja entregaba la ficha completa de todos los insumos del negocio, con
       precios y proveedor (v80). Cae a la vieja si la v80 no se corrió: las
       migraciones se aplican a mano. */
    if (NIPHASH) {
        try {
            var rc = await _supabase.rpc('entrada_catalogo', { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH });
            if (rc && rc.data && rc.data.ok) {
                _ins = rc.data.insumos || [];
                if (rc.data.sucursal) SUC = rc.data.sucursal;
            }
        } catch (e) { /* v80 sin correr */ }
    }
    if (_ins === null) {
        var ri = await _supabase.rpc('entrada_insumos', { p_neg: NEG, p_token: TOKEN });
        _ins = ri.data || [];
    }
    INSUMOS = unoPorProducto(misInsumos(_ins));
    INSUMOS.sort(function (a, b) { return (a.nombre || '').localeCompare(b.nombre || ''); });
}
/* La MISMA regla de `/insumo-label.js` que usa el resto del sistema. Aquí vivía
   otra copia con el criterio invertido ("sin sucursal = en todas"), así que la
   app móvil repetía el defecto del QR: ofrecía los maestros del negocio entero
   en cualquier sucursal. Recetas e insumos se preguntan por separado porque no
   comparten criterio (ver entrada.html). */
function enSuc(x) {
    if (!SUC || !x) return true;
    if (typeof window._insumoActivoEnSuc === 'function') return window._insumoActivoEnSuc(x, SUC);
    var ss = (x.sucursales && x.sucursales.length) ? x.sucursales : (x.sucursalId ? [x.sucursalId] : null);
    if (!ss || !ss.length) return false;                   // maestro sin asignar: de ninguna
    for (var i = 0; i < ss.length; i++) { if ((ss[i] || 'suc_principal') === SUC) return true; }
    return false;
}
/* El filtro de sucursal con su red debajo — la misma de entrada.html: un
   catálogo que nunca se repartió sigue sirviendo; una sucursal a la que no le
   copiaron nada recibe la lista vacía a propósito. */
function misInsumos(lista) {
    var vivos = (lista || []).filter(function (x) { return x && x.id && x.activo !== '0'; });
    var mios  = vivos.filter(enSuc);
    if (!mios.length) {
        var repartido = vivos.some(function (x) { return (x.sucursales && x.sucursales.length) || x.sucursalId; });
        if (!repartido) return vivos;
    }
    return mios;
}
function enSucReceta(x) {
    if (!SUC || !x) return true;
    if (typeof window._recetaActivaEnSuc === 'function') return window._recetaActivaEnSuc(x, SUC);
    var ss = (x.sucursales && x.sucursales.length) ? x.sucursales : (x.sucursalId ? [x.sucursalId] : null);
    if (!ss || !ss.length) return SUC === 'suc_principal'; // receta legacy = Matriz
    for (var i = 0; i < ss.length; i++) { if ((ss[i] || 'suc_principal') === SUC) return true; }
    return false;
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

/* ══ 2 · EL INICIO Y EL REGRESO ════════════════════════════════════════════
   irInicio: los módulos (o la portada, o la cuenta). irMenu: «a donde estabas»
   —el módulo que se abrió, o el inicio—; es lo que llaman las pantallas al
   terminar (registrar un lote, mandar un check list). volver: la flecha. */
var ULT_MOD = '';
function _limpiarCaptura() { FLUJO = ''; SEL = null; LOTE = []; FOTOS = []; SUB = {}; RUN = null; }
function _cuentaActiva() { return !COLAB && !!(window._cuenta && window._cuenta.sesion && window._cuenta.sesion()); }
function irInicio() {
    if (!COLAB) { if (_cuentaActiva()) verHome(); else verInicio(); return; }
    ULT_MOD = ''; _limpiarCaptura();
    pintarSaludo();
    pintarPortal();
    mostrar('pMenu', 'Inicio', '', false, false);
}
function irMenu() {
    /* «Atrás» sin haber entrado: a la portada, no a un menú vacío de alguien
       que no se identificó. */
    if (!COLAB) { if (_cuentaActiva()) verHome(); else verInicio(); return; }
    if (ULT_MOD) { _limpiarCaptura(); abrirModulo(ULT_MOD); } else irInicio();
}
function volver() {
    if (_PANT === 'pModulo') { irInicio(); return; }
    if (_PANT === 'pRun') { RUN = null; abrirChecklists(); return; }
    if (_PANT === 'pCandado' || _PANT === 'pPin') { verInicio(); return; }
    irMenu();
}
function _primerNombre(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
function pintarSaludo() {
    var det = [PUESTO, (window.StaffArea && AREA_COLAB) ? StaffArea.nom(AREA_COLAB).replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/, '') : '', NEG_NOM]
                .filter(Boolean).join(' · ');
    $('quienCard').innerHTML = '<b>Hola, ' + etx(_primerNombre(COLAB)) + '</b>' + (det ? '<small>' + etx(det) + '</small>' : '');
}

function salir() {
    NIP = ''; NIPHASH = ''; COLAB = ''; PUESTO = ''; AREA_COLAB = '';
    /* TODO lo del turno anterior se borra. El teléfono de la barra lo usan
       varias personas: dejar el recetario o los checklists de quien acaba de
       salir le enseñaría al siguiente lo que no le toca. */
    INSUMOS = []; RECETAS = null; PLANTILLAS = []; RECETARIO = null; RUN = null;
    APPS = null; HORARIOS = null; EVALS = null; ULT_MOD = ''; _recQ = '';
    _abierto = { inventarios: false, recetas: false };
    pintarPuntos();
    $('nipMsg').textContent = '';
    verInicio();
}

/* ══ LO QUE SE VE CON LA CLAVE, POR MÓDULO ═══════════════════════════════
   Cada vista con su módulo de ETAAX —el mismo nombre que ve el dueño en la
   computadora—: Cost·ax (inventario y recetas), Equip·ax (el turno y el
   equipo), Learn·ax (las guías).

   LO NO CONTRATADO NO SE VE: es la regla de la v89, y la sucursal la pone el
   NIP (portal_apps, v91). Sin saber el plan (la v91 sin correr, sin red) se ve
   todo, como antes: esconder por un error dejaría al equipo sin trabajar.

   El recetario solo sale a quien cocina o prepara. No es un permiso —el
   servidor igual no les devolvería recetas— es no llenarles la pantalla con
   algo que no van a abrir nunca. */
var APPS = null;                 // null = no se sabe · 'suite' · ['costax', …]
var HORARIOS = null, EVALS = null;
function _tieneApp(app) {
    if (APPS === null || APPS === undefined || APPS === 'suite') return true;
    return Array.isArray(APPS) && APPS.indexOf(app) > -1;
}
async function cargarApps() {
    APPS = null;
    try {
        var r = await _supabase.rpc('portal_apps', { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH });
        if (r && !r.error && r.data) APPS = (r.data.apps == null) ? 'suite' : r.data.apps;
    } catch (e) { /* v91 sin correr: se ve todo */ }
}
/* Los íconos de la marca (etaax-iconos.js). Si el archivo no llegó —o es una
   copia vieja sin ese nombre—, se queda el respaldo: un menú sin dibujo es peor
   que uno con emoji. */
function _ic(nombre, respaldo) {
    var svg = (typeof window !== 'undefined' && typeof window.etaaxIcono === 'function') ? window.etaaxIcono(nombre, { tam: 26 }) : '';
    return svg || respaldo || '';
}
function _iconosEstaticos() {
    var els = document.querySelectorAll('[data-ic]');
    for (var i = 0; i < els.length; i++) { var s = _ic(els[i].getAttribute('data-ic'), ''); if (s) els[i].innerHTML = s; }
}
/* La cabecera de cada módulo: su nombre ·ax, como en la computadora. */
function _grupoMod(nombre, lema) {
    var k = String(nombre).indexOf('·');
    var nom = k > 0 ? etx(nombre.slice(0, k)) + '<i>·</i>' + etx(nombre.slice(k + 1)) : etx(nombre);
    return '<div class="mod-cab"><span class="mod-nom">' + nom + '</span><span class="mod-lema">' + etx(lema) + '</span></div>';
}
var MODS_INFO = {
    costax:  { nom: 'Cost·ax',  lema: 'Inventario y recetas',
               txt: 'Registra entradas, mermas, cortesías y existencias, y consulta cómo se prepara cada receta de tu área.' },
    equipax: { nom: 'Equip·ax', lema: 'Tu turno',
               txt: 'Tus horarios de la semana, tus check lists y, cuando las haya, tus evaluaciones.' }
};
function _islaHTML(nombre) {
    var k = String(nombre).indexOf('·');
    return '<span class="isla">' + (k > 0 ? etx(nombre.slice(0, k)) + '<i>·</i>' + etx(nombre.slice(k + 1)) : etx(nombre)) + '</span>';
}
var FLECHA = '<svg class="desplegar-fl" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
/* El inicio con la clave: un botón por módulo, como en el sistema. */
function pintarPortal() {
    var m = $('menuPortal');
    if (!m) return;
    var cost = _tieneApp('costax'), equip = _tieneApp('equipax'), h = '';
    if (cost) h += _botonModulo('costax');
    if (equip) h += _botonModulo('equipax');
    if (!cost && !equip) {
        h += '<div class="avisos" style="text-align:left">Tu sucursal todavía no tiene apps para el equipo en el ' +
             'teléfono. Pregúntale a tu encargado.</div>';
    }
    m.innerHTML = h;
    m.hidden = false;
}
function _botonModulo(id) {
    var i = MODS_INFO[id];
    return '<button class="modulo" data-mod="' + id + '" onclick="abrirModulo(\'' + id + '\')">' +
        '<span class="modulo-col">' + _islaHTML(i.nom) + '<span class="modulo-txt"><b>' + etx(i.lema) + '</b>' + etx(i.txt) + '</span></span>' +
        '<span class="fl" aria-hidden="true">›</span></button>';
}
function _opcion(ico, tit, sub, accion) { return _rect(ico, tit, sub, accion); }
/* Un rectángulo de la rejilla de dos columnas. Sin acción = apagado (se ve, no se esconde). */
function _rect(ico, tit, sub, accion) {
    var off = !accion;
    return '<button class="rect"' + (off ? ' disabled' : ' onclick="' + accion + '"') + '>' +
        '<span class="rect-ico">' + ico + '</span>' +
        '<span><b>' + etx(tit) + '</b>' + (sub ? '<small>' + etx(sub) + '</small>' : '') + '</span></button>';
}

/* ══ DENTRO DE UN MÓDULO ═══════════════════════════════════════════════════
   Cost·ax: dos desplegables —Inventarios y Recetas— con sus opciones en
   rectángulos de dos columnas. Las recetas son las de SU área (portal_recetas
   las filtra en el servidor), y el desplegable solo sale a quien cocina o
   prepara. Equip·ax: mis horarios, check list y, solo si el negocio tiene
   evaluaciones abiertas, evaluaciones. Qué quedó abierto se recuerda al volver. */
var _abierto = { inventarios: false, recetas: false };
function abrirModulo(id) {
    if (!MODS_INFO[id]) { irInicio(); return; }
    ULT_MOD = id;
    var i = MODS_INFO[id];
    /* La isla ya dice qué módulo es: la barra de arriba solo dice a dónde regresa. */
    mostrar('pModulo', 'Inicio', '', true, false);
    $('modCuerpo').innerHTML = pintarModulo(id);
    if (id === 'costax' && _abierto.recetas) _cargarRecetasRejilla();
}
function pintarModulo(id) {
    var i = MODS_INFO[id];
    var h = '<div class="mod-cabeza">' + _islaHTML(i.nom) + '<p>' + etx(i.txt) + '</p></div>';
    if (id === 'costax') {
        var a = window.StaffArea ? StaffArea.norm(AREA_COLAB) : '';
        var cocina = !a || a === 'barra' || a === 'cocina';
        h += _despl('inventarios', _ic('mod-inventarios', '📦'), 'Inventarios') +
            '<div class="rejilla" id="rejInventarios"' + (_abierto.inventarios ? '' : ' hidden') + '>' +
                _rect(_ic('ins-agregar', '📦'), 'Registrar entradas', 'Llegó mercancía', "abrirFlujo('entrada')") +
                _rect(_ic('ins-drenado', '🍷'), 'Registrar merma', 'Se rompió o se desperdició', "abrirFlujo('merma')") +
                _rect(_ic('cor-salida-efectivo', '🎁'), 'Registrar cortesía / préstamo', 'Salió sin ser venta', "abrirFlujo('salida')") +
                _rect(_ic('ins-stock', '📋'), 'Registrar existencias', 'Cuenta o pesa antes del inventario', "abrirFlujo('conteo')") +
                _rect(_ic('ins-historial', '🧾'), 'Ver lo registrado', 'Desde el último inventario', 'abrirHistorial()') +
            '</div>';
        if (cocina) {
            h += _despl('recetas', _ic('cat-recetas', '📖'), 'Recetas') +
                '<div class="rejilla" id="rejRecetas"' + (_abierto.recetas ? '' : ' hidden') + '></div>';
        }
    } else if (id === 'equipax') {
        var nE = (EVALS && EVALS.length) || 0, nC = PLANTILLAS.length;
        h += '<div class="rejilla">' +
            _rect(_ic('sto-horarios', '🗓️'), 'Ver mis horarios', 'Esta semana y la que sigue', 'abrirHorarios()') +
            _rect(_ic('sto-checklists', '✅'), 'Realizar check list',
                nC ? (nC + (nC === 1 ? ' disponible' : ' disponibles')) : 'Ninguno para tu área', nC ? 'abrirChecklists()' : '') +
            (nE ? _rect(_ic('sto-evaluaciones', '📝'), 'Evaluaciones', nE + (nE === 1 ? ' por realizar' : ' por realizar'), 'abrirEvaluaciones()') : '') +
            '</div>';
    }
    return h;
}
function _despl(k, ico, txt) {
    return '<button class="despl" data-despl="' + k + '" aria-expanded="' + (_abierto[k] ? 'true' : 'false') + '" ' +
        'onclick="toggleDespl(\'' + k + '\')">' + ico + '<span>' + etx(txt) + '</span>' + FLECHA + '</button>';
}
function toggleDespl(k) {
    _abierto[k] = !_abierto[k];
    var b = document.querySelector('[data-despl="' + k + '"]');
    if (b) b.setAttribute('aria-expanded', _abierto[k] ? 'true' : 'false');
    var r = $(k === 'inventarios' ? 'rejInventarios' : 'rejRecetas');
    if (r) r.hidden = !_abierto[k];
    if (k === 'recetas' && _abierto[k]) _cargarRecetasRejilla();
}
/* Las recetas de su área, en la misma rejilla. El buscador se pinta una vez y
   solo se repinta la lista: así no se pierde el teclado al escribir. */
var _recQ = '';
async function _cargarRecetasRejilla() {
    var r = $('rejRecetas'); if (!r) return;
    if (RECETARIO === null) {
        r.innerHTML = '<div class="hvacio">Cargando…</div>';
        if (!navigator.onLine) { r.innerHTML = '<div class="sinred">Sin internet. El recetario se lee del servidor.</div>'; return; }
        try {
            var x = await _supabase.rpc('portal_recetas', { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH });
            RECETARIO = (x && x.data) || [];
        } catch (e) { RECETARIO = []; }
    }
    if (!$('rejRecetas')) return;
    $('rejRecetas').innerHTML = ((RECETARIO || []).length > 6
        ? '<input class="campo rejilla-buscar" id="recQ" type="search" autocomplete="off" placeholder="Buscar receta…" ' +
          'value="' + etx(_recQ) + '" oninput="buscarRecetaRejilla(this.value)">' : '') +
        '<div class="rejilla-sub" id="recItems"></div>';
    _pintarRecetasRejilla();
}
function buscarRecetaRejilla(q) { _recQ = String(q || ''); _pintarRecetasRejilla(); }
var ICO_REC = { bebidas: ['rec-bebidas', '🍸'], 'sub-bebidas': ['rec-sub-bebidas', '🧪'], alimentos: ['rec-alimentos', '🍳'], 'sub-alimentos': ['rec-sub-alimentos', '🥣'] };
function _pintarRecetasRejilla() {
    var cont = $('recItems'); if (!cont) return;
    var q = _recQ.trim().toLowerCase(), pal = q ? q.split(/\s+/) : [];
    var lista = (RECETARIO || []).filter(function (x) {
        if (!pal.length) return true;
        var t = [x.nombre, x.grupo, x.categoria].join(' ').toLowerCase();
        return pal.every(function (w) { return t.indexOf(w) >= 0; });
    });
    cont.innerHTML = lista.length
        ? lista.map(function (x, i) {
            var ic = ICO_REC[x.tipo] || ['cat-recetas', '📖'];
            return '<button class="rect" data-rec="' + i + '"><span class="rect-ico">' + _ic(ic[0], ic[1]) + '</span>' +
                '<span><b>' + etx(x.nombre || '—') + '</b>' +
                ([x.grupo, x.categoria].filter(Boolean).length ? '<small>' + etx([x.grupo, x.categoria].filter(Boolean).join(' · ')) + '</small>' : '') +
                '</span></button>';
        }).join('')
        : '<div class="hvacio">' + (q ? 'Nada con «' + etx(q) + '».' : 'No hay recetas para tu área.') + '</div>';
    cont.onclick = function (e) {
        var b = e.target.closest('[data-rec]'); if (!b) return;
        verReceta(lista[parseInt(b.getAttribute('data-rec'), 10)]);
    };
}
/* Evaluaciones: se piden al entrar para saber si la opción sale (solo si el
   negocio tiene alguna abierta). Sin la v91 se queda en null y no sale. */
async function cargarEvals() {
    EVALS = null;
    try {
        var r = await _supabase.rpc('portal_evaluaciones', { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH });
        if (r && !r.error && Array.isArray(r.data)) EVALS = r.data;
    } catch (e) {}
}

/* ══ EQUIP·AX · MIS HORARIOS ═══════════════════════════════════════════════
   Solo SUS turnos (portal_horarios, v91): esta semana y la que sigue, con la
   fecha junto a cada día y el total de horas. Si lo prestaron a otra sucursal
   algún día, ese día dice dónde. */
var DIAS_L = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
var MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function _horas(t) {
    if (!t || t.desc || !t.in || !t.out) return 0;
    var a = String(t.in).split(':'), b = String(t.out).split(':');
    var m = (parseInt(b[0], 10) * 60 + (parseInt(b[1], 10) || 0)) - (parseInt(a[0], 10) * 60 + (parseInt(a[1], 10) || 0));
    if (m <= 0) m += 24 * 60;            // turno que cruza la medianoche
    return m / 60;
}
function _fechaIso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function pintarHorarios(H) {
    var semanas = (H && H.semanas) || [];
    if (!semanas.length) return '<div class="hvacio">Sin horarios.</div>';
    var hoy = (H && H.hoy) || '';
    return semanas.map(function (s, k) {
        var p = String(s.lunes || '').split('-');
        var lunes = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12);
        var dias = {}, sucs = [];
        (s.turnos || []).forEach(function (t) {
            if (t.sucursal && sucs.indexOf(t.sucursal) < 0) sucs.push(t.sucursal);
            Object.keys(t.dias || {}).forEach(function (d) {
                var v = t.dias[d]; if (!v) return;
                /* Un día con turno en una sucursal y descanso en otra: manda el turno. */
                if (!dias[d] || (dias[d].t.desc && !v.desc)) dias[d] = { t: v, suc: t.sucursal || '' };
            });
        });
        var total = 0, nT = 0;
        var filas = [0, 1, 2, 3, 4, 5, 6].map(function (i) {
            var f = new Date(lunes); f.setDate(lunes.getDate() + i);
            var d = dias['d' + i], txt, cls;
            if (d && d.t && !d.t.desc && d.t.in && d.t.out) { txt = d.t.in + ' – ' + d.t.out; cls = 'turno'; total += _horas(d.t); nT++; }
            else if (d && d.t && d.t.desc) { txt = 'Descanso'; cls = 'desc'; }
            else { txt = 'Sin turno'; cls = 'sin'; }
            var donde = (cls === 'turno' && sucs.length > 1 && d.suc) ? '<small>' + etx(d.suc) + '</small>' : '';
            return '<div class="hor-dia ' + cls + (_fechaIso(f) === hoy ? ' hoy' : '') + '">' +
                '<span class="hor-nom">' + DIAS_L[i] + '<small>' + f.getDate() + ' ' + MES_C[f.getMonth()] + '</small></span>' +
                '<span class="hor-t">' + etx(txt) + donde + '</span></div>';
        }).join('');
        var num = String(s.semana || '').split('-W')[1] || '';
        return '<div class="hor-sem"><div class="menu-grupo">' + (k === 0 ? 'Esta semana' : 'La que sigue') +
            (num ? ' · semana ' + etx(num) : '') + '<span class="hor-total">' + nT + ' turno' + (nT === 1 ? '' : 's') +
            ' · ' + (Math.round(total * 10) / 10) + ' h</span></div>' + filas + '</div>';
    }).join('') +
    '<div class="avisos">Si algo no cuadra, pregúntale a tu encargado: el rol se arma en el sistema.</div>';
}
/* La v91 sin correr: PostgREST contesta que la función no existe. Se dice en
   palabras de quien usa la app, no con el error crudo. */
function _sinV91(err) {
    return /PGRST202|could not find the function|does not exist/i.test(String((err && (err.code + ' ' + err.message)) || ''));
}
async function abrirHorarios() {
    mostrar('pHorarios', 'Mis horarios', 'esta semana y la que sigue', true, false);
    var cont = $('horariosLista');
    if (HORARIOS === null) {
        cont.innerHTML = '<div class="hvacio">Cargando…</div>';
        if (!navigator.onLine) { cont.innerHTML = '<div class="sinred">Sin internet. Los horarios se leen del servidor.</div>'; return; }
        try {
            var r = await _supabase.rpc('portal_horarios', { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH });
            if (r && r.error) {
                cont.innerHTML = '<div class="hvacio">' + (_sinV91(r.error)
                    ? 'Esta parte de la app todavía no está activada en tu negocio.'
                    : 'No se pudieron leer tus horarios. Inténtalo otra vez.') + '</div>';
                return;
            }
            HORARIOS = (r && r.data) || { semanas: [] };
        } catch (e) { cont.innerHTML = '<div class="hvacio">No se pudieron leer tus horarios. Inténtalo otra vez.</div>'; return; }
    }
    cont.innerHTML = pintarHorarios(HORARIOS);
}

/* ══ EQUIP·AX · EVALUACIONES ═══════════════════════════════════════════════
   Las abiertas del negocio, sin las de reclutamiento (portal_evaluaciones,
   v91). Cada una abre su enlace de siempre, el mismo que se manda por WhatsApp. */
var CAT_EVAL = { operativas: 'Operativa', administrativas: 'Administrativa', mensuales: 'Mensual',
                 psicometrico: 'Psicométrica', liderazgo: 'Liderazgo' };
function pintarEvaluaciones(lista) {
    if (!lista || !lista.length) return '<div class="hvacio">No hay evaluaciones abiertas.<br>Tu encargado las publica desde el sistema.</div>';
    return lista.map(function (e) {
        var det = [CAT_EVAL[e.categoria] || '', e.preguntas ? e.preguntas + ' pregunta' + (e.preguntas === 1 ? '' : 's') : '']
                    .filter(Boolean).join(' · ');
        return '<a class="guia-it" href="/evaluacion.html?t=' + encodeURIComponent(e.token || '') + '" target="_blank" rel="noopener">' +
            '<span class="rec-it-ico">' + _ic('sto-evaluaciones', '📝') + '</span>' +
            '<span style="flex:1;min-width:0"><b>' + etx(e.titulo || '—') + '</b>' +
            (det ? '<small>' + etx(det) + '</small>' : '') + '</span>' +
            '<span style="color:var(--dim)">↗</span></a>';
    }).join('');
}
async function abrirEvaluaciones() {
    mostrar('pEvals', 'Evaluaciones', 'las que tu negocio tiene abiertas', true, false);
    var cont = $('evalsLista');
    if (EVALS === null) {
        cont.innerHTML = '<div class="hvacio">Cargando…</div>';
        if (!navigator.onLine) { cont.innerHTML = '<div class="sinred">Sin internet. Las evaluaciones se leen del servidor.</div>'; return; }
        try {
            var r = await _supabase.rpc('portal_evaluaciones', { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH });
            if (r && r.error) {
                cont.innerHTML = '<div class="hvacio">' + (_sinV91(r.error)
                    ? 'Esta parte de la app todavía no está activada en tu negocio.'
                    : 'No se pudieron leer las evaluaciones. Inténtalo otra vez.') + '</div>';
                return;
            }
            EVALS = (r && r.data) || [];
        } catch (e) { cont.innerHTML = '<div class="hvacio">No se pudieron leer las evaluaciones. Inténtalo otra vez.</div>'; return; }
    }
    cont.innerHTML = pintarEvaluaciones(EVALS);
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
        /* Rechazo por NIP = id vacío, no error (v79). Ver etaaxRegistroFallo. */
        /* Respaldo prudente: sin id no se guardó. En la app instalada esto
           importa el doble — el service worker puede servir un ayudante viejo. */
        var _falloK = (typeof etaaxRegistroFallo === 'function')
            ? etaaxRegistroFallo(r) : ((!r || r.error || !r.data) ? 'No se guardó. Vuelve a entrar con tu NIP e inténtalo de nuevo.' : '');
        if (_falloK) { $('btnEnviar').disabled = false; barraMsg(_falloK, 'err'); return; }
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
        RECETAS = unoPorProducto((rr.data || []).filter(function (x) { return x && x.id && enSucReceta(x); }));
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
    var total = LOTE.length, ok = 0, fallidos = [], _motivoL = '';
    for (var i = 0; i < LOTE.length; i++) {
        barraMsg('Mandando ' + (ok + 1) + ' de ' + total + '…');
        try {
            var fn = (FLUJO === 'conteo') ? 'inventario_conteo_registrar' : 'entrada_registrar';
            var r = await _supabase.rpc(fn, {
                p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH, p_datos: armarRegistro(LOTE[i])
            });
            /* Rechazo por NIP = id vacío, no error (v79): si solo se mirara el
               error, la captura se borraría de la lista dándola por guardada. */
            /* Respaldo prudente: sin id no se guardó. */
            var _falloL = (typeof etaaxRegistroFallo === 'function')
                ? etaaxRegistroFallo(r) : ((!r || r.error || !r.data) ? 'No se guardó. Vuelve a entrar con tu NIP e inténtalo de nuevo.' : '');
            if (_falloL) { fallidos.push(LOTE[i]); _motivoL = _motivoL || _falloL; } else ok++;
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
        /* Y se dice POR QUÉ. Sin el motivo, quien está frenado vuelve a tocar
           Registrar una y otra vez, sumando intentos y alargando su espera. */
        barraMsg(ok + ' guardados · ' + fallidos.length + ' fallaron. Siguen en la lista. ' +
                 (_motivoL || 'Vuelve a tocar Registrar.'), 'err');
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
            ['Conteo', m, (c.fecha || '')].filter(Boolean).join(' · ') + horaDe(c),
            c.quien + (c.editadoPor ? ' · corregido por ' + c.editadoPor : ''),
            btnCorregir(c, 'conteo', {
                cerradasBodega: String(c.cerradasBodega == null ? '' : c.cerradasBodega),
                cerradasBarra:  String(c.cerradasBarra  == null ? '' : c.cerradasBarra),
                nota: String(c.nota || '') }));
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
                    m.quien + (m.editadoPor ? ' · corregido por ' + m.editadoPor : ''),
                    /* Solo las ENTRADAS: una merma o una cortesía llevan motivo
                       y evidencia, y su corrección es otra conversación. */
                    m.concepto === 'entrada'
                        ? btnCorregir(m, 'entrada', { cantidad: String(m.cantidad == null ? '' : m.cantidad),
                                                      nota: String(m.nota || '') })
                        : '');
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
function fila(ico, titulo, sub, quien, extra) {
    return '<div class="hmov"><div class="hmov-ico">' + ico + '</div><div class="hmov-txt">' +
        '<b>' + etx(titulo) + '</b><small>' + etx(sub) + (quien ? ' · ' + etx(quien) : '') +
        '</small>' + (extra || '') + '</div></div>';
}
/* ══ CORREGIR LO QUE YA SE MANDÓ (la misma idea que en entrada.html) ═════════
   Las dos pantallas comparten servidor y no comparten interfaz, así que el
   editor va en las dos: quien instaló la app no tiene por qué volver al
   navegador para arreglar un número.

   Nada se decide aquí: lo decide la v82 —quién puede, si la versión es la
   buena, si el conteo ya se aplicó, si el periodo cerró—. Esto pide y traduce
   la respuesta. Si la v82 no se ha corrido, el historial no trae `id` ni
   `puedeEditar` y no se pinta ningún botón. */
function btnCorregir(reg, tipo, valores) {
    if (!reg || !reg.id) return '';
    if (reg.puedeEditar === false)
        return reg.motivoBloqueo ? '<small class="hbloq">🔒 ' + etx(reg.motivoBloqueo) + '</small>' : '';
    if (reg.puedeEditar !== true) return '';
    /* El encargo viaja en un `data-`, NO en un `onclick`: `JSON.stringify` mete
       comillas dobles y el atributo también las usa, así que el navegador lo
       cortaba en la primera comilla del id —el botón se pintaba bien y al
       tocarlo no pasaba nada—. Escapado con `etx()` no hay nada que cortar. */
    return '<button class="hcorr" data-cor="' +
        etx(JSON.stringify({ t:tipo, id:reg.id, v:(parseInt(reg.ver, 10) || 1),
                             n:(reg.nombre || ''), val:valores })) + '">✏️ Corregir</button>';
}
var _COR = null;
/* Un solo escucha para todos los botones de corregir: el historial se repinta
   entero en cada recarga y enganchar uno por botón deja escuchas colgando de
   nodos que ya no existen. */
document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-cor]') : null;
    if (!b) return;
    var d;
    try { d = JSON.parse(b.getAttribute('data-cor')); } catch (e) { return; }
    corregir(d.t, d.id, d.v, d.n, d.val);
});
function corPanel() {
    var p = $('corPanel');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'corPanel';
    p.className = 'corwrap';
    p.innerHTML = '<div class="corcard">' +
        '<b id="corTit"></b><small id="corSub"></small>' +
        '<div id="corCampos"></div>' +
        '<div id="corMsg" class="cormsg" style="display:none"></div>' +
        '<button class="btn" id="corOk" onclick="guardarCorreccion()">Guardar la corrección</button>' +
        '<button class="btn ghost" onclick="cerrarCorregir()">Cancelar</button></div>';
    document.body.appendChild(p);
    return p;
}
function cerrarCorregir() {       // cancelar no escribe nada
    var p = $('corPanel'); if (p) p.style.display = 'none';
    _COR = null;
}
function corregir(tipo, id, ver, nombre, valores) {
    _COR = { tipo: tipo, id: id, ver: ver, nombre: nombre, orig: (valores || {}) };
    var p = corPanel();
    $('corTit').textContent = 'Corregir · ' + (nombre || '—');
    $('corSub').textContent = tipo === 'conteo'
        ? 'Se corrige lo contado. El producto y la fecha no cambian.'
        : 'Se corrige la cantidad. El producto y la fecha no cambian.';
    var campos = tipo === 'conteo'
        ? [['cerradasBodega', 'Bodega', 'number'], ['cerradasBarra', 'Barra', 'number'], ['nota', 'Comentario', 'text']]
        : [['cantidad', 'Cantidad', 'number'], ['nota', 'Comentario', 'text']];
    $('corCampos').innerHTML = campos.map(function (c) {
        var v = (valores && valores[c[0]] != null) ? String(valores[c[0]]) : '';
        return '<label class="corlbl">' + etx(c[1]) + '</label>' +
            '<input id="cor_' + c[0] + '" class="corinp" type="' + c[2] + '" value="' + etx(v) + '"' +
            (c[2] === 'number' ? ' inputmode="decimal" step="any" min="0"' : '') + '>';
    }).join('');
    $('corMsg').style.display = 'none'; $('corMsg').textContent = '';
    $('corOk').disabled = false;
    p.style.display = 'flex';
}
async function guardarCorreccion() {
    if (!_COR) return;
    var btn = $('corOk'), msg = $('corMsg');
    var campos = _COR.tipo === 'conteo' ? ['cerradasBodega', 'cerradasBarra', 'nota'] : ['cantidad', 'nota'];
        /* EL COMENTARIO VIAJA CON EL NOMBRE QUE USA SU TIPO: una entrada lo
           guarda en `notas` —ahí lo escribe la captura y ahí lo lee el
           inventario— y un conteo en `nota`. Mandarlo con el nombre
           equivocado dejaba DOS comentarios: el QR leía uno y el ERP seguía
           leyendo el otro, y nadie podía saber cuál era el bueno. */
    var kNota = _COR.tipo === 'conteo' ? 'nota' : 'notas';
    var cambios = {};
    campos.forEach(function (k) {
        var el = $('cor_' + k); if (!el) return;
        var antes = (_COR.orig && _COR.orig[k] != null) ? String(_COR.orig[k]) : '';
        /* Un número vacío NO es cero —mandarlo borraría lo contado—; un texto
           vacío SÍ viaja, porque es como se borra un comentario. Y lo que no
           cambió no se manda: subiría la versión por nada. */
        if (k === 'nota') { if (el.value !== antes) cambios[kNota] = el.value; }
        else if (String(el.value).trim() !== '' && String(el.value) !== antes) cambios[k] = parseFloat(el.value);
    });
    if (!Object.keys(cambios).length) {
        msg.className = 'cormsg err'; msg.style.display = ''; msg.textContent = 'No cambiaste nada.';
        return;
    }
    /* LA OPERACIÓN VA ATADA A SU CONTENIDO. `p_op` evita que un reintento por
       mala conexión cuente como otra corrección. Pero si entre un intento y
       otro la persona corrige el número, reenviar la MISMA operación le hace
       contestar al servidor «ya estaba» por un cambio que nunca guardó — y la
       pantalla enseña un valor que no se escribió. Se reintenta exactamente el
       mismo envío; en cuanto cambia, es otra operación. */
    var _huella = _COR.tipo + '|' + _COR.id + '|' + _COR.ver + '|' + JSON.stringify(cambios);
    if (_COR.opHuella !== _huella) {
        _COR.op = 'cor_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        _COR.opHuella = _huella;
    }
    btn.disabled = true; msg.className = 'cormsg'; msg.style.display = ''; msg.textContent = 'Guardando…';
    var r;
    try {
        r = await _supabase.rpc('entrada_editar', { p_neg: NEG, p_token: TOKEN, p_niphash: NIPHASH,
            p_tipo: _COR.tipo, p_id: _COR.id, p_ver: _COR.ver, p_cambios: cambios, p_op: _COR.op });
    } catch (e) { r = { error: e }; }
    if (!r || r.error || !r.data) {
        /* Se conserva lo escrito y se dice que está pendiente: fingir el
           guardado es lo que hace que alguien cierre la pantalla creyendo que
           ya quedó. El mismo `op` se reusa al reintentar. */
        btn.disabled = false; msg.className = 'cormsg err'; msg.style.display = '';
        msg.textContent = 'No se pudo guardar. Revisa tu conexión y vuelve a intentarlo — no se creó otro registro.';
        return;
    }
    var d = r.data;
    if (!d.ok) {
        btn.disabled = (d.motivo === 'conflicto');
        msg.className = 'cormsg err'; msg.style.display = '';
        msg.textContent =
            d.motivo === 'conflicto'  ? 'Alguien más lo cambió mientras lo editabas. Vuelve a abrir el historial para ver cómo quedó.' :
            d.motivo === 'aplicado'   ? 'Este conteo ya se aplicó al inventario: pídele la corrección a tu encargado.' :
            d.motivo === 'descartado' ? 'Este conteo se descartó en el inventario.' :
            d.motivo === 'cerrado'    ? 'Esta captura ya entró en un inventario cerrado.' :
            d.motivo === 'autor'      ? 'La capturó alguien más: solo tu encargado puede corregirla.' :
            d.motivo === 'ajeno'      ? 'Esa captura no es de tu sucursal.' :
            d.motivo === 'cantidad'   ? 'Esa cantidad no es válida.' :
            d.motivo === 'nip'        ? 'Tu NIP ya no es válido. Vuelve a entrar.' :
            d.motivo === 'token'      ? 'Este código QR ya venció. Pide uno nuevo.' :
            d.motivo === 'espera'     ? 'Demasiados intentos. Espera un momento.' :
            d.motivo === 'sin-cambios'? 'No cambiaste nada de lo que se puede corregir.' :
            'No se pudo corregir.';
        return;
    }
    cerrarCorregir();
    try { await irHistorial(); } catch (e) {}      // la vista viene del servidor: se vuelve a pedir
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
    pintarTeclado(); pintarPuntos(); _iconosEstaticos(); _pintarTemaIco(); pintarCabecera();
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarCajon(); });
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
window.irInicio = irInicio;
window.volver = volver;
window.abrirModulo = abrirModulo;
window.toggleDespl = toggleDespl;
window.buscarRecetaRejilla = buscarRecetaRejilla;
window.toggleUsuario = toggleUsuario;
window.abrirCajon = abrirCajon;
window.cerrarCajon = cerrarCajon;
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
window.tomarFotoRun = tomarFotoRun;
window.abrirHorarios = abrirHorarios;
window.abrirEvaluaciones = abrirEvaluaciones;

/* Para poder probarlo desde la consola y desde el candado. */
window._appMovil = {
    areasPermitidas: areasPermitidas, setArea: setArea, visible: visible,
    unoPorProducto: unoPorProducto, enSuc: enSuc, armarRegistro: armarRegistro,
    horaDe: horaDe, esIOS: esIOS, esSafari: esSafari, esStandalone: esStandalone,
    pintarInstalar: pintarInstalar, yaInstalada: yaInstalada, detectarInstalada: detectarInstalada,
    yaLaTengo: yaLaTengo, pintarPortal: pintarPortal, cuentaRun: cuentaRun,
    pintarHorarios: pintarHorarios, pintarEvaluaciones: pintarEvaluaciones, appsDelPlan: _appsDelPlan,
    pintarModulo: pintarModulo, sesionInfo: function () { return _sesionInfo(); },
    _setRun: function (r) { RUN = r; },
    _set: function (k, v) {
        if (k === 'AREA_COLAB') AREA_COLAB = v; if (k === 'AREA') AREA = v;
        if (k === 'FLUJO') FLUJO = v; if (k === 'SUB') SUB = v;
        if (k === 'SUC') SUC = v; if (k === 'LOTE') LOTE = v; if (k === 'FOTOS') FOTOS = v;
        if (k === 'APPS') APPS = v; if (k === 'PLANTILLAS') PLANTILLAS = v; if (k === 'EVALS') EVALS = v;
    },
    _get: function (k) { return { AREA: AREA, AREA_COLAB: AREA_COLAB, FLUJO: FLUJO, LOTE: LOTE }[k]; }
};

})();
