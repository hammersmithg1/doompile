import { API_VERSION, type Note } from "@doompile/core";
import type { LocalRecord } from "./reconcile";
import { track } from "./telemetry";
export interface OutboxRepository {
  pending(): Promise<LocalRecord[]>;
  accept(sent: Note, server: Note): Promise<string[]>;
  conflict(sent: Note, server: Note | null): Promise<string[]>;
  error(id: string, message: string): Promise<string[]>;
  merge(notes: Note[]): Promise<string[]>;
}
export async function syncOutbox(
  repository: OutboxRepository,
  changed: (ids: string[]) => Promise<void>,
  transport: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  pull = true,
) {
  const failed = new Set<string>();
  let conflicts = false;
  for (let pass = 0; pass < 10; pass++) {
    const pending = (await repository.pending()).filter(
      (record) => !failed.has(record.note.id),
    );
    if (!pending.length) break;
    for (const local of pending) {
      const sent = structuredClone(local.note);
      const response = await transport(`/api/notes/${sent.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Doompile-API-Version": String(API_VERSION),
        },
        body: JSON.stringify({ note: sent, baseRevision: local.baseRevision }),
        signal: AbortSignal.timeout(20_000),
      });
      if ([401, 503, 426].includes(response.status))
        return { locked: true, failed: failed.size, conflicts };
      if (response.status === 409) {
        track("sync.conflict", { note_id: sent.id });
        const { current } = await response.json();
        await changed(await repository.conflict(sent, current));
        conflicts = true;
      } else if (response.ok) {
        const { note } = await response.json();
        await changed(await repository.accept(sent, note));
      } else {
        failed.add(sent.id);
        await changed(
          await repository.error(
            sent.id,
            `Сервер отклонил заметку (${response.status}). Открой и исправь её, затем повтори синхронизацию.`,
          ),
        );
      }
    }
  }
  if (!pull) return { locked: false, failed: failed.size, conflicts };
  // A bad local note must not prevent receiving edits made on another device.
  const response = await transport("/api/notes", {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if ([401, 503, 426].includes(response.status))
    return { locked: true, failed: failed.size, conflicts };
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  const { notes } = (await response.json()) as { notes: Note[] };
  await changed(await repository.merge(notes));
  return { locked: false, failed: failed.size, conflicts };
}
