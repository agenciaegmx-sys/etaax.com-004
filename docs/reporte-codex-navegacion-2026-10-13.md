# Selector de módulos y herramientas de la sucursal

La página de módulos ahora muestra las cuatro áreas en un selector con efecto dock. Elegir una cambia las tarjetas de herramientas que aparecen debajo, sin navegar ni cambiar de sucursal. Abrir una herramienta lleva a su página existente. El pin y el nombre de la sucursal se unieron junto al logo para eliminar la etiqueta repetida.

## Alcance

`hub-modulos.js` contiene el catálogo de accesos y pinta el selector y sus tarjetas. `hub-modulos.css` mantiene los estilos dentro del hub. El controlador continuo de `hub-interacciones.js` se comparte entre la guía informativa y los cuatro botones funcionales de módulo. No se duplicaron las pantallas de captura o reporte ni se cambiaron cálculos.

| Área | Accesos actuales |
| --- | --- |
| Control administrativo | Ventas y gastos diarios, Gestión de colaboradores, Proveedores, Clientes, Menú |
| Recetas e Insumos | Escandallos, Insumos, Inventarios, Requisiciones |
| Salud financiera | Resumen, Ventas, Gastos, Previsiones, Cuentas bancarias, KPIs, Estadísticas |
| Aprende y analiza | Guías de uso, Ventas por producto, Simulador de metas |

Los 19 destinos son los archivos existentes del repo. Se preserva la portada de Gestión de colaboradores con sus propias herramientas y permisos. Las propuestas que las portadas anteriores marcaban en desarrollo u ocultaban no se convirtieron en accesos activos. Cuentas bancarias sigue disponible en el espacio por sucursal y no se agregó al modal Financiero global.

## Comportamiento

- En la portada del negocio el orden del DOM es Sucursales (con alta de sucursal), Catálogos/Financiero global y Guía de operación al final.
- Los módulos siguen el orden Control administrativo, Recetas e Insumos, Salud financiera y Aprende y analiza, con numeración del 1 al 4. Sin una selección previa, se abre el primer módulo disponible.
- La tarjeta de Escandallos abre `recetas/index.html?escandallos=1`, directamente en la herramienta. El parámetro se conserva al cargar para que una recarga no vuelva a la portada antigua.
- El módulo elegido se guarda en `sessionStorage` como `etaax_hub_modulo`, por pestaña. Al regresar desde una herramienta o recargar, se conserva siempre que siga disponible para el rol.
- La sucursal y `etaax_ctx` conservan el recorrido existente. Cambiar de módulo no modifica estas claves; cambiar de sucursal desde el subheader vuelve a pintar las herramientas con el contexto nuevo.
- El selector usa pestañas y un panel asociado. Flechas, Inicio y Fin cambian entre opciones habilitadas con un solo punto de tabulación. En móvil se desplaza horizontalmente; los accesos de herramientas pasan a una columna. El margen de scroll mantiene los botones separados del borde del marco.
- La opción elegida usa contorno y franja inferior terracota. El hover del dock es continuo y acompaña a los vecinos; las herramientas usan tarjetas con categoría, explicación y acceso con flecha. Movimiento reducido y entrada táctil desactivan el zoom.
- Los ocho SVG de módulos principales y Recetas/Insumos se importaron de `iconos-etaax`, commit `7f9f7fe4`, con el prefijo `mod-`. El sprite se regeneró. URLs: iconos `?v=modulos-1`, interacciones `?v=2`, hoja de módulos `?v=3`, controlador de módulos `?v=3`.

## Iconos de las barras laterales

El diseño posterior de barras, subheader y tarjetas se describe en `reporte-codex-diseno-modulos-2026-10-13.md`.

`etaax-sidebar.js` y `etaax-sidebar.css` se incluyen en las 24 páginas que tienen barra lateral en Administrativo, Recetas, Financiero y Aprende y analiza. Reutilizan los símbolos del sprite que ya aparecen en las tarjetas del hub, incluidos los cuatro módulos principales y sus herramientas. Los enlaces y eventos de cada página se conservan.

