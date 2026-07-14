/* ============================================================
   ETAAX · global-nav.js
   En modo "Catálogo Global del negocio" (sessionStorage etaax_cat_global=1),
   reemplaza el contenido del nav lateral (#nav) por los catálogos globales:
   Colaboradores · Recetas · Insumos · Clientes · Proveedores.
   Se incluye en todas las páginas de catálogo. En modo normal no hace nada.
   ============================================================ */
(function () {
    function _enGlobal() {
        try { return sessionStorage.getItem('etaax_cat_global') === '1'; } catch (e) { return false; }
    }
    function init() {
        if (!_enGlobal()) return;
        var nav = document.getElementById('nav');
        if (!nav) return;
        var path = location.pathname;
        var items = [
            { icon: '👥', label: 'Colaboradores', href: '/administrativo/staff-hub.html',   match: 'staff' },
            { icon: '🍽️', label: 'Recetas',       href: '/recetas/index.html?escandallos=1',  match: 'recetas/index.html' },
            { icon: '📦', label: 'Insumos',       href: '/recetas/insumos.html',             match: 'insumos.html' },
            { icon: '🧾', label: 'Clientes',      href: '/administrativo/clientes.html',     match: 'clientes.html' },
            { icon: '🚚', label: 'Proveedores',   href: '/administrativo/proveedores.html',  match: 'proveedores.html' }
        ];
        // Subtítulo de marca del nav → "Catálogos Globales"
        var sub = nav.querySelector('.nav-brand-sub');
        if (sub) sub.textContent = 'Catálogos Globales';
        // Quitar todas las secciones existentes (conservar el nav-top con el toggle).
        Array.prototype.slice.call(nav.children).forEach(function (ch) {
            if (!ch.classList || !ch.classList.contains('nav-top')) ch.remove();
        });
        // Construir las secciones de catálogos globales.
        var html = '<div class="nav-section"><div class="nav-section-label" style="color:#7ab8f5;letter-spacing:1.5px">🌐 Global</div></div>';
        items.forEach(function (it) {
            var active = path.indexOf(it.match) !== -1;
            html += '<div class="nav-section">' +
                '<a href="' + it.href + '" class="nav-link' + (active ? ' active' : '') + '" data-tooltip="' + it.label + '">' +
                '<span class="nav-icon">' + it.icon + '</span><span class="nav-text">' + it.label + '</span></a>' +
                '</div>';
        });
        // Salida del modo global → volver al selector de sucursales (página negocio).
        html += '<div class="nav-section" style="margin-top:auto">' +
            '<a href="/hub.html?negocios=1" class="nav-link" data-tooltip="Salir del global" onclick="try{sessionStorage.removeItem(\'etaax_cat_global\')}catch(e){}">' +
            '<span class="nav-icon">↩</span><span class="nav-text">Salir del global</span></a>' +
            '</div>';
        nav.insertAdjacentHTML('beforeend', html);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    // Exponer por si una página re-renderiza su nav y necesita re-aplicar.
    window._globalNavInit = init;
})();
