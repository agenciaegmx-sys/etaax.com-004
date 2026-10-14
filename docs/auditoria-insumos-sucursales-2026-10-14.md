# Auditoría de insumos: maestro y copias por sucursal

Fecha: 14-oct-2026. Código revisado: `49c6d87`, rama `main`.
Petición de Edwin: revisar aislamiento, duplicados, borrado y alertas desde el
catálogo ETAAX y el global del negocio hasta los catálogos de sucursal, QR,
escandallos, requisiciones e inventarios. Esta entrega es **diagnóstico y plan**.
No se corrigieron estos flujos ni se leyeron/escribieron datos de clientes.

## Resultado

**El modelo deseado existe parcialmente, pero los caminos de alta, importación,
edición y lectura no lo respetan de forma uniforme. Hay cruces reproducibles.**

La prueba con 1,000 maestros y copias independientes de 200/500/100 insumos
devuelve correctamente 200/500/100 en el filtro normal de inventarios cuando
hay sucursal explícita. El QR devuelve **1,000 en cada sucursal** porque deja
pasar los maestros sin asignación. La app móvil repite esa regla.

Los problemas de mayor impacto son: perder `origenId` al editar, compartir un
registro al importar en otra sucursal, modificar otras sucursales por CSV o
por sincronización del catálogo completo, y archivar requisiciones mezcladas.
Las alertas también comparten decisiones entre sucursales en un dispositivo.

Se ejecutaron **27 escenarios locales: 23 síntomas reproducidos y 4 controles
correctos**. Varios síntomas comparten una causa; no son 23 causas independientes.
El script ejecuta funciones originales en Node/VM, con DOM, persistencia y
sincronización simulados. No hace llamadas de red. Las comprobaciones SQL son
lectura de las migraciones del repositorio, **no ejecución contra Supabase**.

- [Reproducciones](auditoria-insumos-2026-10-14/reproducir.cjs).
- [Resultados de cada escenario](auditoria-insumos-2026-10-14/evidencia.jsonl).
- [Plan e instrucciones para Claude](plan-insumos-para-claude-2026-10-14.md).

Repetir: `node docs/auditoria-insumos-2026-10-14/reproducir.cjs`.
El script confirma los comportamientos observados en esta versión; **no es un
candado que certifique aislamiento**. Al corregirlos hay que convertirlos en
pruebas del comportamiento esperado, sin preservar los errores como requisitos.

## Modelo encontrado

| Nivel | Persistencia / identidad actual | Observación |
| --- | --- | --- |
| ETAAX, plataforma | `catalogo_insumos` | Catálogo independiente del negocio. Su importador conserva el mismo ID en `negocio_insumos`; falta una relación de procedencia separada. |
| Global del negocio | `negocio_insumos`, PK `(negocio_id, insumo_id)`, `datos.id` | Convive físicamente con todas las copias; estar en la misma tabla no es un error si el alcance se valida. La vista global usa `!origenId` como equivalente a maestro. |
| Copia de sucursal | `id` diferente, `origenId` del maestro, `sucursales:[sucursal]` y `sucursalId` | El alta manual moderna y `_forkInsumo` pueden crear este modelo correctamente. Los importadores antiguos todavía crean membresías compartidas. |
| Referencias operativas | Mezcla de ID local y maestro | El escandallo guarda el ID seleccionado. Entradas/mermas/salidas QR y filas del inventario suelen usar `origenId || id`; el conteo QR guarda el ID seleccionado. |
| Resolución | `_makeInsumoResolver` | Convierte referencias al maestro y busca copia según sucursal de la pestaña; puede volver al maestro aunque no pertenezca a esa sucursal. |
| Alertas | `historial` de cada insumo y `nov_vistas_ins` local por negocio | El parentesco depende de `origenId`; la decisión de atender no incluye sucursal y no se sincroniza entre dispositivos. |

Usar un ID maestro en datos antiguos **no implica por sí solo un cruce**: puede
servir de alias si se resuelve con negocio y sucursal explícitos y existe una
copia válida. Aquí los fallos están en el retorno al maestro, la pérdida de la
liga, las membresías compartidas y los consumidores que omiten el resolver.
No conviene cambiar masivamente IDs de inventarios históricos para arreglarlo.

