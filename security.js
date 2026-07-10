/* ============================================================
   ETAAX — Session Security
   - Auto-logout after 30 min inactivity
   - Warning toast at 25 min
   - XSS-safe innerHTML helper
   ============================================================ */
(function () {
    var TIMEOUT_MS  = 30 * 60 * 1000; // 30 min
    var WARNING_MS  = 25 * 60 * 1000; // aviso a los 25 min
    var _timer      = null;
    var _warnTimer  = null;
    var _toastEl    = null;

    function _logout() {
        _etaaxWipeCache();
        localStorage.removeItem('etaax_negocio_activo');
        localStorage.removeItem('etaax_ctx');
        // La sesión de Supabase vive en localStorage: cerrarla de verdad.
        try { if (window._supabase) _supabase.auth.signOut(); } catch (e) {}
        try {
            for (var i = localStorage.length - 1; i >= 0; i--) {
                var k = localStorage.key(i);
                if (k && k.indexOf('sb-') === 0) localStorage.removeItem(k);
            }
        } catch (e) {}
        sessionStorage.clear();
        window.location.href = '/hub.html?salir=1&razon=inactividad';
    }

    function _dismissToast() {
        if (_toastEl && _toastEl.parentNode) _toastEl.parentNode.removeChild(_toastEl);
        _toastEl = null;
    }

    function _showWarning() {
        _dismissToast();
        var el = document.createElement('div');
        el.id = 'etaax-session-toast';
        el.style.cssText = [
            'position:fixed;bottom:80px;right:20px;z-index:99999',
            'background:#1a1916;border:1px solid #f5c842;border-radius:12px',
            'padding:14px 18px;max-width:300px;box-shadow:0 8px 32px rgba(0,0,0,.5)',
            'font-family:DM Sans,sans-serif;font-size:13px;color:#f0ece6',
            'animation:fadeUp .3s ease both'
        ].join(';');
        el.innerHTML =
            '<div style="font-weight:600;color:#f5c842;margin-bottom:4px">⚠️ Sesión por expirar</div>' +
            '<div style="color:#9a9590;font-size:12px">Tu sesión se cerrará en 5 minutos por inactividad.</div>' +
            '<button onclick="(function(){' +
                'document.getElementById(\'etaax-session-toast\').remove();' +
            '})()" style="margin-top:10px;background:#f5c842;color:#000;border:none;' +
            'border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer">Seguir activo</button>';
        document.body.appendChild(el);
        _toastEl = el;
    }

    function _reset() {
        clearTimeout(_timer);
        clearTimeout(_warnTimer);
        _dismissToast();
        _warnTimer = setTimeout(_showWarning, WARNING_MS);
        _timer     = setTimeout(_logout, TIMEOUT_MS);
    }

    function _init() {
        // Solo activa si hay sesión activa
        if (!localStorage.getItem('etaax_ctx')) return;

        ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(function (ev) {
            document.addEventListener(ev, _reset, { passive: true });
        });
        _reset();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    // Exponer reset público para que páginas con mucha actividad programática lo llamen
    window._sessionReset = _reset;
})();

/* ============================================================
   Limpieza de caché al cerrar sesión
   Borra los datos de negocio cacheados en localStorage para que
   no queden expuestos en equipos compartidos.
   - Solo aplica a sesiones de dueño (ctxType 'owner'): los datos
     de Supabase se recargan al volver a entrar. Las sesiones de
     staff trabajan solo sobre caché local y borrarlo perdería
     su captura (pendiente: sync de staff a la nube).
   - Conserva etaax_negocios y etaax_*_staff (necesarios para el
     login de colaboradores en este dispositivo) y etaax_theme.
   ============================================================ */
window._etaaxWipeCache = function () {
    var ctx = null;
    try { ctx = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) {}
    if (ctx && ctx.ctxType !== 'owner') return;
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('etaax_') !== 0) continue;
        if (k === 'etaax_negocios' || k === 'etaax_theme') continue;
        if (/_staff$/.test(k)) continue;
        if (/_staffcred$/.test(k)) continue;   // credenciales de la cuenta de colaboradores (login staff en la nube)
        if (/_owner_email$/.test(k)) continue; // lo usa admin-guard en sesiones staff
        if (/_sucursales$/.test(k)) continue;  // lista de sucursales (nombre matriz, etc.)
        if (/_suc_/.test(k)) continue;         // config y logo por sucursal (etaax_<neg>_suc_<id>[_logo])
        keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
};

