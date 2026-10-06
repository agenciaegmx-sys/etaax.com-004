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
            { href: 'resumen.html', icon: '🧮', text: 'Resumen' }
        ]},
        { label: 'Ingresos', links: [
            { href: 'ventas.html', icon: '💰', text: 'Ventas Totales' }
        ]},
        { label: 'Egresos', links: [
            { href: 'gastos-globales.html', icon: '📤', text: 'Gastos Totales' }
        ]},
        { label: 'Cuentas', links: [
            { href: 'cuentas-bancarias.html', icon: '🏦', text: 'Cuentas Bancarias' }
        ]},
        { label: 'Análisis', links: [
            { href: 'previsiones.html',  icon: '🔮', text: 'Previsiones' },
            { href: 'estadisticas.html', icon: '📊', text: 'Estadísticas' },
            { href: 'kpis.html',         icon: '🎯', text: 'KPIs' }
        ]}
    ];

    function archivoActual() {
        var p = (location.pathname || '').split('/').pop();
        return p || 'index.html';
    }

    function pintar() {
        var nav = document.getElementById('nav');
        if (!nav) return;
        var aqui = archivoActual();
        /* Fuera las secciones que trajera la página; el `nav-top` se queda. Sin
           esto quedarían las dos listas, la vieja y la nueva. */
        Array.prototype.slice.call(nav.querySelectorAll('.nav-section')).forEach(function (s) {
            s.parentNode.removeChild(s);
        });
        var html = SECCIONES.map(function (sec) {
            return '<div class="nav-section">' +
                '<div class="nav-section-label">' + sec.label + '</div>' +
                sec.links.map(function (l) {
                    var on = (l.href === aqui) ? ' active' : '';
                    return '<a href="' + l.href + '" class="nav-link' + on + '" data-tooltip="' + l.text + '">' +
                           '<span class="nav-icon">' + l.icon + '</span>' +
                           '<span class="nav-text">' + l.text + '</span></a>';
                }).join('') +
            '</div>';
        }).join('');
        nav.insertAdjacentHTML('beforeend', html);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pintar);
    else pintar();
})();
