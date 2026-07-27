// 内部部署：匿名用户的通关进度存于浏览器 localStorage。
// 登录用户由后端写入 MongoDB（见 server.js 之 level.session 持久化）。
// 数据结构：
// {
//   completed: { [slug]: { original, complete: true } },   // 已通关关卡
//   unlocked:  [original, ...],                             // 已解锁（可玩）关卡 original 集合
//   rewards:   { [original]: { xp, gems } }                 // 每关累计获得之经验/宝石（按关去重）
// }
const KEY = 'zgcombat_progress_v1'

function load () {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {}
  } catch (e) {
    return {}
  }
}

function save (data) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data))
  } catch (e) { /* 隐私模式或配额满，忽略 */ }
}

const LocalProgress = {
  // 标记某关通关（按 slug）
  markComplete (slug, original) {
    if (!slug) { return }
    const data = load()
    data.completed = data.completed || {}
    data.completed[slug] = { original, complete: true }
    save(data)
  },

  getCompleted () {
    return (load().completed) || {}
  },

  // 把若干关卡 original 加入「已解锁」集合（去重）
  addUnlocked (originals) {
    if (!originals || !originals.length) { return }
    const data = load()
    data.unlocked = data.unlocked || []
    for (const o of originals) {
      if (o && !data.unlocked.includes(o)) { data.unlocked.push(o) }
    }
    save(data)
  },

  getUnlocked () {
    return (load().unlocked) || []
  },

  // 记录某关获得的经验/宝石（按 original 去重：重玩同关不重复累计）
  addReward (original, xp, gems) {
    if (!original) { return }
    const data = load()
    data.rewards = data.rewards || {}
    data.rewards[original] = { xp: xp || 0, gems: gems || 0 }
    save(data)
  },

  // 汇总全部已得经验/宝石（供头部显示）
  getRewards () {
    const rewards = (load().rewards) || {}
    let xp = 0; let gems = 0
    for (const k of Object.keys(rewards)) {
      xp += (rewards[k].xp || 0)
      gems += (rewards[k].gems || 0)
    }
    return { xp, gems }
  },

  // 调试/重置用
  clear () {
    try { window.localStorage.removeItem(KEY) } catch (e) {}
  }
}

module.exports = LocalProgress