/* ============================================================
   Hash de contraseñas de colaboradores (staff)
   - _hashPwdStaff: SHA-256 (async), formato 'v2$<hex>' — el formato bueno.
   - _hashPwdStaffLegacy: algoritmo anterior (REVERSIBLE — contenía base64 de
     la contraseña). NUNCA se almacena ni se transmite ya: solo se usa en el
     login para validar contraseñas de cuentas aún no migradas.
   - _hashPwdStaffWrap: "envuelve" un hash legacy con SHA-256 → 'v2L$<hex>'.
     Se calcula desde el hash almacenado SIN conocer la contraseña, así los
     hashes legacy guardados (nube y localStorage) se sanean de inmediato
     (dejan de ser decodificables). En el siguiente login exitoso, donde sí
     hay contraseña, se migra a v2 definitivo. La migración v30 aplica esta
     misma envoltura del lado del servidor (pgcrypto digest).
   Compartido por hub.html (login) y administrativo/staff.html (alta).
   ============================================================ */
window._hashPwdStaffLegacy = function (s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36) + btoa(unescape(encodeURIComponent(s))).slice(0, 16).replace(/[^a-z0-9]/gi, 'x');
};
function _etaaxSha256Hex(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ('0' + b.toString(16)).slice(-2);
        }).join('');
    });
}
window._hashPwdStaff = async function (s) {
    return 'v2$' + await _etaaxSha256Hex('etaax-staff|' + s);
};
window._hashPwdStaffWrap = async function (legacyHash) {
    return 'v2L$' + await _etaaxSha256Hex('etaax-staff|' + legacyHash);
};
// ¿El hash almacenado es del formato viejo (reversible)? → hay que sanearlo.
window._esHashStaffLegacy = function (h) {
    return !!h && h.indexOf('v2$') !== 0 && h.indexOf('v2L$') !== 0;
};

/* ============================================================
   XSS-safe helper — usar en lugar de innerHTML con datos de usuario
   Uso: etx(valor) en cualquier concatenación de HTML
   ============================================================ */
