export const commandDefinitions = [
  {
    id: "paragraph",
    title: "Текст",
    aliases: ["text", "paragraph", "текст"],
    icon: "text",
    shortcut: "⇧⌘B",
  },
  ...([1, 2, 3] as const).map((n) => ({
    id: `h${n}`,
    title: `Заголовок ${n}`,
    aliases: [`h${n}`, `heading${n}`],
    icon: "heading",
    shortcut: ["⇧⌘T", "⇧⌘H", "⇧⌘J"][n - 1],
  })),
  {
    id: "bullet",
    title: "Маркированный список",
    aliases: ["bullet", "ul", "список"],
    icon: "bullet",
  },
  {
    id: "ordered",
    title: "Нумерованный список",
    aliases: ["ordered", "number", "ol", "нумерация"],
    icon: "ordered",
  },
  {
    id: "task",
    title: "Чеклист",
    aliases: ["todo", "туду", "task", "checklist", "чеклист", "задачи"],
    icon: "task",
    shortcut: "⇧⌘L",
  },
  {
    id: "nested",
    title: "Вложенный маркированный список",
    aliases: ["nested", "вложенный"],
    icon: "nested",
  },
  { id: "quote", title: "Цитата", aliases: ["quote", "цитата"], icon: "quote" },
  {
    id: "source",
    title: "Источник с цитатой",
    aliases: ["source", "источник", "snippet"],
    icon: "source",
  },
  { id: "code", title: "Блок кода", aliases: ["code", "код"], icon: "code" },
  {
    id: "divider",
    title: "Разделитель",
    aliases: ["divider", "разделитель", "hr"],
    icon: "divider",
  },
  {
    id: "table",
    title: "Таблица",
    aliases: ["table", "таблица"],
    icon: "table",
  },
  {
    id: "image",
    title: "Фото",
    aliases: ["image", "photo", "фото", "изображение"],
    icon: "image",
  },
  {
    id: "file",
    title: "Файл",
    aliases: ["file", "файл", "attachment"],
    icon: "file",
  },
  {
    id: "voice",
    title: "Голосовая заметка",
    aliases: ["voice", "audio", "голос", "запись"],
    icon: "voice",
  },
  {
    id: "drawing",
    title: "Рисунок",
    aliases: ["drawing", "рисунок"],
    icon: "drawing",
  },
  {
    id: "settings",
    title: "Настройки команд",
    aliases: ["settings", "настройки", "aliases", "алиасы"],
    icon: "settings",
  },
];
export type CommandAliases = Record<string, string[]>;
const key = "doompile-editor-command-aliases";
let storage: {
  read: () => Record<string, unknown>;
  write: (value: CommandAliases) => void | Promise<void>;
} = {
  read: () => JSON.parse(localStorage.getItem(key) || "{}"),
  write: (value) => localStorage.setItem(key, JSON.stringify(value)),
};
export function configureCommandPreferences(value: typeof storage) {
  storage = value;
}
export function commandAliases(): CommandAliases {
  try {
    const stored = storage.read();
    return Object.fromEntries(
      commandDefinitions.map(({ id }) => [
        id,
        Array.isArray(stored[id])
          ? (stored[id] as string[])
              .filter((v: unknown) => typeof v === "string")
              .slice(0, 20)
          : [],
      ]),
    );
  } catch {
    return {};
  }
}
export function createCommandPreferences(
  root: HTMLElement,
  onClose?: () => void,
) {
  const dialog = document.createElement("dialog");
  dialog.className = "source-snippet-dialog command-preferences";
  dialog.setAttribute("aria-label", "Настройки команд редактора");
  const form = document.createElement("form"),
    title = document.createElement("h2"),
    help = document.createElement("p");
  title.textContent = "Команды редактора";
  help.textContent =
    "Добавь свои алиасы через запятую. Встроенные команды продолжат работать. Настройки сохраняются на этом устройстве.";
  form.append(title, help);
  const fields = new Map<string, HTMLInputElement>();
  for (const definition of commandDefinitions) {
    const label = document.createElement("label"),
      input = document.createElement("input"),
      defaults = document.createElement("small");
    label.textContent = definition.title;
    input.placeholder = "Дополнительные алиасы";
    input.maxLength = 400;
    defaults.textContent = definition.aliases
      .map((alias) => `/${alias}`)
      .join(" · ");
    label.append(input, defaults);
    form.append(label);
    fields.set(definition.id, input);
  }
  const actions = document.createElement("div");
  actions.className = "source-dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Отмена";
  cancel.onclick = () => dialog.close();
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Сохранить настройки";
  actions.append(cancel, save);
  form.append(actions);
  dialog.append(form);
  root.append(dialog);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const aliases = Object.fromEntries(
      [...fields].map(([id, input]) => [
        id,
        [
          ...new Set(
            input.value
              .toLocaleLowerCase()
              .split(/[,\n]/)
              .map((v) => v.trim().replace(/^\//, ""))
              .filter((v) => v && !/[\s/@]/.test(v)),
          ),
        ].slice(0, 20),
      ]),
    );
    try {
      save.disabled = true;
      await storage.write(aliases);
      dialog.close();
    } catch {
      save.textContent = "Не удалось сохранить. Повторить";
    } finally {
      save.disabled = false;
    }
  };
  dialog.onclose = () => onClose?.();
  return {
    open() {
      const aliases = commandAliases();
      fields.forEach(
        (input, id) => (input.value = (aliases[id] || []).join(", ")),
      );
      dialog.showModal();
    },
    destroy() {
      dialog.onclose = null;
      dialog.remove();
    },
  };
}

export function showCommandPreferences() {
  const host = document.createElement("div");
  host.className = "block-editor editor-preferences-host";
  document.body.append(host);
  const preferences = createCommandPreferences(host, () => {
    preferences.destroy();
    host.remove();
  });
  preferences.open();
}
