# Feature Spec: Typora-Inspired Theme Presets

Date: 2026-06-11
Status: Draft for implementation
Owner: AI Teams

## Summary

Add a small set of AI Teams theme presets inspired by the user's local Typora themes, without importing or copying Typora CSS directly.

The feature gives the desktop app a theme selector with several carefully adapted visual styles:

1. **Workbench Dark** - the current AI Teams direction, refined with the restrained low-contrast feel of Typora Night.
2. **Clean Code** - a light engineering theme inspired by Typora GitHub.
3. **Paper Trail** - a warm document-reading theme inspired by Typora Newsprint.

The first implementation should ship these three presets only. The architecture should allow later additions such as Editorial, Gothic Focus, and White Canvas by adding token definitions rather than changing layout or component logic.

## Problem Statement

The user's Typora theme directory contains useful visual references:

```text
/Users/anbc/Library/Application Support/abnerworks.Typora/themes/
```

Observed themes include:

- `github.css`
- `night.css`
- `newsprint.css`
- `pixyll.css`
- `gothic.css`
- `whitey.css`

These are valuable references for tone, contrast, typography, and document readability. However, Typora themes are written for a Markdown editing surface, not for AI Teams' multi-agent desktop workspace.

Directly loading those CSS files would be risky because they contain broad global rules for selectors such as:

```css
html
body
button
input
select
textarea
#write
```

Those rules can unintentionally change app chrome, terminal panels, sidebars, buttons, file trees, and composer behavior. Some themes also use large reading-focused type scales that would break the compact operational layout of AI Teams.

The product need is therefore not "support Typora themes" literally. The right product direction is "offer AI Teams-native themes that borrow the best visual qualities of those Typora themes."

## Goals

- Provide a user-facing theme selector for AI Teams.
- Borrow palette, contrast, and reading mood from selected Typora themes without importing their CSS.
- Keep AI Teams' layout density, terminal readability, and control behavior stable across themes.
- Support both app chrome and xterm terminal colors.
- Persist the selected theme across app restarts.
- Keep the implementation token-driven so future themes are easy to add.
- Make light themes usable, not just visually different: terminal text, status pills, file tree rows, and composer controls must remain readable.

## Non-Goals

- Do not import Typora CSS files at runtime.
- Do not copy Typora theme files into the app bundle.
- Do not parse arbitrary external CSS in the first implementation.
- Do not build a full settings panel for this feature.
- Do not change terminal font size, scrollback, PTY routing, agent process behavior, or workspace switching.
- Do not let document typography rules control app chrome.
- Do not expose separate app-theme and document-theme settings until AI Teams has a real document preview surface.

## Design Principle

This feature is "inspired by Typora," not "compatible with Typora."

AI Teams is an operational workspace. Its primary surfaces are:

- agent terminals
- file tree
- routing composer
- app sidebar
- status controls

Typora themes are content themes. Their primary surface is Markdown prose.

That means Typora can inform:

- background warmth
- foreground contrast
- border softness
- accent color
- document-reading mood
- optional future Markdown preview typography

Typora should not control:

- component spacing
- terminal font metrics
- button dimensions
- grid layout
- app minimum size
- active/focus mechanics
- status color semantics

## User-Facing Behavior

### Theme Selector

Add a compact theme selector in the expanded sidebar, near the existing Project controls:

```text
Project
[ AI_teams ]

Theme
[ Workbench Dark v ]
```

The selector is hidden when the sidebar is collapsed, consistent with other expanded-sidebar controls.

Changing the selector applies the theme immediately and stores the preference in:

```text
localStorage["aiTeams.theme"]
```

If the stored value is unknown or missing, the app falls back to `workbenchDark`.

### First-Phase Presets

#### Workbench Dark

Default theme. It should remain close to the current AI Teams look:

- dark app background
- dark sidebar
- muted gray borders
- amber accent
- blue focus color
- green/waiting/error status colors unchanged

