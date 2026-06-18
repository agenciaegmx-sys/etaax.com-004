/* ============================================================
   ETAAX — Cuenta de Supabase por negocio para colaboradores
   Permite que las sesiones de staff (gerente, administración, chef, jefe de
   barra) lean/escriban los datos del negocio en la nube, sin exponer la cuenta
   del dueño. Requiere la migración v19 (negocios.staff_uid/staff_cred + RLS).

   - StaffAuth.provisionar(negId)  → (DUEÑO) crea/asegura la cuenta y cachea las
                                      credenciales en este equipo. Best-effort.
   - StaffAuth.login(negId)        → (STAFF) inicia esa cuenta en Supabase.
                                      Devuelve true si quedó con sesión real.

   Diseño seguro:
   - La cuenta se crea con un cliente EFÍMERO (no toca la sesión activa).
   - Si algo falla, el colaborador sigue trabajando en local (sin regresión).
   - Las credenciales se guardan en negocios.staff_cred (solo las leen el dueño
     y la propia cuenta de staff por RLS) y se cachean localmente para el login.
   ============================================================ */
(function () {
    function _credKey(negId) { return 'etaax_' + negId + '_staffcred'; }
    function _getCredLocal(negId) {
        try { return JSON.parse(localStorage.getItem(_credKey(negId)) || 'null'); } catch (e) { return null; }
    }
    function _setCredLocal(negId, cred) {
        try { localStorage.setItem(_credKey(negId), JSON.stringify(cred)); } catch (e) {}
    }

    // Cliente efímero (storage propio en memoria) para crear la cuenta sin
    // reemplazar la sesión activa del dueño.
    var _ephem = null;
    function _getEphem() {
        if (_ephem) return _ephem;
        if (typeof supabase === 'undefined' || !supabase.createClient) return null;
        var url = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : (window.SUPABASE_URL || '');
        var key = (typeof SUPABASE_ANON !== 'undefined') ? SUPABASE_ANON : (window.SUPABASE_ANON || '');
        if (!url || !key) return null;
        _ephem = supabase.createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'etaax-staff-prov' }
        });
        return _ephem;
    }

    function _email(negId) { return 'staff.' + String(negId).toLowerCase() + '@etaax.app'; }
    function _genPass() {
        return 'Sx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14) + 'Z9!';
    }

    var _lastErr = null;  // último motivo de fallo (para diagnóstico)

    // Diagnóstico desde consola: _staffDiag() dice qué falta para el acceso staff.
    window._staffDiag = async function (negId) {
        negId = negId || localStorage.getItem('etaax_negocio_activo') || '';
        var cred = _getCredLocal(negId), sess = null, nube = null;
        try { var s = await _supabase.auth.getSession(); sess = (s.data && s.data.session && s.data.session.user) ? s.data.session.user.email : null; } catch (e) {}
        try { var n = await _supabase.from('negocios').select('staff_uid,staff_cred').eq('id', negId).maybeSingle(); nube = n.error ? ('ERROR: ' + n.error.message) : (n.data ? { staff_uid: n.data.staff_uid, tiene_cred: !!(n.data.staff_cred && n.data.staff_cred.email) } : null); } catch (e) {}
        var info = {
            negId: negId,
            credCacheadaEnEsteEquipo: !!(cred && cred.email),
            emailCuentaStaff: cred ? cred.email : null,
            sesionSupabaseActiva: sess,
            enLaNube: nube,
            ultimoError: _lastErr
        };
        console.log('[staff-auth] diagnóstico:', info);
        return info;
    };

    window.StaffAuth = {
        getCredLocal: _getCredLocal,

        // DUEÑO: asegura que el negocio tenga su cuenta de colaboradores.
        provisionar: async function (negId) {
            if (!negId || typeof _supabase === 'undefined') return;
            try {
                // ¿Ya existe? (en la nube) → cachear local y listo.
                var n = await _supabase.from('negocios').select('staff_uid,staff_cred').eq('id', negId).maybeSingle();
                // Si las columnas no existen aún (falta correr v19), NO crear la
                // cuenta: evitaría una cuenta huérfana imposible de recuperar.
                if (!n || n.error) return;
                if (n.data && n.data.staff_uid && n.data.staff_cred && n.data.staff_cred.email) {
                    _setCredLocal(negId, n.data.staff_cred);
                    return;
                }
                // Crear la cuenta con el cliente efímero.
                var ep = _getEphem(); if (!ep) return;
                var email = _email(negId), pass = _genPass();
                var up = await ep.auth.signUp({ email: email, password: pass });
                if (up.error) {
                    // Típico: "Signups not allowed" (deshabilitado en Auth) o límite.
                    _lastErr = 'signUp: ' + up.error.message;
                    console.warn('[staff-auth] no se pudo crear la cuenta de staff:', up.error.message,
                        '· Revisa Supabase → Auth: permite registros y desactiva "Confirm email".');
                    return;
                }
                var uid = up.data && up.data.user ? up.data.user.id : null;
                try { await ep.auth.signOut({ scope: 'local' }); } catch (e) {}
                if (!uid) { _lastErr = 'signUp sin uid'; return; }
                var cred = { email: email, password: pass };
                var u = await _supabase.from('negocios').update({ staff_uid: uid, staff_cred: cred }).eq('id', negId);
                if (u.error) { _lastErr = 'update negocios: ' + u.error.message; console.warn('[staff-auth] no se pudo guardar la cuenta:', u.error.message); return; }
                _setCredLocal(negId, cred);
                _lastErr = null;
                console.log('[staff-auth] cuenta de colaboradores lista para', negId);
            } catch (e) { console.warn('[staff-auth] provisionar:', e); }
        },

        // STAFF: inicia la cuenta compartida del negocio en Supabase.
        // Devuelve true si quedó con sesión real; false → seguir en local.
        login: async function (negId) {
            if (!negId || typeof _supabase === 'undefined') return false;
            var cred = _getCredLocal(negId);
            if (!cred || !cred.email) {
                _lastErr = 'sin credenciales en este equipo (el dueño debe iniciar sesión aquí tras correr v19)';
                console.warn('[staff-auth] ' + _lastErr);
                return false;
            }
            try {
                var r = await _supabase.auth.signInWithPassword({ email: cred.email, password: cred.password });
                if (r.error) {
                    // Típico: "Email not confirmed" → falta desactivar "Confirm email".
                    _lastErr = 'login: ' + r.error.message;
                    console.warn('[staff-auth] login staff:', r.error.message,
                        '· Si dice "Email not confirmed", desactiva "Confirm email" en Supabase → Auth.');
                    return false;
                }
                _lastErr = null;
                return true;
            } catch (e) { _lastErr = 'login: ' + ((e && e.message) || e); console.warn('[staff-auth] login staff:', e); return false; }
        }
    };
})();
