/* ============================================================
   ETAAX — Aviso de actualizaciones del sistema

   Netlify publica en cuanto se hace push, así que el negocio se encuentra
   cambios sin que nadie le diga nada: un botón nuevo, una columna que antes no
   estaba. Este aviso lo cuenta UNA vez por publicación y por navegador.

   La fecha de abajo la estampa solo el hook .githooks/pre-commit en cada
   commit — no se escribe a mano, justamente porque es lo primero que se olvida.

   ── DOS CAPAS, Y NUNCA LAS DOS A LA VEZ ───────────────────────────────────

     1. EL AVISITO de siempre (abajo): «hubo actualizaciones hace tres días».
        Sale solo, en cada publicación, sin que nadie escriba nada. Es la red
        de abajo: sirve para los cambios chicos, que son casi todos.

     2. LA PRESENTACIÓN (la segunda mitad del archivo): un recuadro grande
        —«hicimos una actualización importante, ve las novedades»— con una
        novedad por pantalla y su captura. Esta sí se escribe a mano, porque
        una lista de novedades que se genera sola no le dice nada a nadie.

   Si hay una presentación pendiente, el avisito NO sale: anunciar lo mismo dos
   veces en la misma entrada —una esquina y un recuadro— es la forma más rápida
   de enseñarle a alguien a cerrar los avisos sin leerlos. Cuando ya se vio la
   presentación, el avisito vuelve a ser el de siempre.
   ============================================================ */
