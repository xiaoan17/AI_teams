# Handoff：AI Teams 视觉重设计（Studio 主题 + 中控台 + 视图切换 + Composer）

> 给全栈工程师的施工文档。读完这一份应当能独立落地，无需在场参与设计讨论。

---

## 0. TL;DR（要做的四件事）

1. **新增「视图切换」**：工作区顶部加一条分段控件 `[终端 | 中控台]`，切换工作区主体。
2. **新增「中控台 Dashboard」**：一个全局监控视图（KPI 概览 + 成员实时状态卡 + 任务交接流 + 活动时间线）。
3. **重做 Composer**：输入框在上、工具行在下（📎附件 + @目标 在左，发送在右）。
4. **重做配色体系**：引入两套 Studio 主题——**深色（石墨·薄荷）**与**浅色（冷灰白·靶蓝）**，并入现有 `themes.js`，终端也跟随主题变浅。

**关键约束**：本次是**视觉与结构重设计**，不是重写。后端/IPC（`window.aiTeams` API）、终端 xterm 逻辑、agent 生命周期、i18n 机制**全部沿用**。中控台的数据来自**已有的 agent 状态流**，不需要新建后端通道（详见 §6）。

---

## 1. 关于这些设计文件

`prototype/` 里是**用 HTML/React+Babel 写的设计参考稿**——展示「最终长什么样、怎么交互」，**不是要直接搬进去的生产代码**。任务是：**在现有 `src/renderer` 的 React 环境里，用项目既有的模式（自建 i18n、CSS 变量主题、xterm 终端、`window.aiTeams` API）把这些设计还原出来**。

- 原型用 `window.AGENTS / STATS / FLOW / FEED / DOCS`（`data.jsx`）当假数据；真 App 里这些要接到真实状态。
- 原型用内联的 `Object.assign(window, …)` 跨文件共享组件——这是原型权宜之计，真 App 用正常 ESM `import`。
- 原型的图标是自绘 SVG（`icons.jsx`），可直接搬进 renderer（见 §9 资产）。

**保真度：高保真（hi-fi）**。颜色、间距、圆角、字号都是最终值，请按本文档 §8 的 token 精确还原。

---

## 2. 在哪施工（代码落点）

| 现有文件 | 改动 |
|---|---|
| `src/renderer/themes.js` | **新增 2 个 preset**：`studioDark`、`studioLight`（token 见 §8）。可把 `studioDark` 设为新默认，或保留现有 3 套 + 新增 2 套，由产品决定。 |
| `src/renderer/styles.css` | 新增 Dashboard / 分段控件 / 新 Composer 的样式；调整 `.workspace` 的 grid 行结构（多一行 topbar）。**所有颜色必须走 CSS 变量**，不要写死 hex。 |
| `src/renderer/App.jsx` | 新增 `view` 状态（`terminal`/`dashboard`）；新增 `<Topbar>`（分段控件 + 主题切换 + 全部启动/停止）；新增 `<Dashboard>` 组件；重构 `<Composer>` 的 JSX/布局。 |
| `src/renderer/i18n.js` | 新增文案键（见 §10）。 |
| 新增 `src/renderer/Dashboard.jsx`（建议） | 把中控台拆成独立文件，避免 App.jsx 继续膨胀。 |
| 新增 `src/renderer/icons.jsx`（建议） | 把线性图标集中管理（替换现有零散的 emoji/字符按钮，可分阶段）。 |

**现有布局基线**（`styles.css`）：
- `.app-shell` = `grid-template-columns: 268px minmax(0,1fr)`（侧栏 + 工作区），折叠时 `64px`。**侧栏结构基本不动**，只做配色跟随主题。
- `.workspace` 当前是 `grid-template-rows: minmax(0,1fr) auto`（主体 + composer）。**改为三行**：`auto minmax(0,1fr) auto`（topbar + 主体 + composer）。
- `.terminal-branches` 的 1/2/3 列布局**沿用**（用户确认终端区上限就是 3，不做网格自适应）。

---

## 3. 视图：终端（Terminal View）

**用途**：看每个 agent 的实时终端（xterm），和现在一样，只是换皮。

**布局**：`.term-grid`（原型）↔ `.terminal-branches`（真 App）。`n1/n2/n3` 三种列布局沿用现有 `.terminal-branches-{1,2,3}`。

