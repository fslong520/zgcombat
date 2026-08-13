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

  # --- 2.5 C++ 行注释用 //；部分关卡初始代码/玩家代码用 #（Python 风格），# 在 C++ 是
  # 预处理指令，会报 "invalid preprocessing directive" 之类错误。把 # 行注释
  # （#include/#define/#if/#ifdef/#ifndef/#else/#elif/#endif/#undef/#pragma 等预处理保留）
  # 转成 //。块注释已占位，不受影响。旧正则只匹配行首无缩进的 "# 注释"：
  # 块内（while/if 等缩进区域）的 "# 注释"、# 后无空格的 "#注释"、以及语句后的
  # 行内 "# 注释" 都会漏网 → 转 JS 后残留裸 # → esprima 报 SyntaxError。
  # 新正则保留缩进、放行预处理指令；字符串字面量先占位，避免误伤 "a # b"。
  strings = []
  s = s.replace /"(?:[^"\n\\]|\\.)*"|'(?:[^'\n\\]|\\.)*'/g, (m) ->
    strings.push m
    "STRING_#{strings.length-1}"
  preprocessorDirectives = ['include', 'define', 'undef', 'if', 'ifdef', 'ifndef', 'else', 'elif', 'endif', 'error', 'pragma', 'line', 'import', 'using', 'once', 'warning']
  s = s.replace /^(\s*)#\s*(\w+)?\s*([^\n]*)$/gm, (m, ws, kw, rest) ->
    if kw and kw in preprocessorDirectives then m else "#{ws}// #{rest.trim()}"
  s = s.replace /([^#\w'"])\s*#\s+([^\n]*?)\s*$/gm, (m, pre, comment) ->
    "#{pre} // #{comment}"

  # --- 3. 去掉 main/类包裹的声明前缀，但保留其 { } 配对 ---
  # 注意：不能替换成裸 `{`（顶层块会被 JSHint 误判为对象字面量，
  # C++ 的 while/if 等关键字当属性名报 W095 "Expected a string and instead saw while."）。
  # 用恒真 if (1) 包裹：JSHint/esprima/esper 均视为合法顶层语句块。
  # 前缀 /*__MAIN__*/ 块注释：GoalManager.countEffectiveLines 的 /^\/\*/ 规则自动跳过该行，
  # 使行数目标统计不受 main 包裹污染（此前转译后 if (1) 被计 1 行，3 语句计成 4）。
  # C++: int main() / void main(...) { ... }
  if language is 'cpp'
    s = s.replace /(?:int|void)\s+main\s*\([^)]*\)\s*(\{)/g, '/*__MAIN__*/ if (1) $1'
  # Java: public static void main(String[] args) { ... }
  if language is 'java'
    s = s.replace /(?:public\s+)?(?:static\s+)?(?:void|int|String|boolean|float|double)\s+main\s*\(String\[\]\s*\w*\)\s*(\{)/g, '/*__MAIN__*/ if (1) $1'
    # Java 类声明：public class Foo ... { ... }
    s = s.replace /(?:public\s+)?(?:abstract\s+)?(?:class|interface|struct)\s+\w+(?:\s*extends\s+\w+)?(?:\s*implements\s+[\w,\s]+)?\s*(\{)/g, '/*__MAIN__*/ if (1) $1'

  # --- 3.5 Java 泛型擦除：List<String> → List（须在类型替换之前，否则 <String> 里的
  # String 已被换成 var，正则不再匹配）---
  # 旧正则 <[^>]+> 会误删比较运算（if (a < b) 的 < b) 乃至 a < b && c > d），致括号残缺。
  # 新正则仅匹配类型参数形态（大写开头的类型名/参数名，逗号分隔，如 <String>、
  # <Integer, String>），不碰小写变量/数字/表达式的比较。菱形 <>（new ArrayList<>()）单独删除。
  # C++ 的 < > 是比较运算符，不擦除。
  if language is 'java'
    s = s.replace /<[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*>/g, ''
    s = s.replace /<>/g, ''

  # --- 4. 翻译变量声明 ---
  # int x = 5;  → var x = 5;
  # String name = "hello"; → var name = "hello";
  # boolean flag = true; → var flag = true;
  # float/double d = 3.14; → var d = 3.14;
  # int[] arr = new int[5]; → var arr = new Array(5);
  # int[] arr = {1,2,3}; → var arr = [1,2,3];
  # 数组声明 int[] arr → var arr
  # 注：替换须保留尾随空格，否则 `auto enemy1` 会被吞成 `varenemy1`（引用时未定义）
  # 保护 new 构造：new String(...) / new Integer(...) 不被类型替换误伤（JS 有原生 String）。
  # 占位符 __CTOR_X__ 两侧为下划线（单词字符），类型替换正则的 \b 边界不会命中其内部，
  # 步骤 11 恢复字符串后还原。
  s = s.replace /\bnew\s+(String|Integer|Boolean|Float|Double|Character)\s*\(/g, 'new __CTOR_$1__('
  # 先处理 new int[size] → new Array(size)，避免被下面的类型替换吞掉
  s = s.replace /\bnew\s+(int|long|short|char|byte|float|double|boolean|String)\s*\[(\w+)\]/g, 'new Array($2)'
  # 先处理复合类型：unsigned long long / long long / unsigned int 等整体替换，
  # 避免逐词替换产生 `var var x`（保留字错误）
  # 类型转换 (int)x / (float)y：括号形式不参与变量类型替换（否则变 (var)x）；
  # 此处直接转成 JS 转换调用 parseInt(x)（含闭合括号），随后的类型替换不会误伤。
  # 目标支持成员访问/下标：`(int) this.speed` → parseInt(this.speed)（旧 \w+ 只吃一个 token，
  # 会截断成 parseInt(this).speed）；`(int) arr[0]` → parseInt(arr[0])。`(int) x + 1` 的 + 1 不在捕获组（只转 x）。
  s = s.replace /\(int\)\s*([\w$]+(?:\.[\w$]+|\[[^\]]*\])*)/g, 'parseInt($1)'
  s = s.replace /\(float\)\s*([\w$]+(?:\.[\w$]+|\[[^\]]*\])*)/g, 'parseFloat($1)'
  s = s.replace /\(double\)\s*([\w$]+(?:\.[\w$]+|\[[^\]]*\])*)/g, 'parseFloat($1)'
  s = s.replace /\(String\)\s*([\w$]+(?:\.[\w$]+|\[[^\]]*\])*)/g, '__STRING_CAST__$1)'
  s = s.replace /\(boolean\)\s*([\w$]+(?:\.[\w$]+|\[[^\]]*\])*)/g, '__BOOLEAN_CAST__$1)'
  s = s.replace /\(char\)\s*([\w$]+(?:\.[\w$]+|\[[^\]]*\])*)/g, '__CHAR_CAST__$1)'
  s = s.replace /\b(?:unsigned\s+|signed\s+)?(?:long\s+long|short\s+int|long\s+int|long|short|int|char|byte|float|double|boolean|String|auto|unsigned|signed)\b\s*(\[\])?/g, (m, br) ->
    if br then "var#{br} " else 'var '
  s = s.replace /\bvar\[\]\s*/g, 'var '
  # C++ 指针/引用/const：int* x → var x（丢弃声明处的 * &）；const int x → var x。
  # `int* ptr = &x;` 的 &x 取址非声明位，前无 var/auto，不受影响（运行时无指针语义但语法合法）。
  s = s.replace /(var|auto)\s*\*\s*/g, 'var '
  s = s.replace /(var|auto)\s*&\s*/g, 'var '
  s = s.replace /\bconst\s+(var|auto)\b/g, '$1'
  # 数组初始化 int[] arr = {1,2,3} → var arr = [1,2,3]（C++ 花括号列表在 JS 中是块，需转方括号）
  s = s.replace /(\bvar\s+\w+\s*=\s*)\{([^{}]*)\}/g, '$1[$2]'
  # 泛型容器声明转 var：List names = / Map m = / ArrayList nums;（泛型已擦除，容器类名残留，
  # JS 无 List/Map 类型）。仅匹配「大写类名 + 空格 + 变量名 + (= 或 ;)」，
  # 不碰比较运算（A < B 的 < 后非空格标识符）、不碰方法声明（List getNames() 后是 ( 不是 =/;）
  if language is 'java'
    s = s.replace /\b[A-Z]\w*\s+([A-Za-z_$][\w$]*)\s*(?=[=;])/g, 'var $1'

  # --- 5. 翻译方法声明 ---
  # public void foo(int x, String y) { ... } → function foo(x, y) { ... }
  # public int add(int a, int b) → function add(a, b)
  # private boolean canAttack() → function canAttack()
  s = s.replace /(?:public\s+|private\s+|protected\s+|static\s+|virtual\s+|override\s+|final\s+|abstract\s+|synchronized\s+|transient\s+|volatile\s+|native\s+|strictfp\s+)*(?:void|int|String|boolean|float|double|long|short|char|byte|var)\s+/g, (m, offset, str) ->
    # 检查后面是否跟着一个标识符和左括号（方法声明）还是变量名（变量声明）
    rest = str.slice offset + m.length
    if /^\w+\s*\(/.test rest
      # 是方法声明 → function
      return 'function '
    else
      # 修饰符+变量声明：public var x = 5 → var x = 5（只删修饰符，保留 var，防隐式全局。
      # 旧逻辑整段返回 '' 会把 public var 全删，剩 x = 5; 隐式全局，esprima/strict 模式下报错）
      return m.replace /(?:public|private|protected|static|final|abstract|synchronized|transient|volatile|native)\s+/g, ''

  # 去掉方法参数中的类型：void foo(int x, String y) → function foo(x, y)
  # 匹配函数参数列表内部的类型关键字
  # 注：回调必须拼接 prefix（function foo(），此前漏拼导致方法声明被吞成参数残片
  s = s.replace /(function\s+\w+\s*\()([^)]*)\)/g, (m, prefix, params) ->
    cleaned = params.replace /\b(int|long|short|char|byte|float|double|boolean|String|var|const|unsigned|signed|\[\])\b\s*/g, ''
    cleaned = cleaned.replace /\s*,\s*/g, ', '
    "#{prefix}#{cleaned})"

  # --- 6. 翻译循环/条件中的变量声明 ---
  # for (int i = 0; ...) → for (var i = 0; ...)
  s = s.replace /\b(for|while)\s*\(/g, (m) -> "#{m.replace /\b(int|long|short|char|byte|float|double|boolean|String|var)\b/g, 'var'}"
  # Java for-each：for (Item item : items) { → for (const item of items) {（JS for-of）。
  # 仅匹配大写开头的类型名（Java 类型名惯例），`for (int i = 0; ...)` 不受影响。
  # (\s*\{)? 捕获保留原括号：无花括号的单语句体（for (Item x : xs) act();）不强行补 {，防括号不配
  s = s.replace /\bfor\s*\(\s*[A-Z]\w*\s+(\w+)\s*:\s*([\w$]+)\s*\)(\s*\{)?/g, 'for (const $1 of $2)$3'
  # catch (Exception e) → catch (e)
  s = s.replace /\bcatch\s*\(\s*\w+\s+(\w+)\s*\)/g, 'catch ($1)'

  # --- 7. 翻译方法链调用中的类型转换（Java 特有）---
  # (int)x → parseInt(x) 等已在步骤 4 前完成（见上），此处保留占位以兼容旧注释
  s = s.replace /__INT_CAST__/g, 'parseInt('
  s = s.replace /__FLOAT_CAST__/g, 'parseFloat('
  s = s.replace /__DOUBLE_CAST__/g, 'parseFloat('
  s = s.replace /__STRING_CAST__/g, 'String('
  s = s.replace /__BOOLEAN_CAST__/g, 'Boolean('
  s = s.replace /__CHAR_CAST__/g, 'String.fromCharCode('

  # --- 8. 数组声明 new type[size] → new Array(size) ---
  s = s.replace /\bnew\s+(int|long|short|char|byte|float|double|boolean|String)\s*\[(\w+)\]/g, 'new Array($2)'

  # --- 9. 处理 System.out.println / System.out.print ---
  s = s.replace /\bSystem\.out\.println\s*\(/g, 'console.log('
  s = s.replace /\bSystem\.out\.print\s*\(/g, 'console.log('

  # --- 11. 恢复块注释 ---
  s = s.replace /\/\*BLOCK_COMMENT_(\d+)\*\//g, (m, idx) -> blockComments[parseInt idx] or m
  # 恢复字符串字面量（2.5 步占位，防 # 注释转换误伤 "a # b" 之类）
  s = s.replace /STRING_(\d+)/g, (m, idx) -> strings[parseInt idx] or m
  # 恢复 new 构造占位：new __CTOR_String__( → new String(
  s = s.replace /new __CTOR_(\w+)__\(/g, 'new $1('

  # --- 12. 压缩多余空行 ---
  s = s.replace /\n{4,}/g, '\n\n\n'

  s = s.trim()
  if s.length is 0 then s = ';'
  return s

module.exports.fetchToken = (source, language) =>
  if language not in ['java', 'cpp'] or /^\u56E7[a-zA-Z0-9+/=]+\f$/.test source
    return Promise.resolve(source)

  # kodekeeper 优先（官方 AWS 服务，2026-08-13 实测可达、方向正确、AST 完整
  # ESTree+Flow 兼容，CORS allow-origin:*）。失败时回退客户端正则翻译
  # javaCppToJS，断网亦可用（离线兜底）。
  headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' }
  service = window?.localStorage?.kodeKeeperService or "https://asm14w94nk.execute-api.us-east-1.amazonaws.com/service/parse-code-kodekeeper"
  return fetch service, {method: 'POST', mode:'cors', headers:headers, body:JSON.stringify({code: source, language: language})}
    .then (x) =>
      if !x.ok then throw new Error("kodekeeper status #{x.status}")
      x.json()
    .then (x) =>
      if x?.token then return x.token
      throw new Error('kodekeeper returned no token')
    .catch (e) =>
      console.warn '[aether_utils] kodekeeper failed, fallback to client translation:', e?.message or e
      try
        return javaCppToJS source, language
      catch e2
        console.error '[aether_utils] client translation also failed:', e2?.message or e2
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
  currentLanguage = language or me.get('aceConfig')?.language or 'cpp'
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
