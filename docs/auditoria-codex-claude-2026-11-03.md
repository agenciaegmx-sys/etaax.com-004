# Auditoría independiente de la entrega de Claude

Fecha: **3 de noviembre de 2026**.

Rango solicitado: `ba20891^..ec0ecc2`. Reporte leído: `docs/reporte-sesion-2026-10-31_11-02.md`, incluido en `20f5482`.

**Conclusión:** las mejoras de touch y equivalencias tienen respaldo en pruebas, y la v82 sí está instalada. No considero cerrada la integridad de las correcciones QR ni la equivalencia entre el filtro de pantalla y el reporte. Confirmé también el riesgo de IDs de horarios en el esquema de producción y la ausencia de v80. Hay casos que las suites actuales dejan pasar.

Esta entrega es una auditoría: no modifica la aplicación, no aplica migraciones y no corrige datos de producción. Durante la revisión aparecieron cambios concurrentes en catálogo de insumos y sus pruebas. Se conservaron intactos y se creó una copia aislada de `20f5482` para mantener acotada la revisión.

## Hallazgos prioritarios

### H01 · P1 · Los horarios de distintos negocios pueden compartir la misma llave

**Origen:** pendiente anterior, señalado correctamente por Claude; confirmado ahora en producción mediante consultas de solo lectura.

`administrativo/horarios.html:443` genera `hor_<sucursal>_<semana>`, sin negocio. `etaax-db.js:879` hace upsert con conflicto por `id` y envía también `negocio_id`. La tabla publicada tiene **`PRIMARY KEY (id)`**, no una llave compuesta. Se encontraron siete registros con prefijo `hor_suc_principal_`, repartidos entre cuatro negocios; seis negocios tienen personal de Matriz.

El problema tiene dos resultados posibles:

- Un usuario con acceso a un solo negocio puede chocar contra un horario de otro y quedarse con el guardado rechazado.
- Un usuario autorizado sobre ambos negocios, incluido un administrador de plataforma, puede actualizar la fila en conflicto y cambiarle negocio y turnos. Las políticas publicadas permiten ese supuesto: validan acceso al negocio anterior y al nuevo, no que ambos sean iguales.

**Reproducción local:** dos upserts permitidos para `hor_suc_principal_2026-W45`, primero negocio A y luego B, dejaron una sola fila, de B, sin los turnos de A. No ejecuté esa prueba en producción ni afirmo que haya ocurrido pérdida histórica: se confirmó el esquema vulnerable y el comportamiento con datos ficticios.

**Corrección recomendada:** incluir negocio en la identidad semanal, migrar `id` y `datos.id` conjuntamente y conservar lectura compatible durante la transición. Revisar copias locales, cola de salida, consultas de semanas e invitaciones entre sucursales. Bloquear escrituras antiguas que puedan recrear la colisión. La configuración nueva `horcfg_<negocio>` sí evita este defecto.

### H02 · P1 · Aplicar un conteo puede deshacer una corrección confirmada

**Origen:** interacción pendiente de la nueva función; el reporte de Claude la reconoce.

`recetas/inventarios.js:9178` (`_marcarConteoAplicado`) sigue enviando el objeto local completo sin comparar versión. El bloqueo de fila de `entrada_editar` solo serializa esa transacción; no evita que otro cliente escriba después una copia vieja.

**Reproducción:** el ERP conserva 10 unidades, versión 1; el QR corrige a 8, versión 2; el ERP aplica su copia de 10. El registro termina en 10, versión 1, aplicado, y desaparece la auditoría de la corrección. Las pruebas SQL existentes solo cubren editar un conteo que **ya estaba** aplicado.

**Corrección:** aplicar/descartar por operación de servidor con versión esperada y consumo idempotente, coordinada con el guardado del inventario. Proteger también la escritura directa antigua. Mantener recuperación de operaciones pendientes cuando falla la conexión; no resolverlo solo esperando una petición HTTP desde la pantalla.

### H03 · P1 · El reenvío por la RPC antigua todavía pisa correcciones y borra su historial

**Origen:** hueco en la protección de v82.

`supabase-migration-v82.sql:480` comprueba autor y estado antes del reenvío, pero el `ON CONFLICT` posterior reemplaza todo `datos`. No compara una versión del envío ni conserva auditoría, fecha original o última operación.

**Reproducción:** registrar 10 → corregir a 8 mediante `entrada_editar` → reenviar el envío original de 10 con el mismo ID y NIP. La RPC acepta el reenvío: vuelve a 10 y desaparece `auditoria`. El test «reenviar el propio sigue funcionando» valida la sobrescritura de una cantidad, pero no cubre un reintento viejo después de una corrección.

