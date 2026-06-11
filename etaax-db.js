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

    window.sbUpsert = function (tabla, record, negId) {
        var id = negId || _negId();
        if (!id || typeof _supabase === 'undefined') return;
        _supabase.from(tabla).upsert({
            id: record.id, negocio_id: id, datos: record,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' }).then(_check('upsert ' + tabla));
    };

    window.sbUpsertDoc = function (tabla, datos, negId) {
        var id = negId || _negId();
        if (!id || typeof _supabase === 'undefined') return;
        _supabase.from(tabla).upsert({
            negocio_id: id, datos: datos, updated_at: new Date().toISOString()
        }, { onConflict: 'negocio_id' }).then(_check('upsert ' + tabla));
    };

    window.sbDelete = function (tabla, id) {
        if (typeof _supabase === 'undefined') return;
        _supabase.from(tabla).delete().eq('id', id).then(_check('delete ' + tabla));
    };
})();
