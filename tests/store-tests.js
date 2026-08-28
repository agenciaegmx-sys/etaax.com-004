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
                put(v, k) { disco[k] = v; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); },
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
function hacerLS(inicial) {
    const m = Object.assign({}, inicial);
    return {
        _m: m,
        get length() { return Object.keys(m).length; },
        key(i) { return Object.keys(m)[i]; },
        getItem(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem(k, v) { m[k] = String(v); },
        removeItem(k) { delete m[k]; },
    };
}

// Levanta etaax-store.js en un contexto propio y devuelve sus piezas.
function montarStore({ enIDB = {}, enLS = {}, abrirDiferido = false, sinIDB = false } = {}) {
    const localStorage = hacerLS(enLS);
    /* `sinIDB` tiene que valer ANTES de levantar el script: el almacén abre la base
       al cargarse, así que anular window.indexedDB después ya no prueba nada. */
    const indexedDB    = sinIDB ? null : hacerIDB(enIDB, { abrirDiferido });
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise, JSON, Object, String, Date, Math,
        localStorage, indexedDB,
        document: { visibilityState: 'visible' },
        navigator: {},
    };
    ctx.window = ctx;
    ctx.window.addEventListener = () => {};
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'etaax-store.js'), 'utf8'), ctx, { filename: 'etaax-store.js' });
    return { ctx, store: ctx.window.etaaxStore, localStorage, indexedDB };
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

    console.log('\n════════════════════════════════════');
    if (fallan) {
        console.log('🚨 ' + fallan + ' falla(s) de ' + (pasan + fallan) + ' — el almacenamiento cambió de comportamiento.');
        process.exit(1);
    }
    console.log('🔒 ALMACÉN OK — ' + pasan + ' comprobaciones, 0 fallas');
})();
