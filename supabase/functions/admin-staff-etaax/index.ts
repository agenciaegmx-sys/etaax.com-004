/* ════════════════════════════════════════════════════════════════
   ETAAX · Staff ETAAX: crear la cuenta, cambiarle la contraseña, darla de baja

   POR QUÉ AQUÍ Y NO EN EL NAVEGADOR: los registros abiertos están APAGADOS en
   Supabase a propósito (una cuenta creada sola alcanzaba el almacén de
   archivos), así que `auth.signUp` desde el panel contesta «Signups not
   allowed». Crear o tocar la cuenta de OTRA persona exige la llave de servicio,
   y esa llave solo vive en el servidor. Igual que activar-invitacion y
   admin-credenciales.

   DOS CANDADOS:
     1. Sesión válida (JWT firmado por Supabase).
     2. Que sea la del ADMIN DE PLATAFORMA (el correo del token, la misma regla
        que is_platform_admin() en la base).
   Y solo toca cuentas con correo `@staff.etaax.app`: nunca a un dueño ni al admin.

   ACCIONES (POST, JSON):
     { accion:'crear', usuario, nombre, password } → { ok, uid }
     { accion:'clave', uid, password }             → { ok }
     { accion:'baja',  uid }                       → { ok }

   Las tablas y la regla en la base son de supabase-migration-v88.sql.

   DESPLIEGUE
     Dashboard de Supabase → Edge Functions → Deploy a new function → Via editor
     (nombre: admin-staff-etaax, con «Verify JWT» prendido), o por CLI:
       supabase functions deploy admin-staff-etaax
   SECRETOS: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (ya los pone Supabase).
   ════════════════════════════════════════════════════════════════ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const ADMIN_EMAIL = (Deno.env.get('ETAAX_ADMIN_EMAIL') ?? 'admin@etaax.com').toLowerCase();
const DOMINIO = '@staff.etaax.app';

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

/* La MISMA regla que el front (password.js): esta función se puede llamar con curl. */
function passwordDebil(p: string): string | null {
  if (p.length < 8) return 'La contraseña necesita al menos 8 caracteres.';
  if (!/[a-záéíóúüñ]/.test(p)) return 'La contraseña necesita una minúscula.';
  if (!/[A-ZÁÉÍÓÚÜÑ]/.test(p)) return 'La contraseña necesita una MAYÚSCULA.';
  if (!/[0-9]/.test(p)) return 'La contraseña necesita un número.';
  return null;
}
/* La misma regla del usuario que staff-etaax.js (usuarioValido). */
const usuarioValido = (u: string) => /^[a-z0-9][a-z0-9._-]{2,39}$/.test(u);
const faltaV88 = (m: string) => /etaax_staff|does not exist|schema cache/i.test(m || '');

/* ¿Ya existe una cuenta de Auth con este correo? (una baja vieja, o un intento
   que se quedó a medias). No hay búsqueda por correo en la API: se recorre. */
