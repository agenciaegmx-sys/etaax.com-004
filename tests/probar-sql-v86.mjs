/* MIGRAR UNA SUCURSAL A OTRO NEGOCIO — de punta a punta contra un Postgres
   DE VERDAD (PGlite): se siembra un negocio con tres sucursales y catálogo
   compartido, el PLAN lo arma el motor real (admin-migrar-sucursal.js) y lo
   aplica la función real (supabase-migration-v86.sql).

   Lo que se vigila:
     · lo de la sucursal se muda completo (y lo de las otras, no);
     · el catálogo se COPIA y en el origen solo pierde la sucursal;
     · las referencias a recetas se cambian a sus ids nuevos;
     · horarios y menú cambian de id, las fotos privadas de carpeta;
     · todo o nada: si un documento cambió mientras se revisaba, no se toca nada;
     · solo el admin; la Matriz no.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado fuera
   del proyecto. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {PGlite} = createRequire((process.env.PGLITE_DIR || '/tmp/etaax-billing-sql') + '/test.cjs')('@electric-sql/pglite');
vm.runInThisContext(fs.readFileSync(path.join(RAIZ, 'admin-migrar-sucursal.js'), 'utf8'));
const MigSuc = globalThis.MigSuc;

let cuenta = 0;
const ok = async (nombre, fn) => { await fn(); cuenta++; console.log('PASA ' + nombre); };
const falla = async (fn, patron) => {
    let e = null;
    try { await fn(); } catch (x) { e = x; }
    assert.ok(e, 'no falló y debía fallar');
    if (patron) assert.match(String(e.message), patron);
};

async function mundo() {
    const db = new PGlite();
    const q = async (sql, args) => (await db.query(sql, args)).rows;
    const REG = MigSuc.POR_SUCURSAL.map(x => x.t).concat(MigSuc.HIJOS.map(h => h.t), ['menu_publico', 'recetas']);
    await db.exec(`
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('req.uid', true), '')::uuid $$;
      CREATE FUNCTION is_platform_admin() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('req.admin', true), '') = '1' $$;
      CREATE TABLE negocios (id TEXT PRIMARY KEY, usuario_id UUID, datos JSONB DEFAULT '{}');
      ${REG.map(t => `CREATE TABLE ${t} (id TEXT PRIMARY KEY, negocio_id TEXT REFERENCES negocios(id), datos JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());`).join('\n')}
      CREATE TABLE negocio_insumos (negocio_id TEXT REFERENCES negocios(id), insumo_id TEXT, datos JSONB NOT NULL DEFAULT '{}', PRIMARY KEY (negocio_id, insumo_id));
      ${MigSuc.DOCS.map(t => `CREATE TABLE ${t} (negocio_id TEXT PRIMARY KEY REFERENCES negocios(id), datos JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());`).join('\n')}
    `);
    await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v86.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v87.sql'), 'utf8'));
    const ins = (t, id, neg, d) => q(`INSERT INTO ${t} (id, negocio_id, datos) VALUES ($1, $2, $3)`, [id, neg, JSON.stringify(Object.assign({ id }, d))]);
    const insI = (neg, id, d) => q(`INSERT INTO negocio_insumos (negocio_id, insumo_id, datos) VALUES ($1, $2, $3)`, [neg, id, JSON.stringify(Object.assign({ id }, d))]);
    const insDoc = (t, neg, d) => q(`INSERT INTO ${t} (negocio_id, datos) VALUES ($1, $2)`, [neg, JSON.stringify(d)]);
    await q(`INSERT INTO negocios (id, datos) VALUES ('A', '{"nombre":"EGMx"}'), ('B', '{"nombre":"Miami SA"}'), ('C', '{"nombre":"Vacío"}')`);
    const S = 'suc_mia';
    // Catálogo del origen.
    await insI('A', 'i1', { nombre: 'Ron', sucursales: ['suc_principal', S] });              // compartido
    await insI('A', 'i2', { nombre: 'Limón', sucursales: [S] });                             // solo de la sucursal
    await insI('A', 'i3', { nombre: 'Tequila', sucursales: ['suc_principal'] });             // maestro…
    await insI('A', 'i3c', { nombre: 'Tequila (Miami)', origenId: 'i3', sucursales: [S] });  // …y su copia de la sucursal
    await insI('A', 'i4', { nombre: 'Mezcal', sucursales: ['suc_tul'] });                    // de otra sucursal
    await insI('A', 'i5', { nombre: 'Vermut', sucursales: [] });                             // sin asignar, pero un inventario lo usa
    await insI('A', 'prod_1', { nombre: 'Batch Paloma', esSubReceta: true, recetaId: 'r_sub', sucursales: [S] });
    await ins('recetas', 'r1', 'A', { nombre: 'Mojito', sucursales: ['suc_principal', S], ingredientes: [{ insumoId: 'i1' }, { insumoId: 'i2' }] });
    await ins('recetas', 'r2', 'A', { nombre: 'Paloma', sucursales: [S], ingredientes: [{ insumoId: 'i3' }, { insumoId: 'prod_1' }] });
    await ins('recetas', 'r_sub', 'A', { nombre: 'Sub Paloma', sucursales: [S], esSubReceta: true });
    await ins('recetas', 'r3', 'A', { nombre: 'Margarita', sucursales: ['suc_principal'] });
    await ins('recetas', 'r3c', 'A', { nombre: 'Margarita Miami', origenId: 'r3', sucursales: [S] });
    await ins('recetas', 'r4', 'A', { nombre: 'Tulum Sour', sucursales: ['suc_tul'] });
    await ins('recetas', 'r5', 'A', { nombre: 'Negroni', sucursales: ['suc_principal'] });     // no es de la sucursal, pero se vendió ahí
    // Registros.
    await ins('cortes', 'c1', 'A', { negocioId: 'A', sucursalId: S, fecha: '2026-11-20', foto: 'priv:A/cortes/f1.jpg', fotoPub: 'https://x/storage/v1/object/public/evidencias/A/carta/p.jpg' });
    await ins('cortes', 'c2', 'A', { negocioId: 'A', fecha: '2026-11-20' });                 // Matriz (sin sello)
    await ins('cortes', 'c3', 'A', { negocioId: 'A', sucursalId: 'suc_tul', fecha: '2026-11-20' });
    await ins('inventarios', 'inv1', 'A', { sucursalId: S, filas: [{ insumoId: 'i1' }, { insumoId: 'i5' }], cocktailsVendidos: { r1: 3, r5: 2 },
        entradasLog: [{ id: 'e1', sucursalId: S, insumoId: 'i3' }] });
    await ins('entradas_log', 'e1', 'A', { sucursalId: S, insumoId: 'i3', foto_urls: ['priv:A/entradas/f2.jpg'] });
    await ins('entradas_log', 'e2', 'A', { insumoId: 'i1' });
    await ins('staff', 'st1', 'A', { sucursalId: S, nombre: 'Ana', usuario: 'ana' });
    await ins('staff', 'st2', 'A', { nombre: 'Beto', usuario: 'beto' });
    await ins('nomina_recibos', 'nr1', 'A', { staffId: 'st1' });
    await ins('nomina_recibos', 'nr2', 'A', { staffId: 'st2' });
    await ins('evaluaciones', 'ev1', 'A', { sucursalId: S });
    await ins('evaluacion_respuestas', 'er1', 'A', { evaluacionId: 'ev1' });
    await ins('horarios', 'hor_1_A_suc_mia_2026-W47', 'A', { sucursalId: S, semana: '2026-W47', turnos: { st1: {} } });
    await ins('menu_publico', 'A|' + S, 'A', { items: [{ recetaId: 'r1' }] });
    await insDoc('negocio_sucursales', 'A', { sucursales: [{ id: 'suc_principal', nombre: 'Matriz' }, { id: S, nombre: 'El Miami', activa: true }, { id: 'suc_tul', nombre: 'Tulum' }],
        cfg: { [S]: { color: 'azul' }, suc_tul: { color: 'rojo' } } });
    await insDoc('negocio_sucursales', 'B', { sucursales: [{ id: 'suc_principal', nombre: 'Matriz B' }] });
    await insDoc('inv_ajustes', 'A', { compuestos: { [S]: [{ id: 'comp1', miembros: ['i1', 'i2'] }], suc_tul: [] }, bateo: { [S]: [{ recetaId: 'r_sub', f: 2 }] } });
    await insDoc('gf_nomina_params', 'A', { jornadaHoras: 8, porSucursal: { [S]: { jornadaHoras: 6 } } });
    await insI('B', 'i1', { nombre: 'Ron (ficha de B)', sucursales: ['suc_principal'] });     // el destino ya lo tenía
    return { db, q, S };
}

// Lo que el panel lee (la misma forma que MigSuc.cargar).
async function leer(q, origen, destino) {
    const O = { negocio: { id: origen }, tablas: {}, docs: {} }, D = { negocio: { id: destino }, tablas: {}, docs: {} };
    for (const t of MigSuc.POR_SUCURSAL.map(x => x.t).concat(MigSuc.HIJOS.map(h => h.t), ['menu_publico', 'recetas']))
        O.tablas[t] = await q(`SELECT id, negocio_id, datos FROM ${t} WHERE negocio_id = $1`, [origen]);
    O.tablas.negocio_insumos = await q(`SELECT insumo_id, negocio_id, datos FROM negocio_insumos WHERE negocio_id = $1`, [origen]);
    D.tablas.negocio_insumos = await q(`SELECT insumo_id, datos FROM negocio_insumos WHERE negocio_id = $1`, [destino]);
    for (const x of MigSuc.POR_SUCURSAL) D.tablas[x.t] = await q(`SELECT id, '{}'::jsonb AS datos FROM ${x.t} WHERE negocio_id = $1 LIMIT 1`, [destino]);
    for (const t of MigSuc.DOCS) {
        O.docs[t] = (await q(`SELECT datos, updated_at::text AS updated_at FROM ${t} WHERE negocio_id = $1`, [origen]))[0] || null;
        D.docs[t] = (await q(`SELECT datos, updated_at::text AS updated_at FROM ${t} WHERE negocio_id = $1`, [destino]))[0] || null;
    }
    return { origen: O, destino: D };
}
const aplicar = (q, plan, admin = true) => q(`SELECT set_config('req.admin', $1, false)`, [admin ? '1' : '0'])
    .then(() => q(`SELECT admin_migrar_sucursal($1) AS r`, [JSON.stringify(MigSuc.paraServidor(plan))])).then(r => r[0].r);
const uno = async (q, t, id) => (await q(`SELECT negocio_id, datos FROM ${t} WHERE id = $1`, [id]))[0];
const insumo = async (q, neg, id) => ((await q(`SELECT datos FROM negocio_insumos WHERE negocio_id = $1 AND insumo_id = $2`, [neg, id]))[0] || {}).datos;

/* ══ 1) La migración normal: llega como sucursal nueva ══ */
{
    const { q, S } = await mundo();
    const datos = await leer(q, 'A', 'B');
    const plan = MigSuc.planear({ origen: datos.origen, destino: datos.destino, sucursal: S, llegaComo: 'nueva', conStaff: true });
    const N = (id) => MigSuc.idRecetaNueva(id, 'B', S);

    await ok('el plan no tiene bloqueos y conserva el id de la sucursal', () => {
        assert.deepEqual(plan.bloqueos, []);
        assert.equal(plan.sucursalNueva, S);
    });
    await ok('el plan copia lo que la sucursal usa (asignado o no) y nada de las otras', () => {
        assert.deepEqual(plan.insumos.map(x => x.id + (x.sucursales.length ? '' : '·libre')).sort(), ['i1', 'i2', 'i3', 'i5·libre', 'prod_1']);
        assert.deepEqual(plan.recetas.map(x => x.desde).sort(), ['r1', 'r2', 'r3c', 'r5', 'r_sub']);
    });
    await ok('…de cada insumo, la versión de la sucursal (su copia) bajo el id canónico', () =>
        assert.deepEqual(plan.insumos.find(x => x.id === 'i3'), { desde: 'i3c', id: 'i3', sucursales: [S] }));
    await ok('…y las fotos privadas, a la carpeta del destino', () =>
        assert.deepEqual(plan.fotos.map(f => f.desde + '→' + f.hacia).sort(), ['A/cortes/f1.jpg→B/cortes/f1.jpg', 'A/entradas/f2.jpg→B/entradas/f2.jpg']));

    const r = await aplicar(q, plan);
    await ok('la función responde ok, con lo que movió', () => {
        assert.equal(r.ok, true);
        assert.equal(r.cuenta.cortes, 1);
        assert.equal(r.cuenta.recetas_copiadas, 5);
    });
    await ok('los registros de la sucursal se mudan; los de la Matriz y Tulum no', async () => {
        const [c1, c2, c3] = [await uno(q, 'cortes', 'c1'), await uno(q, 'cortes', 'c2'), await uno(q, 'cortes', 'c3')];
        assert.deepEqual([c1.negocio_id, c1.datos.negocioId, c1.datos.sucursalId, c2.negocio_id, c3.negocio_id], ['B', 'B', S, 'A', 'A']);
    });
    await ok('…con la foto privada apuntando a la carpeta nueva (la pública se queda)', async () => {
        const c1 = await uno(q, 'cortes', 'c1');
        assert.equal(c1.datos.foto, 'priv:B/cortes/f1.jpg');
        assert.match(c1.datos.fotoPub, /\/A\/carta\/p\.jpg$/);
        assert.deepEqual((await uno(q, 'entradas_log', 'e1')).datos.foto_urls, ['priv:B/entradas/f2.jpg']);
    });
    await ok('el inventario se muda y sus cocteles vendidos apuntan a las recetas nuevas', async () => {
        const i = await uno(q, 'inventarios', 'inv1');
        assert.equal(i.negocio_id, 'B');
        assert.deepEqual(Object.keys(i.datos.cocktailsVendidos).sort(), [N('r1'), N('r5')].sort());
        assert.deepEqual(i.datos.filas.map(f => f.insumoId), ['i1', 'i5']);   // los insumos conservan su id
    });
    await ok('staff, recibos, evaluaciones y respuestas de la sucursal se van; los demás se quedan', async () => {
        const v = async (t, id) => (await uno(q, t, id)).negocio_id;
        assert.deepEqual([await v('staff', 'st1'), await v('staff', 'st2'), await v('nomina_recibos', 'nr1'), await v('nomina_recibos', 'nr2'),
            await v('evaluaciones', 'ev1'), await v('evaluacion_respuestas', 'er1'), await v('entradas_log', 'e2')], ['B', 'A', 'B', 'A', 'B', 'B', 'A']);
    });
    await ok('el horario cambia de id (lleva el negocio adentro)', async () => {
        assert.equal(await uno(q, 'horarios', 'hor_1_A_suc_mia_2026-W47'), undefined);
        const h = await uno(q, 'horarios', MigSuc.idHorario('B', S, '2026-W47'));
        assert.deepEqual([h.negocio_id, h.datos.id], ['B', MigSuc.idHorario('B', S, '2026-W47')]);
    });
    await ok('la carta pública se muda a B|sucursal, con sus recetas nuevas', async () => {
        assert.equal(await uno(q, 'menu_publico', 'A|' + S), undefined);
        assert.deepEqual((await uno(q, 'menu_publico', 'B|' + S)).datos.items, [{ recetaId: N('r1') }]);
    });
    await ok('destino: el insumo que ya tenía conserva SU ficha y solo suma la sucursal', async () => {
        const i1 = await insumo(q, 'B', 'i1');
        assert.deepEqual([i1.nombre, i1.sucursales.sort()], ['Ron (ficha de B)', ['suc_principal', S].sort()]);
    });
    await ok('destino: los copiados, sin lazos con el origen (la copia queda bajo el canónico)', async () => {
        const i3 = await insumo(q, 'B', 'i3'), i5 = await insumo(q, 'B', 'i5'), p = await insumo(q, 'B', 'prod_1');
        assert.deepEqual([i3.nombre, i3.origenId, i3.sucursales], ['Tequila (Miami)', undefined, [S]]);
        assert.deepEqual(i5.sucursales, []);
        assert.equal(p.recetaId, N('r_sub'));   // la sub-receta, con su id nuevo
        assert.equal(await insumo(q, 'B', 'i4'), undefined);
    });
    await ok('destino: recetas con id nuevo; las que solo se usaban, fuera de las listas (_global)', async () => {
        const r2 = await uno(q, 'recetas', N('r2')), r3 = await uno(q, 'recetas', N('r3')), r5 = await uno(q, 'recetas', N('r5'));
        assert.deepEqual([r2.negocio_id, r2.datos.sucursales, r3.datos.nombre, r3.datos.origenId, r5.datos._global, r5.datos.sucursales],
            ['B', [S], 'Margarita Miami', undefined, true, []]);
        assert.equal(await uno(q, 'recetas', N('r4')), undefined);
    });
    await ok('origen: el catálogo NO se borra; solo pierde la sucursal', async () => {
        assert.deepEqual((await insumo(q, 'A', 'i1')).sucursales, ['suc_principal']);
        assert.deepEqual((await insumo(q, 'A', 'i2')).sucursales, []);
        assert.deepEqual((await insumo(q, 'A', 'i3')).sucursales, ['suc_principal']);
        const r1 = await uno(q, 'recetas', 'r1'), r2 = await uno(q, 'recetas', 'r2');
        assert.deepEqual([r1.negocio_id, r1.datos.sucursales, r2.negocio_id, r2.datos.sucursales, r2.datos._global], ['A', ['suc_principal'], 'A', [], true]);
        assert.deepEqual((await uno(q, 'recetas', 'r5')).datos.sucursales, ['suc_principal']);
    });
    await ok('los documentos: la sucursal sale de A y entra a B con su configuración', async () => {
        const a = (await q(`SELECT datos FROM negocio_sucursales WHERE negocio_id='A'`))[0].datos;
        const b = (await q(`SELECT datos FROM negocio_sucursales WHERE negocio_id='B'`))[0].datos;
        assert.deepEqual(a.sucursales.map(s => s.id), ['suc_principal', 'suc_tul']);
        assert.equal(a.cfg[S], undefined);
        assert.deepEqual(b.sucursales.map(s => s.id + ':' + s.nombre), ['suc_principal:Matriz B', S + ':El Miami']);
        assert.deepEqual(b.cfg[S], { color: 'azul' });
    });
    await ok('…compuestos y bateo de inventario (con la sub-receta nueva) y parámetros de nómina', async () => {
        const aA = (await q(`SELECT datos FROM inv_ajustes WHERE negocio_id='A'`))[0].datos;
        const aB = (await q(`SELECT datos FROM inv_ajustes WHERE negocio_id='B'`))[0].datos;
        assert.deepEqual([aA.compuestos[S], aB.compuestos[S][0].miembros, aB.bateo[S][0].recetaId], [undefined, ['i1', 'i2'], N('r_sub')]);
        const nB = (await q(`SELECT datos FROM gf_nomina_params WHERE negocio_id='B'`))[0].datos;
        assert.deepEqual(nB.porSucursal[S], { jornadaHoras: 6 });
    });
    await ok('queda escrita en la bitácora', async () =>
        assert.equal((await q(`SELECT count(*)::int AS n FROM admin_migraciones WHERE datos->>'sucursal' = $1`, [S]))[0].n, 1));
    await ok('el mismo plan dos veces NO se aplica (los documentos ya cambiaron)', async () => {
        await falla(() => aplicar(q, plan), /cambió mientras revisabas/);
        assert.equal((await q(`SELECT count(*)::int AS n FROM admin_migraciones`))[0].n, 1);
    });
}

