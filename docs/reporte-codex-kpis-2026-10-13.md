# KPIs: tarjetas del periodo y vista por conceptos

Se aplicó la referencia del usuario al tablero real de `financiero/kpis.html`:
ocho tarjetas, cifra principal, meta, estado, barra de resultado en cian y marca
de meta en terracota. **Utilidad** sustituye a “Ganancia de la operación”.
Debajo continúan los seis conceptos originales, su distribución, desgloses,
metas, barra apilada e historial mensual.

## Datos y límites

Los valores salen de las colecciones actuales del negocio, filtradas por el
periodo y la sucursal seleccionados. No se incorporaron los números de la
maqueta ni se modificaron datos de producción.

| Tarjeta | Base real del cálculo |
|---|---|
| Costo de cocina | Compras pagadas de alimentos clasificadas como variables / ventas totales |
| Costo de barra | Compras pagadas de bebidas e insumos de barra clasificadas como variables / ventas totales |
| Staff cost | Nómina pagada operativa y administrativa, incluidos socios e IMSS / ventas totales |
| Prime cost | Compras de cocina y barra + nómina e IMSS / ventas totales |
| Utilidad | Ingresos menos egresos y apartados reales del periodo, dividido entre ingresos |
| Cheque promedio | Ventas / comensales registrados en los cortes |
| Propinas promedio | Propinas de efectivo y tarjeta / comensales registrados |
| Consumo extra vs. receta | Sin cifra: faltan consumos reales y teóricos valorizados comparables |

La revisión posterior encontró campos de ventas de alimentos/bebidas en los
cortes; no todos los registros los completan o concilian, y no hay un número
de tickets cerrados. Véase la corrección y el uso de esa mezcla en el
[reporte del Resumen financiero](reporte-codex-resumen-financiero-2026-10-13.md). Por eso se usan **Costo de cocina**, **Costo de barra** y **Cheque
promedio**, con fórmulas visibles, en lugar de presentar esos datos como Food
cost, Bar cost o Ticket promedio de la referencia. Las compras son flujo del
periodo; no se confunden con consumo de inventario. Las ventas mantienen la
base existente del corte y excluyen propinas; no se inventa una venta neta de
IVA que el corte no desglosa.

Un corte con ventas o propinas y sin comensales válidos deja ambos promedios
sin cifra. Los porcentajes sin denominador, las lecturas incompletas y las
metas no disponibles permanecen neutrales. El lector compartido agrega el
motivo del fallo al nombre de la fuente: se reconoce también `gastos (motivo)`,
para que un fallo de lectura no parezca un costo cero con meta cumplida.

## Metas, reportes y correcciones

Las metas nuevas se editan en “Metas de estos indicadores” y se guardan con el
botón existente **Guardar metas**, a través de `sbUpsertDoc` y su cola compartida.
No se incorporan metas de ejemplo. Staff cost toma las dos metas originales de
nómina cuando no tiene una propia; Prime cost conserva la meta anterior si
existe. Utilidad comparte la meta original de utilidad.

Se corrigió el llenado del formulario tras la lectura de metas: antes podía
mostrar defaults aunque las metas guardadas ya estuvieran en memoria. Ahora
se cargan los valores reales, se admite cero, se validan límites y se preservan
los campos adicionales del documento, incluidos los objetivos de otras vistas.
Guardar está deshabilitado hasta completar la lectura de metas. El mensaje
confirma la actualización local y su sincronización pendiente, sin afirmar
una confirmación del servidor que el helper no devuelve.

También se corrigió el filtrado de apartados por sucursal en **KPIs y Resumen**.
Ambos sumaban reservas de todo el negocio incluso al seleccionar una sucursal;
los desgloses ya filtraban correctamente. Ahora total y desglose usan el mismo
ámbito, y la utilidad de ambas pantallas sigue cuadrando peso por peso.

El reporte impreso incluye las ocho tarjetas y conserva los seis conceptos
originales; reutiliza el mismo modelo de valores, metas y estados. Los fallos
de lectura también se declaran en el papel.

## Archivos de esta entrega

- `financiero/kpis.html`: tarjetas, metas, modelo de presentación y reporte.
- `financiero/kpis-panel.css`: diseño y adaptación a escritorio/celular,
  ambos temas, movimiento reducido y modal de desglose sobre el encabezado.
- `etaax-core.js`: `indicadoresRestaurante`, reutiliza los clasificadores
  existentes y concentra los cálculos; no cambia las fórmulas anteriores.
- `financiero/resumen.html`: filtro de sucursal de apartados.
- `tests/probar-kpis.cjs` y `tests/fixtures/kpis.cjs`: negocio ficticio,
  navegador real y servidor local, sin solicitudes externas.

Los 17 HTML que consumen el núcleo usan la misma URL `etaax-core.js?v=kpis-1`
para evitar una copia anterior en caché. El cambio de esta entrega en los
otros consumidores es esa versión; sus demás diferencias pertenecen al
trabajo acumulado. No se hicieron commit, push, despliegue ni migraciones.

## Validación

- `node tests/money-tests.js`: **4,449 comprobaciones, cero fallas**, incluido
  el acuerdo entre Resumen y KPIs para negocio global y sucursal.
- `node tests/store-tests.js`: **84 comprobaciones, cero fallas**.
- `node tests/probar-cuenta-header.cjs`: **58 casos, cero fallas**.
- `node tests/probar-kpis.cjs`: **52 casos, cero fallas**. Cubre importes
  conocidos, gastos pendientes, IMSS, propinas, reservas, sucursales, día,
  semana, mes y rango, pérdidas, metas cero, persistencia simulada al recargar,
  rechazo de metas inválidas, conservación de campos, fallos de lectura,
  comensales incompletos, carga inicial, impresión y desgloses.
- Anchos de 1440, 1080, 390 y 320 px en claro y oscuro, sin desbordamiento
  horizontal; inspección visual con fuentes locales.
- Sintaxis del núcleo, scripts inline de KPIs/Resumen y pruebas; `git diff --check`.

Las cifras de las capturas son exclusivamente del negocio ficticio. La prueba
incluye ventas de $300,000, ingresos de $312,000, egresos de $240,000 y apartados
de $4,200: utilidad disponible de $67,800 (21.7%), Prime cost de 59%, cheque de
$300 y propinas de $20 por comensal.

La evidencia está en [kpis](continuidad-codex-2026-10-13/kpis/):
[tablero oscuro completo](continuidad-codex-2026-10-13/kpis/kpis-completo-dark.png),
[tablero claro completo](continuidad-codex-2026-10-13/kpis/kpis-completo-light.png),
[cellular claro](continuidad-codex-2026-10-13/kpis/kpis-390-light.png),
[conceptos a 320 px](continuidad-codex-2026-10-13/kpis/kpis-conceptos-320-dark.png)
y los cuatro logs de pruebas.

Para repetir la revisión con fuentes locales, se puede usar `KPI_FONTS` con
un directorio que contenga `fonts.css` y sus fuentes. `KPI_CAPTURES` permite
elegir el destino de las capturas. Sin esas opciones, la prueba sigue siendo
local y usa las fuentes disponibles en el equipo. `CHROME_BIN` cambia el
binario de Chrome/Chromium. El helper de Supabase es simulado; todas las
peticiones fuera del origen local se bloquean y hacen fallar la prueba.

## Continuación

El [Resumen financiero y las metas sugeridas](reporte-codex-resumen-financiero-2026-10-13.md)
se implementaron después: botones de meta por tarjeta, fuentes verificadas y
mezcla registrada cuando concilia. Este reporte conserva la entrega inicial;
las cifras de validación más recientes están en esa continuación.
