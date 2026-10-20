# Insumos y superposición en escandallos · 20 de octubre de 2026

El catálogo de insumos continúa la paleta cálida con acentos cian y terracota de Recetas y Staff. Se actualizan lista, galería, controles de costeo y selección, filtros, selector de tipo, ficha técnica y editor. Los catálogos de origen de ETAAX y del negocio conservan el mismo tratamiento cuando se abren desde el escandallo.

El editor conserva el nombre bajo el título, la foto, el estado, la conversión de tipo y el sello de auditoría. Se ordenan tipografías, espacios, campos y secciones de presentaciones, impuestos, costeo automático y stock; el cuerpo desplaza dentro de la ventana y el pie mantiene Guardar y Cancelar visibles. La ficha conserva los importes, presentaciones, notas e historial.

## Superposición corregida

El contenedor del botón Insumo tenía `z-index:400`, que competía con el encabezado sticky. `#editorWrap` ahora forma su propio contexto de dibujo, de modo que las acciones se elevan sobre las tarjetas dentro del contenido.

La lista de fuentes se traslada a `body` al abrirse; su posición ahora considera el borde inferior del header o el área de contenido de la ventana. Abre dentro del espacio disponible y se cierra al desplazar o redimensionar la página. El desplazamiento dentro de la propia lista permanece permitido. Se comprueba con `elementFromPoint` que el encabezado cubre al botón cuando ambos ocupan las mismas coordenadas y que la lista sigue siendo accesible al abrirse sobre las tarjetas.

## Iconos y alcance

50 SVG en `iconos/insumos/oscuro`, prefijo `ins-`, integrados en el sprite con `node iconos/generar.js`. Publicados en ambos temas en [iconos-etaax](https://github.com/agenciaegmx-sys/iconos-etaax/blob/main/etaax-insumos-iconos.html), commit `0a97a13`.

La capa visual conserva nodos, eventos, identificadores, valores y controles ocultos por permisos. Los cambios en `insumos.js` agregan clases a las plantillas; no cambian cálculos ni persistencia. Las plantillas de impresión conservan su código. Los nuevos estilos también se activan en rutas sin `.html` y viajan con huella de contenido.

## Verificación

- Chrome: 44 casos a 1440, 768, 390 y 320 px, con los diez tipos de insumo, lista/galería/costeo, filtros y selección por sucursal, ficha, nombre vivo, conversión, minimizar/restaurar, tema claro, guardado y superposición del escandallo. Ejecutar `node docs/insumos-visual-2026-10-20/revisar-insumos-ui.cjs`; `INS_WIDTHS` permite acotar tamaños.
- Regresión de ventanas: 12 casos con los tres orígenes de insumos dentro del escandallo y los catálogos globales. `node tests/probar-ventanas-insumos.cjs`.
- Cálculos: 4649 comprobaciones sin fallas. El caso de cerezas conserva $300 por empaque, $333.33 por KG sobre 900 G de masa drenada, $2 por cereza y 6 G por unidad para 150 cerezas.
- Almacenamiento: 84 comprobaciones, sin fallas.
- 150 SVG válidos entre las fuentes de la aplicación y las dos variantes del repositorio de iconos; sintaxis, referencias de caché y `git diff --check`.

Los datos del navegador son ficticios. Supabase está simulado y se bloquean solicitudes externas; no se modificaron insumos, recetas, impuestos ni existencias de producción.
