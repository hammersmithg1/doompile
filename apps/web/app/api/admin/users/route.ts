import { api, RequestError } from "@/lib/server/http";
import { isAdmin } from "@/lib/server/auth";
import { identities } from "@/lib/server/identity";
import { bucketName, objects } from "@/lib/server/objects";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return api(request, async (user, auth) => {
    if (auth.kind !== "web" || !isAdmin(user))
      throw new RequestError("Administrator access required.", 403);
    const offsetValue = new URL(request.url).searchParams.get("offset") || "0";
    if (!/^\d{1,7}$/.test(offsetValue)) throw new RequestError("Invalid page.");
    const offset = Number(offsetValue),
      page = identities().list(offset, 50);
    const rows = [];
    // Bound S3 fan-out when the user list grows.
    for (let index = 0; index < page.users.length; index += 5) {
      rows.push(
        ...(await Promise.all(
          page.users.slice(index, index + 5).map(async (account) => {
            let usage: { bytes: number; objects: number } | null = null;
            try {
              usage = await objects(account.id).usage();
            } catch {
              /* Report unavailable, never a false zero. */
            }
            return {
              id: account.id,
              email: account.email,
              name: account.name,
              provider: account.provider,
              createdAt: account.createdAt,
              lastLoginAt: account.lastLoginAt,
              lastSeenAt: account.lastSeenAt,
              bucket: bucketName(account.id),
              usage,
            };
          }),
        )),
      );
    }
    return Response.json({
      total: page.total,
      users: rows,
      offset,
      nextOffset:
        offset + rows.length < page.total ? offset + rows.length : null,
    });
  });
}
