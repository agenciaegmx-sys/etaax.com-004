# Supervisión de v79 y preparación del Resumen financiero

**Código revisado:** `28b57a7`. Edwin informa que v78 y v79 están aplicadas y que comprobó el recorrido normal desde el teléfono. No hice llamadas a producción.

**Verificación propia:** 4206 comprobaciones de dinero, 84 del almacén y `tests/probar-sql-v78-v79.mjs` pasan. Las tres puertas de escritura ahora acumulan sus propios fallos desde cero, rechazan sin insertar y frenan en el intento 13. La espera larga y sus límites también pasan. El rechazo entre negocios de R05 se conserva en la prueba local.

Los tres casos anteriores de la supervisión del lote 11 están corregidos. Queda un caso de compatibilidad del cliente antes de cerrar completamente la entrega.

## Una copia anterior del ayudante vuelve a perder una captura rechazada

Las cinco llamadas del cliente delegan la comprobación a `etaaxRegistroFallo`. Si ese ayudante no está disponible, vuelven a mirar únicamente `r.error`. Sin embargo, v79 rechaza un NIP incorrecto con `data:null, error:null`.

**Reproducción:** ejecuté `_registrarBatch` actual con esa respuesta y dos versiones reales de `staff-area.js`:

| Versión del ayudante | Capturas pendientes conservadas | Mensaje |
|---|---:|---|
| Actual | 1 | «No se guardó: tu NIP ya no es válido…» |
| `7330663`, antes de v79 | 0 | «✓ 1 registro(s) guardados…» |

La respuesta rechazó el registro, pero la segunda combinación anuncia éxito y borra la captura. Evidencia local: `/private/tmp/etaax-v79-captura-cache.json`.

**Por qué hay que contemplarlo:** el HTML conserva `/staff-area.js?v=2`. El service worker móvil sirve primero la copia guardada y la actualiza en segundo plano (`app-movil/sw.js:77`), así que no garantiza que ambos scripts sean de la misma entrega. No verifiqué qué copia tienen ahora los dispositivos de producción.

**Corrección concreta:** en las cinco llamadas, comprobar un identificador válido también cuando falta el ayudante. Una respuesta vacía siempre debe conservar la captura y mostrar rechazo. Añadir el caso con el ayudante anterior o ausente a las pruebas; actualizar la versión del recurso compartido y la caché móvil para distribuir la nueva entrega. Revisar cómo se actualizarán las pestañas o aplicaciones que sigan usando el cliente anterior.

Los cinco sitios están en `entrada.html` (conteo y lote), `checklist.html`, y `app-movil/app.js` (checklist y lote).

## Siguiente bloque: integridad de los datos del Resumen

Confirmé la observación de Claude: `financiero/resumen.html:200` consulta siete colecciones sin paginación ni control de integridad de la carga. KPIs también tiene consultas de colecciones sin paginar (`financiero/kpis.html:415`). El filtro por mes ocurre después de recibir los datos.

El aviso de R13 cubre errores; una respuesta exitosa recortada por el límite del servidor puede pasar por completa. El valor de Max rows ayuda a medir la situación actual, pero no reemplaza una lectura completa.

Antes de añadir indicadores y oportunidades: paginar con un orden estable, comprobar la integridad de la carga, mantener los avisos de información incompleta en pantalla e impreso, y probar con más filas que el límite simulado. Verificar que Resumen y KPIs concilien importes para el mismo negocio, sucursal y periodo.

R03 sigue abierto. Después de este ajuste del cliente y de la integridad de carga, continuar con el diseño del Resumen que Edwin quiere mostrar.
