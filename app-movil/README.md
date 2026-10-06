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

1. Escanear el QR de la sucursal, como siempre (Inventarios → 📱 QR de
   entradas). El QR lleva el negocio, el token y la sucursal.
2. En el teléfono, el menú del navegador → **«Agregar a pantalla de inicio»** /
   «Instalar». En iPhone es el botón de compartir ⬆️; en Android suele salir
   solo un aviso abajo.
3. Listo: queda un ícono. Al abrirlo ya no hay que escanear nada — el negocio,
   el token y la sucursal viajan en el acceso instalado.

Sigue pidiendo el **NIP de 5 dígitos** en cada apertura. Eso es a propósito: el
teléfono de la barra lo usan varias personas y el NIP es lo que dice quién
registró qué.

---

## Cómo está armado

```
app-movil/
  index.html           la cáscara: una sola página, pantallas que se muestran y esconden
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
