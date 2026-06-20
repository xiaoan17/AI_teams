# Task 001: Role schema 设计 + 全局库结构文档化 + 补样例员工

**type**: config
**depends-on**: []
**触点**:
- `~/.aiteam/roles/`（全局库，新增 manager / prd 两个样例）
- `docs/plans/20260620-虚拟员工M1-plan/role-schema.md`（新建：schema 规范文档）
- 参考既有：`~/.aiteam/roles/designer/`（已存在的样例）

## 目标

冻结 Role / agent 扩展字段的 schema（作为 002–010 的共同契约），并把全局库目录结构写成规范文档；补 2 个样例员工，让组队选择有得选。

## 契约：扩展后的 agent schema（不写实现，只定契约）

在现有 `.aiteam/agents.json` 的 agent 对象上**向后兼容扩展**（新字段全部可选）：

```jsonc
{
  "id": "designer",              // 既有，稳定 id（也是 tmux 窗口名/匹配键，不可含点冒号）
  "name": "设计师",               // 既有
  "command": "claude",           // 既有
  "args": ["--dangerously-skip-permissions"],  // 既有
  "enabled": true,               // 既有
  "permission_mode": "configure-before-start", // 既有

  "role": {                      // 新增（可选）：员工身份
    "title": "产品设计师",         //   面板标题显示用（诉求③）
    "summary": "把需求转成界面设计、交互流程与示意图",
    "emoji": "🎨",
    "track": "spec"              //   spec|impl|verify，M1 仅占位
  },
  "skills": ["design-spec"],     // 新增（可选）：声明用到的 skill，仅展示/校验
  "persona_dir": ".aiteam/crew/designer",  // 新增（可选）：crew 实例目录（相对项目根）
  "persona_file": "CLAUDE.md"    // 新增（可选）：persona_dir 内人设文件名
}
```

规则（写进 role-schema.md）：
- 当 `persona_dir` **存在且非空** → 启动时注入（见 003/007）；否则按旧逻辑启动（C1）。
- `persona_dir` 相对路径相对**项目根**解析；其下应有 `persona_file` 和 `.claude/skills/`。
- 全局库模板目录结构：`~/.aiteam/roles/<id>/{role.json, CLAUDE.md, .claude/skills/<skill>/SKILL.md}`。
- `role.json` 内容 = 上面 `role`+`skills`+`command`+`args`+`persona_file`（雇佣时据此生成项目 agent 条目）。

## BDD Scenario

```gherkin
Scenario: 全局库提供可雇佣的员工模板
  Given 全局库目录 ~/.aiteam/roles/
  When 我列出其中的员工模板
  Then 至少存在 designer / manager / prd 三个目录
  And 每个目录含 role.json、CLAUDE.md、.claude/skills/<skill>/SKILL.md
  And 每个 role.json 能被 JSON 解析且含 role.title 字段
```

## 步骤

1. 写 `role-schema.md`：把上面「契约」+「规则」完整落档（这是其他任务的 single source of truth）。
2. 在 `~/.aiteam/roles/` 下新增 `manager/`（🧭 总经理，skills 可声明 `brainstorming`/`writing-plans`）和 `prd/`（📋 PRD），各含 `role.json` + `CLAUDE.md` + 至少一个 `.claude/skills/<skill>/SKILL.md`（参照已存在的 designer）。
3. 校验三个 role.json 都是合法 JSON 且含 `role.title`。

## 验证

```bash
# 三个员工目录齐全且结构完整
for r in designer manager prd; do
  test -f ~/.aiteam/roles/$r/role.json || echo "MISSING role.json: $r"
  test -f ~/.aiteam/roles/$r/CLAUDE.md || echo "MISSING CLAUDE.md: $r"
  ls ~/.aiteam/roles/$r/.claude/skills/*/SKILL.md >/dev/null 2>&1 || echo "MISSING skill: $r"
  python3 -c "import json;d=json.load(open('$HOME/.aiteam/roles/$r/role.json'));assert d['role']['title']" || echo "BAD json: $r"
done
echo "OK if no MISSING/BAD above"
```

## 完成定义

- `role-schema.md` 写好，字段契约清晰。
- designer/manager/prd 三个模板齐全，验证脚本无 MISSING/BAD 输出。
