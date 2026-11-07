"use client";
import { track } from "@/lib/client/telemetry";
import {
  accountStorage as localStorage,
  accountFetch as fetch,
} from "@/lib/client/account";
import {
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
  useCallback,
  useLayoutEffect,
  type CSSProperties,
} from "react";
import {
  ArrowUp,
  ArrowUpRight,
  ArrowLeft,
  Search,
  PanelLeft,
  Pin,
  Plus,
  X,
  MoreHorizontal,
  Flame,
  Image as ImageIcon,
  Mic,
  Check,
  Link2,
  File,
  Settings,
  Tag,
  Trash2,
  ChevronRight,
  Layers,
  ListChecks,
} from "../../../packages/design/ui-icons";
import {
  createNote,
  NOTE_LIMITS,
  compareNoteCreation,
  shouldPersistNote,
  noteIDFromURL,
  noteIDPattern,
  notePath,
  noteURL,
  sourceLink,
  textToDocument,
  formatTimestamp,
  timestampFromURL,
  type Note,
  type Attachment,
  type DocumentNode,
} from "@doompile/core";
import * as store from "@/lib/client/store";
import {
  appearanceMode,
  resolvedAppearance,
  type AppearanceMode,
} from "@/lib/client/appearance";
import { Autosave } from "@/lib/client/autosave";
import { prepareDocument } from "../../../packages/editor/src/blocks";
import LinkedText, { splitLinks } from "./linked-text";
import AttachmentPreview from "./attachment-preview";
import LinkPreview from "./link-preview";
import NoteExcerpt from "./note-excerpt";
import { groupFeed } from "@/lib/client/feed-groups";
import { installFileDrop } from "@/lib/client/file-drop";
import { recordingSession, type RecordingDraft } from "@/lib/client/recording";
import {
  finishRecordingDocument,
  reconcileFinishedRecordings,
  findFinishedRecording,
} from "@/lib/client/recording-document";
import { useRecording } from "./use-recording";
import {
  clipboardFiles,
  clipboardImage,
  isLocalImagePath,
  readClipboardImage,
} from "@/lib/client/clipboard";
import { safeURL, SourceSnippet } from "./document";
import type { RichEditorAPI } from "./rich-editor";
import SettingsDialog from "./settings-dialog";
import QuickComposer from "./quick-composer";
import Modal from "./modal";
import { Halo, PileCat, Wordmark, BrandIllustration } from "./brand";
import { brandCopy, uiCopy } from "../../../packages/design/copy";
import { demoNotesCached } from "@/lib/client/demo-notes";
import {
  documentMediaURLs,
  editableNote,
  noteForEditorSave,
  editorContentKey,
} from "@/lib/client/editor-model";
import "../../../packages/editor/src/blocks.css";
import NoteEditorSurface from "./note-editor-surface";
import MobileNoteRow from "./mobile-note-row";
import { useMobileViewport } from "./mobile-viewport";
import { useMobileSidebar } from "./mobile-sidebar";
type Filter = "all" | "urgent" | "pinned" | "media" | "tag";
const typeLabel = {
  note: "Заметка",
  article: "Статья",
  video: "Видео",
  audio: "Аудио",
  image: "Изображение",
  file: "Файл",
};
function dateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString()
    ? "Сегодня"
    : date.toDateString() === yesterday.toDateString()
      ? "Вчера"
      : date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
