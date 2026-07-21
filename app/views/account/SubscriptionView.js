// SubscriptionView stubbed out - payment/subscription disabled
const RootView = require('views/core/RootView')
const template = require('app/templates/account/subscription-view')

module.exports = (class SubscriptionView extends RootView {
  static initClass () {
    this.prototype.id = 'subscription-view'
    this.prototype.template = template
  }

  constructor (options) {
    super(options)
  }

  getMeta () {
    return { title: $.i18n.t('account.subscription_title') }
  }
})
