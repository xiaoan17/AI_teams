---
created: 2026-06-17
status: Implemented
state: finish
tags: [packaged-app, locale, utf-8, tmux, glyph-corruption, dev-vs-installed, node-pty]
related:
  - docs/issues/20260617-tailfile-utf8-codepoint-split-[finish].md
  - docs/features/20260616-true-tui-terminal-rendering.md
  - src/main/main.cjs
---

# 安装版边框/输入区乱码：GUI 进程缺 LANG，tmux 客户端退回非 UTF-8

## Summary

本地打包安装的 `/Applications/AI Teams.app` 双击启动后，每个 agent 面板的**边框（`─│╭╮` 等 box-drawing）、CJK、输入行**都渲染成逐字节的乱码（满屏 U+FFFD `�`），而 `npm run dev` 的开发版完全正常。

根因不是渲染代码，而是**环境变量**：从 Finder/Dock 启动的 GUI 进程**不继承登录 shell 的环境**，`LANG`/`LC_*` 通常为空。tmux 用这几个 locale 变量判断自己的客户端是否说 UTF-8；一个都没有时它**退回非 UTF-8 客户端**，于是把多字节字形按单字节拆开渲染 → 每一个框线、每一行 CJK 都碎成 `�`。

dev 版从 shell 启动、继承了 `LANG`，所以看起来好；安装版没有，这就是"乱码只在安装版出现、且每次重启都回来"的指纹。

## User Visible Symptoms

- 双击 `/Applications/AI Teams.app`：agent 面板里的输入框边框、思考动画框、状态栏全是 `�`，CJK 文本也乱。
- 同一份代码 `npm run dev` 跑：完全正常。
- 重启 app 后乱码**稳定复现**（不是偶发）——因为 GUI 启动环境每次都一样缺 `LANG`。

## Root Cause

链条：

1. macOS GUI 进程（Finder/Dock/`open` 启动）不走登录 shell，`process.env.LANG`、`LC_ALL`、`LC_CTYPE` 均为空。
2. 本项目所有终端字节都经 tmux：node-pty 起的 agent 进程、tmux view 客户端、`runTmux`/`runTmuxAsync` 全部以 `process.env` spawn。
3. tmux 启动时检查 `LC_ALL` / `LC_CTYPE` / `LANG`，都为空 → 判定客户端非 UTF-8 → `utf8` 标志关闭。
4. agent 的 TUI 输出多字节序列（box-drawing 是 3 字节 UTF-8，CJK 3 字节，emoji 4 字节），非 UTF-8 客户端把每个字节当独立字符 → 渲染成 `�`。

dev 版 `process.execPath` 是 shell 起的 electron，继承了 `LANG=…UTF-8`，第 3 步通过，所以不复现。

## Fix

`src/main/main.cjs`：在**任何 spawn 之前**给 `process.env` 补一个 UTF-8 locale，且**只补缺失的、绝不覆盖用户已设的**。因为所有下游消费者（node-pty、tmux client、runTmux）都从 `process.env` 取环境，在入口处种一次就一次性修好全部。

```js
function ensureUtf8Locale(env) {
  const hasLocale = ["LC_ALL", "LC_CTYPE", "LANG"].some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim() !== "";
  });
  if (!hasLocale) {
    env.LANG = "en_US.UTF-8";
    env.LC_CTYPE = "en_US.UTF-8";
  }
  return env;
}
ensureUtf8Locale(process.env);   // main.cjs:30-41，模块加载即执行，先于一切 spawn
```

副作用分析：dev 版 / 用户已显式设了 locale 的环境，`hasLocale` 为 true → 不写、不覆盖，行为不变。只有"一个 locale 都没有"的 GUI 启动才补默认值。

## Verification

1. `node --check src/main/main.cjs` 通过。
2. 重新打包 → ditto 安装到 `/Applications` → `open "/Applications/AI Teams.app"`（模拟双击，环境最干净）。
3. agent 面板边框 `─│╭╮`、CJK、输入行渲染正常，无 `�`。

## Notes / 预防

- **根因类别**：凡是依赖 locale 的子进程（tmux 是典型，很多 TUI/CLI 也是），在 GUI（Finder/Dock）启动的 Electron 里都可能因缺 `LANG` 而行为异常。统一在 main 入口 `ensureUtf8Locale(process.env)`，先于任何 spawn。
- 与 [tailFile UTF-8 码点切片修复](20260617-tailfile-utf8-codepoint-split-[finish].md) 是**两个独立的** `�` 来源：本条是"tmux 客户端整体非 UTF-8"，那条是"读取窗口从字节中间切断码点"。两个都修才彻底无乱码。
- 排查口诀：安装版乱码先 `echo $LANG`（在 app 内的 agent 里）看是否为空；为空就是本条。
