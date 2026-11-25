/* NOTAS / FACTURAS DE ENTRADAS DESDE LA APP (v94) — contra un Postgres DE
   VERDAD (PGlite), con las piezas REALES de la v82/v84 (quién es, quién toca
   lo ajeno, el periodo cerrado), copiadas de sus archivos.
     · entrada_historial manda la nota de cada entrada.
     · entrada_nota_agrupar / entrada_nota_desagrupar, con los candados de
       entrada_editar renglón por renglón: uno que no pase detiene todo.

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

await q(`INSERT INTO negocios (id, entrada_token) VALUES ('A', 'tokA')`);
await q(`INSERT INTO staff (id, negocio_id, datos) VALUES
  ('s1', 'A', '{"nombre":"Ana","nipHash":"h1","rol":"barman","sucursalId":"suc_principal"}'),
  ('s2', 'A', '{"nombre":"Beto","nipHash":"h2","rol":"barman","sucursalId":"suc_principal"}'),
  ('s3', 'A', '{"nombre":"Gera","nipHash":"h3","rol":"gerente","sucursalId":"suc_principal"}'),
  ('s4', 'A', '{"nombre":"Polo","nipHash":"h4","rol":"barman","sucursalId":"suc_dos"}')`);
const ent = (id, staff, extra) => JSON.stringify(Object.assign({ id, concepto: 'entrada', insumoId: 'i-' + id, nombre: 'Prod ' + id, cantidad: 2, tipo: 'compra',
    sucursalId: 'suc_principal', area: 'barra', staffId: staff, registradoPor: staff, fecha: '2026-11-25', registrado: '2026-11-25T15:00:00Z',
    foto_urls: ['priv:a', 'priv:b'], ver: 1 }, extra || {}));
await q(`INSERT INTO entradas_log (id, negocio_id, datos) VALUES
  ('e1', 'A', $1), ('e2', 'A', $2), ('e3', 'A', $3), ('m1', 'A', $4), ('e9', 'A', $5), ('ex', 'A', $6)`,
  [ent('e1', 's1'), ent('e2', 's1'), ent('e3', 's2'),
   ent('m1', 's1', { concepto: 'merma' }), ent('e9', 's1', { registrado: '2026-10-01T15:00:00Z' }),
   ent('ex', 's1', { notaId: 'N0', notaFolio: 'F-1', notaProveedor: 'Coca' })]);

async function anon(sql, args) {
    await db.exec('SET ROLE anon');
    try { return (await q(sql, args))[0].r; } finally { await db.exec('RESET ROLE'); }
}
const agrupar = (nip, ids, prov, folio) => anon(`SELECT entrada_nota_agrupar('A', 'tokA', $1, $2, $3, $4) AS r`, [nip, ids, prov, folio]);
const desagrupar = (nip, nota) => anon(`SELECT entrada_nota_desagrupar('A', 'tokA', $1, $2) AS r`, [nip, nota]);
const datos = async (id) => (await q(`SELECT datos FROM entradas_log WHERE id = $1`, [id]))[0].datos;

/* ── Agrupar ── */
let N1;
await ok('agrupar dos entradas suyas: una nota nueva con proveedor y folio, y la versión sube', async () => {
    const r = await agrupar('h1', ['e1', 'e2'], ' Refrescos del Norte ', 'A-77');
    assert.equal(r.ok, true); assert.equal(r.n, 2); N1 = r.notaId;
    const d1 = await datos('e1'), d2 = await datos('e2');
    assert.deepEqual([d1.notaId, d1.notaProveedor, d1.notaFolio, d1.ver, d1.editadoPor], [N1, 'Refrescos del Norte', 'A-77', 2, 'Ana']);
    assert.equal(d2.notaId, N1);
});
await ok('…la cantidad, la fecha y las fotos de cada entrada se quedan igual', async () => {
    const d = await datos('e1');
    assert.deepEqual([d.cantidad, d.fecha, d.foto_urls], [2, '2026-11-25', ['priv:a', 'priv:b']]);
});
await ok('una entrada de OTRO (siendo barman) detiene todo: no se toca ninguna', async () => {
    const r = await agrupar('h1', ['e3', 'm1'], 'X', '');
    assert.deepEqual([r.ok, r.motivo, r.id], [false, 'autor', 'e3']);
    assert.equal((await datos('m1')).notaId, undefined);
});
await ok('una merma no es entrada', async () => assert.equal((await agrupar('h1', ['m1'], 'X', '')).motivo, 'tipo'));
await ok('lo de un inventario ya cerrado no se toca', async () => {
    await q(`INSERT INTO inventarios VALUES ('inv1', 'A', '{"cerrado":true,"sucursalId":"suc_principal","area":"barra","cierreOperativo":"2026-10-31T23:00:00Z"}')`);
    assert.equal((await agrupar('h1', ['e9'], 'X', '')).motivo, 'cerrado');
});
await ok('quien es de otra sucursal no toca lo de esta', async () => assert.equal((await agrupar('h4', ['e1'], 'X', '')).motivo, 'ajeno'));
await ok('el encargado sí junta lo de otros; si una ya era de una nota, todo se suma a ESA', async () => {
    const r = await agrupar('h3', ['e3', 'ex'], 'Coca-Cola FEMSA', 'F-2');
    assert.equal(r.ok, true); assert.equal(r.notaId, 'N0');
    assert.deepEqual([(await datos('e3')).notaId, (await datos('ex')).notaFolio, (await datos('ex')).notaProveedor], ['N0', 'F-2', 'Coca-Cola FEMSA']);
});
await ok('sin las llaves, nada (token equivocado, NIP equivocado)', async () => {
    assert.equal((await anon(`SELECT entrada_nota_agrupar('A', 'otro', 'h1', ARRAY['e1'], 'x', '') AS r`)).motivo, 'token');
    assert.equal((await agrupar('zzz', ['e1'], 'x', '')).motivo, 'nip');
    assert.equal((await agrupar('h1', [], 'x', '')).motivo, 'datos');
});

