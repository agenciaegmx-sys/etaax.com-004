# Guía visual: ampliar capturas y recorrido de Proveedores

Trabajo retomado el 13 de octubre de 2026 sobre la vista de guía que Claude
ya había preparado en el hub de módulos.

## Resultado

Al hacer clic o tocar una captura disponible se abre un modal flotante con
animación. Muestra la imagen completa, el nombre de la herramienta, su pie y
el contador. Las flechas del visor y del teclado recorren las capturas; la
fila original conserva el paso elegido cuando se cierra.

**Ver detalle** aumenta la imagen y permite desplazarse para leerla.
**Ajustar imagen** vuelve a mostrarla completa. El cierre funciona con ×,
Escape o clic en el fondo. El diálogo mantiene el foco dentro, devuelve el
foco al visor original y restaura el desplazamiento de la página al cerrar.
La animación respeta la preferencia de movimiento reducido.

Las imágenes pendientes mantienen «Captura en camino». La ampliación se
aplica a todas las herramientas de la guía a medida que reciben sus capturas.
Se corrigió también el cierre nativo diferido: cerrar y reabrir inmediatamente
el visor conserva abierta la nueva captura.

## Proveedores

Se guardaron los tres PNG originales entregados por el usuario, en el mismo
orden, con un total aproximado de 194 KB:

| Archivo | Tamaño | Pie de imagen |
|---|---|---|
| `guia/proveedores-1.png` | 1698 × 703 | El directorio: contactos, sucursal y forma de pago |
| `guia/proveedores-2.png` | 639 × 831 | Agregar proveedor: contacto, pago, facturación y expediente |
| `guia/proveedores-3.png` | 1703 × 283 | El proveedor guardado en el directorio |

Esta primera entrega dejó 21 imágenes: diez de Diario, ocho de Staff y tres de
Proveedores. Clientes y Menú se completaron en la continuación descrita al final.

## Archivos de esta entrega

- `hub-modulos.js`: apertura, navegación, detalle y cierre del visor; pies de Proveedores.
- `hub-modulos.css`: marco interactivo, modal adaptable y animación.
- `hub.html`: versiones de CSS/JS del hub actualizadas a `v=8`.
- `guia/LEEME.md`: instrucciones del visor, proporciones originales y estado del álbum.
- `tests/probar-cuenta-header.cjs`: seis casos adicionales para la guía, incluidos el orden de Proveedores y la reapertura inmediata.

Se mantuvo la navegación de la vista de guía: las filas enseñan capturas y el
botón «Ir al módulo» abre el módulo. El visor no modifica el negocio, la
sucursal ni las rutas de herramientas.

## Verificación

- Navegador: **54 casos, 0 fallas**, con Supabase simulado y peticiones externas bloqueadas.
- `node tests/money-tests.js`: **4447 comprobaciones, 0 fallas**; incluye consistencia de los archivos y pasos de las guías.
- `node tests/store-tests.js`: **84 comprobaciones, 0 fallas**, ejecutado durante esta tarea antes de añadir los PNG de Proveedores.
- Sintaxis de ambos JS y `git diff --check`: correctos.
- Revisión visual a 1440, 390 y 320 px: imágenes completas, modal dentro de la pantalla y detalle con desplazamiento. Diario revisado en ambos temas, Staff en claro y Proveedores en oscuro. Movimiento reducido comprobado.

Las capturas de revisión y los logs están en
[`continuidad-codex-2026-10-13/guia-zoom/`](continuidad-codex-2026-10-13/guia-zoom/).
Los cambios continúan en el workspace, sin commit ni push de esta entrega.

## Para continuar con Claude

Usa [`guia/LEEME.md`](../guia/LEEME.md): añade cada siguiente recorrido como
`<clave>-1.png`, `<clave>-2.png`, etc., y ajusta `funciones` de esa herramienta
en `hub-modulos.js` para que su orden y cantidad coincidan. Mantén las imágenes
completas y la ampliación compartida. La prueba de capturas pendientes usa
ahora Guías de uso; cámbiala a otra herramienta pendiente cuando se llene.

