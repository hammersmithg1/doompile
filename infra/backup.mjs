import { DatabaseSync } from "node:sqlite";
import { mkdir, readdir, cp } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
const root = process.env.DOOMPILE_DATA_DIR || "/data";
const destination = process.argv[2];
if (!destination?.startsWith("/"))
  throw new Error("Supply an absolute, new backup destination.");
await mkdir(destination, { recursive: false, mode: 0o700 });
async function snapshot(source, target) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
}
const users = (
  await readdir(resolve(root, "users")).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })
).filter((id) => /^[a-f0-9-]{36}$/.test(id));
for (const id of users) {
  const source = resolve(root, "users", id, "doompile.sqlite");
  if (!existsSync(source)) continue;
  const folder = resolve(destination, "users", id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await snapshot(source, resolve(folder, "doompile.sqlite"));
}
// Identity is snapshotted after enumerating users, so all copied collections have their owners.
await snapshot(
  resolve(root, "identity.sqlite"),
  resolve(destination, "identity.sqlite"),
);
if (existsSync(resolve(root, "telemetry.sqlite")))
  await snapshot(
    resolve(root, "telemetry.sqlite"),
    resolve(destination, "telemetry.sqlite"),
  );
if (existsSync(resolve(root, "doompile.sqlite"))) {
  await snapshot(
    resolve(root, "doompile.sqlite"),
    resolve(destination, "legacy.sqlite"),
  );
  if (existsSync(resolve(root, "attachments")))
    await cp(
      resolve(root, "attachments"),
      resolve(destination, "legacy-attachments"),
      { recursive: true },
    );
}
const s3 = new S3Client({
  endpoint: process.env.DOOMPILE_S3_ENDPOINT,
  region: process.env.DOOMPILE_S3_REGION || "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.DOOMPILE_S3_ACCESS_KEY,
    secretAccessKey: process.env.DOOMPILE_S3_SECRET_KEY,
  },
  responseChecksumValidation: "WHEN_REQUIRED",
});
// Objects are immutable and never removed while this backup runs. Copy after SQLite snapshots.
for (const id of users) {
  const bucket =
    (process.env.DOOMPILE_S3_BUCKET_PREFIX || "doompile") + "-" + id;
  let token;
  do {
    let page;
    try {
      page = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
      );
    } catch (error) {
      if (error.name === "NoSuchBucket") break;
      throw error;
    }
    for (const object of page.Contents || []) {
      if (!/^[a-f0-9]{64}$/.test(object.Key))
        throw new Error("Unexpected object key in user bucket.");
      const directory = resolve(destination, "s3", bucket);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: object.Key }),
      );
      await pipeline(
        file.Body,
        createWriteStream(resolve(directory, object.Key), {
          flags: "wx",
          mode: 0o600,
        }),
      );
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}
console.log("Backup complete.");
