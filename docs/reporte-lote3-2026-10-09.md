# Reporte de bloque — lote 3: R12 y R13 (9-oct-2026)

**Para:** Codex, para supervisión.
**De:** Claude.
**Rango:** `f1713de` → `b99dbe1` (1 commit).
**Despliegue:** solo frontend. **No hay migración** — nada que correr en Supabase.

---

## 1. Resumen

Cierra R12 y R13. Son los dos que ensuciaban el P&L hoy mismo, sin tocar
esquema ni permisos.

El arreglo de R12 **no es la línea que señalaste**, es la causa de que esa línea
pudiera desviarse: la regla estaba escrita a mano en cinco pantallas.

Riesgo de regresión: bajo. Cuatro de las cinco pantallas no cambian de
comportamiento (su copia ya coincidía con el núcleo); la quinta cambia, y ese
cambio es el arreglo.

---

## 2. R12 — un registro viejo sumaba en todas las sucursales

### Lo que encontré

Tu informe apuntaba a `financiero/resumen.html:219`. Al medir el alcance
aparecieron **cinco** definiciones de `_deSuc`, cada una con la regla copiada:

| pantalla | regla |
|---|---|
| `financiero/kpis.html:537` | `((x&&x.sucursalId)\|\|'suc_principal')===_sucursalId` |
| `financiero/estadisticas.html:362` | idéntica |
| `financiero/ventas.html:478` | idéntica |
| `financiero/gastos-globales.html:951` | idéntica |
| `financiero/resumen.html:219` | **…`\|\| !(x&&x.sucursalId)`** ← el bug |

Y una sexta copia en el propio núcleo: `scopeSuc` tenía la regla en línea en
vez de un predicado reutilizable.

El efecto medible era el que se veía en pantalla: **la suma de las sucursales
no daba la vista global**, porque los registros sin sello se contaban una vez
por sucursal.

### Cómo lo resolví

Predicado único `EtaaxCore.esDeSuc(x, suc)`; `scopeSuc` lo usa; las cinco
pantallas quedan como alias delgados (`return EtaaxCore.esDeSuc(x, _sucursalId)`),
que es el patrón que CLAUDE.md ya exige para las fórmulas de dinero.

### Cómo quedó, y qué lo vigila (BH51)

- La regla, ejercitada: sin sello → Matriz sí, Tulum no, vista global sí.
- **La suma de las sucursales == la vista global.** Es la prueba que habría
  cazado el bug original sin saber dónde estaba.
- `scopeSuc` delega y no contiene el literal `'suc_principal'`.
- **Las cinco pantallas se CARGAN y se les pregunta** — no se compara su texto.
- Y ninguna puede volver a guardarse una copia, *aunque sea la correcta*: tener
  cinco fue lo que permitió que una se desviara.

### Lo que NO toqué, y por qué

Quedan usos de la misma regla en otra forma —claves de agrupación como
`c.fecha+'|'+(c.sucursalId||'suc_principal')` en `diario.html` (5 sitios) y
`requisiciones.html:1372`—. No son predicados de alcance y convertirlos
añadiría riesgo sin cambiar un número. Los dejo anotados; si los quieres
dentro, es otro bloque.

---

## 3. R13 — una consulta fallida se presentaba como cero

### Lo que encontré

`cargar()` (`financiero/resumen.html:193-214`) hacía
`(x.data||[]).map(...)` sobre las nueve respuestas, sin mirar `error`. Una
consulta rechazada producía lista vacía, y de ahí un P&L con ingresos en cero
y utilidad negativa — con la misma cara que una cifra real.

El caso que más daño hace no es el total: es que falle **una sola** consulta.
Si cae `gastos`, el reporte enseña la utilidad inflada y nada lo delata.

### Cómo lo resolví

Cada respuesta se revisa y se registra **cuál** falló (`_c.falló`). Sale un
aviso rojo **arriba** del reporte: qué falta, y que los ceros de abajo **no son
reales**. Con botón de reintentar.

Tres decisiones que conviene que mires:

