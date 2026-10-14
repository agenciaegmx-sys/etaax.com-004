# Resumen financiero y metas sugeridas de KPIs

Se retomó el plan público del 13-oct-2026: Resumen como entrada de Salud
financiera, resultados primero, simulación opcional y dos páginas imprimibles
con explicación y decisiones. También se revisaron las notas locales de
continuidad y las reglas de clasificación y lectura completa del proyecto.

## Resultado aplicado

El nombre visible pasa a **Resumen financiero** en la página, reporte, portada
financiera, guía del hub, panel financiero global y navegación lateral. La ruta
`financiero/resumen.html`, permisos e identificadores del icono se conservan.

La primera vista muestra ventas, meta, comensales, cheque promedio, resultado
antes de apartados y utilidad disponible. El P&L conserva los clasificadores
compartidos, desgloses y subtotales. Sus porcentajes tienen base explícita de
**ingresos (ventas + otros)**. El Score queda como detalle secundario, sin
calificar lecturas incompletas, sin inventar metas y sin declarar salud cuando
no hay gastos pagados registrados.

**Simular** abre las columnas editables. El escenario conserva los registros
reales, admite limpiar cambios y se reinicia al cambiar periodo. Día, Semana,
Mes, Año y Rango comparten límites de calendario. Una meta de venta que solo
cubre algunos meses aparece como **parcial**; no se declara cumplimiento contra
un objetivo anual incompleto. Las metas de venta siguen la captura existente
de Ventas y su distribución por día.

Debajo aparecen cobros por efectivo/TPV/transferencia, anticipos aplicados,
desglose por cuenta, propinas, TPV por conciliar, pagos pendientes/programados,
compras de cocina/barra, nómina operativa/administrativa/socios e IMSS, impuestos
capturados, financieros, reservas y hasta tres oportunidades con evidencia y
una acción. En contexto global, los saldos bancarios invitan a elegir una
sucursal, conservando el alcance aprobado para Cuentas bancarias.

El reporte real imprime **dos páginas**: resultados y explicación/decisiones.
Una simulación abierta con cambios agrega una tercera página identificada como
escenario manual. Los avisos de lectura incompleta viajan en todas sus páginas.
Se verificó el PDF generado por Chrome: **dos páginas reales**, no solo dos
secciones HTML.

## Reglas de dinero y correcciones

- Ventas excluye propinas y otros ingresos. Los anticipos aplicados forman
  parte de la venta, pero se distinguen de los cobros actuales.
- **Resultado antes de apartados = ingresos − egresos pagados.**
  **Utilidad disponible = resultado − apartados reales del periodo.**
  Esta última conserva la conciliación con KPIs; no se presenta como saldo de
  caja ni banco.
- Comensales y cheque usan cortes comparables. Si hay venta o propina sin
  comensales, el cheque queda sin cifra. Se distingue promedio por día con
  corte y por día calendario.
- Compras de cocina y barra siguen siendo compras pagadas. Se mantienen fuera
  pedidos pendientes y propinas pagadas; no se usa inventario como consumo
  sin una conciliación que lo justifique.
- Socios se muestran por separado dentro del desglose sin mover pagos entre
  los cubos financieros históricos. IMSS se suma una sola vez.
- Impuestos y financieros se identifican como partes **ya incluidas** en los
  egresos; no se suman otra vez. No se reconstruye un IVA/ISR ausente.
- TPV por conciliar usa el neto esperado/conciliado de cada corte y los abonos
  correspondientes, incluidas propinas de tarjeta. Indica conciliación
  pendiente; no presume que el banco no pagó.
- Un desglose de cuentas que excede los totales del corte se marca inconsistente
  en lugar de inventar una compensación negativa.
- Se corrigió el desglose de comisiones bancarias: el total ya las incluía,
  pero faltaban en la lista. Ahora resultado, gasto variable y desgloses
  concilian también cuando hay comisión automática.
- Se corrigió el Score con una meta de utilidad cero: cumplir significa no
  tener pérdida; la regla de gasto cero mantiene su sentido original.