/* ══ 2) Todo o nada, y las puertas ══ */
{
    const { q, S } = await mundo();
    const datos = await leer(q, 'A', 'B');
    const plan = MigSuc.planear({ origen: datos.origen, destino: datos.destino, sucursal: S, conStaff: true });
    await ok('solo el admin de la plataforma', () => falla(() => aplicar(q, plan, false), /Solo el admin/));
    await ok('la Matriz no se migra (ni armando el plan a mano)', async () => {
        assert.match(MigSuc.planear({ origen: datos.origen, destino: datos.destino, sucursal: 'suc_principal' }).bloqueos[0], /Matriz/);
        await falla(() => q(`SELECT set_config('req.admin','1',false)`).then(() =>
            q(`SELECT admin_migrar_sucursal($1)`, [JSON.stringify({ origen: 'A', destino: 'B', sucursal: 'suc_principal' })])), /Matriz/);
    });
    await ok('si un documento cambió mientras se revisaba, no se toca NADA', async () => {
        await q(`UPDATE negocio_sucursales SET updated_at = now() + interval '1 minute' WHERE negocio_id = 'A'`);
        await falla(() => aplicar(q, plan), /cambió mientras revisabas/);
        assert.equal((await uno(q, 'cortes', 'c1')).negocio_id, 'A');
        assert.equal((await insumo(q, 'B', 'i2')), undefined);
        assert.deepEqual((await insumo(q, 'A', 'i2')).sucursales, [S]);
    });
    await ok('una tabla fuera de la lista se rechaza', () =>
        falla(() => q(`SELECT admin_migrar_sucursal($1)`, [JSON.stringify(Object.assign(MigSuc.paraServidor(plan), { docs: [], tablas: ['usuarios'] }))]), /no permitida/));
}

