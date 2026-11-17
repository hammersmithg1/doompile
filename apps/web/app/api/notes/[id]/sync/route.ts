import { z } from "zod";
import { noteIDPattern, noteSchema } from "@doompile/core";
import { api, readJSON, RequestError, options } from "../../../../../lib/server/http";
import { store } from "../../../../../lib/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
const origin = z.enum(["web", "ios", "macos", "clipper", "recovery", "migration"]);
const binary = z.string().max(16 * 1024 * 1024);
const change = z.object({ id: z.string().uuid(), update: binary, snapshot: binary, baseRevision: z.number().int().nonnegative(), authoredAt: z.string().datetime(), origin });
const legacy = z.object({ id: z.string().uuid(), note: noteSchema, baseline: noteSchema.optional(), baseRevision: z.number().int().nonnegative(), origin });
const schema = z.union([
  z.object({ changes: z.array(change).max(64), vector: binary.optional() }),
  z.object({ legacy: z.array(legacy).min(1).max(32) }),
]);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(request, async user => {
    const { id } = await context.params;
    if (!noteIDPattern.test(id)) throw new RequestError("Invalid note ID");
    const input = schema.safeParse(await readJSON(request, 24 * 1024 * 1024));
    if (!input.success) throw new RequestError("Invalid synchronization batch");
    const versions = store(user.id).versions;
    return Response.json("legacy" in input.data ? versions.migrate(id, input.data.legacy) : versions.sync(id, input.data.changes, input.data.vector));
  });
}
