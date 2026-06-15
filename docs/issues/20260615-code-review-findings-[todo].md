---
created: 2026-06-15
updated: 2026-06-15
status: Verified
state: in-progress
tags: [code-review, reliability, performance, tech-debt, main-process, renderer, tmux, rendering]
supersedes_state: 旧 todo 草稿已逐项核实，#1/#2/#4 已修正为已解决
related:
  - docs/reviews/20260615-team-review-index.md
  - docs/reviews/20260615-review-codex-tmux-orchestration.md
  - docs/reviews/20260615-review-claude-rendering-stability.md
  - docs/reviews/20260615-review-kimi-architecture.md
---

# 代码 Review 发现清单（已核实版）

## 说明

本文档原为 2026-06-15 的 review 草稿（`state: todo`，结论标注"待核实"）。同日由团队三名成员（Codex / Claude Code / Kimi）从主进程、渲染、架构三视角**逐条打开真实代码核实**，并补充了草稿未覆盖的渲染层边界态问题。本次更新即核实结果：

- 旧条目 **#1 / #2 / #4 已被后续提交修复**，移入下方「✅ 已解决（原草稿已过时）」区。
- 旧条目 **#3 / #5 / #6 / #7 / #8 / #9 / #10 仍真实存在**，定性保留，行号已按当前代码刷新。
- 新增本次三视角发现：渲染层 **F1 / F2 / F4 / F5**、主进程 **A. epoch 守卫窗口 / B. 串行 reap**、架构 **局限 A：alt-screen 硬边界**。

三视角完整报告见 `docs/reviews/20260615-team-review-index.md`。

验证基线：
- `node --check src/main/main.cjs` 通过
- `npm run smoke` 全过
- 各条目证据均来自对真实文件的 Read/Grep（行号以本次核实当时为准，可能漂移）

---

## ✅ 已解决（原草稿已过时，仅存档）

### ~~1. `before-quit` 退出清理无超时，可能"退不掉"~~ —— 已修

- 当前代码：`src/main/main.cjs:3137-3168` `before-quit` 已有 `QUIT_RELEASE_TIMEOUT_MS`（默认 8000，最小 2000）+ `setTimeout` watchdog → 超时 `app.exit(0)` 强退；正常 release 完成则 `clearTimeout` 后 `app.quit()`。并有 `event.preventDefault()` + `backendReleaseBeforeQuit` 幂等守卫、`watchdog.unref()`。
- 结论：退出已有硬上界，原"无超时卡死"不成立。

### ~~2. `readRuntime()` 每键同步读盘 + 同步探活~~ —— 已修

- 当前代码：`tmuxWriteInput`（`main.cjs:2450`）→ `writeInputActions`（`tmux-input.cjs:350-358`）：`resolvePane` 走 `tmuxViews.expectedWindow()` **内存**（`main.cjs:2442`，不读盘）；liveness 用 `tmuxPaneDeadAsync`/`runTmuxAsync`，**每 batch 一次且 await**（不再每键同步 spawn）。
- 结论：输入热路径已去同步化，原"每字符读盘+探活"的卡顿成因已消除。

### ~~4. `loadAppAgentConfig()` 在纯读取路径里写盘~~ —— 主路径已修

- 当前代码：`loadAppAgentConfig`（`main.cjs:578-601`）已加 `configFileStamp`（mtime+size）内存缓存 + 序列化 diff（`serialized !== onDisk`）才 `writeJson`。
- 残留：legacy/migrate 冷路径首次仍会落盘（一次性，不在高频只读路径）。
- 结论：高频只读路径（`agents:list`/reconcile）已不再无谓写盘。

---

## 🔴 较高隐患（仍存在）

### 3. `git()` 固定 3s timeout + `stdio ignore` 吞掉 stderr

- 位置：`src/main/main.cjs:3013-3020`（`git()`）、`getGitStatus()`（catch 一律返回 `isRepo:false`，约 `:3045-3048`）
- 现象：仍 `timeout:3000` + `stdio:["ignore","pipe","ignore"]`。大仓库 `worktree list` / `status` 可能 > 3s，超时后 catch 返回 `isRepo:false`，UI 误显示"非 git 仓库"。超时与"非仓库"不可区分。
- 严重度：🟡（核实后定性，原草稿列为 🔴；属误导性而非崩溃）
- 建议方向：放宽 timeout，或区分"超时"与"非仓库"两种返回状态。

### F5.（新增·渲染）`onData` 门控 `!agent.pane` 使 direct-pty 后端永久无法键盘输入

