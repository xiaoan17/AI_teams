# Task 002：role import smoke（外部目录 → 库根）

- type: test
- depends-on: 001
- slug: import-cli-test

## 目标

在实现前写好 `scripts/role-import-smoke.py`，定义 `role import` 的行为契约（红 → 003 实现后转绿）。

## 用例（用临时目录隔离，HOME/库根指向 tmp，绝不碰真实 ~/.aiteam）

1. **正常导入**：造一个合法源目录（role.json + CLAUDE.md + .claude/skills/x/SKILL.md）→
   `role import <src>` 退出 0 → 库根出现 `<id>/`，含拷贝内容 + `.imported`（source_path / imported_at 存在）。
2. **幂等拒绝**：同名再 import 且无 `--force` → 非 0 退出，错误提示含 `--force`，库根内容不变。
3. **--force 覆盖**：`--force` 再 import 改了内容的源 → 退出 0，库根内容更新。
4. **--id 覆盖**：`--id custom` → 落库目录名为 `custom`，role.json.id 校验按 custom 走。
5. **校验失败不留痕**：源缺 CLAUDE.md / 缺 SKILL.md / role.json 非法 → 非 0 退出，库根**无** `<id>/`，**无** `.import-tmp-*`。
6. **不回写源**：import 后源目录内容/mtime 不变。
7. **model/collab 弱校验**：role.json 带 `model: 123`（非字符串）→ 拒绝；带合法 `model`/`collab` → 通过。

## 验证

- `python3 scripts/role-import-smoke.py` 当前应**红**（import 未实现）；003 完成后**全绿**。
- 测试自身不依赖真实 HOME（用 env 覆盖库根，或参数化 `roles_dir`）。
