/** Browser-native, user-initiated navigation to an annotated passage. The stored
 * source URL stays canonical; only the outgoing link contains a text directive. */
export type SourceLink = {
  url: string;
  quote?: string;
  selector?: unknown;
  quotePrefix?: string;
  quoteSuffix?: string;
  timestampSeconds?: number | null;
};
const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
function edge(text: string, limit: number, end = false): string {
  const points = Array.from(normalize(text));
  if (points.length <= limit) return points.join("");
  const part = (end ? points.slice(-limit) : points.slice(0, limit)).join("");
  const boundary = end ? part.indexOf(" ") : part.lastIndexOf(" ");
  return boundary < 0
    ? part
    : end
      ? part.slice(boundary + 1)
      : part.slice(0, boundary);
}
const lines = (value: string) =>
  value
    .split(/[\r\n\u2028\u2029]+/u)
    .map(normalize)
    .filter(Boolean);
const encode = (text: string) =>
  encodeURIComponent(text.toWellFormed()).replace(
    /[-!'()*]/g,
    (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );
export function quoteContext(
  source: Pick<SourceLink, "selector" | "quotePrefix" | "quoteSuffix">,
) {
  const selector =
    source.selector && typeof source.selector === "object"
      ? (source.selector as Record<string, unknown>)
      : {};
  return {
    quotePrefix:
      typeof source.quotePrefix === "string"
        ? source.quotePrefix
        : typeof selector.prefix === "string"
          ? selector.prefix
          : "",
    quoteSuffix:
      typeof source.quoteSuffix === "string"
        ? source.quoteSuffix
        : typeof selector.suffix === "string"
          ? selector.suffix
          : "",
  };
}
export function sourceLink(source: SourceLink): string {
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return "";
  }
  if (!["https:", "http:"].includes(url.protocol)) return "";
  if (
    Number.isFinite(source.timestampSeconds) &&
    Number(source.timestampSeconds) >= 0 &&
    Number(source.timestampSeconds) <= 31_536_000 &&
    /(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname)
  )
    url.searchParams.set(
      "t",
      String(Math.floor(Number(source.timestampSeconds))),
    );
  const quote = typeof source.quote === "string" ? normalize(source.quote) : "";
  if (!quote) return url.href;
  const parts = lines(source.quote!);
  const context = quoteContext(source);
  const prefix = edge(lines(context.quotePrefix).at(-1) || "", 64, true);
  const suffix = edge(lines(context.quoteSuffix)[0] || "", 64);
  // Each term must be within one block; endpoints allow multi-paragraph and
  // long quotes without a huge URL and tolerate edits in the middle.
  const range = parts.length > 1 || Array.from(quote).length > 240;
  const start = range ? edge(parts[0] || quote, 96) : quote;
  const end = range ? edge(parts.at(-1) || quote, 96, true) : "";
  const directive =
    (prefix ? encode(prefix) + "-," : "") +
    encode(start) +
    (end ? "," + encode(end) : "") +
    (suffix ? ",-" + encode(suffix) : "");
  const anchor = url.hash.slice(1).split(":~:")[0];
  url.hash = anchor + ":~:text=" + directive;
  return url.href;
}
