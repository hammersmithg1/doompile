import * as Y from "yjs";
import type { Note } from "../core/src/index";
import { capture, combine, type NoteChange, type ChangeOrigin } from "./changes";
import { delta, authoredSnapshot, sameState, open, state, decode, equal } from "./model";
import { migrateSnapshot } from "./legacy";
export type LegacyChange = { id: string; note: Note; baseline?: Note; baseRevision: number; origin: ChangeOrigin };
export type ClientRecord = { note: Note; dirty: boolean; baseRevision: number; server?: Note; legacyBaseline?: Note };
export function recovery(note: Note, server?: Note): NoteChange {
  return { id: crypto.randomUUID(), update: delta(note.replica!, server?.replica), snapshot: authoredSnapshot(note.replica!), baseRevision: server?.revision ?? 0, authoredAt: note.updatedAt, origin: "recovery" };
}
function addsState(incoming: Note, previous: Note) {
  const doc = open(previous.replica);
  try { Y.applyUpdate(doc, decode(incoming.replica!.data)); return !sameState(state(doc), previous.replica!); }
  finally { doc.destroy(); }
}
/** Returns new immutable journal rows; the caller commits these with note. */
export function stage(current: ClientRecord | undefined, input: Note, raw: NoteChange[] = [], origin: ChangeOrigin = "web") {
  const changes: NoteChange[] = [], legacy: LegacyChange[] = [];
  let note: Note;
  if (!input.replica && (input.revision > 0 || current && !current.note.replica)) {
    if (current?.note.replica) {
      const bridged = migrateSnapshot(input, current.note, current.legacyBaseline);
      const captured = capture({ ...bridged, replica: current.note.replica }, origin);
      note = captured.note; if (captured.change) changes.push(captured.change);
    } else {
      note = input;
      if (!current || !equal(current.note, input)) legacy.push({ id: crypto.randomUUID(), note: input, ...(current ? { baseline: current.note } : {}), baseRevision: input.revision, origin });
    }
  } else {
    const captured = capture(input, origin);
    if (!current && !captured.change) changes.push(recovery(captured.note));
    const known = new Set(changes.map(item => item.id));
    for (const change of [...raw, ...(captured.change ? [captured.change] : [])]) if (!known.has(change.id)) { known.add(change.id); changes.push(change); }
    if (current?.note.replica) {
      const covered = open(current.note.replica);
      try {
        for (const change of changes) Y.applyUpdate(covered, decode(change.update));
        const context = { ...current.note, replica: state(covered) };
        if (addsState(captured.note, context)) changes.push({ ...recovery(captured.note, context), origin });
      } finally { covered.destroy(); }
    }
    note = combine(current?.note.replica ? current.note : undefined, captured.note);
  }
  return { note, changes, legacy };
}
export function receive(current: Note | undefined, server: Note) { return combine(current?.replica ? current : undefined, server); }
