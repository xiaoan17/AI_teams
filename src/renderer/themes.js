// AI Teams theme presets.
//
// These are "inspired by Typora" palettes, not Typora-compatible themes: only
// color tokens change between presets; layout, spacing, and status semantics
// stay fixed. Token keys are CSS custom property names (without the leading
// `--`) so adding a preset never requires touching component logic.

export const DEFAULT_THEME_ID = "workbenchDark";

export const themePresets = {
  workbenchDark: {
    id: "workbenchDark",
    label: "Workbench Dark",
    colorScheme: "dark",
    tokens: {
      "app-bg": "#0e1114",
      "sidebar-bg": "#14191e",
      "panel-bg": "#181f25",
      "surface-bg": "#10151a",
      "header-bg": "#161c22",
      "control-bg": "#1b232a",
      "control-strong-bg": "#273542",
      "control-strong-border": "#46596b",
      "input-bg": "#10161b",
      "text": "#e8edf2",
      "text-soft": "#cbd5df",
      "muted": "#8995a0",
      "border": "#252c33",
      "border-strong": "#33404b",
      "accent": "#f2c14e",
      "focus": "#5f83b6",
      "focus-ring": "rgba(111, 147, 200, 0.28)",
      "success": "#52b788",
      "warning": "#f2c14e",
      "danger": "#ef6f6c",
      "stopped": "#6e7a85",
      "hover-bg": "#1b232a",
      "active-row-bg": "#1d2630",
      "pill-bg": "#222a31",
      "notice-bg": "#1b2935",
      "notice-text": "#d9e7f6"
    },
    terminal: {
      background: "#0d1114",
      foreground: "#d9e0e8",
      cursor: "#f2c14e",
      selectionBackground: "#29445d"
    }
  },
  cleanCode: {
    id: "cleanCode",
    label: "Clean Code",
    colorScheme: "light",
    tokens: {
      "app-bg": "#f6f8fa",
      "sidebar-bg": "#ffffff",
      "panel-bg": "#ffffff",
      "surface-bg": "#ffffff",
      "header-bg": "#f6f8fa",
      "control-bg": "#f6f8fa",
      "control-strong-bg": "#eaeef2",
      "control-strong-border": "#c0cad4",
      "input-bg": "#ffffff",
      "text": "#1f2328",
      "text-soft": "#424a53",
      "muted": "#59636e",
      "border": "#d1d9e0",
      "border-strong": "#b6c2cc",
      "accent": "#9a6700",
      "focus": "#0969da",
      "focus-ring": "rgba(9, 105, 218, 0.25)",
      "success": "#1a7f37",
      "warning": "#9a6700",
      "danger": "#cf222e",
      "stopped": "#818b98",
      "hover-bg": "#eef2f6",
      "active-row-bg": "#ddf4ff",
      "pill-bg": "#eaeef2",
      "notice-bg": "#ddf4ff",
      "notice-text": "#0a3069"
    },
    // Light app chrome keeps a dark terminal on purpose: readability first.
    terminal: {
      background: "#161b22",
      foreground: "#e6edf3",
      cursor: "#58a6ff",
      selectionBackground: "#264f78"
    }
  },
  paperTrail: {
    id: "paperTrail",
    label: "Paper Trail",
    colorScheme: "light",
    tokens: {
      "app-bg": "#f3efe7",
      "sidebar-bg": "#ece7db",
      "panel-bg": "#f7f4ec",
      "surface-bg": "#f7f4ec",
      "header-bg": "#ece7db",
      "control-bg": "#f7f4ec",
      "control-strong-bg": "#e3dccb",
      "control-strong-border": "#c4b99f",
      "input-bg": "#fbf9f3",
      "text": "#2f2a24",
      "text-soft": "#4f463c",
      "muted": "#7a6f60",
      "border": "#d8d0bf",
      "border-strong": "#bdb29a",
      "accent": "#8c5e2a",
      "focus": "#5b6f8c",
      "focus-ring": "rgba(91, 111, 140, 0.28)",
      "success": "#4a7c59",
      "warning": "#9a6700",
      "danger": "#b3403d",
      "stopped": "#8a8174",
      "hover-bg": "#ece5d4",
      "active-row-bg": "#e7e0cf",
      "pill-bg": "#e3dccb",
      "notice-bg": "#e7e0cf",
      "notice-text": "#3d3527"
    },
    terminal: {
      background: "#1d1a15",
      foreground: "#e4ddcd",
      cursor: "#c2a04e",
      selectionBackground: "#4a4234"
    }
  }
};

export function getTheme(themeId) {
  return themePresets[themeId] || themePresets[DEFAULT_THEME_ID];
}

export function themeToCssVars(theme) {
  const vars = {};
  for (const [token, value] of Object.entries(theme.tokens)) {
    vars[`--${token}`] = value;
  }
  vars["--terminal-bg"] = theme.terminal.background;
  vars["--terminal-fg"] = theme.terminal.foreground;
  return vars;
}
