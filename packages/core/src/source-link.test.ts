import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceLink, quoteContext } from "./source-link";
const fixtures = JSON.parse(
  readFileSync(
    new URL("../test-fixtures/source-links.json", import.meta.url),
    "utf8",
  ),
);
for (const fixture of fixtures)
  test(`source navigation: ${fixture.name}`, () =>
    assert.equal(sourceLink(fixture.source), fixture.expected));
test("long quotes use bounded word-aligned endpoints, preserving canonical source", () => {
  const quote = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(" ");
  const source = { url: "https://example.com/article", quote };
  const url = sourceLink(source);
  assert.ok(url.length < 400);
  assert.equal(source.url, "https://example.com/article");
  const values = url.split(":~:text=")[1].split(",").map(decodeURIComponent);
  assert.ok(quote.startsWith(values[0]));
  assert.ok(quote.endsWith(values[1]));
  assert.ok(!values[0].endsWith(" "));
});
test("normalizes rendered whitespace, encodes lone surrogates, ignores malformed selectors", () => {
  assert.equal(
    sourceLink({ url: "https://example.com", quote: " A\t B\u00a0C " }),
    "https://example.com/#:~:text=A%20B%20C",
  );
  assert.doesNotThrow(() =>
    sourceLink({ url: "https://example.com", quote: "X\ud83d" }),
  );
  assert.deepEqual(
    quoteContext({ selector: { prefix: { bad: true }, suffix: 4 } }),
    { quotePrefix: "", quoteSuffix: "" },
  );
});
