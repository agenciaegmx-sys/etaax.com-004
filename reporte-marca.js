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
        // Logo: sucursal → negocio → nada
        var logo = '';
        if (sucId) { try { logo = localStorage.getItem('etaax_' + negId + '_suc_' + sucId + '_logo') || ''; } catch (e) {} }
        if (!logo) { try { logo = localStorage.getItem('etaax_' + negId + '_logo') || ''; } catch (e) {} }
        return {
            negocio:  ctx.negNombre || '',
            emoji:    ctx.negEmoji || '',
            sucursal: sucNombre,
            logo:     logo
        };
    };

    // Encabezado estándar de reporte (para hojas impresas: fondo blanco).
    // derechaHTML: bloque libre a la derecha (fecha, conteos, tipo de reporte…).
    window.etaaxReporteHeader = function (subtitulo, derechaHTML, opts) {
        var m = window.etaaxMarca(opts);
        var nombre = m.negocio || 'Negocio';
        var linea2 = [m.sucursal, subtitulo].filter(Boolean).join(' · ');
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;' +
                'padding:12px 20px;border-bottom:3px solid #3dbe7a">' +
            '<div style="display:flex;align-items:center;gap:12px;min-width:0">' +
                '<div style="font-family:\'Bebas Neue\',Arial,sans-serif;font-size:30px;font-weight:900;letter-spacing:2px;color:#1a1916;line-height:1">ETAAX<span style="color:#3dbe7a">.</span></div>' +
                '<div style="border-left:1px solid #ddd;padding-left:12px;min-width:0">' +
                    '<div style="font-family:\'Bebas Neue\',Arial,sans-serif;font-size:26px;letter-spacing:1px;color:#1a1916;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                        (m.emoji ? _esc(m.emoji) + ' ' : '') + _esc(nombre) + '</div>' +
                    (linea2 ? '<div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#888;margin-top:3px">' + _esc(linea2) + '</div>' : '') +
                '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:14px;flex-shrink:0">' +
                (m.logo ? '<img src="' + _esc(m.logo) + '" style="width:52px;height:52px;object-fit:contain;border:1px solid #eee;border-radius:6px" alt="logo">' : '') +
                (derechaHTML ? '<div style="text-align:right;font-size:9px;color:#aaa;line-height:1.7">' + derechaHTML + '</div>' : '') +
            '</div>' +
        '</div>';
    };

    // Pie estándar de reporte.
    window.etaaxReporteFooter = function (centroHTML) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;' +
                'padding:10px 20px;border-top:1px solid #e8e8e8;font-size:9px;color:#aaa">' +
            '<span>etaax.com · EGMx Consultoría Estratégica a&amp;b</span>' +
            '<span style="color:#3dbe7a;font-weight:700">' + (centroHTML || '') + '</span>' +
            '<span>' + new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) + '</span>' +
        '</div>';
    };
})();
