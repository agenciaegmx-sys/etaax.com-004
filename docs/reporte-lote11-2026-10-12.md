# Reporte de bloque · lote 11 — El freno de los NIP

**Fecha:** 12-oct-2026
**Commits:** `97505fd`, `76ac89a`, `c8e58db`, `8c4e475`
**Migraciones:** `v78` **CORRIDA** (8 PASA + 1 DATO) · `v79` **CORRIDA** (8 PASA)
**Verificado en pantalla por Edwin**, en producción y desde un teléfono real
**Candados:** 4206 fórmulas · 84 del almacén · v78+v79 contra Postgres real · 0 fallas

---

## 1. Qué había

Un NIP son **cinco dígitos**: cien mil combinaciones. Un programa las prueba
todas en un par de horas, de noche, sin que nadie se entere. El token del QR no
protege de eso — lo tiene cualquiera que haya visto el código pegado en la
pared.

El inventario encontró **diez funciones públicas que aceptan un NIP**, todas
concedidas a `anon`. Solo una tenía freno —`entrada_validar_nip`— y era el
equivocado: contaba **por negocio y sin IP**, así que un teléfono desde la
calle podía dejar sin QR al local entero.

| Función | Comprueba el NIP | Freno antes |
|---|---|---|
| `entrada_validar_nip` | propio | sí, pero por negocio sin IP |
| `portal_perfil` | propio | no |
| `entrada_sucursal_de_nip` | propio | no |
| `entrada_historial` | propio | no |
| `entrada_registrar` | delega en `entrada_validar_nip` | — |
| `checklist_registrar` | delega en `entrada_validar_nip` | — |
| `inventario_conteo_registrar` | delega en `entrada_validar_nip` | — |
| `portal_recetas` | delega en `portal_perfil` | — |
| `portal_guias` | delega en `portal_perfil` | — |
| `checklist_plantillas` | delega en `portal_perfil` | — |

**Las diez son un embudo.** Por eso se tocan cuatro y no diez: ponerle guardia
propio a las seis que delegan contaría **dos fallos por un solo intento**, y la
espera llegaría al doble de rápido de lo documentado.

---

## 2. El guardia

`_nip_guardia(negocio, niphash)`, llamado como primera línea de las cuatro.
Hace tres cosas en este orden:

1. **¿Está frenado?** → se queja con `nip_espera:<segundos>`, diciendo cuántos
   faltan.
2. **¿El NIP es de alguien activo de ese negocio?** → limpia el contador y deja
   pasar.
3. **Si no** → anota un fallo y dice que no.

**Comprueba el NIP él mismo, y eso es lo que mantiene vivo el QR.** Entrar no
es una llamada: son varias seguidas con el mismo NIP (validar, perfil, recetas,
guías, checklists…). Si cada una gastara un intento, una persona legítima se
quedaría fuera a la tercera entrada del día. Al comprobar, el guardia sabe
distinguir un dedazo de un acierto: **solo cuenta los fallos**, y cualquier
acierto borra lo anterior.

### El límite y la espera

```
Ventana: 15 minutos sin fallar y se olvida todo.
A partir del fallo 12 hay que esperar, y la espera crece si se insiste:
    12 fallos →  1 minuto        18 fallos → 15 minutos
    15 fallos →  5 minutos       24 fallos →  1 hora
```

Doce dedazos seguidos, sin un solo acierto en medio, en menos de quince
minutos: eso ya no es teclear mal.

### La llave del contador: negocio + IP

Ni el NIP probado ni la función llamada entran en la llave, **a propósito**: si
entraran, bastaría cambiar de NIP —que es literalmente lo que hace quien
adivina— o llamar a otra de las diez para empezar de cero.

**Cómo se evita bloquear al negocio entero por los errores de una persona:** la
IP. Sin ella el contador sería por negocio a secas, y un teléfono desde la
calle dejaría al restaurante sin QR. Con ella, quien se equivoca se frena a sí
mismo.

**Lo que esto NO resuelve, dicho claro:** las tablets de un mismo local salen
por la misma IP, así que alguien adentro puede frenar a los de adentro.
Necesita doce fallos seguidos **sin que nadie acierte en medio**, porque
cualquier acierto limpia el contador — en un local operando, eso no pasa solo.
Es el precio elegido, y es el barato de los dos.

---

## 3. Cómo se metió el guardia sin romper nada

**Los cuerpos de las cuatro funciones no se retranscribieron.** Salen del repo
tal cual y solo se les antepone una línea. Esto no es comodidad: así fue como
la v63 perdió el freno de `staff_login` —reescribiéndolo desde cero para
arreglar otra cosa— y nadie lo notó en cuatro meses, porque la función siguió
contestando bien.

