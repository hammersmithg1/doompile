/** Public location only: note links never contain connection tokens or note contents. */
export const noteIDPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function notePath(id: string): string {
  if (!noteIDPattern.test(id)) throw new Error("Invalid note ID");
  return `/notes/${id.toLowerCase()}`;
}
export function noteURL(id: string, origin: string): string {
  const url = new URL(origin);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("Invalid web origin");
  return new URL(notePath(id), url.origin).href;
}
export function noteAppURL(id: string): string {
  notePath(id);
  return `doompile://note/${id.toLowerCase()}`;
}
export function noteIDFromURL(value: string | URL): string | null {
  let url: URL;
  try {
    url = new URL(value, "https://doompile.invalid");
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  let id: string | null | undefined;
  if (url.protocol === "doompile:" && url.hostname === "note" && !url.port)
    id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  else if (/^https?:$/.test(url.protocol)) {
    id = /^\/notes\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    if (!id && url.pathname === "/") id = url.searchParams.get("note");
  }
  return id && noteIDPattern.test(id) ? id.toLowerCase() : null;
}