- 位置：`src/renderer/App.jsx:613` `if (!agent.pane || stoppedOrExited(agent)) return;`；direct-pty 后端 `pane` 恒为 null（`main.cjs:1349,2331,2367`），但仍 emit `agent:data`（`main.cjs:1451`）说明后端仍活
- 现象：direct-pty（含 browser preview / 降级路径）下 `agent.pane` 恒为 null → `onData` 永远 early-return → 用户在该终端打字**完全没回显、没送达**。tmux 后端有 pane 故正常。
- 严重度：🔴（若 direct-pty 仍对用户开放，是功能性致命；若仅 demo/降级，降级为死分支）
- 建议方向：门控按 backend 区分——`if (stoppedOrExited(agent) || (agent.backend === "tmux" && !agent.pane)) return;`
- 待核实：direct-pty 是否仍是受支持的用户可达后端（代码看仍 emit data，倾向"是"）。

### F2.（新增·渲染）minimize 用 `display:none` 撞 fit 宽度守卫，restore 后画面错宽 ~260ms

- 位置：`src/renderer/styles.css:886-888`（hidden 卡片 `display:none`）+ `App.jsx:589`（`fitAndSync` 的 `box.width < 20 || box.height < 20` return）+ `App.jsx:696-705`（`[hidden]` effect）
- 现象：hidden 卡片不卸载但 `display:none`，`getBoundingClientRect()` 返回 0×0，hidden 期间 resize 全被吞、`lastResizeKey` 停旧值；restore 时 rAF 回调那一帧布局未稳，首个 rect 仍可能 0/旧尺寸。靠 `[80,260]` 兜底 timer 纠正前，live 数据已按错误 cols/rows 被 tmux 渲染。
- 严重度：🔴（直接命中"画面不稳定/跳一下"，minimize 是常用操作）
- 建议方向：hidden 改 `visibility:hidden`+绝对定位 或 `content-visibility`，保留盒模型尺寸；或 restore 后强制一次同步 `fitAddon.fit()` 再 `resizeAgent`。

### F1.（新增·渲染）snapshot 恢复瞬间 `lastSeqRef` 抬升滞后，存在同 seq 重复写窗口

- 位置：`App.jsx:646-651`（补播循环）、`:564-573`（`queueOutput`/`flushQueuedOutput` 只在真正 write 后才更新 `lastSeqRef`）、`:733`（live 去重判断）
- 现象：补播对每条 pending 调 `queueOutput`，只把 seq 取 `Math.max` 累积到 `pendingWriteSeqRef`，**不立即更新 `lastSeqRef`**；在"补播 queue 完成、下一帧 flush 之前"，若 live 又来一条 seq 介于 `snapshot.seq` 与补播 max seq 之间的数据，`:733` 用旧 `lastSeqRef` 判断不会去重 → 同 seq 被重复写入（重复回显）。窗口一帧，attach 重连频繁时可复现。
- 严重度：🔴（影响"不丢/不重"核心目标，发生在最敏感的 snapshot↔live 衔接处）
- 建议方向：补播循环里对每条 `queueOutput` 后立即 `lastSeqRef.current = Math.max(lastSeqRef.current, pending.seq)`；或在 `:646` 前先把 `lastSeqRef` 抬到补播队列 max seq。

### 局限A.（新增·架构）alt-screen TUI 被强剥 —— 路线硬边界，非 bug

- 位置：`src/renderer/terminal-wheel.mjs:19-24`（`TERMINAL_ALT_SCREEN_MODE_PARAMS {47,1047,1048,1049}`）、`:207-219`（`filterTerminalOutput` 剥 alt-screen）、`:222-232`（`resetTerminalMouseModes` 注释说明动机）
- 现象：为让 agent TUI 留在主缓冲区、本地 xterm 才能攒 20000 行 scrollback，输出里的 alt-screen enter/leave 序列被剥。代价：任何真正用 alt-screen 的全屏 TUI（vim/less/htop/fzf 全屏/全屏审批面板）会渲染错乱。当前 codex/claude/kimi 均行式流式输出，未触发。
- 严重度：🔴（架构边界，决定产品能力上限；不是可修缺陷）
- 建议方向：(1) 文档显式声明"仅支持行式/流式 CLI，不支持全屏 alt-screen TUI"，从"潜在 bug"提升为"已声明约束"；(2) 长期若要支持，需双模式——检测到 1049 时该 pane 切"直通模式"（不剥序列、放弃本地 scrollback），而非全局一刀切。

---

## 🟡 中等问题（仍存在）

### 5. 两条粘贴路径不一致；临时文件版本有清理竞态

