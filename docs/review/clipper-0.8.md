# Return to an annotated passage (0.8.0)

Source links now use native browser Text Fragments. Original source URLs stay canonical in notes and Reading List; navigation URLs are generated only at link rendering/open time. Desktop/web rich-editor source blocks, feed metadata, source snippets, link previews, native source links and `Note.sourceURL` use the same behavior. No content-script access or extension on the destination page is needed.

The TypeScript helper lives in `packages/core/src/source-link.ts`; Swift uses `apps/ios/Shared/SourceLink.swift`. Both implementations run shared fixtures for punctuation, Cyrillic/emoji, exact and multi-block terms, existing hashes/directives, timestamps and unsafe protocols. Scripts and document selectors never store page coordinates as the return anchor. URL components use strict percent encoding, including literal hyphens.

New captures use the real selected Range, not the first occurrence of the quote in the parent text. Context comes from text before/after the actual selection or neighboring visible blocks. The source metadata retains TextQuoteSelector, while source blocks retain flat prefix/suffix attributes. Old notes inherit existing context without rewriting their canonical URL or authored text. Metadata extraction preserves it on subsequent edits.

Long quotations use the beginning and end of the quote, bounded to words within one block per term. This limits URL size and can survive edits in the middle. Exact/context matching is delegated to the browser. No private APIs, page mutation, server fetch, Docker, or auto-injected scripts are required. If text or context disappears, changes significantly, is hidden by authorization, is inside an iframe or isn't loaded in time, the browser can open the page without finding a match. No universal guarantee is made.

Validation (2026-10-31):

- 22 core/editor unit tests; 55 extension tests; 19 Swift tests passed.
- 8 WebKit browser scenarios passed, including two equal quotations with different context, split inline markup, multi-paragraph selection after layout/middle-text edits, and capturing the second equal text occurrence.
- The navigation test clicks the actual editor source link into a new top-level page which contains no extension code; native scrolling and visible highlighting were inspected in `clipper-0.8-return-to-quote.png`.
- Web/editor TypeScript checks, local Mac build/signature verification and iOS Simulator build checked separately.

The user's installed Safari profile and physical iPhone were not operated. No TestFlight upload was triggered by this task.
