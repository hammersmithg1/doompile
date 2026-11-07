import { observedUser, serverEvent } from "./telemetry";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  cookieValue,
  providerConfigured,
  publicOrigin,
  sessionCookie,
} from "./auth";
import {
  hash,
  identities,
  opaque,
  type OAuthAttempt,
  type Provider,
  type User,
} from "./identity";

const BROWSER_COOKIE = "doompile_oauth";
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export function safeReturnTo(value: string | null): string {
  if (
    !value ||
    !/^\/(?:notes\/[0-9a-f-]+|connect\?code=[A-Za-z0-9_-]{43}|admin|\?note=[0-9a-f-]{36})?$/i.test(
      value,
    )
  )
    return "/";
  return value;
}
const bindingCookie = (value: string, secure: boolean, age = 600) =>
  `${BROWSER_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${age}${secure ? "; Secure" : ""}`;
export function startOAuth(request: Request, provider: string): Response {
  const origin = publicOrigin(request);
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.DOOMPILE_PUBLIC_URL || !origin.startsWith("https:"))
  )
    return Response.json(
      { error: "Configure the public HTTPS origin before enabling sign-in." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  if (!providerConfigured(provider))
    return Response.redirect(`${origin}/?auth_error=unconfigured`, 303);
  const state = opaque(),
    browser = opaque(),
    verifier = opaque(),
    nonce = opaque();
  const returnTo = safeReturnTo(
    new URL(request.url).searchParams.get("returnTo"),
  );
  identities().addOAuth({
    state,
    browserHash: hash(browser),
    provider,
    verifier,
    nonce,
    returnTo,
    expires: Date.now() + 600_000,
  });
  const url = new URL(
    provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : "https://oauth.yandex.com/authorize",
  );
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env[`DOOMPILE_${provider.toUpperCase()}_CLIENT_ID`]!,
    redirect_uri: `${origin}/api/auth/${provider}/callback`,
    scope:
      provider === "google" ? "openid email profile" : "login:email login:info",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    ...(provider === "google"
      ? { nonce, prompt: "select_account" }
      : { force_confirm: "yes" }),
  }).toString();
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.toString(),
      "Set-Cookie": bindingCookie(browser, origin.startsWith("https:")),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
async function oauthJSON(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("OAuth provider rejected the request.");
  return await response.json();
}
export async function exchangeProfile(
  provider: Exclude<Provider, "development">,
  code: string,
  attempt: OAuthAttempt,
  origin: string,
): Promise<
  Pick<User, "provider" | "subject" | "email" | "emailVerified" | "name">
> {
  const clientId = process.env[`DOOMPILE_${provider.toUpperCase()}_CLIENT_ID`]!;
  const token = await oauthJSON(
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://oauth.yandex.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret:
          process.env[`DOOMPILE_${provider.toUpperCase()}_CLIENT_SECRET`]!,
        redirect_uri: `${origin}/api/auth/${provider}/callback`,
        code_verifier: attempt.verifier,
      }),
    },
  );
  if (provider === "google") {
    if (typeof token.id_token !== "string")
      throw new Error("Missing Google identity.");
    const { payload } = await jwtVerify(token.id_token, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "nonce"],
    });
    if (
      payload.nonce !== attempt.nonce ||
      (payload.azp && payload.azp !== clientId) ||
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      payload.email_verified !== true
    )
      throw new Error("Invalid Google identity.");
    return {
      provider,
      subject: payload.sub,
      email: payload.email,
      emailVerified: true,
      name: typeof payload.name === "string" ? payload.name : payload.email,
    };
  }
  if (typeof token.access_token !== "string")
    throw new Error("Missing Yandex token.");
  const profile = await oauthJSON("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${token.access_token}` },
  });
  if (
    profile.client_id !== clientId ||
    typeof profile.id !== "string" ||
    !profile.id ||
    typeof profile.default_email !== "string" ||
    !Array.isArray(profile.emails) ||
    !profile.emails.includes(profile.default_email)
  )
    throw new Error("Invalid Yandex identity or missing email permission.");
  // login:email returns the addresses confirmed on the Yandex account.
  return {
    provider,
    subject: profile.id,
    email: profile.default_email,
    emailVerified: true,
    name:
      profile.display_name ||
      profile.real_name ||
      profile.login ||
      profile.default_email,
  };
}
export async function finishOAuth(
  request: Request,
  provider: string,
): Promise<Response> {
  const origin = publicOrigin(request),
    secure = origin.startsWith("https:");
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  headers.append("Set-Cookie", bindingCookie("", secure, 0));
  try {
    if (!providerConfigured(provider))
      throw new Error("Unconfigured provider.");
    const params = new URL(request.url).searchParams;
    const state = params.get("state") || "",
      browser = cookieValue(request, BROWSER_COOKIE);
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !/^[A-Za-z0-9_-]{43}$/.test(browser)
    )
      throw new Error("Invalid OAuth state.");
    const attempt = identities().consumeOAuth(state, browser, provider);
    const code = params.get("code");
    if (!attempt || params.has("error") || !code || code.length > 4096)
      throw new Error("Expired or denied OAuth attempt.");
    const user = identities().login(
      await exchangeProfile(provider, code, attempt, origin),
    );
    observedUser(user.id);
    serverEvent("auth.succeeded", { provider: user.provider });
    const session = identities().issue(user.id, "web");
    headers.append("Set-Cookie", sessionCookie(session.token, secure));
    headers.set("Location", origin + attempt.returnTo);
  } catch {
    // Provider responses and authorization codes must never reach logs or the browser.
    headers.set("Location", origin + "/?auth_error=failed");
  }
  return new Response(null, { status: 303, headers });
}
