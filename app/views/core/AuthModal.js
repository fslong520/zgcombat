// TODO: This file was created by bulk-decaffeinate.
// Sanity-check the conversion and remove this comment.
/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__, or convert again using --optional-chaining
 * DS206: Consider reworking classes to avoid initClass
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/main/docs/suggestions.md
 */
let AuthModal
require('app/styles/modal/auth-modal.sass')
const utils = require('core/utils')
const ModalView = require('views/core/ModalView')
const template = require('app/templates/core/auth-modal')
const forms = require('core/forms')
const User = require('models/User')
const errors = require('core/errors')
const RecoverModal = require('views/core/RecoverModal')
const storage = require('core/storage')
const globalVar = require('core/globalVar')
const userUtils = require('../../lib/user-utils')

module.exports = (AuthModal = (function () {
  AuthModal = class AuthModal extends ModalView {
    static initClass () {
      this.prototype.id = 'auth-modal'
      this.prototype.template = template
      this.prototype.trapsFocus = false // TODO: re-enable this in a way that doesn't break Google login Noty

      this.prototype.events = {
        'click #switch-to-signup-btn': 'onSignupInstead',
        'submit form': 'onSubmitForm',
        'keyup #name': 'onNameChange',
        'click #close-modal': 'hide',
        'click [data-toggle="coco-modal"][data-target="core/RecoverModal"]': 'openRecoverModal',
      }
    }

    // Initialization

    initialize (options) {
      if (options == null) { options = {} }
      this.utils = utils
      this.previousFormInputs = options.initialValues || {}
      if (this.previousFormInputs.emailOrUsername == null) { this.previousFormInputs.emailOrUsername = this.previousFormInputs.email || this.previousFormInputs.username }

      if (options.loginMessage) {
        this.loginMessage = options.loginMessage
      }

      if (options.nextUrl) {
        this.nextUrl = options.nextUrl
        window.nextURL = options.nextUrl
      }

      this.subModalContinue = options.subModalContinue
      this.showLibraryModal = userUtils.shouldShowLibraryLoginModal()
    }

    afterRender () {
      super.afterRender()
      return this.playSound('game-menu-open')
    }

    afterInsert () {
      super.afterInsert()
      return _.delay(() => $('input:visible:first', this.$el).focus(), 500)
    }

    destroy () {
      if (this.nextUrl && (this.nextUrl === window.nextURL)) {
        return delete window.nextURL
      }
    }

    onSignupInstead (e) {
      const CreateAccountModal = require('./CreateAccountModal')
      const modal = new CreateAccountModal({ initialValues: forms.formToObject(this.$el, this.subModalContinue) })
      return globalVar.currentView.openModalView(modal)
    }

    onSubmitForm (e) {
      this.playSound('menu-button-click')
      e.preventDefault()
      forms.clearFormAlerts(this.$el)
      this.$('#unknown-error-alert').addClass('hide')
      const userObject = forms.formToObject(this.$el)
      const res = tv4.validateMultiple(userObject, formSchema)
      if (!res.valid) { return forms.applyErrorsToForm(this.$el, res.errors) }
      let showingError = false
      return new Promise(me.loginPasswordUser(userObject.emailOrUsername, userObject.password).then)
        .catch(jqxhr => {
          if (jqxhr.status === 401) {
            const {
              errorID,
            } = jqxhr.responseJSON
            if (errorID === 'not-found') {
              forms.setErrorToProperty(this.$el, 'emailOrUsername', $.i18n.t('loading_error.' + (utils.iszgcombat ? 'user_not_found' : 'not_found'))) // todo: update i18n
              showingError = true
            }
            if (errorID === 'wrong-password') {
              forms.setErrorToProperty(this.$el, 'password', $.i18n.t('account_settings.wrong_password'))
              showingError = true
            }
            if (errorID === 'temp-password-expired') {
              forms.setErrorToProperty(this.$el, 'password', $.i18n.t('account_settings.temp_password_expired'))
              showingError = true
            }

            if (utils.isOzaria && (errorID === 'individuals-not-supported')) {
              forms.setErrorToProperty(this.$el, 'emailOrUsername', $.i18n.t('login.individual_users_not_supported'))
              showingError = true
            }
          } else if (jqxhr.status === 429) {
            showingError = true
            forms.setErrorToProperty(this.$el, 'emailOrUsername', $.i18n.t('loading_error.too_many_login_failures'))
          }

          if (!showingError) {
            return this.$('#unknown-error-alert').removeClass('hide')
          }
        })
        .then(() => {
          application.tracker.identifyAfterNextPageLoad()
          return application.tracker.identify()
        })
        .finally(() => {
          if (!showingError) {
            if (window.nextURL) {
              return window.location.href = window.nextURL
            } else {
              return loginNavigate(this.subModalContinue)
            }
          }
        })
    }


    openRecoverModal (e) {
      e.stopPropagation()
      return this.openModalView(new RecoverModal())
    }

    onHidden () {
      super.onHidden()
      return this.playSound('game-menu-close')
    }
  }
  AuthModal.initClass()
  return AuthModal
})())

var formSchema = {
  type: 'object',
  properties: {
    emailOrUsername: {
      $or: [
        User.schema.properties.name,
        User.schema.properties.email,
      ],
    },
  },
  required: ['emailOrUsername', 'password'],
}

var loginNavigate = function (subModalContinue) {
  if (window.nextURL) {
    window.location.href = window.nextURL
    return
  }

  if (!me.isAdmin()) {
    if (me.isAPIClient()) {
      application.router.navigate('/partner-dashboard', { trigger: true })
    } else if (me.isStudent()) {
      application.router.navigate('/students', { trigger: true })
    } else if (me.isTeacher()) {
      if (me.isSchoolAdmin()) {
        // todo: unify?
        if (utils.iszgcombat) {
          application.router.navigate('/teachers/licenses', { trigger: true })
        } else {
          application.router.navigate('/school-administrator', { trigger: true })
        }
      } else {
        application.router.navigate('/teachers/classes', { trigger: true })
      }
    } else if (me.isParentHome()) {
      const routeStr = me.hasNoVerifiedChild() ? '/parents/add-another-child' : '/parents/dashboard'
      application.router.navigate(routeStr, { trigger: true })
    }
  } else if (subModalContinue) {
    storage.save('sub-modal-continue', subModalContinue)
  }

  return window.location.reload()
}

function __guardMethod__ (obj, methodName, transform) {
  if (typeof obj !== 'undefined' && obj !== null && typeof obj[methodName] === 'function') {
    return transform(obj, methodName)
  } else {
    return undefined
  }
}
