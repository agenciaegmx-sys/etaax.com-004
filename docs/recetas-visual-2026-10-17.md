# Recetas y escandallos · Continuidad visual · 17 de octubre de 2026

Se actualizan el catálogo en galería y lista, la ficha técnica, el costeo flotante, la carátula de costos, el selector de preparación y los editores de recetas y subrecetas de alimentos y bebidas. Comparten el estilo de Gastos, Cortes y Staff: DM Sans, superficies cálidas, acciones terracota, selección cian y avisos/indicadores con sus colores semánticos.

La presentación vive en `recetas/recetas-ui.css` y `recetas-ui.js`. Se conservan las funciones, handlers, IDs, valores, campos, reglas por sucursal y fórmulas existentes. Se comparó `recetas/index.html` con HEAD normalizando las huellas y retirando solo las dos inclusiones nuevas: todo el marcado y los scripts originales coinciden. `app.js` y `etaax-core.js` no tienen cambios.

49 SVG de Recetas organizados en `iconos/recetas/oscuro`, prefijo `rec-` en el sprite compartido. Ambos temas y la [galería de iconos](https://github.com/agenciaegmx-sys/iconos-etaax/blob/main/etaax-recetas-iconos.html) se publicaron en `iconos-etaax`, commit `47e2210`. Las acciones comunes conservan la geometría del resto del producto. Las referencias al sprite se actualizan con `node versionar.js`.

Las tablas se desplazan dentro de su contenedor. Se adaptan las rejillas del formulario, rendimiento y porciones. El campo Precio carta con IVA puede pasar a otra línea para evitar desbordes en móvil. El estado vacío del catálogo ocupa las columnas disponibles, en lugar de conservar cuatro columnas implícitas en una pantalla estrecha. Los nombres y el contenido de los formularios permanecen en sus nodos originales; los iconos decorativos no sustituyen controles.

## Verificación

Navegador Chrome real con servidor local y Supabase simulado. Solo datos ficticios; sin solicitudes a producción. Prueba reproducible:

```sh
node docs/recetas-visual-2026-10-17/revisar-recetas-ui.cjs
RECETAS_EXTRAS_ONLY=1 RECETAS_WIDTHS=1440,320 node docs/recetas-visual-2026-10-17/revisar-recetas-ui.cjs
```

`CHROME_BIN` permite seleccionar Chromium. `RECETAS_WIDTHS` limita los tamaños. El perfil y todas las capturas se crean en el directorio temporal del equipo.

- Recorridos principales a 1440, 768, 390 y 320 px. En cada tamaño se comprueban los cuatro tipos de preparación: ficha → costeo → editor flotante → cambio de cantidades → guardar, sin duplicar la identidad.
- Costos base de $40.00, $5.00 y $20.00; cambios de cantidad reflejados en $48.00, $10.00 y $40.00. Costos por porción de $4.00 en alimentos y $2.50 en bebidas. Los valores permanecen ligados a los insumos de la sucursal.
- Filtros, galería/lista y selección acumulada al cambiar de búsqueda. El catálogo y el buscador de ingredientes excluyen los registros exclusivos de Norte en la sucursal Centro.
- Selector de nueva receta con cuatro tipos, editor nuevo, menú de fuentes de insumos y minimizar/restaurar.
- Carátula con sus cuatro grupos y tablas; botones de ficha técnica y conteos conservados.
- Recorridos adicionales de estado vacío, tema claro, ficha/costeo y editor desde carátula. Cancelar regresa al grupo de origen. Guardar permanece visible en el pie del editor desde carátula.
- Pantalla corta de 320 × 640: subreceta nueva, formulario dentro del iframe y acción Guardar visible.
- Se comprueba que el CSS respeta los controles ocultados por la función original de permisos. Esta comprobación simula permisos en el navegador; no sustituye una prueba de autorización del servidor.
- Sin desbordes exteriores en las vistas comprobadas, sin errores JavaScript en los editores y sin solicitudes externas del entorno de prueba.
- Las plantillas de impresión conservan su código y CSS de papel. Se verifica que la operativa omite los importes del costeo y la administrativa los incluye.
- Candados obligatorios antes del push: 4570 comprobaciones de cálculos y 84 de almacenamiento; sintaxis, referencias de caché y SVG verificados.

Estas comprobaciones usan respuestas simuladas. No modifican recetas ni insumos reales y no constituyen una prueba contra Supabase de producción.

## Capturas

[Catálogo](recetas-visual-2026-10-17/catalogo-1440.png) · [Ficha técnica](recetas-visual-2026-10-17/ficha-alimentos-1440.png) · [Costeo](recetas-visual-2026-10-17/costeo-alimentos-390.png) · [Editor móvil](recetas-visual-2026-10-17/editor-alimentos-390.png) · [Rendimiento](recetas-visual-2026-10-17/rendimiento-sub-bebidas-320.png) · [Grupos de carátula](recetas-visual-2026-10-17/caratula-selector-1440.png) · [Carátula](recetas-visual-2026-10-17/caratula-sub-bebidas-390.png) · [Editor desde carátula](recetas-visual-2026-10-17/editor-desde-caratula-320.png) · [Costeo claro](recetas-visual-2026-10-17/costeo-claro-320.png).
