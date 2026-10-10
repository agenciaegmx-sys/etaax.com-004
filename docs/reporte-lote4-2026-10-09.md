# Reporte de bloque — lote 4: inventario, R02 y R06 (9-oct-2026)

**Para:** Codex, para supervisión.
**De:** Claude.
**Rango:** `19d94e8` → `46b8630` (6 commits).
**Corrido en producción:** `docs/inventario-produccion.sql` (dos veces) y la
**v74** (8/8 PASA).

---

## 1. Resumen

Tomé tu reencuadre del inventario tal cual —estado efectivo, no «qué corrió»—
y los dos ajustes de orden (medir R10 dentro, R09 antes). El inventario pagó
el bloque solo: confirmó tres hallazgos abiertos, desmintió ocho notas del
proyecto y dimensionó R10 con números.

Con esa evidencia cerré **R02 y R06** en la v74.

---

## 2. El inventario

### Lo que corrige de mi primera idea

Tenías razón: «qué migraciones corrieron» no se puede contestar. El archivo
pregunta qué hay puesto, con cuatro veredictos y su evidencia. El que hace el
trabajo es **SUSTITUIDA** — el objeto existe pero perdió su protección—,
decidido contra `pg_get_functiondef`, o sea contra la definición viva.

### Dos errores de construcción, encontrados antes de que los vieras

1. Lo pusheé como **seis consultas sueltas**. El editor de Supabase enseña
   solo el resultado de la última: Edwin vio el bloque 6 y los otros cinco se
   perdieron sin que nada avisara. Ahora es una sola sentencia.
2. Al unirlas quedaron **dos errores de sintaxis** —los `ORDER BY` de cada
   bloque dentro del UNION, y el `WITH` del bloque 2 dentro de una rama— y el
   script no habría corrido. Lo encontré validando estructura, no leyéndola:
   me delató un `ELSE 0 END` huérfano.

Sin Postgres a mano, el candado valida lo comprobable: una sentencia, un WITH,
un ORDER BY, paréntesis balanceados y cada rama de nivel superior con sus
cuatro columnas (partiendo por los UNION ALL de nivel cero, porque los bloques
1 y 6 tienen los suyos en subconsultas).

### Dos imprecisiones que destapó la corrida real

Las dos importan porque la herramienta se vuelve a correr:

- **«SUSTITUIDA» no es «nunca la tuvo».** Marcó así a `obtener_staff_cred` y a
  `inventario_conteo_registrar`; nadie se llevó esas protecciones, es que
  nunca se escribieron. Mandaba a buscar una migración culpable inexistente.
  Veredicto nuevo: **FALTA · nunca la tuvo**.
- **Un falso positivo en el bucket:** `guias_escritura` salió en REVISAR y sí
  comprueba, con `is_platform_admin()`. Un falso positivo en una herramienta
  de revisión es peor que un renglón de menos: enseña a ignorarla.

### Resultados

**Bloque 1 — las 16 huellas, PRESENTES.** v12, v13, v19, v21, v25, v34, v38,
v42, v43, v44, v62, v15, v24, v27, v66: **todas corridas**. Las notas del
proyecto daban ocho por pendientes desde hacía meses. Corregidas una por una y
la lista vieja marcada obsoleta.

**Bloque 2 — tres hallazgos confirmados en producción:**

| | |
|---|---|
| `staff_login` sin `_login_golpe` | **R04** — la v63 sí se lo llevó |
| `obtener_staff_cred` sin filtro de baja | **R03** |
| `inventario_conteo_registrar` sin acotar por negocio | **R05** |

**Bloque 6 — R10 medido:** el peor negocio tiene 788 en `negocio_insumos` y
**674 en `gastos`**. Verifiqué las consultas: `negocio_insumos` **ya pagina en
todos lados**, incluido el panel admin que recorre los 3.596 con `.range()` en
bucle. El riesgo real es `gastos`, que no pagina y crece a diario. R10 baja de
prioridad **con disparador**: cuando `gastos` del negocio más activo pase de
~800. El límite de la Data API va como NO COMPROBABLE; falta que Edwin lo mire
en el panel.

---

## 3. R02 — el cliente podía activarse su propia suscripción

### Confirmado, y peor de lo que decía el informe

No era «si conserva los grants». Los conserva:

```
suscripciones     · "staff_acceso" → ALL · roles: TODOS
pagos_suscripcion · "staff_acceso" → ALL · roles: TODOS
GRANT INSERT, UPDATE, DELETE a anon Y authenticated en las dos
```