function time(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function sourceName(note: Note) {
  if (note.source)
    try {
      return new URL(note.source.url).hostname.replace(/^www\./, "");
    } catch {}
  return typeLabel[note.kind];
}
export default function Doompile({
  initialNoteID,
}: { initialNoteID?: string } = {}) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const recording = useRecording();
  const latestEditor = useRef<Note | null>(null);
  const editorAPI = useRef<RichEditorAPI | null>(null);
  const [noteMenu, setNoteMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [draftAttachments, setDraftAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedTag, setSelectedTag] = useState("");
  const [query, setQuery] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [selected, setSelectedState] = useState<string | null>(
    initialNoteID || null,
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  function writeNoteLocation(id: string | null, replace = false) {
    const path = id ? notePath(id) : "/";
    if (location.pathname + location.search + location.hash !== path)
      history[replace ? "replaceState" : "pushState"](null, "", path);
  }
  function setSelected(id: string | null) {
    if (id && !noteIDPattern.test(id)) {
      notify("Некорректная ссылка на заметку.");
      return;
    }
    setSelectedState(id);
    if (id && id !== selectedRef.current) track("note.opened", { note_id: id });
    writeNoteLocation(id);
  }
  async function copyNoteLink(id: string) {
    try {
      await autosave.current?.flush();
      await navigator.clipboard.writeText(noteURL(id, location.origin));
      notify("Ссылка на заметку скопирована");
    } catch {
      notify(
        "Не удалось скопировать. Адрес открытой заметки доступен в строке браузера.",
      );
    }
  }
  const [text, setText] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [demo, setDemo] = useState(false);
  const [undoNote, setUndoNote] = useState<Note | null>(null);
  const [editor, setEditor] = useState<Note | null>(null);
  const editorBaseline = useRef<{ id: string; content: string } | null>(null);
  const [editorDocumentVersion, setEditorDocumentVersion] = useState(0);
  const [editorMode, setEditorMode] = useState<"compose" | "note">("compose");
  const composing = !!editor && editorMode === "compose";
  latestEditor.current = editor;
  const latestComposer = useRef<Note | null>(null);
  latestComposer.current = composing ? editor : null;
  const [editTags, setEditTags] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Сохранено");
  const autosave = useRef<Autosave<Note> | null>(null);
  if (!autosave.current)
    autosave.current = new Autosave(
      async (note) => {
        setSaveStatus("Сохраняем…");
        const stored = store
          .getSnapshot()
          .notes.find((item) => item.id === note.id);
        if (stored) note = reconcileFinishedRecordings(note, stored);
        await store.saveNote(note);
        for (const key of [
          "doompile-editor-draft",
          `doompile-note-draft-${note.id}`,
        ]) {
          try {
            const draft = JSON.parse(localStorage.getItem(key) || "null");
            if (draft && JSON.stringify(draft.note) === JSON.stringify(note))
              localStorage.removeItem(key);
          } catch {}
        }
        setSaveStatus("Сохранено");
      },
      () => setSaveStatus("Не удалось сохранить"),
    );
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [theme, setTheme] = useState<AppearanceMode | null>(null);
  const [tagCreate, setTagCreate] = useState(false);
  const [tagCatalog, setTagCatalog] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [detailWidth, setDetailWidth] = useState(440);
  const [resizing, setResizing] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const detailPane = useRef<HTMLElement>(null);
  const composerOrigin = useRef<DOMRect | null>(null);
  const closing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isMobile = useMobileViewport();
  const [openSwipe, setOpenSwipe] = useState<string | null>(null);
  const mobileSidebar = useMobileSidebar({
    mobile: isMobile,
    open: sidebar,
    canOpen: !selected && !composing,
    onChange: setSidebar,
    onDragStart: () => setOpenSwipe(null),
  });
  useEffect(() => {
    void store.initStore();
    try {
      setTagCatalog(
        JSON.parse(localStorage.getItem("doompile-tag-catalog") || "[]").filter(
          (t: unknown) => typeof t === "string",
        ),
      );
    } catch {}
    const warmEditor = window.setTimeout(() => {
      void import("./rich-editor");
    }, 1200);
    try {
      try {
        setCollapsed(
          JSON.parse(
            localStorage.getItem("doompile-collapsed-sections") || "{}",
          ),
        );
      } catch {}
      const width = Number(localStorage.getItem("doompile-detail-width"));
      if (width >= 280)
        setDetailWidth(Math.min(width, Math.max(280, window.innerWidth - 540)));
      setText(localStorage.getItem("doompile-draft") || "");
      try {
        setDraftAttachments(
          JSON.parse(localStorage.getItem("doompile-attachment-draft") || "[]"),
        );
      } catch {}
      setTheme(appearanceMode(localStorage.getItem("doompile-theme")));
    } catch {
      setTheme("system");
    }
    setDraftReady(true);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      void navigator.serviceWorker.register("/sw.js");
    const id = noteIDFromURL(location.href);
    if (id) {
      setSelectedState(id);
      writeNoteLocation(id, true);
    }
    if (window.matchMedia("(pointer:fine)").matches)
      input.current?.focus({ preventScroll: true });
    return () => window.clearTimeout(warmEditor);
  }, []);
  useEffect(() => {
    let generation = 0;
    const back = () => {
      const request = ++generation,
        id = noteIDFromURL(location.href);
      void (async () => {
        try {
          const current = latestEditor.current;
          if (current) await finishRecording(current.id);
          await autosave.current?.flush();
          if (request !== generation) return;
          const animation = !id ? await animateDetailClose() : undefined;
          if (request !== generation) {
            animation?.cancel();
            return;
          }
          setEditor(null);
          setDetailExpanded(false);
          setSelectedState(id);
        } catch {
          if (request === generation)
            writeNoteLocation(selectedRef.current, true);
          notify("Не удалось сохранить заметку. Повтори переход.");
        }
      })();
    };
    window.addEventListener("popstate", back);
    return () => {
      generation++;
      window.removeEventListener("popstate", back);
    };
  }, []);
  useEffect(() => {
    if (!theme) return;
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = resolvedAppearance(theme, system.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.appearance = theme;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    system.addEventListener("change", apply);
    try {
      localStorage.setItem("doompile-theme", theme);
    } catch {}
    return () => system.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    if (draftReady)
      try {
        localStorage.setItem("doompile-draft", text);
      } catch {}
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`;
    }
  }, [text, draftReady]);
  useEffect(() => {
    if (draftReady)
      try {
        localStorage.setItem(
          "doompile-attachment-draft",
          JSON.stringify(draftAttachments),
        );
      } catch {}
  }, [draftReady, draftAttachments]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => {
      setToast("");
      setUndoNote(null);
    }, 8000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSidebar(true);
        setTimeout(() => search.current?.focus(), 50);
      }
      if (e.key === "Escape") {
        if (
          noteMenu ||
          document.querySelector(
            '[role="dialog"], .command-menu:not([hidden]), [data-tag-editor-picker-open="true"]',
          )
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        if (editor) {
          closeEditor();
          return;
        }
        setDetailExpanded(false);
        setSelected(null);
        setSidebar(false);
        requestAnimationFrame(() =>
          input.current?.focus({ preventScroll: true }),
        );
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [editor, detailExpanded, noteMenu]);
  useLayoutEffect(() => {
    if (!composing || !dock.current) return;
    const origin = composerOrigin.current;
    if (
      origin &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      dock.current.animate(
        [
          {
            clipPath: `inset(${origin.top}px ${window.innerWidth - origin.right}px ${window.innerHeight - origin.bottom}px ${origin.left}px round 16px)`,
          },
          { clipPath: "inset(0px 0px 0px 0px round 0px)" },
        ],
        { duration: 360, easing: "cubic-bezier(.22,1,.36,1)" },
      );
    }
    const frame = requestAnimationFrame(() =>
      dock.current
        ?.querySelector<HTMLElement>('[role="textbox"]')
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [editor?.id, composing]);
  async function animateDetailClose() {
    const pane = detailPane.current;
    if (!pane || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    pane.getAnimations().forEach((animation) => animation.cancel());
    const position = getComputedStyle(pane).position;
    const overlay = position === "fixed" || position === "absolute";
    const animation = pane.animate(
      overlay
        ? [
            { transform: "translateX(0)", opacity: 1 },
            { transform: "translateX(32px)", opacity: 0 },
          ]
        : [
            { marginRight: "0px", opacity: 1 },
            {
              marginRight: `-${pane.getBoundingClientRect().width}px`,
              opacity: 0,
            },
          ],
      { duration: 240, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
    );
    try {
      await animation.finished;
    } catch {
      // A superseding navigation can cancel the exit animation.
    }
    return animation;
  }
  async function closeEditor() {
    if (closing.current || editorBusy || (composing && uploading > 0))
      return false;
    closing.current = true;
    try {
      if (
        editor &&
        recordingSession.getSnapshot().draft?.target === editor.id
      ) {
        setSaveStatus("Завершаем запись…");
        await finishRecording(editor.id);
      }
      const current = latestEditor.current;
      if (current) {
        const note = noteForEditorSave(current, editTags);
        const stored = store
          .getSnapshot()
          .notes.find((value) => value.id === current.id);
        if (
          shouldPersistNote(note, !!stored) &&
          (!stored ||
            editorContentKey(note) !== editorContentKey(editableNote(stored)))
        ) {
          autosave.current?.schedule(note);
        }
      }
      await autosave.current?.flush();
    } catch (error) {
      closing.current = false;
      notify(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить. Редактор остаётся открытым.",
      );
      return false;
    }
    const finish = () => {
      closing.current = false;
      if (editorMode === "compose") {
        writeNoteLocation(null);
        setText("");
        setDraftAttachments([]);
      } else {
        setSelected(null);
        setDetailExpanded(false);
      }
      setEditor(null);
      try {
        localStorage.removeItem(
          editorMode === "compose"
            ? "doompile-editor-draft"
            : `doompile-note-draft-${editor?.id}`,
        );
      } catch {}
      requestAnimationFrame(() =>
        input.current?.focus({ preventScroll: true }),
      );
    };
    if (editorMode === "note") {
      const animation = await animateDetailClose();
      if (
        latestEditor.current?.id !== editor?.id ||
        selectedRef.current !== editor?.id
      ) {
        animation?.cancel();
        closing.current = false;
        return false;
      }
      finish();
      return true;
    }
    const origin = composerOrigin.current;
    if (
      !origin ||
      !dock.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      finish();
      return true;
    }
    try {
      await dock.current.animate(
        [
          { clipPath: "inset(0px round 0px)" },
          {
            clipPath: `inset(${origin.top}px ${window.innerWidth - origin.right}px ${window.innerHeight - origin.bottom}px ${origin.left}px round 16px)`,
          },
        ],
        { duration: 240, easing: "cubic-bezier(.4,0,.2,1)" },
      ).finished;
    } catch {}
    finish();
    return true;
  }
  function resizeDetail(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  }
  function changeDetailWidth(value: number) {
    const width = Math.round(
      Math.max(280, Math.min(window.innerWidth - 540, value)),
    );
    setDetailWidth(width);
    try {
      localStorage.setItem("doompile-detail-width", String(width));
    } catch {}
  }
  useEffect(() => {
    if (!noteMenu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setNoteMenu(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setNoteMenu(null);
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>("button") || [],
        );
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[
          (i + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", key, true);
    const close = () => setNoteMenu(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [noteMenu]);
  function showNoteMenu(event: React.MouseEvent, note: Note) {
    event.preventDefault();
    event.stopPropagation();
    setNoteMenu({
      id: note.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 232)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 230)),
    });
  }
  async function pasteQuick(event: React.ClipboardEvent) {
    const files = clipboardFiles(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      void attachQuick(files);
      return;
    }
    const html = event.clipboardData.getData("text/html");
    if (/<img\b/i.test(html)) {
      event.preventDefault();
      try {
        const file = await clipboardImage(event.clipboardData);
        if (file) await attachQuick([file]);
        else
          notify(
            "Буфер содержит только адрес картинки. Скопируй само изображение или перетащи файл.",
          );
      } catch (e) {
        notify(e instanceof Error ? e.message : "Не удалось вставить картинку");
      }
      return;
    }
    if (
      /^\s*file:\/\//i.test(event.clipboardData.getData("text/plain")) ||
      isLocalImagePath(event.clipboardData.getData("text/plain"))
    ) {
      event.preventDefault();
      const image = await readClipboardImage();
      if (image) await attachQuick([image]);
      else
        notify(
          "Браузер получил только путь к файлу. Перетащи файл или выбери его через скрепку.",
        );
    }
  }
  useEffect(() => {
    if (draftReady)
      try {
        localStorage.setItem(
          "doompile-collapsed-sections",
          JSON.stringify(collapsed),
        );
      } catch {}
  }, [collapsed, draftReady]);
  function toggleSection(id: string) {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  }
  const notes = demo ? demoNotesCached() : state.notes;
  const allTags = [
    ...new Set([
      ...tagCatalog,
      ...notes.flatMap((n) => n.tags),
      ...(selectedTag ? [selectedTag] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b, "ru"));
  const activeNote = notes.find((n) => n.id === selected);
  useEffect(() => {
    if (editorMode === "compose" && editor) return;
    if (!activeNote) {
      if (editorMode === "note") {
        void autosave.current?.flush().catch(() => {});
        setEditor(null);
      }
      return;
    }
    if (editorMode === "note" && editor?.id === activeNote.id) {
      if (editorBusy || recording.draft?.target === editor.id) return;
      const saved = editableNote(activeNote);
      const savedContent = editorContentKey(saved);
      const currentContent = editorContentKey(
        editor,
        editTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      );
      // A clean cached document follows sync. Opening it must not queue an old
      // snapshot for autosave after the newer server revision has arrived.
      if (
        (editorBaseline.current?.id === editor.id &&
          editorBaseline.current.content === currentContent) ||
        savedContent === currentContent
      ) {
        editorBaseline.current = { id: saved.id, content: savedContent };
        if (savedContent !== currentContent)
          setEditorDocumentVersion((version) => version + 1);
        setEditor(saved);
        setEditTags(saved.tags.join(", "));
      }
      return;
    }
    let cancelled = false;
    void autosave
      .current!.flush()
      .then(() => {
        if (cancelled) return;
        let note = structuredClone(activeNote);
        let tags = note.tags.join(", ");
        try {
          const draft = JSON.parse(
            localStorage.getItem(`doompile-note-draft-${note.id}`) || "null",
          );
          if (draft?.note?.id === note.id) {
            note = reconcileFinishedRecordings(draft.note, activeNote);
            tags = draft.tags || "";
          }
        } catch {}
        const saved = editableNote(activeNote);
        editorBaseline.current = {
          id: saved.id,
          content: editorContentKey(saved),
        };
        setEditorMode("note");
        setEditor(editableNote(note));
        setEditTags(tags);
      })
      .catch(() =>
        notify(
          "Не удалось сохранить предыдущую заметку. Черновик остаётся на устройстве.",
        ),
      );
    return () => {
      cancelled = true;
    };
  }, [activeNote, composing]);
  const filtered = notes
    .filter(
      (n) =>
        (filter !== "urgent" || n.urgent) &&
        (filter !== "pinned" || n.pinned) &&
        (filter !== "media" ||
          ["video", "audio", "image", "file"].includes(n.kind) ||
          n.attachments.length > 0) &&
        (filter !== "tag" || n.tags.includes(selectedTag)),
    )
    .filter((n) =>
      `${n.title} ${n.plainText} ${n.source?.quote || ""} ${n.source?.articleText || ""} ${n.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    );
  const urgent = filtered.filter((n) => n.urgent);
  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(
      () =>
        track("search.performed", {
          query_length: query.length,
          results: filtered.length,
        }),
      800,
    );
    return () => clearTimeout(timer);
  }, [query, filtered.length]);
  const normal = filtered
    .filter((n) => !n.urgent)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || compareNoteCreation(a, b),
    );
  const title = query
    ? "Результаты поиска"
    : filter === "tag"
      ? selectedTag
      : (
          {
            all: "Вся твоя куча",
            urgent: "Важное",
            pinned: "Закреплённое",
            media: "Медиа",
          } as Record<string, string>
        )[filter];
  useEffect(() => {
    if (!editor) return;
    if (
      editorMode === "note" &&
      editorBaseline.current?.id === editor.id &&
      editorBaseline.current.content ===
        editorContentKey(
          editor,
          editTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        )
    )
      return;
    const note = noteForEditorSave(editor, editTags);
    try {
      localStorage.setItem(
        editorMode === "compose"
          ? "doompile-editor-draft"
          : `doompile-note-draft-${editor.id}`,
        JSON.stringify({ note, tags: editTags }),
      );
    } catch {}
    if (
      !editorBusy &&
      (shouldPersistNote(
        note,
        state.notes.some((n) => n.id === editor.id),
      ) ||
        recording.draft?.target === editor.id)
    ) {
      setSaveStatus("Сохраняем…");
      autosave.current?.schedule(note);
    }
  }, [editor, editTags, editorBusy, editorMode]);
  useEffect(() => {
    if (recording.error && !recording.draft) notify(recording.error);
  }, [recording.error]);
  useEffect(() => {
    void recordingSession.restore();
  }, []);
  useEffect(() => {
    if (composing && editor && recording.draft?.target === "quick")
      recordingSession.moveTo(editor.id);
  }, [composing, editor?.id, recording.draft?.target]);
  function recordingNote(target: string): Note {
    if (latestEditor.current?.id === target) return latestEditor.current;
    let note = store.getSnapshot().notes.find((note) => note.id === target);
    for (const key of [
      `doompile-note-draft-${target}`,
      "doompile-editor-draft",
    ]) {
      try {
        const saved = JSON.parse(localStorage.getItem(key) || "null");
        if (
          saved?.note?.id === target &&
          (!note || saved.note.updatedAt >= note.updatedAt)
        )
          note = note
            ? reconcileFinishedRecordings(saved.note, note)
            : saved.note;
      } catch {}
    }
    return note || createNote({ id: target, title: "Голосовая заметка" });
  }
  async function persistRecording(draft: RecordingDraft) {
    await store.initStore();
    if (
      findFinishedRecording(
        recordingNote(draft.target === "quick" ? draft.id : draft.target),
        draft.id,
      )
    )
      return;
    const file = new window.File(
      [draft.blob],
      `Голосовая заметка.${draft.mimeType.includes("mp4") ? "m4a" : "webm"}`,
      { type: draft.mimeType },
    );
    const attachment = await upload(file);
    const target =
      recordingSession.getSnapshot().draft?.id === draft.id
        ? recordingSession.getSnapshot().draft!.target
        : draft.target;
    if (target === "quick") {
      await store.saveNote(
        createNote({
          id: draft.id,
          title: "Голосовая заметка",
          kind: "audio",
          attachments: [attachment],
          body: {
            type: "doc",
            content: [
              {
                type: "attachment",
                attrs: { ...attachment, recordingId: draft.id },
              },
            ],
          },
          ...(filter === "tag" ? { tags: [selectedTag] } : {}),
        }),
      );
      setDemo(false);
      notify("Голосовая заметка отправлена");
    } else {
      await autosave.current?.flush();
      const note = recordingNote(target);
      const updated = {
        ...note,
        body: finishRecordingDocument(note.body, draft.id, attachment),
        attachments: [
          ...note.attachments.filter((item) => item.id !== attachment.id),
          attachment,
        ],
        updatedAt: new Date().toISOString(),
      };
      await autosave.current?.flush();
      localStorage.setItem(
        `doompile-note-draft-${target}`,
        JSON.stringify({ note: updated, tags: updated.tags.join(", ") }),
      );
      await store.saveNote(updated);
      if (latestEditor.current?.id === updated.id && editorAPI.current) {
        setEditor((current) =>
          current?.id === updated.id
            ? {
                ...current,
                attachments: [
                  ...current.attachments.filter(
                    (item) => item.id !== attachment.id,
                  ),
                  attachment,
                ],
              }
            : current,
        );
        editorAPI.current.completeRecording(draft.id, attachment);
      } else {
        setEditor((current) =>
          current?.id === updated.id
            ? {
                ...current,
                attachments: [
                  ...current.attachments.filter(
                    (item) => item.id !== attachment.id,
                  ),
                  attachment,
                ],
                body: finishRecordingDocument(
                  current.body,
                  draft.id,
                  attachment,
                ),
              }
            : current,
        );
      }
    }
  }
  useEffect(() => {
    if (recording.status !== "ready" || recording.error) return;
    void recordingSession.deliver(persistRecording);
  }, [recording.status, recording.error]);
  async function finishRecording(target: string) {
    if (recordingSession.getSnapshot().draft?.target !== target) return;
    await recordingSession.finish(target);
    await recordingSession.deliver(persistRecording);
    const result = recordingSession.getSnapshot();
    if (result.draft?.target === target)
      throw new Error(
        result.error || "Не удалось завершить запись. Повтори сохранение.",
      );
  }
  function notify(message: string) {
    setUndoNote(null);
    setToast(message);
  }
  function navigate(next: Filter, tag = "") {
    track("screen.viewed", {
      screen: "feed",
      filter: next === "media" ? "files" : next,
    });
    setFilter(next);
    setSelectedTag(tag);
    setQuery("");
    setSidebar(false);
    setSelected(null);
  }
  async function update(note: Note, patch: Partial<Note>) {
    if (demo) {
      notify(
        "Это пример. Переключись на свою коллекцию, чтобы менять заметки.",
      );
      return;
    }
    if (
      editorMode === "note" &&
      editor?.id === note.id &&
      (patch.pinned !== undefined || patch.urgent !== undefined)
    ) {
      setEditor((current) =>
        current?.id === note.id ? { ...current, ...patch } : current,
      );
      return;
    }
    try {
      if (patch.deletedAt) await autosave.current?.flush();
      await store.saveNote({
        ...note,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      notify("Не удалось сохранить. Текст остаётся в редакторе.");
    }
  }
  async function send() {
    const recordingState = recordingSession.getSnapshot();
    const activeRecording = recordingState.draft;
    const ownsRecording = activeRecording?.target === "quick";
    if (ownsRecording && recordingState.status === "uploading") return;
    if (
      (!text.trim() && !draftAttachments.length && !ownsRecording) ||
      sending ||
      uploading
    )
      return;
    setSending(true);
    try {
      const note = createNote({
        ...(ownsRecording ? { id: activeRecording.id } : {}),
        plainText: text.trim(),
        title:
          text.trim().split("\n")[0].slice(0, NOTE_LIMITS.generatedTitle) ||
          draftAttachments[0]?.name ||
          (ownsRecording ? "Голосовая заметка" : ""),
        attachments: draftAttachments,
        kind: draftAttachments[0]
          ? draftAttachments[0].mimeType.startsWith("image/")
            ? "image"
            : draftAttachments[0].mimeType.startsWith("audio/")
              ? "audio"
              : draftAttachments[0].mimeType.startsWith("video/")
                ? "video"
                : "file"
          : ownsRecording
            ? "audio"
            : "note",
        body: {
          type: "doc",
          content: [
            ...(textToDocument(text.trim()).content || []),
            ...draftAttachments.map((a) =>
              a.mimeType.startsWith("image/")
                ? { type: "image", attrs: { src: a.url, alt: a.name } }
                : {
                    type: "attachment",
                    attrs: { url: a.url, name: a.name, mimeType: a.mimeType },
                  },
            ),
          ],
        },
        ...(filter === "tag" ? { tags: [selectedTag] } : {}),
      });
      await store.saveNote(note);
      setText("");
      setDraftAttachments([]);
      setDemo(false);
      setFilter("all");
      if (ownsRecording) {
        recordingSession.moveTo(note.id);
        await finishRecording(note.id);
      }
      notify(uiCopy.saved);
      input.current?.focus({ preventScroll: true });
    } catch {
      notify("Не удалось сохранить. Попробуй ещё раз.");
    } finally {
      setSending(false);
    }
  }
  function openEditor(note?: Note, kind?: "checklist") {
    if (note) {
      setSelected(note.id);
      setEditorMode("note");
      return;
    }
    if (editorMode === "note") void autosave.current?.flush().catch(() => {});
    setSelected(null);
    setEditorMode("compose");
    const bounds = dock.current?.getBoundingClientRect();
    composerOrigin.current = bounds?.height
      ? bounds
      : new DOMRect(14, window.innerHeight - 64, window.innerWidth - 28, 52);
    setDetailExpanded(false);
    if (!note && !kind) {
      try {
        const draft = JSON.parse(
          localStorage.getItem("doompile-editor-draft") || "null",
        );
        if (
          draft?.note?.id &&
          (draft.note.plainText === text ||
            (!text.trim() && !draftAttachments.length))
        ) {
          setEditor({
            ...reconcileFinishedRecordings(
              draft.note,
              store
                .getSnapshot()
                .notes.find((note) => note.id === draft.note.id) || draft.note,
            ),
            body: prepareDocument(
              reconcileFinishedRecordings(
                draft.note,
                store
                  .getSnapshot()
                  .notes.find((note) => note.id === draft.note.id) ||
                  draft.note,
              ).body,
              draft.note.title,
              draft.note.source,
            ) as DocumentNode,
          });
          writeNoteLocation(draft.note.id);
          setEditTags(draft.tags || "");
          setEditorBusy(false);
          notify("Черновик восстановлен");
          return;
        }
      } catch {}
    }
    const created = createNote({
      plainText: text,
      ...(filter === "tag" ? { tags: [selectedTag] } : {}),
      ...(kind === "checklist"
        ? {
            body: {
              type: "doc",
              content: [
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: false },
                      content: [{ type: "paragraph" }],
                    },
                  ],
                },
              ],
            },
          }
        : {}),
    });
    setEditor(created);
    writeNoteLocation(created.id);
    setEditTags(filter === "tag" ? selectedTag : "");
    if (!note && draftAttachments.length)
      setEditor((current) =>
        current
          ? {
              ...current,
              attachments: [...current.attachments, ...draftAttachments],
              body: {
                ...current.body,
                content: [
                  ...(current.body.content || []),
                  ...draftAttachments.map((a) =>
                    a.mimeType.startsWith("image/")
                      ? { type: "image", attrs: { src: a.url, alt: a.name } }
                      : {
                          type: "attachment",
                          attrs: {
                            url: a.url,
                            name: a.name,
                            mimeType: a.mimeType,
                          },
                        },
                  ),
                ],
              },
            }
          : current,
      );
    setEditorBusy(false);
  }
  async function upload(file: File): Promise<Attachment> {
    if (!navigator.onLine)
      throw new Error(
        "Для вложения нужно соединение. Текст можно сохранить офлайн.",
      );
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/attachments", { method: "POST", body: form });
    if (!r.ok)
      throw new Error(
        r.status === 401
          ? "Подключи хранилище в настройках."
          : "Не удалось загрузить вложение.",
      );
    return (await r.json()).attachment;
  }
  async function attachQuick(files: File[]) {
    setUploading((count) => count + 1);
    try {
      for (const file of files) {
        const attachment = await upload(file);
        if (latestComposer.current) {
          const id = latestComposer.current.id;
          if (editorAPI.current) {
            setEditor((current) =>
              current?.id === id
                ? {
                    ...current,
                    attachments: [...current.attachments, attachment],
                  }
                : current,
            );
            editorAPI.current.insertAttachment(attachment);
          } else {
            setEditor((current) =>
              current?.id === id
                ? {
                    ...current,
                    attachments: [...current.attachments, attachment],
                    body: {
                      ...current.body,
                      content: [
                        ...(current.body.content || []),
                        attachment.mimeType.startsWith("image/")
                          ? {
                              type: "image",
                              attrs: {
                                src: attachment.url,
                                alt: attachment.name,
                              },
                            }
                          : { type: "attachment", attrs: { ...attachment } },
                        { type: "paragraph" },
                      ],
                    },
                  }
                : current,
            );
          }
        } else setDraftAttachments((current) => [...current, attachment]);
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось загрузить файл",
      );
    } finally {
      setUploading((count) => count - 1);
    }
  }
  useEffect(
    () =>
      installFileDrop(
        window,
        (files) => {
          void attachQuick(files);
        },
        setDropActive,
        {
          accept: (target) =>
            target instanceof Element &&
            !!target.closest('[data-file-drop-zone="quick"]'),
        },
      ),
    [],
  );
  const nav = [
    {
      id: "all" as Filter,
      icon: Layers,
      label: "Все заметки",
      count: notes.length,
    },
    {
      id: "urgent" as Filter,
      icon: Flame,
      label: "Важное",
      count: notes.filter((n) => n.urgent).length,
    },
    {
      id: "pinned" as Filter,
      icon: Pin,
      label: "Закреплённое",
      count: notes.filter((n) => n.pinned).length,
    },
    {
      id: "media" as Filter,
      icon: ImageIcon,
      label: "Медиа",
      count: notes.filter(
        (n) =>
          (n.kind !== "note" && n.kind !== "article") || n.attachments.length,
      ).length,
    },
  ];
  const editorSurface = editor && (
    <NoteEditorSurface
      mobile={isMobile}
      note={editor}
      documentVersion={editorDocumentVersion}
      apiRef={editorAPI}
      onCopyLink={() => void copyNoteLink(editor.id)}
      notes={state.notes.filter((note) => note.id !== editor.id)}
      tags={editTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)}
      availableTags={allTags}
      status={composing && uploading > 0 ? "Загружаем вложения…" : saveStatus}
      busy={editorBusy || (composing && uploading > 0)}
      existing={editorMode === "note"}
      expanded={detailExpanded}
      onClose={() => {
        void closeEditor();
      }}
      onExpand={() => setDetailExpanded((value) => !value)}
      onDelete={() => {
        if (demo || editorBusy) return;
        void (async () => {
          try {
            await autosave.current?.flush();
            const current =
              store.getSnapshot().notes.find((note) => note.id === editor.id) ||
              editor;
            await store.saveNote({
              ...current,
              deletedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            localStorage.removeItem(`doompile-note-draft-${editor.id}`);
            setEditor(null);
            setSelected(null);
            setDetailExpanded(false);
            notify("Заметка удалена");
            setUndoNote(current);
          } catch {
            notify("Не удалось удалить заметку. Попробуй ещё раз.");
          }
        })();
      }}
      onChange={(patch) =>
        setEditor((current) => {
          if (current?.id !== editor.id) return current;
          const updated = { ...current, ...patch };
          if (patch.body) {
            const urls = documentMediaURLs(patch.body);
            updated.attachments = current.attachments.filter((file) =>
              urls.has(file.url),
            );
          }
          return updated;
        })
      }
      onTags={(tags) => {
        setEditTags(tags.join(", "));
        const catalog = [...new Set([...tagCatalog, ...tags])];
        setTagCatalog(catalog);
        try {
          localStorage.setItem("doompile-tag-catalog", JSON.stringify(catalog));
        } catch {}
      }}
      onBusy={setEditorBusy}
      onReference={(id) => {
        void closeEditor().then((closed) => {
          if (closed) setSelected(id);
        });
      }}
      onAttachment={async (file) => {
        const id = editor.id;
        const attachment = await upload(file);
        setEditor((current) =>
          current?.id === id
            ? { ...current, attachments: [...current.attachments, attachment] }
            : current,
        );
        return attachment;
      }}
    />
  );
  return (
    <div
      ref={mobileSidebar.shell}
      className={`app-shell ${activeNote ? "has-detail" : ""} ${detailExpanded && activeNote ? "detail-expanded" : ""} ${composing ? "composing" : ""} ${resizing ? "is-resizing" : ""}`}
      style={{ "--detail-width": `${detailWidth}px` } as CSSProperties}
      data-sidebar-open={sidebar}
    >
      <button
        className="sidebar-scrim"
        aria-label="Закрыть навигацию"
        aria-hidden={!sidebar}
        tabIndex={sidebar ? 0 : -1}
        onClick={() => setSidebar(false)}
      />
      <aside
        ref={mobileSidebar.panel}
        className={`sidebar ${sidebar ? "open" : ""}`}
        aria-label="Навигация"
        inert={composing || editorBusy || (isMobile && !sidebar)}
      >
        <div className="brand">
          <div className="wordmark">
            <Wordmark />
            <Halo className="brand-halo" />
          </div>
          <button
            className="icon-button sidebar-close"
            aria-label="Закрыть меню"
            onClick={() => setSidebar(false)}
          >
            <X size={20} />
          </button>
          <p>{brandCopy.motto}</p>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={uiCopy.searchPlaceholder}
            aria-label="Поиск заметок"
          />
          <kbd>⌘ K</kbd>
        </label>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${filter === item.id && !query ? "selected" : ""} ${item.id === "urgent" ? "urgent-nav" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "urgent" && item.count > 0 && (
                <i className="red-dot" />
              )}
              <span className="nav-count">{item.count}</span>
            </button>
          ))}
        </nav>
        <div className="tags-heading">
          <span>ТЕГИ</span>
          <button
            className="icon-button"
            title="Новый тег"
            aria-label="Новый тег"
            onClick={() => setTagCreate(true)}
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="tags">
          {allTags.length ? (
            allTags.map((tag, i) => (
              <button
                key={tag}
                className={`nav-item ${filter === "tag" && selectedTag === tag ? "selected" : ""}`}
                onClick={() => navigate("tag", tag)}
              >
                <Tag
                  size={17}
                  style={{
                    color: [
                      "#8a77c7",
                      "#bf8e4b",
                      "#648f7a",
                      "#b16e75",
                      "#5e8fb9",
                    ][i % 5],
                  }}
                />
                <span>{tag}</span>
                <span className="nav-count">
                  {notes.filter((n) => n.tags.includes(tag)).length}
                </span>
              </button>
            ))
          ) : (
            <button className="empty-tags" onClick={() => setTagCreate(true)}>
              <Tag size={19} />
              <span>
                Места для всего.
                <br />У заметки может быть несколько тегов.
              </span>
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="cat-card">
            <PileCat />
            <div>
              <strong>{brandCopy.cat}</strong>
              <p>{brandCopy.aside}</p>
            </div>
          </div>
          <button
            className="nav-item settings-link"
            aria-label="Настройки"
            onClick={() => setSettings(true)}
          >
            <Settings size={17} />
            <span>Настройки</span>
            <span className="version">v0.1</span>
          </button>
        </div>
      </aside>
      <main className="main-column" inert={isMobile && sidebar}>
        {selected && !activeNote && (
          <div className="note-link-status" role="status">
            <span>
              {state.status === "locked"
                ? "Подключи хранилище, чтобы открыть эту заметку."
                : !state.ready ||
                    ["connecting", "syncing"].includes(state.status)
                  ? "Открываем заметку…"
                  : state.status === "offline"
                    ? "Этой заметки ещё нет на устройстве. Подключись к сети и повтори."
                    : state.status === "error"
                      ? "Не удалось получить заметку. Проверь подключение к хранилищу."
                      : "Заметка не найдена или удалена."}
            </span>
            <button
              type="button"
              className="quiet-button"
              onClick={() =>
                state.status === "locked"
                  ? setSettings(true)
                  : void store.sync()
              }
            >
              {state.status === "locked" ? "Подключить" : "Повторить"}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Закрыть ссылку на заметку"
              onClick={() => setSelected(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div
          className="main-scroll"
          inert={composing || editorBusy}
          onTouchStart={() => {
            const el = document.activeElement;
            if (el === input.current) (el as HTMLElement).blur();
          }}
        >
          <div className="mobile-tools">
            <button
              className="icon-button"
              aria-label="Открыть меню"
              onClick={() => setSidebar(true)}
            >
              <PanelLeft size={20} />
            </button>
          </div>
          {(query || filter !== "all") && (
            <div className="feed-label">
              {title}
              {query && (
                <button
                  className="icon-button"
                  aria-label="Очистить поиск"
                  onClick={() => setQuery("")}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          )}
          {demo && (
            <div className="demo-banner">
              <span>Пример коллекции. Твои заметки сохраняются отдельно.</span>
              <button
                onClick={() => {
                  setDemo(false);
                  setSelected(null);
                }}
              >
                Моя коллекция <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          {urgent.length > 0 && (
            <section className="urgent-section">
              <h2 className="section-heading">
                <button
                  type="button"
                  className="feed-section-toggle"
                  aria-expanded={!collapsed.urgent}
                  aria-controls="urgent-notes"
                  onClick={() => toggleSection("urgent")}
                >
                  <ChevronRight
                    size={13}
                    className={!collapsed.urgent ? "is-open" : ""}
                  />
                  <Flame size={14} />
                  <span>Важно</span>
                  <b>{urgent.length}</b>
                </button>
              </h2>
              {!collapsed.urgent && (
                <div id="urgent-notes" className="urgent-stack">
                  {urgent.map((n) => (
                    <MobileNoteRow
                      bareDesktop
                      mobile={isMobile}
                      key={n.id}
                      id={n.id}
                      openId={openSwipe}
                      onOpen={setOpenSwipe}
                      pinned={n.pinned}
                      urgent={n.urgent}
                      onPin={() => void update(n, { pinned: !n.pinned })}
                      onUrgent={() => void update(n, { urgent: !n.urgent })}
                      onDelete={() => {
                        void update(n, { deletedAt: new Date().toISOString() });
                        notify("Заметка удалена");
                        setUndoNote(n);
                      }}
                    >
                      {" "}
                      <div
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (
                            e.target === e.currentTarget &&
                            (e.key === "Enter" || e.key === " ")
                          ) {
                            e.preventDefault();
                            setSelected(n.id);
                          }
                        }}
                        onContextMenu={(e) => showNoteMenu(e, n)}
                        className={`urgent-card ${selected === n.id ? "selected" : ""}`}
                        key={n.id}
                        onClick={() => setSelected(n.id)}
                      >
                        <div className="urgent-card-top">
                          <Flame size={17} />
                          <span>ВАЖНОЕ</span>
                          <ArrowUpRight size={15} />
                        </div>
                        <strong>
                          <LinkedText text={n.title} />
                        </strong>
                        <p>
                          {n.plainText === n.title
                            ? "Не потерять из виду."
                            : n.plainText.replace(n.title, "").trim() ||
                              "Не потерять из виду."}
                        </p>
                        <span className="urgent-card-bottom">
                          {n.tags[0] || "В твоей куче"}
                          <button
                            type="button"
                            className="urgent-unpin"
                            title="Убрать из важного"
                            aria-label={`Убрать из важного ${n.title}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void update(n, { urgent: false });
                            }}
                          >
                            <Flame size={13} />
                          </button>
                        </span>
                      </div>
                    </MobileNoteRow>
                  ))}
                </div>
              )}
            </section>
          )}
          {notes.length === 0 && !query && filter === "all" ? (
            <div className="welcome">
              <div className="mobile-welcome">
                <BrandIllustration kind="void" />
                <h2>{brandCopy.motto}</h2>
                <p>{uiCopy.emptyBody}</p>
              </div>
              <div className="welcome-art">
                <BrandIllustration kind="void" />
              </div>
              <span className="eyebrow">{brandCopy.empty}</span>
              <h2>{brandCopy.motto}</h2>
              <p>{uiCopy.emptyBody}</p>
              <div className="welcome-actions">
                <button
                  className="lime-button"
                  onClick={() => input.current?.focus({ preventScroll: true })}
                >
                  <Plus size={17} />
                  Сохранить первую находку
                </button>
                <button
                  className="quiet-button"
                  onClick={() => {
                    setDemo(true);
                    setSelected(null);
                  }}
                >
                  Посмотреть пример <ArrowUpRight size={15} />
                </button>
              </div>
              <div className="capture-hints">
                <button onClick={() => openEditor(undefined, "checklist")}>
                  <ListChecks size={20} />
                  <strong>Составить список</strong>
                  <span>Планы без лишних планов</span>
                </button>
                <button onClick={() => setHelp(true)}>
                  <Link2 size={20} />
                  <strong>Сохранить фрагмент</strong>
                  <span>Текст + твоя мысль</span>
                </button>
                <button
                  onClick={() => {
                    openEditor();
                    setToast("В редакторе нажми «Голос», чтобы начать запись");
                  }}
                >
                  <Mic size={20} />
                  <strong>Наговорить мысль</strong>
                  <span>Когда проще сказать</span>
                </button>
              </div>
            </div>
          ) : normal.length > 0 ? (
            <div className="notes-list">
              {groupFeed(normal).map((group) => (
                <section key={group.id} className="feed-section">
                  <h2 className="date-divider">
                    <button
                      type="button"
                      className="feed-section-toggle"
                      aria-expanded={!collapsed[group.id]}
                      aria-controls={`section-${group.id}`}
                      onClick={() => toggleSection(group.id)}
                    >
                      <ChevronRight
                        size={13}
                        className={!collapsed[group.id] ? "is-open" : ""}
                      />
                      {group.id === "pinned" && <Pin size={12} />}
                      <span>
                        {group.id === "pinned"
                          ? "Закреплено"
                          : dateLabel(group.notes[0].createdAt)}
                      </span>
                      <b>{group.notes.length}</b>
                    </button>
                  </h2>
                  {!collapsed[group.id] && (
                    <div id={`section-${group.id}`}>
                      {group.notes.map((n) => {
                        const links = [
                          ...new Set([
                            ...(n.source ? [n.source.url] : []),
                            ...splitLinks(n.plainText).flatMap((part) =>
                              part.href ? [part.href] : [],
                            ),
                          ]),
                        ].slice(0, 3);
                        return (
                          <MobileNoteRow
                            mobile={isMobile}
                            key={n.id}
                            id={n.id}
                            openId={openSwipe}
                            onOpen={setOpenSwipe}
                            pinned={n.pinned}
                            urgent={n.urgent}
                            onPin={() => void update(n, { pinned: !n.pinned })}
                            onUrgent={() =>
                              void update(n, { urgent: !n.urgent })
                            }
                            onDelete={() => {
                              void update(n, {
                                deletedAt: new Date().toISOString(),
                              });
                              notify("Заметка удалена");
                              setUndoNote(n);
                            }}
                          >
                            <article
                              onContextMenu={(e) => showNoteMenu(e, n)}
                              className={`note-row ${n.kind === "note" ? "text-note" : ""} ${selected === n.id ? "active" : ""}`}
                            >
                              <div
                                role="button"
                                tabIndex={0}
                                className="note-main"
                                onClick={() => setSelected(n.id)}
                                onKeyDown={(e) => {
                                  if (
                                    e.target === e.currentTarget &&
                                    (e.key === "Enter" || e.key === " ")
                                  ) {
                                    e.preventDefault();
                                    setSelected(n.id);
                                  }
                                }}
                              >
                                <div className="note-copy">
                                  <div className="note-meta">
                                    <span>
                                      {n.source ? (
                                        <a
                                          className="snippet-link"
                                          href={sourceLink(n.source)}
                                          target="_blank"
                                          rel="noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {sourceName(n)}
                                        </a>
                                      ) : (
                                        sourceName(n)
                                      )}
                                    </span>
                                    <span>·</span>
                                    <span>{time(n.createdAt)}</span>
                                    {n.pinned && <Pin size={11} />}
                                  </div>
                                  {!n.source &&
                                    !n.attachments.length &&
                                    n.title !== n.plainText.split("\n")[0] && (
                                      <h3>{n.title || "Без названия"}</h3>
                                    )}
                                  {n.source && (
                                    <SourceSnippet source={n.source} />
                                  )}
                                  {n.plainText && (
                                    <NoteExcerpt
                                      comment={!!n.source}
                                      text={n.plainText}
                                    />
                                  )}
                                  {(n.attachments.length > 0 ||
                                    links.length > 0) && (
                                    <div className="snippet-attachments">
                                      {n.attachments.map((attachment) => (
                                        <AttachmentPreview
                                          key={attachment.id}
                                          attachment={attachment}
                                        />
                                      ))}
                                      {links.map((url) => (
                                        <LinkPreview
                                          key={url}
                                          url={url}
                                          href={
                                            n.source?.url === url
                                              ? sourceLink(n.source)
                                              : undefined
                                          }
                                        />
                                      ))}
                                    </div>
                                  )}
                                  {n.attachments.length > 0 && (
                                    <div className="attachment-note-open" aria-label="Открыть заметку">
                                      <span>{time(n.createdAt)}</span>
                                    </div>
                                  )}
                                  {n.tags.length > 0 && (
                                    <div className="note-tags">
                                      {n.tags.map((t) => (
                                        <span key={t}># {t}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <time className="row-time">
                                {time(n.createdAt)}
                              </time>
                              <button
                                className="icon-button row-more"
                                aria-label={`Меню заметки ${n.title}`}
                                aria-haspopup="menu"
                                aria-expanded={noteMenu?.id === n.id}
                                onClick={(e) => showNoteMenu(e, n)}
                              >
                                <MoreHorizontal size={19} />
                              </button>
                            </article>
                          </MobileNoteRow>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            !(urgent.length > 0) && (
              <div className="no-results">
                <Search size={30} />
                <h2>{query ? "Мысль пока не нашлась" : "Здесь пока тихо"}</h2>
                <p>
                  {query
                    ? "Попробуй другие слова или название тега."
                    : "Добавляй заметки или отмечай их — они появятся здесь."}
                </p>
              </div>
            )
          )}
          {notes.length > 0 && (
            <div className="list-end">
              <Halo />
              <span>Всё на месте. Даже если не по полочкам.</span>
            </div>
          )}
        </div>
        <div
          ref={dock}
          className={`composer-dock ${composing ? "composer-expanded" : ""}`}
        >
          {composing ? (
            editorSurface
          ) : (
            <>
              <QuickComposer
                recording={recording}
                editorId={editor?.id}
                dropActive={dropActive}
                draftAttachments={draftAttachments}
                setDraftAttachments={setDraftAttachments}
                uploading={uploading}
                text={text}
                setText={setText}
                sending={sending}
                input={input}
                fileInput={fileInput}
                send={send}
                openEditor={openEditor}
                pasteQuick={pasteQuick}
                attachQuick={attachQuick}
                setSelected={setSelected}
              />
            </>
          )}
        </div>
      </main>
      {activeNote && (
        <aside
          ref={detailPane}
          className="detail-pane"
          aria-label="Просмотр заметки"
        >
          <div
            className="detail-resizer"
            role="separator"
            aria-label="Ширина заметки"
            aria-orientation="vertical"
            aria-valuemin={280}
            aria-valuemax={1200}
            aria-valuenow={detailWidth}
            tabIndex={0}
            onPointerDown={resizeDetail}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                changeDetailWidth(
                  (e.currentTarget.parentElement?.parentElement?.getBoundingClientRect()
                    .right || window.innerWidth) - e.clientX,
                );
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              setResizing(false);
            }}
            onPointerCancel={() => setResizing(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                changeDetailWidth(
                  detailWidth + (e.key === "ArrowLeft" ? 24 : -24),
                );
              }
            }}
          />

          {editorMode === "note" && editor?.id === activeNote.id ? (
            editorSurface
          ) : (
            <div className="editor-loading">Открываем редактор…</div>
          )}
        </aside>
      )}
      {noteMenu &&
        (() => {
          const note = notes.find((n) => n.id === noteMenu.id);
          if (!note) return null;
          const action = (run: () => void) => {
            setNoteMenu(null);
            run();
          };
          return (
            <div
              ref={menuRef}
              role="menu"
              aria-label="Действия с заметкой"
              className="note-context-menu"
              style={{ left: noteMenu.x, top: noteMenu.y }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button
                role="menuitem"
                onClick={() => action(() => void copyNoteLink(note.id))}
              >
                <Link2 size={15} />
                Скопировать ссылку
              </button>
              <button
                role="menuitem"
                onClick={() =>
                  action(() => {
                    void update(note, { pinned: !note.pinned });
                  })
                }
              >
                <Pin size={15} />
                {note.pinned ? "Открепить" : "Закрепить"}
              </button>
              <button
                role="menuitem"
                onClick={() =>
                  action(() => {
                    void update(note, { urgent: !note.urgent });
                  })
                }
              >
                <Flame size={15} />
                {note.urgent ? "Убрать из важного" : "Сделать важной"}
              </button>
              <button
                role="menuitem"
                className="danger-button"
                onClick={() =>
                  action(() => {
                    void update(note, { deletedAt: new Date().toISOString() });
                    if (selected === note.id) setSelected(null);
                    notify("Заметка удалена");
                    setUndoNote(note);
                  })
                }
              >
                <Trash2 size={15} />
                Удалить
              </button>
            </div>
          );
        })()}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          {undoNote && (
            <button
              className="toast-undo"
              onClick={() => {
                void update(undoNote, { deletedAt: null });
                notify("Заметка восстановлена");
              }}
            >
              Отменить
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Скрыть уведомление"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {settings && (
        <SettingsDialog
          state={state}
          theme={theme}
          setTheme={setTheme}
          onClose={() => setSettings(false)}
          onHelp={() => setHelp(true)}
          notify={notify}
        />
      )}
      {help && (
        <Modal
          label="Web Clipper"
          className="settings-modal"
          onClose={() => setHelp(false)}
        >
          <div className="modal-top">
            <h2>Сохрани в контексте.</h2>
            <button
              className="icon-button"
              aria-label="Закрыть"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
          </div>
          <div className="settings-content clipper-help">
            <div className="clipper-help-icon">
              <Link2 size={30} />
              <Halo />
            </div>
            <h3>Выдели то, что зацепило.</h3>
            <p>
              В браузере на компьютере: выдели текст → правый клик → «Save to
              Doompile». Добавь свою мысль и сохрани.
            </p>
            <p>
              На iPhone в Safari: выдели текст и открой Doompile в меню
              расширений. Из YouTube и других приложений — «Поделиться» →
              Doompile.
            </p>
            <p className="muted">
              Для этого нужно установить приложение или расширение и подключить
              его к тому же хранилищу. Если YouTube не передал таймкод, его
              можно добавить вручную.
            </p>
            <a
              className="quiet-button outlined"
              href="https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension"
              target="_blank"
              rel="noreferrer"
            >
              Как включить Safari Extension <ArrowUpRight size={15} />
            </a>
          </div>
        </Modal>
      )}
      {tagCreate && (
        <Modal
          label="Новый тег"
          className="tag-modal"
          onClose={() => setTagCreate(false)}
        >
          <div className="modal-top">
            <h2>Новый тег</h2>
            <button
              className="icon-button"
              aria-label="Закрыть"
              onClick={() => setTagCreate(false)}
            >
              <X size={19} />
            </button>
          </div>
          <form
            className="settings-content"
            onSubmit={(e) => {
              e.preventDefault();
              const tag = newTag.trim();
              if (!tag) return;
              setNewTag("");
              setTagCreate(false);
              navigate("tag", tag);
              const catalog = [...new Set([...tagCatalog, tag])];
              setTagCatalog(catalog);
              try {
                localStorage.setItem(
                  "doompile-tag-catalog",
                  JSON.stringify(catalog),
                );
              } catch {
                notify("Не удалось сохранить каталог тегов на устройстве");
              }
            }}
          >
            <p className="muted">
              Одна мысль может быть отмечена несколькими тегами.
            </p>
            <input
              value={newTag}
              maxLength={100}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Например, Идеи"
              aria-label="Название тега"
              autoFocus
              required
            />
            <button className="lime-button">
              <Plus size={16} />
              Создать тег
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
