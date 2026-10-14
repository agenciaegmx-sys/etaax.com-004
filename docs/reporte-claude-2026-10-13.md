# Lo que hizo Claude mientras Codex estaba en pausa

**Fecha:** 13-oct-2026 · **Checkpoint:** `e3e9d6e` · **Sin commit y sin push**
**Verificación al cerrar:** candado **4419** · almacén **84** · navegador **48
casos** · los **dos revisores de Codex en verde** (el de portadas ya no falla).

Para Codex: toqué tres archivos tuyos —`etaax-modulos-ui.css`, `hub-paleta.css`
y 16 HTML por sus etiquetas de versión—. Todo está abajo, con el motivo.

---

## 1. El pendiente que dejaste: Staff a 320 px

**Resuelto.** `administrativo/staff-hub.html` abría la página a 349 px.

El diagnóstico tenía una capa falsa que conviene contar: a 320 px el revisor
emula móvil, y en emulación móvil **Chrome ensancha la ventana al contenido**.
Así que `innerWidth` ya valía 349 y *todos* los elementos medían 349: la lista
de culpables salía con 31 nodos y ninguno destacaba. Forzando 320 **sin**
emulación móvil, el contenido sobresale de verdad y aparecen los dos culpables
reales. Si alguien vuelve a medir desbordes, ese es el truco.

**Causa 1 — el envoltorio.** Tu regla de `etaax-modulos-ui.css` libera al
envoltorio directo del contenido:

```css
body.etx-modulos-ui .main-content>.wrap {width:100%;min-width:0;max-width:100%;}
```

Pero los módulos no lo llaman `wrap`: Staff usa **`.cf-wrap`** y Diario
**`.dx-wrap`**. Nunca entraron, así que el envoltorio se quedaba en su ancho
mínimo de contenido (248.5 px dentro de 193 disponibles) y empujaba la página.
Añadido:

```css
body.etx-modulos-ui .main-content>:is(.cf-wrap,.dx-wrap) {width:100%;min-width:0;}
```

**No** les puse `max-width:100%` a propósito: `.cf-wrap` lleva su propio
`max-width:1080px` y pisarlo le quitaría la columna centrada en pantalla
grande. Con `width:100%` basta, porque 100% del contenedor nunca supera su tope.

Eso bajó 349 → **325**.

**Causa 2 — la píldora de sección.** `.cf-section-tag` va en `white-space:nowrap`
y «Estructura y desarrollo» mide 201 px: no cabe y empuja los 5 px que faltaban.
En el bloque de `max-width:600px` ahora se deja envolver, con el mismo recurso
que ya usabas en `.ctx-btn`:

```css
body.etx-modulos-ui .cf-section-tag {white-space:normal;letter-spacing:1.6px;line-height:1.5;}
body.etx-modulos-ui .cf-section-hdr {flex-wrap:wrap;}
```

Se respetaron tus dos condiciones: **no** toqué la aserción de ancho y **no**
usé `overflow-x:hidden`. El rótulo sigue ahí (es el que dice de qué trata la
sección), solo se parte en dos renglones. Las 7 tarjetas y sus 7 SVG intactos.

```
320 admin-portada / fin-portada / aprende-portada / staff → scroll 320, 0 errores
```

---

## 2. Caché mezclada: dos páginas se habían quedado atrás

Esto lo encontré comparando las etiquetas `?v=` de todo el sitio, y es el tipo
de bug que una revisión visual no ve, porque **solo le pasa a quien ya había
entrado antes**: Netlify revalida en segundo plano, el HTML llega nuevo y el
script sale de la caché anterior.

| Archivo | Estaba | Quedó |
|---|---|---|
| `etaax-header.js` en `mi-cuenta.html` y `plan-facturacion.html` | `?v=cuenta-1` | `?v=paleta-1` |
| `etaax-iconos.js` en esas dos | **sin versión** | `?v=modulos-1` |
| `theme.js` en 16 páginas, entre ellas hub, mi-cuenta y plan-facturacion | **sin versión** | `?v=modulos-ui-1` |
| `datos-pago.js` en `alta.html` · `negocio-tipos.js` en `hub.html` | sin versión | la del resto |

El de `theme.js` era el peligroso: las tres páginas que piden header **sin**
versionar `theme.js` son justo donde una copia vieja vuelve a dibujar el botón
flotante del tema encima del de la barra — lo que tu bump pretendía evitar.

**Candado nuevo: suite BE18 «la caché no se mezcla».** Recorre todos los HTML y
exige **una sola versión por archivo compartido**, nombrando la página culpable
cuando no lo está. Comprobado con una mutación: desalineé `configuracion.html`
y el candado la señaló por su nombre.

---

## 3. Auditoría de las pruebas que se dieron de baja

Durante el rediseño salieron **cinco** pruebas del candado. Las revisé una por
una, porque una prueba que se va es por donde se cuela un bug:

| Baja | Veredicto |
|---|---|
| «catálogos globales tiene sus 7 tarjetas» | legítima: son 6 por decisión del dueño → reemplazada por «ofrece sus 6 accesos» |
| «la tarjeta de Sub-recetas pide el filtro» | legítima: un solo acceso → reemplazada |
| «las tarjetas globales son neutras en reposo» | legítima: ahora llevan contorno de marca → reemplazada |
| «lo que se pulsa habla en verde» | legítima: cambió la paleta → reemplazada por el acento de acciones |
| «la barra de sesión se distingue con su contorno verde» | legítima: se renombró a «barra de identidad» y mide `--hub-brand` |

