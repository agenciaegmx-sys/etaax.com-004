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

    /* TRES ESTADOS, NO DOS: claro, oscuro y «el del dispositivo». El tercero no
       es un capricho — un sistema que se usa de día en la barra y de noche en
       la oficina sigue al teléfono sin que nadie toque nada.

       OJO con el valor por defecto: sin nada guardado se arranca OSCURO, no en
       automático. Cambiar eso haría que a quien nunca eligió se le moviera el
       tema solo, y lo leería como un error de la app. El automático es una
       decisión que se toma a propósito. */
    function _guardado() {
        try {
            var v = localStorage.getItem(CLAVE);
            return (v === 'light' || v === 'dark' || v === 'auto') ? v : 'dark';
        } catch (e) { return 'dark'; }
    }
    function _delDispositivo() {
        try {
            return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
                ? 'light' : 'dark';
        } catch (e) { return 'dark'; }
    }
    /* Lo que se PINTA. El `auto` se resuelve aquí y en ningún otro lado. */
    function _leer() {
        var v = _guardado();
        return v === 'auto' ? _delDispositivo() : v;
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

    /* 1c) EL WORDMARK SIGUE AL TEMA ───────────────────────────────────────
          El logo existe en dos versiones —letras crema para fondos oscuros,
          letras tinta para claros— y las 38 páginas pedían SIEMPRE la oscura.
          En modo claro quedaba crema sobre blanco: invisible, salvo las contras
          de la «e» y las «a», que iban pintadas del color del fondo oscuro y se
          veían como tres manchas sueltas. (Eso ya está arreglado en el propio
          archivo: ahora son huecos de verdad.)

          Se hace aquí y no en cada página por lo de siempre: 38 copias de una
          regla son 38 oportunidades de que una se quede atrás. Y se cambia el
          `src` en vez de poner la imagen de fondo con CSS porque el logo vive
          en <img> con su texto alternativo, y un fondo no se lee en voz alta.

          OJO con el papel: un reporte impreso va sobre blanco SIEMPRE, sin
          importar el tema de la pantalla. Por eso se respeta cualquier logo
          marcado con `data-logo="fijo"`, que es como se pide «este no cambia». */
    function _logoDelTema() {
        /* Este archivo corre lo más arriba posible del <head> y en documentos de
           todas las formas —páginas completas, vistas parciales, arneses—. Si no
           hay dónde buscar, no hay nada que cambiar: se sale sin ruido, como el
           resto de este archivo. */
        if (!document.querySelectorAll) return;
        var luz = _actual() === 'light';
        var cual = luz ? 'claro' : 'oscuro';
        var imgs = document.querySelectorAll('img[src*="/marca/etaax-logo-"]');
        for (var i = 0; i < imgs.length; i++) {
            if (imgs[i].getAttribute('data-logo') === 'fijo') continue;
            var src = imgs[i].getAttribute('src') || '';
            var quiere = src.replace(/etaax-logo-(claro|oscuro)\.svg/, 'etaax-logo-' + cual + '.svg');
            if (quiere !== src) imgs[i].setAttribute('src', quiere);
        }
    }

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
        _logoDelTema();
        try { window.dispatchEvent(new CustomEvent('etaax:theme', { detail: { tema: t } })); }
        catch (e) {}
    }

    function _poner(tema) {
        /* Se GUARDA lo elegido —incluido 'auto'— y se PINTA lo resuelto: son
           dos cosas distintas y confundirlas es lo que hace que «seguir al
           dispositivo» se pierda en la siguiente carga. */
        var elegido = (tema === 'light' || tema === 'auto') ? tema : 'dark';
        try { localStorage.setItem(CLAVE, elegido); } catch (e) {}
        var t = elegido === 'auto' ? _delDispositivo() : elegido;
        /* Se aplica aunque no cambie el atributo (p. ej. si ya venía puesto),
           porque quien llama espera que el aviso salga. */
        if (_actual() !== t) { _aplicar(t); }
        else { _sincronizarBoton(); _logoDelTema(); }
    }

    window.toggleTheme = function () { _poner(_actual() === 'dark' ? 'light' : 'dark'); };
    window.EtaaxTheme = {
        actual: _actual,              // lo que se está viendo: 'light' | 'dark'
        elegido: _guardado,           // lo que la persona eligió: + 'auto'
        set: _poner, toggle: window.toggleTheme, CLAVE: CLAVE,
        /* Seguir al dispositivo. Se guarda 'auto' y se pinta lo que diga el
           sistema EN ESE MOMENTO; si el teléfono cambia después, el oyente de
           abajo lo repinta solo. */
        auto: function () { _poner('auto'); }
    };

    /* El dispositivo cambia de tema (anochece, o el usuario lo cambia en su
       sistema): solo se sigue a quien eligió «auto». A quien decidió claro u
       oscuro no se le mueve nada. */
    try {
        if (window.matchMedia) {
            var mq = window.matchMedia('(prefers-color-scheme: light)');
            var seguir = function () { if (_guardado() === 'auto') _aplicar(_delDispositivo()); };
            if (mq.addEventListener) mq.addEventListener('change', seguir);
            else if (mq.addListener) mq.addListener(seguir);
        }
    } catch (e) {}

    /* 4) El cambio hecho en otro lado llega aquí. El navegador dispara `storage`
          en todos los documentos del mismo origen MENOS en el que lo escribió:
          exactamente lo que hace falta para que la página de atrás siga a su
          ventana flotante, y una pestaña a otra. */
    window.addEventListener('storage', function (e) {
        if (!e || e.key !== CLAVE) return;
        _aplicar(e.newValue === 'auto' ? _delDispositivo()
                 : (e.newValue === 'light' ? 'light' : 'dark'));
    });

    /* 5) Al cargar: sincronizar el botón y, si la página no trae uno, ponerlo.
          Las páginas embebidas (?embed=1) NO llevan botón propio: dentro de una
          ventana flotante estorba, y el de la página de atrás ya manda sobre las
          dos. */
    document.addEventListener('DOMContentLoaded', function () {
        _sincronizarBoton();
        _logoDelTema();
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
