"use strict";

// Unified logging for the main process, built on electron-log v5.
//
// Design goals (see docs/features/20260613-error-warning-logging.md):
//   - Always persist to userData/logs as JSON Lines (one JSON object per line),
//     so issues can be triaged after the fact with jq / grep / scripts.
//   - Mirror to the console during development for an ergonomic dev loop.
//   - Rotate per day + prune old files so logs never grow unbounded.
//   - Capture uncaughtException / unhandledRejection globally.
//   - Funnel renderer-process errors into the same file via IPC.
//
// Usage:
//   const { initLogger, scoped } = require("./logger.cjs");
//   initLogger();                       // call once, before creating windows
//   const log = scoped("tmux");
//   log.warn("reap incomplete", { agentId, pane, reason });

const fs = require("fs");
const path = require("path");
const log = require("electron-log/main");

// Levels, low → high. AITEAMS_LOG_LEVEL gates what reaches each transport.
const VALID_LEVELS = ["debug", "info", "warn", "error"];
const DEFAULT_FILE_LEVEL = "info";
const DEFAULT_CONSOLE_LEVEL = "info";
const LOG_RETENTION_DAYS = 14;
const LOG_MAX_BYTES = 5 * 1024 * 1024; // rotate a daily file if it ever exceeds 5 MB

let initialized = false;
let logsDir = null;

function resolveLevel(envValue, fallback) {
  const value = String(envValue || "").trim().toLowerCase();
  return VALID_LEVELS.includes(value) ? value : fallback;
}

// Stable, machine-friendly date stamp without pulling in a date lib.
function dayStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function serializeLogValue(value, seen = new WeakSet()) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => serializeLogValue(item, seen));
  }
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] = serializeLogValue(item, seen);
  }
  return next;
}

// JSON Lines: each message becomes a single line of JSON. electron-log calls
// the format fn per message and expects it to return the array of args that
// the transport will write; returning a single pre-serialized string keeps the
// line atomic and prevents electron-log from re-formatting/inspecting it.
function jsonLineFormat({ message }) {
  const data = Array.isArray(message.data) ? message.data : [message.data];
  // First arg is the human message; any trailing object is structured context.
  let msg = "";
  let ctx;
  for (const part of data) {
    if (ctx === undefined && part !== null && typeof part === "object" && !(part instanceof Error)) {
      ctx = part;
    } else if (part instanceof Error) {
      ctx = Object.assign(ctx || {}, {
        error: serializeLogValue(part)
      });
    } else {
      msg = msg ? `${msg} ${String(part)}` : String(part);
    }
  }

  const record = {
    ts: message.date instanceof Date ? message.date.toISOString() : new Date().toISOString(),
    level: message.level,
    scope: message.scope || "main",
    proc: (message.variables && message.variables.processType) || "browser",
    msg
  };
  if (ctx && typeof ctx === "object") {
    for (const [k, v] of Object.entries(serializeLogValue(ctx))) {
      if (!(k in record)) record[k] = v;
    }
  }

  try {
    return [JSON.stringify(record)];
  } catch (_err) {
    // Circular or non-serializable context: fall back to a safe line.
    return [JSON.stringify({ ts: record.ts, level: record.level, scope: record.scope, msg, ctxError: "unserializable" })];
  }
}

// Delete daily log files older than the retention window.
function pruneOldLogs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_err) {
    return;
  }
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const name of entries) {
    if (!/^main-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    } catch (_err) {
      // best-effort cleanup; ignore
    }
  }
}

// Initialize once. `app` is passed in so this module has no hard dependency on
// Electron being ready and stays unit-testable.
function initLogger(app, options = {}) {
  if (initialized) return log;
  initialized = true;

  const userData = options.userDataDir
    || (app && typeof app.getPath === "function" ? app.getPath("userData") : process.cwd());
  logsDir = path.join(userData, "logs");
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (_err) {
    // If we can't create the dir, electron-log will surface its own error.
  }
  pruneOldLogs(logsDir);

  const fileLevel = resolveLevel(process.env.AITEAMS_LOG_LEVEL, DEFAULT_FILE_LEVEL);
  const consoleLevel = resolveLevel(
    process.env.AITEAMS_LOG_LEVEL,
    app && app.isPackaged ? "warn" : DEFAULT_CONSOLE_LEVEL
  );

  // File transport: JSON Lines, daily file, size-based rotation as a backstop.
  log.transports.file.level = fileLevel;
  log.transports.file.format = jsonLineFormat;
  log.transports.file.maxSize = LOG_MAX_BYTES;
  log.transports.file.resolvePathFn = () => path.join(logsDir, `main-${dayStamp()}.log`);
  log.transports.file.archiveLogFn = (oldFile) => {
    // On size overflow, stamp the rotated file with a time suffix and keep it.
    const file = oldFile.toString();
    const dir = path.dirname(file);
    const base = path.basename(file, ".log");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      fs.renameSync(file, path.join(dir, `${base}.${stamp}.log`));
    } catch (_err) {
      // ignore rotation failures; logging must never throw
    }
  };

  // Console transport: readable text, quieter in packaged builds.
  log.transports.console.level = consoleLevel;
  log.transports.console.format = "[{h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}";

  // Renderer bridge: inject electron-log's preload into all sessions so
  // `import 'electron-log/renderer'` and the preload `log` channel both land here.
  try {
    log.initialize();
  } catch (_err) {
    // initialize requires app ready; caller is responsible for ordering.
  }

  // Global crash capture. Keep the default dialog only in dev so packaged
  // users don't get a raw stack popup; everything still hits the file.
  log.errorHandler.startCatching({
    showDialog: !(app && app.isPackaged),
    onError({ error, processType }) {
      log.scope(processType === "renderer" ? "renderer" : "uncaught").error(
        error && error.message ? error.message : "unknown fatal error",
        error
      );
    }
  });

  log.scope("logger").info("logger initialized", {
    logsDir,
    fileLevel,
    consoleLevel,
    retentionDays: LOG_RETENTION_DAYS
  });

  return log;
}

// Return a namespaced logger. Each call is cheap; electron-log caches scopes.
function scoped(name) {
  return log.scope(name);
}

function getLogsDir() {
  return logsDir;
}

module.exports = { initLogger, scoped, getLogsDir, VALID_LEVELS };
