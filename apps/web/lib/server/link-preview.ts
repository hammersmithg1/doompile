import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Parser } from "htmlparser2";
import { RequestError } from "./http";

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  siteName: string;
  type: string;
  image?: string;
};
const maximumHTML = 1024 * 1024;
const cache = new Map<
  string,
  { expires: number; value: Promise<LinkPreview> }
>();
export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function previewURL(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RequestError("Invalid URL.");
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "80" && url.port !== "443")
  )
    throw new RequestError("Only public HTTP(S) pages are supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    (!host.includes(".") && !isIP(host)) ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    (isIP(host) && !publicAddress(host))
  )
    throw new RequestError("Only public HTTP(S) pages are supported.");
  url.hash = "";
  return url;
}
export function parsePreview(html: string, url: URL): LinkPreview {
  const meta: Record<string, string> = {};
  let title = "",
    inTitle = false;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "title") inTitle = true;
        if (name === "meta") {
          const key = (attrs.property || attrs.name || "").toLowerCase();
          if (attrs.content && !meta[key]) meta[key] = attrs.content;
        }
      },
      ontext(text) {
        if (inTitle) title += text;
      },
      onclosetag(name) {
        if (name === "title") inTitle = false;
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  const clean = (value: string, max: number) =>
    value.replace(/\s+/g, " ").trim().slice(0, max);
  let image: string | undefined;
  try {
    const rawImage =
      meta["og:image:secure_url"] || meta["og:image"] || meta["twitter:image"];
    if (!rawImage) throw new Error("No preview image");
    const candidate = previewURL(new URL(rawImage, url).href);
    if (
      /^https?:$/.test(candidate.protocol) &&
      !candidate.username &&
      !candidate.password
    )
      image = candidate.href;
  } catch {}
  return {
    url: url.href,
    title: clean(
      meta["og:title"] || meta["twitter:title"] || title || url.hostname,
      300,
    ),
    description: clean(
      meta["og:description"] ||
        meta["twitter:description"] ||
        meta.description ||
        "",
      600,
    ),
    siteName: clean(
      meta["og:site_name"] || url.hostname.replace(/^www\./, ""),
      100,
    ),
    type: clean(meta["og:type"] || "website", 80),
    ...(image ? { image } : {}),
  };
}
async function page(
  url: URL,
  signal: AbortSignal,
): Promise<{ html?: string; redirect?: string }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicAddress(address))
  )
    throw new RequestError("Only public HTTP(S) pages are supported.");
  // Pin the connection to the validated DNS result, including after each redirect.
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        signal,
        agent: false,
        family: address.family,
        headers: {
          "User-Agent": "Doompile/0.1 (+link preview)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
      },
      (response) => {
        const status = response.statusCode || 0;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          response.headers.location
        ) {
          resolve({ redirect: response.headers.location });
          response.destroy();
          return;
        }
        if (
          status < 200 ||
          status >= 300 ||
          !/^(text\/html|application\/xhtml\+xml)\b/i.test(
            response.headers["content-type"] || "",
          )
        ) {
          reject(new RequestError("Page preview is unavailable.", 422));
          response.destroy();
          return;
        }
        let length = 0;
        const chunks: Buffer[] = [];
        const finish = () => {
          const charset =
            /charset=["']?([^\s;"']+)/i.exec(
              response.headers["content-type"] || "",
            )?.[1] || "utf-8";
          try {
            resolve({
              html: new TextDecoder(charset).decode(Buffer.concat(chunks)),
            });
          } catch {
            resolve({ html: Buffer.concat(chunks).toString("utf8") });
          }
        };
        response.on("data", (chunk: Buffer) => {
          const remaining = maximumHTML - length;
          chunks.push(chunk.subarray(0, remaining));
          length += chunk.length;
          // Only metadata is needed: bound memory even for extremely large pages.
          if (length >= maximumHTML) {
            finish();
            response.destroy();
          }
        });
        response.on("end", finish);
        response.on("error", reject);
        response.on("aborted", () =>
          reject(new RequestError("Page preview interrupted.", 422)),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}
export async function fetchPreview(value: string): Promise<LinkPreview> {
  let url = previewURL(value);
  const key = url.href,
    existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  const result = (async () => {
    const signal = AbortSignal.timeout(8000);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([
        aborted,
        (async () => {
          for (let redirects = 0; redirects <= 3; redirects++) {
            const response = await page(url, signal);
            if (response.html !== undefined)
              return parsePreview(response.html, url);
            url = previewURL(new URL(response.redirect!, url).href);
          }
          throw new RequestError("Too many redirects.", 422);
        })(),
      ]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  })();
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 60 * 60 * 1000, value: result });
  try {
    return await result;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}
