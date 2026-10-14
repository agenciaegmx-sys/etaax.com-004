# Paneles globales y fondo sólido

Catálogos globales y Financiero global abren un modal para elegir el submódulo. Las pantallas de trabajo conservan sus rutas, navegación lateral y cálculos. El hub y el inicio de sesión usan fondo sólido en ambos temas.

## Acomodo aprobado

Catálogos tiene seis tarjetas del mismo tamaño:

| Columna 1 | Columna 2 | Columna 3 |
| --- | --- | --- |
| Colaboradores | Recetas / sub-recetas | Proveedores |
| Horarios | Insumos | Clientes |

Recetas/sub-recetas es un único botón hacia `recetas/index.html`. Se quitaron los dos botones interiores por indicación del dueño; dentro del catálogo siguen disponibles el filtro de sub-recetas y las demás vistas.

Financiero tiene cinco tarjetas iguales: Resumen/Estadísticas a la izquierda, Ventas/Gastos a la derecha y KPIs al centro. En móvil muestra dos columnas y KPIs centrado al final. Las tarjetas abren Resumen, Ventas, KPIs, Estadísticas y Gastos en sus archivos existentes. Cuentas bancarias permanece en la navegación por sucursal y no aparece entre los accesos globales.

## Presentación e iconos

- Los SVG canónicos de `agenciaegmx-sys/iconos-etaax`, commit `ffdb3ce5`, se importaron en `iconos/catalogos/oscuro/` y `iconos/financieros/oscuro/`. Se regeneró el sprite con `node iconos/generar.js`. Los prefijos `cat-` y `fin-` evitan colisiones; trazo y acento siguen las variables de tema y marca.
- `hub-globales.css` reúne los estilos de ambos modales. Títulos de tarjetas en Bebas Neue, mayúsculas, 22 px en PC y 18 px en móvil; encabezados de 30/26 px. Toda la tarjeta es un botón.
- Cuatro conectores SVG decorativos unen las tarjetas financieras con KPIs. Se miden los botones reales y se recalculan al abrir y al cambiar el tamaño mediante `ResizeObserver`. Trazo terracota fino y puntos cian, sin capturar clics ni representar un cálculo o dependencia financiera.
- Fondo oscuro `#0F0E0C`; claro `#F4F3F0`. Se retiraron las capas decorativas de cuadrícula y degradado.
- Cierre por botón, clic fuera o Escape. El foco queda dentro del modal; el fondo queda inerte mientras está abierto y se devuelve el foco al acceso de origen. Se respeta movimiento reducido.

## Contexto y regreso

- Al abrir un panel se establece el negocio sin sucursal activa. Los modos de Catálogos y Financiero son excluyentes.
- En Financiero global, el acceso «Panel Financiero» de la navegación lateral y el regreso de la barra de contexto vuelven a `hub.html?negocios=1&panel=financiero`, que reabre el modal después de inicializar y validar la suscripción.
- El panel anterior de `financiero/index.html` se conserva para sucursales. Cuando existe el modo financiero global redirige al nuevo modal, también al regresar desde un enlace anterior.
- Elegir una sucursal limpia ambos modos globales antes de recargar y al renderizar sus módulos. La navegación por sucursal conserva Cuentas bancarias y el regreso a su panel anterior.
- Los archivos compartidos de navegación/contexto se versionaron en las páginas financieras. Netlify sirve JS con `stale-while-revalidate`; la versión evita mezclar HTML nuevo con el nav anterior.

## Verificación

- `node tests/money-tests.js`: **4,393 comprobaciones, 0 fallas**.
- `node tests/probar-cuenta-header.cjs`: **45 casos, 0 fallas**, con Chrome real y Supabase simulado. Incluye tamaños iguales y acomodo de ambos paneles, teclado/foco, tarjeta única de recetas, navegación global de Ventas y regreso al modal, enlace anterior, entrada por sucursal con Cuentas disponible y enlace global abierto por un colaborador. Los casos del selector de sucursal y de módulos se documentan en sus reportes respectivos.
- Los casos de ruta usan los URL reales y los scripts reales de navegación y contexto, con documentos de prueba mínimos. No son una prueba de los cálculos o la carga de datos de los reportes; eso sigue cubierto por el candado existente dentro de su alcance.
- Revisión visual con las fuentes originales servidas localmente, a 1440, 390 y 320 px, en oscuro y claro. Cinco tarjetas financieras iguales, cuatro conectores, etiquetas en mayúsculas, sin desbordamiento horizontal. A 320 × 667 se verificó el desplazamiento del modal para alcanzar KPIs.
- Login revisado en los mismos tres anchos y ambos temas: fondo sólido, sin errores de JavaScript. Capturas en `/private/tmp/etaax-paneles-globales/` y logs de prueba en `/private/tmp/etaax-globales-*-20261013.log`.
- `git diff --check`: correcto.

No se ejecutaron migraciones ni se alteraron datos o permisos de Supabase. El checkpoint local anterior sigue siendo `e3e9d6e`. Este bloque está en el workspace, sin nuevo commit ni push.
