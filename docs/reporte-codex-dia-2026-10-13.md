# Entrega del día para Claude · ETAAX

Fecha: **13 de octubre de 2026**. Workspace:
`/Users/macbookpro/Proyectos/etaax.com-004-2`.

El usuario pidió este reporte para que Claude prepare el **commit y push de la
actualización grande**. El trabajo de Codex está terminado en el workspace.
Este documento consolida el resultado final, separa las aportaciones de
Claude y enumera lo que sigue pendiente. Los reportes anteriores describen
etapas intermedias; sus cantidades de pruebas, versiones y pendientes no
sustituyen el estado final de aquí.

## Estado de Git y publicación

- Rama actual: `main`. HEAD local: **`e3e9d6e`**, «Completar cuenta y plan y
  unificar el subheader del hub».
- Frente a la referencia local `origin/main`: **0 detrás, 1 adelante**. No se
  hizo fetch en este cierre; Claude debe comprobar el estado remoto vigente
  antes de publicar. Ese commit local también viajará en el push.
- Los cambios posteriores al checkpoint están **sin commit**, con numerosos
  archivos nuevos. Codex no hizo push ni despliegue en esta continuación.
- Hay trabajo de ambos agentes en los mismos archivos. No restaurar archivos
  completos, borrar recursos nuevos ni atribuir todo el diff a Codex.
- No se añadieron migraciones, se cambiaron políticas de servidor ni se
  ejecutaron escrituras de producción durante estas tareas.
- El proyecto publica la raíz estática en Netlify al hacer push a `main`;
  no tiene bundler ni paso de build. `docs/*` está bloqueado públicamente por
  las reglas existentes de Netlify; las imágenes de `guia/` sí son recursos
  del producto.

El [inventario de Git](inventario-actualizacion-2026-10-13.txt) conserva las
rutas modificadas y nuevas del cierre. Verificarlo contra `git status` al
preparar el commit: otro agente puede seguir trabajando después de esta entrega.

## 1. Header, cuenta y hub

El checkpoint local ya contiene el encabezado compartido, Mi cuenta y Plan y
facturación. No volver a implementar estos destinos: **ya forman parte de
`e3e9d6e`**. La cuenta separa identidad del titular y datos del negocio; los
cambios de credenciales requieren su contraseña actual. Plan usa los lectores
y precios existentes, sin crear otro modelo de suscripción.

Después se aplicó la paleta cian/terracota/crema al login y hub, con fondos
sólidos, contornos finos y variantes del tema claro. Se ordenó el hub como
sucursales → accesos globales → guía de operación. Ajustes queda como icono,
Administrar/ver sucursal conserva su acción y Añadir sucursal usa verde. El
movimiento acompaña al cursor y respeta movimiento reducido y entrada táctil.

El subheader identifica negocio o sucursal según contexto, con logo circular
y una sola etiqueta de ubicación. El selector de sucursal conserva el flujo
existente, estado activo, permisos y contexto por pestaña. Sus diálogos manejan
cancelación, teclado y foco.

**Último cambio del login:** el botón central sin sesión muestra el isotipo
original `marca/etaax-isotipo.svg` y abre **`/index.html`**, la landing pública.
Tiene nombre accesible y área de 44 × 44 px. La navegación con sesión conserva
su destino correspondiente.

## 2. Globales, módulos y diseño compartido

- Catálogos globales abre un modal de **seis** accesos: Colaboradores,
  Horarios, Recetas/sub-recetas, Insumos, Proveedores y Clientes. Recetas y
  sub-recetas comparten una entrada.
- Financiero global tiene **cinco** accesos: Resumen financiero, Estadísticas,
  Ventas, Gastos y KPIs. Cuentas bancarias sigue en sucursal.
- Los cuatro módulos se presentan en este orden: Control administrativo,
  Recetas e Insumos, Salud financiera, Aprende y analiza. La selección se
  conserva por pestaña y respeta las herramientas permitidas.
- El hub actual es una **guía visual por herramientas**. Las filas muestran
  funciones y capturas; **Ir al módulo** abre la portada. No convertir las
  filas otra vez en enlaces. La ruta directa de Escandallos conserva
  `recetas/index.html?escandallos=1`.
