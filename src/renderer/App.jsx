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
  resetTerminalMouseModes,
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
  routeMessage: async (message, targets) => ({ targets: targets.length ? targets : ["codex"], message }),
  openPath: async () => {},
  openExternal: async () => true,
  listAgentPresets: async () => [
    { id: "codex", name: "Codex", command: "codex", args: [], cwd: ".", enabled: true, provider: "openai", versionArgs: ["--version"], docUrl: "https://github.com/openai/codex" },
    { id: "claude", name: "Claude Code", command: "claude", args: [], cwd: ".", enabled: true, provider: "anthropic", versionArgs: ["--version"], docUrl: "https://docs.claude.com/claude-code" },
    { id: "kimi", name: "Kimi", command: "kimi", args: [], cwd: ".", enabled: true, provider: "moonshot", versionArgs: ["--version"], docUrl: "https://platform.moonshot.cn" },
    { id: "gemini", name: "Gemini CLI", command: "gemini", args: [], cwd: ".", enabled: true, provider: "google", versionArgs: ["--version"], docUrl: "https://github.com/google-gemini/gemini-cli" }
  ],
  detectAgents: async () => [
    { type: "codex", name: "Codex", command: "codex", provider: "openai", installed: true, runnable: true, version: "0.1.0", path: "/usr/local/bin/codex", source: "path", diagnostic: null, docUrl: "https://github.com/openai/codex" },
    { type: "claude", name: "Claude Code", command: "claude", provider: "anthropic", installed: true, runnable: true, version: "1.2.3", path: "/usr/local/bin/claude", source: "path", diagnostic: null, docUrl: "https://docs.claude.com/claude-code" },
    { type: "kimi", name: "Kimi", command: "kimi", provider: "moonshot", installed: false, runnable: false, version: null, path: null, source: null, diagnostic: null, docUrl: "https://platform.moonshot.cn" },
    { type: "gemini", name: "Gemini CLI", command: "gemini", provider: "google", installed: true, runnable: false, version: null, path: "/usr/local/bin/gemini", source: "path", diagnostic: "spawn error (preview)", docUrl: "https://github.com/google-gemini/gemini-cli" }
  ],
  importAgents: async (payload, options = {}) => {
    const PREVIEW_PRESET_COMMANDS = { codex: "codex", claude: "claude", kimi: "kimi", gemini: "gemini" };
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
  removeAgent: async (agentId) => ({ ok: true, removed: agentId, remaining: [] }),
  // Emit small sample output in browser preview without real agents.
  onAgentData: (callback) => {
    const timer = setInterval(() => callback({ id: "codex", data: "·" }), 1400);
    return () => clearInterval(timer);
  },
  onAgentStatus: () => () => {},
  onRouteVerify: () => () => {},
  onWorkspaceChanged: () => () => {}
};