**Cinco bajas, cinco reemplazos.** Y lo que de verdad importaba —que el color
del negocio no tiña los botones— sigue vigilado en cuatro sitios distintos.
Nada se perdió.

**Pero sí encontré una prueba que vigilaba código muerto:** `.btn-logout` ya no
lo usa ningún elemento del hub (admin usa `btn-logout-adm`, que es otra clase),
y una prueba seguía midiendo su color. Eso es peor que no tener prueba, porque
parece que hay una. Quité la regla huérfana de `hub.html` y **mudé la intención**
—salir se escribe en claro, no en el gris de lo apagado— al menú de la cuenta,
que es donde ahora vive la salida. Comprobado con mutación: al apagar el color
de `.etx-hd-op`, el candado lo caza.

---

## 4. Lo mío de este bloque: el aviso de novedades

Es lo que Codex marcó como ajeno al rediseño y pidió preservar. Está en
`novedades.js`, que ahora tiene **dos capas y nunca salen juntas**: el avisito
de siempre («hubo actualizaciones hace tres días», automático en cada
publicación) y una **presentación** con el recuadro grande *«Hicimos una
actualización importante → Ve las novedades»*, una novedad por pantalla con su
captura. Si hay presentación pendiente, el avisito se calla.

Se marca vista al llegar al final o al decir «Listo»; cerrar a la mitad no
cuenta, pero tampoco insiste otra vez en la misma pestaña. Se guarda **por
usuario**, no por navegador (la tablet de la barra la usan cuatro personas).
Queda permanente en el menú de la cuenta, con punto verde cuando hay algo sin
leer. Suite **BE17**, 23 pruebas que corren el archivo, y batería de mutaciones
7/8 (la octava era código equivalente, no un bug).

**Alineado a tu paleta:** el recuadro no escribe su acento, lo enruta por
`--etx-nov-*` con el verde del sistema como respaldo, y `hub-paleta.css` lo
reapunta —marca en cian, acción en terracota— igual que hiciste con
`#etaaxNovedades`. En los módulos sigue en verde, que es lo correcto.

**Falta de Edwin:** las 7 capturas en `novedades/`, con los nombres de
`novedades/LEEME.md`. Mientras no estén, cada hueco dice «captura en camino»
del mismo tamaño que tendrá la foto. Un candado comprueba que **cada nombre que
espera el código esté pedido en el LEEME**, que es por donde se desalinea.

---

## 5. Lo que queda abierto

1. **Tu punto 3:** las páginas con geometrías particulares que no se recorrieron
   una por una —canvas/organigrama, barras fijas de inventarios, encabezados de
   tablas e impresión—. 29 inclusiones no son 29 revisiones.
2. **`probar-cuenta-header.cjs` y los dos revisores no están en el pre-push**
   (necesitan Chrome). Son los únicos que prueban las 19 rutas y los anchos.
   Mi recomendación: dejarlos fuera del hook, pero correrlos a mano como
   requisito de **este** push, y que quede escrito.
3. **«Atenuado sin href» no bloquea nada**: la URL se puede teclear. Lo que
   protege siguen siendo los guardas de página y las reglas del servidor. Este
   rediseño no cerró ningún hallazgo de autorización; **R03 sigue abierto**.
4. El icono de «Novedades» en el menú va con `catalogos` de prestado. Con un
   `novedades.svg` en `iconos/header/` se cambia en los dos sitios.

**Nada commiteado, nada pusheado.** Se conservó todo el trabajo del repo; no
borré ni restauré archivos ajenos.

---

# Segunda tanda · pulido del espacio de módulos

Cuatro detalles que pidió Edwin sobre el rediseño ya integrado. Al cerrar:
candado **4431** · almacén **84** · navegador **48 casos** · **los dos revisores
en verde**.

## 1. La barra lateral, pegada al header

Empezaba debajo del subheader, a casi un tercio de la pantalla. Ahora sube a la
altura del subheader, y el subheader le cede su carril: su tarjeta ya no se
centra en la ventana sino en el espacio de trabajo, con el mismo
`--etx-sidebar-space` que ya reserva el contenido —268, 112 plegada o 0 sin
menú—, así que las dos piezas se mueven juntas al contraer la barra. Solo de
901 px para arriba; abajo la barra sigue siendo un panel que se abre encima.

**Y el bug que salió de ahí, que Edwin vio antes que yo:** la franja del
subheader ocupa todo el ancho y es opaca aunque su tarjeta esté recortada, así
que al subir la barra le tapaba la cabeza —se veían los iconos de abajo y nada
del módulo—. La barra va ahora en `z-index:200`, por delante del subheader (190)
y por detrás del header (900).

**Comprobación nueva en el revisor, que es la que faltaba:** medir dónde está la
barra no basta, porque puede estar en su sitio y aun así no verse. Ahora se
pregunta `elementFromPoint` en su cabecera y se exige que conteste la barra.
Verificado con mutación: al devolverle el `z-index:100` el revisor falla con
«la barra lateral quedó tapada por el subheader».

## 2. El título, donde se lee

Había un **doble empujón**: `.main-content` ya baja el contenido con su
`margin-top`, y encima `.cf-wrap` sumaba otro `padding-top` del alto del
subheader. El título caía a media pantalla, con un hueco del alto de la barra —y
un hueco así no se lee como aire, se lee como que algo no cargó.

Además cada hero traía su propia salida (52 px en una portada, 18 en Diario), así
que el título arrancaba a distinta altura según el módulo. Ahora el aire lo pone
el envoltorio y los cuatro empiezan igual.

## 3. Mayúsculas y bicolor, en los cuatro módulos

