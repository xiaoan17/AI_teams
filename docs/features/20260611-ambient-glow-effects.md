# Feature Spec: Ambient Glow Effects (光效与呼吸状态)

Date: 2026-06-11
Status: Draft for implementation
Owner: AI Teams

## Summary

Add subtle, optional ambient light effects to the desktop app so the user can see at a glance which terminal is focused, which agent is actively working, and which document is about to be handed off — without reading any text.

Three surfaces get effects:

1. **Active terminal card** — the focused agent panel gets a soft static glow instead of only a 1px border color change.
2. **Working terminal card** — an agent that is actively producing output gets a slow breathing glow on its border.
3. **Handoff document** — when a document is selected in the Handoff dropdown, its row in the Files tree and the Handoff select itself get a quiet highlight, marking "this is what we are about to work on".

All effects are intentionally faint (低饱和、低亮度), never animate content inside the terminal, and can be turned off with a single user-facing toggle that persists across sessions.

## Goals

- Make "which panel is focused" and "which agent is busy" visible peripherally, without reading status pills.
- Make the selected handoff document visually traceable from the composer back to the file tree.
- Keep every effect subtle: no pulsing backgrounds, no color washes over terminal content, no motion faster than a slow breath.
- Ship a single on/off toggle, default **on**, persisted like the existing sidebar-collapsed preference.
- Respect `prefers-reduced-motion`: when the OS requests reduced motion, breathing animations freeze to their static equivalent even if the toggle is on.
- Zero cost when disabled: toggle off removes the effect classes entirely rather than hiding them.

## Non-Goals

- No new agent statuses in the main process state machine. "Working" is a renderer-side derived signal, not a new `status` value.
- No per-agent or per-effect granular settings in the first iteration. One toggle controls all ambient effects.
- No effects on the collapsed sidebar agent dots beyond what already exists.
- No sound, no OS-level attention requests (dock bounce etc.).
- No theming/color customization of the glow colors.

## User-Facing Behavior

### Effect 1: Active terminal glow

Current behavior: `.terminal-card-active` changes the border to `#5f83b6`.

New behavior when effects are enabled:

- The active card keeps the colored border and additionally gets a soft outer glow, roughly `box-shadow: 0 0 0 1px rgba(95, 131, 182, 0.35), 0 0 18px rgba(95, 131, 182, 0.10)`.
- The glow is static — focus is a state, not an activity, so it does not animate.
- Exactly one card is active at a time (existing behavior unchanged).

### Effect 2: Working breath (呼吸光)

A terminal whose agent is **actively working** shows a slow breathing glow:

- Color follows the existing status palette: green-tinted (`#52b788`) while working, amber-tinted (`#f2c14e`) if status is `waiting_input`.
- Animation: border-glow opacity eases between roughly 0.06 and 0.18 over a 2.8s–3.2s cycle, `ease-in-out`, infinite. Slow enough to read as "alive", never as "alert".
- The breath renders on the card border/shadow only. Terminal text, scrollback, and the xterm surface are never animated.
- Active + working compose: a focused working card shows the static focus glow plus the breath; the breath should remain the fainter of the two.
- The status dot in the sidebar agent row may share the same breath (opacity-only) so the collapsed sidebar also communicates activity, but this is optional polish, not required for acceptance.

### Working signal definition

There is no `working` status today — `running_or_idle` covers both. The renderer derives it from PTY output:

- `AgentTerminal` already receives all output via `api.onAgentData`. Each chunk for the agent marks it "working".
- The working flag decays after **2 seconds** with no output (debounced timer per agent).
- `waiting_input` status overrides the derived signal: a prompt waiting for the user breathes amber regardless of recent output.
- `stopped`, `exited`, `error` never breathe.

This keeps the feature entirely in the renderer; `src/main/main.cjs` does not change.

### Effect 3: Handoff document highlight

When the user picks a document in the composer's Handoff select:

- The matching `.document-row` in the Files tree gets a quiet highlight: a faint amber-tinted left edge or border (consistent with the existing pinned color family `#f2c14e` / `#544a2e`), plus a very soft breath at the same cadence as Effect 2 — or static under reduced motion.
- The folder ancestors of that document auto-expand so the highlighted row is actually visible (reuse `folderAncestorKeys`).
- The Handoff select itself gets a subtle accent border while a document is chosen, so the composer corner reads "handoff armed".
- Selecting "No document" removes all of the above immediately.

### The toggle

- Placement: sidebar, near the bottom or inside the brand/workspace area — a small labeled switch or checkbox: `Ambient effects` (中文环境可显示为 "光效").
- Default: **on**.
- Persisted to `localStorage` as `aiTeams.ambientEffects` (`"true"` / `"false"`), mirroring the `aiTeams.sidebarCollapsed` pattern, wrapped in the same try/catch for restricted contexts.
- When off: the app root drops the `effects-on` class; all glow/breath rules are scoped under it, so disabling removes the effects at the CSS-selector level with no JS cleanup needed.
- `prefers-reduced-motion: reduce` is honored inside the CSS regardless of the toggle: animations are replaced by their static mid-opacity equivalent.

