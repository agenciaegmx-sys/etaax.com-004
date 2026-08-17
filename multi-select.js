/* ============================================================================
   ETAAX — Filtro de SELECCIÓN MÚLTIPLE sobre un <select> que ya existe.

   Por qué así y no un <select multiple>: el nativo obliga a Ctrl+clic, no se ve
   qué hay elegido sin abrirlo y en móvil es inservible. Aquí el <select> original
   se queda en el DOM (oculto) como fuente de las OPCIONES y del `onchange` que
   ya tenían las páginas; encima se pinta un botón con su desplegable de palomitas.

   COMPATIBILIDAD: al elegir, el `value` del <select> se sigue actualizando —
   una sola opción elegida deja ese valor, y ninguna o varias dejan '' (= todas).
   Así, cualquier código viejo que lea `.value` y no conozca este control filtra
   de menos, nunca de más: enseña todo en vez de esconder lo que no debe.

   API:
     etaaxMulti.montar(idSelect, {label})  — crea o re-sincroniza el control
     etaaxMulti.vals(idSelect)  → ['Abarrotes','Bebidas']  ([] = todas)
     etaaxMulti.txt(idSelect)   → 'Abarrotes, Bebidas'     ('' = todas)
     etaaxMulti.limpiar(idSelect)
   ============================================================================ */