- **Portadas** (`.cf-hero-title`, `.dx-hero-title`): mayúsculas, nombre en crema
  y final en terracota. Venían en Bebas a 58 px aquí y a 44 allá, con el acento
  en morado en un módulo y verde en otro.
- **Herramientas** (`.brand-title`, 21 páginas): iban **enteras** en el color de
  acento, y a ese tamaño un color que lo cubre todo deja de distinguir. Ahora el
  nombre en crema y el final en terracota.
- El corte lo reparte `bicolorTitulo()` en `etaax-modulos-ui.js`, porque son 21
  archivos y el marcado no trae dónde partir. Con una sola palabra no se parte
  («Escandallos» se queda en crema) y el texto se rearma desde `textContent`, así
  que no entra marcado de la página al título.
- **Ojo con la especificidad:** la regla de Recetas lleva un id
  (`#moduloLanding .cf-hero-title`). El selector compartido lo nombra a
  propósito; sin eso, ese título se quedaría en verde mientras los otros tres van
  en terracota. Hay una prueba solo para eso.

## 4. «Cambiar módulo» entra al módulo

Antes devolvía al hub: para pasar de Recetas a Financiero había que salir del
espacio de trabajo y volver a entrar — dos pantallas para un movimiento lateral.
Ahora cada módulo declara su `portada` y el botón va directo. El hub queda
enterado igual (`etaax_hub_modulo`), así que si vuelves a él te recibe donde
estabas. El texto del botón dice «Entrar al módulo», no «Ver herramientas».

**Suite BE19:** exige que las cuatro rutas apunten a un archivo que **existe en
el repo** —el revisor de navegador solo recorre una de las cuatro, y las otras
tres se romperían en silencio con una letra de más—, que ninguna vuelva al hub,
y que el hub siga enterándose.

## Expectativas de revisor que cambié, y por qué

Las tres salen de una decisión del dueño, no de un test que estorbaba:

| Dónde | Antes | Ahora |
|---|---|---|
| `revisar-modulos-ui.cjs` | `nav.top >= ctx.bottom` | de 901 px arriba: `nav.top >= header.bottom`, `nav.right <= tarjeta.left` y **nadie la tapa**; abajo, la regla de antes |
| `revisar-modulos-ui.cjs` | cambiar módulo aterriza en el dock del hub | aterriza en `/financiero/index.html` conservando negocio y sucursal |
| `probar-cuenta-header.cjs` (×2) | lo mismo para financiero y consultoría | sus portadas, y `etaax_hub_modulo` guardado |

Ninguna se relajó: las tres cambiaron de objetivo y **todas ganaron una
comprobación**. La del tapado no existía.

---

# Tercera tanda · hub de módulos, fondo y contornos

Candado **4436** · almacén **84** · navegador **48 casos** · los **dos revisores
en verde**.

## 1. El fondo viejo de la portada de Recetas

Era la última pantalla con la cuadrícula azul y el degradado. La razón de que
sobreviviera al cambio a fondo sólido: **estaba escrita en el elemento**
(`style="background-image:…"` en `#moduloLanding`), y eso gana a cualquier hoja
de estilos. El degradado era además un `<div>` suelto.

De paso se igualó lo demás de esa portada: se definió con un **id**, así que sus
reglas vencían a las compartidas y se había quedado con la tipografía condensada,
el hover azul y las insignias verdes mientras los otros tres módulos ya iban en
terracota.

## 2. Contorno de las sucursales, en cian

`.suc-caja` compartía la variable del terracota con Financiero global. Se
separaron: Financiero conserva el terracota y las sucursales pasan al cian de
marca. Tenerlas juntas haría que al cambiar una se moviera la otra sin querer.

## 3. El hub de módulos

- **El rótulo ya no repite el título:** «EXPLORA» arriba, «TU ESPACIO DE
  TRABAJO» como título, más chico y con menos aire. El hero se comía la pantalla
  antes de lo que se viene a usar; aquí es un rótulo, no una portada.
- **«Ir al módulo»** en la tarjeta superior, a la **misma portada** a la que
  entra «Cambiar módulo» desde el subheader. Antes, desde el hub solo se podía
  entrar apuntando a una herramienta concreta.
- **Una fila por sub-módulo**, con sus funciones en cuadros numerados que se
  leen de izquierda a derecha. La rejilla anterior decía el *nombre* de cada
  herramienta, no lo que hay dentro: quien entra por primera vez no sabe qué es
  un «escandallo», pero sí entiende «costeo ingrediente por ingrediente». Son
  **19 herramientas con 3–4 funciones cada una**, escritas a mano.

**Candado nuevo:** las **dos tablas de rutas** —la del hub y la del subheader—
tienen que coincidir; si se separan, «Ir al módulo» y «Cambiar módulo» aterrizan
en sitios distintos y nadie se entera hasta que lo cuenta un cliente. Y cada
herramienta debe declarar sus funciones: una sin ellas sale como una fila muda,
que es justo lo que había antes.

## 4. El aviso de novedades nace APAGADO

Esto lo encontré al capturar el hub: el recuadro de «Hicimos una actualización
importante» **ya se disparaba**, y sus siete capturas todavía no existen. Si se
publicaba hoy, el cliente veía siete marcos vacíos anunciando una actualización
que además no está en producción.

Ahora hay un interruptor explícito en `novedades.js`:

```js
var ANUNCIAR = false;   // → true el día del push
```

Apagado, la presentación **no se ofrece sola**, pero sigue disponible desde el
menú de la cuenta para quien la busque. Dos pruebas nuevas sostienen las dos
posturas: apagado no se asoma, y apagado el menú sí la abre.

