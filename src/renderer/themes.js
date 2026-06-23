// AI Teams theme presets.
//
// These are "inspired by Typora" palettes, not Typora-compatible themes: only
// color tokens change between presets; layout, spacing, and status semantics
// stay fixed. Token keys are CSS custom property names (without the leading
// `--`) so adding a preset never requires touching component logic.

export const DEFAULT_THEME_ID = "studioDark";

export const themePresets = {
  studioDark: {
    id: "studioDark",
    label: "Studio Dark",
    colorScheme: "dark",
    tokens: {
      "app-bg": "#0f1215",
      "sidebar-bg": "#14181c",
      "panel-bg": "#16191e",
      "surface-bg": "#16191e",
      "header-bg": "#14181c",
      "control-bg": "#1c2127",
      "control-strong-bg": "#232932",
      "control-strong-border": "rgba(255,255,255,0.18)",
      "input-bg": "#16191e",
      "text": "#eef2f5",
      "text-soft": "#b3bdc7",
      "muted": "#76828d",
      "ink-faint": "#4d5862",
      "border": "rgba(255,255,255,0.07)",
      "border-strong": "rgba(255,255,255,0.12)",
      "line-3": "rgba(255,255,255,0.18)",
      "accent": "#3ee0b0",
      "accent-dim": "#1f8f73",
      "accent-ink": "#04231b",
      "accent-wash": "rgba(62,224,176,0.12)",
      "accent-line": "rgba(62,224,176,0.40)",
      "accent-glow": "rgba(62,224,176,0.50)",
      "focus": "#3ee0b0",
      "focus-ring": "rgba(62,224,176,0.40)",
      "success": "#3ee0b0",
      "warning": "#f0b429",
      "danger": "#ff6b6b",
      "stopped": "#5b6670",
      "highlight": "#f0b429",
      "hover-bg": "#232932",
      "active-row-bg": "rgba(62,224,176,0.12)",
      "pill-bg": "#232932",
      "notice-bg": "rgba(62,224,176,0.12)",
      "notice-text": "#eef2f5",
      "shadow-pop": "0 18px 60px rgba(0,0,0,0.46)",
      "shadow-toast": "0 8px 26px rgba(0,0,0,0.40)",
      "shadow-seg": "0 8px 18px rgba(0,0,0,0.24)",
      "card-sheen": "linear-gradient(180deg, rgba(255,255,255,0.035), transparent 42%)",
      "term-user": "#8ab4ff"
    },
    terminal: {
      background: "#0c0f12",
      foreground: "#cdd6df",
      cursor: "#3ee0b0",
      selectionBackground: "rgba(62,224,176,0.22)"
    }
  },
  studioLight: {
    id: "studioLight",
    label: "Studio Light",
    colorScheme: "light",
    tokens: {
      "app-bg": "#f7f8fa",
      "sidebar-bg": "#f0f2f5",
      "panel-bg": "#ffffff",
      "surface-bg": "#ffffff",
      "header-bg": "#f0f2f5",
      "control-bg": "#f4f6f8",
      "control-strong-bg": "#e9edf2",
      "control-strong-border": "rgba(17,24,33,0.20)",
      "input-bg": "#ffffff",
      "text": "#11161c",
      "text-soft": "#3d4752",
      "muted": "#6b7682",
      "ink-faint": "#9aa4b0",
      "border": "rgba(17,24,33,0.09)",
      "border-strong": "rgba(17,24,33,0.14)",
      "line-3": "rgba(17,24,33,0.20)",
      "accent": "#3b6cf0",
      "accent-dim": "#2a52c4",
      "accent-ink": "#ffffff",
      "accent-wash": "rgba(59,108,240,0.10)",
      "accent-line": "rgba(59,108,240,0.38)",
      "accent-glow": "rgba(59,108,240,0.30)",
      "focus": "#3b6cf0",
      "focus-ring": "rgba(59,108,240,0.38)",
      "success": "#1f9d57",
      "warning": "#c77700",
      "danger": "#e0413f",
      "stopped": "#8a949f",
      "highlight": "#c77700",
      "hover-bg": "#e9edf2",
      "active-row-bg": "rgba(59,108,240,0.10)",
      "pill-bg": "#e9edf2",
      "notice-bg": "rgba(59,108,240,0.10)",
      "notice-text": "#11161c",
      "shadow-pop": "0 18px 56px rgba(42,52,69,0.18)",
      "shadow-toast": "0 10px 30px rgba(42,52,69,0.18)",
      "shadow-seg": "0 8px 18px rgba(42,52,69,0.12)",
      "card-sheen": "linear-gradient(180deg, rgba(255,255,255,0.86), transparent 52%)",
      "term-user": "#2a52c4"
    },
    terminal: {
      background: "#f3f5f8",
      foreground: "#2b333d",
      cursor: "#3b6cf0",
      selectionBackground: "rgba(59,108,240,0.18)"
    }
  },
  workbenchDark: {
    id: "workbenchDark",
    label: "Workbench Dark",
    colorScheme: "dark",
    tokens: {
      // 背景阶：明度严格递增 bg1<bg2<bg3<bg4（hover-bg 必须 > control-bg）
      "app-bg": "#0e1114",            // bg-1
      "sidebar-bg": "#14191c",        // bg-2
      "panel-bg": "#1a2125",          // bg-3
      "surface-bg": "#14191c",        // bg-2（与 sidebar 同阶）
      "header-bg": "#171d21",         // bg-2→3
      "control-bg": "#1f272c",        // bg-3（控件默认）
      "control-strong-bg": "#28333a", // 强调控件（bulk/send）
      "control-strong-border": "#3d4d57",
      "input-bg": "#12181c",          // 输入框比控件略沉，聚焦靠 accent 边框
      "text": "#e8edf1",
      "text-soft": "#c2ccd4",
      "muted": "#97a3ad",             // 提亮，小字对比足
      "border": "#252d33",
      "border-strong": "#34404a",
      // 品牌 / 焦点：teal
      "accent": "#2dd4bf",            // 青绿主色（唯一品牌色）
      "accent-ink": "#06231f",        // 主色按钮上的前景文字
      "focus": "#2dd4bf",             // 焦点 = 主色
      "focus-ring": "rgba(45, 212, 191, 0.30)",
      // 状态色
      "success": "#3fb950",           // 唯一绿
      "warning": "#d29922",           // 橙，≠ accent
      "danger": "#ef6f6c",
      "stopped": "#6e7a85",
      // 高光点缀（pin 专用，琥珀，不当品牌色）
      "highlight": "#e3a857",
      "hover-bg": "#283037",          // bg-4：必须 > control-bg
      "active-row-bg": "#1c2a2c",     // 带 accent 倾向的暗底
      "pill-bg": "#222b30",
      "notice-bg": "#15282a",
      "notice-text": "#bff0e7"
    },
    terminal: {
      background: "#0d1114",
      foreground: "#d9e0e8",
      cursor: "#2dd4bf",
      selectionBackground: "#1f4a47"
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
      "control-strong-bg": "#e9edf1",
      "control-strong-border": "#c0cad4",
      "input-bg": "#ffffff",
      "text": "#1f2328",
      "text-soft": "#424a53",
      "muted": "#59636e",
      "border": "#d1d9e0",
      "border-strong": "#b6c2cc",
      "accent": "#0d9488",            // teal-700，亮底上够深可读
      "accent-ink": "#ffffff",        // 亮色 teal 上用白字
      "focus": "#0d9488",
      "focus-ring": "rgba(13, 148, 136, 0.25)",
      "success": "#1a7f37",
      "warning": "#9a6700",
      "danger": "#cf222e",
      "stopped": "#818b98",
      "highlight": "#9a6700",
      "hover-bg": "#eef2f6",          // > control-bg
      "active-row-bg": "#d7f5ef",     // teal 倾向的浅选中底
      "pill-bg": "#eaeef2",
      "notice-bg": "#d7f5ef",
      "notice-text": "#0b3b35"
    },
    // Light app chrome keeps a dark terminal on purpose: readability first.
    terminal: {
      background: "#161b22",
      foreground: "#e6edf3",
      cursor: "#0d9488",
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
      "control-bg": "#f3efe5",
      "control-strong-bg": "#e3dccb",
      "control-strong-border": "#c4b99f",
      "input-bg": "#fbf9f3",
      "text": "#2f2a24",
      "text-soft": "#4f463c",
      "muted": "#7a6f60",
      "border": "#d8d0bf",
      "border-strong": "#bdb29a",
      "accent": "#2f8f80",            // 偏暖一点的 teal，融进纸色
      "accent-ink": "#ffffff",
      "focus": "#2f8f80",
      "focus-ring": "rgba(47, 143, 128, 0.28)",
      "success": "#4a7c59",
      "warning": "#9a6700",
      "danger": "#b3403d",
      "stopped": "#8a8174",
      "highlight": "#8c5e2a",
      "hover-bg": "#e8e1d0",          // > control-bg
      "active-row-bg": "#dcebe4",     // 暖底里的浅青选中
      "pill-bg": "#e3dccb",
      "notice-bg": "#dcebe4",
      "notice-text": "#274b43"
    },
    terminal: {
      background: "#1d1a15",
      foreground: "#e4ddcd",
      cursor: "#2f8f80",
      selectionBackground: "#3a4a44"
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
