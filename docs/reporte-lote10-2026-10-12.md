# Reporte de bloque · lote 10 — R04 + las bajas de R03

**Fecha:** 12-oct-2026
**Commits:** `e64c015`, `0b8008a`, `cf7ef4a`, `5ff8c43`, `0d21623`
**Migración:** `supabase-migration-v77.sql` — **CORRIDA en producción**, 5 PASA + 1 DATO
**Candados:** 4132 fórmulas · 84 del almacén · 0 fallas

---

## 0. Lo que este bloque NO cierra

**R03 sigue abierto.** Mientras los colaboradores de un negocio compartan una
sola identidad en la nube —la cuenta `staff.<negocio>@etaax.app` de la v19—,
dar de baja a UNA persona no se puede demostrar del lado del servidor: su
sesión es indistinguible de la de sus compañeros.

**Lo que la v77 logra es que no consiga una sesión nueva. Nada más.** Lo digo
así de seco porque en la primera versión de este reporte escribí de más, y
Codex lo corrigió con razón:

- **Cerrar el navegador borra nuestra copia** de la sesión (vive en
  sessionStorage). **No invalida un token que alguien ya haya copiado:** un
  access token de Supabase sirve hasta que vence, y ese plazo lo fija el
  proyecto en *Auth → Sessions*.
- **Rotar la contraseña compartida impide EMITIR tokens nuevos; no mata los ya
  emitidos.** El corte es «ya no vuelve a entrar», no «se cae ahora mismo».
- Quien se haya guardado la contraseña compartida **puede intentar entrar
  directo**, sin pasar por nuestro login, hasta que se rote.
- Y un equipo que no vuelva a sincronizar la lista de staff tampoco se entera
  de la baja.

Lo que sí acorta la ventana es **bajar la vigencia del token** en Supabase —
pendiente de revisar ese valor. Y cerrar el caso de verdad es rotar la
contraseña en cada baja, que necesita la Edge Function de credenciales,
todavía sin desplegar.

**Esta tabla no demuestra el rechazo de una sesión anterior a la baja**, y no
puede: eso necesita producción y una sesión real. Los pasos están en la
sección 5.

**Encontrado y no tocado:** `portal_perfil` y `entrada_sucursal_de_nip` (v65)
autentican por NIP —cuatro dígitos— y **nunca tuvieron freno de intentos**. No
va en este lote porque son la superficie pública del QR y el freno les cambia
la forma de contestar. Va antes de ampliar las pruebas de acceso por QR, como
pidió Codex.

---

## 1. Las tres puertas cerradas en el servidor (v77)

### 1.1 `staff_login` había perdido el freno de intentos — R04

La v30 le puso 10 intentos por 15 minutos, en `plpgsql` justamente para poder
llamar `_login_golpe` antes de mirar la contraseña. La v63 vino a arreglar otra
cosa —el dado de baja que seguía entrando—, la reescribió en `LANGUAGE sql` y
se llevó el freno.

Lo que importa no es el parche: es por qué nadie lo vio en cuatro meses. **La
función siguió haciendo perfectamente lo suyo.** Dice sí cuando la contraseña
es buena y no cuando no. Solo dejó de contar: sin error, sin cambio de
respuesta, sin síntoma.

La regla que saco: **una función que autentica no se reescribe desde cero.** Se
parte de su última definición y se cambia solo la línea que se vino a cambiar.

La v77 la devuelve a `plpgsql` con el freno y el candado de estado juntos, y
con `IS NOT TRUE` en vez de `NOT (...)`: en SQL `NOT(NULL)` es `NULL`, el `IF`
no se cumple y el bloqueo **se salta** — el mismo agujero de la v70.

### 1.2 `obtener_staff_cred` nunca miró el estado — R03

Entrega la credencial de la cuenta compartida a cambio del hash de **cualquier**
colaborador del negocio. La v63 le puso el candado a las tres funciones que
autentican y a esta no, porque no parece una de ellas. Lo es, y es la peor: la
llave que da es la de todos. El efecto neto era cerrarle la puerta de enfrente
al dado de baja y dejarle la de atrás.

### 1.3 `login_exito` la llamaba cualquiera, para cualquier cuenta — R04

El freno de la v56 escala la espera (5 fallos → 1 min, 6 → 5, 7 → 15, 8 → 60) y
`login_exito(ident)` borra el contador de ese identificador, concedida a `anon`
**sin pedir prueba de haber entrado**. La escalera era decorativa: fallo,
`login_exito('victima@x.com')`, fallo. El contador nunca pasaba de 1. Y servía
para desbloquear a quien sí estaba frenado.

Ahora exige sesión y que el identificador sea el de esa sesión (`auth.uid()` +
el correo del JWT), y a `anon` se le quita **nombrándolo** — en Supabase toda
función de `public` nace con EXECUTE concedido a `anon` por GRANT directo, así
que `REVOKE … FROM PUBLIC` no se lo quita (hallazgo de la v71).

