# Reporte de bloque · lote 12 — R10 en Resumen financiero y KPIs

**Fecha:** 12-oct-2026
**Commits:** `931dd52`, `6c19a8a`
**Migraciones:** ninguna — este bloque es todo del lado del cliente
**Candados:** 4262 fórmulas · 84 del almacén · 0 fallas

---

## 1. Qué había

El patrón de siempre —`select('datos').eq('negocio_id', neg)`— tiene un techo
que no se ve: la API trae **como mucho** las filas que diga *Max rows* del
proyecto. Pasado ese techo **no hay error, no hay aviso, no hay nada**: llegan
las primeras N filas y la página calcula tan contenta.

En un reporte financiero eso es una utilidad equivocada con cara de dato bueno.
Y es peor que un error: nadie sospecha de un número.

Las dos pantallas pedían así **ocho colecciones** cada una, sin paginar y sin
comprobar nada. Y una de ellas, además, se tragaba los errores.

---

## 2. El lector compartido

`etaaxLeerTodo(tabla, negId)` y `etaaxLeerVarias(tablas, negId)` en
`etaax-db.js`. Devuelve `{ filas, completa, total, leidas, motivo }`.

**Por cursor, no por página numerada.** `range(1000,1999)` se salta filas y
repite otras si alguien captura un gasto mientras se está leyendo. Aquí se pide
«lo que venga **después** del último id que vi», con el id como orden — que es
único y no cambia. Ordenar por `created_at` no sirve: dos registros del mismo
segundo no tienen desempate.

**Se pregunta el total** (`count: 'exact'`) en el primer viaje y al final se
compara contra lo leído. **Una página corta no demuestra que se acabó:** el
servidor pudo recortarla por su propio límite, y ese es justo el caso que había
que cubrir.

**Se vigila que avance.** Si un viaje devuelve filas que ya se tenían, o el
cursor no se mueve, se corta y se declara incompleta. Mejor decir «esto está
incompleto» que girar en falso para siempre. Una fila nunca se cuenta dos veces.

**Un fallo a medio camino no se traga.** Se devuelve lo que se alcanzó a leer,
marcado como incompleto y **con el motivo**, que es el que acaba escrito en el
aviso rojo. Lo que no se hace nunca es devolver una lista corta en silencio.

Los documentos de una sola fila por negocio (`kpi_targets`, `sf_metas`,
`gf_nominas`) se quedan como estaban: no hay nada que paginar.

---

## 3. KPIs se tragaba sus errores

Esto no estaba en el encargo, apareció al abrir el archivo:

```js
if (!r[0].error) _kCache.cortes = ...;      // y si falla, se queda en null
```

Con la caché en `null`, los *loaders* devuelven `[]` y **el tablero enseña ceros
como si fueran reales**, sin una línea de aviso. Es el mismo R13 que Resumen ya
tenía cerrado, vivo en la pantalla de al lado — y un tablero miente igual de
bien que un P&L, con la ventaja de que se mira más seguido.

Ahora KPIs tiene el mismo aviso rojo que Resumen, con su botón de reintentar,
**y también en el impreso** (en negro sobre gris y con marco grueso: en una
impresora en blanco y negro un recuadro tenue desaparece, y el aviso que no se
ve es el que no existe), más un `· INCOMPLETO` en el subtítulo.

Y ninguna de las dos se cae si el módulo de datos no cargó: lo dicen.

---

## 4. Las dos pantallas no cuadraban — y ahora sí

Esto es lo que más valor tiene del bloque, y salió de la prueba que pidió el
punto 6.

**El mismo corte pagaba 3.5% de comisión en Resumen y 1.0% en KPIs.**

La causa: cuando un corte no dice de qué cuenta bancaria es, la comisión sale de
la **primera** de la lista de cuentas de débito. Y cada pantalla armaba su
lista a su manera:

| | cómo armaba la lista | qué pasaba |
|---|---|---|
| Resumen | `filter(tipo === 'debito')`, sin ordenar | tomaba la que viniera primero |
| KPIs | filtraba y ordenaba por `predeterminada` | tomaba otra |
| **El núcleo** | `EtaaxCore.cuentasDebito()` | ordena **y marca `esBase`**, la cuenta más antigua, dueña de lo no atribuido |

Ninguna de las dos copias marcaba `esBase`. Ahora las dos piden la lista al
núcleo. En el mes de prueba la diferencia eran **$175** sobre $21,200 de venta
— pequeña en pesos, pero es una diferencia *entre dos pantallas del mismo
negocio en el mismo mes*, que es lo que destruye la confianza en el sistema.

