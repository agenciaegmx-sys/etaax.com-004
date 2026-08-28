/* ============================================================================
   ETAAX — Almacenamiento local grande (IndexedDB) con lectura SÍNCRONA.

   EL PROBLEMA QUE RESUELVE
   localStorage da ~5 MB por dominio, COMPARTIDOS entre todos los negocios que se
   hayan abierto en ese navegador. Un catálogo de 500 insumos ronda 1 MB; con tres
   negocios visitados, más inventarios y recetas, se acaba. Y cuando se acaba,
   `setItem` LANZA — y como esas llamadas viven dentro de try/catch mudos, la app
   seguía como si nada con los datos a medias. De ahí salieron tres bugs distintos:
   el buscador de ingredientes vacío en una computadora y lleno en otra, Recalcular
   dejando el reporte en ceros, y el conteo que "se quedaba en ceros".

   CÓMO
   Las claves GRANDES (catálogo, recetas, inventarios, log de entradas) se mudan a
   IndexedDB, que da gigabytes y es asíncrono. Pero el código de las páginas lee de
   forma SÍNCRONA (`_skGet` devuelve un string), así que aquí se mantiene un espejo
   EN MEMORIA: IndexedDB es la despensa y la memoria es la barra.

   · Al abrir la página se hidrata la memoria desde IndexedDB (async, una vez).
   · Las lecturas van a memoria — instantáneas y sin tope de 5 MB.
   · Las escrituras entran a memoria YA y bajan a IndexedDB en segundo plano.
   · Lo que ya estaba en localStorage se migra solo y se BORRA de ahí, liberando
     ese espacio para las claves chicas (sesión, preferencias), que se quedan
     donde están porque necesitan estar disponibles antes de que nada corra.

   Si IndexedDB no existe o falla, todo cae de vuelta a localStorage: la app
   funciona igual, solo con el tope de antes.

   API (deliberadamente parecida a lo que ya usaban las páginas):
     etaaxStore.get(clave)        → string | null   (síncrono, desde memoria)
     etaaxStore.set(clave, texto) → true            (síncrono a memoria)
     etaaxStore.del(clave)
     etaaxStore.esGrande(clave)   → ¿esta clave vive en IndexedDB?
     etaaxStore.ready             → Promise, resuelve cuando terminó de hidratar
     etaaxStore.uso()             → Promise<{usadoMB, cuotaMB, pct}>
     etaaxStore.pendientes()      → escrituras que aún no bajan a IndexedDB
   ============================================================================ */