La geometría se pinta con `etaaxIcono`, con acento cian en oscuro y azul profundo en claro. Los tamaños son 22 px en los enlaces y 20 px en el atajo al panel. Las etiquetas, tooltips y el botón de expandir siguen funcionando; los SVG son decorativos para lectores de pantalla.

Financiero y Catálogos globales vuelven a aplicar los iconos después de generar sus enlaces. El módulo usa sus iconos correspondientes; el catálogo global usa los de catálogos. Se versionaron los scripts de las páginas afectadas para evitar mezclar la barra antigua con el nuevo pintado.

## Permisos

Los accesos llaman al resolutor real `etaaxPerm` con las claves de entrada que usan sus páginas y la sucursal activa. Un módulo se habilita cuando al menos una de sus herramientas está disponible. Las herramientas no permitidas se muestran atenuadas, sin `href`. Las guías permanecen disponibles para colaboradores, como en la portada anterior de Aprende y analiza.

El hub usa los lectores y suscripción de permisos existentes para colaboradores. Ante `etaax:permisos` se repinta el selector. Si el módulo elegido dejó de estar permitido se elige el primero disponible. El clic de una herramienta vuelve a revisar su permiso, incluso si el enlace estaba en pantalla antes de una revocación. Sin negocio activo no se habilitan módulos ni herramientas.

Estos controles son de navegación del cliente. Los guardas de las páginas y las reglas del servidor permanecen iguales; este bloque no cierra hallazgos de autorización pendientes.

## Verificación

- `node tests/money-tests.js`: **4,393 comprobaciones, 0 fallas**.
- `node tests/probar-cuenta-header.cjs`: **45 casos, 0 fallas**. Ocho casos nuevos: sucursal única/pin/teclado, cuatro grupos con apertura de los **19 destinos** y regreso conservando módulo y sucursal, accesos del colaborador, cambios/revocación de permisos y estado sin negocio. Los 37 casos anteriores siguen pasando.
- Las aperturas usan URLs reales y scripts reales de contexto y navegación, con documentos mínimos de prueba y Supabase simulado. Comprueban enlaces y contexto, no los cálculos ni cargas de datos de las pantallas de destino.
- Revisión visual con fuentes originales locales a 1440, 390 y 320 px, en ambos temas. Cuatro iconos oficiales, nombre de sucursal una sola vez, dos columnas de herramientas en PC y una en móvil, teclado y dock sin desbordamientos. Movimiento reducido sin zoom. Capturas: `/private/tmp/etaax-navegacion/`.
- Después del reordenamiento, los 45 casos de navegador volvieron a pasar. Se verificaron el orden de los bloques, la numeración de los módulos y la distribución a 1440 y 390 px, sin desbordamientos. Capturas: `/private/tmp/etaax-reorden/`; logs: `/private/tmp/etaax-reorden-browser-20261013.log` y `/private/tmp/etaax-reorden-visual-20261013.log`.
- Después de actualizar las barras y el acceso de Escandallos: **46 casos de navegador, 0 fallas**, y **4,393 comprobaciones del candado, 0 fallas**. El nuevo caso carga el documento real de Escandallos desde su tarjeta, comprueba que se oculta la portada antigua y que una recarga conserva la herramienta y la sucursal. Logs: `/private/tmp/etaax-sidebar-browser-20261013.log` y `/private/tmp/etaax-sidebar-money-20261013.log`.
- Revisión de los documentos completos de Diario, Escandallos, Ventas totales y Guías: barras abiertas y cerradas, temas claro y oscuro, enlaces/eventos intactos y sin errores de JavaScript. También se comprobó volver a pintar Catálogos globales conservando los SVG. Capturas: `/private/tmp/etaax-sidebar/`; log: `/private/tmp/etaax-sidebar-visual-20261013.log`. Supabase simulado, con peticiones externas bloqueadas.
- Logs: `/private/tmp/etaax-navegacion-{money,browser}-20261013.log`, `/private/tmp/etaax-navegacion-revision.log` y `/private/tmp/etaax-navegacion-movil-revision.log`. Sintaxis de los dos controladores y `git diff --check`: correctos.

No se ejecutaron migraciones ni se alteraron datos de producción. El checkpoint continúa en `e3e9d6e`; el rediseño permanece local, sin nuevo commit ni push.
