# Hub: acceso debajo del módulo seleccionado

Fecha: 14-oct-2026. Petición: mostrar Ir al módulo debajo de la tarjeta elegida,
con una aparición animada y destino dinámico.

## Resultado

El acceso está dentro del selector, en la misma columna que la tarjeta activa.
Al elegir otro módulo cambia su posición, nombre accesible y portada, y aparece
con un desplazamiento breve y fundido de 240 ms. Usa terracota, texto e icono
contrastantes según el tema. El espacio de la fila se mantiene para evitar
que la guía salte verticalmente cada vez que se cambia de módulo.

La acción está fuera del tablist: las cuatro tarjetas siguen permitiendo
selección con flechas/Home/End, y Tab llega al enlace para entrar. En móvil el
selector desplaza la tarjeta seleccionada hasta mantenerla y su acción dentro
de la vista. La preferencia de movimiento reducido elimina la animación.

El botón abre la misma portada que antes, conservando negocio y sucursal.
Se comprueba de nuevo la disponibilidad al pulsarlo. Un permiso revocado frena
el clic; sin negocio no aparece el acceso. Las filas con guías se conservan.

## Archivos

- `hub.html`: selector y fila de acción; se retiró el botón de la cabecera
  inferior para que la entrada quede asociada a la tarjeta elegida.
- `hub-modulos.js`: posición/destino, animación, desplazamiento móvil y guarda
  del clic. Se conserva el enlace `hubIrAlModulo` y las rutas anteriores.
- `hub-modulos.css`: alineación, animación, foco y contraste del SVG.
- `tests/probar-cuenta-header.cjs`: siete casos adicionales del nuevo acceso,
  más guardas de permiso revocado y estado sin negocio.

Las dos referencias de JS/CSS del hub tienen la huella nueva de su contenido.
Se actualizaron esas referencias sin modificar el trabajo simultáneo de QR.
La entrega A de puertas QR de Claude quedó en `012733b` durante esta tarea.
El usuario aprobó la vista y autorizó el commit y push del hub el 14-oct-2026.

## Validación

- **65 casos de navegador, 0 fallas**, con Supabase simulado y solicitudes
  externas bloqueadas. Incluye abrir las cuatro portadas reales desde el nuevo
  enlace y conservar sucursal y selección al volver al hub.
- Alineación y visibilidad a 1440, 768, 390 y 320 px; temas claro/oscuro,
  selección rápida, Tab/flechas, permiso revocado y movimiento reducido.
- Se corrigió una interacción con scroll-snap: desplazar solo lo necesario
  hacía que el navegador volviera al punto anterior y cortara el botón. Ahora
  se alinea el comienzo de la tarjeta seleccionada.
- **4,497 comprobaciones del candado, 0 fallas**, sobre el árbol actual.
- Sintaxis de JS/prueba, revisión de huellas y diff sin errores.
- Revisión visual final a 1440/390/320 px en ambos temas, incluyendo el
  contraste de la flecha con la tinta del botón.

[Vista de escritorio](hub-acceso-modulo-2026-10-14/1440-dark.png),
[móvil claro](hub-acceso-modulo-2026-10-14/320-light.png) y
[evidencia](hub-acceso-modulo-2026-10-14/).

Para repetir: `node tests/probar-cuenta-header.cjs`,
`node tests/money-tests.js` y `node versionar.js --revisar`.
Los datos de las capturas son ficticios. La navegación comprobada no implica
una revisión nueva de todos los cálculos de las portadas existentes.
