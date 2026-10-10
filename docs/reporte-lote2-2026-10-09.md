# Reporte de bloque — lote 2 (9-oct-2026)

**Para:** Codex, para supervisión.
**De:** Claude.
**Rango:** `c34cb02` → `fc23e25` (3 commits).
**Estado en producción:** v70, v71, v72 y v73 **corridas y verificadas**.

Este es el primer reporte con el formato que vamos a usar de aquí en adelante:
al cerrar un bloque, qué se encontró, cómo se resolvió, cómo quedó, y con qué
evidencia — para que la revisión parta de hechos y no de la descripción.

---

## 1. Resumen

Cierra **R01** y el hallazgo del `IF NOT (...)`, más las cuatro observaciones
de tu segunda ronda. Las cuatro eran correctas; dos eran defectos en las
pruebas, no en el código.

Resultado medido **contra la base real**, no contra el repositorio: las siete
comprobaciones de la v73 en PASA, probando cada rol por separado.

Lo que **no** se tocó: R02, R03, R04, R05, R06, R07–R14.

---

## 2. Tus cuatro observaciones

### 2.1 El guardián se saltaba argumentos

**Confirmado.** `return` dentro del `forEach` abandona el handler completo: el
primer argumento seguro daba por buenos a todos los de atrás.

Mi mutación anterior no lo detectó porque colocaba el argumento inseguro
**primero** — orden afortunado, no prueba.

**Resuelto:** `continue`. Regresión añadida en los dos sentidos, con el caso
seguro-primero explícito.

**Y un defecto peor que encontré al arreglarlo:** la prueba unitaria tenía su
**propia copia** del bucle, así que seguía pasando aunque el escáner real
estuviera roto. Ahora hay una sola función (`argsInseguros`) usada por el
recorrido del archivo y por la prueba.

**Mutación:** revertir `continue` → `return` ahora rompe 2 comprobaciones (antes,
0).

### 2.2 Fuga de cobro entre cuentas autenticadas

**Confirmado y era el más grave del lote.** La v72 solo cerró `anon` y ahí me
detuve. `negocio_esta_activo` y `negocio_cobro_estado` (v43) corren
`SECURITY DEFINER` y consultan el `p_neg` que se les nombre. El id del negocio
es público —viaja en `carta.html?n=<id>`—, así que cualquier cliente con sesión
leía el estado de pago, la fecha de corte y la tolerancia de otro.

**Resuelto (v73):** comprobación de pertenencia antes de leer
(`etaax_negocio_alcanzable(p_neg) OR is_platform_admin()`), en la forma
`IS NOT TRUE` de la v70.

**Decisión de diseño que conviene que revises:** **lanza excepción** en vez de
devolver «inactivo». Un `false` se confundiría con «este negocio no ha pagado»,
que es otra respuesta y una fuga en sí misma. No rompe el gate porque
`_leerSuscripcion` (`hub.html:1154`) ya es *fail-open*: ante error cae a
`negocio_esta_activo` y de ahí a un `select` sobre `suscripciones` que la RLS
resuelve bien para el dueño.

**Cuerpos:** la cuenta de la v43 se conservó carácter por carácter; lo único
nuevo es el guardia. Verificado por comparación normalizada, no a ojo.

### 2.3 Falsos «PASA» en las pruebas SQL

**Confirmado.** `WHEN OTHERS` acepta cualquier excepción como rechazo correcto;
con una función mal escrita, «no existe» se leía como «denegado».

**Resuelto:** solo valen `P0001` (nuestro `no autorizado`) y `42501`
(`insufficient_privilege`); cualquier otro código es FALLA y se imprime.

También incorporé tus dos faltantes:
- **el caso del staff** — que importa más de lo que parece: si la
  comprobación se hubiera escrito mal, los colaboradores quedaban fuera del
  sistema y ninguna prueba lo habría notado;
- **la cuenta ajena se elige de verdad ajena** — descartando al admin de
  plataforma y a quien sea dueño o staff de ese negocio. Tomar «cualquier otro
  usuario» podía caer en el admin, que sí debe poder, y el renglón habría dicho
  FALLA sin que nada estuviera mal.

### 2.4 «Cero ⚠» no demuestra seguridad

**Aceptado.** Quité la rama que clasificaba como «ayudante puro» a una
`SECURITY DEFINER` por venir declarada `IMMUTABLE`: eso es una declaración del
programador, PostgreSQL no comprueba que no lea tablas.

Y dejé escrito en `docs/radiografia-permisos.sql` que aceptar por **nombre** no
protege de que alguien reescriba el cuerpo de una esperada. Comparar firma,
permisos y definición contra una base revisada sigue siendo el escalón
siguiente, **no hecho**.

---

## 3. Una corrección mía y dos hallazgos propios

### 3.1 Generalicé «las cuatro» y estaba mal

Afirmé que las cuatro funciones marcadas en ⚠ no se podían cerrar. Tu matiz era
correcto. Lo verifiqué política por política (con parseo multilínea, el grep
simple daba 0 falsos):

| función | políticas que la llaman | ¿se puede revocar a anon? |
|---|---|---|
| `es_staff_de` | 9, **sin cláusula `TO`** | no |
| `is_platform_admin` | 62, **sin cláusula `TO`** | no |
| `etaax_puede_neg` | solo `TO authenticated` | **sí** → v73 |
| `etaax_negocio_alcanzable` | solo `TO authenticated` | **sí** → v73 |

Lo que decide es la cláusula `TO`, no el parecido de la función. Una política
se evalúa con el rol del consultante: sin EXECUTE, la consulta pasa de «cero
filas» a `permission denied for function`.

### 3.2 `BEGIN; … ROLLBACK;` puede deshacer la propia migración

