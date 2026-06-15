---
created: 2026-06-15
status: Implemented
state: finish
tags: [tmux, terminal, enter-submit, real-agent, regression-guard]
---

# Real Agent Enter Submit Regression

## Summary

The embedded terminal could type into real Claude Code and Kimi prompts, but pressing Enter did not submit. The UI looked healthy and panes stayed `Running`, yet prompt text remained stuck in the input line.

This was not a stale renderer issue after the dev-server loading fix. It reproduced on the current `127.0.0.1:5173` build with real agent panes.

## Symptoms

- Text appeared in the Claude/Kimi prompt.
- Pressing Enter left the text in the prompt instead of executing it.
- Demo agents using `cat` could still pass smoke tests.
- Direct tmux probing showed `tmux send-keys -t %pane C-m` left `/help` stuck in Kimi.
- Direct tmux probing showed `tmux send-keys -t %pane Enter` submitted `/help` correctly.

## Root Cause

The input parser and composer routing normalized Enter to the tmux key name `C-m`. That was good enough for `/bin/cat` smoke panes, but real full-screen TUIs such as Kimi Code and Claude Code did not treat `C-m` as the same submit key in this setup.

The real durable pane target was correct. The per-agent input queue was correct. The remaining bad assumption was the tmux key name for submit.

## Implemented Fix

- `src/main/tmux-input.cjs`
  - introduced `TMUX_SUBMIT_KEY = "Enter"`;
  - maps raw `\r`, `\n`, CSI-u Enter, and modified Enter to `Enter`;
  - keeps the pre-submit paste settle delay, but keys it off `TMUX_SUBMIT_KEY`.

- `src/main/main.cjs`
  - imports `TMUX_SUBMIT_KEY`;
  - composer / route paste-and-submit now sends `tmux send-keys Enter`.

- `src/main/tmux-view.cjs`
  - view `pasteAndSubmit()` now uses the same `TMUX_SUBMIT_KEY`.

- Smoke expectations were updated so parser and queue tests assert `Enter`, not `C-m`.

## Regression Rules

Do not reintroduce `C-m` as the AI Teams submit key.

Required invariant:

- all Enter-like xterm input must parse to `TMUX_SUBMIT_KEY`;
- `TMUX_SUBMIT_KEY` must be `"Enter"` unless a future real-agent manual test proves otherwise;
- direct terminal input, composer routing, and tmux view paste-and-submit must share the same submit key constant;
- text may still go through tmux buffer paste;
- control keys must still go through `tmux send-keys`;
- do not write raw `\r` through the attached view PTY as a shortcut.

Important testing lesson:

- `/bin/cat` smoke tests are necessary but not sufficient for this class of bug.
- A real-agent manual check is required after any tmux input or submit-key change.

## Required Verification

Run automated checks:

```bash
npm run smoke:tmux-input
npm run smoke:agent-input-queue
npm run smoke:tmux-view
npm run smoke:terminal-wheel
npm run smoke:pty
npm run build
npm run doctor
```

Manual real-agent check:

1. Start the formal app with `npm run dev`.
2. Confirm the window is using `127.0.0.1:5173`, not `file:///.../dist/index.html`.
3. Start real Claude Code and Kimi, not demo `cat` agents.
4. In Kimi, type `/help` and press Enter. It must open the help view.
5. In Claude, type a harmless local slash command or a short user-approved prompt and press Enter. It must submit.
6. Confirm typed prompt text is not left stuck in the input line.

Safe direct tmux diagnostic:

```bash
tmux send-keys -t %pane C-u
printf '/help' | tmux load-buffer -b aiteam-enter-probe -
tmux paste-buffer -b aiteam-enter-probe -t %pane -p
tmux delete-buffer -b aiteam-enter-probe 2>/dev/null || true
tmux send-keys -t %pane Enter
```

Use this only on an agent where `/help` is known to be local and harmless. Do not probe with arbitrary model prompts unless the user asked for it.

## Notes

This issue supersedes older notes that said "Enter must be sent as `C-m`". The durable rule is now: Enter must go to the real tmux agent pane via `tmux send-keys Enter`, with paste ordering preserved.
