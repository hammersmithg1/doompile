import type { Editor } from "@tiptap/core";
import type { SelectionBookmark, Transaction } from "@tiptap/pm/state";
import { insertMedia } from "./blocks";

export function createSourceDialog(root: HTMLElement, editor: Editor) {
  const dialog = document.createElement("dialog");
  dialog.className = "source-snippet-dialog";
  dialog.setAttribute("aria-label", "Источник с цитатой");
  const form = document.createElement("form");
  const heading = document.createElement("h2");
  heading.textContent = "Источник с цитатой";
  const description = document.createElement("p");
  description.textContent =
    "Сохрани ссылку и нужный фрагмент в отдельной карточке.";
  const field = <T extends HTMLInputElement | HTMLTextAreaElement>(
    label: string,
    input: T,
  ) => {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    wrapper.append(input);
    form.append(wrapper);
    return input;
  };
  form.append(heading, description);
  const url = field("Ссылка", document.createElement("input"));
  url.type = "url";
  url.required = true;
  url.maxLength = 8192;
  url.pattern = "https?://.+";
  url.placeholder = "https://example.com";
  url.setAttribute("autocomplete", "url");
  const title = field(
    "Название (необязательно)",
    document.createElement("input"),
  );
  title.placeholder = "Название страницы";
  title.maxLength = 2000;
  const quote = field(
    "Цитата (необязательно)",
    document.createElement("textarea"),
  );
  quote.rows = 4;
  quote.maxLength = 300000;
  quote.placeholder = "Фрагмент, который хочется сохранить";
  const actions = document.createElement("div");
  actions.className = "source-dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Отмена";
  cancel.onclick = () => dialog.close();
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Добавить источник";
  actions.append(cancel, submit);
  form.append(actions);
  dialog.append(form);
  root.append(dialog);
  let bookmark: SelectionBookmark | null = null;
  const mapBookmark = ({ transaction }: { transaction: Transaction }) => {
    if (bookmark) bookmark = bookmark.map(transaction.mapping);
  };
  function restoreSelection() {
    const saved = bookmark;
    bookmark = null;
    editor.off("transaction", mapBookmark);
    if (saved)
      editor.view.dispatch(
        editor.state.tr.setSelection(saved.resolve(editor.state.doc)),
      );
    editor.view.focus();
  }
  dialog.onclose = () => restoreSelection();
  dialog.onclick = (event) => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      dialog.close();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const href = new URL(url.value.trim());
    if (!["http:", "https:"].includes(href.protocol)) return;
    dialog.close();
    restoreSelection();
    insertMedia(editor, {
      type: "sourceSnippet",
      attrs: {
        url: href.href,
        title: title.value.trim() || href.hostname.replace(/^www\./, ""),
        quote: quote.value.trim(),
      },
    });
  };
  return {
    open() {
      form.reset();
      bookmark = editor.state.selection.getBookmark();
      editor.on("transaction", mapBookmark);
      dialog.showModal();
      url.focus();
    },
    destroy() {
      dialog.onclose = null;
      editor.off("transaction", mapBookmark);
      dialog.remove();
    },
  };
}
