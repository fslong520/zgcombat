// 修复 Bootstrap 3 tooltip/popover 残留 resize 监听在 $tip 为 null 时
// applyPlacement 读 $tip[0].offsetHeight 抛 "Cannot read properties of null (reading 'offsetHeight')"。
//
// 触发链：SpellView.resizeWindow (_.debounce 600ms) -> $(window).trigger('resize')
//        -> Bootstrap 残留 popover/tooltip 的 resize 监听 -> applyPlacement -> 读 null $tip -> 崩。
// 见 bower_components/bootstrap/js/tooltip.js:180
//
// 防御：覆盖 applyPlacement / show，元素已销毁时跳过并清理残留监听。
function patchConstructor (Constructor) {
  if (!Constructor || Constructor.__patched) return
  const origApplyPlacement = Constructor.prototype.applyPlacement
  Constructor.prototype.applyPlacement = function (offset, placement) {
    if (!this.$tip || !this.$tip[0]) {
      // 元素已销毁但 resize 监听残留：跳过读取 offsetHeight，并清理残留监听
      if (this.$element && this.$element.off) this.$element.off('.' + this.type)
      $(window).off('resize.' + this.type)
      return
    }
    return origApplyPlacement.call(this, offset, placement)
  }

  const origShow = Constructor.prototype.show
  Constructor.prototype.show = function () {
    if (!this.$element || !this.$element.length) return
    return origShow.call(this)
  }

  Constructor.__patched = true
}

function applyBootstrapPopoverFix () {
  const $ = window.jQuery || window.$
  if (!($ && $.fn)) return
  // tooltip 与 popover 可能指向不同构造器（取决于运行时实际加载的 Bootstrap 版本）
  if ($.fn.tooltip && $.fn.tooltip.Constructor) patchConstructor($.fn.tooltip.Constructor)
  if ($.fn.popover && $.fn.popover.Constructor) patchConstructor($.fn.popover.Constructor)
}

// 在 bootstrap 完全加载、play 关卡 popover 创建前注入；
// 用 window.load + setTimeout 确保覆盖的是运行时实际使用的构造器。
if (typeof window !== 'undefined') {
  const run = () => setTimeout(applyBootstrapPopoverFix, 0)
  if (document.readyState === 'complete') run()
  else window.addEventListener('load', run)
}

// eslint-disable-next-line no-undef
if (typeof module !== 'undefined') module.exports = applyBootstrapPopoverFix