El candado lo comprueba **línea por línea**: toma la definición anterior de
cada una y verifica que no falte ninguna en la nueva. Las dos únicas salidas
son a propósito y están nombradas: el freno viejo de `entrada_validar_nip` y
la cabecera.

Dos cambios de cabecera, cada uno con su razón:

- `portal_perfil` y `entrada_sucursal_de_nip` eran `LANGUAGE sql` (una sola
  consulta). Se envuelven en plpgsql **sin tocar la consulta** —va entera entre
  paréntesis— porque el guardia tiene que correr ANTES, y una condición más en
  el `WHERE` ni siquiera garantiza que se evalúe.
- Las cuatro quedan `VOLATILE`: el guardia escribe el contador, y una función
  `STABLE` puede ser cacheada por el planificador dentro de una consulta.

Y un contrato que casi rompo: `entrada_historial` **no devuelve NULL** cuando
el NIP no vale, devuelve `{ok:false, motivo:'nip'}` — que es lo que lee
`entrada.html` para decir «Tu NIP ya no es válido. Vuelve a entrar.». El
guardia lo respeta. Lo cazó la prueba de PGlite, no la lectura.

---

## 4. Lo que ve la persona

Sin esto, quien se frena vería: *«No se pudo validar. nip_espera:47 — ¿se
corrió la migración v27 en Supabase?»*. No le dice nada y además miente.

Ahora ve: **«Demasiados intentos con NIP equivocado. Espera unos 2 minutos e
inténtalo de nuevo.»** más la aclaración de que no hace falta recargar.

El ayudante vive en `staff-area.js`, que ya cargan las tres pantallas que
hablan por NIP: `entrada.html`, `checklist.html` y la app móvil. Una copia por
pantalla es una pantalla que un día dirá otra cosa, y será la que nadie abrió
en meses.

En `entrada.html` el aviso también cubre el **guardado de una entrada ya
estando dentro**: si otro aparato del mismo lugar se puso a probar NIP, el
freno alcanza a quien ya estaba trabajando, y tiene que entender que no perdió
lo capturado.

El hub tiene su propio redondeo de tiempo («un minuto», no «60 segundos»)
porque no comparte archivo con las pantallas del QR. El candado **corre los
dos** sobre los mismos valores para que no se separen.

---

## 5. Prueba de ejecución real (PGlite)

`tests/probar-sql-v78.mjs`. Primero se provoca el agujero con las definiciones
que hay **hoy** en producción, luego se corre la migración tal cual, luego se
repite el ataque.

**Antes:** 500 NIP distintos, uno tras otro, sin una sola queja.

**Después:**

| Escenario | Resultado |
|---|---|
| Intentos fallidos y bloqueo | se topa en el intento 13 y dice «faltan 60 s» |
| Evasión: cambiar de función | `portal_perfil`, `entrada_sucursal_de_nip`, `entrada_historial`, `portal_recetas` y `entrada_registrar` siguen frenados |
| Evasión: cambiar de NIP | sigue frenado |
| Otro dispositivo (otra IP) | entra normal — no se bloquea el local |
| Recuperación tras la espera | el NIP bueno vuelve a entrar, y acertar deja el contador en cero |
| **Uso legítimo** | **160 llamadas seguidas con el NIP correcto y no gastan ni un intento** |
| Sucursal y área | el perfil las sigue trayendo |
| Quién captura | la entrada sigue quedando registrada a nombre de Ana |
| Historial | sigue respondiendo, y con NIP inválido sigue diciendo el motivo |
| Dado de baja | sigue sin pasar |
| Sin token del QR | sigue sin pasar |
| Permisos | `anon` puede llamar las puertas; **no** puede llamar al guardia |

```
mkdir -p /tmp/pglite && cd /tmp/pglite && npm init -y && npm install @electric-sql/pglite
PGLITE_DIR=/tmp/pglite node tests/probar-sql-v78.mjs
```

---

## 6. Batería de mutaciones — 10

Commit primero, mutar después, restaurar con copia propia.

| | Mutación | Cazada por |
|---|---|---|
| N1 | a `portal_perfil` se le quita el guardia | candado + Postgres |
| N2 | la llave incluye el NIP probado | Postgres (10 fallas) |
| N3 | cuenta también los aciertos | Postgres |
| N4 | la escalera empieza mucho después | candado + Postgres |
| N5 | el guardia deja de mirar el estado | candado |
| N6 | se le cierra el QR a `anon` | candado + Postgres |
| N7 | `entrada_historial` pierde su contrato | candado + Postgres |
| N8 | la pantalla deja de avisar | candado |
| N9 | el ayudante confunde cualquier error con un freno | candado |
| N10 | **aparece una puerta ONCE sin guardia** | candado |

