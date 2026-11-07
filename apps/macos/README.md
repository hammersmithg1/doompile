# Doompile for Mac

Native SwiftUI/AppKit desktop app with an embedded Safari Web Extension. Requires macOS 14 or later. The window follows desktop web: quiet sidebar search, a compact feed grouped by creation date, small urgent cards, and a resizable editor that appears when a note is opened. The fast composer is native and is usable before network sync completes. The expanded TipTap editor is bundled locally in WKWebView and never receives the connection token.

## Local build

From the repository root, with Node.js dependencies and Xcode installed:

```sh
npm ci
bash apps/macos/scripts/build.sh
```

Output: `apps/macos/dist/Doompile.app`. Open that app yourself in Finder; the script does not install it, launch it, open Safari, or change Safari settings. Local builds use an ad-hoc signature and do not require an Apple Developer account. This is a developer build, not a notarized release.

The build script writes its own clipper output under `apps/macos/.staging/clipper` and stages it into the app. It leaves `extensions/clipper/dist/safari` untouched, so an already-installed temporary extension can continue to be tested independently. The Python project generator can also run on Linux:

```sh
python3 apps/macos/generate_project.py
```

`DOOMPILE_CLIPPER_DIR` optionally selects a different built Safari resource directory for generation. The generator copies `packages/editor/dist` into app resources and references `apps/ios/Shared/Models.swift` and `Storage.swift` directly, so note formats, media upload, revisions, and conflict handling use the same implementation as iOS.

## Use

