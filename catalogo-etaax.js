/* ============================================================================
   ETAAX — CATÁLOGO GLOBAL (perfiles de puesto y plantillas de evaluación)

   El negocio no arranca de cero: jala del catálogo maestro de ETAAX, igual que
   con los insumos. Este archivo pone la ventana de "elegir e importar"; cada
   página dice QUÉ tabla lee, cómo se llama cada cosa y qué hace al importar.

   Uso:
     etaaxCatalogo.abrir({
        tabla:   'catalogo_perfiles',
        titulo:  'Perfiles de puesto ETAAX',
        icono:   '🧑‍🍳',
        vacio:   'Todavía no hay perfiles en el catálogo de ETAAX.',
        nombre:  function (d) { return d.puesto || 'Sin título'; },
        sub:     function (d) { return d.area || ''; },
        detalle: function (d) { return '8 funciones · 4 requisitos'; },   // opcional
        yaEsta:  function (d) { return bool; },   // marca "Ya lo tienes"
        agregar: function (d) { ... }             // copia al negocio (async o no)
     });

   OJO: aquí solo viajan PLANTILLAS. Nunca respuestas de evaluaciones ni datos
   de personas — eso se queda en el negocio donde se capturó.
   ============================================================================ */
(function () {
    if (window.etaaxCatalogo) return;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var st = document.createElement('style');
    st.textContent =
        '.cate-ov{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.68);display:flex;align-items:flex-start;justify-content:center;padding:28px 16px;overflow:auto}' +
        '.cate-box{background:var(--surface,#1a1916);border:1px solid var(--border,#2e2c29);border-radius:16px;width:100%;max-width:860px;' +
            'box-shadow:0 26px 70px rgba(0,0,0,.55);display:flex;flex-direction:column;max-height:88vh;resize:both;overflow:auto;min-width:320px;min-height:300px}' +
        '.cate-hd{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--border,#2e2c29);flex-shrink:0}' +
        '.cate-tt{font-family:"Bebas Neue",sans-serif;font-size:21px;letter-spacing:1.5px;color:var(--text,#f0ece4)}' +
        '.cate-sub{font-size:11.5px;color:var(--text-dim,#8b867e);margin-top:2px}' +
        '.cate-bar{padding:12px 20px 0;flex-shrink:0}' +
        '.cate-in{width:100%;background:var(--surface2,#232220);border:1px solid var(--border,#2e2c29);color:var(--text,#f0ece4);' +
            'padding:10px 13px;border-radius:9px;font-family:inherit;font-size:13.5px;outline:none;box-sizing:border-box}' +
        '.cate-in:focus{border-color:var(--green,#3dbe7a)}' +
        '.cate-body{padding:14px 20px 20px;overflow:auto;flex:1}' +
        '.cate-item{display:flex;align-items:center;gap:12px;background:var(--surface2,#232220);border:1px solid var(--border,#2e2c29);' +
            'border-radius:11px;padding:12px 14px;margin-bottom:9px}' +
        '.cate-nom{font-size:14px;font-weight:600;color:var(--text,#f0ece4)}' +
        '.cate-meta{font-size:11.5px;color:var(--text-dim,#8b867e);margin-top:3px}' +
        '.cate-add{background:rgba(61,190,122,.12);border:1px solid var(--green,#3dbe7a);color:var(--green,#3dbe7a);' +
            'border-radius:8px;padding:7px 15px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0}' +
        '.cate-add:hover{background:rgba(61,190,122,.22)}' +
        '.cate-add[disabled]{opacity:.55;cursor:default;border-color:var(--border,#2e2c29);color:var(--text-dim,#8b867e);background:transparent}' +
        '.cate-vacio{text-align:center;color:var(--text-dim,#8b867e);font-size:13px;padding:44px 20px;line-height:1.6}';
    (document.head || document.documentElement).appendChild(st);

    function abrir(cfg) {
        cfg = cfg || {};
        var ov = document.createElement('div');
        ov.className = 'cate-ov';
        ov.innerHTML =
            '<div class="cate-box">' +
                '<div class="cate-hd">' +
                    '<span style="font-size:22px">' + (cfg.icono || '🌐') + '</span>' +
                    '<div style="flex:1;min-width:0">' +
                        '<div class="cate-tt">' + esc(cfg.titulo || 'Catálogo ETAAX') + '</div>' +
                        '<div class="cate-sub">Plantillas sugeridas por ETAAX · al agregarlas quedan como tuyas y las puedes editar</div>' +
                    '</div>' +
                    '<button class="cate-cerrar" style="background:transparent;border:1px solid var(--border,#2e2c29);color:var(--text-dim,#8b867e);' +
                        'border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit">✕</button>' +
                '</div>' +
                '<div class="cate-bar"><input class="cate-in" placeholder="Buscar…"></div>' +
                '<div class="cate-body"><div class="cate-vacio">Cargando catálogo…</div></div>' +
            '</div>';
        document.body.appendChild(ov);

        var body  = ov.querySelector('.cate-body');
        var busca = ov.querySelector('.cate-in');
        function cerrar() { try { ov.remove(); } catch (e) {} }
        ov.querySelector('.cate-cerrar').addEventListener('click', cerrar);
        ov.addEventListener('click', function (e) { if (e.target === ov) cerrar(); });

        var todos = [];
        function pinta() {
            var q = (busca.value || '').toLowerCase().trim();
            var lista = todos.filter(function (d) {
                if (!q) return true;
                return (String(cfg.nombre ? cfg.nombre(d) : '') + ' ' +
                        String(cfg.sub ? cfg.sub(d) : '')).toLowerCase().indexOf(q) >= 0;
            });
            if (!lista.length) {
                body.innerHTML = '<div class="cate-vacio">' +
                    (todos.length ? 'Nada coincide con esa búsqueda.' : esc(cfg.vacio || 'El catálogo todavía está vacío.')) +
                    '</div>';
                return;
            }
            body.innerHTML = lista.map(function (d, i) {
                var ya = cfg.yaEsta ? !!cfg.yaEsta(d) : false;
                var meta = [cfg.sub && cfg.sub(d), cfg.detalle && cfg.detalle(d)].filter(Boolean).join(' · ');
                return '<div class="cate-item">' +
                    '<div style="flex:1;min-width:0">' +
                        '<div class="cate-nom">' + esc(cfg.nombre ? cfg.nombre(d) : 'Sin nombre') + '</div>' +
                        (meta ? '<div class="cate-meta">' + esc(meta) + '</div>' : '') +
                    '</div>' +
                    '<button class="cate-add" data-i="' + i + '"' + (ya ? ' disabled' : '') + '>' +
                        (ya ? '✓ Ya lo tienes' : '+ Agregar') + '</button>' +
                '</div>';
            }).join('');
            body.querySelectorAll('.cate-add').forEach(function (b) {
                if (b.disabled) return;
                b.addEventListener('click', function () {
                    var d = lista[parseInt(b.getAttribute('data-i'), 10)];
                    b.disabled = true; b.textContent = '⏳ Agregando…';
                    Promise.resolve(cfg.agregar ? cfg.agregar(JSON.parse(JSON.stringify(d))) : null)
                        .then(function () { b.textContent = '✓ Agregado'; })
                        .catch(function (e) { b.disabled = false; b.textContent = '+ Agregar'; alert('No se pudo agregar: ' + ((e && e.message) || e)); });
                });
            });
        }
        busca.addEventListener('input', pinta);

        if (typeof _supabase === 'undefined') {
            body.innerHTML = '<div class="cate-vacio">Sin conexión con ETAAX. Intenta de nuevo en un momento.</div>';
            return;
        }
        _supabase.from(cfg.tabla).select('datos').order('created_at', { ascending: true })
            .then(function (r) {
                if (r.error) {
                    body.innerHTML = '<div class="cate-vacio">No se pudo leer el catálogo.<br><span style="font-size:11.5px">' +
                        esc(r.error.message) + '</span><br><span style="font-size:11.5px;opacity:.7">Si dice que la tabla no existe, falta correr la migración v41.</span></div>';
                    return;
                }
                todos = (r.data || []).map(function (x) { return x.datos; }).filter(Boolean);
                pinta();
                setTimeout(function () { try { busca.focus(); } catch (e) {} }, 60);
            });
    }

    window.etaaxCatalogo = { abrir: abrir };
})();
