# Clipper 0.10 — automatic annotations and one persistent editor

Stable mobile text selection now opens the compact annotation directly. It does not autofocus, so native selection and its menu remain available until the user taps the input. UIKit does not expose that menu's bounds to webpage JavaScript: the layout reserves the preferred menu side based on selection headroom and places the composer on the opposite side when it fits, with a separated viewport-edge fallback. This is a geometry heuristic, not native-menu detection.

Expanded iPhone annotations use a fixed frame filling the visual viewport. Only the inner document scrolls; background overflow and inert state are restored exactly on collapse/dismiss. Visual-viewport resize/pan updates the frame without adding document scroll offsets.

The full editor previews the actual saved document, including source quote/link and captured images. `captureDocument` builds it once; the save path accepts the complete document without prepending another citation. Original provenance metadata stays available separately. Deleting/moving a source in the full editor is retained in the saved body.

After initial upgrade from the quick textarea, compact and full views share the same live ProseMirror instance and document. The root moves between presentation containers; compact mode hides source cards visually. It never round-trips through plaintext. Selection, marks, tables/checklists, Undo/Redo and edited block order are kept. The bounded loader is shared with a background preparation on input focus. ProseMirror focus is synchronous: Tiptap's deferred iOS focus had allowed the DOM caret to reset after reparenting.

This document/preview behavior applies to the common clipper composer on Safari, Chromium and Firefox, in both toolbar popup and page annotation. Native iOS Share Sheet is unchanged.

## Validation

- 62 extension/model/layout unit tests passed, including exact full-document persistence with no duplicate source and explicit source removal.
- 12 WebKit browser scenarios passed (8 desktop, 4 iPhone emulation). Mobile checks cover no-focus automatic display, native selection preservation, fixed full-screen keyboard viewport, internal scrolling, restoration of the page state, exact preview/save equality, bold text/caret continuity and Undo/Redo after repeated collapse/expand.
- TypeScript checks passed. Native app code is unchanged; the local signed archive/export also builds the packaged Safari resources.
- Device testing remains necessary for UIKit's real menu placement and keyboard transitions. Browser emulation cannot observe the system menu.

Screenshots: `clipper-0.10-mobile-selection.png`, `clipper-0.10-mobile-editor.png`, `clipper-0.10-mobile-keyboard.png`.

Release is built/signed/uploaded locally, without invoking GitHub Actions. TestFlight build 0.1.0 (4.1): local archive, export and upload succeeded. Delivery UUID: `02019ef6-2f0f-40f0-bea5-429b36acb331`. Apple processing completed: `processingState=VALID`, `internalBuildState=IN_BETA_TESTING`. The build is present in the existing Doompile Internal group and Russian release notes are published. Temporary signing files/keychain/profiles were cleaned. The frozen source is `/tmp/doompile-mobile-release-4-1`, with hashes in `clipper-0.10-source-manifest.json`. The snapshot also includes the non-secret `infra/apple_links.py` dependency required by the current project generator; the initial archive attempt stopped before upload when that dependency had not yet been copied.

The generated Mac developer app was refreshed with `apps/macos/scripts/update-clipper.sh`: extension resources only, no Swift compilation; ad-hoc signature verification passed. Unpacked Safari/Chromium/Firefox builds also contain 0.10.0.
