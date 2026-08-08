# SubscriptionView stubbed out - payment/subscription disabled
RootView = require 'views/core/RootView'
template = require 'templates/account/subscription-view'

module.exports = class SubscriptionView extends RootView
  id: "subscription-view"
  template: template
