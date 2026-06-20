# Task 003: CLI 注入启动实现（aiteam.py）

**type**: impl（Green）
**depends-on**: ["002"]
**触点**:
- `aiteam.py`：`shell_command()`（约 L169）、`cmd_start()`（约 L367，传 root）、`setup_agent_runtime`（日志记录命令处）
- 不改 `resolve_agent_cwd`/`agentCwd` 逻辑（C3：工作目录仍是项目根，即 agent.cwd 默认 "."）

## 目标

让 Task 002 的 smoke 转绿：`shell_command()` 在 agent 含非空 `persona_dir` 时追加注入参数；`cmd_start()` 把 `root` 传进去。

## BDD Scenario

```gherkin
Scenario: 带 persona_dir 的员工注入启动参数
  Given 一个 agent 配置 command=claude，persona_dir=".aiteam/crew/designer"，persona_file="CLAUDE.md"
  And 该 crew 目录下 CLAUDE.md 内容为 "你是设计师"
  When 调用 shell_command(agent, root=<项目根>)
  Then 返回字符串包含 --add-dir <crew绝对路径> 与 --append-system-prompt "你是设计师"

Scenario: 旧配置无 persona_dir 时行为不变
  Given 无 persona_dir 的 agent
  When 调用 shell_command(agent)
  Then 输出与旧逻辑一致，不含注入参数
```

## 实现要点（描述 what，不贴 body）

1. `shell_command(agent, *, root=None)`：
   - 保留现有「拼 command + args」逻辑。
   - 若 `agent.get("persona_dir")` 非空：
     - 解析 crew 绝对路径（相对 `root` 解析；`root` 缺省时取 `Path.cwd()`）。
     - 读取 `<crew>/<persona_file or "CLAUDE.md">` 内容；存在才注入 `--append-system-prompt`。
     - 追加 `--add-dir <crew绝对路径>`。
     - 用 `shlex.quote` 转义注入值（C6）。
   - 若 crew 目录或人设文件缺失：跳过对应注入并不报错（健壮性），但记 warning。
2. `cmd_start()`：调用处改为 `shell_command(agent, root=root)`（首个与后续 agent 两处）。
3. **不要**把 `cwd` 改成 crew（C3）；工作目录仍由 `resolve_agent_cwd(root, agent.get("cwd"))` 决定（默认项目根）。
4. session markdown 记录的 `Command` 字段同步带上注入后的命令。

## 验证

```bash
npm run smoke:role-inject     # 期望 PASS（Green）
python3 aiteam.py doctor      # 不回归
# 手动冒烟（可选，需 claude）：在装了 designer crew 的项目里
#   python3 aiteam.py start && tmux attach   观察 claude 以设计师身份启动且工作目录是项目根
```

## 完成定义

- `smoke:role-inject` 绿。
- `doctor` 通过。
- 无 persona_dir 的旧 agent 启动命令字符串与改动前逐字一致（C1）。
