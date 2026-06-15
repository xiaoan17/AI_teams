---
created: 2026-06-15
status: In Progress
state: todo
tags: [tmux, terminal, input-latency, submit-regression, main-thread-blocking, flicker, render, handoff]
---

# Terminal Input Freeze + Dropped Enter (v0.2.3) — Handoff

## 2026-06-15 追加：输出侧闪烁 + 卡顿根因（本轮新修，未提交）

用户复诉「闪烁严重 + 卡顿 + 输入受影响、几乎不可用」。复查发现最痛的「闪烁/卡顿」根因**不在输入路径**（输入路径前序已修好，见下文），而在**输出路径**，且 v0.2.3 发行版就带着：

1. **渲染闪烁** — `src/renderer/App.jsx` 的 `writeOutput` 在 `terminal.write` 完成回调里每帧 `clearTextureAtlas()` + 全屏 `refresh(0, rows-1)`。TUI 持续刷屏时等于每帧丢弃整个字形缓存 + 全屏重画，打掉 xterm 脏区增量渲染 → 持续闪烁。
   **修复**：write 回调不再强制 refresh，让 `terminal.write` 走 xterm 原生增量渲染。`clearTextureAtlas`/`refresh` 与 `resetTerminalMouseModes` 收进 `refreshViewport`，只在 resize / 主题切换 / tab 切回可见这些低频事件触发。

2. **每个输出 chunk 在主线程同步读盘 + 双 spawn** — `main.cjs` tmux view `onData` 对每个 chunk 调 `publicStateForTmuxView` → `loadConfig()`（读盘+回写盘）+ `readRuntime()`（读盘）+ `tmuxAvailable()`/`tmuxHasSession()`（两次同步 `runTmux` spawn）+ `inferStatus` 正则。刷屏时主线程被周期性堵死，而 agent 输出靠主线程 `webContents.send` 推送、输入靠主线程 IPC → 卡顿、输入受影响。
   **修复**：`onData` 里 `emit("agent:data")` 保持即时；状态推断改为 **per-agent trailing 节流**（`scheduleTmuxStatusInference`，默认 200ms，`AITEAMS_TMUX_STATUS_THROTTLE_MS` 可调），复用 `tmuxLastStatusKey` 去重。`tmuxAvailable()` 结果进程内缓存一次。

3. **`loadConfig` 只读路径写盘**（review #4，放大 #2）— `loadAppAgentConfig()` 每次读取无条件 `writeJson`。
   **修复**：仅当 normalized 与磁盘内容确有差异才写；加进程内 config 缓存，按 config 文件 mtime+size 失效（自身 writeJson 或用户手改都会自动失效，无需在写点手动调失效）。`clearTmuxStatusCache()` 顺带清节流 timers。

验证：`npm run smoke`（11 套全过）、`npm run build`（过）、`node --check`（过）。**GUI 手动验证（dev:demo）仍需人工确认**：刷屏不闪、打字不卡、Enter 提交、切 tab/主题/拉伸重绘正确、开局不停横线。未补 config-cache 专项 smoke —— `loadAppAgentConfig` 在 main.cjs 内且依赖 Electron `app.getPath`，单测需先把它抽到独立模块（如 `tmux-runtime.cjs` 那样），超出本轮范围。

---

## Summary

v0.2.3 的随包发行版里，agent 终端出现三连症状：**打字卡顿、输入丢失/错乱、按 Enter 不提交**，开局还常停在一片横线。

调查定位到两个独立但叠加的根因，都在逐键输入热路径上：

1. **每个按键同步阻塞主进程**（卡顿 / 横线 / 输入堆积）
2. **bracketed paste 之后零延迟发提交键，回车被终端吞掉**（Enter 不提交，甚至丢文本）

第 1 点是 v0.2.3 为修「Enter 提交不可靠」而引入的回归；第 2 点是同一次改动**没把提交时序补上**导致的新问题。两者都已在工作区改好（**未提交**），相关 smoke 已通过；**尚未做 GUI 手动验证、全套 smoke、重新打包**。

## 调查现场 / 证据链

### 阻塞链（症状 1）

