# Task 002: 注入逻辑单元 smoke（CLI 侧 shell_command）

**type**: test（Red）
**depends-on**: ["001"]
**触点**:
- `scripts/role-inject-smoke.py`（新建，纯逻辑单测，不起真 tmux/claude）
- 被测：`aiteam.py` 的 `shell_command(agent)`（将在 003 改造）
- `package.json`（加 `"smoke:role-inject": "python3 scripts/role-inject-smoke.py"`）

## 目标

先写**会失败的**测试（Red），锁定 CLI 注入逻辑的契约：当 agent 带 `persona_dir` 时，`shell_command()` 必须拼出 `--add-dir <绝对crew路径>` 和 `--append-system-prompt <人设内容>`；不带时保持原样（C1）。

## 契约（被测函数签名，不写实现）

```python
# aiteam.py 中（003 实现）
def shell_command(agent: dict, *, root: Path | None = None) -> str:
    """拼启动命令。当 agent 含非空 persona_dir 时，追加
    --add-dir <root/persona_dir 的绝对路径> 与
    --append-system-prompt <persona_dir/persona_file 文件内容>（正确 shlex 转义）。
    无 persona_dir 时行为与旧版一致。"""
    ...
```

## BDD Scenario

```gherkin
Scenario: 带 persona_dir 的员工注入启动参数
  Given 一个 agent 配置 command=claude，persona_dir=".aiteam/crew/designer"，persona_file="CLAUDE.md"
  And 该 crew 目录下 CLAUDE.md 内容为 "你是设计师"
  When 调用 shell_command(agent, root=<项目根>)
  Then 返回字符串包含 "--add-dir" 且其值是 crew 目录的绝对路径
  And 包含 "--append-system-prompt" 且其值经转义后等价于 "你是设计师"
  And 不改变工作目录相关字段（C3：不出现把 cwd 指向 crew 的逻辑）

Scenario: 旧配置无 persona_dir 时行为不变（C1 向后兼容）
  Given 一个 agent 配置 command=claude，args=["--foo"]，无 persona_dir
  When 调用 shell_command(agent)
  Then 返回 "claude --foo"
  And 不包含 "--add-dir" 或 "--append-system-prompt"
```

## 步骤

1. 写 `scripts/role-inject-smoke.py`：
   - 在临时目录造一个 crew 子目录 + `CLAUDE.md`（内容含需转义的字符，如引号/空格）。
   - import `aiteam`（`sys.path` 指向仓库根），构造两个 agent dict（有/无 persona_dir）。
   - 断言上面两个 scenario。
2. 在 `package.json` scripts 加 `smoke:role-inject`。
3. **此时运行应失败**（因为 003 还没实现注入）—— 这就是 Red。

## 验证

```bash
npm run smoke:role-inject   # 期望：现在 FAIL（Red）；003 完成后 PASS（Green）
```

## 完成定义

- smoke 脚本存在、断言完整、覆盖两个 scenario（注入 + 向后兼容）。
- 当前运行为失败状态，失败原因是「注入逻辑未实现」而非脚本本身报错。
