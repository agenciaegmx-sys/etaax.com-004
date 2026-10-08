/* ══════════════════════════════════════════════════════════════════════════
   ETAAX · App móvil — LA PUERTA DE LA CUENTA

   La app tiene DOS puertas y es a propósito:

     · EL QR (app.js). Quien trabaja en barra o cocina no tiene cuenta: tiene un
       NIP de 5 dígitos. Pedirle correo y contraseña sería inventarle una
       credencial que no existe. Esa puerta no cambió nada — mismo token, mismo
       NIP, misma seguridad que el QR pegado en la pared.

     · LA CUENTA (este archivo). El dueño o el gerente sí tienen cuenta, la
       misma del sistema web. Con ella se alcanzan las cosas que mueven dinero.

   Por eso la portada ofrece las dos sin mezclarlas: los botones de registrar
   funcionan SIN entrar, igual que escanear el QR, y lo demás pide cuenta.

   ── EL CLIENTE PROPIO, Y POR QUÉ ──────────────────────────────────────────
   supabase-config.js guarda la sesión en sessionStorage —se borra al cerrar el
   navegador, a propósito— y además BORRA de localStorage cualquier sesión que
   encuentre. Para la web eso está bien: una computadora de oficina compartida
   no debe quedarse con la sesión del dueño.

   Una app instalada es otra cosa: cerrarla y que te pida la contraseña cada vez
   la vuelve inservible. Así que la app crea SU cliente, con su propia llave de
   almacenamiento —que el barrido de supabase-config no toca porque no empieza
   con `sb-`— y pone un candado local encima.

   ── QUÉ PROTEGE EL CANDADO, Y QUÉ NO ──────────────────────────────────────
   Decirlo claro importa. El candado (huella / Face ID / PIN) protege contra lo
   que de verdad pasa: alguien levanta el teléfono desbloqueado de la barra y lo
   abre. NO protege contra quien se lleva el teléfono y lo desarma con
   herramientas: la sesión vive en el almacenamiento del navegador y ahí seguiría
   estando. Para eso está el cierre de sesión y, si el teléfono se pierde,
   cambiar la contraseña desde el sistema.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var LLAVE_SESION = 'etaax-movil-auth';     // ≠ 'sb-…' para sobrevivir al barrido
var LLAVE_PIN    = 'etaax_movil_pin';      // el PIN de desbloqueo, hasheado
var LLAVE_BIO    = 'etaax_movil_bio';      // id de la credencial de huella/Face ID
var LLAVE_CORREO = 'etaax_movil_correo';   // para saludar y prellenar, no es secreto

var SB = null;            // el cliente de la app
var SESION = null;        // la sesión viva
var _pinBuf = '';         // lo que se va tecleando en el desbloqueo
var _modoPin = '';        // 'desbloquear' | 'crear' | 'confirmar'
var _pinNuevo = '';

function $(id) { return document.getElementById(id); }
function etx(s) { return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

/* El PIN se guarda hasheado, nunca en claro. No es gran cosa —quien lea el
   almacenamiento del teléfono igual tiene la sesión— pero dejar un PIN legible
   invita a probarlo en otras apps, que es donde sí hace daño. */
async function hashPin(pin) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('etaax-movil|pin|' + pin));
    return Array.prototype.map.call(new Uint8Array(buf),
        function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

/* ── El cliente ───────────────────────────────────────────────────────────── */
function iniciar() {
    if (SB) return SB;
    if (typeof supabase === 'undefined' || typeof SUPABASE_URL === 'undefined') return null;
    SB = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
        auth: {
            storage: window.localStorage,
            storageKey: LLAVE_SESION,
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false
        }
    });
    /* El resto de la app habla por `_supabase`. Se le pone ESTE cliente para que
       una sola conexión sirva a las dos puertas: las consultas del QR funcionan
       igual con sesión o sin ella (están concedidas a anon y a authenticated), y
       tener dos clientes vivos es la receta para que un día uno tenga sesión y
       el otro no sobre la misma pantalla. */
    try { window._supabase = SB; } catch (e) {}
    return SB;
}

/* ══ BIOMETRÍA ═════════════════════════════════════════════════════════════
   Huella y Face ID en una app web se hacen con WebAuthn —el mismo mecanismo de
   los passkeys—, no con una API de huella. Funciona en iPhone (Safari 16+) y en
   Android, también con la app instalada.

   Se usa como CANDADO LOCAL: el teléfono confirma que eres tú y la app abre la
   sesión que ya tenía. No sustituye la contraseña de ETAAX ni viaja al servidor.

   El PATRÓN de puntos no se ofrece: es un gesto de Android nativo que en web
   habría que dibujar a mano, y no protege más que un PIN. */