---

# Cuarta tanda · la guía visual del hub de módulos

Candado **4440** · almacén **84** · navegador **48 casos** · los dos revisores
en verde.

## Las filas ya no navegan: enseñan

Las filas de herramientas eran enlaces con su botón «Abrir». Por indicación del
dueño, ahora son **una guía visual**: cada una pasa las capturas de su
herramienta —el menú, la pantalla, el modal— con el pie que explica cada paso y
flechas para avanzar, como la presentación de novedades.

El motivo, en una línea: **el nombre de una herramienta no dice lo que hace.**
«Escandallos» no significa nada la primera vez; la foto de la pantalla, sí.

Para entrar está **«Ir al módulo»**, arriba: una sola puerta en vez de
diecinueve atajos compitiendo con ella.

## Las capturas

Van en [`/guia/`](../guia/LEEME.md) con el nombre `<clave>-<número>.png` —
`diario-1.png`, `diario-2.png`…—. Son **19 herramientas × 3 o 4 pasos**. El
orden importa: el número es el paso y su pie ya está escrito en
`hub-modulos.js`. Se pueden subir de una en una; cada archivo que aparece se ve
al recargar, sin tocar código. Mientras no estén, el marco dice «captura en
camino» y mide lo mismo que medirá con foto.

**Dos cosas que solo se ven mirando la pantalla, y que el candado no veía:**

1. `display:block` en la hoja de estilos **le gana al atributo `hidden`**, así
   que una captura que todavía no existe no se ocultaba: se quedaba el icono
   roto con su texto alternativo escrito al lado — justo lo que el marco neutro
   venía a evitar.
2. A ancho completo cada fila medía casi una pantalla, y recorrer diecinueve
   herramientas se volvía un viaje. El visor se topa a 420 px.

## Pruebas que cambiaron de objetivo (y ninguna se relajó)

Las filas eran la única forma de abrir las 19 herramientas desde el hub, así que
cuatro casos de navegador las usaban para probar las rutas.

| Caso | Antes | Ahora |
|---|---|---|
| «Herramientas de X: rutas reales y regreso» (×4) | lee los `href` y los pulsa | lee el `data-ruta` que la fila anuncia y navega a él; **sigue exigiendo** que las 19 rutas existan, que el contexto sobreviva al viaje y que el regreso funcione |
| «Escandallos: la tarjeta abre la herramienta real» | pulsa el enlace | navega a la ruta anunciada, y **comprueba además** que la ruta es exactamente `recetas/index.html?escandallos=1` |
| «El selector respeta permisos por herramienta» | lista los `href` visibles | lista las filas **no bloqueadas**, y exige que las bloqueadas digan «Sin acceso para tu rol» |
| «Una revocación frena un enlace anterior» | pulsa un enlace viejo tras revocar | ya no hay atajo viejo que pulsar: se exige que la pantalla **se vuelva a aplicar sola** al cambiar el permiso. Entrar sigue dependiendo del guarda de la página, que es lo que de verdad protege |

Y en el candado, cuatro comprobaciones nuevas: que las filas **no** vuelvan a ser
enlaces, que cada herramienta tenga su propia clave de capturas (si dos la
comparten, una enseña las fotos de la otra), que el LEEME pida exactamente esas
capturas, y que el visor dé la vuelta por los dos lados —sin eso, «anterior» en
el primer paso deja el marco en blanco.

---

# Quinta tanda · equilibrio de color y aire

Candado **4441** · almacén **84** · navegador **48 casos** · los dos revisores
en verde.

## El color: menos terracota, más cian

En el hub de módulos el terracota lo cubría todo —el título, el módulo
seleccionado, el botón de entrar y el acento de cada fila—: **cuatro cosas
gritando lo mismo y ninguna destacando.** Por indicación del dueño:

| Pieza | Antes | Ahora |
|---|---|---|
| Módulo elegido en el dock | terracota | **cian** (contorno, fondo, franja y nombre) |
| «Abrir» de cada tarjeta de herramienta | terracota | **cian** |
| Contorno de esas tarjetas | gris neutro | **cian suave** (24 %) |
| «Ir al módulo» y los títulos | terracota | terracota (se quedan: son la acción y el nombre) |

Se añadieron dos tonos que faltaban en la hoja —`--etx-ui-cyan-line` y
`--etx-ui-cyan-soft`— con su variante para el tema claro, en vez de escribir el
color a mano en cada regla.

## El aire sobre el título: de 99 px a 39 px

La causa estaba repartida en dos sitios, y por eso no bastó con tocar uno:

1. El envoltorio sumaba `contexto + 24 px`.
2. **Y el hero ponía los suyos encima**: 52 px en una portada, 18 en otra. Por
   eso el título caía además a distinta altura según el módulo.

Ahora el aire lo pone el envoltorio **una vez** (`contexto + 16`), y el hero no
añade nada. Medido en navegador: la distancia entre el subheader y el título
pasó de **99 a 39 px**, igual en los cuatro módulos.

En el hub, el rótulo y los cuatro módulos también subieron.

## «CLIENTES»: bicolor sin dónde partir

Un título de una sola palabra no se puede partir en dos colores, así que
«Clientes» e «Insumos» eran las dos únicas pantallas de **una sola tinta** en
todo el sistema. Ahora, cuando no hay dónde cortar, el acento pasa a su rótulo
de arriba: **BASE DE** en terracota, **CLIENTES** en crema. Lo decide el mismo
script que reparte el acento, que es el único que sabe si hubo corte — y hay una
prueba que lo sostiene.

