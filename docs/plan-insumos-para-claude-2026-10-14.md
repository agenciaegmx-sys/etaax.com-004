# Instrucciones para Claude: aislamiento de insumos por sucursal

Preparado el 14-oct-2026 sobre `49c6d87`. [Diagnóstico y evidencia](auditoria-insumos-sucursales-2026-10-14.md).
El hub ya está publicado; esta tarea es una reparación de identidad y alcance.
Esta entrega contiene el plan: **no se ha ejecutado la reparación**.

## Encargo

Implementa el modelo descrito por Edwin:

- El catálogo global del negocio tiene maestros únicos con ID maestro.
- Cada sucursal importa una **copia con ID propio**, ligada al maestro y editable
  por separado. Si se importa desde ETAAX, conserva también la procedencia ETAAX.
- Editar/borrar/desactivar una copia local no altera la ficha de otra sucursal.
- Los cambios de ficha se ofrecen como novedades y cada destino decide aplicarlos.
- QR, portal/app staff, entradas, mermas, cortesías/préstamos, conteo,
  escandallos, requisiciones e inventarios usan solo el catálogo de su sucursal;
  el área limita además lo que ve el colaborador.
- Un producto ya importado no se importa dos veces en la misma sucursal.
  Una posible coincidencia al dar de alta avisa antes de crear otro producto.

Lee `CLAUDE.md` y respeta `EtaaxCore` como fuente de cálculos. Conserva los
cambios del hub/QR ya publicados y cualquier trabajo paralelo. No arregles el
aislamiento cambiando fórmulas, ocultando filas en CSS o deduplicando por nombre
durante el render. No borres/copias datos masivamente al abrir una página.

## Contrato de identidad y alcance

Mantén `id` y `origenId` compatibles con los datos existentes. Añade una
distinción persistida de maestro/copia local para que `!origenId` deje de ser
la única forma de decidir el ámbito. Un registro local desvinculado sigue
siendo local, aunque no tenga `origenId`. Ejemplo orientativo:

```js
// Maestro del negocio
{ id:'m_123', ambito:'maestro', origenEtaaxId:'etaax_987',
  sucursalId:'', sucursales:[] }
// Copia local
{ id:'c_s1_456', ambito:'sucursal', origenId:'m_123',
  sucursalId:'s1', sucursales:['s1'] }
```

Antes de fijar esos nombres, verifica que no choquen con campos existentes.
`origenEtaaxId` es procedencia de plataforma; `origenId` es parentesco con el
maestro del negocio. No sobrecargues uno para representar ambos niveles.

Normaliza Matriz como `suc_principal` en escrituras nuevas y admite `''` en
lecturas antiguas. Contexto vacío debe resolverse explícitamente a Matriz o
pedir contexto; jamás debe devolver todas las sucursales en una operación local.
El modo global debe ser explícito y autorizado.

Separa dos operaciones en un helper común:

1. Identidad canónica, independiente de la sucursal: permite comparar alias
   antiguos y maestro sin cambiar los IDs guardados.
2. Resolver operativo `(negocio, sucursal, id)`: devuelve copia válida local,
   o ausencia/conflicto. Un ID local de otra sucursal se rechaza. Un ID maestro
   antiguo se resuelve solo si existe copia válida en la sucursal indicada.
   No retorna un maestro global como reemplazo automático en operaciones nuevas.

Para reportes globales, usa un resolver de maestro explícito. Para documentos
históricos, usa el ámbito del documento y sus snapshots; no recalcules su
identidad según la sucursal que esté seleccionada en otra pantalla.

## Orden de ejecución

### 1. Convertir las reproducciones en regresiones y verificar esquema

Ejecuta primero `docs/auditoria-insumos-2026-10-14/reproducir.cjs`. Este script
documenta errores actuales; cambia las expectativas en pruebas de regresión
para exigir el contrato correcto y comprobar que fallan antes del arreglo.
Mantén controles positivos: fork profundo, filtrado de 200/500/100, borrado local
y separación de área explícita. Usa datos ficticios y una base de pruebas.

