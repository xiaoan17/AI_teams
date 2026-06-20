# Task 008: 面板标题显职位（public state 透传 role + renderer）

**type**: impl
**depends-on**: ["007"]
**触点**:
- `src/main/main.cjs`：`directAgentPublicState`（约 L1448）、`tmuxAgentPublicState`（约 L1966）—— public state 增加透传 `role`/`title`
- `src/renderer/App.jsx`：面板标题渲染处（用 `agent.name` 的地方）
- 不动 tmux 窗口名（C4）

## 目标

实现诉求③：面板标题显示职位名（如 `🎨 设计师`）。无 role 时回退到现有 `name`。**tmux 窗口名保持稳定 id，绝不改**（C4）。

## 实现要点（描述 what）

1. 主进程 public state（两个函数都要改，对应 direct-pty 与 tmux 两种 backend）：
   - 在返回对象里增加 `role: agent.role || null`（至少含 `title`/`emoji`）。
2. renderer：
   - 计算显示标题：`agent.role?.emoji + " " + agent.role?.title` 优先，否则 `agent.name`。
   - 替换面板标题渲染的取值（仅显示层，不影响任何 id/key/路由）。
3. 确认 tmux `new-window -n` 仍用 `agent.id`（搜 main.cjs 的 `"-n"`），**不改**。

## BDD Scenario

```gherkin
Scenario: 有 role 的员工面板显示职位名
  Given 一个 agent 含 role.title="设计师" role.emoji="🎨"
  When App 渲染该面板标题
  Then 标题显示 "🎨 设计师"
  And 该 agent 对应的 tmux 窗口名仍是其 id（未变为中文/职位名）

Scenario: 无 role 的旧 agent 回退显示 name（C1）
  Given 一个 agent 无 role，name="Claude Code"
  When 渲染面板标题
  Then 标题显示 "Claude Code"
```

## 验证

```bash
npm run build
npm run smoke:tmux-runtime-unit   # 确认 window_name↔pane 映射逻辑未受影响（C4）
# 人工：npm run dev → 雇个 designer → 面板标题显示 🎨 设计师；
#   tmux list-windows 看窗口名仍是 designer（非中文）
```

## 完成定义

- 标题按 role.title 显示，无 role 回退 name。
- tmux 窗口名未变（`smoke:tmux-runtime-unit` 绿，list-windows 人工确认）。
