import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { identities } from "./identity";
import { testEnvironment } from "./test-accounts";
import { finishOAuth, safeReturnTo, startOAuth } from "./oauth";
import { principal } from "./auth";
const origin = "http://localhost:3000";
const names = [
  "DOOMPILE_PUBLIC_URL",
  "DOOMPILE_YANDEX_CLIENT_ID",
  "DOOMPILE_YANDEX_CLIENT_SECRET",
  "DOOMPILE_GOOGLE_CLIENT_ID",
  "DOOMPILE_GOOGLE_CLIENT_SECRET",
];
function configuration() {
  const previous = names.map((name) => process.env[name]);
  process.env.DOOMPILE_PUBLIC_URL = origin;
  process.env.DOOMPILE_YANDEX_CLIENT_ID = "test-yandex";
  process.env.DOOMPILE_YANDEX_CLIENT_SECRET = "test-secret";
  process.env.DOOMPILE_GOOGLE_CLIENT_ID = "test-google";
  process.env.DOOMPILE_GOOGLE_CLIENT_SECRET = "test-secret";
  return () =>
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    });
}
const binding = (response: Response) =>
  response.headers.get("set-cookie")!.split(";")[0];

test("Yandex callback binds browser, provider and one-use state, sends PKCE and logs in by immutable subject", async (t) => {
  const fixture = testEnvironment(),
    restore = configuration();
  let verifier = "";
  try {
    const start = startOAuth(
      new Request(`${origin}/api/auth/yandex?returnTo=/notes/abc`),
      "yandex",
    );
    const url = new URL(start.headers.get("location")!),
      cookie = binding(start);
    assert.equal(
      url.searchParams.get("redirect_uri"),
      `${origin}/api/auth/yandex/callback`,
    );
    assert.equal(url.searchParams.get("scope"), "login:email login:info");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const state = url.searchParams.get("state")!;
    const callback = (headers = { cookie }) =>
      new Request(
        `${origin}/api/auth/yandex/callback?state=${state}&code=test-code`,
        { headers },
      );
    assert.match(
      (
        await finishOAuth(
          callback({ cookie: "doompile_oauth=wrong" }),
          "yandex",
        )
      ).headers.get("location")!,
      /auth_error/,
    );
    t.mock.method(
      globalThis,
      "fetch",
      async (address: string | URL | Request, options?: RequestInit) => {
        if (String(address).endsWith("/token")) {
          const parameters = new URLSearchParams(
            options!.body as URLSearchParams,
          );
          verifier = parameters.get("code_verifier")!;
          assert.equal(parameters.get("code"), "test-code");
          return Response.json({ access_token: "provider-token" });
        }
        assert.equal(
          new Headers(options?.headers).get("Authorization"),
          "OAuth provider-token",
        );
        return Response.json({
          id: "immutable-subject",
          client_id: "test-yandex",
          default_email: "alice@example.test",
          emails: ["alice@example.test"],
          display_name: "Alice",
        });
      },
    );
    const completed = await finishOAuth(callback(), "yandex");
    assert.equal(completed.headers.get("location"), origin + "/notes/abc");
    assert.equal(
      createHash("sha256").update(verifier).digest("base64url"),
      url.searchParams.get("code_challenge"),
    );
    const sessionCookie = completed.headers
      .getSetCookie()
      .find((value) => value.startsWith("doompile_session="))!;
    const user = principal(
      new Request(origin, { headers: { cookie: sessionCookie.split(";")[0] } }),
    )!.user;
    assert.equal(user.subject, "immutable-subject");
    assert.equal(user.email, "alice@example.test");
    assert.match(
      (await finishOAuth(callback(), "yandex")).headers.get("location")!,
      /auth_error/,
    );
    assert.equal(identities().list().total, 1);
    assert.equal(safeReturnTo("//evil.test"), "/");
    assert.equal(safeReturnTo("/\\evil.test"), "/");
    assert.equal(safeReturnTo("https://evil.test"), "/");
  } finally {
    restore();
    fixture.cleanup();
  }
});

test("Google login verifies the JWT signature, audience and nonce before accepting a user", async (t) => {
  const fixture = testEnvironment(),
    restore = configuration();
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  let nonce = "",
    invalidNonce = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (address: string | URL | Request) => {
      if (String(address).includes("/certs"))
        return Response.json({ keys: [jwk] });
      const idToken = await new SignJWT({
        nonce: invalidNonce ? "wrong" : nonce,
        email: "google@example.test",
        email_verified: true,
        name: "Google test",
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject("google-sub")
        .setIssuer("https://accounts.google.com")
        .setAudience("test-google")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return Response.json({ id_token: idToken });
    },
  );
  async function attempt() {
    const start = startOAuth(
        new Request(`${origin}/api/auth/google`),
        "google",
      ),
      url = new URL(start.headers.get("location")!);
    nonce = url.searchParams.get("nonce")!;
    return finishOAuth(
      new Request(
        `${origin}/api/auth/google/callback?state=${url.searchParams.get("state")}&code=test`,
        { headers: { cookie: binding(start) } },
      ),
      "google",
    );
  }
  try {
    invalidNonce = true;
    assert.match((await attempt()).headers.get("location")!, /auth_error/);
    assert.equal(identities().list().total, 0);
    invalidNonce = false;
    assert.equal((await attempt()).headers.get("location"), origin + "/");
    assert.equal(identities().list().total, 1);
  } finally {
    restore();
    fixture.cleanup();
  }
});
