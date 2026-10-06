# ETAAX · App móvil de registro (barra / cocina)

Lo que hoy se hace escaneando el QR en el navegador, pero **instalado en el
teléfono**: ícono en la pantalla de inicio, sin barra de navegador y abriendo al
instante aunque la señal esté mala.

No es una app nativa. Es una **PWA**: el mismo stack del resto de ETAAX —HTML,
CSS y JS a pelo, sin build ni dependencias— servida desde el mismo Netlify. No
hay tiendas, no hay revisión de Apple, no hay segunda base de código que
mantener; se publica igual que cualquier otro cambio, con un push.

---

## Qué hace (v1)

Los cuatro flujos del QR, rehechos para una mano y un pulgar:

| | |
|---|---|
| 📦 **Entrada** | Llegó mercancía: compra, bonificación, consignación o préstamo pagado |
| 🍷 **Merma** | Se rompió, se derramó o se desperdició un insumo o un producto del menú |
| 🎁 **Cortesía / préstamo** | Salió algo sin ser venta |
| 📋 **Conteo** | Contar botellas o pesar antes del inventario |

Y **Lo registrado**: lo capturado desde el último cierre de inventario.

Cada flujo arma un **lote** (hasta 15 renglones y 10 fotos) y lo manda de un
golpe. Lo que falle se queda en la lista para reintentar — nunca se pierde en
silencio.

### Qué NO hace todavía

Decirlo importa tanto como lo anterior:

- **No captura sin señal.** Si no hay internet, la app abre (eso sí lo resuelve
  la instalación) pero el registro no se manda. Capturar sin señal y subirlo
  solo al volver es el siguiente paso, y es el que más trabajo lleva.
- **No guarda la sesión más allá del día.** Se entra con el NIP cada vez que se
  abre la app.
- **No deja corregir lo ya registrado.** Para eso sigue el encargado, desde
  Inventarios.

---

## Cómo se instala

En **Inventarios → 📱 QR de entradas** hay un enlace a `instalar.html`. Ese es el
que se le manda al equipo por WhatsApp: la página detecta si el teléfono es
iPhone o Android y enseña los pasos de ese, con las credenciales del negocio ya
dentro para que al terminar la app abra lista.

- **Android:** Chrome ofrece **«Instalar»** —un aviso abajo o en el menú ⋮—. Es
  una instalación de verdad: la app queda en el cajón de aplicaciones.
- **iPhone / iPad:** desde **Safari**, botón de compartir ⬆️ → **«Agregar a
  inicio»**. Queda con su ícono y a pantalla completa, igual que cualquier otra.

Sigue pidiendo el **NIP de 5 dígitos** en cada apertura. Eso es a propósito: el
teléfono de la barra lo usan varias personas y el NIP es lo que dice quién
registró qué.

### Cuándo deja de ofrecerse

En cuanto la app sabe que ya está instalada. Saberlo no es directo —
`display-mode: standalone` contesta cómo se está viendo AHORA, no si existe una
copia instalada— así que hay tres caminos:

| | |
|---|---|
| Se abrió desde el ícono | Se deja una marca y el navegador del mismo teléfono ya no la ofrece |
| Chrome en Android | Se le pregunta directo (`getInstalledRelatedApps`); por eso el manifest se declara a sí mismo como app relacionada |
| «Ya la tengo instalada» | La persona lo dice. Es la única vía que funciona en todos lados |

**En iPhone hace falta la tercera.** La app agregada a la pantalla de inicio
tiene su **propio almacenamiento**, separado del de Safari: la marca que se
escribe adentro no la ve el navegador, y Safari no tiene nada parecido a
`getInstalledRelatedApps`. Cuando el sistema no puede saber algo, preguntarlo
una vez es mejor que insistir para siempre.

### Por qué en iPhone no se baja de una tienda

**Apple no permite instalar ninguna app fuera del App Store.** No hay archivo que
descargar ni instalador: «Agregar a inicio» es la única vía, y la ejecuta la
persona — no existe forma de dispararla desde el código, como sí la hay en
Android. Por eso en iPhone la app enseña los pasos en vez de un botón que diga
«Instalar»: un botón que no hace lo que dice es peor que no tenerlo.

Subirla al App Store es posible pero es otro proyecto: cuenta de desarrollador
de pago anual, empaquetarla como app nativa y pasar la revisión de Apple, que
rechaza de entrada las que son solo un sitio web envuelto (su guía 4.2, «Minimum
Functionality»). Tendría sentido el día que haya una razón nativa de verdad
—escáner de código de barras, notificaciones, captura sin señal—, no para
conseguir el ícono: eso ya se tiene.

---

## Cómo está armado

```
app-movil/
  index.html           la cáscara: una sola página, pantallas que se muestran y esconden
  instalar.html        la guía que se manda por WhatsApp, por plataforma
  app.css              estilos. Oscuro por default (la barra es oscura), claro a un toque
  app.js               toda la lógica
  sw.js                service worker: guarda la cáscara para que abra sin esperar
  manifest.webmanifest lo que hace que se pueda instalar
  icons/               el ícono de la pantalla de inicio
```

**No duplica reglas de negocio.** Llama exactamente a las mismas funciones del
servidor que `entrada.html` —`entrada_validar_nip`, `portal_perfil`,
`entrada_insumos`, `entrada_recetas`, `entrada_registrar`,
`inventario_conteo_registrar`, `entrada_historial`— y usa el mismo vocabulario de
áreas (`/staff-area.js`). Si mañana cambia quién ve qué, cambia en un lugar y las
dos pantallas se enteran.

### El service worker, y por qué guarda tan poco

Guarda **la cáscara** (HTML, CSS, JS, ícono) y nada más. Los datos —el catálogo
de insumos, el historial— se piden siempre a la red.

Es deliberado: un inventario viejo servido desde la caché es peor que una
pantalla que dice «sin señal». Alguien contaría contra existencias de hace tres
días sin enterarse.

**Al tocar `sw.js` hay que subirle la versión** (`CACHE`, arriba del archivo). El
navegador compara el archivo byte a byte; si no cambia, no instala nada. Y
`netlify.toml` lo sirve con `no-cache` a propósito: el resto de los `.js` del
proyecto van con `stale-while-revalidate` de una semana, y un service worker
servido viejo deja la app congelada hasta que a alguien se le ocurra borrar los
datos del sitio.

---

## Probarla en local

```bash
python3 -m http.server 8000
# luego abrir con los mismos parámetros del QR:
# http://localhost:8000/app-movil/?n=<negocioId>&t=<token>&s=<sucursalId>
```

El service worker **no corre en `http://`** salvo en `localhost`, que el
navegador trata como origen seguro. Para probarlo desde un teléfono en la misma
red hace falta HTTPS; lo más rápido es probar contra producción.
