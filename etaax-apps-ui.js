/* ============================================================================
   ETAAX — EL SELECTOR DE APPS (window.EtaaxAppsUI)

   Una sola pieza para elegir qué apps contrata una sucursal (Cost·ax, Fin·ax,
   Equip·ax… o el paquete completo), con su precio al momento. La usan:
     · el hub, al pedir una sucursal nueva;
     · Plan y facturación (etaax-cuenta.js), al cambiar el plan;
     · el panel admin, al armar el plan de un negocio o una invitación.

   Los precios NO se calculan aquí: todo viene de precios.js (EtaaxPrecios),
   que es la única verdad. Con las tres apps marcadas es el paquete completo.

   Uso:
     cont.innerHTML = EtaaxAppsUI.html('miSel', 'suite', { n: 2, ciclo: 'anual' });
     EtaaxAppsUI.conectar('miSel', function (sel) { … });   // sel = 'suite'|[ids]|null
     EtaaxAppsUI.leer('miSel');                              // null = ninguna marcada
   ============================================================================ */
(function () {
    'use strict';
    function P() { return window.EtaaxPrecios; }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

    function css() {
        if (document.getElementById('etx-apps-css')) return;
        var st = document.createElement('style');
        st.id = 'etx-apps-css';
        st.textContent =
            '.etx-apps{display:flex;flex-direction:column;gap:8px;text-align:left}' +
            '.etx-app{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:4px 12px;padding:10px 12px;border-radius:12px;cursor:pointer;' +
                'border:1px solid var(--b1,var(--ui-borde,#3a3830));background:var(--bg,transparent);color:var(--text,#f0ece4);transition:border-color .15s,background .15s}' +
            '.etx-app input{width:18px;height:18px;accent-color:var(--cyan,#8ce4ee);margin:0}' +
            '.etx-app.on{border-color:var(--cyan-line,rgba(140,228,238,.5));background:var(--cyan-tint,rgba(140,228,238,.08))}' +
            '.etx-app-tx{display:flex;flex-direction:column;gap:2px;min-width:0}' +
            '.etx-app-tx b{font-size:14.5px;font-weight:700;letter-spacing:.2px}' +
            '.etx-app-tx small{font-size:11.5px;color:var(--muted,#b5afa3);line-height:1.4}' +
            '.etx-app-precio{font-size:13px;font-weight:600;white-space:nowrap}' +
            '.etx-app.prox{cursor:default;opacity:.55;border-style:dashed}' +
            '.etx-apps-total{font-size:12.5px;color:var(--muted,#b5afa3);line-height:1.6;padding:2px 2px 0}' +
            '.etx-apps-total b{color:var(--text,#f0ece4)}' +
            '.etx-apps-total .err{color:var(--red,#e05a3a)}' +
            '.etx-apps-paq{background:none;border:none;padding:0;margin-left:4px;color:var(--cyan,#8ce4ee);font:inherit;font-size:12.5px;cursor:pointer;text-decoration:underline}';
        document.head.appendChild(st);
    }

    /* sel: 'suite' | [ids]. o.n = posición de la sucursal (su escalón), o.ciclo. */
    function html(id, sel, o) {
        o = o || {};
        css();
        var apps = P().normalizarApps(sel), todas = P().appsDisponibles();
        var marcadas = apps === 'suite' ? todas : apps;
        return '<div class="etx-apps" id="' + esc(id) + '" data-n="' + (o.n || 1) + '" data-ciclo="' + esc(o.ciclo || 'mensual') + '">' +
            P().APPS.map(function (a) {
                if (a.proximamente)
                    return '<label class="etx-app prox"><input type="checkbox" disabled><span class="etx-app-tx"><b>' + esc(a.nombre) + '</b>' +
                        '<small>' + esc(a.lema) + ' · Próximamente</small></span><span class="etx-app-precio"></span></label>';
                var on = marcadas.indexOf(a.id) !== -1;
                return '<label class="etx-app' + (on ? ' on' : '') + '"><input type="checkbox" value="' + esc(a.id) + '"' + (on ? ' checked' : '') + '>' +
                    '<span class="etx-app-tx"><b>' + esc(a.nombre) + '</b><small>' + esc(a.lema) + ': ' + esc(a.incluye) + '</small></span>' +
                    '<span class="etx-app-precio">' + P().fmt(a.precio) + '</span></label>';
            }).join('') +
            '<div class="etx-apps-total" aria-live="polite"></div></div>';
    }
    /* Lo marcado: 'suite' (las tres), una lista, o null si no hay ninguna. */
    function leer(id) {
        var el = document.getElementById(id);
        if (!el) return null;
        var v = [].map.call(el.querySelectorAll('input[type=checkbox]:checked:not([disabled])'), function (x) { return x.value; });
        return v.length ? P().normalizarApps(v) : null;
    }
    function total(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var t = el.querySelector('.etx-apps-total'), sel = leer(id);
        el.querySelectorAll('.etx-app').forEach(function (l) { var i = l.querySelector('input'); l.classList.toggle('on', !!(i && i.checked && !i.disabled)); });
        if (!sel) { t.innerHTML = '<span class="err">Elige al menos una app.</span>'; return; }
        var n = Number(el.dataset.n) || 1, anual = el.dataset.ciclo === 'anual';
        var m = P().precioSucursalApps(n, sel);
        t.innerHTML = '<b>' + esc(P().nombreApps(sel)) + '</b>: <b>' + P().fmt(m) + '</b> al mes' +
            (n > 1 ? ' (precio de la ' + n + 'ª sucursal, con su descuento)' : '') +
            (anual ? ' · anual <b>' + P().fmt(m * P().ANUAL_MESES) + '</b> (pagas ' + P().ANUAL_MESES + ' meses y usas 12)' : '') +
            (P().convienePaquete(sel) ? '<br>Por ese precio te llevas el paquete completo.<button type="button" class="etx-apps-paq">Elegir el paquete completo</button>' : '');
    }
    function conectar(id, alCambiar) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', function () { total(id); if (alCambiar) alCambiar(leer(id)); });
        el.addEventListener('click', function (e) {
            if (!e.target.closest('.etx-apps-paq')) return;
            e.preventDefault();
            el.querySelectorAll('input[type=checkbox]:not([disabled])').forEach(function (i) { i.checked = true; });
            total(id);
            if (alCambiar) alCambiar(leer(id));
        });
        total(id);
    }
    function ciclo(id, c) { var el = document.getElementById(id); if (el) { el.dataset.ciclo = c; total(id); } }

    window.EtaaxAppsUI = { html: html, leer: leer, conectar: conectar, ciclo: ciclo, total: total };
})();
