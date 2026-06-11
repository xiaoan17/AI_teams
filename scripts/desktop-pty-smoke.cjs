const fs = require("fs");
const path = require("path");
const pty = require("node-pty");

const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.join(appRoot, ".aiteam-demo");
const configPath = path.join(workspaceRoot, ".aiteam", "agents.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const enabledAgents = config.agents.filter((agent) => agent.enabled !== false);
const message = "DESKTOP_ROUTE_TEST";
const timeoutMs = 5000;

if (!enabledAgents.length) {
  throw new Error("No enabled demo agents found.");
}

function startAgent(agent) {
  const output = { id: agent.id, buffer: "" };
  const args = Array.isArray(agent.args) ? agent.args : [];
  const ptyProcess = pty.spawn(agent.command, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: agent.cwd || workspaceRoot,
    env: { ...process.env, TERM: "xterm-256color" }
  });

  ptyProcess.onData((data) => {
    output.buffer += data;
  });

  return { agent, ptyProcess, output };
}

function pasteAndSubmit(ptyProcess, text) {
  ptyProcess.write(`\x1b[200~${text}\x1b[201~\r`);
}

async function waitFor(predicate, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

(async () => {
    const running = enabledAgents.map(startAgent);
  try {
    for (const item of running) {
      pasteAndSubmit(item.ptyProcess, message);
    }

    const ok = await waitFor(
      () => running.every((item) => item.output.buffer.includes(message)),
      timeoutMs
    );

    if (!ok) {
      for (const item of running) {
        console.error(`--- ${item.agent.id} output ---`);
        console.error(item.output.buffer);
      }
      throw new Error("Timed out waiting for all demo PTYs to echo the routed message.");
    }

    console.log(`PTY smoke passed for ${running.map((item) => item.agent.id).join(", ")}`);
  } finally {
    for (const item of running) {
      item.ptyProcess.kill();
    }
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
