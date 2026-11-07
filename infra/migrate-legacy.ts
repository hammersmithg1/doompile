import { DatabaseSync } from "node:sqlite";
import type { Note, Attachment } from "@doompile/core";
/** Explicit owner assignment for the former single-user collection. Originals stay untouched.
 * Run through setec: TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --import tsx infra/migrate-legacy.ts --user <registered UUID>
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import { dataDirectory, identities } from "../apps/web/lib/server/identity";
import { store } from "../apps/web/lib/server/store";
import { objects } from "../apps/web/lib/server/objects";
async function main() {
  const [flag, userID] = process.argv.slice(2);
  if (flag !== "--user" || !userID || !identities().user(userID))
    throw new Error(
      "Supply --user with an existing registered user ID. No automatic first-user assignment is allowed.",
    );
  const root = dataDirectory();
  if (!existsSync(resolve(root, "doompile.sqlite")))
    throw new Error("No legacy collection exists in DOOMPILE_DATA_DIR.");
  const legacy = new DatabaseSync(resolve(root, "doompile.sqlite"), {
      readOnly: true,
    }),
    target = store(userID),
    storage = objects(userID);
  try {
    const notes = legacy
        .prepare("SELECT payload FROM notes")
        .all()
        .map((row) => JSON.parse(String(row.payload)) as Note),
      attachments = legacy
        .prepare("SELECT payload FROM attachments")
        .all()
        .map((row) => JSON.parse(String(row.payload)) as Attachment);
    // Refuse to overwrite an account that already has edits of a legacy note.
    for (const note of notes) {
      const existing = target.get(note.id);
      if (
        existing &&
        JSON.stringify({ ...existing, revision: 0 }) !==
          JSON.stringify({ ...note, revision: 0 })
      )
        throw new Error(
          "The destination already contains a different version of a legacy note. Resolve it before migrating.",
        );
    }
    for (const attachment of attachments) {
      if (!/^[0-9a-f-]{36}$/i.test(attachment.id))
        throw new Error("Invalid legacy attachment ID.");
      const path = resolve(root, "attachments", attachment.id),
        digest = createHash("sha256");
      for await (const chunk of createReadStream(path)) digest.update(chunk);
      const key = digest.digest("hex");
      await storage.upload(path, key, attachment.size);
      target.commitAttachment(attachment, key);
    }
    for (const note of notes) {
      if (!target.save(note, 0).ok)
        throw new Error(
          "The destination changed during migration. Stop its clients and retry.",
        );
    }
    console.log(
      `Migrated ${notes.length} notes and ${attachments.length} attachments to user ${userID}. Legacy files were retained.`,
    );
  } finally {
    legacy.close();
    target.close();
    identities().close();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed.");
  process.exitCode = 1;
});
