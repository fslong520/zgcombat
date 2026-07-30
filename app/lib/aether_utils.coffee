require './aether/aether.coffee'

Aether.addGlobal 'Vector', require './world/vector'
Aether.addGlobal '_', _
translateUtils = require './translate-utils'

module.exports.createAetherOptions = (options) ->
  throw new Error 'Specify a function name to create an Aether instance' unless options.functionName
  throw new Error 'Specify a code language to create an Aether instance' unless options.codeLanguage

  aetherOptions =
    functionName: options.functionName
    protectAPI: not options.skipProtectAPI
    includeFlow: Boolean options.includeFlow
    noVariablesInFlow: true
    skipDuplicateUserInfoInFlow: true  # Optimization that won't work if we are stepping with frames
    yieldConditionally: options.functionName is 'plan'
    simpleLoops: true
    whileTrueAutoYield: true
    globals: ['Vector', '_']
    problems:
      jshint_W040: {level: 'ignore'}
      jshint_W041: {level: 'ignore'}  # "Use '===' to compare with 'null'." is too picky, especially in CCJ and when Blockly auto-gens this
      jshint_W030: {level: 'ignore'}  # aether_NoEffect instead
      jshint_W038: {level: 'ignore'}  # eliminates hoisting problems
      jshint_W091: {level: 'ignore'}  # eliminates more hoisting problems
      jshint_E043: {level: 'ignore'}  # https://github.com/codecombat/codecombat/issues/813 -- since we can't actually tell JSHint to really ignore things
      jshint_Unknown: {level: 'ignore'}  # E043 also triggers Unknown, so ignore that, too
      aether_MissingThis: {level: 'error'}
    problemContext: options.problemContext
    #functionParameters: # TODOOOOO
    executionLimit: options.executionLimit or 3 * 1000 * 1000
    language: if options.codeLanguage in ['java', 'cpp'] then 'javascript' else options.codeLanguage
    useInterpreter: true
  parameters = functionParameters[options.functionName]
  unless parameters
    console.warn "Unknown method #{options.functionName}: please add function parameters to lib/aether_utils.coffee."
    parameters = []
  if options.functionParameters and not _.isEqual options.functionParameters, parameters
    console.error "Update lib/aether_utils.coffee with the right function parameters for #{options.functionName} (had: #{parameters} but this gave #{options.functionParameters}."
    parameters = options.functionParameters
  aetherOptions.functionParameters = parameters.slice()
  #console.log 'creating aether with options', aetherOptions
  return aetherOptions

# TODO: figure out some way of saving this info dynamically so that we don't have to hard-code it: #1329
functionParameters =
  hear: ['speaker', 'message', 'data']
  makeBid: ['tileGroupLetter']
  findCentroids: ['centroids']
  isFriend: ['name']
  evaluateBoard: ['board', 'player']
  getPossibleMoves: ['board']
  minimax_alphaBeta: ['board', 'player', 'depth', 'alpha', 'beta']
  distanceTo: ['target']

  chooseAction: []
  plan: []
  initializeCentroids: []
  update: []
  getNearestEnemy: []
  die: []

