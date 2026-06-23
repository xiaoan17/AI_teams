# UI/UX 打磨 Loop Handoff

Date: 2026-06-20
Status: Done (T1–T10)
Owner: AI Teams
Branch: feature/loop_test

## Summary

针对当前渲染层(`src/renderer/App.jsx` / `styles.css` / `i18n.js`)的一次 UI/UX 审查,
共 10 个问题,按优先级拆成 3 个 loop 批次(🔴 红 / 🟡 黄 / 🟢 绿)。本文件是面向
AI agent 的 handoff:每个任务自带文件、行号锚点、根因、改法、验收标准,可被 `/loop` 或
agent 独立领取执行。

**审查依据截图:** `.playwright-mcp/page-2026-06-20T11-57-20-731Z.png`(浏览器预览,
两个 demo agent:codex / kimi,均未分配 role)。

## 执行约定(给 agent 的硬规则)

1. **逐批跑,批内可并行。** 红 → 黄 → 绿。同一批多任务尽量改不同文件区段,减少冲突。
2. **改前先读。** 行号会随改动漂移;每个任务先 `grep` 锚点字符串再定位,不要盲信行号。
3. **i18n 不许硬编码。** 任何新文案走 `t(key)`,zh / en **同时**加键(`i18n.js` 的
   `zh` 和 `en` 字典 key 集必须一致,否则 `scripts/i18n-smoke.cjs` 失败)。
4. **每个任务结束跑校验:** `node scripts/i18n-smoke.cjs`(若动了 i18n)+ 构建/lint
   (见 package.json scripts);UI 改动用浏览器预览复核(playwright 截图比对)。
5. **完成一个任务** → 在本文件对应任务的 `状态:` 行从 `Todo` 改成 `Done`,并一句话记录改了什么。
6. **不扩大范围。** 只改本任务描述的部分;发现顺手能修的别的问题,记到文末「附带发现」,别直接动。

---

## 🔴 批次一:首屏硬伤(打开应用第一眼就看到)

> 这三条 + 黄批的 T6/T7 是用户第一屏直接感知的,优先级最高。

### T1 — 文档树文件夹名被截断成 `d..` / `f...`

- 状态: Done — 缩进步长 14px→12px、chevron 列 14px→12px、左 padding 基数 4px→2px，`docs`/`features` 短名不再省略号。
- 文件: `src/renderer/styles.css`
- 锚点: `.folder-row {`(grid 那段,约 styles.css:701-709);`--tree-indent` 定义在
  `.tree-row`(约 styles.css:691)
- 现象: 截图里 `docs` 显示成 `d..`、`features` 显示成 `f...`,短文件夹名被无谓截断。
- 根因: `.folder-row` 是 `grid-template-columns: 14px minmax(0,1fr) auto`,左 padding 用
  `calc(4px + var(--tree-indent))`(`--tree-indent = depth * 14px`);chevron 占 14px 固定列,
  名字列在浅层就被挤掉宽度,加上 `folder-count` 的 auto 列抢空间,短名也省略号。
- 改法:
  1. 把缩进步长从 `14px` 调小(建议 `12px`)或改用更紧凑的左 padding 基数。
  2. 确认 `.folder-name`(styles.css:729)的 `minmax(0,1fr)` 列在 depth 0/1 时能容纳
     `docs` / `features` 这类 ≤8 字名而不省略号。
  3. `folder-count` 与名字之间留出明确间距(见 T4,可合并改)。
- 验收:
  - 浏览器预览下 `docs` / `features` 完整显示,无 `..`。
  - 深层文件夹(depth ≥3)仍能正常缩进、过长名才省略号。
- 关联: 可与 T4 合并到同一次 commit(都改文档树视觉)。

### T2 — 终端标题栏出现 `Codex Demo + Codex Demo` 重复

- 状态: Done — `agentPanelTitle` 无 role 时只显示运行时 label（不再 `+` 拼接），有 role 仍 `角色名 + 运行时`。
- 文件: `src/renderer/App.jsx`
- 锚点: `function agentPanelTitle`(约 App.jsx:294)、`function agentRuntimeLabel`
  (约 App.jsx:298)、`function agentDisplayName`(约 App.jsx:285)
- 现象: 截图终端标题 `Codex Demo + Codex Demo`。
- 根因: `agentPanelTitle = [agentDisplayName, agentRuntimeLabel].join(" + ")`。
  未分配 role 时 `agentDisplayName` 回退到 `agent.name`(="Codex Demo");
  `agentRuntimeLabel` 在 `name !== base` 时拼成 `Codex · Codex Demo`,demo 数据下两端
  算出近似同一串 → 视觉重复。
