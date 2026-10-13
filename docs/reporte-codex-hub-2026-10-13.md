# Hub: negocio, cuenta y guía de operación

El dueño pidió reunir las dos barras del hub y usar el espacio liberado para explicar cómo operar el negocio. Referencia: `etaax-hub.html` del repositorio `agenciaegmx-sys/iconos-etaax`, además de las capturas compartidas. Este ajuste continúa el trabajo local descrito en `reporte-codex-header-cuenta-2026-10-13.md`, sobre `5b80f5a`.

## Qué cambió

- El header conserva la **cuenta de acceso**: nombre del titular o corporativo y sesión activa.
- Un solo subheader identifica al **negocio**: logo o icono de organización, nombre completo, organización elegida y número de sucursales. Conserva el plan, el aviso de privacidad y Configurar negocio.
- Organización y plan son datos separados. Un negocio organizado como Corporativo puede estar en Pequeña Pyme por su número de sucursales. No se inventa una organización si el dueño aún no la eligió.
- El encabezado central explica el propósito: «Administra tus sucursales». La guía «Una operación conectada» ocupa el espacio que dejó la segunda barra. Los accesos a Catálogos globales y Financiero global mantienen sus destinos.
- Las tarjetas globales se apilan en móvil. Las acciones del subheader y el rótulo de sucursales caben desde 320 px. El nombre del negocio puede ocupar varias líneas.
- Mi cuenta explica que el nombre identifica al titular o corporativo; el nombre del negocio se cambia en Configurar negocio.

El subheader se vuelve a pintar cuando se actualizan las sucursales, incluido el pull inicial y realtime: el conteo y la categoría del plan no quedan con una copia vieja. Se conserva el cálculo de precios y de categoría existente. Configurar negocio mantiene `soloAdmin` y su comprobación de contraseña. Su botón nuevo usa un listener con el identificador como dato, sin introducirlo en un `onclick`.

## Evidencia

- `node tests/money-tests.js`: **4,394 comprobaciones, 0 fallas**. Se quitó únicamente la comprobación del icono de sesión que dejó de existir en el subheader. Una fixture adicional carga `datos-pago.js`, dependencia real del hub; sin ella el script quedaba inicializado a medias.
- `node tests/probar-cuenta-header.cjs`: **23 casos, 0 fallas**, Chrome real con Supabase simulado y peticiones externas bloqueadas. Incluye las pantallas de cuenta previas, hub a 1440/390/320 px, identidad de cuenta y negocio separadas, privacidad, guía, actualización del conteo/plan y rechazo de contraseña incorrecta antes de abrir configuración.
- Revisión visual de las capturas locales `etaax-hub-pc.png` y `etaax-hub-movil.png`. El arnés espera a que terminen las animaciones antes de capturar.
- El SVG `iconos/organizacion/oscuro/etaax-1-corporativo.svg` se leyó desde GitHub y coincide con la fuente local. Se reutiliza `etaaxIcono`; no se modificó el juego de iconos.
- `git diff --check`: correcto.

No se ejecutaron migraciones ni se modificaron datos de producción. Estas pruebas comprueban comportamiento del frontend con el proveedor simulado.

## Función futura acordada, sin implementar

La cuenta principal podrá dar de alta **hasta cinco administradores adicionales** del negocio completo. Cada uno tendrá nombre, correo, teléfono y credenciales individuales, con acceso a todas sus sucursales. Solo el titular principal podrá crear o dar de baja esos accesos.

Ese trabajo requiere autorización en el servidor y pruebas de rechazo después de una baja, incluidas sesiones ya abiertas. Capturar un teléfono por sí solo no equivale a verificarlo. Son administradores del negocio; no deben reutilizar la identidad compartida del staff. No se agregaron formularios, botones ni permisos provisionales para esta función en el ajuste visual.

## Estado de entrega

Cambios locales listos para revisión. El dueño pidió guardar este estado en un commit local antes de evaluar la nueva paleta, sin hacer push. Se confirmó lectura de ambos repositorios de GitHub y permiso de escritura en `agenciaegmx-sys/etaax.com-004`.
