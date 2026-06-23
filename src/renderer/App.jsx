import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  TERMINAL_SCROLLBACK_LINES,
  appendBoundedTerminalWrite,
  createTerminalInputBatcher,
  filterTerminalInput,
  filterTerminalOutput,
  handleTerminalWheel,
  trimPendingOutputQueue
} from "./terminal-wheel.mjs";
import "./styles.css";
import { DEFAULT_THEME_ID, themePresets, themeToCssVars } from "./themes.js";
import { Dashboard } from "./Dashboard.jsx";
import { installRendererLogging } from "./renderer-log.mjs";
import { LocaleProvider, useT, useLocale } from "./i18n.js";
import { toastTtl, toastGlyph } from "./toast-util.js";

const aiTeamsAppIcon = `${import.meta.env.BASE_URL}app-icon.png`;

const browserPreviewApi = {
  getWorkspace: async () => ({
    root: "/tmp/ai-teams-preview",
    name: "ai-teams-preview",
    configPath: "/tmp/ai-teams-preview/.aiteam/agents.json",
    tasksPath: "/tmp/ai-teams-preview/.aiteam/tasks",
    docsPath: "/tmp/ai-teams-preview/docs",
    recentWorkspaces: [
      {
        root: "/tmp/ai-teams-preview",
        name: "ai-teams-preview",
        configPath: "/tmp/ai-teams-preview/.aiteam/agents.json"
      },
      {
        root: "/tmp/ai-teams-preview-demo",
        name: ".aiteam-demo",
        configPath: "/tmp/ai-teams-preview-demo/.aiteam/agents.json"
      }
    ]
  }),
  switchWorkspace: async (targetRoot) => ({
    root: targetRoot,
    name: targetRoot.split("/").pop(),
    configPath: `${targetRoot}/.aiteam/agents.json`,
    tasksPath: `${targetRoot}/.aiteam/tasks`,
    docsPath: `${targetRoot}/docs`,
    recentWorkspaces: []
  }),
  chooseWorkspace: async () => null,
  listAgents: async () => [
    {
      id: "codex",
      name: "Codex Demo",
      command: "/bin/cat",
      cwd: "/tmp/ai-teams-preview",
      enabled: true,
      backend: "direct-pty",
      status: "running_or_idle"
    },
    {
      id: "kimi",
      name: "Kimi Demo",
      command: "/bin/cat",
      cwd: "/tmp/ai-teams-preview",
      enabled: true,
      backend: "direct-pty",
      status: "waiting_input"
    }
  ],
  listDocuments: async (folder = "") => ({
    root: "/tmp/ai-teams-preview/docs",
    folder,
    folders: [
      { key: "", name: "docs", path: "/tmp/ai-teams-preview/docs" },
      { key: "features", name: "features", path: "/tmp/ai-teams-preview/docs/features" }
    ],
    tree: {
      type: "folder",
      name: "docs",
      key: "",
      path: "/tmp/ai-teams-preview/docs",
      relativePath: "docs",
      documentCount: 1,
      children: [
        {
          type: "folder",
          name: "features",
          key: "features",
          path: "/tmp/ai-teams-preview/docs/features",
          relativePath: "docs/features",
          documentCount: 1,
          children: [
            {
              type: "document",
              name: "20260611-broadcast-routing-and-claude-code.md",
              path: "/tmp/ai-teams-preview/docs/features/20260611-broadcast-routing-and-claude-code.md",
              relativePath: "docs/features/20260611-broadcast-routing-and-claude-code.md",
              folder: "features",
              updatedAt: new Date().toISOString(),
              pinned: true,
              fields: {
                status: "Implemented",
                tags: [],
                state: "finish"
              }
            }
          ]
        }
      ]
    },
    documents: [
      {
        type: "document",
        name: "20260611-broadcast-routing-and-claude-code.md",
        path: "/tmp/ai-teams-preview/docs/features/20260611-broadcast-routing-and-claude-code.md",
        relativePath: "docs/features/20260611-broadcast-routing-and-claude-code.md",
        folder: "features",
        updatedAt: new Date().toISOString(),
        pinned: true,
        fields: {
          status: "Implemented",
          tags: [],
          state: "finish"
        }
      }
    ]
  }),
  toggleDocumentPinned: async (relativePath) => ({ relativePath, pinned: true }),
  getAgentSnapshot: async () => ({ seq: 0, data: "", truncated: false }),
  startAgent: async (agentId) => ({ id: agentId, status: "running_or_idle" }),
  stopAgent: async (agentId) => ({ id: agentId, status: "stopped" }),
  stopAllAgents: async () => {},
  sendInput: async () => {},
  resizeAgent: async () => {},
  scrollAgent: async () => false,
  listRoles: async () => [
    { id: "designer", title: "产品设计师 / 视觉与交互", emoji: "🎨", summary: "把需求转成界面设计、交互流程与示意图", source: "global", hired: true },
    { id: "manager", title: "总经理 / 项目负责人", emoji: "🧭", summary: "拆计划、控风险、推进交付", source: "global", hired: false },
    { id: "prd", title: "PRD / 产品需求文档", emoji: "📋", summary: "沉淀需求背景、流程和验收标准", source: "global", hired: false }
  ],
  hireRole: async (roleId) => ({ ok: true, persona_dir: `.aiteam/crew/${roleId}` }),
  importRole: async (sourcePath, options = {}) => ({
    ok: true,
    id: String(sourcePath || "").split("/").filter(Boolean).pop() || "imported",
    dest: options.dest || "workspace",
    warnings: ["Browser preview: imports are not persisted."]
  }),
  pickDirectory: async () => null,
  loadRoleDetail: async (roleId) => ({
    id: roleId,
    source: `/preview/.aiteam/roles/${roleId}`,
    library: "/preview/.aiteam/roles",
    origin: "workspace",
    editable: true,
    defaultRuntime: "claude",
    autonomy: "auto",
    runtimes: {
      claude: { command: "claude", args: ["--dangerously-skip-permissions"], instructions_file: "CLAUDE.md", skills_dir: ".claude/skills", model: "opus" },
      codex: { command: "codex", args: ["--dangerously-bypass-approvals-and-sandbox"], instructions_file: "AGENTS.md", skills_dir: ".codex/skills", model: "" },
      kimi: { command: "kimi", args: ["-y"], instructions_file: "CLAUDE.md", skills_dir: ".claude/skills", model: "" }
    },
    template: {
      id: roleId,
      name: roleId,
      role: { title: roleId, emoji: "🧩", summary: "Preview role", track: "impl" },
      default_runtime: "claude",
      autonomy: "auto",
      skills: ["frontend-ui"],
      persona_file: "CLAUDE.md",
      version: "0.0.0",
      runtimes: {
        claude: { command: "claude", args: ["--dangerously-skip-permissions"], instructions_file: "CLAUDE.md", skills_dir: ".claude/skills", model: "opus" },
        codex: { command: "codex", args: ["--dangerously-bypass-approvals-and-sandbox"], instructions_file: "AGENTS.md", skills_dir: ".codex/skills" }
      },
      collab: { upstream: ["prd"], downstream: ["qa"], handoff_via: ".aiteam/tasks/" }
    },
    persona: { file: "CLAUDE.md", content: "# Preview persona\n（浏览器预览，不会持久化）\n" },
    skillDirs: ["frontend-ui"]
  }),
  saveRole: async (roleId) => ({ ok: true, id: roleId, origin: "workspace", warnings: ["Browser preview: changes are not persisted."] }),
  deleteRole: async (roleId) => ({ ok: true, removed: roleId, origin: "workspace", affectedAgents: [] }),
  assignAgentRole: async (agentId, roleId) => ({ ok: true, agent: { id: agentId, role_id: roleId || null, role: roleId ? { title: roleId } : null } }),
  assignAgentType: async (agentId, agentType) => ({ ok: true, agent: { id: agentId, type: agentType, name: agentType } }),
  routeMessage: async (message, targets) => ({ targets: targets.length ? targets : ["codex"], message }),
  openPath: async () => {},
  openExternal: async () => true,
  listAgentPresets: async () => [
    { id: "codex", name: "Codex", command: "codex", args: [], cwd: ".", enabled: true, provider: "openai", versionArgs: ["--version"], docUrl: "https://github.com/openai/codex" },
    { id: "claude", name: "Claude Code", command: "claude", args: [], cwd: ".", enabled: true, provider: "anthropic", versionArgs: ["--version"], docUrl: "https://docs.claude.com/claude-code" },
    { id: "kimi", name: "Kimi", command: "kimi", args: [], cwd: ".", enabled: true, provider: "moonshot", versionArgs: ["--version"], docUrl: "https://platform.moonshot.cn" }
  ],
  detectAgents: async () => [
    { type: "codex", name: "Codex", command: "codex", provider: "openai", installed: true, runnable: true, version: "0.1.0", path: "/usr/local/bin/codex", source: "path", diagnostic: null, docUrl: "https://github.com/openai/codex" },
    { type: "claude", name: "Claude Code", command: "claude", provider: "anthropic", installed: true, runnable: true, version: "1.2.3", path: "/usr/local/bin/claude", source: "path", diagnostic: null, docUrl: "https://docs.claude.com/claude-code" },
    { type: "kimi", name: "Kimi", command: "kimi", provider: "moonshot", installed: false, runnable: false, version: null, path: null, source: null, diagnostic: null, docUrl: "https://platform.moonshot.cn" }
  ],
  checkHealth: async () => ({
    tmux: { installed: true, runnable: true, version: "3.4", path: "/opt/homebrew/bin/tmux", source: "homebrew", diagnostic: null, docUrl: "https://github.com/tmux/tmux/wiki/Installing" },
    agents: await browserPreviewApi.detectAgents()
  }),
  importAgents: async (payload, options = {}) => {
    const PREVIEW_PRESET_COMMANDS = { codex: "codex", claude: "claude", kimi: "kimi" };
    const drafts = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.agents)
        ? payload.agents
        : [payload];
    const agents = drafts.map((draft) => {
      const type = String(draft?.type || "").trim();
      const command = String(draft?.command || PREVIEW_PRESET_COMMANDS[type] || "").trim();
      return {
        ...draft,
        id: String(draft?.id || "").trim(),
        type: type || String(draft?.id || ""),
        name: String(draft?.name || draft?.id || ""),
        command,
        args: Array.isArray(draft?.args) ? draft.args : [],
        cwd: draft?.cwd || ".",
        enabled: draft?.enabled !== false,
        warnings: ["Browser preview: imports are not persisted."],
        errors: draft?.id && command ? [] : ["Missing required field: id and command are required."]
      };
    });
    const ok = agents.every((agent) => !agent.errors.length);
    if (!options.dryRun && !ok) {
      throw new Error(agents.flatMap((agent) => agent.errors).join(" "));
    }
    return { ok, agents, imported: ok && !options.dryRun ? agents.map((agent) => agent.id) : [], limitError: null };
  },
  // Emit small sample output in browser preview without real agents.
  onAgentData: (callback) => {
    const timer = setInterval(() => callback({ id: "codex", data: "·" }), 1400);
    return () => clearInterval(timer);
  },
  onAgentStatus: () => () => {},
  onRouteVerify: () => () => {},
  onWorkspaceChanged: () => () => {},
  onMenuCommand: () => () => {}
};

const api = window.aiTeams || browserPreviewApi;

// Restore snapshots come from `tmux capture-pane` (newline-joined screen text
// with SGR, see tmuxAgentTerminalSnapshot). Prefix a RIS full reset so the
// captured screen paints onto a clean slate, and normalize bare \n to \r\n since
// capture output is line-joined, not raw PTY bytes. This must only ever run over
// capture-pane text — never over raw PTY byte streams (the \n→\r\n rewrite would
// corrupt those).
function snapshotToTerminalData(data) {
  return `\x1bc${String(data || "").replace(/\r?\n/g, "\r\n")}`;
}

// Maps an agent status to its i18n key (several statuses share a label).
// Translate at the call site via t(statusLabelKey(status)).
const STATUS_LABEL_KEYS = {
  stopped: "status.stopped",
  starting: "status.running",
  running_or_idle: "status.running",
  waiting_input: "status.waiting_input",
  exited: "status.stopped",
  error: "status.error",
  missing_runtime: "status.error",
  pane_missing: "status.error"
};

function statusClass(status) {
  if (status === "waiting_input") return "status-waiting";
  if (status === "running_or_idle" || status === "starting") return "status-running";
  if (status === "error" || status === "missing_runtime" || status === "pane_missing") return "status-error";
  return "status-stopped";
}

function stoppedOrExited(agent) {
  return (
    agent.status === "stopped" ||
    agent.status === "exited" ||
    agent.status === "error" ||
    agent.status === "missing_runtime" ||
    agent.status === "pane_missing"
  );
}

