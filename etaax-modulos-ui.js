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
    /* (24-nov) El orden: Cost·ax, Admin·ax, Fin·ax, Equip·ax, Learn·ax (Vent·ax y
       Timbr·ax, cuando lleguen, van antes de Learn·ax). Equip·ax —el equipo— ya
       no es submódulo de Admin·ax: es módulo propio. */
    var MODULOS = [
        { id:'recetas', nombre:'Cost·ax', icono:'mod-recetas-insumos', portada:'/recetas/index.html', permisos:['recetas','insumos','inventarios','requisiciones','menu','proveedores'] },
        { id:'administrativo', nombre:'Admin·ax', icono:'mod-control-administrativo', portada:'/administrativo/index.html', permisos:['ventas','gastos','clientes','financiero'] },
        { id:'financiero', nombre:'Fin·ax', icono:'mod-salud-financiera', portada:'/financiero/index.html', permisos:['financiero'] },
        { id:'equipo', nombre:'Equip·ax', icono:'mod-equipax', portada:'/equipo/index.html', permisos:['staff'] },
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
    /* (24-nov) Las páginas del equipo se quedaron en /administrativo/ (sus
       direcciones no cambian) pero son de Equip·ax. */
    var RE_EQUIPO = /^\/administrativo\/(staff-hub|staff|horarios|checklists|organigrama|perfiles-puesto|evaluaciones|permisos)(\.html)?\/?$/;
    function moduloDeRuta() {
        var p = location.pathname, id = p.split('/')[1];
        if (/^\/administrativo\/(menu|proveedores)(\.html)?\/?$/.test(p)) id = 'recetas';      // el Menú y Proveedores son de Cost·ax
        if (/^\/financiero\/(cuentas-bancarias|previsiones)(\.html)?\/?$/.test(p)) id = 'administrativo';   // su Configuración
        if (RE_EQUIPO.test(p)) id = 'equipo';
        return id;
    }
    /* LAS BARRAS «SUB MÓDULOS», EN UN SOLO LUGAR (Edwin, 24-nov). Cada página
       traía la suya y se iban separando (unas con media lista, otras con la de
       otro módulo). Aquí vive la lista de Equip·ax, Admin·ax y lo que Cost·ax
       ganó (Proveedores). Un renglón es un submódulo; un `g` es un grupo con sus
       páginas (Operativo, Estructura de staff, Configuración). Se enseña solo lo
       que el plan y el rol permiten: `sub` es un sub-permiso de Gestión de Staff
       y `perm` un permiso de módulo. */
    var NAVS = {
        equipo: [
            { t:'Catálogo', d:'Colaboradores', h:'/administrativo/staff.html', sub:'verCatalogo', ic:'cat-colaboradores' },
            { g:'Operativo', hijos:[
                { t:'Horarios', d:'Turnos y cobertura', h:'/administrativo/horarios.html', sub:'horarios', ic:'cat-horarios' },
                { t:'Checklists', d:'Rutinas operativas', h:'/administrativo/checklists.html', sub:'checklists', ic:'mod-control-administrativo' } ] },
            { t:'Evaluaciones', d:'Desempeño del equipo', h:'/administrativo/evaluaciones.html', sub:'evaluaciones', ic:'mod-control-administrativo' },
            { g:'Estructura de staff', hijos:[
                { t:'Organigrama', d:'Quién reporta a quién', h:'/administrativo/organigrama.html', sub:'organigrama', ic:'org-corporativo' },
                { t:'Perfiles de puesto', d:'Funciones y puestos', h:'/administrativo/perfiles-puesto.html', sub:'perfiles', ic:'perfil' },
                { t:'Reglamento', d:'Próximamente', pronto:true, ic:'catalogos' } ] }
        ],
        administrativo: [
            { t:'Ingresos', d:'Cortes, ventas extras y anticipos', h:'/administrativo/diario.html?vista=ingresos', perm:['ventas'], ic:'fin-ventas' },
            { t:'Egresos', d:'Gastos, movimientos, fijos y nóminas', h:'/administrativo/diario.html?vista=egresos', perm:['gastos','ventas'], ic:'fin-gastos' },
            { t:'Gestión', d:'Caja fuerte', h:'/administrativo/diario.html?vista=gestion', perm:['ventas'], ic:'ev-caja-fuerte' },
            { g:'Configuración', hijos:[
                { t:'Cuentas bancarias', d:'Cuentas y comisiones', h:'/financiero/cuentas-bancarias.html', perm:['financiero'], ic:'fin-cuentas-bancarias' },
                { t:'Previsiones', d:'Compromisos futuros', h:'/financiero/previsiones.html', perm:['financiero'], ic:'fin-previsiones' } ] },
            { t:'Clientes', d:'Directorio de clientes', h:'/administrativo/clientes.html', perm:['clientes'], ic:'cat-clientes' }
        ],
        /* Cost·ax: sus páginas de /recetas/ ya traen su barra; Proveedores (que se
           mudó desde Admin·ax) se les agrega, y en la suya se arma completa. */
        recetas: [
            { t:'Escandallos', d:'Costeo y escandallos', h:'/recetas/index.html?escandallos=1', perm:['recetas'], ic:'mod-escandallos' },
            { t:'Insumos', d:'Materias primas', h:'/recetas/insumos.html', perm:['insumos'], ic:'mod-insumos' },
            { t:'Inventarios', d:'Existencias', h:'/recetas/inventarios.html', perm:['inventarios'], ic:'mod-inventarios' },
            { t:'Requisiciones', d:'Pedidos internos', h:'/recetas/requisiciones.html', perm:['requisiciones'], ic:'mod-requisiciones' },
            { t:'Proveedores', d:'Abastecimiento', h:'/administrativo/proveedores.html', perm:['proveedores'], ic:'cat-proveedores' }
        ]
    };
    function puedeItem(e) {
        if (e.sub) return typeof window.etaaxPuedeSub === 'function' ? window.etaaxPuedeSub('staff', e.sub) : true;
        if (e.perm) { var c = leer('etaax_ctx'); return !c || !c.negId || permitido({ permisos: e.perm }, c); }
        return true;
    }
    function enlaceNav(e, aqui, vista) {
        var partes = e.h ? e.h.split('?') : [''], q = partes[1] ? new URLSearchParams(partes[1]).get('vista') : null;
        var activo = !!e.h && partes[0] === aqui && (q ? q === vista : !vista || !/\/diario\.html$/.test(aqui));
        var cuerpo = '<span class="nav-icon etx-nav-icono" aria-hidden="true">' + ic(e.ic, 22) + '</span><span class="nav-text">' + esc(e.t) + '</span>' +
                     '<span class="etx-nav-desc">' + esc(e.d || '') + '</span>';
        if (e.pronto) return '<span class="nav-link etx-nav-pronto" aria-disabled="true">' + cuerpo + '</span>';
        return '<a href="' + esc(e.h) + '" class="nav-link' + (activo ? ' active' : '') + '" data-tooltip="' + esc(e.t) + '">' + cuerpo + '</a>';
    }
    function armarNav(nav, lista) {
        var aqui = typeof window.etaaxRutaModulo === 'function' ? window.etaaxRutaModulo(location.pathname) : location.pathname;
        var vista = new URLSearchParams(location.search).get('vista');
        nav.querySelectorAll('.nav-section, :scope > a.nav-link:not(.etx-nav-back)').forEach(function (x) { x.remove(); });
        var html = lista.map(function (e) {
            if (!e.g) return puedeItem(e) ? enlaceNav(e, aqui, vista) : '';
            var hijos = e.hijos.filter(function (x) { return x.pronto || puedeItem(x); });
            if (!hijos.some(function (x) { return !x.pronto; })) return '';
            return '<div class="etx-nav-grupo">' + esc(e.g) + '</div>' + hijos.map(function (x) { return enlaceNav(x, aqui, vista); }).join('');
        }).join('');
        var sec = document.createElement('div'); sec.className = 'nav-section etx-nav-central'; sec.innerHTML = html;
        nav.insertBefore(sec, nav.querySelector('.etx-nav-back') || null);
    }
    /* Cost·ax en /recetas/: su barra se queda; solo gana Proveedores. */
    function agregarProveedores(nav) {
        if (nav.querySelector('.etx-nav-prov') || nav.querySelector('a.nav-link[href*="proveedores.html"]')) return;
        var e = NAVS.recetas[NAVS.recetas.length - 1]; if (!puedeItem(e)) return;
        var sec = document.createElement('div'); sec.className = 'nav-section etx-nav-prov'; sec.innerHTML = enlaceNav(e, '', null);
        nav.insertBefore(sec, nav.querySelector('.etx-nav-back') || null);
    }
    function navDelModulo(nav, modulo) {
        if (contextoGlobal || !modulo) return;
        if (modulo.id === 'recetas' && /^\/(recetas\/|administrativo\/menu)/.test(location.pathname)) { agregarProveedores(nav); return; }
        if (NAVS[modulo.id] && !nav.querySelector('.etx-nav-central')) armarNav(nav, NAVS[modulo.id]);
    }
    /* Checklists y Evaluaciones no traían barra: se les pone una (la arma navDelModulo). */
    function crearNavEquipo() {
        var nav = document.createElement('nav'); nav.className = 'nav'; nav.id = 'nav';
        nav.innerHTML = '<div class="nav-top"><button type="button" class="nav-toggle nav-toggle-btn" id="navToggleBtn"><span class="nav-toggle-text" id="navToggleTxt"></span></button></div>';
        document.body.insertBefore(nav, document.body.firstChild);
        return nav;
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

    /* LA BARRA LATERAL ES UN DESPLEGABLE (Edwin, 24-nov). Ya no es una columna
       que le roba ancho al contenido: es el botón «Sub módulos», a la izquierda
       de la isla del negocio; se abre como el menú de la cuenta, eliges y se
       cierra. Dos medidas:
       · --etx-sidebar-space: lo que el CONTENIDO le deja a la barra → nada.
       · --etx-ctx-space: lo que la isla del negocio le deja al botón.
       (--etx-context-h es el alto real de la franja de la isla.) */
    function medirLayout() {
        if (embebido) return;
        var bar = document.getElementById('ctxBar'), nav = document.getElementById('nav'), raiz = document.documentElement.style;
        var visible = !!nav && getComputedStyle(nav).display !== 'none';
        /* El botón mide lo que mide su texto («Sub módulos» con la letra real);
           abierto se ensancha, así que se usa lo medido cerrado. */
        if (visible && !nav.classList.contains('etx-sub-abierto') && document.body.classList.contains('etx-sub-menu')) nav._etxCajaW = Math.ceil(nav.getBoundingClientRect().width);
        var cajaW = (visible && nav._etxCajaW) || (innerWidth <= 600 ? 48 : 174);
        raiz.setProperty('--etx-sidebar-space', '0px');
        raiz.setProperty('--etx-ctx-space', (visible ? cajaW + 10 : 0) + 'px');
        var alto = bar && bar.getClientRects().length ? Math.ceil(bar.getBoundingClientRect().height) : 0;
        raiz.setProperty('--etx-context-h', alto + 'px');
        /* Lo que mide la sucursal del centro: el título de la izquierda llega
           hasta ella y no más (con un nombre corto, el título cabe completo). */
        var ident = bar && bar.querySelector('.etx-ctx-ident');
        if (ident && ident.getClientRects().length) raiz.setProperty('--etx-ident-mitad', Math.ceil(ident.getBoundingClientRect().width / 2) + 'px');
    }
    /* El desplegable: el botón de la barra lo abre y lo cierra (en vez de
       plegarla), tocar fuera, Escape o elegir un submódulo lo cierran. La
       preferencia vieja de «barra plegada» ya no aplica: la barra va siempre
       completa DENTRO del desplegable. */
    function subModulos(nav) {
        if (embebido || !nav || nav._etxSub) return;
        nav._etxSub = true;
        document.body.classList.add('etx-sub-menu');
        try { localStorage.setItem('etaax_nav_abierta', '1'); } catch (e) {}
        nav.classList.remove('cerrado');
        var main = document.getElementById('mainContent'); if (main) main.classList.remove('expandido');
        var abrir = function (si) {
            nav.classList.toggle('etx-sub-abierto', si);
            var b = nav.querySelector('#navToggleBtn'); if (b) b.setAttribute('aria-expanded', String(si));
        };
        window.toggleNav = function () { abrir(!nav.classList.contains('etx-sub-abierto')); };
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { nav._etxCajaW = 0; medirLayout(); });
        document.addEventListener('click', function (e) {
            var t = e.target, b = t && t.closest && t.closest('#navToggleBtn');
            if (b && nav.contains(b)) { e.preventDefault(); e.stopPropagation(); abrir(!nav.classList.contains('etx-sub-abierto')); return; }
            if (!nav.classList.contains('etx-sub-abierto')) return;
            if (!nav.contains(t) || (t.closest && t.closest('a.nav-link'))) abrir(false);
        }, true);
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || !nav.classList.contains('etx-sub-abierto')) return;
            abrir(false); var b = nav.querySelector('#navToggleBtn'); if (b) b.focus();
        });
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
        navDelModulo(nav, modulo);
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
                btn.innerHTML = ICONO_TOGGLE + '<span class="nav-toggle-text" id="navToggleTxt"></span>' +
                    '<span class="etx-sub-ic" aria-hidden="true">' + ic(icono, 20) + '</span><span class="etx-sub-txt">Sub módulos</span>' +
                    '<span class="etx-sub-flecha" aria-hidden="true">' + ic('hd-desplegar', 14) + '</span>';
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
        subModulos(nav);
        var boton = nav.querySelector('#navToggleBtn');
        if (boton) {
            boton.setAttribute('aria-expanded', String(nav.classList.contains('etx-sub-abierto')));
            boton.setAttribute('aria-label', 'Sub módulos'); boton.removeAttribute('data-tooltip'); boton.removeAttribute('title');
        }
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
        /* (24-nov) LA FOTO DEL NEGOCIO VA SOLO EN EL BOTÓN DE LA CUENTA: en la isla
           se duplicaba. La isla lleva el logo PROPIO de la sucursal; sin él, el
           icono de su giro (o el del corporativo en la vista global). */
        var sucLogo = '', negFoto = '';
        try {
            if (!contextoGlobal && ctx.sucId) sucLogo = localStorage.getItem('etaax_' + ctx.negId + '_suc_' + ctx.sucId + '_logo') || '';
            negFoto = localStorage.getItem('etaax_' + ctx.negId + '_logo') || '';
        } catch (e) {}
        var logo = sucLogo ? '<img src="' + esc(sucLogo) + '" alt="">' : ic(giro ? giro.ic : (contextoGlobal ? 'org-corporativo' : 'sucursal'),28);
        /* LA FRANJA DEL NEGOCIO ES UNA ISLA LARGA (Edwin, 24-nov): solo el logo,
           la sucursal con su pin y su giro; en medio, el título de la pantalla
           (subirTitulo); a la derecha, Cambiar sucursal y Cambiar módulo como
           botones chicos que se expanden al tocarlos y despliegan sus opciones
           ahí mismo. El nombre del negocio y el plan ya los dice el menú de la
           cuenta, y «Información de sucursal» se mudó a ese menú. */
        var acc = function (id, icono, texto, extra) {
            return '<button type="button" class="ctx-btn etx-ctx-acc" id="' + id + '" aria-label="' + texto + '" aria-haspopup="dialog" aria-expanded="false"' + (extra || '') + '>' +
                ic(icono, 20) + '<span class="etx-ctx-acc-txt">' + texto + '</span></button>';
        };
        /* (24-nov, 2) El título va a la orilla izquierda y la sucursal al CENTRO
           DE LA PÁGINA (no de la isla, que empieza después de «Sub módulos»). */
        bar.innerHTML = '<div class="ctx-bar-inner etx-ctx-isla">' +
            '<div class="etx-ctx-titulo" id="etxCtxTitulo" aria-hidden="true"></div>' +
            '<div class="etx-ctx-ident"><div class="ctx-neg-emoji-wrap">' + logo + '</div><div class="ctx-neg-id">' +
            '<div class="ctx-neg-name">' + (contextoGlobal ? '' : ic('sh-matriz',16)) + '<span>' + esc(titulo) + '</span></div>' +
            '<div class="ctx-neg-tipo">' + esc(contextoGlobal ? 'Global · todas las sucursales' : (giro ? giro.nom : opciones.tipo)) + '</div></div></div>' +
            '<div class="ctx-presencia" id="ctxPresencia"></div>' +
            '<div class="ctx-right">' +
            (contextoGlobal ? '<a class="ctx-btn" href="' + esc(volver) + '">Ir al negocio ' + ic('flecha',18) + '</a>' :
            (ctx.ctxType !== 'staff' ? acc('etxCambiarSucursal', 'sh-cambiar-sucursal', 'Cambiar sucursal') : '') +
            acc('etxCambiarModulo', 'sh-cambiar-negocio', 'Cambiar módulo')) + '</div></div>';
        if (opciones.editorNav && opciones.editorNav.remove) opciones.editorNav.remove();   // las de Escandallos también van en el encabezado
        if (typeof window.etaaxHeader === 'function') window.etaaxHeader({marcaBase:'/marca/hub',usuario:ctx.userName,negocio:ctx.negNombre,plan:ctx.userBadge,logo:negFoto,inicio:'/hub.html',inicioTexto:'Módulos',nav:true,cerrarSesion:window.ctxSalir,
            extras: contextoGlobal ? [] : [{ id:'etxHdInfoSucOp', icono:'sh-info-sucursal', texto:'Información de sucursal', fn:abrirInfoSucursal }]});
        var cambiar = bar.querySelector('#etxCambiarModulo');
        if (cambiar) cambiar.onclick = abrirModulos;
        var sucursal = bar.querySelector('#etxCambiarSucursal');
        if (sucursal) sucursal.onclick = abrirSucursales;
        if (window.ResizeObserver && !observadorBarra) { observadorBarra = new ResizeObserver(medirLayout);observadorBarra.observe(bar); }
        tituloFirma = ''; pintarTitulo();
        if (typeof window.etaaxAutoCentrar === 'function') window.etaaxAutoCentrar(bar.querySelector('.etx-ctx-isla'), { ident:'.etx-ctx-ident', titulo:'.etx-ctx-titulo', botones:'.ctx-right' });
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
        /* Mismo botón con el diálogo abierto (Cambiar sucursal pinta «Actualizando…»
           y luego la lista): se cambia el contenido sin cerrarlo y reabrirlo. */
        var seguir = dialogo.open && dialogo._etxTrigger === trigger;
        if (dialogo.open && !seguir) dialogo.close();
        dialogo._etxTrigger = trigger;
        /* Desde un botón de la isla, el diálogo se DESPLIEGA debajo de él (como
           el menú de la cuenta) y el botón se queda expandido mientras tanto. */
        var pop = !!(trigger && trigger.classList && trigger.classList.contains('etx-ctx-acc'));
        dialogo.classList.toggle('etx-pop', pop);
        dialogo.innerHTML = '<div class="etx-dialog-head"><h2 id="etxDialogTitulo">' + esc(titulo) + '</h2><form method="dialog"><button aria-label="Cerrar">×</button></form></div>' + contenido;
        dialogo.onclose = function () {
            if (dialogo.open) return;   // el «close» de un diálogo anterior llega tarde
            if (trigger && trigger.classList) { trigger.classList.remove('abierto'); trigger.setAttribute('aria-expanded', 'false'); }
            if (trigger && trigger.isConnected) trigger.focus();
        };
        if (pop) { trigger.classList.add('abierto'); trigger.setAttribute('aria-expanded', 'true'); colocarPop(trigger); }
        if (!seguir) dialogo.showModal();
    }
    function colocarPop(t) {
        var r = t.getBoundingClientRect();
        dialogo.style.setProperty('--pop-top', Math.round(r.bottom + 10) + 'px');
        dialogo.style.setProperty('--pop-right', Math.max(12, Math.round(innerWidth - r.right)) + 'px');
    }
    window.addEventListener('resize', function () { if (dialogo && dialogo.open && dialogo.classList.contains('etx-pop') && dialogo._etxTrigger) colocarPop(dialogo._etxTrigger); });
    function abrirModulos() {
        var c = leer('etaax_ctx');
        if (!c || !c.negId || contextoGlobal) return;
        var actual = moduloActual();
        mostrarDialogo('Cambiar módulo','<p>Elige un área de trabajo de ' + esc(c.sucNombre || c.negNombre) + '.</p><div class="etx-module-options">' + MODULOS.filter(function(m){ return permitido(m,c); }).map(function(m,i){
            /* Lo que no se puede no se enseña (Edwin, 23-nov): ni apps sin contratar ni lo que el rol no tiene. */
            var ok = true, elegido = actual && actual.id === m.id;
            return '<button type="button" data-modulo="' + m.id + '"' + (ok ? '' : ' disabled') + (elegido ? ' aria-current="true"' : '') + '>' + ic(m.icono,30) + '<span><small>Módulo ' + (i+1) + '</small><span class="etx-mod-isla">' + (typeof window.etaaxIslaHTML === 'function' ? window.etaaxIslaHTML(m.nombre, { clase: 'etx-isla--chica' }) : '<strong>' + esc(m.nombre) + '</strong>') + '</span><small>' + (ok ? (elegido ? 'Módulo actual' : 'Entrar al módulo') : 'Sin acceso para tu rol') + '</small></span>' + ic('flecha',18) + '</button>';
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
        mostrarDialogo(c.sucNombre || 'Información de sucursal','<p>' + esc(c.negNombre) + '</p><dl class="etx-sucursal-datos">' + filas.map(function(f){return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1] || '—') + '</dd></div>';}).join('') + '</dl>',document.getElementById('etxHdCuenta'));
    }
    function pintarTarjetas() {
        var recetas = {btnVerRecetas:'cat-recetas',btnCaratula:'fin-resumen-resultados',btnEscSimple:'mod-escandallos',btnEscAlimentos:'giro-restaurante-bar',btnEscBebidas:'giro-bar',btnEscSubAlimentos:'cat-sub-recetas',btnEscSubBebidas:'giro-bar',btnMenuSucursal:'cor-comedor'};
        var diarios = {gastos:'fin-gastos',cortes:'fin-ventas',nominas:'cat-colaboradores',fijos:'sh-info-negocio',depositos:'fin-previsiones',mayores:'fin-gastos',caja:'candado',extras:'fin-ventas'};
        document.querySelectorAll('.cf-card,.dx-card,#vistaMenuReceta .cat-btn').forEach(function(card){
            card.classList.add('etx-tool-card');
            var nombre = card.dataset.icono || recetas[card.id] || diarios[card.dataset.fn], href = card.getAttribute('href');
            var llamada = (card.getAttribute('onclick') || '').match(/abrirTool\('([^']+)'/);
            if (!nombre && (href || llamada)) { try { nombre = window.etaaxIconoRuta(new URL(href || llamada[1],location.href).pathname); } catch(e) {} }
            var slot = card.querySelector('.cf-card-icon,.dx-card-icon,.etx-tool-icon');
            if (!nombre && moduloActual()) nombre = moduloActual().icono;
            if (slot && nombre) {slot.innerHTML = ic(nombre,30);slot.setAttribute('aria-hidden','true');}
        });
    }
    /* EL TÍTULO DE LA PANTALLA, EN LA ISLA DEL NEGOCIO (Edwin, 24-nov). Cada
       herramienta abría con su rótulo, un título enorme y un párrafo; ahora el
       título va chico, en medio de la isla, y el rótulo y el párrafo se quitan.
       El título original NO se borra: se queda solo para lectores de pantalla
       (y para el código de cada página que lo cambia), y la isla lo copia.
       Si la página cambia de vista —Inventarios, Requisiciones— la isla dice el
       de la vista que está a la vista. Sin título propio, el submódulo activo. */
    var SEL_TITULO = '.dx-hero-title, .cf-hero-title, .brand-title, .rs-title, .hr-title, .ck-title, .ev-title, .pp-title, .org-eyebrow';
    var SEL_EXTRA = '.dx-hero-eyebrow, .dx-hero-sub, .cf-hero-eyebrow, .cf-hero-sub, .brand-label, .rs-sub, .hr-sub, .ck-sub, .ev-sub, .pp-eyebrow';
    var SEL_CAB = '.dx-hero, .cf-hero, .header, .rs-head, .hr-head, .ck-head, .ev-head, .pp-head, .org-top';
    var tituloFirma = '', tituloPendiente = false;
    function marcarTitulos() {
        document.querySelectorAll(SEL_TITULO).forEach(function (t) {
            if (t.classList.contains('etx-titulo-subido')) return;
            var cab = t.closest(SEL_CAB);
            if (!cab || t.closest('#nav, #ctxBar, dialog, .modal-overlay, .modal, .etx-isla-wrap')) return;
            t.classList.add('etx-titulo-subido'); cab.classList.add('etx-cab-con-titulo');
            cab.querySelectorAll(SEL_EXTRA).forEach(function (x) { x.classList.add('etx-titulo-extra'); });
            /* Si en la cabecera no queda nada más (ni botones ni texto), se pliega. */
            var resto = cab.textContent;
            cab.querySelectorAll('.etx-titulo-subido, .etx-titulo-extra').forEach(function (x) { resto = resto.replace(x.textContent, ''); });
            if (!resto.trim() && !cab.querySelector('button, a, input, select, textarea')) cab.classList.add('etx-cab-vacia');
        });
    }
    function pintarTitulo() {
        var slot = document.getElementById('etxCtxTitulo'); if (!slot) return;
        var t = null;
        document.querySelectorAll('.etx-titulo-subido').forEach(function (x) { if (!t && x.getClientRects().length) t = x; });
        var partes = [];
        if (t) {
            t.childNodes.forEach(function (n) {
                var txt = (n.textContent || '').replace(/\s+/g, ' ');
                if (txt) partes.push({ g: n.nodeType === 1 && n.classList.contains('g'), t: txt });
            });
        } else {
            var act = document.querySelector('#nav .nav-link.active .nav-text, #nav .nav-link[aria-current="page"] .nav-text');
            if (act && act.textContent.trim()) partes.push({ g: false, t: act.textContent.trim() });
        }
        var firma = JSON.stringify(partes);
        if (firma === tituloFirma) return;
        tituloFirma = firma;
        slot.textContent = '';
        partes.forEach(function (p) {
            if (p.g) { var sp = document.createElement('span'); sp.className = 'g'; sp.textContent = p.t; slot.appendChild(sp); }
            else slot.appendChild(document.createTextNode(p.t));
        });
        slot.hidden = !partes.length;
        if (typeof window.etaaxRecentrar === 'function') window.etaaxRecentrar();   // el título cambió de largo
    }
    function subirTitulo() {
        if (embebido) return;
        document.body.classList.add('etx-titulo-en-isla');
        marcarTitulos(); pintarTitulo();
        if (typeof MutationObserver !== 'function') return;
        new MutationObserver(function () {
            if (tituloPendiente) return;
            tituloPendiente = true;
            requestAnimationFrame(function () { tituloPendiente = false; marcarTitulos(); pintarTitulo(); });
        }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
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
    /* LAS PORTADAS DE MÓDULO, COMPACTAS (Edwin, 24-nov). Las secciones con su
       línea y su título se sentían como separadores confusos y las tarjetas eran
       altas: había que bajar para verlas todas. Ahora van TODAS en dos columnas
       (con el pasillo del centro para la isla del nombre), más bajitas, y cada
       una dice adentro el grupo al que pertenece (el rótulo de su sección, o su
       `data-grupo`). El marcado de cada portada no cambia. */
    function portadaCompacta() {
        if (!document.querySelector('.etx-isla')) return;
        document.querySelectorAll('.cf-wrap > .cf-modules').forEach(function (mods) {
            mods.classList.add('etx-portada-modulos');
            mods.querySelectorAll('.cf-section').forEach(function (sec) {
                var tag = sec.querySelector('.cf-section-tag'), rotulo = tag ? tag.textContent.trim() : '';
                sec.querySelectorAll('.cf-card').forEach(function (card) {
                    var grupo = card.dataset.grupo || rotulo, hdr = card.querySelector('.cf-card-hdr');
                    if (!grupo || !hdr || hdr.querySelector('.etx-card-grupo')) return;
                    var sp = document.createElement('span'); sp.className = 'etx-card-grupo'; sp.textContent = grupo;
                    var soon = hdr.querySelector('.cf-badge-soon');
                    hdr.insertBefore(sp, soon || null);
                });
            });
        });
    }
    function iniciar() {
        try { vigilarIsla(); } catch (e) {}
        try { portadaCompacta(); } catch (e) {}
        pintarTarjetas();
        if (embebido) return;
        document.querySelectorAll('.theme-toggle').forEach(function(b){b.remove();});
        var nav = document.getElementById('nav');
        var mod = moduloActual();
        /* (El pintor de la barra, justo abajo, la estiliza: es quien arma «Sub módulos».) */
        if (!nav && mod && mod.id === 'equipo' && /^\/administrativo\//.test(location.pathname)) nav = crearNavEquipo();
        subModulos(nav);
        if (typeof window.etaaxPintarIconosNav === 'function') window.etaaxPintarIconosNav();
        bicolorTitulo();
        subirTitulo();
        iconosEnCromo();
        vigilarCromo();
        medirLayout();window.addEventListener('resize',medirLayout);
        window.addEventListener('etaax:permisos',function(){if(dialogo && dialogo.open && dialogo.querySelector('[data-modulo]')){dialogo.close();abrirModulos();}});
        /* Los permisos del rol llegan después: la barra de Equip·ax se vuelve a armar con ellos. */
        window.addEventListener('etaax:permisos', function () {
            var n = document.getElementById('nav');
            if (!n) return;
            n.querySelectorAll('.etx-nav-central, .etx-nav-prov').forEach(function (x) { x.remove(); });
            if (typeof window.etaaxPintarIconosNav === 'function') window.etaaxPintarIconosNav();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',iniciar);else iniciar();
})();