---

# Sexta tanda · la paleta en los botones y un encabezado único

Candado **4444** · almacén **84** · navegador **48 casos** · los dos revisores
en verde.

## El encabezado de cada herramienta, igual en las dieciocho

Cada página lo resolvía a su manera: unas centraban el título, otras lo dejaban
a la izquierda, unas traían línea debajo y otras no. Al navegar, **el nombre de
la pantalla brincaba de sitio** — y el nombre de la pantalla es lo primero que
uno busca para saber dónde está.

Ahora, en las dieciocho: el nombre a la izquierda, lo que se pulsa a la derecha,
y una línea que separa el encabezado del contenido.

## El color ES el papel

Había verde, dorado, morado y rojo repartidos sin regla. El problema no es que
fueran feos: es que **tres botones distintos podían parecer igual de
importantes**. Con la paleta de la marca quedan cuatro papeles:

| Papel | Color | Ejemplos |
|---|---|---|
| **Principal** — lo que la pantalla viene a hacer | terracota sólido, tinta negra | «+ Nuevo cliente», «+ Otros ingresos», Guardar |
| **Secundaria** — lo que la acompaña | cian (tinte + contorno + texto) | Imprimir, Histórico semanal, Definir metas |
| **Terciaria** — cambiar de vista, reiniciar | contorno neutro, texto apagado; hover cian | Vistas, Reset |
| **Destructiva** | rojo `#e05a3a` | Borrar, archivar |

El **chip de sucursal** no es acción sino identidad: azul profundo, el de la
marca. Si todo fuera del color de la marca, la marca dejaría de verse. Y las
pestañas de periodo marcan el activo en cian.

**La prueba no vigila qué color tiene cada uno** —eso cambia— sino que **los
cuatro papeles sigan siendo cuatro**: el día que dos compartan tinta, el color
deja de decir nada. Comprobado con mutación: al pintar la secundaria de
terracota, el candado falla y **dice cuáles dos se mezclaron**.

## Los buscadores y los campos

Viven con ids distintos en cada página, así que se igualaron **solo por color**
—fondo de campo, texto de pista y foco en cian— sin tocar su altura ni su
espaciado. Mover la geometría de los campos de veintinueve páginas sería rehacer
formularios enteros por un tema de color, y ahí es donde se rompen cosas que
nadie mira hasta que un cliente no puede capturar.

## Lo que queda suelto, y es tuyo

Los botones del encabezado todavía llevan **emoji** (🖨️ Imprimir, 📅 Histórico,
🎯 Definir metas, 🏪 el chip). Traen su propio color —el que cada sistema
operativo decida— y es lo único que sigue peleándose con la paleta. No los
cambié porque el sprite de la marca **no tiene esos dibujos**: harían falta
cuatro —imprimir, calendario, meta y global—. Con esos SVG en `iconos/`, los
sustituyo en las dieciocho páginas de una pasada.

---

# Séptima tanda · la portada de Recetas y los encabezados que faltaban

Candado **4444** · almacén **84** · navegador **48 casos** · los dos revisores
en verde.

## La portada de Recetas no «no tenía» título: lo tenía tapado

Era el mismo tipo de trampa que el fondo: `#moduloLanding` lleva
`top:48px` **escrito en el elemento**, y eso gana a la hoja de estilos. Con el
header (70 px) y el subheader encima, sus primeros ~180 px —justo donde vive
«MÓDULO · RECETAS E INSUMOS»— quedaban **debajo de las barras**. Por eso esa
portada parecía empezar en «Costeo · Recetas» mientras las otras tres enseñaban
su nombre.

Dos reglas con `!important` y la portada queda igual que las demás. De paso se
igualaron el «Abrir» y el tamaño del texto de sus tarjetas, que esa página
definía con un id.

## Los cinco encabezados que no usaban `.header`

Resumen, Horarios, Checklists, Evaluaciones y Perfiles arman su encabezado con
clases propias (`rs-head`, `hr-head`, `ck-head`, `ev-head`, `pp-head`), así que
el trato de la tanda anterior no les llegaba. Ahora tienen la misma forma:
nombre en mayúsculas y bicolor a la izquierda, acciones a la derecha, línea
debajo. **Sin tocar su marcado**: solo se les da la misma forma desde la hoja
compartida.

Medido en navegador: el título aparece a **47–52 px** del subheader en los tres
módulos comprobados, antes invisible o a distinta altura según la página.

## Los papeles de botón, en toda la página

Estaban acotados a la barra de título, pero media docena de herramientas ponen
sus pestañas y acciones **fuera** de ella —Resumen, Horarios, Checklists— y ahí
seguían los colores viejos. Un botón que significa lo mismo no puede cambiar de
color según en qué renglón esté.

También entraron las barras que se nombraron a sí mismas (`hr-btn`, `ck-btn`,
`ev-btn`, `pp-btn`, `org-btn`) y los interruptores de vista, que iban en morado.

**Lo que NO se tocó, a propósito:** los botones de asistencia de Horarios
(`ok` / `no` / `ret`). Son un **semáforo**: ahí el verde, el rojo y el ámbar no
son decoración, son el dato.

---

# Octava tanda · el botón de arriba y las dos herramientas con hero

Candado **4446** · almacén **84** · navegador **48 casos** · los dos revisores
en verde.

## «Inicio» → «Módulos» dentro de un módulo

«Inicio» era una promesa vaga: desde una herramienta llevaba al **selector de
sucursales**, no a donde uno espera volver. Ahora las páginas de módulo nombran
ese botón **«Módulos»** y lo mandan al hub de módulos, que es de donde se entró.
Un botón de navegación tiene que decir su destino, no su jerarquía.

