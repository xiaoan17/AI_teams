const assert = require("assert");
const { spawn } = require("child_process");
const {
  parsePsSnapshot,
  collectDescendants,
  killProcessTree
} = require("../src/main/process-tree.cjs");

// --- Unit: parsePsSnapshot tolerates headers, blanks, leading whitespace ---
const parsed = parsePsSnapshot(["  PID  PPID", " 100   1", "", "200 100", "garbage row"].join("\n"));
assert.deepStrictEqual(parsed, [
  { pid: 100, ppid: 1 },
  { pid: 200, ppid: 100 }
]);

// --- Unit: collectDescendants orders children before parents, root last ---
const snapshot = [
  { pid: 1, ppid: 0 },
  { pid: 100, ppid: 1 },   // root
  { pid: 200, ppid: 100 }, // child
  { pid: 300, ppid: 200 }, // grandchild (escaped pgid in reality)
  { pid: 400, ppid: 100 }, // child
  { pid: 999, ppid: 1 }    // unrelated sibling — must NOT be collected
];
const ordered = collectDescendants(100, snapshot);
assert.ok(!ordered.includes(999), "unrelated process must not be collected");
assert.ok(ordered.includes(200) && ordered.includes(300) && ordered.includes(400));
assert.strictEqual(ordered[ordered.length - 1], 100, "root must be signalled last");
assert.ok(ordered.indexOf(300) < ordered.indexOf(200), "grandchild before its parent");

// --- Unit: invalid / protected roots are refused ---
assert.deepStrictEqual(collectDescendants(1, snapshot), []);
assert.deepStrictEqual(collectDescendants(0, snapshot), []);
assert.deepStrictEqual(collectDescendants(NaN, snapshot), []);

// --- Unit: cyclic PPID data cannot loop ---
const cyclic = [{ pid: 10, ppid: 20 }, { pid: 20, ppid: 10 }];
assert.doesNotThrow(() => collectDescendants(10, cyclic));

// --- Unit: killProcessTree with injected seams, graceful drain ---
(async () => {
  let alive = new Set([500, 600, 700]);
  const fakeSnapshot = () => [
    { pid: 500, ppid: 1 },
    { pid: 600, ppid: 500 },
    { pid: 700, ppid: 600 }
  ].filter((row) => alive.has(row.pid));
  const signals = [];
  const sendSignal = (pid, sig) => {
    signals.push([pid, sig]);
    if (sig === "SIGTERM") {
      alive.delete(pid); // pretend it exits on TERM
    }
    return true;
  };
  const result = await killProcessTree(500, {
    psSnapshot: fakeSnapshot,
    sendSignal,
    sleep: () => Promise.resolve(),
    graceMs: 200,
    pollIntervalMs: 50
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "terminated gracefully");
  assert.deepStrictEqual(result.killed, [], "nothing should need SIGKILL");
  assert.ok(signals.every(([, sig]) => sig === "SIGTERM"));

  // --- Unit: stubborn process forces SIGKILL ---
  const stubborn = new Set([800]);
  const killSignals = [];
  const result2 = await killProcessTree(800, {
    psSnapshot: () => [{ pid: 800, ppid: 1 }].filter((row) => stubborn.has(row.pid)),
    sendSignal: (pid, sig) => {
      killSignals.push(sig);
      if (sig === "SIGKILL") {
        stubborn.delete(pid);
      }
      return true;
    },
    sleep: () => Promise.resolve(),
    graceMs: 100,
    pollIntervalMs: 50
  });
  assert.strictEqual(result2.reason, "forced after grace period");
  assert.ok(killSignals.includes("SIGKILL"), "stubborn process must get SIGKILL");

  // --- Integration: real fork tree, escaped process group via setsid-like detach ---
  // Parent sleeps; spawns a child that itself spawns a grandchild. We kill the
  // parent's tree by PID lineage and assert all three are gone.
  const parent = spawn("/bin/sh", [
    "-c",
    "sleep 30 & sub=$!; /bin/sh -c 'sleep 30' & wait"
  ], { detached: true, stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const rootPid = parent.pid;

  const before = collectDescendants(rootPid, parsePsSnapshot(
    require("child_process").execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
  ));
  assert.ok(before.length >= 2, `expected a real subtree, got ${before.length}`);

  const realResult = await killProcessTree(rootPid, { graceMs: 1500, pollIntervalMs: 100 });
  assert.strictEqual(realResult.ok, true);

  await new Promise((resolve) => setTimeout(resolve, 300));
  const after = collectDescendants(rootPid, parsePsSnapshot(
    require("child_process").execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
  ));
  assert.strictEqual(after.length, 0, `subtree must be fully reclaimed, survivors=${after.join(",")}`);

  console.log("process-tree smoke passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
