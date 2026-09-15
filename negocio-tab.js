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

/* ════════════════════════════════════════════════════════════════════════════
   CONFIRMAR ANTES DE CERRAR SESIÓN — una sola redacción para toda la app

   VIVE AQUÍ POR UNA RAZÓN: este es el PRIMER script de toda página de la app.
   Estuvo en modal-dock.js, que se carga al final, y bastó una copia guardada de
   ese archivo para que el diálogo no existiera todavía y saliera el confirm del
   navegador — el alert feo que este diálogo venía a quitar. Definido aquí, está
   antes de que exista un botón que se pueda tocar.
   (Tampoco cabe en security.js: admin.html no lo carga, y arrastrarlo entero le
   metería de paso el auto-logout por inactividad y el reemplazo de window.alert.)

   El botón vive en la barra de contexto, pegado a los de navegar, y cerraba la
   sesión al primer toque. En una tablet, con el dedo, eso pasa solo: te saca de
   todo y hay que volver a entrar. El hub sí preguntaba; las 26 páginas de
   módulo, no. Ahora preguntan todas, con el mismo diálogo.

   OJO: el cierre por INACTIVIDAD (arriba) NO pasa por aquí a propósito — nadie
   está ahí para contestar, y un diálogo esperando para siempre dejaría la sesión
   abierta justo cuando se quería cerrar.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
    if (window.etaaxConfirmSalir) return;
    window.etaaxConfirmSalir = function () {
        return new Promise(function (resolve) {
            var old = document.getElementById('salirOverlay');
            if (old) old.remove();
            var ov = document.createElement('div');
            ov.id = 'salirOverlay';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99800;' +
                'display:flex;align-items:center;justify-content:center;padding:20px';
            ov.innerHTML =
                '<div style="background:var(--surface,#141414);border:1px solid var(--border,#2a2a2a);' +
                     'border-radius:16px;padding:26px 26px 22px;max-width:360px;width:100%;text-align:center;' +
                     'box-shadow:0 24px 64px rgba(0,0,0,.6)">' +
                    '<div style="font-size:34px;margin-bottom:10px">👋</div>' +
                    '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:22px;letter-spacing:1.5px;' +
                         'color:var(--text,#eee);margin-bottom:6px">¿Cerrar sesión?</div>' +
                    '<div style="font-size:13px;color:var(--text-dim,#888);margin-bottom:20px">' +
                        'Tu información queda guardada. Al volver, inicia sesión otra vez.</div>' +
                    '<div style="display:flex;gap:10px;justify-content:center">' +
                        '<button id="salirCancelBtn" style="flex:1;background:var(--surface2,#1d1d1d);' +
                            'border:1px solid var(--border,#2a2a2a);color:var(--text,#eee);border-radius:10px;' +
                            'padding:11px 0;font-size:13px;cursor:pointer">Seguir aquí</button>' +
                        '<button id="salirOkBtn" style="flex:1;background:rgba(224,90,58,.12);' +
                            'border:1px solid rgba(224,90,58,.55);color:#ff8a6a;border-radius:10px;' +
                            'padding:11px 0;font-size:13px;cursor:pointer;font-weight:600">Cerrar sesión</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(ov);
            function done(v) { ov.remove(); resolve(v); }
            document.getElementById('salirCancelBtn').onclick = function () { done(false); };
            document.getElementById('salirOkBtn').onclick = function () { done(true); };
            /* Tocar fuera y Escape CANCELAN. El destructivo nunca es el default:
               por un dedazo se sale, por un dedazo no se debe salir. */
            ov.addEventListener('click', function (e) { if (e.target === ov) done(false); });
            document.addEventListener('keydown', function esc(e) {
                if (e.key === 'Escape') { document.removeEventListener('keydown', esc); done(false); }
            });
            var b = document.getElementById('salirCancelBtn'); if (b) b.focus();
        });
    };
})();
