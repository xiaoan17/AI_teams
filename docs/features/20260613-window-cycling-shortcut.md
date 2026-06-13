# 方向键循环切换活动窗口

- 日期：2026-06-13
- 状态：已实现（`App.jsx` 全局 keydown effect）
- 关联：`src/renderer/App.jsx`（`activeAgentId` 状态、`AgentTerminal` 聚焦）

## 1. 需求

用户希望用方向键 `←` / `→` 在多个 agent 终端窗口之间快捷切换活动窗口，并支持
**循环**：在最左侧窗口按"向左"跳到最右侧，在最右侧按"向右"回到最左侧。

## 2. 这个 feature 合适吗？——结论先行

**需求合理，但"裸方向键"实现方向错误，必须改用「修饰键 + 方向键」。**

循环切换活动窗口本身是个好需求（键盘流、不离手切窗口）。但用无修饰键的
`←` / `→` 直接触发，会与终端的核心能力发生不可调和的冲突（见第 3 节）。
经讨论决定采用 **`Cmd/Ctrl + Alt + ←/→`** —— 这是 iTerm2、VS Code
等成熟终端工具的标准做法，保留了"用左右键循环切窗"的心智模型，只多按一个修饰键。

## 3. 核心冲突分析

### 冲突 A：终端内的光标左右移动（致命）

每个 `AgentTerminal` 内部跑的是 xterm.js + tmux + 真实 CLI（如 Claude Code）。
当终端聚焦时，`←` / `→` 是 **readline / 编辑器里移动光标的基本按键**，必须原样
透传给 PTY。若全局拦截裸方向键来切窗口，等于剥夺终端最基本的编辑能力——
用户想把光标左移一格改个字，窗口却跳走了。**不可接受。**

### 冲突 B：事件到不了全局处理器（可靠性）

当前 `activeAgentId` 完全由鼠标 `onFocus`（`App.jsx:1894`
`onFocus={() => setActiveAgentId(agent.id)}`）驱动。一旦某个终端聚焦，
xterm.js 的隐藏 textarea 会优先消费按键并发给 PTY，挂在 `document` 上的
全局 `keydown` 监听在冒泡阶段经常拿不到、或拿到时 xterm 已处理过。
所以"裸方向键全局切窗"既危险又不可靠。

### 为什么「修饰键 + 方向键」能解决两个冲突

- `Cmd/Ctrl + Alt + ←/→` 这种组合 **不是** 任何 CLI / readline 的常用编辑键，
  透传给 PTY 也基本无副作用；
- 我们在 **捕获阶段**（`addEventListener("keydown", handler, true)`）监听，
  在 xterm 消费之前命中组合键并 `preventDefault()` + `stopPropagation()`，
  阻断其进入 PTY，从根本上规避冲突 B。

### 行业惯例对照

| 工具 | 切窗快捷键 |
| --- | --- |
| tmux | `prefix + ←/→`（前缀模式） |
| iTerm2 | `Cmd + Alt + ←/→` |
| VS Code | `Ctrl + Alt + ←/→`（移动编辑器组） |
| 浏览器标签 | `Ctrl + Tab` / `Ctrl + Shift + Tab` |

## 4. 现有架构（事实依据）

- `agents` 是 **有序数组**（`App.jsx:1643`），渲染顺序即数组顺序，天然定义循环序列。
- `activeAgentId` 是单一字符串状态（`App.jsx:1645`），切换 = 把它指向序列里的下/上一个。
- `minimizedAgents` 是一个 `Set`（`App.jsx:1655`）。被最小化的窗口在网格中不可见，
  **切换时必须跳过**它们，否则会"切到一个看不见的窗口"。
- 已有的全局键盘监听先例：`Escape` 关闭弹层（`App.jsx:1138`、`1345`），
  说明全局 `keydown` 模式在本项目已被采用。

## 5. 设计方案

### 5.1 快捷键

