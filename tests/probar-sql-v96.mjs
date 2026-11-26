/* GUÍAS DE USO EN LA APP MÓVIL (v96) — contra un Postgres DE VERDAD (PGlite),
   sobre la v91 tal cual (su _portal_quien) y la tabla `guias` de la v45.
     · portal_guias_movil: con token + NIP de alguien ACTIVO, las guías de la
       app (movil_costax / movil_equipax) activas, en su orden.
     · Sin NIP válido no devuelve nada; las guías de Learn·ax no salen.
     · La app (anon) la puede llamar, pero no leer la tabla `guias`.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {PGlite} = createRequire((process.env.PGLITE_DIR || '/tmp/etaax-billing-sql') + '/test.cjs')('@electric-sql/pglite');
let cuenta = 0;
const ok = async (nombre, fn) => { await fn(); cuenta++; console.log('PASA ' + nombre); };
const db = new PGlite();
const q = async (sql, args) => (await db.query(sql, args)).rows;
await db.exec(`
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE negocios (id TEXT PRIMARY KEY, usuario_id UUID, entrada_token TEXT, datos JSONB DEFAULT '{}');
  CREATE TABLE staff (id TEXT PRIMARY KEY, negocio_id TEXT REFERENCES negocios(id), datos JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE suscripciones (negocio_id TEXT PRIMARY KEY, estado TEXT, plan JSONB);
  CREATE TABLE horarios (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
  CREATE TABLE evaluaciones (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
  CREATE TABLE negocio_sucursales (negocio_id TEXT PRIMARY KEY, datos JSONB);
  CREATE TABLE guias (id TEXT PRIMARY KEY, titulo TEXT NOT NULL, descripcion TEXT, categoria TEXT, tipo TEXT NOT NULL DEFAULT 'pdf',
                      url TEXT NOT NULL, modulo TEXT, orden INT DEFAULT 0, activa BOOLEAN DEFAULT true, audiencia TEXT DEFAULT 'ambas',
                      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
  ALTER TABLE guias ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "lectura_todos" ON guias FOR SELECT TO authenticated USING (activa);
  CREATE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM negocios WHERE id = p_neg AND entrada_token IS NOT NULL AND entrada_token <> '' AND entrada_token = p_token) $$;
  GRANT EXECUTE ON FUNCTION _entrada_token_ok(TEXT, TEXT) TO anon, authenticated;
  CREATE FUNCTION _nip_guardia(p_neg TEXT, p_niphash TEXT) RETURNS BOOLEAN
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
      SELECT EXISTS (SELECT 1 FROM staff s WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash
                       AND COALESCE(NULLIF(s.datos->>'estado',''),'Activo') = 'Activo') $$;
  REVOKE ALL ON FUNCTION _nip_guardia(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
`);
await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v91.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v96.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(RAIZ, 'supabase-migration-v96.sql'), 'utf8'));   // idempotente

await q(`INSERT INTO negocios (id, entrada_token) VALUES ('A', 'tokA')`);
await q(`INSERT INTO staff (id, negocio_id, datos) VALUES ('s1', 'A', '{"id":"s1","nombre":"Ana","nipHash":"h1"}'),
                                                       ('s3', 'A', '{"id":"s3","nombre":"Caro","nipHash":"h3","estado":"Baja"}')`);
await q(`INSERT INTO guias (id, titulo, tipo, url, modulo, orden, activa) VALUES
  ('g1', 'Entradas paso a paso', 'video', 'https://x/_guias/video/a.mp4', 'movil_costax', 2, true),
  ('g2', 'Manual Cost·ax', 'pdf', 'https://x/_guias/pdf/b.pdf', 'movil_costax', 1, true),
  ('g3', 'Tu turno en la app', 'link', 'https://www.youtube.com/watch?v=abc', 'movil_equipax', 0, true),
  ('g4', 'Borrador', 'pdf', 'https://x/c.pdf', 'movil_equipax', 0, false),
  ('g5', 'Guía de Learn·ax', 'pdf', 'https://x/d.pdf', 'recetas', 0, true)`);

async function app(fn, ...args) {
    await db.exec('SET ROLE anon');
    try { return (await db.query(fn, args)).rows; } finally { await db.exec('RESET ROLE'); }
}
await ok('con token + NIP activo: solo las de la app, activas y en su orden (por módulo)', async () => {
    const r = (await app(`SELECT portal_guias_movil($1,$2,$3) AS g`, 'A', 'tokA', 'h1'))[0].g;
    assert.deepEqual(r.map(x => x.modulo + ':' + x.titulo), ['movil_costax:Manual Cost·ax', 'movil_costax:Entradas paso a paso', 'movil_equipax:Tu turno en la app']);
    assert.deepEqual(Object.keys(r[0]).sort(), ['descripcion', 'id', 'modulo', 'orden', 'tipo', 'titulo', 'url']);
});
await ok('con un NIP de baja o inventado, nada', async () => {
    assert.equal((await app(`SELECT portal_guias_movil($1,$2,$3) AS g`, 'A', 'tokA', 'h3'))[0].g, null);
    assert.equal((await app(`SELECT portal_guias_movil($1,$2,$3) AS g`, 'A', 'tokA', 'nada'))[0].g, null);
});
await ok('…ni con el token equivocado', async () =>
    assert.equal((await app(`SELECT portal_guias_movil($1,$2,$3) AS g`, 'A', 'otro', 'h1'))[0].g, null));
await ok('la app (anon) no puede leer la tabla de guías directo', async () =>
    assert.rejects(() => app(`SELECT * FROM guias`), /permission denied/));
await db.close();
console.log('\n🔒 v96 OK — ' + cuenta + ' comprobaciones contra Postgres');