Reference influence:

- Typora Night's low-glare gray surface
- current AI Teams terminal-first color choices

#### Clean Code

Light engineering theme inspired by Typora GitHub:

- near-white app background
- white or very light panels
- cool gray borders
- blue accent/focus
- terminal remains dark by default for readability

Important constraint: Clean Code is a light app theme, not necessarily a light terminal theme. The terminal may stay dark unless a carefully tuned light xterm palette is explicitly validated.

#### Paper Trail

Warm reading theme inspired by Typora Newsprint:

- warm paper-like app background
- off-white panels
- brown/ink text accents used sparingly
- calmer borders than Clean Code
- terminal remains dark or uses a warm dark palette

This theme should make docs/file browsing feel softer without making the operational UI look like a document editor.

### Future Presets

These are intentionally deferred until the first three themes prove the architecture:

- **Editorial** - inspired by Pixyll; more literary, serif-friendly for future document preview.
- **Gothic Focus** - inspired by Gothic; higher contrast and sharper focus states.
- **White Canvas** - inspired by Whitey; minimal light theme.

Future presets should be added as theme token objects, not as new CSS architecture.

## Theme Model

Create a renderer theme module:

```text
src/renderer/themes.js
```

It exports stable theme definitions:

```js
export const DEFAULT_THEME_ID = "workbenchDark";

export const themePresets = {
  workbenchDark: {
    id: "workbenchDark",
    label: "Workbench Dark",
    colorScheme: "dark",
    tokens: {
      appBg: "#0e1114",
      sidebarBg: "#14191e",
      panelBg: "#181f25",
      surfaceBg: "#10151a",
      controlBg: "#1b232a",
      text: "#e8edf2",
      muted: "#8995a0",
      border: "#252c33",
      borderStrong: "#33404b",
      accent: "#f2c14e",
      focus: "#5f83b6",
      success: "#52b788",
      warning: "#f2c14e",
      danger: "#ef6f6c"
    },
    terminal: {
      background: "#0d1114",
      foreground: "#d9e0e8",
      cursor: "#f2c14e",
      selectionBackground: "#29445d"
    }
  }
};
```

The exact token names can be adjusted during implementation, but the model should separate:

- app-level visual tokens
- terminal theme tokens
- metadata such as label and color scheme

## CSS Strategy

### Token Application

The React root or `.app-shell` should receive:

```jsx
data-theme={theme.id}
```

and inline CSS variables derived from the selected theme:

```jsx
style={themeCssVars}
```

Example mapping:

```js
function themeToCssVars(theme) {
  return {
    "--app-bg": theme.tokens.appBg,
    "--sidebar-bg": theme.tokens.sidebarBg,
    "--panel-bg": theme.tokens.panelBg,
    "--surface-bg": theme.tokens.surfaceBg,
    "--control-bg": theme.tokens.controlBg,
    "--text": theme.tokens.text,
    "--muted": theme.tokens.muted,
    "--border": theme.tokens.border,
    "--border-strong": theme.tokens.borderStrong,
    "--accent": theme.tokens.accent,
    "--focus": theme.tokens.focus,
    "--success": theme.tokens.success,
    "--warning": theme.tokens.warning,
    "--danger": theme.tokens.danger
  };
}
```

### Replace Hard-Coded Colors Gradually

`src/renderer/styles.css` currently contains many direct color literals. The first implementation should replace the core surface colors first:

- body background
- `.app-shell`
- `.sidebar`
- `.workspace`
- `.terminal-card`
- `.terminal-header`
- `.terminal-surface`
- `.composer`
- controls and inputs
- borders
- text and muted labels
- focus/hover border color
- status colors

Avoid doing unrelated layout cleanup in the same change.

### Terminal CSS

The xterm theme is controlled from JavaScript, but the surrounding terminal surface CSS also needs variables:

