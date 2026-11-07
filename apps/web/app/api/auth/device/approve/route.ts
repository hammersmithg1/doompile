import { api, readJSON, RequestError } from "@/lib/server/http";
import { identities } from "@/lib/server/identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return api(request, (_user, auth) => {
    if (auth.kind !== "web")
      throw new RequestError("Use a browser session.", 403);
    const flow = identities().device(
      new URL(request.url).searchParams.get("code") || "",
    );
    if (!flow) throw new RequestError("Connection expired.", 410);
    return Response.json({ label: flow.label, approved: Boolean(flow.userId) });
  });
}
export function POST(request: Request) {
  return api(request, async (user, auth) => {
    if (auth.kind !== "web")
      throw new RequestError("Use a browser session.", 403);
    const body = (await readJSON(request, 4096)) as { code?: unknown };
    if (
      typeof body?.code !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.code)
    )
      throw new RequestError("Invalid connection code.");
    if (!identities().approveDevice(body.code, user.id))
      throw new RequestError("Connection expired or already approved.", 410);
    return Response.json({ approved: true });
  });
}
