<template>
  <div id="page-home-offline">
    <!-- 背景光晕 -->
    <div class="bg-glow glow-a"></div>
    <div class="bg-glow glow-b"></div>

    <!-- 漂浮代码装饰层 -->
    <div class="bg-decor" aria-hidden="true">
      <span class="code-line l1">Hero hero;</span>
      <span class="code-line l2">hero.moveRight();</span>
      <span class="code-line l3">hero.attack(goblin);</span>
      <span class="code-line l4">// level 1 cleared</span>
      <span class="code-line l5">void castSpell() {}</span>
      <span class="code-line l6">if (enemy.alive) strike();</span>
      <span class="code-line l7">while (health &gt; 0) {</span>
      <span class="code-line l8">&nbsp;&nbsp;hero.attack(enemy);</span>
      <span class="code-line l9">}</span>
    </div>

    <div class="wrap">
      <div class="hero-grid">
        <header class="mast">
          <div class="badge"><span class="prompt">&gt;_</span> LEARN TO CODE BY PLAYING</div>
          <h1 class="mast-title">CodeCombat</h1>
          <p class="mast-sub">
            <span class="type-text">{{ typed }}</span><span class="caret">▋</span>
          </p>
          <div class="cta">
            <a class="cta-primary" href="/play">
              <span class="cta-glyph">{ }</span> 开始游戏
            </a>
          </div>
          <p class="lede">
            CodeCombat 是一款以游戏化关卡为载体、面向青少年的计算机科学学习平台。
            在编写真实代码操控角色闯关中，循序渐进掌握编程与计算思维。
          </p>
        </header>

        <!-- 代码展示窗（装饰 + 真实代码教学） -->
        <div class="code-panel">
          <div class="code-bar">
            <span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
            <span class="code-file">hero.cpp</span>
          </div>
          <pre class="code"><span class="c-com">// 用真实的 C++ 击败哥布林</span>
<span class="c-key">while</span> (<span class="c-var">enemy</span>.<span class="c-prop">health</span> &gt; <span class="c-num">0</span>) {
  <span class="c-var">hero</span>.<span class="c-fn">attack</span>(<span class="c-var">enemy</span>);
  <span class="c-var">hero</span>.<span class="c-fn">moveRight</span>();
}

<span class="c-key">bool</span> <span class="c-fn">castSpell</span>() {
  <span class="c-key">return</span> <span class="c-num">true</span>; <span class="c-com">// 胜利！</span>
}</pre>
        </div>
      </div>

      <section class="features">
        <article class="feature">
          <div class="f-icon">&lt;/&gt;</div>
          <h3>真实代码教学</h3>
          <p>在游戏中编写 Python / JavaScript / C++ / Java / Lua，所学即所用。</p>
        </article>
        <article class="feature">
          <div class="f-icon">▦</div>
          <h3>500+ 渐进关卡</h3>
          <p>从基础语法到 Web 开发、游戏开发，体系完整。</p>
        </article>
        <article class="feature">
          <div class="f-icon">✓</div>
          <h3>契合课标</h3>
          <p>符合计算机科学教学标准，含 AP CSP 认证课程。</p>
        </article>
        <article class="feature">
          <div class="f-icon">⇄</div>
          <h3>师生双端</h3>
          <p>学生自主闯关，教师拥有课堂管理与学情看板。</p>
        </article>
        <article class="feature">
          <div class="f-icon">☀</div>
          <h3>零基础友好</h3>
          <p>图形化引导 + 即时反馈，新手亦可上手。</p>
        </article>
      </section>
    </div>
  </div>
</template>