async function buscarPorCorreo(email: string) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) return null;
    const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 1000) return null;
  }
  return null;
}
/* Una cuenta que se va a tocar tiene que ser del Staff ETAAX. */
async function esDelStaff(uid: string) {
  const { data, error } = await admin.auth.admin.getUserById(uid);
  if (error || !data?.user) return false;
  return (data.user.email ?? '').toLowerCase().endsWith(DOMINIO);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);

  // ── Candado 1: sesión válida ──
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json({ ok: false, error: 'Falta la sesión.' }, 401);
  const { data: u, error: eu } = await admin.auth.getUser(token);
  if (eu || !u?.user) return json({ ok: false, error: 'Sesión no válida.' }, 401);
  // ── Candado 2: la del admin de plataforma ──
  const quien = (u.user.email ?? '').toLowerCase();
  if (quien !== ADMIN_EMAIL) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Petición mal formada.' }, 400); }
  const accion = String(body.accion ?? '');

  // ═══ CREAR ═══
  if (accion === 'crear') {
    const usuario = String(body.usuario ?? '').trim().toLowerCase();
    const nombre = String(body.nombre ?? '').trim().slice(0, 80);
    const password = String(body.password ?? '');
    if (!nombre) return json({ ok: false, error: 'Escribe su nombre.' }, 400);
    if (!usuarioValido(usuario)) return json({ ok: false, error: 'El usuario debe tener de 3 a 40 letras, números, punto, guion o guion bajo.' }, 400);
    const malo = passwordDebil(password);
    if (malo) return json({ ok: false, error: malo }, 400);

    const { data: ya, error: ey } = await admin.from('etaax_staff').select('uid').eq('usuario', usuario).maybeSingle();
    if (ey) return json({ ok: false, error: faltaV88(ey.message) ? 'Falta correr supabase-migration-v88.sql.' : ey.message }, 500);
    if (ya) return json({ ok: false, error: 'Ya hay alguien del Staff ETAAX con ese usuario.' }, 409);
    // El login prueba primero a los colaboradores de los negocios: el mismo usuario taparía al del Staff ETAAX.
    const { data: col } = await admin.from('staff').select('id').eq('datos->>usuario', usuario).limit(1);
    if (col && col.length) return json({ ok: false, error: 'Ese usuario ya lo tiene un colaborador de un negocio. Elige otro.' }, 409);

    const email = usuario + DOMINIO;
    const meta = { nombre, staff_etaax: true };
    let uid = '';
    const cr = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
    if (cr.error || !cr.data?.user) {
      // ¿La cuenta ya existía? Se recupera con la contraseña nueva.
      const viejo = await buscarPorCorreo(email);
      if (!viejo) return json({ ok: false, error: 'No se pudo crear la cuenta: ' + (cr.error?.message ?? 'sin respuesta') }, 500);
      const up = await admin.auth.admin.updateUserById(viejo.id, { password, email_confirm: true, user_metadata: meta, ban_duration: 'none' });
      if (up.error) return json({ ok: false, error: 'No se pudo recuperar la cuenta: ' + up.error.message }, 500);
      uid = viejo.id;
    } else uid = cr.data.user.id;

    /* El espejo `usuarios` es de los DUEÑOS: el trigger de la v10 lo llena con
       TODA cuenta nueva, y el Staff ETAAX saldría en «Cuentas» del panel como si
       fuera un cliente. */
    await admin.from('usuarios').delete().eq('id', uid);

    const ahora = new Date().toISOString();
    const { error: ei } = await admin.from('etaax_staff').upsert(
      { uid, usuario, datos: { nombre, creado: ahora, por: quien }, updated_at: ahora }, { onConflict: 'uid' });
    if (ei) return json({ ok: false, error: faltaV88(ei.message) ? 'Falta correr supabase-migration-v88.sql.' : ei.message }, 500);
    return json({ ok: true, uid });
  }

  // ═══ CAMBIAR CONTRASEÑA ═══
  if (accion === 'clave') {
    const uid = String(body.uid ?? '').trim();
    const password = String(body.password ?? '');
    if (!uid) return json({ ok: false, error: 'Falta la persona.' }, 400);
    const malo = passwordDebil(password);
    if (malo) return json({ ok: false, error: malo }, 400);
    if (!(await esDelStaff(uid))) return json({ ok: false, error: 'Esa cuenta no es del Staff ETAAX.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(uid, { password });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  // ═══ BAJA ═══
  if (accion === 'baja') {
    const uid = String(body.uid ?? '').trim();
    if (!uid) return json({ ok: false, error: 'Falta la persona.' }, 400);
    if (!(await esDelStaff(uid))) return json({ ok: false, error: 'Esa cuenta no es del Staff ETAAX.' }, 400);
    // Primero la ficha (con ella se van sus accesos): desde aquí la base ya no le da nada.
    const { error: ed } = await admin.from('etaax_staff').delete().eq('uid', uid);
    if (ed) return json({ ok: false, error: ed.message }, 500);
    await admin.from('usuarios').delete().eq('id', uid);
    // Y la cuenta. Si no se pudiera borrar, se bloquea: ya no entra.
    const { error: eb } = await admin.auth.admin.deleteUser(uid);
    if (eb) await admin.auth.admin.updateUserById(uid, { ban_duration: '876000h' });
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Acción desconocida.' }, 400);
});
