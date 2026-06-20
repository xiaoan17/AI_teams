// Smoke test for the native application menu (src/main/app-menu.cjs).
//
// app-menu.cjs requires "electron" at module load, which is unavailable under
// plain `node`. We inject a minimal electron stub into the module cache BEFORE
// requiring the module, capturing Menu.buildFromTemplate / setApplicationMenu so
// we can assert on the template and exercise item click() callbacks.

const assert = require("assert");
const path = require("path");
const Module = require("module");

// --- electron stub ----------------------------------------------------------
let lastBuiltTemplate = null;
let lastSetMenu = null;
const electronStub = {
  Menu: {
    buildFromTemplate: (template) => {
      lastBuiltTemplate = template;
      return { __template: template };
    },
    setApplicationMenu: (menu) => {
      lastSetMenu = menu;
    }
  },
  shell: {
    openPath: () => {},
    openExternal: () => {}
  },
  app: {
    getName: () => "AI Teams"
  }
};

const electronPath = require.resolve("module"); // any resolvable id; we override the loader instead
void electronPath;

// Override Module._load so `require("electron")` returns our stub.
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return electronStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { buildMenuTemplate, installMenu, THEME_ITEMS } = require(path.join("..", "src", "main", "app-menu.cjs"));

// Restore loader once the module captured the stub.
Module._load = originalLoad;

// --- helpers ----------------------------------------------------------------
function flattenItems(template) {
  const out = [];
  const walk = (items) => {
    for (const item of items || []) {
      out.push(item);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return out;
}

function findById(template, id) {
  return flattenItems(template).find((item) => item.id === id);
}

function findByRole(template, role) {
  return flattenItems(template).filter((item) => item.role === role);
}

// --- build template with injected spies -------------------------------------
const commands = [];
let openedPath = null;
let openedExternal = null;

const template = buildMenuTemplate({
  getWindow: () => ({ isDestroyed: () => false }),
  sendCommand: (id, payload) => commands.push({ id, payload }),
  getLogsDir: () => "/tmp/aiteams/logs",
  isDev: false,
  openExternal: (url) => { openedExternal = url; },
  openPath: (p) => { openedPath = p; }
});

assert.ok(Array.isArray(template) && template.length > 0, "template must be a non-empty array");

// --- macOS app menu present (this smoke runs on darwin) ---------------------
if (process.platform === "darwin") {
  const preferences = findById(template, "preferences");
  assert.ok(preferences, "preferences item must exist");
  assert.strictEqual(preferences.accelerator, "CmdOrCtrl+,", "preferences accelerator");
  assert.ok(findByRole(template, "quit").length > 0, "quit role must exist on macOS");
}

// --- required command items exist with correct accelerators -----------------
const openProject = findById(template, "open-project");
assert.ok(openProject, "open-project item must exist");
assert.strictEqual(openProject.accelerator, "CmdOrCtrl+O", "open-project accelerator");

const startAll = findById(template, "agents-start-all");
assert.ok(startAll, "agents-start-all item must exist");
assert.strictEqual(startAll.accelerator, "CmdOrCtrl+Return", "start-all accelerator");

const stopAll = findById(template, "agents-stop-all");
assert.ok(stopAll, "agents-stop-all item must exist");
assert.strictEqual(stopAll.accelerator, "CmdOrCtrl+.", "stop-all accelerator (Cmd+. does not collide with terminal Ctrl+C SIGINT)");

const toggleSidebar = findById(template, "toggle-sidebar");
assert.ok(toggleSidebar, "toggle-sidebar item must exist");
assert.strictEqual(toggleSidebar.accelerator, "CmdOrCtrl+B", "toggle-sidebar accelerator");

assert.ok(findById(template, "role-configure"), "role-configure item must exist");
assert.ok(findById(template, "open-logs"), "open-logs item must exist");
assert.ok(findById(template, "run-doctor"), "run-doctor item must exist");
assert.ok(findById(template, "help-docs"), "help-docs item must exist");

// --- reload is dev-only: absent when isDev=false ----------------------------
assert.strictEqual(findByRole(template, "reload").length, 0, "reload must NOT appear in production menu");
const devTemplate = buildMenuTemplate({
  getLogsDir: () => "/tmp/x",
  isDev: true,
  sendCommand: () => {}
});
assert.ok(findByRole(devTemplate, "reload").length > 0, "reload MUST appear when isDev=true");
assert.ok(findByRole(devTemplate, "toggleDevTools").length > 0, "devtools must appear in dev menu");

// --- theme submenu mirrors THEME_ITEMS --------------------------------------
for (const t of THEME_ITEMS) {
  const item = findById(template, `theme-${t.id}`);
  assert.ok(item, `theme item theme-${t.id} must exist`);
}

// --- click behaviors --------------------------------------------------------
// Open-logs uses the injected openPath against getLogsDir().
findById(template, "open-logs").click();
assert.strictEqual(openedPath, "/tmp/aiteams/logs", "open-logs click must call injected openPath with logs dir");

// Help docs uses injected openExternal.
findById(template, "help-docs").click();
assert.ok(typeof openedExternal === "string" && openedExternal.length > 0, "help-docs click must call openExternal");

// Renderer-forwarded items push menu:command.
findById(template, "agents-start-all").click();
findById(template, "agents-stop-all").click();
findById(template, "toggle-sidebar").click();
findById(template, "role-configure").click();
findById(template, `theme-${THEME_ITEMS[0].id}`).click();

const ids = commands.map((c) => c.id);
assert.ok(ids.includes("agents:startAll"), "start-all must forward agents:startAll");
assert.ok(ids.includes("agents:stopAll"), "stop-all must forward agents:stopAll");
assert.ok(ids.includes("sidebar:toggle"), "toggle-sidebar must forward sidebar:toggle");
assert.ok(ids.includes("role:configure"), "role-configure must forward role:configure");
const themeCmd = commands.find((c) => c.id === "theme:set");
assert.ok(themeCmd && themeCmd.payload === THEME_ITEMS[0].id, "theme item must forward theme:set with the theme id");

// --- open-logs is a no-op when logs dir is unavailable (no throw) -----------
let nullPathOpened = "untouched";
const noLogsTemplate = buildMenuTemplate({
  getLogsDir: () => null,
  openPath: (p) => { nullPathOpened = p; },
  sendCommand: () => {}
});
findById(noLogsTemplate, "open-logs").click();
assert.strictEqual(nullPathOpened, "untouched", "open-logs must not call openPath when logs dir is null");

// --- installMenu builds + sets the menu -------------------------------------
const built = installMenu({ getLogsDir: () => "/tmp/x", sendCommand: () => {} });
assert.ok(lastBuiltTemplate, "installMenu must build a template");
assert.strictEqual(lastSetMenu, built, "installMenu must call setApplicationMenu with the built menu");

console.log("app-menu-smoke: OK");
