/* ============================================================
   ETAAX — Puente QR de captura (lado computadora)
   Genera un token temporal, dibuja el QR y escucha (polling) las
   fotos que el celular sube a la bandeja con ese token.
   El token vive 5 minutos (seguridad), así que la compu lo
   REGENERA sola cada 3 min para que el QR en pantalla siempre sirva
   (al escanear siempre quedan ≥2 min).
   Requiere: _supabase (supabase-config.js). Carga la librería de
   QR desde jsdelivr la primera vez.

   API:
     await QrPuente.abrir(negId, tipo, contenedorEl, onFoto)
       onFoto({url, path}) se llama por cada foto recibida.
     QrPuente.cerrar()  → detiene el polling y la regeneración
   ============================================================ */
(function () {
    var QR_LIB = 'https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js';
    var VIDA_MS = 300000;           // un token vive 5 minutos (servidor: token_pairing_valido v26)
    var REGEN_MS = 180000;          // se regenera cada 3 min → al escanear siempre quedan ≥2 min
    var _pollTimer = null, _regenTimer = null;
    var _tokens = [];               // [{token, ts}] tokens aún vivos
    var _seen = {};                 // ids de capturas ya entregadas
    var _ctx = null;                // {negId, tipo, el, onFoto}

    function _loadLib(cb) {
        if (window.QRCode) { cb(); return; }
        var s = document.createElement('script');
        s.src = QR_LIB;
        s.onload = function () { cb(); };
        s.onerror = function () { cb('err'); };
        document.head.appendChild(s);
    }
    function _token16() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }

    async function _generar() {
        if (!_ctx) return;
        var token = _token16();
        var ahora = Date.now();
        var r = await _supabase.from('pairing_sesiones').insert({ token: token, negocio_id: _ctx.negId, tipo: _ctx.tipo });
        if (r.error) {
            // Sin permiso para crear el token (p.ej. falta correr la migración v18).
            // Aviso claro en vez de un QR que no funcionaría.
            if (_ctx && _ctx.el) _ctx.el.innerHTML =
                '<div style="font-size:11px;color:var(--text-dim);line-height:1.5;max-width:160px">' +
                '📵 No se pudo iniciar el escaneo. Registra sin foto; el dueño podrá adjuntarla después.</div>';
            if (window._sbToastError) _sbToastError('QR: ' + r.error.message);
            return;
        }

        _tokens.push({ token: token, ts: ahora });
        // purga tokens que ya pasaron su minuto (+10s de gracia)
        _tokens = _tokens.filter(function (x) { return ahora - x.ts < VIDA_MS + 10000; });

        var url = location.origin + '/captura.html?t=' + token +
            '&neg=' + encodeURIComponent(_ctx.negId) +
            '&tipo=' + encodeURIComponent(_ctx.tipo) +
            '&ts=' + ahora;
        _loadLib(function (err) {
            if (!_ctx) return;
            _ctx.el.innerHTML = '';
            if (err || !window.QRCode) {
                _ctx.el.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">No se pudo generar el QR</div>';
                return;
            }
            var box = document.createElement('div');
            box.style.cssText = 'background:#fff;padding:8px;border-radius:8px;display:inline-block';
            _ctx.el.appendChild(box);
            new QRCode(box, { text: url, width: 116, height: 116, colorDark: '#0a0908', colorLight: '#ffffff' });
            var hint = document.createElement('div');
            hint.style.cssText = 'font-size:10px;color:var(--text-dim);text-align:center;margin-top:6px;max-width:140px';
            hint.textContent = 'Escanea para subir foto · el código se renueva solo';
            _ctx.el.appendChild(hint);
        });
    }

    async function _poll() {
        if (!_ctx || !_tokens.length) return;
        var lista = _tokens.map(function (x) { return x.token; });
        // claim_capturas (RPC SECURITY DEFINER): devuelve las fotos de estos tokens
        // y las marca asociadas en un solo paso. Funciona también para sesiones de
        // colaborador (anon), sin exponer la tabla completa por SELECT.
        var q = await _supabase.rpc('claim_capturas', { p_tokens: lista });
        if (q.error || !q.data) return;
        for (var i = 0; i < q.data.length; i++) {
            var c = q.data[i];
            if (_seen[c.id]) continue;
            _seen[c.id] = true;
            if (_ctx && typeof _ctx.onFoto === 'function' && c.foto_url) _ctx.onFoto({ url: c.foto_url, path: c.foto_path });
        }
    }

    window.QrPuente = {
        abrir: async function (negId, tipo, contenedorEl, onFoto) {
            if (!negId || typeof _supabase === 'undefined' || !contenedorEl) return;
            this.cerrar();
            _ctx = { negId: negId, tipo: tipo, el: contenedorEl, onFoto: onFoto };
            _seen = {};
            _tokens = [];
            await _generar();
            _regenTimer = setInterval(_generar, REGEN_MS);
            _pollTimer = setInterval(_poll, 3000);
        },
        cerrar: function () {
            if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
            if (_regenTimer) { clearInterval(_regenTimer); _regenTimer = null; }
            _tokens = [];
            _ctx = null;
        }
    };
})();