- 改法:
  - 当 `agentDisplayName` 已经等于/包含 `agentRuntimeLabel` 的信息(无 role、name 即运行时名)
    时,标题只显示一份,不要 `+` 拼接。
  - 推荐规则:有 role → `角色名 + 运行时`;无 role → 只显示运行时 label(或 `name`),不重复。
- 验收:
  - 无 role 的 codex agent 标题显示 `Codex`(或 `Codex Demo`),不再出现 `X + X`。
  - 有 role 的 agent 仍正确显示 `角色名 + 运行时`。
- 关联: 与 T3 同属「agent 身份展示」,但改的是终端头(T2)vs 侧边栏行(T3),文件同但区段不同。

### T3 — 侧边栏 agent 行看不到「这是哪个 agent」

- 状态: Done — agent 行 role select 上方加 `.agent-identity` 主标签（agent.name/运行时），折叠态随 `.agent-main` 隐藏。
- 文件: `src/renderer/App.jsx`(Sidebar agent 行,约 App.jsx:1734-1858)、
  `src/renderer/styles.css`(`.agent-main-stacked` 约 styles.css:490)
- 现象: 截图侧边栏两行都只有「未分配角色」下拉 + 「运行时 Codex/Kimi · 状态」,
  没有 agent 名/id,两行无法区分。这是**信息缺失**,非纯美观。
- 根因: 行内主区(`.agent-main-stacked`)只渲染了 role select + runtime 子行,
  未渲染 agent 名。无 role 时 role select 显示占位「未分配角色」,等于丢了身份。
- 改法:
  - 在 agent 行加一个主标签显示 agent 身份(`agentDisplayName(agent)` 或 `agent.id`),
    位置建议在 role select 上方或与之并列;role select 作为「分配角色」的次级控件。
  - 注意折叠态(`.sidebar-collapsed`)下该标签应隐藏(沿用现有 collapsed 规则,见
    styles.css:860-868),只留状态点。
  - 文案走 i18n(若引入新 label key)。
- 验收:
  - 两个 demo agent 行能一眼区分(codex / kimi)。
  - 折叠侧栏时不破坏现有「只剩状态点」布局。
- 关联: 与 T10(折叠态 tooltip)主题相关,但 T10 在绿批。

---

## 🟡 批次二:可见瑕疵

### T4 — 文件夹 chevron `·` 与计数贴名

- 状态: Done — 无子节点不再渲染 `·`（留空占位）；`.folder-count` 加左 margin + muted pill，与名字分离。
- 文件: `src/renderer/App.jsx`(`DocumentTreeNode` folder 分支,约 App.jsx:471-487)、
  `src/renderer/styles.css`(`.folder-chevron` / `.folder-count` 约 styles.css:716-740)
- 现象: 无子节点的文件夹 chevron 用 `·`,与 `▸`/`▾` 混排视觉弱;`folder-count` 紧贴名字
  (截图 `d.. 1`)像名字的一部分。
- 根因: chevron 三态(`▾`/`▸`/`·`)对比弱;count 列无明显间距/分隔。
- 改法:
  - 无子节点时不渲染 `·`(留空或更轻的占位),保留有子节点的 `▾`/`▸`。
  - `.folder-count` 加左 margin / 更弱的 muted 色 / 或包一层 pill,使其与名字明确分离。
- 验收: 文件夹行的展开箭头与计数各自清晰,短名不再与数字粘连。
- 关联: 与 T1 同区,建议合并 commit。

### T5 — 发送区按钮(📎 / 发送)固定 58px,与增高的 textarea 失衡

- 状态: Done(方案 B) — `.send-button` 改 `align-self: stretch` + `min-height:58px`，随 textarea 增高；📎 维持图标按钮贴底。
- 文件: `src/renderer/styles.css`(`.attach-doc-button` 约 styles.css:1211、`.send-button`
  约 styles.css:1384、`.composer-row` 约 styles.css:1357);auto-grow 逻辑在
  `src/renderer/App.jsx`(约 App.jsx:1978-1984,textarea 最高 160px)
- 现象: textarea 输入多行会涨到 160px,但 📎 与发送按钮固定 58px,`align-items:end` 让它们
  贴底,长文本时上方大片空,比例失衡。
