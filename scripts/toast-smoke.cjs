// Smoke test for the toast policy helpers (src/renderer/toast-util.js).
// Loaded via dynamic import() since the module is ESM. Pure functions only —
// no DOM, no React.

const assert = require("assert");
const path = require("path");

(async () => {
  const mod = await import(path.join("..", "src", "renderer", "toast-util.js").replace(/\\/g, "/"));
  const { toastTtl, toastGlyph, TOAST_LEVELS } = mod;

  // --- level set ------------------------------------------------------------
  assert.deepStrictEqual(TOAST_LEVELS, ["error", "success", "info"]);

  // --- TTL policy: error persists, success 3s, info 5s ----------------------
  assert.strictEqual(toastTtl("error"), 0, "error toasts must be persistent (ttl 0)");
  assert.strictEqual(toastTtl("success"), 3000, "success toasts auto-dismiss at 3s");
  assert.strictEqual(toastTtl("info"), 5000, "info toasts auto-dismiss at 5s");
  // unknown level falls back to info timing (defensive default)
  assert.strictEqual(toastTtl("whatever"), 5000, "unknown level defaults to info ttl");

  // --- glyph per level ------------------------------------------------------
  assert.strictEqual(toastGlyph("error"), "✕");
  assert.strictEqual(toastGlyph("success"), "✓");
  assert.strictEqual(toastGlyph("info"), "ℹ");
  assert.strictEqual(toastGlyph("whatever"), "ℹ", "unknown level uses info glyph");

  console.log("toast smoke passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
