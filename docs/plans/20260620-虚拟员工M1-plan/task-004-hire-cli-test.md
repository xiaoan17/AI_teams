# Task 004: 雇佣命令 smoke（role list / role hire）

**type**: test（Red）
**depends-on**: ["001"]
**触点**:
- `scripts/role-hire-smoke.py`（新建）
- 被测：`aiteam.py` 的 `cmd_role_list` / `cmd_role_hire`（005 实现）
- `package.json`（加 `"smoke:role-hire": "python3 scripts/role-hire-smoke.py"`）

## 目标

锁定雇佣命令契约（Red）：`role list` 能列全局库员工；`role hire <id>` 把全局模板**实例化拷贝**到项目 `.aiteam/crew/<id>/`，写 `.source` 溯源，并在 `.aiteam/agents.json` 写入/更新对应 agent 条目（含 `persona_dir`/`role`）。

## 契约（命令签名）

```
aiteam role list                # 列 ~/.aiteam/roles/ 下的员工：id / title / emoji
aiteam role hire <id> [--enable]# 拷贝模板→ .aiteam/crew/<id>/，写 .source，upsert agents.json 条目
```

## BDD Scenario

```gherkin
Scenario: 列出全局库员工
  Given 全局库含 designer/manager/prd
  When 运行 aiteam role list
  Then 输出三行，每行含 id 与 role.title

Scenario: 雇佣员工实例化到项目
  Given 全局库含 designer
  And 一个干净的项目工作区（已 init）
  When 运行 aiteam role hire designer
  Then 存在 .aiteam/crew/designer/CLAUDE.md 与 .claude/skills/design-spec/SKILL.md
  And 存在 .aiteam/crew/designer/.source 且记录来源模板路径
  And .aiteam/agents.json 的 agents 含 id=designer 条目，其 persona_dir=".aiteam/crew/designer"
  And 该条目含 role.title 字段

Scenario: 重复雇佣不破坏已有本地修改（幂等/安全）
  Given 已雇佣 designer 且本地改过 CLAUDE.md
  When 再次运行 aiteam role hire designer（无 --force）
  Then 命令不静默覆盖本地修改（要么跳过要么提示需 --force）
```

## 步骤

1. 写 `scripts/role-hire-smoke.py`：用临时 HOME/临时项目根隔离（设 `--root` 到 tmp，monkey-patch 或用环境变量指向 tmp 全局库），跑命令、断言文件与 agents.json。
2. 加 `package.json` 脚本。
3. 当前运行应失败（005 未实现）—— Red。

## 验证

```bash
npm run smoke:role-hire   # 现在 FAIL（Red）；005 后 PASS
```

## 完成定义

- smoke 覆盖 list / hire / 重复 hire 三个 scenario。
- 当前为失败态，失败因 005 未实现。
