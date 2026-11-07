(function () {
  "use strict";
  if (
    !/iPhone|iPad|iPod/.test(navigator.userAgent) &&
    !(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
    return;
  globalThis.__doompileSelection?.dispose?.();
  const api = globalThis.browser || globalThis.chrome;
  let frozen,
    editing = false,
    pointerDown = false,
    timer,
    preparation,
    disposed = false,
    suppressed = "",
    ticket = 0,
    imagePress,
    imageTimer;
  const field = (node) =>
    (node?.nodeType === 3 ? node.parentElement : node)?.closest?.(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[data-doompile-clipper]',
    );
  const same = (a, b) => !!(a && b && a.quote === b.quote && (
    a.imageUrl
      ? a.imageUrl === b.imageUrl && a.node === b.node
      : b.range && a.range.startContainer === b.range.startContainer &&
        a.range.startOffset === b.range.startOffset &&
        a.range.endContainer === b.range.endContainer &&
        a.range.endOffset === b.range.endOffset
  ));
  function selected() {
    const selection = window.getSelection();
    if (
      !selection?.rangeCount ||
      selection.isCollapsed ||
      field(selection.anchorNode) ||
      field(selection.focusNode)
    )
      return null;
    const quote = selection.toString().slice(0, 50000);
    if (!quote.trim()) {
      const image = selection.getRangeAt(0).cloneContents().querySelector?.("img");
      const original = image && [...document.images].find(node => node.src === image.src);
      return original ? imageSelection(original) : null;
    }
    const range = selection.getRangeAt(0).cloneRange(),
      rect = range.getBoundingClientRect();
    return rect.width && rect.height ? { quote, range } : null;
  }
  function imageSelection(node) {
    const imageUrl = node?.currentSrc || node?.src;
    if (!imageUrl || !/^https?:/i.test(imageUrl) || field(node)) return null;
    return { quote: "", imageUrl, node };
  }
  const identity = next => next.imageUrl || next.quote;
  async function show(next, valid) {
    const revision = ++ticket;
    if (disposed || !next || identity(next) === suppressed || same(next, frozen)) return;
    try {
      await prepare();
      if (disposed || revision !== ticket || !valid()) return;
      const account=await globalThis.__doompileClipper.account?.();
      if (disposed || revision !== ticket || !valid()) return;
      globalThis.__doompileClipper.close?.();
      frozen = next;
      globalThis.__doompileClipper.dispatch({
        type: "doompile:open", account:account||null, auto: true, selectionText: next.quote,
        imageUrl: next.imageUrl, pageUrl: location.href,
        readingListAvailable: !!api.runtime.getManifest?.().permissions?.includes("nativeMessaging"),
      });
    } catch { /* Retry from Safari's action when website permission is missing. */ }
  }
  function prepare() {
    if (globalThis.__doompileClipper) return Promise.resolve();
    if (preparation) return preparation;
    preparation = new Promise((resolve, reject) => {
      const started = Date.now();
      let tick,
        done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(tick);
        error ? reject(error) : resolve();
      };
      const poll = () => {
        if (disposed) return finish(new Error("Closed"));
        if (globalThis.__doompileClipper) return finish();
        if (Date.now() - started >= 10000)
          return finish(new Error("Unavailable"));
        tick = setTimeout(poll, 40);
      };
      try {
        Promise.resolve(
          api.runtime.sendMessage({ type: "doompile:prepare-mobile" }),
        ).then(
          (result) => {
            if (result?.error) finish(new Error(result.error));
          },
          () => {},
        );
      } catch (error) {
        finish(error);
        return;
      }
      poll();
    }).finally(() => {
      preparation = null;
    });
    return preparation;
  }
  function update() {
    if (disposed || pointerDown || field(document.activeElement)) return;
    const next = selected();
    if (!next) { if (!editing) suppressed = ""; return; }
    void show(next, () => !pointerDown && same(next, selected()));
  }
  function changed() {
    clearTimeout(timer);
    ++ticket;
    if (field(document.activeElement)) return;
    if (!window.getSelection()?.toString().trim() && !editing) suppressed = "";
    timer = setTimeout(update, 320);
  }
  const down = (event) => {
    if (
      event
        .composedPath()
        .some((node) => node?.hasAttribute?.("data-doompile-clipper"))
    )
      return;
    clearTimeout(imageTimer);
    const image = event.target?.closest?.("img");
    imagePress = imageSelection(image);
    if (imagePress) {
      imagePress.x = event.clientX; imagePress.y = event.clientY;
      const press = imagePress;
      imageTimer = setTimeout(() => {
        press.activated = true;
        void show(press, () => imagePress === press && press.node.isConnected);
      }, 650);
    }
    pointerDown = true;
    if (!editing) suppressed = "";
    clearTimeout(timer);
    ++ticket;
  };
  const up = (event) => {
    pointerDown = false;
    // iOS sends pointercancel when its image callout takes over. Keep the
    // stationary long press; a real move or scroll cancels it separately.
    if (event.type !== "pointercancel" && !imagePress?.activated) cancelImage();
    if (!imagePress) changed();
  };
  const move = event => {
    if (imagePress && Math.hypot(event.clientX-imagePress.x,event.clientY-imagePress.y)>12) cancelImage();
  };
  function cancelImage() { clearTimeout(imageTimer); imagePress = null; }
  const context = event => {
    const next = imageSelection(event.target?.closest?.("img"));
    if (!next) return;
    clearTimeout(imageTimer);
    imagePress = next;
    next.activated = true;
    // Do not preventDefault: Safari keeps its image and link actions.
    void show(next, () => imagePress === next && next.node.isConnected);
  };
  const visibility = () => {
    if (document.hidden) {
      cancelImage();
      clearTimeout(timer);
      ++ticket;
    } else changed();
  };
  document.addEventListener("selectionchange", changed);
  document.addEventListener("pointermove", move, true);
  document.addEventListener("contextmenu", context, true);
  window.addEventListener("scroll", cancelImage, true);
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
  document.addEventListener("visibilitychange", visibility);
  globalThis.__doompileSelection = {
    capture: () => frozen,
    setEditing(value) {
      editing = value;
      if (!value) {
        suppressed = frozen ? identity(frozen) : "";
        frozen = null;
      }
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      cancelImage();
      ++ticket;
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("contextmenu", context, true);
      window.removeEventListener("scroll", cancelImage, true);
      document.removeEventListener("selectionchange", changed);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
  changed();
})();
