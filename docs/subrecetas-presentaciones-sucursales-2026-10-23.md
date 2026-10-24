# Subrecetas con presentaciones y selector de sucursal

23 de octubre de 2026. Implementación según la aclaración del usuario:
un insumo por subreceta/sucursal y las presentaciones como unidades de uso.
Sustituye la propuesta de `catalogos-y-presentaciones-2026-10-23.md`.

## Comportamiento

En Rendimiento de una subreceta se conserva el rendimiento final estándar y el
primer bloque de porciones. El primer nombre toma el de la subreceta por defecto
y se puede editar. “Agregar otra presentación” añade bloques de nombre, cantidad
de porciones por tanda o peso/volumen por porción. Se calcula la otra referencia y
el costo por porción con el mismo costo total y rendimiento final.

La subreceta se convierte en **un solo insumo**. Guardar actualiza sus
presentaciones conservando el ID existente y sus metadatos. En otra receta,
el selector de unidad ofrece los nombres —Grande, Mediano, Chico— junto con G,
KG, ML, LT y las unidades existentes. Las referencias por kilo/litro se mantienen.
PZA/PORCION antiguas usan el primer rendimiento por porciones.

Ejemplo verificado: tanda de 2 kg con costo $800.

| Presentación | Cantidad por tanda | Peso por porción | Costo por porción |
| --- | ---: | ---: | ---: |
| Grande | 2 | 1,000 g | $400 |
| Mediano | 4 | 500 g | $200 |
| Chico | 8 | 250 g | $100 |

Dos medianos consumen 1,000 g y cuestan $400. Usar 500 g desde la misma referencia
cuesta $200. Un insumo permite así consumo por peso/volumen o por porción nombrada.
El cálculo por peso usa la proporción exacta de la tanda: una porción de 300 g
cuesta $120 en este ejemplo; no se redondea el rendimiento a seis piezas y se
carga artificialmente todo el costo a esas seis.

“Quitar” archiva una presentación: deja de ofrecerse para nuevos ingredientes,
pero una receta que ya la usa conserva su equivalencia. No se cambian los IDs
existentes al renombrar o reordenar presentaciones. Los datos incompatibles o
incompletos se señalan antes de guardar.

El botón “Agregar como insumo” reconoce la producción de la sucursal actual.
Si existe, queda en “Agregado a insumos”. Las bajas persistentes del catálogo
se respetan también al leer la memoria y al refrescar desde Supabase; guardar la
subreceta silenciosamente no recrea un insumo eliminado. Al volver a la ventana
o recibir un cambio de almacenamiento se refresca el catálogo y el botón puede
habilitarse. Agregar explícitamente después de eliminar genera un nuevo insumo.

## Modelo e integración

- `camposExtra.rendimientosPorcion`: lista de definiciones. Los campos antiguos
  de la primera porción siguen guardándose para compatibilidad.
- `recetas/subreceta-rendimientos.js`: captura, nombres, lista dinámica, historial,
  validación y refresco del catálogo. Las subrecetas antiguas adquieren la primera
  definición en lectura sin reescribir de golpe los registros del negocio.
- `etaax-core.js`: normalización y cálculo de porciones, y lectura de equivalencias
  del insumo. El costo y el contenido derivan de una misma tanda.
- `presentaciones` del insumo incluye las referencias KG/LT/envase existentes y
  las porciones con `esRendimientoPorcion`, `rendimientoId`, `nombreRendimiento`,
  `contenidoPorcionBase` y `unidadPorcionBase`. No se crean insumos por tamaño.
- La unidad guardada del ingrediente es `RENDIMIENTO:<id-interno>`. El usuario ve
  el nombre. No se usa el nombre ni la posición en la lista como identidad.
- `app.js`: selección de unidades, precio de referencia, peso bruto, impresión,
  costos vivos y tablas de presentaciones. El catálogo y la ficha del insumo
  muestran los nombres y pesos por porción.
- `recetas/inventarios.js`: normaliza la porción a G/ML/PZA antes de acumular
  ventas, producción y reparto de ingredientes. Se registra la tanda una vez;
  una presentación no duplica existencias ni producciones. La ficha de receta
  del inventario usa también la equivalencia, incluso para su costo.

No hay tablas ni migraciones SQL nuevas. Las definiciones caben en los JSONB
existentes. No se ejecutaron migraciones ni cambios masivos sobre datos reales.

## Cambiar de sucursal

La barra compartida de módulos solo generaba “Cambiar módulo” e “Información de
sucursal”. El selector de sucursal estaba en el inicio, por eso desaparecía al
entrar a algunas rutas aunque se usara la cuenta del negocio.

`etaax-modulos-ui.js` incluye ahora “Cambiar sucursal” para el contexto de acceso
completo del negocio. Abre la lista del negocio activo, actualiza desde Supabase
y señala la sucursal actual e inactivas. Al elegir otra actualiza tanto
`etaax_sucursal_activa` como `etaax_ctx`, aplica su color y navega a la misma ruta
para cargar sus datos. Cancelar conserva el contexto. El guardado pendiente del
escandallo conserva su protección habitual antes de navegar.

El selector no se concede a sesiones de colaborador ni al contexto global. El
manejador revalida el contexto al recibir la lista y al aplicar el cambio.

## Verificación

- `node tests/money-tests.js`: 4,774 comprobaciones. Casos del núcleo, lector de unidades, conversor
  real, botón, bajas, sucursales, nombres, compatibilidad y costos de inventario.
  Se añadieron también consumos reales de prebatch con porción nombrada y con
  porciones mezcladas con ML; el reparto y la diferencia conservan el total.
- `node tests/store-tests.js`: candado de persistencia.
- `node tests/probar-ventanas-insumos.cjs`: 36 casos de navegador. Incluye guardar
  y recargar las tres presentaciones en ventanas flotantes a 1440 y 390 px,
  selección en otra receta, bajas y alta explícita, cinco rutas con selector de
  sucursal, cancelación, cambio manteniendo ruta y denegación para colaborador.
- `node tests/probar-navegacion-visual.cjs`: 34 casos, conservando la protección
  contra el primer render del diseño antiguo y la navegación con caché.

El navegador usa Supabase simulado, datos ficticios y red externa bloqueada.
Las capturas no contienen información de usuarios reales.

Capturas: [presentaciones](subrecetas-2026-10-23/subreceta-presentaciones-1440.png),
[unidad Mediano](subrecetas-2026-10-23/unidades-subreceta-1440.png),
[selector de sucursales](subrecetas-2026-10-23/sucursales-cuenta-negocio.png).
