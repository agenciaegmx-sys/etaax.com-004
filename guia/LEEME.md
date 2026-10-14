# Las capturas de la guía visual

Cada herramienta del hub de módulos enseña lo que hay dentro pasando sus
capturas. Este folder es el álbum; la fila la arma
[`/hub-modulos.js`](../hub-modulos.js).

## Qué hacer

Arrastra cada captura aquí con el nombre **`<clave>-<número>.png`**. Nada más:
la pantalla ya las espera.

Al tocar una captura disponible se abre un visor flotante más grande. Sus
flechas (y las del teclado) recorren la misma guía; al cerrar se conserva el
paso elegido. **Ver detalle** acerca la imagen y permite desplazarse; **Ajustar
imagen** vuelve a mostrarla completa. Se cierra con ×, Escape o tocando el fondo.
Las capturas pendientes conservan su marco y no abren un visor vacío.

| Módulo | Herramienta | Archivos |
|---|---|---|
| Control administrativo | Ventas y gastos diarios | **`diario-1.png` … `diario-10.png` ✅ puestas** |
| | Gestión de colaboradores | **`staff-1.png` … `staff-8.png` ✅ puestas** |
| | Proveedores | **`proveedores-1.png` … `proveedores-3.png` ✅ puestas** |
| | Clientes | **`clientes-1.png` … `clientes-3.png` ✅ puestas** |
| | Menú de la sucursal | **`menu-1.png` … `menu-3.png` ✅ puestas** |
| Recetas e Insumos | Escandallos | **`escandallos-1.png` … `escandallos-7.png` ✅ puestas** |
| | Insumos | **`insumos-1.png` … `insumos-7.png` ✅ puestas** |
| | Inventarios | **`inventarios-1.png` … `inventarios-7.png` ✅ puestas** |
| | Requisiciones | **`requisiciones-1.png` … `requisiciones-4.png` ✅ puestas** |
| Salud financiera | Resumen financiero | `resumen-1.png` … `-3.png` |
| | Ventas totales | `ventas-1.png` … `-3.png` |
| | Gastos totales | `gastos-1.png` … `-3.png` |
| | Previsiones | `previsiones-1.png` … `-3.png` |
| | Cuentas bancarias | `cuentas-1.png` … `-3.png` |
| | KPIs | `kpis-1.png` … `-3.png` |
| | Estadísticas | `estadisticas-1.png` … `-3.png` |
| Aprende y analiza | Guías de uso | `guias-1.png` … `-3.png` |
| | Ventas por producto | `ventas-productos-1.png` … `-3.png` |
| | Simulador de metas | `simulador-1.png` … `-3.png` |

El **orden importa**: el número es el paso, y el pie que lo acompaña ya está
escrito en `hub-modulos.js`. Proveedores tiene tres pasos: el directorio,
el formulario para agregar un proveedor y el listado con el proveedor guardado.
Ventas y gastos diarios tiene diez capturas; Gestión de colaboradores, ocho.
Clientes muestra el directorio, el formulario de registro y el cliente guardado.
Menú muestra su gestión, el QR para compartir la carta y los ajustes de apariencia.
Las cinco herramientas de Control administrativo ya tienen sus recorridos completos.
Escandallos tiene siete capturas: su menú, recetas de alimentos y bebidas,
sub-recetas de alimentos y bebidas, receta simple y catálogo con sus filtros.
Insumos tiene siete capturas: catálogo, ficha técnica, edición, cambio de tipo,
costeo y stock, selector para agregar un insumo y catálogo global ETAAX.
Inventarios tiene siete capturas: catálogo, QR de entradas, existencias por área,
productos compuestos, historial de entradas, datos generales y captura de existencias.
Requisiciones tiene cuatro capturas: búsqueda de existencias, lista completa,
proyección por área y proveedor, y pedido con sus opciones de exportación.
Las cuatro herramientas de Recetas e Insumos ya tienen sus recorridos completos.

## Reglas de la foto

- **Conserva la proporción original.** La imagen se muestra completa dentro de
  un marco 16:9 y se puede ampliar; los modales verticales también funcionan.
- **Unos 1600 px de ancho** bastan para una pantalla horizontal. Conserva el
  detalle necesario para leerla y evita archivos de varios MB por captura.
- **`.png`** para pantallas.
- **Nada de datos de clientes reales.** Esto lo ve cualquiera que entre al hub:
  nombres, teléfonos o importes de un negocio de verdad se cambian antes. Un
  negocio de prueba es la forma fácil.

## Mientras no estén

No pasa nada: la fila se arma igual, con su marco del mismo tamaño que tendrá
la foto y el texto «Captura en camino». Se pueden subir de una en una; cada
archivo que aparece se ve al recargar, sin tocar código.
