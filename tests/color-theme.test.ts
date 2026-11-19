import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { THEME_INITIALIZATION_SCRIPT, THEME_STORAGE_KEY } from "../lib/color-theme";

function initialize(saved: string | null, systemDark: boolean, storageBlocked = false) {
  const dataset: Record<string, string> = {};
  runInNewContext(THEME_INITIALIZATION_SCRIPT, {
    document: { documentElement: { dataset } },
    localStorage: { getItem(key: string) {
      assert.equal(key, THEME_STORAGE_KEY);
      if (storageBlocked) throw new Error("Storage blocked");
      return saved;
    } },
    matchMedia: () => ({ matches: systemDark }),
  });
  return dataset;
}

test("first visit follows the system before hydration", () => {
  assert.deepEqual(initialize(null, true), { theme: "dark", themePreference: "system" });
  assert.deepEqual(initialize(null, false), { theme: "light", themePreference: "system" });
});

test("explicit light and dark preferences override the system", () => {
  assert.deepEqual(initialize("light", true), { theme: "light", themePreference: "light" });
  assert.deepEqual(initialize("dark", false), { theme: "dark", themePreference: "dark" });
});

test("invalid or unavailable storage safely falls back to the system", () => {
  assert.deepEqual(initialize("invalid", true), { theme: "dark", themePreference: "system" });
  assert.deepEqual(initialize(null, true, true), { theme: "dark", themePreference: "system" });
});