- 位置：`tmuxPasteTextFallback()`（`main.cjs:2384`，临时文件 `writeFileSync` + `finally` 里 `rmSync`，仅 routeMessage 注入 `tmuxPasteAndSubmitAgent`→`:2699` 调用）vs view 的 `pasteTextToPane()`（`tmux-view.cjs:64`，`load-buffer -` 走 stdin，无临时文件）；键入热路径 `tmuxWriteInput` 的 pasteText（`main.cjs:2466`）已是 stdin 版
- 现象：两条粘贴路径实现分化易漂移；临时文件版 `finally rmSync` 与异步读取间理论竞态（已被 finally 兜住，实际影响小）。
- 建议方向：统一到 stdin（`load-buffer -`）版本，顺带消除临时文件与竞态。

### 6. `inferStatus` 的 `waitingPatterns` 误报面大

- 位置：`src/main/main.cjs:121-126`，`waitingPatterns[0]` 仍是 `\b(allow|approve|permission|confirm|continue|proceed)\b`
- 现象：`continue|proceed|allow` 等普通英文词在 agent 正常输出（如 "you can continue"）中常见，会被标成 `waiting_input`。"等待输入"会引导用户操作，误报代价不低。
- 建议方向：收紧为更接近真实确认提示的模式（行尾、带 `[y/N]` 等锚点），或仅在特定上下文匹配。

### 7. 文档"状态"判定靠中英文关键词正则，易冲突

- 位置：`src/main/main.cjs` `FINISHED_DOCUMENT_FIELD` / `TODO_DOCUMENT_FIELD`、`extractDocumentState()`（约 `:993`，行号待复核）
- 现象：从文档前 24KB 正则扫 `^state:` 行，`finish`/`done` 等词在其他语境可能误判。目前用法受控（只读 `^state:` 行），属脆弱点。
- 严重度：🟡（本轮三视角未深核，维持原定性）
- 建议方向：限定更严格的字段解析（frontmatter 字段精确匹配），减少自由文本误命中。
- 待核实：是否存在 state 行含歧义词的真实文档。

### F4.（新增·渲染）mount effect dispose 未复位 `snapshotReadyRef`，pane 重连窗口可能丢字符

- 位置：`App.jsx:502`（effect body 开头设 false）、`:690`（dispose 时把 `writeOutputRef=null` 但未复位 `snapshotReadyRef`）、`:723-740`（订阅依赖 `[agent.id]` 不随 pane 重建）
- 现象：同一 agent 不换 id 仅换 pane 重连时，mount effect dispose 旧 terminal（`writeOutputRef=null`）但订阅不重建；新 terminal 建好前的窗口里 `writeOutputRef.current?.()` 为 no-op，且 `snapshotReadyRef` 仍停旧 true → 这段 live 数据可能既不进队列也不写入，静默丢弃。
- 严重度：🟡
- 建议方向：mount effect 重置时把 `snapshotReadyRef.current=false` 一并复位，使未就绪窗口里 live 数据进 `pendingOutputRef`。

### A.（新增·主进程）`workspaceEpoch` 守卫存在"晚检测"窗口

- 位置：`reconcileTmuxBackend`（`main.cjs:2080-2168`，每 await 后查 `isStaleWorkspace()`）→ `ensureTmuxViewForAgent`（`:2164`）→ `ensureView`（`tmux-view.cjs:238-284`，内部一长串 await 但**自身不感知 epoch**）
- 现象：若 workspace 在 `ensureView` 执行中途切换，reconcile 要等 `ensureView` 整个返回才 `return`，期间已 `new-session -d` 建出属于旧 workspace 的 view session 并 attach pty。不会 emit 串台（emit 在 epoch 检查之后），但残留一个 view session + node-pty 进程，直到下轮 reconcile/destroyAll 才清。
- 严重度：🟡（窗口短、可自愈，频繁切 workspace 时可能堆积 pty）
- 建议方向：把 epoch（或 `AbortSignal`/`shouldAbort()` 回调）传进 `ensureView`，spawnAttach 前后再判一次。
- 待核实：`switchWorkspace`（`:3057-3058` 先 bump epoch 再 await release）与正在跑的 reconcile `ensureView` 之间是否有互斥。

### 双写过滤（#10 前半 + 架构补充）：设备序列过滤无单一真相源

- 位置：renderer `terminal-wheel.mjs:166-176`（`filterTerminalInput`）/ `:207-219`（`filterTerminalOutput`）vs main `tmux-input.cjs:71-80,184`（`IGNORED_CSI_FINALS`/`matchKnownEscape`）/ `main.cjs:2422`（`normalizeInjectionProbeText`）
- 现象：两套"该剥哪些 ESC 序列"的知识分布在不同文件、无共享常量；`terminal-wheel.mjs:3-24` 已导出 mode 参数集常量，但 main 侧未复用。新增设备序列时易只改一处 → 输入/输出/探针三路过滤口径漂移。
- 严重度：🟡
- 建议方向：抽 `ansi-sequences.mjs` 共享模块集中导出常量集，renderer 与 main 都 import；补一条 smoke 断言"renderer 剥的序列集 ⊇ main 剥的序列集"。