(function () {
    var DB_NOMBRE = 'etaax', DB_VER = 1, TIENDA = 'kv';

    /* Qué se muda. Son las que crecen con el negocio: el catálogo de insumos (el
       que reventó), las recetas, los inventarios en borrador y el log de entradas.
       Lo demás (contexto de sesión, permisos, preferencias) es de bytes y se queda
       en localStorage, que está disponible de inmediato al cargar la página. */
    var GRANDES = ['insumos', 'recetas', 'inv_local', 'el_local', 'staff',
                   'checklists', 'checklist_runs', 'horarios',
                   'outbox_v1'];   // la cola de salida: con inventarios grandes NO cabe en localStorage

    var mem = {};            // clave → string
    var desdeIDB = {};       // claves que YA venían en IndexedDB al hidratar
    var pendientes = {};     // claves con escritura sin bajar a IndexedDB
    /* Claves que la APP ya escribió en esta carga. Hidratar es asíncrono, así que
       puede terminar DESPUÉS de una escritura y, al volcar lo leído sobre `mem`,
       pisar lo recién guardado con la versión vieja del disco. Ahí estaba la mitad
       del outbox que "no bajaba": el flush vaciaba la cola y la hidratación la
       resucitaba completa unos milisegundos después. Lo escrito en esta carga es
       siempre más nuevo que lo leído: gana. */
    var escritasEnSesion = {};
    var db = null, hayIDB = false;
    var hidratado = false;   // ya se sabe si hay IndexedDB y ya se leyó lo que tenía

    /* Acceso CRUDO a localStorage. El almacén se parcha a sí mismo más abajo, y su
       maquinaria interna (migración, bajada a disco) tiene que seguir viendo el
       localStorage de verdad — si pasara por el parche, borrar una clave del espejo
       borraría también la copia en memoria, que es justo lo contrario. */
    var _lsGet = localStorage.getItem.bind(localStorage);
    var _lsSet = localStorage.setItem.bind(localStorage);
    var _lsDel = localStorage.removeItem.bind(localStorage);

    function _esGrandeKey(k) {
        // k llega completa: "etaax_{negocio}_{clave}" o "etaax_{clave}"
        for (var i = 0; i < GRANDES.length; i++) {
            var suf = '_' + GRANDES[i];
            if (k.length > suf.length && k.slice(-suf.length) === suf) return true;
        }
        return false;
    }

    function _abrir() {
        return new Promise(function (resolve) {
            if (!window.indexedDB) return resolve(null);
            var req;
            try { req = indexedDB.open(DB_NOMBRE, DB_VER); }
            catch (e) { return resolve(null); }
            req.onupgradeneeded = function () {
                var d = req.result;
                if (!d.objectStoreNames.contains(TIENDA)) d.createObjectStore(TIENDA);
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror   = function () { resolve(null); };
            req.onblocked = function () { resolve(null); };
        });
    }

    function _leerTodo(d) {
        return new Promise(function (resolve) {
            var out = {};
            try {
                var tx = d.transaction(TIENDA, 'readonly');
                var st = tx.objectStore(TIENDA);
                var cur = st.openCursor();
                cur.onsuccess = function (ev) {
                    var c = ev.target.result;
                    if (!c) return resolve(out);
                    out[c.key] = c.value;
                    c.continue();
                };
                cur.onerror = function () { resolve(out); };
            } catch (e) { resolve(out); }
        });
    }

    function _escribir(k, v) {
        if (!db) return Promise.resolve(false);
        return new Promise(function (resolve) {
            try {
                var tx = db.transaction(TIENDA, 'readwrite');
                tx.objectStore(TIENDA).put(v, k);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror    = function () { resolve(false); };
                tx.onabort    = function () { resolve(false); };
            } catch (e) { resolve(false); }
        });
    }

    function _borrar(k) {
        if (!db) return Promise.resolve(false);
        return new Promise(function (resolve) {
            try {
                var tx = db.transaction(TIENDA, 'readwrite');
                tx.objectStore(TIENDA).delete(k);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror    = function () { resolve(false); };
            } catch (e) { resolve(false); }
        });
    }

    /* Bajada a IndexedDB agrupada. Escribir en cada tecla sería una transacción
       por pulsación; se juntan las claves tocadas y se bajan de golpe. */
    var _bajaTimer = null;
    function _programarBajada() {
        clearTimeout(_bajaTimer);
        _bajaTimer = setTimeout(_bajar, 250);
    }
    function _bajar() {
        var claves = Object.keys(pendientes);
        if (!claves.length) return Promise.resolve();
        if (!db) {
            /* Sin base todavía: puede ser que IndexedDB NO EXISTA en este navegador,
               o que simplemente aún no termine de abrir. Antes se trataban igual y se
               tiraban las claves pendientes — lo escrito en el primer cuarto de
               segundo de la página no llegaba nunca al disco y volvía a aparecer el
               estado viejo en la siguiente carga. Si solo es que aún no abre, se
               vuelve a intentar; si de plano no hay IndexedDB, ahí sí no hay a dónde
               bajarlas (la app sigue leyendo de memoria y de localStorage). */
            if (!hidratado) { _programarBajada(); return Promise.resolve(); }
            pendientes = {};
            return Promise.resolve();
        }
        pendientes = {};
        return Promise.all(claves.map(function (k) {
            if (mem[k] == null) return _borrar(k);
            return _escribir(k, mem[k]).then(function (ok) {
                /* Con el valor nuevo YA en disco, el espejo viejo de localStorage
                   solo puede hacer daño: `get` vuelve a él mientras la memoria no
                   hidrata y resucita el estado anterior. Así se quedaba pegada la
                   cola de salida en sus 314 pendientes, carga tras carga.
                   Se borra solo después de confirmar la escritura — antes sería
                   quedarse sin ninguna copia legible. */
                if (ok) { desdeIDB[k] = 1; try { _lsDel(k); } catch (e) {} }
                return ok;
            });
        }));
    }
    // Al salir de la página no puede quedarse nada arriba esperando el timer.
    function _flush() { clearTimeout(_bajaTimer); return _bajar(); }
    window.addEventListener('pagehide', _flush);
    window.addEventListener('beforeunload', _flush);
    window.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') _flush();
    });

    /* Migración: lo que ya estaba en localStorage se copia a IndexedDB y SOLO
       ENTONCES se borra de allá. Ese borrado es la mitad del arreglo (devuelve el
       espacio secuestrado por catálogos de negocios que quizá ni se usan), pero
       hacerlo antes de confirmar la escritura es perder datos: si IndexedDB no
       estaba disponible, o si otra pestaña todavía no hidrató su copia, se
       quedaban sin nada que leer. Primero se confirma, después se suelta. */
    function _migrarDesdeLocal() {
        var claves = [];
        for (var i = 0; i < localStorage.length; i++) claves.push(localStorage.key(i));
        var candidatas = claves.filter(function (k) {
            return k && k.indexOf('etaax_') === 0 && _esGrandeKey(k) && _lsGet(k) != null;
        });
        if (!candidatas.length) return Promise.resolve();

        /* EN DOS TIEMPOS, a propósito:
             carga 1 → se copia a IndexedDB y localStorage SE QUEDA como estaba.
             carga 2 → como la clave ya venía de IndexedDB, ahí sí se borra de allá.
           Borrar en la misma carga en que se copia abre una ventana peligrosa: si
           hay dos pestañas abriendo a la vez, la primera vacía localStorage justo
           cuando la segunda todavía no ha leído IndexedDB, y esa segunda arranca
           SIN catálogo. Con el paso intermedio siempre existe al menos una copia
           legible, y el espacio se libera igual en la siguiente carga. */
        var bytes = 0, liberadas = 0, copiadas = 0;
        return Promise.all(candidatas.map(function (k) {
            var v = _lsGet(k);
            if (desdeIDB[k]) {
                // Ya estaba a salvo en IndexedDB desde antes de esta carga.
                bytes += v.length;
                try { _lsDel(k); liberadas++; } catch (e) {}
                return Promise.resolve();
            }
            if (mem[k] == null) mem[k] = v;
            return _escribir(k, mem[k]).then(function (ok) { if (ok) copiadas++; });
        })).then(function () {
            if (liberadas) console.log('[etaax-store] ' + liberadas + ' clave(s) ya estaban en IndexedDB · ' +
                                       Math.round(bytes / 1024) + ' KB liberados de localStorage');
            if (copiadas)  console.log('[etaax-store] ' + copiadas + ' clave(s) copiadas a IndexedDB; se liberan en la próxima carga');
        });
    }

    var ready = _abrir().then(function (d) {
        db = d; hayIDB = !!d;
        if (!d) {
            hidratado = true;
            console.warn('[etaax-store] sin IndexedDB: se sigue usando localStorage (tope ~5 MB)');
            return;
        }
        return _leerTodo(d).then(function (todo) {
            Object.keys(todo).forEach(function (k) {
                desdeIDB[k] = 1;                     // sí estaba en disco (para la migración)
                if (escritasEnSesion[k]) return;     // pero la app ya la reescribió: no la pises
                mem[k] = todo[k];
            });
            hidratado = true;
            return _migrarDesdeLocal();
        });
    }).catch(function (e) {
        hidratado = true;
        console.warn('[etaax-store] no se pudo abrir IndexedDB:', e && e.message);
    });

    /* ══ EL ALMACÉN ATIENDE SUS LLAVES AUNQUE SE PIDAN POR localStorage ══════
       El bug que esto arregla: horarios, staff, checklists y el catálogo de
       recetas leían y escribían sus claves con `localStorage` directo. Pero esas
       claves son GRANDES: el almacén las copia a IndexedDB y después LAS BORRA de
       localStorage para liberar la cuota. Como esas páginas nunca miraban en
       IndexedDB, al par de cargas veían vacío — y el dueño veía sus horarios
       borrados "a los días", sin que nadie hubiera borrado nada.

       Se podía arreglar cambiando los catorce lugares que las usan. Pero eso deja
       la trampa armada para el que agregue el número quince, y el error no avisa:
       los datos se ven bien un rato y desaparecen después.
       Mejor que el almacén responda por sus llaves venga la pregunta por donde
       venga. Es el mismo patrón que ya usa negocio-tab.js con las suyas.

       OJO con el orden: negocio-tab.js parcha PRIMERO (va antes en el head) y
       este parche encadena con el suyo — las llaves que no son grandes siguen
       pasando por él. */
    (function _parcharLocalStorage() {
        var ls = window.localStorage; if (!ls) return;
        var _get = ls.getItem.bind(ls), _set = ls.setItem.bind(ls), _del = ls.removeItem.bind(ls);
        try {
            Object.defineProperty(ls, 'getItem', { configurable: true, value: function (k) {
                if (_esGrandeKey(String(k))) {
                    // Espejo en memoria; si aún no hidrata, el localStorage viejo
                    // sirve de puente para no arrancar en blanco.
                    if (mem[k] != null) return mem[k];
                    return _get(k);
                }
                return _get(k);
            }});
            Object.defineProperty(ls, 'setItem', { configurable: true, value: function (k, v) {
                if (_esGrandeKey(String(k))) {
                    mem[k] = String(v); pendientes[k] = 1; escritasEnSesion[k] = 1;
                    _programarBajada();
                    return;   // NO se escribe en localStorage: para eso está IndexedDB
                }
                return _set(k, v);
            }});
            Object.defineProperty(ls, 'removeItem', { configurable: true, value: function (k) {
                if (_esGrandeKey(String(k))) {
                    mem[k] = null; pendientes[k] = 1; escritasEnSesion[k] = 1;
                    _programarBajada();
                }
                return _del(k);
            }});
        } catch (e) { /* navegador que no deja redefinir: se queda como antes */ }
    })();

    window.etaaxStore = {
        ready: ready,
        esGrande: _esGrandeKey,
        hayIDB: function () { return hayIDB; },

        hidratado: function () { return hidratado; },

        get: function (k) {
            if (_esGrandeKey(k)) {
                if (mem[k] != null) return mem[k];
                /* YA HIDRATADO = la memoria es la verdad. Un null aquí significa "no
                   existe", NO "pregúntale a localStorage". Caer al espejo después de
                   hidratar RESUCITA lo viejo: así volvían los 348 pendientes de la
                   cola, minutos después de haberla vaciado.
                   El puente al espejo solo tiene sentido ANTES de hidratar, para no
                   arrancar en blanco — o cuando NO HAY IndexedDB, porque entonces
                   localStorage no es un espejo: es el almacén de verdad y hay que
                   seguir leyéndolo (tablets viejas, modo privado). */
                if (hidratado && hayIDB) return null;
                try { return _lsGet(k); } catch (e) { return null; }
            }
            try { return _lsGet(k); } catch (e) { return null; }
        },

        set: function (k, v) {
            if (_esGrandeKey(k)) {
                mem[k] = String(v);
                pendientes[k] = 1;
                escritasEnSesion[k] = 1;
                _programarBajada();
                return true;                       // ya está disponible para leer
            }
            try { _lsSet(k, v); return true; }
            catch (e) {
                console.warn('[etaax-store] no cupo en localStorage:', k, e && e.message);
                return false;
            }
        },

        del: function (k) {
            if (_esGrandeKey(k)) { mem[k] = null; pendientes[k] = 1; _programarBajada(); }
            try { _lsDel(k); } catch (e) {}
        },

        pendientes: function () { return Object.keys(pendientes).length; },
        flush: _flush,

        // Diagnóstico: cuánto se está usando de verdad y de cuánto se dispone.
        uso: function () {
            if (!navigator.storage || !navigator.storage.estimate)
                return Promise.resolve({ usadoMB: null, cuotaMB: null, pct: null });
            return navigator.storage.estimate().then(function (e) {
                var u = (e.usage || 0) / 1048576, q = (e.quota || 0) / 1048576;
                return { usadoMB: Math.round(u * 10) / 10, cuotaMB: Math.round(q),
                         pct: q ? Math.round((u / q) * 1000) / 10 : null };
            }).catch(function () { return { usadoMB: null, cuotaMB: null, pct: null }; });
        }
    };
})();
