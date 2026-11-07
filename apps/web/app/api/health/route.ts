import { observedRoute } from "../../../lib/server/telemetry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function GETHandler() {
  try {
    // A process that cannot open/read its durable database is not ready for traffic.
    identities().list(0, 1);
    return Response.json(
      {
        status: "ok",
        service: "doompile",
        version: "0.1.0",
        apiVersion: API_VERSION,
        documentVersion: DOCUMENT_VERSION,
        commit: process.env.DOOMPILE_BUILD_COMMIT || "development",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", service: "doompile" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
import { API_VERSION, DOCUMENT_VERSION } from "@doompile/core";
import { identities } from "../../../lib/server/identity";

export function GET() { return observedRoute(GETHandler)(new Request("http://local/api/health")); }
