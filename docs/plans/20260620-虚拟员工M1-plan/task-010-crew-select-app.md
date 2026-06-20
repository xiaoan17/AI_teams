# Task 010: App 组队选择器（3 工位各选员工）

**type**: impl
**depends-on**: ["007", "008", "005"]
**触点**:
- `src/main/main.cjs`：新增 IPC handler —— `roles:list`（列全局库）、`roles:hire`（实例化，桥接 005 逻辑或复用其 Python/JS 等价实现）、`crew:start`（按本次选择启动）
- `src/main/preload.cjs`：暴露上述通道
- `src/renderer/App.jsx`：在现有 3-agent 配置界面加「组队选择器」UI（每个工位一个下拉/卡片选员工）

## 目标

把「3 工位各选员工」做进 App（你的目标交互入口）。打开项目 → 弹组队选择器 → 每工位选一个员工 → 注入启动。体现 C5（关掉不复用本次组队，下次重新弹）。

## 行为契约（IPC）

```
roles:list  () -> [{ id, title, emoji, summary, hired: bool }]
roles:hire  (id) -> { ok, persona_dir }       # 实例化（已雇佣则幂等）
crew:start  (roster: string[]) -> { session, started: string[] }  # 仅启动本次选中的
```

## BDD Scenario

```gherkin
Scenario: 三工位各选不同员工并启动
  Given 全局库含 designer/manager/prd
  When 我在组队选择器为工位1/2/3 分别选 designer/manager/prd 并确认
  Then 启动 3 个面板，标题分别显示对应 role.title（依赖 008）
  And 每个面板的 claude 以对应员工身份运行（依赖 007 注入）

Scenario: 关掉后重开不复用上次组队（C5）
  Given 上次选了 designer/manager/prd
  When 我关掉 App 再打开
  Then 重新弹出组队选择器（不自动复用上次选择，不自动复活进程）

Scenario: 三工位可选同一个员工
  Given 全局库含 designer
  When 三个工位都选 designer 并确认
  Then 启动 3 个 designer 面板（各自独立 crew 注入互不串味）
```

## 实现要点（描述 what）

1. 主进程加 IPC（用既有 `ipcHandle` 包装器，L3364）：
   - `roles:list`：读 `~/.aiteam/roles/`（与 005 同源），标注是否已 hire。
   - `roles:hire`：实例化（**复用 005 的逻辑**——可由 main.cjs 调 `python3 aiteam.py role hire` 或移植等价 JS；二选一，保持与 CLI 同结果，C2）。
   - `crew:start`：对 roster 逐个 hire（未雇佣者）+ 注入启动（用 007 的 `agentShellCommand`），仅启动本次选中。
2. preload 暴露通道；renderer 加选择器 UI（融进现有 agent 配置区域，每工位一个选择控件 + 员工卡片展示 emoji/title/summary）。
3. **不持久化「上次组队」**：启动入口每次都展示选择器（C5）。

## 验证

```bash
npm run build
# 人工（需 claude）：npm run dev
#   1) 弹出组队选择器，三工位选 designer/manager/prd → 启动，标题正确、身份正确
#   2) 关 App 重开 → 再次弹选择器，未自动复用
#   3) 三工位都选 designer → 三个独立设计师面板
npm run smoke:tmux   # 启动路径不回归
```

## 完成定义

- 三工位各选员工可用；标题/身份正确；可选同一员工；关掉重开重新选（C5）。
- `build` 与 `smoke:tmux` 通过。
