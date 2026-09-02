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
    // ¿El error es por falta de RED (offline / fetch fallido)? El aviso
    // "Sin sincronizar · revisa tu conexión" SOLO debe salir en ese caso. Errores de
    // servidor/permiso (RLS, esquema) se registran en consola pero no se muestran como
    // problema de internet (sería un falso "revisa tu conexión").
    function _esErrorDeRed(detalle) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
        return /failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|err_connection|timeout|fetch/i.test(String(detalle || ''));
    }
    /* El motivo EXACTO del último fallo de subida. _sbToastError manda a consola
       todo lo que no sea de red y solo enseña los de red — razonable para no
       alarmar por un error de esquema, pero deja al usuario (y a quien
       diagnostica) sin saber qué pasó. Las subidas guardan aquí su motivo para
       poder decirlo donde importa. */
    window._sbUltimoError = '';
    window._sbToastError = function (detalle) {
        window._sbUltimoError = String(detalle || '');
        console.error('[etaax-db]', detalle);
        if (!_esErrorDeRed(detalle)) return; // no es de red → solo consola, sin alarmar
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
    /* La cola vive en el almacenamiento GRANDE (IndexedDB vía etaax-store).
       Antes era localStorage y ahí estaba el bug del "313 cambios pendientes" que
       nunca bajaba: con inventarios encolados la cola pesa megas, el setItem
       reventaba por cuota y —como fallaba en silencio— los items YA SUBIDOS no se
       podían quitar. Resultado: el contador congelado y los mismos 313 registros
       re-subiéndose enteros en cada carga de la página.
       Si el guardado falla, ahora se avisa: una cola que no se puede escribir es
       una cola que va a repetir trabajo para siempre. */
    function _obLoad() {
        try {
            var raw = window.etaaxStore ? etaaxStore.get(OUTBOX) : localStorage.getItem(OUTBOX);
            return JSON.parse(raw) || [];
        } catch (e) { return []; }
    }
    var _obSaveAviso = false;
    function _obSave(q) {
        var txt;
        try { txt = JSON.stringify(q); } catch (e) { return; }
        if (window.etaaxStore) { etaaxStore.set(OUTBOX, txt); return; }
        try { localStorage.setItem(OUTBOX, txt); }
        catch (e) {
            if (!_obSaveAviso) {
                _obSaveAviso = true;
                console.error('[outbox] NO se pudo guardar la cola (' + Math.round(txt.length / 1024) +
                              ' KB): los cambios ya subidos no se pueden quitar y se van a repetir. ' +
                              'Falta etaax-store.js en esta página.', e && e.message);
            }
        }
    }

    /* Una cola que baja y una cola ATORADA se ven igual desde afuera: un número que
       no cambia. Y no es lo mismo "va en camino" que "este registro ya falló seis
       veces y a la octava se descarta". Los atorados (los que ya fallaron por algo
       que NO es falta de red) se separan y se dicen por su nombre. */
    function _obIndicador() {
        var q = _obLoad();
        var n = q.length;
        var atorados = q.filter(function (it) { return it && (it.tries || 0) > 0; });
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
        el.style.borderColor = atorados.length ? '#e05c5c' : '#f5c842';
        var s = n !== 1 ? 's' : '';
        var txt = '<span style="color:#f5c842;font-weight:700">⏳ Sincronizando…</span> ' +
            n + ' cambio' + s + ' pendiente' + s + ' (se sube' + (n !== 1 ? 'n' : '') + ' solo' + s + ').';
        if (atorados.length) {
            // El que más ha fallado marca qué tan cerca está el descarte (a los 8 intentos).
            var peor = atorados.reduce(function (a, b) { return (b.tries || 0) > (a.tries || 0) ? b : a; });
            txt += '<div style="margin-top:5px;color:#e05c5c;font-size:11px">⚠️ ' + atorados.length +
                ' atorado' + (atorados.length !== 1 ? 's' : '') + ' — el más terco lleva ' +
                (peor.tries || 0) + ' de 8 intentos (' + _esc(peor.tabla || '?') + ').' +
                '<br><span style="opacity:.75">Escribe <b>_sbOutbox()</b> en la consola para ver cuáles.</span></div>';
        }
        el.innerHTML = txt;
        el.style.display = 'block';
    }
    // El nombre de la tabla va dentro de innerHTML: nunca confiar en que venga limpio.
    function _esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /* ESPERAR A QUE HIDRATE ANTES DE TOCAR LA COLA.
       Aquí estaba el rebote de los 348: inventarios auto-guarda a los milisegundos
       de cargar, mucho antes de que IndexedDB termine de hidratar. En ese hueco
       _obLoad() caía al espejo viejo de localStorage y leía la cola COMPLETA de
       antes; se le agregaba el item nuevo y se guardaba — y como escribir marca la
       clave como "tocada en esta sesión", la hidratación la respetaba y ya no
       cargaba la cola real, que estaba vacía. Los pendientes revivían y quedaban
       cementados por la misma protección que evita que la hidratación pise lo
       recién escrito. */
    function _obAdd(item) {
        try {
            if (window.etaaxStore && etaaxStore.ready &&
                typeof etaaxStore.hidratado === 'function' && !etaaxStore.hidratado()) {
                etaaxStore.ready.then(function () { _obAddYa(item); },
                                      function () { _obAddYa(item); });
                return;
            }
        } catch (e) { /* sin almacén: se encola de inmediato */ }
        _obAddYa(item);
    }
    function _obAddYa(item) {
        var q = _obLoad(), prev = null;
        // dedup: misma tabla + clave + op → gana el último estado (conserva los intentos
        // para que un item genuinamente roto no se re-encole en bucle eterno)
        q = q.filter(function (x) {
            if (x.tabla === item.tabla && x.k === item.k && x.op === item.op) { prev = x; return false; }
            return true;
        });
        item.tries = prev ? (prev.tries || 0) : 0;
        // uid único por item: el flush lo usa para quitar de la cola SOLO lo que
        // ejecutó (sin pisar items encolados mientras el flush estaba corriendo).
        item.uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        q.push(item);
        _obSave(q);
        _obIndicador();
        _obFlush();
    }

    // Devuelve el ERROR (o null si ok). Una EXCEPCIÓN (fetch caído) se devuelve como error
    // de red → el flush NO la cuenta como intento (no descarta el dato en offline real).
    async function _obEjecutar(it) {
        try {
            if (it.op === 'delete') {
                var rd = await _supabase.from(it.tabla).delete().eq('id', it.id);
                if (rd.error) console.warn('[outbox] delete falló', it.tabla, it.id, '→', rd.error.message);
                return rd.error || null;
            }
            // Aligerar al momento de subir (requiere red): base64 → Storage URL
            try {
                if (it.payload && it.payload.datos && window.sbAligerarRecord) {
                    await window.sbAligerarRecord(it.payload.datos, it.tabla, it.payload.negocio_id);
                }
            } catch (e) { console.warn('[outbox] aligerar falló', it.tabla, it.k, '→', (e && e.message) || e); }
            var ru = await _supabase.from(it.tabla).upsert(it.payload, it.opts);
            if (ru.error) {
                var kb = '?'; try { kb = Math.round(JSON.stringify(it.payload).length / 1024) + 'KB'; } catch (e) {}
                console.warn('[outbox] upsert falló', it.tabla, it.k, '(' + kb + ') →', ru.error.message);
            }
            return ru.error || null;
        } catch (e) { return e || new Error('network'); } // excepción = red caída
    }
    // ¿El error parece FALTA DE RED (no un error de datos/RLS)? → no descartar, reintentar.
    function _esErrRed(err) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
        var m = ((err && (err.message || err.msg || err)) + '').toLowerCase();
        return /fetch|network|failed to fetch|networkerror|load failed|timeout|timed out|econn|dns|offline|abort/.test(m);
    }

    var _obFlushing = false, _obRepetir = false;
    async function _obFlush() {
        if (_obFlushing) { _obRepetir = true; return; } // algo entró en pleno flush → correr otra vuelta al terminar
        if (typeof _supabase === 'undefined') return;
        // OJO: ya NO cortamos por navigator.onLine — muchas tablets/webviews lo reportan MAL
        // como offline aunque haya red, y el outbox se quedaba atorado TODO el día. Ahora
        // SIEMPRE intenta; si de verdad no hay red, _esErrRed evita descartar (solo reintenta).
        // El candado se cierra ANTES del primer await: si no, dos llamadas seguidas
        // (el temporizador y un `focus`, por ejemplo) pasarían las dos y correrían en paralelo.
        _obFlushing = true;
        try {
            /* Esperar a que el almacén hidrate ANTES de leer la cola. Sin esto, un flush
               temprano leía el espejo viejo de localStorage (la cola completa), la subía
               entera otra vez y guardaba el resultado en memoria… que la hidratación
               pisaba medio segundo después con la versión de disco. El contador se
               quedaba clavado y los mismos registros se re-subían en cada carga. */
            if (window.etaaxStore && etaaxStore.ready) { try { await etaaxStore.ready; } catch (e) {} }
            var q = _obLoad(), hechos = {}, triesUpd = {}, muertos = {};
            // Items de una versión vieja sin uid: asignarles uno y PERSISTIRLO antes
            // de ejecutar, para que el merge de abajo los identifique igual que al resto.
            var _sinUid = false;
            q.forEach(function (it) { if (it && !it.uid) { it.uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); _sinUid = true; } });
            if (_sinUid) _obSave(q);

            /* ⚠️ NO pisar la cola con el snapshot: mientras el flush corre (awaits de
               red) pueden ENCOLARSE items nuevos (ej. borrar varios gastos seguidos) y
               guardarse encima los perdería sin ejecutar → "los borrados revivían".
               Se re-lee la cola actual y solo se quita/actualiza lo que ESTE flush tocó. */
            function _asentar() {
                var fresca = _obLoad().filter(function (x) {
                    if (!x || !x.uid) return false;
                    if (hechos[x.uid] || muertos[x.uid]) return false;           // ejecutado o descartado
                    if (triesUpd[x.uid] !== undefined) x.tries = triesUpd[x.uid]; // falló → conservar con sus intentos
                    return true;
                });
                _obSave(fresca);
                _obIndicador();
            }

            for (var i = 0; i < q.length; i++) {
                var it = q[i], err = null;
                try { err = await _obEjecutar(it); } catch (e) { err = e || new Error('network'); }
                if (!err) { if (it.uid) hechos[it.uid] = 1; }
                else if (_esErrRed(err)) {
                    // Falta de red (o tablet que se reporta offline por error): NO cuenta como
                    // intento → el dato NO se descarta, se reintenta en la próxima vuelta.
                } else {
                    it.tries = (it.tries || 0) + 1;
                    if (it.tries >= 8) {
                        if (it.uid) muertos[it.uid] = 1;
                        /* NO se descarta en silencio. Un console.error no lo lee
                           nadie, y esto es un dato del negocio que se pierde: así
                           desaparecían semanas de horarios ya capturadas. Se guarda
                           en un apartado y se AVISA en pantalla hasta que alguien
                           lo mire. */
                        _guardarDescartado(it, err);
                        console.error('[outbox] descartado tras 8 intentos:', it.tabla, it.k, err && err.message);
                    }
                    else if (it.uid) triesUpd[it.uid] = it.tries;
                }
                /* SE ASIENTA EL AVANCE CADA POCOS ITEMS, no al final.
                   Aquí estaba el bug de la cola que "crece y no baja": con 347
                   pendientes, una vuelta completa tarda uno o dos MINUTOS de idas y
                   vueltas a la red. Si en ese rato el usuario cambia de página,
                   cierra la pestaña, o el navegador congela la pestaña en segundo
                   plano —cosa que hace sola—, el ciclo muere antes del guardado
                   final y NADA de lo ya subido se quita de la cola. Al volver, los
                   mismos registros se re-suben y encima se agregan los nuevos: la
                   cola solo puede crecer, aunque cada subida esté funcionando.
                   Asentando por lotes, lo hecho ya no se repite jamás. */
                if ((i + 1) % 5 === 0) _asentar();
            }
            _asentar();
        } finally {
            _obFlushing = false;
            if (_obRepetir) { _obRepetir = false; setTimeout(_obFlush, 50); } // vuelta extra por lo encolado en pleno flush
        }
    }
    window._sbFlush = _obFlush;
    /* ══ LO QUE NO SE PUDO GUARDAR ═════════════════════════════════════════
       Un cambio que el servidor rechaza ocho veces se saca de la cola para que
       no la atore para siempre. Pero sacarlo y callarse es perder un dato del
       negocio sin que nadie se entere — así se esfumaban semanas de horarios ya
       capturadas: vivían en el navegador un rato y luego, nada.

       Se guardan aparte, con el motivo, y se avisa en pantalla hasta que alguien
       los mire. Que estorbe es el punto: un dato perdido debe doler. */
    var DESCARTADOS = 'etaax_sync_descartados';

    function _guardarDescartado(item, err) {
        try {
            var l = JSON.parse(localStorage.getItem(DESCARTADOS) || '[]') || [];
            l.push({
                tabla: item.tabla, k: item.k, op: item.op,
                motivo: (err && err.message) || 'desconocido',
                cuando: new Date().toISOString(),
                payload: item.payload || null    // para poder reintentarlo a mano
            });
            /* Tope: si algo falla masivamente, no se llena el almacén con el
               registro del fallo — eso rompería lo que todavía funciona. */
            if (l.length > 200) l = l.slice(-200);
            localStorage.setItem(DESCARTADOS, JSON.stringify(l));
        } catch (e) { /* si ni esto cabe, queda el console.error */ }
        _avisoDescartados();
    }

    function _avisoDescartados() {
        var l = [];
        try { l = JSON.parse(localStorage.getItem(DESCARTADOS) || '[]') || []; } catch (e) {}
        var el = document.getElementById('etaax-descartes');
        if (!l.length) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div');
            el.id = 'etaax-descartes';
            el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;' +
                'background:#2a1512;border:1px solid #e05a3a;border-radius:10px;padding:12px 18px;' +
                'font-family:"DM Sans",sans-serif;font-size:12.5px;color:#f0ece6;max-width:400px;line-height:1.6;' +
                'box-shadow:0 8px 32px rgba(0,0,0,.5)';
            if (document.body) document.body.appendChild(el);
        }
        var tablas = {};
        l.forEach(function (x) { tablas[x.tabla] = (tablas[x.tabla] || 0) + 1; });
        /* Tocable, no "abre la consola": esto pasa sobre todo en la TABLET de la
           barra, donde no hay consola que abrir. El motivo tiene que poder verse
           y copiarse desde el mismo aparato. */
        el.style.cursor = 'pointer';
        el.innerHTML = '<b style="color:#e05a3a">⚠️ ' + l.length + ' cambio' + (l.length !== 1 ? 's' : '') +
            ' no se pudo guardar</b><br>' +
            '<span style="color:#a8a29a">' + Object.keys(tablas).map(function (t) {
                return _esc(t) + ' (' + tablas[t] + ')';
            }).join(' · ') + '</span><br>' +
            '<span style="font-size:11px;color:#e0a93d">Toca aquí para ver el motivo y reintentar</span>';
        el.onclick = _panelDescartes;
    }

    /* El detalle, en pantalla. En la tablet no hay consola, y el motivo es
       justamente lo que hace falta para arreglarlo. */
    function _panelDescartes() {
        var l = [];
        try { l = JSON.parse(localStorage.getItem(DESCARTADOS) || '[]') || []; } catch (e) {}
        if (!l.length) return;
        var viejo = document.getElementById('etaax-descartes-panel');
        if (viejo) viejo.remove();

        var ov = document.createElement('div');
        ov.id = 'etaax-descartes-panel';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.78);overflow-y:auto;' +
            'padding:22px 16px;font-family:"DM Sans",sans-serif';
        /* El motivo del PRIMERO va arriba y completo: casi siempre todos fallan
           por lo mismo, y es el texto que hay que reenviar para que lo arreglen. */
        var motivo = l[0].motivo || 'desconocido';
        var filas = l.slice(0, 40).map(function (x) {
            var f = new Date(x.cuando);
            return '<div style="padding:9px 0;border-bottom:1px solid #2a2824">' +
                '<div style="font-size:13px;color:#f0ece6">' + _esc(x.tabla) + ' · <span style="color:#a8a29a">' + _esc(x.k || '') + '</span></div>' +
                '<div style="font-size:11px;color:#6b6862;margin-top:2px">' +
                    (isNaN(f) ? '' : f.toLocaleString('es-MX')) + '</div></div>';
        }).join('');

        ov.innerHTML =
            '<div style="max-width:520px;margin:0 auto;background:#14130f;border:1px solid #2a2824;border-radius:16px;padding:22px">' +
              '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
                '<span style="font-size:22px">⚠️</span>' +
                '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:1.5px;color:#f0ece6">' +
                  l.length + ' CAMBIO' + (l.length !== 1 ? 'S' : '') + ' SIN GUARDAR</div>' +
              '</div>' +
              '<div style="font-size:12.5px;color:#a8a29a;line-height:1.6;margin-bottom:14px">' +
                'El servidor los rechazó y se sacaron de la cola para que no la atoraran. ' +
                'La información NO se borró: sigue aquí y se puede volver a mandar.</div>' +
              '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#6b6862;margin-bottom:5px">Motivo</div>' +
              '<div id="edMotivo" style="background:#1a1916;border:1px solid #2a2824;border-radius:9px;padding:11px 13px;' +
                   'font-family:monospace;font-size:11.5px;color:#e0a93d;line-height:1.5;word-break:break-word">' +
                _esc(motivo) + '</div>' +
              '<div style="display:flex;gap:9px;flex-wrap:wrap;margin:14px 0 18px">' +
                '<button id="edCopiar" style="background:#1a1916;border:1px solid #2a2824;color:#a8a29a;border-radius:8px;' +
                  'padding:9px 15px;font-family:inherit;font-size:12.5px;cursor:pointer">📋 Copiar el motivo</button>' +
                '<button id="edReintentar" style="background:#3dbe7a;border:none;color:#0a0908;border-radius:8px;' +
                  'padding:9px 17px;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer">Volver a intentar</button>' +
              '</div>' +
              '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#6b6862;margin-bottom:2px">Qué quedó pendiente</div>' +
              filas +
              (l.length > 40 ? '<div style="font-size:11px;color:#6b6862;padding-top:8px">…y ' + (l.length - 40) + ' más</div>' : '') +
              '<button id="edCerrar" style="width:100%;margin-top:16px;background:transparent;border:1px solid #2a2824;' +
                'color:#a8a29a;border-radius:9px;padding:11px;font-family:inherit;font-size:13px;cursor:pointer">Cerrar</button>' +
            '</div>';
        document.body.appendChild(ov);
        ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
        document.getElementById('edCerrar').onclick = function () { ov.remove(); };
        document.getElementById('edCopiar').onclick = function () {
            var txt = 'ETAAX · ' + l.length + ' cambios sin guardar\n' +
                      'Tablas: ' + Object.keys(tablasDe(l)).join(', ') + '\nMotivo: ' + motivo;
            try {
                if (navigator.clipboard) navigator.clipboard.writeText(txt);
                else { var t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
                document.getElementById('edCopiar').textContent = '✓ Copiado';
            } catch (e) { alert(txt); }
        };
        document.getElementById('edReintentar').onclick = function () {
            var n = window._sbReintentar();
            ov.remove();
            alert(n + ' cambio(s) se volvieron a mandar. Mira el indicador de sincronización abajo.');
        };
    }
    function tablasDe(l) {
        var t = {}; l.forEach(function (x) { t[x.tabla] = (t[x.tabla] || 0) + 1; }); return t;
    }

    // Qué se perdió y por qué.
    window._sbDescartes = function () {
        var l = [];
        try { l = JSON.parse(localStorage.getItem(DESCARTADOS) || '[]') || []; } catch (e) {}
        console.table(l.map(function (x) {
            return { tabla: x.tabla, clave: x.k, op: x.op, motivo: x.motivo, cuando: x.cuando };
        }));
        return l;
    };

    /* Volver a encolarlos. Sirve cuando el motivo ya se corrigió (una política de
       permisos, una columna que faltaba): el dato sigue aquí y puede subir. */
    window._sbReintentar = function () {
        var l = [];
        try { l = JSON.parse(localStorage.getItem(DESCARTADOS) || '[]') || []; } catch (e) {}
        if (!l.length) { console.log('No hay nada descartado.'); return 0; }
        l.forEach(function (x) {
            if (x.payload) _obAdd({ op: x.op, tabla: x.tabla, k: x.k, payload: x.payload, opts: { onConflict: 'id' } });
        });
        try { localStorage.removeItem(DESCARTADOS); } catch (e) {}
        _avisoDescartados();
        _obFlush();
        console.log('Reencolados ' + l.length + '. Mira el indicador de sincronización.');
        return l.length;
    };

    window._sbPendientes = function () { return _obLoad().length; };

    /* ══ FORENSE DE LA COLA ═══════════════════════════════════════════════
       Se corre en la consola: _sbColaDiag()

       "Baja a cero y al recargar vuelven los mismos" tiene dos causas que desde
       fuera se ven idénticas, y distinguirlas a ojo es imposible:
         · la cola SE VACÍA pero el vaciado no llega al disco → en la siguiente
           carga se lee la copia vieja y parece que resucitaron;
         · algo REENCOLA los mismos registros en cada carga (un merge, un
           re-upsert de arranque), y la cola es nueva aunque el contenido rime.
       La diferencia está en los `uid`: si vuelven los MISMOS, es lo primero; si
       vuelven otros, es lo segundo. */
    window._sbColaDiag = function () {
        var enMem = _obLoad();
        var crudo = [];
        try { crudo = JSON.parse(localStorage.getItem(OUTBOX) || '[]') || []; } catch (e) {}
        var idb = null;
        try { idb = (window.etaaxStore && etaaxStore.get) ? JSON.parse(etaaxStore.get(OUTBOX) || '[]') : null; } catch (e) {}

        var porTabla = {}; enMem.forEach(function (x) { porTabla[x.tabla] = (porTabla[x.tabla] || 0) + 1; });
        var r = {
            pendientes: enMem.length,
            por_tabla: porTabla,
            con_reintentos: enMem.filter(function (x) { return (x.tries || 0) > 0; }).length,
            // Los primeros uid: si tras recargar son LOS MISMOS, la cola no se está
            // vaciando de verdad; si son otros, algo la está rellenando.
            primeros_uid: enMem.slice(0, 5).map(function (x) { return x.uid; }),
            en_espejo_localStorage: crudo.length,
            en_almacen: idb === null ? '(sin etaaxStore)' : idb.length,
            almacen_hidratado: (window.etaaxStore && etaaxStore.hidratado) ? etaaxStore.hidratado() : '(n/a)'
        };
        console.log('──── FORENSE DE LA COLA ────');
        Object.keys(r).forEach(function (k) { console.log('  ' + k + ':', r[k]); });
        console.log('  · Anota los "primeros_uid", recarga la página y vuelve a correrlo.');
        console.log('    MISMOS uid → la cola no se vacía de verdad.');
        console.log('    OTROS uid  → algo la está rellenando en cada carga.');
        return r;
    };
    // Diagnóstico: en consola, _sbOutbox() lista los items atorados (tabla, clave, intentos, tamaño).
    window._sbOutbox = function () {
        return _obLoad().map(function (it) {
            var kb = '?'; try { kb = Math.round(JSON.stringify(it.payload || {}).length / 1024) + 'KB'; } catch (e) {}
            return { tabla: it.tabla, op: it.op, clave: it.k, intentos: it.tries || 0, tamaño: kb };
        });
    };
    // _sbVaciarOutbox() — descarta la cola (último recurso si algo quedó roto).
    window._sbVaciarOutbox = function () { _obSave([]); _obIndicador(); return 'outbox vaciado'; };

    // Ids con DELETE pendiente en el outbox para una tabla. Los reloads (realtime
    // o carga inicial) deben IGNORAR esos registros: si la nube aún los tiene
    // porque el delete va en camino, sin esto "revivían" en pantalla unos
    // segundos (o para siempre, si el flush se perdía el delete).
    window.sbDeletesPendientes = function (tabla) {
        var s = {};
        _obLoad().forEach(function (it) { if (it && it.op === 'delete' && it.tabla === tabla && it.id) s[it.id] = 1; });
        return s;
    };

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

    // Disparadores del flush: al cargar, al reconectar, cada 20s, y al VOLVER la pestaña
    // visible (las tablets throttlean/pausan los timers en 2do plano → al reabrir la app se
    // fuerza el vaciado, para que no se queden movimientos atorados todo el día).
    if (typeof window !== 'undefined') {
        window.addEventListener('online', _obFlush);
        window.addEventListener('focus', _obFlush);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', function () { if (!document.hidden) _obFlush(); });
        }
        setInterval(_obFlush, 20000);
        setTimeout(function () { _obIndicador(); _avisoDescartados(); _obFlush(); }, 1500);
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

    // sbSubirArchivo(carpeta, file [, scope]) → Promise<url|null>
    // Sube un File TAL CUAL a Storage, sin pasar por base64. Para video no hay
    // alternativa: un clip de minutos en base64 crece ~33% y revienta la memoria
    // del teléfono antes de salir.
    window.sbSubirArchivo = async function (carpeta, file, scope) {
        if (!file || typeof _supabase === 'undefined') return null;
        var id   = scope || _negId() || 'catalogo';
        var ext  = (file.name && file.name.indexOf('.') >= 0) ? file.name.split('.').pop().toLowerCase() : 'bin';
        var base = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        var path = id + '/' + carpeta + '/' + base + '.' + ext;
        var r = await _supabase.storage.from('evidencias').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
        if (r.error) { window._sbUltimoError = r.error.message; window._sbToastError && window._sbToastError('subir archivo: ' + r.error.message); return null; }
        return _supabase.storage.from('evidencias').getPublicUrl(path).data.publicUrl;
    };

    /* ══ LOGOS: A STORAGE, NUNCA A localStorage ═══════════════════════════
       El logo del negocio y el de cada sucursal se guardaban como base64 en
       localStorage, con `setItem` a pelo y SIN manejo de error. En esta app
       localStorage se llena —es la causa raíz de media docena de bugs viejos— y
       ahí setItem LANZA: la subida moría en silencio y el logo simplemente no
       aparecía nunca, ni en pantalla ni en los reportes impresos.

       Ahora sube a Storage y en localStorage solo queda la URL, que son 100
       bytes en vez de 80 KB. Y si la subida falla, SE DICE: quedarse callado es
       lo que hizo que este bug durara meses.

       Devuelve la URL, o null si no se pudo (el llamador avisa al usuario). */
    window.sbSubirLogo = async function (file, negId) {
        var id = negId || _negId();
        if (!file || !id || typeof _supabase === 'undefined') return null;
        window._sbUltimoError = '';
        var r = await window.sbSubirEvidencia('logos', file, id);
        return (r && r.url) || null;
    };

    /* Traduce el error crudo del servidor a algo accionable. Un rechazo de
       permisos y una caída de red se ven idénticos desde el navegador —los dos
       son "no se pudo"— y decirle "revisa tu internet" a quien tiene internet
       lo manda a buscar un problema que no tiene. */
    window.sbMotivoSubida = function () {
        var e = String(window._sbUltimoError || '');
        if (!e) return 'No se pudo subir el archivo.';
        if (/row-level security|violates|policy|not authorized|403/i.test(e))
            return 'El servidor no te dejó subir el archivo a este negocio (permisos). ' +
                   'No es tu conexión — avísale a ETAAX con este texto: ' + e;
        if (/payload too large|413|exceeded maximum/i.test(e))
            return 'La imagen pesa demasiado. Súbela más chica.';
        if (/failed to fetch|networkerror|load failed|timeout/i.test(e))
            return 'No se pudo conectar. Revisa tu internet e inténtalo de nuevo.';
        if (/duplicate|already exists/i.test(e))
            return 'Ya existe un archivo con ese nombre. Inténtalo de nuevo.';
        return 'No se pudo subir el archivo: ' + e;
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
