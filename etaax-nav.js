/* ============================================================
   ETAAX — Historial de pantallas (atrás/adelante real)
   La navegación dentro de un módulo es por JS (se muestran/ocultan
   vistas), no por cambio de URL, así que el historial del navegador
   no la registra. Este módulo lleva ese historial con el History API:
   cada cambio de pantalla empuja un estado y, al volver/avanzar
   (botones ↩↪ de la ctx-bar = history.back()/forward()), se restaura
   la pantalla llamando su función de restauración.

   Uso en un módulo:
     etaaxNav.base(showHome);          // pantalla inicial (sin nueva entrada)
     etaaxNav.go(showPantalla);        // al navegar a una pantalla nueva
   La restoreFn debe SOLO mostrar la vista (no volver a navegar);
   durante una restauración, go() es no-op para evitar bucles.
   ============================================================ */
(function () {
    if (window.etaaxNav) return;
    var _screens = {};      // id -> restoreFn
    var _seq = 0;
    var _applying = false;  // true mientras restauramos (evita re-empujar)

    function _newId() { return 'eNav' + (++_seq) + '_' + Date.now().toString(36); }

    // Registra la pantalla ACTUAL sin crear entrada nueva (pantalla base del módulo).
    function base(restoreFn) {
        var id = _newId();
        _screens[id] = restoreFn || null;
        try { history.replaceState({ eNav: id }, ''); } catch (e) {}
    }

    // Navega a una pantalla NUEVA (agrega una entrada al historial).
    function go(restoreFn) {
        if (_applying) return;
        var id = _newId();
        _screens[id] = restoreFn || null;
        try { history.pushState({ eNav: id }, ''); } catch (e) {}
    }

    window.addEventListener('popstate', function (e) {
        var st = e.state;
        if (st && st.eNav && _screens[st.eNav]) {
            _applying = true;
            try { _screens[st.eNav](); } catch (err) { console.warn('[etaaxNav]', err); }
            _applying = false;
        }
        // Si el estado no es nuestro (otra página), lo maneja el navegador normalmente.
    });

    window.etaaxNav = {
        base: base,
        go: go,
        get applying() { return _applying; }
    };
})();
