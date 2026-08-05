// 浏览器端空 mock：coffee-script 编译器顶层 require('fs')，但 compile 路径不使用。
// 供 webpack resolve.alias 将 fs 指向本文件，避免打包 Node 核心模块。
module.exports = {}
