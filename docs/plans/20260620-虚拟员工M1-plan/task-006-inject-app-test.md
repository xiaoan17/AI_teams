# Task 006: App 注入逻辑 smoke（agentShellCommand 等价）

**type**: test（Red）
**depends-on**: ["001"]
**触点**:
- `scripts/role-inject-app-smoke.cjs`（新建）
- 被测：`src/main/main.cjs` 的 `agentShellCommand(agent)`（007 改造）
- `package.json`（加 `"smoke:role-inject-app": "node scripts/role-inject-app-smoke.cjs"`）

## 目标

锁定 **App 侧**注入契约（Red），且与 CLI（002/003）**行为等价**（C2）：`agentShellCommand` 在 agent 带 `persona_dir` 时追加 `--add-dir`+`--append-system-prompt`，工作目录仍由 `agentCwd` 给项目根（C3）。

> 注意：main.cjs 是 Electron 主进程模块，直接 require 可能拉起 electron。本任务需先确认 `agentShellCommand`/`agentCwd` 能被无副作用地导出/被测：若不可直接 require，则在 007 把这两个纯函数抽到一个可被 node 直接 require 的小模块（如 `src/main/agent-command.cjs`），smoke 测该模块。**本测试任务负责定清楚「被测单元如何可导入」。**

## BDD Scenario

```gherkin
Scenario: App 注入与 CLI 等价
  Given agent command=claude，persona_dir 指向含 CLAUDE.md("你是设计师") 的 crew 目录
  When 调用 agentShellCommand(agent)（WORKSPACE_ROOT=项目根）
  Then 结果含 --add-dir <crew绝对路径>
  And 含 --append-system-prompt，其值转义后等价于 "你是设计师"
  And 与 CLI shell_command 对同一输入产出语义一致（同样的 flag、同样的 crew 路径）

Scenario: App 旧配置无 persona_dir 行为不变（C1）
  Given 无 persona_dir 的 agent command=claude args=["--foo"]
  When 调用 agentShellCommand(agent)
  Then 结果为 "claude --foo"，不含注入参数
```

## 步骤

1. 写 `scripts/role-inject-app-smoke.cjs`：造临时 crew + CLAUDE.md，require 被测单元（见上「注意」），断言两个 scenario。
2. 加 `package.json` 脚本，并把它加入 `smoke` 聚合命令（L11 的串联）。
3. 当前应失败（007 未实现）—— Red。

## 验证

```bash
npm run smoke:role-inject-app   # 现在 FAIL（Red）；007 后 PASS
```

## 完成定义

- smoke 覆盖注入 + 向后兼容两个 scenario，并明确被测单元的可导入方式。
- 当前为失败态。
