# Idea de actualización · ETAAX 2027 — vender por herramientas

**Estado: IDEA EN MADURACIÓN. No decidida, no construida, no anunciada.**

Conversación del 31-oct-2026 entre Edwin, Codex y Claude. Se archiva aquí para
retomarla cuando toque, no para empezarla. Lo que se decidió el mismo día fue
**no hacerla todavía**:

> «Por ahora seguiremos insistiendo en que nos compren todo, o sea ERP ETAAX, y
> podríamos hacer una versión light y una premium y con eso podemos separar
> cosas en concreto, pero prefiero madurar la idea.» — Edwin

Así que el rumbo de HOY es: **un solo producto, el ERP completo, $1,799 por
sucursal** (la escalera de [`/precios.js`](../../precios.js) sigue siendo la
única verdad del precio), y fortalecer lo que ya existe. La separación en
herramientas queda como la posible actualización grande de 2027, y el camino
más corto hacia ella —el que Edwin prefiere— es **light / premium**, no un
catálogo de once piezas.

Nada de lo que está en esta carpeta cambió precios, contratos, permisos ni
código. Es diagnóstico y conversación.

## Qué hay aquí

| Archivo | Qué contiene |
| --- | --- |
| [1-la-idea.md](1-la-idea.md) | La propuesta de Edwin con sus palabras y sus números ilustrativos, y la variante light/premium que prefirió al final |
| [2-auditoria-tecnica.md](2-auditoria-tecnica.md) | Qué dice el código y qué dicen los datos de producción. Lo que habría que construir ANTES de vender por piezas |
| [3-las-dos-opiniones.md](3-las-dos-opiniones.md) | Dónde coincidimos Codex y Claude, dónde no, y la cuenta de los descuentos que ninguno vio al principio |
| [4-decisiones-pendientes.md](4-decisiones-pendientes.md) | Las preguntas que hay que responder antes de escribir una línea. Varias son de negocio, no de código |
| [informe-codex-2026-10-31.md](informe-codex-2026-10-31.md) | El informe completo de Codex, tal cual lo entregó (con sus consultas de solo lectura a producción) |

## Por qué esta carpeta vive en `docs/`

Porque Netlify publica la raíz del repo tal cual, y `docs/*` tiene un 404
forzado en [`netlify.toml`](../../netlify.toml) justo para esto. Una estrategia
de precios y unos hallazgos de producción no deben quedar servidos en
etaax.com. Si algún día algo de aquí tiene que verse público, se mueve a mano.

## Lo que SÍ conviene no perder de vista aunque la idea se congele

Tres hallazgos técnicos de esta conversación son problemas de hoy, no de 2027,
y valen arreglo independientemente de cómo se venda el sistema:

1. **`recetas/requisiciones.html:596` pide una columna que no existe**
   (`negocio_insumos.created_at`). Codex lo confirmó contra producción: la
   consulta falla y la pantalla se queda con la caché del navegador como
   respaldo, así que **una sesión nueva puede no cargar el catálogo**.
2. **109 insumos en producción apuntan a dos negocios que ya no existen**, más
   22 referencias de ingredientes sin insumo local exacto (10 sin resolver).
   Son casos a revisar uno por uno — no demuestran mezcla de datos entre
   clientes, pero sí hay que limpiarlos antes de mover una sucursal.
3. **`negocio_insumos` no se crea en ninguna migración del repo.** La tabla más
   importante del sistema se levantó a mano en Supabase y su esquema no está en
   control de versiones. Por eso nadie se dio cuenta de lo del punto 1.

Lo demás de esta carpeta puede esperar. Esos tres, no.
