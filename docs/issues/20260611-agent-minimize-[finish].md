# Feature: Agent 终端面板最小化(侧栏第三按钮)

日期:2026-06-11
状态:已实施(2026-06-11,纯 renderer 改动;浏览器实测通过)

## 1. 背景:现有状态体系梳理

在设计"最小化"之前,先明确现状:agent 的状态分两层,**后端运行状态**(描述进程/会话真实情况)和**前端 UI 状态**(描述用户怎么看它)。最小化属于第二层,与第一层完全正交。

### 1.1 后端运行状态(单一事实来源)

状态值定义在 `aiteam.py:550-580` 与 `src/main/main.cjs`(inferStatus / cmd_status),前端标签映射在 `src/renderer/App.jsx:132-141`:

| 状态值 | 前端标签 | 含义 | 颜色分类(`statusClass`, App.jsx:143-148) |
|---|---|---|---|
| `stopped` | Stopped | 用户停止 / session 不存在 | 灰 `status-stopped` |
| `starting` | Starting | 进程刚拉起 | 绿 `status-running` |
| `running_or_idle` | Ready | 运行中或空闲(启发式) | 绿 `status-running` |
| `waiting_input` | Needs Input | 输出命中等待模式(y/N、press enter 等) | 黄 `status-waiting` |
| `exited` | Exited | 进程退出 | 红 `status-error` |
| `error` | Error | 启动失败 / tmux 异常 | 红 `status-error` |
| `missing_runtime` | Missing Runtime | runtime.json 无记录 | 红 `status-error` |
| `pane_missing` | Pane Missing | 记录的 tmux pane 已不存在 | 红 `status-error` |

主要流转:

```
stopped ──startAgent──▶ starting ──输出到达──▶ running_or_idle ◀──▶ waiting_input
   ▲                        │                        │   (等待模式匹配/消失)
   │                        └──启动失败──▶ error      │
   └────────── stopAgent ◀───────────────────────────┤
                                进程退出──▶ exited ◀──┘
                                pane 丢失──▶ pane_missing(tmux 每 5s reconcile)
```

传递机制:后端通过 IPC `agent:status` 事件推送(`src/main/main.cjs:688/699/1027`),并持久化到 `.aiteam/status/{agentId}.json`;前端在 `App.jsx:920-928` 监听并合并进 React state。

### 1.2 现有前端 UI 状态

- **侧栏整体收起** `sidebarCollapsed`:localStorage 持久化(`aiTeams.sidebarCollapsed`),268px ↔ 64px(App.jsx:881-886,styles.css:46-48)。
- **终端面板可见性**:目前**完全由运行状态推导**——`terminalAgents = enabledAgents.filter(a => !stoppedOrExited(a))`(App.jsx:1043-1050),即"在跑就显示,停了就不显示",用户没有手动控制权。
- **布局**:1/2/3 个 agent 分别为全宽/二分/三分 grid,4+ 横向滚动(styles.css:617-645)。

### 1.3 缺口

用户想临时收起某个 agent 的终端(例如让另一个 agent 占满屏幕专注观察),目前唯一手段是 **stop 该 agent**——但这会杀掉 tmux pane、中断任务,代价完全不对等。缺少一个"**继续跑,但别占我屏幕**"的操作。

## 2. 方案:引入纯前端的 `minimized` UI 状态

### 2.1 核心设计原则

1. **最小化不是第 9 个运行状态。** 不进 `infer_status`、不进 `.aiteam/status/*.json`、不发 IPC、不动 tmux pane。它只是 renderer 里一个 `Set<agentId>`,叠加在运行状态之上。这样后端状态机零改动,也不会污染钩子状态文件的语义。
2. **最小化 ≠ 停止。** agent 继续运行、日志继续写、`agent:status` 事件继续更新侧栏圆点。
3. **可发现、可恢复。** 被最小化的 agent 在侧栏有明确视觉标记,一键还原。

### 2.2 状态模型

```
面板可见 = agent.enabled && !stoppedOrExited(agent) && !minimized.has(agent.id)
```

- 持久化:localStorage key `aiTeams.minimizedAgents`(JSON 数组),与 `sidebarCollapsed` 同模式,按 workspace 维度存(避免切 workspace 串台)。
- **自动清除规则**:agent 进入 `stopped` / `exited` / `error` 时,从 `minimized` 中移除该 id。理由:停止后面板本就不显示,残留 flag 会导致"下次启动后面板神秘消失",这是最容易踩的坑。

### 2.3 侧栏交互(本 feature 的入口)

`agent-actions` 区(App.jsx:637-667)由单按钮改为双按钮:

| agent 状态 | 按钮组 |
|---|---|
| `!enabled` | `Off` 标签(不变) |
| stoppedOrExited | `▶` 启动(不变,不显示最小化——没面板可收) |
| 运行中 + 未最小化 | `▁`(最小化) + `■`(停止) |
| 运行中 + 已最小化 | `▣`(还原) + `■`(停止) |

- 图标建议:最小化 `▁`(U+2581),还原 `▣` 或 `◰`;title 分别为 "Minimize panel" / "Restore panel"。
- 已最小化的 agent 行加 `agent-row-minimized` 类:名称变暗 + 名称旁小标记,但**状态圆点保持真实颜色**——尤其 `waiting_input` 的黄点必须照常显示,否则用户会错过确认请求。
- 点击已最小化 agent 的行(onSelectAgent)时顺带还原面板,这是最自然的"找回"路径。

### 2.4 终端区行为

- `terminalAgents` 过滤条件追加 `!minimized.has(agent.id)`,grid 布局自动按剩余数量重排(现有 `terminalLayoutCount` 逻辑无需改动)。
- 全部 agent 都被最小化时,空状态区(App.jsx:1097-1107)显示 "N 个 agent 已最小化,点击侧栏还原",避免用户以为出了故障。
- xterm 实例**不销毁**:面板隐藏期间保留 terminal 对象与数据订阅(仅从 DOM 卸载或 `display:none`,实现时二选一;倾向保留挂载 + `display:none`,还原时只需 `fit()`,避免重建/重放日志)。需要注意隐藏期间 resize 不触发,还原时必须重新 fit 并同步 tmux pane 尺寸。

### 2.5 边界情况

| 场景 | 行为 |
|---|---|
| 最小化期间 agent 变为 `waiting_input` | 侧栏圆点变黄(已有机制),agent 行追加脉冲/高亮提示;**不自动弹回**面板(避免打断用户当前专注的面板),v2 可加"自动还原"开关 |
| 最小化期间 agent `exited`/`error` | 自动清除 minimized flag;面板本就因 stoppedOrExited 不显示,侧栏红点提示 |
| 最小化的 agent 被 stop 再 start | start 时面板正常显示(flag 已在 stop 时清除) |
| 顶部批量 `End` → `Start`(App.jsx:618-621) | 同上,批量 stop 清除全部 flag |
| 路由注入消息给已最小化 agent | 照常注入(后端无感知);若注入目标处于最小化,可在侧栏行短暂高亮提示"有消息进入" |
| 所有面板最小化 + 新 agent 启动 | 新面板正常出现 |

### 2.6 不做什么(scope 外)

- 不做"最小化到底部任务栏/缩略图"——侧栏行本身就是缩略指示器。
- 不动 tmux:不 kill pane、不 resize pane 到 0、不切 window。tmux attach 视角(`aiteam view`)看到的布局不受影响。
- 不做后端持久化(跨机器/跨 CLI 同步最小化状态没有需求)。

## 3. 实现要点(预估改动面)

全部集中在 renderer,后端零改动:

1. `App.jsx`:新增 `minimized` state(Set,init 自 localStorage)+ `toggleMinimize(id)`;`onAgentStatus` 回调里对 stopped/exited/error 清 flag;`terminalAgents` 过滤条件加一项;侧栏按钮区加第三按钮;空状态文案分支。
2. `styles.css`:`agent-row-minimized` 样式;`agent-actions` 容纳两个 icon-button 的间距;(若走 `display:none` 路线)隐藏面板的类。
3. 终端组件:还原时调用 fit + 尺寸同步。

预估 ~100-150 行改动,无迁移、无 schema 变更。

## 4. 验收标准

- [x] 运行中 agent 的侧栏行同时出现"最小化"和"停止"两个按钮,互不误触(stopPropagation)。
- [x] 点击最小化:面板立即从 grid 消失,其余面板自动重排;agent 进程不受影响(tmux pane 存活,日志继续)。
- [x] 点击还原 / 点击 agent 行:面板回到 grid,xterm 内容完整、尺寸正确(无错位,需重新 fit)。
- [x] 最小化状态重启 app 后保留(localStorage),但 stop/exit 后自动清除。
- [x] 最小化期间 `waiting_input`:侧栏黄点 + 高亮可见(`agent-dot-pulse` 脉冲)。
- [x] 全部最小化时空状态文案正确,不显示"无 agent 运行"的误导信息。

实现说明:面板隐藏走"保留挂载 + `display:none`"路线(`terminal-card-hidden`),还原时由 ResizeObserver + 显式 scheduleResize 重新 fit 并同步 pane 尺寸;持久化 key 为 `aiTeams.minimizedAgents:{workspaceRoot}`。
