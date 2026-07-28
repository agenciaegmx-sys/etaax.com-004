/* ============================================================
   ETAAX — Modales flotantes movibles
   Arrastra cualquier modal por su ENCABEZADO para reubicarlo en
   la pantalla. Doble clic en el encabezado → lo recentra.
   Convive con resize:both (la esquina inferior derecha redimensiona;
   el encabezado mueve). No interfiere con botones/inputs del header.

   Se incluye como <script src="/modal-drag.js"> en cada página con
   modales. Delegado y global: no necesita configurar cada modal.
   ============================================================ */
(function () {
    if (window._etxModalDrag) return; window._etxModalDrag = true;

    var MODAL  = '.modal,.dx-win,.cj-panel,.modal-gg,.tool-modal,.vp-mbox';
    var HANDLE = '.modal-header,.dx-win-hdr,.cj-header,.tool-modal-hd,.etx-modal-hd';
    var SKIP   = 'button,a,input,select,textarea,label,.modal-close';

    // Caja del modal a mover: si el encabezado no está dentro de una clase de
    // modal conocida, se sube genéricamente hasta el hijo directo del overlay
    // fijo (cubre modales custom: escandallo, insumos globales, etc.).
    function boxOf(handle) {
        var m = handle.closest(MODAL); if (m) return m;
        var el = handle, prev = handle;
        while (el && el !== document.body) {
            var p; try { p = getComputedStyle(el).position; } catch (e) {}
            if (p === 'fixed') return prev;
            prev = el; el = el.parentElement;
        }
        return null;
    }

    var st = document.createElement('style');
    st.textContent =
        HANDLE.split(',').map(function (h) { return h + '{cursor:grab;touch-action:none;user-select:none}'; }).join('') +
        HANDLE.split(',').map(function (h) { return h + ' ' + SKIP.replace(/,/g, ',' + h + ' ') + '{cursor:auto;user-select:auto}'; }).join('');
    (document.head || document.documentElement).appendChild(st);

    var drag = null, handleEl = null, sx = 0, sy = 0, bx = 0, by = 0, moved = false;
    function pos(el) {
        var m = (el.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
    }
    document.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        var handle = e.target.closest(HANDLE);
        if (!handle || e.target.closest(SKIP)) return;
        var modal = boxOf(handle);
        if (!modal) return;
        drag = modal; handleEl = handle; moved = false;
        var p = pos(modal); bx = p.x; by = p.y; sx = e.clientX; sy = e.clientY;
        modal.style.transition = 'none';
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        handle.style.cursor = 'grabbing';
    });
    document.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        moved = true;
        drag.style.transform = 'translate(' + (bx + dx) + 'px,' + (by + dy) + 'px)';
        e.preventDefault();
    });
    function end() {
        if (handleEl) handleEl.style.cursor = 'grab';
        drag = null; handleEl = null;
    }
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    // Doble clic en el encabezado → recentrar el modal.
    document.addEventListener('dblclick', function (e) {
        var handle = e.target.closest(HANDLE);
        if (!handle || e.target.closest(SKIP)) return;
        var modal = boxOf(handle);
        if (modal) modal.style.transform = '';
    });
})();
