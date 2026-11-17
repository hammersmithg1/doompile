import { API_VERSION, type Note } from "@doompile/core";
import type { StoredRecord } from "./local-notes";
export interface OutboxRepository {
  pending(): Promise<StoredRecord[]>;
  accept(sent: StoredRecord, server: Note, acknowledged: string[]): Promise<string[]>;
  error(id: string, message: string): Promise<string[]>;
  merge(notes: Note[], cursor?: number, reset?: boolean): Promise<string[]>;
  backfill?(id: string): Promise<string[]>;
  cursor(): Promise<number>;
}
export async function syncOutbox(repository: OutboxRepository, changed: (ids: string[]) => Promise<void>, transport: (url: string, init?: RequestInit) => Promise<Response> = fetch, pull = true) {
  const failed = new Set<string>();
  const recovered = new Set<string>();
  for (let pass = 0; pass < 10; pass++) {
    const pending = (await repository.pending()).filter(row => !failed.has(row.note.id));
    if (!pending.length) break;
    for (const row of pending) {
      const sent = structuredClone(row);
      sent.changes = sent.changes?.slice(0, 64); sent.legacy = sent.legacy?.slice(0, 32);
      const body = sent.legacy?.length ? { legacy: sent.legacy } : { changes: sent.changes ?? [] };
      const response = await transport(`/api/notes/${sent.note.id}/sync`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Doompile-API-Version": String(API_VERSION) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
      });
      if ([401, 503, 426].includes(response.status)) return { locked: true, failed: failed.size, conflicts: false };
      if (response.ok) {
        const { note, acknowledged } = await response.json();
        await changed(await repository.accept(sent, note, acknowledged));
      } else if (response.status === 409 && repository.backfill && !recovered.has(sent.note.id)) {
        recovered.add(sent.note.id);
        await changed(await repository.backfill(sent.note.id));
      } else {
        failed.add(sent.note.id);
        await changed(await repository.error(sent.note.id, `Не удалось отправить изменения (${response.status}). Они сохранены на устройстве.`));
      }
    }
  }
  if (pull) for (let page = 0; page < 100; page++) {
    const response = await transport(`/api/notes?cursor=${await repository.cursor()}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if ([401, 503, 426].includes(response.status)) return { locked: true, failed: failed.size, conflicts: false };
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const { notes, cursor, more, reset } = await response.json();
    await changed(await repository.merge(notes, cursor, reset === true));
    if (!more) break;
  }
  return { locked: false, failed: failed.size, conflicts: false };
}
