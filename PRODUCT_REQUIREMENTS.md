# 多 Agent 本地协作工作台产品需求文档

## 1. 产品一句话

一个本地优先的多 Agent 协作工作台：用户在一个界面中接入 Codex、Claude Code、Kimi 等多个命令行 Agent，用统一的文档与 Git/Worktree 上下文进行任务分发、评审、开发和记录，避免反复切换窗口、重复交代背景、手动同步分支和文档。

## 2. 背景与问题

用户现在经常需要把同一份技术文档、需求说明、代码分支或 worktree 交给不同 Agent 处理。例如：

- 让 Codex 修改代码。
- 让 Claude Code 做架构或代码评审。
- 让 Kimi 阅读长文档、补充分析或做中文材料整理。
- 让多个 Agent 针对同一个开发分支给出不同角度的建议。

当前流程的问题是：

- 需要在多个终端、App、网页或 IDE 窗口之间频繁切换。
- 每个 Agent 都要重复说明项目路径、分支、目标文档、当前任务和上下文。
- 多个 Agent 的回复分散在不同窗口，难以沉淀成连续文档。
- Agent 是否正在工作、是否卡住、是否需要用户介入，不容易集中观察。
- 多个 Agent 对同一代码库操作时，分支、worktree、文件变更容易混乱。

## 3. 产品目标

### 3.1 核心目标

- 用一个统一界面管理多个本地 Agent 会话。
- 通过 `@agent` 的方式把用户输入路由到指定 Agent。
- 以本地文档作为任务与上下文的统一载体。
- 以 Git 仓库、分支和 worktree 作为代码上下文的统一载体。
- 让每个 Agent 的对话、输出、决策和文件变更都可以被记录、检索和复用。

### 3.2 用户价值

- 少切窗口：在一个产品里看到所有 Agent 的状态与输出。
- 少重复交代：项目背景、文档、分支、约束一次配置，多 Agent 共用。
- 更容易协同：不同 Agent 可以围绕同一任务文档分别工作、评审、交叉验证。
- 更安全可控：每个 Agent 可以绑定独立 worktree，降低互相覆盖代码的风险。
- 更容易沉淀：每个任务天然生成会话记录、结论、变更摘要和评审文档。

## 4. 目标用户

### 4.1 核心用户

- 高频使用 CLI Agent 的开发者。
- 同时使用多个 AI 编程工具的个人开发者或技术负责人。
- 需要让多个模型/Agent 评审同一份技术方案或代码变更的工程师。

### 4.2 典型场景

- 一个需求文档写好后，分别交给多个 Agent 做方案评审。
- 一个代码分支开发完成后，让不同 Agent 从 bug、架构、测试、可维护性角度评审。
- 一个功能需要实现时，让一个 Agent 开发，另一个 Agent 审查，第三个 Agent 总结文档。
- 用户希望保留完整“需求 -> 分发 -> Agent 输出 -> 代码变更 -> 最终结论”的工作记录。

## 5. 产品形态

产品可以理解为三类能力的组合：

1. 多终端编排器：管理多个本地 Agent 的终端进程。
2. 共享上下文中心：把文档、仓库、分支、worktree、任务目标统一组织。
3. 群聊式路由界面：用户通过一个输入框向一个或多个 Agent 发送消息。

## 6. 核心概念

### 6.1 Workspace

一个 Workspace 代表一次协作上下文，通常绑定：

- 一个本地项目目录。
- 一个 Git 仓库。
- 一个或多个 worktree。
- 一组任务文档。
- 一组 Agent 会话。

### 6.2 Agent

Agent 是一个可被产品启动和控制的本地命令行工具，例如：

- Codex
- Claude Code
- Kimi CLI 或 WebBridge
- 自定义 Shell 命令
- 未来可扩展的本地或远端 Agent

每个 Agent 需要配置：

- 名称和显示名。
- 启动命令。
- 工作目录。
- 绑定的 worktree。
- 是否启用。
- 允许的权限范围。
- 默认上下文注入模板。

### 6.3 Context Pack

Context Pack 是发给 Agent 的统一上下文包，包含：

- 任务目标。
- 需求文档路径。
- 技术方案路径。
- 项目路径。
- 当前分支。
- worktree 路径。
- 相关文件列表。
- 用户补充说明。
- 约束条件，例如不要提交、不要改某些文件、先评审不修改等。

### 6.4 Session

Session 是某个 Agent 在某个 Workspace 下的一次连续对话与执行记录。

Session 应沉淀为文档，至少包括：

- 用户发送给该 Agent 的消息。
- Agent 的输出。
- Agent 的状态变化。
- 涉及的文件变更摘要。
- 最终结论或待办。

### 6.5 Worktree

