# Inventarios: equivalencias, referencias de stock y costeo impreso

23 de octubre de 2026.

## Líquido abierto

El mismo líquido neto de la captura por peso o nivel se expresa en litros,
copas de la medida configurada en el insumo y onzas (29.5735 ml/oz). Las
botellas cerradas no se suman a esta equivalencia. Se actualiza al editar
la captura, tanto en búsqueda como en lista y galería.

Ejemplo: 952 ml = 15.8667 copas de 60 ml = 32.191 onzas. Un vino con copa
configurada en 150 ml usa esa medida; sin medida de copa se muestran litros
y onzas y no se inventa un tamaño de servicio.

## Stock

Cada insumo compara su existencia física disponible con los límites de la
presentación base del catálogo en esa sucursal. Se muestran estado, cantidad
disponible, mínimo e ideal/máximo. Los límites se expresan en unidades de
compra: botellas, piezas o paquetes. En alimentos, el contenido utilizable
(drenado si existe) convierte gramos/ml a paquetes. Las referencias de las
porciones de producción propia no sustituyen la presentación base.

- Bajo: existencia menor o igual al mínimo.
- Intermedio: sobre el mínimo y debajo del máximo.
- Ideal: igual o por encima del máximo.
- Sin parámetros: no hay una referencia configurada. Cero como máximo es el
  valor histórico de "sin máximo"; cero como mínimo se conserva.
- Con solo mínimo se puede señalar bajo/intermedio; no se inventa un ideal.
- Una captura vacía aparece pendiente de conteo; registrar un cero sí permite
  clasificar el producto como agotado.
- Límites inválidos/invertidos o contenido ausente se señalan para revisión.

La existencia usada para surtir es el insumo disponible por separado: el
producto ya incorporado en una subreceta se controla en el stock de esa
preparación. La conciliación y el reparto de prebatch mantienen sus cálculos.
La cantidad comparada se muestra explícitamente junto a la referencia.

El reporte conserva insumos agotados. Los compuestos conservan las alertas
individuales de sus miembros. Los estados y referencias aparecen en el paso
5, la galería, las existencias, su vista previa y los impresos de existencias
y desglose directivo. Se guardan ambos límites en las nuevas capturas como
respaldo; cuando el catálogo existe se consultan sus parámetros actuales.
El capital mínimo/máximo también usa el precio de la unidad de compra,
incluido el paquete completo en alimentos.

## Costeo impreso

Variedad y maduración aparecen debajo del nombre. Destilados, licores y vinos
se imprimen en dos renglones (copa/botella), con ocho columnas y manteniendo
el costo por onza, los factores, los refrescos a costo, el sugerido sin/con
servicio, la carta y la utilidad de las fórmulas existentes. Cada pareja de
renglones se agrupa para evitar dividirla entre hojas. Cervezas y refrescos
usan el segundo renglón para la presentación de compra y su referencia.
Se conservan títulos negros en negrita sobre gris claro.

## Verificación

- `node tests/money-tests.js`: 4,800 comprobaciones, cero fallas.
- `node tests/store-tests.js`: 84 comprobaciones, cero fallas.
- `ETAAX_PRUEBA_STOCK=1 node tests/probar-ventanas-insumos.cjs`: 12 escenarios
  en Chrome a 1440 y 390 px; peso, nivel, actualizaciones, unidades propias,
  agotados, estados, referencias e impresos. Se genera un PDF carta horizontal.
- Verificación de sintaxis, `git diff --check` y versiones de contenido.

El navegador utiliza Supabase simulado y bloquea peticiones externas; no se
modifican datos de clientes. Capturas y PDF de prueba en la carpeta homónima.
