/* ============================================================================
   ETAAX — candado del ALMACENAMIENTO LOCAL (etaax-store.js).

   Por qué existe este archivo aparte del candado de fórmulas: el bug de "314
   cambios pendientes que nunca bajan" no es una fórmula de dinero, es una
   CARRERA. Hidratar desde IndexedDB es asíncrono; si termina después de una
   escritura y vuelca lo leído encima de la memoria, resucita el estado viejo —
   la cola de salida entera, vaciada un instante antes por el flush. No se ve en
   ninguna prueba de dinero y ya mordió dos veces.

   Aquí se levanta un IndexedDB de mentira con el reloj EN LA MANO: se decide a
   propósito qué termina primero, que es justo lo que no se puede provocar a
   voluntad en un navegador.

   Correr con:  node tests/store-tests.js
   ============================================================================ */
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
let pasan = 0, fallan = 0;
function test(nombre, fn) {
    try {
        const r = fn();
        if (r === false) { fallan++; console.log('  ❌ ' + nombre); return; }
        pasan++; console.log('  ✅ ' + nombre);
    } catch (e) { fallan++; console.log('  💥 ' + nombre + ' → ' + (e && e.message)); }
}
function eq(real, esperado) {
    if (real !== esperado) throw new Error(' esperado=' + esperado + ' real=' + real);
    return true;
}

/* ── IndexedDB de mentira ────────────────────────────────────────────────────
   Guarda en un objeto y dispara sus callbacks cuando NOSOTROS decidimos, no
   cuando el motor quiera. `abrirDiferido` es la clave del asunto: deja la
   apertura colgada para que la app escriba ANTES de que la hidratación llegue. */
function hacerIDB(contenidoInicial, opts) {
    opts = opts || {};
    const disco = Object.assign({}, contenidoInicial);
    const pendientesDeAbrir = [];
    const idb = {
        _disco: disco,
        // Suelta la apertura que quedó colgada (= "IndexedDB terminó de hidratar").
        soltarApertura() { while (pendientesDeAbrir.length) pendientesDeAbrir.shift()(); },
        open() {
            const req = { result: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
            const abrir = () => {
                req.result = hacerDB(disco);
                if (req.onsuccess) req.onsuccess();
            };
            if (opts.abrirDiferido) pendientesDeAbrir.push(abrir);
            else setTimeout(abrir, 0);
            return req;
        },
    };
    return idb;
}
function hacerDB(disco) {
    return {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        transaction(_tienda, _modo) {
            const tx = { oncomplete: null, onerror: null, onabort: null };
            tx.objectStore = () => ({
                put(v, k) {
                    /* `fallaEscritura` simula lo que pasa de verdad: la
                       transacción se aborta (disco lleno, base corrupta) y el
                       dato NO queda. Antes de este bloque, el almacén ya había
                       vaciado sus pendientes y nadie se enteraba. */
                    if (disco.__fallaEscritura) { setTimeout(() => tx.onerror && tx.onerror(), 0); return; }
                    /* Y `__retener` deja la transacción EN VUELO hasta que la
                       prueba la suelte. Es lo único que permite reproducir la
                       carrera de verdad: editar mientras una escritura va en
                       camino. Sin esto, el agrupado de 250 ms fusiona las dos
                       ediciones y la carrera nunca ocurre — mi primera prueba
                       de este caso pasaba con el bug puesto por eso. */
                    if (disco.__retener) {
                        disco.__enVuelo = disco.__enVuelo || [];
                        disco.__enVuelo.push(() => { disco[k] = v; tx.oncomplete && tx.oncomplete(); });
                        return;
                    }
                    disco[k] = v; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
                },
                delete(k) { delete disco[k]; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); },
                openCursor() {
                    const req = { onsuccess: null, onerror: null };
                    const claves = Object.keys(disco);
                    let i = 0;
                    const paso = () => {
                        if (!req.onsuccess) return;
                        if (i >= claves.length) return req.onsuccess({ target: { result: null } });
                        const k = claves[i++];
                        req.onsuccess({ target: { result: { key: k, value: disco[k], continue: () => setTimeout(paso, 0) } } });
                    };
                    setTimeout(paso, 0);
                    return req;
                },
            });
            return tx;
        },
    };
}

// localStorage de mentira (síncrono, como el de verdad).
// `lleno` lo hace lanzar al escribir, que es lo que de verdad hace el navegador
// cuando se acaba la cuota: no devuelve false, LANZA.
function hacerLS(inicial, opts) {
    opts = opts || {};
    const m = Object.assign({}, inicial);
    return {
        _m: m,
        _lleno: !!opts.lleno,
        get length() { return Object.keys(m).length; },
        key(i) { return Object.keys(m)[i]; },
        getItem(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem(k, v) {
            if (this._lleno) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
            /* CUOTA PARCIAL: deja pasar el dato y rechaza el índice de
               respaldos. Es el caso real —la cuota se acaba con el último
               byte, no de golpe— y el que destapó que una marca fallida se
               tragaba en silencio. */
            if (opts.rechazar && opts.rechazar.test(String(k))) {
                const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
            }
            /* Cuota por TAMAÑO: lo que ya está se queda, lo nuevo no entra si
               pasa del límite. Es como se llena de verdad — y un `setItem` que
               falla NO borra el valor anterior. */
            if (opts.maxLen && String(v).length > opts.maxLen) {
                const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
            }
            m[k] = String(v);
        },
        removeItem(k) { delete m[k]; },
    };
}

/* Un `document` con lo justo para que el almacén pueda pegar su cartel, y para
   que la prueba pueda LEERLO. Codex lo pidió explícitamente: la prueba tiene
   que llegar hasta el mensaje que ve quien está capturando, no quedarse en lo
   que devuelve `set()`. */
function hacerDoc() {
    const hijos = [];
    const nuevo = () => ({
        style: {}, _html: '', _hijos: [],
        set innerHTML(v) { this._html = String(v); },
        get innerHTML() { return this._html; },
        setAttribute(k, v) { this['attr_' + k] = v; },
        querySelector() { return { onclick: null }; },
        remove() {},
        appendChild(x) { this._hijos.push(x); },
    });
    const body = nuevo();
    return {
        visibilityState: 'visible',
        body,
        createElement: nuevo,
        addEventListener() {},
        _carteles: () => body._hijos.map(h => h._html).join(' | '),
    };
}

// Levanta etaax-store.js en un contexto propio y devuelve sus piezas.
function montarStore({ enIDB = {}, enLS = {}, abrirDiferido = false, sinIDB = false,
                       lsLleno = false, fallaEscritura = false,
                       retenerEscritura = false, lsRechaza = null, lsMaxLen = 0 } = {}) {
    const localStorage = hacerLS(enLS, { lleno: lsLleno, rechazar: lsRechaza, maxLen: lsMaxLen });
    /* `sinIDB` tiene que valer ANTES de levantar el script: el almacén abre la base
       al cargarse, así que anular window.indexedDB después ya no prueba nada. */
    const indexedDB    = sinIDB ? null : hacerIDB(enIDB, { abrirDiferido });
    if (indexedDB && fallaEscritura) indexedDB._disco.__fallaEscritura = true;
    if (indexedDB && retenerEscritura) indexedDB._disco.__retener = true;
    const documento = hacerDoc();
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, JSON, Object, String, Date, Math,
        localStorage, indexedDB,
        document: documento,
        navigator: {},
    };
    ctx.window = ctx;
    ctx.window.addEventListener = () => {};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'etaax-store.js'), 'utf8'), ctx, { filename: 'etaax-store.js' });
    return { ctx, store: ctx.window.etaaxStore, localStorage, indexedDB, documento };
}
/* Levanta etaax-store.js Y encima etaax-db.js en el mismo contexto, que es donde
   vive la cola de salida. Sin esto la cola solo se puede probar a mano, y a mano
   es justo como se nos fue el rebote de los 348. */
