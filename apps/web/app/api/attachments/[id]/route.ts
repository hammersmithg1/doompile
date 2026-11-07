import { api, options, RequestError } from "@/lib/server/http";
import { store } from "@/lib/server/store";
import { objects } from "@/lib/server/objects";
import { parseByteRange } from "@/lib/server/range";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api(request, async (user) => {
    const { id: input } = await context.params;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input,
      )
    )
      throw new RequestError("Attachment not found.", 404);
    const id = input.toLowerCase(),
      repository = store(user.id);
    const attachment = repository.getAttachment(id),
      key = repository.attachmentKey(id);
    if (!attachment || !key)
      throw new RequestError("Attachment not found.", 404);
    const size = attachment.size,
      etag = `"${key}"`,
      ifRange = request.headers.get("if-range");
    const range = parseByteRange(
      !ifRange || ifRange === etag ? request.headers.get("range") : null,
      size,
    );
    const inline =
      /^(image\/(png|jpe?g|gif|webp|avif|heic|heif)|audio\/[\w.+-]+|video\/[\w.+-]+)$/i.test(
        attachment.mimeType,
      );
    const headers = new Headers({
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/'/g, "%27")}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      ETag: etag,
    });
    if (range === false) {
      headers.set("Content-Range", `bytes */${size}`);
      headers.set("Content-Length", "0");
      return new Response(null, { status: 416, headers });
    }
    headers.set(
      "Content-Length",
      String(range ? range.end - range.start + 1 : size),
    );
    if (range)
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    return new Response(await objects(user.id).read(key, range), {
      status: range ? 206 : 200,
      headers,
    });
  });
}
