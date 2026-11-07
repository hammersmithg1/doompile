# Doompile Web Clipper — Reading List MVP (0.8.0)

Shared WebExtension source for Safari (Mac/iOS), Chromium and Firefox. Capture stores the selected quote, source URL, annotation and tags in Doompile. The optional **В список чтения** checkbox also adds that URL to the browser's own Reading List.

There is no custom page downloading, scrolling, resource collection, HTML archive, article-text extraction or PDF conversion. Existing notes and already-created PDF attachments are left intact. Old pending PDF tasks no longer run: their notes are delivered normally and their obsolete archive payloads are removed with the acknowledged queue entry.

```sh
npm install
npm run clipper:build
node --test extensions/clipper/test/*.test.mjs
```

Outputs: `dist/chromium`, `dist/firefox`, `dist/safari`. Native builds can use a separate `--out-dir` so the live temporary extension is not overwritten during packaging.

## Install

- Chromium: load `dist/chromium` as an unpacked extension. The package requests `readingList` permission. The checkbox is available when the browser exposes that API.
- Firefox: load `dist/firefox/manifest.json` in `about:debugging`. Notes still work; the Reading List checkbox is hidden because there is no supported browser API for this path.
- Safari on Mac: run `npm run macos:build`, open `apps/macos/dist/Doompile.app`, then enable its Doompile Clipper in Safari Settings → Extensions. Disable the separately loaded temporary extension to avoid duplicate actions. Unsigned development builds require Safari's normal unsigned-extension allowance.
- Safari on iPhone: the iOS app embeds the extension; enable it in Settings → Apps → Safari → Extensions after installation.

A temporary Safari extension loaded directly from a folder still saves notes, but cannot invoke the containing app's native Reading List handler. For Reading List use the extension bundled inside the app. A native-messaging failure is reported and never claimed as a successful browser archive.

## iPhone annotations

On permitted iPhone/iPad Safari pages, a stable text selection automatically shows the compact annotation composer. It does not focus an input or dismiss the system selection menu; tap the input to type. The lightweight static selection observer exits on desktop, ignores editable fields, and prepares the UI locally only after a selection. No quote is uploaded until Save.

UIKit's selection menu is outside the page DOM and does not expose its actual bounds. Placement reserves Safari's preferred side using selection headroom and places the composer on the other side when it fits, otherwise at a separated viewport edge. This is an explicit geometry heuristic, not detection of the native menu.

The mobile expanded editor fills the visual viewport with a fixed frame. Its document scrolls internally while the underlying page is inert/scroll-locked; collapsing restores the previous page state. Keyboard resizing/panning updates that frame.

The first expansion upgrades the plain draft to the same full document that will be saved, including its source snippet. Compact and full views then reuse one live block-editor instance: moving its root preserves document structure, selection and undo history. Compact mode hides source cards visually without deleting them. No conversion back to plain text occurs on collapse. All clipper platforms use this model, including the toolbar popup.

Enable the extension, grant site access, and reload already-open tabs after an update. Share Sheet remains available outside Safari. The app connection can be imported through the extension settings.

## Saving and reading

1. Select text → **Сохранить в Doompile**, or click the toolbar icon to save a whole-page link.
2. Write in the chat input; expand for rich formatting, tags, pin/urgent flags and video timestamps.
3. Optionally check **В список чтения**, then send or press Command/Ctrl+Enter.
4. The note is committed to the durable local outbox first. Adding to Reading List does not require the Doompile server; a Reading List error never discards the captured note.

The note stores the ordinary source URL. It is **not a deep link to an offline browser copy**. Open offline items from the browser's Reading List UI. Safari's automatic offline saving must be enabled separately; adding an item does not confirm that its resources were downloaded. Chromium Reading List is a read-later list and does not guarantee an offline copy.

Safari Mac uses the public `NSSharingService.addToSafariReadingList` service and waits for a delegate result (bounded to eight seconds). Safari iOS uses `SSReadingList.addItem`. Chromium uses `readingList.query/addEntry` and avoids duplicate URL entries. No private URL schemes, browser cache access or private APIs are used.

## UX and connection

Both the page annotation and toolbar popup use the shared chat composer. Compact mode exposes urgent, expand and send; the source stays highlighted without repeating the quote. Expanded mode embeds the same block editor and styles as the desktop/web apps: contextual formatting, slash commands, and a searchable tag picker instead of a comma-separated field. Only available capture actions are shown. Clickout/Escape resets the inline editor; Escape first closes an open tag picker. A bounded request plus an isolated-frame acknowledgement handles lost Safari replies. Retrying an unchanged draft retains its UUID and creation time to avoid duplicate notes. A small receipt links to the saved Doompile note and disappears after 2.2 seconds; Reading List failures have a warning.

