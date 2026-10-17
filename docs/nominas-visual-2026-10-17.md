# Nóminas y autorización — 17 de octubre de 2026

Se actualizó la presentación del listado de pagos, el selector de colaborador
y el cálculo del pago con el mismo estilo de Gastos diarios y Cortes de caja:
superficies cálidas, acciones terracota, selección y detalles cian, tipografía
DM Sans y botones más amplios. Se mantienen verde para totales/confirmación,
rojo para descuentos/errores/eliminación y amarillo para primas/avisos.

El formulario conserva sus secciones y campos. La cabecera y el pie permanecen
visibles; el cuerpo desplaza y las columnas se acomodan en móvil. Los selectores
y calendarios siguen siendo nativos. El listado conserva desplazamiento
horizontal dentro de su tabla en pantallas pequeñas.

El modal compartido de contraseña tiene la misma paleta, iconos de candado y
ojo, estados de foco y botones. El aviso “Autorizado por” también se actualizó.
Las pantallas que incluyen `admin-guard.js` cargan esta capa visual; el botón
Eliminar mantiene rojo. El estilo del selector de colaborador se aplica solo
al pago de nómina.

## Integración

- `administrativo/nominas-ui.css` y `administrativo/nominas-ui.js`: estilos y
  SVG decorativos sobre los nodos existentes, sin sustituir controles.
- `admin-guard-ui.css` y `admin-guard-ui.js`: presentación de autorización;
  `admin-guard.js` y `security.js` permanecen idénticos.
- `iconos/nominas/oscuro/`: 27 SVG; `iconos/autorizacion/oscuro/`: 5 SVG.
  Prefijos `nom-` y `aut-`, sprite regenerado con `node iconos/generar.js`.
- Fuentes publicadas en [iconos-etaax, commit e870966](https://github.com/agenciaegmx-sys/iconos-etaax/commit/e870966e3d027a9fb5485ded4de11a85327937c1),
  con variantes claras/oscuras y [galería de descarga](https://github.com/agenciaegmx-sys/iconos-etaax/blob/main/etaax-nominas-iconos.html).
- Referencias versionadas con `node versionar.js`. Las demás pantallas solo
  actualizan la huella del sprite o incluyen la presentación de contraseña.

## Verificación

- Los scripts inline y handlers originales de las páginas modificadas se
  compararon con HEAD; no se cambiaron las funciones de negocio.
- `node tests/money-tests.js`: 4,570 comprobaciones, cero fallas.
- Chrome: 1440, 768, 390 y 320 px, temas claro/oscuro y pantalla 320 × 640.
- Listado vacío/con pagos, estados y métodos; contraseña vacía, incorrecta y
  válida, mostrar/ocultar, selección limitada a la sucursal, prima, bono,
  descuento, minimizar/restaurar y continuidad al formulario de gasto.
- Ejemplo: 7 días × $315.04 = $2,205.28; con prima $78.76, bono $100 y
  descuento $20, el formulario de gasto recibe $2,364.04.
- 64 SVG (dos temas) validados como XML; fuentes locales idénticas al repo.
- Sintaxis JS, `git diff --check` y `node versionar.js --revisar` correctos.

El navegador usa Supabase simulado y bloquea peticiones externas; no se
registraron pagos reales ni se modificaron datos de producción.

Para reproducir la revisión visual:
`node docs/nominas-visual-2026-10-17/revisar-nominas-ui.cjs`
(`CHROME_BIN` permite indicar otra instalación de Chromium).

[Listado](nominas-visual-2026-10-17/listado.png) ·
[Pago](nominas-visual-2026-10-17/pago.png) ·
[Contraseña](nominas-visual-2026-10-17/autorizacion.png) ·
[Móvil](nominas-visual-2026-10-17/movil.png).