**终端卡片**（对应现有 `.terminal-card` / `AgentTerminal`）：
- 容器：`background: var(--surface-1)`；`border: 1px solid var(--line)`；`border-radius: 16px`（`--r-lg`）；`overflow: hidden`。
- 选中态 `.active`：`border-color: var(--accent-line)` + 发光 `box-shadow: 0 0 0 1px var(--accent-line), 0 18px 40px -28px var(--accent-glow)`。
- **卡头** `.term-head`：grid `auto minmax(0,1fr) auto` = 状态点 · 名称/runtime · 右侧动作。
  - 状态点 `.dot`（8px 圆，外圈 3px wash 光晕；`wait` 状态加 `pulse-wait` 呼吸动画）。
  - 名称 `.t-name`：13.5px / 700；下面 `.t-meta`：11px mono，内容 `{runtime} · pane %{id}`。
  - 右侧：状态胶囊 `.statepill`（运行中/等待输入/异常/已停止）+ 最小化按钮 + 停止按钮（hover 变 `--err`）。
- **卡身** `.term-body`：xterm 容器。真 App 这里是 xterm canvas，**终端背景/前景必须用主题 token**：`--term-bg` / `--term-fg`（这样浅色主题下终端也跟着变浅——见 §7）。

> ⚠️ 真 App 的终端是 xterm，不是原型里的 `<pre>`。请把 xterm 的 `theme.background/foreground/cursor` 接到主题的 `terminal` 字段（现有 `themes.js` 已有 `terminal: {background, foreground, cursor, selectionBackground}` 结构，照填即可）。

---

## 4. 视图：中控台（Dashboard View）★ 新增重点

**用途**：全局把控——一眼看到「谁在跑 / 谁在等 / 谁出错 / 各自在做什么 / 任务怎么流转 / 最近发生了什么」，不用逐个点终端。

**整体布局** `.dash`：`grid-template-rows: auto minmax(0,1fr)`，`gap:16px`，`padding:18px`，`overflow:hidden`（整体不滚，内部各面板独立滚动）。

### 4.1 KPI 概览条 `.kpi-row`
4 列等宽（`repeat(4, minmax(0,1fr))`，gap 12px）。每张 `.kpi` 卡：
- `background: var(--surface-1)`，`border: 1px solid var(--line)`，`border-radius: 12px`，padding `14px 15px`。
- 顶部一行：标签（11.5px / 600 / `--ink-mute`）+ 右上线性图标（`--ink-faint`）。
- 大数字 `.k-num`：30px / 760 / `letter-spacing:-0.03em` / `font-variant-numeric: tabular-nums`。可带色：`.accent`（蓝/薄荷）、`.amber`、`.coral`。
- 迷你柱状趋势 `.k-spark`：一排 `<i>`，高度按数据比例，最后一根用 `--accent` 高亮，其余 `--accent-dim` 半透明。
- 底部副文案 `.k-sub`（11.5px / `--ink-mute`）。
- `.hot` 变体：顶部 2px accent 线（表示需要关注，如「等待输入 > 0」）。

**四个 KPI**（建议口径）：
| 标签 | 数值来源 | 副文案示例 |
|---|---|---|
| 运行中 | `status === running_or_idle/starting` 的数量 | `N 名成员在岗` |
| 等待输入 | `status === waiting_input` 的数量（`.hot` 当 >0） | `XX 需决策` |
| 异常 | `status ∈ {error, missing_runtime, pane_missing}` 的数量 | `近 1 小时无异常` |
| 今日消息 / 交接 | 路由消息计数 + 交接次数（见 §6 注） | `N 次任务交接` |

### 4.2 主区分栏 `.dash-main`
`grid-template-columns: minmax(0,1fr) 340px`（左主 + 右窄栏），gap 16px。

**左栏：成员实时状态** `.panel-card`（占满高度，内部 body 滚动）。
- 卡头：标题「成员实时状态」+ 右侧 meta「N 名成员 · 实时」。
- body 里是 `.agents-grid`：`repeat(2, minmax(0,1fr))`，gap 12px。每个 `.acard`：
  - `border-radius: 12px`，padding 14px，`gap: 11px`，hover 上浮 1px + 边框提亮；`.s-wait` 琥珀描边、`.s-err` 红描边。
  - **顶部** `.acard-top`：头像方块 `.avatar`（34px 圆角方，放 agent 标识符号）· 名称(14px/700)+runtime(11px mono) · 状态胶囊。
  - **「在做什么」** `.a-doing`：一句话摘要，12.5px / `--ink-soft`，最多 2 行（`-webkit-line-clamp:2`）。
  - **输出尾巴** `.a-tail`：终端最近一行，mono 11px，`background: var(--term-bg)`，单行省略。
  - **进度条** `.bar > i`：4px 高，accent 渐变填充。
  - **底部** `.a-foot`：左「📄 接的任务文件名」+ 右「百分比」。
  - 整卡可点 → 跳到终端视图并聚焦该 agent（`onOpenAgent(id)`）。

