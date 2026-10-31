import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {PGlite}=createRequire((process.env.PGLITE_DIR||'/tmp/etaax-billing-sql')+'/test.cjs')('@electric-sql/pglite');
const db=new PGlite();let cuenta=0;
async function ok(nombre,fn){await fn();cuenta++;console.log('PASA '+nombre);}
async function falla(q,args,pat){await assert.rejects(()=>db.query(q,args),pat);}
await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('prueba.admin',true),'false')='true'$$;CREATE TABLE public.negocios(id text primary key);GRANT USAGE ON SCHEMA public,auth TO authenticated;`);
const sql=fs.readFileSync(new URL('../supabase-migration-v81.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
await db.exec("SET ROLE authenticated;SET prueba.admin='true'");
const base={id:'doc1',folio:' rec-1 ',tipo:'recibo',estado:'pendiente',cliente:'Cliente de prueba',fecha:'2026-10-28',total:12000,suscripcion_monto:12000,meses:12,periodo_desde:'2026-10-01',datos:{cliente:'Cliente de prueba'},html:'<html>Original 12000</html>'};
const crear=async d=>(await db.query('select * from public.admin_documento_crear($1::jsonb)',[JSON.stringify(d)])).rows[0];
const actualizar=async (id,v,c)=>(await db.query('select * from public.admin_documento_actualizar($1,$2,$3::jsonb)',[id,v,JSON.stringify(c)])).rows[0];
await ok('crear y reintentar devuelve un solo folio normalizado',async()=>{const a=await crear(base),b=await crear(base);assert.equal(a.folio,'REC-1');assert.equal(a.id,b.id);assert.equal((await db.query('select count(*)::int as n from admin_documentos')).rows[0].n,1);});
await ok('otro documento con el mismo folio no sobrescribe el original',async()=>{await assert.rejects(()=>crear({...base,id:'otro',folio:'REC-1'}),/unique/i);await assert.rejects(()=>crear({...base,total:100}),/ya se guardó/);});
await ok('guardar pagado exige fecha; total y original quedan intactos',async()=>{await assert.rejects(()=>actualizar('doc1',1,{estado:'pagado'}),/check constraint/);const d=await actualizar('doc1',1,{estado:'pagado',fecha_pago:'2026-10-28',metodo:'Transferencia',total:1,html:'alterado'});assert.equal(d.estado,'pagado');assert.equal(Number(d.total),12000);assert.equal(d.html,base.html);assert.equal(d.version,2);assert.equal(d.cambios.length,2);});
await ok('una pestaña atrasada no pisa el estado nuevo',async()=>{await assert.rejects(()=>actualizar('doc1',1,{estado:'pendiente'}),/otra ventana/);});
await ok('anulación pide motivo y deja la bitácora',async()=>{await assert.rejects(()=>actualizar('doc1',2,{estado:'anulado'}),/motivo/);const d=await actualizar('doc1',2,{estado:'anulado',nota:'Duplicado de control'});assert.equal(d.fecha_pago,null);assert.equal(d.cambios[2].cambios.nota,'Duplicado de control');});
await ok('presupuesto no admite estado pagado',async()=>{await assert.rejects(()=>crear({...base,id:'pre1',folio:'PRE-1',tipo:'presupuesto',estado:'pagado',fecha_pago:'2026-10-28'}),/check constraint/);});
await ok('convertir presupuesto solo permite un recibo vinculado',async()=>{await crear({...base,id:'pre1',folio:'PRE-1',tipo:'presupuesto'});await crear({...base,id:'rec-pre1',folio:'REC-PRE1',presupuesto_id:'pre1'});await assert.rejects(()=>crear({...base,id:'rec-pre2',folio:'REC-PRE2',presupuesto_id:'pre1'}),/unique/);});
await ok('meses y monto de suscripción se validan en el servidor',async()=>{await assert.rejects(()=>crear({...base,id:'m0',folio:'M0',meses:0}),/check constraint/);await assert.rejects(()=>crear({...base,id:'m1',folio:'M1',suscripcion_monto:13000}),/check constraint/);await assert.rejects(()=>crear({...base,id:'m2',folio:'M2',periodo_desde:null}),/check constraint/);});
await ok('admin usa RPC; no puede actualizar importes directamente desde el cliente',async()=>{await falla("update admin_documentos set total=1 where id='doc1'",[],/permission denied/);});
await ok('negocio y staff no leen ni generan documentos de plataforma',async()=>{await db.exec("SET prueba.admin='false'");assert.equal((await db.query('select * from admin_documentos')).rows.length,0);await assert.rejects(()=>crear({...base,id:'sin-admin',folio:'SIN-ADMIN'}),/exclusivo/);await assert.rejects(()=>actualizar('doc1',3,{estado:'pendiente'}),/exclusivo/);});
await db.exec('RESET ROLE;SET ROLE anon');
await ok('anónimo no tiene acceso ni RPC',async()=>{await falla('select * from admin_documentos',[],/permission denied/);await assert.rejects(()=>crear(base),/permission denied/);});
await db.close();console.log('SQL v81: '+cuenta+' casos, 0 fallas');
