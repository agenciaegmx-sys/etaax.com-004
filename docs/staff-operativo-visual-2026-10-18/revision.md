# Staff operativo · revisión visual del 18 de octubre de 2026

Se unifica la presentación de Horarios Operativos, Checklists, Organigrama,
Perfiles de Puesto y Evaluaciones con Gastos diarios: superficies cálidas,
selección en cian, acciones principales en terracota, tipografía DM Sans,
campos y botones con tamaños consistentes, y adaptación a móvil.

La integración vive en `administrativo/staff-operativo-ui.css` y `.js`.
Los scripts operativos originales de las cinco herramientas y del hub
permanecen idénticos. La capa nueva decora nodos existentes y mide la barra
del organigrama para reservar su espacio; conserva handlers, identificadores,
valores de opciones, datos y permisos.

## Cobertura en Chrome

`node docs/staff-operativo-visual-2026-10-18/revisar-staff-operativo.cjs`

37 casos, con servidor y Supabase simulados, sin peticiones a producción:

- Cinco herramientas a 1440, 768, 390 y 320 px: formularios sin desborde exterior,
  campos y acciones dentro de pantalla; las tablas conservan su scroll propio.
- Horarios: captura y guardado de turno, asistencia y retardo, vista de tarjetas,
  opciones de impresión. Verde, rojo y amarillo conservan su significado.
- Checklists: edición y guardado de plantilla, tareas y frecuencias, ejecución,
  firma, cumplimiento, detalle, opciones de impresión y URL del QR. El generador
  de QR está simulado en esta prueba; no se valida el escaneo de una cámara.
- Organigrama: edición y guardado de puesto, ancho de nodos, conexión y
  desconexión, zoom y centrado. Se conserva la geometría guardada. La barra
  independiente queda debajo del contexto y el lienzo empieza debajo de ella.
- Perfiles: editor, guardado, ficha, importación desde catálogo ETAAX y fondo
  blanco en el documento de impresión. Cabecera del editor accesible al desplazar.
- Evaluaciones: editor de preguntas y secciones, guardado, ventana para compartir,
  resultados y desglose. No se envía correo ni WhatsApp durante las pruebas.
- Cinco herramientas abiertas desde el hub a 1440 y 390 px: sin encabezado
  principal dentro del iframe, con cerrar, minimizar y restaurar. Se comprueba
  también el cambio al marco del catálogo de Staff sin iconos duplicados.
- Las cinco páginas independientes en tema claro.

Se guardan capturas de listados, editores, ventanas, resultados y temas.
La prueba detecta errores de JavaScript y bloquea las solicitudes externas.
Los guardados se verifican en fixtures; no se modifican datos reales.

## Iconos y publicación

58 iconos, prefijo `sto-`, normalizados en el sprite compartido de la app.
116 SVG (oscuro y claro) publicados en `agenciaegmx-sys/iconos-etaax`, commit
`5ca46a7d436d617061bdf30759f68451afd1588b`.

Galería: `etaax-staff-operativo-iconos.html` en ese repositorio, con búsqueda,
selector de tema y descarga individual. Se validan los 116 XML y la igualdad
de las 58 fuentes oscuras con las incorporadas aquí.

`node --check`, `node versionar.js --revisar` y `git diff --check` verifican la
integración. Los candados de fórmulas monetarias y almacenamiento corren en el
hook de pre-push del proyecto.
