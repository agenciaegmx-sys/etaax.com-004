# Correcciones de la reauditoría · Codex · 4 de noviembre de 2026

Este reporte entrega a Claude la implementación de los pendientes descritos en `docs/reauditoria-codex-claude-2026-11-04.md`. La base de trabajo fue `9bce5f9`. Se conservaron aparte las modificaciones simultáneas de nómina; únicamente se cambió su lectura de IDs de horarios para mantener la asistencia y los retardos compatibles.

## Estado de entrega

v84 **instalada y verificada en producción**. Sus nueve funciones coinciden con el archivo entregado; se conservaron los diez registros de horarios y se migraron diez IDs, sin cambiar turnos ni configuración. Se verificaron los permisos de la RPC y el bloqueo del UPDATE directo. El cliente y este reporte se publican juntos en el commit de esta entrega.

## Qué cambió y por qué

### R01 / H01 · Identidad de horarios por negocio

- `EtaaxCore.horarioId(negocio, sucursal, semana)` produce `hor_<longitudNegocio>_<negocio>_<sucursal>_<semana>`. La longitud hace inequívoco el límite del negocio incluso si contiene guiones bajos.
- Horarios normaliza las claves antiguas de su caché y conserva la versión más reciente. La sincronización no sustituye un horario local más nuevo por uno viejo de la nube.
- Las invitaciones toman la sucursal de `datos.sucursalId`; ya no intentan obtenerla cortando el ID.
- Nómina consulta el ID nuevo y conserva lectura de claves antiguas en la caché del mismo negocio.
- v84 migra `horarios.id` y `datos.id` juntos, conserva turnos y configuración, e instala un trigger que normaliza también los upserts de clientes anteriores. Impide cambiar `negocio_id` y evita que una cola con `updated` anterior revierta un horario posterior.
- Una identidad duplicada aborta la migración completa: no se elige ni elimina un horario a ciegas. La comprobación previa en producción encontró diez registros, cero identidades naturales duplicadas y cero horarios no reconocibles sin semana.

### R02 / H02 · Confirmar y aplicar un conteo en una transacción

Se retiró `_marcarConteoAplicado`, que enviaba el objeto completo antiguo mediante un `UPDATE` sin esperar respuesta.

La nueva RPC `inventario_conteos_aplicar`:

1. Exige sesión y acceso al negocio, con el mismo alcance de dueño/staff/admin del modelo existente.
2. Bloquea el inventario y todos los conteos seleccionados; comprueba negocio, sucursal, área, estado y versión de **cada** conteo antes de escribir.
3. Guarda el inventario propuesto y sella los conteos en la misma transacción. Si uno cambió, no se aplica ninguno.
4. Conserva cantidad, versión y auditoría del conteo; agrega la referencia al inventario y a la operación que lo consumió.
5. Mantiene una revisión QR y un registro de operaciones con huella de contenido. Reintentar la misma petición devuelve el resultado existente; reutilizar el ID con otro contenido se rechaza.

El cliente calcula la propuesta sobre copias, usando `_aplicarConteoAFila` y `calcExistencia`. La existencia visible se sustituye solo después de la confirmación. Se mantienen las sumas entre conteos del mismo producto y las cantidades capturadas manualmente. Descartar usa el mismo recorrido, sin modificar existencias.

Antes del envío se guarda la petición exacta en `etaax_<negocio>_qr_operacion_<inventario>` de localStorage. Una respuesta perdida conserva ese intento y permite reanudarlo al abrir el inventario. Falta de espacio detiene el envío antes de iniciar una operación sin respaldo. El modal permite reintentar o volver a la lista mientras queda pendiente la confirmación.

El servidor rechaza los `UPDATE` directos de conteos de clientes antiguos. También rechaza snapshots que quiten la revisión/bitácora QR o que intenten agregar una marca `conteoQR` por fuera de la operación confirmada. Esto protege tanto el sello como el guardado previo de cifras de una pestaña anterior.

`sbConfirmarInventarioQR` limpia de la cola únicamente snapshots anteriores del mismo inventario y negocio que ya quedaron incorporados en la operación confirmada. Conserva otros negocios, revisiones más recientes y eliminaciones.

**Límite del alcance:** esta revisión protege la aplicación QR; no convierte todos los guardados manuales del inventario en un sistema general de edición concurrente por campo. Un conflicto de revisión requiere revisar la versión actual antes de volver a aplicar.

### R03 / H03 · Registrar ya no sirve para editar

`inventario_conteo_registrar` usa alta con `ON CONFLICT DO NOTHING` y después comprueba pertenencia/autoría sobre la fila existente. Un reenvío sin versión, con la actual o con una futura conserva exactamente el registro previo: no cambia cantidades, fecha, última operación ni bitácora. La corrección sigue pasando por `entrada_editar`, que ahora exige una versión no nula.