```
agents:input (main.cjs IPC)
  -> enqueueAgentInput (per-agent 串行队列)
    -> writeToAgent -> tmuxWriteInput
        旧实现每次调用（= 每个按键）：
          ① readRuntime()      = readFileSync + JSON.parse   （同步读盘）
          ② tmuxPaneDead(pane) = execFileSync tmux display-message （同步 spawn）
          ③ 每个 action 再同步 spawn：
               key  -> send-keys                       (1 次)
               text -> load-buffer+paste-buffer+delete-buffer (3 次)
```

即每按一个键 ≈ 3–5 次同步 `execFileSync("tmux")` 堵在 Electron 主线程。又因输入队列串行，打字快/粘贴大段时操作堆积，停手后还要慢慢排空。agent 终端输出靠主进程推送（tmux-view onData → webContents.send），主线程一冻推送就停，xterm 停在最后一帧 → 开局的 TUI 边框 `─/━` 就是「横线」。

### 回车时序竞争（症状 2）

用独立 `cat` 探针 pane（`split-window` 出来的，不碰真实 agent）实测「paste-buffer -p 之后等待 N ms 再 send-keys 提交键」：

| 延迟 | cat 回显结果 | 结论 |
|---|---|---|
| 0ms（旧逐键路径就是这个） | 文本+回车**全丢** | Enter 失灵根因 |
| 30ms | 文本进、回车**被吞** | 不够 |
| 60ms | 文本+回车都成功 | 可靠下限 |
| 80ms | 成功 | 安全区，注入广播 (`pasteAndSubmit`) 一直用这个值 |

`cat` 是行缓冲、反应极快；真实 TUI（Kimi/Codex/Claude 带 bracketed-paste 状态机）更慢，所以取默认 80ms 留余量。

> 诊断中误用空 pane id 导致 `paste-buffer -t ""` 回退到当前活动 pane，曾误投几个字符进 kimi 输入框，已用 `C-u` 清掉、未提交。教训：探针一定要拿到确定的非 agent pane id。

## 关键约束（来自已 finish 的前序 issue）

`docs/issues/20260614-attached-view-submit-and-packaged-restore-[finish].md` 把提交目标钉死，**不可违反**：

- **Enter 提交必须用 `tmux send-keys` 到真实 agent pane**；禁止走 attached view PTY 的裸 `\r`（某些 TUI 不当它是真按键，命令卡在提示符不提交）。
- 2026-06-15 真实 Claude/Kimi 验证推翻了当时的 `C-m` 键名假设：当前提交键必须是共享常量 `TMUX_SUBMIT_KEY = "Enter"`，见 `docs/issues/20260615-real-agent-enter-submit-regression-[finish].md`。
- 禁止把整个 xterm 输入流走 `paste-buffer`；text/paste 可以 paste，但**控制键必须走 send-keys**，不能藏进 paste 文本。
- 同一 agent 的输入必须串行，Enter 不能越过先到的 text。

**所以「回退到 PTY 直写」这条路是被否决的** —— 它正是那次 issue 修掉的东西。本次修复保留 `tmux send-keys` 提交机制，但提交键名必须走共享常量。

## 已实现的改动（未提交）

### `src/main/tmux-input.cjs`
- 新增 `async writeInputActions(agentId, data, deps)`：依赖注入的纯函数，把投递逻辑从 main.cjs 抽出来以便单测。
- **批次入口只解析 pane 一次、探活一次**（`resolvePane` / `isPaneDead`），循环内不再每 action 探活。
- **提交时序**：仅当「该批次 paste 过文本」且当前 key 是 `TMUX_SUBMIT_KEY` 时，发 Enter 前 `await sleep(submitDelayMs)`。普通字符、纯方向键/退格**不延迟**。

### `src/main/main.cjs`
- 新增 `resolveAgentPane(agentId)`：pane **优先取自内存** `tmuxViews.expectedWindow(agentId)?.pane`（reconcile 持续维护），仅 view 未 attach 时回退 `readRuntime()`。砍掉每键同步读盘。
- `tmuxWriteInput` 改为 `async`，投递原语全部走 **`runTmuxAsync`**（不再 `runTmux` 同步 spawn），并注入 `submitDelayMs`（读 `routing.submit_delay_ms`，默认 80）+ `sleep`。
- 实测：`tmuxViews.expectedWindow().pane` 与 `readRuntime().pane` 是**同一个 pane id**（session group 共享 pane），所以换内存源不改变投递目标，只是去掉读盘。

