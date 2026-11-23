/* ============================================================================
   ETAAX — PANEL ADMIN · LOS PLANES POR APPS (window.AdmPlanes)

   ETAAX se vende por apps (Cost·ax, Fin·ax, Equip·ax… o el paquete completo) y
   CADA SUCURSAL contrata las suyas. Aquí el admin maestro:
     · ve y edita el plan de un negocio: apps de cada sucursal, mensual o anual,
       cobro junto o por sucursal (suscripciones.plan, v89);
     · elige las apps con las que nace un negocio nuevo (invitaciones.plan: un
       trigger de la v89 lo pasa a su suscripción al usarse la invitación);
     · activa las solicitudes de cambio que manda el dueño (tipo 'apps') y le
       pone sus apps a la sucursal nueva que se pidió.

   Los precios vienen de precios.js (EtaaxPrecios); el selector, de
   etaax-apps-ui.js (EtaaxAppsUI). Sin plan guardado = paquete completo, que es
   como quedan los negocios de antes.

   Usa del panel: _supabase, _data, esc, etaaxJsArg, admAlert.
   ============================================================================ */
(function () {
    'use strict';
    var P = function () { return window.EtaaxPrecios; };
    function q(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s); }
    function a(s) { return (typeof etaaxJsArg === 'function') ? etaaxJsArg(s) : String(s); }
    function aviso(t) { if (typeof admAlert === 'function') admAlert(t); else alert(t); }
    function sub(negId) { return ((window._data && _data.suscripciones) || {})[negId] || null; }
    function planDe(negId) { var s = sub(negId); return (s && s.plan) || null; }
    function sucsDe(negId) {
        var l = ((window._data && _data.sucursales) || {})[negId] || [];
        return l.length ? l : [{ id: 'suc_principal', nombre: 'Matriz' }];
    }
    function nombreNeg(negId) {
        var n = ((window._data && _data.negocios) || []).find(function (x) { return x.id === negId; });
        return (n && n.datos && n.datos.nombre) || negId;
    }
    function faltaV89(err) { return /column .*plan|plan.* does not exist|schema cache/i.test((err && err.message) || ''); }
    function msgError(err) { return faltaV89(err) ? 'Falta correr supabase-migration-v89.sql en Supabase (SQL Editor).' : ((err && err.message) || 'Error'); }

    /* «Paquete completo · mensual», «Cost·ax en 2, paquete en 1 · anual»… */
    function resumen(negId) {
        var c = P().cotizar(planDe(negId), sucsDe(negId));
        var cuenta = {};
        c.lineas.forEach(function (l) { cuenta[l.nombreApps] = (cuenta[l.nombreApps] || 0) + 1; });
        var partes = Object.keys(cuenta);
        var txt = partes.length === 1 ? partes[0] : partes.map(function (k) { return k + ' (' + cuenta[k] + ')'; }).join(' · ');
        return txt + ' · ' + (c.ciclo === 'anual' ? 'anual' : 'mensual') + (c.cobro === 'sucursal' && c.lineas.length > 1 ? ' · por sucursal' : '');
    }
    function cotizacion(negId) { return P().cotizar(planDe(negId), sucsDe(negId)); }

    /* La sección del detalle del negocio. */
    function seccionDetalle(negId) {
        var c = cotizacion(negId), f = P().fmt;
        return '<div class="detail-section"><div class="detail-section-title">Plan y apps</div>' +
            c.lineas.map(function (l) {
                return '<div class="neg-item"><div><div class="neg-item-nombre">' + q(l.nombre) + '</div>' +
                    '<div class="neg-item-meta" style="color:var(--cyan)">' + q(l.nombreApps) + '</div></div>' +
                    '<div class="neg-item-staff">' + f(l.mensual) + '/mes</div></div>';
            }).join('') +
            '<div style="font-size:12.5px;color:var(--muted);margin-top:8px">Total: <b style="color:var(--text)">' + f(c.mensual) + '/mes</b>' +
                (c.ciclo === 'anual' ? ' · anual <b style="color:var(--text)">' + f(c.anual) + '</b>' : '') +
                (c.cobro === 'sucursal' && c.lineas.length > 1 ? ' · cada sucursal paga lo suyo' : ' · cobro junto') + '</div>' +
            '<button class="btn-mini" style="margin-top:10px" onclick="AdmPlanes.editar(\'' + a(negId) + '\')">Editar plan y apps</button>' +
        '</div>';
    }

    /* ── El editor (ventana propia: más ancha que admDialog y con scroll) ── */
    function editor(titulo, lista, plan, alGuardar, opc) {
        opc = opc || {};
        var p = P().planNormal(plan);
        var ov = document.createElement('div');
        ov.className = 'admp-ov';
        ov.innerHTML = '<div class="admp-caja" role="dialog" aria-modal="true">' +
            '<div class="admp-tit">' + q(titulo) + '</div>' +
            '<div class="admp-fila"><span class="form-label">Cada cuánto paga</span>' +
                '<label><input type="radio" name="admpCiclo" value="mensual"' + (p.ciclo === 'mensual' ? ' checked' : '') + '> Mensual</label>' +
                '<label><input type="radio" name="admpCiclo" value="anual"' + (p.ciclo === 'anual' ? ' checked' : '') + '> Anual (paga ' + P().ANUAL_MESES + ', usa 12)</label></div>' +
            (lista.length > 1 || opc.siempreCobro ? '<div class="admp-fila"><span class="form-label">Cómo se cobra</span>' +
                '<label><input type="radio" name="admpCobro" value="negocio"' + (p.cobro === 'negocio' ? ' checked' : '') + '> Junto (un solo cobro)</label>' +
                '<label><input type="radio" name="admpCobro" value="sucursal"' + (p.cobro === 'sucursal' ? ' checked' : '') + '> Cada sucursal por separado</label></div>' : '') +
            lista.map(function (s, i) {
                return '<div class="admp-suc"><div class="admp-suc-nom">' + q(s.nombre || (i ? 'Sucursal ' + (i + 1) : 'Matriz')) + '</div>' +
                    EtaaxAppsUI.html('admpApps_' + i, P().appsDe(p, s.id), { n: i + 1, ciclo: p.ciclo }) + '</div>';
            }).join('') +
            '<div class="admp-total" id="admpTotal"></div>' +
            '<div class="mig-acciones"><button class="btn-prim" id="admpGuardar">' + q(opc.guardarTxt || 'Guardar plan') + '</button>' +
                '<button class="btn-mini" id="admpCancelar">Cancelar</button></div>' +
            '<div class="form-error" id="admpError"></div></div>';
        document.body.appendChild(ov);
        var leer = function () {
            var ciclo = (ov.querySelector('input[name=admpCiclo]:checked') || {}).value || 'mensual';
            var cobro = (ov.querySelector('input[name=admpCobro]:checked') || {}).value || p.cobro;
            var nuevo = { ciclo: ciclo, cobro: cobro, base: p.base, sucursales: {} }, falta = false;
            lista.forEach(function (s, i) { var sel = EtaaxAppsUI.leer('admpApps_' + i); if (!sel) falta = true; nuevo.sucursales[s.id] = sel || 'suite'; });
            if (opc.soloBase) { nuevo.base = nuevo.sucursales[lista[0].id]; nuevo.sucursales = {}; }
            return { plan: nuevo, falta: falta };
        };
        var total = function () {
            var r = leer(), c = P().cotizar(r.plan, lista);
            lista.forEach(function (_, i) { EtaaxAppsUI.ciclo('admpApps_' + i, r.plan.ciclo); });
            ov.querySelector('#admpTotal').innerHTML = r.falta ? '<span class="form-error">Cada sucursal necesita al menos una app.</span>'
                : 'Total: <b>' + P().fmt(c.mensual) + '/mes</b>' + (c.ciclo === 'anual' ? ' · anual <b>' + P().fmt(c.anual) + '</b> (ahorra ' + P().fmt(c.ahorroAnual) + ')' : '');
            ov.querySelector('#admpGuardar').disabled = r.falta;
        };
        ov.addEventListener('change', total);
        lista.forEach(function (_, i) { EtaaxAppsUI.conectar('admpApps_' + i, total); });
        total();
        var cerrar = function () { try { ov.remove(); } catch (e) {} };
        ov.querySelector('#admpCancelar').onclick = cerrar;
        ov.addEventListener('click', function (e) { if (e.target === ov) cerrar(); });
        ov.querySelector('#admpGuardar').onclick = async function () {
            var r = leer(); if (r.falta) return;
            var b = this; b.disabled = true; b.textContent = 'Guardando…';
            var err = await alGuardar(r.plan);
            if (err) { b.disabled = false; b.textContent = opc.guardarTxt || 'Guardar plan'; ov.querySelector('#admpError').textContent = err; return; }
            cerrar();
        };
        return ov;
    }

    /* Guardar el plan de un negocio (sin tocar su estado de cobro). */
    async function guardarPlan(negId, plan) {
        var s = sub(negId) || {};
        var reg = { negocio_id: negId, plan: plan, updated_at: new Date().toISOString() };
        if (!s.estado) reg.estado = 'pendiente';   // sin fila previa, nace pendiente (como la invitación)
        var r = await _supabase.from('suscripciones').upsert(reg, { onConflict: 'negocio_id' });
        if (r.error) return msgError(r.error);
        _data.suscripciones = _data.suscripciones || {};
        _data.suscripciones[negId] = Object.assign({}, s, reg);
        return null;
    }
    function editar(negId) {
        editor('Plan de ' + nombreNeg(negId), sucsDe(negId), planDe(negId), async function (plan) {
            var e = await guardarPlan(negId, plan);
            if (e) return e;
            if (typeof renderNegocios === 'function') renderNegocios();
            if (typeof abrirDetalleNegocio === 'function') abrirDetalleNegocio(negId);
            return null;
        });
    }

    /* ── La invitación: con qué apps nace el negocio ── */
    var _planInv = null;
    function invitacionHTML() {
        return '<div style="margin-top:12px"><span class="form-label">Apps con las que empieza (Matriz)</span>' +
            '<div id="invPlanResumen" style="font-size:13px;margin:6px 0 8px"></div>' +
            '<button type="button" class="btn-mini" onclick="AdmPlanes.elegirInvitacion()">Elegir apps y forma de pago</button></div>';
    }
    function pintarInvitacion() {
        var el = document.getElementById('invPlanResumen');
        if (!el) return;
        var c = P().cotizar(_planInv, [{ id: 'suc_principal', nombre: 'Matriz' }]);
        el.innerHTML = '<b style="color:var(--cyan)">' + q(c.lineas[0].nombreApps) + '</b> · ' + P().fmt(c.mensual) + '/mes' +
            (c.ciclo === 'anual' ? ' · anual ' + P().fmt(c.anual) : ' · mensual');
    }
    function elegirInvitacion() {
        editor('Apps del negocio nuevo', [{ id: 'suc_principal', nombre: 'Matriz' }], _planInv, async function (plan) {
            _planInv = plan; pintarInvitacion(); return null;
        }, { soloBase: true, siempreCobro: true, guardarTxt: 'Usar este plan' });
    }
    function invitacionPlan() { return _planInv ? P().planNormal(_planInv) : null; }
    function invitacionReset() { _planInv = null; pintarInvitacion(); }

    /* ── Solicitudes ── */
    function solicitudTexto(d) {
        if (d.tipo !== 'apps') return null;
        var f = P().fmt, ciclo = function (c) { return c === 'anual' ? '/año' : '/mes'; };
        return '🧩 Cambio de apps → ' + q(P().nombreApps((d.planNuevo && d.planNuevo.base) || 'suite')) +
            (d.planNuevo && d.planNuevo.sucursales ? ' <span style="color:var(--muted);font-size:11px">(' + Object.keys(d.planNuevo.sucursales).length + ' sucursal' + (Object.keys(d.planNuevo.sucursales).length === 1 ? '' : 'es') + ')</span>' : '') +
            '<div style="font-size:11px;color:var(--muted)">' + f(d.costoActual || 0) + ciclo(d.cicloActual) + ' → <b style="color:#3dbe7a">' + f(d.costoNuevo || 0) + ciclo(d.cicloNuevo) + '</b></div>';
    }
    /* Activar un cambio de apps: el plan pedido pasa a la suscripción. */
    async function activarApps(s) {
        var d = s.datos || {};
        if (!d.planNuevo) return 'La solicitud no trae el plan.';
        return await guardarPlan(s.negocio_id, d.planNuevo);
    }
    /* La sucursal nueva que se pidió con sus apps. */
    async function aplicarSucursalNueva(negId, sucId, apps) {
        if (!apps) return null;
        var p = P().planNormal(planDe(negId));
        p.sucursales[sucId] = P().normalizarApps(apps);
        return await guardarPlan(negId, p);
    }

    window.AdmPlanes = {
        resumen: resumen, cotizacion: cotizacion, seccionDetalle: seccionDetalle, editar: editar,
        invitacionHTML: invitacionHTML, elegirInvitacion: elegirInvitacion, invitacionPlan: invitacionPlan,
        invitacionReset: invitacionReset, pintarInvitacion: pintarInvitacion,
        solicitudTexto: solicitudTexto, activarApps: activarApps, aplicarSucursalNueva: aplicarSucursalNueva,
        guardarPlan: guardarPlan
    };
})();
