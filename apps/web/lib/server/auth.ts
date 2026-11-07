import { createHash, timingSafeEqual } from "node:crypto";
import {
  identities,
  type Principal,
  type Provider,
  type User,
} from "./identity";

export const SESSION_COOKIE = "doompile_session";
export const oauthProviders = ["yandex", "google"] as const;
export function authConfiguration() {
  const providers = oauthProviders.map((id) => ({
    id,
    enabled: Boolean(
      process.env[`DOOMPILE_${id.toUpperCase()}_CLIENT_ID`] &&
      process.env[`DOOMPILE_${id.toUpperCase()}_CLIENT_SECRET`],
    ),
  }));
  return {
    providers,
    configured: providers.some((p) => p.enabled),
    development:
      process.env.NODE_ENV === "development" &&
      process.env.DOOMPILE_DEV_LOGIN === "1",
  };
}
export function constantTimeEqual(first: string, second: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(first).digest(),
    createHash("sha256").update(second).digest(),
  );
}
export function cookieValue(request: Request, name: string): string {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86_400}${secure ? "; Secure" : ""}`;
}
export function expiredSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}
export function publicOrigin(request: Request): string {
  return new URL(process.env.DOOMPILE_PUBLIC_URL || request.url).origin;
}
export function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === publicOrigin(request);
  } catch {
    return false;
  }
}
export function principal(request: Request): Principal | null {
  const authorization = request.headers.get("authorization");
  // A rejected bearer token must never fall back to an ambient browser session.
  if (authorization)
    return authorization.startsWith("Bearer ")
      ? identities().authenticate(authorization.slice(7), "device")
      : null;
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    !sameOrigin(request)
  )
    return null;
  return identities().authenticate(cookieValue(request, SESSION_COOKIE), "web");
}
export function authorized(request: Request): boolean {
  return principal(request) !== null;
}
export function isAdmin(user: User): boolean {
  const email = process.env.DOOMPILE_ADMIN_EMAIL?.trim().toLowerCase();
  const pinned = process.env.DOOMPILE_ADMIN_USER_ID?.trim();
  return Boolean(
    email &&
    user.provider !== "development" &&
    user.emailVerified &&
    user.email.toLowerCase() === email &&
    (!pinned || user.id === pinned),
  );
}
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider,
    admin: isAdmin(user),
  };
}
export function requireAuthorization(request: Request): Response | null {
  return authorized(request)
    ? null
    : Response.json(
        { error: "Authentication required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
}
export function providerConfigured(
  provider: string,
): provider is Exclude<Provider, "development"> {
  return authConfiguration().providers.some(
    (p) => p.id === provider && p.enabled,
  );
}
export function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const origin = request.headers.get("origin");
  const configured = (process.env.DOOMPILE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (
    origin &&
    (/^(chrome-extension|moz-extension|safari-web-extension):\/\/[a-zA-Z0-9-]+$/.test(
      origin,
    ) ||
      configured.includes(origin))
  ) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Range, If-Range, X-Doompile-API-Version, X-Doompile-Upload-ID, X-Doompile-User-ID, traceparent",
    );
    headers.set(
      "Access-Control-Expose-Headers",
      "Content-Range, Content-Length, Accept-Ranges, Content-Disposition, ETag, X-Doompile-API-Version, traceparent",
    );
    headers.set(
      "Access-Control-Allow-Methods",
      "GET, PUT, POST, DELETE, OPTIONS",
    );
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}
