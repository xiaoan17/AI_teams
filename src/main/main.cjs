const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const pty = require("node-pty");

const APP_ROOT = path.resolve(__dirname, "..", "..");
app.setName("AI Teams");
const DEFAULT_WORKSPACE_ROOT = path.resolve(process.env.AITEAMS_WORKSPACE_ROOT || APP_ROOT);
const MAX_RECENT_WORKSPACES = 10;
const STATUS_BUFFER_CHARS = 12000;
const TERMINAL_REPLAY_BUFFER_CHARS = 750000;
let WORKSPACE_ROOT = DEFAULT_WORKSPACE_ROOT;
let AITEAM_DIR = "";
let CONFIG_PATH = "";
let SESSIONS_DIR = "";
let STATUS_DIR = "";
let TASKS_DIR = "";
let DOCS_DIR = "";
let DOCUMENT_PINS_PATH = "";

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

function setWorkspaceRoot(root) {
  WORKSPACE_ROOT = path.resolve(root);
  AITEAM_DIR = path.join(WORKSPACE_ROOT, ".aiteam");
  CONFIG_PATH = path.join(AITEAM_DIR, "agents.json");
  SESSIONS_DIR = path.join(AITEAM_DIR, "sessions");
  STATUS_DIR = path.join(AITEAM_DIR, "status");
  TASKS_DIR = path.join(AITEAM_DIR, "tasks");
  DOCS_DIR = path.join(WORKSPACE_ROOT, "docs");
  DOCUMENT_PINS_PATH = path.join(AITEAM_DIR, "document-pins.json");
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

function defaultWorkspaceConfig(root) {
  return {
    workspace: {
      name: workspaceName(root),
      root,
      tmux_session: workspaceSessionName(root),
      created_at: nowIso()
    },
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
        args: [],
        cwd: root,
        enabled: false,
        permission_mode: "configure-before-start"
      },
      {
        id: "claude",
        name: "Claude Code",
        command: "claude",
        args: [],
        cwd: root,
        enabled: false,
        permission_mode: "configure-before-start"
      },
      {
        id: "kimi",
        name: "Kimi",
        command: "kimi",
        args: [],
        cwd: root,
        enabled: false,
        permission_mode: "configure-before-start"
      }
    ]
  };
}

function ensureWorkspaceConfig(root) {
  const configPath = workspaceConfigPath(root);
  if (fs.existsSync(configPath)) {
    readJson(configPath);
    return;
  }
  ensureDir(path.join(root, ".aiteam"));
  writeJson(configPath, defaultWorkspaceConfig(root));
}

function prepareWorkspaceRoot(root) {
  const normalized = normalizeWorkspaceRoot(root);
  ensureDir(normalized);
  ensureWorkspaceConfig(normalized);
  return normalized;
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
      if (!root || seen.has(root) || !fs.existsSync(workspaceConfigPath(root))) {
        return false;
      }
      seen.add(root);
      return true;
    })
    .slice(0, MAX_RECENT_WORKSPACES)
    .map((root) => ({
      root,
      name: workspaceName(root),
      configPath: workspaceConfigPath(root)
    }));
}

