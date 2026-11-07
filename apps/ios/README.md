# Doompile for iPhone

Native SwiftUI app, native iOS Share Extension, and a Safari Web Extension in the same bundle. Deployment target: iOS 17. A local App Group file store is read synchronously at launch; typing and saving never depend on a server request. App and Share Extension use a file lock and atomic replacement to preserve concurrent writes. The API token is stored in a shared Keychain access group, never in `UserDefaults`.

## Build locally

From the repository root:

```sh
npm ci
node extensions/clipper/build.mjs
npm run editor:build
python3 apps/ios/generate_project.py
xcodebuild -project apps/ios/Doompile.xcodeproj -scheme Doompile \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/doompile-ios CODE_SIGNING_ALLOWED=NO build
swift test --package-path apps/ios --scratch-path /tmp/doompile-core-tests
```

Open `Doompile.xcodeproj` in Xcode to run on a simulator or signed device. `generate_project.py` is deterministic and works on a Linux devbox; it does not require XcodeGen or CocoaPods. It copies the current built Safari resources. Run it again whenever extension resources change. Generated resources are not the authoritative clipper source: edit `extensions/clipper/src/`.

The simulator can reach the locally running Next.js API at `http://localhost:3000`. A physical iPhone needs a reachable **HTTPS** origin (for example, the future devbox deployment). Enter the origin on the sign-in screen, sign in with Yandex/Google in the browser, approve the device, and return to the app. [OAuth setup](../../docs/authentication.md). Do not put production tokens in source files.

## Current behavior

- After sign-in, Home opens directly into the account-specific local note list with a persistent quick input. The draft survives app restarts. Long press a note for urgent, star, or delete; swipe from the left edge for navigation and tag tags. Notes can belong to several tags.
- The expanded editor runs a locally bundled TipTap document editor inside WKWebView: rich text, headings, lists, checklists, tables, code, links, inline images/media and note references work offline. The quick home composer remains native SwiftUI. Native controls add photos, files, voice recordings and sketches as both attachments and inline blocks. Existing web rich documents retain their structure. The token is never exposed to editor JavaScript: a private `doompile-media` URL scheme loads local files or authenticates downloads in native code.
- Share → Doompile accepts a URL, text, images and common files; Safari preprocessing supplies the selected quote and page title when Safari makes it available. You can add a comment and a YouTube timestamp without opening the main app. Each file is limited to 30 MiB.
- The shared payload is committed to the App Group outbox before showing success. The extension then attempts network sync for up to two seconds. If offline, the containing app syncs it on next foreground activation. Background delivery while the app stays closed is **not guaranteed** in this first version.
- Safari Web Extension: enable it in iOS settings, open its popup, and use the iPhone app connection button. Grant access to the websites where you want automatic annotations, then reload the page. Selecting text automatically shows the shared compact annotation composer without opening the app or taking keyboard focus. Tap its input to type. The full editor occupies the visual viewport above the keyboard, with internal document scrolling. The full editor shows the source snippet and preserves the same live document, formatting and undo history across compact/full views. Its bundle is prepared on input focus and otherwise loaded on expand. A compact receipt offers the saved-note link and dismisses after 2.2 seconds. Editable fields are ignored. Safari does not expose the desktop context-menu API on iOS. The popup requests permission to reach the configured API origin. Desktop Chromium/Firefox load the same clipper's corresponding build. Other iOS browsers use the system Share Sheet; Safari extensions do not run inside them.
- Shared YouTube links preserve `t`/`start` timecodes. The extension cannot inspect playback inside the native YouTube app; absent timecodes are editable manually.
- Sync uses revision checks. On conflicting writes, the local version becomes a separate conflict copy instead of overwriting another device. Source data and rich bodies survive a Codable roundtrip. Polling runs only while the native app is active.

## Signing and TestFlight

