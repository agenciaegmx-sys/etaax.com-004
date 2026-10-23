# Prebatch en todas las familias de insumos

Revisión del 23 de octubre de 2026, posterior a `714ab88`.

## Resultado de la revisión

El rendimiento ya era común a todas las familias, pero todavía había caminos
que confundían una pieza/empaque con un ml o un gramo:

- El reparto de una lata completa dividía otra vez entre su contenido.
- Una botella completa de licor se descontaba como 1 ml en lugar de su volumen.
- Un empaque drenado de abarrotes se descontaba como 1 g.
- `L` no se convertía como `LT` en algunos caminos.
- Los batches contados por pieza se excluían del reparto y suponían una sola
  pieza producida por batch, independientemente de su rendimiento.
- La galería sumaba producción y venta del batch como dos consumos. Algunas
  filas y reportes de alimentos estaban rotulados como copas/botellas.

Se centralizaron `cantidadBaseInventario` y `cantidadFilaInventario` en
`etaax-core.js`. La conversión depende de la unidad de receta y de la unidad
de la fila, sin excepciones por familia. Se usa en ventas de recetas,
producción y reparto de existencias, ventas, entradas y diferencias.

## Casos cubiertos

| Familia / presentación | Unidad de receta | Unidad de inventario |
| --- | --- | --- |
| Licor, destilado | ML, LT, botella PZA | Copas según su tamaño |
| Vino | LT, OZ | Copas de vino |
| Refresco | ML o botella PZA | Piezas y fracciones |
| Cerveza | Lata PZA o parte en ML | Piezas y fracciones |
| Cerveza de barril | L | Fracción del barril |
| Abarrotes, frutas, carnes | G, KG | Gramos |
| Abarrote por empaque | PZA | Contenido utilizable, drenado cuando existe |
| Cerezas y otras subunidades | SUBUNIDAD | Peso utilizable de esas unidades |
| Productos sin volumen, contados por pieza | PZA | Piezas |
| Subrecetas contadas por envase o por pieza producida | G/ML/PZA de rendimiento | Conversión al conteo de su fila |

Una lata de 355 ml usada completa por batch devuelve 177.5 ml de ingrediente
si queda medio batch. En su fila equivale a media lata, no a 0.0014 latas.
Un empaque drenado de 900 g usado completo devuelve 450 g si queda medio batch.

Las piezas parciales se conservan en cálculos y se muestran con hasta cuatro
decimales. Los reportes y la galería respetan g, ml y pza; los grupos con unidades
mezcladas no suman cantidades incompatibles bajo una sola unidad. Las celdas
normales del reporte conservan texto oscuro sobre papel blanco.

## Verificación

- `node tests/money-tests.js`: **4724 comprobaciones, cero fallas**, con 60
  regresiones nuevas. Se comprobaron producción, parte restante, venta y
  conservación de la diferencia al cambiar los batches registrados.
- Navegador real, 1440 y 390 px: **ocho casos, cero fallas**, con bebidas y
  alimentos en el mismo inventario. Se validaron lista, galería, contador real
  del Paso 3 y reporte.
- Sintaxis de JS, versiones de los recursos y `git diff --check`: correctos.
- Supabase simulado; sin modificar conteos ni catálogos reales del negocio.

[Resultado](inventario-familias-2026-10-23/resultado-1440.png) ·
[Reporte](inventario-familias-2026-10-23/reporte.png).
