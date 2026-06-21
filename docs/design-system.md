# AI Teams 设计系统规范（Design System）

Date: 2026-06-20
Status: Active — 本文件是设计「宪法」，新 UI 一律遵守。
Owner: UI/UX
Applies to: `src/renderer/themes.js`(色彩源头)、`src/renderer/styles.css`(组件样式)、`src/renderer/App.jsx`(消费)

---

## 0. 核心原则（先读这一页，其余是细则）

> **颜色不是「挑出来的好看色值」，而是一套有序的语义阶梯。所有组件从同一把尺子取色，绝不在组件里写裸色值。**

这套规范借鉴 Vercel Geist 的核心逻辑：**先建阶梯 → 再按职责取色**。它解决我们当前最大的病根——色值靠手挑、层级靠拼凑，于是出现了「control 与 hover 同色」「accent 与 warning 同色」「success 两个绿值」这类自相矛盾。

四条硬规则，违反就是 bug：

1. **唯一来源。** 颜色只在 `themes.js` 的 token 里定义。`styles.css` / `App.jsx` 里**禁止出现裸 hex**（`#xxxxxx`），一律 `var(--token)`。当前组件里散落的 `#2ecc71` / `#1a1205` / `#ff8b8b` / `#e5484d` / `#e0a83e` 都要回收成 token。
2. **品牌色与状态色分家。** `--accent`(品牌/主交互)和 `--warning`(警告)**必须是不同的值**。当前两者都是 `#f2c14e`，是错的。
3. **背景明度单调。** 同一主题内，背景层从底到顶明度**只增不减**：`app < sidebar/surface < panel < control < hover`。当前 `control-bg === hover-bg`、`surface` 比 `app` 几乎不可分，都要修。
4. **三主题同时成立。** 改任何 token 要在 `workbenchDark` / `cleanCode` / `paperTrail` 三套里都给出对应值，不能只修暗色。键集必须一致（和 i18n 的 zh/en 一样的纪律）。

---

## 1. 色彩系统（Color）

### 1.1 阶梯模型

我们用三类阶梯，对齐 Geist 的「100→1000 语义阶」思想，但收敛到桌面应用够用的档位：

```
背景阶（gray，明度递增）     bg-1  bg-2  bg-3  bg-4
边框阶                       border  border-strong
文字阶（对比递减）            text  text-soft  muted
品牌色                       accent（+ hover/active/弱底）
状态色                       success  warning  danger  + neutral(stopped)
焦点                         focus  focus-ring
```

### 1.2 背景阶（最需要修的地方）

当前 8 个背景变量是「差不多的深灰乱炖」。重整为一把**明度单调递增**的尺子，语义变量指过去：

| 阶 | 职责 | 现有对应变量 |
|----|------|--------------|
| `bg-1` | App 最底层 | `app-bg` |
| `bg-2` | 侧栏 / 卡片 surface / header | `sidebar-bg` `surface-bg` `header-bg` |
| `bg-3` | panel / 控件默认 / 输入框 | `panel-bg` `control-bg` `input-bg` |
| `bg-4` | 控件 **hover**（必须比 bg-3 亮）/ 选中行 / pill | `hover-bg` `active-row-bg` `pill-bg` |

> 注：为了不动 `themes.js` 的键名（否则要改 `App.jsx` 的回退默认值和组件 CSS），本规范**保留现有语义键名**，只重排它们的**值**让明度成阶。`hover-bg` 不再等于 `control-bg` 是这次最关键的一处修正。

### 1.3 品牌色与状态色（teal 方案）

主色方向：**青绿 teal**（冷灰底 + teal 主交互 + 标准语义三色 + 琥珀作唯一高光）。teal 比纯蓝多一点「终端 / 极客」气质，贴合「多 Agent 编排台」定位。

