---
created: 2026-06-20
plan: 员工库导入 M2 —— 可导入的员工库 + 模板长大（启动参数/模型/协作元数据）
branch: feature/loop_test
depends-on-plan: ../20260620-虚拟员工M1-plan/_index.md
status: done
---

# 施工计划：员工库导入 M2（可导入、可自定义的预制员工）

M1 把「3 个固定 CLI 面板」升级成「员工工位」，并打通了 **库根 → hire → crew 注入** 这条链。
M2 的目标是让**员工库本身变成可填充、可导入、可自定义的资产**：用户在任意目录（如
`~/Desktop/agent_teams_libs/`）准备/收集员工模板，用一条命令 **导入存进库根**，
随后照常 `role hire` 到任意项目。同时让员工模板**长大**，能预制启动参数、模型偏好与协作元数据。

## 核心数据流（M2 后）

```
导入源（任意目录，可自由配置）        库根（唯一真相，位置不变）          项目工位
~/Desktop/agent_teams_libs/<id>/  ──▶  ~/.aiteam/roles/<id>/   ──▶  .aiteam/crew/<id>/
   role.json + CLAUDE.md + skills     role import 校验+拷贝       role hire 实例化      注入启动
                                      写 .imported 溯源          写 .source 溯源       (M1 已实现)
```

**关键洞察：`role import` 与 `role hire` 是同构操作**——都是「校验模板 → `shutil.copytree` 拷贝目录 → 写溯源 JSON」。
区别只是源/目标：import 是「外部目录 → 库根」，hire 是「库根 → 项目」。
所以 import 直接复用 hire 已有的校验与拷贝代码（`load_role_template` 的校验规则、`copytree`、`write_json` 溯源），**不是从零造**。

## 范围决策（已与用户确认）

- **D1 库根位置不变**：权威库仍是 `~/.aiteam/roles/`（`aiteam.py:65 roles_dir()`）。
  `agent_teams_libs` 不是库，而是**导入源**之一。用户可从任意路径 import 进库根。
- **D2 模板长大四类，本期做三类**：persona+skills（M1 已有）、启动参数/模型偏好、协作元数据。
  **MCP/工具配置本期不做**——它是四类里唯一需要新启动机制的，砍掉后 M2 全是纯数据拷贝，零启动风险。
- **D3 先做本地**：本地目录扫描 + import + hire 跑通即收口。git 仓库源 / registry 分发是 M3+。
- **D4 import 是幂等拷贝**：同名 role 已在库根时，默认拒绝；`--force` 才覆盖。覆盖前保留 `.imported` 溯源对照。

## 关键约束（继承 M1 的 C1–C6，新增 D 约束）

- **C1 向后兼容**：模板新增字段（`model`、`upstream`/`downstream` 等）全部可选。
  无这些字段的旧模板（designer/manager/prd）必须照常 list / hire / 启动，行为不变。
- **C2 双实现等价**：凡涉及**启动注入**的改动，CLI（`aiteam.py`）与 App（`src/main/main.cjs` /
  `src/main/agent-command.cjs`）两处都要改且行为一致。M2 里**只有「启动参数/模型偏好」这一类**
  会落到启动命令上，必须双实现；import 命令本身只在 CLI（App 暂不暴露 import UI，M3 再说）。
- **C3 工作目录=项目根**：不变。import/hire 都不动 cwd。
- **C4 tmux 窗口名是匹配键**：不变。新增的 `model`/协作元数据只走配置与 UI，绝不进窗口名。
- **C6 注入安全**：模型偏好等若落到 CLI 参数，复用既有 `shellQuote` / `shlex` 转义。
- **D-import 不污染库外**：import 只写库根 `~/.aiteam/roles/<id>/`，绝不回写导入源目录。
- **D-校验前置**：import 在拷贝前先跑模板校验（同 hire 的 `load_role_template` 规则 + M2 新增可选字段的弱校验），
  校验不过直接拒绝、不留半拷贝（先拷到临时目录再原子 rename，或失败回滚）。

## 模板 schema 扩展（在 M1 role-schema.md 之上叠加）

M1 的 `role.json` 已含：`id/name/role{title,summary,emoji,track}/command/args/skills/persona_file/permission_mode/version`。
M2 **追加可选字段**：

```jsonc
{
  // …M1 既有字段…
  "model": "opus",                  // 可选：模型偏好。claude 落到 --model；codex 落到 -c model=…；无则不传
  "collab": {                        // 可选：协作元数据（M1 的 role.track 之外的上下游关系）
    "upstream": ["prd", "manager"],  //   谁给我派活（仅展示 + 未来编排用，本期不驱动行为）
    "downstream": ["frontend"],      //   我把产出交给谁
    "handoff_via": ".aiteam/tasks/"  //   交接通道约定
  }
}
```

校验规则（M2 新增，全部弱校验——缺失即跳过，不报错）：
- `model` 若存在必须是非空字符串。
- `collab.upstream` / `collab.downstream` 若存在必须是字符串数组。
- 未知字段一律保留、原样拷贝（向前兼容用户自定义）。

