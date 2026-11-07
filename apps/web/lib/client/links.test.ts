import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLinks } from "../../components/linked-text";
test("snippet links preserve text and remove sentence punctuation without breaking balanced parentheses", () => {
  const text =
    "Смотри https://example.com/a_(b), потом www.example.org. Или javascript:alert(1)";
  const parts = splitLinks(text);
  assert.equal(parts.map((p) => p.text).join(""), text);
  assert.deepEqual(
    parts.filter((p) => p.href).map((p) => p.href),
    ["https://example.com/a_(b)", "https://www.example.org/"],
  );
});
