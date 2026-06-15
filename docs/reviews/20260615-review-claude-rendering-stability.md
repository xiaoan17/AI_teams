---
created: 2026-06-15
author: Claude Code
status: Final
scope: src/renderer/App.jsx, src/renderer/terminal-wheel.mjs
tags: [review, rendering, xterm, stability, flicker, input-routing]
---

# AI_teams 代码 Review 报告 — 渲染 / 画面稳定视角（Claude Code 前端工程师）

> 团队三视角 review 之一。视角分工见 `20260615-team-review-index.md`。
> 范围：`src/renderer/App.jsx`（`AgentTerminal`）、`src/renderer/terminal-wheel.mjs`、相关 `src/main/tmux-view.cjs` snapshot 语义、`scripts/terminal-wheel-smoke.mjs`。

**结论先行**：「文本稳定呈现」这个目标在常态路径上基本达到 —— seq 去重、rAF 批量 flush、ANSI 边界对齐、防 atlas 每帧重建这几条核心机制都真实存在且实现正确。但存在 **3 个会导致丢字符/丢回显的真实竞态**，以及若干闪烁/卡顿隐患。

---

## 一、已核实的事实：做对了的部分

- **seq 去重真实存在且双层防护**：live 路径 `App.jsx:733` `if (seq && seq <= lastSeqRef.current) return;`；snapshot 就绪后补播也去重 `App.jsx:648` `if (pending.seq && pending.seq <= lastSeqRef.current) continue;`。主进程 seq 单调自增 `tmux-view.cjs:135` `state.seq += 1`，snapshot 带回当前 seq `tmux-view.cjs:375`，三者对齐，补播边界正确。
- **rAF 批量 flush 真实存在**：`queueOutput`（`App.jsx:568`）累积进 `pendingWriteTextRef`，只在无 frame 时 `requestAnimationFrame(flushQueuedOutput)`（`App.jsx:575-577`），一帧一次 `terminal.write`。输入侧 `createTerminalInputBatcher`（`terminal-wheel.mjs:95`）同样 rAF 合批。
- **ANSI 边界对齐真实正确**：`appendBoundedTerminalWrite`（`terminal-wheel.mjs:43-61`）左截断后 `indexOf("\x1b")` realign，注释解释充分；smoke `terminal-wheel-smoke.mjs:141-143` 覆盖。跨 chunk 不完整 ESC 由 `completeTerminalOutput`/`incompleteEscapeStart`（`terminal-wheel.mjs:178-205`）缓存，smoke `:113-118` 覆盖 split 场景。
- **防 clearTextureAtlas 每帧重建真实落地**：`refreshViewport`（`App.jsx:525-539`）才调 `clearTextureAtlas()+refresh()`，且只被 resize/theme/visible 低频事件触发；`writeOutput`（`App.jsx:540-550`）注释明确"不要在这里 refresh"，热路径只 `terminal.write`。这是闪烁防护的关键，**做对了**。
- **主题原地切换**：`App.jsx:708-714` 改 `termRef.current.options.theme`，不 dispose、不丢 scrollback。正确。
- **滚轮本地化**：`handleTerminalWheel`（`terminal-wheel.mjs:84-93`）`scrollLines` + `preventDefault/stopPropagation`，双重监听（`attachCustomWheelEventHandler` + 容器 capture `App.jsx:514,584`），不转发 tmux。正确。

---

## 二、发现的问题

### 🔴 F1 — snapshot 恢复瞬间 `lastSeqRef` 抬升滞后于补播 queue，存在同 seq 重复写窗口（已核实）

