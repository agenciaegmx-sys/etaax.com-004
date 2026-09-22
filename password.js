/* ============================================================================
   ETAAX — CONTRASEÑAS DE CUENTA (dueño / acceso al negocio)

   Antes el único requisito era "mínimo 6 caracteres", así que "123456" pasaba.
   Esa contraseña abre la cuenta que ve nóminas, CLABE, CURP e INE de todo el
   personal: es la llave más gorda del sistema y era la peor cuidada.

   REGLA: mínimo 8, con minúscula, MAYÚSCULA y número. El símbolo NO se exige
   —obligarlo empuja a "Password1!" y a escribirla en un papel pegado al
   monitor— pero sí suma fuerza. Y se rechazan las de siempre: 12345678,
   password, el nombre del sistema, el propio correo.

   OJO CON A QUIÉN SE LE APLICA: esto es para la cuenta del DUEÑO. Los accesos
   de colaborador (usuario + clave corta en una tablet de cocina, NIP de QR)
   siguen con su propia regla, más suave a propósito: ahí el riesgo y el uso
   son otros, y endurecerlos de golpe dejaría a media cocina fuera un lunes.

   Uso:
     EtaaxPwd.evaluar(pwd, {correo})  → { ok, fuerza 0-4, faltan[], etiqueta }
     EtaaxPwd.generar()               → contraseña sugerida, legible y fuerte
     EtaaxPwd.montar('idInput', {correo, onCambio}) → pinta medidor + requisitos
                                        + botón de sugerencia bajo ese campo
   ============================================================================ */
