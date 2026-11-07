import { createReadStream } from "node:fs";
import { mkdir, open, readdir, stat, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import {
  S3Client,
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { dataDirectory } from "./identity";
import { RequestError } from "./http";

export function bucketName(userId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      userId,
    )
  )
    throw new Error("Invalid authenticated user ID.");
  const prefix = process.env.DOOMPILE_S3_BUCKET_PREFIX || "doompile";
  if (!/^[a-z][a-z0-9-]{0,24}$/.test(prefix))
    throw new Error("Invalid S3 bucket prefix.");
  return `${prefix}-${userId}`;
}
const isMissing = (error: unknown) =>
  ["NoSuchBucket", "NoSuchKey", "NotFound"].includes((error as Error)?.name) ||
  (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode === 404;
export class UserObjects {
  readonly bucket: string;
  private client?: S3Client;
  private local: boolean;
  private directory: string;
  private prepared?: Promise<void>;
  constructor(userId: string) {
    this.bucket = bucketName(userId);
    this.directory = resolve(dataDirectory(), "users", userId, "objects");
    this.local =
      process.env.NODE_ENV !== "production" &&
      process.env.DOOMPILE_STORAGE === "filesystem";
    if (!this.local) {
      const endpoint = process.env.DOOMPILE_S3_ENDPOINT;
      const accessKeyId = process.env.DOOMPILE_S3_ACCESS_KEY;
      const secretAccessKey = process.env.DOOMPILE_S3_SECRET_KEY;
      if (!endpoint || !accessKeyId || !secretAccessKey)
        throw new RequestError("File storage is not configured.", 503);
      this.client = new S3Client({
        endpoint,
        region: process.env.DOOMPILE_S3_REGION || "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
    }
  }
  private key(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid object key.");
    return key;
  }
  async ensure(): Promise<void> {
    if (!this.prepared)
      this.prepared = (async () => {
        if (this.local) {
          await mkdir(this.directory, { recursive: true, mode: 0o700 });
          return;
        }
        try {
          await this.client!.send(
            new CreateBucketCommand({ Bucket: this.bucket }),
          );
        } catch (error) {
          if ((error as Error).name !== "BucketAlreadyOwnedByYou") throw error;
        }
        // Buckets have no public policy/ACL. Clients receive neither S3 credentials nor public URLs.
      })().catch((error) => {
        this.prepared = undefined;
        throw error;
      });
    return this.prepared;
  }
  async upload(path: string, key: string, size: number, signal?: AbortSignal) {
    this.key(key);
    await this.ensure();
    if (this.local) {
      try {
        await copyFile(
          path,
          resolve(this.directory, key),
          constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      return;
    }
    // Content-addressed objects cannot overwrite a different file. Multipart bounds memory
    // for large files; repeated uploads reuse a key only for the same SHA-256 bytes.
    try {
      const existing = await this.client!.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (existing.ContentLength !== size)
        throw new Error("Object checksum collision.");
      return;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const source = createReadStream(path);
    const upload = new Upload({
      client: this.client!,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: source,
        ContentLength: size,
        ContentType: "application/octet-stream",
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    const abort = () => {
      source.destroy();
      void upload.abort();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new Error("Upload aborted.");
      await upload.done();
    } finally {
      signal?.removeEventListener("abort", abort);
      source.destroy();
    }
  }
  async read(
    key: string,
    range?: { start: number; end: number } | null,
  ): Promise<ReadableStream<Uint8Array> | null> {
    this.key(key);
    if (this.local) {
      const file = await open(resolve(this.directory, key), "r");
      if ((await file.stat()).size === 0) {
        await file.close();
        return null;
      }
      return Readable.toWeb(
        file.createReadStream(
          range ? { start: range.start, end: range.end } : {},
        ),
      ) as ReadableStream<Uint8Array>;
    }
    try {
      const object = await this.client!.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
      );
      return object.Body?.transformToWebStream() ?? null;
    } catch (error) {
      if (isMissing(error))
        throw new RequestError("Attachment file not found.", 404);
      throw error;
    }
  }
  async usage(): Promise<{ bytes: number; objects: number }> {
    if (this.local) {
      const keys = await readdir(this.directory).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      const sizes = await Promise.all(
        keys.map((key) => stat(resolve(this.directory, key))),
      );
      return {
        bytes: sizes.reduce((sum, file) => sum + file.size, 0),
        objects: sizes.length,
      };
    }
    let bytes = 0,
      objects = 0,
      token: string | undefined;
    do {
      try {
        const page = await this.client!.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            ContinuationToken: token,
          }),
        );
        for (const file of page.Contents ?? []) {
          bytes += file.Size ?? 0;
          objects++;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } catch (error) {
        if (isMissing(error)) return { bytes: 0, objects: 0 };
        throw error;
      }
    } while (token);
    return { bytes, objects };
  }
}
export function objects(userId: string) {
  return new UserObjects(userId);
}
