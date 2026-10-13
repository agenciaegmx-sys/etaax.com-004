# Ventas: revisión y primer bloque propuesto

Fecha: 2026-10-13. Objetivo del dueño: preparar los submódulos de Salud Financiera y después convertir Resumen en la entrada del módulo.

Esta entrega es una revisión y una propuesta de trabajo. Se examinó el código actual y se reprodujeron seis casos con datos ficticios. La reproducción ejecuta el script original de Ventas y sus conexiones de eventos en Node VM, con DOM simulado; no constituye una prueba de navegador ni de producción. No se modificó el funcionamiento de las pantallas ni se llamó a Supabase.

## Lo que conviene corregir primero

| Prioridad | Hallazgo y evidencia | Corrección propuesta |
| --- | --- | --- |
| Alta | **Un clic puede duplicar otro ingreso.** `financiero/ventas.html:403` llama `guardarOtro()` mediante `onclick`, y `:1260` vuelve a conectarla mediante `addEventListener`. El identificador del alta continúa vacío entre ambas llamadas. La reproducción de un solo clic con $500 produjo dos identificadores, dos envíos y $1,000 en la lista. Guardar metas tiene también las dos conexiones (`:365`, `:1258`), aunque ahí se sobrescribe el mismo documento. | Una conexión por acción y protección contra doble clic. Probar el botón con sus conexiones reales; un clic de alta debe producir un registro y un envío. `sbUpsert` encola: no confundir que se llamó con confirmación del servidor. |
| Alta | **Guardar o eliminar desde una sucursal recorta la caché de las demás.** `:1015` y `:858` reemplazan `_cacheOtros` a partir de `loadOtros()`, que ya filtra por sucursal (`:544`). Con $200 en otra sucursal, guardar $50 en Matriz deja la otra vista en cero hasta recargar. No envía una eliminación de ese registro al servidor. | Actualizar la colección completa en memoria por identificador; aplicar el filtro únicamente al consultar o pintar. Probar alta, edición y baja alternando sucursales y vista global. |
| Alta | **Ventas todavía carga colecciones sin paginar y oculta fallos de lectura.** `:432`–`:443` consultan `cortes` y `sf_otros` de un solo viaje; los errores simplemente dejan la caché anterior o vacía. Puede diferir del Resumen, que ya usa el lector común. | Integrar `etaaxLeerVarias` para ambas colecciones y tratar también el fallo del documento `sf_metas`. Mostrar cargando, vacío confirmado e incompleto, con reintento. El aviso debe acompañar la impresión del periodo y el histórico semanal. Conservar negocio y sucursal en todo el proceso. |
| Media | **Las metas de día, semana y rango desaparecen en pantalla.** `renderAll()` solo obtiene `mes` en vista mensual (`:694`), mientras el impreso calcula la meta fecha por fecha (`:1027`, `:1053`). Con una meta uniforme de octubre de $3,100: día $0 en el cálculo de pantalla frente a $100 en el impreso; semana $0 frente a $700. | Calcular la meta del rango sumando las metas de cada fecha, incluyendo rangos que cruzan meses. Pantalla, detalle e impreso deben usar la misma función y los mismos parámetros. |
| Media | **La meta impresa puede quedarse vieja.** `:1026` guarda su distribución en `window.__mdCache` y no la invalida al guardar una meta. Tras calcular un día con meta mensual de $3,100, cambiarla a $6,200 conserva $100 en impresión cuando corresponde $200. | Invalidar al editar metas y cambiar el contexto que afecta al reparto, o eliminar esta caché si no aporta una mejora medida. |
| Media | **Se proyectan meses terminados y se extrapolan días sin captura.** `:704`–`:708` divide entre fechas con corte y multiplica por todos los días calendario. Con agosto terminado, 26 días de $100 muestran venta $2,600 y proyección $3,100. | Proyectar únicamente periodos en curso, con una base explícita y suficiente: días operativos transcurridos, captura cubierta y ventas incluidas. Un día sin captura debe distinguirse de un día cerrado o de venta cero. En un mes terminado presentar su resultado y cobertura. |

La fórmula principal de ventas ya delega en `EtaaxCore.ventasBruta` (`financiero/ventas.html:559`, `etaax-core.js:91`): efectivo + tarjeta + transferencia + anticipos aplicados, sin propinas. Conviene mantenerla como referencia al corregir estas rutas; estos hallazgos no requieren rehacer el cálculo del corte.

## Preparación para el Resumen

