# Feature Spec: Tmux-Backed Terminal Sessions

Date: 2026-06-11
Status: Implemented (core slices 1-6; external terminal attach in slice 7 deferred by design)
Owner: AI Teams

## Summary

AI Teams should keep the current embedded three-panel terminal UI, but move agent process lifetime and terminal session persistence out of the Electron renderer/main-process-only path and into a mature terminal multiplexer backend.

Recommended direction:

1. Keep the embedded UI based on `xterm.js`.
2. Keep `node-pty` only as an adapter layer where useful, not as the sole source of process/session truth.
3. Make `tmux` the default durable session backend for real agents.
4. Add an optional "Open in external terminal" path later for Kitty/iTerm/Terminal, without making external terminals the core UI surface.

The existing `aiteam.py` already proves the tmux model: it starts enabled agents in tmux panes, records pane ids in runtime state, uses `capture-pane` for display recovery, uses buffer paste for message injection, and pipes raw terminal output to logs. The desktop app should converge on that runtime model instead of maintaining a parallel fragile PTY session model.

## Problem Statement

The current desktop terminal path is useful but thin:

- The renderer creates an `xterm.js` instance per enabled agent.
- The main process starts each agent directly with `node-pty`.
- Output is streamed over IPC as `agent:data`.
- A main-process memory buffer is used for recent output replay.
- If Electron restarts, renderer and main versions drift, or IPC is temporarily unavailable, terminal state can be lost or partially duplicated.

Observed failure:

```text
[AI Teams] Could not restore terminal output: Error invoking remote method 'agents:snapshot':
Error: No handler registered for 'agents:snapshot'
```

That specific failure indicates a renderer/preload/main mismatch, but the deeper issue is architectural: agent sessions live too close to Electron process lifetime.

## Why Not Embed Kitty Directly

Kitty is mature as a terminal emulator, but it is not a drop-in embedded Electron terminal widget. Its strongest integration model is external-process remote control: launch windows/tabs, send text, query text, and control focus from the outside.

For AI Teams, the primary product surface is multiple agent terminals side by side inside one workspace. For that surface, `xterm.js` is the right embedded renderer. Kitty should be considered an optional external terminal target:

- open the current agent pane in Kitty
- attach to the workspace tmux session in Kitty
- inspect or operate a pane outside AI Teams

It should not replace the embedded terminal grid in the first implementation.

## Goals

- Preserve the current embedded multi-agent UI.
- Make agent processes survive renderer refresh and Electron app restart.
- Use tmux as the durable owner of real agent PTYs.
- Reuse the existing `.aiteam` runtime files and `aiteam.py` tmux semantics where possible.
- Restore terminal display from tmux pane capture and/or raw logs, not only from Electron memory.
- Keep routing behavior consistent between desktop and CLI.
- Make IPC version drift non-fatal and visible outside the terminal text surface.
- Keep demo mode available without requiring tmux or real agent CLIs.

## Non-Goals

- Do not attempt to embed Kitty inside Electron.
- Do not remove `xterm.js`.
- Do not build a full terminal emulator from scratch.
- Do not make tmux mandatory for `npm run dev:demo`.
- Do not redesign agent routing, task handoff, or document selection in this feature.
- Do not add provider-specific agent APIs in this feature.

## User-Facing Behavior

### Starting Agents

When the user clicks `Start` in the desktop app:

- Real mode starts or reuses the workspace tmux session.
- Enabled agents run in tmux panes.
- The sidebar and terminal headers show agent status derived from tmux pane state and recent output heuristics.
- Starting again is idempotent: existing panes are reused instead of spawning duplicate agents.

### Stopping Agents

When the user clicks `End`:

- Real mode stops the tmux session for the current workspace.
- Runtime files remain on disk for logs/history.
- UI status becomes `stopped`.

### Rendering Terminals

The embedded terminal panels remain the primary display:

- Each agent still has an `xterm.js` terminal surface.
- On mount, the terminal restores from tmux pane capture or the latest persisted log.
- Live output is appended as it arrives through the desktop backend.
- If live streaming is unavailable, the UI can fall back to periodic pane capture diffing.

### Restart Recovery

After refreshing the renderer or restarting Electron:

- Existing tmux session is detected.
- Agent panes are rediscovered from `.aiteam/runtime.json`.
- Terminal panels restore recent visible output from `tmux capture-pane`.
- The agents continue running; no agent process is restarted unless its pane is missing or dead.

### External Terminal Escape Hatch

Add later, not in the first slice:

- `Open workspace in Kitty`
- `Open agent pane in Kitty`
- `Copy tmux attach command`

These actions attach to the same tmux session. They do not create separate agent processes.

## Architecture

### Current Desktop Model

```text
renderer xterm.js
  -> preload IPC
  -> Electron main
  -> node-pty agent process
  -> in-memory replay buffer
  -> IPC agent:data
  -> renderer xterm.js
```

### Target Real-Agent Model

```text
renderer xterm.js
  -> preload IPC
  -> Electron main terminal backend
  -> tmux session/pane
  -> agent process

tmux pane/log/capture
  -> Electron main snapshot/stream adapter
  -> IPC agent:data / agents:snapshot
  -> renderer xterm.js
```

### Backend Interface

Introduce a small backend boundary in `src/main/main.cjs` before moving logic into separate files:

```js
const terminalBackend = {
  listAgents(),
  startAgent(agentId),
  stopAgent(agentId),
  writeInput(agentId, data),
  resizeAgent(agentId, cols, rows),
  snapshot(agentId),
  routeMessage(message, targets, options),
  stopAll()
};
```

Initial implementations:

- `directPtyBackend`: current `node-pty` behavior, retained for demo/dev fallback.
- `tmuxBackend`: real-agent default when tmux is available.

The renderer should not know which backend is active.

## Runtime Files

Reuse and formalize existing files:

```text
.aiteam/
  agents.json
  runtime.json
  sessions/
    timeline-YYYYMMDD.md
    <agent>/
      YYYYMMDD-HHMMSS.ansi.log
      YYYYMMDD-HHMMSS.md
  status/
    <agent>.json
```

`runtime.json` should remain the pane lookup source:

```json
{
  "session": "aiteam-ai-teams-xxxxxx",
  "backend": "tmux",
  "started_at": "2026-06-11T08:00:00Z",
  "agents": {
    "codex": {
      "pane": "%12",
      "raw_log": ".aiteam/sessions/codex/20260611-160000.ansi.log",
      "markdown_log": ".aiteam/sessions/codex/20260611-160000.md",
      "started_at": "2026-06-11T08:00:00Z"
    }
  }
}
```

## Implementation Plan

### 1. Add Terminal Backend Boundary

Files:

- `src/main/main.cjs`

Work:

- Extract current process operations behind a backend-shaped object.
- Keep current IPC channel names stable:
  - `agents:list`
  - `agents:snapshot`
  - `agents:start`
  - `agents:stop`
  - `agents:input`
  - `agents:resize`
  - `route:send`
- Add a backend capability field to agent public state:

```js
{
  id: "codex",
  status: "running_or_idle",
  backend: "tmux",
  pane: "%12"
}
```

Acceptance for this slice:

- Existing direct PTY mode still works.
- No renderer behavior changes required.
- `npm run build`, `npm run doctor`, and `npm run smoke:pty` still pass.

### 2. Implement Tmux Backend in Main Process

Files:

- `src/main/main.cjs` initially, optionally split later to `src/main/tmux-backend.cjs`

Work:

- Add a `runTmux(args, options)` helper using `execFile`/`execFileSync`.
- Detect tmux with `command -v tmux` or direct spawn failure handling.
- Read workspace `tmux_session` from `.aiteam/agents.json`.
- On `startAgent` or `Start all`:
  - create tmux session if absent
  - create/reuse one pane per enabled agent
  - run agent command in its configured cwd
  - start `pipe-pane -o` to append raw logs
  - save `.aiteam/runtime.json`
- On app startup:
  - if tmux session exists, load runtime and report agents as running
  - if runtime is stale, report clear `missing_runtime` or `pane_missing` state

Prefer matching `aiteam.py` behavior:

- `new-session -d -s <session> -n agents -c <cwd> <command>`
- `split-window -P -F "#{pane_id}" ...`
- `select-layout tiled`
- `pipe-pane -o -t <pane> "cat >> <raw_log>"`

Acceptance for this slice:

- Starting the desktop app creates the same shape of tmux session as `python3 aiteam.py start`.
- Restarting Electron does not kill running agents.
- `tmux attach -t <session>` shows the same agent panes.

### 3. Reliable Snapshot and Stream Contract

Files:

- `src/main/main.cjs`
- `src/renderer/App.jsx`

Work:

- Make `agents:snapshot` always registered before the window loads.
- Return structured snapshot data:

```js
{
  id: "codex",
  seq: 128,
  data: "...",
  source: "tmux-capture",
  truncated: false,
  backend: "tmux"
}
```

- For tmux backend, build snapshot from:
  - `tmux capture-pane -p -e -J -S -<lineCount> -t <pane>` for visible/recent state
  - raw log tail fallback when pane capture fails
- Do not write infrastructure errors into the terminal surface by default.
- Show recoverable backend errors in the existing notice area.

Renderer ordering rule:

- Subscribe to `agent:data` before requesting snapshot, or use `seq` to ignore duplicate old chunks.
- Track `lastSeqRef` for real:
  - ignore chunks with `seq <= lastSeq`
  - after snapshot, set `lastSeq`
  - if a gap is detected, request a fresh snapshot

Acceptance for this slice:

- Refreshing the renderer does not duplicate large chunks of terminal output.
- Refreshing the renderer does not lose active agent output beyond the configured recovery window.
- Missing IPC handler errors are replaced by a non-terminal notice with an actionable message.

### 4. Input and Routing Through Tmux

Files:

- `src/main/main.cjs`
- `aiteam.py` only if desktop/CLI parity requires small adjustments

Work:

- For single keypress input from xterm:
  - write to pane with `tmux send-keys` for control keys where feasible
  - use `load-buffer` + `paste-buffer -p` for pasted text/message injection
- For composer route messages:
  - reuse the CLI model:
    - preflight all target panes
    - paste full message into each pane
    - verify injection when configured
    - send Enter only after verification
- Keep the existing direct input UX for interactive terminal usage. If tmux cannot faithfully proxy every byte from xterm, explicitly support two modes:
  - composer-driven agent routing is fully reliable
  - raw interactive typing is best effort in tmux backend

Acceptance for this slice:

- Sending via composer to `@codex`, `@kimi`, and `@all` works through tmux panes.
- Broadcast preflight avoids preventable partial delivery.
- Direct terminal input works for normal printable text and Enter.

### 5. Status Model

Files:

- `src/main/main.cjs`
- possibly shared helper with `aiteam.py` later

Work:

- Derive state from tmux:
  - session exists
  - pane exists
  - `#{pane_dead}`
  - recent capture tail matched by waiting patterns
- Keep current status labels:
  - `stopped`
  - `starting`
  - `running_or_idle`
  - `waiting_input`
  - `exited`
  - `error`
- Persist status JSON to `.aiteam/status/<agent>.json`.

Acceptance for this slice:

- Killing one pane marks only that agent as `error` or `exited`.
- Killing the tmux session marks all enabled agents as `stopped`.
- Waiting prompts still show `Needs Input`.

### 6. Renderer Terminal Hardening

Files:

- `package.json`
- `package-lock.json`
- `src/renderer/App.jsx`

Work:

- Add `@xterm/addon-serialize` if useful for direct PTY fallback recovery.
- Use `lastSeqRef` to prevent duplicate live writes.
- Clear terminal content before full snapshot replay when the snapshot is authoritative.
- Keep terminal infrastructure messages out of the terminal unless the message is actual agent output.
- Add a small terminal backend notice/status line in the card header or app notice area.

Acceptance for this slice:

- No duplicated banner/error text after remount.
- Terminal resize still syncs to backend where supported.
- xterm scrollback remains stable across active/focused panel changes.

### 7. Optional External Terminal Integration

Files:

- `src/main/main.cjs`
- `src/renderer/App.jsx`

Work:

- Add a menu or card action:
  - `Copy attach command`
  - `Open in Terminal`
  - `Open in Kitty` if Kitty is installed
- Use tmux as the shared bridge:

```bash
tmux attach -t <session>
```

or for Kitty:

```bash
kitty tmux attach -t <session>
```

Exact Kitty command should be verified on the user's machine before shipping.

Acceptance for this slice:

- External terminal opens the same tmux session.
- No duplicate agent processes are spawned.
- Closing the external terminal does not stop the desktop app.

## Configuration

Add an optional runtime setting later:

```json
{
  "runtime": {
    "terminal_backend": "tmux"
  }
}
```

Allowed values:

- `tmux`: durable real-agent backend
- `direct-pty`: legacy/direct fallback
- `demo`: cat-agent demo behavior

Default recommendation:

- `npm run dev`: `tmux` when available, fallback with clear warning if unavailable
- `npm run dev:demo`: `demo` or `direct-pty`, no tmux requirement
- packaged app: `tmux` for real workspaces

## Failure Semantics

### Tmux Missing

If tmux is not installed:

- Real app shows a notice: `tmux is required for durable terminal sessions. Install tmux or switch to direct PTY mode.`
- Agent rows remain startable only if direct PTY fallback is enabled.
- `npm run doctor` reports tmux as missing.

### Runtime Stale

If `.aiteam/runtime.json` references panes that no longer exist:

- Do not spawn duplicate panes silently.
- Mark affected agents as `missing_runtime`.
- Offer a clean restart path:
  - stop stale runtime
  - start enabled agents again

### Capture Failure

If `capture-pane` fails:

- Try raw log tail fallback.
- If fallback fails, show empty terminal plus notice.
- Do not write stack traces into xterm.

### Partial Send

For composer routing:

- Preflight every target first.
- If any target is missing/dead, send to none.
- If delivery fails mid-send, return structured per-target results and surface the partial state clearly.

## Migration Strategy

### Phase 0: Document and stabilize current direct PTY path

- Add backend boundary.
- Fix `agents:snapshot` registration ordering and renderer error placement.
- Add `seq`-based dedupe.

### Phase 1: Tmux backend behind a feature flag

- Add `runtime.terminal_backend = "tmux"` support.
- Keep direct PTY fallback.
- Start with composer routing and snapshot recovery.

### Phase 2: Make tmux default for real workspaces

- Use tmux automatically when available.
- Keep demo mode independent.
- Update `npm run doctor` expectations.

### Phase 3: External terminal attachment

- Add attach/copy actions.
- Add Kitty-specific open command only after local verification.

## Test Plan

Run before and after implementation:

```bash
npm run build
npm run doctor
npm run smoke:pty
```

Manual real-mode checks:

```bash
npm run dev
```

- Start enabled agents.
- Verify `tmux ls` shows the workspace session.
- Verify `tmux attach -t <session>` shows agent panes.
- Send a message to one agent.
- Send `@all` and confirm both enabled agents receive the normalized message.
- Restart Electron without killing tmux; verify agents remain alive.
- Refresh/remount renderer; verify terminal output restores.
- Kill one pane; verify only that agent status changes.

Manual demo-mode checks:

```bash
npm run dev:demo
```

- App starts without real agent CLIs.
- Terminal panels still render.
- Existing UI and routing smoke behavior remains available.

## Acceptance Criteria

- Real agents are owned by tmux, not by Electron process lifetime.
- Electron restart does not kill running agents.
- Terminal panels restore recent output after restart.
- Composer routing works through tmux panes.
- `@all` preflight prevents avoidable partial sends.
- Infrastructure errors appear in app notice/status UI, not as fake terminal output.
- Direct PTY remains available as fallback/demo path.
- No Kitty dependency is introduced for the embedded UI.

## Open Questions

- Should raw interactive typing be fully supported through tmux from day one, or should the first tmux slice prioritize composer-driven routing?
- Should desktop main call `aiteam.py` as a subprocess initially, or should tmux commands be implemented directly in Node for fewer moving parts?
- Should `.aiteam/runtime.json` become a formally versioned schema?
- How many lines should `tmux capture-pane` return for snapshots: 1,000, 5,000, or configurable?
- Should direct PTY fallback be user-visible in settings, or only an internal fallback when tmux is missing?

Recommended first answers:

- Prioritize composer-driven routing and reliable recovery first; expand raw interactive typing after the tmux backend is stable.
- Implement tmux directly in Node but keep behavior aligned with `aiteam.py`.
- Add `runtime_schema_version: 1`.
- Start with 2,000 capture lines, plus raw-log fallback.
- Keep direct PTY as an advanced/internal fallback in the first release.