- 现象/证据：补播时对每条 pending 调 `queueOutput(pending.data, pending.seq)`（`App.jsx:649`），`queueOutput` 只把 seq 取 `Math.max`（`:573`）累积到 `pendingWriteSeqRef`，**不立即更新 `lastSeqRef`**。`lastSeqRef` 仅在 `flushQueuedOutput` 真正 write 后才更新（`:564-566`）。于是在"补播 queue 完成、下一帧 flush 之前"，若 `onAgentData` 又来一条 seq 介于 `snapshot.seq`（`:645`）和补播最大 seq 之间的 live 数据，`:733` 的 `seq <= lastSeqRef.current` 判断用的还是旧 `lastSeqRef`（=snapshot.seq），**不会被去重**，于是被再 queue 一次 → 与补播队列里同 seq 数据重复写入。
- 影响：snapshot 恢复瞬间可能出现**重复回显**（同一段输出写两遍），TUI 重绘时表现为短暂错位/串行。窗口极短（一帧内），attach 重连频繁时可复现。
- 严重度：🔴（影响"不丢/不重"核心目标，且发生在最敏感的 snapshot↔live 衔接处）。
- 建议方向：补播循环里对每条 `queueOutput` 后立即 `lastSeqRef.current = Math.max(lastSeqRef.current, pending.seq)`，让去重门槛随补播同步抬升，而不是等到 flush。或在 `:646` 之前先把 `lastSeqRef` 抬到补播队列的 max seq。

### 🔴 F2 — minimize/restore 时 `display:none` + fit 宽度守卫导致恢复后画面尺寸错误（已核实）

- 现象/证据：hidden 卡片用 `display:none`（`styles.css:886-888`）。`AgentTerminal` 在 hidden 时**不卸载**（仍在 `runningAgents.map`，`App.jsx:2115`，靠 `hidden` prop 控可见性）。`fitAndSync`（`App.jsx:586-601`）对 `box.width < 20 || box.height < 20` 直接 return（`:589`）。`display:none` 元素 `getBoundingClientRect()` 返回 0×0，hidden 期间所有 resize 被吞，`lastResizeKey` 停在旧值。restore 时 `[hidden]` effect（`:696-705`）调 `scheduleResize`，但 rAF 回调执行时浏览器刚把 `display` 改回，**同一帧布局可能尚未稳定**，首个 `getBoundingClientRect` 仍可能拿到 0 或旧尺寸。虽有 `[80,260]` 兜底定时器（`:700`），但在这之前 live 数据已按错误 cols/rows 被 tmux 渲染。
- 影响：minimize→restore 后，终端短暂以错误列宽渲染，TUI（框线 UI）**串行错位、需等 ~260ms 才纠正**；快速来回 minimize 时观感为"画面跳一下"。属"画面不稳定"。
- 严重度：🔴（直接命中"不闪、不串行卡顿"，minimize 是常用操作）。
- 建议方向：hidden 改用 `visibility:hidden`+绝对定位或 `content-visibility`，保留盒模型尺寸，使 fit 在隐藏期间也能拿到正确尺寸；或 restore 后强制一次同步 `fitAddon.fit()`（不经 rAF）再 `resizeAgent`。

### 🟡 F3 — snapshot 成功路径未复位 `pendingTerminalOutputRef`，truncated 快照首屏可能串色（已核实）

- 现象/证据：`restoreSnapshot` 成功路径 `writeOutput(snapshotToTerminalData(snapshot.data))`（`App.jsx:643`），`snapshotToTerminalData`（`:194-196`）前缀 `\x1bc`（全屏 reset）。snapshot 经 `writeOutput`→`filterTerminalOutput`（`:541`），会把末尾不完整 ESC 暂存进 `pendingTerminalOutputRef`。成功路径**没有**清这个 ref；紧接着补播的 live 数据会拼到这段残留 ESC 后面（`terminal-wheel.mjs:197`）。当 replayBuffer 被 `truncated` 左截断（`tmux-view.cjs:57`）后**首字节可能落在转义序列中段**，`\x1bc` 之后第一段就可能带半截 ESC。catch 分支已注意到并复位（`:662`），成功分支没有。
- 影响：truncated snapshot 恢复时，首屏可能串色/吞掉一个转义。低频。
- 严重度：🟡。
- 建议方向：成功路径写完 snapshot 后也 `pendingTerminalOutputRef.current = ""`（snapshot 是完整自洽的一帧，不应让尾部残留污染 live 解析）。

