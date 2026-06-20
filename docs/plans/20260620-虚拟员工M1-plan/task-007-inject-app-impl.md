# Task 007: App 注入启动实现（main.cjs agentShellCommand）

**type**: impl（Green）
**depends-on**: ["006"]
**触点**:
- `src/main/main.cjs`：`agentShellCommand()`（约 L1441）、`agentCwd()`（约 L1268，**不改逻辑**，确认默认项目根）
- 可能新建 `src/main/agent-command.cjs`（把注入相关纯函数抽出以便 006 测试）
- 启动调用处：`startTmuxAgents`（约 L1900）与 `ensureTmuxAgentPane`（约 L1947）用 `agentShellCommand`

## 目标

让 Task 006 smoke 转绿，且与 CLI（003）注入语义等价（C2）。

## 实现要点（描述 what）

1. 在 `agentShellCommand(agent)` 中（或抽出的 `agent-command.cjs`）：
   - 保留 `[command, ...args]` 拼接。
   - 若 `agent.persona_dir` 非空：
     - 解析 crew 绝对路径（相对 `WORKSPACE_ROOT`，复用 `agentCwd` 同款 resolve）。
     - 读 `<crew>/<persona_file||"CLAUDE.md">` 内容（存在才注入）。
     - 追加 `--add-dir <crew>` 和 `--append-system-prompt <内容>`，用既有 `shellQuote` 转义（C6）。
     - 文件/目录缺失则跳过该注入并 `log.warn`，不抛错。
   - 无 persona_dir：逐字保持旧输出（C1）。
2. 确认 `agentCwd(agent)` 仍返回项目根（agent.cwd 默认未设 → WORKSPACE_ROOT）。**禁止**改成 crew（C3）。
3. 若抽出 `agent-command.cjs`：main.cjs 改为 require 它；保证 tmux 与 direct-pty 两条启动路径都用同一函数（搜 `agentShellCommand` 全部调用点）。

## BDD Scenario

```gherkin
Scenario: App 注入与 CLI 等价
  Given agent persona_dir 指向含 CLAUDE.md 的 crew
  When agentShellCommand(agent)
  Then 含 --add-dir <crew> 与 --append-system-prompt <人设>，工作目录仍为项目根
```

## 验证

```bash
npm run smoke:role-inject-app   # PASS（Green）
npm run build                   # 主进程/渲染无构建错误
npm run smoke:tmux              # 启动路径不回归
# 人工（需 claude）：npm run dev → 启动一个 designer 员工，确认其身份是设计师且能看到项目代码
```

## 完成定义

- `smoke:role-inject-app` 绿；`build` 通过；`smoke:tmux` 不回归。
- CLI 与 App 对同一 agent 产出的注入 flag 一致（C2 由 006 的等价断言保证）。