La guía histórica de continuidad describe el estado de la pausa anterior.
Esta entrega y el trabajo posterior de Claude establecen el hub actual como
una guía visual con filas informativas.

## Continuación: Clientes y Gestión de menú

El usuario entregó siete capturas más. Las primeras tres forman el recorrido
de Clientes: directorio, nuevo cliente y cliente guardado. Las siguientes
forman el recorrido de Menú: gestión, QR y ajustes de apariencia. Las dos
capturas del QR eran idénticas; se conserva una sola.

Los seis PNG originales están en `guia/clientes-1.png` … `clientes-3.png` y
`guia/menu-1.png` … `menu-3.png`, con unos 328 KB en total. Se ajustaron sus
pies en `hub-modulos.js` y sus estados en `guia/LEEME.md`. El JS del hub carga
ahora con `v=9`; el CSS conserva `v=8`.

El álbum tiene **27 imágenes** y las **cinco herramientas de Control
administrativo tienen guías completas**. La prueba del marco pendiente pasó
de Clientes a Escandallos, en Recetas e Insumos.

Verificación de esta continuación: **54 casos de navegador y 4447
comprobaciones del candado, sin fallas**. Se revisaron los seis pasos a 1440,
390 y 320 px: imágenes enteras, orden y pies correctos, ampliación y detalle
con desplazamiento en móvil. Se usó Supabase simulado y se bloquearon las
peticiones externas. Evidencia:
[`continuidad-codex-2026-10-13/guia-clientes-menu/`](continuidad-codex-2026-10-13/guia-clientes-menu/).

## Continuación: catálogo flotante y guía de Escandallos

El encabezado compartido usa `z-index:900`; el catálogo tenía `200`, por lo
que la barra tapaba «Mis Recetas» y sus controles. En `recetas/index.html` el
catálogo queda en `1000`, los diálogos de ficha y edición en `1010`, y los de
impresión y vinculación de sucursales en `1020`. Los editores de iframe
conservan su posición superior. El orden permite abrir detalles e impresión
encima del catálogo y volver a él al cerrar.

El encabezado, los filtros y los controles de vista del catálogo ahora se
distribuyen en varias líneas cuando falta ancho. La revisión a 320 px muestra
el buscador, filtros y botones completos, sin desplazamiento horizontal.

Se añadieron las **siete capturas originales** posteriores a la imagen que
ilustraba el bug, como `guia/escandallos-1.png` … `escandallos-7.png`, unos
514 KB: menú, alimentos, bebidas, sub-alimentos, sub-bebidas, receta simple y
catálogo. Los pies siguen ese orden. El álbum contiene **34 imágenes** y el
JS del hub carga con `v=10`. La prueba de captura pendiente usa ahora Insumos.

Las dos nuevas pruebas del navegador abren el recetario real a 1010 y 320 px
con datos de prueba. Comprueban el encabezado y Cerrar mediante hit testing,
el ancho, minimizar/restaurar, abrir una ficha, abrir impresión y cerrar las
ventanas conservando el catálogo. El arnés distingue peticiones tardías de
targets que ya se cerraron, conservando los errores de sesiones vivas.

La guía se revisó a 1440, 390 y 320 px, recorriendo las siete imágenes en el
modal y comprobando el detalle en móvil. Las pruebas usan Supabase simulado y
bloquean peticiones externas. **56 casos de navegador y 4447 comprobaciones
del candado, sin fallas**. Sintaxis de JS y `git diff --check` correctos. Evidencia:
[`continuidad-codex-2026-10-13/guia-escandallos/`](continuidad-codex-2026-10-13/guia-escandallos/).

## Continuación: guía de Insumos

Se añadieron los siete PNG originales del usuario como `guia/insumos-1.png`
… `insumos-7.png`, conservando su orden y proporciones: catálogo, ficha técnica,
edición del insumo, cambio de tipo, costeo y stock, selector para agregar un
insumo y catálogo global ETAAX. Los pies de `hub-modulos.js` describen esas
pantallas y el JS del hub carga con `v=11`.

