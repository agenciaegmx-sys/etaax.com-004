/* ============================================================================
   ETAAX — Visor de fotos con zoom EN LA MISMA PÁGINA (lightbox)
   Sustituye el abrir la evidencia en otra pestaña (cortes, gastos, fotos QR).

   Uso:  onclick="etaaxVerFoto(this.src)"  (o etaaxVerFoto(url))
   - Clic/tap en la imagen → acerca (2.5x) hacia el punto tocado; otro clic aleja.
   - Rueda del mouse → zoom gradual. Dos dedos → pinch zoom (celular).
   - Con zoom, arrastrar → mover la imagen.
   - Cerrar: ✕, clic fuera de la imagen o tecla Escape.
   ============================================================================ */
(function () {
    var _ov = null, _img = null, _btn = null;
    var _scale = 1, _tx = 0, _ty = 0;
    var _drag = null, _movio = false, _pinch = null, _lastTap = 0;
    var MAXZ = 5;

    function _apply(anim) {
        _img.style.transition = anim ? 'transform .18s ease' : 'none';
        _img.style.transform = 'translate(' + _tx + 'px,' + _ty + 'px) scale(' + _scale + ')';
        _img.style.cursor = _scale > 1 ? 'grab' : 'zoom-in';
    }
    function _reset(anim) { _scale = 1; _tx = 0; _ty = 0; _apply(anim); }
    function _cerrar() {
        if (!_ov) return;
        _ov.style.display = 'none';
        _img.src = '';
        document.body.style.overflow = '';
    }

    function _toggleZoom(clientX, clientY) {
        if (_scale > 1) { _reset(true); return; }
        var r = _img.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        _scale = 2.5;
        // El punto tocado se queda quieto: t = p·(1−s)
        _tx = (clientX - cx) * (1 - _scale);
        _ty = (clientY - cy) * (1 - _scale);
        _apply(true);
    }

    function _ensure() {
        if (_ov) return;
        _ov = document.createElement('div');
        _ov.id = 'etaaxFotoZoom';
        _ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.93);' +
            'display:none;align-items:center;justify-content:center;touch-action:none;overflow:hidden';

        _img = document.createElement('img');
        _img.alt = 'evidencia';
        _img.style.cssText = 'max-width:94vw;max-height:90vh;border-radius:8px;' +
            'box-shadow:0 12px 48px rgba(0,0,0,.6);user-select:none;-webkit-user-drag:none;cursor:zoom-in;will-change:transform';
        _ov.appendChild(_img);

        _btn = document.createElement('button');
        _btn.textContent = '✕';
        _btn.setAttribute('aria-label', 'Cerrar');
        _btn.style.cssText = 'position:absolute;top:14px;right:14px;width:42px;height:42px;border-radius:50%;' +
            'background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);color:#fff;font-size:18px;' +
            'cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2';
        _btn.onclick = _cerrar;
        _ov.appendChild(_btn);

        // Cerrar tocando el fondo (no la imagen)
        _ov.addEventListener('click', function (e) { if (e.target === _ov) _cerrar(); });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && _ov.style.display !== 'none') _cerrar();
        });

        // Clic en la imagen: alternar zoom (si no fue un arrastre)
        _img.addEventListener('click', function (e) {
            e.stopPropagation();
            if (_movio) { _movio = false; return; }
            _toggleZoom(e.clientX, e.clientY);
        });

        // Rueda del mouse: zoom gradual hacia el cursor
        _ov.addEventListener('wheel', function (e) {
            e.preventDefault();
            var f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            var nuevo = Math.min(MAXZ, Math.max(1, _scale * f));
            if (nuevo === _scale) return;
            // Mantener quieto el punto bajo el cursor: t' = u·(1−k) + t·k, con
            // u = cursor − centro SIN transformar (rect trae el centro trasladado).
            var r = _img.getBoundingClientRect();
            var cx = r.left + r.width / 2 - _tx, cy = r.top + r.height / 2 - _ty;
            var k = nuevo / _scale;
            _tx = (e.clientX - cx) * (1 - k) + _tx * k;
            _ty = (e.clientY - cy) * (1 - k) + _ty * k;
            _scale = nuevo;
            if (_scale === 1) { _tx = 0; _ty = 0; }
            _apply(false);
        }, { passive: false });

        // Arrastrar para mover (con zoom) — mouse
        _img.addEventListener('mousedown', function (e) {
            if (_scale <= 1) return;
            e.preventDefault();
            _drag = { x: e.clientX, y: e.clientY, tx: _tx, ty: _ty };
            _img.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', function (e) {
            if (!_drag) return;
            var dx = e.clientX - _drag.x, dy = e.clientY - _drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) _movio = true;
            _tx = _drag.tx + dx; _ty = _drag.ty + dy;
            _apply(false);
        });
        document.addEventListener('mouseup', function () {
            if (_drag) { _drag = null; if (_scale > 1) _img.style.cursor = 'grab'; }
        });

        // Touch: 1 dedo mueve (con zoom) o doble-tap alterna; 2 dedos pinch zoom
        _img.addEventListener('touchstart', function (e) {
            if (e.touches.length === 1) {
                var t = e.touches[0];
                var ahora = Date.now();
                if (ahora - _lastTap < 300) { _toggleZoom(t.clientX, t.clientY); _lastTap = 0; return; }
                _lastTap = ahora;
                if (_scale > 1) _drag = { x: t.clientX, y: t.clientY, tx: _tx, ty: _ty };
            } else if (e.touches.length === 2) {
                _drag = null;
                var a = e.touches[0], b = e.touches[1];
                _pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: _scale };
            }
        }, { passive: true });
        _img.addEventListener('touchmove', function (e) {
            if (_pinch && e.touches.length === 2) {
                e.preventDefault();
                var a = e.touches[0], b = e.touches[1];
                var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                _scale = Math.min(MAXZ, Math.max(1, _pinch.s * (d / _pinch.d)));
                if (_scale === 1) { _tx = 0; _ty = 0; }
                _apply(false);
            } else if (_drag && e.touches.length === 1) {
                e.preventDefault();
                var t = e.touches[0];
                _tx = _drag.tx + (t.clientX - _drag.x);
                _ty = _drag.ty + (t.clientY - _drag.y);
                _apply(false);
            }
        }, { passive: false });
        _img.addEventListener('touchend', function (e) {
            if (e.touches.length < 2) _pinch = null;
            if (e.touches.length === 0) _drag = null;
        });

        document.body.appendChild(_ov);
    }

    window.etaaxVerFoto = function (src) {
        if (!src) return;
        _ensure();
        _img.src = src;
        _reset(false);
        _ov.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // no scrollear la página de fondo
    };
})();
