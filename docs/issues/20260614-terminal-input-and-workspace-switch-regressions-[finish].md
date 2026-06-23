---
created: 2026-06-14
status: Implemented
state: finish
tags: [tmux, terminal, workspace-switch, regression-guard]
---

# Terminal Input and Workspace Switch Regression Guards

## Summary

Two behaviors are critical for AI Teams stability and must be treated as regression-sensitive:

1. Embedded terminal input must submit reliably even when tmux view sessions are not attached.
2. Switching projects must not kill or corrupt durable tmux agent sessions.

These are not cosmetic details. If either regresses, the app can look healthy while every agent becomes effectively unusable.

## Incident: Input Appears to Type but Never Talks

Observed in the packaged app after switching to `NmFuture_dev`:

- every agent panel showed `Running`;
- Codex and Claude rendered their startup screens correctly;
- typed characters appeared inside the agent prompt;
- pressing Enter did not reliably submit;
- composer-routed messages such as `Explain this codebase` remained in the prompt instead of executing.

Root cause:

- when the app-owned tmux view pty was not attached, `tmuxWriteInputFallback()` used `paste-buffer` for the full input payload;
- control keys like Enter, Backspace, arrow keys, Escape, and Tab were treated like plain text paste data;
- several TUI CLIs handle bracketed paste and raw control bytes differently from real keypresses, so the input buffer could fill without being submitted.

Required behavior:

- ordinary text may use tmux buffer paste;
- control keys must be converted to tmux key names and sent with `tmux send-keys`;
- Enter must be sent as a tmux key action using the shared submit key (`Enter` as of 2026-06-15), not hidden inside a pasted text buffer;
- Backspace must be sent as `BSpace`;
- common cursor/navigation escape sequences must map to `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `Delete`, `PageUp`, and `PageDown`.

Current implementation:

- `src/main/tmux-input.cjs`
  - parses xterm input into `{ type: "text" }` and `{ type: "key" }` actions;
  - keeps text chunks coalesced for efficient paste;
  - emits tmux key names for control input.

- `src/main/main.cjs`
  - `tmuxWriteInputFallback()` iterates parsed actions;
  - text actions use `load-buffer` + `paste-buffer`;
  - key actions use `send-keys`.

- `scripts/tmux-input-fallback-smoke.cjs`
  - asserts the parser output for text, Backspace, Enter, and Up arrow;
  - writes through a real tmux pane and confirms Enter submits to `/bin/cat`.

Important 2026-06-15 update:

- `/bin/cat` smoke coverage is necessary but not sufficient.
- Real Claude Code and Kimi Code did not submit when AI Teams used `tmux send-keys C-m`.
- The current submit invariant is `TMUX_SUBMIT_KEY = "Enter"` and every terminal/composer submit path must use that shared constant.
- See `docs/issues/20260615-real-agent-enter-submit-regression-[finish].md`.

Regression rule:

Do not replace `tmuxInputActions()` with a raw `paste-buffer` of the entire input string. Any edit to terminal input, xterm filtering, tmux fallback, or composer submission must run:

```bash
npm run smoke:tmux-input
npm run smoke:agent-input-queue
npm run smoke:tmux-view
npm run smoke:pty
```

Also do a manual real-agent submit check after any submit-key or tmux input change.

For broad terminal changes, run the full suite:

```bash
npm run smoke
```

## Incident: Project Switch Makes Agents Unusable

Observed behavior:

- switching from the development project to another workspace left the app in a fragile state;
- agents looked `Running`, but interaction and routing differed from the dev environment;
- old status files and pane metadata could linger across config changes.

Root causes and risks:

- workspace switching previously shared cleanup logic with app quit / Stop All;
- that cleanup could kill the current workspace base tmux session, which is the durable owner of agent processes;
- async tmux reconciliation could still be in flight while `WORKSPACE_ROOT` changed, allowing old workspace status or view information to be emitted into the new workspace UI.

Required behavior:

- switching projects must detach AI Teams' embedded view sessions for the old workspace;
- switching projects must not kill the old workspace base tmux session;
- app quit and explicit Stop actions may still terminate agent processes;
- stale async reconcile work must be ignored after a workspace switch begins;
- runtime state, status files, docs, and minimized-panel storage remain workspace-scoped.

Current implementation:

- `releaseCurrentWorkspaceBackend({ terminateAgents })`
  - `terminateAgents: false` for workspace switch;
  - `terminateAgents: true` for app quit / explicit stop paths;
  - tmux switch cleanup resets embedded views and status cache but preserves the base session.

- `workspaceEpoch`
  - increments before workspace release begins and again when the new root is installed;
  - `reconcileTmuxBackend()` captures the epoch at start;
  - stale reconcile work returns before emitting status or attaching views.

Regression rule:

Do not call the same destructive cleanup path for workspace switch and app quit. Project switching is a view/context change; Stop All and quit are lifecycle termination paths.

Any edit to `switchWorkspace()`, `releaseCurrentWorkspaceBackend()`, `reconcileTmuxBackend()`, tmux view reset, or runtime recovery must verify:

```bash
npm run smoke:tmux-recovery
npm run smoke:tmux-zombie-recovery
npm run smoke:tmux-view
```

Manual packaged-app check when touching this area:

1. Open project A and start agents.
2. Switch to project B.
3. Confirm project A's tmux session still exists with `tmux ls`.
4. Start or attach agents in project B.
5. Switch back to project A.
6. Confirm panes are still alive and terminal input can submit a real message.

## Packaged App Requirement

This class of bug often appears only in `/Applications/AI Teams.app`, because packaged Electron has a different launch path, userData config, PATH environment, and installed source tree.

After fixes that affect main-process tmux behavior:

```bash
npm run package:mac:local
ditto "out/AI Teams.app" "/Applications/AI Teams.app"
codesign --verify --deep --strict --verbose=1 "/Applications/AI Teams.app"
```

If the app is already running, remember that replacing the bundle on disk does not update the live process. Restart the app before judging the result.

When preserving active tmux agent sessions matters, avoid a normal app quit from a buggy old build that might run destructive `before-quit` cleanup. Prefer terminating only the Electron process and reopening the fixed bundle, then confirm the workspace session still exists with:

```bash
tmux list-sessions -F '#{session_name}\t#{session_windows}'
```

## Quick Diagnostic Commands

Check installed app has the input parser:

```bash
test -f "/Applications/AI Teams.app/Contents/Resources/app/src/main/tmux-input.cjs"
```

Inspect app-level agent config:

```bash
sed -n '1,220p' "$HOME/Library/Application Support/ai-teams/agents.json"
```

Inspect workspace runtime:

```bash
sed -n '1,220p' /path/to/project/.aiteam/runtime.json
```

Inspect live panes:

```bash
tmux list-panes -a -F '#{session_name}\t#{window_name}\t#{pane_id}\t#{pane_dead}\t#{pane_current_path}\t#{pane_current_command}'
```
