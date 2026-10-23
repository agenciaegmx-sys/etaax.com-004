# Parpadeo del diseño anterior al navegar

Revisión del 23 de octubre de 2026. Base anterior: `3db7dcd`.

## Causa reproducida

El CSS nuevo ya llegaba desde el head y `etaax-ui-inicio.js` aplicaba las
clases iniciales. El HTML conserva, sin embargo, el menú, tarjetas e iconos
anteriores: los decoradores del final del body los transforman y crean el
encabezado compartido.

El navegador podía pintar ese HTML mientras descargaba los scripts visuales.
Al retrasarlos se reprodujo la vista anterior, incluso usando los archivos
actuales. Antes de terminar la carga se observó:

```json
{"opacity":"1","navNuevo":false,"headerNuevo":false,"tarjetasNuevas":0,"ready":"loading"}
```

También se consultaron, sin sesión, las cabeceras públicas de `/recetas/` y
`/etaax-modulos-ui.js?v=34de802f`: ambas respondieron 200 con
`Cache-Control: public,no-cache,must-revalidate`. El versionado y la
revalidación evitan copias antiguas; no coordinaban aquel primer render.

## Corrección

- Las 29 páginas de módulos precargan desde el head los mismos URLs y
  versiones de los scripts visuales que ejecutan al final. No se modifica su
  orden de ejecución ni se descargan versiones distintas por la precarga.
- El arranque temprano marca la presentación como pendiente. El contenido
  conserva sus medidas para que encabezados, tablas y ventanas puedan
  calcular su layout, y aparece un indicador con los colores del tema.
- Tras DOMContentLoaded y la primera decoración se muestra la página en dos
  cuadros de animación. No se espera a Supabase, fotos, fuentes ni consultas
  de datos; no hay un retraso fijo de un segundo.
- Si falla un recurso, DOMContentLoaded libera igualmente la presentación:
  no queda oculta de forma permanente. Al volver desde historial/BFCache no
  se reactiva la carga. También se contemplan pestañas en segundo plano.
- Se mantiene la política de caché publicada y se actualizan las huellas de
  contenido. No se limpian datos, sesiones, capturas ni almacenamiento local.

## Verificación

`node tests/probar-navegacion-visual.cjs`: **34 casos, cero fallas**.

Usa las páginas reales con Supabase simulado, scripts visuales retrasados y
servidor local con ETag/revalidación. Comprueba caché fría y caliente, URLs
limpias, escritorio de 1440 px y móvil de 390 px, avance/retroceso, `embed=1`,
`solo=1`, recursos fallidos y datos pendientes. Registra los cuadros visibles:
ninguno muestra el encabezado/menú anterior antes de la decoración.

La misma prueba, sirviendo el arranque y CSS del commit anterior mediante
`NAV_VISUAL_SOURCE`, falla donde debe: contenido visible (`opacity:1`) mientras
los decoradores aún no llegaron. `NAV_CAPTURES` permite elegir el directorio
de las capturas; todos los datos de la prueba son ficticios.

Regresiones adicionales:

- `node tests/probar-sidebar.cjs`: **11 casos, cero fallas**.
- `node tests/probar-ventanas-insumos.cjs`: **12 casos, cero fallas**.
- Sintaxis de los scripts, `node versionar.js --revisar` y `git diff --check`.

[Antes de completar la carga](navegacion-visual-2026-10-23/antes.png) ·
[Carga corregida](navegacion-visual-2026-10-23/durante-1440.png) ·
[Página lista](navegacion-visual-2026-10-23/lista-1440.png) ·
[Móvil](navegacion-visual-2026-10-23/lista-390.png).
