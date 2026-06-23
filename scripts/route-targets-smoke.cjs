const assert = require("assert");
const {
  resolveMentionTargets,
  routeMentionIndex,
  routeTargetUnavailable,
  uniqueRouteTargets
} = require("../src/main/route-targets.cjs");

const activeAgents = [
  { id: "fullstack", enabled: true, status: "running_or_idle" },
  { id: "design", enabled: true, status: "waiting_input" },
  { id: "manager", enabled: true, status: "running_or_idle" }
];

assert.strictEqual(routeMentionIndex("1"), 0);
assert.strictEqual(routeMentionIndex("3"), 2);
assert.strictEqual(routeMentionIndex("0"), -1);
assert.strictEqual(routeMentionIndex("manager"), -1);

assert.deepStrictEqual(resolveMentionTargets(["1"], activeAgents), {
  targets: ["fullstack"],
  invalid: []
});
assert.deepStrictEqual(resolveMentionTargets(["2", "3"], activeAgents), {
  targets: ["design", "manager"],
  invalid: []
});
assert.deepStrictEqual(resolveMentionTargets(["all"], activeAgents), {
  targets: ["fullstack", "design", "manager"],
  invalid: []
});
assert.deepStrictEqual(resolveMentionTargets(["all", "2", "fullstack"], activeAgents), {
  targets: ["fullstack", "design", "manager"],
  invalid: []
});
assert.deepStrictEqual(resolveMentionTargets(["all", "4"], activeAgents), {
  targets: ["fullstack", "design", "manager"],
  invalid: ["@4"]
});
assert.deepStrictEqual(resolveMentionTargets(["4"], activeAgents), {
  targets: [],
  invalid: ["@4"]
});
assert.deepStrictEqual(resolveMentionTargets(["unknown"], activeAgents), {
  targets: [],
  invalid: ["@unknown"]
});

assert.deepStrictEqual(uniqueRouteTargets(["fullstack", "fullstack", "manager"]), ["fullstack", "manager"]);
assert.strictEqual(routeTargetUnavailable({ status: "stopped" }), true);
assert.strictEqual(routeTargetUnavailable({ status: "pane_missing" }), true);
assert.strictEqual(routeTargetUnavailable({ status: "waiting_input" }), false);
assert.strictEqual(routeTargetUnavailable({ status: "running_or_idle" }), false);

console.log("route-targets smoke passed");
