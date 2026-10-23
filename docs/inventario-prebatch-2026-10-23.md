# Inventario de prebatch: rendimiento y equivalentes por insumo

Corrección del 23 de octubre de 2026.

## Causa

La producción añadía el rendimiento declarado de la subreceta, mientras que
`_repartoPrebatch()` repartía existencias, ventas y diferencias entre la suma
numérica de ingredientes. Eran dos denominadores diferentes.

Con 350 ml de vermouth + 350 ml de Campari y rendimiento capturado de 750 ml,
producir descontaba 350 ml de cada botella, pero el reparto devolvía 375 ml de
cada uno por batch. La diferencia ficticia era de 25 ml por insumo y batch:
0.4166667 copas de 60 ml. Cambiar el número de batches movía la varianza sin
que hubiera cambiado el conteo físico.

La capacidad del envase puede ser 750 ml y el rendimiento real de esta receta
700 ml. El código respeta el rendimiento capturado; no modifica recetas ni
conteos del negocio. Cuando faltan datos de rendimiento se conserva el orden
de respaldo de `_rendBatch()` y su aviso existente.

## Corrección

La producción y el reparto usan ahora el mismo rendimiento y la misma ficha
local del insumo. Cada ingrediente recibe:

```
equivalente del ingrediente = cantidad de mix × dosis del ingrediente / rendimiento
```

Se aplica a existencia anterior, entradas, ventas, cancelaciones, mermas,
existencia teórica y física, también en subrecetas encadenadas. El resultado
se convierte después a las unidades de la fila, por ejemplo copas de 60 ml.

El resultado distingue el total de mix de los equivalentes de cada insumo y
muestra la fórmula por batch. El reporte conserva decimales para que 586.5 ml
no aparezcan como 587 ml frente a dos partes de 293.25 ml.

La regresión antigua de Limoncello dividía entre 2770, suma de gramos y ml,
aunque la receta declara 2600 ml terminados. Se corrigió su expectativa: cada
ingrediente debe equivaler a la misma cantidad de preparación terminada. No
se suman gramos y ml de materia prima como si fueran volumen de mezcla.

## Ejemplo verificado

Con rendimiento real de 700 ml y envase de 750 ml:

| Movimiento | Vermouth | Campari | Ginebra directa |
| --- | ---: | ---: | ---: |
| Preparar 4 batches | 1400 ml | 1400 ml | 0 ml |
| Vender 20 Negronis, con 60 ml de mix + 30 ml de ginebra | 600 ml dentro del mix | 600 ml dentro del mix | 600 ml |
| Quedan 586.5 ml de mix | 293.25 ml equivalentes | 293.25 ml equivalentes | 0 ml |

Preparar es un traslado entre botellas y mix, no una segunda venta. El cóctel
consume el mix y su ginebra directa; no descuenta otra vez las botellas que
ya se usaron al producirlo.

Una diferencia real de −19 copas pasa a −24.833333 si faltan otros 350 ml del
insumo sin aparecer en el mix. Si esos 350 ml se trasladan a otro batch que
se cuenta físicamente, el faltante total continúa en −19. Corregir solo el
contador de producción tampoco debe crear ni borrar faltante total.

## Verificación

- Suite de dinero: 4664 comprobaciones, cero fallas. Incluye 15 regresiones
  nuevas de rendimiento, 700/750 ml, producción fraccionaria, copas distintas,
  faltante real frente a traslado, ficha local y desglose visible.
- Chrome: seis casos en 1440 y 390 px. Comprueba el resultado, cambios mediante
  el contador real del Paso 3 y el reporte, con los mismos equivalentes.
- Se revisó además el PDF del desglose generado con los datos de prueba.
- Supabase simulado; sin leer ni modificar inventarios reales del negocio.

[Resultado](inventario-prebatch-2026-10-23/resultado-1440.png) ·
[Reporte](inventario-prebatch-2026-10-23/reporte.png).

Para el registro del ejemplo, corregir el rendimiento de la subreceta a
700 ml y volver a calcular el resultado con el conteo físico real. Las
botellas cerradas se contabilizan por el contenido de su presentación; la
capacidad del envase no sustituye el rendimiento de la receta ni el conteo.