| 角色 | token | 说明 |
|------|-------|------|
| 品牌 / 主交互 | `--accent` | teal 一系。选中、主按钮、聚焦强调、链接。**唯一**主色。 |
| 焦点环 | `--focus` `--focus-ring` | 与 accent 同色系（聚焦本质是「主交互的可达态」），不再用独立的蓝。 |
| 成功 | `--success` | 绿。运行中状态点、成功 toast/notice。**全应用唯一一个绿值。** |
| 警告 | `--warning` | 橙/琥珀。等待输入状态、警告 hint。**必须 ≠ accent。** |
| 危险 | `--danger` | 红。错误状态、删除、关闭按钮 hover。 |
| 中性停止 | `--stopped` | 灰。已停止状态点。 |
| 高光点缀 | `--highlight` *(新增可选)* | 琥珀。仅用于「置顶 pin」这类需要和主色区分的装饰高光，**不当品牌色**。 |

**职责边界**（解决当前 insert 蓝 / pin 金「看不出为什么」的问题）：
- 主交互动作（选中、插入、发送、确认）→ `--accent`。
- 「这是个被标记/收藏的东西」（pin 置顶）→ `--highlight`，当装饰，不抢主色。
- 状态（成功/等待/错误/停止）→ 只走四个语义色，不碰 accent。

### 1.4 Token 表（直接替换 `themes.js` 的 `tokens` 块）

> 三套主题，键完全一致。`--highlight` 为新增键（三套都加）。暗色是主战场，两套亮色按同逻辑给出可用值。

#### workbenchDark（暗，默认，teal 主色）

```js
tokens: {
  // 背景阶：明度严格递增 bg1<bg2<bg3<bg4
  "app-bg": "#0e1114",            // bg-1
  "sidebar-bg": "#14191c",        // bg-2
  "surface-bg": "#14191c",        // bg-2（与 sidebar 同阶，统一）
  "header-bg": "#171d21",         // bg-2→3 之间
  "panel-bg": "#1a2125",          // bg-3
  "control-bg": "#1f272c",        // bg-3（控件默认）
  "input-bg": "#12181c",          // 输入框比控件略沉，聚焦时靠 accent 边框
  "control-strong-bg": "#28333a", // 强调控件（bulk/send）
  "control-strong-border": "#3d4d57",
  "hover-bg": "#283037",          // bg-4：必须 > control-bg
  "active-row-bg": "#1c2a2c",     // 选中行：带一点 accent 倾向的暗底
  "pill-bg": "#222b30",
  // 文字阶
  "text": "#e8edf1",              // 主文字
  "text-soft": "#c2ccd4",         // 次文字
  "muted": "#97a3ad",             // 弱文字（已提亮，原 #8995a0 在小字上对比不足）
  // 边框
  "border": "#252d33",
  "border-strong": "#34404a",
  // 品牌 / 焦点：teal
  "accent": "#2dd4bf",            // 青绿主色
  "focus": "#2dd4bf",             // 焦点 = 主色
  "focus-ring": "rgba(45, 212, 191, 0.30)",
  // 状态
  "success": "#3fb950",           // 唯一绿
  "warning": "#d29922",           // 橙，≠ accent
  "danger": "#ef6f6c",
  "stopped": "#6e7a85",
  // 高光点缀（pin 专用，琥珀）
  "highlight": "#e3a857",
  // 既有
  "notice-bg": "#15282a",
  "notice-text": "#bff0e7"
},
terminal: {
  background: "#0d1114",
  foreground: "#d9e0e8",
  cursor: "#2dd4bf",
  selectionBackground: "#1f4a47"
}
```

#### cleanCode（亮，teal 主色）

```js
tokens: {
  "app-bg": "#f6f8fa",
  "sidebar-bg": "#ffffff",
  "surface-bg": "#ffffff",
  "header-bg": "#f6f8fa",
  "panel-bg": "#ffffff",
  "control-bg": "#f6f8fa",
  "input-bg": "#ffffff",
  "control-strong-bg": "#e9edf1",
  "control-strong-border": "#c0cad4",
  "hover-bg": "#eef2f6",          // > control-bg(更亮的灰)
  "active-row-bg": "#d7f5ef",     // teal 倾向的浅选中底
  "pill-bg": "#eaeef2",
  "text": "#1f2328",
  "text-soft": "#424a53",
  "muted": "#59636e",
  "border": "#d1d9e0",
  "border-strong": "#b6c2cc",
  "accent": "#0d9488",            // teal-700，亮底上够深可读
  "focus": "#0d9488",
  "focus-ring": "rgba(13, 148, 136, 0.25)",
  "success": "#1a7f37",
  "warning": "#9a6700",
  "danger": "#cf222e",
  "stopped": "#818b98",
  "highlight": "#9a6700",
  "notice-bg": "#d7f5ef",
  "notice-text": "#0b3b35"
},
terminal: {
  background: "#161b22",
  foreground: "#e6edf3",
  cursor: "#0d9488",
  selectionBackground: "#264f78"
}
```

