import { appSiteAssociation } from "../../../lib/server/app-links";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(appSiteAssociation(), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