Comprueba en un entorno autorizado las columnas de `negocio_insumos`, claves
de pedidos, políticas RLS vigentes y definiciones de RPC instaladas usando
`information_schema`, `pg_policies` y `pg_get_functiondef`. Las últimas
definiciones del repositorio son v27/v61/v78/v79; no diagnostiques con una
versión antigua si ya fue reemplazada. Confirma límite de filas de API.
Las migraciones nuevas deben tener versión superior a la última vigente al
momento de ejecutarlas, ser repetibles y traer comprobaciones de lectura.

### 2. Frenar nuevas fichas compartidas y pérdida de vínculos

Archivos: `recetas/insumos.js`, `recetas/insumos.html`, `insumo-label.js`.

- `guardarInsumo`: preservar `id`, `origenId`, ámbito, sucursal, procedencia,
  `createdAt`, historial y metadatos no editables. Cambiar solo campos del
  formulario. No copiar accidentalmente la membresía de otro registro.
- Unificar `ignAgregar`, `cgAgregar`, `guardarInsumoSuc`, alta manual y duplicado
  detrás de una operación de importar maestro a sucursal. Clonar profundamente,
  generar ID local y conservar el maestro sin membresía.
- El picker global del negocio ofrece maestros; copias hermanas no deben
  aparecer como productos adicionales. Si se ofrece usar una ficha de otra
  sucursal como base, primero identifica su maestro y explicita qué se copia.
- Reimportar mismo origen en misma sucursal es idempotente: mostrar «Ya agregado»
  o abrir la copia existente. Revisar duplicado antes y después de awaits.
- Alta manual: advertir coincidencias con identidad normalizada incluyendo
  marca/variedad y datos de presentación o códigos cuando existan. Ofrecer usar
  existente o confirmar variante distinta. No fusionar automáticamente por texto.
- La cancelación de adopción cancela; crear variante distinta debe ser una
  elección explícita. Añadir unicidad servidor para una copia por
  `(negocio, sucursal, maestro)` y procedencia ETAAX del maestro, después de
  clasificar/limpiar conflictos. Los conflictos deben devolver la copia existente.
- Invalidar índices por una revisión del catálogo o actualizaciones inmutables;
  `_copiasDe` y resolvers no deben quedar viejos al reutilizar el mismo array.

Aceptación: importar en S1 y S2 produce dos IDs locales diferentes. Editar S1
conserva `origenId`, la fecha de creación e historial; S2 no cambia. El global
continúa mostrando un solo maestro. Repetir el clic/solicitud no crea una segunda
copia aunque se haga desde dos dispositivos a la vez.

### 3. Sincronizar solo cambios y reparar el importador CSV

Archivos: persistencia en `recetas/insumos.js`, importador y nuevos helpers/RPC.

- El debounce de `setInsumos` no debe subir el catálogo completo tras una edición
  local. Mantener cola de IDs/operaciones modificadas por negocio y sucursal;
  vaciarla de forma durable y reintentar únicamente esos cambios.
- Añadir control de versión/`updated_at` comprobado en servidor para rechazar
  edición basada en snapshot viejo, con opción de recargar y comparar. Una
  actualización sin condición desde memoria vieja no debe pisar ficha nueva.
- No limpiar tombstones de IDs que no se estén reactivando deliberadamente.
  No borrar por diferencia entre una carga parcial y el caché local.
- CSV: destino explícito (global o sucursal), vista previa de altas/actualizaciones,
  identidad estable entre pasos y conservación de IDs. No buscar por nombre
  en todo el negocio, no retirar `_csvRow` de otras sucursales y no vaciar
  presentaciones/fotos como efecto lateral. Reimportar archivo debe ser idempotente.
- Retirar o adaptar `actualizarEnGlobal` antiguo; preservar siempre identidad,
  ámbito y membresía del destino en cualquier propagación.

Aceptación: dos sesiones editan S1/S2 desde snapshots distintos; ambos cambios
persisten. CSV S1 no cambia ni retira fichas S2, y volver a importar conserva
referencias de recetas/inventarios ya existentes.

### 4. Unificar lectores operativos y validar en servidor el QR

Archivos: `insumo-label.js`, `app.js`, `entrada.html`, `app-movil/app.js`,
`staff-area.js`, `recetas/inventarios.js`, `recetas/requisiciones.html`,
`recetas/index.html` y migraciones SQL nuevas.

