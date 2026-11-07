import {
  createBlockEditor,
  documentPlainText,
} from "../../../packages/editor/src/block-editor";
import { configureCommandPreferences, showCommandPreferences } from "../../../packages/editor/src/command-preferences";
const extensionAPI = globalThis.browser || globalThis.chrome;
let aliases = {};
const ready = extensionAPI?.storage?.local ? extensionAPI.storage.local.get("editorCommandAliases").then(value => { aliases = value.editorCommandAliases || {}; }) : Promise.resolve();
if (extensionAPI?.storage?.local) configureCommandPreferences({ read: () => aliases, write: async value => { await extensionAPI.storage.local.set({ editorCommandAliases: value }); aliases = value; } });
function mount(root, value, onChange) {
  const linkForm = document.createElement("div");
  linkForm.className = "dp-link-form";
  linkForm.hidden = true;
  const url = document.createElement("input");
  url.type = "url";
  url.placeholder = "https://";
  url.setAttribute("aria-label", "Адрес ссылки");
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "Добавить";
  linkForm.append(url, apply);
  root.before(linkForm);
  const controller = createBlockEditor(root, {
    onTelemetry: (name, properties) => { void extensionAPI?.runtime?.sendMessage({type:'doompile:telemetry',name,properties}).catch(()=>{}); },
    content: value,
    onChange: () => onChange(),
    onLink: (href) => {
      linkForm.hidden = false;
      url.value = href || "";
      url.focus();
    },
  });
  const { editor } = controller;
  let focused = false;
  function setLink() {
    const href = url.value.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      linkForm.hidden = true;
      return;
    }
    try {
      if (!["https:", "http:", "mailto:"].includes(new URL(href).protocol))
        throw new Error();
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      linkForm.hidden = true;
      url.setCustomValidity("");
    } catch {
      url.setCustomValidity("Введи обычный адрес ссылки.");
      url.reportValidity();
    }
  }
  apply.onclick = setLink;
  url.addEventListener("input", () => url.setCustomValidity(""));
  url.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      setLink();
    }
  });
  const canvas = editor.view.dom.parentElement;
  canvas.classList.add("dp-editor-canvas");
  // The writing surface fills the available height, including its padding.
  // A click on text still goes through ProseMirror's own caret placement.
  const focusCanvas = (event) => {
    if (event.target !== root && event.target !== canvas) return;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    focused = true;
    editor.view.focus();
  };
  root.addEventListener("click", focusCanvas);
  return {
    getJSON: () => editor.getJSON(),
    getText: () => documentPlainText(editor),
    setCompact(value) {
      root.classList.toggle("compact-document", value);
      if (value) linkForm.hidden = true;
    },
    setTimestamp(seconds) {
      let found = false;
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (!found && node.type.name === "sourceSnippet") {
          found = true;
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            timestampSeconds: seconds,
            url: DoompileCore.sourceURL(node.attrs.url, seconds),
          });
        }
      });
      if (tr.docChanged) editor.view.dispatch(tr);
    },
    focus: () => {
      if(!focused){editor.commands.setTextSelection(editor.state.doc.content.size-1);focused=true;}
      // ProseMirror restores the DOM selection synchronously while its observer
      // is paused. Tiptap's deferred focus can let iOS replace it after a move.
      editor.view.focus();
    },
    destroy() {
      root.removeEventListener("click", focusCanvas);
      controller.destroy();
      root.classList.remove("block-editor");
      linkForm.remove();
    },
  };
}
globalThis.DoompileRichEditor = { version: 2, mount, ready, showPreferences: async () => { await ready; showCommandPreferences(); } };
