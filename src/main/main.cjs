const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createTmuxViewManager, runTmuxAsync } = require("./tmux-view.cjs");
const {
  parseTmuxAgentPaneTable,
  parseTmuxPaneTable,
  parseTmuxSessionWindows,
  reconcileRuntimePanesFromTable: reconcileRuntimePanes
} = require("./tmux-runtime.cjs");
const agentDetect = require("./agent-detect.cjs");
const { killProcessTree } = require("./process-tree.cjs");
const { initLogger, scoped } = require("./logger.cjs");

// Scoped loggers. Safe to create before initLogger(); electron-log buffers
// early messages and flushes them once transports are configured.
const log = scoped("main");
const logDocs = scoped("documents");
const logReap = scoped("reap");
const logTmux = scoped("tmux");
const logRoute = scoped("route");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const APP_ICON_PATH = path.join(APP_ROOT, "public", "app-icon.png");
app.setName("AI Teams");
if (!process.env.AITEAMS_USER_DATA_PATH) {
  app.setPath("userData", path.join(app.getPath("appData"), "ai-teams"));
} else {
  app.setPath("userData", path.resolve(process.env.AITEAMS_USER_DATA_PATH));
}
function isRunningFromAppBundle() {
  return process.execPath.includes(".app/Contents/MacOS/");
}

function defaultWorkspaceRoot() {
  if (process.env.AITEAMS_WORKSPACE_ROOT) {
    return path.resolve(process.env.AITEAMS_WORKSPACE_ROOT);
  }
  if (app.isPackaged || isRunningFromAppBundle()) {
    return path.join(app.getPath("userData"), "workspace");
  }
  return APP_ROOT;
}

const DEFAULT_WORKSPACE_ROOT = defaultWorkspaceRoot();
const MAX_RECENT_WORKSPACES = 10;
const STATUS_BUFFER_CHARS = 12000;
const TERMINAL_REPLAY_BUFFER_CHARS = 750000;
const TERMINAL_SNAPSHOT_LINES = 2000;
const TMUX_RECONCILE_INTERVAL_MS = 5000;
const COMMON_EXECUTABLE_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  path.join(os.homedir(), "bin"),
  path.join(os.homedir(), ".local", "bin"),
  path.join(os.homedir(), ".cargo", "bin"),
  path.join(os.homedir(), ".bun", "bin"),
  path.join(os.homedir(), ".deno", "bin"),
  path.join(os.homedir(), ".npm-global", "bin"),
  path.join(os.homedir(), ".volta", "bin"),
  path.join(os.homedir(), ".kimi-code", "bin"),
  path.join(os.homedir(), ".claude", "local")
];
let WORKSPACE_ROOT = DEFAULT_WORKSPACE_ROOT;
let AITEAM_DIR = "";
let WORKSPACE_CONFIG_PATH = "";
let SESSIONS_DIR = "";
let STATUS_DIR = "";
let TASKS_DIR = "";
let DOCS_DIR = "";
let DOCUMENT_PINS_PATH = "";
let RUNTIME_PATH = "";
let TMP_DIR = "";

const DOCUMENT_EXCLUDED_DIRS = new Set([
  ".git",
  ".cache",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out"
]);

const mentionPattern = /@ ?([A-Za-z0-9_-]+)/g;
const waitingPatterns = [
  /\b(allow|approve|permission|confirm|continue|proceed)\b/i,
  /\[(y\/N|Y\/n|yes\/no)\]/i,
  /press (enter|return)/i,
  /waiting for (input|confirmation)/i
];

const agents = new Map();
let mainWindow = null;
let nodePty = null;
let documentsWatcher = null;
let documentsChangeTimer = null;
let cachedLoginShellPath = null;

function splitPathList(value) {
  return String(value || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function existingExecutableDirs(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const resolved = path.resolve(entry);
    if (seen.has(resolved)) {
      return false;
    }
    seen.add(resolved);
    try {
      return fs.statSync(resolved).isDirectory();
    } catch (_error) {
      return false;
    }
  });
}

function readLoginShellPath() {
  if (cachedLoginShellPath !== null) {
    return cachedLoginShellPath;
  }
  cachedLoginShellPath = "";
  const shellPath = String(process.env.SHELL || "/bin/zsh");
  if (!path.isAbsolute(shellPath) || !fs.existsSync(shellPath)) {
    return cachedLoginShellPath;
  }
  try {
    cachedLoginShellPath = execFileSync(shellPath, ["-lc", "printf %s \"$PATH\""], {
      encoding: "utf8",
      timeout: 1500,
      env: { ...process.env }
    });
  } catch (_error) {
    cachedLoginShellPath = "";
  }
  return cachedLoginShellPath;
}

function executableSearchDirs() {
  return existingExecutableDirs([
    ...splitPathList(process.env.PATH),
    ...splitPathList(readLoginShellPath()),
    ...COMMON_EXECUTABLE_DIRS
  ]);
}

function ensureDesktopSearchPath() {
  const dirs = executableSearchDirs();
  if (dirs.length) {
    process.env.PATH = dirs.join(path.delimiter);
  }
}

ensureDesktopSearchPath();

function setWorkspaceRoot(root) {
  WORKSPACE_ROOT = path.resolve(root);
  AITEAM_DIR = path.join(WORKSPACE_ROOT, ".aiteam");
  WORKSPACE_CONFIG_PATH = path.join(AITEAM_DIR, "agents.json");
  SESSIONS_DIR = path.join(AITEAM_DIR, "sessions");
  STATUS_DIR = path.join(AITEAM_DIR, "status");
  TASKS_DIR = path.join(AITEAM_DIR, "tasks");
  DOCS_DIR = path.join(WORKSPACE_ROOT, "docs");
  DOCUMENT_PINS_PATH = path.join(AITEAM_DIR, "document-pins.json");
  RUNTIME_PATH = path.join(AITEAM_DIR, "runtime.json");
  TMP_DIR = path.join(AITEAM_DIR, "tmp");
}

setWorkspaceRoot(DEFAULT_WORKSPACE_ROOT);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function recentWorkspacesPath() {
  return path.join(app.getPath("userData"), "recent-workspaces.json");
}

function normalizeWorkspaceRoot(root) {
  const resolved = path.resolve(String(root || ""));
  return path.basename(resolved) === ".aiteam" ? path.dirname(resolved) : resolved;
}

function workspaceConfigPath(root) {
  return path.join(root, ".aiteam", "agents.json");
}

function appAgentConfigPath() {
  const override = String(process.env.AITEAMS_AGENT_CONFIG_PATH || "").trim();
  return override ? path.resolve(override) : path.join(app.getPath("userData"), "agents.json");
}

function legacyAppAgentConfigPath() {
  const legacyDir = path.join(app.getPath("appData"), "AI Teams");
  const currentDir = app.getPath("userData");
  if (path.resolve(legacyDir) === path.resolve(currentDir)) {
    return null;
  }
  return path.join(legacyDir, "agents.json");
}

function appRootAgentConfigPath() {
  return workspaceConfigPath(APP_ROOT);
}

