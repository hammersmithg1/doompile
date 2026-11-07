import { macOSUpdateDownload } from "../../../../lib/server/macos-updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  return macOSUpdateDownload(request, (await context.params).file);
}

export const HEAD = GET;
