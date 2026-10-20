# Seis correcciones de Staff · 20 de octubre de 2026

1. Cancelar la contraseña de Roles y Permisos vuelve al catálogo dentro de la misma ventana. El botón Volver y la cancelación comparten el retorno; se conservan `embed`, negocio y sucursal. Las rutas cortas de Netlify se reconocen también al sincronizar el título y los controles del contenedor.
2. Los parámetros salariales se leen y guardan por sucursal. El documento anterior se conserva como valor inicial para sucursales aún sin configuración propia. Los perfiles vinculados toman el mínimo de su sucursal, incluidos los registros antiguos; los sueldos personalizados conservan su importe. El editor usa la sucursal del colaborador aunque sea distinta de la que está activa al abrirlo.
3. Ambos editores de colaborador guardan `multaRetardo`, un importe por ocurrencia. Horarios muestra el estimado semanal y nómina cuenta los retardos del periodo seleccionado. Cantidad e importe pueden editarse para ese pago. Se genera un solo concepto negativo con su multiplicación, visible como deducción en el recibo y en las notas del gasto. Un importe de cero conserva las marcas de asistencia y elimina el descuento. Recalcular bonos no lo elimina ni duplica; cambiar las fechas vuelve a contar Horarios.
4. Los títulos de ambos editores reflejan el nombre mientras se escribe, usando texto literal. La ventana minimizada toma el título actualizado.
5. El encabezado de Staff conserva su posición fija y tiene fondo opaco: las filas y los filtros ya no se superponen con el título al desplazar la página.
6. La entrada visual temprana activa las clases de diseño antes del contenido en las 29 páginas de módulos. Los decoradores reconocen rutas con y sin `.html`. HTML, JS y CSS revalidan su caché antes de usarse, y los archivos compartidos conservan sus URLs con huella de contenido.

## Persistencia y compatibilidad

No requiere migración SQL. `gf_nomina_params` mantiene una fila por negocio y agrega `datos.porSucursal[sucursalId]`. El guardado combina el documento remoto y compara `updated_at`; si otra sucursal guardó mientras tanto, vuelve a leer y reintenta. También se cubre la creación simultánea del primer registro. Si falla el guardado remoto, el mínimo local no se adelanta.

El valor anterior del negocio sigue siendo el punto de partida para cada sucursal hasta que se guarde su configuración. Guardar una sucursal no modifica ese valor inicial ni las configuraciones de otras sucursales. Los registros sin sucursal pertenecen a Matriz.

El descuento no genera un segundo gasto. Reduce el neto del pago, utiliza el recibo existente y conserva el detalle del descuento al continuar al registro de gasto. Por ejemplo: 3 retardos × $12.35 = $37.05 de deducción. Los cambios de cantidad o tarifa en nómina aplican solo a ese pago; el valor predeterminado se cambia en el perfil.

## Verificación

- `node tests/money-tests.js`: 4649 comprobaciones, sin fallas, incluidas concurrencia entre sucursales, referencias antiguas, tarifa cero, edición del descuento, cambio de periodo y recibo.
- `node tests/store-tests.js`: 84 comprobaciones, sin fallas.
- `node docs/staff-seis-correcciones-2026-10-20/revisar-seis.cjs`: 36 casos en Chrome a 1440, 768 y 390 px. Incluye URL corta, cancelación y Volver con/sin contenedor, ambos editores, conservación de credenciales, separación salarial, encabezado al desplazar, carga con decoradores retrasados, marcado de retardo y continuidad hasta el gasto y navegación a recetas, insumos y las cuatro herramientas operativas restantes.
- `node versionar.js --revisar`, sintaxis de scripts modificados y `git diff --check`.

El navegador usa Supabase simulado y bloquea peticiones fuera del servidor local. Los datos de prueba son ficticios; no se modificaron expedientes, salarios ni pagos de producción. Las capturas de esta carpeta documentan el perfil, el encabezado desplazado y el pago con retardos en cada tamaño.
