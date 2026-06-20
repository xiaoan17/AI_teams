# Task 008：端到端 + 样例库 + 文档

- type: verify
- depends-on: 003, 005, 006, 007
- slug: e2e-and-docs

## 目标

把 M2 全链路跑通一遍真实场景，播种一个外部样例库，更新文档。

## E2E 场景

1. **准备导入源**：在 `~/Desktop/agent_teams_libs/` 放一个带 M2 字段的员工模板（如 `frontend`，含 `model`、`collab`）。
2. **import**：`python3 aiteam.py role import ~/Desktop/agent_teams_libs/frontend` → 库根出现 frontend + `.imported`。
3. **list**：`role list` 看到 frontend，带 model/collab/来源摘要。
4. **hire**：在某测试项目 `role hire frontend --enable` → `.aiteam/crew/frontend/` 实例化，agents.json 含 model/collab。
5. **启动注入**：`start`（或 App 启动）→ 实际命令含 `--model <model>` + `--add-dir <crew> --append-system-prompt <人设>`。
6. **回归**：designer/manager/prd（无 M2 字段）import/hire/启动行为与 M1 一致。

## 文档

- 在 README / docs 增一节「员工库与导入」：导入源 → `role import` → `role hire` 三段式，附 model/collab 字段说明。
- 链接 `role-schema-v2.md`。
- 在 M1 `_index.md` 或本 `_index.md` 标注 M2 状态为 done。

## 验证

- 全部 smoke 绿：`role-import-smoke.py`、`model-inject-smoke.py`、`model-inject-app-smoke.cjs`、`role-hire-smoke.py`、`role-inject-*`。
- `npm run release:check`（或项目既有校验）通过。
- 真实 import→hire→启动链路人工走通一遍，截图/日志留证。
