require('app/styles/play/level/tome/cast_button.sass')
CocoView = require 'views/core/CocoView'
template = require 'app/templates/play/level/tome/cast-button-view'
{me} = require 'core/auth'
LadderSubmissionView = require 'views/play/common/LadderSubmissionView'
LevelSession = require 'models/LevelSession'
async = require('vendor/scripts/async.js')
utils = require('core/utils')

module.exports = class CastButtonView extends CocoView
  id: 'cast-button-view'
  template: template

  events:
    'click .cast-button': 'onCastButtonClick'
    'click .submit-button': 'onCastRealTimeButtonClick'
    'click .done-button': 'onDoneButtonClick'
    'click .game-dev-play-btn': 'onClickGameDevPlayButton'

  subscriptions:
    'tome:spell-changed': 'onSpellChanged'
    'tome:cast-spells': 'onCastSpells'
    'tome:manual-cast-denied': 'onManualCastDenied'
    'god:new-world-created': 'onNewWorld'
    'goal-manager:new-goal-states': 'onNewGoalStates'
    'god:goals-calculated': 'onGoalsCalculated'
    'playback:ended-changed': 'onPlaybackEndedChanged'
    'playback:playback-ended': 'onPlaybackEnded'

  constructor: (options) ->
    super options
    @spells = options.spells
    @castShortcut = '⇧↵'
    @updateReplayabilityInterval = setInterval @updateReplayability, 1000
    @observing = options.session.get('creator') isnt me.id
    # WARNING: CourseVictoryModal does not handle mirror sessions when submitting to ladder; adjust logic if a
    # mirror level is added to
    # Keep server/middleware/levels.coffee mirror list in sync with this one
    @loadMirrorSession() if @options.level.get('mirrorMatch')
    @mirror = @mirrorSession?
    @autoSubmitsToLadder = @options.level.isType('course-ladder')  # type 'ladder' will do a lot of work on submit, so don't auto-submit
    # Show publish CourseVictoryModal if they've already published
    if options.session.get('published')
      Backbone.Mediator.publish 'level:show-victory', { showModal: true, manual: false }

  destroy: ->
    clearInterval @updateReplayabilityInterval
    super()

  afterRender: ->
    super()
    @castButton = $('.cast-button', @$el)
    spell.view?.createOnCodeChangeHandlers() for spellKey, spell of @spells
    if @options.level.get('hidesSubmitUntilRun') or @options.level.get('hidesRealTimePlayback') or @options.level.isType('web-dev')
      @$el.find('.submit-button').hide()  # Hide Submit for the first few until they run it once.
    if @options.session.get('state')?.complete and (@options.level.get('hidesRealTimePlayback') or @options.level.isType('web-dev'))
      @$el.find('.done-button').show()
    if @options.level.get('slug') in ['course-thornbush-farm', 'thornbush-farm']
      @$el.find('.submit-button').hide()  # Hide submit until first win so that script can explain it.
    @updateButtonWidth()
    @updateReplayability()
    @updateLadderSubmissionViews()
    @$el.find('.done-button').show()  # OJ 风格：完成（提交）按钮常显，手动触发胜利/下一关

  attachTo: (spellView) ->
    @$el.detach().prependTo(spellView.toolbarView.$el).show()
    @updateButtonWidth()

  castShortcutVerbose: ->
    shift = $.i18n.t 'keyboard_shortcuts.shift'
    enter = $.i18n.t 'keyboard_shortcuts.enter'
    "#{shift}+#{enter}"

  castVerbose: ->
    @castShortcutVerbose() + ': ' + $.i18n.t('keyboard_shortcuts.run_code')

  castRealTimeVerbose: ->
    castRealTimeShortcutVerbose = (if @isMac() then 'Cmd' else 'Ctrl') + '+' + @castShortcutVerbose()
    castRealTimeShortcutVerbose + ': ' + $.i18n.t('keyboard_shortcuts.run_real_time')

  onCastButtonClick: (e) ->
    Backbone.Mediator.publish 'tome:manual-cast', {realTime: false}
    Backbone.Mediator.publish 'level:close-solution', {}

  onCastRealTimeButtonClick: (e) ->
    if @options.level.get('replayable') and (timeUntilResubmit = @options.session.timeUntilResubmit()) > 0
      Backbone.Mediator.publish 'tome:manual-cast-denied', timeUntilResubmit: timeUntilResubmit
    else
      Backbone.Mediator.publish 'tome:manual-cast', {realTime: true}
    @updateReplayability()

  onClickGameDevPlayButton: ->
    Backbone.Mediator.publish 'tome:manual-cast', {realTime: true}

  onDoneButtonClick: (e) ->
    return if @options.level.hasLocalChanges()  # Don't award achievements when beating level changed in level editor
    if @winnable
      @proceedDone()
    else
      # 尚未判定通关：先运行代码，由 onNewGoalStates / onPlaybackEnded 判定结果
      @pendingDone = true
      noty text: '正在运行代码以判定是否通关…', type: 'info', timeout: 2500, killer: false
      Backbone.Mediator.publish 'tome:manual-cast', { realTime: false }

  # 确属通关：记录、持久化、发奖、解锁下一关、弹胜利窗
  proceedDone: ->
    @doneVictoryPublished = true  # 防止 onPlaybackEnded 重复弹窗
    @markLevelCompleted()
    Backbone.Mediator.publish 'level:show-victory', { showModal: true, manual: true }

  # 幂等：标记本关已通关并存档、发奖、解锁下一关。仅首次(未 complete)执行，回放不重复发奖
  markLevelCompleted: ->
    slug = @options.level.get('slug')
    original = @options.level.get('original') or @options.level.id
    campaignSlug = @options.level.get('campaign')
    # 已通关的 session：会话 complete 可能由 LevelBus.onVictory 抢先落库（自然胜利路径），
    # 此时 markComplete/addUnlocked/解锁下一关未执行。匿名用户完成标记唯赖 localStorage，
    # 故此处无条件补写（覆盖写/去重，幂等安全），并补拉物品奖励、补解锁下一关。
    # 登录用户奖励与关卡解锁由服务端发放（grantLevelRewards 写 earned.*）。
    if @options.session.get('state')?.complete
      if me.isLocalProgressUser()
        LocalProgress = require 'lib/localProgress'
        LocalProgress.markComplete(slug, original)
        LocalProgress.addUnlocked([original])
        @grantAnonRewards(original)
        @unlockNextLevel(campaignSlug, original)
      return
    LocalProgress = require 'lib/localProgress'
    @options.session.recordScores @world?.scores, @options.level
    state = Object.assign {}, (@options.session.get('state') or {}), { complete: true }
    @options.session.set 'state', state
    # 补全 level 引用：成就 query 校验 session.level.original，而本部署 session 仅存 levelID，
    # 致 HeroVictoryModal 中 matchesQuery 恒失败、通关弹窗不显 XP/宝石/成就。此处补 original，
    # 既入内存供弹窗即时判定，亦随 save 落盘。
    @options.session.set 'level', { original: original }
    # 补全 levelID：地图(levelStatusMap)以 session.levelID(=slug) 标记关卡完成。
    # 新 session 无 id 时 LevelLoader.denormalizeSession 会跳过（不写 levelID），
    # 致通关后地图上该关不显示"已完成"。此处显式补写，随 save 落盘。
    @options.session.set 'levelID', slug
    # 补全 campaign：session 常缺此字段，后端 persistLevelSession 需 campaign 才能
    # 解析下一关并加入 earned.levels（缺则只加本关 → 主线下一关永不解锁）。
    @options.session.set 'campaign', campaignSlug if campaignSlug
    # 补全 creator：session 自服务端加载时恒为 {}（/db/level/:id/session 路由仅查 level
    # 文档，不查 session），无 creator 字段。后端 persistLevelSession 中 creator 缺位
    # 致 grantLevelRewards 直接返回，通关奖励（XP/宝石/成就）永不发放。此处补当前用户。
    # 注意：须强制覆盖而非「unless 存在」——转储 level 文档自带关卡作者 creator（如
    # 5818...），若 session 误加载了它，旧值会令保存归属错误用户、解锁/发奖全失效。
    @options.session.set 'creator', me.id
    # 跳过 tv4 校验：c.object 默认 additionalProperties:false，session 客户端字段
    # （state/level 等动态字段）致 49 条校验错、save 被拦、发奖 POST 永不触发。
    # 数据本身合法（落盘后复验 0 错），仅客户端多出字段，故发奖存档跳过校验。
    @options.session.save(null, { validate: false })  # 后端据 level.session 通关事件发 XP/宝石(登录) + 解锁
    if me.isLocalProgressUser()
      LocalProgress.markComplete(slug, original)
      LocalProgress.addUnlocked([original])
      # 游客/匿名用户：本关 XP/宝石/物品累计入缓存，并即时刷新头部。
      # 注意：须用 isLocalProgressUser 而非 isAnonymous——匿名用户的 anonymous 字段
      # 会被服务端 PUT/PATCH /db/user/:id 覆盖为 false，isAnonymous() 失效，导致
      # grantAnonRewards 不执行 → 经验/宝石不累加、物品不进仓库。
      @grantAnonRewards(original)
    @unlockNextLevel(campaignSlug, original)

  # 拉取本战役直接后继并加入已解锁集合（仅 next.original，不批量 allLevels）。
  # 登录用户跳过：earned.levels 由服务端发放，本地写入无意义。
  unlockNextLevel: (campaignSlug, original) ->
    return unless campaignSlug and original
    return unless me.isLocalProgressUser()
    LocalProgress = require 'lib/localProgress'
    $.ajax
      url: "/db/campaign/#{campaignSlug}/levels/#{original}/next"
      method: 'GET'
      success: (next) ->
        return unless next
        if next.original
          LocalProgress.addUnlocked([next.original])
      error: -> # 后端路由缺失则忽略，已通本关仍可解锁

  # 匿名用户：拉取本关关联成就的 worth(xp)、rewards.gems 与 rewards.items，累计到缓存并刷新头部
  grantAnonRewards: (original) ->
    return unless original
    LocalProgress = require 'lib/localProgress'
    $.ajax
      url: "/db/achievement?related=#{original}"
      method: 'GET'
      success: (achs) ->
        xp = 0; gems = 0; items = []
        for a in (achs or [])
          xp += (a.worth or 0)
          gems += ((a.rewards and a.rewards.gems) or 0)
          for it in ((a.rewards and a.rewards.items) or [])
            items.push(it) if it and items.indexOf(it) < 0
        LocalProgress.addReward(original, xp, gems, items)
        if me.isLocalProgressUser()
          r = LocalProgress.getRewards()
          earned = me.get('earned') or {}
          me.set { points: r.xp, earned: _.extend({}, earned, { gems: r.gems, items: LocalProgress.getItems() }) }
      error: -> # 忽略；成就面板仍会显奖励

  onSpellChanged: (e) ->
    @updateCastButton()

  onCastSpells: (e) ->
    return if e.preload
    @casting = true
    if @hasStartedCastingOnce  # Don't play this sound the first time
      @playSound 'cast', 0.5 unless @options.level.isType('game-dev')
    @hasStartedCastingOnce = true
    @updateCastButton()

  onManualCastDenied: (e) ->
    wait = moment().add(e.timeUntilResubmit, 'ms').fromNow()
    #@playSound 'manual-cast-denied', 1.0   # find some sound for this?
    noty text: "You can try again #{wait}.", layout: 'center', type: 'warning', killer: false, timeout: 6000

  onNewWorld: (e) ->
    @casting = false
    if @hasCastOnce  # Don't play this sound the first time
      @playSound 'cast-end', 0.5 unless @options.level.isType('game-dev')
      # Worked great for live beginner tournaments, but probably annoying for asynchronous tournament mode.
      myHeroID = if me.team is 'ogres' then 'Hero Placeholder 1' else 'Hero Placeholder'
      shouldAutoSubmit = @autoSubmitsToLadder or (@options.level.isType('ladder') and not @options.session.get('submitDate') and not @autosubmittedOnce)
      shouldAutoSubmit &&= not e.world.thangMap[myHeroID]?.errorsOut and not me.get('anonymous')
      if shouldAutoSubmit
        @autosubmittedOnce = true
        _.delay (=> @ladderSubmissionView?.rankSession()), 1000 if @ladderSubmissionView
    @hasCastOnce = true
    @updateCastButton()
    @world = e.world

  onPlaybackEnded: (e) ->
    if @pendingDone and not @winnable
      @pendingDone = false
      noty text: '代码尚未通关，请调整方案后再试。', type: 'warning', timeout: 3000, killer: false
      return
    return unless @winnable
    return if @options.level.get('ozariaType') is 'capstone'
    # 若本次胜利由「完成」按钮的待定运行触发，proceedDone 已弹窗，避免重复
    if @doneVictoryPublished
      @doneVictoryPublished = false
      return
    # 自动通关（运行即胜）亦须标记完成、发奖、解锁，否则奖励面板不显
    @markLevelCompleted()
    Backbone.Mediator.publish 'level:show-victory', { showModal: true, manual: true }

  onNewGoalStates: (e) ->
    winnable = e.overallStatus is 'success'
    return if @winnable is winnable
    @winnable = winnable
    @$el.toggleClass 'winnable', @winnable
    Backbone.Mediator.publish 'tome:winnability-updated', winnable: @winnable, level: @options.level
    if @pendingDone and @winnable
      @pendingDone = false
      @doneVictoryPublished = true
      @proceedDone()
      return
    if @options.level.get('slug') in ['resource-tycoon']
      null  # No "Done" button for standalone tournament game-dev project levels outside of a campaign
    else if @options.level.get('hidesRealTimePlayback') or @options.level.isType('web-dev', 'game-dev')
      @$el.find('.done-button').show()  # OJ 风格：完成（提交）按钮常显，手动触发
    else if @winnable and @options.level.get('slug') in ['course-thornbush-farm', 'thornbush-farm']
      @$el.find('.submit-button').show()  # Hide submit until first win so that script can explain it.
    @updateButtonWidth()

  onGoalsCalculated: (e) ->
    # When preloading, with real-time playback enabled, we highlight the submit button when we think they'll win.
    return unless e.god is @god
    return unless e.preload
    return if @options.level.get 'hidesRealTimePlayback'
    return if @options.level.get('slug') in ['course-thornbush-farm', 'thornbush-farm']  # Don't show it until they actually win for this first one.
    @onNewGoalStates e

  onPlaybackEndedChanged: (e) ->
    return unless e.ended and @winnable
    @$el.toggleClass 'has-seen-winning-replay', true

  updateCastButton: ->
    return if _.some @spells, (spell) => not spell.loaded

    # TODO: performance: Get rid of async since this is basically the ONLY place we use it
    async.some _.values(@spells), (spell, callback) =>
      spell.hasChangedSignificantly spell.getSource(), null, callback
    , (castable) =>
      Backbone.Mediator.publish 'tome:spell-has-changed-significantly-calculation', hasChangedSignificantly: castable
      @castButton.toggleClass('castable', castable).toggleClass('casting', @casting)
      if @casting
        castText = $.i18n.t('play_level.tome_cast_button_running')
      else if castable or true
        castText = $.i18n.t('play_level.tome_cast_button_run')
        unless @options.level.get 'hidesRunShortcut'  # Hide for first few.
          castText += ' ' + @castShortcut
      else
        castText = $.i18n.t('play_level.tome_cast_button_ran')
      @castButton.text castText unless @options.level.get('product') is 'codecombat-junior'
      #@castButton.prop 'disabled', not castable
      @ladderSubmissionView?.updateButton()

  updateButtonWidth: ->
    numVisibleButtons = @$el.find('.btn:visible').length
    @castButton.add('.game-dev-play-btn').toggleClass 'full-width', numVisibleButtons is 1

  updateReplayability: =>
    return if @destroyed
    return unless @options.level.get 'replayable'
    timeUntilResubmit = @options.session.timeUntilResubmit()
    disabled = timeUntilResubmit > 0
    submitButton = @$el.find('.submit-button').toggleClass('disabled', disabled)
    submitAgainLabel = submitButton.find('.submit-again-time').toggleClass('secret', not disabled)
    if disabled
      waitTime = moment().add(timeUntilResubmit, 'ms').fromNow()
      submitAgainLabel.text waitTime

  loadMirrorSession: ->
    # Future work would be to only load this the first time we are going to submit (or auto submit), so that if we write some code but don't submit it, the other session can still initialize itself with it.
    url = "/db/level/#{@options.level.get('slug') or @options.level.id}/session"
    url += "?team=#{if me.team is 'humans' then 'ogres' else 'humans'}"
    mirrorSession = new LevelSession().setURL url
    @mirrorSession = @supermodel.loadModel(mirrorSession, {cache: false}).model
    @listenToOnce @mirrorSession, 'sync', ->
      @ladderSubmissionView?.mirrorSession = @mirrorSession

  updateLadderSubmissionViews: ->
    @removeSubView subview for key, subview of @subviews when subview instanceof LadderSubmissionView
    placeholder = @$el.find('.ladder-submission-view')
    return unless placeholder.length
    @ladderSubmissionView = new LadderSubmissionView session: @options.session, level: @options.level, mirrorSession: @mirrorSession
    @insertSubView @ladderSubmissionView, placeholder
