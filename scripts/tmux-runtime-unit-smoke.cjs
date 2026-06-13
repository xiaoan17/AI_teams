const assert = require("assert");
const {
  parseTmuxAgentPaneTable,
  parseTmuxPaneTable,
  reconcileRuntimePanesFromTable
} = require("../src/main/tmux-runtime.cjs");

const paneTable = [
  "%10\t0\t@1\tcodex",
  "%11\t1\t@2\tclaude",
  "%12\t0\t@3\tkimi",
  "%13\t0\t@4\tcodex"
].join("\n");

const panes = parseTmuxPaneTable(paneTable);
assert.deepStrictEqual(panes.get("%10"), { dead: false, windowId: "@1" });
assert.deepStrictEqual(panes.get("%11"), { dead: true, windowId: "@2" });

const agents = parseTmuxAgentPaneTable(paneTable);
assert.deepStrictEqual(agents.get("codex"), { pane: "%10", dead: false });
assert.strictEqual(agents.has("claude"), false);
assert.deepStrictEqual(agents.get("kimi"), { pane: "%12", dead: false });

const runtime = {
  agents: {
    codex: {
      pane: "%999",
      stopped: true,
      reason: "stopped by user",
      started_at: "old"
    },
    claude: {
      pane: "%11"
    }
  }
};

const result = reconcileRuntimePanesFromTable({
  agents: [
    { id: "codex", enabled: true },
    { id: "claude", enabled: true },
    { id: "kimi", enabled: false }
  ]
}, runtime, agents, {
  now: () => "now"
});

assert.strictEqual(result.changed, true);
assert.strictEqual(result.runtime.agents.codex.pane, "%10");
assert.strictEqual(result.runtime.agents.codex.stopped, false);
assert.strictEqual(result.runtime.agents.codex.reason, "");
assert.strictEqual(result.runtime.agents.codex.recovered_at, "now");
assert.strictEqual(result.runtime.agents.claude.pane, "%11");
assert.strictEqual(result.runtime.agents.kimi, undefined);

console.log("tmux runtime unit smoke passed");
