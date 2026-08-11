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
