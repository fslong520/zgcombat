# AnalyticsStripeInvoice model disabled - internal only
mongoose = require 'mongoose'

AnalyticsStripeInvoiceSchema = new mongoose.Schema({
  _id: String
  date: Number
  properties: mongoose.Schema.Types.Mixed
}, {strict: false})

module.exports = mongoose.model('analytics.stripe.invoice', AnalyticsStripeInvoiceSchema)