**El colaborador no quedó sin reinicio:** lo hace el servidor dentro de
`staff_login`, el único lugar donde consta que la contraseña era buena. Sin eso,
quien teclea mal cinco veces y luego bien se quedaría esperando una hora, y
nadie relacionaría nunca ese síntoma con este cambio.

### Lo que salió al correrla

```
1 · staff_login FRENA de verdad los intentos (no solo lo dice)   PASA   frenó en el intento 11
2 · anon NO puede borrar el contador de nadie (login_exito)      PASA   anon=false · con sesión=true
3 · login_exito exige que el identificador sea el de TU sesión   PASA   sesión=true correo=true coincide=true
4 · la credencial compartida pide estar ACTIVO                   PASA   y sigue con freno de intentos=true
5 · staff_login sigue bloqueando al dado de baja (v63)           PASA   y reinicia los DOS contadores=true
6 · personas dadas de baja que YA NO consiguen la llave          DATO   1 de 107 colaboradores
```

El renglón 1 no lee la definición: le tira 12 intentos fallidos con un usuario
inexistente y dice en cuál frenó. La sonda `_v77_probar_freno()` **queda
puesta** —si el `DROP` fuera la última instrucción, el editor enseñaría el
resultado del DROP, nada, y la tabla no se vería— y queda sin permisos para
nadie.

---

## 2. El cliente

| Qué | Dónde | Por qué |
|---|---|---|
| Regla única de alta/baja | `security.js` → `etaaxStaffActivo` | El login tiene dos caminos (caché local y nube). Si no aplican la misma regla aceptan a distinta gente, y manda el permisivo — que siempre es el que se quedó sin actualizar. |
| La baja aplica también por caché | `hub.html`, intento 2 | Ese camino valida contra la lista del equipo sin preguntarle a nadie: el candado del servidor no lo alcanzaba. |
| `continue`, no `return` | ídem | El mismo usuario puede existir en otro negocio donde sí esté activo. Con `return`, la baja en uno le quitaba el acceso al otro, y se veía igual que «contraseña incorrecta». |
| El candado va DESPUÉS de verificar el hash | ídem | Antes sería un buscador de usuarios. |
| Reinicio del contador con prueba | ídem | El cliente ya no puede borrarlo: se le avisa al servidor llamando a `staff_login`, que sí comprueba la contraseña. |

---

## 3. El ajuste que pidió Codex: salir cierra ANTES de borrar

**Tenía razón, y el recorrido estaba peor de lo que se veía desde `ctx-bar.js`.**

La sesión de Supabase vive en `sessionStorage`. Los dos caminos que salen de un
módulo vaciaban el almacenamiento **y después** llamaban al `signOut`, que
llegaba a una sesión que ya no existía:

- `ctxSalir()` hacía `sessionStorage.clear()` y redirigía;
- y el `?salir=1` del hub **también** limpiaba antes de su propio
  `await _supabase.auth.signOut()`.

Así que esa línea existía y no hacía nada — **y el refresh token del dueño se
quedaba sin revocar del lado del servidor** en toda salida desde un módulo, que
es por donde se sale normalmente.

Cómo quedó:

1. **Una sola función decide con qué `scope` se cierra cada quien:**
   `etaaxCerrarSesion(esStaff)` en `security.js`, para las tres puertas. `local`
   para el colaborador —el global revoca la sesión en todos los dispositivos y
   al salir uno se caían todos sus compañeros, que es la razón por la que el hub
   se saltaba el `signOut` de staff— y el normal para el dueño.
2. **Con un reloj en paralelo (2.5 s).** Un `signOut` global sale a la red; en
   una tablet con mala señal el `await` se cuelga y el botón de salir deja de
   sacar a nadie. Si gana el reloj, se sigue y se borra todo igual, que es lo
   que de verdad le quita el acceso a quien está enfrente del aparato.
3. **El `?salir=1` se extrajo a `_salirDeSubpagina()`** para poder probar el
   recorrido, y **lee quién es ANTES de borrar**: leerlo después significaría
   cerrar con el scope equivocado.

---

## 4. Cómo se verificó

### 4.1 La migración se corrió contra Postgres de verdad antes de enviarla

`tests/probar-sql-v77.mjs` levanta **PGlite** (Postgres compilado a WASM) sobre
un esquema mínimo: las tablas que la v77 da por hechas, el freno de la v30, los
roles `anon`/`authenticated` y `auth.uid()`/`auth.jwt()` de mentira para poder
«entrar» como quien se quiera.

1. **Provoca los tres agujeros** con las definiciones que había en producción.
   Si alguno no se puede provocar, el agujero no era ese. Los tres se
   provocaron: 15 contraseñas seguidas sin una queja, la llave compartida
   entregada a un dado de baja, y el contador de una víctima borrado sin sesión.