#### paperTrail（亮暖纸感，teal 收一点偏青）

```js
tokens: {
  "app-bg": "#f3efe7",
  "sidebar-bg": "#ece7db",
  "surface-bg": "#f7f4ec",
  "header-bg": "#ece7db",
  "panel-bg": "#f7f4ec",
  "control-bg": "#f3efe5",
  "input-bg": "#fbf9f3",
  "control-strong-bg": "#e3dccb",
  "control-strong-border": "#c4b99f",
  "hover-bg": "#e8e1d0",          // > control-bg
  "active-row-bg": "#dcebe4",     // 暖底里的浅青选中
  "pill-bg": "#e3dccb",
  "text": "#2f2a24",
  "text-soft": "#4f463c",
  "muted": "#7a6f60",
  "border": "#d8d0bf",
  "border-strong": "#bdb29a",
  "accent": "#2f8f80",            // 偏暖一点的 teal，融进纸色
  "focus": "#2f8f80",
  "focus-ring": "rgba(47, 143, 128, 0.28)",
  "success": "#4a7c59",
  "warning": "#9a6700",
  "danger": "#b3403d",
  "stopped": "#8a8174",
  "highlight": "#8c5e2a",
  "notice-bg": "#dcebe4",
  "notice-text": "#274b43"
},
terminal: {
  background: "#1d1a15",
  foreground: "#e4ddcd",
  cursor: "#2f8f80",
  selectionBackground: "#3a4a44"
}
```

### 1.5 必须回收的裸色值（落地清单）

`styles.css` 里这些硬编码要改成 token：

| 位置（约行号） | 现状 | 改成 |
|----------------|------|------|
| `.toast-success` / `.onboarding-hint-ok` ×多处 | `#2ecc71` | `var(--success)` |
| `.onboarding-hint-warn` | `#e0a83e` | `var(--warning)` |
| `.panel-action.role-primary` 文字 | `#1a1205` | `var(--accent-ink)`（见 §4.1，主色按钮的前景） |
| `.panel-action.role-danger` / `.role-field` | `#ff8b8b` | `var(--danger)` |
| toast/notice 里 `var(--danger, #e5484d)` 兜底 | 裸兜底 | 直接 `var(--danger)`（token 一定存在，不需要 fallback） |
| `.document-row-pinned` / `.document-pin` / `.attachment-chip` | `var(--accent)` 做 pin | 改 `var(--highlight)`（pin = 高光，不是主色） |

---

## 2. 排版 / 字体（Typography）

字体栈不变（`Inter` + 系统回退；等宽用于 persona / role-id）。规范的是**字号 / 字重 / 行高的离散档位**，以及修掉「11px 全大写灰字」滥用。

### 2.1 字号阶

| token 名（建议） | 值 | 用途 |
|------|----|------|
| `--fs-display` | 17px | 品牌标题 `.brand h1` |
| `--fs-title` | 14px | 终端名、卡片标题、对话框标题 |
| `--fs-body` | 13px | 正文、表单输入、按钮 |
| `--fs-sm` | 12px | 次要正文、pill、文件名、小按钮 |
| `--fs-xs` | 11px | **仅限** badge / 计数这类极短标记 |

行高：正文 `1.5`，单行控件 `1.2`，多行说明 `1.35`。

### 2.2 字重阶

只用 4 档，别再出现 `650 / 750 / 800` 这种细碎值（当前 `styles.css` 里混了 `600/650/700/750/800`）：

| token | 值 | 用途 |
|------|----|------|
| `--fw-normal` | 400 | 正文 |
| `--fw-medium` | 500 | 次要强调、占位角色 |
| `--fw-semibold` | 600 | 控件标签、文件名、按钮 |
| `--fw-bold` | 700 | 标题、状态名、品牌 |

