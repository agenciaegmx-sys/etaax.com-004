/* Diseño compartido del espacio de sucursal. No cambia capturas ni cálculos. */
(function () {
    'use strict';
    var parametros = new URLSearchParams(location.search);
    var embebido = document.documentElement.classList.contains('embed') || parametros.get('embed') === '1' || parametros.get('solo') === '1' || (window.parent && window.parent !== window);
    document.body.classList.add('etx-module-cards');
    if (!embebido) {
        document.body.classList.add('etx-modulos-ui');
        document.documentElement.classList.add('etx-tema-en-header');
    }
    /* `portada` es a dónde lleva «Cambiar módulo»: a la PORTADA DEL MÓDULO, con
       su barra lateral y sus herramientas a la vista. Antes devolvía al hub, y
       cambiar de módulo te sacaba del espacio de trabajo para que volvieras a
       entrar — dos pantallas para un movimiento lateral. Son las portadas que
       ya existen; no se inventa ninguna ruta. */
    var MODULOS = [
        { id:'administrativo', nombre:'Admin·ax', icono:'mod-control-administrativo', portada:'/administrativo/index.html', permisos:['ventas','gastos','staff','proveedores','clientes'] },
        { id:'recetas', nombre:'Cost·ax', icono:'mod-recetas-insumos', portada:'/recetas/index.html', permisos:['recetas','insumos','inventarios','requisiciones','menu'] },
        { id:'financiero', nombre:'Fin·ax', icono:'mod-salud-financiera', portada:'/financiero/index.html', permisos:['financiero'] },
        { id:'consultoria', nombre:'Learn·ax', icono:'mod-aprende-analiza', portada:'/consultoria/index.html', permisos:[] }
    ];
    var DESCRIPCIONES = {
        'diario.html':'Operación diaria', 'staff-hub.html':'Personal y horarios', 'staff.html':'Colaboradores',
        'proveedores.html':'Abastecimiento', 'clientes.html':'Directorio de clientes', 'menu.html':'Carta y precios',
        'horarios.html':'Turnos y cobertura', 'organigrama.html':'Estructura del equipo', 'perfiles-puesto.html':'Funciones y puestos',
        'checklists.html':'Rutinas operativas', 'evaluaciones.html':'Desempeño del equipo',
        'index.html':'Costeo y escandallos', 'insumos.html':'Materias primas', 'inventarios.html':'Existencias', 'requisiciones.html':'Pedidos internos',
        'resumen.html':'Resultados del periodo', 'ventas.html':'Ingresos y metas', 'gastos-globales.html':'Egresos y nóminas',
        'cuentas-bancarias.html':'Cuentas y comisiones', 'previsiones.html':'Compromisos futuros', 'kpis.html':'Indicadores y metas', 'estadisticas.html':'Tendencias del negocio',
        'guias.html':'Manuales y tutoriales', 'ventas-productos.html':'Desempeño por producto', 'simulador-kpis.html':'Metas y escenarios'
    };
    var ctxActual = null, contextoGlobal = false, volver = '/hub.html', observadorBarra = null;
    function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
    function ic(n, t) { return typeof window.etaaxIcono === 'function' ? window.etaaxIcono(n, { tam:t || 24 }) : ''; }
    function leer(k, almacen) { try { return JSON.parse((almacen || localStorage).getItem(k) || 'null'); } catch (e) { return null; } }
    /* El Menú de la sucursal se quedó en /administrativo/menu.html (su dirección
       no cambia) pero ahora es de Recetas e Insumos, junto a Escandallos (24-nov). */
    function moduloDeRuta() {
        var p = location.pathname, id = p.split('/')[1];
        if (/^\/administrativo\/menu(\.html)?\/?$/.test(p)) id = 'recetas';
        return id;
    }
    function moduloActual() { var id = moduloDeRuta(); return MODULOS.find(function (m) { return m.id === id; }); }
    function permitido(m, c) {
        if (!m || !c || !c.negId) return false;
        /* Las apps que contrató la sucursal, para TODOS (page-guard). */
        if (m.permisos.length && typeof window.etaaxPermEnPlan === 'function' &&
            !m.permisos.some(function (p) { return window.etaaxPermEnPlan(c.negId, c.sucId, p); })) return false;
        if (c.ctxType !== 'staff' || !m.permisos.length) return true;
        return typeof window.etaaxPerm === 'function' && m.permisos.some(function (p) { return window.etaaxPerm(c.negId, c.rol || 'otro', p, c.sucId); });
    }
    /* Parte el título en dos colores: todo menos la última palabra en crema, la
       última en terracota. Solo con dos palabras o más —«Escandallos» no se
       parte— y solo si nadie lo pintó ya. El texto se vuelve a escribir desde
       `textContent`, así que no entra marcado de nadie: solo el `<span>` que
       pone esta función. */
    function bicolorTitulo() {
        if (embebido) return;
        var t = document.querySelector('.brand-title');
        if (!t || t.querySelector('.g') || t.dataset.etxBicolor) return;
        var texto = (t.textContent || '').trim();
        var corte = texto.lastIndexOf(' ');
        if (corte < 1) {
            /* Una sola palabra: no hay dónde partir, así que el acento pasa a su
               rótulo de arriba. Sin esto, «Clientes» y «Insumos» eran las dos
               únicas pantallas de una sola tinta. */
            var rotulo = t.parentElement && t.parentElement.querySelector('.brand-label');
            if (rotulo) rotulo.classList.add('g');
            return;
        }
        t.dataset.etxBicolor = '1';
        t.textContent = texto.slice(0, corte) + ' ';
        var fin = document.createElement('span');
        fin.className = 'g';
        fin.textContent = texto.slice(corte + 1);
        t.appendChild(fin);
    }

    /* ── LOS EMOJIS DE LOS BOTONES, CAMBIADOS POR LOS ICONOS DE LA MARCA ───
       Los modales de Ventas y Gastos —cortes, gastos, nóminas, caja fuerte—
       llevan emojis en sus títulos y botones. Un emoji lo dibuja el sistema
       operativo: el mismo 🏦 se ve distinto en Mac, en Windows y en un Android
       viejo, y trae su propio color, que es el único que la paleta no controla.

       Se cambian AQUÍ y no en las ocho mil líneas de `diario.html` por tres
       razones: vale para los modales que se pintan al vuelo, no toca el código
       que mueve dinero, y el día que llegue un icono nuevo se añade una línea.

       SOLO SE TOCA EL CROMO —títulos de ventana, botones y etiquetas de
       sección— y solo si el emoji ABRE el texto. Lo que escribió una persona
       (el concepto de un gasto, el nombre de un proveedor) no se toca nunca:
       ahí el emoji es dato, no decoración.                                   */
    var EMOJIS = {
        '🏦':'candado',            '🏛':'fin-cuentas-bancarias', '🏛️':'fin-cuentas-bancarias',
        '💰':'fin-ventas',         '🧾':'fin-gastos',            '📊':'fin-estadisticas',
        '🎯':'fin-kpis',           '📅':'cat-horarios',          '👥':'cat-colaboradores',
        '🚚':'cat-proveedores',    '⭐':'cat-clientes',           '📦':'mod-inventarios',
        '🔒':'candado',            '🌐':'org-corporativo',       '🏪':'sucursal',
        '📈':'fin-estadisticas',   '💳':'fin-cuentas-bancarias', '🍽':'restaurante',
        '🍽️':'restaurante'
    };
    /* Dónde sí: lo que es interfaz. Dónde no: celdas de tabla y campos. */
    var CROMO = 'button, .dx-win-title, .dx-card-title, .cf-card-title, .brand-title, ' +
                '.dx-sec-title, .corte-sec-title, .gs-sec-title, .ck-title, .ev-title, label';

    var cromoIntentos = 0;
    function iconosEnCromo(raiz) {
        if (embebido) return;
        /* Mismo cuidado que en el menú: si el sprite todavía no llegó, se vuelve
           a intentar en vez de dejar los emojis puestos para siempre. */
        if (typeof window.etaaxIcono !== 'function') {
            if (cromoIntentos++ < 40) setTimeout(function () { iconosEnCromo(raiz); }, 150);
            return;
        }
        (raiz || document).querySelectorAll(CROMO).forEach(function (el) {
            if (el.dataset.etxEmoji) return;
            /* El primer nodo de texto, y solo si empieza con un emoji conocido:
               así nunca se toca texto de en medio ni contenido de la persona. */
            var t = el.firstChild;
            while (t && t.nodeType === 3 && !t.nodeValue.trim()) t = t.nextSibling;
            if (!t || t.nodeType !== 3) return;
            var txt = t.nodeValue.replace(/^\s+/, '');
            var clave = Object.keys(EMOJIS).find(function (e) { return txt.indexOf(e) === 0; });
            if (!clave) return;
            var marcado = window.etaaxIcono(EMOJIS[clave], { tam: 16, clase: 'etx-emoji-ic' });
            if (!marcado) return;
            el.dataset.etxEmoji = '1';
            t.nodeValue = txt.slice(clave.length).replace(/^[\s\u00a0]+/, ' ');
            var hueco = document.createElement('span');
            hueco.className = 'etx-emoji-slot';
            hueco.setAttribute('aria-hidden', 'true');
            hueco.innerHTML = marcado;
            el.insertBefore(hueco, el.firstChild);
        });
    }
    /* Los modales nacen después, así que se vuelve a pasar cuando el documento
       cambia. Se agrupa en un cuadro de animación: sin eso, pintar una tabla de
       doscientos renglones dispararía doscientas pasadas. */
    function vigilarCromo() {
        if (embebido || typeof MutationObserver !== 'function') return;
        var pendiente = false;
        new MutationObserver(function () {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(function () { pendiente = false; iconosEnCromo(); });
        }).observe(document.body, { childList: true, subtree: true });
    }

    /* LA BARRA PLEGADA ES UNA CAJA (19-nov). Tres medidas:
       · --etx-sidebar-space: lo que el CONTENIDO le deja a la barra. Abierta,
         268. Plegada en pantalla grande, NADA: la caja no baja de la tarjeta
         del negocio, así que debajo de ella todo el ancho es del contenido.
         En pantallas medianas y chicas la barra va debajo de la tarjeta y se
         conserva el carril de siempre (112 / 88).
       · --etx-ctx-space: lo que la tarjeta del negocio le deja: la caja y un
         respiro.
       · --etx-nav-caja-h: la caja mide un poco menos que la tarjeta del
         negocio, que es la que tiene al lado. */
    function medirLayout() {
        if (embebido) return;
        var bar = document.getElementById('ctxBar'), nav = document.getElementById('nav'), raiz = document.documentElement.style;
        var visible = !!nav && getComputedStyle(nav).display !== 'none';
        var cerrado = visible && nav.classList.contains('cerrado');
        var w = innerWidth;
        var cajaW = w <= 600 ? 64 : (w <= 900 ? 88 : 132);
        var espacio = !visible ? 0 : (w <= 600 ? 88 : (cerrado ? (w <= 900 ? 112 : 0) : 268));
        var ctxEsp = !visible ? 0 : (cerrado ? cajaW + 16 : 268);
        raiz.setProperty('--etx-sidebar-space', espacio + 'px');
        raiz.setProperty('--etx-ctx-space', ctxEsp + 'px');
        raiz.setProperty('--etx-nav-caja-w', cajaW + 'px');
        // Se mide DESPUÉS de ceder el carril: la tarjeta puede cambiar de alto.
        var alto = bar && bar.getClientRects().length ? Math.ceil(bar.getBoundingClientRect().height) : 0;
        var tarjeta = bar && bar.querySelector('.ctx-bar-inner');
        var th = tarjeta && tarjeta.getClientRects().length ? tarjeta.getBoundingClientRect().height : 0;
        var cajaH = (w > 900 && th) ? Math.max(64, Math.round(th - 12)) : (w <= 600 ? 64 : 76);
        raiz.setProperty('--etx-context-h', alto + 'px');
        raiz.setProperty('--etx-nav-caja-h', cajaH + 'px');
    }
    /* El icono del botón: un panel con su flecha. Una flecha para «expandir» y
       otra para «ocultar»; el CSS enseña la que toca según esté la barra. */
    var ICONO_TOGGLE = '<span class="etx-nav-tg-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3.5"/>' +
        '<path d="M9 4v16"/><path class="etx-tg-expandir" d="M13 9.5 15.5 12 13 14.5"/><path class="etx-tg-ocultar" d="M15.5 9.5 13 12l2.5 2.5"/></svg></span>';
    window.etaaxEstilizarNav = function (nav) {
        if (embebido || !nav) return;
        var modulo = moduloActual();
        if (!modulo) return;
        var top = nav.querySelector('.nav-top'), panel = top && top.querySelector('a.nav-toggle');
        if (top && !top.querySelector('.etx-nav-identidad')) {
            var etiqueta = contextoGlobal ? (sessionStorage.getItem('etaax_fin_global') === '1' ? 'Financiero global' : 'Catálogos globales') : modulo.nombre;
            var icono = contextoGlobal ? (sessionStorage.getItem('etaax_fin_global') === '1' ? 'mod-salud-financiera' : 'catalogos') : modulo.icono;
            if (panel) { panel.removeAttribute('style'); panel.classList.add('etx-nav-modulo'); panel.innerHTML = ic(icono,28); }
            var identidad = document.createElement('div');
            identidad.className = 'etx-nav-identidad';
            /* «MÓDULO 1» va en vertical a la izquierda del icono, y el nombre
               a la derecha (pedido de Edwin, 19-nov). */
            var numero = document.createElement('span');
            numero.className = 'etx-nav-numero';
            numero.textContent = contextoGlobal ? 'Vista de negocio' : 'Módulo ' + (MODULOS.indexOf(modulo) + 1);
            identidad.appendChild(numero);
            if (panel) identidad.appendChild(panel);
            else { var ico = document.createElement('span'); ico.innerHTML = ic(icono,28); identidad.appendChild(ico); }
            var texto = document.createElement('div');
            texto.innerHTML = '<strong>' + esc(etiqueta) + '</strong>';
            identidad.appendChild(texto);
            var btn = nav.querySelector('#navToggleBtn');
            top.innerHTML = ''; top.appendChild(identidad);
            if (btn) {
                btn.classList.add('etx-nav-contraer');
                btn.innerHTML = ICONO_TOGGLE + '<span class="nav-toggle-text" id="navToggleTxt"></span>';
                top.appendChild(btn);
            }
        }
        nav.querySelectorAll('a.nav-link').forEach(function (a) {
            if (a.classList.contains('etx-nav-back')) return;
            var nombreAccesible = a.dataset.tooltip || (a.querySelector('.nav-text') || a).textContent.trim();
            if (nombreAccesible) { a.setAttribute('aria-label',nombreAccesible);a.title = nombreAccesible; }
            var url;
            try { url = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
            var pathname = typeof window.etaaxRutaModulo === 'function' ? window.etaaxRutaModulo(url.pathname) : url.pathname;
            var archivo = pathname.split('/').pop(), descripcion = DESCRIPCIONES[archivo];
            if (descripcion && !a.querySelector('.etx-nav-desc')) {
                var sub = document.createElement('span');sub.className = 'etx-nav-desc';sub.textContent = descripcion;a.appendChild(sub);
            }
            if (a.classList.contains('active')) a.setAttribute('aria-current','page');
        });
        /* OJO: aquí NO se llama a `etaaxPintarIconosNav`. El pintor termina
           llamando a esta función, así que pedirle que repase desde aquí los
           deja llamándose en círculo hasta que el navegador se queda sin pila —
           el revisor lo cazó en la primera corrida. Si el pintor llegó tarde, lo
           resuelven su reintento y el vigilante del menú, que para eso están. */
        var salida = nav.querySelector('.etx-nav-back') || nav.querySelector('a[data-tooltip="Salir del global"]');
        if (!salida) {
            salida = document.createElement('a');salida.href = volver;salida.className = 'nav-link';
            salida.innerHTML = '<span class="nav-icon" aria-hidden="true">' + ic('flecha',18) + '</span><span class="nav-text">Volver a módulos</span>';
            salida.addEventListener('click',function () { try { sessionStorage.setItem('etaax_hub_modulo',modulo.id); } catch (e) {} });
        }
        salida.classList.add('etx-nav-back');nav.appendChild(salida);
        salida.setAttribute('aria-label',contextoGlobal ? 'Volver al negocio' : 'Volver a módulos');
        salida.title = salida.getAttribute('aria-label');
        var abierto = !nav.classList.contains('cerrado'), boton = nav.querySelector('#navToggleBtn'), txt = nav.querySelector('#navToggleTxt');
        if (boton && boton.childNodes[0] && !boton.querySelector('.etx-nav-tg-ic')) boton.childNodes[0].textContent = abierto ? '← ' : '→ ';
        if (boton) { boton.setAttribute('aria-expanded',String(abierto)); boton.setAttribute('data-tooltip', abierto ? 'Ocultar barra' : 'Expandir barra'); }
        if (txt) txt.textContent = abierto ? 'Ocultar barra' : 'Expandir barra';
        if (!nav._etxLayoutObserver) {
            nav._etxLayoutObserver = new MutationObserver(medirLayout);
            nav._etxLayoutObserver.observe(nav,{attributes:true,attributeFilter:['class','style']});
        }
        medirLayout();
    };
    window.etaaxDisenoCtxBar = function (bar, ctx, opciones) {
        if (embebido) return;
        ctxActual = ctx;contextoGlobal = opciones.global;volver = opciones.volver;
        var cfg = leer('etaax_' + ctx.negId + '_suc_' + (ctx.sucId || '')) || {};
        var giro = window.EtaaxNegocio ? EtaaxNegocio.giro(cfg.giroK || EtaaxNegocio.adivinarGiro(cfg.giro || '')) : null;
        var titulo = contextoGlobal ? ctx.negNombre : (ctx.sucNombre || ctx.negNombre);
        var logo = opciones.logo ? '<img src="' + esc(opciones.logo) + '" alt="">' : ic(giro ? giro.ic : (contextoGlobal ? 'org-corporativo' : 'sucursal'),28);
        bar.innerHTML = '<div class="ctx-bar-inner">' +
            '<div class="ctx-neg-emoji-wrap">' + logo + '</div><div class="ctx-neg-id">' +
            '<div class="etx-ctx-marca">' + esc(ctx.negNombre) + ' / ' + (contextoGlobal ? 'Vista global' : 'Sucursal activa') + '</div>' +
            '<div class="ctx-neg-name">' + (contextoGlobal ? '' : ic('sh-matriz',18)) + '<span>' + esc(titulo) + '</span></div>' +
            '<div class="ctx-neg-tipo">' + esc(contextoGlobal ? 'Global · todas las sucursales' : (giro ? giro.nom : opciones.tipo)) + '</div></div>' +
            '<div class="ctx-presencia" id="ctxPresencia"></div>' +
            /* Atrás / Adelante ya no van aquí: subieron al encabezado, junto a «Módulos» (24-nov). */
            '<div class="ctx-right"><span class="ctx-badge-plan">' + esc(ctx.userBadge || 'Mi negocio') + '</span>' +
            (contextoGlobal ? '<a class="ctx-btn" href="' + esc(volver) + '">Ir al negocio ' + ic('flecha',18) + '</a>' :
            (ctx.ctxType !== 'staff' ? '<button type="button" class="ctx-btn" id="etxCambiarSucursal" aria-haspopup="dialog">' + ic('sh-matriz',20) + 'Cambiar sucursal</button>' : '') +
            '<button type="button" class="ctx-btn" id="etxCambiarModulo">' + ic('sh-cambiar-negocio',20) + 'Cambiar módulo ' + ic('hd-desplegar',14) + '</button><button type="button" class="ctx-btn" id="etxInfoSucursal">' + ic('sh-info-sucursal',20) + 'Información de sucursal</button>') + '</div></div>';
        if (opciones.editorNav && opciones.editorNav.remove) opciones.editorNav.remove();   // las de Escandallos también van en el encabezado
        if (typeof window.etaaxHeader === 'function') window.etaaxHeader({marcaBase:'/marca/hub',usuario:ctx.userName,negocio:ctx.negNombre,plan:ctx.userBadge,inicio:'/hub.html',inicioTexto:'Módulos',nav:true,cerrarSesion:window.ctxSalir});
        var cambiar = bar.querySelector('#etxCambiarModulo'), info = bar.querySelector('#etxInfoSucursal');
        if (cambiar) cambiar.onclick = abrirModulos;
        if (info) info.onclick = abrirInfoSucursal;
        var sucursal = bar.querySelector('#etxCambiarSucursal');
        if (sucursal) sucursal.onclick = abrirSucursales;
        if (window.ResizeObserver && !observadorBarra) { observadorBarra = new ResizeObserver(medirLayout);observadorBarra.observe(bar); }
        medirLayout();
    };
    var dialogo;
    function cerrarDialogo() {
        if (!dialogo) return;
        dialogo.close();
        if (dialogo._etxTrigger && dialogo._etxTrigger.isConnected) dialogo._etxTrigger.focus();
    }
    function mostrarDialogo(titulo, contenido, trigger) {
        if (!dialogo) {
            dialogo = document.createElement('dialog');dialogo.className = 'etx-module-dialog';dialogo.id = 'etxModuleDialog';dialogo.setAttribute('aria-labelledby','etxDialogTitulo');
            document.body.appendChild(dialogo);
            dialogo.addEventListener('keydown',function(e){if(e.key === 'Escape'){e.preventDefault();e.stopPropagation();cerrarDialogo();}});
            dialogo.addEventListener('click',function(e){if(e.target === dialogo){var r=dialogo.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)cerrarDialogo();}});
        }
        if (dialogo.open) dialogo.close();
        dialogo._etxTrigger = trigger;
        dialogo.innerHTML = '<div class="etx-dialog-head"><h2 id="etxDialogTitulo">' + esc(titulo) + '</h2><form method="dialog"><button aria-label="Cerrar">×</button></form></div>' + contenido;
        dialogo.onclose = function () { if (trigger && trigger.isConnected) trigger.focus(); };
        dialogo.showModal();
    }
    function abrirModulos() {
        var c = leer('etaax_ctx');
        if (!c || !c.negId || contextoGlobal) return;
        var actual = moduloActual();
        mostrarDialogo('Cambiar módulo','<p>Elige un área de trabajo de ' + esc(c.sucNombre || c.negNombre) + '.</p><div class="etx-module-options">' + MODULOS.filter(function(m){ return permitido(m,c); }).map(function(m,i){
            /* Lo que no se puede no se enseña (Edwin, 23-nov): ni apps sin contratar ni lo que el rol no tiene. */
            var ok = true, elegido = actual && actual.id === m.id;
            return '<button type="button" data-modulo="' + m.id + '"' + (ok ? '' : ' disabled') + (elegido ? ' aria-current="true"' : '') + '>' + ic(m.icono,30) + '<span><small>Módulo ' + (i+1) + '</small><strong>' + esc(m.nombre) + '</strong><small>' + (ok ? (elegido ? 'Módulo actual' : 'Entrar al módulo') : 'Sin acceso para tu rol') + '</small></span>' + ic('flecha',18) + '</button>';
        }).join('') + '</div>',document.getElementById('etxCambiarModulo'));
        dialogo.querySelectorAll('[data-modulo]').forEach(function(b){b.onclick=function(){
            var fresco = leer('etaax_ctx'), m = MODULOS.find(function(x){return x.id === b.dataset.modulo;});
            if (!permitido(m,fresco) || fresco.negId !== c.negId || fresco.sucId !== c.sucId) { abrirModulos();return; }
            var navegar = function () {
                var actual = leer('etaax_ctx');
                if (!permitido(m,actual) || actual.negId !== c.negId || actual.sucId !== c.sucId) return;
                /* El hub se entera igual —si vuelves a él, te recibe en este
                   módulo— pero el viaje es directo a su portada. */
                try { sessionStorage.setItem('etaax_hub_modulo',m.id); } catch (e) {}
                location.href = m.portada || '/hub.html';
            };
            cerrarDialogo();
            if (typeof window._escGuardNav === 'function') window._escGuardNav(navegar);
            else navegar();
        };});
    }
    async function abrirSucursales() {
        var c = leer('etaax_ctx');
        if (!c || !c.negId || c.ctxType === 'staff' || contextoGlobal) return;
        var trigger = document.getElementById('etxCambiarSucursal');
        mostrarDialogo('Cambiar sucursal','<p>Actualizando sucursales…</p>',trigger);
        var token = {}; dialogo._sucSolicitud = token;
        var ok = true;
        if (typeof window.sbSucPull === 'function') {
            try { ok = await sbSucPull(c.negId); } catch(e) { ok = false; }
        }
        var fresco = leer('etaax_ctx');
        if (!dialogo.open || dialogo._sucSolicitud !== token || !fresco || fresco.ctxType === 'staff' || fresco.negId !== c.negId) return;
        var sucs = leer('etaax_' + c.negId + '_sucursales') || [];
        mostrarDialogo('Cambiar sucursal','<p>Elige una sucursal de ' + esc(c.negNombre) + '.</p>' +
            (!ok ? '<p>No se pudo actualizar la lista. Se muestran las sucursales guardadas.</p>' : '') +
            '<div class="etx-module-options">' + sucs.map(function(s){
                var actual = s.id === fresco.sucId;
                return '<button type="button" data-sucursal="' + esc(s.id) + '"' + (s.activa === false ? ' disabled' : '') +
                    (actual ? ' aria-current="true"' : '') + '>' + ic('sh-matriz',24) + '<span><strong>' + esc(s.nombre || 'Sucursal') +
                    '</strong><small>' + (s.activa === false ? 'Inactiva' : actual ? 'Actual' : 'Abrir sucursal') + '</small></span></button>';
            }).join('') + '</div>' + (!sucs.length ? '<p>Todavía no hay sucursales registradas.</p>' : ''),trigger);
        dialogo.querySelectorAll('[data-sucursal]').forEach(function(b){ b.onclick = function(){
            var cambiar = function(){
                var ctx = leer('etaax_ctx');
                if (!ctx || ctx.ctxType === 'staff' || ctx.negId !== c.negId) return;
                var suc = (leer('etaax_' + c.negId + '_sucursales') || []).find(function(s){ return s.id === b.dataset.sucursal && s.activa !== false; });
                if (!suc) return;
                ctx.sucId = suc.id; ctx.sucNombre = suc.nombre || 'Sucursal';
                var cfg = leer('etaax_' + c.negId + '_suc_' + suc.id) || {};
                var neg = (leer('etaax_negocios') || []).find(function(n){ return n.id === c.negId; });
                ctx.negColor = cfg.color || (neg && neg.color) || '#3dbe7a';
                localStorage.setItem('etaax_sucursal_activa', suc.id);
                localStorage.setItem('etaax_ctx', JSON.stringify(ctx));
                sessionStorage.removeItem('etaax_cat_global'); sessionStorage.removeItem('etaax_fin_global');
                location.href = location.pathname;
            };
            if (b.dataset.sucursal === fresco.sucId) { cerrarDialogo(); return; }
            cerrarDialogo();
            if (typeof window._escGuardNav === 'function') window._escGuardNav(cambiar); else cambiar();
        }; });
    }
    function abrirInfoSucursal() {
        var c = leer('etaax_ctx');if (!c || !c.negId || contextoGlobal) return;
        var cfg = leer('etaax_' + c.negId + '_suc_' + (c.sucId || '')) || {};
        var dias = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
        var filas = [['Teléfono',cfg.telefono],['Correo',cfg.correo],['Dirección',cfg.direccion],['Horario',cfg.horaOpen && cfg.horaClose ? cfg.horaOpen + ' – ' + cfg.horaClose : ''],['Días de operación',Array.isArray(cfg.dias) ? dias.filter(function(_,i){return cfg.dias[i];}).join(', ') : ''],['Sitio web',cfg.web]];
        mostrarDialogo(c.sucNombre || 'Información de sucursal','<p>' + esc(c.negNombre) + '</p><dl class="etx-sucursal-datos">' + filas.map(function(f){return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1] || '—') + '</dd></div>';}).join('') + '</dl>',document.getElementById('etxInfoSucursal'));
    }
    function pintarTarjetas() {
        var recetas = {btnVerRecetas:'cat-recetas',btnCaratula:'fin-resumen-resultados',btnEscSimple:'mod-escandallos',btnEscAlimentos:'giro-restaurante-bar',btnEscBebidas:'giro-bar',btnEscSubAlimentos:'cat-sub-recetas',btnEscSubBebidas:'giro-bar',btnMenuSucursal:'cor-comedor'};
        var diarios = {gastos:'fin-gastos',cortes:'fin-ventas',nominas:'cat-colaboradores',fijos:'sh-info-negocio',depositos:'fin-previsiones',mayores:'fin-gastos',caja:'candado',extras:'fin-ventas'};
        document.querySelectorAll('.cf-card,.dx-card,#vistaMenuReceta .cat-btn').forEach(function(card){
            card.classList.add('etx-tool-card');
            var nombre = recetas[card.id] || diarios[card.dataset.fn], href = card.getAttribute('href');
            var llamada = (card.getAttribute('onclick') || '').match(/abrirTool\('([^']+)'/);
            if (!nombre && (href || llamada)) { try { nombre = window.etaaxIconoRuta(new URL(href || llamada[1],location.href).pathname); } catch(e) {} }
            var slot = card.querySelector('.cf-card-icon,.dx-card-icon,.etx-tool-icon');
            if (!nombre && moduloActual()) nombre = moduloActual().icono;
            if (slot && nombre) {slot.innerHTML = ic(nombre,30);slot.setAttribute('aria-hidden','true');}
        });
    }
    /* La isla del nombre del módulo: al bajar se encoge a un círculo con la
       inicial (en el pasillo entre las tarjetas); arriba vuelve a decir todo. */
    function vigilarIsla() {
        var isla = document.querySelector('.etx-isla'); if (!isla) return;
        document.body.classList.add('etx-con-isla');
        var cont = isla.closest('#moduloLanding');
        var leer = function () { return cont ? cont.scrollTop : (window.pageYOffset || document.documentElement.scrollTop || 0); };
        var pintar = function () { isla.classList.toggle('etx-isla--mini', leer() > 24); };
        (cont || window).addEventListener('scroll', pintar, { passive: true });
        pintar();
    }
    function iniciar() {
        try { vigilarIsla(); } catch (e) {}
        pintarTarjetas();
        if (embebido) return;
        document.querySelectorAll('.theme-toggle').forEach(function(b){b.remove();});
        var nav = document.getElementById('nav');
        if (nav && innerWidth <= 600) { nav.classList.add('cerrado');document.body.classList.remove('nav-open'); }
        if (typeof window.etaaxPintarIconosNav === 'function') window.etaaxPintarIconosNav();
        bicolorTitulo();
        iconosEnCromo();
        vigilarCromo();
        medirLayout();window.addEventListener('resize',medirLayout);
        window.addEventListener('etaax:permisos',function(){if(dialogo && dialogo.open && dialogo.querySelector('[data-modulo]')){dialogo.close();abrirModulos();}});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',iniciar);else iniciar();
})();
