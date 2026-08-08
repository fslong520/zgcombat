// Custom webpack loader for legacy CodeCombat `.jade` templates.
//
// The project still carries Brunch-era `.jade` files whose syntax (jade-lenient
// `extends`/`block` ordering, and Vue `{{ }}` interpolation left as literal text)
// pug-loader (pug v3) refuses to parse. The original `jade` compiler (v1) is
// lenient about `extends`/`block` placement and treats `{{ }}` as literal text,
// so it compiles these templates correctly.
//
// IMPORTANT: we precompile at BUILD time (here, in Node, where `fs` is available
// to resolve `extends`/`include`) and emit a function bound to `jade/runtime.js`
// (pure JS, no `fs`). A previous version compiled at runtime in the browser,
// which broke for any template using `extends`/`include` because the browser
// bundle has no `fs`. `compileClient` returns the function *source*, which
// references the `jade` runtime via a free variable we bind to `jade/runtime.js`.
// The compiled function still takes `locals`, so `#{}` / `= expr` interpolation
// with per-render locals works for Backbone views, and Vue components receive
// the literal `{{ }}` text that Vue binds at runtime.
const jade = require('jade');
const path = require('path');
const runtimePath = require.resolve('jade/runtime.js');
// Absolute `extends`/`include` paths (e.g. `extends /templates/base`) are
// resolved relative to the app directory, matching Brunch's jade plugin.
const BASEDIR = path.resolve(__dirname, 'app');

module.exports = function jadeCompatLoader(source) {
  const clientFn = jade.compileClient(source, {
    filename: this.resourcePath,
    basedir: BASEDIR,
    pretty: false,
    compileDebug: false,
  });
  return (
    'var jade = require(' + JSON.stringify(runtimePath) + ');\n' +
    'module.exports = ' + clientFn + ';'
  );
};
