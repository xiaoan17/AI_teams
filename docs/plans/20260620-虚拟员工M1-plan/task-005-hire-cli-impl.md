# Task 005: 雇佣命令实现（aiteam.py role 子命令）

**type**: impl（Green）
**depends-on**: ["004"]
**触点**:
- `aiteam.py`：新增 `cmd_role_list` / `cmd_role_hire`；`build_parser()`（约 L832）注册 `role` 子命令组；可加 `roles_dir()` 帮助函数（默认 `~/.aiteam/roles`，可被环境变量覆盖以便测试）

## 目标

让 Task 004 的 smoke 转绿。

## 命令契约

```
aiteam role list
aiteam role hire <id> [--enable] [--force]
```

## 实现要点（描述 what）

1. `roles_dir()`：返回全局库路径。**为可测试，支持环境变量覆盖**（如 `AITEAM_ROLES_DIR`），缺省 `Path.home()/".aiteam"/"roles"`。
2. `cmd_role_list`：遍历 `roles_dir()` 子目录，读每个 `role.json`，打印 `id  emoji title`。
3. `cmd_role_hire(id, enable, force)`：
   - 源：`roles_dir()/<id>/`；目标：`<root>/.aiteam/crew/<id>/`。
   - 目标已存在且非 `--force`：按 004 的幂等 scenario 处理（提示需 --force，不覆盖本地修改），返回非零或明确提示。
   - 拷贝整个模板目录（含 `.claude/`、`CLAUDE.md`）。
   - 写 `.source`（JSON：源路径、role_version、hired_at —— 用 `utc_now()`，不要 `Math.random`/裸 `Date`）。
   - 读模板 `role.json`，**upsert** 到 `<root>/.aiteam/agents.json` 的 `agents`：
     - 字段：`id`、`name`（取 role.title 或 id）、`command`、`args`、`role`、`skills`、`persona_dir=".aiteam/crew/<id>"`、`persona_file`、`permission_mode`、`enabled`（`--enable` 决定）。
     - 已存在同 id 则更新 `role`/`persona_dir` 等，保留用户其它字段。
   - 用既有 `load_config`/`save_config`（保持 JSON 缩进风格）。
4. `build_parser()`：加 `role` 子命令组 + `list`/`hire` 子解析器（仿现有 `agent` 子命令组写法）。

## BDD Scenario

```gherkin
Scenario: 雇佣员工实例化到项目
  Given 全局库含 designer
  When 运行 aiteam role hire designer
  Then .aiteam/crew/designer/ 含 CLAUDE.md 与 .claude/skills/...
  And .aiteam/crew/designer/.source 记录来源
  And .aiteam/agents.json 含 designer 条目且 persona_dir=".aiteam/crew/designer"
```

## 验证

```bash
npm run smoke:role-hire   # 期望 PASS（Green）
python3 aiteam.py doctor   # 不回归
python3 aiteam.py role list   # 人工瞄一眼输出
```

## 完成定义

- `smoke:role-hire` 绿；`doctor` 通过。
- agents.json 经 hire 后仍是合法且 `release:check` 不报（注意模板里别把真实绝对路径写进版本库模板——crew 在 .gitignore 范围或用相对路径）。