### `scripts/agent-input-queue-smoke.cjs`（untracked 新文件）
- 锁住「每批 resolvePane 一次、isPaneDead 一次」。
- 锁住核心修复：**Enter 前的 submit delay 只在 paste 后触发一次、且紧贴 `TMUX_SUBMIT_KEY` 之前**；纯方向键批次不延迟；缺失 pane 必须 reject。

> 注：`tmuxWriteInputFallback` (main.cjs) 现已是 **dead code**（无人调用，逻辑与热路径重复）。本次未删（超出范围），建议后续清理，避免误导。

## 已验证 / 未验证

已过（命令）：
- `npm run smoke:agent-input-queue` ✅
- `npm run smoke:tmux-input` ✅
- `npm run smoke:tmux-view` ✅
- `node -c` 两个改动文件语法 ✅

**还没做（下一步必须补）**：
- [ ] `npm run smoke`（全套兜底）
- [ ] `npm run build`
- [ ] **GUI 手动验证**：`npm run dev:demo`（dev 用真实 workspace 时 `.aiteam` 三个 agent 都 disabled，起不出可输入终端 → 用 demo）。起 app 后启动一个 agent，在终端里：
  1. 快速连打一长串字符 + 粘贴大段文本 → 确认不卡、字符即时、不丢不乱
  2. 打字后按 Enter → **确认能提交**（这是本次核心修复，必须人工确认）
  3. 确认开局渲染正常、不停在横线
- [ ] 重新打包 + 装到 `/Applications/AI Teams.app`（步骤见下）

## 重新打包步骤（来自前序 issue，clean 安装）

```bash
npm run package:mac:local
rm -rf "/Applications/AI Teams.app"
ditto "out/AI Teams.app" "/Applications/AI Teams.app"
codesign --verify --deep --strict --verbose=1 "/Applications/AI Teams.app"
# 确认装进去的是修好的源码：
rg "submitDelayMs|resolveAgentPane|writeInputActions" "/Applications/AI Teams.app/Contents/Resources/app/src/main"
```

不要用 plain `ditto` 覆盖已装的旧 bundle（会留 stale hashed assets，签名校验失败）。

## 重要背景：工作区有大量未提交改动

`src/main/main.cjs` 在我开始前**就已是 modified 状态**，未提交改动远不止输入这一处，还包括（非本次调查产物）：
- routing `default_agent` 失效时修复为第一个 enabled agent
- `mostRecentWorkspaceRoot` 打包启动恢复最近真实 workspace
- `tmuxPasteAndSubmitAgent` 简化

**提交前需决定这些既有改动怎么处理**（一起提交 / 拆分 / 丢弃）。本次输入修复只动了 `tmuxWriteInput` + 新增 `resolveAgentPane` + import，与上述既有改动在同一文件但逻辑独立。

## 固有取舍（需知情）

交互式逐键输入下，每次回车前等一个 `submit_delay_ms`（默认 80ms），会让「按 Enter → 提交」有轻微延迟感。这是保留 `tmux send-keys` 且避免 paste 竞争后的代价，只发生在回车那一下，不影响打字。可通过 `.aiteam/agents.json` 的 `routing.submit_delay_ms` 调整（实测 ≥60ms 才可靠）。

## 快速诊断命令

```bash
# 活的 agent session / pane
tmux ls | grep '^aiteam-' | grep -v '\-view\-'
tmux list-panes -s -t <session> -F '#{window_name} pane=#{pane_id} dead=#{pane_dead} cmd=#{pane_current_command} in_mode=#{pane_in_mode}'

# 抓提示符
tmux capture-pane -p -e -S -80 -t %pane

# 主进程日志（输入报错会落这里）
tail -100 "$HOME/Library/Application Support/ai-teams/logs/main-$(date +%F).log"
```