**右栏** `.dash-col`（两块竖排）：
- **任务交接流** `.flow-panel`（`flex: 0 1 auto; max-height: 44%`，内容多了自己滚）。
  - 每条 `.flow-item`：状态点 + `{from} → {to}` 路由（箭头用 accent）+ 文档路径（mono）+ 状态徽章（进行中/排队/已完成）+ 相对时间。
- **活动时间线** `.feed-panel`（`flex: 1`，吃掉剩余高度）。
  - `.feed-item`：左侧竖线 + 彩色圆点（run/wait/err/msg/done 各一色），右侧文案（`<b>` 高亮主体名）+ 时间戳。倒序（最新在上）。

> 右栏这个「上半固定高、下半吃剩余」的比例很关键——之前不约束会把时间线挤没。请保留 `max-height: 44%` + `flex:1` 的写法。

---

## 5. Composer（输入区）★ 重做

**目标布局**：输入框占满整行在上，工具行在下。

```
┌─────────────────────────────────────────┐
│  输入消息…（textarea，自增高 52→168px）       │   ← .composer-shell 内
│                                           │
│  [📎 附件] [● @设计师]      Enter发送  [发送] │   ← .composer-tools
└─────────────────────────────────────────┘
```

- 外层 `.composer`：`border-top: 1px solid var(--line)`，`background: var(--bg-rail)`，padding `12px 18px 14px`。
- 内层 `.composer-shell`：卡片化容器，`border: 1px solid var(--line-2)`，`border-radius: 16px`；**focus-within 时** accent 边框 + `0 0 0 3px var(--accent-wash)` 光环。
- `textarea`：透明无边框，13.5px / line-height 1.6，自增高（`min 52` / `max 168` 后滚动）。保留现有键盘逻辑：**Enter 发送、Shift+Enter 换行、输入法 composing 中不触发**（现有 `App.jsx` Composer 已实现这套，照搬）。
- **工具行** `.composer-tools`：grid `auto minmax(0,1fr) auto`。
  - 左 `.tool-left`：
    - 📎 附件按钮 `.tool-btn`（有附件时 `.on` = accent 态）；点击弹出 `.popover` 文档选择器（上浮、`bottom: 100%+8px`，列出 docs，★置顶项，显示 `docs/<folder>`）。沿用现有 docPicker 的「点外面关闭 / Esc 关闭」逻辑。
    - `@目标` 胶囊 `.target-chip`：显示当前 active agent 名（小圆点 + `@名称`）。沿用现有 `@mention` 路由语义。
  - 中：提示 `.composer-hint`「Enter 发送 · Shift+Enter 换行」（11px / `--ink-faint`，右对齐）。
  - 右：发送按钮 `.send-btn`（accent 实心渐变，36px 高，disabled 时灰化）。`canSend = 有文本 && 有路由目标`。

> 附件📎和发送按钮的位置就是这次要改的核心诉求——从「输入框右侧并排三栏」改成「输入框下方工具行」。

---

## 6. 数据接入（中控台数据从哪来）

中控台**不需要新后端通道**，复用现有 `window.aiTeams` API 与事件流：

- **成员列表 + 状态**：`api.listAgents()` + `api.onAgentStatus(cb)`（App.jsx 已订阅，把同一份 `agents` state 传给 Dashboard 即可）。
- **状态 → 视觉映射**（沿用现有 `statusClass` / `STATUS_LABEL_KEYS`）：
  - `running_or_idle` / `starting` → `run`（运行中）
  - `waiting_input` → `wait`（等待输入）
  - `error` / `missing_runtime` / `pane_missing` → `err`（异常）
  - `stopped` / `exited` → `stop`（已停止）
