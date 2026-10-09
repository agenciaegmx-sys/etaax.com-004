# Auditoría técnica de ETAAX — 9 de octubre de 2026

Referencia: commit `5054215`. Auditoría del repositorio local, con reproducciones en Node y datos ficticios. Se agregaron únicamente estos documentos y herramientas de auditoría; no se modificó la aplicación, no se aplicaron migraciones y no se hicieron despliegues.

## Dictamen y alcance

El proyecto tiene una base funcional considerable: módulos de operación, finanzas, inventarios, personal, sucursales y cobro; fórmulas compartidas; pruebas de regresión; y varias protecciones implementadas. Los principales riesgos encontrados están en autorización del servidor, revocación de accesos y persistencia concurrente. Recomiendo atenderlos antes de aumentar la cantidad de clientes o depender de la captura sin conexión para información financiera.

La revisión abarcó autenticación, políticas y funciones SQL relevantes hasta v69, sincronización, almacenamiento local, consultas financieras, cinco Edge Functions, configuración de Netlify y las suites existentes. No fue una revisión línea por línea de todos los módulos. Las reproducciones ejecutan funciones reales de producción en una VM con DOM/API simulados; no constituyen pruebas completas en navegador ni de PostgreSQL.

Las migraciones se aplican manualmente. **Un problema confirmado en el SQL del repositorio no demuestra que esa misma definición esté desplegada.** Quedan pendientes la comparación con el esquema real, los permisos SQL efectivos, versiones de Edge Functions, configuración de Auth/Stripe, volumen de datos y restauración de respaldos. No se accedió a datos de clientes en producción.

## Verificación realizada

| Verificación | Resultado |
| --- | --- |
| `node tests/money-tests.js` | 3,909 comprobaciones, 0 fallas |
| `node tests/store-tests.js` | 36 comprobaciones, 0 fallas |
| Sintaxis de JavaScript de producción | 43 archivos externos y 62 bloques inline sin errores de sintaxis |
| Referencias locales a scripts y CSS | Sin archivos faltantes en 55 páginas HTML revisadas |
| Reproducciones adicionales | Seis casos confirmados con código real y datos ficticios |
| Hook local | `core.hooksPath = .githooks` |

Las seis reproducciones adicionales muestran: ejecución de un marcador mediante un ID en el panel admin; reemplazo de ediciones pendientes por realtime; mezcla de Matriz en otra sucursal; pérdida de persistencia sin IndexedDB; sobrescritura de cola entre pestañas; y resurrección de un registro borrado.

Los checks existentes no detectan estos casos. Parte de la cobertura SQL inspecciona texto, y no ejecuta las políticas con usuarios de distintos negocios en PostgreSQL.

## Hallazgos por prioridad

La gravedad expresa el impacto potencial. La columna de evidencia distingue reproducción local de inspección de código. Los hallazgos SQL requieren verificar su vigencia en el servidor.

| ID | Gravedad | Hallazgo | Evidencia |
| --- | --- | --- | --- |
| R01 | Crítica | Un ID de negocio permite ejecutar código en el panel de plataforma | Reproducción local |
| R02 | Alta | v54 añade escritura de staff sobre suscripciones y pagos | Inspección SQL |
| R03 | Alta | Cuenta compartida: permisos por rol y bajas no se imponen de forma confiable | Inspección JS/SQL |
| R04 | Alta | El login público de staff perdió el límite de intentos | Inspección de última definición SQL |
| R05 | Alta | La RPC de conteos puede sobrescribir una fila de otro negocio por ID | Inspección SQL; requiere conocer el ID |
| R06 | Alta | La escritura del bucket público permite alterar recursos globales | Inspección SQL |
| R07 | Alta | Dos pestañas sobrescriben la cola de cambios pendientes | Reproducción local |
| R08 | Alta | Un reintento recrea un registro ya borrado | Reproducción local |
| R09 | Alta | El fallback sin IndexedDB guarda cambios solo en memoria | Reproducción local |
| R10 | Alta | Consultas sin paginación pueden producir totales incompletos | Inspección JS; depende del límite de la API |
| R11 | Media | Realtime reemplaza ediciones locales aún pendientes | Reproducción local |
| R12 | Alta | El resumen financiero mezcla registros de Matriz en otras sucursales | Reproducción local |
| R13 | Media | El resumen convierte errores de consulta en listas vacías | Inspección JS |
| R14 | Media | Una cancelación antigua de Stripe puede cancelar la suscripción vigente | Inspección TS/SQL |

