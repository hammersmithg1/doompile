(function () {
  "use strict";
  globalThis.DoompileDiagnostics?.install();
  // Rebind after extension reload: a stale isolated-world flag may outlive its listener.
  globalThis.__doompileClipper?.dispose?.();
  const api = globalThis.browser || globalThis.chrome;
  const core = globalThis.DoompileCore;
  const transport = globalThis.DoompileTransport?.create(api);
  const mobile =
    /iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent || "") ||
    (globalThis.navigator?.platform === "MacIntel" &&
      globalThis.navigator?.maxTouchPoints > 1);
  let receiptHost, receiptTimer;
  let host;
  let closeCurrent;
  function rangeContext(range, quote) {
    const block = (node) =>
      (node.nodeType === 3 ? node.parentElement : node)?.closest(
        "p,li,td,th,blockquote,pre,h1,h2,h3,h4,h5,h6,article,main,section,div,body",
      ) || document.body;
    function neighbor(element, before) {
      for (
        let depth = 0;
        element && element !== document.body && depth < 10;
        depth++, element = element.parentElement
      ) {
        let sibling = before
          ? element.previousElementSibling
          : element.nextElementSibling;
        for (
          let count = 0;
          sibling && count < 12;
          count++,
            sibling = before
              ? sibling.previousElementSibling
              : sibling.nextElementSibling
        ) {
          if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(sibling.tagName))
            continue;
          const text = sibling.innerText?.trim();
          if (text) return text;
        }
      }
      return "";
    }
    try {
      const start = block(range.startContainer),
        end = block(range.endContainer);
      const before = range.cloneRange();
      before.selectNodeContents(start);
      before.setEnd(range.startContainer, range.startOffset);
      const after = range.cloneRange();
      after.selectNodeContents(end);
      after.setStart(range.endContainer, range.endOffset);
      const prefix = before.toString(),
        suffix = after.toString();
      return {
        type: "TextQuoteSelector",
        exact: quote,
        prefix: (prefix.trim() ? prefix : neighbor(start, true)).slice(-100),
        suffix: (suffix.trim() ? suffix : neighbor(end, false)).slice(0, 100),
      };
    } catch {
      return {
        type: "TextQuoteSelector",
        exact: quote,
        prefix: "",
        suffix: "",
      };
    }
  }
  function inspect(selectionText) {
    const selection = window.getSelection();
    const frozen = globalThis.__doompileSelection?.capture?.();
    const quote = (
      frozen?.quote ||
      selection?.toString() ||
      selectionText ||
      ""
    ).slice(0, 50000);
    let selector;
    let rect;
    if (quote && (frozen?.range || selection?.rangeCount)) {
      const range = frozen?.range || selection.getRangeAt(0);
      rect = range.getBoundingClientRect();
      selector = rangeContext(range, quote);
    }
    const video = document.querySelector("video");
    const bounds = video?.getBoundingClientRect();
    const isVideo =
      !quote &&
      (/^(www\.|m\.)?(youtube\.com|youtu\.be)$/.test(location.hostname) ||
        !!(
          bounds &&
          bounds.width >= 320 &&
          bounds.height >= 180 &&
          bounds.top < innerHeight &&
          video.duration > 0
        ));
    return {
      url: location.href,
      title: document.title,
      quote,
      selector,
      video: isVideo,
      timestampSeconds: isVideo
        ? video && Number.isFinite(video.currentTime)
          ? Math.floor(video.currentTime)
          : core.timestampFromURL(location.href)
        : null,
      rect: rect
        ? { top: rect.top, bottom: rect.bottom, left: rect.left }
        : null,
    };
  }
  function el(tag, attrs = {}, text) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs))
      element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  let currentAccountScope = null;
  function open(
    selectionText,
    imageUrl,
    pageUrl,
    linkUrl,
    linkText,
    readingListAvailable,
    auto = false,
    initialDraft,
    expandEditor = false,
    accountScope = currentAccountScope,
  ) {
    const capture = imageUrl
      ? {
          ...inspect(),
          url: pageUrl || location.href,
          quote: "",
          selector: undefined,
          rect: null,
          video: false,
          timestampSeconds: null,
          imageUrl,
        }
      : inspect(selectionText);
    if (linkUrl && !imageUrl) {
      capture.url = core.sourceURL(linkUrl);
      capture.title = linkText || linkUrl;
      capture.linkUrl = linkUrl;
      capture.quote = "";
      capture.selector = undefined;
      capture.rect = null;
      capture.video = false;
      capture.timestampSeconds = null;
    }
    capture.readingListAvailable = !!readingListAvailable;
    const frozen = globalThis.__doompileSelection?.capture?.();
    closeCurrent?.();
    globalThis.__doompileSelection?.setEditing(true);
    const selected = window.getSelection();
    const range =
      frozen?.range?.cloneRange() ||
      (capture.quote &&
      selected?.rangeCount &&
      selected.toString() === capture.quote
        ? selected.getRangeAt(0).cloneRange()
        : null);
    let highlighted = false;
    let highlightStyle;
    const highlightName = "doompile-selection";
    if (
      range &&
      globalThis.CSS?.highlights &&
      typeof Highlight !== "undefined"
    ) {
      CSS.highlights.set(highlightName, new Highlight(range));
      highlightStyle = el("style");
      highlightStyle.textContent =
        "::highlight(doompile-selection){background:#c6ff0066;color:inherit;}";
      document.documentElement.append(highlightStyle);
      highlighted = true;
    }
    let anchor = range;
    if (!anchor && (imageUrl || linkUrl)) {
      anchor = [
        ...document.querySelectorAll(imageUrl ? "img" : "a[href]"),
      ].find(
        (node) =>
          (imageUrl ? node.currentSrc || node.src : node.href) ===
            (imageUrl || linkUrl) && node.getBoundingClientRect().bottom > 0,
      );
    }
    const previousFocus = document.activeElement;
    host = el("div", {
      "data-doompile-clipper": "",
      style: `all:initial!important;position:${mobile ? "fixed" : "absolute"}!important;top:0!important;left:0!important;width:0!important;height:0!important;overflow:visible!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;`,
    });
    const instance = host;
    const root = host.attachShadow({ mode: "closed" });
    const style = el("style");
    style.textContent =
      (globalThis.DoompileComposerCSS || "") +
      `.anchor-card{position:absolute;width:520px;max-width:calc(100vw - 24px);pointer-events:auto;max-height:calc(100dvh - 24px)}.anchor-card.expanded{width:640px}.selection-mark{position:absolute;background:#c6ff0040;pointer-events:none;border-radius:2px}`;
    root.append(style);
    const card = el("section", {
      class: "anchor-card" + (mobile ? " mobile-card" : ""),
      role: "dialog",
      "aria-modal": "false",
      "aria-label": "Сохранить в Doompile",
    });
    const backdrop = el("div", { class: "mobile-backdrop", hidden: "" });
    root.append(backdrop, card);
    document.documentElement.append(host);
    const marks = [];
    let controller,
      closed = false,
      lastSubmission;
    let observer,
      locked = false,
      restoreScroll;
    const unlock = () => {
      restoreScroll?.();
      restoreScroll = null;
      locked = false;
    };
    function modalLock(value) {
      card.setAttribute("aria-modal", String(value));
      backdrop.hidden = !value;
      if (value && !locked) {
        locked = true;
        const nodes = [document.documentElement, document.body].filter(Boolean),
          previous = nodes.map((node) => [
            node,
            node.style.getPropertyValue("overflow"),
            node.style.getPropertyPriority("overflow"),
            node.style.getPropertyValue("overscroll-behavior"),
            node.style.getPropertyPriority("overscroll-behavior"),
          ]);
        const inert = document.body?.inert;
        for (const node of nodes) {
          node.style.setProperty("overflow", "hidden", "important");
          node.style.setProperty("overscroll-behavior", "none", "important");
        }
        if (document.body) document.body.inert = true;
        restoreScroll = () => {
          for (const [
            node,
            overflow,
            priority,
            overscroll,
            opriority,
          ] of previous) {
            if (overflow)
              node.style.setProperty("overflow", overflow, priority);
            else node.style.removeProperty("overflow");
            if (overscroll)
              node.style.setProperty(
                "overscroll-behavior",
                overscroll,
                opriority,
              );
            else node.style.removeProperty("overscroll-behavior");
          }
          if (document.body) document.body.inert = inert;
        };
      } else if (!value && locked) unlock();
    }
    function position(expanded = controller?.expanded || false) {
      card.classList.toggle("expanded", expanded === true);
      const rect = anchor?.getBoundingClientRect() || capture.rect;
      if (mobile) {
        const viewport = window.visualViewport,
          view = {
            left: viewport?.offsetLeft || 0,
            top: viewport?.offsetTop || 0,
            width: viewport?.width || innerWidth,
            height: viewport?.height || innerHeight,
          };
        const active = root.activeElement,
          typing = !!active;
        const box = DoompileLayout.mobile({
          view,
          selection: rect,
          height: card.offsetHeight || 112,
          expanded,
          typing,
        });
        card.style.position = "fixed";
        card.style.left = box.left + "px";
        card.style.top = box.top + "px";
        card.style.width = box.width + "px";
        card.style.maxWidth = "none";
        card.style.maxHeight =
          Math.max(0, view.height - (expanded ? 0 : 24)) + "px";
        card.style.height = expanded ? box.height + "px" : "";
        card.dataset.menuSide = box.menuSide || "";
        modalLock(expanded);
      } else {
        card.style.top = `${(rect?.bottom ?? 40) + window.scrollY + 8}px`;
        card.style.left = `${Math.min(Math.max(12, rect?.left ?? innerWidth - card.offsetWidth - 24), Math.max(12, innerWidth - card.offsetWidth - 12)) + window.scrollX}px`;
        card.style.maxHeight = `${Math.max(280, innerHeight - (rect?.bottom ?? 40) - 20)}px`;
      }
      for (const mark of marks) mark.remove();
      marks.length = 0;
      if (range && !highlighted)
        for (const r of range.getClientRects()) {
          const mark = el("span", { class: "selection-mark" });
          mark.style.cssText = `left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;width:${r.width}px;height:${r.height}px`;
          root.append(mark);
          marks.push(mark);
        }
    }
    function dismiss(restoreFocus = true) {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("blur", blur);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
      observer?.disconnect();
      unlock();
      globalThis.__doompileSelection?.setEditing(false);
      if (highlighted) CSS.highlights.delete(highlightName);
      highlightStyle?.remove();
      controller?.destroy();
      instance.remove();
      if (host === instance) {
        host = null;
        closeCurrent = null;
      }
      if (restoreFocus && previousFocus instanceof HTMLElement)
        previousFocus.focus({ preventScroll: true });
    }
    closeCurrent = dismiss;
    const outside = (event) => {
      if (!event.composedPath().includes(instance)) dismiss(false);
    };
    const blur = () => dismiss(false),
      visibility = () => {
        if (document.hidden) dismiss(false);
      },
      reposition = () => position();
    function keyboard(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismiss();
      }
    }
    let editorLoading;
    function loadRich() {
      const compatible = () => globalThis.DoompileRichEditor?.version === 2 &&
        (!globalThis.DoompileEditorBuild || globalThis.DoompileRichEditor.build === globalThis.DoompileEditorBuild.hash);
      if (compatible()) return Promise.resolve();
      if (!editorLoading)
        editorLoading = (async () => {
          if (compatible()) return;
          let timer;
          const ready = new Promise((resolve) => {
            const check = () => {
              if (compatible()) resolve();
              else timer = setTimeout(check, 40);
            };
            check();
          });
          const requested = transport
            .request({ type: "doompile:load-editor" })
            .then((result) => {
              if (!result?.ok || !compatible())
                throw new Error(
                  result?.error || "Не удалось загрузить редактор.",
                );
            });
          try {
            await Promise.race([ready, requested]);
          } finally {
            clearTimeout(timer);
          }
        })().catch((error) => {
          editorLoading = null;
          throw error;
        });
      return editorLoading;
    }
    if (mobile) position();
    controller = DoompileComposer.mount({
      root: card,
      context: capture,
      autofocus: !auto,
      initialDraft,
      onLayout: position,
      loadTags: async () => {
        const result = await transport.request({ type: "doompile:tags", account: accountScope });
        return result.tags || [];
      },
      loadEditor: loadRich,
      onSubmit: async (values) => {
        const { readingList, ...annotation } = values;
        const payload = {
          capture: { ...capture, rect: undefined, ...annotation },
          readingList,
        };
        const signature = JSON.stringify(payload);
        if (lastSubmission?.signature !== signature)
          lastSubmission = {
            signature,
            captureId: crypto.randomUUID(),
            captureAt: new Date().toISOString(),
          };
        const result = await transport.request(
          {
            type: "doompile:capture",
            account: accountScope,
            ...payload,
            captureId: lastSubmission.captureId,
            captureAt: lastSubmission.captureAt,
          },
          15000,
        );
        if (!result?.ok)
          throw new Error(result?.error || "Не удалось сохранить.");
        dismiss();
        if (mobile) showMobileReceipt(result.id);
        else
          void api.runtime
            .sendMessage({ type: "doompile:show-delivery", id: result.id })
            .catch(() => {});
      },
    });
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(reposition);
      observer.observe(card);
    }
    position();
    if (expandEditor) void controller.expand();
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("blur", blur);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("keydown", keyboard);
    root.addEventListener("focusin", (event) => {
      reposition();
      if (
        mobile &&
        event
          .composedPath()
          .some((node) => node?.classList?.contains("dp-comment"))
      )
        void loadRich().catch(() => {});
    });
    root.addEventListener("focusout", () => requestAnimationFrame(reposition));
    requestAnimationFrame(() => {
      if (!closed && !auto) controller.focus();
    });
    return { ok: true };
  }
  function showMobileReceipt(id) {
    receiptHost?.remove();
    clearTimeout(receiptTimer);
    const instance = el("div", {
      "data-doompile-receipt": "",
      style:
        "all:initial!important;position:absolute!important;z-index:2147483647!important;display:block!important;",
    });
    receiptHost = instance;
    const root = instance.attachShadow({ mode: "closed" }),
      style = el("style");
    style.textContent = globalThis.DoompileComposerCSS + "\n" +
      ".receipt{display:flex;align-items:center;gap:10px;box-sizing:border-box;max-width:calc(100vw - 24px);padding:10px 14px;border:1px solid var(--line);border-radius:14px;background:var(--bg);color:var(--text);box-shadow:0 5px 22px #0002;font:500 13px/20px -apple-system,BlinkMacSystemFont,sans-serif}.mark{color:var(--snippet-accent)}a{color:var(--snippet-accent);text-decoration:none;white-space:nowrap;padding:2px 0}a[hidden]{display:none}@media(prefers-color-scheme:dark){.receipt{background:var(--surface);color:var(--text);border-color:var(--line)}.mark,a{color:var(--snippet-accent)}}";
    const row = el("div", {
        class: "receipt",
        role: "status",
        "aria-live": "polite",
      }),
      text = el("span", {}, "Сохранено"),
      link = el(
        "a",
        { target: "_blank", rel: "noopener noreferrer", hidden: "" },
        "Открыть ↗",
      );
    const mark = el("span", { class: "mark", "aria-hidden": "true" });
    const glyph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": String(DoompileDesign.strokeWidth), "stroke-linecap": "round", "stroke-linejoin": "round" })) glyph.setAttribute(key, value);
    for (const [tag, attrs] of DoompileDesign.icons.check) { const node = document.createElementNS(glyph.namespaceURI, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); glyph.append(node); }
    mark.append(glyph);
    row.append(
      mark,
      text,
      link,
    );
    root.append(style, row);
    document.documentElement.append(instance);
    instance.style.setProperty(
      "left",
      `${window.scrollX + (window.visualViewport?.offsetLeft || 0) + 12}px`,
      "important",
    );
    instance.style.setProperty(
      "top",
      `${window.scrollY + (window.visualViewport?.offsetTop || 0) + 12}px`,
      "important",
    );
    receiptTimer = setTimeout(() => {
      instance.remove();
      if (receiptHost === instance) receiptHost = null;
    }, 2200);
    void transport
      .request({ type: "doompile:receipt", id }, 14000)
      .then((result) => {
        if (receiptHost !== instance) return;
        text.textContent = result.uploaded
          ? "Отправлено"
          : "Сохранено · в очереди";
        if (result.warning) {
          text.textContent = "Сохранено · список чтения недоступен";
          text.title = result.warning;
        }
        if (result.noteURL && /^https?:\/\//.test(result.noteURL)) {
          link.href = result.noteURL;
          link.hidden = false;
        }
      })
      .catch(() => {});
  }
  // This bridge lives in the extension's isolated world, never in the page's world.
  function dispatch(message) {
    if (Object.hasOwn(message, "account")) currentAccountScope = message.account;
    if (message?.type === "doompile:ready") return { ok: true };
    if (message?.type === "doompile:inspect")
      return {
        ...inspect(message.selectionText),
        account: currentAccountScope,
        readingListAvailable: !!message.readingListAvailable,
      };
    if (message?.type === "doompile:open")
      return open(
        message.selectionText,
        message.imageUrl,
        message.pageUrl,
        message.linkUrl,
        message.linkText,
        message.readingListAvailable,
        message.auto,
        message.initialDraft,
        message.expandEditor,
        currentAccountScope,
      );
    throw new Error("Неподдерживаемое действие страницы.");
  }
  const listener = (message, sender, reply) => {
    if (sender.id && sender.id !== api.runtime.id) return;
    if (!["doompile:inspect", "doompile:open"].includes(message?.type)) return;
    try {
      const result = dispatch(message);
      if (result?.then) {
        result.then(reply, (error) =>
          reply({ error: String(error.message || error) }),
        );
        return true;
      }
      reply(result);
    } catch (error) {
      reply({ error: String(error.message || error) });
    }
  };
  api.runtime.onMessage.addListener(listener);
  globalThis.__doompileClipper = {
    dispatch,
    account: async () => (await transport.request({ type: "doompile:account" }))?.account || null,
    close: () => closeCurrent?.(false),
    settle: (id, result) => transport?.settle(id, result),
    dispose() {
      receiptHost?.remove();
      clearTimeout(receiptTimer);
      transport?.destroy();
      closeCurrent?.();
      try {
        api.runtime.onMessage.removeListener?.(listener);
      } catch {}
    },
  };
})();
