/* ============================================================
   ETAAX — Modo embebido (?embed=1)
   Cuando una página se abre DENTRO de un modal flotante (iframe)
   del hub de Gestión de Staff, ocultamos su "cromo" de navegación
   (top-bar, nav lateral, barra de contexto, toggle de tema) para
   que se vea solo el contenido de la herramienta — como los
   modales de Ventas y Gastos Diarios.

   Incluir en el <head> de las páginas embebibles ANTES de
   page-guard.js (siembra el contexto por si el navegador aísla el
   storage del iframe). No hace nada si la URL no trae ?embed.
   ============================================================ */
(function () {
    try {
        var p = new URLSearchParams(window.location.search);
        if (!p.has('embed')) return;
        // ── Sembrar el contexto de sesión desde la URL, ANTES de page-guard ──
        // Algunos navegadores/ajustes de privacidad NO comparten el storage del
        // iframe con la página padre; sin esto, page-guard rebotaría al hub.
        // Solo se siembra lo que falte (no clobbea una sesión ya presente).
        function seed(k, v) {
            try { if (v != null && v !== '' && !localStorage.getItem(k)) localStorage.setItem(k, v); } catch (e) {}
        }
        if (p.get('neg')) seed('etaax_negocio_activo', p.get('neg'));
        if (p.get('suc')) seed('etaax_sucursal_activa', p.get('suc'));
        if (p.get('ctx')) { try { if (!localStorage.getItem('etaax_ctx')) localStorage.setItem('etaax_ctx', decodeURIComponent(p.get('ctx'))); } catch (e) {} }
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
            /* El header sticky de páginas tipo catálogo (staff) se pegaba a 48/96px
               como si el top-bar/ctx-bar existieran → banda muerta arriba y contenido
               visible ENCIMA del título al hacer scroll en la tablet. En el iframe
               no hay cromo: se pega al tope real. */
            'html.embed .header,html.embed body.has-ctx .header{top:0!important}' +
            'html.embed .ev-wrap,html.embed body.has-ctx .ev-wrap{padding-top:16px!important}' +
            'html.embed body.has-ctx .pp-wrap{padding-top:16px!important}' +
            /* Carátula de costos (recetas) abierta en modal: sin topbar ni nav → pegada al tope/izquierda */
            'html.embed #vistaCaratula{top:0!important;left:0!important}' +
            /* Su ✕ propio es redundante con el de la ventana → fuera. El TÍTULO sí se
               queda: al ocultarlo, la barra conservaba su alto y dejaba una franja
               muerta arriba (vacía por completo en la vista de selector de grupos). */
            'html.embed #caratulaBtnCerrar{display:none!important}' +
            'html.embed #caratulaTituloHeader{font-size:17px!important}' +
            'html.embed #vistaCaratula > div:first-child{padding:9px 20px!important}' +
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
