/* El Supabase de mentira CON CUENTAS: cada signIn revisa correo y contraseña,
   la sesión es de quien entró (sessionStorage '__ses'), las RPC responden según
   esa sesión y la Edge Function admin-staff-etaax se contesta igual que la de
   verdad. Lo usan probar-staff-etaax.cjs y probar-planes-apps.cjs.
   La «nube» vive en localStorage['__nube'] (tablas → filas con sus columnas). */
'use strict';
function sdkEtx() {
    var LL = '__nube';
    function nube() { try { return JSON.parse(localStorage.getItem(LL) || '{}'); } catch (e) { return {}; } }
    function guarda(db) { localStorage.setItem(LL, JSON.stringify(db)); }
    function ses() { try { return JSON.parse(sessionStorage.getItem('__ses') || 'null'); } catch (e) { return null; } }
    function user() { var s = ses(); return s ? { id: s.id, email: s.email, user_metadata: s.meta || {} } : null; }
    window.__nube = { leer: nube, escribir: guarda, caida: false, escrituras: [], log: function () { return []; } };
    window.__rpcs = [];
    function val(r, k) { return (k in r) ? r[k] : (r.datos || {})[k]; }
    function query(tabla) {
        var f = [], modo = 'select', valor = null, opc = {}, single = false, orden = null, desc = false, q = {};
        var mayor = null, limite = null, cuenta = false, errCol = null;
        ['range', 'gte', 'lt', 'lte', 'neq', 'or', 'not', 'ilike', 'like', 'filter', 'contains'].forEach(function (k) { q[k] = function () { return q; }; });
        q.select = function (cols, o) { cuenta = !!(o && o.count === 'exact'); return q; };
        /* Como producción: `negocio_insumos` NO tiene created_at (PostgREST da 400). */
        q.order = function (c, o) {
            if (tabla === 'negocio_insumos' && c === 'created_at') errCol = 'column negocio_insumos.created_at does not exist';
            orden = c; desc = !!(o && o.ascending === false); return q;
        };
        q.gt = function (c, v) { mayor = [c, v]; return q; };
        q.limit = function (n) { limite = n; return q; };
        q.eq = function (k, v) { f.push([k, v]); return q; };
        q.in = function (k, v) { f.push([k, v, 'in']); return q; };
        q.maybeSingle = function () { single = true; return q; };
        q.single = function () { single = true; return q; };
        q.upsert = function (v, o) { modo = 'upsert'; valor = v; opc = o || {}; return q; };
        q.insert = function (v) { modo = 'upsert'; valor = v; return q; };
        q.update = function (v) { modo = 'update'; valor = v; return q; };
        q.delete = function () { modo = 'delete'; return q; };
        q.then = function (res, rej) {
            if (errCol) return Promise.resolve({ data: null, error: { message: errCol, code: '42703' } }).then(res, rej);
            var db = nube(), filas = db[tabla] || [], data = null, total = null;
            /* Una migración que todavía no se corre: la tabla no existe (como PostgREST). */
            if ((db.__sinTabla || []).indexOf(tabla) > -1)
                return Promise.resolve({ data: null, error: { message: 'relation "public.' + tabla + '" does not exist', code: '42P01' } }).then(res, rej);
            var pasa = function (r) { return f.every(function (c) { return c[2] === 'in' ? c[1].indexOf(val(r, c[0])) > -1 : val(r, c[0]) === c[1]; }); };
            if (modo === 'upsert') {
                (Array.isArray(valor) ? valor : [valor]).forEach(function (v) {
                    var claves = (opc.onConflict || (v.id !== undefined ? 'id' : 'negocio_id')).split(',');
                    var i = filas.findIndex(function (r) { return claves.every(function (k) { return r[k] === v[k]; }); });
                    var fila = JSON.parse(JSON.stringify(v));
                    if (i > -1) filas[i] = Object.assign(filas[i], fila); else filas.push(fila);
                    window.__nube.escrituras.push(tabla);
                });
                db[tabla] = filas; guarda(db); data = valor;
            } else if (modo === 'update') {
                filas.filter(pasa).forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(valor))); });
                db[tabla] = filas; guarda(db);
            } else if (modo === 'delete') {
                db[tabla] = filas.filter(function (r) { return !pasa(r); }); guarda(db);
            } else {
                data = JSON.parse(JSON.stringify(filas.filter(pasa)));
                total = data.length;
                if (orden) data.sort(function (a, b) { var x = String(val(a, orden)), y = String(val(b, orden)); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); });
                if (mayor) data = data.filter(function (r) { return String(val(r, mayor[0])) > String(mayor[1]); });
                /* Como Supabase: nunca más de 1000 renglones por consulta, sin aviso. */
                data = data.slice(0, Math.min(limite || 1000, 1000));
                if (single) data = data[0] || null;
            }
            return Promise.resolve({ data: data, error: null, count: cuenta ? total : null }).then(res, rej);
        };
        return q;
    }
    function activo(x) { return !!x && (x.datos || {}).activo !== false; }
    var RPC = {
        etx_mis_negocios: function () {
            var u = user(), db = nube(); if (!u) return [];
            var s = (db.etaax_staff || []).find(function (x) { return x.uid === u.id; });
            if (!activo(s)) return [];
            return (db.etaax_staff_accesos || []).filter(function (a) { return a.uid === u.id && activo(a); }).map(function (a) {
                var n = (db.negocios || []).find(function (x) { return x.id === a.negocio_id; }) || {};
                return { negocio_id: a.negocio_id, negocio: n.datos || {}, acceso: a.datos };
            });
        },
        /* Venta por apps (v89): el plan sale de la suscripción; el cobro, siempre al día. */
        negocio_plan: function (p) { var s = (nube().suscripciones || []).find(function (x) { return x.negocio_id === p.p_neg; }); return (s && s.plan) || null; },
        negocio_cobro_estado: function () { return { activo: true, estado: 'activa', proximoCobro: '2026-12-31', diasTolerancia: 3, diasRestantes: 30 }; },
        negocio_esta_activo: function () { return true; },
        /* El token del QR del negocio (v27): uno por negocio. */
        entrada_token_asegurar: function (p) { return 'tok-' + p.p_neg; },
        /* La app móvil por sucursal (v92): el token de UNA sucursal, si la tiene
           activa en movil_acceso (sin sucursal: Matriz o la primera activa). */
        movil_token: function (p) {
            var m = (nube().movil_acceso || []).find(function (x) { return x.negocio_id === p.p_neg; });
            var act = (m && m.datos && m.datos.sucursales) || {};
            var suc = p.p_suc || (act.suc_principal === true ? 'suc_principal' : Object.keys(act).filter(function (k) { return act[k] === true; })[0]);
            if (!suc || act[suc] !== true) return null;
            return { token: 'tok-' + p.p_neg + '-' + suc, sucursalId: suc };
        },
        admin_etx_uid: function (p) { var x = (nube().__auth || []).find(function (u) { return u.email === String(p.p_email).toLowerCase(); }); return x ? x.id : null; },
        admin_etx_clave: function (p) {
            var db = nube(), x = (db.__auth || []).find(function (u) { return u.id === p.p_uid; });
            if (!x || !/@staff\.etaax\.app$/.test(x.email)) throw new Error('Esa cuenta no es del Staff ETAAX.');
            x.password = p.p_clave; guarda(db); return null;
        },
        admin_etx_baja: function (p) {
            var db = nube();
            db.etaax_staff = (db.etaax_staff || []).filter(function (s) { return s.uid !== p.p_uid; });
            db.etaax_staff_accesos = (db.etaax_staff_accesos || []).filter(function (s) { return s.uid !== p.p_uid; });
            var x = (db.__auth || []).find(function (u) { return u.id === p.p_uid; }); if (x) x.password = '~' + Math.random();
            guarda(db); return null;
        }
    };
    /* La Edge Function admin-staff-etaax, de mentira: mismas respuestas y mismos
       candados (solo la sesión del admin). `__funcionDesplegada = false` simula
       que todavía no se desplegó (el navegador no recibe respuesta). */
    var fetchReal = window.fetch;
    window.__funcionDesplegada = true; window.__llamadas = [];
    window.fetch = async function (url, opc) {
        if (String(url).indexOf('/functions/v1/admin-staff-etaax') === -1) return fetchReal.apply(this, arguments);
        if (!window.__funcionDesplegada) throw new TypeError('Failed to fetch');
        var resp = function (b, st) { return new Response(JSON.stringify(b), { status: st || 200, headers: { 'Content-Type': 'application/json' } }); };
        var u = user();
        if (!u || u.email !== 'admin@etaax.com' || !/^Bearer ./.test((opc.headers || {}).Authorization || '')) return resp({ ok: false, error: 'Sesión no válida.' }, 401);
        var b = JSON.parse(opc.body), db = nube(); db.__auth = db.__auth || [];
        window.__llamadas.push(b.accion);
        var delStaff = function (uid) { var x = db.__auth.find(function (a) { return a.id === uid; }); return !!x && /@staff\.etaax\.app$/.test(x.email); };
        if (b.accion === 'crear') {
            if ((db.etaax_staff || []).some(function (x) { return x.usuario === b.usuario; })) return resp({ ok: false, error: 'Ya hay alguien del Staff ETAAX con ese usuario.' }, 409);
            if ((db.staff || []).some(function (x) { return (x.datos || {}).usuario === b.usuario; })) return resp({ ok: false, error: 'Ese usuario ya lo tiene un colaborador de un negocio. Elige otro.' }, 409);
            var email = b.usuario + '@staff.etaax.app', x = db.__auth.find(function (a) { return a.email === email; });
            if (x) x.password = b.password;
            else { x = { id: 'uid-' + Math.random().toString(36).slice(2, 10), email: email, password: b.password, meta: { nombre: b.nombre } }; db.__auth.push(x); }
            db.etaax_staff = (db.etaax_staff || []).filter(function (r) { return r.uid !== x.id; });
            db.etaax_staff.push({ uid: x.id, usuario: b.usuario, datos: { nombre: b.nombre } });
            guarda(db); return resp({ ok: true, uid: x.id });
        }
        if (b.accion === 'clave') {
            if (!delStaff(b.uid)) return resp({ ok: false, error: 'Esa cuenta no es del Staff ETAAX.' }, 400);
            db.__auth.find(function (a) { return a.id === b.uid; }).password = b.password; guarda(db); return resp({ ok: true });
        }
        if (b.accion === 'baja') {
            if (!delStaff(b.uid)) return resp({ ok: false, error: 'Esa cuenta no es del Staff ETAAX.' }, 400);
            db.etaax_staff = (db.etaax_staff || []).filter(function (r) { return r.uid !== b.uid; });
            db.etaax_staff_accesos = (db.etaax_staff_accesos || []).filter(function (r) { return r.uid !== b.uid; });
            db.__auth = db.__auth.filter(function (a) { return a.id !== b.uid; });
            guarda(db); return resp({ ok: true });
        }
        return resp({ ok: false, error: 'Acción desconocida.' }, 400);
    };
    window.supabase = { createClient: function (url, key, o) {
        var efimero = !!(o && o.auth && o.auth.persistSession === false), local = null;
        var quien = function () { return efimero ? local : user(); };
        return {
            auth: {
                getSession: async function () { var u = quien(); return { data: { session: u ? { user: u, access_token: 'x' } : null }, error: null }; },
                getUser: async function () { return { data: { user: quien() }, error: null }; },
                onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
                signInWithPassword: async function (c) {
                    var x = (nube().__auth || []).find(function (u) { return u.email === String(c.email).toLowerCase() && u.password === c.password; });
                    if (!x) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
                    var uu = { id: x.id, email: x.email, user_metadata: x.meta || {} };
                    if (efimero) local = uu; else sessionStorage.setItem('__ses', JSON.stringify({ id: x.id, email: x.email, meta: x.meta }));
                    return { data: { user: uu, session: { user: uu } }, error: null };
                },
                // Como en producción: los registros abiertos están apagados.
                signUp: async function () { return { data: { user: null }, error: { message: 'Signups not allowed for this instance' } }; },
                signOut: async function () { if (efimero) local = null; else sessionStorage.removeItem('__ses'); return { error: null }; },
                refreshSession: async function () { return { data: { session: null }, error: null }; },
                updateUser: async function () { return { data: {}, error: null }; }
            },
            from: query,
            rpc: async function (fn, p) {
                window.__rpcs.push(fn);
                /* Cada arnés puede traer sus RPC (window.__rpcExtra, por initScript) y
                   simular una migración sin correr (window.__rpcSinCorrer). */
                if ((window.__rpcSinCorrer || []).indexOf(fn) > -1)
                    return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + fn } };
                var X = window.__rpcExtra || {};
                if (X[fn]) { try { return { data: X[fn](p || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } }
                if (RPC[fn]) { try { return { data: RPC[fn](p || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } }
                return { data: null, error: null };
            },
            channel: function () { return { on: function () { return this; }, subscribe: function () { return this; }, track: async function () {}, presenceState: function () { return {}; }, unsubscribe: function () {} }; },
            removeChannel: async function () {},
            storage: { from: function () { return { upload: async function () { return { error: null }; }, getPublicUrl: function () { return { data: { publicUrl: '' } }; },
                createSignedUrl: async function () { return { data: { signedUrl: '' }, error: null }; } }; } }
        };
    } };
}
module.exports = { sdkEtx };