The `iOS` GitHub Actions workflow builds the app and its three extensions, runs the shared tests and all 20 touch UI tests, then signs/archives/uploads when `upload_testflight=true`. Main delivery has `DOOMPILE_TESTFLIGHT_AUTO_UPLOAD=true` enabled. CI uses the newest available iPhone runtime deterministically; unsigned diagnostics can select `test_filter` and an explicit `simulator_os` such as `18.5` or `26.2`. A release upload cannot use a single-test filter.

**The configured CI signing mode is manual.** The `automatic` workflow choice remains available for a Team API key with provisioning/cloud-signing permissions; in that mode Xcode manages provisioning through `-allowProvisioningUpdates`, `-authenticationKeyPath`, `-authenticationKeyID` and `-authenticationKeyIssuerID`. An Apple password or 2FA session is not used.

Use an active paid Apple Developer Program team with accepted agreements. To bootstrap identifiers, capabilities and cloud signing, use a **Team API key** with sufficient provisioning and cloud-distribution permissions; an Admin Team Key covers these steps. It grants access across the team's apps. An Individual API key cannot use provisioning endpoints. A lower-permission key can be used for upload-only workflows after the signing assets and app setup are established.

Register these bundle IDs and enable the App Group and shared Keychain capabilities on all four:

| Target | Bundle ID |
| --- | --- |
| App | `app.doompile` |
| Share Extension | `app.doompile.share` |
| Safari Extension | `app.doompile.safari` |
| Action Extension | `app.doompile.action` |

App Group: `group.app.doompile`. Keychain access group: `<AppIdentifierPrefix>app.doompile.shared`. If the IDs are already taken, change them consistently in the generator, `Connection.group`, Safari native messaging and signing script before registering. Initial identifier registration, App Group creation/association or signing setup may require bootstrap in the Apple Developer portal for the particular team. All four targets need the same App Group and compatible shared Keychain entitlements. Register an iOS app record in App Store Connect; the CLI upload does not create it. Create an internal TestFlight group and enable automatic distribution to deliver processed builds to the tester. Apple processes an uploaded build before it becomes installable; external testers may additionally require beta review. Set the app's export-encryption declaration accurately to avoid blocking automatic distribution on a manual compliance question.

Canonical signing inputs live in setec under `devices/doompile-ci/`. The ephemeral GitHub runner joins Tailscale with its repository/main-scoped OIDC identity and invokes the canonical setec wrapper; Apple keys are not GitHub Secrets. `.agents/ci/bootstrap.py` prepares only public client/configuration, and `.agents/ci/native.py` restores public runner DNS after loading the inputs. The manual `Signing access` workflow diagnoses this connection before rebuilding the apps. Do not save credentials in this repository or on client machines.

| Common input | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer team identifier |
| `APP_STORE_CONNECT_KEY_ID` | App Store Connect team API key identifier |
| `APP_STORE_CONNECT_ISSUER_ID` | API issuer UUID |
| `APP_STORE_CONNECT_P8_BASE64` | Base64 of that API key's P8 contents |

**Manual signing:** choose `manual` in the workflow-dispatch `signing_mode` selector, or set the repository variable `DOOMPILE_IOS_SIGNING_MODE=manual` for automatic main-branch uploads. Direct script invocation uses `IOS_SIGNING_MODE=manual`. Only that mode additionally requires:

| Manual-only input | Value |
| --- | --- |
| `IOS_DISTRIBUTION_P12_BASE64` | Base64 of Apple Distribution certificate with private key |
| `IOS_DISTRIBUTION_P12_PASSWORD` | P12 export password; empty is supported if that P12 has no password |
| `IOS_PROFILE_APP_BASE64` | App Store distribution profile for `app.doompile` |
| `IOS_PROFILE_SHARE_BASE64` | App Store distribution profile for `app.doompile.share` |
| `IOS_PROFILE_SAFARI_BASE64` | App Store distribution profile for `app.doompile.safari` |
| `IOS_PROFILE_ACTION_BASE64` | App Store distribution profile for `app.doompile.action` |

Manual profiles must authorize the shared App Group and Keychain access group and use the same App ID prefix; a legacy App ID prefix may differ from the Team ID. Development or Ad Hoc profiles cannot be used for this distribution mode. The script does not overwrite an existing runner profile.

