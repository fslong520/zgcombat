// Enumerate EVERY /file/... audio asset the frontend references anywhere in
// the project, then download them from the upstream CodeCombat CDN into
// ./codecombat_assets so they can be served locally (offline).
//
// Discovery is data-driven, NOT hardcoded:
//   (a) Scan ALL source files under app/ for any sound reference:
//         - interface-sound names passed to playInterfaceSound / preloadInterfaceSounds
//           (both `f(x)` and CoffeeScript paren-free `f x` styles)
//         - names passed to playSound / preloadSound / preloadSoundReference
//         - any literal  /file/(interface|music|db)/...   string
//         - any literal  *.mp3 / *.ogg / *.wav  filename string
//   (b) Walk EVERY MongoDB collection recursively, accepting any relative
//       audio path of the form db/<collection>/<hex>/... , interface/... ,
//       music/... (no longer limited to thang.types/levels/campaigns).
//   (c) Enumerate music_level_1..N and try both .mp3 AND .ogg for every base.
//
// Only text-to-speech URLs (built from arbitrary phrases at runtime) are
// intentionally omitted — the server proxies those on demand.
//
// Every attempt is logged per-item to ./download_report.txt so the user can
// review exactly which sounds were fetched vs. which genuinely 404 upstream.
//
// Usage: node download_assets.js            (skips files already present)
//        node download_assets.js --force    (re-download everything)

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT = __dirname;
const ASSET_DIR = path.join(ROOT, 'codecombat_assets');
const REPORT = path.join(ROOT, 'download_report.txt');
const UPSTREAM = 'https://codecombat.com/file/';
const FORCE = process.argv.includes('--force');
const CONCURRENCY = 12;

const seen = new Set();
const relpaths = [];

