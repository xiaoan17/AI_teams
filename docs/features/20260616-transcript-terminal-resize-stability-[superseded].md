---
created: 2026-06-16
status: Superseded
state: finish
superseded_by: 20260616-true-tui-terminal-rendering.md
tags: [terminal, transcript, resize, xterm, tmux]
---

> **Superseded by [True-TUI Terminal Rendering](20260616-true-tui-terminal-rendering.md).**
> The Transcript-mode policy below was reversed: full-screen agent TUIs (Codex, Claude
> Code, Kimi) cannot be rendered by a transcript log viewer. AI Teams now renders each
> panel as a real terminal (alt-screen + cursor sequences kept, no lossy rewriting, PTY
> size follows the panel). This document is kept for historical context only.

# Transcript Terminal Resize Stability

## Decision

AI Teams uses one embedded terminal policy for all agents: **Transcript mode**.

Transcript mode prioritizes:

- durable scrollback;
- readable and copyable agent history;
- stable replay after renderer refresh or workspace view recovery;
- resize recovery for multi-agent panels.

AI Teams does not provide an embedded Raw TUI mode. Full-screen terminal applications such as `vim`, `less`, `htop`, and mouse-heavy picker UIs are outside the embedded panel guarantee. Users who need exact full-screen TUI behavior should attach to the tmux session from an external terminal.

## Rationale

The main product surface is a multi-agent workspace, not a single perfect terminal emulator. Agent work should remain inspectable after long runs, window resizes, app refreshes, and workspace switching. That pushes the embedded renderer toward a transcript-first model:

```text
agent output
  -> tmux/direct PTY
  -> raw ANSI log
  -> renderer xterm
  -> filtered transcript-style scrollback
```

Preserving local scrollback requires stripping or normalizing terminal features that normally rewrite the screen, including alt-screen entry, mouse modes, and selected cursor rewrite sequences. That is intentional product behavior, not a rendering bug.

## Embedded Terminal Policy

- Keep xterm on the main buffer so local scrollback collects agent output.
- Filter alt-screen enter/leave sequences from agent output.
- Filter mouse mode enables from agent output and mouse reports from terminal input.
- Convert carriage-return and cursor-redraw output into append-only transcript history where possible.
- Keep mouse wheel scrolling local to xterm scrollback; do not send wheel gestures to tmux or agent stdin.
- Do not offer an in-app Transcript/Raw TUI switch.

## Resize Recovery

Window and panel resizing can briefly desynchronize three widths:

- the DOM box measured by `FitAddon`;
- the renderer xterm cols/rows;
- the backend tmux/direct PTY cols/rows.

During resize, AI Teams now treats fitting and transcript correction as two separate phases:

1. Immediate phase:
   - measure the terminal surface;
   - run `fitAddon.fit()`;
   - call `resizeAgent(agent.id, cols, rows)` only when cols/rows changed;
   - repaint the current viewport.

2. Settle phase:
   - wait for the resize to stop briefly;
   - fetch the latest terminal snapshot;
   - reset and replay the transcript snapshot;
   - replay live output that arrived while the snapshot was in flight.

This avoids repeated clear/replay churn while the user is still dragging the window, but pulls the final view back to the transcript source of truth once the layout has stabilized.

## Recovery Invariants

- Live output received before initial snapshot restore is buffered.
- Live output received during resize snapshot replay is buffered.
- Snapshot replay clears incomplete ANSI parser fragments before live output resumes.
- Snapshot/live sequence tracking is raised as pending output is replayed so duplicate chunks are not written twice.
- Full glyph atlas rebuild remains limited to low-frequency events such as resize, theme changes, visibility changes, and restore. It must not run on every output chunk.

## Future External Terminal Escape Hatch

If exact full-screen TUI behavior becomes necessary, add external tmux actions instead of embedding Raw TUI mode:

- copy tmux attach command;
- open the current workspace session in Terminal/iTerm/Kitty;
- document that closing the external terminal does not stop AI Teams agents.

The embedded panel should remain Transcript mode.

## Verification

Run after terminal rendering changes:

```bash
npm run build
npm run doctor
npm run smoke:pty
npm run smoke:tmux-view
npm run smoke:tmux-input
```

Manual checks:

1. Start the app with real agents.
2. Resize the window repeatedly while agents are streaming output.
3. Confirm panels settle back into readable transcript output.
4. Confirm local wheel scrollback still works.
5. Confirm copying older output still works.
