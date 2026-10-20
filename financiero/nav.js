/* ══ LA BARRA LATERAL DEL MÓDULO FINANCIERO, EN UN SOLO LUGAR ═══════════════
   Estaba copiada a mano en cada página. Siete copias de la misma lista: basta
   con que una se quede atrás para que un sub-módulo deje de existir mientras
   estás en otro. Eso fue justo lo que pasó con Resumen —se agregó a su propia
   página y a ninguna más—, así que entrar a Ventas lo borraba del mapa y la
   única forma de volver era el botón de atrás.

   Aquí vive la lista y nada más. Cada página conserva su `nav-top` (el botón de
   expandir, el atajo al panel) y su estado abierto/cerrado; lo que se reemplaza
   son las SECCIONES de enlaces, que es lo que tiene que ser igual en todas.

   Para agregar un sub-módulo nuevo: un renglón en SECCIONES. Nada más. */
(function () {
    var SECCIONES = [
        { label: 'Resultados', links: [
            { href: 'resumen.html', icon: '🧮', text: 'Resumen financiero' }
        ]},
        { label: 'Ingresos', links: [
            { href: 'ventas.html', icon: '💰', text: 'Ventas Totales' }
        ]},
        { label: 'Egresos', links: [
            { href: 'gastos-globales.html', icon: '📤', text: 'Gastos Totales' }
        ]},
        { label: 'Cuentas', links: [
            { href: 'cuentas-bancarias.html', icon: '🏦', text: 'Cuentas Bancarias', soloSucursal: true }
        ]},
        { label: 'Análisis', links: [
            { href: 'previsiones.html',  icon: '🔮', text: 'Previsiones' },
            { href: 'estadisticas.html', icon: '📊', text: 'Estadísticas' },
            { href: 'kpis.html',         icon: '🎯', text: 'KPIs' }
        ]}
    ];

    /* EL ENCABEZADO DE LA BARRA, también una sola vez. Estaba copiado igual que
       los enlaces, y ya había empezado a separarse: Resumen traía 📊 «Salud
       Financiera» donde las otras seis traen 🗃️ «Panel Financiero». Son dos
       segundos de duda cada vez que se cambia de sub-módulo —«¿me salí del
       módulo?»— por un copiar y pegar. */
    var globalFinanciero = false;
    try { globalFinanciero = sessionStorage.getItem('etaax_fin_global') === '1'; } catch (e) {}
    var panelHref = globalFinanciero ? '/hub.html?negocios=1&panel=financiero' : 'index.html';
    var TOP =
        '<div class="nav-top">' +
            '<div class="nav-brand"><span class="nav-brand-sub">Salud Financiera</span></div>' +
            '<div class="nav-top-actions">' +
                '<a href="' + panelHref + '" class="nav-toggle nav-toggle-btn" data-tooltip="Panel Financiero" ' +
                   'style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;' +
                   'font-size:16px;line-height:1">🗃️</a>' +
                '<button class="nav-toggle nav-toggle-btn" id="navToggleBtn" data-tooltip="Expandir" ' +
                   'onclick="toggleNav()">▶<span class="nav-toggle-text" id="navToggleTxt">Expandir</span></button>' +
            '</div>' +
        '</div>';

    function archivoActual() {
        var p = (location.pathname || '').split('/').pop();
        return p ? (p.indexOf('.') < 0 ? p + '.html' : p) : 'index.html';
    }

    function pintar() {
        var nav = document.getElementById('nav');
        if (!nav) return;
        var aqui = archivoActual();
        /* Fuera lo que la página trajera: si quedara, se pintarían las dos
           barras, la vieja y la nueva, una debajo de la otra. */
        nav.innerHTML = '';
        nav.insertAdjacentHTML('beforeend', TOP);
        var html = SECCIONES.map(function (sec) {
            var links = sec.links.filter(function(l) { return !(globalFinanciero && l.soloSucursal); });
            if (!links.length) return '';
            return '<div class="nav-section">' +
                '<div class="nav-section-label">' + sec.label + '</div>' +
                links.map(function (l) {
                    var on = (l.href === aqui) ? ' active' : '';
                    return '<a href="' + l.href + '" class="nav-link' + on + '" data-tooltip="' + l.text + '">' +
                           '<span class="nav-icon">' + l.icon + '</span>' +
                           '<span class="nav-text">' + l.text + '</span></a>';
                }).join('') +
            '</div>';
        }).join('');
        nav.insertAdjacentHTML('beforeend', html);
        if (typeof window.etaaxPintarIconosNav === 'function') window.etaaxPintarIconosNav();
    }

    /* OJO CON EL ORDEN: nav-pref.js guarda si la barra va abierta o cerrada y
       pinta la flecha del botón. Como ese botón lo crea ESTE archivo, nav.js
       tiene que correr ANTES —si no, nav-pref acomoda una flecha que un
       instante después se reemplaza por la de default y el botón acaba diciendo
       lo contrario de lo que hace. En las páginas va justo antes de él. */
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pintar);
    else pintar();
})();
