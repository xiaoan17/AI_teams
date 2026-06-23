---
created: 2026-06-20
plan: 虚拟员工 M1 —— Role schema + 全局库 + 雇佣 + 注入启动 + 组队选择
branch: feature/loop_test
design: ../../20260620-虚拟员工与团队工作室-设计讨论.md
status: done   # M1 全部任务已落地：role schema + 全局库 + hire + 注入启动 + 组队选择（下游 M2 已 done，.aiteam/crew/ 实例为证）
---

# 施工计划：虚拟员工 M1（可分布式认领）

把 AI_teams 从「3 个固定 agent CLI 面板」升级为「3 个员工工位」。本计划是 M1 的可执行拆解，每个任务自包含、可独立认领、可独立验证。

## 目标（M1 范围）

1. **Role schema**：在 agent 配置上向后兼容地扩展 `role` / `persona_dir` / `persona_file` / `skills` 字段。
2. **全局员工库**：`~/.aiteam/roles/<role>/` 模板结构（designer 样例已存在，需补 manager/prd 各一个并文档化）。
3. **雇佣命令**：`role list` / `role hire <id>`（方案 B：实例化拷贝模板 → 项目 `.aiteam/crew/<id>/`，写 `.source`）。
4. **注入启动**：CLI `shell_command()` 与 App `agentShellCommand()` 双实现等价地拼出 `--add-dir <crew> --append-system-prompt <人设>`，**工作目录保持项目根**。
5. **CLI 组队选择**：`start` 支持给工位选员工；体现「不复用旧组队」。
6. **App 组队选择器 + 标题显职位**：3 工位各选员工；面板标题渲染 `role.title`（如 `🎨 设计师`），tmux 窗口名保持稳定 id 不动。

## 关键约束（所有任务必须遵守）

- **C1 向后兼容**：新字段全部可选。没有 `role`/`persona_dir` 的旧 agent 配置必须照常启动，行为不变。
- **C2 双实现等价**：agent 启动逻辑在 CLI（`aiteam.py`）和 App（`src/main/main.cjs`）是两套并行实现。凡改启动/注入，**两处都要改且行为一致**。
- **C3 工作目录=项目根**：注入方案下，员工的 cwd 仍是项目根（看得到全部代码）。**禁止**把 `cwd` 指向 crew 目录，**禁止** cp 人设进工作目录。
- **C4 tmux 窗口名是匹配键**：`src/main/tmux-runtime.cjs` 用 `window_name` 反查 pane。**禁止**把窗口名改成职位名/中文/含点冒号的字符串。职位名只走 UI 标题。
- **C5 关掉不复用但不急杀**：组队选择结果不作为持久状态自动复活；不主动 kill 进程。
- **C6 注入安全**：`--append-system-prompt` 传入的人设来自文件内容，需正确 shell 转义（复用既有 `shellQuote`/`shlex`）。

## 当前状态 vs 目标状态

| 维度 | 当前 | 目标（M1 后） |
|------|------|--------------|
| agent 配置 | `id/name/command/args/cwd/enabled/permission_mode` | 增 `role`/`persona_dir`/`persona_file`/`skills`（可选） |
| 启动命令 | `claude <args>` | `claude <args> --add-dir <crew> --append-system-prompt <人设>`（当员工有 persona 时） |
| 员工来源 | 手动编辑 agents.json | 全局库 `~/.aiteam/roles/` + `role hire` 实例化到 `.aiteam/crew/` |
| 工作目录 | `agent.cwd`（多为 `.`） | 项目根（不变），人设/skill 改为注入 |
| 面板标题 | `agent.name`（如 Claude Code） | `role.title`（如 🎨 设计师），无 role 时回退 name |
| 启动选员工 | 启用即全开 | 给工位选员工，不复用上次组队 |

## 执行计划（任务元数据）

