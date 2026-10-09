# Plan de reparación y consolidación de ETAAX

Fecha: 9 de octubre de 2026. Base revisada: `5054215`. Entradas: auditoría R01–R14, respuesta de Claude y confirmación del propietario de que actualmente solo existe producción.

Este documento especifica trabajo futuro. No se han aplicado correcciones, instalado herramientas, creado servicios ni modificado producción. Se volvieron a ejecutar las reproducciones locales: los seis casos del informe siguen presentes.

## 1. Decisiones de arquitectura y prioridades

Conservar el ERP y reparar sus límites de confianza mediante entregas pequeñas. Mantener las fórmulas de `EtaaxCore`, el frontend vanilla y el flujo operativo de QR/NIP. Las responsabilidades nuevas se introducen detrás de adaptadores; la separación de archivos viene después de fijar comportamiento y pruebas.

La respuesta de Claude coincide con el código. Haría estos ajustes al orden propuesto:

1. Poner R09 y la protección inmediata de la cola en el primer bloque de estabilización: son fallos de conservación de capturas, no solo mejoras de diseño.
2. Cerrar R05 pronto. Un ID aleatorio dificulta descubrir la fila; no sustituye comprobar que pertenece al negocio autorizado. No se ha demostrado enumeración ni explotación contra clientes reales.
3. Mantener abiertos, de forma visible, los riesgos residuales de la cuenta compartida hasta retirar esa identidad de las políticas. Filtrar bajas y cerrar sesiones reduce exposición, pero no crea autorización individual.
4. Verificar permisos efectivos y las últimas funciones desplegadas antes de preparar cada migración. Los archivos históricos no bastan para representar producción.

### Invariantes que cada entrega debe conservar

- El actor, negocio y sucursal autorizados se determinan en servidor. Los valores del navegador expresan intención, no autoridad.
- Ninguna cuenta de cliente modifica cobros de plataforma, catálogos globales o recursos de otro negocio.
- Los registros sin sucursal siguen la regla existente: Matriz (`suc_principal`). La vista global incluye el negocio completo.
- Un fallo o una respuesta parcial nunca se presenta como un cero financiero válido.
- Un guardado confirmado localmente resiste las recargas ordinarias previstas; si falla la persistencia, se comunica el fallo.
- Dos pestañas no pierden operaciones; un borrado no puede revertirse por una operación anterior.
- Un pago se aplica una sola vez por efecto económico y una cancelación solo afecta la suscripción a la que corresponde.
- Las migraciones nuevas no debilitan ninguna de esas propiedades, aunque cambien el cuerpo completo de una función.

## 2. Primer requisito: laboratorio separado de producción

`supabase-config.js` tiene URL y llave pública de producción fijas. Servir la web con `python3 -m http.server` no cambia el backend: las interacciones normales seguirían llegando a la base real.

### Entrega T00 — Configuración por entorno y base de pruebas

**Cambios previstos:** `supabase-config.js`, configuración de Netlify, archivos de entorno públicos generados y configuración local de Supabase. Agregar una tarea de desarrollo/build para generar configuración no implica introducir un framework.

