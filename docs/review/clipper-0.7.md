# Clipper 0.7 — chat editor and capture fixes

- Page messages have bounded waits and a second response through `scripting.executeScript` into the originating isolated frame. A callback that never resolves no longer leaves save/expand permanently disabled. Loading the rich editor also detects that its bundle has executed independently of Safari's injection acknowledgement. A completely unavailable background produces an actionable error and retains the draft.
- An unchanged failed submission keeps its UUID and creation time so retrying cannot create another server note. Durable queuing still precedes optional Reading List work; that native operation also has a deadline. Badge rendering cannot block a capture acknowledgement.
- The expanded composer uses the actual desktop/web `createBlockEditor` and its CSS, with contextual formatting and slash commands. Attachment/voice commands without a provider are hidden. Tags use searchable existing choices, create/remove chips and keyboard navigation. Compact urgent, expand and send remain. Escape first closes a tag picker; clickout clears the composer.
- New clips write one `sourceSnippet` with quote and small source link. Source titles remain metadata, not generated document headings. Legacy generated duplicate prefixes are normalized once in the shared web editor and native model. Comments, later authored blocks and attachments are preserved. `captureVersion: 2` prevents reapplying normalization to later edits. Already deleted versioned source cards are not restored.

Verification on 2026-10-31:

- 55 extension unit tests passed (queue/retry/permissions, content bridge, lost replies and bounded waits).
- 7 editor migration tests and 17 Swift model/storage tests passed.
- 5 WebKit browser tests passed: compact save, shared expanded editor/tags, completely unresponsive background with recovery, clickout reset, one source in saved editor. The browser fixture simulates Safari's missing/closed reply using real capture/background/composer/editor code and an isolated test notes endpoint; it does not operate the user's Safari profile.
- Web/editor TypeScript checks passed; local Mac build and ad-hoc signature verification passed. Bundled manifest reports 0.7.0 and includes the transport and shared editor bundles.

Artifacts: `clipper-0.7-expanded.png`, `clipper-0.7-saved-note.png` (WebKit fixture screenshots). The installed Safari extension still needs a reload for live-site verification; these tests do not claim to reproduce the user's original browser state or exercise native Reading List insertion.

Build: `npm run macos:build`. App: `apps/macos/dist/Doompile.app`. Unpacked outputs: `extensions/clipper/dist/{safari,chromium,firefox}`.