El álbum tiene **41 imágenes**. Insumos cuenta con siete pasos completos y la
prueba de captura pendiente usa ahora Inventarios. `guia/LEEME.md` refleja el
nuevo recorrido.

La revisión visual recorrió las siete capturas a 1440, 390 y 320 px, verificando
el orden, los pies, la proporción completa, la ampliación, el detalle con
desplazamiento en móvil y el regreso al mismo paso. **56 casos de navegador y
4447 comprobaciones del candado, sin fallas**, con Supabase simulado y peticiones
externas bloqueadas. Sintaxis de JS y `git diff --check` correctos. Evidencia:
[`continuidad-codex-2026-10-13/guia-insumos/`](continuidad-codex-2026-10-13/guia-insumos/).

## Continuación: isotipo del login e Inventarios

El enlace central del encabezado sin sesión muestra el isotipo original
`marca/etaax-isotipo.svg` y abre `/index.html`, la landing pública. Tiene
nombre accesible y área de 44 × 44 px. El cambio vive en `_pintarHeader()` de
`hub.html` y en `hub-paleta.css`: al pintar un encabezado con sesión se mantiene
la navegación habitual del hub. El CSS de la paleta carga con `v=10`.

Las siete capturas de Inventarios se guardaron como `guia/inventarios-1.png`
… `inventarios-7.png`, en su orden original: catálogo, QR de entradas, reporte
de existencias por área, productos compuestos, historial de entradas, datos
generales y captura de existencias. Sus pies están en `hub-modulos.js`, que
carga con `v=12`. El álbum tiene **48 imágenes** y la prueba de captura pendiente
usa ahora Requisiciones.

La revisión de la guía recorrió las siete imágenes a 1440, 390 y 320 px,
incluyendo ampliación, detalle y regreso al paso elegido. Las dos pruebas nuevas
de login comprueban el isotipo y el destino, activando el enlace con Enter en
PC y móvil. Se comprueba también que el enlace del hub con sesión conserve su
destino. **58 casos de navegador y 4447 comprobaciones del candado, sin fallas**,
con Supabase simulado y peticiones externas bloqueadas. El login se revisó
visualmente a 1440, 390 y 320 px en ambos temas; sintaxis de JS y
`git diff --check` correctos. Evidencia:
[`continuidad-codex-2026-10-13/login-inventarios/`](continuidad-codex-2026-10-13/login-inventarios/).

## Continuación: guía de Requisiciones

Se añadieron los cuatro PNG originales como `guia/requisiciones-1.png` …
`requisiciones-4.png`, conservando el orden: búsqueda rápida de existencias,
lista completa, proyección por área y proveedor, y pedido/exportación con el
comparativo de compra contra venta. Los pies de `hub-modulos.js` corresponden
a esas pantallas; el JS del hub carga con `v=13`.

El álbum tiene **52 imágenes**. Las cuatro guías de Recetas e Insumos están
completas, junto con las cinco de Control administrativo. `guia/LEEME.md` refleja
el nuevo recorrido. La prueba de captura pendiente usa ahora Guías de uso,
en Aprende y analiza.

Se revisaron las cuatro capturas a 1440, 390 y 320 px: orden, pies, proporción
completa, ampliación, detalle en móvil y regreso al paso elegido. **58 casos de
navegador y 4447 comprobaciones del candado, sin fallas**, con Supabase simulado
y peticiones externas bloqueadas. Sintaxis de JS y `git diff --check` correctos. Evidencia:
[`continuidad-codex-2026-10-13/guia-requisiciones/`](continuidad-codex-2026-10-13/guia-requisiciones/).

## Continuación: tablero de KPIs

Después de completar las guías de Requisiciones se rediseñó el tablero real
de KPIs con la referencia del usuario. La implementación y la validación
actual están en el [reporte de KPIs](reporte-codex-kpis-2026-10-13.md).
