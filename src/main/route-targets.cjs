function routeMentionIndex(token) {
  return /^[1-9]\d*$/.test(token) ? Number(token) - 1 : -1;
}

function uniqueRouteTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (seen.has(target)) return false;
    seen.add(target);
    return true;
  });
}

function routeTargetUnavailable(agent) {
  return (
    agent.status === "stopped" ||
    agent.status === "exited" ||
    agent.status === "error" ||
    agent.status === "missing_runtime" ||
    agent.status === "pane_missing"
  );
}

function resolveMentionTargets(mentions, activeList) {
  const activeAgents = Array.isArray(activeList) ? activeList : [];
  const activeSet = new Set(activeAgents.map((agent) => agent.id));
  const invalid = [];
  let targets = [];

  for (const mention of mentions) {
    if (String(mention).toLowerCase() === "all") {
      targets.push(...activeAgents.map((agent) => agent.id));
      continue;
    }
    const index = routeMentionIndex(mention);
    if (index >= 0) {
      const agent = activeAgents[index];
      if (agent) {
        targets.push(agent.id);
      } else {
        invalid.push(`@${mention}`);
      }
      continue;
    }
    if (activeSet.has(mention)) {
      targets.push(mention);
    } else {
      invalid.push(`@${mention}`);
    }
  }

  return {
    targets: uniqueRouteTargets(targets),
    invalid
  };
}

module.exports = {
  resolveMentionTargets,
  routeMentionIndex,
  routeTargetUnavailable,
  uniqueRouteTargets
};
