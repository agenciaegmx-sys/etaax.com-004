/* ══ TUTORIALES Y GUÍAS DE USO DE LA APP WEB (Edwin, 27-nov) ═══════════════════
   «Tener el botón desplegable que muestre dos opciones: 1. Tutoriales (los
   videos) y 2. Guías de uso (los PDF)… en el hub de módulo en dos columnas,
   siempre desplegadas hacia abajo, agrupadas por submódulo, y que se puedan
   contraer… a diferencia de la página del módulo, que sí son botones con sus
   opciones ocultas». Y: «está bien que estén ocultos si no hay guías».

   Una sola verdad para tres lugares:
     · la PORTADA de cada módulo: botón «Tutoriales y guías» en la fila de la
       isla del nombre → dos botones (Tutoriales / Guías de uso) que despliegan
       su lista;
     · el HUB: debajo del módulo elegido, las dos columnas siempre abiertas;
     · el PANEL ADMIN: de aquí salen los módulos y submódulos para subirlas.
   Cada guía abre su VENTANA FLOTANTE (sin fondo oscuro, se arrastra y se
   minimiza) para seguir el tutorial mientras se trabaja.

   Datos: filas de `guias` (v45; las lee cualquiera con sesión) con
   `modulo` = el id del módulo y `categoria` = «Fin·ax · Ventas totales» (o
   solo «Fin·ax», que es «General»). El submódulo vive en la categoría para no
   pedir migración, y así Learn·ax, que agrupa por categoría, las ordena igual.
   Tutorial = video (archivo o YouTube); guía de uso = PDF.
   Sin guías no se enseña nada; sin un tipo, no se enseña ese tipo.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    var MODULOS = { recetas: 'Cost·ax', administrativo: 'Admin·ax', financiero: 'Fin·ax', equipo: 'Equip·ax', consultoria: 'Learn·ax' };
    var ORDEN = ['recetas', 'administrativo', 'financiero', 'equipo', 'consultoria'];
    var SUBMODULOS = {
        recetas:        ['Escandallos', 'Insumos', 'Inventarios', 'Requisiciones', 'Proveedores', 'Menú de la sucursal'],
        administrativo: ['Ingresos', 'Egresos', 'Caja fuerte', 'Clientes'],
        financiero:     ['Resumen financiero', 'Ventas totales', 'Gastos totales', 'KPIs', 'Estadísticas'],
        equipo:         ['Colaboradores', 'Horarios', 'Checklists', 'Evaluaciones', 'Organigrama', 'Perfiles de puesto'],
        consultoria:    ['Ventas por producto', 'Simulador de metas']
    };
    var SEP = ' · ';
    var SECCIONES = [
        { k: 'tut', nom: 'Tutoriales',   ic: 'rec-tutorial', una: 'video', varias: 'videos', vacio: 'tutoriales' },
        { k: 'pdf', nom: 'Guías de uso', ic: 'ins-ficha',    una: 'PDF',   varias: 'PDF',    vacio: 'guías de uso' }
    ];

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
    function ic(n, t) { return (typeof window.etaaxIcono === 'function') ? (window.etaaxIcono(n, { tam: t || 18 }) || '') : ''; }
    function ytId(u) { var m = String(u || '').match(/(?:youtu\.be\/|watch\?v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; }
    function categoria(mod, sub) { var n = MODULOS[mod] || ''; return (sub && sub !== 'General') ? n + SEP + sub : n; }
    function submodulo(g) { var c = String((g && g.categoria) || ''), i = c.indexOf(SEP); return i > -1 ? (c.slice(i + SEP.length).trim() || 'General') : 'General'; }
    function seccion(g) { return g.tipo === 'pdf' ? 'pdf' : 'tut'; }
    function tipoTxt(g) { return g.tipo === 'pdf' ? 'PDF' : (ytId(g.url) ? 'Video · YouTube' : 'Video'); }
    function cuenta(n, s) { return n + ' ' + (n === 1 ? s.una : s.varias); }

    /* ── Datos: UNA consulta por página, con lo de los cinco módulos ── */
    var _carga = null, _porId = {};
    function cargar() {
        if (_carga) return _carga;
        if (typeof window._supabase === 'undefined' || !window._supabase || !window._supabase.from) return Promise.resolve([]);
        _carga = Promise.resolve(window._supabase.from('guias').select('id,titulo,descripcion,categoria,tipo,url,modulo,orden,activa,created_at')
            .in('modulo', ORDEN).eq('activa', true).order('orden').order('created_at'))
            .then(function (r) {
                var l = (r && !r.error && r.data) ? r.data : [];
                l.forEach(function (g) { _porId[g.id] = g; });
                /* Vacío o con error no se guarda: pudo leerse antes de que
                   llegara la sesión (el hub inicia sesión en la misma página). */
                if (!l.length) _carga = null;
                return l;
            }, function () { _carga = null; return []; });
        return _carga;
    }
    function deModulo(lista, mod) { return lista.filter(function (g) { return g.modulo === mod && g.activa !== false; }); }
    /* Por submódulo, en el orden del módulo: General primero, luego sus
       submódulos como los enseña el sistema, y al final lo que no reconozca. */
    function grupos(lista, mod) {
        var orden = ['General'].concat(SUBMODULOS[mod] || []), por = {};
        lista.forEach(function (g) { var s = submodulo(g); (por[s] = por[s] || []).push(g); if (orden.indexOf(s) < 0) orden.push(s); });
        return orden.filter(function (s) { return por[s]; }).map(function (s) { return { sub: s, guias: por[s] }; });
    }
    function itemsHTML(lista, mod) {
        return grupos(lista, mod).map(function (gr) {
            return '<div class="etx-gu-grupo"><div class="etx-gu-grupo-t">' + esc(gr.sub) + '</div>' +
                gr.guias.map(function (g) {
                    return '<button type="button" class="etx-gu-it" data-guia="' + esc(g.id) + '">' +
                        '<span class="etx-gu-it-ic" aria-hidden="true">' + ic(g.tipo === 'pdf' ? 'ins-ficha' : 'rec-tutorial', 17) + '</span>' +
                        '<span class="etx-gu-it-tx"><b>' + esc(g.titulo) + '</b>' + (g.descripcion ? '<small>' + esc(g.descripcion) + '</small>' : '') +
                        '<em>' + esc(tipoTxt(g)) + '</em></span></button>';
                }).join('') + '</div>';
        }).join('');
    }
    /* Un clic en cualquier guía de la página (portada, hub) abre su ventana. */
    document.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-guia]') : null;
        if (!b) return;
        var g = _porId[b.getAttribute('data-guia')];
        if (!g) return;
        cerrarPop();
        abrir(g);
    });

    /* ══ LA PORTADA DEL MÓDULO ═════════════════════════════════════════════
       Botón en la fila de la isla del nombre, pegado a la orilla derecha de las
       tarjetas. Despliega DOS botones —Tutoriales y Guías de uso— con su lista
       oculta hasta que se tocan. */
    var _pop = null, _btn = null;
    function moduloDePortada() {
        var id = location.pathname.split('/')[1] || '';
        return MODULOS[id] ? id : '';
    }
    function embebido() {
        try { var q = new URLSearchParams(location.search); return q.get('embed') === '1' || q.get('solo') === '1' || window.parent !== window; } catch (e) { return false; }
    }
    function montarPortada() {
        var wrap = document.querySelector('.etx-isla-wrap'), mod = moduloDePortada();
        if (!wrap || !mod || embebido() || wrap.querySelector('.etx-gu-btn')) return;
        cargar().then(function (todas) {
            var l = deModulo(todas, mod);
            if (!l.length || wrap.querySelector('.etx-gu-btn')) return;      // sin guías, nada (Edwin)
            estilos();
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'etx-gu-btn'; b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
            b.title = 'Tutoriales y guías de uso de ' + MODULOS[mod];
            b.innerHTML = '<span class="etx-gu-btn-ic" aria-hidden="true">' + ic('rec-tutorial', 17) + '</span><span class="etx-gu-btn-tx">Tutoriales y guías</span><b>' + l.length + '</b>' +
                '<span class="etx-gu-flecha" aria-hidden="true"></span>';
            b.addEventListener('click', function (ev) { ev.stopPropagation(); if (_pop) cerrarPop(); else abrirPop(b, mod, l); });
            wrap.appendChild(b); _btn = b;
            /* Pegado a la orilla derecha de LAS TARJETAS (en varias portadas
               son más angostas que la franja de la isla). */
            var alinear = function () {
                var cards = [].filter.call(document.querySelectorAll('.cf-card, .dx-card, .etx-tool-card'), function (c) { return c.offsetParent; });
                if (!cards.length) return;
                var der = Math.max.apply(null, cards.map(function (c) { return c.getBoundingClientRect().right; }));
                b.style.right = Math.max(0, Math.round(wrap.getBoundingClientRect().right - der)) + 'px';
            };
            alinear(); window.addEventListener('resize', alinear);
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(alinear);
        });
    }
    function abrirPop(b, mod, l) {
        cerrarPop();
        var pop = document.createElement('div');
        pop.className = 'etx-gu-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Tutoriales y guías de uso de ' + MODULOS[mod]);
        pop.innerHTML = '<div class="etx-gu-pop-cab"><b>Aprende a usar ' + esc(MODULOS[mod]) + '</b><span>Videos y manuales de cada submódulo</span></div>' +
            SECCIONES.map(function (s) {
                var gs = l.filter(function (g) { return seccion(g) === s.k; });
                if (!gs.length) return '';
                return '<button type="button" class="etx-gu-acc" data-sec="' + s.k + '" aria-expanded="false">' +
                        '<span class="etx-gu-acc-ic" aria-hidden="true">' + ic(s.ic, 18) + '</span>' +
                        '<span class="etx-gu-acc-tx"><b>' + s.nom + '</b><small>Ver ' + (s.k === 'tut' ? 'tutoriales' : 'guías de uso') + ' · ' + cuenta(gs.length, s) + '</small></span>' +
                        '<span class="etx-gu-flecha" aria-hidden="true"></span></button>' +
                    '<div class="etx-gu-sec" data-sec="' + s.k + '" hidden>' + itemsHTML(gs, mod) + '</div>';
            }).join('');
        pop.addEventListener('click', function (ev) {
            var a = ev.target.closest('.etx-gu-acc'); if (!a) return;
            var sec = pop.querySelector('.etx-gu-sec[data-sec="' + a.getAttribute('data-sec') + '"]'), abre = sec.hidden;
            sec.hidden = !abre; a.setAttribute('aria-expanded', String(abre));
        });
        document.body.appendChild(pop);
        var r = b.getBoundingClientRect(), w = Math.min(400, window.innerWidth - 24);
        pop.style.width = w + 'px';
        pop.style.top = Math.round(r.bottom + 8) + 'px';
        pop.style.left = Math.round(Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))) + 'px';
        _pop = pop; b.setAttribute('aria-expanded', 'true');
        setTimeout(function () { document.addEventListener('click', _fuera); document.addEventListener('keydown', _esc); window.addEventListener('scroll', cerrarPop, { passive: true, once: true }); }, 0);
    }
    function _fuera(ev) { if (_pop && !_pop.contains(ev.target)) cerrarPop(); }
    function _esc(ev) { if (ev.key === 'Escape') cerrarPop(); }
    function cerrarPop() {
        if (_pop) { _pop.remove(); _pop = null; }
        if (_btn) _btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', _fuera); document.removeEventListener('keydown', _esc);
    }

    /* ══ EL HUB: DOS COLUMNAS SIEMPRE ABIERTAS ═════════════════════════════
       Debajo del módulo elegido. Cada columna se contrae con su encabezado; lo
       contraído se recuerda al cambiar de módulo. */
    var _plegado = { tut: false, pdf: false }, _hubPide = 0;
    function pintarHub(cont, mod) {
        if (!cont) return;
        var pide = ++_hubPide;
        if (!mod || !MODULOS[mod]) { cont.hidden = true; cont.innerHTML = ''; return; }
        cargar().then(function (todas) {
            if (pide !== _hubPide) return;            // ya eligieron otro módulo
            var l = deModulo(todas, mod);
            if (!l.length) { cont.hidden = true; cont.innerHTML = ''; return; }
            estilos();
            var cols = SECCIONES.map(function (s) {
                var gs = l.filter(function (g) { return seccion(g) === s.k; });
                if (!gs.length) return '';
                var pleg = !!_plegado[s.k];
                return '<section class="etx-gu-col' + (pleg ? ' plegada' : '') + '" data-sec="' + s.k + '">' +
                    '<button type="button" class="etx-gu-col-cab" data-sec="' + s.k + '" aria-expanded="' + (!pleg) + '">' +
                        '<span class="etx-gu-acc-ic" aria-hidden="true">' + ic(s.ic, 19) + '</span>' +
                        '<span class="etx-gu-acc-tx"><b>' + s.nom + '</b><small>' + esc(MODULOS[mod]) + ' · ' + cuenta(gs.length, s) + '</small></span>' +
                        '<span class="etx-gu-flecha" aria-hidden="true"></span></button>' +
                    '<div class="etx-gu-col-cuerpo"' + (pleg ? ' hidden' : '') + '>' + itemsHTML(gs, mod) + '</div></section>';
            }).filter(Boolean);
            cont.className = 'etx-gu-hub' + (cols.length === 1 ? ' una' : '');
            cont.innerHTML = cols.join('');
            cont.hidden = false;
            if (!cont._etxGu) {
                cont._etxGu = true;
                cont.addEventListener('click', function (ev) {
                    var c = ev.target.closest('.etx-gu-col-cab'); if (!c) return;
                    var k = c.getAttribute('data-sec'), col = c.parentNode, cuerpo = col.querySelector('.etx-gu-col-cuerpo');
                    _plegado[k] = !_plegado[k];
                    cuerpo.hidden = _plegado[k]; col.classList.toggle('plegada', _plegado[k]); c.setAttribute('aria-expanded', String(!_plegado[k]));
                });
            }
        });
    }

    /* ══ LA VENTANA FLOTANTE ════════════════════════════════════════════════
       Video (archivo) aquí mismo, YouTube con el reproductor sin cookies y el
       PDF incrustado en computadora (en tableta y teléfono el navegador no pinta
       un PDF dentro de una página: se abre en otra pestaña). */
    var _n = 0;
    function abrir(g) {
        estilos();
        var ya = document.querySelector('.etx-guia-flot[data-id="' + String(g.id).replace(/"/g, '') + '"]');
        if (ya) { ya.classList.remove('min'); ya.style.zIndex = String(10050 + (++_n)); return ya; }
        var yt = ytId(g.url), pdfAqui = g.tipo === 'pdf' && window.matchMedia && window.matchMedia('(pointer:fine)').matches && window.innerWidth > 900;
        var cuerpo;
        if (g.tipo === 'pdf') cuerpo = pdfAqui
            ? '<iframe class="etx-guia-pdf" src="' + esc(g.url) + '#view=FitH" title="' + esc(g.titulo) + '"></iframe>'
            : '<div class="etx-guia-abrir"><span aria-hidden="true">' + ic('ins-ficha', 34) + '</span><p>' + esc(g.descripcion || 'Guía de uso en PDF') + '</p><a class="etx-guia-btn" href="' + esc(g.url) + '" target="_blank" rel="noopener">Abrir el PDF</a></div>';
        else if (yt) cuerpo = '<iframe class="etx-guia-video" src="https://www.youtube-nocookie.com/embed/' + yt + '?rel=0" title="' + esc(g.titulo) + '" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>';
        else cuerpo = '<video class="etx-guia-video" src="' + esc(g.url) + '" controls playsinline preload="metadata"></video>';
        var w = document.createElement('div'), k = _n++, sub = submodulo(g);
        w.className = 'etx-guia-flot' + (g.tipo === 'pdf' && pdfAqui ? ' es-pdf' : '');
        w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', g.titulo); w.dataset.id = g.id;
        w.style.zIndex = String(10050 + k);
        w.innerHTML = '<div class="etx-guia-cab" title="Arrastra para moverla">' +
                '<span class="etx-guia-cab-ic" aria-hidden="true">' + ic(g.tipo === 'pdf' ? 'ins-ficha' : 'rec-tutorial', 16) + '</span>' +
                '<span class="etx-guia-cab-tx"><b>' + esc(g.titulo) + '</b><small>' + esc([MODULOS[g.modulo], sub !== 'General' ? sub : '', g.tipo === 'pdf' ? 'Guía de uso' : 'Tutorial'].filter(Boolean).join(' · ')) + '</small></span>' +
                '<button type="button" class="etx-guia-acc" data-acc="min" aria-label="Minimizar">' + ic('cjf-minimizar', 15) + '</button>' +
                '<button type="button" class="etx-guia-acc" data-acc="cerrar" aria-label="Cerrar">' + ic('cjf-cerrar', 15) + '</button>' +
            '</div><div class="etx-guia-cuerpo">' + cuerpo + '</div>';
        document.body.appendChild(w);
        /* Una encima de otra, corridas: dos guías abiertas no se tapan del todo. */
        var off = (k % 4) * 26;
        w.style.right = (16 + off) + 'px'; w.style.bottom = (16 + off) + 'px';
        w.addEventListener('pointerdown', function () { w.style.zIndex = String(10050 + (++_n)); });
        w.querySelector('[data-acc="cerrar"]').addEventListener('click', function () { w.remove(); });
        w.querySelector('[data-acc="min"]').addEventListener('click', function () { w.classList.toggle('min'); });
        arrastrable(w, w.querySelector('.etx-guia-cab'));
        return w;
    }
    function arrastrable(w, asa) {
        var x0, y0, l0, t0, mov = false;
        asa.addEventListener('pointerdown', function (ev) {
            if (ev.target.closest('button')) return;
            var r = w.getBoundingClientRect(); x0 = ev.clientX; y0 = ev.clientY; l0 = r.left; t0 = r.top; mov = true;
            w.style.left = l0 + 'px'; w.style.top = t0 + 'px'; w.style.right = 'auto'; w.style.bottom = 'auto';
            try { asa.setPointerCapture(ev.pointerId); } catch (e) {}
        });
        asa.addEventListener('pointermove', function (ev) {
            if (!mov) return;
            var r = w.getBoundingClientRect();
            w.style.left = Math.max(0, Math.min(window.innerWidth - r.width, l0 + ev.clientX - x0)) + 'px';
            w.style.top = Math.max(0, Math.min(window.innerHeight - 48, t0 + ev.clientY - y0)) + 'px';
        });
        var fin = function () { mov = false; };
        asa.addEventListener('pointerup', fin); asa.addEventListener('pointercancel', fin);
    }

    /* ══ ESTILOS (los usan páginas con hojas distintas: el hub no carga la de
       los módulos, por eso viajan aquí) ════════════════════════════════════ */
    function estilos() {
        if (document.getElementById('etxGuiasEstilos')) return;
        var P = 'var(--etx-ui-panel,var(--surface,#171611))', L = 'var(--etx-ui-line,var(--hub-line,var(--border,#3a3830)))',
            C = 'var(--etx-ui-cyan,var(--hub-dock-cyan,#8ce4ee))', CT = 'var(--etx-ui-cyan-tint,rgba(140,228,238,.1))', CL = 'var(--etx-ui-cyan-line,#537e83)',
            M = 'var(--etx-ui-muted,var(--text-dim,#9a968c))', T = 'var(--text,#f3efe6)';
        var st = document.createElement('style'); st.id = 'etxGuiasEstilos';
        st.textContent =
            /* Portada: el botón en la fila de la isla (que es sticky: sirve de ancla). */
            '.cf-hero.etx-isla-wrap .etx-gu-btn{position:absolute;right:0;top:0;pointer-events:auto;display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px 0 13px;border-radius:999px;' +
                'border:1px solid ' + L + ';background:' + P + ';color:' + T + ';cursor:pointer;font:600 13px/1 "DM Sans",sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.12);transition:border-color .15s,color .15s}' +
            '.cf-hero.etx-isla-wrap .etx-gu-btn:hover,.cf-hero.etx-isla-wrap .etx-gu-btn[aria-expanded="true"]{border-color:' + CL + ';color:' + C + '}' +
            '.etx-gu-btn-ic{display:inline-flex;color:' + C + '}.etx-gu-btn-ic .etx-ic{width:17px;height:17px}' +
            '.etx-gu-btn b{min-width:18px;height:18px;padding:0 5px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;background:' + CT + ';color:' + C + ';box-sizing:border-box}' +
            '.etx-gu-flecha{width:7px;height:7px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg) translate(-2px,-2px);opacity:.7;flex-shrink:0;transition:transform .18s}' +
            '[aria-expanded="true"]>.etx-gu-flecha{transform:rotate(-135deg) translate(-1px,-1px)}' +
            '.cf-hero.etx-isla-wrap:has(.etx-isla--mini) .etx-gu-btn-tx{display:none}' +
            '@media (max-width:620px){.cf-hero.etx-isla-wrap .etx-gu-btn-tx{display:none}}' +
            /* La lista de la portada. */
            '.etx-gu-pop{position:fixed;z-index:10040;max-height:min(66vh,560px);overflow:auto;box-sizing:border-box;padding:10px;border-radius:16px;background:' + P + ';border:1px solid ' + L + ';color:' + T + ';box-shadow:0 18px 44px rgba(0,0,0,.28)}' +
            '.etx-gu-pop-cab{display:flex;flex-direction:column;gap:2px;padding:6px 8px 10px}' +
            '.etx-gu-pop-cab b{font:700 15px/1.3 "DM Sans",sans-serif}.etx-gu-pop-cab span{font-size:12px;color:' + M + '}' +
            '.etx-gu-acc,.etx-gu-col-cab{display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:11px 12px;border-radius:12px;border:1px solid ' + L + ';background:transparent;color:inherit;cursor:pointer;font-family:inherit;margin-top:6px}' +
            '.etx-gu-acc:hover,.etx-gu-acc[aria-expanded="true"],.etx-gu-col-cab:hover{border-color:' + CL + '}' +
            '.etx-gu-acc-ic{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:' + CT + ';color:' + C + '}' +
            '.etx-gu-acc-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.etx-gu-acc-tx b{font-size:14px;font-weight:700}.etx-gu-acc-tx small{font-size:12px;color:' + M + '}' +
            '.etx-gu-sec{padding:4px 2px 2px}' +
            '.etx-gu-grupo{margin-top:8px}.etx-gu-grupo-t{font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:' + M + ';padding:2px 10px 4px}' +
            '.etx-gu-it{display:flex;align-items:flex-start;gap:10px;width:100%;text-align:left;padding:9px 10px;border-radius:11px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;font-family:inherit}' +
            '.etx-gu-it:hover,.etx-gu-it:focus-visible{border-color:' + CL + ';background:' + CT + ';outline:none}' +
            '.etx-gu-it-ic{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;background:' + CT + ';color:' + C + '}' +
            '.etx-gu-it-tx{display:flex;flex-direction:column;gap:2px;min-width:0}.etx-gu-it-tx b{font-size:13.5px;font-weight:600;overflow-wrap:anywhere}' +
            '.etx-gu-it-tx small{font-size:12px;color:' + M + ';line-height:1.4}.etx-gu-it-tx em{font-style:normal;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:' + M + ';margin-top:2px}' +
            /* El hub: dos columnas, siempre abiertas. */
            '.etx-gu-hub{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:4px 0 18px}.etx-gu-hub.una{grid-template-columns:minmax(0,1fr)}' +
            '.etx-gu-hub[hidden],.etx-gu-sec[hidden],.etx-gu-col-cuerpo[hidden]{display:none!important}' +
            '@media (max-width:760px){.etx-gu-hub{grid-template-columns:minmax(0,1fr)}}' +
            '.etx-gu-col{border:1px solid ' + L + ';border-radius:16px;padding:6px 10px 10px;background:' + P + ';min-width:0;align-self:start}' +
            '.etx-gu-col-cab{border-color:transparent;margin-top:0}.etx-gu-col.plegada{padding-bottom:6px}' +
            /* La ventana flotante. */
            '.etx-guia-flot{position:fixed;width:min(560px,calc(100vw - 24px));box-sizing:border-box;border-radius:16px;overflow:hidden;background:' + P + ';border:1px solid ' + L + ';color:' + T + ';box-shadow:0 22px 56px rgba(0,0,0,.36)}' +
            '.etx-guia-flot.es-pdf{width:min(760px,calc(100vw - 24px))}' +
            '.etx-guia-cab{display:flex;align-items:center;gap:10px;padding:10px 10px 10px 14px;cursor:grab;user-select:none;touch-action:none;border-bottom:1px solid ' + L + '}.etx-guia-cab:active{cursor:grabbing}' +
            '.etx-guia-cab-ic{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:' + CT + ';color:' + C + '}' +
            '.etx-guia-cab-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}.etx-guia-cab-tx b{font:600 13.5px/1.3 "DM Sans",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.etx-guia-cab-tx small{font-size:11px;color:' + M + '}' +
            '.etx-guia-acc{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:1px solid ' + L + ';background:transparent;color:' + T + ';cursor:pointer}' +
            '.etx-guia-acc:hover{border-color:' + CL + ';color:' + C + '}' +
            '.etx-guia-cuerpo{background:#000}.etx-guia-video{display:block;width:100%;aspect-ratio:16/9;border:0;background:#000}' +
            '.etx-guia-pdf{display:block;width:100%;height:min(70vh,640px);border:0;background:#fff}' +
            '.etx-guia-abrir{display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px 18px;background:' + P + ';text-align:center}' +
            '.etx-guia-abrir span{color:' + C + '}.etx-guia-abrir p{margin:0;font-size:13px;color:' + M + '}' +
            '.etx-guia-btn{display:inline-flex;align-items:center;min-height:40px;padding:0 18px;border-radius:10px;background:var(--etx-ui-terra-solido,#c45f37);color:var(--etx-ui-terra-tinta,#fff);font-weight:600;text-decoration:none}' +
            '.etx-guia-flot.min{width:min(320px,calc(100vw - 24px))}.etx-guia-flot.min .etx-guia-cuerpo{display:none}.etx-guia-flot.min .etx-guia-cab{border-bottom:0}';
        document.head.appendChild(st);
    }

    window.EtaaxGuias = {
        MODULOS: MODULOS, ORDEN: ORDEN, SUBMODULOS: SUBMODULOS, categoria: categoria, submodulo: submodulo,
        cargar: cargar, grupos: grupos, abrir: abrir, pintarHub: pintarHub, montarPortada: montarPortada,
        /* Para el panel admin: tras subir una guía, la siguiente lectura la trae. */
        olvidar: function () { _carga = null; }
    };
    /* La portada se monta sola cuando llegan la página y el cliente de Supabase. */
    function arrancar() { try { montarPortada(); } catch (e) {} }
    if (document.readyState === 'complete') arrancar(); else window.addEventListener('load', arrancar);
})();
