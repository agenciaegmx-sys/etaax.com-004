/* ════════════════════════════════════════════════════════════════
   ETAAX · Guías de uso (módulo Aprende y Analiza)

   MATERIAL BASE DE ETAAX, no de cada negocio. Las tablas `guias` y
   `guia_secciones` (v45) no llevan `negocio_id`: Edwin publica una vez y lo
   ve TODA sucursal de TODO cliente. Con negocio habría que subir siete copias
   del mismo tutorial y mantenerlas al día una por una.

   Quién ve qué:
     · leer  → cualquiera con sesión, colaboradores incluidos. Un barman
               necesita el manual tanto como el dueño (por eso page-guard deja
               pasar /consultoria/guias sin pedir permiso de financiero).
     · subir → SOLO el admin de plataforma. Y no basta con esconder los
               botones: la RLS de las tablas y del bucket lo vuelven a checar.
   ════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var ADMIN_EMAIL = 'admin@etaax.com';
    var _guias = [], _secciones = [], _esAdmin = false;

    function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
    function e(s) { return (window.etx ? etx(s) : String(s == null ? '' : s)); }
    function $(id) { return document.getElementById(id); }

    /* Id de un video de YouTube, venga como venga la URL: youtu.be, watch?v=,
       /embed/, /shorts/. Solo se usa para validar que el link sí sea de YouTube
       antes de publicarlo — un enlace roto en el manual se descubre tarde. */
    function ytId(url) {
        var m = String(url || '').match(
            /(?:youtu\.be\/|watch\?v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
        return m ? m[1] : '';
    }

    var ICONO   = { pdf: '📕', video: '▶️', link: '🔗' };
    var ETIQUETA = { pdf: 'PDF', video: 'Video', link: 'Enlace' };

    /* ── Carga ──────────────────────────────────────────────────── */
    async function cargar() {
        var cont = $('listaGuias');
        if (typeof _supabase === 'undefined') { cont.innerHTML = vacio('Sin conexión con el servidor.'); return; }

        var rg = await _supabase.from('guias').select('*').order('orden').order('created_at');
        if (rg.error) {
            // 42P01 = la tabla no existe → falta correr v45. Se dice con todas sus
            // letras: un "error" genérico no lleva a ningún lado.
            cont.innerHTML = vacio(rg.error.code === '42P01'
                ? 'Falta correr la migración <b>v45</b> en Supabase para que existan las guías.'
                : 'No se pudieron cargar las guías: ' + e(rg.error.message));
            return;
        }
        _guias = rg.data || [];

        var rs = await _supabase.from('guia_secciones').select('*').order('orden').order('nombre');
        // Si la tabla de secciones aún no existe (v45 vieja), se sigue adelante
        // derivándolas de las guías: el catálogo se ve igual, solo no hay vacías.
        _secciones = (rs && !rs.error && rs.data) ? rs.data : [];
        pintar();
    }

    function vacio(html) { return '<div class="gu-vacio">' + html + '</div>'; }

    /* ── Catálogo ───────────────────────────────────────────────── */
    function pintar() {
        var cont = $('listaGuias');
        // El admin ve TODAS (incluidas las ocultas, para poder retomarlas);
        // el cliente solo las activas. La RLS ya filtra, esto es el segundo cerrojo.
        var lista = _esAdmin ? _guias : _guias.filter(function (g) { return g.activa !== false; });

        // Orden de secciones: primero las declaradas (con su orden), después las
        // que solo existen porque alguna guía las menciona.
        var orden = [], vistas = {};
        _secciones.forEach(function (s) { if (!vistas[s.nombre]) { vistas[s.nombre] = 1; orden.push(s.nombre); } });
        lista.forEach(function (g) {
            var c = (g.categoria || '').trim() || 'General';
            if (!vistas[c]) { vistas[c] = 1; orden.push(c); }
        });

        var porSec = {};
        lista.forEach(function (g) {
            var c = (g.categoria || '').trim() || 'General';
            (porSec[c] = porSec[c] || []).push(g);
        });

        // Al cliente NO se le enseñan secciones vacías: un índice lleno de títulos
        // sin contenido se lee como un producto a medias.
        var visibles = orden.filter(function (c) { return _esAdmin || (porSec[c] && porSec[c].length); });

        if (!lista.length && !(_esAdmin && visibles.length)) {
            cont.innerHTML = vacio(_esAdmin
                ? 'Todavía no hay guías. Empieza con <b>Subir nueva guía</b>.'
                : 'Todavía no hay guías publicadas.<br>Están en camino.');
            return;
        }

        cont.innerHTML = visibles.map(function (c) {
            var gs = porSec[c] || [];
            return '<div class="gu-sec">' +
                '<div class="gu-sec-hdr">' +
                    '<span class="gu-sec-t">' + e(c) + '</span>' +
                    '<span class="gu-sec-n">' + gs.length + (gs.length === 1 ? ' guía' : ' guías') + '</span>' +
                    (_esAdmin ? '<span class="gu-sec-acc">' +
                        '<button class="gu-mini" onclick="_abrirGuia(\'' + e(c) + '\')">+ Guía</button>' +
                        (gs.length ? '' : '<button class="gu-mini" onclick="_borrarSeccion(\'' + e(c) + '\')">Eliminar</button>') +
                    '</span>' : '') +
                '</div>' +
                (gs.length
                    ? '<div class="gu-grid">' + gs.map(tarjeta).join('') + '</div>'
                    : '<div style="font-size:11.5px;color:var(--text-dim);padding:6px 2px">Sección vacía — tus clientes no la ven todavía.</div>') +
            '</div>';
        }).join('');
    }

    function tarjeta(g) {
        var oculta = g.activa === false;
        return '<a class="gu-card" href="' + e(g.url) + '" target="_blank" rel="noopener"' +
            (oculta ? ' style="opacity:.45"' : '') + '>' +
            '<div class="gu-card-top"><span class="gu-ico">' + (ICONO[g.tipo] || '📄') + '</span>' +
                '<span class="gu-tag">' + e(ETIQUETA[g.tipo] || g.tipo) +
                    (g.audiencia === 'operativa' ? ' · operativa' : g.audiencia === 'administrativa' ? ' · admin' : '') +
                    (oculta ? ' · oculta' : '') + '</span></div>' +
            '<div class="gu-card-t">' + e(g.titulo) + '</div>' +
            '<div class="gu-card-d">' + (g.descripcion ? e(g.descripcion) : '') + '</div>' +
            '<div class="gu-card-f">' +
                '<span class="gu-card-cta">' + (g.tipo === 'video' ? 'Ver video →' : 'Abrir →') + '</span>' +
                (_esAdmin ? '<button class="gu-del" title="Eliminar guía" onclick="event.preventDefault();event.stopPropagation();_borrarGuia(\'' + e(g.id) + '\')">🗑️</button>' : '') +
            '</div></a>';
    }

    /* ── Modal: subir guía ──────────────────────────────────────── */
    window._abrirGuia = function (seccion) {
        llenarSecciones(seccion);
        $('gTitulo').value = ''; $('gDesc').value = ''; $('gOrden').value = 0;
        $('gTipo').value = 'pdf'; $('gAudiencia').value = 'ambas'; $('gMsg').textContent = '';
        window._cambiarTipoGuia();
        $('ovGuia').classList.add('on');
        setTimeout(function () { $('gTitulo').focus(); }, 40);
    };
    window._cerrarGuia = function () { $('ovGuia').classList.remove('on'); };

    function llenarSecciones(sel) {
        var vistas = {}, ops = [];
        _secciones.forEach(function (s) { if (!vistas[s.nombre]) { vistas[s.nombre] = 1; ops.push(s.nombre); } });
        _guias.forEach(function (g) {
            var c = (g.categoria || '').trim();
            if (c && !vistas[c]) { vistas[c] = 1; ops.push(c); }
        });
        if (!ops.length) ops = ['General'];
        $('gCategoria').innerHTML = ops.map(function (c) {
            return '<option value="' + e(c) + '"' + (c === sel ? ' selected' : '') + '>' + e(c) + '</option>';
        }).join('');
    }

    window._cambiarTipoGuia = function () {
        var t = $('gTipo').value;
        $('gFuente').innerHTML = t === 'pdf'
            ? '<label>Archivo PDF</label><input id="gArchivo" type="file" accept="application/pdf">'
            : '<label>' + (t === 'video' ? 'Link de YouTube' : 'Enlace') + '</label>' +
              '<input id="gUrl" placeholder="' + (t === 'video' ? 'https://youtu.be/…' : 'https://…') + '">';
    };

    window._guardarGuia = async function () {
        var btn = $('gGuardar'), msg = $('gMsg');
        var titulo = ($('gTitulo').value || '').trim();
        if (!titulo) { msg.textContent = 'Ponle un título.'; return; }
        var tipo = $('gTipo').value, url = '';

        btn.disabled = true;
        try {
            if (tipo === 'pdf') {
                var f = $('gArchivo').files[0];
                if (!f) { msg.textContent = 'Elige el PDF.'; return; }
                /* Tope de 40 MB. Una guía con capturas rara vez pasa de 10; arriba de
                   eso casi siempre son imágenes sin comprimir, y el castigo se lo lleva
                   quien la abra desde el celular del restaurante. */
                if (f.size > 40 * 1024 * 1024) { msg.textContent = 'Ese PDF pesa más de 40 MB. Súbelo comprimido.'; return; }
                msg.textContent = 'Subiendo…';
                // scope '_guias' → cae en _guias/pdf/… , la ruta que v45 abre a lectura.
                url = await window.sbSubirArchivo('pdf', f, '_guias');
                if (!url) { msg.textContent = 'No se pudo subir el archivo.'; return; }
            } else {
                url = ($('gUrl').value || '').trim();
                if (!url) { msg.textContent = 'Falta el enlace.'; return; }
                if (tipo === 'video' && !ytId(url)) { msg.textContent = 'Ese link no parece de YouTube. Revísalo.'; return; }
            }

            var cat = ($('gCategoria').value || '').trim() || 'General';
            msg.textContent = 'Guardando…';
            var r = await _supabase.from('guias').insert({
                id: genId(), titulo: titulo,
                descripcion: ($('gDesc').value || '').trim() || null,
                categoria: cat, tipo: tipo, url: url,
                audiencia: $('gAudiencia').value || 'ambas',
                orden: parseInt($('gOrden').value, 10) || 0,
                activa: true, updated_at: new Date().toISOString()
            });
            if (r.error) { msg.textContent = 'No se pudo guardar: ' + r.error.message; return; }
            // La sección se da de alta sola si venía solo de una guía suelta.
            await _supabase.from('guia_secciones').upsert({ nombre: cat }, { onConflict: 'nombre' });
            window._cerrarGuia();
            await cargar();
        } finally { btn.disabled = false; }
    };

    /* ── Modal: crear sección ───────────────────────────────────── */
    window._abrirSeccion = function () {
        $('sNombre').value = ''; $('sMsg').textContent = '';
        $('ovSeccion').classList.add('on');
        setTimeout(function () { $('sNombre').focus(); }, 40);
    };
    window._cerrarSeccion = function () { $('ovSeccion').classList.remove('on'); };

    window._guardarSeccion = async function () {
        var nom = ($('sNombre').value || '').trim();
        if (!nom) { $('sMsg').textContent = 'Ponle nombre.'; return; }
        if (_secciones.some(function (s) { return s.nombre.toLowerCase() === nom.toLowerCase(); })) {
            $('sMsg').textContent = 'Esa sección ya existe.'; return;
        }
        // Va al final: el orden fino se ajusta después, y nadie espera que una
        // sección nueva se meta a media lista.
        var max = _secciones.reduce(function (m, s) { return Math.max(m, s.orden || 0); }, 0);
        var r = await _supabase.from('guia_secciones').insert({ nombre: nom, orden: max + 1 });
        if (r.error) { $('sMsg').textContent = 'No se pudo crear: ' + r.error.message; return; }
        window._cerrarSeccion();
        await cargar();
    };

    window._borrarSeccion = async function (nom) {
        if ((_guias || []).some(function (g) { return (g.categoria || '') === nom; })) {
            alert('Esa sección tiene guías. Muévelas o elimínalas primero.'); return;
        }
        if (!confirm('¿Eliminar la sección "' + nom + '"?')) return;
        var r = await _supabase.from('guia_secciones').delete().eq('nombre', nom);
        if (r.error) { alert('No se pudo eliminar: ' + r.error.message); return; }
        await cargar();
    };

    window._borrarGuia = async function (id) {
        var g = _guias.find(function (x) { return x.id === id; });
        if (!g) return;
        if (!confirm('¿Eliminar "' + g.titulo + '"?\n\nDeja de verse en TODOS los negocios.')) return;
        var r = await _supabase.from('guias').delete().eq('id', id);
        if (r.error) { alert('No se pudo eliminar: ' + r.error.message); return; }
        /* El registro se va, pero el PDF se queda en Storage a propósito: si fue un
           dedazo, el archivo sigue ahí y se vuelve a publicar con el mismo link. */
        await cargar();
    };

    /* ── Arranque ───────────────────────────────────────────────── */
    document.addEventListener('DOMContentLoaded', async function () {
        try {
            var ses = await _supabase.auth.getSession();
            var em = ses && ses.data && ses.data.session && ses.data.session.user &&
                     ses.data.session.user.email;
            _esAdmin = (em === ADMIN_EMAIL);
        } catch (er) { _esAdmin = false; }

        if (_esAdmin) $('guAcciones').style.display = '';
        await cargar();
    });
})();
