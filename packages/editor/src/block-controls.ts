import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { moveBlock } from "./blocks";
import { copySelection } from "./clipboard";

export function copyText(value: string, root: HTMLElement, editor: Editor) {
  const input = document.createElement("textarea");
  input.value = value;
  input.style.cssText = "position:fixed;opacity:0;left:-9999px";
  root.append(input);
  input.oncopy = (event) => {
    event.clipboardData?.setData("text/plain", value);
    event.preventDefault();
  };
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  editor.view.focus();
  return copied;
}

export function createBlockControls(
  root: HTMLElement,
  editor: Editor,
  handle: HTMLButtonElement,
  noteURL: () => string | undefined,
  onColor: () => void,
) {
  const menu = document.createElement("div");
  menu.className = "block-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Действия с блоком");
  menu.hidden = true;
  const indicator = document.createElement("div");
  indicator.className = "block-drop-indicator";
  indicator.hidden = true;
  root.append(menu, indicator);
  let hovered: HTMLElement | null = null,
    source: number | null = null,
    destination: number | null = null,
    origin: { x: number; y: number } | null = null,
    moved = false,
    suppressClick = false;
  let scrollFrame = 0,
    clientY = 0,
    clientX = 0;
  function blockAt(target: EventTarget | null): HTMLElement | null {
    let element = target instanceof HTMLElement ? target : null;
    if (!element || !editor.view.dom.contains(element)) return null;
    while (
      element &&
      element.parentElement !== editor.view.dom &&
      !element.parentElement?.matches("li,li > div,ul,ol")
    )
      element = element.parentElement;
    if (element?.matches("p") && element.closest("li"))
      return element.closest("li");
    return element === editor.view.dom ? null : element;
  }
  function position(element: HTMLElement) {
    const inside = editor.view.posAtDOM(element, 0);
    return Math.max(
      0,
      element.matches("p,h1,h2,h3,li,blockquote,pre,td,th")
        ? inside - 1
        : inside,
    );
  }
  function showHandle(element: HTMLElement) {
    hovered = element;
    const rect = element.getBoundingClientRect(),
      outer = root.getBoundingClientRect();
    handle.hidden = !editor.isEditable;
    handle.style.top = `${rect.top - outer.top}px`;
    handle.style.left = `${Math.max(0, rect.left - outer.left - 28)}px`;
  }
  function selectBlock() {
    if (!hovered?.isConnected) return false;
    editor.commands.setNodeSelection(position(hovered));
    editor.view.focus();
    return true;
  }
  function close() {
    menu.hidden = true;
    handle.setAttribute("aria-expanded", "false");
  }
  function menuItem(label: string, run: () => void | boolean) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("role", "menuitem");
    button.onmousedown = (e) => e.preventDefault();
    button.onclick = () => {
      if (run() !== true) close();
    };
    menu.append(button);
  }
  function move(direction: number) {
    const selection = editor.state.selection,
      node = editor.state.doc.nodeAt(selection.from);
    if (!node) return;
    const $pos = selection.$from,
      index = $pos.index();
    const target =
      direction < 0 && index > 0
        ? selection.from - $pos.parent.child(index - 1).nodeSize
        : direction > 0 && index + 1 < $pos.parent.childCount
          ? selection.to + $pos.parent.child(index + 1).nodeSize
          : null;
    if (target !== null) moveBlock(editor, selection.from, target);
  }
  function open(x: number, y: number) {
    if (!editor.isEditable || !selectBlock()) return;
    menu.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = "Блок";
    menu.append(title);
    menuItem("Цвет текста и выделения", () => {
      onColor();
    });
    menuItem("Сбросить форматирование", () => {
      editor.chain().focus().unsetAllMarks().run();
    });
    menuItem("Дублировать блок", () => {
      const selection = editor.state.selection,
        node = editor.state.doc.nodeAt(selection.from);
      if (!node) return;
      const json = node.toJSON();
      const clear = (value: typeof json) => {
        if (value.attrs) delete value.attrs.blockId;
        value.content?.forEach(clear);
      };
      clear(json);
      const duplicate = editor.schema.nodeFromJSON(json);
      const tr = editor.state.tr.insert(selection.to, duplicate);
      tr.setSelection(NodeSelection.create(tr.doc, selection.to));
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
    });
    menuItem("Копировать блок", () => {
      copySelection(editor);
    });
    menuItem("Вырезать блок", () => {
      copySelection(editor, true);
    });
    if (noteURL())
      menuItem("Скопировать ссылку на блок", () => {
        const pos = editor.state.selection.from,
          node = editor.state.doc.nodeAt(pos);
        if (!node) return;
        const id = node.attrs.blockId || crypto.randomUUID();
        if (!node.attrs.blockId)
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              blockId: id,
            }),
          );
        copyText(`${noteURL()!.split("#")[0]}#block-${id}`, root, editor);
      });
    menuItem("Переместить выше", () => move(-1));
    menuItem("Переместить ниже", () => move(1));
    menuItem("Удалить блок", () => {
      editor.chain().focus().deleteSelection().run();
    });
    menu.hidden = false;
    handle.setAttribute("aria-expanded", "true");
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  }
  const pointer = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      if (!origin && menu.hidden) handle.hidden = true;
      return;
    }
    if (!origin) {
      const block = blockAt(event.target);
      if (block) showHandle(block);
    }
  };
  const leave = () => {
    if (!origin && menu.hidden) handle.hidden = true;
  };
  const outside = (event: PointerEvent) => {
    if (
      !event.composedPath().includes(menu) &&
      !event.composedPath().includes(handle)
    )
      close();
  };
  const context = (event: MouseEvent) => {
    const block = blockAt(event.target);
    if (!block) return;
    event.preventDefault();
    event.stopPropagation();
    showHandle(block);
    open(event.clientX, event.clientY);
  };
  const escape = (event: KeyboardEvent) => {
    if (!menu.hidden && event.key === "Escape") {
      close();
      event.preventDefault();
      event.stopPropagation();
      editor.view.focus();
    }
  };
  function scrollContainer(): HTMLElement | null {
    for (
      let element = root.parentElement;
      element && element !== document.body;
      element = element.parentElement
    )
      if (
        /auto|scroll/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight
      )
        return element;
    return null;
  }
  function autoScroll() {
    if (!origin || !moved) return;
    const scroller = scrollContainer(),
      bounds = scroller?.getBoundingClientRect() || {
        top: 0,
        bottom: innerHeight,
      };
    const delta =
      clientY < bounds.top + 32 ? -12 : clientY > bounds.bottom - 32 ? 12 : 0;
    if (delta) {
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy(0, delta);
      updateDestination(clientX, clientY);
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }
  const drag = (event: PointerEvent) => {
    if (!origin || source === null) return;
    clientY = event.clientY;
    clientX = event.clientX;
    if (
      !moved &&
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5
    )
      return;
    if (!moved) {
      moved = true;
      root.classList.add("block-dragging");
      hovered?.classList.add("block-moving");
      autoScroll();
    }
    event.preventDefault();
    updateDestination(event.clientX, event.clientY);
  };
  function updateDestination(x: number, y: number) {
    if (source === null) return;
    const tree = root.getRootNode() as Document | ShadowRoot;
    const hit = tree.elementFromPoint(x, y);
    let target = blockAt(hit);
    if (!target) {
      const candidates = Array.from(editor.view.dom.children).filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      );
      target =
        candidates.sort(
          (a, b) =>
            Math.abs(a.getBoundingClientRect().top - y) -
            Math.abs(b.getBoundingClientRect().top - y),
        )[0] || null;
    }
    if (!target) return;
    const rect = target.getBoundingClientRect(),
      pos = position(target),
      node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const after = y > rect.top + rect.height / 2;
    destination = pos + (after ? node.nodeSize : 0);
    const from = editor.state.doc.resolve(source),
      to = editor.state.doc.resolve(destination),
      original = editor.state.doc.nodeAt(source);
    if (
      !original ||
      !to.parent.canReplaceWith(to.index(), to.index(), original.type) ||
      (destination >= source && destination <= source + original.nodeSize)
    ) {
      indicator.hidden = true;
      destination = null;
      return;
    }
    indicator.hidden = false;
    indicator.style.left = `${rect.left}px`;
    indicator.style.top = `${after ? rect.bottom : rect.top}px`;
    indicator.style.width = `${rect.width}px`;
  }
  const drop = (event: PointerEvent) => {
    if (!origin) return;
    const wasMoved = moved,
      from = source,
      to = destination;
    origin = null;
    source = destination = null;
    moved = false;
    cancelAnimationFrame(scrollFrame);
    indicator.hidden = true;
    root.classList.remove("block-dragging");
    hovered?.classList.remove("block-moving");
    if (wasMoved) {
      event.preventDefault();
      suppressClick = true;
      if (from !== null && to !== null) moveBlock(editor, from, to);
      setTimeout(() => (suppressClick = false), 0);
    }
  };
  handle.onpointerdown = (event) => {
    if (event.button !== 0 || !hovered) return;
    event.preventDefault();
    close();
    source = position(hovered);
    origin = { x: event.clientX, y: event.clientY };
    destination = null;
    moved = false;
    handle.setPointerCapture(event.pointerId);
  };
  handle.onpointermove = drag;
  handle.onpointerup = drop;
  handle.onpointercancel = (event) => {
    destination = null;
    drop(event);
  };
  handle.ondragstart = (event) => event.preventDefault();
  handle.onmousedown = (event) => event.preventDefault();
  handle.onclick = () => {
    if (suppressClick) return;
    const box = handle.getBoundingClientRect();
    open(box.right + 4, box.top);
  };
  handle.setAttribute("aria-haspopup", "menu");
  handle.setAttribute("aria-expanded", "false");
  root.addEventListener("pointermove", pointer);
  root.addEventListener("pointerleave", leave);
  editor.view.dom.addEventListener("contextmenu", context);
  const eventRoot = root.getRootNode();
  eventRoot.addEventListener("pointerdown", outside as EventListener);
  root.addEventListener("keydown", escape, true);
  return {
    close,
    openAtSelection() {
      const selected = editor.view.nodeDOM(editor.state.selection.from);
      const node = editor.view.domAtPos(editor.state.selection.from).node;
      const block = blockAt(
        selected instanceof HTMLElement
          ? selected
          : node instanceof HTMLElement
            ? node
            : node.parentElement,
      );
      if (!block) return;
      showHandle(block);
      const rect = block.getBoundingClientRect();
      open(rect.left + 12, rect.bottom + 8);
    },
    update() {
      if (hovered && !hovered.isConnected) {
        hovered = null;
        handle.hidden = true;
        close();
      }
      if (
        (matchMedia("(pointer:coarse)").matches ||
          document.documentElement.dataset.nativeTouch === "true") &&
        !origin && menu.hidden
      ) {
        handle.hidden = true;
      }
    },
    destroy() {
      cancelAnimationFrame(scrollFrame);
      root.removeEventListener("pointermove", pointer);
      root.removeEventListener("pointerleave", leave);
      editor.view.dom.removeEventListener("contextmenu", context);
      eventRoot.removeEventListener("pointerdown", outside as EventListener);
      root.removeEventListener("keydown", escape, true);
      menu.remove();
      indicator.remove();
    },
  };
}
