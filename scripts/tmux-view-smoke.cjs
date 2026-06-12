const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { createTmuxViewManager, runTmuxAsync } = require("../src/main/tmux-view.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiteams-tmux-view-smoke-"));
const appDir = path.join(root, ".aiteam");
const session = `aiteams-view-smoke-${process.pid}-${Date.now()}`;
const agentId = "cat";
const echoMessage = `VIEW_ECHO_${Date.now()}`;
const pasteMessage = "你好\n世界";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

function readLog(rawLog) {
  return fs.existsSync(rawLog) ? fs.readFileSync(rawLog, "utf8") : "";
}

(async () => {
  let manager = null;
  try {
    ensureDir(path.join(appDir, "sessions", agentId));
    const rawLog = path.join(appDir, "sessions", agentId, "raw.ansi.log");
    fs.writeFileSync(rawLog, "");

    runTmux(["new-session", "-d", "-s", session, "-n", agentId, "-c", root, "/bin/cat"]);
    const pane = runTmux(["display-message", "-p", "-t", `${session}:0.0`, "#{pane_id}"]).trim();
    runTmux(["pipe-pane", "-o", "-t", pane, `cat >> ${shellQuote(rawLog)}`]);

    let output = "";
    manager = createTmuxViewManager({
      getNodePty: () => require("node-pty"),
      statusBufferChars: 12000,
      replayBufferChars: 750000,
      loadReplaySeed: () => readLog(rawLog),
      onData: (_agentId, { data }) => {
        output += data;
      },
      onViewState: () => {}
    });

    await manager.ensureView({ agentId, baseSession: session, pane, cols: 80, rows: 24 });
    manager.write(agentId, `${echoMessage}\r`);
    const echoed = await waitFor(() => output.includes(echoMessage), 5000);
    if (!echoed) {
      throw new Error("Timed out waiting for tmux view pty echo.");
    }

    await manager.pasteAndSubmit(agentId, pasteMessage);
    const logOk = await waitFor(() => {
      const log = readLog(rawLog);
      return log.includes("你好") && log.includes("世界");
    }, 5000);
    if (!logOk) {
      throw new Error("Timed out waiting for bracketed paste content in raw log.");
    }

    const historyLines = Array.from({ length: 80 }, (_item, index) => `HISTORY_${index + 1}`).join("\n");
    await manager.pasteAndSubmit(agentId, historyLines);
    const historyOk = await waitFor(() => readLog(rawLog).includes("HISTORY_80"), 5000);
    if (!historyOk) {
      throw new Error("Timed out waiting for history lines in raw log.");
    }

    await manager.scroll(agentId, -5);
    const stayedLive = await waitFor(async () => {
      const result = await runTmuxAsync(["display-message", "-p", "-t", `${session}-view-${agentId}:0`, "#{pane_in_mode}\t#{scroll_position}"], { check: false });
      const [inModeText, positionText = "0"] = result.stdout.trim().split("\t");
      const inMode = Number(inModeText || 0);
      const position = Number(positionText || 0);
      return result.status === 0 && inMode === 0 && position === 0;
    }, 3000);
    if (!stayedLive) {
      throw new Error("tmux view scroll should not enter copy-mode.");
    }

    await manager.scroll(agentId, 500);
    const stillLive = await waitFor(async () => {
      const result = await runTmuxAsync(["display-message", "-p", "-t", `${session}-view-${agentId}:0`, "#{pane_in_mode}\t#{scroll_position}"], { check: false });
      const [inModeText, positionText = "0"] = result.stdout.trim().split("\t");
      const inMode = Number(inModeText || 0);
      const position = Number(positionText || 0);
      return result.status === 0 && inMode === 0 && position === 0;
    }, 3000);
    if (!stillLive) {
      throw new Error("tmux view scroll should leave live output attached.");
    }

    runTmux(["kill-session", "-t", session], { check: false });
    await manager.destroyAll();
    await runTmuxAsync(["kill-session", "-t", `${session}-view-${agentId}`], { check: false });
    const viewGone = await waitFor(async () => {
      const result = await runTmuxAsync(["has-session", "-t", `${session}-view-${agentId}`], { check: false });
      return result.status !== 0;
    }, 3000);
    if (!viewGone) {
      throw new Error("tmux view session was not cleaned up.");
    }

    console.log("tmux view smoke passed");
  } finally {
    if (manager) {
      await manager.destroyAll().catch(() => {});
    }
    runTmux(["kill-session", "-t", `${session}-view-${agentId}`], { check: false });
    runTmux(["kill-session", "-t", session], { check: false });
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
