import { NOTE_LIMITS, type Note } from "@doompile/core";
export type LocalRecord = { note: Note; baseRevision: number; dirty: boolean };
// The editor can still hold the revision it opened while our preceding save is
// acknowledged. Rebase only this writer's edits; a different device/tab must
// still conflict when it edits an older version.
export function localEdit(
  current: (LocalRecord & { writer?: string }) | undefined,
  note: Note,
  writer: string,
): LocalRecord {
  const baseRevision =
    current && (current.dirty || current.writer === writer)
      ? current.baseRevision
      : note.revision;
  return {
    note: { ...note, revision: baseRevision },
    baseRevision,
    dirty: true,
  };
}
// A server acknowledgement must never overwrite typing that happened during the request.
export function acknowledge(
  current: LocalRecord,
  sent: Note,
  saved: Note,
): LocalRecord {
  if (JSON.stringify(current.note) === JSON.stringify(sent))
    return { note: saved, baseRevision: saved.revision, dirty: false };
  return {
    note: { ...current.note, revision: saved.revision },
    baseRevision: saved.revision,
    dirty: true,
  };
}
export function conflictCopy(note: Note, id: string, now: string): LocalRecord {
  return {
    note: {
      ...note,
      id,
      revision: 0,
      title: `${(note.title || "Без названия").slice(0, NOTE_LIMITS.generatedTitle)} · копия с другого устройства`,
      createdAt: now,
      updatedAt: now,
    },
    baseRevision: 0,
    dirty: true,
  };
}