- `etaax-sidebar.*` y `etaax-modulos-ui.*` unifican barras, tarjetas,
  subheaders, identidad, acciones y temas. Se integraron en 29 páginas con
  contexto; 24 menús laterales existentes reciben el diseño compartido.
- El cambio de módulo conserva negocio/sucursal y, en recetas, pasa por la
  protección de cambios sin guardar. Las vistas embebidas conservan su forma
  sin duplicar barras.
- Los SVG canónicos están en `iconos/catalogos`, `financieros`, `modulos` y
  `subheader`; el sprite se genera con `node iconos/generar.js`.

**Aportación posterior de Claude, preservada:** corrigió Staff a 320 px, la
barra lateral tapada por el subheader, el espacio de títulos, portadas directas
al cambiar de módulo, encabezados y jerarquía de botones. Los contornos de
sucursal quedaron en **cian**, y la selección del módulo también. Sus cambios
superan algunos reportes iniciales de Codex. El pendiente de Staff que aparece
en el reporte de pausa **ya se resolvió**, según la entrega de Claude y sus
dos revisores. No volver a presentarlo como un fallo vigente.

## 3. Guías con capturas y visor ampliado

El álbum tiene **52 PNG**, repartidos entre nueve herramientas. Se conservaron
las capturas entregadas y sus proporciones; se eliminó el QR duplicado de Menú.

| Herramienta | Capturas | Aportación |
|---|---:|---|
| Ventas y gastos diarios | 10 | Claude, antes de esta continuación |
| Gestión de colaboradores | 8 | Claude, antes de esta continuación |
| Proveedores | 3 | Codex |
| Clientes | 3 | Codex |
| Gestión de menú | 3 | Codex |
| Escandallos | 7 | Codex |
| Insumos | 7 | Codex |
| Inventarios | 7 | Codex |
| Requisiciones | 4 | Codex |

Los **34 PNG añadidos por Codex** completan Control administrativo y Recetas
e Insumos. Los nombres, pasos y pies están en `hub-modulos.js` y
[`guia/LEEME.md`](../guia/LEEME.md). Las herramientas aún sin imágenes conservan
«Captura en camino». Las capturas de prueba de KPIs/Resumen están en `docs/`,
no se incorporaron como nuevas fotos del álbum público.

Tocar una captura abre el visor flotante: imagen completa, pie, contador,
flechas y teclado, **Ver detalle** con desplazamiento, **Ajustar imagen**,
cierre por ×/Escape/fondo, foco contenido y restaurado. Al cerrar conserva el
paso de la fila. Se corrigió la carrera de cerrar/reabrir inmediatamente.

**Bug del catálogo flotante de recetas:** el header compartido, a 900, tapaba
el catálogo, a 200. Catálogo queda a **1000**, ficha/edición a **1010** e
impresión/vinculación a **1020**; se conservaron las capas propias del editor.
Los filtros y acciones envuelven en móvil. Se probó con el documento real,
clic efectivo, minimizar/restaurar, detalles, impresión y regreso al catálogo.

## 4. Nuevo tablero de KPIs

Se replicó la referencia con ocho tarjetas: cifra, meta, estado, barra actual
cian y marca de meta terracota. **Utilidad** reemplaza Ganancia de la operación.
Debajo permanecen los **seis conceptos originales**, distribución, metas,
desgloses e historial. El impreso presenta ambas vistas.

| Tarjeta | Base que realmente tiene el sistema |
|---|---|
| Costo de cocina | Compras pagadas clasificadas de alimentos / ventas totales |
| Costo de barra | Compras pagadas clasificadas de barra / ventas totales |
| Staff cost | Nómina pagada, socios e IMSS / ventas totales |
| Prime cost | Compras clasificadas + nómina e IMSS / ventas totales |
| Utilidad | Ingresos − egresos pagados − apartados reales; % sobre ingresos |
| Cheque promedio | Ventas / comensales de cortes comparables |
| Propinas promedio | Propinas / comensales de cortes comparables |
| Consumo extra vs. receta | Sin cifra hasta disponer de consumo real/teórico comparable |

Las cifras salen del negocio, sucursal y periodo seleccionados; nunca de la
maqueta. Se usa **cheque por comensal**, porque no hay tickets cerrados. Las
compras no se presentan como consumo de inventario. Lecturas incompletas,
denominadores ausentes y comensales incompletos quedan neutrales.

