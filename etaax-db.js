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

    window.sbUpsert = async function (tabla, record, negId) {
        var id = negId || _negId();
        if (!id || typeof _supabase === 'undefined') return;
        try { await window.sbAligerarRecord(record, tabla, id); } catch (e) {}
        var r = await _supabase.from(tabla).upsert({
            id: record.id, negocio_id: id, datos: record,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        _check('upsert ' + tabla)(r);
    };

    window.sbUpsertDoc = async function (tabla, datos, negId) {
        var id = negId || _negId();
        if (!id || typeof _supabase === 'undefined') return;
        try { await window.sbAligerarRecord(datos, tabla, id); } catch (e) {}
        var r = await _supabase.from(tabla).upsert({
            negocio_id: id, datos: datos, updated_at: new Date().toISOString()
        }, { onConflict: 'negocio_id' });
        _check('upsert ' + tabla)(r);
    };

    window.sbDelete = function (tabla, id) {
        if (typeof _supabase === 'undefined') return;
        _supabase.from(tabla).delete().eq('id', id).then(_check('delete ' + tabla));
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
            if (logo) c._logo = logo; // sbUpsertDoc lo aligera a URL si es base64
            cfg[s.id] = c;
        });
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
