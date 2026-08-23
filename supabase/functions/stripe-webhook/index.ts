/* ════════════════════════════════════════════════════════════════
   ETAAX · Webhook de Stripe (Supabase Edge Function, Deno)

   Es un ADAPTADOR, no el lugar donde se decide nada. Hace tres cosas:
     1. verifica que el aviso venga de Stripe de verdad (firma);
     2. saca de qué negocio es y cuánto se pagó;
     3. se lo pasa a `registrar_pago_suscripcion` (v44), que es quien
        aplica la regla — la misma que usa el gate y el panel.

   Por qué la firma NO es opcional: esta URL es pública. Sin verificarla,
   cualquiera que la descubra puede mandar un JSON diciendo "el negocio X
   pagó" y activarse la suscripción gratis para siempre.

   ¿De qué negocio es el pago? Del `client_reference_id` que la app le
   pega al link (?client_reference_id=<negocio_id>). Un link de pago sin
   eso no sabe quién pagó; con eso, un solo link sirve para todos.

   DESPLIEGUE
     supabase functions deploy stripe-webhook --no-verify-jwt
   El --no-verify-jwt es obligatorio: Stripe no manda el token de
   Supabase, y sin esa bandera todos sus avisos rebotan con 401.

   SECRETOS (Supabase → Edge Functions → Secrets; nunca en el repo)
     STRIPE_SECRET_KEY       sk_test_... (luego sk_live_...)
     STRIPE_WEBHOOK_SECRET   whsec_...  del endpoint registrado en Stripe
     SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ya vienen puestas.
   ════════════════════════════════════════════════════════════════ */
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
  // En Deno no existe el cliente HTTP de Node; sin esto, cada llamada truena.
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

// Eventos que nos interesan. Los demás se responden 200 y se ignoran: Stripe manda
// muchísimos y contestarle error a los que no nos importan lo hace reintentar en balde.
const EVENTOS = new Set([
  'checkout.session.completed',   // pagó por el link → el caso de hoy
  'invoice.paid',                 // suscripción recurrente cobrada → la fase que viene
  'invoice.payment_failed',       // se asienta; el corte lo deciden los días de tolerancia
  'customer.subscription.deleted',
]);

/* De centavos a pesos. Stripe maneja enteros en la unidad mínima; guardar 179900
   como si fueran pesos convierte $1,799 en $179,900 en la bitácora. */
const aPesos = (v: number | null | undefined) =>
  typeof v === 'number' ? Math.round(v) / 100 : null;

/* Un campo de Stripe que apunta a otro objeto llega como id ("cus_123") o como el
   objeto entero, según la versión de la API y si algo lo expandió. Leerlo asumiendo
   string devuelve null cuando viene expandido — y ahí se pierde el cliente, que es
   justo lo que amarra los cobros del mes 2 en adelante. */
