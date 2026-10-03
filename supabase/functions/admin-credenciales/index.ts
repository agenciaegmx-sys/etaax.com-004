/* ════════════════════════════════════════════════════════════════
   ETAAX · Restablecer el correo y la contraseña del dueño de un negocio

   PARA QUÉ: cuando alguien pierde el correo Y la contraseña, el reseteo por
   correo no sirve —justamente porque no tiene el correo—. Hoy la única salida
   era entrar a la consola de Supabase. Esto le da a ETAAX una puerta propia,
   con llave y con rastro.

   POR QUÉ ESTO NO PUEDE VIVIR EN EL NAVEGADOR:
   Cambiar las credenciales de OTRO usuario exige la llave de servicio
   (SERVICE_ROLE). Esa llave no es "una llave más": es la llave maestra de toda
   la base, salta RLS y lee cualquier tabla de cualquier negocio. Puesta en el
   cliente, cualquiera que abra las herramientas del navegador se la lleva. Por
   eso vive aquí, donde solo corre el servidor.

   TRES CANDADOS, y los tres hacen falta:
     1. Hay que venir con sesión válida (JWT firmado por Supabase).
     2. Esa sesión tiene que ser la del ADMIN DE PLATAFORMA. Se verifica contra
        el correo del token —no contra algo que mande el cliente—, que es la
        misma regla que usa is_platform_admin() en la base.
     3. El usuario que se va a tocar tiene que ser el DUEÑO DEL NEGOCIO que se
        dice. Sin esto, un admin podría mandar cualquier par (negocio, usuario)
        y cambiarle la contraseña a quien no toca — por error de dedo, incluso.

   Y DEJA RASTRO. El cambio se escribe en la bitácora de accesos del negocio
   (v62) con quién lo hizo y qué cambió. Un cambio de credenciales sin rastro es
   exactamente lo que no debe existir en un sistema con dinero adentro: si
   mañana el dueño pregunta «¿quién me cambió la contraseña?», tiene que haber
   respuesta.

   DESPLIEGUE
     supabase functions deploy admin-credenciales
   ════════════════════════════════════════════════════════════════ */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

/* El correo del admin de plataforma. Es el MISMO valor que usa
   is_platform_admin() en la base (v3) y admin-guard.js en el front: si se
   mueve, se mueve en los tres. Vive en una variable de entorno para poder
   cambiarlo sin volver a desplegar, con el valor de siempre como respaldo. */
const ADMIN_EMAIL = (Deno.env.get('ETAAX_ADMIN_EMAIL') ?? 'admin@etaax.com').toLowerCase();

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

/* La MISMA regla de fuerza que el front (password.js). Validar solo del lado
   del navegador es validar nada: esta función se puede llamar con curl. */