为了降低多 Agent 并行修改冲突，建议每个需要写代码的 Agent 使用独立 worktree。

示例：

- `main-worktree`：用户主工作区。
- `codex-worktree`：Codex 修改代码。
- `claude-review-worktree`：Claude Code 审查或实验。
- `kimi-doc-worktree`：Kimi 主要处理文档或总结。

## 7. 关键工作流

### 7.1 创建协作任务

1. 用户选择一个本地 Git 项目。
2. 产品读取当前仓库状态、分支、未提交变更。
3. 用户选择或创建任务文档。
4. 用户选择要启用的 Agent。
5. 产品为 Agent 分配默认工作目录或 worktree。
6. 产品生成 Context Pack。
7. 用户开始在统一输入框中分发任务。

### 7.2 群聊式分发

用户在输入框输入：

```text
@codex 请根据 docs/spec.md 实现这个功能，先给计划，再开始修改。
```

产品会：

- 找到 Codex 对应的终端 Session。
- 将消息和 Context Pack 拼接或引用后发送到 Codex。
- 在主时间线中记录这次分发。
- 在 Codex 专属 Session 文档中追加这条消息。

用户也可以输入：

```text
@claude @kimi 请分别评审当前方案，重点关注风险和遗漏。
```

产品会并行发送给 Claude 和 Kimi，并在界面上展示各自状态。

### 7.3 多终端观察

用户可以选择不同布局：

- 单列群聊视图：按时间线聚合所有 Agent 输出。
- 三终端纵向排列：Codex、Claude、Kimi 分别占一列或一行。
- 多窗口布局：每个 Agent 一个独立面板。
- 聚焦模式：只看某个 Agent，但保留全局输入框。

每个终端面板需要展示：

- Agent 名称。
- 当前状态：空闲、运行中、等待输入、报错、已暂停。
- 最近输出。
- 绑定 worktree。
- 快捷操作：暂停、继续、清屏、重启、复制摘要、打开 Session 文档。

### 7.4 统一上下文更新

用户修改任务文档或切换分支后，产品应提示：

- 哪些 Agent 的上下文已过期。
- 是否重新广播更新。
- 是否只发变更摘要。

示例：

```text
@all 上下文更新：docs/spec.md 已补充错误处理要求，请基于最新文档继续。
```

### 7.5 评审与合并

当某个 Agent 完成开发后：

1. 产品读取对应 worktree 的 Git diff。
2. 生成变更摘要。
3. 用户可以把 diff 分发给其他 Agent 评审。
4. 评审意见回写到任务文档或 review 文档。
5. 用户决定是否合并、挑选 patch 或继续迭代。

## 8. 功能需求

### 8.1 Workspace 管理

- 创建 Workspace。
- 打开已有 Workspace。
- 绑定本地 Git 仓库。
- 绑定一个或多个任务文档。
- 展示仓库状态、当前分支、未提交变更。
- 展示已配置 Agent 与 Session。

### 8.2 Agent 管理

- 添加 Agent。
- 编辑 Agent 启动命令。
- 开启或关闭 Agent。
- 为 Agent 指定工作目录或 worktree。
- 设置 Agent 权限，例如只读、可修改、可执行命令。
- 重启 Agent Session。
- 查看 Agent 历史会话。

### 8.3 终端管理

- 启动多个伪终端进程。
- 捕获 stdout、stderr 和交互状态。
- 支持向指定终端发送文本。
- 支持终端重启、暂停、结束。
- 支持终端输出日志持久化。
- 支持基础的 ANSI 渲染。

### 8.4 输入路由

- 支持 `@agent` 定向发送。
- 支持 `@all` 广播。
- 支持多 Agent 同时发送，例如 `@codex @claude`。
- 支持默认 Agent 或默认广播策略。
- 支持消息模板，例如“评审模式”“实现模式”“总结模式”。
- 支持发送前预览 Context Pack。

### 8.5 文档中心

- 每个 Workspace 有任务文档目录。
- 每个 Agent Session 自动生成 Markdown 日志。
- 支持把 Agent 输出整理为摘要。
- 支持把结论追加到指定文档。
- 支持引用本地文件路径。
- 支持对某段文档发起多 Agent 评审。

### 8.6 Git 与 Worktree 管理

- 读取当前 Git 状态。
- 创建 Agent 专属 worktree。
- 展示每个 worktree 的分支、状态、diff。
- 支持从某个 worktree 生成 patch。
- 支持把 patch 交给另一个 Agent 评审。
- 支持标记哪些文件由哪个 Agent 修改。
- MVP 阶段不自动 merge，只提供人工确认入口。

### 8.7 状态监控

- 展示所有 Agent 当前状态。
- 检测长时间无输出。
- 检测需要用户输入的提示。
- 检测命令失败或退出。
- 提供通知或状态徽标。

