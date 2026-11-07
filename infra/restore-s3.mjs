import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
const source = process.argv[2];
if (!source?.startsWith("/"))
  throw new Error("Supply the absolute backup/s3 directory.");
const s3 = new S3Client({
  endpoint: process.env.DOOMPILE_S3_ENDPOINT,
  region: process.env.DOOMPILE_S3_REGION || "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.DOOMPILE_S3_ACCESS_KEY,
    secretAccessKey: process.env.DOOMPILE_S3_SECRET_KEY,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
});
for (const bucket of await readdir(source)) {
  if (!/^[a-z][a-z0-9-]{0,24}-[a-f0-9-]{36}$/.test(bucket))
    throw new Error("Invalid backup bucket.");
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (error.name !== "BucketAlreadyOwnedByYou") throw error;
  }
  for (const key of await readdir(resolve(source, bucket))) {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error("Invalid backup object key.");
    const path = resolve(source, bucket, key);
    await new Upload({
      client: s3,
      params: {
        Bucket: bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: (await stat(path)).size,
        ContentType: "application/octet-stream",
      },
      queueSize: 2,
      leavePartsOnError: false,
    }).done();
  }
}
console.log("S3 restore complete.");
