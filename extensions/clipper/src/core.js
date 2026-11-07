(function (root) {
  "use strict";
  const limits = root.DoompileContracts.limits;
  const HTTP_LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
  function endpoint(value) {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" && HTTP_LOCAL.has(url.hostname))
      )
    ) {
      throw new Error(
        "Укажи HTTPS-адрес хранилища или HTTP на localhost для разработки.",
      );
    }
    return url.href.replace(/\/+$/, "");
  }
  function permissionPattern(value) {
    const url = new URL(endpoint(value));
    // WebExtension host match patterns must not contain an explicit port.
    return `${url.protocol}//${url.hostname}/*`;
  }
  function isLocalEndpoint(value) {
    try {
      return HTTP_LOCAL.has(new URL(endpoint(value)).hostname);
    } catch {
      return false;
    }
  }
  function timecode(value) {
    const text = String(value ?? "").trim();
    const bounded = (seconds) =>
      Number.isFinite(seconds) && seconds >= 0 && seconds <= 31536000
        ? Math.floor(seconds)
        : null;
    if (!text) return null;
    if (/^\d+(?:\.\d+)?$/.test(text)) return bounded(Number(text));
    if (/^\d+:\d{1,2}(?::\d{1,2})?$/.test(text)) {
      const parts = text.split(":").map(Number);
      if (parts.slice(1).some((n) => n >= 60)) return null;
      return bounded(parts.reduce((total, n) => total * 60 + n, 0));
    }
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i.exec(text);
    return match && match[0]
      ? bounded(
          Number(match[1] || 0) * 3600 +
            Number(match[2] || 0) * 60 +
            Number(match[3] || 0),
        )
      : null;
  }
  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(value));
    const minutes = Math.floor(seconds / 60);
    return minutes >= 60
      ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
      : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function timestampFromURL(value) {
    try {
      const url = new URL(value);
      return timecode(
        url.searchParams.get("t") ||
          url.searchParams.get("start") ||
          url.hash.replace(/^#t=/, ""),
      );
    } catch {
      return null;
    }
  }
  function sourceURL(value, seconds) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error(
        "Эту страницу нельзя сохранить через расширение. Открой обычную веб-страницу.",
      );
    if (
      seconds !== null &&
      seconds !== undefined &&
      /(^|\.)(youtube\.com|youtu\.be)$/.test(url.hostname)
    )
      url.searchParams.set("t", String(seconds));
    return url.href;
  }
  function captureDocument(capture) {
    const imageUrl = capture.imageUrl ? sourceURL(capture.imageUrl) : undefined;
    const quote = String(capture.quote || "").slice(0, 50000),
      comment = String(capture.comment || "")
        .trim()
        .slice(0, 100000);
    const title = String(capture.noteTitle || capture.title || "")
      .trim()
      .slice(0, limits.generatedTitle).replace(/[\uD800-\uDBFF]$/, "");
    const timestampSeconds =
      capture.timestampSeconds == null
        ? undefined
        : timecode(capture.timestampSeconds);
    const url =
      capture.noteOnly || !capture.url
        ? undefined
        : sourceURL(capture.url, timestampSeconds);
    const annotationBody = capture.annotationBody;
    const content = [];
    if (imageUrl)
      content.push({ type: "image", attrs: { src: imageUrl, alt: title } });
    if (annotationBody) content.push(...annotationBody.content);
    else if (comment)
      content.push(
        ...comment
          .split("\n")
          .map((text) => ({
            type: "paragraph",
            ...(text ? { content: [{ type: "text", text }] } : {}),
          })),
      );
    if (!content.length) content.push({ type: "paragraph" });
    const source = { url, title: String(capture.title || title).slice(0, limits.generatedTitle).replace(/[\uD800-\uDBFF]$/, "") };
    if (quote) source.quote = quote;
    if (timestampSeconds !== undefined)
      source.timestampSeconds = timestampSeconds;
    if (capture.selector && quote)
      source.selector = {
        type: "TextQuoteSelector",
        exact: quote,
        prefix: String(capture.selector.prefix || "").slice(-100),
        suffix: String(capture.selector.suffix || "").slice(0, 100),
      };
    if (url)
      content.unshift({
        type: "sourceSnippet",
        attrs: {
          url,
          title: source.title,
          ...(quote ? { quote } : {}),
          ...(source.selector
            ? {
                quotePrefix: source.selector.prefix,
                quoteSuffix: source.selector.suffix,
              }
            : {}),
          ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
        },
      });
    if (capture.noteTitle?.trim())
      content.unshift({
        type: "heading",
        attrs: { level: 1 },
        content: [
          {
            type: "text",
            text: String(capture.noteTitle).trim().slice(0, limits.generatedTitle).replace(/[\uD800-\uDBFF]$/, ""),
          },
        ],
      });
    return {
      type: "doc",
      attrs: { editorVersion: 1, captureVersion: 2 },
      content,
    };
  }
  function makeNote(capture, now, id) {
    const imageUrl = capture.imageUrl ? sourceURL(capture.imageUrl) : undefined;
    const quote = String(capture.quote || "").slice(0, 50000);
    const comment = String(capture.comment || "")
      .trim()
      .slice(0, 100000);
    const title = String(
      capture.noteTitle ||
        capture.title ||
        (capture.noteOnly ? comment.split("\n")[0] : "Сохранённая страница"),
    )
      .trim()
      .slice(0, limits.generatedTitle).replace(/[\uD800-\uDBFF]$/, "");
    const timestampSeconds =
      capture.timestampSeconds == null
        ? undefined
        : timecode(capture.timestampSeconds);
    if (capture.timestampSeconds != null && timestampSeconds === null)
      throw new Error("Введи таймкод в формате 2:34.");
    const url = capture.noteOnly
      ? undefined
      : sourceURL(capture.url, timestampSeconds);
    if (capture.noteOnly && !comment) throw new Error("Напиши заметку.");
    let annotationBody;
    if (capture.annotationBody) {
      const encoded = JSON.stringify(capture.annotationBody);
      if (
        encoded.length > 500000 ||
        capture.annotationBody.type !== "doc" ||
        !Array.isArray(capture.annotationBody.content)
      )
        throw new Error("Не удалось сохранить форматирование заметки.");
      annotationBody = JSON.parse(encoded);
    }
    let body;
    if (capture.document) {
      const encoded = JSON.stringify(capture.document);
      if (
        encoded.length > 500000 ||
        capture.document.type !== "doc" ||
        !Array.isArray(capture.document.content)
      )
        throw new Error("Не удалось сохранить документ заметки.");
      body = JSON.parse(encoded);
    } else body = captureDocument({ ...capture, annotationBody });
    const copiedMedia = new Map();
    const collectMedia = node => {
      const attrs = node.attrs || {}, mediaURL = node.type === 'image' ? attrs.src : node.type === 'attachment' ? attrs.url : '';
      const mediaID = attrs.id || (typeof mediaURL === 'string' && /\/api\/attachments\/([\da-f-]{36})$/i.exec(mediaURL)?.[1]);
      if (mediaID && typeof mediaURL === 'string' && (/^\/api\/attachments\//.test(mediaURL) || /^https?:\/\//.test(mediaURL))) copiedMedia.set(mediaID, { id: mediaID, url: mediaURL, name: attrs.name || attrs.alt || 'Вложение', mimeType: attrs.mimeType || (node.type === 'image' ? 'image/png' : 'application/octet-stream'), size: Number(attrs.size) || 0 });
      node.content?.forEach(collectMedia);
    };
    collectMedia(body);
    const source = { url, title: String(capture.title || title).slice(0, limits.generatedTitle).replace(/[\uD800-\uDBFF]$/, "") };
    if (quote) source.quote = quote;
    if (timestampSeconds !== undefined)
      source.timestampSeconds = timestampSeconds;
    if (capture.selector && quote)
      source.selector = {
        type: "TextQuoteSelector",
        exact: quote,
        prefix: String(capture.selector.prefix || "").slice(-100),
        suffix: String(capture.selector.suffix || "").slice(0, 100),
      };
    return {
      id,
      title,
      body,
      plainText: [quote, comment].filter(Boolean).join("\n\n") || title,
      tags: [
        ...new Set(
          String(capture.tags || "")
            .split(",")
            .map((x) => x.trim().replace(/^#/, "").slice(0, limits.tagLength))
            .filter(Boolean),
        ),
      ].slice(0, limits.tags),
      pinned: capture.pinned === true,
      urgent: capture.urgent === true,
      kind: capture.noteOnly
        ? "note"
        : imageUrl
          ? "image"
          : capture.video
            ? "video"
            : "article",
      ...(capture.noteOnly ? {} : { source }),
      attachments: [...copiedMedia.values()].slice(0, limits.attachments),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      revision: 0,
    };
  }
  function retryDelay(attempts) {
    return Math.min(60 * 60 * 1000, 15000 * 2 ** Math.min(attempts, 8));
  }
  function sameCapture(a, b) {
    return (
      !!a &&
      !!b &&
      a.id === b.id &&
      a.createdAt === b.createdAt &&
      a.source?.url === b.source?.url &&
      a.plainText === b.plainText &&
      JSON.stringify(a.body) === JSON.stringify(b.body)
    );
  }
  root.DoompileCore = {
    endpoint,
    permissionPattern,
    isLocalEndpoint,
    timecode,
    formatTime,
    timestampFromURL,
    sourceURL,
    captureDocument,
    makeNote,
    retryDelay,
    sameCapture,
  };
})(globalThis);
