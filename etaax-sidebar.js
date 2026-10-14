/* Iconos de las barras laterales: mismos SVG que las tarjetas del hub.
   Solo pinta los iconos; cada página conserva sus enlaces, permisos y eventos. */
(function () {
    'use strict';
    var MODULOS = {
        administrativo: 'mod-control-administrativo',
        recetas: 'mod-recetas-insumos',
        financiero: 'mod-salud-financiera',
        consultoria: 'mod-aprende-analiza'
    };
    var RUTAS = {
        '/administrativo/diario.html': 'mod-control-administrativo',
        '/administrativo/ventas.html': 'fin-ventas',
        '/administrativo/gastos.html': 'fin-gastos',
        '/administrativo/staff-hub.html': 'cat-colaboradores',
        '/administrativo/staff.html': 'cat-colaboradores',
        '/administrativo/horarios.html': 'cat-horarios',
        '/administrativo/proveedores.html': 'cat-proveedores',
        '/administrativo/clientes.html': 'cat-clientes',
        '/administrativo/menu.html': 'mod-escandallos',
        '/administrativo/organigrama.html': 'org-corporativo',
        '/administrativo/perfiles-puesto.html': 'perfil',
        '/administrativo/evaluaciones.html': 'mod-control-administrativo',
        '/administrativo/checklists.html': 'mod-control-administrativo',
        '/recetas/index.html': 'mod-escandallos',
        '/recetas/insumos.html': 'mod-insumos',
        '/recetas/inventarios.html': 'mod-inventarios',
        '/recetas/requisiciones.html': 'mod-requisiciones',
        '/financiero/resumen.html': 'fin-resumen-resultados',
        '/financiero/ventas.html': 'fin-ventas',
        '/financiero/gastos-globales.html': 'fin-gastos',
        '/financiero/previsiones.html': 'fin-previsiones',
        '/financiero/cuentas-bancarias.html': 'fin-cuentas-bancarias',
        '/financiero/kpis.html': 'fin-kpis',
        '/financiero/estadisticas.html': 'fin-estadisticas',
        '/consultoria/guias.html': 'mod-aprende-analiza',
        '/consultoria/ventas-productos.html': 'fin-estadisticas',
        '/consultoria/simulador-kpis.html': 'fin-kpis'
    };
    window.etaaxIconoRuta = function (pathname) { return RUTAS[pathname] || ''; };
    function enCatalogos() {
        try { return sessionStorage.getItem('etaax_cat_global') === '1'; } catch (e) { return false; }
    }
    function ruta(enlace) {
        try {
            var url = new URL(enlace.getAttribute('href'), location.href);
            return url.origin === location.origin ? url.pathname : '';
        } catch (e) { return ''; }
    }
    /* Si el menú se vuelve a dibujar —una página que repinta su nav, el modo
       global— los iconos se reponen solos. Se agrupa en un cuadro de animación
       para no perseguir cada cambio de clase. */
    var mirando = false;
    function vigilar(nav) {
        if (mirando || typeof MutationObserver !== 'function') return;
        mirando = true;
        var pendiente = false;
        new MutationObserver(function () {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(function () {
                pendiente = false;
                var faltan = nav.querySelectorAll('a.nav-link .nav-icon:not(.etx-nav-icono)').length;
                if (faltan) window.etaaxPintarIconosNav();
            });
        }).observe(nav, { childList: true, subtree: true });
    }
    function pintar(el, nombre, tam) {
        if (!el || !nombre) return;
        var marcado = window.etaaxIcono(nombre, { tam: tam });
        if (!marcado) return;
        el.innerHTML = marcado;
        el.classList.add('etx-nav-icono');
    }
    /* NO SE RINDE EN SILENCIO. Antes, si al correr faltaba el menú o todavía no
       estaba el sprite, esta función volvía sin hacer nada y nadie la llamaba de
       nuevo: la barra se quedaba con los emojis del marcado para siempre, y el
       icono del módulo —que lo pinta otro archivo— sí salía. Ese es justo el
       síntoma que se reportó dos veces desde producción y que no se reproduce en
       pruebas, porque ahí todo llega a tiempo.
       Ahora reintenta durante unos segundos y se queda vigilando el menú: si
       alguien lo vuelve a pintar, los iconos regresan. */
    var reintentos = 0;
    function reintentar() {
        if (reintentos++ > 40) return;              // ~6 s y se deja de insistir
        setTimeout(window.etaaxPintarIconosNav, 150);
    }
    window.etaaxPintarIconosNav = function () {
        var nav = document.getElementById('nav');
        if (!nav || typeof window.etaaxIcono !== 'function') { reintentar(); return; }
        vigilar(nav);
        var global = enCatalogos();
        nav.querySelectorAll('a.nav-link').forEach(function (enlace) {
            var destino = ruta(enlace), nombre = RUTAS[destino];
            if (global && destino === '/recetas/index.html') nombre = 'cat-recetas';
            if (global && destino === '/recetas/insumos.html') nombre = 'cat-insumos';
            var slot = enlace.querySelector('.nav-icon');
            pintar(slot, nombre, 22);
            if (slot && nombre) slot.setAttribute('aria-hidden', 'true');
        });
        var panel = nav.querySelector('.nav-top-actions a.nav-toggle');
        var modulo = (location.pathname.split('/')[1] || '');
        var principal = global ? 'catalogos' : MODULOS[modulo];
        if (panel && /\/staff-hub\.html$/.test(ruta(panel)) && !global) principal = 'cat-colaboradores';
        pintar(panel, principal, 20);
        if (panel && !panel.hasAttribute('aria-label') && panel.dataset.tooltip) panel.setAttribute('aria-label', panel.dataset.tooltip);
        if (typeof window.etaaxEstilizarNav === 'function') window.etaaxEstilizarNav(nav);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.etaaxPintarIconosNav);
    else window.etaaxPintarIconosNav();
})();
