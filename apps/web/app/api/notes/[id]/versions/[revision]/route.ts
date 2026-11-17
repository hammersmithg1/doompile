import { noteIDPattern } from "@doompile/core";
import { api, RequestError, readJSON } from "../../../../../../lib/server/http";
import { store } from "../../../../../../lib/server/store";
import type { ChangeOrigin } from "../../../../../../../../packages/sync/changes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; revision: string }> };
function valid(id: string, revision: string) {
  if (!noteIDPattern.test(id) || !/^\d{1,15}$/.test(revision)) throw new RequestError("Invalid note or version");
}
export async function GET(request: Request, context: Context) {
  return api(request, async user => {
    const { id, revision } = await context.params; valid(id, revision);
    const history = store(user.id).versions;
    const note = new URL(request.url).searchParams.get("view") === "authored" ? history.authoredVersion(id, Number(revision)) : history.version(id, Number(revision));
    if (!note) throw new RequestError("Version not found", 404);
    return Response.json({ note });
  });
}
export async function POST(request: Request, context: Context) {
  return api(request, async user => {
    const { id, revision } = await context.params; valid(id, revision);
    const input = await readJSON(request) as { view?: unknown; origin?: unknown };
    const origin: ChangeOrigin = ["ios", "macos"].includes(String(input.origin)) ? input.origin as ChangeOrigin : "web";
    return Response.json(store(user.id).versions.restore(id, Number(revision), origin, input.view === "authored" ? "authored" : "merged"));
  });
}
