/* ============================================================================
   ETAAX — PANEL ADMIN · STAFF ETAAX (window.AdmEtx)

   La pantalla «Staff ETAAX» del admin maestro (admin.html, #auditores):
     · dar de alta a una persona del equipo de ETAAX con usuario y contraseña;
     · darle acceso a uno o varios negocios: qué sucursales (o todas) y qué
       módulos, con los mismos sub-permisos de Roles y Permisos;
     · pausar un acceso, quitarlo, desactivar a la persona, cambiarle la
       contraseña o darla de baja.

   Las reglas compartidas (usuario, correo interno, módulos) viven en
   staff-etaax.js; la puerta de verdad, en la base (supabase-migration-v88.sql).

   La cuenta de Auth la crea, le cambia la contraseña y la da de baja la Edge
   Function `admin-staff-etaax` (supabase/functions/admin-staff-etaax): los
   registros abiertos están APAGADOS en Supabase a propósito, así que signUp
   desde aquí contesta «Signups not allowed». La función usa la llave de
   servicio y solo acepta la sesión del admin maestro. Accesos, nombre y
   activar/desactivar van directo a las tablas (RLS admin_all de la v88).

   Usa del panel: _supabase, _data (negocios y sucursales), esc, etaaxJsArg,
   _admIc, EtaaxPwd. Sub-permisos: ETAAX_SUBPERMS (page-guard.js).
   ============================================================================ */