The signing script uses a temporary runner keychain and removes the keychain and temporary P8, P12 and manually installed profiles in an exit trap. It restores the original default keychain and search list. Never run it with `set -x`. The CI entry point selects the next increasing build number from App Store Connect and waits for processing to reach VALID. The production runner preserves IPA, symbols and source manifests under `/srv/projects/doompile/runtime/diagnostics/native/ios`, independently of GitHub artifact expiry. The deployed team/app/internal distribution group are already configured; see [server operations](../../docs/server-operations.md).

Apple documentation: [CI authentication and cloud signing](https://developer.apple.com/videos/play/wwdc2021/10204/), [Team API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api), [App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups), [automatic TestFlight distribution](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/), [upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds).

### iPhone touch workspace

The app follows the desktop palette with System, Light and Dark appearance choices in Settings. Navigation opens with a leading-edge swipe; search, tag creation and connection settings live in that drawer. Native trailing swipe actions expose pin, urgency and delete. Quick voice capture stays inline, and the quick text draft survives keyboard dismissal.

The native editor uses the same block document as the web editor, including legacy-title/source migration. New drafts focus on load; existing notes open without a keyboard. Its horizontally scrollable SwiftUI control strip uses a bottom safe-area inset so it follows the keyboard. A public WKWebView subclass suppresses the redundant system accessory; desktop-only block handles and floating formatting controls are hidden only when the native touch mode is enabled.

`DoompileUITests` covers keyboard/refocus, new/existing editor focus, toolbar positioning/scrolling, sidebar search/settings, note swipes, and inline recording. Run on a disposable simulator:

```sh
xcodebuild -project apps/ios/Doompile.xcodeproj -scheme Doompile \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test
```

The test app's debug-only `DOOMPILE_UI_TESTING=1` launch environment disables network sync and clears visible test notes on that simulator before each test. Release builds do not include this hook. See [touch review](../../docs/review/ios-touch.md).

### Second touch pass · 2026-10-31

A short note's entire editor page accepts a tap to begin editing. The bottom save checkmark is removed; the close button saves, while the fixed keyboard-dismiss control stays beside the scrollable tools. Drawer motion uses one persistent sidebar and settles in 180 ms. Notes retain their identity when moved between pinned, urgent and regular sections.

`QuickNoteIntent` is exported through `DoompileShortcuts` for the system Shortcuts catalog and Action Button. The quick capture URL is `doompile://quick-note`. System discovery and the shared URL route are tested. End-to-end execution of the system tile still needs a physical iPhone check: iOS 26.2 Simulator reports the same provider lookup failure for Doompile and Apple's official Trails sample. See [validation and release status](../../docs/review/ios-touch-round2.md).

### Capture action and lifecycle · 2026-10-31

The app now embeds four targets: Doompile, Share, Safari, and `DoompileAction` (`app.doompile.action`). The action appears as «Сохранить в Doompile» in the system share sheet, with a monochrome Doompile icon. It compiles the same capture controller and shared storage as Share; both use `group.app.doompile`. Signing also requires `IOS_PROFILE_ACTION_BASE64`, stored with the other Apple inputs in setec.

Native editor save decisions and draft recovery live in `Shared/EditorLifecycle.swift`, used on iPhone and Mac. A nonempty quick draft is saved when expanded and on close, including before WebKit is ready. Autosave accepts revision and media URL acknowledgements without replacing newer typing. The web close handler explicitly queues current content before flushing; Swift and JavaScript run the same lifecycle fixtures.

The timeline is ordered by creation date. Note actions use a finger-following reveal with a symmetric 140 ms settle; its scroll container avoids UIKit list-cell button interception. Tag search and creation share one field. Simulator UI checks use ad-hoc signing so extension/App Group entitlements are present; developer credentials are not required. See [round 3 validation](../../docs/review/ios-touch-round3.md).

Account data is partitioned by server origin and user ID in the App Group and Keychain. Signing out hides that account’s local data; signing into another account opens a separate collection. Legacy unowned data remains separate until its owner is assigned.
