# Reauditoría de las correcciones de Claude · 4 de noviembre de 2026

**Dictamen:** seis hallazgos anteriores cerrados en su alcance original, tres parcialmente corregidos y tres pendientes. No dar por terminada la auditoría anterior. Los dos riesgos prioritarios siguen siendo H01 y H02.

## Alcance y método

- Referencia: `docs/auditoria-codex-claude-2026-11-03.md`, hallazgos H01–H12.
- Código revisado: `ddd68046644dfd7399257e7d64d4f9979d73017f`. Correcciones principales: `45a0561` y `ddd6804`.
- Se creó una copia aislada de ese commit para ejecutar las pruebas. Los cambios concurrentes sin commit en `administrativo/diario.html` y `tests/money-tests.js` se conservaron y no forman parte de este dictamen.
- Se compararon las funciones instaladas en Supabase mediante sus definiciones, firmas y permisos, usando exclusivamente consultas de lectura. Las reproducciones que escriben datos se ejecutaron en PostgreSQL local mediante PGlite, con registros ficticios.
- Se comprobó por SHA-256 que los archivos publicados `recetas/inventarios.js`, `entrada.html` y `app-movil/app.js` coinciden con el commit auditado.
- No se modificó la aplicación, no se aplicaron migraciones, no se corrigieron datos reales y no se hizo push. Esta entrega agrega únicamente este documento.

## Estado de los doce hallazgos

| Hallazgo | Estado | Comprobación |
|---|---|---|
| H01 · ID global de horarios | **Pendiente · P1** | El ID todavía omite el negocio; la clave primaria de producción sigue siendo `id`. |
| H02 · Aplicar un conteo pisa una corrección | **Pendiente · P1** | Reproducido con v83: QR confirma 8, aplicar la copia antigua vuelve a 10 y versión 1. |
| H03 · Reenviar una captura pisa su edición | **Parcial · P2 residual** | El reenvío sin versión o con versión vieja ya no pisa. Con versión actual o futura sigue pudiendo reescribir sin auditar el cambio. |
| H04 · Filtros de compuestos | **Parcial · P2 residual** | Funcionan −5/+5 y buscar el nombre del compuesto. Buscar una presentación todavía discrepa entre pantalla y papel. |
| H05 · v80 ausente / catálogo QR completo | **Cerrado en su alcance original** | v80 ya está instalada; las funciones de catálogo y sus ayudantes coinciden con el archivo. La ruta antigua también usa la lista blanca. |
| H06 · Comentarios y borrados | **Cerrado para el flujo corregido** | Clientes usan `notas` para entradas; SQL elimina el campo viejo al editar el comentario; el reconciliador propaga eliminaciones. Véase la salvedad de datos antiguos. |
| H07 · Reintento con contenido distinto da éxito falso | **Cerrado para el caso reportado** | Ambos clientes cambian la operación cuando cambia el contenido; SQL verifica contenido y versión. |
| H08 · Convertir una entrada en merma al editar | **Cerrado** | `concepto` sale de la lista editable y el servidor exige que el movimiento sea una entrada. |
| H09 · Cierre de barra bloquea cocina | **Parcial en el recorrido del periodo · P2** | La separación por área funciona. Queda una comparación textual de fechas que oculta conteos posteriores al cierre y afecta el respaldo con `created_at`. |
| H10 · Peso expresado como copas | **Cerrado** | Harina con diferencia de −500 G ya se rotula en gramos. |
| H11 · Fila mayor que una página | **Pendiente · P2** | Reproducido en Chrome: contenido de 3558 px en una página con 976 px disponibles; se recorta. |
| H12 · Nombre sin escapar en subtotal | **Cerrado** | `_lineaTotalFS` escapa el texto. La reproducción con etiquetas HTML ya no genera marcado activo. |

## Pendientes prioritarios

### R01 · P1 · Horarios de distintos negocios siguen compartiendo identidad

**Referencias:** `administrativo/horarios.html:443`; `etaax-db.js:883`.

