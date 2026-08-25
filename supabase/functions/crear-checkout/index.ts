/* ════════════════════════════════════════════════════════════════
   ETAAX · Crear sesión de pago con la CANTIDAD DE SUCURSALES

   Por qué esto no puede ser un Payment Link: el precio depende de cuántas
   sucursales tiene el negocio, y un link fijo no lo sabe. La única alternativa
   sería dejar que el cliente escoja la cantidad en el checkout — o sea pedirle
   que se autocobre bien. Un negocio de cinco sucursales pondría 1.

   LA CANTIDAD SE CUENTA AQUÍ, DEL LADO DEL SERVIDOR. Nunca se acepta la que
   mande el navegador: es exactamente el número que determina cuánto se paga.

   El precio es GRADUADO en Stripe (diez tramos, el último abierto), espejo de
   /precios.js: cada sucursal conserva el precio de su posición y de la 11ª en
   adelante se congela en $1,449. Stripe calcula el total; ETAAX solo dice
   cuántas son.

   DESPLIEGUE
     supabase functions deploy crear-checkout
   OJO: esta SÍ verifica JWT (al revés que el webhook). La llama el navegador
   con la sesión del usuario, y de ahí sale quién es y a qué negocio entra.

   SECRETOS
     STRIPE_SECRET_KEY        sk_live_... (o sk_test_ para probar)
     STRIPE_PRICE_SUCURSAL    price_... del precio graduado (opcional; si no
                              está, usa el de producción de abajo)
   ════════════════════════════════════════════════════════════════ */
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

/* El id del precio NO es secreto (viaja en el checkout), pero sí cambia entre
   modo prueba y producción — los objetos de Stripe no cruzan. Por eso se puede
   sobreescribir con un secreto sin tocar el código. */
const PRECIO = Deno.env.get('STRIPE_PRICE_SUCURSAL') ?? 'price_1U89zOK0TesmiDDoJ8SsFAtC';
const SITIO  = Deno.env.get('ETAAX_SITIO') ?? 'https://etaax.com';

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* Cuántas sucursales tiene el negocio, según la BASE. `negocio_sucursales.datos`
   guarda { sucursales:[...], cfg:{...} }.
   Sin sucursales dadas de alta el negocio igual paga UNA: la matriz existe
   aunque nadie la haya registrado como sucursal, y cobrar cero sería regalar
   el servicio al que todavía no configura nada. */
async function contarSucursales(negId: string): Promise<number> {
  const { data } = await admin.from('negocio_sucursales')
    .select('datos').eq('negocio_id', negId).maybeSingle();
  const arr = (data?.datos?.sucursales ?? []) as unknown[];
  return Math.max(1, Array.isArray(arr) ? arr.length : 1);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ── Quién llama ──
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sin sesión' }, 401);
  const { data: u, error: eu } = await admin.auth.getUser(token);
  if (eu || !u?.user) return json({ error: 'Sesión inválida' }, 401);

  let negocioId = '';
  try { negocioId = ((await req.json())?.negocioId ?? '').toString(); } catch (_) { /* body vacío */ }
  if (!negocioId) return json({ error: 'Falta el negocio' }, 400);

  /* ¿Este usuario puede pagar por ESTE negocio? Se comprueba con la RLS, usando
     su propio token: si no alcanza a leer la fila, no es suyo. Sin esta revisión
     cualquiera podría abrir un checkout a nombre de un negocio ajeno — no le
     robaría dinero a nadie, pero sí ensuciaría las suscripciones de otro. */
  const comoUsuario = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
  const { data: neg } = await comoUsuario.from('negocios').select('id').eq('id', negocioId).maybeSingle();
  if (!neg) return json({ error: 'Ese negocio no es tuyo' }, 403);

  const cantidad = await contarSucursales(negocioId);

  // Si ya tiene cliente de Stripe se reusa: así el historial de pagos y la
  // tarjeta guardada quedan en un solo cliente y no se le duplica en el panel.
  const { data: sub } = await admin.from('suscripciones')
    .select('stripe_customer_id').eq('negocio_id', negocioId).maybeSingle();

  try {
    const sesion = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: PRECIO, quantity: cantidad }],
      client_reference_id: negocioId,
      customer: sub?.stripe_customer_id ?? undefined,
      customer_email: sub?.stripe_customer_id ? undefined : (u.user.email ?? undefined),
      /* El negocio viaja también en la metadata de la SUSCRIPCIÓN: los cobros
         del mes 2 en adelante llegan como `invoice.paid` sin client_reference_id,
         y sin esto habría que adivinar de quién son. */
      subscription_data: { metadata: { negocio_id: negocioId, sucursales: String(cantidad) } },
      success_url: `${SITIO}/hub.html?pago=ok`,
      cancel_url:  `${SITIO}/hub.html`,
      allow_promotion_codes: true,
    });
    return json({ url: sesion.url, cantidad: cantidad });
  } catch (e) {
    console.error('[checkout] no se pudo crear:', (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
