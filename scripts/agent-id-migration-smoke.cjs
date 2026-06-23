const assert = require("assert");
const {
  migrateLegacyAgentIds,
  migrateRuntimeAgentIds
} = require("../src/main/agent-id-migration.cjs");

const migratedConfig = migrateLegacyAgentIds({
  routing: { default_agent: "kimi" },
  agents: [
    { id: "codex", name: "全栈工程师", command: "codex" },
    { id: "claude", name: "UI/UX 设计师", command: "claude" },
    { id: "kimi", name: "工程经理", command: "kimi" }
  ]
});

assert.deepStrictEqual(migratedConfig.agents.map((agent) => agent.id), ["fullstack", "design", "manager"]);
assert.strictEqual(migratedConfig.agents[0].legacy_id, "codex");
assert.strictEqual(migratedConfig.agents[0].type, "codex");
assert.strictEqual(migratedConfig.agents[1].legacy_id, "claude");
assert.strictEqual(migratedConfig.agents[1].type, "claude");
assert.strictEqual(migratedConfig.agents[2].legacy_id, "kimi");
assert.strictEqual(migratedConfig.agents[2].type, "kimi");
assert.strictEqual(migratedConfig.routing.default_agent, "manager");

const configWithExistingNewId = migrateLegacyAgentIds({
  routing: { default_agent: "codex" },
  agents: [
    { id: "codex", command: "codex" },
    { id: "fullstack", command: "claude" }
  ]
});
assert.deepStrictEqual(configWithExistingNewId.agents.map((agent) => agent.id), ["codex", "fullstack"]);
assert.strictEqual(configWithExistingNewId.routing.default_agent, "codex");

const migratedRuntime = migrateRuntimeAgentIds({
  agents: {
    codex: { pane: "%1" },
    claude: { pane: "%2" },
    kimi: { pane: "%3" }
  }
}, migratedConfig.agents);

assert.strictEqual(migratedRuntime.changed, true);
assert.deepStrictEqual(migratedRuntime.runtime.agents.fullstack, { pane: "%1" });
assert.deepStrictEqual(migratedRuntime.runtime.agents.design, { pane: "%2" });
assert.deepStrictEqual(migratedRuntime.runtime.agents.manager, { pane: "%3" });
assert.deepStrictEqual(migratedRuntime.runtime.agents.codex, { pane: "%1" });

console.log("agent id migration smoke passed");
