/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
(function(setupLodash) {
  global._ = require('lodash');
  _.str = require('underscore.string');
  return _.mixin(_.str.exports());
})(this);

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const serverSetup = require('./server_setup');
const co = require('co');
const config = require('./server_config');
const Promise = require('bluebird');
const { publicFolderName } = require('./development/utils');
const publicPath = path.join(__dirname, publicFolderName);

module.exports.startServer = function(done) {
  const app = createAndConfigureApp();
  const httpServer = http.createServer(app).listen(app.get('port'), () => typeof done === 'function' ? done() : undefined);
  console.info('Express SSL server listening on port ' + app.get('port'));
  return {app, httpServer};
};

var createAndConfigureApp = (module.exports.createAndConfigureApp = function() {

  const app = express();
  if (config.forceCompression) {
    const compression = require('compression');
    app.use(compression());
  }
  serverSetup.setExpressConfigurationOptions(app);

  // Minimal client-init endpoints required by the new frontend (app/core/initialize + auth).
  // The full backend (auth, /db/*, etc.) lives in the upstream server which is not present in
  // this checkout, so we serve a stubbed anonymous userObject to let the SPA render.
  const anonymousUser = {
    _id: '000000000000000000000000',
    anonymous: true,
    testGroupNumber: 0,
    permissions: [],
    preferredLanguage: 'zh-HANS'
  };
  app.get('/user-data', function(req, res) {
    res.setHeader('Content-Type', 'application/javascript');
    const serverConfig = {
      codeNinjas: false,
      static: true,
      picoCTF: false,
      showCodePlayAds: false,
      production: false,
      stripe: false,
      buildInfo: { sha: (config.buildInfo && config.buildInfo.sha) || 'dev' }
    };
    res.send('window.userObject = ' + JSON.stringify(anonymousUser) + ';\nwindow.serverConfig = ' + JSON.stringify(serverConfig) + ';');
  });
  app.get('/auth/whoami', function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(anonymousUser));
  });

  // Lightweight /db API backed by the restored MongoDB `coco` database.
  // The upstream server/ handlers are not run (mongoose4 is incompatible with Node 26);
  // this serves the read endpoints the new frontend needs for campaign/level browsing & play.
  const { MongoClient: DbClient, ObjectId } = require('mongodb');
  const dbClient = new DbClient('mongodb://127.0.0.1:27017');
  let cocoDb = null;
  dbClient.connect().then(function (client) {
    cocoDb = client.db('coco');
    console.info('[db] connected to MongoDB coco database');
  }).catch(function (err) { console.error('[db] mongo connect failed', err); });

  // frontend collection name -> mongo collection name
  const DB_COLLECTIONS = {
    'campaign': 'campaigns',
    'campaigns': 'campaigns',
    'level': 'levels',
    'levels': 'levels',
    'level.component': 'level.components',
    'level.components': 'level.components',
    'level.system': 'level.systems',
    'level.systems': 'level.systems',
    'thang.type': 'thang.types',
    'thang.types': 'thang.types',
    'earned.achievement': 'earned_achievement',
    'earned_achievement': 'earned_achievement',
    'level.session': 'level.sessions',
    'level.sessions': 'level.sessions',
    'achievement': 'achievements',
    'article': 'articles',
    'patch': 'patches',
    'patches': 'patches',
    'poll': 'polls'
  };

  const toProjection = function (projectParam) {
    if (!projectParam) { return undefined; }
    const proj = {};
    String(projectParam).split(',').forEach(function (f) {
      const k = String(f).trim();
      if (k) { proj[k] = 1; }
    });
    return Object.keys(proj).length ? proj : undefined;
  };

  // Anonymous user lookup: the SPA injects a placeholder _id for anonymous users
  // and then fetches /db/user/<that id>. Always answer 200 (GET for read, PUT/PATCH
  // for the writes the SPA issues to persist anonymous state) with the anonymous
  // user so the client never sees a 404 / console error.
  const serveAnonymousUser = function (req, res) {
    if (!cocoDb) { return res.status(200).json(anonymousUser); }
    const id = req.params.id;
    if (/^[a-f0-9]{24}$/i.test(id)) {
      cocoDb.collection('users').findOne({ _id: new ObjectId(id) })
        .then(function (u) { return res.status(200).json(u || anonymousUser); })
        .catch(function () { return res.status(200).json(anonymousUser); });
    } else {
      return res.status(200).json(anonymousUser);
    }
  };
  app.get('/db/user/:id', serveAnonymousUser);
  app.put('/db/user/:id', serveAnonymousUser);
  app.patch('/db/user/:id', serveAnonymousUser);

  app.get('/db/:collection/:id?/:action?', async function (req, res) {
    try {
      const mongoColl = DB_COLLECTIONS[req.params.collection];
      if (!mongoColl || !cocoDb) { return res.status(200).json([]); }
      const coll = cocoDb.collection(mongoColl);
      const project = toProjection(req.query.project);
      const opts = project ? { projection: project } : {};
      const id = req.params.id;
      const action = req.params.action;

      // --- Sub-resource routes (the SPA expects an ARRAY here, never a doc) ---
      if (action === 'overworld') {
        const docs = await coll.find({}, opts).toArray();
        return res.status(200).json(docs);
      }
      if (action === 'achievements') {
        // e.g. /db/campaign/<handle>/achievements -> achievements for that campaign's levels.
        if (req.params.collection === 'campaign') {
          const campDoc = await resolveCampaign(id);
          if (campDoc && campDoc.levels) {
            const levelIds = Object.keys(campDoc.levels);
            const docs = await cocoDb.collection('achievements')
              .find({ related: { $in: levelIds }, collection: 'level.sessions' }).toArray();
            return res.status(200).json(docs);
          }
        }
        return res.status(200).json([]);
      }
      if (action === 'levels') {
        // e.g. /db/campaign/<handle>/levels -> levels belonging to a campaign.
        if (req.params.collection === 'campaign') {
          const campDoc = await resolveCampaign(id);
          if (campDoc && campDoc.levels) {
            const levelIds = Object.keys(campDoc.levels).map(x => new ObjectId(x));
            const docs = await cocoDb.collection('levels').find({ _id: { $in: levelIds } }).toArray();
            return res.status(200).json(docs);
          }
        }
        return res.status(200).json([]);
      }

      // Collection "names" endpoint: /db/<collection>/names?ids[]=... returns an ARRAY
      // of the referenced docs. Used by ThangNamesCollection to load a level's ThangTypes
      // (LevelLoader.populateLevel). Without this, the SPA receives `{}` (a single empty
      // doc) instead of a list, so none of the level's ThangTypes are loaded and every
      // thang fails with "could not find ThangType" / "Couldn't find placeholder ThangType
      // for the hero!".
      if (id === 'names') {
        const rawIds = req.query.ids;
        const idList = Array.isArray(rawIds) ? rawIds : (rawIds != null ? [rawIds] : []);
        const oids = idList.filter(x => /^[a-f0-9]{24}$/i.test(x)).map(x => new ObjectId(x));
        if (oids.length) {
          const docs = await coll.find({ $or: [{ _id: { $in: oids } }, { original: { $in: oids } }] }, opts).toArray();
          return res.status(200).json(docs);
        }
        return res.status(200).json([]);
      }

      if (id && id !== '-') {
        let doc = null;
        if (/^[a-f0-9]{24}$/i.test(id)) {
          const oid = new ObjectId(id);
          // Campaign level maps are keyed by `original` (a level family id), not the
          // doc `_id`, so try both before falling back to slug/name.
          doc = await coll.findOne({ _id: oid }, opts);
          if (!doc) { doc = await coll.findOne({ original: oid }, opts); }
        }
        if (!doc) { doc = await coll.findOne({ slug: id }, opts); }
        if (!doc) { doc = await coll.findOne({ name: id }, opts); }
        return res.status(200).json(doc || {});
      }
      const filter = {};
      if (req.query.slug) { filter.slug = req.query.slug; }
      const docs = await coll.find(filter, opts).toArray();
      return res.status(200).json(docs);
    } catch (e) {
      console.error('[db] route error', req.method, req.path, e.message);
      return res.status(200).json([]);
    }
  });

  // Versioned fetch: the SPA requests /db/<collection>/<id>/version/0 to get
  // the current (latest) document. Our restored DB has no per-version snapshots,
  // so version/0 (and any version) resolves to the current document. Without
  // this route those requests 404 even though the document exists by id.
  app.get('/db/:collection/:id/version/:version', async function (req, res) {
    try {
      const mongoColl = DB_COLLECTIONS[req.params.collection];
      if (!mongoColl || !cocoDb) { return res.status(200).json({}); }
      const coll = cocoDb.collection(mongoColl);
      const project = toProjection(req.query.project);
      const opts = project ? { projection: project } : {};
      const id = req.params.id;
      let doc = null;
      if (/^[a-f0-9]{24}$/i.test(id)) {
        const oid = new ObjectId(id);
        doc = await coll.findOne({ _id: oid }, opts);
        if (!doc) { doc = await coll.findOne({ original: oid }, opts); }
      }
      if (!doc) { doc = await coll.findOne({ slug: id }, opts); }
      if (!doc) { doc = await coll.findOne({ name: id }, opts); }
      return res.status(200).json(doc || {});
    } catch (e) {
      console.error('[db] version route error', req.method, req.path, e.message);
      return res.status(200).json({});
    }
  });

  // Helper: resolve a campaign doc by _id / original / slug / name.
  async function resolveCampaign(id) {
    const c = cocoDb.collection('campaigns');
    if (/^[a-f0-9]{24}$/i.test(id)) {
      const oid = new ObjectId(id);
      let d = await c.findOne({ _id: oid });
      if (!d) { d = await c.findOne({ original: oid }); }
      return d;
    }
    let d = await c.findOne({ slug: id });
    if (!d) { d = await c.findOne({ name: id }); }
    return d;
  }

  // --- File serving (mirrors the upstream CodeCombat /file route) ---
  // The upstream server stores user/thang/campaign/level images in MongoDB
  // GridFS (bucket 'media', keyed by metadata.path + filename; see the old
  // server/routes/file.coffee). Our restored coco database has no GridFS files,
  // so when a file is missing we fall back to a tiny transparent PNG so the UI
  // layout stays intact instead of showing 404 broken images. If the data is
  // ever populated, the real images are served as-is.
  const { GridFSBucket } = require('mongodb');
  const TRANSPARENT_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwADBwIAMCbHYQAAAABJRU5ErkJggg==',
    'base64'
  );
  // A tiny valid silent WAV so audio requests (thang voice lines, level audio,
  // etc.) don't throw "Unable to decode audio data" when the real asset is
  // missing from the restored database.
  const SILENT_WAV = (function () {
    const sampleRate = 8000, seconds = 0.1, numSamples = Math.floor(sampleRate * seconds);
    const dataSize = numSamples; // 8-bit mono = 1 byte/sample
    const b = Buffer.alloc(44 + dataSize);
    b.write('RIFF', 0); b.writeUInt32LE(36 + dataSize, 4); b.write('WAVE', 8);
    b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate, 28);
    b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < dataSize; i++) { b.writeUInt8(128, 44 + i); }
    return b;
  })();
  const AUDIO_EXTS = ['mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'webm'];
  const sendPlaceholder = function (req, res) {
    const name = req.params.filename || req.params.name || '';
    const ext = name.split('.').pop().toLowerCase();
    if (AUDIO_EXTS.indexOf(ext) !== -1) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).end(SILENT_WAV);
    }
    const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).end(TRANSPARENT_PNG);
  };
  // Proxy /file/<path> assets from the upstream CodeCombat CDN and cache them on
  // disk so subsequent requests (and offline use) are served locally. The upstream
  // server stores these files in S3; our restored coco database has none of them.
  const LOCAL_ASSET_DIR = path.join(__dirname, 'codecombat_assets'); // pre-downloaded by download_assets.js (committed)
  const FILE_CACHE_DIR = path.join(__dirname, 'file_cache'); // runtime cache (TTS, etc.) — gitignored
  const UPSTREAM_FILE_BASE = 'https://codecombat.com/file/';
  const inFlightFetches = new Map(); // relPath -> Promise<Buffer>

  function contentTypeFor(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    switch (ext) {
      case 'mp3': case 'mpeg': return 'audio/mpeg';
      case 'ogg': case 'oga': return 'audio/ogg';
      case 'wav': return 'audio/wav';
      case 'm4a': return 'audio/mp4';
      case 'aac': return 'audio/aac';
      case 'webm': return 'audio/webm';
      case 'jpg': case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'gif': return 'image/gif';
      case 'svg': return 'image/svg+xml';
      default: return 'application/octet-stream';
    }
  }

  // Fetch /file/<relPath> from the upstream CDN and cache it under FILE_CACHE_DIR.
  function fetchUpstream(relPath) {
    if (inFlightFetches.has(relPath)) { return inFlightFetches.get(relPath); }
    const p = (async () => {
      const r = await fetch(UPSTREAM_FILE_BASE + relPath);
      if (!r.ok) { throw new Error('upstream ' + r.status + ' for ' + relPath); }
      const buf = Buffer.from(await r.arrayBuffer());
      const cacheFile = path.resolve(FILE_CACHE_DIR, relPath);
      if (!cacheFile.startsWith(FILE_CACHE_DIR + path.sep)) { throw new Error('unsafe path'); }
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.promises.writeFile(cacheFile, buf);
      return buf;
    })();
    inFlightFetches.set(relPath, p);
    p.finally(() => inFlightFetches.delete(relPath)).catch(() => {});
    return p;
  }

  // Serve /file/<relPath>: committed local assets -> runtime cache (TTS) ->
  // upstream CDN (+runtime cache) -> silent/transparent placeholder.
  // The local asset set is discovered & downloaded by download_assets.js (no
  // hardcoded list); only dynamically-generated text-to-speech files fall through
  // to the upstream proxy.
  function serveFileAsset(relPath, req, res) {
    const ext = (relPath.split('.').pop() || '').toLowerCase();
    const isAudio = AUDIO_EXTS.indexOf(ext) !== -1;

    // 1) committed local assets (pre-downloaded, served offline)
    const localFile = path.resolve(LOCAL_ASSET_DIR, relPath);
    if (localFile.startsWith(LOCAL_ASSET_DIR + path.sep)) {
      try {
        const buf = fs.readFileSync(localFile);
        res.setHeader('Content-Type', contentTypeFor(relPath));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).end(buf);
      } catch (e) { /* not in local set */ }
    }

    // 2) runtime cache (e.g. text-to-speech fetched on demand)
    const cacheFile = path.resolve(FILE_CACHE_DIR, relPath);
    if (cacheFile.startsWith(FILE_CACHE_DIR + path.sep)) {
      try {
        const buf = fs.readFileSync(cacheFile);
        res.setHeader('Content-Type', contentTypeFor(relPath));
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).end(buf);
      } catch (e) { /* not cached yet */ }
    }

    // 3) upstream CDN (+ cache to FILE_CACHE_DIR)
    fetchUpstream(relPath).then(function (buf) {
      res.setHeader('Content-Type', contentTypeFor(relPath));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).end(buf);
    }).catch(function () {
      // Upstream unreachable: keep the UI functional with a silent/transparent placeholder.
      if (isAudio) {
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.status(200).end(SILENT_WAV);
      }
      const type = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).end(TRANSPARENT_PNG);
    });
  }

  const serveGridFSFile = function (req, res, p, filename) {
    const relPath = 'db/' + req.params.collection + '/' + req.params.id + '/' + filename;
    if (!cocoDb) { return serveFileAsset(relPath, req, res); }
    let bucket;
    try { bucket = new GridFSBucket(cocoDb, { bucketName: 'media' }); }
    catch (e) { return serveFileAsset(relPath, req, res); }
    bucket.find({ filename: filename, 'metadata.path': p }).toArray()
      .then(function (files) {
        if (!files || !files.length) { return serveFileAsset(relPath, req, res); }
        const f = files[0];
        res.setHeader('Content-Type', f.contentType || 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        const dl = bucket.openDownloadStream(f._id);
        dl.on('error', function () { return serveFileAsset(relPath, req, res); });
        return dl.pipe(res);
      })
      .catch(function () { return serveFileAsset(relPath, req, res); });
  };
  app.get('/file/db/:collection/:id/:filename', function (req, res) {
    serveGridFSFile(req, res, 'db/' + req.params.collection + '/' + req.params.id, req.params.filename);
  });
  app.get('/file/db/:collection/:id/:name', function (req, res) {
    serveGridFSFile(req, res, 'db/' + req.params.collection + '/' + req.params.id, req.params.name);
  });
  // Catch-all for /file/<path> (e.g. /file/interface/*.mp3, /file/music/*.mp3).
  // Proxy real assets from the upstream CDN and cache them locally; fall back to
  // the silent-WAV / transparent-PNG placeholder only if the upstream is unreachable.
  app.get('/file/*', function (req, res) {
    let relPath = (req.params[0] || req.path.replace(/^\/file\//, '')) + '';
    relPath = relPath.replace(/^\/+/, '');
    if (/(\.\.(\/|$))|\0/.test(relPath)) { return sendPlaceholder(req, res); }
    serveFileAsset(relPath, req, res);
  });
  // /db/<collection>/<id>/toFile/<name> are files the upstream generates on the
  // fly (e.g. thang doll renderings via node-canvas). We can't regenerate them,
  // so answer with the placeholder.
  app.get('/db/:collection/:id/toFile/:name', sendPlaceholder);

  // Accept (and ignore) non-essential writes from the anonymous client.
  // Must cover PUT/PATCH/DELETE too, otherwise they fall through to the
  // upstream /db/* proxy (which 404s offline).
  app.post('/db/*', function (req, res) { return res.status(200).json({}); });
  app.put('/db/*', function (req, res) { return res.status(200).json({}); });
  app.patch('/db/*', function (req, res) { return res.status(200).json({}); });
  app.delete('/db/*', function (req, res) { return res.status(200).json({}); });

  // Now wire up the framework middleware (static serving + the upstream /db proxy).
  // Our /db stub routes above are registered first, so they take precedence over
  // server_setup's `/db/*` proxy for any path the SPA actually needs locally.
  serverSetup.setupMiddleware(app);

  // SPA fallback: serve the app shell (main.html) for client-side routes (e.g. /dungeon)
  // that the static server does not map. Assets and API routes fall through to 404.
  app.get('*', function(req, res, next) {
    const p = req.path;
    if (/\.[a-zA-Z0-9]+$/.test(p)) { return next(); }
    if (/^\/(db|api|auth|javascripts|stylesheets|images|fonts|dev|esports|user-data)\b/i.test(p)) { return next(); }
    if (!req.accepts('html')) { return next(); }
    const file = path.join(publicPath, 'templates', 'static', 'main.html');
    return fs.readFile(file, 'utf8', (err, html) => {
      if (err) { return next(); }
      return res.status(200).header('Cache-Control', 'no-cache').send(html);
    });
  });

  return app;
});