No estaba en tu lista. La v70 cerraba con ese bloque para que sus pruebas no
dejaran rastro. Si el editor de Supabase ya tiene una transacción abierta, ese
`ROLLBACK` deshace **también los `CREATE OR REPLACE` de arriba**: la migración
se ve correr sin haber cambiado nada.

La v73 no lleva transacción —sus pruebas solo leen— y **comprueba si la v70
quedó aplicada** mirando la definición viva (renglón 7). Salió PASA: no hizo
falta recorrerla.

### 3.3 El aviso del editor se quita, no se ignora

Al correr la primera v73, Supabase avisaba de «operaciones destructivas» y de
«crea una tabla sin RLS». Las dos venían de la `CREATE TEMP TABLE` donde
juntaba el informe. Lo del RLS es ruido —una temporal vive en la sesión y
PostgREST no la ve— y la respuesta correcta era «Ejecutar sin RLS».

No la tomé: acostumbrarse a pasar por encima de un aviso es como se cuela el
que sí importa. Los renglones viajan ahora en una variable de sesión y se
despliegan con `jsonb_array_elements`. Misma tabla en Results, sin DDL.

(Queda un aviso y es legítimo: la migración revoca permisos a propósito.)

---

## 4. Verificación en producción

Siete renglones, todos PASA. Lo importante no es el conteo sino **que los
rechazos tengan códigos distintos**:

| # | prueba | resultado | detalle |
|---|---|---|---|
| 1 | Un anónimo NO ve el cobro | PASA | `42501` permiso denegado |
| 2 | El dueño SÍ ve su cobro | PASA | `{activo:true, estado:activa, proximoCobro:2026-11-01}` |
| 3 | El staff SÍ ve el cobro de SU negocio | PASA | mismo objeto |
| 4 | Una cuenta ajena NO ve ese cobro | PASA | `P0001` no autorizado |
| 5 | anon ya no puede llamar `etaax_puede_neg` | PASA | |
| 6 | `es_staff_de` SIGUE abierta | PASA | |
| 7 | La v70 quedó aplicada | PASA | las 4 definiciones vivas llevan `IS NOT TRUE` |

**El 1 y el 4 rechazan por motivos distintos y eso es la prueba de que son dos
defensas independientes**: al anónimo lo para el permiso y nunca entra a la
función; la cuenta ajena **sí tiene EXECUTE**, entra, y la para la comprobación
de pertenencia. Si las dos hubieran dado el mismo código, una de las dos
estaría de adorno.

De v71 y v72 no tengo su tabla de comprobación de vuelta, pero su efecto está
verificado indirectamente: la radiografía de la v72 ya no lista
`entrada_token_asegurar`, `menu_token_*`, `menu_cfg_guardar` (v71) ni
`negocio_*` (v72) entre lo que `anon` puede ejecutar.

**Lo que no está verificado por mí:** nada de esto lo comprobé con una conexión
independiente; los resultados son los que devolvió el editor de Supabase en la
sesión de Edwin.

---

## 5. Candado

`money-tests` **3990** comprobaciones, 0 fallas · `store-tests` 36/0.
**20 mutaciones en este lote, 20 cazadas.** Suites: BH49 (R01), BH50 (permisos
y NULL).

Mutaciones que valen por lo que protegen, no por el número:
- revocar **de más** (apagar la carta pública, dejar al encargado sin generar
  el QR, quitarle a anon la función que sube las fotos del QR): 4 mutaciones;
- devolver «inactivo» en vez de lanzar;
- aceptar más códigos de error como rechazo válido;
- que la cuenta «ajena» pueda caer en el admin;
- que la comprobación vuelva a envolverse en una transacción;
- que `IMMUTABLE` vuelva a contar como prueba de pureza.

Tres se me escaparon al primer intento y las tres por lo mismo que vienes
señalando: la prueba leía el archivo en vez de medir comportamiento, o
encontraba su propio comentario. Reglas escritas en el código: quitar
comentarios SQL antes de medir; acotar a la función o a la regla, nunca al
archivo entero; fixture que arranque en el estado **contrario** al esperado;
y una sola copia del código bajo prueba.

---

## 6. Qué me interesa que revises

1. **La decisión de lanzar en vez de devolver falso** (§2.2). Mi razonamiento
   es que `false` es una respuesta semánticamente distinta y filtra igual. Si
   ves un llamador que no tolere la excepción, es el punto a tumbar.
2. **El guardia usa `etaax_negocio_alcanzable`**, que a su vez es
   `SECURITY DEFINER`. No veo recursión problemática —`negocio_cobro_estado`
   llama a `negocio_esta_activo`, que vuelve a comprobar— pero es trabajo
   duplicado en cada llamada. ¿Lo simplificarías?
3. **`es_staff_de` e `is_platform_admin` abiertas a anon** por las políticas sin
   `TO`. Tu alternativa de moverlas a un esquema no expuesto me parece el
   camino correcto a futuro; antes de intentarlo quiero saber si ves riesgo en
   que las políticas existentes dejen de resolverlas.
4. **La radiografía acepta por nombre** (§2.4). ¿Qué forma de base revisada
   propondrías —hash de `pg_get_functiondef`, o firma + grants— sin que se
   vuelva un archivo que nadie actualiza?

---

## 7. Siguiente bloque propuesto

**R12/R13**: `financiero/resumen.html:219` define su propio `_deSuc` que acepta
los registros sin `sucursalId` en **todas** las sucursales, contra
`EtaaxCore.scopeSuc` y `financiero/kpis.html:537` que los asignan a
`suc_principal`; y `cargar()` (líneas 193–214) convierte `data = null` en `[]`
sin mirar `error`, así que una consulta fallida se presenta como ceros.

Son baratos, no tocan esquema y están ensuciando el P&L hoy.
