"use client";
import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { Plus, Search, X } from "../../../packages/design/ui-icons";

export default function NoteTags({
  value,
  available,
  onChange,
}: {
  value: string[];
  available: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const clean = query.trim().replace(/^#\s*/, "");
  const key = (value: string) => value.toLocaleLowerCase();
  const selected = new Set(value.map(key));
  const choices = [...new Set(available)]
    .filter((tag) => !selected.has(key(tag)) && key(tag).includes(key(clean)))
    .sort((a, b) => a.localeCompare(b, "ru"));
  const existing = [...available, ...value].find(
    (tag) => key(tag) === key(clean),
  );
  const canCreate = !!clean && !existing && clean.length <= 100;
  const options = [
    ...choices.map((name) => ({ name, create: false })),
    ...(canCreate ? [{ name: clean, create: true }] : []),
  ];
  useLayoutEffect(() => {
    if (!open || !popup.current) return;
    const menu = popup.current,
      anchor = menu.parentElement!.getBoundingClientRect();
    const bounds = root
      .current!.closest(".note-editor-surface")!
      .getBoundingClientRect();
    menu.style.maxWidth = `${Math.min(window.innerWidth, bounds.width) - 24}px`;
    menu.style.left = `${Math.max(bounds.left + 12 - anchor.left, Math.min(0, bounds.right - 12 - anchor.left - menu.offsetWidth))}px`;
  }, [open, value.length]);
  function add(name: string) {
    const normalized = name.trim().replace(/^#\s*/, "");
    if (!normalized || normalized.length > 100 || value.length >= 100) return;
    if (!selected.has(key(normalized))) onChange([...value, normalized]);
    setQuery("");
    setActive(0);
    input.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, id, open]);
  return (
    <div
      className="note-tags-editor"
      aria-label="Теги заметки"
      ref={root}
      data-tag-editor-picker-open={open ? "true" : undefined}
    >
      {value.map((tag) => (
        <span className="editor-tag" key={tag}>
          <span className="tag-editor-hash" aria-hidden="true">
            #
          </span>
          <span className="tag-editor-name" title={tag}>
            {tag}
          </span>
          <button
            type="button"
            aria-label={`Убрать тег ${tag}`}
            title={`Убрать тег ${tag}`}
            onClick={() => onChange(value.filter((item) => item !== tag))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <div className="tag-editor-picker">
        {open ? (
          <div className="tag-editor-search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={input}
              role="combobox"
              aria-label="Найти или создать тег"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={id}
              aria-activedescendant={
                options[active] ? `${id}-${active}` : undefined
              }
              placeholder="Найти или создать тег…"
              value={query}
              maxLength={101}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  setQuery("");
                  requestAnimationFrame(() =>
                    root.current
                      ?.querySelector<HTMLButtonElement>(".tag-editor-add")
                      ?.focus(),
                  );
                } else if (
                  event.key === "ArrowDown" ||
                  event.key === "ArrowUp"
                ) {
                  event.preventDefault();
                  setActive(
                    (index) =>
                      (index +
                        (event.key === "ArrowDown" ? 1 : options.length - 1)) %
                      Math.max(options.length, 1),
                  );
                } else if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  if (event.key === "," && clean) add(existing || clean);
                  else if (options[active]) add(options[active].name);
                } else if (
                  event.key === "Backspace" &&
                  !query &&
                  value.length
                ) {
                  event.preventDefault();
                  onChange(value.slice(0, -1));
                } else if (event.key === "Tab") {
                  if (clean && options[active]) add(options[active].name);
                  setOpen(false);
                  setQuery("");
                }
              }}
            />
            <button
              type="button"
              aria-label="Закрыть выбор тегов"
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
            >
              <X size={17} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="tag-editor-add"
            onClick={() => {
              setQuery("");
              setOpen(true);
            }}
            aria-label="Добавить тег"
            disabled={value.length >= 100}
          >
            <Plus size={13} />
            <span className="desktop-tag-label">
              {value.length ? "Тег" : "Добавить тег"}
            </span>
            <span className="mobile-tag-label">
              Теги{value.length ? ` · ${value.length}` : ""}
            </span>
          </button>
        )}
        {open && (
          <div
            ref={popup}
            className="tag-editor-suggestions"
            id={id}
            role="listbox"
            aria-label="Подсказки тегов"
          >
            {options.map((option, index) => (
              <button
                type="button"
                key={option.name}
                role="option"
                id={`${id}-${index}`}
                aria-selected={active === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(option.name)}
              >
                <span aria-hidden="true">{option.create ? "+" : "#"}</span>
                <span>
                  {option.create ? `Создать «${option.name}»` : option.name}
                </span>
              </button>
            ))}
            {!options.length && (
              <p>
                {selected.has(key(clean))
                  ? "Эта тег уже добавлена"
                  : clean.length > 100
                    ? "До 100 символов в названии"
                    : "Введи название новой тега"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
