# Clipper 0.11 — iPhone capture and fullscreen editor

The shared editor bundle now uses a content-hashed filename and an explicit version/build contract. Loaders reject a stale isolated-world global and inject the matching module before mounting. This prevents the observed `setCompact is not a function` failure without flattening the draft. Compact/full presentation still uses one live editor; touch collapse retains the document and formatting. Collapse is also available while the first editor module is loading.

For automatic iPhone text capture, the compact composer uses the viewport edge farthest from the selection. Both possible native-menu sides are reserved rather than assuming UIKit always places its menu above. UIKit's actual menu is outside the DOM, so unusual large selections or system previews still require device verification; this is not native-menu detection.

Image-only ranges, stationary image holds, and image context-menu events start an image annotation. Native events are not cancelled. Short taps, moved fingers, and scrolling do not start capture. Lifting the finger after a recognized hold preserves the pending capture while its module loads.

Safari's toolbar popup uses the sheet's available width. On iPhone, expanding hands its draft, flags, tags and reading-list choice to the page editor and closes the popup after acknowledgement. Fullscreen therefore lives on the page rather than inside the constrained native popup. Failed handoff leaves the popup draft available. Settings remain behind its gear.

The expanded editor has two layers: an opaque layout-viewport backdrop, including the gap above Safari's keyboard accessory, and the editing frame sized to the visual viewport. Header/footer stay within that frame and only the document scrolls. The contenteditable canvas fills the available space; taps in its empty surface/padding focus synchronously in the touch gesture. Collapse/dismiss restores background scrolling and inert state.

The Reading List MVP is unchanged: URL plus the browser's reading list, no PDF/download service.

Validation: 64 unit tests and 18 WebKit browser scenarios passed, including nine iPhone scenarios. The same suites passed against the frozen release snapshot. TypeScript checks passed. Tests exercise real touch events in WebKit emulation; they do not emulate UIKit's actual menu or keyboard. Screenshots are `clipper-0.11-mobile-{selection,editor,keyboard,toolbar-expanded}.png`.

Local signed archive/export/upload succeeded for TestFlight 0.1.0 (5.1), without GitHub Actions. Delivery UUID: `a1ec6b1f-e9ca-494d-b621-fdce5fa75f0d`. Frozen source: `/tmp/doompile-mobile-release-5-1`; file hashes: `clipper-0.11-source-manifest.json`. Apple processing completed: `processingState=VALID`, `internalBuildState=IN_BETA_TESTING`. The build is available in the existing Doompile Internal group; Russian testing notes are published.

The generated local Mac app also received extension resources only, without Swift compilation; its ad-hoc signature verification passed. No installed app or unsent clip storage was replaced or cleared.

Upload completed and temporary signing directory/keychain/profiles were cleaned. The final readiness check succeeded after temporarily enabling Tailscale with user authorization. No GitHub Actions run was started.
