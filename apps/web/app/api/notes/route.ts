import { api, options } from "../../../lib/server/http";
import { store } from "../../../lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function GET(request: Request) {
  return api(request, (user) => {
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor === null) return Response.json({ notes: store(user.id).list() });
    if (!/^\d{1,15}$/.test(cursor)) return Response.json({ error: "Invalid cursor" }, { status: 400 });
    return Response.json(store(user.id).versions.changes(Number(cursor)));
  });
}