### R01 — Código ejecutable en el panel administrador mediante un ID

**Ubicación:** [admin.html](../admin.html), `renderNegocios`, líneas 1129–1141; [supabase-migration-v2.sql](../supabase-migration-v2.sql), definición y política de `negocios`.

El ID es `TEXT`, se puede escribir desde el cliente como dueño del negocio y no tiene una restricción de formato en las migraciones revisadas. El panel lo concatena dentro de varios atributos `onclick` sin codificar el contexto JavaScript. Un cliente autorizado con intención maliciosa puede introducir un ID que termine la cadena y añada instrucciones.

La reproducción usa el identificador ficticio `n');globalThis.auditMarker=1;//`. El render real genera un handler que ejecuta el marcador al hacer clic. Se verificó en una VM; no se insertó ese identificador en la base ni se ejecutó un ataque en navegador.

**Impacto:** ejecución en la sesión del administrador, con el acceso que esa sesión tenga a los negocios de la plataforma. La CSP permite `unsafe-inline`, por lo que no aporta una barrera a estos handlers.

**Corrección:** crear los nodos y registrar handlers con `addEventListener`, pasando IDs como datos. Validar el formato de IDs en servidor como defensa adicional. Escapar HTML no basta para garantizar seguridad dentro de una cadena JavaScript embebida.

**Criterio de cierre:** un ID con comillas o caracteres HTML se trata como dato o se rechaza; nunca genera instrucciones ejecutables. Cubrir también IDs de otras entidades que llegan al panel admin.

### R02 — v54 abre la escritura de suscripciones al personal

**Ubicación:** [supabase-migration-v54.sql](../supabase-migration-v54.sql), líneas 32–49; [supabase-migration-v24.sql](../supabase-migration-v24.sql), líneas 33–45; [supabase-migration-v44.sql](../supabase-migration-v44.sql), tabla `pagos_suscripcion`.

