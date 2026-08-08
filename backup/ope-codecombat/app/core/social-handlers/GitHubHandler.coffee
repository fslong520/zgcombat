CocoClass = require 'core/CocoClass'
{me} = require 'core/auth'
storage = require 'core/storage'

module.exports = class GitHubHandler extends CocoClass
  scopes: 'user:email'

  subscriptions:
    'auth:log-in-with-github': 'commenceGitHubLogin'

  isLocal: -> document.location.href.search('https?://localhost') isnt -1 or document.location.href.search('https?://192.168.') isnt -1

  constructor: ->
    super arguments...
    @clientID = if @isLocal() then 'fd5c9d34eb171131bc87' else '9b405bf5fb84590d1f02'
    @redirectURI = if @isLocal() then 'http://localhost:3000/github/auth_callback' else 'http://codecombat.com/github/auth_callback'

  commenceGitHubLogin: (e) ->
    request =
      scope: @scopes
      client_id: @clientID
      redirect_uri: @redirectURI

    location.href = "https://github.com/login/oauth/authorize?" + $.param(request)