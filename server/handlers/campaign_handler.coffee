Campaign = require './../models/Campaign'
Handler = require '../commons/Handler'

CampaignHandler = class CampaignHandler extends Handler
  modelClass: Campaign
  jsonSchema: Campaign.schema.jsonSchema

  hasAccess: (req) ->
    true

  hasAccessToDocument: (req, document, method=null) ->
    true

module.exports = new CampaignHandler()
