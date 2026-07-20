# ZGCombat 设计系统

## 视觉主题与氛围
深色代码编辑器美学。背景 `#0d0e1f`（IDE 深色主题），内容卡片 `rgba(255,255,255,.04)` 微透明层。整体氛围：极客工坊——冷静、专注、有力量感。光线来自代码高亮的色彩（绿 `#5cb85c`、紫 `#c678dd`、蓝 `#61afef`、橙 `#e5c07b`）。

## 色板与角色
- 背景：`#0d0e1f`（主）→ `#1a1b2e`（渐层）
- 表面：`rgba(255,255,255,.04)` 卡片 / `rgba(255,255,255,.08)` hover
- 主色：`#5cb85c`（绿，肯定/开始/成功）
- 辅助色：`#c678dd`（紫，C++ 标签/创意）· `#61afef`（蓝，链接/信息）
- 强调色：`#e5c07b`（橙黄，高亮/星标）
- 文字：`#e0e0e0`（正文）· `#8888aa`（次要）· `#fff`（标题）
- 功能色：绿=成功 橙=警告 红=错误

## 排版规则
- 中文栈：`"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif`
- 英文/代码：`"JetBrains Mono","Fira Code",monospace`
- 标题字重 700/800，正文 400，标签 600
- 正文 14px，小字 12px，H1 36-48px
- 行高：标题 1.2，正文 1.7

## 组件样式
- 按钮：圆角 10px，字重 600，hover 上移 1px，active scale(0.97)
- 主按钮：绿底 `#5cb85c`
- 次按钮：透明底 + 1px 白边框
- 卡片：`border-radius:12px`，`background:rgba(255,255,255,.04)`，hover 亮度 +4%
- 标签：`border-radius:20px`，`font-size:11px`，`font-weight:600`
- 代码块：`background:#0d0e1f`，`border-radius:10px`，行高 1.7

## 布局原则
- 页面 `max-width:1100px`，居中
- 4px 基准间距（4/8/12/16/24/32/48/64）
- 组内间距 < 组间间距
- 桌面用 Grid，移动端塌缩单列

## 动效哲学
- 克制：只用 hover/active 反馈，不做炫耀动画
- 缓动：`cubic-bezier(0.23,1,0.32,1)`
- 时长 150-200ms
- 只动 `transform` 和 `opacity`
