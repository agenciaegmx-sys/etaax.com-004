/* Movimiento continuo compartido por la guía y el selector de módulos. */
(function () {
    'use strict';
    window.etaaxDock = function (guia, selector) {
        if (!guia || guia._etaaxDockActivo) return;
        guia._etaaxDockActivo = true;
        var items = Array.from(guia.querySelectorAll(selector));
        var estados = items.map(function () { return { valor: 0, centro: 0, ancho: 0 }; });
        var medio = window.matchMedia('(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)');
        var dentro = false, cursor = 0, frame = 0, anterior = 0;
        function medir() {
            items.forEach(function (el, i) {
                estados[i].centro = el.offsetLeft + el.offsetWidth / 2;
                estados[i].ancho = Math.max(1, el.offsetWidth);
            });
        }
        function animar(ahora) {
            frame = 0;
            var dt = anterior ? Math.min(ahora - anterior, 50) : 16;
            anterior = ahora;
            var suavidad = 1 - Math.exp(-dt / 65), pendiente = false;
            var x = cursor - guia.getBoundingClientRect().left + guia.scrollLeft - guia.clientLeft;
            estados.forEach(function (e, i) {
                var distancia = (x - e.centro) / (e.ancho * 1.2);
                var objetivo = dentro && medio.matches && !items[i].disabled ? Math.exp(-distancia * distancia * 2.5) : 0;
                e.valor += (objetivo - e.valor) * suavidad;
                if (Math.abs(objetivo - e.valor) < .001) e.valor = objetivo;
                else pendiente = true;
                items[i].style.setProperty('--dock-scale', (1 + e.valor * .075).toFixed(4));
                items[i].style.setProperty('--dock-y', (-e.valor * 6).toFixed(3) + 'px');
            });
            if (pendiente) frame = requestAnimationFrame(animar);
            else anterior = 0;
        }
        function mover(e) {
            if (!medio.matches || e.pointerType !== 'mouse') return;
            dentro = true;
            cursor = e.clientX;
            if (!frame) frame = requestAnimationFrame(animar);
        }
        guia.addEventListener('pointerenter', mover);
        guia.addEventListener('pointermove', mover);
        guia.addEventListener('pointerleave', function () {
            dentro = false;
            if (!frame) frame = requestAnimationFrame(animar);
        });
        function cambioDeMedio() {
            dentro = false;
            if (frame) cancelAnimationFrame(frame);
            frame = anterior = 0;
            estados.forEach(function (e, i) {
                e.valor = 0;
                items[i].style.removeProperty('--dock-scale');
                items[i].style.removeProperty('--dock-y');
            });
        }
        if (typeof medio.addEventListener === 'function') medio.addEventListener('change', cambioDeMedio);
        else medio.addListener(cambioDeMedio);
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(medir).observe(guia);
        else window.addEventListener('resize', medir);
        medir();
    };
    window.etaaxDock(document.querySelector('.hub-guide-steps'), '.hub-guide-step');
})();
