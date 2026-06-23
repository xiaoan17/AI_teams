# AI Teams 文档总览

> 本目录所有文档的索引。**先看这里，再进子目录。**
> 最后整理：2026-06-23

## 状态约定

文档状态有两种载体，二者以文件名后缀为准：

| 标记 | 含义 |
|------|------|
| `[finish]` | 已实现并验证，落地完成 |
| `[superseded]` | 已被更新方案取代，仅作存档 |
| `[todo]` | 已立项/已设计，待实现 |
| 无后缀 | 设计稿 / 提案 / 进行中（见下表 status 列） |

子目录：`features/` 功能规格 · `issues/` 缺陷与回归 · `plans/` 可执行施工计划 · `reviews/` 代码评审 · `reference/` 外部参考与灵感 · 根目录放跨主题的设计讨论。

---

## 根目录 · 设计讨论

| 文档 | 状态 | 摘要 |
|------|------|------|
| [虚拟员工与团队工作室-设计讨论](20260620-虚拟员工与团队工作室-设计讨论.md) | ✅ done | 从「多 Agent 面板」到「可雇佣虚拟员工团队」的总设计稿，M1/M2 的源头 |
| [design-system.md](design-system.md) | ✅ 现行 | 设计系统规范（色板/排版/组件/主题），UI 改动的依据 |

---

## features/ · 功能规格

### ✅ 已完成
| 文档 | 摘要 |
|------|------|
| [adaptive-agent-terminal-layout](features/20260611-adaptive-agent-terminal-layout-[finish].md) | Agent 终端自适应布局 |
| [app-level-agent-config](features/20260611-app-level-agent-config-[finish].md) | 应用级 Agent 配置 |
| [broadcast-routing-and-claude-code](features/20260611-broadcast-routing-and-claude-code-[finish].md) | 广播路由 + Claude Code 接入 |
| [docs-file-watcher-refresh](features/20260611-docs-file-watcher-refresh-[finish].md) | docs 文件监听自动刷新 |
| [tmux-backed-terminal-sessions](features/20260611-tmux-backed-terminal-sessions-[finish].md) | tmux 支撑的终端会话（核心架构） |
| [ambient-glow-effects](features/20260611-ambient-glow-effects-[finish].md) | 光效与呼吸状态（styles.css 已落地） |
| [typora-inspired-theme-presets](features/20260611-typora-inspired-theme-presets-[finish].md) | Typora 风格主题预设（themes.js 已落地） |
| [clean-process-teardown](features/20260613-clean-process-teardown-[finish].md) | 进程干净退出 |
| [window-cycling-shortcut](features/20260613-window-cycling-shortcut-[finish].md) | 方向键循环切换活动窗口 |
| [true-tui-terminal-rendering](features/20260616-true-tui-terminal-rendering-[finish].md) | 真·TUI 终端渲染（取代有损 transcript 改写） |
| [uiux-polish-loop-handoff](features/20260620-uiux-polish-loop-handoff-[finish].md) | UI/UX 打磨 Loop Handoff（T1–T10 全完成） |

### 🗂 已存档（被取代）
| 文档 | 摘要 |
|------|------|
| [transcript-terminal-resize-stability](features/20260616-transcript-terminal-resize-stability-[superseded].md) | 旧 transcript resize 方案，已被 true-TUI 渲染取代 |

### 🚧 设计稿 / 提案（待实现）
| 文档 | 状态 | 摘要 |
|------|------|------|
| [agent-plugin-import-design](features/20260611-agent-plugin-import-design.md) | draft | Agent 插件与导入设计 |
| [less-is-more-ui-audit](features/20260612-less-is-more-ui-audit.md) | partial | 前端审计与优化（P3–P12 已完成，其余待办） |
| [error-warning-logging](features/20260613-error-warning-logging.md) | proposed | 错误与告警日志记录方案（代码暂未落地） |
| [local-agent-detection-and-composition](features/20260613-local-agent-detection-and-composition.md) | proposed | 本地 Agent 探测 + 自由组合最多 3 实例 |
| [terminal-wheel-scrollback-stability](features/20260613-terminal-wheel-scrollback-stability.md) | proposed | 终端滚轮回滚稳定性 |

---

## issues/ · 缺陷与回归

