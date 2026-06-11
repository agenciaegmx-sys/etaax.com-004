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
        localStorage.removeItem('etaax_negocio_activo');
        localStorage.removeItem('etaax_ctx');
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
   Hash de contraseñas de colaboradores (staff)
   - _hashPwdStaff: SHA-256 (async), formato 'v2$<hex>'
   - _hashPwdStaffLegacy: algoritmo anterior (reversible — contenía
     base64 de la contraseña). Solo se usa para validar hashes viejos
     y migrarlos al formato v2 en el siguiente login exitoso.
   Compartido por hub.html (login) y administrativo/staff.html (alta).
   ============================================================ */
window._hashPwdStaffLegacy = function (s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36) + btoa(unescape(encodeURIComponent(s))).slice(0, 16).replace(/[^a-z0-9]/gi, 'x');
};
window._hashPwdStaff = async function (s) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('etaax-staff|' + s));
    return 'v2$' + Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
    }).join('');
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
