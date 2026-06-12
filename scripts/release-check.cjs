const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const runFull = process.argv.includes("--full");

const forbiddenPatterns = [
  /\/Users\/[A-Za-z0-9._-]+\/(?:Desktop|Documents|Downloads|Projects)\b/,
  /\/Users\/anbc/,
  /\/opt\/homebrew\/bin\/codex/,
  /\/Users\/[^/\s]+\/\.kimi-code/
];
const scannedExtensions = new Set([
  ".md", ".json", ".py", ".cjs", ".mjs", ".js", ".jsx", ".ts", ".tsx",
  ".css", ".html", ".yml", ".yaml", ".txt", ".sh"
]);
const skippedFiles = new Set(["package-lock.json"]);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files"], { cwd: appRoot, encoding: "utf8" });
  if (result.status !== 0) {
    fail("release-check requires git to enumerate tracked files");
    return [];
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

for (const relativePath of trackedFiles()) {
  if (skippedFiles.has(relativePath)) continue;
  if (!scannedExtensions.has(path.extname(relativePath).toLowerCase())) continue;
  const file = path.join(appRoot, relativePath);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) {
      fail(`Forbidden local path matched ${pattern} in ${relativePath}`);
    }
  }
}

const config = JSON.parse(fs.readFileSync(path.join(appRoot, ".aiteam", "agents.json"), "utf8"));
const enabled = config.agents.filter((agent) => agent.enabled !== false);
if (enabled.length) {
  fail(`Default .aiteam/agents.json must not enable real agents: ${enabled.map((agent) => agent.id).join(", ")}`);
}

for (const agent of config.agents) {
  if (path.isAbsolute(agent.cwd || "")) {
    fail(`Default agent cwd must be relative for ${agent.id}: ${agent.cwd}`);
  }
  if (path.isAbsolute(agent.command || "")) {
    fail(`Default agent command must not be an absolute local path for ${agent.id}: ${agent.command}`);
  }
}

const staticCommands = [
  ["node", ["--check", "src/main/main.cjs"]],
  ["python3", ["-m", "py_compile", "aiteam.py"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "doctor"]]
];

for (const [command, args] of staticCommands) {
  execFileSync(command, args, { cwd: appRoot, stdio: "inherit" });
}

if (runFull) {
  // Runtime tier: tmux integration smoke tests. These need real tmux socket
  // access and fail in sandboxes that block /private/tmp/tmux-*.
  const smoke = spawnSync("npm", ["run", "smoke"], { cwd: appRoot, encoding: "utf8" });
  process.stdout.write(smoke.stdout || "");
  process.stderr.write(smoke.stderr || "");
  if (smoke.status !== 0) {
    const output = `${smoke.stdout || ""}${smoke.stderr || ""}`;
    if (/operation not permitted|error connecting to .*tmux/i.test(output)) {
      fail(
        "tmux smoke tests could not reach the tmux socket. This usually means a sandboxed " +
        "environment is blocking /private/tmp/tmux-*; re-run `npm run release:check:full` " +
        "outside the sandbox. Static release checks above already completed."
      );
    } else {
      fail("tmux smoke tests failed");
    }
  }
} else {
  console.log("static release checks done (run `npm run release:check:full` to include tmux smoke tests)");
}

if (!process.exitCode) {
  console.log("release check passed");
}
