global.$ = window.$ = global.jQuery = window.jQuery = require('jquery');
// features is normally injected by the server into the page HTML; default it so
// bare `features?.x` references don't throw when the shell arrives without it.
window.features = window.features || {};
import 'bootstrap';
import './app.sass';
import 'core-js/stable';
import 'regenerator-runtime/runtime';

/**
 * Fonts dynamically imported based on infra location
 */
if (window.features && window.features.chinaUx) {
  import(/* webpackChunkName: "ChinaFont" */ 'app/styles/common/fontChina.sass');
} else {
  import(/* webpackChunkName: "UsFont" */ 'app/styles/common/fontUS.sass');
}

require('app/vendor.js'); // can be loaded separately and cached for a longer time

// require.context('app/schemas', true, /.*\.(coffee|jade)/)
// require.context('app/models', true, /.*\.(coffee|jade)/)
// require.context('app/collections', true, /.*\.(coffee|jade)/)
// require.context('app/core', true, /.*\.(coffee|jade)/)
// require.context('app/views/core', true, /.*\.(coffee|jade)/)

// Polyfill window.require for Brunch compatibility under webpack.
// The Brunch-era module system (ModuleLoader, Router lazy view loading) relies on a
// global `window.require` with `.list()` / `.register()` / `(name, loaderPath)`.
// Webpack does not expose one, so we bridge it to webpack's module runtime.
if (typeof window.require === 'undefined') {
  var brunchCache = {};

  var webpackIdOf = function(name) {
    // Brunch allowed both `require('views/core/RootView')` (resolved under
    // app/) and `require('app/components/x.vue')` (already rooted at app/).
    // Strip a leading `app/` so we never produce `./app/app/...`.
    var n = name.indexOf('app/') === 0 ? name.slice(4) : name;
    return './app/' + n;
  };

  var tryWebpackRequire = function(name) {
    var wid = webpackIdOf(name);
    var candidates = [wid + '.js', wid + '.coffee', wid];
    var lastErr;
    for (var ci = 0; ci < candidates.length; ci++) {
      try {
        var res = __webpack_require__(candidates[ci]);
        if (res === undefined || res === null) continue;
        if (typeof res === 'object' && !Array.isArray(res) && Object.keys(res).length === 0) continue;
        return res;
      } catch (e) { lastErr = e; if (typeof window !== 'undefined') window.__twr = { name: candidates[ci], err: String(e && e.message || e) }; }
    }
    if (typeof window !== 'undefined' && lastErr) window.__twr = { name: name, err: String(lastErr.message || lastErr), stack: String(lastErr.stack || '').split('\n').slice(0, 6) };
    return undefined;
  };

  var getModuleNames = function() {
    try {
      var m = Object.keys(__webpack_require__.m || {});
      var webpackNames = m.map(function(key) {
        return key.replace(/^\.\/app\//, '').replace(/\.(coffee|js|pug|vue|sass|css|json)$/, '');
      }).filter(function(name) { return name && name.indexOf('node_modules') !== 0 && name.indexOf('bower_components') !== 0; });
      var brunchNames = Object.keys(brunchCache);
      return webpackNames.concat(brunchNames);
    } catch (e) {
      return [];
    }
  };

  var resolveRelativePath = function(dep, requirer) {
    if (dep.indexOf('./') !== 0 && dep.indexOf('../') !== 0) return dep;
    var parts = requirer.split('/');
    parts.pop();
    var dir = parts.join('/');
    var depParts = dep.split('/');
    var dirParts = dir ? dir.split('/') : [];
    for (var i = 0; i < depParts.length; i++) {
      var seg = depParts[i];
      if (seg === '..') { dirParts.pop(); }
      else if (seg !== '.') { dirParts.push(seg); }
    }
    return dirParts.join('/');
  };

  // Lazily-resolved module directories. Brunch's `window.require(name)` could
  // load ANY module by name; under webpack we instead force-bundle these
  // directories via require.context and resolve name -> module here. Order
  // matters: the first context whose `base` is a prefix of `name` wins.
  // The last entry bundles only top-level view files (e.g. HomeView) without
  // descending into subdirectories, so we don't pull in dead/broken views.
  var WAD_CONTEXTS = [
    { base: 'lib', ctx: require.context('./lib', true, /\.(coffee|js)$/) },
    { base: 'views/play', ctx: require.context('./views/play', true, /\.(coffee|js)$/) },
    { base: 'views/editor', ctx: require.context('./views/editor', true, /\.(coffee|js)$/) },
    { base: 'views/courses', ctx: require.context('./views/courses', true, /\.(coffee|js)$/) },
    { base: 'views', ctx: require.context('./views', false, /^\.\/[A-Z][A-Za-z]*\.(coffee|js)$/) }
  ];

  var unwrapDefault = function(mod) {
    if (mod && mod.__esModule && mod.default !== undefined) return mod.default;
    return mod;
  };

  var tryWadContext = function(name) {
    try {
      for (var d = 0; d < WAD_CONTEXTS.length; d++) {
        var entry = WAD_CONTEXTS[d];
        if (name.indexOf(entry.base + '/') !== 0) continue;
        var rel = name.slice(entry.base.length + 1);
        var keys = entry.ctx.keys();
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k]; // e.g. './play/CampaignView.coffee'
          var modName = key.replace(/^\.\//, '').replace(/\.(coffee|js|vue|pug)$/, '');
          if (modName === rel) {
            return unwrapDefault(entry.ctx(key));
          }
        }
      }
    } catch (e) { /* fall through */ }
    return undefined;
  };

  var resolveModule = function(name, requirer) {
    var resolved = requirer ? resolveRelativePath(name, requirer) : name;
    var result = tryWebpackRequire(resolved);
    if (result !== undefined) return result;
    result = tryWadContext(resolved);
    if (result !== undefined) return result;
    if (brunchCache[resolved]) {
      var mod = brunchCache[resolved];
      if (mod.exports) return mod.exports;
      var factory = mod.factory;
      var localRequire = function(dep) { return resolveModule(dep, resolved); };
      mod.exports = {};
      factory(mod.exports, localRequire, mod);
      return mod.exports;
    }
    var from = requirer ? ' from "' + requirer + '"' : ' from "app/app.js"';
    throw new Error('Cannot find module "' + name + '"' + from);
  };

  window.require = function(name) { return resolveModule(name, null); };
  window.require.list = getModuleNames;
  window.require._defined = {};
  window.require.register = function(name, factory) {
    brunchCache[name] = { factory: factory, exports: null };
  };
}