function agentDisplayName(agent) {
  // `name` is the single source of truth for the display label (role schema
  // direction A: no separate title, no emoji/badge prefix). Fall back to id.
  return String(agent?.name || agent?.id || "").trim();
}

function agentPanelTitle(agent) {
  // Panel title is "DisplayName + Runtime" (e.g. "技术负责人 + Claude").
  // agentRuntimeLabel returns the bare runtime, so the two never duplicate;
  // if they happen to coincide (display name IS the runtime), show one.
  const display = agentDisplayName(agent);
  const runtime = agentRuntimeLabel(agent);
  if (display && runtime && display !== runtime) {
    return `${display} + ${runtime}`;
  }
  return display || runtime;
}

function agentRuntimeLabel(agent) {
  // Bare runtime identity only — the agent's own name is shown separately by
  // agentDisplayName, so do NOT fold it in here (that caused "Claude · <name>"
  // to duplicate the role name already shown on the left).
  const type = String(agent?.type || "").trim().toLowerCase();
  const command = String(agent?.command || "").trim().split(/\s+/)[0];
  if (type === "codex") return "Codex";
  if (type === "claude") return "Claude";
  if (type === "kimi") return "Kimi";
  return command || agent?.name || agent?.id || "Agent";
}

function staleRouteNotice(value) {
  return /route:send|recorded pane is missing|Cannot send broadcast|Message may not have been injected/i.test(String(value || ""));
}

function pickActiveAgentId(agentList, currentId = null, minimized = null) {
  const runningAgents = agentList.filter((agent) => agent.enabled && !stoppedOrExited(agent));
  if (currentId && runningAgents.some((agent) => agent.id === currentId)) {
    return currentId;
  }
  const visibleAgents = minimized ? runningAgents.filter((agent) => !minimized.has(agent.id)) : runningAgents;
  return visibleAgents[0]?.id || null;
}

function activeAgentStorageKey(workspaceRoot) {
  return `aiTeams.activeAgent:${workspaceRoot || "default"}`;
}

function minimizedStorageKey(workspaceRoot) {
  return `aiTeams.minimizedAgents:${workspaceRoot || "default"}`;
}

function readActiveAgentId(workspaceRoot) {
  try {
    return String(window.localStorage?.getItem(activeAgentStorageKey(workspaceRoot)) || "").trim();
  } catch {
    return "";
  }
}

