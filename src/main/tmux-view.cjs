const { execFile } = require("child_process");

const DEFAULT_REATTACH_DELAYS = [500, 1000, 2000, 4000, 4000];
const TMUX_COMMAND_TIMEOUT_MS = Math.max(500, Number(process.env.AITEAMS_TMUX_COMMAND_TIMEOUT_MS || 3000));
const TMUX_COMMAND_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function runTmuxAsync(args, options = {}) {
  const check = options.check !== false;
  return new Promise((resolve, reject) => {
    const child = execFile("tmux", args, {
      encoding: "utf8",
      input: options.input,
      timeout: options.timeout || TMUX_COMMAND_TIMEOUT_MS,
      maxBuffer: options.maxBuffer || TMUX_COMMAND_MAX_BUFFER_BYTES
    }, (error, stdout = "", stderr = "") => {
      if (error) {
        const status = Number.isFinite(error.code) ? error.code : 1;
        const result = { status, stdout: String(stdout || ""), stderr: String(stderr || "") };
        if (check) {
          const timedOut = error.signal ? `signal=${error.signal}` : "";
          const detail = result.stderr.trim() || result.stdout.trim() || [error.message, timedOut].filter(Boolean).join(" ");
          reject(new Error(`tmux ${args.join(" ")} failed: ${detail}`));
          return;
        }
        resolve(result);
        return;
      }
      resolve({ status: 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}

function viewSessionName(baseSession, agentId) {
  return `${baseSession}-view-${agentId}`;
}

function appendBoundedText(current, data, limit) {
  const next = `${current || ""}${data || ""}`;
  if (next.length <= limit) {
    return { text: next, truncated: false };
  }
  return { text: next.slice(-limit), truncated: true };
}

function normalizePasteMessage(message) {
  return String(message || "").replace(/\r\n/g, "\r").replace(/\n/g, "\r");
}

function safeDispose(disposable) {
  try {
    disposable?.dispose?.();
  } catch (_error) {
    // Best effort cleanup for node-pty event subscriptions.
  }
}

function createTmuxViewManager({
  getNodePty,
  statusBufferChars,
  replayBufferChars,
  loadReplaySeed,
  onData,
  onViewState
}) {
  const states = new Map();
  const seqByAgentId = new Map();

  function getOrCreateState(agentId) {
    const existing = states.get(agentId);
    if (existing) {
      return existing;
    }
    const state = {
      agentId,
      pane: null,
      windowId: null,
      viewSession: null,
      baseSession: null,
      pty: null,
      seq: seqByAgentId.get(agentId) || 0,
      buffer: "",
      replayBuffer: "",
      replayTruncated: false,
      reattachAttempts: 0,
      reattachTimer: null,
      ensurePromise: null,
      destroying: false,
      cols: 96,
      rows: 28,
      onDataDisposable: null,
      onExitDisposable: null
    };
    states.set(agentId, state);
    return state;
  }

  function rememberSeq(state) {
    seqByAgentId.set(state.agentId, state.seq || 0);
  }

  function clearReattachTimer(state) {
    if (state.reattachTimer) {
      clearTimeout(state.reattachTimer);
      state.reattachTimer = null;
    }
  }

  function attachHandlers(state) {
    state.onDataDisposable = state.pty.onData((data) => {
      state.seq += 1;
      rememberSeq(state);
      state.buffer = appendBoundedText(state.buffer, data, statusBufferChars).text;
      const replay = appendBoundedText(state.replayBuffer, data, replayBufferChars);
      state.replayBuffer = replay.text;
      state.replayTruncated = state.replayTruncated || replay.truncated;
      onData?.(state.agentId, { data, seq: state.seq });
    });

    state.onExitDisposable = state.pty.onExit(({ exitCode, signal }) => {
      if (state.destroying) {
        return;
      }
      safeDispose(state.onDataDisposable);
      safeDispose(state.onExitDisposable);
      state.onDataDisposable = null;
      state.onExitDisposable = null;
      state.pty = null;
      const reason = `tmux view detached exitCode=${exitCode} signal=${signal || ""}`.trim();
      onViewState?.(state.agentId, { state: "detached", reason });
      void handleUnexpectedExit(state, reason);
    });
  }

  async function paneIsAlive(pane) {
    if (!pane) {
      return false;
    }
    const result = await runTmuxAsync(["display-message", "-p", "-t", pane, "#{pane_dead}"], { check: false });
    return result.status === 0 && result.stdout.trim() === "0";
  }

  async function waitForAttachedClient(viewSession, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await runTmuxAsync(["display-message", "-p", "-t", viewSession, "#{session_attached}"], { check: false });
      if (result.status === 0 && Number(result.stdout.trim()) > 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  async function handleUnexpectedExit(state, reason) {
    if (state.destroying || states.get(state.agentId) !== state) {
      return;
    }
    const alive = await paneIsAlive(state.pane);
    if (!alive) {
      onViewState?.(state.agentId, { state: "exited", reason: "tmux pane process has exited" });
      return;
    }
    scheduleReattach(state, reason);
  }

  function scheduleReattach(state, reason) {
    if (state.destroying || states.get(state.agentId) !== state) {
      return;
    }
    clearReattachTimer(state);
    if (state.reattachAttempts >= DEFAULT_REATTACH_DELAYS.length) {
      onViewState?.(state.agentId, { state: "detached", reason: `${reason}; reconnect attempts exhausted` });
      return;
    }
    const delay = DEFAULT_REATTACH_DELAYS[state.reattachAttempts];
    state.reattachAttempts += 1;
    onViewState?.(state.agentId, { state: "reattaching", reason: `${reason}; reconnecting in ${delay}ms` });
    state.reattachTimer = setTimeout(() => {
      state.reattachTimer = null;
      if (state.destroying || states.get(state.agentId) !== state) {
        return;
      }
      void ensureView({
        agentId: state.agentId,
        baseSession: state.baseSession,
        pane: state.pane,
        cols: state.cols,
        rows: state.rows
      }).catch((error) => {
        onViewState?.(state.agentId, { state: "detached", reason: error.message });
        scheduleReattach(state, error.message);
      });
    }, delay);
  }

  async function spawnAttach(state) {
    const nodePty = getNodePty();
    const { TMUX: _tmux, TMUX_PANE: _tmuxPane, ...attachEnv } = process.env;
    state.pty = nodePty.spawn("tmux", ["attach-session", "-d", "-t", state.viewSession], {
      name: "xterm-256color",
      cols: state.cols,
      rows: state.rows,
      env: { ...attachEnv, TERM: "xterm-256color" }
    });
    attachHandlers(state);
    if (await waitForAttachedClient(state.viewSession)) {
      await runTmuxAsync(["set-option", "-t", state.viewSession, "destroy-unattached", "on"], { check: false });
    }
    state.reattachAttempts = 0;
    onViewState?.(state.agentId, { state: "attached", reason: "tmux view attached" });
  }

  async function ensureView({ agentId, baseSession, pane, cols = 96, rows = 28 }) {
    const state = getOrCreateState(agentId);
    state.cols = Math.max(20, Number(cols) || 96);
    state.rows = Math.max(5, Number(rows) || 28);
    if (state.pty && state.pane === pane && state.baseSession === baseSession) {
      return;
    }
    if (state.ensurePromise) {
      return state.ensurePromise;
    }
    state.ensurePromise = (async () => {
      clearReattachTimer(state);
      if (state.pty && (state.pane !== pane || state.baseSession !== baseSession)) {
        await destroyView(agentId, { killSession: true });
      }
      const nextState = getOrCreateState(agentId);
      if (nextState.pty && nextState.pane === pane && nextState.baseSession === baseSession) {
        return;
      }
      nextState.destroying = false;
      nextState.pane = pane;
      nextState.baseSession = baseSession;
      nextState.viewSession = viewSessionName(baseSession, agentId);
      nextState.cols = Math.max(20, Number(cols) || nextState.cols || 96);
      nextState.rows = Math.max(5, Number(rows) || nextState.rows || 28);

      await runTmuxAsync(["kill-session", "-t", nextState.viewSession], { check: false });
      const windowResult = await runTmuxAsync(["display-message", "-p", "-t", pane, "#{window_id}"]);
      nextState.windowId = windowResult.stdout.trim();
      await runTmuxAsync(["new-session", "-d", "-s", nextState.viewSession, "-t", baseSession]);
      await runTmuxAsync(["set-option", "-t", nextState.viewSession, "status", "off"], { check: false });
      // Embedded wheel scrolling is local to xterm; tmux view sessions should not capture mouse events.
      await runTmuxAsync(["set-option", "-t", nextState.viewSession, "mouse", "off"], { check: false });
      await runTmuxAsync(["set-option", "-t", nextState.viewSession, "prefix", "None"], { check: false });
      await runTmuxAsync(["set-option", "-t", nextState.viewSession, "prefix2", "None"], { check: false });
      await runTmuxAsync(["select-window", "-t", `${nextState.viewSession}:${nextState.windowId}`]);
      await runTmuxAsync(["set-option", "-w", "-t", `${nextState.viewSession}:${nextState.windowId}`, "window-size", "latest"], { check: false });
      nextState.replayBuffer = String(loadReplaySeed?.(agentId) || "");
      nextState.replayTruncated = nextState.replayBuffer.length >= replayBufferChars;
      await spawnAttach(nextState);
    })();
    try {
      await state.ensurePromise;
    } finally {
      state.ensurePromise = null;
    }
  }

  async function destroyView(agentId, { killSession = true } = {}) {
    const state = states.get(agentId);
    if (!state) {
      if (killSession) {
        return;
      }
      return;
    }
    clearReattachTimer(state);
    state.destroying = true;
    safeDispose(state.onDataDisposable);
    safeDispose(state.onExitDisposable);
    state.onDataDisposable = null;
    state.onExitDisposable = null;
    if (state.pty) {
      try {
        state.pty.kill();
      } catch (_error) {
        // The paired tmux session kill below is the authoritative cleanup.
      }
      state.pty = null;
    }
    if (killSession && state.viewSession) {
      await runTmuxAsync(["kill-session", "-t", state.viewSession], { check: false });
    }
    rememberSeq(state);
    states.delete(agentId);
  }

  async function destroyAll({ killSessions = true } = {}) {
    await Promise.all([...states.keys()].map((agentId) => destroyView(agentId, { killSession: killSessions })));
  }

  async function reset() {
    await destroyAll({ killSessions: true });
    states.clear();
    seqByAgentId.clear();
  }

  function isAttached(agentId) {
    return Boolean(states.get(agentId)?.pty);
  }

  function write(agentId, data) {
    const state = states.get(agentId);
    if (!state?.pty) {
      throw new Error(`Agent is not running: ${agentId}`);
    }
    state.pty.write(String(data || ""));
  }

  async function scroll(_agentId, _lines) {
    return false;
  }

  function resize(agentId, cols, rows) {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      return;
    }
    const state = states.get(agentId);
    if (!state) {
      return;
    }
    state.cols = Math.max(20, cols);
    state.rows = Math.max(5, rows);
    if (state.pty) {
      state.pty.resize(state.cols, state.rows);
    }
  }

  async function pasteAndSubmit(agentId, message, { submitDelayMs = 0 } = {}) {
    write(agentId, `\x1b[200~${normalizePasteMessage(message)}\x1b[201~`);
    const delay = Math.max(0, Number(submitDelayMs) || 0);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    write(agentId, "\r");
  }

  function snapshot(agentId) {
    const state = states.get(agentId);
    if (!state) {
      return null;
    }
    return {
      seq: state.seq || 0,
      data: state.replayBuffer || "",
      truncated: Boolean(state.replayTruncated)
    };
  }

  function statusText(agentId) {
    return states.get(agentId)?.buffer || "";
  }

  function expectedWindow(agentId) {
    const state = states.get(agentId);
    if (!state) {
      return null;
    }
    return {
      viewSession: state.viewSession,
      windowId: state.windowId,
      pane: state.pane
    };
  }

  function attachedAgentIds() {
    return [...states.entries()].filter(([, state]) => state.pty).map(([agentId]) => agentId);
  }

  return {
    ensureView,
    destroyView,
    destroyAll,
    reset,
    isAttached,
    write,
    scroll,
    resize,
    pasteAndSubmit,
    snapshot,
    statusText,
    expectedWindow,
    attachedAgentIds
  };
}

module.exports = {
  createTmuxViewManager,
  runTmuxAsync,
  viewSessionName
};
