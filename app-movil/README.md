# ETAAX · App móvil de registro (barra / cocina)

Lo que hoy se hace escaneando el QR en el navegador, pero **instalado en el
teléfono**: ícono en la pantalla de inicio, sin barra de navegador y abriendo al
instante aunque la señal esté mala.

No es una app nativa. Es una **PWA**: el mismo stack del resto de ETAAX —HTML,
CSS y JS a pelo, sin build ni dependencias— servida desde el mismo Netlify. No
hay tiendas, no hay revisión de Apple, no hay segunda base de código que
mantener; se publica igual que cualquier otro cambio, con un push.

---

## Las dos puertas

Lo primero es el acceso (Edwin, 25-nov): la portada son dos puertas, y cada una
lleva a lo suyo **ordenado por módulo**, con los mismos nombres ·ax que se ven
en la computadora.

| Puerta | Quién | Qué alcanza |
|---|---|---|
| **Entrar con mi clave** (NIP de 5 dígitos) | Barra, cocina, piso | **Vistas**: lo que se consulta y registra en el turno |
| **Entrar con usuario y contraseña** | Dueño o gerente | **Usar los módulos**: gastos, cortes, insumos, recetas, resultados |

Con la clave, el menú va así:

| Módulo | Qué trae |
|---|---|
| **Cost·ax** | Entrada de insumos · Merma · Cortesía o préstamo · Contar existencias · Recetario (solo barra y cocina) · Lo registrado |
| **Equip·ax** | Mis horarios · Mis check lists · Evaluaciones |
| **Learn·ax** | Guías de uso |

**Lo que la sucursal no contrató no se ve** (la regla de la v89): la app le
pregunta al servidor qué apps tiene la sucursal de quien entra (`portal_apps`,
v91). Sin la v91 corrida, o sin red, se ve todo, como antes. Con la cuenta, los
módulos se filtran con el plan del negocio (`negocio_plan`).

**Mis horarios** enseña solo los turnos de quien entró, de esta semana y la que
sigue (`portal_horarios`, v91), con la fecha, el total de horas y la sucursal si
lo prestaron. **Evaluaciones** lista las abiertas del negocio, sin las de
reclutamiento (`portal_evaluaciones`, v91), y abre su enlace de siempre.

**La de arriba funciona igual que escanear el QR** — mismo token, mismo NIP,
misma seguridad. Es a propósito: quien trabaja en barra no tiene cuenta, tiene
NIP. Pedirle correo y contraseña sería inventarle una credencial que no existe y
obligaría a crear usuarios para gente que solo registra una merma.

### El candado del teléfono

Con cuenta, la sesión **se queda guardada** —cerrar la app y escribir la
contraseña cada vez la volvería inservible— y encima va un candado: **huella o
Face ID** donde el teléfono lo ofrezca, **PIN de 4 dígitos** si no.

La huella se hace con **WebAuthn**, el mismo mecanismo de los passkeys; no hay
una API de huella en la web. Funciona en iPhone (Safari 16+) y en Android,
también con la app instalada. El **patrón de puntos no se ofrece**: es un gesto
de Android nativo que en web habría que dibujar a mano y no protege más que un
PIN.

Ese PIN **no es el NIP del colaborador**. El NIP identifica a una persona ante el
negocio y lo pone el encargado; este solo abre la app en ese teléfono y lo elige
quien la instala.

**Qué protege el candado y qué no.** Protege contra lo que de verdad pasa:
alguien levanta el teléfono desbloqueado de la barra y lo abre. **No** protege
contra quien se lleva el aparato y lo desarma con herramientas — la sesión vive
en el almacenamiento del navegador y ahí seguiría. Para eso está cerrar sesión y,
si el teléfono se pierde, cambiar la contraseña desde el sistema.

## Qué hace (v1)

Los cuatro flujos del QR (en Cost·ax), rehechos para una mano y un pulgar:

| | |
|---|---|
| 📦 **Entrada** | Llegó mercancía: compra, bonificación, consignación o préstamo pagado |
| 🍷 **Merma** | Se rompió, se derramó o se desperdició un insumo o un producto del menú |
| 🎁 **Cortesía / préstamo** | Salió algo sin ser venta |
| 📋 **Conteo** | Contar botellas o pesar antes del inventario |

