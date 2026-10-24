# Catálogos por ID y propuesta de presentaciones de subrecetas

23 de octubre de 2026.

Actualización: la aclaración posterior del usuario y la implementación de
presentaciones se documentan en
[Subrecetas con presentaciones y selector de sucursal](subrecetas-presentaciones-sucursales-2026-10-23.md).
La propuesta de abajo se conserva como antecedente.

## Corrección implementada: importación a sucursales

El selector del catálogo del negocio enumeraba registros fuera de la sucursal
actual. Eso incluía tanto el maestro como sus copias en otras sucursales. Su
indicador de existencia consultaba solo el registro mostrado. El selector ETAAX
también buscaba el ID directo del catálogo en la sucursal, pero las fichas propias
de sucursal tienen otro `id` y conservan la relación mediante `origenId`.

`_identidadCatalogoIns` en `recetas/insumos.js` resuelve ahora una identidad por
ID raíz y construye los maestros y las existencias por sucursal con la misma
regla. Los dos selectores de `recetas/insumos.html` usan ese índice.

- Una opción por ID maestro en el catálogo del negocio. Dos productos con el
  mismo nombre y distintos IDs siguen siendo independientes.
- “Ya en sucursal” considera el maestro con membresía antigua y cualquier copia
  relacionada, incluso renombrada, pausada o inactiva. Estar en otra sucursal
  permite importar al destino actual.
- El manejador de importación vuelve a comprobar la existencia; no depende del
  estado visual del botón. Se conservan las fichas, precios, áreas e IDs existentes.
- Las cadenas antiguas copia→copia llegan hasta el maestro. Si solo quedan las
  copias, el selector representa su ID raíz y al importar a un nuevo destino se
  recupera esa referencia global. Abrir el catálogo no escribe ni repara datos.
- ETAAX bloquea clics simultáneos del mismo insumo/destino mientras sube una foto.
  Después de la espera relee la lista antes de guardar, para conservar otras altas
  realizadas mientras tanto. Si cambió el contexto, cancela esa importación.
- En móvil, nombre y variedad ocupan una fila y el precio y el botón otra.

No se borran duplicados históricos ni se inventan relaciones por coincidencia de
texto. Un registro antiguo que perdió `origenId` conserva su identidad independiente
hasta que se vincule explícitamente. Esta corrección controla los selectores y
manejadores del cliente; no agrega una restricción SQL de unicidad por
maestro/sucursal entre dispositivos que importen simultáneamente.

## Propuesta revisada: presentaciones de subrecetas

Esta parte es una propuesta; no se cambió todavía el modelo ni la captura de
subrecetas. Se parte del supuesto de rendimientos alternativos por tanda. Se
consultó si también se necesitan tandas con tamaños combinados; esa decisión
afecta el registro de producción.

### Lo que ya existe

`camposExtra` de la receta guarda un rendimiento final y un rendimiento opcional
en porciones (`porcionesQty`, `pesoPorcion` y sus unidades). Al convertirla en
insumo, `agregarSubRecetaComoInsumo` genera un registro con `esSubReceta`, `recetaId`
y `presentaciones`: granel, porción y, cuando corresponde, envase de prebatch.

Esas presentaciones expresan referencias distintas de la misma producción. El
envase de 750 ml tampoco equivale automáticamente al rendimiento de una tanda.
Hay un bloque antiguo de interfaz `presentacionesPorcion` de hasta tres tarjetas,
pero no tiene un contrato de identidad que permita seleccionar cada rendimiento
en ingredientes. No basta con habilitar esas tarjetas.

`getCostoParaUnidad` elige la primera presentación que coincide con la unidad.
Por eso tres opciones en PZA resultarían indistinguibles para el cálculo.
`agregarSubRecetaComoInsumo` reconstruye las presentaciones al guardar la receta:
agregar opciones solo al insumo las perdería en la siguiente sincronización.

### Ajuste al modelo

Una fórmula, un rendimiento final real de la tanda y una lista dinámica de
presentaciones de rendimiento, sin límite fijo de tres. Cada una tiene un ID
estable, nombre editable y cantidad/unidad obtenida por tanda. Se puede capturar
el número de piezas o el peso/volumen de cada pieza; el otro valor se deriva.

Ejemplo ilustrativo: una tanda de bizcocho rinde **2 kg** y cuesta **$800**.

| Presentación | Piezas por tanda | Peso de cada pieza | Costo por pieza |
| --- | ---: | ---: | ---: |
| Grande | 2 | 1,000 g | $400 |
| Mediano | 4 | 500 g | $200 |
| Chico | 8 | 250 g | $100 |

