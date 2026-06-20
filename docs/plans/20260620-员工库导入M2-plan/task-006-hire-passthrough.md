# Task 006：hire 透传 collab + model 到 agents.json

- type: impl
- depends-on: 001
- slug: hire-passthrough

## 目标

`role hire` 时把模板的 `model` 与 `collab` 一并写进项目 `agents.json` 的 agent 条目，
供启动逻辑（model）与 UI/未来编排（collab）使用。不改变 M1 既有透传。

## 改动点

- `upsert_hired_agent`（`aiteam.py:851`）：在 `agent_update` 里追加
  - `"model": role.get("model")`（仅当存在；为 None 时不写键，保持配置干净）。
  - `"collab": role.get("collab")`（仅当为 dict 时透传）。
- 保持既有字段（id/name/command/args/role/skills/persona_dir/persona_file/codex_instructions_file/permission_mode/enabled）不变。

## 约束

- C1：模板无 model/collab 时，hire 出的 agent 条目与 M1 完全一致（不多出空键）。
- collab 仅元数据：hire/启动逻辑**不**因 collab 改变任何行为。
- model 透传后由 Task 005 的启动逻辑消费——本任务只负责落到 agents.json。

## 验证

- hire 一个带 model+collab 的模板 → `.aiteam/agents.json` 对应 agent 含正确 model/collab。
- hire designer（无 M2 字段）→ agent 条目无 model/collab 键，与 M1 输出 diff 为空。
- 既有 `scripts/role-hire-smoke.py` 仍全绿（必要时补一条 model/collab 透传断言）。
