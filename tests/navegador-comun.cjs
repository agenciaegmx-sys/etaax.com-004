/* Lo que comparten los arneses de navegador: Chromium real cargando las
   páginas del repo tal cual, desde el disco, con un Supabase de mentira y un
   reloj falso. Ninguna petición sale a internet: lo que no sea un archivo del
   repo se corta y se anota.

   Lo usan tests/probar-nomina-navegador.cjs y tests/probar-cola-navegador.cjs.
   Playwright NO vive en el repo (Netlify publica la raíz tal cual): se instala
   aparte y se apunta con NODE_PATH. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
/* HTTPS y no http: la cola de salida usa Web Locks (una cola por pestaña), y
   el navegador solo los ofrece en un contexto SEGURO. Con http la página
   arrancaba en el modo viejo y el arnés probaba otra cosa que producción.
   Nada sale a la red: todo lo contesta la ruta de abajo. */
const ORIGEN = 'https://etaax.prueba';
const TIPOS = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml',
                '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.json':'application/json',
                '.woff2':'font/woff2' };

/* ══ EL SUPABASE DE MENTIRA ═══════════════════════════════════════════════
   Filas {id, negocio_id, datos}, igual que las tablas de verdad. upsert por id
   (o por negocio_id cuando la tabla es documento único). Se inyecta como si
   fuera el UMD del CDN, así que supabase-config.js crea el cliente de siempre. */
function sdkFalso() {
    var LLAVE = '__nube';
    function nube(){ try { return JSON.parse(localStorage.getItem(LLAVE) || '{}'); } catch(e){ return {}; } }
    function guarda(db){ localStorage.setItem(LLAVE, JSON.stringify(db)); }
    /* `log()`: TODAS las escrituras que llegaron a la nube, de cualquier
       pestaña —vive con la nube—. Es lo que dice si algo se subió dos veces. */
    function log(){ try { return JSON.parse(localStorage.getItem('__nube_log') || '[]'); } catch(e){ return []; } }
    window.__nube = { leer: nube, escribir: guarda, caida: false, escrituras: [], log: log };
    var user = { id:'u1', email:'duena@fixture.invalid', user_metadata:{ nombre:'Dueña de prueba' } };
    function query(tabla){
        var f = [], q = {}, modo = 'select', valor = null, opc = {}, single = false;
        ['select','order','limit','range','gt','gte','lt','lte','neq','or','not','ilike','like','filter','contains'].forEach(function(k){ q[k] = function(){ return q; }; });
        q.eq = function(k, v){ f.push([k, v]); return q; };
        q.in = function(k, v){ f.push([k, v, 'in']); return q; };
        q.maybeSingle = function(){ single = 'maybe'; return q; };
        q.single = function(){ single = 'one'; return q; };
        q.upsert = function(v, o){ modo = 'upsert'; valor = v; opc = o || {}; return q; };
        q.insert = function(v){ modo = 'upsert'; valor = v; return q; };
        q.update = function(v){ modo = 'update'; valor = v; return q; };
        q.delete = function(){ modo = 'delete'; return q; };
        q.then = function(res, rej){
            var db = nube(), filas = db[tabla] || [], data = null, error = null;
            var pasa = function(r){ return f.every(function(c){
                var val = c[0] === 'id' ? r.id : c[0] === 'negocio_id' ? r.negocio_id : (r.datos || {})[c[0]];
                return c[2] === 'in' ? c[1].indexOf(val) > -1 : val === c[1]; }); };
            if (modo !== 'select' && window.__nube.caida) {
                error = { message: 'Failed to fetch' };
            } else if (modo === 'upsert') {
                (Array.isArray(valor) ? valor : [valor]).forEach(function(v){
                    var clave = opc.onConflict === 'negocio_id' ? 'negocio_id' : 'id';
                    var i = filas.findIndex(function(r){ return r[clave] === v[clave]; });
                    var fila = { id: v.id || v.negocio_id, negocio_id: v.negocio_id, datos: v.datos };
                    if (i > -1) filas[i] = fila; else filas.push(fila);
                    window.__nube.escrituras.push({ tabla: tabla, id: fila.id });
                    var l = log(); l.push(tabla + ':' + fila.id); localStorage.setItem('__nube_log', JSON.stringify(l));
                });
                db[tabla] = filas; guarda(db); data = valor;
            } else if (modo === 'update') {
                filas.filter(pasa).forEach(function(r){ if (valor.datos) r.datos = valor.datos; });
                db[tabla] = filas; guarda(db);
            } else if (modo === 'delete') {
                db[tabla] = filas.filter(function(r){ return !pasa(r); }); guarda(db);
            } else {
                data = JSON.parse(JSON.stringify(filas.filter(pasa)));
                if (single) data = data[0] || null;
            }
            return Promise.resolve({ data: data, error: error, count: Array.isArray(data) ? data.length : 0 }).then(res, rej);
        };
        return q;
    }
    window.supabase = { createClient: function(){ return {
        auth: {
            getUser: async function(){ return { data:{ user:user }, error:null }; },
            getSession: async function(){ return { data:{ session:{ user:user, access_token:'x' } }, error:null }; },
            onAuthStateChange: function(){ return { data:{ subscription:{ unsubscribe:function(){} } } }; },
            signInWithPassword: async function(){ return { data:{ user:user }, error:null }; },
            signOut: async function(){ return { error:null }; },
            refreshSession: async function(){ return { data:{ session:{ user:user } }, error:null }; }
        },
        from: query,
        rpc: async function(){ return { data:null, error:null }; },
        channel: function(){ return { on:function(){ return this; }, subscribe:function(){ return this; },
            track:async function(){}, presenceState:function(){ return {}; }, unsubscribe:function(){} }; },
        removeChannel: async function(){},
        storage: { from: function(){ return { upload:async function(){ return { error:null }; },
            getPublicUrl:function(){ return { data:{ publicUrl:'' } }; } }; } }
    }; } };
}

