// Agent detection helpers, kept free of Electron and main-process state so they can be
// unit-tested in isolation (see scripts/agent-detect-smoke.cjs). The main process injects
// its PATH-resolution helpers and preset list; nothing here reaches into module globals.

const path = require("path");
const { execFileSync } = require("child_process");

const AGENT_PRESET_FIELDS = new Set([
  "id", "name", "command", "args", "cwd", "enabled", "provider", "permission_mode"
]);

// Strip detection-only metadata (versionArgs/docUrl) so persisted agent configs stay
// clean and round-trip without dragging probe hints along.
function presetToAgentTemplate(preset) {
  const template = {};
  for (const key of Object.keys(preset || {})) {
    if (AGENT_PRESET_FIELDS.has(key)) {
      template[key] = preset[key];
    }
  }
  return template;
}

function splitPathList(value, delimiter = path.delimiter) {
  return String(value || "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Prepend known executable directories onto PATH so version probes for Node-based CLIs
// (claude/codex/kimi) can find their `node` interpreter. Without this a perfectly
// installed CLI gets misreported as "installed but not runnable".
function buildAugmentedEnv(searchDirs, baseEnv = process.env) {
  const currentPath = String(baseEnv.PATH || "");
  const mergedPath = [...searchDirs, ...splitPathList(currentPath)]
    .filter((entry, index, all) => entry && all.indexOf(entry) === index)
    .join(path.delimiter);
  return { ...baseEnv, PATH: mergedPath };
}

// Best-effort label for where an executable came from. UI hint only; never load-bearing.
function inferSource(resolvedPath) {
  const value = String(resolvedPath || "");
  if (/[\\/]\.nvm[\\/]/.test(value)) return "nvm";
  if (/[\\/]\.fnm[\\/]/.test(value) || /[\\/]fnm[\\/]/.test(value)) return "fnm";
  if (/[\\/]\.volta[\\/]/.test(value)) return "volta";
  if (/homebrew[\\/]/.test(value) || /[\\/]opt[\\/]homebrew[\\/]/.test(value)) return "homebrew";
  if (/[\\/]\.bun[\\/]/.test(value)) return "bun";
  if (/[\\/]\.cargo[\\/]/.test(value)) return "cargo";
  if (/[\\/]\.deno[\\/]/.test(value)) return "deno";
  if (/[\\/]\.asdf[\\/]/.test(value) || /[\\/]\.local[\\/]share[\\/]mise[\\/]/.test(value)) return "version-manager";
  return "path";
}

function extractVersionString(output) {
  const text = String(output || "");
  const match = text.match(/\d+\.\d+(?:\.\d+)?[\w.-]*/);
  if (match) {
    return match[0];
  }
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 40) : null;
}

// Probe a single known agent type: resolve on PATH, then run its version command to
// confirm it actually runs. Mirrors cc-switch's scan_cli_version model.
//
// deps:
//   resolveExecutableCommand(command) -> absolute path string or "" if not found
//   searchDirs() -> array of directories to prepend onto PATH for the probe
//   runVersion(resolvedPath, args, env) -> stdout string (throws if the probe fails)
function detectAgentType(preset, deps) {
  const { resolveExecutableCommand, searchDirs, runVersion } = deps;
  const resolved = resolveExecutableCommand(preset.command);
  if (!resolved) {
    return {
      type: preset.id,
      name: preset.name,
      command: preset.command,
      provider: preset.provider || null,
      installed: false,
      runnable: false,
      version: null,
      path: null,
      source: null,
      diagnostic: null,
      docUrl: preset.docUrl || null
    };
  }
  let version = null;
  let runnable = false;
  let diagnostic = null;
  try {
    const env = buildAugmentedEnv(searchDirs ? searchDirs() : []);
    const out = runVersion(resolved, preset.versionArgs || ["--version"], env);
    version = extractVersionString(out);
    runnable = true;
  } catch (error) {
    diagnostic = String(error?.message || error).slice(0, 200);
  }
  return {
    type: preset.id,
    name: preset.name,
    command: preset.command,
    provider: preset.provider || null,
    installed: true,
    runnable,
    version,
    path: resolved,
    source: inferSource(resolved),
    diagnostic,
    docUrl: preset.docUrl || null
  };
}

function detectAllAgentTypes(presets, deps) {
  return presets.map((preset) => detectAgentType(preset, deps));
}

// Default version runner used by the main process. Split out so smoke tests can inject a
// fake instead of spawning real processes.
function defaultRunVersion(resolvedPath, args, env) {
  return execFileSync(resolvedPath, args, {
    encoding: "utf8",
    timeout: 3000,
    env
  });
}

// Generate a unique instance id for a type, e.g. claude-1, claude-2. takenIds is a Set
// of ids already in use across the config and the current import batch.
function instanceIdFor(type, takenIds) {
  const base = String(type || "agent").trim() || "agent";
  let n = 1;
  let candidate = `${base}-${n}`;
  while (takenIds.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

module.exports = {
  AGENT_PRESET_FIELDS,
  presetToAgentTemplate,
  buildAugmentedEnv,
  inferSource,
  extractVersionString,
  detectAgentType,
  detectAllAgentTypes,
  defaultRunVersion,
  instanceIdFor
};
