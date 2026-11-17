import type { Note } from "@doompile/core";
/** Legacy row envelope retained for the transactional IndexedDB migration. */
export type LocalRecord = { note: Note; baseRevision: number; dirty: boolean };