# ---- Java/C++ 翻译层（替代 kodekeeper 服务） ----
# 内部部署中 kodekeeper（AWS API）不可达。将 Java/C++ 转译成合规 JavaScript，
# 由 Aether 原生处理。保留语法结构，不做简单剥除。
javaCppToJS = (source, language) ->
  s = source
  indent = ''

  # --- 1. 预处理：统一换行，标记行号辅助调试 ---
  s = s.replace /\r\n?/g, '\n'

  # --- 2. 提取并保留注释（不处理块注释内的代码）---
  # 先替换块注释为占位，避免正则误伤
  blockComments = []
  s = s.replace /\/\*[\s\S]*?\*\//g, (m) ->
    blockComments.push m
    "/*BLOCK_COMMENT_#{blockComments.length-1}*/"

  # --- 3. 去掉 main/类包裹，但保留其内部代码 ---
  # C++: int main() / void main(...) { ... }
  if language is 'cpp'
    s = s.replace /(?:int|void)\s+main\s*\([^)]*\)\s*\{/g, ''
  # Java: public static void main(String[] args) { ... }
  if language is 'java'
    s = s.replace /(?:public\s+)?(?:static\s+)?(?:void|int|String|boolean|float|double)\s+main\s*\(String\[\]\s*\w*\)\s*\{/g, ''
    # Java 类声明：public class Foo ... { ... }
    s = s.replace /(?:public\s+)?(?:abstract\s+)?(?:class|interface|struct)\s+\w+(?:\s*extends\s+\w+)?(?:\s*implements\s+[\w,\s]+)?\s*\{/g, ''

  # --- 4. 翻译变量声明 ---
  # int x = 5;  → var x = 5;
  # String name = "hello"; → var name = "hello";
  # boolean flag = true; → var flag = true;
  # float/double d = 3.14; → var d = 3.14;
  # int[] arr = new int[5]; → var arr = new Array(5);
  # int[] arr = {1,2,3}; → var arr = [1,2,3];
  # 数组声明 int[] arr → var arr
  s = s.replace /\b(int|long|short|char|byte|float|double|boolean|String|auto|unsigned|signed)\b\s*(\[\])?/g, 'var$2'

  # --- 5. 翻译方法声明 ---
  # public void foo(int x, String y) { ... } → function foo(x, y) { ... }
  # public int add(int a, int b) → function add(a, b)
  # private boolean canAttack() → function canAttack()
  s = s.replace /(?:public|private|protected|static|virtual|override|final|abstract|synchronized|transient|volatile|native|strictfp\s+)*(?:void|int|String|boolean|float|double|long|short|char|byte|var)\s+/g, (m, offset, str) ->
    # 检查后面是否跟着一个标识符和左括号（方法声明）还是变量名（变量声明）
    rest = str.slice offset + m.length
    if /^\w+\s*\(/.test rest
      # 是方法声明 → function
      return 'function '
    else
      # 是变量声明（已在第4步处理过，这里去掉多余的访问修饰符）
      return '' if /^(public|private|protected|static|final|abstract)\b/.test m.trim()
      return m

  # 去掉方法参数中的类型：void foo(int x, String y) → function foo(x, y)
  # 匹配函数参数列表内部的类型关键字
  s = s.replace /(function\s+\w+\s*\()([^)]*)\)/g, (m, prefix, params) ->
    cleaned = params.replace /\b(int|long|short|char|byte|float|double|boolean|String|var|const|unsigned|signed|\[\])\b\s*/g, ''
    cleaned = cleaned.replace /\s*,\s*/g, ', '
    "#{cleaned})"

  # --- 6. 翻译循环/条件中的变量声明 ---
  # for (int i = 0; ...) → for (var i = 0; ...)
  s = s.replace /\b(for|while)\s*\(/g, (m) -> "#{m.replace /\b(int|long|short|char|byte|float|double|boolean|String|var)\b/g, 'var'}"
  # catch (Exception e) → catch (e)
  s = s.replace /\bcatch\s*\(\s*\w+\s+(\w+)\s*\)/g, 'catch ($1)'

  # --- 7. 翻译方法链调用中的类型转换（Java 特有）---
  # (int) someValue → parseInt(someValue)
  # (float) someValue → parseFloat(someValue)
  # (String) someObj → String(someObj)
  s = s.replace /\(int\)\s*/g, 'parseInt('
  s = s.replace /\(float\)\s*/g, 'parseFloat('
  s = s.replace /\(double\)\s*/g, 'parseFloat('
  s = s.replace /\(String\)\s*/g, 'String('
  s = s.replace /\(boolean\)\s*/g, 'Boolean('
  s = s.replace /\(char\)\s*/g, 'String.fromCharCode('

  # --- 8. 数组声明 new type[size] → new Array(size) ---
  s = s.replace /\bnew\s+(int|long|short|char|byte|float|double|boolean|String)\s*\[(\w+)\]/g, 'new Array($2)'

  # --- 9. 处理 System.out.println / System.out.print ---
  s = s.replace /\bSystem\.out\.println\s*\(/g, 'console.log('
  s = s.replace /\bSystem\.out\.print\s*\(/g, 'console.log('

  # --- 10. Java 泛型擦除：List<String> list → list (类型已去掉) ---
  s = s.replace /<[^>]+>/g, ''

  # --- 11. 恢复块注释 ---
  s = s.replace /\/\*BLOCK_COMMENT_(\d+)\*\//g, (m, idx) -> blockComments[parseInt idx] or m

  # --- 12. 去掉 main/类对应的多余闭合括号 ---
  # 去掉末尾孤立的 }
  s = s.replace /\n\}\s*$/g, ''
  # 去掉空行中残留的 }（类/方法闭合）
  s = s.replace /^\s*\}\s*$/gm, ''

  # --- 13. 压缩多余空行 ---
  s = s.replace /\n{4,}/g, '\n\n\n'

  s = s.trim()
  if s.length is 0 then s = ';'
  return s

module.exports.fetchToken = (source, language) =>
  if language not in ['java', 'cpp'] or /^\u56E7[a-zA-Z0-9+/=]+\f$/.test source
    return Promise.resolve(source)

  # 先试 kodekeeper（在线 AST 解析），失败则走客户端翻译
  headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' }
  service = window?.localStorage?.kodeKeeperService or "https://asm14w94nk.execute-api.us-east-1.amazonaws.com/service/parse-code-kodekeeper"
  fetch service, {method: 'POST', mode:'cors', headers:headers, body:JSON.stringify({code: source, language: language})}
    .then (x) =>
      if !x.ok then throw new Error("kodekeeper status #{x.status}")
      x.json()
    .then (x) =>
      if x?.token then return x.token
      throw new Error('kodekeeper returned no token')
    .catch (e) =>
      console.warn '[aether_utils] kodekeeper failed, fallback to client translation:', e?.message or e
      # 客户端翻译兜底
      try
        translated = javaCppToJS source, language
        console.log '[aether_utils] client translated:', translated
        return translated
      catch e2
        console.error '[aether_utils] client translation also failed:', e2
        throw e2

module.exports.generateSpellsObject = (options) ->
  {level, levelSession, token} = options
  aetherOptions = module.exports.createAetherOptions functionName: 'plan', codeLanguage: levelSession.get('codeLanguage'), skipProtectAPI: options.level?.isType('game-dev')
  if level?.get('product') is 'codecombat-junior'
    aetherOptions.executionLimit = 100 * 1000  # Junior levels shouldn't use as many statements, can exceed execution limit earlier (100K) than normal levels (default 3M)
  spellThang = thang: {id: 'Hero Placeholder'}, aether: new Aether aetherOptions
  spells = "hero-placeholder/plan": thang: spellThang, name: 'plan'
  source = token or levelSession.get('code')?['hero-placeholder']?.plan ? ''
  try
    spellThang.aether.transpile source
  catch e
    console.log "Couldn't transpile!\n#{source}\n", e
    spellThang.aether.transpile ''
  spells

module.exports.replaceSimpleLoops = (source, language) ->
  switch language
    when 'python' then source.replace /loop:/, 'while True:'
    when 'javascript', 'java', 'cpp' then source.replace /loop {/, 'while (true) {'
    when 'lua' then source.replace /loop\n/, 'while true do\n'
    when 'coffeescript' then source
    else source

startsWithVowel = (s) -> s[0] in 'aeiouAEIOU'

module.exports.filterMarkdownCodeLanguages = (text, language) ->
  return '' unless text
  currentLanguage = language or me.get('aceConfig')?.language or 'python'
  excludeCpp = 'cpp'
  unless /```cpp\n[^`]+```\n?/.test text
    excludeCpp = 'javascript'
  excludedLanguages = _.without ['javascript', 'python', 'coffeescript', 'lua', 'java', 'cpp', 'html', 'io', 'clojure'], if currentLanguage == 'cpp' then excludeCpp else currentLanguage
  # Exclude language-specific code blocks like ```python (... code ...)``
  # ` for each non-target language.
  codeBlockExclusionRegex = new RegExp "```(#{excludedLanguages.join('|')})\n[^`]+```\n?", 'gm'
  # Exclude language-specific images like ![python - image description](image url) for each non-target language.
  imageExclusionRegex = new RegExp "!\\[(#{excludedLanguages.join('|')}) - .+?\\]\\(.+?\\)\n?", 'gm'
  text = text.replace(codeBlockExclusionRegex, '').replace(imageExclusionRegex, '')

  commonLanguageReplacements =
    python: [
      ['true', 'True'], ['false', 'False'], ['null', 'None'],
      ['object', 'dictionary'], ['Object', 'Dictionary'],
      ['array', 'list'], ['Array', 'List'],
    ]
    lua: [
      ['null', 'nil'],
      ['object', 'table'], ['Object', 'Table'],
      ['array', 'table'], ['Array', 'Table'],
    ]
  for [from, to] in commonLanguageReplacements[currentLanguage] ? []
    # Convert JS-specific keywords and types to Python ones, if in simple `code` tags.
    # This won't cover it when it's not in an inline code tag by itself or when it's not in English.
    text = text.replace ///`#{from}`///g, "`#{to}`"
    # Now change "An `dictionary`" to "A `dictionary`", etc.
    if startsWithVowel(from) and not startsWithVowel(to)
      text = text.replace ///(\ a|A)n(\ `#{to}`)///g, "$1$2"
    if not startsWithVowel(from) and startsWithVowel(to)
      text = text.replace ///(\ a|A)(\ `#{to}`)///g, "$1n$2"
  if currentLanguage == 'cpp' and excludeCpp == 'javascript'
    jsRegex = new RegExp "```javascript\n([^`]+)```", 'gm'
    text = text.replace jsRegex, (a, l) =>
      """```cpp
        #{translateUtils.translateJS a[13..a.length-4], 'cpp', false}
      ```"""

  return text

makeErrorMessageTranslationRegex = (englishString) ->
  escapeRegExp = (str) ->
    # https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&")
  new RegExp(escapeRegExp(englishString).replace(/\\\$\d/g, '(.+)').replace(/ +/g, ' +'))

module.exports.translateErrorMessage = ({ message, errorCode, i18nParams, spokenLanguage, staticTranslations, translateFn }) ->
  # Here we take a string from the locale file, find the placeholders ($1/$2/etc)
  #   and replace them with capture groups (.+),
  # returns a regex that will match against the error message
  #   and capture any dynamic values in the text
  # staticTranslations is { langCode: translations } for en and target languages
  # translateFn(i18nKey, i18nParams) is $.i18n.t on the client, i18next.t on the server
  return message if not message
  if /\n/.test(message) # Translate each line independently, since regexes act weirdly with newlines
    return message.split('\n').map((line) -> module.exports.translateErrorMessage({ message: line.trim(), errorCode, i18nParams, spokenLanguage, staticTranslations, translateFn })).join('\n')

  if /^i18n::/.test(message) # handle i18n messages from aether_worker
    messages = message.split('::')
    return translateFn(messages[1], JSON.parse(messages[2]))

  message = message.replace /([A-Za-z]+Error:) \1/, '$1'
  return message if spokenLanguage in ['en', 'en-US']

  # Separately handle line number and error type prefixes
  applyReplacementTranslation = (text, regex, key) =>
    fullKey = "esper.#{key}"
    replacementTemplate = translateFn(fullKey)
    return if replacementTemplate is fullKey
    # This carries over any capture groups from the regex into $N placeholders in the template string
    replaced = text.replace regex, replacementTemplate
    if replaced isnt text
      return [replaced.replace(/``/g, '`'), true]
    return [text, false]

  # These need to be applied in this order, before the main text is translated
  prefixKeys = ['line_no', 'uncaught', 'reference_error', 'argument_error', 'type_error', 'syntax_error', 'error']

  messages = message.split(': ')
  for i of messages
    m = messages[i]
    m += ': ' unless +i == messages.length - 1 # i is string
    for keySet in [prefixKeys, Object.keys(_.omit(staticTranslations.en.esper), prefixKeys)]
      for translationKey in keySet
        englishString = staticTranslations.en.esper[translationKey]
        regex = makeErrorMessageTranslationRegex englishString
        [m, didTranslate] = applyReplacementTranslation m, regex, translationKey
        break if didTranslate and keySet isnt prefixKeys
    messages[i] = m

  if errorCode
    messages[messages.length - 1] = translateFn("esper.error_#{(_.string || _.str).underscored(errorCode)}", i18nParams)

  messages.join('')
