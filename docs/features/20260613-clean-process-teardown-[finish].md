# 干净移除后台进程 — Start/Stop/叉号/退出的进程生命周期治理

状态：已实现（[finish]）
日期：2026-06-13
关联代码：`src/main/process-tree.cjs`、`src/main/main.cjs`、`scripts/process-tree-smoke.cjs`

## Summary

UI 上的 Stop、Stop All、移除 agent（叉号）以及关窗退出，原本都依赖 tmux 的
`kill-pane` / `kill-session` 来停止 agent。实测证明这不可靠：agent CLI（codex、
claude 等）会 fork 出 MCP server、`node_repl`、helper 等子进程，这些子进程通过
`setpgid`/`setsid` **脱离了 pane 的进程组**，tmux 的信号带不走它们；而退出路径更是
存在确定性 bug——只清理了镜像 view session，承载 agent 的 base session 整个残留。
结果是用户"停止"或"退出"后，后台仍有 agent 进程存活，造成端口占用、状态错乱等异常。

本特性引入按 **PID 血缘**回收整棵进程树的原语 `killProcessTree`，让四条停止路径共用
同一套回收逻辑，确保停止/移除/退出后 agent 的进程树（含逃逸子进程）被彻底回收，且
绝不误杀机器上无关的同名进程。

## 问题取证（本机 ps 实测）

pane 直接运行 `agentShellCommand`（如 `codex --no-alt-screen`），CLI fork 的子进程
PGID 与父进程不同：

```
PID    PPID   PGID
82208  9332   82208   codex --no-alt-screen ...        ← pane 主进程，自成进程组
83311  82208  83311     node_repl                       ← 子进程，PGID 独立
83312  82208  83312     SkyComputerUseClient mcp         ← 子进程，PGID 独立
```

三层根因（逐层加码）：

1. **tmux 信号不可靠**：`kill-pane`/`kill-session` 只对 pane 前台进程发 SIGHUP，CLI
   忽略 HUP 或已 setsid 时主进程都未必死。
2. **进程组信号不够**：即便抓 `#{pane_pid}` 做 `kill -- -<pgid>`，也带不走上面 PGID
   独立的孙子进程。MCP server 普遍这么做。
3. **退出路径漏杀 base session**：`releaseCurrentWorkspaceBackend` 在 tmux 分支只调用
   `tmuxViews.reset()` + `destroyTmuxViewSessionsForBase()`，没有 kill base session。
   正常关窗退出时 `aiteam-*` base session 整个留存，里面 CLI 继续后台运行。

> 端到端复现：以 `setsid sleep` 模拟逃逸子进程，按进程组信号无法回收，按 PID 血缘
> 遍历可完整清空。

## Goals

- **G1 干净**：停止/移除/退出后，对应 agent 的进程树（含 setsid/setpgid 逃逸子进程）
  全部回收，不留孤儿。
- **G2 一致**：单个 Stop、Stop All、叉号、退出、direct-pty 五条路径走同一套回收原语。
- **G3 可信**：回收后才把 runtime/UI 标记为 `stopped`；回收失败可见（状态/日志），不
  静默吞掉。
- **G4 不误杀**：只回收本 app 启动的 agent 进程树（从 app 亲手拉起的 root pid 下钻），
  绝不按进程名匹配，绝不波及机器上无关的 codex/claude 进程。
- **G5 跨后端**：`direct-pty` 后端一并纳入。

## Non-Goals

- 不改 UI、不改 IPC 签名、不改 runtime schema（仅扩展 `reason`/状态取值）。
- 不引入第三方依赖（仅用 `ps` + node 内置 `process.kill`）。
- 不做启动时孤儿清扫（列为后续增强，见"后续工作"）。

## 设计与实现

### 核心原语 `killProcessTree(rootPid)` — `src/main/process-tree.cjs`

1. 以 `rootPid` 为根，从 `ps -axo pid=,ppid=` 快照在内存里**按 PPID 重建子树**（递归收集
   所有后代）。按血缘而非进程组圈定范围，绕过"独立进程组"问题（根因第 2 层）。
2. 对收集到的 PID 集合：先 `SIGTERM`，优雅期内（默认 800ms）轮询子树是否清空；仍存活
   的再 `SIGKILL`。SIGKILL 前**重新快照**，覆盖优雅期内新 fork 的子进程。
3. 全程 best-effort：`ESRCH`（进程已自行退出）、`EPERM`（非本进程可杀）均吞掉，不抛错。