- **「在做什么」摘要 `a-doing` + 输出尾巴 `a-tail`**：从 agent 的终端快照里取。可用现有 `api.getAgentSnapshot(id)` 取最后若干行；摘要可先用「最近一条非空输出行」兜底，后续再做更聪明的提炼。**MVP 阶段 `a-doing` 允许为空或显示状态文案**，不阻塞上线。
- **进度 `progress`**：现有数据里没有真实进度。**MVP 可不显示进度条，或用占位**；不要为它造假数据。先和产品确认是否要这个字段。
- **任务交接流 FLOW**：来自 docs/tasks 的交接关系。现有有 `taskPath`（armed handoff doc）与 `api.routeMessage(msg, targets, {taskPath})`。**MVP 可先展示「最近的路由记录」**（from=发送方/你，to=目标 agent，doc=taskPath），完整的上下游图后续再补。
- **活动时间线 FEED**：把已有事件汇成时间线——agent 状态变化（`onAgentStatus`）、路由发送（`routeMessage` 成功）、route verify 失败（`onRouteVerify`）。建议在 App 里维护一个**有上限的环形数组**（如最近 50 条），事件发生时 push。

> 落地策略建议：**先静态骨架 + 真实「成员状态卡」**（这部分数据现成），再逐步把 FLOW / FEED / progress 接真。中控台对「看状态」的价值，光靠 §4.1 KPI + 状态卡就已成立。

---

## 7. 主题体系（两套 Studio 主题）★

**机制**：完全 token 驱动。原型在 `<html data-theme="dark|light">` 上切换，所有颜色读 CSS 变量。真 App 已有等价机制——`themes.js` 的 `themePresets` + `themeToCssVars()` 把 token 注入 `.app-shell` 的 inline style，并设 `data-theme={theme.id}`。**照这套加两个 preset 即可，组件零改动。**

落地步骤：
1. 在 `themes.js` 的 `themePresets` 里新增 `studioDark` 和 `studioLight`，token 用 §8 的值（注意 `themes.js` 的 key 是**不带 `--` 前缀**的 token 名）。
2. `themes.js` 现有 token 命名（`app-bg`/`sidebar-bg`/`panel-bg`/`surface-bg`/`control-bg`/`text`/`border`/`accent`/…）与原型命名（`bg`/`bg-rail`/`surface-1`/`ink`/`line`/`accent`/…）**不完全一致**。两种做法二选一：
   - **(A 推荐)** 把原型的语义 token 名作为「新标准」引入，新组件用新名；老组件逐步迁移。
   - **(B)** 把原型 token 映射到现有命名（见 §8 的「↔ 现有 token」列），复用现有变量名，改动面最小。
3. **终端跟随主题**：把 preset 的 `terminal.{background,foreground,cursor}` 按浅/深各填一套（浅色终端 = 米白底深字，见 §8）。xterm 主题已经走这个字段，无需改终端逻辑。
4. 顶部加**主题切换按钮**（☀/☾），调现有 `setThemeId` 即可；持久化沿用现有 `localStorage "aiTeams.theme"`。

---

## 8. 设计 Token（精确值）

> 两套主题。左为原型语义名（带 `--`），右为可对应的现有 `themes.js` key（B 方案用）。

### 深色 `studioDark`（石墨 · 薄荷）
| 原型 token | 值 | ↔ 现有 token（B） |
|---|---|---|
| `--bg` | `#0f1215` | `app-bg` |
| `--bg-rail` | `#14181c` | `sidebar-bg` |
| `--surface-1` | `#16191e` | `surface-bg` / `panel-bg` |
| `--surface-2` | `#1c2127` | `control-bg` |
| `--surface-3` | `#232932` | `control-strong-bg` / `hover-bg` |
| `--ink` | `#eef2f5` | `text` |
| `--ink-soft` | `#b3bdc7` | `text-soft` |
| `--ink-mute` | `#76828d` | `muted` |
| `--ink-faint` | `#4d5862` | —（新增） |
| `--line` | `rgba(255,255,255,0.07)` | `border` |
| `--line-2` | `rgba(255,255,255,0.12)` | `border-strong` |
| `--line-3` | `rgba(255,255,255,0.18)` | —（新增） |
| `--accent` | `#3ee0b0` | `accent` / `focus` |
| `--accent-dim` | `#1f8f73` | —（新增） |
| `--accent-ink` | `#04231b` | `accent-ink` |
| `--accent-wash` | `rgba(62,224,176,0.12)` | —（新增） |
| `--accent-line` | `rgba(62,224,176,0.40)` | `focus-ring` 近似 |
| `--accent-glow` | `rgba(62,224,176,0.50)` | —（新增） |
| `--run` | `#3ee0b0` | `success` 近似 |
| `--wait` | `#f0b429` | `warning` |
| `--err` | `#ff6b6b` | `danger` |
| `--stop` | `#5b6670` | `stopped` |
| `--term-bg` | `#0c0f12` | `terminal.background` |
| `--term-fg` | `#cdd6df` | `terminal.foreground` |
| `--term-user` | `#8ab4ff` | —（新增，终端命令/用户行色） |

