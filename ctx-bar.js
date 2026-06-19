(function () {
    function esc(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function initCtxBar() {
        var bar = document.getElementById('ctxBar');
        if (!bar) return;
        var ctx;
        try { ctx = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) {}
        if (!ctx) return;
        var hubPath = '/hub.html';
        var color = ctx.negColor || '#3dbe7a';
        // El tipo puede traer " · Sucursal" de sesiones viejas; lo recortamos porque
        // ahora la sucursal se muestra como pill aparte (sin duplicar).
        var tipo = (ctx.negTipo || '').split(' · ')[0];
        // Modo Catálogo Global del negocio: el contexto deja de ser una sucursal.
        var catGlobal = false;
        try { catGlobal = sessionStorage.getItem('etaax_cat_global') === '1'; } catch (e) {}
        var pill = catGlobal
            ? '<span class="ctx-suc-pill" style="background:rgba(122,184,245,.15);color:#7ab8f5;border-color:#7ab8f5">🌐 Global · todas las sucursales</span>'
            : (ctx.sucNombre ? '<span class="ctx-suc-pill" style="background:' + color + '1f;color:' + color + ';border-color:' + color + '55">📍 ' + esc(ctx.sucNombre) + '</span>' : '');
        bar.innerHTML =
            '<div class="ctx-bar-inner" style="border-color:' + (catGlobal ? '#7ab8f544' : (color + '44')) + '">' +
            '<div class="ctx-neg-emoji-wrap" style="background:' + color + '1a;border-color:' + color + '33">' + esc(ctx.negEmoji) + '</div>' +
            '<div class="ctx-neg-id">' +
                '<div class="ctx-neg-name">' + esc(ctx.negNombre) + '</div>' +
                '<div class="ctx-neg-tipo">' + esc(tipo) + '</div>' +
            '</div>' +
            pill +
            '<div class="ctx-nav-btns">' +
                '<button class="ctx-btn ctx-btn-icon" onclick="history.back()" title="Atrás">↩</button>' +
                '<button class="ctx-btn ctx-btn-icon" onclick="history.forward()" title="Adelante">↪</button>' +
            '</div>' +
            '<div class="ctx-right">' +
                '<div class="ctx-user-badge"><span>' + esc(ctx.userName.split(' ')[0]) + '</span>' +
                '<span class="ctx-badge-plan" style="background:' + ctx.userColor + '22;color:' + ctx.userColor + '">' + esc(ctx.userBadge) + '</span></div>' +
                '<a href="' + hubPath + '" class="ctx-btn">← Ir a Módulos</a>' +
                '<button class="ctx-btn ctx-btn-danger" onclick="ctxSalir()">Salir</button>' +
            '</div>' +
            '</div>';
        bar.style.display = 'flex';
        document.body.classList.add('has-ctx');
        // Sync nombre desde Supabase en background (multi-dispositivo)
        _syncNegNombre(ctx, initCtxBar);
    }

    // Compara el nombre en Supabase con el de etaax_ctx y actualiza si cambió
    function _syncNegNombre(ctx, rerender) {
        if (typeof _supabase === 'undefined' || !ctx || !ctx.negId) return;
        _supabase.from('negocios').select('datos').eq('id', ctx.negId).maybeSingle().then(function(res) {
            if (res.error || !res.data) return;
            var nombre = (res.data.datos || {}).nombre;
            if (!nombre || nombre === ctx.negNombre) return;
            // El nombre cambió en Supabase — actualizar ctx y re-renderizar
            ctx.negNombre = nombre;
            localStorage.setItem('etaax_ctx', JSON.stringify(ctx));
            // Actualizar también etaax_negocios
            try {
                var negs = JSON.parse(localStorage.getItem('etaax_negocios') || '[]');
                var idx = negs.findIndex(function(n) { return n.id === ctx.negId; });
                if (idx >= 0) { negs[idx].nombre = nombre; localStorage.setItem('etaax_negocios', JSON.stringify(negs)); }
            } catch(e) {}
            rerender();
        });
    }

    document.addEventListener('DOMContentLoaded', initCtxBar);
    // Expose so pages with PIN gates can re-call after unlock
    window._ctxBarInit = initCtxBar;
})();

function ctxSalir() {
    var ctx = null;
    try { ctx = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) {}
    // Admin maestro: volver al panel sin cerrar su sesión de Supabase
    if (ctx && ctx.ctxAdmin) {
        sessionStorage.removeItem('etaax_admin_impersonate');
        localStorage.removeItem('etaax_negocio_activo');
        localStorage.removeItem('etaax_ctx');
        window.location.href = '/admin.html';
        return;
    }
    if (typeof _etaaxWipeCache === 'function') _etaaxWipeCache();
    localStorage.removeItem('etaax_negocio_activo');
    localStorage.removeItem('etaax_ctx');
    sessionStorage.clear();
    window.location.href = '/hub.html?salir=1';
}
