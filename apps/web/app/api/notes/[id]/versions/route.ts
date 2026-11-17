import { noteIDPattern } from "@doompile/core";
import { api, RequestError } from "../../../../../lib/server/http";
import { store } from "../../../../../lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(request, async user => {
    const { id } = await context.params;
    if (!noteIDPattern.test(id)) throw new RequestError("Invalid note ID");
    const before = new URL(request.url).searchParams.get("before");
    if (before && !/^\d{1,15}$/.test(before)) throw new RequestError("Invalid version cursor");
    return Response.json({ versions: store(user.id).versions.versions(id, before ? Number(before) : undefined) });
  });
}
