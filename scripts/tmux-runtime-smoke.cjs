const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aiteams-tmux-smoke-"));
const appDir = path.join(root, ".aiteam");
const session = `aiteams-smoke-${process.pid}-${Date.now()}`;
const message = `TMUX_BACKEND_ROUTE_${Date.now()}`;
const agents = [
  { id: "codex", name: "Codex Smoke" },
  { id: "kimi", name: "Kimi Smoke" }
];

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

function setupPane(agent, pane) {
  const dir = path.join(appDir, "sessions", agent.id);
  ensureDir(dir);
  const rawLog = path.join(dir, `${Date.now()}.ansi.log`);
  const markdownLog = path.join(dir, `${Date.now()}.md`);
  fs.writeFileSync(rawLog, "");
  fs.writeFileSync(markdownLog, `# ${agent.name}\n`);
  runTmux(["pipe-pane", "-o", "-t", pane, `cat >> ${shellQuote(rawLog)}`]);
  return {
    pane,
    raw_log: rawLog,
    markdown_log: markdownLog,
    started_at: new Date().toISOString()
  };
}

function capturePane(pane) {
  return runTmux(["capture-pane", "-p", "-e", "-J", "-S", "-200", "-t", pane]);
}

function pasteAndEnter(pane, text) {
  const tmp = path.join(appDir, "tmp", `paste-${process.pid}-${Date.now()}.txt`);
  const bufferName = `aiteam-smoke-${process.pid}`;
  fs.writeFileSync(tmp, text);
  try {
    runTmux(["load-buffer", "-b", bufferName, tmp]);
    runTmux(["paste-buffer", "-b", bufferName, "-t", pane, "-p"]);
    runTmux(["send-keys", "-t", pane, "C-m"]);
  } finally {
    runTmux(["delete-buffer", "-b", bufferName], { check: false });
    fs.rmSync(tmp, { force: true });
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
    ensureDir(path.join(appDir, "sessions"));
    ensureDir(path.join(appDir, "status"));
    ensureDir(path.join(appDir, "tmp"));

    runTmux(["new-session", "-d", "-s", session, "-n", "agents", "-c", root, "/bin/cat"]);
    const firstPane = runTmux(["display-message", "-p", "-t", `${session}:0.0`, "#{pane_id}"]).trim();
    const runtime = {
      runtime_schema_version: 1,
      session,
      backend: "tmux",
      started_at: new Date().toISOString(),
      agents: {
        [agents[0].id]: setupPane(agents[0], firstPane)
      }
    };

    const secondPane = runTmux([
      "split-window",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      `${session}:0`,
      "-c",
      root,
      "/bin/cat"
    ]).trim();
    runtime.agents[agents[1].id] = setupPane(agents[1], secondPane);
    runTmux(["select-layout", "-t", `${session}:0`, "tiled"], { check: false });
    fs.writeFileSync(path.join(appDir, "runtime.json"), JSON.stringify(runtime, null, 2) + "\n");

    for (const agent of agents) {
      pasteAndEnter(runtime.agents[agent.id].pane, message);
    }

    const ok = await waitFor(
      () => agents.every((agent) => capturePane(runtime.agents[agent.id].pane).includes(message)),
      5000
    );
    if (!ok) {
      for (const agent of agents) {
        console.error(`--- ${agent.id} capture ---`);
        console.error(capturePane(runtime.agents[agent.id].pane));
      }
      throw new Error("Timed out waiting for tmux panes to receive the routed message.");
    }

    console.log(`tmux runtime smoke passed for ${agents.map((agent) => agent.id).join(", ")}`);
  } finally {
    runTmux(["kill-session", "-t", session], { check: false });
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
