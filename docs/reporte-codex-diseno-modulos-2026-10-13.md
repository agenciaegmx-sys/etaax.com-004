# Barras y tarjetas del espacio de sucursal

El diseño del hub se extendió a las páginas de los cuatro módulos. La barra lateral es un panel redondeado con identidad del módulo, descripciones breves, opción activa en terracota y regreso al selector de herramientas. El subheader conserva una sola identidad de sucursal junto al logo circular y añade Cambiar módulo e Información de sucursal.

## Alcance

- `etaax-modulos-ui.js` y `etaax-modulos-ui.css` se incluyen en las 29 páginas con contexto de negocio de Administrativo, Recetas, Financiero y Aprende y analiza. Los 24 menús laterales existentes comparten el diseño; las portadas y herramientas que no tenían menú conservan su estructura.
- El encabezado compartido `etaax-header.js` sustituye visualmente la barra superior antigua, cuyos identificadores permanecen para las actualizaciones de títulos. La marca usa el cian del hub y el control de tema queda arriba. Los botones flotantes de tema se eliminaron y `theme.js` evita volver a crearlos en estas páginas.
- `ctx-bar.js` y la barra propia de `app.js` invocan el mismo diseño. Escandallos conserva los nodos y acciones originales de atrás/adelante del editor; los demás módulos mantienen el historial del navegador. Presencia sigue teniendo su espacio en las barras que ya la pintaban.
- Las tarjetas de navegación `.cf-card`, `.dx-card` y el menú de Escandallos usan SVG del sprite, fondo sólido, contorno fino, títulos legibles y acciones terracota. Sus enlaces, identificadores, eventos, permisos y estados deshabilitados se conservan. Las tablas y tarjetas de cifras no se convierten en tarjetas de navegación.
- Escandallos distingue Consultar, Crear preparación y los cuatro tipos de preparación. Se preservan las siete acciones existentes. Su primera copia para deshacer espera a que el formulario dinámico termine de montarse en `load`; ya no depende de un temporizador de 300 ms que podía correr antes del montaje.

## Navegación y contexto

Cambiar módulo abre un `dialog` con los cuatro módulos, en el orden Administrativo, Recetas, Financiero y Aprende y analiza. Escape, cerrar o tocar el fondo cancelan y devuelven el foco. Elegir guarda el módulo y abre sus herramientas en el hub; no cambia negocio ni sucursal. Los permisos se consultan mediante `etaaxPerm` y se vuelven a validar al elegir y antes de navegar. Si cambian mientras el selector está abierto, se repinta.

Cuando hay cambios sin guardar en el editor de recetas, el cambio de módulo pasa por `_escGuardNav`, con las mismas opciones de seguir editando, guardar o salir. No se cambia la selección mientras se cancela ese aviso.

En vista global se conserva el contexto de todas las sucursales y el regreso al negocio, sin mostrar una sucursal activa ficticia. Información de sucursal muestra los datos locales de configuración con el mismo alcance que el hub, sin formularios de edición ni escrituras nuevas.

## Distribución

El alto real del encabezado y subheader define dónde empiezan el contenido y la barra lateral. El observador de tamaño actualiza estos espacios cuando cambian el viewport o los renglones del subheader. En móvil la barra comienza contraída y se puede expandir sobre el contenido. Las tarjetas de recetas pasan a una columna. Las tablas conservan desplazamiento horizontal dentro de su contenedor y los controles de periodo y cifras se ajustan al ancho disponible.

Las vistas `embed=1` reciben los estilos de tarjetas sin añadir encabezados o barras de navegación a los iframes. Se conservan las reglas de impresión y movimiento reducido.

El cambio permanece local. No se hicieron migraciones, escrituras a Supabase ni push; no modifica cálculos ni cierra hallazgos de seguridad pendientes.