详见 [role-schema-v2.md](./role-schema-v2.md)（M2 真相文档）。

## 当前状态 vs 目标状态

| 维度 | 当前（M1 后） | 目标（M2 后） |
|------|--------------|--------------|
| 填充库根 | 手动 mkdir / cp 进 `~/.aiteam/roles/` | `role import <path>` 校验+拷贝进库根，写 `.imported` |
| 模板内容 | persona + skills + 启动字段 | 追加 `model`（落到启动命令）+ `collab` 协作元数据 |
| 模型偏好 | 无，统一 `command/args` | 模板声明 `model`，启动时 CLI/App 双实现注入 |
| 协作信息 | 仅 `role.track` | `collab.upstream/downstream/handoff_via`（展示+未来编排） |
| 导入源 | 无概念 | 任意目录（如 `agent_teams_libs`），与库根解耦 |

## 执行计划（任务元数据）

```yaml
tasks:
  - id: "001"
    subject: "模板 schema v2 文档化（model + collab 可选字段 + 校验规则）"
    slug: "schema-v2"
    type: "config"
    depends-on: []
  - id: "002"
    subject: "role import smoke（外部目录 → 库根，校验/幂等/--force/溯源）"
    slug: "import-cli-test"
    type: "test"
    depends-on: ["001"]
  - id: "003"
    subject: "role import 实现（aiteam.py，复用 load_role_template 校验 + copytree + .imported）"
    slug: "import-cli-impl"
    type: "impl"
    depends-on: ["002"]
  - id: "004"
    subject: "model 注入 smoke（CLI shell_command + App agentCommandParts 等价）"
    slug: "model-inject-test"
    type: "test"
    depends-on: ["001"]
  - id: "005"
    subject: "model 注入实现（aiteam.py + agent-command.cjs 双实现，claude/codex 各自落点）"
    slug: "model-inject-impl"
    type: "impl"
    depends-on: ["004"]
  - id: "006"
    subject: "hire 透传 collab + model 到 agents.json（upsert_hired_agent 扩展）"
    slug: "hire-passthrough"
    type: "impl"
    depends-on: ["001"]
  - id: "007"
    subject: "role list 显示导入来源/版本 + collab 摘要（可读性）"
    slug: "list-enrich"
    type: "impl"
    depends-on: ["003"]
  - id: "008"
    subject: "端到端：从 agent_teams_libs import → hire → 启动带 model；样例库播种 + 文档"
    slug: "e2e-and-docs"
    type: "verify"
    depends-on: ["003", "005", "006", "007"]
```

## 依赖图

```
001 (schema v2)
 ├─→ 002 (import test) ─→ 003 (import impl) ─→ 007 (list enrich) ─┐
 ├─→ 004 (model test) ──→ 005 (model impl) ──────────────────────┤
 └─→ 006 (hire 透传) ─────────────────────────────────────────────┴─→ 008 (E2E+文档)
```

并行机会：001 完成后，三条链 **{002→003→007}**（import）、**{004→005}**（model 双实现）、
**{006}**（hire 透传）可由不同 agent 并行认领。008 收口。

## 为什么这样切

- **import 单独成链**且不碰启动逻辑（纯数据拷贝），风险最低、可最先落地——满足用户「先跑通最小 import 闭环」的潜在需求。
- **model 注入是唯一双实现项**，单独成链便于严格对照 CLI/App 等价（C2）。
- **collab 是纯元数据**，hire 透传一把过，本期不驱动任何行为，只为 M3 自动编排埋点。
- MCP 明确不在本期，避免引入 `--mcp-config` 启动面的复杂度与项目 MCP 冲突风险。

## 任务文件索引

- [Task 001: 模板 schema v2 文档化](./task-001-schema-v2.md)
- [Task 002: role import smoke](./task-002-import-cli-test.md)
- [Task 003: role import 实现](./task-003-import-cli-impl.md)
- [Task 004: model 注入 smoke](./task-004-model-inject-test.md)
- [Task 005: model 注入实现](./task-005-model-inject-impl.md)
- [Task 006: hire 透传 collab + model](./task-006-hire-passthrough.md)
- [Task 007: role list 信息增强](./task-007-list-enrich.md)
- [Task 008: 端到端 + 样例库 + 文档](./task-008-e2e-and-docs.md)

## 给执行 agent 的总则

1. **先读 M1** `../20260620-虚拟员工M1-plan/role-schema.md` 与本目录 `role-schema-v2.md`，再动手。
2. **复用而非重写**：`role import` 必须复用 `aiteam.py` 既有的 `load_role_template`(818) / `write_json`(91) /
   `roles_dir`(65) / hire 的 `copytree` 模式(906)，不要另起一套校验。
3. **遵守 C1（向后兼容）与 C2（双实现等价）**——M2 唯一双实现项是 model 注入。
4. **每个任务完成后跑它的「验证」节**，绿了再标 done。
5. import 只写库根，**绝不回写导入源**；model/collab **绝不进 tmux 窗口名**（C4）。
