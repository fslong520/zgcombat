# Prepaid model disabled - internal only
mongoose = require 'mongoose'

PrepaidSchema = new mongoose.Schema {
  creator: mongoose.Schema.Types.ObjectId
}, {strict: false, minimize: false}

PrepaidSchema.statics.DEFAULT_START_DATE = new Date(2016,4,15).toISOString()
PrepaidSchema.statics.DEFAULT_END_DATE = new Date(2017,5,1).toISOString()

module.exports = Prepaid = mongoose.model('prepaid', PrepaidSchema)