### 8.8 记录与检索

- 按 Workspace 检索历史任务。
- 按 Agent 检索会话。
- 按文件、分支、任务文档检索相关对话。
- 支持导出完整任务记录。

## 9. 非功能需求

### 9.1 本地优先

- 默认数据存储在本地。
- 不强制上传代码和文档。
- 用户明确配置后才调用远端服务。

### 9.2 可追溯

- 所有发送给 Agent 的消息都要可追溯。
- 所有自动注入的上下文都要可查看。
- 所有文件变更都要能关联到对应 Agent Session。

### 9.3 安全性

- Agent 权限要可配置。
- 对危险命令、跨目录访问、删除文件、改 Git 历史等操作应提示。
- 默认不自动合并、不自动 push。

### 9.4 可扩展

- Agent 接入应通过配置或插件机制完成。
- 不把产品绑定死到某一个 Agent。
- 未来可接入网页 Agent、API Agent、远端沙箱 Agent。

## 10. 信息架构

建议主界面包含五个区域：

- 左侧 Workspace/任务列表。
- 顶部 Git 与 Context 状态栏。
- 中间多 Agent 输出区。
- 右侧文档与变更面板。
- 底部统一输入框。

### 10.1 顶部状态栏

显示：

- 当前项目路径。
- 当前主分支。
- 活跃 worktree 数量。
- 当前任务文档。
- 上下文是否最新。

### 10.2 Agent 输出区

支持切换：

- 聚合时间线。
- 多终端网格。
- 三列/三行固定布局。
- 单 Agent 聚焦。

### 10.3 右侧上下文面板

显示：

- Context Pack。
- 任务文档。
- Git diff。
- Agent Session 摘要。
- 待处理评审意见。

## 11. MVP 范围

第一版不追求复杂自动化，重点验证“少切窗口、少重复交代、多 Agent 可控协作”。

### 11.1 MVP 必做

- 本地桌面 App 或 Web UI。
- 支持配置 3 个 Agent。
- 支持启动和监控多个本地终端。
- 支持 `@agent` 路由消息。
- 支持 `@all` 广播。
- 支持选择本地项目目录。
- 支持绑定一个任务 Markdown 文档。
- 支持为每个 Agent 配置工作目录。
- 支持终端输出持久化为 Markdown Session。
- 支持查看 Git 状态和 diff。

### 11.2 MVP 可选

- 自动创建 worktree。
- Agent 输出自动摘要。
- 上下文变更提醒。
- 简单的 Review 分发模板。
- Session 搜索。

### 11.3 MVP 暂不做

- 自动解决 merge conflict。
- 自动合并多个 Agent 的代码。
- 完整权限沙箱。
- 云同步。
- 团队多人协作。
- 复杂插件市场。

## 12. 推荐技术策略

### 12.1 产品架构

建议采用本地桌面应用架构：

- 前端：React 或类似框架。
- 桌面壳：Tauri 或 Electron。
- 后端：Node.js/Rust 负责 PTY、文件系统、Git、进程管理。
- 数据存储：SQLite + 本地 Markdown 文件。
- 终端：xterm.js。
- Git 操作：优先调用本地 Git CLI，复杂场景再封装。

### 12.2 为什么适合桌面 App

- 需要直接控制本地终端。
- 需要访问本地文件与 Git 仓库。
- 需要启动 Codex、Claude Code 等 CLI 工具。
- 需要管理长时间运行的进程。

### 12.3 Agent 接入方式

Agent 先以“命令配置”接入：

```json
{
  "id": "codex",
  "name": "Codex",
  "command": "codex",
  "args": [],
  "cwd": "/path/to/worktree",
  "enabled": true
}
```

后续再演进到插件接口：

- 启动命令。
- 输入协议。
- 输出解析。
- 状态识别。
- 权限声明。
- 上下文模板。

## 13. 数据模型草案

### 13.1 Workspace

```text
Workspace
- id
- name
- root_path
- repo_path
- active_task_doc
- created_at
- updated_at
```

### 13.2 Agent

```text
Agent
- id
- workspace_id
- name
- command
- cwd
- worktree_path
- enabled
- permission_mode
- context_template
```

### 13.3 Session

```text
Session
- id
- workspace_id
- agent_id
- started_at
- ended_at
- status
- log_path
- summary_path
```

### 13.4 Message

```text
Message
- id
- session_id
- role
- content
- context_pack_id
- created_at
```

### 13.5 Context Pack

```text
ContextPack
- id
- workspace_id
- task_doc_path
- repo_path
- branch
- worktree_path
- file_refs
- constraints
- created_at
```

## 14. 核心交互示例

### 14.1 让多个 Agent 评审文档

