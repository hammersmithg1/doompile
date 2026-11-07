import { DatabaseSync } from "node:sqlite";
import { stat, readdir } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory))
  throw new Error(
    "Usage: node infra/verify-backup.mjs /absolute/backup/directory",
  );
let notes = 0,
  attachments = 0;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function database(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    db.close();
    throw new Error("Backup SQLite integrity check failed.");
  }
  return db;
}
async function file(filename, size) {
  const entry = await stat(filename);
  if (!entry.isFile() || entry.size !== size)
    throw new Error("Backup attachment is missing or incomplete.");
  attachments++;
}
async function legacy(filename, files) {
  const db = database(filename);
  try {
    for (const { payload } of db.prepare("SELECT payload FROM notes").all()) {
      notes++;
      for (const attachment of JSON.parse(payload).attachments || []) {
        const id = /^\/api\/attachments\/([a-f0-9-]{36})$/i.exec(
          attachment.url,
        )?.[1];
        if (id) await file(path.join(files, id), attachment.size);
      }
    }
  } finally {
    db.close();
  }
}
const identityFile = path.join(directory, "identity.sqlite");
if (existsSync(identityFile)) {
  const identity = database(identityFile);
  const users = new Set(
    identity
      .prepare("SELECT id FROM users")
      .all()
      .map((row) => row.id),
  );
  identity.close();
  const folders = await readdir(path.join(directory, "users")).catch(
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const id of folders) {
    if (!uuid.test(id) || !users.has(id))
      throw new Error("Backup collection has no registered owner.");
    const db = database(path.join(directory, "users", id, "doompile.sqlite"));
    try {
      for (const { payload } of db.prepare("SELECT payload FROM notes").all()) {
        notes++;
        for (const attachment of JSON.parse(payload).attachments || []) {
          const ref = /^\/api\/attachments\/([a-f0-9-]{36})$/i.exec(
            attachment.url,
          )?.[1];
          if (
            ref &&
            !db.prepare("SELECT id FROM attachments WHERE id=?").get(ref)
          )
            throw new Error(
              "Backup note references missing attachment metadata.",
            );
        }
      }
      for (const row of db
        .prepare(
          "SELECT attachments.payload,attachment_objects.storage_key FROM attachments LEFT JOIN attachment_objects USING(id)",
        )
        .all()) {
        if (!/^[a-f0-9]{64}$/.test(row.storage_key || ""))
          throw new Error("Backup attachment has no S3 object key.");
        const metadata = JSON.parse(row.payload);
        const buckets = await readdir(path.join(directory, "s3"));
        const bucket = buckets.find((name) => name.endsWith("-" + id));
        if (!bucket || !/^[a-z][a-z0-9-]{0,24}-[a-f0-9-]{36}$/.test(bucket))
          throw new Error("Backup user bucket is missing.");
        await file(
          path.join(directory, "s3", bucket, row.storage_key),
          metadata.size,
        );
      }
    } finally {
      db.close();
    }
  }
  // Verify content-addressed bytes as well as metadata and database integrity.
  const buckets = await readdir(path.join(directory, "s3")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const bucket of buckets) {
    if (
      !/^[a-z][a-z0-9-]{0,24}-[a-f0-9-]{36}$/.test(bucket) ||
      !users.has(bucket.slice(-36))
    )
      throw new Error("Unexpected backup bucket.");
    for (const key of await readdir(path.join(directory, "s3", bucket))) {
      if (!/^[a-f0-9]{64}$/.test(key))
        throw new Error("Invalid backup object key.");
      const digest = createHash("sha256");
      for await (const chunk of createReadStream(
        path.join(directory, "s3", bucket, key),
      ))
        digest.update(chunk);
      if (digest.digest("hex") !== key)
        throw new Error("Backup object checksum mismatch.");
    }
  }
  if (existsSync(path.join(directory, "legacy.sqlite")))
    await legacy(
      path.join(directory, "legacy.sqlite"),
      path.join(directory, "legacy-attachments"),
    );
} else {
  await legacy(
    path.join(directory, "doompile.sqlite"),
    path.join(directory, "attachments"),
  );
}
if (existsSync(path.join(directory, "telemetry.sqlite")))
  database(path.join(directory, "telemetry.sqlite")).close();
console.log(
  `Backup verified: ${notes} notes; ${attachments} stored/referenced files.`,
);
