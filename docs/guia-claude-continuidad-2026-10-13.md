# Guía de continuidad para Claude · estado final del día

La entrega actual está en el **[reporte consolidado del 13 de octubre](reporte-codex-dia-2026-10-13.md)**. Leerlo primero para preparar el commit y push solicitado por Edwin. Incluye las aportaciones de Codex y Claude, pruebas finales, dependencias, evidencia y pendientes reales.

## Estado actual

- Workspace: `/Users/macbookpro/Proyectos/etaax.com-004-2`; rama `main`.
- Checkpoint local: **`e3e9d6e`**. Los cambios posteriores están sin commit. No restaurar archivos ni borrar recursos nuevos: hay trabajo de ambos agentes.
- Resumen de resultados ahora es **Resumen financiero**, con resultados primero, simulación opcional y reporte real de dos páginas.
- KPIs tiene ocho tarjetas conectadas, los seis conceptos originales debajo y Definir/Editar meta por tarjeta, con sugerencias editables y fuentes.
- El álbum del hub tiene **52 capturas**, completando cinco herramientas administrativas y cuatro de Recetas e Insumos. El visor permite ampliar y navegar.
- Catálogo flotante de recetas corregido; isotipo del login enlazado a la landing.
- **Staff a 320 px ya fue corregido por Claude**. El reporte de pausa y sus logs de fallo son históricos, no el diagnóstico actual.
- Conservar la presentación de `novedades.js` y sus 17 imágenes. El anuncio automático está apagado; revisar contenido y estado al publicar.

## Validación final de Codex

| Batería | Resultado |
|---|---|
| Dinero | 4,476 comprobaciones, 0 fallas |
| Almacén | 84 comprobaciones, 0 fallas |
| Cuenta/header | 58 casos, 0 fallas |
| KPIs | 59 casos, 0 fallas |
| Resumen financiero | 33 casos, 0 fallas |

La [evidencia final](continuidad-codex-2026-10-13/resumen-financiero/) incluye PDF, capturas y logs. Todas las pruebas de navegador usan datos ficticios y peticiones externas bloqueadas. El hook pre-push no ejecuta las baterías de Chrome: correrlas explícitamente antes de este push.

## Mantener el alcance

El núcleo compartido es la fuente de verdad del dinero. No copiar sus fórmulas a las pantallas. Compras/pagos no equivalen a consumo de inventario; Consumo extra sigue sin cifra hasta tener una fuente comparable. Las sugerencias no se aplican automáticamente y sus referentes tienen contexto de país, formato y base.

No declarar corregidos los defectos documentados de [Ventas](revision-ventas-2026-10-13.md): solo se añadió la conexión de filtros entrantes. Las integraciones visuales tampoco cierran hallazgos de autorización del servidor.

Las guías del hub son informativas; Ir al módulo abre la portada. Cambiar módulo va a esa misma portada, conserva negocio/sucursal y protege cambios sin guardar en recetas. Cuentas bancarias continúa únicamente en sucursal. Conservar los dos contextos globales y los guardas existentes.

## Fuentes de continuidad

1. [Reporte consolidado y preparación de Git](reporte-codex-dia-2026-10-13.md).
2. [Resumen financiero, metas y fuentes](reporte-codex-resumen-financiero-2026-10-13.md).
3. [Rediseño de KPIs](reporte-codex-kpis-2026-10-13.md).
4. [Visor y carga de guías](reporte-codex-zoom-guia-2026-10-13.md) y [álbum](../guia/LEEME.md).
5. [Aportaciones y correcciones de Claude](reporte-claude-2026-10-13.md).
6. [Inventario de cambios](inventario-actualizacion-2026-10-13.txt).

El [reporte de pausa](reporte-codex-pausa-2026-10-13.md) conserva el diagnóstico anterior. Sus versiones, cantidades de pruebas y pendientes se deben interpretar en su fecha; el reporte consolidado determina el estado de esta entrega.
