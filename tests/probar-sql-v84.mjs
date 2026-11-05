/* Corre supabase-migration-v83.sql contra un Postgres DE VERDAD (PGlite).
   Primero se PROVOCAN los cinco agujeros que encontró Codex con lo que hay
   HOY en producción —la v82, corrida tal cual del repo, no reescrita— y
   después se corre la v83 y se comprueba que cada uno quedó cerrado y que lo
   legítimo sigue vivo. Ninguna escritura toca datos reales.

   PGLITE_DIR apunta a una carpeta con `@electric-sql/pglite` instalado fuera
   del proyecto (por defecto /tmp/etaax-billing-sql). */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {PGlite} = createRequire((process.env.PGLITE_DIR || '/tmp/etaax-billing-sql') + '/test.cjs')('@electric-sql/pglite');
const db = new PGlite();
let cuenta = 0;
const ok = async (nombre, fn) => { await fn(); cuenta++; console.log('PASA ' + nombre); };
const q = async (sql, args) => (await db.query(sql, args)).rows;
const uno = async (sql, args) => (await q(sql, args))[0];
const datosDe = async (tabla, id) => (await uno('SELECT datos FROM ' + tabla + ' WHERE id=$1', [id])).datos;

/* ── El mundo mínimo que la v82 da por existente ────────────────────────── */
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE negocios (id TEXT PRIMARY KEY, datos JSONB);
CREATE TABLE staff (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
CREATE TABLE inventarios (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB);
CREATE TABLE inventario_conteos (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB,
                                 created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE entradas_log (id TEXT PRIMARY KEY, negocio_id TEXT, datos JSONB,
                           created_at TIMESTAMPTZ DEFAULT now());

CREATE FUNCTION _entrada_token_ok(p_neg TEXT, p_token TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM negocios n WHERE n.id = p_neg
                    AND n.datos->>'entradaToken' = p_token
                    AND p_token IS NOT NULL AND p_token <> '');
$$;
/* El freno del NIP va en su forma mínima: aquí se prueba el CONTRATO de
   corrección, no el freno. Decirlo evita que los verdes de este archivo se
   lean como «el freno quedó probado» (lo apuntó Codex de la suite de la v82). */
CREATE FUNCTION _nip_guardia(p_neg TEXT, p_niphash TEXT) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$ SELECT TRUE $$;
CREATE FUNCTION entrada_validar_nip(p_neg TEXT, p_token TEXT, p_niphash TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v TEXT;
BEGIN
    IF NOT _nip_guardia(p_neg, p_niphash) THEN RETURN NULL; END IF;
    IF NOT _entrada_token_ok(p_neg, p_token) THEN RETURN NULL; END IF;
    SELECT s.datos->>'nombre' INTO v FROM staff s
     WHERE s.negocio_id = p_neg AND s.datos->>'nipHash' = p_niphash
       AND COALESCE(NULLIF(s.datos->>'estado',''),'Activo') = 'Activo' LIMIT 1;
    RETURN v;
END; $$;

INSERT INTO negocios (id, datos) VALUES ('neg1','{"entradaToken":"tok1"}');
INSERT INTO staff (id, negocio_id, datos) VALUES
    ('st_ana', 'neg1','{"nombre":"Ana","nipHash":"hA","sucursalId":"s1","rol":"barman","estado":"Activo"}'),
    ('st_beto','neg1','{"nombre":"Beto","nipHash":"hB","sucursalId":"s1","rol":"cocinero","estado":"Activo"}'),
    ('st_gere','neg1','{"nombre":"Gere","nipHash":"hG","sucursalId":"s1","rol":"gerente","estado":"Activo"}');
`);

/* ── CÓMO ESTÁ HOY: la v82, corrida tal cual del repo ───────────────────── */
const V82 = fs.readFileSync(new URL('../supabase-migration-v82.sql', import.meta.url), 'utf8');
await db.exec(V82);

const CONTEO = (id, extra = {}) => JSON.stringify(Object.assign({
    id, nombre: 'Ron Añejo', insumoId: 'ron1', sucursalId: 's1', area: 'barra',
    cerradasBodega: 10, cerradasBarra: 0, fecha: '2026-10-20', hora: '19:00'
}, extra));
const ENTRADA = (id, extra = {}) => JSON.stringify(Object.assign({
    id, concepto: 'entrada', nombre: 'Ron Añejo', insumoId: 'ron1',
    sucursalId: 's1', area: 'barra', cantidad: 6, unidad: 'PZA',
    /* DESPUÉS del último cierre del fixture: el historial solo trae el periodo
       abierto, así que una entrada con fecha anterior no saldría y la prueba
       mediría el filtro del periodo en vez de lo que viene a comprobar. */
    fecha: '2026-10-22', hora: '10:00', registrado: '2026-10-22T10:00:00Z'
}, extra));
const registrar  = (nip, datos) => uno('SELECT inventario_conteo_registrar($1,$2,$3,$4::jsonb) AS id', ['neg1','tok1',nip,datos]);
const registrarE = (nip, datos) => uno('SELECT entrada_registrar($1,$2,$3,$4::jsonb) AS id', ['neg1','tok1',nip,datos]);
const editar = (nip, tipo, id, ver, cambios, op) => uno(
    'SELECT entrada_editar($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS r',
    ['neg1','tok1',nip,tipo,id,ver,JSON.stringify(cambios),op || null]);
const historial = (nip, area) => uno('SELECT entrada_historial($1,$2,$3,$4,$5) AS r', ['neg1','tok1',nip,'s1',area||'barra']);


await db.exec(`
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION es_staff_de(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
ALTER TABLE negocios ADD COLUMN usuario_id uuid;
UPDATE negocios SET usuario_id='00000000-0000-0000-0000-000000000001';
CREATE TABLE horarios(id text PRIMARY KEY,negocio_id text,datos jsonb);
INSERT INTO horarios VALUES('hor_suc_principal_2026-W45','neg1','{"id":"hor_suc_principal_2026-W45","semana":"2026-W45","sucursalId":"suc_principal","turnos":{"ana":{"d0":{"in":"09:00"}}}}');
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,anon;
`);
await db.exec(fs.readFileSync(new URL('../supabase-migration-v83.sql', import.meta.url),'utf8'));
const V84=fs.readFileSync(new URL('../supabase-migration-v84.sql', import.meta.url),'utf8');
await db.exec(V84);
await db.exec(V84);
console.log('v84 instalada dos veces');
const UID='00000000-0000-0000-0000-000000000001';
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[UID]);
const inv=(id,extra={})=>({id,sucursalId:'s1',area:'barra',filas:[{insumoId:'ron1',cerradasBodega:8,cerradasBarra:0}],...extra});
const apply=async(datos,conteos,op='apply1',desc=false)=>(await uno('SELECT inventario_conteos_aplicar($1,$2::jsonb,$3::jsonb,$4,$5) AS r',['neg1',JSON.stringify(datos),JSON.stringify(conteos),op,desc])).r;
const failure=async(fn)=>{let threw=false;try{await fn();}catch(e){threw=true;}assert.ok(threw,'debía rechazar la escritura');};
await ok('horarios existentes conservan turnos al migrar la identidad',async()=>{
 const r=await uno('SELECT id,datos FROM horarios');assert.equal(r.id,'hor_4_neg1_suc_principal_2026-W45');assert.equal(r.datos.id,r.id);assert.equal(r.datos.turnos.ana.d0.in,'09:00');
});
await ok('dos negocios pueden escribir la misma sucursal y semana desde clientes antiguos',async()=>{
 await db.exec(`INSERT INTO horarios VALUES('hor_suc_principal_2026-W45','neg2','{"semana":"2026-W45","sucursalId":"suc_principal","turnos":{"b":{}}}') ON CONFLICT(id) DO UPDATE SET negocio_id=EXCLUDED.negocio_id,datos=EXCLUDED.datos`);
 assert.equal((await uno('SELECT count(*)::int AS n FROM horarios')).n,2);
 await failure(()=>db.exec("UPDATE horarios SET negocio_id='neg2' WHERE negocio_id='neg1'"));
});
await ok('una cola antigua no sobreescribe una semana más reciente',async()=>{
 await db.exec(`UPDATE horarios SET datos=datos||'{"updated":100}'::jsonb WHERE negocio_id='neg1';
 INSERT INTO horarios VALUES('hor_suc_principal_2026-W45','neg1','{"semana":"2026-W45","sucursalId":"suc_principal","updated":10,"turnos":{}}') ON CONFLICT(id) DO UPDATE SET datos=EXCLUDED.datos`);
 assert.ok((await uno("SELECT datos FROM horarios WHERE negocio_id='neg1'")).datos.turnos.ana);
});
await registrar('hA',CONTEO('count1'));
await editar('hA','conteo','count1',1,{cerradasBodega:8},'edit1');
const corrected=await datosDe('inventario_conteos','count1');
await ok('reenvíos con versión ausente, actual o futura no modifican la captura',async()=>{
 for(const ver of [undefined,1,2,999]){await registrar('hA',CONTEO('count1',{cerradasBodega:99,ver}));assert.deepEqual(await datosDe('inventario_conteos','count1'),corrected);}
});
await ok('el editor requiere versión: null no elude conflictos',async()=>assert.equal((await editar('hA','conteo','count1',null,{cerradasBodega:9},'nullver')).r.motivo,'conflicto'));
await ok('aplicar la copia v1 rechaza todo antes de guardar el inventario',async()=>{
 const r=await apply(inv('inv1'),[{id:'count1',ver:1}]);assert.equal(r.motivo,'conflicto-conteo');
 assert.equal((await uno("SELECT count(*)::int AS n FROM inventarios WHERE id='inv1'")).n,0);assert.deepEqual(await datosDe('inventario_conteos','count1'),corrected);
});
await ok('aplicar v2 guarda inventario y sello conservando cantidad y auditoría',async()=>{
 const r=await apply(inv('inv1'),[{id:'count1',ver:2}]);assert.equal(r.ok,true);assert.equal(r.inventario.qrRevision,1);
 const c=await datosDe('inventario_conteos','count1');assert.equal(c.aplicado,true);assert.equal(c.cerradasBodega,8);assert.equal(c.ver,2);assert.deepEqual(c.auditoria,corrected.auditoria);
});
await ok('respuesta perdida: repetir la misma operación no suma otra vez',async()=>{
 const r=await apply(inv('inv1'),[{id:'count1',ver:2}]);assert.equal(r.repetida,true);assert.equal(r.inventario.qrRevision,1);assert.equal(r.inventario.filas[0].cerradasBodega,8);
 const changed=await apply(inv('inv1',{filas:[]}),[{id:'count1',ver:2}]);assert.equal(changed.motivo,'operacion');
});
await ok('una pestaña vieja no puede reescribir el conteo ni quitar la revisión QR',async()=>{
 await db.exec('SET ROLE authenticated');
 try{
 await failure(()=>q("UPDATE inventario_conteos SET datos=$1::jsonb WHERE id='count1'",[CONTEO('count1')]));
 await failure(()=>q("UPDATE inventarios SET datos=$1::jsonb WHERE id='inv1'",[JSON.stringify(inv('inv1'))]));
 }finally{await db.exec('RESET ROLE');}
});
await ok('un cliente antiguo no guarda primero cifras QR sin confirmación',async()=>{
 await db.exec('SET ROLE authenticated');
 try{await failure(()=>q("INSERT INTO inventarios VALUES('legacyqr','neg1',$1::jsonb)", [JSON.stringify(inv('legacyqr',{filas:[{insumoId:'ron1',cerradasBodega:10,conteoQR:{por:'Ana',fecha:'2026-11-04'}}]}))]));}
 finally{await db.exec('RESET ROLE');}
});
await ok('un upsert normal con la revisión vigente sigue funcionando',async()=>{
 const current=await datosDe('inventarios','inv1');current.nombre='Edición posterior';
 await db.exec('SET ROLE authenticated');
 try{await q("INSERT INTO inventarios VALUES('inv1','neg1',$1::jsonb) ON CONFLICT(id) DO UPDATE SET datos=EXCLUDED.datos",[JSON.stringify(current)]);}finally{await db.exec('RESET ROLE');}
 assert.equal((await datosDe('inventarios','inv1')).nombre,'Edición posterior');
});
await ok('el QR no permite editar ni reaplicar un conteo consumido',async()=>{
 assert.equal((await editar('hA','conteo','count1',2,{cerradasBodega:7},'late')).r.motivo,'aplicado');
 assert.equal((await apply(inv('inv2'),[{id:'count1',ver:2}],'apply2')).motivo,'resuelto');
});
await registrar('hA',CONTEO('c_good'));await registrar('hA',CONTEO('c_stale'));await editar('hA','conteo','c_stale',1,{cerradasBodega:4},'editstale');
await ok('aplicar todos es atómico si uno de los conteos cambió',async()=>{
 const r=await apply(inv('inv3'),[{id:'c_good',ver:1},{id:'c_stale',ver:1}],'apply3');assert.equal(r.ok,false);
 assert.equal((await datosDe('inventario_conteos','c_good')).aplicado,false);
});
await ok('descartar se confirma en servidor sin cambiar existencias',async()=>{
 const i=inv('discard',{filas:[{insumoId:'ron1',cerradasBodega:20}]});
 assert.equal((await apply(i,[{id:'c_good',ver:1}],'discard',true)).ok,true);
 assert.equal((await datosDe('inventario_conteos','c_good')).descartado,true);assert.equal((await datosDe('inventarios','discard')).filas[0].cerradasBodega,20);
});
await ok('no aplica conteos de otra sucursal ni sin sesión',async()=>{
 assert.equal((await apply(inv('wrong',{sucursalId:'s9'}),[{id:'c_stale',ver:2}],'wrong')).motivo,'ambito');
 await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
 assert.equal((await apply(inv('noauth'),[{id:'c_stale',ver:2}],'noauth')).motivo,'permiso');
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[UID]);
});
await db.exec(`INSERT INTO inventarios VALUES('closed','neg1','{"cerrado":true,"area":"cocina","sucursalId":"s1","fecha":"2026-10-21","cierreOperativo":"2026-10-21T14:00:00Z"}')`);
await registrar('hB',CONTEO('after',{area:'cocina'}));await q("UPDATE inventario_conteos SET created_at=$1::timestamptz WHERE id='after'",['2026-10-21T15:00:00Z']);
await ok('un conteo después del cierre del mismo día sí aparece',async()=>assert.ok((await historial('hB','cocina')).r.conteos.some(x=>x.id==='after')));
await registrarE('hB',ENTRADA('eafter',{area:'cocina'}));await q("UPDATE entradas_log SET datos=datos-'registrado',created_at=$1::timestamptz WHERE id='eafter'",['2026-10-21T15:00:00Z']);
await ok('entrada sin registrado usa created_at: después se edita, antes se bloquea',async()=>{
 assert.equal((await editar('hB','entrada','eafter',1,{cantidad:4},'after')).r.ok,true);
 await q("UPDATE entradas_log SET created_at=$1::timestamptz WHERE id='eafter'",['2026-10-21T13:00:00Z']);
 assert.equal((await editar('hB','entrada','eafter',2,{cantidad:3},'before')).r.motivo,'cerrado');
});
await ok('offsets equivalentes y fecha local comparan el mismo instante',async()=>{
 const r=await uno("SELECT _entrada_instante('2026-10-21T14:00:00Z')=_entrada_instante('2026-10-21T08:00:00-06:00') AS a, _entrada_instante('2026-10-21T08:00:00')=_entrada_instante('2026-10-21T14:00:00Z') AS b");assert.equal(r.a,true);assert.equal(r.b,true);
});
await ok('la RPC de aplicación no es ejecutable por anon',async()=>assert.equal((await uno("SELECT has_function_privilege('anon','inventario_conteos_aplicar(text,jsonb,jsonb,text,boolean)','EXECUTE') AS permitido")).permitido,false));
await db.close();console.log('SQL v84: '+cuenta+' casos, 0 fallas');