**Corrección:** distinguir repetición de una alta ya procesada de una edición. La primera debe devolver el registro existente sin alterarlo; la segunda debe pasar por versión, autorización y auditoría. Incrementar `ver` después de sobrescribir no resuelve la pérdida.

### H04 · P1 · Pantalla e impreso no usan el mismo criterio para los compuestos

**Origen:** cambio nuevo en los filtros del Resultado.

`recetas/inventarios.js:8809` filtra un compuesto por la suma de sus diferencias. El impreso, en `:10641`, filtra sus presentaciones individualmente. El buscador de pantalla usa el nombre del compuesto, mientras el impreso busca el nombre de cada miembro.

**Dos reproducciones con código real:**

1. Presentación A: −5 piezas; presentación B: +5. Con «Solo faltantes», el compuesto desaparece y `_gruposVisiblesS5()` devuelve una lista vacía: el usuario no puede imprimir desde ese modal. El generador del impreso sí contiene el faltante de A.
2. Buscar «Caguamas», nombre del compuesto: se ve en pantalla, pero el impreso no incluye sus miembros «Cerveza A 940» y «Cerveza B 940» porque no contienen la palabra buscada.

**Corrección:** resolver una sola selección de IDs/presentaciones para pantalla, grupos elegibles e impreso. Si se conserva la decisión de separar faltantes y sobrantes por presentación, un compuesto debe entrar cuando alguno de sus miembros cumpla el filtro; su neto no debe ocultarlos. Buscar su nombre debe seleccionar coherentemente sus presentaciones.

### H05 · P1 · La protección de catálogo de v80 sigue sin estar instalada

**Origen:** pendiente anterior; confirmado en producción.

No existen `entrada_catalogo` ni `_insumo_qr_campos`. La función publicada `entrada_insumos` sigue devolviendo `negocio_insumos.datos` completo y permite ejecución a `anon`, comprobando negocio y token QR. No exige NIP en esa función. El token limita el acceso, pero quien lo tiene puede recibir datos que la interfaz no muestra, incluidos los campos de costo/proveedor presentes en ese documento.

La v82 **no sustituye** la v80. Contrasté los cuerpos publicados de `entrada_editar`, `_entrada_quien` y `entrada_historial` mediante hash: coinciden con la v82 del commit auditado.

**Corrección:** revisar y aplicar la migración v80 de forma controlada y comprobar la respuesta efectiva del catálogo y el comportamiento de clientes viejos. No basta con esconder campos en JavaScript. Esta auditoría no aplicó la migración.

## Otros defectos confirmados

### H06 · P2 · Los comentarios de entradas se escriben y leen en campos distintos

`entrada.html:1552` guarda el comentario original como **`notas`**. El historial y editor de v82 usan **`nota`**, y `_reconciliarEntradaEnInv` (`recetas/inventarios.js:2623`) tampoco actualiza `notas`.

**Reproducción:** una entrada con `notas: "Factura original"` abre el editor sin ese comentario. Guardar «Factura corregida» deja dos campos: el QR lee el nuevo y el ERP continúa leyendo el anterior. En producción hay 192 movimientos QR con `notas` no vacío y sin `nota` —conteo agregado, no una afirmación de que todos sean entradas editables—.

Además, al borrar un campo, SQL elimina su llave pero el reconciliador solo copia llaves presentes: la copia local conserva un comentario que ya fue borrado en servidor. Este segundo comportamiento también se reprodujo.

**Corrección:** contrato canónico por tipo de captura: `notas` para entradas y `nota` para conteos, con lectura compatible de históricos. Propagar también borrados explícitos sin eliminar campos propios del ERP. Cubrir crear → abrir editor → corregir/borrar → sincronizar → recargar.

### H07 · P2 · Cambiar el valor después de una respuesta perdida puede producir un éxito falso

`entrada.html:1330` y `app-movil/app.js` mantienen `_COR.op` aunque el usuario vuelva a cambiar los inputs. `entrada_editar` devuelve éxito repetido si coincide `ultimaOp`, antes de comprobar si el contenido del nuevo intento corresponde a aquella operación.

**Reproducción:** se guarda 8 con operación X pero se pierde la respuesta. El usuario cambia a 6 y reintenta: se envía X con el nuevo contenido; el servidor responde `ok:true, repetida:true` y conserva 8. La lista de sesión del QR web incluso puede mostrar 6 porque aplica los cambios solicitados localmente, no el registro devuelto.

**Corrección:** asociar la operación a un contenido inmutable. Reintentar exactamente el mismo envío; si cambia, reconciliar la respuesta anterior y emitir una operación nueva con la versión correcta. Pintar el registro confirmado por servidor, no asumir que una respuesta idempotente aceptó otro contenido.

### H08 · P2 · La RPC de edición permite convertir una entrada en merma

En `supabase-migration-v82.sql:379`, la lista de campos editables de entrada incluye `concepto`. Esa llave no es el comentario: determina si el movimiento es `entrada`, `merma` o `salida`.

