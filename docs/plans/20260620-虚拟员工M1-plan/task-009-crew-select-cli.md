# Task 009: CLI 组队选择（start 选员工，不复用旧组队）

**type**: impl
**depends-on**: ["003", "005"]
**触点**:
- `aiteam.py`：`cmd_start`（约 L367）增加交互/参数选员工；`build_parser` 的 `start` 子解析器加 `--role`（可重复）/`--pick` 选项
- 复用 005 的 `role hire`（选了未雇佣的员工时先实例化）

## 目标

实现「每次启动选谁开工」的 CLI 版（你目标入口是 App，但 CLI 先验证逻辑）。体现 C5：**不读取上次组队选择自动复活**——每次 start 重新决定。

## 行为契约

```
aiteam start                      # 交互菜单：列全局库+已雇佣，让用户选本次工位员工
aiteam start --role designer --role manager   # 非交互：指定本次员工（CI/脚本用）
```

- 选中的员工若未雇佣 → 自动 `role hire`（实例化）后再启动。
- 启动只针对**本次选中的**员工，不因 agents.json 里 enabled 残留而全开（C5：组队是每次现选的，不持久复活）。
- 已有运行 session 的处理沿用现有 `tmux_has_session` 提示逻辑。

## BDD Scenario

```gherkin
Scenario: 非交互指定本次员工
  Given 全局库含 designer/manager/prd
  When 运行 aiteam start --role designer --role manager
  Then 仅 designer 与 manager 被启动（各一个 tmux 窗口）
  And 未选的 prd 不启动
  And 若 designer/manager 未雇佣则先自动实例化到 .aiteam/crew/

Scenario: 不复用上次组队（C5）
  Given 上次 start 选的是 designer
  When 这次运行 aiteam start --role prd
  Then 本次只启动 prd，不因上次选过 designer 而自动带上 designer
```

## 实现要点（描述 what）

1. `start` 加参数：`--role <id>`（可重复）；无参数时进入交互菜单（用 `input()` 列编号选择，简单即可）。
2. 解析出本次 roster（员工 id 列表）→ 对每个未雇佣者调用 hire → 用注入版 `shell_command(agent, root=root)`（003）逐个起窗。
3. 不写「上次组队」持久文件；runtime.json 只记本次实际启动的 agents（沿用现状）。

## 验证

```bash
# 非交互路径（无需 claude，可用 demo agent 或 dry 检查命令拼接）
python3 aiteam.py --root <tmp> start --role designer --role manager
tmux list-windows -t <session>   # 仅 designer/manager 两窗
python3 aiteam.py doctor
```

## 完成定义

- `--role` 选择生效，未选的不启动；未雇佣自动实例化。
- 不存在「上次组队」复活逻辑（C5）。
