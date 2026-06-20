// Native application menu for AI Teams.
//
// Design goals (see docs/plans/20260620-UIUX优化与构建计划.md §6 WS-A):
//   - Surface operations that were buried in the sidebar ⚙ behind real macOS
//     menus + accelerators (Cmd+Q/W/O/R, Cmd+Enter, etc.).
//   - Two kinds of items:
//       * Main-process direct:  open logs dir, quit, reload, fullscreen — handled
//         here via Electron roles or injected callbacks.
//       * Renderer-forwarded:   toggle sidebar, theme, effects, start/stop all,
//         configure agents, onboarding — sent over `menu:command` so the renderer
//         routes them through its already-tested handlers (no duplicate logic).
//   - Cross-platform template (Electron standard roles adapt per-OS) even though
//     we only ship macOS arm64 today.
//
// IMPORTANT accelerator notes:
//   - `Cmd+.` is the macOS "cancel" convention and is captured by the menu
//     globally. The in-terminal interrupt is Ctrl+C (handled inside xterm/tmux),
//     NOT Cmd+., so binding Stop-All to CmdOrCtrl+. does not steal the CLI's
//     interrupt key. Kept as a normal menu accelerator.
//   - `Cmd+R` (reload) is destructive in production (it reloads the renderer and
//     can disrupt live terminals). It is only added when `isDev` is true.

const { Menu, shell, app } = require("electron");

// Static theme list mirrors src/renderer/themes.js. Kept here (rather than
// importing the ESM renderer module into the main process) because the menu is
// built at app.whenReady, before any renderer exists. If themes.js changes,
// update this list — the app-menu smoke test asserts the ids resolve.
const THEME_ITEMS = [
  { id: "workbenchDark", label: "Workbench Dark" },
  { id: "cleanCode", label: "Clean Code" },
  { id: "paperTrail", label: "Paper Trail" }
];

const DOC_URL = "https://github.com/";
const ISSUES_URL = "https://github.com/";

/**
 * Build the application menu template.
 *
 * @param {object} opts
 * @param {() => import("electron").BrowserWindow|null} opts.getWindow  resolves the current main window
 * @param {(id: string, payload?: any) => void} opts.sendCommand        forwards a `menu:command` to the renderer
 * @param {() => string|null} opts.getLogsDir                           resolves the logs directory (logger.getLogsDir)
 * @param {boolean} [opts.isDev]                                        gate dev-only items (reload/devtools)
 * @param {(url: string) => void} [opts.openExternal]                   injectable for tests (defaults to shell.openExternal)
 * @param {(p: string) => void} [opts.openPath]                         injectable for tests (defaults to shell.openPath)
 * @returns {Array} Electron menu template
 */
function buildMenuTemplate(opts = {}) {
  const {
    getWindow = () => null,
    sendCommand = () => {},
    getLogsDir = () => null,
    isDev = false,
    openExternal = (url) => shell.openExternal(url),
    openPath = (p) => shell.openPath(p)
  } = opts;

  const appName = (app && typeof app.getName === "function" && app.getName()) || "AI Teams";
  const isMac = process.platform === "darwin";

  const openLogsDir = () => {
    const dir = getLogsDir();
    if (dir) {
      openPath(dir);
    }
  };

  const template = [];

  // ── App menu (macOS only) ────────────────────────────────────────────────
  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { role: "about", label: `关于 ${appName}` },
        { type: "separator" },
        {
          id: "preferences",
          label: "偏好设置…",
          accelerator: "CmdOrCtrl+,",
          click: () => sendCommand("settings:open")
        },
        { type: "separator" },
        { role: "hide", label: `隐藏 ${appName}` },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: `退出 ${appName}` }
      ]
    });
  }

  // ── File ─────────────────────────────────────────────────────────────────
  template.push({
    label: "文件",
    submenu: [
      {
        id: "open-project",
        label: "打开项目…",
        accelerator: "CmdOrCtrl+O",
        click: () => sendCommand("workspace:choose")
      },
      { type: "separator" },
      isMac ? { role: "close", label: "关闭窗口" } : { role: "quit", label: `退出 ${appName}` }
    ]
  });

  // ── View ─────────────────────────────────────────────────────────────────
  const viewSubmenu = [
    {
      id: "toggle-sidebar",
      label: "切换侧边栏",
      accelerator: "CmdOrCtrl+B",
      click: () => sendCommand("sidebar:toggle")
    },
    {
      label: "主题",
      submenu: THEME_ITEMS.map((t) => ({
        id: `theme-${t.id}`,
        label: t.label,
        click: () => sendCommand("theme:set", t.id)
      }))
    },
    {
      id: "toggle-effects",
      label: "环境光效",
      click: () => sendCommand("effects:toggle")
    },
    { type: "separator" },
    { role: "togglefullscreen", label: "切换全屏" }
  ];
  // Reload is dev-only: in production it can disrupt live terminal sessions.
  if (isDev) {
    viewSubmenu.push(
      { type: "separator" },
      { role: "reload", label: "重新加载" },
      { role: "toggleDevTools", label: "开发者工具" }
    );
  }
  template.push({ label: "视图", submenu: viewSubmenu });

  // ── Agent / Team ───────────────────────────────────────────────────────────
  template.push({
    label: "团队",
    submenu: [
      {
        id: "agents-start-all",
        label: "全部启动",
        accelerator: "CmdOrCtrl+Return",
        click: () => sendCommand("agents:startAll")
      },
      {
        id: "agents-stop-all",
        label: "全部停止",
        accelerator: "CmdOrCtrl+.",
        click: () => sendCommand("agents:stopAll")
      },
      {
        id: "role-configure",
        label: "配置 Agent…",
        click: () => sendCommand("role:configure")
      },
      { type: "separator" },
      {
        id: "open-logs",
        label: "打开日志目录",
        click: openLogsDir
      },
      {
        id: "run-doctor",
        label: "健康检查…",
        click: () => sendCommand("onboarding:open")
      }
    ]
  });

  // ── Edit (standard roles; gives Cmd+C/V/Z/A in inputs) ─────────────────────
  template.push({
    label: "编辑",
    submenu: [
      { role: "undo", label: "撤销" },
      { role: "redo", label: "重做" },
      { type: "separator" },
      { role: "cut", label: "剪切" },
      { role: "copy", label: "复制" },
      { role: "paste", label: "粘贴" },
      { role: "selectAll", label: "全选" }
    ]
  });

  // ── Help ───────────────────────────────────────────────────────────────────
  template.push({
    role: "help",
    label: "帮助",
    submenu: [
      {
        id: "help-docs",
        label: "使用文档",
        click: () => openExternal(DOC_URL)
      },
      {
        id: "help-issues",
        label: "报告问题",
        click: () => openExternal(ISSUES_URL)
      },
      { type: "separator" },
      {
        id: "help-health",
        label: "健康检查…",
        click: () => sendCommand("onboarding:open")
      }
    ]
  });

  // getWindow is reserved for future window-targeted items; reference it so the
  // signature stays stable and lint doesn't flag it as unused.
  void getWindow;

  return template;
}

/**
 * Build and install the application menu.
 */
function installMenu(opts = {}) {
  const template = buildMenuTemplate(opts);
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

module.exports = { buildMenuTemplate, installMenu, THEME_ITEMS };