## Hallazgos y evidencia

### F01 · P1 · Editar una copia pierde su relación con el maestro

`recetas/insumos.js:5471–5600`, `guardarInsumo`, construye una ficha nueva y
conserva membresía y la relación de producción propia, pero no copia `origenId`
del registro original. Tampoco conserva de forma general otros metadatos:
`createdAt` se vuelve a asignar; un guardado sin diff puede perder el historial.

Reproducción: editar `c_s1` ligada a `m` elimina `origenId`; el global pasa de
un maestro a **dos registros visibles**, aunque el segundo siga en S1. La copia
de S2 queda ligada a `m`. Se rompe el vínculo para resolver costos y novedades.

### F02 · P1 · Importar «aquí» vuelve a compartir registros

- `recetas/insumos.html:957`, `ignAgregar`, agrega la sucursal al array del
  **mismo objeto**. No genera un ID nuevo. El selector (`ignFiltrar:915`) ofrece
  maestros y copias de otras sucursales como candidatos independientes.
- `recetas/insumos.html:1323`, `cgAgregar`, clona una vez con el ID ETAAX y, al
  importarlo en otra sucursal, agrega membresía al mismo registro existente.

Reproducción: copiar `c_s1` a S2 termina en `sucursales:['s1','s2']`, con el
mismo ID. Importar ETAAX en S1 y S2 deja un solo ID, sin `origenId`, compartido.
Cambiar precio, copa o presentación desde cualquiera modifica ambas.

### F03 · P1 · Borrar una copia es seguro solo si esa copia era independiente

`recetas/insumos.js:3167`, `eliminarInsumo`, y `:662`,
`_borrarInsumosSupabase`, borran por negocio e ID; no hay un borrado en cascada
de las otras copias. **Esto es correcto para registros bien formados**.

Con la copia compartida creada por F02, borrarla desde S2 elimina el mismo
registro que usaba S1. El borrado no puede adivinar que debía conservar una
segunda copia que nunca existió. La reparación debe empezar por el modelo.

Al borrar un maestro el texto promete que las copias quedan independientes,
pero la función no quita su `origenId`: quedan con padre inexistente. Hay que
definir la política de retiro de maestros y referencias históricas.

### F04 · P1 · QR y app móvil admiten maestros no asignados

`entrada.html:498`, `_enSucQR`, y `app-movil/app.js:361`, `enSuc`, retornan
`true` para registros sin membresía y para contexto sin sucursal. La regla
compartida `insumo-label.js:206`, `_insumoEnSuc`, retorna `false` para un
insumo global no asignado. Son reglas opuestas.

En `entrada.html:663`, primero se filtran activos y luego se agrupan por
maestro. Si la copia local está inactiva, puede sobrevivir y seleccionarse el
maestro activo. La sucursal vuelve a ver un producto que dio de baja.
Una copia Matriz creada con `sucursales:['']` es válida para el helper común,
pero el QR con `s=suc_principal` no normaliza ese valor y la descarta.

Entradas, mermas de insumo, cortesías/préstamos y conteo comparten `INSUMOS`;
por tanto el defecto alcanza a todos esos buscadores. Las recetas para merma
de producto/salida usan la misma regla permisiva con `RECETAS`.

El perfil del colaborador sí puede fijar su sucursal y área antes de cargar
el catálogo. Sin embargo, un fallo del perfil deja el alcance del enlace.
`staff-area.js:167`, `veInsumo`, muestra a todas las áreas los insumos sin área
ni familia. Barra excluye cocina cuando el área está explícita; el dato sin
clasificar necesita tratamiento de asignación, no autorización implícita.

### F05 · P1 · Resolver puede traer un maestro ajeno al alcance

`insumo-label.js:106–140`, `_makeInsumoResolver`, retorna maestro como última
opción sin validar pertenencia/estado. También rechaza como candidata la copia
si su nombre difiere del maestro. Eso contradice la edición independiente.

