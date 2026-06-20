# Task 003：role import 实现（aiteam.py）

- type: impl
- depends-on: 002（先有 smoke 测试）
- slug: import-cli-impl

## 目标

实现 `aiteam.py role import <path> [--id <id>] [--force]`：把外部目录的员工模板**校验后拷贝进库根** `~/.aiteam/roles/<id>/`，写 `.imported` 溯源。**只写库根，绝不回写导入源。**

## 复用（不要重写）

- `roles_dir()`（`aiteam.py:65`）——库根。
- `load_json`（91）/ `write_json`（91 附近）——读写 JSON。
- `load_role_template` 的校验思路（818）——role.json 合法、id 一致、CLAUDE.md 存在、≥1 SKILL.md。可抽出一个
  `validate_role_dir(path, expected_id) -> dict` 供 import 与 hire 共用（重构 load_role_template 复用它）。
- hire 的拷贝模式（906 `shutil.copytree` + 写溯源）——import 是其镜像。

## 实现要点

1. 解析 `<path>`：必须是目录且含 `role.json`；落库 id = `--id` > `role.json.id` > 源目录名。
2. **拷贝前校验**：跑 `validate_role_dir`；不过直接 `AITeamError`，不动库根。
3. **原子拷贝**：拷到 `roles_dir()/.import-tmp-<id>/`，校验通过后；若库根已有 `<id>/`：
   - 无 `--force` → 拒绝（提示用 `--force`）。
   - 有 `--force` → 删旧 `<id>/`，rename 临时目录到 `<id>/`。
   失败清理临时目录，不留半成品。
4. 写 `roles_dir()/<id>/.imported`：`{ source_path: 绝对路径, role_version: role.get("version"), imported_at: utc_now() }`。
5. 注册子命令：`role_sub.add_parser("import", …)`，参数 `path`（位置）、`--id`、`--force`，绑定 `cmd_role_import`。
6. 成功打印：`Imported role: <id>` + `Library: <库根路径>`。

## 验证

- 跑 Task 002 的 smoke：`python3 scripts/role-import-smoke.py` 全绿。
- 手测：`python3 aiteam.py role import /tmp/sample-role` → `role list` 能看到；再 import 同名报错；`--force` 覆盖成功。
- import 后导入源目录**未被修改**（mtime / 内容不变）。
- 库根没有残留 `.import-tmp-*`。