---

## 🟢 小问题 / 整洁度

### 8. `tmuxWriteInputFallback` 已成死代码 —— 已确认可删

- 位置：`src/main/main.cjs:2398`
- 核实：`grep -rn` 全仓（含 scripts）仅定义处一处命中，无任何调用。可安全删除（`:2398-2420`）。

### 9. `onData` 回调里同步 `fs.appendFileSync` 写日志（仅 direct-pty 后端）

- 位置：`src/main/main.cjs:1445`（`directStartAgent` 的 `ptyProcess.onData`）
- 现象：每次 onData 同步 `fs.appendFileSync(state.rawLog, data)`，高吞吐输出时阻塞主进程事件循环。但 tmux（默认后端）用 `pipe-pane "cat >>"`（`:1743`）写盘，**不经主线程**，故仅降级后端受影响。
- 建议方向：改 `fs.createWriteStream` 流式缓冲写。

### 10.（后半）renderer 无 lint / 类型检查进 smoke

- 位置：`package.json:11`（smoke 串行 11 个，无 lint）、`src/renderer/App.jsx`（2185 行单文件，无静态检查）
- 现象：smoke 只 `node --check` 了 main 侧；`App.jsx` 这种巨型组件无 lint/类型门禁。前半"双写过滤"已并入上面「双写过滤」条。
- 建议方向：为 renderer 引入最小 lint/check 进 smoke。

### B.（新增·主进程）before-quit 串行 reap 总时长上界贴近 watchdog

- 位置：`reapBaseSessionProcessTrees`（`main.cjs:1673-1695`，串行 `await killProcessTree(pid)`）、`process-tree.cjs:118`（默认 `graceMs:800`）
- 现象：每个顽固 pane 最坏 ~0.8s+SIGKILL，3 agent 串行 ≈ 最坏 2.4s+，watchdog 8s 可兜。agent 数增多或 graceMs 调大时，串行总时长可能逼近 watchdog 触发强杀。
- 严重度：🟢（当前 3 agent 安全，规模隐患）
- 建议方向：`Promise.all` 并行 reap（各 pid 进程树互不相交，并行安全）；或 watchdog 与 `graceMs × paneCount` 联动。

### App.jsx 2185 行可维护性

- 现象：渲染管线（`App.jsx:520-690` 的 effect）是画面稳定命脉，却与 UI 布局/状态管理混在 2000+ 行单文件，改动定位难、回归面大、无法单测。
- 建议方向：拆出 `AgentTerminal.jsx` + 纯逻辑 `terminal-pipeline.mjs`（`terminal-wheel.mjs` 已做一半），使渲染管线可单元测试，顺带补上 snapshot↔live seq 状态机的 smoke 盲区。

---

## 处理优先级（核实后）

| 优先级 | 项 | 一句话 |
|---|---|---|
| P0 | F5 onData 门控 | direct-pty 永久不能打字（若仍开放，功能性致命） |
| P0 | F2 minimize 尺寸恢复 | restore 后画面错宽 ~260ms，用户可感知 |
| P0 | 局限A alt-screen 约束声明 | 路线硬边界，写进文档而非当 bug |
| P1 | F1 同 seq 重复写 | snapshot↔live 衔接重复回显，最该修的正确性问题 |
| P1 | F4 dispose 复位 snapshotReady | pane 重连丢字符窗口 |
| P1 | A. epoch 传进 ensureView | 切 workspace 时 view+pty 泄漏窗口 |
| P1 | 双写过滤抽共享模块 + 同构 smoke | 防过滤口径漂移 |
| P2 | #3 git 超时与非仓库分离 | 慢仓库误显示非 git |
| P2 | #5 粘贴路径统一 stdin | 消临时文件竞态 |
| P2 | #8 删死代码 | 已确认零引用 |
| P2 | #6 收窄 waitingPatterns | 误报等待输入 |
| P2 | #9 direct-pty 流式写日志 / B. 并行 reap / App.jsx 拆分 | 健壮性 + 规模 + 可维护性 |

---

## 备注

- 本次为**已核实版**：#1/#2/#4 已修并存档于「已解决」；其余条目证据均来自真实代码 Read/Grep。
- 三视角完整报告：`docs/reviews/20260615-team-review-index.md`（含 Codex / Claude / Kimi 三份独立报告）。
- 涉及输入路由 / 终端过滤 / composer 路由 / tmux view 的改动，复现与回归请参考 `docs/issues/20260614-attached-view-submit-and-packaged-restore-[finish].md` 的验证命令，并跑 `npm run smoke:tmux-input`、`smoke:tmux-view`、`smoke:terminal-wheel`。
