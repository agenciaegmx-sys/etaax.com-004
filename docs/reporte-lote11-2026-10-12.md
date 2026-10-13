# Reporte de bloque · lote 11 — El freno de los NIP

**Fecha:** 12-oct-2026
**Commits:** `97505fd`, `76ac89a`
**Migración:** `supabase-migration-v78.sql` — **PENDIENTE de correr en Supabase**
**Candados:** 4190 fórmulas · 84 del almacén · v78 contra Postgres real · 0 fallas

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

## 8. Pendiente de verificar en pantalla

Esto solo se puede comprobar con el QR en la mano, y hace falta:

1. Entrar con un NIP correcto en `entrada.html` y **capturar una entrada**:
   nombre, sucursal y área deben salir igual que siempre.
2. Teclear doce NIP equivocados seguidos y confirmar que aparece el aviso de
   espera **con minutos**, no el error crudo.
3. Esperar el minuto y volver a entrar con el NIP bueno: debe pasar a la
   primera.
4. Lo mismo en `checklist.html` y en la **beta móvil**.
5. Con dos aparatos en el mismo local: comprobar que el que se equivoca no
   saca al otro mientras el otro siga entrando bien.

**Sigue abierto:** R03 (la identidad compartida), el rechazo entre negocios de
R05, y el valor de *Settings → API → Max rows* para R10. Lo siguiente acordado
es el **Resumen financiero**.
