---
created: 2026-06-15
author: Kimi
status: Final
scope: architecture, tech-route, maintainability
tags: [review, architecture, tmux, alt-screen, tech-debt, smoke-tests]
---

# AI_teams 架构 Review 报告 — Kimi 视角（内嵌 tmux 技术路线取舍）

> 团队三视角 review 之一。视角分工见 `20260615-team-review-index.md`。
> 聚焦两个主题：① 内嵌 tmux 这条技术路线本身；② 渲染与画面稳定的根本机制。所有结论均已用 Read/Grep 核实真实代码，并对旧 review 文档（#1~#10）逐条对照现状。

---

## 一、内嵌 tmux 技术路线：根本取舍评估

### 1.1 路线本质（已核实事实）

数据/控制流核实无误，这是一个 **"PTY-over-tmux" 双层架构**：

```
xterm.js(渲染层) → node-pty(传输层) → tmux attach client(复用层) → tmux pane(真实 PTY) → agent CLI
```

- base session 每 agent 一 pane，CLI 跑在内（`main.cjs:1743` `pipe-pane -o ... cat >> rawLog`）。
- view session：`tmux-view.cjs:267` `new-session -d -s <view> -t <base>`，共享 base 的 window，`status/mouse/prefix` 全关（`:268-272`）。
- 接出：`tmux-view.cjs:224` `node-pty spawn("tmux", ["attach-session","-d","-t",viewSession])`，剥离 `TMUX/TMUX_PANE`（`:223`），attach 成功后 `destroy-unattached on`（`:232`）。
- 输入：renderer 原始流 → `tmuxInputActions` 解析 → `send-keys`/`send-keys -l`/buffer paste（`tmux-input.cjs:350-391`）。

### 1.2 为什么不走纯 node-pty / 不走 ACP —— 评估这个决策

项目记忆明确"不走 ACP，坚持纯 PTY 编排"。从架构师角度，这个方向**是正确的**：

- **ACP 的代价**：ACP 要求每个 agent 实现协议端点，而 AI_teams 的卖点恰恰是"任意 CLI 都能塞进来"（codex/claude/kimi 三个异构 CLI，`agents.json`）。走 ACP 等于放弃通用性，把自己绑死在少数实现协议的 agent 上。坚持 PTY 是对的。
- **tmux 相对纯 node-pty 的真实收益**（已核实，非空谈）：
  1. **进程生命周期解耦**：UI 崩溃/重启后 agent 仍活在 tmux server 里，重连即恢复（`scheduleReattach` `tmux-view.cjs:191`）。纯 node-pty 做不到——pty 死了进程就没了。
  2. **workspace 切换不杀进程**：切换只销毁 view session、清 UI 缓存，base session/agent 进程保留（`switchWorkspace` 仅 `bumpWorkspaceEpoch`）。这是 tmux 复用层带来的直接红利。
  3. **断线重连退避**（`DEFAULT_REATTACH_DELAYS=[500,1000,2000,4000,4000]` `tmux-view.cjs:5`）。

  **结论：tmux 这层不是过度设计，它换来的"进程存活独立于 UI"是纯 node-pty 架构无法低成本复制的核心能力。这条路线的根基是稳的。**

### 1.3 路线的根本局限（架构师必须点破的）

#### 🔴 局限 A：alt-screen TUI 被强行按在主缓冲区 —— 这是路线的"硬约束"，不是 bug

- 证据：`terminal-wheel.mjs:19-24` 定义 `TERMINAL_ALT_SCREEN_MODE_PARAMS = {47,1047,1048,1049}`，`filterTerminalOutput`（`:207-219`）把 agent 输出里的 alt-screen enter/leave 序列**剥掉**。`resetTerminalMouseModes`（`:222-232`）注释明说："Keep embedded panes in xterm's main buffer so local scrollback can collect agent output"。
- 这是一个深思熟虑的取舍，但代价真实且永久：
  - 设计意图：让 agent TUI 留在主缓冲区，本地 xterm 才能积累 20000 行 scrollback、滚轮才有内容可滚。
  - **代价**：任何真正用 alt-screen 的全屏 TUI（vim、less、htop、fzf 全屏选择器、某些 CLI 的全屏审批面板）会**渲染错乱**——它以为自己在独占的备用屏幕上做绝对定位光标绘制，但序列被剥后所有内容堆叠进主缓冲区滚动流，光标定位语义错位。
  - 当前三个 agent（codex/claude/kimi）主要是行式流式输出，所以**现在没爆**。但这条路线**天然不兼容全屏 TUI agent**——这是路线的边界，不是可修的缺陷。
