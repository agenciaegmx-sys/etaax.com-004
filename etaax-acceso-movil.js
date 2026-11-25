/* ══════════════════════════════════════════════════════════════════════════
   ETAAX · EL ACCESO A LA VERSIÓN MÓVIL: su QR y su enlace (window.EtaaxAccesoMovil)

   (Edwin, 25-nov) No hay app que bajar de una tienda: la versión móvil es web
   (/app-movil/) y cada quien la deja en su celular con «Agregar a inicio». Su
   enlace es el QR de la sucursal —negocio + token de la sucursal—, que vive en
   el menú de la cuenta del hub («Versión móvil»), donde se despliega el QR o se
   copia el enlace.

   NO ES UNA APP ABIERTA (v92). Solo existe para una sucursal que ETAAX activó
   desde el panel admin (movil_acceso), y cada sucursal tiene SU token: el QR de
   Polanco no abre Matriz, y apagar una sucursal apaga su QR en el servidor. Por
   eso el hub solo ofrece la entrada si la sucursal activa tiene la app.

   Los QR que ya están impresos en las barras (token del negocio) siguen
   sirviendo mientras el panel los acepte: llevan a /entrada.html y esa página
   los manda aquí con las mismas credenciales.

   QUIÉN LO VE: el mismo permiso de antes, «Generar el QR de entradas»
   (inventarios.qr). El dueño y el administrador siempre. NO se pregunta por el
   plan de apps: la propia app esconde lo que la sucursal no contrató.

   Sin la v92 todo sigue como antes (token del negocio para todas).
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    var QR_LIB = 'https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs/qrcode.min.js';
    var _url = '';

    function _ctx() { try { return JSON.parse(localStorage.getItem('etaax_ctx') || 'null') || {}; } catch (e) { return {}; } }
    function _neg() { var c = _ctx(); return c.negId || localStorage.getItem('etaax_negocio_activo') || ''; }
    function _suc() { return localStorage.getItem('etaax_sucursal_activa') || ''; }
    /* El nombre del negocio y la sucursal: de reporte-marca.js si está (con su
       logo); si no —el hub no lo carga—, del contexto de la sesión. */
    function _marca() {
        if (typeof window.etaaxMarca === 'function') { try { return window.etaaxMarca() || {}; } catch (e) {} }
        var c = _ctx(); return { negocio: c.negNombre || '', sucursal: c.sucNombre || '' };
    }
    function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    /* ── ¿La sucursal tiene la app? (v92) ──
       Se lee movil_acceso (el negocio la lee; solo el admin la escribe) y se
       guarda en el navegador para pintar el menú sin esperar a la red. Sin la
       v92 la tabla no existe: todo sigue como antes. */
    function _llave(negId) { return 'etaax_' + negId + '_movil'; }
    function _leer(negId) { try { return JSON.parse(localStorage.getItem(_llave(negId)) || 'null'); } catch (e) { return null; } }
    function _guardar(negId, v) { try { localStorage.setItem(_llave(negId), JSON.stringify(v)); } catch (e) {} }
    function _faltaV92(err) { return /movil_acceso|movil_token|does not exist|Could not find|PGRST20[25]|42P01/i.test(((err && err.message) || '') + ' ' + ((err && err.code) || '')); }
    function activa(negId, sucId) {
        var m = _leer(negId || _neg());
        if (!m) return false;                 // sin saber todavía: no se ofrece una puerta que quizá no abre
        if (m.sinV92) return true;
        var l = m.sucursales || {};
        return l[sucId || _suc() || 'suc_principal'] === true;
    }
    async function revisar(negId, luego) {
        negId = negId || _neg();
        if (!negId || !window._supabase) return;
        var antes = JSON.stringify(_leer(negId)), ahora;
        try {
            var r = await window._supabase.from('movil_acceso').select('datos').eq('negocio_id', negId).maybeSingle();
            if (r.error) { if (!_faltaV92(r.error)) return; ahora = { sinV92: true }; }
            else ahora = { sucursales: ((r.data && r.data.datos) || {}).sucursales || {} };
        } catch (e) { return; }
        _guardar(negId, ahora);
        if (typeof luego === 'function') luego(JSON.stringify(ahora) !== antes);
    }

    /* El permiso (sin el plan, ver arriba) Y la sucursal con la app. Si el
       ayudante de permisos no cargó, el permiso se deja pasar: la puerta de
       verdad es el servidor (movil_token solo contesta a quien es del negocio). */
    function puede() {
        if (!activa()) return false;
        var c = _ctx();
        if (c.ctxType !== 'staff') return true;
        if ((c.rol || '') === 'admin') return true;
        if (typeof window.etaaxPerm !== 'function') return true;
        return !!window.etaaxPerm(_neg(), c.rol, 'inventarios.qr');
    }

    /* La dirección de la versión móvil con las credenciales del QR. La app las
       guarda en el teléfono: el acceso directo de «Agregar a inicio» ya abre
       listo y solo pide la clave. */
    function enlace(negId, token, sucId) {
        return location.origin + '/app-movil/?n=' + encodeURIComponent(negId) + '&t=' + encodeURIComponent(token) +
               (sucId ? '&s=' + encodeURIComponent(sucId) : '');
    }

    /* El ícono de ETAAX al centro del QR (placa blanca + favicon; el corrector
       H del QR lo tolera). Antes vivía en inventarios.js. */
    if (!window.etaaxQrLogo) window.etaaxQrLogo = function (cont) {
        try {
            var canvas = cont && cont.querySelector('canvas');
            if (!canvas) return;
            var img = cont.querySelector('img'), g = canvas.getContext('2d'), s = canvas.width;
            var logo = new Image();
            logo.onload = function () {
                var box = Math.round(s * 0.24), ico = Math.round(s * 0.19), x = (s - box) / 2, r = Math.round(box * 0.2);
                g.fillStyle = '#ffffff'; g.beginPath();
                if (g.roundRect) g.roundRect(x, x, box, box, r); else g.rect(x, x, box, box);
                g.fill(); g.drawImage(logo, (s - ico) / 2, (s - ico) / 2, ico, ico);
                if (img) img.src = canvas.toDataURL('image/png');   // la librería enseña el <img>: sincronizarlo
            };
            logo.src = '/favicon.svg';
        } catch (e) {}
    };

    function _estilos() {
        if (document.getElementById('etxMovilCss')) return;
        var st = document.createElement('style');
        st.id = 'etxMovilCss';
        st.textContent =
            '#etxMovilDlg{border:1px solid var(--hub-line,var(--border,#33312b));border-radius:18px;padding:0;width:min(440px,calc(100vw - 28px));' +
                'max-height:calc(100dvh - 32px);background:var(--surface,#1b1a16);color:var(--text,#f0ece4);position:fixed;inset:0;margin:auto;height:fit-content}' +
            '#etxMovilDlg::backdrop{background:rgba(0,0,0,.6)}' +
            '#etxMovilDlg .em-cab{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 22px 6px}' +
            '#etxMovilDlg h3{margin:0;font:700 19px/1.3 "DM Sans",sans-serif}' +
            '#etxMovilDlg .em-sub{font-size:12.5px;color:var(--text-dim,#aaa498);margin-top:3px}' +
            '#etxMovilDlg .em-x{background:transparent;border:1px solid var(--border,#33312b);color:inherit;border-radius:9px;width:34px;height:34px;cursor:pointer;flex-shrink:0}' +
            '#etxMovilDlg .em-cuerpo{padding:8px 22px 4px;display:flex;flex-direction:column;gap:12px;font-size:13px;line-height:1.55;color:var(--text-dim,#c9c3b8)}' +
            '#etxMovilDlg .em-qr{display:flex;justify-content:center;min-height:120px;align-items:center}' +
            '#etxMovilDlg .em-qr > div{background:#fff;padding:14px;border-radius:14px;display:inline-block}' +
            '#etxMovilDlg .em-url{display:flex;gap:6px;align-items:center}' +
            '#etxMovilDlg .em-url input{flex:1;min-width:0;font:12px ui-monospace,Menlo,monospace;padding:9px 10px;border-radius:9px;' +
                'border:1px solid var(--border,#33312b);background:var(--s2,rgba(255,255,255,.04));color:inherit}' +
            '#etxMovilDlg .em-btn{border:1px solid var(--border,#33312b);background:transparent;color:inherit;border-radius:9px;padding:9px 12px;font:600 12.5px "DM Sans",sans-serif;cursor:pointer;white-space:nowrap}' +
            '#etxMovilDlg .em-btn.ok{border-color:var(--hub-brand,#8ce4ee);color:var(--hub-brand,#8ce4ee)}' +
            '#etxMovilDlg ol{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}' +
            '#etxMovilDlg b{color:var(--text,#f0ece4)}' +
            '#etxMovilDlg .em-pie{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:14px 22px 20px}' +
            '#etxMovilDlg .em-err{color:var(--red,#e05a3a);text-align:center}';
        document.head.appendChild(st);
    }
    function _dialogo() {
        var d = document.getElementById('etxMovilDlg');
        if (d) return d;
        _estilos();
        d = document.createElement('dialog');
        d.id = 'etxMovilDlg';
        d.setAttribute('aria-labelledby', 'etxMovilTit');
        d.innerHTML =
            '<div class="em-cab"><div><h3 id="etxMovilTit">Versión móvil</h3><div class="em-sub" id="etxMovilSub"></div></div>' +
                '<button type="button" class="em-x" aria-label="Cerrar" data-em="cerrar">✕</button></div>' +
            '<div class="em-cuerpo">' +
                '<div>Pégalo en la barra, la cocina o la bodega. El equipo lo escanea con la cámara, entra con su <b>clave de 5 dígitos</b> ' +
                    'y ve lo de su turno: entradas y recetario (Cost·ax), horarios, check lists y evaluaciones (Equip·ax). ' +
                    'Tú entras con tu usuario y contraseña.</div>' +
                '<div class="em-qr" id="etxMovilQr"></div>' +
                '<div class="em-url"><input id="etxMovilUrl" type="text" readonly aria-label="Enlace de la versión móvil">' +
                    '<button type="button" class="em-btn ok" data-em="copiar">Copiar enlace</button></div>' +
                '<div><b>Para que quede como app</b><ol>' +
                    '<li>iPhone: ábrelo en Safari → botón de compartir → «Agregar a inicio».</li>' +
                    '<li>Android: ábrelo en Chrome → menú ⋮ → «Instalar app» o «Agregar a pantalla de inicio».</li></ol></div>' +
            '</div>' +
            '<div class="em-pie">' +
                '<button type="button" class="em-btn" data-em="descargar">Descargar PNG</button>' +
                '<button type="button" class="em-btn" data-em="imprimir">Imprimir</button>' +
                '<button type="button" class="em-btn ok" data-em="cerrar">Listo</button>' +
            '</div>';
        d.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('[data-em]'); if (!b) return;
            var a = b.getAttribute('data-em');
            if (a === 'cerrar') cerrar();
            else if (a === 'copiar') copiar(b);
            else if (a === 'descargar') descargar();
            else if (a === 'imprimir') imprimir();
        });
        document.body.appendChild(d);
        return d;
    }
    function cerrar() { var d = document.getElementById('etxMovilDlg'); if (d && d.open) { try { d.close(); } catch (e) { d.removeAttribute('open'); } } }

    async function abrir() {
        if (!puede()) { alert('🔒 Tu rol no puede generar el QR de la versión móvil.'); return; }
        var negId = _neg();
        if (!negId) { alert('Primero elige un negocio.'); return; }
        var d = _dialogo(), box = document.getElementById('etxMovilQr'), inp = document.getElementById('etxMovilUrl');
        var m = _marca();
        var suc = _suc();
        document.getElementById('etxMovilSub').textContent = suc && m.sucursal
            ? 'QR de ' + m.sucursal + ' · solo abre esta sucursal'
            : 'QR de la sucursal · cada quien entra con su clave';
        box.innerHTML = '<div style="background:none;padding:0">Generando…</div>';
        inp.value = ''; _url = '';
        if (!d.open) { try { d.showModal(); } catch (e) { d.setAttribute('open', ''); } }
        var token = '', sucQr = suc;
        try {
            /* El token de ESTA sucursal (v92). NULL = la sucursal no tiene la app. */
            var r = await window._supabase.rpc('movil_token', { p_neg: negId, p_suc: suc || '' });
            if (r.error && _faltaV92(r.error)) {
                /* Sin la v92: el token del negocio, como antes. */
                r = await window._supabase.rpc('entrada_token_asegurar', { p_neg: negId });
                if (r.error) throw r.error;
                token = r.data || '';
            } else {
                if (r.error) throw r.error;
                if (!r.data || !r.data.token) {
                    _guardar(negId, { sucursales: {} });
                    box.innerHTML = '<div class="em-err" style="background:none;padding:0">La app móvil no está activa en esta sucursal.<br>' +
                        '<span style="color:var(--text-dim,#aaa498)">ETAAX la activa desde su panel.</span></div>';
                    return;
                }
                token = r.data.token; sucQr = r.data.sucursalId || suc;
            }
        } catch (e) {
            box.innerHTML = '<div class="em-err" style="background:none;padding:0">No se pudo preparar el enlace.<br>' + _esc((e && e.message) || e) + '</div>';
            return;
        }
        _url = enlace(negId, token, sucQr);
        inp.value = _url;
        var pintar = function () {
            box.innerHTML = '';
            var q = document.createElement('div');
            box.appendChild(q);
            try {
                new window.QRCode(q, { text: _url, width: 210, height: 210, colorDark: '#0a0908', colorLight: '#ffffff' });
                window.etaaxQrLogo(q);
            } catch (e) { box.innerHTML = '<div class="em-err" style="background:none;padding:0">No se pudo dibujar el QR. El enlace sí sirve.</div>'; }
        };
        if (window.QRCode) pintar();
        else {
            var s = document.createElement('script');
            s.src = QR_LIB; s.onload = pintar;
            s.onerror = function () { box.innerHTML = '<div class="em-err" style="background:none;padding:0">No se pudo cargar el generador de QR. El enlace sí sirve.</div>'; };
            document.head.appendChild(s);
        }
    }

    function copiar(btn) {
        if (!_url) return;
        var ok = function () { if (btn) { var t = btn.textContent; btn.textContent = 'Copiado'; setTimeout(function () { btn.textContent = t; }, 1600); } };
        var a_mano = function () { var i = document.getElementById('etxMovilUrl'); if (i) { i.focus(); i.select(); } };
        try { navigator.clipboard.writeText(_url).then(ok, a_mano); } catch (e) { a_mano(); }
    }
    function _png() {
        var box = document.getElementById('etxMovilQr'); if (!box) return '';
        var c = box.querySelector('canvas'); if (c) { try { return c.toDataURL('image/png'); } catch (e) {} }
        var img = box.querySelector('img'); return img ? img.src : '';
    }
    function descargar() {
        var data = _png(); if (!data) { alert('Espera a que se dibuje el QR.'); return; }
        var m = _marca();
        var a = document.createElement('a');
        a.href = data;
        a.download = ('etaax-movil-' + (m.negocio || 'negocio') + (m.sucursal ? '-' + m.sucursal : ''))
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.png';
        a.click();
    }
    /* La hoja para pegar en la barra: la marca del negocio, el QR grande y los
       pasos. Los estilos de impresión viven DENTRO del overlay y se van con él. */
    function imprimir() {
        var data = _png(); if (!data) { alert('Espera a que se dibuje el QR.'); return; }
        var m = _marca();
        var viejo = document.getElementById('etxMovilPrint'); if (viejo) viejo.remove();
        var ov = document.createElement('div');
        ov.id = 'etxMovilPrint';
        ov.innerHTML =
            '<style>#etxMovilPrint{display:none}@media print{@page{size:letter;margin:14mm}' +
            'body>*:not(#etxMovilPrint){display:none!important}' +
            '#etxMovilPrint{display:block!important;background:#fff;color:#1a1916;font-family:Arial,Helvetica,sans-serif;text-align:center}}</style>' +
            '<div style="display:flex;align-items:center;justify-content:center;gap:12px;border-bottom:3px solid #247681;padding-bottom:14px;margin-bottom:22px">' +
                (m.logo ? '<img src="' + _esc(m.logo) + '" style="width:52px;height:52px;object-fit:cover;border-radius:10px">' : '') +
                '<div style="text-align:left"><div style="font-weight:800;font-size:22px;letter-spacing:1px">' + _esc(m.negocio || '') + '</div>' +
                (m.sucursal ? '<div style="font-size:13px;color:#555">' + _esc(m.sucursal) + '</div>' : '') + '</div></div>' +
            '<div style="font-weight:800;font-size:26px;letter-spacing:2px;margin-bottom:4px">ETAAX MÓVIL</div>' +
            '<div style="font-size:13px;color:#555;margin-bottom:20px">Entradas, recetario, horarios y check lists desde tu celular</div>' +
            '<img src="' + data + '" style="width:290px;height:290px;border:1px solid #ddd;border-radius:14px;padding:14px;background:#fff">' +
            '<div style="max-width:430px;margin:22px auto 0;text-align:left;font-size:13px;color:#333;line-height:1.7">' +
                '<b>Cómo se usa:</b><br>1. Escanea el QR con la cámara del celular.<br>' +
                '2. Toca «Entrar con mi clave» y escribe tu <b>clave de 5 dígitos</b>.<br>' +
                '3. Para dejarla como app: «Agregar a inicio» (iPhone, en Safari) o «Instalar app» (Android, en Chrome).</div>' +
            '<div style="border-top:1px solid #eee;margin-top:22px;padding-top:8px;font-size:9px;color:#767267">etaax.com · EGMx Consultoría Estratégica a&b</div>';
        document.body.appendChild(ov);
        var limpiar = function () { var o = document.getElementById('etxMovilPrint'); if (o) o.remove(); };
        window.addEventListener('afterprint', limpiar, { once: true });
        window.print();
        setTimeout(limpiar, 2000);
    }

    window.EtaaxAccesoMovil = { puede: puede, activa: activa, revisar: revisar, enlace: enlace, abrir: abrir, cerrar: cerrar };
})();
