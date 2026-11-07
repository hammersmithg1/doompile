import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { parseByteRange } from "./range";

// This directory contains public release artifacts only, separate from user data.
export async function macOSUpdateDownload(request: Request, filename: string): Promise<Response> {
  const directory = process.env.DOOMPILE_MACOS_RELEASES_DIR;
  const feed = filename === "appcast.xml";
  if (!directory || (!feed && !/^Doompile-macOS-[1-9]\d*(?:\.\d+){0,2}\.zip$/.test(filename)))
    return new Response(null, { status: 404 });
  let file;
  try {
    file = await open(join(directory, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) {
      await file.close();
      return new Response(null, { status: 404 });
    }
    const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    const headers = new Headers({
      "Content-Type": feed ? "application/rss+xml; charset=utf-8" : "application/zip",
      "Cache-Control": feed ? "no-cache, max-age=0, must-revalidate" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      ETag: etag,
    });
    if (!feed) headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    if (request.headers.get("if-none-match") === etag) {
      await file.close();
      return new Response(null, { status: 304, headers });
    }
    const ifRange = request.headers.get("if-range");
    const range = parseByteRange(!ifRange || ifRange === etag ? request.headers.get("range") : null, stat.size);
    if (range === false) {
      await file.close();
      headers.set("Content-Range", `bytes */${stat.size}`);
      headers.set("Content-Length", "0");
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Length", String(range ? range.end - range.start + 1 : stat.size));
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    const status = range ? 206 : 200;
    if (request.method === "HEAD") {
      await file.close();
      return new Response(null, { status, headers });
    }
    const stream = file.createReadStream(range ? { start: range.start, end: range.end } : {});
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
  } catch (error) {
    await file?.close().catch(() => {});
    const code = (error as NodeJS.ErrnoException).code;
    return new Response(null, { status: ["ENOENT", "ELOOP", "ENOTDIR"].includes(code || "") ? 404 : 503 });
  }
}
