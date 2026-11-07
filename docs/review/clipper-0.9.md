# iPhone Safari annotation prototype — Clipper 0.9.0

The iOS Safari WebExtension automatically offers **Сохранить в Doompile** after a stable text selection on a permitted webpage. This is a page overlay, not an item in iOS's system selection menu. Share Sheet remains available for other apps and browsers.

Only the lightweight `selection.js` observer is a static content script. It exits immediately on desktop, ignores editable fields, pauses while the user drags selection handles, and prepares the compact composer locally after selecting. Preparation neither saves a note nor uploads the quote. Full block-editor loading remains lazy.

Touch handling preserves a cloned Range before opening. The composer mounts/focuses synchronously inside `touchend`: WebKit suppresses the compatibility `click` when `pointerdown` is cancelled to preserve the selection. Browser tests verify that focus occurs while user activation is active. The panel follows visual-viewport dimensions and offsets, with 44px buttons and 16px inputs. It is positioned before focus and keeps the reading scroll position. The expanded reading-list option stays in a footer outside document scrolling.

After durable capture, mobile shows a short page receipt with an uploaded-note link. The desktop toolbar-popup path is retained. Clickout clears the composer and subsequent selections can reopen it. Source quote, context selector and source-link behavior from 0.8 remain intact.

## Verification

On 2026-10-31:

- 58 extension unit tests passed, including frame-specific mobile preparation with no network save, desktop opt-out, safe durable queueing, lost/closed reply channels and mobile receipt links.
- 8 desktop WebKit scenarios passed; 4 mobile WebKit scenarios passed. Mobile tests cover real touch events, trusted focus, exact capture, clickout/reselection/editable-field exclusion, an emulated smaller visual viewport, and maintaining the scroll position.
- TypeScript checks passed. 19 Swift model/storage/source-link tests passed.
- iOS Simulator app, Share Extension and Safari Extension built successfully. Manifest 0.9.0 contains the mobile selection content script.
- Mobile browser emulation does not exercise Safari's native selection callout, permissions UI or actual iPhone keyboard. Those require testing the TestFlight build on a device.

Screenshots from the mobile WebKit fixture: `clipper-0.9-mobile-selection.png`, `clipper-0.9-mobile-compact.png`, `clipper-0.9-mobile-keyboard.png`. The keyboard screenshot tests the reduced visual-viewport layout; it does not depict a native system keyboard.

## Device setup

1. Update Doompile through TestFlight.
2. Enable Doompile in iOS Settings → Apps → Safari → Extensions and allow access to the desired websites (or all websites).
3. Reload already-open pages. Select text, then tap the Doompile button below the selection.
4. If this Safari extension has no server connection yet, open its Safari menu → gear → **Взять подключение из приложения**, granting access to the configured server when requested.

The frozen release source is `/tmp/doompile-mobile-release-3-1`; source hashes are recorded in `clipper-0.9-source-manifest.json`. Distribution uses the existing Doompile manual signing assets in setec with temporary signing files/keychain cleanup. No new credentials or tester invitations are created.

TestFlight 0.1.0 (3.1) uploaded successfully. Delivery/build ID: `1a208afb-f367-481b-b36d-ef900a6c2933`. Apple confirmed `processingState=VALID`, `internalBuildState=IN_BETA_TESTING`. Russian release notes were added. The existing Doompile Internal group has automatic access to all builds; an explicit redundant assignment was rejected by Apple (422), so no membership or group settings were changed. Temporary signing material was removed after export/upload.