### 🟡 F4 — mount effect dispose 未复位 `snapshotReadyRef`，pane 重连窗口可能丢字符（已核实）

- 现象/证据：`App.jsx:723-740` 订阅 effect 依赖 `[agent.id]`，回调全走 ref 读取（`writeOutputRef.current` / `snapshotReadyRef.current` / `lastSeqRef.current`），不依赖闭包，正确。但若 `agent.id` 不变而 `agent.pane` 变（重连换 pane），mount effect 会 dispose 旧 terminal 并把 `writeOutputRef.current=null`（`:690`），而订阅**不重建**——在新 terminal 建好前的窗口里 `writeOutputRef.current?.()` 是 no-op，这段 live 数据**静默丢弃**；且因 dispose 时没把 `snapshotReadyRef` 设回 `false`（只在 effect body 开头 `:502` 设），这段数据可能既不进队列也不写入。
- 影响：同一 agent 不换 id 仅换 pane 重连的瞬间，可能丢一小段输出。频率中等。
- 严重度：🟡。
- 建议方向：mount effect 重置时把 `snapshotReadyRef.current=false` 一并复位，确保新 terminal 未就绪窗口里 live 数据进 `pendingOutputRef` 而非被吞。

### 🟡→🔴 F5 — 输入门控 `if (!agent.pane ...)` 在 direct-pty backend 下会永久禁用键盘输入（已核实，关键正确性 bug）

- 现象/证据：`terminal.onData` 回调 `App.jsx:613` `if (!agent.pane || stoppedOrExited(agent)) return;`。但 direct-pty 后端的 agent **没有 pane** —— 主进程对 direct-pty 明确 `pane: null`（`main.cjs:1349,2331,2367`）。`agent.pane` 是 mount effect 闭包变量（依赖数组含 `agent.pane`），direct-pty 下恒为 null → **`onData` 永远 early-return → 用户在 direct-pty 终端里打字完全没回显/没送达**。tmux 后端有 pane 所以正常。`main.cjs:1451` 仍在 emit direct-pty 的 `agent:data`，说明该后端**仍活着**（browser preview / 降级路径）。
- 影响：direct-pty 模式终端**无法输入**。若 direct-pty 仍受支持，是功能性 🔴；若已废弃只剩 tmux，则降级为 🟡 死分支。
- 严重度：🟡→🔴（取决于 direct-pty 是否仍对用户开放；代码看仍开放）。
- 建议方向：门控应判断"agent 是否可接收输入"，而非 `agent.pane`。建议 `if (stoppedOrExited(agent) || (agent.backend === "tmux" && !agent.pane)) return;`。

### 🟡 F6 — 两处设备序列过滤重复实现，已确认会漂移（已核实，旧文档 #10 属实）

- 现象/证据：renderer 侧 `filterTerminalInput`（`terminal-wheel.mjs:166-176`）剥离 focus/鼠标上报/DA 响应；main 侧 `tmux-input.cjs:249` `tmuxInputActions` 另有一套解析。两者对同一类序列各自维护正则、不共享常量。`filterTerminalOutput` 用的模式集 `TERMINAL_MOUSE_MODE_PARAMS` 等是 export 常量（`terminal-wheel.mjs:3-24`），但 input 侧没复用。
- 影响：新增一类设备序列时易漏改一处 → 某些上报序列泄漏进 PTY 或残留在屏幕。属维护性/潜在串字符隐患。
- 严重度：🟡。
- 建议方向：把设备序列模式提成单一 shared 模块（renderer 与 main 都 import），input/output 各自只组合，不各写正则。

### 🟢 F7 / F8 — resize 风暴下的冗余 reset / 多 timer fit（已核实，轻微）

- `refreshViewport`（`App.jsx:532`）每次都先 `resetTerminalMouseModes`（3 次幂等 `terminal.write`），resize 抖动期高频写入但不可见；冷启动 `[50,250,700]`+`[80,260]`+ResizeObserver+restoreSnapshot 两次 `scheduleResize` ≈ 6 次 fit 尝试，但 `lastResizeKey`（`:595-599`）+rAF 已节流，只有尺寸真变才发 IPC。
- 影响：可忽略，冷启动 CPU 抖一下。
- 严重度：🟢。