`recordId(sucId, weekStr)` sigue produciendo `hor_<sucursal>_<semana>`. Para la sucursal predeterminada dos negocios generan el mismo `hor_suc_principal_<semana>`. El upsert sigue resolviendo conflictos solo por `id`, incluyendo `negocio_id` en el reemplazo.

En producción se volvió a confirmar `PRIMARY KEY (id)`, siete registros `hor_suc_principal_*` distribuidos entre cuatro negocios y seis negocios con colaboradores en la sucursal predeterminada. Esto acredita la condición de colisión; **no prueba que ya se hayan perdido horarios históricos**.

Si quien escribe solo tiene acceso a un negocio, RLS puede rechazar la colisión. Si tiene permiso sobre ambos, el mismo ID permite reemplazar el registro y cambiar su negocio. No es una ruta que haya quedado reparada por v83.

**Trabajo pendiente:** incluir el negocio en la identidad y preparar compatibilidad/migración de IDs, `datos.id`, cachés y operaciones pendientes. Evitar que clientes anteriores vuelvan a escribir la identidad global. No basta con cambiar la función de JavaScript para los registros nuevos.

### R02 · P1 · Aplicar una copia vieja todavía deshace lo corregido en el QR

**Referencia:** `recetas/inventarios.js:9202`, `_marcarConteoAplicado`.

El ERP conserva un conteo de 10 unidades, versión 1. El QR lo corrige a 8, versión 2. Al aplicar la copia que tenía el ERP, se manda `update({datos:c}).eq('id',c.id)` con todo el objeto antiguo, sin condición de versión. En la reproducción contra v83 terminó así:

```json
{"cantidadConfirmadaQR":8,"cantidadFinal":10,"versionFinal":1,"auditoria":null}
```

La marca se envía sin esperar su resultado y sus errores se ignoran. El bloqueo `FOR UPDATE` de `entrada_editar` termina con su transacción; no protege contra este `UPDATE` posterior.

**Trabajo pendiente:** coordinar la aplicación del conteo y la actualización del inventario con comprobación de versión en servidor. Detectar conflicto antes de aplicar la cantidad local y conservar una operación durable para reintentos. Proteger también contra las escrituras completas de clientes anteriores. Cambiar únicamente el sello después de aplicar el número no resuelve la inconsistencia.

## Correcciones parciales

### R03 · P2 · La RPC de registro aún permite editar por fuera de la bitácora

**Referencias:** `supabase-migration-v83.sql:462`, `:470`, `:480`; prueba que acepta este comportamiento en `tests/probar-sql-v83.mjs:166`.

La corrección sí protege el reenvío normal del original sin versión. La excepción introducida para una versión actual o futura mantiene una segunda ruta de edición:

1. Registrar 10 unidades, versión 1.
2. `entrada_editar` corrige a 8, versión 2, con una entrada de auditoría.
3. `inventario_conteo_registrar` recibe el mismo ID con 5 unidades y `ver:2`.
4. Quedan 5 unidades, versión 3; la única auditoría sigue diciendo que el último valor fue 8. Desaparece `ultimaOp` y se renueva `registrado`.
5. Otro envío con 100 unidades y `ver:999` también entra, aunque 999 no sea la versión actual.

No desaparece la auditoría anterior como antes; lo que falta es el rastro del nuevo reemplazo. Conservar un arreglo de auditoría no equivale a auditar todas las modificaciones. El riesgo residual requiere usar esta ruta de registro con versión, por eso se clasifica P2, no como el fallo original de cualquier reintento antiguo.

**Trabajo pendiente:** tratar el registro de un ID existente como alta idempotente; toda modificación debe pasar por la edición que comprueba versión, campos y auditoría. Si se decide mantener actualizaciones por esta RPC, debe cumplir el mismo contrato completo, rechazar versiones futuras y conservar fecha original e idempotencia. Añadir el caso de dos altas concurrentes para el mismo ID.

### R04 · P2 · Buscar el nombre de una presentación sigue dejando vacío el Resultado

