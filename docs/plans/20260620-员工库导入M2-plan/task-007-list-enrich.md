# Task 007：role list 信息增强

- type: impl
- depends-on: 003
- slug: list-enrich

## 目标

`role list` 在现有 `id / emoji / title` 之外，补充**导入来源/版本**与 **collab 摘要**，让库内容一眼可读。

## 改动点（`cmd_role_list`，`aiteam.py:834`）

- 读 `<id>/.imported`（若存在）→ 展示 `imported` 标记或来源短路径。
- 读 role.json 的 `version`、`model`、`collab` → 行内追加摘要，如：
  `designer  🎨  产品设计师  [model:opus] [↑prd,manager ↓frontend] (imported)`
- 无这些字段时优雅省略，保持与 M1 输出兼容（至少 `id/emoji/title` 三列不变，新增信息追加在后）。
- 可选：`--json` 输出结构化列表，便于 App/脚本消费（若加，保持默认人读格式不变）。

## 约束

- C1：不破坏既有 `id\temoji\title` 的可解析格式（M1 的 pick/选择逻辑依赖它，见 `role_ids_from_pick` 936）。
  新增信息**追加**在行尾，不插在前三列之间。

## 验证

- `role list` 对带 M2 字段的 role 显示 model/collab/来源；对 designer 等旧 role 显示同 M1。
- `role_ids_from_pick` 仍能正确解析（手测 `start --pick` 或针对性 smoke）。
