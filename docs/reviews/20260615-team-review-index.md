---
created: 2026-06-15
status: Final
tags: [review, index, tmux, rendering, stability, architecture]
---

# AI_teams 团队三视角 Review —— 汇总索引

> 2026-06-15 · v0.2.3 · 由团队三名成员（Codex / Claude Code / Kimi）各从自身专长视角对**内嵌 tmux 技术路线**与**渲染/画面稳定**独立 review。每名成员均用工具打开真实代码核实，并对旧 review 文档（`docs/issues/20260615-code-review-findings-[todo].md` 的 #1~#10）逐条核对现状。

## 三份报告

| 视角 | 成员 | 关注面 | 文件 |
|---|---|---|---|
| 系统 / 主进程 | **Codex** | tmux 进程编排、session 生命周期、进程树回收、退出路径、输入热路径性能、epoch 守卫 | [`20260615-review-codex-tmux-orchestration.md`](20260615-review-codex-tmux-orchestration.md) |
| 渲染 / 前端 | **Claude Code** | xterm 写入管线、画面稳定与闪烁、快照↔live 衔接、输入路由正确性、滚轮/主题/resize | [`20260615-review-claude-rendering-stability.md`](20260615-review-claude-rendering-stability.md) |
| 架构 / 技术路线 | **Kimi** | 内嵌 tmux 路线本身的取舍与边界、alt-screen 硬约束、双写过滤、可维护性、smoke 体系 | [`20260615-review-kimi-architecture.md`](20260615-review-kimi-architecture.md) |

---

## 一、对用户两个重点问题的团队共识

### 重点①：内嵌 tmux 这条技术路线，靠不靠谱？

**三人一致结论：这条路线站得住，根基稳。**

- **Codex（可靠性层）**：进程树回收（绕过 setsid 逃逸）、僵尸 session 防护、退出 watchdog、断线重连退避、输入热路径去同步化 —— 这五个"硬骨头"都已啃下，**无架构级阻断问题**。
- **Kimi（路线层）**：tmux 换来"进程存活独立于 UI + workspace 切换不杀进程 + 异构 CLI 通吃"，是纯 node-pty / ACP 给不了的核心能力。坚持纯 PTY、不走 ACP 的方向**正确**。

**但 Kimi 点破一条硬边界（P0）**：为了让本地 xterm 攒 scrollback，`filterTerminalOutput` 强剥 alt-screen 序列（`terminal-wheel.mjs:19-24,207-219`）。代价是**整条路线天然不兼容全屏 TUI agent**（vim/less/htop/全屏审批面板会渲染错乱）。当前 codex/claude/kimi 都是行式流式输出所以没爆，但这是**产品能力上限**，应在文档里显式声明为约束，而非当 bug 修。

### 重点②：文本是否稳定呈现（不闪、不丢、不卡顿）？

**稳态达标，边界态有真实隐患。**

- **共识——稳态做对了**（Codex/Claude/Kimi 三方均核实）：seq 去重 + rAF 批量 flush + ANSI 边界对齐 + 防 glyph-atlas 每帧重建，四件套真实存在、实现正确、有 smoke 覆盖。常态流式输出不闪、不串色、不卡顿。这是项目亮点。
- **分歧/补充——Claude 在边界态挖出旧文档没有的新 bug**：
  - 🔴 **F5**：`onData` 门控 `if (!agent.pane ...)`（`App.jsx:613`）会让 **direct-pty 后端永久无法键盘输入**（direct-pty 的 `pane` 恒为 null，`main.cjs:1349`）。若 direct-pty 仍对用户开放即为功能性致命。
  - 🔴 **F2**：minimize 用 `display:none`（`styles.css:886`）撞 `fitAndSync` 的 `width<20` 守卫，**restore 后画面以错误列宽渲染 ~260ms**（可见"画面跳一下"）。
  - 🔴 **F1**：snapshot 恢复瞬间 `lastSeqRef` 抬升滞后于补播 queue，存在**同 seq 重复写**窗口（重复回显）。