---

## 三、对旧 review 文档的核对（仅渲染相关）

- **#10（renderer 无 lint/类型检查、设备序列双写易漂移）**：**属实**。双写确认（见 F6）。`terminal-wheel-smoke.mjs` 是纯断言 smoke，覆盖 filter/append/wheel/batcher，但**确实没有 lint/类型门禁**，`App.jsx` 这种 2185 行组件无静态检查。结论：旧文档定性准确，不过时。
- 顺带印证 **#1** before-quit watchdog 在 `main.cjs:3139-3163` 确有 `QUIT_RELEASE_TIMEOUT_MS` + `app.exit(0)`，**#1 确已过时**。

**本视角新增、旧文档未列的渲染层问题**：F1（snapshot↔live seq 回退重复写）、F2（display:none + fit 守卫致 restore 尺寸错乱）、F4（dispose 未复位 snapshotReady 的丢字符窗口）、F5（`agent.pane` 门控误杀 direct-pty 输入）。这四条旧文档均无。

---

## 四、优先级清单（渲染 / 画面稳定视角）

1. **🔴 F5** — direct-pty 终端输入被 `!agent.pane` 永久门禁（若 direct-pty 仍开放，是功能性致命）。证据：`App.jsx:613` vs `main.cjs:1349`。
2. **🔴 F2** — minimize/restore 用 `display:none` 撞 fit 宽度守卫，restore 后画面尺寸错乱 ~260ms。证据：`styles.css:886` + `App.jsx:589,696-705`。
3. **🔴 F1** — snapshot 恢复瞬间 `lastSeqRef` 抬升滞后于补播 queue，存在同 seq 重复写窗口。证据：`App.jsx:646-651,564-573,733`。
4. **🟡 F4** — mount effect dispose 未把 `snapshotReadyRef` 复位为 false，pane 重连窗口可能丢字符。证据：`App.jsx:502,690`。
5. **🟡 F3** — snapshot 成功路径未复位 `pendingTerminalOutputRef`，truncated 快照首屏可能串色。证据：`App.jsx:643,662`。
6. **🟡 F6** — 设备序列过滤双写漂移。证据：`terminal-wheel.mjs:166-176` vs `tmux-input.cjs:249`。
7. **🟢 F7/F8** — resize 风暴下的冗余 reset/fit，已被 `lastResizeKey`/rAF 节流，可忽略。

---

## 五、总体结论

「文本稳定呈现」在**渲染管线的稳态运行**上是达标的：seq 去重、rAF 合批、ANSI 边界对齐、防 atlas 每帧重建四件套都真实、正确、有 smoke 覆盖，常态流式输出不会闪烁/串色/卡顿。

**不稳定集中在三类边界态**：
- (a) snapshot↔live 衔接的 seq 时序（F1、F4，可能重复或丢一小段）；
- (b) minimize/restore 的尺寸恢复（F2，可见的"画面跳一下"）；
- (c) 后端门控错配（F5，direct-pty 直接不能打字）。

其中 F5、F2 是用户最可能直接感知的，F1 是最隐蔽但最该修的正确性问题。建议优先按 1→3 顺序修，且补一个覆盖 snapshot+live 交错 seq 的 smoke —— 当前 `terminal-wheel-smoke.mjs` **完全没覆盖 `queueOutput`/`flushQueuedOutput`/`lastSeqRef` 这条状态机**，是测试盲区。

---

相关文件（绝对路径）：
- `src/renderer/App.jsx`（AgentTerminal:472-781）
- `src/renderer/terminal-wheel.mjs`
- `src/renderer/styles.css:886`
- `src/main/tmux-view.cjs:122-141,369-378`
- `src/main/main.cjs:1349,1451,1987`
- `scripts/terminal-wheel-smoke.mjs`（缺 queueOutput/seq 状态机覆盖）