**Referencias:** `recetas/inventarios.js:8887`, `:9655`, `:10665`.

La corrección pasó los dos casos originales: compuesto con −5/+5 y búsqueda por nombre del compuesto. Falta el sentido inverso:

- Compuesto: `Caguamas`.
- Presentaciones: `Cerveza A 940` y `Cerveza B 940`.
- Buscar `Cerveza A` con «solo faltantes».
- Pantalla: sin compuesto. Grupos imprimibles: `[]`. El modal impide imprimir.
- La función del reporte, con los mismos filtros, sí incluye `Cerveza A 940`.

La pantalla y `_gruposVisiblesS5` buscan únicamente en el nombre virtual del compuesto. El impreso ahora acepta el nombre del miembro **o** el del compuesto.

**Trabajo pendiente:** compartir la selección por IDs entre pantalla, grupos y reporte. Probar búsqueda por compuesto, por miembro, coincidencia parcial, categoría y signo, en lista y galería. Corregir solo el filtro de impresión deja otros desacuerdos vivos.

### R05 · P2 · Las fechas se comparan como texto, ocultando capturas del mismo día

**Referencias:** `supabase-migration-v83.sql:57`, `:128`, `:201`, `:327`.

Separar el cierre por área sí funciona. El problema residual está en comparar un ISO con `T` contra `created_at::text`, que normalmente usa un espacio. La comparación es alfabética, no cronológica.

**Reproducción independiente con v83 y datos ficticios:**

| Caso | Datos | Resultado incorrecto |
|---|---|---|
| Conteo de cocina posterior al cierre | Cierre `2026-10-21T14:00:00Z`; `created_at` a las 15:00 del mismo día | `entrada_historial` no devuelve el conteo. |
| Entrada antigua sin `registrado` | Mismo cierre; `created_at` a las 15:00 | `entrada_editar` responde `cerrado`, aunque se creó después. |

En el primer caso no hace falta que falte ningún campo: el filtro de conteos siempre compara `c.created_at::text > v_desde`. Es un defecto previo que sigue en la definición copiada a v83. El segundo muestra que el nuevo respaldo con `created_at` aún necesita normalización. El caso «antes del cierre» de la suite pasa incluso con esta comparación equivocada; faltaba el caso «después, el mismo día».

En producción se contaron **cero entradas QR sin `registrado`** al consultar. Por ello no se atribuye el segundo caso a datos reales actuales. El primer caso no depende de esa condición.

**Trabajo pendiente:** comparar instantes tipados, con zona horaria definida. Aplicar la misma regla al historial, al cierre y al editor, incluyendo el respaldo de inventarios viejos que solo tienen `fecha`. Agregar casos antes/después del cierre en el mismo día y con offsets equivalentes.

## Impresión pendiente

### R06 · P2 · Una nota larga sigue cortándose aunque el conteo de filas dé correcto

**Referencia:** `recetas/inventarios.js:10356`.

Se ejecutaron `_rdPodarPorModo` y `_rdConstruirPaginas` del commit auditado en Chrome real, con HTML generado por el reporte y sin datos de clientes:

| Fixture | Páginas | Filas presentes en el DOM | Desbordamiento |
|---|---:|---:|---|
| 120 productos normales | 5 | 120 | Ninguno |
| Mismos productos y una nota muy extensa | 7 | 120 | Página 2: 3558 px de contenido dentro de 976 px disponibles |

La nota de prueba repite un texto ordinario 700 veces en una celda. El algoritmo conserva todas las filas en el DOM, pero la página tiene recorte por `overflow`; conservar el número de filas no demuestra que se puedan leer completas al imprimir. El comentario «una fila siempre cabe en una hoja vacía» continúa siendo una suposición falsa.

**Trabajo pendiente:** dividir el contenido de una fila que supera la altura útil o trasladar las notas extensas a un anexo. Verificar la geometría final y el resultado impreso. No limitarse a aumentar los márgenes o a contar filas antes de paginar.

