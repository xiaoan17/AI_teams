---
created: 2026-06-15
status: Verified
state: verified
tags: [code-review, reliability, performance, tech-debt, main-process, renderer, concurrency]
---

# 代码 Review 核实版（2026-06-15）

## 说明

本文档是对 `20260615-code-review-findings-[todo].md`（review 草稿）的**逐项核实闭环**：

- 把草稿中标注「待核实」的条目逐一对照源码确认，给出**确认 / 修正 / 排除**结论。
- 补充两条草稿未单列、但核实后属于高优先级的隐患：输入热路径同步阻塞（H1）、`runtime.json` 并发与原子性（H3）。
- 记录核实过程中**推翻的两条初查结论**（避免后人按草稿误改）。

整体评价：架构思路清晰（纯 PTY 编排 + 闭环注入 + 进程树回收），smoke 测试覆盖关键路径，issue 文档化到位。当前未提交改动（注入路由统一、设备响应过滤、`default_agent` 自愈、Error 序列化、workspace 恢复）**方向正确**。主要隐患集中在两处：**本次改动新引入的输入热路径** 与 **runtime 状态文件的并发/原子性**。

## 验证基线

- `node --check src/main/main.cjs` 通过（草稿已确认）。
- `npm run smoke` 全过（草稿已确认；日志出现一次 `reap incomplete ... reason: 'timeout'`，对应 H2）。
- 本文结论基于对 `src/main/main.cjs` 关键区域、`tmux-input.cjs`、`tmux-view.cjs`、`logger.cjs`、`terminal-wheel.mjs` 的源码核实，及全仓 grep 引用追踪。

> 行号以核实当时为准，可能随后续改动漂移。

---

## 隐患分级总览

| 级别 | 编号 | 一句话 | 草稿对应 |
|---|---|---|---|
| 🔴 H1 | 输入热路径全同步阻塞主进程 | 每次输入同步读盘 + 探活 + 1~3 次同步 spawn tmux，主线程冻结 | 草稿 #2（升级：确认是新引入回归面，且 paste 路径是 3 次 spawn） |
| 🔴 H2 | 退出清理无总超时 → 可能"退不掉" | `before-quit` 逐 pane `killProcessTree` 无总超时 | 草稿 #1（确认） |
| 🔴 H3 | `runtime.json` 无锁 + 非原子写 + 无解析容错 | 损坏即持续失败，async reconcile 与 sync handler 间有 lost-update 窗口 | 草稿未单列（新增） |
| 🟡 M1 | 只读路径每次重写 `agents.json` | `loadAppAgentConfig` 三分支均写盘，覆盖用户编辑 | 草稿 #4（确认） |
| 🟡 M2 | 粘贴逻辑分裂成三份 | 内联 / `tmuxPasteTextFallback`（临时文件）/ `pasteTextToPane`（stdin）并存 | 草稿 #5（确认，改完后更碎） |
| 🟡 M3 | `git()` 同步 3s 超时，慢仓库误报"非仓库" | `getGitStatus` 调 3~4 次，超时与"非仓库"不可区分 | 草稿 #3（确认） |
| 🟡 M4 | `persistStatus` 写非原子 | 同 `writeJson`，崩溃恢复侧信道可能损坏 | 草稿未单列（新增，H3 同根） |
| 🟢 L1 | `tmuxWriteInputFallback` 死代码 | grep 确认零引用 | 草稿 #8（确认） |
| 🟢 L2 | `inferStatus` 的 `waitingPatterns` 误报面大 | `continue/proceed` 等普通词触发 `waiting_input` | 草稿 #6（确认） |
| 🟢 L3 | 文档状态靠正则扫 `^state:` | 受控但脆弱 | 草稿 #7（确认） |
| 🟢 L4 | renderer 无 lint；设备响应过滤双写 | `App.jsx` 77KB 单文件；main/renderer 两处过滤重复 | 草稿 #10（确认） |
| 🟢 L5 | direct-pty `onData` 同步 `appendFileSync` | 高吞吐阻塞主进程 | 草稿 #9（确认） |

---

## 🔴 高优先级（建议尽快处理）

### H1. 输入热路径全同步阻塞主进程（本次改动新引入）