Se corrigió la carga del formulario de metas, admisión de cero, validación,
conservación de otras claves y disponibilidad del guardado. **KPIs y Resumen
ahora filtran los apartados por la misma sucursal**, conciliando su utilidad.

## 5. Definir/Editar meta por tarjeta

Las ocho tarjetas tienen CTA propio. El diálogo muestra sugerencia, contexto,
fuente, objetivo actual y valor editable. **Usar sugerencia** solo llena el
campo; **Guardar meta** actualiza únicamente la clave elegida por el helper
existente. Cancelar no escribe. Utilidad comparte la meta del bloque original.
Se preservan las metas guardadas y los campos adicionales del documento.

Las propuestas iniciales están preparadas para el posterior ajuste pedido:
cocina 35% de ventas de alimentos adaptado a su mezcla; barra 22% de bebidas
adaptado a su mezcla; staff 35%; prime 65%; utilidad 5%; cheque $300 MXN por
comensal. Propina sugerida de 10% del cheque objetivo y extra de 2% son
**parámetros internos**, no promedios de mercado. Las sugerencias no se guardan
automáticamente.

El diálogo enlaza las referencias consultadas de NRA, Sculpture Hospitality,
CANIRAC y Profeco, y explica país/formato/base. No tratar los referentes de
consumo como equivalentes a compras, ni margen previo a impuestos como
equivalente exacto a utilidad disponible. La encuesta mexicana del cheque es
puntual, no una media universal. Véanse las
[fuentes y límites completos](reporte-codex-resumen-financiero-2026-10-13.md#fuentes-verificadas-en-esta-entrega).

**Corrección respecto al reporte inicial de KPIs:** el corte sí guarda
`alimentos`, `bebidas` y `otros`. `EtaaxCore.ventasPorArea` acepta la mezcla
registrada solo si todos los cortes con venta tienen campos válidos y su suma
concilia con venta por medios y anticipos. Si falta cobertura se muestra un
supuesto editable **70/30**; editar la mezcla registrada la convierte en
supuesto. El denominador de las tarjetas sigue siendo ventas totales.

## 6. Resumen financiero

Se recuperó el plan previo de continuidad y se renombró **Resumen de resultados
→ Resumen financiero**, conservando `financiero/resumen.html` y permisos.

- Resultados primero: ventas, meta, comensales, cheque, resultado antes de
  apartados y utilidad disponible. Promedio por día con corte y por calendario
  se distinguen.
- P&L compacto con cifras reales y porcentajes explícitos sobre ingresos
  (ventas + otros). **Simular** abre edición opcional, conserva los registros
  reales y permite limpiar; el escenario se reinicia al cambiar periodo.
- Día, Semana, Mes, **Año** y Rango. Metas de venta con meses faltantes se
  marcan parciales, sin declarar cumplimiento anual contra una base incompleta.
- Explicación con cobros por medio/cuenta, anticipos aplicados, propinas,
  TPV por conciliar, pendientes/programados, compras por área, nómina
  operativa/administrativa/socios, IMSS, impuestos, financieros y reservas.
- Hasta tres oportunidades con evidencia, importe cuando corresponde y
  acción hacia la pantalla existente. Score secundario y neutral ante
  lecturas incompletas, metas ausentes o falta de gastos pagados.
- Enlaces a Ventas/KPIs/Gastos conservan fechas, tipo y sucursal mediante
  `periodo-enlace.js`, respetando sucursales bloqueadas. Año pasa como rango
  cuando el destino no tiene pestaña anual.
- Reporte de **dos páginas reales de PDF**: resultados y explicación/decisión.
  Solo un escenario manual abierto con cambios añade una tercera página.
  Los avisos de datos incompletos también se imprimen.

Se corrigieron la ausencia de comisiones automáticas en el desglose, la regla
de Score con meta de utilidad cero y la prioridad de clasificación del detalle
financiero frente a IMSS. Impuestos, IMSS y financieros se muestran sin
sumarlos dos veces. Un desglose de cuentas que excede el corte se señala; TPV
pendiente significa **por conciliar**, sin presumir que el banco no pagó.

La lógica compartida nueva vive en **EtaaxCore**: `indicadoresRestaurante`,
`ventasPorArea`, `metaRestaurante`, `sugerenciasRestaurante` y
`detalleResumenFinanciero`, más soporte de Año y corrección de meta cero.
No copiar fórmulas financieras a la UI.

## 7. Qué pertenece a Claude y qué no se cerró

Además del pulido compartido, Claude implementó la presentación de novedades
en `novedades.js`, su álbum y pruebas. **Preservarlo.** El estado actual tiene
17 PNG en `novedades/`, y el anuncio automático conserva **`ANUNCIAR = false`**.
La documentación histórica que decía que faltaban todas las fotos está
superada. El contenido y el encendido del anuncio se deben revisar como parte
de la publicación; Codex no lo activó ni atribuye esa implementación a sí mismo.

Pendientes reales para futuros bloques:

1. **Consumo real vs. recetas:** falta costo de consumo comparable con cobertura
   por área/periodo. No sustituirlo por compras, merma o faltantes sin definir
   su tratamiento.
2. **Refinar parámetros sugeridos** por formato de restaurante/bar/café y datos
   propios. Ya existe el mecanismo de edición; no es un pendiente del botón.
3. **Ventas:** la revisión del día documentó doble conexión de guardado de otros
   ingresos, caché recortada por sucursal, lecturas sin paginar, metas de rangos
   e impresión desalineadas y proyecciones de meses cerrados. Esta entrega solo
   conectó filtros entrantes; **no afirmar que esos defectos se corrigieron**.
   Véase [la revisión específica](revision-ventas-2026-10-13.md).
4. Metas de venta independientes por sucursal, impuestos devengados y nuevas
   reglas funcionales de socios necesitan definir su modelo. No se migraron.
5. Las 29 integraciones de diseño no equivalen a 29 pruebas funcionales de
   producción. Organigrama/canvas y otros layouts particulares conservan
   revisión pendiente. Permisos visuales no reemplazan autorización de servidor;
   los hallazgos de auditoría R03/R14 y administradores adicionales no se cerraron.
6. Los álbumes de Salud financiera y Aprende y analiza siguen esperando
   capturas públicas. Las nueve guías completadas sí tienen todos sus pasos.

## Validación final de Codex

| Comando | Resultado del último cierre |
|---|---|
| `node tests/money-tests.js` | **4,476** comprobaciones, 0 fallas |
| `node tests/store-tests.js` | **84** comprobaciones, 0 fallas |
| `node tests/probar-cuenta-header.cjs` | **58** casos, 0 fallas |
| `node tests/probar-kpis.cjs` | **59** casos, 0 fallas |
| `node tests/probar-resumen-financiero.cjs` | **33** casos, 0 fallas |
| Sintaxis y `git diff --check` | Sin errores en el cierre |

Los navegadores ejecutan documentos reales con negocio ficticio, Supabase
simulado, perfiles aislados y **toda petición externa bloqueada**. Guardados
se validaron con el doble de servidor; no con usuarios o datos de producción.
Se revisaron PC, 390/320 px, ambos temas, desgloses, impresión y estados de
error. El PDF de Resumen tiene dos páginas verificadas con Chrome.

[Evidencia final y logs](continuidad-codex-2026-10-13/resumen-financiero/),
[PDF](continuidad-codex-2026-10-13/resumen-financiero/resumen-financiero.pdf),
[Resumen oscuro](continuidad-codex-2026-10-13/resumen-financiero/resumen-completo-dark.png),
[diálogo de meta a 320 px](continuidad-codex-2026-10-13/resumen-financiero/meta-cocina-320.png).
La carpeta de continuidad también conserva evidencia de guías, login y catálogo.

Los dos revisores generales pasaron después de los arreglos de Claude,
según [su reporte](reporte-claude-2026-10-13.md); sus logs antiguos de la pausa
que muestran Staff fallando son evidencia histórica. Repetir ambos al preparar
el push final si hubo cambios compartidos desde su última ejecución:

```sh
node docs/continuidad-codex-2026-10-13/revisar-modulos-ui.cjs
node docs/continuidad-codex-2026-10-13/revisar-portadas-ui.cjs
```

## Archivos que deben viajar juntos

| Bloque | Rutas principales |
|---|---|
| Hub y navegación | `hub.html`, `hub-paleta.css`, `hub-globales.css`, `hub-interacciones.js`, `hub-modulos.js/.css` |
| Diseño compartido | `etaax-modulos-ui.js/.css`, `etaax-sidebar.js/.css`, `ctx-bar.js`, `app.js`, `etaax-header.js`, `nav-pref.js`, `theme.js`, `global-nav.js`, HTML consumidores |
| Álbum del producto | `guia/`, `novedades/` y sus LEEME; conservar `novedades.js` de Claude |
| Iconos y marca | SVG nuevos de `iconos/`, `iconos/generar.js`, `etaax-iconos.js`, `iconos/LEEME.md`, `marca/hub/` |
| KPIs | `financiero/kpis.html`, `kpis-panel.css`, `metas-referencia.js/.css` |
| Resumen | `financiero/resumen.html`, `resumen-panel.css`, `periodo-enlace.js`, `etaax-core.js` |
| Conexiones financieras | `financiero/index.html`, `nav.js`, `ventas.html`, `gastos-globales.html`, demás consumidores/versiones |
| Pruebas | `tests/money-tests.js`, `probar-cuenta-header.cjs`, `probar-kpis.cjs`, `probar-resumen-financiero.cjs`, `tests/fixtures/kpis.cjs` |
| Continuidad | Este reporte, reportes detallados, inventario y `docs/continuidad-codex-2026-10-13/` |

Versiones finales relevantes: núcleo **`financiero-2` en 17 consumidores**;
nav financiero `resumen-2`; `hub-modulos.js?v=14`; CSS del hub módulos `v=8`,
paleta `v=10`; KPIs panel y metas/resumen nuevos `v=2`; periodo-enlace `v=1`.
No regresar a las versiones intermedias que mencionan los reportes anteriores.

## Preparación del commit y push para Claude

Revisar el diff completo y los archivos nuevos, mantener juntas las
implementaciones, recursos y pruebas que dependen entre sí. Una entrega
coherente puede ser un commit grande de este bloque, además del checkpoint ya
existente. Si se divide, cada commit debe conservar esas dependencias; varios
hunks comparten archivo entre Codex y Claude.

Título sugerido, siguiendo el español del repo:

> **ETAAX: renovar navegación y guías e integrar resumen financiero y KPIs**

El cuerpo debe explicar el resultado, las correcciones de dinero/contexto,
la conservación de los seis conceptos, las sugerencias editables, la base de
compras/pagos y las pruebas. No anunciar consumo real de inventario, cambios
de servidor ni defectos de Ventas como resueltos.

Antes del push, comprobar estado remoto, staged diff y recursos nuevos, y
ejecutar los cinco comandos de validación final sobre el árbol que se va a
publicar. El hook pre-push solo ejecuta dinero y almacén; las tres baterías de
Chrome requieren ejecución explícita. No omitir el hook. `core.hooksPath`
actual es `.githooks`; pre-commit puede actualizar y agregar la fecha de
`novedades.js`, así que revisar ese cambio al cerrar el commit.

Para pruebas con fuentes locales, `KPI_FONTS` acepta
`docs/continuidad-codex-2026-10-13/fuentes`; `CHROME_BIN` permite elegir Chrome.
Usar destinos `KPI_CAPTURES` distintos para KPIs y Resumen, evitando que ambas
baterías sobrescriban la misma carpeta temporal. No abrir el SDK real para
estas pruebas ni hacer llamadas de producción.

El usuario pidió que **Claude** prepare el commit y push. Codex entrega aquí
el resultado revisable y el contexto; en este cierre no se ejecutó Git write,
push ni publicación.

## Lecturas de apoyo

- [Resumen financiero y metas: detalle técnico y fuentes](reporte-codex-resumen-financiero-2026-10-13.md).
- [KPIs: rediseño y bases de las tarjetas](reporte-codex-kpis-2026-10-13.md).
- [Visor y carga de los álbumes, por continuación](reporte-codex-zoom-guia-2026-10-13.md).
- [Trabajo de Claude durante las pausas](reporte-claude-2026-10-13.md).
- [Header/cuenta, ya en el checkpoint](reporte-codex-header-cuenta-2026-10-13.md).
- Reportes de [paleta](reporte-codex-paleta-hub-2026-10-13.md),
  [globales](reporte-codex-globales-2026-10-13.md),
  [módulos](reporte-codex-modulos-2026-10-13.md),
  [navegación](reporte-codex-navegacion-2026-10-13.md) y
  [diseño compartido](reporte-codex-diseno-modulos-2026-10-13.md): etapas históricas.