```text
@claude @kimi 请评审 docs/architecture.md，分别给出你们认为最大的 5 个风险。
```

结果：

- Claude Session 生成架构风险评审。
- Kimi Session 生成中文可读性和遗漏检查。
- 主时间线聚合两边结论。
- 用户可以一键生成综合评审文档。

### 14.2 让 Codex 开发，让 Claude 审查

```text
@codex 请根据 docs/spec.md 实现 MVP 中的终端路由功能，完成后不要提交，给出 diff 摘要。
```

Codex 完成后：

```text
@claude 请基于 codex-worktree 的当前 diff 做 code review，只指出阻塞问题和测试缺口。
```

结果：

- Codex 在自己的 worktree 修改代码。
- Claude 审查 Codex 的 diff。
- 用户根据 review 决定是否继续改。

### 14.3 广播上下文更新

```text
@all 我刚更新了 docs/spec.md 的权限模型，请重新读取后继续。
```

结果：

- 所有启用 Agent 收到更新。
- 每个 Session 记录上下文版本。

## 15. 成功指标

### 15.1 使用效率

- 用户完成一次多 Agent 评审时，手动复制粘贴次数明显减少。
- 用户不需要反复说明项目路径和文档路径。
- 用户可以在一个界面看到所有 Agent 是否完成。

### 15.2 结果质量

- 每次任务都能生成清晰的 Session 文档。
- 每个代码变更能追溯到对应 Agent。
- 多 Agent review 结论可以被合并成结构化文档。

### 15.3 稳定性

- 终端进程可长期运行。
- Agent 输出不会丢失。
- App 重启后能恢复 Workspace 和历史 Session。

## 16. 主要风险与应对

### 16.1 CLI Agent 协议不统一

不同 Agent 的交互提示、状态识别和输出格式不一致。

应对：

- MVP 只做通用 PTY 文本输入输出。
- 状态识别先基于简单规则。
- 后续为常用 Agent 做专用 adapter。

### 16.2 多 Agent 并行改代码容易冲突

多个 Agent 如果共享同一个目录，容易互相覆盖。

应对：

- 推荐每个写代码 Agent 使用独立 worktree。
- 默认只读 Agent 不分配写权限。
- 合并动作必须由用户确认。

### 16.3 上下文注入过长

每次发送完整文档和仓库信息可能浪费 token，也可能导致 Agent 忽略重点。

应对：

- Context Pack 只发送路径、摘要和关键约束。
- 长文档默认让 Agent 自己读取本地文件。
- 维护上下文版本和变更摘要。

### 16.4 进程和权限安全

Agent 本质上可以执行本地命令。

应对：

- 明确显示每个 Agent 的 cwd 和权限。
- MVP 阶段至少提供“只读建议模式”和“可写工作模式”的配置。
- 高风险命令检测作为后续增强。

## 17. 迭代路线

### Phase 1：手动可用的多终端工作台

- 多 Agent 配置。
- 多 PTY 启动与显示。
- `@agent` 路由。
- Session Markdown 记录。
- 项目路径和任务文档绑定。

### Phase 2：Git/Worktree 深度集成

- 自动创建 worktree。
- 每 Agent diff 面板。
- patch 导出。
- review 分发。
- 上下文版本提示。

### Phase 3：文档与评审自动化

- 自动生成任务摘要。
- 自动生成综合 review。
- Agent 输出结构化。
- 文档片段级别分发。
- 历史任务检索。

### Phase 4：插件与高级权限

- Agent adapter 插件系统。
- 权限策略。
- 沙箱执行。
- 更多模型和远端 Agent。
- 团队共享或同步。

## 18. 产品定位建议

这个产品不要只定位为“多个终端放在一起”，否则会和 tmux、iTerm、VS Code Terminal、Warp 等工具重叠。

更准确的定位是：

> 面向 AI 编程时代的本地多 Agent 协作中枢，以文档和 Git 为统一上下文，把多个 CLI Agent 组织成可观察、可追溯、可交接的工作流。

核心差异点应该是：

- Agent 不是普通终端，而是任务参与者。
- 文档不是附件，而是任务上下文源。
- Git/worktree 不是背景信息，而是协作隔离和追踪机制。
- 对话不是临时聊天，而是可沉淀的工程记录。

## 19. 下一步建议

建议下一步先画 MVP 原型和技术验证：

- 验证能否稳定启动和管理多个 PTY。
- 验证 `@agent` 文本路由体验。
- 验证 Session 自动写入 Markdown。
- 验证读取 Git 状态和 worktree diff。
- 验证一个真实流程：`需求文档 -> Codex 实现 -> Claude Review -> Kimi 总结`。

只要这个闭环跑通，产品价值就比较清晰。
