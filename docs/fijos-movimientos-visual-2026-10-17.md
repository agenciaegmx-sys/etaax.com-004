# Gastos fijos, depósitos y retiros — 17 de octubre de 2026

Se aplicó el estilo de Gastos diarios, Cortes y Nóminas al listado de Gastos
fijos, su selector de pagos, el listado de movimientos, la captura de depósito,
retiro o previsión y la vista completa de movimientos. Botones terracota,
selección cian, superficies cálidas, DM Sans y SVG en lugar de emojis del sistema.

Se conservan verde para entradas/pagos, rojo para retiros y vencimientos,
y amarillo para avisos y caja fuerte. La vista completa identifica los retiros
en rojo, incluidos su importe y borde, manteniendo los valores calculados.
El formulario conserva sus campos, selectores nativos y reglas; cabecera y pie
permanecen visibles mientras se desplaza el contenido. Las tablas extensas
mantienen desplazamiento dentro de su contenedor en móvil.

## Integración

- `administrativo/fijos-ui.css` y `administrativo/fijos-ui.js`: presentación del
  listado y selector, sin reemplazar autorización ni formulario de pago.
- `administrativo/movimientos-ui.css` y `administrativo/movimientos-ui.js`:
  listado, captura y vista completa, con controles de edición y eliminación.
- El selector compartido alterna Nóminas/Gastos fijos sin acumular iconos.
- Se conservan conceptos, proveedores, personas y nombres de cuentas. La ruta
  de movimiento sustituye únicamente los marcadores generados por el sistema.
- 43 iconos en [iconos-etaax, commit 1d95808](https://github.com/agenciaegmx-sys/iconos-etaax/commit/1d958089f01a705b4396599f628e4436baeb5fd3):
  `gastos-fijos` (18, prefijo `fij-`) y `movimientos-caja` (25, prefijo `mov-`).
  Ambos temas y [galería de descarga](https://github.com/agenciaegmx-sys/iconos-etaax/blob/main/etaax-fijos-movimientos-iconos.html).
- Sprite regenerado con `node iconos/generar.js`; huellas con
  `node versionar.js`. Las demás páginas solo actualizan su referencia al sprite.

## Verificación

- Scripts inline y handlers de negocio de `diario.html` idénticos a HEAD.
- Chrome a 1440, 768, 390 y 320 px; temas claro/oscuro y pantalla 320 × 640.
- Gasto fijo de $3,500: conserva monto, proveedor e ID al pasar al pago.
  Selector limitado a la sucursal y alternancia con Nóminas sin duplicar SVG.
- Depósito de $1,000, retiro de $200 y traslado de $300 al banco: efecto
  resultante $500 en caja fuerte y $300 en banco. Apartar $100 no mueve saldos.
- Guardado y edición conservan cuatro registros, sin duplicarlos; filtros de
  retiro, previsión y categoría; vista completa; minimizar/restaurar/cerrar.
- `node tests/money-tests.js`: 4,570 comprobaciones, cero fallas.
- 86 SVG validados como XML; copias oscuras locales idénticas a las publicadas.
- Sintaxis JS, `git diff --check` y `node versionar.js --revisar` correctos.

Pruebas con Supabase simulado y red externa bloqueada: sin movimientos ni pagos
reales. No hubo cambios de esquema ni de reglas financieras.

Reproducir: `node docs/fijos-movimientos-visual-2026-10-17/revisar-fijos-movimientos-ui.cjs`.
`CHROME_BIN` permite indicar otra instalación de Chromium.

[Gastos fijos](fijos-movimientos-visual-2026-10-17/fijos-listado.png) ·
[Selector](fijos-movimientos-visual-2026-10-17/fijos-selector.png) ·
[Captura](fijos-movimientos-visual-2026-10-17/deposito.png) ·
[Movimientos](fijos-movimientos-visual-2026-10-17/movimientos.png) ·
[Vista completa](fijos-movimientos-visual-2026-10-17/vista-completa.png) ·
[Móvil](fijos-movimientos-visual-2026-10-17/movil.png).
