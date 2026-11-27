/* EL HISTORIAL DE LA APP MANDA LA CANTIDAD DE LOS CONTEOS (v97) — contra un
   Postgres DE VERDAD (PGlite), con las piezas REALES de la v82/v84.
   Edwin (27-nov): «los conteos del QR en el inventario me salen en ceros y en
   la versión móvil el modal de corregir se queda congelado». La app mandaba
   sus conteos como cantidad + unidad y el historial solo devolvía las piezas
   en bodega / barra: la app los enseñaba sin número y «Corregir» abría vacío.
     · la v97 es la v94 idéntica más `cantidad`, `unidad` y `area` del conteo.
     · un conteo del QR del navegador (bodega / barra) sale igual que antes.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {PGlite} = createRequire((process.env.PGLITE_DIR || '/tmp/etaax-billing-sql') + '/test.cjs')('@electric-sql/pglite');

let cuenta = 0;
const ok = async (nombre, fn) => { await fn(); cuenta++; console.log('PASA ' + nombre); };
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const fn = (archivo, nombre) => {
    const s = leer(archivo), i = s.indexOf('CREATE OR REPLACE FUNCTION ' + nombre + '(');
    assert.ok(i > -1, nombre + ' no está en ' + archivo);
    return s.slice(i, s.indexOf('\n$$;', i) + 4);
};

const db = new PGlite();
const q = async (sql, args) => (await db.query(sql, args)).rows;
await db.exec(`
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE negocios (id TEXT PRIMARY KEY, entrada_token TEXT, datos JSONB DEFAULT '{}');
  CREATE TABLE staff (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE entradas_log (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE inventarios (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
  CREATE TABLE inventario_conteos (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  -- La puerta del token y el guardia de la clave, reducidos a su veredicto
  -- (tienen sus propias pruebas: v92/v93 y v78-v79).
  CREATE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM negocios WHERE id = p_neg AND entrada_token = p_token AND COALESCE(p_token,'') <> '') $$;
  CREATE FUNCTION _nip_guardia(p_neg TEXT, p_niphash TEXT) RETURNS BOOLEAN
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM staff s WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash
                       AND COALESCE(NULLIF(s.datos->>'estado',''),'Activo') = 'Activo') $$;
`);
await db.exec([fn('supabase-migration-v84.sql', '_entrada_instante'), fn('supabase-migration-v84.sql', '_entrada_periodo_cerrado'),
               fn('supabase-migration-v82.sql', '_entrada_quien'), fn('supabase-migration-v82.sql', '_entrada_edita_ajeno')].join('\n'));
await db.exec(leer('supabase-migration-v94.sql'));
await db.exec(leer('supabase-migration-v97.sql'));

await q(`INSERT INTO negocios (id, entrada_token) VALUES ('A', 'tokA')`);
await q(`INSERT INTO staff (id, negocio_id, datos) VALUES
  ('s1', 'A', '{"nombre":"Ana","nipHash":"h1","rol":"barman","sucursalId":"suc_principal"}')`);
const cnt = (id, extra) => JSON.stringify(Object.assign({ id, insumoId: 'i-' + id, nombre: 'Prod ' + id, sucursalId: 'suc_principal',
    area: 'barra', staffId: 's1', contadoPor: 'Ana', fecha: '2026-11-27', hora: '22:10', ver: 1 }, extra || {}));
await q(`INSERT INTO inventario_conteos (id, negocio_id, datos) VALUES ('c-app', 'A', $1), ('c-nav', 'A', $2)`,
  [cnt('c-app', { cantidad: 6, unidad: 'PZA' }), cnt('c-nav', { cerradasBodega: 4, cerradasBarra: 2 })]);

async function anon(sql, args) {
    await db.exec('SET ROLE anon');
    try { return (await q(sql, args))[0].r; } finally { await db.exec('RESET ROLE'); }
}
const hist = () => anon(`SELECT entrada_historial('A', 'tokA', 'h1', 'suc_principal', 'barra') AS r`);

await ok('un conteo de la app (cantidad + unidad) llega al historial CON su número', async () => {
    const r = await hist(), c = r.conteos.find(x => x.id === 'c-app');
    assert.equal(r.ok, true);
    assert.deepEqual([c.cantidad, c.unidad, c.area, c.cerradasBodega, c.cerradasBarra], ['6', 'PZA', 'barra', null, null]);
    assert.equal(c.puedeEditar, true);           // los candados de siempre siguen ahí
});
await ok('un conteo del QR del navegador (bodega / barra) sale igual que antes', async () => {
    const c = (await hist()).conteos.find(x => x.id === 'c-nav');
    assert.deepEqual([c.cerradasBodega, c.cerradasBarra, c.cantidad, c.quien], ['4', '2', null, 'Ana']);
});
await ok('la v97 no cambia la firma ni los permisos: la app sin sesión la sigue llamando', async () => {
    const r = await q(`SELECT has_function_privilege('anon', 'entrada_historial(text,text,text,text,text)', 'EXECUTE') AS a`);
    assert.equal(r[0].a, true);
    const n = await q(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'entrada_historial'`);
    assert.equal(n[0].n, 1);
});
await ok('fuera de las tres llaves nuevas, la función es la de la v94 renglón por renglón', async () => {
    const f = (a) => { const s = leer(a), i = s.indexOf('CREATE OR REPLACE FUNCTION entrada_historial(');
        return s.slice(i, s.indexOf('\n$$;', i)).split('\n').map(l => l.trim()).filter(l => l && l.indexOf('--') !== 0); };
    const v94 = f('supabase-migration-v94.sql'), v97 = f('supabase-migration-v97.sql');
    assert.deepEqual(v97.filter(l => v94.indexOf(l) < 0),
        ["'cantidad', c.datos->>'cantidad',", "'unidad',   c.datos->>'unidad',", "'area',     c.datos->>'area',"]);
    assert.equal(v94.filter(l => v97.indexOf(l) < 0).length, 0);
});

console.log('\n' + cuenta + ' pruebas pasaron (v97: el historial manda la cantidad de los conteos).');
