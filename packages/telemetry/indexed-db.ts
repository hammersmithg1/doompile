import { openDB } from "idb";
import { catalog, type Journal, type TelemetryEvent } from "./core";

// Transactions coordinate tabs; an acknowledgement only touches the IDs actually sent.
export function indexedDBJournal(scope: string): Journal {
  const database = openDB(`doompile-diagnostics-v1:${scope}`, 1, {
    upgrade(db) {
      const events = db.createObjectStore("events", { keyPath: "event.id" });
      events.createIndex("timestamp", "event.timestamp");
      events.createIndex("pending", "pending");
      db.createObjectStore("meta");
    },
  });
  // Avoid an unhandled rejection when a browser refuses persistent storage.
  void database.catch(() => {});
  return {
    async append(event, pending) {
      const db = await database;
      const tx = db.transaction(["events", "meta"], "readwrite");
      const events = tx.objectStore("events");
      await events.put({ event, pending: pending ? 1 : 0 });
      let count = await events.count();
      let dropped = Number((await tx.objectStore("meta").get("dropped")) || 0);
      const cutoff = new Date(
        Date.now() - catalog.limits.localDays * 86400000,
      ).toISOString();
      let cursor = await events.index("timestamp").openCursor();
      while (
        cursor &&
        (count > catalog.limits.localEvents ||
          cursor.value.event.timestamp < cutoff)
      ) {
        if (cursor.value.pending) dropped++;
        await cursor.delete();
        count--;
        cursor = await cursor.continue();
      }
      await tx.objectStore("meta").put(dropped, "dropped");
      await tx.done;
    },
    async read(pendingOnly = false, limit = catalog.limits.localEvents) {
      const db = await database;
      const rows = pendingOnly
        ? await db.getAllFromIndex("events", "pending", 1, limit)
        : await db.getAllFromIndex("events", "timestamp", undefined, limit);
      return rows
        .map((row) => row.event as TelemetryEvent)
        .filter(
          (e) =>
            Date.parse(e.timestamp) >=
            Date.now() - catalog.limits.localDays * 86400000,
        );
    },
    async acknowledge(ids) {
      const db = await database;
      const tx = db.transaction("events", "readwrite");
      for (const id of ids) {
        const row = await tx.store.get(id);
        if (row) await tx.store.put({ ...row, pending: 0 });
      }
      await tx.done;
    },
    async clearPending() {
      const db = await database;
      const tx = db.transaction("events", "readwrite");
      let cursor = await tx.store.index("pending").openCursor(1);
      while (cursor) {
        await cursor.update({ ...cursor.value, pending: 0 });
        cursor = await cursor.continue();
      }
      await tx.done;
    },
    async stats() {
      const db = await database;
      return {
        count: await db.count("events"),
        pending: await db.countFromIndex("events", "pending", 1),
        dropped: Number((await db.get("meta", "dropped")) || 0),
      };
    },
  };
}