- 影响：限定了 AI_teams 能接的 agent 类型（行式 CLI 友好，全屏 TUI 敌对）。
- 严重度：🔴（架构边界，决定产品能力上限）。
- 建议方向：(1) 文档里明确声明"仅支持行式/流式 CLI，不支持全屏 alt-screen TUI"，把它从"潜在 bug"提升为"已声明的产品约束"；(2) 长期若要支持全屏 TUI，需要**双模式**：检测到 1049 时切换该 pane 为"直通模式"（不剥序列、放弃本地 scrollback），而非全局一刀切。

#### 🟡 局限 B：与 tmux 版本/平台耦合，且不可见状态依赖 tmux 内部行为

- 证据：session 名禁用 `.`/`:`（`sanitizeSessionSegment` `tmux-view.cjs:44`，记忆文件记录"咬过两次"）；`window-size latest`（`:274`）、`destroy-unattached`（`:232`）、`#{pane_dead}`/`#{session_attached}`（`:163,170`）全部依赖具体 tmux 字段语义。
- 影响：tmux 版本升级或不同平台（macOS 自带 vs brew vs Linux 发行版）字段行为差异可能静默破坏 view 绑定/探活。当前无 tmux 版本下限检查。
- 严重度：🟡。
- 建议方向：启动时探测 `tmux -V` 并设最低版本门槛（如 ≥3.1，`window-size` 选项 3.1 才稳定），版本不符给明确降级提示而非神秘失败。

#### 🟡 局限 C：双层 PTY 的"不可见状态"放大调试成本

- xterm 看到的不是 agent 真实终端，而是"tmux 复用后再 attach"的二手画面。`\r` 不被当真正按键、必须 `send-keys Enter`（`tmux-input.cjs:30,332` 注释 + 2026-06-14 回归）就是这层间接性的直接产物。paste 后 Enter 被吞需 80ms settle（`tmux-input.cjs:369`）同理。这类问题**只会在双层架构里出现**，纯 node-pty 没有。
- 影响：每个输入语义都要在"xterm 怎么发 → tmux 怎么收 → agent TUI 怎么解释"三层间对账，维护成本结构性偏高。这是路线自带的"税"，不是实现问题。
- 严重度：🟡（已被 settle/send-keys 机制压住，但属持续负债）。

---

## 二、渲染与画面稳定：机制评估

### 2.1 防闪烁机制（已核实，设计正确）

- 证据：`App.jsx:525-578`。`clearTextureAtlas + refresh(0, rows-1)`（`:533-534`，全量重建 glyph atlas，昂贵）**只在 `refreshViewport` 里跑**，而 `refreshViewport` 只挂 resize/theme/font/tab可见；热路径 `writeOutput`（`:540-550`）**只调 `terminal.write`**，注释明确"Do not force a full clearTextureAtlas/refresh here — that is the flicker source"；输出经 `queueOutput`（`:568`）累积 `requestAnimationFrame(flushQueuedOutput)` 批量 flush（`:576`）。
- 评价：**这是正确的 xterm 性能模型**——靠 xterm 自带 dirty-region 增量渲染，绝不每帧重建 atlas。✅

### 2.2 不丢文本机制（已核实）

- **seq 去重**：`lastSeqRef`，`seq <= lastSeqRef.current` 丢弃（`App.jsx:733`）。
- **快照就绪前的 live 输出进队列**：`pendingOutputRef`，`trimPendingOutputQueue` 上限 1M（`:728-730`），就绪后按 seq 去重补播（`:647-651`）。
- **左截断对齐 ESC**：`appendBoundedTerminalWrite`（`terminal-wheel.mjs:43-61`），smoke `:113-114` 覆盖。✅

> 注：Claude 视角对这套衔接机制的边界态（snapshot↔live seq 时序）有更细的 F1/F4 发现，参见其报告。

### 2.3 🟡 渲染层隐患：snapshot 净化全压在 renderer 单点

- 证据：snapshot 数据来自 `loadReplaySeed → tailFile(raw_log)`（`main.cjs:1981`），而 raw_log 是 `pipe-pane` 的**原始 agent 输出**（`main.cjs:1743`），里面**含未过滤的 alt-screen/mouse 序列**。快照回放走 `writeOutput(snapshotToTerminalData(...))`（`App.jsx:643`），**会过 `filterTerminalOutput`**（`:541`），所以 alt-screen 序列在回放时也被剥——逻辑自洽。
- 关键：raw_log 是脏的，renderer 是唯一净化点。renderer 过滤一旦与 agent 实际产生的序列集漂移（出现新 mode），snapshot 回放会渲染脏序列。
- 严重度：🟡。
- 建议：与 2.4 共享模块收敛一起做。