- 根因: 按钮高度写死 58px(= textarea 初始高),没跟随增高。
- 改法(二选一,推荐 A):
  - A. 保持按钮固定高 + 贴底对齐(现状),但确认视觉可接受;若不接受 →
  - B. 让发送按钮高度跟随 textarea(`align-self: stretch` 或随 grid 行高),📎 维持图标按钮。
  - 决策点:别把 📎 也拉到 160px(会很怪)。优先让 send-button 顺眼即可。
- 验收: 输入 5+ 行文本时,发送区不显突兀;空/单行时与现状一致。

### T6 — `composer-targets` 空行常驻留白(首屏像 bug)

- 状态: Done — 无 mention 且无附件时整条 `composer-topline` 条件不渲染；`.composer` 默认单 `auto` 行，有内容时 `.composer-has-targets/-has-doc` 才恢复 28px 行。
- 文件: `src/renderer/App.jsx`(Composer,`composer-topline` 约 App.jsx:2052-2069)、
  `src/renderer/styles.css`(`.composer` grid 约 styles.css:1177-1185、`.composer-topline`
  约 styles.css:1187)
- 现象: 没有 @mention 且没附件时,顶部那条(`grid-template-rows: 28px auto`)是空的,
  常驻 28px 空行 + 8px gap,首屏看着像多余留白。
- 根因: `.composer` 固定首行 28px;`composer-targets` 无 mention 时渲染空串,
  attachment-chip 也无,整行空但占位。
- 改法:
  - 当既无 mention 又无附件时,折叠该行(条件渲染整个 `composer-topline`,或 grid 行高
    在该态下设 0 / `auto` 且内容为空时不占位)。注意有内容时平滑出现,别跳动太硬。
- 验收: 初始空状态下 composer 顶部无空行;输入 @ 或挂附件时该行正常出现。

### T7 — 成功/删除提示误用 error 红框样式

- 状态: Done — RoleConfigModal 单 `error` state 改为 `notice {level,text}`，成功走 `.role-modal-notice-success`（绿）、失败 `-error`（红）；导入/保存/删除文案走 `roleModal.*` i18n（zh/en 同加）。
- 文件: `src/renderer/App.jsx`(`RoleConfigModal`:`save` 约 App.jsx:1289、
  `performRemoveRole` 约 App.jsx:1313、`openImport` 约 App.jsx:1227;统一走
  `setError(...)` + `.role-modal-error` 约 styles.css:1655)
- 现象: 「已保存：X」「已删除：X」「已导入：X」都用 `setError` 通道 → 渲染成红色错误框,
  成功事件用错误样式呈现,语义错位。
- 根因: modal 内只有一个 `error` state + 一种 `.role-modal-error` 样式,success / error 混用。
- 改法:
  - 引入「消息级别」:把 modal 内通知拆成 `{ level: "error" | "success", text }`(或复用
    App 已有的 `pushToast`,见 App.jsx:2230 —— 但 modal 内独立 notice 更内聚,二选一)。
  - success 用绿/中性样式(可参考 `.toast-success` 约 styles.css:960),error 维持红。
  - 文案已是中文硬编码(「已保存：」等)→ 顺手走 i18n,zh/en 同加键。
- 验收: 保存成功显示成功样式(非红);真正失败(catch 分支)仍红。
- 关联: 与 T9(modal i18n)同文件,建议同批同 commit 一起把 modal 文案 i18n 化。

---

## 🟢 批次三:打磨

### T8 — 文档相对时间 `now`/`5m ago` 没走 i18n(界面中文却显英文)

- 状态: Done — `formatDocumentTime(value, t)` 接 `t`，用现有 `time.*` 键；调用点 `DocumentTreeNode` 传入 `t`。
- 文件: `src/renderer/App.jsx`(`formatDocumentTime` 约 App.jsx:438-454)
- 关键: **i18n 键已存在**(`i18n.js`:`time.now` / `time.minutesAgo` / `time.hoursAgo` /
  `time.daysAgo`,约 i18n.js:86-90 & 174-178)。任务只是「接线」,不需要新增键。
- 根因: `formatDocumentTime` 是纯函数,直接 return 英文字面量(`"now"` / `` `${n}m ago` ``),
  没拿到 `t()`(纯函数不在组件内,无法用 hook)。
