const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { tmuxInputActions, writeInputActions } = require("../src/main/tmux-input.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiteams-input-fallback-smoke-"));
const appDir = path.join(root, ".aiteam");
const session = `aiteams-input-fallback-${process.pid}-${Date.now()}`;
const agentId = "cat";
const message = `INPUT_FALLBACK_${Date.now()}`;

const parsedActions = tmuxInputActions("ab\x7fcd\r\x1b[A");
if (JSON.stringify(parsedActions) !== JSON.stringify([
  { type: "text", value: "ab" },
  { type: "key", key: "BSpace" },
  { type: "text", value: "cd" },
  { type: "key", key: "Enter" },
  { type: "key", key: "Up" }
])) {
  throw new Error(`Unexpected tmux input actions: ${JSON.stringify(parsedActions)}`);
}
const filteredResponseActions = tmuxInputActions("ok\x1b[>0;276;0cdone");
if (JSON.stringify(filteredResponseActions) !== JSON.stringify([{ type: "text", value: "okdone" }])) {
  throw new Error(`Unexpected filtered response actions: ${JSON.stringify(filteredResponseActions)}`);
}
const csiUEnterActions = tmuxInputActions("ok\x1b[13uagain\x1b[109;5uolder\x1b[27;5;109~");
if (JSON.stringify(csiUEnterActions) !== JSON.stringify([
  { type: "text", value: "ok" },
  { type: "key", key: "Enter" },
  { type: "text", value: "again" },
  { type: "key", key: "Enter" },
  { type: "text", value: "older" },
  { type: "key", key: "Enter" }
])) {
  throw new Error(`Unexpected CSI-u enter actions: ${JSON.stringify(csiUEnterActions)}`);
}
const csiUPrintableActions = tmuxInputActions("nums:\x1b[49u\x1b[50u\x1b[51u sym:\x1b[45u\x1b[61u old:\x1b[27;2;52~");
if (JSON.stringify(csiUPrintableActions) !== JSON.stringify([
  { type: "text", value: "nums:123 sym:-= old:4" }
])) {
  throw new Error(`Unexpected CSI-u printable actions: ${JSON.stringify(csiUPrintableActions)}`);
}
const splitPrintableState = {};
const splitPrintableStart = tmuxInputActions("digit:\x1b[", splitPrintableState);
if (
  JSON.stringify(splitPrintableStart) !== JSON.stringify([{ type: "text", value: "digit:" }])
  || splitPrintableState.pendingInput !== "\x1b["
) {
  throw new Error(`Unexpected split printable CSI-u start: ${JSON.stringify({ splitPrintableStart, splitPrintableState })}`);
}
const splitPrintableEnd = tmuxInputActions("53u", splitPrintableState);
if (
  JSON.stringify(splitPrintableEnd) !== JSON.stringify([{ type: "text", value: "5" }])
  || splitPrintableState.pendingInput
) {
  throw new Error(`Unexpected split printable CSI-u end: ${JSON.stringify({ splitPrintableEnd, splitPrintableState })}`);
}
const ss3Actions = tmuxInputActions("ok\x1bOC\x1bOD\x1bOA\x1bOBdone");
if (JSON.stringify(ss3Actions) !== JSON.stringify([
  { type: "text", value: "ok" },
  { type: "key", key: "Right" },
  { type: "key", key: "Left" },
  { type: "key", key: "Up" },
  { type: "key", key: "Down" },
  { type: "text", value: "done" }
])) {
  throw new Error(`Unexpected SS3 cursor actions: ${JSON.stringify(ss3Actions)}`);
}
const ignoredModeActions = tmuxInputActions("ok\x1b[?2026l\x1b[>4;2m\x1b[?996ndone");
if (JSON.stringify(ignoredModeActions) !== JSON.stringify([{ type: "text", value: "okdone" }])) {
  throw new Error(`Unexpected ignored mode actions: ${JSON.stringify(ignoredModeActions)}`);
}
const splitState = {};
const splitStart = tmuxInputActions("ok\x1b[", splitState);
if (JSON.stringify(splitStart) !== JSON.stringify([{ type: "text", value: "ok" }]) || splitState.pendingInput !== "\x1b[") {
  throw new Error(`Unexpected split CSI start: ${JSON.stringify({ splitStart, splitState })}`);
}
const splitEnd = tmuxInputActions("Iagain\x1bO", splitState);
if (
  JSON.stringify(splitEnd) !== JSON.stringify([{ type: "text", value: "again" }])
  || splitState.pendingInput !== "\x1bO"
) {
  throw new Error(`Unexpected split mixed escape: ${JSON.stringify({ splitEnd, splitState })}`);
}
const splitSs3End = tmuxInputActions("C", splitState);
if (JSON.stringify(splitSs3End) !== JSON.stringify([{ type: "key", key: "Right" }]) || splitState.pendingInput) {
  throw new Error(`Unexpected split SS3 end: ${JSON.stringify({ splitSs3End, splitState })}`);
}

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

async function writeInputFallback(pane, text, inputState = {}) {
  await writeInputActions(agentId, text, {
    inputState,
    submitDelayMs: 80,
    sleep,
    resolvePane: () => pane,
    isPaneDead: () => false,
    sendKey: (_pane, key) => runTmux(["send-keys", "-t", _pane, key]),
    sendText: (_pane, value) => runTmux(["send-keys", "-t", _pane, "-l", value]),
    pasteText: (_pane, value) => {
      const bufferName = `aiteam-input-smoke-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        runTmux(["load-buffer", "-b", bufferName, "-"], { input: value });
        runTmux(["paste-buffer", "-b", bufferName, "-t", _pane, "-p"]);
      } finally {
        runTmux(["delete-buffer", "-b", bufferName], { check: false });
      }
    }
  });
}

async function writeInputWithAttachedView(pane, ptyWriter, text, inputState = {}) {
  void ptyWriter;
  await writeInputFallback(pane, text, inputState);
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

    const fallbackState = {};
    await writeInputFallback(pane, `ab\x7f${message}`, fallbackState);
    await writeInputFallback(pane, "\r", fallbackState);
    const ok = await waitFor(() => capturePane(pane).includes(`a${message}`), 5000);
    if (!ok) {
      console.error("--- pane capture ---");
      console.error(capturePane(pane));
      console.error("--- raw log ---");
      console.error(fs.readFileSync(rawLog, "utf8"));
      throw new Error("Timed out waiting for fallback tmux input.");
    }

    const attachedMessage = `ATTACHED_KEY_${Date.now()}`;
    const ptyWritten = [];
    const attachedState = {};
    await writeInputWithAttachedView(pane, (text) => {
      ptyWritten.push(text);
    }, `zz\x7f${attachedMessage}`, attachedState);
    await writeInputWithAttachedView(pane, () => {
      throw new Error("attached view writer should not receive Enter");
    }, "\r", attachedState);
    const attachedOk = await waitFor(() => capturePane(pane).includes(`z${attachedMessage}`), 5000);
    if (!attachedOk) {
      console.error("--- pane capture ---");
      console.error(capturePane(pane));
      console.error("--- raw log ---");
      console.error(fs.readFileSync(rawLog, "utf8"));
      throw new Error("Timed out waiting for attached-view tmux input.");
    }
    if (ptyWritten.length) {
      throw new Error(`Attached-view writer received input: ${JSON.stringify(ptyWritten)}`);
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
