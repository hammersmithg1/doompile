import { api, options } from "../../../lib/server/http";
import { store } from "../../../lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
export async function GET(request: Request) {
  return api(request, (user) => Response.json({ notes: store(user.id).list() }));
}
