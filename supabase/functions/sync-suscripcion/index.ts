/* ════════════════════════════════════════════════════════════════
   ETAAX · Sincronizar la cantidad de sucursales con Stripe

   El precio depende de cuántas sucursales tiene el negocio, así que el número
   que ETAAX conoce y el que Stripe cobra tienen que estar SIEMPRE de acuerdo.
   Sin esto, un negocio abre su tercera sucursal, la usa desde el primer día, y
   te sigue pagando como si tuviera una. Es la fuga más silenciosa que puede
   tener un cobro por unidades: nadie reclama de más, nadie avisa.

   SIN PRORRATEO (decisión de Edwin): la sucursal nueva funciona de inmediato y
   el precio sube en el SIGUIENTE cobro. No le cae un cargo sorpresa el día que
   abre — y eso vuelve barato abrir sucursales, que es lo que conviene.

   Es IDEMPOTENTE: llamarla de más no hace nada. Si la cantidad ya coincide, ni
   siquiera toca Stripe. Por eso se puede llamar sin miedo cada vez que cambian
   las sucursales, aunque a veces sea de a gratis.

   DESPLIEGUE
     supabase functions deploy sync-suscripcion
   ════════════════════════════════════════════════════════════════ */
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

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

async function contarSucursales(negId: string): Promise<number> {
  const { data } = await admin.from('negocio_sucursales')
    .select('datos').eq('negocio_id', negId).maybeSingle();
  const arr = (data?.datos?.sucursales ?? []) as unknown[];
  return Math.max(1, Array.isArray(arr) ? arr.length : 1);
}

/* ¿Este usuario puede tocar la suscripción de ESTE negocio? Dueño, su colaborador,
   o el admin de plataforma. Sin esta revisión cualquiera abriría cobros a nombre de
   un negocio ajeno — no le robaría dinero a nadie, pero sí le ensuciaría las
   suscripciones a otro.
   Se comprueba con el rol de servicio y comparando ids A MANO, no dejando que la
   RLS decida con el token del usuario: si SUPABASE_ANON_KEY no estuviera puesta,
   esa consulta fallaría en silencio y todo el mundo saldría como "no es tuyo" —
   un permiso denegado que en realidad es un problema de configuración. */
async function puedeOperar(negId: string, userId: string, email: string | null) {
  const { data, error } = await admin.from('negocios')
    .select('usuario_id, staff_uid').eq('id', negId).maybeSingle();
  if (error) return { ok: false, motivo: 'No se pudo leer el negocio: ' + error.message, codigo: 500 };
  if (!data)  return { ok: false, motivo: 'Ese negocio no existe', codigo: 404 };
  const ADMIN = Deno.env.get('ETAAX_ADMIN_EMAIL') ?? 'admin@etaax.com';
  if (data.usuario_id === userId) return { ok: true, motivo: '', codigo: 200 };
  if (data.staff_uid === userId)  return { ok: true, motivo: '', codigo: 200 };
  if (email && email === ADMIN)   return { ok: true, motivo: '', codigo: 200 };
  return { ok: false, motivo: 'Tu cuenta no tiene permiso sobre este negocio', codigo: 403 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sin sesión' }, 401);
  const { data: u, error: eu } = await admin.auth.getUser(token);
  if (eu || !u?.user) return json({ error: 'Sesión inválida' }, 401);

  let negocioId = '';
  try { negocioId = ((await req.json())?.negocioId ?? '').toString(); } catch (_) { /* body vacío */ }
  if (!negocioId) return json({ error: 'Falta el negocio' }, 400);

  const permiso = await puedeOperar(negocioId, u.user.id, u.user.email ?? null);
  if (!permiso.ok) return json({ error: permiso.motivo }, permiso.codigo);

  const { data: sub } = await admin.from('suscripciones')
    .select('stripe_subscription_id').eq('negocio_id', negocioId).maybeSingle();
  const subId = sub?.stripe_subscription_id;
  // Sin suscripción en Stripe no hay nada que sincronizar: paga a mano o todavía
  // no ha pagado. No es un error — la app llama a esto sin saberlo.
  if (!subId) return json({ ok: true, sinSuscripcion: true });

  const cantidad = await contarSucursales(negocioId);

  try {
    const s = await stripe.subscriptions.retrieve(subId);
    const item = s.items?.data?.[0];
    if (!item) return json({ error: 'La suscripción no tiene renglones' }, 500);
    if (item.quantity === cantidad) return json({ ok: true, cantidad, sinCambio: true });

    await stripe.subscriptions.update(subId, {
      items: [{ id: item.id, quantity: cantidad }],
      /* 'none' = sin prorrateo. Con el default ('create_prorations') Stripe le
         cobraría ahí mismo la parte del mes que falta, que es justo el cargo
         sorpresa que decidimos no hacer. */
      proration_behavior: 'none',
      metadata: { negocio_id: negocioId, sucursales: String(cantidad) },
    });

    console.log('[sync]', negocioId, item.quantity, '→', cantidad);
    return json({ ok: true, cantidad, antes: item.quantity });
  } catch (e) {
    console.error('[sync] falló:', (e as Error).message, negocioId);
    return json({ error: (e as Error).message }, 500);
  }
});
