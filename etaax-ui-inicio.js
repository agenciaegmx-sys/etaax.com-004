/* Antes del contenido: activar el diseño sin esperar los decoradores del final.
   Se ejecuta inmediatamente después de <body>, con .html o URL corta de Netlify. */
(function () {
    'use strict';
    var p = location.pathname.split('/').filter(Boolean).pop() || 'index.html';
    if (p.indexOf('.') < 0) p += '.html';
    var q = new URLSearchParams(location.search);
    var embed = document.documentElement.classList.contains('embed') || q.get('embed') === '1' || q.get('solo') === '1' || window.parent !== window;
    var body = document.body;
    body.classList.add('etx-module-cards');
    if (!embed) {
        body.classList.add('etx-modulos-ui');
        document.documentElement.classList.add('etx-tema-en-header');
    }
    if (p === 'insumos.html') body.classList.add('etx-insumos-page');
    if (p === 'staff.html') body.classList.add('etx-staff-page');
    if (p === 'permisos.html') body.classList.add('etx-permisos-page');
    var op = {'horarios.html':'horarios','checklists.html':'checklists','organigrama.html':'organigrama','perfiles-puesto.html':'perfiles','evaluaciones.html':'evaluaciones'};
    if (op[p]) { body.classList.add('etx-op-page'); body.dataset.opPagina = op[p]; }
    if (document.querySelector('link[href*="recetas/recetas-ui.css"]')) body.classList.add('etx-recetas-page');
})();