La barra compartida ganó `inicioTexto`; donde nadie lo pide —el hub— sigue
diciendo «Inicio», y hay una prueba para que el hub **no** se ofrezca a sí mismo.

## La línea delgada en Ventas y Gastos Diarios y en Staff

Eran las dos únicas herramientas que encabezan con hero, y su título flotaba
suelto sobre el contenido. Ya llevan la misma línea que el resto.

Va acotado a `.main-content`, que es justo lo que distingue una **herramienta**
de una **portada de módulo**: la portada ya tiene la línea de su primera sección
inmediatamente debajo, y serían dos seguidas.

## Y el último morado suelto

«Reporte Directivo» era el único botón que quedaba con el color viejo. Es una
acción que acompaña, no la principal de su pantalla: papel secundario, cian.

## Lo que sigue, acordado con Edwin

1. Él manda las **capturas de la guía del hub de módulos** → van a `/guia/` con
   los nombres de su LEEME; no hay que tocar código.
2. Después, las **capturas de novedades** → van a `/novedades/`, y ese día se
   enciende el interruptor: `ANUNCIAR = true`.

---

# Novena tanda · la primera guía con capturas reales

Candado **4447** · almacén **84** · navegador **48 casos** · los dos revisores
en verde.

## Ventas y Gastos Diarios ya tiene su recorrido

Diez capturas de Edwin, puestas en el orden en que se usa el módulo:

| | Captura | Pie |
|---|---|---|
| 1 | el menú de las ocho tarjetas | Todo lo que puedes hacer aquí |
| 2 | Cortes de caja | Los cortes del período, con su venta y su resguardo |
| 3 | Capturar corte del día | Forma de pago por forma de pago |
| 4 | Gastos diarios | Los gastos del día, con factura y evidencia |
| 5 | Editar gasto | Método, previsión y comprobante |
| 6 | Pagar nóminas | Las nóminas del período |
| 7 | Gastos fijos | Renta, servicios y obligaciones del mes |
| 8 | Depósitos y retiros | …y el dinero apartado en previsiones |
| 9 | Ventas especiales | Y anticipos, fuera de la operación diaria |
| 10 | Caja fuerte | Efectivo acumulado, bancos y tarjetas |

Pesan **928 KB las diez**, y la fila solo carga la que se está viendo.

## Dos ajustes que pidieron las fotos reales

1. **La captura se ve entera, ya no recortada.** El marco usaba `cover`, que
   recorta: estas fotos son de pantallas y de modales y sus proporciones no se
   parecen —hay modales **más altos que anchos**—, así que se perdía justo lo
   que la guía viene a enseñar. Ahora `contain`, con el fondo de la página
   detrás.
2. **El visor creció** de 420 a 540 px. Con marcos vacíos sobraba espacio; con
   capturas de verdad, hacía falta para leerlas.

## El candado que vale para las dieciocho que faltan

Las capturas se suben de una en una, así que no tiene sentido exigir que estén
todas. Lo que sí se exige: **la guía que empezó, termina.** Si existe el paso 1
y falta el 6, quien la recorre se topa con «captura en camino» a media
explicación. Y tampoco puede sobrar: una captura de más es un paso que nadie va
a ver, porque el recorrido lo marcan los pies escritos en el código.

Comprobado con mutación: al quitar `diario-7.png`, el candado falla con *«falta
diario-7.png, y su paso 7 de 10 sale vacío»*.

## Y una prueba que pasaba por casualidad

El revisor esperaba el **título** antes de comprobar el botón del subheader. El
título es marcado estático: ya está antes de que los scripts pinten la barra, así
que la comprobación corría contra una pantalla a medio montar y pasaba o fallaba
según lo rápido que fuera el equipo. Ahora espera al botón.

---

# Décima tanda · las novedades empiezan a llenarse

Candado **4448** · almacén **84** · navegador **58 casos** (Codex sumó seis de
la guía) · ambos revisores en verde.

## Codex volvió, y no pisamos lo del otro

Al retomar encontré `hub-modulos.js` tocado a las 20:54 y
`docs/reporte-codex-zoom-guia-2026-10-13.md`: **la vista expandida de las
capturas ya estaba hecha**, y mejor de lo que yo iba a hacerla (ver detalle /
ajustar imagen, foco atrapado, scroll restaurado). No la dupliqué. Mis pies de
Staff y sus ocho capturas sobrevivieron intactos.

**Una prueba sí quedó rota entre los dos**, y la arreglé porque nos bloqueaba a
ambos: Codex versionó `etaax-core.js?v=kpis-1` —correcto, es lo que evita que
Netlify mezcle HTML nuevo con script viejo— y una prueba de hace meses buscaba
la ruta **literal** `src="/etaax-core.js"`. Ahora busca el archivo con o sin
versión, así que no vuelve a caerse por un cambio que está bien. Las 17 páginas
quedaron en la misma versión; BE18 lo confirma.

## Una novedad puede llevar varias capturas

Edwin empezó a dictar el contenido del anuncio, y la tercera novedad no se
explica con una sola foto: la barra de la cuenta se entiende viendo **el menú,
Mi cuenta y Plan y facturación**, en ese orden. Así que el aviso ahora acepta
`fotos: [...]` por novedad, con flechas y contador propios.

Con una regla que importa: **las flechas de la captura mueven solo la foto.**
Querer ver la siguiente imagen no es querer pasar de tema, y al cambiar de
novedad se empieza por su primera captura — si no, se llega a la siguiente
viendo la foto 3 de la anterior.

