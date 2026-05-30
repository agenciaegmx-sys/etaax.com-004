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
        var parts = window.location.pathname.split('/').filter(Boolean);
        var inSubdir = parts.length > 1;
        var hubPath = inSubdir ? '../hub.html' : 'hub.html';
        var color = ctx.negColor || '#3dbe7a';
        bar.innerHTML =
            '<div class="ctx-bar-inner" style="border-color:' + color + '44">' +
            '<div class="ctx-neg-emoji-wrap" style="background:' + color + '1a;border-color:' + color + '33">' + esc(ctx.negEmoji) + '</div>' +
            '<div><div class="ctx-neg-name">' + esc(ctx.negNombre) + '</div><div class="ctx-neg-tipo">' + esc(ctx.negTipo) + '</div></div>' +
            '<div style="display:flex;align-items:center;gap:4px;margin-left:12px;padding-left:12px;border-left:1px solid rgba(255,255,255,.08)">' +
            '<button class="ctx-btn" onclick="history.back()" title="Atrás" style="padding:4px 9px">↩</button>' +
            '<button class="ctx-btn" onclick="history.forward()" title="Adelante" style="padding:4px 9px">↪</button>' +
            '</div>' +
            '<div style="margin-left:auto;display:flex;gap:8px;align-items:center">' +
            '<div class="ctx-user-badge"><span>' + esc(ctx.userName.split(' ')[0]) + '</span>' +
            '<span class="ctx-badge-plan" style="background:' + ctx.userColor + '22;color:' + ctx.userColor + '">' + esc(ctx.userBadge) + '</span></div>' +
            '<a href="' + hubPath + '" class="ctx-btn">← Ir a Módulos</a>' +
            '<button class="ctx-btn ctx-btn-danger" onclick="ctxSalir()">Salir</button>' +
            '</div>' +
            '</div>';
        bar.style.display = 'flex';
        document.body.classList.add('has-ctx');
    }

    document.addEventListener('DOMContentLoaded', initCtxBar);
    // Expose so pages with PIN gates can re-call after unlock
    window._ctxBarInit = initCtxBar;
})();

function ctxSalir() {
    localStorage.removeItem('etaax_negocio_activo');
    localStorage.removeItem('etaax_ctx');
    sessionStorage.clear();
    var parts = window.location.pathname.split('/').filter(Boolean);
    window.location.href = (parts.length > 1 ? '../' : '') + 'hub.html?salir=1';
}
