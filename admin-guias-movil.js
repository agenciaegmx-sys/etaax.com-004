/* ══ GUÍAS DE LA APP MÓVIL (Edwin, 26-nov) ═══════════════════════════════════
   El panel admin sube los tutoriales —video y PDF— que la app enseña debajo de
   Cost·ax y Equip·ax en el acceso con clave.

   No hay tabla nueva: son guías de la plataforma (v45, tabla `guias`) con su
   propio módulo, 'movil_costax' / 'movil_equipax'. Los archivos van a
   `evidencias/_guias/` (bucket público: la app los abre sin sesión; la v45 deja
   escribir ahí solo al admin de plataforma). La app las pide con su clave por
   `portal_guias_movil` (v96).

   Un video puede ser un ARCHIVO (mp4/webm, hasta 50 MB: el tope de Storage) o
   un ENLACE de YouTube, que no pesa nada y se ve igual de bien en el teléfono.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    /* (27-nov) LA MISMA PANTALLA SIRVE A LAS DOS APPS. Edwin: «en el panel admin
       también debemos tener el apartado de subir guías de uso para la app web».
       Las de la web son las mismas filas de `guias` con `modulo` = el id del
       módulo (recetas, administrativo…: el que usa `moduloDeRuta()`), y su
       `categoria` es el nombre del módulo, así Learn·ax las agrupa por módulo.
       Cada portada las abre desde su botón «Guías» (etaax-modulos-ui.js). */
    var PLATAFORMAS = {
        movil: { panel: 'tab-guias-movil', categoria: 'App móvil', prefijo: 'movil-', donde: 'en la app',
                 nota: 'Cada guía aparece en la app, debajo de su módulo, para quien entra con su clave. ',
                 mods: [{ id: 'movil_costax',  nom: 'Cost·ax',  lema: 'Inventario y recetas' },
                        { id: 'movil_equipax', nom: 'Equip·ax', lema: 'Tu turno' }] },
        web:   { panel: 'tab-guias-web', categoria: null, prefijo: 'web-', donde: 'en el sistema',
                 nota: 'Cada guía aparece en la portada de su módulo (botón «Guías», junto al nombre del módulo) y en Learn·ax, para todo el equipo con sesión. ',
                 mods: [{ id: 'recetas',        nom: 'Cost·ax',  lema: 'Recetas, insumos e inventarios' },
                        { id: 'administrativo', nom: 'Admin·ax', lema: 'Ingresos, egresos y caja' },
                        { id: 'financiero',     nom: 'Fin·ax',   lema: 'Resultados y KPIs' },
                        { id: 'equipo',         nom: 'Equip·ax', lema: 'Personal y horarios' },
                        { id: 'consultoria',    nom: 'Learn·ax', lema: 'Aprende y analiza' }] }
    };
    var _plat = 'movil', MODS = PLATAFORMAS.movil.mods;
    var TOPE_VIDEO = 50 * 1024 * 1024, TOPE_PDF = 40 * 1024 * 1024;
    var _lista = [], _cargando = false;

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
    function $(id) { return document.getElementById(id); }
    function ic(n, t) { return (typeof window.etaaxIcono === 'function') ? (window.etaaxIcono(n, { tam: t || 18 }) || '') : ''; }
    function genId() { return 'gm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function esYoutube(u) { return /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{6,}/.test(String(u || '')); }

    function estilos() {
        if ($('agmEstilos')) return;
        var st = document.createElement('style'); st.id = 'agmEstilos';
        st.textContent =
            '.agm{display:flex;flex-direction:column;gap:16px}' +
            '.agm-mods{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}' +
            '@media(max-width:860px){.agm-mods{grid-template-columns:1fr}}' +
            '.agm-mod{background:var(--s1);border:1px solid var(--b1);border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}' +
            '.agm-mod-cab{display:flex;align-items:baseline;justify-content:space-between;gap:10px}' +
            '.agm-mod-nom{font-size:17px;font-weight:700}.agm-mod-nom i{font-style:normal;color:var(--etx-ui-terra,#fb9b6f)}' +
            '.agm-mod-lema{font-size:12px;color:var(--muted)}' +
            '.agm-it{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--b1);border-radius:12px}' +
            '.agm-it.off{opacity:.55}' +
            '.agm-it-ic{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;flex-shrink:0;background:rgba(140,228,238,.1);color:#8ce4ee}' +
            '.agm-it-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
            '.agm-it-tx b{font-size:13.5px;overflow-wrap:anywhere}.agm-it-tx small{font-size:11.5px;color:var(--muted)}' +
            '.agm-it-acc{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}' +
            '.agm-vacio{font-size:12.5px;color:var(--muted);padding:6px 2px}' +
            '.agm-form{background:var(--s1);border:1px solid var(--b1);border-radius:16px;padding:18px 20px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px}' +
            '@media(max-width:760px){.agm-form{grid-template-columns:1fr}}' +
            '.agm-form .agm-anc{grid-column:1/-1}' +
            '.agm-form label{display:flex;flex-direction:column;gap:6px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted)}' +
            '.agm-form :is(input,select,textarea){text-transform:none;letter-spacing:0;font:14px inherit;padding:10px 12px;border-radius:9px;border:1px solid var(--b1);background:var(--s2,rgba(255,255,255,.04));color:inherit;font-family:inherit}' +
            '.agm-tipos{display:flex;gap:8px;flex-wrap:wrap}' +
            '.agm-tipo{display:inline-flex;align-items:center;gap:7px;padding:9px 13px;border-radius:10px;border:1px solid var(--b1);background:transparent;color:inherit;font:600 13px inherit;font-family:inherit;cursor:pointer}' +
            '.agm-tipo.on{border-color:#8ce4ee;color:#8ce4ee;background:rgba(140,228,238,.08)}' +
            '.agm-pie{grid-column:1/-1;display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap}' +
            '.agm-msg{margin-right:auto;font-size:12.5px;color:var(--muted)}' +
            '.agm .btn-guardar{background:var(--etx-ui-terra-solido,#c45f37);color:#fff;border:0;border-radius:10px;padding:11px 18px;font:600 13.5px inherit;font-family:inherit;cursor:pointer}' +
            '.agm .btn-guardar:disabled{opacity:.6;cursor:wait}';
        document.head.appendChild(st);
    }

    async function cargar() {
        if (_cargando || typeof _supabase === 'undefined') return;
        _cargando = true;
        try {
            var r = await _supabase.from('guias').select('*').in('modulo', MODS.map(function (m) { return m.id; }))
                .order('modulo').order('orden').order('created_at');
            _lista = r.error ? [] : (r.data || []);
            if (r.error) pintarAviso('No se pudieron leer las guías: ' + r.error.message);
        } finally { _cargando = false; }
        pintarListas();
    }
    function pintarAviso(t) { var m = $('agmMsg'); if (m) m.textContent = t; }

    function tipoTxt(g) {
        if (g.tipo === 'pdf') return 'PDF';
        return esYoutube(g.url) ? 'Video · YouTube' : 'Video';
    }
    function pintarListas() {
        var cont = $('agmMods'); if (!cont) return;
        cont.innerHTML = MODS.map(function (m) {
            var gs = _lista.filter(function (g) { return g.modulo === m.id; });
            var k = m.nom.indexOf('·');
            return '<div class="agm-mod"><div class="agm-mod-cab"><span class="agm-mod-nom">' + esc(m.nom.slice(0, k)) + '<i>·</i>' + esc(m.nom.slice(k + 1)) + '</span>' +
                '<span class="agm-mod-lema">' + esc(m.lema) + ' · ' + gs.length + (gs.length === 1 ? ' guía' : ' guías') + '</span></div>' +
                (gs.length ? gs.map(function (g) {
                    return '<div class="agm-it' + (g.activa ? '' : ' off') + '" data-id="' + esc(g.id) + '">' +
                        '<span class="agm-it-ic">' + ic(g.tipo === 'pdf' ? 'ins-ficha' : 'rec-tutorial', 18) + '</span>' +
                        '<span class="agm-it-tx"><b>' + esc(g.titulo) + '</b><small>' + esc((_plat === 'web' && window.EtaaxGuias ? EtaaxGuias.submodulo(g) + ' · ' : '') + (_plat === 'web' ? (g.tipo === 'pdf' ? 'Guía de uso · ' : 'Tutorial · ') : '') + tipoTxt(g)) + (g.activa ? '' : ' · oculta ' + PLATAFORMAS[_plat].donde) + '</small></span>' +
                        '<span class="agm-it-acc">' +
                            '<a class="btn-mini" href="' + esc(g.url) + '" target="_blank" rel="noopener">Ver</a>' +
                            '<button class="btn-mini" onclick="AdmGuiasMovil.alternar(\'' + esc(g.id) + '\')">' + (g.activa ? 'Ocultar' : 'Mostrar') + '</button>' +
                            '<button class="btn-mini" style="color:#e05a3a;border-color:rgba(224,90,58,.45)" onclick="AdmGuiasMovil.eliminar(\'' + esc(g.id) + '\')">Eliminar</button>' +
                        '</span></div>';
                }).join('') : '<div class="agm-vacio">Sin guías todavía. Agrégala abajo: aparecerá ' + (_plat === 'web' ? 'en la portada de ' + esc(m.nom) + ' y en Learn·ax' : 'debajo de ' + esc(m.nom) + ' en la app') + '.</div>') +
            '</div>';
        }).join('');
    }

    var _tipo = 'video';
    function setTipo(t) {
        _tipo = t;
        document.querySelectorAll('.agm-tipo').forEach(function (b) { b.classList.toggle('on', b.dataset.tipo === t); });
        $('agmArchivoWrap').style.display = t === 'link' ? 'none' : '';
        $('agmUrlWrap').style.display = t === 'link' ? '' : 'none';
        var f = $('agmArchivo'); if (f) { f.value = ''; f.accept = t === 'pdf' ? 'application/pdf' : 'video/mp4,video/webm,video/quicktime'; }
        $('agmArchivoLbl').firstChild.textContent = t === 'pdf' ? 'Archivo PDF (hasta 40 MB)' : 'Archivo de video (mp4, hasta 50 MB)';
    }

    function montar(plat) {
        _plat = PLATAFORMAS[plat] ? plat : 'movil'; MODS = PLATAFORMAS[_plat].mods;
        var C = PLATAFORMAS[_plat], p = $(C.panel); if (!p) return;
        /* Los dos paneles usan los mismos ids: solo uno vive a la vez. */
        Object.keys(PLATAFORMAS).forEach(function (k) { var o = $(PLATAFORMAS[k].panel); if (o && o !== p) o.innerHTML = ''; });
        estilos();
        p.innerHTML =
            '<div class="agm">' +
                '<div class="adm-nota">' + C.nota +
                    'Un video puede ser un archivo o un enlace de YouTube (mejor para videos largos: no pesa en Storage).</div>' +
                '<div class="agm-mods" id="agmMods"><div class="agm-vacio">Cargando…</div></div>' +
                '<div class="agm-form">' +
                    '<div class="agm-anc" style="font-size:15px;font-weight:700;text-transform:none;letter-spacing:0">Agregar guía</div>' +
                    '<label>Módulo<select id="agmModulo" onchange="AdmGuiasMovil.subs()">' + MODS.map(function (m) { return '<option value="' + m.id + '">' + esc(m.nom) + ' · ' + esc(m.lema) + '</option>'; }).join('') + '</select></label>' +
                    /* (27-nov) En la web cada guía va en un SUBMÓDULO: así se agrupan en la
                       portada, en el hub y en Learn·ax. Vive en la categoría
                       («Fin·ax · Ventas totales»), sin migración. */
                    (_plat === 'web' ? '<label>Submódulo<select id="agmSub"></select></label>' : '') +
                    '<label>Título<input id="agmTitulo" maxlength="80" placeholder="' + (_plat === 'web' ? 'Ej. Cómo hacer un corte de caja' : 'Ej. Cómo registrar entradas') + '"></label>' +
                    '<div class="agm-anc"><div class="agm-tipos">' +
                        '<button type="button" class="agm-tipo on" data-tipo="video" onclick="AdmGuiasMovil.tipo(\'video\')">' + ic('rec-tutorial', 16) + 'Video (archivo)</button>' +
                        '<button type="button" class="agm-tipo" data-tipo="link" onclick="AdmGuiasMovil.tipo(\'link\')">' + ic('rec-enlace', 16) + 'Video (enlace de YouTube)</button>' +
                        '<button type="button" class="agm-tipo" data-tipo="pdf" onclick="AdmGuiasMovil.tipo(\'pdf\')">' + ic('ins-ficha', 16) + 'PDF</button>' +
                    '</div></div>' +
                    '<label class="agm-anc" id="agmArchivoWrap"><span id="agmArchivoLbl">Archivo de video (mp4, hasta 50 MB)</span><input type="file" id="agmArchivo" accept="video/mp4,video/webm,video/quicktime"></label>' +
                    '<label class="agm-anc" id="agmUrlWrap" style="display:none">Enlace de YouTube<input id="agmUrl" placeholder="https://www.youtube.com/watch?v=…"></label>' +
                    '<label class="agm-anc">Descripción (opcional)<input id="agmDesc" maxlength="160" placeholder="Para qué sirve, en una línea"></label>' +
                    '<label>Orden<input id="agmOrden" type="number" value="0" min="0" step="1"></label>' +
                    '<div class="agm-pie"><span class="agm-msg" id="agmMsg"></span><button type="button" class="btn-guardar" id="agmGuardar" onclick="AdmGuiasMovil.guardar()">Subir guía</button></div>' +
                '</div>' +
            '</div>';
        setTipo('video');
        pintarSubs();
        cargar();
    }
    function subsDe(mod) { return (window.EtaaxGuias && EtaaxGuias.SUBMODULOS[mod]) || []; }
    function pintarSubs() {
        var sel = $('agmSub'), mod = $('agmModulo') && $('agmModulo').value; if (!sel) return;
        sel.innerHTML = ['General'].concat(subsDe(mod)).map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('');
    }
    function categoriaDe(mod) {
        if (PLATAFORMAS[_plat].categoria) return PLATAFORMAS[_plat].categoria;
        var sub = $('agmSub') ? $('agmSub').value : 'General';
        if (window.EtaaxGuias) return EtaaxGuias.categoria(mod, sub);
        return (MODS.find(function (m) { return m.id === mod; }) || {}).nom || 'General';
    }

    async function subir(file, carpeta) {
        var ext = (file.name && file.name.indexOf('.') >= 0) ? file.name.split('.').pop().toLowerCase() : (carpeta === 'pdf' ? 'pdf' : 'mp4');
        var ruta = '_guias/' + carpeta + '/' + PLATAFORMAS[_plat].prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.' + ext;
        var r = await _supabase.storage.from('evidencias').upload(ruta, file, { contentType: file.type || (carpeta === 'pdf' ? 'application/pdf' : 'video/mp4'), upsert: false });
        if (r.error) throw new Error(r.error.message);
        return _supabase.storage.from('evidencias').getPublicUrl(ruta).data.publicUrl;
    }

    async function guardar() {
        var btn = $('agmGuardar'), msg = $('agmMsg');
        var titulo = ($('agmTitulo').value || '').trim();
        if (!titulo) { msg.textContent = 'Ponle un título.'; return; }
        var url = '', tipo = _tipo === 'pdf' ? 'pdf' : 'video';
        btn.disabled = true;
        try {
            if (_tipo === 'link') {
                url = ($('agmUrl').value || '').trim();
                if (!esYoutube(url)) { msg.textContent = 'Ese enlace no parece de YouTube. Revísalo.'; return; }
            } else {
                var f = $('agmArchivo').files[0];
                if (!f) { msg.textContent = _tipo === 'pdf' ? 'Elige el PDF.' : 'Elige el video.'; return; }
                if (_tipo === 'pdf' && f.size > TOPE_PDF) { msg.textContent = 'Ese PDF pesa más de 40 MB. Súbelo comprimido.'; return; }
                if (_tipo === 'video' && f.size > TOPE_VIDEO) { msg.textContent = 'Ese video pesa más de 50 MB. Súbelo a YouTube y pega el enlace.'; return; }
                msg.textContent = _tipo === 'pdf' ? 'Subiendo el PDF…' : 'Subiendo el video… (puede tardar)';
                url = await subir(f, _tipo === 'pdf' ? 'pdf' : 'video');
            }
            msg.textContent = 'Guardando…';
            var r = await _supabase.from('guias').insert({
                id: genId(), titulo: titulo, descripcion: ($('agmDesc').value || '').trim() || null,
                categoria: categoriaDe($('agmModulo').value),
                tipo: tipo, url: url, modulo: $('agmModulo').value,
                audiencia: 'ambas', orden: parseInt($('agmOrden').value, 10) || 0, activa: true
            });
            if (r.error) { msg.textContent = 'No se pudo guardar: ' + r.error.message; return; }
            msg.textContent = 'Listo: ya aparece ' + PLATAFORMAS[_plat].donde + '.';
            if (window.EtaaxGuias) EtaaxGuias.olvidar();
            $('agmTitulo').value = ''; $('agmDesc').value = ''; $('agmUrl').value = ''; $('agmArchivo').value = '';
            await cargar();
        } catch (e) {
            msg.textContent = 'No se pudo subir: ' + (e && e.message ? e.message : e);
        } finally { btn.disabled = false; }
    }
    async function alternar(id) {
        var g = _lista.find(function (x) { return x.id === id; }); if (!g) return;
        var r = await _supabase.from('guias').update({ activa: !g.activa, updated_at: new Date().toISOString() }).eq('id', id);
        if (r.error) { pintarAviso('No se pudo cambiar: ' + r.error.message); return; }
        await cargar();
    }
    async function eliminar(id) {
        var g = _lista.find(function (x) { return x.id === id; }); if (!g) return;
        if (!confirm('¿Eliminar la guía «' + g.titulo + '»? Deja de verse ' + PLATAFORMAS[_plat].donde + '.')) return;
        var r = await _supabase.from('guias').delete().eq('id', id);
        if (r.error) { pintarAviso('No se pudo eliminar: ' + r.error.message); return; }
        /* El archivo también, si es nuestro (no se borra un enlace de YouTube). */
        var m = String(g.url || '').match(/\/object\/public\/evidencias\/(_guias\/.+?)(?:\?|$)/);
        if (m) { try { await _supabase.storage.from('evidencias').remove([decodeURIComponent(m[1])]); } catch (e) {} }
        await cargar();
    }

    window.AdmGuiasMovil = { montar: function () { montar('movil'); }, montarWeb: function () { montar('web'); },
                             guardar: guardar, alternar: alternar, eliminar: eliminar, tipo: setTipo, esYoutube: esYoutube, subs: pintarSubs,
                             plataformas: PLATAFORMAS };
})();