## Lo cargado hasta ahora (4 de las que vengan)

| | Novedad | Capturas |
|---|---|---|
| 1 | Un nuevo diseño, desde que entras | acceso |
| 2 | Una barra arriba, igual en todo el sistema | el menú sin sesión |
| 3 | Tu cuenta, tu plan y tu salida, en un solo lugar | **3**: menú, Mi cuenta, Plan y facturación |
| 4 | Un botón para volver, siempre en el mismo sitio | el botón al centro |

El candado exige que **cada captura que el código nombre exista de verdad en el
repo**: el día del anuncio no hay margen para descubrir que faltaba una.

**Sigue apagado** (`ANUNCIAR = false`). Se enciende el día del push, cuando la
lista esté completa.

---

# Undécima tanda · el anuncio completo: 9 novedades, 16 capturas

Candado **4448** · almacén **84**. Las **16 capturas cargan**, comprobado una
por una en navegador real: se abre cada novedad, se recorren sus fotos y se
exige que la imagen haya cargado de verdad (`naturalWidth > 0`), no solo que el
`src` esté puesto.

| # | Novedad | Capturas |
|---|---|---|
| 1 | Un nuevo diseño, desde que entras | 1 |
| 2 | Una barra arriba, igual en todo el sistema | 1 |
| 3 | Tu cuenta, tu plan y tu salida, en un solo lugar | 3 |
| 4 | Una nueva vista para administrar tus sucursales | 1 |
| 5 | Los accesos globales, con su propia entrada | 3 |
| 6 | Tus cuatro módulos, y una vista previa de cada uno | 2 |
| 7 | Una barra lateral para moverte dentro del módulo | 1 |
| 8 | Cambiar de módulo sin perder tu sucursal | 2 |
| 9 | Un botón para volver, siempre en el mismo sitio | 2 |

**Una decisión de redacción que vale la pena contar:** Edwin dictó por separado
«un botón para volver al inicio» y «un botón para volver a los módulos». Son el
mismo botón, que cambia de nombre según dónde estés — anunciarlos como dos cosas
distintas haría que la novena novedad contradijera a la primera. Van juntos, con
sus dos capturas, y el texto lo explica: «dentro de un módulo se llama Módulos;
fuera, Inicio te lleva a tus sucursales».

**Sigue apagado.** El día del push: `ANUNCIAR = true` en `novedades.js`.

---

# Duodécima tanda · el anuncio completo, y lo que yo había borrado

Candado **4449** · almacén **84** · navegador **58 casos** · recorrido del
anuncio verificado paso a paso.

## Mi error: borré cuatro novedades al cargar el dictado

Al rehacer la lista con lo que Edwin iba dictando, **reemplacé el array
entero** — y con él se fueron cuatro novedades que yo mismo había redactado del
rediseño: los iconos propios, la organización y el giro, los reportes que avisan
si leyeron todo, y el freno a los NIP. Edwin lo notó: «omitiste varios puntos».

Las tres últimas **no se fotografían**: no hay captura de «ahora el reporte lee
hasta el final». Así que el aviso ahora admite novedades sin foto, y sin foto no
se dibuja marco: un recuadro vacío junto a su texto parecería un error, no una
novedad sin captura.

## Y dos que sus capturas enseñaban y nadie anunciaba

- **La guía de operación** del inicio —los cinco pasos numerados— estaba en la
  captura de los accesos globales y no se mencionaba en ningún lado. Ahora es su
  propia novedad, con esa captura; los dos modales se quedan con la suya.
- **La organización y el giro** se habían quedado fuera: la novedad de
  sucursales hablaba de las tarjetas, no de que el negocio ahora declara qué es
  y cada sucursal su giro.

Son **13 novedades y 16 capturas**.

## Un solo par de botones

Edwin: «esos botones de flechas están de más». Tenía razón — la captura traía
sus flechas y el recuadro sus botones: **dos formas de avanzar en la misma
tarjeta, y ninguna decía cuál llevaba más lejos**.

Ahora «Siguiente» recorre las capturas de la novedad y, cuando se acaban, pasa a
la siguiente. «Atrás» desanda lo mismo y cae en la **última** captura de la
anterior: volver es regresar por donde se vino, no al principio de otra cosa.

Verificado en navegador recorriendo el anuncio entero con un solo botón:
**19 pasos**, `N1 → N3 1/3 → N3 2/3 → N3 3/3 → N4 …`, todas las capturas
cargadas y ninguna flecha huérfana.

## Nota de convivencia con Codex

A media tanda el candado marcó dos fallas de dinero —Resumen contaba 1,500 de
previsiones y KPIs 0—. **No eran mías**: `financiero/kpis.html` estaba siendo
editado en ese momento. Al terminar él, volvieron a cuadrar solas. Lo dejo
escrito porque es la clase de falla que no se debe «arreglar» a ciegas cuando
dos estamos escribiendo a la vez: el candado estaba viendo un estado a medias,
no un error.

---

# Decimotercera tanda · el contador que mentía, y la salida visible

Candado **4450** · almacén **84**.

## «1 de 13» cuando el recorrido tiene 19 pantallas

Edwin lo cazó: el sello contaba **novedades** y la persona recorre **pasos**.
Con tres capturas en una novedad y dos en otra, un «1 de 13» promete un camino
más corto del que tiene — y quien va por el paso 15 creyendo que iba por el 9 se
siente engañado, que es exactamente lo contrario de lo que un anuncio busca.

