/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
// Register CoffeeScript require hook BEFORE any .coffee requires
require('coffee-script/register');

(function(setupLodash) {
  global._ = require('lodash');
  _.str = require('underscore.string');
  return _.mixin(_.str.exports());
})(this);

const express = require('express');
const http = require('http');
const serverSetup = require('./server_setup');
const co = require('co');
const config = require('./server_config');
const Promise = require('bluebird');
const mongoose = require('mongoose');
mongoose.Promise = Promise; // Fix Mongoose 4 mpromise incompatibility with co/yield
const routeLoader = require('./server/routes/base');

// Global error handlers to prevent server crashes from unhandled errors
process.on('uncaughtException', function(err) {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack?.split('\n').slice(0,5).join('\n'));
});
process.on('unhandledRejection', function(err) {
  console.error('UNHANDLED REJECTION:', err?.message || err);
});

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
  serverSetup.setupMiddleware(app);

  // Establish MongoDB connection BEFORE loading routes (Mongoose 5.x requires it)
  try {
    const database = require('./server/commons/database');
    database.connect();
    console.info('Database connection initiated');
  } catch (e) {
    console.error('Failed to connect to database:', e.message);
  }

  // Setup Passport serialization for auth
  try {
    const auth = require('./server/commons/auth');
    if (typeof auth.setup === 'function') auth.setup();
    console.info('Passport auth initialized');
  } catch (e) {
    console.error('Failed to initialize auth:', e.message);
  }

  // Stub endpoints for missing resources - MUST come BEFORE /db/* catch-all
  app.get('/db/mandate', function(req, res) { res.json({}); });
  app.get('/db/user-credits/:level', function(req, res) { res.json({credits: {}}); });
  app.get('/db/user-credits', function(req, res) { res.json({credits: {}}); });
  app.put('/db/user/setUserCountryGeo', function(req, res) { res.json({country: 'CN', geo: {timeZone: 'Asia/Shanghai'}}); });
  app.put('/db/user/:userId/extra-provisions', function(req, res) { res.json({provisionType: 'none'}); });
  app.post('/db/user/announcements/new', function(req, res) { res.json([]); });
  app.get('/db/user/announcements', function(req, res) { res.json([]); });
  app.post('/db/oauth2identity/by-user', function(req, res) { res.json([]); });
  app.get('/db/oauth2identity/count', function(req, res) { res.json({count: 0}); });

  // Payment/subscription stubs - return empty/success responses
  app.get('/db/payment', function(req, res) { res.json({}); });
  app.get('/db/prepaid', function(req, res) { res.json([]); });
  app.get('/db/prepaid/:code', function(req, res) { res.json({}); });
  app.get('/db/purchase', function(req, res) { res.json({}); });
  app.get('/db/subscription', function(req, res) { res.json({}); });
  app.get('/db/products', function(req, res) { res.json([]); });
  app.post('/db/user/:userId/subscribe', function(req, res) { res.json({}); });
  app.post('/stripe/webhook', function(req, res) { res.json({received: true}); });
  app.post('/db/payment', function(req, res) { res.json({}); });
  app.post('/db/purchase', function(req, res) { res.json({}); });
  app.put('/db/user/:userId/subscription', function(req, res) { res.json({}); });

  try {
    routeLoader.setup(app);
    console.info('Route modules loaded successfully');
  } catch (e) {
    console.error('Failed to load route modules:', e.message);
  }

  // Serve /user-data as JavaScript snippet for client-side initialization
  app.get('/user-data', function(req, res) {
    res.setHeader('Content-Type', 'application/javascript');
    const serverConfig = {
      codeNinjas: false,
      static: true,
      picoCTF: false,
      showCodePlayAds: false,
      production: false,
      stripe: false,
      buildInfo: { sha: config.buildInfo.sha || 'dev' }
    };
    res.send('window.userObject = {};\nwindow.serverConfig = ' + JSON.stringify(serverConfig) + ';');
  });

  return app;
});
