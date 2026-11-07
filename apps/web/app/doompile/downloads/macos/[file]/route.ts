// Also serve the public URL when the reverse proxy preserves /doompile.
export { GET, HEAD } from "../../../../downloads/macos/[file]/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
