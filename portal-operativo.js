/* ============================================================================
   ETAAX — AYUDAS DE PRESENTACIÓN DE LAS PUERTAS QR

   Solo presentación: marca la página como portal y pone los iconos de la casa
   en los botones de volver. NO toca el NIP, ni las RPC, ni las evidencias, ni
   decide permisos — eso vive en cada puerta y no se mueve de ahí.
   ============================================================================ */
(function () {
    'use strict';
    /* El `<body>` puede no existir todavía: estas puertas cargan sus scripts en
       el `<head>`. Dar por hecho que está es cómo un archivo de presentación
       tumba la página entera con «no puedo leer classList de null». */
    function marcar() {
        if (!document.body) { document.addEventListener('DOMContentLoaded', marcar); return; }
        document.body.classList.add('etx-portal');
    }
    marcar();

    /* El sprite puede llegar después que este archivo. Si no está, se vuelve a
       intentar en vez de dejar la flecha de texto puesta para siempre: ese
       «rendirse en silencio» ya costó dos diagnósticos en el panel. */
    var intentos = 0;
    function flechas() {
        if (typeof window.etaaxIcono !== 'function') {
            if (intentos++ < 40) setTimeout(flechas, 150);
            return;
        }
        document.querySelectorAll('.volver-menu, .volver').forEach(function (b) {
            if (b.dataset.etxFlecha) return;
            var marcado = window.etaaxIcono('flecha', { tam: b.classList.contains('volver-menu') ? 18 : 16 });
            if (!marcado) return;
            b.dataset.etxFlecha = '1';
            /* Se quita la flecha de texto que había al principio del rótulo y se
               pone el icono delante. El texto se respeta tal cual: es el que
               dice a dónde lleva. */
            var t = b.firstChild;
            while (t && t.nodeType === 3 && !t.nodeValue.trim()) t = t.nextSibling;
            if (t && t.nodeType === 3) t.nodeValue = t.nodeValue.replace(/^[\s ]*[←‹<]\s*/, '');
            var hueco = document.createElement('span');
            hueco.setAttribute('aria-hidden', 'true');
            hueco.style.display = 'inline-flex';
            hueco.innerHTML = marcado;
            b.insertBefore(hueco, b.firstChild);
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', flechas);
    else flechas();
    /* Las pantallas se muestran y se ocultan, pero no se vuelven a crear; aun
       así se repasa si alguna aparece después. */
    window.etaaxPortalIconos = flechas;
})();
