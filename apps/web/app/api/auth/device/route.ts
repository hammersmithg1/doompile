import { observedUser, serverEvent } from "../../../../lib/server/telemetry";
import { observedRoute } from "../../../../lib/server/telemetry";
import {
  corsHeaders,
  publicOrigin,
  publicUser,
  sameOrigin,
} from "@/lib/server/auth";
import { identities } from "@/lib/server/identity";
import { options, readJSON, RequestError } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
async function POSTHandler(request: Request) {
  const headers = corsHeaders(request);
  try {
    if (!sameOrigin(request) && !headers.has("Access-Control-Allow-Origin"))
      throw new RequestError("Origin is not allowed.", 403);
    const body = (await readJSON(request, 4096)) as {
      code?: unknown;
      secret?: unknown;
      label?: unknown;
    };
    if (!body || typeof body !== "object")
      throw new RequestError("Invalid request.");
    if (body.code !== undefined || body.secret !== undefined) {
      if (
        typeof body.code !== "string" ||
        typeof body.secret !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(body.code) ||
        !/^[A-Za-z0-9_-]{43}$/.test(body.secret)
      )
        throw new RequestError("Invalid connection code.");
      const result = identities().exchangeDevice(body.code, body.secret);
      if (result.status === "expired")
        throw new RequestError("Connection expired. Start sign-in again.", 410);
      if (result.status === "approved") { observedUser(result.user.id); serverEvent("auth.succeeded", { provider: "device" }); }
      return Response.json(
        result.status === "approved"
          ? { ...result, user: publicUser(result.user) }
          : result,
        { headers },
      );
    }
    const label =
      typeof body.label === "string"
        ? body.label.trim().slice(0, 100)
        : "Doompile";
    const flow = identities().createDevice(label || "Doompile");
    return Response.json(
      {
        ...flow,
        verificationUrl: `${publicOrigin(request)}/connect?code=${flow.code}`,
        interval: 3,
      },
      { status: 201, headers },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestError
            ? error.message
            : "Could not create connection.",
      },
      { status: error instanceof RequestError ? error.status : 503, headers },
    );
  }
}

export const POST = observedRoute(POSTHandler);