- Quick note: type in the bottom input and click the lime arrow or press **Return** (also **⌘ Return**). **Shift Return** or **Control Return** inserts a new line. The quick draft survives app restarts.
- The microphone records directly in the bottom composer. Files and photos can be added there without opening the full editor; both text and attachments survive restart. Expanding hands the same note to the editor, including its attachments.
- **⌘ N** opens a full new note. **⌘ F** or **⌘ K** focuses search.
- The full editor saves locally after a 600 ms typing pause and queues synchronization without moving the caret. There is no Save button. Titles are optional document headings. Existing notes open directly for editing; pin, urgent, delete, expand/collapse and close live in the header. A new expanded composer has only close. Tags appear below the header as removable hashtag labels with search suggestions and creation.
- Type **/** for blocks, files/photos, drawing, voice, and tables; type **@** to find another note. Select text for inline formatting. Hover a block for its drag handle, or use **⌥ ⇧ ↑ / ↓** to move it. Hover the right-hand chapter rail to expand the outline.
- **Enter** continues a list, an empty item exits it, **Shift Return** inserts a line break, **⌥ Return** adds a paragraph inside the item, and **Tab / Shift Tab** change nesting. `/nested` creates a bullet sublist inside a numbered item. Attachments stay inside their list item.
- Unsaved editor drafts are written locally and survive switching notes/window closing. **Continue draft** in the sidebar reopens the most recent draft. A successful save removes that draft.
- Add photos/files with `/photo` or `/file`, create a drawing with `/drawing`, or record with `/voice`. Files are stored locally before uploading; each file is limited to 30 MiB. Voice recording requests the normal macOS microphone permission only when the user starts recording.
- Long/right click a note for pin, urgent, and delete. Delete is a tombstone, with native Undo support.
- A note can have several tags.
- Sidebar tags can be created without creating an empty note. Pinning, urgency and edits never change the note's position within its creation-date group. The editor has a draggable width divider and animates opening, closing and expansion; Reduce Motion is respected.
- The main window is intentionally single-instance: it avoids two stale local editors overwriting the same offline note. Settings is a separate native window.

On the sign-in screen, enter the HTTPS server URL and choose browser sign-in through Yandex/Google. The local dev server can be `http://localhost:3000`; start it separately with the setec wrapper described in [OAuth setup](../../docs/authentication.md). The personal device token is saved only to Keychain. The Settings window displays the actual local data directory; shared App Group storage is used when available, with Application Support fallback in a local developer build.

## Global quick capture

The default shortcut is **⇧⌘ Space**. In **Doompile → Settings → Быстрая заметка**, click the shortcut field and press a new combination. Escape cancels recording; Delete disables the shortcut. System and exclusive application conflicts are reported before replacing a working binding. The setting survives restarting the app. The shortcut uses Carbon hot-key registration, not a global keyboard monitor or event tap.

The shortcut opens a focused compact input above the current application, on the display containing the pointer. Return sends the note; Shift Return adds a line. Expand opens a larger window with the same block editor used by web and iOS, tags, pinning, urgency, files, voice and drawing. **⌘ Return** sends from either presentation. Once loaded, the rich editor stays mounted across collapse/expansion, preserving blocks, formatting, selection and undo history.

Escape, clicking outside the compact panel, or pressing the global shortcut again hides it and retains a separate durable panel draft. Sending first saves to the native local store, then queues normal synchronization. An unavailable network never blocks entry or local submission. The panel draft does not overwrite the main-window composer or another open note. Quitting flushes open editors and the capture draft before the application exits.

In **Settings → Фоновый режим**, **Сворачивать в Dock** keeps Doompile in the Dock after closing its desktop windows, and **Показывать в строке меню** independently enables the branded monochrome funnel in the menu bar. Both preferences are saved on this Mac and default to off. All four combinations are supported, including a background mode with neither icon. Open desktop and Settings windows retain normal Dock and app-menu behavior; quick capture alone does not add a Dock icon. Reopen Doompile from Finder or Spotlight to return to the main window and Settings, even with both icons hidden.

Doompile keeps running after its main window closes, including the global shortcut and background sync. The optional menu-bar icon provides the same capture action and can reopen the main window. Quitting the application unregisters the shortcut.

**Запускать при входе в систему** uses macOS Service Management to register this app as a login item. The checkbox reads the actual system registration, including changes made in System Settings; pending approval is shown with a link to the system login-item settings. Login launches leave the main window hidden and respect both background visibility preferences. Normal launches from Finder or Spotlight open the main window. Autostart stays off until the user enables it; a registration failure is displayed without saving a misleading preference.

## Safari extension

The app contains `DoompileSafari.appex`. After opening the app, enable Doompile Clipper in **Safari → Settings → Extensions**. The unsigned developer extension requires Safari's developer setting to allow unsigned extensions. The build does not enable this on the user's behalf. Do not enable both the temporary extension and the app's extension at the same time, or Safari may show duplicate menu entries.

The packaged Mac popup offers **Use Doompile app connection**. Signed Release builds use App Group and shared Keychain entitlements for native connection pairing. In an unsigned/ad-hoc Debug build, app and extension may not share the default Keychain item's ACL; if native pairing is unavailable, enter the same endpoint/token directly in the extension popup. Alternatively, use the popup’s browser sign-in. Blank or placeholder tokens do not enable an authorization bypass.

Mac resources have their own native host identifier (`app.doompile.macos`) and label; the common extension sources and the user's temporary extension are not modified during packaging.

## CI and delivery

`.github/workflows/macos.yml` builds the native app and Safari extension, runs the common Swift/Mac tests and real Sparkle signing checks, and preserves the unsigned validation ZIP. Main delivery and the manual `publish_release` input publish a personal ad-hoc app authenticated by the existing Sparkle archive/feed signatures. The separate `signed_release` input uses Developer ID and notarization. Sparkle 2.10.0 is pinned through Swift Package Manager. Signing keys come from setec through the restricted GitHub OIDC/Tailscale identity; ongoing delivery does not depend on a local Mac.

CI compile-checks the app for Apple Silicon and Intel. Global invocation over other apps/Spaces, native panel focus, microphone permissions, media playback, and Safari enablement require interactive verification on the Mac. No test notes are inserted into the user's server during the build.

## Updates

**Doompile → Проверить обновления…**, the optional Doompile menu in the menu bar, and **Settings → Обновления** use the same updater, including before sign-in. The settings show the installed version/build, last check, and persistent preferences for daily background checks and automatic download/installation. Background checks are enabled by default; automatic download/installation requires opt-in. Sparkle displays update availability, progress, network/signature errors, and the install/relaunch action. Normal termination still saves open notes and the quick-capture draft. The Safari extension is replaced with the containing app.

Set DOOMPILE_MACOS_UPDATE_FEED_URL and DOOMPILE_MACOS_UPDATE_PUBLIC_KEY when building for your update channel. Both the feed and archive must be signed, and archives are verified before extraction. The signed Release configuration enables Sparkle's Installer XPC service and the two required Mach lookup exceptions; its sandboxed network downloads use the outgoing-network entitlement. The personal Debug configuration retains the existing local-build Keychain and extension-pairing behavior described above.

The private signing key is in setec `devices/doompile-ci/DOOMPILE_MACOS_UPDATE_PRIVATE_KEY`, in Sparkle's base64 32-byte seed format. It is passed to Sparkle over stdin, never written to a private-key file or included in the app. Run scripts/setup-update-key.py with the existing seed and feed URL to emit the public settings for your build environment.

`scripts/release.sh` now requires the update key in addition to the existing Developer ID credentials. A local release also needs an increasing `DOOMPILE_MACOS_BUILD_NUMBER`; the CI entry point selects a number greater than the currently published feed and its workflow counter. Output is `dist/release/Doompile-macOS-<build>.zip`, `release.json`, and a signed `appcast.xml`. `scripts/generate-appcast.py` checks the built app's settings, runs Sparkle's official generator, and verifies the resulting feed signature.

On the server, `infra/publish_macos_update.py` publishes the ZIP before atomically replacing the appcast. It checks the manifest, rejects rollback and changes to already published builds, and retains previous ZIPs for in-flight downloads. The web app serves public GET/HEAD/range requests under both `/doompile/downloads/macos/` and `/downloads/macos/`, so the reverse proxy may preserve or strip `/doompile`. Docker mounts only the public download directory read-only; no signing key is needed by the server.

The production runner and HTTPS download channel are deployed, with `DOOMPILE_MACOS_RELEASE_ENABLED=true` and `DOOMPILE_MACOS_UPDATE_PUBLISH_ENABLED=true` enabled for personal updates after the shared checks. Developer ID/notarization remains an optional workflow input. The first version containing the updater must be installed once. See [deployment](../../docs/deployment.md#обновления-macos).

To repeat the signing smoke test after a local build:

```sh
python3 apps/macos/scripts/test-update-delivery.py \
  apps/macos/build/Build/Products/Debug/Doompile.app \
  apps/macos/build/SourcePackages/artifacts/sparkle/Sparkle/bin
```

It copies the app into a temporary directory, creates an ephemeral test key, signs an isolated archive/feed, publishes into another temporary directory, and verifies that tampering fails. It does not launch/install the app or use the production signing key. A real notarized upgrade/relaunch remains a deployment smoke check.

## Editor regression tests

Run `npx playwright install chromium webkit` once, then `npm run test:editor` from the repository root. The suite checks real keyboard editing, lists with media, drag/undo, spacing, mentions, the selection toolbar and outline in Chromium and WebKit, plus full web autosave/reload and disk-failure recovery. It uses isolated browser storage, mocked note APIs and a separate `.next-editor-tests` build directory. `npm test` includes autosave serialization and document migration tests; `swift test --package-path apps/ios` covers native document migration and storage.

`bash apps/macos/scripts/test.sh` stages the canonical shared/native support sources into a temporary Swift package and runs the Mac timeline, shortcut preference and draft recovery tests without touching the real note store. `npm run editor:build && npx playwright test -c packages/editor/playwright.macos.config.ts` tests the actual native JavaScript bundle: compact Enter versus line breaks, slash-menu selection, composition, rich-document persistence and undo across presentation changes. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing local Chrome executable. These are editor tests, not a claim that the AppKit panel or global hot key was exercised by browser automation.

Audio and file cards use the shared media component in the feed and editor. Images can be resized using their corner handles. Recording appears inline and in the header with Stop controls. Native voice drafts are written under the local store before import; interrupted drafts are recovered when their note is opened. Web recording checkpoints append audio bytes in IndexedDB and recover after reopening the app.

### Refresh only the clipper in a local developer app

After the initial `npm run macos:build`, use `bash apps/macos/scripts/update-clipper.sh` for JavaScript/CSS-only clipper changes. It rebuilds the WebExtension resources, copies them into a staged copy of the existing generated developer app, applies the Mac native-messaging host, and verifies an ad-hoc signature before updating `dist/Doompile.app`. It does not compile Swift or use GitHub Actions. Restart/reload the development extension in Safari to load the new resources. Native handler or app changes still require a normal build. This is for the generated local developer app, not signed/notarized release distribution.

## Персональные аккаунты

На первом экране укажи сервер и нажми «Войти через браузер». Войди через Яндекс/Google, разреши подключение и вернись в приложение. В настройках отображаются имя, email и выход. SQLite, файлы, черновики и записи разделены по серверу и аккаунту; токен хранится в Keychain. Safari Clipper может взять персональное подключение из приложения. [OAuth и S3](../../docs/authentication.md).