2. **Corre el archivo tal cual** e imprime la misma tabla que salió en Supabase.
3. **Repite los tres ataques** y comprueba que lo legítimo siga vivo: la
   colaboradora activa entra, recibe los datos de su negocio y consigue su
   llave; quien no trae el campo `estado` también entra.

```
mkdir -p /tmp/pglite && cd /tmp/pglite && npm init -y && npm install @electric-sql/pglite
PGLITE_DIR=/tmp/pglite node tests/probar-sql-v77.mjs
```

**Error mío con lección:** la primera versión documentaba `NODE_PATH=…`. Los
`import` de ESM **ignoran NODE_PATH** (solo lo mira el `require` de CommonJS),
así que el arnés no arrancaba — y al pasarle la batería reportó «no caza
ninguna». No es que no cazara: no corría. Un arnés que no arranca se ve igual
que uno permisivo.

### 4.2 El candado corre el login y las salidas, no las lee

Suite **BE7** en `tests/money-tests.js`: carga los scripts de `hub.html`,
`security.js` y `ctx-bar.js` en un DOM de mentira, pone la lista de staff a mano
y llama a `loginSubmit()`, `logout()`, `_salirDeSubpagina()` y `ctxSalir()`.

Del login: la **activa** entra (el control va primero: sin él, un rechazo por
arnés roto se celebraría como candado) · quien no trae `estado` entra · el
**dado de baja** no entra aunque la contraseña sea correcta, y se le dice por
qué · la **baja temporal** también cierra · **la baja en un negocio no le quita
el acceso al otro** · al entrar por caché se llama a `staff_login` y **no** a
`login_exito`.

De las salidas, lo que se mide no es «¿se llamó?» sino **«¿se llamó ANTES?»**:
cada salida escribe una línea de tiempo y se comprueba que el cierre de sesión
aparezca antes de cualquier borrado, en los tres caminos, con `local` para el
colaborador y el normal para el dueño. Que en `?salir=1` salga `local` demuestra
además que el tipo de sesión se lee antes de limpiar.

### 4.3 Batería de mutaciones — 25 mutaciones

Commit primero, mutar después, restaurar con copia propia (nunca
`git checkout --`).

- **Login y bajas (9/9 cazadas):** quitar el candado de baja · `continue` → `return` · la regla devuelve siempre `true` · la regla deja fuera a los que no traen el campo · salir no cierra · `signOut` vuelve a ser global · salir deja la llave cacheada · `ctxSalir` deja la llave · el login por caché no avisa al servidor.
- **Orden de salida (8/8 cazadas):** `ctx-bar` vuelve a cerrar después de borrar · `?salir=1` vuelve a cerrar después · `?salir=1` lee quién es después de limpiar · el colaborador se cierra con scope global · el dueño se cierra solo en local · nadie cierra nada · el hub vuelve a saltarse el cierre del colaborador · cada puerta decide por su cuenta otra vez.
- **SQL (8/8 por el candado, 7/8 por Postgres):** la que Postgres no caza es volver `IS NOT TRUE` a `NOT (...)`, y es correcto: `_login_golpe` no devuelve `NULL` en ninguna rama, así que hoy las dos formas se portan igual. Es una regla defensiva, no un bug vivo, y la cuida el candado por texto. Lo digo en vez de inventarle un escenario que la haga fallar.

---

## 5. Pendiente, y por qué no lo puedo hacer yo

**La prueba con una sesión anterior a la baja.** Necesita producción y una
sesión real. Los pasos, para que el resultado sea comparable:

1. Con un colaborador de prueba **activo**, entrar al hub y **dejar la pestaña
   abierta**.
2. Dar de baja a ese colaborador (Baja definitiva) desde otra pestaña.
3. **Sin recargar**, llamar desde la pestaña vieja a cualquier RPC de datos del
   negocio. **Predicción: sigue funcionando.** Es la identidad compartida, y es
   el hueco de la sección 0.
4. Llamar `obtener_staff_cred` con su hash. **Predicción: ya no devuelve nada.**
5. Pulsar «Salir» y volver a intentar el login en ese mismo equipo.
   **Predicción: no entra, y la llave cacheada ya no está.**
6. `login_exito('<correo de otro>')` desde una sesión cualquiera.
   **Predicción: no borra nada.**

Si el paso 3 se confirma, R03 queda abierto con la rotación de credencial como
siguiente paso.

**También pendiente:** el freno de intentos de las dos funciones de NIP (antes
de ampliar las pruebas de acceso por QR), el rechazo entre negocios de R05, el
valor de *Settings → API → Max rows* para R10, y revisar la vigencia del token
en *Auth → Sessions*.

Lo siguiente acordado con Edwin es el **Resumen financiero**.
