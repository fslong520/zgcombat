// TODO: This file was created by bulk-decaffeinate.
// Sanity-check the conversion and remove this comment.
/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
// List of the BCP-47 language codes
// https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
// Sort according to language popularity on Internet
// http://en.wikipedia.org/wiki/Languages_used_on_the_Internet

const utils = require('../core/utils')

module.exports = {
  en: require('./en'), // Include these in the main bundle
  'en-US': require('./en-US'),
  'en-GB': { nativeDescription: 'English (UK)', englishDescription: 'English (UK)' },
  'zh-HANS': { nativeDescription: '简体中文', englishDescription: 'Chinese (Simplified)' },
  'zh-HANT': { nativeDescription: '繁體中文', englishDescription: 'Chinese (Traditional)' },
}

// We often iterate over this module to get languages, so we don't want these helper methods to show up.
Object.defineProperties(module.exports, {
  load: {
    enumerable: false,
    value (langCode) {
      if (['en', 'en-US'].includes(langCode)) {
        this.storeLoadedLanguage(langCode, module.exports[langCode])
        return Promise.resolve()
      }

      console.log('Loading locale:', langCode)
      const promises = [
        new Promise((resolve, reject) => require('bundle-loader?lazy&name=[name]!locale/' + langCode)(localeData => resolve(localeData))).then(localeData => {
          return this.storeLoadedLanguage(langCode, localeData)
        }).catch(error => {
          return console.error(`Error loading locale '${langCode}':\n`, error)
        }),
      ]
      const firstBit = langCode.slice(0, 2)
      if ((firstBit !== langCode) && (this[firstBit] != null)) {
        promises.push(new Promise((resolve, reject) => require('bundle-loader?lazy&name=locale/[name]!locale/' + firstBit)(localeData => resolve(localeData))).then(localeData => {
          return this.storeLoadedLanguage(firstBit, localeData)
        }).catch(error => {
          return console.error(`Error loading locale '${firstBit}':\n`, error)
        }))
      }
      return Promise.all(promises)
    },
  },

  storeLoadedLanguage: {
    enumerable: false,
    value (langCode, localeData) {
      const store = require('core/store')
      this[langCode] = localeData
      store.commit('addLocaleLoaded', langCode)
      return localeData
    },
  },

  installVueI18n: {
    enumerable: false,
    value () {
      // https://github.com/rse/vue-i18next/blob/master/vue-i18next.js, converted by js2coffee 2.2.0
      const store = require('core/store')

      const VueI18Next = {
        install (Vue, options) {
        /*  determine options  */

          let opts = {}
          Vue.util.extend(opts, options)

          /*  expose a global API method  */

          Vue.t = function (key, options) {
            opts = {}
            let lng = store.state.me.preferredLanguage || 'en'
            if (!store.state.localesLoaded[lng]) {
              lng = 'en'
            }
            if ((typeof lng === 'string') && (lng !== '')) {
              opts.lng = lng
            }
            Vue.util.extend(opts, options)
            return $.i18n.t(key, opts)
          }

          /*  expose a local API method  */

          Vue.prototype.$t = function (key, options) {
            opts = {}
            let lng = store.state.me.preferredLanguage || 'en'
            if (!store.state.localesLoaded[lng]) {
              lng = 'en'
            }
            if ((typeof lng === 'string') && (lng !== '')) {
              opts.lng = lng
            }
            const ns = this.$options.i18nextNamespace
            if ((typeof ns === 'string') && (ns !== '')) {
              opts.ns = ns
            }
            Vue.util.extend(opts, options)
            return $.i18n.t(key, opts)
          }

          Vue.prototype.$dbt = function (source, key, options) {
            if (options == null) { options = {} }
            return utils.i18n(source, key, options.language, options.fallback)
          }
        },
      }

      return Vue.use(VueI18Next)
    },
  },

  mapFallbackLanguages: {
    enumerable: false,
    value () {
      const fallbacksByCode = { default: ['en'] }
      for (const code in module.exports) {
        if (code !== 'en') {
          const fallbacks = []
          const parts = code.split('-')
          while (parts.length > 1) {
            const parent = parts.slice(0, parts.length - 1).join('-')
            if (module.exports[parent] && !Array.from(fallbacks).includes(parent)) { fallbacks.push(parent) }
            for (const c2 in module.exports) {
              if ((c2 !== code) && (c2.split('-').slice(0, parts.length - 1).join('-') === parent) && !Array.from(fallbacks).includes(c2)) {
                fallbacks.push(c2)
              }
            } // Sibling, uncle, or niece
            parts.pop()
          }
          if (!(_.string || _.str).startsWith(code, 'en')) { fallbacks.push('en') }
          fallbacksByCode[code] = fallbacks
        }
      }
      return fallbacksByCode
    },
  },
},
)
