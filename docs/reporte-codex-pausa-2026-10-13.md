# Reporte de cambios al pausar Codex

Fecha: 13 de octubre de 2026. Repositorio: `/Users/macbookpro/Proyectos/etaax.com-004-2`.

**Estado: pausado por solicitud del usuario.** El rediseño está aplicado localmente, con un pendiente visual en Gestión de colaboradores a 320 px. No se debe describir la revisión de todas las páginas como terminada.

## Respaldo y estado de Git

- Rama: `main`.
- Commit de respaldo anterior al rediseño: **`e3e9d6e`**, «Completar cuenta y plan y unificar el subheader del hub».
- `main` tiene un commit local por delante de `origin/main`; no hay commits remotos pendientes de integrar según la comparación disponible al pausar.
- Los cambios de diseño posteriores permanecen **sin commit y sin push**, incluidos los archivos nuevos sin seguimiento. No se hicieron migraciones ni escrituras a Supabase desde las herramientas de esta tarea.
- El estado de Git incluye trabajo previo y cambios recientes en `novedades.js`, `novedades/` y las pruebas del aviso. Esos cambios del aviso no los implementé como parte de este rediseño y deben conservarse. El total del candado pasó de 4,393 a 4,414 comprobaciones durante el trabajo; el último resultado válido es 4,414.

## Inicio de sesión y hub del negocio

Se aplicó la paleta elegida: cian **`#8CE4EE`** para marca, detalles e iconos; terracota **`#FB9B6F`** para énfasis y acciones; crema **`#F0ECE4`** para texto; fondo oscuro sólido **`#0F0E0C`**. El tema claro utiliza variantes más profundas para mantener legibilidad.

Se quitaron cuadrículas y degradados del login y el hub. Los contornos son de 1 px, atenuados; el subheader conserva cian completo. Catálogos globales lleva contorno cian; Financiero global y el exterior de las sucursales llevan terracota. Los nombres de sucursal quedaron en crema, los ajustes en azul y Añadir sucursal en verde vivo.

El orden actual del hub es:

1. Sucursales, con sus acciones y alta de sucursal.
2. Catálogos globales y Financiero global.
3. Guía de operación al final.

El título «ADMINISTRA TUS SUCURSALES» está en mayúsculas y en una sola línea. Las dos tarjetas globales tienen títulos mayores, franja del color de su contorno y flecha para abrir.

La guía contiene cinco rectángulos informativos de 84 px de alto, texto de 15 px y fondos alternados cian/terracota. No son botones funcionales. El efecto dock sigue el cursor de manera continua y se desactiva para movimiento reducido y entrada táctil. En las sucursales, el hover aumenta únicamente los botones; Ajustes es un icono y el otro acceso dice «Administrar / ver sucursal».

## Catálogos y Financiero global

Ambos accesos abren un modal antes de entrar a sus herramientas. Se conservan las pantallas y navegación de los submódulos.

Catálogos tiene seis tarjetas, en dos filas:

| Columna 1 | Columna 2 | Columna 3 |
| --- | --- | --- |
| Colaboradores | Recetas / sub-recetas | Proveedores |
| Horarios | Insumos | Clientes |

Recetas / sub-recetas es un solo acceso: se eliminaron los dos botones que llevaban al mismo lugar.

Financiero global tiene cinco tarjetas del mismo tamaño: Resumen de resultados y Estadísticas a la izquierda, Ventas y Gastos a la derecha y KPIs al centro. Se añadieron conectores decorativos entre las tarjetas. **Cuentas bancarias permanece únicamente en el espacio de sucursal.**

Los modos globales usan las claves existentes `etaax_cat_global` y `etaax_fin_global`; entrar a una sucursal limpia ambos modos. El contexto global mantiene el alcance de todas las sucursales y su regreso al negocio.

## Hub de módulos

Se unieron el pin y el nombre de la sucursal junto al logo circular, eliminando la etiqueta repetida. Se añadieron los SVG correspondientes del subheader y un selector real de sucursales para el acceso autorizado.

El orden del selector de módulos es:

1. Control administrativo.
2. Recetas e Insumos.
3. Salud financiera.
4. Aprende y analiza.

Los cuatro módulos tienen efecto dock. Elegir uno muestra sus herramientas debajo; abrir una herramienta conserva su página existente. La selección se guarda por pestaña como `sessionStorage.etaax_hub_modulo`. Sin selección previa se abre el primer módulo disponible según permisos.

Hay 19 destinos actuales. Los accesos del colaborador consultan `etaaxPerm`; los bloqueados no tienen enlace. Cambios de permisos actualizan el selector y se verifica de nuevo el permiso al abrir una herramienta.

El acceso de **Escandallos** se corrigió a `recetas/index.html?escandallos=1`. Ahora entra directamente a la herramienta y conserva esa vista al recargar.

## Rediseño de las páginas de módulo

El diseño compartido se incluyó en **29 páginas con contexto** de los cuatro módulos. Los **24 menús laterales existentes** usan un panel redondeado, identidad del módulo, descripciones breves, selección terracota y regreso a módulos. Las páginas que no tenían barra lateral conservan su estructura.