/* ══ LA SEMILLA: un negocio, una sucursal, dos colaboradores ═══════════════ */
const STAFF = [
    { id:'s_ana',  nombre:'Ana Prueba',  puesto:'Barista', sucursalId:'suc_principal', estado:'Activo',
      esquemaSueldo:'diario', sueldoDiario:300, periodicidad:'semanal', multaRetardo:25, bonos:[] },
    { id:'s_beto', nombre:'Beto Prueba', puesto:'Cocinero', sucursalId:'suc_principal', estado:'Activo',
      esquemaSueldo:'diario', sueldoDiario:400, periodicidad:'quincenal', multaRetardo:25, bonos:[] }
];
function semilla(reloj) {
    return `(() => {
      /* Reloj falso: Date sin argumentos devuelve el instante elegido. */
      const T0 = ${JSON.stringify(reloj)};
      if (T0) {
        /* UN SOLO RELOJ PARA TODAS LAS PESTAÑAS: el arranque se guarda con la
           nube. Si cada pestaña contara desde que ella abrió, la que abrió
           después iría atrasada, y «gana la escritura más nueva» —que se
           mide por la hora— mediría el arnés y no la app. */
        const Real = Date, base = Real.parse(T0);
        const arranque = Number(localStorage.getItem('__arranque')) || Real.now();
        window.__arranque = arranque;
        const Falso = function(...a){ if (!(this instanceof Falso)) return new Real(base + (Real.now()-arranque)).toString();
                                      return a.length ? new Real(...a) : new Real(base + (Real.now()-arranque)); };
        Falso.prototype = Real.prototype; Falso.parse = Real.parse; Falso.UTC = Real.UTC;
        Falso.now = () => base + (Real.now() - arranque);
        window.Date = Falso;
      }
      window.__errores = [];
      addEventListener('error', e => __errores.push(String(e.message)));
      addEventListener('unhandledrejection', e => __errores.push('promesa: ' + String(e.reason && e.reason.message || e.reason)));
      window.__avisos = [];
      window.alert = m => { __avisos.push(String(m)); };
      window.__confirmar = true; window.confirm = m => { __avisos.push('¿' + String(m)); return __confirmar; };
      window.__motivo = 'Prueba'; window.prompt = m => { __avisos.push('? ' + String(m)); return __motivo; };
      if (!localStorage.getItem('__sembrado')) {
        localStorage.clear();
        if (window.__arranque) localStorage.setItem('__arranque', String(window.__arranque));
        localStorage.setItem('etaax_negocio_activo', 'n1');
        localStorage.setItem('etaax_sucursal_activa', 'suc_principal');
        localStorage.setItem('etaax_ctx', JSON.stringify({ ctxType:'owner', userId:'u1', userName:'Dueña de prueba',
            negId:'n1', negNombre:'Café de prueba' }));
        localStorage.setItem('etaax_qses', JSON.stringify({ usuarioId:'u1', nombre:'Dueña de prueba', plan:'pyme', ts:Date.now() }));
        localStorage.setItem('etaax_negocios', JSON.stringify([{ id:'n1', usuarioId:'u1', nombre:'Café de prueba', tipo:'cafe' }]));
        localStorage.setItem('etaax_n1_sucursales', JSON.stringify([{ id:'suc_principal', nombre:'Matriz', activa:true }]));
        localStorage.setItem('etaax_novedades_vista', JSON.stringify({}));
        localStorage.setItem('__nube', JSON.stringify({
          negocios: [{ id:'n1', negocio_id:'n1', datos:{ id:'n1', usuarioId:'u1', nombre:'Café de prueba', tipo:'cafe' } }],
          staff: ${JSON.stringify(STAFF.map(s => ({ id:s.id, negocio_id:'n1', datos:s })))}
        }));
        localStorage.setItem('__sembrado', '1');
      }
    })();`;
}

async function abrir(browser, reloj) {
    const ctx = await browser.newContext({ viewport:{ width:1280, height:900 }, deviceScaleFactor:1 });
    const fuera = [];
    await ctx.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === ORIGEN) {
            const p = path.join(RAIZ, decodeURIComponent(url.pathname));
            if (p.startsWith(RAIZ) && fs.existsSync(p) && fs.statSync(p).isFile())
                return route.fulfill({ status:200, body:fs.readFileSync(p),
                    headers:{ 'content-type': TIPOS[path.extname(p)] || 'application/octet-stream' } });
            return route.fulfill({ status:404, body:'' });
        }
        if (/supabase-js/.test(url.href))
            return route.fulfill({ status:200, body:'(' + sdkFalso.toString() + ')();',
                                   headers:{ 'content-type':'application/javascript' } });
        if (/fonts\.(googleapis|gstatic)/.test(url.host)) return route.fulfill({ status:200, body:'' });
        fuera.push(url.href);
        return route.abort();
    });
    await ctx.addInitScript(semilla(reloj));
    const page = await pestana(ctx);
    return { ctx, page, fuera };
}
/* Otra pestaña del MISMO navegador: misma nube, mismo reloj, su propia
   memoria —lo que cargó al abrir, y nada más—. */
async function pestana(ctx) {
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => console.log('  [pageerror]', e.message));
    await page.goto(ORIGEN + '/administrativo/diario.html');
    await page.waitForFunction(() => Array.isArray(window._cacheRecibos) && Array.isArray(window._cacheStaff) && _cacheStaff.length > 0);
    return page;
}


module.exports = { RAIZ, ORIGEN, chromium, sdkFalso, STAFF, semilla, abrir, pestana };