Los enlaces a Ventas/KPIs/Gastos conservan tipo y fechas mediante
`financiero/periodo-enlace.js`; Año se abre como rango en destinos sin esa
pestaña. El helper respeta sucursales bloqueadas y no amplía permisos.

## Definir meta en cada tarjeta de KPIs

Las ocho tarjetas tienen **Definir meta** o **Editar meta** y una sugerencia
visible. El diálogo muestra fuente, contexto, sugerencia y valor editable.
**Usar sugerencia** llena el campo; **Guardar meta** actualiza solo la clave
seleccionada a través del helper de persistencia existente. Cancelar conserva
las metas. Se preservan los seis objetivos originales y las claves adicionales
del documento. La meta de Utilidad sigue compartida con la vista original.

Las sugerencias **no se aplican automáticamente** y nunca se presentan como
metas ya guardadas. Los campos permiten cero y respetan validación y foco; no
se guarda cuando cambia el negocio activo con el diálogo abierto.

| Indicador | Sugerencia inicial y su alcance |
|---|---|
| Cocina | Límite de 35% del referente de ventas de alimentos, adaptado a su participación en ventas totales |
| Barra | 22% de ventas de bebidas como punto de partida, adaptado a la participación de barra; el referente es de programas alcohólicos |
| Staff cost | Máximo 35%, propuesta de partida ante datos internacionales de nómina y beneficios |
| Prime cost | Máximo 65%, referencia de servicio rápido; aquí sigue siendo compras y nómina pagadas |
| Utilidad | Mínimo 5%, propuesta para disponibilidad; el referente de industria es previo a impuestos y no equivale exactamente a esta base |
| Cheque promedio | $300 MXN por comensal, punto de partida desde una encuesta mexicana puntual de junio 2026 |
| Propinas promedio | Parámetro interno: 10% del cheque objetivo, por comensal; es voluntaria y no se presenta como media de mercado |
| Consumo extra | Tolerancia interna inicial de 2%; no se presenta como media de mercado y el valor real sigue pendiente |

### Mezcla registrada y estimada

La revisión completa encontró que los cortes **sí guardan** `alimentos`,
`bebidas` y `otros`. La entrega anterior pasó por alto estos campos. Ahora
`EtaaxCore.ventasPorArea` solo acepta la mezcla registrada cuando **cada corte
con venta tiene valores válidos y su suma coincide con la venta por medios y
anticipos**. Un campo vacío, un registro antiguo o un descuadre impide dar esa
mezcla por completa.

Con mezcla completa, cocina/barra adaptan la sugerencia al porcentaje real de
participación; con mezcla incompleta, el diálogo declara un **supuesto editable
70/30**. Editar una mezcla registrada la convierte en supuesto de planeación.
No se inventa una venta por área ni se cambia el denominador de las tarjetas
existentes: ambas continúan mostrando compras sobre ventas totales.

### Fuentes verificadas en esta entrega

