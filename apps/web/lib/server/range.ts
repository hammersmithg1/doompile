export type ByteRange = { start: number; end: number };

/** A null result means serve the whole representation; false means HTTP 416. */
export function parseByteRange(header: string | null, size: number): ByteRange | null | false {
  if (!header || !header.startsWith("bytes=")) return null;
  // Multipart ranges are optional in HTTP. Ignore them and serve the full file.
  if (header.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
  return { start, end: Math.min(size - 1, end) };
}