La comprobación posterior al intento de inserción evita el reemplazo en la carrera de dos altas con el mismo ID. Los metadatos de aplicación y edición enviados por el cliente tampoco se aceptan como metadatos de un alta nueva.

### R04 / H04 · Buscar un miembro muestra su compuesto

`_pasaSeleccionS5` aplica búsqueda, categoría y signo al miembro correspondiente. Lista, galería, grupos imprimibles y reporte usan ese criterio. Se puede encontrar el compuesto por su nombre o por el nombre de una presentación. Buscar el miembro con sobrante mientras está seleccionado «solo faltantes» no incluye el compuesto por el faltante de otro miembro.

`_grupoSeleccionS5` mantiene el agrupamiento del compuesto consistente entre pantalla y papel, tomando la categoría del primer miembro como ya hace la tabla del Resultado. No se modificaron las fórmulas de costo ni de variación.

### R05 / H09 · Fechas como instantes

v84 introduce `_entrada_instante` y sustituye las comparaciones alfabéticas de fecha en el periodo y el historial. Los timestamps con `Z` u offset conservan su instante. Los textos sin offset se interpretan como hora operativa de `America/Mexico_City`.

Un conteo creado a las 15:00 después de un cierre a las 14:00 del mismo día vuelve a aparecer. Una entrada sin `registrado` usa `created_at`: se permite después del cierre y se bloquea antes. Se conserva la separación por área incorporada en v83.

### R06 / H11 · Notas mayores que una página

El paginador ya no supone que una fila siempre cabe en una hoja vacía. Si excede el espacio útil, mide fragmentos de texto y crea filas de continuación, repitiendo la cabecera de tabla. El texto completo se conserva y los importes no se repiten como nuevas partidas.

Las filas normales conservan su HTML y estilo. Solo una fila excesivamente alta pasa a fragmentos de texto con ajuste de línea; se privilegia conservar la información legible sobre reproducir su formato interno exacto.

## Pruebas

La validación final se ejecutó sobre una copia del contenido seleccionado para esta entrega, excluyendo los cambios concurrentes de nómina.

| Prueba | Resultado |
|---|---|
| `node tests/money-tests.js` | 5153 comprobaciones, cero fallas. |
| `node tests/store-tests.js` | 84 comprobaciones, cero fallas. |
| `node tests/probar-sql-v84.mjs` | 19 casos, cero fallas; migración ejecutada dos veces en PostgreSQL local/PGlite. |
| `node tests/probar-reauditoria-v84.cjs` | 12 casos, cero fallas; funciones reales con DOM/red simulados. |
| `node tests/probar-paginacion-inventarios.cjs` | Chrome real: 120 productos normales en 5 páginas; nota extensa en 9 páginas; sin desbordamientos, 120 productos conservados y texto de la nota idéntico al original. |
| `node tests/probar-ventanas-insumos.cjs` | 43 casos, cero fallas. |
| `node tests/probar-portal-qr.cjs` | 21 casos de portal y 21 de cuenta/encabezado, cero fallas. |
| `node versionar.js --revisar` | Referencias vigentes. |

Se sustituyeron tres pruebas que buscaban fragmentos de la implementación anterior del QR por ejecuciones de su comportamiento. También se actualizaron las expectativas de IDs y las excepciones documentadas del test que comparaba líneas SQL anteriores: las líneas retiradas eran precisamente las comparaciones de texto erróneas; los casos de fechas ahora se ejecutan contra PostgreSQL.

Las pruebas SQL conservan un sustituto mínimo de `_nip_guardia`, por lo que no acreditan el limitador real de intentos. No se usaron datos de clientes en las pruebas de escrituras ni se sustituyó la validación en tablet/teléfono físico por una afirmación de haberla realizado.

## Activación y recuperación

- La migración es transaccional y se puede repetir. Debe instalarse antes de publicar el cliente que llama la nueva RPC.
- Se preparó un respaldo local de los horarios previos fuera del repositorio y con permisos de archivo restringidos. El reporte no incluye registros de clientes.
- Tras publicar, refrescar pestañas antiguas. Si alguna intenta aplicar por la ruta anterior, el servidor rechaza la escritura y conserva los datos confirmados.
- Una operación con respuesta de red incierta debe reintentarse con su mismo ID y contenido; no borrar su respaldo para empezar otra a ciegas.
- No regresar únicamente el JavaScript a la versión anterior: esa versión vuelve a usar el `UPDATE` directo que la nueva base rechaza. Ante una incidencia, conservar las operaciones pendientes y preparar una corrección compatible.
- `versionar.js` actualiza las huellas de los scripts compartidos. Las modificaciones de `?v=` en otras páginas son parte de esa actualización, no rediseños de esos módulos.

No se hizo una reparación masiva de comentarios `nota/notas`: la auditoría encontró cero entradas QR con ambos comentarios divergentes. La lectura y edición ya corregidas por v83 se conservan.