function idDe(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.id === 'string') return o.id;
    if (typeof o.subscription === 'string') return o.subscription;   // parent.subscription_details
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const firma = req.headers.get('stripe-signature');
  const secreto = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  if (!firma || !secreto) {
    console.error('[stripe] falta la firma o el secreto del webhook');
    return new Response('Sin firma', { status: 400 });
  }

  // El cuerpo CRUDO, sin parsear: la firma se calcula sobre los bytes exactos.
  // Un JSON.parse + stringify de por medio la invalida aunque el contenido sea igual.
  const crudo = await req.text();

  let evento: Stripe.Event;
  try {
    // La variante async es la única que sirve en Deno (el WebCrypto de aquí no es síncrono).
    evento = await stripe.webhooks.constructEventAsync(crudo, firma, secreto);
  } catch (e) {
    console.error('[stripe] firma inválida:', (e as Error).message);
    return new Response('Firma inválida', { status: 400 });
  }

  if (!EVENTOS.has(evento.type)) {
    return new Response(JSON.stringify({ ok: true, ignorado: evento.type }), { status: 200 });
  }

  // ── De qué negocio, de qué cliente, cuánto ──
  let negocioId = '';
  let customer: string | null = null;
  let suscripcion: string | null = null;
  let monto: number | null = null;
  let moneda = 'mxn';

  const obj = evento.data.object as Record<string, unknown>;

  if (evento.type === 'checkout.session.completed') {
    const s = obj as unknown as Stripe.Checkout.Session;
    negocioId   = (s.client_reference_id ?? '') as string;
    customer    = idDe(s.customer);
    suscripcion = idDe(s.subscription);
    monto       = aPesos(s.amount_total);
    moneda      = s.currency ?? 'mxn';
    /* Un pago sin completar NO activa nada. `checkout.session.completed` también
       llega con OXXO/SPEI en cuanto el cliente genera el voucher, con el dinero
       todavía sin caer: activar ahí sería regalar el mes. */
    if (s.payment_status !== 'paid') {
      return new Response(JSON.stringify({ ok: true, pendiente: s.payment_status }), { status: 200 });
    }
  } else {
    const inv = obj as unknown as Stripe.Invoice;
    /* LA PRIMERA FACTURA DE UNA SUSCRIPCIÓN NO SE APLICA. Es el MISMO dinero que
       el `checkout.session.completed` que Stripe manda casi al mismo tiempo, y ese
       es el bueno porque trae el client_reference_id. Aplicar los dos daría DOS
       meses por un solo pago.
       En la primera prueba no pasó, pero por accidente: la factura llegó antes de
       que el checkout guardara el customer, así que no encontró a quién aplicarle
       y cayó en 'sin_negocio'. Con la carrera al revés —o el día que Stripe cambie
       el orden— sí se habría duplicado. Se descarta a propósito, no por timing. */
    if (inv.billing_reason === 'subscription_create') {
      console.log('[stripe] factura de alta ignorada (ya la cubrió el checkout):', evento.id);
      return new Response(JSON.stringify({ ok: true, ignorado: 'subscription_create' }), { status: 200 });
    }
    customer    = idDe(inv.customer);
    suscripcion = idDe((inv as unknown as Record<string, unknown>).subscription)
               ?? idDe((inv.parent as Record<string, unknown> | undefined)?.subscription_details);
    monto       = aPesos(inv.amount_paid ?? inv.amount_due);
    moneda      = inv.currency ?? 'mxn';
    /* En la fase recurrente el negocio viaja en metadata, no en client_reference_id.
       Se busca en los tres lugares donde Stripe la ha ido moviendo entre versiones
       de la API — leer solo uno deja la factura huérfana según con qué versión
       quedó registrado el webhook. */
    const _md = inv.metadata?.negocio_id
      ?? (inv as unknown as { subscription_details?: { metadata?: Record<string, string> } })
           .subscription_details?.metadata?.negocio_id
      ?? (inv.parent as unknown as { subscription_details?: { metadata?: Record<string, string> } } | undefined)
           ?.subscription_details?.metadata?.negocio_id;
    negocioId = (_md as string) ?? '';
    /* Último recurso: buscar por el cliente de Stripe, que quedó guardado en el
       primer pago. Sin esto, una suscripción creada a mano en el dashboard (sin
       metadata) llegaría huérfana y habría que aplicarla a dedo. */
    if (!negocioId && customer) {
      const { data } = await supabase.from('suscripciones')
        .select('negocio_id').eq('stripe_customer_id', customer).maybeSingle();
      if (data?.negocio_id) negocioId = data.negocio_id;
    }
  }

  const { data, error } = await supabase.rpc('registrar_pago_suscripcion', {
    p_evento:      evento.id,
    p_neg:         negocioId,
    p_tipo:        evento.type,
    p_monto:       monto,
    p_moneda:      moneda,
    p_customer:    customer,
    p_suscripcion: suscripcion,
    p_meses:       1,
    p_payload:     { id: evento.id, type: evento.type, created: evento.created },
  });

  if (error) {
    /* 500 A PROPÓSITO: que Stripe reintente. Si la base falló, el pago existe y
       todavía no se aplicó — tragárselo con un 200 perdería el mes del cliente.
       El reintento es seguro porque la función es idempotente por evento_id. */
    console.error('[stripe] no se pudo registrar el pago:', error.message, evento.id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log('[stripe]', evento.type, evento.id, JSON.stringify(data));
  return new Response(JSON.stringify({ ok: true, resultado: data }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