Reproducciones: después de borrar la copia S1, resolver `m` todavía entrega
`m`; renombrar `c_s1` hace que incluso resolver **su propio ID** entregue `m`.
En `app.js:1361`, `_unoPorProducto`, se llama al resolver después de filtrar
el catálogo de sucursal: por eso el buscador puede reintroducir ese maestro
que había quedado fuera del filtro. No basta con filtrar la lista inicial.

### F06 · P1 · Contexto vacío o distinto al documento cambia el inventario

`recetas/inventarios.js:94`, `_scopeSucInsumos`, con sucursal vacía devuelve
todos los activos. En la prueba: **1,800 registros** —maestros más todas las
copias—. `app.js:1329`, `_calcCatalogoInsumosScope`,
`recetas/requisiciones.html:603`, `getInsumosCatalogo`, y
`recetas/insumos.js:844/5310` tienen salidas igualmente abiertas.

Además, el filtro y el resolver usan la sucursal de la pestaña, no la de
`invActual`. Con un inventario S2 y pestaña S1, el helper entrega 200 registros
de S1 en vez de 500 de S2. La navegación normal reduce la posibilidad al listar
inventarios por sucursal; falta una validación al abrir/recalcular que garantice
que contexto y documento coincidan. Es una condición reproducida, no evidencia
de que ese caso haya ocurrido en los inventarios reales del usuario.

La importación de entradas y recomputación de mermas/salidas
(`inventarios.js:2440/2494/4759`) usa también sucursal activa y permite registros
sin sello de sucursal. `cargarConteosQR:8532`, en cambio, compara explícitamente
la sucursal de `invActual` y el área: una guarda correcta que debe conservarse.

### F07 · P1 · CSV puede modificar otra sucursal y romper referencias

`recetas/insumos.js:5839`, `procesarProductos`, busca coincidencias en **todo**
el negocio solo por nombre/variedad, sin marca ni sucursal. Sobrescribe campos
con `Object.assign`, incluyendo `presentaciones:[]` y `foto:''`.

Reproducción desde S1: el único insumo coincidente pertenece a S2, tiene otra
marca y costo 900; el importador lo modifica y vacía sus presentaciones.
La reconstrucción inicial excluye todos los registros con `_csvRow`, de
cualquier sucursal, y crea otros IDs: una reimportación puede dejar referencias
antiguas sin registro. Los pasos de presentaciones/costos vinculan por posición
de fila, no por una identidad estable de producto y ámbito.

### F08 · P1 · Sincronización puede sobrescribir fichas ajenas con una copia vieja

`recetas/insumos.js:451`, `setInsumos`, agenda sincronizar **todo el array**.
`_sincronizarInsumosSupabase:623` hace upsert de los JSON completos.

Reproducción: guardar un array donde solo cambió `c_s1` envía
`m`, `c_s1` y `c_s2`. Si S2 cambió después de la carga de S1, ese upsert puede
reemplazar el dato remoto nuevo de S2 con su versión vieja. La pérdida remota
por concurrencia es una consecuencia del upsert completo; no se ejecutó contra
clientes. El editor principal cancela ese debounce y sincroniza solo su ficha;
otros caminos —importación, aplicación de novedades, desvinculación y borrado—
siguen pasando por el debounce del catálogo completo.

Además, `_copiasDe:38` invalida por referencia del array. Las altas del editor
mutan ese mismo array antes de llamar `setInsumos`. Reproducción: consultar el
índice sin copias, agregar una y guardar el mismo array deja **una copia real y
cero indexadas**. Badges y vinculación pueden trabajar con un índice viejo.
El resolver de insumos/inventarios también usa referencia por defecto; revisar
invalidación después de modificaciones, no solo después de pulls de la nube.

### F09 · P1 · Requisiciones archiva y limpia pedidos de otras sucursales

`recetas/requisiciones.html:559–596` usa un `req_pedido` por negocio;
`supabase-migration-v8.sql:80` confirma PK únicamente `negocio_id`.
`cerrarRequisicion:1186` archiva todo `reqData`, sin `sucursalId`, y limpia
pedido manual/no-pedir/notas de **todos** los IDs.