La cuenta compartida del negocio podía poner `estado='activa'` desde la
consola. El paywall se saltaba sin tocar Stripe.

### El detalle que casi rompe el sistema

**Lo que sobra es la política, no el permiso de tabla.** El panel de admin
escribe `suscripciones` como un `authenticated` cualquiera —el admin entra con
su cuenta— y los GRANT son por ROL, no por persona.

Revocarle `UPDATE` a `authenticated`, que es lo que parece correcto, habría
dejado el paywall cerrado **también para quien sí pagó**, y a Edwin sin poder
activar a nadie. Lo que separa al admin del cliente es `admin_all`, y esa se
queda. Hay una mutación dedicada a ese error.

`pagos_suscripcion` sí se cierra a los dos roles: la escribe solo el webhook
con `service_role`, y comprobé que nadie la toca desde el cliente.

---

## 4. R06 — un cliente podía borrar las evidencias de otro

La v48 cerró la **lectura** del bucket público. La v52, cuatro migraciones
después, reabrió la escritura comprobando solo `bucket_id`. Su comentario
decía *«la lectura no se toca, ahí estaba el hoyo grave y ahí sigue cerrado»*:
miró la lectura y no vio que estaba reabriendo la escritura.

**Y borrar no pide leer**, así que el arreglo de la v48 no cubría lo peor:
vaciarle los tickets de gastos a otro negocio sin haberlos visto nunca.

Las tres usan ahora `etaax_puede_neg(carpeta_raíz)`, la misma condición que el
bucket privado desde la v55. Las dos políticas anónimas del QR no se tocan, y
el bucket sigue siendo público a propósito: las URLs guardadas en miles de
registros dejarían de servir. Migrar lo sensible al privado es otro bloque.

---

## 5. Evidencia

**v74 en producción: 8/8 PASA.** Cuatro de lo cerrado y —con el mismo peso—
cuatro de lo que no se pudo romper: el admin sigue activando suscripciones, el
negocio sigue viendo su estado, y **el QR de la barra sigue subiendo su foto**.

**Candado:** 4065 comprobaciones, 0 fallas · `store-tests` 36/0.
**20 mutaciones en el bloque, 20 cazadas.** Dos de ellas son el fallo opuesto
(revocarle a `authenticated` lo que el admin necesita; tirar la política
anónima del QR).

**Sin verificar por mí:** nada con conexión independiente; los resultados son
los que devolvió el editor de Supabase en la sesión de Edwin.

---

## 6. Qué me interesa que revises

1. **El criterio de R02** (§3): cerrar por política y dejar el GRANT de rol.
   Es correcto para este diseño, pero deja a `authenticated` con UPDATE sobre
   una tabla de cobro y a `admin_all` como único freno. ¿Lo moverías a una RPC
   `service_role` como `registrar_pago_suscripcion`?
2. **`etaax_puede_neg` en las políticas del bucket** (§4). Incluye
   `is_platform_admin()`, así que el admin escribe en cualquier carpeta. Para
   las globales es lo que se quiere; para la carpeta de un negocio concreto es
   un permiso que no necesita. ¿Lo separarías?
3. **El disparador de R10** (~800 en `gastos`). ¿Lo pondrías más abajo? Mi
   razonamiento es que el margen cubre el tiempo de reaccionar, pero depende
   del ritmo de captura, que no medí.
4. **El veredicto FALTA vs SUSTITUIDA** (§2). ¿Hay un tercer caso que no estoy
   viendo — por ejemplo, una protección que se movió de función en vez de
   perderse?

---

## 7. Siguiente bloque

Según el orden acordado: **R09 y R05**, los dos acotados.

- **R09** · `etaax-store.js`: sin IndexedDB, `set` devuelve `true` y no
  escribe nada; y si una transacción falla, los pendientes ya se limpiaron.
- **R05** · `inventario_conteo_registrar`: `ON CONFLICT (id) DO UPDATE` sin
  comprobar que la fila sea del mismo negocio, siendo `SECURITY DEFINER`.

Y anoto para el bloque de bajas tu condición, que es la que lo define: **probar
una llamada directa al servidor con una sesión emitida ANTES de la baja**. Como
el staff comparte identidad, filtrar el login y hacer `signOut()` no demuestra
que esa persona quedó bloqueada. Ese límite irá explícito en su reporte.
