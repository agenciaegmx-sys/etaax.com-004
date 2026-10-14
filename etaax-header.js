/* ============================================================================
   ETAAX — LA BARRA DE ARRIBA, UNA SOLA PARA TODO EL SISTEMA

   Cada pantalla traía la suya: unas con el logo a la izquierda, otras con una
   miga de pan, otras con botones sueltos. El resultado se nota al navegar —la
   barra "brinca" de pantalla en pantalla— y se paga al cambiar algo: media
   docena de archivos por un botón.

   Esta es la única. Se pide así, desde el final del <body>:

       <script src="/etaax-header.js"></script>
       <script>etaaxHeader({ seccion: 'Recetas' });</script>

   QUÉ TRAE, Y POR QUÉ CADA COSA

     · El LOGO y qué es esto. En una pantalla sin contexto —alguien que abre un
       enlace— el logo solo dice la marca; el descriptor dice el oficio.
     · INICIO, siempre en el mismo lugar. Es la salida de emergencia: desde
       cualquier rincón, un clic para volver a elegir negocio o módulo.
     · EL TEMA, a un toque. Y con tres estados, no dos: claro, oscuro y el del
       dispositivo, que es el que sirve a quien usa el sistema de día en la
       barra y de noche en la oficina.
     · LA CUENTA, con lo que de verdad hace falta saber antes de tocar algo:
       quién eres, en qué negocio estás y con qué plan. Esa es la pregunta que
       se hace cualquiera que administra más de un negocio, y hasta hoy había
       que adivinarla por el color de la pantalla.

   VA FIJA. Al bajar por un inventario de doscientos renglones, la barra se
   quedaba arriba, fuera de la vista: para volver al hub había que subir hasta
   el principio. Fija, la salida está siempre a la mano — y en una tablet, donde
   no hay atajos de teclado, eso es la diferencia entre volver y recargar.
   ============================================================================ */
