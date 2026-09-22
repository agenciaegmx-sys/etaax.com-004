/* ============================================================================
   ETAAX — TEMA CLARO / OSCURO: UNA SOLA FUENTE DE VERDAD

   QUÉ ESTABA MAL (auditado el 22-sep-2026, 53 páginas):
     · 31 páginas traían su PROPIA copia del interruptor, en nueve variantes
       distintas. Hacían lo mismo, pero cada una a su manera — y las que se
       quedaban atrás no se notaban hasta que alguien navegaba y veía el tema
       "brincar" de pantalla en pantalla.
     · hub.html y admin.html SÍ guardaban la preferencia pero declaran su propia
       paleta y nunca definieron la clara: el interruptor se movía y no cambiaba
       nada. Por eso "el modo oscuro no funciona en la pantalla principal".
     · Los documentos legales traían data-theme="dark" clavado en el <html>:
       ignoraban la preferencia a propósito, sin querer.
     · Y lo más visible: al cambiar el tema DENTRO de una ventana flotante (un
       iframe), la página de atrás se quedaba con el tema anterior hasta
       recargarla. Dos temas a la vez, en la misma pantalla.

   CÓMO SE ARREGLA:
     · Esta es la única copia. Va lo más arriba posible del <head>:
           <script src="/theme.js"></script>
     · Aplica el tema guardado ANTES del primer pintado (sin parpadeo).
     · Escucha el evento `storage`: el navegador lo dispara en TODOS los demás
       documentos del mismo origen —otras pestañas, los iframes y la página que
       los contiene—, así que cambiar el tema en un lado lo cambia en todos, al
       instante y sin recargar.
     · Avisa con el evento `etaax:theme` para lo que necesite repintarse (las
       gráficas de Estadísticas, por ejemplo, que se dibujan con los colores del
       tema y no se actualizan solas).

   Sigue existiendo window.toggleTheme() para los onclick que ya están escritos.
   ============================================================================ */
(function () {
    var CLAVE = 'etaax_theme';

    function _leer() {
        try { return localStorage.getItem(CLAVE) === 'light' ? 'light' : 'dark'; }
        catch (e) { return 'dark'; }
    }
    function _actual() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    /* 1) Antes del primer pintado. Este archivo va en el <head>, así que aquí
          todavía no hay <body> — solo se toca el <html>, que sí existe. */
    document.documentElement.setAttribute('data-theme', _leer());

    /* 1b) El botón también se define AQUÍ, una sola vez ────────────────────
          Estaba escrito a mano en 31 páginas, y en las que no lo traían —el hub,
          entre ellas— salía un botón del navegador, sin forma, pegado abajo a la
          izquierda y EN EL FLUJO de la página: se iba con el scroll, que es lo
          contrario de lo que sirve un interruptor de tema.

          Va inyectado desde el <head>, antes que los estilos de cada página: así
          una pantalla que necesite moverlo o esconderlo —Organigrama lo esconde—
          sigue mandando sobre esto.

          Los colores llevan respaldo porque no todas las pantallas nombran igual
          sus variables: styles.css usa --surface/--border, y el hub y el panel de
          plataforma traen las suyas (--s1/--b1). Con una sola de las dos, el
          botón salía transparente justo donde más se notaba. */
    (function () {
        var st = document.createElement('style');
        st.id = 'etx-theme-css';
        st.textContent =
            '.theme-toggle{position:fixed;bottom:26px;right:22px;z-index:999;' +
            '  background:var(--surface,var(--s1,#141210));' +
            '  border:1px solid var(--border,var(--b1,#2a2825));' +
            '  border-radius:50px;padding:8px 16px;cursor:pointer;' +
            "  font-family:'DM Sans',system-ui,sans-serif;font-size:12px;" +
            '  color:var(--text-muted,var(--muted,#7a7570));' +
            '  display:flex;align-items:center;gap:6px;' +
            '  box-shadow:0 2px 12px rgba(0,0,0,.28);transition:border-color .2s,color .2s}' +
            '.theme-toggle:hover{border-color:var(--green,#3dbe7a);color:var(--green,#3dbe7a)}' +
            /* El aviso de sesión por vencer vive en bottom:80px: se apilan, no se
               encima uno al otro. */
            '@media print{.theme-toggle{display:none}}';
        (document.head || document.documentElement).appendChild(st);
    })();

    /* 2) El botón: icono y palabra dicen A DÓNDE se va, no dónde se está. */
    function _sincronizarBoton() {
        var luz = _actual() === 'light';
        var i = document.getElementById('themeIcon');
        var l = document.getElementById('themeLabel');
        if (i) i.textContent = luz ? '🌙' : '☀️';
        if (l) l.textContent = luz ? 'Modo oscuro' : 'Modo claro';
    }

    /* 3) Aplicar sin guardar: para cuando el cambio viene de OTRO documento y
          ya quedó guardado allá. Volver a escribirlo dispararía un ida y vuelta
          sin final entre las pestañas. */
    function _aplicar(tema) {
        var t = tema === 'light' ? 'light' : 'dark';
        if (_actual() === t) return;
        document.documentElement.setAttribute('data-theme', t);
        _sincronizarBoton();
        try { window.dispatchEvent(new CustomEvent('etaax:theme', { detail: { tema: t } })); }
        catch (e) {}
    }

    function _poner(tema) {
        var t = tema === 'light' ? 'light' : 'dark';
        try { localStorage.setItem(CLAVE, t); } catch (e) {}
        /* Se aplica aunque no cambie el atributo (p. ej. si ya venía puesto),
           porque quien llama espera que el aviso salga. */
        if (_actual() !== t) { _aplicar(t); }
        else { _sincronizarBoton(); }
    }

    window.toggleTheme = function () { _poner(_actual() === 'dark' ? 'light' : 'dark'); };
    window.EtaaxTheme = { actual: _actual, set: _poner, toggle: window.toggleTheme, CLAVE: CLAVE };

    /* 4) El cambio hecho en otro lado llega aquí. El navegador dispara `storage`
          en todos los documentos del mismo origen MENOS en el que lo escribió:
          exactamente lo que hace falta para que la página de atrás siga a su
          ventana flotante, y una pestaña a otra. */
    window.addEventListener('storage', function (e) {
        if (!e || e.key !== CLAVE) return;
        _aplicar(e.newValue === 'light' ? 'light' : 'dark');
    });

    /* 5) Al cargar: sincronizar el botón y, si la página no trae uno, ponerlo.
          Las páginas embebidas (?embed=1) NO llevan botón propio: dentro de una
          ventana flotante estorba, y el de la página de atrás ya manda sobre las
          dos. */
    document.addEventListener('DOMContentLoaded', function () {
        _sincronizarBoton();
        if (document.querySelector('.theme-toggle')) return;
        if (/[?&]embed=1/.test(window.location.search)) return;
        if (!document.body) return;   // documento sin cuerpo (arneses, vistas parciales)
        var b = document.createElement('button');
        b.className = 'theme-toggle';
        b.type = 'button';
        b.addEventListener('click', window.toggleTheme);
        b.innerHTML = '<span id="themeIcon">☀️</span><span id="themeLabel">Modo claro</span>';
        document.body.appendChild(b);
        _sincronizarBoton();
    });
})();
