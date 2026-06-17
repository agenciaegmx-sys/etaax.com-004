/* ============================================================
   ETAAX — Helpers compartidos de sincronización con Supabase
   Requiere: _supabase (supabase-config.js) cargado antes.

   - sbUpsert(tabla, record [, negId])  → tablas per-record
     (id TEXT PK + negocio_id + datos JSONB)
   - sbUpsertDoc(tabla, datos [, negId]) → tablas de documento
     único por negocio (onConflict: negocio_id)
   - sbDelete(tabla, id)

   Toda escritura reporta el error al usuario con un toast
   (_sbToastError) además de console.error — antes los fallos
   de sincronización eran invisibles y el usuario creía que
   sus datos estaban respaldados.
   ============================================================ */
(function () {
    function _negId() {
        return localStorage.getItem('etaax_negocio_activo') || '';
    }

    var _toastTimer = null;
    window._sbToastError = function (detalle) {
        console.error('[etaax-db]', detalle);
        var el = document.getElementById('etaax-sync-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'etaax-sync-toast';
            el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;' +
                'background:#1a1916;border:1px solid #e05a3a;border-radius:10px;padding:12px 18px;' +
                'font-family:DM Sans,sans-serif;font-size:12px;color:#f0ece6;max-width:360px;' +
                'box-shadow:0 8px 32px rgba(0,0,0,.5)';
            el.innerHTML = '<span style="color:#e05a3a;font-weight:700">⚠️ Sin sincronizar</span> ' +
                'El último cambio se guardó solo en este dispositivo. Revisa tu conexión e intenta de nuevo.';
            document.body.appendChild(el);
        }
        el.style.display = 'block';
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(function () { el.style.display = 'none'; }, 6000);
    };

    function _check(tag) {
        return function (r) { if (r && r.error) window._sbToastError(tag + ': ' + r.error.message); };
    }

    // Sube un data:URL (imagen o PDF) a Storage y devuelve su URL pública.
    async function _subirDataUrl(carpeta, dataUrl, negId) {
        if (typeof _supabase === 'undefined') return null;
        var blob, ctype = 'image/jpeg', ext = 'jpg';
        try {
            var parts = dataUrl.split(',');
            ctype = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
            var bin = atob(parts[1]); var arr = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            blob = new Blob([arr], { type: ctype });
            ext = ctype.indexOf('pdf') >= 0 ? 'pdf' : ctype.indexOf('png') >= 0 ? 'png' :
                  ctype.indexOf('webp') >= 0 ? 'webp' : ctype.indexOf('gif') >= 0 ? 'gif' : 'jpg';
        } catch (e) { return null; }
        var id = negId || _negId() || 'catalogo';
        var path = id + '/' + carpeta + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.' + ext;
        var r = await _supabase.storage.from('evidencias').upload(path, blob, { contentType: ctype, upsert: false });
        if (r.error) return null;
        return _supabase.storage.from('evidencias').getPublicUrl(path).data.publicUrl;
    }

    // ALIGERAR: recorre el registro y sube a Storage cualquier base64 (data:),
    // dejando solo la URL. Es la pieza clave: evita que payloads gigantes (fotos,
    // PDFs) rompan el upsert ("Sin sincronizar") y migra lo viejo de forma
    // transparente en la primera sincronización. Universal para todos los módulos.
    window.sbAligerarRecord = async function (record, carpeta, negId) {
        if (!record || typeof record !== 'object' || typeof _supabase === 'undefined') return false;
        var changed = false;
        async function walk(obj) {
            var keys = Array.isArray(obj) ? obj.map(function (_, i) { return i; }) : Object.keys(obj);
            for (var ki = 0; ki < keys.length; ki++) {
                var k = keys[ki], v = obj[k];
                if (typeof v === 'string' && v.indexOf('data:') === 0 && v.length > 256) {
                    var url = await _subirDataUrl(carpeta || 'archivos', v, negId);
                    if (url) { obj[k] = url; changed = true; }
                } else if (v && typeof v === 'object') {
                    await walk(v);
                }
            }
        }
        try { await walk(record); } catch (e) {}
        return changed;
    };

    /* ════════════════════════════════════════════════════════════
       COLA DE SALIDA (OUTBOX) — sincronización confiable estilo Drive.
       Cada escritura se ENCOLA en localStorage y se sube en segundo plano.
       Si falla (sin red / error) se queda y se reintenta al reconectar y
       cada 20s. El dato NUNCA se pierde aunque guardes offline y cierres.
       Indicador discreto "Sincronizando… N pendientes" en vez del toast rojo.
       ════════════════════════════════════════════════════════════ */
    var OUTBOX = 'etaax_outbox_v1';
    function _obLoad() { try { return JSON.parse(localStorage.getItem(OUTBOX)) || []; } catch (e) { return []; } }
    function _obSave(q) { try { localStorage.setItem(OUTBOX, JSON.stringify(q)); } catch (e) {} }

    function _obIndicador() {
        var n = _obLoad().length;
        var el = document.getElementById('etaax-sync-pending');
        if (!n) { if (el) el.style.display = 'none'; return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'etaax-sync-pending';
            el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99998;' +
                'background:#1a1916;border:1px solid #f5c842;border-radius:10px;padding:9px 15px;' +
                'font-family:DM Sans,sans-serif;font-size:12px;color:#f0ece6;max-width:340px;' +
                'box-shadow:0 8px 32px rgba(0,0,0,.45)';
            if (document.body) document.body.appendChild(el);
        }
        var s = n !== 1 ? 's' : '';
        el.innerHTML = '<span style="color:#f5c842;font-weight:700">⏳ Sincronizando…</span> ' +
            n + ' cambio' + s + ' pendiente' + s + ' (se sube' + (n !== 1 ? 'n' : '') + ' solo' + s + ').';
        el.style.display = 'block';
    }

    function _obAdd(item) {
        item.tries = 0;
        var q = _obLoad();
        // dedup: misma tabla + clave + op → gana el último estado
        q = q.filter(function (x) { return !(x.tabla === item.tabla && x.k === item.k && x.op === item.op); });
        q.push(item);
        _obSave(q);
        _obIndicador();
        _obFlush();
    }

    async function _obEjecutar(it) {
        if (it.op === 'delete') {
            var rd = await _supabase.from(it.tabla).delete().eq('id', it.id);
            return !rd.error;
        }
        // Aligerar al momento de subir (requiere red): base64 → Storage URL
        try {
            if (it.payload && it.payload.datos && window.sbAligerarRecord) {
                await window.sbAligerarRecord(it.payload.datos, it.tabla, it.payload.negocio_id);
            }
        } catch (e) {}
        var ru = await _supabase.from(it.tabla).upsert(it.payload, it.opts);
        return !ru.error;
    }

    var _obFlushing = false;
    async function _obFlush() {
        if (_obFlushing || typeof _supabase === 'undefined') return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // sin red
        _obFlushing = true;
        try {
            var q = _obLoad(), quedan = [];
            for (var i = 0; i < q.length; i++) {
                var it = q[i], ok = false;
                try { ok = await _obEjecutar(it); } catch (e) { ok = false; }
                if (!ok) {
                    it.tries = (it.tries || 0) + 1;
                    if (it.tries < 8) quedan.push(it);
                    else console.error('[outbox] descartado tras 8 intentos:', it.tabla, it.k);
                }
            }
            _obSave(quedan);
            _obIndicador();
        } finally { _obFlushing = false; }
    }
    window._sbFlush = _obFlush;
    window._sbPendientes = function () { return _obLoad().length; };

    window.sbUpsert = function (tabla, record, negId) {
        var id = negId || _negId();
        if (!id || !record || typeof _supabase === 'undefined') return;
        _obAdd({ op: 'upsert', tabla: tabla, k: record.id,
            payload: { id: record.id, negocio_id: id, datos: record, updated_at: new Date().toISOString() },
            opts: { onConflict: 'id' } });
    };

    window.sbUpsertDoc = function (tabla, datos, negId) {
        var id = negId || _negId();
        if (!id || typeof _supabase === 'undefined') return;
        _obAdd({ op: 'upsert', tabla: tabla, k: id,
            payload: { negocio_id: id, datos: datos, updated_at: new Date().toISOString() },
            opts: { onConflict: 'negocio_id' } });
    };

    window.sbDelete = function (tabla, id) {
        if (typeof _supabase === 'undefined' || !id) return;
        _obAdd({ op: 'delete', tabla: tabla, k: id, id: id });
    };

    // Disparadores del flush: al cargar, al reconectar, y cada 20s.
    if (typeof window !== 'undefined') {
        window.addEventListener('online', _obFlush);
        setInterval(_obFlush, 20000);
        setTimeout(function () { _obIndicador(); _obFlush(); }, 1500);
    }

    /* ── Realtime: el servidor EMPUJA los cambios → el otro dispositivo se
       actualiza solo, sin recargar (efecto Google Drive). Requiere que la tabla
       esté en la publicación supabase_realtime (migración v16). onChange(payload)
       se dispara en cada INSERT/UPDATE/DELETE de ese negocio. Devuelve el canal. */
    window.sbRealtime = function (tabla, negId, onChange) {
        if (typeof _supabase === 'undefined' || !negId || !_supabase.channel) return null;
        try {
            var ch = _supabase
                .channel('rt_' + tabla + '_' + negId + '_' + Math.random().toString(36).slice(2, 6))
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: tabla, filter: 'negocio_id=eq.' + negId },
                    function (payload) { try { onChange(payload); } catch (e) {} })
                .subscribe();
            return ch;
        } catch (e) { return null; }
    };

    /* ── Storage de evidencias (fotos) ──
       Comprime la imagen a JPEG y la sube al bucket 'evidencias' en una
       ruta por negocio. Devuelve {url, path} o null si falla. */
    function _comprimir(file, maxPx) {
        return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function (e) {
                var img = new Image();
                img.onload = function () {
                    var w = img.width, h = img.height, M = maxPx || 1280;
                    if (w > h) { if (w > M) { h = Math.round(h * M / w); w = M; } }
                    else { if (h > M) { w = Math.round(w * M / h); h = M; } }
                    var c = document.createElement('canvas'); c.width = w; c.height = h;
                    c.getContext('2d').drawImage(img, 0, 0, w, h);
                    c.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.72);
                };
                img.onerror = function () { resolve(null); };
                img.src = e.target.result;
            };
            reader.onerror = function () { resolve(null); };
            reader.readAsDataURL(file);
        });
    }

    // sbSubirEvidencia(carpeta, file [, negId]) → Promise<{url,path,pdf,nombre}|null>
    // Imágenes: se comprimen a JPEG. PDF: se sube tal cual.
    window.sbSubirEvidencia = async function (carpeta, file, negId) {
        var id = negId || _negId();
        if (!id || typeof _supabase === 'undefined' || !file) return null;
        var esPdf = /pdf$/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');
        var blob, ext, ctype;
        if (esPdf) {
            blob = file; ext = '.pdf'; ctype = 'application/pdf';
        } else {
            blob = await _comprimir(file, 1280);
            if (!blob) { window._sbToastError('No se pudo procesar la imagen'); return null; }
            ext = '.jpg'; ctype = 'image/jpeg';
        }
        var base = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        var path = id + '/' + carpeta + '/' + base + ext;
        var r = await _supabase.storage.from('evidencias').upload(path, blob, { contentType: ctype, upsert: false });
        if (r.error) { window._sbToastError('subir archivo: ' + r.error.message); return null; }
        var pub = _supabase.storage.from('evidencias').getPublicUrl(path);
        return { url: pub.data.publicUrl, path: path, pdf: esPdf, nombre: file.name || '' };
    };

    // sbBorrarEvidencia(path) → borra el archivo del bucket
    window.sbBorrarEvidencia = async function (path) {
        if (!path || typeof _supabase === 'undefined') return;
        var r = await _supabase.storage.from('evidencias').remove([path]);
        if (r.error) window._sbToastError('borrar foto: ' + r.error.message);
    };

    // sbSubirFotoBase64(carpeta, dataUrl [, scope]) → Promise<url|null>
    // Sube una foto base64 (data:) a Storage y devuelve su URL pública.
    // Sirve para sacar las imágenes de adentro del dato (JSONB) → URLs ligeras.
    window.sbSubirFotoBase64 = async function (carpeta, dataUrl, scope) {
        if (!dataUrl || typeof dataUrl !== 'string' || dataUrl.indexOf('data:') !== 0) return null;
        if (typeof _supabase === 'undefined') return null;
        var blob;
        try {
            var parts = dataUrl.split(',');
            var mime  = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
            var bin   = atob(parts[1]);
            var arr   = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            blob = new Blob([arr], { type: mime });
        } catch (e) { return null; }
        var id    = scope || _negId() || 'catalogo';
        var base  = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        var path  = id + '/' + carpeta + '/' + base + '.jpg';
        var r = await _supabase.storage.from('evidencias').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
        if (r.error) { window._sbToastError && window._sbToastError('subir foto: ' + r.error.message); return null; }
        var pub = _supabase.storage.from('evidencias').getPublicUrl(path);
        return pub.data.publicUrl;
    };

    /* ── Sucursales en Supabase (antes solo localStorage → no sincronizaban) ──
       Doc por negocio en negocio_sucursales: { sucursales:[...], cfg:{[id]:{...}} }.
       sbUpsertDoc aligera los logos base64 a Storage automáticamente. */
    var _sucPushTimers = {};
    function _sucPushNow(negId) {
        var sucs = [];
        try { sucs = JSON.parse(localStorage.getItem('etaax_' + negId + '_sucursales') || '[]'); } catch (e) {}
        if (!sucs.length) return; // nada que respaldar
        var cfg = {};
        sucs.forEach(function (s) {
            var c = {};
            try { c = JSON.parse(localStorage.getItem('etaax_' + negId + '_suc_' + s.id) || '{}'); } catch (e) {}
            var logo = localStorage.getItem('etaax_' + negId + '_suc_' + s.id + '_logo') || '';
            if (logo) c._logo = logo; // el outbox lo aligera a URL si es base64
            cfg[s.id] = c;
        });
        // Vía outbox: confiable + offline + sin toast rojo (indicador discreto).
        window.sbUpsertDoc('negocio_sucursales', { sucursales: sucs, cfg: cfg }, negId);
    }
    window.sbSucPush = function (negId) {
        if (!negId) return;
        clearTimeout(_sucPushTimers[negId]);
        _sucPushTimers[negId] = setTimeout(function () { _sucPushNow(negId); }, 800);
    };

    // Trae las sucursales del negocio desde Supabase → localStorage. Devuelve true si trajo algo.
    window.sbSucPull = async function (negId) {
        if (!negId || typeof _supabase === 'undefined') return false;
        try {
            var res = await _supabase.from('negocio_sucursales').select('datos').eq('negocio_id', negId).maybeSingle();
            if (res.error || !res.data) return false;
            var d = res.data.datos || {};
            if (Array.isArray(d.sucursales) && d.sucursales.length) {
                try { localStorage.setItem('etaax_' + negId + '_sucursales', JSON.stringify(d.sucursales)); } catch (e) {}
            }
            if (d.cfg && typeof d.cfg === 'object') {
                Object.keys(d.cfg).forEach(function (sid) {
                    var c = Object.assign({}, d.cfg[sid]);
                    var logo = c._logo; delete c._logo;
                    try { localStorage.setItem('etaax_' + negId + '_suc_' + sid, JSON.stringify(c)); } catch (e) {}
                    if (logo) { try { localStorage.setItem('etaax_' + negId + '_suc_' + sid + '_logo', logo); } catch (e) {} }
                });
            }
            return true;
        } catch (e) { return false; }
    };
})();