The source card uses absolute coordinates anchored to the selection. Context-menu label is always **Сохранить в Doompile** for pages, selections, links, images and videos. Image capture stores its remote URL; it does not download an image file. Video timestamps come from the active accessible player or the URL; native YouTube share cannot expose a timestamp the source app did not provide.

Configure the HTTPS Doompile URL through the gear and sign in with Yandex/Google in the browser, or import the personal connection from the containing app. Manual configuration accepts a verified personal token; blank tokens never bypass authentication. Permission patterns omit ports; actual fetch URLs preserve them. The background owns credentials, rejects redirects and never sends its token to page scripts.

Captured documents contain one source block (quote plus a small source link), with no automatic page-title heading. Legacy duplicate prefixes are normalized once in the web and native editor; comments and attachments are preserved.

Queue entries are stored separately and removed only after an exact API acknowledgement. Legacy queues remain recoverable at storage quota. Retry/backoff, startup and a one-minute alarm drain pending notes. Do not clear extension storage to fix a pending queue.

No ENV variables are needed for the extension. No Docker/PDF service is required. Browser integration limits require user testing of the installed Safari extension; an Xcode build alone does not verify actual Reading List insertion.

Official APIs: [Apple Reading List](https://developer.apple.com/documentation/safariservices/ssreadinglist), [Mac sharing service](https://developer.apple.com/documentation/appkit/nssharingservice/name/addtosafarireadinglist), [Chromium Reading List](https://developer.chrome.com/docs/extensions/reference/api/readingList).

## Returning to an annotation

Source links in the desktop/web editor, feed, preview cards and native source controls are derived from the quote as browser Text Fragments (`#:~:text=...`). Clicking opens a new top-level browsing context with `noopener`; the browser scrolls to the match and highlights it without an injected content script or additional site permission. The stored source URL and Reading List URL stay unchanged. Existing notes gain these links at render time.

New captures preserve context from the actual selection range, including neighboring blocks for whole-paragraph selections. Prefix/suffix strings are kept as flat source-block attributes and in source metadata so repeated phrases can be distinguished after editing/sync. Long or multi-paragraph quotations use bounded, word-aligned start/end terms rather than a huge full-text URL; existing section hashes and YouTube timestamps are preserved.

This follows [Text Fragments](https://wicg.github.io/scroll-to-text-fragment/); Safari has [native scroll and persistent highlight support since 16.1](https://webkit.org/blog/13399/webkit-features-in-safari-16-1/). Exact recovery is not guaranteed when the required text/context has changed or disappeared, is inside an iframe, is inaccessible behind login/paywall, or is not loaded by the page. Sites may disable text directives. No fuzzy guess is reported as an exact match, and failure falls back to opening the source.

## iPhone annotation and fullscreen editor

Text selection opens the compact annotation at the far viewport edge. Image-only selection or a stationary long press on an image also starts capture; normal taps and scrolls keep their usual behavior. The native selection/image menus are not cancelled. Their actual geometry is unavailable to the page, so placement needs testing on a real device.

The toolbar popup adapts to Safari's sheet width. Expanding on iPhone transfers the draft to a fullscreen editor on the page; it preserves annotation text, flags, tags and Reading List choice. Fullscreen uses an opaque backdrop across the layout viewport and a usable editor frame inside the visual viewport above the keyboard. The whole empty writing surface accepts taps. Compact/full modes keep one live document and formatting.

Editor assets have content-hashed filenames and an explicit compatibility contract so a previously injected module cannot silently satisfy a newer composer's loader. After installing an extension update, reload already-open Safari tabs to update their selection observer and content scripts.

## Персональный вход

В настройках укажи адрес сервера и нажми «Войти через Яндекс / Google». Заверши вход и подтверди подключение в браузере, затем снова открой расширение. Можно взять персональное подключение из нативного приложения. Ручное поле принимает только персональный токен; прежний общий ключ и автоматический localhost bypass больше не работают. Каждая запись очереди привязана к исходному аккаунту и серверу. При смене аккаунта чужие очереди скрыты и не отправляются. Старые unowned-клипы сохраняются отдельно и не присваиваются следующему вошедшему пользователю. [Настройка сервера](../../docs/authentication.md).