```yaml
tasks:
  - id: "001"
    subject: "Role schema 设计 + 全局库结构文档化 + 补样例员工"
    slug: "role-schema-and-library"
    type: "config"
    depends-on: []
  - id: "002"
    subject: "注入逻辑单元 smoke（CLI 侧 shell_command）"
    slug: "inject-cli-test"
    type: "test"
    depends-on: ["001"]
  - id: "003"
    subject: "CLI 注入启动实现（aiteam.py shell_command + start）"
    slug: "inject-cli-impl"
    type: "impl"
    depends-on: ["002"]
  - id: "004"
    subject: "雇佣命令 smoke（role list / role hire）"
    slug: "hire-cli-test"
    type: "test"
    depends-on: ["001"]
  - id: "005"
    subject: "雇佣命令实现（aiteam.py role 子命令）"
    slug: "hire-cli-impl"
    type: "impl"
    depends-on: ["004"]
  - id: "006"
    subject: "App 注入逻辑 smoke（agentShellCommand 等价）"
    slug: "inject-app-test"
    type: "test"
    depends-on: ["001"]
  - id: "007"
    subject: "App 注入启动实现（main.cjs agentShellCommand）"
    slug: "inject-app-impl"
    type: "impl"
    depends-on: ["006"]
  - id: "008"
    subject: "面板标题显职位（public state 透传 role + renderer）"
    slug: "panel-title-role"
    type: "impl"
    depends-on: ["007"]
  - id: "009"
    subject: "CLI 组队选择（start 选员工，不复用旧组队）"
    slug: "crew-select-cli"
    type: "impl"
    depends-on: ["003", "005"]
  - id: "010"
    subject: "App 组队选择器（3 工位各选员工）"
    slug: "crew-select-app"
    type: "impl"
    depends-on: ["007", "008", "005"]
  - id: "011"
    subject: "端到端验证 + 文档更新 + release:check"
    slug: "e2e-and-docs"
    type: "verify"
    depends-on: ["009", "010"]
```

## 任务文件索引

- [Task 001: Role schema 设计 + 全局库结构 + 样例员工](./task-001-role-schema-and-library.md)
- [Task 002: 注入逻辑 smoke（CLI）](./task-002-inject-cli-test.md)
- [Task 003: CLI 注入启动实现](./task-003-inject-cli-impl.md)
- [Task 004: 雇佣命令 smoke](./task-004-hire-cli-test.md)
- [Task 005: 雇佣命令实现](./task-005-hire-cli-impl.md)
- [Task 006: App 注入逻辑 smoke](./task-006-inject-app-test.md)
- [Task 007: App 注入启动实现](./task-007-inject-app-impl.md)
- [Task 008: 面板标题显职位](./task-008-panel-title-role.md)
- [Task 009: CLI 组队选择](./task-009-crew-select-cli.md)
- [Task 010: App 组队选择器](./task-010-crew-select-app.md)
- [Task 011: 端到端验证 + 文档](./task-011-e2e-and-docs.md)

## 依赖图

```
001 (schema+库)
 ├─→ 002 (CLI注入test) ─→ 003 (CLI注入impl) ──────┐
 ├─→ 004 (雇佣test) ────→ 005 (雇佣impl) ──────────┼─→ 009 (CLI组队) ─┐
 ├─→ 006 (App注入test) ─→ 007 (App注入impl) ─→ 008 (标题) ─┐         │
 │                                              005 ───────┴─→ 010 (App组队) ─┤
 │                                                                            │
 └────────────────────────────────────────────────────────────→ 011 (E2E+文档)
```

并行机会：001 完成后，三条链 **{002→003}**、**{004→005}**、**{006→007→008}** 可由不同 agent 并行认领（分别是 CLI 注入、雇佣命令、App 注入+标题）。009 需要 003+005；010 需要 007+008+005；011 收口。

## BDD 覆盖确认

设计稿的核心行为均有任务覆盖：注入生效(002/003/006/007)、雇佣实例化(004/005)、工作目录=项目根(002/006 断言)、职位名显示(008)、组队选择不复用(009/010)、向后兼容(002/006 含旧配置用例)、端到端(011)。

## 给执行 agent 的总则

1. **先读设计稿** `../../20260620-虚拟员工与团队工作室-设计讨论.md` 的 §0.5 / §5 / §6.5，再动手。
2. **遵守 C1–C6 约束**，尤其 C2（双实现等价）和 C4（窗口名别动）。
3. **每个任务完成后跑它的「验证」节**，绿了再标 done。
4. 改 tmux 输入/工作区切换前，按 `AGENTS.md` 读回归守则。
