// Pure helpers for the leveled toast system (WS-D D1). Kept out of App.jsx so
// the timing/level policy is unit-testable without a DOM (scripts/toast-smoke.cjs).

export const TOAST_LEVELS = ["error", "success", "info"];

// Auto-dismiss delay in ms by level. 0 = persistent (manual dismiss only).
//   error   -> persistent (user must see and acknowledge failures)
//   success -> 3s
//   info    -> 5s
export function toastTtl(level) {
  if (level === "error") return 0;
  if (level === "success") return 3000;
  return 5000;
}

// Glyph shown per level (Unicode, no icon font).
export function toastGlyph(level) {
  if (level === "error") return "✕";
  if (level === "success") return "✓";
  return "ℹ";
}