<script>
export default Vue.extend({
  name: 'PageHome',
  data () {
    return {
      phrases: [
        '在冒险中学会编程',
        '用 C++ 击败哥布林',
        '边玩边学计算机科学',
        '真实代码 · 真实成长',
      ],
      phraseIndex: 0,
      charIndex: 0,
      typed: '',
      deleting: false,
      typeTimer: null,
    }
  },
  mounted () {
    this.runTypewriter()
  },
  beforeDestroy () {
    if (this.typeTimer) clearTimeout(this.typeTimer)
  },
  methods: {
    runTypewriter () {
      const full = this.phrases[this.phraseIndex]
      if (this.deleting) {
        this.typed = full.substring(0, this.charIndex - 1)
        this.charIndex--
      } else {
        this.typed = full.substring(0, this.charIndex + 1)
        this.charIndex++
      }

      let delay = this.deleting ? 45 : 95
      if (!this.deleting && this.charIndex === full.length) {
        delay = 1500
        this.deleting = true
      } else if (this.deleting && this.charIndex === 0) {
        this.deleting = false
        this.phraseIndex = (this.phraseIndex + 1) % this.phrases.length
        delay = 400
      }
      this.typeTimer = setTimeout(() => this.runTypewriter(), delay)
    },
  },
})
</script>

<style scoped lang="scss">
$bg: #0a0e17;
$ink: #e5e7eb;
$muted: #94a3b8;
$cyan: #22d3ee;
$violet: #a78bfa;
$green: #34d399;
$amber: #fbbf24;

#page-home-offline {
  position: relative;
  overflow: hidden;
  min-height: 100vh;
  padding: 88px 32px 110px;
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(124, 58, 237, 0.18), transparent 60%),
    $bg;
  color: $ink;
  font-family: "JetBrains Mono", "Fira Code", ui-monospace, "SFMono-Regular", Menlo, Consolas, "Courier New", monospace;
}

/* ---- 背景光晕 ---- */
.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.5;
  pointer-events: none;
  z-index: 0;
}
.glow-a {
  width: 480px;
  height: 480px;
  top: -120px;
  left: -80px;
  background: radial-gradient(circle, $cyan, transparent 70%);
}
.glow-b {
  width: 520px;
  height: 520px;
  bottom: -160px;
  right: -100px;
  background: radial-gradient(circle, $violet, transparent 70%);
}

/* ---- 漂浮代码装饰 ---- */
.bg-decor {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}
.code-line {
  position: absolute;
  font-size: 13px;
  white-space: nowrap;
  opacity: 0.07;
  animation: drift 18s ease-in-out infinite alternate;
}
.l1 { top: 12%; left: 6%; color: $cyan; }
.l2 { top: 24%; left: 70%; color: $green; animation-delay: -3s; }
.l3 { top: 38%; left: 14%; color: $violet; animation-delay: -6s; }
.l4 { top: 52%; left: 76%; color: $muted; animation-delay: -9s; }
.l5 { top: 64%; left: 8%; color: $amber; animation-delay: -12s; }
.l6 { top: 76%; left: 60%; color: $cyan; animation-delay: -4s; }
.l7 { top: 86%; left: 20%; color: $green; animation-delay: -7s; }
.l8 { top: 92%; left: 30%; color: $violet; animation-delay: -10s; }
.l9 { top: 18%; left: 40%; color: $amber; animation-delay: -2s; }

@keyframes drift {
  0% { transform: translateY(0) rotate(-1deg); }
  100% { transform: translateY(-26px) rotate(1deg); }
}

/* ---- 宽屏容器 ---- */
.wrap {
  position: relative;
  z-index: 2;
  max-width: 1200px;
  margin: 0 auto;
}

/* ---- Hero 双栏 ---- */
.hero-grid {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 56px;
  align-items: center;
  margin-bottom: 72px;
  animation: rise 0.7s ease both;
}

.mast {
  text-align: left;
  animation: rise 0.7s ease both;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  margin-bottom: 18px;
  font-size: 12px;
  letter-spacing: 0.18em;
  color: $cyan;
  border: 1px solid rgba(34, 211, 238, 0.35);
  border-radius: 999px;
  background: rgba(34, 211, 238, 0.06);
}
.prompt { font-weight: 700; }
.mast-title {
  margin: 0 0 14px;
  font-size: clamp(3rem, 7vw, 5.5rem);
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.02em;
  background: linear-gradient(120deg, $cyan 0%, $violet 45%, $green 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 28px rgba(124, 58, 237, 0.45));
}
.mast-sub {
  margin: 0 0 26px;
  font-size: clamp(1.1rem, 2.6vw, 1.5rem);
  color: $ink;
  font-weight: 600;
  min-height: 1.6em;
}

