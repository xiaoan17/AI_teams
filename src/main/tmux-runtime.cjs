function parseTmuxPaneTable(stdout) {
  const panes = new Map();
  for (const line of String(stdout || "").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [pane, dead, windowId] = line.split("\t");
    if (pane) {
      panes.set(pane, { dead: dead === "1", windowId });
    }
  }
  return panes;
}

function parseTmuxAgentPaneTable(stdout) {
  const panes = new Map();
  for (const line of String(stdout || "").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [pane, dead, ...rest] = line.split("\t");
    const windowName = rest.at(-1);
    if (pane && windowName && dead === "0" && !panes.has(windowName)) {
      panes.set(windowName, { pane, dead: false });
    }
  }
  return panes;
}

function parseTmuxSessionWindows(stdout) {
  const sessions = new Map();
  for (const line of String(stdout || "").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [sessionName, windowId] = line.split("\t");
    if (sessionName) {
      sessions.set(sessionName, windowId);
    }
  }
  return sessions;
}

function reconcileRuntimePanesFromTable(config, runtime, panesByAgentId, { now = () => new Date().toISOString() } = {}) {
  let changed = false;
  runtime.agents = runtime.agents || {};
  for (const agent of (config.agents || []).filter((item) => item.enabled !== false)) {
    const recovered = panesByAgentId.get(agent.id);
    if (!recovered?.pane) {
      continue;
    }
    const current = runtime.agents[agent.id] || {};
    if (current.pane !== recovered.pane || current.stopped) {
      runtime.agents[agent.id] = {
        ...current,
        pane: recovered.pane,
        stopped: false,
        reason: "",
        recovered_at: now(),
        started_at: current.started_at || now()
      };
      changed = true;
    }
  }
  return { runtime, changed };
}

module.exports = {
  parseTmuxPaneTable,
  parseTmuxAgentPaneTable,
  parseTmuxSessionWindows,
  reconcileRuntimePanesFromTable
};
