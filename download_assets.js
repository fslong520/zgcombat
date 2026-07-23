// Enumerate every /file/... audio asset the frontend actually references,
// then download them from the upstream CodeCombat CDN into ./codecombat_assets
// so they can be served locally (offline) instead of proxied at runtime.
//
// Discovery is NOT hardcoded: we scan (a) the app/ source for interface-sound
// names and music tracks, and (b) every thang.type / level / campaign doc in
// MongoDB for the relative `db/...` asset paths stored in soundTriggers,
// script noteChains, etc. Only text-to-speech URLs (built from arbitrary
// phrases) are intentionally omitted, since they can't be enumerated — the
// server proxies those on demand.
//
// Usage: node download_assets.js            (skips files already present)
//        node download_assets.js --force    (re-download everything)

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const ROOT = __dirname;
const ASSET_DIR = path.join(ROOT, 'codecombat_assets');
const UPSTREAM = 'https://codecombat.com/file/';
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 12;

const seen = new Set();
const relpaths = [];

function add(p) {
  if (!p || typeof p !== 'string') return;
  p = p.replace(/^\/file\//, '').replace(/^\/+/, '');
  if (!p) return;
  const ok = /^(db\/(thang\.type|level|campaign)\/[0-9a-f]{24}\/.+?\.(mp3|ogg|wav))$/i.test(p) ||
            /^(interface\/.+?\.(mp3|ogg))$/i.test(p) ||
            /^(music\/.+?\.(mp3|ogg))$/i.test(p);
  if (!ok) return;
  if (!seen.has(p)) { seen.add(p); relpaths.push(p); }
}

// ---- (a) scan app/ source for sound references ----------------------------
function scanCodeFile(file) {
  let s;
  try { s = fs.readFileSync(file, 'utf8'); } catch (e) { return; }

  // preloadInterfaceSounds(['a', 'b', ...])
  const re1 = /preloadInterfaceSounds\(\s*\[([\s\S]*?)\]\s*\)/g;
  let m;
  while ((m = re1.exec(s))) {
    const inner = m[1].match(/'([^']+)'|"([^"]+)"/g) || [];
    inner.forEach((x) => {
      const n = x.slice(1, -1);
      add('interface/' + n + '.mp3');
      add('interface/' + n + '.ogg');
    });
  }

  // playSound('name') / playInterfaceSound('name') / preloadSound('name' or '/file/...')
  const re2 = /(?:playSound|playInterfaceSound|preloadSound)\(\s*'([^']+)'/g;
  while ((m = re2.exec(s))) {
    const n = m[1];
    if (n[0] === '/') { add(n); }
    else { add('interface/' + n + '.mp3'); add('interface/' + n + '.ogg'); }
  }

  // explicit /file/interface/... or /file/music/... literals
  const re3 = /(\/file\/(?:interface|music)\/[^'"\s]+?\.(mp3|ogg|wav))/g;
  while ((m = re3.exec(s))) { add(m[1]); }

  // /music/<x>.mp3 literals
  const re4 = /(['"])(\/music\/[^'"]+?\.(mp3|ogg|wav))\1/g;
  while ((m = re4.exec(s))) { add(m[2].replace(/^\//, '')); }
}

function walkCode(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === 'public_coco' || ent.name === 'bower_components' || ent.name === '.git') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { walkCode(full); }
    else if (/\.(coffee|js|jsx|ts|pug|sass|scss|html)$/.test(ent.name)) { scanCodeFile(full); }
  }
}

// ---- (b) scan MongoDB for relative db/... asset paths ---------------------
function walkDoc(o) {
  if (typeof o === 'string') {
    let m = o.match(/db\/(thang\.type|level|campaign)\/[0-9a-f]{24}\/[^\s'"]+?\.(mp3|ogg|wav)/i);
    if (m) add(m[0]);
    let m2 = o.match(/\/file\/(db\/(thang\.type|level|campaign)\/[0-9a-f]{24}\/[^\s'"]+?\.(mp3|ogg|wav))/i);
    if (m2) add(m2[1]);
  } else if (Array.isArray(o)) { o.forEach(walkDoc); }
  else if (o && typeof o === 'object') { for (const k in o) walkDoc(o[k]); }
}

// ---- download -------------------------------------------------------------
async function downloadOne(rel) {
  const cacheFile = path.join(ASSET_DIR, rel);
  if (!FORCE) { try { fs.accessSync(cacheFile); return { rel, status: 'cached' }; } catch (e) {} }
  try {
    const r = await fetch(UPSTREAM + rel);
    if (!r.ok) return { rel, status: 'fail', code: r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.promises.writeFile(cacheFile, buf);
    return { rel, status: 'ok', bytes: buf.length };
  } catch (e) {
    return { rel, status: 'error', msg: e.message };
  }
}

async function runPool(tasks) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results.push(await downloadOne(tasks[idx]));
    }
  }
  const workers = [];
  for (let k = 0; k < CONCURRENCY; k++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('Scanning app/ source for interface + music references...');
  walkCode(path.join(ROOT, 'app'));

  // Music tracks are built from difficulty; enumerate a safe range.
  for (let n = 1; n <= 12; n++) { add('music/music_level_' + n + '.mp3'); add('music/music_level_' + n + '.ogg'); }

  console.log('Connecting to MongoDB to scan thang.types / levels / campaigns...');
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db('coco');
  for (const coll of ['thang.types', 'levels', 'campaigns']) {
    const cursor = db.collection(coll).find({}, { projection: { _id: 0 } });
    let doc;
    while ((doc = await cursor.next())) { walkDoc(doc); }
  }
  await client.close();

  console.log('Discovered ' + relpaths.length + ' unique asset paths.');
  if (!fs.existsSync(ASSET_DIR)) fs.mkdirSync(ASSET_DIR, { recursive: true });
  console.log('Downloading from ' + UPSTREAM + ' ...');
  const results = await runPool(relpaths);

  const ok = results.filter((r) => r.status === 'ok').length;
  const cached = results.filter((r) => r.status === 'cached').length;
  const fail = results.filter((r) => r.status !== 'ok' && r.status !== 'cached');
  console.log(`\nDone. ok=${ok} cached=${cached} failed=${fail.length} total=${results.length}`);
  if (fail.length) {
    console.log('\nFailures (first 40):');
    fail.slice(0, 40).forEach((r) => console.log('  ', r.status, r.code || r.msg || '', r.rel));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
