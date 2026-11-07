import { observedRoute } from "../../../lib/server/telemetry";
import {
  authConfiguration,
  corsHeaders,
  expiredSessionCookie,
  principal,
  publicOrigin,
  publicUser,
  sameOrigin,
} from "@/lib/server/auth";
import { identities } from "@/lib/server/identity";
import { options } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
function GETHandler(request: Request) {
  const auth = principal(request);
  return Response.json(
    {
      ...authConfiguration(),
      authenticated: Boolean(auth),
      user: auth ? publicUser(auth.user) : null,
    },
    { headers: corsHeaders(request) },
  );
}
function DELETEHandler(request: Request) {
  if (!sameOrigin(request) && !request.headers.get("authorization"))
    return Response.json(
      { error: "Cross-origin logout is not allowed." },
      { status: 403 },
    );
  const auth = principal(request);
  const expected = request.headers.get("X-Doompile-User-ID");
  if (auth && expected && expected !== auth.user.id)
    return Response.json(
      { error: "The signed-in account changed." },
      { status: 401, headers: corsHeaders(request) },
    );
  if (auth) identities().revoke(auth.sessionHash);
  const headers = corsHeaders(request);
  headers.set(
    "Set-Cookie",
    expiredSessionCookie(publicOrigin(request).startsWith("https:")),
  );
  return Response.json({ authenticated: false }, { headers });
}

export const GET = observedRoute(GETHandler);
export const DELETE = observedRoute(DELETEHandler);