status wash（外圈光晕，所有主题同模式）：`--{run,wait,err,stop}-wash` = 对应色 10–14% 透明；`--{run,wait,err}-line` = 对应色 28–40% 透明（描边用）。

### 浅色 `studioLight`（冷灰白 · 靶蓝）
| 原型 token | 值 |
|---|---|
| `--bg` | `#f7f8fa` |
| `--bg-rail` | `#f0f2f5` |
| `--surface-1` | `#ffffff` |
| `--surface-2` | `#f4f6f8` |
| `--surface-3` | `#e9edf2` |
| `--ink` | `#11161c` |
| `--ink-soft` | `#3d4752` |
| `--ink-mute` | `#6b7682` |
| `--ink-faint` | `#9aa4b0` |
| `--line` | `rgba(17,24,33,0.09)` |
| `--line-2` | `rgba(17,24,33,0.14)` |
| `--line-3` | `rgba(17,24,33,0.20)` |
| `--accent`（靶蓝） | `#3b6cf0` |
| `--accent-dim` | `#2a52c4` |
| `--accent-ink` | `#ffffff` |
| `--accent-wash` | `rgba(59,108,240,0.10)` |
| `--accent-line` | `rgba(59,108,240,0.38)` |
| `--accent-glow` | `rgba(59,108,240,0.30)` |
| `--run` | `#1f9d57` |
| `--wait` | `#c77700` |
| `--err` | `#e0413f` |
| `--stop` | `#8a949f` |
| `--term-bg`（浅色终端） | `#f3f5f8` |
| `--term-fg` | `#2b333d` |
| `--term-user` | `#2a52c4` |

> 浅色的状态色比深色**刻意调深**，确保在白底上对比足够（WCAG AA 文本对比）。

### 形状 / 字体（两主题共用）
- 圆角：`--r-sm 8px` / `--r-md 12px` / `--r-lg 16px` / pill `999px`。
- 字体：`-apple-system, "SF Pro Text", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`；mono：`"SF Mono","JetBrains Mono",SFMono-Regular,Menlo,monospace`。
- CJK 行高建议 1.5–1.6（中文正文）。
- 阴影 token（随主题深浅不同 alpha）：`--shadow-pop`（弹层）、`--shadow-toast`（toast）、`--shadow-seg`（分段选中）、`--card-sheen`（卡顶微高光渐变）。深色用高 alpha 黑、浅色用低 alpha 冷灰，具体值见 `prototype/studio.css` 顶部两个主题块。

---

## 9. 交互 & 状态汇总

- **视图切换**：`view` state（`terminal`|`dashboard`），默认 `terminal`。分段控件 `.segmented` 内两个 `.seg`，选中加 `.on`（背景 `--surface-3` + `--shadow-seg`）。终端段带个 `.seg-badge` 显示在跑数量。建议持久化到 localStorage。
- **主题切换**：`☀/☾` 按钮翻 `data-theme`/`themeId`，持久化。
- **侧栏折叠**：沿用现有 `sidebarCollapsed` + localStorage。
- **附件 popover**：点开/点外关/Esc 关；沿用现有逻辑。
- **状态点呼吸**：仅 `waiting_input` 做 `pulse-wait` 呼吸（提示需要人介入），其余静态——与现有「只有 waiting 呼吸」的克制原则一致。
- **过渡**：grid 列宽 200ms、hover/focus 120–140ms ease；尊重 `prefers-reduced-motion`（现有 styles.css 已有该 media query，新动画也要加进去）。
- **Toast**：沿用现有 leveled toast（error 常驻 / success 3s / info 5s），仅换配色 token。
- **空状态**：终端无运行成员时显示 `.empty`（图标 + 文案 + CTA「配置团队 / 全部启动」），沿用现有 `empty.*` 文案分支。

---

## 10. i18n（需新增的文案键）