Ahora dice **«Paso 3 de 19»**, contando cada pantalla que se ve. Los puntos de
abajo siguen marcando las novedades, que es donde esa cuenta sí sirve. Y el
contador de captura («1 / 3») desapareció: con el sello contando pasos, decirlo
dos veces sobra.

## Una salida a la vista

Se podía cerrar con Escape o tocando fuera, pero **las dos son cosas que hay que
saber**. Quien no las conoce se siente atrapado en un anuncio que no pidió, y una
buena noticia se vuelve un estorbo. Ahora hay una **✕** en la esquina, en las dos
pantallas —el aviso y la presentación—.

Cerrar ahí **no** marca la actualización como vista: vuelve a ofrecerse en la
siguiente entrada, salvo que ya se haya llegado al final.

## Lo que faltaba del encargo

- **La captura de los iconos** ya está (`11-iconos.png`): la galería de los SVG
  de la marca. Esa novedad era de las tres sin foto; ahora son dos.
- **El aviso de entrada dice de qué va el retoque**: «Le dimos un retoque al
  diseño —colores, botones e iconos propios— y rehicimos cómo se navega entre
  tus sucursales, tus módulos y sus herramientas». Antes decía «rediseñamos cómo
  se ve y cómo se navega», que no contaba nada.

---

# Decimocuarta tanda · la portada del anuncio y su ventana de tres días

Candado **4455** · almacén **84**.

## La portada

Al iniciar sesión aparece una portada que dice qué se actualizó, pregunta
**«¿Quieres ver las novedades?»** y ofrece dos salidas: **Ver novedades** y
**Omitir novedades** (más la ✕ de la esquina).

## Tres días desde el push, en cada inicio de sesión

La regla cambió, y el cambio importa: antes el anuncio salía **una vez por
persona**; ahora sale **en cada inicio de sesión durante tres días**, lo haya
visto o no. El motivo es el que dio Edwin: quien ese día entró con prisa se lo
perdería para siempre.

Lo que no hace es insistir dos veces en la **misma** sesión — para eso sigue el
aplazamiento en `sessionStorage`, que muere con la pestaña.

**La ventana se ancla sola.** No hay una fecha escrita a mano que alguien tenga
que recordar: se mide contra la misma `FECHA` que el hook de pre-commit estampa
en cada publicación, así que la cuenta arranca el día del push. Si se vuelve a
publicar dentro de esos tres días la ventana se reinicia — a propósito: la
referencia es siempre la última publicación. Queda escrito en el LEEME porque es
el tipo de detalle que sorprende a quien no lo esperaba.

Pasados los tres días deja de asomarse, pero **sigue en el menú de la cuenta**
para quien quiera repasarlo.

## Lo que el candado vigila ahora

- Dentro de la ventana sale **aunque ya se haya visto**.
- **El último día todavía cuenta** (se corta al cuarto, no al tercero).
- Pasada la ventana **no se asoma solo**, pero **el menú lo sigue abriendo**.
- La portada **pregunta** y ofrece **las dos salidas**.
- Y la regla de siempre: nunca salen el avisito y la presentación a la vez.

Para probar la caducidad, el arnés mueve la `FECHA` del archivo —no el reloj del
sistema— y la arma en hora local, porque el archivo cuenta los días en local: con
UTC, la prueba fallaría solo por las tardes.

---

# Decimoquinta tanda · ETAAX 2.0 · Mise en Place

Candado **4457** · almacén **84**.

## Las actualizaciones grandes ya tienen número y nombre

El número ordena —**2.0**, la primera después de la etapa de desarrollo— y el
nombre es el que la gente repite: «la de Mise en Place». Un «2026.10» no se le
queda a nadie.

*Mise en place* es el término que todo cocinero conoce: tener **todo en su lugar
antes del servicio**. Es exactamente lo que hizo esta versión —cada herramienta,
cada título y cada botón en su sitio— y habla el idioma del negocio al que se le
está anunciando. Se cambia en una línea si Edwin prefiere otro.

**El número manda también por dentro:** `VERSION = NUMERO`, así que es la misma
marca de «ya lo vi». Tenerlos separados sería tener dos cuentas de lo mismo, y
el día que alguien suba una sin la otra, medio mundo se queda sin anuncio. Hay
una prueba que exige que sigan siendo el mismo valor.

Una actualización chica sube el decimal (2.1) y no necesita nombre.

## Y la portada ya no cuenta cuántas son

Edwin: «hay muchas, solo estamos mostrando lo relevante». Tiene razón y hay un
motivo de fondo: **decir «son 13» invita a compararlas con lo que uno esperaba**,
y ninguna lista gana esa comparación. Ahora dice «te las enseñamos con sus
capturas, en un par de minutos» — y una prueba vigila que no vuelva a aparecer
un número ahí.

## Nota para Codex · el arnés no cargaba tu dependencia nueva

Al añadir `metas-referencia.js` a KPIs con `<script src>`, el candado empezó a
reventar con **«EtaaxMetas no está definido»** — y parecía un bug de la página
cuando era del arnés: **solo corre lo que está EN LÍNEA** en el HTML.

Lo arreglé en los tres arneses que montan KPIs. Lo intenté primero leyendo todos
los `<script src>` del propio HTML —para no tener que acordarse nunca más— y
**no funciona**: mete scripts que esperan un navegador entero y el arnés revienta
por el lado equivocado. Se quedó enumerado a propósito.

**Si una pantalla falla con «X no está definido», su archivo va en esa lista.**
Lo dejo escrito aquí porque va a volver a pasar: cada dependencia nueva con
`<script src>` necesita su línea en el arnés.