const api = window.aiTeams || browserPreviewApi;

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
  const terminalThemeRef = useRef(terminalTheme);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    let disposed = false;
    let resizeFrame = 0;
    let refreshFrame = 0;
    let lastResizeKey = "";
    lastSeqRef.current = 0;
    pendingOutputRef.current = [];
    pendingOutputCharsRef.current = 0;
    pendingTerminalOutputRef.current = "";
    pendingWriteTextRef.current = "";
    pendingWriteSeqRef.current = 0;
    writeFrameRef.current = 0;
    snapshotReadyRef.current = false;
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
          resetTerminalMouseModes(terminal);
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
      // terminal.write already schedules xterm's own incremental (dirty-region)
      // render. Do not force a full clearTextureAtlas/refresh here — that is the
      // flicker source. Mouse-mode-enabling sequences from agent output are
      // already stripped by filterTerminalOutput, and resetTerminalMouseModes
      // still runs on init/resize/theme via refreshViewport as a safety net.
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
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    const wheelTarget = containerRef.current;
    const onWheelCapture = (event) => handleTerminalWheel(event, terminal);
    wheelTarget?.addEventListener("wheel", onWheelCapture, { capture: true, passive: false });
    resetTerminalMouseModes(terminal);
    const fitAndSync = () => {
      if (disposed || !containerRef.current || !termRef.current) return;
      const box = containerRef.current.getBoundingClientRect();
      if (box.width < 20 || box.height < 20) return;
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const resizeKey = `${terminal.cols}x${terminal.rows}`;
      if (resizeKey !== lastResizeKey) {
        lastResizeKey = resizeKey;
        api.resizeAgent(agent.id, terminal.cols, terminal.rows).catch(() => {});
      }
      refreshViewport();
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
    scheduleResize();
    const restoreSnapshot = async () => {
      try {
        scheduleResize();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        fitAndSync();
        const snapshot = await api.getAgentSnapshot(agent.id);
        if (disposed || !termRef.current) return;
        if (snapshot?.data) {
          if (snapshot.truncated) {
            onNotice?.(`Showing recent ${agent.name} terminal output; older output is in the session log.`);
          }
          writeOutput(snapshotToTerminalData(snapshot.data));
        }
        lastSeqRef.current = snapshot?.seq || 0;
        snapshotReadyRef.current = true;
        for (const pending of pendingOutputRef.current) {
          if (pending.seq && pending.seq <= lastSeqRef.current) continue;
          queueOutput(pending.data, pending.seq);
        }
        pendingOutputRef.current = [];
        pendingOutputCharsRef.current = 0;
        scheduleResize();
      } catch (error) {
        if (!disposed) {
          onNotice?.(`Could not restore ${agent.name} terminal output: ${error.message}`);
          // writeOutput → filterTerminalOutput mutates pendingTerminalOutputRef
          // (it stashes a trailing incomplete escape). If terminal.write threw
          // mid-restore, that ref keeps a dangling escape fragment that would
          // corrupt parsing of the next live chunk. Reset it so live output
          // starts from a clean parser state.
          pendingTerminalOutputRef.current = "";
          snapshotReadyRef.current = true;
        }
      }
    };
    restoreSnapshot();
    const resizeTimers = [50, 250, 700].map((delay) => setTimeout(scheduleResize, delay));
    return () => {
      disposed = true;
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
  }, [agent.backend, agent.id, agent.name, agent.pane, agent.rawLog, onNotice]);

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
        if (!snapshotReadyRef.current) {
          const text = String(data || "");
          pendingOutputRef.current.push({ data: text, seq });
          pendingOutputCharsRef.current += text.length;
          pendingOutputCharsRef.current = trimPendingOutputQueue(pendingOutputRef.current, pendingOutputCharsRef.current);
          return;
        }
        if (seq && seq <= lastSeqRef.current) {
          return;
        }
        writeOutputRef.current?.(data, seq);
      }
    });
    return off;
  }, [agent.id]);

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
  const terminalTitle = [
    agent.name,
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
          <div className="terminal-name" title={terminalTitle}>{agent.name}</div>
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

function Sidebar({
  workspace,
  agents,
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
  onOpenImport,
  onToggleCollapsed,
  onSelectAgent,
  onSelectWorkspace,
  onChooseWorkspace,
  onToggleDocumentPinned,
  onStart,
  onStop,
  onRemove,
  onToggleMinimize,
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

      <div className="sidebar-bulk-actions" aria-label="Agent batch controls">
        <button type="button" onClick={onStartEnabled}>Start</button>
        <button type="button" onClick={onStopEnabled}>Stop</button>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div className="panel-title">Agents</div>
          <button className="panel-action" type="button" title="Import agents" onClick={onOpenImport}>
            Import
          </button>
        </div>
        <div className="agent-list">
        {agents.map((agent) => {
          const minimized = agent.enabled && !stoppedOrExited(agent) && minimizedAgents?.has(agent.id);
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
              title={agent.name}
            >
              <span className={`agent-dot ${statusClass(agent.status)}`} />
              <span className="agent-main">
                <span>{agent.name}</span>
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
                <button
                  className="icon-button agent-remove"
                  type="button"
                  title="Remove agent from config"
                  aria-label={`Remove ${agent.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(agent.id);
                  }}
                >
                  🗑
                </button>
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

const IMPORT_JSON_PLACEHOLDER = `{
  "agents": [
    {
      "id": "my-agent",
      "name": "My Agent",
      "command": "my-agent-cli",
      "args": [],
      "cwd": ".",
      "enabled": true
    }
  ]
}`;

const MAX_AGENTS = 3;

function AgentImportModal({ onClose, onImported, onNotice, existingCount = 0, existingIds = [] }) {
  const [source, setSource] = useState("preset");
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("");
  const [detections, setDetections] = useState([]);
  const [jsonText, setJsonText] = useState("");
  const [review, setReview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const atLimit = existingCount >= MAX_AGENTS;

  useEffect(() => {
    let mounted = true;
    Promise.all([
      Promise.resolve().then(() => api.listAgentPresets?.() || []),
      Promise.resolve().then(() => api.detectAgents?.() || [])
    ])
      .then(([list, detected]) => {
        if (!mounted) return;
        setPresets(Array.isArray(list) ? list : []);
        setDetections(Array.isArray(detected) ? detected : []);
        // Prefer defaulting to a type that is actually runnable on this machine.
        const runnableId = Array.isArray(detected)
          ? detected.find((item) => item.runnable)?.type
          : "";
        setPresetId((current) => current || runnableId || list?.[0]?.id || "");
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const detectionByType = useMemo(() => {
    const map = new Map();
    for (const item of detections) {
      map.set(item.type, item);
    }
    return map;
  }, [detections]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const buildPayload = useCallback(() => {
    if (source === "preset") {
      const preset = presets.find((item) => item.id === presetId);
      if (!preset) throw new Error("Choose an agent type first.");
      // Build an instance from the picked type: generate a unique instance id like
      // claude-1 / claude-2, derive a numbered display name, and let the main process
      // inherit command/args from the type. This is what allows duplicates of one type.
      const taken = new Set(existingIds);
      let n = 1;
      let instanceId = `${preset.id}-${n}`;
      while (taken.has(instanceId)) {
        n += 1;
        instanceId = `${preset.id}-${n}`;
      }
      return {
        agents: [
          {
            id: instanceId,
            type: preset.id,
            name: `${preset.name} #${n}`
          }
        ]
      };
    }
    const text = jsonText.trim();
    if (!text) throw new Error("Paste an agent config JSON first.");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      throw new Error(`Invalid JSON: ${parseError.message}`);
    }
    return parsed;
  }, [existingIds, jsonText, presetId, presets, source]);

  const reviewDraft = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const payload = buildPayload();
      const result = await api.importAgents(payload, { dryRun: true });
      setReview({ payload, ...result });
    } catch (reviewError) {
      setReview(null);
      setError(reviewError.message);
    } finally {
      setBusy(false);
    }
  }, [buildPayload]);

  const confirmImport = useCallback(async () => {
    if (!review?.ok || !review.payload) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.importAgents(review.payload, {});
      onNotice?.(
        result?.imported?.length
          ? `Imported ${result.imported.map((id) => `@${id}`).join(" ")}. Start them from the sidebar when ready.`
          : ""
      );
      onImported();
    } catch (importError) {
      setError(importError.message);
    } finally {
      setBusy(false);
    }
  }, [onImported, onNotice, review]);

  const invalidateReview = () => {
    setReview(null);
    setError("");
  };

  return (
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Import agents">
        <header className="modal-header">
          <div className="modal-title">Import agents</div>
          <button className="sidebar-icon-button" type="button" aria-label="Close" onClick={onClose}>
            x
          </button>
        </header>
        <div className="modal-body">
          <div className="import-tabs" role="tablist" aria-label="Import source">
            {[
              { id: "preset", label: "Preset" },
              { id: "json", label: "Local JSON" }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={source === tab.id}
                className={source === tab.id ? "import-tab-active" : ""}
                onClick={() => {
                  setSource(tab.id);
                  invalidateReview();
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {source === "preset" ? (
            <>
              <label className="import-field">
                <span>Agent type</span>
                <select
                  value={presetId}
                  onChange={(event) => {
                    setPresetId(event.target.value);
                    invalidateReview();
                  }}
                >
                  {presets.map((preset) => {
                    const detection = detectionByType.get(preset.id);
                    const dot = !detection || !detection.installed ? "○" : detection.runnable ? "●" : "◐";
                    return (
                      <option key={preset.id} value={preset.id}>
                        {dot} {preset.name} ({preset.command})
                        {detection?.version ? ` · v${detection.version}` : ""}
                        {detection && !detection.installed ? " · 未安装" : ""}
                        {detection?.installed && !detection.runnable ? " · 无法运行" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              {(() => {
                const detection = detectionByType.get(presetId);
                if (!detection) return null;
                if (detection.runnable) {
                  return (
                    <div className="import-detect import-detect-ok">
                      ● 已检测到{detection.version ? ` v${detection.version}` : ""}
                      {detection.source && detection.source !== "path" ? `（来源：${detection.source}）` : ""}
                      {detection.path ? <div className="import-detect-path"><code>{detection.path}</code></div> : null}
                    </div>
                  );
                }
                if (detection.installed) {
                  return (
                    <div className="import-detect import-detect-warn">
                      ◐ 已安装但无法运行：{detection.diagnostic || "未知错误"}
                    </div>
                  );
                }
                return (
                  <div className="import-detect import-detect-missing">
                    ○ 本机未检测到 <code>{detection.command}</code>。
                    {detection.docUrl ? (
                      <>
                        {" "}
                        <a
                          href="#"
                          onClick={(event) => {
                            event.preventDefault();
                            api.openExternal?.(detection.docUrl);
                          }}
                        >
                          查看安装指引
                        </a>
                      </>
                    ) : null}
                  </div>
                );
              })()}
            </>
          ) : (
            <label className="import-field">
              <span>Agent config JSON</span>
              <textarea
                value={jsonText}
                placeholder={IMPORT_JSON_PLACEHOLDER}
                spellCheck={false}
                onChange={(event) => {
                  setJsonText(event.target.value);
                  invalidateReview();
                }}
              />
            </label>
          )}

          <div className="import-hint">
            Imported agents are saved as drafts in your agent config and never start automatically. Unknown
            fields are kept as-is and ignored by the app.
            <div className="import-hint-limit">
              当前已配置 {existingCount} / {MAX_AGENTS} 个 agent。同类型可重复添加（如两个 Claude），最多 {MAX_AGENTS} 个。
            </div>
          </div>

          {atLimit ? (
            <div className="modal-error">已达到上限：最多配置 {MAX_AGENTS} 个 agent。请先在侧边栏移除一个再添加。</div>
          ) : null}
          {review?.limitError ? <div className="modal-error">{review.limitError}</div> : null}

          {review?.agents?.length ? (
            <div className="import-review">
              {review.agents.map((agent, index) => (
                <div className="import-review-item" key={`${agent.id || "agent"}:${index}`}>
                  <h4>
                    {agent.name || agent.id || "(missing id)"}
                    {agent.enabled === false ? " · disabled" : ""}
                  </h4>
                  <div className="import-review-line">
                    Command: <code>{[agent.command, ...(agent.args || [])].filter(Boolean).join(" ") || "—"}</code>
                  </div>
                  <div className="import-review-line">CWD: <code>{agent.cwd || "."}</code></div>
                  {(agent.errors || []).map((message, errorIndex) => (
                    <div className="import-error" key={`error:${errorIndex}`}>✗ {message}</div>
                  ))}
                  {(agent.warnings || []).map((message, warningIndex) => (
                    <div className="import-warning" key={`warning:${warningIndex}`}>⚠ {message}</div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {error ? <div className="modal-error">{error}</div> : null}
        </div>
        <footer className="modal-footer">
          <button className="modal-button" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="modal-button"
            type="button"
            onClick={reviewDraft}
            disabled={busy || atLimit}
            title={atLimit ? `最多配置 ${MAX_AGENTS} 个 agent` : "Validate the draft"}
          >
            Review
          </button>
          <button
            className="modal-button modal-button-primary"
            type="button"
            onClick={confirmImport}
            disabled={busy || atLimit || !review?.ok}
            title={atLimit ? `最多配置 ${MAX_AGENTS} 个 agent` : review?.ok ? "Save to agent config" : "Review the draft first"}
          >
            Import
          </button>
        </footer>
      </div>
    </div>
  );
}

function App() {
  const [workspace, setWorkspace] = useState(null);
  const [agents, setAgents] = useState([]);
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
  const [importOpen, setImportOpen] = useState(false);

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

      // A modal owns the keyboard while open; don't cycle behind it.
      if (importOpen) return;

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
  }, [agents, activeAgentId, minimizedAgents, importOpen]);

  const refreshAgents = useCallback(async () => {
    const nextAgents = await api.listAgents();
    setAgents(nextAgents);
    setActiveAgentId((current) => pickActiveAgentId(nextAgents, current, minimizedAgentsRef.current));
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    const [workspaceInfo, documentInfo, agentList] = await Promise.all([
      api.getWorkspace(),
      api.listDocuments(""),
      api.listAgents()
    ]);
    setWorkspace(workspaceInfo);
    setDocuments(documentInfo);
    setAgents(agentList);
    setActiveAgentId(pickActiveAgentId(agentList, null, readMinimizedAgents(workspaceInfo?.root || "")));
    return { workspaceInfo, documentInfo, agentList };
  }, []);

  const refreshDocuments = useCallback(async () => {
    const nextDocuments = await api.listDocuments("");
    setDocuments(nextDocuments);
    return nextDocuments;
  }, []);

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
    return () => {
      mounted = false;
      offStatus();
      offRouteVerify();
      offWorkspace();
      offDocumentsChanged();
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

  const removeAgent = async (agentId) => {
    const target = agents.find((agent) => agent.id === agentId);
    const label = target?.name || agentId;
    const confirmed = typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm(`确认从配置中移除「${label}」？运行中的会先停止，可之后重新添加。`)
      : true;
    if (!confirmed) return;
    try {
      clearMinimized([agentId]);
      await api.removeAgent?.(agentId);
      await refreshAgents();
      setNotice(`已移除 @${agentId}。`);
    } catch (error) {
      setNotice(error.message);
    }
  };

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
        onOpenImport={() => setImportOpen(true)}
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
        onRemove={removeAgent}
        onToggleMinimize={toggleAgentMinimized}
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
                  : (
                    <div className="empty-state-actions">
                      <div>No agents are configured in AI Teams.</div>
                      <button className="empty-import" type="button" onClick={() => setImportOpen(true)}>
                        Import agent
                      </button>
                    </div>
                  )}
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
      {importOpen ? (
        <AgentImportModal
          existingCount={agents.length}
          existingIds={agents.map((agent) => agent.id)}
          onClose={() => setImportOpen(false)}
          onNotice={setNotice}
          onImported={() => {
            setImportOpen(false);
            refreshAgents().catch((error) => setNotice(error.message));
          }}
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
