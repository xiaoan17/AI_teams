// Renderer-side logging. Funnels UI errors into the same file the main process
// writes (userData/logs/main-*.log) via electron-log's IPC bridge, which the
// main process wires up through log.initialize().
//
// Records land with proc:"renderer" so they're easy to filter:
//   jq 'select(.proc=="renderer")' main-*.log
import log from "electron-log/renderer";

const uiLog = log.scope("ui");

let installed = false;

// Capture the two failure modes a renderer surfaces that otherwise vanish:
// synchronous throws (window 'error') and rejected promises with no .catch.
export function installRendererLogging() {
  if (installed || typeof window === "undefined") return uiLog;
  installed = true;

  window.addEventListener("error", (event) => {
    const err = event.error || new Error(event.message || "window error");
    uiLog.error("uncaught window error", {
      message: err.message,
      stack: err.stack,
      source: event.filename,
      line: event.lineno,
      col: event.colno
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    uiLog.error("unhandled promise rejection", {
      message: reason && reason.message ? reason.message : String(reason),
      stack: reason && reason.stack ? reason.stack : undefined
    });
  });

  uiLog.info("renderer logging installed");
  return uiLog;
}

export { uiLog };
export default uiLog;