Reproducción: archivar S1 borra el pedido manual y nota de S2, y el snapshot
contiene ambas sucursales aunque su resumen correspondía solo a S1.
Dos dispositivos también guardan el documento completo del negocio; separar
IDs de insumos no resuelve por sí solo ese sobrescrito del pedido.

### F10 · P1 · Empaque y contenido todavía pueden salir del maestro

`inventarios.js:4787`, `_empaqueDeFila`, toma la primera coincidencia canónica
del catálogo completo. Si el maestro va primero, usa su empaque.
`app.js:1410`, `getContenidoPorPieza`, busca por ID crudo, como otros lectores
en `app.js:1540/1946` y `inventarios.js:2859/11897`.

Reproducción: caja local de 12 y maestro de 24 → selector usa **24**. Contenido
local 750 ML y maestro 1000 ML → helper por maestro devuelve **1000 ML**.
Esto afecta unidades y cantidades aunque el buscador visual muestre la copia.
Cada `.find` crudo requiere revisar si está leyendo identidad exacta, datos
vivos operativos o un snapshot histórico; no reemplazar todos a ciegas.

### F11 · P1 · Novedades no lleva una decisión independiente por destino

`insumos.js:3576–3583`: `nov_vistas_ins` se guarda localmente por negocio;
la llave del evento es `insumoId|ts`, sin sucursal. Reproducción: descartar una
novedad global en S1 hace que S2 ya no la vea **en el mismo dispositivo**, sin
haber elegido aplicar/descartar allí. Otro dispositivo no recibe la decisión.

`_novLista:3588` filtra los cambios de otra sucursal, salvo si son globales:
un cambio S1 no alerta a S2, pese a comentarios/promesas de alertas entre
hermanos. `:3478` compara solo `presentaciones[0]`; cambiar el precio de la
segunda presentación produce **cero diferencias** y no genera aviso de edición.

Lo rescatable: `_novAplicarAqui:3974` aplica explícitamente solo los campos del
diff, conserva la identidad del destino y deja procedencia. `_novAplicarSel:3900`
conserva ID/membresía, pero reemplaza la ficha completa de destinos elegidos;
son dos acciones diferentes y la UI debe decirlo claramente.

### F12 · P2 · Falta alerta de duplicado en altas nuevas

`guardarInsumo` solo valida nombre obligatorio, no busca una copia existente
del maestro ni coincidencias del producto. Dos altas idénticas generan dos
maestros y dos copias locales **sin ninguna alerta**.

`guardarInsumoSuc:102` sí ofrece adoptar un insumo local con nombre/marca/variedad
coincidentes. Su CANCELAR crea otra copia, avisando que habrá dos. Tiene una
advertencia, pero conviene separar «cancelar» de «crear producto distinto».
La PK evita repetir exactamente el mismo ID, no dos IDs del mismo producto.
No deduplicar por nombre a ciegas: formatos, marcas, maduración y variantes
legítimas deben conservar identidad propia.

### F13 · P1 · SQL del QR autentica negocio/NIP, pero no valida el alcance del insumo

Definiciones más recientes del repositorio:

- `entrada_insumos`: v27, devuelve `i.datos` de **todo el negocio** con token;
  no recibe NIP/sucursal ni filtra por colaborador/área.
- `entrada_recetas`: v61, devuelve campos de pertenencia, pero filtra por negocio
  y activo, no por sucursal. No incluye `_global`, usado por el helper de recetas.
- `entrada_registrar` e `inventario_conteo_registrar`: **v79**, autentican NIP
  activo/token (guardia v78), pero insertan `p_datos` sin comprobar pertenencia
  del `insumoId`, ni derivar/validar `sucursalId` y área del colaborador.
- Conteo v79 sí conserva la guarda v76 que impide sobrescribir un ID de conteo
  de **otro negocio**. Eso no añade validación de sucursal/insumo.

