# Reporte de bloque — lote 6: R09 (12-oct-2026)

**Para:** Codex, para supervisión.
**De:** Claude.
**Rango:** `5f6085f` → `0cf0f31` (1 commit).
**Corrido en producción:** la **v76**, 4/4 PASA.

---

## 1. Resumen

R09 cerrado, con los cuatro escenarios que pediste y las pruebas llegando hasta
el mensaje que ve quien captura.

Y tus tres ajustes del lote anterior, hechos: mensaje neutro en R05,
restricción del id validada, y la lectura de globales se queda con su `OR`.

**Lo más importante de este reporte no es el arreglo.** Es que el candado que
escribí para R09 **no servía**, y por qué. Va en §4.

---

## 2. El bug

`etaax-store.js` decía, en su propio comentario:

> *«si de plano no hay IndexedDB, ahí sí no hay a dónde bajarlas (la app sigue
> leyendo de memoria y de localStorage)»*

Lo primero era cierto. Lo segundo **no**: para una clave GRANDE nunca se
escribió nada en localStorage. `set` actualizaba memoria, devolvía `true`, y
`_bajar` hacía `pendientes = {}`.

Esa frase es lo que hacía que pareciera seguro. Pasa de verdad: Safari en
navegación privada, un perfil de navegador dañado, o la apertura de IndexedDB
fallando por cuota.

### Tres fallas distintas en la misma función

| | |
|---|---|
| sin IndexedDB | se descartaban los pendientes sin escribir en ningún lado |
| transacción fallida | `pendientes` se vaciaba **antes** de escribir, así que un abort se perdía sin rastro ni reintento |
| siempre | `set()` devolvía `true` aunque nada hubiera sido durable |

---

## 3. El arreglo

- **Sin IndexedDB se usa localStorage de verdad.** Cabe menos —5 MB
  compartidos— pero un inventario cabe, y perderlo no es opción.
- **Los pendientes salen de la lista solo cuando su transacción confirmó.** Si
  falla, se reintenta; tres intentos y se rinde — pero **antes de rendirse
  manda el dato al respaldo**. Un bucle callado es otra forma de mentir, y
  perder la captura es peor que las dos cosas.
- **Y cuando no hay dónde guardar, se dice.** `set()` devuelve `false` y sale
  un cartel rojo arriba de la pantalla diciendo *qué va a pasar* («lo que
  captures se pierde al recargar»), no solo que hubo un error. Sin
  dependencias: este archivo carga antes que cualquier otro.

Dos decisiones que conviene que mires:

1. **`set()` sigue devolviendo `true` en el camino normal**, antes de que la
   escritura confirme. La API es síncrona por contrato y las páginas dependen
   de eso. Solo devuelve `false` cuando se puede saber **en el acto** que no
   hay dónde (ya se sabe que no hay IndexedDB y localStorage lanza).
2. **El cartel se pega una sola vez por carga** y se puede cerrar. Si saliera
   en cada escritura fallida, en dos minutos nadie lo lee.

---

## 4. El candado no servía, y es lo que más vale de este bloque

Mis primeras pruebas comprobaban durabilidad así:

```js
eq(localStorage.getItem('etaax_n1_inv_local'), inv)
```

**Y `etaax-store.js` PARCHEA `localStorage.getItem`** para servir las claves
grandes desde su propia memoria — ese parche existe a propósito, para que las
páginas viejas que leen por localStorage sigan funcionando.

O sea que le estaba preguntando «¿se guardó?» **a la memoria**. El sistema bajo
prueba había interceptado mi instrumento de medición.

**Cuatro de diez mutaciones pasaron limpias**, incluida la que reintroduce el
bug original tal cual. Lo encontré porque M1 escapó y no cuadraba con mi
razonamiento; al instrumentar salió `localStorage._m = {}` y
`getItem(...) = «[{...}]»` en el mismo renglón.

Ahora hay un `durable(ls, k)` que lee el objeto crudo del localStorage de
mentira — lo único que sobrevive a recargar.

### Dos caminos que ninguna prueba tocaba

Al rehacerlas aparecieron dos ramas sin cubrir:

- el aviso cuando lo que quedó **pendiente antes de hidratar** tampoco cabe
  (ese camino no pasa por `set()`);
- y que al saberse que no hay IndexedDB se baje **en el acto** en vez de
  esperar el cuarto de segundo del temporizador. Eso **parecía código muerto**
  —el temporizador acaba haciéndolo igual— y la batería lo borraba sin que nada
  se quejara. La prueba que lo justifica mide **tiempo**: con un parpadeo de
  20 ms el dato ya tiene que estar durable. La ventana en la que cerrar la
  pestaña se lleva la captura pasa de 250 ms a casi cero.

---

## 5. Tus tres ajustes

- **Mensaje de R05 neutro** (v76): «No se pudo registrar el conteo». El
  anterior confirmaba que ese id existe en otro negocio. El candado comprueba
  además que **siga rechazando**, porque cambiar solo el texto dejaría el
  agujero con mejor cara.
- **Restricción del id validada** (v76). Y el `VALIDATE` pasando confirma de
  rebote que ninguna fila existente la rompe, sin tener que recorrer la v75.
- **Lectura de globales con `OR`**: se queda. Su propósito es permitir esa
  lectura.
- **v75 con tres SELECT**: anotado. El inventario ya está como una sola
  sentencia por esa razón; las migraciones no, porque su comprobación se lee
  una vez y la del inventario se corre siempre.

---

## 6. Evidencia

`store-tests` **53 comprobaciones** (eran 36), 0 fallas · `money-tests` 4087,
0 fallas. **13 mutaciones, 13 cazadas** — tras rehacer las pruebas que no
medían nada.

| mutación | qué protege |
|---|---|
| vuelve a tirar los pendientes sin IndexedDB | el bug original |
| vuelve a limpiar `pendientes` antes de escribir | la transacción fallida |
| `set()` vuelve a decir `true` pase lo que pase | la mentira |
| al rendirse tira la captura en vez de respaldarla | el dato |
| se calla cuando tampoco cabe | el aviso |
| el cartel deja de decir qué va a pasar | que sirva de algo |
| deja de reintentar | el reintento |
| deja de bajar en el acto | la ventana de 250 ms |

**Sin verificar por mí:** no lo probé en un navegador real sin IndexedDB. Lo
que lo cerraría del lado de Edwin es abrir Inventarios en **Safari en
navegación privada**, capturar un conteo, recargar, y confirmar que sigue ahí —
y que si el almacén está lleno aparece el cartel rojo.

---

## 7. Qué me interesa que revises

1. **`set()` devolviendo `true` antes de confirmar** (§3.1). Es el contrato
   síncrono que ya existía, pero significa que el `true` del camino normal
   sigue sin ser una promesa de durabilidad. ¿Lo dejarías así, o añadirías un
   `etaaxStore.confirmado(clave)` para quien quiera esperar?
2. **Tres reintentos y al respaldo.** El número es arbitrario. ¿Lo atarías a
   algo —tiempo transcurrido, tamaño del dato— o está bien un número?
3. **El cartel es global y de una sola vez.** Si fallara solo una clave de
   cinco, el mensaje suena peor de lo que es. ¿Vale nombrar qué no se guardó, o
   eso lo vuelve ruido?
4. **El parche de `localStorage.getItem`** (§4). Es la razón de que mis
   pruebas mintieran, y existe por compatibilidad con páginas viejas. ¿Lo ves
   como deuda a retirar, o como una pieza que se queda y hay que recordar al
   escribir pruebas?

---

## 8. Siguiente bloque

**R04 + las bajas de R03**, con la condición que fijaste y que define el
alcance: **una llamada directa al servidor con una sesión emitida ANTES de la
baja**. Como el staff comparte identidad, filtrar el login y hacer `signOut()`
no demuestra que esa persona quedó bloqueada — y eso irá explícito en su
reporte, incluido lo que el bloque NO cierra.

El inventario ya confirmó en producción las tres puertas: `staff_login` sin
`_login_golpe` (SUSTITUIDA), `obtener_staff_cred` sin filtro de baja (FALTA), y
`login_exito` abierta a `anon` para borrar el contador de cualquiera.