Los tamaños son maneras alternativas de dividir los mismos 2 kg. No suman
14 piezas ni generan tres existencias de 2 kg. Si cambian los ingredientes,
el proceso o la merma real, puede corresponder una fórmula independiente.

La fuente de verdad propuesta es `camposExtra.presentacionesRendimiento`:

```js
[
  { id: 'principal', nombre: 'Bizcocho', cantidadPorTanda: 2, unidad: 'KG' },
  { id: 'r_grande', nombre: 'Grande', cantidadPorTanda: 2, unidad: 'PZA' },
  { id: 'r_mediano', nombre: 'Mediano', cantidadPorTanda: 4, unidad: 'PZA' },
  { id: 'r_chico', nombre: 'Chico', cantidadPorTanda: 8, unidad: 'PZA' }
]
```

Los IDs ilustrativos adicionales se generarían con el mecanismo de IDs de la
app. Los nombres no son identidad; reordenar o renombrar no rompe referencias.

El catálogo conserva **un insumo de producción por subreceta/sucursal**. Las
presentaciones se ofrecen como opciones del ingrediente: “Bizcocho · Mediano”.
El escandallo guarda el `insumoId` existente y un nuevo `rendimientoId`:

```js
{ insumoId: 'id_del_insumo_actual', rendimientoId: 'r_mediano',
  cantidad: 1, unidad: 'PZA' }
```

Para una presentación de N piezas por tanda:

- Costo de una pieza = costo vivo de la tanda / N.
- Peso o volumen base de una pieza = rendimiento final real / N.
- Una receta que usa 1 mediano descuenta 500 g y cuesta $200 en el ejemplo.

Las fórmulas puras deben incorporarse en `etaax-core.js` y ser compartidas por
editor, costos vivos, carátulas, impresión e inventarios. Cada consumo elegido se
normaliza a la unidad base antes del reparto de ingredientes y prebatch. La
producción se registra una vez, usando el rendimiento real de la tanda.

### Compatibilidad

1. La subreceta ya convertida conserva su `insumoId` y su `recetaId`. Su
   comportamiento actual es el rendimiento `principal`, mostrado como
   “Rendimiento 1” y con el nombre de la subreceta por defecto, editable.
2. Si ya tiene un rendimiento por porciones, este alimenta la presentación
   principal sin cambiar su costo ni conversión actual. Si solo tiene granel,
   conserva la unidad de granel; no se convierte silenciosamente en “1 pieza”.
3. Los ingredientes antiguos sin `rendimientoId` siguen usando ese comportamiento
   principal. No hay que abrir y guardar cada receta para conservar sus costos.
4. Guardar una subreceta actualiza los valores derivados, pero conserva los IDs
   y nombres elegidos para sus presentaciones. La sincronización por sucursal
   debe preservar esas identidades.
5. Una presentación usada se archiva en lugar de eliminarse. Los inventarios y
   documentos históricos conservan las conversiones capturadas en su momento.
6. Esto cabe en los JSONB actuales; no requiere una tabla por tamaño ni duplicar
   las recetas. Sí exige actualizar la lectura y escritura de `camposExtra`, la
   selección de ingredientes y todos los lectores de costo y consumo.

Si una tanda puede producir tamaños mezclados, se necesita además capturar el
reparto real, por ejemplo 1 grande + 2 medianos = 2 kg. Ese reparto no se puede
tratar como tres tandas completas; la suma de equivalentes debe conciliar con la
producción real. La captura de inventario seguiría teniendo una única base y,
si se requiere contar tamaños por separado, desgloses que se conviertan a ella.

### Validación necesaria al implementarlo

Invariancia del costo total, conversión entre KG/G y LT/ML, equivalencia de
porciones, cambios de precio, cantidades fraccionarias, subrecetas anidadas,
independencia entre sucursales y conservación de inventarios anteriores. No
permitir pesos incompatibles con volumen ni rendimientos inválidos. Registrar
merma adicional explícitamente, sin deducirla de la capacidad de un recipiente.

## Verificación de la corrección de catálogos

- `node tests/money-tests.js`: 4,738 comprobaciones, incluidas 14 nuevas para
  identidad, indicadores, cadenas antiguas y carreras de importación.
- `node tests/store-tests.js`: 84 comprobaciones.
- `node tests/probar-ventanas-insumos.cjs`: 20 casos. Conserva los 12 recorridos de
  ventanas anidadas y añade 8 casos de importación/recarga en 1440 y 390 px.
- Navegador real con Supabase simulado y peticiones externas bloqueadas. Las
  capturas contienen únicamente datos ficticios. No se modificaron datos reales.

Capturas: [negocio en escritorio](catalogos-2026-10-23/catalogo-negocio-1440.png),
[ETAAX en móvil](catalogos-2026-10-23/catalogo-etaax-390.png).
