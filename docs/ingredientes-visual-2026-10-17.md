# Contenido de compra y filas del escandallo

## Resultado

El editor conserva el nombre **Contenido de compra / pz / granel** en abarrotes, frutas y proteínas. El conteo de piezas no cambia ese contenido. La explicación muestra la división en el sentido que produce un peso individual:

> 166 Zarzamoras en 1 KG de compra. 1 KG ÷ 166 piezas = 6.0241 G por pieza · Costo por pieza: $0.994.

El ejemplo utiliza un costo de compra de $165. Abarrotes conserva la prioridad de masa drenada cuando existe; frutas y proteínas mantienen su referencia de compra por peso/volumen o por pieza. El costo y peso de la subunidad llegan con la misma referencia a recetas e inventarios.

Para las fichas anteriores de frutas/proteínas se reconoce el caso concreto en el que se guardó, por ejemplo, `160 KG = 160 × 1 KG`, aunque la compra era de 1 KG. Se recupera esa referencia solo cuando coincide exactamente con la compra o con una unidad de compra. No se reinterpreta un contenido individual válido, como 12 cortes de 2 KG en una compra de 24 KG. La lectura de la fórmula no modifica el registro; el editor trabaja sobre su copia y guardar persiste el resultado.

Las filas de ingredientes tienen anchos definidos, campos de 44 px con espacio interior, nombres más amplios, descripciones legibles, cantidades y dinero alineados a la derecha, cifras tabulares y un símbolo monetario dentro del campo. La unidad dispone de espacio para nombres como ZARZAMORA y una flecha consistente. Ficha y eliminar tienen botones alineados al final.

En contenedores de hasta 880 px cada fila se presenta como una tarjeta con etiquetas visibles. Se conservan los inputs, selectores, orden de captura y eventos originales. No se cambian las fórmulas de costo del escandallo ni sus acciones de búsqueda, arrastre, ficha, agregar, eliminar y guardar.

## Verificación

- `node tests/money-tests.js`: 4,603 comprobaciones, incluyendo seis nuevas para contenido de compra en frutas/proteínas, el patrón anterior de zarzamoras y la leyenda de división. El buscador carga también el escape HTML real de `security.js`, usado al dibujar valores en los inputs.
- `node docs/ingredientes-visual-2026-10-17/revisar-ingredientes.cjs`: 25 casos con Chrome real, Supabase simulado y peticiones externas bloqueadas. Cuatro tipos de escandallo y un caso de frutas en 1,440, 1,040, 768, 390 y 320 px. Comprueba geometría, etiquetas, conservación del foco, cantidades, unidades, acciones de filas, persistencia y reapertura. El arrastre se ejercita cuando las dos filas destino están visibles.
- `RECETAS_EXTRAS_ONLY=1 RECETAS_WIDTHS=1440,390 node docs/recetas-visual-2026-10-17/revisar-recetas-ui.cjs`: dos casos adicionales de tema claro, costeo y editor abierto desde carátula.
- `INGREDIENTES_FRUTA_ONLY=1 INGREDIENTES_WIDTHS=1440,390 node docs/ingredientes-visual-2026-10-17/revisar-ingredientes.cjs`: verificación y capturas enfocadas del campo y texto de compra, incluyendo guardar y recargar.
- Sintaxis, huellas de caché y `git diff --check`. Los candados de dinero y almacenamiento se vuelven a ejecutar desde `.githooks/pre-push`.

No se modificaron datos en producción. Las capturas usan datos ficticios.

## Capturas

- [Ingredientes de bebidas, escritorio](ingredientes-visual-2026-10-17/ingredientes-bebidas-1440.png)
- [Ingredientes de bebidas, móvil](ingredientes-visual-2026-10-17/ingredientes-bebidas-390.png)
- [Subreceta de alimentos, escritorio](ingredientes-visual-2026-10-17/ingredientes-sub-alimentos-1440.png)
- [Subreceta de alimentos, móvil](ingredientes-visual-2026-10-17/ingredientes-sub-alimentos-390.png)
- [Contenido de compra y cálculo, escritorio](ingredientes-visual-2026-10-17/fruta-contenido-compra-1440.png)
- [Contenido de compra y cálculo, móvil](ingredientes-visual-2026-10-17/fruta-contenido-compra-390.png)
