// BuyGemsModal stubbed out - payment disabled
const ModalView = require('views/core/ModalView')

module.exports = (class BuyGemsModal extends ModalView {
  static initClass () {
    this.prototype.id = 'buy-gems-modal'
    this.prototype.template = () => '<div></div>'
    this.prototype.plain = true
  }

  constructor (options) {
    super(options)
  }

  render () { return this }
  onLoaded () { return super.onLoaded() }
  afterRender () { return super.afterRender() }
})
