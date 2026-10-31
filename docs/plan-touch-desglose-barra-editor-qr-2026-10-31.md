# Plan para Claude: touch, equivalencias de barra y edición desde QR

Fecha: 31 de octubre de 2026. Base auditada: `ba20891`.

**Entrega de esta auditoría: diagnóstico y plan de implementación. No modifica la aplicación ni la base de datos.** Es independiente de las ideas comerciales de `docs/idea-etaax-2027/`.

## Alcance acordado

1. Corregir el reordenamiento con el dedo en **el catálogo de insumos y los ingredientes de un escandallo**. El usuario confirmó que falla en tablet. No está pidiendo reordenar la captura de inventarios.
2. Mostrar, en los resultados de barra, a cuántas **botellas, onzas y copas** equivalen la existencia y la diferencia.
3. Agregar un editor de **conteos y entradas ya enviados desde QR**. Esta interpretación del punto 3 es la propuesta de trabajo; no implica editar la ficha maestra del insumo.

Trabajar las tres facturas en entregas separadas. Mantener el estilo actual, los IDs y las reglas existentes de cálculo. La tercera requiere cambios coordinados de servidor y clientes; no se resuelve agregando únicamente un botón.

## 1. Reordenamiento táctil

### Lo encontrado

- El soporte existe en `reordenar.js`: usa Pointer Events, captura de puntero y desplazamiento automático. No hace falta sustituir HTML5 drag and drop: esa sustitución ya ocurrió.
- Integraciones: `recetas/insumos.js:1187` (`_engancharOrden`) y `app.js:1902` (`_engancharOrdenIng`). También lo usa el catálogo de recetas en `recetas/index.html:3705`; debe conservar su funcionamiento.
- En el escandallo, el tirador es un `<span class="ord-grip">` dentro de una celda (`app.js:1843`). El CSS compartido le asigna `touch-action:none`, pero no un `display` que lo convierta en una caja con ancho y alto. `recetas/recetas-ui.css:118` solo añade margen.
- **Fallo reproducido en Chrome con entrada táctil emulada**, usando el `reordenar.js` real y el mismo tipo de marcado del escandallo en un contenedor desplazable. El tirador medía aproximadamente 28 × 15 px y tenía `display:inline`: se recibieron `pointerdown → pointercancel`, la pantalla hizo scroll y no hubo movimiento. Aplicando solamente `display:inline-flex` y un área táctil de al menos 44 px en la prueba, se recibió `pointerup` y el componente notificó el movimiento.
- Esto concuerda con la restricción de `touch-action` sobre elementos inline no reemplazados. [Referencia primaria: W3C, Pointer Events, propiedad touch-action](https://www.w3.org/TR/pointerevents/#the-touch-action-css-property).
- **El catálogo requiere una comprobación adicional:** su tirador está dentro de un `display:flex` y se convierte en un elemento de bloque. En la reproducción mínima sí se pudo arrastrar, aunque su altura siguió siendo de apenas 15 px. No atribuirle automáticamente el mismo fallo del escandallo ni declarar resuelta la tablet con esa prueba.
- La galería de insumos no muestra un tirador: se hace arrastrable toda la tarjeta. Eso compite con el scroll y con sus botones. La vista Costeo sale de `_renderPagina` antes de conectar el arrastre (`recetas/insumos.js:1210`).
- `_scroller` no contempla el desplazamiento del documento cuando no hay un contenedor interno. `quitar()` desengancha eventos sin cancelar el intervalo de un arrastre activo. Tampoco se excluye un segundo puntero que puede sustituir el primero. Son defectos observados en código, aún sin prueba de dispositivo.
- `reordenar.js` se carga sin versión en `recetas/insumos.html:69` y `recetas/index.html:993`; no está en `COMPARTIDOS` de `versionar.js`. Verificar los headers/cachés efectivos al publicar: el archivo sin versión es un riesgo, no prueba de que el reporte actual se deba al caché.

### Trabajo propuesto

1. Reproducir ambas pantallas completas con datos de prueba, dentro y fuera de una ventana flotante. Registrar vista, navegador, viewport, elemento que recibió el toque, estilos efectivos y secuencia de eventos. Usar gestos táctiles del navegador, no únicamente eventos JS sintéticos.
2. Dar al tirador una caja estable (`inline-flex` o botón equivalente) y un área táctil suficiente, propuesta de 44 × 44 px. Aplicar `touch-action:none` desde antes de iniciar el gesto. Mantener el scroll en el resto de la fila y el uso normal de inputs, selectores y botones.
3. En galería, agregar tirador visible durante el modo Ordenar y limitar el arrastre a ese tirador. Evitar que soltar un arrastre abra una ficha o active una acción.
4. Resolver el botón Ordenar en Costeo: propuesta, cambiar explícitamente a Lista y activar el orden manual, puesto que Costeo agrupa presentaciones. No dejar un botón activo que aparenta ordenar una tabla sin esa capacidad.
5. Centralizar la finalización del gesto: soltar, cancelar, perder la captura, desmontar o repintar deben limpiar captura, intervalo, marcas y estado. Ignorar punteros adicionales mientras uno está activo. Cancelar un dedo ajeno no debe cancelar el arrastre válido.
6. Completar autoscroll para el contenedor real y el documento. Comprobar borde superior/inferior dentro del modal y navegación de tablas largas. Definir un umbral de movimiento para distinguir toque de arrastre.
7. Conservar la persistencia actual: `orden` del catálogo y posición de objetos dentro de `ingredientes` del escandallo. Dos ingredientes pueden compartir `insumoId`; su identidad para moverlos debe seguir siendo la de la fila. No reconstruir ingredientes desde el catálogo al arrastrar.
8. Añadir `reordenar.js` al versionado compartido y revisar todas sus inclusiones. No ampliar esto a una reescritura de navegación.

### Aceptación

- Tablet Android/Chrome e iPad/Safari: arrastrar hacia arriba y abajo en catálogo Lista/Galería y escandallo, también dentro del modal. Ratón sigue funcionando. Registrar cuáles dispositivos se probaron realmente.
- El dedo fuera del tirador desplaza la pantalla; campos y acciones siguen utilizables. En modo apagado el catálogo no arrastra.
- Arrastrar hasta un borde desplaza la lista. Cancelar, minimizar, cambiar de vista o repintar durante el gesto no deja el scroll bloqueado ni listeners/intervalos activos.
- Guardar y reabrir conserva el orden. Los importes, cantidades, unidades, vínculos, descripciones y rendimientos permanecen iguales.
- Probar filtros, paginación, retorno de A–Z a A mano, ingredientes repetidos, cero/un ingrediente, segunda sucursal y catálogo de recetas. El orden relativo de elementos fuera del filtro se conserva; no se mueven registros a otro ámbito.
- Ampliar BH27 de `tests/money-tests.js` para limpieza y varios punteros. Su DOM simulado no reproduce las reglas CSS del navegador: añadir una prueba de navegador con touch emulado que falle con el tirador inline del escandallo. La emulación no sustituye la comprobación final en tablet.

## 2. Equivalencias de existencia y diferencia en barra

### Lo encontrado

- Las filas `tipo === 'copa'` calculan sus cantidades internas en **copas**. El contenido por botella está en `fila.contNeto` y el tamaño de copa en `fila.copaML`.
- El resultado en Lista (`_rowCopa`, `recetas/inventarios.js:9474`) ya calcula `fisico = calcExistencia(fila) + adj.fis` y `diferencia = fisico - teorico`. Muestra existencia en botellas y diferencia en una sola unidad, elegida por `_fmtCopSgn`.
- El físico incorpora la parte de ese insumo contenida en prebatch. La línea «del insumo en batches» explica una parte del total; **no debe sumarse por segunda vez**.
- Ya existe `EtaaxCore.equivalenciasLiquidoInventario` (`etaax-core.js:1929`), pero sirve para líquido abierto y aplica `Math.max(0, ml)`. Reutilizarla sin adaptar su contrato borraría las diferencias negativas.
- Hay varias salidas: Lista, Galería (`_step5DesgloseCard`), reporte directivo/gerencial (`verReporteDirectivo`) y reporte de existencias (`_datosReporteExistencias` / `imprimirReporteExistencias`). Compartir conversión y formato donde se muestre la misma magnitud; no crear diferencias en reportes que solo presentan existencias.

### Regla de cálculo

Crear una función pura de equivalencias **con signo** en `etaax-core.js`. Recibe cantidad y las referencias de la misma fila que produjo el resultado:

```text
mililitros = cantidadEnCopas × copaML
botellas equivalentes = mililitros ÷ contenidoBotellaML
onzas líquidas = mililitros ÷ 29.5735
copas equivalentes = cantidadEnCopas
```

Usar el tamaño configurado para cada insumo. No fijar todas las copas en 60 ml ni todas las botellas en 750 ml. No redondear durante el cálculo; redondear únicamente al presentar. El signo debe mantenerse en todas las equivalencias y evitar `-0.00` visual.

| Ejemplo: botella 750 ml, copa 60 ml | Botellas equivalentes | Onzas líquidas | Copas |
| --- | ---: | ---: | ---: |
| Existencia de 1,500 ml | 2.00 | 50.72 | 25.00 |
| Diferencia de −350 ml | −0.47 | −11.83 | −5.83 |
| Diferencia cero | 0.00 | 0.00 | 0.00 |

Son tres expresiones de la misma cantidad, no tres cantidades que se suman. «2 botellas equivalentes» tampoco significa necesariamente que se contaron dos botellas cerradas.

### Trabajo propuesto

1. Introducir el helper con validación de referencias y pruebas. Conservar el contrato de la función para líquido abierto o extenderlo explícitamente sin alterar sus consumidores actuales.
2. Mantener la cifra principal y añadir dos líneas legibles de equivalencias en Físico y Diferencia. Mostrar la referencia de botella/copa, por ejemplo `750 ml/bot · 60 ml/copa`, y conservar el desglose de prebatch claramente identificado.
3. Usar exactamente el físico y la diferencia ya calculados; no recalcular producción, ventas, reparto, costos o porcentajes dentro del formateador.
4. Usar las referencias efectivas de esa misma fila. No consultar de nuevo el catálogo desde el helper: `_filaLive` puede refrescar presentaciones en ciertas vistas; mezclar esa referencia con otra cantidad calculada previamente daría otra conversión. Cubrir la reapertura de inventarios históricos sin introducir una migración de resultados.
5. Llevar el mismo formateador a Galería y reportes pertinentes, con versión para impresión. Revisar ancho de columnas y salto de página para que las nuevas líneas no se corten.
6. En compuestos, convertir **cada presentación antes de agregar**. No usar el contenido/copa del primer miembro para todo el grupo. Para copas de distinto tamaño, mantener desglose por presentación en vez de insinuar un tamaño único. Las botellas agregadas deben indicar que son equivalentes según cada presentación.
7. Si falta contenido, no inventar una cantidad de botellas; si falta copa, no inventar copas. Mostrar `—` y explicar la referencia faltante, conservando las magnitudes que sí se pueden determinar. No convertir gramos/kilos a onzas líquidas ni atribuir copas a cervezas/refrescos contados por pieza sin una equivalencia configurada.

### Aceptación

- Los ejemplos de la tabla y variaciones de 700/750/1,000/1,750 ml, copas de 45/60 ml y copas configuradas en OZ.
- Sobrantes, faltantes, cero, fracciones pequeñas y referencias ausentes. Los negativos no se convierten en cero ni en positivos.
- El mismo insumo en botella abierta, cerrada y dentro de un prebatch. La proporción de cada ingrediente sigue siendo la del reparto vigente.
- Compuestos con botellas y copas diferentes; mercancía por pieza y alimentos por peso conservan su lógica.
- Lista, Galería e impreso coinciden en la magnitud comparable. El total monetario, porcentaje, teórico y alertas de stock no cambian por agregar estas etiquetas.
- Añadir casos de cálculo y de render real a `tests/inventarios-stock-casos.cjs` o un archivo equivalente cargado por `money-tests.js`. Evitar pruebas que solo busquen palabras en el HTML.

## 3. Editor de conteos y entradas desde QR

### Lo encontrado

| Punto | Código auditado | Implicación |
| --- | --- | --- |
| Conteos por envío | `entrada.html:1035`, `enviarConteo` | Cada conteo tiene un ID distinto para sumar bodega, barra, cava, etc. Editar debe conservar el ID original. |
| Historial | `supabase-migration-v78.sql:276`, `entrada_historial` | La respuesta actual no incluye IDs ni versiones de registros para editar. Debe ampliarse mediante una lista explícita de campos. |
| Autor de conteo | Misma RPC / `supabase-migration-v79.sql:166` | El escritor guarda `contadoPor`, pero el historial lee `registradoPor`. Corregir la lectura; un nombre visible no es identidad suficiente para autorizar una edición. |
| Dos clientes | `entrada.html` y `app-movil/app.js:1177` | El QR web y el portal móvil comparten servidor, pero tienen interfaces distintas. Cubrir ambos. |
| Registro de entradas | `supabase-migration-v79.sql:124` | Inserta un registro. Reenviar una edición por esta función no equivale a actualizarla. |
| Registro de conteos | `supabase-migration-v79.sql:166` | Tiene `ON CONFLICT` que sustituye `datos` y solo coteja negocio. No reutilizarlo como editor sin proteger registros existentes: podría reiniciar un conteo aplicado. |
| Entradas importadas | `recetas/inventarios.js:2611`, `_importarEntradasQR` | Se omite un ID ya presente. Una edición remota podría quedar actualizada en el log global pero conservar la cantidad vieja dentro del inventario. |
| Aplicación de conteos | `recetas/inventarios.js:9016` y `:9033` | Se aplica una copia local y después se manda el objeto completo al servidor sin esperar confirmación. Hay que coordinarlo con el editor para no consumir una versión vieja. |
| Editor ERP | `recetas/inventarios.js:11837` y `:11857` | Ya hay interfaz y actualización de las dos copias de una entrada. Reutilizar reglas y componentes útiles, sin trasladar permisos del ERP a un QR público. |

### Comportamiento propuesto

- Añadir **Editar** en «Contados en esta sesión» y en Historial para conteos y entradas elegibles. No esconder el resultado de una edición: volver a mostrar el registro actualizado y sus totales.
- Conteo: editar cantidades de bodega/barra y comentario. Entrada: editar cantidad y los datos de captura pertinentes —tipo, nota y evidencia— usando la interfaz existente como referencia. Mostrar producto, presentación y unidades inequívocamente.
- Conservar producto, sucursal, área y fecha operativa en esta primera entrega. Una corrección que cambia producto o periodo necesita el flujo autorizado del ERP; no convertir una edición de cantidad en una transferencia de inventario.
- Propuesta de permisos: el colaborador edita sus capturas pendientes; un encargado puede editar otras únicamente si el servidor verifica su permiso. Los registros antiguos sin autor estable requieren resolución autorizada, nunca acceso basado solo en que coincida el nombre.
- Conteos aplicados/descartados y movimientos que afecten un inventario cerrado se muestran con motivo de bloqueo. Una rectificación de un cierre es un ajuste autorizado separado. Esta es una regla propuesta para conservar históricos, no una capacidad ya existente.
- Cancelar no escribe nada. Guardar muestra confirmación solo después de respuesta válida. Si falla la red, conservar formulario y explicar que está pendiente; no crear otro registro ni mostrar un guardado ficticio.

### Servidor y persistencia

1. Crear la siguiente migración idempotente libre. Al auditar, la última es **v81** y corresponde **v82**; verificar de nuevo antes de crearla.
2. Ampliar el historial con `id`, tipo de registro, campos editables, versión y capacidad/motivo de edición derivados por servidor. No devolver el JSON completo ni costos, NIP/hash o datos ajenos a la captura. Resolver el nombre de autor compatible con datos históricos.
3. Agregar RPC de edición con ID, versión esperada y campos permitidos. Validar token QR, NIP, identidad estable, pertenencia a negocio/sucursal/área, permiso, estado y periodo. Reusar las reglas de pertenencia de la v80; elegir una sucursal en el cliente no otorga acceso a ella. Mantener RLS y otorgar solo la ejecución necesaria de las RPC, sin abrir `UPDATE` anónimo sobre las tablas.
4. Preservar ID, autor original, `created_at`, `registrado` y fecha operativa. Guardar versión nueva, quién editó, fecha de modificación y auditoría antes/después. `registrado` participa en la asignación de periodo: actualizarlo a «ahora» movería la captura de inventario.
5. Validar cantidades finitas, rangos y unidades. Los conteos pueden corregirse a cero; las entradas siguen la regla vigente de cantidad positiva. El editor debe cargar las unidades normalizadas: `_aPiezas` ya convirtió cajas/paquetes a piezas al enviar, por lo que no se multiplican de nuevo.
6. Usar bloqueo/versionado para impedir que dos editores se sobrescriban. Proteger también las puertas antiguas: el `ON CONFLICT` del registro de conteos no debe permitir saltarse permiso, versión o estado del editor. Reintentos con el mismo identificador deben ser idempotentes y no repetir el registro ni la auditoría.
7. Conservar el control de intentos de NIP de v79: un rechazo después de contabilizar un intento inválido no debe lanzar una excepción que revierta ese contador. Probar el flujo real de las RPC nuevas, no solo inspeccionar su texto.
8. Coordinar **editar y aplicar conteo**. Recomendación: consumo mediante RPC autenticada que valide la versión, actualice el inventario y selle el conteo en la misma transacción, con ID de operación idempotente. La edición y el consumo deben bloquear la misma fila. Una pestaña antigua tampoco debe poder sobrescribir el estado con un `update` completo.
9. Conservar recuperación ante mala conexión: la operación de aplicar puede quedar pendiente localmente y reintentarse de forma idempotente, sin bloquear toda la captura. No considerar consumido un conteo por una escritura local que el servidor rechazó; reconciliar el pendiente antes de permitir doble aplicación o cerrar el inventario.

### Integración del inventario y clientes

1. Actualizar `entrada.html` y `app-movil/app.js`, con estilo del portal, botones accesibles con touch y mensajes de conflicto/registro aplicado. Escapar comentarios y demás texto del usuario.
2. Invalidar y recargar el historial tras guardar. Corregir el elemento de la sesión por su ID; no hacer `unshift` como si fuera un nuevo conteo.
3. En `_reloadEntradasRT` / `_importarEntradasQR`, reconciliar por ID y versión las entradas **ya importadas de inventarios abiertos**. Actualizar la copia sin añadir otra; no tocar capturas manuales ajenas ni históricos cerrados. El cambio debe persistir y sobrevivir una recarga.
4. Invalidar el resumen, consumo y reparto afectados usando la lógica existente de `_invalidarStep5`. Un evento realtime de edición también debe repintar aunque no se haya añadido ninguna entrada nueva.
5. Revisar `_miCambioGana`, la cola offline y los guardados completos del ERP para que un objeto local antiguo no revierta una edición nueva. Los marcadores de importación no deben reescribir accidentalmente la captura completa con datos viejos.
6. Recargar propuestas de conteo cuando cambie su versión. Un conteo editado sigue pendiente de aceptación en el ERP; editarlo desde QR no equivale a aplicarlo automáticamente.
7. Versionar los assets web y actualizar el caché de `app-movil/sw.js` si se cambia el cliente móvil. Publicar primero la migración compatible y después los clientes; comprobar también una pestaña con código anterior.

### Aceptación

| Prueba | Resultado requerido |
| --- | --- |
| Conteos de 10 y 5; editar el primero a 8 | Quedan dos IDs y total pendiente 13. No aparece un tercer conteo. |
| Dos cajas de 24 piezas; corregir a 36 piezas | Quedan 36, no 864; la unidad visible corresponde al valor. |
| Entrada importada de 10 botellas; editar a 8 | Log e inventario abierto quedan en 8; el disponible baja 2, sin añadir otras 8. |
| Guardar dos veces o perder respuesta después del commit | Una operación efectiva y una modificación auditada. |
| Dos dispositivos editan la misma versión | Uno guarda; el otro recibe conflicto y puede recargar sin perder silenciosamente su captura. |
| ERP aplica mientras QR edita | Se aplica una versión confirmada o se rechaza por conflicto. Nunca cantidades diferentes entre ambos. |
| Registro aplicado, descartado o inventario cerrado | Rechazo desde servidor y explicación visible; no basta desactivar el botón. |
| Otro negocio/sucursal/área/autor o NIP inválido | Sin lectura/escritura indebida; el freno de intentos sigue vigente. |
| Borrar comentario, cancelar o escribir texto con HTML | Borrado real del comentario; cancelar sin cambios; texto escapado. |
| Modificar una entrada en otro dispositivo y recargar | Reporte y log conservan el valor nuevo; el caché/outbox antiguo no lo revierte. |

## Orden de entrega y validación

1. **Touch:** cambio compartido, integración, prueba de navegador y comprobación en tablet. Es la corrección más acotada y tiene una reproducción concreta en escandallo.
2. **Equivalencias:** helper probado y presentación coherente en resultados/reportes, sin cambiar saldos.
3. **QR:** contrato y migración, reconciliación del ERP, ambos clientes y pruebas de concurrencia. No publicar el botón antes de que estén listas las reglas del servidor.

Leer `CLAUDE.md` y verificar el estado del repositorio antes de implementar. No sobrescribir cambios concurrentes ni mezclar estas facturas con el modelo comercial 2027.

Pruebas existentes que sirven de base:

```sh
node tests/money-tests.js
node tests/store-tests.js
node tests/probar-ventanas-insumos.cjs
node tests/probar-portal-qr.cjs
PGLITE_DIR=/tmp/pglite node tests/probar-sql-v78-v79.mjs
```

Las pruebas de navegador requieren Chrome o `CHROME_BIN`. Las SQL requieren PGlite instalado fuera del proyecto; no ejecutar pruebas de escritura sobre datos de producción. Crear una prueba SQL para la nueva migración y carreras de edición/aplicación; las suites antiguas no certifican esa capacidad.

Después de modificar los assets compartidos:

```sh
node versionar.js
node versionar.js --revisar
```

Revisar el diff generado, ejecutar los checks exigidos antes del push y entregar por factura: archivos cambiados, comportamiento resultante, pruebas ejecutadas y limitaciones verificadas. Para el despliegue QR, registrar separadamente aplicación de migración y publicación web: hacer push no aplica SQL.

## Evidencia y límites de esta auditoría

- Lectura del código, las integraciones y las definiciones SQL hasta v81.
- Prueba aislada de navegador con el componente real: falla el tirador inline del escandallo; funciona con ajuste de caja táctil en memoria. Catálogo flex funciona en esa reproducción mínima.
- Base de pruebas ejecutada: `money-tests.js`, **4,827 comprobaciones y cero fallas**; `store-tests.js`, **84 comprobaciones y cero fallas**. El fallo táctil reproducido pasa inadvertido para la suite actual: los resultados no certifican todavía estas tres facturas.
- No se cambió código de aplicación con esa prueba. No se probó una tablet física ni se reprodujo todavía el fallo del catálogo en su página completa.
- No se escribieron datos de producción. Las reglas del editor son un diseño para implementar y probar, no funciones ya disponibles.
