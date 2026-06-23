// Shared role/agent runtime resolution. Bridges the old flat role schema
// (top-level command/args/persona_file/codex_instructions_file) and the new
// runtimes schema (runtimes.{claude,codex} + default_runtime + autonomy), so
// consumers can read a single normalized view regardless of which schema a
// role.json or agent uses.

const path = require("path");

const DEFAULTS = {
  claude: { command: "claude", args: ["--dangerously-skip-permissions"], instructionsFile: "CLAUDE.md", skillsDir: ".claude/skills" },
  codex: { command: "codex", args: [], instructionsFile: "AGENTS.md", skillsDir: ".codex/skills" }
};

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

// Infer the runtime family ("claude" / "codex" / other) from an explicit field
// or the command basename.
function inferFamily(source) {
  const type = String(source?.type || source?.default_runtime || "").trim().toLowerCase();
  if (type) {
    return type;
  }
  const command = source?.command
    || (source?.runtimes && source.default_runtime && source.runtimes[source.default_runtime]?.command);
  return path.basename(String(command || "claude").trim()).toLowerCase();
}

// List the runtimes a role/agent defines. New schema → keys of runtimes.
// Old schema → a single synthetic runtime derived from the flat fields.
function runtimeFamilyList(source) {
  if (source?.runtimes && typeof source.runtimes === "object") {
    const keys = Object.keys(source.runtimes);
    if (keys.length) {
      return keys;
    }
  }
  return [inferFamily(source)];
}

// Resolve the effective runtime config for a role template or agent.
// runtimeName: optional; defaults to default_runtime, then inferred family.
// Returns { runtime, command, args, instructionsFile, skillsDir }.
function resolveRuntime(source = {}, runtimeName) {
  const runtimes = source.runtimes && typeof source.runtimes === "object" ? source.runtimes : null;
  const runtime = String(
    runtimeName
    || source.default_runtime
    || (runtimes ? Object.keys(runtimes)[0] : "")
    || inferFamily(source)
  ).trim().toLowerCase() || "claude";

  const fallback = DEFAULTS[runtime] || DEFAULTS.claude;

  if (runtimes && runtimes[runtime] && typeof runtimes[runtime] === "object") {
    const rt = runtimes[runtime];
    return {
      runtime,
      command: String(rt.command || fallback.command),
      args: asArray(rt.args),
      instructionsFile: String(rt.instructions_file || source.persona_file || fallback.instructionsFile),
      skillsDir: String(rt.skills_dir || fallback.skillsDir),
      // Per-runtime model. Each CLI has its own alias space (claude=opus,
      // codex=gpt-5.2, kimi=kimi-k2), so model lives inside each runtime block.
      // Empty string means "don't inject" — fall back to the CLI's own default.
      model: typeof rt.model === "string" ? rt.model.trim() : ""
    };
  }

  // Old flat schema (or runtime not present): read top-level fields.
  // For codex in the legacy schema, the historical default instructions file is
  // RTK.md (new schema uses AGENTS.md via runtimes).
  const isCodex = runtime === "codex";
  return {
    runtime,
    command: String(source.command || fallback.command),
    args: asArray(source.args).length ? asArray(source.args) : (source.command ? [] : fallback.args),
    instructionsFile: String(
      (isCodex ? source.codex_instructions_file : source.persona_file)
      || (isCodex ? "RTK.md" : source.persona_file)
      || fallback.instructionsFile
    ),
    skillsDir: fallback.skillsDir,
    // Legacy top-level `model` was a single string historically meaning the
    // Claude alias (e.g. "opus"). Only honor it for the claude runtime; other
    // families must not inherit a claude-only alias (it would crash codex/kimi).
    model: runtime === "claude" && typeof source.model === "string" ? source.model.trim() : ""
  };
}

module.exports = { resolveRuntime, runtimeFamilyList, inferFamily, DEFAULTS };
