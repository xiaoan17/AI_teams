// Smoke test for role-runtime.cjs: the schema-normalization layer that bridges
// old flat role schema and new runtimes schema. Requires the real module
// (no Electron dependency), so this verifies the actual code, not a copy.

const assert = require("assert");
const { resolveRuntime, runtimeFamilyList } = require("../src/main/role-runtime.cjs");

// --- new schema (runtimes) ---
const newRole = {
  id: "frontend",
  default_runtime: "claude",
  autonomy: "auto",
  persona_file: "CLAUDE.md",
  runtimes: {
    claude: { command: "claude", args: ["--dangerously-skip-permissions"], instructions_file: "CLAUDE.md", skills_dir: ".claude/skills", model: "opus" },
    codex: { command: "codex", args: ["--dangerously-bypass-approvals-and-sandbox"], instructions_file: "AGENTS.md", skills_dir: ".codex/skills" },
    kimi: { command: "kimi", args: ["-y"], instructions_file: "CLAUDE.md", skills_dir: ".claude/skills", model: "kimi-k2" }
  }
};

const def = resolveRuntime(newRole);
assert.strictEqual(def.runtime, "claude", "default runtime should be claude");
assert.strictEqual(def.command, "claude");
assert.deepStrictEqual(def.args, ["--dangerously-skip-permissions"]);
assert.strictEqual(def.instructionsFile, "CLAUDE.md");
assert.strictEqual(def.skillsDir, ".claude/skills");
assert.strictEqual(def.model, "opus", "claude runtime carries its own model");

const codex = resolveRuntime(newRole, "codex");
assert.strictEqual(codex.command, "codex");
assert.strictEqual(codex.instructionsFile, "AGENTS.md", "codex instructions should be AGENTS.md");
assert.strictEqual(codex.skillsDir, ".codex/skills");
assert.deepStrictEqual(codex.args, ["--dangerously-bypass-approvals-and-sandbox"]);
assert.strictEqual(codex.model, "", "codex runtime with no model returns empty (use CLI default)");

const kimi = resolveRuntime(newRole, "kimi");
assert.strictEqual(kimi.command, "kimi");
assert.strictEqual(kimi.model, "kimi-k2", "kimi runtime carries its own model alias");

assert.deepStrictEqual(runtimeFamilyList(newRole).sort(), ["claude", "codex", "kimi"], "should list all runtimes");

// default_runtime = codex → resolve picks codex when no name given
const codexDefault = resolveRuntime({ ...newRole, default_runtime: "codex" });
assert.strictEqual(codexDefault.runtime, "codex");
assert.strictEqual(codexDefault.command, "codex");

// --- old flat schema (back-compat) ---
const oldRole = {
  id: "legacy",
  command: "claude",
  args: ["--foo"],
  persona_file: "CLAUDE.md",
  codex_instructions_file: "RTK.md",
  model: "opus"
};
const oldDef = resolveRuntime(oldRole);
assert.strictEqual(oldDef.command, "claude");
assert.deepStrictEqual(oldDef.args, ["--foo"]);
assert.strictEqual(oldDef.instructionsFile, "CLAUDE.md");
assert.strictEqual(oldDef.model, "opus", "legacy top-level model honored for claude runtime");
const oldCodex = resolveRuntime(oldRole, "codex");
assert.strictEqual(oldCodex.instructionsFile, "RTK.md", "old codex instructions from codex_instructions_file");
assert.strictEqual(oldCodex.model, "", "legacy top-level model must NOT leak to codex (claude-only alias)");
const oldKimi = resolveRuntime(oldRole, "kimi");
assert.strictEqual(oldKimi.model, "", "legacy top-level model must NOT leak to kimi");

// --- missing everything → claude defaults ---
const bare = resolveRuntime({ id: "x" });
assert.strictEqual(bare.command, "claude");
assert.deepStrictEqual(bare.args, ["--dangerously-skip-permissions"]);
assert.strictEqual(bare.instructionsFile, "CLAUDE.md");

// --- agent with type hint ---
const codexAgent = resolveRuntime({ id: "c", type: "codex", command: "codex", args: ["--no-alt-screen"] });
assert.strictEqual(codexAgent.runtime, "codex");
assert.deepStrictEqual(codexAgent.args, ["--no-alt-screen"]);

console.log("role runtime smoke passed");
