# Task 011: 端到端验证 + 文档更新 + release:check

**type**: verify
**depends-on**: ["009", "010"]
**触点**:
- `README.md`（加「虚拟员工 / 雇佣 / 组队」章节）
- `AGENTS.md`（如启动约定有变，更新）
- `docs/20260620-虚拟员工与团队工作室-设计讨论.md`（status → implementing/done，回填实测）
- 全套 smoke + release:check

## 目标

把 M1 各任务的局部验证收口成一次端到端验证，更新对外文档，确保发版检查不回归。

## BDD Scenario

```gherkin
Scenario: 端到端——从雇佣到三员工同屏工作
  Given 全局库含 designer/manager/prd
  And 一个干净项目
  When 我用 App 组队选择器选三个员工并启动
  Then 三个面板分别以对应身份运行、标题显示职位
  And 各自能访问项目代码（工作目录=项目根）与自己的专属 skill
  And 关掉 App 重开后重新弹组队选择器（不复用）

Scenario: 向后兼容——旧配置仍可用（C1）
  Given 一份没有 role/persona_dir 的旧 agents.json
  When start / npm run dev
  Then 行为与本次改动前一致，不报错
```

## 步骤

1. **全套 smoke**：
   ```bash
   npm run smoke              # 含 tmux 全家桶
   npm run smoke:role-inject
   npm run smoke:role-inject-app
   npm run smoke:role-hire
   python3 aiteam.py doctor
   npm run build
   ```
2. **手动 E2E**（需 claude）：CLI 路径 `aiteam start --role ...`；App 路径 `npm run dev` 走组队选择器；按两个 scenario 逐条核对。
3. **向后兼容验证**：拿一份无 role 的 agents.json 跑 start + dev，确认无回归。
4. **文档**：
   - README 增「雇佣员工 / 组队启动」用法（`role list` / `role hire` / 选择器截图位）。
   - 设计稿 status 改为 `implementing`（或 `done`），§2/§6.5 回填实测结论。
5. **发版检查**：`npm run release:check`（确认 agents.json 模板没混入真实绝对路径/启用的真实 agent；crew 目录在 .gitignore 内或不入库）。

## 验证

```bash
npm run release:check     # 静态检查全绿
npm run smoke             # tmux 全套绿（需非沙箱 tmux 环境）
```

## 完成定义

- 全部 smoke + doctor + build + release:check 绿。
- 手动 E2E 两个 scenario 通过。
- README/设计稿已更新。
- 清理：验证后不留运行中的 dev/electron/tmux 进程（按 AGENTS.md 的 cleanup 段）。