function writeActiveAgentId(workspaceRoot, agentId) {
  try {
    if (agentId) {
      window.localStorage?.setItem(activeAgentStorageKey(workspaceRoot), agentId);
    } else {
      window.localStorage?.removeItem(activeAgentStorageKey(workspaceRoot));
    }
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

function readMinimizedAgents(workspaceRoot) {
  try {
    const raw = window.localStorage?.getItem(minimizedStorageKey(workspaceRoot));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function documentFolderLabel(folder) {
  return folder ? `docs/${folder}` : "docs";
}

function documentDisplayPath(document) {
  return document.folder ? `docs/${document.folder}` : "docs";
}

function folderAncestorKeys(folder = "") {
  if (!folder) return [""];
  const parts = folder.split("/").filter(Boolean);
  const keys = [""];
  for (let index = 1; index <= parts.length; index += 1) {
    keys.push(parts.slice(0, index).join("/"));
  }
  return keys;
}

function defaultExpandedFolders(documents = []) {
  const keys = new Set([""]);
  for (const document of documents.filter((item) => item.pinned).slice(0, 8)) {
    folderAncestorKeys(document.folder).forEach((key) => keys.add(key));
  }
  if (keys.size === 1) {
    for (const document of documents.slice(0, 4)) {
      folderAncestorKeys(document.folder).forEach((key) => keys.add(key));
    }
  }
  return keys;
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

const documentFieldFilters = [
  { id: "all", labelKey: "docFilter.all" },
  { id: "todo", labelKey: "docFilter.todo" },
  { id: "finish", labelKey: "docFilter.finish" }
];

function documentStateLabelKey(document) {
  const state = document?.fields?.state;
  if (state === "finish") return "docState.finish";
  if (state === "todo") return "docState.todo";
  return "";
}

function nodeMatchesSearch(node, query) {
  if (!query) return true;
  return [
    node.name,
    node.relativePath,
    node.folder ? documentDisplayPath(node) : "",
    node.path
  ].some((value) => String(value || "").toLowerCase().includes(query));
}

function nodeMatchesDocumentField(node, fieldFilter) {
  if (!fieldFilter || fieldFilter === "all") return true;
  const fields = node.fields || {};
  if (fields.state === fieldFilter) return true;
  return [
    fields.status,
    ...(Array.isArray(fields.tags) ? fields.tags : [])
  ].some((value) => String(value || "").toLowerCase().includes(fieldFilter));
}

function countDocumentTree(node) {
  if (!node) return 0;
  if (node.type === "document") return 1;
  return (node.children || []).reduce((total, child) => total + countDocumentTree(child), 0);
}

function filterDocumentTree(node, query, fieldFilter = "all", queryMatchedAncestor = false) {
  if (!node) return null;
  const hasQuery = Boolean(query);
  const hasFieldFilter = fieldFilter && fieldFilter !== "all";
  if (!hasQuery && !hasFieldFilter) return node;
  const matchesNode = nodeMatchesSearch(node, query);
  if (node.type === "document") {
    const matchesSearch = !hasQuery || queryMatchedAncestor || matchesNode;
    return matchesSearch && nodeMatchesDocumentField(node, fieldFilter) ? node : null;
  }
  const childQueryMatched = queryMatchedAncestor || (hasQuery && matchesNode);
  const children = (node.children || [])
    .map((child) => filterDocumentTree(child, query, fieldFilter, childQueryMatched))
    .filter(Boolean);
  if (!children.length) return null;
  return {
    ...node,
    children,
    documentCount: children.reduce((total, child) => total + (child.type === "folder" ? child.documentCount : 1), 0)
  };
}

function formatDocumentTime(value, t) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const translate = typeof t === "function" ? t : (key) => key;
  if (diffMs < minute) return translate("time.now");
  if (diffMs < hour) return translate("time.minutesAgo", { n: Math.floor(diffMs / minute) });
  if (diffMs < day) return translate("time.hoursAgo", { n: Math.floor(diffMs / hour) });
  if (diffMs < 7 * day) return translate("time.daysAgo", { n: Math.floor(diffMs / day) });
  const sameYear = new Date(now).getFullYear() === date.getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" });
}

function extractRouteMentions(message) {
  return [...String(message || "").matchAll(/@ ?([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
}

function compactRouteQuery(message) {
  return String(message || "").replace(/@ ?[A-Za-z0-9_-]+/g, "").trim();
}

function createDashboardEvent(type, kind, text, extra = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    kind,
    text,
    time: new Date().toISOString(),
    ...extra
  };
}

function extractSnapshotSummary(snapshot) {
  const text = String(snapshot?.data || "");
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim()).filter(Boolean);
  const tail = lines.at(-1) || "";
  return { doing: tail, tail };
}

function agentStatusKind(status) {
  if (status === "running_or_idle" || status === "starting") return "run";
  if (status === "waiting_input") return "wait";
  if (status === "error" || status === "missing_runtime" || status === "pane_missing") return "err";
  return "stop";
}

function DocumentTreeNode({
  node,
  depth = 0,
  expandedFolders,
  forceExpanded,
  handoffPath,
  showPath,
  onToggleFolder,
  onOpen,
  onInsertDocumentPath,
  onToggleDocumentPinned
}) {
  const t = useT();
  if (!node) return null;

  if (node.type === "folder") {
    const expanded = forceExpanded || expandedFolders.has(node.key);
    const hasChildren = (node.children || []).length > 0;
    return (
      <div className="tree-node">
        <button
          className="tree-row folder-row"
          type="button"
          style={{ "--tree-depth": depth }}
          onClick={() => onToggleFolder(node.key)}
          title={node.relativePath}
          aria-expanded={expanded}
        >
          <span className="folder-chevron">{hasChildren ? (expanded ? "▾" : "▸") : ""}</span>
          <span className="folder-icon" aria-hidden="true">{expanded ? "📂" : "📁"}</span>
          <span className="folder-name">{node.name}</span>
          <span className="folder-count">{node.documentCount}</span>
        </button>
        {expanded && hasChildren ? (
          <div className="tree-children">
            {node.children.map((child) => (
              <DocumentTreeNode
                key={child.type === "folder" ? `folder:${child.key}` : `document:${child.path}`}
                node={child}
                depth={depth + 1}
                expandedFolders={expandedFolders}
                forceExpanded={forceExpanded}
                handoffPath={handoffPath}
                showPath={showPath}
                onToggleFolder={onToggleFolder}
                onOpen={onOpen}
                onInsertDocumentPath={onInsertDocumentPath}
                onToggleDocumentPinned={onToggleDocumentPinned}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const stateLabelKey = documentStateLabelKey(node);
  const updatedLabel = formatDocumentTime(node.updatedAt, t);

  return (
    <div
      className={[
        "tree-row",
        "document-row",
        node.pinned ? "document-row-pinned" : "",
        handoffPath && node.path === handoffPath ? "document-row-handoff" : ""
      ].filter(Boolean).join(" ")}
      style={{ "--tree-depth": depth }}
    >
      <span className="document-icon" aria-hidden="true">📄</span>
      <button className="document-open" type="button" onClick={() => onOpen(node.path)} title={node.relativePath}>
        <span>{node.name}</span>
        <small>
          {stateLabelKey ? (
            <>
              <span className={`document-status document-status-${node.fields?.state}`}>
                {t(stateLabelKey)}
              </span>
              {" · "}
            </>
          ) : null}
          {showPath ? `${documentDisplayPath(node)} · ` : ""}
          {updatedLabel}
        </small>
      </button>
      <button
        className="document-insert"
        type="button"
        title={`Insert path: ${node.relativePath}`}
        aria-label={`Insert path for ${node.name}`}
        onClick={() => onInsertDocumentPath(node.relativePath)}
      >
        +
      </button>
      <button
        className="document-pin"
        type="button"
        title={node.pinned ? "Unpin document" : "Pin document"}
        aria-label={node.pinned ? "Unpin document" : "Pin document"}
        onClick={() => onToggleDocumentPinned(node.relativePath)}
      >
        {node.pinned ? "★" : "☆"}
      </button>
    </div>
  );
}

function AgentTerminal({ agent, active, hidden, terminalTheme, onFocus, onNotice, onStop, onToggleMinimize }) {
  const t = useT();
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const scheduleResizeRef = useRef(null);
  const scheduleRefreshRef = useRef(null);
  const writeOutputRef = useRef(null);
  const lastSeqRef = useRef(0);
  const pendingOutputRef = useRef([]);
  const pendingOutputCharsRef = useRef(0);
  const pendingTerminalOutputRef = useRef("");
  const pendingWriteTextRef = useRef("");
  const pendingWriteSeqRef = useRef(0);
  const writeFrameRef = useRef(0);
  const snapshotReadyRef = useRef(false);
  const snapshotReplayInFlightRef = useRef(false);
  const hiddenRef = useRef(hidden);
  const terminalThemeRef = useRef(terminalTheme);

  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  const queuePendingOutput = useCallback((data, seq = 0) => {
    const text = String(data || "");
    if (!text) return;
    pendingOutputRef.current.push({ data: text, seq });
    pendingOutputCharsRef.current += text.length;
    pendingOutputCharsRef.current = trimPendingOutputQueue(pendingOutputRef.current, pendingOutputCharsRef.current);
  }, []);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    let disposed = false;
    let resizeFrame = 0;
    let refreshFrame = 0;
    let lastResizeKey = "";
    let truncatedNoticeShown = false;
    lastSeqRef.current = 0;
    pendingOutputRef.current = [];
    pendingOutputCharsRef.current = 0;
    pendingTerminalOutputRef.current = "";
    pendingWriteTextRef.current = "";
    pendingWriteSeqRef.current = 0;
    writeFrameRef.current = 0;
    snapshotReadyRef.current = false;
    snapshotReplayInFlightRef.current = false;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.2,
      macOptionClickForcesSelection: true,
      rescaleOverlappingGlyphs: true,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      theme: terminalThemeRef.current
    });
    terminal.attachCustomWheelEventHandler((event) => handleTerminalWheel(event, terminal));
    const inputBatcher = createTerminalInputBatcher({
      send: (data) => api.sendInput(agent.id, data),
      onError: (error) => onNotice?.(`${agent.name}: ${error.message}`)
    });
    // Force a full glyph-atlas rebuild + viewport repaint. This is EXPENSIVE
    // (drops the whole texture atlas) so it must only run on low-frequency
    // events — resize, theme change, font/zoom change, tab becoming visible —
    // where the atlas genuinely needs rebuilding. It must NOT run per output
    // write: streaming TUI output would then rebuild the atlas every frame,
    // defeating xterm's dirty-region incremental render and causing flicker.
    const refreshViewport = () => {
      if (disposed || !termRef.current) return;
      if (refreshFrame) return;
      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = 0;
        if (disposed || !termRef.current || terminal.rows < 1) return;
        try {
          terminal.clearTextureAtlas?.();
          terminal.refresh(0, terminal.rows - 1);
        } catch {
          // xterm refresh is best-effort; the data buffer is still intact.
        }
      });
    };
    const writeOutput = (data) => {
      const visibleData = filterTerminalOutput(data, pendingTerminalOutputRef);
      if (!visibleData) return false;
      // True-TUI mode: write raw agent bytes straight to xterm. terminal.write
      // schedules xterm's own incremental (dirty-region) render; do NOT force a
      // clearTextureAtlas/refresh here — that full rebuild per chunk is the
      // flicker source. filterTerminalOutput only buffers a trailing incomplete
      // escape; it no longer rewrites cursor/alt-screen/mouse sequences, so the
      // TUI's own redraws reach xterm intact.
      terminal.write(visibleData);
      return true;
    };
    const flushQueuedOutput = () => {
      writeFrameRef.current = 0;
      if (disposed || !termRef.current) {
        pendingWriteTextRef.current = "";
        pendingWriteSeqRef.current = 0;
        return;
      }
      const text = pendingWriteTextRef.current;
      const seq = pendingWriteSeqRef.current;
      pendingWriteTextRef.current = "";
      pendingWriteSeqRef.current = 0;
      if (!text) return;
      const didWrite = writeOutput(text);
      if (didWrite && seq) {
        lastSeqRef.current = seq;
      }
    };
    const queueOutput = (data, seq = 0) => {
      const text = String(data || "");
      if (!text) return;
      pendingWriteTextRef.current = appendBoundedTerminalWrite(pendingWriteTextRef.current, text);
      if (seq) {
        pendingWriteSeqRef.current = Math.max(pendingWriteSeqRef.current || 0, seq);
      }
      if (!writeFrameRef.current) {
        writeFrameRef.current = requestAnimationFrame(flushQueuedOutput);
      }
    };
    const replayPendingOutput = () => {
      for (const pending of pendingOutputRef.current) {
        if (pending.seq && pending.seq <= lastSeqRef.current) continue;
        queueOutput(pending.data, pending.seq);
        if (pending.seq) {
          lastSeqRef.current = Math.max(lastSeqRef.current, pending.seq);
        }
      }
      pendingOutputRef.current = [];
      pendingOutputCharsRef.current = 0;
    };
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    const wheelTarget = containerRef.current;
    const onWheelCapture = (event) => handleTerminalWheel(event, terminal);
    wheelTarget?.addEventListener("wheel", onWheelCapture, { capture: true, passive: false });
    const replaySnapshot = async ({ noticeTruncated = false, reason = "restore" } = {}) => {
      if (snapshotReplayInFlightRef.current) return;
      snapshotReplayInFlightRef.current = true;
      try {
        if (reason === "restore") {
          snapshotReadyRef.current = false;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (disposed || !termRef.current) return;
        fitAndSync();
        const snapshot = await api.getAgentSnapshot(agent.id, { reason });
        if (disposed || !termRef.current) return;
        if (snapshot?.data) {
          if (noticeTruncated && snapshot.truncated && !truncatedNoticeShown) {
            truncatedNoticeShown = true;
            onNotice?.(`Showing recent ${agent.name} terminal output; older output is in the session log.`);
          }
          // capture-pane snapshots are newline-joined screen text: paint them on a
          // clean slate via snapshotToTerminalData (\x1bc + \n→\r\n). Fallback
          // snapshots (format: "raw") are raw PTY bytes — write them verbatim so
          // the \n→\r\n rewrite cannot corrupt their escape sequences; still
          // prefix \x1bc so they start from a reset screen.
          const restoreData = snapshot.format === "raw"
            ? `\x1bc${snapshot.data}`
            : snapshotToTerminalData(snapshot.data);
          writeOutput(restoreData);
          // Snapshot replay is a self-contained reset frame. If the replay tail
          // ended in a partial ANSI sequence, drop that fragment so live output
          // cannot be parsed as its continuation.
          pendingTerminalOutputRef.current = "";
        }
        lastSeqRef.current = Math.max(lastSeqRef.current || 0, snapshot?.seq || 0);
        snapshotReadyRef.current = true;
        replayPendingOutput();
      } catch (error) {
        if (!disposed) {
          onNotice?.(`Could not restore ${agent.name} terminal output: ${error.message}`);
          // writeOutput -> filterTerminalOutput mutates pendingTerminalOutputRef
          // (it stashes a trailing incomplete escape). If terminal.write threw
          // mid-restore, that ref keeps a dangling escape fragment that would
          // corrupt parsing of the next live chunk. Reset it so live output
          // starts from a clean parser state.
          pendingTerminalOutputRef.current = "";
          snapshotReadyRef.current = true;
          replayPendingOutput();
        }
      } finally {
        snapshotReplayInFlightRef.current = false;
      }
    };
    const fitAndSync = () => {
      if (disposed || !containerRef.current || !termRef.current) return false;
      const box = containerRef.current.getBoundingClientRect();
      if (box.width < 20 || box.height < 20) return false;
      try {
        fitAddon.fit();
      } catch {
        return false;
      }
      const resizeKey = `${terminal.cols}x${terminal.rows}`;
      const resized = resizeKey !== lastResizeKey;
      if (resizeKey !== lastResizeKey) {
        lastResizeKey = resizeKey;
        // True-TUI mode: the backend resize-window fires SIGWINCH and the agent's
        // TUI repaints itself at the new cols/rows. We do NOT fetch+replay a
        // snapshot on resize — replaying the raw byte history at a new width
        // overprints garbage. Just resize and let the TUI redraw.
        api.resizeAgent(agent.id, terminal.cols, terminal.rows).catch(() => {});
      }
      refreshViewport();
      return resized;
    };
    const scheduleResize = () => {
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        fitAndSync();
      });
    };
    fitAndSync();
    terminal.onData((data) => {
      if (!agent.pane || stoppedOrExited(agent)) {
        return;
      }
      const filteredData = filterTerminalInput(data);
      if (!filteredData) {
        return;
      }
      inputBatcher.push(filteredData);
    });
    termRef.current = terminal;
    fitRef.current = fitAddon;
    scheduleResizeRef.current = scheduleResize;
    scheduleRefreshRef.current = refreshViewport;
    writeOutputRef.current = queueOutput;

    const observer = new ResizeObserver(scheduleResize);
    observer.observe(containerRef.current);
    window.addEventListener("resize", scheduleResize);
    const scheduleWindowRestoreSync = () => {
      if (document.visibilityState === "hidden") return;
      scheduleResize();
      setTimeout(scheduleResize, 80);
    };
    window.addEventListener("focus", scheduleWindowRestoreSync);
    document.addEventListener("visibilitychange", scheduleWindowRestoreSync);
    scheduleResize();
    replaySnapshot({ noticeTruncated: true, reason: "restore" });
    const resizeTimers = [50, 250, 700].map((delay) => setTimeout(scheduleResize, delay));
    return () => {
      disposed = true;
      snapshotReadyRef.current = false;
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
      }
      if (refreshFrame) {
        cancelAnimationFrame(refreshFrame);
      }
      if (writeFrameRef.current) {
        cancelAnimationFrame(writeFrameRef.current);
      }
      resizeTimers.forEach((timer) => clearTimeout(timer));
      observer.disconnect();
      window.removeEventListener("resize", scheduleResize);
      window.removeEventListener("focus", scheduleWindowRestoreSync);
      document.removeEventListener("visibilitychange", scheduleWindowRestoreSync);
      wheelTarget?.removeEventListener("wheel", onWheelCapture, { capture: true });
      inputBatcher.dispose({ flush: true });
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
      scheduleResizeRef.current = null;
      scheduleRefreshRef.current = null;
      writeOutputRef.current = null;
      pendingWriteTextRef.current = "";
      pendingWriteSeqRef.current = 0;
    };
  }, [agent.backend, agent.id, agent.name, agent.pane, agent.rawLog, agent.transcriptLog, onNotice, queuePendingOutput]);

  useEffect(() => {
    if (hidden) return;
    scheduleResizeRef.current?.();
    scheduleRefreshRef.current?.();
    const timers = [80, 260].map((delay) => setTimeout(() => {
      scheduleResizeRef.current?.();
      scheduleRefreshRef.current?.();
    }, delay));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [hidden]);

  // Re-theme the live terminal in place: no dispose, no scrollback loss.
  useEffect(() => {
    terminalThemeRef.current = terminalTheme;
    if (termRef.current) {
      termRef.current.options.theme = terminalTheme;
      scheduleRefreshRef.current?.();
    }
  }, [terminalTheme]);

  useEffect(() => {
    if (!active || hidden || !termRef.current) return;
    termRef.current.focus();
    scheduleResizeRef.current?.();
    scheduleRefreshRef.current?.();
  }, [active, hidden]);

  useEffect(() => {
    const off = api.onAgentData(({ id, data, seq = 0 }) => {
      if (id === agent.id && termRef.current) {
        if (!snapshotReadyRef.current || snapshotReplayInFlightRef.current) {
          queuePendingOutput(data, seq);
          return;
        }
        if (seq && seq <= lastSeqRef.current) {
          return;
        }
        writeOutputRef.current?.(data, seq);
      }
    });
    return off;
  }, [agent.id, queuePendingOutput]);

  // Only waiting_input breathes: it is the one status that asks the user to act.
  const breathClass = stoppedOrExited(agent)
    ? ""
    : agent.status === "waiting_input"
      ? "terminal-card-working breath-waiting"
      : "";
  const rawStatus = agent.status || "unknown";
  const statusTitle = [
    `Raw status: ${rawStatus}`,
    agent.reason ? `Reason: ${agent.reason}` : ""
  ].filter(Boolean).join("\n");
  const displayName = agentPanelTitle(agent);
  const runtime = agentRuntimeLabel(agent);
  const paneLabel = agent.pane ? `pane ${agent.pane}` : "pane -";
  const terminalTitle = [
    displayName,
    [agent.backend || "direct-pty", agent.pane].filter(Boolean).join(" ")
  ].filter(Boolean).join(" · ");
  const statusKey = STATUS_LABEL_KEYS[agent.status];
  const statusText = statusKey ? t(statusKey) : agent.status;
  const dotClass = statusClass(agent.status);

  return (
    <section
      className={[
        "terminal-card",
        active ? "terminal-card-active" : "",
        hidden ? "terminal-card-hidden" : "",
        breathClass
      ].filter(Boolean).join(" ")}
      onPointerDownCapture={onFocus}
      onClick={onFocus}
    >
      <header className="terminal-header">
        <span className={`terminal-status-dot ${dotClass}`} title={statusTitle} />
        <div className="terminal-title-block">
          <div className="terminal-name" title={terminalTitle}>{displayName}</div>
          <div className="terminal-meta">{runtime} · {paneLabel}</div>
        </div>
        <div className="terminal-actions">
          <div className={`status-pill ${dotClass}`} title={statusTitle}>
            <span className="status-dot" />
            {statusText}
          </div>
          <button
            className="terminal-action"
            type="button"
            title={t("sidebar.minimizePanel")}
            aria-label={`${t("sidebar.minimizePanel")} ${displayName}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleMinimize?.();
            }}
          >
            –
          </button>
          <button
            className="terminal-action terminal-action-stop"
            type="button"
            title={t("sidebar.stopAgent")}
            aria-label={`${t("sidebar.stopAgent")} ${displayName}`}
            onClick={(event) => {
              event.stopPropagation();
              onStop?.();
            }}
          >
            ✕
          </button>
        </div>
      </header>
      <div className="terminal-surface" ref={containerRef} />
    </section>
  );
}

function linesToArray(text) {
  return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function csvToArray(text) {
  return String(text || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function blankRuntimeForm(runtime) {
  const isCodex = runtime === "codex";
  const isKimi = runtime === "kimi";
  return {
    command: runtime,
    argsText: "",
    instructionsFile: isCodex ? "AGENTS.md" : "CLAUDE.md",
    skillsDir: isCodex ? ".codex/skills" : (isKimi ? ".claude/skills" : ".claude/skills"),
    model: ""
  };
}

function blankRoleForm() {
  return {
    title: "", emoji: "", summary: "", track: "",
    defaultRuntime: "claude", autonomy: "auto",
    runtimes: {
      claude: blankRuntimeForm("claude"),
      codex: blankRuntimeForm("codex"),
      kimi: blankRuntimeForm("kimi")
    },
    skillsText: "",
    upstreamText: "", downstreamText: "", handoffVia: "", persona: ""
  };
}

function runtimeViewToForm(rt, runtime) {
  if (!rt) return blankRuntimeForm(runtime);
  return {
    command: String(rt.command || runtime),
    argsText: (Array.isArray(rt.args) ? rt.args : []).join("\n"),
    instructionsFile: String(rt.instructions_file || (runtime === "codex" ? "AGENTS.md" : "CLAUDE.md")),
    skillsDir: String(rt.skills_dir || (runtime === "codex" ? ".codex/skills" : ".claude/skills")),
    model: String(rt.model || "")
  };
}

function detailToForm(detail) {
  const template = detail?.template || {};
  const role = template.role && typeof template.role === "object" ? template.role : {};
  const collab = template.collab && typeof template.collab === "object" ? template.collab : {};
  const detailRuntimes = detail?.runtimes && typeof detail.runtimes === "object" ? detail.runtimes : {};
  return {
    name: String(detail?.name || template.name || ""),
    summary: String(role.summary || ""),
    track: String(role.track || ""),
    defaultRuntime: String(detail?.defaultRuntime || "claude"),
    autonomy: String(detail?.autonomy || "auto"),
    runtimes: {
      claude: runtimeViewToForm(detailRuntimes.claude, "claude"),
      codex: runtimeViewToForm(detailRuntimes.codex, "codex"),
      kimi: runtimeViewToForm(detailRuntimes.kimi, "kimi")
    },
    skillsText: (Array.isArray(template.skills) ? template.skills : []).join(", "),
    upstreamText: (Array.isArray(collab.upstream) ? collab.upstream : []).join(", "),
    downstreamText: (Array.isArray(collab.downstream) ? collab.downstream : []).join(", "),
    handoffVia: String(collab.handoff_via || ""),
    persona: String(detail?.persona?.content || "")
  };
}

function OnboardingModal({ api, onClose, onStartTeam }) {
  const t = useT();
  // null = first load not yet probed; the effect kicks off the first checkHealth.
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const runCheck = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const result = await api.checkHealth?.();
      setHealth(result || { tmux: { installed: false }, agents: [] });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => { runCheck(); }, [runCheck]);

  const persistDontShow = useCallback(() => {
    if (dontShowAgain) {
      try { window.localStorage?.setItem("aiTeams.onboardingDone", "true"); } catch { /* ignore */ }
    }
  }, [dontShowAgain]);

  const handleClose = useCallback(() => {
    persistDontShow();
    onClose();
  }, [persistDontShow, onClose]);

  const startTeam = useCallback(() => {
    persistDontShow();
    onStartTeam();
  }, [persistDontShow, onStartTeam]);

  // Esc closes the page (mirrors RoleConfigModal). No dirty guard needed here.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [handleClose]);

  // tmux is the one hard dependency; ready = tmux runnable AND ≥1 runnable agent.
  const tmux = health?.tmux || { installed: false, runnable: false };
  const agents = Array.isArray(health?.agents) ? health.agents : [];
  const hasRunnableAgent = agents.some((a) => a.runnable);
  const ready = Boolean(tmux.runnable && hasRunnableAgent);

  const statusGlyph = (item) => {
    if (item.runnable) {
      return {
        glyph: "✅",
        cls: "ok",
        text: item.version
          ? t("onboarding.installedVersion", { version: item.version })
          : t("onboarding.installed")
      };
    }
    if (item.installed) return { glyph: "⚠️", cls: "warn", text: t("onboarding.installedNotRunnable") };
    return { glyph: "❌", cls: "miss", text: t("onboarding.notFound") };
  };

  const Row = ({ name, item }) => {
    const s = statusGlyph(item);
    return (
      <div className={`onboarding-row onboarding-row-${s.cls}`}>
        <span className="onboarding-row-glyph">{s.glyph}</span>
        <span className="onboarding-row-name">{name}</span>
        <span className="onboarding-row-state">{s.text}</span>
        {!item.installed && item.docUrl ? (
          <button
            type="button"
            className="onboarding-install-link"
            onClick={() => (api.openExternal ? api.openExternal(item.docUrl) : window.open?.(item.docUrl, "_blank"))}
          >{t("onboarding.installGuide")}</button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="role-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <div className="role-modal onboarding-modal" role="dialog" aria-label={t("onboarding.aria")}>
        <div className="role-modal-header">
          <strong>{t("onboarding.title")}</strong>
          <button type="button" className="role-modal-close" onClick={handleClose} aria-label={t("common.close")}>✕</button>
        </div>

        <div className="onboarding-subtitle">{t("onboarding.subtitle")}</div>

        {error ? <div className="role-modal-error" onClick={() => setError("")}>{error}</div> : null}

        <div className="role-modal-body onboarding-body">
          {health === null ? (
            <div className="onboarding-loading">{t("onboarding.checking")}</div>
          ) : (
            <>
              <div className="onboarding-section-title">{t("onboarding.envTitle")}</div>
              <Row name="tmux" item={tmux} />
              {agents.map((a) => (
                <Row key={a.type} name={a.name || a.type} item={a} />
              ))}
              <div className={`onboarding-hint ${ready ? "onboarding-hint-ok" : "onboarding-hint-warn"}`}>
                {ready ? t("onboarding.ready") : t("onboarding.notReady")}
              </div>
            </>
          )}
        </div>

        <div className="onboarding-footer">
          <label className="onboarding-dont-show">
            <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
            {t("onboarding.dontShowAgain")}
          </label>
          <span className="onboarding-footer-actions">
            <button type="button" className="panel-action" disabled={busy} onClick={runCheck}>{busy ? t("onboarding.rechecking") : t("onboarding.recheck")}</button>
            <button type="button" className="panel-action onboarding-primary" onClick={startTeam}>{t("onboarding.startTeam")}</button>
          </span>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, body, confirmLabel, cancelLabel, danger, onConfirm, onCancel }) {
  const t = useT();
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      } else if (event.key === "Enter") {
        event.stopPropagation();
        onConfirm();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onConfirm, onCancel]);

  return (
    <div className="confirm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="confirm-dialog" role="alertdialog" aria-label={title}>
        {title ? <div className="confirm-title">{title}</div> : null}
        <div className="confirm-body">{body}</div>
        <div className="confirm-actions">
          <button type="button" className="panel-action" onClick={onCancel}>
            {cancelLabel || t("confirm.cancel")}
          </button>
          <button
            type="button"
            className={`panel-action ${danger ? "role-danger" : "role-primary"}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel || t("confirm.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleConfigModal({ api, roles, onClose, onRolesChanged }) {
  const t = useT();
  const [tab, setTab] = useState("list");
  const [busy, setBusy] = useState(false);
  // notice = { level: "error" | "success", text }. Success and failure share
  // one notice slot but render with distinct styling (T7), so a "Saved: X"
  // message no longer reads as a red error.
  const [notice, setNotice] = useState(null);
  const showError = useCallback((text) => setNotice({ level: "error", text: String(text || "") }), []);
  const showSuccess = useCallback((text) => setNotice({ level: "success", text: String(text || "") }), []);
  const clearNotice = useCallback(() => setNotice(null), []);
  // import tab
  const [importDest, setImportDest] = useState("workspace");
  const [importId, setImportId] = useState("");
  // edit tab
  const [editing, setEditing] = useState(null); // { id, origin }
  const [form, setForm] = useState(blankRoleForm());
  const [dirty, setDirty] = useState(false);
  // In-app confirm dialog state. null = closed; otherwise { title?, body,
  // danger?, onConfirm }. Replaces window.confirm so the prompt matches the
  // app's dark theme instead of a native OS dialog.
  const [confirm, setConfirm] = useState(null);

  const closeGuarded = useCallback(() => {
    if (dirty) {
      setConfirm({
        title: t("confirm.discardTitle"),
        body: t("confirm.discardBody"),
        danger: true,
        onConfirm: () => { setConfirm(null); onClose(); }
      });
      return;
    }
    onClose();
  }, [dirty, onClose, t]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        // When the in-app confirm is open, let it own Esc (it closes itself).
        if (confirm) return;
        event.stopPropagation();
        closeGuarded();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [closeGuarded, confirm]);

  const updateForm = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const updateRuntime = (runtime, patch) => {
    setForm((current) => ({
      ...current,
      runtimes: { ...current.runtimes, [runtime]: { ...current.runtimes[runtime], ...patch } }
    }));
    setDirty(true);
  };

  const openImport = async () => {
    clearNotice();
    try {
      if (!api.pickDirectory || !api.importRole) {
        showError(t("roleModal.importUnsupported"));
        return;
      }
      const sourcePath = await api.pickDirectory({ title: "选择一个外部 Agent / Role 文件夹" });
      if (!sourcePath) return;
      setBusy(true);
      const options = { dest: importDest };
      if (importId.trim()) options.id = importId.trim();
      const result = await api.importRole(sourcePath, options);
      await onRolesChanged();
      setImportId("");
      setTab("list");
      const warn = Array.isArray(result?.warnings) && result.warnings.length ? ` (${result.warnings.join(" ")})` : "";
      showSuccess(`${t("roleModal.imported", { id: result?.id || sourcePath })}${warn}`);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = async (roleId) => {
    clearNotice();
    setBusy(true);
    try {
      const detail = await api.loadRoleDetail(roleId);
      setEditing({ id: detail.id, origin: detail.origin });
      setForm(detailToForm(detail));
      setDirty(false);
      setTab("edit");
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    clearNotice();
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        role: { summary: form.summary, track: form.track },
        default_runtime: form.defaultRuntime,
        autonomy: form.autonomy,
        runtimes: Object.fromEntries(
          ["claude", "codex", "kimi"].map((rtName) => [rtName, {
            command: form.runtimes[rtName].command,
            args: linesToArray(form.runtimes[rtName].argsText),
            instructions_file: form.runtimes[rtName].instructionsFile,
            skills_dir: form.runtimes[rtName].skillsDir,
            model: form.runtimes[rtName].model
          }])
        ),
        skills: csvToArray(form.skillsText),
        collab: {
          upstream: csvToArray(form.upstreamText),
          downstream: csvToArray(form.downstreamText),
          handoff_via: form.handoffVia
        },
        persona: { content: form.persona }
      };
      const options = editing.origin === "global" ? { promoteToWorkspace: true } : {};
      const result = await api.saveRole(editing.id, payload, options);
      await onRolesChanged();
      setDirty(false);
      setEditing({ id: result.id, origin: result.origin });
      const warn = Array.isArray(result?.warnings) && result.warnings.length ? ` (${result.warnings.join(" ")})` : "";
      showSuccess(`${t("roleModal.saved", { id: result.id })}${warn}`);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const performRemoveRole = async (roleId, origin) => {
    const isGlobal = origin === "global";
    clearNotice();
    setBusy(true);
    try {
      const result = await api.deleteRole(roleId, isGlobal ? { allowGlobal: true } : {});
      await onRolesChanged();
      if (editing?.id === roleId) {
        setEditing(null);
        setForm(blankRoleForm());
        setDirty(false);
        setTab("list");
      }
      const affectedCount = Array.isArray(result?.affectedAgents) ? result.affectedAgents.length : 0;
      showSuccess(affectedCount
        ? t("roleModal.deletedAffected", { id: roleId, n: affectedCount })
        : t("roleModal.deleted", { id: roleId }));
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeRole = (roleId, origin) => {
    const isGlobal = origin === "global";
    setConfirm({
      body: isGlobal
        ? t("confirm.deleteRoleGlobal", { id: roleId })
        : t("confirm.deleteRole", { id: roleId }),
      danger: true,
      onConfirm: () => { setConfirm(null); performRemoveRole(roleId, origin); }
    });
  };

  return (
    <div className="role-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeGuarded(); }}>
      <div className="role-modal" role="dialog" aria-label="配置 Agent / Role">
        <div className="role-modal-header">
          <strong>配置 Agent</strong>
          <button type="button" className="role-modal-close" onClick={closeGuarded} aria-label="关闭">✕</button>
        </div>
        <div className="role-modal-tabs">
          <button type="button" className={`role-modal-tab ${tab === "list" ? "role-modal-tab-active" : ""}`} onClick={() => setTab("list")}>Role 列表</button>
          <button type="button" className={`role-modal-tab ${tab === "import" ? "role-modal-tab-active" : ""}`} onClick={() => setTab("import")}>导入</button>
          <button type="button" className={`role-modal-tab ${tab === "edit" ? "role-modal-tab-active" : ""}`} onClick={() => setTab("edit")} disabled={!editing}>编辑{editing ? `：${editing.id}` : ""}</button>
        </div>

        {notice ? (
          <div
            className={`role-modal-notice role-modal-notice-${notice.level}`}
            onClick={clearNotice}
          >
            {notice.text}
          </div>
        ) : null}

        <div className="role-modal-body">
          {tab === "list" ? (
            <div className="role-list">
              {roles.length ? roles.map((role) => (
                <div key={role.id} className="role-list-row">
                  <span className="role-list-main">
                    <span className="role-list-title">{role.name || role.id}</span>
                    <span className="role-list-id">{role.id}</span>
                    <span className={`role-source-badge role-source-${role.source || "global"}`}>{role.source || "global"}</span>
                    {role.hired ? <span className="role-source-badge">已雇</span> : null}
                  </span>
                  <span className="role-list-actions">
                    <button type="button" className="panel-action" disabled={busy} onClick={() => openEdit(role.id)}>编辑</button>
                    <button type="button" className="panel-action role-danger" disabled={busy} onClick={() => removeRole(role.id, role.source)}>删除</button>
                  </span>
                </div>
              )) : <div className="role-empty">还没有 Role。切到「导入」从本地文件夹导入一个外部 Agent。</div>}
            </div>
          ) : null}

          {tab === "import" ? (
            <div className="role-import-panel">
              <div className="role-field">
                <label>导入到</label>
                <select value={importDest} onChange={(event) => setImportDest(event.target.value)}>
                  <option value="workspace">当前工作区（.aiteam/roles）</option>
                  <option value="global">全局库（~/.aiteam/roles）</option>
                </select>
              </div>
              <div className="role-field">
                <label>自定义 Role ID（可选，留空用源目录的 id）</label>
                <input value={importId} onChange={(event) => setImportId(event.target.value)} placeholder="例如 my-frontend" />
              </div>
              <p className="role-hint">源文件夹需包含 role.json、persona 文件（默认 CLAUDE.md）、以及至少一个 .claude/skills/&lt;名&gt;/SKILL.md。</p>
              <button type="button" className="panel-action" disabled={busy} onClick={openImport}>选择文件夹并导入…</button>
            </div>
          ) : null}

          {tab === "edit" && editing ? (
            <div className="role-edit-form">
              {editing.origin === "global" ? (
                <div className="role-hint role-hint-warn">这是全局 Role，保存将创建一份当前工作区的副本（全局原件不变）。</div>
              ) : null}
              <div className="role-field">
                <label>Role ID（不可改）</label>
                <input value={editing.id} disabled />
              </div>
              <div className="role-field-row">
                <div className="role-field">
                  <label>名称</label>
                  <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} />
                </div>
                <div className="role-field role-field-narrow">
                  <label>Track</label>
                  <input value={form.track} onChange={(event) => updateForm({ track: event.target.value })} placeholder="impl / plan / qa" />
                </div>
              </div>
              <div className="role-field">
                <label>摘要</label>
                <textarea rows={2} value={form.summary} onChange={(event) => updateForm({ summary: event.target.value })} />
              </div>
              <div className="role-field-row">
                <div className="role-field">
                  <label>默认运行时</label>
                  <select value={form.defaultRuntime} onChange={(event) => updateForm({ defaultRuntime: event.target.value })}>
                    <option value="claude">Claude</option>
                    <option value="codex">Codex</option>
                    <option value="kimi">Kimi</option>
                  </select>
                </div>
                <div className="role-field">
                  <label>Autonomy</label>
                  <select value={form.autonomy} onChange={(event) => updateForm({ autonomy: event.target.value })}>
                    <option value="auto">auto（自动）</option>
                    <option value="human">human（需人工）</option>
                  </select>
                </div>
              </div>

              {["claude", "codex", "kimi"].map((rtName) => (
                <div key={rtName} className="role-runtime-block">
                  <div className="role-runtime-title">
                    运行时：{rtName === "claude" ? "Claude" : rtName === "codex" ? "Codex" : "Kimi"}
                    {form.defaultRuntime === rtName ? <span className="role-source-badge role-source-workspace">默认</span> : null}
                  </div>
                  <div className="role-field-row">
                    <div className="role-field">
                      <label>Command</label>
                      <input value={form.runtimes[rtName].command} onChange={(event) => updateRuntime(rtName, { command: event.target.value })} placeholder={rtName} />
                    </div>
                    <div className="role-field">
                      <label>指令文件</label>
                      <input value={form.runtimes[rtName].instructionsFile} onChange={(event) => updateRuntime(rtName, { instructionsFile: event.target.value })} placeholder={rtName === "codex" ? "AGENTS.md" : "CLAUDE.md"} />
                    </div>
                    <div className="role-field">
                      <label>Skills 目录</label>
                      <input value={form.runtimes[rtName].skillsDir} onChange={(event) => updateRuntime(rtName, { skillsDir: event.target.value })} placeholder={rtName === "codex" ? ".codex/skills" : ".claude/skills"} />
                    </div>
                    <div className="role-field">
                      <label>Model（留空=用 CLI 默认）</label>
                      <input value={form.runtimes[rtName].model} onChange={(event) => updateRuntime(rtName, { model: event.target.value })} placeholder={rtName === "claude" ? "opus" : rtName === "codex" ? "gpt-5.2" : "kimi-k2"} />
                    </div>
                  </div>
                  <div className="role-field">
                    <label>Args（一行一个参数）</label>
                    <textarea rows={2} value={form.runtimes[rtName].argsText} onChange={(event) => updateRuntime(rtName, { argsText: event.target.value })} placeholder={rtName === "codex" ? "--dangerously-bypass-approvals-and-sandbox" : rtName === "kimi" ? "-y" : "--dangerously-skip-permissions"} />
                  </div>
                </div>
              ))}

              <div className="role-field">
                <label>Skills（逗号分隔）</label>
                <input value={form.skillsText} onChange={(event) => updateForm({ skillsText: event.target.value })} placeholder="frontend-ui, design" />
              </div>
              <div className="role-field-row">
                <div className="role-field">
                  <label>协作 · 上游（逗号分隔）</label>
                  <input value={form.upstreamText} onChange={(event) => updateForm({ upstreamText: event.target.value })} placeholder="prd, manager" />
                </div>
                <div className="role-field">
                  <label>协作 · 下游（逗号分隔）</label>
                  <input value={form.downstreamText} onChange={(event) => updateForm({ downstreamText: event.target.value })} placeholder="qa" />
                </div>
              </div>
              <div className="role-field">
                <label>协作 · 交接路径</label>
                <input value={form.handoffVia} onChange={(event) => updateForm({ handoffVia: event.target.value })} placeholder=".aiteam/tasks/" />
              </div>
              <div className="role-field role-field-persona">
                <label>Persona 正文（写入默认运行时的指令文件 {form.runtimes?.[form.defaultRuntime]?.instructionsFile || "CLAUDE.md"}）</label>
                <textarea value={form.persona} onChange={(event) => updateForm({ persona: event.target.value })} spellCheck={false} />
              </div>
            </div>
          ) : null}
        </div>

        {tab === "edit" && editing ? (
          <div className="role-modal-footer">
            <button type="button" className="panel-action role-danger" disabled={busy} onClick={() => removeRole(editing.id, editing.origin)}>删除</button>
            <span className="role-modal-footer-spacer" />
            <button type="button" className="panel-action" disabled={busy} onClick={closeGuarded}>取消</button>
            <button type="button" className="panel-action role-primary" disabled={busy || !dirty} onClick={save}>保存</button>
          </div>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          danger={confirm.danger}
          confirmLabel={confirm.confirmLabel}
          cancelLabel={confirm.cancelLabel}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function Sidebar({
  workspace,
  agents,
  roles,
  agentTypes,
  documents,
  activeAgentId,
  minimizedAgents,
  collapsed,
  handoffPath,
  onToggleCollapsed,
  onSelectAgent,
  onSelectWorkspace,
  onChooseWorkspace,
  onToggleDocumentPinned,
  onStart,
  onStop,
  onToggleMinimize,
  onAssignRole,
  onAssignType,
  onImportRole,
  onOpen,
  onInsertDocumentPath
}) {
  const t = useT();
  const documentList = documents?.documents || [];
  const documentTree = documents?.tree || null;
  const recentWorkspaces = workspace?.recentWorkspaces || [];
  const recentWorkspaceOptions = recentWorkspaces.filter((item) => item.root !== workspace?.root);
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentFieldFilter, setDocumentFieldFilter] = useState("all");
  const [expandedFolders, setExpandedFolders] = useState(() => defaultExpandedFolders(documentList));
  const searchQuery = normalizeSearch(documentSearch);
  const filteredTree = useMemo(
    () => filterDocumentTree(documentTree, searchQuery, documentFieldFilter),
    [documentTree, searchQuery, documentFieldFilter]
  );
  const filteredDocumentCount = useMemo(() => countDocumentTree(filteredTree), [filteredTree]);
  const hasDocumentFilter = Boolean(searchQuery) || documentFieldFilter !== "all";

  useEffect(() => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      let changed = false;
      for (const key of defaultExpandedFolders(documentList)) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [documentList]);

  // Keep the handoff document's row reachable: expand its ancestor folders
  // whenever a document is armed in the composer.
  const handoffDocument = useMemo(
    () => (handoffPath ? documentList.find((document) => document.path === handoffPath) || null : null),
    [documentList, handoffPath]
  );

  useEffect(() => {
    if (!handoffDocument) return;
    setExpandedFolders((current) => {
      const next = new Set(current);
      let changed = false;
      for (const key of folderAncestorKeys(handoffDocument.folder)) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [handoffDocument]);

  const toggleFolder = useCallback((key) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      if (!next.size) {
        next.add("");
      }
      return next;
    });
  }, []);

  return (
    <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
      <div className="brand">
        <div className="brand-top">
          <div className="brand-mark">
            <img src={aiTeamsAppIcon} alt="" aria-hidden="true" />
          </div>
          <div className="brand-copy">
            <h1>AI Teams</h1>
          </div>
          <div className="brand-actions">
            <button
              className="sidebar-icon-button sidebar-toggle"
              type="button"
              title={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
              aria-label={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
              onClick={onToggleCollapsed}
            >
              {collapsed ? "›" : "‹"}
            </button>
          </div>
        </div>
        <div className="workspace-control">
          <div className="workspace-label">{t("sidebar.project")}</div>
          <button
            className="workspace-current"
            type="button"
            title={workspace?.name || t("sidebar.chooseProject")}
            onClick={onChooseWorkspace}
          >
            <span className="workspace-current-name">{workspace?.name || t("sidebar.chooseProject")}</span>
          </button>
          <label className="workspace-picker">
            <span>{t("sidebar.recent")}</span>
            <select
              value=""
              title={recentWorkspaceOptions.length ? t("sidebar.switchRecent") : t("sidebar.noRecent")}
              disabled={!recentWorkspaceOptions.length}
              onChange={(event) => onSelectWorkspace(event.target.value)}
            >
              <option value="">{recentWorkspaceOptions.length ? t("sidebar.switchRecent") : t("sidebar.noRecent")}</option>
              {recentWorkspaceOptions.map((item) => (
                <option key={item.root} value={item.root}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="collapsed-brand">
        <div className="brand-mark">
          <img src={aiTeamsAppIcon} alt="" aria-hidden="true" />
        </div>
        <div className="brand-actions">
          <button
            className="sidebar-icon-button sidebar-toggle"
            type="button"
            title={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
            aria-label={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
            onClick={onToggleCollapsed}
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div className="panel-title">{t("sidebar.team")}</div>
          {onImportRole ? (
            <button
              type="button"
              className="panel-action"
              title={t("sidebar.configAgentTooltip")}
              onClick={onImportRole}
            >
              {t("sidebar.configAgent")}
            </button>
          ) : null}
        </div>
        <div className="agent-list">
        {agents.map((agent) => {
          const minimized = agent.enabled && !stoppedOrExited(agent) && minimizedAgents?.has(agent.id);
          const displayName = agentDisplayName(agent);
          const statusText = STATUS_LABEL_KEYS[agent.status] ? t(STATUS_LABEL_KEYS[agent.status]) : agent.status;
          const rowTitle = agent.enabled ? `${displayName} · ${statusText}` : displayName;
          const assignedRoleId = agent.role_id || (agent.role && roles.some((role) => role.id === agent.id) ? agent.id : "");
          const assignedAgentType = agent.type || agent.id || "";
          return (
            <div
              key={agent.id}
              className={[
                "agent-row",
                activeAgentId === agent.id ? "agent-row-active" : "",
                !agent.enabled ? "agent-row-disabled" : "",
                minimized ? "agent-row-minimized" : ""
              ].filter(Boolean).join(" ")}
              role="button"
              tabIndex={0}
              onClick={() => onSelectAgent(agent.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectAgent(agent.id);
                }
              }}
              title={rowTitle}
            >
              <span
                className={`agent-dot ${statusClass(agent.status)}`}
                title={rowTitle}
              />
              <span className="agent-main agent-main-stacked">
                <select
                  className={`agent-role-select ${assignedRoleId ? "" : "agent-role-select-unassigned"}`}
                  value={assignedRoleId}
                  title={t("sidebar.role")}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    event.stopPropagation();
                    onAssignRole(agent.id, event.target.value);
                  }}
                >
                  <option value="">{t("sidebar.unassignedRole")}</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name || role.id}
                    </option>
                  ))}
                </select>
                <select
                  className="agent-type-select"
                  value={assignedAgentType}
                  title={t("sidebar.agentType")}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    event.stopPropagation();
                    onAssignType(agent.id, event.target.value);
                  }}
                >
                  {agentTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name || type.id}
                    </option>
                  ))}
                </select>
              </span>
              <span className="agent-actions">
                {!agent.enabled ? (
                  <span className="disabled-label">{t("sidebar.off")}</span>
                ) : stoppedOrExited(agent) ? (
                  <button
                    className="icon-button"
                    type="button"
                    title={t("sidebar.startAgent")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onStart(agent.id);
                    }}
                  >
                    ▶
                  </button>
                ) : (
                  <>
                    <button
                      className="window-control window-control-close"
                      type="button"
                      title={t("sidebar.stopAgent")}
                      aria-label={`${t("sidebar.stopAgent")} ${agent.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onStop(agent.id);
                      }}
                    >
                      ✕
                    </button>
                    <button
                      className="window-control window-control-minimize"
                      type="button"
                      title={minimized ? t("sidebar.restorePanel") : t("sidebar.minimizePanel")}
                      aria-label={minimized ? `${t("sidebar.restorePanel")} ${agent.name}` : `${t("sidebar.minimizePanel")} ${agent.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleMinimize(agent.id);
                        if (minimized) {
                          onSelectAgent(agent.id);
                        }
                      }}
                    >
                      {minimized ? "+" : "–"}
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div className="panel-title">{t("sidebar.docs")}</div>
          <span>{hasDocumentFilter ? `${filteredDocumentCount}/${documentList.length}` : documentList.length}</span>
        </div>
        <label className="document-search">
          <span>{t("sidebar.searchDocs")}</span>
          <input
            type="search"
            value={documentSearch}
            placeholder={t("sidebar.searchDocs")}
            onChange={(event) => setDocumentSearch(event.target.value)}
          />
          <select
            value={documentFieldFilter}
            aria-label="Filter docs"
            onChange={(event) => setDocumentFieldFilter(event.target.value)}
          >
            {documentFieldFilters.map((filter) => (
              <option key={filter.id} value={filter.id}>{t(filter.labelKey)}</option>
            ))}
          </select>
        </label>
        <div className="document-tree" role="tree" aria-label="Project docs">
          {filteredTree ? (
            <DocumentTreeNode
              node={filteredTree}
              expandedFolders={expandedFolders}
              forceExpanded={hasDocumentFilter}
              handoffPath={handoffPath}
              showPath={hasDocumentFilter}
              onToggleFolder={toggleFolder}
              onOpen={onOpen}
              onInsertDocumentPath={onInsertDocumentPath}
              onToggleDocumentPinned={onToggleDocumentPinned}
            />
          ) : (
            <div className="document-empty">{hasDocumentFilter ? t("sidebar.noMatchingDocs") : t("sidebar.noDocs")}</div>
          )}
        </div>
      </section>
    </aside>
  );
}

function WorkspaceTopbar({
  view,
  runningCount,
  theme,
  onViewChange,
  onToggleTheme,
  onStartEnabled,
  onStopEnabled
}) {
  const t = useT();
  const nextThemeLabel = theme.colorScheme === "dark" ? t("theme.toggleToLight") : t("theme.toggleToDark");
  return (
    <header className="workspace-topbar">
      <div className="segmented" role="tablist" aria-label="Workspace view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "terminal"}
          className={["seg", view === "terminal" ? "on" : ""].filter(Boolean).join(" ")}
          onClick={() => onViewChange("terminal")}
        >
          {t("view.terminal")}
          <span className="seg-badge">{runningCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "dashboard"}
          className={["seg", view === "dashboard" ? "on" : ""].filter(Boolean).join(" ")}
          onClick={() => onViewChange("dashboard")}
        >
          {t("view.dashboard")}
        </button>
      </div>
      <div className="topbar-actions">
        <button className="topbar-button" type="button" onClick={onToggleTheme} title={nextThemeLabel} aria-label={nextThemeLabel}>
          {theme.colorScheme === "dark" ? "☀" : "☾"}
        </button>
        <button className="topbar-button" type="button" onClick={onStartEnabled}>{t("sidebar.start")}</button>
        <button className="topbar-button" type="button" onClick={onStopEnabled}>{t("sidebar.stop")}</button>
      </div>
    </header>
  );
}

const Composer = forwardRef(function Composer({ agents, documents, activeAgentId, taskPath, onTaskPathChange, onRoute }, ref) {
  const t = useT();
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [docMenuOpen, setDocMenuOpen] = useState(false);
  const [docQuery, setDocQuery] = useState("");
  const textareaRef = useRef(null);
  const docPickerRef = useRef(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const pendingCursorRef = useRef(null);
  const composingRef = useRef(false);
  const documentList = documents?.documents || [];
  const enabledAgents = useMemo(() => agents.filter((agent) => agent.enabled), [agents]);
  // C3: the composer placeholder mentions the active member by their role
  // display name (e.g. "设计师") rather than the internal id (e.g. "codex").
  const activeAgentDisplayName = useMemo(() => {
    if (!activeAgentId) return "";
    const agent = agents.find((a) => a.id === activeAgentId);
    return agent ? agentDisplayName(agent) : activeAgentId;
  }, [agents, activeAgentId]);
  const attachedDocument = useMemo(
    () => documentList.find((document) => document.path === taskPath) || null,
    [documentList, taskPath]
  );
  const docPickerOptions = useMemo(() => {
    const query = normalizeSearch(docQuery);
    if (!query) return documentList;
    return documentList.filter((document) => [
      document.name,
      document.relativePath,
      document.folder ? documentDisplayPath(document) : "",
      document.path
    ].some((part) => String(part || "").toLowerCase().includes(query)));
  }, [docQuery, documentList]);
  const hasMention = useMemo(() => extractRouteMentions(value).length > 0, [value]);
  const mentionPreview = useMemo(() => {
    const mentions = extractRouteMentions(value);
    const hasAll = mentions.some((m) => m.toLowerCase() === "all");
    if (hasAll) return enabledAgents.map((agent) => agent.id);
    if (mentions.length) return mentions;
    return activeAgentId ? [activeAgentId] : [];
  }, [activeAgentId, enabledAgents, value]);
  const hasRouteTarget = hasMention || Boolean(activeAgentId);
  const canSubmit = Boolean(value.trim()) && !sending && hasRouteTarget;

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || sending || !hasRouteTarget) return;
    const explicitTargets = hasMention ? [] : activeAgentId ? [activeAgentId] : [];
    setSending(true);
    try {
      await onRoute(trimmed, explicitTargets, taskPath ? { taskPath } : {});
      setValue("");
      selectionRef.current = { start: 0, end: 0 };
    } finally {
      setSending(false);
    }
  }, [activeAgentId, hasMention, hasRouteTarget, onRoute, sending, taskPath, value]);

  const rememberSelection = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd
    };
  }, []);

  // Auto-grow the textarea with its content, capped by the CSS max-height
  // (160px) beyond which it scrolls. Runs on every value change so insertText,
  // clear-on-send, and typing all stay in sync.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const next = Math.min(textarea.scrollHeight, 168);
    textarea.style.height = `${Math.max(next, 52)}px`;
  }, [value]);

  useImperativeHandle(ref, () => ({
    insertText(text) {
      const insertValue = String(text || "");
      if (!insertValue) return;

      setValue((current) => {
        const fallbackPosition = current.length;
        const savedSelection = selectionRef.current || {};
        const start = Math.max(0, Math.min(savedSelection.start ?? fallbackPosition, current.length));
        const end = Math.max(start, Math.min(savedSelection.end ?? start, current.length));
        const nextValue = `${current.slice(0, start)}${insertValue}${current.slice(end)}`;
        const nextCursor = start + insertValue.length;
        pendingCursorRef.current = nextCursor;
        selectionRef.current = { start: nextCursor, end: nextCursor };
        return nextValue;
      });
    }
  }), []);

  useEffect(() => {
    if (pendingCursorRef.current === null) return;
    const nextCursor = pendingCursorRef.current;
    pendingCursorRef.current = null;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.selectionStart = nextCursor;
    textarea.selectionEnd = nextCursor;
    selectionRef.current = { start: nextCursor, end: nextCursor };
  }, [value]);

  useEffect(() => {
    if (!docMenuOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (docPickerRef.current && !docPickerRef.current.contains(event.target)) {
        setDocMenuOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setDocMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [docMenuOpen]);

  const insertLineBreak = useCallback((event) => {
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextValue = `${value.slice(0, start)}\n${value.slice(end)}`;
    setValue(nextValue);
    requestAnimationFrame(() => {
      textarea.selectionStart = start + 1;
      textarea.selectionEnd = start + 1;
      selectionRef.current = { start: start + 1, end: start + 1 };
    });
  }, [value]);

  return (
    <footer className={["composer", hasMention ? "composer-has-targets" : "", attachedDocument ? "composer-has-doc" : ""].filter(Boolean).join(" ")}>
      <div className="composer-shell">
        <textarea
          ref={textareaRef}
          value={value}
          placeholder={activeAgentId ? t("composer.askAgent", { name: activeAgentDisplayName }) : t("composer.mentionAgent")}
          onChange={(event) => {
            setValue(event.target.value);
            selectionRef.current = {
              start: event.target.selectionStart,
              end: event.target.selectionEnd
            };
          }}
          onClick={rememberSelection}
          onFocus={rememberSelection}
          onKeyUp={rememberSelection}
          onSelect={rememberSelection}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            const composing = event.isComposing ||
              event.nativeEvent?.isComposing ||
              event.keyCode === 229 ||
              event.nativeEvent?.keyCode === 229 ||
              composingRef.current;
            if (event.key !== "Enter" || composing) {
              return;
            }
            if (event.ctrlKey || event.metaKey) {
              event.preventDefault();
              insertLineBreak(event);
              return;
            }
            if (!event.shiftKey && !event.altKey && !event.metaKey) {
              event.preventDefault();
              submit();
            }
          }}
          disabled={sending}
        />
        <div className="composer-tools">
          <div className="tool-left">
            <div className="composer-doc-tools" ref={docPickerRef}>
              <button
                className={["tool-btn", attachedDocument ? "on" : ""].filter(Boolean).join(" ")}
                type="button"
                title={attachedDocument ? t("composer.changeDoc") : t("composer.attachDoc")}
                aria-label={attachedDocument ? t("composer.changeDoc") : t("composer.attachDoc")}
                aria-haspopup="dialog"
                aria-expanded={docMenuOpen}
                onClick={() => {
                  setDocMenuOpen((open) => {
                    if (!open) setDocQuery("");
                    return !open;
                  });
                }}
              >
                📎
              </button>
              {docMenuOpen ? (
                <div className="doc-picker-menu" role="dialog" aria-label={t("composer.attachDoc")}>
                  <input
                    className="doc-picker-search"
                    type="search"
                    value={docQuery}
                    placeholder={t("sidebar.searchDocs")}
                    onChange={(event) => setDocQuery(event.target.value)}
                    autoFocus
                  />
                  <div className="doc-picker-list">
                    {attachedDocument ? (
                      <button
                        type="button"
                        className="doc-picker-option doc-picker-clear"
                        onClick={() => {
                          onTaskPathChange("");
                          setDocMenuOpen(false);
                          setDocQuery("");
                        }}
                      >
                        {t("composer.noDoc")}
                      </button>
                    ) : null}
                    {docPickerOptions.length ? docPickerOptions.map((document) => (
                      <button
                        key={document.path}
                        type="button"
                        className={[
                          "doc-picker-option",
                          document.path === taskPath ? "doc-picker-option-active" : ""
                        ].filter(Boolean).join(" ")}
                        onClick={() => {
                          onTaskPathChange(document.path);
                          setDocMenuOpen(false);
                          setDocQuery("");
                        }}
                      >
                        <span>
                          {document.pinned ? "★ " : ""}
                          {document.name}
                        </span>
                        <small>{documentFolderLabel(document.folder)}</small>
                      </button>
                    )) : (
                      <div className="doc-picker-empty">{t("sidebar.noMatchingDocs")}</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {attachedDocument ? (
              <span className="attachment-chip" title={`${attachedDocument.relativePath}`}>
                <span className="attachment-chip-label">{attachedDocument.name}</span>
                <button
                  type="button"
                  title={t("composer.removeDoc")}
                  aria-label={t("composer.removeDoc")}
                  onClick={() => onTaskPathChange("")}
                >
                  ✕
                </button>
              </span>
            ) : null}
            <span className="target-chip" title={hasMention ? mentionPreview.map((item) => `@${item}`).join(" ") : activeAgentDisplayName}>
              <i />
              {hasMention
                ? `${t("composer.targets")}${mentionPreview.length ? mentionPreview.map((item) => `@${item}`).join(" ") : t("composer.targetsNone")}`
                : activeAgentDisplayName ? `@${activeAgentDisplayName}` : t("composer.targetsNone")}
            </span>
          </div>
          <div className="composer-hint">{t("composer.hint")}</div>
          <button
            className="send-button"
            onClick={submit}
            title={t("composer.sendTooltip")}
            disabled={!canSubmit}
          >
            {sending ? t("composer.sending") : t("composer.send")}
          </button>
        </div>
      </div>
    </footer>
  );
});

function App() {
  const t = useT();
  const { setLocale } = useLocale();
  const [workspace, setWorkspace] = useState(null);
  const [agents, setAgents] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleConfigOpen, setRoleConfigOpen] = useState(false);
  // Health-check / onboarding page. Auto-opens on first launch (no
  // `aiTeams.onboardingDone` flag); also reachable from the 团队/帮助 menus.
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      return window.localStorage?.getItem("aiTeams.onboardingDone") !== "true";
    } catch {
      return false;
    }
  });
  const [agentTypes, setAgentTypes] = useState([]);
  const [documents, setDocuments] = useState({ root: "", folder: "", folders: [], tree: null, documents: [] });
  const [activeAgentId, setActiveAgentId] = useState(null);
  // WS-D D1: leveled toast queue replacing the single top notice bar.
  // error = persistent (manual dismiss); success = 3s; info = 5s. Stacked
  // bottom-right. setNotice(...) is kept as a compat shim: a non-empty string
  // becomes an error toast (covers all existing `setNotice(error.message)`
  // sites), an empty string is a no-op.
  const [toasts, setToasts] = useState([]);
  const toastSeqRef = useRef(0);
  const toastTimersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toastItem) => toastItem.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(({ level = "info", text }) => {
    const message = String(text ?? "").trim();
    if (!message) return null;
    const id = `toast-${toastSeqRef.current++}`;
    setToasts((current) => [...current, { id, level, text: message }]);
    const ttl = toastTtl(level);
    if (ttl > 0) {
      const timer = setTimeout(() => dismissToast(id), ttl);
      toastTimersRef.current.set(id, timer);
    }
    return id;
  }, [dismissToast]);

  // Compat shim for the many existing call sites: setNotice(msg) raises an
  // error toast; setNotice("") clears nothing (errors are dismissed explicitly
  // or by the stale-route effect below).
  const setNotice = useCallback((msg) => {
    pushToast({ level: "error", text: msg });
  }, [pushToast]);

  // Pause a toast's auto-dismiss while the pointer rests on it, so a reader is
  // never raced by the countdown. Error toasts have no timer (ttl 0) so this is
  // a no-op for them.
  const pauseToast = useCallback((id) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  // Restart the auto-dismiss countdown (full ttl) when the pointer leaves.
  const resumeToast = useCallback((id, level) => {
    const ttl = toastTtl(level);
    if (ttl <= 0 || toastTimersRef.current.has(id)) return;
    const timer = setTimeout(() => dismissToast(id), ttl);
    toastTimersRef.current.set(id, timer);
  }, [dismissToast]);
  const composerRef = useRef(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage?.getItem("aiTeams.sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });
  const [minimizedAgents, setMinimizedAgents] = useState(() => new Set());
  const minimizedReadyRootRef = useRef(null);
  const minimizedAgentsRef = useRef(minimizedAgents);
  const workspaceRoot = workspace?.root || "";
  const [themeId, setThemeId] = useState(() => {
    try {
      return window.localStorage?.getItem("aiTeams.theme") || DEFAULT_THEME_ID;
    } catch {
      return DEFAULT_THEME_ID;
    }
  });
  const theme = themePresets[themeId] || themePresets[DEFAULT_THEME_ID];
  const themeCssVars = useMemo(() => themeToCssVars(theme), [theme]);
  const [effectsEnabled, setEffectsEnabled] = useState(() => {
    try {
      return window.localStorage?.getItem("aiTeams.ambientEffects") !== "false";
    } catch {
      return true;
    }
  });
  const [taskPath, setTaskPath] = useState("");
  const [workspaceView, setWorkspaceView] = useState(() => {
    try {
      return window.localStorage?.getItem("aiTeams.workspaceView") === "dashboard" ? "dashboard" : "terminal";
    } catch {
      return "terminal";
    }
  });
  const [dashboardEvents, setDashboardEvents] = useState([]);
  const [agentSnapshots, setAgentSnapshots] = useState({});
  const [agentQueries, setAgentQueries] = useState({});

  const pushDashboardEvent = useCallback((event) => {
    setDashboardEvents((current) => [event, ...current].slice(0, 50));
  }, []);

  const chooseActiveAgent = useCallback((agentId) => {
    const nextAgentId = String(agentId || "").trim();
    setActiveAgentId(nextAgentId || null);
    writeActiveAgentId(workspaceRoot, nextAgentId);
  }, [workspaceRoot]);

  useEffect(() => {
    try {
      window.localStorage?.setItem("aiTeams.theme", theme.id);
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }, [theme.id]);

  useEffect(() => {
    try {
      window.localStorage?.setItem("aiTeams.workspaceView", workspaceView);
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }, [workspaceView]);

  useEffect(() => {
    try {
      window.localStorage?.setItem("aiTeams.ambientEffects", effectsEnabled ? "true" : "false");
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }, [effectsEnabled]);

  // The armed handoff document only makes sense while it exists in the tree.
  useEffect(() => {
    const documentList = documents?.documents || [];
    if (taskPath && !documentList.some((document) => document.path === taskPath)) {
      setTaskPath("");
    }
  }, [documents, taskPath]);

  useEffect(() => {
    minimizedAgentsRef.current = minimizedAgents;
  }, [minimizedAgents]);

  // Persist before the load effect below so a workspace switch cannot write
  // the previous workspace's set under the new workspace key.
  useEffect(() => {
    if (minimizedReadyRootRef.current !== workspaceRoot) return;
    try {
      window.localStorage?.setItem(minimizedStorageKey(workspaceRoot), JSON.stringify([...minimizedAgents]));
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }, [minimizedAgents, workspaceRoot]);

  useEffect(() => {
    minimizedReadyRootRef.current = workspaceRoot;
    setMinimizedAgents(readMinimizedAgents(workspaceRoot));
  }, [workspaceRoot]);

  // A minimized panel only makes sense while the agent runs: drop the flag once
  // it stops/exits so the next start shows the panel again.
  useEffect(() => {
    setMinimizedAgents((current) => {
      if (!current.size) return current;
      const next = new Set(current);
      let changed = false;
      for (const agent of agents) {
        if (next.has(agent.id) && (!agent.enabled || stoppedOrExited(agent))) {
          next.delete(agent.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [agents]);

  const clearMinimized = useCallback((agentIds) => {
    setMinimizedAgents((current) => {
      const next = new Set(current);
      let changed = false;
      for (const agentId of agentIds) {
        if (next.delete(agentId)) changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  const toggleAgentMinimized = useCallback((agentId) => {
    setMinimizedAgents((current) => {
      const next = new Set(current);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }, []);

  // Cmd/Ctrl+Alt+Arrow cycles the active window. We deliberately require a
  // modifier: bare arrows must stay with the focused terminal so they keep
  // moving the cursor in the underlying CLI. Capturing here (before xterm) and
  // preventDefault keep the chord from leaking into the PTY.
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const onKeyDown = (event) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || !event.altKey || event.shiftKey) return;
      const dir = event.key === "ArrowRight" ? "right" : event.key === "ArrowLeft" ? "left" : null;
      if (!dir) return;

      // Owning the chord regardless of outcome keeps it out of the PTY.
      event.preventDefault();
      event.stopPropagation();

      const visible = agents.filter((agent) => !minimizedAgents.has(agent.id));
      if (visible.length <= 1) return;

      const len = visible.length;
      const idx = visible.findIndex((agent) => agent.id === activeAgentId);
      const next = dir === "right"
        ? (idx < 0 ? 0 : (idx + 1) % len)
        : (idx < 0 ? len - 1 : (idx - 1 + len) % len);
      chooseActiveAgent(visible[next].id);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [agents, activeAgentId, chooseActiveAgent, minimizedAgents]);

  const refreshAgents = useCallback(async () => {
    const nextAgents = await api.listAgents();
    setAgents(nextAgents);
    setActiveAgentId((current) => {
      const persisted = readActiveAgentId(workspaceRoot);
      const candidate = current || persisted;
      const next = pickActiveAgentId(nextAgents, candidate, minimizedAgentsRef.current);
      if (next !== persisted) writeActiveAgentId(workspaceRoot, next);
      return next;
    });
  }, [workspaceRoot]);

  const loadWorkspaceData = useCallback(async () => {
    const [workspaceInfo, documentInfo, agentList, roleList, agentTypeList] = await Promise.all([
      api.getWorkspace(),
      api.listDocuments(""),
      api.listAgents(),
      Promise.resolve(api.listRoles?.() || []),
      Promise.resolve(api.listAgentPresets?.() || [])
    ]);
    setWorkspace(workspaceInfo);
    setDocuments(documentInfo);
    setAgents(agentList);
    setRoles(Array.isArray(roleList) ? roleList : []);
    setAgentTypes(Array.isArray(agentTypeList) ? agentTypeList : []);
    const nextRoot = workspaceInfo?.root || "";
    const nextActive = pickActiveAgentId(agentList, readActiveAgentId(nextRoot), readMinimizedAgents(nextRoot));
    setActiveAgentId(nextActive);
    writeActiveAgentId(nextRoot, nextActive);
    return { workspaceInfo, documentInfo, agentList, roleList, agentTypeList };
  }, []);

  const refreshDocuments = useCallback(async () => {
    const nextDocuments = await api.listDocuments("");
    setDocuments(nextDocuments);
    return nextDocuments;
  }, []);

  // Refs let the (mount-once) menu-command subscription reach handlers that are
  // declared later in render without re-subscribing or capturing stale closures.
  const startEnabledRef = useRef(null);
  const stopEnabledRef = useRef(null);
  const chooseWorkspaceRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadWorkspaceData().then(() => {
      if (mounted) setNotice("");
    }).catch((error) => {
      if (mounted) setNotice(error.message);
    });
    const offStatus = api.onAgentStatus((updated) => {
      setAgents((current) => current.map((agent) => (agent.id === updated.id ? { ...agent, ...updated } : agent)));
      const labelKey = STATUS_LABEL_KEYS[updated.status] || "status.stopped";
      pushDashboardEvent(createDashboardEvent(
        "status",
        agentStatusKind(updated.status),
        `${updated.name || updated.id} · ${t(labelKey)}`
      ));
    });
    const offRouteVerify = api.onRouteVerify?.((payload) => {
      if (payload && payload.verified === false) {
        setNotice(`Message may not have been injected into @${payload.id}; check that agent terminal.`);
        pushDashboardEvent(createDashboardEvent(
          "verify",
          "err",
          `@${payload.id} route verify failed`
        ));
      }
    }) || (() => {});
    const offWorkspace = api.onWorkspaceChanged(() => {
      loadWorkspaceData().catch((error) => setNotice(error.message));
    });
    const offDocumentsChanged = api.onDocumentsChanged?.(() => {
      refreshDocuments().catch((error) => setNotice(error.message));
    }) || (() => {});
    const offMenuCommand = api.onMenuCommand?.(({ id, payload } = {}) => {
      switch (id) {
        case "sidebar:toggle":
          setSidebarCollapsed((current) => !current);
          break;
        case "theme:set":
          if (payload) setThemeId(payload);
          break;
        case "lang:set":
          if (payload) setLocale(payload);
          break;
        case "effects:toggle":
          setEffectsEnabled((current) => !current);
          break;
        case "agents:startAll":
          startEnabledRef.current?.();
          break;
        case "agents:stopAll":
          stopEnabledRef.current?.();
          break;
        case "role:configure":
        case "settings:open":
          setRoleConfigOpen(true);
          break;
        case "workspace:choose":
          chooseWorkspaceRef.current?.();
          break;
        case "onboarding:open":
          setOnboardingOpen(true);
          break;
        default:
          break;
      }
    }) || (() => {});
    return () => {
      mounted = false;
      offStatus();
      offRouteVerify();
      offWorkspace();
      offDocumentsChanged();
      offMenuCommand();
    };
  }, [loadWorkspaceData, pushDashboardEvent, refreshDocuments, setLocale, t]);

  useEffect(() => {
    try {
      window.localStorage?.setItem("aiTeams.sidebarCollapsed", sidebarCollapsed ? "true" : "false");
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    setActiveAgentId((current) => {
      const next = pickActiveAgentId(agents, current || readActiveAgentId(workspaceRoot), minimizedAgents);
      if (next !== current) writeActiveAgentId(workspaceRoot, next);
      return next;
    });
  }, [agents, minimizedAgents, workspaceRoot]);

  useEffect(() => {
    const validAgentIds = new Set(agents.map((agent) => agent.id));
    setAgentQueries((current) => {
      let changed = false;
      const next = {};
      for (const [agentId, query] of Object.entries(current)) {
        if (validAgentIds.has(agentId)) {
          next[agentId] = query;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [agents]);

  useEffect(() => {
    if (workspaceView !== "dashboard") return undefined;
    let cancelled = false;
    const loadSnapshots = async () => {
      const entries = await Promise.all(agents
        .filter((agent) => agent.enabled && !stoppedOrExited(agent))
        .map(async (agent) => {
          try {
            const snapshot = await api.getAgentSnapshot(agent.id, { reason: "dashboard" });
            return [agent.id, extractSnapshotSummary(snapshot)];
          } catch {
            return [agent.id, { doing: "", tail: "" }];
          }
        }));
      if (!cancelled) {
        setAgentSnapshots(Object.fromEntries(entries));
      }
    };
    loadSnapshots();
    const timer = setInterval(loadSnapshots, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [agents, workspaceView]);

  useEffect(() => {
    const enabled = agents.filter((agent) => agent.enabled);
    if (!(enabled.length && enabled.every((agent) => !stoppedOrExited(agent)))) return;
    // Once every enabled agent is running again, a route-failure toast is stale.
    setToasts((current) => current.filter((toastItem) => !staleRouteNotice(toastItem.text)));
  }, [agents]);

  // Clear any pending toast timers on unmount.
  useEffect(() => () => {
    for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
    toastTimersRef.current.clear();
  }, []);

  const startAgent = async (agentId) => {
    try {
      clearMinimized([agentId]);
      const state = await api.startAgent(agentId);
      setAgents((current) => current.map((agent) => (agent.id === agentId ? { ...agent, ...state } : agent)));
      chooseActiveAgent(agentId);
    } catch (error) {
      setNotice(error.message);
    }
  };

  const stopAgent = async (agentId) => {
    try {
      clearMinimized([agentId]);
      await api.stopAgent(agentId);
      await refreshAgents();
    } catch (error) {
      setNotice(error.message);
    }
  };

  const assignRole = async (agentId, roleId) => {
    try {
      const result = await api.assignAgentRole?.(agentId, roleId);
      if (result?.agent) {
        setAgents((current) => current.map((agent) => (agent.id === agentId ? { ...agent, ...result.agent } : agent)));
      }
      await refreshAgents();
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    }
  };

  const assignType = async (agentId, agentType) => {
    try {
      const result = await api.assignAgentType?.(agentId, agentType);
      if (result?.agent) {
        setAgents((current) => current.map((agent) => (agent.id === agentId ? { ...agent, ...result.agent } : agent)));
      }
      await refreshAgents();
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    }
  };

  const refreshRoles = useCallback(async () => {
    const roleList = await Promise.resolve(api.listRoles?.() || []);
    setRoles(Array.isArray(roleList) ? roleList : []);
  }, []);

  const openRoleConfig = () => setRoleConfigOpen(true);

  const startEnabled = async () => {
    try {
      for (const agent of enabledAgents.filter(stoppedOrExited)) {
        const state = await api.startAgent(agent.id);
        setAgents((current) => current.map((item) => (item.id === agent.id ? { ...item, ...state } : item)));
      }
      await refreshAgents();
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    }
  };

  const stopEnabled = async () => {
    try {
      clearMinimized(enabledAgents.map((agent) => agent.id));
      if (api.stopAllAgents) {
        await api.stopAllAgents();
      } else {
        await Promise.all(enabledAgents.filter((agent) => !stoppedOrExited(agent)).map((agent) => api.stopAgent(agent.id)));
      }
      await refreshAgents();
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    }
  };

  const route = async (message, targets = [], options = {}) => {
    try {
      const result = await api.routeMessage(message, targets, options);
      const resolvedTargets = Array.isArray(result?.targets) && result.targets.length
        ? result.targets
        : targets.length
          ? targets
          : ["@mention"];
      const realTargets = resolvedTargets.filter((target) => !String(target).startsWith("@"));
      const latestQuery = compactRouteQuery(message) || message.trim();
      if (realTargets.length) {
        chooseActiveAgent(realTargets[0]);
        setAgentQueries((current) => {
          const next = { ...current };
          for (const target of realTargets) {
            next[target] = {
              text: latestQuery,
              time: new Date().toISOString()
            };
          }
          return next;
        });
      }
      pushDashboardEvent(createDashboardEvent(
        "route",
        "msg",
        `${t("dashboard.you")} → ${resolvedTargets.join(", ")}`,
        {
          from: t("dashboard.you"),
          to: resolvedTargets.join(", "),
          doc: options?.taskPath ? String(options.taskPath).split("/").pop() : ""
        }
      ));
      await refreshAgents();
      setNotice("");
    } catch (error) {
      setNotice(error.message);
      refreshAgents().catch(() => {});
    }
  };

  const toggleDocumentPinned = async (relativePath) => {
    try {
      await api.toggleDocumentPinned(relativePath);
      await refreshDocuments();
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    }
  };

  const selectWorkspace = async (targetRoot) => {
    if (!targetRoot || targetRoot === workspace?.root) return;
    try {
      await api.switchWorkspace(targetRoot);
      await loadWorkspaceData();
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    }
  };

  const chooseWorkspace = async () => {
    try {
      const nextWorkspace = await api.chooseWorkspace();
      if (!nextWorkspace) return;
      await loadWorkspaceData();
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    }
  };

  // Keep menu-command refs pointing at the latest handler closures every render.
  startEnabledRef.current = startEnabled;
  stopEnabledRef.current = stopEnabled;
  chooseWorkspaceRef.current = chooseWorkspace;

  const insertDocumentPath = useCallback((relativePath) => {
    composerRef.current?.insertText(relativePath);
  }, []);

  const enabledAgents = agents.filter((agent) => agent.enabled);
  const runningAgents = enabledAgents.filter((agent) => !stoppedOrExited(agent));
  const visibleTerminalAgents = runningAgents.filter((agent) => !minimizedAgents.has(agent.id));
  const minimizedCount = runningAgents.length - visibleTerminalAgents.length;
  const terminalLayoutCount = Math.min(Math.max(visibleTerminalAgents.length, 1), 3);
  const terminalLayoutClass = [
    "terminal-branches",
    `terminal-branches-${terminalLayoutCount}`,
    visibleTerminalAgents.length > 3 ? "terminal-branches-scroll" : ""
  ].filter(Boolean).join(" ");

  return (
    <div
      className={[
        "app-shell",
        sidebarCollapsed ? "app-shell-sidebar-collapsed" : "",
        effectsEnabled ? "effects-on" : ""
      ].filter(Boolean).join(" ")}
      data-theme={theme.id}
      style={{ ...themeCssVars, colorScheme: theme.colorScheme }}
    >
      <Sidebar
        workspace={workspace}
        agents={agents}
        roles={roles}
        agentTypes={agentTypes}
        documents={documents}
        activeAgentId={activeAgentId}
        minimizedAgents={minimizedAgents}
        collapsed={sidebarCollapsed}
        handoffPath={taskPath}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        onSelectAgent={(agentId) => {
          const agent = agents.find((item) => item.id === agentId);
          if (agent && !stoppedOrExited(agent)) {
            if (minimizedAgents.has(agentId)) {
              clearMinimized([agentId]);
            }
            chooseActiveAgent(agentId);
          }
        }}
        onSelectWorkspace={selectWorkspace}
        onChooseWorkspace={chooseWorkspace}
        onToggleDocumentPinned={toggleDocumentPinned}
        onStart={startAgent}
        onStop={stopAgent}
        onToggleMinimize={toggleAgentMinimized}
        onAssignRole={assignRole}
        onAssignType={assignType}
        onImportRole={openRoleConfig}
        onOpen={(targetPath) => api.openPath(targetPath)}
        onInsertDocumentPath={insertDocumentPath}
      />
      <main className="workspace">
        <WorkspaceTopbar
          view={workspaceView}
          runningCount={runningAgents.length}
          theme={theme}
          onViewChange={setWorkspaceView}
          onToggleTheme={() => setThemeId(theme.colorScheme === "dark" ? "studioLight" : "studioDark")}
          onStartEnabled={startEnabled}
          onStopEnabled={stopEnabled}
        />
        {workspaceView === "dashboard" ? (
          <Dashboard
            agents={agents}
            events={dashboardEvents}
            snapshots={agentSnapshots}
            queries={agentQueries}
            onOpenAgent={(agentId) => {
              if (minimizedAgents.has(agentId)) {
                clearMinimized([agentId]);
              }
              chooseActiveAgent(agentId);
              setWorkspaceView("terminal");
            }}
          />
        ) : (
          <section className={terminalLayoutClass}>
            {runningAgents.map((agent) => (
              <AgentTerminal
                key={[
                  workspace?.root || "workspace",
                  agent.id,
                  agent.backend || "",
                  agent.pane || "",
                  agent.rawLog || "",
                  agent.transcriptLog || "",
                  agent.startedAt || ""
                ].join(":")}
                agent={agent}
                active={activeAgentId === agent.id}
                hidden={minimizedAgents.has(agent.id)}
                terminalTheme={theme.terminal}
                onFocus={() => chooseActiveAgent(agent.id)}
                onNotice={setNotice}
                onStop={() => stopAgent(agent.id)}
                onToggleMinimize={() => toggleAgentMinimized(agent.id)}
              />
            ))}
            {!visibleTerminalAgents.length ? (
              <div className="empty-state">
                {minimizedCount ? (
                  <div className="empty-state-text">{t("empty.minimized", { n: minimizedCount })}</div>
                ) : enabledAgents.length ? (
                  <>
                    <div className="empty-state-text">{t("empty.noRunning")}</div>
                    <button type="button" className="empty-state-cta" onClick={startEnabled}>
                      {t("empty.startAll")}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="empty-state-text">{t("empty.noAgents")}</div>
                    <button type="button" className="empty-state-cta" onClick={openRoleConfig}>
                      {t("empty.configureTeam")}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </section>
        )}

        <Composer
          ref={composerRef}
          agents={runningAgents}
          documents={documents}
          activeAgentId={activeAgentId}
          taskPath={taskPath}
          onTaskPathChange={setTaskPath}
          onRoute={route}
        />
      </main>
      {roleConfigOpen ? (
        <RoleConfigModal
          api={api}
          roles={roles}
          onClose={() => setRoleConfigOpen(false)}
          onRolesChanged={refreshRoles}
        />
      ) : null}
      {onboardingOpen ? (
        <OnboardingModal
          api={api}
          onClose={() => setOnboardingOpen(false)}
          onStartTeam={() => { setOnboardingOpen(false); openRoleConfig(); }}
        />
      ) : null}
      {toasts.length ? (
        <div className="toast-stack" role="region" aria-live="polite">
          {toasts.map((toastItem) => (
            <div
              key={toastItem.id}
              className={`toast toast-${toastItem.level}`}
              onMouseEnter={() => pauseToast(toastItem.id)}
              onMouseLeave={() => resumeToast(toastItem.id, toastItem.level)}
            >
              <span className="toast-glyph" aria-hidden="true">
                {toastGlyph(toastItem.level)}
              </span>
              <span className="toast-text">{toastItem.text}</span>
              <button
                type="button"
                className="toast-close"
                title={t("toast.dismiss")}
                aria-label={t("toast.dismiss")}
                onClick={() => dismissToast(toastItem.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const rootElement = document.getElementById("root");
// Only wire renderer→main log forwarding in the real Electron app; the browser
// preview has no IPC bridge for electron-log to reach.
if (window.aiTeams) {
  installRendererLogging();
}
const root = rootElement.__aiTeamsRoot || createRoot(rootElement);
rootElement.__aiTeamsRoot = root;
root.render(
  <LocaleProvider>
    <App />
  </LocaleProvider>
);
