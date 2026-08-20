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
function montarStore({ enIDB = {}, enLS = {}, abrirDiferido = false } = {}) {
    const localStorage = hacerLS(enLS);
    const indexedDB    = hacerIDB(enIDB, { abrirDiferido });
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
        test('el espejo viejo de localStorage sigue ahí hasta confirmar el disco', () =>
            eq(localStorage.getItem(OUTBOX) !== null, true));
        await respirar();
        test('con el valor nuevo ya en disco, el espejo obsoleto se suelta', () =>
            eq(localStorage.getItem(OUTBOX), null));
        test('y lo que se lee sigue siendo la cola vacía', () =>
            eq(store.get(OUTBOX), '[]'));
    }

    /* ── Sin IndexedDB no se pierde nada ──
       Tablets viejas y modo privado: todo cae de vuelta a localStorage. */
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
