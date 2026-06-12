# Feature Spec: Live Docs File Tree Refresh

Date: 2026-06-11
Status: Implemented
Owner: AI Teams

## Summary

The desktop app should refresh the left sidebar `Files` tree when files under the active workspace `docs/` directory are created, changed, renamed, or deleted.

The preferred implementation is a main-process file watcher on `DOCS_DIR` that emits a debounced `documents:changed` event to renderer windows. The renderer keeps the existing `documents:list` IPC call as the single source of truth and reloads the document tree after receiving the event.

This fixes the current behavior where an agent can create a file such as:

```text
docs/issues/20260611-project-audit.md
```

but the sidebar still shows the old document snapshot until the app is reloaded or the workspace is switched.

## Problem Statement

`src/main/main.cjs` already scans `docs/` recursively through `listDocuments()`. The scanner can see nested folders such as `docs/features` and `docs/issues`.

The missing piece is freshness. The renderer loads documents during startup and workspace changes, then keeps that snapshot in React state. Agent-created files do not currently trigger a document refresh.

Observed behavior:

- Codex creates `docs/issues/20260611-project-audit.md`.
- `git status --short` shows `?? docs/issues/`.
- The sidebar still reports `Files 6` and only shows the previously loaded `docs/features` files.
- Reloading the Electron window makes the new file appear.

## Goals

- Refresh the sidebar automatically when files under `docs/` change.
- Keep `documents:list` as the authoritative document index.
- Avoid adding a new dependency for the first implementation.
- Debounce bursty filesystem events from editors and agent writes.
- Recreate the watcher when the active workspace changes.
- Close the watcher during app shutdown and before switching workspaces.
- Keep pin/unpin and handoff behavior unchanged.

## Non-Goals

- Do not replace the current recursive document scanner.
- Do not introduce a database or persistent document index.
- Do not watch the entire workspace root.
- Do not refresh terminal panes or agent status from document events.
- Do not require agents to call a special API after writing docs.

## Proposed Architecture

### Event Flow

```text
Agent writes docs/issues/new-file.md
        |
main process fs.watch(DOCS_DIR)
        |
debounced documents:changed event
        |
preload exposes api.onDocumentsChanged()
        |
renderer calls api.listDocuments("")
        |
sidebar Files tree updates
```

### Main Process

Add a small watcher lifecycle around the active workspace's `DOCS_DIR`.

Suggested state:

```js
let documentsWatcher = null;
let documentsChangeTimer = null;
```

Suggested helpers:

```js
function emitDocumentsChanged() {
  emit("documents:changed", {
    root: DOCS_DIR,
    workspaceRoot: WORKSPACE_ROOT,
    changedAt: nowIso()
  });
}

function scheduleDocumentsChanged() {
  clearTimeout(documentsChangeTimer);
  documentsChangeTimer = setTimeout(() => {
    documentsChangeTimer = null;
    emitDocumentsChanged();
  }, 200);
}

function startDocumentsWatcher() {
  stopDocumentsWatcher();
  ensureDir(DOCS_DIR);
  try {
    documentsWatcher = fs.watch(DOCS_DIR, { recursive: true }, scheduleDocumentsChanged);
  } catch (error) {
    console.warn(`documents watcher failed: ${error.message}`);
  }
}

function stopDocumentsWatcher() {
  if (documentsChangeTimer) {
    clearTimeout(documentsChangeTimer);
    documentsChangeTimer = null;
  }
  if (documentsWatcher) {
    documentsWatcher.close();
    documentsWatcher = null;
  }
}
```

Integration points:

- Call `startDocumentsWatcher()` after `ensureWorkspaceDirs()` during app startup.
- Call `stopDocumentsWatcher()` before `setWorkspaceRoot(nextRoot)` in `switchWorkspace()`.
- Call `startDocumentsWatcher()` after the new workspace is prepared in `switchWorkspace()`.
- Call `stopDocumentsWatcher()` during `before-quit`.

### Preload Bridge

Expose a renderer-safe event subscription:

```js
onDocumentsChanged: (callback) => {
  const wrapped = (_event, payload) => callback(payload);
  ipcRenderer.on("documents:changed", wrapped);
  listeners.add(["documents:changed", wrapped]);
  return () => ipcRenderer.removeListener("documents:changed", wrapped);
}
```

