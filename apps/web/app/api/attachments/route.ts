import { serverEvent } from "../../../lib/server/telemetry";
import { mediaKind } from "../../../../../packages/telemetry/core";
import { mkdir, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import { NOTE_LIMITS, type Attachment } from "@doompile/core";
import { api, options, RequestError } from "../../../lib/server/http";
import { store } from "../../../lib/server/store";
import { objects } from "../../../lib/server/objects";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function POST(request: Request) {
  const started = performance.now();
  return api(request, async (user) => {
    if (!request.body) throw new RequestError("A file field is required.");
    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: { "content-type": request.headers.get("content-type") || "" },
        defParamCharset: "utf8",
        limits: { files: 1, fields: 0, parts: 2 },
      });
    } catch {
      throw new RequestError("Invalid multipart form data.");
    }
    const repository = store(user.id);
    const storage = objects(user.id);
    const directory = resolve(repository.directory, "uploads");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const uploadID = request.headers.get("X-Doompile-Upload-ID");
    if (
      uploadID &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        uploadID,
      )
    )
      throw new RequestError("Invalid upload ID.");
    const id = uploadID?.toLowerCase() || randomUUID(),
      temporary = resolve(directory, id + "." + randomUUID() + ".upload");
    let attachment: Attachment | undefined;
    let writing: Promise<void> | undefined;
    let writeError: unknown;
    const digest = createHash("sha256");
    parser.on("file", (field, file, info) => {
      if (field !== "file") {
        file.resume();
        parser.destroy(new RequestError("A file field is required."));
        return;
      }
      attachment = {
        id,
        name:
          (info.filename || "Untitled file")
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .slice(0, NOTE_LIMITS.attachmentName) || "Untitled file",
        mimeType:
          info.mimeType.slice(0, NOTE_LIMITS.mimeType) ||
          "application/octet-stream",
        size: 0,
        url: `/api/attachments/${id}`,
      };
      const count = new Transform({
        transform(chunk, encoding, done) {
          attachment!.size += chunk.length;
          digest.update(chunk);
          done(null, chunk);
        },
      });
      writing = pipeline(
        file,
        count,
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
      // Handle disk failures immediately, while the request is still being consumed.
      void writing.catch((error) => {
        writeError = error;
        parser.destroy(error);
      });
    });
    for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const)
      parser.on(event, () =>
        parser.destroy(new RequestError("Send exactly one file per request.")),
      );
    try {
      try {
        await pipeline(
          Readable.fromWeb(
            request.body as import("node:stream/web").ReadableStream,
          ),
          parser,
          { signal: request.signal },
        );
      } catch (error) {
        await writing?.catch(() => {});
        if (error instanceof RequestError) throw error;
        const diskCode = (writeError as NodeJS.ErrnoException | undefined)
          ?.code;
        if (diskCode && /^E(?!RR_)/.test(diskCode)) throw writeError;
        throw new RequestError(
          "Upload interrupted or malformed multipart data.",
        );
      }
      if (!attachment || !writing)
        throw new RequestError("A file field is required.");
      await writing;
      const key = digest.digest("hex");
      const existing = repository.getAttachment(id);
      if (existing && (existing.name !== attachment.name || existing.mimeType !== attachment.mimeType || existing.size !== attachment.size || repository.attachmentKey(id) !== key))
        throw new RequestError("This upload ID already belongs to another file.", 409);
      await storage.upload(temporary, key, attachment.size, request.signal);
      try {
        const saved = repository.commitAttachment(attachment, key);
        serverEvent("attachment.uploaded", { bytes: saved.size, kind: mediaKind(saved.mimeType), duration_ms: performance.now() - started }, `attachment:${saved.id}`);
        return Response.json({ attachment: saved }, { status: existing ? 200 : 201 });
      } catch (error) {
        if ((error as Error).message === "UPLOAD_CONFLICT") throw new RequestError("This upload ID already belongs to another file.", 409);
        throw error;
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
  });
}
