/* ============================================================
   ETAAX — Puente QR de captura (lado computadora)
   Genera un token temporal, dibuja el QR y escucha (polling) las
   fotos que el celular sube a la bandeja con ese token.
   Requiere: _supabase (supabase-config.js). Carga la librería de
   QR desde jsdelivr la primera vez.

   API:
     await QrPuente.abrir(negId, tipo, contenedorEl, onFoto)
       onFoto({url, path}) se llama por cada foto recibida.
     QrPuente.cerrar()  → detiene el polling
   ============================================================ */
(function () {
    var QR_LIB = 'https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js';
    var _pollTimer = null, _token = null;

    function _loadLib(cb) {
        if (window.QRCode) { cb(); return; }
        var s = document.createElement('script');
        s.src = QR_LIB;
        s.onload = function () { cb(); };
        s.onerror = function () { cb('err'); };
        document.head.appendChild(s);
    }
    function _token16() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 12); }

    window.QrPuente = {
        abrir: async function (negId, tipo, contenedorEl, onFoto) {
            if (!negId || typeof _supabase === 'undefined' || !contenedorEl) return;
            this.cerrar();
            _token = _token16();
            var r = await _supabase.from('pairing_sesiones').insert({ token: _token, negocio_id: negId, tipo: tipo });
            if (r.error) { if (window._sbToastError) _sbToastError('QR: ' + r.error.message); }

            var url = location.origin + '/captura.html?t=' + _token + '&neg=' + encodeURIComponent(negId) + '&tipo=' + encodeURIComponent(tipo);
            _loadLib(function (err) {
                contenedorEl.innerHTML = '';
                if (err || !window.QRCode) {
                    contenedorEl.innerHTML = '<div style="font-size:11px;color:var(--text-dim)">No se pudo generar el QR</div>';
                    return;
                }
                var box = document.createElement('div');
                box.style.cssText = 'background:#fff;padding:8px;border-radius:8px;display:inline-block';
                contenedorEl.appendChild(box);
                new QRCode(box, { text: url, width: 116, height: 116, colorDark: '#0a0908', colorLight: '#ffffff' });
                var hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-dim);text-align:center;margin-top:6px;max-width:140px';
                hint.textContent = 'Escanea con tu celular para subir foto';
                contenedorEl.appendChild(hint);
            });

            var seen = {};
            _pollTimer = setInterval(async function () {
                if (!_token) return;
                var q = await _supabase.from('capturas_pendientes')
                    .select('id,foto_url,foto_path').eq('token', _token).eq('asociado', false);
                if (q.error || !q.data) return;
                for (var i = 0; i < q.data.length; i++) {
                    var c = q.data[i];
                    if (seen[c.id]) continue;
                    seen[c.id] = true;
                    if (typeof onFoto === 'function' && c.foto_url) onFoto({ url: c.foto_url, path: c.foto_path });
                    _supabase.from('capturas_pendientes').update({ asociado: true }).eq('id', c.id).then(function () {});
                }
            }, 3000);
        },
        cerrar: function () {
            if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
            _token = null;
        }
    };
})();