This follows the existing `onWorkspaceChanged`, `onAgentStatus`, and `onRouteVerify` patterns.

### Renderer

Subscribe during app initialization:

```js
const offDocumentsChanged = api.onDocumentsChanged?.(() => {
  refreshDocuments().catch((error) => setNotice(error.message));
}) || (() => {});
```

Cleanup should happen in the same `useEffect` return block as the other IPC subscriptions.

The renderer should not trust the watcher payload as document data. It should treat it only as an invalidation signal and continue to call `documents:list`.

## Debounce Policy

Use a short debounce window, initially `200ms`.

Reasons:

- Many tools write by creating a temp file and then renaming it.
- Markdown saves may emit multiple `rename` and `change` events.
- Agent-generated directories can trigger one event for the directory and another for the file.

The debounce should be in the main process, not the renderer, so every renderer window receives a stable invalidation event.

## Cross-Platform Notes

The first implementation can use:

```js
fs.watch(DOCS_DIR, { recursive: true }, callback)
```

This is acceptable for the current macOS-focused desktop workflow.

Known limitations:

- Recursive `fs.watch` behavior differs by platform.
- Some platforms may miss nested directory events.
- Some editors emit noisy event sequences.

Fallback policy for this feature:

- If watcher creation fails, log a warning and keep the app usable.
- The existing startup, workspace switch, pin/unpin, and manual reload paths still work.
- A future follow-up can add `chokidar` or low-frequency polling if Linux support becomes a requirement.

## Workspace Switching

Workspace switching must not leak watchers from the previous project.

Required order:

1. Stop the current documents watcher.
2. Release the current workspace backend.
3. Set the new workspace root.
4. Ensure workspace directories exist.
5. Start a new documents watcher for the new `DOCS_DIR`.
6. Emit `workspace:changed`.

This prevents old workspace file changes from refreshing the new workspace UI.

## Error Handling

Watcher failures should not block app startup.

Expected behavior:

- `documents:list` remains available even if the watcher fails.
- A watcher setup failure logs to the main-process console.
- Renderer notices are reserved for user-actionable errors, such as `documents:list` failing after an invalidation.

## Implementation Plan

1. Add watcher state and lifecycle helpers to `src/main/main.cjs`.
2. Emit `documents:changed` from the main process after debounced file changes.
3. Start the watcher during app startup.
4. Stop and restart the watcher during workspace switching.
5. Stop the watcher during app shutdown.
6. Add `onDocumentsChanged` to `src/main/preload.cjs`.
7. Subscribe in `src/renderer/App.jsx` and call the existing `refreshDocuments()`.
8. Verify with build, doctor, and PTY smoke tests.

## Acceptance Criteria

### Live File Creation

Run the desktop app:

```bash
npm run dev
```

Create a new markdown file while the app is open:

```bash
mkdir -p docs/issues
printf '# Test Issue\n' > docs/issues/watcher-test.md
```

Expected:

- The sidebar updates without reloading the app.
- `docs > issues > watcher-test.md` appears in the Files tree.
- The Files count increases.
- The Handoff select includes `docs/issues/watcher-test.md`.

### Live File Deletion

Delete the test file:

```bash
rm docs/issues/watcher-test.md
```

Expected:

- The file disappears from the sidebar without reloading.
- The Files count decreases.
- The Handoff select no longer includes the deleted file.

### Workspace Switch

Switch to another project with a different `docs/` tree.

Expected:

- The watcher follows the selected workspace.
- Changes in the old workspace no longer refresh the current UI.
- Changes in the new workspace refresh the current UI.

### Verification Commands

Before finishing the implementation, run:

```bash
npm run build
npm run doctor
npm run smoke:pty
```

## Risks

- `fs.watch` recursive behavior may vary outside macOS and Windows.
- Files written through atomic rename may generate duplicate events, which the debounce should absorb.
- Very large `docs/` trees still require a full rescan after each invalidation.

## Future Enhancements

- Replace `fs.watch` with `chokidar` if cross-platform recursive watching becomes important.
- Add a fallback polling mode when watcher setup fails.
- Include the changed relative path in the payload for diagnostics.
- Add a small refresh indicator in the Files heading if document scans become slow.
