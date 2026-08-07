/* ============================================================================
   ETAAX — Marca compartida para REPORTES impresos / PDF
   Un solo encabezado y pie para TODOS los formatos (carátula de costos,
   inventarios, recetas, requisiciones, consultoría…): nombre del negocio,
   sucursal y logo salen SOLOS del contexto — ya no se teclean ni se suben
   en cada reporte.

   API global:
     etaaxMarca(opts)                → { negocio, emoji, sucursal, logo }
       · logo: primero el de la SUCURSAL activa; si no hay, el del NEGOCIO
         (Configuración); si no hay ninguno, '' (queda solo la marca ETAAX).
       · opts.sucursalId: forzar una sucursal (ej. la del inventario impreso).
     etaaxReporteHeader(subtitulo, derechaHTML, opts) → HTML del encabezado
       estándar (fondo blanco, borde verde) listo para impresión.
     etaaxReporteFooter(centroHTML)  → HTML del pie estándar.
   ============================================================================ */
(function () {
    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _ctx() {
        try { return JSON.parse(localStorage.getItem('etaax_ctx') || 'null') || {}; }
        catch (e) { return {}; }
    }
    function _negId() { return localStorage.getItem('etaax_negocio_activo') || ''; }

    window.etaaxMarca = function (opts) {
        opts = opts || {};
        var ctx = _ctx(), negId = _negId();
        var sucId = (opts.sucursalId !== undefined)
            ? (opts.sucursalId || '')
            : (localStorage.getItem('etaax_sucursal_activa') || '');
        // Nombre real de la sucursal desde la lista del negocio
        var sucNombre = '';
        if (sucId) {
            try {
                var sucs = JSON.parse(localStorage.getItem('etaax_' + negId + '_sucursales') || '[]');
                var s = null;
                for (var i = 0; i < sucs.length; i++) { if (sucs[i] && sucs[i].id === sucId) { s = sucs[i]; break; } }
                sucNombre = (s && s.nombre) || (sucId === 'suc_principal' ? 'Matriz' : (ctx.sucNombre || ''));
            } catch (e) { sucNombre = ctx.sucNombre || ''; }
        }
        // Identidad visual: UN solo logo con JERARQUÍA (caso corporativo multi-marca):
        // el logo de la SUCURSAL si lo tiene (cada sucursal puede ser una marca
        // distinta: 2 Mammut + 3 Xaneque + 1 Gainsburg) → si no, el del NEGOCIO
        // (mono-marca: las sucursales heredan). Nunca dos imágenes juntas.
        var logoNegocio = '', logoSucursal = '';
        try { logoNegocio = localStorage.getItem('etaax_' + negId + '_logo') || ''; } catch (e) {}
        if (sucId) { try { logoSucursal = localStorage.getItem('etaax_' + negId + '_suc_' + sucId + '_logo') || ''; } catch (e) {} }
        var sucColor = '';
        if (sucId) {
            try { sucColor = (JSON.parse(localStorage.getItem('etaax_' + negId + '_suc_' + sucId) || '{}').color) || ''; } catch (e) {}
            if (!sucColor) sucColor = ctx.negColor || '';
        }
        return {
            negocio:       ctx.negNombre || '',
            emoji:         ctx.negEmoji || '',
            sucursal:      sucNombre,
            sucursalColor: sucColor,
            logo:          logoSucursal || logoNegocio, // jerarquía: marca de la sucursal → marca del negocio
            logoNegocio:   logoNegocio,
            logoSucursal:  logoSucursal
        };
    };

    // ── Logo oficial ETAAX (wordmark eta·ax) como SVG inline, recolorable ──────
    // variant 'claro' (default): letras tinta + punto verde (para blanco/impresión).
    // variant 'oscuro': letras crema + punto verde (para fondos oscuros).
    // `hole` pinta las contras (huecos de e/a) con el color de la superficie.
    window.etaaxLogoSVG = function (opts) {
        opts = opts || {};
        var oscuro = (opts.variant === 'oscuro' || opts.variant === 'dark');
        var ink  = opts.ink  || (oscuro ? '#f0ece4' : '#0f0e0c');
        var hole = opts.hole || (oscuro ? '#0f0e0c' : '#ffffff');
        var dot  = opts.dot  || '#3dbe7a';
        var h    = opts.height || 30;
        var extra = (opts.style ? ' style="' + opts.style + '"' : '');
        return '<svg xmlns="http://www.w3.org/2000/svg" height="' + h + '" viewBox="4650 98600 244400 53400" role="img" aria-label="ETAAX"' + extra + '>' +
            '<g transform="matrix(1172.115912,0,0,1172.115912,3418.038957,87250.941841)">' +
                '<g transform="matrix(1,0,0,1.05042,-2.857143,-0.529412)"><path d="M4,31C4,19.5 12.5,10.5 25,10.5C37.5,10.5 45.5,19.5 45.5,30.5C45.5,32 45.3,33.5 45,35L14,35C15.5,40.5 19.5,44 25,44C29.5,44 33,42 35,39.5L43.5,43.5C40,49.5 33,53 25,53C12.5,53 4,44 4,31Z" fill="' + ink + '"/></g>' +
                '<g transform="matrix(1,0,0,1,-2.857143,0)"><path d="M14.5,28L37,28C35.5,23 31.5,20 25.5,20C19.5,20 16,23 14.5,28Z" fill="' + hole + '"/></g>' +
                '<path d="M52,12L61,12L61,21L72,21L72,30L61,30L61,42C61,44.8 62.5,46 65,46L72,46L72,54.5L64.5,54.5C57,54.5 52,50.5 52,43L52,30L46,30L46,21L52,21L52,12Z" fill="' + ink + '"/>' +
                '<g transform="matrix(1,0,0,1,-3.571429,0)"><path d="M78,41C78,34.5 83.5,30.5 92.5,29.5L104,28.5L104,27.5C104,23.5 101.5,21 97,21C93,21 90,23 89,26.5L80.5,24C82.5,17.5 89,13 97,13C107.5,13 113,18.5 113,28.5L113,54.5L104,54.5L104,51C102,53.5 98.5,55 94,55C85.5,55 78,50.5 78,41Z" fill="' + ink + '"/></g>' +
                '<g transform="matrix(1,0,0,1,-2.857143,0)"><path d="M104,37L95.5,38C92.5,38.5 90.5,40 90.5,42.5C90.5,45 92.5,46.5 95.5,46.5C101,46.5 104,43.5 104,39L104,37Z" fill="' + hole + '"/></g>' +
                '<path d="M126,41C126,34.5 131.5,30.5 140.5,29.5L152,28.5L152,27.5C152,23.5 149.5,21 145,21C141,21 138,23 137,26.5L128.5,24C130.5,17.5 137,13 145,13C155.5,13 161,18.5 161,28.5L161,54.5L152,54.5L152,51C150,53.5 146.5,55 142,55C133.5,55 126,50.5 126,41Z" fill="' + ink + '"/>' +
                '<path d="M152,37L143.5,38C140.5,38.5 138.5,40 138.5,42.5C138.5,45 140.5,46.5 143.5,46.5C149,46.5 152,43.5 152,39L152,37Z" fill="' + hole + '"/>' +
                '<g transform="matrix(1,0,0,1,-3.571429,0)"><path d="M168,13L179,13L190,30L201,13L212,13L196.5,34.5L213,54.5L202,54.5L190,38.5L178,54.5L167,54.5L183.5,34.5L168,13Z" fill="' + ink + '"/></g>' +
                '<g transform="matrix(1.086406,0,0,1.086406,70.712678,4.362883)"><circle cx="45" cy="11" r="6" fill="' + dot + '"/></g>' +
            '</g></svg>';
    };

    // Encabezado estándar de reporte (para hojas impresas: fondo blanco).
    // derechaHTML: bloque libre a la derecha (fecha, conteos, tipo de reporte…).
    window.etaaxReporteHeader = function (subtitulo, derechaHTML, opts) {
        var m = window.etaaxMarca(opts);
        var nombre = m.negocio || 'Negocio';
        // Jerarquía de texto: nombre (grande) → sucursal (media, con su puntito de
        // color) → subtítulo/fechas (pequeño). Antes sucursal y fechas iban juntas
        // del mismo tamaño y se leía como un bloque plano de 3 renglones.
        var _dot = (m.sucursal && m.sucursalColor)
            ? '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + _esc(m.sucursalColor) + ';margin-right:5px;vertical-align:middle"></span>'
            : '';
        var linea2 =
            (m.sucursal ? '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#555;font-weight:700;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _dot + _esc(m.sucursal) + '</div>' : '') +
            (subtitulo ? '<div style="font-size:7.5px;letter-spacing:1px;text-transform:uppercase;color:#999;margin-top:2px;line-height:1.5">' + _esc(subtitulo) + '</div>' : '');
        // Identidad junto al nombre: el logo BASE de la marca; sin logo → emoji.
        var identidad = m.logo
            ? '<img src="' + _esc(m.logo) + '" style="width:46px;height:46px;object-fit:contain;border:1px solid #eee;border-radius:8px;flex-shrink:0;background:#fff" alt="logo">'
            : (m.emoji ? '<span style="font-size:28px;line-height:1;flex-shrink:0">' + _esc(m.emoji) + '</span>' : '');
        // Logo como <img> con data-URI (NO svg inline): así se re-pinta en CADA hoja al
        // imprimir. Chrome no vuelve a pintar un <svg> inline dentro de un <thead> repetido.
        var _logoImg = '<img src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.etaaxLogoSVG({ variant:'claro', height:26 })) + '" alt="ETAAX" style="height:26px;width:auto;display:block;flex-shrink:0">';
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;' +
                'padding:12px 20px;border-bottom:3px solid #3dbe7a">' +
            '<div style="display:flex;align-items:center;gap:12px;min-width:0">' +
                _logoImg +
                '<div style="border-left:1px solid #ddd;padding-left:12px;min-width:0;display:flex;align-items:center;gap:10px">' +
                    identidad +
                    '<div style="min-width:0">' +
                        '<div style="font-family:\'Bebas Neue\',Arial,sans-serif;font-size:26px;letter-spacing:1px;color:#1a1916;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(nombre) + '</div>' +
                        linea2 + /* ya viene con su propia jerarquía (sucursal + subtítulo) y escapada */
                    '</div>' +
                '</div>' +
            '</div>' +
            (derechaHTML ? '<div style="text-align:right;font-size:9px;color:#aaa;line-height:1.7;flex-shrink:0">' + derechaHTML + '</div>' : '') +
        '</div>';
    };

    // Documento de reporte COMPLETO listo para imprimir/PDF (carta vertical). Usa una
    // tabla contenedora: el <thead> (header ETAAX) y el <tfoot> (pie) se REPITEN en cada
    // hoja al imprimir; el contenido va en <tbody>. Los <table class="rt"> de datos también
    // repiten sus títulos de columna por hoja. cfg: { titulo, subtitulo, derecha, cuerpo, pie, opts }.
    window.etaaxReporteDoc = function (cfg) {
        cfg = cfg || {};
        var header = window.etaaxReporteHeader(cfg.subtitulo || '', cfg.derecha || '', cfg.opts);
        var footer = window.etaaxReporteFooter(cfg.pie || '');
        var titulo = _esc(cfg.titulo || 'Reporte ETAAX');
        return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>' + titulo + '</title>' +
            '<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">' +
            '<style>' +
            '*{margin:0;padding:0;box-sizing:border-box}' +
            'body{font-family:\'DM Sans\',sans-serif;color:#1a1916;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
            '.rep{width:100%;border-collapse:collapse}' +
            '.rep>thead{display:table-header-group}' +   /* header se repite ARRIBA de cada hoja */
            '.rep>tfoot{display:table-footer-group}' +   /* pie se repite ABAJO de cada hoja */
            '.rep>thead>tr>td,.rep>tfoot>tr>td{padding:0}' +
            '.rbody{padding:16px 30px 20px}' +
            '.rsec{font-family:\'Bebas Neue\',sans-serif;font-size:16px;letter-spacing:2px;color:#1a1916;margin:20px 0 11px;padding-bottom:5px;border-bottom:2px solid #3dbe7a;break-after:avoid;page-break-after:avoid}' +
            '.rsec:first-of-type{margin-top:2px}' +
            '.rgrid{display:grid;gap:10px;break-inside:avoid;page-break-inside:avoid}' +
            '.rcard{border:1px solid #ececec;border-radius:9px;padding:12px 14px;background:#fafafa}' +
            '.rcard .l{font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:#999;margin-bottom:6px;font-weight:700}' +
            '.rcard .v{font-family:\'Bebas Neue\',sans-serif;font-size:25px;letter-spacing:1px;line-height:1;color:#1a1916}' +
            '.rcard .s{font-size:9.5px;color:#8a8a8a;margin-top:5px;line-height:1.4}' +
            'table.rt{width:100%;border-collapse:collapse}' +
            'table.rt thead{display:table-header-group}' +   /* títulos de columna se repiten por hoja */
            'table.rt tr{break-inside:avoid;page-break-inside:avoid}' +
            'table.rt thead th{background:#f5f5f5;padding:8px 10px;font-size:8px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:1.2px;border-bottom:2px solid #e0e0e0;text-align:right}' +
            'table.rt thead th:first-child{text-align:left}' +
            'table.rt tbody td{padding:7px 10px;font-size:11.5px;border-bottom:1px solid #f1f1f1;text-align:right;font-variant-numeric:tabular-nums}' +
            'table.rt tbody td:first-child{text-align:left;font-weight:600}' +
            'table.rt tbody tr:nth-child(even){background:#fafafa}' +
            'table.rt tfoot{display:table-row-group}' +   /* el Total va UNA vez al final (no se repite por hoja) */
            'table.rt tfoot td{background:#f8f8f8;border-top:2px solid #3dbe7a;padding:9px 10px;font-size:12px;font-weight:700;text-align:right}' +
            'table.rt tfoot td:first-child{text-align:left}' +
            '.rbadge{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 9px;border-radius:20px}' +
            // El PIE va como elemento aparte y se FIJA (position:fixed) al fondo de CADA hoja
            // al imprimir → siempre hasta abajo, aunque el contenido no llene la página.
            // OJO: en impresión, bottom:0 de un fixed es el borde del ÁREA DE CONTENIDO, no
            // el del papel: el pie se pintaba ENCIMA de la última franja de cada hoja y
            // cortaba lo de abajo (se comían los rótulos de día de las gráficas). La banda
            // se reserva ahora en el FLUJO con un <tfoot> espaciador (Chrome lo repite y le
            // aparta el alto en cada hoja) y el margen inferior de @page baja a 0.5cm → el
            // pie queda más abajo y el contenido gana ~0.6cm de alto útil por hoja.
            '.rfoot-sp{height:0;padding:0;border:0}' +
            '@media screen{body{background:#eee;padding:20px 20px 0}.rep{max-width:21.6cm;margin:0 auto;background:#fff;box-shadow:0 6px 30px rgba(0,0,0,.15)}.rfoot{max-width:21.6cm;margin:0 auto 24px;background:#fff;box-shadow:0 12px 30px rgba(0,0,0,.15)}}' +
            '@media print{@page{size:letter portrait;margin:0.5cm 0}.rfoot{position:fixed;left:0;right:0;bottom:0;background:#fff}.rfoot-sp{height:30px}}' +
            '</style></head><body>' +
            '<table class="rep">' +
                '<thead><tr><td>' + header + '</td></tr></thead>' +
                '<tbody><tr><td><div class="rbody">' + (cfg.cuerpo || '') + '</div></td></tr></tbody>' +
                /* espaciador: le aparta al pie fijo su franja en CADA hoja impresa */
                '<tfoot><tr><td class="rfoot-sp"></td></tr></tfoot>' +
            '</table>' +
            '<div class="rfoot">' + footer + '</div>' +
            '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},300);}<\/scr' + 'ipt></body></html>';
    };

    /* Abre un reporte ya armado para imprimir. Primero intenta la ventana nueva
       (lo de siempre); si el navegador la BLOQUEA —y lo hace sin avisar, así que
       desde la app parece que el botón no sirve— cae a un iframe oculto de la
       misma página: se imprime igual, sin depender de las ventanas emergentes. */
    window.etaaxAbrirReporte = function (html) {
        var w = null;
        try { w = window.open('', '_blank'); } catch (e) {}
        if (w && w.document) { w.document.write(html); w.document.close(); return true; }
        var ifr = document.createElement('iframe');
        ifr.setAttribute('aria-hidden', 'true');
        ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
        document.body.appendChild(ifr);
        try {
            var d = ifr.contentWindow.document;
            d.open();
            // El documento se auto-imprime al cargar; en el iframe lo disparamos
            // nosotros para controlar el momento y no imprimir dos veces.
            d.write(String(html).replace('window.print();', ''));
            d.close();
        } catch (e) { try { ifr.remove(); } catch (e2) {} return false; }
        setTimeout(function () {
            try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) {}
            setTimeout(function () { try { ifr.remove(); } catch (e) {} }, 60000);
        }, 450);
        return true;
    };

    // Pie estándar de reporte.
    window.etaaxReporteFooter = function (centroHTML) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;' +
                'padding:7px 20px;border-top:1px solid #e8e8e8;font-size:9px;color:#aaa">' +
            '<span>etaax.com · EGMx Consultoría Estratégica a&amp;b</span>' +
            '<span style="color:#3dbe7a;font-weight:700">' + (centroHTML || '') + '</span>' +
            '<span>' + new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) + '</span>' +
        '</div>';
    };
})();
