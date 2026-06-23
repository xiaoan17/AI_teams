const path = require("path");

const LEGACY_AGENT_ID_MAPPINGS = [
  { from: "codex", to: "fullstack", runtime: "claude" },
  { from: "claude", to: "design", runtime: "claude" },
  { from: "kimi", to: "manager", runtime: "kimi" }
];

const LEGACY_AGENT_ID_MAP = new Map(LEGACY_AGENT_ID_MAPPINGS.map((item) => [item.from, item]));

function migrateLegacyAgentIds(config) {
  if (!config || typeof config !== "object" || !Array.isArray(config.agents)) {
    return config;
  }
  const existingIds = new Set(config.agents.map((agent) => String(agent?.id || "").trim()).filter(Boolean));
  const migratedFrom = {};
  const agents = config.agents.map((agent) => {
    const id = String(agent?.id || "").trim();
    const mapping = LEGACY_AGENT_ID_MAP.get(id);
    if (!mapping || existingIds.has(mapping.to)) {
      return agent;
    }
    migratedFrom[id] = mapping.to;
    const runtime = String(agent?.type || "").trim()
      || path.basename(String(agent?.command || "").trim())
      || mapping.runtime;
    return {
      ...agent,
      id: mapping.to,
      type: runtime,
      legacy_id: agent?.legacy_id || id
    };
  });
  if (!Object.keys(migratedFrom).length) {
    return config;
  }
  const routing = config.routing && typeof config.routing === "object" ? { ...config.routing } : {};
  if (migratedFrom[routing.default_agent]) {
    routing.default_agent = migratedFrom[routing.default_agent];
  }
  return {
    ...config,
    routing,
    agents
  };
}

function migrateRuntimeAgentIds(runtime, agents = []) {
  if (!runtime || typeof runtime !== "object" || !runtime.agents || typeof runtime.agents !== "object") {
    return { runtime, changed: false };
  }
  let changed = false;
  const nextAgents = { ...runtime.agents };
  for (const agent of Array.isArray(agents) ? agents : []) {
    const id = String(agent?.id || "").trim();
    const legacyId = String(agent?.legacy_id || "").trim();
    if (!id || !legacyId || nextAgents[id] || !nextAgents[legacyId]) {
      continue;
    }
    nextAgents[id] = nextAgents[legacyId];
    changed = true;
  }
  if (!changed) {
    return { runtime, changed: false };
  }
  return {
    runtime: {
      ...runtime,
      agents: nextAgents
    },
    changed: true
  };
}

module.exports = {
  LEGACY_AGENT_ID_MAPPINGS,
  migrateLegacyAgentIds,
  migrateRuntimeAgentIds
};
