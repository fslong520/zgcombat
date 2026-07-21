# Purchase model disabled - internal only
mongoose = require('mongoose')

PurchaseSchema = new mongoose.Schema({}, {strict: false})

module.exports = mongoose.model('purchase', PurchaseSchema)