function codexHome() {
  return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

function parseSimpleTomlScalar(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.replace(/\s+#.*$/, "").trim();
}

function readCodexConfigValue(key) {
  const configPath = path.join(codexHome(), "config.toml");
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.+?)\\s*$`);
  for (const line of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const match = line.match(keyPattern);
    if (match) {
      return parseSimpleTomlScalar(match[1]);
    }
  }
  return undefined;
}

function readCodexDesktopAgentMode() {
  const statePath = path.join(codexHome(), ".codex-global-state.json");
  if (!fs.existsSync(statePath)) {
    return "";
  }
  try {
    const state = readJson(statePath, {});
    return String(state?.["electron-persisted-atom-state"]?.["agent-mode-by-host-id"]?.local || "");
  } catch {
    return "";
  }
}

function defaultCodexArgs() {
  const args = [];
  const configuredSandbox = readCodexConfigValue("sandbox_mode");
  if (configuredSandbox) {
    args.push("--sandbox", String(configuredSandbox));
  }
  const configuredApproval = readCodexConfigValue("approval_policy") || readCodexConfigValue("ask_for_approval");
  if (configuredApproval) {
    args.push("--ask-for-approval", String(configuredApproval).replace(/_/g, "-"));
  }
  const desktopMode = readCodexDesktopAgentMode();
  if (!configuredSandbox && !configuredApproval && desktopMode === "full-access") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  return args;
}

function mergeArgs(baseArgs, extraArgs) {
  const merged = [...baseArgs];
  for (const arg of extraArgs) {
    if (!merged.includes(arg)) {
      merged.push(arg);
    }
  }
  return merged;
}

function codexArgsDeclarePermissions(args) {
  return args.some((arg) => (
    arg === "--dangerously-bypass-approvals-and-sandbox" ||
    arg === "--sandbox" ||
    arg.startsWith("--sandbox=") ||
    arg === "-s" ||
    arg === "--ask-for-approval" ||
    arg.startsWith("--ask-for-approval=") ||
    arg === "-a" ||
    arg.includes("sandbox_mode") ||
    arg.includes("approval_policy") ||
    arg.includes("ask_for_approval")
  ));
}

function normalizeCodexAgent(agent) {
  if (agent?.id !== "codex" && String(agent?.command || "") !== "codex") {
    return agent;
  }
  const args = Array.isArray(agent.args) ? agent.args : [];
  return {
    ...agent,
    args: mergeArgs(
      mergeArgs(args, ["--no-alt-screen"]),
      codexArgsDeclarePermissions(args) ? [] : defaultCodexArgs()
    )
  };
}

function resolveExecutableCommand(command) {
  const value = String(command || "").trim();
  if (!value) {
    return "";
  }
  if (value.includes("/")) {
    const resolved = path.isAbsolute(value) ? value : path.resolve(WORKSPACE_ROOT, value);
    try {
      fs.accessSync(resolved, fs.constants.X_OK);
      return resolved;
    } catch (_error) {
      return "";
    }
  }
  for (const dir of executableSearchDirs()) {
    const candidate = path.join(dir, value);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_error) {
      // Keep searching the remaining PATH entries.
    }
  }
  return "";
}

function agentRuntimeCommand(agent) {
  return resolveExecutableCommand(agent.command) || agent.command;
}

function slugify(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

function workspaceSessionName(root) {
  const digest = require("crypto")
    .createHash("sha1")
    .update(path.resolve(root))
    .digest("hex")
    .slice(0, 6);
  return `aiteam-${slugify(workspaceName(root))}-${digest}`;
}

function defaultAppAgentConfig() {
  return {
    config_schema_version: 1,
    routing: {
      default_agent: "codex",
      verify_injection: true,
      verify_timeout_seconds: 1.5
    },
    handoff_template: "请先阅读任务文档：{task_doc}；按文档中的目标、约束和产出路径工作，长上下文以文件内容为准。",
    agents: [
      {
        id: "codex",
        name: "Codex",
        command: "codex",
        args: mergeArgs(["--no-alt-screen"], defaultCodexArgs()),
        cwd: ".",
        enabled: true,
        permission_mode: "configure-before-start"
      },
      {
        id: "claude",
        name: "Claude Code",
        command: "claude",
        args: [],
        cwd: ".",
        enabled: true,
        permission_mode: "configure-before-start"
      },
      {
        id: "kimi",
        name: "Kimi",
        command: "kimi",
        args: [],
        cwd: ".",
        enabled: true,
        permission_mode: "configure-before-start"
      }
    ]
  };
}

function isLegacyDefaultAgentConfig(config) {
  if (!config || typeof config !== "object") {
    return false;
  }
  const agents = Array.isArray(config.agents) ? config.agents : [];
  if (agents.length !== 3) {
    return false;
  }
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return (
    byId.get("codex")?.command === "codex" &&
    byId.get("claude")?.command === "claude" &&
    byId.get("kimi")?.command === "kimi" &&
    agents.every((agent) => agent.cwd === "." && Array.isArray(agent.args) && agent.args.length === 0)
  );
}

function normalizeAgentConfig(config, sourceRoot = null) {
  const defaults = defaultAppAgentConfig();
  const sourceAgents = Array.isArray(config?.agents) && config.agents.length ? config.agents : defaults.agents;
  const seen = new Set();
  const agents = sourceAgents.map((agent) => {
    const id = String(agent?.id || "").trim();
    if (!id) {
      return null;
    }
    if (seen.has(id)) {
      throw new Error(`Agent ids must be unique: ${id}`);
    }
    seen.add(id);
    const next = {
      ...agent,
      id,
      type: String(agent.type || agent.id || id).trim(),
      name: agent.name || id,
      command: agent.command || id,
      args: Array.isArray(agent.args) ? agent.args : []
    };
    const cwd = String(next.cwd || "").trim();
    if (
      !cwd ||
      cwd === "." ||
      (sourceRoot && path.isAbsolute(cwd) && path.resolve(cwd) === path.resolve(sourceRoot))
    ) {
      next.cwd = ".";
    }
    return normalizeCodexAgent(next);
  }).filter(Boolean);

  return {
    ...(config && typeof config === "object" ? config : {}),
    config_schema_version: 1,
    routing: {
      ...defaults.routing,
      ...(config?.routing && typeof config.routing === "object" ? config.routing : {})
    },
    handoff_template: config?.handoff_template || defaults.handoff_template,
    agents
  };
}

function withWorkspaceContext(config) {
  return {
    ...config,
    workspace: {
      name: workspaceName(WORKSPACE_ROOT),
      root: WORKSPACE_ROOT,
      tmux_session: workspaceSessionName(WORKSPACE_ROOT)
    }
  };
}

function isDemoAgentConfig(config) {
  return config?.agents?.length > 0 && config.agents.every((agent) => agent.permission_mode === "demo-echo");
}

function loadWorkspaceDemoConfig() {
  const workspaceConfig = readJson(WORKSPACE_CONFIG_PATH, null);
  if (!isDemoAgentConfig(workspaceConfig)) {
    return null;
  }
  return normalizeAgentConfig(workspaceConfig, WORKSPACE_ROOT);
}

function loadAppAgentConfig() {
  const configPath = appAgentConfigPath();
  const existing = readJson(configPath, null);
  if (existing) {
    const normalized = mergeDiscoveredLocalAgents(normalizeAgentConfig(existing));
    writeJson(configPath, normalized);
    return normalized;
  }

  const legacyPath = legacyAppAgentConfigPath();
  const legacy = legacyPath ? readJson(legacyPath, null) : null;
  if (legacy) {
    const config = mergeDiscoveredLocalAgents(
      isLegacyDefaultAgentConfig(legacy) ? defaultAppAgentConfig() : normalizeAgentConfig(legacy)
    );
    writeJson(configPath, config);
    return config;
  }

  const migrated = readJson(appRootAgentConfigPath(), null);
  const normalizedMigrated = migrated ? normalizeAgentConfig(migrated, APP_ROOT) : null;
  const config = mergeDiscoveredLocalAgents(
    normalizedMigrated?.agents.some((agent) => agent.enabled !== false)
      ? normalizedMigrated
      : defaultAppAgentConfig()
  );
  writeJson(configPath, config);
  return config;
}

function prepareWorkspaceRoot(root) {
  const normalized = normalizeWorkspaceRoot(root);
  ensureDir(normalized);
  ensureDir(path.join(normalized, ".aiteam"));
  return normalized;
}

// --- Agent import (first slice of the plugin/import design) ---------------
// Presets carry metadata only; nothing runs until the user starts the agent.

function builtinAgentPresets() {
  return [
    { id: "codex", name: "Codex", command: "codex", args: mergeArgs(["--no-alt-screen"], defaultCodexArgs()), cwd: ".", enabled: true, provider: "openai", permission_mode: "configure-before-start", versionArgs: ["--version"], docUrl: "https://github.com/openai/codex" },
    { id: "claude", name: "Claude Code", command: "claude", args: [], cwd: ".", enabled: true, provider: "anthropic", permission_mode: "configure-before-start", versionArgs: ["--version"], docUrl: "https://docs.claude.com/claude-code" },
    { id: "kimi", name: "Kimi", command: "kimi", args: [], cwd: ".", enabled: true, provider: "moonshot", permission_mode: "configure-before-start", versionArgs: ["--version"], docUrl: "https://platform.moonshot.cn" },
    { id: "gemini", name: "Gemini CLI", command: "gemini", args: [], cwd: ".", enabled: true, provider: "google", permission_mode: "configure-before-start", versionArgs: ["--version"], docUrl: "https://github.com/google-gemini/gemini-cli" }
  ];
}

function commandAvailable(command) {
  return Boolean(resolveExecutableCommand(command));
}

// Detection helpers live in a standalone, Electron-free module so they can be unit-tested
// (scripts/agent-detect-smoke.cjs). We inject the main-process PATH helpers here.
function detectAllAgentTypes() {
  return agentDetect.detectAllAgentTypes(builtinAgentPresets(), {
    resolveExecutableCommand,
    searchDirs: executableSearchDirs,
    runVersion: agentDetect.defaultRunVersion
  });
}

function discoveredBuiltinAgents() {
  return builtinAgentPresets()
    .filter((preset) => commandAvailable(preset.command))
    .map((preset) => normalizeCodexAgent({
      ...agentDetect.presetToAgentTemplate(preset),
      type: preset.id,
      auto_discovered: true
    }));
}

// Seed a default agent only when the config has no agents yet (first run). Once the user
// has any configured agents, leave composition to them — auto-appending every detected
// CLI would otherwise fight the MAX_AGENTS limit and the "free composition" model.
function mergeDiscoveredLocalAgents(config) {
  const existingAgents = Array.isArray(config.agents) ? config.agents : [];
  if (existingAgents.length) {
    return config;
  }
  const discovered = discoveredBuiltinAgents();
  if (!discovered.length) {
    return config;
  }
  const seed = discovered[0];
  return normalizeAgentConfig({
    ...config,
    routing: {
      ...(config.routing || {}),
      default_agent: config.routing?.default_agent || seed.id
    },
    agents: [seed]
  });
}

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Upper bound on how many agents may be configured in agents.json at once. The terminal
// layout tops out at 3 panes, so this keeps the configuration aligned with what the UI
// can display side by side.
const MAX_AGENTS = 3;

function validateImportedAgentDraft(draft, takenIds) {
  const errors = [];
  const warnings = [];
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return { agent: null, errors: ["Each agent must be a JSON object."], warnings };
  }
  const id = String(draft.id || "").trim();
  if (!id) {
    errors.push("Missing required field: id.");
  } else if (!AGENT_ID_PATTERN.test(id)) {
    errors.push(`Invalid agent id "${id}": use letters, digits, dot, dash, or underscore.`);
  } else if (takenIds.has(id)) {
    errors.push(`Agent id "${id}" already exists.`);
  }
  // Optional type points at a known preset. When present it lets a draft inherit the
  // command/args/provider of that type so the UI can build an instance from a bare pick.
  const type = String(draft.type || "").trim();
  const presetForType = type
    ? builtinAgentPresets().find((preset) => preset.id === type)
    : null;
  if (type && !presetForType) {
    warnings.push(`Unknown agent type "${type}"; keeping it but not inheriting any preset defaults.`);
  }
  let command = String(draft.command || "").trim();
  if (!command && presetForType) {
    command = String(presetForType.command || "").trim();
  }
  if (!command) {
    errors.push("Missing required field: command.");
  }
  let args = [];
  if (draft.args !== undefined && draft.args !== null) {
    if (!Array.isArray(draft.args) || draft.args.some((item) => typeof item !== "string")) {
      errors.push("Field args must be an array of strings.");
    } else {
      args = draft.args;
    }
  } else if (presetForType && Array.isArray(presetForType.args)) {
    args = presetForType.args;
  }
  let cwd = ".";
  if (draft.cwd !== undefined && draft.cwd !== null) {
    if (typeof draft.cwd !== "string") {
      errors.push("Field cwd must be a string.");
    } else {
      cwd = draft.cwd.trim() || ".";
    }
  }
  if (command && !commandAvailable(command)) {
    warnings.push(`Command "${command}" was not found on PATH; the agent cannot start until it is installed.`);
  }
  if (cwd !== "." && path.isAbsolute(cwd) && !fs.existsSync(cwd)) {
    warnings.push(`Working directory ${cwd} does not exist.`);
  }
  // Unknown fields are kept verbatim so newer configs round-trip safely.
  const agent = {
    ...draft,
    id,
    type: type || id,
    name: String(draft.name || presetForType?.name || id),
    command,
    args,
    cwd,
    enabled: draft.enabled === undefined ? true : Boolean(draft.enabled)
  };
  if (!agent.provider && presetForType?.provider) {
    agent.provider = presetForType.provider;
  }
  if (!agent.permission_mode) {
    agent.permission_mode = "configure-before-start";
  }
  // versionArgs/docUrl are detection-only hints and must not leak into persisted configs.
  delete agent.versionArgs;
  delete agent.docUrl;
  return { agent, errors, warnings };
}

function normalizeImportPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.agents)) {
      return payload.agents;
    }
    return [payload];
  }
  throw new Error("Import payload must be an agent object, an array of agents, or { agents: [...] }.");
}

function importAgents(payload, options = {}) {
  if (loadWorkspaceDemoConfig()) {
    throw new Error("Importing agents is disabled in the demo workspace.");
  }
  const drafts = normalizeImportPayload(payload);
  if (!drafts.length) {
    throw new Error("No agents found in the import payload.");
  }
  const config = loadConfig();
  const takenIds = new Set(config.agents.map((agent) => agent.id));
  const results = [];
  for (const draft of drafts) {
    const result = validateImportedAgentDraft(draft, takenIds);
    if (result.agent?.id) {
      takenIds.add(result.agent.id);
    }
    results.push(result);
  }
  const reviewAgents = results.map((result) => ({
    ...(result.agent || {}),
    warnings: result.warnings,
    errors: result.errors
  }));
  const hasErrors = results.some((result) => result.errors.length);
  // The limit is on the total number of configured agents, counting both what already
  // exists and what this batch would add.
  const projected = config.agents.length + results.length;
  const overLimit = projected > MAX_AGENTS;
  const limitError = overLimit
    ? `最多配置 ${MAX_AGENTS} 个 agent（当前 ${config.agents.length}，本次新增 ${results.length}）。`
    : null;
  if (options.dryRun) {
    return { ok: !hasErrors && !overLimit, dryRun: true, agents: reviewAgents, limitError };
  }
  if (hasErrors) {
    throw new Error(results.flatMap((result) => result.errors).join(" "));
  }
  if (overLimit) {
    throw new Error(limitError);
  }
  loadAppAgentConfig(); // Ensures the config file exists before we append.
  const configPath = appAgentConfigPath();
  const rawConfig = readJson(configPath, null) || defaultAppAgentConfig();
  const baseAgents = Array.isArray(rawConfig.agents) && rawConfig.agents.length
    ? rawConfig.agents
    : config.agents;
  rawConfig.agents = [...baseAgents, ...results.map((result) => result.agent)];
  writeJson(configPath, rawConfig);
  return { ok: true, agents: reviewAgents, imported: results.map((result) => result.agent.id) };
}

// Remove an agent instance from the configuration. Stops it first if running, drops it
// from agents.json, and repairs the default_agent pointer if it referenced the removed
// agent. This is what lets a user at the 3-agent limit make room for a different mix.
function removeAgent(agentId) {
  if (loadWorkspaceDemoConfig()) {
    throw new Error("Editing agents is disabled in the demo workspace.");
  }
  const id = String(agentId || "").trim();
  if (!id) {
    throw new Error("Missing agent id.");
  }
  const config = loadConfig();
  if (!config.agents.some((agent) => agent.id === id)) {
    throw new Error(`Agent "${id}" was not found.`);
  }
  // Best-effort stop so we don't leave an orphaned pty/tmux pane behind.
  try {
    stopAgent(id);
  } catch (_error) {
    // The agent may already be stopped or never started; removal proceeds regardless.
  }
  loadAppAgentConfig(); // Ensure the config file exists before we rewrite it.
  const configPath = appAgentConfigPath();
  const rawConfig = readJson(configPath, null) || defaultAppAgentConfig();
  const baseAgents = Array.isArray(rawConfig.agents) ? rawConfig.agents : config.agents;
  const remaining = baseAgents.filter((agent) => agent.id !== id);
  rawConfig.agents = remaining;
  if (rawConfig.routing?.default_agent === id) {
    rawConfig.routing = {
      ...rawConfig.routing,
      default_agent: remaining[0]?.id || ""
    };
  }
  writeJson(configPath, rawConfig);
  return { ok: true, removed: id, remaining: remaining.map((agent) => agent.id) };
}

function workspaceName(root) {
  return path.basename(root) || root;
}

function readRecentWorkspaces() {
  const stored = readJson(recentWorkspacesPath(), { roots: [] });
  const candidates = [
    WORKSPACE_ROOT,
    ...(Array.isArray(stored?.roots) ? stored.roots : []),
    APP_ROOT
  ];
  const seen = new Set();
  return candidates
    .map((root) => {
      try {
        return normalizeWorkspaceRoot(root);
      } catch (_error) {
        return null;
      }
    })
    .filter((root) => {
      if (!root || seen.has(root) || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return false;
      }
      seen.add(root);
      return true;
    })
    .slice(0, MAX_RECENT_WORKSPACES)
    .map((root) => ({
      root,
      name: workspaceName(root),
      configPath: appAgentConfigPath(),
      workspaceStatePath: path.join(root, ".aiteam")
    }));
}

function writeRecentWorkspaces(roots) {
  const seen = new Set();
  const normalized = roots
    .map((root) => normalizeWorkspaceRoot(root))
    .filter((root) => {
      if (seen.has(root)) return false;
      seen.add(root);
      return fs.existsSync(root) && fs.statSync(root).isDirectory();
    })
    .slice(0, MAX_RECENT_WORKSPACES);
  writeJson(recentWorkspacesPath(), { roots: normalized });
}

function rememberWorkspace(root) {
  const recent = readRecentWorkspaces().map((item) => item.root);
  writeRecentWorkspaces([root, ...recent]);
}

function ensureWorkspaceDirs() {
  ensureDir(AITEAM_DIR);
  ensureDir(SESSIONS_DIR);
  ensureDir(STATUS_DIR);
  ensureDir(TMP_DIR);
  ensureDir(DOCS_DIR);
}

function workspaceInfo() {
  return {
    root: WORKSPACE_ROOT,
    name: workspaceName(WORKSPACE_ROOT),
    configPath: appAgentConfigPath(),
    agentConfigPath: appAgentConfigPath(),
    workspaceStatePath: AITEAM_DIR,
    workspaceConfigPath: WORKSPACE_CONFIG_PATH,
    tasksPath: TASKS_DIR,
    docsPath: DOCS_DIR,
    recentWorkspaces: readRecentWorkspaces()
  };
}

function unixPath(value) {
  return value.split(path.sep).join("/");
}

function relativeDocumentPath(filePath) {
  return unixPath(path.relative(WORKSPACE_ROOT, filePath));
}

function resolveDocumentFolder(folder = "") {
  const normalizedFolder = unixPath(String(folder || "")).replace(/^\/+|\/+$/g, "");
  const resolved = path.resolve(DOCS_DIR, normalizedFolder);
  const relative = path.relative(DOCS_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid document folder: ${folder}`);
  }
  return {
    key: unixPath(relative) === "" ? "" : unixPath(relative),
    path: resolved
  };
}