### 2.4 🟡 双写过滤（renderer vs main）—— 旧 review #10 属实，补充定性

- 证据：renderer `terminal-wheel.mjs:166-176`/`:207-219`；main `tmux-input.cjs` 的 `IGNORED_CSI_FINALS`(`:71-80`)、`matchKnownEscape`(`:184`)、`normalizeInjectionProbeText`(`main.cjs:2422`)。两套**各自维护一份"该剥哪些 ESC 序列"的知识**，分布在不同文件、无单一真相源。
- 影响：新增设备序列时极易只改一处，导致输入/输出/探针三路过滤口径漂移（一处剥了一处没剥）。
- 严重度：🟡。
- 建议方向：抽一个 `ansi-sequences.mjs` 共享模块，把"mouse/alt/keyboard mode 参数集 + CSI final 黑名单"作为常量集中导出，renderer 和 main 都 import。`terminal-wheel.mjs` 已经导出了这些常量集，但 main 侧 `tmux-input.cjs` 没复用它们——这是最低成本的收敛点。

---

## 三、smoke 测试体系：是否守住关键不变量？

已核实覆盖（`package.json:11`，11 个 smoke 串行）：

| 不变量 | 是否守住 | 证据 |
|---|---|---|
| alt-screen 序列被剥 | ✅ | `terminal-wheel-smoke.mjs:107-110` 断言 `1049 h/l` 被过滤、`25;1049` 保留 25 |
| 截断对齐 ESC | ✅ | `:113-114` |
| 输入按帧合并成单 batch | ✅ | `:73,76` |
| 滚轮 preventDefault 不转发 | ✅ | `:57-58,96` |
| Enter=send-keys 不变量 | ✅ | `tmux-input-fallback-smoke.cjs` + `agent-input-queue-smoke.cjs` |
| 僵尸 session 恢复 | ✅ | `tmux-zombie-recovery-smoke.cjs` |

**评价：关键渲染不变量确实被 smoke 钉住了**，这点超出多数同类项目。

**🟡 缺口**：
1. smoke **全是纯函数/单元级**，没有真实 xterm 实例渲染验证（RIS 复位 + alt-screen 残留这类真实终端行为，2.3 隐患测不到）。
2. **双写过滤的"同构性"无测试** —— 没有 smoke 断言"renderer 剥的序列集 ⊇ main 剥的序列集"，所以 2.4 的漂移不会被 CI 拦住。
3. renderer 无 lint/类型检查进 smoke（旧 review #10 后半句，属实）。

---

## 四、可维护性：单文件 App.jsx 2185 行

- 已核实：`App.jsx` 2185 行，包含 `AgentTerminal`、渲染管线、状态标签、snapshot 逻辑、IPC 桥接、UI 布局全部混在一个文件。
- 影响：渲染管线（`:520-690` 的 effect）是画面稳定的命脉，却埋在 2000+ 行巨型组件里，与 UI 布局/状态管理纠缠。任何动渲染管线的改动都要在巨文件里定位，回归面大。
- 严重度：🟡（不影响运行，影响演进速度）。
- 建议方向：把 `AgentTerminal`（含 `writeOutput/queueOutput/refreshViewport/restoreSnapshot` 这套渲染管线）拆成独立文件 `AgentTerminal.jsx` + 纯逻辑 `terminal-pipeline.mjs`（`terminal-wheel.mjs` 已做了一半，继续推）。这同时让渲染管线变得可单元测试，补上三.缺口1。

---

## 五、旧 Review 文档（#1~#10）逐条对照现状