**Una diferencia que NO es bug y queda documentada:** Resumen lee la sucursal
activa **en cada cálculo**, y KPIs la fija **al cargar la página** (`var
_SUC_LOCK = _sucBloqueada()`) porque tiene su propio selector. Si alguien cambia
de sucursal en otra pestaña, Resumen se entera al repintar y KPIs no hasta
recargar. No es incorrecto —son dos diseños distintos— pero conviene saberlo
antes de comparar dos pantallas abiertas al mismo tiempo. Me costó una ronda de
falsos descuadres en la prueba.

---

## 5. Cómo se probó

### 5.1 Un servidor de mentira que se porta como el de verdad

24 comprobaciones (suite **BE12**). El doble **respeta su propio `maxRows`
aunque le pidan más**, que es exactamente lo que hace Supabase:

| Escenario | Qué se exige |
|---|---|
| 2,350 filas con techo de 1,000 | se leen las 2,350, completa, sin una repetida |
| el servidor da 120 cuando se piden 500 | **no se da por terminado**; lee las 900 |
| se cae en la segunda página | incompleta, con el motivo, y devuelve lo leído |
| repite una página | se corta y se declara incompleta, sin contar dos veces |
| el total dice 450 y llegan 300 | incompleta: «faltaron 150 de 450» |
| dos negocios mezclados | solo las de su negocio, ni una ajena |
| falla y se reintenta | a la segunda se lee entero |
| negocio sin datos | lectura **completa** de cero filas |

Y se comprueba el **cómo**, no solo el resultado: que cada viaje pida por cursor,
que ordene por `id`, y que el total se pregunte una sola vez.

### 5.2 La conciliación entre las dos pantallas

Suite **BE13**: se le da a las **dos** pantallas el mismo negocio, la misma
sucursal y el mismo periodo, se corren sus cargas de verdad y se comparan
**ingresos, egresos, nómina, fijos, variables, apartados y utilidad** — para
todo el negocio y para una sola sucursal. 16 comparaciones, todas cuadrando al
peso.

Con dos redes contra la prueba complaciente:

- **que las cifras no sean cero** — dos pantallas vacías cuadran perfecto y no
  prueban nada;
- **que filtrar por sucursal cambie los números** — si no, el filtro no filtra y
  cuadrar tampoco significaría nada.

Y el gasto **pendiente** del fixture no entra en ninguna de las dos: está
capturado pero no salió de la caja.

### 5.3 Batería de mutaciones — 10

| | Mutación | Cazada |
|---|---|---|
| L1 | una página corta se toma por «ya no hay más» (el bug original) | sí |
| L2 | deja de preguntar el total | sí |
| L3 | no compara lo leído contra el total | sí |
| L4 | un fallo a media lectura se da por completo | sí |
| L5 | deja de vigilar que avance | sí |
| L6 | cuenta las filas repetidas | sí |
| L7 | ordena por `created_at` (sin desempate) en vez de por `id` | sí |
| L8 | Resumen vuelve a armar su lista de cuentas a mano | sí |
| L9 | KPIs vuelve a tragarse los errores | **se escapó** → cubierta |
| L10 | el impreso de KPIs pierde el aviso | **se escapó** → cubierta |

L9 y L10 se escaparon porque esa honestidad **acababa de nacer y nadie la
vigilaba**. Se añadieron cinco pruebas, espejo de las que ya cuidan a Resumen, y
ahora las diez se cazan.

---

## 6. Lo que queda por verificar, y lo que no se tocó

**En pantalla** (no lo puedo probar yo):

1. Abrir Resumen y KPIs del mismo negocio, mismo mes, y comparar **ingresos,
   egresos y utilidad**: tienen que decir lo mismo. Si no, quiero ver las dos
   capturas.
2. Si tienes **dos cuentas de débito con comisiones distintas**, revisa que la
   comisión del mes no haya cambiado respecto a lo que veías antes — este
   bloque corrige cuál cuenta se usa cuando el corte no lo dice, así que en
   negocios con esa situación el número **puede moverse, y hacia el correcto**.
3. Un negocio con mucha historia: que los dos reportes carguen y que **no**
   aparezca el aviso rojo. Si aparece, dice exactamente qué colección quedó a
   medias.

**Sigue pendiente de ti:** el valor de *Settings → API → Max rows*. Ya no es
crítico —el lector funciona con cualquier valor y lo detecta solo— pero sirve
para saber **cuánto se estaba recortando hasta hoy**, que es una pregunta sobre
los reportes que ya se imprimieron.

**Lo que NO se tocó, a propósito:** las demás consultas del proyecto siguen con
el patrón viejo. El lector ya está y es compartido, así que migrarlas es
mecánico, pero cada pantalla necesita su propia conciliación y su propio aviso.
Van por separado, como acordamos.

**R10 queda corregido en Resumen financiero y KPIs.** Sigue abierto R03; y de
este módulo, el diseño del Resumen sigue esperando lo que Edwin quiera mostrar.
