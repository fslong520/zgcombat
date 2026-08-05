// TODO: This file was created by bulk-decaffeinate.
// Sanity-check the conversion and remove this comment.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
const publishableKey = application.isProduction() ? 'pk_live_27jQZozjDGN1HSUTnSuM578g' : 'pk_test_zG5UwVu6Ww8YhtE9ZYh0JO6a'

if (me.isAnonymous()) {
  module.exports = {
    open: _.noop, // for tests to spy on
    openAsync: _.noop // for tests to spy on
  }
  _.extend(module.exports, Backbone.Events)
  module.exports.makeNewInstance = _.clone(module.exports)
} else if ((typeof StripeCheckout === 'undefined' || StripeCheckout === null)) {
  module.exports = {}
  // 内部部署无 StripeCheckout，静默（原 console.log 每次加载都打一条噪音）
} else {
  const makeNewInstance = function () {
    var handler = StripeCheckout.configure({
      key: publishableKey,
      name: 'CodeCombat',
      email: me.get('email'),
      image: 'https://flsong.iok.la/images/pages/base/logo_square_250.png',
      token (token) {
        handler.trigger('received-token', { token })
        return Backbone.Mediator.publish('stripe:received-token', { token })
      },
      locale: 'auto',
      zipCode: true
    })
    handler.id = _.uniqueId()
    handler.openAsync = function (options) {
      const promise = new Promise((resolve, reject) => handler.once('received-token', resolve))
      handler.open(options)
      return promise
    }
    _.extend(handler, Backbone.Events)
    return handler
  }
  module.exports = makeNewInstance()
  module.exports.makeNewInstance = makeNewInstance
}
