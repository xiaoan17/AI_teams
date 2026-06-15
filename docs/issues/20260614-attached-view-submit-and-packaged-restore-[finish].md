---
created: 2026-06-14
status: Implemented
state: finish
tags: [tmux, terminal, composer-routing, workspace-restore, packaged-app, regression-guard]
---

# Attached Tmux View Submit and Packaged Restore Regression

## Summary

After switching projects in the packaged app, the UI could look healthy while the agents were not directly usable:

- agent cards showed `Running`;
- terminal panes rendered Claude Code and Codex correctly;
- composer messages or typed terminal input appeared in the CLI prompt;
- pressing Enter did not reliably submit the prompt;
- xterm device response bytes could leak into the prompt as visible text;
- restarting `/Applications/AI Teams.app` could reopen the packaged fallback workspace instead of the last real project.

This was a compound regression across tmux view input routing, composer submission, terminal input filtering, startup workspace selection, and packaged app installation.

## User Visible Symptoms

Observed in the installed app after switching back to `AI_teams`:

- Claude and Codex panes were still running, but the next message was left in the prompt instead of executing.
- Codex showed stale prompt text such as `Summarize recent commits`.
- Device attribute responses like `ESC[>0;276;0c` or `ESC[=0;276;0c` could appear in agent input.
- The app could restore `~/Library/Application Support/ai-teams/workspace`, which has no useful project docs or configured project state, instead of the last real workspace.

The dangerous part is that status alone was misleading: `Running` did not mean input submission was working.

## Root Causes

### 1. Attached view path bypassed the durable tmux pane

The earlier tmux input fallback fix only covered the detached fallback path. When an embedded tmux view was attached, composer submit and terminal input still wrote through the app-owned view PTY.

That meant:

- text reached the visible CLI input buffer;
- Enter was sent as raw carriage return through the PTY path;
- some TUI CLIs did not treat that path like a real tmux keypress;
- the command stayed in the prompt instead of submitting.

Required invariant:

- composer submit must target the real agent pane;
- Enter submit must use `tmux send-keys` against the real agent pane, not the attached view PTY. As of 2026-06-15 the required key name is `Enter` via `TMUX_SUBMIT_KEY`; the earlier `C-m` guidance is superseded by `docs/issues/20260615-real-agent-enter-submit-regression-[finish].md`.
- text may be pasted, but control keys must not be hidden inside pasted text;
- the embedded view PTY is a rendering/input convenience, not the durable owner of agent interaction.

### 1.1 Per-key IPC can race without a main-process queue

The renderer sends terminal input as xterm `onData` events, not as one atomic line. A fast user input sequence can become several concurrent `agents:input` IPC calls: text chunks, then Enter.

Required invariant:

- per-agent input operations must be serialized in the main process;
- Enter must not overtake earlier text writes;
- composer submit and direct terminal input must share the same per-agent ordering queue.

### 2. Raw terminal control sequences were not fully filtered

The app filtered several mouse, focus, and title-report sequences, but not xterm device attribute responses.

Required invariant:

- filter `ESC[>...c`, `ESC[=...c`, and `ESC=...c` before they reach the agent prompt;
- keep this filtering in both the main-process parser and renderer-side terminal input filter.

### 3. Packaged startup preferred a fallback workspace

In packaged mode, the app could start from the userData fallback workspace under:

```text
~/Library/Application Support/ai-teams/workspace
```

That path is useful only as a last-resort placeholder. It should not win over the most recent real project.

Required invariant:

- if `AITEAMS_WORKSPACE_ROOT` is absent, start from the most recent real workspace;
- do not remember the packaged fallback workspace as a recent project;
- keep the sidebar and docs pointed at the real project after app restart.

### 4. Nested errors serialized as empty objects

Some logger payloads included nested `Error` objects. JSON serialization turned them into `{}`, which removed the useful message and stack from diagnostics.

Required invariant:

- nested `Error` values must serialize with `name`, `message`, and `stack`.

### 5. Installing over an existing app bundle left stale assets

Using `ditto` directly over `/Applications/AI Teams.app` can leave removed hashed assets inside the existing bundle. That caused code signing verification to fail with a stale file under `Contents/Resources/app/dist/assets`.

Required invariant:

- remove the old installed bundle before copying a freshly packaged app;
- run code signing verification after install.

## Implemented Fix

Main-process tmux routing:

- `src/main/main.cjs`
  - `tmuxPasteAndSubmitAgent()` now pastes text to the real tmux pane and submits with the shared submit key.
  - `tmuxWriteInput()` parses all input through `tmuxInputActions()`.
  - control keys always go through `tmux send-keys`.
  - text and paste blocks go through tmux buffer paste to the real pane.
  - no user input is written through the attached view PTY.
  - `enqueueAgentInput()` serializes direct terminal input and composer submit per agent.
  - startup uses the most recent real workspace when no explicit workspace env var is present.
  - the packaged fallback workspace is not remembered as a recent project.
  - invalid or missing `routing.default_agent` is repaired to the first enabled agent.