/* ══ 3) Sin staff, y llegando como la Matriz de un negocio vacío ══ */
{
    const { q, S } = await mundo();
    const datos = await leer(q, 'A', 'C');
    const plan = MigSuc.planear({ origen: datos.origen, destino: datos.destino, sucursal: S, llegaComo: 'matriz', conStaff: false });
    await ok('sin staff: el plan lo dice y no lo incluye', () => {
        assert.equal(plan.tablas.indexOf('staff'), -1);
        assert.ok(plan.avisos.some(a => /se quedan en el negocio original/.test(a)));
    });
    await aplicar(q, plan);
    await ok('como Matriz: todo llega con sucursal suc_principal, también lo de adentro', async () => {
        const i = await uno(q, 'inventarios', 'inv1');
        assert.deepEqual([i.negocio_id, i.datos.sucursalId, i.datos.entradasLog[0].sucursalId], ['C', 'suc_principal', 'suc_principal']);
        const c = (await q(`SELECT datos FROM negocio_sucursales WHERE negocio_id='C'`))[0].datos;
        assert.deepEqual(c.sucursales.map(s => s.id + ':' + s.nombre), ['suc_principal:El Miami']);
    });
    await ok('…y el staff y sus recibos se quedaron en el origen', async () => {
        assert.equal((await uno(q, 'staff', 'st1')).negocio_id, 'A');
        assert.equal((await uno(q, 'nomina_recibos', 'nr1')).negocio_id, 'A');
    });
    await ok('llegar como Matriz a un negocio que ya opera, se bloquea', async () => {
        const d2 = await leer(q, 'A', 'C');   // C ya tiene registros
        const p2 = MigSuc.planear({ origen: d2.origen, destino: d2.destino, sucursal: 'suc_tul', llegaComo: 'matriz' });
        assert.match(p2.bloqueos.join(' '), /tiene que estar vacío/);
    });
}

