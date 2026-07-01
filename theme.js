/* ============================================================================
   ETAAX — Tema claro/oscuro compartido (una sola fuente de verdad).
   - Aplica el tema guardado (localStorage 'etaax_theme') de INMEDIATO, antes del
     paint, para que TODAS las páginas respeten el tema y no se "reseteen" a oscuro.
   - Provee window.toggleTheme() a prueba de nulos.
   - Si la página no trae botón (.theme-toggle), inyecta uno flotante automáticamente.
   Incluir lo más arriba posible del <head>:  <script src="/theme.js"></script>
   (En páginas que ya tienen su script inline de tema, NO se incluye para no duplicar.)
   ============================================================================ */
(function () {
    // 1) Aplicar de inmediato el tema guardado (evita el flash de tema incorrecto).
    try {
        var saved = localStorage.getItem('etaax_theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
    } catch (e) {}

    function _cur() { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
    function _sync() {
        var light = _cur() === 'light';
        var i = document.getElementById('themeIcon');  if (i) i.textContent = light ? '🌙' : '☀️';
        var l = document.getElementById('themeLabel'); if (l) l.textContent = light ? 'Modo oscuro' : 'Modo claro';
    }

    // 2) Toggle global (no pisa si otra página ya definió el suyo antes... este corre primero
    //    porque va en el <head>; las páginas con inline lo redefinen y también funciona).
    window.toggleTheme = function () {
        var n = _cur() === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', n);
        try { localStorage.setItem('etaax_theme', n); } catch (e) {}
        _sync();
    };

    // 3) Al cargar: inyectar botón si no existe + sincronizar etiqueta.
    document.addEventListener('DOMContentLoaded', function () {
        if (!document.querySelector('.theme-toggle')) {
            var b = document.createElement('button');
            b.className = 'theme-toggle';
            b.type = 'button';
            b.addEventListener('click', window.toggleTheme);
            b.innerHTML = '<span id="themeIcon">☀️</span><span id="themeLabel">Modo claro</span>';
            b.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;' +
                'background:var(--surface,#1f1e1b);border:1px solid var(--border,#3a3733);border-radius:50px;' +
                'padding:8px 16px;cursor:pointer;font-family:inherit;font-size:12px;' +
                'color:var(--text-muted,#9b958a);display:flex;align-items:center;gap:6px;' +
                'box-shadow:0 2px 12px rgba(0,0,0,.15)';
            document.body.appendChild(b);
        }
        _sync();
    });
})();