- **位置**：`src/main/main.cjs:2291` `tmuxWriteInput` ← `agents:input` IPC（`:2996`）← renderer `sendInput`
- **现象**：本次"统一注入路由"改动把输入从「写 attached view PTY（内存）」改为「每键走 tmux」。一次 `agents:input` 现在做：
  1. `readRuntime()` **同步读盘**（`:2292`）；
  2. `tmuxPaneDead(pane)` **同步 spawn** 一次 `tmux display-message`（`:1542` → `tmuxPaneField` `:1534`）；
  3. 对每个 action 再同步 spawn：`send-keys` **1 次**，或 `load-buffer` + `paste-buffer` + `delete-buffer` **3 次**（`:2311-2314`）。

  即**一次粘贴 ≈ 4~5 次同步 `execFileSync("tmux")`**，全部堵在 Electron 主线程 → IPC、窗口事件、渲染进程 `invoke` 全部冻结。快速打字 / 粘贴大段时表现为明显卡顿与输入滞后。
- **改动动机是对的**（注释说明：避免 view 先送 `C-m` 导致命令卡在 prompt），但实现方式（同步起子进程）代价过高。
- **方向**：① pane 映射缓存在内存（reconcile 时刷新），写入路径不再每键读盘 + 探活；② 探活只在批次入口做一次；③ 长期把输入迁到 `runTmuxAsync` 或常驻 tmux 控制模式客户端。
- **关联**：与 `enqueueAgentInput`（`:2594`）的串行队列叠加 → 快速输入时操作堆积、延迟累积（见「已排除/已修正结论」第 1 条澄清）。

### H2. 退出清理无总超时 → 可能"退不掉"

- **位置**：`src/main/main.cjs:2954` `before-quit` → `releaseCurrentWorkspaceBackend()`（`:2616`）→ `reapBaseSessionProcessTrees()`（`:2643`）逐 pane `await killProcessTree(pid)`；最后 `.finally(() => app.quit())`（`:2963`）
- **现象**：整条链**没有总超时**，只有 `.finally`。smoke 日志已出现 `reap incomplete ... reason: 'timeout'`（`:1572`）。若某 agent 子进程（MCP server 等）拒绝退出，会逐 pane 等各自超时，`app.quit()` 始终不被调用 → **点了退出窗口几秒甚至十几秒不消失**。
- **方向**：`Promise.race([releaseCurrentWorkspaceBackend(), timeout(5000)]).finally(() => app.exit(0))`。

### H3. `runtime.json` 无锁 + 非原子写 + 无解析容错

- **位置**：
  - `readJson`（`src/main/main.cjs:203-208`）：文件存在但内容损坏时 `JSON.parse` **直接抛**，无 try/catch（`fallback` 仅在文件不存在时生效）。
  - `writeJson`（`:210-213`）：`writeFileSync` 截断 + 原地写，**非原子**。
  - `readRuntime`（`:1457`）/ `saveRuntime`（`:1461`）：裸包装，无锁。
- **现象**：
  - **解析容错**：runtime.json 一旦被写坏，所有读 runtime 的操作持续抛错。被 `ipcHandle`（`:2966`）/ reconcile 的 try/catch 兜成 IPC 失败或 error 状态——不会崩进程，但**功能降级直到文件修复**。
  - **lost-update 竞态**：`reconcileTmuxBackend` 是 async，在每个 `await runTmuxAsync` 之间会被同步 IPC handler 插入一次读改写（如 `agents:list` → `tmuxListAgentStates` 里的 `saveRuntime`），**覆盖 reconcile 的中间结果**，造成 pane 映射丢失。JS 单线程下窗口窄（仅在 reconcile 的 await 点），但 reconcile 每 5s（`TMUX_RECONCILE_INTERVAL_MS = 5000`，`:53`）触发、await 点多，累积概率不低。
- **方向**：写侧加**进程内 mutex** + **原子写**（`tmp + fs.renameSync`）；`readJson` 包 try/catch 返回 fallback。这是"靠状态文件保证可靠性"架构的命门。

---

## 🟡 中等问题

### M1. 只读路径每次都重写 `agents.json`