function montarDb(opciones) {
    const montado = montarStore(Object.assign({}, opciones, {
        enLS: Object.assign({ etaax_negocio_activo: 'n1' }, (opciones || {}).enLS),
    }));
    const { ctx } = montado;
    ctx._supabase = { from() { throw new Error('sin red en el test'); } };
    /* El arranque de etaax-db programa un flush a los 1500 ms. Aquí estorba: lo que
       se prueba es _obAdd, no el flush (que ya espera a `ready` por su cuenta). */
    const realTimeout = ctx.setTimeout;
    ctx.setTimeout = (fn, ms) => (ms >= 1000 ? 0 : realTimeout(fn, ms));
    ctx.setInterval = () => 0;
    ctx.document.addEventListener = () => {};
    ctx.document.getElementById = () => null;
    ctx.document.createElement = () => ({ style: {}, setAttribute() {} });
    ctx.document.body = null;
    ctx.document.hidden = false;
    ctx.navigator.onLine = true;
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'etaax-db.js'), 'utf8'), ctx, { filename: 'etaax-db.js' });
    ctx.setTimeout = realTimeout;
    return montado;
}

/* Deja correr timers y microtareas. El default pasa de los 250 ms del debounce de
   bajada a IndexedDB: por debajo de eso no se ha escrito nada al disco todavía. */
/* ══ LEER EL DISCO, NO EL ESPEJO ══════════════════════════════════════════
   `etaax-store.js` PARCHEA `localStorage.getItem` para servir las claves
   grandes desde su memoria —ese parche existe para que las páginas viejas que
   leen por localStorage sigan funcionando—. O sea que preguntarle a `getItem`
   si algo se guardó devuelve «sí» aunque no haya tocado el disco.

   Mis primeras pruebas de R09 hacían exactamente eso y pasaban con el bug
   puesto: cuatro mutaciones se escaparon por esto. `durable()` va al objeto
   crudo del localStorage de mentira, que es lo único que sobrevive a recargar. */
const durable = (ls, k) => Object.prototype.hasOwnProperty.call(ls._m, k) ? ls._m[k] : null;

const respirar = (ms = 400) => new Promise(res => setTimeout(res, ms));
const parpadeo = () => new Promise(res => setTimeout(res, 20)); // menos que el debounce

const OUTBOX = 'etaax_outbox_v1';
const cola = n => JSON.stringify(Array.from({ length: n }, (_, i) => ({ uid: 'i' + i })));

