/* ============================================================================
   ETAAX — LAS CUATRO SALIDAS, CONTRA EL SDK DE VERDAD

   Lo escribió CODEX como reproducción de dos fallos reales del lote 10, y se
   adopta tal cual porque prueba algo que el candado no puede: carga el bundle
   REAL de supabase-js y le retiene la red, en vez de un `signOut` de mentira
   que contesta al instante.

   Lo que destapó, y que yo había dado por sentado al revés: `signOut` SALE A
   LA RED CON CUALQUIER SCOPE, también `local` — el SDK llama al servidor y
   solo borra la sesión guardada cuando esa petición vuelve. Con la red
   colgada, el plazo de 2.5 s terminaba la ESPERA pero no el signOut: la
   pantalla enseñaba el login y la sesión seguía guardada. Se veía como que
   saliste, y no saliste.

   Aquí los dos casos ya no son reproducciones: son candados. Se exige lo
   contrario de lo que exigía el original.

   Cómo se corre (no está en el pre-push: necesita el bundle del SDK):

       curl -sL https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js \
            -o /tmp/supabase-js-2.117.3.js
       SDK_SUPABASE=/tmp/supabase-js-2.117.3.js node tests/probar-salidas-sdk-real.cjs

   El `fetch` está capado a un dominio inventado: NO toca producción ni red.
   ============================================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const raiz = process.env.ETAAX_RAIZ || path.join(__dirname, '..');
const rutaSdk = process.env.SDK_SUPABASE || '/tmp/supabase-js-2.117.3.js';
if (!fs.existsSync(rutaSdk)) {
  console.log('Falta el bundle del SDK. Bájalo y vuelve a correr:\n' +
    '  curl -sL https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js -o ' + rutaSdk + '\n' +
    '  SDK_SUPABASE=' + rutaSdk + ' node tests/probar-salidas-sdk-real.cjs');
  process.exit(2);
}
const banco = fs.readFileSync(path.join(raiz, 'tests/money-tests.js'), 'utf8');
const utilidades = banco.slice(0, banco.indexOf('/* ── Runner'));
const util = { require, console, __dirname: path.join(raiz, 'tests') };
vm.createContext(util);
vm.runInContext(utilidades + '\nglobalThis.audit = {crearContexto, cargarInline, cargarJS, setVar};', util);
const { crearContexto, cargarInline, cargarJS, setVar } = util.audit;
const sdk = vm.runInThisContext(fs.readFileSync(rutaSdk, 'utf8') + '\nsupabase;', { filename: 'supabase-js' });
const pause = (ms) => new Promise(r => setTimeout(r, ms));

async function preparar(tipo, etiqueta) {
  const c = crearContexto();
  const relojes = new Map();
  const linea = [];
  c.sessionStorage.clear = function () {
    linea.push('clear sessionStorage');
    for (const k of Object.keys(c.sessionStorage._m)) c.sessionStorage.removeItem(k);
  };
  c.setTimeout = (fn, ms) => {
    if (ms === 2500) return setTimeout(fn, ms);
    const id = Symbol('timer'); relojes.set(id, {fn, ms}); return id;
  };
  c.clearTimeout = id => relojes.delete(id);
  c.scrollTo = () => {};
  const clave = 'sb-auditoria-' + etiqueta + '-auth-token';
  const ahora = Math.floor(Date.now() / 1000);
  const uid = '11111111-1111-4111-8111-111111111111';
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = b64({alg:'HS256',typ:'JWT'}) + '.' + b64({sub:uid,aud:'authenticated',role:'authenticated',exp:ahora+3600,iat:ahora,session_id:'22222222-2222-4222-8222-222222222222'}) + '.firma-de-prueba';
  c.sessionStorage.setItem(clave, JSON.stringify({access_token:jwt,refresh_token:'refresh-sintetico',expires_at:ahora+3600,expires_in:3600,token_type:'bearer',user:{id:uid,aud:'authenticated',role:'authenticated',email:'prueba@invalid.test'}}));
  let resolverRed;
  const peticiones = [];
  const client = sdk.createClient('https://auditoria.invalid', 'anon-sintetico', {
    auth:{storage:c.sessionStorage,storageKey:clave,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async (url, options) => {
      assert(String(url).startsWith('https://auditoria.invalid/'), 'solo red simulada');
      peticiones.push({url:String(url),method:options.method});
      linea.push('request '+String(url));
      return await new Promise(r => {resolverRed = r;});
    }}
  });
  await client.auth.initialize();
  assert((await client.auth.getSession()).data.session, 'el control debe tener una sesión real del SDK');
  let pendiente;
  const signOutReal = client.auth.signOut.bind(client.auth);
  client.auth.signOut = opciones => {
    linea.push('signOut ' + ((opciones && opciones.scope) || 'global'));
    pendiente = signOutReal(opciones);
    return pendiente;
  };
  c._supabase = client;
  const ctx = {ctxType:tipo,negId:'n1'};
  c.localStorage.setItem('etaax_ctx', JSON.stringify(ctx));
  c.localStorage.setItem('etaax_n1_staffcred', '{"password":"credencial-sintetica"}');
  const ses = tipo === 'staff' ? {type:'staff',negocioId:'n1',nombre:'Prueba'} : {usuarioId:uid,nombre:'Prueba'};
  c.sessionStorage.setItem('etaax_sesion_hub', JSON.stringify(ses));
  cargarInline(c, 'hub.html');
  cargarJS(c, 'security.js');
  assert.strictEqual(typeof c.etaaxCerrarSesion, 'function');
  assert.strictEqual(typeof c.logout, 'function');
  c._confirmSalir = async () => true;
  const vistas = [];
  c.showView = v => vistas.push(v);
  setVar(c, '_sesion', ses);
  return {
    c, clave, relojes, linea, peticiones, vistas,
    async terminar() {
      if (resolverRed) resolverRed(new Response(null, {status:204}));
      if (pendiente) await pendiente;
      await client.auth.stopAutoRefresh();
    }
  };
}

(async () => {
  const salida = await preparar('staff', 'timeout');
  const inicio = Date.now();
  await salida.c.logout();
  const hub = {
    caso:'hub con logout de red retenido más de 2.5 segundos',
    duracion_ms:Date.now()-inicio,
    muestra_login:salida.vistas.includes('viewLogin'),
    sesion_etaax_borrada:salida.c.sessionStorage.getItem('etaax_sesion_hub') === null,
    sesion_supabase_sigue_guardada:salida.c.sessionStorage.getItem(salida.clave) !== null,
    peticiones_logout:salida.peticiones.length,
    linea:salida.linea
  };
  /* ANTES exigía `sesion_supabase_sigue_guardada` — era la reproducción del
     fallo. Ahora exige lo contrario: vencido el plazo, aquí no queda sesión. */
  assert(hub.muestra_login, 'debería mostrar la pantalla de entrada');
  assert(hub.sesion_etaax_borrada, 'debería borrar la sesión de etaax');
  assert(hub.peticiones_logout === 1, 'debería haber intentado revocar en el servidor');
  assert(!hub.sesion_supabase_sigue_guardada,
    'LA SESIÓN DE SUPABASE SE QUEDÓ GUARDADA: la pantalla dice que saliste y no saliste');
  await salida.terminar();

  const inactividad = await preparar('staff', 'inactividad');
  const reloj = [...inactividad.relojes.values()].find(t => t.ms === 30*60*1000);
  assert(reloj, 'el cierre por inactividad debe estar programado');
  reloj.fn();
  /* 3 s, no 40 ms: la limpieza ocurre cuando vence el plazo de 2.5 s de
     etaaxCerrarSesion. Medir antes es medir a mitad de la salida. */
  await pause(3000);
  const automatico = {
    caso:'colaborador sale por inactividad',
    credencial_compartida_sigue_guardada:inactividad.c.localStorage.getItem('etaax_n1_staffcred') !== null,
    peticiones_logout:inactividad.peticiones.length,
    linea:inactividad.linea,
    destino:inactividad.c.location.href
  };
  assert(!automatico.credencial_compartida_sigue_guardada,
    'el colaborador salió por inactividad y la llave compartida se quedó en el equipo');
  assert(/razon=inactividad/.test(automatico.destino), 'debería volver al hub diciendo por qué');
  assert(automatico.linea.indexOf('signOut local') < automatico.linea.indexOf('clear sessionStorage'),
    'cerró DESPUÉS de borrar: el signOut llega a una sesión que ya no existe');
  await inactividad.terminar();
  const evidencia = {sdk:'2.117.3, mismo bundle CDN revisado',produccion_tocada:false,resultados:[hub,automatico]};
  console.log(JSON.stringify(evidencia,null,2));
  console.log('\n🔒 LAS CUATRO SALIDAS OK — contra el SDK real, con la red retenida');
})().catch(e => {console.error(e.stack);process.exitCode=1;});