| # | 旧结论 | 当前代码现状 | 判定 |
|---|---|---|---|
| #1 | before-quit 无超时可能卡死 | `main.cjs:3137-3168` 已有 `QUIT_RELEASE_TIMEOUT_MS`(默认8s) watchdog + `app.exit(0)` 强退，`watchdog.unref()` | **已过时/已修，应标 resolved** |
| #2 | 每键同步读盘+同步探活 | `writeInputActions`(`tmux-input.cjs:350-358`) 每 batch 只 `resolvePane`(内存)+`isPaneDead` await 一次；注释详述重写 | **已过时/已修** |
| #3 | git() 3s timeout + stderr ignore | `main.cjs:3013-3020` `timeout:3000` + `stdio:["ignore","pipe","ignore"]`，超时落 catch 返回 `isRepo:false`(`:3045`) | **属实，仍在** |
| #4 | 只读路径里 writeJson | `loadAppAgentConfig`(`:578-600`) **已修**：只在 `serialized !== onDisk` 时写，且 mtime+size 缓存。legacy/migrated 冷路径仍无条件写 | **主路径已修，旧定性偏重** |
| #5 | 两条粘贴路径不一致 | 仍分化：view `pasteTextToPane`(`tmux-view.cjs:64`) 用 `load-buffer -`(stdin)；`tmuxPasteTextFallback`(`main.cjs:2384`) 用临时文件+`finally rmSync`，仅 routeMessage 用 | **属实但清理竞态已被 finally 兜住** |
| #6 | waitingPatterns 误报面大 | `main.cjs:121-126` 含 `allow|approve|...|continue|proceed`，正常输出极易命中 | **属实，误报风险真实** |
| #7 | 文档 state 中英文正则冲突 | 未深入核实，保留 | **待验证** |
| #8 | tmuxWriteInputFallback 死代码 | **已确认死代码**：`grep` 全仓只有定义处(`main.cjs:2398`)，无任何调用 | **属实，应删除** |
| #9 | direct-pty onData 同步 appendFileSync 阻塞 | `main.cjs:1445` 仍同步写。tmux 后端走 pipe-pane 不经此路径，仅 direct-pty 降级模式受影响 | **属实，仍在** |
| #10 | 无 lint 进 smoke + 双写过滤漂移 | smoke 无 lint(`package.json:11`)；双写过滤分散在 `terminal-wheel.mjs` 与 `tmux-input.cjs` | **属实** |

---

## 六、优先级清单（架构师视角）

**P0（路线边界，必须显式声明）**
1. 局限A：alt-screen TUI 不兼容——把它从"潜在 bug"升级为**文档声明的产品约束**，并规划双模式作为长期演进出口。

**P1（结构性负债，应主动收敛）**
2. #10 / 2.4：双写过滤抽共享 `ansi-sequences` 模块（main 复用 `terminal-wheel.mjs` 已导出常量集），并补一条 smoke 断言两侧序列集同构。
3. App.jsx 2185 行：拆出 `AgentTerminal` + 纯逻辑渲染管线，让管线可单测。
4. 局限B：启动探测 `tmux -V` 设版本门槛。

**P2（清理与小修，低风险）**
5. #8：删除死代码 `tmuxWriteInputFallback`（`main.cjs:2398-2420`）。
6. #1/#2：把 `20260615-code-review-findings-[todo].md` 里 #1、#2 标记为 resolved。
7. #3：git() 给 `worktree list` 单独放宽 timeout 或区分"超时"与"非 git 仓库"。
8. #6：收窄 waitingPatterns，去掉 `proceed|continue|allow` 高频误报词，或要求与 `[y/N]` 类锚点共现。
9. #9：direct-pty 的 `appendFileSync` 改异步队列写（仅降级模式受影响，优先级低）。

---

## 七、总体结论

**内嵌 tmux 这条路线是站得住的**，且在"进程存活独立于 UI + workspace 切换不杀进程 + 异构 CLI 通吃"这三点上换来了纯 node-pty/ACP 都给不了的核心能力。坚持纯 PTY、不走 ACP 的方向我完全认同。

这条路线的**真正代价集中在一点：为了本地 scrollback 而强剥 alt-screen，使整套架构天然只服务于行式/流式 CLI，对全屏 TUI 敌对**。这不是 bug，是路线的硬边界——当前应做的是**显式声明它**，而不是假装能修。其余（双层 PTY 的输入语义对账、tmux 版本耦合、双写过滤漂移）都是这条路线自带的"税"，目前已被 settle 延迟、send-keys Enter、smoke 不变量等机制压在可控范围。

渲染稳定性的**核心机制（atlas 重建低频化 + RAF 批量 write + seq 去重 + 截断对齐 ESC）设计正确、且被 smoke 钉住**，这是项目的亮点。主要欠缺：渲染管线埋在 2185 行巨文件里难以单测、双写过滤无同构性测试、snapshot 净化全压在 renderer 单点。

旧 review 文档里 **#1、#2 已被当前代码明确推翻**，应及时清账以免误导后续维护者；#3/#6/#8/#9/#10 仍属实。

---

相关文件（绝对路径）：
- `src/main/tmux-view.cjs`
- `src/main/tmux-input.cjs`
- `src/main/main.cjs`
- `src/renderer/App.jsx`
- `src/renderer/terminal-wheel.mjs`
- `scripts/terminal-wheel-smoke.mjs`
