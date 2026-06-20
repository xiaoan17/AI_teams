# Task 005：model 注入实现（aiteam.py + agent-command.cjs 双实现）

- type: impl
- depends-on: 004（先有等价 smoke）
- slug: model-inject-impl
- 约束：**C2 双实现等价**——CLI 与 App 两处都改且行为一致。

## 目标

员工模板/agent 配置含 `model` 时，启动命令按运行时家族注入模型参数；缺失则不传，行为同 M1。

## 落点（与 role-schema-v2.md 一致）

| 运行时家族 | 注入 | 备注 |
|-----------|------|------|
| claude | `--model <model>` | 追加在既有 args 之后、persona 注入之前/后均可，保持稳定顺序 |
| codex  | `-c model=<model>` | 与既有 `developer_instructions` 同走 `-c` |
| 其它   | 不注入 | warn 一条，照常启动（C1） |
| 无 model | 不注入 | 行为同 M1 |

## App 侧（`src/main/agent-command.cjs`）

- 在 `agentCommandParts` 里，拿 `agent.model`（字符串且非空才生效）。
- `commandFamily` 已有（48 行）：claude → push `--model`, `agent.model`；codex → push `-c`, `model=<model>`。
- 模型值经 `shellQuote`（已存在）转义到 `agentShellCommand`。
- model 注入与 `--add-dir/--append-system-prompt` 互不影响；无 persona 但有 model 时也要生效。

## CLI 侧（`aiteam.py` 的 `shell_command()`）

- 在拼命令处读 `agent.get("model")`，按同样的家族规则追加。
- 用既有 `shlex.quote`（或等价）转义。
- 确保与 App 侧**参数顺序/形态一致**（004 的 smoke 会逐字段对照两边输出）。

## 验证

- 跑 Task 004 smoke（CLI 侧 `scripts/model-inject-smoke.py` + App 侧 `scripts/model-inject-app-smoke.cjs`）全绿。
- 断言：claude+model → 命令含 `--model opus`；codex+model → 含 `-c model=opus`；无 model → 两者都不含 `--model`/`model=`。
- 断言：`model` **不出现在** tmux 窗口名里（C4）。
- 旧 agent（无 model）启动命令与 M1 完全一致（C1 回归）。