Y **Lo registrado**: lo capturado desde el último cierre de inventario.

### El portal del colaborador

Lo de arriba es **registrar**: sale dinero o entra producto y queda escrito. Esto
es **consultar y cumplir** — qué hay que hacer en el turno y cómo se hace. Van en
la misma app para que haya UN ícono en el teléfono, no dos, pero separados en el
menú: con todo revuelto en una lista de ocho, nadie encuentra nada a medio turno.

| | |
|---|---|
| 📋 **Mis check lists** | Los de su área y su sucursal. Cada tarea cicla ✅ cumplida → ❌ no se pudo → pendiente |
| 📖 **Recetario** | La ficha operativa, **sin un solo costo**. Solo para barra y cocina |
| 📚 **Guías de uso** | Los manuales de ETAAX |

**Tres estados en las tareas, no dos.** «No se pudo» y «no lo he hecho» no son lo
mismo —una es un problema que reportar, la otra es trabajo sin terminar— y
revolverlas hace inútil el reporte. Por eso la barra de arriba mide **lo
revisado** y el porcentaje mide **lo cumplido**: un turno donde nada se pudo
hacer marca 4/4 revisadas y 0% cumplido, que es exactamente lo que pasó.

Se puede mandar incompleto: un turno que se corta a la mitad es un dato, no un
error, y lo pendiente queda en el reporte.

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

**Una sola dirección para todos: `etaax.com/app`.** No hay un enlace por
negocio, y el token del QR ya **no viaja en la dirección** — salía por WhatsApp
con el mismo secreto que está impreso en la barra.

Las credenciales salen del **login**, como en cualquier app:

| Quién | Qué hace |
|---|---|
| Dueño o gerente | Entra con su cuenta. La app averigua sola de qué negocio es y consigue el token |
| Barra y cocina | El encargado entra una vez con su cuenta en ese teléfono —o escanean el QR de su sucursal— y de ahí en adelante entran solo con su NIP |

**La sucursal la pone el NIP**, no el teléfono ni el enlace. Por eso el aparato
guarda el negocio pero **no** la sucursal: si guardara la del encargado, todo lo
que registrara el equipo quedaría sellado con la de él.

## Cómo se agrega a la pantalla

**El QR y el enlace viven en el hub** (25-nov): menú de la cuenta (arriba a la
derecha) → **«Versión móvil · QR y enlace»** (`/etaax-acceso-movil.js`, permiso
«Generar el QR de entradas»). Ahí se imprime o se descarga el QR para pegarlo en
la barra y se copia el enlace para mandarlo por WhatsApp. Es el mismo QR de
entradas de antes —negocio + token + sucursal—, que ya no vive en Inventarios.
**Los QR ya impresos siguen sirviendo:** `entrada.html` los manda a
`/app-movil/` con las mismas credenciales (`&web=1` deja la página vieja). La
landing (`index.html`) trae «Abrir versión móvil».

**En iPhone, el ícono de inicio no ve lo de Safari**: si al abrirlo dice que el
teléfono no está ligado, alguien con usuario y contraseña (el encargado o un
colaborador con acceso al sistema) entra una vez en ese teléfono y queda ligado.

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
  app.js               la puerta del NIP: los cuatro flujos y el portal
  cuenta.js            la otra puerta: login, candado y biometría
  sw.js                service worker: guarda la cáscara para que abra sin esperar
  manifest.webmanifest lo que hace que se pueda instalar
  icons/               el ícono de la pantalla de inicio
```

**No duplica reglas de negocio.** Llama exactamente a las mismas funciones del
servidor que `entrada.html` —`entrada_validar_nip`, `portal_perfil`,
`entrada_insumos`, `entrada_recetas`, `entrada_registrar`,
`inventario_conteo_registrar`, `entrada_historial`—, más las tres de la v91
(`portal_apps`, `portal_horarios`, `portal_evaluaciones`, con el mismo candado de
token + NIP + guardia de intentos), y usa el mismo vocabulario de áreas
(`/staff-area.js`) y los íconos de la marca (`/etaax-iconos.js`). Si mañana cambia quién ve qué, cambia en un lugar y las
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
