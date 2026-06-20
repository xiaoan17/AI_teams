# Task 004：model 注入 smoke（CLI + App 等价）

- type: test
- depends-on: 001
- slug: model-inject-test

## 目标

写两段 smoke，分别钉死 CLI 侧（`shell_command`）与 App 侧（`agentCommandParts`）对 `model` 的注入，
并**逐字段对照两边等价**（C2）。实现前应红，005 后转绿。

## 用例

针对同一组 agent 配置，两侧产出的启动命令必须语义一致：

1. claude + `model: "opus"` → 命令含 `--model opus`。
2. codex + `model: "opus"` → 命令含 `-c model=opus`。
3. 无 `model` → 两侧都**不含** `--model` / `model=`（与 M1 完全一致，回归断言）。
4. 未知家族（如 `command: "foo"`）+ model → 不注入，不崩溃。
5. 有 model 但无 persona_dir → model 仍注入（model 与 persona 注入解耦）。
6. model 含空格/特殊字符 → 正确转义（CLI 用 shlex，App 用 shellQuote）。

## 文件

- `scripts/model-inject-smoke.py`（CLI，调 `aiteam.py` 的 shell_command 或等价入口）。
- `scripts/model-inject-app-smoke.cjs`（App，require `agent-command.cjs` 调 `agentShellCommand`）。
  可参照既有 `scripts/role-inject-app-smoke.cjs` 的写法。

## 验证

- 两脚本实现前红、005 后全绿。
- 显式断言「同一配置两侧输出在 model 维度等价」。