> 迁移：把现有 `650→600`、`750→700`、`800→700`、`850/900→700`。视觉差异肉眼几乎无感，但去掉了「凭手感调字重」的随机性。

### 2.3 全大写标签规则（重点修正）

当前 `.workspace-label` / `.panel-title` / `.workspace-picker` 等用 **11px + `text-transform: uppercase` + muted 色**，是「小字 + 低对比 + 全大写」三连暴击，中文环境下大写更无意义。

新规则：
- **分组小标题**（PANEL / WORKSPACE 等）：升到 `--fs-sm`(12px)，`--fw-semibold`，`muted` 色，`letter-spacing: 0.04em`。
- **中文文案不加 `text-transform: uppercase`**（大写只对拉丁字母有效，对中文是空操作还破坏对齐）。英文 key 若要大写，仅限 `--fs-sm` 及以上、且是真正的 section 标题。
- 计数、badge 这类可以保留 `--fs-xs`，但**不叠加** uppercase + muted 同时拉低。

---

## 3. 间距 / 圆角 / 阴影（Spacing / Radius / Elevation）

### 3.1 间距阶（8pt 基准 + 4 半档）

所有 `padding` / `gap` / `margin` 从这套取值，别再出现 `5px / 7px / 9px / 11px / 14px / 18px` 这类游离值：

| token | 值 | 典型用途 |
|------|----|----------|
| `--sp-1` | 4px | 图标与文字间隙、紧凑 gap |
| `--sp-2` | 8px | 控件内 gap、列表行间距 |
| `--sp-3` | 12px | 卡片内边距、分组间距 |
| `--sp-4` | 16px | 面板/容器内边距、区块间距 |
| `--sp-5` | 24px | 大区块、对话框留白 |

> 迁移策略：就近归并。`5→4`、`6/7→8`、`9/10→8 或 12`、`11/12→12`、`14→12 或 16`、`18→16`。不要求一次性全改，但**新代码只用阶上的值**。

### 3.2 圆角阶

当前 `4/6/7/8/9/10/12/999` 混用。收敛为：

| token | 值 | 用途 |
|------|----|------|
| `--radius-sm` | 6px | 小控件、icon button、badge |
| `--radius-md` | 8px | 卡片、输入框、面板、按钮（默认） |
| `--radius-lg` | 12px | 对话框 / modal |
| `--radius-pill` | 999px | pill、状态胶囊、圆形关闭按钮 |

> `7px → 6 或 8`、`9/10px → 8`。

### 3.3 阴影 / 层级（Elevation）

按"离地高度"分 3 档，z 轴越高阴影越大。同时定义 z-index 阶，终结当前 `20/30/40/60/70` 散值：

| token | 值 | 用途 | 配套 z-index |
|------|----|------|--------------|
| `--shadow-1` | `0 5px 14px rgba(0,0,0,.28)` | 贴地浮起：brand-mark、settings-menu | `--z-menu: 20` |
| `--shadow-2` | `0 12px 32px rgba(0,0,0,.40)` | 悬浮层：toast、doc-picker | `--z-popover: 30` / `--z-toast: 60` |
| `--shadow-3` | `0 18px 60px rgba(0,0,0,.55)` | 模态：confirm / role / onboarding | `--z-modal: 40` / `--z-modal-top: 70` |

> 暗色用上表；亮色主题阴影 alpha 减半（`.28→.12`、`.40→.18`、`.55→.28`），否则亮底上发灰。可由主题 token 覆盖或在 `:root[data-theme]` 上分别定义。

---

## 4. 组件状态（Component States）

统一的状态语言：每个可交互组件都要明确 **默认 / hover / focus-visible / active|selected / disabled** 五态，且都从 token 取色。

### 4.1 按钮（Button）

三种层级，状态规则一致：

