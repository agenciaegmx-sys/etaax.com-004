'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
// Reproducciones locales del estado auditado; no accede a servicios externos.
// Este script documenta fallos presentes, no sustituye las pruebas de aprobación.
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const out = (name, value) => console.log(JSON.stringify({ name, ...value }));
function extract(text, name) {
  const start = text.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert(start >= 0, 'function missing: ' + name);
  const body = text.indexOf('{', start);
  const end = text.indexOf('\n}', body);
  assert(end >= 0);
  return text.slice(start, end + 2);
}
function ls(initial = {}) {
  const m = { ...initial };
  return {
    _m: m, get length() { return Object.keys(m).length; },
    key: i => Object.keys(m)[i], getItem: k => m[k] ?? null,
    setItem(k, v) { m[k] = String(v); }, removeItem(k) { delete m[k]; },
  };
}
const silent = { log() {}, error() {}, warn() {} };
function context(extra = {}) {
  const els = {};
  const c = {
    console: silent, setTimeout, clearTimeout, setInterval: () => 0,
    localStorage: ls(), navigator: {},
    document: {
      readyState: 'loading', visibilityState: 'visible', hidden: false,
      addEventListener() {}, querySelectorAll: () => [], body: null,
      getElementById(id) { return els[id] ||= { style: {}, innerHTML: '', textContent: '' }; },
      createElement: () => ({ style: {}, setAttribute() {} }),
    },
    addEventListener() {}, ...extra,
  };
  c.window = c;
  return vm.createContext(c);
}
async function main() {
  // Parse production JS and executable inline scripts; no code is executed here.
  const files = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || ['tests', 'docs', '_data', 'node_modules'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  }
  walk(ROOT);
  let js = 0, inline = 0, html = 0;
  const errors = [], missingAssets = [];
  for (const p of files) {
    const text = fs.readFileSync(p, 'utf8');
    if (p.endsWith('.js')) {
      try { new vm.Script(text, { filename: p }); js++; } catch (e) { errors.push({ file: path.relative(ROOT, p), message: e.message }); }
    }
    if (!p.endsWith('.html')) continue;
    html++;
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/.test(m[1]) || /type\s*=\s*['"](?:application\/ld\+json|application\/json)['"]/.test(m[1]) || !m[2].trim()) continue;
      try { new vm.Script(m[2], { filename: path.relative(ROOT, p) + '#inline' }); inline++; }
      catch (e) { errors.push({ file: path.relative(ROOT, p), message: e.message }); }
    }
    for (const m of text.matchAll(/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const asset = m[1].split(/[?#]/)[0];
      if (/^(?:https?:|data:|\/\/)/.test(asset) || !/\.(?:js|css)$/.test(asset)) continue;
      const full = asset.startsWith('/') ? path.join(ROOT, asset) : path.resolve(path.dirname(p), asset);
      if (!fs.existsSync(full)) missingAssets.push({ html: path.relative(ROOT, p), asset });
    }
  }
  out('syntax_and_assets', { js, inline, html, errors, missingAssets });

  const latest = {};
  const migrations = fs.readdirSync(ROOT).filter(p => /^supabase-migration-v\d+\.sql$/.test(p))
    .sort((a, b) => Number(a.match(/v(\d+)/)[1]) - Number(b.match(/v(\d+)/)[1]));
  for (const file of migrations) {
    for (const m of read(file).matchAll(/^CREATE(?: OR REPLACE)? FUNCTION\s+(\w+)\s*\([\s\S]*?\bAS\s*\$\$([\s\S]*?)\$\$\s*;/gim)) {
      latest[m[1]] = { file, body: m[2].replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '') };
    }
  }
  out('latest_sql_static', {
    staffLogin: { file: latest.staff_login.file, hasAttemptLimiter: /_login_golpe\s*\(/.test(latest.staff_login.body) },
    staffCredential: { file: latest.obtener_staff_cred.file, checksActiveState: /estado/.test(latest.obtener_staff_cred.body) },
    history: { file: latest.entrada_historial.file, checksActiveState: /estado/.test(latest.entrada_historial.body), hasAttemptLimiter: /_login_golpe\s*\(/.test(latest.entrada_historial.body) },
    count: { file: latest.inventario_conteo_registrar.file, updateOnConflict: latest.inventario_conteo_registrar.body.split(/ON CONFLICT/i)[1].trim() },
  });

  // Execute the actual admin renderer with synthetic data, then its generated handler.
  const payload = "n');globalThis.auditMarker=1;//";
  const c = context({
    _data: { negocios: [{ id: payload, usuario_id: 'owner', datos: { nombre: 'Negocio ficticio' } }], staff: [], usuarios: [] },
    _estadoSuscripcion: () => ({ color: '#aaa', label: 'Pendiente', estado: 'pendiente', activa: false }),
    esc: s => String(s), abrirDetalleNegocio() {}, auditMarker: 0,
  });
  vm.runInContext(extract(read('admin.html'), 'renderNegocios'), c);
  c.renderNegocios();
  const h = c.document.getElementById('tbodyNegocios').innerHTML.match(/<tr[^>]*onclick="([^"]*)"/)[1];
  vm.runInContext(h, c);
  assert.equal(c.auditMarker, 1);
  out('admin_id_xss', { markerExecuted: c.auditMarker === 1, generatedHandler: h });

  // Real production reload replaces an offline edit if the ID already exists remotely.
  const rt = context({
    _cacheCortes: [{ id: 'c1', efectivo: 200 }], _cacheGastos: [{ id: 'g1', monto: 200 }],
    getNegocioActivo: () => 'n1', sbDeletesPendientes: () => ({}),
    _supabase: { from(tabla) { return { select() { return this; }, eq() { return this; }, order() { return Promise.resolve({ data: [{ datos: tabla === 'cortes' ? { id: 'c1', efectivo: 100 } : { id: 'g1', monto: 100 } }] }); } }; } },
    renderAll() {}, renderDepositos() {}, gRenderAll() {}, _syncGastosCortes() {},
    sbPendientes: () => ({ c1: 'upsert', g1: 'upsert' }),
  });
  for (const name of ['_sinDelPend', '_reloadCortesRT', '_reloadGastosRT']) vm.runInContext(extract(read('administrativo/diario.html'), name), rt);
  await rt._reloadCortesRT(); await rt._reloadGastosRT();
  assert.equal(rt._cacheCortes[0].efectivo, 100); assert.equal(rt._cacheGastos[0].monto, 100);
  out('realtime_pending_edit', { expectedLocal: 200, actualCorte: rt._cacheCortes[0].efectivo, actualGasto: rt._cacheGastos[0].monto });

  // Branch B incorrectly includes legacy records from Matriz in the real summary filter.
  const suc = context({ localStorage: ls({ etaax_sucursal_activa: 'sucB' }) });
  vm.runInContext(extract(read('financiero/resumen.html'), '_suc') + '\n' + extract(read('financiero/resumen.html'), '_deSuc'), suc);
  assert.equal(suc._deSuc({ id: 'matriz-legacy', monto: 100 }), true);
  out('summary_branch_filter', { sucBIncludesLegacyMatriz: true });

  // Reuse the repository's existing IDB mock; load only helper definitions, no test suite.
  const helpers = vm.createContext({ require, __dirname: path.join(ROOT, 'tests'), console: silent, setTimeout, clearTimeout });
  vm.runInContext(read('tests/store-tests.js').split('(async function correr()')[0], helpers);
  const mountStore = idb => {
    const tab = context({ indexedDB: idb });
    vm.runInContext(read('etaax-store.js'), tab);
    return tab;
  };
  const noIDB = mountStore(null);
  await noIDB.etaaxStore.ready;
  noIDB.etaaxStore.set('etaax_n1_inv_local', '[{"id":"inv1"}]');
  await noIDB.etaaxStore.flush();
  const actualDurable = noIDB.localStorage._m.etaax_n1_inv_local ?? null;
  assert.equal(actualDurable, null);
  out('store_without_idb', { valueInMemory: noIDB.etaaxStore.get('etaax_n1_inv_local'), valueInDurableStorage: actualDurable });

  const shared = helpers.hacerIDB({ etaax_outbox_v1: '[]' });
  const a = mountStore(shared), b = mountStore(shared);
  await Promise.all([a.etaaxStore.ready, b.etaaxStore.ready]);
  a.etaaxStore.set('etaax_outbox_v1', '[{"uid":"pendingA"}]');
  await a.etaaxStore.flush();
  const bSees = b.etaaxStore.get('etaax_outbox_v1');
  b.etaaxStore.set('etaax_outbox_v1', '[{"uid":"pendingB"}]');
  await b.etaaxStore.flush();
  assert.equal(bSees, '[]');
  assert(!shared._disco.etaax_outbox_v1.includes('pendingA'));
  out('outbox_two_tabs', { tabBSawAfterTabAWrite: bSees, durableQueueAfterTabBWrite: shared._disco.etaax_outbox_v1 });

  // A failed upsert remains behind a successful delete, then recreates the row.
  let exists = true, attempts = 0;
  const queue = [
    { uid: 'old-upsert', op: 'upsert', tabla: 'cortes', k: 'c1', payload: { id: 'c1', negocio_id: 'n1', datos: { id: 'c1', efectivo: 200 } }, opts: { onConflict: 'id' } },
    { uid: 'new-delete', op: 'delete', tabla: 'cortes', k: 'c1', id: 'c1' },
  ];
  const db = context({
    localStorage: ls({ etaax_negocio_activo: 'n1', etaax_outbox_v1: JSON.stringify(queue) }),
    setTimeout: () => 0, clearTimeout() {},
    _supabase: { from() { return {
      upsert: async () => ++attempts === 1 ? { error: { message: 'Failed to fetch' } } : (exists = true, { error: null }),
      delete: () => ({ eq: async () => (exists = false, { error: null }) }),
    }; } },
  });
  vm.runInContext(read('etaax-db.js'), db);
  await db._sbFlush();
  const afterDelete = exists;
  await db._sbFlush();
  assert.equal(afterDelete, false); assert.equal(exists, true);
  out('outbox_delete_resurrection', { rowExistsAfterDelete: afterDelete, rowExistsAfterNextRetry: exists, pending: db._sbPendientes() });
}
main().catch(e => { console.error(e); process.exitCode = 1; });