async function hayBiometria() {
    try {
        if (!window.PublicKeyCredential) return false;
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) { return false; }
}
function _b64u(buf) {
    var s = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function registrarBiometria(correo) {
    try {
        var reto = crypto.getRandomValues(new Uint8Array(32));
        var uid  = crypto.getRandomValues(new Uint8Array(16));
        var cred = await navigator.credentials.create({
            publicKey: {
                challenge: reto,
                rp: { name: 'ETAAX' },
                user: { id: uid, name: correo || 'etaax', displayName: correo || 'ETAAX' },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                /* `platform` + `required`: la huella o la cara DEL TELÉFONO, no una
                   llave USB, y con verificación de persona obligatoria — si no,
                   bastaría tener el teléfono en la mano. */
                authenticatorSelection: { authenticatorAttachment: 'platform',
                                          userVerification: 'required', residentKey: 'preferred' },
                timeout: 60000, attestation: 'none'
            }
        });
        if (!cred || !cred.rawId) return false;
        _lsSet(LLAVE_BIO, _b64u(cred.rawId));
        return true;
    } catch (e) { return false; }
}
async function pedirBiometria() {
    var id = _ls(LLAVE_BIO);
    if (!id) return false;
    try {
        var bin = atob(id.replace(/-/g, '+').replace(/_/g, '/'));
        var raw = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
        var r = await navigator.credentials.get({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                allowCredentials: [{ type: 'public-key', id: raw.buffer }],
                userVerification: 'required', timeout: 60000
            }
        });
        return !!r;
    } catch (e) { return false; }
}

/* ══ ENTRAR CON LA CUENTA ══════════════════════════════════════════════════ */
async function entrarCuenta() {
    var correo = ($('ctaCorreo').value || '').trim().toLowerCase();
    var pwd    = $('ctaPwd').value || '';
    var msg    = $('ctaMsg');
    if (!correo || !pwd) { msg.textContent = 'Pon tu correo y tu contraseña.'; return; }
    if (!navigator.onLine) { msg.textContent = 'Sin internet. Entrar necesita señal.'; return; }
    var btn = $('ctaBtn'); btn.disabled = true; msg.textContent = 'Verificando…';
    try {
        var r = await iniciar().auth.signInWithPassword({ email: correo, password: pwd });
        btn.disabled = false;
        if (r.error) {
            /* El mensaje NO cambia según si el correo existe: eso convertiría la
               pantalla en un buscador de clientes. Misma regla que el hub. */
            msg.textContent = 'Correo o contraseña incorrectos.';
            return;
        }
        SESION = r.data.session;
        _lsSet(LLAVE_CORREO, correo);
        msg.textContent = '';
        $('ctaPwd').value = '';
        ofrecerCandado();
    } catch (e) {
        btn.disabled = false; msg.textContent = 'Error: ' + ((e && e.message) || e);
    }
}

/* Tras entrar, se ofrece el candado UNA vez. No se impone: hay teléfonos de
   oficina donde no hace falta, y obligar a poner un PIN que luego se olvida
   termina en gente que no usa la app. */
function ofrecerCandado() {
    if (_ls(LLAVE_PIN) || _ls(LLAVE_BIO)) { window._appCuentaLista(); return; }
    hayBiometria().then(function (hay) {
        var el = $('candadoOferta');
        el.innerHTML =
            '<div class="cand-tit">Protege la app en este teléfono</div>' +
            '<div class="cand-sub">La sesión se queda guardada para que no tengas que escribir la ' +
            'contraseña cada vez. El candado es lo que impide que alguien que levante tu teléfono ' +
            'entre a tus números.</div>' +
            (hay ? '<button class="btn btn-ok" onclick="activarBiometria()">Usar huella o Face ID</button>' : '') +
            '<button class="btn btn-sec" onclick="crearPin()">Poner un PIN de 4 dígitos</button>' +
            '<button class="cand-no" onclick="sinCandado()">Ahora no</button>';
        mostrarCuenta('pCandado', 'Protege tu app', 'un paso y ya');
    });
}
async function activarBiometria() {
    var ok = await registrarBiometria(_ls(LLAVE_CORREO));
    if (!ok) { toastC('No se pudo activar. Puedes poner un PIN.', 'err'); return; }
    toastC('Listo: te pedirá huella o Face ID al abrir.', 'ok');
    window._appCuentaLista();
}
function sinCandado() {
    /* Queda apuntado que se dijo que no, para no volver a preguntarlo cada vez
       que entre: preguntar una y otra vez es cómo se enseña a decir que no sin
       leer. */
    _lsSet(LLAVE_PIN, 'no');
    window._appCuentaLista();
}

/* ══ EL PIN DE DESBLOQUEO ══════════════════════════════════════════════════
   OJO: NO es el NIP del colaborador. Ese identifica a una persona ante el
   negocio y lo pone el encargado; este solo abre la app en ESTE teléfono y lo
   elige el dueño. Mezclarlos haría que cambiar uno afectara al otro. */
