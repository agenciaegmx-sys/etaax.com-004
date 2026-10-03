# Cómo desplegar una Edge Function

Una migración `.sql` se **pega** en el SQL Editor y ya. Una Edge Function es
distinta: es código que corre en el servidor de Supabase, y hay que **subirlo**.

Hay dos caminos. El primero no requiere instalar nada.

---

## Camino A — Desde el navegador (el fácil)

1. Entra a **Supabase → tu proyecto → Edge Functions** (menú de la izquierda).
2. Botón **Deploy a new function → Via Editor**.
3. En **Name** escribe el nombre EXACTO de la carpeta. Para esta:

   ```
   admin-credenciales
   ```

   El nombre importa: es la dirección a la que el panel le habla. Si escribes
   otro, el botón de la app seguirá sin encontrarla.

4. Borra el código de ejemplo que trae y pega **todo** el contenido de:

   ```
   supabase/functions/admin-credenciales/index.ts
   ```

5. **Deploy function**. Tarda unos segundos.

Eso es todo. **No hace falta configurar secretos**: `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase solo, y el correo del admin
trae su valor por defecto en el código.

**Deja «Verify JWT» encendido** (viene así). La función además verifica por su
cuenta que quien llama sea el admin de plataforma — las dos cosas, no una.

### Para actualizarla después

Mismo lugar: Edge Functions → la función → **Edit** → pegar el código nuevo →
Deploy. Reemplaza la versión anterior.

---

## Camino B — Desde la terminal (si vas a tocarlas seguido)

Hace falta instalar el CLI de Supabase una sola vez:

```bash
brew install supabase/tap/supabase     # macOS
supabase login                         # abre el navegador y te da un token
```

El proyecto **ya está enlazado** (`supabase/.temp/project-ref`), así que desde
la raíz del repo:

```bash
supabase functions deploy admin-credenciales
```

Ventaja de este camino: sube lo que está en el repo tal cual, sin copiar y
pegar — así el código desplegado y el del repo no se separan nunca.

---

## Cómo saber si quedó

En el panel admin → abre un negocio → **🔑 Correo y contraseña del dueño**.

- Si aparece el cuadro y al aplicar responde algo (aunque sea un error de
  validación), **la función ya está arriba**.
- Si dice *«No se pudo conectar con el servidor»*, todavía no está desplegada o
  el nombre no coincide.

---

## Las que ya están desplegadas

| Función | Para qué | Nota al desplegar |
|---|---|---|
| `stripe-webhook` | Stripe avisa que se pagó | `--no-verify-jwt` (Stripe no manda token) |
| `crear-checkout` | Arma el link de pago | — |
| `sync-suscripcion` | Cuadra las sucursales con Stripe | — |
| `activar-invitacion` | Alta por invitación | `--no-verify-jwt` |
| `admin-credenciales` | Correo/contraseña del dueño desde admin | — |

Las que llevan `--no-verify-jwt` las llama alguien que **no tiene sesión de
ETAAX** (Stripe, o quien abre una invitación), así que verifican por su cuenta
de otra forma. `admin-credenciales` sí exige sesión: la del admin.