/* ── Desagrupar ── */
await ok('desagrupar: las entradas se quedan, sin nota (notaId vacío, como el sistema)', async () => {
    const r = await desagrupar('h1', N1);
    assert.deepEqual([r.ok, r.n], [true, 2]);
    const d = await datos('e1');
    assert.deepEqual([d.notaId, d.notaFolio, d.notaProveedor, d.cantidad, d.ver], ['', undefined, undefined, 2, 3]);
});
await ok('…una nota con entradas de otros, el barman no la deshace', async () =>
    assert.deepEqual(await desagrupar('h1', 'N0').then(r => [r.ok, r.motivo]), [false, 'autor']));

/* ── El historial, con la nota ── */
await ok('entrada_historial manda producto, tipo, área, la nota y cuántas fotos (no las fotos)', async () => {
    await q(`DELETE FROM inventarios`);
    const r = await anon(`SELECT entrada_historial('A', 'tokA', 'h3', 'suc_principal', 'barra') AS r`);
    const ex = r.movimientos.find(m => m.id === 'ex');
    assert.deepEqual([ex.insumoId, ex.tipoEntrada, ex.area, ex.notaId, ex.notaFolio, ex.notaProveedor, ex.fotos],
        ['i-ex', 'compra', 'barra', 'N0', 'F-2', 'Coca-Cola FEMSA', 2]);
    assert.equal(JSON.stringify(r).indexOf('priv:a'), -1);
    assert.equal(r.movimientos.find(m => m.id === 'e1').notaId, null, 'desagrupada: sin nota');
});

await ok('la app puede llamar las nuevas; la pieza interna no', async () => {
    const r = await q(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS a FROM pg_proc p
                        WHERE p.proname IN ('entrada_nota_agrupar','entrada_nota_desagrupar','_entrada_nota_motivo','entrada_historial') ORDER BY 1`);
    assert.deepEqual(r.map(x => x.proname + ':' + x.a), ['_entrada_nota_motivo:false', 'entrada_historial:true', 'entrada_nota_agrupar:true', 'entrada_nota_desagrupar:true']);
});
await ok('la migración se puede correr dos veces', async () => {
    await db.exec(leer('supabase-migration-v94.sql'));
    assert.equal((await agrupar('h3', ['e1', 'e2'], 'Otra', '')).ok, true);
});

console.log('\n🔒 v94 OK — ' + cuenta + ' comprobaciones contra Postgres');
