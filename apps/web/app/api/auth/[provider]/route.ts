import { observedRoute } from "../../../../lib/server/telemetry";
import { startOAuth } from "@/lib/server/oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function GETHandler(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  return startOAuth(request, (await context.params).provider);
}

export const GET = observedRoute(GETHandler);