(function () {
    var SEL = {};      // idSelect → { vals: {valor:1}, label: 'familias' }
    var POP = null;    // desplegable abierto

    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _st(id) { return (SEL[id] = SEL[id] || { vals: {}, label: '' }); }
    function _sel(id) { return document.getElementById(id); }

    // Opciones reales del <select>, sin la primera ("Todas las …").
    function _opciones(el) {
        var out = [];
        for (var i = 0; i < el.options.length; i++) {
            var o = el.options[i];
            if (o.value !== '') out.push({ v: o.value, t: o.textContent });
        }
        return out;
    }
    function _todasTxt(el) {
        return (el.options[0] && el.options[0].textContent) || 'Todas';
    }
    function _elegidos(id) {
        var st = _st(id);
        return Object.keys(st.vals).filter(function (k) { return st.vals[k]; });
    }

    function _pintarBtn(id) {
        var el = _sel(id); if (!el) return;
        var btn = document.getElementById(id + '__btn'); if (!btn) return;
        var n = _elegidos(id).length, total = _opciones(el).length;
        var txt;
        if (!n || n === total) txt = _todasTxt(el);           // ninguna o todas = sin filtro
        else if (n === 1)      txt = _elegidos(id)[0];
        else                   txt = n + ' ' + (_st(id).label || 'elegidas');
        btn.innerHTML = '<span class="ems-txt">' + _esc(txt) + '</span><span class="ems-car">▾</span>';
        btn.classList.toggle('ems-activo', !!n && n !== total);
    }

    /* El <select> conserva un valor USABLE: una sola elección deja ese valor;
       ninguna o varias dejan '' para que el código viejo no filtre de más. */
    function _sincSelect(id) {
        var el = _sel(id); if (!el) return;
        var e = _elegidos(id);
        el.value = (e.length === 1) ? e[0] : '';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function cerrar() { if (POP) { POP.remove(); POP = null; } }

    function _abrir(ev, id) {
        ev.stopPropagation();
        var yaAbierto = POP && POP.getAttribute('data-para') === id;
        cerrar();
        if (yaAbierto) return;
        var el = _sel(id); if (!el) return;
        var ops = _opciones(el), st = _st(id);
        if (!ops.length) return;

        var pop = document.createElement('div');
        pop.className = 'ems-pop';
        pop.setAttribute('data-para', id);
        pop.innerHTML =
            '<button type="button" class="ems-todas">' + _esc(_todasTxt(el)) + '</button>' +
            '<div class="ems-sep"></div>' +
            '<div class="ems-lista">' + ops.map(function (o) {
                return '<label><input type="checkbox" value="' + _esc(o.v) + '"' +
                    (st.vals[o.v] ? ' checked' : '') + '>' + _esc(o.t) + '</label>';
            }).join('') + '</div>';
        document.body.appendChild(pop);

        pop.querySelector('.ems-todas').onclick = function () {
            st.vals = {}; _pintarBtn(id); _sincSelect(id); cerrar();
        };
        pop.querySelectorAll('input[type=checkbox]').forEach(function (c) {
            c.onchange = function () {
                if (c.checked) st.vals[c.value] = 1; else delete st.vals[c.value];
                _pintarBtn(id); _sincSelect(id);
            };
        });

        var r = document.getElementById(id + '__btn').getBoundingClientRect();
        var w = pop.offsetWidth, h = pop.offsetHeight;
        pop.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
        pop.style.top  = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 4) + 'px';
        POP = pop;
    }

    function montar(id, opts) {
        var el = _sel(id); if (!el) return;
        opts = opts || {};
        var st = _st(id);
        if (opts.label) st.label = opts.label;

        // Las opciones se repueblan solas (cargarFiltros, cascadas): lo que ya no
        // existe se suelta, si no el filtro dejaría la lista vacía sin explicar por qué.
        var vivos = {};
        _opciones(el).forEach(function (o) { vivos[o.v] = 1; });
        Object.keys(st.vals).forEach(function (v) { if (!vivos[v]) delete st.vals[v]; });

        var btn = document.getElementById(id + '__btn');
        if (!btn) {
            el.style.display = 'none';
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = id + '__btn';
            btn.className = (el.className || '') + ' ems-btn';
            // Hereda el aspecto del <select> que sustituye: unas páginas lo visten
            // con clase y otras con estilos en línea, y el control debe verse igual
            // que los filtros de al lado en las dos.
            var inl = el.getAttribute('style');
            if (inl) btn.style.cssText = inl.replace(/display\s*:[^;]*;?/gi, '');
            btn.onclick = function (ev) { _abrir(ev, id); };
            el.parentNode.insertBefore(btn, el.nextSibling);
        }
        _pintarBtn(id);
    }

    document.addEventListener('click', function (e) {
        if (!POP || !e.target.closest) return;
        if (e.target.closest('.ems-pop') || e.target.closest('.ems-btn')) return;
        cerrar();
    });
    window.addEventListener('scroll', cerrar, true);
    window.addEventListener('resize', cerrar);

    var CSS =
        '.ems-btn{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;' +
            'cursor:pointer;text-align:left;font-family:inherit}' +
        '.ems-btn .ems-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.ems-btn .ems-car{opacity:.6;font-size:10px;flex:0 0 auto}' +
        '.ems-btn.ems-activo{border-color:var(--accent,#f5c842);color:var(--accent,#f5c842)}' +
        '.ems-pop{position:fixed;z-index:10600;min-width:230px;max-width:340px;padding:6px;' +
            'background:var(--surface,#171614);border:1px solid var(--border,#2a2825);border-radius:10px;' +
            'box-shadow:0 16px 44px rgba(0,0,0,.45)}' +
        '.ems-pop .ems-lista{max-height:300px;overflow:auto;display:flex;flex-direction:column;gap:1px}' +
        '.ems-pop label{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:7px;' +
            'font-size:12.5px;color:var(--text,#f0ece4);cursor:pointer;font-family:inherit}' +
        '.ems-pop label:hover{background:var(--surface2,#201e1b)}' +
        '.ems-pop input[type=checkbox]{width:15px;height:15px;accent-color:var(--accent,#f5c842);cursor:pointer;flex:0 0 auto}' +
        '.ems-pop .ems-todas{width:100%;text-align:left;background:none;border:none;cursor:pointer;' +
            'font-family:inherit;font-size:12.5px;color:var(--text-muted,#a8a29a);padding:7px 10px;border-radius:7px}' +
        '.ems-pop .ems-todas:hover{background:var(--surface2,#201e1b);color:var(--text,#f0ece4)}' +
        '.ems-pop .ems-sep{height:1px;background:var(--border,#2a2825);margin:4px 2px}';
    var st = document.createElement('style');
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);

    window.etaaxMulti = {
        montar: montar,
        vals: function (id) { return _elegidos(id); },
        txt:  function (id) { return _elegidos(id).join(', '); },
        limpiar: function (id) { _st(id).vals = {}; _pintarBtn(id); _sincSelect(id); },
        cerrar: cerrar
    };
})();
