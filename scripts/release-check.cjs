const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const forbiddenPatterns = [
  /\/Users\/anbc/,
  /\/opt\/homebrew\/bin\/codex/,
  /\/Users\/[^/\s]+\/\.kimi-code/
];
const checkedFiles = [
  "README.md",
  ".aiteam/agents.json",
  "aiteam.py",
  "package.json",
  "src/main/main.cjs",
  "src/renderer/App.jsx"
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

for (const relativePath of checkedFiles) {
  const file = path.join(appRoot, relativePath);
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

for (const command of [
  ["node", ["--check", "src/main/main.cjs"]],
  ["python3", ["-m", "py_compile", "aiteam.py"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "doctor"]],
  ["npm", ["run", "smoke"]]
]) {
  execFileSync(command[0], command[1], {
    cwd: appRoot,
    stdio: "inherit"
  });
}

if (!process.exitCode) {
  console.log("release check passed");
}
