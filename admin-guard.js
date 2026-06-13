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
                '<div style="font-size:11px;color:var(--text-dim,#7a7570);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Confirma tu contraseña</div>' +
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

    var _guardSoloAdmin = false;

    window._pedirClaveAdmin = function (accion, callback, btnLabel, opts) {
        _ensureModal();
        _guardCb = callback;
        // soloAdmin: no acepta la contraseña del colaborador, solo la
        // del dueño del negocio o la del admin maestro (p.ej. Permisos)
        _guardSoloAdmin = !!(opts && opts.soloAdmin);
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
        setTimeout(function () {
            var pw = document.getElementById('adminGuardInput');
            if (pw) pw.focus();
        }, 80);
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

    function _guardCtx() {
        try { return JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) { return null; }
    }

    // ¿La contraseña es la del colaborador con sesión activa?
    // (verificación local contra su hash; sus alcances ya los
    // controla el page-guard según Permisos y Roles)
    async function _checkStaffPass(pass) {
        var ctx = _guardCtx();
        if (!ctx || ctx.ctxType !== 'staff' || !ctx.staffId || !ctx.negId) return null;
        var list = [];
        try { list = JSON.parse(localStorage.getItem('etaax_' + ctx.negId + '_staff') || '[]'); } catch (e) {}
        var m = list.find(function (x) { return x.id === ctx.staffId; });
        if (!m || !m.passwordHash) return null;
        if (m.passwordHash.indexOf('v2$') === 0 && typeof _hashPwdStaff === 'function') {
            return (m.passwordHash === await _hashPwdStaff(pass)) ? (m.nombre || 'colaborador') : null;
        }
        if (typeof _hashPwdStaffLegacy === 'function' && m.passwordHash === _hashPwdStaffLegacy(pass)) {
            return m.nombre || 'colaborador';
        }
        return null;
    }

    window._confirmarAdminGuard = async function () {
        var errEl = document.getElementById('adminGuardError');
        var btn   = document.getElementById('adminGuardBtn');
        var lbl   = btn.textContent;
        var pass  = (document.getElementById('adminGuardInput').value || '').trim();
        if (!pass) { errEl.textContent = 'Ingresa la contraseña'; return; }

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
        function autorizar(quien) {
            btn.disabled = false;
            var cb = _guardCb;
            _cerrarAdminGuard();
            alert('Autorizado por: ' + quien);
            if (cb) cb();
        }

        // La contraseña se acepta en este orden:
        // 1. La del colaborador con sesión activa (verificación local),
        //    salvo en modo soloAdmin
        if (!_guardSoloAdmin) {
            var staffNombre = await _checkStaffPass(pass);
            if (staffNombre) { autorizar(staffNombre); return; }
        }

        // 2. La de la cuenta con sesión de Supabase activa (dueño/admin)
        var prevEmail = null;
        try {
            var sess = await _supabase.auth.getSession();
            prevEmail = sess.data && sess.data.session && sess.data.session.user
                ? sess.data.session.user.email : null;
        } catch (e) {}
        if (prevEmail) {
            var r1 = await _supabase.auth.signInWithPassword({ email: prevEmail, password: pass });
            if (!r1.error) { autorizar(prevEmail); return; }
        }

        // 3. La del dueño del negocio activo (correo guardado al
        //    iniciar sesión como dueño en este dispositivo)
        var negId = localStorage.getItem('etaax_negocio_activo') || '';
        var ownerEmail = negId ? (localStorage.getItem('etaax_' + negId + '_owner_email') || '') : '';
        if (ownerEmail && ownerEmail !== prevEmail && ownerEmail !== GUARD_ADMIN_EMAIL) {
            var r2 = await _supabase.auth.signInWithPassword({ email: ownerEmail, password: pass });
            if (!r2.error) { autorizar(ownerEmail); return; }
        }

        // 4. La del admin maestro (abre todo en cualquier escenario)
        if (prevEmail !== GUARD_ADMIN_EMAIL) {
            var r3 = await _supabase.auth.signInWithPassword({ email: GUARD_ADMIN_EMAIL, password: pass });
            if (!r3.error) { autorizar('Admin Maestro'); return; }
        }

        fallar('Contraseña incorrecta');
    };
})();
