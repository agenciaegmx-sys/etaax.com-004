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
                '<div style="font-size:11px;color:var(--text-dim,#7a7570);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Cuenta administradora</div>' +
                '<input type="email" id="adminGuardEmail" placeholder="Correo del dueño o admin" autocomplete="username"' +
                '  style="width:100%;box-sizing:border-box;height:46px;padding:0 14px;border:1px solid var(--border,#2a2825);' +
                '  border-radius:10px;background:var(--bg,#0f0e0c);color:var(--text,#f0ece6);' +
                '  font-family:inherit;font-size:15px;outline:none;transition:border-color .15s;margin-bottom:10px"' +
                '  onfocus="this.style.borderColor=\'var(--accent,#f5c842)\'" onblur="this.style.borderColor=\'var(--border,#2a2825)\'">' +
                '<div style="position:relative">' +
                  '<input type="password" id="adminGuardInput" placeholder="Ingresa tu contraseña"' +
                  '  onkeydown="if(event.key===\'Enter\')_confirmarAdminGuard()"' +
                  '  style="width:100%;box-sizing:border-box;height:46px;padding:0 44px 0 14px;border:1px solid var(--border,#2a2825);' +
                  '  border-radius:10px;background:var(--bg,#0f0e0c);color:var(--text,#f0ece6);' +
                  '  font-family:inherit;font-size:15px;outline:none;transition:border-color .15s"' +
                  '  onfocus="this.style.borderColor=\'var(--accent,#f5c842)\'" onblur="this.style.borderColor=\'var(--border,#2a2825)\'">' +
                  '<button type="button" onclick="_toggleAdminGuardPass()" tabindex="-1"' +
                  '  id="adminGuardEye"' +
                  '  style="position:absolute;right:0;top:0;height:46px;width:42px;background:transparent;border:none;' +
                  '  cursor:pointer;font-size:16px;color:var(--text-dim,#7a7570);display:flex;align-items:center;justify-content:center;' +
                  '  border-radius:0 10px 10px 0;transition:color .15s" title="Mostrar/ocultar contraseña">👁</button>' +
                '</div>' +
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
        var inp = document.getElementById('adminGuardInput');
        inp.value = '';
        inp.type = 'password';
        document.getElementById('adminGuardEye').textContent = '👁';
        var btn = document.getElementById('adminGuardBtn');
        btn.textContent = btnLabel || 'Eliminar';
        btn.style.background = btnLabel ? 'var(--accent,#f5c842)' : 'var(--red,#e05a3a)';
        btn.style.color = btnLabel ? '#000' : '#fff';
        btn.disabled = false;
        document.getElementById('modalAdminGuard').style.display = 'flex';
        // Prellenar el correo con la sesión actual si existe (editable:
        // el admin maestro puede usar sus credenciales en cualquier escenario)
        var emailInp = document.getElementById('adminGuardEmail');
        emailInp.value = '';
        try {
            _supabase.auth.getSession().then(function (sess) {
                var u = sess.data && sess.data.session && sess.data.session.user;
                if (u && u.email && !emailInp.value) emailInp.value = u.email;
            });
        } catch (e) {}
        setTimeout(function () {
            var em = document.getElementById('adminGuardEmail');
            var pw = document.getElementById('adminGuardInput');
            if (em && !em.value) em.focus(); else if (pw) pw.focus();
        }, 120);
    };

    window._toggleAdminGuardPass = function () {
        var inp = document.getElementById('adminGuardInput');
        var eye = document.getElementById('adminGuardEye');
        if (!inp) return;
        var show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        eye.textContent = show ? '🙈' : '👁';
    };

    window._cerrarAdminGuard = function () {
        var m = document.getElementById('modalAdminGuard');
        if (m) m.style.display = 'none';
        _guardCb = null;
    };

    var GUARD_ADMIN_EMAIL = 'admin@etaax.com';

    window._confirmarAdminGuard = async function () {
        var errEl = document.getElementById('adminGuardError');
        var btn   = document.getElementById('adminGuardBtn');
        var lbl   = btn.textContent;
        var email = (document.getElementById('adminGuardEmail').value || '').trim().toLowerCase();
        var pass  = (document.getElementById('adminGuardInput').value || '').trim();
        if (!email) { errEl.textContent = 'Ingresa el correo de la cuenta administradora'; return; }
        if (!pass)  { errEl.textContent = 'Ingresa la contraseña'; return; }

        btn.textContent = 'Verificando…';
        btn.disabled = true;
        errEl.textContent = '';

        function fallar(msg) {
            errEl.textContent = msg;
            document.getElementById('adminGuardInput').value = '';
            document.getElementById('adminGuardInput').focus();
            btn.textContent = lbl === 'Verificando…' ? 'Eliminar' : lbl;
            btn.disabled = false;
        }

        // Email de la sesión previa (si la hay), antes de verificar
        var prevEmail = null;
        try {
            var sess0 = await _supabase.auth.getSession();
            prevEmail = sess0.data && sess0.data.session && sess0.data.session.user
                ? sess0.data.session.user.email : null;
        } catch (e) {}

        // 1. Credenciales válidas (funciona también en sesiones de staff,
        //    que no tienen sesión de Supabase propia)
        var res = await _supabase.auth.signInWithPassword({ email: email, password: pass });
        if (res.error) { fallar('Correo o contraseña incorrectos'); return; }

        // 2. Autorización: admin maestro pasa siempre; cualquier otra
        //    cuenta debe ser dueña del negocio activo (el RLS solo le
        //    regresa el negocio a su dueño o al admin). Sin negocio
        //    activo (hub), debe ser la misma cuenta de la sesión.
        var autorizado = email === GUARD_ADMIN_EMAIL;
        if (!autorizado) {
            var negId = localStorage.getItem('etaax_negocio_activo') || '';
            if (negId) {
                var rn = await _supabase.from('negocios').select('id').eq('id', negId).maybeSingle();
                autorizado = !!(rn.data && rn.data.id);
            } else {
                autorizado = !!prevEmail && email === prevEmail.toLowerCase();
            }
        }
        if (!autorizado) {
            try { await _supabase.auth.signOut(); } catch (e) {}
            fallar('Esta cuenta no administra este negocio');
            return;
        }

        btn.disabled = false;
        var cb = _guardCb;
        _cerrarAdminGuard();
        alert('Autorizado por: ' + email);
        if (cb) cb();
    };
})();
