# Handoff: Agent 面板最小化 + 项目审计修复

日期:2026-06-11
范围:实施 `docs/issues/20260611-agent-minimize-finish.md` 与 `docs/issues/20260611-project-audit-finish.md` 两份方案
状态:代码全部落地并通过验证;**尚未 git commit**

## 一、已完成的工作

### 1. Agent 终端面板最小化(纯 renderer,后端零改动)

改动文件:`src/renderer/App.jsx`、`src/renderer/styles.css`

- **状态模型**:新增 `minimizedAgents`(`Set<agentId>`)前端 UI 状态,叠加在后端运行状态之上;不进 `infer_status`、不发 IPC、不动 tmux pane。
  - 面板可见 = `enabled && !stoppedOrExited && !minimized.has(id)`
- **侧栏交互**:运行中 agent 行显示双按钮 `▁`(最小化)/`▣`(还原)+ `■`(停止),均带 `stopPropagation`;已最小化的行名称变暗 + `▁` 小标记(`agent-row-minimized` / `agent-minimized-tag`);点击 agent 行本身也会还原面板并设为 active。
- **终端区**:面板隐藏走"保留挂载 + `display:none`"路线(`terminal-card-hidden` 类),xterm 实例与数据订阅不销毁;还原时由 ResizeObserver + 显式 `scheduleResize` 重新 fit 并同步 pane 尺寸,不重建、不重放日志。grid 布局按可见面板数自动重排。
- **持久化**:localStorage key `aiTeams.minimizedAgents:{workspaceRoot}`,按 workspace 隔离。持久化 effect 用 `minimizedReadyRootRef` 守卫且**声明顺序在加载 effect 之前**——这是防止切换 workspace 时把旧 workspace 的集合写进新 key 的关键,改动时勿调换顺序。
- **自动清除 flag**:agent 进入 stopped/exited/error(effect 监听 agents 列表)、单个 stop、批量 End、重新 start 时均清除,杜绝"下次启动面板神秘消失"。
- **边界行为**:
  - `waiting_input` 期间被最小化:侧栏黄点加 `agent-dot-pulse` 脉冲动画,不自动弹回面板;
  - 全部最小化:空状态显示 "N agent panel(s) are minimized. Click an agent in the sidebar to restore it.";
  - Composer 改为接收全部运行中 agent(含最小化),路由注入对最小化面板照常生效;
  - `pickActiveAgentId` 增加 minimized 参数,active agent 不会落在隐藏面板上。
- 设计稿状态已更新为"已实施",验收清单全部勾选。

### 2. 项目审计修复(Issue 1–5)

| Issue | 处置 | 改动文件 |
|---|---|---|
| 1. 模板不安全 | `.aiteam/agents.json` 恢复安全模板:`cwd: "."`、三个真实 agent `enabled: false`(与已提交版本一致,工作区不再有此文件的 diff) | `.aiteam/agents.json` |
| 2. 配置所有权模糊 | 确认 **Option B**(桌面端读 Electron userData 的 `agents.json`,可用 `AITEAMS_AGENT_CONFIG_PATH` 覆盖;CLI 以 workspace `.aiteam/agents.json` 为准;demo 模式是桌面端读 workspace 配置的唯一例外)。README 新增 "Agent Config Ownership" 一节;`doctor` 新增 `cli_config` / `desktop_config` 两行 info 输出 | `README.md`、`aiteam.py`(新增 `desktop_agent_config_path()`) |
| 3. init 写绝对 cwd | `default_config()` demo/非 demo 统一写 `"cwd": "."`(共 4 处替换);运行时仍由 `resolve_agent_cwd` 解析 | `aiteam.py` |
| 4. 文档本地路径 + 扫描范围 | `AGENTS.md` pkill 命令改 `$PWD` 相对;两个 feature 文档示例 cwd 改 `"."`;审计文档自身路径已泛化。`release-check.cjs` 改为扫描**全部 git-tracked 文本文件**(按扩展名过滤,跳过 package-lock),并新增匹配任意用户名的 `/Users/*/Desktop\|Documents\|...` 模式 | `AGENTS.md`、`docs/features/20260611-agent-plugin-import-design.md`、`docs/features/20260611-broadcast-routing-and-claude-code.md`、`scripts/release-check.cjs` |
| 5. release check 依赖 tmux | 分层:`npm run release:check` 只跑静态层(路径扫描、模板校验、`node --check`、`py_compile`、build、doctor);新增 `npm run release:check:full` 加跑 tmux smoke,tmux socket 被沙箱拦截时输出明确提示。README 故障排查同步更新 | `scripts/release-check.cjs`、`package.json`、`README.md` |
| 6. bundle 体积警告 | 按方案建议**搁置**,启动变慢时再做动态 import 拆分 | — |