**Reproducción SQL:** un colaborador pudo ejecutar `entrada_editar` sobre su entrada con `{"concepto":"merma"}` y el servidor lo aceptó. El formulario no ofrece ese control, pero el contrato público sí lo permite. También acepta otros textos o quitar la llave. El comentario del cliente indica expresamente que corregir mermas/cortesías está fuera de esta entrega.

**Corrección:** quitar `concepto` de esta lista y exigir que el registro sea una entrada; si se decide permitir reclasificaciones, crear el flujo específico con sus permisos, campos requeridos y reconciliación de salidas. No tratar esa llave como texto libre.

### H09 · P2 · El cierre de un área bloquea correcciones de otra área

`_entrada_periodo_cerrado`, en `supabase-migration-v82.sql:101`, no recibe ni compara área. El historial, en cambio, sí calcula su periodo por área.

**Reproducción:** una entrada de cocina de las 12:00 fue rechazada como cerrada después de insertar un cierre de **barra** de las 13:00, sin cierre de cocina. El servidor no demuestra que esa entrada perteneciera al inventario cerrado que usa como bloqueo.

**Corrección:** comprobar pertenencia al inventario/periodo pertinente, incluyendo área y sus reglas de importación, en vez de «cualquier cierre posterior de la sucursal».

Caso adicional de compatibilidad: si `registrado` falta, el historial usa `created_at`, pero el editor usa `''`. En el laboratorio una entrada antigua sin ese campo pudo eludir un cierre. La consulta agregada encontró **cero movimientos QR actuales sin `registrado`**, por lo que no lo presento como afectación actual confirmada de esos QR; sí debe corregirse el desacuerdo entre lector y escritor.

### H10 · P2 · Los faltantes de productos por peso se rotulan como copas

`recetas/inventarios.js:10703` resuelve la unidad como `tipo === 'pza' ? 'pza' : 'cop'`.

**Reproducción:** una fila de harina `tipo:'peso', baseUnit:'G'`, con diferencia −500, aparece como **«−500.0 cop»** en la hoja nueva. El número monetario no se modifica por esta etiqueta, pero el reporte describe otra unidad.

**Corrección:** usar el formateador común de cantidades y la unidad base de esa fila. Incluir gramos, kilos, mililitros y piezas en los casos del reporte, además de bebidas por copa.

### H11 · P2 · El paginador aún recorta una fila que supera una página

**Origen:** limitación anterior que afecta a la nueva hoja. El arreglo de separar las tablas sí resuelve el caso ordinario del reporte largo.

Probé `_rdPodarPorModo` y `_rdConstruirPaginas` reales, con CSS del reporte y Chrome:

- **120 productos:** cinco páginas, 120 filas conservadas, sin desbordamiento del cuerpo y con el neto presente.
- **Los mismos 120 con una nota extensa en una fila:** siete páginas; una página tiene 976 px disponibles y 3,558 px de contenido. `overflow:hidden` recorta lo que no cabe. Que el DOM conserve las 120 filas no demuestra que todo sea visible en el PDF.

`recetas/inventarios.js:10332` inserta la fila después del salto bajo el supuesto «una fila siempre cabe en una hoja vacía». La nota del insumo es un textarea sin límite de extensión.

**Corrección:** detectar filas mayores que la altura útil y dividir su contenido o trasladar notas extensas a un anexo. Añadir comprobación geométrica de la página final y extracción/inspección del PDF, no solo del HTML fuente. No afirmar que el paginador no puede probarse: requiere navegador, y esta auditoría lo ejecutó.

### H12 · P2 · El nombre de un compuesto entra sin escapar en el subtotal impreso

`_lineaTotalFS`, en `recetas/inventarios.js:10668`, inserta `etiqueta` directamente como HTML. Su llamada para el subtotal concatena `u.comp.nombre` sin `etx()`.

**Reproducción:** el nombre ficticio `Grupo <b data-audit="nombre">MARCA</b>` produjo esa etiqueta HTML activa en el subtotal, mientras otras partes del reporte la escapan. Se confirmó inserción de HTML; no se hizo ninguna prueba contra usuarios ni datos reales.

**Corrección:** escapar nombres/etiquetas antes de interpolarlos. Mantener los iconos y estructura del subtotal en la plantilla, separados del texto del usuario. Probar al menos `<`, `>`, `&` y comillas.

## Las siete decisiones de criterio del reporte

