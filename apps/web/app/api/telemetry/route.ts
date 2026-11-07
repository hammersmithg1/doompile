import { api, options, readJSON, RequestError } from "../../../lib/server/http";
import { isAdmin } from "../../../lib/server/auth";
import { telemetryStore, serverEvent } from "../../../lib/server/telemetry";
import { catalog, validateEvent } from "../../../../../packages/telemetry/core";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
export function POST(request: Request) {
  return api(request, async (user) => {
    try {
      const body = (await readJSON(request, catalog.limits.batchBytes)) as {
        events?: unknown[];
      } | null;
      if (
        !body ||
        !Array.isArray(body.events) ||
        body.events.length < 1 ||
        body.events.length > catalog.limits.batchEvents
      )
        throw new RequestError("Invalid telemetry batch.");
      const events = body.events.map(validateEvent);
      if (
        events.some(
          (event) =>
            !event ||
            event.platform === "server" ||
            event.name === "note.committed",
        )
      )
        throw new RequestError("Unsupported or invalid telemetry event.");
      if (
        !telemetryStore().insert(
          user.id,
          events.filter((event) => event !== null),
          "client",
        )
      )
        throw new RequestError("Telemetry rate limit exceeded.", 429);
      return Response.json({
        accepted: events.length,
        schema_version: catalog.version,
      });
    } catch (error) {
      if (error instanceof RequestError)
        serverEvent("telemetry.rejected", {
          status: error.status,
          error_code: error.status === 429 ? "quota" : "invalid_data",
          count: 1,
        });
      throw error;
    }
  });
}
export function GET(request: Request) {
  return api(request, (user) => {
    const params = new URL(request.url).searchParams;
    const all = params.get("scope") === "all";
    if (all && !isAdmin(user))
      throw new RequestError("Administrator access required.", 403);
    const userID = all ? undefined : user.id;
    if (params.get("view") === "summary") {
      const days = Number(params.get("days") || 7);
      if (
        !Number.isInteger(days) ||
        days < 1 ||
        days > catalog.limits.serverDays
      )
        throw new RequestError("Invalid summary window.");
      return Response.json(telemetryStore().summary(userID, days));
    }
    const after = Number(params.get("after") || 0),
      limit = Number(params.get("limit") || 100);
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500
    )
      throw new RequestError("Invalid event cursor or limit.");
    const traceID = params.get("trace_id") || undefined;
    if (traceID && !/^[0-9a-f]{32}$/.test(traceID))
      throw new RequestError("Invalid trace ID.");
    const events = telemetryStore().events({
      userID,
      after,
      limit,
      traceID,
      name: params.get("name") || undefined,
      level: params.get("level") || undefined,
    });
    return Response.json({
      events,
      next_cursor: events.at(-1)?.cursor || after,
      schema_version: catalog.version,
    });
  });
}
