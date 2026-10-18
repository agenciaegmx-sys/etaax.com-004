# Abarrotes: empaque, contenido útil y piezas interiores

El conteo de cerezas, huevos o tostadas se mezclaba con el contenido capturado: cambiar la cantidad multiplicaba `contNeto` y desplazaba el costo por kilo. Ahora Abarrotes captura el contenido neto del empaque completo y deriva el peso de cada unidad interior.

## Criterio de cálculo

- `contNeto` conserva el contenido por empaque o unidad de referencia. Cambiar `unidadesPorPieza` no modifica ese dato.
- La masa drenada positiva determina el contenido útil. Si está vacía o en cero, se usa el contenido neto.
- Compra por PZA: importe con impuestos / cantidad de empaques = costo por empaque.
- Compra por KG/G/LT/ML: se respeta la cantidad y la unidad de compra, incluso si la presentación se llama Bolsa, Costal o Granel. El contenido describe una unidad de referencia. Por ejemplo, 2 KG comprados por $60, con 1 KG de referencia y 16 huevos, cuestan $30 por referencia y $1.875 por huevo.
- Costo por KG/LT = costo por empaque o referencia / contenido útil expresado en KG/LT.
- Costo por unidad interior = costo por empaque o referencia / cantidad de unidades interiores.
- Peso o volumen individual = contenido útil / cantidad de unidades interiores.
- Sin peso o volumen capturado no se presenta un precio ficticio por kilo/litro. Los cálculos conservan ocho decimales; la pantalla redondea para consulta.

Ejemplos con precio final de $30:

| Compra | Contenido neto | Masa drenada | Piezas interiores | Costo empaque/referencia | Costo por KG | Costo individual | Peso individual |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 bote | 2.1 KG | 900 G | 150 cerezas | $30.00 | $33.33 | $0.20 | 6 G |
| 1 bote | 2.1 KG | Sin dato | 150 cerezas | $30.00 | $14.29 | $0.20 | 14 G |
| 1 KG a granel | 1 KG | Sin dato | 16 huevos | $30.00 | $30.00 | $1.875 | 62.5 G |

## Alcance

La fórmula vive en `EtaaxCore.costosAbarrote`. El editor actualiza costos, peso individual y leyendas al teclear, sin repintar el formulario ni perder el foco. Quitar el precio limpia los costos derivados. Quitar la masa drenada también borra su leyenda anterior.

Escandallos e inventarios usan el mismo contenido útil para convertir unidades interiores. Un bote de 900 G útiles equivale a 150 cerezas de 6 G y conserva su valuación de $30.

Las presentaciones anteriores conservan el significado de su `contNeto`: el total del empaque. Por ejemplo, 11 bolsas de 40 tostadas de 25 G siguen siendo 1,000 G por bolsa, $49 por bolsa y $1.225 por tostada para una compra de $539. En Abarrotes se deja de capturar `contSub`; se deriva el contenido individual. Otros tipos de insumo mantienen su captura anterior.

No se modificaron registros en producción ni el esquema. Al abrir una presentación con precio se recalcula la vista; guardar persiste el desglose. Si un contenido ya estaba mal capturado, debe corregirse: no se divide automáticamente un peso guardado suponiendo cuál era la intención.

Se agregaron versiones por contenido para `app.js` y para la carga dinámica del editor global, evitando reutilizar el código anterior desde caché.

## Verificación

- `node tests/money-tests.js`: 4,597 comprobaciones, incluyendo 26 nuevas para Abarrotes y una para distinguir los dos archivos `app.js` al versionar. Ejecuta las funciones reales del núcleo, editor, escandallo e inventario.
- `node docs/abarrotes-calculo-2026-10-17/revisar-abarrotes.cjs`: Chrome real en 1,440 y 390 px; captura en varias teclas, conservación del foco, precio/peso, masa drenada y su fallback, guardado/reapertura, dos kilos a granel y limpieza de precio. Supabase simulado y red externa bloqueada.
- `node versionar.js --revisar`, revisión de sintaxis y `git diff --check`.
- Los candados de dinero y almacenamiento se ejecutan además desde `.githooks/pre-push` antes de publicar.

Capturas del navegador:

- [Cerezas en escritorio](abarrotes-calculo-2026-10-17/cerezas-drenadas-1440.png)
- [Cerezas en móvil](abarrotes-calculo-2026-10-17/cerezas-drenadas-390.png)
- [Granel por kilo en escritorio](abarrotes-calculo-2026-10-17/huevos-granel-1440.png)
- [Granel por kilo en móvil](abarrotes-calculo-2026-10-17/huevos-granel-390.png)
