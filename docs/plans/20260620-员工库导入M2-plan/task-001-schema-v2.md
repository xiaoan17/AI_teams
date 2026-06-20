# Task 001：模板 schema v2 文档化（model + collab 可选字段 + 校验规则）

- type: config
- depends-on: 无
- slug: schema-v2

## 目标

把 M2 新增的可选字段（`model`、`collab`）及其校验规则、启动落点固化为真相文档，并更新样例模板说明。
本任务**只产出文档与约定**，不写实现代码（实现在 003/005/006）。

## 做什么

1. 确认 `role-schema-v2.md` 已落地（本计划目录），作为 M2 真相文档；与 M1 `role-schema.md` 对齐、不冲突。
2. 在 `role-schema-v2.md` 中明确：
   - `model` 语义 + 校验（非空字符串）+ claude/codex/其它运行时的启动落点。
   - `collab.upstream/downstream/handoff_via` 语义 + 类型校验 + 「本期纯元数据不驱动行为」。
   - 未知字段原样保留的向前兼容承诺。
   - import 行为契约（校验前置、原子拷贝、`.imported` 溯源、只写库根）。
3. 给一份**完整 role.json 示例**（含 M2 字段），供 003/005/006 实现对照。

## 验证

- `role-schema-v2.md` 存在且包含：model 校验、collab 类型校验、import 契约、claude/codex 落点表。
- 与 M1 `role-schema.md` 无字段语义冲突（M2 全为新增可选字段）。
- 示例 role.json 是合法 JSON（`python3 -c "import json,sys; json.loads(...)"` 或肉眼 + jsonc 去注释校验）。
