/* ============================================================
   ETAAX — Admin Delete Guard
   Requires: _supabase (supabase-config.js) loaded before this script
   ============================================================ */

(function () {
    var _guardCb = null;

    function _ensureModal() {
        if (document.getElementById('modalAdminGuard')) return;
        var el = document.createElement('div');
        el.id = 'modalAdminGuard';
        el.style.cssText = 'display:none;position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.8);' +
            'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
            'align-items:center;justify-content:center;padding:16px';
        el.innerHTML =
            '<div style="background:var(--surface,#1a1916);border:1px solid var(--border,#2a2825);' +
            'border-radius:16px;width:min(380px,94vw);overflow:hidden">' +
              '<div style="padding:18px 22px 14px;border-bottom:1px solid var(--border,#2a2825)">' +
                '<div style="font-size:10px;color:var(--text-dim,#7a7570);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px">🔒 Autorización requerida</div>' +
                '<div id="adminGuardAccion" style="font-size:16px;font-weight:600;color:var(--text,#f0ece6)">Confirmar acción</div>' +
              '</div>' +
              '<div style="padding:18px 22px">' +
                '<div style="font-size:11px;color:var(--text-dim,#7a7570);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Contraseña de administrador</div>' +
                '<input type="password" id="adminGuardInput" placeholder="Ingresa tu contraseña"' +
                '  onkeydown="if(event.key===\'Enter\')_confirmarAdminGuard()"' +
                '  style="width:100%;box-sizing:border-box;height:46px;padding:0 14px;border:1px solid var(--border,#2a2825);' +
                '  border-radius:10px;background:var(--bg,#0f0e0c);color:var(--text,#f0ece6);' +
                '  font-family:inherit;font-size:15px;outline:none;transition:border-color .15s"' +
                '  onfocus="this.style.borderColor=\'var(--accent,#f5c842)\'" onblur="this.style.borderColor=\'var(--border,#2a2825)\'">' +
                '<div id="adminGuardError" style="color:var(--red,#e05a3a);font-size:12px;margin-top:10px;min-height:16px"></div>' +
              '</div>' +
              '<div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 22px;border-top:1px solid var(--border,#2a2825)">' +
                '<button onclick="_cerrarAdminGuard()" style="background:transparent;border:1px solid var(--border,#2a2825);' +
                '  color:var(--text-muted,#7a7570);border-radius:8px;padding:8px 18px;cursor:pointer;font-family:inherit;font-size:13px">Cancelar</button>' +
                '<button id="adminGuardBtn" onclick="_confirmarAdminGuard()" style="background:var(--red,#e05a3a);color:#fff;' +
                '  border:none;border-radius:8px;padding:8px 22px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">Eliminar</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(el);
    }

    window._pedirClaveAdmin = function (accion, callback, btnLabel) {
        _ensureModal();
        _guardCb = callback;
        document.getElementById('adminGuardAccion').textContent = accion;
        document.getElementById('adminGuardError').textContent = '';
        document.getElementById('adminGuardInput').value = '';
        var btn = document.getElementById('adminGuardBtn');
        btn.textContent = btnLabel || 'Eliminar';
        btn.style.background = btnLabel ? 'var(--accent,#f5c842)' : 'var(--red,#e05a3a)';
        btn.style.color = btnLabel ? '#000' : '#fff';
        btn.disabled = false;
        document.getElementById('modalAdminGuard').style.display = 'flex';
        setTimeout(function () {
            var inp = document.getElementById('adminGuardInput');
            if (inp) inp.focus();
        }, 80);
    };

    window._cerrarAdminGuard = function () {
        var m = document.getElementById('modalAdminGuard');
        if (m) m.style.display = 'none';
        _guardCb = null;
    };

    window._confirmarAdminGuard = async function () {
        var errEl = document.getElementById('adminGuardError');
        var btn   = document.getElementById('adminGuardBtn');
        var pass  = (document.getElementById('adminGuardInput').value || '').trim();
        if (!pass) { errEl.textContent = 'Ingresa la contraseña'; return; }

        var email = null;
        try {
            var sess = await _supabase.auth.getSession();
            email = sess.data && sess.data.session && sess.data.session.user
                ? sess.data.session.user.email : null;
        } catch (e) {}

        if (!email) {
            errEl.textContent = 'No hay sesión activa. Inicia sesión desde el Hub.';
            return;
        }

        btn.textContent = 'Verificando…';
        btn.disabled = true;
        errEl.textContent = '';

        try {
            var res = await _supabase.auth.signInWithPassword({ email: email, password: pass });
            if (res.error) throw new Error('Contraseña incorrecta');
        } catch (e) {
            errEl.textContent = e.message || 'Error al verificar';
            document.getElementById('adminGuardInput').value = '';
            document.getElementById('adminGuardInput').focus();
            btn.textContent = 'Eliminar';
            btn.disabled = false;
            return;
        }

        btn.textContent = 'Eliminar';
        btn.disabled = false;
        var cb = _guardCb;
        _cerrarAdminGuard();
        alert('Autorizado por: ' + email);
        if (cb) cb();
    };
})();