| 类型 | 默认 | hover | focus-visible | disabled |
|------|------|-------|---------------|----------|
| **主按钮**（primary，如发送/确认/role-primary） | bg `--accent` / 文字 `--accent-ink` | bg 提亮 8%（`color-mix(--accent, white 8%)`） | + `outline: 2px var(--focus-ring)` | `opacity:.5` |
| **次按钮**（control-strong，bulk/send 容器） | bg `--control-strong-bg` / border `--control-strong-border` | border → `--accent` | 同上 outline | `opacity:.52` |
| **幽灵/图标按钮**（icon-button、panel-action） | 透明或 `--control-bg` / border `--border-strong` | border → `--accent` | 同上 outline | `opacity:.5` |

- `--accent-ink`：主色按钮上的前景文字色。暗色 teal 上用深色 `#06231f`，亮色 teal 上用 `#ffffff`（按主题给）。替换当前写死的 `#1a1205`。
- **危险动作**（删除、关闭）：hover 时 border + 文字转 `--danger`（沿用现有 `.window-control-close:hover` / `.agent-remove:hover` 的写法，已正确，保留）。

### 4.2 输入框 / 下拉（Input / Select）

| 态 | 规则 |
|----|------|
| 默认 | bg `--input-bg`，border `--border`（强调输入用 `--border-strong`） |
| hover | border → `--accent` |
| focus | border → `--focus` **且** `outline: 2px solid var(--focus-ring); outline-offset: 2px` |
| disabled | border `--border`，文字 `--muted`，`cursor: default` |
| placeholder | `--muted` |

> 现状基本对，唯一要改的是 hover/focus 颜色从旧蓝 `--focus` 自动变 teal（因为 token 改了），无需动组件代码。

### 4.3 列表行（Agent row / Doc row / Tree row）

| 态 | 规则 |
|----|------|
| 默认 | border `--border`（tree-row 透明），bg `--panel-bg`/透明 |
| hover | bg → `--hover-bg`（**现在才真正变色**，因为 hover-bg ≠ control-bg 了） |
| selected/active | border `--accent`，bg `--active-row-bg` |
| focus-visible | border `--accent` + outline ring |
| disabled | `opacity:.52` |
| 行内动作（agent-actions / doc-insert/pin） | 默认 `opacity:0 + visibility:hidden`，`:hover/:focus-within` 显示（现状正确，保留） |

### 4.4 状态点 / 状态胶囊（Status dot / pill）

状态色是**唯一**数据源，不掺品牌色：

| 状态 | 色 |
|------|----|
| running | `--success` |
| waiting_input | `--warning`（折叠态 pulse 动画，保留） |
| error | `--danger` |
| stopped | `--stopped` |

pill 底用 `--pill-bg`，文字 `--text-soft`。圆角 `--radius-pill`。

### 4.5 Toast / Notice / Modal notice

三处「成功/错误/信息」语义必须一致，都走语义色：
- 成功：border + glyph `--success`（不再 `#2ecc71`）。
- 错误：border + glyph `--danger`。
- 信息：border + glyph `--accent`（原 `--focus` 蓝，现自动成 teal）。

### 4.6 焦点可达性（Accessibility，硬底线）

- 所有可交互元素必须有 `:focus-visible` 的可见 ring（`outline: 2px solid var(--focus-ring); outline-offset: 2px`）。当前大部分有，缺的要补。
- 正文文字对背景对比度 ≥ 4.5:1，`--muted` 小字尽量 ≥ 4.5:1（已据此把暗色 muted 从 `#8995a0` 提到 `#97a3ad`）。
- 状态不能只靠颜色：等待态除了变色还有 pulse，错误除了红还有 glyph（现状已满足，保持）。

---

## 5. 落地顺序（给执行 agent）

> 与 `20260620-uiux-polish-loop-handoff.md` 同样的纪律：改前先 grep 锚点，改完跑校验。

1. **P0 — token 重整**（一次 commit，零组件改动）：替换 `themes.js` 三套 `tokens`（§1.4），新增 `--highlight` / `--accent-ink`。这一步做完，hover 真正变色、accent 变 teal、warning 与品牌色分家，**80% 的观感问题自动解决**。
2. **P1 — 回收裸色值**（§1.5）：`styles.css` 里 `#2ecc71` / `#1a1205` / `#ff8b8b` / `#e0a83e` / `var(--danger,#e5484d)` 全部换 token；pin 系列从 `--accent` 改 `--highlight`。
3. **P2 — 排版收敛**（§2）：分组小标题 11px→12px、去中文 uppercase、字重并到 4 档。
4. **P3 — 间距/圆角收敛**（§3）：新代码强制走阶；旧值有 PR 经过时就近归并，不单独大改。
5. 每步：浏览器预览三套主题各截一张，确认无回归；动 i18n 则跑 `node scripts/i18n-smoke.cjs`。

