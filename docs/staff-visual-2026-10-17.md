# Staff · Continuidad visual · 17 de octubre de 2026

Se unifica el catálogo de Staff con Gastos diarios y Cortes: DM Sans, superficies oscuras cálidas, acciones terracota, selección cian y colores semánticos para estados, bajas y acciones destructivas. Se conservan la estructura de formularios, las funciones y los datos originales.

Incluye catálogo y filtros, menú de acciones, alta y editor de colaborador, ficha con expediente digital, visor de documentos, archivo de bajas, parámetros salariales, Roles y permisos y editor de roles. Se adapta la ventana flotante del hub y su navegación de ida y vuelta.

La presentación vive en `administrativo/staff-ui.css` y `staff-ui.js`, cargados en `staff.html`, `permisos.html` y `staff-hub.html`. Se compararon estas páginas con HEAD quitando únicamente las dos inclusiones nuevas y normalizando las huellas de caché: el resto del marcado, todos los scripts inline y sus handlers son idénticos.

53 SVG ordenados en `iconos/staff/oscuro`, con prefijo `stf-` en el sprite compartido. Se publicaron los dos temas y su galería en [iconos-etaax](https://github.com/agenciaegmx-sys/iconos-etaax/blob/main/etaax-staff-iconos.html), commit `4c35f0d`. Las acciones comunes conservan la geometría del resto de Administrativo. El selector de iconos de roles representa sus valores originales con SVG; conserva el emoji guardado y la llave del rol.

Se corrigieron dos conflictos de presentación del iframe: el estilo del dock imponía `display:inline-flex!important` a Cerrar aunque el hub lo ocultara al entrar en Permisos; y el ancho intrínseco de la tabla ensanchaba el catálogo embebido en móvil. La tabla ahora se desplaza en su propio contenedor y la visibilidad de las salidas respeta al hub.

## Verificación

Navegador Chrome real y servidor local con Supabase simulado; tráfico externo bloqueado y datos ficticios. Prueba reproducible: `node docs/staff-visual-2026-10-17/revisar-staff-ui.cjs`. `CHROME_BIN` permite elegir Chromium. Las capturas completas y el perfil temporal se generan fuera del repositorio.

- Página independiente: 1440, 768, 390 y 320 px; temas oscuro y claro.
- Ventana flotante real: 1280, 768, 390 y 320 px; catálogo → permisos → volver → editor → cerrar.
- Clave incorrecta mantiene el catálogo bloqueado; clave correcta permite entrar. Sueldos y datos bancarios de la ficha permanecen ocultos hasta autorizar. Usuario, contraseña y salario siguen protegidos en el editor.
- Búsqueda y filtro por sucursal, edición y guardado sin duplicar al colaborador, conservación de hashes y sucursal, alta con salario estándar, NIP por rol, reactivación de bajas y guardado de parámetros.
- Permisos en lectura y edición, borrador sin publicar, guardado, Administrador sin interruptores editables y permisos propios de Norte sin cambiar Centro ni los generales.
- Creación de rol, selector con 16 iconos, elección y renombrado conservando la llave y el icono original. Minimizar/restaurar y cierre mantienen sus handlers y el rearmado de la clave del catálogo.
- Sin desbordes exteriores de formularios ni del iframe; los pies de los editores siguen visibles. Sin errores JavaScript en los recorridos verificados.
- Candados obligatorios: 4570 comprobaciones de dinero y 84 de almacenamiento. Huellas de caché y sintaxis verificadas.

Estas pruebas comprueban la presentación y los recorridos del navegador con respuestas simuladas; no constituyen una prueba contra Supabase de producción ni modifican datos reales.

## Capturas de referencia

[Catálogo](staff-visual-2026-10-17/catalogo-1440.png) · [Editor](staff-visual-2026-10-17/editor-personales-1440.png) · [Ficha](staff-visual-2026-10-17/expediente-390.png) · [Bajas](staff-visual-2026-10-17/bajas-390.png) · [Parámetros](staff-visual-2026-10-17/parametros-390.png) · [Editor de rol](staff-visual-2026-10-17/editor-rol-390.png) · [Ventana flotante](staff-visual-2026-10-17/flotante-catalogo-390.png).
