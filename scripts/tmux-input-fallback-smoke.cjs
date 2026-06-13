const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiteams-input-fallback-smoke-"));
const appDir = path.join(root, ".aiteam");
const session = `aiteams-input-fallback-${process.pid}-${Date.now()}`;
const agentId = "cat";
const message = `INPUT_FALLBACK_${Date.now()}`;

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

function writeInputFallback(pane, text) {
  const bufferName = `aiteam-input-smoke-${process.pid}`;
  try {
    runTmux(["load-buffer", "-b", bufferName, "-"], { input: text });
    runTmux(["paste-buffer", "-b", bufferName, "-t", pane, "-p"]);
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
    const rawLog = path.join(appDir, "sessions", agentId, "raw.ansi.log");
    fs.writeFileSync(rawLog, "");

    runTmux(["new-session", "-d", "-s", session, "-n", agentId, "-c", root, "/bin/cat"]);
    const pane = runTmux(["display-message", "-p", "-t", `${session}:0.0`, "#{pane_id}"]).trim();
    runTmux(["pipe-pane", "-o", "-t", pane, `cat >> ${shellQuote(rawLog)}`]);

    writeInputFallback(pane, `${message}\r`);
    const ok = await waitFor(() => capturePane(pane).includes(message), 5000);
    if (!ok) {
      console.error("--- pane capture ---");
      console.error(capturePane(pane));
      console.error("--- raw log ---");
      console.error(fs.readFileSync(rawLog, "utf8"));
      throw new Error("Timed out waiting for fallback tmux input.");
    }

    console.log("tmux input fallback smoke passed");
  } finally {
    runTmux(["kill-session", "-t", session], { check: false });
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