## 6. 一句话备忘（贴在每次评审前）

- 写颜色前问：**这个值能不能从某个 token 来？** 不能就先去 `themes.js` 加 token。
- 写 `#f2c14e` 之前问：**这是品牌还是警告？** 别让它们同色。
- 写 hover 前问：**背景真的变了吗？** 还是只换了边框。
- 写 11px 前问：**它是 badge 吗？** 不是就用 12px。
- 加任何首屏控件前问：**它够格占用户每一秒的视线吗？**（见 §7）

---

## 7. 信息层级与克制原则（Less is More）

> **「Less is more」在这里不是「删功能」，而是「主干外露、枝叶收纳、装饰克制」。**
> 功能都保留，但只有「高频且即时」的东西配占首屏；设一次就不动的配置进 ⚙；装饰默认低强度且可一键关。

### 7.1 判断尺：高频 × 即时

任何控件要进首屏（侧栏常驻区 / 主舞台），先用这张表过一遍：

| | 高频（每个 session 都碰） | 低频（偶尔 / 一次性） |
|---|---|---|
| **需即时可见** | ✅ **留首屏** | ⚠️ 留入口，可折叠 / 收进点击弹层 |
| **可延迟** | 收进二级菜单（⚙ / 右键 / 悬浮显现） | 🔻 **深埋，不常驻** |

### 7.2 当前产品的层级裁定（基线，新增时对照）

**主干 — 留首屏，不许往下压：**
- Agent 列表 + 状态点（产品心脏，状态必须第一眼可见）
- 输入 composer（@提及 + 发送）
- 终端卡片区（主舞台）
- 全部启动 / 全部停止（高频且即时）
- 当前项目名（高频上下文锚点）

**已收纳得当 — 保持：**
- 主题 / 语言 / 光效 → ⚙ 设置菜单（设一次就不动）
- 配置 Agent → 面板右上角次级按钮（偶尔用，不占主视线）
- 行内动作（agent-actions / doc insert·pin）→ 默认隐藏，hover/focus 才显现

**应继续收 — 待办：**
- **「最近项目」下拉**：切项目是低频动作，从 workspace 区收进「点击项目名 → 弹层（含最近 / 切换）」，workspace 区两行压成一行。
- **Docs 类型筛选下拉**：低频，默认只留搜索框；筛选收进搜索框内小图标，或仅在有搜索词时出现。

### 7.3 装饰克制阈值（光效默认开，但必须守规矩）

环境光效（ambient effects）是产品特色，**默认开**——用「呼吸」传达 agent 工作/等待状态，是功能性的，不是纯装饰。但「默认开」不等于「放飞」，必须守住克制阈值（沿用 `styles.css` 现有约定）：

- 一键可关（已在 ⚙ 内，`.effects-on` 作用域级开关，关掉零空转成本）。
- **只作用于边框 / 阴影，绝不碰文字和 xterm 画布。**
- 最大扩散 ≤ 18px，最大透明度 ≤ 0.18，呼吸周期 ≥ 2.8s。
- 必须尊重 `prefers-reduced-motion`：降级为静态柔光，不做动画。
- 同一时刻只用光效表达**一种**信息（工作中 / 等待 / handoff），不叠加多种发光抢注意力。

### 7.4 新增功能的默认姿态

- **新功能默认收纳**，不默认占首屏。要外露需先用 §7.1 的尺证明它「高频且即时」。
- **能悬浮显现的就不常驻**（行内动作、次级按钮）。
- **能合并的入口就不并排两个**（如项目名 + 最近项目 → 一个入口带弹层）。
- 空状态不留常驻空位（沿用 T6：无内容的行/区块条件不渲染，别留占位留白）。