- Usar el alcance explícito común antes de buscar/listar/calcular. El colapso por
  producto no debe reintroducir un maestro descartado ni sustituir una copia
  renombrada por comparación de nombre.
- El documento manda en inventarios: si negocio/sucursal de la pestaña difieren,
  cambiar al contexto correcto de forma controlada o rechazar apertura/captura.
  Aplicar esa misma regla a entradas, mermas, salidas y conteos importados.
- Revisar `.find` crudos. `_empaqueDeFila`, `getContenidoPorPieza`, peso bruto,
  fichas, consumo, costo vivo y subrecetas deben tomar la presentación de la
  copia local. Mantener snapshots históricos cuando ese sea su propósito.
- Nuevas operaciones guardan `insumoId` local y, si hace falta, `maestroId` como
  referencia secundaria. Mantener lector de referencias antiguas; no reescribir
  historial automáticamente ni sumar dos veces maestro y copia.
- QR/portal: resolver sucursal y área desde el perfil autenticado del colaborador;
  si falta perfil/ámbito, impedir la captura con una instrucción de asignación.
  El parámetro `s` del enlace no autoriza otra sucursal.
- Catálogo RPC nuevo por token+NIP: filtrar negocio, sucursal, estado y área en
  servidor; devolver solo campos necesarios para seleccionar y contar. No
  mandar maestros no asignados ni fichas completas de otras sucursales para
  filtrarlas únicamente en JavaScript.
- `entrada_registrar` y `inventario_conteo_registrar`: comprobar existencia y
  pertenencia de insumo/receta y validar/derivar sucursal/área antes de insertar.
  Revalidar estado para un catálogo abierto antes de una baja/cambio de pertenencia.
  Conservar guardia NIP v78/v79 y protección contra IDs de otro negocio v76/v79.
- Un insumo sin área/familia debe aparecer como pendiente de asignación para
  administración; no extender silenciosamente catálogo del barman a todo el negocio.
- Paginación estable en todas las cargas; reemplazar orden `created_at` de
  requisiciones si no existe. Incluir `_global`/ámbito necesario en recetas QR.

Aceptación: con el fixture completo, S1/S2/S3 ven **200/500/100** productos
locales en todos los consumidores antes de aplicar el filtro de área. Barra
no ve cocina; Matriz funciona con datos viejos y nuevos. Insumo local dado de
baja o eliminado no reaparece por resolver al maestro. Un payload con ID o
sucursal ajenos se rechaza en servidor, aunque el cliente omita su filtro.

### 5. Aislar requisiciones por sucursal

Archivos: `recetas/requisiciones.html`, persistencia `req_pedido/req_historial`
y migración. Separar documento de pedido por `(negocio, sucursal)`, no solo
un objeto del negocio con claves de insumos. Archivos existentes y nuevos
snapshots deben tener sucursal explícita.

Archivar, limpiar, cargar anterior, restaurar existencias, imprimir, exportar,
calcular resumen y compra vs. venta deben operar únicamente sobre ese pedido.
Migrar el documento anterior con una clasificación por copia/membresía; los
IDs ambiguos de registros compartidos van a revisión, no a todas las sucursales.
Historial antiguo sin alcance debe permanecer consultable, separado de la
restauración operativa hasta poder atribuirlo.

Aceptación: archivar S1 conserva pedido manual/no-pedir/notas/existencias S2;
su snapshot contiene solo S1 y su resumen coincide. Dos sucursales abiertas
en dispositivos diferentes no sobrescriben pedidos entre sí.

### 6. Hacer independientes las decisiones de novedades

Archivos: histórico/alertas en `recetas/insumos.js` y persistencia de decisiones.

- Evento con ID/revisión estable y procedencia; decisión por
  `(negocio, sucursal destino, evento)`, persistida en servidor para todos sus
  dispositivos. Atender desde el global no cuenta como aceptación en cada copia.
- Registrar diferencias de todas las presentaciones usando IDs de presentación,
  no solamente índice 0. Capturar cambios relevantes de empaque y costeos.
- Distinguir «aplicar estos cambios» de «reemplazar toda la ficha»; mantener los
  campos personalizados locales salvo elección explícita. Mostrar conflicto si
  el campo local cambió después de la revisión propuesta.