1. **Un agregado de ventas que puedan consumir ambas pantallas.** Debe recibir negocio, sucursal, rango y datos completos; devolver venta de cortes, otros ingresos separados, medios de cobro, propinas, comensales, cobertura de datos y metas. La interfaz y la impresión solo lo presentan. Así se evita escribir una segunda fórmula cuando se construya el Resumen.
2. **Separar la venta del resto de ingresos al mostrarla.** Hoy cumplimiento y progreso usan `ventas + otros`. Para una meta de venta, propongo usar venta de cortes y mostrar otros ingresos aparte. Este cambio de significado debe aplicarse de manera coherente a sus lectores en Resumen y Estadísticas; no cambiar solamente un rótulo.
3. **Metas por sucursal como decisión del siguiente bloque.** Actualmente `sf_metas` se guarda por negocio y mes (`:538`–`:543`, `:982`), sin clave de sucursal. La pantalla puede estar en una sucursal mientras edita la meta compartida. La interfaz debe indicar el alcance vigente. Antes de introducir metas independientes, definir cómo conservar la meta histórica del negocio y cómo sumar las nuevas metas en vista global; no replicar la meta antigua en cada sucursal.
4. **Usar lo ya capturado y señalar lo que falta.** El corte guarda `tarjetaCuentas`, `transferCuentas`, `propTarjetaCuentas`, `comensales`, `alimentos`, `bebidas` y `otros` (`administrativo/diario.html:3748`–`:3758`). Se pueden aprovechar sin pedir otra captura. Los registros anteriores sin desglose necesitan un importe visible como «sin cuenta/desglose identificado»; asignarlos arbitrariamente falsearía el detalle. Cheque promedio debe usar ventas y comensales de cortes compatibles y mostrar su cobertura.

## Propuesta de interfaz

Orden de lectura: **qué vendí → cómo cobré → cómo voy frente a mi meta → qué registros lo explican**.

- Encabezado con negocio/sucursal y periodo siempre visibles. Añadir Año, validar rangos y resolver el cambio a Semana: hoy `:1164` cambia el tipo de campo sin asignar una semana válida. Navegar desde Resumen o regresar debe conservar el mismo alcance y periodo.
- Primera fila: ventas, meta/cumplimiento, comensales y cheque promedio. Propinas y otros ingresos se muestran separados. Promedio diario y proyección explican qué días usan.
- Sección de medios de cobro: efectivo, tarjetas/TPV y transferencias, con desglose por cuenta. Una forma de pago y un canal comercial —comedor/para llevar— son dimensiones distintas. Mantener anticipo aplicado como componente identificable de la venta, porque su dinero se cobró antes.
- Evolución y metas en una gráfica legible; el gráfico actual se distribuye en varias filas con altura fija (`:52`), lo que dificulta comparar días. Distinguir sin captura, cerrado, cero y futuro.
- Detalle del periodo con acceso a sus cortes. «Definir metas», «Otros ingresos», imprimir e histórico conservan su lugar dentro de una barra de acciones más simple.
- En PC, tarjetas y bloques con espacio consistente. En móvil, tarjetas apiladas y detalle desplegable por día; reservar el desplazamiento horizontal para tablas extensas. Conservar marca, temas e iconos compartidos.

## Orden de ejecución y cierre

**Lote A: confiabilidad de Ventas.** Corregir los seis hallazgos de la tabla y la selección válida de semana. Cambios localizados en Ventas, reutilizando el lector existente. No requiere migración para estos arreglos.

**Lote B: presentación y conexión al Resumen.** Agregado compartido, medios de cobro/cuentas, indicadores con cobertura, Año y navegación con filtros. Acordar el alcance de las metas y de su cumplimiento antes de extender su modelo a todos los consumidores.

**Criterios para cerrar A:** un ingreso produce una sola alta; operar en Matriz conserva otras sucursales; datos por encima del límite llegan completos; un fallo se reconoce en pantalla y papel; metas de día/semana/rango e impresión concilian después de editarlas; el mes cerrado no muestra una proyección futura; Semana abre un rango válido. Después verificar PC y móvil con datos ficticios y abrir las pantallas existentes para comprobar la navegación.

**Criterio para cerrar B:** Ventas y Resumen concilian venta, otros ingresos y metas con el mismo negocio, sucursal y periodo, incluidos registros antiguos y varios turnos. Los medios de cobro deben conciliar con venta de cortes identificando anticipos aplicados; las propinas permanecen aparte. No declarar ambos reportes equivalentes si usaron distinto reparto de días operativos o factores históricos.

Siguiente submódulo recomendado: Gastos. Una vez conciliados ingresos y egresos, continuar con Cuentas, Previsiones y la integración final del Resumen como entrada.

## Evidencia de esta revisión

- Ejecución: `node /private/tmp/etaax-revision-ventas-20261013.cjs` — seis casos reproducidos sobre funciones y conexiones originales.
- Resultado: `/private/tmp/etaax-revision-ventas-20261013.json`.
- SHA-256 de `financiero/ventas.html` revisado: `7541ad525f69e3bd3295752efa227267a9ef887106146a01f8d2da097aeff506`.
- No se ejecutó el candado completo ni se comprobó el comportamiento visual en navegador en esta revisión. Las reproducciones cubren los defectos descritos, no todo el módulo.
