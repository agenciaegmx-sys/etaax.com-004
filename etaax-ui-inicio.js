/* Antes del contenido: activar el diseño sin esperar los decoradores del final.
   Se ejecuta inmediatamente después de <body>, con .html o URL corta de Netlify. */
(function () {
    'use strict';
    /* El HTML conserva nodos de la interfaz anterior; los decoradores del final
       les ponen iconos, header y tarjetas nuevos. Tener el CSS en caché no evita
       que el navegador pinte esos nodos mientras descarga los scripts.
       Mantener el layout medible (opacity, nunca display:none) hasta que termine
       esa primera decoración, sin esperar a Supabase, fotos ni fuentes. */
    var html = document.documentElement, body = document.body, lista = false;
    var aviso = document.createElement('span');
    aviso.id = 'etxUiCarga'; aviso.setAttribute('role', 'status');
    aviso.textContent = 'Cargando página';
    body.appendChild(aviso);
    html.classList.add('etx-ui-pendiente');
    body.setAttribute('aria-busy', 'true');
    function mostrar() {
        if (lista) return;
        lista = true;
        html.classList.remove('etx-ui-pendiente');
        body.removeAttribute('aria-busy');
        if (aviso.parentNode) aviso.parentNode.removeChild(aviso);
    }
    function preparar() {
        if (document.hidden || typeof requestAnimationFrame !== 'function') { mostrar(); return; }
        // Los listeners DOMContentLoaded y su primer RAF decoran los nodos antes
        // de mostrar. No hay un retraso fijo ni una espera de datos del negocio.
        requestAnimationFrame(function () { requestAnimationFrame(mostrar); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', preparar, { once:true });
    else preparar();
    // Volver por historial/BFCache no debe reactivar una pantalla de carga.
    window.addEventListener('pageshow', function (e) { if (e.persisted) mostrar(); });
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && document.readyState !== 'loading') mostrar();
    });
    var p = location.pathname.split('/').filter(Boolean).pop() || 'index.html';
    if (p.indexOf('.') < 0) p += '.html';
    var q = new URLSearchParams(location.search);
    var embed = document.documentElement.classList.contains('embed') || q.get('embed') === '1' || q.get('solo') === '1' || window.parent !== window;
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