function passwordDebil(p: string): string | null {
  if (p.length < 8) return 'La contraseña necesita al menos 8 caracteres.';
  if (!/[a-záéíóúüñ]/.test(p)) return 'La contraseña necesita una minúscula.';
  if (!/[A-ZÁÉÍÓÚÜÑ]/.test(p)) return 'La contraseña necesita una MAYÚSCULA.';
  if (!/[0-9]/.test(p)) return 'La contraseña necesita un número.';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);

  // ── Candado 1: sesión válida ──────────────────────────────────────────────
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json({ ok: false, error: 'Falta la sesión.' }, 401);

  const { data: u, error: eu } = await admin.auth.getUser(token);
  if (eu || !u?.user) return json({ ok: false, error: 'Sesión no válida.' }, 401);

  // ── Candado 2: y que sea la del admin de plataforma ───────────────────────
  const quien = (u.user.email ?? '').toLowerCase();
  if (quien !== ADMIN_EMAIL) {
    /* Mismo mensaje y mismo código que "sesión no válida": decirle a quien
       prueba que "existe pero no eres admin" le confirma que la puerta está
       ahí. No se gana nada contándolo. */
    return json({ ok: false, error: 'Sesión no válida.' }, 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Petición mal formada.' }, 400); }

  const negocioId = String(body.negocioId ?? '').trim();
  const usuarioId = String(body.usuarioId ?? '').trim();
  const email     = body.email ? String(body.email).trim() : '';
  const password  = body.password ? String(body.password) : '';

  if (!negocioId || !usuarioId) return json({ ok: false, error: 'Falta el negocio o el usuario.' }, 400);
  if (!email && !password)      return json({ ok: false, error: 'No mandaste nada que cambiar.' }, 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ ok: false, error: 'Ese correo no se ve bien.' }, 400);
  if (password) {
    const malo = passwordDebil(password);
    if (malo) return json({ ok: false, error: malo }, 400);
  }

  // ── Candado 3: ese usuario es, de verdad, el dueño de ese negocio ─────────
  const { data: neg, error: en } = await admin
    .from('negocios').select('usuario_id, datos').eq('id', negocioId).maybeSingle();
  if (en)   return json({ ok: false, error: 'No se pudo leer el negocio.' }, 500);
  if (!neg) return json({ ok: false, error: 'Ese negocio no existe.' }, 404);
  if (neg.usuario_id !== usuarioId)
    return json({ ok: false, error: 'Ese usuario no es el dueño de ese negocio.' }, 400);

  /* El correo tiene que ser único en toda la plataforma: si ya es de otro, el
     cambio fallaría más adelante con un error de base que no dice nada. Mejor
     pararlo aquí, con un mensaje que se entiende. */
  if (email) {
    const { data: choca } = await admin
      .from('usuarios').select('id').ilike('email', email).neq('id', usuarioId).maybeSingle();
    if (choca) return json({ ok: false, error: 'Ese correo ya lo usa otra cuenta.' }, 409);
  }

  // ── El cambio ─────────────────────────────────────────────────────────────
  const cambios: Record<string, string> = {};
  if (email)    cambios.email = email;
  if (password) cambios.password = password;
  /* email_confirm: sin esto, cambiar el correo deja la cuenta esperando que el
     dueño confirme en una bandeja que —por definición de este caso— no puede
     abrir. Lo confirma ETAAX, que es quien está haciendo el cambio a mano. */
  const payload = email ? { ...cambios, email_confirm: true } : cambios;

  const { error: ee } = await admin.auth.admin.updateUserById(usuarioId, payload);
  if (ee) return json({ ok: false, error: ee.message || 'No se pudo aplicar el cambio.' }, 500);

  /* El espejo de `usuarios` es lo que lee TODO el sistema (el panel, el hub, el
     gate de suscripción). Si no se actualiza, el correo nuevo funcionaría para
     entrar pero en pantalla seguiría el viejo, y nadie sabría cuál es el bueno. */
  if (email) {
    await admin.from('usuarios').update({ email }).eq('id', usuarioId);
  }

  // ── El rastro ─────────────────────────────────────────────────────────────
  /* Se escribe con la llave de servicio y a la tabla directo —no por la RPC—
     porque aquí no hay sesión de navegador de la cual sacar el correo: el autor
     es el admin que se verificó arriba, y ese dato lo tiene esta función.
     Si la bitácora no existe todavía (v62 sin correr), el cambio YA se aplicó:
     no tiene sentido deshacerlo, pero sí decirlo. */
  const quePaso = [email ? 'correo' : '', password ? 'contraseña' : '']
    .filter(Boolean).join(' y ');
  const { error: eb } = await admin.from('accesos_log').insert({
    id: crypto.randomUUID().replace(/-/g, ''),
    negocio_id: negocioId,
    usuario: quien,
    tipo: 'admin_reset',
    agente: (req.headers.get('user-agent') ?? '').slice(0, 160),
    detalle: 'cambió ' + quePaso + ' del dueño',
  });

  return json({
    ok: true,
    cambio: quePaso,
    aviso: eb ? 'El cambio se aplicó, pero NO se pudo registrar en la bitácora (¿falta correr la v62?).' : null,
  });
});
