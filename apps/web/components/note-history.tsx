"use client";
import { useEffect, useState } from "react";
import type { Note } from "@doompile/core";
import type { VersionInfo } from "../../../packages/sync/changes";
import { accountFetch } from "@/lib/client/account";
import * as store from "@/lib/client/store";
import Modal from "./modal";
import RichEditor from "./rich-editor";
import { X } from "../../../packages/design/ui-icons";
const platform: Record<string, string> = { web: "Веб", ios: "iPhone", macos: "Mac", migration: "Начальная версия", clipper: "Расширение", recovery: "Синхронизация" };
async function json(url: string, init?: RequestInit) {
  const response = await accountFetch(url, { ...init, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "Войди в аккаунт, чтобы открыть историю." : "Не удалось загрузить историю. Проверь соединение и повтори.");
  return response.json();
}
export default function NoteHistory({ noteID, onClose, onRestored }: { noteID: string; onClose: () => void; onRestored: (note: Note) => void }) {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [selected, setSelected] = useState<number>();
  const [preview, setPreview] = useState<Note>();
  const [authored, setAuthored] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [more, setMore] = useState(false);
  const endpoint = `/api/notes/${noteID}/versions`;
  async function load(before?: number) {
    setLoading(true); setError("");
    try {
      const { versions: rows } = await json(endpoint + (before !== undefined ? `?before=${before}` : "")) as { versions: VersionInfo[] };
      setVersions(current => before !== undefined ? [...current, ...rows] : rows); setMore(rows.length === 30);
      if (before === undefined) setSelected(rows[0]?.revision);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [noteID]);
  useEffect(() => {
    if (selected === undefined) return;
    let cancelled = false; setPreview(undefined); setError("");
    void json(`${endpoint}/${selected}${authored ? "?view=authored" : ""}`).then(({ note }) => { if (!cancelled) setPreview(note); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [selected, authored, endpoint]);
  async function restore() {
    if (selected === undefined || restoring) return;
    setRestoring(true); setError("");
    try {
      await store.prepareHistory(noteID);
      const { note } = await json(`${endpoint}/${selected}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view: authored ? "authored" : "merged", origin: "web" }) });
      await store.receiveNotes([note]); onRestored(note); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setRestoring(false); }
  }
  return <Modal label="История версий" className="note-history" onClose={() => { if (!restoring) onClose(); }}>
    <header className="history-header"><div><h2>История версий</h2><p className="muted">Восстановление сохранит текущую версию в истории.</p></div><button type="button" className="icon-button" aria-label="Закрыть историю" onClick={onClose} disabled={restoring}><X size={20}/></button></header>
    {error && <div className="history-feedback" role="alert">{error}<button type="button" onClick={() => void load()}>Повторить</button></div>}
    <div className="history-content">
      <nav aria-label="Сохранённые версии" className="history-versions">
        {versions.map(version => <button type="button" key={version.revision} aria-pressed={selected === version.revision} disabled={restoring} onClick={() => setSelected(version.revision)}><strong>{new Date(version.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</strong><span>{version.kind === "restore" ? "Восстановление" : platform[version.origin] ?? "Сохранение"} · {version.revision}</span></button>)}
        {loading && <p role="status">Загружаем…</p>}
        {!loading && !versions.length && !error && <p className="muted">История появится после синхронизации заметки.</p>}
        {more && <button type="button" disabled={loading || restoring} onClick={() => void load(versions.at(-1)?.revision)}>Более ранние версии</button>}
      </nav>
      <div className="history-preview">
        {selected !== undefined && <label className="history-authored"><input type="checkbox" checked={authored} disabled={restoring} onChange={event => setAuthored(event.target.checked)}/>Сохранённый вариант устройства</label>}
        {preview ? <RichEditor key={`${selected}:${authored}`} noteId={noteID} recordingTarget="history" value={preview.body} attachments={preview.attachments} readOnly onChange={() => {}} notes={[]} onAttachment={async () => { throw new Error("Просмотр версии"); }}/> : selected !== undefined && !error ? <p role="status">Открываем версию…</p> : null}
      </div>
    </div>
    <footer className="history-footer"><span className="muted">Одна заметка · все сохранённые изменения</span><button type="button" className="primary-button" disabled={!preview || restoring} onClick={() => void restore()}>{restoring ? "Восстанавливаем…" : "Восстановить версию"}</button></footer>
  </Modal>;
}
