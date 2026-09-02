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

    /* La tarjeta ENTERA abre la vista previa. Las acciones de administración se van
       al menú de tres puntos: tener el bote de basura pegado a "Abrir" es pedir un
       dedazo, y aquí un dedazo borra la guía de TODOS los clientes. */
    function tarjeta(g) {
        var oculta = g.activa === false;
        return '<div class="gu-card" onclick="_verGuia(\'' + e(g.id) + '\')"' +
            (oculta ? ' style="opacity:.45"' : '') + '>' +
            /* La miniatura va ARRIBA de todo y en 16:9, como una tarjeta de
               video: es lo que hace que treinta guías se distingan de un
               vistazo. Sin miniatura la tarjeta se ve igual que siempre, así
               que ninguna guía vieja cambia hasta que se le ponga una. */
            (g.miniatura
                ? '<div class="gu-portada" style="background-image:url(\'' + e(g.miniatura) + '\')"></div>'
                : '') +
            '<div class="gu-card-top"><span class="gu-ico">' + (ICONO[g.tipo] || '📄') + '</span>' +
                '<span class="gu-tag">' + e(ETIQUETA[g.tipo] || g.tipo) +
                    (g.audiencia === 'operativa' ? ' · operativa' : g.audiencia === 'administrativa' ? ' · admin' : '') +
                    (oculta ? ' · oculta' : '') + '</span></div>' +
            '<div class="gu-card-t">' + e(g.titulo) + '</div>' +
            '<div class="gu-card-d">' + (g.descripcion ? e(g.descripcion) : '') + '</div>' +
            '<div class="gu-card-f">' +
                '<span class="gu-card-cta">' + (g.tipo === 'video' ? 'Ver video →' : 'Abrir →') + '</span>' +
                (_esAdmin ? '<button class="gu-del" title="Opciones" onclick="event.stopPropagation();_menuGuia(event,\'' + e(g.id) + '\')">⋯</button>' : '') +
            '</div></div>';
    }

    /* ── Menú de opciones (solo admin) ── */
    window._menuGuia = function (ev, id) {
        _cerrarMenus();
        var g = _guias.find(function (x) { return x.id === id; }); if (!g) return;
        var m = document.createElement('div');
        m.className = 'gu-menu';
        var r = ev.currentTarget.getBoundingClientRect();
        m.style.cssText = 'position:fixed;z-index:10001;min-width:196px;background:var(--surface);' +
            'border:1px solid var(--border);border-radius:10px;padding:5px;box-shadow:0 14px 40px rgba(0,0,0,.5);' +
            'top:' + Math.min(r.bottom + 6, window.innerHeight - 190) + 'px;left:' + Math.max(10, r.right - 196) + 'px';
        m.innerHTML =
            _mi('👁', 'Ver', "_verGuia('" + e(id) + "')") +
            _mi('✏️', 'Editar información', "_editarGuia('" + e(id) + "')") +
            _mi(g.activa === false ? '👀' : '🙈', g.activa === false ? 'Volver a mostrar' : 'Ocultar a los clientes',
                "_toggleGuia('" + e(id) + "')") +
            '<div style="height:1px;background:var(--border);margin:5px 2px"></div>' +
            _mi('🗑️', 'Eliminar', "_borrarGuia('" + e(id) + "')", true);
        document.body.appendChild(m);
        setTimeout(function () { document.addEventListener('click', _cerrarMenus, { once: true }); }, 0);
    };
    function _mi(ico, txt, accion, peligro) {
        return '<div onclick="event.stopPropagation();_cerrarMenus();' + accion + '" ' +
            'style="display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:7px;cursor:pointer;' +
            'font-size:13px;color:' + (peligro ? 'var(--red)' : 'var(--text)') + '" ' +
            'onmouseover="this.style.background=\'var(--surface2)\'" onmouseout="this.style.background=\'\'">' +
            '<span style="font-size:14px">' + ico + '</span>' + e(txt) + '</div>';
    }
    window._cerrarMenus = function () {
        Array.prototype.forEach.call(document.querySelectorAll('.gu-menu'), function (x) { x.remove(); });
    };

    /* ── Visor ──
       El cliente solo VE y CIERRA: no tiene por qué encontrarse botones de
       administración en una pantalla que es para consultar un manual. */
    window._verGuia = function (id) {
        var g = _guias.find(function (x) { return x.id === id; }); if (!g) return;
        _cerrarVisor();
        var cuerpo;
        if (g.tipo === 'video') {
            var vid = ytId(g.url);
            cuerpo = vid
                ? '<iframe src="https://www.youtube-nocookie.com/embed/' + e(vid) + '" allowfullscreen ' +
                  'style="width:100%;aspect-ratio:16/9;border:0;border-radius:10px;background:#000"></iframe>'
                : _fuera(g.url);
        } else if (g.tipo === 'pdf') {
            // #view=FitH abre ajustado al ancho: en un PDF vertical, el default deja
            // media hoja en blanco y obliga a hacer zoom cada vez.
            cuerpo = '<iframe src="' + e(g.url) + '#view=FitH" ' +
                     'style="width:100%;height:76vh;border:0;border-radius:10px;background:#fff"></iframe>';
        } else {
            cuerpo = _fuera(g.url);
        }
        var ov = document.createElement('div');
        ov.id = 'guVisor';
        ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.8);display:flex;' +
            'align-items:center;justify-content:center;padding:24px';
        ov.onclick = function (ev) { if (ev.target === ov) _cerrarVisor(); };
        ov.innerHTML =
            '<div style="background:var(--surface);border:1px solid var(--border);border-radius:15px;' +
                 'max-width:1000px;width:100%;padding:16px" onclick="event.stopPropagation()">' +
                '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
                    '<div style="flex:1;min-width:0">' +
                        '<div style="font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + e(g.titulo) + '</div>' +
                        (g.descripcion ? '<div style="font-size:11.5px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + e(g.descripcion) + '</div>' : '') +
                    '</div>' +
                    '<a href="' + e(g.url) + '" target="_blank" rel="noopener" class="gu-btn gu-btn-2" style="text-decoration:none">↗ Abrir aparte</a>' +
                    '<button class="gu-btn gu-btn-2" onclick="_cerrarVisor()">✕ Cerrar</button>' +
                '</div>' + cuerpo +
            '</div>';
        document.body.appendChild(ov);
        document.addEventListener('keydown', _escVisor);
    };
    function _fuera(url) {
        return '<div style="text-align:center;padding:56px 20px;color:var(--text-dim);font-size:13px;line-height:1.7">' +
            '<div style="font-size:40px;margin-bottom:10px">🔗</div>Este contenido se abre fuera de ETAAX.' +
            '<br><a href="' + e(url) + '" target="_blank" rel="noopener" style="color:var(--green)">Abrirlo ahora →</a></div>';
    }
    function _escVisor(ev) { if (ev.key === 'Escape') _cerrarVisor(); }
    window._cerrarVisor = function () {
        var ov = document.getElementById('guVisor'); if (ov) ov.remove();
        document.removeEventListener('keydown', _escVisor);
    };

    /* Ocultar en vez de borrar: una guía que se retira temporalmente (porque el
       módulo cambió y hay que rehacerla) no debería perderse. */
    window._toggleGuia = async function (id) {
        var g = _guias.find(function (x) { return x.id === id; }); if (!g) return;
        var r = await _supabase.from('guias')
            .update({ activa: g.activa === false, updated_at: new Date().toISOString() }).eq('id', id);
        if (r.error) { alert('No se pudo cambiar: ' + r.error.message); return; }
        await cargar();
    };

    /* ── Modal: subir guía ──────────────────────────────────────── */
    var _editando = null;   // id de la guía en edición, o null si es una nueva

    window._abrirGuia = function (seccion) {
        _editando = null;
        llenarSecciones(seccion);
        $('gTitulo').value = ''; $('gDesc').value = ''; $('gOrden').value = 0;
        $('gTipo').value = 'pdf'; $('gAudiencia').value = 'ambas'; $('gMsg').textContent = '';
        $('guiaModalT').textContent = 'Subir nueva guía';
        $('gGuardar').textContent = 'Publicar';
        $('gTipo').disabled = false;
        window._cambiarTipoGuia();
        $('ovGuia').classList.add('on');
        setTimeout(function () { $('gTitulo').focus(); }, 40);
    };

    /* Editar SOLO la información: título, descripción, sección, orden y audiencia.
       El ARCHIVO no se cambia aquí — reemplazarlo dejaría el PDF viejo huérfano en
       Storage y, peor, cambiaría en silencio lo que ya leyeron los clientes bajo el
       mismo título. Para cambiar el contenido: se publica una guía nueva y se
       oculta la anterior. */
    window._editarGuia = function (id) {
        var g = _guias.find(function (x) { return x.id === id; }); if (!g) return;
        _editando = id;
        llenarSecciones(g.categoria);
        $('gTitulo').value = g.titulo || '';
        $('gDesc').value = g.descripcion || '';
        $('gOrden').value = g.orden || 0;
        $('gAudiencia').value = g.audiencia || 'ambas';
        $('gTipo').value = g.tipo || 'pdf';
        $('gTipo').disabled = true;               // el tipo va amarrado al archivo
        $('gMsg').textContent = '';
        $('guiaModalT').textContent = 'Editar información';
        $('gGuardar').textContent = 'Guardar cambios';
        $('gFuente').innerHTML = _bloqueFuente(g.tipo || 'pdf', g);
        _pintarMini();
        $('ovGuia').classList.add('on');
        setTimeout(function () { $('gTitulo').focus(); }, 40);
    };
    window._cerrarGuia = function () { $('ovGuia').classList.remove('on'); _editando = null; $('gTipo').disabled = false; };

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

    /* El bloque de la FUENTE (archivo o enlace) + la MINIATURA.
       Al editar, el archivo es OPCIONAL: dejarlo vacío conserva el que ya está.
       Antes esto no se podía y la instrucción era "publica una guía nueva y
       oculta esta", que deja basura acumulada y rompe el link que ya circuló. */
    function _bloqueFuente(t, g) {
        var edit = !!g;
        var html;
        if (t === 'pdf') {
            html = '<label>Archivo PDF' + (edit ? ' <span style="color:var(--text-dim);text-transform:none;letter-spacing:0">· opcional</span>' : '') + '</label>' +
                '<input id="gArchivo" type="file" accept="application/pdf">' +
                (edit ? '<div style="font-size:11.5px;color:var(--text-dim);margin-top:5px;line-height:1.5">' +
                        'Deja esto vacío para conservar el PDF actual. Si eliges uno nuevo, <b>reemplaza al anterior</b> y el link que ya circuló sigue funcionando.</div>' : '');
        } else {
            html = '<label>' + (t === 'video' ? 'Link de YouTube' : 'Enlace') + '</label>' +
                '<input id="gUrl" value="' + (edit ? e(g.url || '') : '') + '" placeholder="' +
                (t === 'video' ? 'https://youtu.be/…' : 'https://…') + '"' +
                (t === 'video' ? ' oninput="_previoYT()"' : '') + '>';
        }
        /* La miniatura hace que treinta guías se distingan de un vistazo. En un
           video de YouTube se saca sola del id: pedir que suban una imagen de
           algo que YouTube ya tiene sería trabajo de a gratis. */
        html += '<div style="margin-top:14px"><label>Miniatura ' +
            '<span style="color:var(--text-dim);text-transform:none;letter-spacing:0">· opcional</span></label>' +
            '<div style="display:flex;gap:12px;align-items:flex-start">' +
              '<div id="gMiniPrev" style="width:96px;height:64px;flex-shrink:0;border-radius:8px;border:1px solid var(--border);' +
                   'background:var(--surface2) center/cover no-repeat;display:flex;align-items:center;justify-content:center;' +
                   'font-size:22px;color:var(--text-dim)">' + (ICONO[t] || '📄') + '</div>' +
              '<div style="flex:1;min-width:0">' +
                '<input id="gMini" type="file" accept="image/*" onchange="_previoMini(this)">' +
                '<div style="font-size:11.5px;color:var(--text-dim);margin-top:5px;line-height:1.5">' +
                  (t === 'video'
                    ? 'Si es de YouTube se toma sola del video. Sube una solo si quieres otra.'
                    : 'Una imagen de portada para reconocer la guía de un vistazo.') +
                '</div>' +
                '<button type="button" id="gMiniQuitar" onclick="_quitarMini()" style="display:none;margin-top:7px;background:transparent;' +
                  'border:1px solid var(--border);color:var(--text-muted);border-radius:7px;padding:5px 12px;font-family:inherit;font-size:12px;cursor:pointer">Quitar miniatura</button>' +
              '</div>' +
            '</div><input type="hidden" id="gMiniUrl" value="' + (edit ? e(g.miniatura || '') : '') + '"></div>';
        return html;
    }

    window._cambiarTipoGuia = function () {
        $('gFuente').innerHTML = _bloqueFuente($('gTipo').value, _editando ? _guias.find(function (x) { return x.id === _editando; }) : null);
        _pintarMini();
    };

    function _pintarMini() {
        var u = ($('gMiniUrl') || {}).value || '';
        var pv = $('gMiniPrev'), btn = $('gMiniQuitar');
        if (!pv) return;
        pv.style.backgroundImage = u ? 'url("' + u.replace(/"/g, '%22') + '")' : '';
        pv.textContent = u ? '' : (ICONO[$('gTipo').value] || '📄');
        if (btn) btn.style.display = u ? '' : 'none';
    }
    /* Un video de YouTube ya tiene portada: se arma con su id. */
    window._previoYT = function () {
        var id = ytId(($('gUrl').value || '').trim());
        if (!id) return;
        if (!$('gMiniUrl').value || /i\.ytimg\.com/.test($('gMiniUrl').value)) {
            $('gMiniUrl').value = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
            _pintarMini();
        }
    };
    window._previoMini = function (input) {
        var f = input.files && input.files[0];
        if (!f) return;
        /* Se muestra al instante desde el archivo local; a Storage sube al
           guardar. Así no queda una imagen huérfana si se cancela el modal. */
        var fr = new FileReader();
        fr.onload = function () {
            $('gMiniPrev').style.backgroundImage = 'url("' + fr.result + '")';
            $('gMiniPrev').textContent = '';
            $('gMiniQuitar').style.display = '';
        };
        fr.readAsDataURL(f);
    };
    window._quitarMini = function () {
        $('gMiniUrl').value = '';
        if ($('gMini')) $('gMini').value = '';
        _pintarMini();
    };

    /* Guardar una guía, nueva o existente.

       EL ORDEN IMPORTA y antes estaba al revés: la rama de edición devolvía
       ANTES de llegar a las subidas, así que reemplazar el PDF nunca se
       ejecutaba. Aquí se sube primero TODO lo que puede fallar —miniatura y
       archivo— y solo con eso resuelto se toca la base. Si algo se cae a medias,
       la guía se queda como estaba en vez de apuntar a un archivo inexistente. */
    window._guardarGuia = async function () {
        var btn = $('gGuardar'), msg = $('gMsg');
        var titulo = ($('gTitulo').value || '').trim();
        if (!titulo) { msg.textContent = 'Ponle un título.'; return; }
        var tipo = $('gTipo').value;
        var prev = _editando ? _guias.find(function (x) { return x.id === _editando; }) : null;
        var url = prev ? (prev.url || '') : '';

        btn.disabled = true;
        try {
            /* ── 1. Miniatura (opcional) ── */
            var mini = $('gMiniUrl') ? ($('gMiniUrl').value || '') : '';
            var fMini = $('gMini') && $('gMini').files[0];
            if (fMini) {
                if (fMini.size > 5 * 1024 * 1024) { msg.textContent = 'Esa imagen pesa más de 5 MB. Súbela más chica.'; return; }
                msg.textContent = 'Subiendo la miniatura…';
                var mUrl = await window.sbSubirArchivo('miniaturas', fMini, '_guias');
                if (!mUrl) { msg.textContent = window.sbMotivoSubida ? sbMotivoSubida() : 'No se pudo subir la miniatura.'; return; }
                mini = mUrl;
            }

            /* ── 2. El archivo o el enlace ── */
            if (tipo === 'pdf') {
                var f = $('gArchivo') && $('gArchivo').files[0];
                /* Editando, el archivo es OPCIONAL: sin uno nuevo se conserva el
                   que ya está. Antes había que publicar una guía nueva y ocultar
                   la vieja, lo que acumula basura y rompe el link que ya circuló. */
                if (!f && !url) { msg.textContent = 'Elige el PDF.'; return; }
                if (f) {
                    /* Tope de 40 MB. Una guía con capturas rara vez pasa de 10;
                       arriba de eso casi siempre son imágenes sin comprimir, y el
                       castigo se lo lleva quien la abra desde el celular. */
                    if (f.size > 40 * 1024 * 1024) { msg.textContent = 'Ese PDF pesa más de 40 MB. Súbelo comprimido.'; return; }
                    msg.textContent = 'Subiendo el PDF…';
                    // scope '_guias' → cae en _guias/pdf/…, la ruta que v45 abre a lectura.
                    var nueva = await window.sbSubirArchivo('pdf', f, '_guias');
                    if (!nueva) { msg.textContent = window.sbMotivoSubida ? sbMotivoSubida() : 'No se pudo subir el archivo.'; return; }
                    url = nueva;
                }
            } else {
                url = ($('gUrl').value || '').trim();
                if (!url) { msg.textContent = 'Falta el enlace.'; return; }
                if (tipo === 'video' && !ytId(url)) { msg.textContent = 'Ese link no parece de YouTube. Revísalo.'; return; }
            }

            /* ── 3. Recién ahora se toca la base ── */
            var cat = ($('gCategoria').value || '').trim() || 'General';
            var campos = {
                titulo: titulo,
                descripcion: ($('gDesc').value || '').trim() || null,
                categoria: cat,
                tipo: tipo,
                url: url,
                miniatura: mini || null,
                audiencia: $('gAudiencia').value || 'ambas',
                orden: parseInt($('gOrden').value, 10) || 0,
                updated_at: new Date().toISOString()
            };
            msg.textContent = 'Guardando…';
            var r = _editando
                ? await _supabase.from('guias').update(campos).eq('id', _editando)
                : await _supabase.from('guias').insert(Object.assign({ id: genId(), activa: true }, campos));
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
