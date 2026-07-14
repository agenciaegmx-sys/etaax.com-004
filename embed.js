/* ============================================================
   ETAAX — Modo embebido (?embed=1)
   Cuando una página se abre DENTRO de un modal flotante (iframe)
   del hub de Gestión de Staff, ocultamos su "cromo" de navegación
   (top-bar, nav lateral, barra de contexto, toggle de tema) para
   que se vea solo el contenido de la herramienta — como los
   modales de Ventas y Gastos Diarios.

   Incluir en el <head> de las páginas embebibles, DESPUÉS de
   page-guard.js. No hace nada si la URL no trae ?embed.
   ============================================================ */
(function () {
    try {
        var p = new URLSearchParams(window.location.search);
        if (!p.has('embed')) return;
        var root = document.documentElement;
        root.classList.add('embed');
        var css =
            /* Ocultar el cromo de navegación */
            'html.embed .top-bar,html.embed .ctx-bar,html.embed #ctxBar,' +
            'html.embed nav.nav,html.embed .theme-toggle,html.embed .global-nav{display:none!important}' +
            /* Contenido a pantalla completa del iframe */
            'html.embed .main-content{margin:0!important}' +
            'html.embed .app-shell{display:block!important}' +
            'html.embed body{padding-top:0!important}' +
            /* Reset de offsets que dejaban espacio para la top-bar */
            'html.embed .pp-wrap,html.embed .hr-wrap{padding-top:16px!important}' +
            'html.embed .ev-wrap,html.embed body.has-ctx .ev-wrap{padding-top:16px!important}' +
            'html.embed body.has-ctx .pp-wrap{padding-top:16px!important}' +
            /* Organigrama: sin nav lateral, el lienzo y su toolbar van a la izquierda/arriba */
            'html.embed .org-top{left:0!important;top:0!important}' +
            'html.embed #viewport{left:0!important}' +
            'html.embed body.nav-open .org-top,html.embed body.nav-open #viewport{left:0!important}' +
            'html.embed .save-ind{left:14px!important}';
        var s = document.createElement('style');
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
})();