审计文档末尾已追加 "Resolution (2026-06-11)" 一节逐条记录处置。

### 3. 验证记录(全部通过)

- `npm run release:check`(静态层)✅
- `npm run release:check:full`(含 tmux runtime/view smoke)✅
- `npm run smoke:pty` ✅
- `npm run build` ✅、`npm run doctor` ✅
- `aiteam.py init` / `init --demo` 产物抽查:全部 `cwd: "."` ✅
- 最小化功能用 `vite preview` + Playwright(browserPreviewApi stub)实测:双按钮、面板隐藏与 grid 重排、行点击还原、刷新后持久化、stop 后 flag 自动清除、全部最小化空状态文案、waiting 黄点脉冲——逐项通过 ✅

## 二、待办事项

### 必做

1. **git commit**。当前全部改动都在工作区。注意 `src/main/main.cjs`、`src/main/preload.cjs`、`src/main/tmux-view.cjs` 的未提交改动是**上一轮 app-level config 工作的遗留**(本次未触碰),建议分开提交:
   - 遗留的 main 进程改动(app-level config 相关)单独一个 commit;
   - 最小化功能(App.jsx + styles.css + 设计稿状态更新)一个 commit;
   - 审计修复(README/AGENTS/aiteam.py/release-check/package.json/docs)一个 commit。
   - 未跟踪文件需要 `git add`:`docs/issues/`、`docs/features/20260611-docs-file-watcher-refresh.md`、`docs/features/20260611-typora-inspired-theme-presets.md`(后两个非本次产物,提交前确认内容)。
2. **恢复本机 CLI 的 agent 启用状态**。模板还原把本地 enabled 状态清掉了,需要 CLI 跑真实 agent 时在本地执行(不要提交):
   ```bash
   python3 aiteam.py agent set codex --enable
   python3 aiteam.py agent set claude --enable
   python3 aiteam.py agent set kimi --enable
   ```
   桌面端不受影响(读 userData 配置)。
3. **在真实 Electron + tmux 环境过一遍最小化**。浏览器实测用的是 stub API;`npm run dev`(或 `dev:demo`)里确认:最小化期间 tmux pane 日志继续写入、还原后 xterm 无错位、`resizeAgent` 尺寸同步正常。

### 可选 / 后续

4. **最小化 v2 候选**(设计稿 scope 外,按需做):`waiting_input` 自动还原开关;消息注入到已最小化 agent 时侧栏行短暂高亮(本次只实现了 waiting 脉冲)。
5. **Issue 6**:启动明显变慢时再做 bundle 拆分(xterm 动态 import 是首选)。
6. **桌面端配置的编辑入口**:审计 Issue 2 建议"提供查看/编辑桌面配置路径的 UI 或命令",目前只做到 doctor 打印路径;后续可在 app 内加入口(可衔接 `docs/features/20260611-agent-plugin-import-design.md`)。
7. `defaultAppAgentConfig()`(`src/main/main.cjs`)默认启用 codex/kimi——这是桌面端首启的 userData 默认值,不影响 release check;若希望首启更保守可改为全部 disabled,需产品决策。

## 三、踩坑提示(给下一位)

- 最小化持久化的两个 effect(persist 在前、load 在后)顺序敏感,见上文;prune effect 只删除"存在于 agents 列表且已停止"的 id,不要改成"不在列表就删",否则 workspace 切换瞬间会误清。
- `release-check.cjs` 的禁用模式是正则,自身源码因转义不会自匹配;新增模式时注意别把 `docs/issues` 里泛化后的描述再写回绝对路径。
- `npm run smoke` 需要真实 tmux socket(`/private/tmp/tmux-*`),沙箱内会失败——这正是 release check 分层的原因,沙箱里只跑 `release:check`。
