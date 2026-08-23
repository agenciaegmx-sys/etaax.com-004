# Cobro con Stripe — cómo se conecta y cómo se pasa a producción

Fase actual: **link de pago** (no suscripción recurrente todavía). El dueño paga
por un link, Stripe avisa a la Edge Function, y la función extiende la fecha de
corte. La regla de cuánto se extiende vive en SQL (`registrar_pago_suscripcion`,
v44), no en la función ni en el navegador.

```
Dueño → link de Stripe → paga → webhook → Edge Function (verifica firma)
                                              ↓
                                  registrar_pago_suscripcion (v44)
                                              ↓
                             suscripciones.proximo_cobro += 1 mes (con ancla)
                                              ↓
                                  el negocio se reactiva solo
```

## Requisitos

- Migraciones **v43 y v44** corridas en Supabase → SQL Editor.
- Supabase CLI para desplegar (`npm i -g supabase`, o `brew install supabase/tap/supabase`).

## 1. Crear el link de pago (Stripe, MODO DE PRUEBA)

1. Stripe → **Catálogo de productos** → nuevo producto: `ETAAX · Mensualidad`.
   Precio en **MXN**, el que corresponda al negocio.
2. Del producto → **Crear enlace de pago**.
3. En las opciones del link: activar **"Permitir códigos de promoción"** si se van a
   dar descuentos, y dejar la recolección de correo activada.
4. Copiar la URL (`https://buy.stripe.com/test_...`).

> **Un solo link sirve para todos los negocios.** La app le pega
> `?client_reference_id=<id_del_negocio>` y por ahí el webhook sabe a quién
> aplicarle el mes. NO hace falta un link por cliente.

Pegar esa URL en `hub.html` → `ETAAX_PAGO.link`.

## 2. Desplegar la Edge Function

```bash
supabase login
supabase link --project-ref byjuocnkyuxxudondciz
supabase functions deploy stripe-webhook --no-verify-jwt
```

`--no-verify-jwt` **no es opcional**: Stripe no manda el token de Supabase y sin esa
bandera todos sus avisos rebotan con 401.

La URL queda en:
`https://byjuocnkyuxxudondciz.supabase.co/functions/v1/stripe-webhook`

## 3. Secretos (Supabase → Edge Functions → Secrets)

| Secreto | De dónde sale |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Claves de API → clave secreta (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | del endpoint del paso 4 (`whsec_...`) |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen puestas por Supabase.

> Las llaves `sk_` y `whsec_` **nunca** van al repo ni se comparten en un chat. Se
> copian del dashboard de Stripe al de Supabase, y ya.

## 4. Registrar el webhook en Stripe

Stripe → **Desarrolladores → Webhooks → Agregar endpoint**

- URL: la del paso 2.
- Eventos: `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.deleted`.
- Copiar el **secreto de firma** (`whsec_...`) → va al paso 3.

## 5. Probar

1. Abrir el hub con un negocio vencido → sale el botón **Pagar con tarjeta**.
2. Tarjeta de prueba: `4242 4242 4242 4242`, cualquier fecha futura, cualquier CVC.
3. Verificar en Supabase:

```sql
SELECT evento_id, tipo, resultado, corte_antes, corte_despues
  FROM pagos_suscripcion ORDER BY created_at DESC LIMIT 5;
```

Debe decir `aplicado` y la fecha de corte tiene que haber saltado un mes.

4. **Probar el reintento**: en Stripe → Webhooks → el evento → "Reenviar". La
   segunda vez debe quedar `duplicado` y la fecha **no** se mueve. Si se moviera,
   cada reintento de Stripe regalaría un mes.

## 6. Pasar a producción

1. En Stripe, cambiar a modo real y **repetir los pasos 1 y 4** (el link y el
   webhook de prueba NO sirven en producción; son objetos distintos).
2. Cambiar `STRIPE_SECRET_KEY` a `sk_live_...` y `STRIPE_WEBHOOK_SECRET` al
   `whsec_` del endpoint real.
3. Cambiar `ETAAX_PAGO.link` al link real.
4. Cobrarse a uno mismo una vez, de verdad, y reembolsarlo. Es la única forma de
   saber que la cadena completa funciona con dinero real.

## Lo que falta (fase 3)

- **Suscripción recurrente**: que la tarjeta se cobre sola cada mes. La función ya
  entiende `invoice.paid`; falta crear los precios recurrentes y mandar
  `negocio_id` en la metadata de la suscripción.
- **CFDI**: Stripe cobra, no factura. Sigue pendiente resolverlo (FAKU).
