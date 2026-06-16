---
created: 2026-06-16
status: Implemented
state: finish
tags: [packaged-app, electron, renderer, black-screen, regression-guard, dev-vs-installed]
related:
  - docs/features/20260616-true-tui-terminal-rendering.md
  - scripts/package-macos-local.cjs
---

# 安装版双击启动黑屏：loadFile 分支漏判 isRunningFromAppBundle

## Summary

本地打包安装的 `/Applications/AI Teams.app` 双击启动后**整窗黑屏**（标题栏正常、内容区全黑、无法使用），而 `npm run dev` 的开发版正常。两者"表现不一致"的根因不是代码版本差异，而是 **main 进程选择"加载 dist 还是加载 dev server"的分支判断漏了一个条件**。

`createWindow()` 用 `app.isPackaged || NODE_ENV==="production"` 决定加载内置资源。但本项目的 macOS 打包是 `scripts/package-macos-local.cjs` 的 **ditto 伪打包**（拷贝 `node_modules/electron/dist/Electron.app` 再注入源码），Electron 的 `app.isPackaged` 在这种产物里是 **`false`**（它只对官方 asar 打包为 true）。于是双击启动时两个条件都不满足 → 走 `else` 分支 `loadURL("http://127.0.0.1:5173")` → 没有 dev server 在跑 → **黑屏**。

这是一个**既有 bug**，与同日的真·TUI 渲染改造无关；只是在反复打包/安装验证 TUI 改动时才被稳定触发出来。

## User Visible Symptoms

- 双击 `/Applications/AI Teams.app`：窗口弹出，**标题栏 "AI Teams" 在，内容区纯黑**，无任何 UI。
- 同一份代码 `npm run dev` 跑：完全正常。
- **"时好时坏"的迷惑特征**：先前某次安装版"看起来能用"，是因为当时恰好开着 dev server（5173 活着），黑屏 app 误连上了 dev server 才显示出内容；dev server 一关，同一个 app 立即黑屏。这种依赖外部 5173 的偶发性正是本 bug 的指纹。

## Root Cause

`src/main/main.cjs` `createWindow()`（修复前）：

```js
const shouldLoadBuiltAssets = app.isPackaged || process.env.NODE_ENV === "production";
if (shouldLoadBuiltAssets) {
  mainWindow.loadFile(distIndexPath);     // 加载内置 dist
} else {
  mainWindow.loadURL(devUrl);             // http://127.0.0.1:5173 ← 双击 app 误入此分支
}
```

矛盾点：同一文件里**其它三处**"是否处于打包/bundle 环境"的判断都正确地带了 `isRunningFromAppBundle()`：

- `defaultWorkspaceRoot()` — `main.cjs:42` `if (app.isPackaged || isRunningFromAppBundle())`
- `mostRecentWorkspaceRoot()` — `main.cjs:924`
- `rememberWorkspace()` — `main.cjs:953`

唯独**页面加载这一处漏了 `isRunningFromAppBundle()`**。

`isRunningFromAppBundle()`（`main.cjs:34`）的判断是：
```js
function isRunningFromAppBundle() {
  return process.execPath.includes(".app/Contents/MacOS/");
}
```
ditto 出来的 .app：`app.isPackaged === false`，但 `isRunningFromAppBundle() === true`。本应据此走 `loadFile`，却因加载分支没带这个条件而落到 dev URL。

## Evidence

诊断过程（关键证据链）：

1. packaged renderer 的 electron-log（`~/Library/Application Support/ai-teams/logs/main-2026-06-16.log`）黑屏时只有 main 的 `logger initialized`，**没有 `renderer logging installed`** → renderer 根本没加载到。
2. 用 `node_modules/.bin/electron "<app>/Contents/Resources/app"` 直接跑（或 `NODE_ENV=production`）→ renderer 从 `file://…/dist/assets/index-*.js` **正常加载**、无报错 → 证明 dist 本身没问题，问题在"是否加载 dist"的判断。
3. 差异只剩一处：`open`/双击启动**不带 `NODE_ENV`**，且伪打包 `app.isPackaged=false` → 命中 `else` 的 `loadURL(devUrl)`。
4. 旁证：日志里 `127.0.0.1:5173` 来源的 `resetTerminalMouseModes/resizeReplayTimer is not defined` 报错是更早**编辑中间态**的 dev 热更新，与黑屏无关——黑屏 app 加载的是 `file://` dist，不是 5173。

## Fix

`src/main/main.cjs` `createWindow()`：加载判断补上 `isRunningFromAppBundle()`，与文件其它三处保持一致。

```js
const shouldLoadBuiltAssets =
  app.isPackaged || isRunningFromAppBundle() || process.env.NODE_ENV === "production";
```

副作用分析（确认不影响 dev）：`npm run dev` 时 `process.execPath` 是 `node_modules/.bin/electron`（不含 `.app/Contents/MacOS/`），`isRunningFromAppBundle()` 为 false，且无 `NODE_ENV=production` → 仍走 `loadURL(devUrl)`，开发版行为不变。

## Verification

1. `node --check src/main/main.cjs` 通过。
2. `npm run package:mac:dmg` 重新打包，确认 `out/AI Teams.app/Contents/Resources/app/src/main/main.cjs` 含修复行。
3. `ditto` 覆盖安装到 `/Applications`，**用 `open "/Applications/AI Teams.app"`（模拟双击，不带 NODE_ENV）启动**。
4. 日志出现 `renderer logging installed`、无 `did-fail-load` / `ERR_CONNECTION_REFUSED` / `5173` → 窗口正常渲染，不再黑屏。

## Notes / 预防

- **根因类别**：判断"是否处于打包/bundle 环境"在本仓库有两种环境（官方 `app.isPackaged` vs 本地 ditto 伪打包），必须统一用 `app.isPackaged || isRunningFromAppBundle()`。任何新增的"打包态分支"都应复用这个组合，而不是只判 `app.isPackaged`。
- **dev vs 安装版"不一致"排查口诀**：安装版黑屏先看 `~/Library/Application Support/ai-teams/logs/` 有没有 `renderer logging installed`；没有就说明加载分支走错（dev URL），不是 renderer 崩。
- 安装版与 dev 版本就用不同的 workspace/config（packaged 默认 `userData/workspace` + `userData/agents.json`），agent 列表不同是设计行为，不是 bug。
