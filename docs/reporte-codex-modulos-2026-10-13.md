# Subheader de módulos y cambio directo de sucursal

La vista de módulos sigue dentro de `hub.html`. Su subheader presenta la sucursal como identidad principal, con el pin integrado junto al nombre al lado del logo: la sucursal aparece una sola vez. Mantiene el negocio como contexto, plan e información de sucursal. El dueño puede cambiar de sucursal desde esta pantalla mediante un modal. La navegación nueva se describe en [reporte-codex-navegacion-2026-10-13.md](reporte-codex-navegacion-2026-10-13.md).

## Implementación

- `hub-modulos.css` delimita el diseño a `.hub-modulos-bar`. El logo es un círculo de 48 px con un solo borde sólido de 1 px, fondo neutral y sin sombra; la imagen usa `object-fit:cover`, como las tarjetas de sucursal, sin borde propio. Se quitaron las reglas inline que cambiaban fondo/recorte. Mantiene la jerarquía sucursal → negocio y un icono canónico cuando no hay imagen. El marco del subheader usa cian y se adapta al tema.
- Se importaron los cuatro SVG oficiales de `iconos/subheader/oscuro/` del repo `agenciaegmx-sys/iconos-etaax`, commit `7f9f7fe4`. El generador les asigna el prefijo `sh-` y normaliza su detalle cian al acento heredado. «Cambiar sucursal» lleva las flechas de cambio antes del texto; ubicación usa el pin `sh-matriz` integrado al nombre principal, sin una segunda etiqueta. Los dos botones de información usan también los SVG de esa familia. Con los nuevos iconos de módulos, el sprite se carga como `?v=modulos-1`; la hoja de módulos, como `?v=3`.
- «Cambiar sucursal» abre las sucursales del negocio activo mediante el lector existente `sbSucPull`. Mientras se actualiza la lista, las opciones quedan deshabilitadas. Se distingue la sucursal actual y las inactivas. Si falla la lectura se informa y se permite usar la lista guardada, como en el resto del hub.
- Cancelar, Escape o tocar fuera conserva las claves de contexto y devuelve el foco al botón. El modal comparte el manejo de foco y fondo inerte de los paneles globales.
- Al elegir una sucursal válida se llama a `seleccionarSucursal`, el recorrido existente que actualiza la clave activa, el contexto por pestaña, los datos de la barra y la presencia. Permanece en módulos. La selección se conserva al recargar.
- El botón se muestra para dueño y admin con negocio activo. El flujo vuelve a comprobar la sesión, el negocio y la sucursal al seleccionar; ignora colaboradores, sucursales inactivas o desconocidas y un diálogo que pertenecía a otro negocio. Esto protege la navegación del cliente; no cambia las reglas de acceso del servidor.
- Para el dueño, «Inicio» lleva al selector de sucursales del negocio (`?negocios=1`). El acceso antiguo «Cambiar negocio» del subheader se sustituyó por el selector directo. La información del negocio conserva su función/modal y sus accesos administrativos existentes; el subheader del dueño prioriza la información de la sucursal.
- En móvil, identidad y acciones se reparten en filas y dos columnas; ubicación y nombres largos pueden envolver. Los controles mantienen al menos 44 px de alto.

## Guía y botones

La guía ahora tiene 84 px de alto, texto oscuro de 15 px junto al icono, esquinas menos redondas y el rótulo «Guía de operación». `hub-interacciones.js` sustituye el zoom por hover de cada bloque por una curva continua según el cursor, con interpolación temporal, vecinos que acompañan y reposo sin un bucle permanente. No agrega navegación ni cambia el cursor a mano.

Los botones de Ajustes y Administrar/ver sucursal crecen al 107% con mouse y conservan su realce de color. La tarjeta exterior queda estable. El zoom se desactiva con movimiento reducido y entrada táctil.

## Verificación

- `node tests/money-tests.js`: **4,393 comprobaciones, 0 fallas**.
- `node tests/probar-cuenta-header.cjs`: **45 casos, 0 fallas**, Chrome y Supabase simulado, con bloqueo de peticiones externas. Los cinco casos del selector siguen pasando; los ocho adicionales de navegación se describen en el reporte correspondiente.
- Revisión visual con fuentes originales locales, a 1440, 390 y 320 px en oscuro y claro. Se midieron alto/texto de la guía, interpolación del dock, crecimiento de ambos botones y estabilidad del card exterior. Se comprobaron logo circular, plan, selector e identidad sin desbordamiento, y movimiento reducido sin zoom.
- La corrección de iconos se revisó en PC y móvil, con y sin imagen de logo, en ambos temas. Se comprobaron los cuatro símbolos reales `sh-*`, borde circular sólido de 1 px, ausencia de sombra, pin cian y ningún desbordamiento. Capturas en `/private/tmp/etaax-subheader/`, log `/private/tmp/etaax-subheader-revision.log`. El candado y los 37 casos de navegador se repitieron tras integrar estos SVG y pasaron sin fallas.
- Capturas: `/private/tmp/etaax-modulos/`. Logs: `/private/tmp/etaax-modulos-{money,browser}-20261013.log` y `/private/tmp/etaax-modulos-revision.log`.
- Sintaxis de `hub-interacciones.js` y `git diff --check`: correctos.

No se ejecutaron migraciones ni se alteraron cálculos, permisos o datos de producción. Se conserva el checkpoint `e3e9d6e`; estos cambios continúan locales, sin nuevo commit ni push.