```css
.terminal-surface {
  background: var(--terminal-bg);
}

.terminal-surface .xterm-viewport {
  background: var(--terminal-bg) !important;
}
```

Either include terminal variables in the same CSS var map:

```css
--terminal-bg
--terminal-fg
```

or keep them internal to `AgentTerminal`. Prefer exposing `--terminal-bg` so the xterm viewport and the surrounding card stay aligned.

## Xterm Theme Behavior

`AgentTerminal` currently creates the terminal with a fixed theme:

```js
theme: {
  background: "#0d1114",
  foreground: "#d9e0e8",
  cursor: "#f2c14e",
  selectionBackground: "#29445d"
}
```

Change it to accept a `terminalTheme` prop from `App`.

On initial creation:

```js
const terminal = new Terminal({
  ...
  theme: terminalTheme
});
```

When the selected app theme changes:

```js
useEffect(() => {
  termRef.current?.setOption("theme", terminalTheme);
}, [terminalTheme]);
```

The effect should not recreate the terminal or clear scrollback.

## Renderer State

Add theme state in `App`:

```js
const [themeId, setThemeId] = useState(() => {
  try {
    return window.localStorage?.getItem("aiTeams.theme") || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
});
```

Normalize the value:

```js
const theme = themePresets[themeId] || themePresets[DEFAULT_THEME_ID];
```

Persist changes:

```js
useEffect(() => {
  try {
    window.localStorage?.setItem("aiTeams.theme", theme.id);
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}, [theme.id]);
```

Pass theme data to:

- `Sidebar` for selector options
- `AgentTerminal` for xterm colors
- `.app-shell` for CSS variable application

## Component Changes

### `App`

- Import `DEFAULT_THEME_ID`, `themePresets`, and a helper such as `themeToCssVars`.
- Own `themeId`.
- Normalize unknown stored theme IDs.
- Add CSS vars and `data-theme` to `.app-shell`.
- Pass theme selector props to `Sidebar`.
- Pass `theme.terminal` to each `AgentTerminal`.

### `Sidebar`

Add props:

```js
themeId
themes
onThemeChange
```

Render a compact selector in expanded mode:

```jsx
<label className="theme-picker">
  <span>Theme</span>
  <select value={themeId} onChange={(event) => onThemeChange(event.target.value)}>
    {Object.values(themes).map((theme) => (
      <option key={theme.id} value={theme.id}>
        {theme.label}
      </option>
    ))}
  </select>
</label>
```

The selector should use the same sizing and visual language as `.workspace-picker`.

### `AgentTerminal`

- Accept `terminalTheme`.
- Use it during terminal construction.
- Apply `setOption("theme", terminalTheme)` when it changes.
- Preserve existing resize, snapshot, and PTY data behavior.

## Accessibility and Usability

- The theme selector must be a real `<select>` with a visible label.
- Focus outlines must remain visible in every theme.
- Hover borders must have enough contrast in both dark and light themes.
- Status colors must remain recognizable and consistent:
  - running/success: green
  - waiting/warning: amber
  - error: red
  - stopped: gray
- Light app themes must not force a low-contrast terminal.
- Text must not shrink, wrap unexpectedly, or overflow controls after theme changes.

## Visual Restraint Rules

- Theme changes may affect color and font family tokens only where explicitly supported.
- Theme changes must not affect layout dimensions in the first implementation.
- Do not introduce decorative gradients, large glow backgrounds, or theme-specific artwork.
- Do not use a one-note palette where the whole app becomes only beige, blue, or purple.
- Keep terminal surfaces visually distinct from document/file surfaces.
- Cards remain 8px border radius or less, consistent with the current app.

## Implementation Plan

### 1. Add theme definitions

Create:

```text
src/renderer/themes.js
```

Include:

- `DEFAULT_THEME_ID`
- `themePresets`
- `themeToCssVars(theme)`
- optional helper `getTheme(themeId)`

First presets:

