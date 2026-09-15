/* ============================================================================
   ETAAX — NEGOCIO ACTIVO POR PESTAÑA

   El problema que resuelve: `etaax_negocio_activo`, `etaax_ctx` y
   `etaax_sucursal_activa` vivían en localStorage, que es UNO SOLO para todas
   las pestañas del navegador. Con dos negocios abiertos a la vez, la última
   pestaña que elegía negocio le cambiaba el negocio a las demás sin que se
   notara: seguían mostrando lo suyo, pero al guardar escribían con el
   negocio_id equivocado (getNegocioActivo() vuelve a leer la llave en CADA
   guardado) y el respaldo local `etaax_{negocio}_recetas` se escribía con el
   prefijo del otro. Al recargar, el merge re-subía esas recetas al negocio
   equivocado y el cruce quedaba grabado en Supabase.

   Cómo lo resuelve, sin tocar los ~80 lugares que leen esas llaves: al cargar
   la página se FIJA el contexto en sessionStorage (que sí es por pestaña) y se
   intercepta localStorage SOLO para esas tres llaves. Dentro de esta pestaña,
   leer la llave devuelve siempre lo fijado; escribirla actualiza el fijado y
   además localStorage, para que una pestaña NUEVA arranque con el último
   negocio usado (que es lo que uno espera al abrir la app).

   Debe cargarse ANTES que cualquier otro script (va primero en el <head>).
   ============================================================================ */
(function () {
    if (window._etaaxNegTab) return; window._etaaxNegTab = true;

    // Las tres llaves que definen "qué estoy viendo". El resto de los datos ya
    // van con prefijo por negocio (etaax_{negId}_...), así que no se cruzan.
    var LLAVES = ['etaax_negocio_activo', 'etaax_ctx', 'etaax_sucursal_activa'];
    var PREFIJO = 'etaax_tab_';

    var ls = window.localStorage, ss = window.sessionStorage;
    if (!ls || !ss) return;

    // Fijar: lo que ya tenga esta pestaña manda; si es la primera vez, hereda
    // lo último de localStorage (venir del hub, abrir una pestaña nueva).
    LLAVES.forEach(function (k) {
        try {
            if (ss.getItem(PREFIJO + k) === null) {
                var v = ls.getItem(k);
                if (v !== null) ss.setItem(PREFIJO + k, v);
            }
        } catch (e) {}
    });

    function esNuestra(k) { return LLAVES.indexOf(String(k)) >= 0; }

    var _get = ls.getItem.bind(ls), _set = ls.setItem.bind(ls), _del = ls.removeItem.bind(ls);

    try {
        Object.defineProperty(ls, 'getItem', {
            configurable: true,
            value: function (k) {
                if (esNuestra(k)) {
                    var v = ss.getItem(PREFIJO + k);
                    return v === null ? null : v;      // la pestaña manda, aunque otra haya cambiado localStorage
                }
                return _get(k);
            }
        });
        Object.defineProperty(ls, 'setItem', {
            configurable: true,
            value: function (k, v) {
                if (esNuestra(k)) { try { ss.setItem(PREFIJO + k, String(v)); } catch (e) {} }
                return _set(k, v);                     // localStorage guarda "el último usado" para pestañas nuevas
            }
        });
        Object.defineProperty(ls, 'removeItem', {
            configurable: true,
            value: function (k) {
                if (esNuestra(k)) { try { ss.removeItem(PREFIJO + k); } catch (e) {} }
                return _del(k);
            }
        });
    } catch (e) { return; }   // navegador que no deja redefinir: se queda como antes

    /* Red de seguridad: si el negocio de ESTA pestaña ya no existe o quedó
       vacío, no inventamos nada — page-guard se encarga de mandar al hub. */
    window.etaaxNegocioTab = function () {
        try { return ss.getItem(PREFIJO + 'etaax_negocio_activo') || ''; } catch (e) { return ''; }
    };
})();

/* ════════════════════════════════════════════════════════════════════════════
   RED DE SEGURIDAD PARA LA CACHÉ

   Los .js se sirven con `stale-while-revalidate`: el navegador usa lo que tiene
   —al instante, sin preguntar— y revalida por detrás. Eso quita ~4 s de viajes
   al servidor en cada navegación, medidos en producción.

   El precio es una rendija: justo después de un despliegue, UNA carga puede
   juntar el HTML nuevo con un .js de la visita anterior. El síntoma es siempre
   el mismo —una función que "no existe"— y la cura también: como esa misma
   carga ya disparó la revalidación, basta con volver a cargar.

   Así que eso hace: si en el arranque truena un ReferenceError, recarga UNA vez.
   El candado va en sessionStorage, así que no puede entrar en bucle aunque el
   error sea de otra cosa: al segundo intento se rinde y deja ver el error, que
   es lo correcto — esconder un bug de verdad detrás de recargas infinitas sería
   mucho peor que la rendija que esto tapa.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
    var MARCA = 'etaax_recarga_cache';
    var ARRANQUE = 12000;   // ms: después de esto la página ya arrancó, un error es de uso
    var desde = Date.now();

    function yaIntentado() {
        try { return sessionStorage.getItem(MARCA) === '1'; } catch (e) { return true; }
    }
    function marcar() {
        try { sessionStorage.setItem(MARCA, '1'); } catch (e) {}
    }
    /* Una carga que llegó completa y sin tronar limpia la marca: si no, un solo
       susto dejaría la pestaña sin red de seguridad para el resto del día. */
    window.addEventListener('load', function () {
        setTimeout(function () { try { sessionStorage.removeItem(MARCA); } catch (e) {} }, ARRANQUE);
    });

    window.addEventListener('error', function (ev) {
        var msg = String((ev && ev.message) || '');
        // Solo el síntoma de la mezcla de versiones, y solo mientras arranca.
        if (!/is not defined|no está definido|n'est pas défini/i.test(msg)) return;
        if (Date.now() - desde > ARRANQUE) return;
        if (yaIntentado()) return;   // ya se probó: es un bug de verdad, que se vea
        marcar();
        console.warn('[etaax] arranque roto (' + msg + '). Recargando una vez por si la caché venía mezclada.');
        location.reload();
    });
})();