关键正确性修复：`collectDescendants` 仅在 root **仍存活于快照**时才计入 root，避免
"父进程已死、子进程 reparent 到 PID 1"被误判为还活着，从而让优雅期 drain 检测正确收敛。

误杀防护（G4）：root pid 来源只有两个——tmux pane 的 `#{pane_pid}` 或 direct-pty 的
`ptyProcess.pid`，都是本 app 亲手拉起的；只信任从该 root 向下遍历得到的集合，绝不按
进程名匹配。

可测试性：`psSnapshot` / `sendSignal` / `sleep` 三个 seam 可注入，纯函数 + 注入式单测
无需真实进程。

### 接入四条停止路径 — `src/main/main.cjs`

| 路径 | IPC | 函数 | 改动 |
| --- | --- | --- | --- |
| 单个 Stop | `agents:stop` | `tmuxStopAgent` | 先 `reapPaneProcessTree(pane)` 再 `kill-pane`；杀完校验 `#{pane_dead}`，pane 仍活则状态置 `error` 而非谎报 stopped（G3） |
| Stop All | `agents:stopAll` | `tmuxStopAllAgents` | `reapBaseSessionProcessTrees(session)` 遍历所有 pane 回收，再 `kill-session` |
| 叉号移除 | `agents:remove` | `removeAgent` → `stopAgent` | 复用单个 Stop 路径，自动获得回收能力 |
| 退出 / 切 workspace | `before-quit` / `workspace:switch` | `releaseCurrentWorkspaceBackend` | **P0 修复**：补上 base session 进程树回收 + `kill-session`（原来只杀 view） |
| direct-pty Stop | `agents:stop` | `directStopAgent` | `ptyProcess.kill()` 后异步 `killProcessTree(pid)` 回收逃逸子进程（G5） |

辅助函数：`tmuxPanePid`（读 `#{pane_pid}`）、`reapPaneProcessTree`（单 pane 回收）、
`reapBaseSessionProcessTrees`（列举 base session 所有 pane 并逐个回收）。

## 行为变更 ⚠️

**退出 app / 切换 workspace 现在会 kill base session**——agent 进程不再跨 app 重启
存活。这是 G1 的明确目标，但与此前"退出时只 detach view、保留 base session 供下次
reconcile 接管"的行为相反，与 `[[ai-teams-no-acp]]` 记录的"闭环注入 + reconcile"机制
有交集。当前按本设计实现为退出即彻底清理；若需保留后台 agent，可将退出路径改为只
detach + 可选清扫（见"后续工作"）。

## 测试与验收

- 新增 `scripts/process-tree-smoke.cjs`，已注册进 `npm run smoke`（`smoke:process-tree`）：
  - 单元：`parsePsSnapshot` 容错（表头/空行/缩进）、`collectDescendants` 子在父前/root
    最后/不收集无关兄弟/拒绝受保护 root（PID ≤ 1）/防环。
  - 注入式：优雅退出（全程 SIGTERM）与顽固进程（强制 SIGKILL）两条路径。
  - 集成：真实 fork 出 parent→child→grandchild 进程树，回收后断言子树清空。
- 端到端：真 tmux 会话 + `setsid` 逃逸子进程，`killProcessTree` 经 PID 血缘完整清空。
- `npm run build`、`npm run smoke` 全部通过。

验收标准（全部满足）：

1. 单个 Stop 后，该 agent 的 CLI 主进程 + `node_repl`/`*mcp*` 后代全部消失。
2. Stop All 后 base session 与所有 agent 进程树消失，`tmux ls` 无 `aiteam-*`。
3. 关窗退出后 `tmux ls` 无 `aiteam-*` base/view，`ps` 无残留 agent 进程。
4. 叉号移除后同 (1)，且 `agents.json` 已更新。
5. direct-pty 后端同样无残留。
6. 误杀回归：停止 agent 时，机器上无关的 Codex.app / 其它项目 claude 进程不受影响。

## 后续工作

- **启动孤儿清扫**：app 启动 / 切 workspace 时，对将复用的 base session 做一次"上次没退
  干净"的清扫（pane dead 但子树仍有存活进程则先 `killProcessTree` 再重建），兜住崩溃
  退出（未走 before-quit）的场景。
- **优雅期可配置**：当前 800ms 硬编码，可考虑暴露为环境变量 / 配置项，退出场景可缩短。
- **保留后台 agent 选项**：若产品上需要"退出后 agent 继续跑、下次 reconcile 接管"，把退出
  路径改为只 detach + 可选清扫。