window.etx = function (s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/* ============================================================
   ETAAX — UI compartida (diálogos bonitos + guarda de cierre)
   - window.alert        → tarjeta estilizada (no el cuadro feo del navegador)
   - window.etaaxAlert / window.etaaxConfirm
   - Click en el FONDO de un modal → confirma antes de cerrar (reutiliza el
     propio handler de cierre del modal, sin tener que editar cada uno).
   ============================================================ */
(function () {
    if (window._etaaxUI) return; window._etaaxUI = true;

    var st = document.createElement('style');
    st.textContent =
        '@keyframes etaaxFade{from{opacity:0}to{opacity:1}}' +
        '@keyframes etaaxPop{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}' +
        '.etaax-ui-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;' +
            'padding:18px;background:rgba(7,7,6,.64);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);' +
            'animation:etaaxFade .15s ease both;font-family:DM Sans,system-ui,sans-serif}' +
        '.etaax-ui-card{width:100%;max-width:390px;background:#1c1b18;border:1px solid #34322c;border-radius:16px;' +
            'box-shadow:0 24px 70px rgba(0,0,0,.62);padding:22px 22px 18px;animation:etaaxPop .18s cubic-bezier(.2,.8,.2,1) both}' +
        '.etaax-ui-ico{font-size:30px;line-height:1;margin-bottom:10px}' +
        '.etaax-ui-ttl{font-size:17px;font-weight:700;color:#f3efe8;margin:0 0 6px;letter-spacing:.2px}' +
        '.etaax-ui-msg{font-size:13.5px;line-height:1.5;color:#a7a299;margin:0 0 18px;white-space:pre-wrap;word-break:break-word}' +
        '.etaax-ui-row{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}' +
        '.etaax-ui-btn{border:none;border-radius:9px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;' +
            'font-family:inherit;transition:filter .15s,opacity .15s}' +
        '.etaax-ui-btn:hover{filter:brightness(1.12)}' +
        '.etaax-ui-btn.primary{background:#3dbe7a;color:#06140d}' +
        '.etaax-ui-btn.danger{background:#e05a3a;color:#fff}' +
        '.etaax-ui-btn.ghost{background:transparent;color:#a7a299;border:1px solid #3a382f}' +
        '.etaax-ui-inp{width:100%;box-sizing:border-box;background:#13120f;border:1px solid #3a382f;color:#f3efe8;' +
            'padding:10px 12px;border-radius:9px;font-size:14px;font-family:inherit;outline:none;margin:0 0 16px}' +
        '.etaax-ui-inp:focus{border-color:#3dbe7a}';
    (document.head || document.documentElement).appendChild(st);

    var _queue = [], _active = false;
    function _next() {
        if (_active || !_queue.length) return;
        _active = true;
        _render(_queue.shift());
    }
    function _render(cfg) {
        var ov = document.createElement('div');
        ov.className = 'etaax-ui-ov';
        ov.setAttribute('data-etaax-ui', '1');
        var card = document.createElement('div');
        card.className = 'etaax-ui-card';
        var h = '';
        if (cfg.icon)  h += '<div class="etaax-ui-ico">' + cfg.icon + '</div>';
        if (cfg.title) h += '<div class="etaax-ui-ttl">' + window.etx(cfg.title) + '</div>';
        if (cfg.msg)   h += '<div class="etaax-ui-msg">' + window.etx(cfg.msg) + '</div>';
        if (cfg.input) h += '<input class="etaax-ui-inp" type="text">';
        h += '<div class="etaax-ui-row"></div>';
        card.innerHTML = h;
        ov.appendChild(card);
        var inputEl = card.querySelector('.etaax-ui-inp');
        if (inputEl) {
            if (cfg.inputValue != null) inputEl.value = cfg.inputValue;
            if (cfg.placeholder) inputEl.placeholder = cfg.placeholder;
        }
        function valOf() { return inputEl ? inputEl.value : undefined; }

        function onKey(ev) {
            if (ev.key === 'Escape') { ev.preventDefault(); cerrar(cfg.onBackdrop); }
            else if (ev.key === 'Enter') { ev.preventDefault(); cerrar(cfg.primary || cfg.onBackdrop, valOf()); }
        }
        function cerrar(cb, val) {
            document.removeEventListener('keydown', onKey, true);
            ov.style.animation = 'etaaxFade .12s ease both reverse';
            setTimeout(function () {
                if (ov.parentNode) ov.parentNode.removeChild(ov);
                _active = false; _next();
                if (typeof cb === 'function') cb(val);
            }, 110);
        }
        var row = card.querySelector('.etaax-ui-row');
        cfg.buttons.forEach(function (b) {
            var btn = document.createElement('button');
            btn.className = 'etaax-ui-btn ' + (b.kind || 'ghost');
            btn.textContent = b.label;
            btn.onclick = function () { cerrar(b.onClick, b.kind === 'primary' ? valOf() : undefined); };
            row.appendChild(btn);
        });
        ov.addEventListener('click', function (e) { if (e.target === ov) cerrar(cfg.onBackdrop); });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(ov);
        if (inputEl) { try { inputEl.focus(); inputEl.select(); } catch (e) {} }
        else {
            var pb = card.querySelector('.etaax-ui-btn.primary,.etaax-ui-btn.danger') || card.querySelector('.etaax-ui-btn');
            if (pb) { try { pb.focus(); } catch (e) {} }
        }
    }

    window.etaaxAlert = function (msg, opts) {
        opts = opts || {};
        var cb = opts.onOk || null;
        _queue.push({
            icon: opts.icon || '', title: opts.title || '', msg: String(msg == null ? '' : msg),
            buttons: [{ label: opts.okLabel || 'Aceptar', kind: 'primary', onClick: cb }],
            primary: cb, onBackdrop: cb
        });
        _next();
    };
    // Prompt estilizado (input de texto). onOk recibe el valor escrito.
    window.etaaxPrompt = function (title, defaultVal, onOk, opts) {
        opts = opts || {};
        function ok(val) { if (typeof onOk === 'function') onOk((val == null ? '' : val)); }
        _queue.push({
            icon: opts.icon || '✏️', title: title || '', msg: opts.msg || '',
            input: true, inputValue: defaultVal || '', placeholder: opts.placeholder || '',
            buttons: [
                { label: opts.cancelLabel || 'Cancelar', kind: 'ghost', onClick: opts.onCancel || null },
                { label: opts.okLabel || 'Aceptar', kind: 'primary', onClick: ok }
            ],
            primary: ok, onBackdrop: opts.onCancel || null
        });
        _next();
    };
    window.etaaxConfirm = function (title, msg, onYes, onNo, opts) {
        opts = opts || {};
        _queue.push({
            icon: opts.icon || '❓', title: title || '¿Confirmar?', msg: msg || '',
            buttons: [
                { label: opts.noLabel || 'Cancelar', kind: 'ghost', onClick: onNo },
                { label: opts.yesLabel || 'Continuar', kind: opts.danger === false ? 'primary' : 'danger', onClick: onYes }
            ],
            primary: onYes, onBackdrop: onNo
        });
        _next();
    };
    // Diálogo genérico con N botones: { icon, title, msg, buttons:[{label,kind,onClick}], onBackdrop }
    // kind: 'ghost' | 'primary' | 'danger'. onClick null = solo cerrar.
    window.etaaxDialog = function (cfg) {
        cfg = cfg || {};
        _queue.push({
            icon: cfg.icon || '❓', title: cfg.title || '', msg: cfg.msg || '',
            buttons: (cfg.buttons || []).map(function (b) {
                return { label: b.label, kind: b.kind || 'ghost', onClick: b.onClick };
            }),
            primary: cfg.primary || null, onBackdrop: ('onBackdrop' in cfg) ? cfg.onBackdrop : null
        });
        _next();
    };

    // Reemplazar el alert() nativo por la tarjeta estilizada (no bloqueante).
    window.alert = function (msg) { window.etaaxAlert(msg); };

    /* Guarda de cierre: si haces click en el FONDO de un modal a pantalla
       completa, en vez de cerrarlo de golpe pregunta primero. Para cerrar
       re-dispara un click real en el overlay → activa su propio handler de
       cierre (sea inline onclick, .onclick o addEventListener), así respeta
       la limpieza de cada modal sin tener que editarlos uno por uno. */
    function _esModalOverlay(ov) {
        if (!ov || ov.nodeType !== 1 || !ov.getAttribute) return false;
        if (ov.getAttribute('data-etaax-ui')) return false;       // nuestros diálogos
        if (ov.getAttribute('data-etaax-allow')) return false;    // click sintético propio
        var cs = window.getComputedStyle(ov);
        if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        var r = ov.getBoundingClientRect();
        if (r.width < window.innerWidth * 0.6 || r.height < window.innerHeight * 0.6) return false;
        // ¿parece un modal que cierra al click-fuera?
        if (typeof ov.onclick === 'function') return true;
        if (/overlay/i.test(ov.className || '')) return true;
        if (ov.querySelector && ov.querySelector('.modal, .modal-card, .gs-card, .sm-card')) return true;
        // Fondo translúcido a pantalla completa = backdrop de modal (estilos inline).
        var m = (cs.backgroundColor || '').match(/^rgba?\(([^)]+)\)/);
        if (m) { var p = m[1].split(',').map(function (x) { return parseFloat(x); }); var a = p.length > 3 ? p[3] : 1; if (a > 0.05 && a < 1) return true; }
        return false;
    }
    function _cerrarOverlay(ov) {
        ov.setAttribute('data-etaax-allow', '1');
        try { ov.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
        ov.removeAttribute('data-etaax-allow');
        // Garantía: si su propio handler no lo cerró, ocultarlo de todos modos.
        setTimeout(function () {
            try {
                if (window.getComputedStyle(ov).display !== 'none' && ov.offsetParent !== null) {
                    ov.classList.remove('open'); ov.style.display = 'none';
                }
            } catch (e) {}
        }, 50);
    }
    document.addEventListener('click', function (e) {
        var ov = e.target;
        if (!_esModalOverlay(ov)) return;
        e.preventDefault();
        e.stopPropagation();
        window.etaaxConfirm(
            '¿Cerrar esta ventana?',
            'Si fue sin querer, puedes seguir aquí. Los cambios sin guardar se perderán.',
            function () { _cerrarOverlay(ov); },
            null,
            { yesLabel: 'Sí, cerrar', noLabel: 'Seguir aquí' }
        );
    }, true);
})();

/* ============================================================
   AVISO DE MANTENIMIENTO — actualización de esta noche
   Banner fijo en TODAS las páginas del sistema (security.js se
   incluye en hub, módulos, admin y configuración). Se apaga solo
   después de la hora de la actualización; se puede cerrar y no
   vuelve a molestar en ese dispositivo.
   ============================================================ */
(function () {
    var LIMITE = new Date('2026-07-10T00:00:00'); // hoy 12:00 a.m.
    var KEY = 'etaax_aviso_upd_20260710';
    if (new Date() >= LIMITE) return;               // ya pasó: no mostrar
    try { if (localStorage.getItem(KEY)) return; } catch (e) {}

    function pintar() {
        if (document.getElementById('etaaxAvisoUpd')) return;
        var b = document.createElement('div');
        b.id = 'etaaxAvisoUpd';
        b.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99990;' +
            'max-width:min(640px,94vw);box-sizing:border-box;display:flex;align-items:center;gap:12px;' +
            'background:#1f1d18;border:1px solid rgba(245,200,66,.5);border-radius:12px;padding:12px 16px;' +
            'box-shadow:0 12px 40px rgba(0,0,0,.55);font-family:"DM Sans",sans-serif;';
        b.innerHTML =
            '<span style="font-size:22px;line-height:1">🛠️</span>' +
            '<div style="flex:1;min-width:0">' +
                '<div style="font-size:13px;font-weight:700;color:#f5c842;letter-spacing:.3px">Actualización del sistema — hoy 12:00 a.m.</div>' +
                '<div style="font-size:12px;color:#c9c4bb;line-height:1.5;margin-top:2px">ETAAX se actualizará esta noche por mejoras continuas. Puedes seguir trabajando normal; te recomendamos guardar tus capturas antes de esa hora.</div>' +
            '</div>' +
            '<button id="etaaxAvisoUpdX" style="background:none;border:1px solid rgba(245,200,66,.35);color:#f5c842;' +
                'border-radius:8px;padding:6px 12px;cursor:pointer;font-family:inherit;font-size:12px;white-space:nowrap">Entendido</button>';
        document.body.appendChild(b);
        document.getElementById('etaaxAvisoUpdX').onclick = function () {
            try { localStorage.setItem(KEY, '1'); } catch (e) {}
            b.remove();
        };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pintar);
    else pintar();
})();