1. Inspeccionar producción con [el SQL de solo lectura](auditoria-2026-10-09-supabase.sql): funciones actuales, políticas, grants y buckets. Documentar también versión de PostgreSQL, Auth, Max Rows, eventos/versiones Stripe y Edge Functions desplegadas.
2. Obtener un baseline de esquema sin registros de clientes y revisar que incluya funciones, triggers, RLS, grants y políticas de Storage. Auth/Storage del entorno local se inicializan con sus servicios locales; no se importa ciegamente su esquema interno desde producción.
3. Levantar Supabase local con CLI y un runtime de contenedores. En esta sesión no se encontraron `supabase`, `docker` ni `psql` en PATH; eso no demuestra que no estén instalados en otra ubicación. La preparación del entorno es una tarea del plan. [Desarrollo local oficial](https://supabase.com/docs/guides/local-development).
4. Crear datos ficticios: negocios A/B, Matriz/segunda sucursal, dueño A/B, administrador, varios roles, empleado dado de baja, NIPs válidos/inválidos y pagos de sandbox.
5. Separar configuración pública por entorno: URL, llave pública, versión de cliente y versión de API. Mantener las llaves de servicio solo en servidor/CI autorizado.
6. Rechazar pruebas de escritura cuando la configuración apunte al proyecto real. Los tests de integración deben declarar el entorno esperado y verificar el identificador del proyecto antes de empezar.
7. Usar Stripe sandbox y webhook secret de sandbox en el laboratorio. Nunca suscripciones ni cobros reales como fixtures.
8. Preparar un respaldo verificable antes de cambios de esquema en producción. La recuperación de PostgreSQL y la de objetos de Storage se verifican por separado.

No ejecutar la secuencia histórica v2–v69 sobre producción ni usarla como bootstrap automático sin revisión: v2 contiene borrados y v52/v54 dejan políticas que queremos corregir. Para local, el baseline representa el estado inspeccionado; las migraciones de reparación se prueban sobre él.

**Cierre:** frontend local habla solo con Supabase local; una captura ficticia no aparece en producción; el entorno puede reconstruirse y ejecutar pruebas de políticas. Después conviene añadir staging remoto para verificar Auth/Storage/hosting reales antes de cambios grandes, con la infraestructura que se acuerde.

## 3. Bloque inicial: cerrar exposición y corregir resultados

### T01 — Render seguro del panel admin (R01)

**Archivos:** `admin.html` y demás paneles de plataforma con handlers generados desde datos.

- Inventariar IDs, URLs y textos insertados en HTML, JavaScript, CSS y enlaces. Son contextos distintos y requieren tratamientos distintos.
- Cambiar los handlers dinámicos a `addEventListener` o delegación de eventos sobre atributos `data-*` creados de forma segura. El ID llega al handler como valor, nunca como código.
- Usar `textContent` para texto y asignación de propiedades DOM para atributos. Validar protocolos/destinos de URLs según la función.
- Revisar todos los botones generados de negocios, usuarios, staff, documentos y catálogos; corregir solo la fila de la reproducción deja otros sinks similares.
- Añadir restricciones de formato de ID por entidad después de inspeccionar los formatos existentes. No imponer un UUID universal: hay IDs compuestos y legacy que deben conservarse.
- Mantener la CSP actual mientras se elimina la dependencia de handlers inline; endurecerla por rutas en una entrega posterior, con validación de recursos.

**Pruebas:** IDs con comillas, signos HTML y caracteres de control; nombres con acentos; botones funcionando después de cada render; prueba en navegador de que el payload inerte no ejecuta el marcador.

**Cierre:** el panel trata todos los valores recibidos como datos y conserva las acciones existentes. Primer cambio publicable, pequeño y verificable.

### T02 — Permisos SQL explícitos y autorización que falla cerrada (R02/R06 y comprobación adicional)

**Archivos:** nueva migración, políticas de `suscripciones`, `pagos_suscripcion`, `invitaciones`, `permisos`, `storage.objects`; funciones relacionadas con tokens y configuración.

En el plan apareció otra comprobación necesaria. `entrada_token_asegurar` en v27 usa:

```sql
IF NOT (v_owner = auth.uid() OR es_staff_de(p_neg) OR is_platform_admin()) THEN
    RAISE EXCEPTION 'no autorizado';
END IF;
```

Sin sesión, la comparación con `auth.uid()` puede dar `NULL`; la condición del `IF` también puede ser `NULL`, y el bloque de denegación se omite. En PL/pgSQL el `IF` se ejecuta cuando su condición es verdadera. v27 concede ejecución a `authenticated` sin revocar explícitamente `PUBLIC`; PostgreSQL concede ejecución a `PUBLIC` por defecto al crear funciones, salvo que los defaults del creador se hayan cambiado. **El defecto de lógica se observa en el código; la posibilidad de llamada anónima depende del ACL desplegado.** [Condicionales PostgreSQL](https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-CONDITIONALS), [permisos de funciones](https://www.postgresql.org/docs/current/sql-createfunction.html).

Para una operación que exige sesión, comprobar primero `auth.uid() IS NULL` y después denegar si la autorización `IS NOT TRUE`. Este patrón también se debe revisar en funciones del menú. Las RPC legítimamente públicas de QR/carta conservan su mecanismo explícito de token/NIP; no se les exige una sesión de dueño por accidente.

Trabajo concreto:

1. Construir una matriz de acceso por tabla/operación/actor, incluyendo objetos globales y públicos.
2. Quitar `staff_acceso` de tablas de plataforma/cobro donde no corresponde. Revisar todas las alcanzadas por v54, no únicamente las dos del informe.
3. Restaurar lectura permitida de estado de suscripción y mantener escritura exclusiva de admin/servicio. Decidir si el historial de pagos necesita lectura del cliente mediante una proyección mínima; no abrir el payload de Stripe completo.
4. Eliminar la concesión genérica de escritura sobre `evidencias`. Recursos globales: escritura solo admin. Carpetas de negocio: comprobar membresía/identidad autorizada en `USING` y `WITH CHECK`.
5. Conservar las subidas anónimas de QR autorizadas por token en sus rutas específicas y el funcionamiento de URLs públicas de logos/recetas. Probar `INSERT`, sobrescritura, movimiento y borrado, no solo listado.
6. Revisar ACL de todas las `SECURITY DEFINER`, sus sobrecargas y helpers. Revocar defaults de ejecución pública donde corresponda y conceder solo a los roles necesarios dentro de la misma transacción que define la función.
7. Usar nombres de objetos calificados por esquema y un `search_path` seguro. No retirar ejecución a un helper que una política de Storage necesite sin ajustar esa dependencia.
8. Reemplazar el barrido de tablas por un manifiesto de permisos explícitos y un test que falle cuando aparezca una tabla sin clasificación. Una excepción añadida a v54 deja intacto el patrón que provocó el fallo.

**Pruebas reales:** anon, dueño A/B, staff A/B y admin; ejecución de tokens sin sesión; modificación de cobros; cambio de negocio en una fila; rutas globales y ajenas en Storage. Probar llamadas directas sin la UI.

**Cierre:** los casos prohibidos no producen efectos; los permitidos siguen funcionando, incluidos horarios y QR. No restablecer permisos amplios como rollback de una regresión: corregir la operación afectada manteniendo el aislamiento.

### T03 — Resumen financiero fiable (R12/R13)

**Archivos:** `financiero/resumen.html`, `etaax-core.js` únicamente si requiere extender un contrato existente, tests financieros.

- Delegar el alcance al filtro canónico `EtaaxCore.scopeSuc`, preservando la vista global.
- Validar todas las respuestas antes de publicar el nuevo snapshot en `_c`. El snapshot se sustituye como conjunto coherente, no consulta por consulta.
- Distinguir `cargando`, `listo`, `sin datos`, `desactualizado` y `error`. Un arreglo vacío de una consulta exitosa puede significar cero; un error no.
- Si se conserva el último resultado válido, conservar también negocio/sucursal/periodo y fecha de actualización. No enseñar un snapshot de A después de cambiar a B.
- Impedir que una respuesta lenta de un contexto anterior reemplace el actual; usar un identificador de solicitud/contexto.
- Impresión/exportación respeta el estado del reporte y no convierte un error en documento financiero definitivo.
- Aplicar el mismo contrato de error en otros lectores financieros identificados durante la entrega.

**Pruebas:** datos legacy solo en Matriz; vista global igual a suma de sucursales; mismo resultado en KPIs/P&L; error individual de consulta; red caída; cambio de sucursal durante una carga lenta; cero real tras respuesta exitosa.

**Cierre:** reportes consistentes y ninguna cifra fabricada por ausencia/error de datos. Este cambio puede publicarse sin esperar a la arquitectura de identidad.

### T04 — Autenticación y bajas: contención inicial (R03/R04)

**Archivos:** `hub.html`, `staff-auth.js`, `security.js`, app móvil y nuevas definiciones SQL de login/portal/historial.

1. Restaurar límite de intentos y filtro de activo en la última `staff_login`. Preservar formato de retorno usado por el hub.
2. Centralizar validación de empleado activo, negocio, token, credencial y sucursal. Cada puerta alternativa necesita el mismo control, incluidas `obtener_staff_cred`, perfil, historial, recetas, guías, checklists y escrituras.
3. Mantener puros los helpers de lectura y separar el consumo del contador. Si una RPC pasa a escribir el contador no puede seguir declarada `STABLE`.
4. El contador debe sobrevivir al intento fallido. Un `RAISE EXCEPTION` que deshace la transacción también puede deshacer su incremento: devolver una respuesta controlada o registrar el intento en una transacción separada cuando sea necesario.
5. Quitar a anon el reinicio libre de `login_exito`; el servidor valida la identidad del éxito. Para dueño se usa la sesión verificada y para staff la validación real, no el identificador enviado por el cliente.
6. Eliminar la autenticación autoritativa contra hashes cacheados. La caché no confirma que alguien sigue activo. Sin red se podrá conservar captura local como borrador según política, sin afirmar autorización del servidor.
7. En salida de staff compartido usar cierre de la sesión local, evaluando `signOut({ scope: 'local' })`, para no invalidar las sesiones de todos los usuarios de la cuenta compartida. Limpiar la sesión/UI en todos los caminos, incluido timeout, sin borrar operaciones pendientes.
8. Revisar con el dueño la rotación/corte de credenciales compartidas ya distribuidas y sus sesiones. Cambiar una contraseña no basta para asegurar denegación instantánea de un JWT ya emitido. La política/membresía debe negar el acceso; para la transición compartida puede requerirse retirar/cambiar `staff_uid` y reconectar los usuarios legítimos.
9. Evitar que los flujos de provisión vuelvan a cachear credenciales que acabamos de retirar. Registrar el riesgo residual si el puente todavía necesita devolver credenciales a empleados activos.

**Pruebas:** empleado activo/inactivo en equipo nuevo/con caché/con sesión abierta; logout de A no expulsa a B; NIP incorrecto por cada puerta consume el freno; un usuario no borra el bloqueo de otro; operaciones pendientes quedan recuperables sin subirlas bajo otra identidad.

**Límite de esta entrega:** cerrar puertas de baja no resuelve la identidad compartida. R03 solo se considera cerrado al completar T09.

### T05 — Conteos autorizados e idempotentes (R05)

**Archivos:** nueva migración de `inventario_conteo_registrar`; `entrada.html`, `app-movil/app.js` si se extiende el contrato.

Contención compatible con los IDs actuales:

```sql
ON CONFLICT (id) DO UPDATE
SET datos = EXCLUDED.datos
WHERE inventario_conteos.negocio_id = EXCLUDED.negocio_id;
```

Esto requiere comprobar `ROW_COUNT`/`RETURNING`: si no cambió una fila por conflicto ajeno, no devolver éxito. Rechazar con un mensaje que no revele a quién pertenece el ID. No mover `negocio_id` para hacer pasar el conflicto.

Además, sellar ID/actor/sucursal desde información validada; comprobar estructura, unidades, límites de cantidad y existencia del producto dentro del negocio. No confiar en `contadoPor`, `sucursalId`, fecha de servidor o estado `aplicado` mandados por el teléfono. Autorizar área/sucursal según las reglas reales del empleado.

Los conteos ya generan IDs aleatorios por envío. Reusar el ID para repetir el mismo envío permite idempotencia. Distinguir el reintento idéntico de una corrección: esta última necesita actor/permiso y versión válidos. Para filas antiguas sin ID individual de actor, definir tratamiento explícito; el nombre del colaborador no es identidad única.

**Pruebas:** usar deliberadamente en A un ID ficticio conocido de B; repetir un envío; corregir lo propio/ajeno; enviar otra sucursal; rechazar estado privilegiado; verificar que ningún caso prohibido modifica datos.

## 4. Bloque de conservación de datos y sincronización

### T06 — Persistencia y operaciones actuales: reparación inmediata (R08/R09/R11)

**Archivos:** `etaax-store.js`, `etaax-db.js`, lectores realtime de `administrativo/diario.html`, `tests/store-tests.js` y tests específicos de cola.

- Implementar fallback real de escritura/borrado de claves grandes cuando IndexedDB no está disponible. Capturar cuota llena, storage inaccesible y corrupción de JSON; no convertir corrupción en cola vacía.
- Mantener pendientes si una transacción falla. Cuando una escritura nueva llega mientras otra baja a disco, el ack del valor anterior no elimina el pendiente del valor nuevo: usar generación/revisión por clave.
- Distinguir base bloqueada por otra pestaña de IndexedDB no disponible. Añadir `onversionchange` y manejo de `onblocked` antes de migrar la estructura.
- Introducir una confirmación asíncrona de persistencia para capturas críticas. Mantener adaptadores de los helpers actuales y migrar sus consumidores gradualmente; no considerar que agregar un `await` sobre una función que retorna `undefined` confirma guardado.
- Serializar la intención por entidad: delete posterior invalida upserts anteriores que aún no se han enviado; la operación en vuelo y su respuesta también se deben verificar contra la revisión actual.
- Incorporar negocio/actor/clave de registro al item y al delete. No interpretar pendientes usando el contexto de negocio activo en ese momento.
- Proteger las ediciones con upsert pendiente al fusionar realtime, usando el helper existente y metadatos de revisión; un registro local nuevo y una edición local de uno existente son casos distintos.
- Cambiar el descarte por reintentos a una cuarentena persistente. El límite de intentos no autoriza borrar trabajo; la cuarentena actual en localStorage puede llenarse y no es respaldo suficiente.

**Cierre:** sobreviven datos después de recargar sin IndexedDB; fallos de disco son visibles; un registro borrado no revive; realtime conserva la edición pendiente. R07 sigue abierto hasta el cambio transaccional T07.

### T07 — Cola transaccional por operación (R07 y garantía completa de R08/R09)

La cola no debe ser un array completo compartido entre pestañas. Crear un object store `outbox` por operación y un store de revisiones por entidad. Mantener la caché de lectura existente durante la transición.

Contrato propuesto, sujeto a tipos reales de cada entidad:

```text
op_id                 UUID estable generado una vez
negocio_id            negocio al capturar
actor_uid             identidad de sesión; el servidor la comprueba
record_key            tabla + clave real de la entidad
entity_seq            orden local transaccional para esa entidad
kind                  upsert / patch / delete / comando
base_version          versión del servidor conocida al editar
payload               datos/comando; sin tokens ni contraseñas
state                 pending / sending / acked / blocked_auth / conflict / failed
attempts, next_retry   reintento con espera y diagnóstico
```

El modelo incluye claves distintas: hay entidades por `id`, documentos por `negocio_id`, permisos por negocio/rol y catálogo por negocio/insumo. No forzar el mismo `onConflict` o delete a todas.

Garantías de implementación:

1. Guardar el cambio local y el item en una misma transacción IndexedDB. Confirmar al usuario después de `transaction.oncomplete`, no de `request.onsuccess`. Es confirmación del almacenamiento del navegador; no promesa absoluta frente a pérdida física de energía. [Contrato IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction).
2. Una transacción de claim/lease asigna al procesador operaciones pendientes. Web Locks puede coordinar, y BroadcastChannel notifica vistas; ninguno sustituye persistencia/atomicidad ni la idempotencia del servidor. Definir recuperación cuando muere la pestaña que procesaba.
3. Procesar en orden por entidad. Una operación con resultado incierto mantiene bloqueada esa entidad hasta resolver/reintentar, aunque otras entidades puedan avanzar.
4. El ack elimina/confirma exactamente `op_id` y versión. No borrar todo lo que coincida con un ID ni sobrescribir un snapshot entero de cola.
5. Un tombstone versionado evita que una escritura anterior recree un borrado. No permitir que un upsert arbitrario vuelva a insertar una entidad borrada sin la operación explícita autorizada.
6. En servidor, las operaciones que produzcan efectos de dinero/stock tendrán `op_id` registrado en la misma transacción que el efecto. La red puede fallar después del commit: la repetición devuelve el recibo previo, no vuelve a descontar o sumar.
7. Sin sesión/no autorizado: preservar y marcar. No enviar bajo el usuario siguiente ni convertir automáticamente datos de un empleado dado de baja en operaciones aceptadas; requieren revisión autorizada.
8. Offline capture es un borrador hasta la aceptación del servidor. El servidor vuelve a comprobar permisos y versiones en el momento de recepción.
9. Sin IndexedDB, usar fallback probado para datos de tamaño admisible y coordinar escritura entre pestañas si hay mecanismo compatible. Si faltan almacenamiento/coordinación suficientes, informar y ofrecer conservación/exportación del borrador; no prometer captura offline fiable.

Migración: introducir primero manejo de versiones y confirmación durable en el cliente actual; exportar/contabilizar la cola v1 por dispositivo; importarla a v2 de forma idempotente conservando orden, deletes y payloads; marcar importación solo al confirmar transacción. No hay un orden global recuperable entre arrays ya sobrescritos: preservar evidencia y revisar lo ambiguo.

Los clientes viejos no deben seguir escribiendo v1 mientras los nuevos procesan v2. Detectar versión y pausar guardados incompatibles conservando borradores; probar upgrade con pestañas abiertas. No borrar v1 ni bajar el número de versión de IndexedDB como rollback.

**Pruebas de cierre:** dos pestañas offline con altas/ediciones/borrados; dos negocios; crash tras persistir y antes de enviar; crash tras commit servidor y antes de ack; refresh durante envío; sesión que vence; cola corrupta; quota; migración repetida; procesador con lease vencido; Safari/iOS y dispositivos reales usados por clientes.

## 5. Lecturas completas, conflictos y cobro

### T08 — Acceso a datos común y paginación (R10)

**Archivos:** capa de lectura/adaptadores de `etaax-db.js` y lectores de `app.js`, inventarios y módulos financiero/administrativo.

- Clasificar consultas: listados paginados, catálogo acotado, historial por periodo y agregados para saldos/reportes.
- Como transición, crear un helper paginado con error explícito y orden único/estable. Elegir tamaño de página compatible con Max Rows real; no concluir que terminó por recibir menos de un BATCH que excedía el límite del servidor.
- Para datos mutables, preferir cursor con desempate `(created_at, id)` sobre offset cuando aplique. El cursor evita ciertos desplazamientos; por sí solo no garantiza un snapshot histórico bajo escrituras concurrentes.
- Para cifras finales, usar una RPC agregada que trabaje con un snapshot coherente en servidor. Mantener equivalencia con `EtaaxCore` mediante fixtures compartidos; si se traslada una fórmula, declarar explícitamente su implementación autoritativa y evitar dos versiones sin pruebas.
- Filtrar por negocio/sucursal/periodo en servidor. El saldo inicial debe incluir correctamente el periodo previo; filtrar todo al mes actual puede producir un saldo bancario falso.
- Inventariar índices existentes antes de añadirlos. Evaluar `EXPLAIN` en el laboratorio con volumen suficiente; extraer a columnas tipadas los campos de fecha, sucursal, importes o estados que lo justifiquen, conservando `datos` durante la migración.
- No truncar un resultado por presupuesto sin informar que es parcial. Si hay una carga interrumpida, conservar el snapshot anterior identificado o mostrar error.

**Cierre:** fixtures que exceden el límite configurado producen los mismos totales que PostgreSQL; paginar con inserciones concurrentes no duplica/omite silenciosamente datos; no empeora el aislamiento.

### T08b — Versiones y operaciones de negocio atómicas

Agregar `version` gestionada por el servidor para entidades con edición concurrente. No usar el `updated_at` escrito por el reloj del cliente como control de concurrencia.

- Actualizar mediante comparación de versión esperada; incrementar en servidor.
- Si hay conflicto, devolver el estado actual y preservar el borrador. Evitar reemplazar dinero/stock automáticamente con el último JSON recibido.
- Si una acción actualiza varias entidades —por ejemplo, aplicar un conteo y cerrar un inventario— especificar un comando que las actualice en una transacción, validando precondiciones.
- Definir precisión por tipo: importes monetarios, costo por unidad y cantidades pueden tener escalas distintas. No redondear todos los valores a centavos ni inventar una regla nueva sin validarla contra los casos de `EtaaxCore`.

**Cierre:** dos dispositivos que editan la misma versión detectan conflicto; repetir un comando no produce un segundo efecto; una falla intermedia no deja media operación aplicada.

### T08c — Eventos de Stripe e idempotencia económica (R14)

**Archivos:** `stripe-webhook`, `crear-checkout`, `sync-suscripcion`, nueva migración de aplicación de pagos.

1. Despachar por tipo de evento y objeto. Para `customer.subscription.deleted`, leer `obj.id` como suscripción y comparar en SQL con la vigente.
2. Registrar una cancelación antigua como evento recibido/ignorado con motivo; nunca cancelar otra suscripción por compartir customer/negocio.
3. Evitar crear una segunda suscripción vigente desde checkout. Definir tratamiento de sesión pendiente repetida y el flujo apropiado cuando el cliente ya paga.
4. Mantener deduplicación de entregas por `event_id` y añadir identidad del efecto económico, normalmente factura/pago/período. Dos eventos diferentes pueden representar el mismo pago.
5. Verificar concurrencia: la comprobación previa `SELECT EXISTS` y la lectura de corte no serializan por sí solas dos pagos distintos. Reclamar el evento y bloquear/serializar el estado de suscripción en transacción, incluso si todavía no existe fila; conservar unique constraints y manejo de reintentos.
6. Confirmar que la política comercial de ancla/tolerancia coincide con los periodos realmente cobrados. Revisar prorrateos y pagos de facturas que no correspondan a un mes nuevo; no extender por cualquier `invoice.paid` sin distinguir su efecto.
7. Cubrir confirmaciones diferidas solo para métodos admitidos/habilitados en ese checkout. Deduplicar su activación contra la primera factura; no aceptar un voucher como pago.
8. No depender del orden de webhooks ni de timestamps iguales para deduplicar. Stripe no garantiza el orden y documenta duplicados con IDs distintos. [Guía Stripe](https://docs.stripe.com/webhooks).

**Cierre:** sandbox con pago inicial, renovación, tolerancia, factura repetida, dos eventos simultáneos, sustitución de suscripción, cancelación antigua, prorrateo, error de base y reintento después de commit.

## 6. Identidad individual con operación de QR/NIP

### T09 — Cierre estructural de R03

Separar dos necesidades del producto:

| Recorrido | Identidad y autorización propuestas |
| --- | --- |
| Dueño/administración/módulos completos | Sesión individual Supabase Auth + membresía y permisos del servidor |
| Colaborador que usa módulos completos | Usuario individual; el login puede seguir mostrando usuario/contraseña |
| Registro operativo por QR/NIP | Validación limitada a negocio/persona/sucursal y RPCs operativas; nunca devolver la contraseña/JWT de una cuenta compartida con acceso general |
| Cliente que escanea carta pública | Token y proyección pública de campos permitidos; separado de credenciales de personal |

Tener identidad individual no exige que cada mesero gestione un buzón real. Se puede provisionar una cuenta Auth desde servidor con un identificador interno compatible con el proveedor y mapear el usuario que ya utiliza. Ese mapeo no reemplaza verificar su contraseña con Auth. Definir recuperación administrada cuando no haya correo y resolver nombres duplicados explícitamente. Evitar volver a implementar almacenamiento de contraseñas en `staff.datos`.

Para QR/NIP: mantener el flujo visual. Una validación en servidor devuelve una identidad/capacidad restringida al propósito, no una credencial de negocio. La credencial operativa puede ser una sesión opaca de corta duración verificable por RPC; no hace falta firmar JWT personalizados con la llave maestra. Guardar solo el hash del token de sesión, actor, negocio, sucursal, alcance y expiración; comprobar estado activo y revocación en cada acción. El token del QR identifica el negocio/dispositivo autorizado, no sustituye al empleado.

Cambios de modelo propuestos:

- `membresias`: vínculo de Auth UID, negocio y staff, estado y versión de autorización.
- Sucursales autorizadas por membresía, con integridad frente al negocio. La sucursal sigue almacenada en un documento JSON actualmente; definir una representación relacional mínima para autorización o una proyección controlada, sin crear dos fuentes editables por separado.
- Permisos efectivos del servidor por rol/sucursal. Conservar los roles personalizados, su rol base y los overrides `__suc__` actuales mediante fixtures de equivalencia. Lo que falta debe negar de forma segura según un contrato documentado, no por accidente al cambiar la herencia.
- Administradores de plataforma por identidad verificable y política de acceso, con MFA para acciones sensibles; retirar dependencia exclusiva de un correo fijo cuando se migre.
- Bitácora de cambios: actor verificado, negocio, entidad, operación, versión, hora servidor y correlación. No guardar contraseñas ni tokens en ella.

**Detalle esencial:** RLS limita filas, no elimina selectivamente campos dentro de `datos`. Un permiso «ver catálogo de staff, no sueldos» no se consigue devolviendo la fila completa y escondiendo el sueldo con CSS. Separar información privada en tablas protegidas o devolver proyecciones explícitas por RPC, evitando acceso directo alternativo al JSON completo. Lo mismo aplica a costos de recetas y otras restricciones de campos.

Rollout:

1. Crear estructuras, poblar vínculos verificables y mantener compatibilidad de dueño/admin.
2. Implementar login individual y RPC de permisos; la UI usa los permisos devueltos por servidor para navegación.
3. Habilitar un negocio piloto mediante un estado de migración protegido en servidor, no un booleano editable en `negocios.datos` o localStorage.
4. Cambiar sus políticas a membresías y retirar el `staff_acceso` antiguo. Añadir nuevas políticas sin quitar la permisiva antigua deja el bypass abierto.
5. Revisar pendientes legacy del piloto. No adjudicar automáticamente autoría a una persona a partir del `staff_uid` compartido; conservar «autor legacy no verificado» cuando corresponda y revisión autorizada.
6. Probar cambios de rol/sucursal y bajas con sesiones abiertas. El servidor consulta el estado actual para denegar; logout o revocación de refresh no aseguran por sí solos que un JWT emitido deje de ser aceptado inmediatamente. [Sesiones Supabase](https://supabase.com/docs/guides/auth/sessions).
7. Retirar `obtener_staff_cred`, credenciales compartidas persistidas y campos de autenticación legacy cuando el negocio ya no dependa de ellos y sus pendientes estén conciliados.
8. Extender por cohortes y mantener las nuevas garantías al corregir problemas. No volver a habilitar el puente amplio como recuperación de un fallo de UI.

**Cierre:** modificar contexto/cache/rol en DevTools no aumenta permisos; mesero no lee nómina; sucursal A no modifica B; baja se aplica a cada acción; QR/NIP continúa operativo sin repartir acceso general al negocio.

## 7. Evidencias antiguas, estructura y entrega

### T10 — Migración de archivos sensibles anteriores a v55

Inventariar desde un proceso autorizado las referencias antiguas en `staff`, `gastos`, `cortes`, `inbox` y `entradas`. No convertir el bucket público entero en privado porque allí viven logos/fotos del menú.

Preparar un manifiesto idempotente por objeto: origen, destino privado, tamaño/checksum cuando sea viable, referencias y estado. Copiar, verificar y actualizar referencias; confirmar vistas, impresos y URLs firmadas. Luego retirar la copia pública según el lote verificado. Conservar el contenido privado y el historial de migración para recuperación; una vuelta atrás no debe hacer públicos los documentos otra vez.

**Cierre:** nuevos y antiguos documentos sensibles requieren autorización; los logos y la carta siguen funcionando; existen verificación y recuperación de archivos.

### T11 — Consolidación del repositorio y CI

- Introducir CI conservando `money-tests` y `store-tests`. Agregar tests SQL ejecutados en PostgreSQL local con pgTAP (`supabase/tests/database`, `supabase test db`) y pruebas de API/Auth/Storage para lo que pgTAP no cubre. [Testing Supabase](https://supabase.com/docs/guides/database/testing).
- Testear el estado final de esquema/políticas después de migrar, con casos permitidos y prohibidos. Los checks de texto pueden permanecer como ayuda, no como única prueba de autorización.
- Fijar versiones de herramientas/dependencias de desarrollo y de CDN usadas en producción; comprobar integridad y actualizar con pruebas.
- Separar scripts inline grandes después de tests de comportamiento. Empezar por resumen, autenticación, acceso a datos y sincronización. Evitar mezclar una extracción grande con una corrección de seguridad en el mismo diff.
- Centralizar filtros de sucursal, fechas de negocio, lectura paginada y estados de error. Declarar contratos por entidad para eliminar supuestos genéricos incorrectos.
- Extraer proyecciones tipadas del JSONB solo donde aporten validación, consultas e integridad. No normalizar todo el ERP en una sola migración.
- Añadir versión de release y protocolo de compatibilidad: contrato backend, formato de cola y versión de cliente. URLs de assets versionadas/build con huella evitan mezclar HTML nuevo con JS viejo.
- Configurar el deploy para requerir checks, también si se sube desde otra máquina sin hook. Una rama de prueba/preview no usa secretos de producción.
- Actualizar `CLAUDE.md`: estado real de identidad, APIs nuevas, guardado durable, reglas de autorización y checklist de migraciones. La documentación no debe seguir prometiendo propiedades que ya no refleje el código.
- Registrar tiempos de consulta, fallos de RPC, cola más antigua y errores de persistencia sin enviar payloads con datos personales. Medir antes de fijar objetivos de rendimiento; no acelerar una carga haciendo que devuelva menos datos sin avisar.

## 8. Pruebas de aceptación mínimas

| Grupo | Casos que bloquean la entrega |
| --- | --- |
| Autorización | Dos negocios, dos sucursales, varios roles, usuario inactivo, anónimo, admin; lecturas/escrituras directas y RPC |
| Render | Datos con delimitadores de JS/HTML/URL; ningún handler de datos se convierte en código; acciones del panel conservadas |
| Operación | Capturar gasto/corte, recibir insumo, merma, conteo, aplicar conteo, cierre de inventario y QR |
| Finanzas | Legacy Matriz, global igual a suma de sucursales, saldos anteriores al periodo, errores y resultados sobre el límite API |
| Persistencia | Hidratación tardía, IDB ausente/abortado/bloqueado, quota, corrupto, recarga, dos pestañas y versiones distintas |
| Concurrencia | Dos dispositivos, edición del mismo registro, upsert/delete en vuelo, respuesta tardía y reintento tras commit |
| Auth | Logout local compartido, sesión vencida, cambio de rol, baja en sesión abierta y caché viejo |
| Cobro | Firma incorrecta, pago duplicado, efectos repetidos con eventos distintos, concurrencia, cancelación vieja, prorrateo y sandbox |
| Storage | Lo propio permitido, lo ajeno/global rechazado, URLs públicas de producto y documentos privados |
| Migraciones | Aplicar dos veces sin ampliar permisos ni borrar datos; baseline + reparación; grants/overloads reales |

Los tests del informe esperan actualmente reproducir vulnerabilidades: no deben añadirse como checks verdes de aprobación. Convertir cada caso a una regresión que espere el comportamiento corregido.

## 9. Secuencia de entregas, dependencias y tamaño

| Entrega | Prioridad | Tamaño relativo | Depende de | Resultado verificable |
| --- | --- | --- | --- | --- |
| T00 laboratorio/configuración | Inicial | Medio | Acceso autorizado a metadatos | Pruebas de escritura aisladas |
| T01 panel seguro | Urgente | Pequeño–medio | Fixtures; no requiere migración para el fix DOM | Cierra R01 |
| T02 permisos/ACL/NULL | Urgente | Medio | T00 + esquema real | Cierra R02/R06 y comprueba el caso adicional |
| T03 resumen | Urgente | Pequeño | Fixtures | Cierra R12/R13 |
| T04 login/bajas | Urgente | Medio | T00/T02 | Cierra R04 y contiene R03 |
| T05 conteos | Temprana | Pequeño–medio | T00/T04 | Cierra conflicto de negocio R05 |
| T06 persistencia/merge | Temprana | Medio | Contratos actuales | Contiene R08/R09 y cierra R11 |
| T07 cola transaccional | Fondo prioritario | Grande | T06 + protocolo de versión | Cierra R07 y completa R08/R09 |
| T08 lectura/paginación | Fondo prioritario | Medio–grande | T00/T03 | Cierra R10 |
| T08b versiones/comandos | Fondo prioritario | Grande | T07 + contratos de entidad | Evita pérdida entre dispositivos y efectos parciales |
| T08c Stripe | Temprana | Medio | T00/T02 + sandbox | Cierra R14 y valida efectos económicos |
| T09 identidad | Estructural | Grande | T02/T04 + contratos/pendientes | Cierra R03 |
| T10 evidencias antiguas | Estructural | Variable por volumen | T02 + inventario y respaldo | Retira exposición histórica |
| T11 CI y extracción | Continua | Por módulo | Primeras regresiones | Evita repetir debilitamientos |

El tamaño expresa complejidad, no fechas prometidas. Estimar jornadas y calendario después de T00, cuando conozcamos esquema desplegado, clientes activos, volumen de pendientes/archivos y equipos que debemos soportar. Los fixes pequeños de render/resumen no tienen que esperar al proyecto completo de cola/identidad.

## 10. Forma de implementar y publicar cada lote

1. Una rama/PR por objetivo concreto. Si Claude y Codex trabajan en tareas distintas, asignar archivos/contratos y un integrador; no editar simultáneamente la misma función o reservar el mismo número de migración.
2. Preparar el caso que falla y sus fixtures antes del parche. Cada PR describe trigger, conducta anterior/nueva, riesgo de compatibilidad, pruebas y pasos de publicación.
3. Añadir una migración nueva con el siguiente número disponible, conservar el historial aplicado y probarla dos veces. No reejecutar v52/v54 para solucionar un permiso nuevo.
4. Para cambios que lo necesiten, aplicar primero esquema/API aditivos compatibles; desplegar cliente que los consume; activar por piloto; retirar rutas/políticas antiguas al terminar la transición. Un hotfix que elimina una concesión insegura puede exigir adaptar primero el cliente que dependía de ella.
5. Preparar y comprobar el artefacto antes de producción. En cada lote, verificar SQL real, versión Edge y versión de frontend; un push a main solo publica el sitio, no aplica migraciones.
6. Durante el piloto, revisar permisos denegados inesperados, persistencia, edad de cola, cobros y cuadre de reportes. Verificar más de una jornada operativa relevante antes de ampliar cambios de identidad/cola.
7. Mantener recuperación específica por cambio. Corregir hacia adelante las políticas de seguridad; no reabrir el permiso anterior. Para cola, conservar formatos e importación; para Stripe, conciliar recibos/idempotencia; para archivos, preservar la copia privada.
8. Cerrar un hallazgo con commit, migración/versión desplegada y evidencia de aceptación. Marcar por separado «implementado», «probado local», «verificado en servidor» y «publicado».

Primer lote recomendado para ejecución: configuración/laboratorio, render admin, permisos/ACL, resumen y persistencia básica; después autenticación/conteos/Stripe. La renovación completa de cola e identidad se prepara con contratos y se publica gradualmente. El proyecto mejora cuando esas garantías quedan automatizadas y comprobables, no cuando crece la cantidad de parches o el conteo de tests.
