import test from "node:test";
import assert from "node:assert/strict";
import { appearanceMode, resolvedAppearance } from "./appearance";

test("system appearance follows OS changes; explicit choices ignore them", () => {
  assert.equal(resolvedAppearance("system", false), "light");
  assert.equal(resolvedAppearance("system", true), "dark");
  assert.equal(resolvedAppearance("dark", false), "dark");
  assert.equal(resolvedAppearance("light", true), "light");
});
test("older saved choices survive and missing or invalid settings follow the system", () => {
  assert.equal(appearanceMode("dark"), "dark");
  assert.equal(appearanceMode("light"), "light");
  assert.equal(appearanceMode(null), "system");
  assert.equal(appearanceMode("unknown"), "system");
});