v54 agrega `staff_acceso FOR ALL` a cualquier tabla de `public` con `negocio_id` que no tenga esa política. Esto incluye `suscripciones` y `pagos_suscripcion`, que las migraciones originales reservaban al administrador para escritura. Las políticas permisivas se combinan con OR; una política de lectura existente no limita la nueva de escritura. [Referencia PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

**Impacto:** si `authenticated` conserva permisos SQL de escritura, la cuenta compartida puede activar/extender su suscripción o modificar su registro de pagos directamente por API. No se encontró una revocación que cierre ese camino en el repositorio; hay que comprobar los grants efectivos antes de afirmar exposición en producción.

**Corrección:** quitar las políticas inapropiadas de tablas de plataforma/cobro y reemplazar el barrido por permisos explícitos para cada tabla. No volver a ejecutar v54 sin corregir su alcance.

**Criterio de cierre:** dueño y staff leen su estado; sus intentos directos de insertar, actualizar o borrar cobros se rechazan. Solo admin/servicio autorizado modifica esos registros.

### R03 — Identidad compartida, permisos y revocación de colaboradores

**Ubicación:** [supabase-migration-v19.sql](../supabase-migration-v19.sql), líneas 34–72; [staff-auth.js](../staff-auth.js), líneas 109–127; [hub.html](../hub.html), líneas 1989–2009 y 2230–2233; [supabase-migration-v30.sql](../supabase-migration-v30.sql), `obtener_staff_cred`; [supabase-migration-v67.sql](../supabase-migration-v67.sql), líneas 50–53.

Todos los colaboradores se autentican en Supabase como el mismo `staff_uid`. La RLS concede `FOR ALL` por pertenencia al negocio, sin consultar rol, sucursal ni permisos de la persona. Ocultar una pantalla o negar una función del frontend no evita consultas directas a gastos, nóminas, staff, permisos o recetas.

La baja tampoco cierra todos los caminos. El login local acepta el hash cacheado sin comprobar `estado`; `StaffAuth.login` reutiliza una contraseña compartida persistida en localStorage; la última `obtener_staff_cred` no filtra personal activo; y `entrada_historial` acepta un NIP de alguien dado de baja. Además, `logout()` omite `signOut()` para staff y la limpieza conserva credenciales. El filtro de activos añadido a `staff_login` en v63 solo cubre una de esas puertas.

**Impacto:** un colaborador puede operar fuera de sus permisos y una persona dada de baja puede conservar acceso. El servidor tampoco tiene identidad individual confiable para atribuir acciones.

**Corrección:** sesiones individuales de empleados, membresía negocio/sucursal en servidor, permisos aplicados en RLS/RPC y revocación por estado. Mientras se migra, cerrar los caminos alternos, terminar la sesión al salir y definir cómo rotar las credenciales compartidas expuestas; no basta con agregar otro filtro de frontend.

**Criterio de cierre:** un mesero no lee nóminas por API; alguien de sucursal A no escribe en B; una persona dada de baja queda fuera en equipo nuevo, equipo con caché, sesión abierta y portal QR.

### R04 — Regresión del límite de intentos de autenticación

**Ubicación:** [supabase-migration-v63.sql](../supabase-migration-v63.sql), líneas 42–63; [supabase-migration-v30.sql](../supabase-migration-v30.sql), `staff_login`; [supabase-migration-v65.sql](../supabase-migration-v65.sql), `portal_perfil`; [supabase-migration-v56.sql](../supabase-migration-v56.sql), líneas 144–157.

v30 limitaba intentos con `_login_golpe`. v63 reescribe `staff_login` como una consulta SQL para añadir el filtro de activo y elimina esa llamada. Esa es la última definición del repositorio. La limitación visual del hub no protege llamadas directas a la RPC.

En el portal, `portal_perfil` y `entrada_historial` también comprueban hashes de NIP sin consumir el límite de `entrada_validar_nip`. Son puertas alternativas para probar NIPs cuando se conoce el token del negocio. `login_exito`, además, permite que `anon` borre el contador de cualquier identificador sin demostrar que hubo autenticación exitosa.

**Corrección:** conservar el freno en todas las funciones que verifican credenciales, centralizar la validación y hacer que el servidor valide el éxito antes de limpiar contadores.

**Criterio de cierre:** llamadas directas a cada puerta quedan limitadas; un cliente sin autenticar no reinicia el bloqueo de otra cuenta.

### R05 — Conflicto global de ID en conteos de inventario

**Ubicación:** [supabase-migration-v42.sql](../supabase-migration-v42.sql), líneas 44–66. No aparece una redefinición posterior de `inventario_conteo_registrar`.

La función valida token/NIP para el negocio A, acepta `p_datos.id` del cliente y ejecuta `ON CONFLICT (id) DO UPDATE SET datos = EXCLUDED.datos`. La actualización no comprueba que la fila en conflicto pertenezca a A. Al ser `SECURITY DEFINER`, la RLS habitual no debe darse por protección de esa actualización.

**Impacto y condición:** con credenciales válidas de A y conocimiento del ID de un conteo de B, se pueden reemplazar sus datos, manteniendo `negocio_id = B`. También falta comprobar la propiedad individual de un conteo que se corrige. No se demostró enumeración de IDs de otros negocios.

**Corrección:** conflicto compuesto por negocio/ID o actualización condicionada a negocio y actor autorizado, rechazando expresamente el conflicto ajeno. Derivar/sellar sucursal e identidad en servidor.

**Criterio de cierre:** en staging, intentar corregir un ID de B desde A no modifica B y devuelve una denegación clara.

### R06 — Recursos globales del bucket público modificables por clientes

**Ubicación:** [supabase-migration-v52.sql](../supabase-migration-v52.sql), líneas 30–43; [supabase-migration-v48.sql](../supabase-migration-v48.sql), `evidencias_read` y `etaax_carpeta_global`.

La última política de escritura del bucket `evidencias` comprueba solo bucket y autenticación. La lectura de v48 permite a todos los autenticados acceder a `_guias`, `catalogo` y `__catalogo__`. La combinación concede lectura y escritura de recursos compartidos que debían modificar solo los administradores. v55 protege el nuevo bucket privado, pero no corrige estas políticas del público.

**Impacto:** un cliente autenticado puede alterar recursos globales consumidos por otros clientes. También se permite crear archivos en carpetas ajenas. El alcance de sobrescribir/borrar archivos existentes de otro negocio depende de las políticas de lectura efectivas; no se da por probado para todos los archivos. Storage requiere permisos adicionales de lectura para sobrescrituras. [Referencia Supabase](https://supabase.com/docs/guides/storage/security/access-control).

**Corrección:** lectura pública/compartida separada de escritura; escritura global solo admin y escritura de negocio solo miembros autorizados del negocio correspondiente.

**Criterio de cierre:** usuario A no cambia una guía global ni crea/modifica objetos de B; ambos siguen pudiendo cargar sus propios archivos.

### R07 — Cola de salida sobrescrita entre pestañas

**Ubicación:** [etaax-store.js](../etaax-store.js), `mem`, `_leerTodo`, `set` y `_bajar`; [etaax-db.js](../etaax-db.js), líneas 349–370 y 457–470.

Cada pestaña hidrata una copia de memoria una vez. Todas persisten el array completo bajo la misma clave `etaax_outbox_v1`. No hay una operación transaccional de añadir/quitar items ni coordinación entre pestañas.

**Reproducción:** A y B hidratan `[]`; A guarda `pendingA`; B todavía lee `[]` y guarda `pendingB`. En el disco queda solo B. La prueba ejecuta el almacén real con dos contextos y un mismo IndexedDB simulado.

**Corrección:** persistir operaciones individuales con IDs y transacciones, coordinar el procesamiento entre pestañas y actualizar sus vistas de estado. Una señal entre pestañas por sí sola no garantiza atomicidad.

**Criterio de cierre:** captures simultáneas en dos módulos/pestañas, con y sin red, conservan todas las operaciones al recargar.

### R08 — Borrar no invalida el upsert pendiente del mismo registro

**Ubicación:** [etaax-db.js](../etaax-db.js), líneas 459–464, 580–610 y 895–897.

La deduplicación exige la misma operación. Por eso permanecen un upsert antiguo y un delete posterior del mismo ID. El procesador continúa si el upsert falla; puede completar el delete y dejar pendiente la escritura anterior.

**Reproducción:** primer upsert falla por red; delete tiene éxito; siguiente reintento del upsert tiene éxito. El registro reaparece y la cola termina en cero pendientes.

**Corrección:** ordenar/versionar operaciones por registro y hacer que un delete invalide escrituras anteriores, incluyendo las que estén en vuelo. Considerar tombstones persistentes para evitar resurrección por otro dispositivo.

**Criterio de cierre:** modificar y borrar sin red, o con errores intermitentes, deja el registro borrado después de todos los reintentos.

### R09 — Cambios sin persistencia cuando IndexedDB falla

**Ubicación:** [etaax-store.js](../etaax-store.js), líneas 145–173 y método `set`.

Con IndexedDB ausente, `set` de claves grandes actualiza memoria y devuelve `true`. `_bajar` limpia pendientes cuando ya terminó la apertura, sin escribir esas claves en localStorage. Si una transacción de IndexedDB falla, tampoco se restablecen los pendientes que se limpiaron antes de escribir.

**Reproducción:** guardar `etaax_n1_inv_local` sin IndexedDB deja el valor legible en memoria, pero ninguna copia durable en localStorage después de `flush`.

**Impacto:** inventarios, catálogo o cola parecen guardados y pueden desaparecer al cerrar o recargar en ese entorno.

**Corrección:** fallback real de escritura/borrado a localStorage cuando no hay IndexedDB; conservar/reintentar pendientes si falla el disco; comunicar el fallo durable al usuario.

**Criterio de cierre:** guardar y recargar conserva el dato sin IndexedDB. Una cuota llena o transacción abortada no se declara como guardado exitoso.

### R10 — Historiales y totales sin paginación

**Ubicación:** [administrativo/diario.html](../administrativo/diario.html), líneas 2571–2577 y 5959–5965; [financiero/resumen.html](../financiero/resumen.html), líneas 196–202; [recetas/inventarios.js](../recetas/inventarios.js), líneas 198–207.

Estas consultas cargan tablas enteras con `select` y procesan la respuesta como completa, sin recorrer páginas ni verificar cantidad total. Algunas rutas del catálogo sí paginan; el problema no es universal.

**Impacto y condición:** al superar el máximo configurado en Data API, pueden faltar gastos, cortes, movimientos o insumos y los totales se calculan sobre un subconjunto. Supabase documenta un máximo predeterminado de 1,000 filas, configurable por proyecto. El valor real de ETAAX no se comprobó. [Referencia oficial](https://supabase.com/docs/reference/python/select).

**Corrección:** consultas por negocio/sucursal/periodo, paginación con orden estable y agregados del servidor para saldos/totales. Subir el límite solo aplaza el fallo.

**Criterio de cierre:** un negocio de prueba con más filas que el máximo de la API produce los mismos totales que la consulta SQL completa.

### R11 — Realtime pisa la edición local pendiente

**Ubicación:** [administrativo/diario.html](../administrativo/diario.html), líneas 2595–2608 y 5992–6005.

Los reloads conservan registros locales únicamente cuando su ID no existe en la respuesta remota. Si se editó un registro existente y todavía está pendiente de subir, el remoto viejo reemplaza la edición. Estas funciones no usan `sbPendientes` para proteger upserts, aunque ese helper ya existe.

**Reproducción:** corte/gasto local con valor 200 y upsert pendiente; remoto con el mismo ID y valor 100. Tras el reload, la vista/cache local queda en 100. La cola puede aún conservar 200; no se afirma que este paso solo lo borre del servidor. Una edición posterior sobre la vista vieja sí puede reemplazar el cambio deseado.

**Corrección:** conservar versiones locales con upsert pendiente, gestionar conflictos y distinguir edición pendiente de registro nuevo.

**Criterio de cierre:** realtime no revierte el valor editado mientras el envío está pendiente, y después converge con el servidor.

### R12 — Resumen financiero incluye Matriz en otras sucursales

**Ubicación:** [financiero/resumen.html](../financiero/resumen.html), línea 219; regla correcta en [etaax-core.js](../etaax-core.js), líneas 25–27, y [financiero/kpis.html](../financiero/kpis.html), línea 537.

`_deSuc` acepta en cualquier sucursal los registros sin `sucursalId`. El núcleo y otros reportes los asignan a `suc_principal`.

**Reproducción:** seleccionar sucursal B y evaluar un corte antiguo sin sucursal devuelve `true`. Sus ingresos/gastos pueden entrar en el P&L de B y diferir de KPIs.

**Corrección:** delegar al filtro canónico `EtaaxCore.scopeSuc`, manteniendo la vista global cuando no hay sucursal seleccionada.

**Criterio de cierre:** datos legacy solo suman en Matriz; la suma de sucursales coincide con la vista global y los reportes coinciden entre sí.

### R13 — Fallo de consulta mostrado como ausencia de datos

**Ubicación:** [financiero/resumen.html](../financiero/resumen.html), líneas 193–214.

`cargar()` transforma `data = null` en `[]` y no comprueba `error` antes de sustituir `_c`. Una consulta rechazada o fallida puede generar ingresos/gastos en cero o un resumen parcial sin indicar que falta información.

**Corrección:** validar cada respuesta, conservar el último estado válido cuando corresponda y mostrar explícitamente que el reporte no está disponible/completo.

**Criterio de cierre:** simular red caída, sesión vencida o permiso denegado nunca presenta un cero nuevo como cifra financiera válida.

### R14 — Cancelación de Stripe sin verificar la suscripción vigente

**Ubicación:** [supabase/functions/stripe-webhook/index.ts](../supabase/functions/stripe-webhook/index.ts), líneas 120–155; [supabase-migration-v44.sql](../supabase-migration-v44.sql), líneas 109–112.

`customer.subscription.deleted` se procesa como si su objeto fuera una factura. El ID de la suscripción eliminada está en `obj.id`, pero se intenta obtener de `subscription`/`parent`. La función SQL cancela por negocio, sin comparar ese ID con `stripe_subscription_id` vigente.

**Impacto y condición:** si una suscripción antigua termina después de crear otra para el mismo cliente/negocio, su evento puede cancelar el acceso ya pagado de la nueva. Depende de ese flujo y de los eventos desplegados. Stripe documenta que este evento corresponde a una suscripción que termina. [Referencia Stripe](https://docs.stripe.com/billing/subscriptions/webhooks).

**Corrección:** tratar cada tipo de objeto por separado y condicionar la cancelación a la suscripción vigente; registrar e ignorar eventos de suscripciones sustituidas.

**Criterio de cierre:** cancelar `sub_antigua` después de activar `sub_nueva` no cambia el estado de la nueva, incluso al reordenar/repetir eventos.

## Observaciones que necesitan verificación adicional

- **Archivos sensibles antiguos:** v55 manda las nuevas evidencias sensibles al bucket privado, pero deja lo anterior en el público y admite URLs antiguas en el cliente. Confirmar si siguen allí documentos de personal, gastos o cortes y preparar su migración con actualización de referencias. No se consultaron esos objetos.
- **Pagos de confirmación diferida:** el webhook descarta checkout no pagado, no escucha `checkout.session.async_payment_succeeded` e ignora la primera factura. Si se habilitan métodos de pago diferido compatibles con el flujo, revisar que el pago posterior active el servicio. [Flujo documentado por Stripe](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted).
- **Checkout repetido:** `crear-checkout` crea una sesión nueva por llamada y no rechaza una suscripción ya vigente. Comprobar en Stripe sandbox el recorrido de doble clic, regreso al hub y pago de dos sesiones.
- **Conflictos entre dispositivos:** los upserts envían el JSON completo sin exigir una versión previa. El servidor puede reemplazar cambios simultáneos de otro dispositivo. Probar edición concurrente de cortes, inventarios y documentos por negocio.
- **Control de suscripción:** las políticas de datos revisadas no utilizan `negocio_esta_activo`; el bloqueo operativo depende de la aplicación. Decidir qué lecturas/operaciones deben seguir disponibles al vencer y hacer cumplir la regla en servidor.
- **Entrega y recuperación:** hay hooks locales, pero no un pipeline de CI en el repositorio. La raíz se publica sin un paso de validación, y las migraciones/Edge Functions van por separado. No se verificaron alertas, RPO/RTO, respaldo de Storage ni una restauración completa.

## Fortalezas que conviene conservar

- El núcleo compartido evita duplicar fórmulas y los tests ejercitan muchos casos reales de caja e inventario.
- La cola conserva errores de red/sesión y tiene visibilidad de pendientes y descartes; los problemas encontrados requieren mejorar sus garantías de orden y persistencia.
- La carta pública usa una lista de campos permitidos y un token, con filtros explícitos en las últimas migraciones.
- La firma del webhook de Stripe se verifica antes de registrar pagos; la RPC de pagos está restringida a `service_role`.
- Las llaves de servicio de las Edge Functions se obtienen del entorno. La llave `anon` del frontend es pública por diseño; su presencia no se considera una filtración de secreto.
- Existen separación de evidencias sensibles, headers de seguridad y bloqueos de descarga de documentación/migraciones en Netlify.

El uso de JavaScript vanilla no obliga a reescribir el ERP. La prioridad es hacer cumplir permisos en servidor y dar garantías al almacenamiento. Después conviene separar scripts de páginas grandes, centralizar lectura paginada/filtros y convertir los casos de esta auditoría en pruebas de regresión que esperen el comportamiento corregido.

## Orden recomendado de trabajo

1. Comparar las definiciones reales con el repositorio usando el SQL de inspección adjunto. Corregir R01 y los permisos de cobro/recursos globales R02/R06.
2. Cerrar los caminos de baja/login R03/R04 y la actualización de conteos R05. Preparar identidad individual para staff.
3. Corregir persistencia y orden de la cola R07–R09, y proteger ediciones pendientes R11. Validar dos pestañas y dos dispositivos.
4. Corregir alcance, paginación y errores de reportes R10/R12/R13; revisar Stripe R14 con eventos en sandbox.
5. Automatizar pruebas de políticas con dos negocios y varios roles; verificar migraciones en staging, CI, monitoreo y una restauración completa.

## Cómo repetir la evidencia

Desde la raíz del repositorio:

```sh
node tests/money-tests.js
node tests/store-tests.js
node docs/auditoria-2026-10-09-repro.cjs
```

[El script de reproducciones](auditoria-2026-10-09-repro.cjs) usa datos ficticios y no llama servicios externos. Sus assertions documentan el estado vulnerable encontrado: salir con código 0 significa que reprodujo ese estado, **no que aprueba una versión para producción**. Al corregir, transformar cada caso en un test que espere seguridad/conservación de datos.

[El SQL de inspección](auditoria-2026-10-09-supabase.sql) contiene solo consultas de esquema/permisos y una transacción de lectura. No se ejecutó durante esta auditoría. Sirve para conocer políticas, grants, funciones y buckets actuales sin consultar registros de clientes. Las pruebas que escriban registros deben hacerse en staging con datos ficticios.
