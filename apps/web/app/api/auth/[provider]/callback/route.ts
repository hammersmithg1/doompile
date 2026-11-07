import { observedRoute } from "../../../../../lib/server/telemetry";
import { finishOAuth } from "@/lib/server/oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function GETHandler(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  return finishOAuth(request, (await context.params).provider);
}

export const GET = observedRoute(GETHandler);