- 向后（右）：`Cmd+Alt+→`（macOS）/ `Ctrl+Alt+→`（其他平台）
- 向前（左）：`Cmd+Alt+←`（macOS）/ `Ctrl+Alt+←`（其他平台）
- 平台判定复用渲染进程已有的 `navigator.platform` / `window` 上下文，
  统一收敛成 `isMac` 布尔值。

### 5.2 可见窗口序列

切换只在"可见且未最小化"的 agent 之间进行：

```
visibleAgents = agents.filter(a => !minimizedAgents.has(a.id))
```

若 `visibleAgents.length <= 1`，快捷键直接 no-op（但仍 `preventDefault`，
避免组合键漏进 PTY）。

### 5.3 循环索引计算

```
const idx = visibleAgents.findIndex(a => a.id === activeAgentId);
// 找不到当前活动（如刚被最小化）时，向右默认落到第 0 个，向左落到最后一个
const len = visibleAgents.length;
const next = dir === "right"
  ? (idx < 0 ? 0 : (idx + 1) % len)
  : (idx < 0 ? len - 1 : (idx - 1 + len) % len);
setActiveAgentId(visibleAgents[next].id);
```

`% len` 自动实现首尾环绕（最右→最左、最左→最右）。

### 5.4 切换后让终端真正聚焦

仅改 `activeAgentId` 只会改高亮（`terminal-card-active`），不会把键盘焦点
移进新终端。**好消息：这一步已天然满足**——`AgentTerminal` 内 `App.jsx:655-660`
已有 effect，在 `active` 变 true 时调用 `termRef.current.focus()`。因此切换
`activeAgentId` 后目标终端自动聚焦，可直接键入，无需额外改动。

### 5.5 监听实现要点

```
useEffect(() => {
  const onKeyDown = (event) => {
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod || !event.altKey) return;
    if (event.key === "ArrowRight") { cycle("right"); }
    else if (event.key === "ArrowLeft") { cycle("left"); }
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("keydown", onKeyDown, true); // 捕获阶段，先于 xterm
  return () => document.removeEventListener("keydown", onKeyDown, true);
}, [agents, activeAgentId, minimizedAgents, isMac]);
```

依赖项必须包含 `agents` / `activeAgentId` / `minimizedAgents`，否则闭包读到旧值。

## 6. 潜在问题与对策

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| 修饰键漏进 PTY | 命中后未阻断，组合键被发给 CLI | 捕获阶段监听 + `preventDefault` + `stopPropagation` |
| 切到不可见窗口 | 跳到被最小化的 agent | `visibleAgents` 过滤 `minimizedAgents` |
| 切换后焦点没进终端 | 只高亮不可打字 | `active` effect 中 `terminal.focus()` |
| 只有 0/1 个窗口 | 无意义切换 | `len<=1` 时 no-op |
| 平台差异 | macOS 用 Cmd、其他用 Ctrl | `isMac` 收敛 |
| 与 OS / 输入法占用冲突 | 某些系统把 `Cmd+Alt+←` 用于切桌面 | 评审时实测；保留把组合键做成可配置的余地 |
| 弹层打开时误触 | import / 设置弹层开着时切窗 | 弹层 open 时 `cycle` 早退 |

## 7. 验收标准

1. 多窗口下，`Cmd/Ctrl+Alt+→` 高亮焦点顺序后移，到最右回绕到最左；`←` 反向且回绕。
2. 切换后目标终端可直接键入，无需再点鼠标。
3. 在终端内按裸 `←` / `→`，光标正常左右移动，**绝不**切换窗口。
4. 最小化的窗口被跳过。
5. 0 或 1 个可见窗口时快捷键无副作用。

## 8. 不做什么（范围之外）

- 不引入 tmux 前缀模式。
- 不做窗口拖拽重排（循环顺序就用现有 `agents` 数组顺序）。
- 暂不做快捷键自定义配置（列为后续可选项）。
