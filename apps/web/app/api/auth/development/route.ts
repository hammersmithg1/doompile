import { observedUser, serverEvent } from "../../../../lib/server/telemetry";
import { observedRoute } from "../../../../lib/server/telemetry";
import {
  authConfiguration,
  publicOrigin,
  sameOrigin,
  sessionCookie,
} from "@/lib/server/auth";
import { identities } from "@/lib/server/identity";
export const runtime = "nodejs";
function POSTHandler(request: Request) {
  if (!authConfiguration().development || !sameOrigin(request))
    return new Response(null, { status: 404 });
  const user = identities().login({
    provider: "development",
    subject: "local",
    name: "Локальный аккаунт",
    email: "local@localhost",
    emailVerified: false,
  });
  observedUser(user.id);
  serverEvent("auth.succeeded", { provider: "development" });
  return new Response(null, {
    status: 303,
    headers: {
      Location: publicOrigin(request),
      "Set-Cookie": sessionCookie(
        identities().issue(user.id, "web").token,
        false,
      ),
      "Cache-Control": "no-store",
    },
  });
}

export const POST = observedRoute(POSTHandler);
