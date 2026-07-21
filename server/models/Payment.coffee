# Payment model disabled - internal only
mongoose = require('mongoose')

PaymentSchema = new mongoose.Schema({}, {strict: false})

module.exports = mongoose.model('payment', PaymentSchema)
