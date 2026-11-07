import {
  API_VERSION,
  DOCUMENT_VERSION,
  NOTE_LIMITS,
  EDITOR_ACTIONS,
} from "@doompile/core";
import { api, options } from "../../../lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = options;
export function GET(request: Request) {
  return api(request, () =>
    Response.json({
      apiVersion: API_VERSION,
      documentVersion: DOCUMENT_VERSION,
      limits: NOTE_LIMITS,
      editorActions: EDITOR_ACTIONS,
      unknownBlocks: "preserve",
      conflicts: "keep-both",
    }),
  );
}
