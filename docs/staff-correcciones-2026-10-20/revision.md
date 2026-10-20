# Correcciones de Staff · 20 de octubre de 2026

- Domingo se puede seleccionar, guardar y volver a abrir como día de pago en
  el catálogo de Staff y en el editor compartido de colaborador.
- El sueldo diario puede quedar vinculado al mínimo del negocio o personalizado.
  Cambiar el parámetro actualiza la referencia que usan catálogo, expediente,
  pago de nómina, proyección financiera y simulador. Los importes personalizados,
  los ceros capturados y el sueldo fijo por periodo se conservan.
- Las bajas, su contador, búsqueda y reactivación respetan la sucursal activa.
  Los registros sin sucursal pertenecen a Matriz. La vista global conserva el
  archivo completo y permite acotarlo con su filtro de sucursal.

## Compatibilidad con registros antiguos

Antes se guardaba el mínimo como una cifra fija y `sueldoCapturado` se marcaba
incluso para una cantidad precargada. No había una marca fiable de su origen.

Al cambiar el mínimo se toma una foto de los registros anteriores: si su sueldo
por día coincidía con el mínimo vigente ANTES del cambio, se considera vinculado;
los importes distintos quedan personalizados. Esa clasificación se conserva
para que un personalizado no se vincule cuando un mínimo posterior alcance
casualmente el mismo importe. Los registros nuevos conservan su origen explícito.

La foto vive junto al parámetro en `gf_nomina_params.datos.referenciasSueldo`.
Se publica con el nuevo mínimo en un solo documento, sin reescribir fichas ni
credenciales. Si falla la consulta o el guardado, el mínimo local no se adelanta,
el modal permanece abierto y muestra el error. No requiere migración SQL.

No se puede recuperar por el importe solo una intención que no quedó guardada:
si el parámetro ya había cambiado y una ficha antigua conserva otro monto, se
respeta ese monto. La opción **Usar mínimo del negocio** permite vincularla
explícitamente. Los sueldos personalizados se distinguen incluso si se captura
exactamente la misma cantidad que el mínimo.

El editor compartido actualiza registros con upsert; deja de vaciar la tabla
antes de insertar. Conserva el NIP existente de un colaborador con rol de gerente
al editar otros datos, además de los campos desconocidos por ese formulario.
Los cambios conservan los controles de autorización existentes.

## Verificación

`node docs/staff-correcciones-2026-10-20/revisar-staff.cjs`

14 casos en Chrome, a 1440 y 390 px, con Supabase simulado y solicitudes externas
bloqueadas. Incluyen guardado y reapertura de domingo, cambios sucesivos de mínimo,
un personalizado igual al mínimo, cero intencional, modificación y revinculación,
archivo de dos sucursales, filtro global, búsqueda, reactivación, ambos editores,
recarga con referencias y credenciales conservadas, y error visible de guardado.
Las capturas se guardan junto a este reporte. No se modifican datos de producción.

`tests/money-tests.js` agrega comprobaciones de cálculo, los tres consumidores,
registros antiguos, aislamiento de bajas y fallos de persistencia. Los candados
monetario y de almacenamiento se ejecutan en el pre-push.

Se versionan también `nomina-params.js` y `staff-modal.js` para que el navegador
reciba conjuntamente la nueva regla y sus editores.
