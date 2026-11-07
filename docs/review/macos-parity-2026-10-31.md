# macOS · desktop parity and global capture · 31 October 2026

Compared the running desktop web app with the Mac shell and reviewed the recent chats «Общее Десктоп», «Переработать редактор заметок», «MasOS Extension» and «iOS Апп».

The Mac shell now uses the desktop web palette, sidebar search, compact creation-date groups, small urgent cards, and an optional resizable inspector. Expanding hides the feed and sidebar without recreating the editor; opening/closing animates and respects Reduce Motion. Native quick entry supports Enter submission, inline voice recording and attachments. Tags use arrays throughout, including names containing commas; creating a sidebar tag does not create a note. Native save/close policy comes from the shared `EditorLifecycle`.

Default global shortcut: **⇧⌘ Space**, configurable/disableable in Settings. Carbon exclusive registration checks symbolic system shortcuts and registration errors before replacing a binding. The nonactivating AppKit panel starts with a native text input. Its larger presentation uses the bundled shared block editor. The loaded rich editor remains mounted across collapse/expansion. Escape/repeated shortcut/outside compact click retains a separate local draft; sending writes to native storage before network sync. The menu bar remains available after the main window closes. Quit flushes editors and panel drafts. Unreadable draft bytes are retained in a recovery file before replacing that draft slot.

Document loading no longer creates a ProseMirror history entry: Undo after the first keystroke retains the loaded document.

Validation: universal arm64/x86_64 Xcode build and deep/strict ad-hoc signature verification; 26 shared Swift tests; 10 Mac support tests; 8 native-bundle browser scenarios across Chrome/WebKit; 53 shared editor WebKit regression scenarios; 140 JavaScript unit tests; web/editor TypeScript checks. Browser scenarios cover compact submission, line breaks, command selection, composition, and document/undo preservation. Tests use temporary stores and isolated browser fixtures.

Output: `apps/macos/dist/Doompile.app`, including the current Safari extension. The build leaves the temporary Safari extension directory untouched. No production notes, installed app, Safari settings or credential configuration were changed.

Native computer control is unavailable in this session. The real global shortcut, first-responder behavior over other applications/fullscreen Spaces, native microphone authorization and panel window animations have not been exercised interactively. Browser tests verify the editor rather than AppKit integration. No automatic update or login item was configured.