(function () {
    if (window.EtaaxPwd) return;

    var MIN = 8;

    /* Las que se prueban primero en cualquier ataque. Se comparan en minúsculas
       y sin espacios: "Password 1" es la misma de siempre con maquillaje. */
    var COMUNES = [
        '12345678', '123456789', '1234567890', 'password', 'passw0rd', 'contrasena',
        'contraseña', 'qwertyui', 'iloveyou', 'admin123', 'administrador',
        'etaax', 'etaax123', 'restaurante', 'bienvenido', 'mexico123', 'abcd1234'
    ];

    function _normal(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }

    /* ¿Se parece demasiado a su propio correo? Usar la parte de antes de la @
       como contraseña es regalar la mitad del par. */
    function _esSuCorreo(pwd, correo) {
        var local = _normal(String(correo || '').split('@')[0]);
        if (local.length < 4) return false;
        return _normal(pwd).indexOf(local) > -1;
    }

    function evaluar(pwd, opts) {
        pwd = String(pwd == null ? '' : pwd);
        opts = opts || {};
        var n = _normal(pwd);
        var tiene = {
            largo: pwd.length >= MIN,
            min:   /[a-záéíóúüñ]/.test(pwd),
            may:   /[A-ZÁÉÍÓÚÜÑ]/.test(pwd),
            num:   /[0-9]/.test(pwd),
            sim:   /[^A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ]/.test(pwd)
        };
        var faltan = [];
        if (!tiene.largo) faltan.push('al menos ' + MIN + ' caracteres');
        if (!tiene.min)   faltan.push('una minúscula');
        if (!tiene.may)   faltan.push('una MAYÚSCULA');
        if (!tiene.num)   faltan.push('un número');

        /* Una contraseña de la lista no se salva por ser larga ni por llevar
           mayúscula: si está en la lista, está en el primer diccionario que se
           prueba. */
        var comun = false;
        for (var i = 0; i < COMUNES.length; i++) {
            if (n.indexOf(COMUNES[i]) > -1) { comun = true; break; }
        }
        var suCorreo = _esSuCorreo(pwd, opts.correo);
        if (comun)    faltan.push('que no sea una contraseña conocida');
        if (suCorreo) faltan.push('que no sea tu propio correo');

        /* Fuerza 0-4, solo para el medidor. No decide si pasa: eso lo dice `ok`.
           Una contraseña puede cumplir lo mínimo y aun así verse "regular", que
           es justo el empujón que se busca. */
        var fuerza = 0;
        if (pwd.length >= MIN)  fuerza++;
        if (pwd.length >= 12)   fuerza++;
        if (tiene.min && tiene.may && tiene.num) fuerza++;
        if (tiene.sim)          fuerza++;
        if (comun || suCorreo)  fuerza = 0;
        if (!tiene.largo)       fuerza = Math.min(fuerza, 1);

        var ETIQ = ['Muy débil', 'Débil', 'Regular', 'Fuerte', 'Muy fuerte'];
        return {
            ok: faltan.length === 0,
            fuerza: fuerza,
            faltan: faltan,
            etiqueta: ETIQ[fuerza] || ETIQ[0],
            tiene: tiene
        };
    }

    /* ── Sugerencia ──────────────────────────────────────────────────────────
       Sin caracteres que se confunden al dictarla o copiarla a mano: fuera
       l, I, 1, O, 0. Se arma garantizando las cuatro familias y luego se
       revuelve, para que la posición de cada tipo no sea siempre la misma. */
    var MINU = 'abcdefghijkmnopqrstuvwxyz';
    var MAYU = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    var NUME = '23456789';
    var SIMB = '@#$%&*+=?';

    function _azar(max) {
        /* Aleatoriedad del sistema, no Math.random: esta cadena va a ser la
           llave de una cuenta real. Si el navegador no la tiene, se avisa por
           consola y se sigue — una sugerencia imperfecta es mejor que ninguna. */
        try {
            var a = new Uint32Array(1);
            window.crypto.getRandomValues(a);
            return a[0] % max;
        } catch (e) {
            if (!_azar._avisado) { _azar._avisado = true; console.warn('[pwd] sin crypto: sugerencia menos aleatoria'); }
            return Math.floor(Math.random() * max);
        }
    }
    function _de(set) { return set.charAt(_azar(set.length)); }

    function generar(largo) {
        var n = Math.max(12, largo || 14);
        var cs = [_de(MINU), _de(MAYU), _de(NUME), _de(SIMB)];
        var todo = MINU + MAYU + NUME + SIMB;
        while (cs.length < n) cs.push(_de(todo));
        // Revolver (Fisher-Yates): si no, los cuatro obligatorios van al frente.
        for (var i = cs.length - 1; i > 0; i--) {
            var j = _azar(i + 1), t = cs[i]; cs[i] = cs[j]; cs[j] = t;
        }
        return cs.join('');
    }

    /* ── El medidor bajo el campo ────────────────────────────────────────────
       Pinta fuerza, lo que falta y el botón de sugerencia. Devuelve una función
       para volver a evaluar desde fuera (p. ej. cuando cambia el correo). */
    var COLOR = ['#e05a3a', '#e05a3a', '#f5c842', '#3dbe7a', '#3dbe7a'];

    function _css() {
        if (document.getElementById('etx-pwd-css')) return;
        var st = document.createElement('style');
        st.id = 'etx-pwd-css';
        st.textContent =
            '.etx-pwd-wrap{margin-top:8px}' +
            '.etx-pwd-barra{display:flex;gap:4px;margin-bottom:6px}' +
            '.etx-pwd-seg{height:3px;flex:1;border-radius:2px;background:var(--border,#2a2825);transition:background .2s}' +
            '.etx-pwd-fila{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
            '.etx-pwd-txt{font-size:11.5px;color:var(--text-dim,#7a7570);line-height:1.5;flex:1}' +
            '.etx-pwd-gen{background:transparent;border:1px solid var(--border,#2a2825);border-radius:7px;' +
            '  color:var(--text-dim,#7a7570);font-family:inherit;font-size:11px;padding:5px 10px;cursor:pointer;' +
            '  white-space:nowrap;transition:all .15s;flex-shrink:0}' +
            '.etx-pwd-gen:hover{border-color:var(--green,#3dbe7a);color:var(--green,#3dbe7a)}' +
            '.etx-pwd-sug{margin-top:7px;display:none;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;' +
            '  background:rgba(61,190,122,.10);border:1px solid rgba(61,190,122,.32)}' +
            '.etx-pwd-sug.on{display:flex}' +
            '.etx-pwd-sug code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;' +
            '  letter-spacing:.5px;color:var(--text,#f0ece4);flex:1;word-break:break-all}' +
            '.etx-pwd-copiar{background:transparent;border:none;color:var(--green,#3dbe7a);font-family:inherit;' +
            '  font-size:11px;cursor:pointer;padding:2px 4px;flex-shrink:0}';
        document.head.appendChild(st);
    }

    function montar(inputId, opts) {
        opts = opts || {};
        var inp = document.getElementById(inputId);
        if (!inp || inp._etxPwd) return function () {};
        inp._etxPwd = true;
        _css();

        var wrap = document.createElement('div');
        wrap.className = 'etx-pwd-wrap';
        wrap.innerHTML =
            '<div class="etx-pwd-barra">' +
                '<span class="etx-pwd-seg"></span><span class="etx-pwd-seg"></span>' +
                '<span class="etx-pwd-seg"></span><span class="etx-pwd-seg"></span>' +
            '</div>' +
            '<div class="etx-pwd-fila">' +
                '<span class="etx-pwd-txt"></span>' +
                '<button type="button" class="etx-pwd-gen">✨ Sugerir una segura</button>' +
            '</div>' +
            '<div class="etx-pwd-sug"><code></code>' +
                '<button type="button" class="etx-pwd-copiar">Copiar</button></div>';
        /* Va DESPUÉS del campo pero antes de la pista que ya tuviera, para que
           el orden de lectura sea: escribo → qué tan fuerte quedó → qué falta. */
        inp.parentNode.insertBefore(wrap, inp.nextSibling);

        var segs    = wrap.querySelectorAll('.etx-pwd-seg');
        var txt     = wrap.querySelector('.etx-pwd-txt');
        var caja    = wrap.querySelector('.etx-pwd-sug');
        var code    = wrap.querySelector('code');
        var btnCop  = wrap.querySelector('.etx-pwd-copiar');

        function pintar() {
            var v = inp.value || '';
            var r = evaluar(v, { correo: (typeof opts.correo === 'function' ? opts.correo() : opts.correo) });
            for (var i = 0; i < segs.length; i++) {
                segs[i].style.background = (v && i < r.fuerza) ? COLOR[r.fuerza] : 'var(--border,#2a2825)';
            }
            if (!v) {
                txt.textContent = 'Mínimo 8, con mayúscula, minúscula y número.';
                txt.style.color = 'var(--text-dim,#7a7570)';
            } else if (r.ok) {
                txt.textContent = r.etiqueta + ' · lista para usarse.';
                txt.style.color = 'var(--green,#3dbe7a)';
            } else {
                txt.textContent = 'Le falta: ' + r.faltan.join(', ') + '.';
                txt.style.color = 'var(--text-dim,#7a7570)';
            }
            if (typeof opts.onCambio === 'function') opts.onCambio(r);
            return r;
        }

        inp.addEventListener('input', pintar);
        wrap.querySelector('.etx-pwd-gen').addEventListener('click', function () {
            var p = generar();
            inp.value = p;
            /* Se enseña en claro a propósito: una contraseña sugerida que no se
               puede leer no se puede guardar en ningún lado, y termina
               cambiándose por una mala en el primer intento de entrar. */
            inp.type = 'text';
            code.textContent = p;
            caja.classList.add('on');
            pintar();
            inp.focus();
        });
        btnCop.addEventListener('click', function () {
            var p = code.textContent;
            try {
                navigator.clipboard.writeText(p);
                btnCop.textContent = '¡Copiada!';
            } catch (e) { btnCop.textContent = 'Cópiala a mano'; }
            setTimeout(function () { btnCop.textContent = 'Copiar'; }, 1800);
        });

        pintar();
        return pintar;
    }

    window.EtaaxPwd = { MIN: MIN, evaluar: evaluar, generar: generar, montar: montar, COMUNES: COMUNES };
})();