El subheader toma el diseño del hub: logo circular, pin y sucursal una sola vez, giro, badge y acciones. «Cambiar módulo» abre un selector con los cuatro módulos; elegir lleva a sus herramientas en el hub sin cambiar de sucursal. Información de sucursal muestra sus datos de configuración. En modo global se conserva la identidad del negocio y el alcance global.

El encabezado superior compartido conserva cuenta y tema. Los botones flotantes de modo claro/oscuro se eliminaron, y `theme.js` evita recrearlos en estas páginas.

Las tarjetas de navegación de las portadas, Diario y Escandallos comparten fondo sólido, contorno fino, SVG, texto alineado a la izquierda y acciones terracota. Se conservan identificadores, enlaces, eventos, permisos y estados deshabilitados. Las tarjetas de cifras y los cálculos no se sustituyeron por tarjetas de navegación.

Escandallos conserva sus siete acciones y distingue Consultar, Crear preparación y los cuatro tipos de preparación. Sus controles propios de atrás/adelante del editor se conservaron. Cambiar de módulo pasa por el aviso existente de cambios sin guardar; cancelar no modifica la selección ni el contexto. Se corrigió la primera copia del historial para esperar al montaje del formulario en `load`, evitando leer campos que todavía no existían.

El espacio de contenido se calcula con las alturas reales de encabezado y subheader. En móvil la barra comienza contraída y puede expandirse. Se ajustaron los controles de Ventas totales y los contenedores de tablas para evitar desbordamientos. Los iframes `embed=1` reciben estilos de tarjetas sin agregarles barras o encabezados.

## Archivos principales

| Área | Archivos |
| --- | --- |
| Login, negocio y sucursales | `hub.html`, `hub-paleta.css`, `hub-interacciones.js` |
| Modales globales | `hub-globales.css`, lógica global en `hub.html`, `global-nav.js`, `financiero/nav.js` |
| Selector de módulos del hub | `hub-modulos.js`, `hub-modulos.css` |
| Iconos laterales | `etaax-sidebar.js`, `etaax-sidebar.css` |
| Diseño de páginas de módulo | `etaax-modulos-ui.js`, `etaax-modulos-ui.css` y enlaces de recursos en 29 HTML |
| Subheaders y tema | `ctx-bar.js`, `app.js`, `etaax-header.js`, `nav-pref.js`, `theme.js` |
| Escandallos | `recetas/index.html` |
| SVG y marca | `iconos/`, `iconos/generar.js`, `etaax-iconos.js`, `marca/hub/` |
| Verificación | `tests/probar-cuenta-header.cjs`, `tests/money-tests.js` |

Los iconos canónicos se importaron de `agenciaegmx-sys/iconos-etaax`, familias Catálogos, Financieros, Subheader y Módulos. Se utiliza `etaaxIcono`; el sprite se genera desde los SVG, no se edita a mano.

## Pruebas y evidencia

- **48 casos de navegador, 0 fallas**, incluyendo apertura y recarga real de Escandallos, cambio de módulo, cancelación de cambios sin guardar y permisos de colaborador.
- **4,414 comprobaciones del candado, 0 fallas**, en el último estado comprobado.
- Revisión de Diario, Escandallos, Ventas y Guías a 1440, 390 y 320 px, sin desbordamientos ni errores de JavaScript. Ambos temas se revisaron en computadora. Se comprobó el selector, la información de sucursal, contraer/expandir y el modo embebido.
- Las tres portadas de módulos revisadas y Gestión de colaboradores pasan en computadora. Las portadas Administrativo, Financiero y Aprende y analiza también pasan a 320 px.
- **Gestión de colaboradores a 320 px sigue pendiente:** la página expande su ancho a **349 px**. Tiene siete tarjetas con SVG y no registra errores de JavaScript, pero falla la comprobación de ancho.

Las pruebas usan Supabase simulado y bloquean peticiones externas. La verificación de los 19 enlaces utiliza documentos mínimos de destino; no demuestra por sí sola la carga de datos de producción de todas esas pantallas.

La evidencia se conservó dentro del repo en [continuidad-codex-2026-10-13](continuidad-codex-2026-10-13/): logs, capturas, fuentes de revisión y dos revisores manuales. No depende solamente de archivos temporales.

## Pendientes al pausar

1. Corregir el ancho de `administrativo/staff-hub.html` a 320 px sin quitar controles ni ocultar contenido.
2. Ejecutar de nuevo el revisor de portadas para confirmar ese caso. El último revisor termina con error por este pendiente; el diagnóstico temporal posterior se dirigió a Administrativo, no a Staff, y no resolvió el caso.
3. Revisar las herramientas con layouts particulares que no se recorrieron visualmente una por una, especialmente canvas, barras fijas, encabezados de tablas e impresión. Hay 29 páginas integradas, no 29 revisiones visuales completas.
4. Presentar al usuario la apariencia final y los límites de verificación. Mantener los cambios locales y preservar el resto del trabajo del repositorio.

Para continuar: [Guía de continuidad para Claude](guia-claude-continuidad-2026-10-13.md).