- `workbenchDark`
- `cleanCode`
- `paperTrail`

### 2. Wire theme state in React

Update:

```text
src/renderer/App.jsx
```

Add theme state, localStorage persistence, and pass theme data to `Sidebar` and `AgentTerminal`.

### 3. Add sidebar selector

Add `.theme-picker` markup and style it consistently with the workspace controls.

### 4. Convert core CSS to variables

Update:

```text
src/renderer/styles.css
```

Start with shared high-impact tokens:

- app background
- sidebar background
- workspace background
- terminal card/header/surface
- composer background
- controls
- borders
- text/muted text
- focus/hover
- status colors

Leave uncommon one-off colors for a later cleanup unless they visibly break a theme.

### 5. Wire xterm theme updates

Update `AgentTerminal` to use the selected terminal palette without disposing the terminal instance.

### 6. Verify manually in demo

Use:

```bash
npm run dev:demo
```

Check all three themes in the no-side-effect demo before testing against real agents.

## Acceptance Criteria

### Theme Selector

- The expanded sidebar shows a Theme selector near Project controls.
- The collapsed sidebar hides the selector.
- Selecting a theme updates the app immediately.
- The selected theme persists after app restart.
- Unknown stored theme IDs safely fall back to Workbench Dark.

### Workbench Dark

- The app remains visually close to the current UI.
- Terminal colors match or improve current contrast.
- Existing status and focus semantics remain recognizable.

### Clean Code

- The app chrome becomes light without making controls look disabled.
- File tree rows, agent rows, composer, and status pills remain readable.
- Terminal text remains high contrast.
- Focus and hover states are visible.

### Paper Trail

- The app uses a warmer paper-like palette without turning the whole UI into a document page.
- Composer and file tree still feel like operational controls.
- Terminal readability remains high.

### Xterm

- Switching themes does not clear terminal scrollback.
- Switching themes does not restart agents.
- The xterm viewport background matches the surrounding terminal surface.

### Regression Checks

- Agent start/stop buttons still work.
- Workspace switching still works.
- File tree search still works.
- Handoff dropdown still works.
- Message routing still works.
- No text overlaps or spills outside buttons/selects at the current app minimum size.

## Verification

Before finishing implementation, run:

```bash
npm run build
npm run doctor
npm run smoke:pty
```

Manual visual check:

```bash
npm run dev:demo
```

Check:

1. Switch through all themes.
2. Click between terminal cards.
3. Use the composer.
4. Search files.
5. Open the Handoff dropdown.
6. Collapse and expand the sidebar.
7. Restart the app and confirm the theme preference persists.

For real-agent sanity:

```bash
npm run dev
```

Confirm that running Codex/Kimi terminals preserve their scrollback and continue receiving output after theme switches.

## Future Options

### Additional Built-In Presets

After the first three presets are stable, add:

- `editorial` inspired by Pixyll
- `gothicFocus` inspired by Gothic
- `whiteCanvas` inspired by Whitey

These should require only adding token definitions.

### Separate Document Theme

When AI Teams has a real Markdown preview or document reading surface, split theme controls:

```text
App Theme
Document Theme
```

The document theme can then more closely follow Typora typography, while the app chrome remains compact and operational.

### Typora Theme Import

Do not build this first. If needed later, add an explicit advanced workflow:

1. Let the user choose a Typora CSS file.
2. Parse only a safe subset of variables/colors.
3. Generate an AI Teams theme token preview.
4. Never apply external CSS globally.

This keeps external themes as references, not as untrusted layout code.

## Open Questions

- Should Clean Code use a dark terminal by default? Recommendation: yes for first release.
- Should Paper Trail use serif typography anywhere in the app chrome? Recommendation: no; reserve serif for a future document preview.
- Should the theme selector eventually move into a settings panel? Recommendation: yes, but sidebar is appropriate until such a panel exists.
- Should theme choice be global or per workspace? Recommendation: global user preference.