function readDocumentPins() {
  const data = readJson(DOCUMENT_PINS_PATH, { pinned: [] });
  return new Set(Array.isArray(data?.pinned) ? data.pinned : []);
}

function writeDocumentPins(pins) {
  writeJson(DOCUMENT_PINS_PATH, { pinned: [...pins].sort() });
}

function emitDocumentsChanged() {
  emit("documents:changed", {
    root: DOCS_DIR,
    workspaceRoot: WORKSPACE_ROOT,
    changedAt: nowIso()
  });
}

function scheduleDocumentsChanged() {
  if (documentsChangeTimer) {
    clearTimeout(documentsChangeTimer);
  }
  documentsChangeTimer = setTimeout(() => {
    documentsChangeTimer = null;
    emitDocumentsChanged();
  }, 200);
}

function stopDocumentsWatcher() {
  if (documentsChangeTimer) {
    clearTimeout(documentsChangeTimer);
    documentsChangeTimer = null;
  }
  if (documentsWatcher) {
    documentsWatcher.close();
    documentsWatcher = null;
  }
}

function startDocumentsWatcher() {
  stopDocumentsWatcher();
  ensureDir(DOCS_DIR);
  try {
    documentsWatcher = fs.watch(DOCS_DIR, { recursive: true }, scheduleDocumentsChanged);
    documentsWatcher.on("error", (error) => {
      logDocs.warn("documents watcher failed", { dir: DOCS_DIR, error });
      stopDocumentsWatcher();
    });
  } catch (error) {
    logDocs.warn("documents watcher failed", { dir: DOCS_DIR, error });
  }
}

function isDocumentFile(name) {
  return /\.(md|markdown|mdx|txt)$/i.test(name);
}

function isExcludedDocumentDir(name) {
  return name.startsWith(".") || DOCUMENT_EXCLUDED_DIRS.has(name);
}

const DOCUMENT_FIELD_PREVIEW_BYTES = 24 * 1024;
const FINISHED_DOCUMENT_FIELD = /(?:^|[^a-z])(?:finish|finished|done|complete|completed|implemented|closed)(?:[^a-z]|$)|\u5df2\u5b9e\u65bd|\u5df2\u5b8c\u6210|\u5168\u90e8\u843d\u5730|\u901a\u8fc7\u9a8c\u8bc1/iu;
const TODO_DOCUMENT_FIELD = /(?:^|[^a-z])(?:todo|to-do|draft|planned|proposal|proposed|wip|pending|open|backlog)(?:[^a-z]|$)|\u5f85\u529e|\u8349\u7a3f|\u672a\u5b8c\u6210|\u8ba1\u5212|\u5f85\u5b9e\u73b0/iu;

function readDocumentFieldPreview(file, stat) {
  const length = Math.min(stat.size, DOCUMENT_FIELD_PREVIEW_BYTES);
  if (!length) return "";
  let fd = null;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } catch {
    return "";
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failures while building the document index.
      }
    }
  }
}

function extractDocumentTags(value) {
  const tags = [];
  const pattern = /\[([^\]]+)\]/g;
  let match = pattern.exec(value);
  while (match) {
    const tag = match[1].trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
    match = pattern.exec(value);
  }
  return tags;
}

function extractDocumentStatus(preview) {
  const match = String(preview || "").match(/^(?:Status|\u72b6\u6001)\s*[:\uff1a]\s*(.+)$/im);
  return match ? match[1].trim() : "";
}

function extractDocumentState(preview) {
  const match = String(preview || "").match(/^state\s*[:\uff1a]\s*(.+)$/im);
  const value = match ? match[1].trim() : "";
  if (!value) return "";
  if (FINISHED_DOCUMENT_FIELD.test(value)) return "finish";
  if (TODO_DOCUMENT_FIELD.test(value)) return "todo";
  return "";
}

function extractDocumentFields(file, name, relativePath, stat) {
  const preview = readDocumentFieldPreview(file, stat);
  const status = extractDocumentStatus(preview);
  const tags = extractDocumentTags(`${name} ${relativePath}`);
  return {
    status,
    tags,
    state: extractDocumentState(preview)
  };
}

function documentFromFile(file, name, pins) {
  const stat = fs.statSync(file);
  const relativePath = relativeDocumentPath(file);
  const parentFolder = unixPath(path.relative(DOCS_DIR, path.dirname(file)));
  return {
    type: "document",
    name,
    path: file,
    relativePath,
    folder: parentFolder === "" ? "" : parentFolder,
    updatedAt: stat.mtime.toISOString(),
    pinned: pins.has(relativePath),
    fields: extractDocumentFields(file, name, relativePath, stat)
  };
}

function sortDocumentTreeChildren(children) {
  return children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    if (a.type === "document" && b.type === "document" && a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function buildDocumentTreeNode(dir, pins, documents) {
  const relative = unixPath(path.relative(DOCS_DIR, dir));
  const key = relative === "" ? "" : relative;
  const node = {
    type: "folder",
    name: key ? path.basename(dir) : "docs",
    key,
    path: dir,
    relativePath: key ? `docs/${key}` : "docs",
    documentCount: 0,
    children: []
  };

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isExcludedDocumentDir(entry.name)) {
        continue;
      }
      const child = buildDocumentTreeNode(entryPath, pins, documents);
      node.documentCount += child.documentCount;
      node.children.push(child);
      continue;
    }
    if (!entry.isFile() || !isDocumentFile(entry.name)) {
      continue;
    }
    const document = documentFromFile(entryPath, entry.name, pins);
    documents.push(document);
    node.documentCount += 1;
    node.children.push(document);
  }

  sortDocumentTreeChildren(node.children);
  return node;
}

function nowIso() {
  return new Date().toISOString();
}

function localStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function loadConfig() {
  const demoConfig = loadWorkspaceDemoConfig();
  const agentConfig = demoConfig || loadAppAgentConfig();
  return withWorkspaceContext(agentConfig);
}

