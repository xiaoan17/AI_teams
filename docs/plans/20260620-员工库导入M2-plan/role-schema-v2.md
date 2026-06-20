# Role Schema v2 — 导入与模板长大

本文件是 M2 的真相文档，在 M1 `../20260620-虚拟员工M1-plan/role-schema.md` 之上**叠加**，不替代它。
M1 定义的所有字段与规则继续有效；M2 只新增可选字段、新增 import 概念。

## 1. 三个目录的角色（不要混）

| 目录 | 谁写它 | 内容 | 命令 |
|------|--------|------|------|
| **导入源** `<任意路径>/<id>/` | 用户/分享者 | 一份完整员工模板 | —（用户自己准备） |
| **库根** `~/.aiteam/roles/<id>/` | `role import` | 权威库，唯一真相 | `role import <path>` 写入 |
| **项目工位** `.aiteam/crew/<id>/` | `role hire` | 项目内实例 | `role hire <id>` 写入 |

库根位置在 `aiteam.py:65 roles_dir()`，M2 **不改**。导入源可以是任何目录，与库根解耦。

## 2. 一个员工模板的目录结构（导入源 = 库根条目，结构一致）

```text
<id>/
  role.json                 # 必需。启动字段 + 角色元数据 + M2 新增可选字段
  CLAUDE.md                 # 必需。persona（claude 注入用）
  RTK.md                    # 可选。codex developer_instructions（缺则回退 CLAUDE.md，M1 已支持）
  .claude/
    skills/
      <skill>/SKILL.md      # 至少一个（沿用 M1 模板校验要求）
```

## 3. role.json 完整字段（M1 + M2）

```jsonc
{
  // ── M1 既有（不变）──
  "id": "designer",
  "name": "设计师",
  "role": {
    "title": "产品设计师",
    "summary": "把需求转成界面设计、交互流程与示意图",
    "emoji": "🎨",
    "track": "spec"               // 粗粒度泳道：spec / impl / verify
  },
  "command": "claude",
  "args": ["--dangerously-skip-permissions"],
  "skills": ["design-spec"],
  "persona_file": "CLAUDE.md",
  "codex_instructions_file": "RTK.md",
  "permission_mode": "configure-before-start",
  "version": "0.1.0",

  // ── M2 新增（全部可选）──
  "model": "opus",                // 模型偏好；启动时落到运行时参数
  "collab": {
    "upstream": ["prd", "manager"],
    "downstream": ["frontend"],
    "handoff_via": ".aiteam/tasks/"
  }
}
```

## 4. M2 新增字段语义与校验

### `model`（可选）
- 含义：该员工偏好的模型别名/标识（如 `opus` / `sonnet` / codex 的 model id）。
- 校验：若存在，必须是**非空字符串**；否则 import 拒绝。
- 启动落点（双实现，C2）：
  - `command` 家族为 **claude**：追加 `--model <model>`。
  - `command` 家族为 **codex**：追加 `-c model=<model>`（与既有 `developer_instructions` 同样用 `-c`）。
  - 其它运行时：忽略 `model`，warn 一条，照常启动（C1）。
  - `model` 缺失：不传任何模型参数，行为同 M1。

### `collab`（可选，纯元数据，本期不驱动行为）
- `collab.upstream` / `collab.downstream`：若存在，必须是**字符串数组**（其中应为其它 role id）。
- `collab.handoff_via`：若存在，必须是字符串（约定交接通道，如 `.aiteam/tasks/`）。
- 用途（M2）：`role list` 展示、hire 透传进 `agents.json` 供 UI 显示。**不**改变启动、不做校验联动。
- 用途（M3+ 预留）：自动组队推荐、@路由提示、handoff 自动化。

### 未知字段
- import 与 hire **原样保留并拷贝**用户自定义的额外字段，向前兼容。

## 5. import 行为契约

- `role import <path> [--id <id>] [--force]`
  - `<path>`：导入源目录（含 `role.json`）。
  - `--id`：覆盖落库 id（默认取 `role.json.id` 或源目录名）。
  - `--force`：库根已存在同名时覆盖；否则拒绝并提示。
- 校验（拷贝前）：复用 M1 `load_role_template` 等价规则（role.json 合法、id 一致、CLAUDE.md 存在、≥1 个 SKILL.md）
  + M2 弱校验（model / collab 类型）。
- 原子性：先拷到库根下临时目录，校验通过再 rename 到 `<id>/`；失败不留半成品。
- 溯源：库根 `<id>/.imported` 写 `{ source_path, role_version, imported_at }`（对照 hire 的 `.source`）。
- **只写库根，绝不回写导入源**。

## 6. hire 透传（M2 扩展点）

`upsert_hired_agent`（`aiteam.py:851`）M2 追加透传：
- `model` → agent 配置 `model`（启动时被 `agentCommandParts` / `shell_command` 读取）。
- `collab` → agent 配置 `collab`（仅供 UI/未来编排，启动逻辑忽略）。
保持 M1 既有透传（role/skills/persona_dir/…）不变。
