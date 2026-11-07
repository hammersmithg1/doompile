import type { Editor } from "@tiptap/core";
import {
  colorNames,
  textColors,
  highlightColors,
  indentText,
} from "./formatting";
import { icon } from "./icons";

export const blockTypes = [
  ["paragraph", "Текст", "text"],
  ["h1", "Заголовок 1", "heading"],
  ["h2", "Заголовок 2", "heading"],
  ["h3", "Заголовок 3", "heading"],
  ["bulletList", "Маркированный список", "bullet"],
  ["orderedList", "Нумерованный список", "ordered"],
  ["taskList", "Чеклист", "task"],
  ["blockquote", "Цитата", "quote"],
  ["codeBlock", "Блок кода", "code"],
] as const;
export function setBlockType(editor: Editor, type: string) {
  const chain = editor.chain().focus();
  if (/^h[123]$/.test(type))
    return chain
      .clearNodes()
      .setHeading({ level: Number(type[1]) as 1 | 2 | 3 })
      .run();
  if (type === "paragraph") return chain.clearNodes().setParagraph().run();
  if (type === "bulletList") return chain.toggleBulletList().run();
  if (type === "orderedList") return chain.toggleOrderedList().run();
  if (type === "taskList") return chain.toggleTaskList().run();
  if (type === "blockquote") return chain.toggleBlockquote().run();
  if (type === "codeBlock") return chain.toggleCodeBlock().run();
  return false;
}