function crearPin() {
    _modoPin = 'crear'; _pinBuf = ''; _pinNuevo = '';
    pintarPin('Elige un PIN de 4 dígitos', '');
    mostrarCuenta('pPin', 'PIN de la app', 'solo para este teléfono');
}
function pintarPin(titulo, error) {
    $('pinTit').textContent = titulo;
    $('pinErr').textContent = error || '';
    $('pinPts').innerHTML = [0,1,2,3].map(function (i) {
        return '<i class="' + (i < _pinBuf.length ? 'on' : '') + '"></i>';
    }).join('');
    $('pinTeclado').innerHTML = ['1','2','3','4','5','6','7','8','9','bio','0','del'].map(function (k) {
        if (k === 'del') return '<button class="tecla tecla-acc" data-p="del" aria-label="Borrar">⌫</button>';
        if (k === 'bio') return (_modoPin === 'desbloquear' && _ls(LLAVE_BIO))
            ? '<button class="tecla tecla-acc" data-p="bio" aria-label="Huella">☝️</button>'
            : '<span></span>';
        return '<button class="tecla" data-p="' + k + '">' + k + '</button>';
    }).join('');
    $('pinTeclado').onclick = function (e) {
        var b = e.target.closest('[data-p]'); if (!b) return;
        teclaPin(b.getAttribute('data-p'));
    };
}
async function teclaPin(k) {
    if (k === 'del') { _pinBuf = _pinBuf.slice(0, -1); pintarPin($('pinTit').textContent, ''); return; }
    if (k === 'bio') { if (await pedirBiometria()) abrirConSesion(); else pintarPin($('pinTit').textContent, 'No se reconoció.'); return; }
    if (_pinBuf.length >= 4) return;
    _pinBuf += k;
    pintarPin($('pinTit').textContent, '');
    if (_pinBuf.length < 4) return;

    var h = await hashPin(_pinBuf);
    if (_modoPin === 'crear') {
        _pinNuevo = h; _pinBuf = ''; _modoPin = 'confirmar';
        pintarPin('Vuelve a escribirlo', '');
        return;
    }
    if (_modoPin === 'confirmar') {
        if (h !== _pinNuevo) {
            _pinBuf = ''; _modoPin = 'crear'; _pinNuevo = '';
            pintarPin('Elige un PIN de 4 dígitos', 'No coincidió. Empieza de nuevo.');
            return;
        }
        _lsSet(LLAVE_PIN, h);
        toastC('PIN guardado.', 'ok');
        window._appCuentaLista();
        return;
    }
    // desbloquear
    if (h === _ls(LLAVE_PIN)) { abrirConSesion(); return; }
    _pinBuf = '';
    pintarPin('PIN de la app', 'Ese no es. Inténtalo otra vez.');
}

/* ══ AL ABRIR LA APP ═══════════════════════════════════════════════════════ */
async function alAbrir() {
    var c = iniciar();
    if (!c) return false;
    var r = null;
    try { r = await c.auth.getSession(); } catch (e) {}
    SESION = (r && r.data && r.data.session) || null;
    if (!SESION) return false;                       // sin sesión: la portada normal

    var tienePin = _ls(LLAVE_PIN) && _ls(LLAVE_PIN) !== 'no';
    var tieneBio = !!_ls(LLAVE_BIO);
    if (!tienePin && !tieneBio) { abrirConSesion(); return true; }

    /* Con biometría se intenta sola: es el gesto que la gente espera al abrir
       una app del banco. Si falla o la cancelan, queda el PIN —y si no hay PIN,
       la contraseña—, porque dejar a alguien fuera de sus propios números por
       un sensor que no leyó sería peor. */
    _modoPin = 'desbloquear'; _pinBuf = '';
    pintarPin('PIN de la app', '');
    mostrarCuenta('pPin', 'Desbloquear', _ls(LLAVE_CORREO) || '');
    if (tieneBio) { if (await pedirBiometria()) { abrirConSesion(); return true; } }
    if (!tienePin && tieneBio) {
        /* Biometría puesta pero sin PIN y el sensor no quiso: la salida honesta
           es la contraseña, no una pantalla sin manera de avanzar. */
        $('pinErr').innerHTML = 'No se reconoció. <a href="#" onclick="verCuenta();return false" ' +
            'style="color:var(--verde)">Entrar con mi contraseña</a>';
    }
    return true;
}

function abrirConSesion() { window._appCuentaLista(); }

async function salirCuenta() {
    try { await iniciar().auth.signOut({ scope: 'local' }); } catch (e) {}
    SESION = null;
    /* El candado se queda puesto: es de ESTE teléfono, no de la sesión. Borrarlo
       al salir obligaría a configurarlo otra vez en cada entrada. */
    window._appCuentaFuera();
}

/* ── Enganches que la cáscara usa ── */
window._cuenta = {
    iniciar: iniciar, alAbrir: alAbrir, entrarCuenta: entrarCuenta,
    salirCuenta: salirCuenta, hayBiometria: hayBiometria,
    sesion: function () { return SESION; },
    correo: function () { return _ls(LLAVE_CORREO); },
    /* Para probarlo desde la consola y desde el candado del repo. */
    _hashPin: hashPin, _llaves: { sesion: LLAVE_SESION, pin: LLAVE_PIN, bio: LLAVE_BIO }
};
window.entrarCuenta   = entrarCuenta;
window.salirCuenta    = salirCuenta;
window.activarBiometria = activarBiometria;
window.crearPin       = crearPin;
window.sinCandado     = sinCandado;

})();
