(function () {
  "use strict";
  // UIKit can put its menu on either side and exposes no DOM rectangle.
  // Keep the composer at the far viewport edge, reserving both sides of the
  // selected range rather than guessing where UIKit will place its menu.
  function mobile({ view, selection, height, expanded, typing = false }) {
    if (expanded) return { left: view.left, top: view.top,
      width: view.width, height: view.height, menuSide: null };
    const pad = 12, h = Math.min(height, view.height - pad * 2);
    const upper = view.top + pad, lower = view.top + view.height - h - pad;
    let top = lower;
    if (selection && !typing) {
      const above = selection.top - (upper + h);
      const below = lower - selection.bottom;
      top = above > below ? upper : lower;
    }
    return { left: view.left + pad, top,
      width: Math.max(0, view.width - pad * 2), height: null,
      menuSide: selection && !typing ? "both" : null };
  }
  globalThis.DoompileLayout = { mobile };
})();
