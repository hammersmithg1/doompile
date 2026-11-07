import { test } from "node:test";
import assert from "node:assert/strict";
import { createNote, noteSchema } from "../../core/src/index";
import { prepareDocument, documentSource } from "../src/blocks";
import { normalizeMedia } from "../src/inline-media";
const body = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Content" }] },
  ],
};
test("legacy media becomes inline without losing file metadata, dimensions or its original line", () => {
  const legacy = {
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src: "/api/attachments/613e83a9-92e2-4cd7-8477-9b9395b503c0",
          width: 264,
          height: 83,
        },
      },
      {
        type: "sourceSnippet",
        attrs: { url: "https://example.com", quote: "Exact quote" },
      },
    ],
  };
  const normalized = normalizeMedia(legacy);
  assert.deepEqual(
    normalized.content?.map((node) => node.content?.[0]),
    legacy.content,
  );
  assert.deepEqual(normalizeMedia(normalized), normalized);
  const prepared = prepareDocument(normalized, "", {
    url: "https://example.com",
    quote: "Exact quote",
  });
  assert.equal(
    JSON.stringify(prepared).split('"type":"sourceSnippet"').length - 1,
    1,
  );
});
test("manual source cards supply metadata without treating a blank note as a source", () => {
  assert.equal(documentSource(body), undefined);
  assert.equal(
    documentSource({
      type: "sourceSnippet",
      attrs: { url: "javascript:alert(1)" },
    }),
    undefined,
  );
  assert.deepEqual(
    documentSource({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "sourceSnippet",
                  attrs: {
                    url: "https://example.com",
                    title: "Title",
                    quote: "Exact quote",
                    timestampSeconds: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    }),
    { url: "https://example.com", title: "Title", quote: "Exact quote" },
  );
});
test("legacy title and source become blocks exactly once", () => {
  const source = {
    url: "https://example.com",
    title: "Article",
    quote: "Exact quote",
    timestampSeconds: 0,
  };
  const migrated = prepareDocument(body, "Legacy title", source);
  assert.deepEqual(
    migrated.content?.map((n) => n.type),
    ["sourceSnippet", "heading", "paragraph"],
  );
  assert.deepEqual(prepareDocument(migrated, "Legacy title", source), migrated);
  assert.equal(migrated.content?.[0].attrs?.timestampSeconds, 0);
  const deleted = { ...migrated, content: body.content };
  assert.deepEqual(prepareDocument(deleted, "Legacy title", source), deleted);
});
test("plain content never gains a duplicate title or an unwanted heading", () => {
  assert.deepEqual(prepareDocument(body, "Content").content, body.content);
  assert.deepEqual(prepareDocument(body).content, body.content);
});

test("source selectors remain metadata, never unsupported nested block attributes", () => {
  const source = {
    url: "https://example.com",
    quote: "quote",
    selector: { type: "TextQuoteSelector", exact: "quote" },
  };
  const migrated = prepareDocument(body, "", source);
  assert.equal(migrated.content?.[0].attrs?.selector, undefined);
  assert.equal(
    noteSchema.safeParse(createNote({ body: migrated as any, source })).success,
    true,
  );
});

test("legacy clip migrates to one quote and a source link while retaining comments and PDFs", () => {
  const source = {
    url: "https://example.com/article",
    title: "Page title",
    quote: "Exact quotation",
  };
  const quote = {
    type: "blockquote",
    content: [
      { type: "paragraph", content: [{ type: "text", text: source.quote }] },
    ],
  };
  const comment = {
    type: "paragraph",
    content: [{ type: "text", text: "My comment" }],
  };
  const attachment = {
    type: "attachment",
    attrs: { url: "/api/attachments/example", name: "Saved.pdf" },
  };
  for (const versioned of [false, true]) {
    const body = {
      type: "doc",
      ...(versioned ? { attrs: { editorVersion: 1 } } : {}),
      content: [
        ...(versioned
          ? [
              { type: "sourceSnippet", attrs: source },
              {
                type: "heading",
                attrs: { level: 1 },
                content: [{ type: "text", text: source.title }],
              },
            ]
          : []),
        quote,
        comment,
        attachment,
      ],
    };
    const migrated = prepareDocument(body, source.title, source);
    assert.deepEqual(
      migrated.content?.map((node) => node.type),
      ["sourceSnippet", "paragraph", "attachment"],
    );
    assert.deepEqual(migrated.content?.slice(1), [comment, attachment]);
    assert.deepEqual(prepareDocument(migrated, source.title, source), migrated);
  }
});
test("a quote or heading authored later in the document is never removed", () => {
  const source = {
    url: "https://example.com",
    title: "Title",
    quote: "Quotation",
  };
  const blocks = [
    { type: "paragraph", content: [{ type: "text", text: "My comment" }] },
    {
      type: "blockquote",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Quotation" }] },
      ],
    },
  ];
  assert.deepEqual(
    prepareDocument(
      { type: "doc", content: blocks },
      source.title,
      source,
    ).content?.slice(1),
    blocks,
  );
});

test("a deleted source block and later authored duplicate quotes stay untouched", () => {
  const source = {
    url: "https://example.com",
    title: "Title",
    quote: "Quotation",
  };
  const quote = {
    type: "blockquote",
    content: [
      { type: "paragraph", content: [{ type: "text", text: source.quote }] },
    ],
  };
  const manuallyEdited = {
    type: "doc",
    attrs: { editorVersion: 1 },
    content: [quote],
  };
  assert.deepEqual(
    prepareDocument(manuallyEdited, source.title, source),
    manuallyEdited,
  );
  const canonical = {
    type: "doc",
    attrs: { editorVersion: 1, captureVersion: 2 },
    content: [{ type: "sourceSnippet", attrs: source }, quote],
  };
  assert.deepEqual(prepareDocument(canonical, source.title, source), canonical);
});

test("existing source blocks inherit quote context and retain it through metadata extraction", () => {
  const source = {
    url: "https://example.com",
    title: "Title",
    quote: "Repeated quote",
    selector: {
      type: "TextQuoteSelector",
      exact: "Repeated quote",
      prefix: "Before second",
      suffix: "After second",
    },
  };
  const body = {
    type: "doc",
    attrs: { editorVersion: 1, captureVersion: 2 },
    content: [
      {
        type: "sourceSnippet",
        attrs: { url: source.url, quote: source.quote },
      },
    ],
  };
  const prepared = prepareDocument(body, "", source),
    node = prepared.content![0];
  assert.equal(node.attrs?.quotePrefix, "Before second");
  assert.equal(node.attrs?.quoteSuffix, "After second");
  assert.equal(node.attrs?.url, source.url);
  assert.deepEqual(documentSource(prepared)?.selector, source.selector);
});
