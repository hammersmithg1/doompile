import { z } from "zod";
import { noteIDPattern, noteSchema } from "@doompile/core";
import {
  api,
  options,
  readJSON,
  RequestError,
} from "../../../../lib/server/http";
import { store } from "../../../../lib/server/store";
import { serverEvent } from "../../../../lib/server/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
const mutationSchema = z.object({
  note: noteSchema,
  baseRevision: z.number().int().min(0),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api(request, async (user) => {
    const { id } = await context.params;
    if (!noteIDPattern.test(id)) throw new RequestError("Invalid note ID.");
    const note = store(user.id).get(id.toLowerCase());
    if (!note || note.deletedAt) throw new RequestError("Note not found.", 404);
    return Response.json(
      { note },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return api(request, async (user) => {
    const { id } = await context.params;
    const parsed = mutationSchema.safeParse(await readJSON(request));
    if (!parsed.success)
      throw new RequestError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .slice(0, 5)
          .join("; "),
      );
    if (id !== parsed.data.note.id)
      throw new RequestError("Note ID does not match URL.");
    const saved = store(user.id).save(parsed.data.note, parsed.data.baseRevision);
    if (saved.ok) serverEvent("note.committed", {
      note_id: saved.note.id,
      operation: saved.note.deletedAt ? "delete" : saved.note.revision === 1 ? "create" : "update",
      kind: saved.note.kind,
    }, `note:${saved.note.id}:${saved.note.revision}`);
    else serverEvent("sync.conflict", { note_id: parsed.data.note.id });
    return saved.ok
      ? Response.json({ note: saved.note })
      : Response.json(
          {
            error: "This note has changed on another device.",
            current: saved.current,
          },
          { status: 409 },
        );
  });
}