// Force webpack to bundle every lazily-loaded (Brunch "WAD") module so they are
// resolvable through window.require, even though Brunch's concatenated
// `app/<dir>.js` files no longer exist under webpack. ModuleLoader normally
// fetches those concat files; under webpack we instead bundle the individual
// modules and let ModuleLoader resolve them directly. The context paths MUST be
// static string literals (webpack cannot extract a context from a runtime
// expression like './' + dir).
if (typeof window !== 'undefined' && window.require) {
  window.require._wadContexts = WAD_CONTEXTS;
  // Keep the contexts referenced so webpack does not tree-shake the modules.
  WAD_CONTEXTS.forEach(function (entry) { entry.ctx.keys(); });
  window.__wr = __webpack_require__;
  window.__wrm = __webpack_require__.m;
}

// Provide a legacy $.i18n global (i18next) so the canonical application.coffee,
// which uses the old $.i18n.init({ resStore }) API, can initialize under webpack.
// The upstream Brunch build loaded i18next via bower; webpack has no bower i18next,
// so we bridge the modern npm i18next (v20) to the legacy API surface.
if (typeof window !== 'undefined' && window.$ && !window.$.i18n) {
  var i18next = require('i18next');
  var i18nextMod = i18next.default || i18next;
  var i18nInstance = i18nextMod.createInstance();
  // Bundle every locale translation module via require.context and build i18next resources.
  var localeContext = require.context('locale', false, /^[A-Za-z-]+\.coffee$/);
  var i18nResources = {};
  localeContext.keys().forEach(function (key) {
    var code = key.replace(/^\.\//, '').replace(/\.coffee$/, '');
    if (code === 'locale') { return; } // skip locale/locale.coffee itself
    var mod = localeContext(key);
    var translation = (mod && mod.translation) ? mod.translation : mod;
    i18nResources[code] = { translation: translation };
  });
  i18nInstance.init({
    lng: (window.userObject && window.userObject.preferredLanguage) || 'en',
    fallbackLng: 'en',
    resources: i18nResources,
    interpolation: { prefix: '__', suffix: '__' },
    keySeparator: false,
    nsSeparator: false,
    returnEmptyString: false
  });
  window.$.i18n = i18nInstance;
  window.i18n = i18nInstance;
  window.$.t = i18nInstance.t.bind(i18nInstance);
  // Register the jQuery DOM-translation handle ($(sel).i18n()) so Backbone
  // views (e.g. CocoView.render -> @$el.i18n()) can translate [data-i18n]
  // elements. The legacy Brunch build loaded jquery-i18next as a global script;
  // under webpack we must initialize it explicitly here.
  try {
    var jqueryI18nextShim = require('jquery-i18next');
    jqueryI18nextShim.init(i18nInstance, window.$, {
      tName: 't',
      i18nName: 'i18n',
      handleName: 'i18n',
      selectorAttr: 'data-i18n',
      targetAttr: 'i18n-target',
      optionsAttr: 'i18n-options',
      useOptionsAttr: true,
      parseDefaultValueFromContent: true
    });
  } catch (e) { console.error('i18n jQuery handle init failed:', e); }
  // application.coffee calls $.i18n.init(options, cb); already initialized, just fire cb.
  var legacyInit = function (options, cb) {
    if (typeof cb === 'function') { try { cb(window.$.t); } catch (e) { console.error(e); } }
    return i18nInstance;
  };
  i18nInstance.init = legacyInit;
  window.$.i18n.init = legacyInit;
}

require('core/initialize');