(function () {
    'use strict';
    var E = { cargado: false, error: '', personas: [], accesos: [], sel: null, edit: {}, abiertos: {}, msg: {} };

    function q(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s); }
    function a(s) { return (typeof etaaxJsArg === 'function') ? etaaxJsArg(s) : String(s); }
    function ic(n, t) { return (typeof _admIc === 'function') ? _admIc(n, t || 18) : ''; }
    function copia(o) { return JSON.parse(JSON.stringify(o || {})); }
    function negs() { return (window._data && _data.negocios) || []; }
    function nombreNeg(id) { var n = negs().find(function (x) { return x.id === id; }); return (n && n.datos && n.datos.nombre) || id; }
    function sucsDe(id) { return ((window._data && _data.sucursales) || {})[id] || []; }
    function persona(uid) { return E.personas.find(function (p) { return p.uid === uid; }) || null; }
    function accesosDe(uid) { return E.accesos.filter(function (x) { return x.uid === uid; }); }
    function sub() { return window.ETAAX_SUBPERMS || {}; }
    function el() { return document.getElementById('tab-auditores'); }

    function faltaV88(err) { return /etaax_staff|admin_etx|does not exist|schema cache/i.test((err && (err.message || err.details)) || ''); }
    function msgError(err) {
        if (faltaV88(err)) return 'Falta correr supabase-migration-v88.sql en Supabase (SQL Editor).';
        return (err && err.message) || String(err || 'Error');
    }

    /* ── Leer ─────────────────────────────────────────────────────────────── */
    async function cargar() {
        if (typeof _supabase === 'undefined') return;
        var r = await Promise.all([
            _supabase.from('etaax_staff').select('*').order('created_at', { ascending: true }),
            _supabase.from('etaax_staff_accesos').select('*')
        ]);
        var err = r[0].error || r[1].error;
        E.error = err ? msgError(err) : '';
        E.personas = r[0].data || [];
        E.accesos = r[1].data || [];
        E.cargado = true;
    }

    /* La tarjeta de la portada dice cuántos hay. */
    function chip(ch) {
        if (!E.cargado || E.error) return '';
        var n = E.personas.length;
        return ch(n + (n === 1 ? ' persona' : ' personas'));
    }

    /* ── Pintar ───────────────────────────────────────────────────────────── */
    function render() {
        var c = el(); if (!c) return;
        if (!window.StaffEtx) { c.innerHTML = '<div class="empty-state">No cargó staff-etaax.js. Recarga la página.</div>'; return; }
        c.innerHTML =
            '<div class="adm-caja mig-intro"><div class="mig-pasos">' +
                '<span><b>1</b> Da de alta a la persona con su usuario y su contraseña</span>' +
                '<span><b>2</b> Dale acceso a uno o varios negocios: qué sucursales y qué módulos</span>' +
                '<span><b>3</b> Entra en el login de siempre con su usuario: ve sus negocios y, en cada uno, solo lo que le diste</span>' +
            '</div></div>' +
            (E.error ? '<div class="mig-bloqueo" style="margin-top:14px">' + q(E.error) + '</div>' : '') +
            '<div class="etx-lay">' +
                '<div class="adm-caja etx-lista">' +
                    '<div class="etx-lista-cab"><span class="mig-sub" style="margin:0">Personas</span>' +
                        '<button type="button" class="btn-add" onclick="AdmEtx.nueva()">+ Nueva persona</button></div>' +
                    listaHTML() +
                '</div>' +
                '<div class="etx-detalle">' + detalleHTML() + '</div>' +
            '</div>';
        if (E.sel === 'nueva' && window.EtaaxPwd) { try { EtaaxPwd.montar('etxAltaPass', {}); } catch (e) {} }
        if (E.sel && E.sel !== 'nueva' && window.EtaaxPwd) { try { EtaaxPwd.montar('etxClaveNueva', {}); } catch (e) {} }
    }
    function listaHTML() {
        if (!E.cargado) return '<div class="empty-state">Cargando…</div>';
        if (!E.personas.length) return '<div class="empty-state" style="padding:28px 10px">Todavía no hay nadie. Da de alta a la primera persona.</div>';
        return E.personas.map(function (p) {
            var d = p.datos || {}, n = accesosDe(p.uid).length, act = StaffEtx.activo(p);
            return '<button type="button" class="etx-persona' + (E.sel === p.uid ? ' sel' : '') + '" data-uid="' + q(p.uid) + '" onclick="AdmEtx.elegir(\'' + a(p.uid) + '\')">' +
                '<span class="etx-persona-nom">' + q(d.nombre || p.usuario) + '</span>' +
                '<span class="etx-persona-meta">@' + q(p.usuario) + ' · ' + n + ' negocio' + (n === 1 ? '' : 's') + '</span>' +
                '<span class="adm-chip' + (act ? '' : ' urg') + '">' + (act ? 'Activo' : 'Desactivado') + '</span>' +
            '</button>';
        }).join('');
    }
    function detalleHTML() {
        if (E.sel === 'nueva') return altaHTML();
        var p = E.sel && persona(E.sel);
        if (!p) return '<div class="adm-caja"><div class="empty-state" style="padding:36px 10px">Elige una persona o da de alta una nueva.</div></div>';
        var d = p.datos || {}, act = StaffEtx.activo(p);
        var lista = accesosDe(p.uid);
        var libres = negs().filter(function (n) { return !lista.some(function (x) { return x.negocio_id === n.id; }) && !E.edit[p.uid + '|' + n.id]; });
        var nuevos = Object.keys(E.edit).filter(function (k) { return k.indexOf(p.uid + '|') === 0 && !lista.some(function (x) { return p.uid + '|' + x.negocio_id === k; }); })
                         .map(function (k) { return k.slice(p.uid.length + 1); });
        return '<div class="adm-caja">' +
                '<div class="etx-cab"><div><div class="etx-nom">' + q(d.nombre || p.usuario) + '</div>' +
                    '<div class="etx-usr">Entra con el usuario <b>' + q(p.usuario) + '</b> en el login de siempre</div></div>' +
                    '<span class="adm-chip' + (act ? '' : ' urg') + '">' + (act ? 'Activo' : 'Desactivado') + '</span></div>' +
                '<div class="form-grid" style="margin-top:14px">' +
                    '<div><label class="form-label" for="etxNombre">Nombre</label>' +
                        '<input id="etxNombre" class="form-input" value="' + q(d.nombre || '') + '" maxlength="80"></div>' +
                    '<div><label class="form-label" for="etxClaveNueva">Nueva contraseña</label>' +
                        '<input id="etxClaveNueva" class="form-input" type="text" autocomplete="new-password" placeholder="Solo si la quieres cambiar"></div>' +
                '</div>' +
                '<div class="mig-acciones">' +
                    '<button type="button" class="btn-mini" onclick="AdmEtx.guardarNombre()">Guardar nombre</button>' +
                    '<button type="button" class="btn-mini" onclick="AdmEtx.cambiarClave()">Cambiar contraseña</button>' +
                    '<button type="button" class="btn-mini" onclick="AdmEtx.activar(' + (act ? 'false' : 'true') + ')">' + (act ? 'Desactivar' : 'Reactivar') + '</button>' +
                    '<button type="button" class="btn-mini peligro" onclick="AdmEtx.baja()">Dar de baja</button>' +
                '</div>' +
                msgHTML('persona') +
            '</div>' +
            '<h3 class="mig-bloque-tit">' + ic('sh-info-negocio', 18) + 'Negocios con acceso</h3>' +
            (lista.length || nuevos.length ? '' : '<div class="adm-caja"><div class="empty-state" style="padding:24px 10px">Sin negocios todavía. Dale acceso a uno abajo.</div></div>') +
            lista.map(function (x) { return accesoHTML(p, x.negocio_id, x.datos || {}, false); }).join('') +
            nuevos.map(function (neg) { return accesoHTML(p, neg, null, true); }).join('') +
            '<div class="adm-caja" style="margin-top:12px"><div class="form-grid" style="align-items:end">' +
                '<div><label class="form-label" for="etxNuevoNeg">Dar acceso a otro negocio</label>' +
                    '<select id="etxNuevoNeg" class="form-select"><option value="">Elige un negocio…</option>' +
                    libres.map(function (n) { return '<option value="' + q(n.id) + '">' + q((n.datos || {}).nombre || n.id) + '</option>'; }).join('') +
                    '</select></div>' +
                '<div><button type="button" class="btn-mini" onclick="AdmEtx.agregarNegocio()">+ Agregar</button></div>' +
            '</div></div>';
    }
    function msgHTML(k) {
        var m = E.msg[k];
        if (!m) return '';
        return '<div class="' + (m.ok ? 'mig-ok-nota' : 'form-error') + '" style="margin-top:10px">' + (m.ok ? ic('adm-pagado', 16) : '') + q(m.txt) + '</div>';
    }
    function altaHTML() {
        return '<div class="adm-caja">' +
            '<div class="mig-tit"><span class="mig-num">1</span>Nueva persona del Staff ETAAX</div>' +
            '<div class="form-grid">' +
                '<div><label class="form-label" for="etxAltaNombre">Nombre</label>' +
                    '<input id="etxAltaNombre" class="form-input" maxlength="80" placeholder="Ej. Ana López"></div>' +
                '<div><label class="form-label" for="etxAltaUsuario">Usuario (con esto entra)</label>' +
                    '<input id="etxAltaUsuario" class="form-input" maxlength="40" placeholder="ej. ana.auditora" autocomplete="off" ' +
                    'oninput="AdmEtx.previaUsuario()"><div class="adm-nota" id="etxAltaPrevia" style="margin-top:6px"></div></div>' +
                '<div><label class="form-label" for="etxAltaPass">Contraseña</label>' +
                    '<input id="etxAltaPass" class="form-input" type="text" autocomplete="new-password"></div>' +
            '</div>' +
            '<div class="mig-acciones"><button type="button" class="btn-prim" id="etxAltaBtn" onclick="AdmEtx.alta()">Dar de alta</button>' +
                '<button type="button" class="btn-mini" onclick="AdmEtx.elegir(null)">Cancelar</button></div>' +
            msgHTML('alta') +
            '<div class="adm-nota" style="margin-top:12px">Después le das acceso a sus negocios. El usuario no se puede cambiar; la contraseña sí.</div>' +
        '</div>';
    }

    /* Un acceso: sucursales y módulos de UN negocio. Se edita sobre una copia
       (E.edit) y se guarda con su botón. */
    function trabajo(uid, neg, datos) {
        var k = uid + '|' + neg;
        if (!E.edit[k]) {
            var d = copia(datos || {});
            if (!d.permisos) d.permisos = StaffEtx.permisosIniciales();
            if (!Array.isArray(d.sucursales)) d.sucursales = [];
            E.edit[k] = d;
        }
        return E.edit[k];
    }
    function accesoHTML(p, neg, datos, nuevo) {
        var w = trabajo(p.uid, neg, datos), k = p.uid + '|' + neg;
        var sucs = sucsDe(neg), todas = !w.sucursales.length && !w._contadas;
        var pausado = w.activo === false;
        var grupos = [];
        StaffEtx.MODULOS.forEach(function (m) { if (grupos.indexOf(m.grupo) === -1) grupos.push(m.grupo); });
        return '<div class="adm-caja etx-acceso' + (pausado ? ' pausado' : '') + '" data-neg="' + q(neg) + '">' +
            '<div class="etx-cab"><div class="etx-nom" style="font-size:16px">' + q(nombreNeg(neg)) + '</div>' +
                '<span class="adm-chip' + (nuevo ? ' aviso' : (pausado ? ' urg' : '')) + '">' + (nuevo ? 'Sin guardar' : (pausado ? 'En pausa' : 'Activo')) + '</span></div>' +
            '<div class="mig-sub">Sucursales</div>' +
            '<label class="mig-check" style="margin-top:0"><input type="checkbox"' + (todas ? ' checked' : '') +
                ' onchange="AdmEtx.todas(\'' + a(neg) + '\', this.checked)"><span><b>Todas las sucursales</b> — también las que se abran después</span></label>' +
            (todas ? '' : '<div class="etx-chips">' + (sucs.length ? sucs.map(function (s) {
                var on = w.sucursales.indexOf(s.id) !== -1;
                return '<label class="etx-chk"><input type="checkbox"' + (on ? ' checked' : '') +
                    ' onchange="AdmEtx.suc(\'' + a(neg) + '\', \'' + a(s.id) + '\', this.checked)">' + q(s.nombre) + '</label>';
            }).join('') : '<span class="adm-nota">Este negocio no tiene sucursales registradas.</span>') + '</div>') +
            '<div class="mig-sub">Módulos</div>' +
            grupos.map(function (g) {
                return '<div class="etx-grupo"><div class="etx-grupo-tit">' + q(g) + '</div><div class="etx-mods">' +
                    StaffEtx.MODULOS.filter(function (m) { return m.grupo === g; }).map(function (m) { return modHTML(k, neg, w, m); }).join('') +
                '</div></div>';
            }).join('') +
            '<div class="mig-acciones">' +
                '<button type="button" class="btn-prim" onclick="AdmEtx.guardarAcceso(\'' + a(neg) + '\')">Guardar acceso</button>' +
                (nuevo ? '<button type="button" class="btn-mini" onclick="AdmEtx.descartar(\'' + a(neg) + '\')">Descartar</button>'
                       : '<button type="button" class="btn-mini" onclick="AdmEtx.pausar(\'' + a(neg) + '\', ' + (pausado ? 'false' : 'true') + ')">' + (pausado ? 'Reanudar' : 'Pausar') + '</button>' +
                         '<button type="button" class="btn-mini peligro" onclick="AdmEtx.quitar(\'' + a(neg) + '\')">Quitar acceso</button>') +
            '</div>' + msgHTML(k) +
        '</div>';
    }
    function modHTML(k, neg, w, m) {
        var v = w.permisos[m.key], on = !!v, subs = sub()[m.key] || [];
        var abierto = !!E.abiertos[k + '|' + m.key];
        var nOn = !on ? 0 : (v === true ? subs.length : subs.filter(function (s) { return v[s.key] !== false; }).length);
        return '<div class="etx-mod' + (on ? ' on' : '') + '">' +
            '<label class="etx-chk"><input type="checkbox"' + (on ? ' checked' : '') +
                ' onchange="AdmEtx.mod(\'' + a(neg) + '\', \'' + a(m.key) + '\', this.checked)">' + q(m.label) + '</label>' +
            (on && subs.length ? '<button type="button" class="etx-ajustar" onclick="AdmEtx.ajustar(\'' + a(neg) + '\', \'' + a(m.key) + '\')">' +
                (nOn === subs.length ? 'Todo' : nOn + ' de ' + subs.length) + ' ' + (abierto ? '▴' : '▾') + '</button>' : '') +
            (on && abierto ? '<div class="etx-subs">' + subs.map(function (s) {
                var sOn = v === true || v[s.key] !== false;
                return '<label class="etx-chk" title="' + q(s.sub || '') + '"><input type="checkbox"' + (sOn ? ' checked' : '') +
                    ' onchange="AdmEtx.sub(\'' + a(neg) + '\', \'' + a(m.key) + '\', \'' + a(s.key) + '\', this.checked)">' + q(s.label) + '</label>';
            }).join('') + '</div>' : '') +
        '</div>';
    }

    /* ── Editar un acceso (en la copia de trabajo) ────────────────────────── */
    function w(neg) { return E.edit[E.sel + '|' + neg]; }
    function todas(neg, si) {
        var x = w(neg); if (!x) return;
        x.sucursales = [];
        if (si) delete x._contadas; else x._contadas = true;
        render();
    }
    function suc(neg, sucId, si) {
        var x = w(neg); if (!x) return;
        x._contadas = true;
        x.sucursales = x.sucursales.filter(function (s) { return s !== sucId; });
        if (si) x.sucursales.push(sucId);
        render();
    }
    function mod(neg, key, si) {
        var x = w(neg); if (!x) return;
        x.permisos[key] = !!si;
        render();
    }
    function ajustar(neg, key) { var k = E.sel + '|' + neg + '|' + key; E.abiertos[k] = !E.abiertos[k]; render(); }
    /* Un sub-permiso apagado vuelve el módulo un objeto con TODAS sus llaves
       escritas; con todas prendidas regresa a `true` (así un sub-permiso que se
       agregue después nace permitido, como en Roles y Permisos). */
    function subp(neg, key, s, si) {
        var x = w(neg); if (!x) return;
        var lista = sub()[key] || [], v = x.permisos[key], o = {};
        lista.forEach(function (it) { o[it.key] = v === true ? true : (v && v[it.key] !== false); });
        o[s] = !!si;
        var todos = lista.every(function (it) { return o[it.key]; });
        x.permisos[key] = todos ? true : o;
        render();
    }

    function limpio(x) {
        var d = copia(x);
        delete d._contadas;
        if (d.activo !== false) delete d.activo;
        return d;
    }
    async function guardarAcceso(neg) {
        var uid = E.sel, x = w(neg), k = uid + '|' + neg;
        if (!x) return;
        if (x._contadas && !x.sucursales.length) { E.msg[k] = { txt: 'Elige al menos una sucursal, o marca «Todas».' }; render(); return; }
        if (!StaffEtx.modulosPrendidos(x).length) { E.msg[k] = { txt: 'Prende al menos un módulo.' }; render(); return; }
        var datos = limpio(x);
        var r = await _supabase.from('etaax_staff_accesos').upsert({ uid: uid, negocio_id: neg, datos: datos, updated_at: new Date().toISOString() },
                                                                 { onConflict: 'uid,negocio_id' });
        if (r.error) { E.msg[k] = { txt: msgError(r.error) }; render(); return; }
        await cargar();
        delete E.edit[k];
        E.msg[k] = { ok: true, txt: 'Guardado. Lo verá la próxima vez que entre a ese negocio.' };
        render();
    }
    async function pausar(neg, si) {
        var x = w(neg); if (!x) return;
        x.activo = si ? false : true;
        await guardarAcceso(neg);
    }
    async function quitar(neg) {
        var p = persona(E.sel); if (!p) return;
        if (!confirm('¿Quitarle a ' + ((p.datos || {}).nombre || p.usuario) + ' el acceso a ' + nombreNeg(neg) + '?\n\nDeja de verlo en ese momento.')) return;
        var r = await _supabase.from('etaax_staff_accesos').delete().eq('uid', E.sel).eq('negocio_id', neg);
        if (r.error) { E.msg[E.sel + '|' + neg] = { txt: msgError(r.error) }; render(); return; }
        delete E.edit[E.sel + '|' + neg];
        await cargar(); render();
    }
    function descartar(neg) { delete E.edit[E.sel + '|' + neg]; render(); }
    function agregarNegocio() {
        var s = document.getElementById('etxNuevoNeg'), neg = s && s.value;
        if (!neg || !E.sel) return;
        trabajo(E.sel, neg, null);
        render();
    }

    /* ── La persona ───────────────────────────────────────────────────────── */
    function nueva() { E.sel = 'nueva'; E.msg = {}; render(); }
    function elegir(uid) { E.sel = uid; E.msg = {}; E.edit = {}; E.abiertos = {}; render(); }
    function previaUsuario() {
        var i = document.getElementById('etxAltaUsuario'), p = document.getElementById('etxAltaPrevia');
        if (!i || !p) return;
        var u = StaffEtx.normalizarUsuario(i.value);
        p.textContent = !i.value ? '' : (StaffEtx.usuarioValido(u) ? 'Entrará como «' + u + '»' : 'De 3 a 40: letras, números, punto, guion o guion bajo.');
    }
    function usuarioOcupado(u) {
        if (E.personas.some(function (p) { return p.usuario === u; })) return 'Ya hay alguien del Staff ETAAX con ese usuario.';
        var st = (window._data && _data.staff) || [];
        if (st.some(function (s) { return String(((s.datos || {}).usuario) || '').toLowerCase() === u; }))
            return 'Ese usuario ya lo tiene un colaborador de un negocio. Elige otro.';
        return '';
    }
    /* La Edge Function, con la sesión del admin. Si no está desplegada, el
       navegador no recibe respuesta (CORS) o recibe 404: se dice qué falta. */
    var FALTA_FUNCION = 'Falta desplegar la función «admin-staff-etaax» en Supabase (Edge Functions). Sin ella no se pueden crear cuentas.';
    async function funcion(cuerpo) {
        var token = '';
        try { var ses = await _supabase.auth.getSession(); token = ses && ses.data && ses.data.session ? ses.data.session.access_token : ''; } catch (e) {}
        var r, j = {};
        try {
            r = await fetch(SUPABASE_URL + '/functions/v1/admin-staff-etaax', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON },
                body: JSON.stringify(cuerpo)
            });
        } catch (e) { return { error: FALTA_FUNCION + ' (o no hay conexión)' }; }
        try { j = await r.json(); } catch (e) {}
        if (r.status === 404 && !(j && j.error)) return { error: FALTA_FUNCION };
        if (!r.ok || !j || !j.ok) return { error: (j && j.error) || ('No se pudo (HTTP ' + r.status + ').') };
        return j;
    }
    async function alta() {
        var nombre = (document.getElementById('etxAltaNombre').value || '').trim();
        var u = StaffEtx.normalizarUsuario(document.getElementById('etxAltaUsuario').value);
        var pass = document.getElementById('etxAltaPass').value || '';
        var fallo = function (t) { E.msg.alta = { txt: t }; render(); restaurar(nombre, u, pass); };
        if (!nombre) return fallo('Escribe su nombre.');
        if (!StaffEtx.usuarioValido(u)) return fallo('El usuario debe tener de 3 a 40 letras, números, punto, guion o guion bajo.');
        var ocupado = usuarioOcupado(u); if (ocupado) return fallo(ocupado);
        if (window.EtaaxPwd) { var ev = EtaaxPwd.evaluar(pass, {}); if (!ev.ok) return fallo('Contraseña débil: ' + (ev.faltan || []).join(', ') + '.'); }
        else if (pass.length < 8) return fallo('La contraseña debe tener al menos 8 caracteres.');
        var btn = document.getElementById('etxAltaBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }
        // La cuenta (ya confirmada) y su ficha, en el servidor.
        var r = await funcion({ accion: 'crear', usuario: u, nombre: nombre, password: pass });
        if (r.error) return fallo(r.error);
        var uid = r.uid;
        await cargar();
        E.sel = uid; E.edit = {};
        E.msg = { persona: { ok: true, txt: 'Listo: ' + nombre + ' entra con el usuario «' + u + '». Ahora dale acceso a sus negocios.' } };
        render();
    }
    function restaurar(nombre, u, pass) {
        var n = document.getElementById('etxAltaNombre'), us = document.getElementById('etxAltaUsuario'), p = document.getElementById('etxAltaPass');
        if (n) n.value = nombre; if (us) us.value = u; if (p) p.value = pass;
        previaUsuario();
    }
    async function guardarNombre() {
        var p = persona(E.sel); if (!p) return;
        var nombre = (document.getElementById('etxNombre').value || '').trim();
        if (!nombre) { E.msg.persona = { txt: 'Escribe su nombre.' }; render(); return; }
        var d = Object.assign({}, p.datos || {}, { nombre: nombre });
        var r = await _supabase.from('etaax_staff').update({ datos: d, updated_at: new Date().toISOString() }).eq('uid', p.uid);
        E.msg.persona = r.error ? { txt: msgError(r.error) } : { ok: true, txt: 'Nombre guardado.' };
        if (!r.error) await cargar();
        render();
    }
    async function activar(si) {
        var p = persona(E.sel); if (!p) return;
        if (!si && !confirm('¿Desactivar a ' + ((p.datos || {}).nombre || p.usuario) + '?\n\nDeja de ver todos sus negocios en ese momento. Sus accesos se quedan guardados para cuando lo reactives.')) return;
        var d = Object.assign({}, p.datos || {});
        if (si) delete d.activo; else d.activo = false;
        var r = await _supabase.from('etaax_staff').update({ datos: d, updated_at: new Date().toISOString() }).eq('uid', p.uid);
        E.msg.persona = r.error ? { txt: msgError(r.error) } : { ok: true, txt: si ? 'Reactivado.' : 'Desactivado: ya no entra a ningún negocio.' };
        if (!r.error) await cargar();
        render();
    }
    async function cambiarClave() {
        var p = persona(E.sel); if (!p) return;
        var pass = document.getElementById('etxClaveNueva').value || '';
        if (window.EtaaxPwd) { var ev = EtaaxPwd.evaluar(pass, {}); if (!ev.ok) { E.msg.persona = { txt: 'Contraseña débil: ' + (ev.faltan || []).join(', ') + '.' }; render(); return; } }
        else if (pass.length < 8) { E.msg.persona = { txt: 'Al menos 8 caracteres.' }; render(); return; }
        var r = await funcion({ accion: 'clave', uid: p.uid, password: pass });
        E.msg.persona = r.error ? { txt: r.error } : { ok: true, txt: 'Contraseña cambiada. Pásasela por un medio seguro.' };
        render();
    }
    async function baja() {
        var p = persona(E.sel); if (!p) return;
        var nom = (p.datos || {}).nombre || p.usuario;
        var t = prompt('Dar de baja a ' + nom + ': se borran su ficha y todos sus accesos, y su contraseña deja de servir.\n\nEscribe su usuario (' + p.usuario + ') para confirmar:');
        if (t === null) return;
        if (String(t).trim().toLowerCase() !== p.usuario) { E.msg.persona = { txt: 'El usuario no coincide; no se dio de baja.' }; render(); return; }
        var r = await funcion({ accion: 'baja', uid: p.uid });
        if (r.error) { E.msg.persona = { txt: r.error }; render(); return; }
        await cargar();
        E.sel = null; E.edit = {};
        render();
    }

    async function abrir() { render(); await cargar(); render(); }

    window.AdmEtx = {
        cargar: cargar, abrir: abrir, render: render, chip: chip,
        nueva: nueva, elegir: elegir, previaUsuario: previaUsuario, alta: alta,
        guardarNombre: guardarNombre, activar: activar, cambiarClave: cambiarClave, baja: baja,
        todas: todas, suc: suc, mod: mod, ajustar: ajustar, sub: subp,
        guardarAcceso: guardarAcceso, pausar: pausar, quitar: quitar, descartar: descartar, agregarNegocio: agregarNegocio,
        _estado: E
    };
})();
