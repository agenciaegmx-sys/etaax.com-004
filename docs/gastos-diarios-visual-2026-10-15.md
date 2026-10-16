# Gastos diarios — actualización visual del 15 de octubre de 2026

Se aplicó la referencia del usuario a la ventana de Gastos diarios y sus
modales de captura, detalle y límite. Se conservaron los cinco indicadores,
el orden de los campos, los filtros, la autorización de gastos mayores y los
eventos originales de `administrativo/diario.html`.

## Cambios

- Iconos SVG oficiales, acentos cian, acciones principales terracota y fondos
  de la paleta del inicio y módulos; adaptación a temas oscuro y claro.
- Encabezados, minimizar/cerrar, filtros de período, tabla, estado vacío,
  métodos de pago, estados, comprobante, evidencia y carga desde el celular.
- Pagado conserva verde, pendiente amarillo y gasto mayor rojo. Programado
  usa cian. No se cambiaron las variables semánticas globales.
- Cabecera y acciones de captura visibles mientras se desplaza el formulario;
  ajustes para 320 px, móvil, tablet y escritorio. El cargador conserva su
  evento original y también se puede activar con Enter o espacio.
- Etiquetas «Nuevo gasto» y «Límite por gasto» en los botones existentes.

## Archivos y origen

`administrativo/gastos-ui.css` y `administrativo/gastos-ui.js` contienen la
capa visual, acotada a las ventanas de gastos. El JS decora los controles
existentes y repone iconos cuando los renderizados originales recrean texto.
No modifica datos, cálculos, llamadas al servidor ni permisos. Los scripts
inline y handlers originales de `diario.html` se compararon contra HEAD:
son idénticos.

Se importaron 29 SVG de [iconos-etaax](https://github.com/agenciaegmx-sys/iconos-etaax/tree/24dc51ba25a4072a8136bb30192fbd07086e41f8/iconos/administrativo/oscuro),
commit `24dc51ba25a4072a8136bb30192fbd07086e41f8`, a
`iconos/administrativo/oscuro/`. `iconos/generar.js` agrega el prefijo `adm-`
y regenera `etaax-iconos.js`. No se redibujó la geometría.

`versionar.js` incluye los dos archivos nuevos. Los cambios de una línea en
las otras páginas son la huella del sprite compartido, para invalidar caché;
no son rediseños de esos módulos.

## Verificación

- Chrome real con Supabase simulado y peticiones externas bloqueadas.
- Anchos de 1440, 768, 390 y 320 px: listado vacío y con registros, cinco
  indicadores, filtro por estado, métodos de pago, factura, fecha programada,
  guardado mediante el botón original, detalle, límite, minimizar y restaurar.
- Capturas de tema claro y oscuro; sin errores de JavaScript en esos recorridos.
- `node tests/money-tests.js`: 4,550 comprobaciones, cero fallas.
- `node tests/store-tests.js`: 84 comprobaciones, cero fallas.
- `node versionar.js --revisar` y `git diff --check`: correctos.

El entorno de prueba no escribe en producción. Se conservó el criterio
contable existente: el indicador superior cuenta gastos pagados, mientras
que la tabla incluye pendientes/programados. No se sustituyó por los
cálculos ilustrativos de las imágenes de referencia.

Las capturas usan registros ficticios: [listado](gastos-diarios-visual-2026-10-15/listado.png),
[captura](gastos-diarios-visual-2026-10-15/captura.png) y
[móvil](gastos-diarios-visual-2026-10-15/movil.png).

## Continuidad

Esta actualización se integra junto con el rediseño de Cortes de caja.
Al comenzar, `main` ya estaba cuatro commits por delante de `origin/main`,
hasta `8d8c465`, con los trabajos de catálogos de Claude. Esos commits se
conservan sin modificaciones.