export function createFormattingUI(
  root: HTMLElement,
  editor: Editor,
  toolbar: HTMLElement,
  onLink: () => void,
) {
  const panel = document.createElement("div");
  panel.className = "editor-popover";
  panel.hidden = true;
  panel.setAttribute("role", "menu");
  root.append(panel);
  let active: HTMLButtonElement | null = null;
  let nativeOpen = false;
  const states: { button: HTMLButtonElement; active: () => boolean }[] = [];
  function button(
    text: string,
    name: string,
    run: () => void,
    isActive?: () => boolean,
  ) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.title = name;
    b.setAttribute("aria-label", name);
    b.onmousedown = (event) => event.preventDefault();
    b.onclick = run;
    toolbar.append(b);
    if (isActive) states.push({ button: b, active: isActive });
    return b;
  }
  function close() {
    nativeOpen = false;
    panel.hidden = true;
    active?.setAttribute("aria-expanded", "false");
    active = null;
  }
  function open(anchor: HTMLButtonElement, name: string, fill: () => void) {
    if (active === anchor && !panel.hidden) {
      close();
      return;
    }
    close();
    active = anchor;
    anchor.setAttribute("aria-expanded", "true");
    panel.setAttribute("aria-label", name);
    panel.replaceChildren();
    fill();
    panel.hidden = false;
    reposition();
  }
  function reposition() {
    if (!active || panel.hidden) return;
    const rect = active.getClientRects().length
      ? active.getBoundingClientRect()
      : { left: 12, top: innerHeight - 8, bottom: innerHeight - 8 };
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, rect.bottom + panel.offsetHeight + 8 < innerHeight ? rect.bottom + 8 : rect.top - panel.offsetHeight - 8)}px`;
  }
  function item(
    label: string,
    run: () => void,
    selected = false,
    symbol?: string,
  ) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.setAttribute("aria-label", label);
    if (symbol) b.append(icon(symbol));
    b.append(document.createTextNode(label));
    if (selected) b.setAttribute("data-active", "true");
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      run();
      close();
    };
    panel.append(b);
    return b;
  }
  const type = button("Текст ⌄", "Тип блока", () =>
    open(type, "Тип блока", () => {
      for (const [id, label, symbol] of blockTypes)
        item(
          label,
          () => {
            setBlockType(editor, id);
          },
          id[0] === "h"
            ? editor.isActive("heading", { level: Number(id[1]) })
            : editor.isActive(id),
          symbol,
        );
    }),
  );
  type.setAttribute("aria-haspopup", "menu");
  for (const [text, name, mark] of [
    ["B", "Жирный", "bold"],
    ["I", "Курсив", "italic"],
    ["U", "Подчёркнутый", "underline"],
    ["S", "Зачёркнутый", "strike"],
    ["‹/›", "Код", "code"],
  ])
    button(
      text,
      name,
      () => {
        editor.chain().focus().toggleMark(mark).run();
      },
      () => editor.isActive(mark),
    );
  button("↗", "Ссылка", onLink, () => editor.isActive("link"));
  const colors = button("A ⌄", "Цвет текста и выделения", () =>
    open(colors, "Цвет текста и выделения", () => {
      [
        ["Цвет текста", textColors, "textStyle", "color"],
        ["Цвет выделения", highlightColors, "highlight", "color"],
      ].forEach(([title, values, mark]) => {
        const h = document.createElement("strong");
        h.textContent = title as string;
        panel.append(h);
        const grid = document.createElement("div");
        grid.className = "editor-color-grid";
        panel.append(grid);
        (values as string[]).forEach((color, index) => {
          const b = document.createElement("button");
          b.type = "button";
          b.title = colorNames[index];
          b.setAttribute("aria-label", `${title}: ${colorNames[index]}`);
          b.setAttribute("role", "menuitem");
          b.textContent = mark === "textStyle" ? "A" : "";
          b.style.setProperty("--swatch", color || "transparent");
          b.className =
            mark === "textStyle" ? "text-swatch" : "highlight-swatch";
          b.onmousedown = (e) => e.preventDefault();
          b.onclick = () => {
            if (color)
              editor
                .chain()
                .focus()
                .setMark(mark as string, { color })
                .run();
            else
              editor
                .chain()
                .focus()
                .unsetMark(mark as string)
                .run();
            close();
          };
          grid.append(b);
        });
      });
    }),
  );
  colors.setAttribute("aria-haspopup", "menu");
  const more = button("⋯", "Ещё форматирование", () =>
    open(more, "Ещё форматирование", () => {
      item(
        "Верхний индекс",
        () => {
          editor.chain().focus().toggleMark("superscript").run();
        },
        editor.isActive("superscript"),
      );
      item(
        "Нижний индекс",
        () => {
          editor.chain().focus().toggleMark("subscript").run();
        },
        editor.isActive("subscript"),
      );
      for (const [alignment, label] of [
        ["left", "По левому краю"],
        ["center", "По центру"],
        ["right", "По правому краю"],
        ["justify", "По ширине"],
      ])
        item(label, () => {
          editor
            .chain()
            .focus()
            .updateAttributes("paragraph", { textAlign: alignment })
            .updateAttributes("heading", { textAlign: alignment })
            .run();
        });
      item("Увеличить отступ", () => {
        indentText(editor, 1);
        editor.view.focus();
      });
      item("Уменьшить отступ", () => {
        indentText(editor, -1);
        editor.view.focus();
      });
      item("Сбросить форматирование", () => {
        editor
          .chain()
          .focus()
          .unsetAllMarks()
          .resetAttributes("paragraph", ["textAlign", "indent"])
          .resetAttributes("heading", ["textAlign", "indent"])
          .run();
      });
    }),
  );
  more.setAttribute("aria-haspopup", "menu");
  const outside = (event: PointerEvent) => {
    if (
      !event.composedPath().includes(toolbar) &&
      !event.composedPath().includes(panel)
    )
      close();
  };
  const escape = (event: KeyboardEvent) => {
    if (!panel.hidden && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      editor.view.focus();
    }
  };
  const eventRoot = root.getRootNode();
  eventRoot.addEventListener("pointerdown", outside as EventListener);
  root.addEventListener("keydown", escape, true);
  return {
    close,
    get nativeOpen() {
      return nativeOpen;
    },
    openNative(kind: "colors" | "more" | "type") {
      editor.view.focus();
      ({ colors, more, type })[kind].click();
      nativeOpen = !panel.hidden;
    },
    reposition,
    update() {
      states.forEach(({ button, active }) =>
        button.setAttribute("aria-pressed", String(active())),
      );
      const current = blockTypes.find(([id]) =>
        id[0] === "h"
          ? editor.isActive("heading", { level: Number(id[1]) })
          : id !== "paragraph" && editor.isActive(id),
      );
      type.textContent = `${current?.[1] || "Текст"} ⌄`;
    },
    destroy() {
      eventRoot.removeEventListener("pointerdown", outside as EventListener);
      root.removeEventListener("keydown", escape, true);
      panel.remove();
    },
  };
}