- **位置**：`src/main/main.cjs:527-555` `loadAppAgentConfig`（三分支**每个都 `writeJson`**）← `loadConfig` ← `agents:list` / `routeTargets`（`:2652`）/ reconcile 等高频只读路径
- **现象**：每次"列出 agent"等只读操作都截断重写配置。后果：无谓 IO、**可能覆盖用户手动编辑**、触发不必要的 watcher。
- **方向**：normalize 后与磁盘内容比对，仅在有 diff 时写。

### M2. 粘贴逻辑分裂成三份

- **位置**：
  - `tmuxWriteInput` 内联：`load-buffer -`（走 stdin，无临时文件）（`:2311`）；
  - `tmuxPasteTextFallback`：**临时文件**版（`:2237`），仍被 `tmuxPasteAndSubmitAgent`（`:2502`）使用；
  - `tmux-view.cjs` `pasteTextToPane`：`load-buffer -`（stdin，新）。
- **现象**：临时文件版与 stdin 版并存，易漂移；本次统一路由后碎片化更明显。
- **方向**：统一到 stdin 版，删除临时文件版，顺带消除临时文件与异步读取之间的理论竞态。

### M3. `git()` 同步 3s 超时，慢仓库误报

- **位置**：`src/main/main.cjs:2816` `git()`（`execFileSync`，3s）← `getGitStatus`（调 3~4 次）
- **现象**：大 / 慢仓库同步阻塞主线程累计可达 ~12s；超时与"非仓库"无法区分，UI 误显示"非 git 仓库"。
- **方向**：放宽 timeout 或区分"超时"与"非仓库"两种返回状态。

### M4. `persistStatus` 写非原子

- 与 H3 同根（`writeJson`）。主进程只写不读、不轮询，影响面小于 runtime，但这些是崩溃恢复侧信道，非原子写在崩溃瞬间可能损坏。MED。

---

## 🟢 低优先级 / 整洁度

- **L1. `tmuxWriteInputFallback` 死代码**（`:2251`）。grep 确认：**定义外零引用**。本次改动后 `tmuxWriteInput` 不再走它，`tmuxPasteAndSubmitAgent` 也移除了 attached 分支。建议直接删，零风险。
- **L2. `inferStatus` 的 `waitingPatterns` 误报面大**（`:100`）。`allow|approve|continue|proceed` 等普通英文词会把 agent 正常输出标成 `waiting_input`，而这是会驱动用户行为的状态。
- **L3. 文档状态靠正则扫 `^state:` 行**（`:993`）。受控（只读该行），属脆弱点。
- **L4. renderer 无 lint / 类型检查**，smoke 仅 `node --check` main 侧；`App.jsx` 77KB 单文件；设备响应过滤在 `terminal-wheel.mjs` 与 `tmux-input.cjs` 两处重复，易漂移。
- **L5. direct-pty `onData` 同步 `appendFileSync`**（`:1368`）。高吞吐阻塞主进程。tmux 为默认后端，direct-pty 多为 demo / 降级路径，优先级低。

---

## ⚠️ 已排除 / 已修正的初查结论（核实价值，勿按草稿误改）

### 1. `enqueueAgentInput` 的 `.catch(() => {})` 不是"吞掉注入失败"

- **位置**：`src/main/main.cjs:2594-2606`（`.catch` 在 `:2598`）；调用点 `agents:input`（`:2996`）、`route:send` → `routeMessage` → `enqueueAgentInput`（`:2703`）
- **结论**：该 `.catch(() => {})` 吞的是**上一个 operation 的错误**（保证一次失败不阻塞队列，这是串行队列的标准做法），**不是**当前 operation。当前 operation 的错误会随返回的 `next` 传回 IPC handler → renderer 的 `.catch(onNotice)`，**会上报，不静默**。
- **真正的关联隐患**：它与 H1 叠加——串行队列 + 每操作同步阻塞 = 快速输入时操作堆积、延迟累积。根因在 H1，不在 `.catch`。**不要去改 `.catch` 来"修复"注入静默**，那是误判。

### 2. renderer 的 status/workspace 监听不会反复重注册

- **位置**：`src/renderer/App.jsx`，`loadWorkspaceData`（`:1849`）、`refreshDocuments`（`:1862`）
- **结论**：两者**都用了 `useCallback`**，监听 effect 依赖稳定，不会每次 render 重注册监听器。此项可放心，非问题。

---

## 处理优先级（建议）