## Visual Restraint Rules (喧宾夺主红线)

These are acceptance-level constraints, not suggestions:

- Max glow spread: 18px. Max glow alpha at animation peak: 0.18.
- Breath cycle: ≥ 2.8s. Nothing in the UI may blink or pulse faster.
- Effects only on borders, shadows, and small dots — never on text color, backgrounds of content areas, or the xterm canvas.
- Side-by-side, a working card and an idle card must remain obviously readable; the effect should be noticeable only when looked for or in peripheral vision.

## Implementation Plan

### 1. State and settings (`src/renderer/App.jsx`)

- Add `const [effectsEnabled, setEffectsEnabled] = useState(...)` initialized from `localStorage` (same pattern as `sidebarCollapsed`), with a persisting `useEffect`.
- Add `effects-on` class to `.app-shell` when enabled.
- Add `const [workingAgents, setWorkingAgents] = useState(() => new Set())` in `App`, fed by a single `api.onAgentData` subscription that bumps a per-agent decay timer (2s). Clear timers on unmount. Keep this subscription separate from the per-terminal write subscription in `AgentTerminal` to avoid coupling.
- Pass `working` (boolean) into `AgentTerminal`; pass `effectsEnabled` + `onToggle` into `Sidebar`.
- Lift `taskPath` or mirror the selected handoff path up to `App` so the Sidebar tree can highlight it. Simplest path: move `taskPath` state from `Composer` to `App` and pass it down to both `Composer` and `Sidebar`.

### 2. Card and row classes

- `AgentTerminal`: extend the section className to include `terminal-card-working` and the status-derived breath color class (`breath-running` / `breath-waiting`).
- `Sidebar` agent rows: optionally add the same working class to the status dot.
- `DocumentTreeNode`: add `document-row-handoff` when `node.path === taskPath`; auto-expand ancestors of the handoff document in the existing `expandedFolders` effect.
- Composer Handoff label/select: add `handoff-armed` class when `taskPath` is set.

### 3. CSS (`src/renderer/styles.css`)

- All new rules scoped under `.app-shell.effects-on`.
- One `@keyframes ambient-breath` animating `box-shadow` alpha via a CSS custom property or two-shadow technique; GPU-friendly (shadow on the card element, no layout-affecting properties).
- `@media (prefers-reduced-motion: reduce)` block sets `animation: none` and a static mid-intensity shadow.
- Colors reuse the existing palette: focus `#5f83b6`, working `#52b788`, waiting `#f2c14e`, handoff amber family.

### 4. Toggle UI

- Small control in the sidebar (visible in expanded mode; hidden when collapsed, like other panels).
- Accessible: a real `<input type="checkbox">` or `<button role="switch" aria-checked>` with a visible label.

### 5. Demo coverage

- `npm run dev:demo` (browser preview API) should exercise the effects: the demo `listAgents` already returns `waiting_input` for Kimi, which should breathe amber once effects are on. Consider having the demo `onAgentData` emit periodic fake output for `codex` so the working breath is visible without real agents.

## Acceptance Criteria

Run with:

```bash
npm run dev:demo
```

Expected with effects **on** (default):

- Clicking a terminal card gives it a soft static blue glow; the previously active card loses it.
- The demo agent with `waiting_input` status breathes amber, slowly (~3s cycle).
- If the demo emits fake output for an agent, that card breathes green while output flows and stops breathing ~2s after output stops.
- Selecting a document in Handoff highlights the matching row in the Files tree, expands its ancestor folders, and accents the Handoff select. Choosing "No document" clears all three.
- Terminal text never flickers, dims, or shifts; only borders/shadows animate.

Expected with effects **off**:

- The toggle immediately removes all glow and breathing; only the original 1px `terminal-card-active` border color remains.
- The preference survives an app restart.

Reduced motion:

- With macOS "Reduce motion" enabled, breathing stops; working/waiting cards show a static faint glow instead.

Real app sanity check:

```bash
npm run dev
```

- With `codex` and `kimi` running, sending a prompt to one agent makes only that card breathe while it streams output.
- CPU usage stays flat when all agents are idle (no animation running on idle cards — verify the `animation` is only applied to cards with the working/waiting class, not paused on all cards).

Verification before finishing:

```bash
npm run build
npm run doctor
```

## Open Questions

- Should the working-signal decay be 2s, or longer (e.g. 4s) to avoid flicker between an agent's bursty output chunks? Recommend starting at 2s and tuning by feel in the demo.
- Should `starting` status breathe (it is a transient activity)? Recommend yes, using the green/working breath, since it reads as "becoming alive".
- Should the toggle live in the sidebar or in a future settings panel? Recommend sidebar now; migrate when a settings surface exists.
- Should the sidebar agent dot breathe too? Recommend deferring unless it is trivial — the terminal card is the primary surface.

Recommended first answers: 2s decay, `starting` breathes, sidebar toggle, defer the dot.