## Salvedad de H06: datos que ya tienen ambos comentarios

La ruta nueva de edición y borrado quedó corregida. Una ficha antigua que tenga simultáneamente `notas:"Original"` y `nota:"Corregido en v82"` todavía abre mostrando `Original`, porque el historial prioriza `notas`. Editar explícitamente su comentario sí normaliza ambos campos; abrirla o editar solo su cantidad no lo hace.

La reproducción sintética confirma ese comportamiento, pero la consulta agregada de producción encontró **cero entradas de origen QR con ambos comentarios no vacíos y distintos**. Por eso no se presenta como incidente activo ni impide cerrar H06 para el flujo corregido. Si aparecen registros importados o clientes viejos que produzcan esa combinación, decidir qué campo prevalece usando su bitácora; no sobrescribir comentarios a ciegas.

## Instalación y pruebas comprobadas

El aviso del commit `ddd6804` dice que faltaba ejecutar v83. **Al momento de esta auditoría ya está ejecutada**. Coinciden exactamente los cuerpos de `entrada_editar`, `entrada_historial`, `inventario_conteo_registrar` y `_entrada_periodo_cerrado` de cuatro argumentos. También coinciden con v80 `entrada_catalogo`, `entrada_insumos`, `_insumo_qr_campos` y `_insumo_en_suc`.

Los ayudantes `_insumo_qr_campos` y `_entrada_periodo_cerrado` no permiten ejecución a `anon`. La RPC antigua del catálogo sigue existiendo por compatibilidad: entrega campos de lista blanca de insumos asignados, sin derivar una sucursal del NIP. Cerrar H05 significa que ya no entrega la ficha completa y que la ruta nueva sí filtra por NIP/sucursal; no significa que se haya retirado ese acceso antiguo.

| Verificación sobre la copia aislada | Resultado |
|---|---|
| `node tests/money-tests.js` | 5086 comprobaciones, cero fallas. |
| `node tests/store-tests.js` | 84 comprobaciones, cero fallas. |
| `PGLITE_DIR=/tmp/etaax-billing-sql node tests/probar-sql-v83.mjs` | 32 casos, cero fallas; incluye reproducir v82 antes de aplicar v83. |
| `node tests/probar-portal-qr.cjs` | 21 casos de portal y 21 de cuenta/encabezado, cero fallas. |
| `node versionar.js --revisar` | Referencias a archivos compartidos vigentes. |
| Reproducciones SQL adicionales | Confirmados R02, R03, R05 y la salvedad de comentarios antiguos. |
| Render con funciones reales | Pasan los casos originales H04/H10/H12; confirma R04 y el borrado del comentario en la copia del inventario. |
| Paginación en Chrome | Caso normal correcto; R06 reproducido. Se generaron ambos PDF. |

Las suites SQL usan un sustituto mínimo de `_nip_guardia`; no acreditan el limitador real de intentos. La prueba del portal cubre interfaz y navegación con datos simulados, no una operación completa en un teléfono físico. No se revalidó touch en tablet física en esta revisión.

Las reproducciones y resultados locales quedaron en `/tmp/etaax-reaudit-20261104-*`: `extra.mjs`/`extra.log`, `report.cjs`/`report.log`, `paginador.cjs`/`paginador.log` y los PDF. Son evidencia auxiliar de esta ejecución, no archivos de producción. Los pasos y resultados esenciales están documentados arriba para poder reconstruirlos si se limpia `/tmp`.

## Orden sugerido para la siguiente entrega

1. Resolver la identidad de horarios y la aplicación versionada de conteos, incluyendo clientes anteriores y operaciones pendientes.
2. Cerrar la edición alternativa por `inventario_conteo_registrar` y corregir las comparaciones de fechas.
3. Unificar los filtros de compuestos y resolver la paginación de filas extensas.
4. Repetir estos casos contra la siguiente migración y el código publicado. Mantener separados «corregido en código», «instalado» y «reproducido en dispositivo».
