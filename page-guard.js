/* ============================================================
   ETAAX — Page Guard
   Redirige al hub si no hay sesión de negocio activa.
   Incluir al inicio del <head> de toda página de módulo.
   NO incluir en: hub.html, index.html (landing pública) ni
   páginas de admin (tienen su propia verificación por email).
   ============================================================ */
(function () {
    var ctx = null;
    try { ctx = localStorage.getItem('etaax_ctx'); } catch (e) {}
    if (!ctx) window.location.replace('/hub.html');
})();
