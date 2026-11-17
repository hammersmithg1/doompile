import type { Note } from "../core/src/index";
import { authoredSnapshot, delta, merge, prepare, sameState } from "./model";

export type ChangeOrigin = "web" | "ios" | "macos" | "clipper" | "recovery" | "migration";
export type NoteChange = { id: string; update: string; snapshot: string; baseRevision: number; authoredAt: string; origin: ChangeOrigin };
export type VersionInfo = { revision: number; parentRevision: number | null; createdAt: string; authoredAt: string; origin: string; kind: string };

/** Capture against the state the author saw, before merging any newer state. */
export function capture(input: Note, origin: ChangeOrigin, id = crypto.randomUUID()): { note: Note; change?: NoteChange } {
  const note = prepare(input);
  if (input.replica && sameState(input.replica, note.replica!)) return { note };
  return { note, change: {
    id, update: delta(note.replica!, input.replica), snapshot: authoredSnapshot(note.replica!),
    baseRevision: input.revision, authoredAt: input.updatedAt, origin,
  } };
}

export function combine(current: Note | undefined, incoming: Note): Note {
  if (!current?.replica) return incoming;
  if (!incoming.replica) throw new Error("Missing note context");
  return merge(current, incoming);
}
