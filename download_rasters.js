// Download all raster background (and other) images referenced by thang.types
// from the upstream CodeCombat CDN into ./codecombat_assets so they are served
// locally (offline). This complements download_assets.js, which only handles
// audio. Background "Floor" ThangTypes store their image in `raster`, a path
// like "db/thang.type/<id>/<filename>.jpg".
//
// Usage: node download_rasters.js            (skip files already present)
//        node download_rasters.js --force    (re-download everything)

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT = __dirname;
const ASSET_DIR = path.join(ROOT, 'codecombat_assets');
const REPORT = path.join(ROOT, 'download_rasters_report.txt');
const UPSTREAM = 'https://codecombat.cn/file/';
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 8;

// Collect raster paths from a thang.type document.
function rasterOf(doc) {
  if (!doc) return null;
  // raster may be a string path or an array of {path} objects.
  let r = doc.raster;
  if (!r) return null;
  if (Array.isArray(r)) {
    const first = r.find((x) => x && x.path) || r[0];
    r = first && (first.path || first) || null;
  }
  if (typeof r !== 'string') return null;
  return r.replace(/^\/file\//, '').replace(/^\/+/, '').trim();
}

async function downloadOne(rel) {
  const out = path.join(ASSET_DIR, rel);
  if (!FORCE) { try { fs.accessSync(out); return { rel, status: 'cached' }; } catch (e) {} }
  try {
    const r = await fetch(UPSTREAM + rel);
    if (!r.ok) return { rel, status: 'fail', code: r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.promises.mkdir(path.dirname(out), { recursive: true });
    await fs.promises.writeFile(out, buf);
    return { rel, status: 'ok', bytes: buf.length };
  } catch (e) {
    return { rel, status: 'error', msg: e.message };
  }
}

async function runPool(tasks) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) { results.push(await downloadOne(tasks[i++])); }
  }
  const workers = [];
  for (let k = 0; k < CONCURRENCY; k++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const report = [];
  report.push('download_rasters run @ ' + new Date().toISOString() + (FORCE ? ' (--force)' : ''));

  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db('coco');
  const coll = db.collection('thang.types');

  const rels = [];
  const seen = new Set();
  const cursor = coll.find({ raster: { $exists: true, $ne: null } }, { projection: { _id: 0, raster: 1, kind: 1, name: 1 } });
  let doc;
  while ((doc = await cursor.next())) {
    const rel = rasterOf(doc);
    if (rel && !seen.has(rel)) { seen.add(rel); rels.push(rel); }
  }
  await client.close();

  console.log('Discovered ' + rels.length + ' raster paths (UPSTREAM=' + UPSTREAM + ').');
  if (!fs.existsSync(ASSET_DIR)) fs.mkdirSync(ASSET_DIR, { recursive: true });
  const results = await runPool(rels);

  const ok = results.filter((r) => r.status === 'ok').length;
  const cached = results.filter((r) => r.status === 'cached').length;
  const fail = results.filter((r) => r.status !== 'ok' && r.status !== 'cached');
  console.log(`\nDone. ok=${ok} cached=${cached} failed=${fail.length} total=${results.length}`);
  report.push(`Discovered ${rels.length} raster paths; ok=${ok} cached=${cached} failed=${fail.length}`);
  if (fail.length) {
    report.push('\n--- FAILED ---');
    fail.forEach((r) => report.push(`  ${r.status} ${r.code || r.msg || ''}  ${r.rel}`));
  }
  fs.writeFileSync(REPORT, report.join('\n') + '\n');
  console.log('Report -> ' + REPORT);
}

main().catch((e) => { console.error(e); process.exit(1); });