**Tres se escaparon en la primera vuelta, y las tres eran debilidades de mis
pruebas, no del freno:**

- N8 pasaba porque el candado buscaba el aviso en **todo el archivo**, y
  `entrada.html` lo usa en dos sitios: quitarlo de la puerta no movía nada.
  Ahora se exige **donde se entra**.
- N9 pasaba porque el error de control no tenía dígitos: un ayudante que
  confundiera *cualquier* número con un freno pasaba igual. El control ahora
  lleva números.
- N2 era una mutación mal escrita por mí (no cambiaba el comportamiento).
  Reescrita, Postgres la caza con diez fallas.

El N10 es el que más me importa: **simula que alguien agrega mañana una puerta
número once y se olvida del guardia.** El candado la encuentra sola.

---

## 7. Para Supabase

La comprobación va en una sola instrucción al final del archivo (el editor solo
enseña la última). Nueve renglones; **los tres primeros no leen definiciones:
corren el guardia.**

```
1 · el freno PARA de verdad al que adivina          PASA  frenó en el intento 13, pide esperar 60 s
2 · cumplida la espera, se puede volver a intentar  PASA
3 · el uso legítimo NO gasta intentos               PASA  el NIP bueno pasa, no gasta intentos y limpia
4 · las 4 puertas llaman al guardia                 PASA  4 de 4
5 · las otras puertas siguen delegando              PASA  (en producción: 6 de 6 instaladas)
6 · el QR sigue pudiendo llamarlas sin sesión       PASA  validar/perfil/historial/recetas = true
7 · el guardia NO se puede llamar directo           PASA  anon=false
8 · el dado de baja sigue sin pasar                 PASA  ventana de 15 minutos = true
9 · cuántos negocios están frenados AHORA           DATO
```

Las tres sondas se quedan puestas y **sin permisos para nadie** (si el `DROP`
fuera la última instrucción, el editor enseñaría el resultado del DROP —nada—
y la tabla no se vería). El `DROP` para borrarlas a mano está escrito en el
archivo. La v78 **no toca datos** y es idempotente.

---

## 8. Verificado en pantalla — HECHO

Lo que ni PGlite ni el candado podían dar, y Edwin comprobó en producción desde
un teléfono:

- Con NIP equivocados seguidos, la pantalla muestra **«Demasiados intentos con
  NIP equivocado. Espera un minuto e inténtalo de nuevo»** más «no hace falta
  recargar» — no el error crudo del servidor.
- **Cumplida la espera, el NIP bueno entra a la primera.** Esta es la mitad que
  importa: un freno que no se levanta deja fuera a quien no debe.
- **Las entradas se registran bien** después de entrar.

Lo que se comprobó, paso a paso:

1. Entrar con un NIP correcto en `entrada.html` y **capturar una entrada**:
   nombre, sucursal y área deben salir igual que siempre.
2. Teclear NIP equivocados seguidos: **el aviso de espera sale en el intento
   13**, no en el 12 — el 12 todavía devuelve el rechazo normal. (Lo corrigió
   Codex: yo había escrito «doce».)
3. Esperar el minuto y volver a entrar con el NIP bueno: debe pasar a la
   primera.
4. Lo mismo en `checklist.html` y en la **beta móvil**.
5. **Hacer estas pruebas fuera de la operación**, con un negocio de prueba o en
   el arnés. Dos aparatos en el mismo Wi-Fi **comparten contador**, y alcanzado
   el límite el guardia rechaza también el NIP correcto hasta que venza la
   espera. Mi instrucción anterior —«el que se equivoca no saca al otro»— era
   incorrecta y describía un diseño que no es el que se construyó. Que el
   bloqueo alcance también al NIP correcto es a propósito: si el correcto
   pasara durante el bloqueo, el freno se convertiría en un detector perfecto
   —el que adivina sabría cuál acertó por la respuesta— y no serviría de nada.

---

## 9. Lo que Codex encontró supervisando, y que la v79 arregla

Las 4190 comprobaciones pasaban y la tabla de la v78 salió 8 PASA. **Aun así
había dos agujeros**, y los dos dejaban seguir adivinando.

### 9.1 Una excepción se lleva por delante el fallo que acabas de anotar

Las tres puertas que **escriben** —entradas, check lists y conteos— rechazaban
con `RAISE EXCEPTION 'no autorizado'` después de que el guardia ya había
anotado el intento. En PostgreSQL **una excepción revierte la transacción
entera**, y el apunte iba dentro. Resultado medido por Codex: 30 NIP distintos
por cada una, **30 rechazos, 0 bloqueos, contador vacío**.

