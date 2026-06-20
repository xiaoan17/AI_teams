const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { agentShellCommand } = require("../src/main/agent-command.cjs");

function shellSplit(command) {
  const script = [
    `set -- ${command}`,
    "node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' \"$@\""
  ].join("\n");
  return JSON.parse(execFileSync("/bin/sh", ["-c", script], { encoding: "utf8" }));
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  assert.notStrictEqual(index, -1, `missing ${flag} in ${JSON.stringify(args)}`);
  assert(index + 1 < args.length, `missing value for ${flag}`);
  return args[index + 1];
}

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aiteams-model-app-smoke-"));

try {
  const crewDir = path.join(workspaceRoot, ".aiteam", "crew", "frontend");
  fs.mkdirSync(crewDir, { recursive: true });
  fs.writeFileSync(path.join(crewDir, "CLAUDE.md"), "frontend persona", "utf8");
  fs.writeFileSync(path.join(crewDir, "RTK.md"), "codex instructions", "utf8");

  const claude = {
    id: "frontend",
    command: "claude",
    args: ["--dangerously-skip-permissions"],
    persona_dir: ".aiteam/crew/frontend",
    persona_file: "CLAUDE.md",
    model: "opus"
  };
  const claudeArgs = shellSplit(agentShellCommand(claude, { workspaceRoot }));
  assert.strictEqual(flagValue(claudeArgs, "--model"), "opus");
  assert(claudeArgs.indexOf("--model") < claudeArgs.indexOf("--add-dir"));

  const codex = {
    id: "codex",
    type: "codex",
    command: "codex",
    args: ["--no-alt-screen"],
    persona_dir: ".aiteam/crew/frontend",
    persona_file: "CLAUDE.md",
    codex_instructions_file: "RTK.md",
    model: "opus"
  };
  const codexArgs = shellSplit(agentShellCommand(codex, { workspaceRoot }));
  const modelIndex = codexArgs.indexOf("-c");
  assert.notStrictEqual(modelIndex, -1);
  assert.strictEqual(codexArgs[modelIndex + 1], "model=opus");

  const noModel = { ...claude };
  delete noModel.model;
  const noModelArgs = shellSplit(agentShellCommand(noModel, { workspaceRoot }));
  assert(!noModelArgs.includes("--model"));
  assert(!noModelArgs.some((part) => part.startsWith("model=")));

  const unknownWarnings = [];
  const unknown = {
    id: "foo",
    command: "foo",
    args: ["--flag"],
    model: "opus"
  };
  const unknownArgs = shellSplit(agentShellCommand(unknown, {
    workspaceRoot,
    logger: {
      warn(message) {
        unknownWarnings.push(message);
      }
    }
  }));
  assert.deepStrictEqual(unknownArgs, ["foo", "--flag"]);
  assert(unknownWarnings.some((message) => message.includes("model injection")));

  const noPersona = {
    id: "claude-no-persona",
    command: "claude",
    model: "opus"
  };
  assert.deepStrictEqual(shellSplit(agentShellCommand(noPersona, { workspaceRoot })), ["claude", "--model", "opus"]);

  const spaced = {
    id: "special-model",
    command: "claude",
    model: "opus model 'x'"
  };
  const spacedArgs = shellSplit(agentShellCommand(spaced, { workspaceRoot }));
  assert.strictEqual(flagValue(spacedArgs, "--model"), "opus model 'x'");

  console.log("model inject app smoke passed");
} finally {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}
