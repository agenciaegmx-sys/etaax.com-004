# Caja fuerte, anticipos, ventas, mayores y recordatorios — 17 de octubre de 2026

Se aplicó el estilo de Gastos diarios, Cortes y Nóminas a Caja fuerte y sus
ventanas de conciliación/historial, Anticipos y Ventas especiales, el listado
de Gastos mayores y los Recordatorios de pagos. Se conservan los controles,
campos y flujos; el formulario de gasto mayor reutiliza el de Gastos diarios.

La paleta usa superficies cálidas, acciones terracota y detalles cian. Saldos,
deuda, vencimientos y avisos conservan sus señales verdes, rojas y amarillas.
La reserva se distingue con cian. Las capturas mantienen cabecera y acciones
visibles mientras el cuerpo desplaza; los listados conservan scroll interno.
Los recordatorios mantienen su cierre por sesión y el botón de ir a pagar.

## Integración

- `administrativo/operaciones-ui.css` y `administrativo/operaciones-ui.js`:
  estilos y SVG decorativos acotados a las ventanas y los recordatorios.
  No sustituyen handlers, cálculos ni persistencia.
- El modal de confirmación usado al devolver anticipos conserva rojo para
  acciones destructivas. El modal compartido de contraseña limpia también el
  emoji de candado con llave de “Desbloquear”; la autorización no cambia.
- 66 iconos de [iconos-etaax, commit c5d3163](https://github.com/agenciaegmx-sys/iconos-etaax/commit/c5d3163872a97b7dbebeb5ba82d260882bcd8c90):
  Caja fuerte (19, `cjf-`), Anticipos/Ventas (26, `ev-`), Mayores (15, `gm-`) y
  Recordatorios (6, `rem-`). [Galería](https://github.com/agenciaegmx-sys/iconos-etaax/blob/main/etaax-operacion-administrativa-iconos.html).
- Sprite y huellas actualizados mediante `node iconos/generar.js` y
  `node versionar.js`. Las otras páginas solo actualizan referencias compartidas.

## Corrección necesaria para abrir una venta

El código anterior de `abrirModalVentaExtra()` asignaba la fecha usando
`d.fecha || periodoVal || todayStr()`, pero `periodoVal` ya no existe en esta
página. Una venta nueva producía `ReferenceError: periodoVal is not defined`.
Ahora conserva `d.fecha` al editar y usa `todayStr()` al crear. Se reprodujo
el fallo del código anterior y se comprobó el botón real sin declarar esa
variable en la prueba. Esta es la única modificación de una función de negocio;
los demás scripts inline y todos los handlers se compararon con HEAD.

## Verificación

- `node tests/money-tests.js`: 4,570 comprobaciones, cero fallas.
- Chrome a 1440, 768, 390 y 320 px, temas claro/oscuro y pantalla 320 × 640.
- Recordatorio: texto/concepto conservados, aviso vencido y navegar a Gastos
  fijos con cierre por sesión.
- Venta nueva de $5,000: apertura, fecha actual, método, guardado, edición y
  minimizar/restaurar sin perder valores.
- Anticipo de $1,200 a la cuenta elegida: saldo por aplicar $1,200; devolverlo
  registra la salida y deja saldo cero, conservando el rastro de ambos registros.
- Gastos mayores: clave incorrecta no abre, clave válida desbloquea, registro
  de $8,000 conserva su tipo y volver a bloquear oculta el contenido.
- Caja fuerte: $10,000 en caja y $3,000 en banco, con $1,000 apartado, muestran
  $12,000 disponibles. Una conciliación de +$200 lleva el disponible a $12,200.
  Se probaron detalle de cortes, captura de conciliación e historial.
- 132 SVG validados como XML y 66 fuentes locales idénticas a las publicadas.
- Sintaxis JS, `git diff --check` y `node versionar.js --revisar` correctos.

El navegador utiliza datos ficticios, Supabase simulado y bloquea la red externa.
No se hicieron pagos, movimientos ni migraciones de datos reales.

## Hallazgo previo fuera de los ajustes visuales

La conciliación se probó en la sucursal principal (`suc_principal`). Al revisar
el historial en una sucursal de prueba con otro ID, se observó que
`_concGuardar()` no escribe `sucursalId`, mientras `_scopeSuc()` atribuye los
registros sin ese dato a `suc_principal`. El movimiento puede quedar fuera del
historial de una sucursal distinta. Este comportamiento ya existía y no se
modificó en esta actualización visual; requiere una corrección específica y
revisión de los registros históricos antes de reasignarlos.

Reproducir: `node docs/operacion-administrativa-visual-2026-10-17/revisar-operaciones-ui.cjs`.
`CHROME_BIN` permite indicar otra instalación de Chromium.

[Caja fuerte](operacion-administrativa-visual-2026-10-17/caja.png) ·
[Anticipo](operacion-administrativa-visual-2026-10-17/anticipo.png) ·
[Venta especial](operacion-administrativa-visual-2026-10-17/venta.png) ·
[Gastos mayores](operacion-administrativa-visual-2026-10-17/mayores.png) ·
[Recordatorio](operacion-administrativa-visual-2026-10-17/recordatorio.png) ·
[Móvil](operacion-administrativa-visual-2026-10-17/movil.png).
