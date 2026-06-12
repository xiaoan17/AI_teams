import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

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
              pinned: true
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
        pinned: true
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
  onAgentData: () => () => {},
  onAgentStatus: () => () => {},
  onRouteVerify: () => () => {},
  onWorkspaceChanged: () => () => {}
};

const api = window.aiTeams || browserPreviewApi;

function filterTerminalInput(data) {
  return String(data || "")
    .replace(/\x1b\[(?:I|O)/g, "")
    .replace(/\x1b\[M[\s\S]{0,3}/g, "")
    .replace(/\x1b\[<[\d;]*[mM]/g, "")
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1bP[\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[\??[0-9;]*[Rc]/g, "");
}

const terminalMouseModeParams = new Set([
  "9",
  "1000",
  "1001",
  "1002",
  "1003",
  "1004",
  "1005",
  "1006",
  "1015"
]);
const terminalMouseModeReset = `\x1b[?${[...terminalMouseModeParams].join(";")}l`;

function incompleteEscapeStart(value) {
  const escapeIndex = value.lastIndexOf("\x1b");
  if (escapeIndex === -1) return -1;
  const tail = value.slice(escapeIndex);
  if (tail === "\x1b") return escapeIndex;
  if (tail.startsWith("\x1b[")) {
    for (let index = 2; index < tail.length; index += 1) {
      const code = tail.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return -1;
    }
    return escapeIndex;
  }
  if ((tail.startsWith("\x1b]") || tail.startsWith("\x1bP")) && !tail.includes("\x07") && !tail.includes("\x1b\\")) {
    return escapeIndex;
  }
  return -1;
}

function completeTerminalOutput(data, pendingRef) {
  const value = `${pendingRef.current || ""}${data || ""}`;
  const pendingStart = incompleteEscapeStart(value);
  if (pendingStart === -1) {
    pendingRef.current = "";
    return value;
  }
  pendingRef.current = value.slice(pendingStart);
  return value.slice(0, pendingStart);
}

function filterTerminalOutput(data, pendingRef) {
  return completeTerminalOutput(String(data || ""), pendingRef).replace(/\x1b\[\?([0-9;]*)([hl])/g, (match, params, action) => {
    if (action !== "h") return match;
    if (!params) return match;
    const keptParams = params.split(";").filter((param) => param && !terminalMouseModeParams.has(param));
    return keptParams.length ? `\x1b[?${keptParams.join(";")}${action}` : "";
  });
}

function resetTerminalMouseModes(terminal) {
  try {
    terminal.write(terminalMouseModeReset);
  } catch {
    // Selection should stay best-effort if the terminal is already disposed.
  }
}

function snapshotToTerminalData(data) {
  return `\x1bc${String(data || "").replace(/\r?\n/g, "\r\n")}`;
}

const statusLabels = {
  stopped: "Stopped",
  starting: "Starting",
  running_or_idle: "Ready",
  waiting_input: "Needs Input",
  exited: "Exited",
  error: "Error",
  missing_runtime: "Missing Runtime",
  pane_missing: "Pane Missing"
};

function statusClass(status) {
  if (status === "waiting_input") return "status-waiting";
  if (status === "running_or_idle" || status === "starting") return "status-running";
  if (status === "exited" || status === "error" || status === "missing_runtime" || status === "pane_missing") return "status-error";
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

function nodeMatchesSearch(node, query) {
  if (!query) return true;
  return [
    node.name,
    node.relativePath,
    node.folder ? documentDisplayPath(node) : "",
    node.path
  ].some((value) => String(value || "").toLowerCase().includes(query));
}

function filterDocumentTree(node, query) {
  if (!node) return null;
  if (!query) return node;
  const matchesNode = nodeMatchesSearch(node, query);
  if (node.type === "document") {
    return matchesNode ? node : null;
  }
  if (matchesNode) {
    return node;
  }
  const children = (node.children || [])
    .map((child) => filterDocumentTree(child, query))
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
  return date.toLocaleString();
}

function DocumentTreeNode({
  node,
  depth = 0,
  expandedFolders,
  forceExpanded,
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

  return (
    <div className={`tree-row document-row ${node.pinned ? "document-row-pinned" : ""}`} style={{ "--tree-depth": depth }}>
      <button className="document-open" type="button" onClick={() => onOpen(node.path)} title={node.relativePath}>
        <span>{node.name}</span>
        <small>
          {node.pinned ? "Pinned · " : ""}
          {documentDisplayPath(node)} · {formatDocumentTime(node.updatedAt)}
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

function AgentTerminal({ agent, active, hidden, onFocus, onNotice }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const scheduleResizeRef = useRef(null);
  const scheduleRefreshRef = useRef(null);
  const writeOutputRef = useRef(null);
  const lastSeqRef = useRef(0);
  const pendingOutputRef = useRef([]);
  const pendingTerminalOutputRef = useRef("");
  const snapshotReadyRef = useRef(false);
  const outputWriteDepthRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    let disposed = false;
    let resizeFrame = 0;
    let refreshFrame = 0;
    let lastResizeKey = "";
    lastSeqRef.current = 0;
    pendingOutputRef.current = [];
    pendingTerminalOutputRef.current = "";
    snapshotReadyRef.current = false;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.2,
      macOptionClickForcesSelection: true,
      rescaleOverlappingGlyphs: true,
      scrollback: 8000,
      theme: {
        background: "#0d1114",
        foreground: "#d9e0e8",
        cursor: "#f2c14e",
        selectionBackground: "#29445d"
      }
    });
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
      outputWriteDepthRef.current += 1;
      terminal.write(visibleData, () => {
        outputWriteDepthRef.current = Math.max(0, outputWriteDepthRef.current - 1);
        resetTerminalMouseModes(terminal);
        refreshViewport();
      });
      return true;
    };
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    resetTerminalMouseModes(terminal);
    terminal.attachCustomWheelEventHandler((event) => {
      const lineHeight = Math.max(
        1,
        terminal.element?.querySelector(".xterm-rows > div")?.getBoundingClientRect().height || 15
      );
      const pageLines = Math.max(1, terminal.rows - 1);
      const rawLines = event.deltaMode === 1
        ? event.deltaY
        : event.deltaMode === 2
          ? event.deltaY * pageLines
          : event.deltaY / lineHeight;
      const lines = Math.trunc(rawLines) || Math.sign(rawLines);
      if (lines) {
        api.scrollAgent(agent.id, lines).then((handled) => {
          if (!handled) {
            terminal.scrollLines(lines);
            refreshViewport();
          }
        }).catch(() => {
          terminal.scrollLines(lines);
          refreshViewport();
        });
        refreshViewport();
      }
      event.preventDefault();
      event.stopPropagation();
      return false;
    });
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
      if (outputWriteDepthRef.current > 0) {
        return;
      }
      if (!agent.pane || stoppedOrExited(agent)) {
        return;
      }
      const filteredData = filterTerminalInput(data);
      if (!filteredData) {
        return;
      }
      api.sendInput(agent.id, filteredData).catch((error) => {
        onNotice?.(`${agent.name}: ${error.message}`);
      });
    });
    termRef.current = terminal;
    fitRef.current = fitAddon;
    scheduleResizeRef.current = scheduleResize;
    scheduleRefreshRef.current = refreshViewport;
    writeOutputRef.current = writeOutput;

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
          writeOutput(pending.data);
          if (pending.seq) {
            lastSeqRef.current = pending.seq;
          }
        }
        pendingOutputRef.current = [];
        scheduleResize();
      } catch (error) {
        if (!disposed) {
          onNotice?.(`Could not restore ${agent.name} terminal output: ${error.message}`);
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
      resizeTimers.forEach((timer) => clearTimeout(timer));
      observer.disconnect();
      window.removeEventListener("resize", scheduleResize);
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
      scheduleResizeRef.current = null;
      scheduleRefreshRef.current = null;
      writeOutputRef.current = null;
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
          pendingOutputRef.current.push({ data, seq });
          return;
        }
        if (seq && seq <= lastSeqRef.current) {
          return;
        }
        const didWrite = writeOutputRef.current?.(data);
        if (!didWrite) {
          return;
        }
        if (seq) {
          lastSeqRef.current = seq;
        }
      }
    });
    return off;
  }, [agent.id]);

  return (
    <section
      className={`terminal-card ${active ? "terminal-card-active" : ""} ${hidden ? "terminal-card-hidden" : ""}`}
      onPointerDownCapture={onFocus}
      onClick={onFocus}
    >
      <header className="terminal-header">
        <div>
          <div className="terminal-name">{agent.name}</div>
          <div className="terminal-meta">
            {agent.backend || "direct-pty"}
            {agent.pane ? ` ${agent.pane}` : ""}
          </div>
        </div>
        <div className={`status-pill ${statusClass(agent.status)}`}>
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
  onToggleCollapsed,
  onSelectAgent,
  onSelectWorkspace,
  onChooseWorkspace,
  onToggleDocumentPinned,
  onStart,
  onStop,
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
  const [expandedFolders, setExpandedFolders] = useState(() => defaultExpandedFolders(documentList));
  const searchQuery = normalizeSearch(documentSearch);
  const filteredTree = useMemo(() => filterDocumentTree(documentTree, searchQuery), [documentTree, searchQuery]);

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
          <div className="brand-mark">AT</div>
          <div className="brand-copy">
            <h1>AI Teams</h1>
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
        <div className="brand-mark">AT</div>
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
        <button type="button" onClick={onStopEnabled}>End</button>
      </div>

      <section className="panel">
        <div className="panel-title">Agents</div>
        <div className="agent-list">
        {agents.map((agent) => {
          const minimized = agent.enabled && !stoppedOrExited(agent) && minimizedAgents?.has(agent.id);
          return (
            <button
              key={agent.id}
              className={[
                "agent-row",
                activeAgentId === agent.id ? "agent-row-active" : "",
                !agent.enabled ? "agent-row-disabled" : "",
                minimized ? "agent-row-minimized" : ""
              ].filter(Boolean).join(" ")}
              onClick={() => onSelectAgent(agent.id)}
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
                  <span
                    className="icon-button"
                    role="button"
                    tabIndex={0}
                    title="Start agent"
                    onClick={(event) => {
                      event.stopPropagation();
                      onStart(agent.id);
                    }}
                  >
                    ▶
                  </span>
                ) : (
                  <>
                    <span
                      className="window-control window-control-close"
                      role="button"
                      tabIndex={0}
                      title="Stop agent"
                      aria-label={`Stop ${agent.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onStop(agent.id);
                      }}
                    >
                      x
                    </span>
                    <span
                      className={[
                        "window-control",
                        "window-control-minimize",
                        minimized ? "window-control-muted" : ""
                      ].filter(Boolean).join(" ")}
                      role="button"
                      tabIndex={0}
                      title={minimized ? "Panel is minimized" : "Minimize panel"}
                      aria-label={minimized ? `${agent.name} panel is minimized` : `Minimize ${agent.name} panel`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!minimized) {
                          onToggleMinimize(agent.id);
                        }
                      }}
                    >
                      -
                    </span>
                    <span
                      className={[
                        "window-control",
                        "window-control-expand",
                        minimized ? "window-control-emphasis" : ""
                      ].filter(Boolean).join(" ")}
                      role="button"
                      tabIndex={0}
                      title={minimized ? "Restore panel" : "Focus panel"}
                      aria-label={minimized ? `Restore ${agent.name} panel` : `Focus ${agent.name} panel`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (minimized) {
                          onToggleMinimize(agent.id);
                        }
                        onSelectAgent(agent.id);
                      }}
                    >
                      □
                    </span>
                  </>
                )}
              </span>
            </button>
          );
        })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div className="panel-title">Files</div>
          <span>{documentList.length}</span>
        </div>
        <label className="document-search">
          <span>Search files</span>
          <input
            type="search"
            value={documentSearch}
            placeholder="Search files"
            onChange={(event) => setDocumentSearch(event.target.value)}
          />
        </label>
        <div className="document-tree" role="tree" aria-label="Project documents">
          {filteredTree ? (
            <DocumentTreeNode
              node={filteredTree}
              expandedFolders={expandedFolders}
              forceExpanded={Boolean(searchQuery)}
              onToggleFolder={toggleFolder}
              onOpen={onOpen}
              onInsertDocumentPath={onInsertDocumentPath}
              onToggleDocumentPinned={onToggleDocumentPinned}
            />
          ) : (
            <div className="document-empty">{searchQuery ? "No matching files" : "No documents"}</div>
          )}
        </div>
      </section>
    </aside>
  );
}

const Composer = forwardRef(function Composer({ agents, documents, activeAgentId, onRoute }, ref) {
  const [value, setValue] = useState("");
  const [taskPath, setTaskPath] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const pendingCursorRef = useRef(null);
  const composingRef = useRef(false);
  const documentList = documents?.documents || [];
  const enabledAgents = useMemo(() => agents.filter((agent) => agent.enabled), [agents]);
  const hasMention = useMemo(() => /@ ?[A-Za-z0-9_-]+/.test(value), [value]);
  const mentionPreview = useMemo(() => {
    const mentions = [...value.matchAll(/@ ?([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
    const hasAll = mentions.some((m) => m.toLowerCase() === "all");
    if (hasAll) return enabledAgents.map((agent) => agent.id);
    if (mentions.length) return mentions;
    return activeAgentId ? [activeAgentId] : [];
  }, [activeAgentId, enabledAgents, value]);

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    const explicitTargets = hasMention ? [] : activeAgentId ? [activeAgentId] : [];
    setSending(true);
    try {
      await onRoute(trimmed, explicitTargets, taskPath ? { taskPath } : {});
      setValue("");
      selectionRef.current = { start: 0, end: 0 };
    } finally {
      setSending(false);
    }
  }, [activeAgentId, hasMention, onRoute, sending, taskPath, value]);

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

  useEffect(() => {
    if (taskPath && !documentList.some((document) => document.path === taskPath)) {
      setTaskPath("");
    }
  }, [documentList, taskPath]);

  return (
    <footer className="composer">
      <div className="composer-targets">
        Routes to: {mentionPreview.length ? mentionPreview.map((item) => `@${item}`).join(" ") : "none"}
      </div>
      <div className="composer-options">
        <label>
          Handoff
          <select value={taskPath} onChange={(event) => setTaskPath(event.target.value)}>
            <option value="">No document</option>
            {documentList.map((document) => (
              <option key={document.path} value={document.path}>
                {document.pinned ? "★ " : ""}
                {documentFolderLabel(document.folder)}/{document.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="composer-row">
        <textarea
          ref={textareaRef}
          value={value}
          placeholder={activeAgentId ? `@${activeAgentId} Ask an agent...` : "@all Ask the team..."}
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
          disabled={sending}
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
      setNotice("");
    } catch (error) {
      setNotice(error.message);
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
    <div className={`app-shell ${sidebarCollapsed ? "app-shell-sidebar-collapsed" : ""}`}>
      <Sidebar
        workspace={workspace}
        agents={agents}
        documents={documents}
        activeAgentId={activeAgentId}
        minimizedAgents={minimizedAgents}
        collapsed={sidebarCollapsed}
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
                    <>
                      No agents are configured in AI Teams.
                    </>
                  )}
            </div>
          ) : null}
        </section>

        <Composer ref={composerRef} agents={runningAgents} documents={documents} activeAgentId={activeAgentId} onRoute={route} />
      </main>
    </div>
  );
}

const rootElement = document.getElementById("root");
const root = rootElement.__aiTeamsRoot || createRoot(rootElement);
rootElement.__aiTeamsRoot = root;
root.render(<App />);
