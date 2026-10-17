# Ventanas flotantes e identidad de inventarios — 16 de octubre de 2026

## Problemas reproducidos

- Las tres fuentes del botón morado de Insumos abren `insumos.html?solo=1`,
  pero el diseño compartido reconocía únicamente `embed=1`. Reinsertaba el
  encabezado de la página y tapaba el título/contador del catálogo.
- El encabezado estaba en `z-index:900`, por encima del modal compartido (200),
  los modales de Organigrama (300) y los catálogos de insumos (500).
- Inventarios construía una fila por registro del catálogo, incluso si un
  maestro y su copia antigua seguían asignados a la misma sucursal.
- Había dos declaraciones de `_filaConDatos`: la última incluía `registrado`.
  Una fila fantasma marcada en cero podía ganar frente a otra con conteo real.
- El resolver descartaba la copia cuando su nombre difería del maestro.
  Renombrar una ficha local hacía volver a los datos del maestro.
- El reporte de existencias comparaba IDs crudos: un cero reciente bajo el ID
  local no sustituía las existencias antiguas guardadas bajo el ID maestro.
- La salvaguarda de filas antiguas reinsertaba también huérfanos en cero, sin
  existencias anteriores ni movimiento. La carga tardía del catálogo solo
  reconstruía un inventario completamente vacío.

## Corrección

`embed.js`, `etaax-header.js` y `etaax-modulos-ui.js` reconocen las ventanas
`solo=1`/`embed=1`. El encabezado compartido no se crea dentro de iframes y
queda por debajo de los overlays cuando la página se abre normalmente.
Los modales anidados de recetas ajustan su ancho al espacio disponible.

`insumo-label.js` resuelve las fichas de insumos por `origenId`, sin usar el
nombre como identidad. Inventarios utiliza la sucursal del documento para
buscar la ficha, las referencias y los movimientos. Los reportes que consultan
varias sucursales mantienen sus cantidades y costos separados.

`recetas/inventarios.js` construye una sola fila por identidad, prioriza la
ficha local y la captura con movimiento frente al duplicado en cero. Aplica
la misma regla en referencias, capitales y reportes. El último cierre del día
manda si hay varios conteos de la misma fecha. Las entradas/cancelaciones de
IDs maestro y local se relacionan con la misma fila, respetando la sucursal.

Las filas retiradas sin movimiento no vuelven a aparecer. Se mantienen los
ceros registrados de productos vigentes y los registros históricos con
existencia anterior, cantidades, entradas, cancelaciones o consumo en recetas.
Si se retiran aliases o filas obsoletas, `respaldoIdentidad` conserva una copia
de las filas originales en el documento; se guarda con el flujo normal.
La recarga del catálogo conserva la captura en curso y no se aplica a otro
inventario abierto mientras llegaba la respuesta.

No se fusionan productos distintos por coincidencia de nombre. Si un vínculo
`origenId` se perdió antes de estas correcciones, este cambio no inventa su
parentesco: ese caso requiere identificar sus IDs con los datos originales.

Se versionaron también `embed.js`, `recetas/inventarios.js` y
`recetas/insumos.js` para evitar que el navegador siga usando el código viejo.
La aplicación móvil renueva su caché a v6 por el resolver compartido.

## Verificación

- `node tests/money-tests.js`: **4,570 comprobaciones, cero fallas**.
- `node tests/store-tests.js`: **84 comprobaciones, cero fallas**.
- `node tests/probar-ventanas-insumos.cjs`: **12 casos de Chrome**, a 1440,
  768 y 390 px: tres fuentes, contadores visibles, ausencia del encabezado
  interno, cerrar/minimizar/restaurar y catálogos sobre el encabezado exterior.
- Casos nuevos en la suite J2: maestro/copia, renombre local, cero frente a
  conteo real, huérfanos, consumo histórico, guardado/reapertura, último cero,
  separación por sucursal y capital sin duplicar.
- Sintaxis de JS, `git diff --check` y `node versionar.js --revisar`: correctos.

Las pruebas usan datos ficticios y Supabase simulado. No se leyó ni modificó
el inventario real del negocio y no se ejecutó una migración masiva en nube.
La reconciliación se aplica al abrir/recalcular y se persiste al guardar.

[Catálogo en tablet](ventanas-inventarios-2026-10-16/etaax-768.png) ·
[Catálogo en móvil](ventanas-inventarios-2026-10-16/etaax-390.png) ·
[Nuevo insumo](ventanas-inventarios-2026-10-16/nuevo-768.png).
