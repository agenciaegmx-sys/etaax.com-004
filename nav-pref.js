/* ============================================================
   ETAAX — Preferencia de barra lateral (nav)
   La nav se muestra ABIERTA por default en todos los submódulos, y
   recuerda la elección del usuario (compartida en toda la plataforma
   vía localStorage 'etaax_nav_abierta': '1' abierta · '0' cerrada).

   Se incluye como ÚLTIMO <script> de cada página (después de sus
   scripts) para que su window.toggleNav gane sobre cualquier
   toggleNav local. Aplica al ejecutar (el nav ya está en el DOM,
   así que no hay parpadeo) y de nuevo en DOMContentLoaded.

   Soporta los dos layouts en uso:
   · shell estándar → .main-content.expandido (nav colapsada = margen 50px)
   · layouts que centran con body.nav-open
   ============================================================ */
(function () {
    function abierta() {
        try { return (localStorage.getItem('etaax_nav_abierta') || '1') === '1'; }
        catch (e) { return true; }
    }
    function apply() {
        try {
            // En modo embebido (?embed=1) la nav va oculta → no tocar nada.
            if (document.documentElement.classList.contains('embed')) return;
            var ab  = abierta();
            var nav = document.getElementById('nav');
            var main = document.getElementById('mainContent');
            var btn = document.getElementById('navToggleBtn');
            var txt = document.getElementById('navToggleTxt');
            if (nav)  nav.classList.toggle('cerrado', !ab);
            if (main) main.classList.toggle('expandido', !ab);   // expandido = nav colapsada
            if (document.body) document.body.classList.toggle('nav-open', ab);
            if (btn && btn.childNodes[0]) btn.childNodes[0].textContent = ab ? '◀' : '▶';
            if (txt) txt.textContent = ab ? 'Ocultar' : 'Expandir';
            if (btn) btn.setAttribute('data-tooltip', ab ? 'Ocultar' : 'Expandir');
        } catch (e) {}
    }
    // Sobrescribe cualquier toggleNav local (este script carga después).
    window.toggleNav = function () {
        var nav = document.getElementById('nav');
        var abiertaAhora = nav ? !nav.classList.contains('cerrado') : true;
        try { localStorage.setItem('etaax_nav_abierta', abiertaAhora ? '0' : '1'); } catch (e) {}
        apply();
    };
    apply(); // el nav ya existe (script al final del body) → sin parpadeo
    document.addEventListener('DOMContentLoaded', apply);
})();