| Decisión de Claude | Evaluación |
| --- | --- |
| El filtro vive en la pantalla | Razonable para el usuario; pasar una selección explícita al generador facilitaría probarla. Lo que falla ahora es la selección distinta de compuestos, no la existencia de un filtro único. |
| Totales de lo impreso | Correcto si se identifica claramente el alcance. No deben presentarse como el total del negocio cuando hay filtro. |
| Presentaciones separadas y subtotal del compuesto | Correcto para no compensar faltantes contra sobrantes antes de investigarlos. El filtro de pantalla debe seguir esa misma regla. |
| Color por signo en esa hoja | Coherente con listas de faltantes/sobrantes. Mantener distinguible la severidad porcentual en los reportes que la usan. |
| Sin base de comparación, «—» | Correcto. `varPct` sigue siendo numérico para los consumidores anteriores y el indicador adicional permite no fingir un porcentaje en la nueva hoja. |
| No agregar Caja al catálogo común de áreas | Decisión prudente de alcance. El grupo manual resuelve impresión, pero no equivale a crear un área operativa; documentar esa diferencia si se retoma. |
| No mostrar producción propia bajo filtro de diferencia | Coherente cuando su variación ya está repartida a los insumos. No debe ocultar diferencias de los insumos receptores ni servir para omitir un reparto fallido. |

Sobre «Cañaveral»: un faltante muy grande **no prueba por sí solo** que el consumo se asignó al insumo equivocado. Sigue siendo una hipótesis. Para atribuirlo a datos hay que trazar existencia inicial, entradas, ventas directas, consumo de recetas/subrecetas, unidades, producción, cierre físico y reparto. No modifiqué ese inventario ni di por diagnosticada su causa.

## Pruebas y evidencia

| Comprobación ejecutada | Resultado |
| --- | --- |
| `node tests/money-tests.js` | 5,032, cero fallas; repetida en la copia aislada al detectar trabajo concurrente. |
| `node tests/store-tests.js` | 84, cero fallas. |
| `node versionar.js --revisar` | Huellas vigentes al comenzar la auditoría. Los bumps posteriores concurrentes no forman parte del dictamen. |
| `node tests/probar-ventanas-insumos.cjs` | 43, cero fallas. |
| `ETAAX_PRUEBA_TOUCH=1 node tests/probar-ventanas-insumos.cjs` | 7, cero fallas; gestos emulados en Chrome, sin tablet física. |
| `node tests/probar-portal-qr.cjs` | Portal 21 y cuenta/header 21, cero fallas. |
| `node tests/probar-navegacion-visual.cjs` | 34, cero fallas. |
| `PGLITE_DIR=/tmp/etaax-billing-sql node tests/probar-sql-v82.mjs` | 32, cero fallas. |
| Casos independientes SQL | Reproducidos H01/H02/H03/H06/H07/H08/H09 con registros ficticios. |
| Casos independientes de render | Reproducidos H04/H06/H10/H12 con funciones reales. |
| Paginador real en navegador | Caso ordinario conservado y recorte de fila extensa reproducido. Se generaron PDFs locales de ambos. |
| Supabase producción | Solo lectura de esquema, políticas, funciones y conteos agregados. Sin NIP, tokens de usuarios ni documentos personales en el informe. |

Las 32 pruebas SQL usan un `_nip_guardia` mínimo que siempre devuelve verdadero: verifican el contrato de edición en su fixture, **no certifican el freno real de intentos**. Tampoco incluyen la carrera editar/aplicar ni el reenvío original después de una corrección. Los verdes anteriores no contradicen los fallos encontrados.

Los experimentos quedaron fuera de la aplicación, bajo `/tmp/etaax-audit-20261103-*`: `extra.mjs`/`.log` para SQL; `report.cjs`/`.log` para render; `paginador.cjs` y PDFs `paginador-normal.pdf` / `paginador-nota-larga.pdf`. Son evidencia local de esta sesión, no archivos necesarios para operar ETAAX ni una nueva suite incorporada a CI.

## Orden de corrección sugerido

1. Cerrar el contrato de QR: aplicación atómica/versionada, reenvíos realmente idempotentes, lista de campos y periodo correcto. Corregir comentarios y respuesta perdida en la misma revisión para probar todo el recorrido.
2. Resolver la colisión de horarios con migración y recuperación de pendientes locales; verificar que el segundo negocio pueda guardar sin afectar al primero.
3. Instalar y comprobar v80. Hacerlo como operación separada de publicar JavaScript.
4. Unificar selección de compuestos para pantalla e impreso; corregir unidades de peso y escapado de nombres.
5. Añadir pruebas del paginador y validar tablet/teléfono físicos. El encabezado que tapa toques a 768 px sigue siendo un pendiente declarado por Claude; esta auditoría no lo da por corregido porque el test logre encontrar otro punto donde soltar.

No recomiendo rehacer lo ya entregado: el helper de equivalencias, la corrección del tirador y la configuración de grupos son bases aprovechables. La prioridad es cerrar las rutas que todavía pueden cambiar cantidades silenciosamente o mostrar un alcance distinto al que se imprime.
