const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  agentCwd,
  agentShellCommand
} = require("../src/main/agent-command.cjs");

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

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aiteams-role-app-smoke-"));

try {
  const crewDir = path.join(workspaceRoot, ".aiteam", "crew", "designer");
  const prompt = "你是设计师\nNeed shell-safe 'quotes' and spaces.";
  const codexInstructions = "Codex role instructions\nUse RTK without initial prompt.";
  fs.mkdirSync(crewDir, { recursive: true });
  fs.writeFileSync(path.join(crewDir, "CLAUDE.md"), prompt, "utf8");
  fs.writeFileSync(path.join(crewDir, "RTK.md"), codexInstructions, "utf8");

  const injectedAgent = {
    id: "designer",
    command: "claude",
    args: ["--dangerously-skip-permissions"],
    persona_dir: ".aiteam/crew/designer",
    persona_file: "CLAUDE.md"
  };
  const injectedCommand = agentShellCommand(injectedAgent, { workspaceRoot });
  const injectedArgs = shellSplit(injectedCommand);
  assert.strictEqual(injectedArgs[0], "claude");
  assert(injectedArgs.includes("--dangerously-skip-permissions"));
  assert.strictEqual(flagValue(injectedArgs, "--add-dir"), crewDir);
  assert.strictEqual(flagValue(injectedArgs, "--append-system-prompt"), prompt);
  assert.strictEqual(agentCwd(injectedAgent, { workspaceRoot }), workspaceRoot);

  const codexAgent = {
    id: "codex",
    type: "codex",
    command: "codex",
    args: ["--no-alt-screen"],
    role_id: "designer",
    role: { title: "产品设计师 / 视觉与交互" },
    persona_dir: ".aiteam/crew/designer",
    persona_file: "CLAUDE.md",
    codex_instructions_file: "RTK.md"
  };
  const codexCommand = agentShellCommand(codexAgent, { workspaceRoot });
  const codexArgs = shellSplit(codexCommand);
  assert.strictEqual(codexArgs[0], "codex");
  assert(codexArgs.includes("--no-alt-screen"));
  assert.strictEqual(flagValue(codexArgs, "--add-dir"), crewDir);
  assert.strictEqual(flagValue(codexArgs, "-c"), `developer_instructions=${JSON.stringify(codexInstructions)}`);
  assert(!codexArgs.includes("--append-system-prompt"));
  assert(!codexArgs.some((part) => part.includes("You are acting as:")));
  assert(!codexArgs.some((part) => part.includes(prompt)));
  assert.strictEqual(agentCwd(codexAgent, { workspaceRoot }), workspaceRoot);

  const legacyCodexAgent = {
    ...codexAgent,
    id: "codex-legacy",
    codex_instructions_file: undefined
  };
  fs.rmSync(path.join(crewDir, "RTK.md"));
  const legacyCodexArgs = shellSplit(agentShellCommand(legacyCodexAgent, { workspaceRoot }));
  assert.strictEqual(flagValue(legacyCodexArgs, "-c"), `developer_instructions=${JSON.stringify(prompt)}`);
  assert(!legacyCodexArgs.includes("--append-system-prompt"));

  const legacyAgent = {
    id: "legacy",
    command: "claude",
    args: ["--foo"]
  };
  const legacyCommand = agentShellCommand(legacyAgent, { workspaceRoot });
  assert.strictEqual(legacyCommand, "claude --foo");
  assert(!legacyCommand.includes("--add-dir"));
  assert(!legacyCommand.includes("--append-system-prompt"));
  assert.strictEqual(agentCwd(legacyAgent, { workspaceRoot }), workspaceRoot);

  // New schema agent: no flat command, info lives in runtimes. Launch must
  // resolve the default runtime (claude) and inject its instructions file.
  fs.writeFileSync(path.join(crewDir, "CLAUDE.md"), prompt, "utf8");
  fs.writeFileSync(path.join(crewDir, "AGENTS.md"), codexInstructions, "utf8");
  const newSchemaAgent = {
    id: "designer",
    role_id: "designer",
    persona_dir: ".aiteam/crew/designer",
    default_runtime: "claude",
    autonomy: "auto",
    runtimes: {
      claude: { command: "claude", args: ["--dangerously-skip-permissions"], instructions_file: "CLAUDE.md", skills_dir: ".claude/skills" },
      codex: { command: "codex", args: ["--no-alt-screen"], instructions_file: "AGENTS.md", skills_dir: ".codex/skills" }
    }
  };
  const newArgs = shellSplit(agentShellCommand(newSchemaAgent, { workspaceRoot }));
  assert.strictEqual(newArgs[0], "claude", "new schema should resolve default runtime command");
  assert(newArgs.includes("--dangerously-skip-permissions"), "new schema args from runtimes.claude");
  assert.strictEqual(flagValue(newArgs, "--add-dir"), crewDir);
  assert.strictEqual(flagValue(newArgs, "--append-system-prompt"), prompt, "claude persona injected from runtimes.claude.instructions_file");

  // Same role launched as codex: resolve codex runtime + AGENTS.md instructions.
  const newCodexAgent = { ...newSchemaAgent, id: "designer", type: "codex", default_runtime: "codex" };
  const newCodexArgs = shellSplit(agentShellCommand(newCodexAgent, { workspaceRoot }));
  assert.strictEqual(newCodexArgs[0], "codex", "codex default runtime command");
  assert(newCodexArgs.includes("--no-alt-screen"));
  assert.strictEqual(flagValue(newCodexArgs, "-c"), `developer_instructions=${JSON.stringify(codexInstructions)}`, "codex developer_instructions from AGENTS.md");

  console.log("role inject app smoke passed");
} finally {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}