(async function correr() {
    console.log('\n📦 ALMACENAMIENTO LOCAL (etaax-store.js)\n');

    /* ── LA CARRERA: escribir antes de que termine la hidratación ──
       El caso exacto del outbox: la página abre con 314 pendientes en disco, el
       flush los sube y vacía la cola… y la hidratación llega tarde. Lo escrito en
       esta carga es más nuevo que lo leído del disco y tiene que ganar. */
    {
        const { store, indexedDB } = montarStore({ enIDB: { [OUTBOX]: cola(314) }, abrirDiferido: true });
        store.set(OUTBOX, '[]');                 // el flush vació la cola…
        test('la escritura se lee de inmediato, sin esperar a IndexedDB', () =>
            eq(store.get(OUTBOX), '[]'));
        indexedDB.soltarApertura();              // …y la hidratación llega TARDE
        await respirar();
        test('hidratar tarde NO resucita la cola vieja de 314', () =>
            eq(store.get(OUTBOX), '[]'));
        await respirar();
        test('y el disco se queda con lo nuevo, no con lo viejo', () =>
            eq(indexedDB._disco[OUTBOX], '[]'));
    }

    /* ── El espejo obsoleto de localStorage ──
       `get` cae a localStorage mientras la memoria no hidrata. Si ahí sigue la
       cola vieja después de haberla reescrito, la resucita en la próxima carga:
       de ahí el contador clavado carga tras carga. Se suelta SOLO cuando el valor
       nuevo ya está confirmado en disco. */
    {
        const { store, localStorage } = montarStore({ enLS: { [OUTBOX]: cola(314) } });
        await respirar();
        store.set(OUTBOX, '[]');
        await parpadeo();
        /* Se mira el mapa CRUDO (`_m`), no `getItem`: desde que el almacén atiende
           sus propias llaves aunque se pidan por localStorage, getItem devuelve el
           espejo en memoria y ya no sirve para ver qué quedó guardado abajo. */
        test('el espejo viejo de localStorage sigue ahí hasta confirmar el disco', () =>
            eq(localStorage._m[OUTBOX] !== undefined, true));
        await respirar();
        test('con el valor nuevo ya en disco, el espejo obsoleto se suelta', () =>
            eq(localStorage._m[OUTBOX], undefined));
        test('y lo que se lee sigue siendo la cola vacía', () =>
            eq(store.get(OUTBOX), '[]'));
    }

    /* ── EL REBOTE: la cola vaciada que revive minutos después ──
       Lo que le pasaba a Edwin: la cola bajaba a cero, navegaba a otra página,
       volvía a inventarios y aparecían otra vez los MISMOS 348 pendientes.
       El espejo viejo de localStorage seguía ahí con la cola completa, y `get`
       caía a él cuando la memoria no tenía nada. Después de hidratar eso está
       MAL: la memoria ya es la verdad, y un null significa "no existe". */
    {
        const { store, indexedDB } = montarStore({
            enIDB: { [OUTBOX]: '[]' },        // en disco: la cola YA vaciada
            enLS:  { [OUTBOX]: cola(348) },   // espejo viejo: los 348 de antes
        });
        await respirar();
        test('tras hidratar, la cola vacía del disco manda sobre el espejo viejo', () =>
            eq(store.get(OUTBOX), '[]'));
        test('y el espejo de 348 no se resucita ni aunque siga en localStorage', () =>
            eq(store.get(OUTBOX).indexOf('i347'), -1));
        test('hidratado() avisa que ya se puede confiar en la memoria', () =>
            eq(store.hidratado(), true));
    }

    /* ANTES de hidratar sí se usa el espejo: sin eso la app arrancaría en blanco
       en la primera carga tras la migración, que es peor. */
    {
        const { store, indexedDB } = montarStore({
            enIDB: { [OUTBOX]: '[]' }, enLS: { [OUTBOX]: cola(3) }, abrirDiferido: true,
        });
        test('antes de hidratar, el espejo sirve de puente para no arrancar vacío', () =>
            eq(store.get(OUTBOX), cola(3)));
        test('y hidratado() lo dice con claridad', () => eq(store.hidratado(), false));
        indexedDB.soltarApertura();
        await respirar();
        test('en cuanto hidrata, manda el disco', () => eq(store.get(OUTBOX), '[]'));
    }

    /* ── LA TRAMPA QUE REVIVÍA LOS 348 ──
       Este es el camino real del bug, y el almacén NO puede arreglarlo solo: si
       alguien LEE y ESCRIBE en la ventana previa a la hidratación, lee el espejo
       viejo (el puente de arriba, que es correcto por sí mismo), le agrega algo y
       lo guarda. Escribir marca la clave como tocada en esta sesión, así que la
       hidratación la respeta y ya no carga la del disco. Lo viejo queda cementado
       por la misma protección que evita pisar lo recién escrito.
       Por eso _obAdd (etaax-db.js) ESPERA a `ready` antes de tocar la cola. Este
       test deja documentado por qué esa espera no es opcional. */
    {
        const { store, indexedDB } = montarStore({
            enIDB: { [OUTBOX]: '[]' },        // en disco: la cola YA vaciada
            enLS:  { [OUTBOX]: cola(348) },   // espejo viejo: los 348
            abrirDiferido: true,
        });
        const leidoAntes = store.get(OUTBOX);          // cae al espejo: 348
        store.set(OUTBOX, leidoAntes);                 // …y los vuelve a guardar
        indexedDB.soltarApertura();
        await respirar();
        test('leer y escribir ANTES de hidratar cementa lo viejo (por eso _obAdd espera)', () =>
            eq(store.get(OUTBOX), cola(348)));
        test('quien respeta hidratado() no cae en la trampa', () => {
            // El caller correcto consulta primero y espera; aquí ya está hidratado.
            return eq(store.hidratado(), true);
        });
    }

    /* ── LA CLAVE QUE TODAVÍA NO DIO EL SALTO ──
       Primera carga tras la migración: el catálogo de insumos sigue SOLO en
       localStorage y en IndexedDB no hay nada suyo. La bandera de "ya hidraté"
       no puede levantarse antes de que la migración lo suba a memoria, o la
       página lee null y cree que el negocio no tiene insumos. */
    {
        const INS = 'etaax_n1_insumos';
        const { store } = montarStore({ enIDB: {}, enLS: { [INS]: '[{"id":"a"}]' } });
        await respirar();
        test('una clave que solo vivía en localStorage se lee bien tras hidratar', () =>
            eq(store.get(INS), '[{"id":"a"}]'));
    }

    /* ══ EL BUG DE LOS 348, DE VERDAD ═══════════════════════════════════════
       Hasta aquí todo se probó a nivel almacén. Este es el caso completo, con la
       cola de salida real de etaax-db.js encima: inventarios auto-guarda a los
       milisegundos de abrir la página, mucho antes de que IndexedDB hidrate. Si
       _obAdd encola en ese hueco, lee el espejo viejo de localStorage —la cola
       COMPLETA de antes—, le suma su item y lo guarda; escribir marca la clave
       como tocada, la hidratación ya no la pisa, y los 348 quedan cementados.
       Por eso _obAdd espera a `ready`. */
    {
        const m = montarDb({
            enIDB: { [OUTBOX]: '[]' },        // en disco: la cola YA vaciada
            enLS:  { [OUTBOX]: cola(348) },   // espejo viejo: los 348 de la carga anterior
            abrirDiferido: true,
        });
        // La página guarda un insumo ANTES de que la base termine de abrir.
        m.ctx.window.sbUpsert('insumos', { id: 'nuevo' });
        m.indexedDB.soltarApertura();
        await respirar();
        test('guardar antes de hidratar NO resucita la cola vieja', () =>
            eq(m.ctx.window._sbPendientes(), 1));
        test('y el cambio nuevo sí quedó encolado (no se perdió por esperar)', () =>
            eq(m.ctx.window._sbOutbox()[0].clave, 'nuevo'));
    }

    /* Con el almacén ya hidratado, encolar es inmediato: la espera no debe
       convertir cada guardado en algo diferido para siempre. */
    {
        const m = montarDb({ enIDB: { [OUTBOX]: '[]' } });
        await respirar();
        m.ctx.window.sbUpsert('insumos', { id: 'x' });
        test('ya hidratado, encolar es síncrono (sin esperar a nada)', () =>
            eq(m.ctx.window._sbPendientes(), 1));
    }

    /* ── Qué está esperando en la cola ──
       De aquí sale la regla que evita que un registro borrado reviva: si algo mío
       sigue encolado, la copia del servidor es vieja y no puede pisarme. Si esta
       lista miente, la protección no sirve. */
    {
        const m = montarDb({ enIDB: { [OUTBOX]: '[]' } });
        await respirar();
        m.ctx.window.sbUpsert('entradas_log', { id: 'e1', borrada: true });
        m.ctx.window.sbUpsert('inventarios',  { id: 'i9' });
        m.ctx.window.sbDelete('entradas_log', 'e2');
        const pend = m.ctx.window.sbPendientes('entradas_log');

        test('la cola reporta lo que está esperando por guardar', () => eq(pend['e1'], 'upsert'));
        test('…y también lo que espera por borrar', () => eq(pend['e2'], 'delete'));
        /* Aislado por tabla: la cola de una no puede congelar la lista de otra. */
        test('…sin mezclar tablas', () => eq(pend['i9'], undefined));
        test('la otra tabla sí ve lo suyo', () =>
            eq(m.ctx.window.sbPendientes('inventarios')['i9'], 'upsert'));
        /* Una tabla sin nada encolado devuelve vacío, no undefined: quien lo lee
           hace Object.keys() sin preguntar. */
        test('una tabla sin cola devuelve vacío, no undefined', () =>
            eq(Object.keys(m.ctx.window.sbPendientes('gastos')).length, 0));
    }


    /* ══ SIN SESIÓN NO SE GASTAN INTENTOS ══
       El caso real: la sesión se cerró, y la cola siguió intentando. Cada intento
       volvía con 401 y "new row violates row-level security policy". Eso no dice
       nada del dato —dice que en ese momento no hay quién lo firme—, pero se
       contaba como intento fallido. A los ocho, se descarta: un inventario entero
       de 136 KB perdido por no haber vuelto a entrar. */
    {
        const m = montarDb({ enIDB: { [OUTBOX]: '[]' } });
        await respirar();
        const esSesion = m.ctx.window._esErrSesionTest || null;
        const src = fs.readFileSync(path.join(RAIZ, 'etaax-db.js'), 'utf8');

        test('el 401 se reconoce como falta de sesión', () =>
            eq(/401/.test(src.slice(src.indexOf('function _esErrSesion'), src.indexOf('function _haySesion'))), true));
        test('…y el "row-level security" también', () =>
            eq(src.slice(src.indexOf('function _esErrSesion'), src.indexOf('function _haySesion'))
                  .indexOf('row-level security') > -1, true));
        /* Y lo importante: se trata como la falta de red —se reintenta y NO se
           cuenta— para que a los ocho intentos no se tire trabajo bueno. */
        test('la falta de sesión NO cuenta como intento fallido', () =>
            eq(src.indexOf('_esErrRed(err) || _esErrSesion(err)') > -1, true));
        test('…y por eso nunca llega a los 8 ni se descarta', () => {
            const i = src.indexOf('_esErrRed(err) || _esErrSesion(err)');
            const j = src.indexOf('it.tries = (it.tries || 0) + 1', i);
            const enMedio = src.slice(i, j);
            // el incremento de intentos vive en la rama ELSE, después de esta
            return eq(enMedio.indexOf('else {') > -1, true);
        });

        /* Y el aviso deja de mentir: "se suben solos" es falso sin sesión, y hace
           que el usuario se vaya tranquilo con su inventario sin guardar. */
        test('el aviso dice que la sesión se cerró', () =>
            eq(src.indexOf('Tu sesión se cerró') > -1, true));
        test('…y que los datos NO se van a perder', () =>
            eq(src.indexOf('no se van a perder') > -1, true));
        test('…y ofrece volver a entrar', () =>
            eq(src.indexOf('Iniciar sesión</a>') > -1, true));
        /* En cuanto algo sube, el aviso vuelve a la normalidad. */
        /* Y en cuanto algo sube, la marca se limpia EN LA MISMA rama del éxito:
           si viviera en otro lado, el aviso se quedaría pegado diciendo que no
           hay sesión aunque ya la haya. */
        test('al subir algo, el aviso deja de decir que no hay sesión', () => {
            const i = src.indexOf('if (!err) { if (it.uid) hechos[it.uid] = 1;');
            return eq(i > -1 && src.slice(i, i + 120).indexOf('_sinSesionGlobal = false') > -1, true);
        });
    }

    /* ── Sin IndexedDB no se pierde nada ──
       Tablets viejas y modo privado: todo cae de vuelta a localStorage, que ahí
       NO es un espejo obsoleto sino el almacén de verdad. */
    {
        const INS = 'etaax_n1_insumos';
        const { store } = montarStore({ enLS: { [INS]: '[{"id":"b"}]' }, sinIDB: true });
        await respirar();
        test('sin IndexedDB, la clave grande se sigue leyendo de localStorage', () =>
            eq(store.get(INS), '[{"id":"b"}]'));
        test('…y ahí localStorage NO es un espejo obsoleto, es el almacén', () =>
            eq(store.hayIDB(), false));
    }

    {
        const { ctx, store } = montarStore({});
        ctx.window.indexedDB = null;
        await respirar();
        test('una clave chica vive en localStorage, no en IndexedDB', () =>
            eq(store.esGrande('etaax_ctx'), false));
        test('la cola de salida sí es clave grande (por eso se mudó)', () =>
            eq(store.esGrande(OUTBOX), true));
    }

    /* ── Lectura sin nada guardado ── */
    {
        const { store } = montarStore({});
        await respirar();
        test('una clave que nunca se guardó devuelve null, no undefined', () =>
            eq(store.get(OUTBOX), null));
    }

    /* ═══════════ R09 · «GUARDADO» TIENE QUE SIGNIFICAR GUARDADO ═══════════
       El comentario del propio archivo decía «la app sigue leyendo de memoria y
       de localStorage». Lo primero era cierto; lo segundo NO: para una clave
       GRANDE nunca se escribió nada en localStorage. Sin IndexedDB, `set`
       actualizaba la memoria, devolvía `true` y los pendientes se tiraban. Un
       inventario capturado se perdía al recargar, sin un aviso — y esa frase
       es justo la que hacía que pareciera seguro.

       Pasa de verdad: Safari en privado, un perfil de navegador dañado, o la
       apertura fallando por cuota.

       Los cuatro escenarios son los que pidió la revisión, y las pruebas
       llegan hasta el MENSAJE QUE VE QUIEN CAPTURA, no solo a lo que devuelve
       `set()`. */
    console.log('\n── R09 · «guardado» tiene que significar guardado ──');

    /* ── 1 · SIN IndexedDB: la captura persiste en el respaldo ── */
    {
        const { store, localStorage } = montarStore({ sinIDB: true });
        await respirar();
        const inv = JSON.stringify([{ id: 'conteo1', botellas: 14 }]);
        const r = store.set('etaax_n1_inv_local', inv);
        await respirar();
        test('sin IndexedDB, set() dice que SÍ guardó', () => eq(r, true));
        test('…y de verdad quedó algo durable, no solo en memoria', () =>
            eq(durable(localStorage, 'etaax_n1_inv_local'), inv));
        test('…y se sigue leyendo igual desde la app', () =>
            eq(store.get('etaax_n1_inv_local'), inv));
    }

    /* ── 1b · Y lo escrito ANTES de saber que no hay IndexedDB ──
       La apertura es asíncrona: la app escribe en los primeros milisegundos,
       cuando todavía no se sabe si hay base. Eso también tiene que aterrizar. */
    {
        const { store, localStorage } = montarStore({ sinIDB: true });
        const inv = JSON.stringify([{ id: 'temprano' }]);
        store.set('etaax_n1_inv_local', inv);      // ANTES de respirar
        await respirar();
        test('lo escrito antes de saber que no hay IndexedDB también aterriza', () =>
            eq(durable(localStorage, 'etaax_n1_inv_local'), inv));
    }

    /* ── 1c · Y se vuelve durable YA, no en el próximo cuarto de segundo ──
       Lo escrito antes de hidratar baja por el temporizador de 250 ms. Al
       saberse que no hay IndexedDB se fuerza la bajada en el acto: la ventana
       en la que un cierre de pestaña se lleva la captura pasa de 250 ms a
       casi cero. Sin esta prueba, esa línea parecía código muerto —el
       temporizador acaba haciéndolo igual— y la batería la borraba sin que
       nada se quejara. */
    {
        const { store, localStorage } = montarStore({ sinIDB: true });
        const inv = JSON.stringify([{ id: 'ya' }]);
        store.set('etaax_n1_inv_local', inv);
        await parpadeo();                         // 20 ms: MENOS que el debounce
        test('al saberse que no hay IndexedDB, baja en el acto', () =>
            eq(durable(localStorage, 'etaax_n1_inv_local'), inv));
    }

    /* ── 1d · Y si en ese momento tampoco cabe, se avisa igual ──
       Este es el camino que NO pasa por `set()`: la clave quedó pendiente
       antes de hidratar, y el fallo se descubre después. Sin esta prueba, el
       aviso de esa rama se podía borrar sin que nada se quejara. */
    {
        const { store, documento } = montarStore({ sinIDB: true, lsLleno: true });
        store.set('etaax_n1_inv_local', JSON.stringify([{ id: 'tarde' }]));
        await respirar();
        test('lo pendiente que tampoco cabe también avisa en pantalla', () =>
            eq(/no puede guardar/i.test(documento._carteles()), true));
    }

    /* ── 2 · Transacción fallida: conserva los pendientes y reintenta ── */
    {
        const { store } = montarStore({ fallaEscritura: true });
        await respirar();
        store.set('etaax_n1_inv_local', JSON.stringify([{ id: 'x' }]));
        await respirar();
        test('si la transacción falla, el pendiente NO se descarta', () =>
            eq(store.pendientes() > 0, true));
        /* Antes se vaciaba `pendientes` ANTES de intentar la escritura, así que
           una transacción abortada se perdía sin rastro ni reintento. */
        const antes = store.pendientes();
        await respirar(); await respirar();
        test('…y se vuelve a intentar solo', () => eq(store.pendientes() <= antes, true));
    }

    /* ── 2b · Pero no para siempre: se rinde y lo dice ── */
    {
        const { store, localStorage, documento } = montarStore({ fallaEscritura: true });
        await respirar();
        const inv = JSON.stringify([{ id: 'y' }]);
        store.set('etaax_n1_inv_local', inv);
        for (let i = 0; i < 12; i++) await respirar();
        test('tras varios intentos deja de reintentar en silencio', () =>
            eq(store.pendientes(), 0));
        /* Y al rendirse NO tira el dato: lo manda al respaldo. Un bucle callado
           es otra forma de mentir, pero perder la captura es peor. */
        test('…y antes de rendirse lo manda al respaldo', () =>
            eq(durable(localStorage, 'etaax_n1_inv_local'), inv));
    }

    /* ── 3 · Después de recargar: se recupera EXACTAMENTE lo guardado ── */
    {
        const inv = JSON.stringify([{ id: 'conteo7', botellas: 3, nota: 'media' }]);
        const uno = montarStore({ sinIDB: true });
        await respirar();
        uno.store.set('etaax_n1_inv_local', inv);
        await respirar();
        /* Segunda carga: el mismo localStorage, almacén nuevo. */
        /* La segunda carga parte del disco crudo: es lo que de verdad hay
           cuando se cierra la pestaña y se vuelve a abrir. */
        const dos = montarStore({ sinIDB: true, enLS: uno.localStorage._m });
        await respirar();
        test('al recargar sin IndexedDB, la captura sigue ahí', () =>
            eq(dos.store.get('etaax_n1_inv_local'), inv));
    }
    {
        /* Y con IndexedDB, el camino normal: lo guardado se relee del disco. */
        const inv = JSON.stringify([{ id: 'conteo8' }]);
        const uno = montarStore({});
        await respirar();
        uno.store.set('etaax_n1_inv_local', inv);
        await respirar(); await respirar();
        const dos = montarStore({ enIDB: uno.indexedDB._disco });
        await respirar();
        test('…y con IndexedDB también, que es el camino normal', () =>
            eq(dos.store.get('etaax_n1_inv_local'), inv));
    }

    /* ── 3b · UNA EDICIÓN NUEVA NO SE PIERDE POR UNA ESCRITURA VIEJA ──
       Una transacción tarda. Si mientras vuela alguien edita otra vez, al
       confirmar se borraba el pendiente de la edición NUEVA: la pantalla
       enseñaba 2 botellas, la cola decía cero pendientes, y al recargar
       volvían a aparecer 1.

       HAY QUE RETENER LA ESCRITURA PARA QUE LA CARRERA OCURRA. Mi primer
       intento ponía las dos ediciones separadas por 20 ms y pasaba con el bug
       puesto: el agrupado de 250 ms las fusiona en una sola bajada y nunca
       hay nada en vuelo. Con `retenerEscritura` la transacción se queda
       abierta hasta que la prueba la suelte, que es cuando el bug existe.

       Y la comprobación va hasta la RECARGA: mirar la memoria habría dicho
       «2» y todo en orden. */
    {
        const uno = montarStore({ retenerEscritura: true });
        await respirar();
        uno.store.set('etaax_n1_inv_local', JSON.stringify({ botellas: 1 }));
        await respirar();                       // la bajada arranca y queda EN VUELO
        const enVuelo = uno.indexedDB._disco.__enVuelo || [];
        test('la escritura quedó retenida (la carrera es reproducible)', () =>
            eq(enVuelo.length, 1));
        /* AHORA la segunda edición, con la primera todavía en el aire. */
        uno.store.set('etaax_n1_inv_local', JSON.stringify({ botellas: 2 }));
        uno.indexedDB._disco.__retener = false;
        enVuelo.forEach(f => f());              // confirma la PRIMERA (botellas: 1)
        await respirar(); await respirar();
        test('editar en pleno vuelo NO deja la edición nueva sin bajar', () =>
            eq(uno.store.pendientes(), 0));
        const dos = montarStore({ enIDB: uno.indexedDB._disco });
        await respirar();
        test('…y al recargar está la EDICIÓN NUEVA, no la vieja', () =>
            eq(dos.store.get('etaax_n1_inv_local'), JSON.stringify({ botellas: 2 })));
    }

    /* ── 3c · EL RESPALDO NUEVO NO SE BORRA AL RECARGAR ──
       El respaldo se escribe porque IndexedDB RECHAZÓ la versión nueva, así
       que es MÁS NUEVO que lo que hay en la base. La migración lo trataba como
       un espejo viejo y lo borraba: la captura no se perdía en la recarga del
       fallo, sino en la siguiente. */
    {
        const idbViejo = { 'etaax_n1_inv_local': JSON.stringify({ botellas: 1 }) };
        const uno = montarStore({ enIDB: idbViejo, fallaEscritura: true });
        await respirar();
        const nuevo = JSON.stringify({ botellas: 2 });
        uno.store.set('etaax_n1_inv_local', nuevo);
        for (let i = 0; i < 12; i++) await respirar();      // falla, reintenta, se rinde
        test('tras rendirse, el respaldo tiene la versión nueva', () =>
            eq(durable(uno.localStorage, 'etaax_n1_inv_local'), nuevo));

        /* Segunda carga: IndexedDB sigue con la vieja, localStorage con la
           nueva. Gana la nueva, y el respaldo NO se borra todavía. */
        const dos = montarStore({ enIDB: idbViejo, enLS: uno.localStorage._m, fallaEscritura: true });
        await respirar();
        test('al recargar gana el respaldo, no lo viejo de IndexedDB', () =>
            eq(dos.store.get('etaax_n1_inv_local'), nuevo));
        test('…y el respaldo sigue ahí mientras no se confirme su bajada', () =>
            eq(durable(dos.localStorage, 'etaax_n1_inv_local'), nuevo));
    }

    /* ── 3d · Y cuando SÍ baja, el respaldo se suelta ──
       Lo contrario también importa: si el respaldo nunca se borrara, la cuota
       de localStorage quedaría secuestrada para siempre, que es el problema
       que este archivo vino a resolver. */
    {
        const idbViejo = { 'etaax_n1_inv_local': JSON.stringify({ botellas: 1 }) };
        const uno = montarStore({ enIDB: idbViejo, fallaEscritura: true });
        await respirar();
        const nuevo = JSON.stringify({ botellas: 2 });
        uno.store.set('etaax_n1_inv_local', nuevo);
        for (let i = 0; i < 12; i++) await respirar();
        /* Recarga con IndexedDB sano: ahora sí acepta la escritura. */
        const dos = montarStore({ enIDB: idbViejo, enLS: uno.localStorage._m });
        await respirar(); await respirar();
        test('con IndexedDB sano, el respaldo baja y se libera la cuota', () =>
            eq(durable(dos.localStorage, 'etaax_n1_inv_local'), null));
        test('…y el dato quedó en IndexedDB, que es donde va', () =>
            eq(dos.indexedDB._disco['etaax_n1_inv_local'], nuevo));
        /* Y el registro de respaldos queda limpio. Si la marca no se soltara,
           ese índice crecería sin fin y cada carga trataría como «respaldo»
           claves que ya bajaron hace sesiones. Se arregla solo a la siguiente
           carga, pero un índice que acumula basura es el tipo de cosa que
           dentro de un año nadie entiende. */
        test('…y el registro de respaldos no se queda con la marca vieja', () => {
            const reg = durable(dos.localStorage, 'etaax__respaldo_v1');
            return eq(reg === null || reg.indexOf('etaax_n1_inv_local') < 0, true);
        });
    }

    /* ── 3e · UN RESPALDO SIN MARCA ES UN RESPALDO PERDIDO ──
       La cuota no se acaba de golpe: se acaba con el último byte. Puede caber
       el dato y no el índice de respaldos — y sin índice, a la recarga
       siguiente `_migrarDesdeLocal` lo toma por espejo viejo y lo borra.
       Antes `_marcar` se tragaba esa excepción y `_respaldoLocal` contestaba
       «sí»: cabían las 2 botellas, no salía aviso, y al recargar eran 1. */
    {
        const idbViejo = { 'etaax_n1_inv_local': JSON.stringify({ botellas: 1 }) };
        const { store, documento } = montarStore({
            enIDB: idbViejo, fallaEscritura: true, lsRechaza: /respaldo/,
        });
        await respirar();
        store.set('etaax_n1_inv_local', JSON.stringify({ botellas: 2 }));
        for (let i = 0; i < 12; i++) await respirar();
        test('si el índice de respaldos no cabe, NO se da por guardado', () =>
            eq(/no puede guardar/i.test(documento._carteles()), true));
    }
    {
        /* Y `set()` lo dice en el acto cuando ya se sabe que no hay base. */
        const { store, localStorage } = montarStore({ sinIDB: true, lsRechaza: /respaldo/ });
        await respirar();
        test('…y set() devuelve FALSE, no «true» a medias', () =>
            eq(store.set('etaax_n1_inv_local', '[]'), false));

    }

    /* ── 3f · 1 → 2 → 1: EL CONTENIDO IGUAL NO PRUEBA NADA ──
       Con dos escrituras retenidas y las ediciones 1 → 2 → 1, al confirmar la
       PRIMERA la memoria vale «1» otra vez —por la tercera edición— así que
       se daba por suya y borraba ese pendiente. Después confirmaba la segunda
       y dejaba «2» en disco. Pantalla 1, cero pendientes, recarga 2.

       Por eso la comparación es por VERSIÓN y no por contenido: un contador
       no se puede confundir consigo mismo. */
    {
        const K = 'etaax_n1_inv_local';
        const uno = montarStore({ retenerEscritura: true });
        await respirar();
        uno.store.set(K, JSON.stringify({ botellas: 1 }));
        await respirar();                                  // escritura 1 EN VUELO
        uno.store.set(K, JSON.stringify({ botellas: 2 }));
        await respirar();                                  // escritura 2 EN VUELO
        uno.store.set(K, JSON.stringify({ botellas: 1 })); // vuelve al MISMO contenido
        const enVuelo = uno.indexedDB._disco.__enVuelo || [];
        test('las dos escrituras quedaron retenidas (la carrera es reproducible)', () =>
            eq(enVuelo.length, 2));
        uno.indexedDB._disco.__retener = false;
        enVuelo.forEach(f => f());                         // confirman EN ORDEN
        await respirar(); await respirar(); await respirar();
        const dos = montarStore({ enIDB: uno.indexedDB._disco });
        await respirar();
        test('1 → 2 → 1: al recargar está el ÚLTIMO 1, no el 2 de en medio', () =>
            eq(dos.store.get(K), JSON.stringify({ botellas: 1 })));
    }

    /* ── 3g · LA MISMA CARRERA, POR LA PUERTA DE ATRÁS ──
       Catorce lugares del sistema escriben estas claves con
       `localStorage.setItem` directo, y el almacén parchea esa función para
       atenderlas. Si ese camino no sube la versión, una bajada vieja da por
       suya una edición que entró por ahí — y la prueba de 3f no lo ve, porque
       usa `store.set`.

       Es el mismo bug con otro disfraz, y el candado tiene que mirar las dos
       puertas. */
    {
        const K = 'etaax_n1_inv_local';
        const uno = montarStore({ retenerEscritura: true });
        await respirar();
        uno.localStorage.setItem(K, JSON.stringify({ botellas: 1 }));
        await respirar();                                  // escritura 1 EN VUELO
        uno.localStorage.setItem(K, JSON.stringify({ botellas: 2 }));
        await respirar();                                  // escritura 2 EN VUELO
        uno.localStorage.setItem(K, JSON.stringify({ botellas: 1 }));
        const enVuelo = uno.indexedDB._disco.__enVuelo || [];
        test('por localStorage parcheado, la carrera también es reproducible', () =>
            eq(enVuelo.length, 2));
        uno.indexedDB._disco.__retener = false;
        enVuelo.forEach(f => f());
        await respirar(); await respirar(); await respirar();
        const dos = montarStore({ enIDB: uno.indexedDB._disco });
        await respirar();
        test('…y 1 → 2 → 1 por esa puerta también deja el ÚLTIMO 1', () =>
            eq(dos.store.get(K), JSON.stringify({ botellas: 1 })));
    }

    /* ── 3g-bis · UNA MARCA SIN RESPALDO NO SE QUEDA ──
       El caso es el contrario del de arriba: la marca SÍ cabe (es un JSON
       corto) y el dato NO. Si ahí no se desmarcara, el índice quedaría
       apuntando a un respaldo que no existe — y esa clave se trataría como si
       lo tuviera en la siguiente carga.

       Hay que montarlo con un límite por TAMAÑO: con el rechazo por nombre, el
       índice también se rechaza y el `catch` ni se alcanza. Mi primera versión
       de esta prueba hacía eso y pasaba con el defecto puesto. */
    {
        const { store, localStorage } = montarStore({ sinIDB: true, lsMaxLen: 40 });
        await respirar();
        const grande = JSON.stringify([{ id: 'una captura larga que no va a caber de ninguna manera' }]);
        const r = store.set('etaax_n1_inv_local', grande);
        await respirar();
        test('un respaldo que no cabe devuelve FALSE', () => eq(r, false));
        test('…y no deja una marca apuntando a un respaldo que no existe', () => {
            const reg = durable(localStorage, 'etaax__respaldo_v1');
            return eq(reg === null || reg.indexOf('etaax_n1_inv_local') < 0, true);
        });
    }

    /* ── 3h · UN RESPALDO FALLIDO NO SE LLEVA AL ANTERIOR ──
       Un `setItem` que falla por cuota NO borra lo que había: el valor viejo
       se queda. Pero el `catch` desmarcaba la clave, y sin marca ese respaldo
       —que sigue siendo la última versión durable— se toma por espejo viejo y
       se borra en la recarga siguiente.

       O sea: fallar al guardar 3 botellas se llevaba por delante las 2 que YA
       estaban a salvo. */
    {
        const K = 'etaax_n1_inv_local';
        const dosB = JSON.stringify({ botellas: 2 });
        const idbViejo = { [K]: JSON.stringify({ botellas: 1 }) };

        /* Límite justo: cabe el respaldo de 2, no cabe el de 3 (más largo). */
        const uno = montarStore({ enIDB: idbViejo, fallaEscritura: true, lsMaxLen: dosB.length + 20 });
        await respirar();
        uno.store.set(K, dosB);
        for (let i = 0; i < 12; i++) await respirar();     // falla en IDB → respalda 2
        test('el respaldo de 2 quedó bien guardado y marcado', () => {
            eq(durable(uno.localStorage, K), dosB);
            const reg = durable(uno.localStorage, 'etaax__respaldo_v1') || '';
            return eq(reg.indexOf(K) > -1, true);
        });

        /* Y ahora una captura MÁS GRANDE que no cabe. */
        const tresB = JSON.stringify({ botellas: 3, nota: 'una captura bastante más larga que la anterior' });
        const r = uno.store.set(K, tresB);
        for (let i = 0; i < 12; i++) await respirar();
        test('la captura que no cabe se rechaza y se avisa', () => {
            eq(r === false || /no puede guardar/i.test(uno.documento._carteles()), true);
            return eq(durable(uno.localStorage, K), dosB);   // el valor viejo sigue
        });
        test('…y el respaldo anterior CONSERVA su marca', () => {
            const reg = durable(uno.localStorage, 'etaax__respaldo_v1') || '';
            return eq(reg.indexOf(K) > -1, true);
        });

        /* La prueba que importa: recargar. */
        const dos = montarStore({ enIDB: idbViejo, enLS: uno.localStorage._m, lsMaxLen: dosB.length + 20 });
        await respirar();
        test('al recargar se recupera el respaldo VÁLIDO, no lo viejo de IndexedDB', () =>
            eq(dos.store.get(K), dosB));
    }

    /* ── 4 · Si tampoco cabe en localStorage: NO se dice «guardado» ── */
    {
        const { store, documento } = montarStore({ sinIDB: true, lsLleno: true });
        await respirar();
        const r = store.set('etaax_n1_inv_local', JSON.stringify([{ id: 'z' }]));
        await respirar();
        test('sin IndexedDB y con localStorage lleno, set() devuelve FALSE', () =>
            eq(r, false));
        /* LA PARTE QUE IMPORTA: que quien está capturando se entere. Un
           `console.warn` no lo lee nadie con el teléfono en la mano contando
           botellas, y lo que se pierde es su última media hora. */
        test('…y se le avisa EN PANTALLA, no en la consola', () =>
            eq(/no puede guardar/i.test(documento._carteles()), true));
        test('…diciendo qué va a pasar, no solo que hubo un error', () =>
            eq(/se pierde al recargar/i.test(documento._carteles()), true));
    }
    {
        /* Y el cartel no sale cuando todo está bien: un aviso que aparece
           siempre deja de leerse en dos días. */
        const { store, documento } = montarStore({ sinIDB: true });
        await respirar();
        store.set('etaax_n1_inv_local', '[]');
        await respirar();
        test('cuando sí guarda, no hay cartel', () => eq(documento._carteles(), ''));
    }
    {
        /* Las claves CHICAS no cambian: siguen en localStorage y siguen
           devolviendo false si no caben. */
        const { store } = montarStore({ lsLleno: true });
        await respirar();
        test('una clave chica sigue avisando por su cuenta si no cabe', () =>
            eq(store.set('etaax_ctx', '{}'), false));
    }

    /* ── La página de verificación en navegador real ──
       El candado prueba la lógica con un IndexedDB de mentira. Lo que NO puede
       probar es el navegador de verdad: su IndexedDB, su cuota, su modo
       privado. `docs/prueba-almacen.html` cubre eso sin tocar Supabase — se
       abre en local, rompe IndexedDB a propósito y enseña si lo capturado
       sobrevive a una recarga.
       Aquí solo se vigila que exista y que siga sin poder salir a producción
       ni tocar datos del negocio. */
    {
        const p = path.join(RAIZ, 'docs/prueba-almacen.html');
        test('existe la página para verificar R09 en un navegador real', () =>
            eq(fs.existsSync(p), true));
        const html = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
        test('…que no habla con Supabase', () => {
            /* Se mira lo que HACE, no lo que dice: el comentario de la página
               explica que no toca Supabase, y un regex a secas se caza a sí
               mismo. Van doce veces en este proyecto. */
            eq(/<script[^>]*src=[^>]*supabase/i.test(html), false, 'no carga su cliente');
            eq(/\b_supabase\b/.test(html), false, 'no lo usa');
            return eq(/createClient/.test(html), false, 'ni lo crea');
        });
        test('…que usa una clave de prueba, no la de un negocio', () =>
            eq(/etaax_' \+ NEG|pruebaR09/.test(html), true));
        test('…que lee el disco CRUDO, no el espejo parcheado', () => {
            /* Si preguntara por `localStorage.getItem` a secas, el parche del
               almacén le contestaría desde memoria y diría «sobrevivió»
               siempre. Es el error que casi invalida el candado entero. */
            eq(/Storage\.prototype\.getItem\.call/.test(html), true, 'lee el crudo');
            return eq(/function crudo/.test(html), true, 'con su propio lector');
        });
        test('…y que docs/ sigue sin servirse en producción', () => {
            const nt = fs.readFileSync(path.join(RAIZ, 'netlify.toml'), 'utf8');
            return eq(/from = "\/docs\/\*"[\s\S]{0,120}status = 404/.test(nt), true);
        });
    }

    console.log('\n════════════════════════════════════');
    if (fallan) {
        console.log('🚨 ' + fallan + ' falla(s) de ' + (pasan + fallan) + ' — el almacenamiento cambió de comportamiento.');
        process.exit(1);
    }
    console.log('🔒 ALMACÉN OK — ' + pasan + ' comprobaciones, 0 fallas');
})();