(function () {
    var ID = 'etaax-header';
    var escuchando = false;
    var observador = null;
    var marcaBase = '/marca';

    function marcaDelTema() {
        var claro = window.EtaaxTheme && EtaaxTheme.actual() === 'light';
        return marcaBase + '/etaax-logo-' + (claro ? 'claro' : 'oscuro') + '.svg';
    }

    function _ctx() {
        var c = null, s = null;
        try { c = JSON.parse(localStorage.getItem('etaax_ctx') || 'null'); } catch (e) {}
        try { s = JSON.parse(sessionStorage.getItem('etaax_sesion_hub') || 'null'); } catch (e) {}
        return { ctx: c || {}, ses: s || {} };
    }
    function esc(x) {
        return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function ic(nombre, tam) {
        return (typeof etaaxIcono === 'function') ? etaaxIcono(nombre, { tam: tam || 18 }) : '';
    }

    function _estilos() {
        if (document.getElementById(ID + '-css')) return;
        var st = document.createElement('style');
        st.id = ID + '-css';
        st.textContent = [
            /* FIJA: queda arriba pase lo que pase con el scroll. El `body` gana
               un espacio equivalente para que no se le coma el primer renglón
               a la página (es la trampa clásica de una barra fija). */
            '.etx-hd{position:fixed;top:0;left:0;right:0;z-index:900;',
            '  display:flex;align-items:center;gap:18px;padding:10px 20px;',
            '  background:var(--s1,var(--surface,#141210));',
            '  border-bottom:1px solid var(--ui-borde,var(--border,#2e2c29));',
            "  font-family:'DM Sans',system-ui,sans-serif;}",
            'body.etx-con-hd{padding-top:var(--etx-header-h,70px);}',
            'body.etx-con-hd .theme-toggle{display:none;}',
            '.etx-hd-marca{display:flex;align-items:center;gap:12px;flex-shrink:0;}',
            '.etx-hd-marca img{height:19px;display:block;}',
            '.etx-hd-que{font-size:11px;line-height:1.3;color:var(--ui-apagado,var(--text-muted,#9a948b));',
            '  border-left:1px solid var(--ui-borde,var(--border,#2e2c29));padding-left:12px;}',
            '.etx-hd-centro{flex:1;display:flex;justify-content:center;}',
            '.etx-hd-der{display:flex;align-items:center;gap:10px;flex-shrink:0;}',
            /* Botones: todos iguales, porque todos hacen lo mismo — llevar a
               algún lado. El de inicio lleva texto; los demás, solo dibujo. */
            '.etx-hd-btn{display:inline-flex;align-items:center;gap:8px;',
            '  background:transparent;border:1px solid var(--ui-borde,var(--border,#2e2c29));',
            '  color:var(--text,#f0ece4);border-radius:10px;padding:8px 14px;',
            '  font:inherit;font-size:13px;cursor:pointer;text-decoration:none;',
            '  transition:border-color .18s,background .18s;}',
            '.etx-hd-btn:hover{border-color:var(--green,#3dbe7a);background:rgba(61,190,122,.08);}',
            '.etx-hd-icon{padding:8px;min-width:38px;justify-content:center;}',
            '.etx-hd-cuenta{display:inline-flex;align-items:center;gap:10px;text-align:left;}',
            '.etx-hd-avatar{width:30px;height:30px;border-radius:50%;flex-shrink:0;',
            '  background:var(--s2,var(--surface2,#232220));border:1px solid var(--ui-borde,var(--border,#2e2c29));',
            '  display:flex;align-items:center;justify-content:center;overflow:hidden;}',
            '.etx-hd-avatar img{width:100%;height:100%;object-fit:cover;}',
            '.etx-hd-quien{font-size:12.5px;font-weight:600;color:var(--text,#f0ece4);line-height:1.2;}',
            '.etx-hd-estado{font-size:10.5px;color:var(--ui-apagado,var(--text-muted,#9a948b));',
            '  display:flex;align-items:center;gap:5px;margin-top:2px;}',
            '.etx-hd-punto{width:6px;height:6px;border-radius:50%;background:var(--green,#3dbe7a);}',
            /* El menú ────────────────────────────────────────────────── */
            '.etx-hd-menu{position:absolute;top:calc(100% + 8px);right:18px;min-width:268px;',
            '  max-width:calc(100vw - 24px);max-height:calc(100dvh - var(--etx-header-h,70px) - 20px);overflow-y:auto;',
            '  background:var(--s1,var(--surface,#141210));',
            '  border:1px solid var(--ui-borde,var(--border,#2e2c29));border-radius:14px;',
            '  box-shadow:0 18px 50px rgba(0,0,0,.45);padding:8px;display:none;}',
            '.etx-hd-menu.abierto{display:block;}',
            '.etx-hd-menu-cab{padding:12px 12px 10px;border-bottom:1px solid var(--ui-borde,var(--border,#2e2c29));margin-bottom:6px;}',
            '.etx-hd-menu-dato{font-size:11.5px;color:var(--ui-apagado,var(--text-muted,#9a948b));margin-top:4px;}',
            '.etx-hd-menu-dato b{color:var(--text,#f0ece4);font-weight:500;}',
            '.etx-hd-op{display:flex;align-items:center;gap:11px;width:100%;',
            '  background:transparent;border:none;border-radius:9px;padding:10px 12px;',
            '  color:var(--text,#f0ece4);font:inherit;font-size:13px;cursor:pointer;text-align:left;',
            '  text-decoration:none;}',
            '.etx-hd-op:hover{background:var(--s2,var(--surface2,#232220));}',
            /* Un punto verde al lado de «Novedades» cuando hay algo sin leer.
               Sin él, la entrada es un enlace más que nadie abre: lo que avisa
               no es la palabra, es que algo cambió de color. */
            '.etx-hd-nuevo{width:7px;height:7px;border-radius:50%;background:var(--green,#3dbe7a);',
            '  margin-left:auto;flex-shrink:0;}',
            '.etx-hd-aviso{position:absolute;top:7px;right:7px;width:8px;height:8px;border-radius:50%;',
            '  background:var(--green,#3dbe7a);border:2px solid var(--s1,var(--surface,#141210));}',
            '.etx-hd-cuenta{position:relative;}',
            '.etx-hd-op.sale:hover{color:var(--red,#e05a3a);}',
            '.etx-hd-btn:focus-visible,.etx-hd-op:focus-visible{outline:2px solid var(--green,#3dbe7a);outline-offset:3px;}',
            '@media (max-width:720px){ .etx-hd-que,.etx-hd-cuenta .etx-hd-quien,.etx-hd-cuenta .etx-hd-estado{display:none} ',
            '  .etx-hd{gap:8px;padding:8px 12px}.etx-hd-cuenta{padding:6px;gap:5px}.etx-hd-der{gap:6px}',
            '  .etx-hd-menu{right:12px} body.etx-con-hd{padding-top:var(--etx-header-h,59px)} }',
            '@media (max-width:390px){.etx-hd{gap:6px;padding-left:10px;padding-right:10px}',
            '  .etx-hd-marca img{height:17px}.etx-hd-centro .etx-hd-btn{padding:8px 10px}}',
            '@media print{ .etx-hd{display:none} body.etx-con-hd{padding-top:0} }'
        ].join('');
        (document.head || document.documentElement).appendChild(st);
    }

    function _alto(el) {
        // La cuenta, la fuente y el viewport cambian el alto: medir evita que el
        // primer renglón quede tapado por los antiguos 64px escritos a mano.
        function medir() {
            var h = el.getBoundingClientRect ? Math.ceil(el.getBoundingClientRect().height) : 0;
            if (h && document.documentElement.style) document.documentElement.style.setProperty('--etx-header-h', h + 'px');
        }
        medir();
        if (!observador && typeof ResizeObserver === 'function') {
            observador = new ResizeObserver(medir);
            observador.observe(el);
        }
        if (!observador && !el._etxMide) {
            el._etxMide = true;
            window.addEventListener('resize', medir);
        }
    }

    function _destinoCuenta(ruta) {
        var volver = (window.location.pathname || '/hub.html') + (window.location.search || '');
        if (/\/(mi-cuenta|plan-facturacion)\.html$/.test(window.location.pathname || '')) {
            volver = new URLSearchParams(window.location.search || '').get('volver') || '/hub.html';
        }
        return ruta + '?volver=' + encodeURIComponent(volver);
    }

    /* El icono del tema dice EN QUÉ ESTÁS, no a dónde vas: con tres estados,
       «a dónde vas» ya no se puede adivinar de un vistazo. */
    function _icTema() {
        var e = (window.EtaaxTheme && EtaaxTheme.elegido) ? EtaaxTheme.elegido() : 'dark';
        return e === 'auto' ? 'hd-sistema' : (e === 'light' ? 'hd-sol' : 'hd-luna');
    }

    window.etaaxHeader = function (opc) {
        opc = opc || {};
        // El hub prueba otra paleta; los módulos mantienen su marca habitual.
        marcaBase = opc.marcaBase || (opc.base || '') + '/marca';
        _estilos();
        var d = _ctx();
        var quien = opc.usuario || d.ctx.userName || d.ses.nombre || 'Mi cuenta';
        var negocio = opc.negocio || d.ctx.negNombre || '';
        var plan = opc.plan || d.ctx.userBadge || '';
        var logo = opc.logo || '';
        var inicio = opc.inicio || '/hub.html';
        /* QUÉ DICE EL BOTÓN. Desde dentro de un módulo, «Inicio» era una
           promesa vaga: llevaba al selector de sucursales, no a donde uno
           espera volver. Las páginas de módulo lo nombran «Módulos» y lo
           mandan al hub de módulos, que es de donde se entró. Un botón de
           navegación tiene que decir su destino, no su jerarquía. */
        var inicioTexto = opc.inicioTexto || 'Inicio';
        /* ¿HAY SESIÓN? No es un detalle: un punto verde latiendo junto a
           «Sesión activa» cuando nadie entró es exactamente la mentira que ya
           se había quitado de la barra vieja del hub. Un indicador que dice que
           sí cuando es que no es peor que no tener indicador. */
        var activa = (opc.activa === undefined) ? true : !!opc.activa;

        /* ¿Esta página sabe de novedades? Se pregunta, no se asume: el header
           es el mismo para todas y no todas cargan el anuncio. */
        var hayNov  = !!(window.EtaaxNovedades && EtaaxNovedades.abrir);
        var novPend = hayNov && activa && EtaaxNovedades.pendiente();

        var el = document.getElementById(ID);
        if (!el) {
            el = document.createElement('header');
            el.id = ID;
            el.className = 'etx-hd';
            document.body.insertBefore(el, document.body.firstChild);
            document.body.classList.add('etx-con-hd');
        }
        el.innerHTML =
            '<div class="etx-hd-marca">' +
                '<img id="etxHdMarca" src="' + esc(marcaDelTema()) + '" alt="ETAAX">' +
                '<div class="etx-hd-que">ERP para alimentos<br>y bebidas</div>' +
            '</div>' +
            '<div class="etx-hd-centro">' +
                '<a class="etx-hd-btn" href="' + esc(inicio) + '">' + ic('hd-inicio', 18) + esc(inicioTexto) + '</a>' +
            '</div>' +
            '<div class="etx-hd-der">' +
                '<button class="etx-hd-btn etx-hd-icon" id="etxHdTema" title="Tema">' + ic(_icTema(), 18) + '</button>' +
                '<button class="etx-hd-btn etx-hd-cuenta" id="etxHdCuenta" aria-label="Menú de cuenta" aria-expanded="false" aria-controls="etxHdMenu">' +
                    '<span class="etx-hd-avatar">' +
                        (logo ? '<img src="' + esc(logo) + '" alt="">' : ic('perfil', 18)) +
                    '</span>' +
                    '<span><span class="etx-hd-quien">' + esc(quien) + '</span>' +
                    '<span class="etx-hd-estado">' +
                        '<i class="etx-hd-punto"' + (activa ? '' : ' style="background:var(--dim,#4a4844)"') + '></i>' +
                        (activa ? 'Sesión activa' : 'Sin sesión') +
                    '</span></span>' +
                    ic('hd-desplegar', 14) +
                    (novPend ? '<i class="etx-hd-aviso" title="Hay novedades"></i>' : '') +
                '</button>' +
            '</div>' +
            '<div class="etx-hd-menu" id="etxHdMenu">' +
                '<div class="etx-hd-menu-cab">' +
                    '<div class="etx-hd-quien" style="font-size:14px">' + esc(quien) + '</div>' +
                    (negocio ? '<div class="etx-hd-menu-dato">Negocio: <b>' + esc(negocio) + '</b></div>' : '') +
                    (plan ? '<div class="etx-hd-menu-dato">Plan: <b>' + esc(plan) + '</b></div>' : '') +
                '</div>' +
                (activa ? '<a class="etx-hd-op" id="etxHdCuentaOp" href="' + esc(_destinoCuenta('/mi-cuenta.html')) + '">' + ic('usuario', 18) + 'Mi cuenta</a>' +
                          '<a class="etx-hd-op" id="etxHdPlanOp" href="' + esc(_destinoCuenta('/plan-facturacion.html')) + '">' + ic('org-corporativo', 18) + 'Plan y facturación</a>' : '') +
                /* NOVEDADES. Va aquí y no en un cartel permanente: el anuncio
                   grande se muestra una vez, y después esta entrada es la forma
                   de volver a verlo —«¿qué era lo que había cambiado?»— sin
                   tener que preguntarle a nadie. Solo aparece si la página
                   cargó /novedades.js. */
                (hayNov ? '<button class="etx-hd-op" id="etxHdNovOp">' + ic('catalogos', 18) + 'Novedades' +
                          (novPend ? '<i class="etx-hd-nuevo"></i>' : '') + '</button>' : '') +
                '<button class="etx-hd-op" id="etxHdAutoOp">' + ic('hd-sistema', 18) + 'Usar tema del dispositivo</button>' +
                /* Sin sesión no se ofrece salir ni ver la cuenta: serían dos
                   botones que no llevan a ningún lado. */
                (activa ? '<button class="etx-hd-op sale" id="etxHdSalirOp">' + ic('cerrar-sesion', 18) + 'Cerrar sesión</button>' : '') +
            '</div>';

        var menu = document.getElementById('etxHdMenu');
        var cerrar = function () {
            var m = document.getElementById('etxHdMenu'), b = document.getElementById('etxHdCuenta');
            if (m) m.classList.remove('abierto');
            if (b && b.setAttribute) b.setAttribute('aria-expanded', 'false');
        };
        document.getElementById('etxHdCuenta').onclick = function (e) {
            e.stopPropagation();
            menu.classList.toggle('abierto');
            this.setAttribute('aria-expanded', String(menu.classList.contains('abierto')));
        };
        /* Un menú que solo se cierra con su propio botón se queda abierto
           encima de lo que vas a tocar. Se cierra al tocar fuera y con Escape. */
        if (!escuchando) {
            escuchando = true;
            document.addEventListener('click', cerrar);
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    var abierto = document.getElementById('etxHdMenu').classList.contains('abierto');
                    cerrar();
                    if (abierto) document.getElementById('etxHdCuenta').focus();
                }
            });
            window.addEventListener('etaax:theme', function () {
                var b = document.getElementById('etxHdTema');
                if (b) b.innerHTML = ic(_icTema(), 18);
                var marca = document.getElementById('etxHdMarca');
                if (marca) marca.setAttribute('src', marcaDelTema());
            });
        }
        menu.onclick = function (e) { e.stopPropagation(); };

        document.getElementById('etxHdTema').onclick = function () {
            if (window.toggleTheme) toggleTheme();
            document.getElementById('etxHdTema').innerHTML = ic(_icTema(), 18);
        };
        document.getElementById('etxHdAutoOp').onclick = function () {
            if (window.EtaaxTheme && EtaaxTheme.auto) EtaaxTheme.auto();
            document.getElementById('etxHdTema').innerHTML = ic(_icTema(), 18);
            cerrar();
        };
        var liga = function (id, fn, destino) {
            var b = document.getElementById(id);
            if (!b) return;
            b.onclick = function (e) {
                cerrar();
                if (typeof fn === 'function') { if (e) e.preventDefault(); fn(); return; }
                if (b.tagName === 'A') return;
                if (destino) window.location.href = destino;
            };
        };
        liga('etxHdNovOp', function () {
            /* Desde el menú se abre la presentación completa, no el aviso: quien
               la pide ya sabe lo que quiere ver. */
            if (window.EtaaxNovedades) EtaaxNovedades.abrir(0);
            var p = document.querySelector('.etx-hd-aviso');
            if (p && p.parentNode) p.parentNode.removeChild(p);
        });
        liga('etxHdCuentaOp', opc.miCuenta, _destinoCuenta('/mi-cuenta.html'));
        liga('etxHdPlanOp',   opc.planYFacturacion, _destinoCuenta('/plan-facturacion.html'));
        liga('etxHdSalirOp',  opc.cerrarSesion || window.ctxSalir || window.logout);
        _alto(el);
        return el;
    };
})();