- [National Restaurant Association, datos operativos publicados en agosto 2025](https://restaurant.org/research-and-media/media/press-releases/new-resource-from-national-restaurant-association-provides-insights-into-operational-realities/): muestra estadounidense, costos combinados de servicio rápido y diferencias por formato.
- [NRA, nómina y rentabilidad, octubre 2025](https://restaurant.org/research-and-media/research/restaurant-economic-insights/analysis-commentary/elevated-labor-costs-had-a-significant-impact-on-restaurant-profitability-in-2024/): referencia de nómina con beneficios; no una meta universal para México.
- [NRA, contexto de costos consultado en octubre 2026](https://restaurant.org/research-and-media/research/inflation/): margen típico previo a impuestos usado como orientación, sin equipararlo a disponibilidad tras reservas.
- [Sculpture Hospitality, alimentos](https://www.sculpturehospitality.com/blog/what-is-the-average-restaurant-food-cost): guía publicada en septiembre 2024, vigente como referencia consultada; usa consumo y ventas de alimentos.
- [Sculpture Hospitality, barra, julio 2025](https://www.sculpturehospitality.com/blog/what-is-the-average-liquor-cost-for-a-bar): referencia por mezcla de bebidas; no se extrapola como media de cafeterías.
- [CANIRAC, junio 2026](https://portal.canirac.org.mx/noticias/canirac-reporta-aumento-focalizado-en-restaurantes-durante-el-arranque-del-mundial-2026-el-dia-del-padre-impulso-el-consumo/): encuesta de una temporada concreta durante el Mundial; el diálogo indica ese alcance.
- [Profeco, mayo 2026](https://mundialsocial.profeco.gob.mx/blog/propina-voluntaria/): carácter voluntario de la propina; no se le atribuye el parámetro interno del 10%.

## Pendientes que se mantienen explícitos

Consumo real vs. recetas sigue sin cifra: el inventario actual no suministra
un costo de consumo comparable con cobertura completa de áreas y periodo.
No se interpreta producción, merma, cortesía o faltante como COGS sin definir
su tratamiento. Separar impuestos devengados, IVA no desglosado y nuevas reglas
de clasificación funcional de socios requiere definir/capturar esa información.
Los parámetros sugeridos quedan preparados para el ajuste posterior solicitado
por el usuario, con sus diferencias de país, formato y base de medición visibles.

## Archivos y caché

Implementación: `financiero/resumen.html`, `resumen-panel.css`,
`financiero/kpis.html`, `metas-referencia.js/.css`, `periodo-enlace.js` y
`etaax-core.js`. Nombres de entrada actualizados en `hub.html`, `hub-modulos.js`,
`financiero/index.html` y `financiero/nav.js`. Ventas y Gastos reciben el helper
de filtros; no se reformuló su resto de la lógica.

El núcleo comparte `?v=financiero-2` en sus 17 consumidores; el nav financiero
usa `?v=resumen-2`, el hub carga `hub-modulos.js?v=14`, y los estilos nuevos de
Resumen y Metas usan `v=2`. Hay cambios acumulados de otras tareas en estos
archivos: no atribuir todo el diff a esta entrega ni restaurarlos completos.
No hubo commit, push, despliegue, migración ni escritura de datos reales.

## Validación y evidencia

- **4,476** comprobaciones de dinero, sin fallas. Se agregaron casos numéricos
  del modelo, comisiones reales, socios/IMSS, anticipos, metas cero, mezcla y
  año. Las pruebas que buscaban fórmulas copiadas en la UI ahora ejercitan el
  núcleo y el reporte real; se actualizaron rótulos por el cambio solicitado.
- **84** comprobaciones del almacén, sin fallas.
- **59** casos de KPIs en Chrome: ocho diálogos, cancelar, sugerir, guardar,
  conservación de otras metas, campos desconocidos, recarga, estados de datos,
  reportes y límites visuales del diálogo en PC/celular.
- **33** casos de Resumen en Chrome: resultados, desgloses, reservas,
  comisiones, metas, periodos, sucursales, fallos, Score, simulación, dos páginas
  PDF y enlaces al filtro real de Ventas; 1440/390/320 px, ambos temas.
- **58** casos de cuenta/navegación, sin fallas.
- Sintaxis de núcleo, helpers, pruebas y cuatro páginas financieras;
  `git diff --check`.

Los navegadores usan Supabase simulado, perfiles aislados y bloqueo de toda
petición fuera del servidor local. La persistencia de metas se verifica en
el doble de servidor; no se usaron cuentas o datos de producción.

[Evidencia del Resumen y sus metas](continuidad-codex-2026-10-13/resumen-financiero/):
PDF de dos páginas, capturas de escritorio/celular, diálogo de meta y logs.
Los comandos reproducibles son `node tests/probar-resumen-financiero.cjs` y
`node tests/probar-kpis.cjs`; `CHROME_BIN` cambia el navegador y `KPI_CAPTURES`
el destino de evidencia. `KPI_FONTS` acepta fuentes locales para la revisión
visual sin acceder a servidores externos.