### ✅ 已修复
| 文档 | 摘要 |
|------|------|
| [agent-minimize](issues/20260611-agent-minimize-[finish].md) | Agent 最小化 |
| [project-audit](issues/20260611-project-audit-[finish].md) | 项目审计 |
| [attached-view-submit-and-packaged-restore](issues/20260614-attached-view-submit-and-packaged-restore-[finish].md) | 附着视图提交 + 打包态恢复 |
| [terminal-input-and-workspace-switch-regressions](issues/20260614-terminal-input-and-workspace-switch-regressions-[finish].md) | 终端输入 + 工作区切换回归守卫 |
| [code-review-verified](issues/20260615-code-review-verified-[finish].md) | 代码 Review 核实版 |
| [real-agent-enter-submit-regression](issues/20260615-real-agent-enter-submit-regression-[finish].md) | 真 Agent 回车提交回归 |
| [packaged-app-black-screen-loadfile](issues/20260616-packaged-app-black-screen-loadfile-[finish].md) | 打包版黑屏（loadFile） |
| [packaged-app-utf8-locale-glyph-corruption](issues/20260617-packaged-app-utf8-locale-glyph-corruption-[finish].md) | 打包版 UTF-8 locale 字形损坏 |
| [tailfile-utf8-codepoint-split](issues/20260617-tailfile-utf8-codepoint-split-[finish].md) | tailFile 切断 UTF-8 码点出乱码 |

### 🚧 待办
| 文档 | 摘要 |
|------|------|
| [code-review-findings](issues/20260615-code-review-findings-[todo].md) | 代码 Review 发现项（待处理） |
| [terminal-input-freeze-and-dropped-enter](issues/20260615-terminal-input-freeze-and-dropped-enter-[todo].md) | 终端输入冻结 + 回车丢失 |

### 📎 交接记录
| 文档 | 摘要 |
|------|------|
| [minimize-and-audit-handoff](issues/20260611-minimize-and-audit-handoff.md) | 最小化与审计交接 |

---

## plans/ · 施工计划

| 计划 | 状态 | 摘要 |
|------|------|------|
| [虚拟员工 M1](plans/20260620-虚拟员工M1-plan/_index.md) | ✅ done | Role schema + 全局库 + hire + 注入启动 + 组队选择 |
| [员工库导入 M2](plans/20260620-员工库导入M2-plan/_index.md) | ✅ done | 可导入/可自定义的预制员工库 + 模板长大 |
| [UI/UX 优化与构建计划](plans/20260620-UIUX优化与构建计划.md) | ✅ done | 菜单栏/健康检查/i18n/视觉打磨（WS-A~D 全完成） |

---

## reviews/ · 代码评审

| 文档 | 摘要 |
|------|------|
| [team-review-index](reviews/20260615-team-review-index.md) | 团队评审总索引（先看这篇） |
| [full-project-review](reviews/20260615-full-project-review.md) | 全项目评审 |
| [review-claude-rendering-stability](reviews/20260615-review-claude-rendering-stability.md) | Claude 渲染稳定性专项 |
| [review-codex-tmux-orchestration](reviews/20260615-review-codex-tmux-orchestration.md) | Codex / tmux 编排专项 |
| [review-kimi-architecture](reviews/20260615-review-kimi-architecture.md) | Kimi 架构专项 |

---

## reference/ · 外部参考与灵感

> 从 X/Twitter 摘录的外部观点（带 source/author），是「循环工程 / Agent 编排」方向的理论来源，非本仓库自产规格。

| 文档 | 来源 | 摘要 |
|------|------|------|
| [双轨 Agent 工作流](reference/20260618-双轨Agent工作流.md) | Hugo Baraúna | 不要十个 Agent，要「规格轨 + 实现轨」两条；瓶颈在 spec 与验证 |
| [循环工程-让 AI 自己动](reference/20260618-循环工程-让AI自己动.md) | 阿哲Phil | 从写提示词到写循环；拉尔夫循环、5 零件 + 记忆、自动化三笔债 |
| [Agent 循环架构与持久化编排](reference/20260619-Agent循环架构与持久化编排.md) | Dan Farrelly | 三层架构：循环 / 技能 / 编排引擎；持久化是基石 |
