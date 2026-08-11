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
  // 内部部署：始终开启 gzip 压缩（/db/campaign 3MB、levels 7MB 等大 JSON，慢网络下不压缩易超时致 SuperModel 'Unknown Error'）
  const compression = require('compression');
  app.use(compression());
  const cookieParser = require('cookie-parser');
  app.use(cookieParser());
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
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const serverConfig = {
      codeNinjas: false,
      static: true,
      picoCTF: false,
      showCodePlayAds: false,
      production: false,
      stripe: false,
      buildInfo: { sha: (config.buildInfo && config.buildInfo.sha) || 'dev' }
    };
    // 检查登录 cookie，返回对应用户，否则返回匿名用户
    const uid = req.cookies && req.cookies.zg_userId;
    let userPromise;
    if (uid && /^[a-f0-9]{24}$/i.test(uid)) {
      userPromise = cocoDb ? cocoDb.collection('users').findOne({ _id: new ObjectId(uid) }) : Promise.resolve(null);
    } else {
      userPromise = Promise.resolve(null);
    }
    userPromise.then(function(u) {
      return res.send('window.userObject = ' + JSON.stringify(u || anonymousUser) + ';\nwindow.serverConfig = ' + JSON.stringify(serverConfig) + ';');
    }).catch(function() {
      return res.send('window.userObject = ' + JSON.stringify(anonymousUser) + ';\nwindow.serverConfig = ' + JSON.stringify(serverConfig) + ';');
    });
  });
  app.get('/auth/whoami', function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const uid = req.cookies && req.cookies.zg_userId;
    if (uid && /^[a-f0-9]{24}$/i.test(uid) && cocoDb) {
      cocoDb.collection('users').findOne({ _id: new ObjectId(uid) })
        .then(function(u) { return res.json(u || anonymousUser); })
        .catch(function() { return res.json(anonymousUser); });
    } else {
      return res.json(anonymousUser);
    }
  });
  // 注册表单实时校验：检查用户名是否已存在
  app.get('/auth/name/:name', function(req, res) {
    if (!cocoDb) { return res.json({ conflicts: false }); }
    const name = req.params.name || '';
    cocoDb.collection('users').findOne({ 'name': { $regex: '^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' } })
      .then(function(u) {
        if (u) return res.json({ conflicts: true, suggestedName: name + Math.floor(Math.random() * 999) });
        return res.json({ conflicts: false });
      })
      .catch(function() { return res.json({ conflicts: false }); });
  });
  // 注册表单实时校验：检查邮箱是否已被注册
  app.get('/auth/email/:email', function(req, res) {
    if (!cocoDb) { return res.json({ exists: false }); }
    const email = req.params.email || '';
    cocoDb.collection('users').findOne({ 'email': { $regex: '^' + email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' } })
      .then(function(u) { return res.json({ exists: !!u }); })
      .catch(function() { return res.json({ exists: false }); });
  });
  // 登录：POST /auth/login
  // 前端 AuthModal 经 Backbone fetch 默认发 application/x-www-form-urlencoded，
  // 仅 express.json() 解析不到 → body 恒空 → 误判空凭据报 not-found。两种格式都解析。
  app.post('/auth/login', express.json(), express.urlencoded({ extended: true }), function(req, res) {
    const username = (req.body && req.body.username) || '';
    const password = (req.body && req.body.password) || '';
    // 空凭据一律拒绝：$or 查询的空正则 /^$/ 会匹配 email/name 为空的存量用户
    // （如 fslong email 为空且是 admin），导致空表单登录直通管理员账户。
    if (!username || !password) {
      console.log('[login] empty-credentials rejected body=' + JSON.stringify(req.body).slice(0,200));
      return res.status(401).json({ errorID: 'not-found' });
    }
    console.log('[login] attempt user=' + username + ' body=' + JSON.stringify(req.body).slice(0,200));
    if (!cocoDb) { console.log('[login] no db'); return res.status(401).json({ errorID: 'unknown' }); }
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = { $or: [
      { name: { $regex: '^' + escaped + '$', $options: 'i' } },
      { email: { $regex: '^' + escaped + '$', $options: 'i' } }
    ] };
    cocoDb.collection('users').findOne(query)
      .then(function(u) {
        if (!u) { console.log('[login] not-found for ' + username); return res.status(401).json({ errorID: 'not-found' }); }
        if (u.password !== password) { console.log('[login] wrong-password for ' + username); return res.status(401).json({ errorID: 'wrong-password' }); }
        console.log('[login] success: ' + u.name + ' ' + u._id);
        res.cookie('zg_userId', u._id.toString(), { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
        return res.json(u);
      })
      .catch(function() { return res.status(401).json({ errorID: 'unknown' }); });
  });
  // 登出：POST /auth/logout（清除 cookie）
  app.post('/auth/logout', function(req, res) {
    res.clearCookie('zg_userId');
    return res.json({});
  });

  // Lightweight /db API backed by the restored MongoDB `coco` database.
  // The upstream server/ handlers are not run (mongoose4 is incompatible with Node 26);
  // this serves the read endpoints the new frontend needs for campaign/level browsing & play.
  const { MongoClient: DbClient, ObjectId } = require('mongodb');
  const dbClient = new DbClient('mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 5000 });
  let cocoDb = null;
  // Mongo 可能晚于本进程启动或中途重启：持续重试，连上后再置 cocoDb，避免 cocoDb 恒为 null。
  function connectDb (attempt) {
    return dbClient.connect().then(function (client) {
      cocoDb = client.db('coco');
      console.info('[db] connected to MongoDB coco database (attempt ' + (attempt || 1) + ')');
    }).catch(function (err) {
      console.error('[db] mongo connect failed (attempt ' + (attempt || 1) + '): ' + (err && err.message));
      return new Promise(function (resolve) { setTimeout(resolve, 5000); }).then(function () { return connectDb((attempt || 0) + 1); });
    });
  }
  connectDb(1);

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
    'poll': 'polls',
    'concept': 'concepts',
    'concepts': 'concepts',
    'exam': 'exams',
    'exams': 'exams',
    'podcast': 'podcasts',
    'podcasts': 'podcasts',
    'ai_junior_scenario': 'ai_junior_scenarios',
    'ai_junior_scenarios': 'ai_junior_scenarios'
  };
  // 简单内存缓存，减少重复 DB 查询
  const cache = {};
  const DEFAULT_TTL = 60000; // 60秒
  function cachedQuery(mongoColl, id, opts) {
    if (!cocoDb) { return Promise.resolve({}); }
    const key = mongoColl + ':' + id;
    const now = Date.now();
    if (cache[key] && cache[key].expiry > now) { return cache[key].promise; }
    const oid = /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : null;
    const query = oid ? { $or: [{ _id: oid }, { original: oid }] } : { slug: id };
    const p = collFindOne(cocoDb.collection(mongoColl), query, opts).then(function (doc) {
      if (doc) { return doc; }
      // 未找到时返回最小 stub，避免前端反复请求
      return { _id: oid, original: oid, name: 'stub', components: [], slug: 'stub', kind: 'stub' };
    }).catch(function () {
      return { _id: oid, original: oid, name: 'stub', components: [], slug: 'stub', kind: 'stub' };
    });
    cache[key] = { promise: p, expiry: now + DEFAULT_TTL };
    return p;
  }
  function collFindOne(coll, query, opts) { return coll.findOne(query, opts); }

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
      // 占位全零 id（0000...）是匿名游客保留值：仅当登录 cookie 指向该 id 时才视为
      // 真实用户；否则一律按游客处理。库中曾存在全零 _id 的真实用户（SYH0405），
      // 游客 GET /db/user/000000000000000000000000 会命中它，导致匿名玩家被误判为
      // 已登录并显示该用户姓名（孙意涵）。
      if (/^0+$/.test(id) && (!req.cookies || req.cookies.zg_userId !== id)) {
        return res.status(200).json(anonymousUser);
      }
      cocoDb.collection('users').findOne({ _id: new ObjectId(id) })
        .then(function (u) { return res.status(200).json(u || anonymousUser); })
        .catch(function () { return res.status(200).json(anonymousUser); });
    } else {
      // Non-objectId sub-resources such as /db/user/announcements are
      // collection endpoints the SPA iterates as an ARRAY; answering with the
      // anonymousUser OBJECT here makes data.slice() throw. Answer [] instead.
      return res.status(200).json([]);
    }
  };
  app.get('/db/user/:id', serveAnonymousUser);
  // /db/user/<uid>/level.sessions — 返回该用户全部关卡 session（世界地图进度用）。
  // 通用 /db/:collection/:id/:action 路由中 'user' 不在 DB_COLLECTIONS 映射内，
  // 会直接返回 []，致地图上登录用户所有关卡恒为「未开始」。
  app.get('/db/user/:id/level.sessions', async function (req, res) {
    try {
      if (!cocoDb) { return res.status(200).json([]); }
      const uid = req.params.id;
      if (!uid || !/^[a-f0-9]{24}$/i.test(uid)) { return res.status(200).json([]); }
      // 占位 id（0000...，匿名/游客）：所有匿名玩家共享同一占位 id，服务端 session
      // 是历史上其他匿名玩家的数据。匿名进度由 localStorage（lib/localProgress）管理，
      // 此处一律返回 []，否则新匿名用户会看到他人已通关的关卡（全解锁/已完成）。
      if (/^0+$/.test(uid)) { return res.status(200).json([]); }
      const docs = await cocoDb.collection('level.sessions')
        .find({ creator: uid })
        .project({ levelID: 1, level: 1, state: 1, playtime: 1, codeLanguage: 1, creator: 1 })
        .toArray();
      // 历史 session 可能缺 levelID（旧代码未写）→ 从关卡文档补 slug，
      // 否则地图 levelStatusMap 无法按 slug 标记完成。
      const lvlColl = cocoDb.collection('levels');
      for (const d of docs) {
        if (d.levelID) { continue; }
        let orig = null;
        if (d.level && d.level.original) { orig = String(d.level.original); }
        else if (typeof d.level === 'string' && /^[a-f0-9]{24}$/i.test(d.level)) { orig = d.level; }
        if (!orig) { continue; }
        try {
          const lvl = await lvlColl.findOne({ $or: [{ original: new ObjectId(orig) }, { _id: new ObjectId(orig) }] }, { slug: 1 });
          if (lvl && lvl.slug) { d.levelID = lvl.slug; }
        } catch (e) { /* ignore */ }
      }
      return res.status(200).json(docs);
    } catch (e) {
      console.error('[db] /db/user/:id/level.sessions error', e.message);
      return res.status(200).json([]);
    }
  });
  // /db/level/<levelID>/session — 返回当前用户对该关卡的 session（若有），否则空对象让前端新建。
  // 通用 /db/:collection/:id/:action 路由会把 levelID 当 level 集合查询并返回 LEVEL 文档；
  // 转储数据中 level 文档自带关卡作者 creator（如 5818...），前端误当 session 使用后，
  // 通关保存时 creator 写成关卡作者 → 后端 matched=0 → 解锁/发奖全失败。
  app.get('/db/level/:levelID/session', async function (req, res) {
    try {
      if (!cocoDb) { return res.status(200).json({}); }
      const levelID = req.params.levelID;
      const lvlColl = cocoDb.collection('levels');
      let levelDoc = null;
      if (/^[a-f0-9]{24}$/i.test(levelID)) {
        const oid = new ObjectId(levelID);
        levelDoc = await lvlColl.findOne({ $or: [{ _id: oid }, { original: oid }] });
      }
      if (!levelDoc) { levelDoc = await lvlColl.findOne({ slug: levelID }); }
      if (!levelDoc) { levelDoc = await lvlColl.findOne({ name: levelID }); }
      if (!levelDoc) { return res.status(200).json({}); }
      const slug = levelDoc.slug;
      const original = String(levelDoc.original || levelDoc._id);
      const sessColl = cocoDb.collection('level.sessions');
      const matchLevel = { $or: [{ levelID: slug }, { 'level.original': original }, { level: original }] };
      const uid = req.cookies && req.cookies.zg_userId;
      // 占位 id（0000...）：匿名玩家共享，服务端 session 是他人数据，不加载（返回 {} 新建）。
      if (uid && /^[a-f0-9]{24}$/i.test(uid) && !/^0+$/.test(uid)) {
        const session = await sessColl.findOne(Object.assign({ creator: uid }, matchLevel), { sort: { changed: -1 } });
        if (session) { return res.status(200).json(session); }
      }
      // 匿名 / 无该用户 session：不加载他人（转储）session，返回空对象让前端新建；
      // 匿名进度由 localStorage（lib/localProgress）管理。
      return res.status(200).json({});
    } catch (e) {
      console.error('[db] /db/level/:levelID/session error', e.message);
      return res.status(200).json({});
    }
  });
  // PUT/PATCH：注册时保存用户数据到 MongoDB（me.save() 走此路径）
  // 注意：earned/points/gems/spent/purchased 是通关奖励累计（grantLevelRewards 用
  // $inc/$addToSet 写入），客户端 me.save()/patch() 常携带旧值或空值，若 $set 覆盖
  // 会清空奖励 → 经验/宝石"不累加"、道具丢失。故 PUT/PATCH 一律剥离这些字段，
  // 默认值仅在 upsert 新建用户时通过 $setOnInsert 应用。
  const PROTECTED_USER_FIELDS = ['earned', 'points', 'gems', 'spent', 'purchased'];
  // 服务端独占字段：客户端请求体一律剥离，防提权/篡改（permissions 提权漏洞修复：
  // 此前注册与 PUT/PATCH 直接透传，任意用户可自封 admin/godmode）。
  // permissions 不在其中：单独由 stripUnauthorizedPermissions 做条件剥离——
  // 登录 admin 可修改（设置页 God Mode/Admin 开关），非 admin 一律剥离防提权。
  const SERVER_ONLY_USER_FIELDS = [
    'passwordHash', 'passwordReset', 'lastIP',
    'emailLower', 'nameLower', 'anonymous', 'dateCreated', 'testGroupNumber'
  ];
  const stripServerOnlyUserFields = function (body) {
    const b = Object.assign({}, body || {});
    for (const f of SERVER_ONLY_USER_FIELDS) { delete b[f]; }
    return b;
  };
  // 仅登录 admin 可写 permissions（返回 Promise<body>）；非 admin 提交 permissions 一律剥离
  const stripUnauthorizedPermissions = function (req, body) {
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'permissions')) { return Promise.resolve(body); }
    return isAdminUser(req).then(function (admin) {
      if (admin) { return body; }
      const b = Object.assign({}, body);
      delete b.permissions;
      return b;
    });
  };
  const USER_DEFAULTS = {
    points: 0, gems: 0, spent: 0,
    earned: { heroes: [], items: [], levels: [], gems: 0, achievements: [] },
    purchased: { heroes: [], items: [], levels: [], gems: 0 },
    dateCreated: new Date().toISOString(),
    preferredLanguage: 'zh-HANS'
  };
  const stripProtectedUserFields = function (body) {
    const b = Object.assign({}, body || {});
    for (const f of PROTECTED_USER_FIELDS) { delete b[f]; }
    return b;
  };
  // 头像：GET /db/user/:id/avatar 返回存储的图片（photoData base64）或 404；
  // PUT /db/user/:id/avatar 接收原始图片二进制（multipart 免依赖，express.raw），仅本人可改。
  const avatarDataUrlRe = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/;
  const avatarExtRe = /^image\/(png|jpe?g|gif|webp)$/;
  app.get('/db/user/:id/avatar', function (req, res) {
    if (!cocoDb || !/^[a-f0-9]{24}$/i.test(req.params.id)) { return res.status(404).end(); }
    return cocoDb.collection('users').findOne(
      { _id: new ObjectId(req.params.id) },
      { projection: { photoData: 1 } }
    ).then(function (u) {
      if (!u || !u.photoData) { return res.status(404).end(); }
      const m = avatarDataUrlRe.exec(u.photoData);
      if (!m) { return res.status(404).end(); }
      const buf = Buffer.from(m[2], 'base64');
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[m[1]] || 'image/png';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).end(buf);
    }).catch(function () { return res.status(404).end(); });
  });
  app.put('/db/user/:id/avatar', express.raw({ type: (req) => /^image\/(png|jpe?g|gif|webp)(;|$)/.test(String(req.headers['content-type'] || '')), limit: '512kb' }), function (req, res) {
    if (!cocoDb) { return res.status(200).json({}); }
    const id = req.params.id;
    if (!/^[a-f0-9]{24}$/i.test(id)) { return res.status(400).json({ message: 'bad id' }); }
    const cookieUid = req.cookies && req.cookies.zg_userId;
    if (!cookieUid || cookieUid !== id) { return res.status(403).json({ message: 'Not allowed' }); }
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) { return res.status(400).json({ message: 'Invalid image data' }); }
    if (buf.length > 512 * 1024) { return res.status(400).json({ message: 'Image too large (max 512KB)' }); }
    const ctype = req.headers['content-type'] || '';
    const mime = (ctype.split(';')[0] || '').toLowerCase();
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/webp': 'webp' }[mime];
    if (!ext) { return res.status(400).json({ message: 'Unsupported image type' }); }
    const photoData = 'data:image/' + ext + ';base64,' + buf.toString('base64');
    return cocoDb.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: { photoData: photoData } }
    ).then(function () {
      console.log('[avatar] updated for user', id, Math.round(buf.length / 1024) + 'KB', mime);
      return res.status(200).json({ ok: true });
    }).catch(function (e) {
      console.error('[avatar] update error', e && e.message);
      return res.status(200).json({});
    });
  });
  app.put('/db/user/:id', express.json({ limit: '25mb', strict: false }), async function (req, res) {
    try {
      if (!cocoDb) { return res.status(200).json(anonymousUser); }
      const id = req.params.id;
      if (/^[a-f0-9]{24}$/i.test(id)) {
        // 占位全零 id：仅登录 cookie 指向它时可写（真实用户），否则游客写库会命中/污染
        // 库中遗留的全零 _id 用户（SYH0405），并使其 anonymous 被强制置 false。
        if (/^0+$/.test(id) && (!req.cookies || req.cookies.zg_userId !== id)) {
          return res.status(200).json(anonymousUser);
        }
        const oid = new ObjectId(id);
        const body = await stripUnauthorizedPermissions(req, req.body);
        const setData = stripServerOnlyUserFields(stripProtectedUserFields(body));
        setData.anonymous = false;
        // 去掉 _id（来自请求体），MongoDB 不允许 $set 修改 _id
        delete setData._id;
        const update = { $set: setData, $setOnInsert: USER_DEFAULTS };
        cocoDb.collection('users').updateOne({ _id: oid }, update, { upsert: true })
          .then(function () { return cocoDb.collection('users').findOne({ _id: oid }); })
          .then(function (u) { return res.status(200).json(u || anonymousUser); })
          .catch(function () { return res.status(200).json(anonymousUser); });
      } else {
        return res.status(200).json([]);
      }
    } catch (e) {
      console.error('[db] PUT /db/user error', e && e.message);
      return res.status(200).json(anonymousUser);
    }
  });
  // 关卡保存（编辑器）：PUT /db/level/:id —— 仅管理员可写
  function isAdminUser(req) {
    const uid = req.cookies && req.cookies.zg_userId;
    if (!uid || !/^[a-f0-9]{24}$/i.test(uid) || !cocoDb) { return Promise.resolve(false); }
    return cocoDb.collection('users').findOne({ _id: new ObjectId(uid) })
      .then(function(u) {
        return !!(u && Array.isArray(u.permissions) && u.permissions.indexOf('admin') !== -1);
      })
      .catch(function() { return false; });
  }
  app.put('/db/level/:id', express.json({ limit: '50mb', strict: false }), function (req, res) {
    if (!cocoDb) { return res.status(200).json({}); }
    isAdminUser(req).then(function (ok) {
      if (!ok) { return res.status(403).json({ message: 'Forbidden' }); }
      const id = req.params.id;
      if (!/^[a-f0-9]{24}$/i.test(id)) { return res.status(200).json({}); }
      const oid = new ObjectId(id);
      const doc = req.body || {};
      delete doc._id; // MongoDB 不允许 $set 修改 _id
      // 关卡族模型：确保 original / version 存在
      doc.original = doc.original || id;
      if (!doc.version) { doc.version = { isLatestMinor: true, isLatestMajor: true, minor: 1, major: 0 }; }
      cocoDb.collection('levels').updateOne({ _id: oid }, { $set: doc }, { upsert: true })
        .then(function() { return cocoDb.collection('levels').findOne({ _id: oid }); })
        .then(function(saved) { return res.status(200).json(saved || {}); })
        .catch(function(e) { console.error('[db] /db/level PUT error', e.message); return res.status(200).json({}); });
    });
  });
  // 创建新关卡：POST /db/level —— 仅管理员
  app.post('/db/level', express.json({ limit: '50mb', strict: false }), function (req, res) {
    if (!cocoDb) { return res.status(200).json({}); }
    isAdminUser(req).then(function (ok) {
      if (!ok) { return res.status(403).json({ message: 'Forbidden' }); }
      const doc = req.body || {};
      delete doc._id;
      if (!doc.original) { doc.original = doc._id || null; }
      if (!doc.version) { doc.version = { isLatestMinor: true, isLatestMajor: true, minor: 1, major: 0 }; }
      if (!doc.created) { doc.created = new Date(); }
      cocoDb.collection('levels').insertOne(doc)
        .then(function(r) { return cocoDb.collection('levels').findOne({ _id: r.insertedId }); })
        .then(function(saved) { return res.status(200).json(saved || {}); })
        .catch(function(e) { console.error('[db] /db/level POST error', e.message); return res.status(200).json({}); });
    });
  });
  app.patch('/db/user/:id', express.json({ limit: '25mb', strict: false }), async function (req, res) {
    // 同 PUT 逻辑：仅更新请求体字段，剥离奖励累计字段，默认值仅在新建时应用
    try {
      if (!cocoDb) { return res.status(200).json(anonymousUser); }
      const id = req.params.id;
      if (/^[a-f0-9]{24}$/i.test(id)) {
        // 占位全零 id：仅登录 cookie 指向它时可写（真实用户），否则按游客拦截，不落库。
        if (/^0+$/.test(id) && (!req.cookies || req.cookies.zg_userId !== id)) {
          return res.status(200).json(anonymousUser);
        }
        const oid = new ObjectId(id);
        const body = await stripUnauthorizedPermissions(req, req.body);
        const setData = stripServerOnlyUserFields(stripProtectedUserFields(body));
        setData.anonymous = false;
        const update = { $set: setData, $setOnInsert: USER_DEFAULTS };
        cocoDb.collection('users').updateOne({ _id: oid }, update, { upsert: true })
          .then(function () { return cocoDb.collection('users').findOne({ _id: oid }); })
          .then(function (u) { return res.status(200).json(u || anonymousUser); })
          .catch(function () { return res.status(200).json(anonymousUser); });
      } else {
        return res.status(200).json([]);
      }
    } catch (e) {
      console.error('[db] PATCH /db/user error', e && e.message);
      return res.status(200).json(anonymousUser);
    }
  });
  // 创建用户（注册）：POST /db/user 不带 id → 插入新用户到 MongoDB
  app.post('/db/user', express.json({ limit: '25mb', strict: false }), function (req, res) {
    if (!cocoDb) { return res.status(200).json({}); }
    const body = req.body || {};
    const doc = Object.assign({
      anonymous: false,
      name: body.name || 'Anonymous',
      email: body.email || '',
      password: body.password || '',
      points: 0,
      earned: { heroes: [], items: [], levels: [], gems: 0, achievements: [] },
      purchased: { heroes: [], items: [], levels: [], gems: 0 },
      gems: 0,
      spent: 0,
      dateCreated: new Date().toISOString()
    }, stripServerOnlyUserFields(body));
    cocoDb.collection('users').insertOne(doc).then(function (result) {
      return res.status(200).json(doc);
    }).catch(function (err) {
      console.error('[db] user create error', err && err.message);
      return res.status(200).json({});
    });
  });
  // 注册：POST /db/user/<id>/signup-with-password —— 前端 BasicInfoView 走 me.signupWithPassword。
  // 此前该路由缺失，请求落入 /db/* 兜底返回 {}，导致「注册假成功」：库里从未建户，
  // 之后登录必失败，且空表单登录还会误入 email 为空的存量账户（见 /auth/login 守卫）。
  // 此处真实创建用户（正常 ObjectId，非占位全零），并直接下发登录 cookie。
  app.post('/db/user/:id/signup-with-password', express.json({ limit: '25mb', strict: false }), async function (req, res) {
    if (!cocoDb) { return res.status(200).json({}); }
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const email = String(body.email || '').trim();
    if (!name || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }
    const esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    const orClauses = [{ name: { $regex: '^' + esc(name) + '$', $options: 'i' } }];
    if (email) { orClauses.push({ email: { $regex: '^' + esc(email) + '$', $options: 'i' } }); }
    try {
      const exists = await cocoDb.collection('users').findOne({ $or: orClauses });
      if (exists) {
        console.log('[db] signup name/email conflict for ' + name);
        return res.status(409).json({ message: 'That username or email is already in use' });
      }
      const doc = Object.assign({
        anonymous: false,
        name: name,
        email: email,
        password: password,
        points: 0,
        earned: { heroes: [], items: [], levels: [], gems: 0, achievements: [] },
        purchased: { heroes: [], items: [], levels: [], gems: 0 },
        gems: 0,
        spent: 0,
        dateCreated: new Date().toISOString(),
        preferredLanguage: 'zh-HANS'
      }, stripServerOnlyUserFields(body));
      delete doc._id; // 不允许请求体覆盖自动 ObjectId
      const result = await cocoDb.collection('users').insertOne(doc);
      const created = await cocoDb.collection('users').findOne({ _id: result.insertedId });
      console.log('[db] signup created: ' + name + ' ' + result.insertedId.toString());
      res.cookie('zg_userId', result.insertedId.toString(), { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
      return res.status(200).json(created);
    } catch (e) {
      console.error('[db] signup-with-password error', e && e.message);
      return res.status(200).json({});
    }
  });
  // 购买（装备/英雄）：POST /db/purchase —— 校验宝石、扣款、记录 purchased、写 purchases。
  // 原版由 server 处理；本部署此前走 /db/* 兜底（假保存），导致购买不落库。
  app.post('/db/purchase', express.json({ limit: '10mb', strict: false }), async function (req, res) {
    if (!cocoDb) { return res.status(200).json({}); }
    const uid = req.cookies && req.cookies.zg_userId;
    if (!uid || !/^[a-f0-9]{24}$/i.test(uid)) { return res.status(401).json({ message: 'Not logged in' }); }
    const body = req.body || {};
    const original = body.purchased && body.purchased.original;
    if (!original) { return res.status(400).json({ message: 'No item specified' }); }
    try {
      const oid = new ObjectId(uid);
      const lookups = [];
      if (/^[a-f0-9]{24}$/i.test(original)) {
        lookups.push({ _id: new ObjectId(original) });
        // thangType 的 original 字段是 ObjectId，JSON 序列化后为 hex 字符串
        lookups.push({ original: new ObjectId(original) });
      }
      lookups.push({ original: original });
      const item = await cocoDb.collection('thang.types').findOne({ $or: lookups });
      if (!item) { return res.status(404).json({ message: 'Item not found' }); }
      const cost = item.gems || 0;
      if (cost <= 0) { return res.status(400).json({ message: 'Item has no price' }); }
      const user = await cocoDb.collection('users').findOne({ _id: oid });
      if (!user) { return res.status(404).json({ message: 'User not found' }); }
      const gemsEarned = (user.earned && user.earned.gems) || 0;
      const gemsPurchased = (user.purchased && user.purchased.gems) || 0;
      const spent = user.spent || 0;
      const available = gemsEarned + gemsPurchased - spent;
      if (available < cost) { return res.status(402).json({ message: 'Not enough gems' }); }
      const isHero = item.kind === 'Hero';
      const purchased = Object.assign({ heroes: [], items: [], levels: [], gems: 0 }, user.purchased || {});
      const list = isHero ? 'heroes' : 'items';
      if (!Array.isArray(purchased[list])) { purchased[list] = []; }
      const itemRef = String(item.original || item._id);
      if (purchased[list].indexOf(itemRef) === -1) { purchased[list].push(itemRef); }
      const newSpent = spent + cost;
      await cocoDb.collection('users').updateOne({ _id: oid }, { $set: { spent: newSpent, purchased: purchased } });
      await cocoDb.collection('purchases').insertOne(Object.assign({}, body, { recipient: uid, purchaser: uid, created: new Date() }));
      return res.status(200).json({ purchased: purchased, spent: newSpent });
    } catch (e) {
      console.error('[db] /db/purchase error', e && e.message);
      return res.status(200).json({});
    }
  });
  // CocoModel.pollAchievements → GET /db/user/<id>/achievements?notified=false
  // Must return [] (collection), never 404, or console screams
  // "Miserably failed to fetch unnotified achievements".
  app.get('/db/user/:id/achievements', function (req, res) { return res.status(200).json([]); });
  // Sub-resource writes the SPA issues (e.g. /db/user/announcements/new,
  // /db/user/announcement/read) would otherwise 404. Answer 200 with [].
  app.post('/db/user/:id/:sub', function (req, res) { return res.status(200).json([]); });

  // 对静态集合（thang.type、achievement 等）允许浏览器缓存，减少重复请求
  app.use('/db', function (req, res, next) {
    const path = req.path || '';
    const isStatic = /^\/(thang\.type|achievement|article|concept|level\.component|level\.system)\b/.test(path);
    const isCollection = /\/names(\?|$)/.test(path);
    if (isStatic || isCollection) {
      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60'); // 5min
    } else {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
    res.set('Pragma', 'no-cache');
    return next();
  });

  // /db/campaign/:campaignSlug/levels/:levelOriginal/next -> next level in campaign order
  app.get('/db/campaign/:campaignSlug/levels/:levelOriginal/next', async function (req, res) {
    try {
      const campDoc = await resolveCampaign(req.params.campaignSlug);
      if (!campDoc || !campDoc.levels) { return res.status(200).json(null); }
      const levelOriginal = req.params.levelOriginal;
      const entry = campDoc.levels[levelOriginal];
      if (!entry) { return res.status(200).json(null); }
      // 收集本关直接后继（original）：nextLevels 各分支 + 按序 fallback next。
      // 不含 rewards 引用关卡（跨 campaign 课程入口），防前端批量解锁全部后继。
      const nexts = [];
      if (entry.nextLevels) {
        for (const nid of Object.keys(entry.nextLevels)) {
          const ne = entry.nextLevels[nid];
          if (ne && ne.original) { nexts.push(ne.original); }
        }
      }
      const keys = Object.keys(campDoc.levels);
      const idx = keys.findIndex(k => k === levelOriginal || (campDoc.levels[k] && campDoc.levels[k].original === levelOriginal));
      if (idx >= 0 && idx < keys.length - 1) {
        const ne = campDoc.levels[keys[idx + 1]];
        if (ne && ne.original) { nexts.push(ne.original); }
      }
      const uniq = [...new Set(nexts.map(String))].filter(Boolean);
      if (!uniq.length) { return res.status(200).json(null); }
      // 兼容旧契约：默认返回首个后继；allLevels 供前端批量解锁全部后继
      const first = campDoc.levels[uniq[0]] || campDoc.levels[keys[keys.indexOf(levelOriginal) + 1]];
      const primary = first ? { slug: first.slug, name: first.name, original: first.original } : { original: uniq[0] };
      primary.allLevels = uniq;
      return res.status(200).json(primary);
    } catch (e) {
      console.error('[db] /levels/:id/next error', e.message);
      return res.status(200).json(null);
    }
  });

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
        // Campaign.levels is keyed by level `original` (family id), NOT document `_id`.
        // Offline dump has distinct _id/original, so query both.
        if (req.params.collection === 'campaign') {
          const campDoc = await resolveCampaign(id);
          if (campDoc && campDoc.levels) {
            const levelIds = Object.keys(campDoc.levels)
              .filter(x => /^[a-f0-9]{24}$/i.test(x))
              .map(x => new ObjectId(x));
            if (levelIds.length) {
              const docs = await cocoDb.collection('levels')
                .find({ $or: [{ _id: { $in: levelIds } }, { original: { $in: levelIds } }] })
                .toArray();
              return res.status(200).json(docs);
            }
          }
        }
        return res.status(200).json([]);
      }
      if (action === 'rankings') {
        return res.status(200).json([]);
      }
      if (action === 'rankings-count') {
        return res.status(200).json({ count: 0 });
      }
      if (action === 'random_session_pair') {
        const dummy = '000000000000000000000000';
        return res.status(200).json([{ _id: dummy }, { _id: dummy }]);
      }
      if (action === 'game-content') {
        // Campaign curriculum guide expects { modules:{}, introLevels:{} }.
        return res.status(200).json({ modules: {}, introLevels: {} });
      }
      if (action === 'top_scores') {
        // Leaderboard widget expects an ARRAY. We don't serve real scores offline.
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
        const validIds = idList.filter(x => /^[a-f0-9]{24}$/i.test(x));
        // 对 thang.type 等静态集合使用缓存读取
        const isCachable = ['thang.types', 'thang.type'].includes(mongoColl);
        const docs = [];
        if (isCachable) {
          for (const vid of validIds) {
            const d = await cachedQuery(mongoColl, vid, opts);
            if (d && d._id) { docs.push(d); }
          }
        } else {
          const oids = validIds.map(x => new ObjectId(x));
          if (oids.length) {
            const found = await coll.find({ $or: [{ _id: { $in: oids } }, { original: { $in: oids } }] }, opts).toArray();
            docs.push.apply(docs, found);
          }
        }
        return res.status(200).json(docs);
      }

      if (id && id !== '-') {
        let doc = null;
        if (/^[a-f0-9]{24}$/i.test(id)) {
          doc = await cachedQuery(mongoColl, id, opts);
        }
        if (!doc) { doc = await coll.findOne({ slug: id }, opts); }
        if (!doc) { doc = await coll.findOne({ name: id }, opts); }
        return res.status(200).json(doc || {});
      }
      const filter = {};
      if (req.query.slug) { filter.slug = req.query.slug; }
      if (req.query.related) { filter.related = req.query.related; }
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
      // 503 not {} when mongo not ready — prevents SuperModel caching empty forever.
      if (!mongoColl) { return res.status(404).json({ message: 'unknown collection' }); }
      if (!cocoDb) { return res.status(503).json({ message: 'db not ready' }); }
      const coll = cocoDb.collection(mongoColl);
      const project = toProjection(req.query.project);
      // Always keep original/name/_id so SuperModel can match later; project may strip them.
      const opts = {};
      if (project) {
        opts.projection = Object.assign({ original: 1, name: 1, _id: 1 }, project);
      }
      const id = req.params.id;
      let doc = null;
      if (/^[a-f0-9]{24}$/i.test(id)) {
        const oid = new ObjectId(id);
        doc = await coll.findOne({ _id: oid }, opts);
        if (!doc) { doc = await coll.findOne({ original: oid }, opts); }
      }
      if (!doc) { doc = await coll.findOne({ slug: id }, opts); }
      if (!doc) { doc = await coll.findOne({ name: id }, opts); }
      if (!doc) { return res.status(404).json({ message: 'not found', id }); }
      return res.status(200).json(doc);
    } catch (e) {
      console.error('[db] version route error', req.method, req.path, e.message);
      return res.status(500).json({ message: e.message });
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

  // --- 关卡解锁可达性（防"很快解锁高级关卡"） ---
  // 课程 campaign 首关几乎全靠他 campaign 的 rewards 引用解锁（course-2~6/web-dev/
  // game-dev/js-primer 等），故不能禁跨 campaign 解锁；改以可达性把关：仅已解锁关
  // 或其直系后继（nextLevels/rewards 引用）可通关，URL 直开未解锁关不再解锁/发奖。
  const ALWAYS_UNLOCKED_LEVELS = new Set(['5411cb3769152f1707be029c', '65c55febd2ca2055e6566b2b']);
  let campaignIndexCache = null;   // { levelByOrig, firstLevels }
  let campaignIndexAt = 0;
  const CAMPAIGN_INDEX_TTL = 60000;
  async function getCampaignIndex() {
    if (campaignIndexCache && (Date.now() - campaignIndexAt) < CAMPAIGN_INDEX_TTL) { return campaignIndexCache; }
    const camps = await cocoDb.collection('campaigns').find({})
      .project({ slug: 1, name: 1, levels: 1 }).toArray();
    // 同一 original 可能出现在多个 campaign（如 Dungeons of Kithgard 在 dungeon/
    // game-dev-hoc/intro），须保留全部记录，否则引用解析错链。
    const levelRefs = new Map();   // original -> [{nexts:[orig], rewards:[orig]}, ...]
    const firstLevels = new Set(); // 各 campaign 顺序首关，恒可达
    for (const camp of camps) {
      if (!camp.levels) { continue; }
      const keys = Object.keys(camp.levels);
      keys.forEach(function (k, i) {
        const v = camp.levels[k];
        if (!v) { return; }
        const orig = String(v.original || k);
        const rec = {
          nexts: v.nextLevels
            ? Object.keys(v.nextLevels).map(function (nid) {
                const ne = v.nextLevels[nid];
                return ne && ne.original ? String(ne.original) : null;
              }).filter(Boolean)
            : [],
          rewards: Array.isArray(v.rewards)
            ? v.rewards.filter(function (r) { return r && r.level; }).map(function (r) { return String(r.level); })
            : []
        };
        const arr = levelRefs.get(orig) || [];
        arr.push(rec);
        levelRefs.set(orig, arr);
        if (i === 0) { firstLevels.add(orig); }
      });
    }
    campaignIndexCache = { levelRefs, firstLevels };
    campaignIndexAt = Date.now();
    return campaignIndexCache;
  }
  async function canPlayLevel(creatorId, levelOriginal) {
    try {
      if (!levelOriginal || !creatorId || /^0{24}$/.test(creatorId)) { return true; } // 游客由前端管理
      if (ALWAYS_UNLOCKED_LEVELS.has(levelOriginal)) { return true; }
      const idx = await getCampaignIndex();
      if (idx.firstLevels.has(levelOriginal)) { return true; }
      const user = await cocoDb.collection('users').findOne(
        { _id: new ObjectId(creatorId) },
        { projection: { 'earned.levels': 1 } }
      );
      const earned = ((user && user.earned && user.earned.levels) || []).map(String);
      if (earned.indexOf(levelOriginal) !== -1) { return true; }
      for (const e of earned) {
        const recs = idx.levelRefs.get(e);
        if (!recs) { continue; }
        for (const rec of recs) {
          if (rec.nexts.indexOf(levelOriginal) !== -1) { return true; }
          if (rec.rewards.indexOf(levelOriginal) !== -1) { return true; }
        }
      }
      return false;
    } catch (e) {
      // 异常保守拦截留痕，宁拒一次不放行跳关
      console.error('[db] canPlayLevel error', creatorId, levelOriginal, e && e.message);
      return false;
    }
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
  const UPSTREAM_FILE_BASE = 'https://codecombat.cn/file/';
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

  // 真实持久化：登录用户的通关 session 写入 MongoDB；通关时将该关及其下一关
  // 写入 users.earned.levels，驱动 world map 顺序解锁。匿名用户（creator 为占位
  // 0000...）由前端 localStorage 处理，此处跳过（见 lib/localProgress）。
  // 关卡 session 存档含全量关卡数据(thangs/code/systems)，常超默认 100kb，须提限制，
  // 否则 413 PayloadTooLarge → 完成不落盘、发奖不触发（正是"无奖励"真凶）。
  const jsonParser = express.json({ limit: '25mb', strict: false });
  // 通关发奖：将本关关联成就的 worth(xp) 与 rewards.gems 累加到登录用户，
  // 并把成就 id 写入 earned.achievements（已赚不重复发）。匿名(creator 占位)跳过。
  const grantLevelRewards = async function (creator, levelOriginal) {
    try {
      if (!cocoDb || !creator || /^0{24}$/.test(creator)) { return; }
      const achDocs = await cocoDb.collection('achievements')
        .find({ related: levelOriginal }).toArray();
      if (!achDocs.length) { return; }
      const userDoc = await cocoDb.collection('users').findOne(
        { _id: new ObjectId(creator) },
        { projection: { 'earned.achievements': 1 } }
      );
      const already = new Set(((userDoc && userDoc.earned && userDoc.earned.achievements) || []).map(String));
      let xpInc = 0; let gemInc = 0; const earnedAch = [];
      const earnedItems = new Set(); const earnedLevels = new Set(); const earnedHeroes = new Set();
      for (const a of achDocs) {
        const worth = a.worth || 0;
        const gems = (a.rewards && a.rewards.gems) || 0;
        const items = (a.rewards && a.rewards.items) || [];
        const levels = (a.rewards && a.rewards.levels) || [];
        const heroes = (a.rewards && a.rewards.heroes) || [];
        const isNew = !already.has(a._id.toString());
        // 物品/英雄奖励每次通关都补发（$addToSet 去重，不会重复拥有）：
        // 修复早期 PUT bug 清空 earned.items 后，重玩（成就已赚）不再给奖励的问题。
        // 例如 shadow-guard 掉 simple-sword，若首次被清空，重玩必须能补回。
        // 关卡奖励（rewards.levels）仅成就首达时发放：重玩旧关不得再解锁新关卡，
        // 否则玩家反复刷旧关即可绕过顺序解锁，快速解锁高级关卡。
        for (const it of items) { if (it) { earnedItems.add(String(it)); } }
        for (const h of heroes) { if (h) { earnedHeroes.add(String(h)); } }
        if (isNew) {
          for (const lv of levels) { if (lv) { earnedLevels.add(String(lv)); } }
          // 首次通关：全额宝石 + 经验 + 成就记录
          gemInc += gems;
          xpInc += worth; earnedAch.push(a._id.toString());
        } else {
          // 重复通关（刷旧关）：只发一半宝石，经验/成就不再给
          gemInc += Math.max(1, Math.floor(gems / 2));
        }
      }
      if (!earnedAch.length && !gemInc && !xpInc) { return; }
      const update = {};
      if (earnedAch.length) { update.$addToSet = { 'earned.achievements': { $each: earnedAch } }; }
      if (earnedItems.size) { update.$addToSet = update.$addToSet || {}; update.$addToSet['earned.items'] = { $each: [...earnedItems] }; }
      if (earnedLevels.size) { update.$addToSet = update.$addToSet || {}; update.$addToSet['earned.levels'] = { $each: [...earnedLevels] }; }
      if (earnedHeroes.size) { update.$addToSet = update.$addToSet || {}; update.$addToSet['earned.heroes'] = { $each: [...earnedHeroes] }; }
      update.$inc = {};
      if (xpInc) { update.$inc.points = xpInc; }
      if (gemInc) { update.$inc['earned.gems'] = gemInc; }
      if (!Object.keys(update.$inc).length) { delete update.$inc; }
      const updRes = await cocoDb.collection('users').updateOne(
        { _id: new ObjectId(creator) },
        update,
        { upsert: false }
      );
      // 注意：creator 须为真实 users._id；若无对应用户，matchedCount=0，奖励未真写入。
      console.info('[db] granted rewards for level', levelOriginal, 'to user', creator,
        '(xp +' + xpInc + ', gems +' + gemInc + ', items +' + earnedItems.size + ', levels +' + earnedLevels.size + ', heroes +' + earnedHeroes.size + ', matched=' + (updRes && updRes.matchedCount) + ')');
    } catch (e) {
      console.error('[db] grantLevelRewards error', e && e.message);
    }
  };
  const persistLevelSession = async function (req, res) {
    try {
      console.info('[db] /db/level.session', req.method, 'complete=', !!(req.body && req.body.state && req.body.state.complete), 'level=', (req.body && (req.body.level && req.body.level.original || req.body.level || req.body.state && req.body.state.original)), 'creator=', req.body && req.body.creator);
      if (!cocoDb) { return res.status(200).json({}); }
      const body = req.body || {};
      const id = req.params.id;
      const coll = cocoDb.collection('level.sessions');
      let docId;
      const doc = Object.assign({}, body);
      // 落库时以服务端登录 cookie 为准覆盖 creator：前端 session 可能带着旧值
      // （转储 level 文档的关卡作者 creator），或更新请求体缺 creator；只有 cookie
      // 能保证 session 归属当前用户，否则同一转储 session 被多玩家互相覆盖。
      const sessionCookieUid = req.cookies && req.cookies.zg_userId;
      if (sessionCookieUid && /^[a-f0-9]{24}$/i.test(sessionCookieUid)) {
        doc.creator = sessionCookieUid;
      }
      if (id && /^[a-f0-9]{24}$/i.test(id)) {
        docId = new ObjectId(id);
        doc._id = docId;
        await coll.updateOne({ _id: docId }, { $set: doc }, { upsert: true });
      } else {
        const inserted = await coll.insertOne(doc);
        docId = inserted.insertedId;
      }
      // 通关：把本关与下一关（来自 campaign 的 nextLevels / rewards）加入用户 earned.levels
      if (body && body.state && body.state.complete) {
        // body.level 仅在「创建」session 时随带；「更新」(PUT) 请求体常缺 level/campaign/creator，
        // 致按 body 取 levelOriginal 为 undefined → grantLevelRewards 永不触发。故须从已落盘 doc
        // 取权威 level.original / campaign / creator（创建时即写入库）。
        const fullDoc = docId ? await coll.findOne({ _id: docId }) : null;
        // session 以 levelID 存关卡引用：或为 24-hex 之 original/_id，或为 slug；
        // 而成就 related 与 campaign.levels 键均为关卡 original _id，故须归一成 original。
        let levelOriginal = null;
        const levelRef = (fullDoc && (fullDoc.levelID || fullDoc.level)) || body.levelID || body.level;
        if (levelRef) {
          if (typeof levelRef === 'string') {
            if (/^[a-f0-9]{24}$/i.test(levelRef)) {
              levelOriginal = levelRef;
            } else {
              const lvlDoc = await cocoDb.collection('levels').findOne(
                { $or: [ { slug: levelRef }, { name: levelRef } ] }, { original: 1 });
              const lvlOrig = lvlDoc && (lvlDoc.original || lvlDoc._id);
              levelOriginal = lvlOrig ? lvlOrig.toString() : levelRef;
            }
          } else if (levelRef.original) {
            levelOriginal = levelRef.original.toString();
          } else if (levelRef.id) {
            levelOriginal = levelRef.id.toString();
          }
        }
        if (!levelOriginal && body.state && body.state.original) { levelOriginal = body.state.original; }
        // 补 levelID（地图 levelStatusMap 以 session.levelID=slug 标记完成；新 session
        // 常缺该字段，落库时从关卡文档查 slug 写入，否则地图不显示"已完成"）。
        if (!(fullDoc && fullDoc.levelID) && !body.levelID && levelOriginal && /^[a-f0-9]{24}$/i.test(levelOriginal)) {
          try {
            const lvlDoc = await cocoDb.collection('levels').findOne(
              { $or: [{ original: new ObjectId(levelOriginal) }, { _id: new ObjectId(levelOriginal) }] },
              { slug: 1 });
            if (lvlDoc && lvlDoc.slug) {
              doc.levelID = lvlDoc.slug;
              await coll.updateOne({ _id: docId }, { $set: { levelID: lvlDoc.slug } });
            }
          } catch (e) { /* ignore */ }
        }
        let campaign = (fullDoc && fullDoc.campaign) || body.campaign;
        // session 常缺 campaign（前端 markLevelCompleted 未写）；缺则从关卡文档回退，
        // 否则 resolveCampaign(undefined)=null → 只加本关、不加下一关 → 主线下一关永不解锁。
        if (!campaign && levelOriginal && /^[a-f0-9]{24}$/i.test(levelOriginal)) {
          try {
            const lvlDoc = await cocoDb.collection('levels').findOne(
              { $or: [{ original: new ObjectId(levelOriginal) }, { _id: new ObjectId(levelOriginal) }] },
              { campaign: 1 });
            campaign = lvlDoc && lvlDoc.campaign;
          } catch (e) { /* ignore */ }
        }
        // creator 以服务端登录 cookie 为准：SPA 加载的 session 可能带旧值（转储 level 文档的
        // 关卡作者 creator），或更新请求体缺 creator，只有 cookie 才能保证归属当前用户。
        const cookieUid = req.cookies && req.cookies.zg_userId;
        const cookieCreator = (cookieUid && /^[a-f0-9]{24}$/i.test(cookieUid)) ? cookieUid : null;
        const creator = cookieCreator || (fullDoc && fullDoc.creator) || body.creator;
        console.info('[db] resolved completion: levelOriginal=', levelOriginal, 'campaign=', campaign, 'creator=', creator);
        if (levelOriginal && creator && !/^0{24}$/.test(creator)) {
          // 可达性校验：未解锁关卡通关不产生解锁/发奖，且落库 session 剥离 complete，
          // 防止前端 levelStatusMap 借 COMPLETE 状态强制显示"已解锁"（CampaignView）。
          if (!(await canPlayLevel(creator, levelOriginal))) {
            console.warn('[db] block unlock: level', levelOriginal, 'not reachable for user', creator);
            try {
              if (docId) { await coll.updateOne({ _id: docId }, { $set: { 'state.complete': false } }); }
            } catch (e) { /* ignore */ }
            return res.status(200).json(docId ? { _id: docId.toString() } : {});
          }
          const unlocked = [levelOriginal];
          const campDoc = await resolveCampaign(campaign);
          if (campDoc && campDoc.levels) {
            const entry = campDoc.levels[levelOriginal];
            if (entry) {
              if (entry.nextLevels) { unlocked.push(...Object.keys(entry.nextLevels)); }
              if (Array.isArray(entry.rewards)) {
                for (const r of entry.rewards) { if (r && r.level) { unlocked.push(r.level); } }
              }
            }
          }
          await cocoDb.collection('users').updateOne(
            { _id: new ObjectId(creator) },
            { $addToSet: { 'earned.levels': { $each: unlocked } } },
            { upsert: false }
          );
          // 通关发奖：把本关关联成就的 worth(xp) 与 rewards.gems 计入用户，
          // 驱动 world map 顺序解锁之外的经验/宝石结算。匿名(creator 占位)跳过，
          // 由前端 localStorage 处理。已赚成就不重复发，避免重玩刷分。
          await grantLevelRewards(creator, levelOriginal);
        }
      }
      return res.status(200).json(docId ? { _id: docId.toString() } : {});
    } catch (e) {
      console.error('[db] persist level.session error', e && e.message);
      return res.status(200).json({});
    }
  };
  app.post('/db/level.session', jsonParser, persistLevelSession);
  app.put('/db/level.session/:id', jsonParser, persistLevelSession);
  app.patch('/db/level.session/:id', jsonParser, persistLevelSession);

  // Accept (and ignore) non-essential writes from the anonymous client.
  // Must cover PUT/PATCH/DELETE too, otherwise they fall through to the
  // upstream /db/* proxy (which 404s offline).
  app.post('/db/*', function (req, res) { return res.status(200).json({}); });
  app.put('/db/*', function (req, res) { return res.status(200).json({}); });
  app.patch('/db/*', function (req, res) { return res.status(200).json({}); });
  app.delete('/db/*', function (req, res) { return res.status(200).json({}); });

  // Multi-segment sub-resource reads the SPA issues that exceed the
  // /db/:collection/:id?/:action? template (e.g. /db/level/<id>/top_scores/time/latest,
  // /db/level/<id>/top_scores/<sort>/<sub>). Return an empty array so leaderboard /
  // related-data widgets render empty instead of 404ing. Registered AFTER the
  // versioned route above, so it never shadows /db/<collection>/<id>/version/<n>.
  app.get('/db/:collection/:id/top_scores/:sort?/:sub?', function (req, res) {
    return res.status(200).json([]);
  });
  app.get('/db/:collection/:id/*', function (req, res) {
    return res.status(200).json([]);
  });

  // Now wire up the framework middleware (static serving + the upstream /db proxy).
  // 强制 JS 文件不缓存（app.js 包含 auth 校验逻辑，缓存会导致登录失效）
  app.use('/dev/javascripts', function(req, res, next) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });
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
      // 注入 window.serverSession（原版后端在渲染时注入；MainAdminView 等依赖它，缺则崩）
      const injection = '<script>window.serverSession = { amActually: null, switchingUserActualId: null, featureMode: null };</script>';
      html = html.replace('<script src="/dev/javascripts/app.js"', injection + '<script src="/dev/javascripts/app.js"');
      // 登录态竞态修复：/user-data 是网络请求，async app.js（auth.js 在模块加载时
      // new User(window.userObject)）可能在它返回前执行 → me 匿名 → 整页跳转后导航掉登录。
      // 服务端把 userObject 内联进 HTML（同步脚本），顺序即确定。
      // 注意：user-data 脚本还定义 window.serverConfig（Navigation.vue 的 partnerLogo 依赖
      // this.serverConfig.codeNinjas），移除脚本时必须同时内联 serverConfig，否则导航渲染崩。
      const inlineUid = req.cookies && req.cookies.zg_userId;
      const serverConfigObj = {
        codeNinjas: false,
        static: true,
        picoCTF: false,
        showCodePlayAds: false,
        production: false,
        stripe: false,
        buildInfo: { sha: (config.buildInfo && config.buildInfo.sha) || 'dev' }
      };
      const inlineUserScript = function (userObj) {
        const u = userObj || anonymousUser;
        return '<script>window.userObject = ' + JSON.stringify(u) + ';</script>' +
               '<script>window.serverConfig = ' + JSON.stringify(serverConfigObj) + ';</script>';
      };
      const render = function (userObj) {
        const inlineUser = inlineUserScript(userObj);
        // 内联 userObject 置于 app.js 之前：同步脚本先执行，async app.js 后执行必读到登录态
        html = html.replace('<script src="/user-data?sha=dev"></script>', '');
        html = html.replace('<script src="/dev/javascripts/app.js"', inlineUser + '<script src="/dev/javascripts/app.js"');
        return res.status(200).header('Cache-Control', 'no-cache').send(html);
      };
      if (inlineUid && /^[a-f0-9]{24}$/i.test(inlineUid) && cocoDb) {
        return cocoDb.collection('users').findOne({ _id: new ObjectId(inlineUid) })
          .then(render)
          .catch(() => render(null));
      }
      return render(null);
    });
  });

  return app;
});