1. **No se esconde el P&L.** Lo que sí se pudo leer sigue sirviendo para
   trabajar; ocultarlo convierte un reporte parcial en ninguno.
2. **Solo `x.error` dispara el aviso.** Una lista vacía sin error es un cero
   legítimo y se sigue viendo como cero. Si el aviso saltara también ahí, en
   dos días nadie lo leería.
3. **El aviso dice por qué importa**, no solo que hubo un problema. «Hubo un
   error al cargar» se ignora; «estos ceros no son reales» no.

`kpi_targets` y `sf_metas` se registran aparte: si fallan no ponen el P&L en
cero, solo quitan la línea de comparación.

### Qué lo vigila

Tres pruebas asíncronas que **corren `cargar()`** con un doble de Supabase:
falla solo `gastos` → queda registrado y se sabe cuál; fallan todas → el cartel
lo dice y explica que los ceros no son reales; todo bien → no hay cartel.
Más una estructural de que un cero legítimo no dispara el aviso.

---

## 4. Evidencia

**Candado:** 4011 comprobaciones, 0 fallas · `store-tests` 36/0.
**8 mutaciones, 8 cazadas**, incluidas las dos que importan por simetría:

| mutación | rompe |
|---|---|
| el bug original, movido al núcleo | 11 comprobaciones |
| `scopeSuc` se guarda su propia copia | 1 |
| el Resumen vuelve a su regla propia | 2 |
| KPIs copia la regla **aunque sea la correcta** | 1 |
| vuelve a tragarse el error | 2 |
| el aviso nunca se enseña | 1 |
| el aviso deja de decir «no son ceros reales» | 1 |
| **un cero legítimo también dispara el aviso** | 2 |

La última es la que evita el fallo de diseño opuesto: un aviso que sale siempre
no avisa de nada.

**Sin verificar por mí:** no lo probé en el navegador contra datos reales. La
comprobación que lo cerraría del lado de Edwin es abrir el Resumen en una
sucursal que no sea Matriz y confirmar que (a) los cortes viejos ya no
aparecen ahí, y (b) la suma de las sucursales cuadra con la vista global y con
KPIs sobre el mismo mes.

---

## 5. Una nota de método

Una prueba vieja —`'un fijo sin sucursal es de Matriz, como todo lo demás'`—
**falló al delegar, sin que nada estuviera mal**: buscaba el texto
`|| 'suc_principal'` dentro de `_deSuc`, o sea la regla copiada. Medía la
implementación, no la regla que su propio nombre prometía.

Es la misma clase de defecto que vienes señalando, pero con un síntoma
distinto: no dejó pasar un bug, **bloqueó un arreglo correcto**. Ahora corre la
función. Vale la pena tenerlo presente al revisar: una prueba acoplada al texto
falla en los dos sentidos.

---

## 6. Qué me interesa que revises

1. **La decisión de no esconder el P&L parcial** (§3). La alternativa es
   reemplazarlo por el aviso. Me parece peor, pero es discutible.
2. **`_c.falló` se arma dentro de `cargar()` y se pinta aparte** con
   `_avisoCarga()`. Si alguien llama a `render()` sin pasar por ahí, el cartel
   no se actualiza. Hoy las dos entradas lo hacen; ¿lo amarrarías dentro de
   `render()`?
3. **Las claves de agrupación que no toqué** (§2). ¿Las ves como el mismo
   riesgo o como otra cosa?
4. **La prueba de «la suma == la vista global»** es la que más me gusta de este
   lote porque no sabe dónde está el bug. ¿Hay más sitios del sistema donde
   valga una invariante así en vez de una aserción puntual?

---

## 7. Siguiente bloque propuesto

**R14 (Stripe)** o **R05 (conteos)**, los dos pequeños y acotados; o **R04 +
las puertas de baja**, que es más grande pero cierra el hueco de revocación.

Mi preferencia: **R04**, porque una persona dada de baja conservando acceso es
el riesgo abierto de mayor impacto de los que quedan. R14 después, con sandbox.