| 顺序 | 项 | 一句话 |
|---|---|---|
| 先做 | **H2** 退出总超时 | 最低风险、收益明确，防"退不掉"，影响所有用户 |
| 先做 | **H1** 输入路径去同步探活/读盘 | 本次改动引入的回归面，直接影响打字体验 |
| 先做 | **L1** 删死代码 | 趁记忆新鲜，零风险 |
| 次之 | **H3** runtime 原子写 + 锁 + 容错 | 架构可靠性命门 |
| 次之 | **M1** 只读路径不写盘 | 数据安全（防覆盖用户编辑）+ 性能 |
| 排期 | M2 / M3 / M4 + L2~L5 | 健壮性 / 整洁度 |

**最低风险、立刻可做**：H2（退出超时）、L1（删死代码）——改动小、零风险、有 smoke 兜底。
**最值得专门排期**：H1 + H3——一个管"输入不卡"，一个管"状态不丢/不坏"。

---

## 备注

- 本文为核实版，结论已对照源码确认。草稿 `20260615-code-review-findings-[todo].md` 中的"待核实"项以本文为准；该草稿可在本文合并后归档或删除。
- 涉及输入路由 / 终端过滤 / composer 路由 / tmux view 的复现与回归命令，见 `20260614-attached-view-submit-and-packaged-restore-[finish].md`。

---

## 2026-06-15 追加：闪烁/卡顿修复后的对抗式审计闭环（21 agent workflow）

清缓存重建后又跑了一轮多 agent 对抗式审计（startup/recovery/render/input 四维并行 + 逐条 refute 验证 + 完整性 critic），确认 9 条（去重 6 条）。本轮**已修**的：

| 状态 | bug | 位置 | 修复 |
|---|---|---|---|
| ✅ 已修 | **H2 退出无总超时**（草稿 #1 / 本文 H2 的落地） | `before-quit` | 加 `QUIT_RELEASE_TIMEOUT_MS`（默认 8s，`AITEAMS_QUIT_TIMEOUT_MS` 可调）watchdog，超时 `app.exit(0)` |
| ✅ 已修 | **status throttle timer 泄漏 + 快速重启状态错乱**（上一轮加节流引入的回归） | `stopAgent`/`stopAllAgents`，新增 `cancelTmuxStatusInference` | stop 时清 `tmuxStatusThrottleTimers`，防旧 timer 占位卡住新 agent 的状态推断 |
| ✅ 已修 | **snapshot restore 抛异常→`pendingTerminalOutputRef` 损坏→实时输出花屏** | `App.jsx` restoreSnapshot catch | catch 里重置 `pendingTerminalOutputRef.current = ""` |
| ✅ 已修 | **`appendBoundedTerminalWrite` 2MB 边界切断转义序列→花屏** | `terminal-wheel.mjs` | 左截断后用 `indexOf("\x1b")` 对齐到转义边界 |
| ✅ 已修 | **view session 名 agentId 不 sanitize**（与 slugify 同源，含 `.` 的 agent id 永久 detached） | `tmux-view.cjs viewSessionName` + `main.cjs destroyTmuxViewSessionForAgent` | 新增 `sanitizeSessionSegment`（`.`/`:`→`-`），两处统一走 `viewSessionName` |

**未修（需专门排期，本轮不动以免回归正在工作的 reconcile/zombie 恢复）**：

- **H3 runtime.json 无锁 + 非原子写 + 无解析容错**（本文 H3，仍未做）—— 架构可靠性命门，建议下一个专项：`writeJson` 原子写（tmp+rename）+ 进程内 mutex + `readJson` try/catch fallback。
- **stale dead pane 残留 runtime.json + reconcile 同窗口换 pane 时 view 缓存 stale + `pastedSinceSubmit` 跨 pane 泄漏**（audit 五）—— medium，触发需 reconcile 在同 window 内换 pane 且输入恰好在 5s 窗口内到达。修复要动 `reconcileRuntimePanesFromTable` 主动清死 pane + reconcile 换 pane 时强制刷新 view 缓存，delicate，单独排期。

验证：`node --check`（main/tmux-view）+ `import` check（terminal-wheel）+ `npm run smoke`（11 套全过）+ `npm run build`（过）。审计用真 agent（claude/codex/kimi）在 dev 真实 workspace 验证了 workspace 切换 + 启动无 duplicate session。
