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
import { installRendererLogging } from "./renderer-log.mjs";

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
      claude: { command: "claude", args: ["--dangerously-skip-permissions"], instructions_file: "CLAUDE.md", skills_dir: ".claude/skills" },
      codex: { command: "codex", args: ["--dangerously-bypass-approvals-and-sandbox"], instructions_file: "AGENTS.md", skills_dir: ".codex/skills" }
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
      model: "opus",
      runtimes: {
        claude: { command: "claude", args: ["--dangerously-skip-permissions"], instructions_file: "CLAUDE.md", skills_dir: ".claude/skills" },
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

const statusLabels = {
  stopped: "Stopped",
  starting: "Running",
  running_or_idle: "Running",
  waiting_input: "Needs Input",
  exited: "Stopped",
  error: "Error",
  missing_runtime: "Error",
  pane_missing: "Error"
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
  const roleTitle = String(agent?.role?.title || "").trim();
  if (roleTitle) {
    const roleEmoji = String(agent?.role?.emoji || "").trim();
    return [roleEmoji, roleTitle].filter(Boolean).join(" ");
  }
  return agent?.name || agent?.id || "";
}

function agentPanelTitle(agent) {
  return [agentDisplayName(agent), agentRuntimeLabel(agent)].filter(Boolean).join(" + ");
}

function agentRuntimeLabel(agent) {
  const type = String(agent?.type || "").trim().toLowerCase();
  const command = String(agent?.command || "").trim().split(/\s+/)[0];
  const base = type === "codex"
    ? "Codex"
    : type === "claude"
      ? "Claude"
      : type === "kimi"
        ? "Kimi"
        : agent?.name || command || agent?.id || "Agent";
  const name = String(agent?.name || "").trim();
  if (name && name !== base && !name.toLowerCase().startsWith(base.toLowerCase())) {
    return `${base} · ${name}`;
  }
  return name || base;
}

function staleRouteNotice(value) {
  return /route:send|recorded pane is missing|Cannot send broadcast|Message may not have been injected/i.test(String(value || ""));
}

function pickActiveAgentId(agentList, currentId = null, minimized = null) {
  const runningAgents = agentList.filter((agent) => agent.enabled && !stoppedOrExited(agent));
  const visibleAgents = minimized ? runningAgents.filter((agent) => !minimized.has(agent.id)) : runningAgents;
  if (currentId && visibleAgents.some((agent) => agent.id === currentId)) {
    return currentId;
  }
  return visibleAgents[0]?.id || null;
}

function minimizedStorageKey(workspaceRoot) {
  return `aiTeams.minimizedAgents:${workspaceRoot || "default"}`;
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
  { id: "all", label: "All" },
  { id: "todo", label: "Todo" },
  { id: "finish", label: "Finish" }
];

function documentStateLabel(document) {
  const state = document?.fields?.state;
  if (state === "finish") return "Finish";
  if (state === "todo") return "Todo";
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

function formatDocumentTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  const sameYear = new Date(now).getFullYear() === date.getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" });
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
          <span className="folder-icon">▣</span>
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

  const stateLabel = documentStateLabel(node);
  const updatedLabel = formatDocumentTime(node.updatedAt);

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
      <button className="document-open" type="button" onClick={() => onOpen(node.path)} title={node.relativePath}>
        <span>{node.name}</span>
        <small>
          {stateLabel ? (
            <>
              <span className={`document-status document-status-${node.fields?.state}`}>
                {stateLabel}
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

function AgentTerminal({ agent, active, hidden, terminalTheme, onFocus, onNotice }) {
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
  const terminalTitle = [
    displayName,
    [agent.backend || "direct-pty", agent.pane].filter(Boolean).join(" ")
  ].filter(Boolean).join(" · ");

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
        <div>
          <div className="terminal-name" title={terminalTitle}>{displayName}</div>
        </div>
        <div className={`status-pill ${statusClass(agent.status)}`} title={statusTitle}>
          <span className="status-dot" />
          {statusLabels[agent.status] || agent.status}
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
  return {
    command: isCodex ? "codex" : "claude",
    argsText: "",
    instructionsFile: isCodex ? "AGENTS.md" : "CLAUDE.md",
    skillsDir: isCodex ? ".codex/skills" : ".claude/skills"
  };
}

function blankRoleForm() {
  return {
    title: "", emoji: "", summary: "", track: "",
    defaultRuntime: "claude", autonomy: "auto",
    runtimes: { claude: blankRuntimeForm("claude"), codex: blankRuntimeForm("codex") },
    model: "", skillsText: "",
    upstreamText: "", downstreamText: "", handoffVia: "", persona: ""
  };
}

function runtimeViewToForm(rt, runtime) {
  if (!rt) return blankRuntimeForm(runtime);
  return {
    command: String(rt.command || (runtime === "codex" ? "codex" : "claude")),
    argsText: (Array.isArray(rt.args) ? rt.args : []).join("\n"),
    instructionsFile: String(rt.instructions_file || (runtime === "codex" ? "AGENTS.md" : "CLAUDE.md")),
    skillsDir: String(rt.skills_dir || (runtime === "codex" ? ".codex/skills" : ".claude/skills"))
  };
}

function detailToForm(detail) {
  const template = detail?.template || {};
  const role = template.role && typeof template.role === "object" ? template.role : {};
  const collab = template.collab && typeof template.collab === "object" ? template.collab : {};
  const detailRuntimes = detail?.runtimes && typeof detail.runtimes === "object" ? detail.runtimes : {};
  return {
    title: String(role.title || ""),
    emoji: String(role.emoji || ""),
    summary: String(role.summary || ""),
    track: String(role.track || ""),
    defaultRuntime: String(detail?.defaultRuntime || "claude"),
    autonomy: String(detail?.autonomy || "auto"),
    runtimes: {
      claude: runtimeViewToForm(detailRuntimes.claude, "claude"),
      codex: runtimeViewToForm(detailRuntimes.codex, "codex")
    },
    model: String(template.model || ""),
    skillsText: (Array.isArray(template.skills) ? template.skills : []).join(", "),
    upstreamText: (Array.isArray(collab.upstream) ? collab.upstream : []).join(", "),
    downstreamText: (Array.isArray(collab.downstream) ? collab.downstream : []).join(", "),
    handoffVia: String(collab.handoff_via || ""),
    persona: String(detail?.persona?.content || "")
  };
}

function OnboardingModal({ api, onClose, onStartTeam }) {
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
    if (item.runnable) return { glyph: "✅", cls: "ok", text: `已安装${item.version ? ` (${item.version})` : ""}` };
    if (item.installed) return { glyph: "⚠️", cls: "warn", text: "已安装但无法运行" };
    return { glyph: "❌", cls: "miss", text: "未检测到" };
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
          >安装指引 ↗</button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="role-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <div className="role-modal onboarding-modal" role="dialog" aria-label="健康检查">
        <div className="role-modal-header">
          <strong>👋 欢迎使用 AI Teams</strong>
          <button type="button" className="role-modal-close" onClick={handleClose} aria-label="关闭">✕</button>
        </div>

        <div className="onboarding-subtitle">本地多 Agent 终端工作台 —— 先确认环境就绪</div>

        {error ? <div className="role-modal-error" onClick={() => setError("")}>{error}</div> : null}

        <div className="role-modal-body onboarding-body">
          {health === null ? (
            <div className="onboarding-loading">正在检测运行环境…</div>
          ) : (
            <>
              <div className="onboarding-section-title">运行环境</div>
              <Row name="tmux" item={tmux} />
              {agents.map((a) => (
                <Row key={a.type} name={a.name || a.type} item={a} />
              ))}
              <div className={`onboarding-hint ${ready ? "onboarding-hint-ok" : "onboarding-hint-warn"}`}>
                {ready ? "环境就绪，可以开始组队。" : "至少需要 tmux + 一个可运行的 Agent CLI。"}
              </div>
            </>
          )}
        </div>

        <div className="onboarding-footer">
          <label className="onboarding-dont-show">
            <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
            下次不再显示
          </label>
          <span className="onboarding-footer-actions">
            <button type="button" className="panel-action" disabled={busy} onClick={runCheck}>{busy ? "检测中…" : "重新检测"}</button>
            <button type="button" className="panel-action onboarding-primary" onClick={startTeam}>开始组队 →</button>
          </span>
        </div>
      </div>
    </div>
  );
}

function RoleConfigModal({ api, roles, onClose, onRolesChanged }) {
  const [tab, setTab] = useState("list");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // import tab
  const [importDest, setImportDest] = useState("workspace");
  const [importId, setImportId] = useState("");
  // edit tab
  const [editing, setEditing] = useState(null); // { id, origin }
  const [form, setForm] = useState(blankRoleForm());
  const [dirty, setDirty] = useState(false);

  const closeGuarded = useCallback(() => {
    if (dirty && !window.confirm("有未保存的修改，确定关闭吗？")) {
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeGuarded();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [closeGuarded]);

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
    setError("");
    try {
      if (!api.pickDirectory || !api.importRole) {
        setError("当前环境不支持导入。");
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
      setError(`已导入：${result?.id || sourcePath}${warn}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openEdit = async (roleId) => {
    setError("");
    setBusy(true);
    try {
      const detail = await api.loadRoleDetail(roleId);
      setEditing({ id: detail.id, origin: detail.origin });
      setForm(detailToForm(detail));
      setDirty(false);
      setTab("edit");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setError("");
    setBusy(true);
    try {
      const payload = {
        role: { title: form.title, emoji: form.emoji, summary: form.summary, track: form.track },
        default_runtime: form.defaultRuntime,
        autonomy: form.autonomy,
        runtimes: {
          claude: {
            command: form.runtimes.claude.command,
            args: linesToArray(form.runtimes.claude.argsText),
            instructions_file: form.runtimes.claude.instructionsFile,
            skills_dir: form.runtimes.claude.skillsDir
          },
          codex: {
            command: form.runtimes.codex.command,
            args: linesToArray(form.runtimes.codex.argsText),
            instructions_file: form.runtimes.codex.instructionsFile,
            skills_dir: form.runtimes.codex.skillsDir
          }
        },
        model: form.model,
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
      setError(`已保存：${result.id}${warn}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeRole = async (roleId, origin) => {
    const isGlobal = origin === "global";
    const prompt = isGlobal
      ? `「${roleId}」是全局 Role，删除会影响所有项目。确定删除吗？`
      : `确定删除 Role「${roleId}」吗？`;
    if (!window.confirm(prompt)) return;
    setError("");
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
      const affected = Array.isArray(result?.affectedAgents) && result.affectedAgents.length
        ? `（${result.affectedAgents.length} 个成员仍引用，需重新分配）`
        : "";
      setError(`已删除：${roleId}${affected}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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

        {error ? <div className="role-modal-error" onClick={() => setError("")}>{error}</div> : null}

        <div className="role-modal-body">
          {tab === "list" ? (
            <div className="role-list">
              {roles.length ? roles.map((role) => (
                <div key={role.id} className="role-list-row">
                  <span className="role-list-main">
                    <span className="role-list-emoji">{role.emoji || "🧩"}</span>
                    <span className="role-list-title">{role.title || role.id}</span>
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
                  <label>标题</label>
                  <input value={form.title} onChange={(event) => updateForm({ title: event.target.value })} />
                </div>
                <div className="role-field role-field-narrow">
                  <label>Emoji</label>
                  <input value={form.emoji} onChange={(event) => updateForm({ emoji: event.target.value })} />
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
                  </select>
                </div>
                <div className="role-field">
                  <label>Autonomy</label>
                  <select value={form.autonomy} onChange={(event) => updateForm({ autonomy: event.target.value })}>
                    <option value="auto">auto（自动）</option>
                    <option value="human">human（需人工）</option>
                  </select>
                </div>
                <div className="role-field">
                  <label>Model（留空=不指定）</label>
                  <input value={form.model} onChange={(event) => updateForm({ model: event.target.value })} placeholder="opus" />
                </div>
              </div>

              {["claude", "codex"].map((rtName) => (
                <div key={rtName} className="role-runtime-block">
                  <div className="role-runtime-title">
                    运行时：{rtName === "claude" ? "Claude" : "Codex"}
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
                  </div>
                  <div className="role-field">
                    <label>Args（一行一个参数）</label>
                    <textarea rows={2} value={form.runtimes[rtName].argsText} onChange={(event) => updateRuntime(rtName, { argsText: event.target.value })} placeholder={rtName === "codex" ? "--dangerously-bypass-approvals-and-sandbox" : "--dangerously-skip-permissions"} />
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
  themeId,
  themes,
  effectsEnabled,
  handoffPath,
  onThemeChange,
  onToggleEffects,
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
  onStartEnabled,
  onStopEnabled,
  onOpen,
  onInsertDocumentPath
}) {
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
            <details className="sidebar-settings">
              <summary
                className="sidebar-icon-button"
                title="Settings"
                aria-label="Settings"
              >
                ⚙
              </summary>
              <div className="settings-menu">
                <label className="workspace-picker theme-picker">
                  <span>Theme</span>
                  <select value={themeId} onChange={(event) => onThemeChange(event.target.value)}>
                    {Object.values(themes).map((themeOption) => (
                      <option key={themeOption.id} value={themeOption.id}>
                        {themeOption.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ambient-toggle" title="Ambient effects">
                  <input
                    type="checkbox"
                    checked={effectsEnabled}
                    onChange={(event) => onToggleEffects(event.target.checked)}
                  />
                  <span>Ambient effects</span>
                </label>
              </div>
            </details>
            <button
              className="sidebar-icon-button sidebar-toggle"
              type="button"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={onToggleCollapsed}
            >
              {collapsed ? ">" : "<"}
            </button>
          </div>
        </div>
        <div className="workspace-control">
          <div className="workspace-label">Project</div>
          <button
            className="workspace-current"
            type="button"
            title={workspace?.name || "Choose project"}
            onClick={onChooseWorkspace}
          >
            <span className="workspace-current-name">{workspace?.name || "Choose project"}</span>
          </button>
          <label className="workspace-picker">
            <span>Recent</span>
            <select
              value=""
              title={recentWorkspaceOptions.length ? "Switch recent project" : "No recent projects"}
              disabled={!recentWorkspaceOptions.length}
              onChange={(event) => onSelectWorkspace(event.target.value)}
            >
              <option value="">{recentWorkspaceOptions.length ? "Switch recent..." : "No recent projects"}</option>
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
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapsed}
          >
            {collapsed ? ">" : "<"}
          </button>
        </div>
      </div>

      <div className="sidebar-bulk-actions" aria-label="Team batch controls">
        <button type="button" onClick={onStartEnabled}>Start</button>
        <button type="button" onClick={onStopEnabled}>Stop</button>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div className="panel-title">Team</div>
          {onImportRole ? (
            <button
              type="button"
              className="panel-action"
              title="导入外部 Agent、查看与编辑 Role 配置"
              onClick={onImportRole}
            >
              配置 Agent
            </button>
          ) : null}
        </div>
        <div className="agent-list">
        {agents.map((agent) => {
          const minimized = agent.enabled && !stoppedOrExited(agent) && minimizedAgents?.has(agent.id);
          const displayName = agentDisplayName(agent);
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
              title={displayName}
            >
              <span className={`agent-dot ${statusClass(agent.status)}`} />
              <span className="agent-main">
                <select
                  className="agent-role-select"
                  value={assignedRoleId}
                  title="Role"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    event.stopPropagation();
                    onAssignRole(agent.id, event.target.value);
                  }}
                >
                  <option value="">Role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {[role.emoji, role.title || role.id].filter(Boolean).join(" ")}
                    </option>
                  ))}
                </select>
                <select
                  className="agent-type-select"
                  value={assignedAgentType}
                  title="Agent"
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
                  <span className="disabled-label">Off</span>
                ) : stoppedOrExited(agent) ? (
                  <button
                    className="icon-button"
                    type="button"
                    title="Start agent"
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
                      title="Stop agent"
                      aria-label={`Stop ${agent.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onStop(agent.id);
                      }}
                    >
                      x
                    </button>
                    <button
                      className="window-control window-control-minimize"
                      type="button"
                      title={minimized ? "Restore panel" : "Minimize panel"}
                      aria-label={minimized ? `Restore ${agent.name} panel` : `Minimize ${agent.name} panel`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleMinimize(agent.id);
                        if (minimized) {
                          onSelectAgent(agent.id);
                        }
                      }}
                    >
                      {minimized ? "+" : "-"}
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
          <div className="panel-title">Docs</div>
          <span>{hasDocumentFilter ? `${filteredDocumentCount}/${documentList.length}` : documentList.length}</span>
        </div>
        <label className="document-search">
          <span>Search docs</span>
          <input
            type="search"
            value={documentSearch}
            placeholder="Search docs"
            onChange={(event) => setDocumentSearch(event.target.value)}
          />
          <select
            value={documentFieldFilter}
            aria-label="Filter docs"
            onChange={(event) => setDocumentFieldFilter(event.target.value)}
          >
            {documentFieldFilters.map((filter) => (
              <option key={filter.id} value={filter.id}>{filter.label}</option>
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
            <div className="document-empty">{hasDocumentFilter ? "No matching docs" : "No docs"}</div>
          )}
        </div>
      </section>
    </aside>
  );
}

const Composer = forwardRef(function Composer({ agents, documents, activeAgentId, taskPath, onTaskPathChange, onRoute }, ref) {
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
  const hasMention = useMemo(() => /@ ?[A-Za-z0-9_-]+/.test(value), [value]);
  const mentionPreview = useMemo(() => {
    const mentions = [...value.matchAll(/@ ?([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
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
    <footer className={["composer", hasMention ? "composer-has-targets" : ""].filter(Boolean).join(" ")}>
      <div className="composer-topline">
        <div className="composer-targets">
          {hasMention ? `Targets: ${mentionPreview.length ? mentionPreview.map((item) => `@${item}`).join(" ") : "none"}` : ""}
        </div>
        <div className="composer-doc-tools" ref={docPickerRef}>
          {attachedDocument ? (
            <span className="attachment-chip" title={`Attached: ${attachedDocument.relativePath}`}>
              <span className="attachment-chip-label">{attachedDocument.name}</span>
              <button
                type="button"
                title="Remove attached doc"
                aria-label="Remove attached doc"
                onClick={() => onTaskPathChange("")}
              >
                x
              </button>
            </span>
          ) : null}
          <button
            className="attach-doc-button"
            type="button"
            title={attachedDocument ? "Change attached doc" : "Attach doc"}
            aria-label={attachedDocument ? "Change attached doc" : "Attach doc"}
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
            <div className="doc-picker-menu" role="dialog" aria-label="Attach doc">
              <input
                className="doc-picker-search"
                type="search"
                value={docQuery}
                placeholder="Search docs"
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
                    No doc
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
                  <div className="doc-picker-empty">No matching docs</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="composer-row">
        <textarea
          ref={textareaRef}
          value={value}
          placeholder={activeAgentId ? `@${activeAgentId} Ask an agent...` : "Mention an agent to send..."}
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
        <button
          className="send-button"
          onClick={submit}
          title="Enter to send, Ctrl/Cmd+Enter for a new line"
          disabled={!canSubmit}
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </footer>
  );
});

function App() {
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
  const [notice, setNotice] = useState("");
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

  useEffect(() => {
    try {
      window.localStorage?.setItem("aiTeams.theme", theme.id);
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }, [theme.id]);

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
      setActiveAgentId(visible[next].id);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [agents, activeAgentId, minimizedAgents]);

  const refreshAgents = useCallback(async () => {
    const nextAgents = await api.listAgents();
    setAgents(nextAgents);
    setActiveAgentId((current) => pickActiveAgentId(nextAgents, current, minimizedAgentsRef.current));
  }, []);

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
    setActiveAgentId(pickActiveAgentId(agentList, null, readMinimizedAgents(workspaceInfo?.root || "")));
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
    });
    const offRouteVerify = api.onRouteVerify?.((payload) => {
      if (payload && payload.verified === false) {
        setNotice(`Message may not have been injected into @${payload.id}; check that agent terminal.`);
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
  }, [loadWorkspaceData, refreshDocuments]);

  useEffect(() => {
    try {
      window.localStorage?.setItem("aiTeams.sidebarCollapsed", sidebarCollapsed ? "true" : "false");
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    setActiveAgentId((current) => pickActiveAgentId(agents, current, minimizedAgents));
  }, [agents, minimizedAgents]);

  useEffect(() => {
    if (!staleRouteNotice(notice)) return;
    const enabled = agents.filter((agent) => agent.enabled);
    if (enabled.length && enabled.every((agent) => !stoppedOrExited(agent))) {
      setNotice("");
    }
  }, [agents, notice]);

  const startAgent = async (agentId) => {
    try {
      clearMinimized([agentId]);
      const state = await api.startAgent(agentId);
      setAgents((current) => current.map((agent) => (agent.id === agentId ? { ...agent, ...state } : agent)));
      setActiveAgentId(agentId);
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
      await api.routeMessage(message, targets, options);
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
        themeId={theme.id}
        themes={themePresets}
        effectsEnabled={effectsEnabled}
        handoffPath={taskPath}
        onThemeChange={setThemeId}
        onToggleEffects={setEffectsEnabled}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        onSelectAgent={(agentId) => {
          const agent = agents.find((item) => item.id === agentId);
          if (agent && !stoppedOrExited(agent)) {
            if (minimizedAgents.has(agentId)) {
              clearMinimized([agentId]);
            }
            setActiveAgentId(agentId);
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
        onStartEnabled={startEnabled}
        onStopEnabled={stopEnabled}
        onOpen={(targetPath) => api.openPath(targetPath)}
        onInsertDocumentPath={insertDocumentPath}
      />
      <main className={`workspace ${notice ? "workspace-has-notice" : ""}`}>
        {notice ? <div className="notice" onClick={() => setNotice("")}>{notice}</div> : null}

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
              onFocus={() => setActiveAgentId(agent.id)}
              onNotice={setNotice}
            />
          ))}
          {!visibleTerminalAgents.length ? (
            <div className="empty-state">
              {minimizedCount
                ? `${minimizedCount} agent panel${minimizedCount > 1 ? "s are" : " is"} minimized. Click an agent in the sidebar to restore it.`
                : enabledAgents.length
                  ? "Start an agent from the sidebar to open its terminal."
                  : "No team slots are configured in AI Teams."}
            </div>
          ) : null}
        </section>

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
root.render(<App />);
