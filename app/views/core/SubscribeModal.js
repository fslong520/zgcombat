// SubscribeModal stubbed out - payment/subscription disabled
const ModalView = require('views/core/ModalView')

module.exports = (class SubscribeModal extends ModalView {
  static initClass () {
    this.prototype.id = 'subscribe-modal'
    this.prototype.template = () => '<div></div>'
    this.prototype.plain = true
    this.prototype.closesOnClickOutside = false
  }

  constructor (options) {
    if (options == null) { options = {} }
    super(options)
  }

  render () { return this }
  onLoaded () { return super.onLoaded() }
  afterRender () { return super.afterRender() }
})