(function () {
    var FECHA = '2026-10-15';          /* ETAAX_DEPLOY — la estampa el hook */

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

    /* Una novedad deja de ser novedad. Pasados estos días el aviso no sale más,
       lo hayas cerrado o no: antes solo callaba si le dabas "Entendido", así que
       a quien lo ignoraba lo perseguía en cada sesión hasta el siguiente deploy.
       Eso ya no es avisar, es estorbar. */
    var VIGENCIA_DIAS = 2;

    /* Devuelve QUÉ decidió —'presentacion', 'avisito' o '' — y no solo porque
       quede bonito: las dos capas se muestran con un temporizador, así que
       desde fuera son indistinguibles hasta que aparecen en pantalla. Sin este
       dato, el candado no podría comprobar la única regla que las separa (que
       nunca salgan las dos en la misma entrada) y la regla viviría solo en el
       comentario de arriba. */
    function _arrancar() {
        /* La presentación va primero, y si sale, el avisito se calla. */
        /* SOLO DESDE LA ENTRADA. Se ofrece en el hub, que es por donde se
           inicia sesión; en una herramienta no, porque abrir Inventarios para
           contar existencias no es entrar al sistema — es estar trabajando, y
           ahí un recuadro que cubre la pantalla no es una noticia, es una
           interrupción. El hub lo pide a mano con `quizas({sesion:true})`; esto
           cubre una recarga de esa misma pantalla. */
        if (ANUNCIAR && _anuncioVigente() && _haySesion()) {
            if (_esLaEntrada() && !_aplazada()) {
                setTimeout(function(){ quizas({ sesion: true }); }, 900);
                return 'presentacion';
            }
            /* Mientras la actualización grande está vigente, el avisito calla en
               TODAS las pantallas, no solo donde sale la presentación. Si no,
               quien ya la vio en el hub se encuentra el mismo anuncio en chico
               en cada herramienta que abre: la misma noticia dos veces, que es
               como se le enseña a alguien a cerrar los avisos sin leerlos. */
            return '';
        }
        if (_diasDesde(FECHA) > VIGENCIA_DIAS) return '';   // ya es historia
        if (_yaSes(SESION) === FECHA) return '';  // ya se dio por enterado en esta sesión
        if (_ya(VISTO)   === FECHA) return '';    // y en una sesión anterior, también
        /* Un respiro antes de aparecer: entrar a una pantalla y que algo salte de
           inmediato se siente como un error, no como una noticia. */
        setTimeout(_pintar, 1200);
        return 'avisito';
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _arrancar);
    else _arrancar();

    // Para probarlo sin esperar a un deploy: _novedadesDemo() en la consola.
    window._novedadesDemo = function () {
        try { localStorage.removeItem(VISTO); } catch (e) {}
        try { sessionStorage.removeItem(SESION); } catch (e) {}
        _pintar();
    };


    /* ════════════════════════════════════════════════════════════════════════
       CAPA 2 · LA PRESENTACIÓN DE LA ACTUALIZACIÓN GRANDE

       DOS PASOS, A PROPÓSITO

         1. EL AVISO. Un recuadro grande al entrar: qué pasó y dos salidas
            —verlo ahora o después—. No se cuela a media captura de ventas.
         2. LAS NOVEDADES. Una por pantalla. Sin cuenta regresiva y sin
            reproducción automática: avanza quien lee, no el reloj.

       CUÁNDO SE DEJA DE MOSTRAR, Y CUÁNDO VUELVE

         · Se marca como vista cuando la persona LLEGÓ AL FINAL o dijo
           «Listo». Si cierra a la mitad se le vuelve a ofrecer: cerrar no es
           haber leído.
         · «Después» no la marca —vuelve en la siguiente entrada— pero no
           insiste otra vez en la misma pestaña.
         · Al subir VERSION, todos vuelven a verla. Ese es el interruptor del
           anuncio: una línea, no diez.

       SE GUARDA POR USUARIO, NO POR DISPOSITIVO. La tablet de la barra la usan
       cuatro personas con el mismo navegador: con una sola marca, el primero
       que entrara se comería el anuncio de los demás. (El avisito de la capa 1
       sí es por navegador, y ahí está bien: no tiene contenido que leerse.)

       LAS CAPTURAS PUEDEN NO ESTAR TODAVÍA. Van en /novedades/ con el nombre
       que dice cada novedad (ver novedades/LEEME.md). Mientras no estén, la
       pantalla se arma igual: el hueco se cierra con un marco neutro del mismo
       tamaño, no con el icono de imagen rota del navegador — que es la forma
       más rápida de que una buena noticia parezca un error.
       ════════════════════════════════════════════════════════════════════════ */
    /* ── CÓMO SE LLAMA ESTA ACTUALIZACIÓN ──────────────────────────────────
       Las actualizaciones grandes llevan número y nombre. El número ordena —2.0
       es la primera después de la etapa de desarrollo— y el nombre es el que la
       gente repite: «la de Mise en Place». Un «2026.10» no se le queda a nadie.

       MISE EN PLACE es el término que todo cocinero conoce: tener todo en su
       lugar ANTES del servicio. Es exactamente lo que hizo esta versión —cada
       herramienta, cada título y cada botón en su sitio— y habla el idioma del
       negocio al que se le está anunciando.

       El NÚMERO manda también por dentro: es la marca de «ya lo vi», así que
       subirlo vuelve a anunciar a todo el mundo. Una actualización chica sube el
       decimal (2.1) y no necesita nombre. */
    var NUMERO = '2.0';
    var NOMBRE = 'Mise en Place';
    var VERSION = NUMERO;

    /* ── EL INTERRUPTOR DEL ANUNCIO ────────────────────────────────────────
       En `false` la presentación NO se ofrece sola; sigue disponible desde el
       menú de la cuenta para quien quiera verla.

       ENCENDIDA el 13-oct-2026, el día de la publicación de ETAAX 2.0 y con sus
       capturas ya en el repo. Estuvo apagada hasta este punto a propósito:
       anunciar una actualización que todavía no se publica, con los marcos
       vacíos, es peor que no anunciarla.

       Para la SIGUIENTE actualización grande: subir NUMERO y NOMBRE, cambiar la
       lista de novedades y sus capturas, y dejar esto en `true`. */
    var ANUNCIAR = true;

    /* ── CUÁNTO DURA EL ANUNCIO ────────────────────────────────────────────
       Tres días desde la publicación, y dentro de esa ventana aparece en CADA
       inicio de sesión —lo haya visto o no—, porque un anuncio que solo sale
       una vez se lo pierde quien ese día entró con prisa.

       La fecha de referencia no se escribe a mano: es la misma `FECHA` que el
       hook de pre-commit estampa en cada publicación, así que la cuenta arranca
       sola el día del push. OJO: si se vuelve a publicar dentro de esos tres
       días, la ventana se reinicia — es a propósito, la referencia es siempre
       la última publicación.

       Pasados los tres días el anuncio deja de asomarse, pero NO desaparece:
       sigue en el menú de la cuenta para quien quiera verlo o repasarlo. */
    var VIGENCIA_ANUNCIO = 3;
    function _anuncioVigente() { return _diasDesde(FECHA) <= VIGENCIA_ANUNCIO; }

    /* ── QUÉ SE ANUNCIA ────────────────────────────────────────────────────
       Orden de lectura, no de importancia técnica: primero lo que la persona
       VE al entrar (la barra, su cuenta, el tema), después lo que cambió por
       dentro (los números, el freno de seguridad). El texto es corto a
       propósito: tres renglones por novedad, porque nadie lee un párrafo en un
       recuadro que tapa su trabajo.                                         */
    /* ── QUÉ SE ANUNCIA ────────────────────────────────────────────────────
       Cada novedad puede traer VARIAS capturas: hay cosas que no se enseñan en
       una sola foto —la barra de la cuenta se entiende viendo el menú, Mi
       cuenta y Plan y facturación, en ese orden—. Van en `fotos` y se pasan con
       las flechas, igual que la guía del hub.

       El texto es corto a propósito: tres renglones por novedad, porque nadie
       lee un párrafo en un recuadro que tapa su trabajo.

       Esta lista la va dictando Edwin; se llena por partes. Una novedad sin
       fotos se muestra igual, con su marco en espera.                       */
    var NOVEDADES = [
        {
            clave: 'acceso',
            icono: 'candado',
            titulo: 'Un nuevo diseño, desde que entras',
            texto: 'La pantalla de acceso estrena cara: más clara, más legible y con ' +
                   'la identidad de ETAAX. Es el primer paso de un rediseño que ' +
                   'recorre todo el sistema.',
            fotos: ['/novedades/01-acceso.png']
        },
        {
            clave: 'barra',
            icono: 'hd-sistema',
            titulo: 'Una barra arriba, igual en todo el sistema',
            texto: 'Desde ahí puedes ver las novedades y cambiar entre modo claro y ' +
                   'oscuro —o dejar que siga al de tu dispositivo—. Está siempre a la ' +
                   'vista, porque la barra va fija.',
            fotos: ['/novedades/02-barra-1.png']
        },
        {
            clave: 'cuenta',
            icono: 'perfil',
            titulo: 'Tu cuenta, tu plan y tu salida, en un solo lugar',
            texto: 'Al iniciar sesión, el menú de arriba a la derecha dice quién eres, ' +
                   'en qué negocio estás y con qué plan. Desde ahí entras a Mi cuenta y ' +
                   'a Plan y facturación — y ahí vive ahora Cerrar sesión.',
            fotos: ['/novedades/03-cuenta-1.png', '/novedades/03-cuenta-2.png', '/novedades/03-cuenta-3.png']
        },
        {
            clave: 'sucursales',
            icono: 'sucursal',
            titulo: 'Tu organización, y el giro de cada sucursal',
            texto: 'El negocio dice qué es —PYME, corporativo, cadena, franquicia, ' +
                   'grupo mixto o CEDIS— y cada sucursal su giro, de taquería a ' +
                   'marisquería, con su logo redondo. Y antes de abrir la siguiente, ' +
                   'ya sabes cuánto costaría.',
            fotos: ['/novedades/04-sucursales.png']
        },
        {
            clave: 'globales',
            icono: 'catalogos',
            titulo: 'Los accesos globales, con su propia entrada',
            texto: 'Catálogos globales y Financiero global abren eligiendo a dónde vas: ' +
                   'insumos, recetas, proveedores, clientes y horarios de todo el ' +
                   'negocio, o los reportes consolidados de todas tus sucursales.',
            fotos: ['/novedades/05-globales-2.png', '/novedades/05-globales-3.png']
        },
        {
            clave: 'guia',
            icono: 'mod-aprende-analiza',
            titulo: 'Una guía de operación en tu inicio',
            texto: 'Cinco pasos numerados que explican por dónde se opera el negocio: ' +
                   'de administrar tus sucursales a consultar tus reportes. Para quien ' +
                   'entra por primera vez, y para quien entrena a alguien nuevo.',
            fotos: ['/novedades/05-globales-1.png']
        },
        {
            clave: 'modulos',
            icono: 'mod-control-administrativo',
            titulo: 'Tus cuatro módulos, y una vista previa de cada uno',
            texto: 'Elige el área de trabajo y mira lo que hay dentro ANTES de entrar: ' +
                   'cada herramienta enseña sus pantallas con una guía que puedes ' +
                   'recorrer. Para saber qué hace, ya no hay que abrirla.',
            fotos: ['/novedades/06-modulos-1.png', '/novedades/06-modulos-2.png']
        },
        {
            clave: 'lateral',
            icono: 'administrar',
            titulo: 'Una barra lateral para moverte dentro del módulo',
            texto: 'Todas las herramientas del módulo, siempre a la izquierda, con el ' +
                   'nombre de dónde estás. Se contrae cuando necesitas la pantalla ' +
                   'completa y vuelve con un clic.',
            fotos: ['/novedades/07-lateral.png']
        },
        {
            clave: 'cambiar',
            icono: 'sh-cambiar-negocio',
            titulo: 'Cambiar de módulo sin perder tu sucursal',
            texto: 'Desde la barra del negocio eliges otra área de trabajo y entras ' +
                   'directo a ella. El negocio y la sucursal en la que estás no se ' +
                   'mueven: solo cambias de herramientas.',
            fotos: ['/novedades/08-cambiar-1.png', '/novedades/08-cambiar-2.png']
        },
        {
            clave: 'inicio',
            icono: 'hd-inicio',
            titulo: 'Un botón para volver, siempre en el mismo sitio',
            texto: 'Al centro de la barra, a un clic de donde estés. Dentro de un ' +
                   'módulo se llama «Módulos» y te devuelve a sus herramientas; fuera, ' +
                   '«Inicio» te lleva a tus sucursales.',
            fotos: ['/novedades/09-inicio-1.png', '/novedades/09-inicio-2.png']
        },
        /* Las tres de abajo venían del rediseño y no se fotografían: no hay
           captura de «ahora el reporte lee hasta el final». Se anuncian igual,
           porque son las que cambian lo que el sistema HACE, no cómo se ve. */
        {
            clave: 'iconos',
            icono: 'restaurante',
            titulo: 'Iconos propios de ETAAX',
            texto: 'Se fueron los emojis del teléfono —que se dibujan distinto en cada ' +
                   'aparato— y entraron los iconos de la marca: mismo trazo, mismo ' +
                   'acento, y legibles en modo claro y en oscuro.',
            fotos: ['/novedades/11-iconos.png']
        },
        {
            clave: 'reportes',
            icono: 'fin-resumen-resultados',
            titulo: 'Los reportes avisan si leyeron todo',
            texto: 'Antes, si la consulta se cortaba a medio camino, el reporte ' +
                   'calculaba con la mitad de los datos y nadie se enteraba. Ahora lee ' +
                   'hasta el final y, si algo falla, lo dice en rojo — en pantalla y en ' +
                   'el impreso. El Resumen y los KPIs cuadran al peso.',
            fotos: []
        },
        {
            clave: 'seguridad',
            icono: 'candado',
            titulo: 'Freno a quien intente adivinar un NIP',
            texto: 'Las entradas por QR —conteos, checklists, capturas— ya no aceptan ' +
                   'intentos infinitos: tras varios NIP equivocados la puerta espera, y ' +
                   'la espera crece. El freno vive en el servidor, así que no se quita ' +
                   'borrando los datos del navegador.',
            fotos: []
        }
    ];

    /* ───────────────────────────────────────────────────────────────────── */

    var LLAVE   = 'etaax_novedades_vista';     // quién ya la vio (por usuario)
    var APLAZAR = 'etaax_novedades_aplazada';  // y quién dijo «después» en esta pestaña
    var abierta = false;
    var indice  = 0;
    var regreso = null;   // a dónde devolver el foco al cerrar

    function _esc(x) {
        return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    /* El icono preferido puede no existir todavía (los dibuja Edwin y entran al
       sprite cuando los sube). Se pregunta antes de pedirlo: un nombre
       desconocido deja el hueco vacío y un aviso en consola. */
    function _icn(nombre, tam) {
        if (typeof etaaxIcono !== 'function') return '';
        var hay = (typeof etaaxIconos === 'function') ? etaaxIconos() : null;
        if (hay && hay.indexOf(String(nombre)) === -1) nombre = 'restaurante';
        return etaaxIcono(nombre, { tam: tam || 20 });
    }

    /* Quién es «yo». El id del usuario es lo estable; el correo sirve de
       respaldo, y si no hay ninguno se usa un cajón aparte en vez de mezclar
       la marca de un desconocido con la de alguien con sesión. */
    function _yo() {
        var id = '';
        try {
            var c = JSON.parse(localStorage.getItem('etaax_ctx') || 'null') || {};
            id = c.userId || c.usuarioId || c.userEmail || '';
        } catch (e) {}
        if (!id) {
            try {
                var s = JSON.parse(sessionStorage.getItem('etaax_sesion_hub') || 'null') || {};
                id = s.usuarioId || s.email || '';
            } catch (e) {}
        }
        return String(id || '_sin_sesion');
    }
    function _mapa() {
        try { return JSON.parse(localStorage.getItem(LLAVE) || '{}') || {}; } catch (e) { return {}; }
    }

    function _pendiente() {
        return _mapa()[_yo()] !== VERSION;
    }
    function _vista() {
        var m = _mapa();
        m[_yo()] = VERSION;
        try { localStorage.setItem(LLAVE, JSON.stringify(m)); } catch (e) {}
    }
    function aplazar() {
        try { sessionStorage.setItem(APLAZAR, VERSION); } catch (e) {}
    }
    function _aplazada() {
        try { return sessionStorage.getItem(APLAZAR) === VERSION; } catch (e) { return false; }
    }

    /* ── Estilos ───────────────────────────────────────────────────────────
       Van en el archivo, no en cada página: el aviso se va a pedir desde el
       hub y desde los módulos, y una copia por pantalla es una copia que se
       queda vieja. Todo sale de los tokens del sistema, así que el recuadro
       funciona en claro y en oscuro sin una regla por tema.                  */
    function _estilos() {
        if (document.getElementById('etx-nov-css')) return;
        var st = document.createElement('style');
        st.id = 'etx-nov-css';
        st.textContent = [
            /* EL ACENTO NO SE ESCRIBE AQUÍ, se enruta. El hub tiene su propia
               paleta (cian de marca, terracota de acción) y los módulos siguen
               en verde; un color fijo en este archivo haría que el anuncio
               fuera la única pieza del hub que no habla su idioma. Los valores
               de respaldo son los del sistema, así que una página que no
               redefina nada sigue viéndose como siempre. */
            '.etx-nov-fondo{--etx-nov-marca:var(--green,#3dbe7a);',
            '  --etx-nov-accion:var(--green,#3dbe7a);',
            '  --etx-nov-accion-hover:var(--green,#3dbe7a);',
            '  --etx-nov-ring:rgba(61,190,122,.4);',
            '  --etx-nov-tinte:rgba(61,190,122,.08);',
            '  --etx-nov-ink:#0a0908;}',
            '.etx-nov-fondo{position:fixed;inset:0;z-index:1200;display:flex;',
            '  align-items:center;justify-content:center;padding:20px;',
            '  background:rgba(0,0,0,.62);backdrop-filter:blur(3px);',
            "  font-family:'DM Sans',system-ui,sans-serif;}",
            '.etx-nov-caja{width:100%;max-width:620px;max-height:calc(100dvh - 40px);',
            '  overflow-y:auto;background:var(--s1,#141210);color:var(--text,#f0ece4);',
            '  border:1px solid var(--ui-borde,#2e2c29);border-radius:18px;',
            '  box-shadow:0 24px 70px rgba(0,0,0,.5);padding:26px;',
            '  animation:etxNovEntra .28s ease both;}',
            '@keyframes etxNovEntra{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
            '.etx-nov-caja{position:relative;}',
            '.etx-nov-x{position:absolute;top:14px;right:14px;width:34px;height:34px;',
            '  display:inline-flex;align-items:center;justify-content:center;border-radius:50%;',
            '  background:transparent;border:1px solid var(--etx-nov-ring);color:var(--ui-apagado,#9a948b);',
            '  font-size:15px;line-height:1;cursor:pointer;transition:border-color .18s,color .18s;}',
            '.etx-nov-x:hover{border-color:var(--etx-nov-accion);color:var(--text,#f0ece4);}',
            '.etx-nov-x:focus-visible{outline:2px solid var(--etx-nov-marca);outline-offset:2px;}',
            '.etx-nov-sello{display:inline-flex;align-items:center;gap:8px;',
            '  font-size:10.5px;letter-spacing:2.4px;text-transform:uppercase;',
            '  color:var(--etx-nov-marca);border:1px solid var(--etx-nov-ring);',
            '  border-radius:999px;padding:5px 12px;margin-bottom:16px;}',
            ".etx-nov-tit{font-family:'Bebas Neue',sans-serif;font-size:clamp(26px,5vw,38px);",
            '  letter-spacing:1.2px;line-height:1.04;margin-bottom:10px;}',
            '.etx-nov-tit .g{color:var(--etx-nov-accion);}',
            '.etx-nov-txt{font-size:14px;line-height:1.72;color:var(--ui-apagado,#9a948b);}',
            '.etx-nov-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px;}',
            '.etx-nov-btn{display:inline-flex;align-items:center;gap:9px;',
            '  border-radius:10px;padding:11px 18px;font:inherit;font-size:13.5px;',
            '  cursor:pointer;border:1px solid var(--ui-borde,#2e2c29);',
            '  background:transparent;color:var(--text,#f0ece4);transition:all .18s;}',
            '.etx-nov-btn:hover{border-color:var(--etx-nov-accion);background:var(--etx-nov-tinte);}',
            '.etx-nov-btn.ppal{background:var(--etx-nov-accion);border-color:var(--etx-nov-accion);',
            '  color:var(--etx-nov-ink);font-weight:600;--etx-color:var(--etx-nov-ink);}',
            '.etx-nov-btn.ppal:hover{background:var(--etx-nov-accion-hover);filter:brightness(1.03);}',
            '.etx-nov-btn:disabled{opacity:.4;cursor:default;}',
            '.etx-nov-btn:focus-visible{outline:2px solid var(--etx-nov-marca);outline-offset:3px;}',
            /* La captura. Alto reservado SIEMPRE, con imagen o sin ella: si el
               marco crece al cargar la foto, el botón que ibas a tocar se corre
               solo y acabas pulsando otro. */
            '.etx-nov-foto{margin:18px 0 4px;border:1px solid var(--ui-borde,#2e2c29);',
            '  border-radius:12px;background:var(--s2,#232220);overflow:hidden;',
            '  aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;}',
            '.etx-nov-foto img{width:100%;height:100%;object-fit:cover;display:block;}',
            '.etx-nov-foto .falta{font-size:11.5px;letter-spacing:1.6px;text-transform:uppercase;',
            '  color:var(--dim,#6b6560);display:flex;flex-direction:column;align-items:center;gap:8px;}',
            /* Las capturas se ven ENTERAS: son fotos de pantallas y de modales,
               con proporciones que no se parecen entre sí. Recortarlas quitaría
               justo lo que se quiere enseñar. */
            '.etx-nov-foto img{object-fit:contain;background:var(--bg,#0f0e0c);}',
            '.etx-nov-fotonav{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:10px;}',
            '.etx-nov-fcuenta{font-size:11px;color:var(--ui-apagado,#9a948b);letter-spacing:.5px;}',
            '.etx-nov-fnav{display:inline-flex;align-items:center;justify-content:center;',
            '  width:30px;height:30px;border-radius:50%;cursor:pointer;background:transparent;',
            '  border:1px solid var(--etx-nov-ring);color:var(--text,#f0ece4);transition:border-color .18s,background .18s;}',
            '.etx-nov-fnav:hover{border-color:var(--etx-nov-accion);background:var(--etx-nov-tinte);}',
            '.etx-nov-fnav:focus-visible{outline:2px solid var(--etx-nov-marca);outline-offset:2px;}',
            '.etx-nov-fnav[data-foto="-1"] .etx-ic{transform:scaleX(-1);}',
            /* Los puntos: dónde vas de cuántas. Sin esto, «Siguiente» es un
               pozo sin fondo y la gente cierra para no averiguarlo. */
            '.etx-nov-pasos{display:flex;align-items:center;gap:7px;margin-right:auto;}',
            '.etx-nov-paso{width:7px;height:7px;border-radius:50%;padding:0;border:none;',
            '  background:var(--ui-borde,#2e2c29);cursor:pointer;transition:all .18s;}',
            '.etx-nov-paso.hoy{background:var(--etx-nov-accion);width:20px;border-radius:999px;}',
            '.etx-nov-paso:focus-visible{outline:2px solid var(--etx-nov-marca);outline-offset:3px;}',
            '.etx-nov-cuenta{font-size:11px;color:var(--dim,#6b6560);letter-spacing:1px;}',
            '@media (max-width:520px){.etx-nov-caja{padding:20px}.etx-nov-btns .etx-nov-btn{flex:1;justify-content:center}}',
            '@media print{.etx-nov-fondo{display:none}}'
        ].join('');
        (document.head || document.documentElement).appendChild(st);
    }

    function _fondo() {
        var f = document.getElementById('etx-nov');
        if (!f) {
            f = document.createElement('div');
            f.id = 'etx-nov';
            f.className = 'etx-nov-fondo';
            f.setAttribute('role', 'dialog');
            f.setAttribute('aria-modal', 'true');
            f.setAttribute('aria-label', 'Novedades de ETAAX');
            /* Tocar fuera = «después», no = «ya lo vi». Un clic al aire no es
               una lectura, y marcarla como vista le quitaría el anuncio a
               alguien que ni lo abrió. */
            f.addEventListener('click', function (e) { if (e.target === f) cerrar(); });
            document.body.appendChild(f);
        }
        return f;
    }

    /* EL MARCO DE LAS CAPTURAS. Una novedad puede traer varias: hay cosas que
       no se enseñan en una sola foto. Si son dos o más, aparecen sus flechas y
       su contador; con una sola no se ofrece navegación que no lleva a ningún
       lado.

       Si el archivo no está —porque la foto aún no se subió— se queda el marco
       neutro: `onerror` no borra el hueco, lo rellena, y así el recuadro mide
       lo mismo hoy que cuando lleguen las capturas. */
    var foto = 0;   // qué captura de la novedad actual se está viendo

    /* Cuántas pantallas tiene el recorrido y en cuál vamos. Una novedad sin
       captura cuenta como un paso; una de tres capturas, como tres. */
    function _pasosDe(n) { return Math.max(1, ((n && n.fotos) || []).length); }
    function _pasosTotales() {
        var t = 0;
        for (var k = 0; k < NOVEDADES.length; k++) t += _pasosDe(NOVEDADES[k]);
        return t;
    }
    function _pasoActual() {
        var t = 0;
        for (var k = 0; k < indice; k++) t += _pasosDe(NOVEDADES[k]);
        return t + foto + 1;
    }
    function _fotos(n) {
        var lista = n.fotos || (n.imagen ? [n.imagen] : []);
        /* Sin captura, sin marco. Hay mejoras que no se fotografían —un freno
           contra quien adivina un NIP, un reporte que ahora lee hasta el final—
           y un recuadro vacío al lado de su texto parecería un error, no una
           novedad sin foto. */
        if (!lista.length) return '';
        var i = Math.max(0, Math.min(lista.length - 1, foto));
        return '<div class="etx-nov-foto">' +
                   '<img src="' + _esc(lista[i]) + '" alt="' + _esc(n.titulo) + '" ' +
                   'onerror="this.parentNode.innerHTML=\'<span class=&quot;falta&quot;>' +
                   'Captura en camino</span>\'">' +
               '</div>' +
               '';   // el paso ya lo dice el sello: contarlo dos veces sobra
    }

    /* Enfocar lo que la persona va a pulsar, sin dar por hecho que está. En una
       pantalla que se repinta —o en un arnés de pruebas— pedir `.focus()` a lo
       que devuelva `getElementById` es cómo un aviso tumba la página entera. */
    function _foco(id) {
        var b = document.getElementById(id);
        if (b && typeof b.focus === 'function') { try { b.focus(); } catch (e) {} }
        return b;
    }

    /* UNA SALIDA VISIBLE. Se podía cerrar con Escape o tocando fuera, pero las
       dos son cosas que hay que SABER: quien no las conoce se siente atrapado en
       un anuncio que no pidió, y eso convierte una buena noticia en un estorbo.
       Cerrar aquí no marca la actualización como vista —vuelve a ofrecerse en la
       siguiente entrada—, salvo que ya se haya llegado al final. */
    function _cerrarBtn() {
        return '<button class="etx-nov-x" id="etxNovX" aria-label="Cerrar">✕</button>';
    }

    /* ── PASO 1 · el aviso ─────────────────────────────────────────────── */
    function avisar() {
        if (abierta) return false;
        _estilos();
        abierta = true;
        regreso = document.activeElement;
        var f = _fondo();
        f.innerHTML =
            '<div class="etx-nov-caja">' +
                _cerrarBtn() +
                '<div class="etx-nov-sello">' + _icn('restaurante', 14) +
                    'ETAAX ' + _esc(NUMERO) + ' · ' + _esc(NOMBRE) + '</div>' +
                '<div class="etx-nov-tit">Hicimos una actualización <span class="g">importante</span></div>' +
                '<div class="etx-nov-txt">Hicimos una actualización importante para mejorar tu ' +
                    'experiencia en ETAAX: un retoque al diseño —colores, botones e iconos ' +
                    'propios— y una nueva forma de navegar entre tus sucursales, tus módulos y ' +
                    'sus herramientas. De paso afinamos los reportes y la seguridad.<br><br>' +
                    /* Sin número: son las que vale la pena contar, no todas las que
                       cambiaron. Decir «son 13» invita a compararlas con lo que
                       uno esperaba, y ninguna lista gana esa comparación. */
                    '<b>¿Quieres ver las novedades?</b> Te las enseñamos con sus capturas, ' +
                    'en un par de minutos.</div>' +
                '<div class="etx-nov-btns">' +
                    '<button class="etx-nov-btn ppal" id="etxNovVer">' + _icn('flecha', 18) + 'Ver novedades</button>' +
                    '<button class="etx-nov-btn" id="etxNovLuego">Omitir novedades</button>' +
                '</div>' +
            '</div>';
        var bVer = document.getElementById('etxNovVer');
        if (bVer) bVer.onclick = function () { abrir(0); };
        var bLuego = document.getElementById('etxNovLuego');
        if (bLuego) bLuego.onclick = function () { cerrar(); };
        var bX = document.getElementById('etxNovX');
        if (bX) bX.onclick = function () { cerrar(); };
        _foco('etxNovVer');
        _teclas(true);
        return true;
    }

    /* ── PASO 2 · la presentación ──────────────────────────────────────── */
    function abrir(i, fotoYaPuesta) {
        _estilos();
        abierta = true;
        if (!regreso) regreso = document.activeElement;
        var antes = indice;
        indice = Math.max(0, Math.min(NOVEDADES.length - 1, parseInt(i, 10) || 0));
        if (indice !== antes && !fotoYaPuesta) foto = 0;   // novedad nueva: su primera foto
        var cuantas = (NOVEDADES[indice].fotos || []).length;
        foto = Math.max(0, Math.min(Math.max(0, cuantas - 1), foto));
        var n = NOVEDADES[indice];
        /* UN SOLO PAR DE BOTONES PARA TODO EL RECORRIDO. Antes la captura traía
           sus propias flechas y el recuadro sus botones: dos formas de avanzar
           en la misma tarjeta, y ninguna decía cuál llevaba más lejos.
           «Siguiente» pasa primero por las capturas de esta novedad y, cuando se
           acaban, a la novedad siguiente. «Atrás» desanda lo mismo, y por eso
           cae en la ÚLTIMA captura de la anterior: deshacer es volver por donde
           se vino, no al principio de otra cosa. */
        var fotos = n.fotos || [];
        var finFotos = (foto >= fotos.length - 1);
        var ultima = (indice === NOVEDADES.length - 1) && finFotos;
        /* Llegar a la última ES haberla visto. Si solo contara el botón
           «Listo», quien lee todo y cierra con Escape volvería a recibir el
           anuncio mañana — y eso enseña a cerrar los avisos sin leerlos. */
        if (indice === NOVEDADES.length - 1) _vista();

        var puntos = '';
        for (var k = 0; k < NOVEDADES.length; k++) {
            puntos += '<button class="etx-nov-paso' + (k === indice ? ' hoy' : '') +
                      '" data-i="' + k + '" aria-label="Novedad ' + (k + 1) + '"></button>';
        }
        var f = _fondo();
        f.innerHTML =
            '<div class="etx-nov-caja">' +
                _cerrarBtn() +
                /* El sello cuenta PASOS, no novedades: quien recorre el anuncio
                   pulsa 19 veces, así que un «1 de 13» le promete un recorrido
                   más corto del que tiene y se siente engañado a la mitad. Los
                   puntos de abajo siguen marcando las novedades. */
                '<div class="etx-nov-sello">' + _icn(n.icono, 14) +
                    'Paso ' + _pasoActual() + ' de ' + _pasosTotales() + '</div>' +
                '<div class="etx-nov-tit">' + _esc(n.titulo) + '</div>' +
                '<div class="etx-nov-txt">' + _esc(n.texto) + '</div>' +
                _fotos(n) +
                '<div class="etx-nov-btns">' +
                    '<div class="etx-nov-pasos">' + puntos + '</div>' +
                    '<button class="etx-nov-btn" id="etxNovAtras"' + (indice === 0 && foto === 0 ? ' disabled' : '') + '>Atrás</button>' +
                    (ultima
                        ? '<button class="etx-nov-btn ppal" id="etxNovListo">Listo, entendido</button>'
                        : '<button class="etx-nov-btn ppal" id="etxNovSig">Siguiente' + _icn('flecha', 18) + '</button>') +
                '</div>' +
            '</div>';

        var bX2 = document.getElementById('etxNovX');
        if (bX2) bX2.onclick = function () { cerrar(); };
        var atras = document.getElementById('etxNovAtras');
        if (atras) atras.onclick = function () {
            if (foto > 0) { foto--; abrir(indice); return; }
            if (indice === 0) return;
            var previa = NOVEDADES[indice - 1].fotos || [];
            foto = Math.max(0, previa.length - 1);   // se vuelve por donde se vino
            abrir(indice - 1, true);
        };
        var sig = document.getElementById('etxNovSig');
        if (sig) {
            sig.onclick = function () {
                if (foto < fotos.length - 1) { foto++; abrir(indice); return; }
                foto = 0;
                abrir(indice + 1, true);
            };
            _foco('etxNovSig');
        }
        var listo = document.getElementById('etxNovListo');
        if (listo) { listo.onclick = function () { _vista(); cerrar(); }; _foco('etxNovListo'); }
        var ps = f.querySelectorAll('.etx-nov-paso');
        for (var j = 0; j < ps.length; j++) {
            ps[j].onclick = function () { abrir(this.getAttribute('data-i')); };
        }
        _teclas(true);
    }

    /* Flechas para pasar, Escape para salir. En una tablet no hay teclado, pero
       en la oficina sí — y pasar siete pantallas con el ratón cansa. */
    var _oyente = null;
    function _teclas(on) {
        if (on && !_oyente) {
            _oyente = function (e) {
                if (!abierta) return;
                if (e.key === 'Escape') { cerrar(); }
                else if (e.key === 'ArrowRight' && indice < NOVEDADES.length - 1) { abrir(indice + 1); }
                else if (e.key === 'ArrowLeft' && indice > 0) { abrir(indice - 1); }
            };
            document.addEventListener('keydown', _oyente);
        }
    }

    /* EMPIEZA UNA SESIÓN. «Omitir» calla el anuncio en la sesión en curso, y esa
       marca vive en `sessionStorage` — que NO muere al cerrar sesión, solo al
       cerrar la pestaña. Sin esto, quien omitía el anuncio y volvía a entrar no
       lo veía nunca más, aunque la ventana de tres días siguiera abierta. El hub
       lo llama al dejar entrar a alguien. */
    function nuevaSesion() {
        try { sessionStorage.removeItem(APLAZAR); } catch (e) {}
        abierta = false;
    }

    function cerrar() {
        var f = document.getElementById('etx-nov');
        if (f && f.parentNode) f.parentNode.removeChild(f);
        abierta = false;
        indice = 0;
        /* Cerrar sin terminar no la marca vista, pero sí calla el aviso en esta
           pestaña: insistir en cada cambio de pantalla convierte la noticia en
           molestia. Vuelve a ofrecerse en la siguiente entrada. */
        if (_pendiente()) aplazar();
        if (regreso && typeof regreso.focus === 'function') { try { regreso.focus(); } catch (e) {} }
        regreso = null;
    }

    /* ── LA PUERTA QUE USAN LAS PANTALLAS ──────────────────────────────────
       `quizas()` es la única que decide sola. Tres candados, y los tres
       importan: sin sesión no se anuncia nada (sobre el login sería un cartel
       encima de la contraseña), nada de insistir si ya dijo «después», y nada
       de pintarse encima de sí misma si la pantalla llama dos veces.        */
    function quizas(opc) {
        opc = opc || {};
        /* La sesión se comprueba AQUÍ, no en quien llama. Antes el candado
           vivía solo en el arranque automático, así que cualquier pantalla que
           pidiera el aviso a mano —el hub lo hace— podía sacarlo sobre la
           pantalla de acceso. Un solo portero, en la única puerta. */
        if (!ANUNCIAR) return false;
        /* Dentro de la ventana se ofrece aunque ya se haya visto: eso es lo que
           significa «en cada inicio de sesión». Lo que no se hace es insistir
           dos veces en la MISMA sesión —ahí sí sería ruido—, y para eso está
           `_aplazada()`, que vive en sessionStorage y muere con la pestaña. */
        if (!_anuncioVigente()) return false;
        /* QUIÉN SABE SI HAY SESIÓN. Adivinarlo por `etaax_ctx` fallaba justo en
           la pantalla donde más importa: esa clave se escribe al ELEGIR un
           negocio, así que quien acababa de entrar y seguía en la lista de
           sucursales no tenía ninguna y el anuncio no se asomaba. El hub sí lo
           sabe —acaba de dejar entrar a alguien—, así que cuando lo afirma se le
           cree; el rastreo por almacenamiento queda de respaldo para las páginas
           que no avisan. */
        if (opc.sesion === false) return false;
        if (opc.sesion !== true && !_haySesion()) return false;
        if (abierta || _aplazada()) return false;
        return avisar();
    }

    /* ¿Hay alguien dentro? Sobre la pantalla de acceso esto sería un cartel
       encima de la contraseña. `etaax_ctx` lo escribe el hub al elegir negocio
       y lo exige el page-guard en todo módulo; la sesión del hub vive aparte,
       por pestaña. Con cualquiera de las dos, hay quien lea. */
    /* ¿Esta pantalla es la de entrar? El hub —y nada más—. */
    function _esLaEntrada() {
        var p = (window.location && window.location.pathname) || '';
        return p === '/' || /\/hub\.html$/.test(p);
    }
    function _haySesion() {
        try { if (JSON.parse(localStorage.getItem('etaax_ctx') || 'null')) return true; } catch (e) {}
        try { if (JSON.parse(sessionStorage.getItem('etaax_sesion_hub') || 'null')) return true; } catch (e) {}
        return false;
    }

    /* Asomadero para el candado: el texto que ve el negocio y la cuenta de días
       son lo único que puede salir mal en silencio (un "hace 0 días", un día de
       más por el horario de verano). */
    window.EtaaxNovedades = { FECHA: FECHA, hace: _hace, diasDesde: _diasDesde,
                              arrancar: _arrancar, VIGENCIA_DIAS: VIGENCIA_DIAS,
                              vigente: function (dias) { return dias <= VIGENCIA_DIAS; },
                              /* ── la capa de la presentación ── */
                              VERSION: VERSION,
                              NUMERO: NUMERO,
                              NOMBRE: NOMBRE,
                              /* El día del push: `ANUNCIAR = true` en el archivo.
                                 Esta puerta es para probarlo sin editar nada
                                 —y para que el candado pueda ejercer las dos
                                 posturas, encendida y apagada. */
                              anunciar: function (v) { ANUNCIAR = (v !== false); return ANUNCIAR; },
                              anunciando: function () { return ANUNCIAR; },
                              VIGENCIA_ANUNCIO: VIGENCIA_ANUNCIO,
                              vigenteAnuncio: _anuncioVigente,
                              lista: function () { return NOVEDADES.slice(); },
                              pendiente: _pendiente,
                              quizas: quizas,
                              nuevaSesion: nuevaSesion,
                              avisar: avisar,
                              abrir: abrir,
                              vista: _vista,
                              cerrar: cerrar,
                              /* Para verla otra vez sin borrar los datos del
                                 sitio a mano: olvidar() y recargar. */
                              olvidar: function () {
                                  var m = _mapa(); delete m[_yo()];
                                  try {
                                      localStorage.setItem(LLAVE, JSON.stringify(m));
                                      sessionStorage.removeItem(APLAZAR);
                                  } catch (e) {}
                              } };
})();
