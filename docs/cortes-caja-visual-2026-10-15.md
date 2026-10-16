# Cortes de caja — actualización visual del 15 de octubre de 2026

Se dio continuidad al diseño de Gastos diarios en el listado, la captura y
el detalle de cortes: iconos, botones terracota, selección cian, superficies,
tipografía, tablas y estados vacíos. Se conservan los indicadores, secciones,
campos, permisos y cálculos originales.

Las ventas mantienen verde, los gastos rojo y las propinas/resguardo amarillo.
La captura mantiene la cabecera y el pie visibles al desplazarse. Las formas
de pago se acomodan en móvil; las tablas extensas conservan desplazamiento
horizontal dentro de su contenedor.

## Integración

- `administrativo/cortes-ui.css`: estilos acotados a `dxOv_cortes`, `modalCorte`
  y `modalVerCorte`, con tema claro/oscuro y ajustes para móvil.
- `administrativo/cortes-ui.js`: iconos decorativos y presentación de estados
  de los controles existentes. No reemplaza funciones de negocio.
- `iconos/cortes-caja/oscuro/`: 40 SVG de
  [iconos-etaax](https://github.com/agenciaegmx-sys/iconos-etaax/tree/021333e2ae4ed842d88e707de1332bf8cfe351bd/iconos/cortes-caja),
  commit `021333e2ae4ed842d88e707de1332bf8cfe351bd`, con prefijo `cor-`.
- Sprite regenerado y huellas actualizadas con `node iconos/generar.js` y
  `node versionar.js`. Las demás páginas solo cambian la referencia al sprite.

Se corrigió además la visibilidad al cerrar un corte restaurado desde el dock:
el `display:flex` inline del dock no mantiene abierta una ventana cuya función
original ya retiró la clase `open`. La corrección CSS está limitada a cortes.
No se modificó el comportamiento compartido del dock.

## Verificación

- Scripts inline y handlers de negocio de `diario.html` idénticos a HEAD.
- Chrome con Supabase simulado y toda petición externa bloqueada; registros
  ficticios, sin escribir en producción.
- 1440, 768, 390 y 320 px, tema claro/oscuro y ventana de 320 × 640 px.
- Captura y guardado, tarjeta principal/secundaria, simple/desglose, propinas
  retiradas, diferencia contra POS, transferencias, movimientos y resguardo.
- Lectura, reapertura, minimizar/restaurar/cerrar y acceso a Gastos desde el
  corte conservando la captura. Las tablas del detalle permanecen visibles.
- Caso de prueba: venta $3,900 y propinas $150. Resguardo $2,100, que pasa a
  $2,000 al pagar $100 de propinas y a $1,800 tras depositar $200 al banco.
- `node tests/money-tests.js`: 4,550 comprobaciones, cero fallas.
- `node versionar.js --revisar` y `git diff --check`: correctos.

[Listado](cortes-caja-visual-2026-10-15/listado.png) ·
[Captura](cortes-caja-visual-2026-10-15/captura.png) ·
[Móvil](cortes-caja-visual-2026-10-15/movil.png).

Esta actualización se integra junto con el rediseño de Gastos diarios.
Se conservan los commits de catálogos que ya estaban en la rama.