function writeRecentWorkspaces(roots) {
  const seen = new Set();
  const normalized = roots
    .map((root) => normalizeWorkspaceRoot(root))
    .filter((root) => {
      if (seen.has(root)) return false;
      seen.add(root);
      return fs.existsSync(workspaceConfigPath(root));
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
  ensureDir(DOCS_DIR);
}

function workspaceInfo() {
  return {
    root: WORKSPACE_ROOT,
    name: workspaceName(WORKSPACE_ROOT),
    configPath: CONFIG_PATH,
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

function isDocumentFile(name) {
  return /\.(md|markdown|mdx|txt)$/i.test(name);
}

function isExcludedDocumentDir(name) {
  return name.startsWith(".") || DOCUMENT_EXCLUDED_DIRS.has(name);
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
    pinned: pins.has(relativePath)
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
  const cfg = readJson(CONFIG_PATH);
  if (!cfg) {
    throw new Error(`Missing config: ${CONFIG_PATH}. Run python3 aiteam.py init first.`);
  }
  return cfg;
}

function shellCommand(agent) {
  const args = Array.isArray(agent.args) ? agent.args : [];
  return [agent.command, ...args].filter(Boolean).join(" ");
}

function enabledAgents() {
  return loadConfig().agents.filter((agent) => agent.enabled !== false);
}

function statusFor(agentId, patch = {}) {
  const current = agents.get(agentId);
  return statusForState(agentId, current, patch);
}

function statusForState(agentId, state, patch = {}) {
  return {
    id: agentId,
    status: state?.status || "stopped",
    reason: state?.reason || "",
    pid: state?.ptyProcess?.pid || null,
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
      `- CWD: \`${agent.cwd || WORKSPACE_ROOT}\``,
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

function agentPublicState(agent) {
  const running = agents.get(agent.id);
  return {
    id: agent.id,
    name: agent.name || agent.id,
    command: shellCommand(agent),
    cwd: agent.cwd || WORKSPACE_ROOT,
    enabled: agent.enabled !== false,
    status: running?.status || "stopped",
    reason: running?.reason || "",
    pid: running?.ptyProcess?.pid || null,
    startedAt: running?.startedAt || null,
    markdownLog: running?.markdownLog || null,
    rawLog: running?.rawLog || null
  };
}

function agentTerminalSnapshot(agentId) {
  const state = agents.get(agentId);
  if (!state) {
    return {
      id: agentId,
      seq: 0,
      data: "",
      truncated: false
    };
  }
  return {
    id: agentId,
    seq: state.outputSeq || 0,
    data: state.replayBuffer || "",
    truncated: Boolean(state.replayTruncated)
  };
}

function listAgentStates() {
  return loadConfig().agents.map(agentPublicState);
}

function startAgent(agentId) {
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
    return agentPublicState(agent);
  }

  ensureDir(SESSIONS_DIR);
  ensureDir(STATUS_DIR);
  const sessionFiles = createSessionFiles(agent);
  const args = Array.isArray(agent.args) ? agent.args : [];
  let ptyProcess;
  try {
    ptyProcess = pty.spawn(agent.command, args, {
      name: "xterm-256color",
      cols: 96,
      rows: 28,
      cwd: agent.cwd || WORKSPACE_ROOT,
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
      emit("agent:data", { id: agentId, data, seq: state.outputSeq });
      emit("agent:status", agentPublicState(agent));
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    state.status = "exited";
    state.reason = `exitCode=${exitCode} signal=${signal || ""}`.trim();
    state.ptyProcess = null;
    persistStatusForState(agentId, state);
    if (agents.get(agentId) === state) {
      emit("agent:status", agentPublicState(agent));
    }
  });

  emit("agent:status", agentPublicState(agent));
  return agentPublicState(agent);
}

function stopAgent(agentId) {
  const state = agents.get(agentId);
  if (!state?.ptyProcess) {
    return;
  }
  state.ptyProcess.kill();
  state.ptyProcess = null;
  state.status = "stopped";
  state.reason = "stopped by user";
  persistStatusForState(agentId, state);
  emit("agent:status", agentPublicState(state.agent));
}

function stopAllAgents() {
  for (const agentId of [...agents.keys()]) {
    stopAgent(agentId);
  }
  agents.clear();
}

function writeToAgent(agentId, data) {
  const state = agents.get(agentId);
  if (!state?.ptyProcess) {
    throw new Error(`Agent is not running: ${agentId}`);
  }
  state.ptyProcess.write(data);
}

function pasteAndSubmitToAgent(agentId, message) {
  // Bracketed paste gives full-screen CLIs one atomic payload before Enter submits it.
  writeToAgent(agentId, `\x1b[200~${message}\x1b[201~\r`);
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

function routeMessage(message, explicitTargets = [], options = {}) {
  const { targets, routedMessage } = routeTargets(message, explicitTargets);
  const finalMessage = options.taskPath
    ? `${taskHandoff(options.taskPath)} 用户补充：${routedMessage}`
    : routedMessage;

  // Preflight: ensure every target has a running PTY before writing to any
  const notRunning = targets.filter((target) => !agents.get(target)?.ptyProcess);
  if (notRunning.length) {
    throw new Error(
      `Cannot send broadcast. Not running: ${notRunning.join(", ")}. Start the agent or disable it.`
    );
  }

  const results = [];
  for (const target of targets) {
    try {
      pasteAndSubmitToAgent(target, finalMessage);
      const state = agents.get(target);
      if (state?.markdownLog) {
        appendMarkdown(state.markdownLog, "User Message", finalMessage);
      }
      results.push({ id: target, status: "sent" });
    } catch (error) {
      results.push({ id: target, status: "failed", reason: error.message });
    }
  }

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

function switchWorkspace(targetRoot) {
  const nextRoot = prepareWorkspaceRoot(targetRoot);
  if (nextRoot === WORKSPACE_ROOT) {
    rememberWorkspace(nextRoot);
    return workspaceInfo();
  }
  stopAllAgents();
  setWorkspaceRoot(nextRoot);
  ensureWorkspaceDirs();
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
    backgroundColor: "#101214",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  if (process.env.NODE_ENV === "production") {
    mainWindow.loadFile(path.join(APP_ROOT, "dist", "index.html"));
  } else {
    mainWindow.loadURL(devUrl);
  }
}

app.whenReady().then(() => {
  const preparedRoot = prepareWorkspaceRoot(WORKSPACE_ROOT);
  if (preparedRoot !== WORKSPACE_ROOT) {
    setWorkspaceRoot(preparedRoot);
  }
  ensureWorkspaceDirs();
  rememberWorkspace(WORKSPACE_ROOT);
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopAllAgents();
});

ipcMain.handle("workspace:get", () => workspaceInfo());
ipcMain.handle("workspace:switch", (_event, targetRoot) => switchWorkspace(targetRoot));
ipcMain.handle("workspace:choose", () => chooseWorkspace());

ipcMain.handle("agents:list", () => listAgentStates());
ipcMain.handle("agents:snapshot", (_event, agentId) => agentTerminalSnapshot(agentId));
ipcMain.handle("agents:start", (_event, agentId) => startAgent(agentId));
ipcMain.handle("agents:stop", (_event, agentId) => stopAgent(agentId));
ipcMain.handle("agents:input", (_event, agentId, data) => writeToAgent(agentId, data));
ipcMain.handle("agents:resize", (_event, agentId, cols, rows) => {
  const state = agents.get(agentId);
  if (state?.ptyProcess && Number.isFinite(cols) && Number.isFinite(rows)) {
    state.ptyProcess.resize(Math.max(20, cols), Math.max(5, rows));
  }
});
ipcMain.handle("route:send", (_event, message, explicitTargets = [], options = {}) => routeMessage(message, explicitTargets, options));
ipcMain.handle("tasks:list", () => listTasks());
ipcMain.handle("documents:list", (_event, folder = "") => listDocuments(folder));
ipcMain.handle("documents:togglePinned", (_event, relativePath) => toggleDocumentPinned(relativePath));
ipcMain.handle("git:status", () => getGitStatus());
ipcMain.handle("shell:openPath", (_event, targetPath) => shell.openPath(targetPath));