Tmux parser and view submit:

- `src/main/tmux-input.cjs`
  - supports bracketed paste actions.
  - maps control keys to tmux key names.
  - filters device attribute responses before they reach agent input.

- `src/main/tmux-view.cjs`
  - `pasteAndSubmit()` now targets the real tmux pane and submits via the shared submit key.

Renderer terminal filter:

- `src/renderer/terminal-wheel.mjs`
  - filters xterm device attribute responses in addition to existing mouse, focus, and title-report sequences.

Diagnostics:

- `src/main/logger.cjs`
  - serializes nested `Error` instances with useful error fields.

Regression coverage:

- `scripts/tmux-input-fallback-smoke.cjs`
  - covers parser output.
  - covers attached-view routing.
  - verifies the view writer receives no user input.

- `scripts/agent-input-queue-smoke.cjs`
  - verifies same-agent input stays ordered even when an earlier write is slower.
  - verifies a failed write does not permanently block the queue.

- `scripts/tmux-view-smoke.cjs`
  - verifies view paste-and-submit reaches a real pane.

- `scripts/terminal-wheel-smoke.mjs`
  - verifies renderer filtering for `ESC[>...c` and `ESC[=...c`.

- `scripts/logger-smoke.cjs`
  - verifies nested `Error` serialization.

## Regression Rules

Do not route the entire xterm input stream through `paste-buffer`.

Allowed:

- text chunks can be pasted;
- bracketed paste content can be pasted as text;
- the attached view PTY can render output.

Not allowed:

- Enter as raw `\r` through the view PTY;
- ordinary text input through the view PTY;
- same-agent IPC writes that can overtake earlier writes;
- Backspace, arrows, Tab, Escape, or other control keys as pasted text;
- composer submit through the view PTY as the only submission path;
- stale workspace reconcile results emitting into a newer workspace UI;
- packaged fallback workspace replacing the user's last real project.

For composer submit, the durable target is always the tmux agent pane, not the embedded view process.

## Verification Commands

Run these after any edit to tmux input, composer routing, tmux view submit, or terminal filtering:

```bash
npm run smoke:tmux-input
npm run smoke:agent-input-queue
npm run smoke:tmux-view
npm run smoke:terminal-wheel
npm run smoke:pty
```

Run these after any edit to workspace switching, view cleanup, or runtime recovery:

```bash
npm run smoke:tmux-recovery
npm run smoke:tmux-zombie-recovery
npm run smoke:tmux-view
```

Run the normal project verification before shipping related changes:

```bash
npm run build
npm run doctor
npm run smoke:pty
```

## Packaged App Verification

Build and install with a clean destination:

```bash
npm run package:mac:local
rm -rf "/Applications/AI Teams.app"
ditto "out/AI Teams.app" "/Applications/AI Teams.app"
codesign --verify --deep --strict --verbose=1 "/Applications/AI Teams.app"
```

Do not use plain `ditto` overlay onto an existing installed app when validating a release. It can leave stale hashed assets behind.

Manual check:

1. Launch `/Applications/AI Teams.app`.
2. Confirm it opens the last real project, not `~/Library/Application Support/ai-teams/workspace`.
3. Confirm docs and agents belong to that project.
4. Send a message through the composer to a running agent.
5. Type directly into a terminal pane and press Enter.
6. Confirm both paths submit real commands.
7. Confirm no `ESC[>...c` or `ESC[=...c` text appears in the prompt.

When preserving live agent sessions during diagnosis, terminate only the Electron shell process and then confirm tmux sessions still exist:

```bash
tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}'
```

Avoid normal app quit from a known-buggy build if its quit handler may run destructive cleanup.

## Fast Diagnostics

Inspect active sessions and panes:

```bash
tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}'
tmux list-panes -a -F '#{session_name}\t#{window_name}\t#{pane_id}\t#{pane_dead}\t#{pane_current_path}\t#{pane_current_command}'
```

Capture a suspect prompt:

```bash
tmux capture-pane -p -e -S -80 -t %pane
```

Inspect app-level config:

```bash
sed -n '1,220p' "$HOME/Library/Application Support/ai-teams/agents.json"
```

Inspect workspace runtime:

```bash
sed -n '1,220p' /path/to/project/.aiteam/runtime.json
```

Confirm the installed app contains the expected main-process source:

```bash
test -f "/Applications/AI Teams.app/Contents/Resources/app/src/main/tmux-input.cjs"
rg "mostRecentWorkspaceRoot|TMUX_SUBMIT_KEY|deviceResponse" "/Applications/AI Teams.app/Contents/Resources/app/src/main"
```

## Notes For Future Work

- Treat `Running` as process status only. It is not proof that input routing works.
- Prefer smoke tests and demo agents for regression checks. Avoid sending real prompts to real agents unless the user expects the cost and side effects.
- Any new terminal input path must prove where text, paste content, and control keys go separately.
- Any new packaged install flow must verify code signing after copying the bundle.