- Edición de ficha no modifica hermanos automáticamente. Un cambio de sucursal
  puede proponerse al maestro; una vez promovido, las demás aceptan esa revisión.
  Si se conserva aviso directo entre hermanas, identificarlo claramente y no
  confundirlo con actualización aprobada del maestro.
- Desvincular mantiene la copia local y suspende novedades del maestro.
  Definir por separado la acción global de activar/desactivar todas las copias
  y mostrar su alcance antes de aplicarla.

Aceptación: aplicar/descartar en S1 no cambia valores ni pendientes S2; abrir
S1 en otra tablet refleja su decisión. Precio de presentación 2 genera aviso
y puede aplicarse sin sobrescribir precio carta/proveedor locales no seleccionados.

### 7. Reparar datos existentes con respaldo y mapa de alias

Solo después de bloquear las causas anteriores. Preparar herramienta de
diagnóstico **dry-run** con totales, conflictos y mapa propuesto, sin cambios
al cargar la app. Respaldo del catálogo y documentos dependientes; guardar el
mapa maestro → copias → sucursales y su inverso para poder revertir.

Clasificar: maestros reales; copias válidas; registros con varias membresías;
copias sin padre; registros locales que perdieron origen; múltiples copias del
mismo maestro/sucursal; procedencia ETAAX mezclada; IDs referenciados inexistentes.

- Compartidos: conservar ID antiguo como maestro/alias y crear copias por
  sucursal con los datos apropiados. Alias operativo siempre incluye sucursal.
- Locales que perdieron padre: no reconstruir parentesco solo por nombre.
  Usar respaldo/historial/ID ETAAX y presentar coincidencias ambiguas para revisión.
- Duplicados: preservar variantes y los IDs referenciados. Unificar solo con
  evidencia y mapa de referencias aprobado; no sumar o borrar capturas duplicadas
  sin inspeccionar datos. No cambiar importes ni balances históricos.
- Borrado: copia local retira solo esa copia; documentos antiguos conservan
  etiqueta/snapshot. Maestro con copias se archiva o desvincula mediante acción
  explícita que mantenga datos locales y procedencia histórica.

La aplicación de una migración real debe ser un paso explícito separado del
diagnóstico, con transacción/lotes reanudables e idempotencia. Repetir el plan
no debe crear otras 800 copias ni perder diferencias locales.

### 8. Validación y entrega

Pruebas de contrato y navegador con backend simulado; integración RPC en base
de pruebas para verificar realmente rechazo/aceptación, constraints, concurrencia
y RLS. No considerar suficiente inspeccionar cadenas del SQL o pasar fórmulas.

Casos mínimos adicionales: 1,800+ filas paginadas; contexto vacío; Matriz `''`
vs `suc_principal`; copia renombrada; copia borrada/inactiva; maestro ausente;
variantes con mismo nombre; varios empaques/costeos; subreceta como insumo;
guardar sin cambios; volver a importar; dos solicitudes simultáneas; cambio de
sucursal con inventario abierto; decisión de alerta en otra tablet; referencias
antiguas maestras/locales; cierre y reapertura sin cambiar resultados.

Ejecutar candados requeridos:

```sh
node tests/money-tests.js
node tests/store-tests.js
node tests/probar-cuenta-header.cjs
node versionar.js --revisar
git diff --check
```

Actualizar huellas de JS/CSS/HTML con el sistema del repo. Si cambia la app
móvil, subir versión de `app-movil/sw.js` y comprobar actualización instalada.
Entregar commits por etapa, listado de migraciones aplicadas/pendientes,
antes/después con fixture 1000/200/500/100, evidencia de pruebas, conteo de
conflictos de datos pendientes y procedimiento de reversión. Verificar recursos
publicados y RPC vigentes después del despliegue autorizado.

Orden de publicación: guardas y compatibilidad → bloqueos de escrituras erróneas
→ aislamiento de lectores/RPC/pedidos/alertas → reparación de datos revisada →
constraints definitivos. Para cada corte, explicar qué está corregido y qué
sigue pendiente; no presentar la migración de datos como completada por haber
publicado únicamente cambios de interfaz.
