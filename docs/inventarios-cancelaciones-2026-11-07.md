# Inventarios: cancelaciones informativas — 7 de noviembre de 2026

## Regla solicitada

Las cancelaciones POS no acreditan salida física. No modifican existencias teóricas, consumo, porcentajes, faltantes, sobrantes ni importes. Las salidas físicas siguen registrándose en ventas, producción, cortesías o mermas.

- Match con insumo: su cantidad se muestra en la fila de ese insumo, como referencia informativa.
- Match con cóctel o platillo: permanece en la lista/informe de cancelaciones POS. No se desglosa en ingredientes, aunque use prebatch o subrecetas anidadas.
- Sin match: permanece en el informe POS sin atribuirse a ningún insumo.

## Causas y correcciones

1. `getCancelacionesCopas` buscaba la primera palabra del producto POS dentro del nombre del insumo cuando no había ID. `TE` podía aparecer dentro de `Estate` y `White`. Ahora solo acepta asociaciones por ID, conservando la resolución maestro/copia existente.
2. El índice de cancelaciones copiaba el recorrido de las ventas y desglosaba recetas y prebatch. Así llegaban cancelaciones de Limoncello Spritz hasta el vodka. Se retiraron ese índice, su caché y su propagación; las ventas conservan su cálculo y reparto.
3. Se excluyeron las cancelaciones de `calcExistenciaTeorica` y del consumo del reporte directivo. Lista, galería, compuestos e impresos consultan solo las cancelaciones directas del insumo.
4. Se sustituyó el desplegable largo por un selector con búsqueda sin distinción de acentos, grupos de carta/insumos y botón «Sin match». La elección guarda `matchManual` en el JSON del inventario. «Re-detectar automáticos» la respeta; «Detectar automáticamente» permite restablecer la detección de esa cancelación.
5. El selector impide aplicar una elección a otro inventario si cambia el contexto mientras está abierto. Incluye cierre con Escape, control de foco y lista desplazable con buscador fijo.

## Validación

- `node tests/money-tests.js`: 5,411 comprobaciones, cero fallas. Incluye 25 casos nuevos ejecutando el código real en `tests/inventarios-cancelaciones-casos.cjs`.
- La suite BH24 cambió porque su regla anterior exigía descontar ingredientes cancelados. Se conservaron las pruebas de importación y se sustituyeron las expectativas antiguas por invariancia de cálculos, separación de referencias, persistencia manual y aislamiento entre inventarios.
- Casos de copa, vino, cerveza/refresco por pieza, abarrotes por peso, prebatch anidados y controles de ventas/mermas/cortesías/producción. Se comparan renglones y galería completos antes/después; el análisis real del reporte conserva los mismos importes y porcentajes.
- `node tests/store-tests.js`: 84 comprobaciones, cero fallas.
- `node tests/probar-cancelaciones-navegador.cjs`: Chrome, 1280×900, 1024×768 y 390×844; touch emulado, búsqueda, selección, «Sin match», Escape y encabezado fijo. No sustituye la prueba en tablet física.
- `node tests/probar-paginacion-inventarios.cjs`: 120 productos completos en ambos casos, incluido comentario mayor que una página, sin desbordamientos.
- Sintaxis, `git diff --check` y `node versionar.js --revisar`: correctos. La referencia de `inventarios.js` lleva su huella nueva.

## Datos existentes

No requiere migración SQL ni modifica datos en producción durante las pruebas. Los inventarios guardados se recalculan con la nueva regla al abrirlos con el JavaScript actualizado; los PDF ya exportados deben generarse nuevamente. Se conservan las cancelaciones originales y sus datos POS. Los matches antiguos equivocados pueden corregirse con el buscador o volver a detectarse; no se borraron registros por semejanza de nombre o fecha.
