<script> // eslint-disable-line vue/multi-word-component-names
import { cocoBaseURL, getQueryVariable, isCodeCombat, isOzaria, ozBaseURL } from 'core/utils'
import { mapGetters } from 'vuex'

/**
 * Unified footer component between CodeCombat and Ozaria.
 */
export default Vue.extend({
  data () {
    return {}
  },
  computed: {
    ...mapGetters({
      preferredLocale: 'me/preferredLocale'
    }),

    isCodeCombat () {
      return isCodeCombat
    },

    isOzaria () {
      return isOzaria
    },

    isChinaHome () {
      return features.chinaHome
    },

    cocoBaseURL () {
      return cocoBaseURL()
    },

    ozBaseURL () {
      return ozBaseURL()
    },

    hideFooter () {
      return getQueryVariable('landing', false) || me.hideFooter()
    },

    darkMode () {
      return /^\/(roblox|hackstack|league|play|ai\/play|ai\/starlab)/.test(document.location.pathname)
    },
  },

  created () {
    // Bind the global values to the vue component.
    this.me = me
    this.document = window.document
  },
  methods: {
    footerEvent (e) {
      // Only track if user has clicked a link on the footer
      if (!e || !e.target || e.target.tagName !== 'A') {
        return
      }

      if (!window.tracker) {
        return
      }

      const clickedAnchorTag = e.target
      const action = `Link: ${clickedAnchorTag.getAttribute('href') || clickedAnchorTag.getAttribute('data-event-action')}`
      const properties = {
        category: 'Footer',
        // Inspired from the HomeView homePageEvent method
        user: me.get('role') || (me.isAnonymous() && 'anonymous') || 'homeuser'
      }

      window.tracker.trackEvent(action, properties)
    },

    /**
     * Returns a codecombat url for a relative path.
     * If the user is already on codecombat, will return a relative URL.
     * If the user is on ozaria, will return an absolute url to codecombat.com
     *
     * Handles subdomains such as staging.ozaria.com, will return absolute path
     * to staging.codecombat.com
     *
     * The domains used in China are also handled, i.e. koudashijie
     */
    cocoPath (relativePath) {
      return `${this.cocoBaseURL}${relativePath}`
    },

    ozPath (relativePath) {
      return `${this.ozBaseURL}${relativePath}`
    }
  }
})
</script>

<template lang="pug">
</template>

