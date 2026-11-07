import { api, options, RequestError } from "../../../lib/server/http";
import { fetchPreview } from "../../../lib/server/link-preview";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function GET(request: Request) {
  return api(request, async () => {
    const url = new URL(request.url).searchParams.get("url");
    if (!url || url.length > 8192) throw new RequestError("A URL is required.");
    try {
      return Response.json(await fetchPreview(url));
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError("Page preview is unavailable.", 422);
    }
  });
}
