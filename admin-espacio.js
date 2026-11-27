/* ══ EL ESPACIO DE TRABAJO DE ETAAX (Edwin, 27-nov) ══════════════════════════
   «Trabaja sobre ETAAX como negocio replicando la interfaz de la gestión de una
   sucursal, pero a nivel SaaS en el panel admin, conservando todo lo funcional».

   La portada del panel es el hub de una sucursal, pero el negocio es ETAAX:
     · la isla «Espacio de trabajo · ETAAX» (está en el marcado de admin.html);
     · la MEDIA LUNA con las áreas de ETAAX (Clientes, Ingresos, Catálogos,
       Plataforma), igual a la de los módulos: el elegido al centro, con tope en
       los extremos (no da la vuelta), con el dedo, las flechas, el teclado o el
       trackpad. Al abrir arranca en la del CENTRO, como el hub;
     · debajo, «Área N · activa», su nombre y para qué es, y sus herramientas en
       tarjetas compactas a dos columnas con su grupo, como las portadas.
   Las áreas y sus herramientas salen de ADM_BLOQUES (admin.html): mismos ids y
   mismas pantallas de siempre. Todas las tarjetas viven en la página (las de
   las otras áreas, escondidas), así nada que las busque se queda sin ellas. */
(function () {
    'use strict';
    var _area = '', _aMano = false, _rueda = null;
    function ic(n, t) { return (typeof window.etaaxIcono === 'function') ? (window.etaaxIcono(n, { tam: t || 24 }) || '') : ''; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
    function areas() { return (window.ADM_BLOQUES || []).filter(function (b) { return b.cards && b.cards.length; }); }
    function delCentro(l) { return l.length ? l[Math.floor((l.length - 1) / 2)] : null; }
    function isla(n) { return typeof window.etaaxIslaHTML === 'function' ? window.etaaxIslaHTML(n, { clase: 'etx-isla--chica' }) : '<b>' + esc(n) + '</b>'; }

    function pintar(cont) {
        var l = areas(); if (!l.length) return;
        if (!_area || !l.some(function (a) { return a.id === _area; })) _area = (delCentro(l) || l[0]).id;
        /* Cada vez que llegan datos se vuelve a pintar la portada: si ya existe,
           solo se refrescan las tarjetas (sus cuentas) y la rueda se queda quieta
           donde estaba —rehacerla la haría girar otra vez desde cero—. */
        var ya = cont.querySelector('.adm-esp'), ids = l.map(function (a) { return a.id; }).join(',');
        if (ya && ya.getAttribute('data-areas') === ids) {
            l.forEach(function (a) { var g = ya.querySelector('.adm-area[data-area="' + a.id + '"] .adm-grid'); if (g) g.innerHTML = a.cards.map(window._admCardHTML).join(''); });
            mostrar(); return;
        }
        cont.innerHTML =
            '<div class="adm-esp" data-areas="' + esc(ids) + '">' +
                '<div class="adm-esp-intro"><span>¿Qué necesitas hacer?</span><span>Áreas de ETAAX</span></div>' +
                '<div class="adm-esp-selector" id="admEspSelector">' +
                    '<div class="adm-esp-dock" id="admEspDock" role="tablist" aria-label="Áreas de ETAAX">' +
                        l.map(function (a, i) {
                            return '<button type="button" class="adm-esp-tab" id="adm-area-' + esc(a.id) + '" data-area="' + esc(a.id) + '" role="tab" aria-selected="false" tabindex="-1">' +
                                '<span class="adm-esp-tab-ic" aria-hidden="true">' + ic(a.ic, 36) + '</span>' +
                                '<span class="adm-esp-tab-num">Área ' + (i + 1) + '</span>' +
                                '<span class="adm-esp-tab-nom">' + isla(a.tit) + '</span></button>';
                        }).join('') +
                    '</div>' +
                    '<button type="button" class="adm-esp-flecha" data-dir="-1" aria-label="Área anterior">' + ic('flecha', 18) + '</button>' +
                    '<button type="button" class="adm-esp-flecha" data-dir="1" aria-label="Área siguiente">' + ic('flecha', 18) + '</button>' +
                '</div>' +
                '<div class="adm-esp-cab" id="admEspCab"></div>' +
                l.map(function (a) {
                    return '<section class="adm-area" data-area="' + esc(a.id) + '" role="tabpanel" aria-labelledby="adm-area-' + esc(a.id) + '" hidden>' +
                        '<div class="adm-grid adm-grid-2">' + a.cards.map(window._admCardHTML).join('') + '</div></section>';
                }).join('') +
            '</div>';
        enganchar(cont);
        /* La primera vez se coloca sin animación (si no, todas «llegan» girando). */
        var dock = cont.querySelector('#admEspDock'); if (dock) dock.classList.add('quieta');
        mostrar();
        if (dock) requestAnimationFrame(function () { requestAnimationFrame(function () { dock.classList.remove('quieta'); }); });
    }

    function mostrar() {
        var l = areas(), a = l.find(function (x) { return x.id === _area; }) || l[0], k = l.indexOf(a);
        document.querySelectorAll('.adm-esp-tab').forEach(function (t) {
            var on = t.dataset.area === a.id;
            t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
        });
        document.querySelectorAll('.adm-area').forEach(function (s) { s.hidden = s.dataset.area !== a.id; });
        var cab = document.getElementById('admEspCab');
        if (cab) cab.innerHTML = '<span class="adm-esp-cab-ic" aria-hidden="true">' + ic(a.ic, 34) + '</span>' +
            '<div><p class="adm-esp-cab-num">Área ' + (k + 1) + ' · activa</p><h2 class="adm-esp-cab-tit">' + esc(a.tit) + '</h2>' +
            '<p class="adm-esp-cab-desc">' + esc(a.desc) + '</p></div>';
        colocar(0);
    }

    /* ── La media luna (la misma geometría que la del hub) ── */
    function tabs() { return Array.prototype.slice.call(document.querySelectorAll('#admEspDock .adm-esp-tab')); }
    function paso() { var d = document.getElementById('admEspDock'); return Math.max(128, Math.min(270, ((d && d.clientWidth) || 800) * 0.25)); }
    function indice(ts) { var k = 0; ts.forEach(function (t, i) { if (t.dataset.area === _area) k = i; }); return k; }
    function colocar(arr) {
        arr = arr || 0;
        var ts = tabs(), n = ts.length; if (!n) return;
        var k = indice(ts), p0 = paso(), min = -k, max = n - 1 - k;
        if (arr < min) arr = min - Math.min(.35, (min - arr) * .3);     // el tope cede apenas, como un resorte
        if (arr > max) arr = max + Math.min(.35, (arr - max) * .3);
        ts.forEach(function (t, i) {
            var p = i - k - arr, a = Math.abs(p);
            t.style.transform = 'translate(-50%, -50%) translateX(' + (p * p0).toFixed(1) + 'px) translateY(' + (a * a * 9).toFixed(1) + 'px) ' +
                'translateZ(' + (-a * 150).toFixed(1) + 'px) rotateY(' + (-p * 30).toFixed(2) + 'deg) rotateZ(' + (p * 3).toFixed(2) + 'deg) ' +
                'scale(' + Math.max(.6, 1 - a * .1).toFixed(3) + ')';
            t.style.opacity = Math.max(0, 1 - a * .3).toFixed(3);
            t.style.filter = a > .05 ? 'blur(' + (a * 1.6).toFixed(2) + 'px)' : 'none';
            t.style.zIndex = String(100 - Math.round(a * 10));
        });
        document.querySelectorAll('.adm-esp-flecha').forEach(function (b) { b.disabled = Number(b.dataset.dir) < 0 ? k <= 0 : k >= n - 1; });
    }
    function elegir(id) {
        if (!areas().some(function (a) { return a.id === id; })) return false;
        _area = id; _aMano = true; mostrar(); return true;
    }
    function mover(pasos) {
        var ts = tabs(), n = ts.length; if (!n) return;
        var k = indice(ts), d = Math.max(0, Math.min(n - 1, k + (pasos || 0)));   // con tope, sin dar la vuelta
        if (d === k) { colocar(0); return; }
        elegir(ts[d].dataset.area);
    }
    function enganchar(cont) {
        var dock = cont.querySelector('#admEspDock'); if (!dock) return;
        cont.querySelectorAll('.adm-esp-flecha').forEach(function (b) { b.addEventListener('click', function () { mover(Number(b.dataset.dir)); }); });
        var arr = null, recien = false;
        dock.addEventListener('pointerdown', function (e) { if (e.button !== 0) return; arr = { x: e.clientX, dx: 0, id: e.pointerId, movio: false }; });
        dock.addEventListener('pointermove', function (e) {
            if (!arr || e.pointerId !== arr.id) return;
            arr.dx = e.clientX - arr.x;
            if (!arr.movio && Math.abs(arr.dx) > 8) { arr.movio = true; dock.classList.add('arrastre'); try { dock.setPointerCapture(e.pointerId); } catch (_) {} }
            if (arr.movio) colocar(-arr.dx / paso());
        });
        var soltar = function () {
            if (!arr) return; var a = arr; arr = null; dock.classList.remove('arrastre');
            if (!a.movio) return;
            recien = true; setTimeout(function () { recien = false; }, 60);
            mover(Math.round(-a.dx / paso()));
        };
        dock.addEventListener('pointerup', soltar); dock.addEventListener('pointercancel', soltar);
        dock.addEventListener('click', function (e) {
            if (recien) return;
            var t = e.target.closest('.adm-esp-tab'); if (t) elegir(t.dataset.area);
        });
        dock.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowRight') { e.preventDefault(); mover(1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); mover(-1); }
            else return;
            var t = document.querySelector('.adm-esp-tab[aria-selected="true"]'); if (t) t.focus();
        });
        var quieta = 0;
        dock.addEventListener('wheel', function (e) {
            if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 20) return;
            e.preventDefault(); if (Date.now() < quieta) return; quieta = Date.now() + 380;
            mover(e.deltaX > 0 ? 1 : -1);
        }, { passive: false });
        if (!_rueda) { _rueda = true; window.addEventListener('resize', function () { colocar(0); }); }
    }

    window.AdmEspacio = {
        pintar: pintar, elegir: elegir, area: function () { return _area; },
        /* Al abrir una herramienta se recuerda su área: al volver, la portada sigue ahí. */
        recordar: function (id) { if (id) { _area = id; _aMano = true; } },
        delCentro: delCentro
    };
    /* Para las pruebas y para los avisos que llevan directo a un área. */
    window.admArea = elegir;
})();