- 改法:
  - 让 `formatDocumentTime` 接收 `t`(从调用处 `DocumentTreeNode` 传入,该组件已有
    `const t = useT()`,见 App.jsx:469),用 `t("time.now")` / `t("time.minutesAgo",{n})` 等。
  - 注意调用点 `DocumentTreeNode`(App.jsx:512)`const updatedLabel = formatDocumentTime(node.updatedAt)`
    改成 `formatDocumentTime(node.updatedAt, t)`。
  - 月/日的 `toLocaleDateString` 可按 locale 传 `zh-CN`/`en`(可选,低优先)。
- 验收: 中文界面文档时间显示「刚刚 / 3 分钟前 / 2 小时前」;切 en 显示英文。
  `node scripts/i18n-smoke.cjs` 通过(键集本就一致,无新增)。

### T9 — OnboardingModal 整块中文硬编码,绕过 i18n

- 状态: Done — 全部文案加 `onboarding.*` 键（zh/en），`statusGlyph` 用 `installedVersion {version}` 占位键；`OnboardingModal` 接 `useT()`。
- 文件: `src/renderer/App.jsx`(`OnboardingModal` 约 App.jsx:991-1113)、`i18n.js`
- 现象: `👋 欢迎使用 AI Teams`、`本地多 Agent 终端工作台…`、`正在检测运行环境…`、
  `已安装` / `已安装但无法运行` / `未检测到`、`环境就绪…`、`重新检测` / `开始组队 →`、
  `下次不再显示`、`安装指引 ↗` 等全硬编码。英文环境不切换。
- 改法:
  - 给 onboarding 全部文案加 i18n 键(命名建议 `onboarding.*`),zh/en 同加。
  - `statusGlyph` 里的 `已安装(version)` 等动态串用带 `{version}` 占位的键。
  - `OnboardingModal` 内用 `useT()`(目前它没用 t)。
- 验收: 切 en 时 onboarding 全英文;`i18n-smoke.cjs` 通过(zh/en 键集一致)。
- 关联: 与 T7 同为「i18n 补全」,但 T7 在黄批(因成功/错误语义更影响信任),T9 纯补全归绿批。

### T10 — 折叠侧栏只剩状态点,缺 tooltip

- 状态: Done — agent-dot 与行 `title` 改为 `displayName · 状态`，折叠态 hover 状态点即显示 agent 名与状态。
- 文件: `src/renderer/App.jsx`(Sidebar agent 行,折叠态;`.sidebar-collapsed .agent-row`
  约 styles.css:880-892)
- 现象: 折叠后每行只剩一个状态点,hover 无 tooltip,看不出是哪个 agent / 什么状态。
- 改法:
  - 折叠态的 agent 行(或其状态点)加 `title`(agent 名 + 状态),沿用 `agentDisplayName` +
    `STATUS_LABEL_KEYS` 翻译。`.agent-row` 已有 `title={displayName}`(App.jsx:1758),
    确认折叠态下该 title 仍生效;若被子元素吞掉,补到点上。
- 验收: 折叠侧栏 hover 任一状态点能看到 agent 名与状态。
- 关联: T3 在展开态补身份,T10 在折叠态补 tooltip,两者互补。

---

## 任务依赖与并行建议

| 批次 | 任务 | 可并行 | 合并 commit 建议 |
|------|------|--------|------------------|
| 🔴 一 | T1, T2, T3 | T1 与 T2/T3 改不同文件区段,可并行 | T1+T4 合(文档树视觉) |
| 🟡 二 | T4, T5, T6, T7 | T4/T5/T6 改 CSS 为主可并行;T7 改逻辑 | T7+T9 合(modal i18n) |
| 🟢 三 | T8, T9, T10 | T8/T10 独立;T9 较大 | T8 独立小 commit |

**i18n 触碰任务:** T7(可选)、T8、T9 —— 这些跑完都要 `node scripts/i18n-smoke.cjs`。

## 验收总清单(全批跑完后)

- [ ] 浏览器预览截图与 baseline 对比:文档树名完整、终端标题不重复、侧边栏行可区分。
- [ ] 切换 zh/en:文档时间、onboarding、modal 提示全部跟随语言。
- [ ] `node scripts/i18n-smoke.cjs` 通过。
- [ ] 构建 / lint 通过(见 `package.json` scripts)。
- [ ] 折叠 / 展开侧栏、长文本输入、附件挂载等交互无回归。

## 附带发现(执行中新增,先记录别动)

- (留空,执行 agent 把顺手发现但超范围的问题记这里)
