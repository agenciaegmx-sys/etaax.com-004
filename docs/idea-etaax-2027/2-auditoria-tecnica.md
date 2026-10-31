# 2 · Qué dice el código (y qué dicen los datos)

Dos auditorías del 31-oct-2026: Claude sobre el repositorio, Codex sobre el
repositorio **y consultas de solo lectura a producción**. Se marca quién
verificó qué, porque no es lo mismo leer código que medir datos.

## La buena noticia: el vocabulario de productos ya existe

[`page-guard.js:25`](../../page-guard.js#L25) define los permisos de rol con
exactamente las llaves que tendrían que ser los productos:

```
recetas, insumos, inventarios, requisiciones, ventas, gastos, menu,
proveedores, clientes, staff, financiero, config
```

Y [`page-guard.js:600`](../../page-guard.js#L600) ya tiene un mapa URL→módulo
que redirige con `?denegado=<llave>`. O sea: **no hay que inventar un sistema
de licencias, hay que agregarle una segunda capa a la que ya está.** Hoy la
pregunta es «¿este ROL puede?»; falta «¿este NEGOCIO lo contrató?», resueltas
con un AND.

Eso es la parte fácil y es menos trabajo del que parece.

## Lo que falta de verdad

### A. El cobro está hecho para un solo producto

| Dónde | Qué hace hoy |
| --- | --- |
| [`precios.js`](../../precios.js) | Una escalera única desde $1,799 por sucursal. No conoce productos |
| `suscripciones` ([v24](../../supabase-migration-v24.sql#L17)) | Solo `estado` y `activa_hasta`. **Sin plan, sin capacidades** |
| [`hub.html:1295`](../../hub.html#L1295) | El gate es binario: activo sí/no, y tapa el hub completo |
| `crear-checkout/index.ts` | Un solo `price` con cantidad = número de sucursales |
| `sync-suscripcion/index.ts:97` | Modifica **solo** `items.data[0]` |
| `stripe-webhook/index.ts:167` | Concede siempre `p_meses: 1` (no hay anualidad) |

Stripe sí permite varios productos en una suscripción con un solo cobro, y
tiene Entitlements para asociar funciones a productos. Pero Stripe no sabe
**qué sucursal** puede usar cada función: esa asignación es local y hay que
construirla. (Verificado por Codex contra el código de las Edge Functions.)

### B. Los cruces de datos — aquí está el trabajo, no en la puerta

Los módulos no se cortan por donde uno quisiera. Verificado leyendo qué tabla
consulta cada página:

| Página | Lee de otro paquete | Qué vería quien compró solo uno |
| --- | --- | --- |
| [`recetas/requisiciones.html`](../../recetas/requisiciones.html) | `cortes` (Administrativo) | el % compra vs venta en cero |
| [`recetas/inventarios.js`](../../recetas/inventarios.js) | `recetas` (Costeo) | **inventario no funciona sin costeo**: prebatch y sub-recetas |
| [`administrativo/menu.html`](../../administrativo/menu.html) | `recetas` | la carta QR necesita el costeo debajo |
| [`financiero/kpis.html`](../../financiero/kpis.html) | `gf_nominas` (RH) | el costo laboral en cero — justo el KPI que importa |
| [`financiero/gastos-globales.html`](../../financiero/gastos-globales.html) | `staff`, `gf_nominas` | igual |
| [`administrativo/diario.html`](../../administrativo/diario.html) | 13 tablas, entre ellas `gf_nominas`, `gf_fijos`, `staff`, `horarios`, `proveedores` | el corazón administrativo toca RH por todos lados |

**Un cero donde debería haber un número es un ticket de soporte y una
solicitud de reembolso.** Cada cruce necesita decir «este dato vive en el
módulo X, que no tienes contratado» — y de paso ese es el mejor lugar de venta
que va a tener el producto.

La conclusión de Codex sobre esto es la buena: **cada servicio debe traer sus
dependencias por dentro, invisibles para el cliente.** El que compra
Inventarios no tiene que enterarse de que necesita catálogo de insumos y
composición de recetas: se le da. Cobrar dos veces la misma dependencia genera
fricción, y dejarla fuera obliga a comprar el otro módulo — que es lo que se
quería evitar.

### C. Los portales QR no pasan por la guarda, y es a propósito

`carta.html`, `entrada.html`, `checklist.html`, `captura.html` y la app móvil
corren **sin sesión**, autorizados solo por token del QR + NIP. Hoy, si alguien
cancela «menú» o «inventarios», **su QR sigue funcionando**: las RPC no
preguntan qué contrató el negocio.

En modelo modular eso es fuga de ingreso, y se arregla en el servidor. Barato
de hacer: la [v80](../../supabase-migration-v80.sql) ya dejó el patrón puesto
(lista blanca + validación de pertenencia dentro de la RPC).

### D. Los controles de hoy no alcanzan para vender por piezas

- [`page-guard.js:566`](../../page-guard.js#L566) da acceso total a dueño y
  admin del negocio. Correcto hoy; en modelo modular, el dueño no debe adquirir
  una herramienta por ser dueño. (Codex)
- Las políticas RLS de recetas, insumos e inventarios validan **negocio o
  admin**, no plan ni sucursal del colaborador. (Codex)
- Las políticas permisivas de Postgres se combinan con **OR**: agregar otra
  política no revoca las anteriores. Separar por licencia exige una migración
  controlada de políticas y RPC, incluidos QR y Storage. (Codex)
- **Esconder botones no es un control.** La API se puede llamar directo.

### E. Integridad de datos — medido en producción (Codex)

| Hallazgo | Qué implica |
| --- | --- |
| **109 insumos** cuyos dos negocios ya no existen | Revisar papelera/origen antes de reasignar o limpiar |
| 2 registros con el sentinel interno `__catalogo__` | **No** son negocios borrados; no tratarlos como tales |
| De 1,564 recetas, **22 referencias** sin insumo local exacto: 6 resuelven por copia local, 4 solo al catálogo ETAAX, **10 no resuelven**, 2 solo existen en otro negocio | Casos para revisión individual. Las coincidencias en otro negocio **no autorizan** usarlas |
| Los IDs del JSON coincidieron con los de columna en los 4,097 insumos y 1,564 recetas revisados | Buena señal, pero no prueba ausencia de duplicados semánticos |

Nada de esto demuestra que se estén mezclando datos entre clientes. Son
referencias huérfanas, que es otra cosa — y hay que limpiarlas antes de
automatizar cualquier migración de sucursales.

### F. Dos fallas de hoy, no de 2027

**1. `recetas/requisiciones.html:596` pide `negocio_insumos.created_at` y esa
columna no existe.** Codex lo confirmó contra producción. La consulta falla y
la pantalla se queda con la caché del navegador, así que **una sesión nueva
puede no cargar el catálogo**.

Dato que lo explica: **`negocio_insumos` no se crea en ninguna migración del
repo** — se levantó a mano en Supabase y su esquema nunca entró a control de
versiones. Su PK es `(negocio_id, insumo_id)`, sin FK al negocio ni unicidad
por maestro/sucursal. Y el síntoma estaba a la vista: `requisiciones.html:596`
la ordena por `created_at` mientras [`inventarios.js:204`](../../recetas/inventarios.js#L204)
la ordena por `insumo_id`. Dos páginas, la misma tabla, columnas distintas —
a lo más una podía estar bien.

**2. `_sbInitInv` hace cuatro lecturas sin paginación.** El negocio más grande
tiene 923 insumos y el máximo de entradas es 806, contra el límite por defecto
de 1,000 filas de Supabase. Codex no afirma que hoy esté truncando, pero sí que
hay que cerrar la paginación antes de que Inventarios crezca como servicio
aparte. `etaaxLeerTodo` ya existe en [`etaax-db.js`](../../etaax-db.js); hay que
adaptarlo a la clave `insumo_id`.

### G. Una incoherencia de oferta que ya está publicada

[`index.html:655`](../../index.html#L655) anuncia un plan Free permanente y un
Pro con «precio disponible pronto», mientras el cobro vigente son $1,799 por
sucursal. Marketing, contrato y checkout necesitan una sola definición de la
oferta — y eso aplique o no la idea modular. (Codex)

## Falsa alarma descartada

Siete páginas de módulo parecían no tener `page-guard`. Son redirecciones de 15
líneas de cuando ventas y gastos se mudaron a `diario.html`. La cobertura real
es completa.
