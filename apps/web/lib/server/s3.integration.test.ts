import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  S3Client,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { testEnvironment } from "./test-accounts";
import { objects, bucketName } from "./objects";
import { store } from "./store";
import { POST as upload } from "../../app/api/attachments/route";
import { GET as download } from "../../app/api/attachments/[id]/route";

test(
  "real S3: private per-user buckets, multipart/range, byte usage, backup and restore",
  { skip: process.env.DOOMPILE_S3_INTEGRATION !== "1" },
  async () => {
    const fixture = testEnvironment(),
      a = fixture.account("alice"),
      b = fixture.account("bob");
    delete process.env.DOOMPILE_STORAGE;
    const previousPrefix = process.env.DOOMPILE_S3_BUCKET_PREFIX;
    process.env.DOOMPILE_S3_BUCKET_PREFIX = "doompile-test";
    const s3 = new S3Client({
      endpoint: process.env.DOOMPILE_S3_ENDPOINT,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.DOOMPILE_S3_ACCESS_KEY!,
        secretAccessKey: process.env.DOOMPILE_S3_SECRET_KEY!,
      },
    });
    const id = crypto.randomUUID(),
      size = 33 * 1024 * 1024 + 19;
    const context = { params: Promise.resolve({ id }) };
    const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
    async function removeBuckets() {
      for (const account of [a, b]) {
        const Bucket = bucketName(account.user.id);
        assert.match(Bucket, /^doompile-test-[a-f0-9-]{36}$/);
        try {
          const page = await s3.send(new ListObjectsV2Command({ Bucket }));
          if (page.Contents?.length)
            await s3.send(
              new DeleteObjectsCommand({
                Bucket,
                Delete: {
                  Objects: page.Contents.map((o) => ({ Key: o.Key! })),
                },
              }),
            );
          await s3.send(new DeleteBucketCommand({ Bucket }));
        } catch (error) {
          if ((error as Error).name !== "NoSuchBucket") throw error;
        }
      }
    }
    async function file(token: string, bytes: Uint8Array) {
      const body = new FormData();
      body.set(
        "file",
        new Blob([bytes as BlobPart], { type: "audio/mp4" }),
        "test.m4a",
      );
      return upload(
        new Request("http://localhost/api/attachments", {
          method: "POST",
          headers: { ...headers(token), "X-Doompile-Upload-ID": id },
          body,
        }),
      );
    }
    function run(script: string, argument: string) {
      const result = spawnSync(process.execPath, [script, argument], {
        env: process.env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
    }
    try {
      assert.equal(
        (await file(a.token, new Uint8Array(size).fill(173))).status,
        201,
      );
      assert.equal(
        (
          await download(
            new Request(`http://localhost/api/attachments/${id}`, {
              headers: headers(b.token),
            }),
            context,
          )
        ).status,
        404,
      );
      assert.equal(
        (await file(b.token, new TextEncoder().encode("bob"))).status,
        201,
      );
      assert.deepEqual(await objects(a.user.id).usage(), {
        bytes: size,
        objects: 1,
      });
      assert.deepEqual(await objects(b.user.id).usage(), {
        bytes: 3,
        objects: 1,
      });
      const ranged = await download(
        new Request(`http://localhost/api/attachments/${id}`, {
          headers: { ...headers(a.token), Range: "bytes=-19" },
        }),
        context,
      );
      assert.equal(ranged.status, 206);
      assert.deepEqual(
        new Uint8Array(await ranged.arrayBuffer()),
        new Uint8Array(19).fill(173),
      );
      const key = store(a.user.id).attachmentKey(id)!;
      const unauthenticated = await fetch(
        `${process.env.DOOMPILE_S3_ENDPOINT}/${bucketName(a.user.id)}/${key}`,
      );
      assert.equal(unauthenticated.status, 403);
      const backup = resolve(fixture.directory, "backup");
      run("infra/backup.mjs", backup);
    run("infra/verify-backup.mjs", backup);
      assert.equal(readdirSync(resolve(backup, "users")).length, 2);
      assert.equal(
        readFileSync(resolve(backup, "s3", bucketName(a.user.id), key)).length,
        size,
      );
      await removeBuckets();
      run("infra/restore-s3.mjs", resolve(backup, "s3"));
      const restored = await download(
        new Request(`http://localhost/api/attachments/${id}`, {
          headers: { ...headers(a.token), Range: "bytes=0-2" },
        }),
        context,
      );
      assert.deepEqual(
        new Uint8Array(await restored.arrayBuffer()),
        new Uint8Array(3).fill(173),
      );
    } finally {
      await removeBuckets();
      s3.destroy();
      if (previousPrefix === undefined)
        delete process.env.DOOMPILE_S3_BUCKET_PREFIX;
      else process.env.DOOMPILE_S3_BUCKET_PREFIX = previousPrefix;
      fixture.cleanup();
    }
  },
);