/* ---- CTA ---- */
.cta {
  margin-bottom: 26px;
}
.cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 46px;
  font-size: 1.15rem;
  font-weight: 700;
  text-decoration: none;
  color: #04121a;
  border-radius: 12px;
  background: linear-gradient(120deg, $cyan, $green);
  box-shadow: 0 10px 30px rgba(34, 211, 238, 0.4);
  transition: transform 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease;
}
.cta-primary:hover {
  transform: translateY(-3px);
  filter: brightness(1.06);
  box-shadow: 0 16px 42px rgba(34, 211, 238, 0.6);
  color: #04121a;
  text-decoration: none;
}
.cta-glyph {
  font-size: 1rem;
  opacity: 0.8;
}
.cta-primary:active {
  transform: scale(0.97);
}
.cta-hint {
  margin: 16px 0 0;
  font-size: 0.88rem;
  color: $muted;
}

.lede {
  margin: 0;
  font-size: 0.98rem;
  line-height: 1.8;
  color: $muted;
  max-width: 480px;
}

.type-text {
  color: $ink;
}
.caret {
  display: inline-block;
  margin-left: 2px;
  color: $cyan;
  font-weight: 700;
  animation: blink 1s steps(1) infinite;
}
@keyframes blink {
  50% { opacity: 0; }
}

/* ---- 代码窗 ---- */
.code-panel {
  text-align: left;
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  animation: rise 0.7s 0.12s ease both;
}
.code-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
}
.dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
.dot.r { background: #ff5f57; }
.dot.y { background: #febc2e; }
.dot.g { background: #28c840; }
.code-file {
  margin-left: 8px;
  font-size: 12px;
  color: $muted;
}
.code {
  margin: 0;
  padding: 22px 24px;
  font-size: 14px;
  line-height: 1.7;
  color: #1e293b;
  white-space: pre;
  font-family: inherit;
}
.c-key { color: #c026d3; font-weight: 700; }
.c-var { color: #0369a1; }
.c-prop { color: #b45309; }
.c-fn { color: #15803d; }
.c-num { color: #c2410c; }
.c-str { color: #be123c; }
.c-com { color: #64748b; font-style: italic; }

/* ---- 特性卡片 ---- */
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
  animation: rise 0.7s 0.24s ease both;
}
.feature {
  padding: 24px 22px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(8px);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}
.feature:hover {
  transform: translateY(-5px);
  border-color: rgba(34, 211, 238, 0.5);
  box-shadow: 0 14px 34px rgba(34, 211, 238, 0.15);
}
.f-icon {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
  font-size: 18px;
  font-weight: 700;
  color: $bg;
  border-radius: 11px;
  background: linear-gradient(135deg, $cyan, $violet);
  box-shadow: 0 6px 18px rgba(124, 58, 237, 0.35);
}
.feature h3 {
  margin: 0 0 8px;
  font-size: 1rem;
  color: $ink;
}
.feature p {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.6;
  color: $muted;
}

@keyframes rise {
  from { opacity: 0; transform: translateY(22px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---- 响应式 ---- */
@media (max-width: 900px) {
  .hero-grid {
    grid-template-columns: 1fr;
    gap: 40px;
    margin-bottom: 56px;
  }
  .mast {
    text-align: center;
  }
  .lede {
    margin: 0 auto;
  }
  .cta {
    text-align: center;
  }
  .code-panel {
    max-width: 560px;
    margin: 0 auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mast, .hero-grid, .code-panel, .features, .code-line { animation: none; }
  .cta-primary:active { transform: none; }
}
</style>
