/* ============================================================
   ETAAX — Aviso de actualizaciones del sistema

   Netlify publica en cuanto se hace push, así que el negocio se encuentra
   cambios sin que nadie le diga nada: un botón nuevo, una columna que antes no
   estaba. Este aviso lo cuenta UNA vez por publicación y por navegador.

   La fecha de abajo la estampa solo el hook .githooks/pre-commit en cada
   commit — no se escribe a mano, justamente porque es lo primero que se olvida.
   ============================================================ */
(function () {
    var FECHA = '2026-09-02';          /* ETAAX_DEPLOY — la estampa el hook */

    /* DOS marcas, a propósito:

       · sessionStorage — "ya lo vi EN ESTA SESIÓN". Es la que manda para no
         repetirlo al navegar entre pantallas. La sesión de ETAAX vive en
         sessionStorage (login por pestaña), así que aquí sesión significa lo
         mismo que en el resto de la app.
       · localStorage — "ya di por enterado ESTA publicación". Evita repetirlo
         mañana cuando se vuelva a entrar y no haya nada nuevo.

       Se escriben las dos porque localStorage FALLA en esta app cuando se llena
       —es la causa raíz de media docena de bugs viejos— y ahí el `catch` se lo
       traga en silencio: el aviso volvía a salir en cada pantalla. sessionStorage
       tiene su propio espacio y es el que garantiza el "una vez por sesión". */
    var VISTO  = 'etaax_novedades_visto';
    var SESION = 'etaax_novedades_sesion';

    /* Cuánto hace, dicho como lo diría una persona. Se redondea hacia abajo a
       propósito: "hace una semana" el día 7 y no el 10. */
    function _hace(dias) {
        if (dias <= 0) return 'hoy';
        if (dias === 1) return 'ayer';
        if (dias < 7)  return 'hace ' + dias + ' días';
        if (dias < 14) return 'hace una semana';
        if (dias < 30) return 'hace ' + Math.floor(dias / 7) + ' semanas';
        if (dias < 60) return 'hace un mes';
        return 'hace ' + Math.floor(dias / 30) + ' meses';
    }

    function _diasDesde(iso) {
        var d = new Date(iso + 'T12:00:00');
        if (isNaN(d)) return 0;
        var hoy = new Date();
        // Al mediodía las dos: así el cambio de día no depende de la hora ni del
        // horario de verano, que corre el cálculo un día entero.
        hoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 12, 0, 0);
        return Math.max(0, Math.round((hoy - d) / 86400000));
    }

    function _ya(k)        { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function _yaSes(k)     { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function _marcar(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function _marcarSes(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

    function _pintar() {
        if (document.getElementById('etaaxNovedades')) return;
        var dias = _diasDesde(FECHA);
        var el = document.createElement('div');
        el.id = 'etaaxNovedades';
        el.setAttribute('role', 'status');
        el.style.cssText =
            'position:fixed;top:16px;right:16px;z-index:99998;max-width:330px;' +
            'background:var(--surface,#1a1916);border:1px solid var(--border,#2a2824);' +
            'border-left:3px solid var(--green,#3dbe7a);border-radius:12px;' +
            'padding:14px 16px;box-shadow:0 14px 44px rgba(0,0,0,.45);' +
            'font-family:"DM Sans",sans-serif;color:var(--text,#f0ece6);' +
            'transform:translateX(120%);transition:transform .45s cubic-bezier(.2,.8,.25,1)';
        el.innerHTML =
            '<div style="display:flex;align-items:flex-start;gap:10px">' +
              '<span style="font-size:17px;line-height:1.2">✨</span>' +
              '<div style="flex:1;min-width:0">' +
                '<div style="font-size:13.5px;font-weight:600;line-height:1.4">' +
                  'Hubo actualizaciones en el sistema ' + _hace(dias) + '.</div>' +
                '<div style="font-size:12px;color:var(--text-muted,#a8a29a);line-height:1.55;margin-top:5px">' +
                  'Trabajamos para mejorar tu experiencia y los resultados de ETAAX. ' +
                  'Disfruta de las actualizaciones.</div>' +
                '<button type="button" id="etaaxNovOk" style="margin-top:11px;background:transparent;' +
                  'border:1px solid var(--border,#2a2824);color:var(--text-muted,#a8a29a);border-radius:7px;' +
                  'padding:6px 14px;font-family:inherit;font-size:12px;cursor:pointer">Entendido</button>' +
              '</div>' +
              '<button type="button" id="etaaxNovX" aria-label="Cerrar" style="background:transparent;border:none;' +
                'color:var(--text-dim,#6b6862);font-size:15px;line-height:1;cursor:pointer;padding:0 2px">✕</button>' +
            '</div>';
        document.body.appendChild(el);
        setTimeout(function () { el.style.transform = 'translateX(0)'; }, 60);

        function cerrar() {
            /* Se marca AL CERRAR, no al mostrar: si alguien abre y cierra la pestaña
               sin verlo, se lo merece la próxima vez. */
            _marcarSes(SESION, FECHA);
            _marcar(VISTO, FECHA);
            el.style.transform = 'translateX(120%)';
            setTimeout(function () { try { el.remove(); } catch (e) {} }, 450);
        }
        document.getElementById('etaaxNovOk').onclick = cerrar;
        document.getElementById('etaaxNovX').onclick = cerrar;
    }

    function _arrancar() {
        if (_yaSes(SESION) === FECHA) return;  // ya se dio por enterado en esta sesión
        if (_ya(VISTO)   === FECHA) return;    // y en una sesión anterior, también
        /* Un respiro antes de aparecer: entrar a una pantalla y que algo salte de
           inmediato se siente como un error, no como una noticia. */
        setTimeout(_pintar, 1200);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _arrancar);
    else _arrancar();

    // Para probarlo sin esperar a un deploy: _novedadesDemo() en la consola.
    window._novedadesDemo = function () {
        try { localStorage.removeItem(VISTO); } catch (e) {}
        try { sessionStorage.removeItem(SESION); } catch (e) {}
        _pintar();
    };

    /* Asomadero para el candado: el texto que ve el negocio y la cuenta de días
       son lo único que puede salir mal en silencio (un "hace 0 días", un día de
       más por el horario de verano). */
    window.EtaaxNovedades = { FECHA: FECHA, hace: _hace, diasDesde: _diasDesde, arrancar: _arrancar };
})();
