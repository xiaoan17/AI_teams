const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  parseTmuxAgentPaneTable,
  reconcileRuntimePanesFromTable
} = require("../src/main/tmux-runtime.cjs");
const { TMUX_SUBMIT_KEY } = require("../src/main/tmux-input.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiteams-runtime-recovery-smoke-"));
const appDir = path.join(root, ".aiteam");
const session = `aiteams-runtime-recovery-${process.pid}-${Date.now()}`;
const agentId = "codex";
const stalePane = "%999999";
const message = `RUNTIME_RECOVERY_${Date.now()}`;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function runTmux(args, options = {}) {
  const check = options.check !== false;
  try {
    return execFileSync("tmux", args, {
      encoding: "utf8",
      input: options.input,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    if (!check) {
      return "";
    }
    const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8").trim() : "";
    const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString("utf8").trim() : "";
    throw new Error(`tmux ${args.join(" ")} failed: ${stderr || stdout || error.message}`);
  }
}

function capturePane(pane) {
  return runTmux(["capture-pane", "-p", "-e", "-J", "-S", "-80", "-t", pane]);
}

function pasteAndEnter(pane, text) {
  const bufferName = `aiteam-runtime-recovery-${process.pid}`;
  try {
    runTmux(["load-buffer", "-b", bufferName, "-"], { input: text });
    runTmux(["paste-buffer", "-b", bufferName, "-t", pane, "-p"]);
    runTmux(["send-keys", "-t", pane, TMUX_SUBMIT_KEY]);
  } finally {
    runTmux(["delete-buffer", "-b", bufferName], { check: false });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

(async () => {
  try {
    ensureDir(path.join(appDir, "sessions", agentId));
    ensureDir(path.join(appDir, "tmp"));
    const rawLog = path.join(appDir, "sessions", agentId, "raw.ansi.log");
    fs.writeFileSync(rawLog, "");

    runTmux(["new-session", "-d", "-s", session, "-n", agentId, "-c", root, "/bin/cat"]);
    const realPane = runTmux(["display-message", "-p", "-t", `${session}:0.0`, "#{pane_id}"]).trim();
    runTmux(["pipe-pane", "-o", "-t", realPane, `cat >> ${shellQuote(rawLog)}`]);

    const runtime = {
      runtime_schema_version: 1,
      session,
      backend: "tmux",
      agents: {
        [agentId]: {
          pane: stalePane,
          raw_log: rawLog,
          markdown_log: path.join(appDir, "sessions", agentId, "session.md"),
          started_at: new Date().toISOString()
        }
      }
    };

    const config = {
      agents: [
        { id: agentId, enabled: true }
      ]
    };
    const paneList = runTmux(["list-panes", "-s", "-t", session, "-F", "#{pane_id}\t#{pane_dead}\t#{window_name}"]);
    const result = reconcileRuntimePanesFromTable(config, runtime, parseTmuxAgentPaneTable(paneList), {
      now: () => "2026-06-12T00:00:00.000Z"
    });
    if (!result.changed) {
      throw new Error("Expected stale runtime pane recovery to report a change.");
    }
    if (result.runtime.agents[agentId].pane !== realPane) {
      throw new Error(`Expected stale runtime to recover to ${realPane}, got ${result.runtime.agents[agentId].pane}`);
    }

    pasteAndEnter(result.runtime.agents[agentId].pane, message);
    const ok = await waitFor(() => capturePane(realPane).includes(message), 5000);
    if (!ok) {
      console.error(capturePane(realPane));
      throw new Error("Timed out waiting for recovered runtime pane to receive the routed message.");
    }

    console.log("tmux runtime recovery smoke passed");
  } finally {
    runTmux(["kill-session", "-t", session], { check: false });
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
