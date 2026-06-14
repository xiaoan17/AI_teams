"use strict";

// Reclaim an entire process subtree rooted at a given PID.
//
// Why not process-group signals? Agent CLIs (codex, claude, ...) routinely fork
// helpers — MCP servers, node_repl, language servers — that call setpgid/setsid
// and thus escape the root's process group. A `kill -- -<pgid>` misses them.
// So we rebuild the descendant set by PPID lineage from a `ps` snapshot and
// signal each PID individually. Lineage (not process name) is the trust anchor:
// we only ever descend from a root PID this app itself launched, so we never
// touch the user's unrelated codex/claude processes.

const { execFileSync } = require("child_process");

function defaultPsSnapshot() {
  // `ps -axo pid=,ppid=` prints two whitespace-separated columns with no header.
  const stdout = execFileSync("ps", ["-axo", "pid=,ppid="], {
    encoding: "utf8",
    timeout: 1000,
    maxBuffer: 8 * 1024 * 1024
  });
  return parsePsSnapshot(stdout);
}

// Parse `ps` output into a list of { pid, ppid } pairs. Tolerates a leading
// header row, blank lines, and arbitrary leading whitespace.
function parsePsSnapshot(stdout) {
  const rows = [];
  for (const line of String(stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (Number.isInteger(pid) && Number.isInteger(ppid)) {
      rows.push({ pid, ppid });
    }
  }
  return rows;
}

// Collect rootPid plus every transitive descendant, ordered children-first so
// callers can signal leaves before their parents. Self-referential or cyclic
// PPID data (PID 1, recycled pids) cannot loop because each pid is visited once.
function collectDescendants(rootPid, snapshot) {
  const root = Number(rootPid);
  if (!Number.isInteger(root) || root <= 1) {
    return [];
  }
  const childrenByPpid = new Map();
  const livePids = new Set();
  for (const { pid, ppid } of snapshot) {
    livePids.add(pid);
    if (pid === ppid) {
      continue;
    }
    if (!childrenByPpid.has(ppid)) {
      childrenByPpid.set(ppid, []);
    }
    childrenByPpid.get(ppid).push(pid);
  }

  const ordered = [];
  const seen = new Set([root]);
  const visit = (pid) => {
    for (const child of childrenByPpid.get(pid) || []) {
      if (seen.has(child)) {
        continue;
      }
      seen.add(child);
      visit(child);
      ordered.push(child); // children appended before their parent
    }
  };
  visit(root);
  // Only include the root if it is actually present in the snapshot; a dead
  // root with live descendants (reparented to PID 1) would otherwise be
  // reported as alive, defeating the drain check.
  if (livePids.has(root)) {
    ordered.push(root); // root last
  }
  return ordered;
}

function defaultSignal(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    // ESRCH: the process already exited between snapshot and signal — fine.
    if (error && error.code === "ESRCH") {
      return false;
    }
    // EPERM and friends: not ours to kill, or a race. Best-effort: swallow.
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Terminate the subtree rooted at rootPid: SIGTERM, a grace period during which
// we poll for the subtree to drain, then SIGKILL on whatever survives. We
// re-snapshot before SIGKILL so children forked during the grace window are
// also caught.
//
// Injectable seams (psSnapshot/sendSignal/sleep) keep this unit-testable without
// real processes.
async function killProcessTree(rootPid, options = {}) {
  const {
    psSnapshot = defaultPsSnapshot,
    sendSignal = defaultSignal,
    sleep = delay,
    graceMs = 800,
    pollIntervalMs = 50
  } = options;

  const root = Number(rootPid);
  if (!Number.isInteger(root) || root <= 1) {
    return { signalled: [], killed: [], ok: false, reason: "invalid root pid" };
  }

  let snapshot;
  try {
    snapshot = psSnapshot();
  } catch (error) {
    return { signalled: [], killed: [], ok: false, reason: `ps failed: ${error.message}` };
  }

  const initial = collectDescendants(root, snapshot);
  if (!initial.length) {
    return { signalled: [], killed: [], ok: true, reason: "no matching processes" };
  }

  const signalled = [];
  for (const pid of initial) {
    if (sendSignal(pid, "SIGTERM")) {
      signalled.push(pid);
    }
  }

  // Poll for the subtree to drain within the grace window.
  const deadline = graceMs;
  let elapsed = 0;
  let survivors = initial;
  while (elapsed < deadline) {
    await sleep(Math.min(pollIntervalMs, deadline - elapsed));
    elapsed += pollIntervalMs;
    let current;
    try {
      current = collectDescendants(root, psSnapshot());
    } catch (_error) {
      break; // ps hiccup; fall through to SIGKILL pass
    }
    if (!current.length) {
      return { signalled, killed: [], ok: true, reason: "terminated gracefully" };
    }
    survivors = current;
  }

  // Anything still alive (incl. children forked during the grace window) gets SIGKILL.
  const killed = [];
  for (const pid of survivors) {
    if (sendSignal(pid, "SIGKILL")) {
      killed.push(pid);
    }
  }
  return { signalled, killed, ok: true, reason: "forced after grace period" };
}

module.exports = {
  parsePsSnapshot,
  collectDescendants,
  killProcessTree
};
