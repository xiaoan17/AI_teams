"use strict";

// Smoke test for src/main/logger.cjs — runs in plain Node (no Electron needed)
// by injecting a fake `app`. Verifies the contract that matters for triage:
//   - logs land in <userData>/logs/main-YYYY-MM-DD.log
//   - every line is valid JSON with {ts, level, scope, proc, msg}
//   - structured context is merged onto the record
//   - Error objects are serialized (name/message/stack)
//   - level filtering honors AITEAMS_LOG_LEVEL
//   - retention prune deletes stale daily files

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "aiteams-log-smoke-"));
const logsDir = path.join(tmpUserData, "logs");

// Plant a stale daily file that prune should remove (16 days old > 14d window).
fs.mkdirSync(logsDir, { recursive: true });
const staleFile = path.join(logsDir, "main-2000-01-01.log");
fs.writeFileSync(staleFile, "{}\n");
const staleTime = Date.now() - 16 * 24 * 60 * 60 * 1000;
fs.utimesSync(staleFile, new Date(staleTime), new Date(staleTime));

// Fake Electron app. initLogger only needs getPath + isPackaged.
const fakeApp = {
  isPackaged: false,
  getPath: () => tmpUserData
};

process.env.AITEAMS_LOG_LEVEL = "info"; // debug must be filtered out

const { initLogger, scoped, getLogsDir } = require("../src/main/logger.cjs");
initLogger(fakeApp, { userDataDir: tmpUserData });

assert.strictEqual(getLogsDir(), logsDir, "logs dir should resolve under userData");
assert.ok(!fs.existsSync(staleFile), "stale daily log should be pruned");

const log = scoped("tmux");
log.debug("should be filtered", { hidden: true });
log.info("agent started", { agentId: "a1", pane: "%3" });
log.warn("reap incomplete", { agentId: "a1", pid: 4242, reason: "timeout" });
log.error("fatal boom", new Error("kaboom"));

// electron-log writes synchronously to file by default; give the FS a beat.
function readLines() {
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const file = path.join(logsDir, `main-${stamp}.log`);
  assert.ok(fs.existsSync(file), `today's log file should exist: ${file}`);
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        assert.fail(`log line is not valid JSON: ${line}`);
      }
    });
}

setTimeout(() => {
  const records = readLines();

  // Required fields on every record.
  for (const rec of records) {
    for (const field of ["ts", "level", "scope", "proc", "msg"]) {
      assert.ok(field in rec, `record missing field ${field}: ${JSON.stringify(rec)}`);
    }
    assert.ok(!Number.isNaN(Date.parse(rec.ts)), `ts not ISO: ${rec.ts}`);
  }

  // debug filtered out by AITEAMS_LOG_LEVEL=info.
  assert.ok(!records.some((r) => r.msg === "should be filtered"), "debug must be filtered at info level");

  const info = records.find((r) => r.msg === "agent started");
  assert.ok(info, "info record present");
  assert.strictEqual(info.level, "info");
  assert.strictEqual(info.scope, "tmux");
  assert.strictEqual(info.agentId, "a1");
  assert.strictEqual(info.pane, "%3");

  const warn = records.find((r) => r.msg === "reap incomplete");
  assert.ok(warn, "warn record present");
  assert.strictEqual(warn.pid, 4242);
  assert.strictEqual(warn.reason, "timeout");

  const err = records.find((r) => r.msg === "fatal boom");
  assert.ok(err, "error record present");
  assert.strictEqual(err.level, "error");
  assert.ok(err.error && err.error.message === "kaboom", "Error serialized with message");
  assert.ok(err.error.stack && err.error.stack.includes("kaboom"), "Error stack captured");

  // Cleanup.
  fs.rmSync(tmpUserData, { recursive: true, force: true });

  console.log(`logger smoke OK — ${records.length} records, fields + filtering + Error serialization + prune verified`);
}, 200);