function shellCommand(agent) {
  const args = Array.isArray(agent.args) ? agent.args : [];
  return [agent.command, ...args].filter(Boolean).join(" ");
}

function agentCwd(agent) {
  const cwd = agent.cwd || WORKSPACE_ROOT;
  return path.isAbsolute(cwd) ? cwd : path.resolve(WORKSPACE_ROOT, cwd);
}

function enabledAgents() {
  return loadConfig().agents.filter((agent) => agent.enabled !== false);
}

function statusForState(agentId, state, patch = {}) {
  return {
    id: agentId,
    status: state?.status || "stopped",
    reason: state?.reason || "",
    pid: state?.ptyProcess?.pid || null,
    backend: state?.backend || "direct-pty",
    updatedAt: nowIso(),
    ...patch
  };
}

function emit(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

function persistStatus(agentId, status) {
  writeJson(path.join(STATUS_DIR, `${agentId}.json`), status);
}

function persistStatusForState(agentId, state) {
  writeJson(path.join(state.statusDir, `${agentId}.json`), statusForState(agentId, state));
}

function appendMarkdown(file, title, body) {
  ensureDir(path.dirname(file));
  const text = `\n## ${title}\n\n_Time: ${nowIso()}_\n\n\`\`\`text\n${body.trimEnd()}\n\`\`\`\n`;
  fs.appendFileSync(file, text);
}

function appendTimeline(targets, message) {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const file = path.join(SESSIONS_DIR, `timeline-${day}.md`);
  appendMarkdown(file, `Route ${targets.join(", ")}`, message);
}

function createSessionFiles(agent) {
  const dir = path.join(SESSIONS_DIR, agent.id);
  ensureDir(dir);
  const stamp = localStamp();
  const rawLog = path.join(dir, `${stamp}.ansi.log`);
  const markdownLog = path.join(dir, `${stamp}.md`);
  fs.writeFileSync(
    markdownLog,
    [
      `# ${agent.name || agent.id} Session`,
      "",
      `- Agent: \`${agent.id}\``,
      `- Started: ${nowIso()}`,
      `- Command: \`${shellCommand(agent)}\``,
      `- CWD: \`${agentCwd(agent)}\``,
      `- Raw terminal log: \`${rawLog}\``,
      ""
    ].join("\n")
  );
  fs.writeFileSync(rawLog, "");
  return { rawLog, markdownLog };
}

function inferStatus(data) {
  const tail = data.slice(-4000);
  for (const pattern of waitingPatterns) {
    if (pattern.test(tail)) {
      return { status: "waiting_input", reason: `matched pattern: ${pattern.source}` };
    }
  }
  return { status: "running_or_idle", reason: "heuristic only; no hook status configured" };
}

function appendBoundedText(current, data, limit) {
  const next = `${current || ""}${data || ""}`;
  if (next.length <= limit) {
    return { text: next, truncated: false };
  }
  return { text: next.slice(-limit), truncated: true };
}

function getNodePty() {
  if (nodePty) {
    return nodePty;
  }
  try {
    nodePty = require("node-pty");
    return nodePty;
  } catch (error) {
    throw new Error(
      `node-pty is unavailable: ${error.message}. Run npm install again to restore interactive terminal views.`
    );
  }
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function agentShellCommand(agent) {
  const args = Array.isArray(agent.args) ? agent.args : [];
  return [agentRuntimeCommand(agent), ...args].filter(Boolean).map(shellQuote).join(" ");
}

function directAgentPublicState(agent) {
  const running = agents.get(agent.id);
  return {
    id: agent.id,
    name: agent.name || agent.id,
    command: shellCommand(agent),
    cwd: agentCwd(agent),
    enabled: agent.enabled !== false,
    status: running?.status || "stopped",
    reason: running?.reason || "",
    pid: running?.ptyProcess?.pid || null,
    backend: "direct-pty",
    pane: null,
    startedAt: running?.startedAt || null,
    markdownLog: running?.markdownLog || null,
    rawLog: running?.rawLog || null
  };
}

function directAgentTerminalSnapshot(agentId) {
  const state = agents.get(agentId);
  if (!state) {
    return {
      id: agentId,
      seq: 0,
      data: "",
      source: "direct-pty-memory",
      truncated: false,
      backend: "direct-pty"
    };
  }
  return {
    id: agentId,
    seq: state.outputSeq || 0,
    data: state.replayBuffer || "",
    source: "direct-pty-memory",
    truncated: Boolean(state.replayTruncated),
    backend: "direct-pty"
  };
}

function directListAgentStates() {
  return loadConfig().agents.map(directAgentPublicState);
}

function directStartAgent(agentId) {
  const config = loadConfig();
  const agent = config.agents.find((item) => item.id === agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
  if (agent.enabled === false) {
    throw new Error(`Agent is disabled: ${agentId}`);
  }
  const existing = agents.get(agentId);
  if (existing?.ptyProcess) {
    return directAgentPublicState(agent);
  }

  ensureDir(SESSIONS_DIR);
  ensureDir(STATUS_DIR);
  const sessionFiles = createSessionFiles(agent);
  const args = Array.isArray(agent.args) ? agent.args : [];
  let ptyProcess;
  try {
    ptyProcess = getNodePty().spawn(agentRuntimeCommand(agent), args, {
      name: "xterm-256color",
      cols: 96,
      rows: 28,
      cwd: agentCwd(agent),
      env: { ...process.env, TERM: "xterm-256color" }
    });
  } catch (error) {
    persistStatus(agentId, {
      id: agentId,
      status: "error",
      reason: error.message,
      pid: null,
      updatedAt: nowIso()
    });
    throw new Error(`Failed to start ${agentId}: ${error.message}`);
  }

  const state = {
    agent,
    ptyProcess,
    rawLog: sessionFiles.rawLog,
    markdownLog: sessionFiles.markdownLog,
    statusDir: STATUS_DIR,
    workspaceRoot: WORKSPACE_ROOT,
    backend: "direct-pty",
    status: "starting",
    reason: "process spawned",
    buffer: "",
    replayBuffer: "",
    replayTruncated: false,
    outputSeq: 0,
    startedAt: nowIso()
  };
  agents.set(agentId, state);
  persistStatusForState(agentId, state);

  ptyProcess.onData((data) => {
    state.outputSeq += 1;
    state.buffer = appendBoundedText(state.buffer, data, STATUS_BUFFER_CHARS).text;
    const replay = appendBoundedText(state.replayBuffer, data, TERMINAL_REPLAY_BUFFER_CHARS);
    state.replayBuffer = replay.text;
    state.replayTruncated = state.replayTruncated || replay.truncated;
    fs.appendFileSync(state.rawLog, data);
    const inferred = inferStatus(state.buffer);
    state.status = inferred.status;
    state.reason = inferred.reason;
    persistStatusForState(agentId, state);
    if (agents.get(agentId) === state) {
      emit("agent:data", { id: agentId, data, seq: state.outputSeq, source: "direct-pty", backend: "direct-pty" });
      emit("agent:status", directAgentPublicState(agent));
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    state.status = "exited";
    state.reason = `exitCode=${exitCode} signal=${signal || ""}`.trim();
    state.ptyProcess = null;
    persistStatusForState(agentId, state);
    if (agents.get(agentId) === state) {
      emit("agent:status", directAgentPublicState(agent));
    }
  });

  emit("agent:status", directAgentPublicState(agent));
  return directAgentPublicState(agent);
}

function directStopAgent(agentId) {
  const state = agents.get(agentId);
  if (!state?.ptyProcess) {
    return;
  }
  const pid = state.ptyProcess.pid;
  state.ptyProcess.kill();
  state.ptyProcess = null;
  // Reap any helper/MCP children the CLI forked that escaped the pty's signal.
  // Best-effort and async; the pty itself is already down.
  if (Number.isInteger(pid) && pid > 1) {
    killProcessTree(pid).catch((error) => {
      logReap.warn("direct-pty process-tree reap failed", { agentId, pid, error });
    });
  }
  state.status = "stopped";
  state.reason = "stopped by user";
  persistStatusForState(agentId, state);
  emit("agent:status", directAgentPublicState(state.agent));
}

function directStopAllAgents() {
  for (const agentId of [...agents.keys()]) {
    directStopAgent(agentId);
  }
  agents.clear();
}

function directWriteToAgent(agentId, data) {
  const state = agents.get(agentId);
  if (!state?.ptyProcess) {
    throw new Error(`Agent is not running: ${agentId}`);
  }
  state.ptyProcess.write(data);
}

function directResizeAgent(agentId, cols, rows) {
  const state = agents.get(agentId);
  if (state?.ptyProcess && Number.isFinite(cols) && Number.isFinite(rows)) {
    state.ptyProcess.resize(Math.max(20, cols), Math.max(5, rows));
  }
}

function directPasteAndSubmitToAgent(agentId, message) {
  // Bracketed paste gives full-screen CLIs one atomic payload before Enter submits it.
  directWriteToAgent(agentId, `\x1b[200~${message}\x1b[201~\r`);
}

function runtimeSession(config = loadConfig()) {
  // Always derive the session name from the live workspace path. A stale
  // `tmux_session` frozen into agents.json by an older init (e.g. a name
  // without the sha1 suffix) must never win over the computed value, or
  // doctor/stop/attach end up targeting a session the app never created.
  // The frozen value is only a last-resort fallback if computation fails.
  return workspaceSessionName(WORKSPACE_ROOT) || config.workspace?.tmux_session;
}

function readRuntime() {
  return readJson(RUNTIME_PATH, {});
}

function saveRuntime(runtime) {
  writeJson(RUNTIME_PATH, runtime);
}

function normalizeRuntime(runtime, session) {
  return {
    runtime_schema_version: 1,
    session,
    backend: "tmux",
    started_at: runtime?.started_at || nowIso(),
    agents: runtime?.agents && typeof runtime.agents === "object" ? runtime.agents : {}
  };
}

function tmuxDetail(error) {
  const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString("utf8") : String(error.stdout || "");
  const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : String(error.stderr || "");
  return stderr.trim() || stdout.trim() || error.message;
}

function runTmux(args, options = {}) {
  const check = options.check !== false;
  try {
    const stdout = execFileSync("tmux", args, {
      encoding: "utf8",
      input: options.input,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString("utf8") : String(error.stdout || "");
    const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : String(error.stderr || "");
    if (check) {
      throw new Error(`tmux ${args.join(" ")} failed: ${tmuxDetail(error)}`);
    }
    return { status: error.status || 1, stdout, stderr };
  }
}

function tmuxAvailable() {
  return runTmux(["-V"], { check: false }).status === 0;
}

function tmuxHasSession(session) {
  return runTmux(["has-session", "-t", session], { check: false }).status === 0;
}

// True when a session exists AND still has at least one live (non-dead) pane.
// A session shell can outlive all its panes (zombie shell); callers that want
// to reuse a session must check liveness, not mere existence.
function tmuxSessionHasLivePane(session) {
  const result = runTmux(
    ["list-panes", "-s", "-t", session, "-F", "#{pane_dead}"],
    { check: false }
  );
  if (result.status !== 0) {
    return false;
  }
  return result.stdout.split("\n").some((line) => line.trim() === "0");
}

function tmuxPaneField(pane, field) {
  const proc = runTmux(["display-message", "-p", "-t", pane, field], { check: false });
  if (proc.status !== 0) {
    return null;
  }
  return proc.stdout.trim();
}

function tmuxPaneDead(pane) {
  const value = tmuxPaneField(pane, "#{pane_dead}");
  if (value === null) {
    return null;
  }
  return value === "1";
}

function tmuxPanePid(pane) {
  const value = tmuxPaneField(pane, "#{pane_pid}");
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

// Reclaim the full process tree behind a tmux pane before we discard the pane
// itself. tmux's own kill only HUPs the pane's foreground process; agent CLIs
// fork MCP servers / helpers that escape that signal, so we walk the PID
// lineage from #{pane_pid} and reap it directly. Best-effort: a missing pid
// (pane already gone) is not an error.
async function reapPaneProcessTree(pane) {
  if (!pane) {
    return;
  }
  const pid = tmuxPanePid(pane);
  if (!pid) {
    return;
  }
  try {
    const result = await killProcessTree(pid);
    if (!result.ok) {
      logReap.warn("process-tree reap incomplete", { pane, pid, reason: result.reason });
    }
  } catch (error) {
    logReap.warn("process-tree reap failed", { pane, pid, error });
  }
}

// Reap the process trees of every live pane in a base session. Used before
// kill-session (Stop All) and before quit, so no agent CLI outlives the app.
async function reapBaseSessionProcessTrees(session) {
  if (!session || !tmuxHasSession(session)) {
    return;
  }
  const result = runTmux(
    ["list-panes", "-s", "-t", session, "-F", "#{pane_pid}"],
    { check: false }
  );
  if (result.status !== 0) {
    return;
  }
  const pids = result.stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 1);
  for (const pid of pids) {
    try {
      await killProcessTree(pid);
    } catch (error) {
      logReap.warn("process-tree reap failed", { session, pid, error });
    }
  }
}

function tmuxCapturePane(pane, lines = TERMINAL_SNAPSHOT_LINES) {
  return runTmux(["capture-pane", "-p", "-e", "-S", `-${lines}`, "-t", pane]).stdout;
}

function tailFile(file, maxChars = TERMINAL_REPLAY_BUFFER_CHARS) {
  if (!file || !fs.existsSync(file)) {
    return "";
  }
  const data = fs.readFileSync(file, "utf8");
  return data.length > maxChars ? data.slice(-maxChars) : data;
}

function fileSize(file) {
  if (!file || !fs.existsSync(file)) {
    return 0;
  }
  return fs.statSync(file).size;
}

function setupTmuxAgentRuntime(root, agent, pane) {
  const sessionFiles = createSessionFiles(agent);
  runTmux(["pipe-pane", "-o", "-t", pane, `cat >> ${shellQuote(sessionFiles.rawLog)}`]);
  return {
    pane,
    raw_log: sessionFiles.rawLog,
    markdown_log: sessionFiles.markdownLog,
    started_at: nowIso()
  };
}

function createTmuxSession(config, agentsToStart = null) {
  const session = runtimeSession(config);
  const startList = (agentsToStart || config.agents).filter((agent) => agent.enabled !== false);
  if (!startList.length) {
    throw new Error("No enabled agents. Enable at least one agent before starting.");
  }

  const runtime = normalizeRuntime({}, session);
  const [first, ...rest] = startList;
  runTmux([
    "new-session",
    "-d",
    "-s",
    session,
    "-n",
    first.id,
    "-c",
    agentCwd(first),
    agentShellCommand(first)
  ]);
  const firstPane = runTmux(["display-message", "-p", "-t", `${session}:0.0`, "#{pane_id}"]).stdout.trim();
  runtime.agents[first.id] = setupTmuxAgentRuntime(WORKSPACE_ROOT, first, firstPane);

  for (const agent of rest) {
    const pane = runTmux([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      session,
      "-n",
      agent.id,
      "-c",
      agentCwd(agent),
      agentShellCommand(agent)
    ]).stdout.trim();
    runtime.agents[agent.id] = setupTmuxAgentRuntime(WORKSPACE_ROOT, agent, pane);
  }

  saveRuntime(runtime);
  return runtime;
}

function ensureTmuxAgentPane(config, agent, runtime) {
  const session = runtimeSession(config);
  const current = runtime.agents?.[agent.id];
  const currentDead = current?.pane ? tmuxPaneDead(current.pane) : null;
  if (current?.pane && currentDead === false) {
    return runtime;
  }
  if (current?.pane && currentDead === true) {
    runTmux(["kill-pane", "-t", current.pane], { check: false });
  }

  const pane = runTmux([
    "new-window",
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-t",
    session,
    "-n",
    agent.id,
    "-c",
    agentCwd(agent),
    agentShellCommand(agent)
  ]).stdout.trim();
  runtime.agents[agent.id] = setupTmuxAgentRuntime(WORKSPACE_ROOT, agent, pane);
  saveRuntime(runtime);
  return runtime;
}

function tmuxAgentPublicState(agent, context = {}) {
  const config = context.config || loadConfig();
  const runtime = context.runtime || readRuntime();
  const session = runtime.session || runtimeSession(config);
  const runtimeAgent = runtime.agents?.[agent.id] || {};
  const base = {
    id: agent.id,
    name: agent.name || agent.id,
    command: shellCommand(agent),
    cwd: agentCwd(agent),
    enabled: agent.enabled !== false,
    status: "stopped",
    reason: "",
    pid: null,
    backend: "tmux",
    pane: runtimeAgent.pane || null,
    startedAt: runtimeAgent.started_at || null,
    markdownLog: runtimeAgent.markdown_log || null,
    rawLog: runtimeAgent.raw_log || null
  };

  if (agent.enabled === false) {
    return base;
  }
  if (!tmuxAvailable()) {
    return { ...base, status: "error", reason: "tmux is not installed or not on PATH" };
  }
  if (!tmuxHasSession(session)) {
    return { ...base, status: "stopped", reason: `tmux session is not running: ${session}` };
  }
  if (runtimeAgent.stopped && !runtimeAgent.pane) {
    return { ...base, status: "stopped", reason: runtimeAgent.reason || "stopped by user" };
  }
  if (!runtimeAgent.pane) {
    return { ...base, status: "stopped", reason: "not started" };
  }

  const dead = context.dead ?? tmuxPaneDead(runtimeAgent.pane);
  if (dead === null) {
    return { ...base, status: "pane_missing", reason: `Recorded tmux pane is missing: ${runtimeAgent.pane}` };
  }
  if (dead) {
    return { ...base, status: "exited", reason: "tmux pane process has exited" };
  }

  const capture = context.capture ?? (() => {
    try {
      return tmuxCapturePane(runtimeAgent.pane, 120);
    } catch (_error) {
      return tailFile(runtimeAgent.raw_log, STATUS_BUFFER_CHARS);
    }
  })();
  const inferred = inferStatus(capture || "");
  return { ...base, status: inferred.status, reason: inferred.reason };
}

let tmuxReconcileTimer = null;
let tmuxReconcileInFlight = false;
const tmuxLastStatusKey = new Map();

function tmuxStatusKey(publicState) {
  return [
    publicState.status || "",
    publicState.reason || "",
    publicState.pane || "",
    publicState.startedAt || "",
    publicState.rawLog || ""
  ].join("\u0000");
}

function emitTmuxStatusIfChanged(agentId, publicState, options = {}) {
  const key = tmuxStatusKey(publicState);
  if (!options.force && tmuxLastStatusKey.get(agentId) === key) {
    return;
  }
  tmuxLastStatusKey.set(agentId, key);
  persistStatus(agentId, publicState);
  emit("agent:status", publicState);
}

function publicStateForTmuxView(agentId, patch = {}) {
  const config = loadConfig();
  const agent = config.agents.find((item) => item.id === agentId);
  if (!agent) {
    return null;
  }
  const runtime = readRuntime();
  const { dead, capture, ...publicPatch } = patch;
  return {
    ...tmuxAgentPublicState(agent, {
      config,
      runtime,
      dead: dead ?? false,
      capture: capture ?? tmuxViews.statusText(agentId)
    }),
    ...publicPatch
  };
}

const tmuxViews = createTmuxViewManager({
  getNodePty,
  statusBufferChars: STATUS_BUFFER_CHARS,
  replayBufferChars: TERMINAL_REPLAY_BUFFER_CHARS,
  loadReplaySeed: (agentId) => tailFile(readRuntime().agents?.[agentId]?.raw_log, TERMINAL_REPLAY_BUFFER_CHARS),
  onData: (agentId, { data, seq }) => {
    emit("agent:data", { id: agentId, data, seq, source: "tmux-view", backend: "tmux" });
    try {
      const publicState = publicStateForTmuxView(agentId);
      if (publicState) {
        emitTmuxStatusIfChanged(agentId, publicState);
      }
    } catch (error) {
      logTmux.warn("failed to infer tmux status", { agentId, error });
    }
  },
  onViewState: (agentId, event) => {
    try {
      const statusPatch = { reason: event.reason || "" };
      if (event.state === "reattaching") {
        statusPatch.status = "starting";
      } else if (event.state === "detached") {
        statusPatch.status = "error";
      } else if (event.state === "exited") {
        statusPatch.status = "exited";
        statusPatch.dead = true;
      }
      const publicState = publicStateForTmuxView(agentId, statusPatch);
      if (publicState) {
        emitTmuxStatusIfChanged(agentId, publicState, { force: event.state !== "attached" });
      }
    } catch (error) {
      logTmux.warn("failed to publish tmux view state", { agentId, error });
    }
  }
});

function reconcileRuntimePanesFromTable(config, runtime, panesByAgentId) {
  const { runtime: nextRuntime, changed } = reconcileRuntimePanes(config, runtime, panesByAgentId, { now: nowIso });
  if (changed) {
    saveRuntime(nextRuntime);
  }
  return nextRuntime;
}

async function recoverTmuxRuntimePanes(config, runtime) {
  const session = runtimeSession(config);
  const panesResult = await runTmuxAsync(
    ["list-panes", "-s", "-t", session, "-F", "#{pane_id}\t#{pane_dead}\t#{window_name}"],
    { check: false }
  );
  if (panesResult.status !== 0) {
    return runtime;
  }
  return reconcileRuntimePanesFromTable(config, runtime, parseTmuxAgentPaneTable(panesResult.stdout));
}

async function destroyTmuxViewSessionsForBase(baseSession) {
  const result = await runTmuxAsync(["list-sessions", "-F", "#{session_name}"], { check: false });
  if (result.status !== 0) {
    return;
  }
  const prefix = `${baseSession}-view-`;
  const viewSessions = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((sessionName) => sessionName.startsWith(prefix));
  await Promise.all(viewSessions.map((sessionName) => (
    runTmuxAsync(["kill-session", "-t", sessionName], { check: false })
  )));
}

async function destroyTmuxViewSessionForAgent(config, agentId) {
  await tmuxViews.destroyView(agentId);
  await runTmuxAsync(["kill-session", "-t", `${runtimeSession(config)}-view-${agentId}`], { check: false });
}

async function ensureTmuxViewForAgent(agent, config, runtime, panes = null) {
  const runtimeAgent = runtime.agents?.[agent.id];
  if (!runtimeAgent?.pane) {
    return false;
  }
  const paneState = panes?.get(runtimeAgent.pane);
  if (paneState && paneState.dead) {
    return false;
  }
  await tmuxViews.ensureView({
    agentId: agent.id,
    baseSession: runtimeSession(config),
    pane: runtimeAgent.pane,
    cols: 96,
    rows: 28
  });
  return true;
}

async function reconcileTmuxBackend() {
  if (selectedBackendName() !== "tmux") {
    stopTmuxReconcile();
    return;
  }
  if (tmuxReconcileInFlight) {
    return;
  }
  tmuxReconcileInFlight = true;
  try {
    const config = loadConfig();
    const session = runtimeSession(config);
    const hasBase = await runTmuxAsync(["has-session", "-t", session], { check: false });
    if (hasBase.status !== 0) {
      await tmuxViews.destroyAll();
      await destroyTmuxViewSessionsForBase(session);
      for (const agent of config.agents) {
        const publicState = tmuxAgentPublicState(agent, { config });
        emitTmuxStatusIfChanged(agent.id, publicState);
      }
      return;
    }

    const runtime = normalizeRuntime(readRuntime(), session);
    const panesResult = await runTmuxAsync(
      ["list-panes", "-s", "-t", session, "-F", "#{pane_id}\t#{pane_dead}\t#{window_id}\t#{window_name}"],
      { check: false }
    );
    const panes = parseTmuxPaneTable(panesResult.stdout);

    // Zombie session guard: tmux can leave a session shell alive after every
    // pane inside it has died (or been killed externally). `has-session` still
    // reports success, so the rest of reconcile would keep waiting on panes
    // that no longer exist and the UI hangs. If the session has no live panes,
    // tear the shell down here and fall back to the "no base session" path so
    // the next start rebuilds a clean session.
    const hasLivePane = [...panes.values()].some((pane) => !pane.dead);
    if (!hasLivePane) {
      logTmux.warn("tmux session has no live panes; clearing zombie shell", { session });
      await runTmuxAsync(["kill-session", "-t", session], { check: false });
      await tmuxViews.destroyAll();
      await destroyTmuxViewSessionsForBase(session);
      for (const agent of config.agents) {
        emitTmuxStatusIfChanged(agent.id, tmuxAgentPublicState(agent, { config }));
      }
      return;
    }

    const panesByAgentId = parseTmuxAgentPaneTable(panesResult.stdout);
    reconcileRuntimePanesFromTable(config, runtime, panesByAgentId);
    const sessionsResult = await runTmuxAsync(["list-sessions", "-F", "#{session_name}\t#{window_id}"], { check: false });
    const sessionWindows = parseTmuxSessionWindows(sessionsResult.stdout);

    for (const agent of config.agents.filter((item) => item.enabled !== false)) {
      const runtimeAgent = runtime.agents?.[agent.id];
      if (!runtimeAgent?.pane) {
        await destroyTmuxViewSessionForAgent(config, agent.id);
        emitTmuxStatusIfChanged(agent.id, tmuxAgentPublicState(agent, { config, runtime }));
        continue;
      }
      const paneState = panes.get(runtimeAgent.pane);
      if (!paneState) {
        await destroyTmuxViewSessionForAgent(config, agent.id);
        emitTmuxStatusIfChanged(agent.id, tmuxAgentPublicState(agent, { config, runtime, dead: null }));
        continue;
      }
      if (paneState.dead) {
        await destroyTmuxViewSessionForAgent(config, agent.id);
        emitTmuxStatusIfChanged(agent.id, tmuxAgentPublicState(agent, { config, runtime, dead: true }));
        continue;
      }

      const expected = tmuxViews.expectedWindow(agent.id);
      const actualViewWindow = expected?.viewSession ? sessionWindows.get(expected.viewSession) : null;
      if (tmuxViews.isAttached(agent.id) && expected?.windowId && actualViewWindow && actualViewWindow !== expected.windowId) {
        await tmuxViews.destroyView(agent.id);
      }

      if (!tmuxViews.isAttached(agent.id)) {
        try {
          await ensureTmuxViewForAgent(agent, config, runtime, panes);
        } catch (error) {
          logTmux.warn("failed to attach tmux view", { agentId: agent.id, error });
          emitTmuxStatusIfChanged(agent.id, {
            ...tmuxAgentPublicState(agent, { config, runtime, dead: false, capture: "" }),
            status: "error",
            reason: error.message,
            updatedAt: nowIso()
          });
          continue;
        }
      }

      emitTmuxStatusIfChanged(
        agent.id,
        tmuxAgentPublicState(agent, {
          config,
          runtime,
          dead: false,
          capture: tmuxViews.statusText(agent.id)
        })
      );
    }
  } catch (error) {
    logTmux.warn("tmux reconcile failed", { error });
  } finally {
    tmuxReconcileInFlight = false;
  }
}

function ensureTmuxReconcile() {
  if (tmuxReconcileTimer) {
    return;
  }
  tmuxReconcileTimer = setInterval(() => {
    void reconcileTmuxBackend();
  }, TMUX_RECONCILE_INTERVAL_MS);
  void reconcileTmuxBackend();
}

function stopTmuxReconcile() {
  if (tmuxReconcileTimer) {
    clearInterval(tmuxReconcileTimer);
    tmuxReconcileTimer = null;
  }
}

function tmuxListAgentStates() {
  const config = loadConfig();
  ensureTmuxReconcile();
  let runtime = readRuntime();
  if (tmuxHasSession(runtimeSession(config))) {
    const panesResult = runTmux(
      ["list-panes", "-s", "-t", runtimeSession(config), "-F", "#{pane_id}\t#{pane_dead}\t#{window_name}"],
      { check: false }
    );
    if (panesResult.status === 0) {
      runtime = reconcileRuntimePanesFromTable(config, normalizeRuntime(runtime, runtimeSession(config)), parseTmuxAgentPaneTable(panesResult.stdout));
    }
  }
  return config.agents.map((agent) => {
    const publicState = tmuxAgentPublicState(agent, {
      config,
      runtime,
      capture: tmuxViews.statusText(agent.id)
    });
    if (agent.enabled !== false) {
      emitTmuxStatusIfChanged(agent.id, publicState);
    }
    return publicState;
  });
}

async function tmuxStartAgent(agentId) {
  const config = loadConfig();
  const agent = config.agents.find((item) => item.id === agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
  if (agent.enabled === false) {
    throw new Error(`Agent is disabled: ${agentId}`);
  }
  if (!tmuxAvailable()) {
    const status = {
      id: agentId,
      status: "error",
      reason: "tmux is required for durable terminal sessions but was not found on PATH",
      pid: null,
      backend: "tmux",
      updatedAt: nowIso()
    };
    persistStatus(agentId, status);
    throw new Error(status.reason);
  }

  const session = runtimeSession(config);
  let runtime;
  if (!tmuxHasSession(session) || !tmuxSessionHasLivePane(session)) {
    // Either no session, or a zombie shell whose panes have all died. In both
    // cases discard whatever is left and build a fresh session so the agent
    // attaches to a live pane instead of hanging on a dead one.
    if (tmuxHasSession(session)) {
      runTmux(["kill-session", "-t", session], { check: false });
    }
    runtime = createTmuxSession(config, [agent]);
  } else {
    runtime = normalizeRuntime(readRuntime(), session);
    runtime = ensureTmuxAgentPane(config, agent, runtime);
  }

  ensureTmuxReconcile();
  let viewStatus = null;
  try {
    await ensureTmuxViewForAgent(agent, config, runtime);
  } catch (error) {
    viewStatus = {
      ...tmuxAgentPublicState(agent, { config, runtime, dead: false, capture: "" }),
      status: "error",
      reason: error.message,
      updatedAt: nowIso()
    };
    emitTmuxStatusIfChanged(agent.id, viewStatus, { force: true });
  }
  if (viewStatus) {
    return viewStatus;
  }
  const publicState = tmuxAgentPublicState(agent, {
    config,
    runtime,
    dead: false,
    capture: tmuxViews.statusText(agent.id)
  });
  emitTmuxStatusIfChanged(agent.id, publicState, { force: true });
  return publicState;
}

async function tmuxStopAgent(agentId) {
  const config = loadConfig();
  const agent = config.agents.find((item) => item.id === agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
  const runtime = readRuntime();
  const pane = runtime.agents?.[agentId]?.pane;
  await destroyTmuxViewSessionForAgent(config, agentId);
  if (pane) {
    // Reap the agent's process tree first, then drop the pane shell.
    await reapPaneProcessTree(pane);
    runTmux(["kill-pane", "-t", pane], { check: false });
  }
  // Confirm the pane is actually gone before we report stopped, so the UI never
  // shows "stopped" over a process that survived.
  const paneLingers = pane ? tmuxPaneDead(pane) === false : false;
  runtime.agents = runtime.agents || {};
  runtime.agents[agentId] = {
    ...(runtime.agents[agentId] || {}),
    pane: null,
    stopped: true,
    reason: paneLingers ? "stop requested; pane still alive" : "stopped by user",
    stopped_at: nowIso()
  };
  saveRuntime(runtime);
  const status = {
    ...tmuxAgentPublicState(agent, { config, runtime }),
    status: paneLingers ? "error" : "stopped",
    reason: paneLingers
      ? `Stop requested but tmux pane is still alive: ${pane}`
      : "stopped by user",
    updatedAt: nowIso()
  };
  persistStatus(agentId, status);
  tmuxLastStatusKey.set(agentId, tmuxStatusKey(status));
  emit("agent:status", status);
}

async function tmuxStopAllAgents() {
  const config = loadConfig();
  const session = runtimeSession(config);
  await tmuxViews.destroyAll();
  await destroyTmuxViewSessionsForBase(session);
  if (tmuxHasSession(session)) {
    // Reap every pane's process tree before tearing down the session, so CLI
    // helpers that escaped tmux's signal are reclaimed too.
    await reapBaseSessionProcessTrees(session);
    runTmux(["kill-session", "-t", session], { check: false });
  }
  stopTmuxReconcile();
  const runtime = readRuntime();
  runtime.agents = runtime.agents || {};
  for (const agent of config.agents) {
    runtime.agents[agent.id] = {
      ...(runtime.agents[agent.id] || {}),
      pane: null,
      stopped: true,
      reason: "stopped by user",
      stopped_at: nowIso()
    };
    const status = {
      ...tmuxAgentPublicState(agent, { config, runtime }),
      status: "stopped",
      reason: "stopped by user",
      updatedAt: nowIso()
    };
    persistStatus(agent.id, status);
    emit("agent:status", status);
  }
  saveRuntime(runtime);
}

async function tmuxPasteTextFallback(pane, text) {
  ensureDir(TMP_DIR);
  const tmp = path.join(TMP_DIR, `paste-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const bufferName = `aiteam-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text);
  try {
    await runTmuxAsync(["load-buffer", "-b", bufferName, tmp]);
    await runTmuxAsync(["paste-buffer", "-b", bufferName, "-t", pane, "-p"]);
  } finally {
    await runTmuxAsync(["delete-buffer", "-b", bufferName], { check: false });
    fs.rmSync(tmp, { force: true });
  }
}

function tmuxWriteInputFallback(agentId, data) {
  const pane = readRuntime().agents?.[agentId]?.pane;
  if (!pane || tmuxPaneDead(pane) !== false) {
    throw new Error(`Agent is not running: ${agentId}`);
  }
  const text = String(data || "");
  if (!text) {
    return;
  }
  const bufferName = `aiteam-input-${process.pid}-${Date.now()}`;
  try {
    runTmux(["load-buffer", "-b", bufferName, "-"], { input: text });
    runTmux(["paste-buffer", "-b", bufferName, "-t", pane, "-p"]);
  } finally {
    runTmux(["delete-buffer", "-b", bufferName], { check: false });
  }
}

function normalizeInjectionProbeText(value) {
  return String(value || "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\s+/g, "");
}

function injectionProbeNeedle(text) {
  const normalized = normalizeInjectionProbeText(text);
  if (normalized.length <= 160) {
    return normalized;
  }
  return normalized.slice(-160);
}

function tmuxWriteInput(agentId, data) {
  if (!tmuxViews.isAttached(agentId)) {
    tmuxWriteInputFallback(agentId, data);
    return;
  }
  try {
    tmuxViews.write(agentId, data);
  } catch (error) {
    if (!/Agent is not running/i.test(error.message || "")) {
      throw error;
    }
    tmuxWriteInputFallback(agentId, data);
  }
}

function tmuxResizeAgent(agentId, cols, rows) {
  tmuxViews.resize(agentId, cols, rows);
}

function tmuxScrollAgent(agentId, lines) {
  return tmuxViews.scroll(agentId, lines);
}

function tmuxAgentTerminalSnapshot(agentId) {
  const runtime = readRuntime();
  const runtimeAgent = runtime.agents?.[agentId];
  const viewSnapshot = tmuxViews.snapshot(agentId);
  if (runtimeAgent?.pane && tmuxPaneDead(runtimeAgent.pane) === false) {
    try {
      const data = tmuxCapturePane(runtimeAgent.pane, TERMINAL_SNAPSHOT_LINES);
      return {
        id: agentId,
        seq: viewSnapshot?.seq || 0,
        data,
        source: "tmux-capture",
        truncated: data.split("\n").length >= TERMINAL_SNAPSHOT_LINES,
        backend: "tmux"
      };
    } catch (_error) {
      // Fall back to the view/log replay paths below when tmux capture is unavailable.
    }
  }
  if (viewSnapshot) {
    return {
      id: agentId,
      ...viewSnapshot,
      source: "tmux-view",
      backend: "tmux"
    };
  }
  if (!runtimeAgent?.pane || tmuxPaneDead(runtimeAgent.pane) === null) {
    const data = tailFile(runtimeAgent?.raw_log, TERMINAL_REPLAY_BUFFER_CHARS);
    return {
      id: agentId,
      seq: 0,
      data,
      source: runtimeAgent?.raw_log ? "raw-log" : "empty",
      truncated: Boolean(runtimeAgent?.raw_log && fileSize(runtimeAgent.raw_log) > Buffer.byteLength(data)),
      backend: "tmux"
    };
  }

  const data = tailFile(runtimeAgent.raw_log, TERMINAL_REPLAY_BUFFER_CHARS);
  const truncated = Boolean(runtimeAgent.raw_log && fileSize(runtimeAgent.raw_log) > Buffer.byteLength(data));
  return {
    id: agentId,
    seq: 0,
    data,
    source: runtimeAgent.raw_log ? "raw-log" : "empty",
    truncated,
    backend: "tmux"
  };
}

function directPublicState(agentId) {
  const agent = loadConfig().agents.find((item) => item.id === agentId);
  return agent ? directAgentPublicState(agent) : null;
}

function directPreflightRoute(targets) {
  const notRunning = targets.filter((target) => !agents.get(target)?.ptyProcess);
  if (notRunning.length) {
    throw new Error(
      `Cannot send broadcast. Not running: ${notRunning.join(", ")}. Start the agent or disable it.`
    );
  }
}

function tmuxPublicState(agentId) {
  const config = loadConfig();
  const agent = config.agents.find((item) => item.id === agentId);
  if (!agent) {
    return null;
  }
  const runtime = readRuntime();
  const runtimeAgent = runtime.agents?.[agentId] || {};
  return {
    id: agent.id,
    name: agent.name || agent.id,
    command: shellCommand(agent),
    cwd: agentCwd(agent),
    enabled: agent.enabled !== false,
    status: "running_or_idle",
    reason: "route preflight passed",
    pid: null,
    backend: "tmux",
    pane: runtimeAgent.pane || null,
    startedAt: runtimeAgent.started_at || null,
    markdownLog: runtimeAgent.markdown_log || null,
    rawLog: runtimeAgent.raw_log || null
  };
}

async function tmuxPreflightRoute(targets) {
  const config = loadConfig();
  let runtime = readRuntime();
  const session = runtimeSession(config);
  const hasSession = await runTmuxAsync(["has-session", "-t", session], { check: false });
  if (hasSession.status !== 0) {
    throw new Error(`Cannot send broadcast. tmux session is not running: ${session}. Start the agents first.`);
  }

  const paneList = await runTmuxAsync(
    ["list-panes", "-s", "-t", session, "-F", "#{pane_id}\t#{pane_dead}\t#{window_name}"],
    { check: false }
  );
  runtime = reconcileRuntimePanesFromTable(config, normalizeRuntime(runtime, session), parseTmuxAgentPaneTable(paneList.stdout));
  const paneStates = new Map();
  for (const line of paneList.stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [pane, dead] = line.split("\t");
    paneStates.set(pane, dead);
  }

  const failures = [];
  for (const target of targets) {
    const pane = runtime.agents?.[target]?.pane;
    if (!pane) {
      failures.push(`${target}: no runtime pane recorded`);
      continue;
    }
    const dead = paneStates.get(pane);
    if (dead === undefined) {
      failures.push(`${target}: recorded pane is missing`);
    } else if (dead === "1") {
      failures.push(`${target}: pane process has exited`);
    }
  }
  if (failures.length) {
    throw new Error(
      `Cannot send broadcast. Not running: ${failures.join("; ")}. Start the agent or disable it.`
    );
  }
  return runtime;
}

async function verifyTmuxInjection(agentId, pane, message) {
  const needle = injectionProbeNeedle(message);
  if (!needle) {
    emit("route:verify", { id: agentId, verified: true });
    return;
  }
  setTimeout(async () => {
    let verified = false;
    try {
      const result = await runTmuxAsync(["capture-pane", "-p", "-e", "-J", "-S", "-80", "-t", pane], { check: false });
      verified = result.status === 0 && normalizeInjectionProbeText(result.stdout).includes(needle);
    } catch (error) {
      logRoute.warn("tmux route verify failed", { agentId, pane, error });
    }
    if (!verified) {
      logRoute.warn("tmux route verify did not find injected text", { agentId, pane });
    }
    emit("route:verify", { id: agentId, verified });
  }, 500);
}

async function tmuxPasteAndSubmitAgent(agentId, message) {
  const config = loadConfig();
  const runtime = await recoverTmuxRuntimePanes(config, normalizeRuntime(readRuntime(), runtimeSession(config)));
  const pane = runtime.agents?.[agentId]?.pane;
  if (!pane) {
    throw new Error(`Agent is not running: ${agentId}`);
  }
  const dead = await runTmuxAsync(["display-message", "-p", "-t", pane, "#{pane_dead}"], { check: false });
  if (dead.status !== 0 || dead.stdout.trim() !== "0") {
    throw new Error(`Agent is not running: ${agentId}`);
  }
  const submitDelayMs = Number(config.routing?.submit_delay_ms || 0);
  if (tmuxViews.isAttached(agentId)) {
    await tmuxViews.pasteAndSubmit(agentId, message, { submitDelayMs });
  } else {
    await tmuxPasteTextFallback(pane, message);
    if (submitDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, submitDelayMs));
    }
    await runTmuxAsync(["send-keys", "-t", pane, "C-m"]);
  }
  if (config.routing?.verify_injection !== false) {
    await verifyTmuxInjection(agentId, pane, message);
  }
  return { submitted: true };
}

const directPtyBackend = {
  name: "direct-pty",
  listAgents: directListAgentStates,
  startAgent: directStartAgent,
  stopAgent: directStopAgent,
  stopAll: directStopAllAgents,
  writeInput: directWriteToAgent,
  resizeAgent: directResizeAgent,
  scrollAgent: () => false,
  snapshot: directAgentTerminalSnapshot,
  preflightRoute: directPreflightRoute,
  pasteAndSubmit: directPasteAndSubmitToAgent,
  publicState: directPublicState
};

const tmuxBackend = {
  name: "tmux",
  listAgents: tmuxListAgentStates,
  startAgent: tmuxStartAgent,
  stopAgent: tmuxStopAgent,
  stopAll: tmuxStopAllAgents,
  writeInput: tmuxWriteInput,
  resizeAgent: tmuxResizeAgent,
  scrollAgent: tmuxScrollAgent,
  snapshot: tmuxAgentTerminalSnapshot,
  preflightRoute: tmuxPreflightRoute,
  pasteAndSubmit: tmuxPasteAndSubmitAgent,
  publicState: tmuxPublicState
};

function isDemoWorkspace() {
  try {
    const config = loadConfig();
    return config.agents?.length > 0 && config.agents.every((agent) => agent.permission_mode === "demo-echo");
  } catch (_error) {
    return false;
  }
}

function selectedBackendName() {
  const configured = String(process.env.AITEAMS_TERMINAL_BACKEND || "").trim();
  if (configured === "tmux" || configured === "direct-pty") {
    return configured;
  }
  if (isDemoWorkspace()) {
    return tmuxAvailable() ? "tmux" : "direct-pty";
  }
  return "tmux";
}

function getTerminalBackend() {
  return selectedBackendName() === "tmux" ? tmuxBackend : directPtyBackend;
}

function listAgentStates() {
  return getTerminalBackend().listAgents();
}

function agentTerminalSnapshot(agentId) {
  return getTerminalBackend().snapshot(agentId);
}

function startAgent(agentId) {
  return getTerminalBackend().startAgent(agentId);
}

function stopAgent(agentId) {
  return getTerminalBackend().stopAgent(agentId);
}

function stopAllAgents() {
  return getTerminalBackend().stopAll();
}

function writeToAgent(agentId, data) {
  return getTerminalBackend().writeInput(agentId, data);
}

function resizeAgent(agentId, cols, rows) {
  return getTerminalBackend().resizeAgent(agentId, cols, rows);
}

function scrollAgent(agentId, lines) {
  return getTerminalBackend().scrollAgent?.(agentId, lines) || false;
}

async function releaseCurrentWorkspaceBackend() {
  if (selectedBackendName() === "direct-pty") {
    directStopAllAgents();
  } else {
    let session = null;
    try {
      session = runtimeSession(loadConfig());
    } catch (_error) {
      session = null;
    }
    stopTmuxReconcile();
    await tmuxViews.reset();
    if (session) {
      await destroyTmuxViewSessionsForBase(session);
      // Reap agent process trees and tear down the base session so no CLI (and
      // none of its escaped MCP/helper children) outlives the workspace. This
      // runs on both workspace switch and app quit.
      await reapBaseSessionProcessTrees(session);
      if (tmuxHasSession(session)) {
        runTmux(["kill-session", "-t", session], { check: false });
      }
    }
  }
}

function routeTargets(message, explicitTargets = []) {
  const config = loadConfig();
  const enabledList = config.agents.filter((agent) => agent.enabled !== false);
  const enabledSet = new Set(enabledList.map((agent) => agent.id));
  let targets = explicitTargets;
  let routedMessage = message;
  if (!targets.length) {
    mentionPattern.lastIndex = 0;
    const mentions = [...message.matchAll(mentionPattern)].map((match) => match[1]);
    const hasAll = mentions.some((mention) => mention.toLowerCase() === "all");
    if (hasAll) {
      targets = enabledList.map((agent) => agent.id);
    } else if (mentions.length) {
      const seen = new Set();
      targets = mentions.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    } else {
      targets = [config.routing?.default_agent || enabledList[0]?.id].filter(Boolean);
    }
    if (mentions.length) {
      routedMessage = message.replace(mentionPattern, "").trim();
    }
  }

  const unknown = targets.filter((target) => !enabledSet.has(target));
  if (unknown.length) {
    throw new Error(`Unknown or disabled agent target(s): ${unknown.join(", ")}`);
  }
  return { targets, routedMessage };
}

function taskHandoff(taskPath) {
  const config = loadConfig();
  const template = config.handoff_template || "请先阅读任务文档：{task_doc}";
  const resolved = path.isAbsolute(taskPath) ? taskPath : path.resolve(WORKSPACE_ROOT, taskPath);
  return template.replace("{task_doc}", resolved);
}

async function routeMessage(message, explicitTargets = [], options = {}) {
  const { targets, routedMessage } = routeTargets(message, explicitTargets);
  const finalMessage = options.taskPath
    ? `${taskHandoff(options.taskPath)} 用户补充：${routedMessage}`
    : routedMessage;
  const backend = getTerminalBackend();

  await backend.preflightRoute(targets);

  const settled = await Promise.allSettled(targets.map(async (target) => {
    try {
      await backend.pasteAndSubmit(target, finalMessage);
      const publicState = backend.publicState(target);
      if (publicState?.markdownLog) {
        appendMarkdown(publicState.markdownLog, "User Message", finalMessage);
      }
      return { id: target, status: "sent" };
    } catch (error) {
      return { id: target, status: "failed", reason: error.message };
    }
  }));
  const results = settled.map((result, index) => (
    result.status === "fulfilled"
      ? result.value
      : { id: targets[index], status: "failed", reason: result.reason?.message || String(result.reason) }
  ));

  appendTimeline(targets, finalMessage);

  const failed = results.filter((result) => result.status === "failed");
  if (failed.length) {
    const sentIds = results.filter((result) => result.status === "sent").map((result) => `@${result.id}`).join(" ");
    const failDetail = failed.map((result) => `@${result.id}: ${result.reason}`).join("; ");
    throw new Error(
      `Sent to ${sentIds || "none"}; failed for ${failDetail}`
    );
  }

  return { targets, message: finalMessage, results };
}

function listTasks() {
  ensureDir(TASKS_DIR);
  return fs.readdirSync(TASKS_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const file = path.join(TASKS_DIR, name);
      const stat = fs.statSync(file);
      return {
        name,
        path: file,
        updatedAt: stat.mtime.toISOString()
      };
    });
}

function listDocumentFolders() {
  ensureDir(DOCS_DIR);
  const folders = [{ key: "", name: "docs", path: DOCS_DIR }];
  const stack = [DOCS_DIR];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || isExcludedDocumentDir(entry.name)) {
        continue;
      }
      const folderPath = path.join(current, entry.name);
      const relative = unixPath(path.relative(DOCS_DIR, folderPath));
      folders.push({
        key: relative,
        name: relative,
        path: folderPath
      });
      stack.push(folderPath);
    }
  }
  return folders.sort((a, b) => {
    if (a.key === "") return -1;
    if (b.key === "") return 1;
    return a.name.localeCompare(b.name);
  });
}

function listDocuments(folder = "") {
  const selectedFolder = resolveDocumentFolder(folder);
  ensureDir(DOCS_DIR);
  if (!fs.existsSync(selectedFolder.path)) {
    return listDocuments("");
  }
  const pins = readDocumentPins();
  const allDocuments = [];
  const tree = buildDocumentTreeNode(DOCS_DIR, pins, allDocuments);
  const documents = allDocuments.filter((document) => {
    if (!selectedFolder.key) return true;
    return document.folder === selectedFolder.key || document.folder.startsWith(`${selectedFolder.key}/`);
  });
  documents.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const timeDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.name.localeCompare(b.name);
  });

  return {
    root: DOCS_DIR,
    folder: selectedFolder.key,
    folders: listDocumentFolders(),
    tree,
    documents
  };
}

function toggleDocumentPinned(relativePath) {
  const normalized = unixPath(String(relativePath || "")).replace(/^\/+/, "");
  const resolved = path.resolve(WORKSPACE_ROOT, normalized);
  const docsRelative = path.relative(DOCS_DIR, resolved);
  if (
    !normalized ||
    docsRelative.startsWith("..") ||
    path.isAbsolute(docsRelative) ||
    !fs.existsSync(resolved) ||
    !fs.statSync(resolved).isFile() ||
    !isDocumentFile(resolved)
  ) {
    throw new Error(`Invalid document path: ${relativePath}`);
  }
  const pins = readDocumentPins();
  if (pins.has(normalized)) {
    pins.delete(normalized);
  } else {
    pins.add(normalized);
  }
  writeDocumentPins(pins);
  return {
    relativePath: normalized,
    pinned: pins.has(normalized)
  };
}

function git(args) {
  return execFileSync("git", ["-C", WORKSPACE_ROOT, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

function getGitStatus() {
  try {
    const inside = git(["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") {
      return { isRepo: false, branch: null, dirtyCount: 0, worktreeCount: 0, entries: [] };
    }
    const branch = git(["branch", "--show-current"]) || "(detached)";
    const porcelain = git(["status", "--short"]);
    const entries = porcelain ? porcelain.split("\n") : [];
    let worktreeCount = 1;
    try {
      const worktrees = git(["worktree", "list", "--porcelain"]);
      worktreeCount = worktrees.split("\n").filter((line) => line.startsWith("worktree ")).length || 1;
    } catch (_error) {
      worktreeCount = 1;
    }
    return {
      isRepo: true,
      branch,
      dirtyCount: entries.length,
      worktreeCount,
      entries: entries.slice(0, 20)
    };
  } catch (_error) {
    return { isRepo: false, branch: null, dirtyCount: 0, worktreeCount: 0, entries: [] };
  }
}

async function switchWorkspace(targetRoot) {
  const nextRoot = prepareWorkspaceRoot(targetRoot);
  if (nextRoot === WORKSPACE_ROOT) {
    rememberWorkspace(nextRoot);
    return workspaceInfo();
  }
  stopDocumentsWatcher();
  await releaseCurrentWorkspaceBackend();
  setWorkspaceRoot(nextRoot);
  ensureWorkspaceDirs();
  startDocumentsWatcher();
  rememberWorkspace(nextRoot);
  const info = workspaceInfo();
  emit("workspace:changed", info);
  return info;
}

async function chooseWorkspace() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Main window is not available.");
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select AI Teams Project",
    defaultPath: WORKSPACE_ROOT,
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return switchWorkspace(result.filePaths[0]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    title: "AI Teams",
    icon: APP_ICON_PATH,
    backgroundColor: "#101214",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  const distIndexPath = path.join(APP_ROOT, "dist", "index.html");
  const shouldLoadBuiltAssets = app.isPackaged || process.env.NODE_ENV === "production" || (
    process.execPath.includes(".app/Contents/MacOS/") && fs.existsSync(distIndexPath)
  );
  if (shouldLoadBuiltAssets) {
    mainWindow.loadFile(distIndexPath);
  } else {
    mainWindow.loadURL(devUrl);
  }
}

app.whenReady().then(() => {
  initLogger(app);
  const preparedRoot = prepareWorkspaceRoot(WORKSPACE_ROOT);
  if (preparedRoot !== WORKSPACE_ROOT) {
    setWorkspaceRoot(preparedRoot);
  }
  ensureWorkspaceDirs();
  startDocumentsWatcher();
  rememberWorkspace(WORKSPACE_ROOT);
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let backendReleaseBeforeQuit = false;
app.on("before-quit", (event) => {
  if (backendReleaseBeforeQuit) {
    return;
  }
  event.preventDefault();
  backendReleaseBeforeQuit = true;
  stopDocumentsWatcher();
  releaseCurrentWorkspaceBackend()
    .catch((error) => log.warn("backend release before quit failed", { error }))
    .finally(() => app.quit());
});

ipcMain.handle("workspace:get", () => workspaceInfo());
ipcMain.handle("workspace:switch", (_event, targetRoot) => switchWorkspace(targetRoot));
ipcMain.handle("workspace:choose", () => chooseWorkspace());

ipcMain.handle("agents:list", () => listAgentStates());
ipcMain.handle("agents:presets", () => builtinAgentPresets());
ipcMain.handle("agents:detect", () => detectAllAgentTypes());
ipcMain.handle("agents:import", (_event, payload, options = {}) => importAgents(payload, options));
ipcMain.handle("agents:remove", (_event, agentId) => removeAgent(agentId));
ipcMain.handle("agents:snapshot", (_event, agentId) => agentTerminalSnapshot(agentId));
ipcMain.handle("agents:start", (_event, agentId) => startAgent(agentId));
ipcMain.handle("agents:stop", (_event, agentId) => stopAgent(agentId));
ipcMain.handle("agents:stopAll", () => stopAllAgents());
ipcMain.handle("agents:input", (_event, agentId, data) => writeToAgent(agentId, data));
ipcMain.handle("agents:resize", (_event, agentId, cols, rows) => resizeAgent(agentId, cols, rows));
ipcMain.handle("agents:scroll", (_event, agentId, lines) => scrollAgent(agentId, lines));
ipcMain.handle("route:send", (_event, message, explicitTargets = [], options = {}) => routeMessage(message, explicitTargets, options));
ipcMain.handle("tasks:list", () => listTasks());
ipcMain.handle("documents:list", (_event, folder = "") => listDocuments(folder));
ipcMain.handle("documents:togglePinned", (_event, relativePath) => toggleDocumentPinned(relativePath));
ipcMain.handle("git:status", () => getGitStatus());
ipcMain.handle("shell:openPath", (_event, targetPath) => shell.openPath(targetPath));
ipcMain.handle("shell:openExternal", (_event, url) => {
  const value = String(url || "");
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  shell.openExternal(value);
  return true;
});