El arreglo son tres líneas —`RETURN NULL` en vez del `RAISE`— pero **obligaba a
tocar el cliente en el mismo lote**: las cinco llamadas miraban solo `r.error`,
así que un rechazo se habría visto como «guardado» y la captura se habría
borrado de la lista. El usuario habría perdido su trabajo creyendo que lo
mandó. La regla vive ahora en `etaaxRegistroFallo` (staff-area.js).

**Por qué mi prueba no lo vio, que es lo que más vale de este hallazgo:**
probaba esas tres puertas **cuando el contador ya estaba bloqueado desde otra
función**. Eso demuestra que *obedecen* un bloqueo, no que lo *provoquen*.
Regla nueva: **toda puerta se prueba desde el contador en cero.**

### 9.2 La espera de una hora se evaporaba a los quince minutos

Un solo plazo hacía dos trabajos distintos: cuánto hay que esperar y cuándo se
olvidan los fallos. Como los fallos se olvidaban a los 15 minutos, un castigo
de 60 no llegaba vivo al minuto 16. Ahora son dos plazos: el bloqueo dura lo
que dice la escalera, y el olvido nunca llega antes que el castigo.

### 9.3 El aviso de espera se preparaba y se tiraba

Al guardar un lote, `entrada.html` calculaba el mensaje amigable y luego
mostraba solo «fallaron, reintenta». Quien estaba frenado reintentaba, y cada
reintento alargaba su propia espera. Ahora dice por qué.

### Lo que se probó

Contra Postgres de verdad: los dos agujeros **provocados antes** (30 NIP por
puerta sin un solo bloqueo; la hora evaporándose al minuto 16) y **cerrados
después** — cada puerta frenando en el intento 13 **por sí sola**, los cuatro
escalones comprobados a 10 segundos de su límite por los dos lados, el olvido
tras cumplir el castigo, y el rechazo de R05 intacto.

**Batería: 9 mutaciones.** Dos se escaparon en la primera vuelta:

- **P6** pasó porque el comentario que explica el arreglo **nombra al
  ayudante**: quitar la llamada y dejar el comentario dejaba la prueba verde.
  La prueba se cazaba a sí misma — van doce veces con ese patrón aquí. Ahora se
  mide sin comentarios.
- **P4** pasó porque la prueba de «acertar no deja intentos» corría sobre un
  contador **vacío**. Ahora arranca sucio, con siete fallos puestos a mano.

Y una honesta: **P2 no es observable**. Mutar el plazo de olvido a un valor
fijo no cambia nada hoy, porque el bloqueo se comprueba antes de llegar al
apunte. El `GREATEST` es defensa en profundidad, no un bug vivo, y lo cuida el
candado por texto. Lo digo en vez de inventarle un escenario.

---

---

## 10. Resultado en producción de la v79

Los ocho renglones PASA, y **clavados con lo que había predicho la corrida
local contra PGlite** — que es lo que le da valor al arnés:

```
1 · registrar una ENTRADA con NIP malo sí acumula fallos     PASA  frenó en el intento 13
2 · registrar un CHECK LIST con NIP malo sí acumula fallos   PASA  frenó en el intento 13
3 · registrar un CONTEO con NIP malo sí acumula fallos       PASA  frenó en el intento 13
4 · la espera de una hora NO se evapora a los 15 minutos     PASA  sigue frenado, faltan 44 minutos
5 · …y cumplido el castigo, sí se olvida                     PASA  el contador empieza de nuevo
6 · ninguna de las tres rechaza ya con una excepción         PASA  las tres devuelven NULL
7 · el conteo de OTRO negocio se sigue rechazando (R05)      PASA  esa excepción sí se queda
8 · el QR sigue pudiendo llamar las tres sin sesión (anon)   PASA  entradas/checklists/conteos = true
```

**R04 queda cerrado completo:** servidor, cliente y pantalla.

---

## 11. Estado y lo que sigue

**Cerrado en este bloque:** R04 (freno de intentos de NIP, diez puertas).

**Sigue abierto:**

- **R03** — la identidad compartida. La v77 logró que un dado de baja no
  consiga sesión nueva; lo que no se puede, mientras la cuenta sea una sola,
  es cortar la que ya tiene. Cerrarlo es rotar la contraseña en cada baja, y
  eso necesita la Edge Function de credenciales, todavía sin desplegar.
- **R05** — falta probar el rechazo contra un id de otro negocio con un intento
  deliberado (la ruta legítima ya se probó en el QR real).
- **R10** — falta el valor de *Settings → API → Max rows*. No es un trámite:
  mientras no se sepa, no se puede afirmar que un reporte financiero esté
  leyendo todas sus filas.
- R07, R08, R11, R14.

**Lo siguiente** es el **Resumen financiero**, pendiente de que Edwin diga qué
quiere de esa pantalla antes de tocarla.