/* ══ 4) EL FLUJO NUEVO (23-nov): COPIAR → revisar → ELIMINAR del original → RESTAURAR ══
   La copia la ejecuta el navegador (MigSuc.ejecutarCopia); aquí corre contra
   este Postgres por un adaptador mínimo con la misma forma que supabase-js. */
function sbDe(q, copias) {
    async function correr(st) {
        try {
            if (st.op) {
                for (const r of st.rows) {
                    const cols = Object.keys(r), vals = cols.map(c => c === 'datos' ? JSON.stringify(r[c]) : r[c]);
                    const llave = st.conf.split(',').map(x => x.trim());
                    const conf = st.op === 'upsert' ? ` ON CONFLICT (${llave.join(',')}) DO UPDATE SET ` +
                        cols.filter(c => llave.indexOf(c) < 0).map(c => c + ' = EXCLUDED.' + c).join(', ') : '';
                    await q(`INSERT INTO ${st.t} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')})${conf}`, vals);
                }
                return { data: null, error: null };
            }
            const sel = st.cols === '*' ? '*' : st.cols.split(',').map(c => c.trim() === 'updated_at' ? 'updated_at::text AS updated_at' : c.trim()).join(', ');
            const where = st.filtros.map((f, i) => f[0] + ' = $' + (i + 1)).join(' AND ');
            const rows = await q(`SELECT ${sel} FROM ${st.t}${where ? ' WHERE ' + where : ''}`, st.filtros.map(f => f[1]));
            return { data: st.single ? (rows[0] || null) : rows, error: null };
        } catch (e) { return { data: null, error: { message: e.message } }; }
    }
    return {
        from(t) {
            const st = { t, filtros: [], cols: '*', single: false, op: null, rows: [], conf: 'id' };
            const b = {
                select(c) { st.cols = c || '*'; return b; },
                eq(k, v) { st.filtros.push([k, v]); return b; },
                maybeSingle() { st.single = true; return b; },
                upsert(rows, o) { st.op = 'upsert'; st.rows = [].concat(rows); st.conf = (o && o.onConflict) || 'id'; return b; },
                insert(rows) { st.op = 'insert'; st.rows = [].concat(rows); return b; },
                then(res, rej) { return correr(st).then(res, rej); }
            };
            return b;
        },
        storage: { from(bk) { return { copy: async (a, z) => { copias.push(bk + ':' + a + '>' + z); return { error: null }; } }; } }
    };
}
const TABLAS_SUC = MigSuc.POR_SUCURSAL.map(x => x.t).concat(MigSuc.HIJOS.map(h => h.t), ['menu_publico']);
async function foto(q, neg) {
    const o = {};
    for (const t of TABLAS_SUC) o[t] = await q(`SELECT id, negocio_id, datos, created_at::text AS c FROM ${t} WHERE negocio_id = $1 ORDER BY id`, [neg]);
    o.insumos = await q(`SELECT insumo_id, datos FROM negocio_insumos WHERE negocio_id = $1 ORDER BY insumo_id`, [neg]);
    o.recetas = await q(`SELECT id, datos FROM recetas WHERE negocio_id = $1 ORDER BY id`, [neg]);
    for (const t of MigSuc.DOCS) o[t] = ((await q(`SELECT datos FROM ${t} WHERE negocio_id = $1`, [neg]))[0] || {}).datos || null;
    return JSON.parse(JSON.stringify(o));
}
{
    const { q, S } = await mundo();
    await q(`SELECT set_config('req.admin', '1', false)`);
    const fotoA = await foto(q, 'A');
    const datos = await leer(q, 'A', 'B');
    const plan = MigSuc.planearCopia({ origen: datos.origen, destino: datos.destino, sucursal: S });
    const copias = [];
    const res = await MigSuc.ejecutarCopia(sbDe(q, copias), plan);
    const suf = (id) => plan.remap[id];
    await ok('copiar: el negocio original queda EXACTAMENTE igual', async () => assert.deepEqual(await foto(q, 'A'), fotoA));
    await ok('copiar: la copia lleva ids nuevos, la sucursal y el negocio del destino', async () => {
        const c = await uno(q, 'cortes', suf('c1'));
        assert.notEqual(suf('c1'), 'c1');
        assert.deepEqual([c.negocio_id, c.datos.sucursalId, c.datos.negocioId, c.datos.id, c.datos.foto], ['B', S, 'B', suf('c1'), 'priv:B/cortes/f1.jpg']);
        assert.equal(await uno(q, 'cortes', suf('c2')), undefined);       // la Matriz no
    });
    await ok('…y lo que nombraba a un registro copiado nombra a su copia (entradas, respuestas)', async () => {
        const i = await uno(q, 'inventarios', suf('inv1'));
        assert.equal(i.datos.entradasLog[0].id, suf('e1'));
        assert.ok(await uno(q, 'entradas_log', suf('e1')));
        assert.equal((await uno(q, 'evaluacion_respuestas', suf('er1'))).datos.evaluacionId, suf('ev1'));
        assert.deepEqual(Object.keys(i.datos.cocktailsVendidos).sort(), [MigSuc.idRecetaNueva('r1', 'B', S), MigSuc.idRecetaNueva('r5', 'B', S)].sort());
    });
    await ok('…horario con su id del destino, carta pública B|sucursal, fotos copiadas', async () => {
        assert.ok(await uno(q, 'horarios', MigSuc.idHorario('B', S, '2026-W47')));
        assert.ok(await uno(q, 'horarios', 'hor_1_A_suc_mia_2026-W47'));      // el original sigue
        assert.ok(await uno(q, 'menu_publico', 'B|' + S));
        assert.ok(copias.some(c => c === 'evidencias-priv:A/cortes/f1.jpg>B/cortes/f1.jpg'));
    });
    await ok('…el staff NO se copia (su usuario es único) y se avisa', async () => {
        assert.equal((await q(`SELECT count(*)::int AS n FROM staff WHERE negocio_id = 'B'`))[0].n, 0);
        assert.ok(plan.avisos.some(a => /no se copia/.test(a)));
    });
    await ok('…en el destino, la sucursal dice de dónde viene (copiaDe)', async () => {
        const b = (await q(`SELECT datos FROM negocio_sucursales WHERE negocio_id = 'B'`))[0].datos;
        const s = b.sucursales.find(x => x.id === S);
        assert.deepEqual([s.nombre, s.copiaDe.negocio, s.copiaDe.sucursal], ['El Miami', 'A', S]);
    });
    await ok('volver a copiar ACTUALIZA la misma copia (mismos ids, nada duplicado)', async () => {
        const n0 = (await q(`SELECT count(*)::int AS n FROM cortes WHERE negocio_id = 'B'`))[0].n;
        const d2 = await leer(q, 'A', 'B');
        const p2 = MigSuc.planearCopia({ origen: d2.origen, destino: d2.destino, sucursal: S });
        assert.equal(p2.recopia, true);
        assert.equal(p2.remap.c1, plan.remap.c1);
        await MigSuc.ejecutarCopia(sbDe(q, []), p2);
        assert.equal((await q(`SELECT count(*)::int AS n FROM cortes WHERE negocio_id = 'B'`))[0].n, n0);
        assert.equal((await q(`SELECT datos FROM negocio_sucursales WHERE negocio_id = 'B'`))[0].datos.sucursales.filter(x => x.id === S).length, 1);
    });

    // ── Eliminar del original, pasando el staff al destino ──
    const fotoB = await foto(q, 'B');
    const arc = (await q(`SELECT admin_archivar_sucursal('A', $1, 'B', $1) AS r`, [S]))[0].r;
    await ok('eliminar del original: sus registros salen de las tablas vivas y van al archivo', async () => {
        assert.equal(await uno(q, 'cortes', 'c1'), undefined);
        assert.equal(await uno(q, 'inventarios', 'inv1'), undefined);
        assert.equal(await uno(q, 'menu_publico', 'A|' + S), undefined);
        assert.ok((await uno(q, 'cortes', 'c2')));                       // la Matriz sigue
        const n = (await q(`SELECT count(*)::int AS n FROM admin_archivo_filas WHERE archivo_id = $1`, [arc.id]))[0].n;
        assert.ok(n >= 7, String(n));
    });
    await ok('…el staff pasa al destino (con sus recibos), en la sucursal copiada', async () => {
        const st = await uno(q, 'staff', 'st1'), nr = await uno(q, 'nomina_recibos', 'nr1');
        assert.deepEqual([st.negocio_id, st.datos.sucursalId, nr.negocio_id], ['B', S, 'B']);
        assert.equal((await uno(q, 'staff', 'st2')).negocio_id, 'A');
    });
    await ok('…la sucursal sale de su lista y el catálogo solo pierde la sucursal', async () => {
        const a = (await q(`SELECT datos FROM negocio_sucursales WHERE negocio_id = 'A'`))[0].datos;
        assert.deepEqual(a.sucursales.map(s => s.id), ['suc_principal', 'suc_tul']);
        assert.deepEqual((await insumo(q, 'A', 'i1')).sucursales, ['suc_principal']);
        const r2 = await uno(q, 'recetas', 'r2');
        assert.deepEqual([r2.datos.sucursales, r2.datos._global], [[], true]);
    });
    await ok('…y el destino (la copia) no se tocó, salvo el staff que llegó', async () => {
        const ahora = await foto(q, 'B');
        assert.deepEqual(ahora.cortes, fotoB.cortes);
        assert.deepEqual(ahora.inventarios, fotoB.inventarios);
        assert.equal(ahora.staff.length, 1);
    });

    // ── Restaurar en el original ──
    await q(`SELECT admin_restaurar_sucursal($1)`, [arc.id]);
    await ok('restaurar: el original queda IDÉNTICO a como estaba (mismos ids, datos y fechas)', async () => {
        const ahora = await foto(q, 'A');
        for (const t of TABLAS_SUC.concat(['insumos', 'recetas']))
            assert.deepEqual(ahora[t], fotoA[t], 'tabla ' + t);
        assert.deepEqual(ahora.negocio_sucursales.sucursales.map(s => s.id).sort(), fotoA.negocio_sucursales.sucursales.map(s => s.id).sort());
        assert.deepEqual(ahora.negocio_sucursales.cfg[S], { color: 'azul' });
        assert.deepEqual(ahora.inv_ajustes.compuestos[S], fotoA.inv_ajustes.compuestos[S]);
        assert.deepEqual(ahora.gf_nomina_params.porSucursal[S], { jornadaHoras: 6 });
    });
    await ok('…el staff regresó del destino', async () => {
        assert.equal((await uno(q, 'staff', 'st1')).negocio_id, 'A');
        assert.equal((await q(`SELECT count(*)::int AS n FROM staff WHERE negocio_id = 'B'`))[0].n, 0);
    });
    await ok('…y no se restaura dos veces', () => falla(() => q(`SELECT admin_restaurar_sucursal($1)`, [arc.id]), /ya se restauró/));

    // ── Eliminar y restaurar la COPIA del destino ──
    const fB = await foto(q, 'B');
    const arcB = (await q(`SELECT admin_archivar_sucursal('B', $1) AS r`, [S]))[0].r;
    await ok('la copia del destino también se elimina (si salió mal)…', async () => {
        assert.equal(await uno(q, 'cortes', plan.remap.c1), undefined);
        assert.ok(!(await q(`SELECT datos FROM negocio_sucursales WHERE negocio_id = 'B'`))[0].datos.sucursales.some(s => s.id === S));
    });
    await q(`SELECT admin_restaurar_sucursal($1)`, [arcB.id]);
    await ok('…y se restaura igual', async () => {
        const ahora = await foto(q, 'B');
        assert.deepEqual(ahora.cortes, fB.cortes);
        assert.deepEqual(ahora.inventarios, fB.inventarios);
        assert.ok(ahora.negocio_sucursales.sucursales.some(s => s.id === S && s.copiaDe));
    });
    await ok('las puertas: solo el admin, la Matriz no, el staff a OTRO negocio', async () => {
        await q(`SELECT set_config('req.admin', '0', false)`);
        await falla(() => q(`SELECT admin_archivar_sucursal('A', $1)`, [S]), /Solo el admin/);
        await falla(() => q(`SELECT admin_restaurar_sucursal($1)`, [arc.id]), /Solo el admin/);
        await q(`SELECT set_config('req.admin', '1', false)`);
        await falla(() => q(`SELECT admin_archivar_sucursal('A', 'suc_principal')`), /Matriz/);
        await falla(() => q(`SELECT admin_archivar_sucursal('A', $1, 'A', $1)`, [S]), /OTRO negocio/);
        await falla(() => q(`SELECT admin_archivar_sucursal('A', $1, 'B', 'no_existe')`, [S]), /no existe en el negocio/);
    });
    await ok('si al restaurar ya hay una sucursal con ese id, no se restaura encima', async () => {
        const a2 = (await q(`SELECT admin_archivar_sucursal('A', $1) AS r`, [S]))[0].r;
        await q(`UPDATE negocio_sucursales SET datos = jsonb_set(datos, '{sucursales}', datos->'sucursales' || '[{"id":"suc_mia","nombre":"Otra"}]') WHERE negocio_id = 'A'`);
        await falla(() => q(`SELECT admin_restaurar_sucursal($1)`, [a2.id]), /ya tiene una sucursal con ese id/);
    });
}

console.log('SQL v86: ' + cuenta + ' casos, 0 fallas');
