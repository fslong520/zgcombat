# Product model disabled - internal only
mongoose = require('mongoose')

ProductSchema = new mongoose.Schema({}, {strict: false})

module.exports = mongoose.model('product', ProductSchema)