现有 `i18n.js` 有 `composer.*` / `empty.*` / `sidebar.*` / `status.*`。**新增**（zh + en 各一份，沿用现有机制，禁止硬编码）：

```
view.terminal            终端 / Terminal
view.dashboard           中控台 / Dashboard
theme.toggleToLight      切换到浅色 / Switch to light
theme.toggleToDark       切换到深色 / Switch to dark
dashboard.members        成员实时状态 / Live agent status
dashboard.realtime       实时 / Live
dashboard.kpi.running    运行中 / Running
dashboard.kpi.waiting    等待输入 / Waiting
dashboard.kpi.errors     异常 / Errors
dashboard.kpi.messages   今日消息 / 交接 / Messages · handoffs today
dashboard.flow           任务交接流 / Handoff flow
dashboard.flow.active    进行中 / Active
dashboard.flow.queued    排队 / Queued
dashboard.flow.done      已完成 / Done
dashboard.timeline       活动时间线 / Activity
dashboard.doing          在做 / Doing      （或留空，见 §6）
composer.hint            Enter 发送 · Shift+Enter 换行 / Enter to send · Shift+Enter for newline
```
> smoke 测试沿用现有「zh/en 键集一致」的守护（项目里已有该约定）。

---

## 11. 验收清单

- [ ] 顶部分段控件可在 `终端` / `中控台` 间切换，状态持久化。
- [ ] 中控台：KPI 四项数值与真实 agent 状态一致；状态卡显示每个成员的状态/名称/runtime/状态胶囊；点卡片跳回终端并聚焦该成员。
- [ ] 中控台：任务交接流 + 活动时间线渲染正常（MVP 可接「最近路由记录」），时间线不被挤没（保留 §4 比例约束）。
- [ ] Composer：输入框在上、工具行在下；📎在左、发送在右；Enter 发送 / Shift+Enter 换行 / 输入法不误发；附件 popover 正常。
- [ ] 主题：深/浅可切换且持久化；**终端区也跟随主题变浅/变深**；浅色下所有文本对比达标。
- [ ] 所有新样式走 CSS 变量，无写死 hex；`prefers-reduced-motion` 下动画退化。
- [ ] i18n：新键 zh/en 齐全，smoke 通过。
- [ ] 后端/IPC/xterm/agent 生命周期未被破坏（回归：启动/停止/最小化/路由/快照恢复）。

---

## 12. 文件清单（本 handoff 包）

```
design_handoff_studio_redesign/
├── README.md                  ← 本文档
├── prototype/                 ← HTML 设计参考稿（多文件 React+Babel，需 HTTP 预览）
│   ├── AI Teams Redesign.html ← 入口
│   ├── studio.css             ← 完整 token + 全部组件样式（两套主题在文件顶部）
│   ├── icons.jsx              ← 线性图标集（可搬进 renderer）
│   ├── data.jsx               ← 假数据（真 App 替换为真实状态）
│   ├── terminal.jsx           ← 终端视图组件
│   ├── dashboard.jsx          ← 中控台组件
│   └── app.jsx                ← 壳：rail + topbar + 视图 + composer + 主题/状态
└── screenshots/               ← 四态 + 附件弹层参考图
    ├── 01-dark-terminal.png
    ├── 02-dark-dashboard.png
    ├── 03-light-terminal.png
    ├── 04-light-dashboard.png
    └── 05-attach-popover.png
```

**预览原型**（必须走 HTTP，多文件 Babel 不能 `file://` 直开）：
```bash
cd designs && python3 -m http.server 4322
# 打开 http://localhost:4322/ai-teams-redesign/AI%20Teams%20Redesign.html
# 右上角 ☀/☾ 切换深浅；顶部 [终端|中控台] 切换视图
```

---

## 13. 给施工者的提醒

- 这是**还原设计到现有 React 环境**，不是把 HTML 搬进去。组件用正常 ESM、状态用 React hooks、数据接 `window.aiTeams`。
- `studio.css` 是**最权威的尺寸/颜色出处**——拿不准的间距、圆角、阴影直接查它。
- 配色**全部走变量**，是为了让深/浅主题（以及未来更多 preset）零成本切换——千万别在组件里写死颜色。
- 中控台优先把**成员状态卡 + KPI**接真（数据现成、价值最高），FLOW/FEED/progress 可分阶段。拿不准 progress 字段要不要，先问产品。
- 有歧义随时回看 `screenshots/` 四张图对照。
