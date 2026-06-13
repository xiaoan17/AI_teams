# 错误与告警日志记录方案

日期：2026-06-13

## 背景

桌面端是纯 PTY/tmux 编排的 Electron 应用（坚持不走 ACP，可靠性靠闭环注入 +
钩子状态文件）。此前主进程只有 13 处散落的 `console.warn/error`，打包成 `.app`
后这些输出无处可见；helper 模块（agent-detect / process-tree / tmux-runtime /
tmux-view）和渲染进程完全静默失败。一旦出现进程清理失败、tmux 路由注入未命中、
agent 检测异常等问题，事后无任何线索可排查。

## 目标

- **始终落盘**：写入 `userData/logs/main-YYYY-MM-DD.log`，打包后也能取证。
- **机器可读**：JSON Lines（每行一条 JSON），便于 `jq`/`grep`/脚本化排查。
- **结构化上下文**：`{ts, level, scope, proc, msg, ...ctx}`，带 agentId/pane/pid 等字段。
- **全局兜底**：捕获 `uncaughtException` / `unhandledRejection`。
- **渲染进程回流**：UI 的 window error / unhandledrejection 汇入同一份文件。
- **自动轮转 + 清理**：按天分文件、5MB 兜底切分、保留最近 14 天。
- **极简依赖取向**：仅引入成熟的 `electron-log`，不自造日志框架。

## 实现

### 依赖

`electron-log@^5`（5.4.4）。开箱提供分级、标准 userData 落盘路径、IPC 渲染进程
桥（`log.initialize()`）和全局崩溃捕获（`errorHandler.startCatching`）。

### 主进程：`src/main/logger.cjs`

封装 electron-log，对外暴露 `initLogger(app)`、`scoped(name)`、`getLogsDir()`。

- **JSON Lines**：文件 transport 用函数式 `format`，把每条消息序列化成单行 JSON。
  约定：第一个参数是人类可读 `msg`，尾随的普通对象作为结构化 `ctx` 合并进记录，
  `Error` 实例被展开为 `{name, message, stack}`。无法序列化时降级为安全行。
- **路径**：`resolvePathFn` 指向 `userData/logs/main-<日期>.log`（按天分文件）。
- **轮转**：`maxSize = 5MB` 作为单日兜底切分；`archiveLogFn` 给溢出文件打时间戳后保留。
- **清理**：初始化时 `pruneOldLogs` 删除 14 天前的 `main-*.log`。
- **级别**：`AITEAMS_LOG_LEVEL` 环境变量统一调（debug/info/warn/error）。
  控制台默认 info（打包后降为 warn），文件默认 info。
- **控制台格式**：可读文本 `[时:分:秒.毫秒] [级别] [scope] 文本`，与文件 JSON 分离。
- **崩溃捕获**：`startCatching`，打包后不弹原生对话框，但一律落盘。
- **渲染桥**：`log.initialize()` 注入 electron-log 的 preload，供渲染进程直连。

接入点（`src/main/main.cjs`）：`app.whenReady()` 内、`createWindow()` 之前调用
`initLogger(app)`（满足 initialize 必须先于 BrowserWindow 创建的约束）。原 13 处
`console.*` 全部替换为带 scope 的结构化调用，scope 划分为
`main / documents / reap / tmux / route`。

### 渲染进程：`src/renderer/renderer-log.mjs`

`import 'electron-log/renderer'`（经 Vite 打包），监听 window 的 `error` 与
`unhandledrejection`，以 `scope:"ui"`、`proc:"renderer"` 汇入主进程同一份文件。
仅在真实 Electron 环境（`window.aiTeams` 存在）安装，浏览器预览跳过（无 IPC 桥）。

### 验证：`scripts/logger-smoke.cjs`

纯 Node 运行（注入 fake app + 临时 userData，无需启动 Electron），断言：
落盘文件存在且每行合法 JSON；必备字段齐全；级别过滤生效（debug 在 info 级被丢弃）；
结构化 ctx 正确合并；Error 序列化含 stack；旧文件被清理。已并入 `npm run smoke`
（`smoke:logger`）。

## 排查用法

```bash
# 日志位置（macOS）
~/Library/Application\ Support/ai-teams/logs/

# 只看渲染进程错误
jq 'select(.proc=="renderer")' main-*.log

# 只看某个 agent 的 tmux 事件
jq 'select(.scope=="tmux" and .agentId=="a1")' main-*.log

# 只看 warn 及以上
jq 'select(.level=="warn" or .level=="error")' main-*.log

# 临时开 debug 级别启动
AITEAMS_LOG_LEVEL=debug npm run dev
```

## 后续可选项

- 为 helper 模块（agent-detect / process-tree / tmux-runtime）补关键路径埋点
  （本次范围仅核心 logger + 兜底；模块埋点留到「全套」范围再做）。
- 在 UI 里加「打开日志目录」入口（已有 `shell.openPath` IPC 可复用）。
