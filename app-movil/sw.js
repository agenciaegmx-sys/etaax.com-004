/* ══════════════════════════════════════════════════════════════════════════
   ETAAX · App móvil — service worker

   GUARDA LA CÁSCARA Y NADA MÁS: el HTML, el CSS, el JS y el ícono. Con eso la
   app abre al instante aunque la señal esté mala, que es la mitad del problema
   en una cocina con el wifi al fondo del pasillo.

   LOS DATOS NO SE GUARDAN, a propósito. Un catálogo o un historial servidos
   desde la caché serían un inventario viejo presentado como actual: alguien
   contaría contra existencias de hace tres días sin enterarse. Una pantalla que
   dice «sin señal» es mucho mejor que un número que parece bueno y no lo es.

   AL TOCAR ESTE ARCHIVO HAY QUE SUBIRLE LA VERSIÓN. El navegador compara el
   service worker byte a byte; si no cambia, no instala nada y la app se queda
   con la cáscara vieja. Y netlify.toml lo sirve con `no-cache` por lo mismo: el
   resto de los .js del proyecto van con stale-while-revalidate de una semana, y
   un service worker servido viejo deja la app congelada hasta que a alguien se
   le ocurra borrar los datos del sitio.
   ══════════════════════════════════════════════════════════════════════════ */

var CACHE = 'etaax-movil-v3';

/* Las rutas de ARRIBA (../) son del proyecto, no de esta carpeta: la app
   reutiliza el cliente de Supabase y el vocabulario de áreas en vez de tener
   copias propias que se separen. */
var CASCARA = [
    './',
    './index.html',
    './app.css',
    './app.js',
    './cuenta.js',
    './manifest.webmanifest',
    './icons/icono-192.png',
    '../supabase-config.js',
    /* CON SU VERSIÓN, igual que en el HTML: sin ella el service worker guarda
       el archivo viejo y la app instalada se queda con el vocabulario de áreas
       anterior aunque el sitio ya tenga el nuevo. */
    '../staff-area.js?v=2'
];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(CACHE).then(function (c) {
            /* addAll falla entero si UN archivo falla, y entonces no se guarda
               nada. Uno por uno: lo que sí se pueda guardar, se guarda. */
            return Promise.all(CASCARA.map(function (u) {
                return c.add(u).catch(function () { /* ese archivo se pedirá a la red */ });
            }));
        }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (ks) {
            return Promise.all(ks.map(function (k) {
                return (k !== CACHE && k.indexOf('etaax-movil-') === 0) ? caches.delete(k) : null;
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;                 // registrar algo SIEMPRE va a la red

    var url;
    try { url = new URL(req.url); } catch (err) { return; }

    /* Supabase —datos, RPC, fotos— nunca pasa por aquí. Ver el comentario de
       arriba: datos viejos disfrazados de actuales. */
    if (url.origin !== self.location.origin) return;

    /* La CÁSCARA: primero lo guardado, y se revalida por detrás. Así la app abre
       al instante y la siguiente apertura ya trae lo nuevo. */
    e.respondWith(
        caches.match(req).then(function (hit) {
            var red = fetch(req).then(function (res) {
                if (res && res.ok) {
                    var copia = res.clone();
                    caches.open(CACHE).then(function (c) { c.put(req, copia); });
                }
                return res;
            }).catch(function () {
                /* Sin red y sin copia: para una navegación se devuelve la app,
                   que al menos abre y explica que no hay señal. Devolver un
                   error del navegador no le dice nada a nadie. */
                return hit || caches.match('./index.html');
            });
            return hit || red;
        })
    );
});
