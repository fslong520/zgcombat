/*
 * decaffeinate suggestions:
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const cluster = require('cluster')
const { sassFalse } = require('sass')

const config = {}

config.product = process.env.COCO_PRODUCT || 'codecombat'
config.productName = { codecombat: 'ZGCombat', ozaria: 'Ozaria' }[config.product]
config.productMainDomain = { codecombat: 'codecombat.com', ozaria: 'ozaria.com' }[config.product]

if (process.env.COCO_SECRETS_JSON_BUNDLE) {
  const object = JSON.parse(process.env.COCO_SECRETS_JSON_BUNDLE)
  for (const k in object) {
    const v = object[k]
    process.env[k] = v
  }
}

config.clusterID = `${os.hostname()}`
if (cluster.worker != null) {
  config.clusterID += `/${cluster.worker.id}`
}

config.unittest = global.testing
config.proxy = process.env.COCO_PROXY

config.timeout = parseInt(process.env.COCO_TIMEOUT) || (60 * 1000)

config.chinaDomain = 'ccombat.cn;contributors.codecombat.com'
config.chinaInfra = process.env.COCO_CHINA_INFRASTRUCTURE || sassFalse

config.port = process.env.COCO_PORT || process.env.COCO_NODE_PORT || process.env.PORT || 3000

if (config.unittest) {
  config.port += 1
}

config.cookie_secret = process.env.COCO_COOKIE_SECRET || 'chips ahoy'

config.isProduction = false
// Domains (without subdomain prefix, with port number) for main hostname (usually codecombat.com)
// and unsafe web-dev iFrame content (usually codecombatprojects.com).
config.mainHostname = process.env.COCO_MAIN_HOSTNAME || 'localhost:3000'
config.unsafeContentHostname = process.env.COCO_UNSAFE_CONTENT_HOSTNAME || 'localhost:3000'

if (!config.unittest && !config.isProduction) {
  // change artificially slow down non-static requests for testing
  config.slow_down = false
}

config.buildInfo = { sha: 'dev' }

if (fs.existsSync(path.join(process.env.PWD || __dirname, '.build_info.json'))) {
  config.buildInfo = JSON.parse(fs.readFileSync(path.join(process.env.PWD || __dirname, '.build_info.json'), 'utf8'))
}

// This logs a stack trace every time an endpoint sends a response or throws an error.
// It's great for finding where a mystery endpoint is!
config.TRACE_ROUTES = (process.env.TRACE_ROUTES != null)

// Enables server-side gzip compression for network responses
// Only use this if testing network response sizes in development
// (In production, CloudFlare compresses things for us!)
config.forceCompression = (process.env.COCO_FORCE_COMPRESSION != null)

config.mongo = {
  host: process.env.COCO_MONGO_HOST || 'localhost',
  port: process.env.COCO_MONGO_PORT || 27017,
  db: process.env.COCO_MONGO_DB || 'codecombat',
  username: process.env.COCO_MONGO_USERNAME || '',
  password: process.env.COCO_MONGO_PASSWORD || '',
  readpref: process.env.COCO_MONGO_READPREF || 'primary',
  mongoose_replica_string: process.env.COCO_MONGO_REPLICA_STRING || undefined,
  analytics_host: process.env.COCO_ANALYTICS_MONGO_HOST || 'localhost',
  analytics_port: process.env.COCO_ANALYTICS_MONGO_PORT || 27017,
  analytics_db: process.env.COCO_ANALYTICS_MONGO_DB || 'codecombat_analytics',
  analytics_replica_string: process.env.COCO_ANALYTICS_REPLICA_STRING || undefined,
  analytics_collection: process.env.COCO_ANALYTICS_COLLECTION || 'analytics.log.event',
  level_session_replica_string: process.env.COCO_LEVEL_SESSION_REPLICA_STRING || undefined,
  level_session_aux_replica_string: process.env.COCO_LEVEL_SESSION_AUX_REPLICA_STRING || undefined,
}

config.redis = {
  host: process.env.REDIS_HOST || process.env.COCO_REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || process.env.COCO_REDIS_PORT || 6379,
}

config.mail = {
  mailChimpAPIKey: process.env.COCO_MAILCHIMP_API_KEY || '00000000000000000000000000000000-us1',
  mailChimpWebhook: '/mail/webhook',
  username: process.env.COCO_MAIL_USERNAME || '',
  supportPremium: process.env.COCO_MAIL_SUPPORT_PREMIUM || 'premium@codecombat.com',
  supportPrimary: process.env.COCO_MAIL_SUPPORT_PRIMARY || 'support@codecombat.com',
  cronHandlerPublicIP: process.env.COCO_CRON_PUBLIC_IP || '',
  cronHandlerPrivateIP: process.env.COCO_CRON_PRIVATE_IP || '',
  stackleadAPIKey: process.env.COCO_STACKLEAD_API_KEY || '',
}

config.stripe = {
  secretKey: process.env.COCO_STRIPE_SECRET_KEY || 'sk_test_placeholder',
}

module.exports = config
