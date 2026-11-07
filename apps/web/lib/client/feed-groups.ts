import type { Note } from "@doompile/core";
export function groupFeed(notes: Note[]) {
  const result = new Map<
    string,
    { id: string; label: string; notes: Note[] }
  >();
  for (const note of notes) {
    const date = new Date(note.createdAt);
    const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const id = note.pinned ? "pinned" : `day:${day}`;
    if (!result.has(id))
      result.set(id, {
        id,
        label: note.pinned
          ? "Закреплено"
          : date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
        notes: [],
      });
    result.get(id)!.notes.push(note);
  }
  return [...result.values()];
}