// Normalize + accept a relative path if it looks like a servable /file/* asset.
function add(p) {
  if (!p || typeof p !== 'string') return;
  p = p.replace(/^\/file\//, '').replace(/^\/+/, '').trim();
  if (!p) return;
  const ok = /^(db\/[^/]+\/[0-9a-f]{24}\/.+?\.(mp3|ogg|wav))$/i.test(p) ||
            /^(interface\/.+?\.(mp3|ogg|wav))$/i.test(p) ||
            /^(music\/.+?\.(mp3|ogg|wav))$/i.test(p);
  if (!ok) return;
  if (!seen.has(p)) { seen.add(p); relpaths.push(p); }
}

// Given a "base" (path without extension), try both extensions so we never
// silently skip the one the browser actually requests.
function addBase(base) {
  if (!base) return;
  base = base.replace(/^\/file\//, '').replace(/^\/+/, '').replace(/\.(mp3|ogg|wav)$/i, '');
  if (!base) return;
  add(base + '.mp3');
  add(base + '.ogg');
}

// ---- (a) scan app/ source for sound references ----------------------------
function scanCodeFile(file) {
  let s;
  try { s = fs.readFileSync(file, 'utf8'); } catch (e) { return; }

  // preloadInterfaceSounds(['a', 'b', ...])  (paren style)
  const rePre = /preloadInterfaceSounds\(\s*\[([\s\S]*?)\]\s*\)/g;
  let m;
  while ((m = rePre.exec(s))) {
    const inner = m[1].match(/'([^']+)'|"([^"]+)"/g) || [];
    inner.forEach((x) => addBase('interface/' + x.slice(1, -1)));
  }

  // playInterfaceSound('x') / playInterfaceSound 'x'  (coffee paren-free)
  // --- these are definitely interface sounds
  const reIface = /playInterfaceSound\s*[\(]?\s*['"]([^'"]+)['"]/g;
  while ((m = reIface.exec(s))) { addBase('interface/' + m[1]); }

  // playSound('x') / preloadSound('x') / preloadSoundReference(...)
  // --- resolution: if it's a path already, use it; a bare name here is a
  //     thang-event name resolved via MongoDB soundTriggers (not interface).
  const reName = /(?:playSound|preloadSound|preloadSoundReference)\s*[\(]?\s*['"]([^'"]+)['"]/g;
  while ((m = reName.exec(s))) {
    const n = m[1];
    if (n.startsWith('/file/') || n.startsWith('db/') || n.startsWith('interface/') || n.startsWith('music/')) {
      add(n);
    }
    // bare thang-event names are skipped here (covered by the MongoDB scan)
  }

  // explicit /file/(interface|music|db)/... literals
  const reLit = /(\/file\/(?:interface|music|db)\/[^'"\s)]+?\.(mp3|ogg|wav))/gi;
  while ((m = reLit.exec(s))) { add(m[1]); }

  // any standalone *.mp3 / *.ogg / *.wav filename literal
  const reExt = /['"]([^'"]+?\.(mp3|ogg|wav))['"]/gi;
  while ((m = reExt.exec(s))) { add(m[1]); }

  // 'audio-player:play-sound' triggers -> interface sound names (literal trigger)
  const reTrig = /audio-player:play-sound['"][^}]*?trigger:\s*['"]([^'"]+)['"]/g;
  while ((m = reTrig.exec(s))) { addBase('interface/' + m[1]); }

  // Local string arrays in audio-related files (e.g. jinbles = ['ident_1','ident_2'])
  // -> treat each token as a candidate interface sound. Only when the array is
  // assigned to an audio-ish variable name, so we skip noise like the ROT13
  // `swears` list in AudioPlayer.coffee.
  if (/AudioPlayer|LevelLoader|Lank|\/sound/i.test(file)) {
    const reArr = /([a-zA-Z_$][\w$]*)\s*=\s*\[\s*(?:'([^']+)'\s*,?\s*)+]/g;
    let am;
    while ((am = reArr.exec(s))) {
      const varName = am[1];
      if (/swear/i.test(varName)) continue; // skip the ROT13 profanity list
      if (!/jingle|sound|sfx|preload|interface|audi|music|list|name|track/i.test(varName)) continue;
      const toks = am[0].match(/'([^']+)'/g) || [];
      toks.forEach((t) => {
        const n = t.slice(1, -1);
        if (/^[a-z][a-z0-9_]*$/.test(n)) addBase('interface/' + n);
      });
    }
  }
}

function walkCode(dir) {
  let entries;
  try { entries = fs.readFileSync && fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (['node_modules', 'public_coco', 'bower_components', '.git', 'codecombat_assets', 'file_cache'].includes(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { walkCode(full); }
    else if (/\.(coffee|js|jsx|ts|pug|jade|sass|scss|less|html|vue|json)$/.test(ent.name)) { scanCodeFile(full); }
  }
}

// ---- (b) scan EVERY MongoDB collection recursively -------------------------
function walkDoc(o) {
  if (typeof o === 'string') {
    let m = o.match(/db\/[^/]+\/[0-9a-f]{24}\/[^\s'"\\]+?\.(mp3|ogg|wav)/i);
    if (m) add(m[0]);
    let m2 = o.match(/\/file\/(db\/[^/]+\/[0-9a-f]{24}\/[^\s'"\\]+?\.(mp3|ogg|wav))/i);
    if (m2) add(m2[1]);
    let m3 = o.match(/(?:^|[^\w\/])(interface\/[^\s'"\\]+?\.(mp3|ogg|wav))/i);
    if (m3) add(m3[1]);
    let m4 = o.match(/(?:^|[^\w\/])(music\/[^\s'"\\]+?\.(mp3|ogg|wav))/i);
    if (m4) add(m4[1]);
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
  const report = [];
  report.push('download_assets run @ ' + new Date().toISOString() + (FORCE ? ' (--force)' : ''));

  console.log('Scanning app/ source for sound references...');
  walkCode(path.join(ROOT, 'app'));

  // Music tracks: enumerate the known level-music range (CodeCombat ships
  // ~12 level tracks). Beyond that, specific music is discovered from the DB.
  for (let n = 1; n <= 12; n++) { addBase('music/music_level_' + n); }

  console.log('Connecting to MongoDB to scan ALL collections...');
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db('coco');
  const colls = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  console.log('  ' + colls.length + ' collections: ' + colls.join(', '));
  for (const coll of colls) {
    try {
      const cursor = db.collection(coll).find({}, { projection: { _id: 0 } });
      let doc;
      let count = 0;
      while ((doc = await cursor.next())) { walkDoc(doc); count++; }
      if (count) report.push(`  scanned collection "${coll}": ${count} docs`);
    } catch (e) { report.push(`  ERROR scanning "${coll}": ${e.message}`); }
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

  report.push(`Discovered ${relpaths.length} unique paths; ok=${ok} cached=${cached} failed=${fail.length}`);
  if (fail.length) {
    console.log('\nFailures (' + fail.length + '):');
    report.push('\n--- FAILED (genuinely missing upstream) ---');
    fail.forEach((r) => {
      const line = `  ${r.status} ${r.code || r.msg || ''}  ${r.rel}`;
      console.log(line);
      report.push(line);
    });
  }
  fs.writeFileSync(REPORT, report.join('\n') + '\n');
  console.log('\nPer-item report written to ' + REPORT);
}

main().catch((e) => { console.error(e); process.exit(1); });
