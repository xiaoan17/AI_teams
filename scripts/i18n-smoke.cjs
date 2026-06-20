// Smoke test for the renderer i18n layer (src/renderer/i18n.js).
//
// i18n.js is an ESM module that imports React. We only need to exercise the
// pure exports (DICTIONARIES / translate / DEFAULT_LOCALE), so we load it via
// dynamic import() — the provider hooks are never invoked here.

const assert = require("assert");
const path = require("path");

(async () => {
  const mod = await import(path.join("..", "src", "renderer", "i18n.js").replace(/\\/g, "/"));
  const { DICTIONARIES, translate, DEFAULT_LOCALE, SUPPORTED_LOCALES } = mod;

  // --- key-set parity: zh and en expose exactly the same keys ---------------
  const zhKeys = Object.keys(DICTIONARIES.zh).sort();
  const enKeys = Object.keys(DICTIONARIES.en).sort();
  const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
  const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
  assert.deepStrictEqual(missingInEn, [], `keys present in zh but missing in en: ${missingInEn.join(", ")}`);
  assert.deepStrictEqual(missingInZh, [], `keys present in en but missing in zh: ${missingInZh.join(", ")}`);
  assert.ok(zhKeys.length > 0, "dictionary must not be empty");

  // --- no empty values ------------------------------------------------------
  for (const locale of SUPPORTED_LOCALES) {
    for (const [k, v] of Object.entries(DICTIONARIES[locale])) {
      assert.ok(typeof v === "string" && v.length > 0, `${locale}.${k} must be a non-empty string`);
    }
  }

  // --- translate: basic lookup ----------------------------------------------
  assert.strictEqual(translate("en", "common.save"), "Save");
  assert.strictEqual(translate("zh", "common.save"), "保存");
  assert.strictEqual(DEFAULT_LOCALE, "zh");

  // --- translate: missing key falls back to the key itself ------------------
  assert.strictEqual(translate("en", "nope.not.a.key"), "nope.not.a.key");

  // --- translate: unknown locale falls back to default locale dict ----------
  assert.strictEqual(translate("fr", "common.save"), DICTIONARIES.zh["common.save"]);

  // --- translate: interpolation ---------------------------------------------
  assert.strictEqual(translate("en", "time.minutesAgo", { n: 5 }), "5m ago");
  assert.strictEqual(translate("zh", "composer.askAgent", { name: "设计师" }), "给 设计师 发消息…");

  // --- translate: missing var leaves placeholder intact (visible, not blank)
  assert.strictEqual(translate("en", "time.minutesAgo", {}), "{n}m ago");

  console.log("i18n smoke passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