El cliente corrige normalmente el sello según `portal_perfil` v78; el servidor
no lo garantiza. Un cliente equivocado o alterado puede enviar un sello o ID
fuera de alcance con NIP válido. Es una brecha confirmada **en el SQL versionado**;
hay que verificar las definiciones efectivamente instaladas antes de afirmar
que la producción tiene exactamente estas funciones.

RLS fue corregido por negocio en v9 y ampliado para staff en v19. No usar como
diagnóstico vigente las políticas abiertas del archivo inicial
`sql_negocio_insumos.sql`: tienen migración posterior. El acceso por negocio
de un dueño/admin tampoco equivale a aislamiento operativo de sucursal.

### F14 · P2 · Carga incompleta / error de esquema: confirmar configuración real

El catálogo y recetas paginan por `insumo_id`. Inventarios
(`:207/4940`), requisiciones (`:589`) y la RPC de catálogo QR hacen una consulta
completa sin recorrer páginas. Con 1,000 maestros + 800 copias ya hay 1,800 filas;
si el límite de API es 1,000, faltarán registros. **El límite instalado no se
consultó**, por lo que el truncado real queda pendiente de verificación.

Requisiciones ordena `negocio_insumos` por `created_at`, columna ausente en el
DDL del repositorio. Inventarios ya corrigió este mismo fallo usando `insumo_id`.
Revisar columnas instaladas; no asumir que se aplicaron todas las migraciones.

`actualizarEnGlobal:706` es otra ruta antigua: conserva `sucursalId` destino,
pero copia `sucursales` del origen. El script reproduce S2 con `sucursales:['s1']`.
**No se encontró un botón ni llamada interna vigente**; retirarla o corregirla
como deuda para evitar que se vuelva a conectar accidentalmente.

## Qué ya funciona y debe conservarse

- `_forkInsumo` clona profundamente, genera IDs distintos y deja maestro sin
  sucursal. Modificar la presentación S1 no altera la de S2.
- `_insumoEnSuc` excluye maestros sin asignar; filtros con sucursal explícita
  devuelven el subconjunto correcto de copias sanas.
- Borrar una copia independiente elimina ese ID del negocio y deja maestro
  y copias hermanas intactos; hay tombstones para no revivir el ID borrado.
- El área explícita de cocina se excluye de barra. El conteo QR recibido se
  acota a la sucursal y área de `invActual` antes de proponer aplicación.
- `negocio-tab.js` protege negocio/sucursal por pestaña: no atribuir estos
  defectos a compartir simplemente `localStorage` entre dos pestañas.

## Decisiones que deben quedar explícitas al implementar

1. El global debe enumerar **maestros identificados como tales**, no todos los
   registros que accidentalmente perdieron `origenId` o nacieron propios de sucursal.
2. Un global sin asignación no entra en la operación local. Matriz es una
   sucursal real; contexto ausente no significa «ver todo».
3. Desvincular preserva la copia local; eliminar retira solo esa copia. Eliminar
   un maestro con historial/copias necesita una política separada.
4. El cambio de precio/ficha se propone y cada destino decide. Hoy
   `_guardarActivo:2952` propaga activar/desactivar global a todas las copias:
   es una excepción deliberada en el código; comunicarla como acción del negocio
   y distinguirla de la edición ordinaria que requiere aceptación local.
5. Conservar snapshots y IDs históricos; exigir IDs locales para operaciones
   nuevas y tratar las referencias maestras antiguas con resolución explícita.

## Publicación completada antes de la auditoría

El hub aprobado quedó en `49c6d87` y fue enviado a `origin/main`. Se comprobó
que etaax.com sirve `hubModuloAcciones` y los archivos completos idénticos al
repositorio: JS `9a34c44d`, CSS `93d3d8dc`. El hook de push aprobó **4,497**
comprobaciones de fórmulas y **84** del almacén; la validación previa del botón
incluyó 65 casos de navegador. Eso verifica la entrega del hub, no estos casos
nuevos de aislamiento. Los documentos de esta auditoría se dejan para revisión
y ejecución de Claude; no se implementó ni publicó una reparación de insumos.
