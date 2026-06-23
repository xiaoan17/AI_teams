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

  // codex model now comes from runtimes.codex.model (per-runtime), injected as -c model=
  const codex = {
    id: "codex",
    type: "codex",
    command: "codex",
    args: ["--no-alt-screen"],
    persona_dir: ".aiteam/crew/frontend",
    persona_file: "CLAUDE.md",
    codex_instructions_file: "RTK.md",
    default_runtime: "codex",
    runtimes: { codex: { command: "codex", model: "gpt-5.2" } }
  };
  const codexArgs = shellSplit(agentShellCommand(codex, { workspaceRoot }));
  const modelIndex = codexArgs.indexOf("-c");
  assert.notStrictEqual(modelIndex, -1);
  assert.strictEqual(codexArgs[modelIndex + 1], "model=gpt-5.2");

  // Kimi is run as a blank slate: model injects via `-m <model>` from
  // runtimes.kimi.model, and even with a persona_dir it must NOT emit --add-dir.
  const kimi = {
    id: "kimi",
    type: "kimi",
    command: "kimi",
    args: ["-y"],
    persona_dir: ".aiteam/crew/frontend",
    persona_file: "CLAUDE.md",
    default_runtime: "kimi",
    runtimes: { kimi: { command: "kimi", model: "kimi-k2" } }
  };
  const kimiArgs = shellSplit(agentShellCommand(kimi, { workspaceRoot }));
  assert.strictEqual(flagValue(kimiArgs, "-m"), "kimi-k2");
  assert(!kimiArgs.includes("--add-dir"), `kimi must not emit --add-dir: ${JSON.stringify(kimiArgs)}`);
  assert(!kimiArgs.includes("--append-system-prompt"));
  assert.deepStrictEqual(kimiArgs, ["kimi", "-y", "-m", "kimi-k2"]);

  // Regression for the "opus poisons everyone" bug: a legacy top-level model
  // (claude-only alias) must NOT be injected onto codex/kimi runtimes.
  const legacyKimi = { id: "lk", command: "kimi", args: ["-y"], model: "opus" };
  const legacyKimiArgs = shellSplit(agentShellCommand(legacyKimi, { workspaceRoot }));
  assert(!legacyKimiArgs.includes("opus"), `legacy opus must not reach kimi: ${JSON.stringify(legacyKimiArgs)}`);
  assert(!legacyKimiArgs.includes("-m"), "no model flag when top-level model is suppressed for kimi");

  const legacyCodex = { id: "lc", type: "codex", command: "codex", args: [], model: "opus" };
  const legacyCodexArgs = shellSplit(agentShellCommand(legacyCodex, { workspaceRoot }));
  assert(!legacyCodexArgs.some((p) => p === "model=opus"), `legacy opus must not reach codex: ${JSON.stringify(legacyCodexArgs)}`);

  // ...but a legacy top-level model is still honored for the claude runtime.
  const legacyClaude = { id: "lcl", command: "claude", model: "opus" };
  const legacyClaudeArgs = shellSplit(agentShellCommand(legacyClaude, { workspaceRoot }));
  assert.strictEqual(flagValue(legacyClaudeArgs, "--model"), "opus");

  const noModel = { ...claude };
  delete noModel.model;
  delete noModel.runtimes;
  delete noModel.default_runtime;
  const noModelArgs = shellSplit(agentShellCommand(noModel, { workspaceRoot }));
  assert(!noModelArgs.includes("--model"));
  assert(!noModelArgs.some((part) => part.startsWith("model=")));

  // An unknown runtime family with a configured per-runtime model warns and skips
  // (we only know how to inject model for claude/codex/kimi).
  const unknownWarnings = [];
  const unknown = {
    id: "foo",
    command: "foo",
    args: ["--flag"],
    default_runtime: "foo",
    runtimes: { foo: { command: "foo", model: "whatever" } }
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
