const assert = require("assert");
const { execFileSync } = require("child_process");
const {
  presetToAgentTemplate,
  buildAugmentedEnv,
  inferSource,
  extractVersionString,
  detectAgentType,
  detectAllAgentTypes,
  defaultRunVersion,
  instanceIdFor
} = require("../src/main/agent-detect.cjs");

// --- presetToAgentTemplate: detection-only fields are stripped ---------------------------
const template = presetToAgentTemplate({
  id: "claude",
  name: "Claude Code",
  command: "claude",
  args: [],
  cwd: ".",
  enabled: true,
  provider: "anthropic",
  permission_mode: "configure-before-start",
  versionArgs: ["--version"],
  docUrl: "https://example.com"
});
assert.strictEqual(template.id, "claude");
assert.strictEqual(template.provider, "anthropic");
assert.strictEqual(template.versionArgs, undefined, "versionArgs must not leak into config");
assert.strictEqual(template.docUrl, undefined, "docUrl must not leak into config");

// --- extractVersionString --------------------------------------------------------------
assert.strictEqual(extractVersionString("claude version 1.2.3 (build x)"), "1.2.3");
assert.strictEqual(extractVersionString("v0.10"), "0.10");
assert.strictEqual(extractVersionString(""), null);
assert.strictEqual(extractVersionString("no-numbers-here").length > 0, true);

// --- inferSource -----------------------------------------------------------------------
assert.strictEqual(inferSource("/homebrew/bin/codex"), "homebrew");
assert.strictEqual(inferSource("/tmp/user/.nvm/versions/node/v20/bin/claude"), "nvm");
assert.strictEqual(inferSource("/tmp/user/.volta/bin/kimi"), "volta");
assert.strictEqual(inferSource("/usr/local/bin/gemini"), "path");

// --- buildAugmentedEnv: search dirs are prepended onto PATH, deduped ---------------------
const env = buildAugmentedEnv(["/homebrew/bin", "/usr/local/bin"], { PATH: "/usr/local/bin:/bin" });
const parts = env.PATH.split(require("path").delimiter);
assert.strictEqual(parts[0], "/homebrew/bin");
assert.strictEqual(parts.filter((p) => p === "/usr/local/bin").length, 1, "PATH entries must be deduped");

// --- instanceIdFor: increments until free ----------------------------------------------
assert.strictEqual(instanceIdFor("claude", new Set()), "claude-1");
assert.strictEqual(instanceIdFor("claude", new Set(["claude-1"])), "claude-2");
assert.strictEqual(instanceIdFor("claude", new Set(["claude-1", "claude-2"])), "claude-3");

// --- detectAgentType: not installed -----------------------------------------------------
const missing = detectAgentType(
  { id: "kimi", name: "Kimi", command: "kimi", docUrl: "https://example.com" },
  {
    resolveExecutableCommand: () => "",
    searchDirs: () => [],
    runVersion: () => { throw new Error("should not run"); }
  }
);
assert.strictEqual(missing.installed, false);
assert.strictEqual(missing.runnable, false);
assert.strictEqual(missing.version, null);
assert.strictEqual(missing.docUrl, "https://example.com");

// --- detectAgentType: installed and runnable --------------------------------------------
const runnable = detectAgentType(
  { id: "claude", name: "Claude Code", command: "claude", provider: "anthropic", versionArgs: ["--version"] },
  {
    resolveExecutableCommand: () => "/homebrew/bin/claude",
    searchDirs: () => ["/homebrew/bin"],
    runVersion: () => "claude 1.4.2"
  }
);
assert.strictEqual(runnable.installed, true);
assert.strictEqual(runnable.runnable, true);
assert.strictEqual(runnable.version, "1.4.2");
assert.strictEqual(runnable.source, "homebrew");
assert.strictEqual(runnable.provider, "anthropic");

// --- detectAgentType: installed but not runnable ----------------------------------------
const broken = detectAgentType(
  { id: "gemini", name: "Gemini CLI", command: "gemini" },
  {
    resolveExecutableCommand: () => "/usr/local/bin/gemini",
    searchDirs: () => [],
    runVersion: () => { throw new Error("spawn ENOENT node"); }
  }
);
assert.strictEqual(broken.installed, true);
assert.strictEqual(broken.runnable, false);
assert.strictEqual(broken.version, null);
assert.ok(broken.diagnostic && broken.diagnostic.includes("ENOENT"), "diagnostic should carry the failure");

// --- detectAllAgentTypes maps over presets ----------------------------------------------
const all = detectAllAgentTypes(
  [
    { id: "a", name: "A", command: "a" },
    { id: "b", name: "B", command: "b" }
  ],
  {
    resolveExecutableCommand: (cmd) => (cmd === "a" ? "/bin/a" : ""),
    searchDirs: () => [],
    runVersion: () => "9.9.9"
  }
);
assert.strictEqual(all.length, 2);
assert.strictEqual(all[0].type, "a");
assert.strictEqual(all[0].runnable, true);
assert.strictEqual(all[1].installed, false);

// --- End-to-end: probe the real `node` binary via defaultRunVersion ----------------------
// node is guaranteed present in this test runner; use it to exercise the real spawn path.
const nodePath = process.execPath;
const e2e = detectAgentType(
  { id: "node", name: "Node", command: "node", versionArgs: ["--version"] },
  {
    resolveExecutableCommand: () => nodePath,
    searchDirs: () => [],
    runVersion: defaultRunVersion
  }
);
assert.strictEqual(e2e.installed, true);
assert.strictEqual(e2e.runnable, true, `node --version probe should succeed, got: ${e2e.diagnostic}`);
assert.ok(/^\d+\.\d+\.\d+/.test(e2e.version), `expected a semver-ish node version, got: ${e2e.version}`);

console.log("agent detect smoke passed");
