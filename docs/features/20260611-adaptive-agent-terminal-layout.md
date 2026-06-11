# Feature Spec: Adaptive Agent Terminal Layout

Date: 2026-06-11
Status: Implemented
Owner: AI Teams

## Summary

AI Teams now sizes the terminal workspace according to the number of running agent panels:

1. One running agent occupies the full terminal workspace.
2. Two running agents split the workspace into two equal columns.
3. Three running agents split the workspace into three equal columns.
4. More than three running agents keep the existing horizontal-scroll fallback with a practical minimum column width.

This replaces the previous fixed `32vw` auto-column behavior, which left unused empty space when only one or two agents were visible.

## Problem Statement

The terminal grid previously used:

```css
grid-auto-flow: column;
grid-auto-columns: minmax(280px, 32vw);
```

That made each terminal card roughly one third of the viewport regardless of how many agents were actually running. When the user stopped agents:

- One remaining agent only used part of the available workspace.
- Two remaining agents did not fully fill the row.
- The unused right-side space made the interface feel unbalanced.

The product intent is that visible terminal panels should use the available workspace efficiently.

## Goals

- Make the visible agent terminals fill the main workspace for the common 1, 2, and 3 agent cases.
- Keep equal column widths for side-by-side comparison.
- Preserve xterm resize behavior through the existing `ResizeObserver` and `FitAddon` path.
- Preserve horizontal scrolling for uncommon cases with more than three running agents.
- Avoid changing agent process lifetime, tmux/PTY behavior, routing, or message composer behavior.

## Non-Goals

- No draggable split panes in this feature.
- No persisted per-agent panel sizing.
- No vertical stacking mode.
- No changes to sidebar agent start/stop semantics.
- No changes to terminal font size, scrollback, or xterm theme.

## User-Facing Behavior

### One Running Agent

When only one enabled agent is running, its terminal card fills the terminal workspace width, minus the existing workspace padding.

Example:

```text
| Kimi                                      |
```

### Two Running Agents

When two enabled agents are running, the terminal area uses two equal columns.

Example:

```text
| Claude Code             | Kimi          |
```

### Three Running Agents

When three enabled agents are running, the terminal area uses three equal columns.

Example:

```text
| Codex        | Claude Code | Kimi        |
```

### More Than Three Running Agents

If a workspace later configures more than three running agents, the grid switches to horizontal scrolling. Each card uses a minimum width of `280px` and can grow with available space.

This preserves the old "many panels in one row" mental model without forcing unusably narrow columns.

## Implementation

### Renderer Layout Class

In `src/renderer/App.jsx`, the app derives a terminal layout class from the number of currently visible terminal agents:

```js
const terminalLayoutCount = Math.min(Math.max(terminalAgents.length, 1), 3);
const terminalLayoutClass = [
  "terminal-branches",
  `terminal-branches-${terminalLayoutCount}`,
  terminalAgents.length > 3 ? "terminal-branches-scroll" : ""
].filter(Boolean).join(" ");
```

The terminal container then uses:

```jsx
<section className={terminalLayoutClass}>
```

This keeps the layout declarative and tied directly to the same `terminalAgents` list that renders the cards.

### CSS Grid Rules

In `src/renderer/styles.css`, the base terminal grid owns shared spacing and overflow. Count-specific classes define the column template:

```css
.terminal-branches-1 {
  grid-template-columns: minmax(0, 1fr);
}

.terminal-branches-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.terminal-branches-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.terminal-branches-scroll {
  grid-auto-flow: column;
  grid-auto-columns: minmax(280px, 1fr);
  grid-template-columns: none;
}
```

The `minmax(0, 1fr)` pattern is intentional: it allows each grid item to shrink inside the available grid track instead of causing overflow from intrinsic terminal content.

## Resize Behavior

No new resize plumbing was required.

Each `AgentTerminal` already:

- creates an `xterm.js` terminal
- loads `FitAddon`
- observes the terminal container with `ResizeObserver`
- calls `fitAddon.fit()`
- syncs rows and columns through `api.resizeAgent(agent.id, terminal.cols, terminal.rows)`

Changing the grid column width triggers the existing observer, so agent start/stop transitions naturally refit the terminal.

## Acceptance Criteria

- With one running agent, the terminal card spans the full terminal workspace.
- With two running agents, both terminal cards have equal widths and fill the row.
- With three running agents, all three terminal cards have equal widths and fill the row.
- With more than three running agents, the terminal row remains horizontally scrollable.
- Starting or stopping agents updates the layout automatically.
- Terminal content remains clipped inside each card; no card overlaps the composer or sidebar.
- xterm still receives resize updates after layout changes.

## Verification

Commands run:

```bash
npm run build
npm run doctor
npm run smoke:pty
```

Results:

- Build passed.
- Doctor passed.
- PTY smoke passed for `codex`, `claude`, and `kimi`.
- Browser preview verified the two-agent case rendered equal card widths: both cards were `485px` wide in a `1012px` terminal workspace.

## Future Options

- Add draggable split handles if users need temporary manual weighting between agents.
- Add a vertical or tiled layout for very small windows.
- Persist a preferred layout mode once the app has a settings surface.
