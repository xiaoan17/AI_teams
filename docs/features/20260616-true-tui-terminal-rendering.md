---
created: 2026-06-16
status: Implemented
state: finish
supersedes: 20260616-transcript-terminal-resize-stability.md
tags: [terminal, tui, resize, xterm, tmux, alt-screen]
---

# True-TUI Terminal Rendering

## Decision

AI Teams renders each embedded agent panel as a **real terminal**, not a transcript.
xterm receives agent output **verbatim**: alt-screen enter/leave, cursor positioning,
clear-line, scroll, mouse-mode enables, and SGR all reach xterm unmodified. The PTY
size strictly follows the panel.

This **supersedes** the earlier Transcript-mode policy
(`20260616-transcript-terminal-resize-stability.md`), which deliberately stripped
alt-screen/mouse modes and rewrote cursor-movement sequences to force append-only
scrollback. That policy was incompatible with the agents AI Teams actually hosts.

## Rationale

Codex, Claude Code, and Kimi are all **full-screen TUIs**. They paint their input box,
thinking animation, and status bar with absolute cursor positioning + clear-line +
in-place redraw. Lossily rewriting those sequences produced exactly the corruption users
saw:

- bare ANSI fragments rendered as literal text (`[2m`, `[/plugins…`);
- misaligned box-drawing (top/bottom borders not lining up);
- ghosted / overprinted lines (old content not cleared before new content);
- stacked status rows (cursor-up `A` rewritten to a newline, so "redraw in place"
  became "append a line").

A transcript renderer is a log viewer; these agents are full-screen apps. The two cannot
be reconciled by filtering. The fix is to stop filtering and let xterm be the terminal.

## Tradeoff: durable in-app scrollback is lost

Alt-screen apps have **no xterm scrollback** — the alt buffer is a single screen the app
owns. Accepting True-TUI means the embedded panel no longer offers infinite append-only
history. This is an explicit, accepted tradeoff. Durable history is preserved elsewhere:

- the **raw ANSI session log** on disk (`tmux pipe-pane … >> *.ansi.log`) remains the
  authoritative byte record;
- the future external-terminal escape hatch (attach the tmux session from a real
  terminal) is the way to get full native scrollback.

## Embedded Terminal Policy

- xterm stays a real terminal; **no lossy output rewriting**.
  `filterTerminalOutput` (`src/renderer/terminal-wheel.mjs`) now does **only** cross-chunk
  escape completion (holding back a trailing incomplete escape until the rest arrives, so
  a half-escape never corrupts xterm's parser). It no longer strips alt-screen/mouse modes
  or rewrites `A/F`/`B C D E G H J K S T` cursor finals.
- No `resetTerminalMouseModes` writes into xterm. Writing alt-screen-LEAVE on every
  resize/theme/visibility event used to yank a running TUI out of the alt buffer
  mid-render — that function and its call sites are removed.
- `filterTerminalInput` is kept: it strips renderer→agent *reports* (focus in/out, mouse
  reports, DA/cursor-position reports) that xterm should never inject into the agent's
  stdin. These are never user keystrokes.
- Mouse wheel stays local to xterm (`handleTerminalWheel`); on the alt-screen it is
  largely inert, consistent with the lost-scrollback tradeoff. (Forwarding wheel as SGR
  events to the TUI is a possible later enhancement.)

## PTY Sizing: panel is authoritative

The agent process runs in the tmux **base** window; the embedded view is a separate tmux
session **grouped** to the base (`new-session -t base`), so the two share the window and
its single size. The renderer's `FitAddon` measures the panel and is the sole authority on
cols/rows.

- The view window is set to `window-size manual` (`src/main/tmux-view.cjs` `ensureView`).
  `latest`/`largest` re-derive the shared size from whatever client is most-recently
  active, which drifts and leaves the agent drawing at a width xterm is not rendering at
  (the misaligned-box symptom).
- After attach, and on every renderer resize, the manager issues an explicit
  `resize-window -t <baseSession>:<windowId> -x <cols> -y <rows>` (`resize`, debounced
  ~60ms). Resizing the grouped base window is what fires SIGWINCH to the agent and makes
  its TUI redraw at the renderer's exact size.
- Verified on tmux 3.6a: `window-size manual` + `resize-window` sticks with a live
  attached view client; the regression test in `scripts/tmux-view-smoke.cjs` asserts the
  base window follows `manager.resize`.

## Snapshot / Replay

- **Resize: no replay.** The renderer only calls `resizeAgent` (→ `resize-window`) and lets
  the TUI repaint itself via SIGWINCH. Replaying the raw byte history at a new width
  overprints garbage, so the old resize→snapshot→`\x1bc`-replay path is removed.
- **Restore (mount / tab re-show): `capture-pane -p -e`.** The current screen (text + SGR)
  is captured and painted onto a clean slate (`\x1bc`), then the live stream takes over.
  Snapshots are tagged `format: "capture"`. Raw-byte fallbacks (view replay buffer,
  raw-log tail) are tagged `format: "raw"` and written verbatim without the capture-only
  `\n`→`\r\n` normalization, so they cannot corrupt escape sequences.

## Verification

```bash
npm run build
npm run doctor
npm run smoke           # includes smoke:tmux-view and smoke:terminal-wheel
npm run smoke:pty
```

Manual, all three agents (Codex, Claude Code, Kimi):

1. Start the agents with real CLIs.
2. Confirm box-drawing aligns, no literal ANSI fragments, no ghosted/stacked status rows.
3. Resize the window repeatedly while agents stream output; confirm each panel redraws
   cleanly at every size (SIGWINCH-driven) and boxes stay aligned.
4. After a renderer resize, confirm
   `tmux display-message -p -t <base>:<win> '#{window_width}x#{window_height}'` equals the
   renderer cols/rows.
5. Refresh the renderer / hide-and-show a panel; confirm capture-pane restore paints the
   current screen and live output resumes without corruption.
