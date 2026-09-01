/* ════════════════════════════════════════════════════════════════
   ETAAX · Alta de un cliente a partir de una invitación

   Sustituye al registro abierto. Los signups están APAGADOS en Supabase a
   propósito —una cuenta creada sola alcanzaba el almacén de archivos— así que
   el alta ya no puede pasar por auth.signUp desde el navegador. Aquí se hace
   con la llave de servicio, que no depende de ese ajuste.

   Crea TRES cosas de un golpe, porque las tres hacen falta para que el negocio
   funcione y hacerlas por separado deja negocios a medio nacer:
     1. la cuenta del dueño (correo + contraseña, ya confirmada),
     2. el negocio,
     3. la cuenta compartida de colaboradores (staff.<negId>@etaax.app), que es
        la que usan las tablets y los NIP del QR.

   NO VERIFICA JWT: la llama alguien que todavía no tiene cuenta. Lo que
   autoriza es el TOKEN de la invitación, que se valida aquí contra la base.

   DESPLIEGUE
     supabase functions deploy activar-invitacion --no-verify-jwt

   SECRETOS (ya puestos por Supabase)
     SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
   ════════════════════════════════════════════════════════════════ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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

/* Mismo formato que genId() del cliente: base36 de la hora + azar. */
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
/* Contraseña de la cuenta de staff: nadie la teclea, la lee la app. Larga y al
   azar porque es una credencial real que vive en la base. */
function genPass(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (n) => a[n % a.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  let body: { token?: string; nombre?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: 'Cuerpo inválido' }, 400); }

  const token = (body.token ?? '').trim();
  const nombre = (body.nombre ?? '').trim();
  const password = body.password ?? '';

  if (!token) return json({ error: 'Falta el token de la invitación' }, 400);
  if (!nombre) return json({ error: 'Escribe tu nombre' }, 400);
  if (password.length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);

  /* ── 1. La invitación manda ──────────────────────────────────────────────
     Se relee de la base aunque el navegador ya la haya consultado: lo que
     llega del cliente es una sugerencia, no una autorización. */
  const { data: inv, error: eInv } = await admin
    .from('invitaciones').select('*').eq('token', token).maybeSingle();

  if (eInv) return json({ error: 'No se pudo leer la invitación: ' + eInv.message }, 500);
  if (!inv) return json({ error: 'Esta invitación no existe.' }, 404);
  if (inv.usada_at) return json({ error: 'Esta invitación ya se usó. Pide una nueva.' }, 409);
  if (new Date(inv.expira_at) < new Date())
    return json({ error: 'Esta invitación ya caducó. Pide una nueva.' }, 410);

  /* ── 2. La cuenta del dueño ──────────────────────────────────────────────
     email_confirm: true porque el link se mandó A SU CORREO — el clic ya
     probó que el buzón es suyo. Pedirle otra confirmación sería un paso de
     más para demostrar lo mismo. */
  const { data: uNueva, error: eUser } = await admin.auth.admin.createUser({
    email: inv.email,
    password,
    email_confirm: true,
    user_metadata: { nombre },
  });
  if (eUser || !uNueva?.user) {
    const msg = String(eUser?.message ?? '');
    if (/already|registered|exists/i.test(msg))
      return json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' }, 409);
    return json({ error: 'No se pudo crear la cuenta: ' + msg }, 500);
  }
  const uid = uNueva.user.id;

  /* De aquí en adelante, si algo falla hay que DESHACER la cuenta: dejarla
     suelta sin negocio deja al cliente con un correo que ya "existe" y que
     no puede volver a invitarse. */
  const deshacer = async (msg: string, code = 500) => {
    try { await admin.auth.admin.deleteUser(uid); } catch { /* nada que hacer */ }
    return json({ error: msg }, code);
  };

  /* ── 3. El negocio ───────────────────────────────────────────────────────── */
  const negId = 'n_' + genId();
  const { error: eNeg } = await admin.from('negocios').insert({
    id: negId,
    usuario_id: uid,
    datos: {
      nombre: inv.nombre_negocio,
      tipo: 'restaurante',
      emoji: '🍽️',
      color: '#3dbe7a',
      fechaCreado: new Date().toISOString().slice(0, 10),
      logo: '',
    },
  });
  if (eNeg) return deshacer('No se pudo crear el negocio: ' + eNeg.message);

  /* ── 4. La cuenta compartida de colaboradores ────────────────────────────
     Es la que provisionaba staff-auth.js con signUp, y que con los signups
     apagados ya no podía crearse. Si falla, el negocio SÍ se queda: el dueño
     puede entrar y operar, solo que sus colaboradores no tendrían acceso por
     nube todavía. Se reporta para poder arreglarlo, no se tira todo. */
  let avisoStaff: string | null = null;
  const staffEmail = `staff.${negId}@etaax.app`;
  const staffPass = genPass();
  const { data: uStaff, error: eStaff } = await admin.auth.admin.createUser({
    email: staffEmail,
    password: staffPass,
    email_confirm: true,
  });
  if (eStaff || !uStaff?.user) {
    avisoStaff = 'La cuenta de colaboradores no se pudo crear: ' + String(eStaff?.message ?? '');
  } else {
    const { error: eUpd } = await admin.from('negocios')
      .update({ staff_uid: uStaff.user.id, staff_cred: { email: staffEmail, password: staffPass } })
      .eq('id', negId);
    if (eUpd) avisoStaff = 'La cuenta de colaboradores quedó sin guardar: ' + eUpd.message;
  }

  /* ── 5. La suscripción, en pendiente ─────────────────────────────────────
     Nace bloqueada SIEMPRE, pague como pague. Con tarjeta la desbloquea el
     webhook de Stripe cuando el dinero entra; con transferencia o efectivo la
     desbloquea ETAAX a mano desde el panel. Nadie opera sin haber pagado. */
  const { error: eSus } = await admin.from('suscripciones').upsert({
    negocio_id: negId,
    estado: 'pendiente',
    notas: `Alta por invitación · ${inv.forma_pago === 'stripe' ? 'tarjeta recurrente' : 'transferencia/efectivo'}`,
  }, { onConflict: 'negocio_id' });
  if (eSus) avisoStaff = (avisoStaff ? avisoStaff + ' · ' : '') + 'Suscripción: ' + eSus.message;

  /* ── 6. Quemar la invitación ─────────────────────────────────────────────
     Hasta el final: si algo hubiera fallado antes, la invitación sigue
     sirviendo y el cliente puede reintentar con el mismo link. */
  await admin.from('invitaciones')
    .update({ usada_at: new Date().toISOString(), negocio_id: negId })
    .eq('token', token);

  return json({
    ok: true,
    email: inv.email,
    negocio_id: negId,
    nombre_negocio: inv.nombre_negocio,
    forma_pago: inv.forma_pago,
    aviso: avisoStaff,
  });
});