---

## 二、旧 review 文档（#1~#10）核对：哪些已过时

三人**独立交叉验证**，结论一致：

| # | 旧定性 | 现状 | 三方判定 |
|---|---|---|---|
| #1 before-quit 无超时卡死 | 🔴 | `main.cjs:3137-3168` 已有 watchdog + `app.exit(0)` | **已修，应清账** |
| #2 每键同步读盘+探活 | 🔴 | 热路径每 batch 仅一次内存 resolvePane + 一次 await 探活 | **已修，应清账** |
| #4 只读路径写盘 | 🟡 | `loadAppAgentConfig` 已加 diff 才写 | **主路径已修** |
| #3 git 超时不可区分 | 🟡 | 仍 `timeout:3000` + 吞 stderr，超时误显示非仓库 | **仍存在** |
| #5 粘贴路径不一致 | 🟡 | view=stdin / routeMessage=临时文件，仍分化 | **仍存在** |
| #6 waitingPatterns 误报 | 🟡 | 仍含 `continue|proceed|allow` 高频词 | **仍存在** |
| #8 tmuxWriteInputFallback 死代码 | 🟢 | grep 全仓零调用 | **确认可删** |
| #9 direct-pty 同步 appendFileSync | 🟢 | 仍在，但仅降级后端 | **仍存在（影响面小）** |
| #10 无 lint + 双写过滤漂移 | 🟢 | 属实 | **仍存在** |

> 行动项：把 `docs/issues/20260615-code-review-findings-[todo].md` 的 `state` 更新，#1/#2/#4 标 resolved，避免误导后续维护者。

---

## 三、合并优先级清单（团队建议）

**P0 — 用户可直接感知 / 路线边界**
1. 🔴 **F5**（Claude）：修 `onData` 门控，按 backend 区分 —— `if (stoppedOrExited(agent) || (agent.backend === "tmux" && !agent.pane)) return;`
2. 🔴 **F2**（Claude）：minimize 改 `visibility:hidden`/`content-visibility` 保留盒模型，或 restore 后同步 fit
3. 🔴 **局限A**（Kimi）：文档声明"仅支持行式/流式 CLI，不支持全屏 alt-screen TUI"

**P1 — 正确性 / 结构性负债**
4. 🔴 **F1**（Claude）：补播循环里同步抬 `lastSeqRef`，消除同 seq 重复写
5. 🟡 **F4**（Claude）：dispose 时复位 `snapshotReadyRef=false`，堵 pane 重连丢字符窗口
6. 🟡 **A. epoch**（Codex）：把 epoch/abort 传进 `ensureView`，堵切 workspace 时 view+pty 泄漏窗口
7. 🟡 **#10 / 双写过滤**（Claude+Kimi）：抽 `ansi-sequences` 共享模块，main 复用 renderer 已导出常量，并补"序列集同构" smoke

**P2 — 健壮性 / 清理**
8. 🟡 #3 git 超时与"非仓库"分离
9. 🟡 #5 粘贴路径统一到 stdin（顺带消临时文件竞态）
10. 🟢 #8 删死代码 `tmuxWriteInputFallback`
11. 🟢 #6 收窄 waitingPatterns
12. 🟡 App.jsx 2185 行：拆出 `AgentTerminal` + 纯逻辑渲染管线（使管线可单测，补 smoke 盲区）

---

## 四、一句话总评

内嵌 tmux 这条路线**地基已经打牢**（进程回收/僵尸防护/退出上界/重连/输入去同步化），渲染**稳态四件套设计正确且被 smoke 钉住**。当前真正要动的是三类东西：① 一条必须显式声明的路线硬边界（alt-screen）；② 三个边界态渲染 bug（F5/F2/F1，用户可感知）；③ 把已过时的旧 review 结论清账。无架构级返工，按 P0→P1 推进即可。
